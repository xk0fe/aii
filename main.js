// Electron shell: menu bar popover, floating pill + chat panel, full-screen dashboard.
// All agent logic lives in core/; this file owns windows, dialogs and notifications and wires them to the crew:
// this computer's agents plus those of every computer linked over Crew Link (see core/crew.js).
import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, nativeImage, nativeTheme, globalShortcut, dialog, shell, clipboard, powerSaveBlocker, systemPreferences } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG, ATTACHMENTS } from './core/hub.js'
import { Crew, CACHE } from './core/crew.js'
import { readPack } from './core/pack.js'
import { Voice, voiceActions, voiceAudio } from './core/voice.js'
import { pillWindow } from './core/pill.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const TRAY_WIDTH = 340

let crew, hub, tray, trayWin, overlay, dash
let pill // the floating pill's window placement (core/pill.js)
let trayHiddenAt = 0
let quitting = false
let awake = null

app.setName('Crew')
loadShellEnv()

// One Crew at a time: opening it again (Dock, Finder or npm start) brings up the one that's running,
// instead of a second copy launching the same agents.
const primary = app.requestSingleInstanceLock()
if (!primary) app.exit(0)
app.on('second-instance', () => openDashboard())

// A .crew file opened from Finder or Mail: the dashboard shows what's in it, to pick what to import.
let opened = null
app.on('open-file', (e, file) => {
  e.preventDefault()
  opened = file
  if (app.isReady() && crew) openPackFile()
})

function openPackFile() {
  if (!opened) return
  const file = opened
  opened = null
  openDashboard()
  const send = () => dash.webContents.send('import', { name: path.basename(file), text: fs.readFileSync(file, 'utf8') })
  dash.webContents.isLoading() ? dash.webContents.once('did-finish-load', send) : send()
}

app.whenReady().then(async () => {
  if (!primary) return
  app.dock?.hide()
  app.setAboutPanelOptions({ applicationName: 'Crew', iconPath: path.join(dir, 'assets', 'icon.png'), credits: 'Your crew of AI agents, side by side.' })

  // The agents' terminals live in the terminal host (core/ptyhost.js), run by this same binary as Node, so they keep
  // working while Crew quits or relaunches with new code.
  crew = new Crew({ bin: path.join(dir, 'bin'), computerName: computerName(), host: { file: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } } })
  hub = crew.hub
  await crew.start()
  nativeTheme.themeSource = hub.config.theme // every window + the popover's material

  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]))
  createTray()
  createOverlay()
  wire()
  const key = hub.config.hotkey ?? 'Alt+Shift+Space'
  const hotkey = () => (dashOnScreen() ? dash.focus() : overlay.webContents.send('toggle'))
  if (!globalShortcut.register(key, hotkey)) hub.post({ kind: 'event', from: 'crew', text: `hotkey ${key} is taken, set another "hotkey" in config.json` })
  wireVoice()

  // Dev aid: CREW_SHOW=tray,panel,dashboard opens those views on launch.
  const show = (process.env.CREW_SHOW ?? '').split(',')
  if (show.includes('dashboard')) openDashboard()
  if (show.includes('panel')) overlay.webContents.once('did-finish-load', () => overlay.webContents.send('toggle'))
  if (show.includes('tray')) setTimeout(toggleTray, 800)
  openPackFile() // Crew was opened by double-clicking a .crew file
})

app.on('window-all-closed', () => {}) // keep living in the menu bar

// Ctrl+C in the terminal that ran `npm start`: quit without the confirmation dialog. The agents keep working.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    quitting = true
    crew?.detach()
    app.exit(0)
  })
}

// Quitting leaves the agents working in the terminal host, and the next Crew picks them up; "Stop Agents and Quit"
// ends them too.
app.on('before-quit', (e) => {
  if (quitting || !crew) return
  const live = [...crew.hubs.values()].reduce((n, h) => n + h.snapshot().agents.filter((a) => a.on && !['stopped', 'off', 'parked'].includes(a.status)).length, 0)
  const s = live > 1 ? 's' : ''
  const answer = !live ? 1
    : crew.outlives
      ? dialog.showMessageBoxSync({
          type: 'question',
          message: 'Quit Crew?',
          detail: `${live} agent${s} on this computer keep${live > 1 ? '' : 's'} working, and Crew picks ${live > 1 ? 'them' : 'it'} up where ${live > 1 ? 'they are' : 'it is'} next time you open it. Messages you send wait until then.`,
          buttons: ['Quit', 'Stop Agents and Quit', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
        })
      : [1, 2][dialog.showMessageBoxSync({
          type: 'question',
          message: 'Quit Crew?',
          detail: `${live} agent session${s} on this computer will stop. They pick up where they left off next time you open Crew.`,
          buttons: ['Quit', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        })]
  if (answer === 2) return e.preventDefault()
  quitting = true
  if (answer === 1) crew.stop()
  else crew.detach()
})

const computerName = () => {
  try {
    return execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim()
  } catch {
    return os.hostname()
  }
}

// A computer that shares its agents shouldn't doze off while others use them.
function keepAwake() {
  const on = Boolean(crew.sharing) || [...crew.links.values()].some((l) => l.peer)
  if (on && awake === null) awake = powerSaveBlocker.start('prevent-app-suspension')
  if (!on && awake !== null) powerSaveBlocker.stop(awake), (awake = null)
}

// ---- windows ---------------------------------------------------------------

function page(file, options, query) {
  const win = new BrowserWindow({ show: false, ...options, webPreferences: { preload: path.join(dir, 'preload.cjs') } })
  win.loadFile(path.join(dir, 'ui', file), { query })
  win.webContents.on('will-navigate', (e) => e.preventDefault()) // a file dropped outside a drop zone must not replace the page
  return win
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(dir, 'assets', 'trayTemplate.png')))
  tray.setToolTip('Crew')
  trayWin = page('tray.html', {
    width: TRAY_WIDTH, height: 320, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, vibrancy: 'popover', visualEffectState: 'active', backgroundColor: '#00000000',
  })
  trayWin.on('blur', () => {
    trayWin.hide()
    trayHiddenAt = Date.now()
  })
  tray.on('click', toggleTray)
  tray.on('right-click', toggleTray)
}

function toggleTray() {
  // Clicking the icon while open blurs (hides) first; don't reopen on that same click.
  if (trayWin.isVisible() || Date.now() - trayHiddenAt < 250) return trayWin.hide()
  const b = tray.getBounds()
  const wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea
  const x = Math.min(Math.max(Math.round(b.x + b.width / 2 - TRAY_WIDTH / 2), wa.x + 8), wa.x + wa.width - TRAY_WIDTH - 8)
  trayWin.setPosition(x, wa.y + 6)
  trayWin.show()
}

function createOverlay() {
  overlay = page('overlay.html', {
    width: 78, height: 140, frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true,
    fullscreenable: false, minimizable: false, maximizable: false, alwaysOnTop: true,
    acceptFirstMouse: true, // the first press on the pill drags it (or opens the chat), even from another app
  })
  overlay.setAlwaysOnTop(true, 'floating')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const wa = screen.getPrimaryDisplay().workArea
  overlay.setPosition(wa.x + wa.width - 78, Math.round(wa.y + wa.height / 2 - 70))
  // Its chat opens on the side of the pill away from the part of the screen it's in, and it can be dragged
  // anywhere (core/pill.js).
  pill = pillWindow(overlay, screen)
  overlay.webContents.on('did-finish-load', () => {
    pill.cancelDrag() // a reload mid-drag never says "let go"
    overlay.webContents.send('place', pill.place)
  })
  overlay.on('hide', () => pill.cancelDrag())
  // a display came or went, or the Dock or menu bar moved: bring the pill back on screen and re-pick the side
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => pill.resettle())
  overlay.once('ready-to-show', () => dashOnScreen() || overlay.showInactive())
}

// The dashboard and the floating chat are two sizes of the same thing, so only one is on screen at a time:
// the dashboard hides the pill, and leaving the dashboard brings the pill back with the chat open.
const dashOnScreen = () => Boolean(dash?.isVisible() && !dash.isMinimized())

function showChat() {
  if (quitting || overlay.isDestroyed()) return
  overlay.showInactive()
  overlay.webContents.send('toggle', { open: true, focus: false })
}

function openDashboard(focus = '') {
  overlay.hide()
  if (dash) {
    if (dash.isMinimized()) dash.restore()
    dash.show()
    dash.focus()
    if (focus) dash.webContents.send('focus', focus)
    return
  }
  const wa = screen.getPrimaryDisplay().workArea
  showDock()
  dash = page('dashboard.html', {
    width: Math.min(1500, wa.width), height: Math.min(940, wa.height), minWidth: 980, minHeight: 560,
    titleBarStyle: 'hiddenInset', backgroundColor: nativeTheme.shouldUseDarkColors ? '#161719' : '#f3f3f6', title: 'Crew',
  }, { focus })
  dash.once('ready-to-show', () => dash.show())
  dash.on('show', () => overlay.hide())
  dash.on('restore', () => overlay.hide())
  dash.on('minimize', showChat)
  dash.on('hide', showChat)
  dash.on('closed', () => {
    dash = null
    app.dock?.hide()
    showChat()
  })
}

// `npm run dev` runs Electron's generic app, so give the Dock our icon each time it appears (Crew.app has it built in).
function showDock() {
  Promise.resolve(app.dock?.show()).then(() => app.isPackaged || app.dock?.setIcon(path.join(dir, 'assets', 'icon.png')))
}

// ---- wiring ------------------------------------------------------------------

// Every action the UI can take: crew.call('<name>', ...args). Agents are addressed by the name the UI shows,
// so an agent on another computer (gal@mac-mini) is handled there. What the UI does lands in the workspace on screen.
const actions = {
  state: () => crew.snapshot(),
  // The switcher and the workspace sheet: workspace('switch', 'golf'), workspace('create', null, { name, … }), and
  // edit, open, park, remove, members (see Crew.workspaceAction). -> { id, state }
  workspace: (op, id, arg) => crew.workspaceAction(op, id, arg),
  send: (to, text, images, opts) => crew.send(to, text, images, opts),
  // A new conversation for an agent (after its current task, if it's busy).
  freshStart: (name) => crew.at(name, 'freshStart'),
  // The Tasks board: task('file', null, { text, images, kind }), task('dispatch', '12'), task('accept', '12@air')…
  task: (op, key, arg) => crew.ticket(op, key, arg),
  taskSettings: (patch) => crew.here.setTaskSettings(patch),
  saveImage: (name, type, bytes) => crew.here.saveImage(name, type, bytes), // here; sent along when it goes elsewhere
  approve: (id) => crew.feedAction(id, 'approve'),
  drop: (id) => crew.feedAction(id, 'drop'),
  // Answer an agent's question (a permission prompt, AskUserQuestion, a plan) from the chat; see hub.ask.
  answer: (id, reply) => crew.feedAction(id, 'answer', reply),
  autopilot: (on) => crew.here.setAutopilot(on),
  // You've seen agents' replies up to then: { name: ts }. Unread badges count what's newer.
  read: (seen, ws) => (crew.hubs.get(ws) ?? crew.here).read(seen),
  update: (names, patch) => crew.update(names, patch),
  draftPrompt: (agent) => crew.draftPrompt(agent),
  addAgent: (fields) => crew.addAgent(fields),
  removeAgent: (name) => crew.at(name, 'removeAgent'),
  restart: (name) => crew.at(name, 'restart'),
  markIdle: (name) => crew.at(name, 'markIdle'),
  dismiss: (name) => crew.at(name, 'dismiss'), // send a clone away
  resize: (name, cols, rows) => crew.at(name, 'resize', cols, rows),
  buffer: (name) => crew.at(name, 'buffer'),

  // Agent packs: a .crew file with the agents' definitions, looks and reference images.
  exportAgents: async (names) => {
    names = [].concat(names)
    const { canceled, filePath } = await dialog.showSaveDialog(dash, {
      title: 'Export agents',
      defaultPath: path.join(app.getPath('downloads'), `${names.length === 1 ? names[0].split('@')[0] : 'crew'}.crew`),
      filters: [{ name: 'Crew agents', extensions: ['crew'] }],
    })
    if (canceled || !filePath) return null
    fs.writeFileSync(filePath, JSON.stringify(await crew.exportAgents(names), null, 2))
    shell.showItemInFolder(filePath)
    return path.basename(filePath)
  },
  // Pick a .crew file (or take one dropped on the window, as { name, text }): the pack plus what importing it
  // would look like.
  openPack: async (dropped) => {
    let { name, text } = dropped ?? {}
    if (!dropped) {
      const file = (await dialog.showOpenDialog(dash, { title: 'Import agents', properties: ['openFile'], filters: [{ name: 'Crew agents', extensions: ['crew', 'json'] }] })).filePaths[0]
      if (!file) return null
      ;[name, text] = [path.basename(file), fs.readFileSync(file, 'utf8')]
    }
    const pack = readPack(text)
    return { file: name, pack, agents: crew.importPreview(pack) }
  },
  importAgents: (pack, choices) => crew.importAgents(pack, choices),
  // Moves an agent to another computer (home: a computer's slug, '' for this one), conversation and all:
  // -> { name, conversation: 'moved' | 'fresh', reason?, older? } (older: that computer runs an older Crew).
  moveAgent: (name, home, folder) => crew.moveAgent(name, home, folder),
  freeName: (name, home) => crew.freeName(name, home),
  // Folders on any computer (home '' = this one), since pickFolder only browses this one:
  // folderInfo -> { exists, path } (path written out); folders -> [{ path, label }] to offer, `name` being the
  // agent you're placing (the folder at its current path comes first, if it's there).
  folderInfo: (home, dir) => crew.folderInfo(home, dir),
  folders: (home, name) => crew.folders(home, name),

  // Crew Link: share this computer, link others, choose which of their agents to use here.
  link: async (op, ...args) => {
    const ops = {
      share: (on) => crew.share(on),
      reset: () => crew.reset(),
      connect: (code) => crew.connect(code),
      forget: (home) => crew.forget(home),
      hide: (names, hidden) => crew.setHidden(names, hidden),
      rename: (name) => crew.rename(name),
    }
    if (!Object.hasOwn(ops, op)) throw new Error(`unknown link action "${op}"`)
    const out = await ops[op](...args)
    keepAwake()
    return out
  },

  openFile: (file) => [ATTACHMENTS, CACHE].some((d) => String(file).startsWith(d + path.sep)) && shell.openPath(file),
  openUrl: (url) => /^https?:\/\//.test(url) && shell.openExternal(url),
  copy: (text) => clipboard.writeText(String(text)),
  theme: (theme) => hub.setTheme(theme),
  dashboard: (focus) => {
    trayWin.hide()
    openDashboard(focus)
  },
  // In your text editor: the default app for .json files is often Xcode or a browser.
  config: () => {
    trayWin.hide()
    execFile('open', ['-t', CONFIG])
  },
  pickFolder: async (home) => {
    if (home) throw new Error(`Folders are on ${crew.links.get(home)?.name ?? home}: type the path`)
    return (await dialog.showOpenDialog(dash, { properties: ['openDirectory', 'createDirectory'] })).filePaths[0]
  },
  quit: () => app.quit(),
}

function wire() {
  ipcMain.handle('call', async (_e, name, ...args) => {
    try {
      if (!Object.hasOwn(actions, name)) return { error: `unknown action "${name}"` }
      return { ok: await actions[name](...args) }
    } catch (e) {
      return { error: e.message }
    }
  })
  // Dragging the pill (or the chat by its header): the page reports the pointer, letting go settles it.
  ipcMain.on('drag', (e, phase, x, y) => BrowserWindow.fromWebContents(e.sender) === overlay && pill.drag(phase, x, y))
  ipcMain.on('input', (_e, name, data) => {
    const { l, base } = crew.where(name)
    l ? l.peer?.input(base, data) : crew.here.input(base, data)
  })

  // Windows size themselves to their content; the overlay is placed so its pill stays put (core/pill.js).
  // (The menu bar popover asks on every state push; it's resized only when that changes its size.)
  ipcMain.on('fit', (e, width, height, focus, inside) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win !== overlay) {
      if (!win) return
      const size = [width, Math.min(height, screen.getDisplayMatching(win.getBounds()).workArea.height - 20)]
      const [w, h] = win.getContentSize()
      return (w !== size[0] || h !== size[1]) && win.setContentSize(...size)
    }
    pill.fit(width, height, inside)
    if (focus) {
      app.focus({ steal: true })
      overlay.focus()
    }
  })

  crew.on('pty', (name, data) => dash?.webContents.send('pty', name, data))

  // The menu bar's title redraws the status item, so it's set only when it reads differently.
  let title = null
  crew.on('state', (state) => {
    if (nativeTheme.themeSource !== state.theme) nativeTheme.themeSource = state.theme
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('state', state)
    const next = trayTitle(state)
    if (next !== title) tray.setTitle((title = next), { fontType: 'monospacedDigit' })
    keepAwake()
  })
  crew.changed()

  // From any workspace: with workspaces, the title says which, and a click puts that one on screen first.
  const from = (ws) => (crew.hubs.size > 1 ? `${crew.hubs.get(ws)?.space.name ?? ws} · ` : '')
  const goTo = (ws, focus) => {
    if (ws && ws !== crew.current && crew.hubs.has(ws)) crew.workspaceAction('switch', ws)
    openDashboard(focus)
  }
  crew.on('alert', (name, text, ws) => {
    const note = new Notification({ title: `${from(ws)}${name.replace(/\.(\d+)(?=@|$)/, ' (clone $1)')} needs you`, body: text })
    note.on('click', () => goTo(ws, name))
    note.show()
  })

  // e.g. "@david fixed #12": click to check it in the Bugs lane
  crew.on('notice', ({ title, body, focus, workspace }) => {
    const note = new Notification({ title: `${from(workspace)}${title}`, body })
    note.on('click', () => goTo(workspace, focus))
    note.show()
  })
}

// Voice input (core/voice.js): the chat's mic button, plus a hotkey that opens the chat and starts listening.
// Dictation runs on this computer: it only fills in your message, wherever the agent you send it to lives.
function wireVoice() {
  // Older macOS asks for speech-recognition permission, which needs the app's Info.plist to say why (Crew.app does).
  const plist = path.join(process.resourcesPath, '..', 'Info.plist')
  const mayAskPermission = fs.existsSync(plist) && fs.readFileSync(plist, 'utf8').includes('NSSpeechRecognitionUsageDescription')
  const voice = new Voice({ root: dir, mayAskPermission })
  const send = (event) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('voice', event))
  Object.assign(actions, voiceActions({ voice, systemPreferences, shell, send }))
  const audio = voiceAudio(voice)
  ipcMain.on('voice-audio', (e, id, samples) => audio(e.sender, id, samples))
  app.on('will-quit', () => voice.cancel())

  const key = hub.config.voiceHotkey ?? 'Alt+Shift+D'
  const dictate = () => {
    if (dashOnScreen()) {
      dash.focus()
      return dash.webContents.send('voice', { type: 'toggle' })
    }
    overlay.showInactive()
    overlay.webContents.send('toggle', { open: true, focus: true })
    overlay.webContents.send('voice', { type: 'toggle' })
  }
  if (key && !globalShortcut.register(key, dictate)) hub.post({ kind: 'event', from: 'crew', text: `voice hotkey ${key} is taken, set another "voiceHotkey" in config.json` })
}

// "2/5": agents at work out of those on; one counts as working while it or any of its clones is. With workspaces, every
// open one counts.
function trayTitle(state) {
  if (state.workspaces?.length > 1) {
    const sum = (k) => state.workspaces.reduce((n, w) => n + (w.parked ? 0 : w[k]), 0)
    const [waiting, working, on] = [sum('waiting'), sum('working'), sum('on')]
    return waiting ? ` ${waiting} need${waiting > 1 ? '' : 's'} you` : working ? ` ${working}/${on}` : ''
  }
  const on = state.agents.filter((a) => a.on)
  const agents = on.filter((a) => !a.cloneOf)
  const waiting = on.filter((a) => a.status === 'waiting').length
  const working = agents.filter((a) => [a, ...on.filter((c) => c.cloneOf === a.name)].some((x) => x.status === 'working')).length
  return waiting ? ` ${waiting} need${waiting > 1 ? '' : 's'} you` : working ? ` ${working}/${agents.length}` : ''
}

// Apps opened from Finder get a bare PATH; borrow the login shell's environment so `claude` and friends resolve.
function loadShellEnv() {
  if (process.env.TERM_PROGRAM) return // launched from a terminal, env is already right
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "\\n__CREW__\\n"; env -0'], { encoding: 'utf8', timeout: 8000 })
    for (const pair of out.split('\n__CREW__\n')[1].split('\0')) {
      const i = pair.indexOf('=')
      if (i > 0 && (pair.startsWith('PATH=') || !(pair.slice(0, i) in process.env))) process.env[pair.slice(0, i)] = pair.slice(i + 1)
    }
  } catch {}
}

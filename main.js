// Electron shell: menu bar popover, floating pill + chat panel, full-screen dashboard.
// All agent logic lives in core/; this file only owns windows and wires them to the hub.
import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, nativeImage, nativeTheme, globalShortcut, dialog, shell } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hub, CONFIG, ATTACHMENTS } from './core/hub.js'
import { Runner } from './core/runner.js'
import { serve } from './core/server.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const TRAY_WIDTH = 340

let hub, runner, tray, trayWin, overlay, dash
let trayHiddenAt = 0
let quitting = false

app.setName('Crew')
loadShellEnv()

// One Crew at a time: opening it again (Dock, Finder or npm start) brings up the one that's running,
// instead of a second copy launching the same agents.
const primary = app.requestSingleInstanceLock()
if (!primary) app.exit(0)
app.on('second-instance', () => openDashboard())

app.whenReady().then(async () => {
  if (!primary) return
  app.dock?.hide()
  app.setAboutPanelOptions({ applicationName: 'Crew', iconPath: path.join(dir, 'assets', 'icon.png'), credits: 'Your crew of AI agents, side by side.' })
  runner = new Runner()
  hub = new Hub(runner, { bin: path.join(dir, 'bin') })
  const server = await serve(hub)
  hub.start(`http://127.0.0.1:${server.address().port}`)
  nativeTheme.themeSource = hub.config.theme // light / dark / system, for every window and the popover's material

  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]))
  createTray()
  createOverlay()
  wire()
  const hotkey = () => (dashOnScreen() ? dash.focus() : overlay.webContents.send('toggle'))
  if (!globalShortcut.register(hub.config.hotkey, hotkey)) {
    hub.post({ kind: 'event', from: 'crew', text: `hotkey ${hub.config.hotkey} is taken, set another "hotkey" in config.json` })
  }

  // Dev aid: CREW_SHOW=tray,panel,dashboard opens those views on launch.
  const show = (process.env.CREW_SHOW ?? '').split(',')
  if (show.includes('dashboard')) openDashboard()
  if (show.includes('panel')) overlay.webContents.once('did-finish-load', () => overlay.webContents.send('toggle'))
  if (show.includes('tray')) setTimeout(toggleTray, 800)
})

app.on('window-all-closed', () => {}) // keep living in the menu bar

// Ctrl+C in the terminal that ran `npm start`: quit without the confirmation dialog.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    quitting = true
    runner?.stopAll()
    app.exit(0)
  })
}

app.on('before-quit', (e) => {
  if (quitting || !hub) return
  const live = hub.snapshot().agents.filter((a) => a.on && a.status !== 'stopped').length
  const answer = live
    ? dialog.showMessageBoxSync({
        type: 'question',
        message: 'Quit Crew?',
        detail: `${live} agent session${live > 1 ? 's' : ''} will stop. They pick up where they left off next time you open Crew.`,
        buttons: ['Quit', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      })
    : 0
  if (answer === 1) return e.preventDefault()
  quitting = true
  hub.saveStats()
  runner.stopAll()
})

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
  })
  overlay.setAlwaysOnTop(true, 'floating')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const wa = screen.getPrimaryDisplay().workArea
  overlay.setPosition(wa.x + wa.width - 78, Math.round(wa.y + wa.height / 2 - 70))
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

// Everything the UI can ask for. Add a function here, call it with crew.call('<name>', ...args).
const actions = {
  state: () => hub.snapshot(),
  send: (to, text, images) => hub.send({ to, text, images }),
  saveImage: (name, type, bytes) => hub.saveImage(name, type, bytes),
  openFile: (file) => String(file).startsWith(ATTACHMENTS + path.sep) && shell.openPath(file),
  openUrl: (url) => /^https?:\/\//.test(url) && shell.openExternal(url),
  approve: (id) => hub.approve(id),
  drop: (id) => hub.drop(id),
  autopilot: (on) => hub.setAutopilot(on),
  theme: (theme) => hub.setTheme(theme),
  update: (names, patch) => hub.update(names, patch),
  draftPrompt: (agent) => hub.draftPrompt(agent),
  addAgent: (agent) => hub.addAgent(agent),
  removeAgent: (name) => hub.removeAgent(name),
  restart: (name) => hub.restart(name),
  markIdle: (name) => hub.markIdle(name),
  resize: (name, cols, rows) => runner.resize(name, cols, rows),
  buffer: (name) => {
    flushPty()
    return runner.buffer(name)
  },
  dashboard: (focus) => {
    trayWin.hide()
    openDashboard(focus)
  },
  // In your text editor: the default app for .json files is often Xcode or a browser.
  config: () => {
    trayWin.hide()
    execFile('open', ['-t', CONFIG])
  },
  pickFolder: async () => (await dialog.showOpenDialog(dash, { properties: ['openDirectory', 'createDirectory'] })).filePaths[0],
  quit: () => app.quit(),
}

const ptyOut = new Map()
let ptyTimer = null

function flushPty() {
  clearTimeout(ptyTimer)
  ptyTimer = null
  for (const [name, data] of ptyOut) dash?.webContents.send('pty', name, data)
  ptyOut.clear()
}

function wire() {
  ipcMain.handle('call', async (_e, name, ...args) => {
    if (!Object.hasOwn(actions, name)) return { error: `unknown action "${name}"` }
    try {
      return { ok: await actions[name](...args) }
    } catch (e) {
      return { error: e.message }
    }
  })
  ipcMain.on('input', (_e, name, data) => hub.input(name, data))

  // Windows size themselves to their content; the overlay stays anchored to its right edge and vertical center.
  ipcMain.on('fit', (e, width, height, focus) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win !== overlay) return win?.setContentSize(width, Math.min(height, screen.getDisplayMatching(win.getBounds()).workArea.height - 20))
    const b = overlay.getBounds()
    const wa = screen.getDisplayMatching(b).workArea
    const y = Math.round(b.y + b.height / 2 - height / 2)
    overlay.setBounds({ x: b.x + b.width - width, y: Math.max(wa.y, Math.min(y, wa.y + wa.height - height)), width, height })
    if (focus) {
      app.focus({ steal: true })
      overlay.focus()
    }
  })

  // Terminal output is batched per frame so a chatty agent doesn't flood IPC.
  runner.on('data', (name, data) => {
    if (!dash) return
    ptyOut.set(name, (ptyOut.get(name) ?? '') + data)
    ptyTimer ??= setTimeout(flushPty, 16)
  })

  let pending = null
  hub.on('change', () => {
    pending ??= setTimeout(() => {
      pending = null
      const state = hub.snapshot()
      if (nativeTheme.themeSource !== state.theme) nativeTheme.themeSource = state.theme
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('state', state)
      tray.setTitle(trayTitle(state), { fontType: 'monospacedDigit' })
    }, 50)
  })

  hub.on('alert', (a, text) => {
    const note = new Notification({ title: `${a.name} needs you`, body: text })
    note.on('click', () => openDashboard(a.name))
    note.show()
  })
}

function trayTitle(state) {
  const agents = state.agents.filter((a) => a.on)
  const waiting = agents.filter((a) => a.status === 'waiting').length
  const working = agents.filter((a) => a.status === 'working').length
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

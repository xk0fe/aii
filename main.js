// Electron shell: menu bar popover, floating pill + chat panel, full-screen dashboard.
// All agent logic lives in core/; this file owns windows and wires them to a backend:
// a hub with agents on this Mac, or another computer's crew over Crew Link.
import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, nativeImage, nativeTheme, globalShortcut, dialog, shell, clipboard, powerSaveBlocker } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hub, HOME, CONFIG, ATTACHMENTS } from './core/hub.js'
import { Runner } from './core/runner.js'
import { serve } from './core/server.js'
import { LinkHost, LinkClient, identity, addresses, makeCode, readCode, DEFAULT_PORT } from './core/link.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const TRAY_WIDTH = 340
const LINK_DIR = path.join(HOME, 'link')
const LINK_FILE = path.join(LINK_DIR, 'link.json')
const CACHE = path.join(LINK_DIR, 'cache')

let hub, runner, backend, sharing, remote, tray, trayWin, overlay, dash
let trayHiddenAt = 0
let quitting = false
let link = readLink() // { share, port, key } on a host; { remote: code, theme } on a computer using another one's crew

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

  if (link.remote) {
    remote = new LinkClient(link.remote)
    remote.on('status', (s) => (remote.status = s))
    backend = remoteBackend(remote)
    remote.connect()
  } else {
    runner = new Runner()
    hub = new Hub(runner, { bin: path.join(dir, 'bin') })
    const server = await serve(hub)
    hub.start(`http://127.0.0.1:${server.address().port}`)
    backend = localBackend()
    if (link.share) await startSharing().catch(() => {})
  }
  nativeTheme.themeSource = remote ? (link.theme ?? 'system') : hub.config.theme // every window + the popover's material

  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]))
  createTray()
  createOverlay()
  wire()
  const key = hub?.config.hotkey ?? 'Alt+Shift+Space'
  const hotkey = () => (dashOnScreen() ? dash.focus() : overlay.webContents.send('toggle'))
  if (!globalShortcut.register(key, hotkey)) hub?.post({ kind: 'event', from: 'crew', text: `hotkey ${key} is taken, set another "hotkey" in config.json` })

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
  if (quitting || !hub) return // a remote crew keeps running on its host
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

// ---- backends: the same interface whether the crew lives here or on another computer ----------------

// call(name, args) runs a crew action, input() types into a terminal, snapshot() is the latest state;
// events: 'state', 'pty' (name, data), 'alert' (name, text).
const CREW_ACTIONS = ['state', 'send', 'saveImage', 'readImage', 'approve', 'drop', 'autopilot', 'update', 'draftPrompt', 'addAgent', 'removeAgent', 'restart', 'markIdle', 'resize', 'buffer']

function localBackend() {
  const ee = new EventEmitter()
  // Terminal output is batched per frame so a chatty agent doesn't flood IPC or the network.
  const out = new Map()
  let timer = null
  const flush = () => {
    clearTimeout(timer)
    timer = null
    for (const [name, data] of out) ee.emit('pty', name, data)
    out.clear()
  }
  runner.on('data', (name, data) => {
    out.set(name, (out.get(name) ?? '') + data)
    timer ??= setTimeout(flush, 16)
  })
  let pending = null
  hub.on('change', () => {
    pending ??= setTimeout(() => {
      pending = null
      ee.emit('state', hub.snapshot())
    }, 50)
  })
  hub.on('alert', (a, text) => ee.emit('alert', a.name, text))

  const actions = {
    state: () => hub.snapshot(),
    send: (to, text, images) => hub.send({ to, text, images }),
    saveImage: (name, type, bytes) => hub.saveImage(name, type, bytes),
    readImage: (file) => {
      if (!String(file).startsWith(ATTACHMENTS + path.sep)) throw new Error('not an attachment')
      return new Uint8Array(fs.readFileSync(file))
    },
    approve: (id) => hub.approve(id),
    drop: (id) => hub.drop(id),
    autopilot: (on) => hub.setAutopilot(on),
    update: (names, patch) => hub.update(names, patch),
    draftPrompt: (agent) => hub.draftPrompt(agent),
    addAgent: (agent) => hub.addAgent(agent),
    removeAgent: (name) => hub.removeAgent(name),
    restart: (name) => hub.restart(name),
    markIdle: (name) => hub.markIdle(name),
    resize: (name, cols, rows) => runner.resize(name, cols, rows),
    // Flush first: chunks already batched are in the buffer, so a viewer replaying it won't see them twice.
    buffer: (name) => {
      flush()
      return runner.buffer(name)
    },
  }
  return Object.assign(ee, { call: (name, args) => actions[name](...args), input: (name, data) => hub.input(name, data), snapshot: () => hub.snapshot() })
}

// Another computer's crew. Images are files on the host, so they're fetched on demand into a local
// cache for display, and paths are translated both ways at this boundary.
function remoteBackend(client) {
  const ee = new EventEmitter()
  const toHost = new Map()
  const local = (hostPath) => {
    const file = path.join(CACHE, crypto.createHash('sha1').update(hostPath).digest('hex').slice(0, 20) + path.extname(hostPath))
    toHost.set(file, hostPath)
    return file
  }
  const fetching = new Set()
  const fetchImage = (hostPath) => {
    const file = local(hostPath)
    if (fs.existsSync(file) || fetching.has(hostPath)) return file
    fetching.add(hostPath)
    client
      .call('readImage', [hostPath])
      .then((bytes) => {
        fs.mkdirSync(CACHE, { recursive: true })
        fs.writeFileSync(file, bytes)
        emitState() // now the picture can show
      }, () => {})
      .finally(() => fetching.delete(hostPath))
    return file
  }
  const localize = (state) => ({
    ...state,
    feed: state.feed.map((e) => (e.images ? { ...e, images: e.images.map(fetchImage) } : e)),
    agents: state.agents.map((a) => (a.images ? { ...a, images: a.images.map(fetchImage) } : a)),
  })
  const hostPaths = (list) => list?.map((p) => toHost.get(p) ?? p)
  let last = { agents: [], providers: {}, feed: [], autopilot: true }
  let timer = null
  const emitState = () => {
    clearTimeout(timer)
    timer = setTimeout(() => ee.emit('state', localize(last)), 30)
  }
  client.on('state', (state) => {
    last = state
    emitState()
  })
  client.on('status', emitState) // the UI shows connected / reconnecting
  client.on('pty', (name, data) => ee.emit('pty', name, data))
  client.on('alert', (name, text) => ee.emit('alert', name, text))

  const translate = {
    send: ([to, text, images]) => [to, text, hostPaths(images)],
    update: ([names, patch]) => [names, patch.images ? { ...patch, images: hostPaths(patch.images) } : patch],
    addAgent: ([fields]) => [fields.images ? { ...fields, images: hostPaths(fields.images) } : fields],
  }
  return Object.assign(ee, {
    async call(name, args) {
      const result = await client.call(name, translate[name]?.(args) ?? args)
      if (name === 'saveImage') {
        // keep a local copy so the thumbnail shows right away
        fs.mkdirSync(CACHE, { recursive: true })
        fs.writeFileSync(local(result), args[2])
        return local(result)
      }
      return name === 'state' ? localize(result) : result
    },
    input: (name, data) => client.input(name, data),
    snapshot: () => localize(last),
  })
}

// ---- Crew Link -------------------------------------------------------------------------------------------

function readLink() {
  try {
    return JSON.parse(fs.readFileSync(LINK_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveLink(patch) {
  link = { ...link, ...patch }
  for (const k of Object.keys(link)) if (link[k] === undefined) delete link[k]
  fs.mkdirSync(LINK_DIR, { recursive: true })
  fs.writeFileSync(LINK_FILE, JSON.stringify(link, null, 2))
  fs.chmodSync(LINK_FILE, 0o600)
}

const computerName = () => {
  try {
    return execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim()
  } catch {
    return os.hostname()
  }
}

let linkError = null
let clients = 0
let awake = null

// Share this Mac's crew: an encrypted server on all interfaces (Wi-Fi + Tailscale), guarded by the pairing key.
async function startSharing() {
  if (!link.key) saveLink({ key: crypto.randomBytes(24).toString('base64url') })
  const id = identity(LINK_DIR)
  const host = new LinkHost({ backend, allowed: CREW_ACTIONS, key: link.key, cert: id.cert, keyPem: id.key, name: computerName() })
  host.fingerprint = id.fingerprint
  host.on('clients', (n) => {
    clients = n
    backend.emit('state', backend.snapshot())
  })
  try {
    await host.start(link.port ?? DEFAULT_PORT)
    sharing = host
    linkError = null
    awake ??= powerSaveBlocker.start('prevent-app-suspension')
  } catch (e) {
    host.stop()
    linkError = e.code === 'EADDRINUSE' ? `port ${link.port ?? DEFAULT_PORT} is in use, set another "port" in ${LINK_FILE}` : e.message
    throw new Error(linkError)
  }
}

function stopSharing() {
  sharing?.stop()
  sharing = null
  clients = 0
  if (awake !== null) powerSaveBlocker.stop(awake)
  awake = null
}

// What the Link dialog shows. Only ever sent to this computer's own windows (it includes the secret code).
function linkInfo() {
  if (remote) return { mode: 'remote', name: remote.code.name, ...remote.status }
  if (!sharing) return { mode: 'local', sharing: false, error: linkError }
  const port = link.port ?? DEFAULT_PORT
  const hosts = addresses()
  return {
    mode: 'local', sharing: true, clients, port, hosts, name: sharing.name,
    code: makeCode({ name: sharing.name, port, key: link.key, fingerprint: sharing.fingerprint, hosts: hosts.map((h) => h.address) }),
  }
}

// Switching between "this Mac's crew" and "another computer's crew" restarts Crew in the new mode.
function relaunch() {
  quitting = true
  runner?.stopAll()
  hub?.saveStats()
  app.relaunch()
  app.exit(0)
}

const linkActions = {
  share: async (on) => {
    saveLink({ share: Boolean(on) })
    if (on && !sharing) await startSharing()
    if (!on) stopSharing()
    backend.emit('state', backend.snapshot())
  },
  // A new key: every computer using the old code is disconnected.
  reset: async () => {
    saveLink({ key: crypto.randomBytes(24).toString('base64url') })
    if (sharing) {
      stopSharing()
      await startSharing()
    }
    backend.emit('state', backend.snapshot())
  },
  connect: (code) => {
    readCode(code) // throws if it isn't one
    saveLink({ remote: String(code).trim(), share: false })
    relaunch()
  },
  disconnect: () => {
    saveLink({ remote: undefined })
    relaunch()
  },
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

const hostName = () => remote?.code.name ?? 'the host'

// Actions that always run on the computer you're using; everything in CREW_ACTIONS goes to the backend.
// Add a function here, call it with crew.call('<name>', ...args).
const uiActions = {
  state: () => decorate(backend.snapshot()), // never waits on the network: a remote crew shows what's known so far
  openFile: (file) => [ATTACHMENTS, CACHE].some((d) => String(file).startsWith(d + path.sep)) && shell.openPath(file),
  openUrl: (url) => /^https?:\/\//.test(url) && shell.openExternal(url),
  copy: (text) => clipboard.writeText(String(text)),
  theme: (theme) => {
    if (!remote) return hub.setTheme(theme)
    saveLink({ theme }) // a remote crew's look is this computer's choice
    nativeTheme.themeSource = theme
    backend.emit('state', backend.snapshot())
  },
  dashboard: (focus) => {
    trayWin.hide()
    openDashboard(focus)
  },
  // In your text editor: the default app for .json files is often Xcode or a browser.
  config: () => {
    trayWin.hide()
    if (!remote) return execFile('open', ['-t', CONFIG])
    dialog.showMessageBox({ message: `config.json lives on ${hostName()}`, detail: 'Edit agents from the Crew page here, or open config.json on that computer.' })
  },
  pickFolder: async () => {
    if (remote) throw new Error(`Folders are on ${hostName()}: type the path`)
    return (await dialog.showOpenDialog(dash, { properties: ['openDirectory', 'createDirectory'] })).filePaths[0]
  },
  link: (op, arg) => linkActions[op](arg),
  quit: () => app.quit(),
}

function wire() {
  ipcMain.handle('call', async (_e, name, ...args) => {
    try {
      if (Object.hasOwn(uiActions, name)) return { ok: await uiActions[name](...args) }
      if (CREW_ACTIONS.includes(name)) return { ok: await backend.call(name, args) }
      return { error: `unknown action "${name}"` }
    } catch (e) {
      return { error: e.message }
    }
  })
  ipcMain.on('input', (_e, name, data) => backend.input(name, data))

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

  backend.on('pty', (name, data) => dash?.webContents.send('pty', name, data))

  backend.on('state', (raw) => {
    const state = decorate(raw)
    if (nativeTheme.themeSource !== state.theme) nativeTheme.themeSource = state.theme
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('state', state)
    tray.setTitle(trayTitle(state), { fontType: 'monospacedDigit' })
  })
  backend.emit('state', backend.snapshot())

  backend.on('alert', (name, text) => {
    const note = new Notification({ title: `${name} needs you`, body: remote ? `${text} (on ${hostName()})` : text })
    note.on('click', () => openDashboard(name))
    note.show()
  })
}

// This computer's windows also get the Link status, and a remote crew uses this computer's theme.
const decorate = (state) => ({ ...state, link: linkInfo(), ...(remote && { theme: link.theme ?? 'system' }) })

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

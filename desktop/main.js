// Electron shell: menu bar popover, floating pill + chat panel, full-screen dashboard.
// All agent logic lives in core/; this file owns windows, dialogs and notifications and wires them to the crew:
// this computer's agents plus those of every computer linked over Crew Link (see core/crew.js), and your phones
// (core/remote.js).
import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, nativeImage, nativeTheme, globalShortcut, dialog, shell, clipboard, powerSaveBlocker, systemPreferences } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import qrcode from 'qrcode-generator'
import { CONFIG, ATTACHMENTS, HOME } from './core/hub.js'
import { Crew, CACHE } from './core/crew.js'
import { addresses } from './core/link.js'
import { Remote } from './core/remote.js'
import { readPack } from './core/pack.js'
import { Voice, voiceActions, voiceAudio } from './core/voice.js'
import { pillWindow } from './core/pill.js'
import { readNotches, hatchOn } from './core/hatch.js'
import { Permissions, appBundle, bundleIdIn } from './core/permissions.js'
import { Setup, withSetup, hasAgents } from './core/setup.js'
import { addProvider, removeProvider, checkProvider, keepProvidersInUse } from './core/providers.js'
// The app's name and id (core/appid.js), which packaging uses too: on Windows notifications carry the id, and it must
// match the installer's Start menu shortcut.
import { APP_ID, PRODUCT_NAME, USER_DATA } from './core/appid.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const TRAY_WIDTH = 340
const MAC = process.platform === 'darwin'
const WINDOWS = process.platform === 'win32'
// Windows' own cut of the app icon (no Mac tile shadow), every size it asks for from 16 to 256px
const WIN_ICON = path.join(dir, 'assets', 'icon.ico')
const LOG = path.join(HOME, 'logs', 'crew.log') // ~/.crew/logs/crew.log (logLine)
const LOG_MAX = 1024 * 1024

let crew, remote, tray, trayWin, overlay, dash
let phoneCodes = Promise.resolve() // phones('code') one at a time: the code made last is the one asked for last
let dashPage = 0 // the dashboard's page: a new one on each load, and when it closes
let pill // the floating pill's window placement (core/pill.js)
let notches = [] // where the screens' notches are (core/hatch.js)
let permissions // what macOS allows this app (core/permissions.js)
let permWin // the permissions flow, while it's up (ui/permissions.js)
let permPoint // the screen it came up on, as a point on it
let afterPermissions = null // what comes next once it's gone: on a first launch, the dashboard
let trayHiddenAt = 0
let quitting = false
let started = false // Crew is up: its windows exist, so a second launch or a .crew file can show them
let awake = null
const setup = new Setup() // can Claude Code and Codex run here (core/setup.js): the first-run screen, ui/setup.js

// Something that went wrong in here and nothing caught: written to Crew's log, and Crew carries on. Without this
// Electron shows a dialog with the stack; the agents run in the terminal host either way, so they never stop for it.
process.on('uncaughtException', (e) => logLine('crash', e?.stack ?? String(e)))
process.on('unhandledRejection', (e) => logLine('unhandled', e?.stack ?? String(e)))
process.stderr.on('error', () => {}) // a closed terminal (npm run dev) mustn't make each log line another crash

// Electron names its folder for the app (userData) after the package's productName, as it starts. It's pinned to the
// one the app had before its rename, before anything reads it (the single-instance lock below lives there too), so
// your view settings stay, and a renamed copy and an older one can't run at once.
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA))
app.setName(PRODUCT_NAME) // the Mac's app menu: About, Hide and Quit say it
// Windows shows a notification only for an app id it knows: the installer's (packaged), or this Electron's own when
// running from source.
if (WINDOWS) app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)
loadShellEnv()

// One Crew at a time: opening it again (Dock, Finder, the Start menu or npm start) brings up the one that's running,
// instead of a second copy launching the same agents.
const primary = app.requestSingleInstanceLock()
if (!primary) app.exit(0)

// A .crew file opened from Finder, Explorer or Mail: the dashboard shows what's in it, to pick what to import. A Mac
// hands it over as open-file; Windows starts Crew with it as an argument, or, with Crew running already, hands that
// one the arguments (second-instance).
let opened = null
const packIn = (argv) => argv.slice(1).find((a) => /\.crew$/i.test(a) && fs.existsSync(a)) ?? null
function openPack(file) {
  opened = file
  if (started) openPackFile()
}
app.on('open-file', (e, file) => {
  e.preventDefault()
  openPack(file)
})
app.on('second-instance', (_e, argv) => {
  const file = packIn(argv)
  if (file) return openPack(file)
  if (started) openDashboard()
})
opened = packIn(process.argv)

function openPackFile() {
  if (!opened) return
  const file = opened
  opened = null
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    return logLine('open', `${file}: ${e.message}`)
  }
  openDashboard()
  const send = () => dash.webContents.send('import', { name: path.basename(file), text })
  dash.webContents.isLoading() ? dash.webContents.once('did-finish-load', send) : send()
}

app.whenReady().then(() => primary && start().catch(failedToStart))

async function start() {
  app.dock?.hide()
  app.setAboutPanelOptions?.({ applicationName: PRODUCT_NAME, iconPath: path.join(dir, 'assets', 'icon.png'), credits: 'Your crew of AI agents, side by side.' })

  // The agents' terminals live in the terminal host (core/ptyhost.js), run by this same binary as Node, so they keep
  // working while Crew quits or relaunches with new code.
  // bin/ goes on the agents' PATH, so it has to be a real folder: in an installed Crew, the one next to app.asar.
  const bin = path.join(dir, 'bin').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
  crew = new Crew({ bin, computerName: computerName(), host: { file: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } } })
  const checked = setup.check() // meanwhile, in the background
  await crew.start()
  checked.then(() => crew.changed())
  remote = new Remote(crew)
  await remote.start()
  nativeTheme.themeSource = crew.config.data.theme // every window + the popover's material
  if (MAC) {
    notches = (await readNotches()) ?? notches
    permissions = newPermissions()
  }

  setMenu()
  createTray()
  createOverlay()
  wire()
  const key = crew.config.data.hotkey ?? 'Alt+Shift+Space'
  const hotkey = () => (dashOnScreen() ? dash.focus() : overlay.webContents.send('toggle'))
  if (!globalShortcut.register(key, hotkey)) crew.say(shortcutTaken(key, 'opens the floating chat', `open the chat from ${PRODUCT_NAME}'s icon in the ${MAC ? 'menu bar' : 'taskbar'}`))
  wireVoice()

  // Running from source: CREW_SHOW=tray,panel,dashboard opens those views on launch.
  if (!app.isPackaged) {
    const show = (process.env.CREW_SHOW ?? '').split(',')
    if (show.includes('dashboard')) openDashboard()
    if (show.includes('panel')) overlay.webContents.once('did-finish-load', () => overlay.webContents.send('toggle'))
    if (show.includes('tray')) setTimeout(toggleTray, 800)
  }
  started = true
  openPackFile() // Crew was opened by double-clicking a .crew file
  try {
    keepProvidersInUse(crew.config)
  } catch (e) {
    logLine('config', `couldn't note the providers in use: ${e.message}`) // the picker counts them anyway
  }
  // A first run: no workspace or no agents yet, so Crew opens on its dashboard, which says what to set up, asks for the
  // first workspace, or invites the first agent. What macOS still has to allow comes first, up in the hatch.
  const firstRun = !crew.screen || !hasAgents(crew.config.data)
  const missing = (await permissions?.missing().catch((e) => (logLine('permissions', e?.stack ?? String(e)), []))) ?? []
  if (missing.length) openPermissions({ then: firstRun ? openDashboard : null })
  else if (firstRun) openDashboard()
}

// Crew couldn't start (its terminal host, say): say so and quit, rather than run on with no icon and no window, holding
// the one-Crew-at-a-time lock so opening it again does nothing. Agents it had picked up keep running in the host.
function failedToStart(e) {
  logLine('start', e?.stack ?? String(e))
  dialog.showMessageBoxSync({
    type: 'error',
    message: `${PRODUCT_NAME} couldn't start`,
    detail: `Open ${PRODUCT_NAME} again to try once more. If this keeps happening, send ${PRODUCT_NAME}'s log to support: ${LOG}\n\n${e?.message ?? e}`,
    buttons: ['Quit'],
  })
  quitting = true
  try {
    crew?.detach()
  } catch {}
  app.exit(1)
}

// A global shortcut another app already has: what it was for, and what to do instead, for the chat. (There's no setting
// for the shortcuts in Crew yet.)
const shortcutTaken = (key, does, instead) => `${shortcutText(key)} ${does}, but another app already uses it, so it's off for now. ${instead.charAt(0).toUpperCase()}${instead.slice(1)} instead.`
// A shortcut as you'd read it: Alt+Shift+Space is ⌥⇧Space on a Mac.
function shortcutText(accelerator) {
  if (!MAC) return accelerator.replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, 'Ctrl')
  const glyphs = { Alt: '⌥', Option: '⌥', Shift: '⇧', Control: '⌃', Ctrl: '⌃', Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', CmdOrCtrl: '⌘', Super: '⌘' }
  const parts = accelerator.split('+')
  return parts.slice(0, -1).map((m) => glyphs[m] ?? `${m}+`).join('') + parts.at(-1)
}

// The menus. A Mac's menu bar: Crew, Edit (copy and paste need it), View for zoom and full screen, Window. Windows shows
// no menu bar (windowKeys has its zoom and full-screen keys). Reload and the developer tools only when running from
// source (npm run dev).
function setMenu() {
  if (!MAC) return Menu.setApplicationMenu(null)
  const dev = app.isPackaged ? [] : [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
  const view = { label: 'View', submenu: [...dev, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, view, { role: 'windowMenu' }]))
}

// Windows' keys for what a Mac's View menu does: Ctrl+= / Ctrl+- / Ctrl+0 zoom and F11 full screen (the dashboard); and,
// running from source, Ctrl+R reloads and Ctrl+Shift+I opens the developer tools (every window).
function windowKeys(win, { zoom = false } = {}) {
  if (MAC) return
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const wc = win.webContents
    const ctrl = input.control && !input.alt && !input.meta
    const key = input.key.toLowerCase()
    const act = zoom && ctrl && (key === '=' || key === '+') ? () => wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4))
      : zoom && ctrl && key === '-' ? () => wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3))
        : zoom && ctrl && key === '0' ? () => wc.setZoomLevel(0)
          : zoom && key === 'f11' && !input.control && !input.alt ? () => win.setFullScreen(!win.isFullScreen())
            : !app.isPackaged && ctrl && !input.shift && key === 'r' ? () => wc.reload()
              : !app.isPackaged && ctrl && input.shift && key === 'i' ? () => wc.toggleDevTools()
                : null
    if (!act) return
    e.preventDefault()
    act()
  })
}

app.on('window-all-closed', () => {}) // keep living in the menu bar
app.on('will-quit', () => remote?.stop()) // phones hear Crew went away, rather than lose it

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
  const live = [...crew.hubs.values()].reduce((n, h) => n + h.snapshot().agents.filter((a) => a.on && !['stopped', 'off', 'parked', 'resting'].includes(a.status)).length, 0)
  const s = live > 1 ? 's' : ''
  if (live) lowerHatch() // its dialog is coming, right under the docked chat
  const answer = !live ? 1
    : crew.outlives
      ? dialog.showMessageBoxSync({
          type: 'question',
          message: `Quit ${PRODUCT_NAME}?`,
          detail: `${live} agent${s} on this computer keep${live > 1 ? '' : 's'} working, and ${PRODUCT_NAME} picks ${live > 1 ? 'them' : 'it'} up where ${live > 1 ? 'they are' : 'it is'} next time you open it. Messages you send wait until then.`,
          buttons: ['Quit', 'Stop Agents and Quit', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
        })
      : [1, 2][dialog.showMessageBoxSync({
          type: 'question',
          message: `Quit ${PRODUCT_NAME}?`,
          detail: `${live} agent session${s} on this computer will stop. They pick up where they left off next time you open ${PRODUCT_NAME}.`,
          buttons: ['Quit', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        })]
  if (answer === 2) {
    raiseHatch()
    return e.preventDefault()
  }
  quitting = true
  if (answer === 1) crew.stop()
  else crew.detach()
})

// A Mac's friendly name ("Studio", "Ann's MacBook Pro"); a PC's is its device name (Settings > System > About).
const computerName = () => {
  if (!MAC) return os.hostname()
  try {
    return execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim()
  } catch {
    return os.hostname()
  }
}

// A computer that shares its agents shouldn't doze off while others (or your phone) use them.
function keepAwake() {
  const on = Boolean(crew.sharing) || [...crew.links.values()].some((l) => l.peer) || crew.phones.live.size > 0
  if (on && awake === null) awake = powerSaveBlocker.start('prevent-app-suspension')
  if (!on && awake !== null) powerSaveBlocker.stop(awake), (awake = null)
}

// ---- windows ---------------------------------------------------------------

// A window for one of the pages in ui/. The page hears which computer this is from preload.cjs, and your home folder and
// whether Crew runs from source from here. One whose page crashed loads it again.
function page(file, options, query) {
  const args = [`--crew-home=${os.homedir()}`, ...(app.isPackaged ? [] : ['--crew-dev'])]
  const win = new BrowserWindow({ show: false, ...options, webPreferences: { preload: path.join(dir, 'preload.cjs'), additionalArguments: args } })
  win.loadFile(path.join(dir, 'ui', file), { query })
  win.webContents.on('will-navigate', (e) => e.preventDefault()) // a file dropped outside a drop zone must not replace the page
  win.webContents.on('render-process-gone', (_e, { reason }) => {
    if (reason === 'clean-exit' || quitting) return
    logLine('page', `${file} ${reason}`)
    setTimeout(() => win.isDestroyed() || win.webContents.reload(), 500)
  })
  windowKeys(win, { zoom: file === 'dashboard.html' })
  return win
}

// The popover and the floating chat are hidden, never closed (⌘W, Alt+F4), until Crew quits, or Windows shuts down
// or signs you out (no before-quit then).
function keepOpen(win) {
  win.on('close', (e) => quitting || (e.preventDefault(), win.hide()))
  win.on('session-end', () => (quitting = true))
}

// The menu bar icon (a Mac) or the notification area's (Windows). On a Mac it's a template image the menu bar tints, with
// "2/5" beside it as its title. Windows has no title there: the icon is drawn by the popover's page with the count on it
// (drawTrayIcon), so it starts as the app icon until that page has loaded: on Windows the .ico, left unresized so Windows
// takes its frame for the screen's scale (16px at 100%, up to 32px at 200%).
function createTray() {
  tray = new Tray(MAC ? nativeImage.createFromPath(path.join(dir, 'assets', 'trayTemplate.png')) : WINDOWS ? nativeImage.createFromPath(WIN_ICON) : nativeImage.createFromPath(path.join(dir, 'assets', 'icon.png')).resize({ width: 32, height: 32 }))
  tray.setToolTip(PRODUCT_NAME)
  trayWin = page('tray.html', {
    width: TRAY_WIDTH, height: 320, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
    ...(MAC ? { vibrancy: 'popover', visualEffectState: 'active', backgroundColor: '#00000000' } : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1f' : '#f9f9fb' }),
  })
  keepOpen(trayWin)
  if (MAC) trayWin.setAlwaysOnTop(true, 'pop-up-menu') // a menu, over the chat docked in the hatch
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
  placeTray()
  trayWin.show()
  trayWin.focus() // Windows: without focus it never blurs, so a click elsewhere wouldn't close it
}

// The popover opens at the icon, inside the screen's work area: under the menu bar on a Mac, and on Windows out of the
// taskbar, whichever edge it's on (an icon in the overflow flyout or on a taskbar that hides itself sits inside the work
// area: the popover goes above or below it). Again after it changes size, so one out of a bottom taskbar keeps its
// bottom edge.
function placeTray() {
  const b = tray.getBounds()
  const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2]
  const wa = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }).workArea
  const [w, h] = trayWin.getSize()
  const within = (v, size, lo, length) => Math.round(Math.min(Math.max(v, lo + 8), Math.max(lo + 8, lo + length - size - 8)))
  const x = cx < wa.x ? wa.x + 8 : cx >= wa.x + wa.width ? wa.x + wa.width - w - 8 : within(cx - w / 2, w, wa.x, wa.width)
  const y = cy < wa.y ? wa.y + 6
    : cy >= wa.y + wa.height ? wa.y + wa.height - h - 8
      : cx < wa.x || cx >= wa.x + wa.width ? within(cy - h / 2, h, wa.y, wa.height)
        : cy > wa.y + wa.height / 2 ? within(b.y - h - 8, h, wa.y, wa.height) : within(b.y + b.height + 8, h, wa.y, wa.height)
  trayWin.setPosition(x, y)
}

// Windows: the notification area's icon with how many need you (amber) or work (green), and the dashboard's taskbar button
// with an amber badge while anyone needs you. Drawn by the popover's page (ui/tray.js), a change at a time.
const TRAY_SIZES = [16, 20, 24, 32]
let trayDrawn = ''
let trayTip = ''
let trayDraws = 0
let needsBadge = null // [image, words] for the taskbar button, or null
async function drawTrayIcon(counts) {
  const { waiting, working, on } = counts
  const tone = waiting ? 'need' : working ? 'work' : ''
  const next = `${tone}:${waiting || working}`
  const tip = waiting ? `${PRODUCT_NAME} · ${waiting} need${waiting > 1 ? '' : 's'} you` : working ? `${PRODUCT_NAME} · ${working} of ${on} at work` : PRODUCT_NAME
  if (tip !== trayTip) tray.setToolTip((trayTip = tip))
  if (next === trayDrawn) return
  trayDrawn = next
  const draw = ++trayDraws
  const wc = trayWin.webContents
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r))
  const [urls, badge] = await Promise.all([
    wc.executeJavaScript(`window.crewTrayIcon(${JSON.stringify({ count: waiting || working, tone })}, ${JSON.stringify(TRAY_SIZES)})`),
    waiting ? wc.executeJavaScript(`window.crewBadge(${waiting})`) : null,
  ])
  if (draw !== trayDraws || tray.isDestroyed()) return
  const image = nativeImage.createEmpty()
  TRAY_SIZES.forEach((px, i) => image.addRepresentation({ scaleFactor: px / 16, dataURL: urls[i] }))
  tray.setImage(image)
  needsBadge = badge ? [nativeImage.createFromDataURL(badge).resize({ width: 16, height: 16 }), `${waiting} need${waiting > 1 ? '' : 's'} you`] : null
  showNeedsBadge()
}
const showNeedsBadge = () => WINDOWS && dash && !dash.isDestroyed() && dash.setOverlayIcon(needsBadge?.[0] ?? null, needsBadge?.[1] ?? '')

function createOverlay() {
  overlay = page('overlay.html', {
    width: 78, height: 140, frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true,
    fullscreenable: false, minimizable: false, maximizable: false, alwaysOnTop: true,
    acceptFirstMouse: true, // the first press on the pill drags it (or opens the chat), even from another app
    enableLargerThanScreen: true, // or macOS pushes it back below the menu bar, out of the hatch
  })
  keepOpen(overlay)
  overlay.setAlwaysOnTop(true, 'floating')
  if (MAC) overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) // on every Space, and over full-screen apps
  const wa = screen.getPrimaryDisplay().workArea
  overlay.setPosition(wa.x + wa.width - 78, Math.round(wa.y + wa.height / 2 - 70))
  // Its chat opens on the side of the pill away from the part of the screen it's in, and it can be dragged
  // anywhere (core/pill.js), the hatch included (a Mac's: the notch at the top of the screen), where it stays next time.
  pill = pillWindow(overlay, screen, {
    hatch: MAC ? hatchAt : () => null,
    onDock: (at) => {
      crew.config.data.pillInHatch = at ?? false
      saveConfig()
    },
  })
  const at = crew.config.data.pillInHatch
  if (at) pill.dock(Number.isFinite(at.x) && Number.isFinite(at.y) ? at : null)
  overlay.webContents.on('did-finish-load', () => {
    pill.cancelDrag() // a reload mid-drag never says "let go"
    overlay.webContents.send('place', pill.place)
  })
  overlay.on('hide', () => pill.cancelDrag())
  // a display came or went, or the Dock or menu bar moved: bring the pill back on screen and re-pick the side
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, async () => {
      if (MAC) notches = (await readNotches()) ?? notches // a new scale, or a laptop opened: the notch moved in points
      pill.resettle()
      if (permWin) placePermissions(permWin.getBounds())
    })
  }
  overlay.once('ready-to-show', () => dashOnScreen() || overlay.showInactive())
}

// The hatch on the screen at a point; no point: the one with a notch if there is one, else the main screen's.
function hatchAt(point) {
  const display = point ? screen.getDisplayNearestPoint(point) : screen.getAllDisplays().find((d) => hatchOn(d, notches).real) ?? screen.getPrimaryDisplay()
  return hatchOn(display, notches)
}

// Over the menu bar is also over dialogs: a macOS alert is a window at a lower level than the hatch (measured: 8 against
// 25), right where the chat and the flow hang, so anything that puts one up lowers them while it's there. Lowered, the top
// of them goes under the menu bar for a moment.
function hatchLevel(level) {
  if (pill?.docked) overlay.setAlwaysOnTop(true, level)
  permWin?.setAlwaysOnTop(true, level)
}
const lowerHatch = () => hatchLevel('floating')
const raiseHatch = () => hatchLevel('status')
// macOS's question about the microphone is one of those, whether the flow or the chat's mic button asks.
const asksMacOS = {
  getMediaAccessStatus: (media) => systemPreferences.getMediaAccessStatus(media),
  askForMediaAccess: async (media) => {
    lowerHatch()
    try {
      return await systemPreferences.askForMediaAccess(media)
    } finally {
      raiseHatch()
    }
  },
}

// For a setting nobody's waiting on: a config.json that can't be written says so itself (core/config.js).
function saveConfig() {
  try {
    crew.config.save()
  } catch (e) {
    logLine('config', e.message)
  }
}

// ---- the permissions flow (core/permissions.js, ui/permissions.js) ---------------------------------------------

function newPermissions() {
  let info = null
  try {
    info = fs.readFileSync(path.join(process.resourcesPath, '..', 'Info.plist'), 'utf8')
  } catch {}
  return new Permissions({
    systemPreferences: asksMacOS,
    openUrl: (url) => shell.openExternal(url),
    notify: () => new Notification({ title: PRODUCT_NAME, body: 'Like this, when one of your agents needs you.' }).show(),
    bundleId: bundleIdIn(info, APP_ID),
    answers: () => (crew.config.data.permissions ??= {}),
    save: saveConfig,
  })
}

const hangingFromHatch = ({ width, height }) => {
  const h = hatchAt(permPoint)
  return { x: Math.round(h.x + h.width / 2 - width / 2), y: h.y, width, height }
}
const placePermissions = (size) => permWin.setBounds(hangingFromHatch(size))

// Comes out of the hatch, above everything including the menu bar, on every Space and over full-screen apps; it asks
// one thing at a time and goes away by itself. all: from the ⋯ menu, what you said not now to as well.
function openPermissions({ all = false, then = null } = {}) {
  if (permWin) return permWin.showInactive()
  afterPermissions = then
  permPoint = screen.getCursorScreenPoint() // the screen you're at, which may not be the one with the notch
  permWin = page('permissions.html', {
    ...hangingFromHatch({ width: 456, height: 200 }), frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true,
    fullscreenable: false, minimizable: false, maximizable: false, alwaysOnTop: true,
    acceptFirstMouse: true, // the first press works from another app, System Settings above all
    enableLargerThanScreen: true, // or macOS pushes it back below the menu bar, out of the hatch
  }, all ? { all: '1' } : {})
  permWin.setAlwaysOnTop(true, 'status')
  permWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  permWin.once('ready-to-show', () => permWin.showInactive())
  permWin.on('closed', () => {
    permWin = null
    const next = afterPermissions
    afterPermissions = null
    if (!quitting && !overlay.isDestroyed()) next?.()
  })
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161719' : '#f3f3f6', title: PRODUCT_NAME,
    // a Mac's traffic lights sit in the page's titlebar; Windows draws its window buttons over the titlebar's right end
    ...(MAC ? { titleBarStyle: 'hiddenInset' } : { titleBarStyle: 'hidden', titleBarOverlay: captionColors(), icon: WINDOWS ? WIN_ICON : path.join(dir, 'assets', 'icon.png') }),
  }, { focus })
  dash.once('ready-to-show', () => (dash.show(), showNeedsBadge()))
  dash.on('show', () => overlay.hide())
  dash.on('restore', () => overlay.hide())
  dash.on('minimize', showChat)
  dash.on('hide', showChat)
  // A pairing code lives only while the dashboard's pairing view shows it: closing, reloading or losing the page ends
  // it, and one that page asked for isn't made. (did-navigate, not did-start-navigation: that one also fires for a
  // navigation will-navigate then stops.)
  const endPairing = () => {
    dashPage++
    crew.phones.endCode()
  }
  dash.webContents.on('did-navigate', endPairing)
  dash.webContents.on('render-process-gone', endPairing)
  dash.on('closed', () => {
    dash = null
    endPairing()
    app.dock?.hide()
    showChat()
  })
}

// Windows' window buttons over the dashboard's titlebar, in the titlebar's colors (--bg and --fg in ui/common.css); 45px
// tall, so the line under the titlebar shows under them too.
// the window buttons sit over the top of what's open, on its surface (ui/common.css --surface)
const captionColors = () => ({ height: 45, ...(nativeTheme.shouldUseDarkColors ? { color: '#1E1E1E', symbolColor: '#f2f2f4' } : { color: '#FFFFFF', symbolColor: '#1d1d1f' }) })

// `npm run dev` runs Electron's generic app, so give the Dock our icon each time it appears (CLIque.app has it built in).
function showDock() {
  Promise.resolve(app.dock?.show()).then(() => app.isPackaged || app.dock?.setIcon(path.join(dir, 'assets', 'icon.png')))
}

// ---- wiring ------------------------------------------------------------------

// Every action the UI can take: crew.call('<name>', ...args). Agents are addressed by the name the UI shows,
// so an agent on another computer (iris@workstation) is handled there. What the UI does lands in the workspace on screen.
const actions = {
  state: () => withSetup(crew.snapshot(), crew.config.data, setup.status),
  // The permissions flow: permissions('list', all) what's missing and the hatch to fit, 'look' / 'ask' / 'open' / 'skip'
  // one of them, 'done' puts it away. openPermissions: "Permissions…" in the ⋯ menu.
  permissions: async (op, arg) => {
    if (!permissions) throw new Error('Only a Mac asks for these.')
    if (op === 'list') {
      const h = hatchAt(permPoint)
      return { missing: await permissions.missing({ all: Boolean(arg) }), hatch: { width: h.width, height: h.height } }
    }
    if (op === 'done') return void permWin?.close()
    // Allow may put up macOS's question, which stays until it's answered and can't be seen coming down: the flow stays
    // lowered until it moves on
    if (op === 'raise') return void raiseHatch()
    if (op === 'ask') lowerHatch()
    if (!['look', 'ask', 'open', 'skip'].includes(op)) throw new Error(`No such step: ${op}`)
    return permissions[op](arg)
  },
  openPermissions: () => openPermissions({ all: true }),
  // The first-run screen and Add provider… (ui/setup.js): setup('check') looks again, setup('provider', id) says what
  // GLM or Ollama needs, setup('add' | 'remove', id) offers it in the model picker or stops.
  setup: async (op, id) => {
    const ops = {
      check: async () => {
        if (await setup.refresh()) crew.config.load() // a key set since Crew started: providers say so
        const status = await setup.check({ again: true })
        crew.changed()
        return status
      },
      provider: () => checkProvider(id),
      add: () => addProvider(crew.config, id),
      remove: () => removeProvider(crew.config, id),
    }
    if (!Object.hasOwn(ops, op)) throw new Error(`unknown setup action "${op}"`)
    return ops[op]()
  },
  // The switcher and the workspace sheet: workspace('switch', 'storefront'), workspace('create', null, { name, … }), and
  // edit, open, park, remove, members (see Crew.workspaceAction). -> { id, state }
  workspace: (op, id, arg) => crew.workspaceAction(op, id, arg),
  // The workspace's channels: channel('create', null, { name, brief, members }), channel('edit', id, patch),
  // channel('remove', id) (see Crew.channelAction). -> { id, state }
  channel: (op, id, arg, ws) => crew.channelAction(op, id, arg, ws),
  send: (to, text, images, opts) => crew.send(to, text, images, opts),
  // A new conversation for an agent (after its current task, if it's busy).
  freshStart: (name) => crew.at(name, 'freshStart'),
  // The Tasks board: task('file', null, { text, images, kind }), task('dispatch', '12'), task('accept', '12@laptop')…
  task: (op, key, arg) => crew.ticket(op, key, arg),
  taskSettings: (patch) => crew.here.setTaskSettings(patch),
  saveImage: (name, type, bytes) => crew.here.saveImage(name, type, bytes), // here; sent along when it goes elsewhere
  approve: (id) => crew.feedAction(id, 'approve'),
  drop: (id) => crew.feedAction(id, 'drop'),
  // Answer an agent's question (a permission prompt, AskUserQuestion, a plan) from the chat; see hub.ask.
  answer: (id, reply) => crew.feedAction(id, 'answer', [reply]),
  autopilot: (on) => crew.here.setAutopilot(on),
  // The token savers (core/savers.js): savers({ coldStart: false }) turns one off.
  savers: (patch) => crew.setSavers(patch),
  // What agents may change in CLIque with `crew app` (core/tools.js): tools('off' | 'ask' | 'auto').
  tools: (mode) => crew.setTools(mode),
  // You've seen agents' replies up to then: { name: ts }. Unread badges count what's newer.
  read: (seen, ws) => (crew.hubs.get(ws) ?? crew.here).read(seen),
  update: (names, patch) => crew.update(names, patch),
  draftPrompt: (agent) => crew.draftPrompt(agent),
  addAgent: (fields) => crew.addAgent(fields),
  // everywhere: one of your shared agents, out of every workspace and off your roster
  removeAgent: (name, opts) => crew.at(name, 'removeAgent', [opts]),
  restart: (name) => crew.at(name, 'restart'),
  markIdle: (name) => crew.at(name, 'markIdle'),
  dismiss: (name) => crew.at(name, 'dismiss'), // send a clone away
  resize: (name, cols, rows) => crew.at(name, 'resize', [cols, rows]),
  buffer: (name) => crew.at(name, 'buffer'),

  // Agent packs: a .crew file with the agents' definitions, looks and reference images.
  exportAgents: async (names) => {
    names = [].concat(names)
    const { canceled, filePath } = await dialog.showSaveDialog(dash, {
      title: 'Export agents',
      defaultPath: path.join(app.getPath('downloads'), `${names.length === 1 ? names[0].split('@')[0] : 'crew'}.crew`),
      filters: [{ name: `${PRODUCT_NAME} agents`, extensions: ['crew'] }],
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
      const file = (await dialog.showOpenDialog(dash, { title: 'Import agents', properties: ['openFile'], filters: [{ name: `${PRODUCT_NAME} agents`, extensions: ['crew', 'json'] }] })).filePaths[0]
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
      // nearby (core/discover.js): on while Computers is open; pair asks one found nearby, pairAnswer says yes or no to
      // one asking, pairDone puts a finished one away
      discover: (on) => crew.discover(on),
      pair: (id) => crew.pairWith(id),
      pairConfirm: () => crew.pairConfirm(),
      pairCancel: () => crew.pairCancel(),
      pairAnswer: (id, yes) => crew.pairAnswer(id, yes),
      pairDone: () => crew.pairDone(),
      code: () => crew.linkCode(),
      // macOS's Privacy & Security > Local Network, where CLIque is let onto the local network
      localNetwork: () => process.platform === 'darwin' && shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork'),
    }
    if (!Object.hasOwn(ops, op)) throw new Error(`unknown link action "${op}"`)
    const out = await ops[op](...args)
    keepAwake()
    return out
  },
  // Your phones (core/phones.js, core/remote.js): phones('code') -> { code, qr (an SVG), expires }, a code that pairs one
  // phone within ten minutes (a new one ends it, as does phones('cancel')). The dashboard's pairing view asks for a new
  // one before each runs out, for as long as it's open. phones('revoke', id) unpairs one.
  phones: async (op, id) => {
    const ops = {
      code: () => {
        const page = dashPage
        return (phoneCodes = phoneCodes.catch(() => {}).then(() => phoneCode(page)))
      },
      cancel: () => crew.phones.endCode(),
      revoke: () => crew.phones.revoke(id),
    }
    if (!Object.hasOwn(ops, op)) throw new Error(`unknown phones action "${op}"`)
    return ops[op]()
  },

  openFile: (file) => [ATTACHMENTS, CACHE].some((d) => String(file).startsWith(d + path.sep)) && shell.openPath(file),
  openUrl: (url) => /^https?:\/\//.test(url) && shell.openExternal(url),
  copy: (text) => clipboard.writeText(String(text)),
  // What went wrong on a page, for Crew's log (the page tells you in words).
  log: (text) => logLine('page', String(text).slice(0, 4000)),
  theme: (theme) => crew.setTheme(theme),
  dashboard: (focus) => {
    trayWin.hide()
    openDashboard(focus)
  },
  // Running from source: config.json in your text editor (on a Mac the default app for .json is often Xcode or a
  // browser; on Windows Notepad when nothing is set for .json).
  ...(!app.isPackaged && {
    config: () => {
      trayWin.hide()
      if (MAC) return void execFile('open', ['-t', CONFIG])
      shell.openPath(CONFIG).then((failed) => failed && execFile('notepad.exe', [CONFIG]))
    },
  }),
  pickFolder: async (home) => {
    if (home) throw new Error(`Folders are on ${crew.links.get(home)?.name ?? home}: type the path`)
    return (await dialog.showOpenDialog(dash, { properties: ['openDirectory', 'createDirectory'] })).filePaths[0]
  },
  quit: () => app.quit(),
}

// A new pairing code for the dashboard's page that asked -> { code, qr, expires }, made once this computer's addresses are
// known (which can take a moment: Tailscale is asked), unless that page has closed or reloaded since.
async function phoneCode(page) {
  const hosts = (await addresses()).map((h) => h.address)
  if (page !== dashPage) throw new Error('the dashboard closed')
  const made = crew.phones.code({ name: crew.me.name, hosts, port: remote.port })
  await remote.sync() // listening before the phone tries
  if (crew.phones.error) {
    crew.phones.endCode()
    throw new Error(crew.phones.error)
  }
  return { ...made, qr: qrSvg(made.code) }
}

// A pairing code as a QR code: black on white, one unit a module, each row's runs of dark modules one rectangle (no
// seams between neighbours). The quiet zone cameras need is the white card the pairing view puts it on, which also sizes
// it to whole screen pixels.
function qrSvg(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.isDark(y, x)) continue
      let run = 1
      while (x + run < n && qr.isDark(y, x + run)) run++
      d += `M${x} ${y}h${run}v1h-${run}z`
      x += run
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}

function wire() {
  // An error goes back as its message, which Crew's own errors write for you to read ("Workstation is unreachable
  // right now"). Anything else (a bug, a file system error) is logged with its stack too.
  ipcMain.handle('call', async (_e, name, ...args) => {
    try {
      if (!Object.hasOwn(actions, name)) {
        logLine('action', `a page asked for "${name}", which this Crew doesn't have`)
        return { error: `${PRODUCT_NAME} can't do that right now. Quit ${PRODUCT_NAME} and open it again, then try once more.` }
      }
      return { ok: await actions[name](...args) }
    } catch (e) {
      if (!(e instanceof Error) || e.constructor !== Error || e.code) logLine('action', `${name}: ${e?.stack ?? e}`)
      return { error: e?.message ?? String(e) }
    }
  })
  // Dragging the pill (or the chat by its header): the page reports the pointer, letting go settles it.
  ipcMain.on('drag', (e, phase, x, y) => BrowserWindow.fromWebContents(e.sender) === overlay && pill.drag(phase, x, y))
  ipcMain.on('input', (_e, name, data) => crew.input(name, data))
  // Full Disk Access takes the app as a dragged file: an .app dropped on its list adds it.
  ipcMain.on('drag-app', (e) => {
    const file = appBundle(app.getPath('exe'))
    if (file) e.sender.startDrag({ file, icon: nativeImage.createFromPath(path.join(dir, 'assets', 'icon.png')).resize({ width: 48, height: 48 }) })
  })

  // Windows size themselves to their content; the overlay is placed so its pill stays put (core/pill.js).
  // (The menu bar popover asks on every state push; it's resized only when that changes its size.)
  ipcMain.on('fit', (e, width, height, focus, inside) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win && win === permWin) return placePermissions({ width, height }) // however tall what it's asking is
    if (win !== overlay) {
      if (!win) return
      const size = [width, Math.min(height, screen.getDisplayMatching(win.getBounds()).workArea.height - 20)]
      const [w, h] = win.getContentSize()
      if (w === size[0] && h === size[1]) return
      win.setContentSize(...size)
      if (win === trayWin && trayWin.isVisible()) placeTray()
      return
    }
    pill.fit(width, height, inside)
    if (focus) {
      app.focus({ steal: true })
      overlay.focus()
    }
  })

  crew.on('pty', (name, data) => dash?.webContents.send('pty', name, data))

  // The menu bar's title redraws the status item, so it's set only when it reads differently. Windows: the icon.
  let title = null
  crew.on('state', (snapshot) => {
    const state = withSetup(snapshot, crew.config.data, setup.status)
    if (nativeTheme.themeSource !== state.theme) nativeTheme.themeSource = state.theme
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('state', state)
    const counts = trayCounts(state)
    if (!MAC) drawTrayIcon(counts).catch((e) => logLine('tray', e?.stack ?? String(e)))
    else if (trayTitle(counts) !== title) tray.setTitle((title = trayTitle(counts)), { fontType: 'monospacedDigit' })
    keepAwake()
  })
  crew.changed()
  // the theme changed (Crew's, or the system's while Crew follows it): Windows' window buttons follow the titlebar
  nativeTheme.on('updated', () => !MAC && dash && !dash.isDestroyed() && dash.setTitleBarOverlay(captionColors()))

  // From any workspace: with workspaces, the title says which, and a click puts that one on screen first.
  // (your accounts' limits are no workspace's)
  const from = (ws) => (ws && crew.hubs.size > 1 ? `${crew.hubs.get(ws)?.space.name ?? ws} · ` : '')
  const goTo = (ws, focus) => {
    if (ws && ws !== crew.current && crew.hubs.has(ws)) crew.workspaceAction('switch', ws)
    openDashboard(focus)
  }
  crew.on('alert', (name, text, ws) => {
    const note = new Notification({ title: `${from(ws)}${name.replace(/\.(\d+)(?=@|$)/, ' (clone $1)')} needs you`, body: text })
    note.on('click', () => goTo(ws, name))
    note.show()
  })

  // e.g. "@ada fixed #12": click to check it in the Bugs lane
  crew.on('notice', ({ title, body, focus, workspace }) => {
    const note = new Notification({ title: `${from(workspace)}${title}`, body })
    note.on('click', () => goTo(workspace, focus))
    note.show()
  })
}

// Voice input (core/voice.js): the chat's mic button, plus a hotkey that opens the chat and starts listening.
// Dictation runs on this computer: it only fills in your message, wherever the agent you send it to lives.
function wireVoice() {
  // Older macOS asks for speech-recognition permission, which needs the app's Info.plist to say why (CLIque.app does).
  const plist = path.join(process.resourcesPath, '..', 'Info.plist')
  const mayAskPermission = process.platform === 'darwin' && fs.existsSync(plist) && fs.readFileSync(plist, 'utf8').includes('NSSpeechRecognitionUsageDescription')
  // An installed Crew carries the helper in Resources/voice; from source (npm start, npm run dev) it's built here.
  const shipped = path.join(process.resourcesPath, 'voice', process.platform === 'win32' ? 'crew-voice.exe' : 'crew-voice')
  const voice = new Voice({ root: dir, binary: fs.existsSync(shipped) ? shipped : undefined, mayAskPermission })
  const send = (event) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('voice', event))
  Object.assign(actions, voiceActions({ voice, systemPreferences: MAC ? asksMacOS : systemPreferences, shell, send }))
  const audio = voiceAudio(voice)
  ipcMain.on('voice-audio', (e, id, samples) => audio(e.sender, id, samples))
  app.on('will-quit', () => voice.cancel())

  const key = crew.config.data.voiceHotkey ?? 'Alt+Shift+D'
  const dictate = () => {
    if (dashOnScreen()) {
      dash.focus()
      return dash.webContents.send('voice', { type: 'toggle' })
    }
    overlay.showInactive()
    overlay.webContents.send('toggle', { open: true, focus: true })
    overlay.webContents.send('voice', { type: 'toggle' })
  }
  if (key && !globalShortcut.register(key, dictate)) crew.say(shortcutTaken(key, 'starts dictation', "click the microphone in the chat's message box"))
}

// How many need you, are at work, and are on; one counts as working while it or any of its clones is. With workspaces,
// every open one counts.
function trayCounts(state) {
  if (state.workspaces?.length > 1) {
    const sum = (k) => state.workspaces.reduce((n, w) => n + (w.parked ? 0 : w[k]), 0)
    return { waiting: sum('waiting'), working: sum('working'), on: sum('on') }
  }
  const on = state.agents.filter((a) => a.on)
  const agents = on.filter((a) => !a.cloneOf)
  const waiting = on.filter((a) => a.status === 'waiting').length
  const working = agents.filter((a) => [a, ...on.filter((c) => c.cloneOf === a.name)].some((x) => x.status === 'working')).length
  return { waiting, working, on: agents.length }
}
// The menu bar's "2/5" (at work out of those on), or "1 needs you".
const trayTitle = ({ waiting, working, on }) => (waiting ? ` ${waiting} need${waiting > 1 ? '' : 's'} you` : working ? ` ${working}/${on}` : '')

// Crew's log (LOG): what went wrong that nobody saw, a crash in here or a page's error. Kept under LOG_MAX: past that it
// starts again, the last one kept as crew.old.log.
function logLine(kind, text) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    if ((fs.statSync(LOG, { throwIfNoEntry: false })?.size ?? 0) > LOG_MAX) fs.renameSync(LOG, LOG.replace(/\.log$/, '.old.log'))
    fs.appendFileSync(LOG, `${new Date().toISOString()} [${kind}] ${text}\n`)
  } catch {}
  if (!app.isPackaged) console.error(`[${kind}]`, text)
}

// Apps opened from Finder get a bare PATH; borrow the login shell's environment so `claude` and friends resolve.
// Windows apps get the user's environment as it is, so there's nothing to borrow.
function loadShellEnv() {
  if (WINDOWS) return
  if (process.env.TERM_PROGRAM) return // launched from a terminal, env is already right
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "\\n__CREW__\\n"; env -0'], { encoding: 'utf8', timeout: 8000 })
    for (const pair of out.split('\n__CREW__\n')[1].split('\0')) {
      const i = pair.indexOf('=')
      if (i > 0 && (pair.startsWith('PATH=') || !(pair.slice(0, i) in process.env))) process.env[pair.slice(0, i)] = pair.slice(i + 1)
    }
  } catch {}
}

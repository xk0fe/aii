// Does everything you can do with a file in the chat work? Every action on a recording's player (in a message, in the
// viewer, on the whole screen), on pictures, pages and plain files, and all of it again for files that are on a linked
// computer and come here a piece at a time (core/linkfiles.js). Run:
//   npm run probe:files [-- --only=player,viewer,... --shots=<folder>]
// A hidden window shows the real dashboard (ui/dashboard.html) with the made-up clique the screenshots use
// (scripts/screenshot-preload.cjs), and real files made here: recordings (ffmpeg), pictures, a page, a log. The mouse and
// the keyboard are real input events. The "linked computer" is a folder of its own behind the real LinkFiles and the
// real clique-file:// scheme, with a made-up connection that takes a moment per piece and can go away.
// Each line says what was tried and whether it held; it ends with 0 when all of it did, 1 otherwise. Nothing of yours is
// touched: its files are in a temporary folder. (Full screen stays inside the hidden window: nothing takes your screen.)
import { app, BrowserWindow, nativeTheme, protocol, ipcMain } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveSandbox, lockFrames } from '../core/sandbox.js'
import { LinkFiles, serveFiles, readPiece, whyOf, FILES_SCHEME, PIECE } from '../core/linkfiles.js'
import { check as checkFiles, store, probe } from '../core/attachments.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clique-files-')))
app.setPath('userData', path.join(tmp, 'userdata'))
protocol.registerSchemesAsPrivileged([FILES_SCHEME])
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const ONLY = arg('only')?.split(',')
const SHOTS = arg('shots') && path.resolve(arg('shots'))
const THEME = arg('theme') ?? 'light'
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
let passed = 0
const ok = (cond, what, how = '') => {
  cond ? passed++ : failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${how !== '' && (!cond || process.argv.includes('--verbose')) ? `: ${typeof how === 'string' ? how : JSON.stringify(how)}` : ''}`)
  return cond
}
const near = (a, b, by = 0.6) => Math.abs(a - b) <= by

// ---- the files -------------------------------------------------------------------------------------------------------

const src = path.join(tmp, 'src')
const here = path.join(tmp, 'attachments') // this computer's
const host = path.join(tmp, 'workstation') // the linked computer's
const cache = path.join(tmp, 'cache')
for (const d of [src, host, cache]) fs.mkdirSync(d, { recursive: true })
const ff = (dir, name, args) => (execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path.join(dir, name)]), name)
const bars = (size, seconds) => ['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`, '-t', String(seconds)]
const tone = (seconds) => ['-f', 'lavfi', '-i', 'sine=frequency=330', '-t', String(seconds)]
const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30']
const svgShot = (w, h, fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#fff"/></svg>`
const PAGE = '<!doctype html><title>Demo</title><body style="font:16px system-ui;margin:24px"><h1 id="h">Still</h1><button id="b">Count</button><script>document.getElementById("h").textContent = "Running"; let n = 0; document.getElementById("b").onclick = () => (document.getElementById("h").textContent = "Count " + ++n)</script></body>'

ff(src, 'checkout-run.mp4', [...bars('1280x720', 48), ...tone(48), ...h264, '-b:v', '900k', '-c:a', 'aac', '-movflags', '+faststart'])
ff(src, 'phone-flow.mp4', [...bars('720x1280', 12), ...h264, '-b:v', '700k'])
ff(src, 'short.mp4', [...bars('640x360', 3), ...h264])
ff(src, 'old-codec.mp4', [...bars('320x240', 2), '-c:v', 'mpeg2video']) // a real recording Chromium has no decoder for
for (const [name, text] of [['wide.svg', svgShot(1280, 800, '#CC2277')], ['a.svg', svgShot(390, 844, '#2F7D5B')], ['b.svg', svgShot(390, 844, '#3B6FD9')], ['c.svg', svgShot(390, 844, '#B4691E')], ['demo.html', PAGE], ['tests.log', 'ok 1\nok 2\n# pass 2\n']]) fs.writeFileSync(path.join(src, name), text)
const kept = async (...names) => store(checkFiles(names, src), here)
const [wide, tall, short, oldCodec, picWide, picA, picB, picC, page, log] = await kept('checkout-run.mp4', 'phone-flow.mp4', 'short.mp4', 'old-codec.mp4', 'wide.svg', 'a.svg', 'b.svg', 'c.svg', 'demo.html', 'tests.log')
oldCodec.kind = 'video' // (as one attached by a CLIque that took it for one: the player has to say it can't)
const missing = { ...short, path: path.join(here, '2026-11-16-00000000-gone.mp4'), name: 'gone.mp4' }

// the linked computer's: a recording whose index is at its end (most tools write it so), a picture, a page, a document
ff(host, 'windows-run.mp4', [...bars('1280x720', 40), ...tone(40), ...h264, '-b:v', '2400k', '-c:a', 'aac'])
fs.writeFileSync(path.join(host, 'shot.svg'), svgShot(1280, 800, '#3B6FD9'))
fs.writeFileSync(path.join(host, 'demo.html'), PAGE)
fs.writeFileSync(path.join(host, 'notes.pdf'), Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * PIECE + 1234, 7)]))
fs.writeFileSync(path.join(host, 'later.svg'), svgShot(800, 600, '#2F7D5B'))
// ...and ones nothing fetches before that computer goes away
for (const [from, to] of [['windows-run.mp4', 'night-run.mp4'], ['notes.pdf', 'night-notes.pdf'], ['windows-run.mp4', 'old-run.mp4'], ['shot.svg', 'old-shot.svg']]) fs.copyFileSync(path.join(host, from), path.join(host, to))

// ---- the linked computer -------------------------------------------------------------------------------------------

const link = { online: true, old: false, wait: 25, asked: [] }
const peer = {
  call: async (name, [file, start, length]) => {
    await sleep(link.wait)
    if (!link.online) throw new Error('lost the connection to Workstation')
    if (name === 'readFile') {
      // (what a CLIque from before pieces says of it: Clique.serve, asked with no workspace in hand)
      if (link.old) throw new Error("Workstation runs a newer CLIque, where every workspace is its own: update this computer's to work with its agents")
      link.asked.push([path.basename(String(file)), Math.floor(start / PIECE)])
      return readPiece(host, file, start, length)
    }
    // (whole, as a CLIque from before pieces sends it: a picture or a page, never a recording: Clique.serve readImage)
    if (name === 'readImage') {
      if (/\.(mp4|mov|webm|m4v)$/i.test(file)) throw new Error('too big to send: open it on the computer it is on')
      return new Uint8Array(fs.readFileSync(file))
    }
    throw new Error(`"${name}" isn't available over CLIque Link`)
  },
}
const files = new LinkFiles({ cache, peer: () => (link.online ? peer : null), name: () => 'Workstation' })
const theirs = (name, extra = {}) => {
  const from = path.join(host, name)
  const size = fs.existsSync(from) ? fs.statSync(from).size : 1000
  return { name, ...(fs.existsSync(from) ? probe(from, size) : { kind: 'video', type: 'video/mp4' }), size, ...extra, path: files.place('workstation', from), home: 'Workstation' }
}

// ---- the window ----------------------------------------------------------------------------------------------------

const opened = [] // what the app was asked to open, show or copy: [action, file, was it all here?]
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  serveSandbox(protocol, [here, cache], (file) => (files.theirs.has(file) ? files.whole(file) : null))
  serveFiles(protocol, { dirs: [here, cache], files })
  ipcMain.handle('files', async (_e, action, file) => {
    try {
      if (action === 'fileState') return { ok: files.theirs.has(file) || !fs.existsSync(file) ? files.state(file) : { here: true, computer: null } }
      if (!fs.existsSync(file) && files.theirs.has(file)) {
        try {
          await files.whole(file)
        } catch (e) {
          throw new Error(whyOf(e) === 'away' ? "Workstation is away. This opens once it's back." : e.message)
        }
      }
      if (!fs.existsSync(file)) throw new Error("That file isn't kept any more.")
      opened.push([action, path.basename(file), fs.statSync(file).size])
      return { ok: action === 'openFile' ? 'opened' : true }
    } catch (e) {
      return { error: e.message }
    }
  })
  nativeTheme.themeSource = THEME

  const errors = []
  const open = async (file, { width, height, query = {} }) => {
    const win = new BrowserWindow({
      width, height, show: false, paintWhenInitiallyHidden: true, useContentSize: true, frame: false,
      webPreferences: { preload: path.join(root, 'scripts', 'screenshot-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false, disableHtmlFullscreenWindowResize: true },
    })
    lockFrames(win.webContents)
    // the page dying is the worst that can happen to it, and nothing after it would answer: said, and that's the end
    win.webContents.on('render-process-gone', (_e, d) => {
      console.log(`FAIL ${file} died (${d.reason}): the last thing tried killed the page\n\n${passed} held, ${failed + 1} didn't`)
      app.exit(1)
    })
    win.webContents.on('console-message', (e) => {
      // (a still page's script not running is the sandbox at work, and says so in the console)
      if (e.level === 'error' && !/Blocked script execution in 'about:srcdoc'/.test(e.message)) errors.push(`${file}: ${e.message}`)
    })
    await win.loadFile(path.join(root, 'ui', file), { query: { fixture: 'big', cache, ...query } })
    return win
  }
  const win = await open('dashboard.html', { width: 1180, height: 820 })
  const js = (code, w = win) => w.webContents.executeJavaScript(`(async () => { ${code} })()`, true)
  await js(`localStorage.clear(); localStorage.setItem('clique.place', 'chat'); localStorage.setItem('clique.target', 'auto')`)
  win.webContents.reload()
  await new Promise((r) => win.webContents.once('did-finish-load', r))
  files.on('progress', (file, have, size) => win.isDestroyed() || win.webContents.send('file', { path: file, have, size }))
  files.on('failed', (file, why, message) => {
    if (process.argv.includes('--verbose')) console.log(`     (the page asked for ${path.basename(file)} and it couldn't be had: ${why}, ${message})`)
    if (!win.isDestroyed()) win.webContents.send('file', { path: file, why, computer: files.state(file).computer })
  })
  await sleep(500)
  // what the page is asked about: its players, its boxes, what it called
  const HELPERS = `
    window.__calls = []
    const call = clique.call
    clique.call = async (action, ...args) => { window.__calls.push([action, ...args]); return call(action, ...args) }
    window.__box = (sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
    window.__vis = (sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; o *= Number(s.opacity) } return o > 0.5 && r.width > 0 && r.height > 0 }
    window.__p = (sel) => { const p = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!p) return null; const v = p.querySelector(':scope > video'); const r = p.getBoundingClientRect(); const b = v.getBoundingClientRect()
      return { cls: p.className, t: v.currentTime, paused: v.paused, ended: v.ended, rate: v.playbackRate, muted: v.muted, vol: v.volume, ready: v.readyState, dur: v.duration, err: v.error?.code ?? null, focus: document.activeElement === p, inside: p.contains(document.activeElement),
        box: { x: r.x, y: r.y, w: r.width, h: r.height }, pic: { x: b.x, y: b.y, w: b.width, h: b.height }, size: [v.videoWidth, v.videoHeight], bar: window.__vis(p.querySelector('.fxp-bar')), label: p.querySelector('.fxp-toggle').getAttribute('aria-label'), time: p.querySelector('.fxp-time').textContent, speed: p.querySelector('.fxp-rate').textContent,
        here: [...Array(v.buffered.length)].map((_, i) => [Math.round(v.buffered.start(i)), Math.round(v.buffered.end(i))]), note: p.querySelector(':scope > .fx-gone p')?.textContent ?? null, full: document.fullscreenElement === p } }
    window.__key = (key, on = document.activeElement) => on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  `
  await js(HELPERS)
  const shot = async (name, w = win) => {
    if (!SHOTS) return
    fs.writeFileSync(path.join(SHOTS, `${name}-${THEME}.png`), (await w.webContents.capturePage()).toPNG())
  }
  const say = (feed, w = win) => js(`const s = window.__cliqueState; s.feed = ${JSON.stringify(feed)}.map((e, i, all) => ({ ...e, ts: Date.now() - 60000 * (all.length - i) })); window.__cliqueEmit('state', s)`, w)
  const more = (entry, w = win) => js(`const s = window.__cliqueState; s.feed = [...s.feed, { ...${JSON.stringify(entry)}, ts: Date.now() }]; window.__cliqueEmit('state', s)`, w)
  const computer = (online) => js(`const s = window.__cliqueState; for (const l of s.computers.links) if (l.name === 'Workstation') l.online = ${online}; window.__cliqueEmit('state', s)`)
  const P = (sel, w = win) => js(`return window.__p(${JSON.stringify(sel)})`, w)
  const box = (sel, w = win) => js(`return window.__box(${JSON.stringify(sel)})`, w)
  const vis = (sel, w = win) => js(`return window.__vis(${JSON.stringify(sel)})`, w)
  const calls = (w = win) => js('const c = window.__calls; window.__calls = []; return c', w)
  const into = async (sel, w = win) => (await js(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`, w), await sleep(200))
  const mouse = (w, type, x, y, extra = {}) => w.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra })
  const move = async (x, y, w = win) => (mouse(w, 'mouseMove', x, y), await sleep(50))
  const click = async (x, y, w = win) => (await move(x, y, w), mouse(w, 'mouseDown', x, y), mouse(w, 'mouseUp', x, y), await sleep(140))
  const dblclick = async (x, y, w = win) => {
    await move(x, y, w)
    for (const n of [1, 2]) (mouse(w, 'mouseDown', x, y, { clickCount: n }), mouse(w, 'mouseUp', x, y, { clickCount: n }))
    await sleep(300)
  }
  // A point on what `sel` names, to press: scrolled into sight first if it's out of it, and really that thing there (a
  // press on something lying over it would be a press on something else, which is a finding of its own).
  const on = async (sel, w = win, at = [0.5, 0.5]) => {
    for (const again of [false, true]) {
      const b = await box(sel, w)
      if (!b || !b.w || !b.h) throw new Error(`nothing to point at: ${sel} ${b ? "isn't shown" : "isn't there"}`)
      const pt = { x: b.x + b.w * at[0], y: b.y + b.h * at[1] }
      const hit = await js(`const want = document.querySelector(${JSON.stringify(sel)}); const got = document.elementFromPoint(${pt.x}, ${pt.y}); return !got ? 'nothing (out of the window)' : want.contains(got) || got.contains(want) ? '' : got.tagName.toLowerCase() + '.' + String(got.className).split(' ').join('.')`, w)
      if (!hit) return pt
      if (again) throw new Error(`${sel} can't be pressed: at that point there is ${hit}`)
      await js(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`, w)
      await sleep(250)
    }
  }
  const tap = async (sel, w = win, at) => {
    const p = await on(sel, w, at)
    await click(p.x, p.y, w)
  }
  const away = (w = win) => move(8, 8, w) // the pointer, off whatever it was on
  const held = async (x, y, w = win) => (mouse(w, 'mouseMove', x, y, { modifiers: ['leftButtonDown'] }), await sleep(50)) // moved with the button down
  // the recording at `sel`, playing or paused, whichever it was
  const playing = async (sel, want, w = win) => {
    if ((await P(sel, w)).paused === want) await js(`const v = document.querySelector(${JSON.stringify(`${sel} > video`)}); ${want ? 'await v.play()' : 'v.pause()'}`, w)
    await sleep(150)
  }
  const key = async (keyCode, w = win, modifiers = []) => {
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    const char = keyCode.length === 1 ? keyCode : { Return: '\r', Space: ' ' }[keyCode] // (what a button is pressed by)
    if (char) w.webContents.sendInputEvent({ type: 'char', keyCode: char, modifiers })
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await sleep(140)
  }
  const keyOf = (k, w = win) => js(`window.__key(${JSON.stringify(k)})`, w) // (a key no keyboard layout is needed for: < > , .)
  const until = async (fn, ms = 6000) => {
    const end = Date.now() + ms
    for (;;) {
      const v = await fn()
      if (v || Date.now() > end) return v
      await sleep(80)
    }
  }
  const section = async (name, fn) => {
    if (ONLY && !ONLY.includes(name)) return
    console.log(`\n# ${name}`)
    try {
      // (an empty chat first: what the section before left playing isn't carried into this one)
      await say([])
      await sleep(200)
      await fn()
    } catch (e) {
      ok(false, `${name}: the probe itself broke`, e?.stack ?? String(e))
    }
    await js(`if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); document.querySelector('.fxv [data-fxv=close]')?.click(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); for (const v of document.querySelectorAll('video')) v.pause()`)
    await away()
    await sleep(200)
  }
  const MENU = '.menu:not(.hidden, .leaving)' // the menu that's open (the page keeps others of its own about, hidden)
  const VID = '.fx-video[data-live="v1:0"]'
  const PL = `${VID} .fxp`

  // ---- a recording in a message --------------------------------------------------------------------------------
  await section('player', async () => {
    await say([{ id: 'v0', kind: 'msg', from: 'you', to: 'Iris', text: 'Show me the run.' }, { id: 'v1', kind: 'reply', from: 'Iris', text: 'The checkout run from start to finish.', files: [wide] }, { id: 'v2', kind: 'reply', from: 'Theo', text: 'And the same flow on a phone.', files: [tall] }])
    await into(VID)
    const card0 = await box(VID)
    const after0 = await box('#m-v2')
    let p = await until(async () => ((await P(PL)).ready >= 2 ? P(PL) : null))
    ok(p?.ready >= 2 && p.paused && !p.cls.includes(' on'), 'before it is played: its first frame, still', p)
    ok((await vis(`${PL} .fxp-big`)) && (await vis(`${PL} .fxp-badge`)) && !p.bar, 'Play in the middle, how long it is in the corner, no bar yet')
    ok((await js(`return document.querySelector(${JSON.stringify(`${PL} .fxp-badge`)}).textContent`)) === '0:48', 'the corner says 0:48')
    ok(near(card0.w, 440, 1) && near(p.box.w / p.box.h, 16 / 9, 0.02), 'its box is 440 wide and 16:9 from the start', card0)
    await shot('player-1-still')

    await tap(`${PL} .fxp-big`)
    p = await until(async () => ((await P(PL)).t > 0.3 ? P(PL) : null))
    ok(p && !p.paused && p.cls.includes(' on') && p.cls.includes('playing'), 'a click on Play plays it', p)
    ok(p.bar && !(await vis(`${PL} .fxp-big`)) && !(await vis(`${PL} .fxp-badge`)), 'the bar is there, Play and the corner are gone')
    ok(p.focus, 'the keyboard is the player\'s')
    ok(p.label === 'Pause' && /^0:0\d \/ 0:48$/.test(p.time), 'the bar says Pause, and 0:0x / 0:48', [p.label, p.time])
    ok((await js(`return document.querySelector(${JSON.stringify(VID)}).classList.contains('on')`)), 'its card counts as live (kept through a redraw)')
    const card1 = await box(VID)
    ok(near(card1.w, card0.w, 0.5) && near(card1.h, card0.h, 0.5) && near((await box('#m-v2')).y - card1.y, after0.y - card0.y, 0.5), 'nothing moved when it started', [card0, card1])
    await shot('player-2-playing')

    // the picture: a click pauses and plays
    await tap(`${PL} > video`, win, [0.5, 0.35])
    p = await P(PL)
    ok(p.paused && p.label === 'Play', 'a click on the picture pauses', p)
    const stood = p.t
    await sleep(400)
    ok(near((await P(PL)).t, stood, 0.05), 'paused, it stays where it is')
    await tap(`${PL} > video`, win, [0.5, 0.35])
    ok(!(await P(PL)).paused, 'a click on the picture plays again')
    // the bar's own button
    await tap(`${PL} .fxp-toggle`)
    ok((await P(PL)).paused, 'the bar\'s button pauses')
    ok((await P(PL)).focus, 'after a click on a button the keyboard is still the player\'s')
    await tap(`${PL} .fxp-toggle`)
    ok(!(await P(PL)).paused, 'the bar\'s button plays')

    // keys
    await key('Space')
    ok((await P(PL)).paused, 'Space pauses')
    await key('Space')
    ok(!(await P(PL)).paused, 'Space plays')
    await key('k')
    ok((await P(PL)).paused, 'K pauses')
    let t0 = (await P(PL)).t
    await key('Right')
    p = await until(async () => (near((await P(PL)).t, t0 + 5, 0.3) ? P(PL) : null), 3000)
    ok(p, '→ goes 5 s on', [t0, (await P(PL)).t])
    ok((await js(`return document.querySelector(${JSON.stringify(`${PL} .fxp-flash`)}).textContent`)) === '+5 s', 'and says so in the middle')
    await key('Left')
    ok(await until(async () => near((await P(PL)).t, t0, 0.3), 3000), '← goes 5 s back', [t0, (await P(PL)).t])
    await key('l')
    ok(await until(async () => near((await P(PL)).t, t0 + 10, 0.3), 3000), 'L goes 10 s on')
    await key('j')
    ok(await until(async () => near((await P(PL)).t, t0, 0.3), 3000), 'J goes 10 s back')
    t0 = (await P(PL)).t
    await keyOf('.')
    ok(await until(async () => near((await P(PL)).t, t0 + 1 / 30, 0.012), 3000), '. goes one frame on', [t0, (await P(PL)).t])
    await keyOf(',')
    ok(await until(async () => near((await P(PL)).t, t0, 0.012), 3000), ', goes one frame back')
    await key('5')
    ok(await until(async () => near((await P(PL)).t, 24, 0.3), 3000), '5 goes to the middle')
    await key('Home')
    ok(await until(async () => near((await P(PL)).t, 0, 0.1), 3000), 'Home goes to the start')
    await key('Right')
    await key('Right')
    await key('Right')
    ok(await until(async () => near((await P(PL)).t, 15, 0.3), 3000), '→ three times quickly lands 15 s on (each one counts)', (await P(PL)).t)

    // speed
    await keyOf('>')
    p = await P(PL)
    ok(p.rate === 1.25 && p.speed === '1.25×', '> plays it faster, and the bar says 1.25×', [p.rate, p.speed])
    await keyOf('<')
    await keyOf('<')
    ok((await P(PL)).rate === 0.75, '< plays it slower')
    await tap(`${PL} .fxp-rate`)
    ok(await vis(`${PL} .fxp-menu`), 'a click on the speed opens its speeds')
    const menu = await box(`${PL} .fxp-menu`)
    p = await P(PL)
    ok(menu.x >= p.box.x && menu.x + menu.w <= p.box.x + p.box.w && menu.y >= p.box.y && near(p.box.w, card0.w, 0.5), 'the speeds are inside the player, which is the size it was', [menu, p.box])
    ok((await js(`return document.activeElement.textContent`)) === '0.75×', 'the one in use has the keyboard')
    await shot('player-3-speeds')
    await key('Right')
    await key('Right')
    await key('Return')
    p = await P(PL)
    ok(p.rate === 1.25 && !(await vis(`${PL} .fxp-menu`)), '→ → Enter picks 1.25× and closes them', p.rate)
    await tap(`${PL} .fxp-rate`)
    await tap(`${PL} .fxp-menu [data-rate="2"]`)
    p = await P(PL)
    ok(p.rate === 2 && p.speed === '2×' && !(await vis(`${PL} .fxp-menu`)), 'a click on 2× picks it', [p.rate, p.speed])
    await tap(`${PL} .fxp-rate`)
    await key('Escape')
    ok(!(await vis(`${PL} .fxp-menu`)) && (await P(PL)).rate === 2, 'Esc closes the speeds, changing nothing')
    await tap(`${PL} .fxp-rate`)
    await tap('.page-head[data-for=chat]', win, [0.3, 0.5])
    ok(!(await vis(`${PL} .fxp-menu`)), 'a press anywhere else closes them')
    await tap(`${PL} > video`, win, [0.5, 0.3])
    await tap(`${PL} .fxp-rate`)
    await tap(`${PL} .fxp-menu [data-rate="1"]`)

    // sound
    await key('Space')
    await sleep(300)
    await key('m')
    ok((await P(PL)).muted && (await js(`return document.querySelector(${JSON.stringify(`${PL} .fxp-mute`)}).getAttribute('aria-label')`)) === 'Unmute', 'M mutes, and the button says Unmute')
    await key('m')
    ok(!(await P(PL)).muted, 'M again brings the sound back')
    await key('Down')
    await key('Down')
    ok(near((await P(PL)).vol, 0.8, 0.01), '↓ twice: 80%', (await P(PL)).vol)
    await key('Up')
    ok(near((await P(PL)).vol, 0.9, 0.01), '↑: 90%')
    await tap(`${PL} .fxp-level`, win, [0.5, 0.5])
    ok(near((await P(PL)).vol, 0.5, 0.08), 'a click in the middle of the volume: half', (await P(PL)).vol)
    await tap(`${PL} .fxp-mute`)
    ok((await P(PL)).muted, 'the speaker button mutes')
    ok(JSON.parse(await js(`return localStorage.getItem('clique.fx.sound')`)).muted === true, 'how loud is remembered')
    await tap(`${PL} .fxp-mute`)
    await key('Up'); await key('Up'); await key('Up'); await key('Up'); await key('Up'); await key('Up')
    ok((await P(PL)).vol === 1, '↑ stops at full')

    // the track
    await playing(PL, false)
    await tap(`${PL} > video`, win, [0.5, 0.3]) // (the pointer over it, and the bar there)
    await playing(PL, false)
    await tap(`${PL} .fxp-track`, win, [0.5, 0.5])
    ok(await until(async () => near((await P(PL)).t, 24, 0.8), 3000), 'a click in the middle of the track goes to the middle', (await P(PL)).t)
    ok((await P(PL)).paused && !(await P(PL)).cls.includes('seeking'), 'and it stays paused (it was)')
    await playing(PL, true)
    const tr = await box(`${PL} .fxp-track`)
    await move(tr.x + tr.w * 0.25, tr.y + tr.h / 2)
    mouse(win, 'mouseDown', tr.x + tr.w * 0.25, tr.y + tr.h / 2)
    await sleep(120)
    ok((await P(PL)).paused, 'dragging the track holds the picture')
    for (const f of [0.35, 0.5, 0.65, 0.75]) await held(tr.x + tr.w * f, tr.y + tr.h / 2)
    await sleep(250)
    ok(near((await P(PL)).t, 36, 1), 'the picture follows the drag', (await P(PL)).t)
    ok((await js(`return document.querySelector(${JSON.stringify(`${PL} .fxp-time b`)}).textContent`)) === '0:36', 'and the time says where')
    await shot('player-4-dragging')
    mouse(win, 'mouseUp', tr.x + tr.w * 0.75, tr.y + tr.h / 2)
    p = await until(async () => (!(await P(PL)).paused ? P(PL) : null), 3000)
    ok(p && p.t >= 35.5 && !p.cls.includes('seeking'), 'let go, it plays on from there (it was playing)', p)
    await playing(PL, false)
    // dragged past its ends
    await move(tr.x + tr.w * 0.5, tr.y + tr.h / 2)
    mouse(win, 'mouseDown', tr.x + tr.w * 0.5, tr.y + tr.h / 2)
    await held(tr.x - 80, tr.y - 40)
    await sleep(200)
    ok(near((await P(PL)).t, 0, 0.1), 'dragged off its left end: the start')
    await held(tr.x + tr.w + 120, tr.y + 60)
    await sleep(250)
    ok((await P(PL)).ended || near((await P(PL)).t, 48, 0.2), 'dragged off its right end: the end', (await P(PL)).t)
    await held(tr.x + tr.w * 0.1, tr.y - 40)
    mouse(win, 'mouseUp', tr.x + tr.w * 0.1, tr.y - 40)
    await sleep(250)
    p = await P(PL)
    ok(p.paused && near(p.t, 4.8, 0.6) && !p.cls.includes('seeking'), 'let go off the track: it stays paused (it was), where it was let go', p)
    await key('Home')
    await until(async () => near((await P(PL)).t, 0, 0.1), 3000)
    await move(tr.x + tr.w * 0.5, tr.y + tr.h / 2)

    // a look at any moment
    await move(tr.x + tr.w * 0.7, tr.y + tr.h / 2)
    const tipOk = await until(async () => (await vis(`${PL} .fxp-tip`)) && (await js(`const v = document.querySelector(${JSON.stringify(`${PL} .fxp-tip video`)}); return v.readyState >= 2 && Math.abs(v.currentTime - 33.6) < 1 && document.querySelector(${JSON.stringify(`${PL} .fxp-tip`)}).classList.contains('seen')`)), 5000)
    ok(tipOk, 'the pointer on the track shows that moment, small, over it')
    ok((await js(`return document.querySelector(${JSON.stringify(`${PL} .fxp-tip b`)}).textContent`)) === '0:34', 'with its time')
    await shot('player-5-look')
    for (const f of [0.0, 1.0]) {
      await move(tr.x + (tr.w - 1) * f, tr.y + tr.h / 2)
      await sleep(120)
      const tip = await box(`${PL} .fxp-tip`)
      p = await P(PL)
      ok(tip.x >= p.box.x && tip.x + tip.w <= p.box.x + p.box.w + 0.5 && tip.y >= p.box.y, `at the track's ${f ? 'right' : 'left'} end the look stays inside the player`, [tip, p.box])
    }
    await move(tr.x + tr.w * 0.5, tr.y - 60)
    await sleep(150)
    ok(!(await vis(`${PL} .fxp-tip`)), 'off the track, the look goes')
    ok(near((await P(PL)).t, 0, 0.1), 'looking moved nothing')

    // the bar comes and goes
    await move(...Object.values(await on(`${PL} > video`, win, [0.5, 0.3])))
    await playing(PL, true)
    await sleep(3100)
    p = await P(PL)
    ok(!p.paused && !p.bar && p.cls.includes('idle'), 'played with the pointer still: the bar goes', p.cls)
    ok(await vis(`${PL} .fxp-line`), 'a hairline says where it is')
    await shot('player-6-bar-away')
    const pt = await on(`${PL} > video`, win, [0.5, 0.3])
    await move(pt.x + 6, pt.y + 4)
    ok((await P(PL)).bar, 'the pointer moves: the bar is back')
    const bar = await on(`${PL} .fxp-time`)
    await move(bar.x, bar.y)
    await sleep(3100)
    ok((await P(PL)).bar, 'with the pointer on the bar it stays')
    await away()
    await sleep(1100)
    ok(!(await P(PL)).bar, 'the pointer leaves: the bar goes sooner')
    ok(!(await P(PL)).paused, '(still playing)')
    await key('Space')
    await sleep(200)
    ok((await P(PL)).paused && (await P(PL)).bar, 'a key brings it back (Space, which paused)')
    await sleep(3100)
    ok(!(await P(PL)).bar, 'paused too, it goes: the picture is all there is')
    ok(near((await box(VID)).h, card0.h, 0.5), 'through all of it the card kept its size')

    // the end
    await key('End')
    await until(async () => (await P(PL)).ended, 3000)
    await sleep(400)
    p = await P(PL)
    ok(p.ended && p.label === 'Play again' && p.bar, 'End: the end, the button says Play again, the bar stays', p)
    await sleep(3100)
    ok((await P(PL)).bar, 'at the end the bar does not go')
    await key('Space')
    p = await until(async () => ((await P(PL)).t > 0.2 && (await P(PL)).t < 3 ? P(PL) : null), 3000)
    ok(p && !p.paused, 'Space plays it again from the start', p)
    await key('Space')

    // the keyboard alone
    await js(`document.activeElement.blur()`)
    await tap('.composer textarea, textarea')
    ok(!(await P(PL)).inside, '(the keyboard is in the message box)')
    await key('Space')
    ok((await P(PL)).paused, 'Space typed elsewhere does not play it')
    await js(`document.querySelector(${JSON.stringify(PL)}).focus()`)
    await key('Tab')
    ok((await js(`return document.activeElement.className`)).includes('fxp-track'), 'Tab from the player: its track')
    ok((await P(PL)).bar, 'which shows the bar')
    await key('Right')
    ok(await until(async () => (await P(PL)).t > 4, 3000), '→ on the track goes on')
    await key('Tab')
    ok((await js(`return document.activeElement.className`)).includes('fxp-toggle'), 'Tab again: play/pause')
    await key('Space')
    ok(!(await P(PL)).paused, 'Space on it plays, once', await P(PL))
    await key('Return')
    ok((await P(PL)).paused, 'Enter on it pauses')
    await sleep(3100)
    ok((await P(PL)).bar, 'the bar stays while one of its buttons has the keyboard')
  })

  // ---- a tall one, a silent one, two at once, out of sight, a redraw ----------------------------------------------
  await section('more', async () => {
    await say([{ id: 'v1', kind: 'reply', from: 'Iris', text: 'The checkout run from start to finish.', files: [wide] }, { id: 'v2', kind: 'reply', from: 'Theo', text: 'And the same flow on a phone.', files: [tall] }, { id: 'v3', kind: 'reply', from: 'June', text: 'A short one.', files: [short] }])
    const TALL = '.fx-video[data-live="v2:0"] .fxp'
    await into(TALL)
    const card = await box('.fx-video[data-live="v2:0"]')
    let p = await until(async () => ((await P(TALL)).ready >= 2 ? P(TALL) : null))
    ok(near(card.w, 240, 1) && near(p.box.w / p.box.h, 0.75, 0.01), 'a tall recording: a 240 wide card, 3:4 at most', [card, p.box])
    await tap(`${TALL} .fxp-big`)
    await until(async () => (await P(TALL)).t > 0.3)
    ok(!(await vis(`${TALL} .fxp-vol`)), 'it has no sound, so no volume is offered')
    await key('m')
    ok(!(await P(TALL)).muted, 'and M does nothing')
    const row = await box(`${TALL} .fxp-row`)
    const full = await box(`${TALL} .fxp-full`)
    const time = await box(`${TALL} .fxp-time`)
    p = await P(TALL)
    ok(full.x + full.w <= p.box.x + p.box.w && time.x + time.w <= (await box(`${TALL} .fxp-rate`)).x && row.w <= p.box.w, 'its bar fits in 240: nothing over anything else', [row, time, full])
    await tap(`${TALL} .fxp-rate`)
    const menu = await box(`${TALL} .fxp-menu`)
    ok(menu.x >= p.box.x && menu.x + menu.w <= p.box.x + p.box.w + 0.5, 'its speeds fit too', [menu, p.box])
    await shot('more-1-tall')
    await key('Escape')
    // two at once
    await into(VID)
    await tap(`${PL} .fxp-big`)
    await until(async () => (await P(PL)).t > 0.3)
    ok((await P(TALL)).paused && !(await P(PL)).paused, 'playing another one pauses the first: one at a time')
    // a redraw: a new message comes
    const before = await P(PL)
    await js(`window.__v = document.querySelector(${JSON.stringify(`${PL} > video`)}); window.__n = 0; window.__v.addEventListener('loadstart', () => window.__n++)`)
    await more({ id: 'v4', kind: 'reply', from: 'Ada', text: 'A new message while it plays.' })
    await sleep(500)
    p = await P(PL)
    ok((await js(`return window.__v === document.querySelector(${JSON.stringify(`${PL} > video`)}) && window.__n === 0`)) && !p.paused && p.t > before.t, 'a new message is drawn in: the same recording plays on, not loaded again', p)
    ok(p.cls.includes(' on') && (await js(`return document.querySelectorAll(${JSON.stringify(VID)}).length`)) === 1, 'and there is one card of it')
    ok((await P(TALL)).cls.includes(' on') && (await P(TALL)).t > 0.3, 'the paused one kept its place too')
    // out of sight
    await js(`document.querySelector('#m-v4').scrollIntoView({ block: 'end' }); const l = document.querySelector(${JSON.stringify(VID)}).closest('.feed, .list, [class*=feed]') ?? document.scrollingElement; l.scrollTop = l.scrollHeight`)
    await sleep(600)
    const out = await js(`const r = document.querySelector(${JSON.stringify(PL)}).getBoundingClientRect(); const h = document.querySelector('.page-head[data-for=chat]').getBoundingClientRect(); return r.bottom < h.bottom`)
    if (out) ok((await P(PL)).paused, 'scrolled out of sight, it stops')
    else console.log('     (the chat is too short here to scroll the recording away)')
    // the short one, to its end by itself
    const SHORT = '.fx-video[data-live="v3:0"] .fxp'
    await into(SHORT)
    await tap(`${SHORT} .fxp-big`)
    await until(async () => (await P(SHORT)).ended, 6000)
    await sleep(400) // (the bar comes back in over a moment)
    p = await P(SHORT)
    ok(p.ended && p.label === 'Play again' && p.bar, 'played to its end: Play again, and the bar is back', p)
    ok(/^0:03 \/ 0:03$/.test(p.time), 'and the time says the end', p.time)
    await tap(`${SHORT} .fxp-toggle`)
    ok(await until(async () => (await P(SHORT)).t > 0.2 && (await P(SHORT)).t < 2.5 && !(await P(SHORT)).paused, 3000), 'the button plays it again')
    await key('Space')
    // where it was left: played again later, it carries on
    await into(VID)
    await tap(`${PL} > video`, win, [0.5, 0.3])
    await key('5')
    await sleep(300)
    await key('Space')
    await sleep(200)
    const left = (await P(PL)).t
    await say([{ id: 'w1', kind: 'reply', from: 'Iris', text: 'The same recording, in a chat drawn anew.', files: [wide] }])
    const AGAIN = '.fx-video[data-live="w1:0"] .fxp'
    await until(async () => (await P(AGAIN))?.ready >= 2)
    await into(AGAIN)
    await tap(`${AGAIN} .fxp-big`)
    p = await until(async () => ((await P(AGAIN)).t > left - 0.5 ? P(AGAIN) : null), 3000)
    ok(p && near(p.t, left, 1.5), 'opened again later, it carries on from where it was left', [left, p?.t])
    ok(p && p.rate === 1 && p.vol === 1, 'at the speed and loudness last chosen')
    await key('Space')
  })

  // ---- the whole screen ---------------------------------------------------------------------------------------------
  await section('fullscreen', async () => {
    await say([{ id: 'v1', kind: 'reply', from: 'Iris', text: 'The checkout run from start to finish.', files: [wide] }, { id: 'v2', kind: 'reply', from: 'Theo', text: 'And the same flow on a phone.', files: [tall] }])
    await into(VID)
    await until(async () => (await P(PL)).ready >= 2)
    const card0 = await box(VID)
    await tap(`${PL} .fxp-big`)
    await until(async () => (await P(PL)).t > 0.3)
    await tap(`${PL} .fxp-full`)
    let p = await until(async () => ((await P(PL)).full ? P(PL) : null), 3000)
    ok(p, 'the bar\'s last button fills the screen with it')
    const [W, H] = await js('return [innerWidth, innerHeight]')
    p = await P(PL)
    ok(near(p.box.x, 0, 0.5) && near(p.box.y, 0, 0.5) && near(p.box.w, W, 0.5) && near(p.box.h, H, 0.5), 'the player is the whole screen', p.box)
    ok(near(p.pic.w, W, 0.5) && near(p.pic.h, H, 0.5), 'and its picture the whole player (fitted inside, never cropped or stretched)', p.pic)
    ok(!p.paused, 'it plays on through the change')
    await move(W / 2, H / 2)
    const barBox = await box(`${PL} .fxp-bar`)
    const track = await box(`${PL} .fxp-track`)
    const fullBtn = await box(`${PL} .fxp-full`)
    ok(near(barBox.y + barBox.h, H, 0.5) && near(barBox.x, 0, 0.5) && near(barBox.w, W, 0.5), 'the bar is along the bottom edge, full width', barBox)
    ok(track.x >= 16 && track.x + track.w <= W - 16 && fullBtn.x + fullBtn.w <= W - 12 && fullBtn.y + fullBtn.h <= H - 8, 'its track and buttons keep off the edges', [track, fullBtn])
    ok((await vis(`${PL} .fxp-top`)) && (await js(`return document.querySelector(${JSON.stringify(`${PL} .fxp-top`)}).textContent`)) === 'checkout-run.mp4', 'its name is at the top')
    ok((await js(`return getComputedStyle(document.querySelector(${JSON.stringify(PL)})).borderRadius`)) === '0px', 'no rounded corners on the screen\'s edge')
    ok((await js(`return document.querySelector(${JSON.stringify(`${PL} .fxp-full`)}).querySelector('svg:last-child').getBoundingClientRect().width > 0 && document.querySelector(${JSON.stringify(`${PL} .fxp-full`)}).querySelector('svg:first-child').getBoundingClientRect().width === 0`)), 'the button now shows the way back')
    await shot('fullscreen-1')
    // everything still works there
    await key('Space')
    ok((await P(PL)).paused, 'Space pauses there')
    await tap(`${PL} .fxp-track`, win, [0.5, 0.5])
    ok(await until(async () => near((await P(PL)).t, 24, 0.8), 3000), 'the track works there')
    await move(track.x + track.w * 0.8, track.y + track.h / 2)
    await sleep(700)
    const tip = await box(`${PL} .fxp-tip`)
    ok((await vis(`${PL} .fxp-tip`)) && tip.y + tip.h <= track.y && tip.x + tip.w <= W, 'the look at a moment sits over the track there', [tip, track])
    await tap(`${PL} .fxp-rate`)
    const menu = await box(`${PL} .fxp-menu`)
    ok((await vis(`${PL} .fxp-menu`)) && menu.x + menu.w <= W - 12 && menu.y + menu.h <= track.y + 4, 'the speeds open over the bar there', [menu, track])
    await shot('fullscreen-2-speeds')
    await tap(`${PL} > video`, win, [0.5, 0.3])
    ok(!(await vis(`${PL} .fxp-menu`)) && (await P(PL)).full, 'a click on the picture closes the speeds, and the screen stays')
    await playing(PL, true)
    await move(W / 2, H / 3)
    await sleep(3100)
    p = await P(PL)
    ok(!p.bar && !(await vis(`${PL} .fxp-top`)) && !(await vis(`${PL} .fxp-line`)), 'left alone there, the bar and the name go: only the picture', p.cls)
    ok((await js(`return getComputedStyle(document.querySelector(${JSON.stringify(PL)})).cursor`)) === 'none', 'and the pointer with them')
    await shot('fullscreen-3-clean')
    // a redraw under it
    await js(`window.__v = document.querySelector(${JSON.stringify(`${PL} > video`)}); window.__n = 0; window.__v.addEventListener('loadstart', () => window.__n++)`)
    await more({ id: 'v5', kind: 'reply', from: 'Ada', text: 'A new message under the full screen.' })
    await sleep(500)
    p = await P(PL)
    ok(p.full && !p.paused && (await js(`return window.__n === 0 && window.__v === document.querySelector(${JSON.stringify(`${PL} > video`)})`)), 'a new message arrives underneath: still the whole screen, still playing', p)
    // and back
    await key('f')
    p = await until(async () => (!(await P(PL)).full ? P(PL) : null), 3000)
    ok(p, 'F leaves the whole screen')
    await sleep(200)
    const card1 = await box(VID)
    p = await P(PL)
    ok(near(card1.w, card0.w, 0.5) && near(card1.h, card0.h, 0.5) && near(p.box.w, 440, 0.5), 'the card is the size it was', [card0, card1])
    ok(!p.paused, 'and it plays on, in the message')
    await key('f')
    ok(await until(async () => (await P(PL)).full, 3000), 'F fills the screen')
    await tap(`${PL} .fxp-rate`)
    await key('Escape') // (the system's own key there: it leaves the whole screen, whatever else is open)
    ok(await until(async () => !(await P(PL)).full, 3000), 'Esc leaves it')
    await sleep(200)
    ok(!(await vis(`${PL} .fxp-menu`)) && near((await P(PL)).box.w, 440, 0.5), 'and its speeds, open at the time, are closed with it')
    await dblclick(...Object.values(await on(`${PL} > video`, win, [0.5, 0.3])))
    p = await until(async () => ((await P(PL)).full ? P(PL) : null), 3000)
    ok(p, 'a double click on the picture fills the screen')
    await dblclick(W / 2, H / 3)
    ok(await until(async () => !(await P(PL)).full, 3000), 'and a double click there leaves it')
    await key('Space')
    // a tall one on the whole screen
    const TALL = '.fx-video[data-live="v2:0"] .fxp'
    await into(TALL)
    await until(async () => (await P(TALL)).ready >= 2)
    await tap(`${TALL} .fxp-big`)
    await key('f')
    p = await until(async () => ((await P(TALL)).full ? P(TALL) : null), 3000)
    ok(p && near(p.box.w, W, 0.5) && near(p.box.h, H, 0.5) && near(p.pic.w, W, 0.5), 'a tall recording fills the screen the same way (its picture upright in the middle)', p?.box)
    await move(W / 2, H / 2)
    await shot('fullscreen-4-tall')
    await key('f')
    await until(async () => !(await P(TALL)).full, 3000)
    await key('Space')
  })

  // ---- the viewer ---------------------------------------------------------------------------------------------------
  await section('viewer', async () => {
    await say([{ id: 'v1', kind: 'reply', from: 'Iris', text: 'The checkout run from start to finish.', files: [wide] }, { id: 'g1', kind: 'reply', from: 'Theo', text: 'Three pictures and the phone flow.', files: [picA, picB, tall, picC] }])
    await into(VID)
    await until(async () => (await P(PL)).ready >= 2)
    await tap(`${PL} .fxp-big`)
    await until(async () => (await P(PL)).t > 0.4)
    await js(`window.__v = document.querySelector(${JSON.stringify(`${PL} > video`)}); window.__n = 0; window.__v.addEventListener('loadstart', () => window.__n++)`)
    await tap(`${VID} [data-fx=view]`)
    const VP = '.fxv .fxv-stage > .fxp'
    let p = await until(async () => P(VP), 3000)
    ok(p && (await js(`return window.__v === document.querySelector(${JSON.stringify(`${VP} > video`)}) && window.__n === 0`)), 'the card\'s button opens the viewer on the very same recording: nothing loads again')
    ok(p && !p.paused && p.t > 0.4, 'still playing, from where it was', p)
    ok(p.inside, 'the keyboard is the player\'s')
    const stage = await box('.fxv-stage')
    ok(near(p.box.w / p.box.h, 16 / 9, 0.01) && p.box.x >= stage.x + 60 && p.box.x + p.box.w <= stage.x + stage.w - 60 && p.box.y >= stage.y + 20 && p.box.y + p.box.h <= stage.y + stage.h - 20, 'as big as the window lets its shape be, with room around it', [p.box, stage])
    ok(near(p.pic.w, p.box.w, 0.5) && near(p.pic.h, p.box.h, 0.5), 'the picture fills the player exactly: no bars beside it')
    ok((await js(`return document.querySelector('.fxv .fx-what small').textContent`)) === 'Video · 1280×720 · 0:48 · ' + (await js(`return fxSize(${wide.size})`)), 'the viewer says what it is', await js(`return document.querySelector('.fxv .fx-what small').textContent`))
    await move(p.box.x + p.box.w / 2, p.box.y + p.box.h / 2)
    await shot('viewer-1-recording')
    await key('Space')
    ok((await P(VP)).paused, 'Space pauses it there')
    await key('Right')
    const t0 = (await P(VP)).t
    ok(t0 > 5, 'one recording alone: → goes on in it', t0)
    // window made smaller and narrower
    win.setContentSize(700, 500)
    await sleep(350)
    p = await P(VP)
    const stage2 = await box('.fxv-stage')
    ok(near(p.box.w / p.box.h, 16 / 9, 0.01) && p.box.x >= stage2.x && p.box.x + p.box.w <= stage2.x + stage2.w + 0.5 && p.box.y + p.box.h <= stage2.y + stage2.h + 0.5, 'a smaller window: it still fits, same shape', [p.box, stage2])
    win.setContentSize(1180, 420)
    await sleep(350)
    p = await P(VP)
    const stage3 = await box('.fxv-stage')
    ok(near(p.box.w / p.box.h, 16 / 9, 0.01) && p.box.y >= stage3.y && p.box.y + p.box.h <= stage3.y + stage3.h + 0.5, 'a low window: it fits by its height', [p.box, stage3])
    win.setContentSize(1180, 820)
    await sleep(350)
    // the whole screen from the viewer, and back to the viewer
    await key('f')
    p = await until(async () => ((await P(VP)).full ? P(VP) : null), 3000)
    const [W, H] = await js('return [innerWidth, innerHeight]')
    ok(p && near(p.box.w, W, 0.5) && near(p.box.h, H, 0.5) && near(p.pic.w, W, 0.5) && near(p.pic.h, H, 0.5), 'F in the viewer: the whole screen', p?.box)
    await shot('viewer-2-fullscreen')
    await key('Escape')
    await until(async () => !(await P(VP))?.full, 3000)
    await sleep(250)
    p = await P(VP)
    ok(p && (await vis('.fxv')) && near(p.box.w / p.box.h, 16 / 9, 0.01) && p.box.w < W - 100, 'Esc there: back in the viewer (which stays open), the size it was', p?.box)
    // Close in hand: Space still plays
    await js(`document.querySelector('.fxv [data-fxv=close]').focus()`)
    await key('Space')
    ok((await vis('.fxv')) && !(await P(VP)).paused, 'with Close holding the keyboard, Space plays the recording (and closes nothing)')
    await key('Space')
    // Tab stays in the viewer
    const stops = []
    for (let i = 0; i < 12; i++) {
      await key('Tab')
      stops.push(await js(`const a = document.activeElement; return (a.closest('.fxv') ? '' : 'OUT:') + (a.dataset.fxv ?? a.dataset.fxp ?? a.className.split(' ')[0])`))
    }
    ok(!stops.some((s) => s.startsWith('OUT:')) && new Set(stops).size >= 6, 'Tab goes round the viewer and never leaves it', stops)
    // close: back in its message, where it got to
    const at = (await P(VP)).t
    await key('Escape')
    await sleep(250)
    p = await P(PL)
    ok(!(await vis('.fxv')) && p && (await js(`return window.__v === document.querySelector(${JSON.stringify(`${PL} > video`)}) && window.__n === 0`)), 'Esc closes the viewer: the same recording is back in its message')
    ok(p.paused && near(p.t, at, 0.1) && near(p.box.w, 440, 0.5), 'paused, where it got to, the size it was', p)
    ok((await js(`return document.activeElement?.dataset?.fx`)) === 'view', 'the keyboard is back on the button that opened it')
    ok((await js(`return document.querySelector(${JSON.stringify(VID)}).classList.contains('on') && !document.querySelector(${JSON.stringify(VID)}).classList.contains('lent')`)), 'its card is live again')
    // opened while a redraw happens underneath
    await tap(`${VID} [data-fx=view]`)
    await until(async () => P(VP), 3000)
    await more({ id: 'v6', kind: 'reply', from: 'Ada', text: 'A new message under the viewer.' })
    await sleep(400)
    ok((await P(VP)) && (await js(`return window.__n === 0`)), 'a new message under the viewer changes nothing in it')
    await tap('.fxv [data-fxv=close]')
    await sleep(250)
    p = await P(PL)
    ok(p && near(p.t, at, 0.1) && (await js(`return window.__v === document.querySelector(${JSON.stringify(`${PL} > video`)}) && document.querySelectorAll(${JSON.stringify(`${VID} .fxp`)}).length === 1`)), 'closed after that: it is back in the card that is there now, the only one', p)
    // a viewer opened on one that was never played
    await say([{ id: 'n1', kind: 'reply', from: 'June', text: 'A short one, never played.', files: [short] }, { id: 'g1', kind: 'reply', from: 'Theo', text: 'Three pictures and the phone flow.', files: [picA, picB, tall, picC] }])
    const NV = '.fx-video[data-live="n1:0"]'
    await into(NV)
    await until(async () => (await P(`${NV} .fxp`)).ready >= 2)
    await tap(`${NV} [data-fx=view]`)
    p = await until(async () => P(VP), 3000)
    ok(p && p.paused && !p.cls.includes(' on') && (await vis(`${VP} .fxp-big`)), 'opened on one never played: still, with Play', p)
    await tap(`${VP} .fxp-big`)
    ok(await until(async () => !(await P(VP)).paused && (await P(VP)).t > 0.2, 3000), 'a click on Play plays it there (the page lives: it was moved here as it is)')
    await key('Space')
    ok((await P(VP)).paused, 'Space pauses it')
    await tap(`${VP} .fxp-track`, win, [0.5, 0.5])
    ok(await until(async () => near((await P(VP)).t, 1.5, 0.3), 3000), 'its track works there')
    await tap('.fxv [data-fxv=close]')
    await sleep(250)
    p = await P(`${NV} .fxp`)
    ok(p && p.paused && near(p.t, 1.5, 0.3) && p.cls.includes(' on'), 'closed: in the message it is where it got to, with its bar', p)
    await tap(`${NV} .fxp > video`, win, [0.5, 0.3])
    ok(await until(async () => !(await P(`${NV} .fxp`)).paused, 3000), 'and a click on it there plays it (moved back as it is)')
    await playing(`${NV} .fxp`, false)

    // several files: ← → go through them, and a recording among them stops and goes back
    const G = '.fx-video[data-live="g1:2"]'
    await into(G)
    await until(async () => (await P(`${G} .fxp`)).ready >= 2)
    await tap('.fx-pics [data-fx=view][data-i="0"]')
    ok(await until(() => vis('.fxv-stage.image img'), 3000), 'a click on a picture opens it in the viewer')
    ok((await js(`return document.querySelector('.fxv-count').textContent`)) === '1 of 4', 'which says 1 of 4')
    await shot('viewer-3-picture')
    await key('Right')
    await key('Right')
    p = await until(async () => P(VP), 3000)
    ok(p && (await js(`return document.querySelector('.fxv-count').textContent`)) === '3 of 4' && p.paused, '→ → comes to the recording, still')
    ok(near(p.box.w / p.box.h, 720 / 1280, 0.01) && p.box.h <= (await box('.fxv-stage')).h, 'a tall one, fitted by its height', p.box)
    ok((await js(`return document.querySelector(${JSON.stringify(G)}).classList.contains('lent')`)), '(it is the message\'s own)')
    await shot('viewer-4-tall-recording')
    await key('Space')
    ok(await until(async () => !(await P(VP)).paused && (await P(VP)).t > 0.3, 3000), 'Space plays it, the keyboard still being on the way through')
    await key('Right')
    await sleep(250)
    ok((await vis('.fxv-stage.image img')) && (await js(`return document.querySelector('.fxv-count').textContent`)) === '4 of 4', '→ goes on to the next picture')
    p = await P(`${G} .fxp`)
    ok(p && p.paused && p.t > 0.3 && !(await js(`return document.querySelector(${JSON.stringify(G)}).classList.contains('lent')`)), 'and the recording is back in its message, stopped where it was', p)
    await key('Left')
    p = await until(async () => P(VP), 3000)
    ok(p && p.paused && p.t > 0.3, '← comes back to it, where it was')
    await tap(VP + ' > video', win, [0.5, 0.4])
    ok(!(await P(VP)).paused && (await P(VP)).inside, 'a click on it plays it, and gives it the keyboard')
    const before = (await P(VP)).t
    await key('Right')
    ok((await js(`return document.querySelector('.fxv-count').textContent`)) === '3 of 4' && (await until(async () => (await P(VP)).t > before + 3, 3000)), 'now → is the recording\'s own: 5 s on, not the next file')
    await tap('.fxv .fxv-nav.next')
    await sleep(250)
    ok((await js(`return document.querySelector('.fxv-count').textContent`)) === '4 of 4', 'the arrow at the side goes on')
    ok(!(await js(`return document.activeElement === document.body`)) && (await js(`return Boolean(document.activeElement.closest('.fxv'))`)), 'and the keyboard is still in the viewer')
    await key('Escape')
    await sleep(250)
    ok(!(await vis('.fxv')), 'Esc closes it')
    // pictures: zoom
    await tap('.fx-pics [data-fx=view][data-i="1"]')
    await until(() => vis('.fxv-stage.image img'), 3000)
    const fit = await box('.fxv-stage.image img')
    await keyOf('+')
    const zoomed = await box('.fxv-stage.image img')
    ok(near(zoomed.w / fit.w, 1.25, 0.02), '+ zooms a picture in', [fit.w, zoomed.w])
    await keyOf('0')
    ok(near((await box('.fxv-stage.image img')).w, fit.w, 1), '0 fits it again')
    await tap('.fxv [data-fxv=in]')
    await tap('.fxv [data-fxv=out]')
    ok(near((await box('.fxv-stage.image img')).w, fit.w, 1.5), 'the + and − buttons too')
    await tap('.fxv [data-fxv=fit]')
    await tap('.fxv-stage.image img')
    ok((await js(`return document.querySelector('.fxv-pct').textContent`)) === '100%', 'a click on the picture: its real size')
    await tap('.fxv-stage.image img', win, [0.5, 0.2])
    ok((await js(`return document.querySelector('.fxv-pct').textContent`)) === 'Fit', 'and again: fitted')
    await tap('.fxv [data-fxv=open]')
    await tap('.fxv [data-fxv=show]')
    await sleep(200)
    const c = await calls()
    ok(c.some((x) => x[0] === 'openFile' && x[1] === picB.path) && c.some((x) => x[0] === 'showFile' && x[1] === picB.path), 'Open and Show in Finder ask for that picture')
    const s = await box('.fxv-stage')
    await click(s.x + 20, s.y + s.h - 20)
    await sleep(200)
    ok(!(await vis('.fxv')), 'a click beside the picture closes the viewer')
  })

  // ---- a recording that can't be played ---------------------------------------------------------------------------------
  await section('cant', async () => {
    await say([{ id: 'x1', kind: 'reply', from: 'Iris', text: 'One that is gone, and one Chromium has no decoder for.', files: [missing, oldCodec] }])
    const GONE = '.fx-video[data-live="x1:0"] .fxp'
    const OLD = '.fx-video[data-live="x1:1"] .fxp'
    let p = await until(async () => ((await P(GONE))?.note ? P(GONE) : null), 5000)
    ok(p?.note === "This file isn't kept any more.", 'a recording that is not kept says so, in its box', p?.note)
    ok(!(await vis(`${GONE} .fxp-big`)) && !(await vis(`${GONE} [data-fxp=open]`)), 'with nothing to press that could not work')
    p = await until(async () => ((await P(OLD))?.note ? P(OLD) : null), 5000)
    ok(p?.note === "This recording can't play here.", 'one that can\'t be decoded says it can\'t play here', p?.note)
    await sleep(500)
    p = await P(OLD)
    const card = await box('.fx-video[data-live="x1:1"]')
    ok(near(card.w, 373, 1) && near(p.box.w / p.box.h, 4 / 3, 0.02), 'its box is the size a player would be', card)
    await shot('cant-1')
    await tap(`${OLD} [data-fxp=open]`)
    await tap(`${OLD} [data-fxp=show]`)
    await sleep(200)
    const c = await calls()
    ok(c.some((x) => x[0] === 'openFile' && x[1] === oldCodec.path) && c.some((x) => x[0] === 'showFile' && x[1] === oldCodec.path), 'its Open and Show in Finder hand it to the system')
    await js(`document.querySelector(${JSON.stringify(OLD)}).focus()`)
    await key('Space')
    ok((await P(OLD)).paused && (await P(OLD)).note, 'Space does nothing there')
    await tap('.fx-video[data-live="x1:1"] [data-fx=view]')
    p = await until(async () => P('.fxv .fxv-stage > .fxp'), 3000)
    ok(p?.note === "This recording can't play here.", 'the viewer says the same')
    await tap('.fxv .fxv-stage > .fxp [data-fxp=open]')
    await sleep(150)
    ok((await calls()).some((x) => x[0] === 'openFile'), 'and its Open works there too')
    await key('Escape')
    await sleep(200)
    ok(!(await vis('.fxv')) && (await P(OLD))?.note, 'closed, the message still says it')
  })

  // ---- pictures, a page, a plain file -----------------------------------------------------------------------------
  await section('others', async () => {
    const lost = { ...picA, path: path.join(here, '2026-11-16-00000000-lost.svg'), name: 'lost.svg' }
    await say([{ id: 'o0', kind: 'msg', from: 'you', to: 'Theo', text: 'Mine.', images: [picWide.path] }, { id: 'o1', kind: 'reply', from: 'Theo', text: 'One picture.', files: [picWide] }, { id: 'o2', kind: 'reply', from: 'Theo', text: 'Three, one lost.', files: [picA, lost, picC] },
      { id: 'o3', kind: 'reply', from: 'Ada', text: 'A page.', files: [page] }, { id: 'o4', kind: 'reply', from: 'June', text: 'A log, and a script.', files: [log, { ...log, name: 'setup.command', path: log.path.replace(/tests\.log$/, 'setup.command') }] }])
    await into('.fx-pics.one')
    const one = await box('.fx-pics.one .fx-pic')
    ok(near(one.w, 360, 1) && near(one.h, 225, 1), 'one picture: 360 × 225, sized before it loads', one)
    ok(await until(() => js(`const i = document.querySelector('.fx-pics.one img'); return i.complete && i.naturalWidth > 0`), 3000), 'and it shows')
    await into('#m-o2')
    ok(await until(async () => (await js(`return document.querySelector('.fx-pic[data-i="1"]')?.dataset.why`)) === 'Not kept any more', 3000), 'a picture that is not kept says so in its tile')
    await shot('others-1-pictures')
    // your own picture
    await into('#m-o0')
    await tap('#m-o0 .pics img')
    ok(await until(() => vis('.fxv-stage.image img'), 3000), 'your own picture opens in the viewer too')
    await key('Escape')
    await sleep(200)
    // the page
    const PG = '.fx-page[data-live="o3:0"]'
    await into(PG)
    const frame = () => js(`const f = document.querySelector(${JSON.stringify(`${PG} iframe`)}); return { src: f.src, still: f.classList.contains('still'), on: f.closest('.fx-card').classList.contains('on') }`)
    let f = await frame()
    ok(f.still && !f.on && !f.src.includes('run=1') && (await vis(`${PG} .fx-run`)), 'a page: a still preview, with Run page')
    const pg0 = await box(PG)
    await tap(`${PG} .fx-run`)
    f = await frame()
    ok(!f.still && f.on && f.src.includes('run=1') && !(await vis(`${PG} .fx-run`)) && (await vis(`${PG} .fx-running`)), 'Run page runs it where it is, and the card says Running')
    ok(near((await box(PG)).h, pg0.h, 0.5), 'in the same box')
    await js(`window.__f = document.querySelector(${JSON.stringify(`${PG} iframe`)}); window.__fn = 0; window.__f.addEventListener('load', () => window.__fn++)`)
    await sleep(500)
    await js('window.__fn = 0')
    await more({ id: 'o5', kind: 'reply', from: 'Ada', text: 'A new message while the page runs.' })
    await sleep(500)
    ok((await js(`return window.__f === document.querySelector(${JSON.stringify(`${PG} iframe`)}) && window.__fn === 0`)), 'a new message is drawn in: the page runs on, not loaded again')
    await shot('others-2-page')
    await tap(`${PG} [data-fx=stop]`)
    f = await frame()
    ok(f.still && !f.on && !f.src.includes('run=1') && (await vis(`${PG} .fx-run`)), 'Stop: the still preview again')
    await tap(`${PG} [data-fx=view]`)
    ok(await until(() => js(`return document.querySelector('.fxv-stage.html iframe')?.src.includes('run=1')`), 3000), 'its viewer runs it, over the window')
    await key('Escape')
    await sleep(200)
    ok(!(await vis('.fxv')), 'Esc closes that')
    // the menu
    await tap(`${PG} [data-fx=more]`)
    ok(await until(() => vis(MENU), 2000), 'More opens the menu')
    const items = await js(`return [...document.querySelectorAll('.menu:not(.hidden, .leaving) [data-menu-act]')].map((b) => b.textContent)`)
    ok(JSON.stringify(items) === JSON.stringify(['Open in your browser', 'Show in Finder', 'Copy its path']), 'Open in your browser, Show in Finder, Copy its path', items)
    await tap(MENU + ' [data-menu-act=copy]')
    await sleep(200)
    ok((await calls()).some((x) => x[0] === 'copy' && x[1] === page.path), 'Copy its path copies where the page is')
    // a plain file
    await into('#m-o4')
    const buttons = await js(`return [...document.querySelectorAll('#m-o4 .fx-file')].map((c) => [...c.querySelectorAll('button')].map((b) => b.textContent))`)
    ok(JSON.stringify(buttons) === JSON.stringify([['Open', 'Show in Finder'], ['Show in Finder']]), 'a log has Open and Show in Finder; a script only Show in Finder', buttons)
    await tap('#m-o4 .fx-file [data-fx=open]')
    await tap('#m-o4 .fx-file [data-fx=show]')
    await sleep(200)
    const c = await calls()
    ok(c.some((x) => x[0] === 'openFile' && x[1] === log.path) && c.some((x) => x[0] === 'showFile' && x[1] === log.path), 'and they ask for that file')
    await shot('others-3-files')
  })

  // ---- files on a linked computer -----------------------------------------------------------------------------------
  await section('linked', async () => {
    const run = theirs('windows-run.mp4')
    const shotPic = theirs('shot.svg')
    const demo = theirs('demo.html')
    const notes = theirs('notes.pdf')
    const runPieces = Math.ceil(run.size / PIECE)
    link.asked.length = 0
    await say([{ id: 'l1', kind: 'reply', from: 'Rex@workstation', text: 'The same run on Windows.', files: [run] }, { id: 'l2', kind: 'reply', from: 'Rex@workstation', text: 'A picture, the page, my notes.', files: [shotPic, demo, notes] }])
    const LV = '.fx-video[data-live="l1:0"]'
    const LP = `${LV} .fxp`
    await into(LV)
    ok((await js(`return document.querySelector(${JSON.stringify(`${LV} .fx-what small`)}).textContent`)).endsWith('· from Workstation'), 'a recording on a linked computer says where it is from')
    ok((await js(`return document.querySelector(${JSON.stringify(`${LP} > video`)}).getAttribute('src')`)).startsWith('clique-file://f/?p='), '(and is asked for through clique-file://)')
    let p = await until(async () => ((await P(LP)).ready >= 2 ? P(LP) : null), 8000)
    const forFrame = new Set(link.asked.filter((a) => a[0] === 'windows-run.mp4').map((a) => a[1])).size
    ok(p && p.size[0] === 1280, 'its first frame shows, fetched from there', p)
    ok(forFrame >= 1 && forFrame < runPieces, `for that, ${forFrame} of its ${runPieces} pieces came: not the whole file`, forFrame)
    await shot('linked-1-still')
    await tap(`${LP} .fxp-big`)
    p = await until(async () => ((await P(LP)).t > 1 ? P(LP) : null), 8000)
    ok(p && !p.paused, 'Play plays it while it is still coming', p)
    ok(p.here.length >= 1 && p.here[0][1] > p.t && p.here.at(-1)[1] < 40, 'the track shows how much is here: ahead of where it plays, not all of it', p.here)
    ok(!fs.existsSync(run.path) && fs.existsSync(`${run.path}.part`), '(the file is in the cache in part)')
    await tap(`${LP} .fxp-track`, win, [0.8, 0.5])
    p = await until(async () => ((await P(LP)).t > 32 && !(await P(LP)).paused && (await P(LP)).ready >= 3 ? P(LP) : null), 8000)
    ok(p, 'a jump far on: it plays from there once that part has come', await P(LP))
    ok(p && p.here.length >= 2, 'and the track shows the two stretches that are here', p?.here)
    await move(...Object.values(await on(`${LP} > video`, win, [0.5, 0.3])))
    await shot('linked-2-playing')
    await key('Space')
    const sofar = new Set(link.asked.filter((a) => a[0] === 'windows-run.mp4').map((a) => a[1])).size
    await sleep(1500)
    ok(new Set(link.asked.filter((a) => a[0] === 'windows-run.mp4').map((a) => a[1])).size <= sofar + 1 && sofar < runPieces, 'paused, no more of it is fetched', [sofar, runPieces])
    ok(link.asked.filter((a) => a[0] === 'windows-run.mp4').length === new Set(link.asked.filter((a) => a[0] === 'windows-run.mp4').map((a) => a[1])).size, 'no piece was asked for twice')
    // the viewer and the whole screen, with one that is still coming
    await tap(`${LV} [data-fx=view]`)
    p = await until(async () => P('.fxv .fxv-stage > .fxp'), 3000)
    ok(p && p.t > 32 && p.ready >= 2, 'in the viewer it is the same one, where it was', p)
    await key('Escape')
    await sleep(250)
    // the picture, the page
    await into('#m-l2')
    ok(await until(() => js(`const i = document.querySelector('#m-l2 .fx-pic img'); return i.complete && i.naturalWidth > 0`), 6000), 'a picture from there shows')
    ok(!(await js(`return document.querySelector('#m-l2 .fx-pic').classList.contains('gone')`)), 'and never showed as broken on its way')
    const LPG = '.fx-page[data-live="l2:1"]'
    await into(LPG)
    await sleep(600)
    ok(fs.existsSync(demo.path), 'a page from there is fetched for its still preview')
    await tap(`${LPG} .fx-run`)
    ok((await js(`return document.querySelector(${JSON.stringify(`${LPG} iframe`)}).src.includes('run=1')`)), 'and runs here')
    await tap(`${LPG} [data-fx=stop]`)
    // a plain file: brought when it is opened, saying how far it is
    const LF = '#m-l2 .fx-file'
    await into(LF)
    ok((await js(`return document.querySelector(${JSON.stringify(`${LF} .fx-what small`)}).textContent`)) === `PDF · ${await js(`return fxSize(${notes.size})`)} · from Workstation`, 'a document from there has its card, with Open')
    ok(await js(`const m = document.querySelector(${JSON.stringify(`${LF} .fx-what small`)}); return m.scrollWidth <= m.clientWidth`), 'and the line that says so fits its card: nothing cut')
    ok(!fs.existsSync(notes.path), '(not fetched until it is asked for)')
    link.wait = 120
    opened.length = 0
    await tap(`${LF} [data-fx=open]`)
    const said = await until(async () => {
      const s = await js(`return document.querySelector(${JSON.stringify(`${LF} .fx-what small`)}).textContent`)
      return /^\d+% · coming from Workstation$/.test(s) ? s : null
    }, 4000)
    ok(said, 'Open: its card says it is coming from there, and how far', said)
    const line = await js(`const c = document.querySelector(${JSON.stringify(LF)}); const m = c.querySelector('.fx-what small'); return { fits: m.scrollWidth <= m.clientWidth, getting: c.classList.contains('getting'), got: Number(getComputedStyle(c).getPropertyValue('--got')), w: c.getBoundingClientRect().width }`)
    ok(line.fits && line.getting && line.got > 0 && line.got < 1, 'all of that line shows (nothing cut), and a line along the card\'s foot shows how far', line)
    ok(await js(`return [...document.querySelectorAll(${JSON.stringify(`${LF} button`)})].every((b) => b.disabled)`), 'its buttons wait meanwhile')
    await shot('linked-3-getting')
    ok(await until(() => opened.length > 0, 8000), 'then it opens')
    link.wait = 25
    ok(opened[0]?.[0] === 'openFile' && opened[0][2] === notes.size && Buffer.compare(fs.readFileSync(notes.path), fs.readFileSync(path.join(host, 'notes.pdf'))) === 0, 'the whole file, byte for byte', opened[0])
    await sleep(200)
    ok((await js(`return document.querySelector(${JSON.stringify(`${LF} .fx-what small`)}).textContent`)).startsWith('PDF · ') && (await js(`return [...document.querySelectorAll(${JSON.stringify(`${LF} button`)})].every((b) => !b.disabled)`)), 'and its card says what it is again')
    opened.length = 0
    await tap(`${LF} [data-fx=show]`)
    await until(() => opened.length > 0, 3000)
    ok(opened[0]?.[0] === 'showFile' && !/coming from/i.test(await js(`return document.querySelector(${JSON.stringify(`${LF} .fx-what small`)}).textContent`)) && !(await js(`return document.querySelector(${JSON.stringify(LF)}).classList.contains('getting')`)), 'Show in Finder, now that it is here: at once')
    // the recording, opened in its own app: the rest of it comes first
    opened.length = 0
    await into(LV)
    await tap(`${LV} [data-fx=more]`)
    await until(() => vis(MENU), 2000)
    await tap(MENU + ' [data-menu-act=openFile]')
    ok(await until(() => opened.length > 0, 15000), 'Open on the recording brings the rest of it, then opens it')
    ok(opened[0]?.[2] === run.size && fs.existsSync(run.path) && !fs.existsSync(`${run.path}.part`) && Buffer.compare(fs.readFileSync(run.path), fs.readFileSync(path.join(host, 'windows-run.mp4'))) === 0, 'whole in the cache, byte for byte', opened[0])
    await tap(`${LV} [data-fx=more]`)
    await until(() => vis(MENU), 2000)
    await tap(MENU + ' [data-menu-act=copy]')
    await until(() => opened.some((o) => o[0] === 'copyFilePath'), 3000)
    ok(opened.some((o) => o[0] === 'copyFilePath'), 'Copy its path copies where it is here')
    await tap(`${LP} > video`, win, [0.5, 0.3])
    ok(await until(async () => !(await P(LP)).paused, 3000), 'and it plays on, from the cache now')
    await key('Space')
  })

  // ---- the linked computer is away, comes back, is too old, lost the file ---------------------------------------------
  await section('away', async () => {
    link.online = false
    await computer(false)
    const later = theirs('later.svg')
    const clip = theirs('night-run.mp4') // (nothing of these is in the cache)
    const notes = theirs('night-notes.pdf')
    ok(!fs.existsSync(clip.path) && !fs.existsSync(`${clip.path}.part`) && !fs.existsSync(notes.path), '(a recording and a document nothing has fetched yet)')
    await say([{ id: 'a1', kind: 'reply', from: 'Rex@workstation', text: 'While Workstation is away.', files: [clip, later, notes] }])
    const AP = '.fx-video[data-live="a1:0"] .fxp'
    let p = await until(async () => ((await P(AP))?.note ? P(AP) : null), 6000)
    ok(p?.note === "Workstation is away. This plays once it's back.", 'its computer away: the recording says so, and that it plays once it is back', p?.note)
    ok(await vis(`${AP} [data-fxp=retry]`), 'with Try again')
    ok(await until(async () => (await js(`return document.querySelector('#m-a1 .fx-pic')?.dataset.why`)) === 'On Workstation, which is away', 4000), 'a picture says it is on Workstation, which is away')
    await shot('away-1')
    await tap('#m-a1 .fx-file [data-fx=open]')
    ok(await until(() => js(`return [...document.querySelectorAll('.toast, .notice, [class*=toast], [role=alert], [role=status]')].some((n) => /Workstation is away/.test(n.textContent))`), 4000), 'opening a document from there says Workstation is away')
    ok(await js(`return [...document.querySelectorAll('#m-a1 .fx-file button')].every((b) => !b.disabled)`), 'and its card is as it was')
    await tap(`${AP} [data-fxp=retry]`)
    p = await until(async () => ((await P(AP))?.note ? P(AP) : null), 6000)
    ok(p?.note === "Workstation is away. This plays once it's back.", 'Try again, still away: the same words')
    // it comes back
    link.online = true
    files.back('workstation')
    await computer(true)
    p = await until(async () => ((await P(AP)).ready >= 2 && !(await P(AP)).note ? P(AP) : null), 8000)
    ok(p, 'Workstation is back: the recording shows its first frame by itself', await P(AP))
    ok(await until(() => js(`const i = document.querySelector('#m-a1 .fx-pic img'); return i.complete && i.naturalWidth > 0 && !document.querySelector('#m-a1 .fx-pic').classList.contains('gone')`), 6000), 'and the picture shows')
    await tap(`${AP} .fxp-big`)
    ok(await until(async () => (await P(AP)).t > 0.5, 6000), 'and it plays')
    await key('Space')
    // it goes away while one plays
    await tap(`${AP} > video`, win, [0.5, 0.3])
    link.online = false
    await computer(false)
    await key('9')
    p = await until(async () => ((await P(AP))?.note ? P(AP) : null), 9000)
    ok(p?.note === "Workstation is away. This plays once it's back.", 'it goes away mid-play, and a jump needs a part that is not here: the player says so', p?.note)
    link.online = true
    files.back('workstation')
    await computer(true)
    p = await until(async () => (!(await P(AP)).note && (await P(AP)).ready >= 2 ? P(AP) : null), 8000)
    ok(p && p.t > 30, 'back again: it is where it was going, ready to play', p)
    // a file that is gone there, and a computer too old to send pieces
    const goneThere = theirs('never.mp4')
    await say([{ id: 'a2', kind: 'reply', from: 'Rex@workstation', text: 'One that is gone there.', files: [goneThere] }])
    p = await until(async () => ((await P('.fx-video[data-live="a2:0"] .fxp'))?.note ? P('.fx-video[data-live="a2:0"] .fxp') : null), 6000)
    ok(p?.note === "This file isn't kept any more.", 'a recording that is gone on its computer says it is not kept', p?.note)
    link.old = true
    const oldClip = theirs('old-run.mp4')
    const oldPic = theirs('old-shot.svg')
    await say([{ id: 'a3', kind: 'reply', from: 'Rex@workstation', text: 'From an older CLIque.', files: [oldClip, oldPic, { name: 'run.mp4', kind: 'video', size: 5e7, dur: 94, path: '', away: 'Workstation' }] }])
    p = await until(async () => ((await P('.fx-video[data-live="a3:0"] .fxp'))?.note ? P('.fx-video[data-live="a3:0"] .fxp') : null), 6000)
    ok(/runs an older CLIque, which can't send recordings/.test(p?.note ?? ''), 'from a CLIque that can\'t send pieces: the recording says to update it there', p?.note)
    ok(await until(() => js(`const i = document.querySelector('#m-a3 .fx-pic img'); return i.complete && i.naturalWidth > 0`), 6000), 'a picture from it still shows (asked for whole, as before)')
    ok((await js(`return document.querySelector('#m-a3 .fx-card.away .fx-note')?.textContent`)) === 'Kept on Workstation. Open it there.', 'and what it could never send has the card that says where it is')
    await shot('away-2-old')
    link.old = false
  })

  // ---- the floating chat -----------------------------------------------------------------------------------------------
  await section('floating', async () => {
    const chat = await open('overlay.html', { width: 520, height: 900 })
    await sleep(400)
    await js(HELPERS, chat)
    await js(`window.__cliqueEmit('toggle', { open: true, focus: false })`, chat)
    await js(`window.__cliqueState.agents.forEach((a) => Object.assign(a, { status: 'idle', ask: null, activity: null, subs: [] }))`, chat)
    await say([{ id: 'v1', kind: 'reply', from: 'Iris', text: 'The checkout run from start to finish.', files: [wide] }], chat)
    await sleep(900)
    const FP = '.fx-video[data-live="v1:0"] .fxp'
    let p = await until(async () => ((await P(FP, chat))?.ready >= 2 ? P(FP, chat) : null), 5000)
    ok(p, 'the floating chat shows the recording')
    const card = await box('.fx-video[data-live="v1:0"]', chat)
    const col = await js(`const r = document.querySelector('.fx-video').closest('.files').getBoundingClientRect(); return { x: r.x, w: r.width }`, chat)
    ok(card.x >= col.x && card.x + card.w <= col.x + col.w + 0.5 && near(p.box.w / p.box.h, 16 / 9, 0.02), 'its card fits the narrow column, same shape', [card, col])
    await tap(`${FP} .fxp-big`, chat)
    p = await until(async () => ((await P(FP, chat)).t > 0.5 ? P(FP, chat) : null), 5000)
    ok(p && !p.paused && p.bar, 'it plays there, with its bar')
    ok(!(await vis(`${FP} .fxp-full`, chat)), 'no full screen button there (the window is a small one)')
    const row = await box(`${FP} .fxp-row`, chat)
    const rate = await box(`${FP} .fxp-rate`, chat)
    ok(rate.x + rate.w <= p.box.x + p.box.w && row.w <= p.box.w + 0.5, 'its bar fits')
    await shot('floating-1', chat)
    await key('f', chat)
    await sleep(400)
    let c = (await calls(chat)).find((x) => x[0] === 'dashboard' && String(x[1]).startsWith('file:'))
    const sent = c && JSON.parse(c[1].slice(5))
    ok(sent && sent.i === 0 && sent.from?.playing === true && sent.from.t > 0.5, 'F there hands it to the main window, saying where it is and that it plays', sent?.from)
    ok((await P(FP, chat)).paused, 'and it stops in the floating chat')
    // the main window takes it from there
    await say([{ id: 'z1', kind: 'reply', from: 'Ada', text: 'Something else is on screen here.' }])
    await js(`window.__cliqueEmit('focus', ${JSON.stringify(c[1])})`)
    p = await until(async () => ((await P('.fxv .fxv-stage > .fxp'))?.t >= sent.from.t ? P('.fxv .fxv-stage > .fxp') : null), 5000)
    ok(p && !p.paused && p.t >= sent.from.t, 'the main window\'s viewer plays it on from there', p)
    await key('Escape')
    await sleep(200)
    await tap('.fx-video[data-live="v1:0"] [data-fx=view]', chat)
    await sleep(300)
    c = (await calls(chat)).find((x) => x[0] === 'dashboard' && String(x[1]).startsWith('file:'))
    ok(c && JSON.parse(c[1].slice(5)).from?.playing === false, 'the card\'s own button does the same (paused, so it says paused)')
    chat.destroy()
  })

  console.log('')
  ok(errors.length === 0, 'nothing went wrong in the pages\' consoles', errors.slice(0, 6))
  console.log(`\n${passed} held, ${failed} didn't`)
  for (const w of BrowserWindow.getAllWindows()) w.destroy()
  fs.rmSync(tmp, { recursive: true, force: true })
  app.exit(failed ? 1 : 0)
})

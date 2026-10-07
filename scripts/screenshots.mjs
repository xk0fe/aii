// Renders every view with a made-up crew (scripts/screenshot-preload.cjs) and saves PNGs, plus short GIFs of
// the animations. Nothing starts and ~/.crew is untouched. Run: npm run shots [-- out-dir [shot names...]]
import { app, BrowserWindow, nativeTheme } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-shots-'))
app.setPath('userData', path.join(tmp, 'userdata'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// What's behind the transparent windows: the popover's material, or a soft desktop for the floating pill.
const BACKDROP = {
  popover: { light: '#ececef', dark: '#2b2b2f' },
  desktop: { light: 'linear-gradient(135deg, #dfe7f5, #f1e4f1)', dark: 'linear-gradient(135deg, #1c2233, #2a1f2e)' },
}

async function open(file, { theme, width, height, backdrop }) {
  if (nativeTheme.themeSource !== theme) {
    nativeTheme.themeSource = theme
    await sleep(300)
  }
  const win = new BrowserWindow({
    width, height, show: false, paintWhenInitiallyHidden: true, useContentSize: true, frame: false,
    webPreferences: { preload: path.join(root, 'scripts', 'screenshot-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  })
  win.webContents.on('console-message', (e) => e.level === 'error' && console.error(`${file}: ${e.message}`))
  await win.loadFile(path.join(root, 'ui', file))
  if (backdrop) await win.webContents.insertCSS(`html { background: ${BACKDROP[backdrop][theme]} !important; }`)
  return win
}

const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`)

// Popover-style windows size themselves to their content through crew.fit().
async function fitToContent(win) {
  const fit = await js(win, 'return window.__crewFit')
  if (fit) win.setContentSize(Math.ceil(fit.width), Math.ceil(fit.height))
  await sleep(150)
}

async function save(win, name) {
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG())
  console.log('saved', `${name}.png`)
}

// Every frame Chromium paints, each with its real timestamp, then one GIF at the true speed.
async function record(win, name, { clip, ms, during, width = 760 }) {
  const dir = fs.mkdtempSync(path.join(tmp, `${name}-`))
  const frames = []
  const start = Date.now()
  // Keep small frames in memory and encode them afterwards: encoding on the fly would stall the main process.
  win.webContents.beginFrameSubscription(false, (image) => {
    const scale = image.getSize().width / win.getContentBounds().width
    const crop = clip ? image.crop({ x: Math.round(clip.x * scale), y: Math.round(clip.y * scale), width: Math.round(clip.width * scale), height: Math.round(clip.height * scale) }) : image
    frames.push({ image: crop.resize({ width, quality: 'good' }), at: Date.now() })
  })
  await during()
  while (Date.now() - start < ms) await sleep(50)
  win.webContents.endFrameSubscription()
  frames.forEach((f, i) => fs.writeFileSync((f.file = path.join(dir, `${String(i).padStart(4, '0')}.png`)), f.image.toPNG()))
  // a still screen paints nothing, so the last frame holds until the next one (or the end)
  const end = start + ms
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${(Math.max(1, (frames[i + 1]?.at ?? end) - f.at) / 1000).toFixed(3)}`).join('\n')
  fs.writeFileSync(path.join(dir, 'list.txt'), `${list}\nfile '${frames.at(-1).file}'\n`)
  const gif = path.join(out, `${name}.gif`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', `fps=30,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, gif])
  console.log('saved', `${name}.gif`, `(${frames.length} frames)`)
}

const click = (sel) => `document.querySelector(${JSON.stringify(sel)})?.click()`
// Real pointer input, so :hover and pointer-driven effects show up in recordings.
const center = (win, sel) => js(win, `const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }`)
async function glide(win, from, to, ms = 500) {
  const steps = Math.max(2, Math.round(ms / 16))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * e), y: Math.round(from.y + (to.y - from.y) * e) })
    await sleep(16)
  }
  return to
}
async function tap(win, at) {
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(at.x), y: Math.round(at.y), button: 'left', clickCount: 1 })
  await sleep(90)
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(at.x), y: Math.round(at.y), button: 'left', clickCount: 1 })
}

const SHOTS = {
  async tray(theme) {
    const win = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover' })
    await sleep(500)
    await fitToContent(win)
    await save(win, `tray-${theme}`)
    win.destroy()
  },
  async overlay(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await save(win, `chat-${theme}`)
    await js(win, "window.__crewEmit('toggle', { open: false })")
    await sleep(500)
    await fitToContent(win)
    await save(win, `pill-${theme}`)
    win.destroy()
  },
  async cards(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(1200)
    await save(win, `cards-${theme}`)
    win.destroy()
  },
  async stats(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=stats]'))
    await sleep(1000)
    await save(win, `stats-${theme}`)
    await js(win, click('[data-mode=cards]'))
    win.destroy()
  },
  async detail(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name=gal]'))
    await sleep(1200)
    await save(win, `detail-${theme}`)
    await js(win, "document.querySelector('.col-card').scrollTop = 99999")
    await sleep(500)
    await save(win, `detail-bottom-${theme}`)
    win.destroy()
  },
  async select(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, `${click('[data-act=select]')}; await new Promise((r) => setTimeout(r, 200)); ${click('.pcard[data-name=joseph]')}; ${click('.pcard[data-name=marc]')}`)
    await sleep(900)
    await save(win, `select-${theme}`)
    win.destroy()
  },
  async tasks(theme) {
    const win = await dashboard(theme, 'tasks')
    await js(win, "localStorage.setItem('crew.tasks.view', 'board'); localStorage.setItem('crew.tasks.done', '0')")
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    await sleep(1100)
    await save(win, `tasks-${theme}`)
    await js(win, click('.tc[data-name="12"]'))
    await sleep(900)
    await save(win, `task-panel-${theme}`)
    await js(win, click('.tp [data-tp=close]'))
    await sleep(500)
    await js(win, click('.tc[data-name="5"]'))
    await sleep(800)
    await js(win, click('.tp [data-tp=sendback]'))
    await sleep(600)
    await save(win, `task-review-${theme}`)
    await js(win, click('.tp [data-tp=close]'))
    await sleep(400)
    await js(win, click('.tk-views [data-mode=list]'))
    await sleep(800)
    await save(win, `tasks-list-${theme}`)
    await js(win, `${click('.tk-views [data-mode=board]')}; ${click('[data-filter="kind:bug"]')}`)
    await sleep(800)
    await save(win, `tasks-filtered-${theme}`)
    await js(win, click('[data-flow]'))
    await sleep(500)
    await save(win, `tasks-workflow-${theme}`)
    win.destroy()
  },
  async conversation(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name=gal]'))
    await sleep(1200)
    await js(win, "const c = document.querySelector('.col-card'); c.scrollTop = document.querySelector('.convo').offsetTop - 120")
    await sleep(500)
    await save(win, `conversation-${theme}`)
    win.destroy()
  },
  async chatTask(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(600)
    await js(win, `${click('.chip.task-chip')}; const ta = document.querySelector('.composer textarea'); ta.value = 'Shop button is hidden behind the coins counter on iPhone SE @gal'; ta.dispatchEvent(new Event('input'))`)
    await sleep(500)
    await fitToContent(win)
    await save(win, `chat-task-${theme}`)
    win.destroy()
  },
  // Add a task, start it in a new conversation, then accept another one: the board's whole loop.
  async tasksGif() {
    const win = await dashboard('light', 'tasks')
    await js(win, "localStorage.setItem('crew.tasks.view', 'board'); localStorage.setItem('crew.tasks.done', '0')")
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    await sleep(1200)
    await record(win, 'tasks-loop', {
      ms: 11500, width: 1000,
      during: async () => {
        let at = { x: 900, y: 500 }
        at = await glide(win, at, await center(win, '.tk-add textarea'), 600)
        await tap(win, at)
        await sleep(300)
        const text = 'Coins vanish when you collect two at once @david'
        for (let i = 1; i <= text.length; i++) {
          await js(win, `const ta = document.querySelector('.tk-add textarea'); ta.value = ${JSON.stringify(text)}.slice(0, ${i}); ta.dispatchEvent(new Event('input'))`)
          await sleep(26)
        }
        await sleep(450)
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
        await sleep(1300)
        at = await glide(win, at, await center(win, '.tc[data-name="14"] [data-act=start]'), 700)
        await sleep(200)
        await tap(win, at)
        await sleep(2700)
        at = await glide(win, at, await center(win, '.tc[data-name="5"] [data-act=accept]'), 900)
        await sleep(250)
        await tap(win, at)
        await sleep(1600)
        await glide(win, at, { x: at.x + 200, y: at.y + 120 }, 400)
      },
    })
    win.destroy()
  },
  // A long conversation, then a clean slate: the gauge drains and the feed marks where the new one starts.
  async freshGif() {
    const win = await dashboard('light', 'grid')
    await sleep(1500)
    const tile = await js(win, "const r = document.querySelector('.tile[data-name=david]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    await record(win, 'fresh-start', {
      clip: { x: tile.x, y: tile.y, width: tile.width, height: 46 }, ms: 4200, width: 900,
      during: async () => {
        let at = { x: tile.x + tile.width - 300, y: tile.y + 23 }
        await sleep(500)
        at = await glide(win, at, await center(win, '.tile[data-name=david] [data-act=fresh]'), 700)
        await sleep(600)
        await tap(win, at)
        await sleep(2000)
      },
    })
    win.destroy()
  },
  // A thread in the chat: a long reply folded under "Show more", quoting the hand-off it answers.
  async chatThread(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, "document.querySelector('#m-f6c').scrollIntoView({ block: 'end' }); document.querySelector('.feed').scrollTop += 16")
    await sleep(500)
    await save(win, `chat-thread-${theme}`)
    win.destroy()
  },
  // Every kind of terminal ribbon at once: live, mirrored from another computer, replaying, offline, ended.
  async ribbons(theme) {
    const win = await dashboard(theme, 'grid', { width: 1920, height: 1080 })
    await sleep(1500)
    await js(win, `
      const s = window.__crewState
      const by = (n) => s.agents.find((a) => a.name === n)
      by('jeff').status = 'stopped'
      window.__crewBufferDelay = 600000
      by('arie').convo = { ...by('arie').convo, since: Date.now() }
      window.__crewEmit('state', s)`)
    await sleep(900)
    await js(win, "document.querySelector('.terms').scrollTop = 99999")
    await sleep(500)
    await save(win, `ribbons-${theme}`)
    await js(win, "const s = window.__crewState; s.agents.find((a) => a.name === 'scarlett@mac-mini').status = 'away'; window.__crewEmit('state', s)")
    await sleep(700)
    await save(win, `ribbons-offline-${theme}`)
    win.destroy()
  },
  // Opening a terminal replays what the agent printed before: the ribbon says so, then turns live.
  async ribbonGif() {
    const win = await dashboard('dark', 'grid', { width: 1920, height: 1080 })
    await sleep(1500)
    const tile = await js(win, "const r = document.querySelector('.tile[data-name=arie]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    await record(win, 'ribbon-replay', {
      clip: tile, ms: 4200, width: 900,
      during: async () => {
        await sleep(600)
        await js(win, "window.__crewBufferDelay = 1800; const s = window.__crewState; const a = s.agents.find((x) => x.name === 'arie'); a.convo = { ...a.convo, since: Date.now() }; window.__crewEmit('state', s)")
        await sleep(3000)
      },
    })
    win.destroy()
  },
  // The recipient line: hover the faces for who's who, pick one, and the message box says who it's for.
  async railGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await sleep(300)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + r.height - 300), width: Math.round(r.width), height: 300 }")
    await record(win, 'rail', {
      clip: panel, ms: 6200, width: 800,
      during: async () => {
        let at = { x: panel.x + 200, y: panel.y + 40 }
        for (const name of ['joseph', 'david', 'gal', 'marc', 'scarlett@mac-mini']) {
          at = await glide(win, at, await center(win, `.chip[data-to="${name}"]`), 380)
          await sleep(320)
        }
        at = await glide(win, at, await center(win, '.chip[data-to=marc]'), 400)
        await sleep(200)
        await tap(win, at)
        await sleep(900)
        at = await glide(win, at, await center(win, '.chip[data-to=auto]'), 500)
        await sleep(200)
        await tap(win, at)
        await sleep(600)
        await glide(win, at, { x: at.x + 60, y: at.y + 90 }, 400)
      },
    })
    win.destroy()
  },
  // The pill at the top of the screen: it lies flat and the chat opens below it.
  async chatBelow(theme) {
    const win = await open('overlay.html', { theme, width: 640, height: 760, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('place', { side: 'below', align: 'center' }); window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(800)
    await fitToContent(win)
    await save(win, `chat-below-${theme}`)
    win.destroy()
  },
  // An agent's own context limit: joseph's 1M window held to 250k.
  async limit(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name=joseph]'))
    await sleep(1200)
    await js(win, "const c = document.querySelector('.col-card'); c.scrollTop = document.querySelector('.convo').offsetTop - 140")
    await sleep(500)
    await save(win, `limit-${theme}`)
    win.destroy()
  },
  // Setting one: gal is already past 150k, so the note says what happens on Save; then "Just tell me".
  async limitGif() {
    const win = await dashboard('light', 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name=gal]'))
    await sleep(1200)
    await js(win, "const c = document.querySelector('.col-card'); c.scrollTop = document.querySelector('.convo').offsetTop - 140")
    await sleep(500)
    const box = await js(win, "const r = document.querySelector('.convo').getBoundingClientRect(); const l = document.querySelector('.limit').getBoundingClientRect(); return { x: Math.round(r.x) - 16, y: Math.round(r.y) - 40, width: Math.round(r.width) + 32, height: Math.round(l.bottom - r.y) + 56 }")
    await record(win, 'context-limit', {
      clip: box, ms: 6400, width: 900,
      during: async () => {
        let at = { x: box.x + box.width - 40, y: box.y + 30 }
        await sleep(400)
        at = await glide(win, at, await center(win, '[data-pick=contextLimit] .pill[data-v="150000"]'), 700)
        await sleep(250)
        await tap(win, at)
        await sleep(1300)
        at = await glide(win, at, await center(win, '[data-pick=onContextLimit] .pill[data-v=notify]'), 600)
        await sleep(250)
        await tap(win, at)
        await sleep(1200)
        at = await glide(win, at, await center(win, '[data-pick=onContextLimit] .pill[data-v=fresh]'), 500)
        await sleep(250)
        await tap(win, at)
        await sleep(700)
      },
    })
    win.destroy()
  },
  async focus(theme) {
    const win = await dashboard(theme, 'focus')
    await sleep(1500)
    await save(win, `focus-${theme}`)
    win.destroy()
  },
  async grid(theme) {
    const win = await dashboard(theme, 'grid')
    await sleep(1500)
    await save(win, `grid-${theme}`)
    win.destroy()
  },
  // Dictation: the composer while it listens (scripted words, a tone for a voice; no microphone).
  async voice(theme) {
    const win = await dashboard(theme, 'crew')
    await sleep(600)
    await tap(win, await center(win, '.chat .mic'))
    await sleep(2600)
    await save(win, `voice-${theme}`)
    win.destroy()
  },
  // The Cards/Stats switch: the header must not move.
  async tabsGif() {
    const win = await dashboard('light', 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(900)
    const head = await js(win, "const r = document.querySelector('.col-head').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height + 230) }")
    await record(win, 'tabs', {
      clip: head, ms: 3600, width: 900,
      during: async () => {
        for (const m of ['stats', 'cards', 'stats', 'cards']) {
          await sleep(700)
          await js(win, click(`[data-mode=${m}]`))
        }
      },
    })
    win.destroy()
  },
  // Sidebar: hovering a row reveals the modes that are off; flip one, then wake a sleeping agent.
  async sidebarGif() {
    const win = await dashboard('light', 'crew')
    await sleep(900)
    const side = await js(win, "const r = document.querySelector('.side').getBoundingClientRect(); return { x: 0, y: Math.round(r.y), width: Math.round(r.width), height: Math.min(720, Math.round(r.height)) }")
    await record(win, 'sidebar', {
      clip: side, ms: 7000, width: 340,
      during: async () => {
        let at = { x: 400, y: 300 }
        await sleep(300)
        at = await glide(win, at, await center(win, '.agent[data-agent=gal] .area'), 700)
        await sleep(500)
        at = await glide(win, at, await center(win, '.agent[data-agent=gal] .mode.yolo'), 400)
        await sleep(250)
        await tap(win, at)
        await sleep(700)
        at = await glide(win, at, await center(win, '.agent[data-agent=marc] .mode.fast'), 600)
        await sleep(300)
        await tap(win, at)
        await sleep(600)
        await tap(win, at)
        await sleep(600)
        at = await glide(win, at, await center(win, '[data-power=ye]'), 600)
        await sleep(250)
        await tap(win, at)
        await sleep(1200)
        await glide(win, at, { x: 400, y: at.y }, 400)
      },
    })
    win.destroy()
  },
  // Cards: the holo tilt, the foil sheen and the creature's eyes following the pointer.
  async hoverGif() {
    const win = await dashboard('light', 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(1200)
    const grid = await js(win, "const r = document.querySelector('.col-grid').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) - 4, width: Math.round(r.width), height: 520 }")
    await record(win, 'card-hover', {
      clip: grid, ms: 6600, width: 820,
      during: async () => {
        const j = await center(win, '.pcard[data-name=joseph]')
        const g = await center(win, '.pcard[data-name=gal]')
        let at = { x: j.x - j.w, y: j.y }
        at = await glide(win, at, { x: j.x - j.w * 0.4, y: j.y - j.h * 0.35 }, 500)
        at = await glide(win, at, { x: j.x + j.w * 0.4, y: j.y - j.h * 0.3 }, 900)
        at = await glide(win, at, { x: j.x + j.w * 0.35, y: j.y + j.h * 0.38 }, 700)
        at = await glide(win, at, { x: j.x - j.w * 0.4, y: j.y + j.h * 0.35 }, 900)
        at = await glide(win, at, { x: g.x + g.w * 0.3, y: g.y - g.h * 0.2 }, 800)
        at = await glide(win, at, { x: g.x - g.w * 0.35, y: g.y + g.h * 0.3 }, 800)
        await glide(win, at, { x: g.x + g.w * 2, y: g.y + g.h }, 300)
        // joseph finishes a task, and that task is the one that levels it up: confetti
        await js(win, "const j = window.__crewState.agents[0]; Object.assign(j, { status: 'idle', activity: '' }); j.stats.turns += 1; window.__crewEmit('state', window.__crewState)")
        await sleep(1200)
      },
    })
    win.destroy()
  },
  // Opening a card and going back.
  async detailGif() {
    const win = await dashboard('light', 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(1200)
    await record(win, 'card-open', {
      ms: 3200, width: 900,
      during: async () => {
        await sleep(400)
        await js(win, click('.pcard[data-name=gal]'))
        await sleep(1500)
        await js(win, click('.pd-back'))
        await sleep(900)
      },
    })
    win.destroy()
  },
}

async function dashboard(theme, view, { width = 1440, height = 880 } = {}) {
  const win = await open('dashboard.html', { theme, width, height })
  await js(win, `localStorage.setItem('crew.view', '${view}')`)
  win.webContents.reload()
  await new Promise((r) => win.webContents.once('did-finish-load', r))
  await sleep(500)
  return win
}

// [out-dir] [shot names...]: the first argument is the folder unless it names a shot
const args = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('screenshots.mjs') && a !== '.')
const out = path.resolve(args[0] && !(args[0] in SHOTS) ? args.shift() : path.join(root, 'dist', 'shots'))
const only = args
fs.mkdirSync(out, { recursive: true })

app.on('window-all-closed', () => {}) // one window at a time; don't quit between them

app.whenReady().then(async () => {
  try {
    for (const [name, fn] of Object.entries(SHOTS)) {
      if (only.length && !only.includes(name)) continue
      if (name.endsWith('Gif')) await fn()
      else for (const theme of ['light', 'dark']) await fn(theme)
    }
  } catch (e) {
    console.error(e)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  app.exit(0)
})

// Renders every view with a made-up crew (scripts/screenshot-preload.cjs) and saves PNGs, plus short GIFs of
// the animations. Nothing starts and ~/.crew is untouched. Run: npm run shots [-- out-dir [shot names...]] [--webp]
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

async function open(file, { theme, width, height, backdrop, fixture, transparent = false }) {
  if (nativeTheme.themeSource !== theme) {
    nativeTheme.themeSource = theme
    await sleep(300)
  }
  const win = new BrowserWindow({
    width, height, show: false, paintWhenInitiallyHidden: true, useContentSize: true, frame: false, transparent,
    webPreferences: { preload: path.join(root, 'scripts', 'screenshot-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  })
  win.webContents.on('console-message', (e) => e.level === 'error' && console.error(`${file}: ${e.message}`))
  await win.loadFile(path.join(root, 'ui', file), fixture ? { query: { fixture } } : {})
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
  // --webp: an animated WebP from the same frames too, full color and a fraction of the GIF's size (the README uses these)
  if (!process.argv.includes('--webp')) return
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', `fps=25,scale=${width}:-1:flags=lanczos`, '-c:v', 'libwebp_anim', '-q:v', '80', '-compression_level', '6', '-loop', '0', path.join(out, `${name}.webp`)])
  console.log('saved', `${name}.webp`)
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
  // The README's cover (scripts/cover.html): one picture, with see-through rounded corners.
  async cover(theme) {
    if (theme !== 'light') return
    const win = await open('../scripts/cover.html', { theme, width: 1280, height: 640, transparent: true })
    await sleep(800)
    await save(win, 'cover')
    win.destroy()
  },
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
  // The agent's sheet: no scrolling, one tab at a time.
  async detail(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name=gal]'))
    await sleep(1200)
    await save(win, `detail-${theme}`)
    for (const tab of ['instructions', 'look', 'stats']) {
      await js(win, click(`.ed-tabs [data-tab=${tab}]`))
      await sleep(600)
      await save(win, `detail-${tab}-${theme}`)
    }
    await js(win, click('.ed-tabs [data-tab=setup]'))
    win.destroy()
  },
  // A new agent: a random creature and an empty name to type.
  async create(theme) {
    const win = await dashboard(theme, 'crew')
    await sleep(300)
    await js(win, click('.pcard.add'))
    await sleep(1000)
    await save(win, `create-${theme}`)
    win.destroy()
  },
  // Moving an agent to another computer: the sheet that asks where its folder is there.
  async move(theme) {
    const win = await dashboard(theme, 'crew', { fixture: 'big' })
    await sleep(900)
    await js(win, "moveSheet('gal', 'mac-mini')")
    await sleep(900)
    await save(win, `move-${theme}`)
    win.destroy()
  },
  // Computers: this one shared, the Mac mini linked, the Air asleep.
  async computers(theme) {
    const win = await dashboard(theme, 'crew', { fixture: 'big' })
    await sleep(900)
    await js(win, click('.link-chip'))
    await sleep(800)
    await save(win, `computers-${theme}`)
    win.destroy()
  },
  // Phones: a code open to pair one, and two paired phones (one connected), under the computers.
  async phones(theme) {
    const win = await dashboard(theme, 'crew')
    await sleep(900)
    await js(win, click('.link-chip'))
    await sleep(500)
    await js(win, click('[data-phone-add]'))
    await sleep(700)
    await js(win, "document.querySelector('#link .phones').scrollIntoView({ block: 'end' })")
    await sleep(400)
    await save(win, `phones-${theme}`)
    win.destroy()
  },
  // Right-click an agent: everything you can do with it, Move to… included.
  async menu(theme) {
    const win = await dashboard(theme, 'grid', { fixture: 'big' })
    await sleep(1200)
    const at = await center(win, '.roster .crow[data-agent=marc]')
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(at.x), y: Math.round(at.y) })
    await sleep(200)
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(at.x), y: Math.round(at.y), button: 'right', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(at.x), y: Math.round(at.y), button: 'right', clickCount: 1 })
    await sleep(600)
    await save(win, `menu-${theme}`)
    win.destroy()
  },
  async select(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, `${click('.col-head [data-act=more]')}; await new Promise((r) => setTimeout(r, 200)); ${click('.menu [data-menu-act=select]')}; await new Promise((r) => setTimeout(r, 200)); ${click('.pcard[data-name=joseph]')}; ${click('.pcard[data-name=marc]')}`)
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
    await js(win, click('[data-board-menu]'))
    await sleep(300)
    await js(win, click('.tk-pop [data-flow]'))
    await sleep(500)
    await save(win, `tasks-workflow-${theme}`)
    win.destroy()
  },
  // Several tasks picked (⌘-click, then Shift-click for a run of them) and the bar that acts on them all, on the
  // board and in the list; then the header's ⋯ for clearing the board, with the chat's one line for a bulk action.
  async tasksBulk(theme) {
    const win = await dashboard(theme, 'tasks')
    await js(win, "localStorage.setItem('crew.tasks.view', 'board'); localStorage.setItem('crew.tasks.done', '1')")
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    await sleep(1100)
    const pick = (key, mods) => `document.querySelector('.tc[data-name="${key}"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, ${mods} }))`
    await js(win, `${pick(11, 'metaKey: true')}; ${pick(13, 'shiftKey: true')}; ${pick(7, 'metaKey: true')}`)
    await sleep(800)
    await save(win, `tasks-bulk-${theme}`)
    await js(win, click('.tk-bulk [data-bulk=owner]'))
    await sleep(500)
    await save(win, `tasks-bulk-assign-${theme}`)
    await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); " + click('.tk-views [data-mode=list]'))
    await sleep(800)
    await save(win, `tasks-bulk-list-${theme}`)
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); ${click('.tk-views [data-mode=board]')}
      window.__crewState.feed.push({ id: 'bk1', kind: 'task', type: 'task', act: 'bulk', from: 'you', text: 'closed 23 tasks', count: 23, ts: Date.now() })
      window.__crewEmit('state', window.__crewState)`)
    await sleep(700)
    await js(win, click('[data-board-menu]'))
    await sleep(500)
    await save(win, `tasks-board-menu-${theme}`)
    win.destroy()
  },
  async conversation(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name=gal]'))
    await sleep(1200)
    await js(win, click('.ed-tabs [data-tab=stats]'))
    await sleep(600)
    const box = await js(win, "const r = document.querySelector('.ed').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    const img = await win.webContents.capturePage(box)
    fs.writeFileSync(path.join(out, `conversation-${theme}.png`), img.toPNG())
    console.log('saved', `conversation-${theme}.png`)
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
  // Switching workspaces: the switcher, Home, then back to Golf app from the sidebar's dock. The crew slides over.
  async workspacesGif() {
    const win = await dashboard('light', 'crew', { fixture: 'workspaces', width: 1280, height: 800 })
    await sleep(1200)
    await record(win, 'workspaces', {
      ms: 7600, width: 1000,
      during: async () => {
        let at = { x: 640, y: 420 }
        at = await glide(win, at, await center(win, '.ws-switch'), 650)
        await tap(win, at)
        await sleep(900)
        at = await glide(win, at, await center(win, '.ws-row[data-ws=default]'), 600)
        await sleep(350)
        await tap(win, at)
        await sleep(1500)
        at = await glide(win, at, await center(win, '.ws-dock [data-ws=golf]'), 800)
        await sleep(300)
        await tap(win, at)
        await sleep(1400)
        await glide(win, at, { x: at.x + 260, y: at.y - 240 }, 500)
      },
    })
    win.destroy()
  },
  async tasksGif() {
    const win = await dashboard('light', 'tasks')
    await js(win, "localStorage.setItem('crew.tasks.view', 'board'); localStorage.setItem('crew.tasks.done', '0')")
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    await sleep(1200)
    // the sidebar and the board, without the chat column, so the cards stay readable
    const board = await js(win, "return { x: 0, y: 0, width: Math.round(document.querySelector('.chat').getBoundingClientRect().x), height: innerHeight }")
    await record(win, 'tasks-loop', {
      clip: board, ms: 11500, width: 1000,
      during: async () => {
        let at = { x: 900, y: 500 }
        at = await glide(win, at, await center(win, '[data-new-task]'), 600)
        await tap(win, at)
        await sleep(500)
        at = await glide(win, at, await center(win, '.tk-add textarea'), 400)
        await tap(win, at)
        await sleep(300)
        const text = 'Coins vanish when you collect two at once @david ' // the space closes the @ picker, so Enter adds the task
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
  // Right of way: arie waits on joseph's answer, joseph answers first instead of asking back, and earlier answers,
  // hand-offs taken together, a file left to its editor and a declined task (?fixture=row).
  async rightOfWay(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 700, backdrop: 'desktop', fixture: 'row' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(900)
    await fitToContent(win)
    await save(win, `right-of-way-${theme}`)
    win.destroy()
  },
  // arie asks joseph something while joseph is busy: it waits on joseph, joseph answers mid-task and carries on, and
  // arie goes on with the answer.
  async rightOfWayGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop', fixture: 'row' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await sleep(300)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + 40), width: Math.round(r.width) + 80, height: Math.round(r.height - 200) }")
    const step = (code) => js(win, `const s = window.__crewState; const a = (n) => s.agents.find((x) => x.name === n); ${code}; window.__crewEmit('state', s)`)
    await record(win, 'right-of-way', {
      clip: panel, ms: 9500, width: 760,
      during: async () => {
        // before: both at work, nobody waiting
        await step("s.feed.splice(s.feed.findIndex((e) => e.id === 'q1')); Object.assign(a('arie'), { waitingOn: [], activity: 'Read · RELEASE.md', since: Date.now() - 60000 }); a('joseph').owes = []")
        await sleep(1200)
        await step("s.feed.push({ id: 'g1', kind: 'msg', from: 'arie', to: 'joseph', ask: true, text: 'Which port does the staging API listen on?', ts: Date.now() }); a('arie').waitingOn = [{ name: 'joseph', since: Date.now(), id: 'g1', text: 'Which port does the staging API listen on?' }]; a('joseph').owes = [{ name: 'arie', since: Date.now(), id: 'g1', waiting: true }]")
        await sleep(1400)
        await step("a('joseph').activity = 'Bash · crew answer'")
        await sleep(900)
        await step("const q = s.feed.find((e) => e.id === 'g1'); s.feed.push({ id: 'g2', kind: 'reply', from: 'joseph', re: 'g1', text: '4000. Staging and local use the same port.', ts: Date.now() }); q.answered = { by: 'joseph', at: Date.now(), reply: 'g2' }; a('arie').waitingOn = []; a('arie').activity = 'Edit · deploy/staging.env'; a('joseph').owes = []; a('joseph').activity = 'Edit · core/hub.js'")
        await sleep(1600)
        await step("a('arie').activity = 'Bash · curl localhost:4000/health'")
        await sleep(1800)
      },
    })
    win.destroy()
  },
  // The same in the dashboard: the sidebar and the chat both say who's waiting on whom.
  async rightOfWayDash(theme) {
    const win = await dashboard(theme, 'crew', { fixture: 'row' })
    await sleep(900)
    await save(win, `right-of-way-dash-${theme}`)
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
        at = await glide(win, at, await center(win, '[data-pick-to]'), 500)
        await tap(win, at)
        await sleep(500)
        at = await glide(win, at, await center(win, '.menu [data-menu-act=marc]'), 500)
        await sleep(200)
        await tap(win, at)
        await sleep(900)
        at = await glide(win, at, await center(win, '[data-pick-to]'), 500)
        await tap(win, at)
        await sleep(500)
        at = await glide(win, at, await center(win, '.menu [data-menu-act=auto]'), 500)
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
  // marc splits its work: two sub-agents start, step through their tools, and finish.
  async subsGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await sleep(300)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + 40), width: Math.round(r.width) + 80, height: Math.round(r.height - 200) }")
    const step = (code) => js(win, `const s = window.__crewState; const m = s.agents.find((a) => a.name === 'marc'); ${code}; window.__crewEmit('state', s)`)
    await record(win, 'subagents', {
      clip: panel, ms: 9000, width: 760,
      during: async () => {
        await step("s.agents.forEach((a) => (a.subs = [])); m.subs = []")
        await sleep(800)
        await step("m.subs.push({ id: 'm1', type: 'Explore', description: 'Collect the brand palette', started: Date.now(), ended: null, tools: 0, activity: '' })")
        await sleep(500)
        await step("m.subs.push({ id: 'm2', type: 'general-purpose', description: 'Sketch three hero layouts', started: Date.now(), ended: null, tools: 0, activity: '' })")
        const acts = [['m1', 'Glob · **/*.css'], ['m2', 'Read · onboarding.md'], ['m1', 'Grep · --brand-'], ['m2', 'image_gen · layout A'], ['m1', 'Read · tokens.css'], ['m2', 'image_gen · layout B']]
        for (const [id, act] of acts) {
          await sleep(650)
          await step(`const x = m.subs.find((y) => y.id === '${id}'); x.tools += 1; x.activity = ${JSON.stringify(act)}`)
        }
        await sleep(700)
        await step("Object.assign(m.subs[0], { ended: Date.now(), activity: '' })")
        await sleep(1500)
        await step("Object.assign(m.subs[1], { ended: Date.now(), activity: '' })")
        await sleep(1500)
        await step('m.subs = []')
        await sleep(600)
      },
    })
    win.destroy()
  },
  // Replies you haven't read: a dot and a ring on each, the "New" line above the first, a count on the creatures.
  async unread(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, "document.querySelector('.new-line').scrollIntoView({ block: 'start' }); document.querySelector('.feed').scrollTop -= 20")
    await sleep(500)
    await save(win, `unread-${theme}`)
    win.destroy()
  },
  // Reading: a reply that's been on screen for a moment (with the window focused) is read, and the badges go.
  async readGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    // an offscreen window never has focus; the chat only counts what you could actually have seen
    await js(win, "document.hasFocus = () => true; window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, "document.querySelector('.feed').scrollTop = 0")
    await sleep(400)
    await record(win, 'read', {
      ms: 6500, width: 760,
      during: async () => {
        await sleep(900)
        await js(win, "document.querySelector('#m-f6c').scrollIntoView({ block: 'start', behavior: 'smooth' })")
        await sleep(2400)
        await js(win, "document.querySelector('#m-f8').scrollIntoView({ block: 'center', behavior: 'smooth' })")
        await sleep(2600)
      },
    })
    const left = await js(win, "return JSON.stringify(window.__crewState.reads.agents)")
    console.log('reads after:', left)
    win.destroy()
  },
  // Reply to a message from its hover toolbar, then the thread follows the answer; Esc leaves it.
  async replyGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, "document.querySelector('#m-f8').scrollIntoView({ block: 'center' })")
    await sleep(400)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + 48), width: Math.round(r.width), height: Math.round(r.height - 48) }")
    const typeOut = async (text) => {
      for (const ch of text) {
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch })
        await sleep(40)
      }
    }
    const key = async (keyCode) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
      await sleep(200)
    }
    await record(win, 'reply', {
      clip: panel, ms: 10500, width: 800,
      during: async () => {
        let at = { x: panel.x + 60, y: panel.y + 60 }
        at = await glide(win, at, await center(win, '#m-f8 .bubble'), 700)
        await sleep(500)
        at = await glide(win, at, await center(win, '#m-f8 .msg-tool'), 400)
        await sleep(250)
        await tap(win, at)
        await sleep(700)
        await typeOut('Ship it, and add a test for hub.reply')
        await sleep(300)
        await key('Return')
        await sleep(1300)
        await js(win, "const s = window.__crewState; const mine = s.feed.findLast((e) => e.from === 'you'); s.feed.push({ id: 'r-ship', kind: 'reply', from: 'joseph', to: 'you', re: mine.id, text: 'Shipped, and hub.reply has a test now: 43 passing.', ts: Date.now() }); window.__crewEmit('state', s)")
        await sleep(2200)
        await key('Escape')
        await sleep(1200)
      },
    })
    win.destroy()
  },
  // New conversation is for one message, in marc's conversation: what you send next goes on in the new one.
  async threadGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "localStorage.setItem('crew.fresh', '0'); window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + r.height - 420), width: Math.round(r.width), height: 420 }")
    const typeOut = async (text) => {
      for (const ch of text) {
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch })
        await sleep(40)
      }
    }
    const enter = async () => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    }
    await record(win, 'thread', {
      clip: panel, ms: 10000, width: 800,
      during: async () => {
        let at = { x: panel.x + 200, y: panel.y + 100 }
        at = await glide(win, at, await center(win, '[data-pick-to]'), 600)
        await tap(win, at)
        await sleep(400)
        at = await glide(win, at, await center(win, '.menu [data-menu-act=marc]'), 400)
        await tap(win, at)
        await sleep(400)
        at = await glide(win, at, await center(win, '.fresh-toggle'), 500)
        await tap(win, at)
        await sleep(600)
        await js(win, "document.querySelector('.composer textarea').focus()")
        await typeOut('Draft three onboarding illustrations')
        await sleep(300)
        await enter()
        await sleep(1600)
        await typeOut('Keep them pastel, like our creatures')
        await sleep(300)
        await enter()
        await sleep(2200)
      },
    })
    win.destroy()
  },
  // Scrolled up while replies come in: nothing moves, and a pill at the bottom counts them.
  async latest(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, "document.querySelector('.feed').scrollTop = 0")
    await sleep(400)
    for (let i = 0; i < 3; i++) {
      await js(win, `const s = window.__crewState; s.feed.push({ id: 'late${i}', kind: 'reply', from: 'joseph', to: 'you', text: 'Reply ${i + 1} while you read', ts: Date.now() }); window.__crewEmit('state', s)`)
      await sleep(250)
    }
    await sleep(600)
    await save(win, `latest-${theme}`)
    win.destroy()
  },
  // Reading an older message while replies arrive: it holds still, the pill counts up, and a click goes down.
  // A long history, so the oldest messages drop off the top as new ones come in (the chat keeps the last 80).
  async latestGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, `const s = window.__crewState; const t0 = Date.now() - 3 * 3600000
      const said = ['Checked the save file migration.', 'Tests are green on CI.', 'Left a note on the pause menu task.', 'Bumped the coin sound volume a little.']
      s.feed.unshift(...Array.from({ length: 90 }, (_, i) => ({ id: 'old' + i, kind: 'reply', from: ['joseph', 'david', 'gal', 'marc'][i % 4], to: 'you', text: said[i % 4], ts: t0 + i * 60000 })))
      window.__crewEmit('state', s); window.__crewEmit('toggle', { open: true, focus: false })`)
    await sleep(900)
    await fitToContent(win)
    await js(win, "document.querySelector('#m-old60').scrollIntoView({ block: 'start' })")
    await sleep(500)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    const say = (i, from, text) => js(win, `const s = window.__crewState; s.feed.push({ id: 'late${i}', kind: 'reply', from: '${from}', to: 'you', text: ${JSON.stringify(text)}, ts: Date.now() }); window.__crewEmit('state', s)`)
    await record(win, 'latest', {
      clip: panel, ms: 8200, width: 760,
      during: async () => {
        let at = { x: panel.x + 200, y: panel.y + 220 }
        await sleep(900)
        await say(0, 'joseph', 'Pushed the fix for the reply threading.')
        await sleep(1100)
        await say(1, 'david', 'Reviewed it, two small notes in the PR.')
        await sleep(1100)
        await say(2, 'marc', 'Hero illustration is ready in assets/hero.png')
        await sleep(1300)
        // (an older build has no pill: then the recording just ends here)
        if (await js(win, "return !!document.querySelector('.feed-latest button')")) {
          at = await glide(win, at, await center(win, '.feed-latest button'), 700)
          await sleep(300)
          await tap(win, at)
        }
        await sleep(1800)
      },
    })
    win.destroy()
  },
  // A reply that used sub-agents, its list opened.
  async subsReply(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, "document.querySelector('#m-f8 details summary').click()")
    await sleep(400)
    await js(win, "document.querySelector('#m-f8').scrollIntoView({ block: 'end' }); document.querySelector('.feed').scrollTop += 12")
    await sleep(400)
    await save(win, `subs-reply-${theme}`)
    win.destroy()
  },
  // @ in the message box: the crew pops up, filtered as you type.
  async mention(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    const type = (text) => js(win, `const ta = document.querySelector('.composer textarea'); ta.focus(); ta.value = ${JSON.stringify(text)}; ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input', { bubbles: true }))`)
    await type('Can you two check the payload? @')
    await sleep(500)
    await save(win, `mention-${theme}`)
    await type('Can you two check the payload? @ar')
    await sleep(400)
    await save(win, `mention-filter-${theme}`)
    // picked: mentions take their agent's color; one that's off, or that nobody has, is underlined
    await type('Pair on the payload @david @marc, loop in @ye and @nobody ')
    await sleep(400)
    await save(win, `mention-ink-${theme}`)
    win.destroy()
  },
  async mentionGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await sleep(300)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + r.height - 440), width: Math.round(r.width), height: 440 }")
    const key = async (keyCode) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
      await sleep(260)
    }
    const typeOut = async (text) => {
      for (const ch of text) {
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch })
        await sleep(55)
      }
    }
    await record(win, 'mentions', {
      clip: panel, ms: 7800, width: 800,
      during: async () => {
        await js(win, "document.querySelector('.composer textarea').focus()")
        await sleep(300)
        await typeOut('Pair on the payload ')
        await typeOut('@')
        await sleep(700)
        await typeOut('da')
        await sleep(600)
        await key('Return')
        await sleep(300)
        await typeOut('and ')
        await typeOut('@')
        await sleep(500)
        await key('Down')
        await key('Down')
        await key('Down')
        await sleep(300)
        await key('Tab')
        await sleep(1000)
      },
    })
    win.destroy()
  },
  // Your conversation with one agent: click its face in the chat, and the chat is the two of you.
  async convo(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, click('.item.said .face[data-agent=joseph]'))
    await sleep(900)
    await save(win, `convo-${theme}`)
    win.destroy()
  },
  // The same in the dashboard's chat column.
  async convoDash(theme) {
    const win = await dashboard(theme, 'crew')
    await sleep(700)
    await js(win, click('.chat .item.said .face[data-agent=joseph]'))
    await sleep(900)
    const box = await js(win, "const r = document.querySelector('.chat').getBoundingClientRect(); return { x: Math.round(r.x), y: 0, width: Math.round(r.width), height: Math.round(r.bottom) }")
    fs.writeFileSync(path.join(out, `convo-dash-${theme}.png`), (await win.webContents.capturePage(box)).toPNG())
    console.log('saved', `convo-dash-${theme}.png`)
    win.destroy()
  },
  // Into joseph's conversation from his face, a message (with @david brought in), and back to everyone.
  async convoGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "localStorage.setItem('crew.fresh', '0'); window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, "document.querySelector('#m-f8').scrollIntoView({ block: 'center' })")
    await sleep(400)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    const typeOut = async (text) => {
      for (const ch of text) {
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch })
        await sleep(45)
      }
    }
    const key = async (keyCode) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
      await sleep(260)
    }
    await record(win, 'convo', {
      clip: panel, ms: 12500, width: 800,
      during: async () => {
        let at = { x: panel.x + 260, y: panel.y + 300 }
        await sleep(600)
        at = await glide(win, at, await center(win, '#m-f8 .face'), 800)
        await sleep(350)
        await tap(win, at)
        await sleep(1400)
        await js(win, "document.querySelector('.composer textarea').focus()")
        await typeOut('Run the suite once more and post the numbers for ')
        await typeOut('@')
        await sleep(500)
        await typeOut('da')
        await sleep(500)
        await key('Return')
        await sleep(400)
        await key('Return')
        await sleep(1400)
        await js(win, "const s = window.__crewState; const mine = s.feed.findLast((e) => e.from === 'you'); s.feed.push({ id: 'cv-r', kind: 'reply', from: 'joseph', to: 'you', re: mine.id, text: 'Re-ran it: **43 passing**. Sent @david the numbers.', ts: Date.now() }); window.__crewEmit('state', s)")
        await sleep(1800)
        at = await glide(win, at, await center(win, '.ch-back'), 800)
        await sleep(300)
        await tap(win, at)
        await sleep(1600)
      },
    })
    win.destroy()
  },
  // The Tasks bar: @ assigns, from the same list.
  async taskMention(theme) {
    const win = await dashboard(theme, 'tasks')
    await sleep(1000)
    await js(win, click('[data-new-task]'))
    await sleep(400)
    await js(win, "const ta = document.querySelector('[data-add]'); ta.focus(); ta.value = 'Pause menu flickers on resume @g'; ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input', { bubbles: true }))")
    await sleep(500)
    await save(win, `task-mention-${theme}`)
    win.destroy()
  },
  // An agent's own context limit: joseph's 1M window held to 250k.
  async limit(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name=joseph]'))
    await sleep(1200)
    await js(win, click('.ed [data-act=advanced]'))
    await sleep(700)
    const box = await js(win, "const r = document.querySelector('.ed').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    const img = await win.webContents.capturePage(box)
    fs.writeFileSync(path.join(out, `limit-${theme}.png`), img.toPNG())
    console.log('saved', `limit-${theme}.png`)
    win.destroy()
  },
  // Setting one: gal is already past 150k, so the note says what happens on Save; then "Just tell me".
  async limitGif() {
    const win = await dashboard('light', 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name=gal]'))
    await sleep(1200)
    await js(win, click('.ed [data-act=advanced]'))
    await sleep(700)
    const box = await js(win, "const r = document.querySelector('.limit').getBoundingClientRect(); return { x: Math.round(r.x) - 16, y: Math.round(r.y) - 40, width: Math.round(r.width) + 32, height: Math.round(r.height) + 56 }")
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
  // Clones: marc is busy, so its clones took the two tasks that would have waited in its queue. The sidebar lists
  // them under marc, and each has a terminal of its own right after marc's.
  async clones(theme) {
    const win = await dashboard(theme, 'grid')
    await sleep(1500)
    await js(win, "document.querySelector('.tile[data-name=marc]').scrollIntoView({ block: 'start' }); document.querySelector('.roster .crow[data-agent=marc] .crow-clones')?.click()")
    await sleep(600)
    await save(win, `clones-${theme}`)
    win.destroy()
  },
  // The Clones setting on an agent's card, with the clones at work right now.
  async clonesEditor(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name=marc]'))
    await sleep(1200)
    await js(win, click('.ed [data-act=advanced]'))
    await sleep(700)
    await js(win, "document.querySelector('.ed [data-pick=clones]')?.scrollIntoView({ block: 'center' })")
    await sleep(500)
    await save(win, `clones-editor-${theme}`)
    win.destroy()
  },
  // Two messages for a busy marc: each one pops a clone out of it in the pill, and the chat says who took it.
  async clonesGif() {
    const win = await open('overlay.html', { theme: 'light', width: 560, height: 760, backdrop: 'desktop' })
    await sleep(400)
    // start from marc alone, busy
    await js(win, "const s = window.__crewState; s.agents = s.agents.filter((a) => !a.cloneOf); window.__crewEmit('state', s); window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(900)
    await fitToContent(win)
    await sleep(300)
    await record(win, 'clones', {
      ms: 9000, width: 760,
      during: async () => {
        const say = async (text) => {
          for (let i = 1; i <= text.length; i++) {
            await js(win, `const ta = document.querySelector('.composer textarea'); ta.value = ${JSON.stringify(text)}.slice(0, ${i}); ta.dispatchEvent(new Event('input'))`)
            await sleep(24)
          }
          await sleep(350)
          await js(win, "document.querySelector('.composer .send').click()")
        }
        await sleep(500)
        await say('@marc an illustration for the empty Tasks board too')
        await sleep(2600)
        await say('@marc and a pastel palette sheet for the brand guide')
        await sleep(3000)
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
  // Sidebar: hovering a row shows its switches; flip YOLO, open the off line and wake an agent, fold a computer.
  async sidebarGif() {
    const win = await dashboard('light', 'grid', { fixture: 'big', reset: ['crew.folds'] })
    await sleep(1200)
    const side = await js(win, "const r = document.querySelector('.side').getBoundingClientRect(); return { x: 0, y: Math.round(r.y), width: Math.round(r.width), height: Math.min(760, Math.round(r.height)) }")
    await record(win, 'sidebar', {
      clip: side, ms: 9000, width: 360,
      during: async () => {
        let at = { x: 400, y: 300 }
        await sleep(300)
        at = await glide(win, at, await center(win, '.crow[data-agent=lena] .crow-main'), 700)
        await sleep(500)
        at = await glide(win, at, await center(win, '.crow[data-agent=lena] .mode.yolo'), 400)
        await sleep(250)
        await tap(win, at)
        await sleep(800)
        at = await glide(win, at, await center(win, '[data-fold="off:"]'), 600)
        await sleep(250)
        await tap(win, at)
        await sleep(700)
        at = await glide(win, at, await center(win, '.crow[data-agent=pia] .crow-main'), 500)
        await sleep(300)
        at = await glide(win, at, await center(win, '[data-power=pia]'), 400)
        await sleep(250)
        await tap(win, at)
        await sleep(1000)
        at = await glide(win, at, await center(win, '.cgroup-head[data-fold="group:"] b'), 700)
        await sleep(250)
        await tap(win, at)
        await sleep(1200)
        await tap(win, at)
        await sleep(900)
        await glide(win, at, { x: 400, y: at.y }, 400)
      },
    })
    win.destroy()
  },
  // Moving an agent from any computer: right-click it, Move to Mac mini, check the folder there, Move.
  async moveGif() {
    const win = await dashboard('light', 'crew', { reset: ['crew.folds'] })
    await sleep(1200)
    await record(win, 'move', {
      ms: 9800, width: 1000,
      during: async () => {
        let at = { x: 700, y: 400 }
        at = await glide(win, at, await center(win, '.crow[data-agent=arie] .crow-main'), 800)
        await sleep(400)
        win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(at.x), y: Math.round(at.y), button: 'right', clickCount: 1 })
        win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(at.x), y: Math.round(at.y), button: 'right', clickCount: 1 })
        await sleep(900)
        const item = await js(win, "const b = [...document.querySelectorAll('.menu button')].find((x) => x.textContent.includes('Mac mini')); const r = b.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }")
        at = await glide(win, at, item, 600)
        await sleep(300)
        await tap(win, at)
        await sleep(1600)
        at = await glide(win, at, await center(win, '[data-mv-sug="/Users/you/builds"]'), 700)
        await sleep(300)
        await tap(win, at)
        await sleep(900)
        at = await glide(win, at, await center(win, '[data-mv-go]'), 600)
        await sleep(300)
        await tap(win, at)
        await sleep(2000)
        await glide(win, at, { x: at.x - 300, y: at.y + 60 }, 500)
      },
    })
    win.destroy()
  },
  // The agent's sheet: Setup, Instructions, Look (try a hat on), Stats, without ever scrolling.
  async sheetGif() {
    const win = await dashboard('light', 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(1000)
    await record(win, 'sheet', {
      ms: 8600, width: 1000,
      during: async () => {
        let at = { x: 900, y: 500 }
        at = await glide(win, at, await center(win, '.pcard[data-name=marc]'), 600)
        await sleep(200)
        await tap(win, at)
        await sleep(1300)
        for (const tab of ['instructions', 'look']) {
          at = await glide(win, at, await center(win, `.ed-tabs [data-tab=${tab}]`), 500)
          await tap(win, at)
          await sleep(900)
        }
        at = await glide(win, at, await center(win, '.opt[data-look=hat][data-v=crown]'), 600)
        await tap(win, at)
        await sleep(900)
        at = await glide(win, at, await center(win, '.ed-tabs [data-tab=stats]'), 600)
        await tap(win, at)
        await sleep(1200)
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
  // A crew of 24 on three computers: every view has to hold up with many agents.
  async big(theme) {
    for (const view of ['crew', 'tasks', 'grid']) {
      const win = await dashboard(theme, view, { fixture: 'big', reset: ['crew.collection'] })
      await sleep(1400)
      await save(win, `big-${view}-${theme}`)
      win.destroy()
    }
    const chat = await open('overlay.html', { theme, width: 520, height: 900, backdrop: 'desktop', fixture: 'big' })
    await sleep(400)
    await js(chat, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(chat)
    await save(chat, `big-chat-${theme}`)
    chat.destroy()
    const tray = await open('tray.html', { theme, width: 340, height: 900, backdrop: 'popover', fixture: 'big' })
    await sleep(500)
    await fitToContent(tray)
    await save(tray, `big-tray-${theme}`)
    tray.destroy()
  },
  // Opening a card and going back.
  async detailGif() {
    const win = await dashboard('light', 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(1200)
    await record(win, 'card-open', {
      ms: 6200, width: 900,
      during: async () => {
        await sleep(400)
        await js(win, click('.pcard[data-name=gal]'))
        await sleep(1500)
        await js(win, click('.ed-tabs [data-tab=look]'))
        await sleep(900)
        await js(win, click('.opt[data-look=hat][data-v=crown]'))
        await sleep(900)
        await js(win, click('.ed-tabs [data-tab=setup]'))
        await sleep(700)
        await js(win, click('.ed-close'))
        await sleep(900)
      },
    })
    win.destroy()
  },
  // Workspaces: the switcher open over Golf app, the sheet that makes one, one's settings, and a parked one.
  async workspaces(theme) {
    const win = await dashboard(theme, 'crew', { fixture: 'workspaces' })
    await sleep(900)
    await save(win, `ws-crew-${theme}`)
    await js(win, click('.ws-switch'))
    await sleep(700)
    await save(win, `ws-switcher-${theme}`)
    await js(win, click('[data-ws-cmd=new]'))
    await sleep(600)
    await js(win, `const i = document.querySelector('[data-ws-name]'); i.value = 'Checkout'; i.dispatchEvent(new Event('input', { bubbles: true }))`)
    await js(win, click('[data-ws-icon="🛒"]'))
    for (const n of ['joseph', 'gal']) await js(win, `document.querySelector('[data-ws-member="${n}"]').click()`)
    await sleep(700)
    await save(win, `ws-new-${theme}`)
    await js(win, "document.querySelector('#ws').close()")
    await sleep(300)
    await js(win, "document.querySelector('.ws-switch').click()")
    await sleep(500)
    await js(win, click('.ws-row.current [data-ws-act=settings]'))
    await sleep(700)
    await save(win, `ws-settings-${theme}`)
    await js(win, "document.querySelector('#ws').close()")
    await js(win, "document.querySelector('.ws-switch').click()")
    await sleep(500)
    await js(win, click('.ws-row[data-ws=default] [data-ws-act=settings]'))
    await sleep(700)
    await save(win, `ws-home-settings-${theme}`)
    await js(win, "document.querySelector('#ws').close()")
    await js(win, "window.__crewEmit('state', (window.__crewShow('research'), window.__crewState))")
    await sleep(900)
    await save(win, `ws-parked-${theme}`)
    win.destroy()
    // the menu bar's popover and the floating chat say which workspace they show
    const tray = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover', fixture: 'workspaces' })
    await sleep(500)
    await fitToContent(tray)
    await save(tray, `ws-tray-away-${theme}`)
    await js(tray, click('.ws-switch'))
    await sleep(400)
    await save(tray, `ws-tray-${theme}`)
    tray.destroy()
    const chat = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop', fixture: 'workspaces' })
    await sleep(400)
    await js(chat, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(chat)
    await save(chat, `ws-chat-${theme}`)
    chat.destroy()
  },
}

async function dashboard(theme, view, { width = 1440, height = 880, fixture, reset = [] } = {}) {
  const win = await open('dashboard.html', { theme, width, height, fixture })
  await js(win, `localStorage.setItem('crew.view', '${view}'); localStorage.removeItem('crew.edTab'); ${reset.map((k) => `localStorage.removeItem('${k}');`).join(' ')}`)
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

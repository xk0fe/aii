// Renders every view with a made-up crew (scripts/screenshot-preload.cjs) and saves PNGs, plus short GIFs of
// the animations. Nothing starts and ~/.crew is untouched. Run: npm run shots [-- out-dir [shot names...]] [--webp] [--win]
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
// --win: every view as Windows shows it (screenshot-preload.cjs ?platform=win32)
const WIN = process.argv.includes('--win')
// The computer linked to this one, where the demo crew's Rex and Noor run (screenshot-preload.cjs): the Windows PC
// Workstation, or with --win (when this one is Workstation) the Mac Studio.
const LINK = WIN ? { slug: 'studio', name: 'Studio' } : { slug: 'workstation', name: 'Workstation' }
const REX = `Rex@${LINK.slug}`
const NOOR = `Noor@${LINK.slug}`
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
  const query = { ...(fixture && { fixture }), ...(WIN && { platform: 'win32' }) }
  // --win: Windows draws its window buttons over the dashboard's titlebar (main.js titleBarOverlay); stand-ins show
  // where, on every load (shots reload the page)
  if (WIN && file === 'dashboard.html') {
    win.webContents.on('did-finish-load', () => win.webContents.insertCSS(`html::after { content: '\\2014\\00a0\\00a0\\00a0\\00a0\\00a0\\25A2\\00a0\\00a0\\00a0\\00a0\\00a0\\2715'; position: fixed; top: 0; right: 0; z-index: 9999;
      width: 138px; height: 45px; display: grid; place-items: center; font: 14px 'Segoe UI', sans-serif; color: var(--fg); background: var(--bg); pointer-events: none; }`))
  }
  await win.loadFile(path.join(root, 'ui', file), Object.keys(query).length ? { query } : {})
  if (backdrop && !(WIN && backdrop === 'popover')) await win.webContents.insertCSS(`html { background: ${BACKDROP[backdrop][theme]} !important; }`)
  return win
}

const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`)

// Popover-style windows size themselves to their content through crew.fit().
async function fitToContent(win) {
  const fit = await js(win, 'return window.__crewFit')
  if (fit) win.setContentSize(Math.ceil(fit.width), Math.ceil(fit.height))
  await sleep(150)
}

// A still picture: the creatures at rest (eyes open, nobody mid-hop), what was sliding in already in place.
const FREEZE = `for (const a of document.getAnimations()) {
  try {
    const t = a.effect?.getTiming?.()
    if (t && t.iterations !== Infinity) { a.finish(); continue }
    a.pause()
    a.currentTime = { 'av-wiggle': 70, 'av-wiggle-soft': 400, 'av-z': 1100 }[a.animationName] ?? 0
  } catch {}
}`
async function save(win, name) {
  await js(win, FREEZE)
  await sleep(60)
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
  // #general: everyone's messages, questions answered where they were asked
  async channel(theme) {
    const win = await dashboard(theme, 'chat')
    await sleep(1200)
    await save(win, `channel-${theme}`)
    win.destroy()
  },
  // Channels: the sidebar's list (unread counts), #review open with its brief in the header, an agent's conversation
  // tagging what came from a channel, the sheet that makes one, and a new channel before anyone has said anything
  async channels(theme) {
    const win = await dashboard(theme, 'chat')
    await sleep(800)
    await js(win, "setChannel('review')")
    await sleep(1000)
    await save(win, `channels-${theme}`)
    await js(win, "setChannel('launch')")
    await sleep(900)
    await save(win, `channels-launch-${theme}`)
    await js(win, "openDM('Milo')")
    await sleep(900)
    await save(win, `channels-dm-${theme}`)
    await js(win, "goPlace('chat'); channelSheet(null); const d = document.querySelector('#channel'); d.querySelector('[data-ch-name]').value = 'Design QA'; d.querySelector('[data-ch-name]').dispatchEvent(new Event('input', { bubbles: true })); d.querySelector('[data-ch-brief]').value = 'Check new screens against the design system: spacing, type scale and dark mode. Post before/after screenshots. Never change the tokens.'; d.querySelector('[data-ch-brief]').dispatchEvent(new Event('input', { bubbles: true })); d.querySelector('[data-ch-all=\"0\"]').click(); for (const n of ['Iris', 'Milo', 'Theo']) d.querySelector(`[data-ch-member=\"${n}\"]`).click()")
    await sleep(700)
    await save(win, `channels-sheet-${theme}`)
    await js(win, "document.querySelector('#channel [data-ch-save]').click()")
    await sleep(900)
    await save(win, `channels-new-${theme}`)
    win.destroy()
  },
  // Searching a channel: only the messages with every word, the words marked, how many in the field
  async chatSearch(theme) {
    const win = await dashboard(theme, 'chat')
    await sleep(900)
    await js(win, "openSearch(); const q = document.querySelector('.chat-search input'); q.value = 'totals'; q.dispatchEvent(new Event('input'))")
    await sleep(900)
    await save(win, `chat-search-${theme}`)
    win.destroy()
  },
  // A conversation with one agent, its terminal docked beside it (and its clones' as tabs)
  async direct(theme) {
    const win = await dashboard(theme, 'chat')
    await js(win, "openDM('Theo', { terminal: true })")
    await sleep(1200)
    await save(win, `direct-${theme}`)
    await js(win, "openDM('Iris', { terminal: true })")
    await sleep(1000)
    await save(win, `direct-ask-${theme}`)
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
    await js(win, click('.pcard[data-name="Iris"]'))
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
    await js(win, `moveSheet('Iris', '${LINK.slug}')`)
    await sleep(900)
    await save(win, `move-${theme}`)
    win.destroy()
  },
  // Computers: this one, Workstation linked, the Laptop asleep, and a Mac mini nearby with Computers open too.
  async computers(theme) {
    const win = await dashboard(theme, 'crew', { fixture: 'big' })
    await sleep(900)
    await js(win, 'openComputers()')
    await sleep(800)
    await save(win, `computers-${theme}`)
    win.destroy()
  },
  // Nearby with nothing found yet (the radar), and with macOS keeping the app off the network.
  async nearby(theme) {
    const win = await dashboard(theme, 'crew')
    await sleep(900)
    await js(win, 'window.__crewNearby = []; openComputers()')
    await sleep(900)
    await save(win, `nearby-find-${theme}`)
    await js(win, "const s = window.__crewState; s.computers.me.localNetwork = 'blocked'; window.__crewEmit('state', s)")
    await sleep(500)
    await save(win, `nearby-blocked-${theme}`)
    win.destroy()
  },
  // Linking the Mac mini found nearby: asking, the code to check on both screens, Link here and waiting for the Mac mini,
  // linked; one that said no; a computer asking this one; and Link with a code.
  async linking(theme) {
    const win = await dashboard(theme, 'crew')
    await sleep(900)
    await js(win, 'window.__crewPairDelay = 1500; openComputers()')
    await sleep(700)
    await js(win, "document.querySelector('[data-pair=\"n1\"]').click()")
    await sleep(500)
    await save(win, `link-asking-${theme}`)
    await sleep(1400)
    await save(win, `link-confirm-${theme}`)
    await js(win, "document.querySelector('[data-pair-confirm]').click()")
    await sleep(500)
    await save(win, `link-waiting-${theme}`)
    await js(win, 'window.__crewTheyAgree()')
    await sleep(700)
    await save(win, `link-linked-${theme}`)
    await sleep(1600)
    await js(win, "window.__crewPairDelay = 200; window.__crewPairEnd = 'declined'; document.querySelector('[data-pair=\"n1\"]').click()")
    await sleep(700)
    await save(win, `link-declined-${theme}`)
    await js(win, "window.__crewPairEnd = null; document.querySelector('[data-pair-back]').click()")
    await sleep(400)
    await js(win, "window.__crewAsk('Laptop')")
    await sleep(700)
    await save(win, `link-ask-${theme}`)
    await js(win, "document.querySelector('[data-pair-no]').click()")
    await sleep(500)
    await js(win, "document.querySelector('[data-link-add]').click()")
    await sleep(600)
    await save(win, `link-code-${theme}`)
    win.destroy()
  },
  // Token savers: a switch each, what each counted, and cost per turn with them on and off. Then a switch flipped, as you
  // would: the sheet redraws from the state that comes back.
  async savers(theme) {
    const win = await dashboard(theme, 'crew', { fixture: 'big' })
    await sleep(900)
    await js(win, 'openSavers()')
    await sleep(800)
    await save(win, `savers-${theme}`)
    await js(win, "document.querySelector('#savers .sheet-body').scrollTop = 1e5")
    await sleep(300)
    await save(win, `savers-end-${theme}`)
    const flipped = await js(win, `
      const sw = document.querySelector('#savers [data-sv="noReportBack"]')
      sw.click()
      await new Promise((r) => setTimeout(r, 300))
      return [window.__crewState.savers.on.noReportBack, document.querySelector('#savers [data-sv="noReportBack"]').checked, document.querySelectorAll('#savers .sv').length]`)
    if (String(flipped) !== 'true,true,6') throw new Error(`savers: flipping a switch gave ${flipped}`)
    win.destroy()
  },
  // Agent tools: an agent asking to change CLIque (its card in the chat, its words in the Needs-you queue), the card
  // once allowed beside what an automatic change says, and the sheet that says how far agents go, in Ask first and in
  // Automatic (which mustn't change its height)
  async tools(theme) {
    const win = await dashboard(theme, 'chat')
    await sleep(900)
    await js(win, `const s = window.__crewState
      s.feed = s.feed.filter((e) => !(e.kind === 'ask' && !e.answer))
      s.feed.push({ id: 't0', kind: 'msg', from: 'you', to: 'Ada', text: 'Can you add a #design channel for Iris and Milo? They should check new screens against the design system.', ts: Date.now() - 60000 })
      s.feed.push({ id: 't1', kind: 'ask', from: 'Ada', to: 'you', cli: 'crew', re: 't0', ts: Date.now() - 20000, ask: { type: 'permission', tool: 'crew app', app: true, title: 'Add a channel', code: '#design\\nCheck new screens against the design system: spacing, type scale and dark mode. Post before/after screenshots.', detail: 'For @Iris, @Milo', say: 'Can I add a #design channel?', always: [], alert: 'wants to add a channel' } })
      for (const a of s.agents) if (a.status === 'waiting') a.status = 'idle'
      Object.assign(s.agents.find((a) => a.name === 'Ada'), { status: 'waiting', since: Date.now() - 20000 })
      window.__crewEmit('state', s)`)
    await sleep(1000)
    await save(win, `tools-ask-${theme}`)
    await js(win, `const s = window.__crewState
      s.feed.find((e) => e.id === 't1').answer = { by: 'you', allow: true, at: Date.now() - 15000 }
      s.feed.push({ id: 't2', kind: 'reply', from: 'Ada', to: 'you', re: 't0', text: 'Done: **#design** is up, with Iris and Milo in it and your brief as its instructions.', ts: Date.now() - 12000 })
      s.feed.push({ id: 't3', kind: 'msg', from: 'you', to: 'Ada', text: 'Thanks! And a workspace for the storefront, with you and June in it.', ts: Date.now() - 8000 })
      s.feed.push({ id: 't4', kind: 'event', from: 'Ada', text: 'made the Storefront workspace', app: true, ts: Date.now() - 4000 })
      Object.assign(s.agents.find((a) => a.name === 'Ada'), { status: 'working', since: Date.now() - 8000 })
      window.__crewEmit('state', s)`)
    await sleep(900)
    await save(win, `tools-done-${theme}`)
    await js(win, 'openTools()')
    await sleep(800)
    await save(win, `tools-sheet-${theme}`)
    const after = await js(win, `const d = document.querySelector('#tools')
      const h = d.getBoundingClientRect().height
      d.querySelector('[data-tl="auto"]').click()
      await new Promise((r) => setTimeout(r, 500))
      return [Math.round(d.getBoundingClientRect().height - h), window.__crewState.tools, [...d.querySelectorAll('.tl-how')].map((x) => x.textContent).join('/'), d.querySelector('.tl-about p.on').dataset.mode]`)
    if (String(after) !== '0,auto,Automatic/Automatic/Automatic/Asks first,auto') throw new Error(`tools: switching to Automatic gave ${after}`)
    await save(win, `tools-sheet-auto-${theme}`)
    win.destroy()
    // the floating chat's Needs you queue: the creature asks in its own words, the card under them
    const chat = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(chat, `const s = window.__crewState
      s.feed = s.feed.filter((e) => !(e.kind === 'ask' && !e.answer))
      s.feed.push({ id: 't1', kind: 'ask', from: 'Ada', to: 'you', cli: 'crew', ts: Date.now() - 20000, ask: { type: 'permission', tool: 'crew app', app: true, title: 'Add a workspace', code: '🛒 Storefront\\n~/Projects/storefront', detail: '@Ada, @June work there, and start right away.', say: 'Can I make a workspace called Storefront?', always: [], alert: 'wants to add a workspace' } })
      for (const a of s.agents) if (a.status === 'waiting') a.status = 'idle'
      Object.assign(s.agents.find((a) => a.name === 'Ada'), { status: 'waiting', since: Date.now() - 20000 })
      window.__crewEmit('state', s)
      window.__crewEmit('toggle', { open: true, focus: false })`)
    await sleep(900)
    await js(chat, "document.querySelector('.nq-go')?.click()")
    await sleep(700)
    await fitToContent(chat)
    await save(chat, `tools-chat-${theme}`)
    chat.destroy()
  },
  // A CLI's "do you trust this folder?" (core/hub.js trustCard): how it was (waiting in its terminal), its card in the
  // Needs you queue, and the card once Trust is clicked. Then the floating chat's queue with the card open.
  async trust(theme) {
    const win = await dashboard(theme, 'chat')
    await sleep(900)
    const ask = `{ type: 'permission', trust: true, title: 'Trust this folder', detail: '${os.homedir()}/Projects/storefront', say: 'First time in storefront. Can I trust this folder?', always: [], alert: 'asks whether to trust its folder' }`
    const setup = (card) => `const s = window.__crewState
      s.feed = s.feed.filter((e) => !(e.kind === 'ask' && !e.answer) && !/^t[rb]/.test(e.id))
      s.feed.push({ id: '${card ? 'tr0' : 'tb0'}', kind: 'msg', from: 'you', to: 'June', text: 'Can you set up the storefront repo and get its tests running?', ts: Date.now() - 60000 })
      ${card ? `s.feed.push({ id: 'tr1', kind: 'ask', from: 'June', to: 'you', cli: 'claude', ts: Date.now() - 20000, ask: ${ask} })` : "s.feed.push({ id: 'tb1', kind: 'event', from: 'June', alert: true, ts: Date.now() - 20000, text: 'asks whether to trust its folder, ~/Projects/storefront. Answer in its terminal: messages wait until then' })"}
      for (const a of s.agents) if (a.status === 'waiting') a.status = 'idle'
      Object.assign(s.agents.find((a) => a.name === 'June'), { status: 'waiting', since: Date.now() - 20000, activity: '' })
      window.__crewEmit('state', s)`
    await js(win, setup(false))
    await sleep(1000)
    await save(win, `trust-before-${theme}`)
    await js(win, setup(true))
    await sleep(1000)
    await save(win, `trust-ask-${theme}`)
    const said = await js(win, `const b = document.querySelector('[data-ask="tr1"] [data-answer="allow"]')
      if (!b) return 'no Trust button'
      b.click()
      await new Promise((r) => setTimeout(r, 600))
      return document.querySelector('[data-ask="tr1"].done')?.textContent.trim() ?? 'no answered card'`)
    if (!/^Trusted/.test(said)) throw new Error(`trust: clicking Trust gave ${said}`)
    await sleep(400)
    await save(win, `trust-done-${theme}`)
    win.destroy()
    const chat = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(chat, `${setup(true)}
      window.__crewEmit('toggle', { open: true, focus: false })`)
    await sleep(900)
    await js(chat, "document.querySelector('.nq-go')?.click()")
    await sleep(700)
    await fitToContent(chat)
    await save(chat, `trust-chat-${theme}`)
    chat.destroy()
  },
  // Add a phone: the pairing view with its code to scan, the phone that paired with it, then the list with that phone
  // highlighted (two paired before it, one connected).
  async phones(theme) {
    const win = await dashboard(theme, 'crew')
    await sleep(900)
    await js(win, 'openComputers()')
    await sleep(500)
    await js(win, click('[data-phone-add]'))
    await sleep(900)
    await save(win, `phones-${theme}`)
    await js(win, "const s = window.__crewState; s.computers.phones.devices.push({ id: 'p3', name: 'iPad', platform: 'ios', app: '0.1.0', paired: Date.now(), seen: Date.now(), online: true }); window.__crewEmit('state', s)")
    await sleep(900)
    await save(win, `phones-paired-${theme}`)
    await sleep(1700)
    await save(win, `phones-list-${theme}`)
    win.destroy()
  },
  // Add a phone: the code to scan, a new one before it runs out (codes last four seconds here, so the QR just changes),
  // then a phone pairs and the list shows it highlighted.
  async pairGif() {
    const win = await dashboard('light', 'crew')
    await js(win, 'openComputers()')
    await sleep(900)
    await js(win, 'window.__crewPhoneTTL = 4000')
    await record(win, 'pair', {
      clip: { x: 396, y: 16, width: 648, height: 768 }, ms: 9800, width: 648,
      during: async () => {
        let at = { x: 700, y: 600 }
        at = await glide(win, at, await center(win, '[data-phone-add]'), 700)
        await sleep(250)
        await tap(win, at)
        await glide(win, at, { x: at.x + 60, y: at.y + 120 }, 600)
        await sleep(4300)
        await js(win, "const s = window.__crewState; s.computers.phones.devices.push({ id: 'p3', name: 'iPad', platform: 'ios', app: '0.1.0', paired: Date.now(), seen: Date.now(), online: true }); s.computers.phones.pairing = null; window.__crewEmit('state', s)")
        await sleep(3000)
      },
    })
    win.destroy()
  },
  // Right-click an agent: everything you can do with it, Move to… included.
  async menu(theme) {
    const win = await dashboard(theme, 'grid', { fixture: 'big' })
    await sleep(1200)
    const at = await center(win, '.roster .dm[data-agent="Theo"]')
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
    await js(win, `${click('.page-head[data-for=crew] [data-act=more]')}; await new Promise((r) => setTimeout(r, 200)); ${click('.menu [data-menu-act=select]')}; await new Promise((r) => setTimeout(r, 200)); ${click('.pcard[data-name="Ada"]')}; ${click('.pcard[data-name="Theo"]')}`)
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
    await js(win, click('.pcard[data-name="Milo"]'))
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
    await js(win, `${click('.chip.task-chip')}; const ta = document.querySelector('.composer textarea'); ta.value = 'Promo banner hides the cart button on small phones @Milo'; ta.dispatchEvent(new Event('input'))`)
    await sleep(500)
    await fitToContent(win)
    await save(win, `chat-task-${theme}`)
    win.destroy()
  },
  // Switching workspaces: the switcher, Storefront, then back to Docs site from the sidebar's dock. The crew slides over.
  // Workspaces on the rail: switch to the one that needs you, back, then see who works there.
  async workspacesGif() {
    const win = await dashboard('light', 'chat', { fixture: 'workspaces', width: 1280, height: 800 })
    await sleep(1200)
    await record(win, 'workspaces', {
      ms: 8200, width: 1000,
      during: async () => {
        let at = { x: 640, y: 420 }
        at = await glide(win, at, await center(win, '.rail-ws[data-ws=default]'), 700)
        await sleep(350)
        await tap(win, at)
        await sleep(1500)
        at = await glide(win, at, await center(win, '.rail-ws[data-ws=docs]'), 500)
        await sleep(300)
        await tap(win, at)
        await sleep(1300)
        at = await glide(win, at, await center(win, '.mh-faces'), 900)
        await sleep(300)
        await tap(win, at)
        await sleep(1500)
        await glide(win, at, { x: at.x - 260, y: at.y + 300 }, 500)
      },
    })
    win.destroy()
  },
  // Add a task, start it in a new conversation, then accept another one: the board's whole loop.
  async tasksGif() {
    const win = await dashboard('light', 'tasks')
    await js(win, "localStorage.setItem('crew.tasks.view', 'board'); localStorage.setItem('crew.tasks.done', '0')")
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    await sleep(1200)
    // the sidebar and the board, without the chat column, so the cards stay readable
    // (the Tasks view may have no chat column: then the whole window)
    const board = await js(win, "const x = Math.round(document.querySelector('.chat')?.getBoundingClientRect().x ?? 0); return { x: 0, y: 0, width: x > 200 ? x : innerWidth, height: innerHeight }")
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
        const text = 'Coupon field clears when you go back @Milo ' // the space closes the @ picker, so Enter adds the task
        for (let i = 1; i <= text.length; i++) {
          await js(win, `const ta = document.querySelector('.tk-add textarea'); ta.value = ${JSON.stringify(text)}.slice(0, ${i}); ta.dispatchEvent(new Event('input'))`)
          await sleep(26)
        }
        await sleep(450)
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
        await sleep(900)
        // Escape closes the add box first: a click outside it would close it mid-click, and the cards would move up
        // from under the pointer
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
        await sleep(500)
        // the task just added: the newest on the board
        const added = await js(win, 'return Math.max(...window.__crewState.tasks.tickets.map((t) => t.id))')
        at = await glide(win, at, await center(win, `.tc[data-name="${added}"] [data-act=start]`), 700)
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
    const tile = await js(win, "const r = document.querySelector('.tile[data-name=\"June\"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    await record(win, 'fresh-start', {
      clip: { x: tile.x, y: tile.y, width: tile.width, height: 46 }, ms: 4200, width: 900,
      during: async () => {
        let at = { x: tile.x + tile.width - 300, y: tile.y + 23 }
        await sleep(500)
        at = await glide(win, at, await center(win, '.tile[data-name="June"] [data-act=fresh]'), 700)
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
  // Right of way: June waits on Ada's answer, Ada answers first instead of asking back, and earlier answers,
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
  // June asks Ada something while Ada is busy: it waits on Ada, Ada answers mid-task and carries on, and June goes on
  // with the answer.
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
        await step("s.feed.splice(s.feed.findIndex((e) => e.id === 'q1')); Object.assign(a('June'), { waitingOn: [], activity: 'Read · docs/release-1.2.md', since: Date.now() - 60000 }); a('Ada').owes = []")
        await sleep(1200)
        await step("s.feed.push({ id: 'g1', kind: 'msg', from: 'June', to: 'Ada', ask: true, text: 'Which coupon codes can stack in 1.2?', ts: Date.now() }); a('June').waitingOn = [{ name: 'Ada', since: Date.now(), id: 'g1', text: 'Which coupon codes can stack in 1.2?' }]; a('Ada').owes = [{ name: 'June', since: Date.now(), id: 'g1', waiting: true }]")
        await sleep(1400)
        await step("a('Ada').activity = 'Bash · crew answer'")
        await sleep(900)
        await step("const q = s.feed.find((e) => e.id === 'g1'); s.feed.push({ id: 'g2', kind: 'reply', from: 'Ada', re: 'g1', text: 'One code per order, plus free shipping on top.', ts: Date.now() }); q.answered = { by: 'Ada', at: Date.now(), reply: 'g2' }; a('June').waitingOn = []; a('June').activity = 'Edit · docs/release-1.2.md'; a('Ada').owes = []; a('Ada').activity = 'Edit · api/orders.ts'")
        await sleep(1600)
        await step("a('June').activity = 'Bash · npm run docs:check'")
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
      by('Theo').status = 'stopped'
      window.__crewBufferDelay = 600000
      by('June').convo = { ...by('June').convo, since: Date.now() }
      window.__crewEmit('state', s)`)
    await sleep(900)
    await js(win, "document.querySelector('.terms').scrollTop = 99999")
    await sleep(500)
    await save(win, `ribbons-${theme}`)
    await js(win, `const s = window.__crewState; s.agents.find((a) => a.name === '${REX}').status = 'away'; window.__crewEmit('state', s)`)
    await sleep(700)
    await save(win, `ribbons-offline-${theme}`)
    win.destroy()
  },
  // Opening a terminal replays what the agent printed before: the ribbon says so, then turns live.
  async ribbonGif() {
    const win = await dashboard('dark', 'grid', { width: 1920, height: 1080 })
    await sleep(1500)
    const tile = await js(win, "const r = document.querySelector('.tile[data-name=\"June\"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    await record(win, 'ribbon-replay', {
      clip: tile, ms: 4200, width: 900,
      during: async () => {
        await sleep(600)
        await js(win, "window.__crewBufferDelay = 1800; const s = window.__crewState; const a = s.agents.find((x) => x.name === 'June'); a.convo = { ...a.convo, since: Date.now() }; window.__crewEmit('state', s)")
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
        at = await glide(win, at, await center(win, '.menu [data-menu-act="Theo"]'), 500)
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
  // Ada splits her work: two sub-agents start, step through their tools, and finish.
  async subsGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__crewEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await sleep(300)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + 40), width: Math.round(r.width) + 80, height: Math.round(r.height - 200) }")
    const step = (code) => js(win, `const s = window.__crewState; const m = s.agents.find((a) => a.name === 'Ada'); ${code}; window.__crewEmit('state', s)`)
    await record(win, 'subagents', {
      clip: panel, ms: 9000, width: 760,
      during: async () => {
        await step("s.agents.forEach((a) => (a.subs = [])); m.subs = []")
        await sleep(800)
        await step("m.subs.push({ id: 'm1', type: 'Explore', description: 'Find every place coupons are applied', started: Date.now(), ended: null, tools: 0, activity: '' })")
        await sleep(500)
        await step("m.subs.push({ id: 'm2', type: 'general-purpose', description: 'Write tests for coupon codes', started: Date.now(), ended: null, tools: 0, activity: '' })")
        const acts = [['m1', 'Grep · applyCoupon'], ['m2', 'Read · api/orders.test.ts'], ['m1', 'Read · api/cart.ts'], ['m2', 'Edit · api/orders.test.ts'], ['m1', 'Glob · api/**/*.ts'], ['m2', 'Bash · npm test']]
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
        await typeOut('Ship it, and add a test with three items')
        await sleep(300)
        await key('Return')
        await sleep(1300)
        await js(win, "const s = window.__crewState; const mine = s.feed.findLast((e) => e.from === 'you'); s.feed.push({ id: 'r-ship', kind: 'reply', from: 'Ada', to: 'you', re: mine.id, text: 'Shipped, with a test for three items: 43 passing.', ts: Date.now() }); window.__crewEmit('state', s)")
        await sleep(2200)
        await key('Escape')
        await sleep(1200)
      },
    })
    win.destroy()
  },
  // New conversation is for one message, in Iris's conversation: what you send next goes on in the new one.
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
        at = await glide(win, at, await center(win, '.menu [data-menu-act="Iris"]'), 400)
        await tap(win, at)
        await sleep(400)
        at = await glide(win, at, await center(win, '.fresh-toggle'), 500)
        await tap(win, at)
        await sleep(600)
        await js(win, "document.querySelector('.composer textarea').focus()")
        await typeOut('Sketch three layouts for the empty cart')
        await sleep(300)
        await enter()
        await sleep(1600)
        await typeOut('Keep them simple, like the rest of the shop')
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
      await js(win, `const s = window.__crewState; s.feed.push({ id: 'late${i}', kind: 'reply', from: 'Ada', to: 'you', text: 'Reply ${i + 1} while you read', ts: Date.now() }); window.__crewEmit('state', s)`)
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
      const said = ['Checked the orders table migration.', 'Tests are green on CI.', 'Left a note on the empty cart task.', 'Nudged the product grid spacing a little.']
      s.feed.unshift(...Array.from({ length: 90 }, (_, i) => ({ id: 'old' + i, kind: 'reply', from: ['Ada', 'Milo', 'Iris', 'Theo'][i % 4], to: 'you', text: said[i % 4], ts: t0 + i * 60000 })))
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
        await say(0, 'Ada', 'Pushed the fix for the coupon codes.')
        await sleep(1100)
        await say(1, 'Milo', 'Reviewed it, two small notes on the change.')
        await sleep(1100)
        await say(2, 'Theo', 'Checkout tests pass on Firefox too.')
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
    await type('Can you two check the coupon totals? @')
    await sleep(500)
    await save(win, `mention-${theme}`)
    await type('Can you two check the coupon totals? @ju')
    await sleep(400)
    await save(win, `mention-filter-${theme}`)
    // picked: mentions take their agent's color; one that's off, or that nobody has, is underlined
    await type(`Pair on the coupon totals @Ada @Milo, loop in @${NOOR} and @nobody `)
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
        await typeOut('Pair on the coupon totals ')
        await typeOut('@')
        await sleep(700)
        await typeOut('mi')
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
    await js(win, click('.item.said .face[data-agent="Ada"]'))
    await sleep(900)
    await save(win, `convo-${theme}`)
    win.destroy()
  },
  // The same in the dashboard's chat column.
  async convoDash(theme) {
    const win = await dashboard(theme, 'crew')
    await sleep(700)
    await js(win, click('.chat .item.said .face[data-agent="Ada"]'))
    await sleep(900)
    const box = await js(win, "const r = document.querySelector('.chat').getBoundingClientRect(); return { x: Math.round(r.x), y: 0, width: Math.round(r.width), height: Math.round(r.bottom) }")
    fs.writeFileSync(path.join(out, `convo-dash-${theme}.png`), (await win.webContents.capturePage(box)).toPNG())
    console.log('saved', `convo-dash-${theme}.png`)
    win.destroy()
  },
  // Into Ada's conversation from her face, a message (with @Milo brought in), and back to everyone.
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
        await typeOut('mi')
        await sleep(500)
        await key('Return')
        await sleep(400)
        await key('Return')
        await sleep(1400)
        await js(win, "const s = window.__crewState; const mine = s.feed.findLast((e) => e.from === 'you'); s.feed.push({ id: 'cv-r', kind: 'reply', from: 'Ada', to: 'you', re: mine.id, text: 'Re-ran it: **43 passing**. Sent @Milo the numbers.', ts: Date.now() }); window.__crewEmit('state', s)")
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
    await js(win, "const ta = document.querySelector('[data-add]'); ta.focus(); ta.value = 'Cart badge flickers after checkout @m'; ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input', { bubbles: true }))")
    await sleep(500)
    await save(win, `task-mention-${theme}`)
    win.destroy()
  },
  // An agent's own context limit: Ada's 1M window held to 250k.
  async limit(theme) {
    const win = await dashboard(theme, 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name="Ada"]'))
    await sleep(1200)
    await js(win, click('.ed [data-act=advanced]'))
    await sleep(700)
    const box = await js(win, "const r = document.querySelector('.ed').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    const img = await win.webContents.capturePage(box)
    fs.writeFileSync(path.join(out, `limit-${theme}.png`), img.toPNG())
    console.log('saved', `limit-${theme}.png`)
    win.destroy()
  },
  // Setting one: Milo is already past 150k, so the note says what happens on Save; then "Just tell me".
  async limitGif() {
    const win = await dashboard('light', 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name="Milo"]'))
    await sleep(1200)
    await js(win, click('.ed [data-act=advanced]'))
    await sleep(700)
    const box = await js(win, "const r = document.querySelector('.limit').getBoundingClientRect(); return { x: Math.round(r.x) - 16, y: Math.round(r.y) - 40, width: Math.round(r.width) + 32, height: Math.round(r.height) + 56 }")
    await record(win, 'context-limit', {
      clip: box, ms: 6400, width: 900,
      during: async () => {
        let at = { x: box.x + box.width - 40, y: box.y + 30 }
        await sleep(400)
        at = await glide(win, at, await center(win, '[data-pick=contextLimit] [data-v="150000"]'), 700)
        await sleep(250)
        await tap(win, at)
        await sleep(1300)
        at = await glide(win, at, await center(win, '[data-pick=onContextLimit] [data-v=notify]'), 600)
        await sleep(250)
        await tap(win, at)
        await sleep(1200)
        at = await glide(win, at, await center(win, '[data-pick=onContextLimit] [data-v=fresh]'), 500)
        await sleep(250)
        await tap(win, at)
        await sleep(700)
      },
    })
    win.destroy()
  },
  // Clones: Theo is busy, so its clones took the two tasks that would have waited in its queue (?fixture=clones). The
  // sidebar lists them under Theo, and each has a terminal of its own right after Theo's.
  async clones(theme) {
    const win = await dashboard(theme, 'grid', { fixture: 'clones' })
    await sleep(1500)
    await js(win, "openDM('Theo', { terminal: true })")
    await sleep(600)
    await save(win, `clones-${theme}`)
    win.destroy()
  },
  // The Clones setting on an agent's card, with the clones at work right now.
  async clonesEditor(theme) {
    const win = await dashboard(theme, 'crew', { fixture: 'clones' })
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name="Theo"]'))
    await sleep(1200)
    await js(win, click('.ed [data-act=advanced]'))
    await sleep(700)
    await js(win, "document.querySelector('.ed [data-pick=clones]')?.scrollIntoView({ block: 'center' })")
    await sleep(500)
    await save(win, `clones-editor-${theme}`)
    win.destroy()
  },
  // Two messages for a busy Theo: each one pops a clone out of it in the pill, and the chat says who took it.
  async clonesGif() {
    const win = await open('overlay.html', { theme: 'light', width: 560, height: 760, backdrop: 'desktop' })
    await sleep(400)
    // start from Theo alone, busy
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
        await say('@Theo run the cart tests on Firefox too')
        await sleep(2600)
        await say('@Theo and the coupon tests on a slow network')
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
    const head = await js(win, "const r = document.querySelector('.page-head[data-for=crew]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height + 230) }")
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
  // The group chat: answer a question where it was asked in #general, then open an agent's conversation, its terminal
  // docked beside it.
  async groupChatGif() {
    const win = await dashboard('light', 'chat')
    await sleep(1400)
    await record(win, 'group-chat', {
      ms: 9000, width: 1000,
      during: async () => {
        let at = { x: 900, y: 500 }
        at = await glide(win, at, await center(win, '.feed .ask-option[data-label="Recently viewed"]'), 800)
        await sleep(400)
        await tap(win, at)
        await sleep(1300)
        at = await glide(win, at, await center(win, '.roster .dm[data-agent="Theo"]'), 900)
        await sleep(300)
        await tap(win, at)
        await sleep(1600)
        at = await glide(win, at, await center(win, '.roster .dm[data-agent="Milo"]'), 600)
        await sleep(300)
        await tap(win, at)
        await sleep(1500)
        await glide(win, at, { x: at.x + 500, y: at.y - 120 }, 500)
      },
    })
    win.destroy()
  },
  // Channels: #review and its brief, #checkout-launch and its members, then a new channel made from the sidebar's +
  async channelsGif() {
    const win = await dashboard('light', 'chat')
    await sleep(1400)
    const type = async (text) => {
      for (const ch of text) {
        win.webContents.insertText(ch)
        await sleep(ch === ' ' ? 70 : 35)
      }
    }
    await record(win, 'channels', {
      ms: 16000, width: 1000,
      during: async () => {
        let at = { x: 900, y: 500 }
        at = await glide(win, at, await center(win, '.channels [data-channel="review"]'), 800)
        await sleep(300)
        await tap(win, at)
        await sleep(1700)
        at = await glide(win, at, await center(win, '.channels [data-channel="launch"]'), 500)
        await sleep(300)
        await tap(win, at)
        await sleep(1700)
        at = await glide(win, at, await center(win, '.chan-sec [data-act=new-channel]'), 600)
        await sleep(300)
        await tap(win, at)
        await sleep(700)
        await type('Design QA')
        await sleep(300)
        at = await glide(win, at, await center(win, '#channel [data-ch-brief]'), 500)
        await tap(win, at)
        await sleep(200)
        await type('Check new screens against the design system: spacing, type and dark mode. Post before/after screenshots.')
        await sleep(600)
        at = await glide(win, at, await center(win, '#channel [data-ch-save]'), 600)
        await sleep(300)
        await tap(win, at)
        await sleep(1800)
        await glide(win, at, { x: at.x + 200, y: at.y + 120 }, 400)
      },
    })
    win.destroy()
  },
  // Sidebar: a click opens your conversation with an agent; a computer's name folds its agents away.
  async sidebarGif() {
    const win = await dashboard('light', 'chat', { fixture: 'big', reset: ['crew.folds'] })
    await sleep(1200)
    const side = await js(win, "const r = document.querySelector('.side').getBoundingClientRect(); return { x: 0, y: Math.round(r.y), width: Math.round(r.width), height: Math.min(760, Math.round(r.height)) }")
    await record(win, 'sidebar', {
      clip: side, ms: 7000, width: 360,
      during: async () => {
        let at = { x: 400, y: 300 }
        await sleep(300)
        at = await glide(win, at, await center(win, '.dm[data-agent="Lena"]'), 700)
        await sleep(300)
        await tap(win, at)
        await sleep(900)
        at = await glide(win, at, await center(win, '.dm[data-agent="Pia"]'), 500)
        await sleep(300)
        await tap(win, at)
        await sleep(900)
        at = await glide(win, at, await center(win, '.cg-label[data-fold="group:"]'), 700)
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
  // Moving an agent from any computer: right-click it, Move to Workstation, check the folder there, Move.
  async moveGif() {
    const win = await dashboard('light', 'crew', { reset: ['crew.folds'] })
    await sleep(1200)
    await record(win, 'move', {
      ms: 9800, width: 1000,
      during: async () => {
        let at = { x: 700, y: 400 }
        at = await glide(win, at, await center(win, '.dm[data-agent="June"]'), 800)
        await sleep(400)
        win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(at.x), y: Math.round(at.y), button: 'right', clickCount: 1 })
        win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(at.x), y: Math.round(at.y), button: 'right', clickCount: 1 })
        await sleep(900)
        const item = await js(win, `const b = [...document.querySelectorAll('.menu button')].find((x) => x.textContent.includes('${LINK.name}')); const r = b.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }`)
        at = await glide(win, at, item, 600)
        await sleep(300)
        await tap(win, at)
        await sleep(1600)
        // the deploy folder there (a path in that computer's own form, so matched by its end)
        at = await glide(win, at, await center(win, '[data-mv-sug$="deploy"]'), 700)
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
        at = await glide(win, at, await center(win, '.pcard[data-name="Theo"]'), 600)
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
  // On and off from the cards: June goes to sleep (black and white, where her card was) and wakes up again, and Rex
  // too; nothing else moves.
  async switchGif() {
    const win = await dashboard('light', 'crew')
    await js(win, click('[data-mode=cards]'))
    await sleep(1400)
    const box = await js(win, "const h = document.querySelector('.page-head[data-for=crew]').getBoundingClientRect(); const g = document.querySelector('.col-grid').getBoundingClientRect(); return { x: Math.round(h.x), y: Math.round(h.y), width: Math.round(h.width), height: Math.round(Math.min(innerHeight - h.y, g.bottom - h.y)) }")
    let at = { x: box.x + box.width / 2, y: box.y + 60 }
    const flip = async (name) => {
      at = await glide(win, at, await center(win, `.pcard[data-name="${name}"] .switch`), 600)
      await sleep(250)
      await tap(win, at)
    }
    await record(win, 'crew-switch', {
      clip: box, ms: 7200, width: 1000,
      during: async () => {
        await sleep(500)
        await flip('June')
        await sleep(1300)
        await flip('Rex@workstation')
        await sleep(1300)
        await flip('June')
        await sleep(1100)
        await flip('Rex@workstation')
      },
    })
    win.destroy()
  },
  // Nobody yet, and no tasks yet: the empty Crew view and the empty board.
  async empty(theme) {
    for (const [name, view, code] of [['empty-crew', 'crew', 's.agents = []; s.feed = []'], ['empty-tasks', 'tasks', 's.tasks = { ...s.tasks, tickets: [] }']]) {
      const win = await dashboard(theme, view)
      await sleep(700)
      await js(win, `const s = window.__crewState; ${code}; window.__crewEmit('state', s)`)
      await sleep(1300)
      await js(win, "for (const a of document.getAnimations()) { try { const t = a.effect?.getTiming?.(); if (t && t.iterations !== Infinity) a.finish(); else { a.pause(); a.currentTime = 0 } } catch {} }")
      await sleep(200)
      await save(win, `${name}-${theme}`)
      win.destroy()
    }
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
        await js(win, click('.pcard[data-name="Iris"]'))
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
  // A linked computer's workspaces: the name's menu offering them, a joined one on screen (a second Storefront, the
  // linked computer's), the same one while its owner is off, one joined from the menu, and the tray's switcher.
  // Linked computers' workspaces, there on their own: the rail with this computer's first and each other computer's
  // after a line, each tile marked with its computer; one on screen (its header chip says where it's hosted); one whose
  // computer is off; the menu offering one you hid; and the tray.
  async workspaceJoin(theme) {
    const win = await dashboard(theme, 'chat', { fixture: 'workspaces' })
    await sleep(900)
    await save(win, `hosted-rail-${theme}`)
    await js(win, "window.__crewEmit('state', (window.__crewShow('storefront-2'), window.__crewState))")
    await sleep(900)
    await save(win, `hosted-on-screen-${theme}`)
    await js(win, "window.__crewEmit('state', (window.__crewShow('notes'), window.__crewState))")
    await sleep(900)
    await save(win, `hosted-owner-offline-${theme}`)
    await js(win, click('.ws-switch'))
    await sleep(500)
    await save(win, `hosted-menu-${theme}`)
    await js(win, click(`.menu [data-menu-act="join:${LINK.slug}:api"]`))
    await sleep(1200)
    await save(win, `hosted-shown-again-${theme}`)
    win.destroy()
    const tray = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover', fixture: 'workspaces' })
    await sleep(500)
    await fitToContent(tray)
    await js(tray, click('.ws-switch'))
    await sleep(400)
    await save(tray, `hosted-tray-${theme}`)
    tray.destroy()
  },
  // Workspaces: the switcher open over Docs site, the sheet that makes one, one's settings, and a parked one.
  async workspaces(theme) {
    const win = await dashboard(theme, 'chat', { fixture: 'workspaces' })
    await sleep(900)
    // the rail: Storefront needs you, Docs site on screen, Research parked
    await save(win, `ws-rail-${theme}`)
    await js(win, click('.ws-switch'))
    await sleep(500)
    await save(win, `ws-menu-${theme}`)
    await js(win, click('.menu [data-menu-act=new]'))
    await sleep(600)
    await js(win, `const i = document.querySelector('[data-ws-name]'); i.value = 'Checkout'; i.dispatchEvent(new Event('input', { bubbles: true }))`)
    await js(win, click('[data-ws-icon="🛒"]'))
    for (const n of ['Ada', 'Iris']) await js(win, `document.querySelector('[data-ws-member="${n}"]').click()`)
    await sleep(700)
    await save(win, `ws-new-${theme}`)
    await js(win, "document.querySelector('#ws').close()")
    await sleep(300)
    await js(win, 'workspaces.settings()')
    await sleep(700)
    await save(win, `ws-settings-${theme}`)
    await js(win, "document.querySelector('#ws').close()")
    await js(win, "workspaces.settings('default')")
    await sleep(700)
    await save(win, `ws-home-settings-${theme}`)
    await js(win, "document.querySelector('#ws').close()")
    await sleep(300)
    // who works here, from #general's faces
    await js(win, click('.mh-faces'))
    await sleep(500)
    await save(win, `ws-members-${theme}`)
    await js(win, "document.querySelector('.members-pop').hidePopover()")
    // right-click a workspace on the rail
    await js(win, "const r = document.querySelector('.rail-ws[data-ws=research]').getBoundingClientRect(); document.querySelector('.rail-ws[data-ws=research]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.right - 8, clientY: r.top + 20 }))")
    await sleep(500)
    await save(win, `ws-rail-menu-${theme}`)
    await js(win, "openMenu?.close()")
    await sleep(300)
    // a new workspace's empty #general: its first steps
    await js(win, "await crew.call('workspace', 'create', null, { name: 'Checkout', icon: '🛒', color: 'teal', members: ['Ada', 'Iris'] }); const s = window.__crewState; s.feed = []; s.agents = s.agents.map((a) => ({ ...a, status: 'idle', activity: '', subs: [], unread: 0 })); window.__crewEmit('state', s)")
    await sleep(900)
    await save(win, `ws-welcome-${theme}`)
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
  // the places: chat (a channel), crew (Agents), tasks, terminals; grid and focus are Terminals laid out that way
  const place = { grid: 'terminals', focus: 'terminals' }[view] ?? view
  const layout = view === 'focus' ? 'focus' : view === 'grid' ? 'grid' : null
  await js(win, `localStorage.setItem('crew.place', '${place}'); ${layout ? `localStorage.setItem('crew.layout', '${layout}');` : ''} localStorage.setItem('crew.target', 'auto'); localStorage.removeItem('crew.edTab'); for (const k of Object.keys(localStorage)) if (k.startsWith('crew.channel.')) localStorage.removeItem(k); ${reset.map((k) => `localStorage.removeItem('${k}');`).join(' ')}`)
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

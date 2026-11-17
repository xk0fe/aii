// Renders every view with a made-up clique (scripts/screenshot-preload.cjs) and saves PNGs, plus short GIFs of
// the animations. Nothing starts and ~/.clique is untouched. Run: npm run shots [-- out-dir [shot names...]] [--webp] [--win]
// [--frame] [--dark] [--window=1100x700]
import { app, BrowserWindow, ipcMain, nativeTheme, protocol } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { restartWords } from '../core/updates.js'
import { followWindow } from '../core/follow.js'

import { serveSandbox } from '../core/sandbox.js'
import { serveFiles, FILES_SCHEME } from '../core/linkfiles.js'
import { sampleFiles } from './sample-files.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-shots-'))
app.setPath('userData', path.join(tmp, 'userdata'))
protocol.registerSchemesAsPrivileged([FILES_SCHEME]) // the files shot: a linked computer's recording plays from clique-file:// (core/linkfiles.js)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// --win: every view as Windows shows it (screenshot-preload.cjs ?platform=win32)
const WIN = process.argv.includes('--win')
// --frame: every picture stands on the stage (scripts/stage.html): a window with its corners and its shadow on the first
// run's glow, see-through around the stage, so it sits on a page in either theme. The README's pictures are made this
// way (npm run readme). A recording comes out as an animated WebP only: a GIF has no soft edges to stand there with.
const FRAME = process.argv.includes('--frame')
// --dark: everything in the dark theme. For the recordings, which are made in light otherwise: they're saved as <name>-dark.
const DARK = process.argv.includes('--dark')
// --window=1100x700: the dashboard's window where a shot doesn't ask for a size (1440×880 otherwise). A smaller window
// reads better wherever the picture is shown smaller than the window was.
const [WIN_W, WIN_H] = process.argv.find((a) => a.startsWith('--window='))?.slice(9).split('x').map(Number) ?? [1440, 880]
// The computer linked to this one, where the demo clique's Rex and Noor run (screenshot-preload.cjs): the Windows PC
// Workstation, or with --win (when this one is Workstation) the Mac Studio.
const LINK = WIN ? { slug: 'studio', name: 'Studio' } : { slug: 'workstation', name: 'Workstation' }
const REX = `Rex@${LINK.slug}`
const NOOR = `Noor@${LINK.slug}`
// The events shot: what CLIque says in the chat, as the hub posts it (two agents stopping together, Claude's weekly
// limit getting close, a clique waking up, a lost turn, a task fixed, a new conversation, a context limit passed)
const EVENTS_FEED = `const s = window.__cliqueState; const t = (m) => Date.now() - m * 60000
  const day = new Date(Date.now() + 2 * 86400000); day.setHours(15, 0, 0, 0); const resets = day.getTime()
  s.feed = [
    { id: 'e1', kind: 'reply', from: 'Theo', to: 'you', text: 'All 48 checkout tests pass on Chrome and Safari.', ts: t(30) },
    { id: 'e2', kind: 'event', from: '${REX}', text: 'exited (code 143)', ts: t(26) },
    { id: 'e3', kind: 'event', from: '${NOOR}', text: 'exited (code 143)', ts: t(26) },
    { id: 'e4', kind: 'event', from: 'clique', alert: true, text: "Claude is at 90% of its weekly limit. At this pace it runs out Wed at 13:54, before it resets Wed at 15:00", ts: t(20),
      limit: { account: 'claude', label: 'Claude', window: 'seven_day', name: 'weekly limit', pct: 90, resetsAt: resets, runsOut: resets - 66 * 60000 } },
    { id: 'e6', kind: 'event', from: 'clique', text: 'woke up: @Ada and @Milo pick up where they left off', ts: t(12) },
    { id: 'e7', kind: 'event', from: 'Ada', text: 'lost its turn to an API error (overloaded), so CLIque types "continue" for it in 20s', ts: t(9) },
    { id: 'e7b', kind: 'task', type: 'bug', act: 'fixed', from: 'Ada', ticket: 4, title: 'Totals round wrong with 3 items', text: 'Rounding happened per line; now once on the total.', ts: t(8) },
    { id: 'e8', kind: 'event', from: 'Milo', fresh: true, text: 'started a new conversation for #7', ts: t(6) },
    { id: 'e9', kind: 'msg', from: 'you', to: 'Milo', text: 'Start with the coupon guard, then the expired-code message.', ts: t(5.9) },
    { id: 'e10', kind: 'event', from: 'Iris', alert: true, text: 'passed its 400k context limit (412k used). Start a new conversation when it suits you', ts: t(2) },
  ]
  window.__cliqueEmit('state', s)`
// The askSteps shot: a question whose steps came in one run, the way an agent writes them into its one line
const STEPS_ASK = {
  type: 'question', alert: 'asks: Where are you?',
  questions: [{
    header: 'Postmark setup', multiSelect: false,
    question: "This part is yours by hand before I can send the order emails (about 5 minutes, no card needed), with the shop's Postmark account. (1) postmarkapp.com: 'Servers', then 'Create server', any name, Create. (2) On its 'API Tokens' tab click 'Generate token' and copy it (it is shown only once). (3) Under 'Sender Signatures' add orders@storefront.test, then confirm the email it sends you. (4) Save the token in your keychain as postmark-storefront: Keychain Access, 'New Password Item'. Do not paste the token into chat. Where are you?",
    options: [
      { label: 'Done, the token is saved', description: 'It is in the keychain as postmark-storefront. I check it with a test email.' },
      { label: "I'll do this later", description: 'I stop here. The templates stay ready; nothing is sent until the token exists.' },
      { label: 'Something looks different', description: 'A page or button does not match. Tell me what you see and I will look it up.' },
    ],
  }],
}
// The canvas shot: a real #evidence reply redrawn as a canvas in an agent's final message ("via canvas"), then one made
// with `clique canvas new` that a teammate added to (who else drew on it, and the line that says so and leads back)
const CANVAS_FEED = [
  { id: 'k1', kind: 'msg', from: 'you', to: 'Iris', text: 'How did candidate v1 do on test_dev?' },
  {
    id: 'k2', kind: 'reply', from: 'Iris', to: 'you',
    text: ['**Selected candidate v1** was assessed once on **30 `test_dev` courses in 30 spatial groups**.', '', '```canvas', 'title: Candidate v1 on 30 test_dev courses', 'sub: region IoU per class, course-balanced', 'bar: Green 0.6713 {green}', 'bar: Fairway 0.6485 {green}', 'bar: Water 0.6151 {blue}', 'bar: Bunker 0.5965 {yellow}', 'bar: Tee 0.3241 {pink}', 'bar: Macro average 0.5711 {grey}', 'ok: one run, with "other" left out of the average', 'no: OSM proxy scores with assumed negatives, ==not human-reviewed==', 'source: selected-v1-test_dev-aggregate.json', '```'].join('\n'),
  },
  { id: 'k3', kind: 'msg', from: 'you', to: 'Iris', text: 'Where does that number come from? @Theo add what you verified.' },
  {
    id: 'k4', kind: 'reply', from: 'Iris', canvas: { by: ['Iris', 'Iris', 'Iris', 'Iris', 'Theo', 'Theo', 'Theo'], rev: 1 },
    text: ['```canvas', 'title: How the score is made', '1: [30 test_dev courses] -> [candidate v1]{purple} -> [predicted masks]', '2: [predicted masks] -against-> [OSM labels]{yellow} -> [IoU per class]{green}', '3: IoU per class -> ==macro average 0.5711==', 'ok: checkpoint and prediction hashes verified', 'no: no test overlays inspected', 'note: a proxy score, not an accepted release pass {pink}', '```'].join('\n'),
  },
  { id: 'k5', kind: 'event', from: 'Theo', text: 'added to @Iris\'s canvas "How the score is made"', canvasOf: 'k4' },
]
// The reactions shots: one scripted exchange, twice. 'acks': every "got it" is a message, as it was. 'reactions': the
// same agents put an emoji on what they were told instead (clique react), and the acknowledgements are gone from the chat.
const REACT_FEED = (mode) => {
  const on = mode === 'reactions'
  const gist = (text) => text.split('\n')[0].split(/(?<=[.!?])\s/)[0]
  const r = (by, emoji, said) => ({ by, emoji, at: 0, ...(said && { said }) })
  const say = (id, from, to, text, re, extra = {}) => ({ id, kind: 'msg', from, to, text, re, thread: 'y0', gist: gist(text), ...extra })
  const said = (id, from, text, re, extra = {}) => ({ id, kind: 'reply', from, text, re, gist: gist(text), ...extra })
  const news = 'Heads-up: the release freeze starts Thursday at 5pm. Nothing to do yet.'
  const cc = { cc: ['Ada', 'Milo', 'Theo'], sendId: 'sx' }
  return [
    { id: 'xa', kind: 'msg', from: 'you', to: 'Ada', text: news, ...cc, ...(on && { reactions: [r('Ada', '👍')] }) },
    { id: 'xm', kind: 'msg', from: 'you', to: 'Milo', text: news, ...cc, ...(on && { reactions: [r('Milo', '👍', 'Noted, thanks.')] }) },
    { id: 'xt', kind: 'msg', from: 'you', to: 'Theo', text: news, ...cc, ...(on && { reactions: [r('Theo', '👀')] }) },
    ...(on ? [] : [
      said('xa1', 'Ada', 'Got it, the freeze is Thursday at 5pm.', 'xa', { thread: 'xa', out: true }),
      said('xm1', 'Milo', 'Noted, thanks.', 'xm', { thread: 'xm', out: true }),
      said('xt1', 'Theo', 'Acknowledged. Nothing to add from testing.', 'xt', { thread: 'xt', out: true }),
    ]),
    { id: 'y0', kind: 'msg', from: 'you', to: 'Ada', text: 'Rename `rows` to `items` in the cart API, and let Milo and Theo know.' },
    say('y1', 'Ada', 'Milo', 'I renamed `rows` to `items` in GET /api/cart. Your cart table reads the old name: switch it over.', 'y0'),
    say('y2', 'Ada', 'Theo', 'Heads-up: `rows` is `items` in the cart API now. Nothing for you to do unless a test names it.', 'y0', on ? { reactions: [r('Theo', '👍', 'No test names it.')] } : {}),
    said('y3', 'Ada', 'Renamed in the API, and Milo and Theo know. Milo has one change to make in the cart table.', 'y0', { thread: 'y0', out: true }),
    ...(on ? [] : [said('y4', 'Theo', 'Thanks, noted. No test names it, so nothing to change.', 'y2', { thread: 'y0' })]),
    say('y5', 'Milo', 'Ada', 'Switched the cart table to `items`. It is on feat/cart-items, and the page still renders.', 'y1', on ? { reactions: [r('Ada', '🙏')] } : {}),
    ...(on ? [] : [said('y6', 'Ada', 'Thanks Milo, got it. Nothing more from me.', 'y5', { thread: 'y0' })]),
    said('y7', 'Ada', 'All done: the API and the cart table both use `items` now.', 'y0', { thread: 'y0', out: true, ...(on && { reactions: [r('you', '🎉')] }) }),
  ]
}
const REACT_SETUP = (mode) => `const s = window.__cliqueState; const t = (m) => Date.now() - m * 60000
  s.feed = ${JSON.stringify(REACT_FEED(mode))}.map((e, i, all) => ({ ...e, ts: t(2 * (all.length - i)) }))
  for (const a of s.agents) Object.assign(a, { status: 'idle', activity: '', subs: [], waitingOn: [], thread: undefined })
  s.reads = { since: Date.now() + 1e6, agents: {} }
  window.__cliqueEmit('state', s)`
// The check-in shots (core/hub.js checkIn), as the hub posts them. Claude: a request of yours that Ada and Milo passed
// back and forth until it had used $5.40, the hand-offs in the request's thread, the last one held, and the card.
// Codex: Theo alone on a long test run, in tokens. And "Just tell me": the line that comes instead of a card.
const CHECK_IN_HEAD = `const s = window.__cliqueState; const t = (m) => Date.now() - m * 60000
  s.checkIn = { at: { claude: 5, codex: 5e6 }, then: 'ask' }
  const calm = (busy, doing) => { s.agents = s.agents.map((a) => ({ ...a, status: a.name === busy ? 'working' : a.status === 'off' ? 'off' : 'idle', activity: a.name === busy ? doing : '', since: Date.now() - 60000, subs: [], waitingOn: [], owes: [], queue: 0 })) }
  const card = (id, from, re, spend, title, say) => ({ id, kind: 'ask', from, to: 'you', cli: 'clique', re, thread: re, out: true, ts: t(1), ask: { type: 'permission', tool: 'clique spend', always: [], title, say,
    detail: 'Nothing new starts until you answer. Turns already running finish first.', spend: { since: t(47), from: 'you', ...spend } } })
  const loop = [
    { id: 'c0', kind: 'reply', from: 'Theo', to: 'you', text: 'All 48 checkout tests pass on Chrome and Safari.', ts: t(55) },
    { id: 'c1', kind: 'msg', from: 'you', to: 'Ada', text: 'The checkout takes four seconds to load. Find out why and fix it with Milo.', ts: t(47) },
    { id: 'c2', kind: 'msg', from: 'Ada', to: 'Milo', re: 'c1', thread: 'c1', round: 'c1', text: 'The order API is fine (180 ms). The page waits on three requests in a row. Can you load them together?', gist: 'The order API is fine (180 ms).', ts: t(40) },
    { id: 'c3', kind: 'msg', from: 'Milo', to: 'Ada', re: 'c2', thread: 'c1', round: 'c1', text: 'That needs the totals in one call. Can the API return them with the cart?', gist: 'That needs the totals in one call.', ts: t(26) },
    { id: 'c4', kind: 'msg', from: 'Ada', to: 'Milo', re: 'c3', thread: 'c1', round: 'c1', text: 'Done: GET /cart includes the totals now. Try it.', gist: 'Done: GET /cart includes the totals now.', ts: t(12) },
  ]`
const CHECK_IN_FEED = (kind = 'claude') => `${CHECK_IN_HEAD}
  s.feed = ${{
    // before the card: Milo is still on it
    before: 'loop',
    claude: `[...loop, { id: 'c5', kind: 'msg', from: 'Milo', to: 'Ada', re: 'c4', thread: 'c1', round: 'c1', paused: 'c1|claude', text: 'Down to 1.1 s. Can you cache the shipping rates too?', gist: 'Down to 1.1 s.', ts: t(1.2) },
      card('c6', 'Ada', 'c1', { group: 'c1|claude', provider: 'claude', label: 'Claude', unit: 'usd', who: ['Ada', 'Milo'], by: { Ada: 3.7, Milo: 1.7 }, used: 5.4, at: 5 }, '@Ada and @Milo have used $5.40 at API rates since you last spoke', "We've used $5.40 at API rates since you last spoke. Keep going?")]`,
    codex: `[loop[0], { id: 'd1', kind: 'msg', from: 'you', to: 'Theo', text: 'Run the whole checkout suite on every browser, and fix what fails.', ts: t(47) },
      card('d2', 'Theo', 'd1', { group: 'd1|codex', provider: 'codex', label: 'Codex', unit: 'tokens', who: ['Theo'], by: { Theo: 5.2e6 }, used: 5.2e6, at: 5e6 }, '@Theo has used 5.2M tokens since you last spoke', "I've used 5.2M tokens since you last spoke. Keep going?")]`,
    tell: `[...loop, { id: 'c5', kind: 'msg', from: 'Milo', to: 'Ada', re: 'c4', thread: 'c1', round: 'c1', text: 'Down to 1.1 s. Can you cache the shipping rates too?', gist: 'Down to 1.1 s.', ts: t(1.2) },
      { id: 'c6', kind: 'event', from: 'clique', text: '@Ada and @Milo have used $5.40 at API rates since you last spoke', spend: { provider: 'claude', unit: 'usd', used: 5.4, at: 5 }, ts: t(1) }]`,
  }[kind]}
  ${kind === 'tell' ? "s.checkIn.then = 'tell'" : ''}
  calm(${{ before: "'Milo', 'Edit pages/checkout.tsx'", claude: "'', ''", codex: "'Theo', 'Bash: npm test -- checkout'", tell: "'Ada', 'Edit api/shipping.ts'" }[kind]})
  window.__cliqueEmit('state', s)`
// What's behind the transparent windows: the popover's material, or a soft desktop for the floating pill.
const BACKDROP = {
  popover: { light: '#ececef', dark: '#2b2b2f' },
  desktop: { light: 'linear-gradient(135deg, #dfe7f5, #f1e4f1)', dark: 'linear-gradient(135deg, #1c2233, #2a1f2e)' },
}

// cache: where a linked computer's files are kept, for a shot that shows one (the files shot): the page then loads them
// through clique-file://, as the app does.
async function open(file, { theme, width, height, backdrop, fixture, transparent = false, cache }) {
  if (DARK) theme = 'dark'
  // on the stage, what floats over the desktop keeps its see-through window: the stage is what's behind it
  const float = FRAME && backdrop === 'desktop'
  if (nativeTheme.themeSource !== theme) {
    nativeTheme.themeSource = theme
    await sleep(300)
  }
  const win = new BrowserWindow({
    width, height, show: false, paintWhenInitiallyHidden: true, useContentSize: true, frame: false, transparent: transparent || float,
    webPreferences: { preload: path.join(root, 'scripts', 'screenshot-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  })
  win.stageKind = float ? 'float' : 'window'
  win.webContents.on('console-message', (e) => e.level === 'error' && console.error(`${file}: ${e.message}`))
  const query = { ...(fixture && { fixture }), ...(WIN && { platform: 'win32' }), ...(cache && { cache }) }
  // --win: Windows draws its window buttons over the dashboard's titlebar (main.js titleBarOverlay); stand-ins show
  // where, on every load (shots reload the page)
  if (WIN && file === 'dashboard.html') {
    win.webContents.on('did-finish-load', () => win.webContents.insertCSS(`html::after { content: '\\2014\\00a0\\00a0\\00a0\\00a0\\00a0\\25A2\\00a0\\00a0\\00a0\\00a0\\00a0\\2715'; position: fixed; top: 0; right: 0; z-index: 9999;
      width: 138px; height: 45px; display: grid; place-items: center; font: 14px 'Segoe UI', sans-serif; color: var(--fg); background: var(--bg); pointer-events: none; }`))
  }
  await win.loadFile(path.join(root, 'ui', file), Object.keys(query).length ? { query } : {})
  if (backdrop && !float && !(WIN && backdrop === 'popover')) await win.webContents.insertCSS(`html { background: ${BACKDROP[backdrop][theme]} !important; }`)
  return win
}

const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`)

// Popover-style windows size themselves to their content through clique.fit().
async function fitToContent(win) {
  const fit = await js(win, 'return window.__cliqueFit')
  if (fit) win.setContentSize(Math.ceil(fit.width), Math.ceil(fit.height))
  await sleep(150)
}

// A still picture: the creatures at rest (eyes open, nobody mid-move), what was sliding in already in place.
const FREEZE = `for (const a of document.getAnimations()) {
  try {
    const t = a.effect?.getTiming?.()
    if (t && t.iterations !== Infinity) { a.finish(); continue }
    a.pause()
    a.currentTime = { 'av-wiggle': 70, 'av-wiggle-soft': 400, 'av-z': 1100 }[a.animationName] ?? 0
  } catch {}
}`
// bare: the picture as it is, even with --frame (the cover is a whole picture already). phone: a capture of the phone
// app to stand in front of the window (--frame only). crop: only this part of the window ({ x, y, width, height }).
async function save(win, name, { bare = false, phone, crop } = {}) {
  await js(win, FREEZE)
  await sleep(60)
  const img = await (crop ? win.webContents.capturePage(crop) : win.webContents.capturePage())
  fs.writeFileSync(path.join(out, `${name}.png`), FRAME && !bare ? await onStage(win, img, { phone, size: crop }) : img.toPNG())
  console.log('saved', `${name}.png`)
}

// ---- the stage (--frame) ----
// One hidden window draws every stage (scripts/stage.html), in the theme the shot was taken in. Returns the stage's
// size in px (and where the picture sits on it) with the capture.
let stageWin = null
async function stage(params) {
  stageWin ??= new BrowserWindow({ width: 800, height: 600, show: false, paintWhenInitiallyHidden: true, useContentSize: true, frame: false, transparent: true, webPreferences: { backgroundThrottling: false } })
  await stageWin.loadURL(`${pathToFileURL(path.join(root, 'scripts', 'stage.html')).href}?${new URLSearchParams(params)}`)
  const size = await stageWin.webContents.executeJavaScript('window.__ready.then(() => window.__size)')
  stageWin.setContentSize(size.width, size.height)
  await sleep(300)
  return { size, image: await stageWin.webContents.capturePage({ x: 0, y: 0, width: size.width, height: size.height }) }
}
const fileURL = (file) => pathToFileURL(file).href
// A still picture on the stage: the window's capture as it was taken, at the size the window was.
async function onStage(win, img, { phone, size } = {}) {
  const file = path.join(tmp, `stage-${Date.now()}.png`)
  fs.writeFileSync(file, img.toPNG())
  const { width, height } = size ?? win.getContentBounds()
  const { image } = await stage([['w', width], ['h', height], ['kind', win.stageKind ?? 'window'], ['src', fileURL(file)], ...(phone ? [['phone', fileURL(phone)]] : [])])
  return image.toPNG()
}

// Every frame Chromium paints, each with its real timestamp, then one GIF at the true speed.
async function record(win, name, { clip, ms, during, width = 760 }) {
  if (DARK) name += '-dark'
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
  if (FRAME) {
    // The recording on the stage: the stage drawn once with the window empty, each frame laid over it with the window's
    // corners (a mask), at the scale the frames were kept at. What floats has no window: its frames are see-through.
    const { width: w, height: h } = clip ?? win.getContentBounds()
    const k = width / w
    const even = (v) => 2 * Math.round(v / 2)
    const floats = win.stageKind === 'float'
    const back = await stage([['w', Math.round(w)], ['h', Math.round(h)], ['kind', win.stageKind ?? 'window']])
    // the stage and the mask are scaled once, here, not once a frame
    const fh = Math.round(h * k), ow = even(back.size.width * k), oh = even(back.size.height * k)
    fs.writeFileSync(path.join(dir, 'back.png'), back.image.resize({ width: ow, height: oh, quality: 'best' }).toPNG())
    const still = (file) => ['-framerate', '20', '-loop', '1', '-i', path.join(dir, file)]
    const inputs = [...still('back.png'), '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt')]
    let fg = `[1:v]fps=20,scale=${width}:${fh}:flags=bicubic,format=rgba[win]`
    if (!floats) {
      const mask = await stage([['w', Math.round(w)], ['h', Math.round(h)], ['part', 'mask']])
      fs.writeFileSync(path.join(dir, 'mask.png'), mask.image.resize({ width, height: fh, quality: 'best' }).toPNG())
      inputs.push(...still('mask.png'))
      fg = `[1:v]fps=20,scale=${width}:${fh}:flags=bicubic,format=rgba[fg];[2:v]format=gray[m];[fg][m]alphamerge[win]`
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex',
      `${fg};[0:v]format=rgba[bg];[bg][win]overlay=${Math.round(back.size.x * k)}:${Math.round(back.size.y * k)}:shortest=1`,
      // the stage and the mask are stills that never end: the recording's own length ends it
      '-t', (ms / 1000).toFixed(3), '-c:v', 'libwebp_anim', '-q:v', '76', '-compression_level', '4', '-loop', '0', path.join(out, `${name}.webp`)])
    console.log('saved', `${name}.webp`, `(${frames.length} frames, on the stage)`)
    return
  }
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

// Under the mouse: the window's corner put somewhere on the picture (--wx, --wy), and the pointer drawn where it is (--px, --py).
const POINTER = `html { min-height: 100vh; } .wrap { position: absolute !important; left: var(--wx, 0); top: var(--wy, 0); }
  html::after { content: ''; position: fixed; left: var(--px, 0); top: var(--py, 0); width: 20px; height: 26px; z-index: 999; pointer-events: none;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 26'%3E%3Cpath d='M2 2v18.5l4.6-4.3 3.1 7.3 2.9-1.2-3.1-7.2h6.2z' fill='%23000' stroke='%23fff' stroke-width='1.6' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat; }`
// The floating chat's page as main.js loads it under the mouse (?at=mouse), on the soft desktop, with the pointer drawn.
// still: for pictures, its eyes stay open (it blinks now and then, and a picture might catch it).
async function underMouse(theme, { width, height, still = false }) {
  const win = await open('overlay.html', { theme, width, height, backdrop: 'desktop' })
  if (DARK) theme = 'dark'
  await win.loadFile(path.join(root, 'ui', 'overlay.html'), { query: { at: 'mouse', ...(WIN && { platform: 'win32' }) } })
  await win.webContents.insertCSS(`${win.stageKind === 'float' ? '' : `html { background: ${BACKDROP.desktop[theme]} !important; }`} ${POINTER} ${still ? '.blink .home ellipse { transform: none !important; }' : ''}`)
  return win
}

// The top of a MacBook's screen behind the hatch shots: a menu bar and the notch, which is really a hole in the screen so
// it's drawn over what's underneath. What's in the window is centered on it, as main.js places it.
const SCREEN_TOP = `html::before { content: ''; position: fixed; inset: 0 0 auto 0; height: 33px; background: rgba(255, 255, 255, .28); }
  html::after { content: ''; position: fixed; top: 0; left: 50%; width: 185px; height: 32px; margin-left: -92.5px; background: #000; border-radius: 0 0 9px 9px; z-index: 99; pointer-events: none; outline: 1px dashed rgba(255, 90, 170, var(--notch-guide, 0)); }
  .wrap { position: absolute !important; left: 50%; top: 0; transform: translateX(-50%); }`

// The files shot: what agents attach (`clique attach`, core/attachments.js), made once (scripts/sample-files.mjs). The
// last one is on the linked computer: here it's in this computer's cache of that one (core/linkfiles.js), whole, as
// after it was played once.
let samples = null
const FILES_CACHE = path.join(tmp, 'files', 'cache')
const filesFeed = async () => {
  samples ??= await sampleFiles(path.join(tmp, 'files'))
  const f = samples
  const theirs = path.join(FILES_CACHE, LINK.slug, 'c0ffee00c0ffee00c0ff.mp4')
  if (!fs.existsSync(theirs)) (fs.mkdirSync(path.dirname(theirs), { recursive: true }), fs.copyFileSync(f.clip.path, theirs))
  return [
    { id: 'f1', kind: 'msg', from: 'you', to: 'Theo', text: 'Show me the new checkout, on desktop and on a phone.' },
    { id: 'f2', kind: 'reply', from: 'Theo', text: 'The new checkout on desktop. The total rounds once now.', files: [f.desktop] },
    // (reactions, core/reactions.js, sit under a message's files)
    { id: 'f3', kind: 'reply', from: 'Theo', text: 'And on a phone: cart, payment, receipt.', files: [f.cart, f.payment, f.receipt], reactions: [{ by: 'you', emoji: '👍', at: 1 }, { by: 'Iris', emoji: '👍', at: 2 }, { by: 'June', emoji: '🎉', at: 3 }] },
    { id: 'f4', kind: 'reply', from: 'Iris', text: 'The coupon flow from start to finish.', files: [f.clip], reactions: [{ by: 'Theo', emoji: '👀', at: 1 }] },
    { id: 'f5', kind: 'reply', from: 'Ada', text: 'The totals as a page you can try: change the quantities.', files: [f.page], reactions: [{ by: 'you', emoji: '🎉', at: 1 }] },
    { id: 'f6', kind: 'reply', from: 'June', text: 'All 48 checkout tests pass. The log:', files: [f.log] },
    { id: 'f7', kind: 'reply', from: REX, text: 'The same run on Windows.', files: [{ ...f.clip, name: 'checkout-windows.mp4', path: theirs, home: LINK.name }] },
  ]
}
const chatColumn = (win) => js(win, "const r = document.querySelector('.page-head[data-for=chat]').getBoundingClientRect(); return { x: Math.round(r.x), y: 0, width: Math.round(innerWidth - r.x), height: innerHeight }")
const FILES_STATE = (feed) => `const s = window.__cliqueState; const t = (m) => Date.now() - m * 60000
  s.feed = ${JSON.stringify(feed)}.map((e, i, all) => ({ ...e, ts: t(3 * (all.length - i)) }))
  window.__cliqueEmit('state', s)`

const SHOTS = {
  // CLIque updating itself (core/updates.js): the note in the corner when a new version is ready, the question it asks
  // before restarting while agents work (they keep working; or, when the update replaces the terminal host, they don't),
  // restarting, and the rows in the ⋯ menu and the popover's gear: Open at login, Check for updates…, Restart to update.
  async updates(theme) {
    const win = await dashboard(theme, 'chat', { width: 1180, height: 760 })
    const ready = { phase: 'ready', next: { version: '1.0.1', notesUrl: 'https://example.com/releases/v1.0.1' }, later: false, asking: null }
    const corner = { x: 1180 - 372, y: 760 - 390, width: 372, height: 390 }
    const push = async (patch) => {
      await js(win, `window.__cliqueUpdate(${JSON.stringify(patch)})`)
      await sleep(500)
    }
    await push(ready)
    await save(win, `update-ready-${theme}`)
    await save(win, `update-ready-note-${theme}`, { crop: corner })
    const words = (hostProtocol) => restartWords({ busy: ['Ada', 'Theo'], outlives: true, hostProtocol, protocol: 1, product: 'CLIque' })
    await push({ asking: words(1) })
    await save(win, `update-ask-keep-${theme}`, { crop: corner })
    await push({ asking: words(2) })
    await save(win, `update-ask-stop-${theme}`, { crop: corner })
    await push({ asking: restartWords({ busy: ['Ada'], outlives: true, hostProtocol: undefined, protocol: 1 }) })
    await save(win, `update-ask-unsure-${theme}`, { crop: corner })
    await push({ phase: 'restarting', asking: null })
    await save(win, `update-restarting-${theme}`, { crop: corner })
    // the ⋯ menu, with nothing new (Check for updates…, this version) and with one ready (Restart to update)
    const menu = async (name) => {
      await js(win, click('.side-more'))
      await sleep(400)
      const r = await js(win, "const r = [...document.querySelectorAll('.menu[role=menu]')].at(-1).getBoundingClientRect(); return { x: Math.max(0, Math.round(r.x) - 16), y: Math.max(0, Math.round(r.y) - 16), width: Math.round(r.width) + 32, height: Math.round(r.height) + 76 }")
      await save(win, name, { crop: r })
      await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
      await sleep(300)
    }
    await push({ phase: 'idle', next: null })
    await menu(`update-menu-${theme}`)
    await push({ ...ready, later: true })
    await js(win, 'window.__cliqueState.app.login.on = true')
    await menu(`update-menu-ready-${theme}`)
    win.destroy()
    // the popover's gear: the same rows
    const tray = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover' })
    await sleep(500)
    await fitToContent(tray)
    await js(tray, `window.__cliqueUpdate(${JSON.stringify({ ...ready, later: true })})`)
    await sleep(200)
    await js(tray, click('[data-act=settings]'))
    await sleep(400)
    await save(tray, `update-tray-${theme}`)
    tray.destroy()
  },
  // The note arriving, and Later: it slides up in the corner when the download is done, nothing else moves; Later puts
  // it away, and Restart to update stays in the ⋯ menu.
  async updatesGif() {
    const win = await dashboard('light', 'chat', { width: 1180, height: 760 })
    await sleep(600)
    await record(win, 'update-later', {
      clip: { x: 0, y: 760 - 420, width: 1180, height: 420 }, ms: 9000, width: 1000,
      during: async () => {
        let at = { x: 620, y: 520 }
        await glide(win, { x: 600, y: 480 }, at, 200)
        await sleep(900)
        await js(win, `window.__cliqueUpdate(${JSON.stringify({ phase: 'ready', next: { version: '1.0.1', notesUrl: 'https://example.com/releases/v1.0.1' } })})`)
        await sleep(1800)
        at = await glide(win, at, await center(win, '.update-note [data-update=later]'), 700)
        await sleep(350)
        await tap(win, at)
        await sleep(1300)
        at = await glide(win, at, await center(win, '.side-more'), 800)
        await sleep(200)
        await tap(win, at)
        await sleep(2600)
      },
    })
    win.destroy()
  },
  // Files agents attach: pictures, a recording, a page that runs in a sandbox, a plain file, and one that stayed on a
  // linked computer; then the recording playing and the page running, and the viewer.
  async files(theme) {
    const feed = await filesFeed()
    const win = await dashboard(theme, 'chat', { fixture: 'big', width: 1180, height: 1820, cache: FILES_CACHE })
    await js(win, FILES_STATE(feed))
    await sleep(1500)
    await save(win, `files-${theme}`, { crop: await chatColumn(win) })
    // the recording played (its bar shows while the pointer is on it: a pointer's move, for the picture) and the page run
    const SHOWN = "for (const p of document.querySelectorAll('.fxp.on')) p.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))"
    await js(win, `${click('.fxp-big')}; ${click('[data-fx=run]')}`)
    await sleep(2200)
    await js(win, `document.querySelector('.fx-video video').pause(); ${SHOWN}`)
    await sleep(300)
    await save(win, `files-live-${theme}`, { crop: await chatColumn(win) })
    win.setContentSize(1180, 760)
    await js(win, click('.fx-pics:not(.one) [data-fx=view]'))
    await sleep(500)
    await save(win, `files-viewer-${theme}`)
    await js(win, `${click('[data-fxv=close]')}; ${click('.fx-page [data-fx=view]')}`)
    await sleep(900)
    await save(win, `files-viewer-page-${theme}`)
    // the recording in the viewer: the same player, where it was
    await js(win, `${click('[data-fxv=close]')}; ${click('.fx-video [data-fx=view]')}`)
    await sleep(600)
    await js(win, SHOWN)
    await sleep(300)
    await save(win, `files-viewer-video-${theme}`)
    win.destroy()
    // the floating chat: the same cards in a narrow column
    const chat = await open('overlay.html', { theme, width: 520, height: 900, backdrop: 'desktop', cache: FILES_CACHE })
    await sleep(400)
    await js(chat, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await js(chat, `window.__cliqueState.agents.forEach((a) => Object.assign(a, { status: 'idle', ask: null, activity: null, subs: [] })); ${FILES_STATE(feed.slice(2, 6))}`)
    await sleep(1200)
    await fitToContent(chat)
    await save(chat, `files-chat-${theme}`)
    chat.destroy()
  },
  // A recording played and a page run where they are, in the chat
  async filesGif() {
    const feed = await filesFeed()
    const win = await dashboard(DARK ? 'dark' : 'light', 'chat', { fixture: 'big', width: 1000, height: 900, cache: FILES_CACHE })
    await js(win, FILES_STATE(feed.slice(3, 5)))
    await sleep(1200)
    const clip = await chatColumn(win)
    await record(win, 'files', {
      clip, ms: 9500,
      during: async () => {
        let at = await glide(win, { x: clip.x + 300, y: clip.y + 60 }, await center(win, '.fxp-big'))
        await tap(win, at)
        await sleep(2600)
        at = await glide(win, at, await center(win, '.fx-run'))
        await tap(win, at)
        await sleep(900)
        // inside the page: its + button, three times (the frame is the page's own: real clicks)
        const frame = await center(win, '.fx-page .fx-frame')
        at = await glide(win, at, { x: frame.x - frame.w / 2 + 381, y: frame.y - frame.h / 2 + 135 })
        // (through the debugger, which sends a click the way a real mouse does: into the frame's own process)
        const d = win.webContents.debugger
        d.attach('1.3')
        for (let i = 0; i < 3; i++) {
          for (const type of ['mousePressed', 'mouseReleased']) await d.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(at.x), y: Math.round(at.y), button: 'left', clickCount: 1 })
          await sleep(450)
        }
        d.detach()
      },
    })
    win.destroy()
  },
  // Reactions: an emoji on a message in place of a written "got it" (clique react). The same exchange with every
  // acknowledgement as a message (before) and as a reaction (after), in the channel and in the thread beside it; a
  // hand-off in an agent's conversation; and a message with more reactions than fit, in the narrow floating chat.
  async reactions(theme) {
    for (const mode of ['acks', 'reactions']) {
      const win = await dashboard(theme, 'chat', { width: 1180, height: 900, fixture: 'threads' })
      await js(win, REACT_SETUP(mode))
      await sleep(900)
      await js(win, click('.thread-card[data-thread="y0"]'))
      await sleep(700)
      const rows = await js(win, "return { channel: document.querySelectorAll('.feed .feed-list:not(.typing-list) > .item, .feed .feed-list:not(.typing-list) > .thread-card').length, thread: document.querySelectorAll('.thread-list .thread-row').length }")
      console.log(`reactions (${mode}): ${rows.channel} rows in the channel, ${rows.thread} in the thread`)
      await save(win, `reactions-${mode === 'acks' ? 'before' : 'after'}-${theme}`)
      if (mode === 'reactions') {
        // the hand-off itself, in the conversation with the agent it went to
        await js(win, click('.thread-x'))
        await js(win, click('.dm[data-agent="Theo"]'))
        await sleep(900)
        await save(win, `reactions-handoff-${theme}`)
      }
      win.destroy()
    }
    // the floating chat, 380 wide: long names, many reactions, one line
    const win = await open('overlay.html', { theme, width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, `const s = window.__cliqueState; const t = (m) => Date.now() - m * 60000
      const r = (by, emoji, said) => ({ by, emoji, at: 0, ...(said && { said }) })
      s.feed = [
        { id: 'm1', kind: 'msg', from: 'you', to: 'Ada', text: 'Checkout v2 is live. Thank you all.', ts: t(9), cc: ['Ada', 'Milo', 'Iris', 'Theo', 'June'], sendId: 'sm',
          reactions: [r('Ada', '🎉'), r('Milo', '🎉'), r('Iris', '🎉'), r('Theo', '🎉'), r('June', '🎉'), r('Ada', '🚀'), r('Milo', '❤️'), r('Iris', '🙌'), r('Theo', '✅'), r('June', '👏'), r('Theo', '🫡'), r('June', '💯')] },
        { id: 'm2', kind: 'reply', from: 'Theo', to: 'you', text: 'All 48 checkout tests pass on Chrome, Safari and Firefox.', ts: t(6), reactions: [r('you', '👍'), r('Ada', '👍'), r('you', '🎉')] },
        { id: 'm3', kind: 'msg', from: 'Ada', to: 'Milo', text: 'The orders endpoint returns totals in cents now. Nothing to change on your side.', ts: t(4), reactions: [r('Milo', '👀', 'Seen, the table already reads cents.')] },
        { id: 'm4', kind: 'msg', from: 'you', to: 'Iris', text: 'Standup is at 10:30 from tomorrow.', ts: t(2), reactions: [r('Iris', '👍')] },
      ]
      for (const a of s.agents) Object.assign(a, { status: 'idle', activity: '', subs: [] })
      s.reads = { since: Date.now() + 1e6, agents: {} }
      window.__cliqueEmit('state', s); window.__cliqueEmit('toggle', { open: true, focus: false })`)
    await sleep(900)
    await fitToContent(win)
    await save(win, `reactions-floating-${theme}`)
    // pointing at a message: the handy ones beside Reply (an agent's message, then one of yours)
    for (const [id, name] of [['m2', 'hover'], ['m4', 'hover-yours']]) {
      const at = await center(win, `#m-${id} .bubble`)
      await glide(win, { x: at.x - 60, y: at.y - 80 }, at, 200)
      await sleep(500)
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(out, `reactions-${name}-${theme}.png`), img.toPNG())
      console.log('saved', `reactions-${name}-${theme}.png`)
    }
    win.destroy()
  },
  // A reaction landing: on the message at the bottom while you follow the chat, on one above while you read further up
  // (nothing you're reading moves), then your own from the tools a message shows when you point at it.
  async reactionsGif() {
    const win = await dashboard(DARK ? 'dark' : 'light', 'chat', { width: 900, height: 600, fixture: 'threads' })
    await js(win, REACT_SETUP('acks'))
    // a longer history, so there's something to read further up
    await js(win, `const s = window.__cliqueState; s.feed = s.feed.filter((e) => !['xa1', 'xm1', 'xt1', 'y4', 'y6'].includes(e.id)); const t0 = s.feed[0].ts - 3600000
      const said = ['Checked the orders table migration.', 'Tests are green on CI.', 'Left a note on the empty cart task.', 'Nudged the product grid spacing a little.']
      s.feed.unshift(...Array.from({ length: 14 }, (_, i) => ({ id: 'old' + i, kind: 'reply', from: ['Ada', 'Milo', 'Iris', 'Theo'][i % 4], to: 'you', text: said[i % 4], ts: t0 + i * 60000 })))
      s.feed.push({ id: 'z0', kind: 'msg', from: 'you', to: 'Theo', text: 'Standup is at 10:30 from tomorrow.', ts: Date.now() }); window.__cliqueEmit('state', s)`)
    await sleep(1200)
    const col = await js(win, "const r = document.querySelector('.page-head[data-for=chat]').getBoundingClientRect(); return { x: Math.round(r.x), y: 0, width: Math.round(innerWidth - r.x), height: innerHeight }")
    const land = (id, by, emoji) => js(win, `const s = window.__cliqueState; const e = s.feed.find((x) => x.id === '${id}'); e.reactions = [...(e.reactions ?? []), { by: '${by}', emoji: '${emoji}', at: Date.now() }]; window.__cliqueEmit('state', s)`)
    await record(win, 'reactions', {
      clip: col, ms: 12500, width: 760,
      during: async () => {
        let at = { x: col.x + 420, y: 200 }
        // following the chat: Theo's 👍 lands on the newest message
        await sleep(900)
        await land('z0', 'Theo', '👍')
        await sleep(1500)
        // reading further up: three land on the message in view and one below it, and what you read stays where it is
        await js(win, "document.querySelector('#m-old11').scrollIntoView({ block: 'start', behavior: 'smooth' })")
        await sleep(1300)
        await land('xa', 'Ada', '👍')
        await sleep(700)
        await land('xm', 'Milo', '👍')
        await sleep(700)
        await land('xt', 'Theo', '👀')
        await sleep(700)
        await land('y7', 'Milo', '✅')
        await sleep(1300)
        // your own: point at a message and pick one
        at = await glide(win, at, await center(win, '#m-old13 .bubble'), 700)
        await sleep(400)
        at = await glide(win, at, await center(win, '#m-old13 .react-pick[data-react="🎉"]'), 500)
        await sleep(300)
        await tap(win, at)
        await sleep(1500)
        await glide(win, at, { x: at.x - 200, y: at.y + 120 }, 500)
      },
    })
    win.destroy()
  },
  // Canvases: boards agents draw by hand in the chat (ui/canvas.js, `clique canvas`): bars with a tick, a cross and a
  // source in a final message, then a flow two agents drew together.
  async canvas(theme) {
    const win = await dashboard(theme, 'chat', { fixture: 'big', width: 1180, height: 1280 })
    await js(win, `const s = window.__cliqueState; const t = (m) => Date.now() - m * 60000
      s.feed = ${JSON.stringify(CANVAS_FEED)}.map((e, i, all) => ({ ...e, ts: t(all.length - i) }))
      window.__cliqueEmit('state', s)`)
    await sleep(3200)
    await save(win, `canvas-${theme}`)
    win.destroy()
  },
  // Dragged to the notch: the band around it, then the chat hanging from it (it's black in both themes).
  async hatch(theme) {
    const win = await open('overlay.html', { theme, width: 900, height: 110, backdrop: 'desktop' })
    await win.webContents.insertCSS(SCREEN_TOP)
    await sleep(300)
    await js(win, "window.__cliqueEmit('place', { side: 'hatch', align: 'center', hatch: { width: 185, height: 32, real: true } })")
    await sleep(600)
    await save(win, `hatch-${theme}`)
    win.setContentSize(900, 680)
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(800)
    await save(win, `hatch-chat-${theme}`)
    win.destroy()
  },
  // The way in: a flat pill reaches the notch and becomes part of it, then the chat drops out of it.
  async 'hatch-dock'() {
    const win = await open('overlay.html', { theme: 'dark', width: 900, height: 680, backdrop: 'desktop' })
    await win.webContents.insertCSS(SCREEN_TOP)
    await js(win, "window.__cliqueEmit('place', { side: 'below', align: 'center' })")
    await sleep(500)
    await record(win, 'hatch-dock', {
      clip: { x: 0, y: 0, width: 900, height: 680 }, ms: 2600, width: 600,
      during: async () => {
        await sleep(500)
        await js(win, "window.__cliqueEmit('place', { side: 'hatch', align: 'center', hatch: { width: 185, height: 32, real: true } })")
        await sleep(900)
        await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
      },
    })
    win.destroy()
  },
  // What's missing, one at a time, out of the hatch: macOS hasn't asked, it's a switch now, and the one that's dragged.
  async permissions(theme) {
    for (const step of ['notifications:ask', 'microphone:ask', 'localNetwork:off', 'fullDisk:off']) {
      const win = await open('permissions.html', { theme, width: 900, height: 420, backdrop: 'desktop', fixture: step })
      await win.webContents.insertCSS(SCREEN_TOP)
      await sleep(700)
      await save(win, `permissions-${step.replace(':', '-')}-${theme}`)
      win.destroy()
    }
  },
  // The README's cover (scripts/cover.html): one picture, with see-through rounded corners.
  async cover(theme) {
    const win = await open('../scripts/cover.html', { theme, width: 1280, height: 600, transparent: true })
    await sleep(900)
    await save(win, `cover-${theme}`, { bare: true })
    win.destroy()
  },
  // The README's pictures (npm run readme): what a newcomer should see, each in a window small enough to read at the
  // width GitHub shows it, and on the stage with --frame. The phone's own captures (docs/images/src, taken in the
  // Simulator: mobile/README.md) stand in two of them when they're there.
  async readme(theme) {
    const shot = async (name, win, opts) => {
      await save(win, `readme-${name}-${theme}`, opts)
      win.destroy()
    }
    const phone = (name) => [path.join(root, '..', 'docs', 'images', 'src', `phone-${name}-${DARK ? 'dark' : theme}.webp`)].find((f) => fs.existsSync(f))
    // #general: a question and a permission prompt answered where they were asked, with the phone asking the same
    let win = await dashboard(theme, 'chat', { width: 1060, height: 690 })
    await sleep(1300)
    await shot('hero', win, { phone: phone('ask') })
    // Q, the agent in every workspace: what you send goes to him, and he gets it to whoever should do it
    win = await dashboard(theme, 'chat', { width: 1060, height: 560, fixture: 'q' })
    await sleep(1300)
    await shot('q', win)
    // The pictures shown two to a row are one column of a narrower window: at half the page's width a whole window
    // would be too small to read.
    const column = (win) => js(win, "const r = document.querySelector('.page-head[data-for=chat]').getBoundingClientRect(); return { x: Math.round(r.x), y: 0, width: Math.round(innerWidth - r.x), height: innerHeight }")
    // threads: what agents say to each other stays a few rows in the channel
    win = await dashboard(theme, 'chat', { width: 800, height: 600, fixture: 'threads' })
    await sleep(1300)
    await shot('threads', win, { crop: await column(win) })
    // a canvas: an agent draws its answer, and a teammate adds to it
    win = await dashboard(theme, 'chat', { width: 800, height: 600 })
    await js(win, `const s = window.__cliqueState; const t = (m) => Date.now() - m * 60000
      s.feed = ${JSON.stringify(CANVAS_FEED)}.map((e, i, all) => ({ ...e, ts: t(all.length - i) }))
      for (const a of s.agents) Object.assign(a, { status: a.on === false ? a.status : 'idle', activity: '', pending: false, subs: [] })
      window.__cliqueEmit('state', s)`)
    await sleep(3200)
    await shot('canvas', win, { crop: await column(win) })
    // Usage, everything: tokens a week by workspace with the workspaces ranked beside it, and a calendar per provider
    win = await dashboard(theme, 'usage', { width: 1160, height: 950, reset: ['clique.usage.range', 'clique.usage.scope', 'clique.usage.by.here', 'clique.usage.by.all'] })
    await js(win, click('.us-scope [data-scope=all]'))
    await sleep(900)
    await shot('usage', win)
    // every terminal side by side
    win = await dashboard(theme, 'grid', { width: 1160, height: 700 })
    await sleep(1600)
    await shot('terminals', win)
    // Computers: linked, nearby, and the phones
    win = await dashboard(theme, 'clique', { width: 1060, height: 780, fixture: 'big' })
    await sleep(900)
    await js(win, 'openComputers()')
    await sleep(900)
    // the sheet itself, with a little of the app around it
    await shot('computers', win, { crop: await js(win, "const r = document.querySelector('#link').getBoundingClientRect(); const m = 22; return { x: Math.round(r.x - m), y: Math.round(Math.max(0, r.y - m)), width: Math.round(r.width + 2 * m), height: Math.round(Math.min(innerHeight, r.bottom + m) - Math.max(0, r.y - m)) }") })
    // workspaces: the rail (one needs you, one on screen, one asleep, two from other computers) and the workspace's menu
    win = await dashboard(theme, 'chat', { width: 1060, height: 620, fixture: 'workspaces' })
    await sleep(1000)
    await js(win, click('.ws-switch'))
    await sleep(600)
    await shot('workspaces', win, { crop: { x: 0, y: 0, width: 620, height: 440 } })
    // the pill and the chat that opens from it
    win = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await shot('floating', win)
    // the same chat hanging from the notch
    win = await open('overlay.html', { theme, width: 560, height: 660, backdrop: 'desktop' })
    await win.webContents.insertCSS(SCREEN_TOP)
    // on the stage the menu bar is only a hint of where the screen's top is
    await win.webContents.insertCSS('html::before { background: rgba(0, 0, 0, .05) !important; } @media (prefers-color-scheme: dark) { html::before { background: rgba(255, 255, 255, .07) !important; } }')
    await sleep(300)
    await js(win, "window.__cliqueEmit('place', { side: 'hatch', align: 'center', hatch: { width: 185, height: 32, real: true } })")
    await sleep(600)
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(900)
    await shot('hatch', win)
    // the phone app: who needs you, and the chat (only on the stage, and only with its captures at hand)
    if (FRAME && phone('ask') && phone('chat')) {
      const { image } = await stage([['kind', 'phones'], ['h', 640], ['w', 880], ['phone', fileURL(phone('ask'))], ['phone', fileURL(phone('chat'))]])
      fs.writeFileSync(path.join(out, `readme-phone-${theme}.png`), image.toPNG())
      console.log('saved', `readme-phone-${theme}.png`)
    }
  },
  async tray(theme) {
    const win = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover' })
    await sleep(500)
    await fitToContent(win)
    await save(win, `tray-${theme}`)
    win.destroy()
  },
  // Staying awake while agents work (core/awake.js): the tray's line, its switch under the gear, the tray once it's
  // off, and the same switch in the dashboard's menu.
  async awake(theme) {
    const win = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover' })
    await sleep(500)
    await fitToContent(win)
    await save(win, `awake-tray-${theme}`)
    await js(win, click('[data-act=settings]'))
    await sleep(350)
    await save(win, `awake-tray-settings-${theme}`)
    await js(win, click('.menu [data-menu-act=awake]'))
    await sleep(400)
    await fitToContent(win)
    await save(win, `awake-tray-off-${theme}`)
    win.destroy()
    const dash = await dashboard(theme, 'chat', { width: 1060, height: 690 })
    await js(dash, click('.side-more'))
    await sleep(350)
    const box = await js(dash, "const r = document.querySelector('.menu').getBoundingClientRect(); return { x: 0, y: Math.max(0, Math.round(r.top) - 40), width: 560, height: Math.round(innerHeight - Math.max(0, Math.round(r.top) - 40)) }")
    await save(dash, `awake-menu-${theme}`, { crop: box })
    dash.destroy()
  },
  async overlay(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await save(win, `chat-${theme}`)
    await js(win, "window.__cliqueEmit('toggle', { open: false })")
    await sleep(500)
    await fitToContent(win)
    await save(win, `pill-${theme}`)
    win.destroy()
  },
  // Under the mouse (core/follow.js, main.js ?at=mouse): the wisp by the pointer, then what the hotkeys open where the
  // pointer is: the message box (its To menu, listening, typing taking over, its @names list, below the pointer and above
  // it) and the chat. The window is the size main.js would make it, so what fits here fits there. Checked as it goes: a
  // broken step stops the shot.
  async follow(theme) {
    const errors = []
    const check = (what, ok, got) => {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(got)}`}`)
      if (!ok) errors.push(what)
    }
    const win = await underMouse(theme, { width: 150, height: 90, still: true })
    win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(`console: ${e.message}`))
    // what the wisp shows: how lit its glow is, whether anything on it loops, its dot, its tail
    const wisp = () => js(win, `const p = document.querySelector('.pill'), o = (sel) => Number(getComputedStyle(p.querySelector(sel)).opacity)
      return { glow: o('.wisp-aura'), need: o('.wisp-need'), tail: o('.wisp-tail'), dot: Boolean(p.querySelector('.wisp-dot')), size: [p.offsetWidth, p.offsetHeight],
        loops: document.getAnimations().filter((a) => a.effect?.getTiming().iterations === Infinity && p.contains(a.effect.target)).length, hop: getComputedStyle(p.querySelector('.home')).animationName, ring: getComputedStyle(p.querySelector('.wisp-ring')).animationName }`)
    // the window's corner on the picture, and the pointer where the follower would have it (core/follow.js BESIDE, NEAR)
    const at = (x, y, open) => js(win, `document.documentElement.style.cssText = '--wx: ${x}px; --wy: ${y}px; --px: ${x + (open ? 4 : 17)}px; --py: ${y + (open ? 4 : 14)}px'`)
    const page = () => js(win, `const b = document.body, q = (s) => document.querySelector(s), r = (el) => { const x = el?.getBoundingClientRect(); return x && { top: Math.round(x.top), bottom: Math.round(x.bottom), left: Math.round(x.left), right: Math.round(x.right), height: Math.round(x.height) } }
      return { open: b.classList.contains('open'), quick: b.classList.contains('quick'), sent: b.classList.contains('sent'), fit: window.__cliqueFit, looking: window.__cliqueLooking, text: q('.compose textarea').value,
        voice: q('.compose').classList.contains('voice-on'), send: q('.compose .send').dataset.mode, panel: r(q('.panel')), input: r(q('.compose .input')), menu: r(q('.menu:not(.leaving)')), names: r(q('.mentions:not(.hidden)')), h: innerHeight }`)
    const emit = (channel, arg) => js(win, `window.__cliqueEmit(${JSON.stringify(channel)}, ${JSON.stringify(arg)})`)
    const key = async (keyCode) => {
      for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode })
      await sleep(80)
    }
    const type = async (text) => {
      for (const ch of text) {
        for (const kind of ['keyDown', 'char', 'keyUp']) win.webContents.sendInputEvent({ type: kind, keyCode: ch })
        await sleep(40)
      }
    }
    // opens it as main.js would, in a window the size it asks for
    const show = async (opts) => {
      await emit('toggle', { open: true, focus: false, ...opts })
      await sleep(450)
      await at(0, 0, true)
      await fitToContent(win)
      await js(win, "document.querySelector('.compose textarea').focus()")
      return page()
    }

    // ---- the buddy
    await emit('place', { side: 'mouse', align: 'start' })
    await at(30, 14, false)
    // nothing going on first: nobody at work, nobody waiting, nothing to read (the demo clique has all three)
    await js(win, `const s = window.__cliqueState; window.__was = s.agents.map((a) => a.status); window.__reads = s.reads
      for (const a of s.agents) if (a.status === 'working' || a.status === 'waiting') a.status = 'idle'
      s.reads = { ...s.reads, since: Date.now() }; window.__cliqueEmit('state', s)`)
    await sleep(900)
    let p = await page()
    let w = await wisp()
    check('closed, it says so and is one tiny buddy, no bigger than the pointer', p.fit?.pill.open === false && String(w.size) === '14,12' && await js(win, "return getComputedStyle(document.querySelector('.dots')).display === 'none' && !document.querySelector('.dots').children.length && getComputedStyle(document.querySelector('.pill')).backgroundColor === 'rgba(0, 0, 0, 0)'"), [p.fit, w])
    check('with nothing going on its glow is faint, and it has no dot', w.glow < 0.35 && w.need === 0 && !w.dot && !w.loops, w)
    await save(win, `follow-buddy-idle-${theme}`)
    // agents at work: the glow is lit, and nothing loops
    await js(win, "const s = window.__cliqueState; s.agents.forEach((a, i) => { if (window.__was[i] === 'working') a.status = 'working' }); window.__cliqueEmit('state', s)")
    await sleep(900)
    w = await wisp()
    check('agents at work light its glow, and nothing by the pointer loops', w.glow > 0.7 && w.need === 0 && !w.loops && w.tail === 0, w)
    await save(win, `follow-buddy-${theme}`)
    // carried along (up and to the left here): a tail behind it, which goes when it stops
    await js(win, "window.__cliqueEmit('trail', 215, 1)")
    await sleep(400)
    w = await wisp()
    check('carried along, it trails a tail', w.tail > 0.8, w)
    await save(win, `follow-buddy-moving-${theme}`)
    await js(win, "window.__cliqueEmit('trail', 215, 0)")
    await sleep(400)
    check('...which goes when it stops', (await wisp()).tail === 0)
    // a reply comes in: a dot, and one ring
    await js(win, "const s = window.__cliqueState; s.reads = window.__reads; window.__cliqueEmit('state', s)")
    await sleep(120)
    w = await wisp()
    check('a reply coming in rings once and leaves a dot', w.dot && w.ring === 'wisp-ping', w)
    await sleep(900)
    await save(win, `follow-buddy-reply-${theme}`)
    // someone needs you: the glow turns berry and holds still
    await js(win, "const s = window.__cliqueState; s.agents.forEach((a, i) => (a.status = window.__was[i])); window.__cliqueEmit('state', s)")
    await sleep(900)
    w = await wisp()
    check('someone needs you: its glow turns berry and holds still', await js(win, "return document.body.classList.contains('alert')") && w.need > 0.9 && w.glow === 0 && w.dot && !w.loops, w)
    await save(win, `follow-buddy-needs-${theme}`)

    // ---- the message box
    p = await show({ quick: true, align: 'start' })
    check('the message box is the composer and nothing else', p.quick && p.fit.pill.open === 'quick' && p.panel.height < 110 && await js(win, "return ['header', '.feed', '.attach'].every((s) => getComputedStyle(document.querySelector(`.panel ${s}`)).display === 'none')"), p.panel)
    check('room is kept under it for its lists', p.fit.height - (p.fit.pill.y + p.fit.pill.height) >= 300, p.fit)
    check("it shows no chat, so what comes in still notifies", p.looking === null, p.looking)
    check('its send button is never Stop', p.send === 'send', p.send)
    await save(win, `follow-message-${theme}`)
    await js(win, click('.compose [data-pick-to]'))
    await sleep(400)
    p = await page()
    check('its To menu fits in the window', p.menu && p.menu.top >= 0 && p.menu.bottom <= p.h, [p.menu, p.h])
    await save(win, `follow-message-to-${theme}`)
    await key('Escape')
    await sleep(250)
    p = await page()
    check('Esc closes the menu, not the box', !p.menu && p.open, p)

    // ---- listening, as the hotkey opens it; then typing takes over
    await emit('voice', { type: 'toggle' })
    await sleep(2500)
    p = await page()
    check('it listens, and says so in the bar where it can be seen', p.voice && await js(win, "const h = document.querySelector('.voice-hint'), r = h.getBoundingClientRect(), bar = document.querySelector('.input-bar').getBoundingClientRect(); const top = document.elementFromPoint(r.left + 40, r.top + r.height / 2); return h.contains(top) && r.top >= bar.top && r.bottom <= bar.bottom && /Listening/.test(h.textContent) && /send/.test(h.textContent)"))
    await save(win, `follow-message-listening-${theme}`)
    const heard = p.text
    await type(' on @')
    await sleep(450)
    p = await page()
    // (a word may still land between reading the box and the first key; after the key, nothing more does)
    check('typing takes over: it stops listening, keeps what it heard, and the keys land', !p.voice && heard.length > 5 && p.text.startsWith(heard) && p.text.endsWith(' on @') && (await sleep(600), (await page()).text === p.text), [heard, p.text, p.voice])
    check('its @names list opens under it, inside the window', p.names && p.names.top >= p.input.bottom && p.names.bottom <= p.h, [p.names, p.input, p.h])
    await save(win, `follow-message-names-${theme}`)
    await key('Escape')
    await sleep(200)
    p = await page()
    check('Esc closes the list, not the box', !p.names && p.open, p)

    // ---- sent: the box goes, and the buddies hop as they take it
    await js(win, "const ta = document.querySelector('.compose textarea'); ta.value = 'Can someone look at why the build is failing?'; ta.dispatchEvent(new Event('input', { bubbles: true }))")
    await key('Enter')
    await sleep(300)
    p = await page()
    check('sending puts the box away and the buddies take it', !p.open && p.sent && p.fit.pill.open === false && p.text === '' && await js(win, "return window.__cliqueState.feed.at(-1).text === 'Can someone look at why the build is failing?'"), p)
    w = await wisp()
    check('...with a hop and a few motes, even while agents work', await js(win, "return document.body.classList.contains('busy') && document.querySelectorAll('.wisp-motes i').length === 5") && w.hop === 'wisp-took', w)
    await sleep(1000)
    w = await wisp()
    check('...once: then nothing moves again', await js(win, "return !document.body.classList.contains('sent') && !document.querySelector('.wisp-motes')") && w.hop === 'none' && !w.loops, w)
    // the dictation hotkey reaching a page with nothing open (it closed a moment ago): the box opens, it never listens unseen
    await emit('voice', { type: 'toggle' })
    await sleep(500)
    p = await page()
    check('dictation never starts with nothing open: the box opens for it', p.open && p.quick && p.voice && p.fit.pill.open === 'quick', p)
    await key('Escape')
    await sleep(500)
    await key('Escape')
    await sleep(250)

    // ---- put away by a click beside it, or the keyboard going elsewhere; not while it listens
    p = await show({ quick: true, align: 'start' })
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 200, y: p.h - 30, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 200, y: p.h - 30, button: 'left', clickCount: 1 })
    await sleep(200)
    check('a click beside it puts it away', !(await page()).open)
    await show({ quick: true, align: 'start' })
    await js(win, "window.dispatchEvent(new Event('blur'))")
    await sleep(200)
    check('so does the keyboard going to another app', !(await page()).open)
    await show({ quick: true, align: 'start' })
    await emit('voice', { type: 'toggle' })
    await sleep(500)
    await js(win, "window.dispatchEvent(new Event('blur'))")
    await sleep(200)
    p = await page()
    check('while it listens it stays', p.open && p.voice, p)
    await emit('voice', { type: 'toggle' }) // the hotkey again, from the other app: it stops listening
    await sleep(700)
    p = await page()
    check('...and once it stops with the keyboard still elsewhere, it is put away', !p.open && !p.voice, p)
    await show({ quick: true, align: 'start' })
    await emit('voice', { type: 'toggle' })
    await sleep(500)
    await key('Escape')
    await sleep(500)
    p = await page()
    check('Esc stops the listening and the box stays, for you to send or change', p.open && !p.voice, p)
    await key('Escape')
    await sleep(250)
    check('...the next Esc closes it', !(await page()).open)

    // ---- low on the screen it stands above the pointer: the room, and its lists, are above it
    await js(win, "const ta = document.querySelector('.compose textarea'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }))")
    p = await show({ quick: true, align: 'end' })
    check('above the pointer, the room for its lists is above it', p.fit.pill.y >= 300, p.fit)
    await type('@')
    await sleep(450)
    p = await page()
    check('...and its @names list opens above it', p.names && p.names.bottom <= p.input.top && p.names.top >= 0, [p.names, p.input])
    // it grows as you write: main.js hears each new size, or it would grow out of its window down here
    await key('Escape')
    const before = (await page()).fit
    await js(win, "const ta = document.querySelector('.compose textarea'); ta.value = 'one\\ntwo\\nthree\\nfour'; ta.dispatchEvent(new Event('input', { bubbles: true }))")
    await sleep(300)
    p = await page()
    check('it says so when it grows', p.fit.height > before.height && p.fit.pill.height > before.pill.height && p.fit.pill.y + p.fit.pill.height + 14 === p.fit.height, [before, p.fit])
    // (back to one line, in a window that size again, with its list up for the picture)
    await js(win, "const ta = document.querySelector('.compose textarea'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }))")
    await sleep(300)
    await fitToContent(win)
    await js(win, "document.querySelector('.compose textarea').focus()")
    await type('@')
    await sleep(450)
    await js(win, "document.documentElement.style.setProperty('--py', `${document.querySelector('.panel').getBoundingClientRect().bottom + 4}px`)")
    await save(win, `follow-message-above-${theme}`)
    await key('Escape')
    await key('Escape')
    await sleep(250)
    await js(win, "const ta = document.querySelector('.compose textarea'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }))")

    // ---- the chat, where the pointer is
    p = await show({ align: 'start' })
    check('the chat opens whole', p.open && !p.quick && p.fit.pill.open === 'chat' && p.panel.height === 600 && p.looking !== null, [p.fit, p.panel, p.looking])
    await save(win, `follow-chat-${theme}`)
    // the message box becomes the chat, and back, without closing
    p = await show({ quick: true, align: 'start' })
    check('the chat becomes the message box in place', p.open && p.quick && p.fit.pill.open === 'quick', p.fit)
    await key('Escape')
    await sleep(250)
    check('Esc closes it', !(await page()).open)
    win.destroy()

    // ---- the setting: the dashboard's menu and the menu bar popover's gear
    const dash = await dashboard(theme, 'chat', { width: 1060, height: 690 })
    await js(dash, click('.side-more'))
    await sleep(350)
    check('the dashboard’s menu has the choice, on Sticky', await js(dash, "const rows = [...document.querySelectorAll('.menu [data-menu-act^=\"chat:\"]')]; return rows.length === 2 && /✓/.test(rows[0].textContent) && !/✓/.test(rows[1].textContent)"))
    const box = await js(dash, "const r = document.querySelector('.menu').getBoundingClientRect(); return { x: 0, y: Math.max(0, Math.round(r.top) - 20), width: 520, height: Math.round(innerHeight - Math.max(0, Math.round(r.top) - 20)) }")
    await save(dash, `follow-setting-${theme}`, { crop: box })
    await js(dash, click('.menu [data-menu-act="chat:mouse"]'))
    await sleep(500)
    check('picking Under the mouse switches it and says which keys reach it', await js(dash, "return window.__cliqueState.app.chat.at === 'mouse' && /follows the pointer now/.test(document.querySelector('.toast')?.textContent ?? '') && /to talk or type a message/.test(document.querySelector('.toast').textContent)"), await js(dash, "return document.querySelector('.toast')?.textContent"))
    await save(dash, `follow-setting-on-${theme}`, { crop: { x: 0, y: 690 - 200, width: 1060, height: 200 } })
    await js(dash, click('.side-more'))
    await sleep(350)
    check('...and the menu ticks it', await js(dash, "return /✓/.test(document.querySelector('.menu [data-menu-act=\"chat:mouse\"]').textContent) && !/✓/.test(document.querySelector('.menu [data-menu-act=\"chat:sticky\"]').textContent)"))
    dash.destroy()
    const tray = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover' })
    await sleep(500)
    await fitToContent(tray)
    await js(tray, click('[data-act=settings]'))
    await sleep(350)
    check('the menu bar popover’s gear has it too', await js(tray, "return document.querySelectorAll('.menu [data-menu-act^=\"chat:\"]').length === 2"))
    await save(tray, `follow-setting-tray-${theme}`)
    tray.destroy()
    if (errors.length) throw new Error(`follow: ${errors.join('; ')}`)
  },
  // Under the mouse, moving: the real follower (core/follow.js) with a made-up pointer on a made-up screen, its window
  // drawn where the follower puts it. The wisp trails the pointer; the dictation hotkey opens the message box there,
  // listening, and Enter sends it; then someone needs you (its glow turns berry, with one ring), the chat hotkey opens
  // the chat there, and Esc puts it away.
  async followGif() {
    const [W, H] = [900, 700]
    const win = await underMouse('light', { width: W, height: H })
    await win.webContents.insertCSS(`#keys { position: fixed; right: 28px; bottom: 26px; z-index: 998; display: flex; gap: 8px; align-items: center; padding: 7px 12px; border-radius: 12px; background: color-mix(in srgb, var(--fg) 86%, transparent); color: var(--bg); font: 600 14px var(--ui); opacity: 0; transition: opacity .2s; }
      #keys.on { opacity: 1; } #keys kbd { font: 600 13px var(--ui); padding: 2px 7px; border-radius: 6px; background: color-mix(in srgb, var(--bg) 22%, transparent); }`)
    await js(win, "document.body.insertAdjacentHTML('beforeend', '<div id=\"keys\"></div>')")
    const area = { x: 0, y: 0, width: W, height: H }
    let pointer = { x: 150, y: 520 }
    let bounds = { x: 0, y: 0, width: 74, height: 72 }
    const told = [] // what the follower tells the page (its tail), sent on with the next frame
    const overlay = { getBounds: () => ({ ...bounds }), setBounds: (b) => (bounds = { ...b }), getPosition: () => [bounds.x, bounds.y], setPosition: (x, y) => (bounds = { ...bounds, x, y }), isVisible: () => true, isFocused: () => false,
      webContents: { send: (channel, ...args) => told.push([channel, ...args]) } }
    const follower = followWindow(overlay, { getCursorScreenPoint: () => ({ ...pointer }), getDisplayNearestPoint: () => ({ bounds: area, workArea: area }) })
    let seen = ''
    // a frame: the follower looks at the pointer, the page is put where it says, and what the page asks for goes back to it
    const frame = async () => {
      follower.look()
      const fit = await js(win, `for (const m of ${JSON.stringify(told.splice(0))}) window.__cliqueEmit(...m)
        document.documentElement.style.cssText = '--wx: ${bounds.x}px; --wy: ${bounds.y}px; --px: ${pointer.x}px; --py: ${pointer.y}px'; return JSON.stringify(window.__cliqueFit)`)
      if (!fit || fit === seen) return
      seen = fit
      const { width, height, pill } = JSON.parse(fit)
      follower.fit(width, height, pill)
    }
    const run = async (ms, move) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        move?.(Math.min(1, (Date.now() - t0) / ms))
        await frame()
        await sleep(6)
      }
    }
    // the pointer goes somewhere the way a hand moves it: off slowly, there slowly, along a slight arc
    const go = (to, ms, bow = 40) => {
      const from = { ...pointer }
      return run(ms, (t) => {
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
        pointer = { x: Math.round(from.x + (to.x - from.x) * e), y: Math.round(from.y + (to.y - from.y) * e - Math.sin(e * Math.PI) * bow) }
      })
    }
    const keys = (html) => js(win, `const k = document.querySelector('#keys'); ${html ? `k.innerHTML = ${JSON.stringify(html)}; k.classList.add('on')` : "k.classList.remove('on')"}`)
    const emit = (channel, arg) => js(win, `window.__cliqueEmit(${JSON.stringify(channel)}, ${JSON.stringify(arg)})`)
    await emit('place', { side: 'mouse', align: 'start' })
    // agents at work and nobody waiting, to begin with (the demo clique has two who are)
    await js(win, "const s = window.__cliqueState; window.__was = s.agents.map((a) => a.status); for (const a of s.agents) if (a.status === 'waiting') a.status = 'working'; s.reads = { ...s.reads, since: Date.now() }; window.__cliqueEmit('state', s)")
    await run(900)
    await record(win, 'follow', {
      ms: 13700, width: 720,
      during: async () => {
        await run(300)
        await go({ x: 560, y: 430 }, 900)
        await go({ x: 300, y: 150 }, 1000, -50)
        await run(350)
        // the dictation hotkey: the message box, listening
        await keys('<kbd>⌥</kbd><kbd>⇧</kbd><kbd>D</kbd> talk or type')
        await emit('toggle', { open: true, focus: false, quick: true, align: follower.open('quick') })
        await emit('voice', { type: 'toggle' })
        await run(2900)
        await keys('<kbd>⏎</kbd> send')
        await js(win, "document.querySelector('.compose textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))")
        await run(1300)
        await keys('')
        await go({ x: 200, y: 60 }, 900, 30)
        // someone needs you: its glow turns berry, with one ring
        await js(win, "const s = window.__cliqueState; s.agents.forEach((a, i) => (a.status = window.__was[i])); window.__cliqueEmit('state', s)")
        await run(1300)
        // the chat hotkey: the chat, right there
        await keys('<kbd>⌥</kbd><kbd>⇧</kbd><kbd>Space</kbd> the chat')
        await emit('toggle', { open: true, focus: false, align: follower.open('chat') })
        await run(2300)
        await keys('<kbd>esc</kbd>')
        await emit('toggle', { open: false })
        follower.close()
        await run(700)
        await keys('')
        await go({ x: 640, y: 520 }, 1000, 60)
        await run(400)
      },
    })
    win.destroy()
  },
  // Stop (ui/common.js stoppableIn and stopButton, core/hub.js stopTurns): every place it shows, at work and free.
  // The message box with nothing written while Theo works (Stop), with something written (Send), and with Theo free;
  // the line of an agent at work under the pointer; the chat after a stop, with what waited marked not delivered; the
  // agent's menu, its card, its row in the sidebar, its terminal and the menu bar.
  async stop(theme) {
    const win = await dashboard(theme, 'chat', { width: 1100, height: 700 })
    const box = (sel, pad = [12, 12, 12, 12]) => js(win, `const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); const [t, rt, b, l] = ${JSON.stringify(pad)}
      const x = Math.max(0, Math.round(r.x - l)), y = Math.max(0, Math.round(r.y - t)); return { x, y, width: Math.min(innerWidth - x, Math.round(r.width + l + rt)), height: Math.min(innerHeight - y, Math.round(r.height + t + b)) }`)
    const hover = async (sel) => {
      const at = await center(win, sel)
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(at.x) - 3, y: Math.round(at.y) })
      await sleep(30)
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(at.x), y: Math.round(at.y) })
      await sleep(350)
    }
    const away = async () => (win.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 8 }), sleep(300))
    const write = (text) => js(win, `const ta = document.querySelector('.compose textarea'); ta.value = ${JSON.stringify(text)}; ta.dispatchEvent(new Event('input', { bubbles: true }))`)
    // your conversation with Theo, who's running the tests
    await js(win, "openDM('Theo')")
    await sleep(1000)
    // the message box with the line of who's at work over it
    const both = () => js(win, `const a = document.querySelector('.typing-list').getBoundingClientRect(), b = document.querySelector('.compose').getBoundingClientRect()
      const top = Math.max(0, Math.round((a.height ? a.y : b.y) - 14)); const x = Math.max(0, Math.round(b.x - 16)); return { x, y: top, width: Math.min(innerWidth - x, Math.round(b.width + 32)), height: Math.min(innerHeight, Math.round(b.bottom + 12)) - top }`)
    await js(win, `const s = window.__cliqueState; s.feed = s.feed.filter((e) => e.kind !== 'msg' || !e.held); window.__cliqueEmit('state', s)`)
    await sleep(500)
    const bottom = await both()
    await save(win, `stop-composer-working-${theme}`, { crop: bottom })
    await write('Then run them on Safari too')
    await sleep(300)
    await save(win, `stop-composer-typing-${theme}`, { crop: bottom })
    await write('')
    // the line of an agent at work, under the pointer: its dots make way for Stop
    await hover('.typing-row .tr-name')
    await save(win, `stop-line-${theme}`, { crop: bottom })
    await hover('.typing-row .tr-end')
    await save(win, `stop-line-hover-${theme}`, { crop: bottom })
    await away()
    // two messages wait for Theo; Stop, pressed in the message box
    await js(win, `const s = window.__cliqueState; const t = Date.now()
      s.feed.push({ id: 'sq1', kind: 'msg', from: 'you', to: 'Theo', text: 'Then run them on Safari too', ts: t - 40000, queued: true }, { id: 'sq2', kind: 'msg', from: 'Iris', to: 'Theo', text: 'The empty cart has a new layout: its snapshot test needs a new baseline.', ts: t - 20000, queued: true })
      s.agents.find((a) => a.name === 'Theo').queue = 2
      window.__cliqueEmit('state', s)`)
    await sleep(700)
    await save(win, `stop-before-${theme}`)
    await js(win, click('.compose .send.stop'))
    await sleep(900)
    await save(win, `stop-after-${theme}`)
    await save(win, `stop-composer-idle-${theme}`, { crop: await both() })
    // #general: Ada and Theo's clones at work, Milo and Iris waiting on you mid-turn
    await js(win, "goPlace('chat')")
    await sleep(900)
    await js(win, 'feed.toLatest()')
    await sleep(600)
    await save(win, `stop-channel-${theme}`, { crop: await both() })
    // an agent's menu: Stop, only while it's in a turn
    const row = await center(win, '.dm[data-agent="Ada"]')
    await js(win, `document.querySelector('.dm[data-agent="Ada"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: ${Math.round(row.x)}, clientY: ${Math.round(row.y)} }))`)
    await sleep(500)
    await js(win, `document.querySelector('[data-menu-act="stop"]')?.closest('.menu').setAttribute('id', 'stop-menu')`)
    await save(win, `stop-menu-${theme}`, { crop: await box('#stop-menu', [50, 40, 16, 190]) })
    await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    await sleep(300)
    // Agents: a card says how its agent is, with Stop beside it while it's in a turn
    await js(win, "goPlace('clique')")
    await sleep(400)
    await js(win, click('[data-mode=cards]'))
    await sleep(1200)
    await save(win, `stop-cards-${theme}`)
    await js(win, click('[data-mode=tiles]') + ';' + click('[data-mode=compact]'))
    await sleep(900)
    // Terminals: Stop with a terminal's other actions
    await js(win, "goPlace('terminals')")
    await sleep(1500)
    if (await js(win, "return Boolean(document.querySelector('.tile[data-name=\"Ada\"]'))")) {
      await hover('.tile[data-name="Ada"] .tile-head')
      await save(win, `stop-terminal-${theme}`, { crop: await box('.tile[data-name="Ada"]', [4, 4, 4, 4]) })
    }
    win.destroy()
    // the menu bar: Stop on the row of an agent at work, under the pointer
    const tray = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover' })
    await sleep(500)
    await fitToContent(tray)
    const at = await center(tray, '.work .t-row .t-who')
    tray.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(at.x) - 3, y: Math.round(at.y) })
    tray.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(at.x), y: Math.round(at.y) })
    await sleep(400)
    await save(tray, `stop-tray-${theme}`)
    tray.destroy()
    // the floating chat: the same message box, and the same line
    const chat = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(chat, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(chat)
    await save(chat, `stop-floating-${theme}`)
    chat.destroy()
  },
  // The message box's button changing as you write, then a stop: Theo is running the tests; with something written the
  // button sends, with nothing written it stops; pressed, Theo is free at once and the chat says so in one line.
  async stopGif() {
    const win = await dashboard(DARK ? 'dark' : 'light', 'chat', { width: 1100, height: 700 })
    await js(win, "openDM('Theo')")
    await sleep(1000)
    await js(win, `const s = window.__cliqueState
      s.feed.push({ id: 'sq2', kind: 'msg', from: 'Iris', to: 'Theo', text: 'The empty cart has a new layout: its snapshot test needs a new baseline.', ts: Date.now() - 20000, queued: true })
      s.agents.find((a) => a.name === 'Theo').queue = 1
      window.__cliqueEmit('state', s)`)
    await sleep(600)
    const clip = await js(win, "const r = document.querySelector('.chat').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + 150), width: Math.round(r.width), height: Math.round(r.height - 150) }")
    const typeOut = async (text) => {
      for (const ch of text) {
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch })
        await sleep(45)
      }
    }
    const key = async (keyCode, n = 1) => {
      for (let i = 0; i < n; i++) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
        await sleep(35)
      }
    }
    await record(win, 'stop', {
      clip, ms: 9500, width: 820,
      during: async () => {
        let at = { x: clip.x + 200, y: clip.y + 120 }
        await sleep(900)
        at = await glide(win, at, await center(win, '.compose textarea'), 500)
        await tap(win, at)
        await sleep(400)
        await typeOut('Safari too')
        await sleep(1100)
        await key('Backspace', 10)
        await sleep(900)
        at = await glide(win, at, await center(win, '.compose .send'), 600)
        await sleep(700)
        await tap(win, at)
        await sleep(3200)
      },
    })
    win.destroy()
  },
  // #general: everyone's messages, questions answered where they were asked
  async channel(theme) {
    const win = await dashboard(theme, 'chat')
    await sleep(1200)
    await save(win, `channel-${theme}`)
    win.destroy()
  },
  // What CLIque itself says in the chat: agents stopping, your accounts' limits, a clique waking up, a new conversation
  // in the window, and in the floating chat
  async events(theme) {
    const win = await dashboard(theme, 'chat', { width: 1100, height: 760 })
    await sleep(600)
    await js(win, EVENTS_FEED)
    await sleep(900)
    await save(win, `events-${theme}`)
    win.destroy()
    const chat = await open('overlay.html', { theme, width: 520, height: 820, backdrop: 'desktop' })
    await sleep(400)
    await js(chat, EVENTS_FEED.replace("s.feed = [", "s.agents = s.agents.map((a) => ({ ...a, status: 'idle', activity: '', subs: [] })); s.feed = ["))
    await js(chat, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(900)
    await fitToContent(chat)
    await save(chat, `events-chat-${theme}`)
    chat.destroy()
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
    const win = await dashboard(theme, 'clique')
    await js(win, click('[data-mode=cards]'))
    await sleep(1200)
    await save(win, `cards-${theme}`)
    win.destroy()
  },
  async stats(theme) {
    const win = await dashboard(theme, 'clique')
    await js(win, click('[data-mode=stats]'))
    await sleep(1000)
    await save(win, `stats-${theme}`)
    await js(win, click('[data-mode=cards]'))
    win.destroy()
  },
  // Usage (ui/usage.js): the workspace on screen (its agents, on both computers), then everything (each workspace and
  // what ran outside CLIque); the chart split another way, one computer alone, narrowed to an agent, a short range, a day
  // picked, one year; the first look at the logs, nothing yet, the way in from the sidebar, and a narrow window.
  async usage(theme) {
    const RESET = ['clique.usage.range', 'clique.usage.scope', 'clique.usage.by.here', 'clique.usage.by.all']
    const win = await dashboard(theme, 'usage', { height: 1010, reset: RESET })
    await sleep(700)
    await save(win, `usage-${theme}`)
    await js(win, click('.us-scope [data-scope=all]'))
    await sleep(500)
    await save(win, `usage-everything-${theme}`)
    await js(win, click('.us-by [data-by=who]'))
    await sleep(400)
    await save(win, `usage-everything-agents-${theme}`)
    await js(win, click('.us-by [data-by=computer]'))
    await sleep(400)
    await save(win, `usage-everything-computers-${theme}`)
    await js(win, click('.us-by [data-by=ws]'))
    // one computer alone
    await js(win, click(`.us-comp [data-computer=${LINK.slug}]`))
    await sleep(400)
    await save(win, `usage-one-computer-${theme}`)
    await js(win, click('.us-comp [data-computer=""]'))
    // narrowed to one workspace by a click on its row, then to one agent from the menu
    await js(win, click('.us-legend-list .us-row[data-f=ws]:nth-child(2)'))
    await sleep(400)
    await save(win, `usage-filtered-${theme}`)
    await js(win, click('.us-filters [data-menu=who]'))
    await sleep(350)
    await save(win, `usage-filter-menu-${theme}`)
    await js(win, `document.querySelector('.menu [data-menu-act]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await js(win, click('.us-filters [data-clear=all]'))
    // the last 30 days: a bar a day, the calendars' older days dimmed
    await js(win, click('.us-scope [data-scope=here]'))
    await js(win, click('.page-head[data-for=usage] [data-us=range]'))
    await sleep(300)
    await save(win, `usage-range-${theme}`)
    await js(win, `document.querySelector('.menu [data-menu-act="d30"]').click()`)
    await sleep(500)
    await save(win, `usage-30-days-${theme}`)
    await js(win, click('.page-head[data-for=usage] [data-us=range]'))
    await js(win, `document.querySelector('.menu [data-menu-act="last"]').click()`)
    // a busy weekday three weeks back, in whichever column it falls
    const day = await js(win, `const rows = window.__cliqueHistory.computers[0].rows; const has = (k, p) => rows.some((r) => r[0] === k && r[3] === p)
      const d = new Date(Date.now() - 20 * 864e5); while (d.getDay() === 0 || d.getDay() === 6 || !has(key(d), 'claude') || !has(key(d), 'codex')) d.setDate(d.getDate() - 1)
      function key(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
      return key(d)`)
    const cell = `.us-prov[data-prov=claude] .us-c[data-day="${day}"]`
    await js(win, `document.querySelector('${cell}').scrollIntoView({ block: 'center' })`)
    await sleep(300)
    await tap(win, await glide(win, { x: 700, y: 500 }, await center(win, cell), 200))
    await sleep(600)
    await save(win, `usage-day-${theme}`)
    await js(win, click('[data-us=clear]'))
    await js(win, `document.querySelector('.us-scroll').scrollTop = 0`)
    await js(win, click('.page-head[data-for=usage] [data-us=range]'))
    await js(win, `document.querySelector('.menu [data-menu-act="${new Date().getFullYear()}"]').click()`)
    await sleep(500)
    await save(win, `usage-year-${theme}`)
    // the bottom of the page: every list
    await js(win, `document.querySelector('.us-scroll').scrollTop = 1e6`)
    await sleep(400)
    await save(win, `usage-lists-${theme}`)
    win.destroy()
    // a workspace hosted on the linked computer, seen from here: its agents there and this computer's in it
    const hosted = await dashboard(theme, 'usage', { height: 1010, fixture: 'workspaces', reset: RESET })
    await js(hosted, `await window.clique.call('workspace', 'switch', 'storefront-2')`)
    await sleep(900)
    await save(hosted, `usage-hosted-${theme}`)
    // ...and when that computer runs an older CLIque: it says so
    await js(hosted, `Object.assign(window.__cliqueHistory.computers[1], { rows: [], got: 0, note: '${LINK.name} runs an older CLIque: update it to see what it used' }); document.querySelector('.nv[data-place=clique]').click(); document.querySelector('.nv[data-place=usage]').click()`)
    await sleep(700)
    await save(hosted, `usage-hosted-older-${theme}`)
    hosted.destroy()
    const first = await dashboard(theme, 'usage', { height: 1010, fixture: 'usage-reading', reset: RESET })
    await sleep(900)
    await save(first, `usage-reading-${theme}`)
    await js(first, `window.__cliqueHistory = { here: null, computers: [{ slug: 'studio', name: 'Studio', here: true, online: true, at: Date.now(), reading: null, first: null, cols: [], rows: [], providers: {}, faces: {} }], spaces: {} }; localStorage.setItem('clique.place', 'chat')`)
    await js(first, click('.nv[data-place=clique]'))
    await js(first, click('.nv[data-place=usage]'))
    await sleep(500)
    await save(first, `usage-none-${theme}`)
    first.destroy()
    // the way in from the sidebar's foot: under the limits, Usage by day
    const foot = await dashboard(theme, 'chat', { height: 600 })
    await js(foot, click('.use-line'))
    await sleep(400)
    await save(foot, `usage-popover-${theme}`)
    foot.destroy()
    // a narrow window: the tiles two by two, the chart's legend under it, the squares smaller but all there
    const narrow = await dashboard(theme, 'usage', { width: 940, height: 1010, reset: RESET })
    await sleep(700)
    await save(narrow, `usage-narrow-${theme}`)
    await js(narrow, click('.us-scope [data-scope=all]'))
    await sleep(500)
    await save(narrow, `usage-narrow-everything-${theme}`)
    narrow.destroy()
    // three computers (one off): which one is a menu's pick
    const big = await dashboard(theme, 'usage', { height: 1010, fixture: 'big', reset: RESET })
    await js(big, click('.us-scope [data-scope=all]'))
    await sleep(700)
    await save(big, `usage-three-computers-${theme}`)
    big.destroy()
  },
  // Accounts (ui/accounts.js): each provider's sign-ins in their sheet (the default one and a Work account, each with
  // its own limits), adding one (its name, then its sign-in under way, then who it is), an account's menu, the account
  // picked in an agent's Profile, the limits popover with an account's row, and Usage split by account.
  async accounts(theme) {
    const win = await dashboard(theme, 'chat', { height: 900, fixture: 'accounts' })
    await js(win, click('.side-more'))
    await sleep(350)
    await save(win, `accounts-menu-${theme}`)
    await js(win, `document.querySelector('.menu [data-menu-act=accounts]').click()`)
    await sleep(600)
    await save(win, `accounts-${theme}`)
    await js(win, `window.__cliqueSignIn = 'wait'`)
    await js(win, click('#accounts [data-ac-new=codex]'))
    await js(win, `const i = document.querySelector('#accounts [data-ac-add] input'); i.value = 'Personal'; i.dispatchEvent(new Event('input', { bubbles: true }))`)
    await sleep(300)
    await save(win, `accounts-adding-${theme}`)
    await js(win, `document.querySelector('#accounts [data-ac-add]').requestSubmit()`)
    await sleep(700)
    await save(win, `accounts-signing-${theme}`)
    await js(win, `window.clique.call('account', 'code', { key: 'codex@codex-personal', text: 'x' })`)
    await sleep(500)
    await save(win, `accounts-signed-in-${theme}`)
    await js(win, click('#accounts .ac-row[data-ac="claude@claude-work"] [data-ac-menu]'))
    await sleep(350)
    await save(win, `accounts-row-menu-${theme}`)
    await js(win, `document.querySelector('.menu [data-menu-act=signout]').click()`)
    await sleep(500)
    await save(win, `accounts-signed-out-${theme}`)
    win.destroy()
    // an agent's Profile: which account it runs on, under its model
    const sheet = await dashboard(theme, 'chat', { height: 900, fixture: 'accounts' })
    await js(sheet, click('[data-agent="Milo"]'))
    await sleep(600)
    await js(sheet, click('[data-head=profile]'))
    await sleep(900)
    await save(sheet, `accounts-agent-${theme}`)
    sheet.destroy()
    // the limits popover: a row per account
    const foot = await dashboard(theme, 'chat', { height: 640, fixture: 'accounts' })
    await js(foot, click('.use-line'))
    await sleep(400)
    await save(foot, `accounts-limits-${theme}`)
    foot.destroy()
    // Usage, everything, split by account
    const usage = await dashboard(theme, 'usage', { height: 1010, fixture: 'accounts', reset: ['clique.usage.range', 'clique.usage.scope', 'clique.usage.by.here', 'clique.usage.by.all'] })
    await js(usage, click('.us-scope [data-scope=all]'))
    await sleep(400)
    await js(usage, click('.us-by [data-by=account]'))
    await sleep(600)
    await save(usage, `accounts-usage-${theme}`)
    usage.destroy()
  },
  // Accounts in motion: the ⋯ menu to Accounts, Add account for Claude, its name typed, the sign-in under way and then
  // through; then Milo's Profile, where the new account is one click.
  async accountsGif() {
    const win = await dashboard('light', 'chat', { width: 1240, height: 860, fixture: 'accounts' })
    await sleep(900)
    await record(win, 'accounts', {
      clip: { x: 0, y: 0, width: 1240, height: 860 }, ms: 15000, width: 1000,
      during: async () => {
        let at = { x: 620, y: 520 }
        const go = async (sel, ms = 550, rest = 800) => {
          at = await glide(win, at, await center(win, sel), ms)
          await tap(win, at)
          await sleep(rest)
        }
        await sleep(500)
        await go('.side-more', 650, 700)
        await go('.menu [data-menu-act=accounts]', 450, 1300)
        await go('#accounts [data-ac-new=claude]', 550, 500)
        for (const ch of 'Personal') {
          await js(win, `const i = document.querySelector('#accounts [data-ac-add] input'); i.value += ${JSON.stringify(ch)}; i.dispatchEvent(new Event('input', { bubbles: true }))`)
          await sleep(70)
        }
        await sleep(400)
        await go('#accounts [data-ac-add] button[type=submit]', 450, 2900) // the sign-in goes through on its own, as it does once you've signed in in the browser
        await go('#accounts [data-close].btn', 550, 600)
        await go('[data-agent="Milo"]', 600, 900)
        await go('[data-head=profile]', 600, 1200)
        await go('.account-row [data-pick=account] button[data-v=claude-personal]', 600, 1500)
      },
    })
    win.destroy()
  },
  // Usage in motion: in from the sidebar to the workspace on screen, over to Everything, one computer alone and back,
  // a click on a workspace's row (everything narrows to it), the chart split by agent, and a day picked in a calendar.
  async usageGif() {
    const win = await dashboard('light', 'chat', { width: 1240, height: 900, reset: ['clique.usage.range', 'clique.usage.scope', 'clique.usage.by.here', 'clique.usage.by.all'] })
    await sleep(900)
    const day = await js(win, `const rows = window.__cliqueHistory.computers[0].rows; const has = (k, p) => rows.some((r) => r[0] === k && r[3] === p)
      function key(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
      const d = new Date(Date.now() - 12 * 864e5); while (d.getDay() === 0 || d.getDay() === 6 || !has(key(d), 'claude')) d.setDate(d.getDate() - 1)
      return key(d)`)
    await record(win, 'usage', {
      clip: { x: 0, y: 0, width: 1240, height: 900 }, ms: 15500, width: 1000,
      during: async () => {
        let at = { x: 620, y: 520 }
        const go = async (sel, ms = 550, rest = 900) => {
          at = await glide(win, at, await center(win, sel), ms)
          await tap(win, at)
          await sleep(rest)
        }
        await sleep(500)
        await go('.nv[data-place=usage]', 600, 1300)
        await go('.us-scope [data-scope=all]', 600, 1300)
        await go(`.us-comp [data-computer=${LINK.slug}]`, 550, 1100)
        await go('.us-comp [data-computer=""]', 450, 800)
        await go('.us-legend-list .us-row[data-f=ws]:nth-child(3)', 600, 1400)
        await go('.us-by [data-by=who]', 550, 1300)
        await go('.us-filters [data-clear=all]', 600, 700)
        // down to the calendars
        await js(win, `document.querySelector('.us-scroll').scrollTo({ top: 470, behavior: 'smooth' })`)
        await sleep(900)
        at = await glide(win, at, await center(win, `.us-prov[data-prov=claude] .us-c[data-day="${day}"]`), 650)
        await sleep(500)
        await tap(win, at)
        await sleep(1700)
      },
    })
    win.destroy()
  },
  // The agent's sheet: no scrolling, one tab at a time.
  async detail(theme) {
    const win = await dashboard(theme, 'clique')
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
    const win = await dashboard(theme, 'clique')
    await sleep(300)
    await js(win, click('.pcard.add'))
    await sleep(1000)
    await save(win, `create-${theme}`)
    win.destroy()
  },
  // Moving an agent to another computer: the sheet that asks where its folder is there.
  async move(theme) {
    const win = await dashboard(theme, 'clique', { fixture: 'big' })
    await sleep(900)
    await js(win, `moveSheet('Iris', '${LINK.slug}')`)
    await sleep(900)
    await save(win, `move-${theme}`)
    win.destroy()
  },
  // Computers: this one, Workstation linked, the Laptop asleep, and a Mac mini nearby with Computers open too.
  async computers(theme) {
    const win = await dashboard(theme, 'clique', { fixture: 'big' })
    await sleep(900)
    await js(win, 'openComputers()')
    await sleep(800)
    await save(win, `computers-${theme}`)
    win.destroy()
  },
  // Nearby with nothing found yet (the radar), and with macOS keeping the app off the network.
  async nearby(theme) {
    const win = await dashboard(theme, 'clique')
    await sleep(900)
    await js(win, 'window.__cliqueNearby = []; openComputers()')
    await sleep(900)
    await save(win, `nearby-find-${theme}`)
    await js(win, "const s = window.__cliqueState; s.computers.me.localNetwork = 'blocked'; window.__cliqueEmit('state', s)")
    await sleep(500)
    await save(win, `nearby-blocked-${theme}`)
    win.destroy()
  },
  // Linking the Mac mini found nearby: asking, the code to check on both screens, Link here and waiting for the Mac mini,
  // linked; one that said no; a computer asking this one; and Link with a code.
  async linking(theme) {
    const win = await dashboard(theme, 'clique')
    await sleep(900)
    await js(win, 'window.__cliquePairDelay = 1500; openComputers()')
    await sleep(700)
    await js(win, "document.querySelector('[data-pair=\"n1\"]').click()")
    await sleep(500)
    await save(win, `link-asking-${theme}`)
    await sleep(1400)
    await save(win, `link-confirm-${theme}`)
    await js(win, "document.querySelector('[data-pair-confirm]').click()")
    await sleep(500)
    await save(win, `link-waiting-${theme}`)
    await js(win, 'window.__cliqueTheyAgree()')
    await sleep(700)
    await save(win, `link-linked-${theme}`)
    await sleep(1600)
    await js(win, "window.__cliquePairDelay = 200; window.__cliquePairEnd = 'declined'; document.querySelector('[data-pair=\"n1\"]').click()")
    await sleep(700)
    await save(win, `link-declined-${theme}`)
    await js(win, "window.__cliquePairEnd = null; document.querySelector('[data-pair-back]').click()")
    await sleep(400)
    await js(win, "window.__cliqueAsk('Laptop')")
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
    const win = await dashboard(theme, 'clique', { fixture: 'big' })
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
      return [window.__cliqueState.savers.on.noReportBack, document.querySelector('#savers [data-sv="noReportBack"]').checked, document.querySelectorAll('#savers .sv').length]`)
    if (String(flipped) !== 'true,true,6') throw new Error(`savers: flipping a switch gave ${flipped}`)
    win.destroy()
  },
  // Notifications: the sheet that says when CLIque may interrupt you (any time, then a schedule, which mustn't change its
  // height), paused from it; and the menu bar's popover with notifications on, the pause menu, paused for an hour (one
  // click on Resume turns them back on), and held by the schedule. Checked as it goes: a broken step stops the shot.
  async notifications(theme) {
    const errors = []
    const check = (what, ok, got) => {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(got)}`}`)
      if (!ok) errors.push(what)
    }
    const win = await dashboard(theme, 'chat')
    win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(`console: ${e.message}`))
    await sleep(700)
    const hint = await js(win, `document.querySelector('.side-more').click(); await new Promise((r) => setTimeout(r, 300))
      const row = [...document.querySelectorAll('.menu button')].find((b) => b.textContent.includes('Notifications'))
      const text = row?.textContent; row?.click(); await new Promise((r) => setTimeout(r, 500)); return text`)
    check('the ⋯ menu has Notifications…, saying "Any time"', hint === 'Notifications…Any time', hint)
    check('the sheet opens', await js(win, "return document.querySelector('#notify').open"))
    await save(win, `notify-sheet-${theme}`)
    const sched = await js(win, `const d = document.querySelector('#notify')
      const h = d.getBoundingClientRect().height
      d.querySelector('[data-nf-days=every]').click()
      await new Promise((r) => setTimeout(r, 400))
      return [Math.round(d.getBoundingClientRect().height - h), window.__cliqueState.notify.days, d.querySelector('.nf-hours').classList.contains('on'), d.querySelector('[data-nf-time=from]').value, d.querySelector('[data-nf-time=to]').value, d.querySelector('.nf-say').textContent]`)
    check('Every day: the hours show, 8:00 to 22:00, and the sheet keeps its height', String(sched.slice(0, 5)) === '0,every,true,08:00,22:00', sched)
    check('the sentence says when you won’t be notified', /^You won’t be notified between .+ and .+\. What comes up then is held/.test(sched[5]), sched[5])
    await save(win, `notify-sheet-schedule-${theme}`)
    const weekdays = await js(win, `const d = document.querySelector('#notify')
      d.querySelector('[data-nf-days=weekdays]').click()
      const to = d.querySelector('[data-nf-time=to]'); to.value = '18:30'; to.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
      const n = window.__cliqueState.notify
      return [n.days, n.to, d.querySelector('.nf-say').textContent]`)
    check('Weekdays until 18:30 is saved, and the sentence names the weekend', weekdays[0] === 'weekdays' && weekdays[1] === '18:30' && /or on Saturday and Sunday/.test(weekdays[2]), weekdays)
    const paused = await js(win, `const d = document.querySelector('#notify')
      d.querySelector('[data-nf-days=always]').click()
      await new Promise((r) => setTimeout(r, 300))
      d.querySelector('[data-nf-pause]').click(); await new Promise((r) => setTimeout(r, 300))
      const items = [...d.querySelectorAll('.menu button')].map((b) => b.querySelector('span').textContent)
      d.querySelector('.menu [data-menu-act=manual]').click(); await new Promise((r) => setTimeout(r, 500))
      return [items.join('/'), window.__cliqueState.notify.why, d.querySelector('.nf-pause b').textContent, d.querySelector('[data-nf-pause]').textContent]`)
    check('Pause… offers an hour, tomorrow morning, until you turn them back on; picking one says so with Resume', String(paused) === 'For 1 hour/Until tomorrow morning/Until I turn them back on,pause,Paused until you turn them back on,Resume', paused)
    await save(win, `notify-sheet-paused-${theme}`)
    const resumed = await js(win, `const d = document.querySelector('#notify')
      d.querySelector('[data-nf-pause]').click(); await new Promise((r) => setTimeout(r, 500))
      d.querySelector('[data-close]').click()
      return [window.__cliqueState.notify.quiet, d.querySelector('[data-nf-pause]').textContent, d.open]`)
    check('Resume turns them back on, and Done closes the sheet', String(resumed) === 'false,Pause…,false', resumed)
    // what the dashboard says it has open, for "not while you're looking"
    const looking = await js(win, `const out = [JSON.stringify(window.__cliqueLooking)]
      select('Milo'); await new Promise((r) => setTimeout(r, 400)); out.push(JSON.stringify(window.__cliqueLooking))
      goPlace('tasks'); await new Promise((r) => setTimeout(r, 400)); out.push(JSON.stringify(window.__cliqueLooking))
      return out`)
    check('the chat says whose questions are on screen', /"agent":null,"sees":\[.+\],"tasks":false/.test(looking[0]), looking[0])
    check("a conversation says whose it is, Tasks says it's Tasks", /"agent":"Milo","sees":\[\],"tasks":false/.test(looking[1]) && /"agent":null,"sees":\[\],"tasks":true/.test(looking[2]), looking)
    win.destroy()

    const tray = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover' })
    tray.webContents.on('console-message', (e) => e.level === 'error' && errors.push(`console: ${e.message}`))
    await sleep(500)
    await fitToContent(tray)
    const height = async () => (await js(tray, 'return window.__cliqueFit')).height
    const row = () => js(tray, "return [document.querySelector('.nf-open').textContent, document.querySelector('.nf-end').textContent, document.querySelector('.notif').classList.contains('held')]")
    const h0 = await height()
    check('the popover says notifications are on', String(await row()) === 'NotificationsOn,,false', await row())
    await save(tray, `tray-notify-${theme}`)
    await js(tray, `${click('.nf-open')}; await new Promise((r) => setTimeout(r, 400))`)
    const menu = await js(tray, "return [...document.querySelectorAll('.menu button')].map((b) => b.querySelector('span').textContent).join('/')")
    check('a click opens the pause menu', menu === 'For 1 hour/Until tomorrow morning/Until I turn them back on/Schedule…', menu)
    await save(tray, `tray-pause-menu-${theme}`)
    await js(tray, `${click('.menu [data-menu-act=hour]')}; await new Promise((r) => setTimeout(r, 500))`)
    await js(tray, 'window.__cliqueNotify({}, 2)') // two came up meanwhile
    await sleep(300)
    await fitToContent(tray)
    const p = await row()
    check('paused for an hour: it says until when, with Resume', /^Notifications pauseduntil \d/.test(p[0]) && p[1] === 'Resume' && p[2] === true, p)
    check('the tooltip says what is held and that it is still listed', /2 are held: you get one summary at .*still listed here/s.test(await js(tray, "return document.querySelector('.notif').title")))
    check('pausing moved nothing', (await height()) === h0, [h0, await height()])
    await save(tray, `tray-paused-${theme}`)
    await js(tray, `${click('.notif [data-resume]')}; await new Promise((r) => setTimeout(r, 500))`)
    check('Resume, one click: on again', String(await row()) === 'NotificationsOn,,false', await row())
    // outside the hours of a schedule: "off until", the schedule's doing, no Resume
    const hour = new Date().getHours()
    const hh = (h) => `${String((h + 24) % 24).padStart(2, '0')}:00`
    await js(tray, `window.__cliqueNotify({ days: 'every', from: '${hh(hour + 2)}', to: '${hh(hour - 1)}' }, 1)`)
    await sleep(300)
    await fitToContent(tray)
    const off = await row()
    check('outside your hours: off until they start, no Resume', /^Notifications offuntil \d/.test(off[0]) && off[1] === '' && off[2] === true, off)
    check('and still the same height', (await height()) === h0, [h0, await height()])
    await save(tray, `tray-off-hours-${theme}`)
    tray.destroy()

    // the floating pill while notifications are held: its warm edge holds still
    const pill = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(500)
    const edge = async () => js(pill, "return [document.body.classList.contains('alert'), getComputedStyle(document.querySelector('.pill'), '::after').animationName]")
    check('the pill breathes while someone needs you', String(await edge()) === 'true,pill-alert', await edge())
    await js(pill, "window.__cliqueNotify({ pause: 'manual' })")
    await sleep(300)
    check('paused: the edge stays, and holds still', String(await edge()) === 'true,none', await edge())
    check('the open chat says what it shows', await js(pill, "document.querySelector('.home').click(); await new Promise((r) => setTimeout(r, 500)); return /\"sees\":\\[.+\\]/.test(JSON.stringify(window.__cliqueLooking))"))
    pill.destroy()
    if (errors.length) throw new Error(`notifications: ${errors.join('; ')}`)
  },
  // Pausing from the menu bar's popover: the menu, For 1 hour, the row says until when, Resume.
  async pauseGif() {
    const tray = await open('tray.html', { theme: 'light', width: 340, height: 600, backdrop: 'popover' })
    await sleep(500)
    await fitToContent(tray)
    const [, h] = tray.getContentSize()
    await record(tray, 'pause', {
      clip: { x: 0, y: Math.max(0, h - 330), width: 340, height: Math.min(h, 330) }, ms: 6200, width: 680,
      during: async () => {
        await sleep(900)
        await js(tray, click('.nf-open'))
        await sleep(1300)
        await js(tray, click('.menu [data-menu-act=hour]'))
        await sleep(2200)
        await js(tray, click('.notif [data-resume]'))
        await sleep(1200)
      },
    })
    tray.destroy()
  },
  // Scheduled messages (ui/schedules.js): the clock beside Send with its quick times, the Send later sheet (which
  // mustn't change its height as the repeat changes), the list with a few set up and with none, and how a scheduled
  // message and CLIque's lines about one read in the chat
  async schedules(theme) {
    const win = await dashboard(theme, 'chat')
    await sleep(900)
    const type = (text) => js(win, `const ta = document.querySelector('.compose textarea'); ta.value = ${JSON.stringify(text)}; ta.dispatchEvent(new Event('input')); ta.focus()`)
    const chat = () => js(win, "const r = document.querySelector('.chat').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(innerHeight - 380), width: Math.round(r.width), height: 380 }")
    // the entry point: the clock, and what it offers with a message in the box
    await type('@Theo run the checkout tests on Safari and Chrome, and say what broke')
    await sleep(300)
    await save(win, `schedules-composer-${theme}`, { crop: await chat() })
    await js(win, click('.compose .later'))
    await sleep(500)
    const items = await js(win, "return [...document.querySelectorAll('.menu [data-menu-act]')].map((b) => b.querySelector('span').textContent).join('|')")
    if (!/^(Today at .*\|)?Tomorrow at .*\|(Monday at .*\|)?Every weekday at .*\|Pick a time…\|Scheduled messages…$/.test(items)) throw new Error(`schedules: the clock offers ${items}`)
    await save(win, `schedules-menu-${theme}`, { crop: await chat() })
    // Pick a time…: the sheet, on Once and then on Weekdays
    await js(win, click('.menu [data-menu-act=custom]'))
    await sleep(700)
    await save(win, `schedules-later-${theme}`)
    const moved = await js(win, `const d = document.querySelector('#later'); const h = d.getBoundingClientRect().height; const out = []
      for (const rp of ['daily', 'weekly', 'once', 'weekdays']) { d.querySelector('[data-rp=' + rp + ']').click(); await new Promise((r) => setTimeout(r, 350)); out.push(Math.round(d.getBoundingClientRect().height - h)) }
      d.querySelector('[data-lt-if]').click()
      return out.join(',') + '|' + d.querySelector('[data-lt-sum]').textContent`)
    if (!/^0,0,0,0\|Goes out Monday to Friday at /.test(moved)) throw new Error(`schedules: changing the repeat gave ${moved}`)
    await sleep(300)
    await save(win, `schedules-later-weekdays-${theme}`)
    await js(win, click('#later [data-lt-go]'))
    await sleep(700)
    const made = await js(win, "const s = window.__cliqueState.schedules.list; return [s.length, s[0]?.to, s[0]?.repeat, s[0]?.ifChanged, document.querySelector('#later').open, document.querySelector('.compose textarea').value, document.querySelector('.toast')?.textContent].join('|')")
    if (!/^1\|\|weekdays\|true\|false\|\|Scheduled: every weekday at /.test(made)) throw new Error(`schedules: scheduling gave ${made}`)
    // the list: one running, one an agent set up, one paused, one that didn't go out
    await js(win, `const s = window.__cliqueState; const day = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d }
      const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      s.schedules.list = [
        { id: 'a1', text: 'Run the checkout tests on Safari and Chrome, and say what broke', to: 'Theo', repeat: 'weekdays', date: iso(day(-9, 9)), time: '09:00', by: 'you', created: 1, next: day(1, 9).getTime(), last: { at: day(0, 9).getTime(), result: 'sent' }, ifChanged: true },
        { id: 'a2', text: 'Post what shipped this week, in three lines', to: '', channel: 'launch', repeat: 'weekly', date: iso(day(3, 16, 30)), time: '16:30', by: 'Q', created: 2, next: day(3, 16, 30).getTime() },
        { id: 'a3', text: 'Check the nightly build and file a task for anything red', to: 'June,Milo', repeat: 'daily', date: iso(day(-20, 7)), time: '07:30', by: 'you', created: 3, next: day(1, 7, 30).getTime(), last: { at: day(0, 7, 30).getTime(), result: 'busy' } },
        { id: 'a4', text: 'Remind me to renew the signing certificate', to: 'Ada', repeat: 'once', date: iso(day(12, 10)), time: '10:00', by: 'you', created: 4, next: day(12, 10).getTime() },
        { id: 'a5', text: 'Summarise open review comments', to: 'Iris', repeat: 'weekdays', date: iso(day(-30, 17)), time: '17:00', by: 'you', created: 5, next: day(1, 17).getTime(), paused: true, last: { at: day(-1, 17).getTime(), result: 'failed', why: '@Iris is turned off, turn it on first' } },
      ]
      window.__cliqueEmit('state', s)`)
    await sleep(300)
    await js(win, click('.compose .later'))
    await sleep(400)
    await js(win, click('.menu [data-menu-act=list]'))
    await sleep(800)
    await save(win, `schedules-list-${theme}`)
    // the switch pauses one, and turns it back on
    const paused = await js(win, `const sw = document.querySelector('#scheduled [data-sc=a1] [data-sc-on]'); sw.click(); await new Promise((r) => setTimeout(r, 400))
      const one = [window.__cliqueState.schedules.list.find((x) => x.id === 'a1').paused, document.querySelector('#scheduled [data-sc=a1]').classList.contains('paused')]
      document.querySelector('#scheduled [data-sc=a1] [data-sc-on]').click(); await new Promise((r) => setTimeout(r, 400))
      return [...one, window.__cliqueState.schedules.list.find((x) => x.id === 'a1').paused, document.querySelector('#scheduled [data-sc=a1] [data-sc-on]').checked].join()`)
    if (paused !== 'true,true,,true') throw new Error(`schedules: the switch gave ${paused}`)
    await js(win, "const s = window.__cliqueState; s.schedules.list = []; window.__cliqueEmit('state', s)")
    await sleep(600)
    await save(win, `schedules-empty-${theme}`)
    await js(win, click('#scheduled [data-close]'))
    // in the chat: one that went out on time, one that went late, and what CLIque says when one is skipped or fails
    await type('')
    // (mins: how long ago each was said; late: how long ago it was due)
    const said = [
      { id: 'c1', kind: 'msg', from: 'you', to: 'Theo', text: 'Run the checkout tests on Safari and Chrome, and say what broke', mins: 34, scheduled: { id: 'a1' } },
      { id: 'c2', kind: 'reply', from: 'Theo', to: 'you', re: 'c1', text: 'All 48 pass on Chrome. Safari fails 2: the payment sheet test times out waiting for the frame, and the coupon field loses focus.', mins: 31 },
      { id: 'c3', kind: 'event', from: 'clique', schedule: 'a3', text: 'Scheduled message "Check the nightly build and file a task for anything red" skipped this time: its last run is still going. It goes out again once that\'s done (next: Tue 17 Nov at 7:30)', mins: 20 },
      { id: 'c4', kind: 'event', from: 'clique', schedule: 'a5', text: 'Scheduled message "Summarise open review comments" (every weekday at 17:00) didn\'t go out: @Iris is turned off, turn it on first', mins: 12 },
      { id: 'c5', kind: 'msg', from: 'you', to: 'June', auto: true, text: 'Post what shipped this week, in three lines', mins: 3, scheduled: { id: 'a2', late: 43 } },
      { id: 'c6', kind: 'reply', from: 'June', to: 'you', re: 'c5', text: 'Shipped: coupon guard on checkout, the new payment sheet on Safari, and receipts with the new logo.', mins: 1 },
    ]
    await js(win, `const s = window.__cliqueState; const t = (m) => Date.now() - m * 60000
      for (const a of s.agents) if (a.status === 'waiting') a.status = 'idle'
      s.feed = ${JSON.stringify(said)}.map(({ mins, ...e }) => ({ ...e, ts: t(mins), ...(e.scheduled && { scheduled: { id: e.scheduled.id, at: t(mins), ...(e.scheduled.late && { late: t(e.scheduled.late) }) } }) }))
      window.__cliqueEmit('state', s)`)
    await sleep(900)
    const marks = await js(win, "return [...document.querySelectorAll('.feed .tag.sched')].map((x) => x.textContent).join('|') + '/' + document.querySelectorAll('.feed .event .ev-icon svg').length")
    if (!/^scheduled\|scheduled for .*, sent late\/2$/.test(marks)) throw new Error(`schedules: the chat marks read ${marks}`)
    const whole = "const r = document.querySelector('.chat').getBoundingClientRect(); return { x: Math.round(r.x), y: 0, width: Math.round(r.width), height: innerHeight }"
    await save(win, `schedules-chat-${theme}`, { crop: await js(win, whole) })
    // said in words: you ask Q, Q runs \`clique app schedule add\`, and its card waits for your OK (the card's words are
    // what core/tools.js makes for that command)
    const asked = [
      { id: 'q0', kind: 'msg', from: 'you', to: 'Ada', text: 'Every weekday at 9, ask Theo to run the checkout tests and say what broke.', mins: 1 },
      { id: 'q1', kind: 'ask', from: 'Ada', to: 'you', cli: 'clique', re: 'q0', mins: 0.3, ask: { type: 'permission', tool: 'clique app', app: true, title: 'Schedule a message', code: 'Every weekday at 9:00 · to @Theo\nRun the checkout tests on Safari and Chrome, and say what broke', detail: 'It goes out as a message from you, first on Tue 17 Nov at 9:00. Pause or remove it under Scheduled messages.', say: 'Can I schedule a message to @Theo, every weekday at 9:00?', always: [], alert: 'wants to schedule a message' } },
    ]
    await js(win, `const s = window.__cliqueState; const t = (m) => Date.now() - m * 60000
      s.feed = ${JSON.stringify(asked)}.map(({ mins, ...e }) => ({ ...e, ts: t(mins) }))
      Object.assign(s.agents.find((a) => a.name === 'Ada'), { status: 'waiting', since: Date.now() - 20000 })
      window.__cliqueEmit('state', s)`)
    await sleep(1000)
    await save(win, `schedules-ask-${theme}`, { crop: await js(win, whole) })
    win.destroy()
  },
  // Scheduling a message from the composer: write it, the clock, Pick a time…, Weekdays, Schedule, then the list
  async schedulesGif() {
    const win = await dashboard(DARK ? 'dark' : 'light', 'chat', { width: 1180, height: 760 })
    await sleep(1200)
    const text = '@Theo run the checkout tests and say what broke'
    await record(win, 'schedules', {
      ms: 14500, width: 1000,
      during: async () => {
        let at = { x: 700, y: 400 }
        at = await glide(win, at, await center(win, '.compose textarea'), 500)
        await tap(win, at)
        for (let i = 1; i <= text.length; i++) {
          await js(win, `const ta = document.querySelector('.compose textarea'); ta.value = ${JSON.stringify(text)}.slice(0, ${i}); ta.dispatchEvent(new Event('input'))`)
          await sleep(24)
        }
        await sleep(400)
        at = await glide(win, at, await center(win, '.compose .later'), 500)
        await sleep(250)
        await tap(win, at)
        await sleep(900)
        at = await glide(win, at, await center(win, '.menu [data-menu-act=custom]'), 450)
        await sleep(300)
        await tap(win, at)
        await sleep(1100)
        at = await glide(win, at, await center(win, '#later [data-rp=weekdays]'), 600)
        await sleep(250)
        await tap(win, at)
        await sleep(1000)
        at = await glide(win, at, await center(win, '#later [data-lt-go]'), 600)
        await sleep(300)
        await tap(win, at)
        await sleep(1500)
        at = await glide(win, at, await center(win, '.compose .later'), 600)
        await sleep(250)
        await tap(win, at)
        await sleep(700)
        at = await glide(win, at, await center(win, '.menu [data-menu-act=list]'), 400)
        await sleep(250)
        await tap(win, at)
        await sleep(1600)
      },
    })
    win.destroy()
  },
  // The spend check-in (core/hub.js checkIn). Where it's set: the ⋯ menu's row and its sheet, a row per provider in
  // that provider's own unit, off as a new install has it, then with values, then "Just tell me" (the sheet mustn't
  // change its height between them), and an agent's sheet saying what applies to it. What it does: a Claude group's
  // card in the chat with the hand-off it holds, in its thread, after Keep going and after Stop; a Codex agent's card,
  // in tokens; the line "Just tell me" gives instead; the floating chat's Needs you queue, and the menu bar's.
  async checkIn(theme) {
    const win = await dashboard(theme, 'chat', { width: 1100, height: 760 })
    await sleep(700)
    await js(win, "document.querySelector('.side-more').click()")
    await sleep(500)
    const row = () => js(win, "return [...document.querySelectorAll('.menu [data-menu-act]')].find((b) => b.dataset.menuAct === 'checkin')?.textContent.trim().replace(/\\s+/g, ' ')")
    if (!/Spend check-in….*Off/.test(await row())) throw new Error(`checkIn: on a new install the menu's row reads ${await row()}`)
    await js(win, "[...document.querySelectorAll('.menu [data-menu-act]')].find((b) => b.dataset.menuAct === 'checkin').click()")
    await sleep(800)
    await save(win, `checkin-sheet-off-${theme}`)
    const sheet = (code) => js(win, `const d = document.querySelector('#checkin'); ${code}`)
    const rows = await sheet("return [...d.querySelectorAll('[data-ci-row]')].map((r) => r.dataset.ciRow + ':' + [...r.querySelectorAll('button')].map((b) => b.textContent).join('/')).join(' ')")
    if (rows !== 'claude:Off/$2/$5/$10/$25 codex:Off/2M/5M/10M/25M') throw new Error(`checkIn: the sheet's rows are ${rows}`) // (GLM has no meter: no row)
    const h0 = await sheet('return d.getBoundingClientRect().height')
    const pick = (id, v) => sheet(`d.querySelector('[data-ci="${id}"] button[data-v="${v}"]').click(); await new Promise((r) => setTimeout(r, 400))`)
    await pick('claude', 5)
    await pick('codex', 5000000)
    await save(win, `checkin-sheet-${theme}`)
    let now = await sheet("return [Math.round(d.getBoundingClientRect().height), JSON.stringify(window.__cliqueState.checkIn), d.querySelector('.ci-says').textContent]")
    if (now[0] !== Math.round(h0) || now[1] !== '{"at":{"claude":5,"codex":5000000},"then":"ask"}' || !/^Past \$5 for Claude or 5M tokens for Codex since you last spoke, one card asks you/.test(now[2])) throw new Error(`checkIn: with values picked the sheet gave ${now} (was ${h0} tall)`)
    await sheet("d.querySelector('[data-ci-then] [data-v=tell]').click(); await new Promise((r) => setTimeout(r, 400))")
    await save(win, `checkin-sheet-tell-${theme}`)
    now = await sheet("return [Math.round(d.getBoundingClientRect().height), window.__cliqueState.checkIn.then, d.querySelector('.ci-says').textContent]")
    if (now[0] !== Math.round(h0) || now[1] !== 'tell' || !/Nothing is held\.$/.test(now[2])) throw new Error(`checkIn: Just tell me gave ${now}`)
    // a value of your own, typed: 7.5 million tokens
    now = await sheet(`const f = d.querySelector('[data-ci-custom="codex"]'); f.focus(); f.value = '7.5'; f.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 400))
      return [window.__cliqueState.checkIn.at.codex, d.querySelector('[data-ci="codex"] .on')?.className, Math.round(d.getBoundingClientRect().height)]`)
    if (String(now) !== `7500000,limit-custom ci-custom tokens on,${Math.round(h0)}`) throw new Error(`checkIn: a typed value gave ${now}`)
    await sheet("document.activeElement.blur(); d.querySelector('[data-ci-then] [data-v=ask]').click(); d.querySelector('[data-ci=\"codex\"] button[data-v=\"5000000\"]').click(); await new Promise((r) => setTimeout(r, 400)); d.close()")
    await js(win, "document.querySelector('.side-more').click()")
    await sleep(500)
    await save(win, `checkin-menu-${theme}`, { crop: { x: 0, y: 290, width: 620, height: 470 } })
    if (!/Claude \$5 · Codex 5M/.test(await row())) throw new Error(`checkIn: with values the menu's row reads ${await row()}`)
    await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.click()")
    await sleep(400)

    // a Claude group's card
    await js(win, CHECK_IN_FEED('claude'))
    await sleep(1000)
    await save(win, `checkin-claude-${theme}`)
    const card = await js(win, `const c = document.querySelector('.ask-card.spend'); return c ? [c.querySelector('.ask-title')?.textContent, c.querySelector('.ask-parts')?.textContent, [...c.querySelectorAll('.btn')].map((b) => b.textContent).join('/')].join(' | ') : 'no card'`)
    if (!/used \$5\.40 at API rates since you last spoke \| Ada \$3\.70 · Milo \$1\.70 · in 46 min \| Keep going\/Stop/.test(card)) throw new Error(`checkIn: the card reads ${card}`)
    // the thread the hand-offs are in: the one that waits says so
    await js(win, "document.querySelector('.thread-card').click()")
    await sleep(900)
    await save(win, `checkin-thread-${theme}`)
    const held = await js(win, "return [...document.querySelectorAll('.thread-row .tag')].map((x) => x.textContent).join(',')")
    if (held !== 'held for the check-in') throw new Error(`checkIn: the thread's tags read ${held}`)
    await js(win, "document.querySelector('.thread-x').click()")
    await sleep(500)
    await js(win, "document.querySelector('.ask-card.spend [data-answer=\"allow\"]').click()")
    await sleep(900)
    await save(win, `checkin-kept-${theme}`)
    await js(win, `${CHECK_IN_FEED('claude')}; await new Promise((r) => setTimeout(r, 400)); document.querySelector('.ask-card.spend [data-answer="deny"]').click()`)
    await sleep(900)
    await save(win, `checkin-stopped-${theme}`)
    const done = await js(win, "return [...document.querySelectorAll('.ask-card.done')].at(-1)?.textContent.trim().replace(/\\s+/g, ' ')")
    if (!/Stopped.*at \$5\.40/.test(done)) throw new Error(`checkIn: after Stop the card reads ${done}`)
    // a Codex agent's, in tokens
    await js(win, CHECK_IN_FEED('codex'))
    await sleep(1000)
    await save(win, `checkin-codex-${theme}`)
    const codex = await js(win, "const c = document.querySelector('.ask-card.spend'); return [c.querySelector('.ask-title').textContent, c.querySelector('[data-answer=allow]').title].join(' | ')")
    if (codex !== '@Theo has used 5.2M tokens since you last spoke | Allows another 5M tokens, then asks again') throw new Error(`checkIn: Codex's card reads ${codex}`)
    // "Just tell me": a line, and nothing held
    await js(win, CHECK_IN_FEED('tell'))
    await sleep(1000)
    await save(win, `checkin-tell-${theme}`)
    const line = await js(win, "return [[...document.querySelectorAll('.event')].at(-1)?.textContent.trim(), document.querySelectorAll('.ask-card.spend').length].join(' | ')")
    if (line !== 'Ada and Milo have used $5.40 at API rates since you last spoke | 0') throw new Error(`checkIn: the line reads ${line}`)
    // an agent's sheet: what applies to it, beside its context limit
    await js(win, `${CHECK_IN_FEED('claude')}; document.querySelector('.side-nav [data-place="clique"]').click()`)
    await sleep(600)
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, click('.pcard[data-name="Theo"]'))
    await sleep(1000)
    await js(win, "const h = document.querySelector('.ed-adv-head'); if (h.getAttribute('aria-expanded') !== 'true') h.click()")
    await sleep(700)
    await js(win, "document.querySelector('.checkin-row')?.scrollIntoView({ block: 'center' })")
    await sleep(300)
    await save(win, `checkin-agent-${theme}`)
    const read = await js(win, "return document.querySelector('.checkin-read')?.textContent")
    if (read !== 'After 5M tokens, asks you · every Codex agent') throw new Error(`checkIn: the agent's sheet reads ${read}`)
    win.destroy()
    const chat = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(chat, `${CHECK_IN_FEED('claude')}; window.__cliqueEmit('toggle', { open: true, focus: false })`)
    await sleep(900)
    await js(chat, "document.querySelector('.nq-go')?.click()")
    await sleep(700)
    await fitToContent(chat)
    await save(chat, `checkin-queue-${theme}`)
    chat.destroy()
    const tray = await open('tray.html', { theme, width: 340, height: 600, backdrop: 'popover' })
    await sleep(400)
    await js(tray, CHECK_IN_FEED('codex'))
    await sleep(600)
    await fitToContent(tray)
    await save(tray, `checkin-tray-${theme}`)
    tray.destroy()
  },
  // ...and the card coming up while Milo works, then Keep going
  async checkInGif() {
    const win = await dashboard(DARK ? 'dark' : 'light', 'chat', { width: 1100, height: 760 })
    await sleep(700)
    await js(win, CHECK_IN_FEED('before'))
    await sleep(900)
    await record(win, 'checkin', {
      ms: 6200,
      during: async () => {
        await sleep(900)
        await js(win, CHECK_IN_FEED('claude'))
        await sleep(1900)
        let at = await glide(win, { x: 760, y: 420 }, await center(win, '.ask-card.spend [data-answer="allow"]'), 700)
        await sleep(350)
        await tap(win, at)
        await sleep(600)
        await js(win, `const s = window.__cliqueState; const m = s.agents.find((a) => a.name === 'Milo'); Object.assign(m, { status: 'working', activity: 'Edit pages/checkout.tsx', since: Date.now() }); window.__cliqueEmit('state', s)`)
      },
    })
    win.destroy()
  },
  // Agent tools: an agent asking to change CLIque (its card in the chat, its words in the Needs-you queue), the card
  // once allowed beside what an automatic change says, and the sheet that says how far agents go, in Ask first and in
  // Automatic (which mustn't change its height)
  async tools(theme) {
    const win = await dashboard(theme, 'chat')
    await sleep(900)
    await js(win, `const s = window.__cliqueState
      s.feed = s.feed.filter((e) => !(e.kind === 'ask' && !e.answer))
      s.feed.push({ id: 't0', kind: 'msg', from: 'you', to: 'Ada', text: 'Can you add a #design channel for Iris and Milo? They should check new screens against the design system.', ts: Date.now() - 60000 })
      s.feed.push({ id: 't1', kind: 'ask', from: 'Ada', to: 'you', cli: 'clique', re: 't0', ts: Date.now() - 20000, ask: { type: 'permission', tool: 'clique app', app: true, title: 'Add a channel', code: '#design\\nCheck new screens against the design system: spacing, type scale and dark mode. Post before/after screenshots.', detail: 'For @Iris, @Milo', say: 'Can I add a #design channel?', always: [], alert: 'wants to add a channel' } })
      for (const a of s.agents) if (a.status === 'waiting') a.status = 'idle'
      Object.assign(s.agents.find((a) => a.name === 'Ada'), { status: 'waiting', since: Date.now() - 20000 })
      window.__cliqueEmit('state', s)`)
    await sleep(1000)
    await save(win, `tools-ask-${theme}`)
    await js(win, `const s = window.__cliqueState
      s.feed.find((e) => e.id === 't1').answer = { by: 'you', allow: true, at: Date.now() - 15000 }
      s.feed.push({ id: 't2', kind: 'reply', from: 'Ada', to: 'you', re: 't0', text: 'Done: **#design** is up, with Iris and Milo in it and your brief as its instructions.', ts: Date.now() - 12000 })
      s.feed.push({ id: 't3', kind: 'msg', from: 'you', to: 'Ada', text: 'Thanks! And a workspace for the storefront, with you and June in it.', ts: Date.now() - 8000 })
      s.feed.push({ id: 't4', kind: 'event', from: 'Ada', text: 'made the Storefront workspace', app: true, ts: Date.now() - 4000 })
      Object.assign(s.agents.find((a) => a.name === 'Ada'), { status: 'working', since: Date.now() - 8000 })
      window.__cliqueEmit('state', s)`)
    await sleep(900)
    await save(win, `tools-done-${theme}`)
    await js(win, 'openTools()')
    await sleep(800)
    await save(win, `tools-sheet-${theme}`)
    const after = await js(win, `const d = document.querySelector('#tools')
      const h = d.getBoundingClientRect().height
      d.querySelector('[data-tl="auto"]').click()
      await new Promise((r) => setTimeout(r, 500))
      return [Math.round(d.getBoundingClientRect().height - h), window.__cliqueState.tools, [...d.querySelectorAll('.tl-how')].map((x) => x.textContent).join('/'), d.querySelector('.tl-about p.on').dataset.mode]`)
    if (String(after) !== '0,auto,Automatic/Automatic/Automatic/Automatic/Asks first,auto') throw new Error(`tools: switching to Automatic gave ${after}`)
    await save(win, `tools-sheet-auto-${theme}`)
    win.destroy()
    // the floating chat's Needs you queue: the creature asks in its own words, the card under them
    const chat = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(chat, `const s = window.__cliqueState
      s.feed = s.feed.filter((e) => !(e.kind === 'ask' && !e.answer))
      s.feed.push({ id: 't1', kind: 'ask', from: 'Ada', to: 'you', cli: 'clique', ts: Date.now() - 20000, ask: { type: 'permission', tool: 'clique app', app: true, title: 'Add a workspace', code: '🛒 Storefront\\n~/Projects/storefront', detail: '@Ada, @June work there, and start right away.', say: 'Can I make a workspace called Storefront?', always: [], alert: 'wants to add a workspace' } })
      for (const a of s.agents) if (a.status === 'waiting') a.status = 'idle'
      Object.assign(s.agents.find((a) => a.name === 'Ada'), { status: 'waiting', since: Date.now() - 20000 })
      window.__cliqueEmit('state', s)
      window.__cliqueEmit('toggle', { open: true, focus: false })`)
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
    const setup = (card) => `const s = window.__cliqueState
      s.feed = s.feed.filter((e) => !(e.kind === 'ask' && !e.answer) && !/^t[rb]/.test(e.id))
      s.feed.push({ id: '${card ? 'tr0' : 'tb0'}', kind: 'msg', from: 'you', to: 'June', text: 'Can you set up the storefront repo and get its tests running?', ts: Date.now() - 60000 })
      ${card ? `s.feed.push({ id: 'tr1', kind: 'ask', from: 'June', to: 'you', cli: 'claude', ts: Date.now() - 20000, ask: ${ask} })` : "s.feed.push({ id: 'tb1', kind: 'event', from: 'June', alert: true, ts: Date.now() - 20000, text: 'asks whether to trust its folder, ~/Projects/storefront. Answer in its terminal: messages wait until then' })"}
      for (const a of s.agents) if (a.status === 'waiting') a.status = 'idle'
      Object.assign(s.agents.find((a) => a.name === 'June'), { status: 'waiting', since: Date.now() - 20000, activity: '' })
      window.__cliqueEmit('state', s)`
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
      window.__cliqueEmit('toggle', { open: true, focus: false })`)
    await sleep(900)
    await js(chat, "document.querySelector('.nq-go')?.click()")
    await sleep(700)
    await fitToContent(chat)
    await save(chat, `trust-chat-${theme}`)
    chat.destroy()
  },
  // A question with its steps written in a run, "(1) … (2) …", as agents write one (a question is one line): the card
  // sets them out as a list under what leads in, and the question itself closes it. In the chat, then in the floating
  // chat's Needs you, where the creature says it. A plain question beside it reads as it always did.
  async askSteps(theme) {
    const setup = `const s = window.__cliqueState
      s.feed = s.feed.filter((e) => !(e.kind === 'ask' && !e.answer))
      s.feed.push({ id: 'st0', kind: 'msg', from: 'you', to: 'June', text: 'Get the order emails sending from the shop.', ts: Date.now() - 90000 })
      s.feed.push({ id: 'st1', kind: 'ask', from: 'June', to: 'you', cli: 'claude', re: 'st0', ts: Date.now() - 20000, ask: ${JSON.stringify(STEPS_ASK)} })
      for (const a of s.agents) if (a.status === 'waiting') a.status = 'idle'
      Object.assign(s.agents.find((a) => a.name === 'June'), { status: 'waiting', since: Date.now() - 20000, activity: '' })
      window.__cliqueEmit('state', s)`
    const steps = (STEPS_ASK.questions[0].question.match(/\(\d\)/g) ?? []).length
    // the steps as a list, and nothing of the question lost on the way
    const read = (box) => `const q = document.querySelector('${box}')
      return { steps: q?.querySelectorAll('ol > li').length ?? 0, last: q?.lastElementChild?.textContent ?? '', words: (q?.textContent ?? '').replace(/\\s+/g, '') }`
    const check = (where, got) => {
      const want = STEPS_ASK.questions[0].question.replace(/\(\d\)|\s+/g, '')
      if (got.steps !== steps || got.last !== 'Where are you?' || got.words !== want) throw new Error(`askSteps, ${where}: ${JSON.stringify(got)}`)
    }
    const win = await dashboard(theme, 'chat', { width: 1000, height: 860 })
    const column = () => js(win, "const r = document.querySelector('.page-head[data-for=chat]').getBoundingClientRect(); return { x: Math.round(r.x), y: 0, width: Math.round(innerWidth - r.x), height: innerHeight }")
    const card = (id) => js(win, `const r = document.querySelector('[data-ask="${id}"]').getBoundingClientRect(); return { x: Math.round(r.x) - 8, y: Math.round(r.y) - 8, width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 }`)
    await sleep(900)
    // the plain question the demo clique already has (Iris's), open and answered: one line, as it was
    await js(win, "document.querySelector('[data-ask=\"f9\"]').scrollIntoView({ block: 'center' })")
    await sleep(300)
    await save(win, `ask-plain-${theme}`, { crop: await card('f9') })
    await js(win, "document.querySelector('[data-ask=\"f9\"] .ask-option').click()")
    await sleep(900)
    await save(win, `ask-plain-done-${theme}`, { crop: await card('f9') })
    await js(win, "document.querySelector('.feed').scrollTop = 1e6") // back at the latest, where the next question lands
    await sleep(300)
    await js(win, setup)
    await sleep(1000)
    check('the chat', await js(win, read('[data-ask="st1"] .ask-question')))
    await save(win, `ask-steps-${theme}`, { crop: await column() })
    // answered: it goes back under the question as the agent asked it, word for word
    const answered = await js(win, `document.querySelector('[data-ask="st1"] .ask-option')?.click()
      await new Promise((r) => setTimeout(r, 600))
      return window.__cliqueState.feed.find((e) => e.id === 'st1').answer?.answers ?? null`)
    if (answered?.[STEPS_ASK.questions[0].question] !== STEPS_ASK.questions[0].options[0].label) throw new Error(`askSteps: the answer went back as ${JSON.stringify(answered)}`)
    await js(win, "document.querySelector('.feed').scrollTop = 1e6")
    await sleep(400)
    await save(win, `ask-steps-done-${theme}`, { crop: await column() })
    win.destroy()
    const chat = await open('overlay.html', { theme, width: 520, height: 660, backdrop: 'desktop' })
    await sleep(400)
    await js(chat, `${setup}
      window.__cliqueEmit('toggle', { open: true, focus: false })`)
    await sleep(900)
    await js(chat, "document.querySelector('.nq-go')?.click()")
    await sleep(700)
    await fitToContent(chat)
    check('Needs you', await js(chat, read('[data-need="st1"] .nq-say')))
    // the queue takes up to 58% of the chat and scrolls: down to the steps
    await js(chat, "const q = document.querySelector('.needs-queue'); q.scrollTop = q.querySelector('.nq-say ol').getBoundingClientRect().top - q.querySelector('.nq-item').getBoundingClientRect().top - 12")
    await sleep(200)
    await save(chat, `ask-steps-chat-${theme}`)
    chat.destroy()
  },
  // Add a phone: the pairing view with its code to scan, the phone that paired with it, then the list with that phone
  // highlighted (two paired before it, one connected).
  async phones(theme) {
    const win = await dashboard(theme, 'clique')
    await sleep(900)
    await js(win, 'openComputers()')
    await sleep(500)
    await js(win, click('[data-phone-add]'))
    await sleep(900)
    await save(win, `phones-${theme}`)
    await js(win, "const s = window.__cliqueState; s.computers.phones.devices.push({ id: 'p3', name: 'iPad', platform: 'ios', app: '0.1.0', paired: Date.now(), seen: Date.now(), online: true }); window.__cliqueEmit('state', s)")
    await sleep(900)
    await save(win, `phones-paired-${theme}`)
    await sleep(1700)
    await save(win, `phones-list-${theme}`)
    win.destroy()
  },
  // Add a phone: the code to scan, a new one before it runs out (codes last four seconds here, so the QR just changes),
  // then a phone pairs and the list shows it highlighted.
  async pairGif() {
    const win = await dashboard('light', 'clique')
    await js(win, 'openComputers()')
    await sleep(900)
    await js(win, 'window.__cliquePhoneTTL = 4000')
    await record(win, 'pair', {
      clip: { x: 396, y: 16, width: 648, height: 768 }, ms: 9800, width: 648,
      during: async () => {
        let at = { x: 700, y: 600 }
        at = await glide(win, at, await center(win, '[data-phone-add]'), 700)
        await sleep(250)
        await tap(win, at)
        await glide(win, at, { x: at.x + 60, y: at.y + 120 }, 600)
        await sleep(4300)
        await js(win, "const s = window.__cliqueState; s.computers.phones.devices.push({ id: 'p3', name: 'iPad', platform: 'ios', app: '0.1.0', paired: Date.now(), seen: Date.now(), online: true }); s.computers.phones.pairing = null; window.__cliqueEmit('state', s)")
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
    const win = await dashboard(theme, 'clique')
    await js(win, click('[data-mode=cards]'))
    await sleep(300)
    await js(win, `${click('.page-head[data-for=clique] [data-act=more]')}; await new Promise((r) => setTimeout(r, 200)); ${click('.menu [data-menu-act=select]')}; await new Promise((r) => setTimeout(r, 200)); ${click('.pcard[data-name="Ada"]')}; ${click('.pcard[data-name="Theo"]')}`)
    await sleep(900)
    await save(win, `select-${theme}`)
    win.destroy()
  },
  async tasks(theme) {
    const win = await dashboard(theme, 'tasks')
    await js(win, "localStorage.setItem('clique.tasks.view', 'board'); localStorage.setItem('clique.tasks.done', '0')")
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    await sleep(1100)
    await save(win, `tasks-${theme}`)
    await js(win, click('.tc[data-name="12"]'))
    await sleep(900)
    await save(win, `task-panel-${theme}`)
    await js(win, click('.tp [data-tp=close]'))
    await sleep(500)
    // a task that came back opens in the review, with its receipts (the review shot has the rest of it)
    await js(win, click('.tc[data-name="5"]'))
    await sleep(800)
    await save(win, `task-review-${theme}`)
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
  // The review: what came back, one task at a time, with who was on it and where its time went. First the one waiting
  // longest for you (three agents on it, 21 minutes of it waiting on you); then a landed one (a clone, a tester, sent
  // back once); then what's missing, written under it.
  async review(theme) {
    const win = await dashboard(theme, 'tasks')
    await js(win, "localStorage.setItem('clique.tasks.view', 'board'); localStorage.setItem('clique.tasks.done', '0')")
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    await sleep(1000)
    await js(win, click('.tk-views [data-mode=review]'))
    await sleep(700)
    await js(win, click('.rv-row[data-rv-open="5"]'))
    await sleep(500)
    await save(win, `review-${theme}`)
    await js(win, click('.rv-row[data-rv-open="1"]'))
    await sleep(500)
    await save(win, `review-landed-${theme}`)
    await js(win, click('.rv-row[data-rv-open="4"]'))
    await sleep(400)
    await js(win, `const box = document.querySelector('[data-rv-note]'); box.focus(); box.value = 'Also wrong with a discount code on top: 3 items and SAVE10 comes to 0.92.'; box.dispatchEvent(new Event('input', { bubbles: true }))`)
    await sleep(400)
    await save(win, `review-sendback-${theme}`)
    win.destroy()
  },
  // Several tasks picked (⌘-click, then Shift-click for a run of them) and the bar that acts on them all, on the
  // board and in the list; then the header's ⋯ for clearing the board, with the chat's one line for a bulk action.
  async tasksBulk(theme) {
    const win = await dashboard(theme, 'tasks')
    await js(win, "localStorage.setItem('clique.tasks.view', 'board'); localStorage.setItem('clique.tasks.done', '1')")
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
      window.__cliqueState.feed.push({ id: 'bk1', kind: 'task', type: 'task', act: 'bulk', from: 'you', text: 'closed 23 tasks', count: 23, ts: Date.now() })
      window.__cliqueEmit('state', window.__cliqueState)`)
    await sleep(700)
    await js(win, click('[data-board-menu]'))
    await sleep(500)
    await save(win, `tasks-board-menu-${theme}`)
    win.destroy()
  },
  async conversation(theme) {
    const win = await dashboard(theme, 'clique')
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
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(600)
    await js(win, `${click('.chip.task-chip')}; const ta = document.querySelector('.composer textarea'); ta.value = 'Promo banner hides the cart button on small phones @Milo'; ta.dispatchEvent(new Event('input'))`)
    await sleep(500)
    await fitToContent(win)
    await save(win, `chat-task-${theme}`)
    win.destroy()
  },
  // Switching workspaces: the switcher, Storefront, then back to Docs site from the sidebar's dock. The clique slides over.
  // Workspaces on the rail: switch to the one that needs you, back, then see who works there.
  async workspacesGif() {
    const win = await dashboard('light', 'chat', { fixture: 'workspaces', width: 1280, height: 800 })
    await sleep(1200)
    await record(win, 'workspaces', {
      ms: 8200, width: 1000,
      during: async () => {
        let at = { x: 640, y: 420 }
        at = await glide(win, at, await center(win, '.rail-ws[data-ws=storefront]'), 700)
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
    await js(win, "localStorage.setItem('clique.tasks.view', 'board'); localStorage.setItem('clique.tasks.done', '0')")
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
        const added = await js(win, 'return Math.max(...window.__cliqueState.tasks.tickets.map((t) => t.id))')
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
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await sleep(300)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + 40), width: Math.round(r.width) + 80, height: Math.round(r.height - 200) }")
    const step = (code) => js(win, `const s = window.__cliqueState; const a = (n) => s.agents.find((x) => x.name === n); ${code}; window.__cliqueEmit('state', s)`)
    await record(win, 'right-of-way', {
      clip: panel, ms: 9500, width: 760,
      during: async () => {
        // before: both at work, nobody waiting
        await step("s.feed.splice(s.feed.findIndex((e) => e.id === 'q1')); Object.assign(a('June'), { waitingOn: [], activity: 'Read · docs/release-1.2.md', since: Date.now() - 60000 }); a('Ada').owes = []")
        await sleep(1200)
        await step("s.feed.push({ id: 'g1', kind: 'msg', from: 'June', to: 'Ada', ask: true, text: 'Which coupon codes can stack in 1.2?', ts: Date.now() }); a('June').waitingOn = [{ name: 'Ada', since: Date.now(), id: 'g1', text: 'Which coupon codes can stack in 1.2?' }]; a('Ada').owes = [{ name: 'June', since: Date.now(), id: 'g1', waiting: true }]")
        await sleep(1400)
        await step("a('Ada').activity = 'Bash · clique answer'")
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
    const win = await dashboard(theme, 'clique', { fixture: 'row' })
    await sleep(900)
    await save(win, `right-of-way-dash-${theme}`)
    win.destroy()
  },
  // Every kind of terminal ribbon at once: live, mirrored from another computer, replaying, offline, ended.
  async ribbons(theme) {
    const win = await dashboard(theme, 'grid', { width: 1920, height: 1080 })
    await sleep(1500)
    await js(win, `
      const s = window.__cliqueState
      const by = (n) => s.agents.find((a) => a.name === n)
      by('Theo').status = 'stopped'
      window.__cliqueBufferDelay = 600000
      by('June').convo = { ...by('June').convo, since: Date.now() }
      window.__cliqueEmit('state', s)`)
    await sleep(900)
    await js(win, "document.querySelector('.terms').scrollTop = 99999")
    await sleep(500)
    await save(win, `ribbons-${theme}`)
    await js(win, `const s = window.__cliqueState; s.agents.find((a) => a.name === '${REX}').status = 'away'; window.__cliqueEmit('state', s)`)
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
        await js(win, "window.__cliqueBufferDelay = 1800; const s = window.__cliqueState; const a = s.agents.find((x) => x.name === 'June'); a.convo = { ...a.convo, since: Date.now() }; window.__cliqueEmit('state', s)")
        await sleep(3000)
      },
    })
    win.destroy()
  },
  // The recipient line: hover the faces for who's who, pick one, and the message box says who it's for.
  async railGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    await js(win, "window.__cliqueEmit('place', { side: 'below', align: 'center' }); window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(800)
    await fitToContent(win)
    await save(win, `chat-below-${theme}`)
    win.destroy()
  },
  // Ada splits her work: two sub-agents start, step through their tools, and finish.
  async subsGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await sleep(300)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + 40), width: Math.round(r.width) + 80, height: Math.round(r.height - 200) }")
    const step = (code) => js(win, `const s = window.__cliqueState; const m = s.agents.find((a) => a.name === 'Ada'); ${code}; window.__cliqueEmit('state', s)`)
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
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    await js(win, "document.hasFocus = () => true; window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    const left = await js(win, "return JSON.stringify(window.__cliqueState.reads.agents)")
    console.log('reads after:', left)
    win.destroy()
  },
  // Reply to a message from its hover toolbar, then the thread follows the answer; Esc leaves it.
  async replyGif() {
    const win = await open('overlay.html', { theme: 'light', width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
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
        await js(win, "const s = window.__cliqueState; const mine = s.feed.findLast((e) => e.from === 'you'); s.feed.push({ id: 'r-ship', kind: 'reply', from: 'Ada', to: 'you', re: mine.id, text: 'Shipped, with a test for three items: 43 passing.', ts: Date.now() }); window.__cliqueEmit('state', s)")
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
    await js(win, "localStorage.setItem('clique.fresh', '0'); window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, "document.querySelector('.feed').scrollTop = 0")
    await sleep(400)
    for (let i = 0; i < 3; i++) {
      await js(win, `const s = window.__cliqueState; s.feed.push({ id: 'late${i}', kind: 'reply', from: 'Ada', to: 'you', text: 'Reply ${i + 1} while you read', ts: Date.now() }); window.__cliqueEmit('state', s)`)
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
    await js(win, `const s = window.__cliqueState; const t0 = Date.now() - 3 * 3600000
      const said = ['Checked the orders table migration.', 'Tests are green on CI.', 'Left a note on the empty cart task.', 'Nudged the product grid spacing a little.']
      s.feed.unshift(...Array.from({ length: 90 }, (_, i) => ({ id: 'old' + i, kind: 'reply', from: ['Ada', 'Milo', 'Iris', 'Theo'][i % 4], to: 'you', text: said[i % 4], ts: t0 + i * 60000 })))
      window.__cliqueEmit('state', s); window.__cliqueEmit('toggle', { open: true, focus: false })`)
    await sleep(900)
    await fitToContent(win)
    await js(win, "document.querySelector('#m-old60').scrollIntoView({ block: 'start' })")
    await sleep(500)
    const panel = await js(win, "const r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }")
    const say = (i, from, text) => js(win, `const s = window.__cliqueState; s.feed.push({ id: 'late${i}', kind: 'reply', from: '${from}', to: 'you', text: ${JSON.stringify(text)}, ts: Date.now() }); window.__cliqueEmit('state', s)`)
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
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, "document.querySelector('#m-f8 details summary').click()")
    await sleep(400)
    await js(win, "document.querySelector('#m-f8').scrollIntoView({ block: 'end' }); document.querySelector('.feed').scrollTop += 12")
    await sleep(400)
    await save(win, `subs-reply-${theme}`)
    win.destroy()
  },
  // @ in the message box: the clique pops up, filtered as you type.
  async mention(theme) {
    const win = await open('overlay.html', { theme, width: 520, height: 700, backdrop: 'desktop' })
    await sleep(400)
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(win)
    await js(win, click('.item.said .face[data-agent="Ada"]'))
    await sleep(900)
    await save(win, `convo-${theme}`)
    win.destroy()
  },
  // The same in the dashboard's chat column.
  async convoDash(theme) {
    const win = await dashboard(theme, 'clique')
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
    await js(win, "localStorage.setItem('clique.fresh', '0'); window.__cliqueEmit('toggle', { open: true, focus: false })")
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
        await js(win, "const s = window.__cliqueState; const mine = s.feed.findLast((e) => e.from === 'you'); s.feed.push({ id: 'cv-r', kind: 'reply', from: 'Ada', to: 'you', re: mine.id, text: 'Re-ran it: **43 passing**. Sent @Milo the numbers.', ts: Date.now() }); window.__cliqueEmit('state', s)")
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
    const win = await dashboard(theme, 'clique')
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
    const win = await dashboard('light', 'clique')
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
    const win = await dashboard(theme, 'clique', { fixture: 'clones' })
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
    await js(win, "const s = window.__cliqueState; s.agents = s.agents.filter((a) => !a.cloneOf); window.__cliqueEmit('state', s); window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    const win = await dashboard(theme, 'clique')
    await sleep(600)
    await tap(win, await center(win, '.chat .mic'))
    await sleep(2600)
    await save(win, `voice-${theme}`)
    win.destroy()
  },
  // The Cards/Stats switch: the header must not move.
  async tabsGif() {
    const win = await dashboard('light', 'clique')
    await js(win, click('[data-mode=cards]'))
    await sleep(900)
    const head = await js(win, "const r = document.querySelector('.page-head[data-for=clique]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height + 230) }")
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
    const win = await dashboard('light', 'chat', { fixture: 'big', reset: ['clique.folds'] })
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
    const win = await dashboard('light', 'clique', { reset: ['clique.folds'] })
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
    const win = await dashboard('light', 'clique')
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
    const win = await dashboard('light', 'clique')
    await js(win, click('[data-mode=cards]'))
    await sleep(1400)
    const box = await js(win, "const h = document.querySelector('.page-head[data-for=clique]').getBoundingClientRect(); const g = document.querySelector('.col-grid').getBoundingClientRect(); return { x: Math.round(h.x), y: Math.round(h.y), width: Math.round(h.width), height: Math.round(Math.min(innerHeight - h.y, g.bottom - h.y)) }")
    let at = { x: box.x + box.width / 2, y: box.y + 60 }
    const flip = async (name) => {
      at = await glide(win, at, await center(win, `.pcard[data-name="${name}"] .switch`), 600)
      await sleep(250)
      await tap(win, at)
    }
    await record(win, 'clique-switch', {
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
  // Nobody yet, and no tasks yet: the empty CLIque view and the empty board.
  async empty(theme) {
    for (const [name, view, code] of [['empty-clique', 'clique', 's.agents = []; s.feed = []'], ['empty-tasks', 'tasks', 's.tasks = { ...s.tasks, tickets: [] }']]) {
      const win = await dashboard(theme, view)
      await sleep(700)
      await js(win, `const s = window.__cliqueState; ${code}; window.__cliqueEmit('state', s)`)
      await sleep(1300)
      await js(win, "for (const a of document.getAnimations()) { try { const t = a.effect?.getTiming?.(); if (t && t.iterations !== Infinity) a.finish(); else { a.pause(); a.currentTime = 0 } } catch {} }")
      await sleep(200)
      await save(win, `${name}-${theme}`)
      win.destroy()
    }
  },
  // A clique of 24 on three computers: every view has to hold up with many agents.
  async big(theme) {
    for (const view of ['clique', 'tasks', 'grid']) {
      const win = await dashboard(theme, view, { fixture: 'big', reset: ['clique.collection'] })
      await sleep(1400)
      await save(win, `big-${view}-${theme}`)
      win.destroy()
    }
    const chat = await open('overlay.html', { theme, width: 520, height: 900, backdrop: 'desktop', fixture: 'big' })
    await sleep(400)
    await js(chat, "window.__cliqueEmit('toggle', { open: true, focus: false })")
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
    const win = await dashboard('light', 'clique')
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
    await js(win, "window.__cliqueEmit('state', (window.__cliqueShow('storefront-2'), window.__cliqueState))")
    await sleep(900)
    await save(win, `hosted-on-screen-${theme}`)
    await js(win, "window.__cliqueEmit('state', (window.__cliqueShow('notes'), window.__cliqueState))")
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
    await js(win, "await clique.call('workspace', 'create', null, { name: 'Checkout', icon: '🛒', color: 'teal', members: ['Ada', 'Iris'] }); const s = window.__cliqueState; s.feed = []; s.agents = s.agents.map((a) => ({ ...a, status: 'idle', activity: '', subs: [], unread: 0 })); window.__cliqueEmit('state', s)")
    await sleep(900)
    await save(win, `ws-welcome-${theme}`)
    await js(win, "window.__cliqueEmit('state', (window.__cliqueShow('research'), window.__cliqueState))")
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
    await js(chat, "window.__cliqueEmit('toggle', { open: true, focus: false })")
    await sleep(700)
    await fitToContent(chat)
    await save(chat, `ws-chat-${theme}`)
    chat.destroy()
  },
}

async function dashboard(theme, view, { width = WIN_W, height = WIN_H, fixture, reset = [], cache } = {}) {
  const win = await open('dashboard.html', { theme, width, height, fixture, cache })
  // the places: chat (a channel), clique (Agents), tasks, terminals, usage; grid and focus are Terminals laid out that way
  const place = { grid: 'terminals', focus: 'terminals' }[view] ?? view
  const layout = view === 'focus' ? 'focus' : view === 'grid' ? 'grid' : null
  await js(win, `localStorage.setItem('clique.place', '${place}'); ${layout ? `localStorage.setItem('clique.layout', '${layout}');` : ''} localStorage.setItem('clique.target', 'auto'); localStorage.removeItem('clique.edTab'); for (const k of Object.keys(localStorage)) if (k.startsWith('clique.channel.')) localStorage.removeItem(k); ${reset.map((k) => `localStorage.removeItem('${k}');`).join(' ')}`)
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
  serveSandbox(protocol, [path.join(tmp, 'files', 'attachments')]) // the page in the files shot runs in the real sandbox
  // ...and the linked computer's recording in it plays through the real scheme, from the cache; what the page asks about
  // a file (scripts/screenshot-preload.cjs ?cache=) is answered as for one that's here
  serveFiles(protocol, { dirs: [path.join(tmp, 'files', 'attachments'), FILES_CACHE], files: null })
  ipcMain.handle('files', (_e, action, file) => ({ ok: action === 'fileState' ? { here: fs.existsSync(file), computer: LINK.name } : true }))
  // A shot that no longer finds its way around the app mustn't cost every shot after it: it's named, the rest go on,
  // and the run ends with an error so it doesn't pass for a full set.
  const broken = []
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(name)) continue
    try {
      if (name.endsWith('Gif')) await fn()
      else for (const theme of ['light', 'dark']) await fn(theme)
    } catch (e) {
      broken.push(name)
      console.error(`${name}: ${e?.stack ?? e}`)
      for (const win of BrowserWindow.getAllWindows()) win.destroy()
      stageWin = null
    }
  }
  if (broken.length) console.error(`\n${broken.length} shot${broken.length === 1 ? '' : 's'} didn't finish: ${broken.join(', ')}`)
  fs.rmSync(tmp, { recursive: true, force: true })
  app.exit(broken.length ? 1 : 0)
})

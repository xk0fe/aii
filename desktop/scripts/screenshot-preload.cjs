// Preload for scripts/screenshots.mjs: a fake window.clique with a made-up clique, so every view can be rendered and
// captured without starting any agents or touching ~/.clique. The clique is the neutral demo one: seven agents building a
// small online shop (Storefront), on two computers, with two phones paired.
const now = Date.now()
const min = 60000
// Every window starts on everyone's chat: the composer's target is the conversation it shows, and windows in one
// run share localStorage, so one shot's conversation would otherwise open in the next.
try {
  localStorage.removeItem('clique.target')
} catch {}
const day = 24 * 60 * min

// ?fixture=big | row | clones | workspaces picks one of the variations below. ?platform=win32: the pages as Windows
// shows them (Ctrl for ⌘, "this PC", paths with drive letters, the titlebar with room for the window buttons), rendered
// on a Mac. ?dev=1: as when CLIque runs from source (npm run dev), with the developer's extras.
// Nobody's there to answer a confirm: a shot that closes a sheet with changes in it ("Discard your changes?") would wait
// on a dialog in a hidden window for good. Here every confirm is a yes.
window.confirm = () => true
const QUERY = new URLSearchParams(location.search)
const FIXTURE = QUERY.get('fixture')
const BIG = FIXTURE === 'big'
const PLATFORM = QUERY.get('platform') === 'win32' ? 'win32' : 'darwin'
const HOME = PLATFORM === 'win32' ? 'C:\\Users\\you' : '/Users/you'
// Paths are written here as a Mac's; on a Windows computer they're under C:\Users\you, with backslashes.
const pathOn = (home) => (p) => (p && home.includes('\\') ? p.replace(/^\/Users\/you/, home).replace(/\//g, '\\') : p)
const here = pathOn(HOME)

// The two computers: Studio (a Mac) and Workstation (a Windows PC). On a Mac this one is Studio and Workstation is
// linked to it; on Windows the other way round. Rex and Noor run on the linked one.
const STUDIO = { slug: 'studio', name: 'Studio', home: '/Users/you', address: '192.168.1.20' }
const WORKSTATION = { slug: 'workstation', name: 'Workstation', home: 'C:\\Users\\you', address: '192.168.1.21' }
const [HERE, LINK] = PLATFORM === 'win32' ? [WORKSTATION, STUDIO] : [STUDIO, WORKSTATION]
const onLink = pathOn(LINK.home)
const REX = `Rex@${LINK.slug}`
const NOOR = `Noor@${LINK.slug}`

const days = (counts) => counts.map((tasks, i) => ({ day: new Date(now - (counts.length - 1 - i) * day).toISOString().slice(0, 10), tasks }))
const stats = (tasks, fromYou, activeMin, avgTurnS, tools, handoffs, waits, queueS, spark) => ({
  tasks, fromYou, fromTeam: tasks - fromYou, turns: tasks, activeMs: activeMin * min, avgTurnMs: avgTurnS * 1000, tools, handoffs,
  waits, waitMs: waits * 95000, avgQueueMs: queueS * 1000, first: now - 12 * day, last: now - 4 * min, days: days(spark),
})

const AGENTS = [
  { name: 'Ada', area: 'Backend developer', provider: 'claude', model: 'opus', effort: 'high', status: 'working', since: now - 3 * min, activity: 'Edit api/orders.ts', stats: stats(48, 31, 412, 312, 940, 12, 3, 41, [2, 4, 3, 0, 5, 6, 2, 4, 7, 3, 1, 5, 4, 2]), avatar: { body: 'blob', color: 'mint', eyes: 'dot', mouth: 'none', hat: 'glasses', cheeks: false } },
  { name: 'Milo', area: 'Frontend developer', provider: 'claude', model: 'sonnet', effort: 'medium', yolo: true, status: 'waiting', since: now - 2 * min, activity: 'Bash: npm run build', stats: stats(39, 22, 377, 402, 811, 9, 5, 64, [1, 3, 2, 4, 0, 3, 5, 2, 3, 4, 2, 6, 3, 1]), avatar: { body: 'cat', color: 'sky', eyes: 'happy', mouth: 'cat', hat: 'party', cheeks: true } },
  { name: 'Iris', area: 'Product designer', provider: 'claude', model: 'opus', effort: 'high', status: 'waiting', since: now - 5 * min, stats: stats(11, 9, 96, 523, 214, 4, 6, 22, [0, 0, 1, 0, 2, 1, 0, 0, 3, 1, 0, 2, 1, 0]), avatar: { body: 'heart', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'flower', cheeks: true } },
  { name: 'Theo', area: 'Tester', provider: 'codex', model: '', effort: 'high', clones: 2, status: 'working', since: now - 12 * min, activity: 'Bash: npm test -- checkout', stats: stats(17, 12, 141, 488, 160, 2, 0, 140, [0, 1, 2, 0, 1, 3, 0, 2, 1, 2, 0, 1, 3, 1]), avatar: { body: 'frog', color: 'lime', eyes: 'googly', mouth: 'grin', hat: 'none', cheeks: false } },
  { name: 'June', area: 'Writer, docs and release notes', provider: 'codex', model: '', effort: 'medium', fast: false, status: 'idle', since: now - 30 * min, stats: stats(26, 14, 120, 210, 300, 21, 1, 30, [3, 1, 2, 2, 4, 1, 0, 3, 2, 1, 2, 3, 1, 1]), avatar: { body: 'bunny', color: 'peach', eyes: 'happy', mouth: 'smile', hat: 'bow', cheeks: true } },
  // Rex and Noor run on the linked computer: their terminals are mirrors streamed over CLIque Link
  { name: REX, seed: 'Rex', home: LINK.slug, homeName: LINK.name, area: 'Ops, builds and deploys', provider: 'claude', model: 'sonnet', effort: 'medium', fast: true, status: 'starting', since: now - 2000, stats: stats(9, 5, 70, 300, 120, 1, 1, 20, [0, 1, 0, 2, 1, 0, 1, 0, 2, 1, 0, 1, 0, 0]), avatar: { body: 'mochi', color: 'yellow', eyes: 'dot', mouth: 'smile', hat: 'headphones', cheeks: true } },
  { name: NOOR, seed: 'Noor', home: LINK.slug, homeName: LINK.name, area: 'Reviewer', provider: 'codex', model: '', effort: 'high', status: 'off', on: false, stats: stats(4, 4, 18, 270, 40, 0, 1, 12, [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0]), avatar: { body: 'drop', color: 'purple', eyes: 'googly', mouth: 'cat', hat: 'beret', cheeks: false } },
].map((a) => ({ on: true, queue: 0, clones: 0, activity: '', pending: false, args: '', cwd: '~/Projects/storefront', prompt: '', images: [], ...a }))

// What each one's work has cost: Claude agents in dollars (from Claude Code's status line), Codex agents in tokens.
const SPENT = { Ada: [18.4, 0, 1240, 380], Milo: [12.6, 0, 860, 240], Iris: [9.2, 0, 310, 90], Theo: [0, 1.6e6, 420, 120], June: [0, 0.6e6, 180, 40], [REX]: [3.1, 0, 140, 30], [NOOR]: [0, 0.2e6, 20, 6] }
for (const a of AGENTS) {
  const [cost, tokens, added, removed] = SPENT[a.name] ?? [0, 0, 0, 0]
  Object.assign(a.stats, { cost, tokens, costToday: cost * 0.18, costPerTask: a.stats.tasks && cost ? cost / a.stats.tasks : 0, linesAdded: added, linesRemoved: removed, apiMs: cost * 52000 })
}

// ?fixture=clones: Theo can clone itself, and its clones took the two tasks that would wait in its queue.
const cloneOf = (base, n, extra) => ({ ...base, name: `${base.name}.${n}`, cloneOf: base.name, clone: n, clones: 0, avatar: { seed: base.name, ...base.avatar }, queue: 0, ...extra })
if (FIXTURE === 'clones') {
  const theo = AGENTS.find((a) => a.name === 'Theo')
  AGENTS.splice(AGENTS.indexOf(theo) + 1, 0,
    cloneOf(theo, 2, { status: 'working', since: now - 4 * min, activity: 'Bash: npx playwright test cart' }),
    cloneOf(theo, 3, { status: 'working', since: now - 1 * min, activity: 'Read tests/coupon.spec.ts' }))
}

// How full each conversation is (the context gauges) and which task each fixer's conversation is about.
const convo = (tasks, pct, size, extra = {}) => ({ since: now - (40 + tasks * 9) * min, tasks, compactions: 0, context: { pct, size, used: Math.round((pct / 100) * size) }, ...extra })
const CONVOS = {
  Ada: [convo(9, 41, 1000000), 7],
  Milo: [convo(14, 86, 200000, { compactions: 1 }), null],
  Iris: [convo(6, 38, 200000), null],
  Theo: [convo(4, 23, 258400), 6],
  June: [convo(11, 58, 258400), null],
  'Theo.2': [convo(1, 9, 258400), null],
  'Theo.3': [convo(1, 4, 258400), null],
  [REX]: [{ since: now - 3000, tasks: 0, compactions: 0 }, null],
}
for (const a of AGENTS) [a.convo, a.ticket] = CONVOS[a.name] ?? [null, null]
// sub-agents at work: Ada has two going
AGENTS[0].subs = [
  { id: 's1', type: 'Explore', description: 'Find every place totals are computed', started: now - 50000, ended: null, tools: 7, activity: 'Grep · roundTotal' },
  { id: 's2', type: 'general-purpose', description: 'Run the test suite', started: now - 21000, ended: null, tools: 2, activity: 'Bash · npm test' },
]
// Ada's 1M window is held to 250k: the hub reports its numbers against the limit (core/context.js againstLimit)
Object.assign(AGENTS[0], { contextLimit: 250000, onContextLimit: 'fresh' })
AGENTS[0].convo.context = { used: 160000, size: 250000, window: 1000000, limit: 250000, pct: 64 }

// ?fixture=big: a clique of 24 on three computers (Workstation linked and online, the Laptop asleep), for checking
// how every view holds up with many agents.
if (BIG) {
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1)
  const more = [
    ['Nova', 'Android client, Kotlin and Compose', 'claude', 'sonnet', 'high', 'working', 'Edit app/src/main/ShopScreen.kt', { body: 'cat', color: 'mint', eyes: 'sparkle', mouth: 'cat', hat: 'none', cheeks: true }],
    ['Kai', 'CI, build pipelines and release tooling', 'codex', '', 'medium', 'idle', '', { body: 'bean', color: 'orange', eyes: 'dot', mouth: 'grin', hat: 'party', cheeks: false }],
    ['Lena', 'help center articles and FAQs', 'claude', 'haiku', 'low', 'idle', '', { body: 'bunny', color: 'lilac', eyes: 'happy', mouth: 'smile', hat: 'bow', cheeks: true }],
    ['Otto', 'performance profiling and page speed', 'claude', 'opus', 'high', 'working', 'Bash: npx lighthouse http://localhost:3000', { body: 'frog', color: 'teal', eyes: 'googly', mouth: 'grin', hat: 'none', cheeks: false }],
    ['Pia', 'localization: 14 languages, string freezes', 'codex', '', 'low', 'off', '', { body: 'heart', color: 'red', eyes: 'dot', mouth: 'smile', hat: 'none', cheeks: true }],
    ['Sam', 'security review, auth and secrets', 'claude', 'opus', 'xhigh', 'waiting', 'Bash: gitleaks detect', { body: 'blob', color: 'blue', eyes: 'line', mouth: 'none', hat: 'glasses', cheeks: false }],
    ['Sol', 'data pipelines and the analytics warehouse', 'codex', '', 'high', 'off', '', { body: 'drop', color: 'sky', eyes: 'sleepy', mouth: 'smile', hat: 'none', cheeks: false }],
    ['Wren', 'accessibility checks and screen readers', 'claude', 'sonnet', 'medium', 'idle', '', { body: 'mochi', color: 'peach', eyes: 'sparkle', mouth: 'cat', hat: 'sprout', cheeks: true }],
  ].map(([name, area, provider, model, effort, status, activity, avatar]) => ({ name, area: capital(area), provider, model, effort, status, activity, avatar }))
  const remote = (home, homeName) => ([seed, area, provider, model, effort, status, activity, avatar]) => ({ name: `${seed}@${home}`, seed, home, homeName, area: capital(area), provider, model, effort, status, activity, avatar })
  const linked = [
    ['Bo', 'desktop builds and the installers', 'claude', 'sonnet', 'medium', 'working', 'Bash: npm run dist', { body: 'mochi', color: 'teal', eyes: 'dot', mouth: 'smile', hat: 'headphones', cheeks: false }],
    ['Fin', 'store screenshots and listings', 'codex', '', 'medium', 'idle', '', { body: 'cat', color: 'yellow', eyes: 'happy', mouth: 'cat', hat: 'none', cheeks: true }],
    ['Ivy', 'release manager, keeps the train on time', 'claude', 'opus', 'medium', 'waiting', '', { body: 'bunny', color: 'lilac', eyes: 'sparkle', mouth: 'smile', hat: 'flower', cheeks: true }],
    ['Max', 'load tests against staging', 'codex', '', 'high', 'working', 'Bash: k6 run soak.js', { body: 'blob', color: 'red', eyes: 'googly', mouth: 'grin', hat: 'sprout', cheeks: false }],
    ['Uma', 'backend API, Postgres and queues', 'claude', 'opus', 'high', 'idle', '', { body: 'bean', color: 'purple', eyes: 'dot', mouth: 'smile', hat: 'none', cheeks: true }],
    ['Zed', 'analytics dashboards', 'claude', 'haiku', 'low', 'off', '', { body: 'drop', color: 'mint', eyes: 'line', mouth: 'none', hat: 'none', cheeks: false }],
  ].map(remote(LINK.slug, LINK.name))
  const laptop = [
    ['Mo', 'design assets and icon sets', 'claude', 'sonnet', 'medium', 'idle', '', { body: 'heart', color: 'orange', eyes: 'sparkle', mouth: 'cat', hat: 'beret', cheeks: true }],
    ['Tess', 'marketing copy and the website', 'claude', 'haiku', 'medium', 'idle', '', { body: 'mochi', color: 'pink', eyes: 'happy', mouth: 'smile', hat: 'bow', cheeks: true }],
    ['Vic', 'quick prototypes', 'codex', '', 'medium', 'idle', '', { body: 'frog', color: 'sky', eyes: 'dot', mouth: 'grin', hat: 'crown', cheeks: false }],
  ].map(remote('laptop', 'Laptop')).map((a) => ({ ...a, status: 'away' }))
  const spark = (n) => Array.from({ length: 14 }, (_, i) => (i * 7 + n) % 4)
  for (const [i, a] of [...more, ...linked, ...laptop].entries()) {
    AGENTS.push({
      on: a.status !== 'off', queue: a.name === 'Nova' ? 1 : 0, clones: 0, pending: false, args: '', cwd: '~/Projects/storefront', prompt: '', images: [], yolo: i % 3 === 0, fast: a.provider === 'codex' ? i % 2 === 0 : undefined,
      since: now - (2 + i) * min, stats: stats(3 + i * 2, 2 + i, 20 + i * 9, 200 + i * 20, 30 + i * 12, i % 4, i % 3, 10 + i * 3, spark(i)),
      convo: a.status === 'off' ? null : convo(2 + (i % 5), 8 + ((i * 13) % 70), 200000), ticket: null, ...a,
    })
  }
  const big = (n) => AGENTS.find((a) => a.seed === n || a.name === n)
  // Kai finished its turn while a sub-agent keeps working in the background; Bo has booked staging (clique lease)
  big('Kai').subs = [{ id: 's3', type: 'Plan', description: 'Draft the release checklist', started: now - 95000, ended: null, tools: 4, activity: 'Read · docs/release.md' }]
  big('Bo').holds = ['staging']
}

// A made-up shop page for the tasks that come with a screenshot: the cart, empty.
const SHOT = require('path').join(require('os').tmpdir(), 'clique-shots-empty-cart.svg')
require('fs').writeFileSync(SHOT, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="#f6f6f8"/><rect width="320" height="30" fill="#fff"/><rect y="30" width="320" height="1" fill="#e2e2e8"/><rect x="14" y="10" width="56" height="10" rx="5" fill="#2fd3a6"/><rect x="176" y="12" width="30" height="6" rx="3" fill="#d6d6de"/><rect x="214" y="12" width="30" height="6" rx="3" fill="#d6d6de"/><rect x="252" y="12" width="30" height="6" rx="3" fill="#d6d6de"/><path d="M292 10h3l2.5 9h8l2-6.5h-11.5" fill="none" stroke="#6e6e78" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M140 50h8l7 28h24l6-20h-34" fill="none" stroke="#b8b8c2" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="158" cy="86" r="3.5" fill="#b8b8c2"/><circle cx="176" cy="86" r="3.5" fill="#b8b8c2"/><text x="160" y="108" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="bold" fill="#3a3a42" text-anchor="middle">Your cart is empty</text><rect x="120" y="116" width="80" height="18" rx="9" fill="#2f6bff"/><text x="160" y="128.5" font-family="Helvetica, Arial, sans-serif" font-size="8" fill="#fff" text-anchor="middle">Keep shopping</text><g fill="#fff" stroke="#e2e2e8"><rect x="34" y="148" width="72" height="40" rx="6"/><rect x="124" y="148" width="72" height="40" rx="6"/><rect x="214" y="148" width="72" height="40" rx="6"/></g><rect x="40" y="154" width="22" height="22" rx="4" fill="#ffd9c7"/><rect x="130" y="154" width="22" height="22" rx="4" fill="#cdeefe"/><rect x="220" y="154" width="22" height="22" rx="4" fill="#e7dcff"/><g fill="#d6d6de"><rect x="68" y="157" width="30" height="5" rx="2.5"/><rect x="68" y="166" width="20" height="5" rx="2.5"/><rect x="158" y="157" width="30" height="5" rx="2.5"/><rect x="158" y="166" width="20" height="5" rx="2.5"/><rect x="248" y="157" width="30" height="5" rx="2.5"/><rect x="248" y="166" width="20" height="5" rx="2.5"/></g></svg>`)

const log = (...entries) => entries.map(([m, by, text, kind]) => ({ ts: now - m * min, by, text, ...(kind && { kind }) }))
const ticket = (id, status, severity, title, owner, extra = {}) => ({
  id, key: String(id), home: null, kind: 'task', status, severity, title, body: '', owner, fixer: null, by: 'you', images: [], seen: 1, triaged: Boolean(owner),
  created: now - (100 - id * 6) * min, updated: now - (70 - id * 4) * min, log: log([100 - id * 6, 'you', 'added it']), ...extra,
})
// Storefront's board. To do: new, In progress: fixing, Review: check, Done: done.
const TICKETS = [
  ticket(12, 'new', 'high', 'Empty cart state', 'Iris', {
    kind: 'feature',
    body: 'An empty cart shows nothing but the header.\n\n1. Add an item to the cart\n2. Remove it\n3. The cart page is blank under the header\n\nWanted: a friendly line and a way back to the shop. Maybe a few suggestions.',
    images: [SHOT], created: now - 15 * min, updated: now - 14 * min,
    log: log([15, 'you', 'added it'], [14.5, 'June', 'gave it to @Iris, marked it high, updated the details'], [14, 'June', 'The cart page already has a slot for this; see Cart.tsx', 'note']),
  }),
  ticket(11, 'new', 'high', 'Promo banner covers the menu on small screens', 'Milo', { kind: 'bug', seen: 3 }),
  ticket(10, 'new', 'normal', 'Save items for later', null, { kind: 'feature', triaged: false, created: now - 0.4 * min }),
  ticket(9, 'new', 'low', 'Fix the "Adress" typo on the checkout form', 'Milo'),
  ticket(13, 'new', 'normal', 'Write 1.2 release notes', 'June'),
  // Noor is switched off: its task waits for it (no Start until it's back on)
  ticket(14, 'new', 'low', 'Review the payment retry change', NOOR),
  ticket(8, 'new', 'normal', 'Cache product images on the CDN', REX),
  ticket(7, 'fixing', 'high', "Coupon code doesn't apply twice", 'Ada', { kind: 'bug', fixer: 'Ada' }),
  ticket(6, 'fixing', 'normal', 'Flaky checkout test', 'Theo', { kind: 'bug', fixer: 'Theo' }),
  ticket(5, 'check', 'high', 'Dark mode for settings', 'Milo', {
    kind: 'feature',
    fixer: 'Milo', fix: 'Settings follow the system theme now, with a switch under Appearance to pick one. Checked every settings page in light and dark.',
    log: log([60, 'you', 'added it'], [55, 'you', 'sent it to @Milo, in a new conversation'], [12, 'Milo', 'finished it: Settings follow the system theme'], [12, 'Milo', 'The order history page needed its own colors too.', 'note']),
  }),
  ticket(4, 'check', 'normal', 'Totals round wrong with 3 items', 'Ada', { kind: 'bug', fixer: 'Ada', fix: 'Rounding happened per line; now once on the total.' }),
  ticket(3, 'done', 'normal', 'Search spinner never stops', 'Ada', { kind: 'bug', fixer: 'Ada', fix: 'Missing timeout on the search call; added one and an error state.' }),
  ticket(2, 'done', 'low', 'Search keeps spinning', 'Ada', { kind: 'bug', dupOf: 3 }),
  ticket(1, 'done', 'normal', 'Guest checkout', 'Milo', { kind: 'feature', fixer: 'Milo', fix: 'Checkout without an account; it offers one after the order.' }),
  ticket(15, 'done', 'normal', 'Release notes for 1.1', 'June', { fixer: 'June', fix: 'Written up from the merged changes, with a line per fix.', created: now - 3 * day, updated: now - 2 * day }),
]

const t = (m) => now - m * min
const FEED = [
  { id: 'f1', kind: 'msg', from: 'you', to: 'Ada', cc: ['Ada', 'Milo'], sendId: 's1', text: 'The cart and checkout show different totals for the same order. Can you two find where they split?', ts: t(40) },
  { id: 'f2', kind: 'msg', from: 'you', to: 'Milo', cc: ['Ada', 'Milo'], sendId: 's1', text: 'The cart and checkout show different totals for the same order. Can you two find where they split?', ts: t(40) },
  { id: 'f3', kind: 'reply', from: 'Milo', to: 'you', re: 'f2', text: 'Fixed on the page side. The cart reads its total from **the order API** now, so `orderTotal` is the single source of truth.', ts: t(33) },
  { id: 'f3b', kind: 'ask', from: 'Ada', to: 'you', cli: 'claude', re: 'f1', ts: t(31), ask: { type: 'permission', tool: 'Bash', title: 'Run a command', code: 'npm test', always: [] }, answer: { by: 'you', allow: true, always: 'Always allow Bash(npm test:*)', at: t(30.5) } },
  { id: 'f4', kind: 'handoff', from: 'Ada', to: 'Iris', re: 'f1', text: 'Can you check how the totals line reads on narrow screens? It wraps onto two lines.', ts: t(28) },
  { id: 'f5', kind: 'note', from: 'June', text: 'Release notes for 1.2 are due Thursday. @Rex builds the release that morning.', ts: t(25) },
  { id: 'f6', kind: 'handoff', from: 'Iris', to: 'Theo', held: true, text: 'Once the empty cart lands, can you add it to the checkout tests? Empty, one item, and one with a coupon.', ts: t(22) },
  { id: 'f6b', kind: 'handoff', from: 'Milo', to: 'June', text: 'Dark mode for settings is ready for review (#5). The switch lives under Settings, Appearance.', ts: t(20) },
  { id: 'f6c', kind: 'reply', from: 'June', to: 'you', re: 'f6b', ts: t(19), text: "**Release notes for 1.2 are drafted.** Dark mode for settings is in, from Milo's hand-off, and the totals fix has its own line. Rex has the draft for the release page.\n\nWhat's left before 1.2 goes out:\n\n1. Ada finishes the coupon fix (#7), then Theo runs the checkout tests.\n2. You check dark mode in settings (#5).\n3. Rex builds the release and puts it on staging.\n4. Iris signs off the empty cart (#12).\n\nI'll post here when the build is on staging." },
  { id: 'f8', kind: 'reply', from: 'Ada', to: 'you', re: 'f1', subs: [{ type: 'Explore', description: 'Find every place totals are computed', tools: 9, ms: 41000, running: false }, { type: 'general-purpose', description: 'Run the test suite', tools: 3, ms: 64000, running: false }], text: 'The order API agrees too:\n\n| where | total from |\n|---|---|\n| cart | ✓ order API |\n| checkout | ✓ order API |\n\nRan the suite, 42 passing.', ts: t(16) },
  // the task flow in the chat: added, triaged, started in a new conversation, fixed
  { id: 'b1', kind: 'task', type: 'feature', act: 'filed', from: 'you', ticket: 12, title: 'Empty cart state', ts: t(15) },
  { id: 'b2', kind: 'task', type: 'feature', act: 'triaged', from: 'June', ticket: 12, title: 'Empty cart state', text: 'Iris', ts: t(14.5) },
  { id: 'b3', kind: 'event', fresh: true, from: 'Ada', text: 'started a new conversation for #7', ts: t(14) },
  { id: 'b4', kind: 'msg', from: 'you', to: 'Ada', ticket: 7, type: 'bug', title: "Coupon code doesn't apply twice", fresh: true, text: "[bug #7] Coupon code doesn't apply twice", ts: t(13.9) },
  { id: 'b5', kind: 'task', type: 'bug', act: 'fixed', from: 'Ada', ticket: 4, title: 'Totals round wrong with 3 items', text: 'Rounding happened per line; now once on the total.', ts: t(12) },
  { id: 'f10', kind: 'reply', from: 'Theo', to: 'you', text: 'All 48 checkout tests pass on Chrome and Safari.', ts: t(6) },
  { id: 'f11', kind: 'msg', from: 'you', to: 'Iris', text: 'Can you sketch the empty cart?', ts: t(5.5) },
  { id: 'f9', kind: 'ask', from: 'Iris', to: 'you', cli: 'claude', re: 'f11', ts: t(5), ask: { type: 'question', alert: 'asks: Should the empty cart show suggestions?', questions: [
    { question: 'Should the empty cart show suggestions?', header: 'Empty cart', multiSelect: false, options: [{ label: 'Best sellers', description: 'Four popular items under the message' }, { label: 'Recently viewed', description: 'What you looked at last time' }, { label: 'Keep it plain', description: 'Just a line and a way back to the shop' }] }] } },
  { id: 'f7', kind: 'ask', from: 'Milo', to: 'you', cli: 'claude', re: 'f2', ts: t(2), ask: { type: 'permission', tool: 'Bash', title: 'Run a command', code: 'npm run build', detail: 'Build the app to check the settings page', alert: 'wants to run a command',
    always: [{ i: 0, label: 'Always allow Bash(npm run build:*)' }, { i: 1, label: 'Allow all edits this session' }] } },
]
// Channels: #review, whose brief keeps its agents reviewing, and #checkout-launch for three of the clique. Milo's review
// in #review is unread; Theo answered in #checkout-launch and Ada handed on what came of it, which stays there.
const CHANNELS = [
  { id: 'general', name: 'general', brief: '' },
  { id: 'review', name: 'review', brief: "Review only: don't change files, even to fix what you find. Reply with a numbered list of findings, most severe first, each tagged [high], [med] or [low]." },
  { id: 'launch', name: 'checkout-launch', brief: 'Checkout v2 ships Friday from release/2.0. Only fixes for crashes and the launch checklist. Ask before touching payments.', members: ['Ada', 'Milo', 'Theo'] },
]
FEED.push(
  { id: 'v1', kind: 'msg', from: 'you', to: 'Milo', channel: 'review', text: 'Look over the coupon changes in #7 before they go in.', ts: t(11) },
  { id: 'v2', kind: 'reply', from: 'Milo', to: 'you', re: 'v1', channel: 'review', text: '1. **[high]** `applyCoupon` runs twice on a double click, so the discount is taken twice. Guard it with the pending flag.\n2. **[med]** Expired codes fail without a message: the field just clears.\n3. **[low]** `couponCode` and `promo` name the same thing in two files.', ts: t(9) },
  { id: 'l1', kind: 'msg', from: 'you', to: 'Theo', channel: 'launch', auto: true, text: 'Does checkout still pass on Safari with the new payment sheet?', ts: t(8) },
  { id: 'l2', kind: 'reply', from: 'Theo', to: 'you', re: 'l1', channel: 'launch', text: 'Yes: 48 of 48 pass on Safari 18. The payment sheet test needed a longer wait for the frame.', ts: t(7) },
  { id: 'l3', kind: 'handoff', from: 'Ada', to: 'Milo', re: 'l1', channel: 'launch', text: 'The launch checklist says the receipt email needs the new logo. Yours, before Friday.', ts: t(4.5) },
)
FEED.sort((a, b) => a.ts - b.ts)
// Theo's clones each got a message of their own
if (FIXTURE === 'clones') {
  FEED.splice(FEED.findIndex((e) => e.id === 'f11'), 0,
    { id: 'c1', kind: 'msg', from: 'you', to: 'Theo.2', text: 'Run the cart tests on Firefox too', ts: t(4.2) },
    { id: 'c2', kind: 'msg', from: 'you', to: 'Theo.3', text: 'And the coupon tests on a slow network', ts: t(1.1) })
  FEED.sort((a, b) => a.ts - b.ts)
}

const PROVIDERS = {
  // meter: what each one's CLI reports of an agent's use, for the spend check-in (core/providers.js). GLM has none.
  claude: { label: 'Claude', models: ['fable', 'opus', 'sonnet', 'haiku'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], meter: { unit: 'usd', presets: [2, 5, 10, 25] } },
  codex: { label: 'Codex', models: ['gpt-6-luna', 'gpt-6'], efforts: ['low', 'medium', 'high'], fastByDefault: false, meter: { unit: 'tokens', presets: [2e6, 5e6, 10e6, 25e6] } },
  glm: { label: 'GLM', models: ['glm-5'], efforts: [], missing: ['ZAI_API_KEY'] },
}

const ESC = '\x1b['
const TERM = [
  `${ESC}38;5;209m✻${ESC}0m ${ESC}1mWelcome to Claude Code${ESC}0m`,
  '',
  `${ESC}2m  cwd: ~/Projects/storefront${ESC}0m`,
  '',
  `${ESC}1m>${ESC}0m make the cart and checkout agree on the total`,
  '',
  `${ESC}38;5;114m●${ESC}0m Read(api/orders.ts)`,
  `  ⎿  Read 412 lines`,
  `${ESC}38;5;114m●${ESC}0m Update(api/orders.ts)`,
  `  ⎿  Updated api/orders.ts with 6 additions and 2 removals`,
  `${ESC}38;5;111m●${ESC}0m Bash(npm test)`,
  `  ⎿  ${ESC}32m✔ 42 passing${ESC}0m`,
  '',
  `${ESC}38;5;209m✻${ESC}0m Fixing the totals… ${ESC}2m(esc to interrupt)${ESC}0m`,
].join('\r\n')

// Linked computers, as Clique.computers() reports them: what each one runs.
const linked = (slug, name, online) => ({
  spaces: ['storefront'],
  slug, name, online, saved: true, status: online ? { address: LINK.address } : { error: 'unreachable, it reconnects on its own' },
  agents: AGENTS.filter((a) => a.home === slug).map((a) => ({ name: a.name, seed: a.seed, area: a.area, avatar: a.avatar, status: a.status, on: a.on, hidden: false })),
})
// Phones paired with this computer, as Phones.view() reports them (core/phones.js): one connected, one seen yesterday.
const PHONES = {
  devices: [
    { id: 'p1', name: 'iPhone', platform: 'ios', app: '0.1.0', paired: now - 3 * day, seen: now - 2 * min, online: true },
    { id: 'p2', name: 'Pixel', platform: 'android', app: '0.1.0', paired: now - 12 * day, seen: now - day - 3 * 60 * min, online: false },
  ],
  pairing: null,
  error: null,
}
const TAILNET = `${HERE.slug}.example-tailnet.ts.net`
const COMPUTERS = {
  me: { name: HERE.name, slug: HERE.slug, sharing: true, share: true, agents: AGENTS.filter((a) => !a.home && !a.cloneOf).length, port: 7787, code: `clique1.${Buffer.from(JSON.stringify({ name: HERE.name })).toString('base64url')}.k3y`, hosts: [{ address: HERE.address, via: 'Wi-Fi' }, { address: TAILNET, via: 'Tailscale' }] },
  links: [linked(LINK.slug, LINK.name, true), ...(BIG ? [linked('laptop', 'Laptop', false)] : [])],
  phones: PHONES,
  nearby: null, // while Computers is open: the computers on this network with it open too (linkAction 'discover')
  pairing: null,
}
// Nearby, as Clique.nearbyView() reports it: a Mac mini with Computers open. window.__cliqueNearby replaces it ([] for none).
const NEARBY = [{ id: 'n1', name: 'Mac mini', platform: 'darwin', agents: 5 }]
// CLIque Link from the Computers sheet, acted out: Nearby while it's open, linking one (asking, the code, Link on both
// sides, then linked; or window.__cliquePairEnd's way of failing: 'declined', 'blocked'…), answering one asking
// (window.__cliqueAsk() starts one).
function linkAction(op, ...args) {
  const later = (ms, fn) => setTimeout(() => (fn(), emit()), ms)
  if (op === 'discover') COMPUTERS.nearby = args[0] ? (window.__cliqueNearby ?? NEARBY) : null
  if (op === 'discover' && !args[0]) COMPUTERS.pairing = null
  if (op === 'pair') {
    const n = COMPUTERS.nearby?.find((x) => x.id === args[0])
    const out = { id: n.id, name: n.name, stage: 'asking' }
    COMPUTERS.pairing = { out, in: null }
    later(window.__cliquePairDelay ?? 500, () => COMPUTERS.pairing?.out === out && Object.assign(out, window.__cliquePairEnd ? { stage: 'failed', error: window.__cliquePairEnd } : { stage: 'confirm', sas: '4827' }))
  }
  if (op === 'pairConfirm') {
    const out = COMPUTERS.pairing?.out
    out.stage = 'waiting' // until the Mac mini says yes too (window.__cliqueTheyAgree() does)
    if (out.theyAgreed) later(300, () => Object.assign(out, { stage: 'linked', slug: 'mac-mini' }))
  }
  if (op === 'pairCancel' || op === 'pairDone') COMPUTERS.pairing = null
  if (op === 'pairAnswer') {
    const inn = COMPUTERS.pairing?.in
    if (!args[1]) COMPUTERS.pairing = null
    else {
      inn.stage = 'accepted'
      later(400, () => Object.assign(inn, { stage: 'linked', slug: 'mac-mini' }))
    }
  }
  if (op === 'code') return COMPUTERS.me.code
  if (op === 'localNetwork') window.__cliqueOpenedLocalNetwork = (window.__cliqueOpenedLocalNetwork ?? 0) + 1
  emit()
}
// the Mac mini clicking Link on its side: linked if this side did already, or said on screen if not
window.__cliqueTheyAgree = () => {
  const out = COMPUTERS.pairing?.out
  if (out.stage === 'waiting') Object.assign(out, { stage: 'linked', slug: 'mac-mini' })
  else out.theyAgreed = true
  emit()
}
window.__cliqueAsk = (name = 'Laptop') => {
  COMPUTERS.pairing = { out: null, in: { id: 'r1', name, sas: '0519', stage: 'ask' } }
  emit()
}
// A pairing code for a phone, with made-up keys (a new secret each time), as a QR code the way main.js draws it (qrSvg).
// window.__cliquePhoneTTL makes codes end sooner than ten minutes, to watch the pairing view renew them.
let codes = 0
function phoneCode() {
  const bytes = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 53 + seed) & 255)).toString('base64url')
  const code = 'cliquephone1.' + Buffer.from(JSON.stringify({ v: 1, id: bytes(16, 1), n: HERE.name, k: bytes(32, 2), s: bytes(32, 3 + codes++), h: [HERE.address, TAILNET], p: 7788 })).toString('base64url')
  const qr = require('qrcode-generator')(0, 'M')
  qr.addData(code)
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
  const expires = Date.now() + (window.__cliquePhoneTTL ?? 10 * min)
  PHONES.pairing = { expires }
  return { code, expires, qr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>` }
}
// Folders each computer has, for moving an agent there (folderInfo / folders in main.js).
// [path, label] as folders() in core/move.js labels them: the agent's own path there, who works where, home.
const FOLDERS = {
  '': [[here('/Users/you/Projects/storefront'), 'same folder as now'], [here('/Users/you/Projects/docs-site'), 'June'], [HOME, 'home folder']],
  [LINK.slug]: [[onLink('/Users/you/Projects/storefront'), 'same folder as now'], [onLink('/Users/you/Projects/deploy'), 'Rex, Noor'], [LINK.home, 'home folder']],
  laptop: [['/Users/you/Projects/storefront', 'same folder as now'], ['/Users/you', 'home folder']],
}
const HOMES = { '': HOME, [LINK.slug]: LINK.home, laptop: '/Users/you' }

// ?fixture=row: right of way (core/hub.js question). June asked Ada something and waits on her answer, which goes
// ahead of her queue; when Ada tried to ask June back, CLIque had her answer first. Earlier: Milo's question came back
// answered, three hand-offs for Milo went in as one turn, Iris left a file to Milo, who was editing it, and a
// declined task went straight to its next owner.
if (FIXTURE === 'row') {
  const agent = (n) => AGENTS.find((a) => a.name === n)
  Object.assign(agent('June'), { status: 'working', since: t(1.4), activity: 'Bash · clique ask Ada', waitingOn: [{ name: 'Ada', since: t(0.8), id: 'q1', text: 'Which coupon codes can stack in 1.2?' }] })
  Object.assign(agent('Ada'), { owes: [{ name: 'June', since: t(0.8), id: 'q1', waiting: true }] })
  Object.assign(agent('Milo'), { status: 'working', since: t(4), activity: 'Edit src/pages/Settings.tsx' })
  Object.assign(agent('Iris'), { status: 'idle', since: t(20), activity: '' })
  Object.assign(agent(REX), { status: 'working', since: t(9), activity: 'Bash: npm run build' })
  FEED.length = 0
  FEED.push(
    { id: 'h1', kind: 'msg', from: 'June', to: 'Milo', text: 'Triaged #9 to you: the checkout form says "Adress".', ts: t(9) },
    { id: 'h2', kind: 'msg', from: REX, to: 'Milo', text: 'Build check on #11: the promo banner covers the menu below 380px.', ts: t(8.8) },
    { id: 'h3', kind: 'msg', from: 'June', to: 'Milo', text: 'Noted both on #11.', ts: t(8.6) },
    { id: 'h4', kind: 'reply', from: 'Milo', to: 'you', re: 'h1', also: ['h2', 'h3'], text: 'Fixed the banner and the typo in one pass. Starting on **#10** next.', ts: t(6.5) },
    { id: 'q0', kind: 'msg', from: 'Milo', to: 'Ada', ask: true, text: 'Does /api/cart still return items as an array?', ts: t(5), answered: { by: 'Ada', at: t(4.2), reply: 'q0r' } },
    { id: 'q0r', kind: 'reply', from: 'Ada', to: 'you', re: 'q0', text: 'Yes: `items: Item[]`, newest last. It pages past 100.', ts: t(4.2) },
    { id: 'r1', kind: 'rule', rule: 'file', from: 'Iris', to: 'Milo', file: 'Settings.tsx', ts: t(3) },
    { id: 'r2', kind: 'rule', rule: 'decline', from: 'Iris', to: 'Milo', ticket: 10, title: 'Save items for later', text: 'Saving items is page and API work, not design', ts: t(2) },
    { id: 'q1', kind: 'msg', from: 'June', to: 'Ada', ask: true, queued: true, text: 'Which coupon codes can stack in 1.2?', ts: t(0.8) },
    { id: 'r3', kind: 'rule', rule: 'loop', from: 'Ada', to: 'June', line: ['June', 'Ada'], ts: t(0.5) },
  )
}

// what you've read: Milo's and Theo's replies, but not Ada's or June's latest
const READS = { since: 0, agents: { Milo: t(30), Theo: t(5) }, channels: { launch: { Theo: t(6) } } }
// The accounts' usage limits: Claude's as the agents' status lines report them (the 5-hour window getting full), and
// Codex's from its session log, with the credits left on it.
const USAGE = {
  // where each is heading at this pace: the 5-hour window runs out before it resets
  claude: { label: 'Claude', at: now, windows: [{ id: 'five_hour', pct: 64, resetsAt: now + 140 * min, pace: { projected: 128, runsOut: now + 66 * min } }, { id: 'seven_day', pct: 38, resetsAt: now + 3.2 * day, pace: { projected: 71, runsOut: null } }] },
  codex: { label: 'Codex', at: now, windows: [{ id: 'seven_day', pct: 5, resetsAt: now + 5.5 * day, pace: { projected: 23, runsOut: null } }], credits: { unlimited: false, balance: 12000 } },
}
// The linked computers' own accounts, which their agents run on (Clique.linkedUsage): Workstation's Claude well into its
// week and its Codex barely used; the asleep Laptop's last word.
COMPUTERS.links[0].usage = {
  claude: { label: 'Claude', at: now, windows: [{ id: 'five_hour', pct: 18, resetsAt: now + 4 * 60 * min, pace: { projected: 40, runsOut: null } }, { id: 'seven_day', pct: 81, resetsAt: now + 1.4 * day, pace: { projected: 96, runsOut: null } }] },
  codex: { label: 'Codex', at: now, windows: [{ id: 'five_hour', pct: 9, resetsAt: now + 3 * 60 * min }, { id: 'seven_day', pct: 22, resetsAt: now + 4 * day }] },
}
if (BIG) COMPUTERS.links[1].usage = { claude: { label: 'Claude', at: now - 3 * 60 * min, windows: [{ id: 'seven_day', pct: 12, resetsAt: now + 6 * day }] } }
// Usage, day by day (core/history.js, as Clique.usageHistory gives it to the Usage view): each computer's rows, one for
// a day, a workspace, an agent, a provider, a model and a folder. This computer: a year of Storefront that grew busier
// (Ada, Milo and Iris on Claude, Theo and June on Codex since the spring), Docs site since the summer, and what you ran
// outside CLIque. The linked computer: Rex and Noor in this computer's Storefront, its own workspaces, its own sessions.
// Weekends are light, a week in August is off, and the numbers are the same every time (a seeded draw), so two shots
// match. ?fixture=usage-reading: the first look at the logs, a third of the way through. ?fixture=big: the Laptop too,
// off, with what it last said.
const USAGE_COLS = ['day', 'ws', 'who', 'provider', 'model', 'dir', 'tokens', 'input', 'output', 'cached', 'written', 'replies', 'messages', 'sessions', 'cost']
function usageHistory() {
  let seed = 20261116
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = new Date(now)
  const SPAN = 371
  // each stream is one agent in one workspace (or what you ran outside CLIque) on one provider, working in one folder:
  // since (days ago it began), base (tokens on a usual day), grow (how much busier it is now), skip (how often it sits a day out)
  const rowsOf = (streams, from = SPAN) => {
    const rows = []
    for (let i = SPAN; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const weekend = d.getDay() === 0 || d.getDay() === 6
      const away = d.getMonth() === 7 && d.getDate() >= 10 && d.getDate() <= 17
      const mood = rnd() // a busy day is busy for everyone
      const spike = rnd()
      for (const s of streams) {
        const dice = rnd()
        const pick = rnd()
        if (away || mood < (weekend ? 0.62 : 0.1) || i > s.since || i > from || dice < s.skip) continue
        const tokens = Math.round(s.base * (1 + s.grow * (1 - i / s.since)) * (weekend ? 0.3 : 1) * (0.25 + 1.5 * mood * mood) * (0.5 + dice) * (spike > 0.96 ? 2.6 : 1) * (i === 0 ? 0.45 : 1))
        const whole = s.models.reduce((n, m) => n + m[1], 0)
        let at = pick * whole
        const model = (s.models.find((m) => (at -= m[1]) < 0) ?? s.models[0])[0]
        const price = s.provider === 'claude' ? 0.354e-6 : 0
        const messages = Math.max(1, Math.round(tokens / 3.2e6 + dice * 3))
        rows.push([key(d), s.ws, s.who, s.provider, model, s.dir, tokens, Math.round(tokens * 0.012), Math.round(tokens * 0.004), Math.round(tokens * 0.964), price ? Math.round(tokens * 0.02) : 0, Math.round(tokens / 3.3e5) + 1, messages, Math.max(1, Math.round(messages / 3.2)), tokens * price])
      }
    }
    return rows
  }
  const P = '/Users/you/Projects'
  const SF = `${HERE.slug}:storefront`
  const DOCS = `${HERE.slug}:docs`
  const THEIR_SF = `${LINK.slug}:storefront`
  const claude = [['claude-opus-5-5', 8], ['claude-sonnet-5-5', 1.6], ['claude-haiku-5-5', 0.25]]
  const sonnet = [['claude-sonnet-5-5', 6], ['claude-haiku-5-5', 1]]
  const codex = [['gpt-6.1-sol', 6], ['gpt-6-luna', 2], ['gpt-5.4-mini', 0.3]]
  const hosted = WORKSPACES.some((w) => w.id === 'storefront-2') // (?fixture=workspaces: the linked computer's Storefront shows here, Ada and Theo in it)
  const mine = rowsOf([
    { ws: SF, who: 'Ada', provider: 'claude', models: claude, dir: here(`${P}/storefront`), base: 1.5e7, grow: 1.6, since: SPAN, skip: 0.12 },
    { ws: SF, who: 'Milo', provider: 'claude', models: sonnet, dir: here(`${P}/storefront-web`), base: 1.0e7, grow: 1.4, since: 330, skip: 0.2 },
    { ws: SF, who: 'Iris', provider: 'claude', models: claude, dir: here(`${P}/storefront`), base: 4e6, grow: 1, since: 250, skip: 0.45 },
    { ws: SF, who: 'Theo', provider: 'codex', models: codex, dir: here(`${P}/storefront/e2e`), base: 9e6, grow: 0.7, since: 197, skip: 0.25 },
    { ws: SF, who: 'June', provider: 'codex', models: codex, dir: here(`${P}/storefront`), base: 2e6, grow: 0.5, since: 150, skip: 0.6 },
    { ws: DOCS, who: 'June', provider: 'codex', models: codex, dir: here(`${P}/docs-site`), base: 5e6, grow: 0.9, since: 180, skip: 0.3 },
    { ws: DOCS, who: 'Iris', provider: 'claude', models: claude, dir: here(`${P}/docs-site`), base: 2.5e6, grow: 1.2, since: 120, skip: 0.5 },
    { ws: DOCS, who: 'Milo', provider: 'claude', models: sonnet, dir: here(`${P}/docs-site/theme`), base: 1.5e6, grow: 1, since: 90, skip: 0.6 },
    ...(hosted ? [{ ws: THEIR_SF, who: 'Ada', provider: 'claude', models: claude, dir: here(`${P}/shop`), base: 2e6, grow: 1, since: 60, skip: 0.5 }, { ws: THEIR_SF, who: 'Theo', provider: 'codex', models: codex, dir: here(`${P}/shop`), base: 1.2e6, grow: 1, since: 45, skip: 0.6 }] : []),
    { ws: '', who: '', provider: 'claude', models: claude, dir: here(`${P}/storefront`), base: 7e6, grow: 0.4, since: SPAN, skip: 0.35 },
    { ws: '', who: '', provider: 'claude', models: claude, dir: here('/Users/you/notes'), base: 1.5e6, grow: 0.2, since: 300, skip: 0.6 },
    { ws: '', who: '', provider: 'codex', models: codex, dir: here(`${P}/docs-site`), base: 3e6, grow: 0.3, since: 197, skip: 0.5 },
  ], FIXTURE === 'usage-reading' ? 34 : SPAN) // (the newest logs are read first: the last weeks are in, the rest still to come)
  const theirs = rowsOf([
    { ws: SF, who: 'Rex', provider: 'claude', models: sonnet, dir: onLink(`${P}/storefront`), base: 6e6, grow: 1.2, since: 140, skip: 0.3 },
    { ws: SF, who: 'Noor', provider: 'codex', models: codex, dir: onLink(`${P}/storefront`), base: 2.5e6, grow: 0.8, since: 100, skip: 0.5 },
    { ws: THEIR_SF, who: 'Kit', provider: 'claude', models: claude, dir: onLink(`${P}/shop`), base: 5e6, grow: 1, since: 200, skip: 0.3 },
    { ws: `${LINK.slug}:api`, who: 'Vera', provider: 'claude', models: claude, dir: onLink(`${P}/api`), base: 3e6, grow: 0.6, since: 160, skip: 0.45 },
    { ws: '', who: '', provider: 'claude', models: claude, dir: onLink(`${P}/api`), base: 2e6, grow: 0.3, since: 220, skip: 0.55 },
  ])
  const firstOf = (rows) => rows[0]?.[0] ?? null
  const looks = (names) => Object.fromEntries(names.map((n) => [n, AGENTS.find((a) => (a.seed ?? a.name) === n)?.avatar]).filter(([, look]) => look))
  const labels = { claude: 'Claude', codex: 'Codex' }
  const reading = FIXTURE === 'usage-reading'
  const computers = [
    { slug: HERE.slug, name: HERE.name, here: true, online: true, at: reading ? 0 : now - 40000, reading: reading ? { done: 3.4e8, total: 1.01e9, files: 640 } : null, first: firstOf(mine), cols: USAGE_COLS, rows: mine, providers: labels, faces: { [SF]: looks(['Ada', 'Milo', 'Iris', 'Theo', 'June']), [DOCS]: looks(['June', 'Iris', 'Milo']) } },
    { slug: LINK.slug, name: LINK.name, online: true, got: now - 95000, at: now - 4 * min, reading: null, first: firstOf(theirs), cols: USAGE_COLS, rows: theirs, providers: labels, faces: { [SF]: looks(['Rex', 'Noor']) } },
  ]
  if (BIG) {
    const laptop = rowsOf([{ ws: 'laptop:notes', who: 'Wren', provider: 'claude', models: sonnet, dir: '/Users/you/Notes', base: 1.2e6, grow: 0.4, since: 120, skip: 0.5 }, { ws: '', who: '', provider: 'claude', models: claude, dir: '/Users/you/Notes', base: 8e5, grow: 0.2, since: 200, skip: 0.6 }])
    computers.push({ slug: 'laptop', name: 'Laptop', online: false, got: now - 3 * 60 * min, at: now - 3 * 60 * min, reading: null, first: firstOf(laptop), cols: USAGE_COLS, rows: laptop, providers: labels, faces: {} })
  }
  // the workspaces the rows name: this computer's as the rail has them, the linked computers' by their own names
  const spaces = {
    [THEIR_SF]: { name: 'Storefront', color: 'orange', icon: null, ownerName: LINK.name },
    [`${LINK.slug}:api`]: { name: 'API', color: 'teal', icon: null, ownerName: LINK.name },
    ...(BIG && { 'laptop:notes': { name: 'Notes', color: 'yellow', icon: null, ownerName: 'Laptop' } }),
  }
  for (const w of WORKSPACES) {
    const theirKey = w.owner && REMOTE.find((r) => r.joined === w.id)?.key
    spaces[theirKey || `${HERE.slug}:${w.id}`] = { name: w.name, color: w.color, icon: w.icon, id: w.id, ...(w.ownerName && { ownerName: w.ownerName }) }
  }
  return { here: state.workspace ? Object.keys(spaces).find((k) => spaces[k].id === state.workspace.id) ?? null : null, computers, spaces }
}
// what the work on a task cost so far
for (const [id, spent] of [[7, { cost: 3.4, tokens: 0, added: 120, removed: 34 }], [5, { cost: 1.31, tokens: 0, added: 42, removed: 18 }], [6, { cost: 0, tokens: 820000, added: 64, removed: 9 }], [3, { cost: 0.86, tokens: 0, added: 21, removed: 4 }]]) Object.assign(TICKETS.find((t) => t.id === id), { spent })
// the clique's spend: today against what's usual by now, and the last week and month
const SPEND = { today: 14.2, usual: 12.8, week: 96, weekBefore: 88, month: 340 }
// The token savers (core/savers.js, which is ESM: required as one), all on but No reports back, and what they counted
// over a couple of weeks, some of it with them all off first
const { SAVERS } = require('../core/savers.js')
const SAVER_STATE = {
  on: Object.fromEntries(SAVERS.map((s) => [s.id, s.id !== 'noReportBack'])), forced: false,
  list: SAVERS.map(({ id, label, about }) => ({ id, label, about })),
  all: {
    since: now - 16 * day,
    savers: {
      coldStart: { on: { n: 7, tokens: 2140000 }, off: { n: 3, tokens: 1020000 } },
      boardNew: { on: { n: 41, tokens: 388000 }, off: {} },
      busyCheck: { on: { n: 29 }, off: {} },
      quickTriage: { on: { n: 12, cost: 0.06, failed: 1 }, off: { n: 4, cost: 1.24 } },
      warmRoute: { on: { n: 9, tokens: 610000 }, off: {} },
      noReportBack: { on: {}, off: { n: 14, tokens: 950000 } },
    },
    modes: { 'coldStart+boardNew+busyCheck+quickTriage+warmRoute': { turns: 612, cost: 61.4, tools: 4100 }, none: { turns: 188, cost: 27.3, tools: 1560 } },
  },
}
SAVER_STATE.week = SAVER_STATE.all
// ?fixture=threads: what agents say to each other, in threads under the message that led to it (core/threads.js). One
// finished (Ada had the last word), one still going (June's at work on it), and one whose question came out to you.
if (FIXTURE === 'threads') {
  FEED.length = 0
  const at = (m) => now - m * min
  const gist = (text) => text.split('\n')[0].split(/(?<=[.!?])\s/)[0]
  const say = (thread, id, m, from, to, text, re, extra = {}) => ({ id, kind: 'msg', from, to, text, ts: at(m), re, thread, gist: gist(text), ...extra })
  const said = (thread, id, m, from, text, re, extra = {}) => ({ id, kind: 'reply', from, text, ts: at(m), re, thread, gist: gist(text), ...extra })
  FEED.push(
    { id: 'c0', kind: 'msg', from: 'you', to: 'Ada', text: 'The coupon field should show the discount before you apply it. Can you get that done?', ts: at(58) },
    say('c0', 'c1', 57.8, 'Ada', 'Milo', 'Build the coupon preview in the checkout form. Show the discount as soon as the code is valid, and keep the Apply button where it is.', 'c0'),
    say('c0', 'c2', 57.8, 'Ada', 'Theo', 'Cover the preview with tests once Milo has it: valid, expired and stacked codes.', 'c0'),
    said('c0', 'c3', 57.6, 'Ada', "Milo's building the preview and Theo's testing it, and I'm adding the endpoint behind it. None of it is verified yet.", 'c0', { out: true }),
    say('c0', 'c4', 49, 'Ada', 'Milo', 'The endpoint is in: GET /api/coupons/preview returns the amount and the reason.\n\nIt rate-limits per cart, so debounce the lookups.', 'c1'),
    said('c0', 'c5', 48.8, 'Ada', "I've told Milo the endpoint is in and that it rate-limits per cart.", 'c1', { echo: 'c4' }),
    say('c0', 'c6', 41, 'Milo', 'Theo', 'Preview is in the form on feat/coupon-preview, ready to test.', 'c2'),
    said('c0', 'c7', 40.8, 'Milo', "I've handed the branch to Theo.", 'c2', { echo: 'c6' }),
    say('c0', 'c8', 33, 'Theo', 'Milo', 'Two failures: stacked codes show the wrong total in the preview.', 'c6'),
    say('c0', 'c9', 27, 'Milo', 'Theo', 'Fixed: stacked codes now apply in order, same as the cart.', 'c8'),
    say('c0', 'c10', 22, 'Theo', 'Ada', 'All 38 checkout tests pass on feat/coupon-preview.', 'c9'),
    said('c0', 'c11', 21, 'Ada', "The coupon preview is done and all 38 checkout tests pass. It's on a branch, and nothing's merged yet.", 'c0', { out: true }),
    { id: 'd0', kind: 'msg', from: 'you', to: 'Rex', text: 'Can the deploy move to Friday?', ts: at(19) },
    say('d0', 'd1', 18.8, REX, 'Theo', 'Is anything in the release blocked on the coupon work?', 'd0', { ask: true }),
    said('d0', 'd2', 18.4, 'Theo', 'Nothing blocks it.', 'd1'),
    said('d0', 'd3', 17, REX, 'Friday works, but the migration has to go first, and that means ten minutes of read-only checkout. Should I run it tonight?', 'd0', { out: true, asks: true }),
    { id: 'e0', kind: 'msg', from: 'you', to: 'Iris', text: 'The empty cart looks sad. Can you and June give it some life?', ts: at(9) },
    say('e0', 'e1', 8.7, 'Iris', 'June', 'Write the empty cart copy: one warm line and a way back to the shop.', 'e0'),
    said('e0', 'e2', 8.5, 'Iris', "I'm redrawing the empty cart, and June is writing its line.", 'e0', { out: true }),
    say('e0', 'e3', 2, 'June', 'Iris', 'First pass is in the doc: three lines to pick from.', 'e1'),
  )
  for (const a of AGENTS) Object.assign(a, { status: 'idle', activity: '', since: now - 30 * min, subs: [] })
  Object.assign(AGENTS.find((a) => a.name === 'June'), { status: 'working', activity: 'Edit docs/empty-cart.md', since: at(1), thread: 'e0' })
  for (const r of Object.keys(READS)) delete READS[r]
  Object.assign(READS, { since: now })
}
// ?fixture=q: Q, the system agent (core/system-agent.js), in the clique. What you send goes to him, and he gets it to
// whoever should do it.
if (FIXTURE === 'q') {
  const at = (m) => now - m * min
  FEED.length = 0
  FEED.push(
    { id: 'o1', kind: 'reply', from: 'q', text: "Hi, I'm Q, the queue in CLIque. Tell me what you need and I'll get it to the right person. You can still @name anyone to talk to them directly.", ts: at(48) },
    { id: 'o2', kind: 'msg', from: 'you', to: 'q', text: "who's on what right now?", ts: at(31) },
    { id: 'o3', kind: 'reply', from: 'q', text: "Ada's on the orders API and Theo's running checkout tests. Everyone else is free.", re: 'o2', ts: at(30.8) },
    { id: 'o4', kind: 'msg', from: 'you', to: 'q', text: 'The empty cart looks sad. Can someone give it some life?', ts: at(12) },
    { id: 'o5', kind: 'msg', from: 'q', to: 'Iris', text: 'The empty cart looks sad, and the user wants it to have some life. Redraw it, and agree a line for it with June.', re: 'o4', ts: at(11.8) },
    { id: 'o6', kind: 'reply', from: 'q', text: "Iris has it, and June's writing a line for it.", re: 'o4', ts: at(11.7) },
    { id: 'o7', kind: 'msg', from: 'you', to: 'June', text: 'and put the coupon change in the release notes', ts: at(3) },
    { id: 'o8', kind: 'reply', from: 'June', text: 'Added under "Checkout".', re: 'o7', ts: at(2) },
  )
  for (const a of AGENTS) Object.assign(a, { status: a.name === 'Iris' ? 'working' : 'idle', activity: a.name === 'Iris' ? 'Edit ui/empty-cart.svg' : '', since: at(9), subs: [] })
  AGENTS.unshift({ on: true, queue: 0, clones: 0, activity: '', pending: false, args: '', cwd: '~/.clique/workspaces/storefront/q', prompt: '', images: [], name: 'q', system: true, shared: false, status: 'idle', since: at(2), provider: 'claude', model: 'sonnet', effort: 'low',
    area: 'Runs the clique: takes what you ask and gets it to the right teammate', avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true }, stats: stats(14, 14, 9, 21, 22, 11, 0, 2, [1, 2, 0, 3, 2, 1, 5]) })
  for (const r of Object.keys(READS)) delete READS[r]
  Object.assign(READS, { since: now })
}
// When CLIque may notify you (core/notify.js): any time, not paused; window.__cliqueNotify({ … }) changes it as the app's
// own action would ({ days, from, to } or { pause }), with `held` as how many are being kept
const notifyCore = require('../core/notify.js')
let notifyPrefs = notifyCore.prefsOf(null)
const notifyState = (held = 0) => ({ ...notifyPrefs, ...notifyCore.quietNow(notifyPrefs), held, morning: notifyCore.morningAfter(notifyPrefs) })
const state = { notify: notifyState(), savers: SAVER_STATE, checkIn: { at: {}, then: 'ask' }, reads: READS, autopilot: true, theme: 'light', providers: PROVIDERS, agents: AGENTS, feed: FEED, channels: CHANNELS, computers: COMPUTERS, usage: USAGE, spend: SPEND, tasks: { tickets: TICKETS, triage: 'June', autofix: false }, schedules: { list: [], repo: true } }
// Whether the computer is kept awake, as main.js says it (core/awake.js makes the line there): while this computer's
// agents work, when that's on.
function awakeOf(enabled) {
  const working = state.agents.filter((a) => !a.home && !a.cloneOf && a.status === 'working').length
  const on = enabled && working > 0
  return { on, reasons: on ? ['working'] : [], enabled, line: on ? `Keeping this ${PLATFORM === 'win32' ? 'PC' : 'Mac'} awake while ${working === 1 ? 'an agent works' : `${working} agents work`}` : '' }
}
state.awake = awakeOf(true)

// Workspaces, as Clique.workspaces() reports them. Storefront has everyone; Docs site is the second. ?fixture=workspaces has Docs site on screen with three of the clique, Storefront
// in the background with two of its clique needing you and a reply you haven't read, and Research parked.
const LOCAL = AGENTS.filter((a) => !a.home && !a.cloneOf)
const faces = (names) => names.map((n) => AGENTS.find((a) => a.name === n)).map((a) => ({ name: a.name, avatar: a.avatar, status: a.status }))
const WORKSPACES = [
  { id: 'storefront', name: 'Storefront', color: 'teal', icon: null, folder: here('/Users/you/Projects/storefront'), parked: false, members: LOCAL.map((a) => ({ name: a.name, folder: '' })), agents: 7, on: 6, working: 2, waiting: 2, unread: 1, faces: faces(['Ada', 'Milo', 'Iris', 'Theo']), needs: [...faces(['Milo']).map((f) => ({ ...f, activity: 'Bash: npm run build' })), ...faces(['Iris'])] },
  { id: 'docs', name: 'Docs site', color: 'sky', icon: null, folder: here('/Users/you/Projects/docs-site'), parked: false, members: [{ name: 'June', folder: '' }, { name: 'Iris', folder: '' }, { name: 'Milo', folder: here('/Users/you/Projects/docs-site/theme') }], agents: 3, on: 3, working: 1, waiting: 0, unread: 0, faces: faces(['June', 'Iris', 'Milo']), needs: [] },
  { id: 'research', name: 'Research', color: 'purple', icon: null, folder: here('/Users/you/Notes/research'), parked: true, members: [{ name: 'June', folder: '' }, { name: 'Theo', folder: '' }], agents: 2, on: 2, working: 0, waiting: 0, unread: 0, faces: faces(['June', 'Theo']), needs: [] },
]
// how the shared agents are doing in the other workspaces (each has its own session there)
const AT = { docs: { June: { status: 'working', since: t(4), activity: 'Edit docs/checkout.md' }, Iris: { status: 'idle', since: t(25), activity: '' }, Milo: { status: 'idle', since: t(40), activity: '' } } }
const EVERY = AGENTS
const show = (id) => {
  for (const w of WORKSPACES) w.current = w.id === id
  state.workspace = WORKSPACES.find((w) => w.current)
  const w = state.workspace
  state.parked = w.parked
  state.agents = id === 'storefront' ? EVERY.map((a) => (a.home ? a : { ...a, shared: true }))
    : EVERY.filter((a) => w.members?.some((m) => m.name === a.name)).map((a) => {
      const folder = w.members.find((m) => m.name === a.name).folder || w.folder
      return { ...a, shared: true, cwd: folder ? folder.replace(HOME, '~') : a.cwd, ...AT[id]?.[a.name], ...(w.parked && { status: 'parked' }) }
    })
}
state.workspaces = WORKSPACES
state.roster = LOCAL.map((a) => ({ name: a.name, area: a.area, avatar: a.avatar, cwd: here(`/Users/you/Projects/${a.name === 'June' ? 'docs-site' : 'storefront'}`) }))
// Linked computers' workspaces, as Clique.remoteWorkspaces() reports them. They show up here on their own (showTheirs):
// the linked computer's Storefront (so there are two Storefronts on the rail, told apart by its computer's mark) and the
// Laptop's Notes (the Laptop is off, so it's dimmed). Its API you hid, so the menu offers to show it again.
const REMOTE = [
  { key: `${LINK.slug}:storefront`, owner: LINK.slug, name: 'Storefront', color: 'orange', icon: null, computer: LINK.slug, computerName: LINK.name, online: true, joined: 'storefront-2' },
  { key: `${LINK.slug}:api`, owner: LINK.slug, name: 'API', color: 'teal', icon: null, computer: LINK.slug, computerName: LINK.name, online: true, joined: null },
  { key: 'laptop:notes', owner: 'laptop', name: 'Notes', color: 'yellow', icon: null, computer: 'laptop', computerName: 'Laptop', online: false, joined: 'notes' },
]
const joined = (r, id, members) => ({ id, name: r.name, color: r.color, icon: r.icon, folder: null, parked: false, owner: r.owner, ownerName: r.computerName, ownerOnline: r.online, members: members.map((name) => ({ name, folder: '' })), agents: members.length, on: members.length, working: 0, waiting: 0, unread: 0, faces: faces(members), needs: [] })
if (FIXTURE === 'workspaces') {
  WORKSPACES.push(joined(REMOTE[0], 'storefront-2', ['Ada', 'Theo']), joined(REMOTE[2], 'notes', ['June']))
  state.remoteWorkspaces = REMOTE
  show('docs')
} else {
  WORKSPACES.splice(2) // the usual clique has Storefront and Docs site
  show('storefront')
}
// ?fixture=first-run: a new install, with Claude Code and Codex ready and no workspace yet: the first-run screen
// (ui/setup.js), where the name folds together and Q says hello.
if (FIXTURE === 'first-run') {
  WORKSPACES.length = 0
  Object.assign(state, { workspace: null, agents: [], feed: [], roster: [] })
  state.setup = { checked: true, ready: true, clis: [{ id: 'claude', name: 'Claude Code', state: 'ready', version: '2.4.0' }, { id: 'codex', name: 'Codex', state: 'ready', version: '0.80.0' }], git: null }
}
window.__cliqueShow = show
// The channels' sheet and menu, as Clique.channelAction does them.
function channelAction(op, id, arg = {}) {
  const slug = (n) => String(n ?? '').toLowerCase().replace(/^#+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (op === 'create') {
    if (!slug(arg.name)) throw new Error('give the channel a name')
    if (CHANNELS.some((c) => c.name === slug(arg.name))) throw new Error(`there's a #${slug(arg.name)} already`)
    id = slug(arg.name)
    CHANNELS.push({ id, name: id, brief: arg.brief ?? '', ...(arg.members?.length && { members: arg.members }) })
  }
  const c = CHANNELS.find((x) => x.id === id)
  if (op === 'edit' && c) Object.assign(c, { brief: arg.brief ?? c.brief, ...(id !== 'general' && 'name' in arg && { name: slug(arg.name) || c.name }), ...(id !== 'general' && 'members' in arg && { members: arg.members?.length ? arg.members : undefined }) })
  if (op === 'remove') CHANNELS.splice(CHANNELS.indexOf(c), 1)
  return { id, state }
}

// The workspace actions, enough for the shots: switch (one asleep wakes, as in CLIque), open, park, make one.
function workspaceAction(op, id, arg) {
  // a new one (?fixture=first-run makes the first): on screen, with Q and nobody else yet
  if (op === 'create') {
    const made = { id: String(arg.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: arg.name, color: arg.color || null, icon: null, folder: here(String(arg.folder ?? '').replace(/^~/, '/Users/you')), parked: false, members: [], agents: 0, on: 0, working: 0, waiting: 0, unread: 0, faces: [], needs: [] }
    WORKSPACES.push(made)
    for (const x of WORKSPACES) x.current = x === made
    Object.assign(state, { workspace: made, parked: false, feed: [], agents: [newAgent({ name: 'q', system: true, area: 'Runs the clique: takes what you ask and gets it to the right teammate', model: 'sonnet', effort: 'low', avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true } })] })
    emit()
    return { state }
  }
  const w = WORKSPACES.find((x) => x.id === id)
  if (op === 'switch') (w.parked = false), window.__cliqueShow(id)
  if (op === 'open') (w.parked = false), window.__cliqueShow(state.workspace.id)
  if (op === 'park') (w.parked = true), window.__cliqueShow(state.workspace.id)
  if (op === 'order') {
    const at = (x) => (arg.includes(x.id) ? arg.indexOf(x.id) : arg.length)
    WORKSPACES.sort((a, b) => at(a) - at(b))
  }
  // who works there: shared agents in and out
  if (op === 'members' && w) {
    for (const name of arg.add ?? []) if (!w.members.some((m) => m.name === name)) w.members.push({ name, folder: '' })
    w.members = w.members.filter((m) => !(arg.remove ?? []).includes(m.name))
    Object.assign(w, { agents: w.members.length, on: w.members.length, faces: faces(w.members.map((m) => m.name)) })
    if (w.current) window.__cliqueShow(id)
  }
  if (op === 'edit' && w) Object.assign(w, arg)
  if (op === 'remove') {
    WORKSPACES.splice(WORKSPACES.indexOf(w), 1)
    for (const r of REMOTE) if (r.joined === id) r.joined = null
    if (w.current) window.__cliqueShow(WORKSPACES[0].id)
  }
  // a linked computer's workspace, here too (Clique.workspaceAction join): its copy, or a new one while its owner is on
  if (op === 'join') {
    const r = REMOTE.find((x) => x.key === id)
    if (!r) throw new Error('no such workspace on your linked computers')
    if (!r.joined) {
      if (!r.online) throw new Error(`${r.computerName} is offline: open its workspaces while it's on`)
      r.joined = r.key.slice(r.key.indexOf(':') + 1)
      WORKSPACES.push(joined(r, r.joined, []))
    }
    id = r.joined
    window.__cliqueShow(id)
  }
  if (op === 'create') {
    id = String(arg.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    // this computer's own go before linked computers' ones, as Clique.workspaceAction create puts them
    const at = WORKSPACES.findIndex((x) => x.owner)
    WORKSPACES.splice(at >= 0 ? at : WORKSPACES.length, 0, { id, name: arg.name, color: arg.color || null, icon: arg.icon || null, folder: arg.folder || null, parked: false, members: (arg.members ?? []).map((name) => ({ name, folder: '' })), agents: arg.members?.length ?? 0, on: arg.members?.length ?? 0, working: 0, waiting: 0, unread: 0, faces: faces(arg.members ?? []) })
    window.__cliqueShow(id)
  }
  emit()
  return { id, state }
}
const emit = () => setTimeout(() => window.__cliqueEmit('state', state), 30)
// The app's own state (main.js stateNow): its version, an update, Open at login. __cliqueUpdate(patch) is what
// core/updates.js would report next (an update ready, say); __cliqueRestartAsk, when set, is the question Restart to
// update asks first (core/updates.js restartWords), as when agents are at work.
const UPDATE = { phase: 'idle', version: '1.0.0', off: null, next: null, progress: 0, later: false, asking: null, stuck: false }
state.app = { version: '1.0.0', update: UPDATE, login: { on: false } }
window.__cliqueUpdate = (patch) => {
  Object.assign(UPDATE, patch)
  window.__cliqueEmit('state', state)
}
function updateAction(op, asked) {
  if (op === 'later') Object.assign(UPDATE, { later: true, asking: null, stuck: false })
  if (op === 'restart' && UPDATE.phase === 'ready') {
    const ask = window.__cliqueRestartAsk
    if (ask && ask.text !== asked) UPDATE.asking = ask
    else Object.assign(UPDATE, { phase: 'restarting', asking: null })
  }
  emit()
}
// Scheduled messages, as Clique.scheduleAction keeps them (core/schedules.js): the list and each one's next time, by
// this computer's clock. `now` sends it, marked as scheduled, the way a run does.
function scheduleAction(op, id, arg = {}) {
  const list = state.schedules.list
  const at = (s, from = Date.now()) => {
    const [y, mo, d] = s.date.split('-').map(Number)
    const [h, mi] = s.time.split(':').map(Number)
    const first = new Date(y, mo - 1, d, h, mi)
    if (s.repeat === 'once') return first.getTime() > from ? first.getTime() : null
    const today = new Date(from)
    for (let i = 0; i < 9; i++) {
      const day = new Date(Math.max(new Date(y, mo - 1, d).getTime(), new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()))
      day.setDate(day.getDate() + i)
      day.setHours(h, mi, 0, 0)
      const ok = s.repeat === 'daily' || (s.repeat === 'weekdays' && day.getDay() >= 1 && day.getDay() <= 5) || (s.repeat === 'weekly' && day.getDay() === first.getDay())
      if (ok && day.getTime() > from) return day.getTime()
    }
    return null
  }
  const s = list.find((x) => x.id === id)
  let same = false
  if (op === 'add' || op === 'edit') {
    const f = { ...(s ?? {}), ...arg }
    if (!String(f.text ?? '').trim()) throw new Error('write the message to send first')
    if (at(f) === null) throw new Error('that time has passed already: pick one that is still to come')
    const key = (x) => JSON.stringify([String(x.text).trim().toLowerCase(), x.to ?? '', x.channel && x.channel !== 'general' ? x.channel : '', x.repeat, x.repeat === 'once' ? x.date : '', x.time])
    const twin = list.find((x) => x !== s && key(x) === key(f))
    if (twin && op === 'edit') throw new Error("there's a schedule just like that already")
    if (twin) (same = true), (id = twin.id)
    else if (s) Object.assign(s, f, { next: at(f) })
    else list.push({ id: (id = `s${list.length + 1}${Date.now() % 1000}`), text: String(f.text).trim(), to: f.to ?? '', ...(f.channel && f.channel !== 'general' && { channel: f.channel }), ...(f.images?.length && { images: f.images }), repeat: f.repeat, date: f.date, time: f.time, ...(f.ifChanged && { ifChanged: true }), by: 'you', created: Date.now(), next: at(f) })
  }
  if (op === 'pause') s.paused = true
  if (op === 'resume') (delete s.paused), (s.next = at(s))
  if (op === 'remove') list.splice(list.indexOf(s), 1)
  if (op === 'now') {
    const names = s.to ? s.to.split(',') : ['Ada']
    for (const n of names) state.feed.push({ id: `sc${Date.now()}${n}`, kind: 'msg', from: 'you', to: n, text: s.text, ts: Date.now(), ...(s.channel && { channel: s.channel }), ...(!s.to && { auto: true }), scheduled: { id: s.id, at: Date.now() } })
    s.last = { at: Date.now(), result: 'sent' }
    if (s.repeat === 'once') list.splice(list.indexOf(s), 1)
  }
  list.sort((a, b) => (a.paused || !a.next ? Infinity : a.next) - (b.paused || !b.next ? Infinity : b.next))
  emit()
  return { id, ...(same && { same }), state }
}
// an agent just made (addAgent, a new workspace's Q): idle, nothing done yet
const newAgent = (fields) => ({ on: true, queue: 0, clones: 0, activity: '', pending: false, args: '', cwd: state.workspace?.folder ?? '', prompt: '', images: [], status: 'idle', since: Date.now(), provider: 'claude', model: '', effort: '', area: '', stats: stats(0, 0, 0, 0, 0, 0, 0, 0, [0, 0, 0, 0, 0, 0, 0]), ...fields })
let nextTask = Math.max(...TICKETS.map((x) => x.id)) + 1
// The clique's names are capitalized (Ada), while the pages match a typed @name in lower case (@ada): find one either way.
const named = (n) => state.agents.find((a) => a.name.toLowerCase() === String(n ?? '').replace(/^@/, '').toLowerCase())
const MENTION = /(^|[^\w.@/'-])@([\w-]+(?:@[\w-]+)?)/g

// Enough of the task actions for the recordings: add, start, accept.
function taskAction(op, key, arg) {
  if (op === 'file') {
    let text = String(arg.text ?? '').trim()
    let owner = arg.owner && (named(arg.owner)?.name ?? arg.owner)
    // an @name the page didn't take as the owner: the hub would
    const m = !owner && [...text.matchAll(MENTION)].find((x) => named(x[2]))
    if (m) (owner = named(m[2]).name), (text = (text.slice(0, m.index) + m[1] + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim())
    owner ??= 'Milo'
    const t = { ...TICKETS.find((x) => x.id === 9), id: nextTask, key: String(nextTask), kind: arg.kind ?? 'task', status: 'new', severity: 'normal', title: text, body: '', owner, triaged: true, seen: 1, images: arg.images ?? [], created: Date.now(), updated: Date.now(), log: [{ ts: Date.now(), by: 'you', text: 'added it' }] }
    TICKETS.push(t)
    FEED.push({ id: `nb${nextTask}`, kind: 'task', type: t.kind, act: 'filed', from: 'you', ticket: nextTask, title: text, owner, ts: Date.now() })
    emit()
    return `added #${nextTask++} for @${owner}`
  }
  // the board's bulk bar: every picked task changes, and the chat gets one line for all of them
  if (op === 'bulk') {
    const { op: what, keys = [], arg: value } = arg
    const list = what === 'clear' ? TICKETS.filter((x) => x.status === 'done') : TICKETS.filter((x) => keys.includes(x.key))
    const n = list.length
    const status = what === 'close' ? 'done' : what === 'start' ? 'fixing' : what === 'move' ? value : null
    if (status) list.forEach((x) => Object.assign(x, { status, updated: Date.now() }, status === 'fixing' && { fixer: x.owner }))
    if (what === 'owner') list.forEach((x) => (x.owner = value || null))
    if (what === 'priority') list.forEach((x) => (x.severity = { urgent: 'blocker', medium: 'normal' }[value] ?? value))
    if (what === 'remove' || what === 'clear') for (const x of list) TICKETS.splice(TICKETS.indexOf(x), 1)
    const text = `${{ close: 'closed', start: 'started', move: 'moved', owner: 'gave', priority: 'changed', remove: 'deleted', clear: 'cleared' }[what]} ${n} task${n === 1 ? '' : 's'}`
    FEED.push({ id: `bk${Date.now()}`, kind: 'task', type: 'task', act: 'bulk', from: 'you', text, count: n, ts: Date.now() })
    emit()
    return `${text}\n`
  }
  const t = TICKETS.find((x) => x.key === key)
  if (!t) return
  const to = (status, extra = {}) => Object.assign(t, { status, updated: Date.now(), ...extra })
  if (op === 'dispatch' || (op === 'move' && arg === 'fixing')) {
    to('fixing', { fixer: t.owner })
    const a = AGENTS.find((x) => x.name === t.owner)
    if (a) Object.assign(a, { ticket: t.id, status: 'starting', since: Date.now(), convo: { since: Date.now(), tasks: 0, compactions: 0, context: { pct: 2, size: 200000, used: 4000 } } })
    setTimeout(() => a && Object.assign(a, { status: 'working', since: Date.now(), activity: 'Read src/pages/Checkout.tsx' }) && emit(), 1400)
  }
  if (op === 'accept' || (op === 'move' && arg === 'done')) to('done')
  if (op === 'move' && arg === 'check') to('check', { fix: t.fix ?? 'Fixed by hand.' })
  if (op === 'move' && arg === 'new') to('new')
  if (op === 'sendBack') to('fixing')
  if (op === 'edit') Object.assign(t, arg, { updated: Date.now() })
  emit()
}

// Enough of send for the recordings: a message for a busy agent that can clone itself starts a clone (core/hub.js).
function sendAction(name, text) {
  const a = named(name)
  const family = state.agents.filter((x) => x === a || x.cloneOf === a.name)
  const free = family.find((x) => x.status === 'idle')
  let target = free ?? a
  let out = `sent to @${target.name}`
  if (!free && a.clones > family.length - 1) {
    let n = 2
    while (state.agents.some((x) => x.name === `${a.name}.${n}`)) n++
    target = cloneOf(a, n, { status: 'starting', since: Date.now(), activity: '', convo: { since: Date.now(), tasks: 0, compactions: 0 } })
    state.agents.splice(state.agents.indexOf(family.at(-1)) + 1, 0, target)
    out = `@${a.name} is busy, so a clone, @${target.name}, is starting up to take this`
    setTimeout(() => (Object.assign(target, { status: 'working', since: Date.now(), activity: 'Read tests/cart.spec.ts', convo: { ...target.convo, tasks: 1, context: { pct: 3, size: 258400, used: 8000 } } }), emit()), 1300)
  }
  FEED.push({ id: `s${Date.now()}`, kind: 'msg', from: 'you', to: target.name, text, ts: Date.now() })
  emit()
  return out
}

const listeners = { state: [], focus: [], toggle: [], voice: [], place: [] }

// Dictation without a microphone: a wobbling tone stands in for your voice (it only moves the meter), and a
// scripted transcript arrives word by word. Nothing here ever opens a real microphone.
const SPOKEN = 'Hey Ada, can you look at why the build is failing on main? Then hand it to Milo.'.split(' ')
let dictation = null
navigator.mediaDevices.getUserMedia = async () => {
  const ctx = new AudioContext()
  const voice = ctx.createOscillator()
  const wobble = ctx.createOscillator()
  const depth = ctx.createGain()
  const gain = ctx.createGain()
  const out = ctx.createMediaStreamDestination()
  voice.frequency.value = 180
  wobble.frequency.value = 2.5
  depth.gain.value = 0.04
  gain.gain.value = 0.04
  wobble.connect(depth).connect(gain.gain)
  voice.connect(gain).connect(out)
  voice.start()
  wobble.start()
  return out.stream
}
function voiceCall(action) {
  const emit = (e) => listeners.voice.forEach((fn) => fn({ id: 1, ...e }))
  if (action === 'voiceLocales') return [{ id: 'en_US', label: 'English', installed: true }, { id: 'de_DE', label: 'Deutsch', installed: true }]
  if (action === 'voiceStart') {
    let n = 0
    setTimeout(() => emit({ type: 'ready', locale: 'en_US' }), 150)
    dictation = setInterval(() => {
      n = Math.min(SPOKEN.length, n + 1)
      emit({ type: 'text', final: SPOKEN.slice(0, Math.max(0, n - 3)).join(' '), volatile: SPOKEN.slice(Math.max(0, n - 3), n).join(' ') })
    }, 230)
    return 1
  }
  if (action === 'voiceStop') {
    clearInterval(dictation)
    setTimeout(() => emit({ type: 'done', text: SPOKEN.join(' ') }), 250)
  }
}
window.__cliqueFit = null
// like the hub's snapshot: an agent in a turn (at work, or waiting on you mid-turn, not on whether to trust its folder)
// can be stopped
const canStop = (s) => {
  for (const a of s?.agents ?? []) {
    const trust = (s.feed ?? []).some((e) => e.kind === 'ask' && e.from === a.name && e.ask?.trust && !e.answer)
    if (a.on !== false && (a.status === 'working' || a.status === 'waiting') && !trust && !a.oldClique) a.canStop = true
    else delete a.canStop
  }
  return s
}
window.__cliqueEmit = (channel, ...args) => {
  if (channel === 'state') canStop(args[0])
  listeners[channel]?.forEach((fn) => fn(...args))
}
window.__cliqueState = state
window.__cliqueNotify = (patch, held = 0) => {
  notifyPrefs = notifyCore.changed(notifyPrefs, patch)
  state.notify = notifyState(held)
  window.__cliqueEmit('state', state)
}
window.__cliqueLooking = null // what the page last said it has open (clique.looking)
window.__cliqueHistory = usageHistory() // what the Usage view asks for (a shot can swap it: nothing yet, a first look)
window.clique = {
  looking: (view) => (window.__cliqueLooking = view),
  platform: PLATFORM,
  home: HOME,
  dev: QUERY.get('dev') === '1',
  call: async (action, ...args) => {
    if (action === 'state') return canStop(state)
    // Stop, as the hub does it: their turns end (they stay on), what waited for them isn't delivered, their open
    // questions close, and one line says who you stopped
    if (action === 'stop') {
      const [names, opts = {}] = args
      const stopped = state.agents.filter((a) => [names].flat().includes(a.name) && a.canStop)
      let dropped = 0
      for (const a of stopped) {
        Object.assign(a, { status: 'idle', since: Date.now(), activity: '', subs: [], queue: 0, waitingOn: [] })
        delete a.thread
        for (const e of state.feed) {
          if (e.kind === 'ask' && e.from === a.name && !e.answer && !e.spend) e.answer = { by: 'you', stopped: true, at: Date.now() }
          if (e.kind === 'msg' && e.to === a.name && e.queued) (Object.assign(e, { queued: false, dropped: true, stopped: true }), (dropped += 1))
        }
      }
      if (!stopped.length) return { stopped: [], dropped: 0 }
      const who = stopped.map((a) => `@${a.name}`)
      const left = dropped ? `. ${dropped === 1 ? "A waiting message wasn't" : `${dropped} waiting messages weren't`} delivered` : ''
      state.feed.push({ id: `stop${Date.now()}`, kind: 'event', from: 'clique', stop: true, about: stopped.map((a) => a.name), ts: Date.now(), text: `you stopped ${who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : who[0]}${left}`, ...(opts.channel && opts.channel !== 'general' && { channel: opts.channel }) })
      emit()
      return { stopped: stopped.map((a) => a.name), dropped }
    }
    if (action === 'history') return window.__cliqueHistory
    // the permissions flow: ?fixture=<a step>:<its state> shows that one first (ui/permissions.js)
    if (action === 'permissions') {
      const [id, state] = (FIXTURE ?? 'notifications:ask').split(':')
      if (args[0] === 'list') return { missing: id === 'none' ? [] : [{ id, state }, { id: 'done', state: 'ask' }, { id: 'more', state: 'ask' }].slice(0, 4), hatch: { width: 185, height: 32 } }
      if (args[0] === 'look') return state
      return undefined
    }
    if (action === 'savers') {
      Object.assign(state.savers.on, args[0])
      emit()
      return state.savers
    }
    if (action === 'notifications') {
      notifyPrefs = notifyCore.changed(notifyPrefs, args[0])
      state.notify = notifyState(state.notify.held)
      emit()
      return state.notify
    }
    // the spend check-in, per provider: { at: { claude: 5, codex: null }, then: 'ask' | 'tell' }
    if (action === 'checkIn') {
      const at = { ...state.checkIn.at, ...(args[0].at ?? {}) }
      for (const k of Object.keys(at)) if (!at[k]) delete at[k]
      state.checkIn = { at, then: args[0].then ?? state.checkIn.then }
      emit()
      return state.checkIn
    }
    // stay awake while agents work: on or off
    if (action === 'keepAwake') {
      state.awake = awakeOf(Boolean(args[0]))
      emit()
      return Boolean(args[0])
    }
    // agent tools: off, ask (the default) or auto
    if (action === 'tools') {
      state.tools = args[0]
      emit()
      return args[0]
    }
    // sending from the chat: your message lands in the feed, threaded when it's a reply. Like the hub, an @name in it
    // is who it's for when no one's picked; Auto goes to Ada.
    if (action === 'send') {
      const [picked, text, , opts = {}] = args
      if (state.workspace.parked) workspaceAction('open', state.workspace.id) // what you send wakes it, as in CLIque
      const to = picked || [...new Set([...String(text).matchAll(MENTION)].map((m) => named(m[2])?.name).filter(Boolean))].join(',')
      // a busy agent that can clone itself: a clone takes it (sendAction)
      if (to && !to.includes(',') && !opts.re && named(to)?.clones) return sendAction(to, text)
      const names = String(to || 'Ada').split(',').filter(Boolean).map((n) => named(n)?.name ?? n)
      const group = names.length > 1 && { cc: names, sendId: `s${Date.now()}` }
      const channel = opts.channel && opts.channel !== 'general' ? opts.channel : opts.re ? state.feed.find((e) => e.id === opts.re)?.channel : undefined
      for (const n of names) state.feed.push({ id: `u${Date.now()}${n}`, kind: 'msg', from: 'you', to: n, text, ts: Date.now(), ...group, ...(opts.thread && { thread: opts.thread, gist: text }), ...(opts.fresh && { fresh: true }), ...(opts.re && { re: opts.re }), ...(channel && { channel }) })
      emit()
      return `sent to ${names.map((n) => `@${n}`).join(' ')}\n`
    }
    // your reaction on a message, on or off (Hub.react)
    if (action === 'react') {
      const [id, emoji] = args
      const e = state.feed.find((x) => x.id === id)
      if (!e) throw new Error("that message isn't in the chat any more")
      const had = (e.reactions ?? []).some((r) => r.by === 'you' && r.emoji === emoji)
      e.reactions = had ? e.reactions.filter((r) => !(r.by === 'you' && r.emoji === emoji)) : [...(e.reactions ?? []), { by: 'you', emoji, at: Date.now() }]
      emit()
      return had ? 'taken off\n' : 'reacted\n'
    }
    if (action === 'read') {
      // like the hub: 'Ada#review' is Ada's replies in #review, 'Ada#general' (or plain 'Ada') #general's
      for (const [key, ts] of Object.entries(args[0] ?? {})) {
        const [n, ch] = key.split('#')
        const book = ch && ch !== 'general' ? ((READS.channels ??= {})[ch] ??= {}) : READS.agents
        book[n] = Math.max(book[n] ?? 0, ts)
      }
      emit()
      return undefined
    }
    // window.__cliqueBufferDelay holds the replay back, so its ribbon can be captured
    if (action === 'buffer') return new Promise((r) => setTimeout(() => r({ data: TERM, cols: 100, rows: 30 }), window.__cliqueBufferDelay ?? 0))
    if (action === 'answer') {
      const [id, reply] = args
      const e = state.feed.find((x) => x.id === id)
      const always = e.ask.always?.find((x) => x.i === reply.always)?.label
      e.answer = reply.terminal ? { by: 'terminal', handedOver: true } : reply.answers ? { by: 'you', answers: Object.fromEntries(Object.entries(reply.answers).map(([k, v]) => [k, [].concat(v).join(', ')])) } : { by: 'you', allow: Boolean(reply.allow), ...(always && { always }), ...(reply.note && { note: reply.note }) }
      const a = state.agents.find((x) => x.name === e.from)
      // a spend check-in (core/hub.js checkIn): what it held goes on, or is dropped, and its agent isn't waiting on it
      if (e.ask.spend) {
        e.answer.used = e.ask.spend.used
        for (const m of state.feed.filter((x) => x.paused === e.ask.spend.group)) Object.assign(m, { paused: false }, reply.allow ? {} : { dropped: true })
      } else if (a && !reply.terminal) Object.assign(a, { status: 'working', since: Date.now() })
      setTimeout(() => window.__cliqueEmit('state', state), 30)
      return undefined
    }
    if (action.startsWith('voice')) return voiceCall(action)
    if (action === 'update') {
      const [names, patch] = args
      for (const a of state.agents.filter((x) => [names].flat().includes(x.name))) {
        if ('yolo' in patch) a.yolo = patch.yolo
        if ('tier' in patch) a.fast = patch.tier === 'fast'
        if ('off' in patch) Object.assign(a, { on: !patch.off, status: patch.off ? 'off' : 'starting', since: Date.now() })
      }
      setTimeout(() => window.__cliqueEmit('state', state), 30)
    }
    if (action === 'task') return taskAction(...args)
    if (action === 'link') return linkAction(...args)
    // phones: a code to pair one, and unpairing one
    if (action === 'phones') {
      const [op, id] = args
      if (op === 'code') {
        // window.__cliquePhoneError: this computer can't listen for phones (a port that's taken)
        const fail = window.__cliquePhoneError
        return new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error(fail)) : resolve(phoneCode())), window.__cliquePhoneDelay ?? 0))
      }
      if (op === 'cancel') PHONES.pairing = null
      if (op === 'revoke') PHONES.devices = PHONES.devices.filter((d) => d.id !== id)
      emit()
    }
    if (action === 'workspace') return workspaceAction(...args)
    if (action === 'update') return updateAction(...args)
    if (action === 'openAtLogin') {
      state.app.login.on = Boolean(args[0])
      emit()
      return state.app.login.on
    }
    if (action === 'addAgent') {
      const name = String(args[0].name).toLowerCase()
      state.agents.push(newAgent({ ...args[0], name, shared: false }))
      emit()
      return name
    }
    if (action === 'channel') return channelAction(...args)
    if (action === 'schedule') return scheduleAction(...args)
    // moving an agent to another computer: its folders there, then the move itself
    if (action === 'folders') return (FOLDERS[args[0] ?? ''] ?? []).map(([path, label]) => ({ path, label }))
    if (action === 'folderInfo') {
      const full = pathOn(HOMES[args[0] ?? ''] ?? '/Users/you')(String(args[1]).replace(/^~/, '/Users/you'))
      return { exists: (FOLDERS[args[0] ?? ''] ?? []).some(([p]) => p === full), path: full }
    }
    if (action === 'pickFolder') return '~/Projects/docs-site'
    if (action === 'moveAgent') {
      const [name, home] = args
      const a = state.agents.find((x) => x.name === name)
      const link = COMPUTERS.links.find((l) => l.slug === home)
      const seed = a.seed ?? a.name
      Object.assign(a, { name: home ? `${seed}@${home}` : seed, seed, home: home || null, homeName: link?.name ?? null, cwd: args[2] ?? a.cwd })
      emit()
      return { name: a.name, conversation: 'moved' }
    }
    if (action === 'dismiss') {
      state.agents.splice(state.agents.findIndex((a) => a.name === args[0]), 1)
      emit()
    }
    if (action === 'freshStart') {
      const a = state.agents.find((x) => x.name === args[0])
      // like the hub: a busy agent finishes its task first
      if (a && (a.status === 'working' || a.status === 'waiting')) a.freshPending = true
      else if (a) Object.assign(a, { convo: { since: Date.now(), tasks: 0, compactions: 0, context: { pct: 2, size: a.convo?.context?.size ?? 200000, used: 4000 } } })
      emit()
    }
    return undefined
  },
  input: () => {},
  fit: (width, height, focus, pill) => (window.__cliqueFit = { width, height, pill }),
  drag: () => {},
  dragApp: () => {},
  onPlace: (fn) => listeners.place.push(fn),
  onState: (fn) => listeners.state.push(fn),
  onPty: () => {},
  onFocus: (fn) => listeners.focus.push(fn),
  onToggle: (fn) => listeners.toggle.push(fn),
  onImport: () => {},
  onVoice: (fn) => listeners.voice.push(fn),
  voiceAudio: () => {},
}

// Preload for scripts/screenshots.mjs: a fake window.crew with a made-up crew, so every view can be rendered and
// captured without starting any agents or touching ~/.crew. The crew is the neutral demo one: seven agents building a
// small online shop (Storefront), on two computers, with two phones paired.
const now = Date.now()
const min = 60000
// Every window starts on everyone's chat: the composer's target is the conversation it shows, and windows in one
// run share localStorage, so one shot's conversation would otherwise open in the next.
try {
  localStorage.removeItem('crew.target')
} catch {}
const day = 24 * 60 * min

// ?fixture=big | row | clones | workspaces picks one of the variations below. ?platform=win32: the pages as Windows
// shows them (Ctrl for ⌘, "this PC", paths with drive letters, the titlebar with room for the window buttons), rendered
// on a Mac. ?dev=1: as when Crew runs from source (npm run dev), with the developer's extras.
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
  // Rex and Noor run on the linked computer: their terminals are mirrors streamed over Crew Link
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

// ?fixture=big: a crew of 24 on three computers (Workstation linked and online, the Laptop asleep), for checking
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
  // Kai finished its turn while a sub-agent keeps working in the background; Bo has booked staging (crew lease)
  big('Kai').subs = [{ id: 's3', type: 'Plan', description: 'Draft the release checklist', started: now - 95000, ended: null, tools: 4, activity: 'Read · docs/release.md' }]
  big('Bo').holds = ['staging']
}

// A made-up shop page for the tasks that come with a screenshot: the cart, empty.
const SHOT = require('path').join(require('os').tmpdir(), 'crew-shots-empty-cart.svg')
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
// Channels: #review, whose brief keeps its agents reviewing, and #checkout-launch for three of the crew. Milo's review
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
  claude: { label: 'Claude', models: ['fable', 'opus', 'sonnet', 'haiku'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  codex: { label: 'Codex', models: ['gpt-6-luna', 'gpt-6'], efforts: ['low', 'medium', 'high'], fastByDefault: false },
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

// Linked computers, as Crew.computers() reports them: what each one runs.
const linked = (slug, name, online) => ({
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
  me: { name: HERE.name, slug: HERE.slug, sharing: true, agents: AGENTS.filter((a) => !a.home && !a.cloneOf).length, port: 7787, code: `crew1.${Buffer.from(JSON.stringify({ name: HERE.name })).toString('base64url')}.k3y`, hosts: [{ address: HERE.address, via: 'Wi-Fi' }, { address: TAILNET, via: 'Tailscale' }] },
  links: [linked(LINK.slug, LINK.name, true), ...(BIG ? [linked('laptop', 'Laptop', false)] : [])],
  phones: PHONES,
}
// A pairing code for a phone, with made-up keys (a new secret each time), as a QR code the way main.js draws it (qrSvg).
// window.__crewPhoneTTL makes codes end sooner than ten minutes, to watch the pairing view renew them.
let codes = 0
function phoneCode() {
  const bytes = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 53 + seed) & 255)).toString('base64url')
  const code = 'crewphone1.' + Buffer.from(JSON.stringify({ v: 1, id: bytes(16, 1), n: HERE.name, k: bytes(32, 2), s: bytes(32, 3 + codes++), h: [HERE.address, TAILNET], p: 7788 })).toString('base64url')
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
  const expires = Date.now() + (window.__crewPhoneTTL ?? 10 * min)
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
// ahead of her queue; when Ada tried to ask June back, Crew had her answer first. Earlier: Milo's question came back
// answered, three hand-offs for Milo went in as one turn, Iris left a file to Milo, who was editing it, and a
// declined task went straight to its next owner.
if (FIXTURE === 'row') {
  const agent = (n) => AGENTS.find((a) => a.name === n)
  Object.assign(agent('June'), { status: 'working', since: t(1.4), activity: 'Bash · crew ask Ada', waitingOn: [{ name: 'Ada', since: t(0.8), id: 'q1', text: 'Which coupon codes can stack in 1.2?' }] })
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
// what the work on a task cost so far
for (const [id, spent] of [[7, { cost: 3.4, tokens: 0, added: 120, removed: 34 }], [5, { cost: 1.31, tokens: 0, added: 42, removed: 18 }], [6, { cost: 0, tokens: 820000, added: 64, removed: 9 }], [3, { cost: 0.86, tokens: 0, added: 21, removed: 4 }]]) Object.assign(TICKETS.find((t) => t.id === id), { spent })
// the crew's spend: today against what's usual by now, and the last week and month
const SPEND = { today: 14.2, usual: 12.8, week: 96, weekBefore: 88, month: 340 }
const state = { reads: READS, autopilot: true, theme: 'light', providers: PROVIDERS, agents: AGENTS, feed: FEED, channels: CHANNELS, computers: COMPUTERS, usage: USAGE, spend: SPEND, tasks: { tickets: TICKETS, triage: 'June', autofix: false } }

// Workspaces, as Crew.workspaces() reports them. Storefront is the default one, renamed and given a quiet grey (so its
// tile is an S); Docs site is the second. ?fixture=workspaces has Docs site on screen with three of the crew, Storefront
// in the background with two of its crew needing you and a reply you haven't read, and Research parked.
const LOCAL = AGENTS.filter((a) => !a.home && !a.cloneOf)
const faces = (names) => names.map((n) => AGENTS.find((a) => a.name === n)).map((a) => ({ name: a.name, avatar: a.avatar, status: a.status }))
const WORKSPACES = [
  { id: 'default', name: 'Storefront', color: '#8e8e93', icon: null, folder: null, parked: false, members: null, agents: 7, on: 6, working: 2, waiting: 2, unread: 1, faces: faces(['Ada', 'Milo', 'Iris', 'Theo']), needs: [...faces(['Milo']).map((f) => ({ ...f, activity: 'Bash: npm run build' })), ...faces(['Iris'])] },
  { id: 'docs', name: 'Docs site', color: 'sky', icon: null, folder: here('/Users/you/Projects/docs-site'), parked: false, members: [{ name: 'June', folder: '' }, { name: 'Iris', folder: '' }, { name: 'Milo', folder: here('/Users/you/Projects/docs-site/theme') }], agents: 3, on: 3, working: 1, waiting: 0, unread: 0, faces: faces(['June', 'Iris', 'Milo']), needs: [] },
  { id: 'research', name: 'Research', color: 'purple', icon: null, folder: here('/Users/you/Notes/research'), parked: true, members: [{ name: 'June', folder: '' }, { name: 'Theo', folder: '' }], agents: 2, on: 2, working: 0, waiting: 0, unread: 0, faces: faces(['June', 'Theo']), needs: [] },
]
// how the shared agents are doing in a workspace other than the default (each has its own session there)
const AT = { docs: { June: { status: 'working', since: t(4), activity: 'Edit docs/checkout.md' }, Iris: { status: 'idle', since: t(25), activity: '' }, Milo: { status: 'idle', since: t(40), activity: '' } } }
const EVERY = AGENTS
const show = (id) => {
  for (const w of WORKSPACES) w.current = w.id === id
  state.workspace = WORKSPACES.find((w) => w.current)
  const w = state.workspace
  state.parked = w.parked
  state.agents = id === 'default' ? EVERY
    : EVERY.filter((a) => w.members?.some((m) => m.name === a.name)).map((a) => {
      const folder = w.members.find((m) => m.name === a.name).folder || w.folder
      return { ...a, shared: true, cwd: folder ? folder.replace(HOME, '~') : a.cwd, ...AT[id]?.[a.name], ...(w.parked && { status: 'parked' }) }
    })
}
state.workspaces = WORKSPACES
state.roster = LOCAL.map((a) => ({ name: a.name, area: a.area, avatar: a.avatar, cwd: here(`/Users/you/Projects/${a.name === 'June' ? 'docs-site' : 'storefront'}`) }))
if (FIXTURE === 'workspaces') show('docs')
else {
  WORKSPACES.splice(2) // the default crew has Storefront and Docs site
  show('default')
}
window.__crewShow = show
// The workspace actions, enough for the shots: switch, open, park, make one.
// The channels' sheet and menu, as Crew.channelAction does them.
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

function workspaceAction(op, id, arg) {
  const w = WORKSPACES.find((x) => x.id === id)
  if (op === 'switch') window.__crewShow(id)
  if (op === 'open') (w.parked = false), window.__crewShow(state.workspace.id)
  if (op === 'park') (w.parked = true), window.__crewShow(state.workspace.id)
  if (op === 'order') {
    const at = (x) => (x.id === 'default' ? -1 : arg.includes(x.id) ? arg.indexOf(x.id) : arg.length)
    WORKSPACES.sort((a, b) => at(a) - at(b))
  }
  // who works there: shared agents in and out (the default has everyone)
  if (op === 'members' && w && id !== 'default') {
    for (const name of arg.add ?? []) if (!w.members.some((m) => m.name === name)) w.members.push({ name, folder: '' })
    w.members = w.members.filter((m) => !(arg.remove ?? []).includes(m.name))
    Object.assign(w, { agents: w.members.length, on: w.members.length, faces: faces(w.members.map((m) => m.name)) })
    if (w.current) window.__crewShow(id)
  }
  if (op === 'edit' && w) Object.assign(w, arg)
  if (op === 'remove') {
    WORKSPACES.splice(WORKSPACES.indexOf(w), 1)
    if (w.current) window.__crewShow('default')
  }
  if (op === 'create') {
    id = String(arg.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    WORKSPACES.push({ id, name: arg.name, color: arg.color || null, icon: arg.icon || null, folder: arg.folder || null, parked: false, members: (arg.members ?? []).map((name) => ({ name, folder: '' })), agents: arg.members?.length ?? 0, on: arg.members?.length ?? 0, working: 0, waiting: 0, unread: 0, faces: faces(arg.members ?? []) })
    window.__crewShow(id)
  }
  emit()
  return { id, state }
}
const emit = () => setTimeout(() => window.__crewEmit('state', state), 30)
let nextTask = Math.max(...TICKETS.map((x) => x.id)) + 1
// The crew's names are capitalized (Ada), while the pages match a typed @name in lower case (@ada): find one either way.
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
window.__crewFit = null
window.__crewEmit = (channel, ...args) => listeners[channel]?.forEach((fn) => fn(...args))
window.__crewState = state
window.crew = {
  platform: PLATFORM,
  home: HOME,
  dev: QUERY.get('dev') === '1',
  call: async (action, ...args) => {
    if (action === 'state') return state
    // sending from the chat: your message lands in the feed, threaded when it's a reply. Like the hub, an @name in it
    // is who it's for when no one's picked; Auto goes to Ada.
    if (action === 'send') {
      const [picked, text, , opts = {}] = args
      const to = picked || [...new Set([...String(text).matchAll(MENTION)].map((m) => named(m[2])?.name).filter(Boolean))].join(',')
      // a busy agent that can clone itself: a clone takes it (sendAction)
      if (to && !to.includes(',') && !opts.re && named(to)?.clones) return sendAction(to, text)
      const names = String(to || 'Ada').split(',').filter(Boolean).map((n) => named(n)?.name ?? n)
      const group = names.length > 1 && { cc: names, sendId: `s${Date.now()}` }
      const channel = opts.channel && opts.channel !== 'general' ? opts.channel : opts.re ? state.feed.find((e) => e.id === opts.re)?.channel : undefined
      for (const n of names) state.feed.push({ id: `u${Date.now()}${n}`, kind: 'msg', from: 'you', to: n, text, ts: Date.now(), ...group, ...(opts.fresh && { fresh: true }), ...(opts.re && { re: opts.re }), ...(channel && { channel }) })
      emit()
      return `sent to ${names.map((n) => `@${n}`).join(' ')}\n`
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
    // window.__crewBufferDelay holds the replay back, so its ribbon can be captured
    if (action === 'buffer') return new Promise((r) => setTimeout(() => r({ data: TERM, cols: 100, rows: 30 }), window.__crewBufferDelay ?? 0))
    if (action === 'answer') {
      const [id, reply] = args
      const e = state.feed.find((x) => x.id === id)
      const always = e.ask.always?.find((x) => x.i === reply.always)?.label
      e.answer = reply.terminal ? { by: 'terminal', handedOver: true } : reply.answers ? { by: 'you', answers: Object.fromEntries(Object.entries(reply.answers).map(([k, v]) => [k, [].concat(v).join(', ')])) } : { by: 'you', allow: Boolean(reply.allow), ...(always && { always }), ...(reply.note && { note: reply.note }) }
      const a = state.agents.find((x) => x.name === e.from)
      if (a && !reply.terminal) Object.assign(a, { status: 'working', since: Date.now() })
      setTimeout(() => window.__crewEmit('state', state), 30)
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
      setTimeout(() => window.__crewEmit('state', state), 30)
    }
    if (action === 'task') return taskAction(...args)
    // phones: a code to pair one, and unpairing one
    if (action === 'phones') {
      const [op, id] = args
      if (op === 'code') {
        // window.__crewPhoneError: this computer can't listen for phones (a port that's taken)
        const fail = window.__crewPhoneError
        return new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error(fail)) : resolve(phoneCode())), window.__crewPhoneDelay ?? 0))
      }
      if (op === 'cancel') PHONES.pairing = null
      if (op === 'revoke') PHONES.devices = PHONES.devices.filter((d) => d.id !== id)
      emit()
    }
    if (action === 'workspace') return workspaceAction(...args)
    if (action === 'channel') return channelAction(...args)
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
  fit: (width, height, focus, pill) => (window.__crewFit = { width, height, pill }),
  drag: () => {},
  onPlace: (fn) => listeners.place.push(fn),
  onState: (fn) => listeners.state.push(fn),
  onPty: () => {},
  onFocus: (fn) => listeners.focus.push(fn),
  onToggle: (fn) => listeners.toggle.push(fn),
  onImport: () => {},
  onVoice: (fn) => listeners.voice.push(fn),
  voiceAudio: () => {},
}

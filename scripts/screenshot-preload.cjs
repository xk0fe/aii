// Preload for scripts/screenshots.mjs: a fake window.crew with a made-up crew, so every view can be
// rendered and captured without starting any agents or touching ~/.crew.
const now = Date.now()
const min = 60000
// Every window starts on everyone's chat: the composer's target is the conversation it shows, and windows in one
// run share localStorage, so one shot's conversation would otherwise open in the next.
try {
  localStorage.removeItem('crew.target')
} catch {}
const day = 24 * 60 * min

const days = (counts) => counts.map((tasks, i) => ({ day: new Date(now - (counts.length - 1 - i) * day).toISOString().slice(0, 10), tasks }))
const stats = (tasks, fromYou, activeMin, avgTurnS, tools, handoffs, waits, queueS, spark) => ({
  tasks, fromYou, fromTeam: tasks - fromYou, turns: tasks, activeMs: activeMin * min, avgTurnMs: avgTurnS * 1000, tools, handoffs,
  waits, waitMs: waits * 95000, avgQueueMs: queueS * 1000, first: now - 12 * day, last: now - 4 * min, days: days(spark),
})
const none = stats(0, 0, 0, 0, 0, 0, 0, 0, Array(14).fill(0))
none.first = undefined
none.last = undefined

const AGENTS = [
  { name: 'joseph', area: 'Senior Backend SWE', provider: 'claude', model: 'opus', effort: 'medium', yolo: true, status: 'working', since: now - 3 * min, activity: 'Edit core/hub.js', queue: 0, stats: stats(48, 31, 412, 312, 940, 12, 3, 41, [2, 4, 3, 0, 5, 6, 2, 4, 7, 3, 1, 5, 4, 2]) },
  { name: 'david', area: 'Executive SWE (frontend, mobile apps)', provider: 'claude', model: 'opus', effort: 'high', yolo: true, status: 'waiting', since: now - min, stats: stats(39, 22, 377, 402, 811, 9, 5, 64, [1, 3, 2, 4, 0, 3, 5, 2, 3, 4, 2, 6, 3, 1]) },
  { name: 'gal', area: 'Executive UI/UX Designer', provider: 'claude', model: 'fable', effort: 'xhigh', yolo: false, status: 'waiting', since: now - min, activity: 'Bash: npm run build', stats: stats(11, 9, 96, 523, 214, 4, 6, 22, [0, 0, 1, 0, 2, 1, 0, 0, 3, 1, 0, 2, 1, 0]), avatar: { body: 'heart', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'flower', cheeks: true } },
  { name: 'ye', area: 'marketing analytical mastermind, using posthog to get analytics', provider: 'claude', model: 'haiku', effort: 'medium', yolo: true, status: 'off', on: false, stats: stats(4, 4, 18, 270, 40, 0, 1, 12, [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0]), avatar: { body: 'bean', color: 'purple', eyes: 'sparkle', mouth: 'none', hat: 'glasses', cheeks: true } },
  { name: 'marc', area: 'artist, makes images', provider: 'codex', model: '', effort: 'high', tier: 'fast', fast: true, yolo: true, clones: 2, status: 'working', since: now - 12 * min, activity: 'image_gen: hero illustration, pastel', queue: 0, stats: stats(17, 12, 141, 488, 160, 2, 0, 140, [0, 1, 2, 0, 1, 3, 0, 2, 1, 2, 0, 1, 3, 1]), avatar: { body: 'drop', color: 'purple', eyes: 'googly', mouth: 'cat', hat: 'beret', cheeks: false } },
  { name: 'arie', area: 'admin work, assistant, organiser', provider: 'codex', model: '', effort: 'medium', fast: false, yolo: true, status: 'idle', since: now - 30 * min, stats: stats(26, 14, 120, 210, 300, 21, 1, 30, [3, 1, 2, 2, 4, 1, 0, 3, 2, 1, 2, 3, 1, 1]), avatar: { body: 'bunny', color: 'lilac', eyes: 'sparkle', mouth: 'grin', hat: 'crown', cheeks: true } },
  { name: 'jeff', area: 'technical support, professional yapper, good to talk to about anything else', provider: 'codex', model: '', effort: 'medium', fast: true, yolo: false, status: 'starting', since: now - 2000, stats: none, avatar: { body: 'blob', color: 'teal', eyes: 'dot', mouth: 'none', hat: 'headphones', cheeks: false } },
  // runs on a linked computer: its terminal is a mirror streamed over Crew Link
  { name: 'scarlett@mac-mini', seed: 'scarlett', home: 'mac-mini', homeName: 'Mac mini', area: 'QA, play-tests every build', provider: 'claude', model: 'sonnet', effort: 'medium', yolo: false, status: 'working', since: now - 6 * min, activity: 'Bash: npm run e2e', stats: stats(9, 5, 70, 300, 120, 1, 1, 20, [0, 1, 0, 2, 1, 0, 1, 0, 2, 1, 0, 1, 0, 0]), avatar: { body: 'mochi', color: 'yellow', eyes: 'dot', mouth: 'smile', hat: 'sprout', cheeks: true } },
].map((a) => ({ on: true, queue: 0, clones: 0, activity: '', pending: false, args: '', cwd: '~/code/app', prompt: '', images: [], ...a }))

// marc can clone itself: the two tasks that would wait in its queue are being drawn by its clones instead
const cloneOf = (base, n, extra) => ({ ...base, name: `${base.name}.${n}`, cloneOf: base.name, clone: n, clones: 0, avatar: { seed: base.name, ...base.avatar }, queue: 0, ...extra })
const MARC = AGENTS.find((a) => a.name === 'marc')
AGENTS.splice(AGENTS.indexOf(MARC) + 1, 0,
  cloneOf(MARC, 2, { status: 'working', since: now - 4 * min, activity: 'image_gen: empty Tasks board, felt look' }),
  cloneOf(MARC, 3, { status: 'working', since: now - 1 * min, activity: 'Read assets/brand/palette.md' }))

// How full each conversation is (the context gauges) and which bug each fixer's conversation is about.
const convo = (tasks, pct, size, extra = {}) => ({ since: now - (40 + tasks * 9) * min, tasks, compactions: 0, context: { pct, size, used: Math.round((pct / 100) * size) }, ...extra })
const CONVOS = {
  joseph: [convo(9, 41, 1000000), 7],
  david: [convo(14, 72, 200000), null],
  gal: [convo(6, 88, 200000, { compactions: 1 }), null],
  ye: [convo(2, 12, 200000), null],
  marc: [convo(4, 23, 258400), 6],
  arie: [convo(11, 18, 258400), null],
  'marc.2': [convo(1, 9, 258400), null],
  'marc.3': [convo(1, 4, 258400), null],
  jeff: [{ since: now - 3000, tasks: 0, compactions: 0 }, 8],
}
for (const a of AGENTS) [a.convo, a.ticket] = CONVOS[a.name] ?? [null, null]
// sub-agents at work: joseph has two going, arie finished its turn while one keeps working in the background
AGENTS[0].subs = [
  { id: 's1', type: 'Explore', description: 'Find every reply path', started: now - 50000, ended: null, tools: 7, activity: 'Grep · sendId' },
  { id: 's2', type: 'general-purpose', description: 'Run the test suite', started: now - 21000, ended: null, tools: 2, activity: 'Bash · npm test' },
]
AGENTS.find((a) => a.name === 'arie').subs = [{ id: 's3', type: 'Plan', description: 'Draft the release checklist', started: now - 95000, ended: null, tools: 4, activity: 'Read · RELEASE.md' }]
// joseph's 1M window is held to 250k: the hub reports its numbers against the limit (core/context.js againstLimit)
Object.assign(AGENTS[0], { contextLimit: 250000, onContextLimit: 'fresh' })
AGENTS[0].convo.context = { used: 160000, size: 250000, window: 1000000, limit: 250000, pct: 64 }

// ?fixture=big: a crew of 24 on three computers (the Mac mini linked and online, the Air asleep), for checking
// how every view holds up with many agents.
const BIG = new URLSearchParams(location.search).get('fixture') === 'big'
if (BIG) {
  const more = [
    ['nova', 'Android client, Kotlin and Compose', 'claude', 'sonnet', 'high', 'working', 'Edit app/src/main/ShopScreen.kt', { body: 'cat', color: 'mint', eyes: 'sparkle', mouth: 'cat', hat: 'none', cheeks: true }],
    ['kai', 'CI, build pipelines and release tooling', 'codex', '', 'medium', 'idle', '', { body: 'bean', color: 'orange', eyes: 'dot', mouth: 'grin', hat: 'party', cheeks: false }],
    ['lena', 'docs, changelogs and help center articles', 'claude', 'haiku', 'low', 'idle', '', { body: 'bunny', color: 'peach', eyes: 'happy', mouth: 'smile', hat: 'bow', cheeks: true }],
    ['otto', 'performance profiling and frame pacing', 'claude', 'opus', 'high', 'working', 'Bash: xcrun xctrace record', { body: 'frog', color: 'lime', eyes: 'googly', mouth: 'grin', hat: 'none', cheeks: false }],
    ['pia', 'localization: 14 languages, string freezes', 'codex', '', 'low', 'off', '', { body: 'heart', color: 'red', eyes: 'dot', mouth: 'smile', hat: 'none', cheeks: true }],
    ['rex', 'security review, auth and secrets', 'claude', 'opus', 'xhigh', 'waiting', 'Bash: gitleaks detect', { body: 'blob', color: 'blue', eyes: 'line', mouth: 'none', hat: 'glasses', cheeks: false }],
    ['sol', 'data pipelines and the analytics warehouse', 'codex', '', 'high', 'off', '', { body: 'drop', color: 'sky', eyes: 'sleepy', mouth: 'smile', hat: 'none', cheeks: false }],
  ].map(([name, area, provider, model, effort, status, activity, avatar]) => ({ name, area, provider, model, effort, status, activity, avatar }))
  const remote = (home, homeName) => ([seed, area, provider, model, effort, status, activity, avatar]) => ({ name: `${seed}@${home}`, seed, home, homeName, area, provider, model, effort, status, activity, avatar })
  const mini = [
    ['bo', 'iOS builds and TestFlight', 'claude', 'sonnet', 'medium', 'working', 'Bash: xcodebuild archive', { body: 'mochi', color: 'teal', eyes: 'dot', mouth: 'smile', hat: 'headphones', cheeks: false }],
    ['fin', 'store screenshots and listings', 'codex', '', 'medium', 'idle', '', { body: 'cat', color: 'yellow', eyes: 'happy', mouth: 'cat', hat: 'none', cheeks: true }],
    ['ivy', 'release manager, keeps the train on time', 'claude', 'opus', 'medium', 'waiting', '', { body: 'bunny', color: 'lilac', eyes: 'sparkle', mouth: 'smile', hat: 'flower', cheeks: true }],
    ['max', 'load tests against staging', 'codex', '', 'high', 'working', 'Bash: k6 run soak.js', { body: 'blob', color: 'red', eyes: 'googly', mouth: 'grin', hat: 'sprout', cheeks: false }],
    ['uma', 'backend API, Postgres and queues', 'claude', 'opus', 'high', 'idle', '', { body: 'bean', color: 'purple', eyes: 'dot', mouth: 'smile', hat: 'none', cheeks: true }],
    ['zed', 'analytics dashboards', 'claude', 'haiku', 'low', 'off', '', { body: 'drop', color: 'mint', eyes: 'line', mouth: 'none', hat: 'none', cheeks: false }],
  ].map(remote('mac-mini', 'Mac mini'))
  const air = [
    ['mo', 'design assets and icon sets', 'claude', 'sonnet', 'medium', 'idle', '', { body: 'heart', color: 'orange', eyes: 'sparkle', mouth: 'cat', hat: 'beret', cheeks: true }],
    ['tess', 'marketing copy and the website', 'claude', 'haiku', 'medium', 'idle', '', { body: 'mochi', color: 'pink', eyes: 'happy', mouth: 'smile', hat: 'bow', cheeks: true }],
    ['vic', 'quick prototypes', 'codex', '', 'medium', 'idle', '', { body: 'frog', color: 'sky', eyes: 'dot', mouth: 'grin', hat: 'crown', cheeks: false }],
  ].map(remote('air', 'MacBook Air')).map((a) => ({ ...a, status: 'away' }))
  const spark = (n) => Array.from({ length: 14 }, (_, i) => (i * 7 + n) % 4)
  for (const [i, a] of [...more, ...mini, ...air].entries()) {
    AGENTS.push({
      on: a.status !== 'off', queue: a.name === 'nova' ? 1 : 0, pending: false, args: '', cwd: '~/code/app', prompt: '', images: [], yolo: i % 3 === 0, fast: a.provider === 'codex' ? i % 2 === 0 : undefined,
      since: now - (2 + i) * min, stats: stats(3 + i * 2, 2 + i, 20 + i * 9, 200 + i * 20, 30 + i * 12, i % 4, i % 3, 10 + i * 3, spark(i)),
      convo: a.status === 'off' ? null : convo(2 + (i % 5), 8 + ((i * 13) % 70), 200000), ticket: null, ...a,
    })
  }
}

// A made-up game screenshot for the tasks that come with one.
const SHOT = require('path').join(require('os').tmpdir(), 'crew-shots-level2.svg')
require('fs').writeFileSync(SHOT, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec5ff"/><stop offset="1" stop-color="#d9f0ff"/></linearGradient></defs><rect width="320" height="200" fill="url(#s)"/><circle cx="262" cy="42" r="20" fill="#ffe27a"/><rect y="150" width="320" height="50" fill="#6fcf6a"/><rect x="40" y="112" width="70" height="12" rx="6" fill="#a86b3c"/><rect x="190" y="96" width="80" height="12" rx="6" fill="#a86b3c"/><circle cx="72" cy="140" r="11" fill="#ff7eb6"/><circle cx="68" cy="137" r="2" fill="#222"/><circle cx="76" cy="137" r="2" fill="#222"/><rect x="110" y="60" width="100" height="44" rx="10" fill="rgba(0,0,0,.55)"/><text x="160" y="88" font-family="Helvetica" font-size="16" fill="#fff" text-anchor="middle">PAUSED</text></svg>`)

const log = (...entries) => entries.map(([m, by, text, kind]) => ({ ts: now - m * min, by, text, ...(kind && { kind }) }))
const ticket = (id, status, severity, title, owner, extra = {}) => ({
  id, key: String(id), home: null, kind: 'task', status, severity, title, body: '', owner, fixer: null, by: 'you', images: [], seen: 1, triaged: Boolean(owner),
  created: now - (90 - id * 6) * min, updated: now - (60 - id * 4) * min, log: log([90 - id * 6, 'you', 'added it']), ...extra,
})
const TICKETS = [
  ticket(12, 'new', 'blocker', 'Jump does nothing after unpausing', 'david', {
    kind: 'bug',
    body: '1. Start level 2\n2. Pause, then resume\n3. Press jump: nothing happens until you press it twice\n\nExpected: jumps right away. Happens on keyboard and gamepad.',
    images: [SHOT], created: now - 2 * min, updated: now - 1 * min,
    log: log([2, 'you', 'reported it'], [1.5, 'arie', 'gave it to @david, marked it blocker, updated the details'], [1, 'arie', 'Probably the input buffer isn\'t cleared on resume; see PauseMenu.onResume', 'note']),
  }),
  ticket(11, 'new', 'high', 'Pause menu buttons overlap on small screens', 'gal', { kind: 'bug', seen: 3 }),
  ticket(10, 'new', 'normal', 'Daily challenge with a shared leaderboard', null, { kind: 'feature', triaged: false, created: now - 0.4 * min }),
  ticket(9, 'new', 'low', 'Rename "Volumn" to "Volume" in settings', 'david'),
  ticket(13, 'new', 'normal', 'Onboarding hero illustrations, one per crew role', 'marc', { kind: 'feature' }),
  ticket(7, 'fixing', 'high', 'Coins counter resets after level 2', 'joseph', { kind: 'bug', fixer: 'joseph' }),
  ticket(6, 'fixing', 'normal', 'Localize shop prices', 'marc', { fixer: 'marc' }),
  ticket(8, 'fixing', 'normal', 'Offline mode for the avatar picker', 'jeff', { kind: 'feature', fixer: 'jeff' }),
  ticket(5, 'check', 'high', 'Double jump fires twice on gamepad', 'david', {
    kind: 'bug',
    fixer: 'david', fix: 'Held buttons were read every frame. Debounced the jump input so a press fires once; checked keyboard and a DualSense on levels 1–3.',
    log: log([60, 'you', 'reported it'], [55, 'you', 'sent it to @david, in a new conversation'], [12, 'david', 'fixed it: Debounced the jump input'], [12, 'david', 'Repro was 100% with a DualSense at 120Hz.', 'note']),
  }),
  ticket(4, 'check', 'normal', 'Fade the music when the game pauses', 'marc', { fixer: 'marc', fix: 'Ducked the music bus when the pause menu opens, back up on resume.' }),
  ticket(3, 'done', 'normal', 'Login spinner never stops', 'joseph', { kind: 'bug', fixer: 'joseph', fix: 'Missing timeout on the auth call; added one and an error state.' }),
  ticket(2, 'done', 'low', 'Login spinner keeps spinning', 'joseph', { kind: 'bug', dupOf: 3 }),
  ticket(1, 'done', 'normal', 'Tutorial: add a skip button', 'david', { kind: 'feature', fixer: 'david', fix: 'Skip in the top corner; remembers that you skipped.' }),
]

const t = (m) => now - m * min
const FEED = [
  { id: 'f1', kind: 'msg', from: 'you', to: 'joseph', cc: ['joseph', 'david'], sendId: 's1', text: 'The feed merges multi-recipient sends. Can you two make sure replies thread back to the right bubble?', ts: t(26) },
  { id: 'f2', kind: 'msg', from: 'you', to: 'david', cc: ['joseph', 'david'], sendId: 's1', text: 'The feed merges multi-recipient sends. Can you two make sure replies thread back to the right bubble?', ts: t(26) },
  { id: 'f3', kind: 'reply', from: 'david', to: 'you', re: 'f2', text: 'Done on the client side. Replies now link to the **first visible copy**, so `mergeSends` stays the single source of truth.', ts: t(19) },
  { id: 'f3b', kind: 'ask', from: 'joseph', to: 'you', cli: 'claude', re: 'f1', ts: t(17), ask: { type: 'permission', tool: 'Bash', title: 'Run a command', code: 'npm test', always: [] }, answer: { by: 'you', allow: true, always: 'Always allow Bash(npm test:*)', at: t(16.5) } },
  { id: 'f4', kind: 'handoff', from: 'joseph', to: 'gal', re: 'f1', text: 'Can you sanity-check the quote styling for threaded replies? It looks cramped on narrow panels.', ts: t(14) },
  { id: 'f5', kind: 'note', from: 'arie', text: 'Standup moved to 10:30. @joseph cuts the release branch tomorrow.', ts: t(9) },
  { id: 'f6', kind: 'handoff', from: 'gal', to: 'marc', held: true, text: 'Need three pastel hero illustrations for the onboarding, one per crew role. Soft felt look, like our creatures.', ts: t(5) },
  { id: 'f6b', kind: 'handoff', from: 'david', to: 'arie', text: 'PUBLISHED: `083c613` is on GitHub. Branch and PR both read back the same commit.', ts: t(4.5) },
  { id: 'f6c', kind: 'reply', from: 'arie', to: 'you', re: 'f6b', ts: t(4), text: "**Release blocker closed.** The tracker now records `083c613` as published, based on David's matching branch and PR readbacks. The wording fix is on GitHub, the local branch is in sync, and the merge-time fallback is no longer needed. Jeff has been told.\n\nThe remaining sequence is unchanged:\n\n1. Merge **#4645**, then **#4647**. Both are open and unmerged.\n2. Verify the cleanup in a store build.\n3. Joseph retires flag `928775`.\n4. Gal signs off the onboarding art.\n\nI'll post here when #4645 lands." },
  { id: 'f7', kind: 'ask', from: 'gal', to: 'you', cli: 'claude', re: 'f4', ts: t(1), ask: { type: 'permission', tool: 'Bash', title: 'Run a command', code: 'rm -rf dist && npm run build', detail: 'Clean the build folder and rebuild the app', alert: 'wants to run a command',
    always: [{ i: 0, label: 'Always allow Bash(npm run build:*)' }, { i: 1, label: 'Allow all edits this session' }] } },
  { id: 'c1', kind: 'msg', from: 'you', to: 'marc.2', text: 'An illustration for the empty Tasks board too, same felt look', ts: t(4.2) },
  { id: 'c2', kind: 'msg', from: 'you', to: 'marc.3', text: 'And a pastel palette sheet for the brand guide', ts: t(1.1) },
  { id: 'f8', kind: 'reply', from: 'joseph', to: 'you', re: 'f1', subs: [{ type: 'Explore', description: 'Find every reply path', tools: 9, ms: 41000, running: false }, { type: 'general-purpose', description: 'Run the test suite', tools: 3, ms: 64000, running: false }], text: 'Server side is threaded too:\n\n| path | status |\n|---|---|\n| hub.send | ✓ sendId |\n| hub.reply | ✓ re |\n\nRan the suite, 42 passing.', ts: t(0.5) },
  { id: 'f9', kind: 'ask', from: 'david', to: 'you', cli: 'claude', re: 'f2', ts: t(0.3), ask: { type: 'question', alert: 'asks: Which navigation pattern?', questions: [
    { question: 'Which navigation pattern should the mobile app use?', header: 'Navigation', multiSelect: false, options: [{ label: 'Tab bar', description: 'Five tabs at the bottom, like iOS apps' }, { label: 'Drawer', description: 'A side menu behind a hamburger' }, { label: 'Both', description: 'Tabs for the main areas, a drawer for settings' }] }] } },
]

const PROVIDERS = {
  claude: { label: 'Claude', models: ['fable', 'opus', 'sonnet', 'haiku'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  codex: { label: 'Codex', models: ['gpt-6-luna', 'gpt-6'], efforts: ['low', 'medium', 'high'], fastByDefault: false },
  glm: { label: 'GLM', models: ['glm-5'], efforts: [], missing: ['ZAI_API_KEY'] },
}

const ESC = '\x1b['
const TERM = [
  `${ESC}38;5;209m✻${ESC}0m ${ESC}1mWelcome to Claude Code${ESC}0m`,
  '',
  `${ESC}2m  cwd: ~/code/app${ESC}0m`,
  '',
  `${ESC}1m>${ESC}0m make sure replies thread back to the right bubble`,
  '',
  `${ESC}38;5;114m●${ESC}0m Read(core/hub.js)`,
  `  ⎿  Read 649 lines`,
  `${ESC}38;5;114m●${ESC}0m Update(core/hub.js)`,
  `  ⎿  Updated core/hub.js with 6 additions and 2 removals`,
  `${ESC}38;5;111m●${ESC}0m Bash(npm test)`,
  `  ⎿  ${ESC}32m✔ 42 passing${ESC}0m`,
  '',
  `${ESC}38;5;209m✻${ESC}0m Threading replies… ${ESC}2m(esc to interrupt)${ESC}0m`,
].join('\r\n')

// Linked computers, as Crew.computers() reports them: what each one runs.
const linked = (slug, name, online) => ({
  slug, name, online, saved: true, status: online ? { address: '192.168.1.24' } : { error: 'unreachable, it reconnects on its own' },
  agents: AGENTS.filter((a) => a.home === slug).map((a) => ({ name: a.name, seed: a.seed, area: a.area, avatar: a.avatar, status: a.status, on: a.on, hidden: false })),
})
const COMPUTERS = {
  me: { name: 'Studio Mac', slug: 'studio-mac', sharing: true, agents: AGENTS.filter((a) => !a.home && !a.cloneOf).length, port: 7787, code: 'crew1.eyJuYW1lIjoiU3R1ZGlvIE1hYyJ9.k3y', hosts: [{ address: '192.168.1.20', via: 'Wi-Fi' }, { address: 'studio-mac.tail1234.ts.net', via: 'Tailscale' }] },
  links: [linked('mac-mini', 'Mac mini', true), ...(BIG ? [linked('air', 'MacBook Air', false)] : [])],
}
// Folders each computer has, for moving an agent there (folderInfo / folders in main.js).
// [path, label] as folders() in core/move.js labels them: the agent's own path there, who works where, home.
const FOLDERS = {
  '': [['/Users/you/code/app', 'same folder as now'], ['/Users/you/code/site', 'lena, tess'], ['/Users/you', 'home folder']],
  'mac-mini': [['/Users/you/code/app', 'same folder as now'], ['/Users/you/builds', 'bo, fin'], ['/Users/you', 'home folder']],
  air: [['/Users/you/code/app', 'same folder as now'], ['/Users/you', 'home folder']],
}
// The task flow in the chat: added, triaged, started in a new conversation, done.
FEED.push(
  { id: 'b1', kind: 'task', type: 'bug', act: 'filed', from: 'you', ticket: 12, title: 'Jump does nothing after unpausing', ts: t(0.45) },
  { id: 'b2', kind: 'task', type: 'bug', act: 'triaged', from: 'arie', ticket: 12, title: 'Jump does nothing after unpausing', text: 'david', ts: t(0.4) },
  { id: 'b3', kind: 'event', fresh: true, from: 'joseph', text: 'started a new conversation for #7', ts: t(0.35) },
  { id: 'b4', kind: 'msg', from: 'you', to: 'joseph', ticket: 7, type: 'bug', title: 'Coins counter resets after level 2', fresh: true, text: '[bug #7] Coins counter resets after level 2', ts: t(0.3) },
  { id: 'b5', kind: 'task', type: 'bug', act: 'fixed', from: 'david', ticket: 5, title: 'Double jump fires twice on gamepad', text: 'Held buttons were read every frame. Debounced the jump input so a press fires once.', ts: t(0.2) },
)

// ?fixture=row: right of way (core/hub.js question). arie asked joseph something and waits on his answer, which goes
// ahead of his queue; when joseph tried to ask arie back, Crew had him answer first. Earlier: david's question came
// back answered, three hand-offs for david went in as one turn, a clone left a file to its agent, and a declined task
// went straight to its next owner.
if (new URLSearchParams(location.search).get('fixture') === 'row') {
  const agent = (n) => AGENTS.find((a) => a.name === n)
  Object.assign(agent('arie'), { status: 'working', since: t(1.4), activity: 'Bash · crew ask joseph', waitingOn: [{ name: 'joseph', since: t(0.8), id: 'q1', text: 'Which port does the staging API listen on?' }] })
  Object.assign(agent('joseph'), { owes: [{ name: 'arie', since: t(0.8), id: 'q1', waiting: true }] })
  Object.assign(agent('david'), { status: 'working', since: t(4), activity: 'Edit src/screens/Settings.tsx' })
  Object.assign(agent('gal'), { status: 'idle', since: t(20), activity: '' })
  FEED.length = 0
  FEED.push(
    { id: 'h1', kind: 'msg', from: 'arie', to: 'david', text: 'Triaged #9 to you: the settings labels sit at the far edge of their rows in Arabic.', ts: t(9) },
    { id: 'h2', kind: 'msg', from: 'scarlett@mac-mini', to: 'david', text: 'QA on #4715: the hold card sits 79pt too high on the iPhone Air.', ts: t(8.8) },
    { id: 'h3', kind: 'msg', from: 'arie', to: 'david', text: 'Recorded both blockers on #2.', ts: t(8.6) },
    { id: 'h4', kind: 'reply', from: 'david', to: 'you', re: 'h1', also: ['h2', 'h3'], text: 'Fixed the hold offset and both **#2** blockers in one pass (PR #4747). Starting on **#9** next.', ts: t(6.5) },
    { id: 'q0', kind: 'msg', from: 'david', to: 'joseph', ask: true, text: 'Does /v2/swing still return frames as an array?', ts: t(5), answered: { by: 'joseph', at: t(4.2), reply: 'q0r' } },
    { id: 'q0r', kind: 'reply', from: 'joseph', to: 'you', re: 'q0', text: 'Yes: `frames: Frame[]`, newest last. It pages past 500.', ts: t(4.2) },
    { id: 'r1', kind: 'rule', rule: 'file', from: 'marc.2', to: 'marc', file: 'palette.md', ts: t(3) },
    { id: 'r2', kind: 'rule', rule: 'decline', from: 'jeff', to: 'david', ticket: 9, title: 'Rename "Volumn" to "Volume" in settings', text: 'Settings strings are client code, not support', ts: t(2) },
    { id: 'q1', kind: 'msg', from: 'arie', to: 'joseph', ask: true, queued: true, text: 'Which port does the staging API listen on?', ts: t(0.8) },
    { id: 'r3', kind: 'rule', rule: 'loop', from: 'joseph', to: 'arie', line: ['arie', 'joseph'], ts: t(0.5) },
  )
}

// what you've read: david's replies, but not joseph's or arie's latest
const READS = { since: 0, agents: { david: now - 18 * min } }
const state = { reads: READS, autopilot: true, theme: 'light', providers: PROVIDERS, agents: AGENTS, feed: FEED, computers: COMPUTERS, tasks: { tickets: TICKETS, triage: 'arie', autofix: false } }
const emit = () => setTimeout(() => window.__crewEmit('state', state), 30)
let nextTask = 14

// Enough of the task actions for the recordings: add, start, accept.
function taskAction(op, key, arg) {
  if (op === 'file') {
    const text = String(arg.text ?? '').trim()
    const owner = arg.owner ?? 'david'
    const t = { ...TICKETS.find((x) => x.id === 9), id: nextTask, key: String(nextTask), kind: arg.kind ?? 'task', status: 'new', severity: 'normal', title: text, body: '', owner, triaged: true, seen: 1, images: arg.images ?? [], created: Date.now(), updated: Date.now(), log: [{ ts: Date.now(), by: 'you', text: 'added it' }] }
    TICKETS.push(t)
    FEED.push({ id: `nb${nextTask}`, kind: 'task', type: t.kind, act: 'filed', from: 'you', ticket: nextTask, title: text, owner, ts: Date.now() })
    emit()
    return `added #${nextTask++} for @${owner}`
  }
  const t = TICKETS.find((x) => x.key === key)
  if (!t) return
  const to = (status, extra = {}) => Object.assign(t, { status, updated: Date.now(), ...extra })
  if (op === 'dispatch' || (op === 'move' && arg === 'fixing')) {
    to('fixing', { fixer: t.owner })
    const a = AGENTS.find((x) => x.name === t.owner)
    if (a) Object.assign(a, { ticket: t.id, status: 'starting', since: Date.now(), convo: { since: Date.now(), tasks: 0, compactions: 0, context: { pct: 2, size: 200000, used: 4000 } } })
    setTimeout(() => a && Object.assign(a, { status: 'working', since: Date.now(), activity: 'Read src/game/PauseMenu.ts' }) && emit(), 1400)
  }
  if (op === 'accept' || (op === 'move' && arg === 'done')) to('done')
  if (op === 'move' && arg === 'check') to('check', { fix: t.fix ?? 'Fixed by hand.' })
  if (op === 'move' && arg === 'new') to('new')
  if (op === 'sendBack') to('fixing')
  if (op === 'edit') Object.assign(t, arg, { updated: Date.now() })
  emit()
}

// Enough of send for the recordings: a message for a busy agent that can clone itself starts a clone (core/hub.js).
function sendAction(to, text) {
  const name = to ?? String(text).match(/@([\w-]+)/)?.[1] ?? 'arie'
  const a = state.agents.find((x) => x.name === name)
  const family = state.agents.filter((x) => x === a || x.cloneOf === name)
  const free = family.find((x) => x.status === 'idle')
  let target = free ?? a
  let out = `sent to @${target.name}`
  if (!free && a.clones > family.length - 1) {
    let n = 2
    while (state.agents.some((x) => x.name === `${name}.${n}`)) n++
    target = cloneOf(a, n, { status: 'starting', since: Date.now(), activity: '', convo: { since: Date.now(), tasks: 0, compactions: 0 } })
    state.agents.splice(state.agents.indexOf(family.at(-1)) + 1, 0, target)
    out = `@${name} is busy, so a clone, @${target.name}, is starting up to take this`
    setTimeout(() => (Object.assign(target, { status: 'working', since: Date.now(), activity: 'Read assets/brand/palette.md', convo: { ...target.convo, tasks: 1, context: { pct: 3, size: 258400, used: 8000 } } }), emit()), 1300)
  }
  FEED.push({ id: `s${Date.now()}`, kind: 'msg', from: 'you', to: target.name, text, ts: Date.now() })
  emit()
  return out
}

const listeners = { state: [], focus: [], toggle: [], voice: [], place: [] }

// Dictation without a microphone: a wobbling tone stands in for your voice (it only moves the meter), and a
// scripted transcript arrives word by word. Nothing here ever opens a real microphone.
const SPOKEN = 'Hey Joseph, can you look at why the build is failing on main? Then hand it to David.'.split(' ')
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
  if (action === 'voiceLocales') return [{ id: 'en_US', label: 'English', installed: true }, { id: 'ru_RU', label: 'Русский', installed: true }]
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
  call: async (action, ...args) => {
    if (action === 'state') return state
    // sending from the chat: your message lands in the feed (Auto goes to joseph), threaded when it's a reply
    if (action === 'send') {
      const [to, text, , opts = {}] = args
      // a busy agent that can clone itself: a clone takes it (sendAction)
      if (to && !String(to).includes(',') && !opts.re && state.agents.find((a) => a.name === to)?.clones) return sendAction(to, text)
      const names = String(to || 'joseph').split(',').filter(Boolean)
      const group = names.length > 1 && { cc: names, sendId: `s${Date.now()}` }
      for (const n of names) state.feed.push({ id: `u${Date.now()}${n}`, kind: 'msg', from: 'you', to: n, text, ts: Date.now(), ...group, ...(opts.fresh && { fresh: true }), ...(opts.re && { re: opts.re }) })
      emit()
      return `sent to ${names.map((n) => `@${n}`).join(' ')}\n`
    }
    if (action === 'read') {
      for (const [n, ts] of Object.entries(args[0] ?? {})) READS.agents[n] = Math.max(READS.agents[n] ?? 0, ts)
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
    // moving an agent to another computer: its folders there, then the move itself
    if (action === 'folders') return (FOLDERS[args[0] ?? ''] ?? []).map(([path, label]) => ({ path, label }))
    if (action === 'folderInfo') {
      const full = String(args[1]).replace(/^~/, '/Users/you')
      return { exists: (FOLDERS[args[0] ?? ''] ?? []).some(([p]) => p === full), path: full }
    }
    if (action === 'pickFolder') return '~/code/site'
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

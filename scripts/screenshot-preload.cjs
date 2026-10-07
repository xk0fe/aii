// Preload for scripts/screenshots.mjs: a fake window.crew with a made-up crew, so every view can be
// rendered and captured without starting any agents or touching ~/.crew.
const now = Date.now()
const min = 60000
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
  { name: 'david', area: 'Executive SWE (frontend, mobile apps)', provider: 'claude', model: 'opus', effort: 'high', yolo: true, status: 'idle', since: now - 9 * min, stats: stats(39, 22, 377, 402, 811, 9, 5, 64, [1, 3, 2, 4, 0, 3, 5, 2, 3, 4, 2, 6, 3, 1]) },
  { name: 'gal', area: 'Executive UI/UX Designer', provider: 'claude', model: 'fable', effort: 'xhigh', yolo: false, status: 'waiting', since: now - min, activity: 'Bash: npm run build', stats: stats(11, 9, 96, 523, 214, 4, 6, 22, [0, 0, 1, 0, 2, 1, 0, 0, 3, 1, 0, 2, 1, 0]), avatar: { body: 'heart', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'flower', cheeks: true } },
  { name: 'ye', area: 'marketing analytical mastermind, using posthog to get analytics', provider: 'claude', model: 'haiku', effort: 'medium', yolo: true, status: 'off', on: false, stats: stats(4, 4, 18, 270, 40, 0, 1, 12, [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0]), avatar: { body: 'bean', color: 'purple', eyes: 'sparkle', mouth: 'none', hat: 'glasses', cheeks: true } },
  { name: 'marc', area: 'artist, makes images', provider: 'codex', model: '', effort: 'high', tier: 'fast', fast: true, yolo: true, status: 'working', since: now - 12 * min, activity: 'image_gen: hero illustration, pastel', queue: 2, stats: stats(17, 12, 141, 488, 160, 2, 0, 140, [0, 1, 2, 0, 1, 3, 0, 2, 1, 2, 0, 1, 3, 1]), avatar: { body: 'drop', color: 'purple', eyes: 'googly', mouth: 'cat', hat: 'beret', cheeks: false } },
  { name: 'arie', area: 'admin work, assistant, organiser', provider: 'codex', model: '', effort: 'medium', fast: false, yolo: true, status: 'idle', since: now - 30 * min, stats: stats(26, 14, 120, 210, 300, 21, 1, 30, [3, 1, 2, 2, 4, 1, 0, 3, 2, 1, 2, 3, 1, 1]), avatar: { body: 'bunny', color: 'lilac', eyes: 'sparkle', mouth: 'grin', hat: 'crown', cheeks: true } },
  { name: 'jeff', area: 'technical support, professional yapper, good to talk to about anything else', provider: 'codex', model: '', effort: 'medium', fast: true, yolo: false, status: 'starting', since: now - 2000, stats: none, avatar: { body: 'blob', color: 'teal', eyes: 'dot', mouth: 'none', hat: 'headphones', cheeks: false } },
].map((a) => ({ on: true, queue: 0, activity: '', pending: false, args: '', cwd: '~/code/app', prompt: '', images: [], ...a }))

const t = (m) => now - m * min
const FEED = [
  { id: 'f1', kind: 'task', from: 'you', to: 'joseph', cc: ['joseph', 'david'], sendId: 's1', text: 'The feed merges multi-recipient sends. Can you two make sure replies thread back to the right bubble?', ts: t(26) },
  { id: 'f2', kind: 'task', from: 'you', to: 'david', cc: ['joseph', 'david'], sendId: 's1', text: 'The feed merges multi-recipient sends. Can you two make sure replies thread back to the right bubble?', ts: t(26) },
  { id: 'f3', kind: 'reply', from: 'david', to: 'you', re: 'f2', text: 'Done on the client side. Replies now link to the **first visible copy**, so `mergeSends` stays the single source of truth.', ts: t(19) },
  { id: 'f4', kind: 'handoff', from: 'joseph', to: 'gal', re: 'f1', text: 'Can you sanity-check the quote styling for threaded replies? It looks cramped on narrow panels.', ts: t(14) },
  { id: 'f5', kind: 'note', from: 'arie', text: 'Standup moved to 10:30. Release branch is cut tomorrow.', ts: t(9) },
  { id: 'f6', kind: 'handoff', from: 'gal', to: 'marc', held: true, text: 'Need three pastel hero illustrations for the onboarding, one per crew role. Soft felt look, like our creatures.', ts: t(5) },
  { id: 'f7', kind: 'event', from: 'gal', alert: true, text: 'needs you: approve `npm run build`', ts: t(1) },
  { id: 'f8', kind: 'reply', from: 'joseph', to: 'you', re: 'f1', text: 'Server side is threaded too:\n\n| path | status |\n|---|---|\n| hub.send | ✓ sendId |\n| hub.reply | ✓ re |\n\nRan the suite, 42 passing.', ts: t(0.5) },
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

const state = { autopilot: true, theme: 'light', providers: PROVIDERS, agents: AGENTS, feed: FEED, link: { mode: 'local', sharing: false } }

const listeners = { state: [], focus: [], toggle: [] }
window.__crewFit = null
window.__crewEmit = (channel, ...args) => listeners[channel]?.forEach((fn) => fn(...args))
window.__crewState = state
window.crew = {
  call: async (action, ...args) => {
    if (action === 'state') return state
    if (action === 'buffer') return { data: TERM, cols: 100, rows: 30 }
    if (action === 'update') {
      const [names, patch] = args
      for (const a of state.agents.filter((x) => [names].flat().includes(x.name))) {
        if ('yolo' in patch) a.yolo = patch.yolo
        if ('tier' in patch) a.fast = patch.tier === 'fast'
        if ('off' in patch) Object.assign(a, { on: !patch.off, status: patch.off ? 'off' : 'starting', since: Date.now() })
      }
      setTimeout(() => window.__crewEmit('state', state), 30)
    }
    return undefined
  },
  input: () => {},
  fit: (width, height) => (window.__crewFit = { width, height }),
  onState: (fn) => listeners.state.push(fn),
  onPty: () => {},
  onFocus: (fn) => listeners.focus.push(fn),
  onToggle: (fn) => listeners.toggle.push(fn),
}

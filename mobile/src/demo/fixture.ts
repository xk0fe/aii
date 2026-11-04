// A made-up crew for the demo (and the store screenshots, and App Review): the neutral demo crew every Crew picture
// uses, building a small online shop in "Storefront", with a second workspace for its docs. Everything is relative to
// `now`, so the demo always looks like it's happening.
import type { Agent, Channel, FeedEntry, State, Sub } from '@/net/types'

export type Space = { id: string; name: string; color: string | null; icon: string | null; parked: boolean; state: State }

const MIN = 60000

// A long answer, written the way agents write them: a heading, a checklist, code, a table. The chat has to read well.
const RELEASE_PLAN = `## Release 1.2: what's left

Checkout is **green on Chrome and Safari**. Three things stand between us and the release:

1. **Coupons.** Stacking two codes still counts the discount twice. The fix is in \`api/cart.ts\`; I'm writing its test now.
2. **Dark mode.** Milo's settings page is done, but the receipt email still puts \`#ffffff\` text on white.
3. **Release notes.** June has a first draft in \`docs/release-notes.md\`.

### Where each part stands

| Part | Status | Who |
| --- | --- | --- |
| Checkout | Ready | Theo |
| Coupons | Fixing | Ada |
| Dark mode | In review | Milo |
| Release notes | Draft | June |

- [x] Totals round once, on the whole cart
- [x] Checkout tests pass on both browsers
- [ ] Two coupons count once
- [ ] The receipt email reads in dark mode

To try the coupon fix on your machine:

\`\`\`sh
git switch fix/coupon-stacking
npm test -- coupons
\`\`\`

> Nothing else blocks the release. Once coupons pass, Rex can deploy from the Workstation.`

export function makeDemo(now = Date.now()): Space[] {
  const t = (m: number) => now - m * MIN
  const ctx = (pct: number, size: number, tasks: number) => ({ since: t(40 + tasks * 9), tasks, compactions: 0, context: { pct, size, used: Math.round((pct / 100) * size) } })
  const agent = (a: Partial<Agent> & { name: string }): Agent => ({ status: 'idle', on: true, queue: 0, clones: 0, activity: '', since: t(30), ...a })
  const helper = (id: string, description: string, started: number): Sub => ({ id, type: 'general-purpose', description, started: t(started), ended: null, tools: 4, activity: 'Read api/orders.ts' })

  const ada = agent({
    name: 'Ada', area: 'Backend developer', provider: 'claude', model: 'opus', effort: 'high', status: 'working', since: t(3), activity: 'Edit · api/orders.ts', convo: ctx(38, 200000, 6), channel: 'ship',
    subs: [helper('h1', 'Find every place totals are rounded', 2), helper('h2', 'Check the coupon tests', 1)],
    avatar: { body: 'blob', color: 'mint', eyes: 'dot', mouth: 'none', hat: 'glasses', cheeks: false },
  })
  const milo = agent({
    name: 'Milo', area: 'Frontend developer', provider: 'claude', model: 'sonnet', effort: 'medium', yolo: true, status: 'waiting', since: t(2), activity: 'Bash · npm run build', convo: ctx(86, 200000, 11),
    avatar: { body: 'cat', color: 'sky', eyes: 'happy', mouth: 'cat', hat: 'party', cheeks: true },
  })
  const iris = agent({
    name: 'Iris', area: 'Product designer', provider: 'claude', model: 'opus', effort: 'high', status: 'waiting', since: t(5), convo: ctx(21, 200000, 3), channel: 'design',
    avatar: { body: 'heart', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'flower', cheeks: true },
  })
  const theo = agent({
    name: 'Theo', area: 'Tester', provider: 'codex', effort: 'high', status: 'working', since: t(12), activity: 'Running the checkout tests', convo: ctx(44, 258400, 5), channel: 'ship',
    avatar: { body: 'frog', color: 'lime', eyes: 'googly', mouth: 'grin', hat: 'none', cheeks: false },
  })
  const june = agent({
    name: 'June', area: 'Writer, docs and release notes', provider: 'codex', effort: 'medium', status: 'idle', since: t(9), convo: ctx(12, 258400, 2),
    avatar: { body: 'bunny', color: 'peach', eyes: 'happy', mouth: 'smile', hat: 'bow', cheeks: true },
  })
  const rex = agent({
    name: 'Rex@workstation', seed: 'Rex', home: 'workstation', homeName: 'Workstation', area: 'Ops, builds and deploys', provider: 'claude', model: 'sonnet', effort: 'medium', fast: true, status: 'starting', since: t(0.2),
    avatar: { body: 'mochi', color: 'yellow', eyes: 'dot', mouth: 'smile', hat: 'headphones', cheeks: true },
  })
  const noor = agent({
    name: 'Noor@workstation', seed: 'Noor', home: 'workstation', homeName: 'Workstation', area: 'Reviewer', provider: 'codex', effort: 'high', status: 'off', on: false, convo: ctx(9, 258400, 1),
    avatar: { body: 'drop', color: 'purple', eyes: 'googly', mouth: 'cat', hat: 'beret', cheeks: false },
  })

  const storefront: FeedEntry[] = [
    { id: 'f1', kind: 'msg', from: 'you', to: 'Ada', text: 'Totals look wrong when there are three items in the cart. Can you look?', ts: t(31) },
    { id: 'f2', kind: 'ask', from: 'Ada', to: 'you', cli: 'claude', re: 'f1', ts: t(27), ask: { type: 'permission', tool: 'Bash', title: 'Run a command', code: 'npm test', always: [] }, answer: { by: 'you', allow: true, always: 'Always allow npm test', at: t(26.5) } },
    { id: 'f3', kind: 'task', type: 'bug', act: 'fixed', from: 'Ada', ticket: 4, title: 'Totals round wrong with 3 items', text: 'Rounding happened per line; now once on the total.', ts: t(12) },
    { id: 'f4', kind: 'msg', from: 'you', to: 'Theo', text: 'Can you run the checkout tests on Chrome and Safari?', ts: t(11), channel: 'ship' },
    { id: 'f5', kind: 'msg', from: 'you', to: 'Milo', text: 'Dark mode for the settings page, please.', ts: t(10) },
    { id: 'f6', kind: 'reply', from: 'Milo', to: 'you', re: 'f5', text: 'On it. The colors come from the theme tokens, so it is mostly one file.', ts: t(8) },
    { id: 'f7', kind: 'msg', from: 'you', to: 'Iris', text: 'Can you sketch the empty cart?', ts: t(7), channel: 'design' },
    { id: 'f8', kind: 'reply', from: 'Theo', to: 'you', re: 'f4', text: 'All 48 checkout tests pass on Chrome and Safari.', ts: t(6), channel: 'ship' },
    { id: 'q1', kind: 'ask', from: 'Iris', to: 'you', cli: 'claude', re: 'f7', ts: t(5), channel: 'design', ask: { type: 'question', alert: 'asks: Should the empty cart show suggestions?', questions: [{ question: 'Should the empty cart show suggestions?', options: [{ label: 'Yes, show a few products' }, { label: 'No, keep it empty' }] }] } },
    { id: 'f9', kind: 'msg', from: 'you', to: 'Ada', text: "What's left before we ship 1.2?", ts: t(4.5), channel: 'ship' },
    { id: 'f10', kind: 'reply', from: 'Ada', to: 'you', re: 'f9', ts: t(3.5), channel: 'ship', subs: [{ type: 'Explore', description: 'Find what is still open for 1.2', tools: 9, ms: 36000 }], text: RELEASE_PLAN },
    { id: 'q2', kind: 'ask', from: 'Milo', to: 'you', cli: 'claude', re: 'f5', ts: t(2), ask: { type: 'permission', tool: 'Bash', title: 'Run a command', code: 'npm run build', detail: 'Check the settings page', alert: 'wants to run a command', always: [{ i: 0, label: 'Always allow npm run build' }] } },
  ]
  const reads = { since: 0, agents: { Milo: t(7.5) } }

  const docsAgents = [
    { ...june, shared: true, status: 'working', since: t(4), activity: 'Edit · docs/release-notes.md' },
    { ...ada, shared: true, status: 'idle', since: t(20), activity: '', subs: [], channel: undefined },
  ]
  const docs: FeedEntry[] = [
    { id: 'd1', kind: 'msg', from: 'you', to: 'June', text: 'Write the 1.2 release notes, please.', ts: t(9) },
    { id: 'd2', kind: 'reply', from: 'June', to: 'you', re: 'd1', text: 'A first draft is in **docs/release-notes.md**: coupons, dark mode and the faster checkout.', ts: t(5) },
  ]

  // #ship has a brief its agents get with their first message there; #design is Iris's and Milo's
  const channels: Channel[] = [
    { id: 'general', name: 'general' },
    { id: 'ship', name: 'ship', brief: 'Getting 1.2 out the door: the last bugs, the release notes and the deploy. Keep answers short, and say first what blocks the release.' },
    { id: 'design', name: 'design', brief: 'Screens and how they feel. Sketch before you build, and ask before you change a flow.', members: ['Iris', 'Milo'] },
  ]
  const providers = { claude: { label: 'Claude' }, codex: { label: 'Codex' } }
  const base = { autopilot: true, providers, computers: [{ slug: 'studio', name: 'Studio', online: true }, { slug: 'workstation', name: 'Workstation', online: true }] }
  return [
    { id: 'storefront', name: 'Storefront', color: null, icon: null, parked: false, state: { ...base, agents: [ada, milo, iris, theo, june, rex, noor], feed: storefront, reads, channels } },
    { id: 'docs', name: 'Docs site', color: 'teal', icon: null, parked: false, state: { ...base, agents: docsAgents, feed: docs, reads: { since: 0, agents: {} }, channels: [{ id: 'general', name: 'general' }] } },
  ]
}

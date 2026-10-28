// A made-up crew for the demo (and screenshots, and App Review): the crew of desktop/scripts/screenshot-preload.cjs,
// in four workspaces. Everything is relative to `now`, so the demo always looks like it's happening.
import type { Agent, FeedEntry, State } from '@/net/types'

export type Space = { id: string; name: string; color: string | null; icon: string | null; parked: boolean; state: State }

const MIN = 60000

export function makeDemo(now = Date.now()): Space[] {
  const t = (m: number) => now - m * MIN
  const ctx = (pct: number, size: number, tasks: number, extra = {}) => ({ since: t(40 + tasks * 9), tasks, compactions: 0, context: { pct, size, used: Math.round((pct / 100) * size) }, ...extra })
  const agent = (a: Partial<Agent> & { name: string }): Agent => ({ status: 'idle', on: true, queue: 0, clones: 0, activity: '', since: t(30), ...a })

  const joseph = agent({ name: 'joseph', area: 'Senior Backend SWE', provider: 'claude', model: 'opus', effort: 'medium', yolo: true, status: 'working', since: t(3), activity: 'Edit core/hub.js', contextLimit: 250000, convo: { ...ctx(64, 250000, 9), context: { used: 160000, size: 250000, window: 1000000, limit: 250000, pct: 64 } } })
  const david = agent({ name: 'david', area: 'Executive SWE (frontend, mobile apps)', provider: 'claude', model: 'opus', effort: 'high', yolo: true, status: 'waiting', since: t(1), convo: ctx(72, 200000, 14) })
  const gal = agent({ name: 'gal', area: 'Executive UI/UX Designer', provider: 'claude', model: 'fable', effort: 'xhigh', status: 'waiting', since: t(1), activity: 'Bash: npm run build', convo: ctx(88, 200000, 6, { compactions: 1 }), avatar: { body: 'heart', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'flower', cheeks: true } })
  const ye = agent({ name: 'ye', area: 'marketing analytical mastermind, using posthog to get analytics', provider: 'claude', model: 'haiku', effort: 'medium', yolo: true, status: 'off', on: false, convo: ctx(12, 200000, 2), avatar: { body: 'bean', color: 'purple', eyes: 'sparkle', mouth: 'none', hat: 'glasses', cheeks: true } })
  const marc = agent({ name: 'marc', area: 'artist, makes images', provider: 'codex', effort: 'high', tier: 'fast', fast: true, yolo: true, clones: 2, status: 'working', since: t(12), activity: 'image_gen: hero illustration, pastel', convo: ctx(23, 258400, 4), avatar: { body: 'drop', color: 'purple', eyes: 'googly', mouth: 'cat', hat: 'beret', cheeks: false } })
  const clone = (n: number, extra: Partial<Agent>) => agent({ ...marc, name: `marc.${n}`, cloneOf: 'marc', clone: n, clones: 0, avatar: { seed: 'marc', ...marc.avatar }, ...extra })
  const arie = agent({ name: 'arie', area: 'admin work, assistant, organiser', provider: 'codex', effort: 'medium', fast: false, yolo: true, status: 'waiting', since: t(2), convo: ctx(18, 258400, 11), avatar: { body: 'bunny', color: 'lilac', eyes: 'sparkle', mouth: 'grin', hat: 'crown', cheeks: true } })
  const jeff = agent({ name: 'jeff', area: 'technical support, professional yapper, good to talk to about anything else', provider: 'codex', effort: 'medium', fast: true, status: 'idle', since: t(8), convo: ctx(6, 258400, 1), avatar: { body: 'blob', color: 'teal', eyes: 'dot', mouth: 'none', hat: 'headphones', cheeks: false } })
  const scarlett = agent({ name: 'scarlett@mac-mini', seed: 'scarlett', home: 'mac-mini', homeName: 'Mac mini', area: 'QA, play-tests every build', provider: 'claude', model: 'sonnet', effort: 'medium', status: 'working', since: t(6), activity: 'Bash: npm run e2e', holds: ['simulator'], convo: ctx(31, 200000, 5), avatar: { body: 'mochi', color: 'yellow', eyes: 'dot', mouth: 'smile', hat: 'sprout', cheeks: true } })

  const home: FeedEntry[] = [
    { id: 'f1', kind: 'msg', from: 'you', to: 'joseph', cc: ['joseph', 'david'], sendId: 's1', text: 'The feed merges multi-recipient sends. Can you two make sure replies thread back to the right bubble?', ts: t(26) },
    { id: 'f2', kind: 'msg', from: 'you', to: 'david', cc: ['joseph', 'david'], sendId: 's1', text: 'The feed merges multi-recipient sends. Can you two make sure replies thread back to the right bubble?', ts: t(26) },
    { id: 'f3', kind: 'reply', from: 'david', to: 'you', re: 'f2', text: 'Done on the client side. Replies now link to the **first visible copy**, so `mergeSends` stays the single source of truth.', ts: t(19) },
    { id: 'f3b', kind: 'ask', from: 'joseph', to: 'you', cli: 'claude', re: 'f1', ts: t(17), ask: { type: 'permission', tool: 'Bash', title: 'Run a command', code: 'npm test', always: [] }, answer: { by: 'you', allow: true, always: 'Always allow Bash(npm test:*)', at: t(16.5) } },
    { id: 'f4', kind: 'handoff', from: 'joseph', to: 'gal', re: 'f1', text: 'Can you sanity-check the quote styling for threaded replies? It looks cramped on narrow panels.', ts: t(14) },
    { id: 'f5', kind: 'note', from: 'arie', text: 'Standup moved to 10:30. @joseph cuts the release branch tomorrow.', ts: t(9) },
    { id: 'f6', kind: 'handoff', from: 'gal', to: 'marc', held: true, text: 'Need three pastel hero illustrations for the onboarding, one per crew role. Soft felt look, like our creatures.', ts: t(5) },
    { id: 'f6b', kind: 'handoff', from: 'david', to: 'arie', text: 'PUBLISHED: `083c613` is on GitHub. Branch and PR both read back the same commit.', ts: t(4.5) },
    { id: 'c1', kind: 'msg', from: 'you', to: 'marc.2', text: 'An illustration for the empty Tasks board too, same felt look', ts: t(4.2) },
    { id: 'f6c', kind: 'reply', from: 'arie', to: 'you', re: 'f6b', ts: t(4), text: "**Release blocker closed.** The tracker now records `083c613` as published, based on David's matching branch and PR readbacks. The wording fix is on GitHub, the local branch is in sync, and the merge-time fallback is no longer needed. Jeff has been told.\n\nThe remaining sequence is unchanged:\n\n1. Merge **#4645**, then **#4647**. Both are open and unmerged.\n2. Verify the cleanup in a store build.\n3. Joseph retires flag `928775`.\n4. Gal signs off the onboarding art.\n\nI'll post here when #4645 lands." },
    { id: 'p1', kind: 'ask', from: 'arie', to: 'you', cli: 'claude', ts: t(2), ask: { type: 'plan', alert: 'has a plan for you to approve', plan: "## Release 2.4\n\n1. Cut `release/2.4` from main once **#4647** lands.\n2. Bump the build number and write the changelog.\n3. Run the e2e suite on the iPhone Air simulator (@scarlett holds it).\n4. Ship to TestFlight, then a staged rollout at 10%.\n\n**Risk:** the onboarding art isn't signed off. If it slips, ship the old illustrations behind the `new-onboarding` flag.\n\n- Owner: @arie\n- Needs: @gal's sign-off, @joseph's flag cleanup" } },
    { id: 'c2', kind: 'msg', from: 'you', to: 'marc.3', text: 'And a pastel palette sheet for the brand guide', ts: t(1.1) },
    { id: 'f7', kind: 'ask', from: 'gal', to: 'you', cli: 'claude', re: 'f4', ts: t(1), ask: { type: 'permission', tool: 'Bash', title: 'Run a command', code: 'rm -rf dist && npm run build', detail: 'Clean the build folder and rebuild the app', alert: 'wants to run a command', always: [{ i: 0, label: 'Always allow Bash(npm run build:*)' }, { i: 1, label: 'Allow all edits this session' }] } },
    { id: 'f8', kind: 'reply', from: 'joseph', to: 'you', re: 'f1', subs: [{ type: 'Explore', description: 'Find every reply path', tools: 9, ms: 41000, running: false }, { type: 'general-purpose', description: 'Run the test suite', tools: 3, ms: 64000, running: false }], text: 'Server side is threaded too:\n\n| path | status |\n|---|---|\n| hub.send | ✓ sendId |\n| hub.reply | ✓ re |\n\nRan the suite, 42 passing.', ts: t(0.5) },
    { id: 'f9', kind: 'ask', from: 'david', to: 'you', cli: 'claude', re: 'f2', ts: t(0.3), ask: { type: 'question', alert: 'asks: Which navigation pattern?', questions: [{ question: 'Which navigation pattern should the mobile app use?', header: 'Navigation', multiSelect: false, options: [{ label: 'Tab bar', description: 'Five tabs at the bottom, like iOS apps' }, { label: 'Drawer', description: 'A side menu behind a hamburger' }, { label: 'Both', description: 'Tabs for the main areas, a drawer for settings' }] }] } },
    { id: 'b1', kind: 'task', type: 'bug', act: 'filed', from: 'you', ticket: 12, title: 'Jump does nothing after unpausing', ts: t(0.45) },
    { id: 'b2', kind: 'task', type: 'bug', act: 'triaged', from: 'arie', ticket: 12, title: 'Jump does nothing after unpausing', text: 'david', ts: t(0.4) },
    { id: 'b3', kind: 'event', fresh: true, from: 'joseph', text: 'started a new conversation for #7', ts: t(0.35) },
    { id: 'b5', kind: 'task', type: 'bug', act: 'fixed', from: 'david', ticket: 5, title: 'Double jump fires twice on gamepad', text: 'Held buttons were read every frame. Debounced the jump input so a press fires once.', ts: t(0.2) },
  ].sort((x, y) => x.ts - y.ts) as FeedEntry[]

  const reads = { since: 0, agents: { david: t(18) } }
  const shared = (a: Agent, extra: Partial<Agent>) => ({ ...a, shared: true, ...extra })

  const golfAgents = [
    shared(joseph, { status: 'working', since: t(5), activity: 'Read src/api/swing.ts', convo: ctx(22, 200000, 3) }),
    shared(david, { status: 'waiting', since: t(0.6), activity: 'Edit HoldCard.tsx', convo: ctx(41, 200000, 4) }),
    shared(gal, { status: 'idle', since: t(14), activity: '', convo: ctx(9, 200000, 1) }),
    shared(marc, { status: 'idle', since: t(20), activity: '', clones: 2, convo: ctx(5, 258400, 1) }),
  ]
  const golf: FeedEntry[] = [
    { id: 'g1', kind: 'msg', from: 'you', to: 'david', text: 'The hold card sits too high on the iPhone Air. Can you fix it?', ts: t(9) },
    { id: 'g2', kind: 'reply', from: 'david', to: 'you', re: 'g1', text: "Found it: the card adds the safe area **twice** on devices without a home indicator inset. One more edit and it's fixed.", ts: t(2) },
    { id: 'g3', kind: 'msg', from: 'you', to: 'joseph', text: 'Does /v2/swing still return frames as an array?', ts: t(1.5) },
    { id: 'g4', kind: 'ask', from: 'david', to: 'you', cli: 'claude', re: 'g1', ts: t(0.6), ask: { type: 'permission', tool: 'Edit', title: 'Edit HoldCard.tsx', code: '- paddingTop: insets.top + insets.bottom,\n+ paddingTop: insets.top,', detail: '/Users/you/code/golf-ios/src/HoldCard.tsx', always: [{ i: 0, label: 'Allow all edits this session' }] } },
  ]

  const siteAgents = [shared(gal, { status: 'working', since: t(3), activity: 'Edit site/pricing.html', convo: ctx(33, 200000, 2) }), shared(ye, { status: 'idle', on: true, since: t(6), activity: '' })]
  const site: FeedEntry[] = [
    { id: 's1', kind: 'msg', from: 'you', to: 'ye', text: "How's the launch week traffic?", ts: t(12) },
    { id: 's2', kind: 'reply', from: 'ye', to: 'you', re: 's1', text: 'Up **18%** week over week. The pricing page converts best when people arrive from the changelog.', ts: t(6) },
  ]

  const researchAgents = [shared(arie, { status: 'parked', since: t(600), convo: ctx(14, 258400, 3) }), shared(jeff, { status: 'parked', since: t(600) })]
  const research: FeedEntry[] = [
    { id: 'r1', kind: 'msg', from: 'you', to: 'arie', text: 'Collect what people say about the felt look in the reviews.', ts: t(26 * 60) },
    { id: 'r2', kind: 'reply', from: 'arie', to: 'you', re: 'r1', text: 'Done: 41 mentions, almost all of them happy. The full list is in `notes/felt.md`.', ts: t(25 * 60) },
    { id: 'r3', kind: 'event', from: 'crew', text: 'parked: @arie, @jeff stopped, and their conversations wait for the workspace to open again', ts: t(10 * 60) },
  ]

  const providers = { claude: { label: 'Claude' }, codex: { label: 'Codex' } }
  const base = { autopilot: true, providers, computers: [{ slug: 'studio-mac', name: 'Studio Mac', online: true }, { slug: 'mac-mini', name: 'Mac mini', online: true }] }
  return [
    { id: 'default', name: 'Home', color: null, icon: null, parked: false, state: { ...base, agents: [joseph, david, gal, ye, marc, clone(2, { status: 'working', since: t(4), activity: 'image_gen: empty Tasks board, felt look' }), clone(3, { status: 'working', since: t(1), activity: 'Read assets/brand/palette.md' }), arie, jeff, scarlett], feed: home, reads } },
    { id: 'golf', name: 'Golf app', color: 'teal', icon: null, parked: false, state: { ...base, agents: golfAgents, feed: golf, reads: { since: 0, agents: {} } } },
    { id: 'site', name: 'Website', color: 'pink', icon: null, parked: false, state: { ...base, agents: siteAgents, feed: site, reads: { since: 0, agents: {} } } },
    { id: 'research', name: 'Research', color: 'purple', icon: null, parked: true, state: { ...base, parked: true, agents: researchAgents, feed: research, reads: { since: 0, agents: { arie: t(1) } } } },
  ]
}

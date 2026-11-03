// An account's usage limits, from Claude Code's status line: reading them (and nothing that isn't a number), keeping
// the newest per provider until each window resets, saying once when a window passes 80% and 95%, and routing new
// work to agents on other providers among equal area matches. Real Hub, fake runner and clock, throwaway CREW_HOME.
// Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-usage-'))
const { Hub, CONFIG, bestFor, ownerFor } = await import('../core/hub.js')
const { limitsFrom } = await import('../core/context.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit() {}
  write() {}
}

const HOUR = 3600000
const CREW = [
  { name: 'joseph', area: 'backend api, servers' },
  { name: 'david', area: 'backend api, servers', provider: 'codex' },
  { name: 'gal', area: 'design, illustrations' },
  { name: 'zed', area: 'docs writing', provider: 'glm' },
]

let hub, runner, now
const newHub = () => {
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
  return hub
}
beforeEach(() => {
  mock.timers.reset()
  now = Date.UTC(2026, 9, 14, 12, 0)
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now })
  for (const f of ['usage.json', 'feed.jsonl', 'conversations.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CREW }))
  runner = new FakeRunner()
  newHub()
})
afterEach(() => {
  mock.timers.reset()
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
  clearTimeout(hub.usageTimer)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

// A status line from `name` with its context and the account's windows: { five_hour: [pct, hours until it resets] }
const line = (windows) => ({
  context_window: { context_window_size: 200000, used_percentage: 10, current_usage: { input_tokens: 20000 } },
  rate_limits: Object.fromEntries(Object.entries(windows).map(([id, [pct, hours]]) => [id, { used_percentage: pct, resets_at: (now + hours * HOUR) / 1000 }])),
})
const report = (name, windows) => hub.onStatusLine(name, line(windows))
// the readings as the UI gets them, without where they're heading (test/pace.test.js covers that)
const usage = (id = 'claude') => {
  const u = hub.snapshot().usage[id]
  return u && { ...u, windows: u.windows.map(({ pace, ...w }) => w) }
}
// the 80% and 95% heads-ups (the pace heads-up has its own tests)
const said = () => hub.feed.filter((e) => e.kind === 'event' && e.from === 'crew' && !/^At this pace/.test(e.text)).map((e) => e.text)

test('limits come out of the status line as numbers, each with when it resets', () => {
  const resets = (now + 2 * HOUR) / 1000
  assert.deepEqual(limitsFrom({ rate_limits: { five_hour: { used_percentage: 41.6, resets_at: resets }, seven_day: { used_percentage: 61, resets_at: resets + 86400 } } }, now), [
    { id: 'five_hour', pct: 42, resetsAt: now + 2 * HOUR },
    { id: 'seven_day', pct: 61, resetsAt: now + 2 * HOUR + 86400000 },
  ])
  // a gateway's spend limit counts too; percentages stay within 0..100
  assert.deepEqual(limitsFrom({ rate_limits: { spend_limit: { used_percentage: 140, resets_at: resets } } }, now), [{ id: 'spend_limit', pct: 100, resetsAt: now + 2 * HOUR }])
  assert.equal(limitsFrom({ rate_limits: { five_hour: { used_percentage: -5, resets_at: resets } } }, now)[0].pct, 0)
})

test('no limits, garbage and windows that already reset read as nothing', () => {
  const resets = (now + HOUR) / 1000
  for (const s of [undefined, null, {}, { rate_limits: null }, { rate_limits: 'lots' }, { rate_limits: {} }, { rate_limits: { five_hour: null } }]) assert.equal(limitsFrom(s, now), null)
  // numbers only: this arrives over the local API
  for (const w of [{ used_percentage: '42', resets_at: resets }, { used_percentage: 42, resets_at: '1792000000' }, { used_percentage: NaN, resets_at: resets }, { used_percentage: true, resets_at: resets }, { used_percentage: 42 }, { resets_at: resets }]) {
    assert.equal(limitsFrom({ rate_limits: { five_hour: w } }, now), null, JSON.stringify(w))
  }
  // a window whose reset time has passed is gone, the other stays
  assert.deepEqual(limitsFrom({ rate_limits: { five_hour: { used_percentage: 99, resets_at: (now - 1000) / 1000 }, seven_day: { used_percentage: 30, resets_at: resets } } }, now).map((w) => w.id), ['seven_day'])
})

test("the newest reading is the provider's, shown until each window resets, and kept across restarts", () => {
  report('joseph', { five_hour: [42, 2], seven_day: [61, 50] })
  assert.deepEqual(usage(), { label: 'Claude', at: now, windows: [{ id: 'five_hour', pct: 42, resetsAt: now + 2 * HOUR }, { id: 'seven_day', pct: 61, resetsAt: now + 50 * HOUR }] })
  // another agent on the same account reports later: its numbers are the account's
  report('gal', { five_hour: [47, 2], seven_day: [62, 50] })
  assert.deepEqual(usage().windows.map((w) => w.pct), [47, 62])
  // a status line without limits (a provider that doesn't report them) leaves the reading alone, and adds none for it
  hub.onStatusLine('zed', { context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } } })
  assert.equal(usage('glm'), undefined)
  assert.deepEqual(usage().windows.map((w) => w.pct), [47, 62])
  // the 5-hour window resets: it's gone until a status line reports the new one
  mock.timers.tick(2 * HOUR + 1000)
  assert.deepEqual(usage().windows.map((w) => w.id), ['seven_day'])
  // remembered across a restart, so the UI isn't blank until the next reply
  hub.saveUsage(true)
  newHub()
  assert.deepEqual(usage().windows.map((w) => [w.id, w.pct]), [['seven_day', 62]])
})

test("Crew's line in the terminal footer adds the 5-hour number", () => {
  assert.match(report('joseph', { five_hour: [42, 2], seven_day: [61, 50] }), /5h limit 42%/)
  hub.usage = {}
  assert.doesNotMatch(report('joseph', { seven_day: [61, 50] }), /5h limit/)
})

test('passing 80% and 95% is said once each per window, and a new window starts over', () => {
  const notices = []
  hub.on('notice', (n) => notices.push(n))
  report('joseph', { five_hour: [70, 3] })
  assert.deepEqual(said(), [])
  report('joseph', { five_hour: [82, 3] })
  report('joseph', { five_hour: [85, 3] })
  report('gal', { five_hour: [88, 3] }) // the same account, through another agent
  assert.equal(said().length, 1)
  assert.match(said()[0], /^Claude is at 82% of its 5-hour limit, resets at \d\d:\d\d$/)
  report('joseph', { five_hour: [96, 3] })
  report('joseph', { five_hour: [99, 3] })
  assert.equal(said().length, 2)
  assert.match(said()[1], /Claude is at 96% of its 5-hour limit/)
  assert.equal(hub.feed.filter((e) => e.from === 'crew' && e.text === said()[1]).at(-1).alert, true, '95% stands out in the chat')
  const limits = notices.filter((n) => !/^At this pace/.test(n.title))
  assert.equal(limits.length, 2)
  assert.match(limits[1].body, /other providers/)
  // the window resets: the next one is watched afresh
  mock.timers.tick(3 * HOUR + 1000)
  report('joseph', { five_hour: [81, 5] })
  assert.equal(said().length, 3)
  // the weekly window is its own, and says which day it resets
  report('joseph', { five_hour: [81, 5], seven_day: [95, 72] })
  assert.match(said().at(-1), /Claude is at 95% of its weekly limit, resets [A-Z][a-z]{2} at \d\d:\d\d/)
})

test('a jump straight past 95% is said once; a restart in the same window says nothing again', () => {
  report('joseph', { five_hour: [97, 3] })
  assert.equal(said().length, 1)
  hub.saveUsage(true)
  newHub()
  const before = said().length // the feed the new hub loaded, whatever of it was written yet
  report('joseph', { five_hour: [98, 3] })
  assert.equal(said().length, before)
})

test('near its limit, a provider loses ties on area to agents on other providers, and nothing else', () => {
  // joseph (Claude) and david (Codex) both cover the backend; joseph comes first while Claude has room
  report('joseph', { five_hour: [60, 3] })
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'joseph')
  assert.equal(ownerFor('backend api servers are down', hub.teammates()).name, 'joseph')
  // past 90% of the 5-hour (or weekly) window: david takes it, even with something in his queue
  report('joseph', { five_hour: [91, 3] })
  hub.agents.get('david').inbox.push({ id: 'x', text: 'earlier' })
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'david')
  assert.equal(ownerFor('backend api servers are down', hub.teammates()).name, 'david')
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'joseph').nearLimit, true)
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'david').nearLimit, false)
  // design is only gal's: it stays with her, limit or not
  assert.equal(hub.route('a new illustration for the design', 'you').name, 'gal')
  assert.equal(ownerFor('redo the illustrations', hub.teammates()).name, 'gal')
  // a spend limit alone doesn't count, nor does a window that has reset
  hub.usage = {}
  report('joseph', { spend_limit: [99, 3] })
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'joseph')
  report('joseph', { seven_day: [93, 1] })
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'david')
  mock.timers.tick(HOUR + 1000)
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'joseph')
})

test('bestFor: area first, then room on the account, then free, then the shortest queue', () => {
  const pick = (agents) => bestFor('backend api', agents).name
  assert.equal(pick([{ name: 'a', area: 'backend api', status: 'idle', queue: 0, nearLimit: true }, { name: 'b', area: 'backend api', status: 'working', queue: 2 }]), 'b')
  assert.equal(pick([{ name: 'a', area: 'backend api', status: 'idle', queue: 0, nearLimit: true }, { name: 'b', area: 'design', status: 'idle', queue: 0 }]), 'a')
  assert.equal(pick([{ name: 'a', area: 'backend api', status: 'working', queue: 1 }, { name: 'b', area: 'backend api', status: 'idle', queue: 0 }]), 'b')
})

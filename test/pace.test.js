// Where a usage window is heading at this pace (Side A's forecast, without a weekly rhythm), and the heads-up when one
// runs out before it resets. Against the real Hub with a fake runner in a throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-pace-'))
const { Hub, CONFIG, paceOf } = await import('../core/hub.js')
const MIN = 60000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const now = Date.now()

test('a week at the pace it has gone so far: where it ends up, and when it runs out if that comes first', () => {
  // two days in, 40% used: 20% a day, so 140% by the reset; 100% three days from now
  const fast = paceOf({ id: 'seven_day', pct: 40, resetsAt: now + 5 * DAY }, [], now)
  assert.equal(fast.projected, 140)
  assert.ok(Math.abs(fast.runsOut - (now + 3 * DAY)) < 1000)
  // a quiet week ends well under
  assert.deepEqual(paceOf({ id: 'seven_day', pct: 10, resetsAt: now + 5 * DAY }, [], now), { projected: 35, runsOut: null })
  // too early to say, nothing used yet, or a window of unknown length
  assert.equal(paceOf({ id: 'seven_day', pct: 3, resetsAt: now + 6.9 * DAY }, [], now), null)
  assert.equal(paceOf({ id: 'seven_day', pct: 0, resetsAt: now + 3 * DAY }, [], now), null)
  assert.equal(paceOf({ id: 'spend_limit', pct: 50, resetsAt: now + 3 * DAY }, [], now), null)
  // Codex names a window by its length: two hours, one in, half used
  assert.equal(paceOf({ id: 'window_120', pct: 50, resetsAt: now + HOUR }, [], now).projected, 100)
})

test('the 5-hour window goes at the pace of its last few minutes of readings', () => {
  const w = { id: 'five_hour', pct: 60, resetsAt: now + 2 * HOUR }
  // 50% to 60% over ten minutes: 1% a minute, so 100% in 40 minutes, well before the reset
  const burning = paceOf(w, [[now - 10 * MIN, 50], [now - 5 * MIN, 55], [now, 60]], now)
  assert.ok(Math.abs(burning.runsOut - (now + 40 * MIN)) < 1000)
  assert.equal(burning.projected, 180)
  // nothing used in those minutes: it stays where it is
  assert.deepEqual(paceOf(w, [[now - 10 * MIN, 60], [now, 60]], now), { projected: 60, runsOut: null })
  // readings too close together: the window's own pace (3 hours in, 60%: 20% an hour, so 100% in 2 hours, at the reset)
  assert.equal(paceOf(w, [[now - MIN, 59], [now, 60]], now).runsOut, null)
})

// ---- the hub -------------------------------------------------------------------------------------------------

class FakeRunner extends EventEmitter {
  live = new Set()
  running = (n) => this.live.has(n)
  start() {}
  stop() {}
  submit() {}
  write() {}
}
let hub, notices
beforeEach(() => {
  for (const f of ['feed.jsonl', 'usage.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'levi' }] }))
  hub = new Hub(new FakeRunner(), { bin: '/nonexistent' })
  notices = []
  hub.on('notice', (n) => notices.push(n))
})
afterEach(() => clearTimeout(hub.usageTimer))
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 5 }))

const paceLines = () => hub.feed.filter((e) => e.kind === 'event' && /At this pace/.test(e.text))

test('a heads-up once a window will run out before it resets, close enough to plan around, once per window', () => {
  // 60% two days into the week runs out in about 1.3 days: under 42 hours away, so you hear about it
  const week = { id: 'seven_day', pct: 60, resetsAt: now + 5 * DAY }
  hub.setUsage('claude', [week])
  assert.equal(paceLines().length, 1)
  assert.match(paceLines()[0].text, /^At this pace, Claude's weekly limit runs out .+, before it resets /)
  assert.equal(paceLines()[0].alert, true)
  assert.equal(notices.filter((n) => /At this pace/.test(n.title)).length, 1)
  hub.setUsage('claude', [{ ...week, pct: 61 }])
  assert.equal(paceLines().length, 1, 'once per window')
  // the snapshot carries the forecast for the UI
  const w = hub.snapshot().usage.claude.windows[0]
  assert.ok(w.pace.runsOut > now && w.pace.projected > 100)
})

test('no heads-up while running out is still far off, or never comes', () => {
  // 30% two days in: runs out in about 4.7 days, past the reset: nothing
  hub.setUsage('claude', [{ id: 'seven_day', pct: 30, resetsAt: now + 5 * DAY }])
  // a fast start to a long week: runs out before the reset, but more than 42 hours away
  hub.setUsage('codex', [{ id: 'seven_day', pct: 30, resetsAt: now + 6.2 * DAY }])
  assert.equal(paceLines().length, 0)
  assert.ok(hub.snapshot().usage.codex.windows[0].pace.runsOut, 'the forecast still says so on hover')
})

test('the 5-hour window learns its pace from the readings as they come in', () => {
  const at = (ago, pct) => ({ id: 'five_hour', pct, resetsAt: now + 2 * HOUR })
  hub.samples = { claude: { five_hour: [[now - 10 * MIN, 50, now + 2 * HOUR], [now - 5 * MIN, 55, now + 2 * HOUR]] } }
  hub.setUsage('claude', [at(0, 60)])
  assert.equal(paceLines().length, 1) // 40 minutes to go: under a quarter of five hours
  assert.match(paceLines()[0].text, /5-hour limit runs out/)
  // a drop is a new window: its readings start over
  hub.setUsage('claude', [{ id: 'five_hour', pct: 2, resetsAt: now + 5 * HOUR }])
  assert.equal(hub.samples.claude.five_hour.length, 1)
})

// An agent's own context limit: past it, a new conversation when the agent is free (or just a heads-up), and the
// gauges measured against the limit. Real Hub, fake runner, throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-limit-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { againstLimit } = await import('../core/context.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  starts = []
  running = (n) => this.live.has(n)
  start = (n) => (this.starts.push(n), this.live.add(n))
  stop = (n) => this.live.delete(n)
  submit() {}
  write() {}
}

let hub, runner
const setup = (agents) => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1' // launches go through the fake runner
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
}
beforeEach(() => setup([{ name: 'joseph', area: 'backend', contextLimit: 250000 }, { name: 'gal', area: 'design', contextLimit: 250000, onContextLimit: 'notify' }, { name: 'arie', area: 'admin' }]))
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

// Claude Code's status line with a 1M window and `used` tokens in it
const report = (name, used) => hub.onStatusLine(name, { context_window: { context_window_size: 1000000, used_percentage: used / 10000, current_usage: { input_tokens: used } } })
const view = (name) => hub.snapshot().agents.find((a) => a.name === name)
const events = (name) => hub.feed.filter((e) => e.kind === 'event' && e.from === name).map((e) => e.text)

test('the gauge and the status line measure against the limit, not the model window', () => {
  const line = report('joseph', 200000)
  assert.match(line, /context 80% · 200k of 250k limit/)
  assert.deepEqual({ ...view('joseph').convo.context }, { used: 200000, size: 250000, window: 1000000, limit: 250000, pct: 80 })
  assert.equal(view('joseph').contextLimit, 250000)
  assert.equal(view('arie').contextLimit, null)
})

test('past the limit while free: a new conversation right away', () => {
  runner.starts.length = 0
  report('joseph', 260000)
  assert.deepEqual(runner.starts, ['joseph'])
  assert.equal(hub.agents.get('joseph').status, 'starting')
  assert.match(events('joseph').at(-1), /started a new conversation \(it passed its 250k context limit\)/)
  assert.equal(hub.feed.at(-1).fresh, true)
})

test('past the limit mid-task: it finishes the task first', () => {
  const joseph = hub.agents.get('joseph')
  joseph.status = 'working'
  runner.starts.length = 0
  report('joseph', 300000)
  assert.equal(joseph.status, 'working')
  assert.equal(view('joseph').freshPending, true)
  assert.match(events('joseph').at(-1), /passed its 250k context limit \(300k used\), so it starts a new conversation when it finishes this task/)
  report('joseph', 310000) // more reports past the limit don't pile up
  assert.equal(events('joseph').length, 1)
  hub.onHook('joseph', { hook_event_name: 'Stop' })
  assert.deepEqual(runner.starts, ['joseph'])
  assert.match(events('joseph').at(-1), /started a new conversation \(it passed its 250k context limit\)/)
})

test('"notify" only tells you, once per conversation, and re-arms after the conversation shrinks', () => {
  const notices = []
  hub.on('notice', (n) => notices.push(n))
  runner.starts.length = 0
  report('gal', 260000)
  report('gal', 270000)
  assert.deepEqual(runner.starts, [])
  assert.equal(notices.length, 1)
  assert.match(notices[0].title, /@gal passed its 250k context limit/)
  assert.equal(hub.feed.at(-1).alert, true)
  report('gal', 90000) // compacted
  report('gal', 255000)
  assert.equal(notices.length, 2)
})

test('setting a limit the conversation is already past acts on it; no limit, or one past the window, does nothing', () => {
  runner.starts.length = 0
  report('arie', 400000)
  assert.deepEqual(runner.starts, [])
  hub.update('arie', { contextLimit: 2000000 }) // bigger than the window: the window is the limit
  assert.deepEqual(runner.starts, [])
  assert.equal(view('arie').convo.context.size, 1000000)
  hub.update('arie', { contextLimit: 300000 })
  assert.deepEqual(runner.starts, ['arie'])
})

test('an agent that is off or exited is left alone', () => {
  hub.agents.get('joseph').status = 'stopped'
  runner.starts.length = 0
  report('joseph', 400000)
  assert.deepEqual(runner.starts, [])
})

test('againstLimit keeps numbers sane', () => {
  assert.equal(againstLimit(null, 1000), null)
  assert.deepEqual(againstLimit({ used: 10, size: 100, pct: 10 }, 0), { used: 10, size: 100, pct: 10 })
  assert.equal(againstLimit({ used: 500, size: 1000, pct: 50 }, 'x').pct, 50)
  assert.equal(againstLimit({ used: 900, size: 1000, pct: 90 }, 600).pct, 100)
})

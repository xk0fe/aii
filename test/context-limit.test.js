// An agent's own context limit: past it, a new conversation when the agent is free (or just a heads-up), and the
// gauges measured against the limit. Before the new conversation the agent says where things stand, and an
// unfinished task carries over. Real Hub, fake runner and clock, throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
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
  submitted = []
  running = (n) => this.live.has(n)
  start = (n) => (this.starts.push(n), this.live.add(n))
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.submitted.push(text)
  write() {}
}

let hub, runner
const setup = (agents) => {
  mock.timers.reset()
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1' // launches go through the fake runner
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
}
beforeEach(() => setup([{ name: 'joseph', area: 'backend', contextLimit: 250000 }, { name: 'gal', area: 'design', contextLimit: 250000, onContextLimit: 'notify' }, { name: 'arie', area: 'admin' }]))
afterEach(() => {
  mock.timers.reset()
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

// Claude Code's status line with a 1M window and `used` tokens in it
const report = (name, used) => hub.onStatusLine(name, { context_window: { context_window_size: 1000000, used_percentage: used / 10000, current_usage: { input_tokens: used } } })
const view = (name) => hub.snapshot().agents.find((a) => a.name === name)
const events = (name) => hub.feed.filter((e) => e.kind === 'event' && e.from === name).map((e) => e.text)
// Crew asks where things stand, and the agent answers (a turn of its own)
const asked = () => runner.submitted.at(-1)?.includes('passed its context limit, so a new one starts after this reply')
const answer = (name, text) => {
  hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt: runner.submitted.at(-1) })
  hub.onHook(name, { hook_event_name: 'Stop', last_assistant_message: text })
}
// a turn on a message: it's typed in, taken up, and ends
const turn = (name, prompt, stop = {}) => {
  hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt })
  hub.onHook(name, { hook_event_name: 'Stop', last_assistant_message: 'ok', ...stop })
}
const up = (name) => (hub.onHook(name, { hook_event_name: 'SessionStart', source: 'startup' }), mock.timers.tick(3000))

test('the gauge and the status line measure against the limit, not the model window', () => {
  const line = report('joseph', 200000)
  assert.match(line, /context 80% · 200k of 250k limit/)
  assert.deepEqual({ ...view('joseph').convo.context }, { used: 200000, size: 250000, window: 1000000, limit: 250000, pct: 80 })
  assert.equal(view('joseph').contextLimit, 250000)
  assert.equal(view('arie').contextLimit, null)
})

test('past the limit while free: it says it was done, then a new conversation', () => {
  runner.starts.length = 0
  report('joseph', 260000)
  assert.ok(asked())
  assert.deepEqual(runner.starts, [])
  answer('joseph', 'done')
  assert.deepEqual(runner.starts, ['joseph'])
  assert.equal(hub.agents.get('joseph').status, 'starting')
  assert.match(events('joseph').at(-1), /started a new conversation \(it passed its 250k context limit\)$/)
  assert.equal(hub.feed.at(-1).fresh, true)
  assert.equal(hub.feed.filter((e) => e.kind === 'reply').length, 0) // its answer is for Crew, not the chat
  assert.equal(hub.agents.get('joseph').inbox.length, 0)
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
  mock.timers.tick(1000)
  assert.ok(asked())
  answer('joseph', 'Done.')
  assert.deepEqual(runner.starts, ['joseph'])
  assert.match(events('joseph').at(-1), /started a new conversation \(it passed its 250k context limit\)$/)
})

test('an unfinished task carries over: where it left off is the first thing in the new conversation', () => {
  hub.send({ to: 'joseph', text: 'fix the payload' })
  const task = hub.feed.find((e) => e.text === 'fix the payload')
  hub.onHook('joseph', { hook_event_name: 'UserPromptSubmit', prompt: runner.submitted.at(-1) })
  report('joseph', 300000)
  hub.onHook('joseph', { hook_event_name: 'Stop', last_assistant_message: 'Waiting on the build.' })
  mock.timers.tick(1000)
  runner.starts.length = 0
  answer('joseph', 'Not finished. Worktree bga-payload, branch fix/payload, fix committed. Left: run the sim check, open the PR.')
  assert.deepEqual(runner.starts, ['joseph'])
  assert.match(events('joseph').at(-1), /started a new conversation \(it passed its 250k context limit\), and picks up where it left off: Not finished\. Worktree bga-payload/)
  up('joseph')
  assert.match(runner.submitted.at(-1), /^\[crew\] Your last conversation passed its context limit[\s\S]*branch fix\/payload[\s\S]*open the PR\.\n\nCheck where things stand, then carry on\.$/)
  // its reply threads to the task it was on
  hub.onHook('joseph', { hook_event_name: 'UserPromptSubmit', prompt: runner.submitted.at(-1) })
  hub.onHook('joseph', { hook_event_name: 'Stop', last_assistant_message: 'PR is open.' })
  assert.equal(hub.feed.at(-1).re, task.id)
})

test('stopped before it says where things stand: the new conversation starts anyway', () => {
  report('joseph', 260000)
  assert.ok(asked())
  hub.onHook('joseph', { hook_event_name: 'UserPromptSubmit', prompt: runner.submitted.at(-1) })
  runner.starts.length = 0
  hub.onHook('joseph', { hook_event_name: 'Interrupt' })
  assert.deepEqual(runner.starts, ['joseph'])
  assert.match(events('joseph').at(-1), /started a new conversation \(it passed its 250k context limit\)$/)
})

test('it waits for what it left running in the background, then asks', () => {
  const joseph = hub.agents.get('joseph')
  joseph.status = 'working'
  report('joseph', 300000)
  hub.onHook('joseph', { hook_event_name: 'Stop', last_assistant_message: "I'll screenshot once the bundle loads.", background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'metro' }] })
  mock.timers.tick(1000)
  assert.ok(!asked())
  assert.match(events('joseph').at(-1), /waits for the task it left running in the background, then starts a new conversation/)
  // the build is done: it's called back, and this time nothing is left running
  turn('joseph', '<task-notification>bundle loaded</task-notification>', { background_tasks: [] })
  mock.timers.tick(1000)
  assert.ok(asked())
  answer('joseph', 'done')
  assert.equal(joseph.status, 'starting')
})

test('a new task while it waits on the background: it says where things stand, and the task goes to the new conversation', () => {
  const joseph = hub.agents.get('joseph')
  joseph.status = 'working'
  report('joseph', 300000)
  hub.onHook('joseph', { hook_event_name: 'Stop', background_tasks: [{ id: 'm1', type: 'shell', status: 'running', description: 'dev server' }] })
  mock.timers.tick(1000)
  hub.send({ to: 'joseph', text: 'next: the header' })
  assert.ok(asked())
  answer('joseph', 'done')
  assert.equal(joseph.status, 'starting')
  up('joseph')
  assert.equal(runner.submitted.at(-1), 'next: the header')
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
  assert.ok(asked())
  answer('arie', 'done')
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

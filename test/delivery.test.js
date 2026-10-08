// Delivery: typing a message into an agent's terminal so that it really gets submitted, even on a loaded Mac where
// the CLI stalls. Real Hub and Runner, fake pty and clock, throwaway CREW_HOME. `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-delivery-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { Runner } = await import('../core/runner.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  submitted = []
  writes = []
  quiet = Infinity // ms since the terminal last drew something
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (name, text) => this.submitted.push({ name, text })
  write = (name, data) => this.writes.push({ name, data })
  quietFor = () => this.quiet
}

let hub, runner
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'levi', area: 'client code' }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1'
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
})
afterEach(async () => {
  mock.timers.reset()
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'reapTimer']) clearTimeout(a[t])
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
  await hub.saving // feed.jsonl is appended in the background: let it land before the next test, or the cleanup, clears it
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

const levi = () => hub.agents.get('levi')
const enters = () => runner.writes.filter((w) => w.data === '\r').length
const alerts = () => hub.feed.filter((e) => e.kind === 'event' && e.alert)

test('the runner pastes even one-line text, then presses Enter on its own', () => {
  const r = new Runner()
  const writes = []
  r.procs.set('levi', { p: { write: (d) => writes.push(d) }, lastOutput: Date.now() })
  r.submit('levi', 'fix the header')
  assert.deepEqual(writes, ['\x1b[200~fix the header\x1b[201~'])
  mock.timers.tick(150)
  assert.deepEqual(writes.at(-1), '\r')
})

test('the runner knows how long a terminal has been quiet', () => {
  const r = new Runner()
  r.procs.set('levi', { lastOutput: Date.now() })
  mock.timers.tick(900)
  assert.equal(r.quietFor('levi'), 900)
  assert.equal(r.quietFor('nobody'), 0)
})

test('a message waits while the terminal is still drawing, and goes in once it settles', () => {
  runner.quiet = 0 // a Stop hook's spinner
  hub.send({ to: 'levi', text: 'fix the header' })
  assert.equal(runner.submitted.length, 0)
  mock.timers.tick(5000)
  assert.equal(runner.submitted.length, 0)
  runner.quiet = 1000
  mock.timers.tick(700)
  assert.deepEqual(runner.submitted.map((s) => s.text), ['fix the header'])
})

test('a terminal that never settles still gets the message, after SETTLE_MAX', () => {
  runner.quiet = 0
  hub.send({ to: 'levi', text: 'fix the header' })
  mock.timers.tick(19000)
  assert.equal(runner.submitted.length, 0)
  mock.timers.tick(1500)
  assert.equal(runner.submitted.length, 1)
})

// Each retry schedules the next from inside a timer, so the clock moves in steps the way real time would.
const wait = (ms) => {
  for (let t = 0; t < ms; t += 500) mock.timers.tick(500)
}

test('Enter is pressed again for minutes, and only then does Crew call for help', () => {
  hub.send({ to: 'levi', text: 'fix the header' })
  wait(20000) // the old code gave up here
  assert.equal(alerts().length, 0)
  wait(111000)
  assert.equal(enters(), 7)
  assert.equal(alerts().length, 0)
  wait(61000)
  assert.equal(alerts().length, 1)
  assert.equal(levi().status, 'waiting')
})

test('the agent reporting the prompt stops the Enter presses', () => {
  hub.send({ to: 'levi', text: 'fix the header' })
  mock.timers.tick(2500)
  hub.onHook('levi', { hook_event_name: 'UserPromptSubmit', prompt: '[from @you] fix the header' })
  mock.timers.tick(300000)
  assert.equal(enters(), 1)
  assert.equal(alerts().length, 0)
})

test('no Enter while you are typing in its terminal', () => {
  hub.send({ to: 'levi', text: 'fix the header' })
  mock.timers.tick(2000)
  hub.input('levi', 'w')
  mock.timers.tick(600) // the first retry is due now, but you typed 600ms ago
  assert.equal(enters(), 0)
})

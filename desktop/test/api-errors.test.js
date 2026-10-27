// A turn an API error cut short (Claude Code's StopFailure): a dropped connection or a busy server gets a "continue"
// from Crew, a few times; anything else, or one too many, calls you. Real Hub, fake runner and clock, throwaway
// CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-api-errors-'))
const { Hub, CONFIG } = await import('../core/hub.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  submitted = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.submitted.push(text)
  write() {}
}

let hub, runner, levi, task
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'levi', area: 'client code' }, { name: 'gal', area: 'design' }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1'
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
  levi = hub.agents.get('levi')
  // levi is on a task when the error hits
  hub.send({ to: 'levi', text: 'build option C' })
  task = hub.feed.find((e) => e.text === 'build option C')
  hook({ hook_event_name: 'UserPromptSubmit', prompt: runner.submitted.at(-1) })
})
afterEach(async () => {
  mock.timers.reset()
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'retryTimer']) clearTimeout(a[t])
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
  await hub.saving
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

const hook = (e) => hub.onHook('levi', e)
const fail = (error, text = 'API Error: Connection lost mid-response.') => hook({ hook_event_name: 'StopFailure', error, last_assistant_message: text })
const events = () => hub.feed.filter((e) => e.kind === 'event' && e.from === 'levi').map((e) => e.text)

test('a dropped connection: Crew types "continue", and the turn goes on answering the same task', () => {
  const tasks = hub.stats.levi.tasks
  fail('server_error')
  assert.equal(levi.status, 'working')
  assert.match(events().at(-1), /lost its turn to an API error \(server_error\), so Crew types "continue" for it in 20s/)
  mock.timers.tick(19000)
  assert.notEqual(runner.submitted.at(-1), 'continue')
  mock.timers.tick(1000)
  assert.equal(runner.submitted.at(-1), 'continue')
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  assert.equal(hub.feed.filter((e) => e.text === 'continue').length, 0) // not a message of yours in the chat
  assert.equal(hub.stats.levi.tasks, tasks) // nor a new task
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Option C is up as a PR.' })
  assert.equal(hub.feed.at(-1).re, task.id)
  assert.equal(levi.status, 'idle')
})

test('it waits longer each time, and after three tries it calls you', () => {
  for (const [wait, said] of [[20000, '20s'], [60000, '1 min'], [180000, '3 min']]) {
    fail('overloaded', 'API Error: 529 Overloaded.')
    assert.match(events().at(-1), new RegExp(`in ${said}$`))
    mock.timers.tick(wait)
    assert.equal(runner.submitted.at(-1), 'continue')
    hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  }
  fail('overloaded', 'API Error: 529 Overloaded.')
  assert.equal(levi.status, 'waiting')
  assert.match(events().at(-1), /stopped on an API error \(overloaded\): API Error: 529 Overloaded\. Type "continue" in its terminal/)
  assert.equal(hub.feed.at(-1).alert, true)
})

test('a usage limit is for you, right away', () => {
  fail('rate_limit', "You've hit your session limit · resets 9:10pm")
  assert.equal(levi.status, 'waiting')
  assert.match(events().at(-1), /stopped on an API error \(rate_limit\): You've hit your session limit · resets 9:10pm/)
  mock.timers.tick(200000)
  assert.ok(!runner.submitted.includes('continue'))
})

test('a turn that ends well starts the count again', () => {
  fail('server_error')
  mock.timers.tick(20000)
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' })
  hub.send({ to: 'levi', text: 'and the TV mirror' })
  hook({ hook_event_name: 'UserPromptSubmit', prompt: runner.submitted.at(-1) })
  fail('server_error')
  assert.match(events().at(-1), /in 20s$/)
})

test('you typed in its terminal first: no "continue" from Crew', () => {
  fail('server_error')
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'go on with the captures' })
  mock.timers.tick(30000)
  assert.ok(!runner.submitted.includes('continue'))
})

test('while it waits, no "needs your input" alert, and no question is typed into it', () => {
  fail('server_error')
  hook({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  assert.equal(levi.status, 'working')
  assert.ok(!events().some((t) => /waiting for your input/.test(t)))
  const before = runner.submitted.length
  hub.question({ from: 'gal', to: 'levi', text: 'is C up yet?' })
  assert.equal(runner.submitted.length, before) // it goes in once the turn is going again
  mock.timers.tick(20000)
  assert.equal(runner.submitted.at(-1), 'continue')
})

// A turn an API error cut short (Claude Code's StopFailure): a dropped connection or a busy server gets a "continue"
// from CLIque, a few times; anything else, or one too many, calls you, with a card in the chat that says how it goes on
// (Continue, Leave it). Real Hub, fake runner and clock, throwaway CLIQUE_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-api-errors-'))
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

let hub, runner, noor, task
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'noor', area: 'client code' }, { name: 'iris', area: 'design' }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1'
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
  noor = hub.agents.get('noor')
  // noor is on a task when the error hits
  hub.send({ to: 'noor', text: 'build option C' })
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
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

const hook = (e) => hub.onHook('noor', e)
const fail = (error, text = 'API Error: Connection lost mid-response.') => hook({ hook_event_name: 'StopFailure', error, last_assistant_message: text })
const events = () => hub.feed.filter((e) => e.kind === 'event' && e.from === 'noor').map((e) => e.text)
const card = () => hub.feed.findLast((e) => e.kind === 'ask' && e.from === 'noor')
const pick = (label) => hub.answer(card().id, { answers: { [card().ask.questions[0].question]: label } })

test('a dropped connection: CLIque types "continue", and the turn goes on answering the same task', () => {
  const tasks = hub.stats.noor.tasks
  fail('server_error')
  assert.equal(noor.status, 'working')
  assert.match(events().at(-1), /lost its turn to an API error \(server_error\), so CLIque types "continue" for it in 20s/)
  mock.timers.tick(19000)
  assert.notEqual(runner.submitted.at(-1), 'continue')
  mock.timers.tick(1000)
  assert.equal(runner.submitted.at(-1), 'continue')
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  assert.equal(hub.feed.filter((e) => e.text === 'continue').length, 0) // not a message of yours in the chat
  assert.equal(hub.stats.noor.tasks, tasks) // nor a new task
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Option C is up as a PR.' })
  assert.equal(hub.feed.at(-1).re, task.id)
  assert.equal(noor.status, 'idle')
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
  assert.equal(noor.status, 'waiting')
  // a card in the chat, not "type continue in its terminal"
  assert.equal(card().ask.stuck, 'api')
  assert.equal(card().ask.questions[0].question, 'Stopped on an API error (overloaded): API Error: 529 Overloaded.')
  assert.deepEqual(card().ask.questions[0].options.map((o) => o.label), ['Continue', 'Leave it'])
  assert.equal(hub.asking('noor'), true, 'nothing goes into its turn meanwhile')
})

test('Continue on its card: CLIque types "continue", and the turn goes on answering the same task', () => {
  for (const wait of [20000, 60000, 180000]) (fail('overloaded'), mock.timers.tick(wait), hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue' }))
  fail('overloaded')
  pick('Continue')
  assert.equal(runner.submitted.at(-1), 'continue')
  assert.equal(noor.status, 'working')
  assert.deepEqual(card().answer.answers, { [card().ask.questions[0].question]: 'Continue' })
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Option C is up as a PR.' })
  assert.equal(hub.feed.at(-1).re, task.id)
})

test('Leave it: its turn ends there, and what waited for it goes in', () => {
  fail('rate_limit', "You've hit your session limit · resets 9:10pm")
  hub.send({ to: 'noor', text: 'and the TV mirror' })
  const before = runner.submitted.length
  pick('Leave it')
  assert.equal(card().answer.by, 'you')
  noor.holdUntil = 0
  hub.pump(noor)
  assert.match(runner.submitted.slice(before).join('\n'), /and the TV mirror/)
  assert.ok(!runner.submitted.includes('continue'))
})

test('"continue" typed in its terminal instead: the card says so', () => {
  fail('rate_limit', "You've hit your session limit · resets 9:10pm")
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  assert.equal(card().answer.by, 'terminal')
  assert.equal(noor.status, 'working')
})

test('signed out: the card says to sign it in again first', () => {
  fail('authentication_failed', 'Please run /login')
  assert.match(card().ask.questions[0].question, /\(authentication_failed\): Please run \/login\. Sign it in again under Accounts first\.$/)
})

test('a usage limit is for you, right away', () => {
  fail('rate_limit', "You've hit your session limit · resets 9:10pm")
  assert.equal(noor.status, 'waiting')
  assert.match(card().ask.alert, /stopped on an API error \(rate_limit\): You've hit your session limit · resets 9:10pm/)
  mock.timers.tick(200000)
  assert.ok(!runner.submitted.includes('continue'))
})

test('a turn that ends well starts the count again', () => {
  fail('server_error')
  mock.timers.tick(20000)
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' })
  hub.send({ to: 'noor', text: 'and the TV mirror' })
  hook({ hook_event_name: 'UserPromptSubmit', prompt: runner.submitted.at(-1) })
  fail('server_error')
  assert.match(events().at(-1), /in 20s$/)
})

test('you typed in its terminal first: no "continue" from CLIque', () => {
  fail('server_error')
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'go on with the captures' })
  mock.timers.tick(30000)
  assert.ok(!runner.submitted.includes('continue'))
})

test('while it waits, no "needs your input" alert, and no question is typed into it', () => {
  fail('server_error')
  hook({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  assert.equal(noor.status, 'working')
  assert.ok(!events().some((t) => /waiting for your input/.test(t)))
  const before = runner.submitted.length
  hub.question({ from: 'iris', to: 'noor', text: 'is C up yet?' })
  assert.equal(runner.submitted.length, before) // it goes in once the turn is going again
  mock.timers.tick(20000)
  assert.equal(runner.submitted.at(-1), 'continue')
})

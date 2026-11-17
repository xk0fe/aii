// Send now: a message of yours for a busy agent, sent without waiting for its turn to end. Into the turn (typed in, as
// you would in its terminal, and taken in at its next step), or Stop and send (the turn ends and the message is next).
// Real Hub, fake terminals and clock, throwaway CLIQUE_HOME; the last tests go through Clique, as the app does. `npm test`.
import { test as nodeTest, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-send-now-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn)

const ESC = '\x1b'
const CTRL_C = '\x03'

// A terminal that says how long it has drawn nothing: `drawing` names the agents whose CLI is still at work.
class FakeRunner extends EventEmitter {
  live = new Set()
  submitted = []
  writes = []
  drawing = new Set()
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (name, text) => this.submitted.push({ name, text })
  write = (name, data) => this.writes.push({ name, data })
  quietFor = (n) => (this.drawing.has(n) ? 20 : 60000)
}

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-send-now-app-'))
let hub, runner
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() })
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json', 'tickets.json']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [
    { name: 'ada', area: 'backend api', cwd: DIR },
    { name: 'june', area: 'docs, release notes', cwd: DIR },
    { name: 'theo', area: 'qa, tests', cwd: DIR, provider: 'codex' },
  ] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1'
  for (const a of hub.agents.values()) if (!a.off) (runner.live.add(a.name), (a.status = 'idle'))
})
afterEach(async () => {
  mock.timers.reset()
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'reapTimer', 'stopTimer', 'steerTimer']) clearTimeout(a[t])
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
  await hub.saving
})
after(() => {
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 10 })
})

const agent = (n) => hub.agents.get(n)
const typedInto = (n) => runner.submitted.filter((s) => s.name === n).map((s) => s.text)
const keys = (n) => runner.writes.filter((w) => w.name === n).map((w) => w.data)
const pickUp = (n) => hub.onHook(n, { hook_event_name: 'UserPromptSubmit', prompt: typedInto(n).at(-1) })
const done = (n, said = 'Done.') => hub.onHook(n, { hook_event_name: 'Stop', last_assistant_message: said })
const yours = (text) => hub.feed.findLast((e) => e.kind === 'msg' && e.from === 'you' && e.text === text)
// you ask `n` something, and it's at work on it
const atWork = (n, text = 'make the totals agree') => {
  hub.send({ to: n, text })
  mock.timers.tick(1500)
  pickUp(n)
  assert.equal(agent(n).status, 'working')
  runner.drawing.add(n)
}
// its terminal falls silent, and CLIque has looked
const quiet = (n) => {
  runner.drawing.delete(n)
  mock.timers.tick(1500)
}

test('as before: what you send a busy agent waits for its turn to end, and goes in as a turn of its own', () => {
  atWork('ada')
  assert.match(hub.send({ to: 'ada', text: 'the sign-in page shows an error' }), /^queued for @ada/)
  const m = yours('the sign-in page shows an error')
  assert.equal(m.queued, true)
  assert.equal(typedInto('ada').length, 1, 'nothing typed into the turn')
  mock.timers.tick(10 * 60000)
  assert.equal(typedInto('ada').length, 1, 'however long the turn takes')
  runner.drawing.delete('ada')
  done('ada')
  mock.timers.tick(1500)
  assert.equal(typedInto('ada').at(-1), 'the sign-in page shows an error')
  assert.equal(m.queued, false)
})

test('Send now: the waiting message is typed into the turn the agent is in, which goes on', () => {
  atWork('ada')
  hub.send({ to: 'ada', text: 'the sign-in page shows an error' })
  const m = yours('the sign-in page shows an error')
  assert.equal(hub.sendNow(m.id), 'sent to @ada\n')
  assert.deepEqual(typedInto('ada'), ['make the totals agree', 'the sign-in page shows an error'], 'as you typed it, into its terminal')
  assert.equal(m.queued, false)
  assert.equal(agent('ada').inbox.length, 0)
  assert.equal(agent('ada').status, 'working', 'its turn goes on')
  assert.deepEqual(keys('ada'), [], 'nothing was stopped')
  // its CLI takes it in at its next step: it's part of this turn now
  pickUp('ada')
  assert.equal(agent('ada').status, 'working')
  assert.equal(agent('ada').steering, null)
  assert.deepEqual(agent('ada').serving.map((x) => x.text), ['make the totals agree', 'the sign-in page shows an error'])
  // and the turn's reply answers both
  done('ada', 'Totals agree, and the sign-in error is fixed.')
  const reply = hub.feed.at(-1)
  assert.equal(reply.kind, 'reply')
  assert.equal(reply.re, yours('make the totals agree').id)
  assert.deepEqual(reply.also, [m.id])
})

test('Send now: a turn that ends before its CLI took the message in starts the next one with it', () => {
  atWork('ada')
  hub.send({ to: 'ada', text: 'also bump the version' })
  const m = yours('also bump the version')
  hub.sendNow(m.id)
  assert.equal(typedInto('ada').length, 2)
  runner.drawing.delete('ada')
  done('ada')
  // the CLI didn't start a turn with it by itself: back in line, first, and typed in as the next prompt
  mock.timers.tick(5000)
  mock.timers.tick(1500)
  assert.equal(typedInto('ada').length, 3)
  assert.equal(typedInto('ada').at(-1), 'also bump the version')
  pickUp('ada')
  assert.equal(agent('ada').current, m.id)
  assert.equal(m.queued, false)
})

test('Send now with a dialog up in its terminal: it goes in the moment the agent is at work again', () => {
  atWork('ada')
  hub.setStatus(agent('ada'), 'waiting') // a permission prompt: nothing can be typed over it
  hub.send({ to: 'ada', text: 'use the staging key' })
  const m = yours('use the staging key')
  assert.match(hub.sendNow(m.id), /^it goes to @ada as soon as /)
  assert.equal(typedInto('ada').length, 1)
  assert.deepEqual([m.queued, m.now], [true, true], 'still waiting, and marked to go in first chance')
  hub.setStatus(agent('ada'), 'working') // you answered
  assert.equal(typedInto('ada').at(-1), 'use the staging key')
  assert.equal(m.queued, false)
})

test('Send now is for the message you picked: the others keep waiting', () => {
  atWork('ada')
  agent('june').status = 'working'
  hub.send({ from: 'june', to: 'ada', text: 'the release notes need the new endpoint names' })
  hub.send({ to: 'ada', text: 'first' })
  hub.send({ to: 'ada', text: 'second' })
  hub.sendNow(yours('second').id)
  assert.equal(typedInto('ada').at(-1), 'second')
  assert.deepEqual(agent('ada').inbox.map((x) => x.text), ['the release notes need the new endpoint names', 'first'])
  assert.equal(yours('first').queued, true)
})

test('Stop and send: the turn ends, nothing waiting is withdrawn, and the message goes in first', () => {
  atWork('ada')
  agent('june').status = 'working'
  hub.send({ from: 'june', to: 'ada', text: 'the release notes need the new endpoint names' })
  hub.send({ to: 'ada', text: 'stop waiting for the browser, the sign-in failed' })
  const m = yours('stop waiting for the browser, the sign-in failed')
  assert.match(hub.sendNow(m.id, { stop: true }), /^stopped @ada/)
  assert.deepEqual(keys('ada'), [ESC])
  assert.equal(agent('ada').status, 'idle')
  assert.deepEqual(agent('ada').inbox.map((x) => x.text), ['stop waiting for the browser, the sign-in failed', 'the release notes need the new endpoint names'], 'yours first, the rest still there')
  assert.equal(hub.feed.filter((e) => e.dropped).length, 0, 'nothing marked as not delivered')
  assert.equal(hub.feed.at(-1).text, 'you stopped @ada to send your message now')
  assert.equal(typedInto('ada').length, 1, 'nothing typed until the turn has really ended')
  // its terminal goes quiet: the turn is over, its prompt box is emptied, and your message goes in
  quiet('ada')
  assert.deepEqual(keys('ada'), [ESC, CTRL_C])
  mock.timers.tick(2500)
  assert.equal(typedInto('ada').at(-1), 'stop waiting for the browser, the sign-in failed')
  assert.equal(m.queued, false)
  pickUp('ada')
  assert.equal(agent('ada').status, 'working')
  assert.equal(agent('ada').current, m.id)
  // and what waited behind it goes in after, as after any turn
  runner.drawing.delete('ada')
  done('ada')
  mock.timers.tick(1500)
  assert.match(typedInto('ada').at(-1), /the release notes need the new endpoint names/)
})

test('Stop and send on Codex: Esc, and no Ctrl+C (which would quit it)', () => {
  atWork('theo')
  hub.send({ to: 'theo', text: 'run only the checkout suite' })
  const m = yours('run only the checkout suite')
  hub.sendNow(m.id, { stop: true })
  hub.onHook('theo', { hook_event_name: 'Interrupt' })
  runner.drawing.delete('theo')
  mock.timers.tick(3000)
  assert.deepEqual(keys('theo'), [ESC])
  assert.equal(typedInto('theo').at(-1), 'run only the checkout suite')
})

test('Stop and send takes back what CLIque had typed into the turn and not yet seen taken: it goes in again after', () => {
  atWork('ada')
  hub.send({ to: 'ada', text: 'first thing' })
  hub.sendNow(yours('first thing').id) // typed into the turn, its CLI hasn't taken it in
  assert.ok(agent('ada').steering)
  hub.send({ to: 'ada', text: 'no, drop everything: prod is down' })
  hub.sendNow(yours('no, drop everything: prod is down').id, { stop: true })
  assert.equal(agent('ada').steering, null)
  assert.deepEqual(agent('ada').inbox.map((x) => x.text), ['no, drop everything: prod is down', 'first thing'])
  assert.equal(yours('first thing').queued, true)
})

test('a task or a new conversation has no part in the turn: only Stop and send takes it', () => {
  atWork('ada')
  hub.send({ to: 'ada', text: 'start over on the importer', fresh: true })
  const m = yours('start over on the importer')
  assert.throws(() => hub.sendNow(m.id), /a new conversation starts on its own/)
  assert.equal(m.queued, true)
  assert.equal(typedInto('ada').length, 1)
  hub.sendNow(m.id, { stop: true })
  assert.deepEqual(keys('ada'), [ESC])
  assert.equal(agent('ada').inbox[0], m)
})

test('only a message of yours that is still waiting', () => {
  atWork('ada')
  agent('june').status = 'working'
  hub.send({ from: 'june', to: 'ada', text: 'a hand-off' })
  const handoff = hub.feed.findLast((e) => e.from === 'june')
  assert.throws(() => hub.sendNow(handoff.id), /isn't waiting any more/)
  assert.throws(() => hub.sendNow('nope'), /isn't waiting any more/)
  hub.send({ to: 'ada', text: 'one' })
  const m = yours('one')
  hub.sendNow(m.id)
  assert.throws(() => hub.sendNow(m.id), /isn't waiting any more/, 'already in')
  assert.equal(typedInto('ada').filter((t) => t === 'one').length, 1, 'typed once')
})

test('Stop and send with no turn to end (the agent is starting up): the message is simply next', () => {
  agent('ada').status = 'starting'
  hub.send({ to: 'ada', text: 'first' })
  hub.send({ to: 'ada', text: 'second' })
  assert.equal(hub.sendNow(yours('second').id, { stop: true }), "it's the next thing @ada gets\n")
  assert.deepEqual(keys('ada'), [])
  assert.deepEqual(agent('ada').inbox.map((x) => x.text), ['second', 'first'])
})

test('a message sent with now: it goes into a busy agent\'s turn at once, and to a free one as always', () => {
  atWork('ada')
  assert.equal(hub.send({ to: 'ada', text: 'heads up: the API key rotated', now: true }), 'sent to @ada\n')
  assert.equal(typedInto('ada').at(-1), 'heads up: the API key rotated')
  assert.equal(yours('heads up: the API key rotated').queued, false)
  // a free agent: nothing different
  assert.equal(hub.send({ to: 'june', text: 'draft the notes', now: true }), 'sent to @june\n')
  mock.timers.tick(1500)
  assert.equal(typedInto('june').at(-1), 'draft the notes')
  // an agent's hand-off can't jump the line with it
  agent('june').status = 'working'
  hub.send({ from: 'june', to: 'ada', text: 'review my notes', now: true })
  assert.equal(hub.feed.findLast((e) => e.from === 'june').queued, true)
  assert.equal(hub.feed.findLast((e) => e.from === 'june').now, undefined)
})

// ---- through Clique, as the app's chat sends it ----------------------------------------------------------------

test('Clique.send with now, and Send now on a waiting message, as the app calls them', async () => {
  const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
  const typed = []
  const wrote = []
  Object.assign(clique.runner, { running: () => true, submit: (n, t) => typed.push([n, t]), write: (n, d) => wrote.push([n, d]), quietFor: () => 60000 })
  const here = clique.hubs.get('default')
  try {
    for (const a of here.agents.values()) a.status = 'idle'
    await clique.send('ada', 'make the totals agree')
    mock.timers.tick(700)
    here.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: typed.at(-1)[1] })
    // ⌘Enter: straight into the turn
    assert.equal(await clique.send('ada', 'the key rotated', [], { now: true }), 'sent to @ada\n')
    assert.deepEqual(typed.at(-1), ['ada', 'the key rotated'])
    here.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: 'the key rotated' })
    // Enter: it waits, and Send now on it sends it
    assert.match(await clique.send('ada', 'then open a PR'), /^queued for @ada/)
    const m = here.feed.findLast((e) => e.text === 'then open a PR')
    assert.equal(m.queued, true)
    assert.equal(await clique.feedAction(m.id, 'sendNow', [{ stop: false }]), 'sent to @ada\n')
    assert.deepEqual(typed.at(-1), ['ada', 'then open a PR'])
    here.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: 'then open a PR' })
    // Stop and send
    await clique.send('ada', 'stop, prod is down')
    const s = here.feed.findLast((e) => e.text === 'stop, prod is down')
    assert.match(await clique.feedAction(s.id, 'sendNow', [{ stop: true }]), /^stopped @ada/)
    assert.deepEqual(wrote.at(-1), ['ada', ESC])
    assert.equal(here.agents.get('ada').inbox[0], s)
  } finally {
    for (const h of clique.hubs.values()) {
      for (const a of h.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'reapTimer', 'stopTimer', 'steerTimer']) clearTimeout(a[t])
      clearTimeout(h.statsTimer)
      clearTimeout(h.convoTimer)
      await h.saving
    }
  }
})

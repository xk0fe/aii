// The spend check-in: the work that followed your last message stops to ask once it has cost a set amount. One card
// per round, hand-offs held while it's up, Keep going and Stop, you speaking as the answer, a restart with the card
// up, Codex's tokens, and the threshold in config.json. Real Hub (and Clique, for what the app calls), fake runner and
// clock, throwaway CLIQUE_HOME. `npm test`. CHECK_IN_LOG=1 prints what happens, step by step.
import { test as nodeTest, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-check-in-'))
const { Hub, CONFIG, checkInOf } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn)
const say = (...words) => process.env.CHECK_IN_LOG && console.log(...words)

class FakeRunner extends EventEmitter {
  live = new Set()
  submitted = []
  writes = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (name, text) => this.submitted.push({ name, text })
  write = (name, data) => this.writes.push({ name, data })
}

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-check-in-app-'))
const FILES = ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json', 'tickets.json', 'spend.json', 'runtime.json']
const AGENTS = [{ name: 'ada', area: 'checkout', cwd: DIR }, { name: 'bo', area: 'tests', cwd: DIR }, { name: 'cy', area: 'docs', cwd: DIR }, { name: 'eli', area: 'release', provider: 'codex', cwd: DIR }]
let hub, runner
const newHub = () => {
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1'
  for (const a of hub.agents.values()) if (!a.off) (runner.live.add(a.name), (a.status = 'idle'), (a.run = `run-${a.name}-${Date.now()}`))
  return hub
}
const setup = (extra = {}) => {
  for (const f of FILES) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: AGENTS, ...extra }))
  totals.clear()
  newHub()
}
const quiet = async () => {
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'reapTimer', 'steerTimer']) clearTimeout(a[t])
  for (const t of ['statsTimer', 'convoTimer', 'spendTimer', 'ticketsTimer', 'usageTimer', 'runtimeTimer']) clearTimeout(hub[t])
  await hub.saving
}
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  setup()
})
afterEach(async () => {
  await quiet()
  mock.timers.reset()
})
after(() => {
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 10 })
})

const agent = (n) => hub.agents.get(n)
const typedInto = (n) => runner.submitted.filter((s) => s.name === n).map((s) => s.text)
// the agent takes up what was typed into it (its CLI reports the prompt), then ends its turn
const pickUp = (n) => hub.onHook(n, { hook_event_name: 'UserPromptSubmit', prompt: typedInto(n).at(-1) })
const finish = (n, text = 'done') => {
  hub.onHook(n, { hook_event_name: 'Stop', last_assistant_message: text })
  mock.timers.tick(600) // the prompt box comes back
}
// Claude Code's status line: the session's running total, in dollars. `spend('ada', 2)` adds $2 to it.
const totals = new Map()
const spend = (n, usd) => {
  totals.set(n, (totals.get(n) ?? 0) + usd)
  hub.onStatusLine(n, { session_id: `s-${n}`, cost: { total_cost_usd: totals.get(n) } })
  say(`  @${n} spends $${usd.toFixed(2)}`)
}
const you = (to, text) => {
  say(`you -> @${to}: ${text}`)
  return hub.send({ to, text })
}
const hand = (from, to, text) => {
  const out = hub.send({ from, to, text })
  say(`@${from} -> @${to}: ${text}\n  clique tells @${from}: ${out.trim()}`)
  return out
}
const cards = () => hub.feed.filter((e) => e.kind === 'ask' && e.ask.spend)
const open = () => cards().filter((e) => !e.answer)
const answer = (allow) => {
  say(`you press ${allow ? 'Keep going' : 'Stop'}`)
  hub.answer(open()[0].id, { allow })
}
const paused = () => hub.feed.filter((e) => e.paused).map((e) => `${e.from}>${e.to}`)
// ada and bo hand the same job back and forth, each turn costing `each`: -> how many hand-offs were delivered
const loop = (turns, each) => {
  let n = 0
  for (let i = 0; i < turns; i++) {
    const [me, other] = i % 2 ? ['bo', 'ada'] : ['ada', 'bo']
    if (agent(me).expect) pickUp(me)
    spend(me, each)
    const before = typedInto(other).length
    hand(me, other, `your turn (${i + 1})`)
    finish(me)
    if (typedInto(other).length === before) return n
    n++
  }
  return n
}

test('the threshold: $5 unless config.json says otherwise, false for never; Codex counts 1M tokens to the dollar', () => {
  assert.deepEqual(checkInOf({}), { usd: 5, tokens: 5e6 })
  assert.deepEqual(checkInOf({ checkIn: 12.5 }), { usd: 12.5, tokens: 12.5e6 })
  assert.equal(checkInOf({ checkIn: false }), null)
  assert.equal(checkInOf({ checkIn: 0 }), null)
  assert.deepEqual(hub.snapshot().checkIn, { usd: 5, tokens: 5e6 })
})

test('a hand-off loop is held at the threshold, and goes on after Keep going', () => {
  you('ada', 'make the checkout faster')
  assert.equal(loop(10, 1.2), 4, 'four hand-offs went through ($4.80), the fifth turn passed $5')
  const [card] = open()
  assert.equal(card.from, 'ada')
  assert.equal(card.ask.title, '@ada and @bo have spent $6.00 since you last spoke')
  assert.equal(card.ask.say, "We've spent $6.00 since you last spoke. Keep going?")
  assert.equal(card.ask.type, 'permission') // phones and linked computers draw it as a card they know: Allow is keep going
  assert.deepEqual(card.ask.spend.who, ['ada', 'bo'])
  assert.deepEqual(paused(), ['ada>bo'])
  assert.match(hand('bo', 'cy', 'write this up'), /^held for @cy: CLIque is checking with the user/)
  assert.equal(typedInto('cy').length, 0, 'nothing new starts while the card is up')
  assert.equal(hub.snapshot().feed.filter((e) => e.kind === 'ask' && !e.answer).length, 1, 'it is in the needs-you queue')
  say(`  card: ${card.ask.title}. Keep going?`)

  const before = typedInto('bo').length
  answer(true)
  assert.equal(typedInto('bo').length, before + 1, 'the held hand-off went to bo')
  assert.equal(typedInto('cy').length, 1)
  assert.deepEqual(paused(), [])
  assert.deepEqual([card.answer.allow, card.answer.cost], [true, 6])

  // another full threshold: $6 + $5
  pickUp('bo')
  spend('bo', 4.9)
  assert.equal(open().length, 0, '$10.90: not yet')
  spend('bo', 0.2)
  assert.equal(open().length, 1)
  assert.equal(open()[0].ask.title, '@bo and @ada have spent $11.10 since you last spoke')
  assert.equal(cards().length, 2)
})

test('one card per round, however much more is spent while it waits', () => {
  you('ada', 'refactor it all')
  pickUp('ada')
  spend('ada', 5.5)
  spend('ada', 3)
  spend('ada', 9)
  assert.equal(cards().length, 1)
  assert.equal(cards()[0].ask.title, '@ada has spent $5.50 since you last spoke')
  assert.equal(cards()[0].ask.say, "I've spent $5.50 since you last spoke. Keep going?")
  assert.equal(agent('ada').status, 'working', 'its turn is not cut short: a turn that is running finishes')
})

test('Stop: what was held is dropped, running turns are interrupted, and nothing more goes out until you speak', () => {
  you('ada', 'make the checkout faster')
  pickUp('ada')
  spend('ada', 2)
  hand('ada', 'bo', 'run the tests while I profile')
  pickUp('bo')
  spend('bo', 3.5)
  assert.equal(open().length, 1)
  hand('bo', 'cy', 'write this up')
  hand('ada', 'cy', 'and the numbers')
  assert.deepEqual(paused(), ['bo>cy', 'ada>cy'])
  answer(false)
  assert.deepEqual(paused(), [])
  assert.deepEqual(hub.feed.filter((e) => e.dropped).map((e) => `${e.from}>${e.to}`), ['bo>cy', 'ada>cy'])
  assert.equal(typedInto('cy').length, 0)
  assert.deepEqual(runner.writes.filter((w) => w.data === '\x1b').map((w) => w.name).sort(), ['ada', 'bo'], 'Esc into the turns still running')
  mock.timers.tick(1600)
  assert.deepEqual([agent('ada').status, agent('bo').status], ['idle', 'idle'])
  assert.equal(open().length, 0)
  assert.equal(cards()[0].answer.allow, false)
  assert.throws(() => hub.send({ from: 'bo', to: 'cy', text: 'one more thing' }), /the user stopped this work at the spend check-in/)
  spend('bo', 9)
  assert.equal(cards().length, 1, 'what a stopped round still reports asks nothing')
  // you speak: a new round, with a threshold of its own
  you('bo', 'ok, just the tests then')
  pickUp('bo')
  assert.match(hub.send({ from: 'bo', to: 'cy', text: 'the test notes' }), /^sent to @cy/)
})

test('you speaking is the answer: your message goes through, the card closes and what was held is delivered', () => {
  you('ada', 'make the checkout faster')
  loop(10, 1.2)
  assert.equal(open().length, 1)
  const before = typedInto('bo').length
  assert.match(you('bo', 'fine, but skip the slow tests'), /@bo/)
  assert.equal(open().length, 0)
  assert.deepEqual([cards()[0].answer.allow, cards()[0].answer.spoke], [true, true])
  assert.deepEqual(paused(), [])
  assert.ok(typedInto('bo').length > before, 'bo got something to do')
  assert.ok(!hub.feed.findLast((e) => e.from === 'you').paused, "your own message is never held")
  // someone who isn't part of it: the card stays
  setup()
  you('ada', 'make the checkout faster')
  loop(10, 1.2)
  you('cy', 'how are the docs?')
  assert.equal(open().length, 1)
})

test('a prompt typed into its terminal is you speaking too', () => {
  you('ada', 'make the checkout faster')
  loop(10, 1.2)
  hub.onHook('bo', { hook_event_name: 'UserPromptSubmit', prompt: 'carry on, I am watching' })
  assert.equal(open().length, 0)
  assert.equal(cards()[0].answer.spoke, true)
})

test('nothing is asked about work nobody is on, and a card about work that ended closes by itself', () => {
  // the turn's last report arrives after it ended, with nothing handed on: there's nothing to pause
  you('ada', 'a big job')
  pickUp('ada')
  spend('ada', 3)
  finish('ada')
  spend('ada', 4)
  assert.equal(cards().length, 0)
  // a resting agent's old round asks nothing either
  agent('ada').status = 'resting'
  spend('ada', 20)
  assert.equal(cards().length, 0)
  // the card comes up mid-turn; the turn ends before you answer and nothing else is going: it closes
  setup()
  you('ada', 'a big job')
  pickUp('ada')
  spend('ada', 6)
  assert.equal(open().length, 1)
  finish('ada')
  assert.equal(open().length, 0)
  assert.deepEqual([cards()[0].answer.stale, cards()[0].answer.done], [true, true])
})

test('a question between its agents is held without leaving its asker waiting', async () => {
  you('ada', 'make the checkout faster')
  pickUp('ada')
  spend('ada', 6)
  const out = await hub.question({ from: 'ada', to: 'bo', text: 'is the cart test flaky?', hold: 50 })
  assert.match(out, /^held for @bo: .*@bo's answer will come to you as a message/)
  assert.equal(typedInto('bo').length, 0)
  answer(true)
  assert.equal(typedInto('bo').length, 1)
  assert.match(typedInto('bo')[0], /is the cart test flaky/)
})

test('an answer on its way back to a turn that waits for it is not held', async () => {
  you('ada', 'make the checkout faster')
  pickUp('ada')
  spend('ada', 2)
  const asked = hub.question({ from: 'ada', to: 'bo', text: 'is the cart test flaky?', hold: 60000 })
  pickUp('bo')
  spend('bo', 4)
  assert.equal(open().length, 1)
  finish('bo', 'yes, since Tuesday')
  assert.match(await asked, /yes, since Tuesday/)
})

test('CLIque restarts with the card up: it is still yours to answer, and what was held still goes after Keep going', async () => {
  you('ada', 'make the checkout faster')
  loop(10, 1.2)
  const id = open()[0].id
  await quiet()
  hub.saveSpend(true)
  newHub()
  assert.equal(open()[0]?.id, id, 'the card is still open')
  assert.deepEqual(paused(), ['ada>bo'])
  assert.equal(hub.snapshot().feed.filter((e) => e.kind === 'ask' && !e.answer).length, 1)
  for (const a of hub.agents.values()) a.status = 'resting' // no terminals at launch
  hub.settleRounds() // (as start() does)
  assert.equal(open().length, 1, 'held work keeps it up after the start')
  agent('bo').status = 'idle'
  answer(true)
  assert.equal(typedInto('bo').length, 1)
  assert.match(typedInto('bo')[0], /your turn \(5\)/)
  // and one with nothing held, whose turns ended with the last run, closes
  setup()
  you('ada', 'a big job')
  pickUp('ada')
  spend('ada', 6)
  await quiet()
  hub.saveSpend(true)
  newHub()
  agent('ada').status = 'resting'
  assert.equal(open().length, 1)
  hub.settleRounds()
  assert.equal(open().length, 0)
})

test('Codex counts by tokens, and a mixed round adds the two up', () => {
  const tokens = (n) => hub.addSpend(agent('eli'), { tokens: n })
  you('eli', 'cut the release')
  pickUp('eli')
  tokens(4.9e6)
  assert.equal(cards().length, 0)
  tokens(0.3e6)
  assert.equal(open()[0].ask.title, '@eli has used 5.2M tokens since you last spoke')
  // half the dollars and half the tokens is a whole threshold
  setup()
  you('ada', 'make the checkout faster')
  pickUp('ada')
  spend('ada', 2.6)
  hand('ada', 'eli', 'release it')
  pickUp('eli')
  tokens(2.3e6)
  assert.equal(cards().length, 0)
  tokens(0.2e6)
  assert.equal(open()[0].ask.title, '@ada and @eli have spent $2.60 and used 2.5M tokens since you last spoke')
})

test('your own threshold, and off', () => {
  setup({ checkIn: 1 })
  you('ada', 'a small job')
  pickUp('ada')
  spend('ada', 1.1)
  assert.equal(open()[0].ask.title, '@ada has spent $1.10 since you last spoke')
  setup({ checkIn: false })
  you('ada', 'a big job')
  pickUp('ada')
  spend('ada', 60)
  assert.equal(cards().length, 0)
})

test('an agent leaving for good does not leave its hand-offs held, and a rest leaves the card up', () => {
  you('ada', 'make the checkout faster')
  loop(10, 1.2)
  hub.forgetAsks('ada') // its terminal went away (a rest, an exit)
  assert.equal(open().length, 1)
  const before = typedInto('bo').length
  hub.forgetAsks('ada', { gone: true })
  assert.equal(open().length, 0)
  assert.equal(typedInto('bo').length, before + 1)
})

test('through CLIque, as the app calls it: the preference, a message of yours, and switching it off', async () => {
  await quiet()
  for (const f of FILES) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.rmSync(path.join(process.env.CLIQUE_HOME, 'workspaces'), { recursive: true, force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: AGENTS }))
  const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
  const typed = []
  Object.assign(clique.runner, { running: () => true, submit: (n, text) => typed.push({ n, text }), write() {}, quietFor: () => Infinity })
  hub = clique.here
  runner = { submitted: [], writes: [] }
  const got = (n) => typed.filter((t) => t.n.endsWith(n)).map((t) => t.text)
  for (const a of hub.agents.values()) (a.status = 'idle'), (a.run = `run-${a.name}`)
  assert.deepEqual(clique.snapshot().checkIn, { usd: 5, tokens: 5e6 })
  assert.deepEqual(clique.setCheckIn(2), { usd: 2, tokens: 2e6 })
  assert.equal(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).checkIn, 2)
  assert.throws(() => clique.setCheckIn('lots'), /an amount in dollars/)

  await clique.send('ada', 'make the checkout faster')
  hub.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: got('ada').at(-1) })
  hub.onStatusLine('ada', { session_id: 's-ada', cost: { total_cost_usd: 2.4 } })
  assert.equal(open()[0].ask.title, '@ada has spent $2.40 since you last spoke')
  hub.send({ from: 'ada', to: 'bo', text: 'run the tests' })
  assert.equal(got('bo').length, 0)
  await clique.send('ada', 'and the cart page')
  assert.equal(open().length, 0, 'you spoke')
  assert.equal(got('bo').length, 1)

  // a second round, then the check-in is switched off: the card that was up is answered
  hub.onHook('ada', { hook_event_name: 'Stop', last_assistant_message: 'done' })
  mock.timers.tick(700)
  hub.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: got('ada').at(-1) })
  hub.onStatusLine('ada', { session_id: 's-ada', cost: { total_cost_usd: 5 } })
  assert.equal(open().length, 1)
  assert.equal(clique.setCheckIn(false), null)
  assert.equal(open().length, 0)
  assert.equal(clique.snapshot().checkIn, null)
  clique.setCheckIn(5)
  assert.equal('checkIn' in JSON.parse(fs.readFileSync(CONFIG, 'utf8')), false, 'the default is not written down')
  for (const h of clique.hubs.values()) for (const t of ['statsTimer', 'convoTimer', 'spendTimer', 'runtimeTimer']) clearTimeout(h[t])
})

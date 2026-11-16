// Stop: ending an agent's turn from the chat. The key that goes into its terminal, how CLIque makes sure the turn ended,
// what happens to everything lined up behind it (nothing is delivered the moment the agent is free), the one line in the
// chat, and the turn that starts by itself afterwards. Real Hub, fake terminals and clock, throwaway CLIQUE_HOME; the
// last tests go through Clique.stopTurns, as the app and phones do. `npm test`.
import { test as nodeTest, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-stop-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
const { CALLS } = await import('clique-shared/protocol.js')
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

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-stop-app-'))
let hub, runner
const setup = (agents, extra = {}) => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json', 'tickets.json']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents, ...extra }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1'
  for (const a of hub.agents.values()) if (!a.off) (runner.live.add(a.name), (a.status = 'idle'))
}
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() })
  setup([
    { name: 'ada', area: 'backend api', cwd: DIR },
    { name: 'june', area: 'docs, release notes', cwd: DIR },
    { name: 'theo', area: 'qa, tests', cwd: DIR, provider: 'codex' },
  ])
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
const lines = () => hub.feed.filter((e) => e.kind === 'event' && e.stop).map((e) => e.text)
const view = (n) => hub.snapshot().agents.find((a) => a.name === n)
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
const peek = async (p) => {
  let out = 'pending'
  p.then((v) => (out = v), (e) => (out = e))
  for (let i = 0; i < 5; i++) await Promise.resolve()
  return out
}

test('Stop ends the turn: Esc goes in, the agent is free at once and stays on, and one line says who you stopped', () => {
  atWork('ada')
  assert.equal(view('ada').canStop, true)
  assert.deepEqual(hub.stopTurns(['ada']), { stopped: ['ada'], dropped: 0 })
  assert.deepEqual(keys('ada'), [ESC])
  assert.equal(agent('ada').status, 'idle')
  assert.equal(runner.running('ada'), true, "it wasn't turned off")
  assert.equal(view('ada').on, true)
  assert.equal(view('ada').canStop, undefined, 'nothing to stop any more')
  assert.deepEqual(lines(), ['you stopped @ada'])
  assert.deepEqual(hub.feed.at(-1).about, ['ada'], 'the line shows in its conversation too')
  // nothing else to stop: no second line, no key
  assert.deepEqual(hub.stopTurns(['ada', 'june']), { stopped: [], dropped: 0 })
  assert.equal(lines().length, 1)
  assert.deepEqual(keys('ada'), [ESC])
})

test('what was queued behind a stopped turn is not delivered when the agent goes free', () => {
  atWork('ada')
  const first = typedInto('ada').length
  // while ada works: a hand-off from june, and two more messages from you
  agent('june').status = 'working'
  hub.send({ from: 'june', to: 'ada', text: 'the release notes need the new endpoint names' })
  hub.send({ to: 'ada', text: 'and add a test for it' })
  hub.send({ to: 'ada', text: 'then open a PR' })
  assert.equal(agent('ada').inbox.length, 3)
  assert.equal(view('ada').queue, 3)

  const r = hub.stopTurns(['ada'])
  assert.deepEqual(r, { stopped: ['ada'], dropped: 3 })
  assert.equal(agent('ada').inbox.length, 0)
  // its terminal goes quiet, CLIque sees the turn is over, and minutes pass: nothing more is typed into it
  quiet('ada')
  mock.timers.tick(10 * 60000)
  assert.equal(typedInto('ada').length, first, 'no queued message went in')
  assert.equal(agent('ada').status, 'idle')
  const queued = hub.feed.filter((e) => e.kind === 'msg' && e.to === 'ada').slice(1)
  assert.deepEqual(queued.map((m) => [m.from, m.queued, m.dropped, m.stopped]), [['june', false, true, true], ['you', false, true, true], ['you', false, true, true]])
  assert.deepEqual(lines(), ["you stopped @ada. 3 waiting messages weren't delivered"], 'one line, not one per message')
  // asking again continues: only the new message goes in
  hub.send({ to: 'ada', text: 'carry on with the totals, skip the PR' })
  mock.timers.tick(1000)
  assert.equal(typedInto('ada').length, first + 1)
  assert.match(typedInto('ada').at(-1), /^carry on with the totals, skip the PR$/)
  pickUp('ada')
  assert.equal(agent('ada').status, 'working', 'what you ask for after a stop runs')
  assert.deepEqual(keys('ada').filter((k) => k === ESC), [ESC], 'and is not stopped again')
})

test('a teammate waiting on its answer hears it was stopped; a question still in its queue is answered the same way', async () => {
  // june asks ada, who takes the question up; theo's question waits behind it
  agent('june').status = 'working'
  agent('theo').status = 'working'
  const asked = hub.question({ from: 'june', to: 'ada', text: 'which endpoint returns the totals?', hold: 60000 })
  mock.timers.tick(700)
  pickUp('ada')
  const waiting = hub.question({ from: 'theo', to: 'ada', text: 'is the fixture seeded?', hold: 60000 })
  for (let i = 0; i < 5; i++) await Promise.resolve()
  hub.stopTurns(['ada'])
  assert.match(await peek(asked), /@ada stopped before it answered/)
  assert.match(await peek(waiting), /@ada was stopped by the user, so it won't answer/)
  assert.equal(hub.calls.size, 0)
})

test('questions the stopped agent had out are forgotten: a late answer does not start it again', async () => {
  atWork('ada')
  const asked = hub.question({ from: 'ada', to: 'june', text: 'what do the release notes call it?', hold: 60000 })
  mock.timers.tick(700)
  pickUp('june')
  const before = typedInto('ada').length
  hub.stopTurns(['ada'])
  assert.equal(await peek(asked), '', "its `clique ask` isn't held any longer")
  quiet('ada')
  hub.onHook('june', { hook_event_name: 'Stop', last_assistant_message: 'It is called the totals endpoint.' })
  mock.timers.tick(5000)
  assert.equal(typedInto('ada').length, before, 'the answer is not typed into the stopped agent')
  assert.equal(agent('ada').status, 'idle')
})

test("hand-offs it made in the stopped turn that nobody started on are withdrawn; one a teammate is already on isn't", () => {
  atWork('ada')
  mock.timers.tick(1000)
  hub.send({ from: 'ada', to: 'june', text: 'write the changelog entry' })
  mock.timers.tick(700)
  pickUp('june') // june is on it
  hub.send({ from: 'ada', to: 'june', text: 'and the migration note' }) // waits behind june's turn
  assert.equal(agent('june').inbox.length, 1)
  const r = hub.stopTurns(['ada'])
  assert.equal(r.dropped, 1)
  assert.equal(agent('june').inbox.length, 0)
  assert.equal(agent('june').status, 'working', 'june goes on with what it had started')
  assert.equal(hub.feed.find((e) => e.text === 'and the migration note').stopped, true)
})

test('a turn that starts by itself after a stop is stopped again, until you ask for something', () => {
  atWork('ada')
  hub.stopTurns(['ada'])
  quiet('ada')
  const before = keys('ada').filter((k) => k === ESC).length
  // Claude Code's own prompt: something the agent left running in the background finished
  runner.drawing.add('ada')
  hub.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>b1</task-id></task-notification>' })
  assert.equal(agent('ada').status, 'idle', "it doesn't show as working")
  assert.equal(keys('ada').filter((k) => k === ESC).length, before + 1, 'Esc again')
  quiet('ada')
  // typing in its terminal yourself is asking again: that turn runs
  hub.input('ada', 'c')
  mock.timers.tick(10)
  hub.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  assert.equal(agent('ada').status, 'working')
  assert.equal(keys('ada').filter((k) => k === ESC).length, before + 1)
})

test('a prompt the CLI had queued starts the moment Esc lands (Codex): that turn is stopped too', () => {
  atWork('theo')
  hub.stopTurns(['theo'])
  hub.onHook('theo', { hook_event_name: 'Interrupt' })
  hub.onHook('theo', { hook_event_name: 'UserPromptSubmit', prompt: '[question from @june] is the fixture seeded?' })
  assert.deepEqual(keys('theo'), [ESC, ESC])
  assert.equal(agent('theo').status, 'idle')
  assert.equal(hub.feed.some((e) => e.via === 'terminal'), false, "it isn't taken for something you typed")
  hub.onHook('theo', { hook_event_name: 'Interrupt' })
  mock.timers.tick(100)
  assert.equal(agent('theo').stopping, null)
  assert.deepEqual(keys('theo'), [ESC, ESC], 'Codex never gets Ctrl+C: it would quit')
})

test('Claude Code gets one Ctrl+C once its turn is over, to empty the prompt box it put the stopped prompt back in', () => {
  atWork('ada')
  hub.stopTurns(['ada'])
  mock.timers.tick(900)
  assert.deepEqual(keys('ada'), [ESC], 'not while it may still be drawing')
  quiet('ada')
  assert.deepEqual(keys('ada'), [ESC, CTRL_C])
  // stopped again within a few seconds: no second Ctrl+C, which would quit it
  atWork('ada', 'try again')
  hub.stopTurns(['ada'])
  quiet('ada')
  assert.deepEqual(keys('ada').filter((k) => k === CTRL_C), [CTRL_C])
})

test('a message sent right after Stop waits until the turn has really ended', () => {
  atWork('ada')
  const before = typedInto('ada').length
  hub.stopTurns(['ada'])
  hub.send({ to: 'ada', text: 'do the other thing instead' })
  mock.timers.tick(900)
  assert.equal(typedInto('ada').length, before, 'its CLI is still drawing')
  quiet('ada')
  mock.timers.tick(2000)
  assert.equal(typedInto('ada').at(-1), 'do the other thing instead')
})

test("a CLI that keeps working gets Esc again, and after three tries the chat says it didn't stop", () => {
  atWork('ada')
  hub.stopTurns(['ada'])
  mock.timers.tick(2700)
  assert.deepEqual(keys('ada'), [ESC, ESC])
  hub.onHook('ada', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } })
  assert.equal(agent('ada').status, 'idle', 'a step of the turn being stopped does not bring it back')
  mock.timers.tick(2700)
  assert.deepEqual(keys('ada'), [ESC, ESC, ESC])
  mock.timers.tick(2700)
  assert.equal(agent('ada').status, 'working')
  assert.equal(hub.feed.at(-1).alert, true)
  assert.match(hub.feed.at(-1).text, /didn't stop when asked/)
  assert.deepEqual(keys('ada'), [ESC, ESC, ESC], 'and never Ctrl+C')
})

test('an agent waiting on a permission card is stopped, and the card closes as stopped', async () => {
  atWork('ada')
  const hook = hub.ask('ada', { tool_name: 'Bash', tool_input: { command: 'npm run build' } })
  assert.equal(agent('ada').status, 'waiting')
  assert.equal(view('ada').canStop, true)
  hub.stopTurns(['ada'])
  assert.equal(await peek(hook), '', 'its hook gets no decision')
  const card = hub.feed.find((e) => e.kind === 'ask')
  assert.equal(card.answer.stopped, true)
  assert.equal(card.answer.by, 'you')
  assert.equal(agent('ada').status, 'idle')
  assert.equal(hub.asks.size, 0)
})

test('an agent asking whether to trust its folder, one starting up and one that is free have nothing to stop', () => {
  Object.assign(agent('ada'), { status: 'waiting', trustAsk: true })
  agent('june').status = 'starting'
  assert.equal(view('ada').canStop, undefined)
  assert.deepEqual(hub.stopTurns(['ada', 'june', 'theo', 'nobody']), { stopped: [], dropped: 0 })
  assert.equal(runner.writes.length, 0, 'Esc there would quit the CLI')
  assert.equal(lines().length, 0)
})

test('several agents stopped together make one line, in the channel it was pressed in', () => {
  setup([{ name: 'ada', cwd: DIR }, { name: 'june', cwd: DIR }, { name: 'theo', cwd: DIR, provider: 'codex' }], { channels: [{ id: 'review', name: 'review' }] })
  atWork('ada')
  atWork('theo', 'run the suite')
  agent('june').status = 'working'
  hub.send({ from: 'june', to: 'theo', text: 'also the docs build' })
  const r = hub.stopTurns(['ada', 'theo'], { channel: 'review' })
  assert.deepEqual(r, { stopped: ['ada', 'theo'], dropped: 1 })
  assert.deepEqual(lines(), ["you stopped @ada and @theo. A waiting message wasn't delivered"])
  assert.equal(hub.feed.at(-1).channel, 'review')
})

test("a stopped clone doesn't help itself to what waits for its original; a new message can still go to it", () => {
  setup([{ name: 'ada', cwd: DIR, clones: 1 }, { name: 'june', cwd: DIR }])
  atWork('ada')
  hub.send({ to: 'ada', text: 'second thing' }) // ada is busy: a clone starts for it
  const clone = agent('ada.2')
  assert.ok(clone, 'a clone took it')
  runner.live.add('ada.2')
  hub.onHook('ada.2', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(3000)
  hub.onHook('ada.2', { hook_event_name: 'UserPromptSubmit', prompt: typedInto('ada.2').at(-1) })
  hub.send({ to: 'ada', text: 'third thing' }) // both busy: it waits for ada
  assert.equal(agent('ada').inbox.length, 1)
  const before = typedInto('ada.2').length
  assert.deepEqual(hub.stopTurns(['ada.2']), { stopped: ['ada.2'], dropped: 0 })
  mock.timers.tick(5000)
  assert.equal(typedInto('ada.2').length, before, 'the stopped clone took nothing more')
  assert.equal(agent('ada').inbox.length, 1, "what waits for ada still waits for ada: only the clone was stopped")
  assert.deepEqual(lines(), ['you stopped @ada.2'])
})

// ---- what an independent review found ---------------------------------------------------------------------------------

test('past its context limit, a stopped agent is not asked where things stand: that waits for its next message', () => {
  atWork('ada')
  Object.assign(agent('ada'), { freshPending: true, freshLimit: true })
  const before = typedInto('ada').length
  hub.stopTurns(['ada'])
  quiet('ada')
  mock.timers.tick(60000)
  assert.equal(typedInto('ada').length, before, 'no wrap-up prompt, no new conversation carrying the stopped work on')
  assert.equal(agent('ada').status, 'idle')
  assert.equal(agent('ada').freshPending, true, 'the new conversation is still owed')
  hub.send({ to: 'ada', text: 'something else' })
  mock.timers.tick(2000)
  assert.match(typedInto('ada').at(-1), /passed its context limit/, 'asked with its next message, as before')
})

test('a question it had put aside while it asked a teammate in turn is answered too: nobody is left waiting', async () => {
  agent('june').status = 'working'
  const junes = hub.question({ from: 'june', to: 'ada', text: 'which endpoint returns the totals?', hold: 600000 })
  mock.timers.tick(1500)
  pickUp('ada')
  hub.question({ from: 'ada', to: 'theo', text: 'is the fixture seeded?', hold: 1000 }) // ada asks on, and gives up waiting
  mock.timers.tick(1500)
  pickUp('theo')
  hub.onHook('ada', { hook_event_name: 'Stop', last_assistant_message: 'Waiting on Theo.' }) // june's question stays open
  mock.timers.tick(1000)
  assert.equal(await peek(junes), 'pending')
  atWork('ada', 'meanwhile, rename the helper')
  hub.stopTurns(['ada'])
  assert.match(await peek(junes), /@ada was stopped by the user, so it won't answer/)
  assert.equal([...hub.calls.values()].filter((c) => c.from === 'june').length, 0)
})

test("a hand-off from a turn that's over is not this turn's: stopped before the next prompt is picked up, it stays", () => {
  atWork('ada')
  agent('june').status = 'working'
  hub.send({ from: 'ada', to: 'june', text: 'document the new totals endpoint' }) // waits for june
  hub.onHook('ada', { hook_event_name: 'Stop', last_assistant_message: 'Done, June has the docs.' })
  runner.drawing.delete('ada')
  mock.timers.tick(5000)
  hub.send({ to: 'ada', text: 'now the coupons' })
  mock.timers.tick(1500) // typed, not picked up yet
  assert.equal(agent('ada').status, 'working')
  assert.deepEqual(hub.stopTurns(['ada']), { stopped: ['ada'], dropped: 0 })
  assert.equal(agent('june').inbox.length, 1, "june still has the earlier turn's hand-off")
})

test('a key in its terminal while the stop is being checked does not bring the stopped turn back', () => {
  atWork('ada')
  hub.stopTurns(['ada'])
  mock.timers.tick(200)
  hub.input('ada', '\x1b[A') // an arrow key
  hub.onHook('ada', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }) // a late step
  assert.equal(agent('ada').status, 'idle')
  quiet('ada')
  mock.timers.tick(30 * 60000)
  assert.equal(agent('ada').status, 'idle')
  assert.equal(view('ada').canStop, undefined)
})

test('its sub-agents end with the stopped turn', () => {
  atWork('ada')
  hub.onHook('ada', { hook_event_name: 'SubagentStart', agent_id: 's1', agent_type: 'Explore' })
  assert.equal(view('ada').subs.filter((x) => !x.ended).length, 1)
  hub.stopTurns(['ada'])
  assert.equal(view('ada').subs.filter((x) => !x.ended).length, 0)
})

test('interrupt() alone ends the turn and leaves the queue: what waits goes in once the turn is over', () => {
  atWork('ada')
  hub.send({ to: 'ada', text: 'and add a test for it' })
  const before = typedInto('ada').length
  assert.equal(hub.interrupt('ada'), true)
  assert.equal(hub.interrupt('ada'), false, 'already stopping')
  assert.equal(lines().length, 0, 'no line: that is the Stop button’s')
  assert.equal(agent('ada').status, 'idle')
  quiet('ada')
  mock.timers.tick(2000)
  assert.equal(typedInto('ada').length, before + 1)
})

test('a task sent to it that it never started goes back to the board; a stopped agent is not reminded to carry on', async () => {
  hub.fileTask({ text: 'Totals round wrong with 3 items', owner: 'ada' })
  hub.fileTask({ text: 'Coupon field loses focus', owner: 'ada' })
  await hub.ticket('dispatch', 1)
  hub.onHook('ada', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(3000)
  pickUp('ada')
  assert.equal(agent('ada').status, 'working')
  await hub.ticket('dispatch', 2) // waits behind #1
  assert.equal(hub.tickets.get(2).status, 'fixing')
  hub.stopTurns(['ada'])
  assert.equal(hub.tickets.get(2).status, 'new', 'never started: back to New')
  assert.equal(hub.tickets.get(1).status, 'fixing', 'the one it was on stays where it is, for you to decide')
  quiet('ada')
  const before = typedInto('ada').length
  hub.checkStalls(Date.now() + 30 * 60000)
  assert.equal(typedInto('ada').length, before, 'no "still in progress, carry on" for work you stopped')
  assert.equal(hub.feed.some((e) => /reminded/.test(e.text ?? '')), false)
})

test('an API error in a turn you stopped is not retried with "continue"', () => {
  atWork('ada')
  hub.stopTurns(['ada'])
  hub.onHook('ada', { hook_event_name: 'StopFailure', error: 'overloaded' })
  mock.timers.tick(5 * 60000)
  assert.equal(typedInto('ada').includes('continue'), false)
  assert.equal(agent('ada').status, 'idle')
})

test('Esc typed in its terminal is not Stop: the queue stays, as before', () => {
  atWork('ada')
  hub.send({ to: 'ada', text: 'and add a test for it' })
  const before = typedInto('ada').length
  mock.timers.tick(1000)
  hub.input('ada', ESC)
  runner.drawing.delete('ada')
  mock.timers.tick(6000)
  assert.equal(agent('ada').status, 'working', 'the next message went in')
  assert.equal(typedInto('ada').length, before + 1)
  assert.equal(lines().length, 0)
})

test('phones may call stop', () => {
  assert.ok(CALLS.includes('stop'))
})

// ---- through Clique.stopTurns, as the app's Stop button and a phone's send it ---------------------------------------------

test('Clique.stopTurns stops agents here by name, and a linked computer’s through its link (Esc for one on an older CLIque)', async () => {
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
    await clique.send('ada', 'then open a PR')
    assert.equal(here.agents.get('ada').inbox.length, 1)

    // a linked computer that knows Stop, and one that doesn't
    const calls = []
    const inputs = []
    const link = (slug, knows) => ({
      slug, name: slug, toHost: new Map(), fetching: new Set(),
      peer: {
        call: async (fn, [key, call, args]) => {
          calls.push([slug, fn, call, args])
          if (!knows) throw new Error(`"${call}" isn't available over CLIque Link`)
          return { stopped: args[0], dropped: 2 }
        },
        input: (n, d) => inputs.push([slug, n, d]),
      },
    })
    clique.links.set('workstation', link('workstation', true))
    clique.links.set('oldmac', link('oldmac', false))

    const r = await clique.stopTurns(['ada', 'rex@workstation', 'noor@oldmac'], { channel: 'general' })
    assert.deepEqual(r, { stopped: ['ada', 'rex@workstation', 'noor@oldmac'], dropped: 3 })
    assert.deepEqual(wrote, [['ada', ESC]])
    assert.equal(here.agents.get('ada').inbox.length, 0)
    assert.deepEqual(calls.map(([slug, fn, call, args]) => [slug, fn, call, args[0]]), [['workstation', 'in', 'stop', ['rex']], ['oldmac', 'in', 'stop', ['noor']]])
    assert.equal(inputs.length, 1)
    assert.deepEqual(inputs[0].slice(0, 1).concat(inputs[0][2]), ['oldmac', ESC])
    assert.match(inputs[0][1], /\/noor$/)
    // what a linked computer asks of this one: the same Stop, in the workspace it names
    await clique.send('june', 'draft the notes')
    mock.timers.tick(700)
    here.onHook('june', { hook_event_name: 'UserPromptSubmit', prompt: typed.at(-1)[1] })
    assert.deepEqual(clique.serve('stop', [['june'], { channel: 'general' }], here), { stopped: ['june'], dropped: 0 })
    assert.equal(here.agents.get('june').status, 'idle')
  } finally {
    for (const h of clique.hubs.values()) {
      for (const a of h.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'reapTimer', 'stopTimer', 'steerTimer']) clearTimeout(a[t])
      clearTimeout(h.statsTimer)
      clearTimeout(h.convoTimer)
      await h.saving
    }
  }
})

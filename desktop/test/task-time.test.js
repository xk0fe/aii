// What a task took (core/tasktime.js, ui/tasktime.js): the hub writes down who was on a task and when, its longest
// steps, the files it changed and the checks it ran; the review works out where the time went. Against the real Hub
// with a fake runner in a throwaway CLIQUE_HOME, and the page's own script in a vm. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-tasktime-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { addSpan, addStep, addFile, addCheck, isCheck, inFolder, SPAN_CAP, STEP_CAP } = await import('../core/tasktime.js')
const DESKTOP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ctx = vm.createContext({})
vm.runInContext(fs.readFileSync(path.join(DESKTOP, 'ui/tasktime.js'), 'utf8') + ';globalThis.__x = { taskTiming, timingSummary, tookText, TIME_PHASES }', ctx)
// (what the page's script returns is made in its own realm: as plain values here, so they compare)
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)))
const { tookText } = ctx.__x
const TIME_PHASES = plain(ctx.__x.TIME_PHASES)
const taskTiming = (...args) => plain(ctx.__x.taskTiming(...args))
const timingSummary = (...args) => plain(ctx.__x.timingSummary(...args))

const CLIQUE = [
  { name: 'ada', area: 'game client: controls, input, pause menu, UI screens' },
  { name: 'june', area: 'backend api, servers, leaderboards' },
  { name: 'abe', area: 'organiser, triage, admin' },
]
class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
}
let hub, runner
beforeEach(() => {
  for (const f of ['tickets.json', 'conversations.json', 'sessions.json', 'feed.jsonl']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CLIQUE }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
})
afterEach(() => {
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'steerTimer']) clearTimeout(a[t])
  for (const t of ['statsTimer', 'convoTimer', 'ticketsTimer']) clearTimeout(hub[t])
})
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

const MIN = 60000
const lastTyped = (name) => runner.typed.filter((t) => t.n === name).at(-1)?.text ?? ''
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// the agent takes what CLIque typed for it, and its turn begins
const begin = (name) => hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt: lastTyped(name) })
// `min` minutes pass for an agent in the status it's in (its clock is moved back, rather than the test waiting)
const pass = (name, min) => {
  const a = hub.agents.get(name)
  a.since -= min * MIN
  if (a.stepAt) a.stepAt -= min * MIN
}
const spansOf = (id) => hub.tickets.get(id).time?.spans ?? []
const near = (ms, min) => Math.abs(ms - min * MIN) < 2000
// a task handed to its owner, whose turn on it has begun
async function underWay(text = 'pause menu does not close', owner = 'ada') {
  hub.fileTask({ kind: 'bug', text })
  const { id } = hub.tickets.all.at(-1)
  await hub.ticket('dispatch', id)
  hub.onHook(owner, { hook_event_name: 'SessionStart', source: 'startup' })
  await wait(2100)
  begin(owner)
  return id
}

// ---- what's written down ---------------------------------------------------------------------------------

test('spans: one agent\'s neighbours join, short ones are dropped, and past the cap the closest two become one', () => {
  const t = {}
  assert.equal(addSpan(t, 'ada', 'work', 1000, 1500), false, 'under a second is nothing')
  addSpan(t, 'ada', 'work', 10_000, 70_000)
  addSpan(t, 'ada', 'work', 71_000, 100_000) // a hook between two tools: the same stretch of work
  assert.deepEqual(t.time.spans, [{ w: 'ada', k: 'work', at: 10_000, ms: 90_000 }])
  addSpan(t, 'ada', 'you', 100_000, 160_000)
  addSpan(t, 'june', 'work', 120_000, 150_000)
  assert.equal(t.time.spans.length, 3)
  // many more than are kept: none of the time is lost
  const big = {}
  for (let i = 0; i < SPAN_CAP + 40; i++) addSpan(big, 'ada', 'work', i * 100_000, i * 100_000 + 20_000)
  assert.equal(big.time.spans.length, SPAN_CAP)
  assert.equal(big.time.spans.reduce((n, s) => n + s.ms, 0), (SPAN_CAP + 40) * 20_000)
})

test('steps keep the longest; files count their changes; a check keeps its latest run', () => {
  const t = {}
  for (let i = 1; i <= STEP_CAP + 3; i++) addStep(t, 'ada', `Bash · step ${i}`, i * 5000)
  assert.equal(t.time.steps.length, STEP_CAP)
  assert.equal(t.time.steps[0].text, `Bash · step ${STEP_CAP + 3}`)
  addStep(t, 'ada', 'Read · x', 200)
  assert.equal(t.time.steps.length, STEP_CAP, 'a step under a second is not one')
  addFile(t, 'src/cart.ts')
  addFile(t, 'src/cart.ts')
  addFile(t, 'src/total.ts')
  assert.deepEqual(t.time.files, { 'src/cart.ts': 2, 'src/total.ts': 1 })
  addCheck(t, 'ada', 'Bash · npm test', 4000)
  addCheck(t, 'ada', 'Bash · npm test', 9000)
  assert.deepEqual(t.time.checks.map((c) => [c.text, c.ms]), [['Bash · npm test', 9000]])
})

test('a check is a command that checks the work, not one that does it', () => {
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })
  for (const c of ['npm test', 'npm run lint', 'cd app && npx vitest run cart', 'pytest -q', 'node --test test/*.test.js', 'cargo test', 'npx tsc --noEmit', 'go test ./...', 'npx playwright test cart']) assert.equal(isCheck(bash(c)), true, c)
  for (const c of ['git status', 'ls test', 'npm install', 'cat package.json', 'echo "npm testimonial"']) assert.equal(isCheck(bash(c)), false, c)
  assert.equal(isCheck({ tool_name: 'Edit', tool_input: { file_path: '/x/npm test' } }), false)
  assert.equal(inFolder('/work/app/src/cart.ts', '/work/app'), 'src/cart.ts')
  assert.equal(inFolder('/elsewhere/x.ts', '/work/app'), '/elsewhere/x.ts')
})

// ---- the hub writes it down -------------------------------------------------------------------------------

test('a turn on a task is the task\'s time: working, and waiting on you', async () => {
  const id = await underWay()
  pass('ada', 5)
  hub.needsYou(hub.agents.get('ada'), 'has a question') // five minutes in, it needs you
  pass('ada', 3)
  hub.onHook('ada', { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x/menu.js' } }) // answered: at work again
  pass('ada', 2)
  hub.onHook('ada', { hook_event_name: 'Stop' })
  const spans = spansOf(id)
  assert.deepEqual(spans.map((s) => [s.w, s.k]), [['ada', 'work'], ['ada', 'you'], ['ada', 'work']])
  assert.ok(near(spans[0].ms, 5) && near(spans[1].ms, 3) && near(spans[2].ms, 2), JSON.stringify(spans))
  assert.equal(hub.agents.get('ada').taskNow, undefined, 'its turn is over')
})

test('later turns of the conversation count while the task is under way, and not once it is reported', async () => {
  const id = await underWay()
  pass('ada', 1)
  hub.onHook('ada', { hook_event_name: 'Stop' })
  // something it left running finishes: a turn of its own, in the conversation that is about the task
  hub.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>done</task-notification>' })
  if (hub.agents.get('ada').status !== 'working') hub.setStatus(hub.agents.get('ada'), 'working')
  pass('ada', 4)
  hub.taskCommand('ada', ['done', String(id), 'rebound the handler', '--checked', 'npm test, and by hand'])
  hub.onHook('ada', { hook_event_name: 'Stop' }) // the turn it reported in is still the task's
  assert.ok(near(spansOf(id).reduce((n, s) => n + s.ms, 0), 5), JSON.stringify(spansOf(id)))
  // you talk to it about something else, in the same conversation: not the task's time
  hub.send({ to: 'ada', text: 'while you are here, what does the pause menu use for icons?' })
  await wait(700)
  begin('ada')
  pass('ada', 6)
  hub.onHook('ada', { hook_event_name: 'Stop' })
  assert.ok(near(spansOf(id).reduce((n, s) => n + s.ms, 0), 5), 'a chat after it was reported is not the task')
})

test('several agents on one task: a teammate asked for a part is on it too, for as long as it answers', async () => {
  const id = await underWay()
  pass('ada', 2)
  hub.send({ from: 'ada', to: 'june', text: 'does the pause endpoint still return the menu state?' })
  const handoff = hub.feed.findLast((e) => e.kind === 'msg' && e.to === 'june')
  assert.equal(handoff.forTask, id, 'what an agent on a task sends on is for that task')
  await wait(700)
  begin('june')
  pass('june', 3)
  hub.onHook('june', { hook_event_name: 'Stop' })
  pass('ada', 1)
  hub.onHook('ada', { hook_event_name: 'Stop' })
  const by = Object.groupBy(spansOf(id), (s) => s.w)
  assert.ok(near(by.june[0].ms, 3), 'june: three minutes on #1')
  assert.ok(by.ada.reduce((n, s) => n + s.ms, 0) >= 3 * MIN - 2000)
  // june on something of its own afterwards: no part of the task
  hub.send({ to: 'june', text: 'check the leaderboard cron' })
  await wait(700)
  begin('june')
  pass('june', 9)
  hub.onHook('june', { hook_event_name: 'Stop' })
  assert.ok(near(Object.groupBy(spansOf(id), (s) => s.w).june.reduce((n, s) => n + s.ms, 0), 3))
})

test('the triage agent sorting a task out is triage time, not work', async () => {
  hub.space.triage = 'abe'
  hub.fileTask({ kind: 'bug', text: 'leaderboard shows yesterday' })
  await wait(700)
  begin('abe')
  pass('abe', 1)
  hub.onHook('abe', { hook_event_name: 'Stop' })
  assert.deepEqual(spansOf(1).map((s) => [s.w, s.k]), [['abe', 'triage']])
})

test('steps, files and checks of a turn on a task; a helper is one of its steps', async () => {
  const id = await underWay()
  const a = hub.agents.get('ada')
  a.cwd = '/work/game'
  pass('ada', 2)
  hub.onHook('ada', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/work/game/ui/pause.js' } })
  pass('ada', 4)
  hub.onHook('ada', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test -- pause' } })
  hub.onHook('ada', { hook_event_name: 'SubagentStart', agent_id: 's1', agent_type: 'Explore' })
  a.subs.get('s1').started -= 3 * MIN
  a.subs.get('s1').description = 'Find every place the menu is closed'
  hub.onHook('ada', { hook_event_name: 'SubagentStop', agent_id: 's1', agent_type: 'Explore' })
  hub.onHook('ada', { hook_event_name: 'Stop' })
  const { time } = hub.tickets.get(id)
  assert.deepEqual(time.files, { 'ui/pause.js': 1 })
  assert.deepEqual(time.checks.map((c) => c.text), ['Bash · npm test -- pause'])
  assert.equal(time.helpers, 1)
  assert.deepEqual(time.steps.map((s) => s.text), ['Bash · npm test -- pause', 'Agent · Find every place the menu is closed', 'Edit · pause.js'])
  assert.ok(near(time.steps[0].ms, 4) && near(time.steps[1].ms, 3) && near(time.steps[2].ms, 2))
})

test('an answer is for the asker\'s task, whatever the one answering is on; a renamed agent keeps its part', async () => {
  const id = await underWay()
  // june is on a task of her own when ada asks her something
  hub.fileTask({ kind: 'task', text: 'leaderboard cron is late', owner: 'june' })
  const hers = hub.tickets.all.at(-1).id
  await hub.ticket('dispatch', hers)
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'startup' })
  await wait(2100)
  begin('june')
  assert.deepEqual(hub.agents.get('june').taskNow, { id: hers, kind: 'work' })
  const question = hub.post({ kind: 'msg', from: 'ada', to: 'june', text: 'does pause still return the menu state?', ask: true })
  assert.equal(question.forTask, id)
  const call = hub.open({ id: question.id, msg: question, from: 'ada', text: question.text })
  hub.respond(call, { by: 'june', text: 'yes, under menu.state' })
  const answer = hub.feed.findLast((e) => e.answers)
  assert.equal(answer.forTask, id, "the answer goes to ada's task, not the one june is on")
  // renamed: the time it has on the task goes with it, and it is still the one who did it
  pass('ada', 3)
  hub.onHook('ada', { hook_event_name: 'Stop' })
  const { renameWho } = await import('../core/tasktime.js')
  const t = structuredClone(hub.tickets.get(id))
  t.time.spans.push({ w: 'ada.2', k: 'work', at: t.created + 1000, ms: 5000 })
  t.time.of = { 'ada.2': 'ada' }
  t.time.by = { ada: { tokens: 5, added: 1, removed: 0 } }
  assert.equal(renameWho(t, 'ada', 'bea'), true)
  assert.deepEqual([...new Set(t.time.spans.map((s) => s.w))].sort(), ['bea', 'bea.2'])
  assert.deepEqual([t.time.of, Object.keys(t.time.by)], [{ 'bea.2': 'bea' }, ['bea']])
})

test('a turn for no task stays for none; a step that ends a wait on you is not a long step; spend after the turn is its task\'s', async () => {
  const id = await underWay()
  // june answers a hand-off that isn't for any task, while her conversation is about a task of her own that's under way
  hub.fileTask({ kind: 'task', text: 'leaderboard cron is late', owner: 'june' })
  const hers = hub.tickets.all.at(-1).id
  await hub.ticket('dispatch', hers)
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'startup' })
  await wait(2100)
  begin('june')
  pass('june', 1)
  hub.onHook('june', { hook_event_name: 'Stop' })
  const before = spansOf(hers).reduce((n, s) => n + s.ms, 0)
  // ada's task lands; a hand-off of hers that was stamped for it reaches june afterwards: that turn is for no task
  const late = hub.post({ kind: 'msg', from: 'ada', to: 'june', text: 'one more thing about the menu' })
  assert.equal(late.forTask, id)
  hub.taskCommand('ada', ['done', String(id), 'done'])
  await hub.ticket('accept', id)
  const june = hub.agents.get('june')
  june.serving = [late]
  june.taskNow = hub.taskFor(june, [late])
  assert.equal(june.taskNow, null, 'a landed task takes no more time')
  hub.setStatus(june, 'working')
  pass('june', 12)
  hub.setStatus(june, 'idle')
  assert.equal(spansOf(hers).reduce((n, s) => n + s.ms, 0), before, "and it isn't booked on the task her conversation is about")
  // a permission that sat for half an hour, then the tool's own hook: the wait is waiting on you, not a 30 minute step
  hub.onHook('ada', { hook_event_name: 'Stop' })
  const t = hub.tickets.get(hers)
  june.taskNow = { id: hers, kind: 'work' }
  hub.setStatus(june, 'working')
  hub.needsYou(june, 'OK to run the tests?')
  pass('june', 30)
  hub.onHook('june', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } })
  assert.ok(!(t.time.steps ?? []).some((s) => s.ms > 5 * MIN), JSON.stringify(t.time.steps))
  assert.ok(near(t.time.spans.findLast((s) => s.k === 'you').ms, 30))
  // its turn ends, and what it spent is reported a moment later: still that task's
  hub.onHook('june', { hook_event_name: 'Stop' })
  hub.addSpend(june, { tokens: 5000 })
  assert.equal(t.time.by.june.tokens, 5000)
})

test('every status change is kept with its time; --checked is kept apart from what was done', async () => {
  const id = await underWay()
  hub.taskCommand('ada', ['done', String(id), 'rebound the handler', '--checked', 'npm test: 41 passed'])
  const t = hub.tickets.get(id)
  assert.equal(t.fix, 'rebound the handler')
  assert.equal(t.checked, 'npm test: 41 passed')
  await hub.ticket('sendBack', id, 'only with a controller')
  hub.taskCommand('ada', ['done', String(id), 'controller path too'])
  assert.equal(t.checked, undefined, 'a report without it does not keep the last one\'s')
  await hub.ticket('accept', id)
  assert.deepEqual(t.moves.map((m) => [m.to, m.by]), [['fixing', 'you'], ['check', 'ada'], ['fixing', 'you'], ['check', 'ada'], ['done', 'you']])
  assert.ok(t.moves.every((m) => m.at >= t.created))
  assert.match(hub.taskCommand('ada', ['show', String(id)]), /Done \(@ada\): controller path too/)
})

// ---- where the time went (the page's own sums) --------------------------------------------------------------

const T0 = 1_700_000_000_000
const at = (min) => T0 + min * MIN
// added at 0, handed off at 10, reported at 60, accepted at 90; milo worked 12-30 and 40-58, waited on you 30-40;
// ada helped 20-28; june triaged 1-2
const TASK = {
  id: 5, key: '5', status: 'done', timed: true, created: T0, updated: at(90), owner: 'milo', fixer: 'milo',
  moves: [{ at: at(10), to: 'fixing', by: 'you' }, { at: at(60), to: 'check', by: 'milo' }, { at: at(90), to: 'done', by: 'you' }],
  time: {
    spans: [
      { w: 'june', k: 'triage', at: at(1), ms: MIN },
      { w: 'milo', k: 'work', at: at(12), ms: 18 * MIN },
      { w: 'ada', k: 'work', at: at(20), ms: 8 * MIN },
      { w: 'milo', k: 'you', at: at(30), ms: 10 * MIN },
      { w: 'milo', k: 'work', at: at(40), ms: 18 * MIN },
    ],
    by: { milo: { tokens: 50000, added: 200, removed: 30 }, ada: { tokens: 9000, added: 12, removed: 8 } },
    files: { 'a.ts': 3, 'b.ts': 1 },
  },
}

test('where the time went: every minute from added to accepted is in exactly one phase', () => {
  const x = taskTiming(TASK)
  assert.equal(x.total, 90 * MIN)
  assert.equal(Object.values(x.phases).reduce((n, v) => n + v, 0), x.total)
  const min = Object.fromEntries(Object.entries(x.phases).map(([k, v]) => [k, v / MIN]))
  // 0-1 and 2-10 waiting, 1-2 triage, 10-12 in the queue, 12-30 and 40-58 working, 30-40 on you, 58-60 between turns, 60-90 review
  assert.deepEqual(min, { wait: 9, triage: 1, queue: 2, under: 0, work: 36, you: 10, idle: 2, review: 30 })
  assert.deepEqual(x.segments.map((s) => s.k), ['wait', 'triage', 'wait', 'queue', 'work', 'you', 'work', 'idle', 'review'])
  assert.equal(x.toReport, 60 * MIN)
  assert.equal(x.asks, 1)
  assert.equal(x.rounds, 0)
})

test('several agents: each has a row with its own time and share, the one who did it first', () => {
  const x = taskTiming(TASK)
  assert.deepEqual(x.agents.map((a) => [a.name, a.role, a.work / MIN, a.you / MIN, a.triage / MIN]), [['milo', 'did', 36, 10, 0], ['ada', 'helped', 8, 0, 0], ['june', 'triaged', 0, 0, 1]])
  assert.equal(x.agents[0].tokens, 50000)
  assert.equal(x.agents[1].added, 12)
  assert.deepEqual(x.files[0], { file: 'a.ts', n: 3 })
  // two at work at once is working once: the task's own strip has no minute twice
  assert.equal(x.phases.work, 36 * MIN)
  // ...and an agent held up on you while a teammate works on: that stretch is yours, as its own row says
  const held = structuredClone(TASK)
  held.time.spans.find((s) => s.w === 'ada').at = at(31)
  const y = taskTiming(held)
  assert.deepEqual([y.phases.you / MIN, y.phases.work / MIN, y.agents[0].you / MIN, y.agents[1].work / MIN], [10, 36, 10, 8])
})

test('a clone has its own row under its original\'s name; sent back counts a round', () => {
  const t = structuredClone(TASK)
  t.time.spans.push({ w: 'milo.2', k: 'work', at: at(41), ms: 5 * MIN })
  t.time.of = { 'milo.2': 'milo' }
  t.moves = [{ at: at(10), to: 'fixing', by: 'you' }, { at: at(50), to: 'check', by: 'milo' }, { at: at(55), to: 'fixing', by: 'you' }, { at: at(60), to: 'check', by: 'milo' }, { at: at(90), to: 'done', by: 'you' }]
  const x = taskTiming(t)
  const clone = x.agents.find((a) => a.name === 'milo.2')
  assert.deepEqual([clone.base, clone.clone, clone.role], ['milo', 2, 'did'])
  assert.equal(x.rounds, 1)
})

test('a task still open runs to now, with the turn that is going; one nothing was written for has no timing', () => {
  const open = { id: 7, key: '7', status: 'fixing', timed: true, created: T0, updated: at(10), owner: 'ada', fixer: 'ada', moves: [{ at: at(10), to: 'fixing', by: 'you' }], time: { spans: [] } }
  const agents = [{ name: 'ada', status: 'working', since: at(12), ticket: 7 }, { name: 'june', status: 'waiting', since: at(15), onTask: 7 }, { name: 'abe', status: 'working', since: at(1), ticket: 9 }]
  const x = taskTiming(open, { now: at(20), agents })
  assert.equal(x.total, 20 * MIN)
  // june (helping on it) has been waiting on you since 15: from then on the task waits on you, whoever else works
  assert.deepEqual([x.phases.wait / MIN, x.phases.queue / MIN, x.phases.work / MIN, x.phases.you / MIN], [10, 2, 3, 5])
  assert.deepEqual(x.agents.map((a) => a.name).sort(), ['ada', 'june'])
  assert.equal(x.done, false)
  assert.equal(taskTiming({ id: 1, status: 'done', created: T0, updated: at(5) }), null)
  // handed to an agent on another computer: nobody is seen on it here, so it says how long it was under way, and
  // doesn't make a queue of it
  const away = taskTiming({ id: 8, key: '8', status: 'done', timed: true, created: T0, updated: at(50), owner: 'rex@workstation', fixer: 'rex@workstation', moves: [{ at: at(5), to: 'fixing', by: 'you' }, { at: at(35), to: 'check', by: 'rex' }, { at: at(50), to: 'done', by: 'you' }] })
  assert.deepEqual([away.phases.wait / MIN, away.phases.under / MIN, away.phases.queue, away.phases.review / MIN, away.agents.length], [5, 30, 0, 15, 0])
})

test('a task reopened after it landed: the time it was closed is no part of what it took', () => {
  const t = structuredClone(TASK)
  t.status = 'check'
  // accepted at 90, reopened two days later, done again in 20 minutes, reported and waiting 5
  const later = 90 + 2 * 24 * 60
  t.moves.push({ at: at(later), to: 'new', by: 'you' }, { at: at(later + 1), to: 'fixing', by: 'you' }, { at: at(later + 21), to: 'check', by: 'milo' })
  t.time.spans.push({ w: 'milo', k: 'work', at: at(later + 2), ms: 19 * MIN })
  const x = taskTiming(t, { now: at(later + 26) })
  assert.equal(x.total, (90 + 26) * MIN)
  assert.equal(x.phases.review, (30 + 5) * MIN)
  assert.equal(x.toReport, (90 + 21) * MIN)
  assert.equal(Object.values(x.phases).reduce((n, v) => n + v, 0), x.total)
})

test('a task from before the time was kept: what is known starts with the first thing written down', () => {
  // added long ago, already under way when its agent's next turn was first timed; then reported and accepted
  const old = { id: 9, key: '9', status: 'done', created: T0 - 5 * 24 * 60 * MIN, updated: at(40), owner: 'ada', fixer: 'ada', moves: [{ at: at(30), to: 'check', by: 'ada' }, { at: at(40), to: 'done', by: 'you' }], time: { spans: [{ w: 'ada', k: 'work', at: at(10), ms: 15 * MIN }] } }
  const x = taskTiming(old)
  assert.equal(x.partial, true)
  assert.deepEqual([x.start, x.total / MIN, x.phases.wait, x.phases.work / MIN, x.phases.idle / MIN, x.phases.review / MIN], [at(10), 30, 0, 15, 5, 10])
  assert.equal(taskTiming(TASK).partial, false)
})

test('where the clique\'s time goes: the phases of many tasks, the one that took most, and your share', () => {
  const quick = { ...structuredClone(TASK), id: 6, moves: [{ at: at(1), to: 'fixing', by: 'you' }, { at: at(11), to: 'check', by: 'milo' }, { at: at(12), to: 'done', by: 'you' }], time: { spans: [{ w: 'milo', k: 'work', at: at(1), ms: 10 * MIN }] } }
  const list = [taskTiming(TASK), null, taskTiming(quick)]
  const s = timingSummary(list)
  assert.equal(s.n, 2)
  assert.equal(s.median, (90 * MIN + 12 * MIN) / 2)
  assert.equal(s.top, 'work')
  assert.equal(s.slowest, 0)
  assert.ok(Math.abs(s.yours - (10 + 30 + 1) / 102) < 1e-9, 'waiting on you and waiting for review are yours')
  assert.equal(timingSummary([null]), null)
  assert.deepEqual([tookText(45_000), tookText(12 * MIN), tookText(112 * MIN), tookText(120 * MIN), tookText(51 * 60 * MIN)], ['45 s', '12 min', '1 h 52 min', '2 h', '2 d 3 h'])
  assert.equal(TIME_PHASES.filter((p) => p.you).map((p) => p.id).join(), 'you,review')
})

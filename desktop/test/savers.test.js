// Token savers (core/savers.js): each one with it on, and with it off, where the ledger says what it would have done.
// Real Hub, fake runner and clock, throwaway CREW_HOME, a stand-in for quick triage's call. CREW_SAVERS picks which are
// on in each test (the rest of the suite runs with them all off). Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-savers-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { serve } = await import('../core/server.js')
const { adapters } = await import('../core/adapters.js')
const { saversFrom, modeOf, report, SAVER_IDS } = await import('../core/savers.js')
const { readTriage, quickTriagePrompt } = await import('../core/tickets.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  starts = []
  typed = []
  running = (n) => this.live.has(n)
  start = (n) => (this.starts.push(n), this.live.add(n))
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
}

const HOUR = 3600000
const CREW = [
  { name: 'june', area: 'backend api, servers' },
  { name: 'kit', area: 'backend api, servers', provider: 'codex' },
  { name: 'iris', area: 'design, ui screens' },
  { name: 'abe', area: 'organiser, triage, admin' },
]
let hub, runner
const setup = (agents = CREW, extra = {}) => {
  mock.timers.reset()
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'board.md', 'tickets.json', 'savers.json', 'stats.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents, ...extra }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1' // launches go through the fake runner
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
}
const on = (ids) => (process.env.CREW_SAVERS = ids)
beforeEach(() => setup())
afterEach(() => {
  mock.timers.reset()
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'steerTimer']) clearTimeout(a[t])
  for (const t of ['statsTimer', 'convoTimer', 'ticketsTimer', 'readsTimer']) clearTimeout(hub[t])
  clearTimeout(hub.ledger.timer)
  process.env.CREW_SAVERS = 'off'
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const ledger = (id) => hub.ledger.data.days[today()]?.[id] ?? {}
const typedTo = (name) => runner.typed.filter((t) => t.n === name).map((t) => t.text)
const events = (name) => hub.feed.filter((e) => e.kind === 'event' && e.from === name).map((e) => e.text)
const up = (name) => (hub.onHook(name, { hook_event_name: 'SessionStart', source: 'startup' }), mock.timers.tick(3000))
const take = (name) => hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt: typedTo(name).at(-1) })
// a conversation of `used` tokens, last at the API `ago` ms back, with the agent's last reply in it
const conversation = (name, used, ago, { ticket, said = 'Should I migrate the tests too?' } = {}) => {
  hub.sessions[name] = `${name}-session`
  const since = Date.now() - ago - HOUR
  hub.convos[name] = { since, tasks: 3, compactions: 0, context: { used, size: 1000000, pct: Math.round(used / 10000) }, lastAt: Date.now() - ago, ...(ticket && { ticket }) }
  if (said) hub.feed.push({ id: `r-${name}`, ts: Date.now() - ago, kind: 'reply', from: name, text: said })
}

test('which savers are on: all of them unless config.json or CREW_SAVERS says otherwise', () => {
  const all = Object.fromEntries(SAVER_IDS.map((id) => [id, true]))
  assert.deepEqual(saversFrom({}, {}), all)
  assert.deepEqual(saversFrom({ savers: false }, {}), Object.fromEntries(SAVER_IDS.map((id) => [id, false])))
  assert.equal(saversFrom({ savers: { coldStart: false } }, {}).coldStart, false)
  assert.equal(saversFrom({ savers: { coldStart: false } }, {}).boardNew, true)
  // a benchmark run's CREW_SAVERS wins over config.json
  assert.deepEqual(saversFrom({ savers: false }, { CREW_SAVERS: 'on' }), all)
  const two = saversFrom({}, { CREW_SAVERS: 'coldStart,boardNew' })
  assert.deepEqual(SAVER_IDS.filter((id) => two[id]), ['coldStart', 'boardNew'])
  assert.equal(modeOf(two), 'coldStart+boardNew')
  assert.equal(modeOf(saversFrom({}, { CREW_SAVERS: 'off' })), 'none')
})

test("spend is filed under the savers that were on, so cost per turn compares with them on and off", () => {
  on('off')
  hub.record('june', { turns: 1, cost: 0.5, tools: 4 })
  on('on')
  hub.record('june', { turns: 1, cost: 0.2, tools: 1 })
  hub.record('june', { delivered: 1 }) // not spend
  const modes = report([hub.ledger]).modes
  assert.deepEqual({ cost: modes.none.cost, turns: modes.none.turns, tools: modes.none.tools }, { cost: 0.5, turns: 1, tools: 4 })
  assert.equal(modes[SAVER_IDS.join('+')].cost, 0.2)
  hub.ledger.save(true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.CREW_HOME, 'savers.json'), 'utf8')).modes.none.turns, 1)
})

// ---- 1. coldStart ----

test('coldStart: a message to a big conversation gone cold starts a new one, with a note of where it stood', () => {
  on('coldStart')
  conversation('june', 230000, 2 * HOUR)
  hub.send({ from: 'abe', to: 'june', text: 'add rate limiting to the api' })
  assert.match(events('june').at(-1), /^started a new conversation: the last one had sat idle 2 hours, and picking it back up would have re-read its 230k tokens/)
  assert.equal(hub.sessions.june, undefined) // a new session, not --resume
  assert.equal(runner.starts.filter((n) => n === 'june').length, 1)
  assert.deepEqual(typedTo('june'), []) // nothing typed into the old one
  up('june')
  const [text] = typedTo('june')
  assert.match(text, /^\[crew\] This is a new conversation\. Your last one sat idle 2 hours, so CLIque started fresh rather than have you re-read all of it\. The last thing you said in it: "Should I migrate the tests too\?"\n\n\[from @abe: it's yours now, no need to report back\] add rate limiting to the api$/)
  assert.deepEqual(ledger('coldStart').on, { n: 1, tokens: 460000 }) // a 1-hour cache write costs 2x
})

test('coldStart off: the message picks the cold conversation up as before, and the ledger counts what that re-read', () => {
  on('off')
  conversation('june', 230000, 2 * HOUR)
  hub.send({ from: 'abe', to: 'june', text: 'add rate limiting to the api' })
  assert.deepEqual(typedTo('june'), ["[from @abe: it's yours now, no need to report back] add rate limiting to the api"])
  hub.pump(hub.agents.get('june')) // looked at again: counted once
  assert.deepEqual(ledger('coldStart').off, { n: 1, tokens: 460000 })
  assert.equal(runner.starts.length, 0)
})

test('coldStart leaves a conversation alone when what comes in follows on from it, or picking it up costs less', () => {
  on('coldStart')
  // you, in its chat or by name: you meant that conversation ("yes" after its question)
  conversation('june', 230000, 2 * HOUR)
  hub.send({ to: 'june', text: 'yes' })
  // a reply to what it said in that conversation
  conversation('kit', 230000, 2 * HOUR)
  hub.send({ from: 'abe', to: 'kit', text: 'yes, migrate them', re: 'r-kit' })
  // the task it was on, sent back
  conversation('iris', 230000, 2 * HOUR, { ticket: 4 })
  hub.send({ to: 'iris', text: 'still broken', ticket: 4, title: 'x' })
  // a teammate's question
  conversation('abe', 230000, 2 * HOUR)
  hub.send({ from: 'iris', to: 'abe', text: 'which port?', ask: true })
  assert.equal(runner.starts.length, 0)
  assert.equal(typedTo('june').length + typedTo('kit').length + typedTo('iris').length + typedTo('abe').length, 4)
  // moved here with its conversation, and not told yet
  setup()
  on('coldStart')
  conversation('june', 230000, 2 * HOUR)
  hub.convos.june.note = '[crew] You were moved to this computer.'
  hub.send({ from: 'abe', to: 'june', text: 'one' })
  // a follow-up that goes in with a new hand-off, in the same turn
  conversation('kit', 230000, 2 * HOUR)
  hub.agents.get('kit').status = 'working'
  hub.send({ from: 'abe', to: 'kit', text: 'a new thing' })
  hub.send({ from: 'abe', to: 'kit', text: 'and yes, migrate them', re: 'r-kit' })
  Object.assign(hub.agents.get('kit'), { status: 'idle' })
  hub.pump(hub.agents.get('kit'))
  assert.equal(runner.starts.length, 0)
  assert.match(typedTo('kit')[0], /^\[2 hand-offs came in while you were busy/)
  // under an hour, or small enough that a rewrite costs less than a new conversation (120k / 2x = 60k)
  setup()
  on('coldStart')
  conversation('june', 230000, 50 * 60000)
  conversation('iris', 55000, 3 * HOUR)
  hub.send({ from: 'abe', to: 'june', text: 'one' })
  hub.send({ from: 'abe', to: 'iris', text: 'two' })
  assert.equal(runner.starts.length, 0)
  assert.deepEqual(ledger('coldStart'), {})
})

test("coldStart: what Auto picks for you isn't a follow-up", () => {
  on('coldStart')
  conversation('iris', 230000, 2 * HOUR)
  hub.send({ text: 'the ui screens look off on small phones' })
  assert.deepEqual(runner.starts, ['iris'])
})

test('coldStart measures by what a cache write costs: 5-minute caches (an API key) at 1.25x, Codex at 1x', () => {
  on('coldStart')
  // Claude Code on an API key: its transcript's last cache write was a 5-minute one, so 96k is where restarting pays
  const transcript = path.join(process.env.CREW_HOME, 'june.jsonl')
  fs.writeFileSync(transcript, `${JSON.stringify({ message: { usage: { cache_creation: { ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 0 } } } })}\n`)
  hub.agents.get('june').transcript = { id: 'june-session', path: transcript }
  conversation('june', 90000, 2 * HOUR)
  hub.send({ from: 'abe', to: 'june', text: 'one' })
  assert.equal(runner.starts.length, 0)
  Object.assign(hub.agents.get('june'), { status: 'idle', expect: null }) // done with it
  conversation('june', 100000, 2 * HOUR)
  hub.send({ from: 'abe', to: 'june', text: 'two' })
  assert.deepEqual(runner.starts, ['june'])
  assert.deepEqual(ledger('coldStart').on, { n: 1, tokens: 125000 })
  // Codex: no write premium, so only past 120k
  conversation('kit', 110000, 2 * HOUR)
  hub.send({ from: 'abe', to: 'kit', text: 'three' })
  assert.deepEqual(runner.starts, ['june'])
})

// ---- 2. boardNew ----

const notes = (n, from = 'iris') => Array.from({ length: n }, (_, i) => hub.note(from, `note ${i + 1}: the api uses port ${4000 + i}`))

test("boardNew: an agent's first look shows the newest 20, then only what's new since it last looked", () => {
  on('boardNew')
  notes(25)
  const first = hub.board('june')
  assert.equal(first.split('\n').filter((l) => l.startsWith('- ')).length, 20)
  assert.match(first, /note 6: [\s\S]*note 25: /)
  assert.match(first, /\(the last 20 notes; 5 older: crew board --all, or crew board <words> to search\)\n$/)
  hub.note('abe', 'deploys are frozen until Friday')
  const next = hub.board('june')
  assert.match(next, /^- \*\*abe\*\* \(.+\): deploys are frozen until Friday\n\(1 new since you last looked; 25 older: crew board --all/)
  assert.match(hub.board('june'), /^\(nothing new on the board since you last looked; 26 older/)
  // another agent, and a new conversation, start from the newest 20 again
  assert.match(hub.board('kit'), /\(the last 20 notes; 6 older/)
  hub.newConvo(hub.agents.get('june'))
  assert.match(hub.board('june'), /\(the last 20 notes; 6 older/)
  // words search them, --all shows them all, and you in a terminal always see them all
  assert.match(hub.board('june', ['port', '4003']), /^- .*note 4: the api uses port 4003\n\(1 note mentioning port 4003\)\n$/)
  assert.match(hub.board('june', ['nothing-like-it']), /^\(no note mentions "nothing-like-it"\)/)
  assert.equal(hub.board('june', ['--all']).split('\n').filter(Boolean).length, 26)
  assert.equal(hub.board('you').split('\n').filter(Boolean).length, 26)
  // compacted: what it had read is summarized away, so the newest come again
  hub.board('june')
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'compact' })
  assert.match(hub.board('june'), /\(the last 20 notes; 6 older/)
  assert.equal(ledger('boardNew').on.n, 7)
  assert.ok(ledger('boardNew').on.tokens > 0)
})

test('boardNew off: the whole board every time, and the ledger counts what showing only the new notes would leave out', () => {
  on('off')
  notes(25)
  assert.equal(hub.board('june').split('\n').filter(Boolean).length, 25)
  assert.equal(hub.board('june').split('\n').filter(Boolean).length, 25)
  const off = ledger('boardNew').off
  assert.equal(off.n, 2)
  // the second look had nothing new: all 25 notes were the saving
  const all = Math.ceil(hub.board('you').length / 4)
  assert.ok(off.tokens > all, `${off.tokens} > ${all}`)
})

test('boardNew keeps a note to one decision or gotcha: an agent\'s long one is turned away, yours never are', () => {
  on('boardNew')
  assert.throws(() => hub.note('iris', 'x'.repeat(900)), /not shared: a note is one decision, interface or gotcha, and this one is 900 characters \(keep it under 800\)\. Put the details in a file in the repo/)
  assert.equal(hub.note('you', 'x'.repeat(900)), 'shared with the crew\n')
  on('off')
  assert.equal(hub.note('iris', 'x'.repeat(900)), 'shared with the crew\n')
})

// ---- 3. busyCheck ----

test('crew busy says what each teammate is on: the task or message, the files it edits, what it has leased', () => {
  on('busyCheck')
  hub.send({ to: 'iris', text: 'redo the login screen, the new mockups are in figma' })
  take('iris')
  hub.leases.set('/repo/ui/Login.tsx', { name: 'iris', ws: hub.ws, at: Date.now() })
  hub.held.set('ios simulator', { thing: 'iOS simulator', name: 'iris', ws: hub.ws, why: '', at: Date.now() })
  hub.agents.get('kit').inbox.push({ id: 'q', text: 'later' })
  hub.agents.get('abe').off = true
  const out = hub.busy('june')
  assert.match(out, /^kit {14}free, 1 queued$/m)
  assert.match(out, /^iris {13}working on "redo the login screen, the new mockups are in figma" · editing Login\.tsx · has iOS simulator$/m)
  assert.doesNotMatch(out, /june|abe/)
  assert.deepEqual(ledger('busyCheck').on, { n: 1 })
  setup([{ name: 'june' }])
  assert.equal(hub.busy('june'), '(nobody else in the crew right now)\n')
})

test('busyCheck: what an agent checks before it builds is decided at launch, and nothing when it works alone', () => {
  const prompt = (checks) => {
    const args = adapters.claude({ name: 'june', area: 'backend' }, { session: 's', attachments: '/a', platform: 'darwin', bin: '/b', checks }).args
    return args[args.indexOf('--append-system-prompt') + 1]
  }
  assert.match(prompt('full'), /Before you build something, check that nobody is building it already: crew board, open PRs/)
  assert.match(prompt('busy'), /Before you build something, run crew busy to see what your teammates are on/)
  assert.doesNotMatch(prompt('none'), /Before you build something/)
  assert.match(prompt('none'), /One builder per piece of work:\n- Work in your folder/)
  for (const p of ['full', 'busy', 'none'].map(prompt)) assert.match(p, /crew busy {17}what each teammate is working on right now\n {2}crew board \[words\] {8}read the shared notes, or search them/)
  const codex = adapters.codex({ name: 'kit' }, { checks: 'busy', platform: 'darwin' }).args.find((x) => x.startsWith('developer_instructions='))
  assert.match(codex, /run crew busy/)

  on('busyCheck')
  assert.equal(hub.checksFor(hub.agents.get('june')), 'busy')
  on('off')
  assert.equal(hub.checksFor(hub.agents.get('june')), 'full')
  // alone: no teammate, no clones. A clone of its own means company in its folder.
  on('busyCheck')
  setup([{ name: 'june' }])
  assert.equal(hub.checksFor(hub.agents.get('june')), 'none')
  setup([{ name: 'june', clones: 2 }])
  assert.equal(hub.checksFor(hub.agents.get('june')), 'busy')
})

test('busyCheck: switching it starts running agents again once they are free; a teammate joining does not', () => {
  on('busyCheck')
  setup([{ name: 'june' }])
  hub.launch(hub.agents.get('june')) // launched alone: no check
  assert.equal(hub.agents.get('june').checks, 'none')
  hub.agents.get('june').status = 'idle'
  runner.starts = []
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'june' }, { name: 'iris' }] }))
  hub.loadConfig()
  assert.ok(!runner.starts.includes('june')) // its next launch has the check
  on('off')
  hub.agents.get('june').status = 'working'
  hub.loadConfig()
  assert.equal(hub.agents.get('june').relaunch, true) // busy: once it's free
  hub.agents.get('june').status = 'idle'
  hub.loadConfig()
  assert.ok(runner.starts.includes('june'))
  assert.equal(hub.agents.get('june').checks, 'full')
})

// ---- 4. quickTriage ----

const triageWith = (answer) => {
  hub.config.triage = 'abe'
  const calls = []
  hub.oneShot = async (provider, { prompt }) => {
    calls.push({ provider: provider.id, prompt })
    if (answer instanceof Error) throw answer
    return { text: answer, cost: 0.0021, tokens: 3100 }
  }
  return calls
}
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
}

test("quickTriage: one short call triages the task, and the triage agent's conversation never sees it", async () => {
  on('quickTriage')
  const calls = triageWith('{"owner": "june", "priority": "high", "kind": "bug", "title": "Login returns 500", "details": "POST /login returns 500 since the deploy. Look in api/auth.js"}')
  assert.match(hub.fileTask({ kind: 'bug', text: 'login gives a 500 since the deploy, see api/auth.js' }), /@abe is triaging it/)
  await settle()
  const t = hub.tickets.get(1)
  assert.deepEqual({ owner: t.owner, severity: t.severity, title: t.title, triaged: t.triaged }, { owner: 'june', severity: 'high', title: 'Login returns 500', triaged: true })
  assert.equal(t.report, 'login gives a 500 since the deploy, see api/auth.js') // the user's words are kept
  assert.deepEqual(typedTo('abe'), [])
  assert.ok(hub.feed.some((e) => e.kind === 'task' && e.act === 'triaged' && e.from === 'abe'))
  // what the call was given: the report, the open tasks, and who can own it
  assert.match(calls[0].prompt, /login gives a 500 since the deploy, see api\/auth\.js[\s\S]*Open tasks:\n\(none\)[\s\S]*june {2}idle {2}backend api, servers/)
  assert.deepEqual(ledger('quickTriage').on, { n: 1, cost: 0.0021, tokens: 3100 })
  assert.equal(hub.stats.abe.cost, 0.0021) // its cost is the triage agent's, and the task's
  assert.equal(t.spent.cost, 0.0021)
})

test('quickTriage: the same as an open task is closed as its duplicate', async () => {
  on('quickTriage')
  triageWith('{"dup": 1}')
  hub.tickets.add({ title: 'Login returns 500', body: '' })
  hub.fileTask({ kind: 'bug', text: 'cannot log in, server error' })
  await settle()
  assert.equal(hub.tickets.get(2).dupOf, 1)
  assert.equal(hub.tickets.get(1).seen, 2)
})

test("quickTriage: when the call fails or its answer doesn't hold, the triage agent gets it as before, and its turn counts", async () => {
  on('quickTriage')
  for (const answer of ['june, probably', '{"owner": "nobody-here", "priority": "low", "kind": "task", "title": "x", "details": ""}', new Error('claude: not logged in')]) {
    setup()
    on('quickTriage')
    triageWith(answer)
    hub.fileTask({ kind: 'bug', text: 'login gives a 500' })
    await settle()
    assert.match(typedTo('abe').at(-1), /^\[bug #1 to triage\] login gives a 500/, String(answer))
    assert.equal(ledger('quickTriage').on.failed, 1)
  }
  take('abe')
  hub.addSpend(hub.agents.get('abe'), { cost: 0.04 })
  assert.equal(ledger('quickTriage').on.cost, 0.04)
})

test('quickTriage: a task with a screenshot goes to the triage agent, and one nobody can triage goes by area', async () => {
  on('quickTriage')
  const calls = triageWith('{"dup": 1}')
  hub.fileTask({ kind: 'bug', text: 'look at this', images: [path.join(process.env.CREW_HOME, 'attachments', 'x.png')] })
  await settle()
  assert.equal(calls.length, 0)
  assert.match(typedTo('abe').at(-1), /^\[bug #1 to triage\]/)
  assert.deepEqual(ledger('quickTriage').on, { n: 1, images: 1 })
  // the call fails, and by then the triage agent is off: the owner by area takes it
  setup()
  on('quickTriage')
  triageWith(new Error('rate limited'))
  hub.fileTask({ kind: 'bug', text: 'the backend api returns 500' })
  hub.agents.get('abe').off = true
  await settle()
  assert.equal(hub.tickets.get(1).owner, 'june')
  assert.match(events('crew').at(-1), /^couldn't triage #1, so it goes to @june, whose area it is/)
})

test("quickTriage off: the triage agent's turn, as before, and what it cost goes in the ledger", async () => {
  on('off')
  const calls = triageWith('{"dup": 1}')
  hub.fileTask({ kind: 'bug', text: 'login gives a 500' })
  await settle()
  assert.equal(calls.length, 0)
  assert.match(typedTo('abe').at(-1), /^\[bug #1 to triage\]/)
  take('abe')
  hub.addSpend(hub.agents.get('abe'), { cost: 0.31 })
  assert.deepEqual(ledger('quickTriage').off, { n: 1, cost: 0.31 })
})

test('quick triage reads only a real triage out of an answer', () => {
  assert.deepEqual(readTriage('Sure! {"dup": "#3"}'), { dup: 3 })
  assert.deepEqual(readTriage('```json\n{"owner": "@june", "priority": "Urgent", "kind": "bug", "title": " Crash ", "details": "d"}\n```'), { owner: 'june', priority: 'urgent', kind: 'bug', title: 'Crash', details: 'd' })
  assert.equal(readTriage('{"owner": null, "priority": "low", "kind": "task", "title": "t", "details": ""}').owner, null)
  for (const bad of ['no', '{"priority": "soon", "kind": "bug", "title": "t"}', '{"priority": "low", "kind": "chore", "title": "t"}', '{"priority": "low", "kind": "bug", "title": ""}']) assert.equal(readTriage(bad), null, bad)
  const t = { id: 5, kind: 'task', title: 'Dark mode', body: '', report: 'Dark mode for settings', images: ['/a.png'] }
  assert.match(quickTriagePrompt(t, [], []), /\(#5\):\nDark mode for settings\n\(with a screenshot\)\n\nOpen tasks:\n\(none\)\n\nAgents who can own it \(name, status, area\):\n\(none\)/)
})

// ---- 5. warmRoute ----

test('warmRoute: two agents fit a message equally well, and Auto gives it to the one cheaper to wake', () => {
  on('warmRoute')
  conversation('june', 200000, 2 * HOUR) // cold: its next request rewrites 200k at 2x
  conversation('kit', 40000, 10 * 60000) // warm: reads 40k at 0.1x
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'kit')
  assert.deepEqual(ledger('warmRoute').on, { n: 1, tokens: 396000 })
  on('off')
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'june')
  assert.deepEqual(ledger('warmRoute').off, { n: 1, tokens: 396000 })
  // area still comes first, and a free agent before a busy one
  on('warmRoute')
  assert.equal(hub.route('the ui screens look off', 'you').name, 'iris')
  hub.agents.get('kit').status = 'working'
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'june')
})

test('warmRoute: an agent with no conversation yet counts as starting from scratch', () => {
  on('warmRoute')
  conversation('june', 100000, 10 * 60000) // warm, 10k to read
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'june')
  conversation('june', 100000, 2 * HOUR) // cold, 200k to rewrite: kit's fresh start (120k) is cheaper
  assert.equal(hub.route('the backend api returns 500', 'you').name, 'kit')
})

// ---- 6. noReportBack ----

const handOff = () => {
  hub.send({ from: 'iris', to: 'june', text: 'build the endpoint for the login screen' })
  take('june')
}

test("noReportBack: an agent can't report back to the teammate whose hand-off it's on, but can ask it, or give it new work", () => {
  on('noReportBack')
  handOff()
  assert.throws(() => hub.send({ from: 'june', to: 'iris', text: 'done: the endpoint is in, tests pass' }), /^Error: not sent: @iris handed you this and needs nothing back\. Your final message shows in the chat by itself\. If this is new work for @iris, send it with: crew send iris --new "…"$/)
  assert.throws(() => hub.send({ from: 'june', to: 'iris,abe', text: 'done' }), /\(nothing was sent\)$/)
  assert.equal(hub.feed.filter((e) => e.kind === 'msg' && e.from === 'june').length, 0)
  assert.match(hub.send({ from: 'june', to: 'iris', text: 'now the screen can call it: wire up the button', newWork: true }), /@iris/)
  assert.match(hub.send({ from: 'june', to: 'iris', text: 'which error copy do you want?', ask: true }), /^asked @iris/)
  assert.match(hub.send({ from: 'june', to: 'abe', text: 'deploy it when you can' }), /@abe/)
  // naming the teammate in the text isn't sending it a report
  assert.match(hub.send({ from: 'june', to: 'abe', text: 'deploy it so @iris can try it' }), /@abe/)
  assert.equal(ledger('noReportBack').on.n, 2)
  // a hand-off that asked something (the old way, by crew send) gets its answer back
  setup()
  on('noReportBack')
  hub.send({ from: 'iris', to: 'june', text: 'what does the login endpoint return?' })
  take('june')
  assert.match(hub.send({ from: 'june', to: 'iris', text: 'a token and the user' }), /@iris/)
})

test('noReportBack off: the report goes, and the ledger counts it', () => {
  on('off')
  handOff()
  assert.match(hub.send({ from: 'june', to: 'iris', text: 'done: the endpoint is in' }), /@iris/)
  assert.equal(ledger('noReportBack').off.n, 1)
})

test('`crew send <name> --new "…"` says it is new work', async () => {
  mock.timers.reset() // a real server
  on('noReportBack')
  handOff()
  const server = await serve(hub)
  const post = (route, body) => new Promise((resolve, reject) => {
    const req = http.request({ port: server.address().port, method: 'POST', path: route, headers: { 'x-crew': hub.token } }, (res) => {
      let out = ''
      res.on('data', (c) => (out += c))
      res.on('end', () => resolve({ status: res.statusCode, out }))
    })
    req.on('error', reject)
    req.end(body)
  })
  try {
    assert.equal((await post('/send?from=june&to=iris', 'done, all in')).status, 400)
    const ok = await post('/send?from=june&to=iris', '--new wire up the button')
    assert.equal(ok.status, 200)
    assert.equal(hub.feed.findLast((e) => e.kind === 'msg' && e.from === 'june').text, 'wire up the button')
    // crew board's words, and crew busy
    hub.note('iris', 'the endpoint is POST /login')
    assert.match((await post('/board?from=june', 'login\0')).out, /1 note mentioning login/)
    assert.equal((await post('/board', '')).out.split('\n').filter(Boolean).length, 1) // an older crew: everything
    assert.match((await post('/busy?from=june', '')).out, /^iris /m)
  } finally {
    server.close()
  }
})

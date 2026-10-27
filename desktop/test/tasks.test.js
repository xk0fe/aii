// The Tasks board and fresh conversations, against the real Hub with a fake runner in a throwaway CREW_HOME:
// filing, triage, owner by area, fixing in a fresh conversation, "still broken", context. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-bugs-'))
const { Hub, CONFIG, ownerFor } = await import('../core/hub.js')
const { splitReport } = await import('../core/tickets.js')
const { fromStatusLine, fromCodexLog } = await import('../core/context.js')

const CREW = [
  { name: 'david', area: 'game client: controls, input, pause menu, UI screens' },
  { name: 'joseph', area: 'backend api, servers, leaderboards' },
  { name: 'arie', area: 'organiser, triage, admin' },
]

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  starts = []
  running = (n) => this.live.has(n)
  start = (n) => (this.starts.push(n), this.live.add(n))
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
}

let hub, runner
const files = () => ['tickets.json', 'conversations.json', 'sessions.json', 'feed.jsonl'].forEach((f) => fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true }))
beforeEach(() => {
  files()
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CREW }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
})
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

const started = (name) => hub.onHook(name, { hook_event_name: 'SessionStart', source: 'startup' })
const settle = () => new Promise((r) => setTimeout(r, 0))
const lastTyped = (name) => runner.typed.filter((t) => t.n === name).at(-1)?.text ?? ''

test('a report becomes a title and details', () => {
  assert.deepEqual(splitReport('Jump does nothing after pause'), { title: 'Jump does nothing after pause', body: '' })
  const r = splitReport('Jump does nothing after pause. Happens every time on level 2, both controllers.')
  assert.equal(r.title, 'Jump does nothing after pause')
  assert.match(r.body, /level 2/)
})

test('without a triage agent, a bug goes to whoever owns that area, and only a real match counts', () => {
  assert.match(hub.fileTask({ kind: 'bug', text: 'pause menu buttons overlap on small screens' }), /added #1 for @david/)
  const t = hub.tickets.get(1)
  assert.equal(t.owner, 'david')
  assert.equal(t.status, 'new')
  assert.equal(hub.feed.at(-1).kind, 'task')
  assert.equal(ownerFor('the sky colour is weird', [...hub.agents.values()]), null)
})

test('with a triage agent, it gets the raw report to triage, without becoming "about" that bug', async () => {
  hub.config.triage = 'arie'
  assert.match(hub.fileTask({ kind: 'bug', text: 'jump broken after pause' }), /@arie is triaging it/)
  const msg = hub.feed.findLast((e) => e.kind === 'msg')
  assert.equal(msg.to, 'arie')
  assert.equal(msg.triage, true)
  assert.match(lastTyped('arie'), /\[bug #1 to triage\]/)
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'arie').ticket, null)
  assert.equal(hub.tickets.get(1).owner, null)
})

test('triage via `crew bug triage` assigns it; with Auto-fix the owner gets it in a fresh conversation', async () => {
  hub.config.triage = 'arie'
  hub.config.autofix = true
  hub.fileTask({ kind: 'bug', text: 'jump broken after pause' })
  const out = hub.taskCommand('arie', ['triage', '1', '--owner', 'david', '--severity', 'high', '--title', 'Jump dead after unpausing', '--details', '1. pause 2. resume 3. press jump'])
  assert.match(out, /#1: bug, for @david, sent to them/)
  await settle()
  const t = hub.tickets.get(1)
  assert.equal(t.title, 'Jump dead after unpausing')
  assert.equal(t.status, 'fixing')
  const david = hub.agents.get('david')
  // a fresh conversation first: the CLI is relaunched without a session, the bug waits for it
  assert.equal(david.status, 'starting')
  assert.equal(david.inbox.length, 1)
  assert.ok(hub.feed.some((e) => e.fresh && e.from === 'david'), 'a "new conversation" divider in the feed')
  started('david')
  await new Promise((r) => setTimeout(r, 2100)) // the prompt box gets a moment after SessionStart
  assert.match(lastTyped('david'), /\[bug #1\] Jump dead after unpausing[\s\S]*crew task done 1 /)
  // triage rewrote it, and the fixer still gets the report word for word (paths, repro commands)
  assert.match(lastTyped('david'), /as written:\njump broken after pause/)
  assert.match(lastTyped('david'), /don't guess/)
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'david').ticket, 1) // remembered on the conversation
})

test('fixed → check → "still broken" goes back to the same conversation; "works" closes it', async () => {
  const notices = []
  hub.on('notice', (n) => notices.push(n))
  hub.fileTask({ kind: 'bug', text: 'pause menu does not close' })
  await hub.ticket('dispatch', 1)
  started('david')
  await new Promise((r) => setTimeout(r, 2100))
  hub.onHook('david', { hook_event_name: 'UserPromptSubmit', prompt: lastTyped('david') })
  hub.onHook('david', { hook_event_name: 'Stop' })
  assert.match(hub.taskCommand('david', ['fixed', '1', 'the close button lost its handler; re-bound it, checked by hand']), /waiting for the user to review/)
  assert.equal(hub.tickets.get(1).status, 'check')
  assert.equal(notices[0].focus, 'task:1')
  // still broken: same agent, same conversation (no fresh start), with your note
  await hub.ticket('broken', 1, 'only with a controller')
  await new Promise((r) => setTimeout(r, 700))
  assert.notEqual(hub.agents.get('david').status, 'starting')
  assert.match(lastTyped('david'), /Sent back: still broken\. The user says: only with a controller/)
  assert.equal(hub.tickets.get(1).status, 'fixing')
  hub.taskCommand('david', ['fixed', '1', 'controller path too'])
  await hub.ticket('works', 1)
  assert.equal(hub.tickets.get(1).status, 'done')
})

test('duplicates count on the original; agents can list, show, note and report', () => {
  hub.fileTask({ kind: 'bug', text: 'pause menu overlaps' })
  hub.fileTask({ kind: 'bug', text: 'pause menu overlapping again' })
  assert.match(hub.taskCommand('arie', ['dup', '2', '1']), /#2 is #1 \(seen 2x now\)/)
  assert.equal(hub.tickets.get(2).status, 'done')
  assert.match(hub.taskCommand('joseph', ['list']), /#1 .*seen 2x/)
  hub.taskCommand('joseph', ['note', '1', 'not the server, client only'])
  assert.match(hub.taskCommand('david', ['show', '1']), /joseph: not the server/)
  assert.match(hub.taskCommand('joseph', ['report', 'Leaderboard 500s', '--details', 'GET /scores fails']), /added #3/)
  assert.equal(hub.tickets.get(3).by, 'joseph')
  assert.throws(() => hub.taskCommand('david', ['show', '99']), /no task #99/)
  assert.match(hub.taskCommand('david', ['help']), /crew task done/)
})

test('new conversation: right away when free, after the task when busy', () => {
  hub.freshStart('joseph')
  assert.equal(hub.agents.get('joseph').status, 'starting')
  const david = hub.agents.get('david')
  david.status = 'working'
  hub.freshStart('david')
  assert.equal(david.status, 'working')
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'david').freshPending, true)
  hub.onHook('david', { hook_event_name: 'Stop' })
  assert.equal(david.status, 'starting')
  assert.equal(david.freshPending, false)
})

test('a message sent "fresh" waits for its new conversation', () => {
  hub.send({ to: 'joseph', text: 'look at the 500s', fresh: true })
  const joseph = hub.agents.get('joseph')
  assert.equal(joseph.status, 'starting')
  assert.equal(joseph.inbox.length, 1)
})

test('context from Claude Code\'s status line, tasks per conversation, compaction and /clear', () => {
  const line = hub.onStatusLine('david', { context_window: { context_window_size: 200000, used_percentage: 64, current_usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 127000 } } })
  assert.match(line, /context 64% · 128k of 200k/)
  const convo = () => hub.snapshot().agents.find((a) => a.name === 'david').convo
  assert.equal(convo().context.pct, 64)
  // a resumed session reports no usage until its next message: keep what we knew
  hub.onStatusLine('david', { context_window: { context_window_size: 200000, current_usage: null, used_percentage: null } })
  assert.equal(convo().context.pct, 64)
  hub.onHook('david', { hook_event_name: 'UserPromptSubmit', prompt: 'do a thing' })
  hub.onHook('david', { hook_event_name: 'UserPromptSubmit', prompt: '/compact' })
  assert.equal(convo().tasks, 1)
  hub.onHook('david', { hook_event_name: 'SessionStart', source: 'compact' })
  assert.equal(convo().compactions, 1)
  hub.onHook('david', { hook_event_name: 'SessionStart', source: 'clear' })
  assert.equal(convo().tasks, 0)
  assert.equal(convo().context, undefined)
})

test('context from a Codex session log', () => {
  const file = path.join(process.env.CREW_HOME, 'rollout.jsonl')
  const count = (total) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: total }, model_context_window: 258400 } } })
  fs.writeFileSync(file, [count(20000), '{"type":"event_msg","payload":{"type":"token_count","info":null}}', count(135200)].join('\n') + '\n')
  assert.deepEqual(fromCodexLog(file), { used: 135200, size: 258400, pct: 50 })
  assert.equal(fromStatusLine({}), null)
})

// ---- from review: the edges -------------------------------------------------------------------

test('dispatch survives a null options argument (how Crew Link delivers a missing one)', async () => {
  hub.fileTask({ kind: 'bug', text: 'pause menu stuck' })
  await hub.ticket('dispatch', 1, null)
  assert.equal(hub.tickets.get(1).status, 'fixing')
})

test('"still broken" waits its turn in a fresh conversation when another bug is lined up first', async () => {
  hub.fileTask({ kind: 'bug', text: 'pause menu stuck' })
  hub.fileTask({ kind: 'bug', text: 'pause menu flickers on input' })
  await hub.ticket('dispatch', 1)
  started('david')
  await new Promise((r) => setTimeout(r, 2100))
  const david = hub.agents.get('david')
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'david').ticket, 1)
  david.status = 'working' // still at it when bug 2 and the "still broken" come in
  hub.taskCommand('david', ['fixed', '1', 'rebound the close button'])
  await hub.ticket('dispatch', 2)
  await hub.ticket('broken', 1, 'still stuck with a controller')
  // bug 2 starts a fresh conversation first, so #1 can't count on "the same conversation" any more
  const last = david.inbox.at(-1)
  assert.equal(last.ticket, 1)
  assert.equal(last.fresh, true)
  assert.doesNotMatch(last.text, /Sent back/)
})

test('one fresh task, one restart: a pending fresh start serves the task waiting for it', () => {
  const joseph = hub.agents.get('joseph')
  joseph.status = 'working'
  hub.freshStart('joseph')
  hub.send({ to: 'joseph', text: 'look at the 500s', fresh: true })
  runner.starts.length = 0
  hub.onHook('joseph', { hook_event_name: 'Stop' })
  started('joseph')
  assert.deepEqual(runner.starts, ['joseph'])
  assert.equal(hub.feed.filter((e) => e.fresh && e.from === 'joseph' && e.kind === 'event').length, 1)
})

test('a late `crew bug fixed` does not reopen a closed bug; a double send is caught', async () => {
  hub.fileTask({ kind: 'bug', text: 'pause menu stuck' })
  hub.fileTask({ kind: 'bug', text: 'pause menu stuck again' })
  hub.taskCommand('arie', ['dup', '2', '1'])
  assert.throws(() => hub.taskCommand('david', ['fixed', '2', 'done']), /already closed \(same as #1\)/)
  hub.agents.get('david').status = 'working'
  await hub.ticket('dispatch', 1)
  assert.match(await hub.ticket('dispatch', 1), /already queued/)
  assert.equal(hub.agents.get('david').inbox.filter((m) => m.ticket === 1).length, 1)
})

test('bug refs naming this computer work here; dup refs must be on one computer', () => {
  hub.self = 'mac'
  hub.fileTask({ kind: 'bug', text: 'pause menu stuck' })
  hub.fileTask({ kind: 'bug', text: 'pause menu stuck again' })
  assert.match(hub.taskCommand('joseph', ['note', '1@mac', 'client side']), /noted on #1/)
  assert.throws(() => hub.taskCommand('arie', ['dup', '2', '1@air']), /same computer/)
  assert.match(hub.taskCommand('arie', ['dup', '2@mac', '1']), /#2 is #1/)
})

test('a just-closed old bug stays on the board', async () => {
  for (let i = 0; i < 62; i++) hub.tickets.add({ text: `bug ${i}` })
  for (const t of hub.tickets.all.slice(1)) Object.assign(t, { status: 'done', updated: 1000 + t.id })
  await hub.ticket('works', 1)
  assert.ok(hub.snapshot().tasks.tickets.some((t) => t.id === 1))
})

test('renaming an agent keeps its conversation numbers and the bugs it owns', () => {
  hub.fileTask({ kind: 'bug', text: 'pause menu stuck' })
  hub.onStatusLine('david', { context_window: { context_window_size: 200000, used_percentage: 30, current_usage: { input_tokens: 60000 } } })
  hub.update('david', { name: 'dave' })
  assert.equal(hub.tickets.get(1).owner, 'dave')
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'dave').convo.context.pct, 30)
})

test('context numbers are numbers, whatever the status line sends', () => {
  const c = fromStatusLine({ context_window: { context_window_size: '<b>200000</b>', used_percentage: 'x' } })
  assert.equal(c, null)
  assert.deepEqual(fromStatusLine({ context_window: { context_window_size: 1000, used_percentage: 7, current_usage: { input_tokens: '70' } } }), { used: 70, size: 1000, pct: 7 })
})

// ---- Tasks: kinds, owners you name, priority words -----------------------------------------------

test('a task is a task unless it says otherwise; kinds and priorities change by name', () => {
  hub.fileTask({ text: 'Add a settings screen for controls' })
  const t = hub.tickets.get(1)
  assert.equal(t.kind, 'task')
  assert.match(hub.taskCommand('arie', ['triage', '1', '--kind', 'feature', '--priority', 'urgent']), /#1: feature/)
  assert.equal(t.kind, 'feature')
  assert.equal(t.severity, 'blocker')
  assert.throws(() => hub.taskCommand('arie', ['triage', '1', '--priority', 'whenever']), /urgent, high, medium, low/)
  assert.match(hub.taskCommand('joseph', ['add', 'Cache the leaderboard', '--kind', 'task', '--priority', 'low']), /added #2/)
  assert.equal(hub.tickets.get(2).severity, 'low')
  assert.match(hub.taskCommand('joseph', ['list']), /#1 +feature +new +urgent/)
})

test('naming the owner skips triage; a feature gets a "do it" brief, not a bug hunt', async () => {
  hub.config.triage = 'arie'
  assert.match(hub.fileTask({ text: 'Add a pause menu shortcut', kind: 'feature', owner: '@david' }), /added #1 for @david/)
  assert.equal(hub.tickets.get(1).triaged, true)
  assert.equal(hub.agents.get('arie').inbox.length + runner.typed.filter((x) => x.n === 'arie').length, 0)
  await hub.ticket('dispatch', 1)
  started('david')
  await new Promise((r) => setTimeout(r, 2100))
  assert.match(lastTyped('david'), /\[feature #1\] Add a pause menu shortcut[\s\S]*Do it, and keep to what it asks/)
  assert.doesNotMatch(lastTyped('david'), /Reproduce it/)
})

test('the old names still work: crew bug fixed / report, works / broken', async () => {
  hub.fileTask({ text: 'pause menu stuck', kind: 'bug' })
  await hub.ticket('dispatch', 1)
  assert.match(hub.taskCommand('david', ['fixed', '1', 'rebound it']), /review/)
  await hub.ticket('works', 1)
  assert.equal(hub.tickets.get(1).status, 'done')
  assert.match(hub.taskCommand('joseph', ['report', 'Scores lag']), /added #2/)
})

test('an agent that is off never gets a task from a teammate; one you give it waits and starts when it is back on', async () => {
  hub.config.triage = 'arie'
  hub.config.autofix = true
  hub.update('david', { off: true })
  hub.fileTask({ kind: 'bug', text: 'pause menu buttons overlap' })
  // triage can't hand it to david while he's off: it hears why, and the task stays unassigned
  assert.throws(() => hub.taskCommand('arie', ['triage', '1', '--owner', 'david']), /@david is turned off, so it can't take #1/)
  assert.equal(hub.tickets.get(1).owner, null)
  assert.throws(() => hub.taskCommand('joseph', ['add', 'Fix the pause menu', '--owner', 'david']), /@david is turned off/)
  // from you it's fine: the task waits for david, says so once, and Start says why it can't go yet
  assert.match(hub.taskCommand('you', ['add', 'Fix the pause menu', '--owner', 'david']), /added #2/)
  assert.match(hub.fileTask({ text: 'Jump is dead after pause', owner: 'david' }), /added #3 for @david/)
  await settle()
  assert.equal(hub.tickets.get(3).status, 'new')
  assert.ok(hub.feed.some((e) => e.kind === 'event' && /#3 waits for @david, who is turned off/.test(e.text)))
  assert.ok(!hub.feed.some((e) => /couldn't send #3/.test(e.text ?? '')))
  await assert.rejects(hub.ticket('dispatch', 3), /@david is turned off: turn it on to start #3/)
  // back on: with Auto-start, what waited for him starts, each in a new conversation
  hub.url = 'http://127.0.0.1:1'
  hub.update('david', { off: undefined })
  await settle()
  for (const id of [2, 3]) assert.equal(hub.tickets.get(id).status, 'fixing')
  const david = hub.agents.get('david')
  assert.deepEqual(david.inbox.map((m) => m.ticket), [2, 3])
  assert.ok(david.inbox.every((m) => m.fresh))
})

test('without Auto-start, an agent coming back on waits for you to start its tasks', async () => {
  hub.update('david', { off: true })
  hub.fileTask({ text: 'Jump is dead after pause', owner: 'david' })
  hub.url = 'http://127.0.0.1:1'
  hub.update('david', { off: undefined })
  await settle()
  assert.equal(hub.tickets.get(1).status, 'new')
  assert.equal(hub.agents.get('david').inbox.length, 0)
})

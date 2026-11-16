// Right of way: `clique ask` and its answer coming back, who goes first when agents need each other (no waiting in
// circles, no handing work back), the order a queue is taken in, one editor per file, and a declined task finding
// its next owner. Real Hub, fake runner and clock, throwaway CLIQUE_HOME. `npm test`.
import { test as nodeTest, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-right-of-way-'))
const { Hub, CONFIG, ASK_HOLD } = await import('../core/hub.js')
const { moveOut, moveEnd } = await import('../core/move.js')
// An asker left waiting forever is exactly the kind of bug these look for: it fails the test instead of hanging it.
const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn)

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

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-right-of-way-app-'))
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
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  setup([
    { name: 'noor', area: 'mobile client code', cwd: DIR },
    { name: 'theo', area: 'qa, play tests', cwd: DIR },
    { name: 'eli', area: 'scrum master, task board', cwd: DIR },
    { name: 'iris', area: 'ui design', cwd: DIR, clones: 2 },
  ])
})
afterEach(async () => {
  mock.timers.reset()
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'reapTimer']) clearTimeout(a[t])
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
const busy = (n) => (agent(n).status = 'working')
// the agent takes up what was typed into it (its CLI reports the prompt), then ends its turn with `text`
const pickUp = (n) => hub.onHook(n, { hook_event_name: 'UserPromptSubmit', prompt: typedInto(n).at(-1) })
const finish = (n, text) => {
  hub.onHook(n, { hook_event_name: 'Stop', ...(text && { last_assistant_message: text }) })
  mock.timers.tick(600) // the prompt box comes back
}
const rules = () => hub.feed.filter((e) => e.kind === 'rule')
const view = (n) => hub.snapshot().agents.find((a) => a.name === n)
// A promise's outcome without awaiting it forever: 'pending' while it hasn't settled.
const peek = async (p) => {
  let out = 'pending'
  p.then((v) => (out = v), (e) => (out = e))
  for (let i = 0; i < 5; i++) await Promise.resolve()
  return out
}

// ---- clique ask: the answer comes back ----

const MIDTURN = '[question from @noor, who is waiting on your answer. Answer it now with clique answer "…", then carry on with what you were doing]'
// a permission prompt up in its terminal: nothing can be typed into it until you answer
const dialog = (n) => {
  hub.ask(n, { tool_name: 'Bash', tool_input: { command: 'npm test' } })
  return hub.feed.findLast((e) => e.kind === 'ask').id
}

test('a free teammate gets the question as its next prompt, and its final message comes straight back into the asker\'s wait', async () => {
  busy('noor') // mid-turn, running `clique ask` in its shell
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build did you test?' })
  assert.equal(typedInto('theo')[0], '[question from @noor, who is waiting on your answer: your final message is the answer, and goes back to @noor by itself]\n<relayed from="noor">\nwhich build did you test?\n</relayed>')
  assert.deepEqual(view('noor').waitingOn.map((w) => w.name), ['theo'])
  assert.deepEqual(view('theo').owes.map((o) => [o.name, o.waiting]), [['noor', true]])
  pickUp('theo')
  assert.equal(await peek(asked), 'pending')
  finish('theo', 'Build 412, on the iPhone Laptop sim.')
  assert.equal(await asked, '@theo answered:\n<relayed from="theo">\nBuild 412, on the iPhone Laptop sim.\n</relayed>\n')
  // nothing left over: no message queued for noor, the question shows as answered, by the reply
  assert.equal(agent('noor').inbox.length, 0)
  const q = hub.feed.find((e) => e.ask)
  const reply = hub.feed.find((e) => e.kind === 'reply' && e.from === 'theo')
  assert.equal(q.answered.by, 'theo')
  assert.equal(q.answered.reply, reply.id)
  assert.equal(reply.re, q.id)
  assert.deepEqual(view('noor').waitingOn, [])
  assert.deepEqual(view('theo').owes, [])
})

test('a busy teammate gets the question in the turn it\'s in, answers with clique answer and carries on', async () => {
  busy('noor')
  busy('theo') // in the middle of a long QA pass
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build did you test?' })
  assert.deepEqual(typedInto('theo'), [`${MIDTURN}\n<relayed from="noor">\nwhich build did you test?\n</relayed>`], 'typed in now, not at the end of its turn')
  assert.deepEqual(agent('theo').inbox, [])
  pickUp('theo') // its CLI takes it in at its next step
  assert.equal(agent('theo').status, 'working')
  assert.equal(hub.answerNow({ from: 'theo', text: 'Build 412.' }), '@noor has your answer.\n')
  assert.equal(await asked, '@theo answered:\n<relayed from="theo">\nBuild 412.\n</relayed>\n')
  // the answer shows in the chat as theo's reply to the question
  const q = hub.feed.find((e) => e.ask)
  const reply = hub.feed.find((e) => e.kind === 'reply' && e.re === q.id)
  assert.equal(reply.text, 'Build 412.')
  assert.equal(q.answered.reply, reply.id)
  // its turn goes on, and its end doesn't answer a second time
  assert.throws(() => hub.answerNow({ from: 'theo', text: 'again' }), /No question to answer/)
  finish('theo', 'QA pass done: two blockers on #4715.')
  assert.equal(hub.feed.filter((e) => e.answers).length, 0)
  assert.equal(agent('noor').inbox.length, 0)
})

test('...and without clique answer, the final message of its turn is the answer', async () => {
  busy('noor')
  busy('theo')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  pickUp('theo')
  finish('theo', 'QA pass done on build 412.')
  assert.equal(await asked, '@theo answered:\n<relayed from="theo">\nQA pass done on build 412.\n</relayed>\n')
})

test('clique answer @name picks which question, when several are waiting', async () => {
  busy('theo')
  busy('noor')
  busy('eli')
  const fromLevi = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  pickUp('theo')
  const fromEstee = hub.question({ from: 'eli', to: 'theo', text: 'is #5 verified?' })
  pickUp('theo')
  assert.equal(hub.answerNow({ from: 'theo', to: '@eli', text: 'Yes, on 402 and 420pt.' }), '@eli has your answer. 1 more question waiting: clique answer "@name" "…"\n', 'quoted, for PowerShell')
  assert.match(await fromEstee, /Yes, on 402/)
  assert.equal(await peek(fromLevi), 'pending')
  assert.throws(() => hub.answerNow({ from: 'theo', to: 'iris', text: 'hi' }), /@iris hasn't asked you anything that's still open/)
  hub.answerNow({ from: 'theo', text: 'Build 412.' })
  assert.match(await fromLevi, /Build 412/)
})

test('not while a permission prompt is up in its terminal: the question waits first in line, and goes in once you answer it', async () => {
  busy('theo')
  hub.send({ from: 'eli', to: 'theo', text: 'recorded #5 as passing' })
  const id = dialog('theo')
  assert.equal(agent('theo').status, 'waiting')
  busy('noor')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'is #4715 good to merge?' })
  assert.deepEqual(agent('theo').inbox.map((m) => m.text), ['is #4715 good to merge?', 'recorded #5 as passing'])
  assert.deepEqual(typedInto('theo'), [])
  hub.answer(id, { allow: true })
  assert.deepEqual(typedInto('theo'), [`${MIDTURN}\n<relayed from="noor">\nis #4715 good to merge?\n</relayed>`])
  assert.deepEqual(agent('theo').inbox.map((m) => m.text), ['recorded #5 as passing'], 'hand-offs wait for the end of the turn')
  pickUp('theo')
  hub.answerNow({ from: 'theo', text: 'Not yet.' })
  assert.match(await asked, /Not yet/)
})

test('not while you\'re typing in its terminal: right after', () => {
  busy('theo')
  hub.input('theo', 'l')
  busy('noor')
  hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  assert.deepEqual(typedInto('theo'), [])
  mock.timers.tick(3000)
  assert.deepEqual(typedInto('theo'), [`${MIDTURN}\n<relayed from="noor">\nwhich build?\n</relayed>`])
})

test('a question its CLI never took in before the turn ended goes back in line, and in as the next prompt', async () => {
  busy('noor')
  busy('theo')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  finish('theo', 'QA pass done.') // ended before its next step: the question wasn't taken in
  assert.equal(agent('theo').steering?.msgs.length, 1)
  mock.timers.tick(5000)
  assert.equal(agent('theo').steering, null)
  assert.equal(typedInto('theo').at(-1), '[question from @noor, who is waiting on your answer: your final message is the answer, and goes back to @noor by itself]\n<relayed from="noor">\nwhich build?\n</relayed>')
  pickUp('theo')
  finish('theo', 'Build 412.')
  assert.match(await asked, /Build 412/)
})

test('...unless its CLI starts a turn with it by itself (Codex does): then that turn answers it, typed in once', async () => {
  busy('noor')
  busy('theo')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  finish('theo', 'QA pass done.')
  mock.timers.tick(1000)
  pickUp('theo') // the CLI goes on with what was typed, as a turn of its own
  assert.equal(agent('theo').status, 'working')
  mock.timers.tick(10000)
  assert.equal(typedInto('theo').length, 1, 'not typed again')
  finish('theo', 'Build 412.')
  assert.match(await asked, /Build 412/)
})

test('an answer that takes longer comes to the asker anyway: into the turn it\'s in, or as its next prompt', async () => {
  const id = dialog('theo')
  busy('noor')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'is #4715 good to merge?' })
  mock.timers.tick(ASK_HOLD)
  const told = await asked
  assert.match(told, /^@theo hasn't answered yet \(your question is next, once it finishes what it is doing\)\./)
  assert.match(told, /Don't ask again\. Carry on with other work and the answer comes to you as a message, or wait more with: clique wait/)
  assert.deepEqual(view('noor').waitingOn, [], 'not stuck waiting any more')
  hub.answer(id, { allow: true })
  pickUp('theo')
  hub.answerNow({ from: 'theo', text: 'Yes, merge it.' })
  // noor is busy with something else: the answer goes into its turn
  assert.equal(typedInto('noor').at(-1), '[answer from @theo to your question "is #4715 good to merge?"]\n<relayed from="theo">\nYes, merge it.\n</relayed>')
  pickUp('noor')
  assert.deepEqual(agent('noor').inbox, [])
  // free, it gets the next one as its prompt
  finish('noor', 'merged')
  const again = hub.question({ from: 'noor', to: 'eli', text: 'board updated?' })
  mock.timers.tick(ASK_HOLD)
  await again
  finish('noor', 'carrying on')
  pickUp('eli')
  finish('eli', 'Yes.')
  assert.equal(typedInto('noor').at(-1), '[answer from @eli to your question "board updated?"]\n<relayed from="eli">\nYes.\n</relayed>')
})

test('a retried question waits on the one already asked instead of asking twice; clique wait waits some more', async () => {
  busy('theo')
  busy('noor')
  const first = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  mock.timers.tick(ASK_HOLD)
  await first
  const again = hub.question({ from: 'noor', to: 'theo', text: '  which   build? ' })
  assert.equal(hub.feed.filter((e) => e.ask).length, 1)
  mock.timers.tick(ASK_HOLD)
  await again
  const more = hub.wait({ from: 'noor' })
  pickUp('theo')
  hub.answerNow({ from: 'theo', text: 'Build 412.' })
  assert.match(await more, /Build 412/)
})

test('clique wait with nothing asked says so', () => {
  assert.equal(hub.wait({ from: 'noor' }), 'Nothing to wait for: every question you asked has been answered.\n')
})

// ---- who goes first: no waiting in circles ----

test('whoever is being waited on never waits on its waiter: that ask is turned down on the spot', async () => {
  busy('noor')
  busy('theo')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build did you test?' })
  pickUp('theo')
  await assert.rejects(hub.question({ from: 'theo', to: 'noor', text: 'which build should I test?' }),
    /^Error: @noor is waiting for your answer, so it can't answer you until you answer\. Don't wait on it: finish with what you know, say what you couldn't check, and your answer unblocks it\.$/)
  assert.deepEqual(agent('noor').inbox, [], 'nothing queued for noor')
  assert.deepEqual(typedInto('noor'), [], 'nor typed in')
  assert.deepEqual(rules().map((r) => [r.rule, r.from, r.to, r.line]), [['loop', 'theo', 'noor', ['noor', 'theo']]])
  // theo answers with what it has, and noor goes on
  hub.answerNow({ from: 'theo', text: 'Build 412 (I could not tell which one you meant).' })
  assert.match(await asked, /Build 412/)
})

test('...down a line of teammates too', async () => {
  for (const n of ['noor', 'theo', 'eli']) busy(n)
  hub.question({ from: 'noor', to: 'theo', text: 'is it merged?' })
  hub.question({ from: 'theo', to: 'eli', text: 'what does the board say?' })
  await assert.rejects(hub.question({ from: 'eli', to: 'noor', text: 'did you push?' }), /^Error: @noor is waiting on @theo, which is waiting for your answer, so it can't answer you/)
  assert.deepEqual(rules().at(-1).line, ['noor', 'theo', 'eli'])
})

test('an asker that stopped waiting can be asked: it is free to answer', async () => {
  busy('noor')
  busy('theo')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  mock.timers.tick(ASK_HOLD)
  await asked
  const back = hub.question({ from: 'theo', to: 'noor', text: 'which branch?' })
  assert.equal(await peek(back), 'pending')
  assert.equal(rules().length, 0)
})

test('work can\'t be handed back to a teammate waiting on your answer: the answer goes back by itself', async () => {
  busy('noor')
  busy('theo')
  hub.question({ from: 'noor', to: 'theo', text: 'can you take the RTL pass?' })
  assert.throws(() => hub.send({ from: 'theo', to: 'noor', text: 'this is your area, you do it' }),
    /^Error: @noor is waiting for your answer to "can you take the RTL pass\?"\. Don't hand it back: put what you'd send it in your answer\. Your final message goes back to @noor by itself\.$/)
  assert.deepEqual(rules().map((r) => [r.rule, r.from, r.to]), [['back', 'theo', 'noor']])
  // anyone else still can
  assert.match(hub.send({ from: 'theo', to: 'eli', text: 'FYI noor asked for an RTL pass' }), /queued for @eli|sent to @eli/)
})

test('a question asked while answering one keeps that one open until its answer is in', async () => {
  for (const n of ['noor', 'eli']) busy(n)
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'is #2 ready?', hold: 3 * ASK_HOLD })
  pickUp('theo')
  // theo needs the board's view first; eli has a dialog up, so theo stops waiting and ends its turn
  const id = dialog('eli')
  const sub = hub.question({ from: 'theo', to: 'eli', text: 'what does the board say about #2?' })
  mock.timers.tick(ASK_HOLD)
  await sub
  assert.equal(await peek(asked), 'pending')
  finish('theo', 'Asked eli, waiting on the board.')
  assert.equal(await peek(asked), 'pending', 'progress, not the answer')
  // eli answers; theo takes that up and finishes: that is noor's answer
  hub.answer(id, { allow: true })
  pickUp('eli')
  hub.answerNow({ from: 'eli', text: '#2 is in review.' })
  assert.match(typedInto('theo').at(-1), /^\[answer from @eli to your question "what does the board say about #2\?"\]\n<relayed from="eli">\n#2 is in review\./)
  pickUp('theo')
  finish('theo', 'Not ready: #2 is still in review.')
  assert.equal(await asked, '@theo answered:\n<relayed from="theo">\nNot ready: #2 is still in review.\n</relayed>\n')
})

test('an asker always hears back: interrupted, exited or turned off, it says so', async () => {
  busy('noor')
  const one = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  pickUp('theo')
  hub.onHook('theo', { hook_event_name: 'Interrupt' })
  assert.equal(await one, '@theo answered:\n\n(@theo stopped before it answered.)\n')
  // typed into its turn but not taken in yet, when you turn it off: told now, rather than waiting for it to come back
  busy('theo')
  const two = hub.question({ from: 'noor', to: 'theo', text: 'and the branch?' })
  assert.ok(agent('theo').steering)
  hub.update('theo', { off: true })
  assert.equal(await two, "@theo answered:\n\n(@theo was turned off, so it can't answer.)\n")
  await assert.rejects(hub.question({ from: 'noor', to: 'theo', text: 'hello?' }), /@theo is turned off/)
})

test('an answer for a clone goes to that clone, not to whichever of its family is free', async () => {
  busy('iris')
  hub.send({ to: 'iris', text: 'build the card' })
  hub.onHook('iris.2', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(2000)
  pickUp('iris.2')
  const id = dialog('theo')
  const asked = hub.question({ from: 'iris.2', to: 'theo', text: 'which sizes do you test?' })
  mock.timers.tick(ASK_HOLD)
  await asked
  finish('iris.2', 'Built it for the sizes I know.')
  agent('iris').status = 'idle'
  busy('iris.2')
  hub.answer(id, { allow: true })
  pickUp('theo')
  hub.answerNow({ from: 'theo', text: '402 and 420pt.' })
  assert.match(typedInto('iris.2').at(-1), /^\[answer from @theo to your question "which sizes do you test\?"\]\n<relayed from="theo">\n402 and 420pt\.\n<\/relayed>$/)
  assert.deepEqual(typedInto('iris').filter((t) => /402/.test(t)), [])
})

// ---- the queue: answers first, then questions, hand-offs together ----

test('hand-offs that piled up go in together, in one turn, and the reply threads to all of them', () => {
  busy('noor')
  hub.send({ from: 'eli', to: 'noor', text: 'triaged #9 to you' })
  hub.send({ from: 'theo', to: 'noor', text: 'QA found two blockers on #4715' })
  hub.send({ from: 'eli', to: 'noor', text: 'recorded the blockers on #2' })
  finish('noor')
  const prompt = typedInto('noor').at(-1)
  assert.equal(typedInto('noor').length, 1, 'one prompt for all three')
  assert.equal(prompt, [
    '[3 hand-offs came in while you were busy, oldest first. Take them together, in this one turn.]',
    "[from @eli: it's yours now, no need to report back]\n<relayed from=\"eli\">\ntriaged #9 to you\n</relayed>",
    "[from @theo: it's yours now, no need to report back]\n<relayed from=\"theo\">\nQA found two blockers on #4715\n</relayed>",
    "[from @eli: it's yours now, no need to report back]\n<relayed from=\"eli\">\nrecorded the blockers on #2\n</relayed>",
  ].join('\n\n'))
  pickUp('noor')
  finish('noor', 'Fixed both blockers in #4747.')
  const msgs = hub.feed.filter((e) => e.kind === 'msg' && e.to === 'noor')
  const reply = hub.feed.findLast((e) => e.kind === 'reply')
  assert.equal(reply.re, msgs[0].id)
  assert.deepEqual(reply.also, [msgs[1].id, msgs[2].id])
  assert.equal(hub.stats.noor.delivered, 3)
})

test('your messages, questions and tasks each still get a turn of their own', () => {
  busy('noor')
  hub.send({ to: 'noor', text: 'resolve the conflicts on #4715' })
  hub.send({ to: 'noor', text: 'then push it' })
  finish('noor')
  assert.deepEqual(typedInto('noor'), ['resolve the conflicts on #4715'])
})

// ---- one file, one editor ----

const edit = (n, file) => hub.lease(n, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(DIR, file), old_string: 'a', new_string: 'b' } })
const denied = (out) => (out ? JSON.parse(out).hookSpecificOutput : null)

test('the first agent to edit a file holds it until its turn ends; anyone else is turned away, told who has it', () => {
  busy('noor')
  busy('theo')
  assert.equal(edit('noor', 'src/Board.tsx'), '')
  assert.equal(edit('noor', 'src/Board.tsx'), '', 'its own again')
  const no = denied(edit('theo', 'src/Board.tsx'))
  assert.equal(no.hookEventName, 'PreToolUse')
  assert.equal(no.permissionDecision, 'deny')
  assert.equal(no.permissionDecisionReason, 'Board.tsx is being edited by @noor right now, and CLIque lets one agent edit a file at a time. Leave it to @noor and do the rest of your work: the file is free again once @noor finishes its turn. If you need a change in it, clique ask noor.')
  assert.equal(edit('theo', 'src/Other.tsx'), '', 'other files are fine')
  denied(edit('theo', 'src/Board.tsx'))
  assert.deepEqual(rules().map((r) => [r.rule, r.from, r.to, r.file]), [['file', 'theo', 'noor', 'Board.tsx']], 'said once')
  finish('noor', 'done')
  assert.equal(edit('theo', 'src/Board.tsx'), '', 'free once its turn is over')
})

test('an agent and its clone never write over each other', () => {
  busy('iris')
  hub.send({ to: 'iris', text: 'the footer' })
  hub.onHook('iris.2', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(2000)
  pickUp('iris.2')
  assert.equal(edit('iris', 'src/Footer.tsx'), '')
  assert.equal(denied(edit('iris.2', 'src/Footer.tsx')).permissionDecision, 'deny')
})

test('Codex\'s apply_patch is checked by the files in its patch', () => {
  busy('noor')
  busy('theo')
  edit('noor', 'src/Board.tsx')
  const patch = '*** Begin Patch\n*** Update File: src/Theme.ts\n@@\n-a\n+b\n*** Update File: src/Board.tsx\n@@\n-a\n+b\n*** End Patch\n'
  const out = hub.lease('theo', { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: patch } })
  assert.match(denied(out).permissionDecisionReason, /^Board\.tsx is being edited by @noor/)
  assert.equal(hub.lease('theo', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }), '', 'other tools pass')
})

test('an agent answering the holder\'s question may edit its files: the holder is waiting on it, not editing', () => {
  busy('noor')
  busy('theo')
  edit('noor', 'src/Board.tsx')
  hub.question({ from: 'noor', to: 'theo', text: 'fix the hold offset in Board.tsx while I wait?' })
  assert.equal(edit('theo', 'src/Board.tsx'), '')
  busy('eli')
  assert.equal(denied(edit('eli', 'src/Board.tsx')).permissionDecision, 'deny', "eli isn't answering noor: still noor's")
})

// ---- a declined task finds its next owner ----

test('a declined task goes straight to the next agent whose area it is, and on to it if it was under way', async () => {
  setup([{ name: 'ada', area: 'mobile client code, layouts' }, { name: 'noor', area: 'mobile client code, alignment' }, { name: 'eli', area: 'task board' }])
  const t = hub.tickets.add({ title: 'Dock footer alignment in the mobile client', by: 'you', owner: 'ada' })
  await hub.dispatch(t.id)
  assert.equal(t.status, 'fixing')
  assert.equal(hub.taskCommand('ada', ['decline', String(t.id), 'this session is limited to bug #3']), `#${t.id} went to @noor, who starts on it now\n`)
  assert.equal(t.owner, 'noor')
  assert.deepEqual(t.declined, ['ada'])
  await Promise.resolve()
  assert.equal(t.status, 'fixing')
  assert.equal(t.fixer, 'noor')
  assert.match(typedInto('noor').at(-1) ?? hub.agents.get('noor').inbox.at(-1).text, /Dock footer alignment/)
  assert.deepEqual(rules().map((r) => [r.rule, r.from, r.to, r.ticket]), [['decline', 'ada', 'noor', t.id]])
  // noor can't take it either, and no one else's area fits: back to you
  const notices = []
  hub.on('notice', (n) => notices.push(n))
  assert.equal(hub.taskCommand('noor', ['decline', String(t.id), 'out of my depth']), `#${t.id} is back on To do, for the user to give to someone\n`)
  assert.equal(t.owner, null)
  assert.equal(t.status, 'new')
  assert.equal(notices[0].title, `#${t.id} needs an owner`)
  assert.throws(() => hub.taskCommand('eli', ['decline', String(t.id), 'not mine']), /only its owner can decline it/)
})

// ---- across computers ----

test('a question for an agent on a linked computer is waited on here, and answered from there', async () => {
  const relayed = []
  hub.relay = async (from, names, text, images, extra) => (relayed.push({ from, names, text, extra }), 'asked @iris\n')
  hub.directory = () => [{ name: 'iris@workstation', seed: 'iris', on: true, status: 'working', waitingOn: [] }]
  busy('noor')
  const asked = hub.question({ from: 'noor', to: 'iris@workstation', text: 'which palette?' })
  await Promise.resolve()
  assert.deepEqual(relayed.map((r) => [r.from, r.names, r.text]), [['noor', ['iris@workstation'], 'which palette?']])
  assert.deepEqual(view('noor').waitingOn.map((w) => w.name), ['iris@workstation'])
  // the answer arrives over CLIque Link
  assert.equal(hub.send({ from: 'iris@workstation', to: 'noor', text: 'Pastel, from the brand guide.', mentions: false, answers: relayed[0].extra.ask }), 'answered\n')
  assert.equal(await asked, '@iris@workstation answered:\n<relayed from="iris@workstation">\nPastel, from the brand guide.\n</relayed>\n')
})

test('...and one from a linked computer is answered there: the answer goes back with its id', async () => {
  const relayed = []
  hub.relay = async (from, names, text, images, extra) => relayed.push({ from, names, text, extra })
  hub.directory = () => []
  assert.equal(hub.send({ from: 'iris@workstation', to: 'noor', text: 'which branch?', mentions: false, ask: 'c0ffee' }), 'asked @noor\n')
  pickUp('noor')
  finish('noor', 'release/2.4')
  assert.deepEqual(relayed, [{ from: 'noor', names: ['iris@workstation'], text: 'release/2.4', extra: { answers: 'c0ffee' } }])
})

test('a loop across computers is caught too, from what the other computer reports', async () => {
  hub.relay = async () => 'asked @iris\n'
  hub.directory = () => [{ name: 'iris@workstation', seed: 'iris', on: true, status: 'working', waitingOn: [{ name: 'noor' }] }]
  await assert.rejects(hub.question({ from: 'noor', to: 'iris@workstation', text: 'which palette?' }), /@iris@workstation is waiting for your answer/)
})

// ---- whoever goes away, its askers hear so (and other edges) ----

test('an agent that moves to another computer: its askers here hear so, and its queue travels without their questions', async () => {
  busy('noor')
  dialog('theo') // it can't take anything in right now: the question waits in its queue
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  hub.send({ from: 'eli', to: 'theo', text: 'recorded #5' })
  const out = await moveOut(hub, 'theo')
  assert.deepEqual(out.inbox.map((m) => m.text), ['recorded #5'])
  moveEnd(hub, out.token, { to: 'laptop', name: 'theo' })
  assert.equal(await asked, '@theo answered:\n\n(@theo moved to another computer before it answered: ask @theo@laptop again.)\n')
  assert.equal(hub.calls.size, 0)
})

test('an agent removed (or renamed) in config.json: its askers hear so', async () => {
  busy('noor')
  dialog('theo')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  hub.removeAgent('theo')
  assert.equal(await asked, '@theo answered:\n\n(@theo went away before it answered.)\n')
})

test('an agent turned off with its clones: a question a clone had is answered, not left in the off agent\'s queue', async () => {
  busy('iris')
  hub.send({ to: 'iris', text: 'the footer' })
  hub.onHook('iris.2', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(2000)
  pickUp('iris.2')
  busy('noor')
  const asked = hub.question({ from: 'noor', to: 'iris.2', text: 'which sizes?' })
  assert.ok(agent('iris.2').steering, 'typed into its turn, not taken in yet')
  hub.update('iris', { off: true })
  assert.match(await asked, /^@iris(\.2)? answered:\n\n\(@iris(\.2)? (was turned off, so it can't answer|went away before it answered)\.\)\n$/)
  assert.deepEqual(agent('iris').inbox.filter((m) => m.ask), [])
})

test('a question put aside while its owner asks a teammate: answered when the owner is turned off', async () => {
  busy('noor')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'is #2 ready?', hold: 3 * ASK_HOLD })
  pickUp('theo')
  dialog('eli')
  const sub = hub.question({ from: 'theo', to: 'eli', text: 'what does the board say?' })
  mock.timers.tick(ASK_HOLD)
  await sub
  finish('theo', 'Asked eli.')
  hub.update('theo', { off: true })
  assert.equal(await asked, "@theo answered:\n\n(@theo was turned off, so it can't answer.)\n")
})

test('the Enter CLIque presses again for a question it typed mid-turn never sends what you\'re typing there', () => {
  busy('noor')
  busy('theo')
  hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  mock.timers.tick(1000)
  hub.input('theo', 'p')
  mock.timers.tick(15000)
  assert.deepEqual(runner.writes.filter((w) => w.name === 'theo').map((w) => w.data), ['p'])
})

test('a fresh start right after a turn: what was typed mid-turn goes in as the new conversation\'s first prompt', () => {
  busy('noor')
  busy('theo')
  hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  hub.freshStart('theo')
  finish('theo', 'done')
  assert.equal(agent('theo').steering, null)
  assert.deepEqual(agent('theo').inbox.map((m) => m.text), ['which build?'])
  assert.equal(agent('theo').status, 'starting')
})

test('an answer for another computer is tried again while that computer can\'t be reached', async () => {
  const tries = []
  hub.relay = async (from, names, text, images, extra) => {
    tries.push(extra.answers)
    if (tries.length < 3) throw new Error('Workstation is unreachable right now')
    return 'answered\n'
  }
  hub.directory = () => []
  hub.send({ from: 'iris@workstation', to: 'noor', text: 'which branch?', mentions: false, ask: 'c0ffee' })
  pickUp('noor')
  finish('noor', 'release/2.4')
  for (let i = 0; i < 3; i++) (await Promise.resolve(), await Promise.resolve(), mock.timers.tick(12000))
  assert.deepEqual(tries, ['c0ffee', 'c0ffee', 'c0ffee'])
})

test('clique wait never waits on its waiter either', async () => {
  busy('noor')
  busy('theo')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'which build?' })
  mock.timers.tick(ASK_HOLD)
  await asked
  hub.question({ from: 'theo', to: 'noor', text: 'which branch?' }) // allowed: noor stopped waiting
  assert.throws(() => hub.wait({ from: 'noor' }), /@theo is waiting for your answer, so it can't answer you until you answer/)
})

test('one file, one editor: a clique ask that quotes a patch isn\'t an edit; a shell command running apply_patch is', () => {
  busy('noor')
  busy('theo')
  edit('noor', 'src/Board.tsx')
  const patch = '*** Begin Patch\n*** Update File: src/Board.tsx\n@@\n-a\n+b\n*** End Patch'
  assert.equal(hub.lease('theo', { tool_name: 'Bash', tool_input: { command: `clique ask noor "can you apply this?\n${patch}"` } }), '')
  assert.match(denied(hub.lease('theo', { tool_name: 'Bash', tool_input: { command: `apply_patch <<'EOF'\n${patch}\nEOF` } })).permissionDecisionReason, /^Board\.tsx is being edited by @noor/)
})

test('handing back is only turned down while the asker waits on it, or while it\'s being answered', async () => {
  busy('noor')
  dialog('theo')
  const asked = hub.question({ from: 'noor', to: 'theo', text: 'can you take the RTL pass?' })
  mock.timers.tick(ASK_HOLD)
  await asked
  // noor stopped waiting and the question is still in theo's queue: anything theo sends noor is just a message
  agent('theo').status = 'working'
  assert.match(hub.send({ from: 'theo', to: 'noor', text: 'the iOS build is red' }), /noor/)
  assert.equal(rules().length, 0)
})

test('a task back on To do after its owners declined it doesn\'t go back to one of them when you press Start', async () => {
  setup([{ name: 'ada', area: 'mobile client code' }, { name: 'noor', area: 'mobile client code' }, { name: 'eli', area: 'task board' }])
  const t = hub.tickets.add({ title: 'Mobile client crash on launch', by: 'you', owner: 'ada' })
  hub.taskCommand('ada', ['decline', String(t.id), 'not now'])
  hub.taskCommand('noor', ['decline', String(t.id), 'not now either'])
  assert.equal(t.owner, null)
  await assert.rejects(hub.dispatch(t.id), /who should fix #\d+\? Pick an owner first/)
})

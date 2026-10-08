// Right of way: `crew ask` and its answer coming back, who goes first when agents need each other (no waiting in
// circles, no handing work back), the order a queue is taken in, one editor per file, and a declined task finding
// its next owner. Real Hub, fake runner and clock, throwaway CREW_HOME. `npm test`.
import { test as nodeTest, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-right-of-way-'))
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

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-right-of-way-app-'))
let hub, runner
const setup = (agents, extra = {}) => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json', 'tickets.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents, ...extra }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1'
  for (const a of hub.agents.values()) if (!a.off) (runner.live.add(a.name), (a.status = 'idle'))
}
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  setup([
    { name: 'levi', area: 'mobile client code', cwd: DIR },
    { name: 'scarlett', area: 'qa, play tests', cwd: DIR },
    { name: 'estee', area: 'scrum master, task board', cwd: DIR },
    { name: 'gal', area: 'ui design', cwd: DIR, clones: 2 },
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
  fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true })
  fs.rmSync(DIR, { recursive: true, force: true })
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

// ---- crew ask: the answer comes back ----

const MIDTURN = '[question from @levi, who is waiting on your answer. Answer it now with crew answer "…", then carry on with what you were doing]'
// a permission prompt up in its terminal: nothing can be typed into it until you answer
const dialog = (n) => {
  hub.ask(n, { tool_name: 'Bash', tool_input: { command: 'npm test' } })
  return hub.feed.findLast((e) => e.kind === 'ask').id
}

test('a free teammate gets the question as its next prompt, and its final message comes straight back into the asker\'s wait', async () => {
  busy('levi') // mid-turn, running `crew ask` in its shell
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build did you test?' })
  assert.equal(typedInto('scarlett')[0], '[question from @levi, who is waiting on your answer: your final message is the answer, and goes back to @levi by itself] which build did you test?')
  assert.deepEqual(view('levi').waitingOn.map((w) => w.name), ['scarlett'])
  assert.deepEqual(view('scarlett').owes.map((o) => [o.name, o.waiting]), [['levi', true]])
  pickUp('scarlett')
  assert.equal(await peek(asked), 'pending')
  finish('scarlett', 'Build 412, on the iPhone Air sim.')
  assert.equal(await asked, '@scarlett answered:\n\nBuild 412, on the iPhone Air sim.\n')
  // nothing left over: no message queued for levi, the question shows as answered, by the reply
  assert.equal(agent('levi').inbox.length, 0)
  const q = hub.feed.find((e) => e.ask)
  const reply = hub.feed.find((e) => e.kind === 'reply' && e.from === 'scarlett')
  assert.equal(q.answered.by, 'scarlett')
  assert.equal(q.answered.reply, reply.id)
  assert.equal(reply.re, q.id)
  assert.deepEqual(view('levi').waitingOn, [])
  assert.deepEqual(view('scarlett').owes, [])
})

test('a busy teammate gets the question in the turn it\'s in, answers with crew answer and carries on', async () => {
  busy('levi')
  busy('scarlett') // in the middle of a long QA pass
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build did you test?' })
  assert.deepEqual(typedInto('scarlett'), [`${MIDTURN} which build did you test?`], 'typed in now, not at the end of its turn')
  assert.deepEqual(agent('scarlett').inbox, [])
  pickUp('scarlett') // its CLI takes it in at its next step
  assert.equal(agent('scarlett').status, 'working')
  assert.equal(hub.answerNow({ from: 'scarlett', text: 'Build 412.' }), '@levi has your answer.\n')
  assert.equal(await asked, '@scarlett answered:\n\nBuild 412.\n')
  // the answer shows in the chat as scarlett's reply to the question
  const q = hub.feed.find((e) => e.ask)
  const reply = hub.feed.find((e) => e.kind === 'reply' && e.re === q.id)
  assert.equal(reply.text, 'Build 412.')
  assert.equal(q.answered.reply, reply.id)
  // its turn goes on, and its end doesn't answer a second time
  assert.throws(() => hub.answerNow({ from: 'scarlett', text: 'again' }), /No question to answer/)
  finish('scarlett', 'QA pass done: two blockers on #4715.')
  assert.equal(hub.feed.filter((e) => e.answers).length, 0)
  assert.equal(agent('levi').inbox.length, 0)
})

test('...and without crew answer, the final message of its turn is the answer', async () => {
  busy('levi')
  busy('scarlett')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  pickUp('scarlett')
  finish('scarlett', 'QA pass done on build 412.')
  assert.equal(await asked, '@scarlett answered:\n\nQA pass done on build 412.\n')
})

test('crew answer @name picks which question, when several are waiting', async () => {
  busy('scarlett')
  busy('levi')
  busy('estee')
  const fromLevi = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  pickUp('scarlett')
  const fromEstee = hub.question({ from: 'estee', to: 'scarlett', text: 'is #5 verified?' })
  pickUp('scarlett')
  assert.equal(hub.answerNow({ from: 'scarlett', to: '@estee', text: 'Yes, on 402 and 420pt.' }), '@estee has your answer. 1 more question waiting: crew answer @name "…"\n')
  assert.match(await fromEstee, /Yes, on 402/)
  assert.equal(await peek(fromLevi), 'pending')
  assert.throws(() => hub.answerNow({ from: 'scarlett', to: 'gal', text: 'hi' }), /@gal hasn't asked you anything that's still open/)
  hub.answerNow({ from: 'scarlett', text: 'Build 412.' })
  assert.match(await fromLevi, /Build 412/)
})

test('not while a permission prompt is up in its terminal: the question waits first in line, and goes in once you answer it', async () => {
  busy('scarlett')
  hub.send({ from: 'estee', to: 'scarlett', text: 'recorded #5 as passing' })
  const id = dialog('scarlett')
  assert.equal(agent('scarlett').status, 'waiting')
  busy('levi')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'is #4715 good to merge?' })
  assert.deepEqual(agent('scarlett').inbox.map((m) => m.text), ['is #4715 good to merge?', 'recorded #5 as passing'])
  assert.deepEqual(typedInto('scarlett'), [])
  hub.answer(id, { allow: true })
  assert.deepEqual(typedInto('scarlett'), [`${MIDTURN.replace('@levi', '@levi')} is #4715 good to merge?`])
  assert.deepEqual(agent('scarlett').inbox.map((m) => m.text), ['recorded #5 as passing'], 'hand-offs wait for the end of the turn')
  pickUp('scarlett')
  hub.answerNow({ from: 'scarlett', text: 'Not yet.' })
  assert.match(await asked, /Not yet/)
})

test('not while you\'re typing in its terminal: right after', () => {
  busy('scarlett')
  hub.input('scarlett', 'l')
  busy('levi')
  hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  assert.deepEqual(typedInto('scarlett'), [])
  mock.timers.tick(3000)
  assert.deepEqual(typedInto('scarlett'), [`${MIDTURN} which build?`])
})

test('a question its CLI never took in before the turn ended goes back in line, and in as the next prompt', async () => {
  busy('levi')
  busy('scarlett')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  finish('scarlett', 'QA pass done.') // ended before its next step: the question wasn't taken in
  assert.equal(agent('scarlett').steering?.msgs.length, 1)
  mock.timers.tick(5000)
  assert.equal(agent('scarlett').steering, null)
  assert.equal(typedInto('scarlett').at(-1), '[question from @levi, who is waiting on your answer: your final message is the answer, and goes back to @levi by itself] which build?')
  pickUp('scarlett')
  finish('scarlett', 'Build 412.')
  assert.match(await asked, /Build 412/)
})

test('...unless its CLI starts a turn with it by itself (Codex does): then that turn answers it, typed in once', async () => {
  busy('levi')
  busy('scarlett')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  finish('scarlett', 'QA pass done.')
  mock.timers.tick(1000)
  pickUp('scarlett') // the CLI goes on with what was typed, as a turn of its own
  assert.equal(agent('scarlett').status, 'working')
  mock.timers.tick(10000)
  assert.equal(typedInto('scarlett').length, 1, 'not typed again')
  finish('scarlett', 'Build 412.')
  assert.match(await asked, /Build 412/)
})

test('an answer that takes longer comes to the asker anyway: into the turn it\'s in, or as its next prompt', async () => {
  const id = dialog('scarlett')
  busy('levi')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'is #4715 good to merge?' })
  mock.timers.tick(ASK_HOLD)
  const told = await asked
  assert.match(told, /^@scarlett hasn't answered yet \(your question is next, once it finishes what it is doing\)\./)
  assert.match(told, /Don't ask again\. Carry on with other work and the answer comes to you as a message, or wait more with: crew wait/)
  assert.deepEqual(view('levi').waitingOn, [], 'not stuck waiting any more')
  hub.answer(id, { allow: true })
  pickUp('scarlett')
  hub.answerNow({ from: 'scarlett', text: 'Yes, merge it.' })
  // levi is busy with something else: the answer goes into its turn
  assert.equal(typedInto('levi').at(-1), '[answer from @scarlett to your question "is #4715 good to merge?"] Yes, merge it.')
  pickUp('levi')
  assert.deepEqual(agent('levi').inbox, [])
  // free, it gets the next one as its prompt
  finish('levi', 'merged')
  const again = hub.question({ from: 'levi', to: 'estee', text: 'board updated?' })
  mock.timers.tick(ASK_HOLD)
  await again
  finish('levi', 'carrying on')
  pickUp('estee')
  finish('estee', 'Yes.')
  assert.equal(typedInto('levi').at(-1), '[answer from @estee to your question "board updated?"] Yes.')
})

test('a retried question waits on the one already asked instead of asking twice; crew wait waits some more', async () => {
  busy('scarlett')
  busy('levi')
  const first = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  mock.timers.tick(ASK_HOLD)
  await first
  const again = hub.question({ from: 'levi', to: 'scarlett', text: '  which   build? ' })
  assert.equal(hub.feed.filter((e) => e.ask).length, 1)
  mock.timers.tick(ASK_HOLD)
  await again
  const more = hub.wait({ from: 'levi' })
  pickUp('scarlett')
  hub.answerNow({ from: 'scarlett', text: 'Build 412.' })
  assert.match(await more, /Build 412/)
})

test('crew wait with nothing asked says so', () => {
  assert.equal(hub.wait({ from: 'levi' }), 'Nothing to wait for: every question you asked has been answered.\n')
})

// ---- who goes first: no waiting in circles ----

test('whoever is being waited on never waits on its waiter: that ask is turned down on the spot', async () => {
  busy('levi')
  busy('scarlett')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build did you test?' })
  pickUp('scarlett')
  await assert.rejects(hub.question({ from: 'scarlett', to: 'levi', text: 'which build should I test?' }),
    /^Error: @levi is waiting for your answer, so it can't answer you until you answer\. Don't wait on it: finish with what you know, say what you couldn't check, and your answer unblocks it\.$/)
  assert.deepEqual(agent('levi').inbox, [], 'nothing queued for levi')
  assert.deepEqual(typedInto('levi'), [], 'nor typed in')
  assert.deepEqual(rules().map((r) => [r.rule, r.from, r.to, r.line]), [['loop', 'scarlett', 'levi', ['levi', 'scarlett']]])
  // scarlett answers with what it has, and levi goes on
  hub.answerNow({ from: 'scarlett', text: 'Build 412 (I could not tell which one you meant).' })
  assert.match(await asked, /Build 412/)
})

test('...down a line of teammates too', async () => {
  for (const n of ['levi', 'scarlett', 'estee']) busy(n)
  hub.question({ from: 'levi', to: 'scarlett', text: 'is it merged?' })
  hub.question({ from: 'scarlett', to: 'estee', text: 'what does the board say?' })
  await assert.rejects(hub.question({ from: 'estee', to: 'levi', text: 'did you push?' }), /^Error: @levi is waiting on @scarlett, which is waiting for your answer, so it can't answer you/)
  assert.deepEqual(rules().at(-1).line, ['levi', 'scarlett', 'estee'])
})

test('an asker that stopped waiting can be asked: it is free to answer', async () => {
  busy('levi')
  busy('scarlett')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  mock.timers.tick(ASK_HOLD)
  await asked
  const back = hub.question({ from: 'scarlett', to: 'levi', text: 'which branch?' })
  assert.equal(await peek(back), 'pending')
  assert.equal(rules().length, 0)
})

test('work can\'t be handed back to a teammate waiting on your answer: the answer goes back by itself', async () => {
  busy('levi')
  busy('scarlett')
  hub.question({ from: 'levi', to: 'scarlett', text: 'can you take the RTL pass?' })
  assert.throws(() => hub.send({ from: 'scarlett', to: 'levi', text: 'this is your area, you do it' }),
    /^Error: @levi is waiting for your answer to "can you take the RTL pass\?"\. Don't hand it back: put what you'd send it in your answer\. Your final message goes back to @levi by itself\.$/)
  assert.deepEqual(rules().map((r) => [r.rule, r.from, r.to]), [['back', 'scarlett', 'levi']])
  // anyone else still can
  assert.match(hub.send({ from: 'scarlett', to: 'estee', text: 'FYI levi asked for an RTL pass' }), /queued for @estee|sent to @estee/)
})

test('a question asked while answering one keeps that one open until its answer is in', async () => {
  for (const n of ['levi', 'estee']) busy(n)
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'is #2 ready?', hold: 3 * ASK_HOLD })
  pickUp('scarlett')
  // scarlett needs the board's view first; estee has a dialog up, so scarlett stops waiting and ends its turn
  const id = dialog('estee')
  const sub = hub.question({ from: 'scarlett', to: 'estee', text: 'what does the board say about #2?' })
  mock.timers.tick(ASK_HOLD)
  await sub
  assert.equal(await peek(asked), 'pending')
  finish('scarlett', 'Asked estee, waiting on the board.')
  assert.equal(await peek(asked), 'pending', 'progress, not the answer')
  // estee answers; scarlett takes that up and finishes: that is levi's answer
  hub.answer(id, { allow: true })
  pickUp('estee')
  hub.answerNow({ from: 'estee', text: '#2 is in review.' })
  assert.match(typedInto('scarlett').at(-1), /^\[answer from @estee to your question "what does the board say about #2\?"\] #2 is in review\./)
  pickUp('scarlett')
  finish('scarlett', 'Not ready: #2 is still in review.')
  assert.equal(await asked, '@scarlett answered:\n\nNot ready: #2 is still in review.\n')
})

test('an asker always hears back: interrupted, exited or turned off, it says so', async () => {
  busy('levi')
  const one = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  pickUp('scarlett')
  hub.onHook('scarlett', { hook_event_name: 'Interrupt' })
  assert.equal(await one, '@scarlett answered:\n\n(@scarlett stopped before it answered.)\n')
  // typed into its turn but not taken in yet, when you turn it off: told now, rather than waiting for it to come back
  busy('scarlett')
  const two = hub.question({ from: 'levi', to: 'scarlett', text: 'and the branch?' })
  assert.ok(agent('scarlett').steering)
  hub.update('scarlett', { off: true })
  assert.equal(await two, "@scarlett answered:\n\n(@scarlett was turned off, so it can't answer.)\n")
  await assert.rejects(hub.question({ from: 'levi', to: 'scarlett', text: 'hello?' }), /@scarlett is turned off/)
})

test('an answer for a clone goes to that clone, not to whichever of its family is free', async () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'build the card' })
  hub.onHook('gal.2', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(2000)
  pickUp('gal.2')
  const id = dialog('scarlett')
  const asked = hub.question({ from: 'gal.2', to: 'scarlett', text: 'which sizes do you test?' })
  mock.timers.tick(ASK_HOLD)
  await asked
  finish('gal.2', 'Built it for the sizes I know.')
  agent('gal').status = 'idle'
  busy('gal.2')
  hub.answer(id, { allow: true })
  pickUp('scarlett')
  hub.answerNow({ from: 'scarlett', text: '402 and 420pt.' })
  assert.match(typedInto('gal.2').at(-1), /^\[answer from @scarlett to your question "which sizes do you test\?"\] 402 and 420pt\.$/)
  assert.deepEqual(typedInto('gal').filter((t) => /402/.test(t)), [])
})

// ---- the queue: answers first, then questions, hand-offs together ----

test('hand-offs that piled up go in together, in one turn, and the reply threads to all of them', () => {
  busy('levi')
  hub.send({ from: 'estee', to: 'levi', text: 'triaged #9 to you' })
  hub.send({ from: 'scarlett', to: 'levi', text: 'QA found two blockers on #4715' })
  hub.send({ from: 'estee', to: 'levi', text: 'recorded the blockers on #2' })
  finish('levi')
  const prompt = typedInto('levi').at(-1)
  assert.equal(typedInto('levi').length, 1, 'one prompt for all three')
  assert.equal(prompt, [
    '[3 hand-offs came in while you were busy, oldest first. Take them together, in this one turn.]',
    "[from @estee: it's yours now, no need to report back] triaged #9 to you",
    "[from @scarlett: it's yours now, no need to report back] QA found two blockers on #4715",
    "[from @estee: it's yours now, no need to report back] recorded the blockers on #2",
  ].join('\n\n'))
  pickUp('levi')
  finish('levi', 'Fixed both blockers in #4747.')
  const msgs = hub.feed.filter((e) => e.kind === 'msg' && e.to === 'levi')
  const reply = hub.feed.findLast((e) => e.kind === 'reply')
  assert.equal(reply.re, msgs[0].id)
  assert.deepEqual(reply.also, [msgs[1].id, msgs[2].id])
  assert.equal(hub.stats.levi.delivered, 3)
})

test('your messages, questions and tasks each still get a turn of their own', () => {
  busy('levi')
  hub.send({ to: 'levi', text: 'resolve the conflicts on #4715' })
  hub.send({ to: 'levi', text: 'then push it' })
  finish('levi')
  assert.deepEqual(typedInto('levi'), ['resolve the conflicts on #4715'])
})

// ---- one file, one editor ----

const edit = (n, file) => hub.lease(n, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(DIR, file), old_string: 'a', new_string: 'b' } })
const denied = (out) => (out ? JSON.parse(out).hookSpecificOutput : null)

test('the first agent to edit a file holds it until its turn ends; anyone else is turned away, told who has it', () => {
  busy('levi')
  busy('scarlett')
  assert.equal(edit('levi', 'src/Board.tsx'), '')
  assert.equal(edit('levi', 'src/Board.tsx'), '', 'its own again')
  const no = denied(edit('scarlett', 'src/Board.tsx'))
  assert.equal(no.hookEventName, 'PreToolUse')
  assert.equal(no.permissionDecision, 'deny')
  assert.equal(no.permissionDecisionReason, 'Board.tsx is being edited by @levi right now, and Crew lets one agent edit a file at a time. Leave it to @levi and do the rest of your work: the file is free again once @levi finishes its turn. If you need a change in it, crew ask levi.')
  assert.equal(edit('scarlett', 'src/Other.tsx'), '', 'other files are fine')
  denied(edit('scarlett', 'src/Board.tsx'))
  assert.deepEqual(rules().map((r) => [r.rule, r.from, r.to, r.file]), [['file', 'scarlett', 'levi', 'Board.tsx']], 'said once')
  finish('levi', 'done')
  assert.equal(edit('scarlett', 'src/Board.tsx'), '', 'free once its turn is over')
})

test('an agent and its clone never write over each other', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'the footer' })
  hub.onHook('gal.2', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(2000)
  pickUp('gal.2')
  assert.equal(edit('gal', 'src/Footer.tsx'), '')
  assert.equal(denied(edit('gal.2', 'src/Footer.tsx')).permissionDecision, 'deny')
})

test('Codex\'s apply_patch is checked by the files in its patch', () => {
  busy('levi')
  busy('scarlett')
  edit('levi', 'src/Board.tsx')
  const patch = '*** Begin Patch\n*** Update File: src/Theme.ts\n@@\n-a\n+b\n*** Update File: src/Board.tsx\n@@\n-a\n+b\n*** End Patch\n'
  const out = hub.lease('scarlett', { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: patch } })
  assert.match(denied(out).permissionDecisionReason, /^Board\.tsx is being edited by @levi/)
  assert.equal(hub.lease('scarlett', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }), '', 'other tools pass')
})

test('an agent answering the holder\'s question may edit its files: the holder is waiting on it, not editing', () => {
  busy('levi')
  busy('scarlett')
  edit('levi', 'src/Board.tsx')
  hub.question({ from: 'levi', to: 'scarlett', text: 'fix the hold offset in Board.tsx while I wait?' })
  assert.equal(edit('scarlett', 'src/Board.tsx'), '')
  busy('estee')
  assert.equal(denied(edit('estee', 'src/Board.tsx')).permissionDecision, 'deny', "estee isn't answering levi: still levi's")
})

// ---- a declined task finds its next owner ----

test('a declined task goes straight to the next agent whose area it is, and on to it if it was under way', async () => {
  setup([{ name: 'david', area: 'mobile client code, layouts' }, { name: 'levi', area: 'mobile client code, alignment' }, { name: 'estee', area: 'task board' }])
  const t = hub.tickets.add({ title: 'Dock footer alignment in the mobile client', by: 'you', owner: 'david' })
  await hub.dispatch(t.id)
  assert.equal(t.status, 'fixing')
  assert.equal(hub.taskCommand('david', ['decline', String(t.id), 'this session is limited to bug #3']), `#${t.id} went to @levi, who starts on it now\n`)
  assert.equal(t.owner, 'levi')
  assert.deepEqual(t.declined, ['david'])
  await Promise.resolve()
  assert.equal(t.status, 'fixing')
  assert.equal(t.fixer, 'levi')
  assert.match(typedInto('levi').at(-1) ?? hub.agents.get('levi').inbox.at(-1).text, /Dock footer alignment/)
  assert.deepEqual(rules().map((r) => [r.rule, r.from, r.to, r.ticket]), [['decline', 'david', 'levi', t.id]])
  // levi can't take it either, and no one else's area fits: back to you
  const notices = []
  hub.on('notice', (n) => notices.push(n))
  assert.equal(hub.taskCommand('levi', ['decline', String(t.id), 'out of my depth']), `#${t.id} is back on To do, for the user to give to someone\n`)
  assert.equal(t.owner, null)
  assert.equal(t.status, 'new')
  assert.equal(notices[0].title, `#${t.id} needs an owner`)
  assert.throws(() => hub.taskCommand('estee', ['decline', String(t.id), 'not mine']), /only its owner can decline it/)
})

// ---- across computers ----

test('a question for an agent on a linked computer is waited on here, and answered from there', async () => {
  const relayed = []
  hub.relay = async (from, names, text, images, extra) => (relayed.push({ from, names, text, extra }), 'asked @gal\n')
  hub.directory = () => [{ name: 'gal@mini', seed: 'gal', on: true, status: 'working', waitingOn: [] }]
  busy('levi')
  const asked = hub.question({ from: 'levi', to: 'gal@mini', text: 'which palette?' })
  await Promise.resolve()
  assert.deepEqual(relayed.map((r) => [r.from, r.names, r.text]), [['levi', ['gal@mini'], 'which palette?']])
  assert.deepEqual(view('levi').waitingOn.map((w) => w.name), ['gal@mini'])
  // the answer arrives over Crew Link
  assert.equal(hub.send({ from: 'gal@mini', to: 'levi', text: 'Pastel, from the brand guide.', mentions: false, answers: relayed[0].extra.ask }), 'answered\n')
  assert.equal(await asked, '@gal@mini answered:\n\nPastel, from the brand guide.\n')
})

test('...and one from a linked computer is answered there: the answer goes back with its id', async () => {
  const relayed = []
  hub.relay = async (from, names, text, images, extra) => relayed.push({ from, names, text, extra })
  hub.directory = () => []
  assert.equal(hub.send({ from: 'gal@mini', to: 'levi', text: 'which branch?', mentions: false, ask: 'c0ffee' }), 'asked @levi\n')
  pickUp('levi')
  finish('levi', 'release/2.4')
  assert.deepEqual(relayed, [{ from: 'levi', names: ['gal@mini'], text: 'release/2.4', extra: { answers: 'c0ffee' } }])
})

test('a loop across computers is caught too, from what the other computer reports', async () => {
  hub.relay = async () => 'asked @gal\n'
  hub.directory = () => [{ name: 'gal@mini', seed: 'gal', on: true, status: 'working', waitingOn: [{ name: 'levi' }] }]
  await assert.rejects(hub.question({ from: 'levi', to: 'gal@mini', text: 'which palette?' }), /@gal@mini is waiting for your answer/)
})

// ---- whoever goes away, its askers hear so (and other edges) ----

test('an agent that moves to another computer: its askers here hear so, and its queue travels without their questions', async () => {
  busy('levi')
  dialog('scarlett') // it can't take anything in right now: the question waits in its queue
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  hub.send({ from: 'estee', to: 'scarlett', text: 'recorded #5' })
  const out = await moveOut(hub, 'scarlett')
  assert.deepEqual(out.inbox.map((m) => m.text), ['recorded #5'])
  moveEnd(hub, out.token, { to: 'air', name: 'scarlett' })
  assert.equal(await asked, '@scarlett answered:\n\n(@scarlett moved to another computer before it answered: ask @scarlett@air again.)\n')
  assert.equal(hub.calls.size, 0)
})

test('an agent removed (or renamed) in config.json: its askers hear so', async () => {
  busy('levi')
  dialog('scarlett')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  hub.removeAgent('scarlett')
  assert.equal(await asked, '@scarlett answered:\n\n(@scarlett went away before it answered.)\n')
})

test('an agent turned off with its clones: a question a clone had is answered, not left in the off agent\'s queue', async () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'the footer' })
  hub.onHook('gal.2', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(2000)
  pickUp('gal.2')
  busy('levi')
  const asked = hub.question({ from: 'levi', to: 'gal.2', text: 'which sizes?' })
  assert.ok(agent('gal.2').steering, 'typed into its turn, not taken in yet')
  hub.update('gal', { off: true })
  assert.match(await asked, /^@gal(\.2)? answered:\n\n\(@gal(\.2)? (was turned off, so it can't answer|went away before it answered)\.\)\n$/)
  assert.deepEqual(agent('gal').inbox.filter((m) => m.ask), [])
})

test('a question put aside while its owner asks a teammate: answered when the owner is turned off', async () => {
  busy('levi')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'is #2 ready?', hold: 3 * ASK_HOLD })
  pickUp('scarlett')
  dialog('estee')
  const sub = hub.question({ from: 'scarlett', to: 'estee', text: 'what does the board say?' })
  mock.timers.tick(ASK_HOLD)
  await sub
  finish('scarlett', 'Asked estee.')
  hub.update('scarlett', { off: true })
  assert.equal(await asked, "@scarlett answered:\n\n(@scarlett was turned off, so it can't answer.)\n")
})

test('the Enter Crew presses again for a question it typed mid-turn never sends what you\'re typing there', () => {
  busy('levi')
  busy('scarlett')
  hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  mock.timers.tick(1000)
  hub.input('scarlett', 'p')
  mock.timers.tick(15000)
  assert.deepEqual(runner.writes.filter((w) => w.name === 'scarlett').map((w) => w.data), ['p'])
})

test('a fresh start right after a turn: what was typed mid-turn goes in as the new conversation\'s first prompt', () => {
  busy('levi')
  busy('scarlett')
  hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  hub.freshStart('scarlett')
  finish('scarlett', 'done')
  assert.equal(agent('scarlett').steering, null)
  assert.deepEqual(agent('scarlett').inbox.map((m) => m.text), ['which build?'])
  assert.equal(agent('scarlett').status, 'starting')
})

test('an answer for another computer is tried again while that computer can\'t be reached', async () => {
  const tries = []
  hub.relay = async (from, names, text, images, extra) => {
    tries.push(extra.answers)
    if (tries.length < 3) throw new Error('Mac mini is unreachable right now')
    return 'answered\n'
  }
  hub.directory = () => []
  hub.send({ from: 'gal@mini', to: 'levi', text: 'which branch?', mentions: false, ask: 'c0ffee' })
  pickUp('levi')
  finish('levi', 'release/2.4')
  for (let i = 0; i < 3; i++) (await Promise.resolve(), await Promise.resolve(), mock.timers.tick(12000))
  assert.deepEqual(tries, ['c0ffee', 'c0ffee', 'c0ffee'])
})

test('crew wait never waits on its waiter either', async () => {
  busy('levi')
  busy('scarlett')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'which build?' })
  mock.timers.tick(ASK_HOLD)
  await asked
  hub.question({ from: 'scarlett', to: 'levi', text: 'which branch?' }) // allowed: levi stopped waiting
  assert.throws(() => hub.wait({ from: 'levi' }), /@scarlett is waiting for your answer, so it can't answer you until you answer/)
})

test('one file, one editor: a crew ask that quotes a patch isn\'t an edit; a shell command running apply_patch is', () => {
  busy('levi')
  busy('scarlett')
  edit('levi', 'src/Board.tsx')
  const patch = '*** Begin Patch\n*** Update File: src/Board.tsx\n@@\n-a\n+b\n*** End Patch'
  assert.equal(hub.lease('scarlett', { tool_name: 'Bash', tool_input: { command: `crew ask levi "can you apply this?\n${patch}"` } }), '')
  assert.match(denied(hub.lease('scarlett', { tool_name: 'Bash', tool_input: { command: `apply_patch <<'EOF'\n${patch}\nEOF` } })).permissionDecisionReason, /^Board\.tsx is being edited by @levi/)
})

test('handing back is only turned down while the asker waits on it, or while it\'s being answered', async () => {
  busy('levi')
  dialog('scarlett')
  const asked = hub.question({ from: 'levi', to: 'scarlett', text: 'can you take the RTL pass?' })
  mock.timers.tick(ASK_HOLD)
  await asked
  // levi stopped waiting and the question is still in scarlett's queue: anything scarlett sends levi is just a message
  agent('scarlett').status = 'working'
  assert.match(hub.send({ from: 'scarlett', to: 'levi', text: 'the iOS build is red' }), /levi/)
  assert.equal(rules().length, 0)
})

test('a task back on To do after its owners declined it doesn\'t go back to one of them when you press Start', async () => {
  setup([{ name: 'david', area: 'mobile client code' }, { name: 'levi', area: 'mobile client code' }, { name: 'estee', area: 'task board' }])
  const t = hub.tickets.add({ title: 'Mobile client crash on launch', by: 'you', owner: 'david' })
  hub.taskCommand('david', ['decline', String(t.id), 'not now'])
  hub.taskCommand('levi', ['decline', String(t.id), 'not now either'])
  assert.equal(t.owner, null)
  await assert.rejects(hub.dispatch(t.id), /who should fix #\d+\? Pick an owner first/)
})

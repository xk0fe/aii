// Threads: what agents say to each other stays out of the channel, the agent you asked answers you there, and a thread
// that goes quiet gets its last word. Real Hub, fake runner, throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-threads-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { Crew } = await import('../core/crew.js')
const { gistOf, inThread, forClients, stampAll } = await import('../core/threads.js')
const { keepFeed } = await import('../core/keep.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
  quietFor = () => Infinity
}

let hub, runner
const done = () => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.readsTimer)
  clearTimeout(hub.convoTimer)
  clearInterval(hub.stallTimer)
  return hub.saving
}
const fresh = (config = {}) => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'reads.json', 'runtime.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'jeff', area: 'lead' }, { name: 'joseph', area: 'backend' }, { name: 'david', area: 'frontend' }], ...config }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
}
beforeEach(() => fresh())
afterEach(() => done())
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

// the agent takes what it was last given, does `then` in that turn, and finishes saying `text`
const turn = (name, text, then = () => {}) => {
  hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.filter((t) => t.n === name).at(-1).text })
  then()
  hub.onHook(name, { hook_event_name: 'Stop', last_assistant_message: text })
  hub.agents.get(name).holdUntil = 0
  return hub.feed.findLast((e) => e.kind === 'reply' && e.from === name)
}
const ask = (text = 'fix the tables', to = 'jeff') => {
  hub.send({ to, text })
  return hub.feed.at(-1)
}
const quiet = (ms = 60000) => hub.threadTick(hub.feed.at(-1).ts + ms)
const channel = () => hub.feed.filter((e) => !inThread(e))

test("the agent you asked answers in the channel; what it hands on, and what comes back, stay in the thread", () => {
  const root = ask()
  const reply = turn('jeff', 'Joseph has it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  const handoff = hub.feed.find((e) => e.kind === 'msg' && e.from === 'jeff')
  const back = turn('joseph', 'Tables fixed, 14 of 14 pass.')
  assert.equal(handoff.thread, root.id)
  assert.equal(inThread(handoff), true)
  assert.equal(reply.thread, root.id)
  assert.equal(inThread(reply), false, 'a reply to you shows in the channel')
  assert.equal(back.thread, root.id)
  assert.equal(inThread(back), true, "a reply to a teammate doesn't")
  assert.deepEqual(channel().map((e) => e.id), [root.id, reply.id])
})

test('a message nothing led to has no thread: it is the channel, and what follows it hangs off it', () => {
  const posted = hub.post({ kind: 'reply', from: 'joseph', text: 'Deploy finished.' })
  assert.equal(posted.thread, undefined)
  assert.equal(inThread(posted), false)
})

test('a teammate hand-off nobody answers stays one row; the next line makes it a thread under it', () => {
  const first = hub.post({ kind: 'msg', from: 'david', to: 'joseph', text: 'FYI the API moved.' })
  assert.equal(inThread(first), false, 'the root is in the channel')
  const next = hub.post({ kind: 'msg', from: 'joseph', to: 'david', text: 'Noted, updating.', re: first.id })
  assert.equal(next.thread, first.id)
  assert.equal(inThread(next), true)
})

test('your question cards and hand-offs waiting for your OK stay in the channel, even from inside a thread', async () => {
  await done()
  fresh({ autopilot: false })
  const root = ask()
  const jeff = hub.agents.get('jeff')
  hub.onHook('jeff', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1).text })
  hub.send({ from: 'jeff', to: 'joseph', text: 'Take the tables.' })
  const held = hub.feed.at(-1)
  assert.equal(held.held, true)
  assert.equal(held.thread, root.id)
  assert.equal(inThread(held), false)
  assert.equal(jeff.current, root.id)
  const card = hub.post({ kind: 'ask', from: 'jeff', to: 'you', ask: { type: 'question', questions: [] }, re: jeff.current })
  assert.equal(card.thread, root.id)
  assert.equal(inThread(card), false)
})

test("a reply that only repeats the hand-off it just sent is an echo of it; an answer to a teammate's question isn't", () => {
  ask()
  turn('jeff', 'Joseph has it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  const told = turn('joseph', "I've told David about the composer.", () => hub.send({ from: 'joseph', to: 'david', text: 'The composer needs the new recipients.' }))
  const sent = hub.feed.findLast((e) => e.kind === 'msg' && e.from === 'joseph')
  assert.equal(told.echo, sent.id)
  const said = hub.post({ kind: 'msg', from: 'david', to: 'joseph', text: 'Which recipients?', ask: true, re: sent.id })
  const answer = hub.post({ kind: 'reply', from: 'joseph', text: 'All of them.', re: said.id })
  assert.equal(answer.echo, undefined)
})

test('a note written during a threaded turn joins that thread; one written between turns is the channel', () => {
  const root = ask()
  hub.onHook('jeff', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1).text })
  hub.note('jeff', 'Tables use the new parser.')
  const note = hub.feed.findLast((e) => e.kind === 'note')
  assert.equal(note.thread, root.id)
  assert.equal(inThread(note), true)
  hub.onHook('jeff', { hook_event_name: 'Stop', last_assistant_message: 'done' })
  hub.note('jeff', 'A later note.')
  assert.equal(hub.feed.findLast((e) => e.kind === 'note').thread, undefined)
})

test("what you say in a thread's reply box stays there, and so does the answer", () => {
  const root = ask()
  turn('jeff', 'Joseph has it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  hub.agents.get('jeff').holdUntil = 0
  hub.send({ to: 'jeff', text: 'use the new parser', re: root.id, thread: root.id })
  const mine = hub.feed.at(-1)
  assert.equal(mine.thread, root.id)
  assert.equal(inThread(mine), true)
  const reply = turn('jeff', 'Will do.')
  assert.equal(reply.thread, root.id)
  assert.equal(reply.re, mine.id)
  assert.equal(inThread(reply), true)
})

test('a reply in the channel to a line brought out keeps its thread, and the answer shows in the channel', () => {
  const root = ask()
  const reply = turn('jeff', 'Joseph has it.')
  hub.send({ to: 'jeff', text: 'thanks', re: reply.id })
  const mine = hub.feed.at(-1)
  assert.equal(mine.thread, root.id)
  assert.equal(inThread(mine), false)
  assert.equal(inThread(turn('jeff', 'Anytime.')), false)
})

test('a thread that goes quiet with the agent you asked speaking last brings that line out, and asks nothing', () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  const joseph = turn('joseph', 'Fixed.')
  // Joseph finished: Jeff hears it, and says where things stand, to Joseph's message: not a reply to you
  hub.post({ kind: 'msg', from: 'joseph', to: 'jeff', text: 'Tables done.', re: joseph.id, ts: Date.now() - 1000 })
  hub.agents.get('jeff').turnBegan = Date.now() + 5
  const last = hub.post({ kind: 'reply', from: 'jeff', text: 'The tables are done.', re: hub.feed.at(-1).id, ts: Date.now() + 6 })
  assert.equal(inThread(last), true)
  const typed = runner.typed.length
  quiet()
  assert.equal(inThread(last), false)
  assert.equal(runner.typed.length, typed, 'nobody is asked for anything')
})

test('a thread that goes quiet with a teammate speaking last asks the agent you asked for one line, a reply to you', () => {
  const root = ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  turn('joseph', 'Fixed, nothing committed.')
  quiet()
  const prompt = runner.typed.at(-1)
  assert.equal(prompt.n, 'jeff')
  assert.match(prompt.text, /gone quiet/)
  const closing = turn('jeff', 'Tables are fixed, not committed yet.')
  assert.equal(closing.re, root.id)
  assert.equal(closing.thread, root.id)
  assert.equal(inThread(closing), false)
  const typed = runner.typed.length
  quiet()
  assert.equal(runner.typed.length, typed, 'its line was the last word: nothing more to ask')
})

test('"nothing new" adds no line: what the agent you asked last said comes out instead', () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  const joseph = turn('joseph', 'Fixed.')
  const report = hub.post({ kind: 'reply', from: 'jeff', text: 'Tables are done.', re: joseph.id })
  hub.post({ kind: 'reply', from: 'david', text: 'Already covered.', re: report.id })
  quiet()
  const rows = hub.feed.length
  turn('jeff', 'Nothing new.')
  assert.equal(hub.feed.length, rows)
  assert.equal(inThread(report), false)
  assert.equal(hub.agents.get('jeff').status, 'idle')
})

test('nobody is asked while the thread is still going: someone working, a message queued, a question open', () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  hub.onHook('joseph', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1).text })
  const typed = runner.typed.length
  quiet()
  assert.equal(runner.typed.length, typed, 'joseph is working on it')
  hub.onHook('joseph', { hook_event_name: 'Stop', last_assistant_message: 'Fixed.' })
  hub.agents.get('joseph').holdUntil = 0
  const david = hub.agents.get('david')
  david.status = 'working' // busy with something else: the message waits for it
  hub.send({ from: 'joseph', to: 'david', text: 'Check it?', re: hub.feed.at(-1).id })
  quiet()
  assert.ok(david.inbox.length, 'still queued')
  assert.equal(runner.typed.filter((t) => /gone quiet/.test(t.text)).length, 0)
  david.status = 'idle'
})

test("asked once, it isn't asked again right away however much more gets said", () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  turn('joseph', 'Fixed.')
  quiet()
  const closing = turn('jeff', 'Fixed.')
  hub.post({ kind: 'reply', from: 'david', text: 'Late note.', re: hub.feed.find((e) => e.from === 'joseph' && e.kind === 'reply').id })
  quiet()
  assert.equal(runner.typed.filter((t) => /gone quiet/.test(t.text)).length, 1)
  assert.equal(inThread(closing), false)
})

test('a thread agents started on their own asks nobody for anything', () => {
  const first = hub.post({ kind: 'msg', from: 'david', to: 'joseph', text: 'FYI the API moved.' })
  hub.post({ kind: 'reply', from: 'joseph', text: 'Thanks, updating.', re: first.id })
  const typed = runner.typed.length
  quiet()
  assert.equal(runner.typed.length, typed)
  assert.equal(hub.openThreads.size, 0)
})

test('an agent that is off, or a workspace put to sleep, gets no prompt: its last line comes out', () => {
  ask()
  const own = turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  const later = hub.post({ kind: 'reply', from: 'jeff', text: 'Joseph is close.', re: own.id })
  turn('joseph', 'Fixed.')
  hub.agents.get('jeff').off = true
  const typed = runner.typed.length
  quiet()
  assert.equal(runner.typed.length, typed)
  assert.equal(inThread(later), true, 'its old word is out of date')
  assert.equal(inThread(hub.feed.find((e) => e.text === 'Fixed.')), false, "the thread's last report comes out")
})

test("a question at the end of a teammate's reply comes out if nobody takes it up", () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  const asked = turn('joseph', 'Nothing has changed yet. Should I go ahead?')
  hub.threadTick(asked.ts + 10000)
  assert.equal(inThread(asked), true, 'the team gets a moment to sort it out')
  hub.threadTick(asked.ts + 90000)
  assert.equal(inThread(asked), false)
  assert.equal(asked.asks, true)
  assert.equal(runner.typed.filter((t) => /gone quiet/.test(t.text)).length, 0, "it's waiting on you: no closing line over it")
})

test('a question a teammate takes up stays in the thread', () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  const taken = turn('joseph', 'Should I go ahead?')
  hub.send({ from: 'jeff', to: 'joseph', text: 'Yes, go ahead.', re: taken.id })
  hub.threadTick(taken.ts + 90000)
  assert.equal(inThread(taken), true)
})

test('what you already read in a thread you joined stays there: no closing line and nothing brought out', () => {
  const root = ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the tables.' }))
  turn('joseph', 'Fixed.')
  hub.send({ to: 'joseph', text: 'and the docs?', re: root.id, thread: root.id })
  const reply = turn('joseph', 'Docs too.')
  const typed = runner.typed.length
  quiet()
  assert.equal(runner.typed.length, typed)
  assert.equal(inThread(reply), true)
})

test('the channel and the threads each get their own window in what clients see', () => {
  const root = ask()
  for (let i = 0; i < 300; i++) hub.post({ kind: 'msg', from: 'joseph', to: 'david', text: `row ${i}`, re: root.id })
  for (let i = 0; i < 50; i++) hub.post({ kind: 'reply', from: 'david', text: `said ${i}` })
  const { feed } = hub.snapshot()
  assert.equal(feed.filter((e) => !inThread(e)).length, 51, 'every channel line, your message included')
  assert.equal(feed.filter(inThread).length, 200)
  assert.equal(feed.some((e) => e.id === root.id), true, 'older than the last 200 lines, and still there')
  assert.deepEqual(feed.map((e) => e.ts), [...feed.map((e) => e.ts)].sort((a, b) => a - b))
})

test('with no threads, clients get what they always did: the last 200 lines', () => {
  const feed = Array.from({ length: 250 }, (_, i) => ({ id: String(i), kind: 'reply', from: 'jeff', text: 'x', ts: i }))
  assert.deepEqual(forClients(feed), feed.slice(-200))
  assert.deepEqual(keepFeed(feed), feed)
})

test('what is kept counts the channel and the threads apart, with no gaps in the channel', () => {
  const lines = []
  for (let i = 0; i < 400; i++) lines.push({ id: `c${i}`, kind: 'reply', from: 'jeff', text: 'x' })
  for (let i = 0; i < 800; i++) lines.push({ id: `t${i}`, kind: 'msg', from: 'joseph', thread: 'c0', text: 'x' })
  const kept = keepFeed(lines)
  assert.equal(kept.filter((e) => !inThread(e)).length, 300)
  assert.equal(kept.filter(inThread).length, 600)
  assert.equal(kept.find((e) => !inThread(e)).id, 'c100')
})

test('lines from before threads are stamped when read back; the agent you asked keeps its last word in the channel', async () => {
  await done()
  const old = [
    { id: 'a', kind: 'msg', from: 'you', to: 'jeff', text: 'fix it' },
    { id: 'b', kind: 'msg', from: 'jeff', to: 'joseph', text: 'Fix it.', re: 'a' },
    { id: 'c', kind: 'reply', from: 'jeff', text: 'Joseph has it.', re: 'a' },
    { id: 'd', kind: 'reply', from: 'joseph', text: 'Done.', re: 'b' },
    { id: 'e', kind: 'reply', from: 'jeff', text: 'All done.', re: 'd' },
    { id: 'f', kind: 'reply', from: 'david', text: 'Nothing to do.', re: 'e' },
    { id: 'g', kind: 'event', from: 'jeff', text: 'exited' },
  ]
  fs.writeFileSync(path.join(process.env.CREW_HOME, 'feed.jsonl'), old.map((e) => JSON.stringify({ ...e, ts: 1 })).join('\n') + '\n')
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  const shown = hub.feed.filter((e) => !inThread(e)).map((e) => e.id)
  assert.deepEqual(shown, ['a', 'c', 'e', 'f', 'g'], "the agent you asked, and the thread's last report")
  assert.equal(hub.feed.find((e) => e.id === 'd').thread, 'a')
  assert.equal(hub.openThreads.size, 0, 'old threads are over: nobody is asked anything after a restart')
})

test('stamps that were saved are not worked out again', () => {
  const lines = [
    { id: 'a', kind: 'msg', from: 'you', to: 'jeff', text: 'x' },
    { id: 'b', kind: 'reply', from: 'jeff', text: 'Hidden on purpose.', re: 'a', thread: 'a' },
  ]
  stampAll(lines)
  assert.equal(lines[1].out, undefined)
})

test('a thread line is told by its first sentence, in the words its agent used', () => {
  assert.equal(gistOf('Markdown tables done in /Users/k0fe/Downloads/aii, uncommitted on main.\n\nCHANGED FILES: …'), 'Markdown tables done in aii, uncommitted on main.')
  assert.equal(gistOf('joseph: ack. I have not changed any code yet. More here.', 'joseph'), "ack. I have not changed any code yet.")
  assert.equal(gistOf('**FINAL:** grouping fixed. Details follow.'), 'FINAL: grouping fixed.')
  assert.equal(gistOf('```js\ncode\n```\nThe fix works.'), 'code')
  assert.equal(gistOf('| a | b |\n|---|---|\nDone with the table.'), 'Done with the table.')
  assert.equal(gistOf('- first point is here\n- second'), 'first point is here')
  assert.equal(gistOf('See [the PR](https://x.y/z) for it.'), 'See the PR for it.')
  assert.equal(gistOf(''), '')
  const long = gistOf(`${'word '.repeat(100)}end.`)
  assert.ok(long.length <= 241)
  assert.ok(long.endsWith('…'))
})

// ---- what a closer look at the closing line found --------------------------------------------------------------------
const prompts = () => runner.typed.filter((t) => /gone quiet/.test(t.text))

test('asked for a closing line, it is told what was said since its last message, each last report whole', () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Run the migration.' }))
  turn('joseph', 'Migration 42 FAILED: the column already exists.\n\nI stopped there.')
  quiet()
  const { text } = prompts()[0]
  assert.match(text, /Migration 42 FAILED/)
  assert.match(text, /I stopped there/)
  assert.doesNotMatch(text, /Run the migration/, 'what it said itself, before its last message, it knows')
})

test("a closing prompt is no message of yours: a restart can't turn it into your request again", async () => {
  const root = ask('deploy to prod')
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Deploy.' }))
  turn('joseph', 'Deployed.')
  const jeff = hub.agents.get('jeff')
  Object.assign(jeff, { status: 'working', current: 'something-else' })
  quiet()
  assert.equal(jeff.inbox.length, 1)
  const queued = jeff.inbox[0]
  assert.notEqual(queued.id, root.id)
  assert.equal(queued.closes, root.id)
  assert.equal(queued.closeRe, root.id)
  assert.equal(hub.feed.some((e) => e.id === queued.id), false)
  jeff.status = 'idle'
})

test("a quick teammate's report that lands before \"June has it\" isn't lost: that line knows nothing of it", () => {
  const root = ask()
  const jeff = hub.agents.get('jeff')
  hub.onHook('jeff', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1).text })
  hub.send({ from: 'jeff', to: 'joseph', text: 'Write the poem.' })
  // joseph is done before jeff's own turn is over
  const report = turn('joseph', 'Soft paws on the windowsill.')
  hub.onHook('jeff', { hook_event_name: 'Stop', last_assistant_message: 'Joseph has it.' })
  const said = hub.feed.findLast((e) => e.from === 'jeff' && e.kind === 'reply')
  assert.equal(said.out, true)
  assert.equal(hub.feed.at(-1), said, "jeff's line landed last")
  jeff.holdUntil = 0
  quiet()
  assert.match(prompts().at(-1)?.text ?? jeff.inbox[0]?.text ?? '', /Soft paws on the windowsill/, 'jeff is told, and writes the closing line')
  assert.equal(inThread(report), true)
  assert.equal(root.closed > 0, true)
})

test('with nobody to ask, that report comes out, not the line that came after it', () => {
  ask()
  const jeff = hub.agents.get('jeff')
  hub.onHook('jeff', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1).text })
  hub.send({ from: 'jeff', to: 'joseph', text: 'Write it.' })
  const report = turn('joseph', 'Written.')
  hub.onHook('jeff', { hook_event_name: 'Stop', last_assistant_message: 'Joseph has it.' })
  jeff.off = true
  quiet()
  assert.equal(inThread(report), false)
})

test('its own report, taking in what teammates said before its turn began, is the last word', () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix it.' }))
  turn('joseph', 'Fixed.')
  const jeff = hub.agents.get('jeff')
  jeff.turnBegan = Date.now() + 1000
  const last = hub.post({ kind: 'reply', from: 'jeff', text: 'All fixed.', re: hub.feed.at(-1).id, ts: Date.now() + 2000 })
  const typed = runner.typed.length
  hub.threadTick(last.ts + 60000)
  assert.equal(runner.typed.length, typed)
  assert.equal(inThread(last), false)
})

test('its reply answers your message, wherever the prompt came from, and only a turn with words posts anything', () => {
  const root = ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix it.' }))
  turn('joseph', 'Fixed.')
  quiet()
  const rows = hub.feed.length
  hub.onHook('jeff', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1).text })
  hub.onHook('jeff', { hook_event_name: 'Stop', last_assistant_message: '' })
  assert.equal(hub.feed.length, rows, 'nothing said: no line')
  assert.equal(inThread(hub.feed.find((e) => e.text === 'On it.')), false)
  assert.equal(hub.feed.find((e) => e.text === 'On it.').re, root.id)
})

test('with nobody to ask, the report comes out: off, stopped or asked a moment ago', async () => {
  for (const nobody of [(a) => (a.off = true), (a) => (a.status = 'stopped')]) {
    await done()
    fresh()
    ask()
    turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix it.' }))
    const report = turn('joseph', 'Failed: no access.')
    nobody(hub.agents.get('jeff'))
    const typed = runner.typed.length
    quiet()
    assert.equal(runner.typed.length, typed)
    assert.equal(hub.agents.get('jeff').inbox.length, 0)
    assert.equal(inThread(report), false)
  }
})

test('a question comes out whenever the minute ticks over', async () => {
  for (const phase of [1000, 15000, 30000, 44000, 45000, 59000]) {
    await done()
    fresh()
    ask()
    turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix it.' }))
    const asked = turn('joseph', 'Should I go ahead?')
    for (let t = phase; t < 200000; t += 60000) hub.threadTick(asked.ts + t)
    assert.equal(inThread(asked), false, `first tick ${phase} ms after`)
    assert.equal(asked.asks, true)
  }
})

test('a question brought out arrives now, at the end of the chat, and counts as new', () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix it.' }))
  const asked = turn('joseph', 'Should I go ahead?')
  const said = hub.post({ kind: 'reply', from: 'david', text: 'Unrelated.' })
  hub.read({ joseph: Date.now() + 5000 })
  const at = Date.now() + 90000
  hub.threadTick(at)
  assert.equal(hub.feed.at(-1), asked)
  assert.ok(hub.feed.indexOf(said) < hub.feed.indexOf(asked))
  assert.equal(asked.ts, at)
})

test('a question between teammates stays between them, and so does one whoever it answers is still working on', () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix it.' }))
  const q = hub.post({ kind: 'msg', from: 'jeff', to: 'joseph', text: 'Which one?', ask: true, re: hub.feed.at(-1).id })
  const between = hub.post({ kind: 'reply', from: 'joseph', text: 'This one, or that one?', re: q.id })
  hub.threadTick(between.ts + 90000)
  assert.equal(inThread(between), true)
  const hand = hub.post({ kind: 'msg', from: 'jeff', to: 'david', text: 'Look at this.', re: between.id })
  const reply = hub.post({ kind: 'reply', from: 'david', text: 'Should I fix it?', re: hand.id })
  hub.agents.get('jeff').status = 'working'
  hub.threadTick(reply.ts + 90000)
  assert.equal(inThread(reply), true)
  hub.agents.get('jeff').status = 'idle'
})

test('only a few words right after a hand-off are an echo: a report stays a line of its own, and one that asks can come out', () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix it.' }))
  const long = turn('joseph', `The migration failed. ${'detail '.repeat(80)}`, () => hub.send({ from: 'joseph', to: 'david', text: 'FYI.' }))
  assert.equal(long.echo, undefined)
  hub.agents.get('david').status = 'working'
  const asks = turn('joseph', 'Told David. Should I roll back?', () => hub.send({ from: 'joseph', to: 'david', text: 'FYI 2.' }))
  assert.equal(asks.echo, undefined)
  hub.agents.get('david').status = 'idle'
})

test('nobody calls a thread over while its hand-offs are being read, or typed in and not yet taken', () => {
  const root = ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'A.' }))
  const a = hub.feed.at(-1)
  const joseph = hub.agents.get('joseph')
  const rows = hub.feed.filter((e) => e.thread === root.id)
  assert.equal(hub.threadBusy(root.id, rows), true, 'typed in, not yet taken')
  Object.assign(joseph, { expect: null, inbox: [], serving: [a], status: 'working', current: 'something-else' })
  assert.equal(hub.threadBusy(root.id, rows), true, 'in the turn')
  Object.assign(joseph, { serving: [], status: 'idle', current: null })
  assert.equal(hub.threadBusy(root.id, rows), false)
})

test("hand-offs from two threads aren't read as one turn", () => {
  const one = ask('first')
  const two = ask('second')
  const david = hub.agents.get('david')
  david.status = 'working'
  const a = hub.post({ kind: 'msg', from: 'jeff', to: 'david', text: 'A.', re: one.id, queued: true })
  const b = hub.post({ kind: 'msg', from: 'jeff', to: 'david', text: 'B.', re: two.id, queued: true })
  david.inbox.push(a, b)
  assert.deepEqual(hub.peek(david).map((m) => m.id), [a.id])
  david.inbox.length = 0
  david.status = 'idle'
})

test("a slash command's output is the channel's, not the last thread's", () => {
  ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix it.' }))
  turn('joseph', 'Fixed.')
  hub.onHook('joseph', { hook_event_name: 'UserPromptSubmit', prompt: '/review' })
  hub.onHook('joseph', { hook_event_name: 'Stop', last_assistant_message: 'Looks fine.' })
  assert.equal(inThread(hub.feed.at(-1)), false)
  assert.equal(hub.feed.at(-1).text, 'Looks fine.')
})

test('you carrying on from an agent\'s line in the channel is who it answers: that agent is asked', () => {
  const said = hub.post({ kind: 'reply', from: 'jeff', text: 'The build is red.' })
  hub.send({ to: 'jeff', text: 'fix it', re: said.id })
  const mine = hub.feed.at(-1)
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix the build.' }))
  turn('joseph', 'Fixed.')
  quiet()
  assert.equal(prompts().at(-1).n, 'jeff')
  const closing = turn('jeff', 'The build is green.')
  assert.equal(closing.re, mine.id)
  assert.equal(inThread(closing), false)
})

test('you talking in the thread after the report: nobody is asked, and nothing is brought out', () => {
  const root = ask()
  turn('jeff', 'On it.', () => hub.send({ from: 'jeff', to: 'joseph', text: 'Fix it.' }))
  turn('joseph', 'Fixed.')
  hub.send({ to: 'david', text: 'and the docs?', re: root.id, thread: root.id })
  const reply = turn('david', 'Docs too.')
  quiet()
  assert.equal(prompts().length, 0)
  assert.equal(inThread(reply), true)
})

test('posting into another channel is that channel\'s line, not a thread of what the agent was on', () => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'jeff' }, { name: 'david' }], workspaces: undefined }))
  const root = ask()
  const line = hub.post({ kind: 'msg', from: 'jeff', to: 'joseph', text: 'See #review.', re: root.id, channel: 'review' })
  assert.equal(line.thread, undefined)
  assert.equal(inThread(line), false)
})

test("Crew stepping in, mid-thread, is in that thread's channel", () => {
  const root = hub.post({ kind: 'msg', from: 'you', to: 'jeff', text: 'x', channel: 'review' })
  hub.agents.get('jeff').status = 'working'
  hub.agents.get('jeff').current = root.id
  const rule = hub.post({ kind: 'rule', rule: 'loop', from: 'jeff', to: 'david' })
  assert.equal(rule.thread, root.id)
  assert.equal(rule.channel, 'review')
  hub.agents.get('jeff').status = 'idle'
})

test('after a restart a thread that was going carries on; one long over shows its last report; one already asked is left', () => {
  const now = Date.now()
  const line = (id, extra) => ({ id, kind: 'msg', from: 'jeff', to: 'joseph', text: 'x', ...extra })
  hub.feed.push(
    line('a', { from: 'you', to: 'jeff', ts: now - 1000 }),
    line('a1', { re: 'a', thread: 'a', ts: now - 500 }),
    line('b', { from: 'you', to: 'jeff', ts: now - 9e6 }),
    { id: 'b1', kind: 'reply', from: 'joseph', text: 'old report', re: 'b', thread: 'b', ts: now - 8e6 },
    line('c', { from: 'you', to: 'jeff', ts: now - 1000, closed: now }),
    line('c1', { re: 'c', thread: 'c', ts: now - 500 }),
  )
  hub.resumeThreads(now)
  assert.equal(hub.openThreads.has('a'), true)
  assert.equal(hub.openThreads.has('b'), false)
  assert.equal(hub.feed.find((e) => e.id === 'b1').out, true)
  assert.equal(hub.openThreads.has('c'), false)
})

test('a long thread next to another leaves it its card, and long lines in one don\'t push the other out', () => {
  const lines = [{ id: 'r', kind: 'msg', from: 'you', to: 'a', ts: 0 }, { id: 'old', kind: 'msg', from: 'a', to: 'b', thread: 'r', ts: 1 }]
  for (let i = 0; i < 300; i++) lines.push({ id: `n${i}`, kind: 'msg', from: 'c', to: 'd', thread: 'z', ts: 2 + i })
  assert.equal(forClients(lines).some((e) => e.id === 'old'), true)
  const big = 'x'.repeat(16000)
  const feed = []
  for (let i = 0; i < 251; i++) feed.push({ id: `c${i}`, kind: 'reply', from: 'a', text: big })
  for (let i = 0; i < 140; i++) feed.push({ id: `t${i}`, kind: 'msg', from: 'a', thread: 'c0', text: big })
  const kept = keepFeed(feed)
  assert.ok(kept.filter((e) => !inThread(e)).length > 100)
  assert.ok(kept.filter(inThread).length > 100)
})

test('unread counts only what the channel shows', () => {
  const root = ask()
  hub.post({ kind: 'reply', from: 'joseph', text: 'in the thread', ts: Date.now() + 1000, re: hub.post({ kind: 'msg', from: 'jeff', to: 'joseph', text: 'x', re: root.id }).id })
  assert.equal(hub.summary().unread, 0)
  hub.post({ kind: 'reply', from: 'jeff', text: 'to you', re: root.id, ts: Date.now() + 1000 })
  assert.equal(hub.summary().unread, 1)
})

test('an agent at work says which thread it is working in', () => {
  const root = ask()
  hub.onHook('jeff', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1).text })
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'jeff').thread, root.id)
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'joseph').thread, undefined)
})

test('through the send the app and phones use: a reply box message goes in its thread, and the client sees the stamps', async () => {
  await done()
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'jeff', area: 'lead' }, { name: 'joseph', area: 'backend' }] }))
  const crew = new Crew({ bin: '/nonexistent', computerName: 'Studio' })
  Object.assign(crew.runner, { running: () => true, submit() {}, write() {} })
  const here = crew.hubs.values().next().value
  for (const a of here.agents.values()) a.status = 'working' // busy: messages queue
  await crew.send('jeff', 'fix it', [], {}, here)
  const root = here.feed.at(-1)
  const hand = here.post({ kind: 'msg', from: 'jeff', to: 'joseph', text: 'Fix it.', re: root.id })
  await crew.send('joseph', 'and the docs', [], { re: hand.id, thread: root.id }, here)
  const mine = here.feed.at(-1)
  assert.equal(mine.thread, root.id)
  assert.equal(mine.re, hand.id)
  const seen = crew.snapshot(here).feed
  assert.equal(seen.find((e) => e.id === mine.id).thread, root.id)
  assert.equal(inThread(seen.find((e) => e.id === hand.id)), true)
  for (const h of crew.hubs.values()) {
    for (const a of h.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
    clearTimeout(h.statsTimer)
    clearTimeout(h.convoTimer)
    clearInterval(h.stallTimer)
    await h.saving
  }
})

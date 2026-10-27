// Stalled tasks: a task In progress whose agent stopped without finishing it gets one reminder, and then you hear
// about it. Against the real Hub with a fake runner in a throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-stalls-'))
const { Hub, CONFIG } = await import('../core/hub.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
}

let hub, runner, notices
beforeEach(() => {
  for (const f of ['tickets.json', 'conversations.json', 'sessions.json', 'feed.jsonl']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'david', area: 'game client, UI' }, { name: 'joseph', area: 'backend api' }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
  notices = []
  hub.on('notice', (n) => notices.push(n))
})
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

const MIN = 60000
const later = (min) => Date.now() + min * MIN
const lastTyped = (name) => runner.typed.filter((t) => t.n === name).at(-1)?.text ?? ''
const events = (re) => hub.feed.filter((e) => e.kind === 'event' && re.test(e.text))

// The task goes to david in a fresh conversation, and he takes it in.
async function started(id = 1) {
  hub.fileTask({ text: 'Round complete card with Buddy', owner: 'david' })
  await hub.ticket('dispatch', id)
  const david = hub.agents.get('david')
  hub.onHook('david', { hook_event_name: 'SessionStart', source: 'startup' })
  david.holdUntil = 0
  hub.pump(david)
  return david
}

// One turn: it takes in what was typed and stops with `said`.
function turn(name, said) {
  hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt: lastTyped(name), session_id: 's1' })
  hub.onHook(name, { hook_event_name: 'Stop', last_assistant_message: said })
  hub.agents.get(name).holdUntil = 0
}

test('an agent that stops on its task gets one reminder, then you hear about it', async () => {
  const david = await started()
  turn('david', "Option C is built. I'll take the screenshots once it settles.")
  hub.checkStalls(later(5))
  assert.equal(events(/reminded/).length, 0, 'five minutes idle is nothing yet')
  hub.checkStalls(later(11))
  assert.equal(events(/stopped on #1 11 min ago without finishing it, so Crew reminded it/).length, 1)
  assert.match(lastTyped('david'), /\[crew\] Task #1 "Round complete card with Buddy" is still in progress[\s\S]*crew task done 1 [\s\S]*crew task note 1/)
  assert.equal(david.status, 'working')
  hub.checkStalls(later(30))
  assert.equal(events(/reminded/).length, 1, 'once')
  // it answers the reminder and stops again without finishing: now it's yours
  turn('david', 'Still waiting for it to settle.')
  hub.checkStalls(later(5))
  assert.equal(notices.length, 0)
  hub.checkStalls(later(11))
  const told = events(/stopped on #1 again without finishing it/)
  assert.equal(told.length, 1)
  assert.equal(told[0].alert, true)
  assert.deepEqual(notices.map((n) => [n.title, n.focus]), [['#1 has stalled', 'task:1']])
  assert.ok(hub.tickets.get(1).stalled)
  hub.checkStalls(later(60))
  assert.equal(notices.length, 1, 'you hear about it once')
  // a word on the task (a note, done) clears it
  hub.taskCommand('david', ['note', '1', 'blocked on the simulator'])
  assert.equal(hub.tickets.get(1).stalled, undefined)
})

test('a note after the reminder counts as progress: the next stall starts with a reminder again', async () => {
  await started()
  turn('david', 'Built it.')
  hub.checkStalls(later(11))
  turn('david', 'On it.')
  hub.taskCommand('david', ['note', '1', 'PR is up, screenshots next'])
  hub.checkStalls(later(11))
  assert.equal(notices.length, 0)
  hub.checkStalls(later(25))
  assert.equal(events(/so Crew reminded it/).length, 2)
})

test('its last reply asked you something: you hear about it, it is not nudged to carry on', async () => {
  await started()
  turn('david', 'Both options are ready. Which one should go in, A or C?')
  const typed = runner.typed.length
  hub.checkStalls(later(11))
  assert.equal(runner.typed.length, typed, 'nothing typed into it')
  assert.equal(events(/asked you something about #1 \d+ min ago and is waiting for your answer/).length, 1)
  assert.equal(notices.length, 1)
})

test('not stalled: busy, lined up, waiting on a teammate, or stalls switched off; background work gets longer', async () => {
  const david = await started()
  hub.checkStalls(later(30))
  assert.equal(events(/reminded/).length, 0, 'working on it')
  turn('david', 'Asked joseph for the endpoint.')
  // a question to a teammate still open: its answer calls it back
  const call = hub.open({ id: 'q1', from: 'david', to: 'joseph', text: 'which endpoint?' })
  hub.checkStalls(later(30))
  assert.equal(events(/reminded/).length, 0, 'waiting on joseph')
  hub.calls.delete(call.id)
  // something left running in the background calls it back when it's done
  david.background = 1
  hub.checkStalls(later(20))
  assert.equal(events(/reminded/).length, 0)
  hub.checkStalls(later(31))
  assert.equal(events(/reminded/).length, 1)
  // stallMinutes: 0 turns it off
  hub.stalls.clear()
  hub.config.stallMinutes = 0
  turn('david', 'ok')
  hub.checkStalls(later(120))
  assert.equal(events(/reminded/).length, 1)
})

test('a task nobody is on any more, still in progress: you hear about it', async () => {
  const david = await started()
  turn('david', 'Done with the first half.')
  // its conversation moved on (a fresh start for something else) without finishing the task
  hub.convos.david.ticket = null
  hub.checkStalls(later(11))
  assert.equal(events(/isn't on #1 any more, but it's still in progress/).length, 1)
  assert.equal(david.inbox.length, 0, 'nothing typed into an agent that has moved on')
})

test('a task waiting in its owner\'s queue is not stalled', async () => {
  const david = await started()
  hub.onHook('david', { hook_event_name: 'UserPromptSubmit', prompt: lastTyped('david'), session_id: 's1' })
  hub.fileTask({ text: 'Settings screen spacing', owner: 'david' })
  await hub.ticket('dispatch', 2) // queued behind #1
  hub.checkStalls(later(60))
  assert.equal(events(/#2/).filter((e) => /stalled|reminded|any more/.test(e.text)).length, 0)
  assert.equal(david.inbox[0].ticket, 2)
})

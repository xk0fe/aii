// Replying to a message from the chat, and what you've read: real Hub, fake runner, throwaway CREW_HOME.
// Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-replies-'))
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

let hub, runner
beforeEach(() => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'reads.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'joseph', area: 'backend' }, { name: 'gal', area: 'design' }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
})
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.readsTimer)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

// joseph answers whatever it was last handed
const answer = (name, text) => {
  hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1).text })
  hub.onHook(name, { hook_event_name: 'Stop', last_assistant_message: text })
  hub.agents.get(name).holdUntil = 0
  return hub.feed.at(-1)
}
const last = (name) => runner.typed.filter((t) => t.n === name).at(-1).text

test('a reply links to the message it answers; an older message of the agent is quoted to it', () => {
  hub.send({ to: 'joseph', text: 'look at the 500s' })
  const first = answer('joseph', 'The 500s come from the cache layer.')
  hub.send({ to: 'joseph', text: 'and the leaderboard?' })
  answer('joseph', 'Leaderboard is fine.')
  hub.send({ to: 'joseph', text: 'fix it then', re: first.id })
  const msg = hub.feed.findLast((e) => e.kind === 'msg')
  assert.equal(msg.re, first.id)
  assert.equal(last('joseph'), '[replying to your message "The 500s come from the cache layer."] fix it then')
})

test('replying to its latest message, or following up on your own, needs no quote', () => {
  hub.send({ to: 'joseph', text: 'look at the 500s' })
  const mine = hub.feed.at(-1)
  const reply = answer('joseph', 'Cache layer.')
  hub.send({ to: 'joseph', text: 'fix it', re: reply.id })
  assert.equal(last('joseph'), 'fix it')
  answer('joseph', 'Fixed.')
  hub.send({ to: 'joseph', text: 'and add a test', re: mine.id })
  assert.equal(last('joseph'), 'and add a test')
  assert.equal(hub.feed.findLast((e) => e.kind === 'msg').re, mine.id)
})

test("a teammate's message is quoted by name; a message from another computer is only quoted", () => {
  hub.send({ to: 'gal', text: 'mockups?' })
  const gals = answer('gal', 'Three mockups are in figma.')
  hub.send({ to: 'joseph', text: 'build the first one', re: gals.id })
  assert.equal(last('joseph'), `[replying to @gal's message "Three mockups are in figma."] build the first one`)
  hub.send({ to: 'gal', text: 'and the icons', re: 'f9@mac-mini', quote: { from: 'gal', text: 'Icons next week.' } })
  assert.equal(last('gal'), '[replying to your message "Icons next week."] and the icons')
  assert.equal(hub.feed.findLast((e) => e.kind === 'msg').re, undefined)
})

test('what you have read moves forward only, and a first run starts from now', () => {
  assert.ok(hub.snapshot().reads.since > Date.now() - 5000)
  hub.read({ joseph: 2000, 'gal@mac-mini': 50 })
  hub.read({ joseph: 1000 })
  assert.deepEqual({ ...hub.snapshot().reads.agents }, { joseph: 2000, 'gal@mac-mini': 50 })
})

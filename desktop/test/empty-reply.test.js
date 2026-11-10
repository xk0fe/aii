// A turn that ends without a word (Codex 0.162 sends last_assistant_message: null after a task that was all tool
// calls): the chat still shows that the agent finished, threaded to what it answered. Real Hub, fake runner,
// throwaway CLIQUE_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-empty-reply-'))
const { Hub, CONFIG } = await import('../core/hub.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push(text)
  write() {}
}

let hub, runner
beforeEach(() => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'rex', area: 'art', provider: 'codex' }, { name: 'noor', area: 'client' }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
})
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.steerTimer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

const hook = (name, e) => hub.onHook(name, e)
const replies = (name) => hub.feed.filter((e) => e.kind === 'reply' && e.from === name)

test('your message, answered without a word: the chat says it finished', () => {
  hub.send({ to: 'rex', text: 'Create hello.txt containing hi. Nothing else.' })
  const msg = hub.feed.at(-1)
  hook('rex', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  hook('rex', { hook_event_name: 'Stop', last_assistant_message: null })
  const [reply] = replies('rex')
  assert.equal(reply.re, msg.id)
  assert.equal(reply.empty, true)
  assert.match(reply.text, /^Finished without a final message/)
  assert.equal(hub.agents.get('rex').status, 'idle')
})

test('a reply with words is just the reply', () => {
  hub.send({ to: 'rex', text: 'draw the cover' })
  hook('rex', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  hook('rex', { hook_event_name: 'Stop', last_assistant_message: 'Cover drawn.' })
  assert.deepEqual(replies('rex').map((r) => [r.text, r.empty]), [['Cover drawn.', undefined]])
})

test('a long reply (a plan, a review) reaches the chat whole; past 16000 characters the cut shows', () => {
  const plan = '## Phase 2\n\n' + Array.from({ length: 120 }, (_, i) => `${i + 1}. Save per-class mAP for gun and knife, precision and recall.`).join('\n')
  assert.ok(plan.length > 4000 && plan.length < 16000)
  hub.send({ to: 'rex', text: 'plan the evaluation work' })
  hook('rex', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  hook('rex', { hook_event_name: 'Stop', last_assistant_message: plan })
  assert.equal(replies('rex').at(-1).text, plan)
  hub.send({ to: 'rex', text: 'and the whole log, please' })
  hook('rex', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  hook('rex', { hook_event_name: 'Stop', last_assistant_message: 'x'.repeat(20000) })
  assert.equal(replies('rex').at(-1).text, `${'x'.repeat(16000)}\n…`)
})

test('a /command typed in its terminal, or a turn a background task started after the reply, adds nothing', () => {
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: '/compact' })
  hook('noor', { hook_event_name: 'Stop', last_assistant_message: '' })
  hub.send({ to: 'noor', text: 'run the e2e suite in the background' })
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  hook('noor', { hook_event_name: 'Stop', last_assistant_message: 'Started it.', background_tasks: [{ id: 'b1', type: 'shell', status: 'running' }] })
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>b1</task-id>\n</task-notification>' })
  hook('noor', { hook_event_name: 'Stop', last_assistant_message: null })
  assert.deepEqual(replies('noor').map((r) => r.text), ['Started it.'])
})

test("a teammate's question answered without a word: they still hear it finished without an answer", async () => {
  const asked = hub.question({ from: 'noor', to: 'rex', text: 'which palette did you use?' })
  hook('rex', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  hook('rex', { hook_event_name: 'Stop', last_assistant_message: null })
  assert.equal(await asked, '@rex answered:\n\n(@rex finished without an answer.)\n')
  assert.equal(replies('rex')[0].empty, true)
})

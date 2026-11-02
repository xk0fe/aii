// Claude Code's own prompts: when a command or sub-agent an agent left running in the background finishes, Claude
// Code submits a <task-notification> by itself. It isn't a message from you, nor a new task, and the agent's reply
// still answers what it was asked. Real Hub, fake runner, throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-notices-'))
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

let hub, runner, dev
beforeEach(() => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'dev', area: 'everything' }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
  dev = hub.agents.get('dev')
})
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.steerTimer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

const hook = (e) => hub.onHook('dev', e)
const notice = (id = 'b86mb6m67') =>
  hook({ hook_event_name: 'UserPromptSubmit', prompt: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Background command "fuzz" completed (exit code 0)</summary>\n</task-notification>` })
const fromTerminal = () => hub.feed.filter((e) => e.via === 'terminal')
const task = (text) => {
  hub.send({ to: 'dev', text })
  hook({ hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  return hub.feed.find((e) => e.text === text)
}

test('a notice in the middle of a turn: no message from you, and the reply threads to the task', () => {
  const msg = task('refactor report.js')
  notice()
  notice('byhk2t0wp')
  assert.deepEqual(fromTerminal(), [])
  assert.equal(dev.status, 'working')
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Version 1.5.0 is done.' })
  const reply = hub.feed.at(-1)
  assert.equal(reply.kind, 'reply')
  assert.equal(reply.re, msg.id)
  assert.equal(hub.stats.dev.tasks, 1)
  assert.equal(hub.convos.dev.tasks, 1)
})

test('a notice after the turn ended: the agent is busy again, on the same task', () => {
  const msg = task('run the benchmarks in the background and report')
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Started them, I will report when they finish.', background_tasks: [{ id: 'b1', type: 'shell', status: 'running' }] })
  assert.equal(dev.status, 'idle')
  notice()
  assert.equal(dev.status, 'working')
  assert.deepEqual(fromTerminal(), [])
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Benchmarks: 12% faster.' })
  assert.deepEqual(hub.feed.filter((e) => e.kind === 'reply').map((e) => e.re), [msg.id, msg.id])
  assert.equal(hub.stats.dev.tasks, 1)
  assert.equal(hub.stats.dev.turns, 2)
})

test("a notice that beats Crew's message to the prompt doesn't take its place", () => {
  hub.send({ to: 'dev', text: 'now the docs' })
  const msg = hub.feed.at(-1)
  notice()
  assert.ok(dev.expect, 'still waiting for its message to be taken up')
  hook({ hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  assert.equal(dev.current, msg.id)
  assert.equal(dev.expect, null)
})

test('a prompt you type in its terminal still shows in the chat', () => {
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'what changed in <task-notification> handling?' })
  assert.equal(fromTerminal().length, 1)
  assert.equal(dev.current, fromTerminal()[0].id)
})

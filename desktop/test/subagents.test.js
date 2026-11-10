// Sub-agents (Claude Code's Agent tool), from the hook events Claude Code 2.1 sends: the payload shapes below are
// the ones a real run produced. Real Hub, fake runner, throwaway CLIQUE_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-subs-'))
const { Hub, CONFIG } = await import('../core/hub.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit() {}
  write() {}
}

let hub
beforeEach(() => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'june', area: 'backend' }] }))
  hub = new Hub(new FakeRunner(), { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (hub.runner.live.add(a.name), (a.status = 'idle'))
})
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

const hook = (e) => hub.onHook('june', e)
const subs = () => hub.snapshot().agents[0].subs
const june = () => hub.agents.get('june')
const agentCall = (id, description, extra = {}) => ({ tool_name: 'Agent', tool_use_id: `toolu_${id}`, tool_input: { description, prompt: '…', ...extra } })

// Two sub-agents at once, in the background: the Agent calls return right away, the sub-agents keep working
// after the agent's own turn ends, and each one finishing wakes it up for another turn.
test('parallel background sub-agents: named, followed tool by tool, finished, and listed on the replies', () => {
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'count files and read a.txt' })
  hook({ hook_event_name: 'PreToolUse', ...agentCall(1, 'Count files') })
  hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'general-purpose' })
  hook({ hook_event_name: 'PostToolUse', ...agentCall(1, 'Count files'), tool_response: { isAsync: true, status: 'async_launched', agentId: 'a1', description: 'Count files' } })
  hook({ hook_event_name: 'PreToolUse', ...agentCall(2, 'Read a.txt') })
  hook({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'general-purpose' })
  hook({ hook_event_name: 'PostToolUse', ...agentCall(2, 'Read a.txt'), tool_response: { isAsync: true, status: 'async_launched', agentId: 'a2', description: 'Read a.txt' } })
  assert.deepEqual(subs().map((s) => [s.id, s.type, s.description]), [['a1', 'general-purpose', 'Count files'], ['a2', 'general-purpose', 'Read a.txt']])

  june().activity = 'Agent · Read a.txt'
  hook({ hook_event_name: 'PostToolUse', agent_id: 'a1', agent_type: 'general-purpose', tool_name: 'Bash', tool_input: { command: 'ls' } })
  hook({ hook_event_name: 'PostToolUse', agent_id: 'a2', agent_type: 'general-purpose', tool_name: 'Read', tool_input: { file_path: '/x/a.txt' } })
  assert.deepEqual(subs().map((s) => [s.tools, s.activity]), [[1, 'Bash · ls'], [1, 'Read · a.txt']])
  assert.equal(june().activity, 'Agent · Read a.txt', "a sub-agent's step isn't the agent's own")

  // its own turn ends while both still run
  const running = [{ id: 'a1', type: 'subagent', status: 'running', description: 'Count files', agent_type: 'general-purpose' }, { id: 'a2', type: 'subagent', status: 'running', description: 'Read a.txt', agent_type: 'general-purpose' }]
  hook({ hook_event_name: 'Stop', last_assistant_message: 'DONE', background_tasks: running })
  assert.equal(june().status, 'idle')
  assert.deepEqual(hub.feed.at(-1).subs.map((s) => [s.description, s.running]), [['Count files', true], ['Read a.txt', true]])
  assert.equal(subs().length, 2, 'still shown: they keep working after its turn')

  hook({ hook_event_name: 'PostToolUse', agent_id: 'a1', agent_type: 'general-purpose', tool_name: 'Bash', tool_input: { command: 'ls -la' } })
  assert.equal(june().status, 'idle', 'a background sub-agent working leaves the agent free')
  hook({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'general-purpose', last_assistant_message: 'One entry, a.txt', background_tasks: running })
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Count files finished: 1 file', background_tasks: [running[1]] })
  assert.deepEqual(hub.feed.at(-1).subs.map((s) => [s.description, s.tools, s.running]), [['Count files', 2, false], ['Read a.txt', 1, true]])

  hook({ hook_event_name: 'SubagentStop', agent_id: 'a2', agent_type: 'general-purpose', last_assistant_message: 'hello' })
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Both done', background_tasks: [] })
  assert.deepEqual(hub.feed.at(-1).subs.map((s) => [s.description, s.running]), [['Read a.txt', false]])
  // finished ones leave the live view after a moment
  for (const s of june().subs.values()) s.ended -= 60000
  assert.deepEqual(subs(), [])
})

test('a sub-agent that runs in the foreground (older "Task" name) ends with its call', () => {
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'review it' })
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 'toolu_9', tool_input: { description: 'Review the diff', subagent_type: 'code-reviewer' } })
  hook({ hook_event_name: 'SubagentStart', agent_id: 'r1', agent_type: 'code-reviewer' })
  assert.equal(subs()[0].description, 'Review the diff')
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Task', tool_use_id: 'toolu_9', tool_input: { description: 'Review the diff', subagent_type: 'code-reviewer' }, tool_response: { status: 'completed', agentId: 'r1', totalToolUseCount: 4 } })
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Looks good', background_tasks: [] })
  assert.deepEqual(hub.feed.at(-1).subs.map((s) => [s.type, s.running]), [['code-reviewer', false]])
})

test('replies without sub-agents carry nothing extra; a restart forgets them', () => {
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' })
  hook({ hook_event_name: 'Stop', last_assistant_message: 'hello' })
  assert.equal(hub.feed.at(-1).subs, undefined)
  hook({ hook_event_name: 'SubagentStart', agent_id: 'z', agent_type: 'Explore' })
  assert.equal(subs().length, 1)
  hub.url = 'http://127.0.0.1:1'
  hub.launch(june())
  assert.deepEqual(subs(), [])
})

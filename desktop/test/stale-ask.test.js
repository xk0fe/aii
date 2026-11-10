// A question Claude Code settles by itself: its safety check turns a risky command down two minutes after asking, the
// agent carries on, and no hook says so. The card closes once the call has a result in the agent's transcript, or when
// its turn ends. Lines as Claude Code 2.1.300 writes them (trimmed). Fake runner and clock, throwaway CLIQUE_HOME.
// Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-stale-ask-'))
const { Hub, CONFIG } = await import('../core/hub.js')
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

class FakeRunner extends EventEmitter {
  running = () => true
  write() {}
  submit() {}
  stop() {}
  start() {}
}

const RM = { command: 'D=$(pwd)/junk; mkdir -p $D/a; rm -rf $D/*', description: 'Create junk/a and clear everything inside junk' }
const DENIED = "Permission for this command was denied by a built-in Claude Code safety check, not by the user. The check stops removals that can delete far more than intended: a system, home or workspace directory, or a target it cannot resolve, such as a shell variable that, if unset or empty, turns this into `rm -rf /*`."
const use = (id, input = RM, name = 'Bash') => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' } })
const result = (id, content, is_error = false) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } })

let hub, transcript, june
const write = (...lines) => fs.appendFileSync(transcript, lines.map((l) => JSON.stringify(l) + '\n').join(''))
const ask = (extra = {}) => hub.ask('june', { hook_event_name: 'PermissionRequest', transcript_path: transcript, tool_name: 'Bash', tool_input: RM, permission_suggestions: [], ...extra })
const card = () => hub.feed.findLast((e) => e.kind === 'ask')

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() })
  for (const f of ['feed.jsonl', 'stats.json']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'june', area: 'backend' }, { name: 'rex', area: 'art', provider: 'codex' }] }))
  hub = new Hub(new FakeRunner(), { bin: '/nonexistent' })
  for (const a of hub.agents.values()) a.status = 'working'
  june = hub.agents.get('june')
  transcript = path.join(process.env.CLIQUE_HOME, `t-${Math.random()}.jsonl`)
  write({ type: 'user', message: { role: 'user', content: 'clear the junk folder' } }, use('toolu_018Dw'))
})
afterEach(() => {
  for (const id of [...hub.asks.keys()]) hub.settle(id, '', { stale: true }, true)
  mock.timers.reset()
  clearTimeout(hub.statsTimer)
  for (const a of hub.agents.values()) clearTimeout(a.timer), clearTimeout(a.steerTimer)
})

test("Claude Code's safety check turns it down: the card closes and says so, and the agent is back to work", async () => {
  const hook = ask()
  assert.equal(june.status, 'waiting')
  mock.timers.tick(115000)
  assert.equal(card().answer, undefined)
  write(result('toolu_018Dw', DENIED, true))
  mock.timers.tick(5000)
  assert.deepEqual({ ...card().answer, at: 0 }, { by: 'cli', why: 'its safety check', at: 0 })
  assert.equal(await hook, '', 'the hook prints no decision')
  assert.equal(june.status, 'working')
  assert.equal(hub.asking('june'), false)
})

test('a call that ran while the hook was still up was allowed in its terminal', () => {
  ask()
  write(result('toolu_018Dw', 'done'))
  mock.timers.tick(5000)
  assert.equal(card().answer.by, 'terminal')
})

test('neither an older run of the same command nor a parallel call closes the card', () => {
  write(result('toolu_018Dw', 'done')) // the same command, run earlier
  write(use('toolu_new'), use('toolu_read', { file_path: '/tmp/a' }, 'Read'))
  ask()
  write(result('toolu_read', 'file contents'))
  mock.timers.tick(30000)
  assert.equal(card().answer, undefined)
  write(result('toolu_new', DENIED, true))
  mock.timers.tick(5000)
  assert.equal(card().answer.by, 'cli')
})

test('trying the same command again after the denial: the card is about the first try', () => {
  ask()
  write(use('toolu_retry')) // turned down, it tries the same again (Claude Code writes the result first in real life)
  mock.timers.tick(5000)
  assert.equal(card().answer, undefined)
  write(result('toolu_018Dw', DENIED, true))
  mock.timers.tick(5000)
  assert.equal(card().answer.by, 'cli')
})

test("the turn ends: its open question isn't waiting any more, but a sub-agent's is", () => {
  ask()
  const mine = card()
  ask({ agent_id: 'a1b2c3', agent_type: 'general-purpose' })
  const sub = card()
  hub.onHook('june', { hook_event_name: 'Stop', last_assistant_message: 'Done.' })
  assert.equal(mine.answer.stale, true)
  assert.equal(sub.answer, undefined)
  assert.equal(hub.asks.size, 1)
})

test('the turn ends right after the denial: the card still says what happened', () => {
  ask()
  write(result('toolu_018Dw', DENIED, true))
  hub.onHook('june', { hook_event_name: 'Stop', last_assistant_message: 'The safety check blocked it.' })
  assert.equal(card().answer.by, 'cli')
  assert.equal(june.status, 'idle')
})

test("an API error ends the turn: same, no stale card", () => {
  ask()
  hub.onHook('june', { hook_event_name: 'StopFailure', error: 'rate_limit' })
  assert.equal(card().answer.stale, true)
})

test("Codex isn't watched: it waits on its hook, so it can't move on without an answer", () => {
  hub.ask('rex', { hook_event_name: 'PermissionRequest', transcript_path: transcript, tool_name: 'Bash', tool_input: RM })
  write(result('toolu_018Dw', DENIED, true))
  mock.timers.tick(60000)
  assert.equal(card().answer, undefined)
})

test('a transcript that is missing or unreadable leaves the card as it is', () => {
  fs.rmSync(transcript)
  ask()
  mock.timers.tick(60000)
  assert.equal(card().answer, undefined)
})

// What the crew's work costs: Claude Code's running total from its status line, Codex's tokens from its log, counted
// per agent, task and hour, never twice. Against the real Hub with a fake runner in a throwaway CREW_HOME. Run with
// `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-spend-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { spentFrom, codexSpent } = await import('../core/context.js')
const at = (f) => path.join(process.env.CREW_HOME, f)

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
}

let hub
const newHub = () => {
  hub = new Hub(new FakeRunner(), { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (hub.runner.live.add(a.name), (a.status = 'idle'), (a.run = `run-${a.name}`))
  return hub
}
beforeEach(() => {
  for (const f of ['feed.jsonl', 'stats.json', 'spend.json', 'tickets.json', 'conversations.json', 'sessions.json']) fs.rmSync(at(f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'noor', area: 'mobile app', clones: 1 }, { name: 'eli', area: 'release', provider: 'codex' }] }))
  newHub()
})
const quiet = () => {
  for (const t of ['statsTimer', 'convoTimer', 'spendTimer', 'ticketsTimer', 'usageTimer']) clearTimeout(hub[t])
}
afterEach(quiet)
// Crew quits (saving what it knows, as Crew.close does) and starts again.
const restart = () => {
  hub.saveStats()
  hub.saveSpend(true)
  quiet()
  return newHub()
}
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

const line = (name, session, cost, added = 0, removed = 0) =>
  hub.onStatusLine(name, { session_id: session, cost: { total_cost_usd: cost, total_lines_added: added, total_lines_removed: removed, total_api_duration_ms: cost * 1000 } })
const stats = (name) => hub.snapshot().agents.find((a) => a.name === name).stats
const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} ≈ ${y}`)

test("the status line's cost block, numbers only", () => {
  assert.deepEqual(spentFrom({ cost: { total_cost_usd: 1.25, total_lines_added: 10.4, total_lines_removed: 3, total_api_duration_ms: 900 } }), { cost: 1.25, added: 10, removed: 3, apiMs: 900 })
  assert.equal(spentFrom({}), null)
  assert.equal(spentFrom({ cost: { total_cost_usd: '1.25' } }), null)
  assert.deepEqual(spentFrom({ cost: { total_cost_usd: 0.5, total_lines_added: 'lots' } }), { cost: 0.5, added: 0, removed: 0, apiMs: 0 })
})

test('what grew since the last report goes to the agent, its day and the hour', () => {
  line('noor', 's1', 0.4, 10, 2)
  line('noor', 's1', 1.0, 25, 5)
  line('noor', 's1', 1.0, 25, 5) // the same report again counts nothing
  const s = stats('noor')
  near(s.cost, 1.0)
  near(s.costToday, 1.0)
  assert.equal(s.linesAdded, 25)
  assert.equal(s.linesRemoved, 5)
  near(hub.spend.hours[Object.keys(hub.spend.hours)[0]].reduce((x, y) => x + y, 0), 1.0)
  near(hub.snapshot().spend.today, 1.0)
})

test('a task gets what its conversation spent on it, and a clone counts as its original', () => {
  const t = hub.tickets.add({ title: 'Round complete card', owner: 'noor' })
  hub.convos.noor = { since: Date.now(), tasks: 1, compactions: 0, ticket: t.id }
  line('noor', 's1', 2.5, 40, 4)
  assert.deepEqual(hub.tickets.get(t.id).spent, { cost: 2.5, tokens: 0, added: 40, removed: 4 })
  const clone = hub.spawnClone(hub.agents.get('noor'), { id: 'm1' })
  clone.run = 'run-clone'
  line(clone.name, clone.sessionId, 1.5)
  near(stats('noor').cost, 4.0)
  assert.equal(hub.tickets.get(t.id).spent.cost, 2.5, "the clone's conversation isn't on that task")
})

test('nothing is counted twice: a counter that starts over, a restarted CLI, a resumed session Crew never saw', () => {
  line('noor', 's1', 1.0)
  line('noor', 's1', 0.3) // /clear or the like: its counter started over
  near(stats('noor').cost, 1.3)
  // a new process resuming s1, its total picked back up: only what grew beyond the last report counts
  const noor = hub.agents.get('noor')
  noor.run = 'run-2'
  line('noor', 's1', 0.9)
  near(stats('noor').cost, 1.9)
  // another new process that started counting from zero
  noor.run = 'run-3'
  line('noor', 's1', 0.2)
  near(stats('noor').cost, 2.1)
  // a session from before Crew counted spend, resumed: from here on
  noor.run = 'run-4'
  noor.resumed = true
  line('noor', 'old', 40)
  line('noor', 'old', 41)
  near(stats('noor').cost, 3.1)
  // after a restart of Crew, what it saw is still known
  restart()
  hub.agents.get('noor').run = 'run-4'
  line('noor', 'old', 42)
  near(stats('noor').cost, 4.1)
})

test('Codex agents count the tokens in their session log', () => {
  const log = at('rollout-x.jsonl')
  const count = (total) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total - 100, output_tokens: 100, total_tokens: total }, last_token_usage: { total_tokens: 50 }, model_context_window: 258400 } } })
  fs.writeFileSync(log, [count(12000), '{not json', ''].join('\n'))
  assert.deepEqual(codexSpent(log), { tokens: 12000 })
  hub.onHook('eli', { hook_event_name: 'Stop', session_id: 'c1', transcript_path: log, last_assistant_message: 'done' })
  fs.appendFileSync(log, count(20000) + '\n')
  hub.agents.get('eli').contextAt = 0
  hub.onHook('eli', { hook_event_name: 'Stop', session_id: 'c1', transcript_path: log, last_assistant_message: 'done' })
  const s = stats('eli')
  assert.equal(s.tokens, 20000)
  assert.equal(s.cost, 0)
})

test("today against what's usual by now, on the days the crew spent anything", () => {
  const day = (n) => new Date(Date.now() - n * 864e5 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const flat = (perHour) => Array(24).fill(perHour)
  hub.spend.hours = { [day(1)]: flat(1), [day(2)]: flat(2), [day(3)]: flat(3), [day(40)]: flat(100) } // 40 days ago is too old
  hub.stats.noor = { first: Date.now(), days: { [day(0)]: { cost: 5 }, [day(1)]: { cost: 24 }, [day(8)]: { cost: 7 } }, cost: 36 }
  const sp = hub.snapshot().spend
  const now = new Date()
  const hours = now.getHours() + now.getMinutes() / 60
  near(sp.usual, 2 * hours) // the average of 1, 2 and 3 an hour, by now
  near(sp.today, 5)
  near(sp.week, 29)
  near(sp.weekBefore, 7)
})

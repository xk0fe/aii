// The look back: what the clique's work cost before CLIque counted it, read from the agents' own logs (core/backfill.js),
// added to the stats once, and never counted again by the live count. Fixture transcripts in a throwaway CLIQUE_HOME;
// the merge against the real Hub with a fake runner. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-backfill-'))
process.env.PATH = '/usr/bin:/bin' // no codex to discover: Hub.start would look its models up after the test is over
const { Hub, CONFIG } = await import('../core/hub.js')
const { lookBack, costOf, taskOf } = await import('../core/backfill.js')
const root = process.env.CLIQUE_HOME
const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} ≈ ${y}`)
const HOUR = 3600000

test('a response priced at list price: cache writes by their lifetime, fast mode doubled, unknown models not at all', () => {
  // Opus 5.5: $4 in, $20 out, $0.20 cache read, writes 1.25x (5 min) or 2x (1 h) input
  const usage = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 } }
  near(costOf(usage, 'claude-opus-5-5'), 4 + 20 + 0.2 + 5 + 8)
  near(costOf({ ...usage, speed: 'fast' }, 'claude-opus-5-5'), 2 * (4 + 20 + 0.2 + 5 + 8))
  // no split: all of it the 5-minute kind; a dated snapshot prices as its model
  near(costOf({ input_tokens: 0, output_tokens: 1e6, cache_creation_input_tokens: 1e6 }, 'claude-haiku-4-5-20251001'), 5 + 1.25)
  near(costOf({ cache_read_input_tokens: 1e6 }, 'claude-fable-5-1'), 0.25)
  assert.equal(costOf({ output_tokens: 1e6 }, 'gpt-6-luna'), null)
})

test("a task's brief opens its conversation; one that lives on another computer isn't this one's", () => {
  assert.equal(taskOf('<pasted_content id="1">\n[bug #14] Arabic iOS: titles sit left\n…\nThen run: clique task done 14 "what was wrong"'), 14)
  assert.equal(taskOf('[feature #2] Daily copy'), 2)
  assert.equal(taskOf('[bug #12] Jump\nThen run: clique task done 12@laptop "…"'), null)
  assert.equal(taskOf('build option C of the hole card'), null)
})

// ---- fixture logs ---------------------------------------------------------------------------------------------

const claude = path.join(root, 'claude', 'projects')
const codex = path.join(root, 'codex', 'sessions')
const now = Date.now()
const ts = (ago) => new Date(now - ago).toISOString()
const response = (id, ago, usage, model = 'claude-opus-5-5') => JSON.stringify({ type: 'assistant', timestamp: ts(ago), requestId: `r-${id}`, message: { id: `m-${id}`, model, usage } })
const out = (n) => ({ input_tokens: 0, output_tokens: n, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
function write(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, lines.join('\n') + '\n')
}
const project = path.join(claude, '-code-app')
write(path.join(project, 's-noor.jsonl'), [
  JSON.stringify({ type: 'custom-title', customTitle: 'noor', sessionId: 's-noor' }),
  JSON.stringify({ type: 'agent-name', agentName: 'noor', sessionId: 's-noor' }),
  JSON.stringify({ type: 'user', timestamp: ts(5 * HOUR), message: { role: 'user', content: '<pasted_content id="a">\n[bug #7] Coins reset after level 2\nThen run: clique task done 7 "…"' } }),
  response(1, 5 * HOUR, out(50000)), // $1 of output
  response(1, 5 * HOUR, out(50000)), // the same response, streamed as another line
  response(2, 4 * HOUR, out(100000)), // $2
  response(3, 40 * 864e5, out(1e6)), // before the window
])
// its sub-agent, in the session's folder: its work is noor's too
write(path.join(project, 's-noor', 'subagents', 'agent-x.jsonl'), [response(4, 3 * HOUR, out(25000))]) // $0.50
// a clone's session: counts as noor's, and isn't about a task
write(path.join(project, 's-noor2.jsonl'), [JSON.stringify({ type: 'agent-name', agentName: 'noor.2' }), JSON.stringify({ type: 'user', message: { content: 'also fix the footer' } }), response(5, 2 * HOUR, out(50000))])
// your own session with a name, and one without: not the clique's
write(path.join(project, 's-you.jsonl'), [JSON.stringify({ type: 'agent-name', agentName: 'caddy feature ui' }), response(6, HOUR, out(1e6))])
write(path.join(project, 's-anon.jsonl'), [response(7, HOUR, out(1e6))])
// Codex: the clique prompt names the agent; running totals, one of which starts over
const tokens = (ago, total) => JSON.stringify({ timestamp: ts(ago), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total } } } })
write(path.join(codex, '2026', '10', '07', 'rollout-2026-10-07T21-20-13-01a118e1-cbb7-79f1-86de-171129cfb460.jsonl'), [
  JSON.stringify({ type: 'session_meta', payload: { id: '01a118e1-cbb7-79f1-86de-171129cfb460', model: 'gpt-6.1-sol' } }),
  JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are "eli", one of several AI agents working side by side…' }] } }),
  JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '[task #9] Release notes\nThen run: clique task done 9 "…"' }] } }),
  tokens(3 * HOUR, 10000), tokens(2 * HOUR, 25000), tokens(HOUR, 4000), // 10k, 15k, then a restart: 4k
])
write(path.join(codex, '2026', '10', '07', 'rollout-2026-10-07T22-00-00-99999999-cbb7-79f1-86de-171129cfb460.jsonl'), [
  JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are "stranger", one of several AI agents' }] } }), tokens(HOUR, 999999),
])

test("the look back finds the clique's sessions, counts each response once, and leaves everything else alone", async () => {
  const r = await lookBack({ claude: [claude], codex, names: ['noor', 'eli'], since: now - 30 * 864e5, until: now })
  const sum = (days, k) => Object.values(days ?? {}).reduce((s, d) => s + d[k], 0)
  near(sum(r.agents.noor, 'cost'), 1 + 2 + 0.5 + 1) // the session, its sub-agent and the clone
  assert.equal(sum(r.agents.eli, 'tokens'), 10000 + 15000 + 4000)
  assert.deepEqual(Object.keys(r.agents).sort(), ['eli', 'noor'])
  near(r.tickets[7].cost, 1 + 2 + 0.5) // the clone's conversation isn't on #7
  assert.equal(r.tickets[9].tokens, 29000)
  assert.deepEqual(r.sessions.sort(), ['01a118e1-cbb7-79f1-86de-171129cfb460', 's-noor', 's-noor2'])
  near(Object.values(r.hours).flat().reduce((s, v) => s + v, 0), 4.5)
  // a window that ends before most of it
  const early = await lookBack({ claude: [claude], codex, names: ['noor'], since: now - 30 * 864e5, until: now - 4.5 * HOUR })
  near(sum(early.agents.noor, 'cost'), 1)
})

// ---- the merge, against the hub ----------------------------------------------------------------------------------

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
  for (const f of ['feed.jsonl', 'stats.json', 'spend.json', 'tickets.json']) fs.rmSync(path.join(root, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'noor' }, { name: 'eli', provider: 'codex' }] }))
  hub = new Hub(new FakeRunner(), { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (hub.runner.live.add(a.name), (a.status = 'idle'))
})
afterEach(() => {
  for (const t of ['statsTimer', 'convoTimer', 'spendTimer', 'ticketsTimer', 'usageTimer']) clearTimeout(hub[t])
})
after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 }))

const line = (name, session, cost) => hub.onStatusLine(name, { session_id: session, cost: { total_cost_usd: cost } })
const stats = (name) => hub.snapshot().agents.find((a) => a.name === name).stats

test('what the look back found goes into the stats once, and the live count only adds what comes after', async () => {
  const t = hub.tickets.add({ title: 'Coins reset after level 2' })
  while (t.id < 7) t.id++ // the fixture's #7
  hub.tickets.save()
  const r = await lookBack({ claude: [claude], codex, names: ['noor', 'eli'], since: now - 30 * 864e5, until: now })
  hub.lookingBack = true
  hub.mergeLookBack(r, now)
  near(stats('noor').cost, 4.5)
  assert.equal(stats('eli').tokens, 29000)
  near(hub.tickets.get(7).spent.cost, 3.5)
  assert.ok(hub.spend.lookedBack.at)
  assert.equal(hub.lookingBack, false)
  assert.match(hub.feed.findLast((e) => e.kind === 'event').text, /added up what the clique's work cost before CLIque counted it: \$4\.50 at API prices and 29k Codex tokens over the last 30 days/)
  // the live count: s-noor was counted by the look back, so its next report is a baseline, and only growth counts
  hub.agents.get('noor').run = 'run-1'
  line('noor', 's-noor', 3.9)
  near(stats('noor').cost, 4.5)
  line('noor', 's-noor', 4.4)
  near(stats('noor').cost, 5.0)
})

test('while the look back runs, a session that was already going counts from here on; a new one in full', () => {
  hub.startedAt = Date.now() - 1000
  hub.lookingBack = true
  const noor = hub.agents.get('noor')
  noor.run = 'adopted' // picked up from the terminal host: no launch by this CLIque
  line('noor', 'old', 12)
  line('noor', 'old', 12.5)
  near(stats('noor').cost, 0.5)
  Object.assign(noor, { run: 'fresh', launchedAt: Date.now() }) // started by this CLIque
  line('noor', 'new', 0.3)
  near(stats('noor').cost, 0.8)
})

test("it looks back once: a CLIque that already did doesn't again", () => {
  hub.spend.lookedBack = { at: Date.now() }
  let looked = false
  hub.lookBack = () => (looked = true)
  hub.start('http://127.0.0.1:1')
  clearInterval(hub.stallTimer)
  fs.unwatchFile(CONFIG)
  assert.equal(hub.lookingBack, undefined)
  assert.equal(looked, false)
})

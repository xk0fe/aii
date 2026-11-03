// Codex's usage limits, from its session log: each token count carries the account's rate limits (a primary and a
// secondary window, so many minutes long) and its credits. Reading them (numbers only, the newest that has them), and
// keeping them per provider next to Claude's, with the same heads-ups and routing. Real Hub, fake runner and clock,
// throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-codex-limits-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { codexLimitsFrom } = await import('../core/context.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit() {}
  write() {}
}

const HOUR = 3600000
const LOG = path.join(process.env.CREW_HOME, 'rollout-2026-10-14T12-00-00-0199aaaa.jsonl')
let hub, runner, now
beforeEach(() => {
  mock.timers.reset()
  now = Date.UTC(2026, 9, 14, 12, 0)
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now })
  for (const f of ['usage.json', 'feed.jsonl', 'conversations.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [
    { name: 'ada', area: 'backend api, servers', provider: 'codex' },
    { name: 'june', area: 'backend api, servers' },
  ] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'working'))
})
afterEach(() => {
  mock.timers.reset()
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  for (const t of ['statsTimer', 'convoTimer', 'usageTimer']) clearTimeout(hub[t])
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

// A token count the way Codex writes one. windows: { primary: [pct, minutes, hours until it resets], secondary: … }
const count = (windows, extra = {}) => JSON.stringify({
  timestamp: new Date(now).toISOString(), type: 'event_msg',
  payload: {
    type: 'token_count', info: { model_context_window: 258400, last_token_usage: { total_tokens: 50000 } },
    rate_limits: {
      limit_id: 'codex', limit_name: null, secondary: null, plan_type: 'prolite', rate_limit_reached_type: null,
      credits: { has_credits: true, unlimited: false, balance: '62500.0000000000' },
      ...Object.fromEntries(Object.entries(windows).map(([k, [pct, minutes, hours]]) => [k, { used_percent: pct, window_minutes: minutes, resets_at: (now + hours * HOUR) / 1000 }])),
      ...extra,
    },
  },
})
const log = (...lines) => fs.writeFileSync(LOG, lines.join('\n') + '\n')
const step = (name) => hub.onHook(name, { hook_event_name: 'Stop', transcript_path: LOG, last_assistant_message: 'done' })

test("a Codex log's limits come out as the same windows Claude's do, with its credits", () => {
  log(count({ primary: [5, 10080, 100], secondary: [41, 300, 3] }))
  assert.deepEqual(codexLimitsFrom(LOG), {
    windows: [{ id: 'seven_day', pct: 5, resetsAt: now + 100 * HOUR }, { id: 'five_hour', pct: 41, resetsAt: now + 3 * HOUR }],
    credits: { unlimited: false, balance: 62500 },
  })
  // a window of another length is named by it
  log(count({ primary: [12, 120, 1] }))
  assert.deepEqual(codexLimitsFrom(LOG).windows, [{ id: 'window_120', pct: 12, resetsAt: now + HOUR, label: '2-hour limit' }])
})

test('the newest token count that has limits wins; garbage, other meters and windows that already reset are nothing', () => {
  const older = count({ primary: [7, 10080, 50] })
  const noLimits = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {}, rate_limits: null } })
  log(older, noLimits, '{"type":"event_msg","payload":{"type":"token_count","rate_limits":', 'not json')
  assert.equal(codexLimitsFrom(LOG).windows[0].pct, 7)
  log(count({ primary: [9, 10080, 50] }, { limit_id: 'codex_other' }))
  assert.equal(codexLimitsFrom(LOG), null)
  log(count({ primary: ['9', 10080, 50] }, { credits: null }), count({ primary: [99, 10080, -1] }, { credits: null }))
  assert.equal(codexLimitsFrom(LOG), null)
  assert.equal(codexLimitsFrom(path.join(process.env.CREW_HOME, 'missing.jsonl')), null)
})

test("a Codex agent's step brings its account's limits in, kept per provider next to Claude's", () => {
  log(count({ primary: [92, 10080, 100] }))
  step('ada')
  hub.onStatusLine('june', { context_window: { context_window_size: 200000, used_percentage: 10 }, rate_limits: { five_hour: { used_percentage: 40, resets_at: (now + 2 * HOUR) / 1000 } } })
  const usage = hub.snapshot().usage
  assert.deepEqual({ ...usage.codex, windows: usage.codex.windows.map(({ pace, ...w }) => w) }, { label: 'Codex', at: now, windows: [{ id: 'seven_day', pct: 92, resetsAt: now + 100 * HOUR }], credits: { unlimited: false, balance: 62500 } })
  assert.deepEqual(usage.claude.windows.map((w) => [w.id, w.pct]), [['five_hour', 40]])
  // Codex is the one near its limit: its agents lose ties, Claude's don't
  const agents = hub.snapshot().agents
  assert.equal(agents.find((a) => a.name === 'ada').nearLimit, true)
  assert.equal(agents.find((a) => a.name === 'june').nearLimit, false)
  hub.saveUsage(true)
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.CREW_HOME, 'usage.json'), 'utf8'))
  assert.deepEqual(Object.keys(saved).sort(), ['claude', 'codex'])
})

test("heads-ups say it's Codex, and name a window Codex measures in hours", () => {
  log(count({ primary: [96, 10080, 100], secondary: [81, 120, 1] }))
  step('ada')
  const limits = () => hub.feed.filter((e) => e.kind === 'event' && !/^At this pace/.test(e.text))
  const said = limits().map((e) => e.text)
  assert.equal(said.length, 2)
  assert.match(said[0], /^Codex is at 96% of its weekly limit, resets /)
  assert.match(said[1], /^Codex is at 81% of its 2-hour limit, resets at /)
  // the next step, same windows: nothing again
  mock.timers.tick(6000)
  step('ada')
  assert.equal(limits().length, 2)
})

test('a Codex-run provider without limits in its log (Ollama) has none', () => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'roy', area: 'docs', provider: 'local' }] }))
  hub.loadConfig()
  hub.agents.get('roy').status = 'working'
  log(JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 32000, last_token_usage: { total_tokens: 900 } }, rate_limits: null } }))
  step('roy')
  assert.deepEqual(hub.snapshot().usage, {})
})

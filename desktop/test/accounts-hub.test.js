// Agents on accounts (core/accounts.js), in the hub: an agent's CLI starts pointed at its account's folder, its usage
// limits are that account's (agents on two accounts of one provider don't share a reading), the heads-ups name the
// account, and an agent that changes account takes its conversation along. Real Hub, fake runner, throwaway CLIQUE_HOME
// and CLI folders. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-accounts-hub-'))
process.env.CLIQUE_HOME = path.join(root, 'clique')
process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude')
process.env.CODEX_HOME = path.join(root, 'codex')
process.env.PATH = '/usr/bin:/bin'
for (const dir of [process.env.CLIQUE_HOME, process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME, path.join(root, 'work')]) fs.mkdirSync(dir, { recursive: true })
const { Hub, CONFIG } = await import('../core/hub.js')
const { accountDir } = await import('../core/accounts.js')
const { claudeProject } = await import('../core/sessions.js')
after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 }))

class FakeRunner extends EventEmitter {
  live = new Set()
  started = new Map() // name -> what it was last started with
  running = (n) => this.live.has(n)
  start = (n, opts) => (this.live.add(n), this.started.set(n, opts))
  stop = (n) => this.live.delete(n)
  submit() {}
  write() {}
}

const cwd = path.join(root, 'work')
const config = () => ({
  layout: 2,
  accounts: [{ id: 'claude-work', provider: 'claude', name: 'Work' }, { id: 'codex-two', provider: 'codex', name: 'Second' }],
  agents: [
    { name: 'june', area: 'backend', account: 'claude-work' },
    { name: 'iris', area: 'design' },
    { name: 'ada', area: 'backend', provider: 'codex', account: 'codex-two' },
    { name: 'rex', area: 'ops', provider: 'codex', account: 'claude-work' }, // another provider's account: not his
  ],
  workspaces: [{ id: 'shop', name: 'Shop', folder: cwd, members: { june: {}, iris: {}, ada: {}, rex: {} } }],
})
let hub, runner
beforeEach(async () => {
  // (the hub before this one may still be writing its chat down: wait for it, and try again if a file lands meanwhile)
  await hub?.saving
  fs.rmSync(path.join(process.env.CLIQUE_HOME, 'workspaces'), { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(path.join(process.env.CLIQUE_HOME, 'accounts'), { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(path.join(process.env.CLIQUE_HOME, 'usage.json'), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify(config()))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent', workspace: 'shop' })
  hub.url = 'http://127.0.0.1:1'
})
// A hub's timers put away and its last lines written, so nothing of it runs once its files are gone.
const quiet = async (h) => {
  for (const a of h.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'retryTimer', 'stopTimer']) clearTimeout(a[t])
  for (const t of ['statsTimer', 'convoTimer', 'usageTimer', 'spendTimer', 'readsTimer', 'runtimeTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(h[t])
  clearTimeout(h.ledger.timer)
  await h.saving
}
afterEach(() => quiet(hub))
const agent = (name) => hub.agents.get(name)
const HOUR = 3600000
const line = (windows) => ({
  context_window: { context_window_size: 200000, used_percentage: 10, current_usage: { input_tokens: 20000 } },
  rate_limits: Object.fromEntries(Object.entries(windows).map(([id, [pct, hours]]) => [id, { used_percentage: pct, resets_at: (Date.now() + hours * HOUR) / 1000 }])),
})

test("an agent's CLI starts pointed at its account's folder; one on its provider's own sign-in starts as it always did", () => {
  hub.launch(agent('june'))
  const june = runner.started.get('june')
  assert.equal(june.env.CLAUDE_CONFIG_DIR, accountDir('claude-work'))
  assert.ok(fs.statSync(accountDir('claude-work')).isDirectory(), 'the folder is there before the CLI needs it')
  hub.launch(agent('iris'))
  assert.equal('CLAUDE_CONFIG_DIR' in runner.started.get('iris').env, false, "nothing set: the CLI's own folder")
  // Codex: its folder, and the sign-in kept in it
  hub.launch(agent('ada'))
  const ada = runner.started.get('ada')
  assert.equal(ada.env.CODEX_HOME, accountDir('codex-two'))
  assert.equal(ada.args.join(' ').includes('-c cli_auth_credentials_store="file"'), true)
  // an account of another provider isn't an agent's: its provider's own sign-in
  hub.launch(agent('rex'))
  assert.equal('CODEX_HOME' in runner.started.get('rex').env, false)
  assert.equal(runner.started.get('rex').args.join(' ').includes('cli_auth_credentials_store'), false)
  // the app's state says which account, and whose limits
  const said = Object.fromEntries(hub.snapshot().agents.map((a) => [a.name, [a.account ?? null, a.usage]]))
  assert.deepEqual(said, { june: ['claude-work', 'claude@claude-work'], iris: [null, 'claude'], ada: ['codex-two', 'codex@codex-two'], rex: [null, 'codex'] })
})

test("an account that isn't signed in: its agent doesn't start, and the chat says where to fix it", () => {
  hub.signedIn = (id) => (id === 'claude-work' ? false : undefined)
  hub.launch(agent('june'))
  assert.equal(runner.started.has('june'), false)
  assert.equal(agent('june').status, 'stopped')
  assert.match(hub.feed.at(-1).text, /Claude · Work isn't signed in\. Sign it in under Accounts/)
  hub.launch(agent('iris')) // (nothing is known of the provider's own sign-in: it starts)
  assert.equal(runner.started.has('iris'), true)
})

test("each account has its own limits: two Claude agents on two accounts don't share a reading, and a heads-up names the account", () => {
  for (const name of ['june', 'iris']) (runner.live.add(name), (agent(name).status = 'idle'))
  hub.onStatusLine('june', line({ five_hour: [96, 2], seven_day: [40, 100] }))
  hub.onStatusLine('iris', line({ five_hour: [12, 4] }))
  const usage = hub.snapshot().usage
  assert.deepEqual(Object.keys(usage).sort(), ['claude', 'claude@claude-work'])
  assert.deepEqual([usage['claude@claude-work'].label, usage['claude@claude-work'].windows.map((w) => w.pct)], ['Claude · Work', [96, 40]])
  assert.deepEqual([usage.claude.label, usage.claude.windows.map((w) => w.pct)], ['Claude', [12]])
  const lines = hub.feed.filter((e) => e.limit).map((e) => e.text)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^Claude · Work is at 96% of its 5-hour limit/)
  // near its limit: new work goes round that account's agents, not round the provider's
  const near = Object.fromEntries(hub.snapshot().agents.map((a) => [a.name, a.nearLimit]))
  assert.deepEqual([near.june, near.iris], [true, false])
})

test('changing account restarts an idle agent on the new one, and its conversation goes with it', () => {
  const june = agent('june')
  hub.launch(june)
  const id = june.sessionId
  // its conversation, as Claude Code keeps it in the account's folder: the transcript and a sub-agent's
  const was = claudeProject(cwd, { CLAUDE_CONFIG_DIR: accountDir('claude-work') })
  fs.mkdirSync(path.join(was, id, 'subagents'), { recursive: true })
  fs.writeFileSync(path.join(was, `${id}.jsonl`), '{"type":"user"}\n')
  fs.writeFileSync(path.join(was, id, 'subagents', 'agent-1.jsonl'), '{}\n')
  hub.onHook('june', { hook_event_name: 'UserPromptSubmit', session_id: id, transcript_path: path.join(was, `${id}.jsonl`), prompt: 'go' })
  hub.onHook('june', { hook_event_name: 'Stop', session_id: id })
  assert.equal(hub.sessions.june, id)
  assert.equal(hub.convos.june.account, 'claude-work', 'where its conversation lives is kept with it')
  // you give it the provider's own sign-in
  runner.started.clear()
  hub.update('june', { account: '' })
  const now = runner.started.get('june')
  assert.ok(now, 'it restarted')
  assert.equal('CLAUDE_CONFIG_DIR' in now.env, false)
  assert.deepEqual(now.args.slice(now.args.indexOf('--resume'), now.args.indexOf('--resume') + 2), ['--resume', id], 'picking the same conversation up')
  const there = claudeProject(cwd, process.env)
  assert.equal(fs.readFileSync(path.join(there, `${id}.jsonl`), 'utf8'), '{"type":"user"}\n')
  assert.ok(fs.existsSync(path.join(there, id, 'subagents', 'agent-1.jsonl')), "and its sub-agents' transcripts")
  assert.equal(fs.existsSync(path.join(was, `${id}.jsonl`)), false, 'moved, not copied: one account, one log')
  assert.equal(hub.convos.june.account, undefined)
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'june').usage, 'claude')
  // and back to Work: carried again
  hub.onHook('june', { hook_event_name: 'UserPromptSubmit', session_id: id, transcript_path: path.join(there, `${id}.jsonl`), prompt: 'go' })
  hub.onHook('june', { hook_event_name: 'Stop', session_id: id })
  hub.update('june', { account: 'claude-work' })
  assert.ok(fs.existsSync(path.join(was, `${id}.jsonl`)))
  assert.equal(hub.convos.june.account, 'claude-work')
})

test("a conversation that can't be found stays behind: the agent starts a new one, and the chat says so", () => {
  const june = agent('june')
  hub.launch(june)
  const id = june.sessionId
  hub.onHook('june', { hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'go' }) // (its log was never written: nothing to carry)
  hub.onHook('june', { hook_event_name: 'Stop', session_id: id })
  runner.started.clear()
  hub.update('june', { account: '' })
  const now = runner.started.get('june')
  assert.equal(now.args.includes('--resume'), false)
  assert.equal(now.args.includes('--session-id'), true)
  assert.match(hub.feed.findLast((e) => e.from === 'june' && e.fresh).text, /starts a new conversation on Claude: the one it had stayed behind/)
})

test('an agent at work changes account when its turn is over', () => {
  const june = agent('june')
  hub.launch(june)
  june.status = 'working'
  runner.started.clear()
  hub.update('june', { account: '' })
  assert.equal(runner.started.has('june'), false, 'not in the middle of a turn')
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'june').pending, true)
})

test("a conversation started with /clear is the account's too: after CLIque restarts, the agent picks it up there", async () => {
  const june = agent('june')
  hub.launch(june)
  const first = june.sessionId
  const project = claudeProject(cwd, { CLAUDE_CONFIG_DIR: accountDir('claude-work') })
  hub.onHook('june', { hook_event_name: 'UserPromptSubmit', session_id: first, prompt: 'go' })
  hub.onHook('june', { hook_event_name: 'Stop', session_id: first })
  // /clear in its terminal: Claude Code starts another session, in the same folder
  const second = '22222222-2222-4222-8222-222222222222'
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'clear', session_id: second })
  assert.equal(hub.convos.june.account, 'claude-work', 'the new conversation lives where its CLI runs')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, `${second}.jsonl`), '{"type":"user"}\n')
  hub.onHook('june', { hook_event_name: 'UserPromptSubmit', session_id: second, prompt: 'the long task', transcript_path: path.join(project, `${second}.jsonl`) })
  hub.onHook('june', { hook_event_name: 'Stop', session_id: second })
  hub.saveConvos(true)
  await hub.saving
  // CLIque starts again: a new hub from what was saved
  await quiet(hub)
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent', workspace: 'shop' })
  hub.url = 'http://127.0.0.1:1'
  hub.launch(agent('june'))
  const args = runner.started.get('june').args
  assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', second])
  assert.ok(fs.existsSync(path.join(project, `${second}.jsonl`)), 'nothing was moved: it was where it should be')
})

test("a Codex agent's conversation goes along too: its session log, under the same day, in the other account's folder", () => {
  const ada = agent('ada')
  hub.launch(ada)
  const id = '0199c2aa-1b2c-7d3e-8f90-a1b2c3d4e5f6'
  const rel = path.join('2026', '11', '16', `rollout-2026-11-16T10-00-00-${id}.jsonl`)
  const was = path.join(accountDir('codex-two'), 'sessions', rel)
  fs.mkdirSync(path.dirname(was), { recursive: true })
  fs.writeFileSync(was, '{"type":"session_meta"}\n')
  hub.onHook('ada', { hook_event_name: 'UserPromptSubmit', session_id: id, transcript_path: was, prompt: 'go' })
  hub.onHook('ada', { hook_event_name: 'Stop', session_id: id })
  assert.equal(hub.convos.ada.account, 'codex-two')
  runner.started.clear()
  hub.update('ada', { account: '' })
  const now = runner.started.get('ada')
  assert.equal('CODEX_HOME' in now.env, false)
  assert.deepEqual(now.args.slice(0, 2), ['resume', id], 'Codex resumes it')
  assert.equal(fs.readFileSync(path.join(process.env.CODEX_HOME, 'sessions', rel), 'utf8'), '{"type":"session_meta"}\n')
  assert.equal(fs.existsSync(was), false)
})

test('Q, the agent every workspace comes with, can be given another account too', async () => {
  process.env.CLIQUE_SYSTEM_AGENT = 'on'
  try {
    const withQ = new Hub(new FakeRunner(), { bin: '/nonexistent', workspace: 'shop' })
    const q = withQ.systemAgent()
    assert.ok(q, 'Q is here')
    withQ.update(q.name, { provider: 'claude', account: 'claude-work' })
    assert.equal(withQ.accountOf(withQ.systemAgent())?.id, 'claude-work')
    assert.equal(withQ.snapshot().agents.find((a) => a.system).usage, 'claude@claude-work')
    await quiet(withQ)
  } finally {
    process.env.CLIQUE_SYSTEM_AGENT = 'off'
  }
})

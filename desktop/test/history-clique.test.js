// The Usage view's data, the way the app asks for it: Clique.usageHistory reads Claude Code's and Codex's logs (and the
// folder of a provider of your own), names the clique's agents in every workspace, and puts Claude and Codex first.
// Fixture logs in a throwaway home: the real ~/.claude and ~/.codex are never read. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-history-clique-'))
process.env.CLIQUE_HOME = path.join(home, 'clique')
process.env.CLAUDE_CONFIG_DIR = path.join(home, 'claude')
process.env.CODEX_HOME = path.join(home, 'codex')
process.env.PATH = '/usr/bin:/bin' // no codex to discover
fs.mkdirSync(process.env.CLIQUE_HOME, { recursive: true })
const { CONFIG } = await import('../core/hub.js')
const { Clique, logRoots } = await import('../core/clique.js')

const house = path.join(home, 'house')
fs.writeFileSync(CONFIG, JSON.stringify({
  agents: [{ name: 'iris', area: 'design' }, { name: 'rex', area: 'ops', provider: 'codex' }],
  workspaces: [{ id: 'shop', name: 'Shop', members: { iris: {}, rex: {} }, agents: [{ name: 'june', area: 'docs' }] }],
  providers: { house: { label: 'House', cli: 'claude', env: { CLAUDE_CONFIG_DIR: house }, models: ['house-1'] } },
}))
const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
Object.assign(clique.runner, { running: () => false, quietFor: () => Infinity, submit() {}, write() {} })
after(() => {
  for (const hub of clique.hubs.values()) for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(hub[t])
  for (const hub of clique.hubs.values()) clearTimeout(hub.ledger.timer)
  clearTimeout(clique.changeTimer)
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10 })
})

const DAY = '2026-11-10'
const at = new Date(`${DAY}T12:00:00`).toISOString()
const lines = (...rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join('')
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const reply = (id, input, model = 'claude-opus-5-5') => ({ type: 'assistant', timestamp: at, requestId: `r${id}`, message: { id: `m${id}`, model, usage: { input_tokens: input, output_tokens: 0 } } })
const prompt = () => ({ type: 'user', timestamp: at, message: { role: 'user', content: 'go' } })
const named = (name) => ({ type: 'agent-name', agentName: name })

test('the folders it reads: Claude Code\'s and Codex\'s, where the environment says they are, and a provider\'s own', () => {
  assert.deepEqual(logRoots({ house: { id: 'house', cli: 'claude', env: { CLAUDE_CONFIG_DIR: house } }, same: { id: 'same', cli: 'codex', env: { CODEX_HOME: process.env.CODEX_HOME } } }), [
    { dir: path.join(home, 'claude', 'projects'), cli: 'claude' },
    { dir: path.join(home, 'codex', 'sessions'), cli: 'codex' },
    { dir: path.join(house, 'projects'), cli: 'claude', provider: 'house' },
  ])
  assert.deepEqual(logRoots({}, {}).map((r) => r.dir), [path.join(os.homedir(), '.claude', 'projects'), path.join(os.homedir(), '.codex', 'sessions')])
  // a provider written by hand with an env that isn't one: none
  assert.equal(logRoots({ odd: { id: 'odd', cli: 'claude', env: null }, text: { id: 'text', env: 'CLAUDE_CONFIG_DIR=/x' }, none: null }).length, 2)
})

test("the app's history: read in the background, Claude and Codex first, the clique by name wherever its agents live", async () => {
  write(path.join(home, 'claude', 'projects', 'p', 'a.jsonl'), lines(named('iris'), prompt(), reply(1, 100)))
  write(path.join(home, 'claude', 'projects', 'p', 'b.jsonl'), lines(named('june.2'), prompt(), reply(2, 30))) // a workspace's own agent, a clone of it
  write(path.join(home, 'claude', 'projects', 'p', 'c.jsonl'), lines(prompt(), reply(3, 7))) // a session you ran yourself
  write(path.join(home, 'codex', 'sessions', '2026', '11', '10', 'rollout-x.jsonl'), lines(
    { timestamp: at, type: 'session_meta', payload: { model_provider: 'openai' } },
    { timestamp: at, type: 'event_msg', payload: { type: 'task_started' } },
    { timestamp: at, type: 'turn_context', payload: { model: 'gpt-6-luna', collaboration_mode: { settings: { developer_instructions: 'You are "rex", one of several AI agents working side by side' } } } },
    { timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 5, total_tokens: 55 } } } },
  ))
  write(path.join(house, 'projects', 'p', 'h.jsonl'), lines(prompt(), reply(4, 9, 'claude-opus-5-5'))) // its folder says whose it is, not its model

  const first = clique.usageHistory()
  assert.deepEqual(first.providers, [])
  assert.ok(first.reading, 'the logs are being read')
  await clique.history.running
  const then = clique.usageHistory()
  assert.equal(then.reading, null)
  assert.equal(then.first, DAY)
  assert.deepEqual(then.providers.map((p) => [p.id, p.label]), [['claude', 'Claude'], ['codex', 'Codex'], ['house', 'House']])
  const [claude, codex, own] = then.providers.map((p) => p.days[DAY])
  assert.deepEqual(claude.who, { iris: 100, june: 30, '': 7 })
  assert.deepEqual([claude.tokens, claude.messages, claude.sessions], [137, 3, 3])
  assert.deepEqual(codex.who, { rex: 55 })
  assert.deepEqual([codex.tokens, codex.messages], [55, 1])
  assert.deepEqual([own.tokens, own.who], [9, { '': 9 }])
  assert.ok(fs.existsSync(path.join(process.env.CLIQUE_HOME, 'history.json')), 'kept in CLIque\'s folder')
  assert.equal(clique.history.running, null, 'asking again so soon reads nothing')
})

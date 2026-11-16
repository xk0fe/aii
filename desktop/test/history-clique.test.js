// The Usage view's data, the way the app asks for it: Clique.usageHistory reads Claude Code's and Codex's logs (and the
// folder of a provider of your own) and says whose each row is: the workspace its session ran in (written down as its
// agent took a prompt, so a shared agent's work in two workspaces is told apart), the agent, or what ran outside CLIque.
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
const shopDir = path.join(home, 'code', 'shop')
const docsDir = path.join(home, 'code', 'docs')
for (const dir of [shopDir, docsDir]) fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(CONFIG, JSON.stringify({
  layout: 2,
  agents: [{ name: 'iris', area: 'design', avatar: { color: 'pink' } }, { name: 'rex', area: 'ops', provider: 'codex' }],
  workspaces: [
    { id: 'shop', name: 'Shop', color: 'teal', icon: '🛒', folder: shopDir, members: { iris: {}, rex: {} }, agents: [{ name: 'june', area: 'docs' }] },
    { id: 'docs', name: 'Docs', folder: docsDir, members: { iris: {} } },
  ],
  workspacesGone: { 'old lab': 'lab' },
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
const reply = (id, input, model = 'claude-opus-5-5', cwd) => ({ type: 'assistant', timestamp: at, requestId: `r${id}`, ...(cwd && { cwd }), message: { id: `m${id}`, model, usage: { input_tokens: input, output_tokens: 0 } } })
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

const { COLS } = await import('../core/history.js')
// the rows as objects, and a few of each one's values
const rowsOf = (c) => c.rows.map((r) => Object.fromEntries(c.cols.map((name, i) => [name, r[i]])))
const pick = (rows, ...names) => rows.map((r) => Object.fromEntries(names.map((n) => [n, r[n]]))).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))
const me = () => clique.usageHistory().computers[0]

test("the app's history: read in the background, each row with its workspace, its agent and its provider", async () => {
  // iris in Shop and in Docs: the same name, told apart by where each workspace has her work (before sessions were written down)
  write(path.join(home, 'claude', 'projects', 'p', 'a.jsonl'), lines(named('iris'), prompt(), reply(1, 100, undefined, shopDir)))
  write(path.join(home, 'claude', 'projects', 'p', 'a2.jsonl'), lines(named('iris'), prompt(), reply(11, 40, undefined, docsDir)))
  write(path.join(home, 'claude', 'projects', 'p', 'a3.jsonl'), lines(named('iris'), prompt(), reply(12, 3, undefined, '/somewhere/else'))) // in neither one's folder
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
  assert.deepEqual(first.computers.map((c) => [c.slug, c.name, c.here, c.rows.length]), [['studio', 'Studio', true, 0]])
  assert.ok(first.computers[0].reading, 'the logs are being read')
  await clique.history.running
  const then = clique.usageHistory()
  const mine = then.computers[0]
  assert.equal(mine.reading, null)
  assert.equal(mine.first, DAY)
  assert.deepEqual(mine.cols, COLS)
  assert.deepEqual(mine.providers, { claude: 'Claude', codex: 'Codex', house: 'House' })
  assert.deepEqual(pick(rowsOf(mine), 'ws', 'who', 'provider', 'tokens', 'messages', 'sessions'), pick([
    { ws: 'studio:shop', who: 'iris', provider: 'claude', tokens: 100, messages: 1, sessions: 1 },
    { ws: 'studio:docs', who: 'iris', provider: 'claude', tokens: 40, messages: 1, sessions: 1 },
    { ws: '?', who: 'iris', provider: 'claude', tokens: 3, messages: 1, sessions: 1 },
    { ws: 'studio:shop', who: 'june', provider: 'claude', tokens: 30, messages: 1, sessions: 1 },
    { ws: '', who: '', provider: 'claude', tokens: 7, messages: 1, sessions: 1 },
    { ws: 'studio:shop', who: 'rex', provider: 'codex', tokens: 55, messages: 1, sessions: 1 },
    { ws: '', who: '', provider: 'house', tokens: 9, messages: 1, sessions: 1 },
  ], 'ws', 'who', 'provider', 'tokens', 'messages', 'sessions'))
  // the workspaces the rows name: this computer's, each with its look and its id here; the one on screen
  assert.deepEqual(then.spaces, { 'studio:shop': { name: 'Shop', color: 'teal', icon: '🛒', id: 'shop' }, 'studio:docs': { name: 'Docs', color: null, icon: null, id: 'docs' } })
  assert.equal(then.here, 'studio:shop')
  assert.deepEqual(mine.faces, { 'studio:shop': { iris: { color: 'pink' } }, 'studio:docs': { iris: { color: 'pink' } } })
  assert.ok(fs.existsSync(path.join(process.env.CLIQUE_HOME, 'history.json')), 'kept in CLIque\'s folder')
  assert.equal(clique.history.running, null, 'asking again so soon reads nothing')
})

test('a session is written down by the workspace whose agent took its prompt: from then on its log is that workspace\'s, whatever the folder', async () => {
  const docs = clique.hubs.get('docs')
  const shop = clique.hubs.get('shop')
  // iris takes a prompt in Docs (session a3: the one no folder could place), and her clone one in Shop
  docs.onHook('iris', { hook_event_name: 'UserPromptSubmit', session_id: 'a3', prompt: 'go' })
  assert.deepEqual(JSON.parse(fs.readFileSync(docs.at('ran.json'), 'utf8')), { a3: 'iris' })
  assert.deepEqual(docs.sessionsRun().a3, ['docs', 'iris'])
  // a sub-agent's hook isn't a conversation of its own, and a hook with no session says nothing
  docs.onHook('iris', { hook_event_name: 'UserPromptSubmit', session_id: 'sub-1', agent_id: 'x', prompt: 'go' })
  docs.onHook('iris', { hook_event_name: 'UserPromptSubmit', prompt: 'go' })
  assert.deepEqual(Object.keys(docs.ran), ['a3'])
  assert.deepEqual(pick(rowsOf(me()).filter((r) => r.tokens === 3), 'ws', 'who'), [{ ws: 'studio:docs', who: 'iris' }])
  // the session each agent has now, and the ones whose spend was counted here, count too (from before this was written down)
  shop.sessions.june = 'b'
  shop.spend.sessions.c = { cost: 1, at: Date.now() }
  shop.spend.sessions.a2 = { baseline: true, at: Date.now() } // only read about, by name: any workspace's
  assert.deepEqual(shop.sessionsRun(), { c: ['shop'], b: ['shop', 'june'] })
  assert.deepEqual(pick(rowsOf(me()).filter((r) => r.tokens === 7), 'ws', 'who'), [{ ws: 'studio:shop', who: '' }]) // its log names nobody
  delete shop.sessions.june
  delete shop.spend.sessions.c
  delete shop.spend.sessions.a2
})

test('an agent renamed keeps what it used, under its new name', () => {
  const docs = clique.hubs.get('docs')
  docs.renameAgent('iris', 'ivy')
  assert.deepEqual(docs.ran, { a3: 'ivy' })
  assert.deepEqual(JSON.parse(fs.readFileSync(docs.at('ran.json'), 'utf8')), { a3: 'ivy' })
  docs.renameAgent('ivy', 'iris')
})

test("a workspace that's been removed still has what its agents used, under the name it had", () => {
  // Lab was removed: its folder is still in CLIque's, with the sessions it wrote down
  const lab = path.join(process.env.CLIQUE_HOME, 'workspaces', 'lab')
  fs.mkdirSync(lab, { recursive: true })
  fs.writeFileSync(path.join(lab, 'ran.json'), JSON.stringify({ c: 'pip' }))
  clique.leftSessions = null // (read once a minute)
  const then = clique.usageHistory()
  assert.deepEqual(pick(rowsOf(then.computers[0]).filter((r) => r.tokens === 7), 'ws', 'who'), [{ ws: 'studio:lab', who: 'pip' }])
  assert.deepEqual(then.spaces['studio:lab'], { name: 'old lab', gone: true })
  fs.rmSync(lab, { recursive: true })
  clique.leftSessions = null
})

test('what a linked computer asks for: this computer\'s rows and workspaces, and nothing of the computers linked to it', () => {
  const said = clique.serve('usageHistory', [], null, { name: 'Laptop' })
  assert.deepEqual(Object.keys(said).sort(), ['at', 'cols', 'faces', 'first', 'providers', 'reading', 'rows', 'spaces'])
  assert.equal(said.rows.length, me().rows.length)
  assert.deepEqual(Object.keys(said.spaces), ['studio:shop', 'studio:docs'])
})

// Workspaces: what config.json says each one is made of, a hub per workspace with its own chat, notes, tasks and
// conversations, shared agents edited from any of them, and agents' requests reaching their own workspace's hub.
// Real Hubs on one config and one fake runner, a throwaway CLIQUE_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIN } from './helpers/platform.mjs'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-workspaces-'))
// no codex to discover once a hub starts; on Windows the agents' CLIs are found on PATH before they start, and the
// stand-in codex there (test/helpers/clis.mjs) can't run, which is as good
if (process.platform !== 'win32') process.env.PATH = '/usr/bin:/bin'
const HOME = process.env.CLIQUE_HOME
const { Hub, CONFIG, openConfig, fileKey, filePath } = await import('../core/hub.js')
const { ROOT, dirOf, space, workspacesIn, forget, renameShared, sharedNames, settle } = await import('../core/workspaces.js')
const { Scoped } = await import('../core/runner.js')
const { serve } = await import('../core/server.js')
const { adapters } = await import('../core/adapters.js')
const { toolsDir } = await import('../core/launch.js')
const BIN = fileURLToPath(new URL('../bin', import.meta.url))

class FakeRunner extends EventEmitter {
  live = new Map() // name -> how it was started
  typed = []
  running = (n) => this.live.has(n)
  start = (n, opts) => this.live.set(n, opts)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
}

// folders to work in
const FOLDERS = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-workspaces-folders-'))
const [OWN, API, APP] = ['own', 'api', 'app'].map((d) => path.join(FOLDERS, d))
for (const d of [OWN, API, APP]) fs.mkdirSync(d)
const storefront = () => ({
  id: 'storefront', name: 'Storefront', folder: API,
  members: { june: {}, ada: { folder: APP } },
  agents: [{ name: 'milo', area: 'docs' }],
  triage: 'june',
})
const roster = () => [{ name: 'june', area: 'backend', cwd: OWN }, { name: 'ada', area: 'app' }, { name: 'iris', area: 'design' }]
// another workspace, with no folder: every shared agent in it, june in its own folder, ada off
const home_ = () => ({ id: ROOT, name: 'Home', members: { june: { folder: OWN }, ada: { off: true }, iris: {} } })

let runner, config, hubs, home, ws
// A CLIque's hubs on config.json as `raw` says, picking up what the workspaces kept from before.
function clique(raw = { layout: 2, autopilot: true, agents: roster(), workspaces: [storefront(), home_()] }) {
  fs.writeFileSync(CONFIG, JSON.stringify(raw))
  runner = new FakeRunner()
  config = openConfig()
  config.load()
  hubs = new Map()
  const locks = { files: new Map(), held: new Map(), waits: [] } // as CLIque shares them
  for (const id of workspacesIn(config.data).map((w) => w.id)) {
    const hub = new Hub(new Scoped(runner, id), { bin: BIN, workspace: id, config, token: 'tok', locks })
    hub.others = () => [...hubs.values()].filter((h) => h !== hub)
    hub.hubOf = (ws) => hubs.get(ws)
    hubs.set(id, hub)
  }
  home = hubs.get(ROOT)
  ws = hubs.get('storefront')
}
const saved = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
beforeEach(() => {
  for (const dir of [HOME, dirOf(HOME, 'storefront')]) for (const f of ['feed.jsonl', 'board.md', 'tickets.json', 'sessions.json', 'conversations.json', 'stats.json', 'spend.json']) fs.rmSync(path.join(dir, f), { force: true })
  clique()
})
afterEach(() => {
  for (const h of hubs.values()) {
    for (const a of h.agents.values()) for (const t of ['ack', 'timer', 'readyTimer']) clearTimeout(a[t])
    for (const t of ['statsTimer', 'convoTimer', 'runtimeTimer', 'readsTimer']) clearTimeout(h[t])
    h.dispose()
  }
  fs.unwatchFile(CONFIG)
})
after(() => {
  fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(FOLDERS, { recursive: true, force: true, maxRetries: 10 })
})

// ---- what config.json says ------------------------------------------------------------------------------

test("config.json as an older CLIque left it: its one workspace becomes an entry like any other, its agents where they worked", () => {
  const old = {
    autopilot: false, triage: 'iris', name: 'Studio', icon: '🏡', parked: true, autofix: true, channels: [{ id: 'review', name: 'review' }], channelsGone: ['old'],
    agents: [{ name: 'june', area: 'backend', cwd: OWN }, { name: 'ada', area: 'app', off: true }, { name: 'iris', area: 'design' }],
    workspaces: [{ ...storefront(), color: 'blue' }],
  }
  settle(old)
  const [own, other] = old.workspaces
  assert.equal(other.id, 'storefront')
  assert.deepEqual(own, {
    id: ROOT, name: 'Studio', color: 'sky', members: { june: { folder: OWN }, ada: { off: true }, iris: {} }, icon: '🏡', parked: true,
    channels: [{ id: 'review', name: 'review' }], channelsGone: ['old'], triage: 'iris', autofix: true,
  }, 'a color no other workspace has, so it looks like one of them')
  for (const k of ['name', 'icon', 'parked', 'triage', 'autofix', 'channels', 'channelsGone']) assert.equal(old[k], undefined, k)
  assert.equal(old.agents[1].off, undefined, "whether it's on is the workspace's now")
  assert.equal(old.agents[0].cwd, undefined, "and where it works: clearing it there doesn't bring an old folder back")
  const s = space(old, ROOT)
  assert.deepEqual(s.agents.map((a) => [a.name, a.cwd, Boolean(a.off), a.shared]), [['june', OWN, false, true], ['ada', undefined, true, true], ['iris', undefined, false, true]])
  assert.equal(s.autopilot, false, 'its autopilot, as before')
  assert.equal(s.triage, 'iris')
  assert.equal(dirOf(HOME, ROOT), HOME, 'its files stay where they were')
  // once: read again, or removed, it doesn't come back
  old.workspaces = [other]
  settle(old)
  assert.deepEqual(old.workspaces.map((w) => w.id), ['storefront'])
})

test("converting keeps where a shared agent works everywhere: in a workspace with no folder its own folder was where it worked", () => {
  const old = {
    agents: [{ name: 'june', cwd: OWN }, { name: 'ada', cwd: OWN }],
    workspaces: [
      { id: 'bare', members: { june: {}, ada: { folder: APP, off: true } } },
      { id: 'folded', folder: API, members: { june: {} } },
    ],
  }
  const before = (id) => space(structuredClone(old), id).agents.map((a) => [a.name, a.cwd, Boolean(a.off)])
  const was = { bare: before('bare'), folded: before('folded') }
  settle(old)
  for (const id of ['bare', 'folded']) assert.deepEqual(space(old, id).agents.map((a) => [a.name, a.cwd, Boolean(a.off)]), was[id], id)
  assert.deepEqual(old.workspaces[1].members, { june: { folder: OWN }, ada: { folder: APP, off: true } })
  assert.deepEqual(old.workspaces[2].members, { june: {} }, 'its folder decides there')
  space(old, ROOT).set('june', 'cwd', undefined)
  assert.equal(space(old, ROOT).agents.find((a) => a.name === 'june').cwd, undefined, 'cleared: the home folder')
})

test('a hand-edited config.json that makes no sense: CLIque still starts', async () => {
  const c = await cliqueApp({ agents: { june: {} }, workspaces: 'nope' })
  try {
    assert.deepEqual(c.snapshot().roster, [])
    assert.equal(c.screen, null)
  } finally {
    quit(c)
  }
})

test('a new install, or one with nothing yet, has no workspace: you make the first', () => {
  const fresh = { agents: [], autopilot: true }
  settle(fresh)
  assert.deepEqual(fresh.workspaces, undefined)
  assert.equal(fresh.layout, 2)
  // an older one with no agents left can still have a chat in CLIQUE_HOME
  const chat = { agents: [] }
  settle(chat, { hadFiles: true })
  assert.deepEqual(chat.workspaces.map((w) => [w.id, w.name]), [[ROOT, 'Home']])
})

test("another workspace: its members and its own agents, each in the most specific folder there is", () => {
  const s = space({ autopilot: false, agents: roster(), workspaces: [storefront()] }, 'storefront')
  assert.deepEqual(s.agents.map((a) => [a.name, a.cwd, Boolean(a.off), a.shared]), [
    ['june', API, false, true], // the workspace's folder, over its own
    ['ada', APP, false, true], // its folder here, over the workspace's
    ['milo', API, false, false], // the workspace's own agent, in the workspace's folder
  ])
  assert.equal(s.name, 'Storefront')
  assert.equal(s.autopilot, false, 'autopilot as config.json says for all until the workspace says otherwise')
  assert.equal(s.triage, 'june')
  assert.equal(dirOf(HOME, 'storefront'), path.join(HOME, 'workspaces', 'storefront'))
  const bare = space({ agents: roster(), workspaces: [{ id: 'side', members: { june: {}, iris: {} } }] }, 'side')
  assert.deepEqual(bare.agents.map((a) => a.cwd), [OWN, undefined], 'no folder anywhere but its own: its own, else home')
})

test('workspace ids that could not name a folder, or name one twice, are left out; so is an own agent with a taken name', () => {
  const config = { agents: roster(), workspaces: [{ id: 'storefront' }, { id: 'storefront' }, { id: '../x' }, { id: 'Big' }, null, { id: 'ok-2' }] }
  assert.deepEqual(workspacesIn(config).map((w) => w.id), ['storefront', 'ok-2'])
  const s = space({ agents: roster(), workspaces: [{ id: 'w', members: { iris: {} }, agents: [{ name: 'iris' }, { name: 'milo' }, { name: 'milo' }] }] }, 'w')
  assert.deepEqual(s.agents.map((a) => [a.name, a.shared]), [['iris', true], ['milo', false]])
  assert.equal(space(config, 'nope'), null)
})

test("where it works and whether it's on are the workspace's; who it is is the agent's", () => {
  const config = { agents: roster(), workspaces: [storefront()] }
  const s = space(config, 'storefront')
  s.set('june', 'cwd', '~/code/api-v2')
  s.set('june', 'off', true)
  s.set('june', 'model', 'opus')
  s.set('milo', 'cwd', '~/docs')
  s.autopilot = false
  s.triage = 'milo'
  assert.deepEqual(config.workspaces[0].members.june, { folder: '~/code/api-v2', off: true })
  assert.equal(config.agents[0].cwd, OWN, 'its own folder stays')
  assert.equal(config.agents[0].off, undefined)
  assert.equal(config.agents[0].model, 'opus', 'the same agent everywhere')
  assert.equal(config.workspaces[0].agents[0].cwd, '~/docs')
  assert.equal(config.workspaces[0].autopilot, false)
  assert.equal(config.autopilot, undefined, 'only this workspace')
  assert.equal(config.workspaces[0].triage, 'milo')
})

test('a shared agent renamed or taken off the roster: every workspace it is in follows', () => {
  const config = { agents: roster(), workspaces: [storefront(), { id: 'side', members: { iris: {} } }] }
  renameShared(config, 'june', 'jo')
  assert.equal(config.agents[0].name, 'jo')
  assert.deepEqual(Object.keys(config.workspaces[0].members), ['jo', 'ada'], 'in the same place')
  assert.equal(config.workspaces[0].triage, 'jo')
  assert.deepEqual([...sharedNames(config, 'jo')].sort(), ['ada', 'iris', 'jo', 'milo'], "names it can't take: shared ones, and the own agents of a workspace it's in")
  assert.deepEqual([...sharedNames(config, 'iris')].sort(), ['ada', 'iris', 'jo'])
  forget(config, 'ada')
  assert.deepEqual(config.agents.map((a) => a.name), ['jo', 'iris'])
  assert.deepEqual(Object.keys(config.workspaces[0].members), ['jo'])
})

// ---- a hub per workspace --------------------------------------------------------------------------------

test("each workspace's chat, notes, tasks and conversations are its own, in its own folder", () => {
  home.note('iris', 'the default board')
  ws.note('june', 'storefront uses pnpm')
  home.tickets.add({ title: 'fix the header', by: 'you' })
  ws.tickets.add({ title: 'rate limits', by: 'you' })
  home.saveSession('june', 'sess-default')
  ws.saveSession('june', 'sess-storefront')
  assert.match(home.board(), /the default board/)
  assert.doesNotMatch(home.board(), /pnpm/)
  assert.match(ws.board(), /storefront uses pnpm/)
  assert.doesNotMatch(ws.board(), /default board/)
  assert.deepEqual(home.tickets.all.map((t) => t.title), ['fix the header'])
  assert.deepEqual(ws.tickets.all.map((t) => t.title), ['rate limits'])
  assert.ok(home.feed.every((e) => e.text !== 'storefront uses pnpm'))
  // on disk: the default's where they always were, storefront's in its folder
  const shopDir = path.join(HOME, 'workspaces', 'storefront')
  assert.match(fs.readFileSync(path.join(HOME, 'board.md'), 'utf8'), /default board/)
  assert.match(fs.readFileSync(path.join(shopDir, 'board.md'), 'utf8'), /pnpm/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(HOME, 'sessions.json'), 'utf8')).june, 'sess-default')
  assert.equal(JSON.parse(fs.readFileSync(path.join(shopDir, 'sessions.json'), 'utf8')).june, 'sess-storefront')
  // and it all comes back
  clique(saved())
  assert.equal(home.sessions.june, 'sess-default')
  assert.equal(ws.sessions.june, 'sess-storefront')
  assert.deepEqual(ws.tickets.all.map((t) => t.title), ['rate limits'])
})

test('each workspace counts what its work cost, in its own folder', () => {
  ws.onStatusLine('june', { session_id: 'sess-storefront', cost: { total_cost_usd: 2, total_lines_added: 0, total_lines_removed: 0, total_api_duration_ms: 0 } })
  home.onStatusLine('june', { session_id: 'sess-default', cost: { total_cost_usd: 0.5, total_lines_added: 0, total_lines_removed: 0, total_api_duration_ms: 0 } })
  assert.equal(ws.spendNow().today, 2)
  assert.equal(home.spendNow().today, 0.5)
  ws.saveSpend(true)
  home.saveSpend(true)
  const sessions = (dir) => Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'spend.json'), 'utf8')).sessions)
  assert.deepEqual(sessions(dirOf(HOME, 'storefront')), ['sess-storefront'])
  assert.deepEqual(sessions(HOME), ['sess-default'])
})

test("agents start where they work in their workspace, and say which workspace they're in", (t) => {
  process.env.CLIQUE_WORKSPACE = 'storefront' // CLIque itself started from a storefront agent's terminal
  t.after(() => delete process.env.CLIQUE_WORKSPACE)
  home.start('http://127.0.0.1:1')
  ws.start('http://127.0.0.1:1')
  assert.equal(runner.live.size, 0, 'nobody starts with the app')
  for (const n of ['iris', 'june']) home.restart(n)
  for (const n of ['ada', 'june', 'milo']) ws.restart(n)
  assert.deepEqual([...runner.live.keys()].sort(), ['iris', 'june', 'storefront/ada', 'storefront/june', 'storefront/milo'])
  const at = (n) => runner.live.get(n)
  assert.equal(at('june').cwd, OWN)
  assert.equal(at('storefront/june').cwd, API)
  assert.equal(at('storefront/ada').cwd, APP)
  assert.equal(at('june').env.CLIQUE_WORKSPACE, '', "the default: as agents started before workspaces, whatever CLIque's own is")
  assert.equal(at('storefront/june').env.CLIQUE_WORKSPACE, 'storefront')
  assert.equal(at('storefront/milo').env.CLIQUE_GROUPS.startsWith(path.join(HOME, 'workspaces', 'storefront', 'run', 'groups') + path.sep), true)
  assert.equal(at('june').env.CLIQUE_AGENT, 'june')
  assert.equal(at('storefront/june').env.CLIQUE_AGENT, 'june', 'its name, without the workspace')
})

test('a parked workspace starts nothing, and its terminals are its own', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-ws-folder-'))
  clique({ agents: [{ name: 'june', area: 'backend', cwd: tmp }], workspaces: [{ id: 'storefront', folder: tmp, members: { june: {} }, parked: true }] })
  ws.start('http://127.0.0.1:1')
  assert.equal(runner.live.size, 0)
  assert.throws(() => ws.restart('june'), /asleep/)
  home.start('http://127.0.0.1:1')
  home.restart('june')
  assert.deepEqual([...runner.live.keys()], ['june'])
  runner.live.set('storefront/june', {})
  ws.agents.get('june').status = 'idle'
  const seen = []
  ws.runner.on('exit', (name) => seen.push(['storefront', name]))
  home.runner.on('exit', (name) => seen.push(['default', name]))
  runner.emit('exit', 'storefront/june', 0, 10)
  runner.emit('exit', 'june', 0, 10)
  assert.deepEqual(seen, [['storefront', 'june'], ['default', 'june']])
  const listening = runner.listenerCount('exit')
  ws.dispose()
  assert.equal(runner.listenerCount('exit'), listening - 1, 'a hub that goes hears no more')
  runner.survivors = [{ name: 'storefront/june', tag: 't1', pid: 1 }, { name: 'june', tag: 't2', pid: 2 }]
  assert.deepEqual(ws.runner.survivors, [{ name: 'june', tag: 't1', pid: 1 }])
  assert.deepEqual(home.runner.survivors, [{ name: 'june', tag: 't2', pid: 2 }])
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 })
})

test('a shared agent edited in one workspace is that agent in all of them; where it works changes only there', () => {
  ws.update('june', { model: 'opus', cwd: '~/code/api-v2' })
  assert.equal(home.agents.get('june').model, 'opus')
  assert.equal(ws.agents.get('june').model, 'opus')
  assert.equal(ws.agents.get('june').cwd, '~/code/api-v2')
  assert.equal(home.agents.get('june').cwd, OWN)
  assert.deepEqual(saved().workspaces[0].members.june, { folder: '~/code/api-v2' })
  ws.update('june', { off: true })
  assert.equal(ws.agents.get('june').off, true)
  assert.equal(home.agents.get('june').off, undefined, 'off here, still on in the default')
})

test("a new folder for a workspace starts its agents' conversations there afresh; elsewhere they carry on", () => {
  home.saveSession('june', 'sess-default')
  ws.saveSession('june', 'sess-storefront')
  ws.saveSession('milo', 'sess-milo')
  const raw = saved()
  raw.workspaces[0].folder = '~/code/api-v2' // by hand
  fs.writeFileSync(CONFIG, JSON.stringify(raw))
  config.load()
  assert.equal(ws.sessions.june, undefined)
  assert.equal(ws.sessions.milo, undefined)
  assert.equal(ws.sessions.ada, undefined)
  assert.equal(home.sessions.june, 'sess-default')
})

test("a workspace's own agent is only there; a new shared one joins the roster and that workspace", () => {
  assert.equal(ws.addAgent({ name: 'Mo', area: 'ops', cwd: '~/ops' }), 'mo')
  assert.equal(ws.addAgent({ name: 'pat', area: 'qa', shared: true, cwd: '~/qa' }), 'pat')
  assert.ok(ws.agents.has('mo') && ws.agents.has('pat'))
  assert.ok(!home.agents.has('mo'))
  assert.ok(!home.agents.has('pat'), 'it works where you made it, until you add it elsewhere')
  assert.equal(ws.agents.get('pat').off, undefined)
  const raw = saved()
  assert.deepEqual(raw.workspaces[0].agents.map((a) => a.name), ['milo', 'mo'])
  assert.equal(raw.agents.find((a) => a.name === 'pat').cwd, undefined, 'the folder was for here')
  assert.deepEqual(raw.workspaces[0].members.pat, { folder: '~/qa' })
  assert.throws(() => ws.addAgent({ name: 'milo' }), /already exists/)
  assert.throws(() => home.addAgent({ name: 'iris' }), /already exists/)
  assert.equal(home.addAgent({ name: 'milo' }), 'milo', "another workspace's own agent's name is free here")
  assert.throws(() => ws.addAgent({ name: 'milo', shared: true }), /already exists/)
})

test('an agent out of a workspace: its own one is gone, a shared one only leaves, wherever you take it out of; everywhere takes it off your roster', () => {
  ws.saveSession('june', 'sess-storefront')
  ws.stats.june = { first: 1, days: {}, tasks: 3 }
  ws.removeAgent('milo')
  assert.ok(!ws.agents.has('milo'))
  assert.deepEqual(saved().workspaces[0].agents, [])
  ws.removeAgent('ada')
  assert.ok(!ws.agents.has('ada'))
  assert.ok(home.agents.has('ada'), 'still yours')
  assert.deepEqual(Object.keys(saved().workspaces[0].members), ['june'])
  home.removeAgent('iris')
  assert.ok(!home.agents.has('iris'), 'any workspace: out of this one')
  assert.ok(saved().agents.some((a) => a.name === 'iris'), 'and still yours')
  home.removeAgent('june', { everywhere: true })
  assert.ok(!home.agents.has('june') && !ws.agents.has('june'))
  assert.deepEqual(saved().workspaces[0].members, {})
  assert.equal(ws.sessions.june, undefined, 'what storefront kept about it goes too')
  assert.equal(ws.stats.june, undefined)
})

test('a shared agent renamed while it works in a parked workspace carries on there under its new name', () => {
  clique({ autopilot: true, agents: roster(), workspaces: [{ ...storefront(), parked: true }] })
  ws.start('http://127.0.0.1:1')
  runner.live.set('storefront/june', {}) // it outlived the last CLIque
  ws.agents.get('june').status = 'idle'
  home.update('june', { name: 'jo' })
  assert.ok(!runner.running('storefront/june'))
  assert.ok(runner.running('storefront/jo'))
  assert.ok(!runner.running('storefront/ada'), 'the rest stay parked')
})

test('renaming a shared agent from any workspace renames it in all of them, with what each kept about it', () => {
  home.saveSession('june', 'sess-default')
  ws.saveSession('june', 'sess-storefront')
  ws.tickets.add({ title: 'rate limits', by: 'you', owner: 'june' })
  ws.update('june', { name: 'jo' })
  assert.ok(home.agents.has('jo') && ws.agents.has('jo') && !ws.agents.has('june'))
  assert.equal(home.sessions.jo, 'sess-default')
  assert.equal(ws.sessions.jo, 'sess-storefront')
  assert.equal(ws.tickets.all[0].owner, 'jo')
  assert.equal(ws.space.triage, 'jo')
  assert.throws(() => home.update('jo', { name: 'milo' }), /already exists/, "milo is storefront's, and jo is in storefront")
  ws.update('milo', { name: 'kit' })
  assert.deepEqual(saved().workspaces[0].agents.map((a) => a.name), ['kit'])
})

test("a workspace gone from config.json stops its agents; a hub's settings are its workspace's", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-ws-folder-'))
  clique({ agents: [{ name: 'june', area: 'backend' }], workspaces: [{ id: 'storefront', folder: tmp, members: { june: {} }, autofix: true }] })
  ws.start('http://127.0.0.1:1')
  ws.restart('june')
  assert.ok(runner.running('storefront/june'))
  assert.equal(ws.snapshot().tasks.autofix, true)
  assert.equal(home.snapshot().tasks.autofix, false)
  ws.setAutopilot(false)
  assert.equal(saved().workspaces.find((w) => w.id === 'storefront').autopilot, false)
  assert.equal(home.snapshot().autopilot, true)
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'june', area: 'backend' }] }))
  config.load()
  assert.ok(!runner.running('storefront/june'))
  assert.equal(ws.agents.size, 0)
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 })
})

// ---- agents' requests reach their own workspace -----------------------------------------------------------

test("`clique` and the hooks say which workspace they're from, and land there", async () => {
  const server = await serve({ token: 'tok', hubFor: (id) => hubs.get(id) })
  fs.writeFileSync(path.join(HOME, 'url'), `http://127.0.0.1:${server.address().port}`)
  fs.writeFileSync(path.join(HOME, 'token'), 'tok')
  // as agents run them: bin/clique and sh hooks on macOS; clique.exe, and clique-hook.exe started with no shell, on Windows,
  // both running bin/clique.mjs with CLIQUE_NODE (core/launch.js, core/adapters.js)
  const run = (file, args, env, input = '') =>
    new Promise((resolve, reject) => execFile(file, args, { env: { ...process.env, CLIQUE_HOME: HOME, CLIQUE_NODE: process.execPath, ...env } }, (e, out) => (e ? reject(e) : resolve(out))).stdin.end(input))
  const cliqueCli = (env, ...args) => (WIN ? run(path.join(toolsDir(BIN), 'clique.exe'), args, env) : run(path.join(BIN, 'clique'), args, env))
  assert.equal(await cliqueCli({ CLIQUE_AGENT: 'june', CLIQUE_WORKSPACE: 'storefront' }, 'note', 'storefront runs on pnpm'), 'shared with the clique\n')
  assert.equal(await cliqueCli({ CLIQUE_AGENT: 'june', CLIQUE_WORKSPACE: '' }, 'note', 'the default runs on npm'), 'shared with the clique\n')
  assert.match(ws.board(), /pnpm/)
  assert.doesNotMatch(ws.board(), /on npm/)
  assert.match(home.board(), /on npm/)
  assert.doesNotMatch(await cliqueCli({ CLIQUE_WORKSPACE: 'storefront' }, 'who'), /\bgal\b/, 'only who is in storefront')
  assert.match(await cliqueCli({ CLIQUE_WORKSPACE: 'gone' }, 'who'), /no workspace "gone"/)
  // a hook: to the hub while CLIque is there, to storefront's spool while it isn't, and replayed in storefront
  const hook = JSON.parse(adapters.claude({ name: 'milo' }, { session: 's', attachments: os.tmpdir(), bin: BIN }).args.find((x) => x.startsWith('{"permissions"'))).hooks.UserPromptSubmit[0].hooks[0]
  const env = { CLIQUE_AGENT: 'milo', CLIQUE_WORKSPACE: 'storefront' }
  const runHook = (input) => (WIN ? run(hook.command, hook.args, env, input) : run('/bin/sh', ['-c', hook.command], env, input))
  await runHook(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'write the docs' }))
  assert.equal(ws.agents.get('milo').status, 'working')
  server.close()
  fs.writeFileSync(path.join(HOME, 'url'), 'http://127.0.0.1:9')
  await runHook(JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'docs written' }))
  assert.ok(fs.existsSync(path.join(HOME, 'workspaces', 'storefront', 'spool', 'milo.jsonl')))
  assert.ok(!fs.existsSync(path.join(HOME, 'spool', 'milo.jsonl')))
  ws.replaySpool()
  assert.equal(ws.feed.findLast((e) => e.kind === 'reply')?.text, 'docs written')
  assert.ok(!home.feed.some((e) => e.text === 'docs written'))
})

test('CLIque keeps a hub for each workspace in config.json: open ones run, parked ones wait', async () => {
  const { Clique } = await import('../core/clique.js')
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'june', area: 'backend', off: true }], workspaces: [{ id: 'storefront', folder: API, members: { june: {} }, parked: true }] }))
  const c = new Clique({ bin: BIN, computerName: 'test' })
  await c.start()
  try {
    assert.deepEqual([...c.hubs.keys()], [ROOT, 'storefront'])
    assert.equal(c.hubs.get(ROOT), c.hubs.get(ROOT))
    assert.equal(c.hubs.get('storefront').parked, true)
    assert.ok(c.hubs.get('storefront').agents.has('june'))
    assert.ok(!c.runner.running('storefront/june'), 'on there, but not started until storefront is opened')
    // the agents' logs don't say which workspace they worked in: one workspace looks back through them for spend
    assert.equal(c.hubs.get(ROOT).lookingBack, true)
    assert.ok(!c.hubs.get('storefront').lookingBack)
    // a workspace added by hand gets its hub, open unless it says it's parked; one taken out loses it
    fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'june', area: 'backend', off: true }], workspaces: [{ id: 'side', members: { june: { off: true } } }] }))
    c.config.load()
    assert.deepEqual([...c.hubs.keys()], [ROOT, 'side'])
    assert.equal(c.hubs.get('side').parked, false)
    // its agents talk to it through the one server
    const res = await fetch(`${c.hubs.get(ROOT).url}/who`, { headers: { 'x-clique': c.token, 'x-clique-workspace': 'side' } })
    assert.match(await res.text(), /june/)
    // your accounts' usage limits are one record, whichever workspace's agent reported them
    assert.equal(c.hubs.get('side').usage, c.hubs.get(ROOT).usage)
    c.hubs.get('side').usage.claude = { told: {}, at: 1, windows: [] }
    c.hubs.get('side').saveUsage(true)
    c.hubs.get(ROOT).saveUsage(true)
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(HOME, 'usage.json'), 'utf8'))), ['claude'])
  } finally {
    c.server.close()
    c.stop()
    for (const h of c.hubs.values()) h.dispose()
  }
})

test("a config.json that can't be read: said once, in the chat on screen once there is one, and nothing saves over it", async () => {
  const { Clique } = await import('../core/clique.js')
  fs.writeFileSync(CONFIG, '{ "agents": [ oops')
  const c = new Clique({ bin: BIN, computerName: 'test' })
  try {
    assert.equal(c.config.broken, true)
    assert.equal(c.screen, null, 'what the file says is not known, so no workspace')
    assert.throws(() => c.workspaceAction('create', null, { name: 'Mine' }), /can't read its settings/)
    assert.match(fs.readFileSync(CONFIG, 'utf8'), /oops/, 'as it was, to be fixed')
    fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'june', area: 'backend' }], workspaces: [{ id: 'storefront', members: {} }] }))
    c.config.load()
    const said = [...c.hubs.values()].flatMap((h) => h.feed.filter((e) => /config\.json/.test(e.text ?? '')))
    assert.equal(said.length, 1)
    assert.match(said[0].text, /^CLIque couldn't read its settings \(.*config\.json: .*\), so it carries on with the ones it had$/)
    assert.ok(c.here.feed.includes(said[0]), 'on screen')
  } finally {
    clearTimeout(c.changeTimer)
    for (const h of c.hubs.values()) h.dispose()
  }
})

test("nothing saves over a config.json that can't be read: not a theme, not a provider, not a change made just after it went bad", async () => {
  const { Clique } = await import('../core/clique.js')
  const { addProvider } = await import('../core/providers.js')
  fs.writeFileSync(CONFIG, '{ "agents": [ oops')
  const c = new Clique({ bin: BIN, computerName: 'test' })
  const same = () => assert.match(fs.readFileSync(CONFIG, 'utf8'), /oops/, 'as it was')
  try {
    assert.throws(() => c.setTheme('light'), /can't read its settings/)
    same()
    assert.throws(() => c.setSavers({ coldStart: false }), /can't read its settings/)
    same()
    assert.throws(() => c.setTools('auto'), /can't read its settings/)
    same()
    assert.throws(() => addProvider(c.config, 'glm'), /can't read its settings/)
    same()
    // fixed: it's picked up, and then it saves
    fs.writeFileSync(CONFIG, JSON.stringify({ agents: [], theme: 'dark' }))
    assert.throws(() => c.setTheme('light'), /can't read its settings/, "what's in memory is the old: this one doesn't count")
    assert.equal(c.config.data.theme, 'dark')
    c.setTheme('light')
    assert.equal(saved().theme, 'light')
    // gone bad since it was last read, before anything noticed
    fs.writeFileSync(CONFIG, '{ "agents": [ oops')
    assert.equal(c.config.broken, false)
    assert.throws(() => c.setTheme('dark'), /can't read its settings/)
    same()
    assert.equal(c.config.broken, true)
  } finally {
    clearTimeout(c.changeTimer)
    for (const h of c.hubs.values()) h.dispose()
  }
})

test('images: the sweep leaves what your agents, and the files of a removed workspace, still refer to; and everything when config.json can\'t be read', async () => {
  const { ATTACHMENTS } = await import('../core/hub.js')
  fs.mkdirSync(ATTACHMENTS, { recursive: true })
  const old = (name) => {
    const file = path.join(ATTACHMENTS, name)
    fs.writeFileSync(file, 'x')
    fs.utimesSync(file, new Date(0), new Date(0))
    return file
  }
  const [loose, ref, chat] = ['2020-01-01-loose.png', '2020-01-01-ref.png', '2020-01-01-chat.png'].map(old)
  const c = await cliqueApp({ layout: 2, agents: [{ name: 'june', images: [ref] }], workspaces: [{ id: 'shop', name: 'Shop', members: {} }, { id: 'side', name: 'Side', members: {} }] })
  try {
    fs.writeFileSync(path.join(HOME, 'workspaces', 'shop', 'feed.jsonl'), `${JSON.stringify({ id: 'm1', ts: 1, kind: 'msg', from: 'you', to: 'june', text: 'look', images: [chat] })}\n`)
    c.workspaceAction('remove', 'shop')
    c.config.broken = true
    assert.deepEqual(c.sweepImages(), { attachments: 0, cache: 0 })
    assert.ok(fs.existsSync(loose), "it doesn't know what's needed")
    c.config.broken = false
    assert.equal(c.sweepImages().attachments, 1)
    assert.ok(!fs.existsSync(loose))
    assert.ok(fs.existsSync(ref), 'an agent in no workspace still has its reference images')
    assert.ok(fs.existsSync(chat), 'a removed workspace made again has its chat back')
  } finally {
    fs.rmSync(path.join(HOME, 'workspaces', 'shop', 'feed.jsonl'), { force: true })
    for (const f of [ref, chat]) fs.rmSync(f, { force: true })
    quit(c)
  }
})

test('removing or renaming a shared agent leaves alone another workspace\'s own agent of that name', () => {
  clique({ layout: 2, agents: [{ name: 'ada', area: 'app' }], workspaces: [{ id: 'storefront', members: { ada: {} } }, { id: ROOT, name: 'Home', members: {}, agents: [{ name: 'ada', area: 'its own' }] }] })
  home.saveSession('ada', 'home-own-ada')
  home.tickets.add({ title: 'its task', by: 'you', owner: 'ada' })
  ws.saveSession('ada', 'shared-ada')
  ws.rename('ada', 'ann')
  assert.equal(ws.sessions.ann, 'shared-ada')
  assert.equal(home.sessions.ada, 'home-own-ada', 'its conversation stays')
  assert.equal(home.sessions.ann, undefined)
  assert.equal(home.tickets.all[0].owner, 'ada', 'and its task')
  ws.saveSession('ann', 'shared-ann')
  ws.removeAgent('ann', { everywhere: true })
  assert.equal(home.sessions.ada, 'home-own-ada')
  assert.equal(ws.sessions.ann, undefined)
})

test('the triage agent gone from a workspace: nobody is said to be triaging', () => {
  clique({ layout: 2, agents: roster(), workspaces: [{ ...storefront(), triage: 'june' }, home_()] })
  assert.equal(ws.snapshot().tasks.triage, 'june')
  ws.removeAgent('june')
  assert.equal(saved().workspaces[0].triage, undefined)
  clique({ layout: 2, agents: roster(), workspaces: [{ ...storefront(), triage: 'milo' }, home_()] })
  ws.removeAgent('milo')
  assert.equal(saved().workspaces[0].triage, undefined)
  clique({ layout: 2, agents: roster(), workspaces: [{ ...storefront(), triage: 'june' }, home_()] })
  ws.removeAgent('june', { everywhere: true })
  assert.equal(saved().workspaces[0].triage, undefined)
})

test('a workspace made again by its name has its files back; nothing else takes them', async () => {
  const c = await cliqueApp({ layout: 2, agents: [], workspaces: [{ id: ROOT, name: 'Дом', members: {} }, { id: 'docsy', name: 'Site', members: {} }, { id: 'keep', name: 'Keep', members: {} }] })
  const gone = () => saved().workspacesGone ?? {}
  try {
    c.workspaceAction('remove', ROOT)
    c.workspaceAction('remove', 'docsy')
    assert.deepEqual(gone(), { 'дом': ROOT, site: 'docsy' })
    // names with nothing latin all come to the same id: not the same workspace
    assert.notEqual(c.workspaceAction('create', null, { name: '新项目' }).id, ROOT)
    // nor is a name that happens to be another's first name, or the id
    assert.equal(c.workspaceAction('create', null, { name: 'Docsy' }).id, 'docsy-2')
    assert.equal(c.addTheirs(c.config.data, { key: 'laptop:docsy', computer: 'laptop', name: 'Site' }), 'site', "a linked computer's has its own files")
    assert.equal(c.workspaceAction('create', null, { name: 'site' }).id, 'docsy', 'its name, in any case: it has its files back')
    assert.equal(c.workspaceAction('create', null, { name: 'Дом' }).id, ROOT)
    assert.deepEqual(gone(), {})
  } finally {
    quit(c)
  }
})

test('moving a workspace on the rail leaves the one on screen on screen', async () => {
  const c = await cliqueApp({ layout: 2, agents: [], workspaces: [{ id: 'first', name: 'First', members: {} }, { id: 'second', name: 'Second', members: {} }] })
  try {
    assert.equal(c.current, 'first', "on screen as the first: nothing says so in config.json")
    c.workspaceAction('order', null, ['second', 'first'])
    assert.equal(c.current, 'first')
    assert.equal(saved().current, 'first')
  } finally {
    quit(c)
  }
})

test("`clique` in a terminal of your own goes to the one on screen; a late hook of a removed workspace's agent lands nowhere", async () => {
  const { Clique } = await import('../core/clique.js')
  fs.writeFileSync(CONFIG, JSON.stringify({ layout: 2, agents: [], workspaces: [{ id: 'docs', name: 'Docs', members: {}, agents: [{ name: 'ada', area: 'docs', off: true }] }] }))
  const c = new Clique({ bin: BIN, computerName: 'test' })
  await c.start()
  try {
    const noHeader = (route, init) => fetch(`${c.url}/${route}`, { headers: { 'x-clique': c.token }, ...init })
    assert.match(await (await noHeader('who')).text(), /ada/)
    const late = await noHeader('hook/ada', { method: 'POST', body: JSON.stringify({ hook_event_name: 'Stop' }) })
    assert.equal(late.status, 404)
  } finally {
    c.server.close()
    c.stop()
    for (const h of c.hubs.values()) h.dispose()
  }
})

test("no workspace at all: the app gets an empty state, and anything that needs one says so", async () => {
  const { Clique } = await import('../core/clique.js')
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [] }))
  const c = new Clique({ bin: BIN, computerName: 'test' })
  await c.start()
  try {
    assert.equal(c.screen, null)
    // `clique` in a terminal of your own: nowhere to go yet, then the one on screen
    const who = () => fetch(`${c.url}/who`, { headers: { 'x-clique': c.token } })
    assert.equal((await who()).status, 404)
    assert.match(await (await who()).text(), /no workspace yet/)
    const s = c.snapshot()
    assert.equal(s.workspace, null)
    assert.deepEqual(s.workspaces, [])
    assert.deepEqual([s.agents, s.feed, s.tasks.tickets], [[], [], []])
    assert.equal(s.channels[0].id, 'general')
    assert.ok(s.providers.claude)
    assert.throws(() => c.here, /make a workspace first/)
    await assert.rejects(c.send('anyone', 'hello'), /make a workspace first/)
    c.say('a shortcut is taken')
    const { id, state } = c.workspaceAction('create', null, { name: 'First', folder: API })
    assert.equal(id, 'first')
    assert.equal(state.workspace.id, 'first')
    assert.equal(c.hubs.get('first').feed.at(-1).text, 'a shortcut is taken', 'what waited for a workspace is said there')
    assert.equal(saved().current, 'first')
    assert.equal(fs.existsSync(path.join(HOME, 'workspaces', 'first')), true, 'in a folder of its own')
    assert.equal((await who()).status, 200)
    assert.equal(await c.addAgent({ name: 'ada', area: 'backend', off: true }), 'ada')
    assert.equal(c.snapshot().agents[0].name, 'ada')
    // and back to none: any of them can go
    c.workspaceAction('remove', 'first')
    assert.equal(c.screen, null)
    assert.equal(c.snapshot().workspace, null)
  } finally {
    c.server.close()
    c.stop()
    for (const h of c.hubs.values()) h.dispose()
  }
})

test("terminals still running for a workspace that's gone from config.json are stopped, and the chat says so", async () => {
  const { Clique } = await import('../core/clique.js')
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'june', area: 'backend', off: true }] }))
  const c = new Clique({ bin: BIN, computerName: 'test' })
  const killed = []
  const proc = (name) => ({ p: { pid: 1, kill: () => killed.push(name), onExit: (fn) => fn() } })
  c.runner.procs.set('old/milo', proc('old/milo'))
  c.runner.connect = async () => (c.runner.survivors = [{ name: 'old/milo', tag: 't1', pid: 1 }])
  await c.start()
  try {
    assert.deepEqual(killed, ['old/milo'])
    assert.match(c.hubs.get(ROOT).feed.at(-1).text, /stopped old\/milo: it was still running for a workspace that's been removed/)
  } finally {
    c.server.close()
    c.stop()
    for (const h of c.hubs.values()) h.dispose()
  }
})

// ---- workspaces from the app: making, switching, parking -----------------------------------------------

// A CLIque on config.json as `raw` says, not started: workspaces are made and switched without any agent running.
async function cliqueApp(raw) {
  const { Clique } = await import('../core/clique.js')
  fs.writeFileSync(CONFIG, JSON.stringify(raw))
  const c = new Clique({ bin: BIN, computerName: 'test' })
  clearTimeout(c.changeTimer)
  return c
}
const quit = (c) => {
  clearTimeout(c.changeTimer)
  for (const h of c.hubs.values()) h.dispose()
}

test('a workspace made in the app: its look, folder and clique, then on screen; renamed, and removed with its files kept', async () => {
  const c = await cliqueApp({ agents: roster() })
  const own = (id) => saved().workspaces.find((w) => w.id === id)
  try {
    assert.deepEqual(c.workspaces().map((w) => [w.id, w.name, w.current]), [[ROOT, 'Home', true]], 'an older CLIque left one: a workspace like any other')
    const { id, state } = c.workspaceAction('create', null, { name: 'Storefront app', color: 'teal', icon: '🛒', folder: API, members: ['june', 'nobody'] })
    assert.equal(id, 'storefront-app')
    assert.deepEqual(own(id), { id: 'storefront-app', name: 'Storefront app', members: { june: {} }, color: 'teal', icon: '🛒', folder: API })
    assert.equal(saved().current, 'storefront-app')
    assert.equal(state.workspace.id, 'storefront-app', 'the new one is on screen')
    assert.deepEqual(state.agents.map((a) => [a.name, a.cwd, a.shared]), [['june', API, true]])
    assert.deepEqual(state.workspaces.map((w) => [w.id, w.current, w.parked]), [[ROOT, false, false], ['storefront-app', true, false]])
    assert.equal(c.workspaceAction('create', null, { name: 'Storefront app' }).id, 'storefront-app-2', 'a name taken gets a number')
    assert.throws(() => c.workspaceAction('create', null, { name: '  ' }), /name/)
    // every one of them has a name, a look and a folder
    c.workspaceAction('edit', 'storefront-app', { name: 'Storefront', color: '', icon: '🏌️' })
    c.workspaceAction('edit', ROOT, { name: 'Studio', color: 'pink', folder: APP })
    assert.deepEqual([own(id).name, own(id).color, own(id).icon], ['Storefront', undefined, '🏌️'])
    assert.deepEqual([own(ROOT).name, own(ROOT).color, own(ROOT).folder], ['Studio', 'pink', APP])
    assert.equal(saved().name, undefined)
    assert.equal(c.hubs.get(ROOT).space.folder, APP)
    assert.equal(c.hubs.get(ROOT).agents.get('iris').cwd, APP, 'its agents work there, unless one has a folder of its own')
    // switching is remembered in config.json; removing the one on screen goes to the first there is
    c.workspaceAction('switch', ROOT)
    assert.equal(saved().current, ROOT)
    c.workspaceAction('switch', 'storefront-app')
    fs.mkdirSync(path.join(HOME, 'workspaces', 'storefront-app'), { recursive: true })
    fs.writeFileSync(path.join(HOME, 'workspaces', 'storefront-app', 'board.md'), 'kept')
    c.workspaceAction('remove', 'storefront-app')
    assert.deepEqual(c.workspaces().map((w) => w.id), [ROOT, 'storefront-app-2'])
    assert.equal(c.here, c.hubs.get(ROOT))
    assert.equal(fs.readFileSync(path.join(HOME, 'workspaces', 'storefront-app', 'board.md'), 'utf8'), 'kept', 'its files stay, for if it comes back')
    assert.throws(() => c.workspaceAction('switch', 'nope'), /no such workspace/)
    // the one an older CLIque left goes like any other, and made again by that name it has its files back
    fs.writeFileSync(path.join(HOME, 'board.md'), 'kept too')
    c.workspaceAction('remove', ROOT)
    assert.deepEqual(c.workspaces().map((w) => w.id), ['storefront-app-2'])
    assert.ok(saved().agents.some((a) => a.name === 'june'), 'your shared agents are still yours')
    assert.equal(c.workspaceAction('create', null, { name: 'Other' }).id, 'other', 'another name, another id')
    assert.equal(c.workspaceAction('create', null, { name: 'Studio' }).id, ROOT)
    assert.match(c.hubs.get(ROOT).board(), /kept too/)
    assert.equal(saved().workspacesGone?.studio, undefined, 'back: nothing waits for that name')
    assert.deepEqual(own(ROOT).members, {})
    // a linked computer's workspace by that name has its own chat: it never takes those files
    c.workspaceAction('remove', ROOT)
    assert.notEqual(c.addTheirs(c.config.data, { key: 'laptop:home', computer: 'laptop', name: 'Studio' }), ROOT)
    assert.equal(fs.existsSync(path.join(HOME, 'board.md')), true)
  } finally {
    fs.rmSync(path.join(HOME, 'board.md'), { force: true })
    quit(c)
  }
})

test('a workspace asleep wakes when you go to it, and when you send it a message: no Open to press', async () => {
  const c = await cliqueApp({ layout: 2, agents: roster(), workspaces: [{ ...storefront(), parked: true }, home_()] })
  try {
    c.workspaceAction('switch', 'storefront')
    assert.equal(saved().workspaces[0].parked, undefined, 'going there woke it (and left nothing behind in config.json)')
    c.workspaceAction('park', 'storefront')
    assert.equal(saved().workspaces[0].parked, true, 'put to sleep while on screen')
    c.workspaceAction('switch', ROOT)
    assert.equal(saved().workspaces[0].parked, true, 'going elsewhere leaves it asleep')
    c.workspaceAction('switch', 'storefront')
    c.workspaceAction('park', 'storefront')
    Object.assign(c.runner, { running: () => true, submit() {}, write() {}, start() {} })
    for (const a of c.here.agents.values()) a.status = 'working' // busy: the message queues
    await c.send('june', 'pick the cart back up')
    assert.equal(saved().workspaces[0].parked, undefined, 'sending woke it')
    assert.equal(c.here.feed.findLast((e) => e.kind === 'msg').to, 'june')
  } finally {
    quit(c)
  }
})

test('the order workspaces are listed in: changed from the app, any of them first, the ones not named after the rest', async () => {
  const c = await cliqueApp({ layout: 2, agents: roster(), workspaces: [storefront(), home_()] })
  try {
    c.workspaceAction('create', null, { name: 'Docs' })
    c.workspaceAction('create', null, { name: 'Lab' })
    assert.deepEqual(c.workspaces().map((w) => w.id), ['storefront', ROOT, 'docs', 'lab'])
    const { state } = c.workspaceAction('order', null, ['lab', ROOT, 'storefront'])
    assert.deepEqual(saved().workspaces.map((w) => w.id), ['lab', ROOT, 'storefront', 'docs'])
    assert.deepEqual(state.workspaces.map((w) => w.id), ['lab', ROOT, 'storefront', 'docs'])
    c.config.data.workspaces.push(null) // a hand-edited config.json with a hole in it
    c.workspaceAction('order', null, ['docs', 'nope'])
    assert.deepEqual(c.workspaces().map((w) => w.id), ['docs', 'lab', ROOT, 'storefront'], 'unknown ids are ignored; the rest keep their order')
  } finally {
    quit(c)
  }
})

test("who works in a workspace: shared agents join and leave from the app, each with a folder of its own there or the workspace's", async () => {
  const c = await cliqueApp({ layout: 2, agents: roster(), workspaces: [storefront(), home_()] })
  try {
    c.workspaceAction('members', 'storefront', { add: ['iris', 'nobody'], remove: ['ada'], folders: { iris: APP, june: '' } })
    assert.deepEqual(saved().workspaces[0].members, { june: {}, iris: { folder: APP } })
    const w = c.workspaces().find((x) => x.id === 'storefront')
    assert.deepEqual(w.members, [{ name: 'june', folder: '' }, { name: 'iris', folder: APP }])
    assert.deepEqual(c.hubs.get('storefront').space.agents.map((a) => [a.name, a.cwd]), [['june', API], ['iris', APP], ['milo', API]])
    // any workspace, the same way
    c.workspaceAction('members', ROOT, { remove: ['iris'], folders: { june: APP } })
    assert.deepEqual(saved().workspaces.find((x) => x.id === ROOT).members, { june: { folder: APP }, ada: { off: true } })
    assert.deepEqual(c.hubs.get(ROOT).space.agents.map((a) => a.name), ['june', 'ada'])
    assert.equal(c.snapshot().roster.find((a) => a.name === 'iris').name, 'iris', 'still yours')
  } finally {
    quit(c)
  }
})

test("what the app does lands in the workspace on screen: its agents, edits, new agents and tasks; a linked computer's agents show in the workspace it has too", async () => {
  const c = await cliqueApp({ layout: 2, agents: roster(), workspaces: [storefront(), home_()], current: 'storefront' })
  try {
    assert.equal(c.here, c.hubs.get('storefront'))
    assert.deepEqual(c.snapshot().agents.map((a) => a.name), ['june', 'ada', 'milo'])
    await c.update('milo', { area: 'docs and guides' })
    assert.equal(saved().workspaces[0].agents[0].area, 'docs and guides')
    assert.equal(await c.addAgent({ name: 'ivo', area: 'release' }), 'ivo')
    assert.deepEqual(saved().workspaces[0].agents.map((a) => a.name), ['milo', 'ivo'], "a new agent made here is this workspace's own")
    assert.equal(saved().agents.some((a) => a.name === 'ivo'), false)
    await c.ticket('file', null, { text: 'rate limits are off by one', kind: 'bug' })
    assert.equal(c.hubs.get('storefront').tickets.all.length, 1)
    assert.equal(c.hubs.get(ROOT).tickets.all.length, 0)
    // a linked computer's agents show in the workspace you share with it; it has no storefront, so none of them are in storefront
    c.links.set('laptop', { slug: 'laptop', name: 'Laptop', peer: { push() {} }, toHost: new Map(), fetching: new Set(), spaces: { [ROOT]: { agents: [{ name: 'bo', status: 'idle' }], feed: [], tasks: { tickets: [] }, providers: {} } } })
    assert.equal(c.snapshot().agents.some((a) => a.home), false)
    await assert.rejects(() => c.moveAgent('milo', 'laptop'), /Laptop has no Storefront workspace/)
    c.workspaceAction('switch', ROOT)
    assert.deepEqual(c.snapshot().agents.filter((a) => a.home).map((a) => a.name), ['bo@laptop'])
  } finally {
    quit(c)
  }
})

test('parking a workspace stops its agents and keeps their conversations; opened, each resumes once it has work', () => {
  ws.update('ada', { off: true })
  ws.start('http://127.0.0.1:1')
  ws.saveSession('june', 'sess-storefront')
  ws.restart('june')
  ws.restart('milo')
  assert.ok(runner.running('storefront/june') && runner.running('storefront/milo'))
  ws.agents.get('june').status = 'working'
  ws.space.parked = true
  ws.saveConfig()
  assert.equal(ws.parked, true)
  assert.equal(saved().workspaces[0].parked, true)
  assert.ok(!runner.running('storefront/june') && !runner.running('storefront/milo'), 'its agents stop')
  assert.equal(ws.sessions.june, 'sess-storefront', 'their conversations wait')
  assert.match(ws.feed.at(-1).text, /^went to sleep: @june and @milo stopped/, 'one line in its chat, not one per agent')
  const shown = ws.snapshot()
  assert.equal(shown.parked, true)
  assert.deepEqual(shown.agents.map((a) => [a.name, a.status]), [['june', 'parked'], ['ada', 'off'], ['milo', 'parked']])
  assert.deepEqual([ws.summary().on, ws.summary().working], [2, 0])
  // by hand in config.json too: opened, its agents rest until there's work for them
  const raw = saved()
  delete raw.workspaces[0].parked
  fs.writeFileSync(CONFIG, JSON.stringify(raw))
  config.load()
  assert.equal(ws.parked, false)
  assert.deepEqual(ws.snapshot().agents.map((a) => [a.name, a.status]), [['june', 'resting'], ['ada', 'off'], ['milo', 'resting']])
  assert.ok(!runner.running('storefront/june') && !runner.running('storefront/milo'))
  ws.send({ to: 'june', text: 'are you there?' })
  assert.ok(runner.live.get('storefront/june').args.includes('sess-storefront'), 'resumes its conversation')
  assert.ok(!runner.running('storefront/milo'), 'only the one with work starts')
  assert.ok(!runner.running('storefront/ada'), 'one that was off stays off')
})

test('the switcher counts every workspace: who works, who needs you, and replies you have not read', () => {
  ws.start('http://127.0.0.1:1')
  ws.agents.get('june').status = 'working'
  ws.agents.get('milo').status = 'waiting'
  ws.feed.push({ kind: 'reply', from: 'milo', text: 'done', ts: Date.now() + 1000 })
  assert.deepEqual(Object.fromEntries(Object.entries(ws.summary()).filter(([k]) => !['faces', 'needs'].includes(k))), { agents: 3, on: 3, working: 1, waiting: 1, unread: 1 })
  assert.deepEqual(ws.summary().needs.map((n) => n.name), ['milo'], "who's waiting on you, for the other workspaces to say")
  ws.update('ada', { off: true })
  assert.deepEqual(ws.summary().faces.map((f) => f.name), ['june', 'milo'], 'faces of who is on')
  ws.read({ milo: Date.now() + 2000 })
  assert.equal(ws.summary().unread, 0)
})

test("a parked workspace's agents don't start behind its back: restart refuses, a new conversation waits for it to open", () => {
  clique({ autopilot: true, agents: roster(), workspaces: [{ ...storefront(), parked: true }] })
  ws.start('http://127.0.0.1:1')
  ws.saveSession('june', 'sess-storefront')
  assert.throws(() => ws.restart('june'), /asleep: send a message there to wake it/)
  ws.freshStart('june')
  assert.equal(runner.running('storefront/june'), false)
  assert.equal(ws.sessions.june, undefined, 'it starts fresh when the workspace opens')
})

test("made with members' own folders, they start there the first time; a shared agent can't take an own agent's name there", async () => {
  const c = await cliqueApp({ layout: 2, agents: [...roster(), { name: 'milo', area: 'shared docs' }], workspaces: [storefront(), home_()] })
  try {
    let pushed = null
    c.on('state', (s) => (pushed = s))
    c.workspaceAction('create', null, { name: 'Site', folder: API, members: ['june', 'iris'], folders: { iris: APP } })
    assert.deepEqual(saved().workspaces.find((w) => w.id === 'site').members, { june: {}, iris: { folder: APP } })
    assert.equal(pushed?.workspace.id, 'site', 'the state goes out at once, ahead of whatever follows')
    assert.throws(() => c.workspaceAction('members', 'storefront', { add: ['milo'] }), /Storefront has an agent of its own called milo/)
    assert.throws(() => c.workspaceAction('edit', 'site', { color: 'red;}</style><b>' }), /isn't a color/)
    c.workspaceAction('edit', 'site', { color: '#16b9c6' })
    assert.equal(c.workspaces().find((w) => w.id === 'site').color, '#16b9c6')
  } finally {
    quit(c)
  }
})

test("your accounts' limits: said once, where you are, whichever workspace's agent reports them; the pace counts every workspace's readings", async () => {
  const c = await cliqueApp({ layout: 2, agents: roster(), workspaces: [storefront(), home_()], current: ROOT })
  try {
    const notices = []
    c.on('notice', (n) => notices.push(n))
    const home = c.hubs.get(ROOT)
    const g = c.hubs.get('storefront')
    const at = Date.now() + 3600e3
    g.setUsage('claude', [{ id: 'five_hour', pct: 81, resetsAt: at }]) // a Storefront agent's status line, Home on screen
    home.setUsage('claude', [{ id: 'five_hour', pct: 82, resetsAt: at }])
    const said = (h) => h.feed.filter((e) => e.limit?.window === 'five_hour').length
    assert.deepEqual([said(home), said(g)], [1, 0], 'once, in the workspace on screen')
    assert.ok(notices.length >= 1 && notices.every((n) => n.account && !('workspace' in n)), "its notification is no workspace's")
    assert.equal(g.samples, home.samples, 'one record of readings')
    assert.equal(g.samples.claude.five_hour.length, 2)
    // 95% with Storefront on screen: its line there takes the place of Home's
    c.workspaceAction('switch', 'storefront')
    home.setUsage('claude', [{ id: 'five_hour', pct: 96, resetsAt: at }])
    assert.deepEqual([said(home), said(g)], [0, 1], "a window's line, once, wherever you are now")
  } finally {
    quit(c)
  }
})

// ---- one file, one editor; one simulator, one user: whichever workspace ----------------------------------

const edit = (file) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } })
const atWork = (hub, name) => {
  runner.live.set(hub.runner.full(name), {})
  hub.agents.get(name).status = 'working'
}

test('a file is edited by one agent at a time, whichever workspace it works in; the one turned away hears where', () => {
  const file = path.join(API, 'rates.js')
  atWork(home, 'june')
  atWork(ws, 'milo')
  atWork(ws, 'june')
  assert.equal(home.lease('june', edit(file)), '', "Home's june takes it")
  const no = JSON.parse(ws.lease('milo', edit(file))).hookSpecificOutput
  assert.equal(no.permissionDecision, 'deny')
  assert.match(no.permissionDecisionReason, /edited by june in your Home workspace/)
  assert.doesNotMatch(no.permissionDecisionReason, /clique ask/, "it can't ask an agent in another workspace")
  assert.match(ws.feed.at(-1).file, /rates\.js/)
  assert.equal(ws.feed.at(-1).in, 'Home')
  assert.ok(ws.lease('june', edit(file)), "Storefront's june is another agent: turned away too")
  home.release('june') // its turn ends
  assert.equal(ws.lease('milo', edit(file)), '')
  // held under the file's key (on Windows its path in lower case)
  assert.equal(home.leases.get(fileKey(filePath(file, API))).ws, 'storefront', 'one record: Home sees Storefront has it')
})

test('clique lease: one simulator for every workspace; it goes to whoever waits for it, in any of them', async () => {
  atWork(home, 'iris')
  atWork(ws, 'milo')
  assert.match(await home.claim({ from: 'iris', words: ['simulator', 'QA pass'] }), /Yours now: simulator/)
  const waiting = ws.claim({ from: 'milo', words: ['Simulator'], hold: 5000 })
  assert.equal(ws.feed.at(-1).rule, 'lease')
  assert.equal(ws.feed.at(-1).in, 'Home')
  assert.match(ws.leasesText(), /simulator\s+iris \(Home\)/)
  assert.deepEqual(ws.holdsOf('iris'), [], "Storefront's iris, if it had one, holds nothing")
  assert.match(home.give({ from: 'iris' }), /released simulator/)
  assert.match(await waiting, /Yours now: Simulator/, 'as milo wrote it')
  assert.deepEqual(ws.holdsOf('milo'), ['Simulator'])
  assert.match(home.leasesText(), /milo \(Storefront\)/)
  assert.match(home.give({ from: 'milo' }), /isn't yours|hold nothing/, "Home's agents can't give back Storefront's")
})

test('a lease of yours is saved with the workspace you took it in, whichever that is, and its other state with it', async () => {
  await ws.claim({ from: 'you', words: ['android device'] })
  ws.saveRuntime(true)
  home.saveRuntime(true)
  const heldIn = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf8')).held.map(([, h]) => [h.thing, h.name])
  assert.deepEqual(heldIn(dirOf(HOME, 'storefront')), [['android device', 'you']])
  assert.deepEqual(heldIn(HOME), [], 'once')
  ws.give({ from: 'you', words: ['android device'] })
})

test('a linked computer: its terminals show in their own workspace, typing reaches the right one, and an older CLIque is told to update', async () => {
  const c = await cliqueApp({ layout: 2, agents: roster(), workspaces: [storefront(), home_()], current: 'storefront' })
  try {
    const { EventEmitter: Emitter } = await import('node:events')
    const peer = Object.assign(new Emitter(), { name: 'Laptop', push() {}, input() {}, close() {} })
    peer.call = async (fn) => {
      if (fn === 'state') return { agents: [], feed: [], tasks: { tickets: [] }, providers: {} }
      throw new Error(`"${fn}" isn't available over CLIque Link`) // an older CLIque: no workspaces
    }
    const l = c.attach(peer)
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(l.aware, false, "it didn't answer 'workspaces'")
    const pty = []
    c.on('pty', (n, d) => pty.push([n, d]))
    const key = c.keyOf('storefront')
    peer.emit('pty', `${key}/milo`, 'storefront output')
    peer.emit('pty', 'storefront/milo', 'by bare id') // an older CLIque's way: no workspace here has that key
    peer.emit('pty', 'ann', 'no workspace') // an older CLIque's other way: nothing here
    assert.deepEqual(pty, [['milo@laptop', 'storefront output']])
    const typed = []
    for (const [id, h] of c.hubs) h.input = (n, d) => typed.push([id, n, d])
    peer.emit('input', `${key}/june`, 'y')
    peer.emit('input', 'storefront/june', 'x')
    peer.emit('input', 'june', 'n')
    assert.deepEqual(typed, [['storefront', 'june', 'y']])
    await assert.rejects(c.linkCall(l, 'update', [['milo'], {}]), /Laptop runs an older CLIque, without workspaces: update it/)
  } finally {
    quit(c)
  }
})

test("a linked computer's own workspaces show up here on their own, as its; hidden ones stay hidden; one it drops goes", async () => {
  const c = await cliqueApp({ layout: 2, agents: roster(), workspaces: [storefront(), home_()] })
  try {
    const { EventEmitter: Emitter } = await import('node:events')
    const pushed = []
    const theirs = [
      { key: 'laptop:storefront', owner: 'laptop', name: 'Storefront', color: 'not a color!' },
      { key: c.keyOf('storefront'), owner: c.me.slug, name: 'Storefront' }, // shown there from here: not the laptop's to offer
      { key: 'bad/key', owner: 'laptop', name: 'x' },
    ]
    const peer = Object.assign(new Emitter(), { name: 'Laptop', push: (...m) => pushed.push(m), input() {}, close() {} })
    peer.call = async (fn) => {
      if (fn === 'state') return { agents: [], feed: [], tasks: { tickets: [] }, providers: {} }
      if (fn === 'workspaces') return theirs
      throw new Error(`"${fn}" isn't available over CLIque Link`)
    }
    const before = c.current
    const l = c.attach(peer)
    await new Promise((r) => setTimeout(r, 10))
    // its Storefront is here, under an id of this computer's (ours has the name too), with nobody of ours in it, and it
    // doesn't take the screen; a look this version can't show is dropped, not fatal
    const shown = () => c.config.data.workspaces.find((w) => w.of?.computer === 'laptop')
    assert.equal(shown()?.id, 'storefront-2')
    assert.deepEqual(shown().of, { computer: 'laptop', id: 'storefront', name: 'Laptop' }, 'its computer, by name too for when it is gone')
    assert.deepEqual(shown().members, {}, 'none of ours: nothing starts here')
    assert.equal(c.current, before, 'not put on screen')
    assert.equal(c.keyOf('storefront-2'), 'laptop:storefront')
    assert.deepEqual([...l.theirs].sort(), ['storefront', 'storefront-2'], 'ours it has, and its own now here: both shared')
    assert.ok(pushed.some(([t, key]) => t === 'ws' && key === c.keyOf('storefront')), 'it gets ours by key')
    const ws = c.workspaces().find((w) => w.id === 'storefront-2')
    assert.deepEqual([ws.owner, ws.ownerName, ws.ownerOnline], ['laptop', 'Laptop', true])
    assert.deepEqual(c.remoteWorkspaces().map((w) => [w.key, w.name, w.computerName, w.online, w.joined]), [['laptop:storefront', 'Storefront', 'Laptop', true, 'storefront-2']])

    // hidden: gone, and it stays gone when the laptop says its list again
    c.workspaceAction('remove', 'storefront-2')
    assert.equal(shown(), undefined)
    assert.deepEqual(c.settings.hiddenWorkspaces, ['laptop:storefront'])
    peer.emit('wslist', theirs)
    assert.equal(shown(), undefined, 'hidden stays hidden')
    assert.equal(c.remoteWorkspaces()[0].joined, null, 'offered to show again')
    // shown again: back, and on screen this time (you asked for it)
    const { id } = c.workspaceAction('join', 'laptop:storefront')
    assert.equal(shown().id, id)
    assert.equal(c.current, id)
    assert.deepEqual(c.settings.hiddenWorkspaces, [])

    // the laptop drops it: it goes here too, unless it's on screen (until you leave it) or you've made it yours
    peer.emit('wslist', theirs.filter((w) => w.key !== 'laptop:storefront'))
    assert.equal(shown()?.id, id, 'on screen: not taken from under you')
    c.workspaceAction('switch', 'default')
    assert.equal(shown(), undefined, 'left: it goes with its owner')
    peer.emit('wslist', theirs)
    c.workspaceAction('members', 'storefront-2', { add: ['iris'] })
    peer.emit('wslist', theirs.filter((w) => w.key !== 'laptop:storefront'))
    assert.equal(shown()?.id, 'storefront-2', 'iris works there: it stays')
    c.workspaceAction('members', 'storefront-2', { remove: ['iris'] })
    assert.equal(shown(), undefined, 'the last of ours out: it goes, without waiting for the laptop to say so again')
    peer.emit('wslist', theirs)
    c.workspaceAction('edit', 'storefront-2', { folder: '/tmp' })
    peer.emit('wslist', theirs.filter((w) => w.key !== 'laptop:storefront'))
    assert.equal(shown()?.id, 'storefront-2', 'a folder of yours set on it: it stays')
    c.workspaceAction('remove', 'storefront-2') // hidden, with its folder
    peer.emit('wslist', theirs)
    c.workspaceAction('join', 'laptop:storefront') // shown again: not hidden for what follows
    c.workspaceAction('switch', 'default')
    peer.emit('wslist', theirs)
    assert.equal(shown()?.id, 'storefront-2', 'there while the laptop has it')

    // it goes offline: still here and listed, unavailable; one it adds meanwhile can't be shown until it's back
    peer.emit('close')
    assert.deepEqual(c.remoteWorkspaces().map((w) => [w.key, w.online, w.joined]), [['laptop:storefront', false, 'storefront-2']])
    assert.equal(c.workspaces().find((w) => w.id === 'storefront-2').ownerOnline, false)
    c.knownSpaces.get('laptop').list.push({ key: 'laptop:lab', owner: 'laptop', name: 'Lab' })
    assert.throws(() => c.workspaceAction('join', 'laptop:lab'), /Laptop is offline/)
    // forgotten: its workspaces go with it, and it isn't offered any more
    c.forget('laptop')
    assert.equal(shown(), undefined)
    assert.deepEqual(c.remoteWorkspaces(), [])
  } finally {
    quit(c)
  }
})

test("a connection that loses to another doesn't take the winner's workspaces with it", async () => {
  const c = await cliqueApp({ layout: 2, agents: roster(), workspaces: [storefront(), home_()] })
  try {
    const { EventEmitter: Emitter } = await import('node:events')
    const answers = []
    const peer = () => {
      const p = Object.assign(new Emitter(), { name: 'Laptop', push() {}, input() {}, close() {} })
      p.call = (fn) => (fn === 'state' ? Promise.resolve({ agents: [], feed: [], tasks: { tickets: [] }, providers: {} }) : new Promise((resolve, reject) => answers.push({ resolve, reject })))
      return p
    }
    const slow = peer()
    const l = c.attach(slow) // the slower of two sockets dialed at once
    const fast = peer()
    c.attach(fast) // ...and the one that wins
    answers[1].resolve([{ key: c.keyOf('storefront'), owner: c.me.slug, name: 'Storefront' }]) // the winner knows workspaces
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(l.aware, true)
    answers[0].reject(new Error('lost the connection to Laptop')) // the loser is closed afterwards
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(l.aware, true, 'still aware')
    assert.deepEqual([...l.theirs], ['storefront'])
  } finally {
    quit(c)
  }
})

test("a workspace's folder to open in Finder or Explorer: the one config.json has, ~ and all; said in words when there's none or it's gone", async () => {
  const { Clique } = await import('../core/clique.js')
  const gone = path.join(FOLDERS, 'gone')
  const inHome = fs.mkdtempSync(path.join(os.homedir(), '.clique-test-folder-'))
  fs.writeFileSync(CONFIG, JSON.stringify({ workspaces: [
    { id: 'storefront', name: 'Storefront', folder: API }, { id: 'home', folder: `~${path.sep}${path.basename(inHome)}` },
    { id: 'notes', name: 'Notes' }, { id: 'old', folder: gone }, { id: 'file', folder: path.join(API, 'a.txt') },
  ] }))
  fs.writeFileSync(path.join(API, 'a.txt'), '')
  const c = new Clique({ bin: BIN, computerName: 'test' })
  try {
    assert.equal(c.workspaceFolder('storefront'), API)
    assert.equal(c.workspaceFolder(), API, 'the one on screen, when none is named')
    assert.equal(c.workspaceFolder('home'), inHome)
    assert.throws(() => c.workspaceFolder('notes'), /Notes has no folder/)
    assert.throws(() => c.workspaceFolder('old'), /gone isn't on this computer any more/)
    assert.throws(() => c.workspaceFolder('file'), /isn't on this computer any more/, 'a file is not a folder to open')
    assert.throws(() => c.workspaceFolder('../../etc'), /no such workspace/, 'a workspace, never a path')
  } finally {
    quit(c)
    fs.rmSync(inHome, { recursive: true, force: true })
    fs.rmSync(path.join(API, 'a.txt'), { force: true })
  }
})

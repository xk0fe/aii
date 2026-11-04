// Workspaces: what config.json says each one is made of, a hub per workspace with its own chat, notes, tasks and
// conversations, shared agents edited from any of them, and agents' requests reaching their own workspace's hub.
// Real Hubs on one config and one fake runner, a throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIN } from './helpers/platform.mjs'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-workspaces-'))
// no codex to discover once a hub starts; on Windows the agents' CLIs are found on PATH before they start, and the
// stand-in codex there (test/helpers/clis.mjs) can't run, which is as good
if (process.platform !== 'win32') process.env.PATH = '/usr/bin:/bin'
const HOME = process.env.CREW_HOME
const { Hub, CONFIG, openConfig, fileKey, filePath } = await import('../core/hub.js')
const { DEFAULT, dirOf, space, workspacesIn, forget, renameShared, sharedNames } = await import('../core/workspaces.js')
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
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-workspaces-folders-'))
const [OWN, API, APP] = ['own', 'api', 'app'].map((d) => path.join(ROOT, d))
for (const d of [OWN, API, APP]) fs.mkdirSync(d)
const storefront = () => ({
  id: 'storefront', name: 'Storefront', folder: API,
  members: { june: {}, ada: { folder: APP } },
  agents: [{ name: 'milo', area: 'docs' }],
  triage: 'june',
})
const roster = () => [{ name: 'june', area: 'backend', cwd: OWN }, { name: 'ada', area: 'app', off: true }, { name: 'iris', area: 'design' }]

let runner, config, hubs, home, ws
// A Crew's hubs on config.json as `raw` says, picking up what the workspaces kept from before.
function crew(raw = { autopilot: true, agents: roster(), workspaces: [storefront()] }) {
  fs.writeFileSync(CONFIG, JSON.stringify(raw))
  runner = new FakeRunner()
  config = openConfig()
  config.load()
  hubs = new Map()
  const locks = { files: new Map(), held: new Map(), waits: [] } // as Crew shares them
  for (const id of [DEFAULT, ...workspacesIn(config.data).map((w) => w.id)]) {
    const hub = new Hub(new Scoped(runner, id, id === DEFAULT), { bin: BIN, workspace: id, config, token: 'tok', locks })
    hub.others = () => [...hubs.values()].filter((h) => h !== hub)
    hub.hubOf = (ws) => hubs.get(ws)
    hubs.set(id, hub)
  }
  home = hubs.get(DEFAULT)
  ws = hubs.get('storefront')
}
const saved = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
beforeEach(() => {
  for (const dir of [HOME, dirOf(HOME, 'storefront')]) for (const f of ['feed.jsonl', 'board.md', 'tickets.json', 'sessions.json', 'conversations.json', 'stats.json', 'spend.json']) fs.rmSync(path.join(dir, f), { force: true })
  crew()
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
  fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 10 })
})

// ---- what config.json says ------------------------------------------------------------------------------

test('the default workspace has every shared agent, each in its own folder, with the top-level settings', () => {
  const s = space({ autopilot: false, triage: 'iris', agents: roster(), workspaces: [storefront()] }, DEFAULT)
  assert.deepEqual(s.agents.map((a) => [a.name, a.cwd, Boolean(a.off), a.shared]), [['june', OWN, false, true], ['ada', undefined, true, true], ['iris', undefined, false, true]])
  assert.equal(s.autopilot, false)
  assert.equal(s.triage, 'iris')
  assert.equal(dirOf(HOME, DEFAULT), HOME, 'its files stay where Crew always kept them')
})

test("another workspace: its members and its own agents, each in the most specific folder there is", () => {
  const s = space({ autopilot: false, agents: roster(), workspaces: [storefront()] }, 'storefront')
  assert.deepEqual(s.agents.map((a) => [a.name, a.cwd, Boolean(a.off), a.shared]), [
    ['june', API, false, true], // the workspace's folder, over its own
    ['ada', APP, false, true], // its folder here, over the workspace's; and off in the default only
    ['milo', API, false, false], // the workspace's own agent, in the workspace's folder
  ])
  assert.equal(s.name, 'Storefront')
  assert.equal(s.autopilot, false, "autopilot as the default's until the workspace says otherwise")
  assert.equal(s.triage, 'june')
  assert.equal(dirOf(HOME, 'storefront'), path.join(HOME, 'workspaces', 'storefront'))
  const bare = space({ agents: roster(), workspaces: [{ id: 'side', members: { june: {}, iris: {} } }] }, 'side')
  assert.deepEqual(bare.agents.map((a) => a.cwd), [OWN, undefined], 'no folder anywhere but its own: its own, else home')
})

test('workspace ids that could not name a folder, or name one twice, are left out; so is an own agent with a taken name', () => {
  const config = { agents: roster(), workspaces: [{ id: 'storefront' }, { id: 'storefront' }, { id: 'default' }, { id: '../x' }, { id: 'Big' }, null, { id: 'ok-2' }] }
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
  assert.equal(config.autopilot, undefined, "the default's stays")
  assert.equal(config.workspaces[0].triage, 'milo')
})

test('a shared agent renamed or taken off the roster: every workspace it is in follows', () => {
  const config = { triage: 'june', agents: roster(), workspaces: [storefront(), { id: 'side', members: { iris: {} } }] }
  renameShared(config, 'june', 'jo')
  assert.equal(config.agents[0].name, 'jo')
  assert.deepEqual(Object.keys(config.workspaces[0].members), ['jo', 'ada'], 'in the same place')
  assert.equal(config.workspaces[0].triage, 'jo')
  assert.equal(config.triage, 'jo')
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
  crew(saved())
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
  process.env.CREW_WORKSPACE = 'storefront' // Crew itself started from a storefront agent's terminal
  t.after(() => delete process.env.CREW_WORKSPACE)
  home.start('http://127.0.0.1:1')
  ws.start('http://127.0.0.1:1')
  assert.deepEqual([...runner.live.keys()].sort(), ['iris', 'june', 'storefront/ada', 'storefront/june', 'storefront/milo'])
  const at = (n) => runner.live.get(n)
  assert.equal(at('june').cwd, OWN)
  assert.equal(at('storefront/june').cwd, API)
  assert.equal(at('storefront/ada').cwd, APP)
  assert.equal(at('june').env.CREW_WORKSPACE, '', "the default: as agents started before workspaces, whatever Crew's own is")
  assert.equal(at('storefront/june').env.CREW_WORKSPACE, 'storefront')
  assert.equal(at('storefront/milo').env.CREW_GROUPS.startsWith(path.join(HOME, 'workspaces', 'storefront', 'run', 'groups') + path.sep), true)
  assert.equal(at('june').env.CREW_AGENT, 'june')
  assert.equal(at('storefront/june').env.CREW_AGENT, 'june', 'its name, without the workspace')
})

test('a parked workspace starts nothing, and its terminals are its own', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-ws-folder-'))
  crew({ agents: [{ name: 'june', area: 'backend', cwd: tmp }], workspaces: [{ id: 'storefront', folder: tmp, members: { june: {} }, parked: true }] })
  ws.start('http://127.0.0.1:1')
  assert.equal(runner.live.size, 0)
  home.start('http://127.0.0.1:1')
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
  assert.ok(home.agents.has('pat'))
  assert.equal(home.agents.get('pat').off, true, 'off in the default until turned on there')
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

test('an agent out of a workspace: its own one is gone, a shared one only leaves; out of the default, it leaves everywhere', () => {
  ws.saveSession('june', 'sess-storefront')
  ws.stats.june = { first: 1, days: {}, tasks: 3 }
  ws.removeAgent('milo')
  assert.ok(!ws.agents.has('milo'))
  assert.deepEqual(saved().workspaces[0].agents, [])
  ws.removeAgent('ada')
  assert.ok(!ws.agents.has('ada'))
  assert.ok(home.agents.has('ada'), 'still yours')
  assert.deepEqual(Object.keys(saved().workspaces[0].members), ['june'])
  home.removeAgent('june')
  assert.ok(!home.agents.has('june') && !ws.agents.has('june'))
  assert.deepEqual(saved().workspaces[0].members, {})
  assert.equal(ws.sessions.june, undefined, 'what storefront kept about it goes too')
  assert.equal(ws.stats.june, undefined)
})

test('a shared agent renamed while it works in a parked workspace carries on there under its new name', () => {
  crew({ autopilot: true, agents: roster(), workspaces: [{ ...storefront(), parked: true }] })
  ws.start('http://127.0.0.1:1')
  runner.live.set('storefront/june', {}) // it outlived the last Crew
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-ws-folder-'))
  crew({ agents: [{ name: 'june', area: 'backend' }], workspaces: [{ id: 'storefront', folder: tmp, members: { june: {} }, autofix: true }] })
  ws.start('http://127.0.0.1:1')
  assert.ok(runner.running('storefront/june'))
  assert.equal(ws.snapshot().tasks.autofix, true)
  assert.equal(home.snapshot().tasks.autofix, false)
  ws.setAutopilot(false)
  assert.equal(saved().workspaces[0].autopilot, false)
  assert.equal(home.snapshot().autopilot, true)
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'june', area: 'backend' }] }))
  config.load()
  assert.ok(!runner.running('storefront/june'))
  assert.equal(ws.agents.size, 0)
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 })
})

// ---- agents' requests reach their own workspace -----------------------------------------------------------

test("`crew` and the hooks say which workspace they're from, and land there", async () => {
  const server = await serve({ token: 'tok', hubFor: (id) => hubs.get(id) })
  fs.writeFileSync(path.join(HOME, 'url'), `http://127.0.0.1:${server.address().port}`)
  fs.writeFileSync(path.join(HOME, 'token'), 'tok')
  // as agents run them: bin/crew and sh hooks on macOS; crew.exe, and crew-hook.exe started with no shell, on Windows,
  // both running bin/crew.mjs with CREW_NODE (core/launch.js, core/adapters.js)
  const run = (file, args, env, input = '') =>
    new Promise((resolve, reject) => execFile(file, args, { env: { ...process.env, CREW_HOME: HOME, CREW_NODE: process.execPath, ...env } }, (e, out) => (e ? reject(e) : resolve(out))).stdin.end(input))
  const crewCli = (env, ...args) => (WIN ? run(path.join(toolsDir(BIN), 'crew.exe'), args, env) : run(path.join(BIN, 'crew'), args, env))
  assert.equal(await crewCli({ CREW_AGENT: 'june', CREW_WORKSPACE: 'storefront' }, 'note', 'storefront runs on pnpm'), 'shared with the crew\n')
  assert.equal(await crewCli({ CREW_AGENT: 'june', CREW_WORKSPACE: '' }, 'note', 'the default runs on npm'), 'shared with the crew\n')
  assert.match(ws.board(), /pnpm/)
  assert.doesNotMatch(ws.board(), /on npm/)
  assert.match(home.board(), /on npm/)
  assert.doesNotMatch(await crewCli({ CREW_WORKSPACE: 'storefront' }, 'who'), /\bgal\b/, 'only who is in storefront')
  assert.match(await crewCli({ CREW_WORKSPACE: 'gone' }, 'who'), /no workspace "gone"/)
  // a hook: to the hub while Crew is there, to storefront's spool while it isn't, and replayed in storefront
  const hook = JSON.parse(adapters.claude({ name: 'milo' }, { session: 's', attachments: os.tmpdir(), bin: BIN }).args.find((x) => x.startsWith('{"permissions"'))).hooks.UserPromptSubmit[0].hooks[0]
  const env = { CREW_AGENT: 'milo', CREW_WORKSPACE: 'storefront' }
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

test('Crew keeps a hub for each workspace in config.json: open ones run, parked ones wait', async () => {
  const { Crew } = await import('../core/crew.js')
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'june', area: 'backend', off: true }], workspaces: [{ id: 'storefront', folder: API, members: { june: {} }, parked: true }] }))
  const c = new Crew({ bin: BIN, computerName: 'test' })
  await c.start()
  try {
    assert.deepEqual([...c.hubs.keys()], [DEFAULT, 'storefront'])
    assert.equal(c.hub, c.hubs.get(DEFAULT))
    assert.equal(c.hubs.get('storefront').parked, true)
    assert.ok(c.hubs.get('storefront').agents.has('june'))
    assert.ok(!c.runner.running('storefront/june'), 'on there, but not started until storefront is opened')
    // the agents' logs don't say which workspace they worked in: only the default looks back through them for spend
    assert.equal(c.hub.lookingBack, true)
    assert.ok(!c.hubs.get('storefront').lookingBack)
    // a workspace added by hand gets its hub, open unless it says it's parked; one taken out loses it
    fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'june', area: 'backend', off: true }], workspaces: [{ id: 'side', members: { june: { off: true } } }] }))
    c.config.load()
    assert.deepEqual([...c.hubs.keys()], [DEFAULT, 'side'])
    assert.equal(c.hubs.get('side').parked, false)
    // its agents talk to it through the one server
    const res = await fetch(`${c.hub.url}/who`, { headers: { 'x-crew': c.token, 'x-crew-workspace': 'side' } })
    assert.match(await res.text(), /june/)
    // your accounts' usage limits are one record, whichever workspace's agent reported them
    assert.equal(c.hubs.get('side').usage, c.hub.usage)
    c.hubs.get('side').usage.claude = { told: {}, at: 1, windows: [] }
    c.hubs.get('side').saveUsage(true)
    c.hub.saveUsage(true)
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(HOME, 'usage.json'), 'utf8'))), ['claude'])
  } finally {
    c.server.close()
    c.stop()
    for (const h of c.hubs.values()) h.dispose()
  }
})

test("a config.json that can't be read is said in the default workspace's chat, once, and Crew carries on as it was", () => {
  fs.writeFileSync(CONFIG, '{ "agents": [ oops')
  const cfg = openConfig()
  const first = new Hub(new Scoped(new FakeRunner(), DEFAULT, true), { bin: BIN, config: cfg, token: 'tok' })
  const other = new Hub(new Scoped(new FakeRunner(), 'storefront', false), { bin: BIN, workspace: 'storefront', config: cfg, token: 'tok' })
  try {
    assert.match(first.feed.at(-1)?.text ?? '', /^CLIque couldn't read its settings \(.*config\.json: .*\), so it carries on with the ones it had$/)
    assert.equal(first.space.autopilot, true)
    assert.equal(first.config.theme, 'system')
    assert.equal(first.agents.size, 0)
    assert.ok(!other.feed.some((e) => /config\.json/.test(e.text ?? '')))
    assert.equal(first.feed.filter((e) => /config\.json/.test(e.text ?? '')).length, 1)
  } finally {
    first.dispose()
    other.dispose()
  }
})

test("terminals still running for a workspace that's gone from config.json are stopped, and the chat says so", async () => {
  const { Crew } = await import('../core/crew.js')
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'june', area: 'backend', off: true }] }))
  const c = new Crew({ bin: BIN, computerName: 'test' })
  const killed = []
  const proc = (name) => ({ p: { pid: 1, kill: () => killed.push(name), onExit: (fn) => fn() } })
  c.runner.procs.set('old/milo', proc('old/milo'))
  c.runner.connect = async () => (c.runner.survivors = [{ name: 'old/milo', tag: 't1', pid: 1 }])
  await c.start()
  try {
    assert.deepEqual(killed, ['old/milo'])
    assert.match(c.hub.feed.at(-1).text, /stopped old\/milo: it was still running for a workspace that's been removed/)
  } finally {
    c.server.close()
    c.stop()
    for (const h of c.hubs.values()) h.dispose()
  }
})

// ---- workspaces from the app: making, switching, parking -----------------------------------------------

// A Crew on config.json as `raw` says, not started: workspaces are made and switched without any agent running.
async function crewApp(raw) {
  const { Crew } = await import('../core/crew.js')
  fs.writeFileSync(CONFIG, JSON.stringify(raw))
  const c = new Crew({ bin: BIN, computerName: 'test' })
  clearTimeout(c.changeTimer)
  return c
}
const quit = (c) => {
  clearTimeout(c.changeTimer)
  for (const h of c.hubs.values()) h.dispose()
}

test('a workspace made in the app: its look, folder and crew, then on screen; renamed, and removed with its files kept', async () => {
  const c = await crewApp({ agents: roster() })
  try {
    assert.deepEqual(c.workspaces().map((w) => [w.id, w.name, w.current]), [[DEFAULT, 'Home', true]], 'no workspaces yet: the default, called Home')
    const { id, state } = c.workspaceAction('create', null, { name: 'Storefront app', color: 'teal', icon: '🛒', folder: API, members: ['june', 'nobody'] })
    assert.equal(id, 'storefront-app')
    assert.deepEqual(saved().workspaces, [{ id: 'storefront-app', name: 'Storefront app', members: { june: {} }, color: 'teal', icon: '🛒', folder: API }])
    assert.equal(saved().current, 'storefront-app')
    assert.equal(state.workspace.id, 'storefront-app', 'the new one is on screen')
    assert.deepEqual(state.agents.map((a) => [a.name, a.cwd, a.shared]), [['june', API, true]])
    assert.deepEqual(state.workspaces.map((w) => [w.id, w.current, w.parked]), [[DEFAULT, false, false], ['storefront-app', true, false]])
    assert.equal(c.workspaceAction('create', null, { name: 'Storefront app' }).id, 'storefront-app-2', 'a name taken gets a number')
    assert.throws(() => c.workspaceAction('create', null, { name: '  ' }), /name/)
    // renamed, the default too, which keeps its look at the top level
    c.workspaceAction('edit', 'storefront-app', { name: 'Storefront', color: '', icon: '🏌️' })
    c.workspaceAction('edit', DEFAULT, { name: 'Studio', color: 'pink', folder: '/nope' })
    assert.deepEqual([saved().workspaces[0].name, saved().workspaces[0].color, saved().workspaces[0].icon], ['Storefront', undefined, '🏌️'])
    assert.deepEqual([saved().name, saved().color, saved().folder], ['Studio', 'pink', undefined], "the default has no folder: each agent works in its own")
    // switching is remembered in config.json; removing the one on screen goes back to the default
    c.workspaceAction('switch', DEFAULT)
    assert.equal(saved().current, undefined)
    c.workspaceAction('switch', 'storefront-app')
    fs.mkdirSync(path.join(HOME, 'workspaces', 'storefront-app'), { recursive: true })
    fs.writeFileSync(path.join(HOME, 'workspaces', 'storefront-app', 'board.md'), 'kept')
    c.workspaceAction('remove', 'storefront-app')
    assert.deepEqual(c.workspaces().map((w) => w.id), [DEFAULT, 'storefront-app-2'])
    assert.equal(c.here, c.hub)
    assert.equal(fs.readFileSync(path.join(HOME, 'workspaces', 'storefront-app', 'board.md'), 'utf8'), 'kept', 'its files stay, for if it comes back')
    assert.throws(() => c.workspaceAction('remove', DEFAULT), /can't be removed/)
    assert.throws(() => c.workspaceAction('switch', 'nope'), /no such workspace/)
  } finally {
    quit(c)
  }
})

test('a workspace asleep wakes when you go to it, and when you send it a message: no Open to press', async () => {
  const c = await crewApp({ agents: roster(), workspaces: [{ ...storefront(), parked: true }] })
  try {
    c.workspaceAction('switch', 'storefront')
    assert.equal(saved().workspaces[0].parked, undefined, 'going there woke it (and left nothing behind in config.json)')
    c.workspaceAction('park', 'storefront')
    assert.equal(saved().workspaces[0].parked, true, 'put to sleep while on screen')
    c.workspaceAction('switch', DEFAULT)
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

test('the order workspaces are listed in: changed from the app, the default first, the ones not named after the rest', async () => {
  const c = await crewApp({ agents: roster(), workspaces: [storefront()] })
  try {
    c.workspaceAction('create', null, { name: 'Docs' })
    c.workspaceAction('create', null, { name: 'Lab' })
    assert.deepEqual(c.workspaces().map((w) => w.id), [DEFAULT, 'storefront', 'docs', 'lab'])
    const { state } = c.workspaceAction('order', null, ['lab', DEFAULT, 'storefront'])
    assert.deepEqual(saved().workspaces.map((w) => w.id), ['lab', 'storefront', 'docs'], 'the default isn\'t in the list to move')
    assert.deepEqual(state.workspaces.map((w) => w.id), [DEFAULT, 'lab', 'storefront', 'docs'], 'the default stays first')
    c.config.data.workspaces.push(null) // a hand-edited config.json with a hole in it
    c.workspaceAction('order', null, ['docs', 'nope'])
    assert.deepEqual(c.workspaces().map((w) => w.id), [DEFAULT, 'docs', 'lab', 'storefront'], 'unknown ids are ignored; the rest keep their order')
  } finally {
    quit(c)
  }
})

test("who works in a workspace: shared agents join and leave from the app, each with a folder of its own there or the workspace's", async () => {
  const c = await crewApp({ agents: roster(), workspaces: [storefront()] })
  try {
    c.workspaceAction('members', 'storefront', { add: ['iris', 'nobody'], remove: ['ada'], folders: { iris: APP, june: '' } })
    assert.deepEqual(saved().workspaces[0].members, { june: {}, iris: { folder: APP } })
    const w = c.workspaces().find((x) => x.id === 'storefront')
    assert.deepEqual(w.members, [{ name: 'june', folder: '' }, { name: 'iris', folder: APP }])
    assert.deepEqual(c.hubs.get('storefront').space.agents.map((a) => [a.name, a.cwd]), [['june', API], ['iris', APP], ['milo', API]])
    assert.throws(() => c.workspaceAction('members', DEFAULT, { add: ['iris'] }), /every shared agent/)
    // in Home, each agent's own folder: where it works there
    c.workspaceAction('members', DEFAULT, { folders: { iris: APP, june: '' } })
    assert.deepEqual(saved().agents.map((a) => [a.name, a.cwd]), [['june', undefined], ['ada', undefined], ['iris', APP]])
    assert.equal(c.snapshot().roster.find((a) => a.name === 'iris').cwd, APP, 'the sheet shows it')
  } finally {
    quit(c)
  }
})

test("what the app does lands in the workspace on screen: its agents, edits, new agents and tasks; a linked computer's agents show in the workspace it has too", async () => {
  const c = await crewApp({ agents: roster(), workspaces: [storefront()], current: 'storefront' })
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
    assert.equal(c.hub.tickets.all.length, 0)
    // a linked computer's default agents are in the default here; it has no storefront, so none of its agents are in storefront
    c.links.set('laptop', { slug: 'laptop', name: 'Laptop', peer: {}, toHost: new Map(), fetching: new Set(), state: { agents: [{ name: 'bo', status: 'idle' }], feed: [], tasks: { tickets: [] }, providers: {} } })
    assert.equal(c.snapshot().agents.some((a) => a.home), false)
    await assert.rejects(() => c.moveAgent('milo', 'laptop'), /Laptop has no Storefront workspace/)
    c.workspaceAction('switch', DEFAULT)
    assert.deepEqual(c.snapshot().agents.filter((a) => a.home).map((a) => a.name), ['bo@laptop'])
  } finally {
    quit(c)
  }
})

test('parking a workspace stops its agents and keeps their conversations; opening it starts them again, resuming', () => {
  ws.update('ada', { off: true })
  ws.start('http://127.0.0.1:1')
  ws.saveSession('june', 'sess-storefront')
  assert.ok(runner.running('storefront/june') && runner.running('storefront/milo'))
  ws.agents.get('june').status = 'working'
  ws.space.parked = true
  ws.saveConfig()
  assert.equal(ws.parked, true)
  assert.equal(saved().workspaces[0].parked, true)
  assert.ok(!runner.running('storefront/june') && !runner.running('storefront/milo'), 'its agents stop')
  assert.equal(ws.sessions.june, 'sess-storefront', 'their conversations wait')
  assert.match(ws.feed.at(-1).text, /^went to sleep: @june, @milo stopped/, 'one line in its chat, not one per agent')
  const shown = ws.snapshot()
  assert.equal(shown.parked, true)
  assert.deepEqual(shown.agents.map((a) => [a.name, a.status]), [['june', 'parked'], ['ada', 'off'], ['milo', 'parked']])
  assert.deepEqual([ws.summary().on, ws.summary().working], [2, 0])
  // by hand in config.json too: opened, its agents start, picking their conversations back up
  const raw = saved()
  delete raw.workspaces[0].parked
  fs.writeFileSync(CONFIG, JSON.stringify(raw))
  config.load()
  assert.equal(ws.parked, false)
  assert.ok(runner.running('storefront/june') && runner.running('storefront/milo'))
  assert.ok(runner.live.get('storefront/june').args.includes('sess-storefront'), 'resumes its conversation')
  assert.match(ws.feed.at(-1).text, /^woke up: @june, @milo pick up where they left off/)
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
  crew({ autopilot: true, agents: roster(), workspaces: [{ ...storefront(), parked: true }] })
  ws.start('http://127.0.0.1:1')
  ws.saveSession('june', 'sess-storefront')
  assert.throws(() => ws.restart('june'), /asleep: send a message there to wake it/)
  ws.freshStart('june')
  assert.equal(runner.running('storefront/june'), false)
  assert.equal(ws.sessions.june, undefined, 'it starts fresh when the workspace opens')
})

test("made with members' own folders, they start there the first time; a shared agent can't take an own agent's name there", async () => {
  const c = await crewApp({ agents: [...roster(), { name: 'milo', area: 'shared docs' }], workspaces: [storefront()] })
  try {
    let pushed = null
    c.on('state', (s) => (pushed = s))
    c.workspaceAction('create', null, { name: 'Site', folder: API, members: ['june', 'iris'], folders: { iris: APP } })
    assert.deepEqual(saved().workspaces[1].members, { june: {}, iris: { folder: APP } })
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
  const c = await crewApp({ agents: roster(), workspaces: [storefront()] })
  try {
    const notices = []
    c.on('notice', (n) => notices.push(n))
    const home = c.hub
    const g = c.hubs.get('storefront')
    const at = Date.now() + 3600e3
    g.setUsage('claude', [{ id: 'five_hour', pct: 81, resetsAt: at }]) // a Storefront agent's status line, Home on screen
    home.setUsage('claude', [{ id: 'five_hour', pct: 82, resetsAt: at }])
    const said = (h) => h.feed.filter((e) => /5-hour limit, resets/.test(e.text ?? '')).length
    assert.deepEqual([said(home), said(g)], [1, 0], 'once, in the workspace on screen')
    assert.ok(notices.length >= 1 && notices.every((n) => n.account && !('workspace' in n)), "its notification is no workspace's")
    assert.equal(g.samples, home.samples, 'one record of readings')
    assert.equal(g.samples.claude.five_hour.length, 2)
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
  assert.doesNotMatch(no.permissionDecisionReason, /crew ask/, "it can't ask an agent in another workspace")
  assert.match(ws.feed.at(-1).file, /rates\.js/)
  assert.equal(ws.feed.at(-1).in, 'Home')
  assert.ok(ws.lease('june', edit(file)), "Storefront's june is another agent: turned away too")
  home.release('june') // its turn ends
  assert.equal(ws.lease('milo', edit(file)), '')
  // held under the file's key (on Windows its path in lower case)
  assert.equal(home.leases.get(fileKey(filePath(file, API))).ws, 'storefront', 'one record: Home sees Storefront has it')
})

test('crew lease: one simulator for every workspace; it goes to whoever waits for it, in any of them', async () => {
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

test('a linked computer: its terminals show in their own workspace, typing reaches the right one, and an older Crew is told to update', async () => {
  const c = await crewApp({ agents: roster(), workspaces: [storefront()], current: 'storefront' })
  try {
    const { EventEmitter: Emitter } = await import('node:events')
    const peer = Object.assign(new Emitter(), { name: 'Laptop', push() {}, input() {}, close() {} })
    peer.call = async (fn) => {
      if (fn === 'state') return { agents: [], feed: [], tasks: { tickets: [] }, providers: {} }
      throw new Error(`"${fn}" isn't available over Crew Link`) // an older Crew: no workspaces
    }
    const l = c.attach(peer)
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(l.aware, false, "it didn't answer 'workspaces'")
    const pty = []
    c.on('pty', (n, d) => pty.push([n, d]))
    const key = c.keyOf('storefront')
    peer.emit('pty', `${key}/milo`, 'storefront output')
    peer.emit('pty', 'storefront/milo', 'by bare id') // an older Crew's way: no workspace here has that key
    peer.emit('pty', 'ann', 'default output') // the default's, while storefront is on screen
    assert.deepEqual(pty, [['milo@laptop', 'storefront output']])
    const typed = []
    for (const [id, h] of c.hubs) h.input = (n, d) => typed.push([id, n, d])
    peer.emit('input', `${key}/june`, 'y')
    peer.emit('input', 'storefront/june', 'x')
    peer.emit('input', 'june', 'n')
    assert.deepEqual(typed, [['storefront', 'june', 'y'], ['default', 'june', 'n']])
    await assert.rejects(c.linkCall(l, 'update', [['milo'], {}]), /Laptop runs an older CLIque, without workspaces: update it/)
  } finally {
    quit(c)
  }
})

test("a linked computer's own workspaces can be joined while it's on, and stay listed, unavailable, once it's off", async () => {
  const c = await crewApp({ agents: roster(), workspaces: [storefront()] })
  try {
    const { EventEmitter: Emitter } = await import('node:events')
    const pushed = []
    const peer = Object.assign(new Emitter(), { name: 'Laptop', push: (...m) => pushed.push(m), input() {}, close() {} })
    peer.call = async (fn) => {
      if (fn === 'state') return { agents: [], feed: [], tasks: { tickets: [] }, providers: {} }
      if (fn === 'workspaces') return [
        { key: 'laptop:storefront', owner: 'laptop', name: 'Storefront', color: 'not a color!' },
        { key: c.keyOf('storefront'), owner: c.me.slug, name: 'Storefront' }, // joined there from here: not the laptop's to offer
        { key: 'bad/key', owner: 'laptop', name: 'x' },
      ]
      throw new Error(`"${fn}" isn't available over Crew Link`)
    }
    const l = c.attach(peer)
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual([...l.theirs], ['storefront'], 'the one with our key')
    assert.ok(pushed.some(([t, key]) => t === 'ws' && key === c.keyOf('storefront')), 'it gets ours by key')
    assert.deepEqual(c.remoteWorkspaces().map((w) => [w.key, w.name, w.computerName, w.online, w.joined]), [['laptop:storefront', 'Storefront', 'Laptop', true, null]])
    // the same name as ours, joined under its own id; a look this version can't show is dropped, not fatal
    const { id } = c.workspaceAction('join', 'laptop:storefront')
    assert.equal(id, 'storefront-2')
    assert.equal(c.keyOf(id), 'laptop:storefront')
    assert.equal(c.snapshot().workspace.ownerName, 'Laptop')
    // it goes offline: still listed, unavailable, and a new one can't be joined
    peer.emit('close')
    const left = c.remoteWorkspaces()
    assert.deepEqual(left.map((w) => [w.key, w.online, w.joined]), [['laptop:storefront', false, 'storefront-2']])
    assert.equal(c.workspaces().find((w) => w.id === id).ownerOnline, false)
    c.knownSpaces.get('laptop').list.push({ key: 'laptop:lab', owner: 'laptop', name: 'Lab' })
    assert.throws(() => c.workspaceAction('join', 'laptop:lab'), /Laptop is offline/)
  } finally {
    quit(c)
  }
})

test("a connection that loses to another doesn't take the winner's workspaces with it", async () => {
  const c = await crewApp({ agents: roster(), workspaces: [storefront()] })
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

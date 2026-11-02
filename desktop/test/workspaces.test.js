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

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-workspaces-'))
process.env.PATH = '/usr/bin:/bin' // no codex to discover once a hub starts
const HOME = process.env.CREW_HOME
const { Hub, CONFIG, openConfig } = await import('../core/hub.js')
const { DEFAULT, dirOf, space, workspacesIn, forget, renameShared, sharedNames } = await import('../core/workspaces.js')
const { Scoped } = await import('../core/runner.js')
const { serve } = await import('../core/server.js')
const { adapters } = await import('../core/adapters.js')
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
const golf = () => ({
  id: 'golf', name: 'Golf', folder: API,
  members: { joseph: {}, david: { folder: APP } },
  agents: [{ name: 'kim', area: 'docs' }],
  triage: 'joseph',
})
const roster = () => [{ name: 'joseph', area: 'backend', cwd: OWN }, { name: 'david', area: 'app', off: true }, { name: 'gal', area: 'design' }]

let runner, config, hubs, home, ws
// A Crew's hubs on config.json as `raw` says, picking up what the workspaces kept from before.
function crew(raw = { autopilot: true, agents: roster(), workspaces: [golf()] }) {
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
  ws = hubs.get('golf')
}
const saved = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
beforeEach(() => {
  for (const dir of [HOME, dirOf(HOME, 'golf')]) for (const f of ['feed.jsonl', 'board.md', 'tickets.json', 'sessions.json', 'conversations.json', 'stats.json', 'spend.json']) fs.rmSync(path.join(dir, f), { force: true })
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
  const s = space({ autopilot: false, triage: 'gal', agents: roster(), workspaces: [golf()] }, DEFAULT)
  assert.deepEqual(s.agents.map((a) => [a.name, a.cwd, Boolean(a.off), a.shared]), [['joseph', OWN, false, true], ['david', undefined, true, true], ['gal', undefined, false, true]])
  assert.equal(s.autopilot, false)
  assert.equal(s.triage, 'gal')
  assert.equal(dirOf(HOME, DEFAULT), HOME, 'its files stay where Crew always kept them')
})

test("another workspace: its members and its own agents, each in the most specific folder there is", () => {
  const s = space({ autopilot: false, agents: roster(), workspaces: [golf()] }, 'golf')
  assert.deepEqual(s.agents.map((a) => [a.name, a.cwd, Boolean(a.off), a.shared]), [
    ['joseph', API, false, true], // the workspace's folder, over its own
    ['david', APP, false, true], // its folder here, over the workspace's; and off in the default only
    ['kim', API, false, false], // the workspace's own agent, in the workspace's folder
  ])
  assert.equal(s.name, 'Golf')
  assert.equal(s.autopilot, false, "autopilot as the default's until the workspace says otherwise")
  assert.equal(s.triage, 'joseph')
  assert.equal(dirOf(HOME, 'golf'), path.join(HOME, 'workspaces', 'golf'))
  const bare = space({ agents: roster(), workspaces: [{ id: 'side', members: { joseph: {}, gal: {} } }] }, 'side')
  assert.deepEqual(bare.agents.map((a) => a.cwd), [OWN, undefined], 'no folder anywhere but its own: its own, else home')
})

test('workspace ids that could not name a folder, or name one twice, are left out; so is an own agent with a taken name', () => {
  const config = { agents: roster(), workspaces: [{ id: 'golf' }, { id: 'golf' }, { id: 'default' }, { id: '../x' }, { id: 'Big' }, null, { id: 'ok-2' }] }
  assert.deepEqual(workspacesIn(config).map((w) => w.id), ['golf', 'ok-2'])
  const s = space({ agents: roster(), workspaces: [{ id: 'w', members: { gal: {} }, agents: [{ name: 'gal' }, { name: 'kim' }, { name: 'kim' }] }] }, 'w')
  assert.deepEqual(s.agents.map((a) => [a.name, a.shared]), [['gal', true], ['kim', false]])
  assert.equal(space(config, 'nope'), null)
})

test("where it works and whether it's on are the workspace's; who it is is the agent's", () => {
  const config = { agents: roster(), workspaces: [golf()] }
  const s = space(config, 'golf')
  s.set('joseph', 'cwd', '~/code/api-v2')
  s.set('joseph', 'off', true)
  s.set('joseph', 'model', 'opus')
  s.set('kim', 'cwd', '~/docs')
  s.autopilot = false
  s.triage = 'kim'
  assert.deepEqual(config.workspaces[0].members.joseph, { folder: '~/code/api-v2', off: true })
  assert.equal(config.agents[0].cwd, OWN, 'its own folder stays')
  assert.equal(config.agents[0].off, undefined)
  assert.equal(config.agents[0].model, 'opus', 'the same agent everywhere')
  assert.equal(config.workspaces[0].agents[0].cwd, '~/docs')
  assert.equal(config.workspaces[0].autopilot, false)
  assert.equal(config.autopilot, undefined, "the default's stays")
  assert.equal(config.workspaces[0].triage, 'kim')
})

test('a shared agent renamed or taken off the roster: every workspace it is in follows', () => {
  const config = { triage: 'joseph', agents: roster(), workspaces: [golf(), { id: 'side', members: { gal: {} } }] }
  renameShared(config, 'joseph', 'jo')
  assert.equal(config.agents[0].name, 'jo')
  assert.deepEqual(Object.keys(config.workspaces[0].members), ['jo', 'david'], 'in the same place')
  assert.equal(config.workspaces[0].triage, 'jo')
  assert.equal(config.triage, 'jo')
  assert.deepEqual([...sharedNames(config, 'jo')].sort(), ['david', 'gal', 'jo', 'kim'], "names it can't take: shared ones, and the own agents of a workspace it's in")
  assert.deepEqual([...sharedNames(config, 'gal')].sort(), ['david', 'gal', 'jo'])
  forget(config, 'david')
  assert.deepEqual(config.agents.map((a) => a.name), ['jo', 'gal'])
  assert.deepEqual(Object.keys(config.workspaces[0].members), ['jo'])
})

// ---- a hub per workspace --------------------------------------------------------------------------------

test("each workspace's chat, notes, tasks and conversations are its own, in its own folder", () => {
  home.note('gal', 'the default board')
  ws.note('joseph', 'golf uses pnpm')
  home.tickets.add({ title: 'fix the header', by: 'you' })
  ws.tickets.add({ title: 'rate limits', by: 'you' })
  home.saveSession('joseph', 'sess-default')
  ws.saveSession('joseph', 'sess-golf')
  assert.match(home.board(), /the default board/)
  assert.doesNotMatch(home.board(), /pnpm/)
  assert.match(ws.board(), /golf uses pnpm/)
  assert.doesNotMatch(ws.board(), /default board/)
  assert.deepEqual(home.tickets.all.map((t) => t.title), ['fix the header'])
  assert.deepEqual(ws.tickets.all.map((t) => t.title), ['rate limits'])
  assert.ok(home.feed.every((e) => e.text !== 'golf uses pnpm'))
  // on disk: the default's where they always were, golf's in its folder
  const golfDir = path.join(HOME, 'workspaces', 'golf')
  assert.match(fs.readFileSync(path.join(HOME, 'board.md'), 'utf8'), /default board/)
  assert.match(fs.readFileSync(path.join(golfDir, 'board.md'), 'utf8'), /pnpm/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(HOME, 'sessions.json'), 'utf8')).joseph, 'sess-default')
  assert.equal(JSON.parse(fs.readFileSync(path.join(golfDir, 'sessions.json'), 'utf8')).joseph, 'sess-golf')
  // and it all comes back
  crew(saved())
  assert.equal(home.sessions.joseph, 'sess-default')
  assert.equal(ws.sessions.joseph, 'sess-golf')
  assert.deepEqual(ws.tickets.all.map((t) => t.title), ['rate limits'])
})

test('each workspace counts what its work cost, in its own folder', () => {
  ws.onStatusLine('joseph', { session_id: 'sess-golf', cost: { total_cost_usd: 2, total_lines_added: 0, total_lines_removed: 0, total_api_duration_ms: 0 } })
  home.onStatusLine('joseph', { session_id: 'sess-default', cost: { total_cost_usd: 0.5, total_lines_added: 0, total_lines_removed: 0, total_api_duration_ms: 0 } })
  assert.equal(ws.spendNow().today, 2)
  assert.equal(home.spendNow().today, 0.5)
  ws.saveSpend(true)
  home.saveSpend(true)
  const sessions = (dir) => Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'spend.json'), 'utf8')).sessions)
  assert.deepEqual(sessions(dirOf(HOME, 'golf')), ['sess-golf'])
  assert.deepEqual(sessions(HOME), ['sess-default'])
})

test("agents start where they work in their workspace, and say which workspace they're in", (t) => {
  process.env.CREW_WORKSPACE = 'golf' // Crew itself started from a golf agent's terminal
  t.after(() => delete process.env.CREW_WORKSPACE)
  home.start('http://127.0.0.1:1')
  ws.start('http://127.0.0.1:1')
  assert.deepEqual([...runner.live.keys()].sort(), ['gal', 'golf/david', 'golf/joseph', 'golf/kim', 'joseph'])
  const at = (n) => runner.live.get(n)
  assert.equal(at('joseph').cwd, OWN)
  assert.equal(at('golf/joseph').cwd, API)
  assert.equal(at('golf/david').cwd, APP)
  assert.equal(at('joseph').env.CREW_WORKSPACE, '', "the default: as agents started before workspaces, whatever Crew's own is")
  assert.equal(at('golf/joseph').env.CREW_WORKSPACE, 'golf')
  assert.equal(at('golf/kim').env.CREW_GROUPS.startsWith(path.join(HOME, 'workspaces', 'golf', 'run', 'groups') + path.sep), true)
  assert.equal(at('joseph').env.CREW_AGENT, 'joseph')
  assert.equal(at('golf/joseph').env.CREW_AGENT, 'joseph', 'its name, without the workspace')
})

test('a parked workspace starts nothing, and its terminals are its own', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-ws-folder-'))
  crew({ agents: [{ name: 'joseph', area: 'backend', cwd: tmp }], workspaces: [{ id: 'golf', folder: tmp, members: { joseph: {} }, parked: true }] })
  ws.start('http://127.0.0.1:1')
  assert.equal(runner.live.size, 0)
  home.start('http://127.0.0.1:1')
  assert.deepEqual([...runner.live.keys()], ['joseph'])
  runner.live.set('golf/joseph', {})
  ws.agents.get('joseph').status = 'idle'
  const seen = []
  ws.runner.on('exit', (name) => seen.push(['golf', name]))
  home.runner.on('exit', (name) => seen.push(['default', name]))
  runner.emit('exit', 'golf/joseph', 0, 10)
  runner.emit('exit', 'joseph', 0, 10)
  assert.deepEqual(seen, [['golf', 'joseph'], ['default', 'joseph']])
  const listening = runner.listenerCount('exit')
  ws.dispose()
  assert.equal(runner.listenerCount('exit'), listening - 1, 'a hub that goes hears no more')
  runner.survivors = [{ name: 'golf/joseph', tag: 't1', pid: 1 }, { name: 'joseph', tag: 't2', pid: 2 }]
  assert.deepEqual(ws.runner.survivors, [{ name: 'joseph', tag: 't1', pid: 1 }])
  assert.deepEqual(home.runner.survivors, [{ name: 'joseph', tag: 't2', pid: 2 }])
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 })
})

test('a shared agent edited in one workspace is that agent in all of them; where it works changes only there', () => {
  ws.update('joseph', { model: 'opus', cwd: '~/code/api-v2' })
  assert.equal(home.agents.get('joseph').model, 'opus')
  assert.equal(ws.agents.get('joseph').model, 'opus')
  assert.equal(ws.agents.get('joseph').cwd, '~/code/api-v2')
  assert.equal(home.agents.get('joseph').cwd, OWN)
  assert.deepEqual(saved().workspaces[0].members.joseph, { folder: '~/code/api-v2' })
  ws.update('joseph', { off: true })
  assert.equal(ws.agents.get('joseph').off, true)
  assert.equal(home.agents.get('joseph').off, undefined, 'off here, still on in the default')
})

test("a new folder for a workspace starts its agents' conversations there afresh; elsewhere they carry on", () => {
  home.saveSession('joseph', 'sess-default')
  ws.saveSession('joseph', 'sess-golf')
  ws.saveSession('kim', 'sess-kim')
  const raw = saved()
  raw.workspaces[0].folder = '~/code/api-v2' // by hand
  fs.writeFileSync(CONFIG, JSON.stringify(raw))
  config.load()
  assert.equal(ws.sessions.joseph, undefined)
  assert.equal(ws.sessions.kim, undefined)
  assert.equal(ws.sessions.david, undefined)
  assert.equal(home.sessions.joseph, 'sess-default')
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
  assert.deepEqual(raw.workspaces[0].agents.map((a) => a.name), ['kim', 'mo'])
  assert.equal(raw.agents.find((a) => a.name === 'pat').cwd, undefined, 'the folder was for here')
  assert.deepEqual(raw.workspaces[0].members.pat, { folder: '~/qa' })
  assert.throws(() => ws.addAgent({ name: 'kim' }), /already exists/)
  assert.throws(() => home.addAgent({ name: 'gal' }), /already exists/)
  assert.equal(home.addAgent({ name: 'kim' }), 'kim', "another workspace's own agent's name is free here")
  assert.throws(() => ws.addAgent({ name: 'kim', shared: true }), /already exists/)
})

test('an agent out of a workspace: its own one is gone, a shared one only leaves; out of the default, it leaves everywhere', () => {
  ws.saveSession('joseph', 'sess-golf')
  ws.stats.joseph = { first: 1, days: {}, tasks: 3 }
  ws.removeAgent('kim')
  assert.ok(!ws.agents.has('kim'))
  assert.deepEqual(saved().workspaces[0].agents, [])
  ws.removeAgent('david')
  assert.ok(!ws.agents.has('david'))
  assert.ok(home.agents.has('david'), 'still yours')
  assert.deepEqual(Object.keys(saved().workspaces[0].members), ['joseph'])
  home.removeAgent('joseph')
  assert.ok(!home.agents.has('joseph') && !ws.agents.has('joseph'))
  assert.deepEqual(saved().workspaces[0].members, {})
  assert.equal(ws.sessions.joseph, undefined, 'what golf kept about it goes too')
  assert.equal(ws.stats.joseph, undefined)
})

test('a shared agent renamed while it works in a parked workspace carries on there under its new name', () => {
  crew({ autopilot: true, agents: roster(), workspaces: [{ ...golf(), parked: true }] })
  ws.start('http://127.0.0.1:1')
  runner.live.set('golf/joseph', {}) // it outlived the last Crew
  ws.agents.get('joseph').status = 'idle'
  home.update('joseph', { name: 'jo' })
  assert.ok(!runner.running('golf/joseph'))
  assert.ok(runner.running('golf/jo'))
  assert.ok(!runner.running('golf/david'), 'the rest stay parked')
})

test('renaming a shared agent from any workspace renames it in all of them, with what each kept about it', () => {
  home.saveSession('joseph', 'sess-default')
  ws.saveSession('joseph', 'sess-golf')
  ws.tickets.add({ title: 'rate limits', by: 'you', owner: 'joseph' })
  ws.update('joseph', { name: 'jo' })
  assert.ok(home.agents.has('jo') && ws.agents.has('jo') && !ws.agents.has('joseph'))
  assert.equal(home.sessions.jo, 'sess-default')
  assert.equal(ws.sessions.jo, 'sess-golf')
  assert.equal(ws.tickets.all[0].owner, 'jo')
  assert.equal(ws.space.triage, 'jo')
  assert.throws(() => home.update('jo', { name: 'kim' }), /already exists/, "kim is golf's, and jo is in golf")
  ws.update('kim', { name: 'kit' })
  assert.deepEqual(saved().workspaces[0].agents.map((a) => a.name), ['kit'])
})

test("a workspace gone from config.json stops its agents; a hub's settings are its workspace's", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-ws-folder-'))
  crew({ agents: [{ name: 'joseph', area: 'backend' }], workspaces: [{ id: 'golf', folder: tmp, members: { joseph: {} }, autofix: true }] })
  ws.start('http://127.0.0.1:1')
  assert.ok(runner.running('golf/joseph'))
  assert.equal(ws.snapshot().tasks.autofix, true)
  assert.equal(home.snapshot().tasks.autofix, false)
  ws.setAutopilot(false)
  assert.equal(saved().workspaces[0].autopilot, false)
  assert.equal(home.snapshot().autopilot, true)
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'joseph', area: 'backend' }] }))
  config.load()
  assert.ok(!runner.running('golf/joseph'))
  assert.equal(ws.agents.size, 0)
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 })
})

// ---- agents' requests reach their own workspace -----------------------------------------------------------

test("`crew` and the hooks say which workspace they're from, and land there", async () => {
  const server = await serve({ token: 'tok', hubFor: (id) => hubs.get(id) })
  fs.writeFileSync(path.join(HOME, 'url'), `http://127.0.0.1:${server.address().port}`)
  fs.writeFileSync(path.join(HOME, 'token'), 'tok')
  const crewCli = (env, ...args) =>
    new Promise((resolve, reject) => execFile(path.join(BIN, 'crew'), args, { env: { ...process.env, CREW_HOME: HOME, ...env } }, (e, out) => (e ? reject(e) : resolve(out))))
  assert.equal(await crewCli({ CREW_AGENT: 'joseph', CREW_WORKSPACE: 'golf' }, 'note', 'golf runs on pnpm'), 'shared with the crew\n')
  assert.equal(await crewCli({ CREW_AGENT: 'joseph', CREW_WORKSPACE: '' }, 'note', 'the default runs on npm'), 'shared with the crew\n')
  assert.match(ws.board(), /pnpm/)
  assert.doesNotMatch(ws.board(), /on npm/)
  assert.match(home.board(), /on npm/)
  assert.doesNotMatch(await crewCli({ CREW_WORKSPACE: 'golf' }, 'who'), /\bgal\b/, 'only who is in golf')
  assert.match(await crewCli({ CREW_WORKSPACE: 'gone' }, 'who'), /no workspace "gone"/)
  // a hook: to the hub while Crew is there, to golf's spool while it isn't, and replayed in golf
  const hook = JSON.parse(adapters.claude({ name: 'kim' }, { session: 's', attachments: '/tmp' }).args.find((x) => x.startsWith('{"permissions"'))).hooks.UserPromptSubmit[0].hooks[0].command
  const env = { ...process.env, CREW_HOME: HOME, CREW_AGENT: 'kim', CREW_WORKSPACE: 'golf' }
  await new Promise((resolve, reject) => execFile('/bin/sh', ['-c', hook], { env }, (e) => (e ? reject(e) : resolve())).stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'write the docs' })))
  assert.equal(ws.agents.get('kim').status, 'working')
  server.close()
  fs.writeFileSync(path.join(HOME, 'url'), 'http://127.0.0.1:9')
  execFileSync('/bin/sh', ['-c', hook], { env, input: JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'docs written' }) })
  assert.ok(fs.existsSync(path.join(HOME, 'workspaces', 'golf', 'spool', 'kim.jsonl')))
  assert.ok(!fs.existsSync(path.join(HOME, 'spool', 'kim.jsonl')))
  ws.replaySpool()
  assert.equal(ws.feed.findLast((e) => e.kind === 'reply')?.text, 'docs written')
  assert.ok(!home.feed.some((e) => e.text === 'docs written'))
})

test('Crew keeps a hub for each workspace in config.json: open ones run, parked ones wait', async () => {
  const { Crew } = await import('../core/crew.js')
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'joseph', area: 'backend', off: true }], workspaces: [{ id: 'golf', folder: API, members: { joseph: {} }, parked: true }] }))
  const c = new Crew({ bin: BIN, computerName: 'test' })
  await c.start()
  try {
    assert.deepEqual([...c.hubs.keys()], [DEFAULT, 'golf'])
    assert.equal(c.hub, c.hubs.get(DEFAULT))
    assert.equal(c.hubs.get('golf').parked, true)
    assert.ok(c.hubs.get('golf').agents.has('joseph'))
    assert.ok(!c.runner.running('golf/joseph'), 'on there, but not started until golf is opened')
    // the agents' logs don't say which workspace they worked in: only the default looks back through them for spend
    assert.equal(c.hub.lookingBack, true)
    assert.ok(!c.hubs.get('golf').lookingBack)
    // a workspace added by hand gets its hub, open unless it says it's parked; one taken out loses it
    fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'joseph', area: 'backend', off: true }], workspaces: [{ id: 'side', members: { joseph: { off: true } } }] }))
    c.config.load()
    assert.deepEqual([...c.hubs.keys()], [DEFAULT, 'side'])
    assert.equal(c.hubs.get('side').parked, false)
    // its agents talk to it through the one server
    const res = await fetch(`${c.hub.url}/who`, { headers: { 'x-crew': c.token, 'x-crew-workspace': 'side' } })
    assert.match(await res.text(), /joseph/)
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
  const other = new Hub(new Scoped(new FakeRunner(), 'golf', false), { bin: BIN, workspace: 'golf', config: cfg, token: 'tok' })
  try {
    assert.match(first.feed.at(-1)?.text ?? '', /^Crew couldn't read its settings \(.*config\.json: .*\), so it carries on with the ones it had$/)
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
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'joseph', area: 'backend', off: true }] }))
  const c = new Crew({ bin: BIN, computerName: 'test' })
  const killed = []
  const proc = (name) => ({ p: { pid: 1, kill: () => killed.push(name), onExit: (fn) => fn() } })
  c.runner.procs.set('old/kim', proc('old/kim'))
  c.runner.connect = async () => (c.runner.survivors = [{ name: 'old/kim', tag: 't1', pid: 1 }])
  await c.start()
  try {
    assert.deepEqual(killed, ['old/kim'])
    assert.match(c.hub.feed.at(-1).text, /stopped old\/kim: it was still running for a workspace that's been removed/)
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
    const { id, state } = c.workspaceAction('create', null, { name: 'Golf app', color: 'teal', icon: '⛳', folder: API, members: ['joseph', 'nobody'] })
    assert.equal(id, 'golf-app')
    assert.deepEqual(saved().workspaces, [{ id: 'golf-app', name: 'Golf app', members: { joseph: {} }, color: 'teal', icon: '⛳', folder: API }])
    assert.equal(saved().current, 'golf-app')
    assert.equal(state.workspace.id, 'golf-app', 'the new one is on screen')
    assert.deepEqual(state.agents.map((a) => [a.name, a.cwd, a.shared]), [['joseph', API, true]])
    assert.deepEqual(state.workspaces.map((w) => [w.id, w.current, w.parked]), [[DEFAULT, false, false], ['golf-app', true, false]])
    assert.equal(c.workspaceAction('create', null, { name: 'Golf app' }).id, 'golf-app-2', 'a name taken gets a number')
    assert.throws(() => c.workspaceAction('create', null, { name: '  ' }), /name/)
    // renamed, the default too, which keeps its look at the top level
    c.workspaceAction('edit', 'golf-app', { name: 'Golf', color: '', icon: '🏌️' })
    c.workspaceAction('edit', DEFAULT, { name: 'Studio', color: 'pink', folder: '/nope' })
    assert.deepEqual([saved().workspaces[0].name, saved().workspaces[0].color, saved().workspaces[0].icon], ['Golf', undefined, '🏌️'])
    assert.deepEqual([saved().name, saved().color, saved().folder], ['Studio', 'pink', undefined], "the default has no folder: each agent works in its own")
    // switching is remembered in config.json; removing the one on screen goes back to the default
    c.workspaceAction('switch', DEFAULT)
    assert.equal(saved().current, undefined)
    c.workspaceAction('switch', 'golf-app')
    fs.mkdirSync(path.join(HOME, 'workspaces', 'golf-app'), { recursive: true })
    fs.writeFileSync(path.join(HOME, 'workspaces', 'golf-app', 'board.md'), 'kept')
    c.workspaceAction('remove', 'golf-app')
    assert.deepEqual(c.workspaces().map((w) => w.id), [DEFAULT, 'golf-app-2'])
    assert.equal(c.here, c.hub)
    assert.equal(fs.readFileSync(path.join(HOME, 'workspaces', 'golf-app', 'board.md'), 'utf8'), 'kept', 'its files stay, for if it comes back')
    assert.throws(() => c.workspaceAction('remove', DEFAULT), /can't be removed/)
    assert.throws(() => c.workspaceAction('switch', 'nope'), /no such workspace/)
  } finally {
    quit(c)
  }
})

test("who works in a workspace: shared agents join and leave from the app, each with a folder of its own there or the workspace's", async () => {
  const c = await crewApp({ agents: roster(), workspaces: [golf()] })
  try {
    c.workspaceAction('members', 'golf', { add: ['gal', 'nobody'], remove: ['david'], folders: { gal: APP, joseph: '' } })
    assert.deepEqual(saved().workspaces[0].members, { joseph: {}, gal: { folder: APP } })
    const w = c.workspaces().find((x) => x.id === 'golf')
    assert.deepEqual(w.members, [{ name: 'joseph', folder: '' }, { name: 'gal', folder: APP }])
    assert.deepEqual(c.hubs.get('golf').space.agents.map((a) => [a.name, a.cwd]), [['joseph', API], ['gal', APP], ['kim', API]])
    assert.throws(() => c.workspaceAction('members', DEFAULT, { add: ['gal'] }), /every shared agent/)
    // in Home, each agent's own folder: where it works there
    c.workspaceAction('members', DEFAULT, { folders: { gal: APP, joseph: '' } })
    assert.deepEqual(saved().agents.map((a) => [a.name, a.cwd]), [['joseph', undefined], ['david', undefined], ['gal', APP]])
    assert.equal(c.snapshot().roster.find((a) => a.name === 'gal').cwd, APP, 'the sheet shows it')
  } finally {
    quit(c)
  }
})

test("what the app does lands in the workspace on screen: its agents, edits, new agents and tasks; a linked computer's agents show in the workspace it has too", async () => {
  const c = await crewApp({ agents: roster(), workspaces: [golf()], current: 'golf' })
  try {
    assert.equal(c.here, c.hubs.get('golf'))
    assert.deepEqual(c.snapshot().agents.map((a) => a.name), ['joseph', 'david', 'kim'])
    await c.update('kim', { area: 'docs and guides' })
    assert.equal(saved().workspaces[0].agents[0].area, 'docs and guides')
    assert.equal(await c.addAgent({ name: 'ivy', area: 'release' }), 'ivy')
    assert.deepEqual(saved().workspaces[0].agents.map((a) => a.name), ['kim', 'ivy'], "a new agent made here is this workspace's own")
    assert.equal(saved().agents.some((a) => a.name === 'ivy'), false)
    await c.ticket('file', null, { text: 'rate limits are off by one', kind: 'bug' })
    assert.equal(c.hubs.get('golf').tickets.all.length, 1)
    assert.equal(c.hub.tickets.all.length, 0)
    // a linked computer's default agents are in the default here; it has no golf, so none of its agents are in golf
    c.links.set('air', { slug: 'air', name: 'Air', peer: {}, toHost: new Map(), fetching: new Set(), state: { agents: [{ name: 'bo', status: 'idle' }], feed: [], tasks: { tickets: [] }, providers: {} } })
    assert.equal(c.snapshot().agents.some((a) => a.home), false)
    await assert.rejects(() => c.moveAgent('kim', 'air'), /Air has no Golf workspace/)
    c.workspaceAction('switch', DEFAULT)
    assert.deepEqual(c.snapshot().agents.filter((a) => a.home).map((a) => a.name), ['bo@air'])
  } finally {
    quit(c)
  }
})

test('parking a workspace stops its agents and keeps their conversations; opening it starts them again, resuming', () => {
  ws.update('david', { off: true })
  ws.start('http://127.0.0.1:1')
  ws.saveSession('joseph', 'sess-golf')
  assert.ok(runner.running('golf/joseph') && runner.running('golf/kim'))
  ws.agents.get('joseph').status = 'working'
  ws.space.parked = true
  ws.saveConfig()
  assert.equal(ws.parked, true)
  assert.equal(saved().workspaces[0].parked, true)
  assert.ok(!runner.running('golf/joseph') && !runner.running('golf/kim'), 'its agents stop')
  assert.equal(ws.sessions.joseph, 'sess-golf', 'their conversations wait')
  assert.match(ws.feed.at(-1).text, /^parked: @joseph, @kim stopped/, 'one line in its chat, not one per agent')
  const shown = ws.snapshot()
  assert.equal(shown.parked, true)
  assert.deepEqual(shown.agents.map((a) => [a.name, a.status]), [['joseph', 'parked'], ['david', 'off'], ['kim', 'parked']])
  assert.deepEqual([ws.summary().on, ws.summary().working], [2, 0])
  // by hand in config.json too: opened, its agents start, picking their conversations back up
  const raw = saved()
  delete raw.workspaces[0].parked
  fs.writeFileSync(CONFIG, JSON.stringify(raw))
  config.load()
  assert.equal(ws.parked, false)
  assert.ok(runner.running('golf/joseph') && runner.running('golf/kim'))
  assert.ok(runner.live.get('golf/joseph').args.includes('sess-golf'), 'resumes its conversation')
  assert.match(ws.feed.at(-1).text, /^opened: @joseph, @kim pick up where they left off/)
  assert.ok(!runner.running('golf/david'), 'one that was off stays off')
})

test('the switcher counts every workspace: who works, who needs you, and replies you have not read', () => {
  ws.start('http://127.0.0.1:1')
  ws.agents.get('joseph').status = 'working'
  ws.agents.get('kim').status = 'waiting'
  ws.feed.push({ kind: 'reply', from: 'kim', text: 'done', ts: Date.now() + 1000 })
  assert.deepEqual(Object.fromEntries(Object.entries(ws.summary()).filter(([k]) => !['faces', 'needs'].includes(k))), { agents: 3, on: 3, working: 1, waiting: 1, unread: 1 })
  assert.deepEqual(ws.summary().needs.map((n) => n.name), ['kim'], "who's waiting on you, for the other workspaces to say")
  ws.update('david', { off: true })
  assert.deepEqual(ws.summary().faces.map((f) => f.name), ['joseph', 'kim'], 'faces of who is on')
  ws.read({ kim: Date.now() + 2000 })
  assert.equal(ws.summary().unread, 0)
})

test("a parked workspace's agents don't start behind its back: restart refuses, a new conversation waits for it to open", () => {
  crew({ autopilot: true, agents: roster(), workspaces: [{ ...golf(), parked: true }] })
  ws.start('http://127.0.0.1:1')
  ws.saveSession('joseph', 'sess-golf')
  assert.throws(() => ws.restart('joseph'), /parked: open it/)
  ws.freshStart('joseph')
  assert.equal(runner.running('golf/joseph'), false)
  assert.equal(ws.sessions.joseph, undefined, 'it starts fresh when the workspace opens')
})

test("made with members' own folders, they start there the first time; a shared agent can't take an own agent's name there", async () => {
  const c = await crewApp({ agents: [...roster(), { name: 'kim', area: 'shared docs' }], workspaces: [golf()] })
  try {
    let pushed = null
    c.on('state', (s) => (pushed = s))
    c.workspaceAction('create', null, { name: 'Site', folder: API, members: ['joseph', 'gal'], folders: { gal: APP } })
    assert.deepEqual(saved().workspaces[1].members, { joseph: {}, gal: { folder: APP } })
    assert.equal(pushed?.workspace.id, 'site', 'the state goes out at once, ahead of whatever follows')
    assert.throws(() => c.workspaceAction('members', 'golf', { add: ['kim'] }), /Golf has an agent of its own called kim/)
    assert.throws(() => c.workspaceAction('edit', 'site', { color: 'red;}</style><b>' }), /isn't a color/)
    c.workspaceAction('edit', 'site', { color: '#16b9c6' })
    assert.equal(c.workspaces().find((w) => w.id === 'site').color, '#16b9c6')
  } finally {
    quit(c)
  }
})

test("your accounts' limits: said once, where you are, whichever workspace's agent reports them; the pace counts every workspace's readings", async () => {
  const c = await crewApp({ agents: roster(), workspaces: [golf()] })
  try {
    const notices = []
    c.on('notice', (n) => notices.push(n))
    const home = c.hub
    const g = c.hubs.get('golf')
    const at = Date.now() + 3600e3
    g.setUsage('claude', [{ id: 'five_hour', pct: 81, resetsAt: at }]) // a Golf agent's status line, Home on screen
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
  atWork(home, 'joseph')
  atWork(ws, 'kim')
  atWork(ws, 'joseph')
  assert.equal(home.lease('joseph', edit(file)), '', "Home's joseph takes it")
  const no = JSON.parse(ws.lease('kim', edit(file))).hookSpecificOutput
  assert.equal(no.permissionDecision, 'deny')
  assert.match(no.permissionDecisionReason, /edited by joseph in your Home workspace/)
  assert.doesNotMatch(no.permissionDecisionReason, /crew ask/, "it can't ask an agent in another workspace")
  assert.match(ws.feed.at(-1).file, /rates\.js/)
  assert.equal(ws.feed.at(-1).in, 'Home')
  assert.ok(ws.lease('joseph', edit(file)), "Golf's joseph is another agent: turned away too")
  home.release('joseph') // its turn ends
  assert.equal(ws.lease('kim', edit(file)), '')
  assert.equal(home.leases.get(file).ws, 'golf', 'one record: Home sees Golf has it')
})

test('crew lease: one simulator for every workspace; it goes to whoever waits for it, in any of them', async () => {
  atWork(home, 'gal')
  atWork(ws, 'kim')
  assert.match(await home.claim({ from: 'gal', words: ['simulator', 'QA pass'] }), /Yours now: simulator/)
  const waiting = ws.claim({ from: 'kim', words: ['Simulator'], hold: 5000 })
  assert.equal(ws.feed.at(-1).rule, 'lease')
  assert.equal(ws.feed.at(-1).in, 'Home')
  assert.match(ws.leasesText(), /simulator\s+gal \(Home\)/)
  assert.deepEqual(ws.holdsOf('gal'), [], "Golf's gal, if it had one, holds nothing")
  assert.match(home.give({ from: 'gal' }), /released simulator/)
  assert.match(await waiting, /Yours now: Simulator/, 'as kim wrote it')
  assert.deepEqual(ws.holdsOf('kim'), ['Simulator'])
  assert.match(home.leasesText(), /kim \(Golf\)/)
  assert.match(home.give({ from: 'kim' }), /isn't yours|hold nothing/, "Home's agents can't give back Golf's")
})

test('a linked computer: its terminals show in their own workspace, typing reaches the right one, and an older Crew is told to update', async () => {
  const c = await crewApp({ agents: roster(), workspaces: [golf()], current: 'golf' })
  try {
    const { EventEmitter: Emitter } = await import('node:events')
    const peer = Object.assign(new Emitter(), { name: 'Air', push() {}, input() {}, close() {} })
    peer.call = async (fn) => {
      if (fn === 'state') return { agents: [], feed: [], tasks: { tickets: [] }, providers: {} }
      throw new Error(`"${fn}" isn't available over Crew Link`) // an older Crew: no workspaces
    }
    const l = c.attach(peer)
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(l.aware, false, "it didn't answer 'spaces'")
    const pty = []
    c.on('pty', (n, d) => pty.push([n, d]))
    peer.emit('pty', 'golf/kim', 'golf output')
    peer.emit('pty', 'ann', 'default output') // the default's, while golf is on screen
    assert.deepEqual(pty, [['kim@air', 'golf output']])
    const typed = []
    for (const [id, h] of c.hubs) h.input = (n, d) => typed.push([id, n, d])
    peer.emit('input', 'golf/joseph', 'y')
    peer.emit('input', 'joseph', 'n')
    assert.deepEqual(typed, [['golf', 'joseph', 'y'], ['default', 'joseph', 'n']])
    await assert.rejects(c.linkCall(l, 'update', [['kim'], {}]), /Air runs an older Crew, without workspaces: update it/)
  } finally {
    quit(c)
  }
})

test("a connection that loses to another doesn't take the winner's workspaces with it", async () => {
  const c = await crewApp({ agents: roster(), workspaces: [golf()] })
  try {
    const { EventEmitter: Emitter } = await import('node:events')
    const answers = []
    const peer = () => {
      const p = Object.assign(new Emitter(), { name: 'Air', push() {}, input() {}, close() {} })
      p.call = (fn) => (fn === 'state' ? Promise.resolve({ agents: [], feed: [], tasks: { tickets: [] }, providers: {} }) : new Promise((resolve, reject) => answers.push({ resolve, reject })))
      return p
    }
    const slow = peer()
    const l = c.attach(slow) // the slower of two sockets dialed at once
    const fast = peer()
    c.attach(fast) // ...and the one that wins
    answers[1].resolve(['golf']) // the winner knows workspaces
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(l.aware, true)
    answers[0].reject(new Error('lost the connection to Air')) // the loser is closed afterwards
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(l.aware, true, 'still aware')
    assert.deepEqual([...l.theirs], ['golf'])
  } finally {
    quit(c)
  }
})

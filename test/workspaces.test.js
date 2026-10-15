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

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-workspaces-'))
process.env.PATH = '/usr/bin:/bin' // no codex to discover once a hub starts
const HOME = process.env.CREW_HOME
const { Hub, CONFIG, openConfig } = await import('../core/hub.js')
const { DEFAULT, dirOf, space, workspacesIn, forget, renameShared, sharedNames } = await import('../core/workspaces.js')
const { Scoped } = await import('../core/runner.js')
const { serve } = await import('../core/server.js')
const { adapters } = await import('../core/adapters.js')
const BIN = new URL('../bin', import.meta.url).pathname

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
  for (const id of [DEFAULT, ...workspacesIn(config.data).map((w) => w.id)]) {
    const hub = new Hub(new Scoped(runner, id, id === DEFAULT), { bin: BIN, workspace: id, config, token: 'tok' })
    hub.others = () => [...hubs.values()].filter((h) => h !== hub)
    hubs.set(id, hub)
  }
  home = hubs.get(DEFAULT)
  ws = hubs.get('golf')
}
const saved = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
beforeEach(() => {
  for (const dir of [HOME, dirOf(HOME, 'golf')]) for (const f of ['feed.jsonl', 'board.md', 'tickets.json', 'sessions.json', 'conversations.json', 'stats.json']) fs.rmSync(path.join(dir, f), { force: true })
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
  fs.rmSync(HOME, { recursive: true, force: true })
  fs.rmSync(ROOT, { recursive: true, force: true })
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
  crew({ agents: [{ name: 'joseph', area: 'backend', cwd: tmp }], workspaces: [{ id: 'golf', folder: tmp, members: { joseph: {} } }] })
  ws.start('http://127.0.0.1:1', { park: true })
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
  fs.rmSync(tmp, { recursive: true, force: true })
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
  ws.start('http://127.0.0.1:1', { park: true })
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
  fs.rmSync(tmp, { recursive: true, force: true })
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

test('Crew keeps a hub for each workspace in config.json: the default one runs, the others wait parked', async () => {
  const { Crew } = await import('../core/crew.js')
  fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'joseph', area: 'backend', off: true }], workspaces: [{ id: 'golf', folder: API, members: { joseph: {} } }] }))
  const c = new Crew({ bin: BIN, computerName: 'test' })
  await c.start()
  try {
    assert.deepEqual([...c.hubs.keys()], [DEFAULT, 'golf'])
    assert.equal(c.hub, c.hubs.get(DEFAULT))
    assert.equal(c.hubs.get('golf').parked, true)
    assert.ok(c.hubs.get('golf').agents.has('joseph'))
    assert.ok(!c.runner.running('golf/joseph'), 'on there, but not started until golf is opened')
    // a workspace added by hand gets its hub; one taken out loses it
    fs.writeFileSync(CONFIG, JSON.stringify({ agents: [{ name: 'joseph', area: 'backend', off: true }], workspaces: [{ id: 'side', members: { joseph: {} } }] }))
    c.config.load()
    assert.deepEqual([...c.hubs.keys()], [DEFAULT, 'side'])
    assert.equal(c.hubs.get('side').parked, true)
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
    assert.match(first.feed.at(-1)?.text ?? '', /^config\.json: /)
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
    assert.match(c.hub.feed.at(-1).text, /stopped old\/kim: it was still running for a workspace that's no longer in config\.json/)
  } finally {
    c.server.close()
    c.stop()
    for (const h of c.hubs.values()) h.dispose()
  }
})

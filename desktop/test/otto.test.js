// Otto: every workspace has him, what you send without naming anyone goes to him, and he can't be taken away. Real Hub and
// Crew, fake terminals, throwaway CREW_HOME. Run with `npm test`.
import { test, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-otto-'))
process.env.CREW_OTTO = 'on'
const { Hub, CONFIG } = await import('../core/hub.js')
const { Crew } = await import('../core/crew.js')
const { adapters } = await import('../core/adapters.js')
const { OTTO_PROMPT } = await import('../core/otto.js')
const { space } = await import('../core/workspaces.js')
const { packAgents } = await import('../core/pack.js')
const { phoneState } = await import('../core/remote.js')
const { TOOLS } = await import('../core/tools.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write = (n, keys) => this.keys?.push(keys)
  quietFor = () => Infinity
}

const CREW = [{ name: 'iris', area: 'product designer' }, { name: 'june', area: 'writer' }]
let hubs = []
const hubWith = (config) => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'reads.json', 'runtime.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CREW, ...config }))
  const runner = new FakeRunner()
  const hub = new Hub(runner, { bin: '/nonexistent' })
  hubs.push(hub)
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
  return hub
}
const tidy = async (hub) => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.readsTimer)
  clearTimeout(hub.convoTimer)
  clearInterval(hub.stallTimer)
  await hub.saving
}
afterEach(async () => {
  for (const h of hubs) await tidy(h)
  hubs = []
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))
const saved = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'))

test('every workspace has Otto, first, with no entry on your roster', () => {
  const hub = hubWith()
  const names = hub.snapshot().agents.map((a) => a.name)
  assert.deepEqual(names, ['otto', 'iris', 'june'])
  assert.equal(hub.otto().system, true)
  assert.equal(saved().agents.some((a) => a.name === 'otto'), false)
})

test('his job and personality come from the app, not from config.json', () => {
  const hub = hubWith()
  const a = hub.otto()
  assert.equal(a.prompt, OTTO_PROMPT)
  assert.match(a.area, /Runs the crew/)
  assert.equal(a.avatar.body, 'mochi')
  const w = hub.config.workspaces.find((x) => x.id === hub.ws)
  assert.equal(w.system.prompt, undefined)
  assert.equal(w.system.area, undefined)
})

test('he works in an empty folder of his own, not where the crew works', () => {
  const hub = hubWith({ workspaces: undefined })
  const a = hub.otto()
  assert.equal(a.cwd, hub.at('otto'))
  assert.equal(fs.existsSync(a.cwd), true)
})

test('he runs on what the crew here runs on, a mid-size model at low effort, and keeps it', () => {
  const hub = hubWith()
  assert.equal(hub.otto().provider, 'claude')
  assert.equal(hub.otto().model, 'sonnet')
  assert.equal(hub.otto().effort, 'low')
  const w = hub.config.workspaces.find((x) => x.id === hub.ws)
  assert.equal(w.system.provider, 'claude')
})

test('on Claude Code he has a shell for crew and nothing else, whatever brain you pick', () => {
  const hub = hubWith()
  const flags = () => hub.otto().args
  assert.equal(flags()[flags().indexOf('--tools') + 1], process.platform === 'win32' ? 'Bash,PowerShell' : 'Bash')
  assert.ok(flags().includes('--strict-mcp-config'))
  hub.update('otto', { model: 'haiku' })
  assert.ok(flags().includes('--strict-mcp-config'))
  hub.update('otto', { provider: 'codex' })
  assert.deepEqual(hub.otto().args, [], "Codex's flags aren't Claude's")
})

test('you can pick his brain or turn him off, and nothing else about him changes', () => {
  const hub = hubWith()
  hub.update('otto', { model: 'haiku', effort: 'medium', prompt: 'be rude', area: 'nothing', cwd: '/tmp', yolo: true, clones: 3 })
  const a = hub.otto()
  assert.equal(a.model, 'haiku')
  assert.equal(a.effort, 'medium')
  assert.equal(a.prompt, OTTO_PROMPT)
  assert.match(a.area, /Runs the crew/)
  assert.equal(a.cwd, hub.at('otto'))
  assert.notEqual(a.yolo, true)
  assert.equal(hub.maxClones(a), 0)
  hub.update('otto', { off: true })
  assert.equal(hub.otto().off, true)
  assert.equal(hub.snapshot().agents[0].on, false)
})

test("he can't be removed or renamed, and a new agent can't take his name", () => {
  const hub = hubWith()
  assert.throws(() => hub.removeAgent('otto'), /comes with every workspace/)
  assert.throws(() => hub.removeAgent('otto', { everywhere: true }), /comes with every workspace/)
  assert.throws(() => hub.rename('otto', 'bob'), /keeps its name/)
  assert.throws(() => hub.update('otto', { name: 'bob' }), /keeps its name/)
  assert.throws(() => hub.addAgent({ name: 'otto', area: 'x' }), /already exists/)
  assert.equal(hub.otto().name, 'otto')
})

test('an agent you named otto before he came along keeps its name, and he goes by another', () => {
  const hub = hubWith({ agents: [{ name: 'otto', area: 'my own otto' }] })
  const sys = hub.otto()
  assert.equal(sys.name, 'otto-2')
  assert.equal(hub.agents.get('otto').area, 'my own otto')
  assert.equal(hub.agents.get('otto').system, undefined)
})

test('a workspace shown from another computer has that computer\'s Otto, and none of its own', () => {
  const s = space({ workspaces: [{ id: 'w', name: 'W', of: 'laptop' }] }, 'w')
  assert.deepEqual(s.agents, [])
  assert.equal(space({ workspaces: [{ id: 'w', name: 'W' }] }, 'w').agents[0].name, 'otto')
})

test('Auto and triage never pick him: he does no work of his own', () => {
  const hub = hubWith()
  assert.equal(hub.route('write the release notes', 'you')?.name !== 'otto', true)
  assert.equal(hub.route('run the crew and get it to the right teammate', 'iris')?.name !== 'otto', true)
})

test('he is in every channel, whoever its members are', () => {
  const hub = hubWith()
  hub.config.workspaces.find((w) => w.id === hub.ws).channels = [{ id: 'ship', name: 'ship', members: ['iris'] }]
  hub.apply()
  assert.doesNotThrow(() => hub.channelsText('otto'))
  assert.doesNotMatch(hub.channelsText('otto'), /not in it/)
  assert.match(hub.channelsText('iris'), /ship/)
})

test('the prompt he starts with has the crew basics and his instructions; he skips the checks before building', () => {
  const hub = hubWith()
  const a = hub.otto()
  assert.equal(hub.checksFor(a), 'none')
  const launch = adapters.claude({ ...a }, { resume: false, session: 's', attachments: '/tmp', bin: '/nonexistent', checks: 'none' })
  const args = launch.args.join(' ')
  assert.match(args, /You are "otto"/)
  assert.match(args, /You run this crew/)
  assert.match(args, /crew send <name>/)
})

test("trusting his folder isn't a question for you", async () => {
  const hub = hubWith()
  const a = hub.otto()
  const entry = hub.feed.length
  hub.runner.keys = []
  Object.assign(a, { trust: { ask: /Itrustthisfolder/, yes: /❯Yes/, no: /❯No/ }, boot: '', status: 'starting' })
  hub.onOutput?.('otto', 'Itrustthisfolder')
  assert.equal(hub.feed.slice(entry).filter((e) => e.kind === 'ask').length, 0, 'no card in the chat')
  clearTimeout(a.trustPick?.timer)
})

test('he says hello once, in a workspace that was going before he came, and costs nothing doing it', async () => {
  const hub = hubWith()
  hub.post({ kind: 'msg', from: 'you', to: 'iris', text: 'an old message' })
  const typed = hub.runner.typed.length
  hub.greet()
  const hi = hub.feed.at(-1)
  assert.equal(hi.from, 'otto')
  assert.match(hi.text, /I'm Otto/)
  assert.equal(hub.runner.typed.length, typed)
  const rows = hub.feed.length
  hub.greet()
  assert.equal(hub.feed.length, rows, 'once')
})

test('his hello is no news: nothing to read, no badge', () => {
  const hub = hubWith()
  hub.post({ kind: 'msg', from: 'you', to: 'iris', text: 'an old message' })
  hub.greet()
  assert.equal(hub.feed.at(-1).from, 'otto')
  assert.equal(hub.summary().unread, 0)
})

test('a workspace he has already said hello in, made again, gets no second one', () => {
  const hub = hubWith()
  hub.post({ kind: 'msg', from: 'you', to: 'iris', text: 'old' })
  hub.post({ kind: 'reply', from: 'otto', text: "Hi, I'm Otto." })
  hub.greet()
  assert.equal(hub.feed.filter((e) => e.from === 'otto').length, 1)
})

test('settings that went unreadable keep him from saying hello, and keep nothing else from starting', () => {
  const hub = hubWith()
  hub.post({ kind: 'msg', from: 'you', to: 'iris', text: 'old' })
  hub.cfg.save = () => {
    throw new Error("CLIque can't read its settings")
  }
  assert.doesNotThrow(() => hub.greet())
  assert.equal(hub.feed.some((e) => e.from === 'otto'), false)
})

test('a workspace counts who you put there: he comes with it', () => {
  const hub = hubWith()
  assert.equal(hub.summary().agents, 2)
  assert.deepEqual(hub.summary().faces.map((f) => f.name), ['iris', 'june'])
  hub.agents.get('otto').status = 'waiting'
  assert.equal(hub.summary().waiting, 1, 'though if he needs you, he needs you')
})

test('in a new workspace the welcome introduces him, so he stays quiet', () => {
  const hub = hubWith()
  hub.greet()
  assert.equal(hub.feed.length, 0)
  hub.post({ kind: 'msg', from: 'you', to: 'iris', text: 'hello' })
  hub.greet()
  assert.equal(hub.feed.filter((e) => e.from === 'otto').length, 0)
})

test('turned off or asleep, he says nothing', () => {
  const hub = hubWith()
  hub.post({ kind: 'msg', from: 'you', to: 'iris', text: 'old' })
  hub.update('otto', { off: true })
  hub.greet()
  assert.equal(hub.feed.some((e) => e.from === 'otto'), false)
})

// ---- through Crew.send, as the app and phones send ------------------------------------------------------------------
const crewWith = (config) => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CREW, ...config }))
  const crew = new Crew({ bin: '/nonexistent', computerName: 'Studio' })
  Object.assign(crew.runner, { running: () => true, submit() {}, write() {} })
  const hub = [...crew.hubs.values()][0]
  hubs.push(hub)
  for (const a of hub.agents.values()) a.status = 'working' // busy: messages queue
  return { crew, hub }
}

test('what you send naming nobody goes to him, and the chat says so', async () => {
  const { crew, hub } = crewWith()
  await crew.send(undefined, 'the empty cart looks sad', [], {}, hub)
  const m = hub.feed.at(-1)
  assert.equal(m.to, 'otto')
  assert.equal(m.auto, undefined)
})

test('naming someone is a direct line: they get it, not him', async () => {
  const { crew, hub } = crewWith()
  await crew.send('iris', 'redraw it', [], {}, hub)
  assert.equal(hub.feed.at(-1).to, 'iris')
  await crew.send(undefined, '@june write a line', [], {}, hub)
  assert.equal(hub.feed.at(-1).to, 'june')
})

test('with him off, Auto picks by area as it did before', async () => {
  const { crew, hub } = crewWith()
  hub.update('otto', { off: true })
  await crew.send(undefined, 'product designer needed for the cart', [], {}, hub)
  const m = hub.feed.at(-1)
  assert.equal(m.to, 'iris')
  assert.equal(m.auto, true)
})

test('in a channel with members he still takes it', async () => {
  const { crew, hub } = crewWith()
  hub.config.workspaces.find((w) => w.id === hub.ws).channels = [{ id: 'ship', name: 'ship', members: ['iris'] }]
  hub.apply()
  for (const a of hub.agents.values()) a.status = 'working'
  await crew.send(undefined, 'anything left to ship?', [], { channel: 'ship' }, hub)
  assert.equal(hub.feed.at(-1).to, 'otto')
})

test("he can't be moved to another computer", async () => {
  const { crew, hub } = crewWith()
  await assert.rejects(crew.moveAgent('otto', 'laptop'), /stays where it is/)
})

test("he doesn't go out in an agent pack", () => {
  const hub = hubWith()
  const pack = packAgents(hub, ['otto', 'iris'])
  assert.deepEqual(pack.agents.map((a) => a.name), ['iris'])
})

test('a phone sees him as one of the crew, without his instructions', () => {
  const { crew, hub } = crewWith()
  const a = phoneState(crew.snapshot(hub)).agents[0]
  assert.equal(a.name, 'otto')
  assert.equal(a.system, true)
  assert.equal(a.prompt, undefined)
  assert.equal(a.cwd, undefined)
})

// ---- what a closer look found ----------------------------------------------------------------------------------------
const withPath = (names, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-path-'))
  for (const n of names) fs.writeFileSync(path.join(dir, n), '#!/bin/sh\n', { mode: 0o755 })
  const was = process.env.PATH
  process.env.PATH = dir
  try {
    return fn()
  } finally {
    process.env.PATH = was
  }
}

test('on a computer with only Codex he runs on Codex', { skip: process.platform === 'win32' }, () => {
  withPath(['codex'], () => {
    const hub = hubWith()
    assert.equal(hub.otto().provider, 'codex')
    assert.equal(hub.otto().model, undefined)
    assert.deepEqual(hub.otto().args, [])
    assert.equal(hub.space.def('otto').provider, 'codex')
  })
})

test("with no CLI found yet nothing's decided: he looks again next time", { skip: process.platform === 'win32' }, () => {
  withPath([], () => {
    const hub = hubWith()
    assert.equal(hub.otto().provider, 'claude')
    assert.equal(hub.space.def('otto').provider, undefined)
  })
})

test('if his CLI stops, what was waiting for him goes to whoever Auto would have picked', () => {
  const hub = hubWith()
  const a = hub.otto()
  a.status = 'working'
  hub.send({ to: 'otto', text: 'product designer needed for the cart' })
  const m = hub.feed.at(-1)
  assert.equal(a.inbox.length, 1)
  hub.setStatus(a, 'stopped')
  assert.equal(a.inbox.length, 0)
  assert.equal(m.to, 'iris')
  assert.equal(m.auto, true)
  assert.match(hub.feed.at(-1).text, /couldn't take what you sent, so it went to @iris/)
})

test('turned off with messages waiting, the same', () => {
  const hub = hubWith()
  const a = hub.otto()
  a.status = 'working'
  hub.send({ to: 'otto', text: 'a writer for the release notes' })
  const m = hub.feed.at(-1)
  hub.update('otto', { off: true })
  assert.equal(a.inbox.length, 0)
  assert.equal(m.to, 'june')
})

test('stuck starting, the same: what you sent stops waiting', () => {
  const hub = hubWith()
  const a = hub.otto()
  Object.assign(a, { status: 'starting', since: Date.now() - 100000 })
  a.inbox.push(hub.post({ kind: 'msg', from: 'you', to: 'otto', text: 'a writer please', queued: true }))
  assert.equal(hub.ottoReady(), false)
  hub.checkStalls()
  assert.equal(a.inbox.length, 0)
})

test("what he can't take soon doesn't go to him: asking in his terminal, stuck, or his account at its limit", () => {
  const hub = hubWith()
  const a = hub.otto()
  assert.equal(hub.ottoReady(), true)
  for (const [patch, undo] of [[{ status: 'waiting' }, { status: 'idle' }], [{ resumeAsk: 'x' }, { resumeAsk: null }], [{ status: 'stopped' }, { status: 'idle' }]]) {
    Object.assign(a, patch)
    assert.equal(hub.ottoReady(), false, JSON.stringify(patch))
    Object.assign(a, undo)
  }
  hub.nearLimit = () => true
  assert.equal(hub.ottoReady(), false, 'at the limit')
})

test('with his account at its limit, what you send goes to a teammate, through the send the app uses', async () => {
  const { crew, hub } = crewWith()
  hub.nearLimit = (id) => id === 'claude'
  hub.agents.get('otto').status = 'idle'
  await crew.send(undefined, 'product designer needed', [], {}, hub)
  assert.notEqual(hub.feed.at(-1).to, 'otto')
})

test('a linked computer\'s Otto is not yours to move either', async () => {
  const { crew, hub } = crewWith()
  const real = crew.snapshot.bind(crew)
  crew.snapshot = (h) => ({ ...real(h), agents: [{ name: 'otto@laptop', system: true, home: 'laptop' }] })
  await assert.rejects(crew.moveAgent('otto@laptop', ''), /stays where it is/)
  crew.snapshot = real
  void hub
})

test('your otto and otto-2 both keep their names and he takes the next; he keeps his if yours leaves', () => {
  const hub = hubWith({ agents: [{ name: 'otto', area: 'mine' }, { name: 'otto-2', area: 'mine too' }] })
  assert.equal(hub.otto().name, 'otto-3')
  assert.deepEqual(hub.snapshot().agents.map((a) => a.name), ['otto-3', 'otto', 'otto-2'])
  assert.equal(hub.space.def('otto-3').name, 'otto-3')
  hub.config.agents = hub.config.agents.filter((a) => a.name !== 'otto')
  for (const w of hub.config.workspaces) delete w.members?.otto
  hub.apply()
  assert.equal(hub.otto().name, 'otto-3', 'no flip')
})

test("anything kept for an agent that had his name before him isn't his", () => {
  fs.writeFileSync(path.join(process.env.CREW_HOME, 'sessions.json'), JSON.stringify({ otto: { id: 'old', cli: 'claude' } }))
  fs.writeFileSync(path.join(process.env.CREW_HOME, 'stats.json'), JSON.stringify({ otto: { tasks: 50, days: {} } }))
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CREW }))
  const hub = new Hub(new FakeRunner(), { bin: '/nonexistent' })
  hubs.push(hub)
  assert.equal(hub.sessions.otto, undefined)
  assert.equal(hub.stats.otto, undefined)
})

test('with autopilot off his hand-off goes straight on: you asked him, and asking once is enough', () => {
  const hub = hubWith({ autopilot: false })
  hub.otto().status = 'working'
  assert.match(hub.send({ from: 'otto', to: 'june', text: 'Write it.' }), /june/)
  const m = hub.feed.at(-1)
  assert.equal(m.held, false)
  hub.send({ from: 'june', to: 'iris', text: 'Draw it.' })
  assert.equal(hub.feed.at(-1).held, true, "a teammate's still waits for your OK")
})

test("a lone agent stays alone: he doesn't change its prompt, or its cache", () => {
  const was = process.env.CREW_SAVERS
  process.env.CREW_SAVERS = 'busyCheck'
  const hub = hubWith({ agents: [{ name: 'iris' }] })
  assert.equal(hub.savers.busyCheck, true)
  assert.equal(hub.checksFor(hub.agents.get('iris')), 'none')
  process.env.CREW_SAVERS = was
})

test('his conversation can start afresh after a long idle, like any Auto pick', () => {
  const hub = hubWith()
  assert.equal(hub.followsOn(hub.otto(), { from: 'you', text: 'hi' }), false)
  assert.equal(hub.followsOn(hub.agents.get('iris'), { from: 'you', text: 'hi' }), true)
})

test('he hands on inside the channel it came from, and what you attached goes along', () => {
  const hub = hubWith()
  hub.config.workspaces.find((w) => w.id === hub.ws).channels = [{ id: 'ship', name: 'ship', members: ['iris'] }]
  hub.apply()
  const a = hub.otto()
  const mine = { id: 'm', from: 'you', channel: 'ship', images: ['/shot.png'] }
  Object.assign(a, { status: 'working', current: 'm', serving: [mine] })
  hub.feed.push({ ...mine, kind: 'msg', to: 'otto', text: 'x', ts: Date.now() })
  assert.throws(() => hub.send({ from: 'otto', to: 'june', text: 'Take it.', channel: 'ship' }), /isn't in it/)
  hub.send({ from: 'otto', to: 'iris', text: 'Take it.', channel: 'ship' })
  assert.deepEqual(hub.feed.at(-1).images, ['/shot.png'])
  Object.assign(a, { status: 'idle', serving: [] })
})

test('a task is never his, here or on a linked computer', () => {
  const hub = hubWith()
  assert.throws(() => hub.taskOwner('otto', 'iris'), /hands work on/)
  assert.throws(() => hub.setTaskSettings({ triage: 'otto' }), /hands work on/)
  hub.directory = () => [{ name: 'otto@laptop', system: true, on: true }, { name: 'rex@laptop', on: true }]
  assert.deepEqual(hub.teammates().map((a) => a.name).filter((n) => n.includes('@')), ['rex@laptop'])
  hub.directory = () => []
})

test("alone in a workspace he's who a message to anyone goes to, and asking from a terminal works", () => {
  const hub = hubWith({ agents: [] })
  assert.equal(hub.route('hello', 'you'), hub.otto())
  assert.equal(hub.route('hello', 'otto'), undefined)
})

test('a phone-made or hand-made system entry can only hold what it should', () => {
  assert.equal(space({ workspaces: [{ id: 'w', name: 'W', system: { prompt: 'x', area: 'y', model: 'haiku' } }] }, 'w').agents[0].model, 'haiku')
  assert.equal(space({ workspaces: [{ id: 'w', name: 'W', system: { prompt: 'x' } }] }, 'w').agents[0].prompt, OTTO_PROMPT)
  assert.equal(space({ workspaces: [{ id: 'w', name: 'W', system: [] }] }, 'w').agents[0].name, 'otto')
  const s = space({ workspaces: [{ id: 'w', name: 'W', system: [] }] }, 'w')
  s.set('otto', 'model', 'haiku')
  assert.equal(s.def('otto').model, 'haiku')
})

test('`crew app` says what it can and can\'t do to him, before asking anyone', () => {
  const { crew, hub } = crewWith()
  const plan = (tool, name, flags = {}) => TOOLS[tool].plan({ crew, hub }, { name, flags })
  assert.throws(() => plan('agent edit', 'otto', { area: 'nothing' }), /only its brain, model and effort/)
  assert.throws(() => plan('agent edit', 'otto', { prompt: 'be rude' }), /only its brain, model and effort/)
  assert.throws(() => plan('agent remove', 'otto'), /can't be removed/)
  assert.equal(plan('agent edit', 'otto', { model: 'haiku' }).title.includes('otto'), true)
  assert.throws(() => plan('channel add', 'solo', { members: 'otto' }), /in every channel already/)
  assert.ok(plan('channel add', 'duo', { members: 'otto,iris' }))
})

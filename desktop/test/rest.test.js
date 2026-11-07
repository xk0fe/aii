// Resting: an agent that's on has no terminal until there's work for it, and gives its terminal up once it has been idle
// and its cache has gone cold. Against the real Hub (and Crew.send, as the app sends) with a fake runner in a throwaway
// CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-rest-'))
if (process.platform !== 'win32') process.env.PATH = '/usr/bin:/bin' // no codex to discover once a hub starts
const { Hub, CONFIG } = await import('../core/hub.js')
const { Crew } = await import('../core/crew.js')
const { phoneState } = await import('../core/remote.js')
const { moveEnd } = await import('../core/move.js')
const at = (f) => path.join(process.env.CREW_HOME, f)
const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-rest-folder-'))

class FakeRunner extends EventEmitter {
  live = new Map()
  starts = []
  stops = []
  typed = []
  running = (n) => this.live.has(n)
  start = (n, opts) => (this.starts.push(n), this.live.set(n, opts))
  stop = (n) => (this.stops.push(n), this.live.delete(n))
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
  pid() {}
  quietFor = () => Infinity
}

const CREW = () => [{ name: 'ada', area: 'mobile app', cwd: FOLDER }, { name: 'june', area: 'backend api', cwd: FOLDER }, { name: 'uma', area: 'analytics', cwd: FOLDER, off: true }]
let hub, runner
const config = (extra = {}) => fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CREW(), ...extra }))

beforeEach(() => {
  for (const f of ['tickets.json', 'conversations.json', 'sessions.json', 'feed.jsonl', 'runtime.json']) fs.rmSync(at(f), { force: true })
  config()
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent', computerName: 'Studio' })
  hub.start('http://127.0.0.1:1')
})
afterEach(() => {
  clearInterval(hub.stallTimer)
  hub.cfg.off('change', hub.onConfig)
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'reapTimer']) clearTimeout(a[t])
  for (const t of ['statsTimer', 'convoTimer', 'lookTimer']) clearTimeout(hub[t])
  fs.unwatchFile(CONFIG)
})
after(() => {
  fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(FOLDER, { recursive: true, force: true, maxRetries: 10 })
})

const agent = (n) => hub.agents.get(n)
const up = (n) => hub.onHook(n, { hook_event_name: 'SessionStart', source: 'startup' })
const free = (n) => {
  hub.restart(n)
  up(n)
  agent(n).holdUntil = 0
  return agent(n)
}
// idle long enough, and its conversation's cache long gone
const LATER = () => Date.now() + 2 * 3600000

test('nobody starts with the app: on, free and without a terminal', () => {
  assert.deepEqual(runner.starts, [])
  const shown = Object.fromEntries(hub.snapshot().agents.map((a) => [a.name, [a.status, a.on]]))
  assert.deepEqual(shown, { ada: ['resting', true], june: ['resting', true], uma: ['off', false] })
})

test('a message starts the agent it is for, and goes in once it is up, resuming its conversation', () => {
  hub.saveSession('ada', 'sess-ada')
  assert.match(hub.send({ to: 'ada', text: 'fix the button' }), /sent to @ada/)
  assert.deepEqual(runner.starts, ['ada'], 'only ada')
  assert.ok(runner.live.get('ada').args.includes('sess-ada'))
  assert.equal(agent('ada').status, 'starting')
  assert.equal(runner.typed.length, 0, 'not into a CLI that is still starting')
  up('ada')
  agent('ada').holdUntil = 0
  hub.pump(agent('ada'))
  assert.match(runner.typed[0].text, /fix the button/)
  assert.equal(agent('ada').status, 'working')
})

test('a teammate reaches a resting agent, and an off one is still refused', () => {
  free('june')
  hub.send({ from: 'june', to: 'ada', text: 'the contract is on the board' })
  assert.ok(runner.running('ada'))
  assert.throws(() => hub.send({ from: 'june', to: 'uma', text: 'numbers?' }), /turned off/)
})

test("a teammate's question wakes it too", async () => {
  free('june')
  const asking = hub.question({ from: 'june', to: 'ada', text: 'which port?', hold: 10 })
  assert.ok(runner.running('ada'))
  assert.match(await asking, /hasn't answered yet/)
})

test('Auto counts a resting agent as free, in Crew.send as the app sends', async () => {
  const crew = new Crew({ bin: '/nonexistent', computerName: 'Studio' })
  const h = crew.hubs.get('default')
  Object.assign(crew.runner, { running: () => false, start() {}, submit() {}, write() {}, stop() {}, pid() {} })
  for (const a of h.agents.values()) if (!a.off) a.status = 'resting'
  await crew.send(undefined, 'the backend api is slow')
  assert.equal(h.feed.findLast((e) => e.kind === 'msg').to, 'june')
  for (const a of h.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  clearTimeout(h.statsTimer)
  clearTimeout(h.convoTimer)
  h.cfg.off('change', h.onConfig)
})

test("an agent's crew send with no name picks a resting teammate", () => {
  free('june')
  hub.send({ from: 'june', text: 'the mobile app needs a look' })
  assert.equal(hub.feed.findLast((e) => e.kind === 'msg').to, 'ada')
  assert.ok(runner.running('ada'))
})

test('turned on, or new: it rests, and nothing asks about its folder until it has work', () => {
  hub.update('uma', { off: false })
  assert.equal(agent('uma').status, 'resting')
  assert.ok(!runner.running('uma'))
  hub.update('uma', { off: true })
  assert.equal(agent('uma').status, 'off')
})

test('a task for a new conversation starts one, without resuming the old one first', () => {
  hub.saveSession('ada', 'old-one')
  agent('ada').inbox.push({ id: 'm1', from: 'you', to: 'ada', text: 'task', fresh: true, ts: Date.now() })
  hub.pump(agent('ada'))
  assert.deepEqual(runner.starts, ['ada'])
  assert.ok(!runner.live.get('ada').args.includes('old-one'))
})

test('a new conversation while resting waits for its next message', () => {
  hub.saveSession('ada', 'old-one')
  hub.freshStart('ada')
  assert.deepEqual(runner.starts, [])
  assert.equal(hub.sessions.ada, undefined)
  assert.equal(hub.feed.at(-1).fresh, true)
})

test('its terminal on request: the Terminal button, to look around or sign in', () => {
  hub.restart('ada')
  assert.deepEqual(runner.starts, ['ada'])
})

test('what was queued before a restart wakes it at the start', () => {
  clearInterval(hub.stallTimer)
  fs.writeFileSync(at('runtime.json'), JSON.stringify({ agents: { ada: { run: 'gone', status: 'idle', inbox: [{ id: 'm9', from: 'you', to: 'ada', text: 'still here?', ts: Date.now() }] } } }))
  const next = new FakeRunner()
  const h = new Hub(next, { bin: '/nonexistent' })
  h.start('http://127.0.0.1:1')
  assert.deepEqual(next.starts, ['ada'])
  clearInterval(h.stallTimer)
  h.cfg.off('change', h.onConfig)
  for (const a of h.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  clearTimeout(h.lookTimer)
})

// ---- giving the terminal up ---------------------------------------------------------------------------------------

test('idle long enough with a cold cache: it rests, quietly, and its conversation waits', async () => {
  const a = free('ada')
  hub.saveSession('ada', 'sess-ada')
  const lines = hub.feed.length
  await hub.restIdle(LATER())
  assert.equal(a.status, 'resting')
  assert.ok(!runner.running('ada'))
  assert.equal(hub.sessions.ada, 'sess-ada')
  assert.equal(hub.feed.length, lines, 'no line in the chat')
  hub.send({ to: 'ada', text: 'back to work' })
  assert.ok(runner.live.get('ada').args.includes('sess-ada'))
})

test('a warm cache keeps nobody up: a resumed conversation reads it just the same', async () => {
  const a = free('ada')
  hub.saveSession('ada', 'sess-ada')
  hub.convoOf(a).context = { used: 50000 }
  hub.convoOf(a).lastAt = Date.now()
  await hub.restIdle(Date.now() + 11 * 60000)
  assert.equal(a.status, 'resting')
})

test('not until it has been idle a while', async () => {
  const a = free('ada')
  await hub.restIdle(Date.now() + 5 * 60000)
  assert.equal(a.status, 'idle')
  await hub.restIdle(Date.now() + 11 * 60000)
  assert.equal(a.status, 'resting')
})

for (const [why, set] of [
  ['something running in the background', (a) => (a.background = 1)],
  ['a sub-agent at work', (a) => a.subs.set('s1', { id: 's1', ended: null })],
  ['a message queued', (a) => { a.status = 'working'; a.inbox.push({ id: 'q', from: 'you', text: 'x', ts: Date.now() }); a.status = 'idle'; a.holdUntil = Date.now() + 60000 }],
  ['you typing in its terminal', (a) => (a.typedAt = LATER() - 1000)],
  ['a restart it owes', (a) => (a.relaunch = true)],
  ['a new conversation it owes', (a) => (a.freshPending = true)],
  ['an API error it is retrying', (a) => (a.retrying = true)],
  ['moving', (a) => (a.moving = true)],
]) {
  test(`stays up with ${why}`, async () => {
    const a = free('ada')
    set(a)
    await hub.restIdle(LATER())
    assert.equal(a.status, 'idle')
    assert.ok(runner.running('ada'))
  })
}

test('stays up with a question of its own waiting on you', async () => {
  const a = free('ada')
  hub.asks.set('q1', { name: 'ada', cli: 'claude', input: {}, resolve() {} })
  await hub.restIdle(LATER())
  assert.equal(a.status, 'idle')
  hub.asks.delete('q1')
})

test('stays up while something it left running would die with it', { skip: process.platform === 'win32' }, async () => {
  const a = free('ada')
  const file = at('groups-test')
  // the dev server it started with &: its shell has gone, it lives on in that shell's group
  const shell = spawn('/bin/sh', ['-c', 'sleep 30 >/dev/null 2>&1 &'], { detached: true, stdio: 'ignore' })
  await new Promise((r) => shell.once('exit', r))
  try {
    fs.writeFileSync(file, `${shell.pid} ${Math.floor(Date.now() / 1000)}\n`)
    hub.runs.set(a.run, { name: 'ada', file, at: 0 })
    await hub.restIdle(LATER())
    assert.equal(a.status, 'idle', 'its dev server is still up')
    process.kill(-shell.pid)
    await new Promise((r) => setTimeout(r, 100))
    await hub.restIdle(LATER())
    assert.equal(a.status, 'resting')
  } finally {
    try {
      process.kill(-shell.pid)
    } catch {}
    hub.runs.delete(a.run)
  }
})

test('restMinutes: 0 keeps them up', async () => {
  const a = free('ada')
  hub.config.restMinutes = 0
  await hub.restIdle(LATER())
  assert.equal(a.status, 'idle')
  delete hub.config.restMinutes
})

test('clones go by their own linger, and their original stays while one is around', async () => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'ada', area: 'mobile', cwd: FOLDER, clones: 2 }] }))
  hub.loadConfig()
  const a = free('ada')
  const c = hub.spawnClone(a, { id: 'x' })
  up(c.name)
  await hub.restIdle(LATER())
  assert.equal(a.status, 'idle')
  assert.ok(runner.running(c.name))
  hub.dismiss(c.name)
})

test("a hook from the CLI it just gave up doesn't bring it back", async () => {
  const a = free('ada')
  await hub.restIdle(LATER())
  hub.onHook('ada', { hook_event_name: 'Stop', last_assistant_message: 'bye' })
  assert.equal(a.status, 'resting')
  assert.ok(!hub.feed.some((e) => e.kind === 'reply' && e.text === 'bye'))
})

test('a stalled task reminds a resting agent, which wakes it', async () => {
  const a = free('ada')
  const t = hub.tickets.add({ title: 'Login is slow', by: 'you', owner: 'ada' })
  t.status = 'fixing'
  t.fixer = 'ada'
  hub.convoOf(a).ticket = t.id
  a.status = 'resting'
  runner.live.delete('ada')
  hub.checkStalls(Date.now() + 3600000)
  assert.ok(runner.running('ada'))
  assert.match(a.inbox[0].text, /still in progress/)
})

test('parked: nobody rests or wakes on their own, and sleep only mentions who it stopped', async () => {
  const a = free('ada')
  hub.space.parked = true
  hub.park()
  assert.deepEqual(hub.snapshot().agents.map((x) => x.status), ['parked', 'parked', 'off'])
  assert.match(hub.feed.at(-1).text, /^went to sleep: @ada stopped/)
  await hub.restIdle(LATER())
  assert.equal(a.status, 'off')
  hub.space.parked = false
  hub.unpark()
  assert.equal(a.status, 'resting')
  assert.deepEqual(runner.starts, ['ada'], 'opening it starts nobody')
})

// ---- what stopping a CLI would end ---------------------------------------------------------------------------------

test('its helpers go with its CLI, but a command still going keeps it up', () => {
  const a = free('ada')
  hub.runs.set(a.run, { name: 'ada', file: at('no-groups'), pid: 100, at: 0 })
  const procs = [
    { pid: 100, ppid: 1, pgid: 100, start: 1000, name: 'codex' },
    { pid: 101, ppid: 100, pgid: 101, start: 1002, name: 'npm' }, // a tool server, up before its first prompt...
    { pid: 103, ppid: 101, pgid: 101, start: 1009, name: 'node' }, // ...and what that started, a little after it
    { pid: 104, ppid: 100, pgid: 100, start: 1006, name: 'caffeinate' }, // helpers that come with its first prompt
    { pid: 105, ppid: 100, pgid: 105, start: 1011, name: 'codex-code-mode-host' }, // ...or its first command
  ]
  assert.equal(hub.leftRunning(a, procs), false, 'no prompt yet: nothing of its own')
  a.promptAt = 1005 * 1000
  if (process.platform !== 'win32') assert.equal(hub.leftRunning(a, procs), false)
  // Codex runs a command as its own child, with no shell around it
  assert.equal(hub.leftRunning(a, [...procs, { pid: 102, ppid: 100, pgid: 102, start: 1020, name: 'sleep' }]), true)
  // ...or under a helper
  assert.equal(hub.leftRunning(a, [...procs, { pid: 102, ppid: 105, pgid: 102, start: 1020, name: 'npm' }]), true)
  hub.runs.delete(a.run)
})

test("what's running can't be read: nobody rests, as nobody can tell what stopping them would end", async () => {
  const a = free('ada')
  const { PATH } = process.env
  process.env.PATH = '/nonexistent'
  try {
    await hub.restIdle(LATER())
  } finally {
    process.env.PATH = PATH
  }
  assert.equal(a.status, 'idle')
})

// ---- Claude Code asking whether to resume ---------------------------------------------------------------------------

const ASK = 'Resume this conversation?\nThis conversation has been inactive for 3h and is 900k tokens long. Resuming it will use about 18% of your 5-hour usage limit.\n❯ Resume\n  Start a new conversation'
const screen = (n, text) => runner.emit('data', n, text)

test('the resume question holds the message back, and it goes in once you have answered in the terminal', () => {
  hub.saveSession('ada', 'sess-ada')
  hub.send({ to: 'ada', text: 'carry on' })
  up('ada')
  screen('ada', ASK)
  const a = agent('ada')
  assert.equal(a.status, 'waiting')
  assert.match(hub.feed.at(-1).text, /about 18% of your 5-hour limit\. Answer in its terminal/)
  a.holdUntil = 0
  hub.pump(a)
  assert.equal(runner.typed.length, 0, 'nothing typed into the question')
  assert.equal(a.inbox.length, 1)
  hub.input('ada', '\r')
  assert.equal(a.status, 'idle', 'its session is up')
  a.holdUntil = 0
  hub.pump(a)
  assert.match(runner.typed[0].text, /carry on/)
})

test('the question can come before its session says it started', () => {
  hub.saveSession('ada', 'sess-ada')
  hub.send({ to: 'ada', text: 'carry on' })
  screen('ada', ASK)
  const a = agent('ada')
  assert.equal(a.status, 'waiting')
  up('ada')
  assert.equal(a.status, 'waiting', "the session starting doesn't answer it")
  hub.input('ada', '\x1b')
  assert.equal(a.status, 'idle')
  a.resumeWatch = null
})

test('answered before its session started, it waits for that as usual', () => {
  hub.saveSession('ada', 'sess-ada')
  hub.send({ to: 'ada', text: 'carry on' })
  screen('ada', ASK)
  hub.input('ada', '\r')
  assert.equal(agent('ada').status, 'starting')
  up('ada')
  assert.equal(agent('ada').status, 'idle')
})

test('a message typed just before the question showed goes back in the queue', () => {
  hub.saveSession('ada', 'sess-ada')
  hub.send({ to: 'ada', text: 'carry on' })
  up('ada')
  const a = agent('ada')
  a.holdUntil = 0
  hub.pump(a)
  assert.equal(runner.typed.length, 1)
  screen('ada', ASK)
  assert.equal(a.expect, null)
  assert.match(a.inbox[0].text, /carry on/)
  assert.equal(a.status, 'waiting')
})

test('no question to watch for in a new conversation, or once it has taken a prompt', () => {
  hub.send({ to: 'ada', text: 'hello' })
  assert.equal(agent('ada').resumeWatch, null)
  hub.saveSession('june', 'sess-june')
  hub.send({ to: 'june', text: 'hello' })
  assert.ok(agent('june').resumeWatch)
  hub.onHook('june', { hook_event_name: 'UserPromptSubmit', prompt: 'hello', session_id: 'sess-june' })
  screen('june', ASK) // the words on its screen now: a transcript, say
  assert.notEqual(agent('june').status, 'waiting')
})

test('a Codex agent is not watched for it', () => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'rex', provider: 'codex', cwd: FOLDER }] }))
  hub.loadConfig()
  hub.saveSession('rex', 'sess-rex')
  hub.restart('rex')
  assert.equal(agent('rex').resumeWatch, null)
  clearTimeout(agent('rex').readyTimer)
})

// ---- what the review of this feature found ------------------------------------------------------------------------

test('/clear, then a rest: the next message starts a new conversation, not the cleared one', async () => {
  hub.saveSession('ada', 'old-one')
  free('ada')
  hub.onHook('ada', { hook_event_name: 'SessionStart', source: 'clear', session_id: 'empty-one' })
  await hub.restIdle(LATER())
  assert.equal(agent('ada').status, 'resting')
  hub.send({ to: 'ada', text: 'hi' })
  assert.ok(!runner.live.get('ada').args.includes('old-one'))
})

test('Auto passes over an agent on its way to another computer', async () => {
  agent('ada').moving = true
  hub.send({ text: 'the mobile app needs a look' })
  assert.equal(hub.feed.findLast((e) => e.kind === 'msg').to, 'june')
  assert.ok(!runner.running('ada'))
  agent('ada').moving = false
})

test("one that couldn't start says so at the start, and Auto doesn't strand a message with it", () => {
  clearInterval(hub.stallTimer)
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'ada', area: 'mobile app', cwd: '/nonexistent/folder' }, { name: 'june', area: 'backend api', cwd: FOLDER }] }))
  const h = new Hub(new FakeRunner(), { bin: '/nonexistent' })
  h.start('http://127.0.0.1:1')
  assert.equal(h.agents.get('ada').status, 'stopped')
  assert.match(h.feed.at(-1).text, /failed to start: folder not found/)
  assert.equal(h.agents.get('june').status, 'resting')
  clearInterval(h.stallTimer)
  h.cfg.off('change', h.onConfig)
})

test("a resting agent whose folder went away isn't Auto's pick", () => {
  const a = agent('ada')
  const { cwd } = a
  a.cwd = '/nonexistent/folder'
  hub.send({ text: 'the mobile app needs a look' })
  assert.equal(hub.feed.findLast((e) => e.kind === 'msg').to, 'june')
  assert.equal(a.status, 'resting')
  a.cwd = cwd
})

test('a clone whose terminal was not the one Crew knew goes, and its original can rest', () => {
  clearInterval(hub.stallTimer)
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'ada', area: 'app', cwd: FOLDER, clones: 2 }] }))
  fs.writeFileSync(at('runtime.json'), JSON.stringify({ agents: { 'ada.2': { run: 'known', status: 'idle', cloneOf: 'ada', clone: 2, inbox: [] } } }))
  const next = new FakeRunner()
  next.live.set('ada.2', {})
  const h = new Hub(next, { bin: '/nonexistent' })
  h.start('http://127.0.0.1:1', { survivors: [{ name: 'ada.2', tag: 'other', pid: 1 }] })
  assert.equal(h.agents.has('ada.2'), false)
  assert.equal(h.agents.get('ada').status, 'resting')
  clearInterval(h.stallTimer)
  h.cfg.off('change', h.onConfig)
})

test('a resting agent whose move failed takes what came for it meanwhile', () => {
  const a = agent('ada')
  a.moving = true
  hub.moves ??= new Map()
  hub.moves.set('tok', { name: 'ada', running: false, working: false })
  a.inbox.push({ id: 'm1', from: 'you', to: 'ada', text: 'x', ts: Date.now() })
  moveEnd(hub, 'tok', null)
  assert.equal(a.moving, false)
  assert.ok(runner.running('ada'))
})

test('a timer left over from an agent that has gone starts nothing', () => {
  const gone = agent('ada')
  gone.inbox.push({ id: 'm1', from: 'you', to: 'ada', text: 'x', ts: Date.now() })
  hub.agents.delete('ada')
  hub.pump(gone)
  assert.ok(!runner.running('ada'))
  hub.agents.set('ada', gone)
  gone.inbox.length = 0
})

test('a phone sees a resting agent as idle: older phones would call it stopped', () => {
  const s = { feed: [], reads: {}, usage: {}, spend: {}, tasks: {}, workspace: {}, workspaces: [], channels: [], providers: {}, computers: { me: { slug: 'a', name: 'A' }, links: [] }, agents: hub.snapshot().agents }
  assert.deepEqual(phoneState(s).agents.map((a) => a.status), ['idle', 'idle', 'off'])
})

test('crew who says free or idle, never a word that sounds unavailable', () => {
  free('june')
  assert.doesNotMatch(hub.who('june'), /resting/)
})

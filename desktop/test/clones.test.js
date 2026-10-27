// Clones: an agent with `clones: n` takes a message while it's busy by starting a copy of itself (gal.2, gal.3…)
// in a terminal and conversation of its own. Real Hub, fake runner and clock, throwaway CREW_HOME. `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-clones-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { packAgents, unpackAgents } = await import('../core/pack.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  starts = [] // [name, env]
  submitted = []
  running = (n) => this.live.has(n)
  start = (n, { env }) => (this.starts.push([n, env]), this.live.add(n))
  stop = (n) => this.live.delete(n)
  submit = (name, text) => this.submitted.push({ name, text })
  write() {}
}

const LINGER = 5 * 60000
let hub, runner
const setup = (agents) => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1' // launches go through the fake runner
  for (const a of hub.agents.values()) if (!a.off) (runner.live.add(a.name), (a.status = 'idle'))
}
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  setup([{ name: 'gal', area: 'ui design', clones: 2 }, { name: 'david', area: 'client code' }, { name: 'arie', area: 'admin' }])
})
afterEach(() => {
  mock.timers.reset()
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'reapTimer']) clearTimeout(a[t])
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

const agent = (n) => hub.agents.get(n)
const names = () => [...hub.agents.keys()]
const view = (n) => hub.snapshot().agents.find((a) => a.name === n)
const busy = (n) => (agent(n).status = 'working')
// a clone comes up: its CLI reports in, and the prompt box is ready a moment later
const ready = (n) => (hub.onHook(n, { hook_event_name: 'SessionStart', source: 'startup' }), mock.timers.tick(2000))
const typedInto = (n) => runner.submitted.filter((s) => s.name === n).map((s) => s.text)
const msgTo = (text) => hub.feed.find((e) => e.kind === 'msg' && e.text === text)

test('a free agent takes the message itself, as before', () => {
  assert.equal(hub.send({ to: 'gal', text: 'fix the header' }), 'sent to @gal\n')
  assert.deepEqual(names(), ['gal', 'david', 'arie'])
  assert.deepEqual(typedInto('gal'), ['fix the header'])
})

test('busy, it starts a clone that takes the message in a conversation of its own', () => {
  busy('gal')
  assert.equal(hub.send({ to: 'gal', text: 'fix the footer' }), '@gal is busy, so a clone, @gal.2, is starting up to take this\n')
  const c = agent('gal.2')
  assert.equal(c.cloneOf, 'gal')
  assert.equal(c.status, 'starting')
  assert.equal(c.area, 'ui design')
  assert.deepEqual(runner.starts.map(([n, env]) => [n, env.CREW_AGENT]), [['gal.2', 'gal.2']])
  assert.equal(msgTo('fix the footer').to, 'gal.2') // the feed says who got it
  assert.equal(agent('gal').inbox.length, 0)
  ready('gal.2')
  assert.deepEqual(typedInto('gal.2'), ['fix the footer'])
  assert.equal(c.status, 'working')
})

test('up to its number of clones, then the queue that the first one to finish takes from', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  hub.send({ to: 'gal', text: 'two' })
  assert.match(hub.send({ to: 'gal', text: 'three' }), /^queued for @gal \(working, 1 waiting\)/)
  assert.deepEqual(names().filter((n) => n.startsWith('gal')), ['gal', 'gal.2', 'gal.3'])
  ready('gal.2')
  ready('gal.3')
  // gal.3 finishes first: it takes "three" off gal's queue
  hub.onHook('gal.3', { hook_event_name: 'Stop', last_assistant_message: 'done' })
  mock.timers.tick(600)
  assert.deepEqual(typedInto('gal.3'), ['two', 'three'])
  assert.equal(msgTo('three').to, 'gal.3')
  assert.equal(agent('gal').inbox.length, 0)
})

test('a free clone is reused before another one starts, and the original is first in line', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  ready('gal.2')
  hub.onHook('gal.2', { hook_event_name: 'Stop', last_assistant_message: 'done' })
  mock.timers.tick(600)
  assert.equal(hub.send({ to: 'gal', text: 'two' }), '@gal is busy, so its clone @gal.2 took this\n')
  assert.equal(agent('gal.3'), undefined)
  hub.onHook('gal', { hook_event_name: 'Stop' })
  mock.timers.tick(600)
  hub.onHook('gal.2', { hook_event_name: 'Stop' })
  mock.timers.tick(600)
  assert.equal(hub.send({ to: 'gal', text: 'three' }), 'sent to @gal\n')
})

test('an agent without clones queues as before', () => {
  busy('david')
  assert.match(hub.send({ to: 'david', text: 'later' }), /^queued for @david/)
  assert.deepEqual(names(), ['gal', 'david', 'arie'])
})

test('a teammate\'s answer goes back to the clone that asked, whoever is free', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'build the card' })
  ready('gal.2')
  hub.onHook('gal.2', { hook_event_name: 'UserPromptSubmit', prompt: 'build the card' })
  hub.send({ from: 'gal.2', to: 'david', text: 'what does the API return?' })
  assert.match(runner.submitted.at(-1).text, /^\[from @gal\.2: it's yours now, no need to report back\] what does the API return\?/)
  hub.onHook('david', { hook_event_name: 'UserPromptSubmit', prompt: runner.submitted.at(-1).text })
  hub.onHook('gal.2', { hook_event_name: 'Stop' })
  mock.timers.tick(600)
  agent('gal').status = 'idle' // the original is free, but the answer belongs in gal.2's conversation
  busy('gal.2')
  hub.send({ from: 'david', to: 'gal', text: 'a list of cards' })
  assert.equal(msgTo('a list of cards').to, 'gal.2')
  assert.equal(agent('gal.2').inbox.length, 1)
  assert.deepEqual(typedInto('gal'), [])
})

test('a message for a clone that has gone goes to its original', () => {
  assert.equal(hub.send({ from: 'david', to: 'gal.4', text: 'here you go' }), 'sent to @gal\n')
})

test('an agent and its clones are the same agent: no sending to yourself', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  assert.throws(() => hub.send({ from: 'gal.2', to: 'gal', text: 'hi me' }), /that's you.*\(@gal and @gal\.2 are the same agent\)/)
  assert.throws(() => hub.send({ from: 'gal', to: 'gal.2', text: 'hi me' }), /that's you/)
})

test('a clone with nothing to do goes away after a while', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  ready('gal.2')
  hub.onHook('gal.2', { hook_event_name: 'Stop', last_assistant_message: 'done' })
  mock.timers.tick(600)
  mock.timers.tick(LINGER - 1000)
  assert.ok(agent('gal.2'))
  mock.timers.tick(1000)
  assert.equal(agent('gal.2'), undefined)
  assert.equal(runner.running('gal.2'), false)
  assert.equal(view('gal.2'), undefined)
})

test('...but not while a teammate is still working on what it asked', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  ready('gal.2')
  hub.send({ from: 'gal.2', to: 'david', text: 'check the endpoint' })
  hub.onHook('david', { hook_event_name: 'UserPromptSubmit', prompt: runner.submitted.at(-1).text })
  hub.onHook('gal.2', { hook_event_name: 'Stop' })
  mock.timers.tick(600 + LINGER)
  assert.ok(agent('gal.2'), 'still there for the answer')
  hub.onHook('david', { hook_event_name: 'Stop', last_assistant_message: 'it works' })
  mock.timers.tick(600 + LINGER)
  assert.equal(agent('gal.2'), undefined)
})

test('...nor while its own sub-agents are still running after its turn', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  ready('gal.2')
  hub.onHook('gal.2', { hook_event_name: 'SubagentStart', agent_id: 'sa1', agent_type: 'Explore' })
  hub.onHook('gal.2', { hook_event_name: 'Stop' })
  mock.timers.tick(600 + LINGER)
  assert.ok(agent('gal.2'), 'still there while its sub-agent works')
  hub.onHook('gal.2', { hook_event_name: 'SubagentStop', agent_id: 'sa1' })
  mock.timers.tick(LINGER)
  assert.equal(agent('gal.2'), undefined)
})

test('fewer clones allowed: a spare one goes as soon as it is free', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  hub.send({ to: 'gal', text: 'two' })
  ready('gal.2')
  ready('gal.3')
  hub.update('gal', { clones: 1 })
  hub.onHook('gal.3', { hook_event_name: 'Stop' })
  mock.timers.tick(600)
  assert.equal(agent('gal.3'), undefined)
  assert.ok(agent('gal.2'))
})

test('turning the agent off stops its clones; what they had queued waits for it', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  ready('gal.2')
  busy('gal.2')
  hub.send({ to: 'gal.2', text: 'and this' })
  hub.update('gal', { off: true })
  assert.deepEqual(names(), ['gal', 'david', 'arie'])
  assert.deepEqual(agent('gal').inbox.map((m) => m.text), ['and this'])
  assert.equal(msgTo('and this').to, 'gal')
})

test('a clone that exits is gone, and its queue goes back to the original', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  runner.live.delete('gal.2')
  runner.emit('exit', 'gal.2', 1, 60000)
  assert.equal(agent('gal.2'), undefined)
  assert.deepEqual(agent('gal').inbox.map((m) => m.text), ['one'])
})

test('you can send a clone away; its queued work goes back to the original', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  hub.dismiss('gal.2')
  assert.equal(agent('gal.2'), undefined)
  assert.deepEqual(agent('gal').inbox.map((m) => m.text), ['one'])
  assert.throws(() => hub.dismiss('gal'), /isn't a clone/)
})

test('clones follow their original\'s settings, restarting when free', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  ready('gal.2')
  runner.starts.length = 0
  hub.update('gal', { model: 'opus', area: 'ui and brand' })
  assert.equal(agent('gal.2').area, 'ui and brand')
  assert.equal(agent('gal.2').relaunch, true)
  assert.deepEqual(runner.starts, []) // both are mid-task
  hub.onHook('gal.2', { hook_event_name: 'Stop' })
  assert.deepEqual(runner.starts.map(([n]) => n), ['gal.2'])
  assert.equal(agent('gal').relaunch, true)
})

test('a clone\'s work is its original\'s experience; its conversation isn\'t saved', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  ready('gal.2')
  hub.onHook('gal.2', { hook_event_name: 'UserPromptSubmit', prompt: 'one', session_id: 'sess-clone' })
  hub.onHook('gal.2', { hook_event_name: 'Stop', last_assistant_message: 'done' })
  assert.equal(hub.stats['gal.2'], undefined)
  assert.equal(hub.stats.gal.tasks, 1)
  assert.equal(hub.stats.gal.turns, 1)
  assert.equal(hub.sessions['gal.2'], 'sess-clone') // it can resume its own conversation while it's around
  hub.saveConvos(true)
  const saved = (f) => JSON.parse(fs.readFileSync(path.join(process.env.CREW_HOME, f), 'utf8'))
  assert.equal(saved('conversations.json')['gal.2'], undefined)
  hub.saveSession('david', 'sess-david')
  assert.deepEqual(Object.keys(saved('sessions.json')), ['david'])
  assert.equal(hub.feed.find((e) => e.kind === 'reply').from, 'gal.2')
})

test('the snapshot lists clones after their original, looking like it', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'one' })
  const list = hub.snapshot().agents
  assert.deepEqual(list.map((a) => a.name), ['gal', 'gal.2', 'david', 'arie'])
  const c = list[1]
  assert.deepEqual([c.cloneOf, c.clone, c.avatar.seed, c.on], ['gal', 2, 'gal', true])
  assert.equal(list[0].clones, 2)
  assert.equal(list[2].clones, 0)
  assert.match(hub.who(), /gal\.2\s+starting, 1 queued\s+a clone of gal/)
  assert.match(hub.who(), /ui design \(clones itself when busy, up to 2\)/)
})

test('routing counts a busy agent that can clone itself as free', () => {
  busy('gal')
  busy('arie')
  assert.match(hub.send({ text: 'polish the ui design of the settings' }), /@gal is busy, so a clone/)
})

test('tasks: the board remembers the agent, and Send back reaches the clone still on it', async () => {
  const t = hub.tickets.add({ text: 'Broken header', by: 'you', kind: 'bug', owner: 'gal' })
  busy('gal')
  await hub.dispatch(t.id)
  assert.equal(t.fixer, 'gal')
  ready('gal.2')
  assert.equal(hub.convos['gal.2'].ticket, t.id)
  hub.taskCommand('gal.2', ['done', String(t.id), 'fixed the flex row'])
  assert.equal(t.fixer, 'gal')
  assert.equal(t.status, 'check')
  assert.equal(hub.feed.at(-1).from, 'gal.2') // the feed says which one did it
  hub.onHook('gal.2', { hook_event_name: 'Stop' })
  mock.timers.tick(600)
  agent('gal').status = 'idle'
  await hub.ticket('sendBack', t.id, 'still broken on mobile')
  assert.match(typedInto('gal.2').at(-1), /still broken on mobile/)
  assert.deepEqual(typedInto('gal'), [])
})

test('packs carry how many clones an agent may have', () => {
  const pack = packAgents(hub, ['gal'])
  assert.equal(pack.agents[0].clones, 2)
  const added = unpackAgents(hub, { ...pack, agents: [{ ...pack.agents[0], clones: 99 }] }, [{ index: 0, name: 'gal-copy', on: false }])
  assert.equal(hub.config.agents.find((a) => a.name === added[0]).clones, 5)
})

// ---- how clones look in the UI (ui/common.js, rendered from the hub's snapshot) ----

const ui = (() => {
  const ctx = vm.createContext({ crew: {}, avatarHTML: (a) => `<av ${a.avatar?.seed ?? a.name}>`, agentColor: (a) => `color(${a.avatar?.seed ?? a.name})`, CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
  vm.runInContext(fs.readFileSync(path.resolve(import.meta.dirname, '../ui/common.js'), 'utf8') + ';globalThis.__x = { feedView, nameHTML, rosterHTML, typingHTML }', ctx)
  return ctx.__x
})()

test('ui: a clone goes by its agent\'s name and face with its number, in the feed and its rows', () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'make the empty state' })
  const agents = hub.snapshot().agents
  const clone = agents.find((a) => a.name === 'gal.2')
  assert.equal(ui.nameHTML(clone), 'gal<span class="clone-no" title="Clone 2 of gal: it took a task while gal was busy">2</span>')
  // the message says who took it; the face is gal's
  const html = ui.feedView(hub.feed, agents, new Set(), 200).html()
  assert.match(html, /to <span class="who" data-agent="gal\.2" style="--c:color\(gal\)">@gal<span class="clone-no"/)
  // gal's row counts its clone (its face and how many); unfolded, the clone's row is right under it. "Who's on it"
  // shows it while it starts.
  const crew = { agents, computers: { me: { name: 'Mac' }, links: [] } }
  assert.match(ui.rosterHTML(crew), /data-agent="gal"[\s\S]*data-fold="clones:gal"[\s\S]*<av gal><b>1<\/b>/)
  assert.doesNotMatch(ui.rosterHTML(crew), /data-clone="gal\.2"/)
  assert.match(ui.rosterHTML(crew, { folds: new Set(['clones:gal']) }), /data-agent="gal"[\s\S]*data-clone="gal\.2"[\s\S]*<av gal>[\s\S]*starting/)
  assert.match(ui.rosterHTML(crew, { selected: 'gal.2' }), /data-clone="gal\.2"/)
  assert.match(ui.typingHTML(agents), /data-agent="gal\.2"[\s\S]*starting up to take it/)
})

test('ui: a clone that has gone keeps its agent\'s face and name in the feed', () => {
  const agents = hub.snapshot().agents
  const feed = [{ id: 'r1', kind: 'reply', from: 'gal.3', text: 'done', ts: Date.now() }]
  const html = ui.feedView(feed, agents, new Set(), 200).html()
  assert.match(html, /<av gal>/)
  assert.match(html, />gal<span class="clone-no"[^>]*>3<\/span>/)
})

test("parking its workspace: what a clone had queued waits with its agent, typed into nobody's terminal", () => {
  busy('gal')
  hub.send({ to: 'gal', text: 'make the empty state' })
  assert.ok(names().includes('gal.2'), 'a clone took it')
  hub.park()
  assert.ok(!names().includes('gal.2'), 'the clone goes home')
  assert.equal(agent('gal').status, 'off')
  assert.deepEqual(agent('gal').inbox.map((m) => m.text), ['make the empty state'], 'waiting for the workspace to open')
  assert.deepEqual([...typedInto('gal'), ...typedInto('gal.2')], [])
})

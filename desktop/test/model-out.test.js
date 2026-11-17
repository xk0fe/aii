// When a model runs out (core/standin.js, Hub.modelRanOut): Claude Code stops a turn with "You've hit your Fable limit ·
// resets …" while the account has plenty left. By default the agent goes on with the next model (its conversation
// resumed, "continue" typed for it) and back to its own once the limit resets; "wait" waits for the reset, "tell" stops
// and leaves it to you. Real Hub, fake runner and clock, throwaway CLIQUE_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-model-out-'))
// (an account's folder is made from Claude Code's own: a throwaway one, never yours)
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-model-out-home-'))
process.env.HOME = SANDBOX
process.env.CLAUDE_CONFIG_DIR = path.join(SANDBOX, '.claude')
fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR)
const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-model-out-cwd-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { ranOut, resetsAtOf, familyOf, standInFor, withModel, onModelOutOf } = await import('../core/standin.js')

const MODELS = ['fable', 'opus', 'sonnet', 'haiku']
const NOW = Date.parse('2026-11-17T20:00:00Z')
// what Claude Code 2.1.326 said on 2026-11-17, as CLIque's chat has it
const FABLE_OUT = "You've hit your Fable limit · resets Nov 20 at 6am (America/Fortaleza)"
const RESET = Date.parse('2026-11-20T09:00:00Z')

// ---- reading what the CLI said -------------------------------------------------------------------------------------

test('a model of its own running out is told apart from the account running out', () => {
  assert.deepEqual(ranOut(FABLE_OUT, MODELS, NOW), { model: 'fable', name: 'Fable', resetsAt: RESET })
  assert.equal(ranOut("You've hit your Opus limit · resets 6:30pm (UTC)", MODELS, NOW).model, 'opus')
  assert.equal(ranOut('You’ve reached your Sonnet limit · resets in 2h 30m', MODELS, NOW).resetsAt, NOW + 2.5 * 36e5)
  assert.deepEqual(ranOut('Fable requires usage credits. Switch models to continue.', MODELS, NOW), { model: 'fable', name: 'Fable', resetsAt: null })
  // the account's: no other model gets around those
  for (const t of ["You've hit your session limit · resets 9:10pm", "You've hit your weekly limit · resets Nov 20 at 6am", "You've hit your monthly spend limit.", "You've hit your fast limit", "You've hit your 5-hour limit", 'API Error: Connection lost mid-response.', '', undefined]) {
    assert.equal(ranOut(t, MODELS, NOW), null, String(t))
  }
  // a provider whose menu doesn't have that model
  assert.equal(ranOut(FABLE_OUT, ['glm-5.1'], NOW), null)
})

test('when it resets: the zone in brackets, the next such date or time to come, or nothing', () => {
  assert.equal(resetsAtOf('resets 6:30pm (UTC)', NOW), Date.parse('2026-11-18T18:30:00Z')) // passed today: tomorrow
  assert.equal(resetsAtOf('resets 9pm (UTC)', NOW), Date.parse('2026-11-17T21:00:00Z'))
  assert.equal(resetsAtOf('resets 18:00 (Europe/Berlin)', NOW), Date.parse('2026-11-18T17:00:00Z'))
  assert.equal(resetsAtOf('resets Jan 3 at 6am (America/Fortaleza)', NOW), Date.parse('2027-01-03T09:00:00Z')) // next year's
  assert.equal(resetsAtOf('resets Nov 20, 2027 at 6am (UTC)', NOW), Date.parse('2027-11-20T06:00:00Z'))
  assert.equal(resetsAtOf('resets in 1d 2h', NOW), NOW + 26 * 36e5)
  assert.equal(resetsAtOf('resets Nov 20 at 6am (Not/AZone)', NOW), new Date(2026, 10, 20, 6, 0).getTime()) // this computer's
  for (const t of ['resets soon', 'resets 20', 'resets 25:00', 'no reset here']) assert.equal(resetsAtOf(t, NOW), null, t)
})

test('the stand-in: the next model down the list, then up it, skipping any that ran out too', () => {
  assert.equal(familyOf('claude-fable-5-2', MODELS), 'fable')
  assert.equal(familyOf('fable[1m]', MODELS), 'fable')
  assert.equal(familyOf('Opus', MODELS), 'opus')
  assert.equal(familyOf('', MODELS), null)
  assert.equal(familyOf('gpt-6', MODELS), null)
  assert.equal(standInFor('fable', MODELS), 'opus')
  assert.equal(standInFor('fable', MODELS, new Set(['fable', 'opus'])), 'sonnet')
  assert.equal(standInFor('haiku', MODELS, new Set(['haiku'])), 'sonnet')
  assert.equal(standInFor('opus', ['opus'], new Set(['opus'])), null)
  assert.equal(withModel('fable[1m]', 'fable', 'opus'), 'opus[1m]')
  assert.equal(withModel('claude-fable-5-2', 'fable', 'opus'), 'opus')
  assert.equal(onModelOutOf({}), 'switch')
  assert.equal(onModelOutOf({ onModelOut: 'wait' }), 'wait')
  assert.equal(onModelOutOf({ onModelOut: 'nonsense' }), 'switch')
})

// ---- what the hub does ---------------------------------------------------------------------------------------------

class FakeRunner extends EventEmitter {
  live = new Map()
  starts = []
  submitted = []
  running = (n) => this.live.has(n)
  start = (n, opts) => (this.starts.push({ n, args: opts.args }), this.live.set(n, opts))
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.submitted.push({ n, text })
  write() {}
  pid() {}
}

let hub, runner, noor, task
const config = (extra = {}) =>
  fs.writeFileSync(CONFIG, JSON.stringify({
    autopilot: true,
    agents: [
      { name: 'noor', area: 'client code', model: 'fable', cwd: FOLDER },
      { name: 'iris', area: 'design', model: 'fable', cwd: FOLDER },
      { name: 'sam', area: 'backend', model: 'sonnet', cwd: FOLDER },
    ],
    ...extra,
  }))
const hook = (name, e) => hub.onHook(name, e)
const up = (name) => hook(name, { hook_event_name: 'SessionStart', source: 'resume' })
const typed = (name) => runner.submitted.filter((s) => s.n === name).map((s) => s.text)
const modelArg = (name) => {
  const args = runner.starts.findLast((s) => s.n === name)?.args ?? []
  return args.includes('--model') ? args[args.indexOf('--model') + 1] : null
}
const events = (name) => hub.feed.filter((e) => e.kind === 'event' && e.from === name).map((e) => e.text)
const editConfig = (f) => {
  const data = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
  f(data)
  fs.writeFileSync(CONFIG, JSON.stringify(data))
  hub.loadConfig()
}
const startsOf = (name) => runner.starts.filter((s) => s.n === name).length
const toReset = () => mock.timers.tick(RESET - Date.now() + 120000)
// Claude Code asking before it resumes a long conversation (adapters.js RESUME_ASK)
const RESUME_QUESTION = 'Resume this conversation?\nThis conversation has been inactive for 3h and is 900k tokens long. Resuming it will use about 18% of your 5-hour usage limit.\n❯ Resume\n  Start a new conversation'
const fableOut = (name = 'noor') => hook(name, { hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: FABLE_OUT })

function fresh(extra) {
  config(extra)
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1'
}

// noor and iris are up on Fable (iris idle), sam on Sonnet; noor is on a task when Fable runs out
function start(extra) {
  fresh(extra)
  for (const name of ['noor', 'iris', 'sam']) {
    hub.launch(hub.agents.get(name))
    up(name)
  }
  mock.timers.tick(2000)
  noor = hub.agents.get('noor')
  hub.send({ to: 'noor', text: 'build option C' })
  task = hub.feed.find((e) => e.text === 'build option C')
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: typed('noor').at(-1), session_id: 'noor-session' })
}

// (also between two runs in one test: the clock back to NOW, nothing kept from the last run)
function clean() {
  if (hub) {
    for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'retryTimer', 'startTimer', 'stopTimer']) clearTimeout(a[t])
    for (const t of ['statsTimer', 'convoTimer', 'usageTimer', 'modelsTimer', 'runtimeTimer']) clearTimeout(hub[t])
  }
  hub = null
  mock.timers.reset()
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json', 'usage.json', 'runtime.json']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
}
beforeEach(clean)
afterEach(async () => {
  mock.timers.reset()
  if (!hub) return
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'retryTimer', 'startTimer', 'stopTimer']) clearTimeout(a[t])
  for (const t of ['statsTimer', 'convoTimer', 'usageTimer', 'modelsTimer', 'runtimeTimer', 'lookTimer', 'readsTimer']) clearTimeout(hub[t])
  clearInterval(hub.stallTimer)
  clearInterval(hub.threadTimer)
  hub.keepRuntime = false
  fs.unwatchFile(CONFIG) // (Hub.start watches config.json)
  await hub.saving
})
after(() => {
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(FOLDER, { recursive: true, force: true })
  fs.rmSync(SANDBOX, { recursive: true, force: true })
})

test('switch (the default): the agent goes on with Opus, in the same conversation, and the turn carries on', () => {
  start()
  const tasks = hub.stats.noor.tasks
  assert.equal(modelArg('noor'), 'fable')
  fableOut()
  assert.match(events('noor').at(-1), /^ran out of Fable \(it resets .*\), so it goes on with Opus until then$/)
  assert.ok(!hub.feed.at(-1).alert) // nothing for you to do
  assert.equal(noor.status, 'starting')
  assert.equal(modelArg('noor'), 'opus')
  const args = runner.starts.findLast((s) => s.n === 'noor').args
  assert.equal(args[args.indexOf('--resume') + 1], 'noor-session')
  // up again: "continue", once it has settled
  up('noor')
  assert.ok(!typed('noor').includes('continue'))
  mock.timers.tick(2000)
  assert.equal(typed('noor').at(-1), 'continue')
  assert.equal(noor.status, 'working')
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: 'continue', session_id: 'noor-session' })
  assert.equal(hub.feed.filter((e) => e.text === 'continue').length, 0) // not a message of yours
  assert.equal(hub.stats.noor.tasks, tasks) // nor a new task
  assert.deepEqual(noor.serving.map((m) => m.id), [task.id]) // what the turn answers came along (a teammate's ask hears the reply)
  hook('noor', { hook_event_name: 'Stop', last_assistant_message: 'Option C is up as a PR.' })
  assert.equal(hub.feed.at(-1).re, task.id) // the reply answers the task
  // the account knows Fable is out, until a moment after it resets
  assert.ok(hub.usage.claude.models.fable.until >= RESET)
  assert.deepEqual(hub.snapshot().agents.find((a) => a.name === 'noor').standIn, { model: 'opus', for: 'Fable', until: hub.usage.claude.models.fable.until })
})

test("the account's other agents on Fable follow: one that's up starts again on Opus, one that wakes later starts on it", () => {
  start()
  const iris = hub.agents.get('iris')
  hub.rest(hub.agents.get('sam'))
  fableOut()
  // iris was idle: on Opus right away (her conversation resumed); sam is on Sonnet and stays put
  assert.equal(modelArg('iris'), 'opus')
  assert.match(events('iris').at(-1), /^goes on with Opus while Fable is out \(it's back /)
  assert.equal(iris.status, 'starting')
  assert.equal(runner.starts.filter((s) => s.n === 'sam').length, 1)
  // a new agent, or one that rested, starts on Opus when it gets work
  hub.rest(iris)
  hub.send({ to: 'iris', text: 'a new icon' })
  assert.equal(modelArg('iris'), 'opus')
})

test('once Fable resets, each agent goes back to it when it is free', () => {
  start()
  fableOut()
  up('noor')
  mock.timers.tick(2000)
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: 'continue', session_id: 'noor-session' })
  up('iris')
  // noor is mid-turn at the reset: back on Fable once that turn is done
  mock.timers.tick(RESET - Date.now() + 120000)
  assert.equal(modelArg('iris'), 'fable')
  assert.equal(events('iris').at(-1), 'is back on Fable')
  assert.equal(modelArg('noor'), 'opus')
  assert.equal(noor.relaunch, true)
  hook('noor', { hook_event_name: 'Stop', last_assistant_message: 'done' })
  assert.equal(modelArg('noor'), 'fable')
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'noor').standIn, undefined)
  assert.equal(hub.usage.claude.models.fable, undefined)
})

test('Fable and Opus both out: Sonnet; nothing left: it stops and tells you', () => {
  start()
  hub.usage.claude = { told: {}, models: { opus: { name: 'Opus', until: RESET } } }
  fableOut()
  assert.equal(modelArg('noor'), 'sonnet')
  fresh()
  hub.providers.claude.models = ['fable']
  const a = hub.agents.get('noor')
  hub.launch(a)
  up('noor')
  mock.timers.tick(2000)
  hub.send({ to: 'noor', text: 'go' })
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: typed('noor').at(-1) })
  fableOut()
  assert.equal(a.status, 'waiting')
  assert.match(events('noor').at(-1), /ran out of Fable .*No other Claude model is left/)
})

test('wait: no other model; "continue" goes in once Fable resets, and messages wait until then', () => {
  start({ onModelOut: 'wait' })
  fableOut()
  assert.match(events('noor').at(-1), /^ran out of Fable, which resets .*: CLIque types "continue" for it then/)
  assert.equal(modelArg('noor'), 'fable')
  assert.equal(runner.starts.filter((s) => s.n === 'noor').length, 1) // not started again
  assert.equal(noor.status, 'idle')
  assert.equal(modelArg('iris'), 'fable') // nobody switches
  hub.send({ to: 'noor', text: 'and the TV mirror' })
  mock.timers.tick(RESET - Date.now() - 1000)
  assert.ok(!typed('noor').includes('continue'))
  assert.ok(!typed('noor').some((t) => t.includes('TV mirror')))
  assert.equal(hub.workable(noor), false) // Auto gives it nothing meanwhile
  mock.timers.tick(62000)
  assert.equal(typed('noor').at(-1), 'continue')
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  hook('noor', { hook_event_name: 'Stop', last_assistant_message: 'Option C is done.' })
  assert.equal(hub.feed.at(-1).re, task.id)
  mock.timers.tick(3000)
  assert.match(typed('noor').at(-1), /TV mirror/) // and then what waited
})

test('wait, then you give it another model: it goes on with that now rather than at the reset', () => {
  start({ onModelOut: 'wait' })
  fableOut()
  const data = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
  data.agents[0].model = 'opus'
  fs.writeFileSync(CONFIG, JSON.stringify(data))
  hub.loadConfig()
  assert.equal(modelArg('noor'), 'opus')
  up('noor')
  mock.timers.tick(2000)
  assert.equal(typed('noor').at(-1), 'continue')
})

test('wait, then switched to Next model: an agent waiting for the reset goes on with Opus now', () => {
  start({ onModelOut: 'wait' })
  fableOut()
  config()
  hub.loadConfig()
  hub.followModels()
  assert.equal(modelArg('noor'), 'opus')
  up('noor')
  mock.timers.tick(2000)
  assert.equal(typed('noor').at(-1), 'continue')
})

test('tell: it stops and tells you; give it another model and it goes on with that right away', () => {
  start({ onModelOut: 'tell' })
  fableOut()
  assert.equal(noor.status, 'waiting')
  assert.match(events('noor').at(-1), /^ran out of Fable \(it resets .*\)\. Give it another model and it goes on with that/)
  assert.equal(hub.feed.at(-1).alert, true)
  assert.equal(modelArg('noor'), 'fable')
  // you pick Opus for it, as from its settings
  const data = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
  data.agents[0].model = 'opus'
  fs.writeFileSync(CONFIG, JSON.stringify(data))
  hub.loadConfig()
  assert.equal(modelArg('noor'), 'opus')
  up('noor')
  mock.timers.tick(2000)
  assert.equal(typed('noor').at(-1), 'continue')
})

test('tell, then switched to Next model: an agent stopped at the limit goes on with Opus', () => {
  start({ onModelOut: 'tell' })
  fableOut()
  config()
  hub.loadConfig()
  hub.followModels()
  assert.equal(modelArg('noor'), 'opus')
  up('noor')
  mock.timers.tick(2000)
  assert.equal(typed('noor').at(-1), 'continue')
})

test('an account-wide limit is still yours, as before', () => {
  start()
  hook('noor', { hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: "You've hit your session limit · resets 9:10pm" })
  assert.equal(noor.status, 'waiting')
  assert.match(events('noor').at(-1), /stopped on an API error \(rate_limit\): You've hit your session limit/)
  assert.equal(hub.usage.claude?.models, undefined)
  assert.equal(modelArg('iris'), 'fable')
})

test("an agent on the CLI's default model learns it was Fable", () => {
  fresh()
  const data = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
  delete data.agents[0].model
  fs.writeFileSync(CONFIG, JSON.stringify(data))
  hub.loadConfig()
  noor = hub.agents.get('noor')
  hub.launch(noor)
  up('noor')
  mock.timers.tick(2000)
  assert.equal(modelArg('noor'), null)
  hub.send({ to: 'noor', text: 'go' })
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: typed('noor').at(-1) })
  fableOut()
  assert.equal(noor.ranFamily, 'fable')
  assert.equal(modelArg('noor'), 'opus')
})

test('Stop while it waits for the reset: no "continue" later', () => {
  start({ onModelOut: 'wait' })
  fableOut()
  hub.send({ to: 'noor', text: 'actually, stop that' }) // queued behind the wait
  assert.ok(noor.carry)
  // you type in its terminal: that's the turn now
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: 'never mind, do the docs' })
  assert.equal(noor.carry, null)
})

test('which models are out is kept: a CLIque started again starts Fable agents on Opus until the reset', async () => {
  start()
  fableOut()
  hub.saveUsage(true)
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.CLIQUE_HOME, 'usage.json'), 'utf8'))
  assert.ok(saved.claude.models.fable.until >= RESET)
  for (const t of ['statsTimer', 'convoTimer', 'usageTimer', 'modelsTimer', 'runtimeTimer']) clearTimeout(hub[t])
  await hub.saving
  fresh()
  hub.launch(hub.agents.get('iris'))
  assert.equal(modelArg('iris'), 'opus')
})

test('through CLIque, as the app calls it: the choice is in config.json, and every workspace follows the account', async () => {
  const { Clique } = await import('../core/clique.js')
  fs.rmSync(path.join(process.env.CLIQUE_HOME, 'workspaces'), { recursive: true, force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({
    autopilot: true,
    agents: [{ name: 'noor', area: 'client code', model: 'fable', cwd: FOLDER }, { name: 'iris', area: 'design', model: 'fable', cwd: FOLDER }],
    workspaces: [{ id: 'one', name: 'One', members: { noor: {} } }, { id: 'two', name: 'Two', members: { iris: {} } }],
  }))
  const c = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
  clearTimeout(c.changeTimer)
  const live = new Map()
  const starts = []
  Object.assign(c.runner, { running: (n) => live.has(n), start: (n, o) => (starts.push({ n, args: o.args }), live.set(n, o)), stop: (n) => live.delete(n), submit() {}, write() {}, quietFor: () => Infinity, pid() {} })
  const model = (name) => {
    const args = starts.findLast((s) => s.n.endsWith(name))?.args ?? []
    return args[args.indexOf('--model') + 1]
  }
  const [one, two] = [c.hubs.get('one'), c.hubs.get('two')]
  hub = one
  try {
    assert.equal(c.snapshot().modelOut, 'switch', 'Next model on a new install')
    for (const [h, name] of [[one, 'noor'], [two, 'iris']]) {
      h.launch(h.agents.get(name))
      h.onHook(name, { hook_event_name: 'SessionStart', source: 'startup' })
    }
    mock.timers.tick(2000)
    one.send({ to: 'noor', text: 'build option C' })
    one.onHook('noor', { hook_event_name: 'UserPromptSubmit', prompt: 'build option C' })
    one.onHook('noor', { hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: FABLE_OUT })
    assert.equal(model('noor'), 'opus')
    assert.equal(model('iris'), 'opus', "another workspace's agent on the same account follows")
    // Tell me: no stand-ins any more, so iris (free) is back on Fable
    assert.equal(c.setModelOut('tell'), 'tell')
    assert.equal(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).onModelOut, 'tell')
    assert.equal(c.snapshot().modelOut, 'tell')
    assert.equal(model('iris'), 'fable')
    // and Next model again is the default: nothing left in config.json
    c.setModelOut('switch')
    assert.equal('onModelOut' in JSON.parse(fs.readFileSync(CONFIG, 'utf8')), false)
    assert.throws(() => c.setModelOut('sometimes'), /switch, wait, tell/)
  } finally {
    clearTimeout(c.changeTimer)
    for (const h of c.hubs.values()) {
      for (const a of h.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'retryTimer', 'startTimer']) clearTimeout(a[t])
      h.dispose()
    }
  }
})

// ---- what the owed "continue" mustn't outlive, and what it must ------------------------------------------------------

test('turned off while it starts again on Opus, or while it waits: no "continue" once it is on again', () => {
  start()
  fableOut()
  editConfig((d) => (d.agents[0].off = true))
  editConfig((d) => delete d.agents[0].off)
  assert.equal(noor.carry, null)
  hub.launch(noor)
  up('noor')
  mock.timers.tick(5000)
  assert.ok(!typed('noor').includes('continue'))
})

test('wait: turned off, or its workspace parked, while it waits: no "continue" at the reset', () => {
  for (const away of [() => editConfig((d) => (d.agents[0].off = true)), () => hub.park()]) {
    clean()
    start({ onModelOut: 'wait' })
    fableOut()
    away()
    assert.equal(noor.status, 'off')
    editConfig((d) => delete d.agents[0].off)
    hub.unpark()
    const before = startsOf('noor')
    toReset()
    assert.equal(startsOf('noor'), before, 'nothing started by itself')
    assert.ok(!typed('noor').includes('continue'))
    assert.equal(hub.convos.noor?.carry, undefined)
  }
})

test("an agent with work left running in the background, or that you're typing into, isn't restarted under it", () => {
  start()
  const iris = hub.agents.get('iris')
  hub.send({ to: 'iris', text: 'audit the icons' })
  hook('iris', { hook_event_name: 'UserPromptSubmit', prompt: typed('iris').at(-1), session_id: 'iris-session' })
  hook('iris', { hook_event_name: 'Stop', last_assistant_message: 'The audit runs in the background.', background_tasks: [{ id: 'b1', type: 'shell', status: 'running' }] })
  assert.equal(iris.background, 1)
  hub.input('sam', 'please also che') // half a line in sam's terminal (sam on Sonnet: nothing to do with it anyway)
  const n = startsOf('iris')
  fableOut()
  assert.equal(startsOf('iris'), n)
  // once what it left running is done, it moves at the next look, a minute on
  iris.background = 0
  mock.timers.tick(61000)
  assert.equal(startsOf('iris'), n + 1)
  assert.equal(modelArg('iris'), 'opus')
  // and typing: iris on Opus, you type in her terminal just before Fable is back
  up('iris')
  mock.timers.tick(2000)
  hub.input('iris', 'one more th')
  const m = startsOf('iris')
  toReset()
  assert.ok(startsOf('iris') > m, 'once you stopped typing a minute ago, she goes back to Fable')
  assert.equal(modelArg('iris'), 'fable')
})

test('the resume question right after "continue": "continue" again once it is answered, never the task a second time', () => {
  start()
  fableOut()
  up('noor')
  mock.timers.tick(2000)
  assert.equal(typed('noor').at(-1), 'continue')
  runner.emit('data', 'noor', RESUME_QUESTION)
  assert.equal(noor.status, 'waiting')
  assert.equal(noor.inbox.length, 0)
  hub.input('noor', '\r') // Resume, in its terminal
  mock.timers.tick(5000)
  assert.deepEqual(typed('noor'), ['build option C', 'continue', 'continue'])
})

test('wait: kept with its conversation, so CLIque started again with its terminal gone still waits, then carries on', async () => {
  start({ onModelOut: 'wait' })
  fableOut()
  hub.send({ to: 'noor', text: 'and the TV mirror' })
  hub.saveUsage(true)
  hub.saveRuntime(true)
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer']) clearTimeout(a[t])
  clearTimeout(hub.modelsTimer)
  await hub.saving
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.start('http://127.0.0.1:1', { survivors: [] })
  noor = hub.agents.get('noor')
  assert.equal(noor.status, 'resting')
  assert.equal(noor.carry?.until, hub.usage.claude.models.fable.until)
  mock.timers.tick(5000)
  assert.deepEqual(typed('noor'), [], 'nothing goes to Fable before its reset')
  toReset()
  up('noor')
  mock.timers.tick(5000)
  assert.deepEqual(typed('noor'), ['continue'])
  hook('noor', { hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  hook('noor', { hook_event_name: 'Stop', last_assistant_message: 'done' })
  mock.timers.tick(5000)
  assert.match(typed('noor').at(-1), /TV mirror/) // and then what waited
})

test('wait: it may rest meanwhile (its terminal goes), and starts again at the reset to carry on', () => {
  start({ onModelOut: 'wait' })
  fableOut()
  assert.equal(hub.mayRest(noor, Date.now() + 3600000, 600000), true)
  hub.rest(noor)
  assert.equal(noor.status, 'resting')
  const n = startsOf('noor')
  toReset()
  assert.equal(startsOf('noor'), n + 1)
  up('noor')
  mock.timers.tick(5000)
  assert.equal(typed('noor').at(-1), 'continue')
})

test('wait: renamed while it waits, it still carries on at the reset', () => {
  start({ onModelOut: 'wait' })
  fableOut()
  hub.update('noor', { name: 'nora' })
  if (hub.agents.get('nora').status === 'starting') up('nora')
  toReset()
  if (hub.agents.get('nora').status === 'starting') up('nora')
  mock.timers.tick(5000)
  assert.equal(typed('nora').at(-1), 'continue')
})

test('wait: /clear, another account, or Stop ends the wait', () => {
  start({ onModelOut: 'wait' })
  fableOut()
  hook('noor', { hook_event_name: 'SessionStart', source: 'clear', session_id: 'new-one' })
  toReset()
  assert.ok(!typed('noor').includes('continue'), 'not into the conversation /clear started')

  clean()
  start({ onModelOut: 'wait', accounts: [{ id: 'claude-work', provider: 'claude', name: 'Work' }] })
  hub.signedIn = () => true
  fableOut()
  editConfig((d) => (d.agents[0].account = 'claude-work')) // whose Fable has room
  up('noor')
  mock.timers.tick(5000)
  assert.equal(typed('noor').at(-1), 'continue')
  assert.equal(modelArg('noor'), 'fable')

  clean()
  start({ onModelOut: 'wait' })
  fableOut()
  assert.equal(hub.snapshot().agents.find((a) => a.name === 'noor').canStop, true)
  assert.deepEqual(hub.stopTurns(['noor']).stopped, ['noor'])
  toReset()
  assert.ok(!typed('noor').includes('continue'))
})

test('tell, then Wait picked: the agent stopped at the limit carries on at the reset', () => {
  start({ onModelOut: 'tell' })
  fableOut()
  editConfig((d) => (d.onModelOut = 'wait')) // as by hand: config.json is followed
  assert.equal(noor.status, 'idle')
  assert.match(events('noor').at(-1), /CLIque types "continue" for it then/)
  toReset()
  assert.equal(typed('noor').at(-1), 'continue')
})

test('an agent set to Sonnet whose turn ran into Fable (switched in its terminal) goes back to Sonnet', () => {
  start()
  const sam = hub.agents.get('sam')
  hub.send({ to: 'sam', text: 'migrate the db' })
  hook('sam', { hook_event_name: 'UserPromptSubmit', prompt: typed('sam').at(-1), session_id: 'sam-session' })
  fableOut('sam')
  assert.equal(events('sam').at(-1).replace(/\(.*\)/, '()'), 'ran out of Fable (), so it goes on with its own model, Sonnet')
  assert.equal(modelArg('sam'), 'sonnet')
  up('sam')
  mock.timers.tick(2000)
  assert.equal(typed('sam').at(-1), 'continue')
  // ...and runs into Fable again in that turn (a sub-agent set to Fable): no going round, it's yours
  hook('sam', { hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
  fableOut('sam')
  assert.equal(sam.status, 'waiting')
  assert.match(events('sam').at(-1), /^ran out of Fable again .*a sub-agent set to it/)
})

test('Next model switched off while Fable is still out: the line says it is still out, not that it is back', () => {
  start()
  fableOut()
  up('iris')
  editConfig((d) => (d.onModelOut = 'tell'))
  assert.equal(modelArg('iris'), 'fable')
  assert.equal(events('iris').at(-1), 'goes back to Fable, which is still out: "When a model runs out" no longer switches models')
})

test('when it resets, said other ways', () => {
  assert.equal(resetsAtOf('resets 6am Nov 20 (UTC)', NOW), Date.parse('2026-11-20T06:00:00Z'))
  assert.equal(resetsAtOf('resets 20 Nov at 6am (UTC)', NOW), Date.parse('2026-11-20T06:00:00Z'))
  assert.equal(resetsAtOf('resets Thu at 6am (UTC)', NOW), Date.parse('2026-11-19T06:00:00Z'))
  assert.equal(resetsAtOf('resets Tue at 6am (UTC)', NOW), Date.parse('2026-11-24T06:00:00Z')) // today's has passed
  assert.equal(resetsAtOf('resets tomorrow at 18:00 (UTC)', NOW), Date.parse('2026-11-18T18:00:00Z'))
  assert.equal(resetsAtOf('resets at 6am (UTC)', NOW), Date.parse('2026-11-18T06:00:00Z'))
  assert.equal(resetsAtOf('resets in 2h30m', NOW), NOW + 2.5 * 36e5)
  assert.equal(resetsAtOf('resets 13pm', NOW), null)
})

// Staying awake (core/awake.js): the computer is kept from sleeping while one of its own agents works, a little after
// the last one finishes, and for the reasons it always was (sharing, a linked computer, a phone). The decision alone,
// then what the real Clique and Hub report as they go through a task. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-awake-'))
if (process.platform !== 'win32') process.env.PATH = '/usr/bin:/bin' // no codex to discover once a hub starts
const { CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
const { decide, keeper, workingHere, awakeLine, awakeState, GRACE, RECHECK } = await import('../core/awake.js')
const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-awake-folder-'))
fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'ada', area: 'mobile app', cwd: FOLDER }, { name: 'june', area: 'backend api', cwd: FOLDER }] }))

const IDLE = { working: 0, enabled: true, sharing: false, linked: false, phones: false }
const T = 1_000_000

// ---- the decision ---------------------------------------------------------------------------------------------------

test('nothing to stay awake for: off, and nothing to ask again', () => {
  assert.deepEqual(decide({}, IDLE, T), { on: false, reasons: [], working: 0, until: null, again: null })
})

test('an agent working keeps the computer awake, and is asked about again in a minute', () => {
  const d = decide({}, { ...IDLE, working: 2 }, T)
  assert.deepEqual(d, { on: true, reasons: ['working'], working: 2, until: null, again: RECHECK })
})

test('the last one finishing holds it for the grace, then lets go: no letting go and taking hold between tasks', () => {
  let d = decide({}, { ...IDLE, working: 1 }, T)
  d = decide(d, IDLE, T + 5000)
  assert.deepEqual(d, { on: true, reasons: ['finishing'], working: 0, until: T + 5000 + GRACE, again: GRACE })
  // asked again inside the grace (any change of state does): the same end, not a new one
  d = decide(d, IDLE, T + 65_000)
  assert.equal(d.on, true)
  assert.equal(d.until, T + 5000 + GRACE)
  assert.equal(d.again, GRACE - 60_000)
  // work again before it ends: held all along, and a new grace after that
  d = decide(d, { ...IDLE, working: 1 }, T + 70_000)
  assert.deepEqual([d.on, d.reasons, d.until], [true, ['working'], null])
  d = decide(d, IDLE, T + 80_000)
  assert.equal(d.until, T + 80_000 + GRACE)
  // the grace over
  d = decide(d, IDLE, T + 80_000 + GRACE)
  assert.deepEqual(d, { on: false, reasons: [], working: 0, until: null, again: null })
})

test('turned off: work keeps nothing awake, and turning it off mid-task lets go at once, with no grace', () => {
  assert.equal(decide({}, { ...IDLE, working: 3, enabled: false }, T).on, false)
  const held = decide({}, { ...IDLE, working: 1 }, T)
  assert.deepEqual(decide(held, { ...IDLE, working: 1, enabled: false }, T + 1000), { on: false, reasons: [], working: 0, until: null, again: null })
  // and in the middle of a grace
  const grace = decide(held, IDLE, T + 1000)
  assert.equal(decide(grace, { ...IDLE, enabled: false }, T + 2000).on, false)
  // turned on again with nobody working: no grace left over
  assert.equal(decide(decide(grace, { ...IDLE, enabled: false }, T + 2000), IDLE, T + 3000).on, false)
})

test('sharing, a linked computer and a phone keep it awake as before, whatever the setting says', () => {
  for (const [key, reason] of [['sharing', 'sharing'], ['linked', 'linked'], ['phones', 'phone']]) {
    for (const enabled of [true, false]) {
      const d = decide({}, { ...IDLE, enabled, [key]: true }, T)
      assert.deepEqual([d.on, d.reasons, d.again], [true, [reason], null], `${key}, setting ${enabled}`)
    }
  }
  // with work as well: both reasons, and the phone still holds it once the work and its grace are over
  let d = decide({}, { ...IDLE, working: 1, phones: true }, T)
  assert.deepEqual(d.reasons, ['working', 'phone'])
  d = decide(d, { ...IDLE, phones: true }, T + 1000)
  assert.deepEqual(d.reasons, ['finishing', 'phone'])
  d = decide(d, { ...IDLE, phones: true }, T + 1000 + GRACE)
  assert.deepEqual([d.on, d.reasons, d.again], [true, ['phone'], null])
  assert.equal(decide(d, IDLE, T + 2000 + GRACE).on, false)
})

test('quitting lets go, whatever is going on', () => {
  const d = decide({}, { ...IDLE, working: 2, sharing: true, phones: true }, T)
  assert.deepEqual(decide(d, { ...IDLE, working: 2, sharing: true, phones: true, quitting: true }, T + 1), { on: false, reasons: [], working: 0, until: null, again: null })
})

// ---- the one blocker ------------------------------------------------------------------------------------------------

test('one blocker for every reason: taken once, kept through the grace, let go once, and again on quitting', async () => {
  const calls = []
  const told = []
  let input = { ...IDLE }
  let n = 0
  const k = keeper({ start: () => (calls.push('start'), ++n), stop: (id) => calls.push(`stop ${id}`), now: () => input, told: (d) => told.push(d.reasons.join()), grace: 40 })
  k.check()
  assert.deepEqual([calls, k.held], [[], false])
  input = { ...IDLE, working: 1 }
  k.check()
  k.check() // every change of state asks
  input = { ...IDLE, working: 2, phones: true }
  k.check()
  assert.deepEqual([calls, k.held], [['start'], true], 'held once, for both reasons')
  input = { ...IDLE, phones: true }
  k.check()
  await new Promise((r) => setTimeout(r, 80))
  assert.deepEqual([calls, k.held, k.decision.reasons], [['start'], true, ['phone']], 'the phone still holds it after the grace')
  assert.deepEqual(told, ['phone'], 'the grace running out is told to the windows')
  input = { ...IDLE, working: 1 }
  k.check()
  input = { ...IDLE }
  k.check()
  assert.equal(k.held, true, 'within the grace')
  await new Promise((r) => setTimeout(r, 80))
  assert.deepEqual([calls, k.held], [['start', 'stop 1'], false], 'let go by itself once the grace is over')
  assert.deepEqual(told, ['phone', ''])
  input = { ...IDLE, working: 1, sharing: true }
  k.check()
  input = { ...input, quitting: true }
  k.check()
  assert.deepEqual([calls, k.held, k.decision.again], [['start', 'stop 1', 'start', 'stop 2'], false, null], 'quitting lets go and leaves no timer')
})

test('before there is anything to ask (CLIque still starting), nothing is held', () => {
  const k = keeper({ start: () => assert.fail('held'), stop() {}, now: () => null })
  assert.deepEqual(k.check(), {})
})

// ---- what it says -----------------------------------------------------------------------------------------------------

test('the line says in plain words that the computer is kept awake and why', () => {
  const line = (reasons, working, opts) => awakeLine({ on: reasons.length > 0, reasons, working }, opts)
  assert.equal(line([], 0), '')
  assert.equal(line(['working'], 1), 'Keeping this Mac awake while an agent works')
  assert.equal(line(['working'], 3, { pc: 'PC' }), 'Keeping this PC awake while 3 agents work')
  assert.equal(line(['working'], 2, { battery: true }), 'Keeping this Mac awake on battery while 2 agents work')
  assert.equal(line(['finishing'], 0), "Nobody's working now, so this Mac can sleep in a moment")
  assert.equal(line(['finishing', 'phone'], 0), 'Keeping this Mac awake while your phone is connected')
  assert.equal(line(['sharing'], 0), 'Keeping this Mac awake while it shares its agents')
  assert.equal(line(['working', 'sharing', 'linked', 'phone'], 2), 'Keeping this Mac awake while 2 agents work, it shares its agents, a linked computer is connected and your phone is connected')
  assert.deepEqual(awakeState(decide({}, { ...IDLE, working: 1 }, T), { enabled: true, pc: 'PC' }), { on: true, reasons: ['working'], enabled: true, line: 'Keeping this PC awake while an agent works' })
})

// ---- who counts as working ----------------------------------------------------------------------------------------------

test('working means working: not waiting for you, resting, starting, free, off, or in a workspace that is asleep', () => {
  const hub = (statuses, extra = {}) => ({ ws: 'w', agents: new Map(Object.entries(statuses).map(([name, s]) => [name, typeof s === 'string' ? { name, status: s } : { name, ...s }])), ...extra })
  assert.equal(workingHere([hub({ ada: 'waiting', june: 'resting', milo: 'idle', iris: 'starting', theo: 'off', uma: 'stopped' })]), 0)
  assert.equal(workingHere([hub({ ada: 'working', june: 'waiting' })]), 1)
  // a clone counts with its agent; an agent that waits while its clone works is still at work
  assert.equal(workingHere([hub({ theo: 'waiting', 'theo.2': { status: 'working', cloneOf: 'theo' }, 'theo.3': { status: 'working', cloneOf: 'theo' } })]), 1)
  // every workspace counts, the same name in two of them twice; a workspace that's asleep doesn't
  assert.equal(workingHere([hub({ ada: 'working' }), { ...hub({ ada: 'working' }), ws: 'docs' }, hub({ june: 'working' }, { ws: 'old', parked: true })]), 2)
})

// ---- through the real Clique: a task from start to finish ------------------------------------------------------------------

let clique
after(() => {
  for (const hub of clique?.hubs.values() ?? []) {
    clearInterval(hub.stallTimer)
    for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'reapTimer']) clearTimeout(a[t])
    for (const t of ['statsTimer', 'convoTimer', 'lookTimer']) clearTimeout(hub[t])
  }
  clearTimeout(clique?.changeTimer)
  fs.unwatchFile(CONFIG)
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(FOLDER, { recursive: true, force: true, maxRetries: 10 })
})

test('Clique reports an agent at work from its first step to its last word, and not while it waits for you', async () => {
  clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
  const live = new Set()
  Object.assign(clique.runner, { running: (n) => live.has(n), start: (n) => live.add(n), stop: (n) => live.delete(n), submit() {}, write() {}, pid() {}, quietFor: () => Infinity })
  const hub = clique.hubs.get('default')
  hub.start('http://127.0.0.1:1')
  const status = () => hub.agents.get('ada').status
  assert.deepEqual(clique.awakeNow(), { working: 0, enabled: true, sharing: false, linked: false, phones: false }, 'everyone rests')

  await clique.send('ada', 'fix the button')
  assert.equal(status(), 'starting')
  hub.onHook('ada', { hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' })
  hub.agents.get('ada').holdUntil = 0
  hub.pump(hub.agents.get('ada'))
  hub.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: 'fix the button', session_id: 's1' })
  assert.equal(status(), 'working')
  assert.equal(clique.awakeNow().working, 1)

  // it asks you something: the computer may sleep until you answer
  hub.onHook('ada', { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', session_id: 's1' })
  assert.equal(status(), 'waiting')
  assert.equal(clique.awakeNow().working, 0)

  // answered in its terminal: at work again
  hub.input('ada', '\r')
  assert.equal(status(), 'working')
  assert.equal(clique.awakeNow().working, 1)

  hub.onHook('ada', { hook_event_name: 'Stop', last_assistant_message: 'Fixed.', session_id: 's1' })
  assert.notEqual(status(), 'working')
  assert.equal(clique.awakeNow().working, 0)
})

test('the setting is on until config.json says "keepAwake": false, and turning it on again takes that out', () => {
  assert.equal(clique.awakeNow().enabled, true)
  assert.equal(clique.setKeepAwake(false), false)
  assert.equal(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).keepAwake, false)
  assert.equal(clique.awakeNow().enabled, false)
  assert.equal(clique.setKeepAwake(true), true)
  assert.equal('keepAwake' in JSON.parse(fs.readFileSync(CONFIG, 'utf8')), false)
  assert.equal(clique.awakeNow().enabled, true)
})

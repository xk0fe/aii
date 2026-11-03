// Routing and delivery, against a fake runner in a throwaway CREW_HOME: no terminals, no real agents,
// nothing reaches a running crew app. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-test-'))
const { Hub, addressees, CONFIG } = await import('../core/hub.js')

const CREW = [
  { name: 'june', area: 'Senior Backend SWE' },
  { name: 'ada', area: 'client programmer' },
  { name: 'iris', area: 'ui/ux designer' },
  { name: 'abe', area: 'admin work, assistant, organiser' },
  { name: 'jay', area: 'customer support, good to talk to about anything else' },
  { name: 'uma', area: 'analytics', off: true },
]

class FakeRunner extends EventEmitter {
  submitted = []
  running = (name) => this.on_.has(name)
  on_ = new Set()
  submit = (name, text) => this.submitted.push({ name, text })
  write() {}
  stop() {}
  start() {}
}

let hub, runner
beforeEach(() => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CREW }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  // everyone that's on is running and busy, so messages queue instead of being typed in
  for (const a of hub.agents.values()) {
    if (a.off) continue
    runner.on_.add(a.name)
    a.status = 'working'
  }
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
  clearTimeout(hub.statsTimer)
})

const inbox = (name) => hub.agents.get(name).inbox
const queued = () => Object.fromEntries([...hub.agents.values()].filter((a) => a.inbox.length).map((a) => [a.name, a.inbox.length]))
const sent = () => hub.feed.filter((m) => m.kind === 'msg')

// ---- single recipient: unchanged behaviour ----

test('a leading @name sends to that agent, text as written', () => {
  assert.match(hub.send({ text: '@ada fix the button' }), /queued for @ada/)
  assert.deepEqual(queued(), { ada: 1 })
  assert.equal(inbox('ada')[0].text, '@ada fix the button')
  assert.equal(inbox('ada')[0].cc, undefined)
})

test('`to` picks the agent, as the CLI and composer chip do', () => {
  hub.send({ from: 'june', to: 'ada', text: 'contract is in the board' })
  assert.deepEqual(queued(), { ada: 1 })
})

test('naming nobody lets Auto pick, and the message says Auto picked, not you', () => {
  hub.send({ text: 'ui/ux designer needed for the login screen' })
  const [m] = sent()
  assert.equal(m.to, 'iris')
  assert.equal(m.auto, true)
  hub.send({ to: 'iris', text: 'and the colours' })
  hub.send({ text: '@iris and the spacing' })
  assert.deepEqual(sent().slice(1).map((x) => x.auto), [undefined, undefined])
})

test('an idle agent gets the message typed in straight away, tagged with the sender and whose it is now', () => {
  const ada = hub.agents.get('ada')
  ada.status = 'idle'
  assert.equal(hub.send({ from: 'june', to: 'ada', text: 'ping' }), 'sent to @ada\n')
  assert.deepEqual(runner.submitted, [{ name: 'ada', text: "[from @june: it's yours now, no need to report back] ping" }])
})

test('unknown, off and self recipients are rejected as before', () => {
  assert.throws(() => hub.send({ to: 'nobody', text: 'hi' }), /no agent named "nobody"/)
  assert.throws(() => hub.send({ to: 'uma', text: 'hi' }), /@uma is turned off, turn it on first$/)
  assert.throws(() => hub.send({ from: 'june', to: 'june', text: 'hi' }), /that's you/)
  assert.deepEqual(sent(), [])
})

test('hand-offs wait for approval when autopilot is off, and approve still delivers', () => {
  hub.config.autopilot = false
  assert.match(hub.send({ from: 'june', to: 'ada', text: 'x' }), /waiting for the user to approve this hand-off to @ada/)
  assert.deepEqual(queued(), {})
  hub.approve(sent()[0].id)
  assert.deepEqual(queued(), { ada: 1 })
})

test('attachments outside the attachments folder are dropped; an image alone gets default text', () => {
  hub.send({ to: 'iris', text: '', images: ['/etc/passwd', path.join(process.env.CREW_HOME, 'attachments', 'a.png')] })
  assert.equal(inbox('iris')[0].text, 'Have a look at this image.')
  assert.equal(inbox('iris')[0].images.length, 1)
})

// ---- several recipients ----

test('every @name gets the message once, case-insensitive, with who else got it', () => {
  const out = hub.send({ text: '@ada @june, @ADA wire up the new endpoint' })
  assert.deepEqual(queued(), { ada: 1, june: 1 })
  assert.equal(out.match(/queued for/g).length, 2)
  for (const name of ['ada', 'june']) {
    assert.equal(inbox(name)[0].text, '@ada @june, @ADA wire up the new endpoint')
    assert.deepEqual(inbox(name)[0].cc, ['ada', 'june'])
  }
})

test('a teammate mentioned later in the message is a recipient too, and the text stays whole', () => {
  hub.send({ text: '@ada build the screen, check the payload shape with @june first' })
  assert.deepEqual(queued(), { ada: 1, june: 1 })
  assert.equal(inbox('june')[0].text, '@ada build the screen, check the payload shape with @june first')
})

test('the chip recipient and mentions are combined without duplicates', () => {
  hub.send({ to: 'ada', text: 'sync with @iris and @ada on the composer' })
  assert.deepEqual(queued(), { ada: 1, iris: 1 })
  hub.send({ to: 'ada', text: '@june @ada fix X' })
  assert.deepEqual(queued(), { ada: 2, iris: 1, june: 1 })
})

test('copies of one send sit next to each other in the feed with the same cc (the feed merges them)', () => {
  hub.send({ text: 'before' , to: 'iris' })
  for (const a of hub.agents.values()) a.status = 'idle' // delivering must not post between the copies
  hub.send({ text: '@ada @june @abe playtest triage' })
  hub.send({ text: 'after', to: 'iris' })
  const feed = sent()
  const copies = feed.slice(1, 4)
  assert.deepEqual(copies.map((m) => m.to), ['ada', 'june', 'abe'])
  for (const m of copies) assert.deepEqual(m.cc, ['ada', 'june', 'abe'])
  assert.ok(Math.max(...copies.map((m) => m.ts)) - Math.min(...copies.map((m) => m.ts)) < 5000) // feed merge window
  assert.equal(feed[4].text, 'after')
})

test('copies of one send share a sendId; separate sends and single sends do not', () => {
  hub.send({ text: '@ada @june same words' })
  hub.send({ text: '@ada @june same words' })
  hub.send({ to: 'iris', text: 'solo' })
  const [a, b, c, d, solo] = sent()
  assert.ok(a.sendId)
  assert.equal(a.sendId, b.sendId)
  assert.equal(c.sendId, d.sendId)
  assert.notEqual(a.sendId, c.sendId)
  assert.notEqual(a.id, b.id)
  assert.equal(solo.sendId, undefined)
  assert.equal(solo.cc, undefined)
})

test('held hand-offs in one send share a sendId but are approved and dropped one by one', () => {
  hub.config.autopilot = false
  hub.send({ from: 'abe', text: '@ada @june go' })
  const [toAda, toJune] = sent()
  assert.equal(toAda.sendId, toJune.sendId)
  hub.approve(toAda.id)
  assert.deepEqual(queued(), { ada: 1 })
  assert.equal(toJune.held, true)
  hub.drop(toJune.id)
  assert.equal(toJune.dropped, true)
  assert.deepEqual(queued(), { ada: 1 })
})

test('`to` accepts several names', () => {
  hub.send({ from: 'abe', to: 'ada,june', text: 'playtest bugs' })
  assert.deepEqual(queued(), { ada: 1, june: 1 })
})

test('each recipient is told who else has it and who leads: the first named owns the result, the rest their part', () => {
  for (const a of hub.agents.values()) a.status = 'idle'
  hub.send({ from: 'abe', text: '@ada @june fix checkout' })
  assert.deepEqual(runner.submitted.map((s) => s.text), [
    "[from @abe: it's yours now, no need to report back, also sent to @june: you lead this and own the result, and they each take the part in their own area] @ada @june fix checkout",
    "[from @abe: it's yours now, no need to report back, also sent to @ada, and @ada leads it: take only the part in your own area] @ada @june fix checkout",
  ])
})

test('one unknown name, anywhere in the text, rejects the whole send: no partial delivery', () => {
  assert.throws(() => hub.send({ text: '@ada @nobody @ghost do it' }), /no agent named "nobody", "ghost" \(try: crew who\) \(nothing was sent\)/)
  assert.throws(() => hub.send({ to: 'ada', text: 'fix it, then tell @rex' }), /no agent named "rex"/)
  assert.deepEqual(queued(), {})
  assert.deepEqual(sent(), [])
})

test('one recipient that is off rejects the whole send', () => {
  assert.throws(() => hub.send({ text: '@ada @uma look at funnels' }), /@uma is turned off, turn it on first \(nothing was sent\)/)
  assert.throws(() => hub.send({ text: '@ada please ask @uma' }), /@uma is turned off/)
  assert.deepEqual(sent(), [])
})

test('naming yourself among the recipients rejects the whole send', () => {
  assert.throws(() => hub.send({ from: 'june', text: '@june @ada heads up' }), /@june is you, leave yourself off \(nothing was sent\)/)
  assert.throws(() => hub.send({ from: 'june', to: 'ada', text: 'ping @june when done' }), /@june is you/)
  assert.deepEqual(sent(), [])
})

test('autopilot off holds one hand-off per recipient', () => {
  hub.config.autopilot = false
  assert.match(hub.send({ from: 'abe', text: '@ada @june go' }), /approve this hand-off to @ada @june/)
  assert.equal(sent().filter((m) => m.held).length, 2)
  assert.deepEqual(queued(), {})
})

// ---- what counts as addressing ----

test('emails, package paths, possessives and code are not addresses', () => {
  hub.send({ to: 'june', text: "bump @types/node, mail ops@example.com, see @ada's PR and `@iris`, ```\n@abe\n```" })
  assert.deepEqual(queued(), { june: 1 })
  assert.deepEqual(addressees(undefined, '(@ada), @June. @any @you @crew'), ['ada', 'june'])
  assert.deepEqual(addressees('any', 'no one named'), [])
  assert.deepEqual(addressees('ada, june', ''), ['ada', 'june'])
})

test('`to: any` with no @names still routes', () => {
  hub.send({ from: 'june', to: 'any', text: 'client programmer needed for the leaderboard button' })
  assert.deepEqual(queued(), { ada: 1 })
})

// ---- routing by intent ----

const routed = (text, from = 'you') => hub.route(text, from)?.name

test('organising and coordinating requests go to the organiser', () => {
  for (const text of [
    'organise the agents for the playtest',
    'can someone orchestrate multiple agents on these bugs',
    'delegate these tickets',
    'coordinate the crew and keep it in working order',
    'triage the bug reports and assign them',
    'who should take the leaderboard bug?',
  ])
    assert.equal(routed(text), 'abe', text)
})

test('routing still matches plain area words and skips off agents', () => {
  assert.equal(routed('the client programmer should fix the scene'), 'ada')
  assert.equal(routed('backend endpoint is slow'), 'june')
  assert.equal(routed('analytics funnel looks wrong') === 'uma', false)
})

test('with no match, routing prefers whoever is free', () => {
  hub.agents.get('iris').status = 'idle'
  assert.equal(routed('zzz unrelated words'), 'iris')
})

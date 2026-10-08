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
  { name: 'joseph', area: 'Senior Backend SWE' },
  { name: 'david', area: 'client programmer' },
  { name: 'gal', area: 'ui/ux designer' },
  { name: 'arie', area: 'admin work, assistant, organiser' },
  { name: 'jeff', area: 'technical support, professional yapper, good to talk to about anything else' },
  { name: 'ye', area: 'analytics', off: true },
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
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
  clearTimeout(hub.statsTimer)
})

const inbox = (name) => hub.agents.get(name).inbox
const queued = () => Object.fromEntries([...hub.agents.values()].filter((a) => a.inbox.length).map((a) => [a.name, a.inbox.length]))
const sent = () => hub.feed.filter((m) => m.kind === 'msg')

// ---- single recipient: unchanged behaviour ----

test('a leading @name sends to that agent, text as written', () => {
  assert.match(hub.send({ text: '@david fix the button' }), /queued for @david/)
  assert.deepEqual(queued(), { david: 1 })
  assert.equal(inbox('david')[0].text, '@david fix the button')
  assert.equal(inbox('david')[0].cc, undefined)
})

test('`to` picks the agent, as the CLI and composer chip do', () => {
  hub.send({ from: 'joseph', to: 'david', text: 'contract is in the board' })
  assert.deepEqual(queued(), { david: 1 })
})

test('an idle agent gets the message typed in straight away, tagged with the sender and whose it is now', () => {
  const david = hub.agents.get('david')
  david.status = 'idle'
  assert.equal(hub.send({ from: 'joseph', to: 'david', text: 'ping' }), 'sent to @david\n')
  assert.deepEqual(runner.submitted, [{ name: 'david', text: "[from @joseph: it's yours now, no need to report back] ping" }])
})

test('unknown, off and self recipients are rejected as before', () => {
  assert.throws(() => hub.send({ to: 'nobody', text: 'hi' }), /no agent named "nobody"/)
  assert.throws(() => hub.send({ to: 'ye', text: 'hi' }), /@ye is turned off, turn it on first$/)
  assert.throws(() => hub.send({ from: 'joseph', to: 'joseph', text: 'hi' }), /that's you/)
  assert.deepEqual(sent(), [])
})

test('hand-offs wait for approval when autopilot is off, and approve still delivers', () => {
  hub.config.autopilot = false
  assert.match(hub.send({ from: 'joseph', to: 'david', text: 'x' }), /waiting for the user to approve this hand-off to @david/)
  assert.deepEqual(queued(), {})
  hub.approve(sent()[0].id)
  assert.deepEqual(queued(), { david: 1 })
})

test('attachments outside the attachments folder are dropped; an image alone gets default text', () => {
  hub.send({ to: 'gal', text: '', images: ['/etc/passwd', path.join(process.env.CREW_HOME, 'attachments', 'a.png')] })
  assert.equal(inbox('gal')[0].text, 'Have a look at this image.')
  assert.equal(inbox('gal')[0].images.length, 1)
})

// ---- several recipients ----

test('every @name gets the message once, case-insensitive, with who else got it', () => {
  const out = hub.send({ text: '@david @joseph, @DAVID wire up the new endpoint' })
  assert.deepEqual(queued(), { david: 1, joseph: 1 })
  assert.equal(out.match(/queued for/g).length, 2)
  for (const name of ['david', 'joseph']) {
    assert.equal(inbox(name)[0].text, '@david @joseph, @DAVID wire up the new endpoint')
    assert.deepEqual(inbox(name)[0].cc, ['david', 'joseph'])
  }
})

test('a teammate mentioned later in the message is a recipient too, and the text stays whole', () => {
  hub.send({ text: '@david build the screen, check the payload shape with @joseph first' })
  assert.deepEqual(queued(), { david: 1, joseph: 1 })
  assert.equal(inbox('joseph')[0].text, '@david build the screen, check the payload shape with @joseph first')
})

test('the chip recipient and mentions are combined without duplicates', () => {
  hub.send({ to: 'david', text: 'sync with @gal and @david on the composer' })
  assert.deepEqual(queued(), { david: 1, gal: 1 })
  hub.send({ to: 'david', text: '@joseph @david fix X' })
  assert.deepEqual(queued(), { david: 2, gal: 1, joseph: 1 })
})

test('copies of one send sit next to each other in the feed with the same cc (the feed merges them)', () => {
  hub.send({ text: 'before' , to: 'gal' })
  for (const a of hub.agents.values()) a.status = 'idle' // delivering must not post between the copies
  hub.send({ text: '@david @joseph @arie playtest triage' })
  hub.send({ text: 'after', to: 'gal' })
  const feed = sent()
  const copies = feed.slice(1, 4)
  assert.deepEqual(copies.map((m) => m.to), ['david', 'joseph', 'arie'])
  for (const m of copies) assert.deepEqual(m.cc, ['david', 'joseph', 'arie'])
  assert.ok(Math.max(...copies.map((m) => m.ts)) - Math.min(...copies.map((m) => m.ts)) < 5000) // feed merge window
  assert.equal(feed[4].text, 'after')
})

test('copies of one send share a sendId; separate sends and single sends do not', () => {
  hub.send({ text: '@david @joseph same words' })
  hub.send({ text: '@david @joseph same words' })
  hub.send({ to: 'gal', text: 'solo' })
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
  hub.send({ from: 'arie', text: '@david @joseph go' })
  const [toDavid, toJoseph] = sent()
  assert.equal(toDavid.sendId, toJoseph.sendId)
  hub.approve(toDavid.id)
  assert.deepEqual(queued(), { david: 1 })
  assert.equal(toJoseph.held, true)
  hub.drop(toJoseph.id)
  assert.equal(toJoseph.dropped, true)
  assert.deepEqual(queued(), { david: 1 })
})

test('`to` accepts several names', () => {
  hub.send({ from: 'arie', to: 'david,joseph', text: 'playtest bugs' })
  assert.deepEqual(queued(), { david: 1, joseph: 1 })
})

test('each recipient is told who else has it and who leads: the first named owns the result, the rest their part', () => {
  for (const a of hub.agents.values()) a.status = 'idle'
  hub.send({ from: 'arie', text: '@david @joseph fix ranked' })
  assert.deepEqual(runner.submitted.map((s) => s.text), [
    "[from @arie: it's yours now, no need to report back, also sent to @joseph: you lead this and own the result, and they each take the part in their own area] @david @joseph fix ranked",
    "[from @arie: it's yours now, no need to report back, also sent to @david, and @david leads it: take only the part in your own area] @david @joseph fix ranked",
  ])
})

test('one unknown name, anywhere in the text, rejects the whole send: no partial delivery', () => {
  assert.throws(() => hub.send({ text: '@david @nobody @ghost do it' }), /no agent named "nobody", "ghost" \(try: crew who\) \(nothing was sent\)/)
  assert.throws(() => hub.send({ to: 'david', text: 'fix it, then tell @marc' }), /no agent named "marc"/)
  assert.deepEqual(queued(), {})
  assert.deepEqual(sent(), [])
})

test('one recipient that is off rejects the whole send', () => {
  assert.throws(() => hub.send({ text: '@david @ye look at funnels' }), /@ye is turned off, turn it on first \(nothing was sent\)/)
  assert.throws(() => hub.send({ text: '@david please ask @ye' }), /@ye is turned off/)
  assert.deepEqual(sent(), [])
})

test('naming yourself among the recipients rejects the whole send', () => {
  assert.throws(() => hub.send({ from: 'joseph', text: '@joseph @david heads up' }), /@joseph is you, leave yourself off \(nothing was sent\)/)
  assert.throws(() => hub.send({ from: 'joseph', to: 'david', text: 'ping @joseph when done' }), /@joseph is you/)
  assert.deepEqual(sent(), [])
})

test('autopilot off holds one hand-off per recipient', () => {
  hub.config.autopilot = false
  assert.match(hub.send({ from: 'arie', text: '@david @joseph go' }), /approve this hand-off to @david @joseph/)
  assert.equal(sent().filter((m) => m.held).length, 2)
  assert.deepEqual(queued(), {})
})

// ---- what counts as addressing ----

test('emails, package paths, possessives and code are not addresses', () => {
  hub.send({ to: 'joseph', text: "bump @types/node, mail ops@example.com, see @david's PR and `@gal`, ```\n@arie\n```" })
  assert.deepEqual(queued(), { joseph: 1 })
  assert.deepEqual(addressees(undefined, '(@david), @Joseph. @any @you @crew'), ['david', 'joseph'])
  assert.deepEqual(addressees('any', 'no one named'), [])
  assert.deepEqual(addressees('david, joseph', ''), ['david', 'joseph'])
})

test('`to: any` with no @names still routes', () => {
  hub.send({ from: 'joseph', to: 'any', text: 'client programmer needed for the leaderboard button' })
  assert.deepEqual(queued(), { david: 1 })
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
    assert.equal(routed(text), 'arie', text)
})

test('routing still matches plain area words and skips off agents', () => {
  assert.equal(routed('the client programmer should fix the scene'), 'david')
  assert.equal(routed('backend endpoint is slow'), 'joseph')
  assert.equal(routed('analytics funnel looks wrong') === 'ye', false)
})

test('with no match, routing prefers whoever is free', () => {
  hub.agents.get('gal').status = 'idle'
  assert.equal(routed('zzz unrelated words'), 'gal')
})

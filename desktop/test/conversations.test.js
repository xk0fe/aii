// Your conversation with one agent: which feed entries ui/common.js's inConvo keeps, and what feedView shows with
// it, on entries made by the real Hub (fake runner, throwaway CREW_HOME). Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ crew: {}, avatarHTML: () => '', agentColor: () => '', CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { feedView, inConvo, familyOf, isConvo }', ctx)
const { feedView, inConvo, familyOf, isConvo } = ctx.__x

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-convo-'))
const { Hub, CONFIG } = await import(path.join(A, 'core/hub.js'))
const CREW = ['joseph', 'david', 'gal'].map((name) => ({ name, area: name })).concat({ name: 'marc', area: 'art', clones: 2 })
class FakeRunner extends EventEmitter { on_ = new Set(); running = (n) => this.on_.has(n); submit() {}; write() {}; stop() {}; start(n) { this.on_.add(n) } }
let hub
beforeEach(() => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CREW }))
  const r = new FakeRunner()
  hub = new Hub(r, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (r.on_.add(a.name), (a.status = 'idle'))
  hub.feed.length = 0
})
afterEach(() => { for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.linger); clearTimeout(hub.statsTimer); clearTimeout(hub.convoTimer) })
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

const agents = () => [...hub.agents.values()].map((a) => ({ name: a.name, cloneOf: a.cloneOf, clone: a.clone }))
// (the vm's arrays come from another realm, so copy them into this one for deepEqual)
const shown = (name) => [...feedView(hub.feed, agents(), new Set(), 200, new Map(), { only: (e) => inConvo(e, name), here: name }).items]
const texts = (name) => shown(name).map((e) => e.text ?? e.act)

test('only "auto" and "task" are everyone\'s chat', () => {
  assert.equal(isConvo('auto'), false)
  assert.equal(isConvo('task'), false)
  assert.equal(isConvo(null), false)
  assert.equal(isConvo('joseph'), true)
  assert.equal(familyOf('marc.2'), 'marc')
  assert.equal(familyOf('marc.2@air'), 'marc@air')
  assert.equal(familyOf('gal@mac-mini'), 'gal@mac-mini')
})

test('what you and it say, and its hand-offs either way; not the rest of the crew', () => {
  hub.send({ to: 'joseph', text: 'fix the payload' })
  hub.send({ to: 'david', text: 'polish the menu' })
  hub.send({ from: 'joseph', to: 'gal', text: 'check the quote styling' })
  hub.send({ from: 'david', to: 'joseph', text: 'API shape?' })
  hub.post({ kind: 'reply', from: 'joseph', to: 'you', text: 'done' })
  hub.post({ kind: 'reply', from: 'david', to: 'you', text: 'menu done' })
  hub.post({ kind: 'ask', from: 'joseph', to: 'you', ask: { type: 'permission', title: 'Run a command' } })
  hub.post({ kind: 'note', from: 'gal', text: '@joseph cuts the release tomorrow' })
  hub.post({ kind: 'event', from: 'joseph', text: 'started a new conversation', fresh: true })
  hub.post({ kind: 'event', from: 'crew', text: 'config.json: oops' })
  assert.deepEqual(texts('joseph'), ['fix the payload', 'check the quote styling', 'API shape?', 'done', undefined, 'started a new conversation'])
  assert.deepEqual(texts('david'), ['polish the menu', 'API shape?', 'menu done'])
  assert.deepEqual(texts('gal'), ['check the quote styling', '@joseph cuts the release tomorrow'])
})

test('one send to several shows once in each of their conversations, addressed to all of them', () => {
  hub.send({ to: 'joseph,david', text: 'sync on the composer' })
  for (const name of ['joseph', 'david']) {
    const items = shown(name)
    assert.equal(items.length, 1, name)
    assert.deepEqual([...items[0].cc], ['joseph', 'david'])
  }
  assert.equal(shown('gal').length, 0)
})

test('a message a clone took stays in its agent\'s conversation', () => {
  hub.agents.get('marc').status = 'working' // busy: the next one goes to a clone
  const said = hub.send({ to: 'marc', text: 'an empty-state illustration' })
  assert.match(said, /marc\.2/)
  hub.post({ kind: 'reply', from: 'marc.2', to: 'you', text: 'here it is' })
  assert.deepEqual(texts('marc'), ['an empty-state illustration', 'here it is'])
  assert.equal(shown('marc')[0].to, 'marc.2')
})

test('its tasks: what it did, and what went to it', () => {
  hub.post({ kind: 'task', type: 'bug', act: 'filed', from: 'you', ticket: 7, title: 'Coins reset' })
  hub.post({ kind: 'task', type: 'bug', act: 'triaged', from: 'gal', ticket: 7, title: 'Coins reset', text: 'joseph' })
  hub.post({ kind: 'task', type: 'bug', act: 'fixing', from: 'crew', ticket: 7, title: 'Coins reset', text: 'joseph' })
  hub.post({ kind: 'task', type: 'bug', act: 'fixed', from: 'joseph', ticket: 7, title: 'Coins reset', text: 'debounced it' })
  hub.post({ kind: 'task', type: 'bug', act: 'fixed', from: 'david', ticket: 5, title: 'Double jump', text: 'fixed' })
  assert.deepEqual(shown('joseph').map((e) => `${e.act} #${e.ticket}`), ['triaged #7', 'fixing #7', 'fixed #7'])
  assert.deepEqual(shown('gal').map((e) => `${e.act} #${e.ticket}`), ['triaged #7'])
})

test('a reply quoting a message outside the conversation still shows its quote', () => {
  const q = hub.post({ kind: 'reply', from: 'david', to: 'you', text: 'the menu needs a back button' })
  hub.send({ to: 'joseph', text: 'can you add the route for this?', re: q.id })
  const view = feedView(hub.feed, agents(), new Set(), 200, new Map(), { only: (e) => inConvo(e, 'joseph'), here: 'joseph' })
  assert.equal(view.items.length, 1)
  assert.match(view.html(), /class="quote" data-jump="[^"]+"/)
  assert.match(view.html(), /the menu needs a back button/)
})

test('in its own conversation the agent\'s name is not a link', () => {
  hub.send({ from: 'joseph', to: 'gal', text: 'check this' })
  const html = feedView(hub.feed, agents(), new Set(), 200, new Map(), { only: (e) => inConvo(e, 'joseph'), here: 'joseph' }).html()
  assert.match(html, /class="who here" data-agent="joseph"/)
  assert.match(html, /class="who" data-agent="gal"/)
})

test('a task you add for an agent shows in your conversation with it', () => {
  hub.fileTask({ text: 'rate-limit the login endpoint', owner: 'joseph' })
  hub.fileTask({ text: 'no owner yet', kind: 'bug' })
  assert.deepEqual(shown('joseph').map((e) => `${e.act} ${e.title}`), ['filed rate-limit the login endpoint'])
  assert.equal(shown('gal').length, 0)
})

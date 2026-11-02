// Multi-recipient sends from the real Hub, rendered through ui/common.js's feedView: the copies of one send
// (same sendId) show once, addressed to everyone. Fake runner, throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ crew: {}, avatarHTML: () => '', agentColor: () => '', CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { feedView }', ctx)
const { feedView } = ctx.__x

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-feed-'))
const { Hub, CONFIG } = await import(path.join(A, 'core/hub.js'))
const CREW = ['joseph', 'david', 'gal', 'arie'].map((name) => ({ name, area: name }))
class FakeRunner extends EventEmitter { on_ = new Set(); running = (n) => this.on_.has(n); submit() {}; write() {}; stop() {}; start() {} }
let hub
beforeEach(() => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: false, agents: CREW }))
  const r = new FakeRunner()
  hub = new Hub(r, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (r.on_.add(a.name), (a.status = 'working'))
  hub.feed.length = 0
})
afterEach(() => { for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer); clearTimeout(hub.statsTimer) })
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

const msgs = () => hub.feed.filter((m) => m.kind === 'msg')
const render = (feed, { open = new Set(), limit = 200 } = {}) => {
  const view = feedView(feed, [], open, limit)
  return { shown: view.items, html: view.items.length ? view.html() : '' }
}
// Arrays built inside the vm context fail a strict deepEqual against this realm's, so copy them out.
const host = (x) => JSON.parse(JSON.stringify(x))
const bubbles = (html) => (html.match(/class="bubble/g) || []).length
const reply = (re, id = 'r-' + re) => ({ id, kind: 'reply', from: 'joseph', text: 'done', re, ts: Date.now() })
const image = (n) => hub.saveImage(`${n}.png`, 'image/png', new Uint8Array([n]))

test('one send to three agents is one bubble, at its first copy, addressed to all three', () => {
  hub.send({ to: 'david', text: '@joseph @gal ship the composer' })
  const copies = msgs()
  assert.equal(copies.length, 3)
  const { shown, html } = render(hub.feed)
  assert.equal(shown.length, 1)
  assert.equal(shown[0].id, copies[0].id)
  assert.equal(bubbles(html), 1)
  assert.match(html, new RegExp(`id="m-${copies[0].id}"[^]*data-id="${copies[0].id}"`))
  assert.match(html, /to <span[^>]*>@david<\/span> <span[^>]*>@joseph<\/span> <span[^>]*>@gal<\/span>/)
  assert.match(html, /queued/)
})

test('a single-recipient send is untouched', () => {
  hub.send({ to: 'gal', text: 'frames please' })
  const { shown, html } = render(hub.feed)
  assert.equal(shown[0], hub.feed[0])
  assert.match(html, /to <span[^>]*>@gal<\/span><span class="tag">/)
})

test('a repeat of the same text to the same people is a second bubble', () => {
  hub.send({ to: 'david', text: '@joseph ping' })
  hub.send({ to: 'david', text: '@joseph ping' })
  assert.equal(bubbles(render(hub.feed).html), 2)
})

test('sends that differ only in attachments stay separate, and each keeps its own images', () => {
  const [one, two] = [image(1), image(2)]
  hub.send({ to: 'david', text: '@joseph look', images: [one] })
  hub.send({ to: 'david', text: '@joseph look', images: [two] })
  const [, a2, b1] = msgs()
  const { shown, html } = render(hub.feed.slice(1)) // starting mid-send is where text+time matching folded them together
  assert.deepEqual(host(shown.map((e) => e.id)), [a2.id, b1.id])
  assert.deepEqual(host(shown.map((e) => e.images)), [[one], [two]])
  assert.equal((html.match(/<img /g) || []).length, 2)
})

test('a feed that starts mid-send still shows it once, and never folds it into the next identical send', () => {
  hub.send({ to: 'david', text: '@joseph @gal same' })
  hub.send({ to: 'david', text: '@joseph @gal same' })
  const [a1, a2, a3, b1] = msgs()
  const feed = [...hub.feed.slice(1), reply(a3.id), reply(b1.id)] // retention cut off a1
  const { shown, html } = render(feed)
  assert.deepEqual(host(shown.filter((e) => e.kind === 'msg').map((e) => e.id)), [a2.id, b1.id])
  assert.match(html, /to <span[^>]*>@david<\/span> <span[^>]*>@joseph<\/span> <span[^>]*>@gal<\/span>/)
  assert.match(html, new RegExp(`class="quote" data-jump="${a2.id}"[^]*class="quote" data-jump="${b1.id}"`))
  assert.match(html, new RegExp(`id="m-${a2.id}"[^]*data-jump="r-${a3.id}"[^]*id="m-${b1.id}"[^]*data-jump="r-${b1.id}"`))
})

test('copies that are not next to each other still merge by sendId', () => {
  hub.send({ to: 'david', text: '@joseph @gal split' })
  const [a1, a2, a3] = msgs()
  const between = { id: 'ev', kind: 'event', from: 'gal', text: 'is free', ts: Date.now() }
  const { shown } = render([a1, between, a2, a3])
  assert.deepEqual(host(shown.map((e) => e.id)), [a1.id, 'ev'])
})

test('reply jumps work both ways through the one shown bubble', () => {
  hub.send({ to: 'david', text: '@joseph sync' })
  const [lead, copy] = msgs()
  const { html } = render([...hub.feed, reply(copy.id, 'r1')])
  assert.match(html, new RegExp(`id="m-${lead.id}"[^]*class="replied" data-jump="r1"`))
  assert.match(html, new RegExp(`class="quote" data-jump="${lead.id}"`))
  assert.doesNotMatch(html, new RegExp(`id="m-${copy.id}"`))
})

test('Show more state follows the shown bubble', () => {
  hub.send({ to: 'david', text: '@joseph long one' })
  const [lead] = msgs()
  assert.match(render(hub.feed, { open: new Set([lead.id]) }).html, new RegExp(`class="bubble open" data-id="${lead.id}"`))
})

test('the feed limit counts merged bubbles, not copies', () => {
  hub.send({ to: 'gal', text: 'first' })
  hub.send({ to: 'david', text: '@joseph @gal @arie last' })
  assert.deepEqual(host(render(hub.feed, { limit: 2 }).shown.map((e) => e.text)), ['first', '@joseph @gal @arie last'])
})

test('agent hand-offs to several teammates stay separate, each with its own approve', () => {
  hub.send({ from: 'arie', to: 'david,joseph', text: 'playtest bugs' })
  const { shown, html } = render(hub.feed)
  assert.equal(shown.length, 2)
  assert.equal((html.match(/data-act="approve"/g) || []).length, 2)
})

test('older entries with cc but no sendId are never merged', () => {
  const t = Date.now()
  const legacy = ['david', 'joseph'].map((to, i) => ({ id: 'l' + i, kind: 'msg', from: 'you', to, cc: ['david', 'joseph'], text: 'x', ts: t }))
  assert.equal(render(legacy).shown.length, 2)
})

// Multi-recipient sends from the real Hub, rendered through ui/common.js's feedView: the copies of one send
// (same sendId) show once, addressed to everyone. Fake runner, throwaway CLIQUE_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ clique: {}, avatarHTML: () => '', agentColor: () => '', CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { feedView, inThread, isUnread }', ctx)
const { feedView, inThread, isUnread } = ctx.__x

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-feed-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const CLIQUE = ['june', 'ada', 'iris', 'abe'].map((name) => ({ name, area: name }))
class FakeRunner extends EventEmitter { on_ = new Set(); running = (n) => this.on_.has(n); submit() {}; write() {}; stop() {}; start() {} }
let hub
beforeEach(() => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: false, agents: CLIQUE }))
  const r = new FakeRunner()
  hub = new Hub(r, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (r.on_.add(a.name), (a.status = 'working'))
  hub.feed.length = 0
})
afterEach(() => { for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer); clearTimeout(hub.statsTimer) })
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

const msgs = () => hub.feed.filter((m) => m.kind === 'msg')
const render = (feed, { open = new Set(), limit = 200 } = {}) => {
  const view = feedView(feed, [], open, limit)
  return { shown: view.items, html: view.items.length ? view.html() : '' }
}
// Arrays built inside the vm context fail a strict deepEqual against this realm's, so copy them out.
const host = (x) => JSON.parse(JSON.stringify(x))
const bubbles = (html) => (html.match(/class="bubble/g) || []).length
const reply = (re, id = 'r-' + re) => ({ id, kind: 'reply', from: 'june', text: 'done', re, ts: Date.now() })
const image = (n) => hub.saveImage(`${n}.png`, 'image/png', new Uint8Array([n]))

test('one send to three agents is one bubble, at its first copy, addressed to all three', () => {
  hub.send({ to: 'ada', text: '@june @iris ship the composer' })
  const copies = msgs()
  assert.equal(copies.length, 3)
  const { shown, html } = render(hub.feed)
  assert.equal(shown.length, 1)
  assert.equal(shown[0].id, copies[0].id)
  assert.equal(bubbles(html), 1)
  assert.match(html, new RegExp(`id="m-${copies[0].id}"[^]*data-id="${copies[0].id}"`))
  assert.match(html, /to <span[^>]*>@ada<\/span> <span[^>]*>@june<\/span> <span[^>]*>@iris<\/span>/)
  assert.match(html, /queued/)
})

test('a single-recipient send is untouched', () => {
  hub.send({ to: 'iris', text: 'frames please' })
  const { shown, html } = render(hub.feed)
  assert.equal(shown[0], hub.feed[0])
  assert.match(html, /to <span[^>]*>@iris<\/span><span class="tag">/)
})

test('a repeat of the same text to the same people is a second bubble', () => {
  hub.send({ to: 'ada', text: '@june ping' })
  hub.send({ to: 'ada', text: '@june ping' })
  assert.equal(bubbles(render(hub.feed).html), 2)
})

test('sends that differ only in attachments stay separate, and each keeps its own images', () => {
  const [one, two] = [image(1), image(2)]
  hub.send({ to: 'ada', text: '@june look', images: [one] })
  hub.send({ to: 'ada', text: '@june look', images: [two] })
  const [, a2, b1] = msgs()
  const { shown, html } = render(hub.feed.slice(1)) // starting mid-send is where text+time matching folded them together
  assert.deepEqual(host(shown.map((e) => e.id)), [a2.id, b1.id])
  assert.deepEqual(host(shown.map((e) => e.images)), [[one], [two]])
  assert.equal((html.match(/<img /g) || []).length, 2)
})

test('a feed that starts mid-send still shows it once, and never folds it into the next identical send', () => {
  hub.send({ to: 'ada', text: '@june @iris same' })
  hub.send({ to: 'ada', text: '@june @iris same' })
  const [a1, a2, a3, b1] = msgs()
  const feed = [...hub.feed.slice(1), reply(a3.id), reply(b1.id)] // retention cut off a1
  const { shown, html } = render(feed)
  assert.deepEqual(host(shown.filter((e) => e.kind === 'msg').map((e) => e.id)), [a2.id, b1.id])
  assert.match(html, /to <span[^>]*>@ada<\/span> <span[^>]*>@june<\/span> <span[^>]*>@iris<\/span>/)
  assert.match(html, new RegExp(`class="quote" data-jump="${a2.id}"[^]*class="quote" data-jump="${b1.id}"`))
  assert.match(html, new RegExp(`id="m-${a2.id}"[^]*data-jump="r-${a3.id}"[^]*id="m-${b1.id}"[^]*data-jump="r-${b1.id}"`))
})

test('copies that are not next to each other still merge by sendId', () => {
  hub.send({ to: 'ada', text: '@june @iris split' })
  const [a1, a2, a3] = msgs()
  const between = { id: 'ev', kind: 'event', from: 'iris', text: 'is free', ts: Date.now() }
  const { shown } = render([a1, between, a2, a3])
  assert.deepEqual(host(shown.map((e) => e.id)), [a1.id, 'ev'])
})

test('reply jumps work both ways through the one shown bubble', () => {
  hub.send({ to: 'ada', text: '@june sync' })
  const [lead, copy] = msgs()
  const { html } = render([...hub.feed, reply(copy.id, 'r1')])
  assert.match(html, new RegExp(`id="m-${lead.id}"[^]*class="replied" data-jump="r1"`))
  assert.match(html, new RegExp(`class="quote" data-jump="${lead.id}"`))
  assert.doesNotMatch(html, new RegExp(`id="m-${copy.id}"`))
})

test('Show more state follows the shown bubble', () => {
  hub.send({ to: 'ada', text: '@june long one' })
  const [lead] = msgs()
  assert.match(render(hub.feed, { open: new Set([lead.id]) }).html, new RegExp(`class="bubble open" data-id="${lead.id}"`))
})

test('the feed limit counts merged bubbles, not copies', () => {
  hub.send({ to: 'iris', text: 'first' })
  hub.send({ to: 'ada', text: '@june @iris @abe last' })
  assert.deepEqual(host(render(hub.feed, { limit: 2 }).shown.map((e) => e.text)), ['first', '@june @iris @abe last'])
})

test('agent hand-offs to several teammates stay separate, each with its own approve', () => {
  hub.send({ from: 'abe', to: 'ada,june', text: 'playtest bugs' })
  const { shown, html } = render(hub.feed)
  assert.equal(shown.length, 2)
  assert.equal((html.match(/data-act="approve"/g) || []).length, 2)
})

test('older entries with cc but no sendId are never merged', () => {
  const t = Date.now()
  const legacy = ['ada', 'june'].map((to, i) => ({ id: 'l' + i, kind: 'msg', from: 'you', to, cc: ['ada', 'june'], text: 'x', ts: t }))
  assert.equal(render(legacy).shown.length, 2)
})

// ---- threads (core/threads.js): the hub stamps every line, the channel draws the ones that are its own ----------------
const threaded = (feed, agents = [], extra = {}) => {
  const view = feedView(feed, agents, new Set(), 200, new Map(), { threads: true, ...extra })
  return { shown: view.items, html: view.items.length ? view.html() : '' }
}
const handoffs = () => {
  hub.space.autopilot = true
  hub.send({ to: 'ada', text: 'fix the totals' })
  const root = hub.feed.at(-1)
  const one = hub.post({ kind: 'msg', from: 'ada', to: 'june', text: 'Fix the totals.\n\nMore detail.', re: root.id })
  const two = hub.post({ kind: 'reply', from: 'june', text: 'Fixed the totals.', re: one.id })
  const answer = hub.post({ kind: 'reply', from: 'ada', text: 'June fixed it.', re: root.id })
  return { root, one, two, answer }
}

test('in a channel a thread is one card, where its first line would be; a conversation shows every line', () => {
  const { root, answer } = handoffs()
  const { shown, html } = threaded(hub.feed)
  assert.deepEqual(host(shown.map((e) => e.id)), [root.id, `t-${root.id}`, answer.id])
  assert.match(html, /class="thread-card/)
  assert.match(html, new RegExp(`data-thread="${root.id}"`))
  assert.match(html, /ada<\/b> opened a thread with <b>june/)
  assert.match(html, /2 messages/)
  assert.doesNotMatch(html, /Fixed the totals/)
  assert.equal(render(hub.feed).shown.length, 4, 'with threads off (a conversation, a search), every line')
})

test('your message says who replied to you, not what went on in the thread', () => {
  const { root, answer } = handoffs()
  const { html } = threaded(hub.feed)
  const mine = html.slice(html.indexOf(`id="m-${root.id}"`), html.indexOf('thread-card'))
  assert.match(mine, new RegExp(`data-jump="${answer.id}"`))
  assert.match(mine, /@ada/)
  assert.doesNotMatch(mine, /@june/)
})

test('a reply that repeats a hand-off is not counted, and only what the channel shows is unread', () => {
  const { root, one } = handoffs()
  const echo = hub.post({ kind: 'reply', from: 'ada', text: 'I told June.', re: one.id, thread: root.id, echo: one.id })
  assert.equal(inThread(echo), true)
  assert.match(threaded(hub.feed).html, /2 messages/)
  const reads = { since: 0, agents: {} }
  assert.equal(isUnread(hub.feed.find((e) => e.text === 'Fixed the totals.'), reads), false)
  assert.equal(isUnread(hub.feed.find((e) => e.text === 'June fixed it.'), reads), true)
})

test('a card says when someone is at work in its thread, with its latest line', () => {
  const { root } = handoffs()
  const { html } = threaded(hub.feed, [{ name: 'june', status: 'working', thread: root.id }])
  assert.match(html, /class="typing"/)
  assert.match(html, /Fixed the totals\./)
})

test('a card turns berry for a question brought out to you, until someone says something to its agent', () => {
  const { root, one } = handoffs()
  const asked = hub.post({ kind: 'reply', from: 'june', text: 'Should I ship it?', re: one.id, thread: root.id, out: true, asks: true })
  const { html } = threaded(hub.feed)
  assert.match(html, /thread-card asks/)
  assert.match(html, /june is asking you something/)
  assert.match(html, /class="tag asks"/)
  hub.post({ kind: 'msg', from: 'ada', to: 'june', text: 'Yes.', re: asked.id, thread: root.id })
  assert.doesNotMatch(threaded(hub.feed).html, /thread-card asks/)
})

test('a dot only when more was said in a thread you have opened', () => {
  const { root } = handoffs()
  assert.doesNotMatch(threaded(hub.feed).html, /tc-news/)
  const newest = hub.feed.filter((e) => e.thread === root.id && inThread(e)).at(-1).ts
  assert.doesNotMatch(threaded(hub.feed, [], { threadSeen: () => newest }).html, /tc-news/)
  assert.match(threaded(hub.feed, [], { threadSeen: (id) => (id === root.id ? newest - 1 : undefined) }).html, /tc-news/)
})

test('one send to several agents has one card, under the message it shows as', () => {
  hub.space.autopilot = true
  hub.send({ to: 'ada', text: '@june both of you' })
  const [first, second] = msgs()
  hub.post({ kind: 'msg', from: 'ada', to: 'iris', text: 'Yours.', re: first.id })
  hub.post({ kind: 'msg', from: 'june', to: 'iris', text: 'Mine.', re: second.id })
  const { shown } = threaded(hub.feed)
  assert.deepEqual(host(shown.map((e) => e.kind)), ['msg', 'thread'])
  assert.equal(shown[1].thread, first.id)
  assert.equal(shown[1].n, 2)
})

test('lines with no stamps (an older computer, linked) stay lines', () => {
  const feed = [{ id: 'a', kind: 'msg', from: 'you', to: 'ada', text: 'x', ts: 1 }, { id: 'b', kind: 'msg', from: 'ada', to: 'june', text: 'y', re: 'a', ts: 2 }]
  assert.deepEqual(host(threaded(feed).shown.map((e) => e.id)), ['a', 'b'])
})

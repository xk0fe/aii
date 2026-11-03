// What Crew keeps of the files that would otherwise grow forever in CREW_HOME (core/keep.js): the chat's feed.jsonl,
// the shared notes, the hooks' spool, the terminal host's log, and images nothing needs any more. Real Hub and Crew
// with a fake runner in a throwaway CREW_HOME; the hooks as the CLIs run them. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIN } from './helpers/platform.mjs'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-keep-'))
const HOME = process.env.CREW_HOME
const { Hub, CONFIG, ATTACHMENTS } = await import('../core/hub.js')
const { keepFeed, keepLines, sweepFiles, FEED_KEEP, FEED_BYTES, BOARD_KEEP, BOARD_MAX, SPOOL_MAX, ATTACHMENT_DAYS, CACHE_DAYS } = await import('../core/keep.js')
const { note } = await import('../core/ptyclient.js')
const { adapters } = await import('../core/adapters.js')
const { Crew, CACHE } = await import('../core/crew.js')
const CREW_MJS = fileURLToPath(new URL('../bin/crew.mjs', import.meta.url))
after(() => fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 10 }))

class FakeRunner extends EventEmitter {
  running = () => true
  submit() {}
  write() {}
  stop() {}
  start() {}
}

const at = (f) => path.join(HOME, f)
const fileLines = () => fs.readFileSync(at('feed.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
let hub
const open = () => (hub = new Hub(new FakeRunner(), { bin: '/nonexistent' }))
beforeEach(() => {
  for (const f of ['feed.jsonl', 'board.md', 'runtime.json', 'conversations.json', 'sessions.json', 'stats.json', 'tickets.json']) fs.rmSync(at(f), { force: true })
  fs.rmSync(at('spool'), { recursive: true, force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'ada', area: 'backend' }, { name: 'milo', area: 'frontend' }] }))
  open()
  for (const a of hub.agents.values()) a.status = 'working' // busy: messages to them queue
})
afterEach(async () => {
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.runtimeTimer)
  await hub.saving
})

// ---- the chat -----------------------------------------------------------------------------------------------------

test('the chat keeps its newest lines by count and by size, with no gaps, plus the older ones still needed', () => {
  const feed = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, text: 'x'.repeat(i === 7 ? 50 : 5) }))
  const ids = (list) => list.map((e) => e.id)
  assert.deepEqual(ids(keepFeed(feed, { keep: 3 })), ['l7', 'l8', 'l9'])
  assert.deepEqual(ids(keepFeed(feed, { keep: 3, needed: (e) => e.id === 'l1' })), ['l1', 'l7', 'l8', 'l9'], 'a line in use stays, in its place')
  // l7 is too long for what's left: it goes, and everything older with it, though l6 would fit
  assert.deepEqual(ids(keepFeed(feed, { keep: 10, bytes: 60 })), ['l8', 'l9'])
  assert.deepEqual(ids(keepFeed([{ id: 'big', text: 'x'.repeat(100) }], { bytes: 10 })), ['big'], 'the newest always stays')
  assert.deepEqual(ids(keepFeed(feed)), ids(feed), 'under the limits: all of it')
})

test("feed.jsonl is written anew once it holds twice what's kept, and an open card and a queued message stay, however old", async () => {
  const card = hub.post({ kind: 'ask', from: 'ada', to: 'you', ask: { type: 'permission', title: 'Run a command', code: 'npm run build' } })
  hub.send({ to: 'milo', text: 'Can you sketch the empty cart?' })
  const queued = hub.feed.at(-1)
  assert.ok(queued.queued)
  for (let i = 0; i < 2 * FEED_KEEP + 50; i++) hub.post({ kind: 'event', from: 'crew', text: `line ${i}` })
  assert.equal(hub.feed.length, FEED_KEEP + 2)
  assert.deepEqual(hub.feed.slice(0, 2), [card, queued], 'still in the chat, in their place')
  await hub.saving
  const saved = fileLines()
  assert.ok(saved.length <= 2 * FEED_KEEP, `feed.jsonl holds ${saved.length} lines`)
  assert.ok(saved.some((e) => e.id === card.id) && saved.some((e) => e.id === queued.id), 'and they were written with it')
  assert.equal(saved.at(-1).text, `line ${2 * FEED_KEEP + 49}`)

  // answered, the card is history like any other line: the next time it's written anew, it's left out
  hub.amend(card, { answer: { by: 'you', allow: true } })
  for (let i = 0; i < 2 * FEED_KEEP; i++) hub.post({ kind: 'event', from: 'crew', text: `more ${i}` })
  await hub.saving
  assert.ok(!hub.feed.includes(card))
  assert.ok(!fileLines().some((e) => e.id === card.id || e.amend === card.id))
  assert.ok(hub.feed.includes(queued), 'the message is still queued')
})

test('a chat with more lines in use than it keeps is written anew now and then, not at every line, and whole', async () => {
  let rewrites = 0
  const rewrite = hub.rewriteFeed.bind(hub)
  hub.rewriteFeed = (keep) => (rewrites++, rewrite(keep))
  for (let i = 0; i < 2 * FEED_KEEP + 100; i++) hub.send({ to: 'milo', text: `queued ${i}` }) // all still waiting for milo
  for (let i = 0; i < FEED_KEEP; i++) hub.post({ kind: 'event', from: 'crew', text: `line ${i}` })
  assert.equal(hub.feed.filter((e) => e.queued).length, 2 * FEED_KEEP + 100)
  assert.ok(rewrites <= 4, `written anew ${rewrites} times`)
  await hub.saving
  assert.equal(fileLines().filter((e) => e.queued).length, 2 * FEED_KEEP + 100)
  assert.deepEqual(fs.readdirSync(HOME).filter((f) => f.startsWith('feed.jsonl')), ['feed.jsonl'], 'nothing left beside it')
})

test("the chat keeps no more than its size: long lines push older ones out sooner", async () => {
  const long = 'x'.repeat(100 * 1024)
  for (let i = 0; i < 60; i++) hub.post({ kind: 'msg', from: 'you', to: 'ada', text: `${i} ${long}` })
  const kept = hub.feed.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)) + 1, 0)
  assert.ok(kept <= FEED_BYTES && hub.feed.length < 60, `kept ${hub.feed.length} lines, ${kept} bytes`)
  assert.equal(hub.feed.at(-1).text.split(' ')[0], '59')
  await hub.saving
  assert.ok(fs.statSync(at('feed.jsonl')).size <= 2 * FEED_BYTES + 101 * 1024, 'written anew once it passed twice that')
})

test("a restart reads back what's kept: an old file is written anew, and lines the agents at work still need stay", async () => {
  // a feed.jsonl from before there was a limit: 3000 lines, and an answer to one of the first
  const old = Array.from({ length: 3000 }, (_, i) => JSON.stringify({ id: `e${i}`, ts: i, kind: 'event', from: 'crew', text: `line ${i}` }))
  old.push(JSON.stringify({ amend: 'e5', answer: { by: 'you' } }))
  fs.writeFileSync(at('feed.jsonl'), old.join('\n') + '\n')
  // what Crew saved about an agent at work: the message it's answering and one in its queue, from long ago
  fs.writeFileSync(at('runtime.json'), JSON.stringify({ agents: { ada: { current: 'e3', inbox: [{ id: 'e4' }] } }, calls: [{ id: 'q', msg: 'e5' }] }))
  open()
  assert.equal(hub.feed.length, FEED_KEEP + 3)
  assert.deepEqual(hub.feed.slice(0, 3).map((e) => e.id), ['e3', 'e4', 'e5'])
  assert.deepEqual(hub.feed[2].answer, { by: 'you' }, 'with its amendment')
  assert.equal(hub.feed.at(-1).id, 'e2999')
  assert.deepEqual(fileLines().map((e) => e.id), hub.feed.map((e) => e.id), 'written anew with just that')
  // a file within twice the limit is read as it is
  fs.rmSync(at('runtime.json'))
  open()
  assert.equal(hub.feed.length, FEED_KEEP)
  assert.equal(fileLines().length, FEED_KEEP + 3)
})

test('lines that arrive with an agent moving in, older than the chat here, stay only if it still needs them', async () => {
  for (let i = 0; i < FEED_KEEP; i++) hub.post({ kind: 'event', from: 'crew', text: `here ${i}` })
  const lines = [
    { id: 'm1', ts: 1, kind: 'msg', from: 'you', to: 'noor', text: 'what it was answering' },
    { id: 'm2', ts: 2, kind: 'reply', from: 'noor', text: 'an old reply' },
  ]
  hub.adoptFeed(lines, ['m1'])
  assert.equal(hub.feed[0].id, 'm1')
  assert.ok(!hub.feed.some((e) => e.id === 'm2'))
  await hub.saving
  assert.equal(fileLines()[0].id, 'm1')
})

// ---- the shared notes -----------------------------------------------------------------------------------------------

test('the shared notes keep the last ones `crew board` shows, and never pass their size', () => {
  const words = 'the checkout tests need a seeded cart; run npm run seed first '.repeat(3)
  let biggest = 0
  for (let i = 0; i < 1500; i++) {
    hub.note('ada', `${i}: ${words}`)
    biggest = Math.max(biggest, fs.statSync(at('board.md')).size)
  }
  assert.ok(biggest <= BOARD_MAX + 300, `board.md reached ${biggest} bytes`)
  const notes = fs.readFileSync(at('board.md'), 'utf8').trim().split('\n')
  assert.ok(notes.length >= BOARD_KEEP / 2 && notes.length <= 1500, `${notes.length} notes kept`)
  assert.match(notes.at(-1), /^- \*\*ada\*\* \(.+\): 1499: the checkout/)
  assert.match(hub.board(), /1499: the checkout/)
  assert.equal(keepLines('a\nb\nc\n', { keep: 2 }), 'b\nc\n')
  assert.equal(keepLines(`${'x'.repeat(10)}\n${'y'.repeat(10)}\n`, { max: 30 }), `${'y'.repeat(10)}\n`, 'half the size, the newest always')
})

// ---- the spool, while Crew is closed --------------------------------------------------------------------------------

function run(file, args, { env, input = '' }) {
  return new Promise((resolve) => {
    const p = spawn(file, args, { env })
    p.on('close', resolve)
    p.stdin.on('error', () => {})
    p.stdin.end(input)
  })
}
const event = (text) => `${JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: text })}\n`

async function spoolFills(hookRun) {
  const dir = fs.mkdtempSync(path.join(HOME, 'spool-home-'))
  fs.writeFileSync(path.join(dir, 'url'), 'http://127.0.0.1:9') // nothing answers: Crew is closed
  const spool = path.join(dir, 'spool', 'ada.jsonl')
  fs.mkdirSync(path.dirname(spool), { recursive: true })
  fs.writeFileSync(spool, 'x'.repeat(SPOOL_MAX - 10) + '\n')
  await hookRun(dir, event('just under: added'))
  assert.ok(!fs.existsSync(`${spool}.1`))
  assert.match(fs.readFileSync(spool, 'utf8'), /^x+\n\{.*"just under: added"\}\n$/)
  await hookRun(dir, event('past it: a new spool'))
  assert.ok(fs.statSync(`${spool}.1`).size > SPOOL_MAX, 'the full one is kept beside it')
  assert.equal(JSON.parse(fs.readFileSync(spool, 'utf8')).last_assistant_message, 'past it: a new spool')
  fs.writeFileSync(spool, 'y'.repeat(SPOOL_MAX + 10) + '\n')
  await hookRun(dir, event('and again'))
  assert.match(fs.readFileSync(`${spool}.1`, 'utf8'), /^y+\n$/, 'the one before that goes')
  // a burst of hooks at once (a turn's tool calls), right as the spool fills: one of them moves the full one aside,
  // and no event is lost, nor the full spool
  fs.writeFileSync(spool, 'z'.repeat(SPOOL_MAX + 10) + '\n')
  const burst = Array.from({ length: 8 }, (_, i) => `burst ${i}`)
  await Promise.all(burst.map((text) => hookRun(dir, event(text))))
  const old = fs.readFileSync(`${spool}.1`, 'utf8')
  const now = fs.readFileSync(spool, 'utf8')
  // (on Windows a rename can be turned down while another hook has the file open: the full spool then stays where it
  // is, whole, for the next hook to move aside)
  const full = 'z'.repeat(SPOOL_MAX + 10)
  assert.ok(old.startsWith(full) || (WIN && now.includes(full)), 'the full spool is the one kept beside it')
  for (const text of burst) assert.ok(now.includes(`"${text}"`) || old.includes(`"${text}"`), text)
  assert.deepEqual(fs.readdirSync(path.dirname(spool)).sort(), ['ada.jsonl', 'ada.jsonl.1'], 'nothing left aside')
}

test("crew-hook (Windows' hooks) starts the spool afresh past its size, keeping the one before", () =>
  spoolFills((dir, input) => run(process.execPath, [CREW_MJS, 'crew-hook', 'hook'], { env: { ...process.env, CREW_HOME: dir, CREW_AGENT: 'ada', CREW_WORKSPACE: '' }, input })))

test('the sh hooks (macOS) start the spool afresh past its size, as crew-hook does', { skip: WIN && 'Windows runs crew-hook.exe' }, () => {
  const settings = JSON.parse(adapters.claude({ name: 'ada' }, { session: 's', attachments: '/tmp', platform: 'darwin' }).args.find((x) => x.startsWith('{"permissions"')))
  const hook = settings.hooks.Stop[0].hooks[0].command
  return spoolFills((dir, input) => run('/bin/sh', ['-c', hook], { env: { PATH: '/usr/bin:/bin', HOME: dir, CREW_HOME: dir, CREW_AGENT: 'ada', CREW_WORKSPACE: '' }, input }))
})

test("Crew back replays an agent's full spool before its newer one, and one a hook was moving aside, and removes them", () => {
  fs.mkdirSync(at('spool'), { recursive: true })
  fs.writeFileSync(at('spool/ada.jsonl'), event('second'))
  fs.writeFileSync(at('spool/ada.jsonl.1'), event('first'))
  fs.writeFileSync(at('spool/ada.jsonl.4242'), event('moving aside')) // its hook was cut short
  fs.writeFileSync(at('spool/milo.jsonl'), event('milo'))
  const heard = []
  hub.onHook = (name, e) => heard.push(`${name}: ${e.last_assistant_message}`)
  hub.replaySpool()
  assert.deepEqual(heard.filter((h) => h.startsWith('ada')), ['ada: first', 'ada: moving aside', 'ada: second'])
  assert.ok(heard.includes('milo: milo'))
  assert.deepEqual(fs.readdirSync(at('spool')), [])
})

// ---- the terminal host's log ----------------------------------------------------------------------------------------

test("Crew's lines in the terminal host's log stop once it's full", () => {
  const file = path.join(fs.mkdtempSync(path.join(HOME, 'log-')), 'ptyhost.log')
  note('first', file, 40)
  note('second', file, 40)
  note('third', file, 40)
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.deepEqual(lines.map((l) => l.split(' ').slice(1).join(' ')), ['first', 'second'])
})

// ---- images nothing needs -------------------------------------------------------------------------------------------

test('images: attachments nothing refers to go after a while, so do old copies of linked computers\' images', () => {
  const now = Date.now()
  const day = 864e5
  const make = (file, ageDays) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'png')
    const t = new Date(now - ageDays * day)
    fs.utimesSync(file, t, t)
    return file
  }
  const old = ATTACHMENT_DAYS + 1
  const loose = make(path.join(ATTACHMENTS, 'loose.png'), old)
  const fresh = make(path.join(ATTACHMENTS, 'fresh.png'), 1)
  const inChat = make(path.join(ATTACHMENTS, 'chat.png'), old)
  const onTask = make(path.join(ATTACHMENTS, 'task.png'), old)
  const cached = make(path.join(CACHE, 'workstation', 'old.png'), CACHE_DAYS + 1)
  const recent = make(path.join(CACHE, 'workstation', 'recent.png'), 2)
  const crew = new Crew({ bin: '/nonexistent', computerName: 'Studio' })
  crew.hub.post({ kind: 'msg', from: 'you', to: 'ada', text: 'look', images: [inChat] })
  crew.hub.tickets.add({ title: 'Empty cart state', images: [onTask] })
  assert.deepEqual(crew.sweepImages(now), { attachments: 1, cache: 1 })
  assert.deepEqual([loose, fresh, inChat, onTask, cached, recent].map((f) => fs.existsSync(f)), [false, true, true, true, false, true])
  assert.equal(sweepFiles(path.join(HOME, 'no-such-folder'), { days: 1 }), 0)
})

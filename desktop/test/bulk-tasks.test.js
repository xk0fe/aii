// Bulk actions on the Tasks board, against the real Hub with a fake runner in a throwaway CLIQUE_HOME: many tasks
// changed in one write with one line in the chat, Start handing each to its owner in a new conversation, Clear Done,
// and a bulk action split by the computer each task lives on (an older CLIque gets them one at a time). Run with
// `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-bulk-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')

const CLIQUE = [
  { name: 'ada', area: 'game client: controls, input, pause menu, UI screens' },
  { name: 'june', area: 'backend api, servers, leaderboards' },
]

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  starts = []
  running = (n) => this.live.has(n)
  start = (n) => (this.starts.push(n), this.live.add(n))
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
}

let hub, runner
beforeEach(() => {
  for (const f of ['tickets.json', 'conversations.json', 'sessions.json', 'feed.jsonl']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CLIQUE }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
})
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

// A task on the board, with its owner and where it stands: its number.
const add = (text, { owner, status = 'new', kind = 'task', on = hub } = {}) => {
  on.fileTask({ text, kind, owner })
  const t = on.tickets.all.at(-1)
  if (status !== 'new') on.tickets.move(t.id, status, 'you')
  return t.id
}
const task = (id) => hub.tickets.all.find((t) => t.id === id)
const bulkLines = () => hub.feed.filter((e) => e.kind === 'task' && e.act === 'bulk')
const linesAfter = (n) => hub.feed.slice(n).filter((e) => e.kind === 'task')

// How many times tickets.json is written while fn runs.
async function writesDuring(fn) {
  const file = path.join(process.env.CLIQUE_HOME, 'tickets.json')
  const real = fs.writeFileSync
  let n = 0
  fs.writeFileSync = (f, ...rest) => ((f === file && n++), real.call(fs, f, ...rest))
  try {
    await fn()
  } finally {
    fs.writeFileSync = real
  }
  return n
}

test('closing many tasks is one write and one line in the chat; one already closed is left alone', async () => {
  const ids = [add('Pause menu overlaps', { owner: 'ada' }), add('Leaderboard is slow', { owner: 'june', status: 'fixing' }), add('Rename Volumn', { status: 'check' }), add('Old one', { status: 'done' })]
  const before = hub.feed.length
  let out
  assert.equal(await writesDuring(async () => (out = await hub.bulk('close', ids.map(String)))), 1)
  assert.equal(out, 'closed 3 tasks\n')
  assert.deepEqual(ids.map((id) => task(id).status), ['done', 'done', 'done', 'done'])
  assert.equal(task(ids[0]).log.at(-1).text, 'closed it')
  assert.equal(task(ids[2]).log.at(-1).text, 'accepted it', 'one waiting for review is accepted')
  const lines = linesAfter(before)
  assert.equal(lines.length, 1, 'not one line per task')
  assert.deepEqual([lines[0].act, lines[0].from, lines[0].text, lines[0].count], ['bulk', 'you', 'closed 3 tasks', 3])
})

test('bulk Start hands each owned task to its owner in a new conversation, with one line for all of them', async () => {
  const mine = add('Pause menu overlaps', { owner: 'ada' })
  const theirs = add('Leaderboard is slow', { owner: 'june' })
  const nobody = add('Daily challenge')
  const review = add('Rename Volumn', { owner: 'ada', status: 'check' })
  const before = hub.feed.length
  let out
  const writes = await writesDuring(async () => (out = await hub.bulk('start', [mine, theirs, nobody, review].map(String))))
  assert.equal(writes, 1)
  assert.match(out, /^started 2 tasks, each in a new conversation\n$/)
  assert.deepEqual([task(mine).status, task(theirs).status, task(nobody).status, task(review).status], ['fixing', 'fixing', 'new', 'check'])
  assert.deepEqual([task(mine).fixer, task(theirs).fixer], ['ada', 'june'])
  // each went as a message of its own, for a new conversation, and each agent started one
  const sent = hub.feed.slice(before).filter((e) => e.kind === 'msg' && e.ticket !== undefined)
  assert.deepEqual(sent.map((e) => [e.to, e.ticket, Boolean(e.fresh)]), [['ada', mine, true], ['june', theirs, true]])
  assert.deepEqual(runner.starts.sort(), ['ada', 'june'])
  // the chat: one line for the lot, none of the single "went to @ada" ones
  const lines = linesAfter(before)
  assert.deepEqual(lines.map((e) => e.act), ['bulk'])
  assert.equal(lines[0].text, 'started 2 tasks, each in a new conversation')
})

test('a task Start can not hand on is left in To do, and the answer says why', async () => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [CLIQUE[0], { ...CLIQUE[1], off: true }] }))
  hub.loadConfig()
  const ok = add('Pause menu overlaps', { owner: 'ada' })
  const off = add('Leaderboard is slow', { owner: 'june' })
  const out = await hub.bulk('start', [ok, off])
  assert.match(out, /^started 1 task, each in a new conversation\n/)
  assert.match(out, new RegExp(`#${off}: .*turned off`))
  assert.deepEqual([task(ok).status, task(off).status], ['fixing', 'new'])
})

test('owner, priority and moves change only the tasks they apply to; nothing to change says so', async () => {
  const a = add('Pause menu overlaps', { owner: 'ada' })
  const b = add('Daily challenge')
  const c = add('Old one', { owner: 'ada', status: 'done' })
  assert.equal(await hub.bulk('owner', [a, b, c], 'june'), 'gave 2 tasks to @june\n', 'a closed task keeps its owner')
  assert.deepEqual([task(a).owner, task(b).owner, task(c).owner], ['june', 'june', 'ada'])
  assert.equal(await hub.bulk('owner', [a, b], 'june'), 'nothing to change\n')
  assert.equal(await hub.bulk('owner', [a], ''), 'unassigned 1 task\n')
  assert.equal(task(a).owner, null)
  assert.equal(await hub.bulk('priority', [a, b, c], 'urgent'), 'made 2 tasks urgent priority\n')
  assert.deepEqual([task(a).severity, task(b).severity, task(c).severity], ['blocker', 'blocker', 'normal'])
  await assert.rejects(hub.bulk('priority', [a], 'whenever'), /priority is one of/)
  assert.equal(await hub.bulk('move', [a, b, c], 'check'), 'moved 2 tasks to Review\n', 'a closed one stays closed')
  assert.equal(await hub.bulk('move', [a, b, c], 'new'), 'moved 3 tasks to To do\n')
  assert.equal(await hub.bulk('move', [a], 'done'), 'closed 1 task\n')
  assert.equal(bulkLines().length, 6, 'one line for each bulk action that changed something')
})

test('delete takes the picked tasks; Clear Done takes every done task, picked or not', async () => {
  const open = add('Pause menu overlaps', { owner: 'ada' })
  const gone = add('Daily challenge')
  const done = [add('One', { status: 'done' }), add('Two', { status: 'done' }), add('Three', { status: 'done' })]
  assert.equal(await hub.bulk('remove', [gone, 999]), 'deleted 1 task\n', 'a task already gone is skipped')
  assert.equal(task(gone), undefined)
  assert.equal(await hub.bulk('clear', [done[0]]), 'cleared 3 done tasks\n')
  assert.deepEqual(hub.tickets.all.map((t) => t.id), [open])
  assert.equal(await hub.bulk('clear', []), 'nothing to change\n')
})

test('a bulk action goes to each computer with its own tasks; an older CLIque gets them one at a time', async () => {
  const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
  const here = add('Pause menu overlaps', { owner: 'ada', on: clique.hubs.get('default') })
  const calls = []
  // what a call for a workspace is on the wire: 'in' its key. Each takes what's pushed to it as a real peer does: the
  // tasks changing here sends this computer's state on to every linked one a moment later, after the test has ended.
  const push = () => {}
  const inWs = (handle) => ({ push, call: async (_in, [, fn, args]) => handle(fn, args) })
  clique.links.set('laptop', { slug: 'laptop', name: 'Laptop', peer: { push, call: async (_in, [, fn, args]) => (calls.push([fn, args]), fn === 'bulk' ? `closed ${args[1].length} tasks\n` : undefined) } })
  clique.links.set('old', {
    slug: 'old', name: 'Old Mac',
    peer: inWs(async (fn, args) => {
      calls.push([fn, args])
      if (fn === 'bulk') throw new Error('"bulk" isn\'t available over CLIque Link')
    }),
  })
  clique.links.set('gone', { slug: 'gone', name: 'Gone', peer: null })
  const out = await clique.ticket('bulk', null, { op: 'close', keys: [`${here}@studio`, '7@laptop', '8@laptop', '3@old', '4@old', '5@gone'] })
  assert.equal(out, "closed 1 task\non Laptop: closed 2 tasks\non Old Mac: 2 of 2 done one at a time (it runs an older CLIque)\n1 on Gone left as they were: it's unreachable right now\n")
  assert.equal(clique.hubs.get('default').tickets.all.find((t) => t.id === here).status, 'done')
  assert.deepEqual(calls, [
    ['bulk', ['close', ['7', '8'], undefined]],
    ['bulk', ['close', ['3', '4'], undefined]],
    ['ticket', ['accept', '3', undefined]],
    ['ticket', ['accept', '4', undefined]],
  ])
  // an owner, as the other computer names it: ours with @this-computer, its own bare
  calls.length = 0
  await clique.ticket('bulk', null, { op: 'owner', keys: ['7@laptop'], arg: 'ada' })
  await clique.ticket('bulk', null, { op: 'owner', keys: ['7@laptop'], arg: 'ann@laptop' })
  assert.deepEqual(calls.map(([, args]) => args[2]), ['ada@studio', 'ann'])
})

// `clique canvas` (Hub.canvas, core/canvas.js): an agent draws a board in the chat, and teammates draw on the same one.
// Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { BIN, WIN } from './helpers/platform.mjs'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-canvas-'))
const { CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
const { serve } = await import('../core/server.js')
const { agentKey } = await import('../core/keys.js')
const { canvasLines, typedLines, withCanvas, asCanvas, canvasTitle, CANVAS_LINES } = await import('../core/canvas.js')

fs.writeFileSync(CONFIG, JSON.stringify({
  autopilot: true,
  agents: [{ name: 'iris', area: 'evaluation' }, { name: 'theo', area: 'testing' }, { name: 'milo', area: 'ios app' }],
  channels: [{ id: 'evidence', name: 'evidence' }, { id: 'ios', name: 'ios-release', members: ['milo'] }],
}))
const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
Object.assign(clique.runner, { running: () => true, quietFor: () => Infinity, submit() {}, write() {} })
const hub = clique.hubs.get('default')
const quiet = () => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.steerTimer)
  for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(hub[t])
  clearTimeout(clique.changeTimer)
}
after(() => {
  quiet()
  clique.config.close?.()
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
})
// `clique canvas <words>` as the /canvas route hands it over
const canvas = (from, ...words) => hub.canvas(from, words)
const idOf = (out) => /canvas (\w{8})/.exec(out)[1]
const entry = (id) => hub.feed.find((e) => e.id === id)

test('a canvas is a block in a message: read, written back and titled', () => {
  const text = `Here it is.\n\n${asCanvas(['title: T', '[a] -> [b]'])}\n\nDone.`
  assert.deepEqual(canvasLines(text), ['title: T', '[a] -> [b]'])
  assert.equal(canvasTitle(canvasLines(text)), 'T')
  assert.equal(withCanvas(text, ['title: T', '[a] -> [c]', 'ok: $& stays as typed']), 'Here it is.\n\n```canvas\ntitle: T\n[a] -> [c]\nok: $& stays as typed\n```\n\nDone.')
  assert.equal(canvasLines('```js\nlet a\n```'), null)
  assert.equal(canvasLines('```canvas\n\n```'), null)
  // each word is a line, one with newlines is several, and none can end the block it goes in
  assert.deepEqual(typedLines(['title: T', ' [a] -> [b] \n\nok: fine', '', '``` no: x ````']), ['title: T', '[a] -> [b]', 'ok: fine', "''' no: x '''"])
})

test('clique canvas new draws one where the agent is working, as a message of its own', () => {
  const asked = hub.post({ kind: 'msg', from: 'you', to: 'iris', text: 'how did v1 do?', channel: 'evidence' })
  hub.agents.get('iris').current = asked.id
  const out = canvas('iris', 'new', 'title: Candidate v1', 'bar: Green 0.67 {green}', 'bar: Tee 0.32 {pink}')
  assert.match(out, /^drawn in #evidence: canvas \w{8}\. /)
  const e = entry(idOf(out))
  assert.deepEqual([e.kind, e.from, e.channel, e.text], ['reply', 'iris', 'evidence', '```canvas\ntitle: Candidate v1\nbar: Green 0.67 {green}\nbar: Tee 0.32 {pink}\n```'])
  assert.deepEqual(e.canvas.by, ['iris', 'iris', 'iris'])
  hub.agents.get('iris').current = undefined
  // with nothing in hand it's #general's
  assert.match(canvas('theo', 'new', '[a] -> [b]'), /^drawn in #general: /)
})

test('a teammate adds to the same canvas: the message changes where it stands, and the chat says who drew on it once', () => {
  const id = idOf(canvas('iris', 'new', 'title: Checkout', '1: [cart] -> [payment]'))
  const at = hub.feed.indexOf(entry(id))
  const before = hub.feed.length
  const out = canvas('theo', 'add', id, 'ok: 48 tests pass', 'no: Safari not run')
  assert.equal(out, `canvas ${id} "Checkout" now reads:\n 1  title: Checkout\n 2  1: [cart] -> [payment]\n 3  ok: 48 tests pass\n 4  no: Safari not run\n`)
  const e = entry(id)
  assert.equal(hub.feed.indexOf(e), at)
  assert.deepEqual(canvasLines(e.text), ['title: Checkout', '1: [cart] -> [payment]', 'ok: 48 tests pass', 'no: Safari not run'])
  assert.deepEqual(e.canvas.by, ['iris', 'iris', 'theo', 'theo'])
  const said = hub.feed.at(-1)
  assert.deepEqual([said.kind, said.from, said.text, said.canvasOf], ['event', 'theo', 'added to @iris\'s canvas "Checkout"', id])
  // more from the same hand right after: the board changes, the chat doesn't say it again
  canvas('theo', 'set', id, '4', 'ok: Safari passes too')
  canvas('theo', 'cut', id, '3')
  assert.equal(hub.feed.length, before + 1)
  assert.deepEqual(canvasLines(e.text), ['title: Checkout', '1: [cart] -> [payment]', 'ok: Safari passes too'])
  assert.deepEqual(e.canvas.by, ['iris', 'iris', 'theo'])
  assert.equal(e.canvas.rev, 3)
  // its own author's changes are just the board's
  canvas('iris', 'add', id, 'note: ship it')
  assert.equal(hub.feed.length, before + 1)
})

test('a canvas in a final message is one too, and the words around it stay', () => {
  const e = hub.post({ kind: 'reply', from: 'iris', to: 'you', text: 'Measured.\n\n```canvas\ntitle: Latency\nbar: Chrome 412 ms\n```\n\nMore tomorrow.' })
  assert.match(canvas('theo', 'show'), new RegExp(`${e.id}  #general +@iris +Latency \\(2 lines\\)`))
  assert.equal(canvas('theo', 'show', e.id.slice(0, 5)), `canvas ${e.id} "Latency", drawn by @iris:\n 1  title: Latency\n 2  bar: Chrome 412 ms\n`)
  canvas('theo', 'add', e.id, 'bar: Safari 530 ms')
  assert.equal(e.text, 'Measured.\n\n```canvas\ntitle: Latency\nbar: Chrome 412 ms\nbar: Safari 530 ms\n```\n\nMore tomorrow.')
  assert.deepEqual(e.canvas.by, ['iris', 'iris', 'theo'])
  assert.match(canvas('milo', 'show', e.id), /drawn by @iris, @theo:/)
})

test('what can\'t be drawn is turned down, and nothing changes', () => {
  const id = idOf(canvas('iris', 'new', 'title: Only'))
  const feed = JSON.stringify(hub.feed)
  assert.equal(canvas('iris'), canvas('iris', 'help'))
  assert.match(canvas('iris', 'help'), /clique canvas add <id>/)
  assert.throws(() => canvas('iris', 'new'), /usage: clique canvas new/)
  assert.throws(() => canvas('iris', 'new', ...Array.from({ length: CANVAS_LINES + 1 }, (_, i) => `ok: ${i}`)), /holds 60 lines at most/)
  assert.throws(() => canvas('you', 'new', '[a]'), /type a ```canvas block/)
  assert.throws(() => canvas('iris', 'paint', id), /there's no clique canvas paint/)
  assert.throws(() => canvas('iris', 'add', 'nope1234', 'ok: x'), /there's no canvas nope1234 in the chat\. The ones there are:\n\w{8}  #/)
  assert.throws(() => canvas('iris', 'add', id), /usage: clique canvas add/)
  assert.throws(() => canvas('iris', 'set', id, '7', 'ok: x'), /has lines 1 to 1:\n 1  title: Only/)
  assert.throws(() => canvas('iris', 'set', id, '1'), /usage: clique canvas set/)
  assert.throws(() => canvas('iris', 'cut', id, '1'), /its only line/)
  assert.equal(JSON.stringify(hub.feed), feed)
})

test('a canvas in a channel with members is theirs to draw on', () => {
  const asked = hub.post({ kind: 'msg', from: 'you', to: 'milo', text: 'release plan?', channel: 'ios' })
  hub.agents.get('milo').current = asked.id
  const id = idOf(canvas('milo', 'new', 'title: Release'))
  hub.agents.get('milo').current = undefined
  assert.throws(() => canvas('theo', 'add', id, 'ok: x'), /that canvas is in #ios-release and you're not/)
  assert.deepEqual(canvasLines(entry(id).text), ['title: Release'])
  // you, from your own terminal, can
  canvas('you', 'add', id, 'ok: approved')
  assert.deepEqual(entry(id).canvas.by, ['milo', 'you'])
  assert.equal(hub.feed.at(-1).text, 'added to @milo\'s canvas "Release"')
})

test('a changed canvas is still there after a restart', async () => {
  const id = idOf(canvas('iris', 'new', 'title: Kept', '[a] -> [b]'))
  canvas('theo', 'add', id, 'ok: kept')
  await hub.saving
  const lines = fs.readFileSync(path.join(process.env.CLIQUE_HOME, 'feed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const amended = lines.findLast((l) => l.amend === id)
  assert.deepEqual(canvasLines(amended.text), ['title: Kept', '[a] -> [b]', 'ok: kept'])
  assert.deepEqual(amended.canvas.by, ['iris', 'iris', 'theo'])
})

test('clique canvas, as agents run it in a shell: the lines arrive as typed, and a teammate adds to it', async () => {
  const server = await serve({ token: 'tok', hubFor: (id) => clique.hubs.get(id) })
  const home = fs.mkdtempSync(path.join(process.env.CLIQUE_HOME, 'cli-'))
  fs.writeFileSync(path.join(home, 'url'), `http://127.0.0.1:${server.address().port}`)
  fs.writeFileSync(path.join(home, 'token'), 'tok')
  const run = (file, args, agent) => new Promise((resolve) => execFile(file, args, { env: { ...process.env, CLIQUE_HOME: home, CLIQUE_AGENT: agent, CLIQUE_WORKSPACE: 'default', CLIQUE_BADGE: agentKey('default', agent) } }, (e, stdout, stderr) => resolve({ code: e?.code ?? 0, stdout, stderr })))
  const clis = [['clique.mjs', (agent, ...a) => run(process.execPath, [path.join(BIN, 'clique.mjs'), 'clique', ...a], agent)], ...(WIN ? [] : [['bin/clique', (agent, ...a) => run(path.join(BIN, 'clique'), a, agent)]])]
  try {
    for (const [what, cli] of clis) {
      const row = '1: [it\'s "in"] -$HOME-> [out]{green} ==a & b== > c'
      const made = await cli('iris', 'canvas', 'new', 'title: From a shell', row)
      assert.match(made.stdout, /^drawn in #general: canvas \w{8}\./, what)
      const id = idOf(made.stdout)
      assert.equal((await cli('theo', 'canvas', 'add', id, 'ok: added\nno: and a second line')).stdout, `canvas ${id} "From a shell" now reads:\n 1  title: From a shell\n 2  ${row}\n 3  ok: added\n 4  no: and a second line\n`, what)
      assert.deepEqual(entry(id).canvas.by, ['iris', 'iris', 'theo', 'theo'], what)
      assert.match((await cli('theo', 'canvas')).stdout, /^A canvas is a hand-drawn board/, what)
      assert.match((await cli('theo', 'canvas', 'show')).stdout, new RegExp(`^${id}  #general +@iris @theo +From a shell \\(4 lines\\)$`, 'm'), what)
      const bad = await cli('theo', 'canvas', 'cut', id, '9') // turned down: printed, as any answer is
      assert.match(bad.stderr + bad.stdout, /has lines 1 to 4/, what)
    }
    assert.match((await clis[0][1]('theo', 'help')).stdout + (await clis[0][1]('theo')).stdout, /clique canvas +draw a board in the chat/)
  } finally {
    server.close()
  }
})

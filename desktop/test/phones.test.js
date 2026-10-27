// Your phone (core/phones.js, core/remote.js, shared/PROTOCOL.md): the Mac's crypto against shared/vectors.json, pairing
// codes, and a phone written here (ws + node:crypto, as the Crew app does it) that pairs, watches, answers, sends and is
// unpaired, against a real Crew with a fake runner in a throwaway CREW_HOME. Run with `npm test`.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-phones-'))
process.env.PATH = '/usr/bin:/bin' // no codex to discover once a hub starts
const HOME = process.env.CREW_HOME
const { CONFIG, ATTACHMENTS } = await import('../core/hub.js')
const { Crew, LINK_DIR } = await import('../core/crew.js')
const { Scoped } = await import('../core/runner.js')
const { DEFAULT } = await import('../core/workspaces.js')
const { Remote, macKeys, seal, open } = await import('../core/remote.js')
const { keyPair, privateKey, publicKey } = await import('../core/phones.js')
const { VERSION, SALT, CLOSE, b64, unb64, utf8, concat, keyInfo, readPairCode, pack, unpack } = await import('../../shared/protocol.js')
const { apply } = await import('../../shared/sync.js')
const BIN = new URL('../bin', import.meta.url).pathname
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-phones-folders-'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = (b) => Buffer.from(b).toString('hex')
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => {
    const { port } = s.address()
    s.close(() => resolve(port))
  })
})

class FakeRunner extends EventEmitter {
  live = new Map()
  running = (n) => this.live.has(n)
  start = (n, opts) => this.live.set(n, opts)
  stop = (n) => this.live.delete(n)
  stopAll = () => this.live.clear()
  slow = 0 // ms a terminal's buffer takes, as one on a linked computer does
  buffer = (n) => {
    const b = { data: `the screen of ${n}`, cols: 100, rows: 30 }
    return this.slow ? new Promise((r) => setTimeout(() => r(b), this.slow)) : b
  }
  submit() {}
  write() {}
  resize() {}
}

// ---- a phone, as the Crew app is one ---------------------------------------------------------------------------

const dh = (priv, pub) => crypto.diffieHellman({ privateKey: privateKey(priv), publicKey: publicKey(pub) })

class Phone {
  d = keyPair() // its key for this Mac

  // The handshake (PROTOCOL.md). -> the Mac's ready, or rejects with the code the Mac closed with.
  connect({ port, key, secret, pair = false, name = 'Pixel 9' }) {
    const e = keyPair()
    const ws = (this.ws = new WebSocket(`ws://127.0.0.1:${port}`))
    Object.assign(this, { sent: 0, got: 0, seq: 0, calls: new Map(), inbox: [], waiting: [], state: null, v: 0 })
    this.closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)))
    return new Promise((resolve, reject) => {
      ws.on('error', reject)
      ws.on('close', (code) => reject(Object.assign(new Error(`closed with ${code}`), { code })))
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: VERSION, e: b64(e.pub), d: b64(this.d.pub), ...(pair && { pair: true }) })))
      ws.once('message', (raw) => {
        const welcome = JSON.parse(raw.toString())
        assert.equal(welcome.t, 'welcome')
        const f = unb64(welcome.f)
        const ikm = concat(dh(e.priv, key), dh(this.d.priv, key), dh(e.priv, f), secret ?? new Uint8Array(0))
        const okm = Buffer.from(crypto.hkdfSync('sha256', ikm, utf8(SALT), keyInfo({ e: e.pub, d: this.d.pub, m: key, f }), 64))
        this.keys = { kPhone: okm.subarray(0, 32), kMac: okm.subarray(32) }
        this.send({ t: 'hi', name, platform: 'android', app: '0.1.0' })
        ws.on('message', (raw, binary) => {
          assert.ok(binary, 'only binary frames after the handshake')
          const m = unpack(open(this.keys.kMac, this.got++, raw))
          if (m.t === 'ready') return resolve(m)
          if (m.t === 'reply') {
            const c = this.calls.get(m.id)
            this.calls.delete(m.id)
            return 'error' in m ? c.reject(new Error(m.error)) : c.resolve(m.ok)
          }
          // what a phone does with the state: a patch is for the version after the one it has
          if (m.t === 'state') Object.assign(this, { state: m.state, v: m.v })
          if (m.t === 'patch') {
            assert.equal(m.v, this.v + 1, 'patches come in order')
            Object.assign(this, { state: apply(this.state, m.patch), v: m.v })
          }
          Object.defineProperty(m, 'at', { value: Date.now() }) // when it came, out of the way of deepEqual
          const w = this.waiting.find((x) => x.match(m))
          if (w) (this.waiting = this.waiting.filter((x) => x !== w)), w.resolve(m)
          else this.inbox.push(m)
        })
      })
    })
  }

  send(msg) {
    this.ws.send(seal(this.keys.kPhone, this.sent++, pack(msg)))
  }

  call(name, ...args) {
    const id = ++this.seq
    this.send({ t: 'call', id, name, args })
    return new Promise((resolve, reject) => this.calls.set(id, { resolve, reject }))
  }

  async watch(ws) {
    const { v, state } = await this.call('watch', ws)
    Object.assign(this, { v, state })
    return { v, state }
  }

  // The next message the Mac pushes that matches (already here, or within 3 s).
  next(match = () => true) {
    const i = this.inbox.findIndex(match)
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0])
    return new Promise((resolve, reject) => {
      this.waiting.push({ match, resolve })
      setTimeout(() => reject(new Error('nothing came')), 3000)
    })
  }

  close() {
    this.ws?.terminate()
  }
}

// ---- a Crew to pair with -----------------------------------------------------------------------------------

const BASH = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the tests' }, permission_suggestions: [] }
let crew, runner, remote
const phones = []

before(async () => {
  fs.writeFileSync(CONFIG, JSON.stringify({
    autopilot: true,
    agents: [{ name: 'joseph', area: 'backend', cwd: ROOT, prompt: 'PROMPT-NEVER-ON-A-PHONE' }],
    workspaces: [{ id: 'golf', name: 'Golf', folder: ROOT, members: { joseph: {} }, agents: [{ name: 'kim', area: 'docs', prompt: 'KIM-PROMPT' }] }],
  }))
  crew = new Crew({ bin: BIN, computerName: 'Studio' })
  runner = new FakeRunner()
  crew.runner = runner
  for (const hub of crew.hubs.values()) hub.useRunner(new Scoped(runner, hub.ws, hub.ws === DEFAULT))
  crew.hub.spend.lookedBack = true // nothing of yours to look back through
  Object.assign(crew.settings, { phonePort: await freePort(), port: await freePort() })
  await crew.start()
  await crew.share(true) // so this Mac's own state carries Crew Link's code, with its key
})

after(() => {
  crew.server.close()
  crew.stop()
  for (const h of crew.hubs.values()) h.dispose()
  clearTimeout(crew.changeTimer)
  fs.unwatchFile(CONFIG)
  fs.rmSync(HOME, { recursive: true, force: true })
  fs.rmSync(ROOT, { recursive: true, force: true })
})

beforeEach(async () => {
  crew.phones.devices = []
  crew.phones.save()
  crew.phones.endCode()
  remote = new Remote(crew)
  await remote.start()
})

afterEach(async () => {
  for (const p of phones.splice(0)) p.close()
  remote.stop()
  await sleep(50)
})

const newPhone = () => {
  const p = new Phone()
  phones.push(p)
  return p
}
const macKey = () => unb64(crew.phones.key.pub)

// A code as the app makes it, read back as the phone reads the QR code.
async function code() {
  const made = crew.phones.code({ name: crew.me.name, hosts: ['127.0.0.1'], port: remote.port })
  await remote.sync()
  const c = readPairCode(made.code)
  return { port: c.port, key: c.key, secret: c.secret }
}

async function paired(name) {
  const phone = newPhone()
  const ready = await phone.connect({ ...(await code()), pair: true, name })
  return { phone, ready }
}

// ---- the tests ---------------------------------------------------------------------------------------------

test("this Mac's crypto reproduces shared/vectors.json", () => {
  const { vectors } = JSON.parse(fs.readFileSync(new URL('../../shared/vectors.json', import.meta.url), 'utf8'))
  const bytes = (h) => Buffer.from(h, 'hex')
  for (const v of vectors) {
    for (const n of ['e', 'd', 'm', 'f']) assert.equal(hex(crypto.createPublicKey(privateKey(bytes(v.private[n]))).export({ format: 'der', type: 'spki' }).subarray(-32)), v.public[n])
    const m = { pub: bytes(v.public.m), priv: bytes(v.private.m) }
    const f = { pub: bytes(v.public.f), priv: bytes(v.private.f) }
    const k = macKeys({ m, f, e: bytes(v.public.e), d: bytes(v.public.d), secret: v.secret && bytes(v.secret) })
    assert.equal(hex(k.kPhone), v.kPhone, v.name)
    assert.equal(hex(k.kMac), v.kMac, v.name)
    for (const frame of v.frames) {
      const key = frame.from === 'phone' ? k.kPhone : k.kMac
      assert.equal(hex(seal(key, frame.counter, frame.plaintext)), frame.sealed)
      assert.equal(open(key, frame.counter, bytes(frame.sealed)), frame.plaintext)
    }
    assert.throws(() => open(k.kPhone, 1, bytes(v.frames[0].sealed)), 'a frame out of order does not open')
    assert.throws(() => open(k.kMac, 0, bytes(v.frames[0].sealed)), 'nor one sealed with the other direction')
    assert.equal(b64(m.pub), v.b64.m)
  }
})

test('a pairing code pairs one phone, once, within ten minutes; a new code ends the one before', async () => {
  assert.ok(!remote.server, 'nothing listens until a phone is paired or a code is open')
  const first = await code()
  assert.ok(remote.server)
  const second = await code()
  // the first code's secret no longer opens anything: its phone's hi doesn't open
  await assert.rejects(newPhone().connect({ ...first, pair: true }), { code: CLOSE.badFrame })
  const phone = newPhone()
  const ready = await phone.connect({ ...second, pair: true, name: "Sasha's iPhone" })
  assert.deepEqual(ready.mac, { id: crew.phones.macId, name: 'Studio' })
  assert.deepEqual(crew.phones.devices.map((d) => [d.id, d.name, d.platform, d.app, d.pub]), [[ready.device.id, "Sasha's iPhone", 'android', '0.1.0', b64(phone.d.pub)]])
  assert.equal(crew.phones.open(), null, 'used up')
  await assert.rejects(newPhone().connect({ ...second, pair: true }), { code: CLOSE.noCode })
  // one that ran out
  const third = await code()
  crew.phones.pairing.expires = Date.now() - 1
  await assert.rejects(newPhone().connect({ ...third, pair: true }), { code: CLOSE.noCode })
  // a phone that never paired
  await assert.rejects(newPhone().connect({ port: remote.port, key: macKey() }), { code: CLOSE.notPaired })
  // the paired one comes back without a code
  phone.close()
  assert.equal((await phone.connect({ port: remote.port, key: macKey() })).device.id, ready.device.id)
  // phones.json is yours only; the app sees no keys
  const file = path.join(LINK_DIR, 'phones.json')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['macId', 'key', 'devices'])
  const view = crew.snapshot().computers.phones
  assert.deepEqual(Object.keys(view.devices[0]).sort(), ['app', 'id', 'name', 'online', 'paired', 'platform', 'seen'])
  assert.equal(view.devices[0].online, true)
  assert.ok(!JSON.stringify(view).includes(crew.phones.key.pub))
})

test('removing a phone ends its connection (4003), it is turned away from then on, and the last one gone stops the listening', async () => {
  const a = await paired('Pixel 9')
  const b = await paired("Sasha's iPhone")
  assert.deepEqual(crew.phones.view().devices.map((d) => [d.name, d.online]), [['Pixel 9', true], ["Sasha's iPhone", true]])
  crew.phones.revoke(a.ready.device.id)
  assert.equal(await a.phone.closed, CLOSE.notPaired)
  await assert.rejects(a.phone.connect({ port: remote.port, key: macKey() }), { code: CLOSE.notPaired })
  assert.equal((await b.phone.watch(DEFAULT)).state.workspace.id, DEFAULT, 'the other one carries on')
  crew.phones.revoke(b.ready.device.id)
  assert.equal(await b.phone.closed, CLOSE.notPaired)
  await remote.sync()
  assert.ok(!remote.server)
})

test("a port that's taken: the app says so, and which setting changes it", async () => {
  const taken = net.createServer().listen(remote.port)
  await new Promise((r) => taken.once('listening', r))
  try {
    await code()
    assert.ok(!remote.server)
    assert.match(crew.snapshot().computers.phones.error, /^port \d+ is in use, set another "phonePort" in .*link\.json$/)
    crew.phones.endCode()
    await remote.sync()
    assert.equal(crew.phones.view().error, null, 'nothing listening, nothing to say')
  } finally {
    taken.close()
  }
})

test('an address that keeps failing the handshake waits a minute (4008)', async () => {
  await code()
  for (let i = 0; i < 5; i++) await assert.rejects(newPhone().connect({ port: remote.port, key: macKey() }), { code: CLOSE.notPaired })
  await assert.rejects(newPhone().connect({ port: remote.port, key: macKey() }), { code: CLOSE.tooMany })
})

test('a phone watches a workspace of its own: state without secrets, patches, alerts, answers, and what it sends lands there, whatever the Mac shows', async () => {
  const { phone } = await paired()
  const session = () => [...remote.sessions][0]
  const golf = crew.hubs.get('golf')

  // the state: the Mac's own has Crew Link's code and the agents' instructions; the phone's has neither
  const mine = crew.snapshot()
  assert.match(mine.computers.me.code, /^crew1\./)
  assert.equal(mine.agents.find((a) => a.name === 'joseph').prompt, 'PROMPT-NEVER-ON-A-PHONE')
  const { v, state } = await phone.watch(DEFAULT)
  assert.equal(v, 1)
  const text = JSON.stringify(state)
  assert.ok(!text.includes(mine.computers.me.code) && !text.includes('crew1.'), "never Crew Link's code")
  assert.ok(!text.includes('PROMPT-NEVER-ON-A-PHONE'), 'nor instructions')
  assert.ok(!JSON.stringify(state.agents).includes(ROOT), "nor the agents' folders")
  assert.deepEqual(state.computers, [{ slug: 'studio', name: 'Studio', online: true }])
  for (const a of state.agents) for (const k of ['prompt', 'args', 'images', 'cwd']) assert.ok(!(k in a), k)
  assert.deepEqual(state.providers.claude, { label: 'Claude' })
  assert.deepEqual(Object.keys(state).sort(), ['agents', 'autopilot', 'computers', 'feed', 'parked', 'providers', 'reads', 'spend', 'tasks', 'usage', 'workspace', 'workspaces'])
  assert.deepEqual(state.workspaces.map((w) => w.id), [DEFAULT, 'golf'])

  // changes come as patches, at most one every 200 ms, and turn what the phone has into what the Mac has
  for (let i = 0; i < 4; i++) {
    crew.hub.post({ kind: 'note', from: 'you', text: `standup moved, take ${i}` })
    await sleep(60)
  }
  await sleep(500)
  const patches = phone.inbox.filter((m) => m.t === 'patch')
  assert.ok(patches.length >= 1)
  for (let i = 1; i < patches.length; i++) assert.ok(patches[i].at - patches[i - 1].at >= 180, 'paced')
  assert.ok(patches.every((p) => p.ws === DEFAULT))
  assert.deepEqual(phone.state, session().state)
  assert.deepEqual(phone.state.feed.filter((e) => e.kind === 'note').map((e) => e.text), [0, 1, 2, 3].map((i) => `standup moved, take ${i}`))
  phone.inbox.length = 0

  // a question: its alert, its card, and the answer the agent's hook gets
  const asked = crew.hub.ask('joseph', BASH)
  assert.deepEqual(await phone.next((m) => m.t === 'alert'), { t: 'alert', ws: DEFAULT, name: 'joseph', text: 'wants to run a command: npm test' })
  await sleep(450)
  const card = phone.state.feed.find((e) => e.kind === 'ask' && !e.answer)
  assert.equal(card?.from, 'joseph')
  assert.equal(await phone.call('answer', DEFAULT, card.id, { allow: true }), null)
  assert.equal(JSON.parse(await asked).hookSpecificOutput.decision.behavior, 'allow')
  await assert.rejects(phone.call('answer', DEFAULT, card.id, { allow: true }), /already been answered/)
  await sleep(450)
  assert.equal(phone.state.feed.find((e) => e.id === card.id).answer.by, 'you')

  // what it sends lands in the workspace it names: Golf, while the Mac shows Home...
  assert.equal(crew.current, DEFAULT)
  assert.match(await phone.call('send', 'golf', 'kim', 'write the release notes'), /@kim/)
  assert.ok(golf.feed.some((e) => e.kind === 'msg' && e.from === 'you' && e.to === 'kim' && e.text === 'write the release notes'))
  assert.ok(!crew.hub.feed.some((e) => e.text === 'write the release notes'))
  assert.equal(crew.current, DEFAULT, 'the Mac still shows Home')
  assert.equal(crew.snapshot().workspace.id, DEFAULT)
  // ...and Home while the Mac shows Golf, though joseph works in both
  crew.workspaceAction('switch', 'golf')
  assert.match(await phone.call('send', DEFAULT, 'joseph', 'check the staging API'), /@joseph/)
  assert.ok(crew.hub.feed.some((e) => e.to === 'joseph' && e.text === 'check the staging API'))
  assert.ok(!golf.feed.some((e) => e.text === 'check the staging API'))
  assert.equal(crew.current, 'golf')
  crew.workspaceAction('switch', DEFAULT)
  // the rest of its calls do the same
  await phone.call('set', 'golf', 'kim', { yolo: true })
  await phone.call('read', 'golf', { kim: 1234 })
  assert.equal(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).workspaces[0].agents[0].yolo, true)
  assert.equal(golf.reads.agents.kim, 1234)
  assert.equal(crew.hub.reads.agents.kim, undefined)
  // a notice from another workspace says which
  golf.emit('notice', { title: '#3 is in Review', body: 'kim finished it', focus: 'task:3' })
  assert.deepEqual(await phone.next((m) => m.t === 'notice'), { t: 'notice', ws: 'golf', title: '#3 is in Review', body: 'kim finished it', focus: 'task:3' })

  // watching another workspace: its state, its patches
  const there = await phone.watch('golf')
  assert.equal(there.state.workspace.id, 'golf')
  assert.deepEqual(there.state.agents.map((a) => a.name).sort(), ['joseph', 'kim'])
  assert.ok(there.state.feed.some((e) => e.text === 'write the release notes'))
  assert.ok(!JSON.stringify(there.state).includes('KIM-PROMPT'))
  golf.post({ kind: 'note', from: 'you', text: 'golf only' })
  crew.hub.post({ kind: 'note', from: 'you', text: 'home only' })
  await sleep(450)
  assert.ok(phone.state.feed.some((e) => e.text === 'golf only') && !phone.state.feed.some((e) => e.text === 'home only'))
  assert.deepEqual(phone.state, session().state)
  phone.inbox.length = 0

  // a terminal it asked for, and only that one
  assert.deepEqual(await phone.call('terminal', 'golf', 'kim', true), { data: 'the screen of golf/kim', cols: 100, rows: 30 })
  runner.emit('data', 'golf/kim', 'hello ')
  runner.emit('data', 'joseph', 'not asked for')
  runner.emit('data', 'golf/kim', 'world')
  assert.deepEqual(await phone.next((m) => m.t === 'pty'), { t: 'pty', ws: 'golf', name: 'kim', data: 'hello world' })
  await phone.call('terminal', 'golf', 'kim', false)
  runner.emit('data', 'golf/kim', 'after')
  await sleep(150)
  assert.deepEqual(phone.inbox.filter((m) => m.t === 'pty'), [])

  // photos: saved here, read back; nothing outside Crew's own images
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  const file = await phone.call('saveImage', 'photo.png', 'image/png', png)
  assert.ok(file.startsWith(ATTACHMENTS + path.sep))
  assert.deepEqual(await phone.call('image', file), png)
  for (const bad of [CONFIG, path.join(ATTACHMENTS, '..', 'config.json'), `${ATTACHMENTS}/../link/phones.json`]) await assert.rejects(phone.call('image', bad), /isn't an image from Crew/)

  // what a phone can't do
  for (const name of ['removeAgent', 'workspace', 'in', 'exportAgents', 'link', 'toString', '__proto__']) await assert.rejects(phone.call(name, DEFAULT, 'joseph'), { message: `"${name}" isn't available on a phone` })
  await assert.rejects(phone.call('task', DEFAULT, 'remove', '1'), /isn't a task action on a phone/)
  await assert.rejects(phone.call('send', 'nowhere', '', 'hi'), /no workspace "nowhere"/)

  // its workspace removed: it gets Home's state, whole
  crew.workspaceAction('create', null, { name: 'Side' })
  await phone.watch('side')
  crew.workspaceAction('remove', 'side')
  const back = await phone.next((m) => m.t === 'state')
  assert.equal(back.ws, DEFAULT)
  assert.equal(back.state.workspace.id, DEFAULT)
  assert.equal(crew.current, DEFAULT)
})

test("what a phone can't get away with: being heard once it's removed, files that aren't its photos, a terminal it turned off, a big hello", async () => {
  const { phone, ready } = await paired()
  await phone.watch(DEFAULT)
  // a terminal turned off while it was still being opened stays off
  runner.slow = 100
  const opening = phone.call('terminal', DEFAULT, 'joseph', true)
  await phone.call('terminal', DEFAULT, 'joseph', false)
  await opening
  runner.slow = 0
  runner.emit('data', 'joseph', 'after it was turned off')
  await sleep(150)
  assert.deepEqual(phone.inbox.filter((m) => m.t === 'pty'), [])
  // only photos it saved here go along: Crew would carry any other file to a linked computer
  await assert.rejects(phone.call('send', DEFAULT, 'joseph', 'look', [path.join(LINK_DIR, 'phones.json')]), /isn't one the phone saved here/)
  await assert.rejects(phone.call('task', DEFAULT, 'file', null, { text: 'look', images: [CONFIG] }), /isn't one the phone saved here/)
  await assert.rejects(phone.call('saveImage', 'x', 'constructor', new Uint8Array([1])), /only PNG, JPEG, GIF and WebP/)
  // removed: what it sends from then on isn't done, though it hasn't seen the close yet
  crew.phones.revoke(ready.device.id)
  phone.send({ t: 'call', id: 99, name: 'send', args: [DEFAULT, 'joseph', 'sent after it was removed'] })
  assert.equal(await phone.closed, CLOSE.notPaired)
  await sleep(100)
  assert.ok(!crew.hub.feed.some((e) => e.text === 'sent after it was removed'))
  // a stranger can't send much before the handshake is through, nor keep many handshakes waiting
  await code()
  const big = new WebSocket(`ws://127.0.0.1:${remote.port}`)
  big.on('open', () => big.send('x'.repeat(100 * 1024)))
  assert.equal(await new Promise((r) => big.on('close', r)), 1009)
  const idle = Array.from({ length: 5 }, () => new WebSocket(`ws://127.0.0.1:${remote.port}`))
  const closed = await Promise.race([new Promise((r) => idle[4].on('close', r)), sleep(1000)])
  assert.equal(closed, CLOSE.tooMany)
  idle.forEach((w) => w.terminate())
})

test('stopping while it was about to listen: it stays stopped', async () => {
  crew.phones.code({ name: crew.me.name, hosts: [], port: remote.port })
  remote.stop()
  await remote.sync()
  assert.ok(!remote.server)
})

test('a frame that does not open ends the connection (4006)', async () => {
  const { phone } = await paired()
  phone.sent = 7 // out of order
  phone.send({ t: 'call', id: 1, name: 'watch', args: [DEFAULT] })
  assert.equal(await phone.closed, CLOSE.badFrame)
})

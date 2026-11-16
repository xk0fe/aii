// Your phone (core/phones.js, core/remote.js, shared/PROTOCOL.md): the Mac's crypto against shared/vectors.json, pairing
// codes, and a phone written here (ws + node:crypto, as the CLIque app does it) that pairs, watches, answers, sends and is
// unpaired, against a real CLIque with a fake runner in a throwaway CLIQUE_HOME. Run with `npm test`.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { ELECTRON } from './helpers/platform.mjs'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-phones-'))
process.env.PATH = '/usr/bin:/bin' // no codex to discover once a hub starts
const HOME = process.env.CLIQUE_HOME
const { CONFIG, ATTACHMENTS } = await import('../core/hub.js')
const { Clique, LINK_DIR } = await import('../core/clique.js')
const { Scoped } = await import('../core/runner.js')
const { ROOT } = await import('../core/workspaces.js')
const { Remote, macKeys, seal, open } = await import('../core/remote.js')
const { keyPair, privateKey, publicKey } = await import('../core/phones.js')
const { VERSION, SALT, CLOSE, b64, unb64, utf8, concat, keyInfo, readPairCode, pack, unpack } = await import('../../shared/protocol.js')
const { apply } = await import('../../shared/sync.js')
const BIN = fileURLToPath(new URL('../bin', import.meta.url))
const FOLDERS = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-phones-folders-'))

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

// ---- a phone, as the CLIque app is one ---------------------------------------------------------------------------

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
    const { v, ws: id, state } = await this.call('watch', ws)
    Object.assign(this, { v, state })
    return { v, ws: id, state }
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

// ---- a CLIque to pair with -----------------------------------------------------------------------------------

const BASH = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the tests' }, permission_suggestions: [] }
let clique, runner, remote
const phones = []

before(async () => {
  fs.writeFileSync(CONFIG, JSON.stringify({
    autopilot: true,
    agents: [{ name: 'june', area: 'backend', cwd: FOLDERS, prompt: 'PROMPT-NEVER-ON-A-PHONE' }],
    workspaces: [{ id: 'storefront', name: 'Storefront', folder: FOLDERS, members: { june: {} }, agents: [{ name: 'milo', area: 'docs', prompt: 'MILO-PROMPT' }] }],
  }))
  clique = new Clique({ bin: BIN, computerName: 'Studio' })
  runner = new FakeRunner()
  clique.runner = runner
  for (const hub of clique.hubs.values()) hub.useRunner(new Scoped(runner, hub.ws))
  clique.hubs.get('default').spend.lookedBack = true // nothing of yours to look back through
  Object.assign(clique.settings, { phonePort: await freePort(), port: await freePort() })
  await clique.start()
  await clique.share(true) // so this Mac's own state carries CLIque Link's code, with its key
})

after(() => {
  clique.server.close()
  clique.stop()
  for (const h of clique.hubs.values()) h.dispose()
  clearTimeout(clique.changeTimer)
  fs.unwatchFile(CONFIG)
  fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(FOLDERS, { recursive: true, force: true, maxRetries: 10 })
})

beforeEach(async () => {
  clique.phones.devices = []
  clique.phones.save()
  clique.phones.endCode()
  remote = new Remote(clique)
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
const macKey = () => unb64(clique.phones.key.pub)

// A code as the app makes it, read back as the phone reads the QR code.
async function code() {
  const made = clique.phones.code({ name: clique.me.name, hosts: ['127.0.0.1'], port: remote.port })
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

// CLIque runs in Electron, whose BoringSSL lacks some of what Node's OpenSSL has (ChaCha20-Poly1305, for one, which once
// turned every phone away while these tests passed): the vectors once more, there.
test('…and does so in Electron, where CLIque runs', { skip: !fs.existsSync(ELECTRON) && 'no Electron to run' }, () => {
  const script = `
    import fs from 'node:fs'
    const { macKeys, seal, open } = await import(${JSON.stringify(new URL('../core/remote.js', import.meta.url).href)})
    const { vectors } = JSON.parse(fs.readFileSync(${JSON.stringify(fileURLToPath(new URL('../../shared/vectors.json', import.meta.url)))}, 'utf8'))
    const bytes = (h) => Buffer.from(h, 'hex')
    const out = vectors.map((v) => {
      const k = macKeys({ m: { pub: bytes(v.public.m), priv: bytes(v.private.m) }, f: { pub: bytes(v.public.f), priv: bytes(v.private.f) }, e: bytes(v.public.e), d: bytes(v.public.d), secret: v.secret && bytes(v.secret) })
      return v.frames.map((frame) => {
        const key = frame.from === 'phone' ? k.kPhone : k.kMac
        return [seal(key, frame.counter, frame.plaintext).toString('hex'), open(key, frame.counter, bytes(frame.sealed))]
      })
    })
    console.log(JSON.stringify(out))`
  const got = JSON.parse(execFileSync(ELECTRON, ['--input-type=module', '-e', script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }))
  const { vectors } = JSON.parse(fs.readFileSync(new URL('../../shared/vectors.json', import.meta.url), 'utf8'))
  assert.deepEqual(got, vectors.map((v) => v.frames.map((f) => [f.sealed, f.plaintext])))
})

test('a pairing code pairs one phone, once, within ten minutes; a new code ends the one before', async () => {
  assert.ok(!remote.server, 'nothing listens until a phone is paired or a code is open')
  const first = await code()
  assert.ok(remote.server)
  const second = await code()
  // the first code's secret no longer opens anything: its phone's hi doesn't open
  await assert.rejects(newPhone().connect({ ...first, pair: true }), { code: CLOSE.badFrame })
  const phone = newPhone()
  const ready = await phone.connect({ ...second, pair: true, name: "Ann's iPhone" })
  assert.deepEqual(ready.mac, { id: clique.phones.macId, name: 'Studio' })
  assert.deepEqual(clique.phones.devices.map((d) => [d.id, d.name, d.platform, d.app, d.pub]), [[ready.device.id, "Ann's iPhone", 'android', '0.1.0', b64(phone.d.pub)]])
  assert.equal(clique.phones.open(), null, 'used up')
  await assert.rejects(newPhone().connect({ ...second, pair: true }), { code: CLOSE.noCode })
  // one that ran out
  const third = await code()
  clique.phones.pairing.expires = Date.now() - 1
  await assert.rejects(newPhone().connect({ ...third, pair: true }), { code: CLOSE.noCode })
  // a phone that never paired
  await assert.rejects(newPhone().connect({ port: remote.port, key: macKey() }), { code: CLOSE.notPaired })
  // the paired one comes back without a code
  phone.close()
  assert.equal((await phone.connect({ port: remote.port, key: macKey() })).device.id, ready.device.id)
  // phones.json is yours only; the app sees no keys
  const file = path.join(LINK_DIR, 'phones.json')
  // Windows has no Unix modes (the file is in your own profile there, where only you can read it)
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['macId', 'key', 'devices'])
  const view = clique.snapshot().computers.phones
  assert.deepEqual(Object.keys(view.devices[0]).sort(), ['app', 'id', 'name', 'online', 'paired', 'platform', 'seen'])
  assert.equal(view.devices[0].online, true)
  assert.ok(!JSON.stringify(view).includes(clique.phones.key.pub))
})

test('removing a phone ends its connection (4003), it is turned away from then on, and the last one gone stops the listening', async () => {
  const a = await paired('Pixel 9')
  const b = await paired("Ann's iPhone")
  assert.deepEqual(clique.phones.view().devices.map((d) => [d.name, d.online]), [['Pixel 9', true], ["Ann's iPhone", true]])
  clique.phones.revoke(a.ready.device.id)
  assert.equal(await a.phone.closed, CLOSE.notPaired)
  await assert.rejects(a.phone.connect({ port: remote.port, key: macKey() }), { code: CLOSE.notPaired })
  assert.equal((await b.phone.watch(ROOT)).state.workspace.id, ROOT, 'the other one carries on')
  clique.phones.revoke(b.ready.device.id)
  assert.equal(await b.phone.closed, CLOSE.notPaired)
  await remote.sync()
  assert.ok(!remote.server)
})

test("a port that's taken: the app says so, and which setting changes it", async () => {
  // on the addresses CLIque listens on: Windows lets an IPv4 listener share a port with an IPv6 one
  const taken = net.createServer().listen(remote.port, '0.0.0.0')
  await new Promise((r) => taken.once('listening', r))
  try {
    await code()
    assert.ok(!remote.server)
    assert.match(clique.snapshot().computers.phones.error, /^port \d+ is in use, set another "phonePort" in .*link\.json$/)
    clique.phones.endCode()
    await remote.sync()
    assert.equal(clique.phones.view().error, null, 'nothing listening, nothing to say')
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
  const storefront = clique.hubs.get('storefront')

  // the state: the Mac's own has CLIque Link's code and the agents' instructions; the phone's has neither
  const mine = clique.snapshot()
  assert.match(mine.computers.me.code, /^clique1\./)
  assert.equal(mine.agents.find((a) => a.name === 'june').prompt, 'PROMPT-NEVER-ON-A-PHONE')
  const { v, state } = await phone.watch(ROOT)
  assert.equal(v, 1)
  const text = JSON.stringify(state)
  assert.ok(!text.includes(mine.computers.me.code) && !text.includes('clique1.'), "never CLIque Link's code")
  assert.ok(!text.includes('PROMPT-NEVER-ON-A-PHONE'), 'nor instructions')
  assert.ok(!JSON.stringify(state.agents).includes(FOLDERS), "nor the agents' folders")
  assert.deepEqual(state.computers, [{ slug: 'studio', name: 'Studio', online: true }])
  for (const a of state.agents) for (const k of ['prompt', 'args', 'images', 'cwd']) assert.ok(!(k in a), k)
  assert.deepEqual(state.providers.claude, { label: 'Claude' })
  assert.deepEqual(Object.keys(state).sort(), ['agents', 'autopilot', 'channels', 'computers', 'feed', 'parked', 'providers', 'reads', 'spend', 'tasks', 'usage', 'workspace', 'workspaces'])
  assert.deepEqual(state.channels, [{ id: 'general', name: 'general' }])
  assert.deepEqual(state.workspaces.map((w) => w.id), [ROOT, 'storefront'])

  // changes come as patches, at most one every 200 ms, and turn what the phone has into what the Mac has
  for (let i = 0; i < 4; i++) {
    clique.hubs.get('default').post({ kind: 'note', from: 'you', text: `standup moved, take ${i}` })
    await sleep(60)
  }
  await sleep(500)
  const patches = phone.inbox.filter((m) => m.t === 'patch')
  assert.ok(patches.length >= 1)
  for (let i = 1; i < patches.length; i++) assert.ok(patches[i].at - patches[i - 1].at >= 180, 'paced')
  assert.ok(patches.every((p) => p.ws === ROOT))
  assert.deepEqual(phone.state, session().state)
  assert.deepEqual(phone.state.feed.filter((e) => e.kind === 'note').map((e) => e.text), [0, 1, 2, 3].map((i) => `standup moved, take ${i}`))
  phone.inbox.length = 0

  // a question: its alert, its card, and the answer the agent's hook gets
  const asked = clique.hubs.get('default').ask('june', BASH)
  assert.deepEqual(await phone.next((m) => m.t === 'alert'), { t: 'alert', ws: ROOT, name: 'june', text: 'wants to run a command: npm test' })
  await sleep(450)
  const card = phone.state.feed.find((e) => e.kind === 'ask' && !e.answer)
  assert.equal(card?.from, 'june')
  assert.equal(await phone.call('answer', ROOT, card.id, { allow: true }), null)
  assert.equal(JSON.parse(await asked).hookSpecificOutput.decision.behavior, 'allow')
  await assert.rejects(phone.call('answer', ROOT, card.id, { allow: true }), /already been answered/)
  await sleep(450)
  assert.equal(phone.state.feed.find((e) => e.id === card.id).answer.by, 'you')

  // what it sends lands in the workspace it names: Storefront, while the Mac shows Home...
  assert.equal(clique.current, ROOT)
  assert.match(await phone.call('send', 'storefront', 'milo', 'write the release notes'), /@milo/)
  assert.ok(storefront.feed.some((e) => e.kind === 'msg' && e.from === 'you' && e.to === 'milo' && e.text === 'write the release notes'))
  assert.ok(!clique.hubs.get('default').feed.some((e) => e.text === 'write the release notes'))
  assert.equal(clique.current, ROOT, 'the Mac still shows Home')
  assert.equal(clique.snapshot().workspace.id, ROOT)
  // ...and Home while the Mac shows Storefront, though june works in both
  clique.workspaceAction('switch', 'storefront')
  assert.match(await phone.call('send', ROOT, 'june', 'check the staging API'), /@june/)
  assert.ok(clique.hubs.get('default').feed.some((e) => e.to === 'june' && e.text === 'check the staging API'))
  assert.ok(!storefront.feed.some((e) => e.text === 'check the staging API'))
  assert.equal(clique.current, 'storefront')
  clique.workspaceAction('switch', ROOT)
  // the rest of its calls do the same
  await phone.call('set', 'storefront', 'milo', { yolo: true })
  await phone.call('read', 'storefront', { milo: 1234 })
  assert.equal(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).workspaces.find((w) => w.id === 'storefront').agents[0].yolo, true)
  assert.equal(storefront.reads.agents.milo, 1234)
  assert.equal(clique.hubs.get('default').reads.agents.milo, undefined)
  // a notice from another workspace says which
  storefront.emit('notice', { title: '#3 is in Review', body: 'milo finished it', focus: 'task:3' })
  assert.deepEqual(await phone.next((m) => m.t === 'notice'), { t: 'notice', ws: 'storefront', title: '#3 is in Review', body: 'milo finished it', focus: 'task:3' })

  // watching another workspace: its state, its patches
  const there = await phone.watch('storefront')
  assert.equal(there.state.workspace.id, 'storefront')
  assert.deepEqual(there.state.agents.map((a) => a.name).sort(), ['june', 'milo'])
  assert.ok(there.state.feed.some((e) => e.text === 'write the release notes'))
  assert.ok(!JSON.stringify(there.state).includes('MILO-PROMPT'))
  storefront.post({ kind: 'note', from: 'you', text: 'storefront only' })
  clique.hubs.get('default').post({ kind: 'note', from: 'you', text: 'home only' })
  await sleep(450)
  assert.ok(phone.state.feed.some((e) => e.text === 'storefront only') && !phone.state.feed.some((e) => e.text === 'home only'))
  assert.deepEqual(phone.state, session().state)
  phone.inbox.length = 0

  // channels: the phone makes one, says something in it, changes it and deletes it; the list follows in the state
  assert.deepEqual(await phone.call('channel', 'storefront', 'create', null, { name: 'Ship It', brief: 'Release work only.', members: ['milo'], extra: 'ignored' }), { id: 'ship-it' })
  await sleep(450)
  assert.deepEqual(phone.state.channels, [{ id: 'general', name: 'general' }, { id: 'ship-it', name: 'ship-it', brief: 'Release work only.', members: ['milo'] }])
  assert.match(await phone.call('send', 'storefront', 'milo', 'notes for 1.2?', [], { channel: 'ship-it' }), /@milo/)
  assert.equal(storefront.feed.findLast((e) => e.from === 'you').channel, 'ship-it')
  await phone.call('channel', 'storefront', 'edit', 'ship-it', { brief: 'Release work.', members: null })
  assert.deepEqual(storefront.channel('ship-it'), { id: 'ship-it', name: 'ship-it', brief: 'Release work.' })
  await assert.rejects(phone.call('channel', 'storefront', 'remove', 'general'), /can't be removed/)
  await assert.rejects(phone.call('channel', 'storefront', 'rename', 'ship-it'), /"rename" isn't a channel action/)
  await assert.rejects(phone.call('channel', 'nowhere', 'create', null, { name: 'x' }), /no workspace "nowhere"/)
  await phone.call('channel', 'storefront', 'remove', 'ship-it')
  await assert.rejects(phone.call('send', 'storefront', 'milo', 'still there?', [], { channel: 'ship-it' }), /that channel is gone/)
  await sleep(450)
  assert.deepEqual(phone.state.channels.map((c) => c.id), ['general'])
  assert.ok(!JSON.stringify(phone.state).includes('clique1.'), 'a channel change sends no snapshot with the Link code')
  phone.inbox.length = 0

  // a terminal it asked for, and only that one
  assert.deepEqual(await phone.call('terminal', 'storefront', 'milo', true), { data: 'the screen of storefront/milo', cols: 100, rows: 30 })
  runner.emit('data', 'storefront/milo', 'hello ')
  runner.emit('data', 'june', 'not asked for')
  runner.emit('data', 'storefront/milo', 'world')
  assert.deepEqual(await phone.next((m) => m.t === 'pty'), { t: 'pty', ws: 'storefront', name: 'milo', data: 'hello world' })
  await phone.call('terminal', 'storefront', 'milo', false)
  runner.emit('data', 'storefront/milo', 'after')
  await sleep(150)
  assert.deepEqual(phone.inbox.filter((m) => m.t === 'pty'), [])

  // photos: saved here, read back; nothing outside CLIque's own images
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  const file = await phone.call('saveImage', 'photo.png', 'image/png', png)
  assert.ok(file.startsWith(ATTACHMENTS + path.sep))
  assert.deepEqual(await phone.call('image', file), png)
  for (const bad of [CONFIG, path.join(ATTACHMENTS, '..', 'config.json'), `${ATTACHMENTS}/../link/phones.json`]) await assert.rejects(phone.call('image', bad), /isn't an image from CLIque/)
  // what an agent attached is in the same folder (core/attachments.js): a recording, a page or a log never comes down
  // the phone's connection, whatever a phone asks for by path, nor a picture too big for it
  for (const name of ['2026-11-16-aaaaaaaa-clip.mp4', '2026-11-16-aaaaaaaa-demo.html', '2026-11-16-aaaaaaaa-run.log']) {
    fs.writeFileSync(path.join(ATTACHMENTS, name), 'x')
    await assert.rejects(phone.call('image', path.join(ATTACHMENTS, name)), /isn't an image a phone can show: open it on the computer/)
  }
  const big = path.join(ATTACHMENTS, '2026-11-16-aaaaaaaa-huge.png')
  fs.writeFileSync(big, '')
  fs.truncateSync(big, 20 * 1024 * 1024 + 1)
  await assert.rejects(phone.call('image', big), /isn't an image a phone can show/)
  fs.rmSync(big)

  // what a phone can't do
  for (const name of ['removeAgent', 'workspace', 'in', 'exportAgents', 'link', 'toString', '__proto__']) await assert.rejects(phone.call(name, ROOT, 'june'), { message: `"${name}" isn't available on a phone` })
  await assert.rejects(phone.call('task', ROOT, 'remove', '1'), /isn't a task action on a phone/)
  await assert.rejects(phone.call('send', 'nowhere', '', 'hi'), /no workspace "nowhere"/)

  // none named (a phone that hasn't picked one): the one on this computer's screen, and the reply says which
  const any = await phone.watch('')
  assert.equal(any.ws, clique.current)
  assert.equal(any.state.workspace.id, clique.current)

  // its workspace removed: it gets the one on this computer's screen, whole
  clique.workspaceAction('create', null, { name: 'Side', show: false })
  await phone.watch('side')
  clique.workspaceAction('remove', 'side')
  const back = await phone.next((m) => m.t === 'state')
  assert.equal(back.ws, clique.current)
  assert.equal(back.state.workspace.id, clique.current)
})

test('a computer with no workspace left: the phone gets an empty state, and the first one as soon as there is one', async () => {
  const { phone } = await paired()
  const before = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
  await phone.watch('')
  const ids = clique.workspaces().map((w) => w.id)
  for (const id of ids) clique.workspaceAction('remove', id)
  const none = await phone.next((m) => m.t === 'state' && m.ws === null)
  assert.equal(none.state.workspace, null)
  assert.deepEqual([none.state.workspaces, none.state.agents], [[], []])
  // asking again is fine too, and says so
  const asked = await phone.watch('')
  assert.deepEqual([asked.ws, asked.state.workspace], [null, null])
  await assert.rejects(phone.call('send', '', 'june', 'hi'), /no workspace ""/)
  clique.workspaceAction('create', null, { name: 'Fresh' })
  const first = await phone.next((m) => m.t === 'state' && m.ws === 'fresh')
  assert.equal(first.state.workspace.id, 'fresh')
  // as it was, for the tests after this one
  fs.writeFileSync(CONFIG, JSON.stringify(before))
  clique.config.load()
  await phone.next((m) => m.t === 'state' && m.ws !== 'fresh')
})

test("what a phone can't get away with: being heard once it's removed, files that aren't its photos, a terminal it turned off, a big hello", async () => {
  const { phone, ready } = await paired()
  await phone.watch(ROOT)
  // a terminal turned off while it was still being opened stays off
  runner.slow = 100
  const opening = phone.call('terminal', ROOT, 'june', true)
  await phone.call('terminal', ROOT, 'june', false)
  await opening
  runner.slow = 0
  runner.emit('data', 'june', 'after it was turned off')
  await sleep(150)
  assert.deepEqual(phone.inbox.filter((m) => m.t === 'pty'), [])
  // only photos it saved here go along: CLIque would carry any other file to a linked computer
  await assert.rejects(phone.call('send', ROOT, 'june', 'look', [path.join(LINK_DIR, 'phones.json')]), /isn't one the phone saved here/)
  await assert.rejects(phone.call('task', ROOT, 'file', null, { text: 'look', images: [CONFIG] }), /isn't one the phone saved here/)
  await assert.rejects(phone.call('saveImage', 'x', 'constructor', new Uint8Array([1])), /only PNG, JPEG, GIF and WebP/)
  // removed: what it sends from then on isn't done, though it hasn't seen the close yet
  clique.phones.revoke(ready.device.id)
  phone.send({ t: 'call', id: 99, name: 'send', args: [ROOT, 'june', 'sent after it was removed'] })
  assert.equal(await phone.closed, CLOSE.notPaired)
  await sleep(100)
  assert.ok(!clique.hubs.get('default').feed.some((e) => e.text === 'sent after it was removed'))
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
  clique.phones.code({ name: clique.me.name, hosts: [], port: remote.port })
  remote.stop()
  await remote.sync()
  assert.ok(!remote.server)
})

test('a frame that does not open ends the connection (4006)', async () => {
  const { phone } = await paired()
  phone.sent = 7 // out of order
  phone.send({ t: 'call', id: 1, name: 'watch', args: [ROOT] })
  assert.equal(await phone.closed, CLOSE.badFrame)
})

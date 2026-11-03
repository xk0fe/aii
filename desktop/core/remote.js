// Crew on your phone (shared/PROTOCOL.md): where phones connect. A plain WebSocket on PORT, listening only while a phone
// is paired or a pairing code is open for one. Each connection starts with a handshake that proves both sides hold their
// keys (and, when pairing, the code's secret), and everything after it is encrypted end to end, so the same frames can
// later go through a relay. A phone then watches one workspace of its own choosing (its state, then patches), makes the
// calls in CALLS there, follows the terminals it asks for, and hears every alert and notice. What it does lands in the
// workspace it names, never in the one this Mac shows just because it's on screen.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { WebSocketServer, WebSocket } from 'ws'
import { ATTACHMENTS } from './hub.js'
import { CACHE, LINK_DIR } from './crew.js'
import { DEFAULT } from './workspaces.js'
import { keyPair, privateKey, publicKey } from './phones.js'
import { VERSION, PORT, SALT, CLOSE, CALLS, TASK_OPS, b64, unb64, utf8, concat, keyInfo, nonce } from 'crew-shared/protocol.js'
import { diff } from 'crew-shared/sync.js'

const TRIES = 5 // failed handshakes from one address within a minute, before it waits a minute (CLOSE.tooMany)
const WAIT = 60000
const GREETING = 4 // connections still in the handshake, from one address (a phone makes one to each of the Mac's) and
const GREETING_ALL = 32 // in all
const HELLO_MAX = 16 * 1024 // what a connection may send before the handshake is through: its hello and hi are tiny
const MAX = 32 * 1024 * 1024 // and after it: a photo is megabytes
const PACE = 200 // a phone gets at most one patch this often
const BATCH = 50 // and terminal output in batches this long

// ---- the crypto (PROTOCOL.md, Handshake): node:crypto for the keys, @noble/ciphers for the frames ------------------

const dh = (priv, pub) => crypto.diffieHellman({ privateKey: privateKey(priv), publicKey: publicKey(pub) })

// This Mac's side of the key derivation: its key m and this connection's f ({ pub, priv }, raw), the phone's e and d
// (public, raw), and the code's secret when pairing. -> { kPhone, kMac }
export function macKeys({ m, f, e, d, secret }) {
  const ikm = concat(dh(m.priv, e), dh(m.priv, d), dh(f.priv, e), secret ?? new Uint8Array(0))
  const okm = Buffer.from(crypto.hkdfSync('sha256', ikm, utf8(SALT), keyInfo({ e, d, m: m.pub, f: f.pub }), 64))
  return { kPhone: okm.subarray(0, 32), kMac: okm.subarray(32) }
}

// A frame: ChaCha20-Poly1305 with its direction's key and counter, the tag after the ciphertext. Not node:crypto's:
// Electron's BoringSSL has no ChaCha20-Poly1305 ("Unknown cipher" in Crew, though not under plain Node or in the tests).
export function seal(key, counter, text) {
  return Buffer.from(chacha20poly1305(key, nonce(counter)).encrypt(utf8(text)))
}

// -> its text; throws for a frame that doesn't open (tampered with, another key, or out of order)
export function open(key, counter, frame) {
  if (frame.length < 16) throw new Error('too short')
  return Buffer.from(chacha20poly1305(key, nonce(counter)).decrypt(frame)).toString('utf8')
}

// Messages as shared/protocol.js packs them (bytes as { $bytes: base64url }), with Node's own base64: a photo is
// megabytes.
const pack = (v) => JSON.stringify(v, (_, x) => (x instanceof Uint8Array ? { $bytes: Buffer.from(x).toString('base64url') } : x))
const unpack = (s) => JSON.parse(s, (_, x) => (x && typeof x === 'object' && typeof x.$bytes === 'string' ? new Uint8Array(Buffer.from(x.$bytes, 'base64url')) : x))

// ---- what a phone sees ---------------------------------------------------------------------------------------

// A workspace's snapshot (Crew.snapshot) as a phone gets it (PROTOCOL.md, "The state a phone gets"). Only what's named
// here goes, so nothing added to a snapshot later reaches a phone by accident. Never Crew Link's pairing code
// (computers.me.code holds its secret key) or an agent's instructions; nor the agents' own folders, flags and reference
// images, or the agent editor's lists, which a phone doesn't show.
export function phoneState(s) {
  const { parked, autopilot, feed, reads, usage, spend, tasks, workspace, workspaces } = s
  return {
    parked, autopilot, feed, reads, usage, spend, tasks, workspace, workspaces,
    agents: s.agents.map(({ prompt, args, images, cwd, ...a }) => a),
    providers: Object.fromEntries(Object.entries(s.providers).map(([id, p]) => [id, { label: p.label }])),
    // this computer first, then the linked ones
    computers: [s.computers.me, ...s.computers.links].map(({ slug, name, online = true }) => ({ slug, name, online })),
  }
}

// Where a file really is, so no `..` or link leads out of a folder; null when it isn't there.
const real = (p) => {
  try {
    return fs.realpathSync(path.resolve(String(p)))
  } catch {
    return null
  }
}
const inside = (file, ...dirs) => dirs.some((dir) => real(dir) && file.startsWith(real(dir) + path.sep))

// An image from the chat or a task: only from Crew's attachments, or its cache of linked computers' images.
function image(file) {
  const at = real(file)
  if (!at) throw new Error('that image is gone')
  if (!inside(at, ATTACHMENTS, CACHE)) throw new Error("that isn't an image from CLIque")
  return new Uint8Array(fs.readFileSync(at))
}

// Images a phone sends along: only ones it saved here (saveImage). Crew sends a linked computer whatever file it's
// given, so anything else could carry any file of yours there, and back to the phone through the cache.
function attached(images) {
  return [].concat(images ?? []).map((p) => {
    const at = real(p)
    if (!at || !inside(at, ATTACHMENTS)) throw new Error("that image isn't one the phone saved here")
    return path.resolve(String(p))
  })
}

// Close, and drop the connection a moment later if the other side doesn't close too. Nothing it sends meanwhile is
// heard (Session.receive).
function end(ws, code, why) {
  ws.close(code, why)
  setTimeout(() => ws.terminate(), 1000).unref?.()
}

// ---- the endpoint -----------------------------------------------------------------------------------------

export class Remote {
  sessions = new Set() // phones connected, past the handshake
  greeting = new Map() // address -> its connections still in the handshake
  fails = new Map() // address -> { times, until }: handshakes that failed in the last minute

  // crew: the Crew (core/crew.js), whose phones (core/phones.js) are the ones that may connect.
  constructor(crew) {
    this.crew = crew
    this.phones = crew.phones
    const on = (from, event, fn) => (from.on(event, fn), () => from.off(event, fn))
    this.unhook = [
      on(this.phones, 'change', () => this.sync()),
      on(crew, 'state', () => this.sessions.forEach((s) => s.changed())),
      on(crew, 'terminal', (ws, name, data) => this.sessions.forEach((s) => s.output(ws, name, data))),
      on(crew, 'alert', (name, text, ws) => this.tell({ t: 'alert', ws, name, text })),
      // your accounts' limits are no workspace's: those come without one
      on(crew, 'notice', ({ title, body, focus, workspace }) => this.tell({ t: 'notice', ws: workspace, title, body, focus })),
    ]
  }

  // "phonePort" in link.json, else the protocol's
  get port() {
    return Number(this.crew.settings.phonePort) || PORT
  }

  start() {
    return this.sync()
  }

  stop() {
    this.stopped = true // a sync already on its way doesn't listen again
    this.unhook.forEach((off) => off())
    this.close()
  }

  // Listening only while it's needed: while a phone is paired, or a code is open for one to pair with. Resolves once
  // that's so (or phones.error says why it can't be; not listening, there's nothing to say).
  sync() {
    this.syncing = (this.syncing ?? Promise.resolve()).catch(() => {}).then(async () => {
      const wanted = !this.stopped && (this.phones.devices.length > 0 || Boolean(this.phones.open()))
      if (wanted && !this.server) await this.listen()
      if (!wanted && this.server) this.close()
      if (!wanted) this.problem(null)
    })
    return this.syncing
  }

  // The WebSocket server only once the port is ours: ws passes the server's errors on as its own, and a port in use
  // would be an uncaught one.
  async listen() {
    const port = this.port
    const server = http.createServer((_, res) => res.writeHead(426).end('Crew speaks WebSocket to phones\n'))
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '0.0.0.0', resolve)
      })
    } catch (e) {
      return this.problem(e.code === 'EADDRINUSE' ? `port ${port} is in use, set another "phonePort" in ${path.join(LINK_DIR, 'link.json')}` : e.message)
    }
    if (this.stopped) return server.close()
    const wss = new WebSocketServer({ server, maxPayload: MAX })
    wss.on('error', () => {})
    wss.on('connection', (ws, req) => this.welcome(ws, req.socket.remoteAddress))
    Object.assign(this, { server, wss })
    this.problem(null)
  }

  close() {
    for (const ws of this.wss?.clients ?? []) end(ws, 1001, 'Crew stopped listening for phones')
    this.wss?.close()
    this.server?.close()
    this.server = this.wss = null
  }

  problem(error) {
    if (this.phones.error === error) return
    this.phones.error = error
    this.phones.changed()
  }

  tell(msg) {
    for (const s of this.sessions) s.send(msg)
  }

  // A new connection has a few seconds for the handshake (PROTOCOL.md): a phone proves it holds its key, plus the
  // code's secret when it pairs, and finds out it's talking to this Mac.
  welcome(ws, address) {
    ws.on('error', () => {})
    const greeting = this.greeting.get(address) ?? 0
    const busy = greeting >= GREETING || [...this.greeting.values()].reduce((n, x) => n + x, 0) >= GREETING_ALL
    if (busy || this.fails.get(address)?.until > Date.now()) return end(ws, CLOSE.tooMany, 'too many tries, wait a minute')
    this.greeting.set(address, greeting + 1)
    let greeted = false
    const through = () => {
      if (greeted) return
      greeted = true
      clearTimeout(timer)
      const n = this.greeting.get(address) - 1
      n ? this.greeting.set(address, n) : this.greeting.delete(address)
    }
    const timer = setTimeout(() => ws.terminate(), 10000)
    ws.once('close', through)
    // ws has no public way to change one connection's limit, and a stranger's hello needn't be 32 MB
    if (ws._receiver) ws._receiver._maxPayload = HELLO_MAX
    const fail = (code, why) => {
      through()
      if (code !== CLOSE.version) this.failed(address)
      end(ws, code, why)
    }
    ws.once('message', (raw, binary) => {
      let hello, e, d
      try {
        hello = binary ? null : JSON.parse(raw.toString())
        ;[e, d] = [unb64(hello.e), unb64(hello.d)]
      } catch {}
      if (hello?.t !== 'hello') return fail(CLOSE.badFrame, 'expected hello')
      if (hello.v !== VERSION) return fail(CLOSE.version, 'a different version, update both')
      if (e?.length !== 32 || d?.length !== 32) return fail(CLOSE.badFrame, 'expected two keys')
      const pairing = hello.pair ? this.phones.open() : null
      const known = hello.pair ? null : this.phones.find(d)
      if (hello.pair && !pairing) return fail(CLOSE.noCode, 'no pairing code is open')
      if (!hello.pair && !known) return fail(CLOSE.notPaired, 'not paired')
      const m = { pub: unb64(this.phones.key.pub), priv: unb64(this.phones.key.priv) }
      const f = keyPair()
      let keys
      try {
        keys = macKeys({ m, f, e, d, secret: pairing?.secret })
      } catch {
        return fail(CLOSE.badFrame, 'expected two keys') // one an X25519 key can't agree with
      }
      ws.send(JSON.stringify({ t: 'welcome', v: VERSION, f: b64(f.pub) }))
      ws.once('message', (raw, binary) => {
        let hi
        try {
          hi = binary ? JSON.parse(open(keys.kPhone, 0, raw)) : null
        } catch {}
        if (hi?.t !== 'hi') return fail(CLOSE.badFrame, "that frame didn't open")
        // a code pairs one phone: one that got this far with it as well is too late
        if (pairing && this.phones.open() !== pairing) return fail(CLOSE.noCode, 'that code has been used')
        if (known && !this.phones.devices.includes(known)) return fail(CLOSE.notPaired, 'not paired')
        through()
        if (ws._receiver) ws._receiver._maxPayload = MAX
        this.fails.delete(address)
        const device = pairing ? this.phones.add(d, hi) : known
        this.sessions.add(new Session(this, ws, device, keys, hi))
      })
    })
  }

  // A handshake that failed: an address that fails TRIES times within a minute waits a minute before it's heard again.
  failed(address) {
    const now = Date.now()
    for (const [a, f] of this.fails) if (now - f.times.at(-1) > WAIT && !(f.until > now)) this.fails.delete(a)
    const times = [...(this.fails.get(address)?.times ?? []).filter((t) => now - t < WAIT), now]
    this.fails.set(address, { times, until: times.length >= TRIES ? now + WAIT : 0 })
  }
}

// ---- one phone, connected -----------------------------------------------------------------------------------

class Session {
  sent = 0 // frames each way so far, each one's nonce (the phone's first was its hi)
  got = 1
  v = 0 // the version of the state the phone has
  watching = null // the workspace it watches, and its state as the phone has it
  state = null
  patched = 0 // when it last got a patch
  terms = new Map() // the terminals it follows (workspace\0name -> true, or the request still getting its buffer), and
  out = new Map() // their output waiting to go

  constructor(remote, ws, device, keys, hi) {
    Object.assign(this, { remote, crew: remote.crew, ws, device, keys })
    const gone = remote.phones.connected(device, () => end(ws, CLOSE.notPaired, 'unpaired'), hi)
    ws.on('message', (raw, binary) => this.receive(raw, binary))
    ws.on('close', () => {
      clearTimeout(this.patchTimer)
      clearTimeout(this.outTimer)
      remote.sessions.delete(this)
      gone()
    })
    this.send({ t: 'ready', mac: { id: remote.phones.macId, name: this.crew.me.name }, device: { id: device.id } })
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(seal(this.keys.kMac, this.sent++, pack(msg)))
  }

  // Only while the connection is open: once it's closing (the phone unpaired, a frame that didn't open, Crew stopping
  // to listen), nothing more it sends is done.
  async receive(raw, binary) {
    if (this.ws.readyState !== WebSocket.OPEN) return
    let m
    try {
      if (!binary) throw new Error('text after the handshake')
      m = unpack(open(this.keys.kPhone, this.got++, raw))
    } catch {
      return end(this.ws, CLOSE.badFrame, "that frame didn't open")
    }
    if (m?.t !== 'call') return
    try {
      this.send({ t: 'reply', id: m.id, ok: (await this.call(String(m.name), Array.isArray(m.args) ? m.args : [])) ?? null })
    } catch (e) {
      this.send({ t: 'reply', id: m.id, error: e.message })
    }
  }

  // What a phone may ask (CALLS), each in the workspace it names. It's you: what it sends is yours in the chat.
  call(name, args) {
    const crew = this.crew
    const hub = (ws) => {
      const h = crew.hubs.get(ws)
      if (!h) throw new Error(`${crew.me.name} has no workspace "${ws}"`)
      return h
    }
    const calls = {
      watch: (ws) => this.watch(hub(ws)),
      send: (ws, to, text, images, opts) => crew.send(to ?? '', text, attached(images), { fresh: Boolean(opts?.fresh), re: opts?.re }, hub(ws)),
      answer: (ws, id, reply) => crew.feedAction(id, 'answer', [reply ?? {}], hub(ws)),
      approve: (ws, id) => crew.feedAction(id, 'approve', [], hub(ws)),
      drop: (ws, id) => crew.feedAction(id, 'drop', [], hub(ws)),
      read: (ws, seen) => hub(ws).read(seen),
      task: (ws, op, key, arg) => {
        if (!TASK_OPS.includes(op)) throw new Error(`"${op}" isn't a task action on a phone`)
        return crew.ticket(op, key, arg?.images ? { ...arg, images: attached(arg.images) } : arg, hub(ws))
      },
      power: (ws, name, on) => crew.update(name, { off: !on }, hub(ws)),
      set: (ws, name, { yolo, fast } = {}) => crew.update(name, { ...(yolo !== undefined && { yolo: Boolean(yolo) }), ...(fast !== undefined && { tier: fast ? 'fast' : 'default' }) }, hub(ws)),
      freshStart: (ws, name) => crew.at(name, 'freshStart', [], hub(ws)),
      restart: (ws, name) => crew.at(name, 'restart', [], hub(ws)),
      markIdle: (ws, name) => crew.at(name, 'markIdle', [], hub(ws)),
      image: (file) => image(file),
      saveImage: (name, type, bytes) => {
        if (!(bytes instanceof Uint8Array)) throw new Error('send the image as bytes')
        return crew.hub.saveImage(String(name ?? ''), type, bytes)
      },
      terminal: (ws, name, on) => this.terminal(hub(ws), String(name), on),
      input: (ws, name, data) => crew.input(name, String(data ?? ''), hub(ws)),
    }
    if (!CALLS.includes(name) || !Object.hasOwn(calls, name)) throw new Error(`"${name}" isn't available on a phone`)
    return calls[name](...args)
  }

  // As it is now, as JSON goes: what's kept here is what the phone has, untouched by the hubs changing theirs in place.
  view(hub) {
    return JSON.parse(JSON.stringify(phoneState(this.crew.snapshot(hub))))
  }

  watch(hub) {
    this.watching = hub.ws
    this.state = this.view(hub)
    return { v: ++this.v, state: this.state }
  }

  // Something changed: the phone gets what changed in its workspace, at most once every PACE ms.
  changed() {
    if (!this.watching || this.patchTimer) return
    this.patchTimer = setTimeout(() => this.patch(), Math.max(0, this.patched + PACE - Date.now()))
  }

  patch() {
    this.patchTimer = null
    const hub = this.crew.hubs.get(this.watching)
    if (!hub) {
      // its workspace is gone: it gets the default's, whole
      this.watch(this.crew.hub)
      return this.send({ t: 'state', ws: DEFAULT, v: this.v, state: this.state })
    }
    const next = this.view(hub)
    const patch = diff(this.state, next)
    if (!patch) return
    this.state = next
    this.patched = Date.now()
    this.send({ t: 'patch', ws: hub.ws, v: ++this.v, patch })
  }

  // Follow a terminal (on: replies with what it printed so far, as the app's buffer) or stop.
  async terminal(hub, name, on) {
    const key = `${hub.ws}\0${name}`
    const asked = Symbol(key)
    this.out.delete(key)
    if (!on) return this.terms.delete(key), null
    this.terms.set(key, asked)
    const buffer = await this.crew.at(name, 'buffer', [], hub)
    // only now (what came before is in the buffer), and only if it wasn't turned off, or asked for again, meanwhile
    if (this.terms.get(key) === asked) this.terms.set(key, true)
    return buffer
  }

  output(ws, name, data) {
    const key = `${ws}\0${name}`
    if (this.terms.get(key) !== true) return
    this.out.set(key, (this.out.get(key) ?? '') + data)
    this.outTimer ??= setTimeout(() => {
      this.outTimer = null
      for (const [key, data] of this.out) {
        const [ws, name] = key.split('\0')
        this.send({ t: 'pty', ws, name, data })
      }
      this.out.clear()
    }, BATCH)
  }
}

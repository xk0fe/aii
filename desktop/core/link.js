// Crew Link: your computers' crews, as one. Each computer runs its own agents; a link between two computers
// is one connection over which both share theirs, so every computer sees (and can talk to) the whole crew.
// The channel is TLS with a self-signed certificate that the pairing code pins, and the secret key in the code
// is only sent after the certificate checks out, so it stays private even on shared networks.
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { WebSocketServer, WebSocket } from 'ws'

export const PROTOCOL = 2
export const DEFAULT_PORT = 7787

// A computer's short name, as agents on it are addressed from elsewhere: gal@mac-mini.
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'computer'

// ---- identity: a certificate + key per host, made once ----------------------------------------------

// Made here, not by openssl, which Windows doesn't have. One an older Crew made with openssl is kept, so the computers
// linked to this one keep their code, as long as TLS here can use it: macOS's own openssl (LibreSSL) wrote the curve
// out in full, which Electron's BoringSSL can't read, so sharing never started with one of those and nothing can have
// linked to it. That one is replaced.
export function identity(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const certFile = path.join(dir, 'cert.pem')
  const keyFile = path.join(dir, 'key.pem')
  const saved = usable(certFile, keyFile)
  if (saved) return saved
  const made = selfSigned('crew-link')
  fs.writeFileSync(keyFile, made.key, { mode: 0o600 })
  fs.writeFileSync(certFile, made.cert)
  return usable(certFile, keyFile)
}

// The saved certificate and key, if there are both and this runtime's TLS takes them; null if not.
function usable(certFile, keyFile) {
  let cert, key
  try {
    cert = fs.readFileSync(certFile, 'utf8')
    key = fs.readFileSync(keyFile, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e // there but unreadable: not a reason to make a new one, which would need a new code
  }
  try {
    tls.createSecureContext({ cert, key })
    return { cert, key, fingerprint: new crypto.X509Certificate(cert).fingerprint256 }
  } catch {
    return null
  }
}

// A self-signed X.509 certificate for a new P-256 key, valid for ten years: what `openssl req -x509 -newkey ec` made.
// The pairing code pins its fingerprint, so nothing checks more of it than that it's well formed. -> { cert, key } (PEM)
export function selfSigned(name, { days = 3650, now = new Date() } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const serial = crypto.randomBytes(16)
  serial[0] = serial[0] & 0x7f || 1 // positive, and no leading zero byte
  const ecdsaWithSha256 = seq(oid('1.2.840.10045.4.3.2'))
  const who = seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from(name))))) // CN=name
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))), // v3
    der(0x02, serial),
    ecdsaWithSha256,
    who,
    seq(time(now), time(new Date(now.getTime() + days * 864e5))),
    who,
    publicKey.export({ type: 'spki', format: 'der' }),
  )
  const signature = crypto.sign('sha256', tbs, privateKey) // DER, as X.509 has it
  const body = seq(tbs, ecdsaWithSha256, der(0x03, Buffer.concat([Buffer.from([0]), signature])))
  const pem = `-----BEGIN CERTIFICATE-----\n${body.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`
  return { cert: pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }
}

// Just enough DER for that certificate.
function der(tag, ...parts) {
  const body = Buffer.concat(parts)
  const n = body.length
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]
  return Buffer.concat([Buffer.from([tag, ...len]), body])
}
const seq = (...parts) => der(0x30, ...parts)
const set = (...parts) => der(0x31, ...parts)
function oid(dotted) {
  const [a, b, ...rest] = dotted.split('.').map(Number)
  const out = [40 * a + b]
  for (let n of rest) {
    const bytes = [n & 0x7f]
    while ((n >>= 7)) bytes.unshift(0x80 | (n & 0x7f))
    out.push(...bytes)
  }
  return der(0x06, Buffer.from(out))
}
// UTCTime up to 2049, GeneralizedTime after, as X.509 wants it
function time(d) {
  const s = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'
  return d.getUTCFullYear() < 2050 ? der(0x17, Buffer.from(s.slice(2))) : der(0x18, Buffer.from(s))
}

// ---- pairing codes ----------------------------------------------------------------------------------

// Every address this machine can be reached on: Wi-Fi/Ethernet and Tailscale (100.64.0.0/10).
export async function addresses() {
  const out = []
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const [x, y] = a.address.split('.').map(Number)
      out.push({ address: a.address, via: x === 100 && y >= 64 && y < 128 ? 'Tailscale' : iface.startsWith('en') ? 'Wi-Fi / Ethernet' : iface })
    }
  }
  try {
    const status = await new Promise((resolve, reject) => execFile('tailscale', ['status', '--json'], { timeout: 3000 }, (e, out) => (e ? reject(e) : resolve(out))))
    const self = JSON.parse(status).Self ?? {}
    for (const ip of self.TailscaleIPs ?? []) if (ip.includes('.') && !out.some((o) => o.address === ip)) out.push({ address: ip, via: 'Tailscale' })
    const name = self.DNSName?.replace(/\.$/, '')
    if (name) out.push({ address: name, via: 'Tailscale name' })
  } catch {}
  return out
}

export const makeCode = ({ name, port, key, fingerprint, hosts }) =>
  'crew1.' + Buffer.from(JSON.stringify({ n: name, p: port, k: key, f: fingerprint, h: hosts })).toString('base64url')

export function readCode(code) {
  const m = String(code ?? '').trim().match(/^crew1\.([\w-]+)$/)
  if (!m) throw new Error("that's not a Crew pairing code")
  const c = JSON.parse(Buffer.from(m[1], 'base64url').toString())
  return { name: c.n, port: c.p, key: c.k, fingerprint: c.f, hosts: c.h }
}

// Messages are JSON; bytes (images) travel as { $bytes: base64 }.
const pack = (v) => JSON.stringify(v, (_, x) => (x instanceof Uint8Array ? { $bytes: Buffer.from(x).toString('base64') } : x))
const unpack = (s) => JSON.parse(s, (_, x) => (x && typeof x === 'object' && typeof x.$bytes === 'string' ? new Uint8Array(Buffer.from(x.$bytes, 'base64')) : x))

const closedWhy = (code, host) =>
  new Error(code === 4003 ? 'the pairing code was reset on the other computer, get a new one' : code === 4004 ? 'the other computer runs a different Crew version, update both' : `${host}: closed`)

// ---- a peer: one live connection, the same on both ends --------------------------------------------

// Either side can call() the other (answered by its `handle`), push() its crew's state / terminal output /
// alerts, and type into the other's terminals with input(). Emits 'state', 'space', 'spaces', 'pty', 'alert', 'input',
// 'close'.
export class Peer extends EventEmitter {
  pending = new Map()
  seq = 0

  constructor(ws, name, handle) {
    super()
    Object.assign(this, { ws, name, handle })
    ws.on('message', (raw) => this.receive(raw))
    ws.on('close', () => {
      for (const p of this.pending.values()) p.reject(new Error(`lost the connection to ${this.name}`))
      this.pending.clear()
      this.emit('close')
    })
    ws.on('error', () => {})
  }

  async receive(raw) {
    let m
    try {
      m = unpack(raw.toString())
    } catch {
      return
    }
    if (m.t === 'state') this.emit('state', m.state)
    else if (m.t === 'space') this.emit('space', m.id, m.state) // one of its other workspaces (an older Crew never sends it)
    else if (m.t === 'spaces') this.emit('spaces', m.ids) // which workspaces it has now
    else if (m.t === 'pty') this.emit('pty', m.name, m.data)
    else if (m.t === 'alert') this.emit('alert', m.name, m.text)
    else if (m.t === 'input') this.emit('input', m.name, m.data)
    else if (m.t === 'reply') {
      const p = this.pending.get(m.id)
      this.pending.delete(m.id)
      if (p) m.error ? p.reject(new Error(m.error)) : p.resolve(m.ok)
    } else if (m.t === 'call') {
      try {
        this.send({ t: 'reply', id: m.id, ok: await this.handle(m.name, m.args ?? []) })
      } catch (e) {
        this.send({ t: 'reply', id: m.id, error: e.message })
      }
    }
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(pack(msg))
  }

  call(name, args = []) {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`not connected to ${this.name}`))
    const id = ++this.seq
    this.send({ t: 'call', id, name, args })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => this.pending.delete(id) && reject(new Error(`${this.name} took too long to answer`)), 200000)
    })
  }

  push(t, ...args) {
    this.send(t === 'state' ? { t, state: args[0] } : t === 'space' ? { t, id: args[0], state: args[1] } : t === 'spaces' ? { t, ids: args[0] } : t === 'pty' || t === 'input' ? { t, name: args[0], data: args[1] } : { t, name: args[0], text: args[1] })
  }

  input(name, data) {
    this.push('input', name, data)
  }

  close() {
    this.ws.close()
  }
}

// ---- sharing: accept computers that have the pairing code ------------------------------------------

// Emits 'peer' (peer) for every computer that proves it has the key.
export class LinkHost extends EventEmitter {
  constructor({ key, cert, keyPem, name, handle }) {
    super()
    Object.assign(this, { key, cert, keyPem, name, handle })
  }

  start(port) {
    this.server = https.createServer({ cert: this.cert, key: this.keyPem }, (_, res) => res.writeHead(426).end('Crew Link speaks WebSocket\n'))
    this.wss = new WebSocketServer({ server: this.server, maxPayload: 32 * 1024 * 1024 })
    this.wss.on('connection', (ws) => this.welcome(ws))
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, '0.0.0.0', () => resolve(this))
    })
  }

  stop() {
    for (const ws of this.wss?.clients ?? []) ws.close(1001, 'sharing stopped')
    this.wss?.close()
    this.server?.close()
  }

  // A computer has 5 seconds to prove it has the key, which it only sends after verifying our certificate.
  welcome(ws) {
    const timer = setTimeout(() => ws.close(4001, 'no key'), 5000)
    ws.once('message', (raw) => {
      clearTimeout(timer)
      let m
      try {
        m = unpack(raw.toString())
      } catch {
        return ws.close(4002, 'bad message')
      }
      const ok = m.t === 'auth' && typeof m.key === 'string' && m.key.length === this.key.length && crypto.timingSafeEqual(Buffer.from(m.key), Buffer.from(this.key))
      if (!ok) return ws.close(4003, 'wrong key')
      if (m.protocol !== PROTOCOL) return ws.close(4004, 'different version')
      ws.send(pack({ t: 'hello', protocol: PROTOCOL, name: this.name })) // first, before anything else reaches it
      this.emit('peer', new Peer(ws, String(m.name || 'computer'), this.handle))
    })
  }
}

// ---- connecting: a computer we have the code for ----------------------------------------------------

// Keeps reconnecting until closed. Emits 'peer' (peer) on every successful connection and 'status' changes.
export class LinkClient extends EventEmitter {
  status = { connected: false }
  closed = false

  constructor(code, { name, handle }) {
    super()
    this.code = readCode(code)
    Object.assign(this, { myName: name, handle })
  }

  setStatus(s) {
    this.status = s
    this.emit('status', s)
  }

  // Try every address in the code at once; the first one with the certificate the code pinned wins, and only that one
  // is sent the key. (Sending it on every address that answered left the other computer with a connection per address,
  // and when the slower ones were dropped here, it dropped this computer along with them.)
  async connect() {
    this.closed = false
    const { hosts, port } = this.code
    this.trying = []
    try {
      const { ws, address } = await Promise.any(hosts.map((h) => this.attempt(h, port)))
      for (const other of this.trying) if (other !== ws) other.terminate() // slower addresses that also answered
      const { name, early, keep } = await this.greet(ws, address)
      ws.off('message', keep)
      const peer = new Peer(ws, name, this.handle)
      for (const raw of early) peer.receive(raw) // anything the other side sent right after saying hello
      peer.on('close', () => {
        if (this.closed) return
        this.setStatus({ connected: false, error: 'reconnecting…' })
        this.retry = setTimeout(() => this.connect(), 2000)
      })
      this.setStatus({ connected: true, address })
      this.emit('peer', peer)
    } catch (e) {
      // the most telling reason wins: an impostor, a revoked code, a version mismatch, then plain unreachable
      const why = ['certificate', 'reset', 'version'].map((w) => (e.errors ?? [e]).find((x) => x.message.includes(w))?.message).find(Boolean) ?? "couldn't reach it on any address"
      this.setStatus({ connected: false, error: why })
      if (!this.closed) this.retry = setTimeout(() => this.connect(), 4000)
    }
  }

  // A connection to one address, once its certificate checks out (nothing secret has been sent yet).
  attempt(host, port) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://${host}:${port}`, { rejectUnauthorized: false, handshakeTimeout: 4000, maxPayload: 32 * 1024 * 1024 })
      this.trying.push(ws)
      // Before anything secret is sent: is this the certificate the pairing code pinned?
      ws.on('upgrade', (res) => {
        if (res.socket.getPeerCertificate?.().fingerprint256 !== this.code.fingerprint) {
          ws.terminate()
          reject(new Error(`${host} answered with a different certificate, not connecting`))
        }
      })
      ws.on('open', () => resolve({ ws, address: host }))
      ws.on('close', (code) => reject(closedWhy(code, host)))
      ws.on('error', (e) => reject(e))
    })
  }

  // The key, on the connection that won: the other computer says hello, or closes saying why not.
  greet(ws, host) {
    return new Promise((resolve, reject) => {
      ws.send(pack({ t: 'auth', key: this.code.key, protocol: PROTOCOL, name: this.myName }))
      ws.once('message', (raw) => {
        const m = unpack(raw.toString())
        if (m.t !== 'hello') return reject(new Error('unexpected reply'))
        const early = []
        const keep = (r) => early.push(r)
        ws.on('message', keep)
        resolve({ name: m.name, early, keep })
      })
      ws.on('close', (code) => reject(closedWhy(code, host)))
    })
  }

  close() {
    this.closed = true
    clearTimeout(this.retry)
    for (const ws of this.trying ?? []) ws.terminate()
  }
}

// Crew Link: your computers' crews, as one. Each computer runs its own agents; a link between two computers
// is one connection over which both share theirs, so every computer sees (and can talk to) the whole crew.
// The channel is TLS with a self-signed certificate that the pairing code pins, and the secret key in the code
// is only sent after the certificate checks out, so it stays private even on shared networks.
import { EventEmitter } from 'node:events'
import { execFile, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'

export const PROTOCOL = 2
export const DEFAULT_PORT = 7787

// A computer's short name, as agents on it are addressed from elsewhere: gal@mac-mini.
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'computer'

// ---- identity: a certificate + key per host, made once with openssl --------------------------

export function identity(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const certFile = path.join(dir, 'cert.pem')
  const keyFile = path.join(dir, 'key.pem')
  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', keyFile, '-out', certFile, '-days', '3650', '-subj', '/CN=crew-link'], { stdio: 'ignore' })
    fs.chmodSync(keyFile, 0o600)
  }
  const cert = fs.readFileSync(certFile, 'utf8')
  return { cert, key: fs.readFileSync(keyFile, 'utf8'), fingerprint: new crypto.X509Certificate(cert).fingerprint256 }
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

// ---- a peer: one live connection, the same on both ends --------------------------------------------

// Either side can call() the other (answered by its `handle`), push() its crew's state / terminal output /
// alerts, and type into the other's terminals with input(). Emits 'state', 'pty', 'alert', 'input', 'close'.
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
    this.send(t === 'state' ? { t, state: args[0] } : t === 'pty' || t === 'input' ? { t, name: args[0], data: args[1] } : { t, name: args[0], text: args[1] })
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

  // Try every address in the code at once; the first one that proves it's the right computer wins.
  async connect() {
    this.closed = false
    const { hosts, port } = this.code
    this.trying = []
    try {
      const { ws, address, name, early, keep } = await Promise.any(hosts.map((h) => this.attempt(h, port)))
      for (const other of this.trying) if (other !== ws) other.terminate() // slower addresses that also answered
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
      const why = ['certificate', 'reset', 'version'].map((w) => e.errors?.find((x) => x.message.includes(w))?.message).find(Boolean) ?? "couldn't reach it on any address"
      this.setStatus({ connected: false, error: why })
      if (!this.closed) this.retry = setTimeout(() => this.connect(), 4000)
    }
  }

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
      ws.on('open', () => {
        ws.send(pack({ t: 'auth', key: this.code.key, protocol: PROTOCOL, name: this.myName }))
        ws.once('message', (raw) => {
          const m = unpack(raw.toString())
          if (m.t !== 'hello') return reject(new Error('unexpected reply'))
          const early = []
          const keep = (r) => early.push(r)
          ws.on('message', keep)
          resolve({ ws, address: host, name: m.name, early, keep })
        })
      })
      ws.on('close', (code) =>
        reject(new Error(code === 4003 ? 'the pairing code was reset on the other computer, get a new one' : code === 4004 ? 'the other computer runs a different Crew version, update both' : `${host}: closed`)),
      )
      ws.on('error', (e) => reject(e))
    })
  }

  close() {
    this.closed = true
    clearTimeout(this.retry)
    for (const ws of this.trying ?? []) ws.terminate()
  }
}

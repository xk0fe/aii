// Crew Link: use one computer's crew from another, over your Wi-Fi or Tailscale.
// The host keeps the agents, terminals and history; other computers get a live window into them.
// The channel is TLS with a self-signed certificate that the pairing code pins, and the secret key in
// the code is only sent after the certificate checks out, so it stays private even on shared networks.
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'

export const PROTOCOL = 1
export const DEFAULT_PORT = 7787

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
export function addresses() {
  const out = []
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const [x, y] = a.address.split('.').map(Number)
      out.push({ address: a.address, via: x === 100 && y >= 64 && y < 128 ? 'Tailscale' : iface.startsWith('en') ? 'Wi-Fi / Ethernet' : iface })
    }
  }
  try {
    const self = JSON.parse(execFileSync('tailscale', ['status', '--json'], { timeout: 3000 })).Self ?? {}
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

// Messages are JSON; bytes (pasted images) travel as { $bytes: base64 }.
const pack = (v) => JSON.stringify(v, (_, x) => (x instanceof Uint8Array ? { $bytes: Buffer.from(x).toString('base64') } : x))
const unpack = (s) => JSON.parse(s, (_, x) => (x && typeof x === 'object' && typeof x.$bytes === 'string' ? new Uint8Array(Buffer.from(x.$bytes, 'base64')) : x))

// ---- host ---------------------------------------------------------------------------------------------

// backend: { call(name, args), input(name, data), snapshot(), on('state'|'pty'|'alert') }, allowed: action names
export class LinkHost extends EventEmitter {
  clients = new Set()

  constructor({ backend, allowed, key, cert, keyPem, name }) {
    super()
    Object.assign(this, { backend, allowed: new Set(allowed), key, cert, keyPem, name })
    this.forward = {
      state: (state) => this.broadcast({ t: 'state', state }),
      pty: (name, data) => this.broadcast({ t: 'pty', name, data }),
      alert: (name, text) => this.broadcast({ t: 'alert', name, text }),
    }
  }

  start(port) {
    this.server = https.createServer({ cert: this.cert, key: this.keyPem }, (_, res) => res.writeHead(426).end('Crew Link speaks WebSocket\n'))
    this.wss = new WebSocketServer({ server: this.server, maxPayload: 32 * 1024 * 1024 })
    this.wss.on('connection', (ws, req) => this.welcome(ws, req))
    for (const [event, fn] of Object.entries(this.forward)) this.backend.on(event, fn)
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, '0.0.0.0', () => resolve(this))
    })
  }

  stop() {
    for (const [event, fn] of Object.entries(this.forward)) this.backend.off(event, fn)
    for (const ws of this.clients) ws.close(1001, 'sharing stopped')
    this.wss?.close()
    this.server?.close()
    this.clients.clear()
    this.emit('clients', 0)
  }

  // A client has 5 seconds to prove it has the key, sent only after it verified our certificate.
  welcome(ws, req) {
    const who = req.socket.remoteAddress
    const timer = setTimeout(() => ws.close(4001, 'no key'), 5000)
    let authed = false
    ws.on('message', async (raw) => {
      let m
      try {
        m = unpack(raw.toString())
      } catch {
        return ws.close(4002, 'bad message')
      }
      if (!authed) {
        const ok = m.t === 'auth' && typeof m.key === 'string' && m.key.length === this.key.length && crypto.timingSafeEqual(Buffer.from(m.key), Buffer.from(this.key))
        if (!ok) return ws.close(4003, 'wrong key')
        clearTimeout(timer)
        authed = true
        ws.send(pack({ t: 'hello', protocol: PROTOCOL, name: this.name })) // first, before any broadcast reaches it
        this.clients.add(ws)
        this.emit('clients', this.clients.size, who)
        ws.send(pack({ t: 'state', state: this.backend.snapshot() }))
        return
      }
      if (m.t === 'input') return this.backend.input(m.name, m.data)
      if (m.t !== 'call') return
      try {
        if (!this.allowed.has(m.name)) throw new Error(`"${m.name}" isn't available over Crew Link`)
        ws.send(pack({ t: 'reply', id: m.id, ok: await this.backend.call(m.name, m.args ?? []) }))
      } catch (e) {
        ws.send(pack({ t: 'reply', id: m.id, error: e.message }))
      }
    })
    ws.on('close', () => {
      clearTimeout(timer)
      if (this.clients.delete(ws)) this.emit('clients', this.clients.size)
    })
  }

  broadcast(msg) {
    if (!this.clients.size) return
    const data = pack(msg)
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data)
  }
}

// ---- client -------------------------------------------------------------------------------------------

// Emits 'state', 'pty', 'alert' like a local hub, plus 'status' ({ connected, address, error }).
export class LinkClient extends EventEmitter {
  pending = new Map()
  seq = 0
  ws = null
  closed = false

  constructor(code) {
    super()
    this.code = readCode(code)
  }

  // Try every address in the code at once; the first one that proves it's the right host wins.
  async connect() {
    this.closed = false
    const { hosts, port } = this.code
    this.trying = []
    try {
      const { ws, address } = await Promise.any(hosts.map((h) => this.attempt(h, port)))
      for (const other of this.trying) if (other !== ws) other.terminate() // slower addresses that also answered
      this.adopt(ws, address)
    } catch (e) {
      // the most telling reason wins: an impostor, a revoked code, a version mismatch, then plain unreachable
      const why = ['certificate', 'reset', 'version'].map((w) => e.errors?.find((x) => x.message.includes(w))?.message).find(Boolean) ?? "couldn't reach it on any address"
      this.emit('status', { connected: false, error: why })
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
        ws.send(pack({ t: 'auth', key: this.code.key }))
        const hello = (raw) => {
          const m = unpack(raw.toString())
          if (m.t !== 'hello') return // anything else waits until we're adopted
          ws.off('message', hello)
          if (m.protocol !== PROTOCOL) return reject(new Error('the host runs a different Crew version, update both'))
          this.emit('hello', m)
          resolve({ ws, address: host })
        }
        ws.on('message', hello)
      })
      ws.on('close', (code) => reject(new Error(code === 4003 ? 'the pairing code was reset on the host, get a new one' : `${host}: closed`)))
      ws.on('error', (e) => reject(e))
    })
  }

  adopt(ws, address) {
    this.ws = ws
    this.emit('status', { connected: true, address })
    ws.on('message', (raw) => {
      const m = unpack(raw.toString())
      if (m.t === 'state') this.emit('state', m.state)
      else if (m.t === 'pty') this.emit('pty', m.name, m.data)
      else if (m.t === 'alert') this.emit('alert', m.name, m.text)
      else if (m.t === 'reply') {
        const p = this.pending.get(m.id)
        this.pending.delete(m.id)
        if (p) m.error ? p.reject(new Error(m.error)) : p.resolve(m.ok)
      }
    })
    ws.on('close', (code) => {
      for (const p of this.pending.values()) p.reject(new Error('lost the connection to the host'))
      this.pending.clear()
      this.ws = null
      if (this.closed) return
      this.emit('status', { connected: false, error: code === 4003 ? 'the pairing code was reset on the host' : 'reconnecting…' })
      this.retry = setTimeout(() => this.connect(), 2000)
    })
    ws.on('error', () => {})
    // Ask for the full picture now that we're listening (a push sent before this point may have been missed).
    this.call('state').then((state) => this.emit('state', state), () => {})
  }

  call(name, args = []) {
    if (!this.ws) return Promise.reject(new Error(`not connected to ${this.code.name}`))
    const id = ++this.seq
    this.ws.send(pack({ t: 'call', id, name, args }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => this.pending.delete(id) && reject(new Error('the host took too long to answer')), 200000)
    })
  }

  input(name, data) {
    this.ws?.send(pack({ t: 'input', name, data }))
  }

  close() {
    this.closed = true
    clearTimeout(this.retry)
    this.ws?.close()
  }
}

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

// A computer's short name, as agents on it are addressed from elsewhere: iris@workstation.
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

// Every address this machine can be reached on: Wi-Fi/Ethernet and Tailscale (100.64.0.0/10). -> [{ address, via,
// iface? }] (iface: the network interface's own name, for firewallWarning)
export async function addresses({ interfaces = os.networkInterfaces(), platform = process.platform, tailscale = tailscaleSelf } = {}) {
  const out = []
  for (const [iface, list] of Object.entries(interfaces)) {
    for (const a of list ?? []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal) continue
      const via = interfaceLabel(iface, a.address, platform)
      if (via) out.push({ address: a.address, via, iface })
    }
  }
  const self = await tailscale(platform).catch(() => null)
  if (self) {
    for (const ip of self.TailscaleIPs ?? []) if (ip.includes('.') && !out.some((o) => o.address === ip)) out.push({ address: ip, via: 'Tailscale' })
    const name = self.DNSName?.replace(/\.$/, '')
    if (name) out.push({ address: name, via: 'Tailscale name' })
  }
  return out
}

const TAILSCALE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./ // 100.64.0.0/10, the addresses Tailscale gives out
// Windows' networks it makes up itself: a virtual machine's, WSL's or Docker's (vEthernet, VirtualBox, VMware), a Wi-Fi
// hotspot or Wi-Fi Direct (Local Area Connection*), Bluetooth, loopback adapters (VPNs and packet capture install them)
const VIRTUAL = /vEthernet|Hyper-V|\bWSL\b|VirtualBox|VMware|VMnet|Docker|Loopback|Npcap|Bluetooth|Local Area Connection\*/i

// What a network interface is called in the app (Wi-Fi, Ethernet, Tailscale), or null when it's one no other
// computer reaches this one on. macOS names its interfaces en0, en1 (Wi-Fi or Ethernet); Windows gives them names
// people chose or recognise ("Wi-Fi", "Ethernet 2", "WLAN" in German).
export function interfaceLabel(iface, address, platform = process.platform) {
  if (TAILSCALE.test(address)) return 'Tailscale'
  if (platform !== 'win32') return iface.startsWith('en') ? 'Wi-Fi / Ethernet' : iface
  if (VIRTUAL.test(iface) || address.startsWith('169.254.')) return null // 169.254: no network gave it an address
  if (/^(Wi-?Fi|WLAN|Wireless)/i.test(iface)) return 'Wi-Fi'
  if (/^Ethernet/i.test(iface)) return 'Ethernet'
  return iface
}

// This computer as Tailscale sees it (its status's Self), or null without Tailscale or while it's off. Its CLI is on
// PATH on Windows and with Homebrew's; the Mac app has it inside, and Windows' installer puts it in Program Files
// (which a Crew started before Tailscale was installed doesn't have on its PATH).
export async function tailscaleSelf(platform = process.platform) {
  const tries = ['tailscale', ...(platform === 'darwin' ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'] : []),
    ...(platform === 'win32' ? [path.win32.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')] : [])]
  for (const cli of tries) {
    let out
    try {
      // windowsHide: a console window would flash up every time otherwise
      out = await new Promise((resolve, reject) => execFile(cli, ['status', '--json'], { timeout: 3000, windowsHide: true }, (e, o) => (e ? reject(e) : resolve(o))))
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES') continue // not this one
      return null // there, but it isn't running (or isn't logged in)
    }
    const status = JSON.parse(out)
    return status.BackendState && status.BackendState !== 'Running' ? null : (status.Self ?? null)
  }
  return null
}

// ---- Windows Firewall: can other computers get in? -------------------------------------------------------

// Crew listens on every network while it shares this computer (or a phone is paired), and Windows Firewall lets
// connections in only where a rule says so. The installer adds one for Private and Domain networks; without one,
// Windows asks the first time Crew listens. Neither covers Public networks, which is what Windows makes a network
// unless you've said it's yours. -> a sentence saying what to do, or null when nothing says the way in is shut
// (anything it can't tell counts as open: if Windows hasn't decided, it asks).
export async function firewallWarning(hosts, { platform = process.platform, program = process.execPath, query = firewallState } = {}) {
  if (platform !== 'win32') return null
  const state = await query(program).catch(() => null)
  try {
    return state ? reachWarning(hosts, state) : null
  } catch {
    return null // PowerShell said something else than expected
  }
}

// The same, from what Windows says about it: nets [{ alias, category }] (its networks, by interface name, and
// Public, Private or DomainAuthenticated), walls [{ name, on }] (the firewall for each kind of network: True, False
// or NotConfigured) and rules [{ action, profile }] (the inbound rules for this program that are on: Allow or Block,
// for "Any" or a list like "Domain, Private").
export function reachWarning(hosts, { nets = [], walls = [], rules = [] } = {}) {
  const list = (x) => [].concat(x ?? []).filter(Boolean)
  const kind = new Map(list(nets).map((n) => [String(n.alias), { DomainAuthenticated: 'Domain', Private: 'Private', Public: 'Public' }[n.category]]))
  const covers = (r, profile) => /\bany\b/i.test(r.profile) || String(r.profile).split(/,\s*/).includes(profile)
  const allowed = (profile) => !list(rules).some((r) => r.action === 'Block' && covers(r, profile)) && list(rules).some((r) => r.action === 'Allow' && covers(r, profile))
  const blocked = new Map() // what it's called -> the kind of network
  const exposed = new Set()
  for (const h of hosts) {
    const profile = h.iface && kind.get(h.iface)
    if (!profile || list(walls).find((w) => w.name === profile)?.on === 'False') continue // its firewall is off
    // a rule that says no (someone said no when Windows asked, or left Public unticked); or a Public network no rule
    // lets it in on, when Crew has rules (so they'd have been found), as with the installer's
    const mine = list(rules).filter((r) => covers(r, profile))
    if (!mine.some((r) => r.action === 'Block') && !(profile === 'Public' && list(rules).length && !mine.some((r) => r.action === 'Allow'))) continue
    // a public network where a private one would do is better made private than opened up
    if (profile === 'Public' && allowed('Private')) exposed.add(h.via)
    else blocked.set(h.via, profile)
  }
  const and = (names) => [...new Set(names)].join(' and ')
  if (blocked.size) return `Windows Firewall blocks Crew on ${and(blocked.keys())}, so your other computers and phones can't reach this one there. To let them in, open Windows Security > Firewall & network protection > Allow an app through firewall > Change settings, and tick ${and(blocked.values())} next to Crew.`
  if (exposed.size) {
    const where = [...exposed].map((v) => (v === 'Wi-Fi' ? 'Wi-Fi > your network' : v)).join(' or ')
    return `Windows treats ${and(exposed)} as a public network, where its firewall keeps your other computers and phones out. If it's your own network, make it private: Settings > Network & internet > ${where} > Network profile type > Private network.`
  }
  return null
}

// What Windows says (see reachWarning), from PowerShell, which every Windows since 8 has; looked up at most every two
// minutes, as Get-NetFirewallApplicationFilter can take a few seconds. One line, no double quotes, so it goes as
// itself to -Command (not -EncodedCommand, which virus scanners look at twice); Crew's exe comes in CREW_PROGRAM.
const FIREWALL = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  '$nets = @(Get-NetConnectionProfile | ForEach-Object { @{ alias = [string]$_.InterfaceAlias; category = [string]$_.NetworkCategory } })',
  '$walls = @(Get-NetFirewallProfile | ForEach-Object { @{ name = [string]$_.Name; on = [string]$_.Enabled } })',
  "$rules = @(Get-NetFirewallApplicationFilter -Program $env:CREW_PROGRAM | Get-NetFirewallRule | Where-Object { [string]$_.Enabled -eq 'True' -and [string]$_.Direction -eq 'Inbound' } | ForEach-Object { @{ action = [string]$_.Action; profile = [string]$_.Profile } })",
  'ConvertTo-Json -Compress -Depth 3 -InputObject @{ nets = $nets; walls = $walls; rules = $rules }',
].join('; ')
let firewallSeen = { at: 0, program: null, state: null }

export async function firewallState(program) {
  if (firewallSeen.program === program && Date.now() - firewallSeen.at < 120000) return firewallSeen.state
  const args = ['-NoProfile', '-NonInteractive', '-Command', FIREWALL]
  let state = null // and not asked again for a while either, when PowerShell can't say
  try {
    const out = await new Promise((resolve, reject) =>
      execFile('powershell.exe', args, { timeout: 20000, windowsHide: true, env: { ...process.env, CREW_PROGRAM: program } }, (e, o) => (e ? reject(e) : resolve(o))))
    state = JSON.parse(out.replace(/^\uFEFF/, '').trim())
  } catch {}
  firewallSeen = { at: Date.now(), program, state }
  return state
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

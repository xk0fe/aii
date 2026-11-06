// Nearby: the other computers on this network that have Computers open too, so linking one is a click instead of a code
// to copy across. While the sheet is open, each computer says who it is (a beacon, broadcast on the local network every
// second and a half) and listens for the others'. A beacon has nothing secret in it: a name, how many agents, the port
// Crew Link listens on and its certificate's fingerprint. Linking still takes a person at both computers, who checks
// that both show the same code (core/link.js, PairClient). Tailscale doesn't carry broadcasts: there, it's a code.
// No Electron in here.
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import dgram from 'node:dgram'
import os from 'node:os'

export const DISCOVER_PORT = 7789 // UDP; Crew Link is TCP 7787 and phones TCP 7788
const EVERY = 1500
const GONE = 5000 // a computer whose beacons stop (its sheet closed, it slept, it left the Wi-Fi) leaves the list
const TAILSCALE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./

// Where beacons go: each network's own broadcast address (192.168.0.255 on 192.168.0.x/24), Tailscale's left out, and
// 255.255.255.255, which macOS refuses outright when it keeps Crew off the local network (that's how it's told).
export function broadcastTargets({ interfaces = os.networkInterfaces(), port = DISCOVER_PORT } = {}) {
  const out = new Set()
  for (const list of Object.values(interfaces)) {
    for (const a of list ?? []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal || TAILSCALE.test(a.address) || a.address.startsWith('169.254.')) continue
      const ip = a.address.split('.').map(Number)
      const mask = a.netmask.split('.').map(Number)
      out.add(ip.map((b, i) => (b | (~mask[i] & 255)) & 255).join('.'))
    }
  }
  return [...out, '255.255.255.255'].map((address) => ({ address, port }))
}

// Is macOS letting this app onto the local network? -> 'granted', 'blocked' or 'unknown' (no network to tell by). The
// same tell as Discovery's below, once. The first time it's asked, this send is what makes macOS put up its question, so
// nothing should call it before you've been told why (core/permissions.js).
export function probeLocalNetwork({ targets = () => broadcastTargets(), createSocket = () => dgram.createSocket({ type: 'udp4' }) } = {}) {
  return new Promise((resolve) => {
    const socket = createSocket()
    const finish = (answer) => {
      try {
        socket.close()
      } catch {}
      resolve(answer)
    }
    socket.on('error', () => finish('unknown'))
    socket.bind(0, async () => {
      try {
        socket.setBroadcast(true)
        const list = targets()
        const results = await Promise.all(list.map((t) => new Promise((done) => socket.send(Buffer.from('{}'), t.port, t.address, (e) => done({ t, e })))))
        if (results.length < 2) return finish('unknown') // only the limited broadcast: no network of its own to send from
        const blocked = results.find((r) => r.t.address === '255.255.255.255')?.e?.code === 'EHOSTUNREACH'
        finish(blocked ? 'blocked' : 'granted')
      } catch {
        finish('unknown')
      }
    })
  })
}

// beacon() -> what to say about this computer now: { name, agents, port, fingerprint }. Emits 'change' when a computer
// appears, goes, or says something new, and 'blocked' (true/false) when macOS starts or stops keeping it off the network.
export class Discovery extends EventEmitter {
  id = crypto.randomBytes(8).toString('hex') // this run's, so its own beacons are known
  // key -> { id: key, name, platform, agents, port, fingerprint, address, seen }. The key is the beacon's id and its
  // certificate together: beacons aren't signed, so one reusing another computer's id with its own certificate is a
  // computer of its own on the list (two of the same name, which the sheet tells apart), never a change to that one.
  found = new Map()
  blocked = false

  constructor({ beacon, port = DISCOVER_PORT, targets = () => broadcastTargets({ port }), platform = process.platform, now = Date.now }) {
    super()
    Object.assign(this, { beacon, port, targets, platform, now })
  }

  start() {
    if (this.socket) return Promise.resolve(this)
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket
    socket.on('message', (raw, from) => this.heard(raw, from))
    socket.on('error', () => {}) // a network that comes and goes; the next beacon tries again
    return new Promise((resolve) => {
      socket.once('error', () => resolve(this)) // the port taken by something that doesn't share it: it still says its beacons
      socket.bind(this.port, () => {
        try {
          socket.setBroadcast(true)
        } catch {}
        this.say()
        this.timer = setInterval(() => (this.say(), this.prune()), EVERY)
        this.timer.unref?.()
        resolve(this)
      })
    })
  }

  stop() {
    clearInterval(this.timer)
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    this.found.clear()
    // a goodbye, so the others drop this computer now rather than in a few seconds
    this.send(socket, { bye: true, fingerprint: this.beacon().fingerprint }).finally(() => socket.close())
  }

  list() {
    return [...this.found.values()]
  }

  get(id) {
    return this.found.get(id)
  }

  say() {
    if (this.socket) this.send(this.socket, this.beacon())
  }

  // One beacon to every target; the ones macOS refuses say whether it's keeping this computer off the network.
  async send(socket, body) {
    const msg = Buffer.from(JSON.stringify({ app: 'clique', v: 1, id: this.id, platform: this.platform, ...body }))
    const results = await Promise.all(this.targets().map((t) => new Promise((resolve) => {
      try {
        socket.send(msg, t.port, t.address, (e) => resolve({ t, e }))
      } catch (e) {
        resolve({ t, e })
      }
    })))
    if (this.platform !== 'darwin' || body.bye) return
    // macOS turns 255.255.255.255 down at once when Local Network is off for this app (other networks' broadcasts
    // can look sent and go nowhere); a computer with no network at all has no address to send from either
    const limited = results.find((r) => r.t.address === '255.255.255.255')
    const blocked = limited?.e?.code === 'EHOSTUNREACH' && results.length > 1
    if (blocked !== this.blocked) {
      this.blocked = blocked
      this.emit('blocked', blocked)
    }
  }

  heard(raw, from) {
    let m
    try {
      m = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (m?.app !== 'clique' || m.v !== 1 || typeof m.id !== 'string' || m.id === this.id || typeof m.fingerprint !== 'string') return
    const key = `${m.id.slice(0, 32)}|${m.fingerprint}`
    if (m.bye) return void (this.found.delete(key) && this.emit('change'))
    if (typeof m.name !== 'string' || !Number.isInteger(m.port)) return
    if (m.fingerprint === this.beacon().fingerprint) return // this computer, as another copy of Crew (the dev one and the installed one)
    if (!this.found.has(key) && this.found.size >= 32) return // a network flooded with made-up computers: the first ones stay
    const was = this.found.get(key)
    const next = { id: key, name: m.name.slice(0, 64), platform: String(m.platform ?? '').slice(0, 16), agents: Number(m.agents) || 0, port: m.port, fingerprint: m.fingerprint, address: from.address, seen: this.now() }
    this.found.set(key, next)
    if (!was || ['name', 'agents', 'port', 'address'].some((k) => was[k] !== next[k])) this.emit('change')
  }

  prune() {
    const before = this.found.size
    for (const [id, f] of this.found) if (this.now() - f.seen > GONE) this.found.delete(id)
    if (this.found.size !== before) this.emit('change')
  }
}

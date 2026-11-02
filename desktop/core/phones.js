// The phones paired with this Mac (shared/PROTOCOL.md): this Mac's key and id for them, each paired phone, the pairing
// code that's open, and which phones are connected right now. Kept in phones.json in the Crew Link folder, readable only
// by you. A phone is a device, not a computer: it has no agents, and only core/remote.js talks to it.
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PAIR_TTL, b64, makePairCode, unb64 } from 'crew-shared/protocol.js'

// X25519 keys as their raw 32 bytes, which node:crypto takes wrapped in DER (as shared/make-vectors.mjs does).
const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const SPKI = Buffer.from('302a300506032b656e032100', 'hex')
export const privateKey = (raw) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8, raw]), format: 'der', type: 'pkcs8' })
export const publicKey = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' })

// -> { pub, priv }: a new key pair, raw
export function keyPair() {
  const { publicKey: pub, privateKey: priv } = crypto.generateKeyPairSync('x25519')
  return { pub: pub.export({ format: 'der', type: 'spki' }).subarray(-32), priv: priv.export({ format: 'der', type: 'pkcs8' }).subarray(-32) }
}

// Emits 'change' when what the app shows of them changes: a phone paired, removed, connected or gone, a code opened or
// ended, or `error` (why this Mac can't listen for phones right now, which core/remote.js sets).
export class Phones extends EventEmitter {
  devices = [] // [{ id, name, platform, app, pub, paired, seen }]
  pairing = null // the open code: { secret, expires, timer }
  live = new Map() // device id -> its connections (a phone tries every address at once, so it can have two for a moment)
  error = null

  constructor(dir) {
    super()
    this.file = path.join(dir, 'phones.json')
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      Object.assign(this, { macId: saved.macId, key: saved.key, devices: saved.devices ?? [] })
    } catch {}
  }

  // This Mac's id and key for phones, made with its first pairing code.
  ensure() {
    if (this.macId && this.key) return
    const k = keyPair()
    this.macId = b64(crypto.randomBytes(16))
    this.key = { pub: b64(k.pub), priv: b64(k.priv) }
    this.save()
  }

  // Written whole, then put in place: a file cut short would lose this Mac's key, and with it every paired phone.
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const next = `${this.file}.new`
    fs.writeFileSync(next, JSON.stringify({ macId: this.macId, key: this.key, devices: this.devices }, null, 2), { mode: 0o600 })
    fs.chmodSync(next, 0o600)
    fs.renameSync(next, this.file)
  }

  changed() {
    this.emit('change')
  }

  // A new pairing code ({ name, hosts, port }: this Mac's name and where a phone finds it) -> { code, expires }. It pairs
  // one phone within PAIR_TTL; a new one ends the one before.
  code({ name, hosts, port }) {
    this.ensure()
    clearTimeout(this.pairing?.timer)
    const secret = crypto.randomBytes(32)
    const expires = Date.now() + PAIR_TTL
    const timer = setTimeout(() => this.endCode(), PAIR_TTL)
    timer.unref?.()
    this.pairing = { secret, expires, timer }
    this.changed()
    return { code: makePairCode({ id: this.macId, name, key: unb64(this.key.pub), secret, hosts, port }), expires }
  }

  // The code that's open, if it is still in time.
  open() {
    return this.pairing && Date.now() < this.pairing.expires ? this.pairing : null
  }

  endCode() {
    if (!this.pairing) return
    clearTimeout(this.pairing.timer)
    this.pairing = null
    this.changed()
  }

  // The paired phone with this public key (raw bytes), if there is one.
  find(pub) {
    const key = b64(pub)
    return this.devices.find((d) => d.pub === key)
  }

  // A phone that just paired: kept from now on, and the code is used up. One that pairs again keeps its id.
  add(pub, { name, platform, app } = {}) {
    const now = Date.now()
    const fields = { name: String(name ?? '').trim().slice(0, 60) || 'Phone', platform: ['ios', 'android'].includes(platform) ? platform : '', app: String(app ?? '').slice(0, 20) }
    let d = this.find(pub)
    if (d) Object.assign(d, fields, { paired: now, seen: now })
    else this.devices.push((d = { id: b64(crypto.randomBytes(9)), ...fields, pub: b64(pub), paired: now, seen: now }))
    this.save()
    this.endCode()
    return d
  }

  // A paired phone is connected, saying its name and app version as they are now (close: how to end that connection if
  // it's unpaired). -> what to call once it's gone.
  connected(d, close, hi = {}) {
    const conns = this.live.get(d.id) ?? new Set()
    conns.add(close)
    this.live.set(d.id, conns)
    this.seen(d, hi)
    return () => {
      conns.delete(close)
      if (!conns.size && this.live.get(d.id) === conns) this.live.delete(d.id)
      this.seen(d)
    }
  }

  // When it was last here.
  seen(d, { name, app } = {}) {
    if (name) d.name = String(name).trim().slice(0, 60) || d.name
    if (app) d.app = String(app).slice(0, 20)
    d.seen = Date.now()
    if (this.devices.includes(d)) this.save()
    this.changed()
  }

  // Unpair a phone: it can't connect any more, and a connection it has now ends.
  revoke(id) {
    const d = this.devices.find((x) => x.id === id)
    if (!d) return
    this.devices = this.devices.filter((x) => x !== d)
    this.save()
    for (const close of this.live.get(id) ?? []) close()
    this.live.delete(id)
    this.changed()
  }

  // What the app shows: each phone without its key, whether it's connected, and when the open code ends.
  view() {
    return {
      devices: this.devices.map(({ id, name, platform, app, paired, seen }) => ({ id, name, platform, app, paired, seen, online: this.live.has(id) })),
      pairing: this.open() ? { expires: this.pairing.expires } : null,
      error: this.error,
    }
  }
}

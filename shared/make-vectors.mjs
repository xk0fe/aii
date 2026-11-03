// Writes vectors.json: the handshake and first frames of PROTOCOL.md worked through with fixed keys, for a reconnect and
// for a pairing. It is the reference implementation (node:crypto); the Mac's and the phone's own must reproduce it.
//   node shared/make-vectors.mjs          rewrite vectors.json
//   node shared/make-vectors.mjs --check  exit 1 if vectors.json differs from what this computes
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { b64, concat, keyInfo, nonce, utf8, SALT } from './protocol.js'

const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const SPKI = Buffer.from('302a300506032b656e032100', 'hex')
const privateKey = (raw) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8, raw]), format: 'der', type: 'pkcs8' })
const publicKey = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' })
const pub = (raw) => new Uint8Array(crypto.createPublicKey(privateKey(raw)).export({ format: 'der', type: 'spki' }).subarray(-32))
const dh = (priv, pubRaw) => new Uint8Array(crypto.diffieHellman({ privateKey: privateKey(priv), publicKey: publicKey(pubRaw) }))

export function keys({ e, d, m, f, secret }) {
  const [E, D, M, F] = [e, d, m, f].map(pub)
  const ikm = concat(dh(e, M), dh(d, M), dh(e, F), secret ?? new Uint8Array(0))
  const okm = new Uint8Array(crypto.hkdfSync('sha256', ikm, utf8(SALT), keyInfo({ e: E, d: D, m: M, f: F }), 64))
  return { pub: { e: E, d: D, m: M, f: F }, kPhone: okm.slice(0, 32), kMac: okm.slice(32) }
}

export function seal(key, counter, text) {
  const c = crypto.createCipheriv('chacha20-poly1305', key, nonce(counter), { authTagLength: 16 })
  return new Uint8Array(Buffer.concat([c.update(utf8(text)), c.final(), c.getAuthTag()]))
}

const fixed = (byte) => new Uint8Array(32).fill(byte)
const hex = (u) => Buffer.from(u).toString('hex')

function vector(name, secret) {
  const priv = { e: fixed(1), d: fixed(2), m: fixed(3), f: fixed(4) }
  const k = keys({ ...priv, secret })
  const hi = JSON.stringify({ t: 'hi', name: 'Pixel 9', platform: 'android', app: '0.1.0' })
  const ready = JSON.stringify({ t: 'ready', mac: { id: 'mac-id', name: 'Mac mini' }, device: { id: 'device-id' } })
  return {
    name,
    private: Object.fromEntries(Object.entries(priv).map(([n, v]) => [n, hex(v)])),
    public: Object.fromEntries(Object.entries(k.pub).map(([n, v]) => [n, hex(v)])),
    secret: secret ? hex(secret) : null,
    kPhone: hex(k.kPhone),
    kMac: hex(k.kMac),
    frames: [
      { from: 'phone', counter: 0, plaintext: hi, sealed: hex(seal(k.kPhone, 0, hi)) },
      { from: 'mac', counter: 0, plaintext: ready, sealed: hex(seal(k.kMac, 0, ready)) },
      { from: 'phone', counter: 1, plaintext: '{"t":"call","id":1,"name":"watch","args":["default"]}', sealed: hex(seal(k.kPhone, 1, '{"t":"call","id":1,"name":"watch","args":["default"]}')) },
    ],
    // a code with these keys, to check the encoding too
    b64: { m: b64(k.pub.m) },
  }
}

const vectors = { about: 'PROTOCOL.md test vectors: X25519, HKDF-SHA256, ChaCha20-Poly1305; all bytes in hex', vectors: [vector('reconnect', null), vector('pairing', fixed(5))] }
const text = JSON.stringify(vectors, null, 2) + '\n'
const file = new URL('./vectors.json', import.meta.url)
if (process.argv.includes('--check')) {
  // as checked out: a Windows checkout may end its lines in CRLF
  if (fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n') !== text) {
    console.error('vectors.json differs from what make-vectors.mjs computes')
    process.exit(1)
  }
} else if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) fs.writeFileSync(file, text)

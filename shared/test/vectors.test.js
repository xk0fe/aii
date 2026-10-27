import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { keys, seal } from '../make-vectors.mjs'
import { concat, keyInfo, nonce, utf8, unutf8, SALT } from '../protocol.js'

const { vectors } = JSON.parse(fs.readFileSync(new URL('../vectors.json', import.meta.url), 'utf8'))
const bytes = (hex) => new Uint8Array(Buffer.from(hex, 'hex'))

test('vectors.json is what the reference computes', () => {
  for (const v of vectors) {
    const k = keys({ ...Object.fromEntries(Object.entries(v.private).map(([n, h]) => [n, bytes(h)])), secret: v.secret && bytes(v.secret) })
    assert.equal(Buffer.from(k.kPhone).toString('hex'), v.kPhone, v.name)
    assert.equal(Buffer.from(k.kMac).toString('hex'), v.kMac, v.name)
    for (const f of v.frames) assert.equal(Buffer.from(seal(f.from === 'phone' ? k.kPhone : k.kMac, f.counter, f.plaintext)).toString('hex'), f.sealed)
  }
})

// The Mac's side of the same handshake, from its own private keys and the phone's public ones: it must land on the
// same keys, and open the phone's frames.
test("the Mac derives the same keys from its side, and opens the phone's frames", () => {
  const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
  const SPKI = Buffer.from('302a300506032b656e032100', 'hex')
  const dh = (priv, pub) => new Uint8Array(crypto.diffieHellman({ privateKey: crypto.createPrivateKey({ key: Buffer.concat([PKCS8, priv]), format: 'der', type: 'pkcs8' }), publicKey: crypto.createPublicKey({ key: Buffer.concat([SPKI, pub]), format: 'der', type: 'spki' }) }))
  for (const v of vectors) {
    const p = Object.fromEntries(Object.entries(v.public).map(([n, h]) => [n, bytes(h)]))
    const m = bytes(v.private.m)
    const f = bytes(v.private.f)
    const ikm = concat(dh(m, p.e), dh(m, p.d), dh(f, p.e), v.secret ? bytes(v.secret) : new Uint8Array(0))
    const okm = Buffer.from(crypto.hkdfSync('sha256', ikm, utf8(SALT), keyInfo(p), 64))
    assert.equal(okm.subarray(0, 32).toString('hex'), v.kPhone)
    assert.equal(okm.subarray(32).toString('hex'), v.kMac)
    const frame = bytes(v.frames[0].sealed)
    const d = crypto.createDecipheriv('chacha20-poly1305', okm.subarray(0, 32), nonce(0), { authTagLength: 16 })
    d.setAuthTag(frame.subarray(-16))
    assert.equal(unutf8(new Uint8Array(Buffer.concat([d.update(frame.subarray(0, -16)), d.final()]))), v.frames[0].plaintext)
  }
})

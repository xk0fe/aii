import { test } from 'node:test'
import assert from 'node:assert/strict'
import { b64, unb64, utf8, unutf8, nonce, makePairCode, readPairCode, pack, unpack, PAIR_PREFIX } from '../protocol.js'

test('base64url and UTF-8 match Node, without Node', () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33, 100]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255)
    assert.equal(b64(bytes), Buffer.from(bytes).toString('base64url'))
    assert.deepEqual(unb64(b64(bytes)), bytes)
  }
  for (const s of ['', 'gal', 'Crew на Маке', 'creatures 🐸🫧', 'tab\tand\nnewline']) {
    assert.deepEqual(utf8(s), new Uint8Array(Buffer.from(s, 'utf8')))
    assert.equal(unutf8(utf8(s)), s)
  }
})

test('a nonce is 4 zero bytes and a little-endian counter', () => {
  assert.equal(Buffer.from(nonce(0)).toString('hex'), '000000000000000000000000')
  assert.equal(Buffer.from(nonce(1)).toString('hex'), '000000000100000000000000')
  assert.equal(Buffer.from(nonce(258)).toString('hex'), '000000000201000000000000')
})

test('a pairing code says which Mac, its key, the secret and where to find it', () => {
  const key = new Uint8Array(32).fill(7)
  const secret = new Uint8Array(32).fill(9)
  const code = makePairCode({ id: 'abc', name: 'Mac mini', key, secret, hosts: ['192.168.1.20', 'mac-mini.tail.ts.net'], port: 7788 })
  assert.ok(code.startsWith(PAIR_PREFIX))
  const back = readPairCode(` ${code}\n`)
  assert.deepEqual(back, { id: 'abc', name: 'Mac mini', key, secret, hosts: ['192.168.1.20', 'mac-mini.tail.ts.net'], port: 7788 })
  assert.throws(() => readPairCode('crew1.abc'), /not a Crew phone code/)
  assert.throws(() => readPairCode(PAIR_PREFIX + 'not-json'), /not a Crew phone code/)
})

test('bytes travel inside JSON', () => {
  const msg = { t: 'call', id: 1, name: 'saveImage', args: ['a.png', 'image/png', new Uint8Array([1, 2, 250])] }
  assert.deepEqual(unpack(pack(msg)), msg)
})

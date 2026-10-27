// shared/vectors.json, reproduced with the phone's own crypto (@noble): both vectors, every frame, sealed and opened.
import fs from 'node:fs'
import path from 'node:path'

import { keyPair, macKeys, open, phoneKeys, seal } from '@/net/crypto'
import { b64, utf8, unutf8 } from '@/net/shared'

type Vector = {
  name: string
  private: Record<'e' | 'd' | 'm' | 'f', string>
  public: Record<'e' | 'd' | 'm' | 'f', string>
  secret: string | null
  kPhone: string
  kMac: string
  frames: { from: 'phone' | 'mac'; counter: number; plaintext: string; sealed: string }[]
  b64: { m: string }
}

const { vectors } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/vectors.json'), 'utf8')) as { vectors: Vector[] }
const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'))
const hex = (u: Uint8Array) => Buffer.from(u).toString('hex')

test('there are two vectors: a reconnect and a pairing', () => {
  expect(vectors.map((v) => v.name)).toEqual(['reconnect', 'pairing'])
})

describe.each(vectors)('$name', (v) => {
  const priv = { e: bytes(v.private.e), d: bytes(v.private.d), m: bytes(v.private.m), f: bytes(v.private.f) }
  const pair = { e: keyPair(priv.e), d: keyPair(priv.d), m: keyPair(priv.m), f: keyPair(priv.f) }
  const secret = v.secret ? bytes(v.secret) : null

  test('public keys', () => {
    for (const k of ['e', 'd', 'm', 'f'] as const) expect(hex(pair[k].public)).toBe(v.public[k])
    expect(b64(pair.m.public)).toBe(v.b64.m)
  })

  test('the phone derives kPhone and kMac', () => {
    const k = phoneKeys({ e: pair.e, d: pair.d, m: pair.m.public, f: pair.f.public, secret })
    expect(hex(k.kPhone)).toBe(v.kPhone)
    expect(hex(k.kMac)).toBe(v.kMac)
  })

  test('the Mac derives the same keys from its side', () => {
    const k = macKeys({ m: pair.m, f: pair.f, e: pair.e.public, d: pair.d.public, secret })
    expect(hex(k.kPhone)).toBe(v.kPhone)
    expect(hex(k.kMac)).toBe(v.kMac)
  })

  test.each(v.frames.map((f, i) => ({ ...f, i })))('frame $i from the $from: seal and open', (f) => {
    const key = bytes(f.from === 'phone' ? v.kPhone : v.kMac)
    expect(hex(seal(key, f.counter, utf8(f.plaintext)))).toBe(f.sealed)
    expect(unutf8(open(key, f.counter, bytes(f.sealed)))).toBe(f.plaintext)
  })

  test('a frame opened with the wrong counter or key fails', () => {
    const f = v.frames[0]
    const key = bytes(v.kPhone)
    expect(() => open(key, f.counter + 1, bytes(f.sealed))).toThrow()
    expect(() => open(bytes(v.kMac), f.counter, bytes(f.sealed))).toThrow()
    const tampered = bytes(f.sealed)
    tampered[3] ^= 1
    expect(() => open(key, f.counter, tampered)).toThrow()
  })
})

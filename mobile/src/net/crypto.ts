// The phone's half of PROTOCOL.md's handshake: X25519 key agreement, HKDF-SHA256 into one key per direction, and
// ChaCha20-Poly1305 frames with a counter nonce. No React and no platform APIs (randomness comes from the caller), so
// the same code runs in the app, in Jest and under Node against a real Mac.
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { concat, keyInfo, nonce, SALT, utf8, unutf8 } from './shared'

export type Bytes = Uint8Array
export type KeyPair = { secret: Bytes; public: Bytes }

// 32 random bytes are an X25519 secret key as they are (the curve clamps them).
export const keyPair = (secret: Bytes): KeyPair => ({ secret, public: x25519.getPublicKey(secret) })
export const publicKey = (secret: Bytes): Bytes => x25519.getPublicKey(secret)
export const dh = (secret: Bytes, pub: Bytes): Bytes => x25519.getSharedSecret(secret, pub)

export type Keys = { kPhone: Bytes; kMac: Bytes }

// ikm = DH(E, M) ‖ DH(D, M) ‖ DH(E, F) ‖ (s when pairing); okm = HKDF(ikm, "clique-phone-v1", "keys" ‖ E ‖ D ‖ M ‖ F, 64)
export function phoneKeys({ e, d, m, f, secret }: { e: KeyPair; d: KeyPair; m: Bytes; f: Bytes; secret?: Bytes | null }): Keys {
  const ikm = concat(dh(e.secret, m), dh(d.secret, m), dh(e.secret, f), secret ?? new Uint8Array(0))
  return split(ikm, { e: e.public, d: d.public, m, f })
}

// The Mac's side of the same derivation, from its own secrets and the phone's public keys. Only the tests and the
// fake Mac need it, but it lives here so both sides of the test use one definition.
export function macKeys({ m, f, e, d, secret }: { m: KeyPair; f: KeyPair; e: Bytes; d: Bytes; secret?: Bytes | null }): Keys {
  const ikm = concat(dh(m.secret, e), dh(m.secret, d), dh(f.secret, e), secret ?? new Uint8Array(0))
  return split(ikm, { e, d, m: m.public, f: f.public })
}

function split(ikm: Bytes, pubs: { e: Bytes; d: Bytes; m: Bytes; f: Bytes }): Keys {
  const okm = hkdf(sha256, ikm, utf8(SALT), keyInfo(pubs), 64)
  return { kPhone: okm.slice(0, 32), kMac: okm.slice(32, 64) }
}

export const seal = (key: Bytes, counter: number, plaintext: Bytes): Bytes => chacha20poly1305(key, nonce(counter)).encrypt(plaintext)
export const open = (key: Bytes, counter: number, sealed: Bytes): Bytes => chacha20poly1305(key, nonce(counter)).decrypt(sealed)

// One direction of an encrypted channel: its key and its own frame counter, which starts at 0.
export class Channel {
  private counter = 0
  constructor(private key: Bytes) {}

  sealText(text: string): Bytes {
    return seal(this.key, this.counter++, utf8(text))
  }

  // Throws when the frame doesn't open: a wrong key, a tampered frame, or one out of order (its nonce is wrong).
  openText(frame: Bytes): string {
    const plain = open(this.key, this.counter, frame)
    this.counter++
    return unutf8(plain)
  }
}

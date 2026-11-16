// CLIque's phone protocol (PROTOCOL.md): its names and numbers, pairing codes, and the encodings both sides need.
// Plain JavaScript with no dependencies and no Node or browser APIs, so CLIque on the Mac imports it as is and the
// phone app bundles it.

export const VERSION = 1
export const PORT = 7788
export const PAIR_PREFIX = 'cliquephone1.'
export const PAIR_TTL = 10 * 60 * 1000 // a pairing code pairs one phone within this long
export const SALT = 'clique-phone-v1'

// Why the Mac closed a phone's connection.
export const CLOSE = { notPaired: 4003, version: 4004, noCode: 4005, badFrame: 4006, tooMany: 4008 }

// Everything a phone may ask of the Mac; the Mac refuses anything else.
export const CALLS = ['watch', 'send', 'answer', 'approve', 'drop', 'read', 'task', 'power', 'set', 'freshStart', 'restart', 'markIdle', 'stop', 'image', 'saveImage', 'terminal', 'input', 'channel']
export const TASK_OPS = ['file', 'dispatch', 'accept', 'sendBack', 'note', 'move']
// what the `channel` call does: make one, change its name, brief or members, delete it (never #general)
export const CHANNEL_OPS = ['create', 'edit', 'remove']

// Lists in a phone's state that travel as changes to their entries, by key (sync.js).
export const LISTS = { feed: 'id', agents: 'name' }

// ---- reactions ---------------------------------------------------------------------------------------
// One emoji on a message in place of a written "got it". A feed entry may carry
//   reactions: [{ by: 'iris' | 'you', emoji: '👍', at: <ms>, said?: '<the few words that came with it>' }]
// An app from before reactions ignores the field and shows the message as it always did.

// The ones offered when you hover a message, and the ones agents are pointed at.
export const HANDY_REACTIONS = ['👍', '✅', '👀', '❤️', '🎉', '🙏']
// At most this many on one message, everyone's together.
export const REACTIONS_MAX = 12

// A message's reactions as the pills under it: [{ emoji, by: [names], said: { name: words } }], in the order each
// emoji first landed, each name once per emoji. Anything that isn't a reaction (a newer app's fields, damage) is left out.
export function reactionGroups(list) {
  const groups = []
  if (!Array.isArray(list)) return groups
  for (const r of list) {
    if (!r || typeof r.emoji !== 'string' || !r.emoji || typeof r.by !== 'string' || !r.by) continue
    let g = groups.find((x) => x.emoji === r.emoji)
    if (!g) groups.push((g = { emoji: r.emoji, by: [], said: {} }))
    if (g.by.includes(r.by)) continue
    g.by.push(r.by)
    if (typeof r.said === 'string' && r.said) g.said[r.by] = r.said
  }
  return groups
}

// ---- bytes ------------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_INDEX = Object.fromEntries([...B64].map((c, i) => [c, i]))

// base64url without padding, the way keys and codes are written
export function b64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += B64[n & 63]
  }
  return out
}

export function unb64(text) {
  const s = String(text).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let bits = 0
  let acc = 0
  let o = 0
  for (const c of s) {
    const v = B64_INDEX[c]
    if (v === undefined) throw new Error('not base64')
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 255
    }
  }
  return out
}

export function utf8(text) {
  const out = []
  for (const ch of String(text)) {
    let c = ch.codePointAt(0)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return new Uint8Array(out)
}

export function unutf8(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]
    const n = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4
    let c = n === 1 ? b : b & (0xff >> (n + 1))
    for (let k = 1; k < n; k++) c = (c << 6) | (bytes[i + k] & 63)
    out += String.fromCodePoint(c)
    i += n
  }
  return out
}

export const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) out.set(p, at), (at += p.length)
  return out
}

// A frame's nonce: 4 zero bytes, then its counter as a 64-bit little-endian number.
export function nonce(counter) {
  const out = new Uint8Array(12)
  let n = BigInt(counter)
  for (let i = 4; i < 12; i++) {
    out[i] = Number(n & 255n)
    n >>= 8n
  }
  return out
}

// What goes into HKDF's info: "keys" ‖ E.pub ‖ D.pub ‖ M.pub ‖ F.pub
export const keyInfo = ({ e, d, m, f }) => concat(utf8('keys'), e, d, m, f)

// ---- pairing codes ----------------------------------------------------------------------------------

// { id, name, key (M.pub bytes), secret (bytes), hosts, port } <-> cliquephone1.…
export function makePairCode({ id, name, key, secret, hosts, port = PORT }) {
  return PAIR_PREFIX + b64(utf8(JSON.stringify({ v: VERSION, id, n: name, k: b64(key), s: b64(secret), h: hosts, p: port })))
}

export function readPairCode(code) {
  const text = String(code ?? '').trim()
  if (!text.startsWith(PAIR_PREFIX)) throw new Error("that's not a CLIque phone code")
  let c
  try {
    c = JSON.parse(unutf8(unb64(text.slice(PAIR_PREFIX.length))))
  } catch {
    throw new Error("that's not a CLIque phone code")
  }
  if (c.v !== VERSION) throw new Error('that code is from a different CLIque version, update both')
  const key = unb64(c.k)
  const secret = unb64(c.s)
  if (key.length !== 32 || secret.length !== 32 || !Array.isArray(c.h)) throw new Error("that's not a CLIque phone code")
  return { id: String(c.id), name: String(c.n ?? 'Mac'), key, secret, hosts: c.h.map(String), port: Number(c.p) || PORT }
}

// ---- messages ---------------------------------------------------------------------------------------

// JSON with bytes as { $bytes: base64 }, as on CLIque Link
export const pack = (value) => JSON.stringify(value, (_, x) => (x instanceof Uint8Array ? { $bytes: b64(x) } : x))
export const unpack = (text) => JSON.parse(text, (_, x) => (x && typeof x === 'object' && typeof x.$bytes === 'string' ? unb64(x.$bytes) : x))

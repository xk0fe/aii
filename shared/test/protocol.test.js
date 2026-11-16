import { test } from 'node:test'
import assert from 'node:assert/strict'
import { b64, unb64, utf8, unutf8, nonce, makePairCode, readPairCode, pack, unpack, PAIR_PREFIX, CALLS, HANDY_REACTIONS, REACTIONS_MAX, reactionGroups } from '../protocol.js'
import { diff, apply } from '../sync.js'

test('base64url and UTF-8 match Node, without Node', () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33, 100]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255)
    assert.equal(b64(bytes), Buffer.from(bytes).toString('base64url'))
    assert.deepEqual(unb64(b64(bytes)), bytes)
  }
  for (const s of ['', 'gal', 'CLIque на Маке', 'creatures 🐸🫧', 'tab\tand\nnewline']) {
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
  const code = makePairCode({ id: 'abc', name: 'Studio', key, secret, hosts: ['192.168.1.20', 'studio.tail.ts.net'], port: 7788 })
  assert.ok(code.startsWith(PAIR_PREFIX))
  const back = readPairCode(` ${code}\n`)
  assert.deepEqual(back, { id: 'abc', name: 'Studio', key, secret, hosts: ['192.168.1.20', 'studio.tail.ts.net'], port: 7788 })
  assert.throws(() => readPairCode('clique1.abc'), /not a CLIque phone code/)
  assert.throws(() => readPairCode(PAIR_PREFIX + 'not-json'), /not a CLIque phone code/)
})

test('bytes travel inside JSON', () => {
  const msg = { t: 'call', id: 1, name: 'saveImage', args: ['a.png', 'image/png', new Uint8Array([1, 2, 250])] }
  assert.deepEqual(unpack(pack(msg)), msg)
})

test('reactions: grouped per emoji in the order they landed, each name once, and anything else left out', () => {
  const list = [{ by: 'ada', emoji: '👍', at: 1 }, { by: 'you', emoji: '🎉', at: 2 }, { by: 'milo', emoji: '👍', at: 3, said: 'Noted.' }, { by: 'ada', emoji: '👍', at: 4 }]
  assert.deepEqual(reactionGroups(list), [{ emoji: '👍', by: ['ada', 'milo'], said: { milo: 'Noted.' } }, { emoji: '🎉', by: ['you'], said: {} }])
  // a newer app's fields, or damage: no throw, nothing shown for them
  assert.deepEqual(reactionGroups([null, 'x', 7, {}, { by: 'ada' }, { emoji: '👍' }, { by: 3, emoji: '👍' }, { by: 'ada', emoji: '✅', said: 9, later: true }]), [{ emoji: '✅', by: ['ada'], said: {} }])
  for (const none of [undefined, null, 'no', {}, 3]) assert.deepEqual(reactionGroups(none), [])
  assert.ok(HANDY_REACTIONS.length >= 4 && HANDY_REACTIONS.length <= REACTIONS_MAX && new Set(HANDY_REACTIONS).size === HANDY_REACTIONS.length)
})

test('a reaction reaches a phone as a change to the one message it is on; a phone from before reactions asks nothing new', () => {
  const feed = [{ id: 'a', kind: 'msg', from: 'you', to: 'ada', text: 'the freeze is Thursday', ts: 1 }, { id: 'b', kind: 'reply', from: 'ada', text: 'done', ts: 2 }]
  const next = [{ ...feed[0], reactions: [{ by: 'ada', emoji: '👍', at: 3 }] }, feed[1]]
  const patch = diff({ feed }, { feed: next })
  assert.deepEqual(patch, { lists: { feed: { amend: [next[0]] } } })
  const got = apply({ feed }, JSON.parse(pack(patch)))
  assert.deepEqual(got.feed, next)
  // what an older phone reads of that message is what it always read: the new field is one it doesn't look at
  const { reactions, ...asBefore } = got.feed[0]
  assert.deepEqual(asBefore, feed[0])
  // taken off again: the message is as it was (an empty list, never a missing entry)
  assert.deepEqual(apply(got, diff(got, { feed: [{ ...feed[0], reactions: [] }, feed[1]] })).feed[0].reactions, [])
  assert.equal(CALLS.includes('react'), false, 'phones show reactions; they have no call to add one yet')
})

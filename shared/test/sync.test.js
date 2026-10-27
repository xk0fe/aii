import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diff, apply } from '../sync.js'

const roundTrip = (a, b) => {
  const patch = diff(a, b)
  assert.deepEqual(apply(a, JSON.parse(JSON.stringify(patch))), b)
  return patch
}

test('nothing changed: no patch', () => {
  const s = { autopilot: true, feed: [{ id: 'a', text: 'hi' }], agents: [{ name: 'gal', status: 'free' }] }
  assert.equal(diff(s, structuredClone(s)), null)
})

test('a new reply is one entry, not the whole feed', () => {
  const feed = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, ts: i, text: `message ${i}` }))
  const a = { feed, autopilot: true }
  const b = { feed: [...feed.slice(1), { id: 'm200', ts: 200, text: 'new' }], autopilot: true }
  const patch = roundTrip(a, b)
  assert.deepEqual(patch, { lists: { feed: { drop: ['m0'], add: [{ id: 'm200', ts: 200, text: 'new' }] } } })
})

test('an answered question is amended in place; an agent going busy is one agent', () => {
  const a = { feed: [{ id: 'q', kind: 'ask' }, { id: 'r', kind: 'reply' }], agents: [{ name: 'gal', status: 'free' }, { name: 'joseph', status: 'free' }] }
  const b = { feed: [{ id: 'q', kind: 'ask', answer: { by: 'you' } }, { id: 'r', kind: 'reply' }], agents: [{ name: 'gal', status: 'working' }, { name: 'joseph', status: 'free' }] }
  const patch = roundTrip(a, b)
  assert.deepEqual(patch.lists.feed, { amend: [{ id: 'q', kind: 'ask', answer: { by: 'you' } }] })
  assert.deepEqual(patch.lists.agents, { amend: [{ name: 'gal', status: 'working' }] })
})

test('other keys go whole, and a key that goes away is null', () => {
  const patch = roundTrip({ parked: false, usage: { claude: { pct: 10 } }, gone: 1 }, { parked: true, usage: { claude: { pct: 12 } } })
  assert.deepEqual(patch.set, { parked: true, usage: { claude: { pct: 12 } }, gone: null })
})

test('a reordered list carries its order', () => {
  const a = { agents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }
  const b = { agents: [{ name: 'c' }, { name: 'a' }, { name: 'd' }] }
  assert.ok(roundTrip(a, b).lists.agents.order)
})

test('random changes always round-trip', () => {
  let seed = 7
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n)
  const make = () => ({
    autopilot: rand(2) === 0,
    feed: Array.from({ length: rand(8) }, () => ({ id: `e${rand(12)}`, v: rand(3) })).filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i),
    agents: Array.from({ length: rand(5) }, () => ({ name: `n${rand(7)}`, s: rand(3) })).filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i),
  })
  for (let i = 0; i < 2000; i++) roundTrip(make(), make())
})

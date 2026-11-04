// Which messages stack under the one above (no face, no header) and which start their own row.
import type { FeedEntry } from '@/net/types'
import { stacks } from '@/ui/stack'

const T = 1_800_000_000_000
const msg = (x: Partial<FeedEntry>): FeedEntry => ({ id: String(Math.random()), kind: 'reply', from: 'ada', to: 'you', text: 'hi', ts: T, ...x }) as FeedEntry
const under = (a: Partial<FeedEntry>, b: Partial<FeedEntry>, o: { near?: boolean; divider?: string | null } = {}) => stacks(msg(a), msg({ ts: T + 60000, ...b }), { near: o.near ?? true, divider: o.divider ?? null })

test('the same agent saying more a moment later stacks', () => {
  expect(under({}, {})).toBe(true)
  expect(under({ from: 'you', kind: 'msg', to: 'ada' }, { from: 'you', kind: 'msg', to: 'ada' })).toBe(true)
})

test('what its header would say differently keeps the header', () => {
  expect(under({ from: 'you', kind: 'msg', to: 'ada', cc: ['ada', 'bo'] }, { from: 'you', kind: 'msg', to: 'ada' })).toBe(false) // a group send, then one to ada alone
  expect(under({ from: 'you', kind: 'msg', to: 'ada' }, { from: 'you', kind: 'msg', to: 'ada', queued: true })).toBe(false)
  expect(under({ kind: 'msg', to: 'bo' }, { kind: 'msg', to: 'bo', ask: true })).toBe(false) // a hand-off, then a question
  expect(under({ from: 'you', kind: 'msg', to: 'ada' }, { from: 'you', kind: 'msg', to: 'ada', fresh: true })).toBe(false)
  expect(under({ from: 'you', kind: 'msg', to: 'ada' }, { from: 'you', kind: 'msg', to: 'ada', auto: true })).toBe(false)
  expect(under({ channel: 'ship' }, {})).toBe(false)
})

test("a New line above it, a quote it needs, five minutes, tickets and other kinds don't stack", () => {
  const e = msg({ ts: T + 60000 })
  expect(stacks(msg({}), e, { near: true, divider: e.id })).toBe(false)
  expect(under({}, {}, { near: false })).toBe(false)
  expect(under({}, { ts: T + 5 * 60000 })).toBe(false)
  expect(under({ from: 'you', kind: 'msg', to: 'ada', ticket: 4 }, { from: 'you', kind: 'msg', to: 'ada' })).toBe(false)
  expect(under({ kind: 'event' }, { kind: 'event' })).toBe(false)
  expect(under({ kind: 'ask' }, { kind: 'ask' })).toBe(false)
  expect(under({ kind: 'note' }, {})).toBe(false)
})

// Threads on the phone: the chat shows each one as a card, and it opens to its lines. The stamps come from the computer
// (desktop/core/threads.js).
import type { Agent, FeedEntry } from '@/net/types'
import { isUnread } from '@/state/hooks'
import { inThread, threadLines, withThreadCards } from '@/ui/threads'

const T = 1_800_000_000_000
const min = 60000
const line = (x: Partial<FeedEntry> & { id: string }): FeedEntry => ({ ts: T, kind: 'msg', from: 'Ada', text: 'x', ...x })
const FEED: FeedEntry[] = [
  line({ id: 'a', from: 'you', to: 'Ada', text: 'fix it' }),
  line({ id: 'b', to: 'Theo', re: 'a', thread: 'a', ts: T + min, gist: 'Fix it.' }),
  line({ id: 'c', kind: 'reply', re: 'a', thread: 'a', out: true, ts: T + 2 * min, text: 'Theo has it.' }),
  line({ id: 'd', from: 'Theo', to: 'Ada', re: 'b', thread: 'a', ts: T + 3 * min, gist: 'Done.' }),
  line({ id: 'e', kind: 'reply', from: 'Theo', re: 'b', thread: 'a', echo: 'd', ts: T + 4 * min, text: 'I told Ada.' }),
]
const byIdOf = (feed: FeedEntry[]) => new Map(feed.map((e) => [e.id, e]))
const cards = (feed = FEED, agents: Agent[] = []) => withThreadCards(feed, feed, byIdOf(feed), agents)

test('a line is only in the thread when it is stamped so and not brought out', () => {
  expect(inThread(FEED[0])).toBe(false)
  expect(inThread(FEED[1])).toBe(true)
  expect(inThread(FEED[2])).toBe(false)
})

test('a thread is one card, where its first line would be; what is for you stays', () => {
  const shown = cards()
  expect(shown.map((e) => e.id)).toEqual(['a', 't-a', 'c'])
  expect(shown[1].kind).toBe('thread')
  expect(shown[1].thread).toBe('a')
})

test('the card says who is in it and counts its lines, without the ones that only repeat', () => {
  const { card } = cards()[1]
  expect(card).toMatchObject({ opener: 'Ada', others: ['Theo'], n: 2, span: 3 * min, working: false })
  expect(card?.asking).toBeUndefined()
})

test('it knows a thread someone is at work on, and its latest line', () => {
  const { card } = cards(FEED, [{ name: 'Theo', status: 'working', on: true, thread: 'a' }])[1]
  expect(card?.working).toBe(true)
  expect(card?.latest).toBe('Done.')
  expect(card?.latestFrom).toBe('Theo')
})

test('a question that came out to you shows on the card until someone says something to its agent', () => {
  const asked = line({ id: 'f', kind: 'reply', from: 'Theo', re: 'b', thread: 'a', out: true, asks: true, ts: T + 5 * min })
  expect(cards([...FEED, asked])[1].card?.asking).toBe('Theo')
  const answered = line({ id: 'g', from: 'Ada', to: 'Theo', re: 'f', thread: 'a', ts: T + 6 * min })
  expect(cards([...FEED, asked, answered])[1].card?.asking).toBeUndefined()
})

test('the copies of a send to several agents share one card', () => {
  const feed = [
    line({ id: 'a1', from: 'you', to: 'Ada', sendId: 's' }),
    line({ id: 'a2', from: 'you', to: 'Theo', sendId: 's' }),
    line({ id: 'b1', to: 'June', re: 'a1', thread: 'a1' }),
    line({ id: 'b2', from: 'Theo', to: 'June', re: 'a2', thread: 'a2' }),
  ]
  const byId = new Map(feed.map((e) => [e.id, e]))
  byId.set('a2', feed[0])
  const shown = withThreadCards(feed, feed, byId, [])
  expect(shown.filter((e) => e.kind === 'thread').map((e) => e.thread)).toEqual(['a1'])
  expect(shown.find((e) => e.kind === 'thread')?.card?.n).toBe(2)
})

test('a line a thread says nothing about stays a line: with no stamps, nothing changes', () => {
  const plain = [line({ id: 'a', from: 'you', to: 'Ada' }), line({ id: 'b', to: 'Theo', re: 'a' })]
  expect(cards(plain).map((e) => e.id)).toEqual(['a', 'b'])
})

test('opened, it starts with what led to it and leaves the repeats for their message', () => {
  const { root, rows, echoes, hidden } = threadLines(FEED, 'a')
  expect(root?.id).toBe('a')
  expect(rows.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(echoes.get('d')?.map((e) => e.id)).toEqual(['e'])
  expect(hidden).toBe(2)
})

test('a thread whose root has gone from the chat still opens, with no root', () => {
  const { root, rows } = threadLines(FEED.slice(1), 'a')
  expect(root).toBeNull()
  expect(rows.map((e) => e.id)).toEqual(['b', 'c', 'd'])
})

test('only what the channel shows counts as unread', () => {
  const reads = { since: 0, agents: {} }
  expect(isUnread(line({ id: 'x', kind: 'reply', re: 'a', thread: 'a' }), reads)).toBe(false)
  expect(isUnread(line({ id: 'y', kind: 'reply', re: 'a', thread: 'a', out: true }), reads)).toBe(true)
})

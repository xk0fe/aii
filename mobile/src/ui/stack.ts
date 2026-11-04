// When a message goes under the one above it without its own face and header, as Slack and Discord stack them: the
// same sender saying more, a moment later, to the same people, in the same place, with nothing its header would say
// that the one above's doesn't. No React here, so it's tested on its own (test/stack.test.ts).
import type { FeedEntry } from '@/net/types'

const WINDOW = 5 * 60000

// what people say (yours, an agent's reply, a note, a hand-off), not events, tasks or question cards
const talks = (x: FeedEntry) => x.ticket === undefined && (x.kind === 'reply' || x.kind === 'msg' || x.kind === 'note' || (x.from === 'you' && x.kind !== 'task' && x.kind !== 'bug'))

// alike: whose and to whom (all of them), where, picked by Auto or not, still queued or not, a teammate's question or not
const alike = (a: FeedEntry, b: FeedEntry) =>
  a.kind === b.kind && a.from === b.from && a.to === b.to && (a.cc ?? []).join() === (b.cc ?? []).join() && (a.channel ?? '') === (b.channel ?? '') && !a.auto === !b.auto && !a.queued === !b.queued && (a.ask === true) === (b.ask === true)

// near: what it answers is right above (so its header wouldn't quote it); divider: the entry the New line goes above
export function stacks(prev: FeedEntry | undefined, e: FeedEntry, { near, divider }: { near: boolean; divider: string | null }) {
  return Boolean(prev && talks(prev) && talks(e) && alike(prev, e) && !e.fresh && divider !== e.id && e.ts - prev.ts < WINDOW && near)
}

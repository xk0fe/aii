// Threads: what agents say to each other, under the message that led to it (desktop/core/threads.js stamps every line
// on the computer). The chat shows a thread as one card, where its first line would be. No React here, so it's tested
// on its own (test/threads.test.ts).
import type { Agent, FeedEntry, ThreadCard } from '@/net/types'

// Only in the thread: what the channel leaves out.
export const inThread = (e: FeedEntry) => Boolean(e.thread) && !e.out

const family = (name?: string) => String(name ?? '').replace(/\.\d+(?=@|$)/, '')
const busy = (a: Agent) => a.status === 'working' || a.status === 'waiting'

// which thread a line is in, as the chat shows it: a send to several agents is one message, its first copy
const keyOf = (id: string, byId: Map<string, FeedEntry>) => byId.get(id)?.id ?? id

export function withThreadCards(shown: FeedEntry[], feed: FeedEntry[], byId: Map<string, FeedEntry>, agents: Agent[]): FeedEntry[] {
  const lines = new Map<string, FeedEntry[]>()
  for (const e of feed) {
    if (!e.thread || e.answers) continue
    const key = keyOf(e.thread, byId)
    const list = lines.get(key)
    if (list) list.push(e)
    else lines.set(key, [e])
  }
  const done = new Set<string>()
  const out: FeedEntry[] = []
  for (const e of shown) {
    if (!inThread(e)) {
      out.push(e)
      continue
    }
    const key = keyOf(e.thread as string, byId)
    if (done.has(key)) continue
    done.add(key)
    const all = lines.get(key) ?? [e]
    const onlyIn = all.filter(inThread)
    const hidden = onlyIn.some((x) => !x.echo) ? onlyIn.filter((x) => !x.echo) : onlyIn
    const people = [...new Set(all.flatMap((x) => [x.from, x.to]).filter((n): n is string => Boolean(n) && n !== 'you').map(family))]
    const opener = family(e.from)
    // someone's question that came out to you, with nobody saying anything to it since
    const asking = all.findLast((x, i) => x.asks && !all.slice(i + 1).some((y) => family(y.from) === family(x.from) || family(y.to) === family(x.from)))
    const card: ThreadCard = {
      opener,
      others: people.filter((n) => n !== opener),
      n: hidden.length,
      span: (all.at(-1)?.ts ?? e.ts) - e.ts,
      asking: asking?.from,
      working: agents.some((a) => busy(a) && a.thread !== undefined && keyOf(a.thread, byId) === key),
      latest: hidden.at(-1)?.gist ?? hidden.at(-1)?.text,
      latestFrom: hidden.at(-1)?.from,
    }
    out.push({ id: `t-${key}`, ts: e.ts, kind: 'thread', from: opener, thread: key, channel: e.channel, card })
  }
  return out
}

// What a thread shows, opened: what led to it, then every line of it, each with the replies that only repeat it.
export function threadLines(feed: FeedEntry[], id: string) {
  const lead = new Map<string, FeedEntry>()
  const byId = new Map<string, FeedEntry>()
  for (const e of feed) {
    const first = e.from === 'you' && e.sendId ? lead.get(e.sendId) : undefined
    if (e.from === 'you' && e.sendId && !first) lead.set(e.sendId, e)
    byId.set(e.id, first ?? e)
  }
  const key = keyOf(id, byId)
  const all = feed.filter((e) => !e.answers && (e.thread ? keyOf(e.thread, byId) === key : byId.get(e.id)?.id === key && e.id === key))
  const root = byId.get(key) ?? null
  // (Crew stepping in is the computer's to explain: it has no words of its own to show here)
  const rows = all.filter((e) => !e.echo && e.kind !== 'rule')
  const echoes = new Map<string, FeedEntry[]>()
  for (const e of all) {
    if (!e.echo) continue
    const list = echoes.get(e.echo)
    if (list) list.push(e)
    else echoes.set(e.echo, [e])
  }
  return { root, rows: root && !rows.includes(root) ? [root, ...rows] : rows, echoes, hidden: rows.filter(inThread).length }
}

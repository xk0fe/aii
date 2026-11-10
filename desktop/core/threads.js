// Threads: you talk to one agent and that agent answers you in the channel. What agents say to each other on the way
// (hand-offs, what they tell each other when they finish, notes) goes in a thread under your message, so one request
// stays a few rows in the channel however many messages it takes. Nobody opens a thread by hand: every message already
// says what led to it (`re`), so the hub stamps each line as it's posted, and desktop, phones and linked computers all
// read the same stamps. No Electron and no hub in here.
//
//   thread  the id of the line the thread hangs off (a line with no `thread` is in the channel, and may be a thread's root)
//   out     this line of the thread shows in the channel too: yours, a reply to you, a question or hand-off waiting for you
//   gist    the line a thread shows for it: the agent's own first sentence, no model involved
//   echo    the hand-off this reply only repeats: "I've sent Joseph a proposal", right after sending it. One row per turn
//   asks    an agent's question that nobody answered in the thread, brought out to you (Hub.liftQuestions)

// Only in the thread: what the channel leaves out.
export const inThread = (e) => Boolean(e.thread) && !e.out

// An agent and its clones are one person (iris and iris.2).
export const familyOf = (name) => String(name ?? '').replace(/\.\d+(?=@|$)/, '')

const TALK = new Set(['msg', 'reply', 'ask', 'note', 'rule'])

// Which thread a new line joins, from the line it answers. `thread` already on it: said in that thread on purpose (you,
// in its reply box), and it stays there.
export function threadFields(entry, parent) {
  if (!TALK.has(entry.kind)) return {}
  if (entry.thread) return { thread: entry.thread }
  if (!parent) return {}
  // said in another channel than what led to it (clique post): it's that channel's, as a line of its own
  if ('channel' in entry && (entry.channel ?? null) !== (parent.channel ?? null)) return {}
  const answersYou = entry.kind === 'reply' && !inThread(parent) && (parent.from === 'you' || (parent.kind === 'ask' && parent.to === 'you'))
  const out = entry.from === 'you' || entry.kind === 'ask' || entry.held || answersYou
  return { thread: parent.thread ?? parent.id, ...(out && { out: true }) }
}

const ACK = /^(ack|noted|ok|okay|thanks|thank you|got it|confirmed|understood|yes|no|sure)[.!,:]?$/i
const GIST_MAX = 240

// The first thing it says, as a person would read it out: not the code fence or table it may open with, the
// "joseph:" some sign with, emphasis marks, or the whole of a long path. An opening "ack." takes the sentence after it.
export function gistOf(text, from) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim())
  let line = lines.find((l) => l && !l.startsWith('```') && !l.startsWith('|') && !/^[-*_]{3,}$/.test(l)) ?? ''
  if (from && line.toLowerCase().startsWith(`${String(from).toLowerCase()}: `)) line = line.slice(String(from).length + 2)
  line = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[-*+]|\d+\.)\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(?:\/Users|\/home|~)\/[\w./-]*?\/([\w.-]+)(?=[\s,;:)]|$)/g, '$1')
    .trim()
  const parts = line.split(/(?<=[.!?])\s+/)
  let out = parts[0] ?? ''
  if (ACK.test(out) && parts[1]) out += ` ${parts[1]}`
  if (out.length <= GIST_MAX) return out
  const cut = out.slice(0, GIST_MAX)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), GIST_MAX - 40))}…`
}

// A reply that only says it sent a hand-off ("I've told Joseph"): a few words, right after sending it, answering the same
// message. Anything longer may be a report in its own right, so it stays a line of its own. So does one that asks
// something, and an answer to a teammate's question: that's what the teammate is waiting for.
const ECHO_WORDS = 60
const ECHO_WITHIN = 120000
const BAD_NEWS = /\b(fail\w*|errors?|block\w*|broke\w*|couldn['’]t|can['’]t|cannot|not (yet|verified|tested|checked))\b/i
export function echoOf(entry, parent, sent) {
  if (entry.kind !== 'reply' || entry.out || !entry.re || parent?.ask || !sent) return null
  if (entry.ts - sent.ts > ECHO_WITHIN || asksSomething(entry.text) || BAD_NEWS.test(entry.text)) return null
  return String(entry.text ?? '').trim().split(/\s+/).length <= ECHO_WORDS ? sent.id : null
}

// Lines from before threads, stamped when they're read back, oldest first. What a thread's addressee last said there
// comes out to the channel, and so does the last report in it, since those threads ended long ago and nothing will ask for
// a closing line. In place.
export function stampAll(feed) {
  const byId = new Map()
  const sent = new Map() // `${from}|${re}` -> the latest hand-off of that agent answering that message
  const stamped = new Map() // thread -> the lines stamped here
  for (const e of feed) {
    byId.set(e.id, e)
    if (e.kind === 'msg' && e.from !== 'you' && e.re && !e.answers) sent.set(`${e.from}|${e.re}`, e)
    if (e.thread !== undefined || !e.re) continue
    const parent = byId.get(e.re)
    const fields = threadFields(e, parent)
    if (!fields.thread) continue
    Object.assign(e, fields, { gist: gistOf(e.text, e.from) })
    const echo = echoOf(e, parent, sent.get(`${e.from}|${e.re}`))
    if (echo) e.echo = echo
    if (!stamped.has(e.thread)) stamped.set(e.thread, [])
    stamped.get(e.thread).push(e)
  }
  for (const [id, rows] of stamped) {
    const root = byId.get(id)
    if (root?.from !== 'you' || !root.to) continue
    const said = (e) => e.kind === 'reply' && !e.empty
    for (const last of [rows.findLast((e) => said(e) && familyOf(e.from) === familyOf(root.to)), rows.findLast(said)]) if (last && !last.out) (last.out = true), delete last.echo
  }
  return feed
}

// The lines a client gets, oldest first: the channel's last `rows` and the threads' last `inside`, so a long thread
// doesn't push the channel's history out of view. Every thread keeps its last few, so a long one next to it can't take
// away its card.
const THREAD_LEAST = 3
export function forClients(feed, { rows = 200, inside = 200 } = {}) {
  const out = []
  let inChannel = 0
  let hidden = 0
  const each = new Map()
  for (let i = feed.length - 1; i >= 0 && inChannel < rows + 1; i--) {
    const e = feed[i]
    if (inThread(e)) {
      const n = each.get(e.thread) ?? 0
      each.set(e.thread, n + 1)
      if (hidden++ < inside || n < THREAD_LEAST) out.push(e)
    } else if (inChannel++ < rows) out.push(e)
  }
  return out.reverse()
}

// What a thread's addressee is told when it's asked for a closing line: what was said since its last message. Each
// agent's last reply whole (it may be the only report there is), the rest in a line, the newest kept if it runs long.
const DIGEST_MAX = 6000
const DIGEST_REPLY = 1500
export function threadDigest(rows) {
  const lastOf = new Map()
  for (const e of rows) if (e.kind === 'reply' && !e.empty) lastOf.set(familyOf(e.from), e)
  const whole = new Set(lastOf.values())
  const lines = rows.filter((e) => e.kind !== 'rule' && !e.echo && e.text).map((e) => {
    const who = `@${e.from}${e.to && e.kind === 'msg' ? ` to @${e.to}` : ''}`
    return `${who}: ${whole.has(e) ? String(e.text).slice(0, DIGEST_REPLY) : (e.gist ?? gistOf(e.text, e.from))}`
  })
  const kept = []
  let size = 0
  for (const line of lines.reverse()) {
    if (kept.length && size + line.length > DIGEST_MAX) break
    size += line.length
    kept.unshift(line)
  }
  return kept.join('\n')
}

// A reply that ends by asking something.
export const asksSomething = (text) => /\?[\s*_`)"”']*$/.test(String(text ?? '').slice(-300))
// What an agent says, asked for a closing line, when its last message already said it all.
export const nothingNew = (text) => /^\W*nothing new\W*$/i.test(String(text ?? '').trim())

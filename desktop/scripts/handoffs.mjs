// What hand-offs between your agents cost, from your own history: ~/.crew/feed.jsonl and ~/.crew/stats.json.
// Nothing is sent anywhere and no agent runs; it only reads the timestamps Crew already keeps.
//
//   node scripts/handoffs.mjs [crew home] [--json]
//
// It finds every question an agent asked a teammate the old way (a hand-off the teammate answered by sending
// something back), and measures:
// - the round trip: from the question to the end of the asker's turn that read the answer;
// - how much of that was the teammate finishing whatever it was busy with before it even saw the question;
// - hand-offs that went one way, and replies that said there was nothing to do (turns spent on acknowledgements
//   and on messages that crossed).
// Then what right of way changes: a question now goes into the teammate's turn and is seen at its next step
// (between two tool calls), so the wait for a busy teammate is about one step, the time between its tool calls,
// which stats.json measures for each agent (time at work / tool calls). The answer itself is timed as it was.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const home = args.find((a) => !a.startsWith('--')) ?? (process.env.CREW_HOME || path.join(os.homedir(), '.crew'))
const json = args.includes('--json')
const read = (f) => fs.readFileSync(path.join(home, f), 'utf8')

const feed = []
const byId = new Map()
for (const line of read('feed.jsonl').split('\n')) {
  let e
  try {
    e = JSON.parse(line)
  } catch {
    continue
  }
  if (e.amend) {
    Object.assign(byId.get(e.amend) ?? {}, e)
    continue
  }
  feed.push(e)
  byId.set(e.id, e)
}
feed.sort((x, y) => x.ts - y.ts)
let stats = {}
try {
  stats = JSON.parse(read('stats.json'))
} catch {}

const base = (n) => String(n ?? '').replace(/\.\d+(?=@|$)/, '')
const isAgent = (n) => n && n !== 'you' && n !== 'crew'
const replyTo = new Map()
for (const r of feed) if (r.kind === 'reply' && r.re && !replyTo.has(r.re)) replyTo.set(r.re, r)
// when the turn an agent was in at `ts` started: the end of its previous turn (or `after`, if later)
const replies = feed.filter((e) => e.kind === 'reply' && isAgent(e.from))
const turnAt = (who, ts, after) => Math.max(after, replies.filter((r) => base(r.from) === base(who) && r.ts < ts).at(-1)?.ts ?? 0)
const HOLD = 100000 // how long `crew ask` holds on for the answer in the asker's turn

// seconds between tool calls while at work, per agent
const step = (who) => {
  const s = stats[base(who).split('@')[0]]
  return s?.tools ? s.activeMs / s.tools : null
}

const handoffs = feed.filter((e) => e.kind === 'msg' && isAgent(e.from) && isAgent(e.to) && !e.ask && !e.answers)
const questions = []
let oneWay = 0
for (const h of handoffs) {
  const reply = replyTo.get(h.id)
  // what the teammate sent back to the asker during the turn that handled it
  const back = reply && feed.find((e) => e.kind === 'msg' && base(e.from) === base(h.to) && base(e.to) === base(h.from) && e.ts > h.ts && e.ts <= reply.ts + 5000)
  if (!back) {
    oneWay++
    continue
  }
  const read = replyTo.get(back.id)
  if (!read) continue
  const seen = turnAt(h.to, back.ts, h.ts) // the teammate started the turn in which it answered
  const answer = back.ts - seen
  // with right of way: seen at the teammate's next step, answered as fast as before, and straight into the
  // asker's `crew ask` if it's still holding on, else into its turn at its next step
  const now = (step(h.to) ?? 30000) + answer
  questions.push({
    from: base(h.from), to: base(h.to),
    trip: read.ts - h.ts, // question -> the asker has read the answer
    busy: seen - h.ts, // the teammate finishing what it was on before it got to the question
    answer, // the teammate working out the answer
    after: read.ts - back.ts, // the answer waiting for, and being read by, the asker
    tripNow: now + (now < HOLD ? 0 : (step(h.from) ?? 30000)),
  })
}
const noops = feed.filter((e) => e.kind === 'reply' && isAgent(e.from) && byId.get(e.re) && isAgent(byId.get(e.re).from) && /\b(nothing (to|left to) (act on|do|send|change)|no action (needed|required)|crossed|out of date|was written before|already (recorded|done|complete|fixed|merged|delivered))\b/i.test(String(e.text).slice(0, 400))).length
const teamReplies = feed.filter((e) => e.kind === 'reply' && isAgent(e.from) && byId.get(e.re) && isAgent(byId.get(e.re).from)).length

const q = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : NaN)
const pick = (k) => questions.map((x) => x[k])
const t = (ms) => (Number.isNaN(ms) ? '-' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60000).toFixed(1)} min`)
const out = {
  home, hours: +((feed.at(-1).ts - feed[0].ts) / 3.6e6).toFixed(1), handoffs: handoffs.length, questions: questions.length, oneWay,
  noopTurns: noops, teamReplies,
  trip: { median: q(pick('trip'), 0.5), p90: q(pick('trip'), 0.9) },
  busy: { median: q(pick('busy'), 0.5), p90: q(pick('busy'), 0.9) },
  answer: { median: q(pick('answer'), 0.5) },
  after: { median: q(pick('after'), 0.5) },
  tripNow: { median: q(pick('tripNow'), 0.5), p90: q(pick('tripNow'), 0.9) },
  steps: Object.fromEntries(Object.keys(stats).filter((n) => stats[n]?.tools).map((n) => [n, Math.round(stats[n].activeMs / stats[n].tools / 100) / 10])),
}
if (json) {
  console.log(JSON.stringify(out, null, 2))
  process.exit(0)
}
console.log(`${home}: ${out.hours} hours, ${out.handoffs} hand-offs between agents`)
console.log(`  ${out.questions} were questions the teammate answered back, ${out.oneWay} went one way (fine for an FYI, a stall if the sender was waiting)`)
console.log(`  ${out.noopTurns} of ${out.teamReplies} replies to teammates said there was nothing to do (acknowledgements, messages that crossed)\n`)
console.log(`  a question's round trip, as it went:       median ${t(out.trip.median)}, p90 ${t(out.trip.p90)}`)
console.log(`    the teammate finishing what it was on:   median ${t(out.busy.median)}, p90 ${t(out.busy.p90)}`)
console.log(`    working out the answer:                  median ${t(out.answer.median)}`)
console.log(`    the answer waiting for the asker:        median ${t(out.after.median)}`)
console.log(`  with right of way (seen at the next step): median ${t(out.tripNow.median)}, p90 ${t(out.tripNow.p90)}   ${(out.trip.median / out.tripNow.median).toFixed(0)}x faster at the median`)
console.log(`\n  seconds between tool calls at work: ${Object.entries(out.steps).map(([n, s]) => `${n} ${s}`).join(', ')}`)

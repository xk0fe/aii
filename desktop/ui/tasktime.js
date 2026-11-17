// Where a task's time went, worked out from what the hub wrote down on it (core/tasktime.js: ticket.time, and
// ticket.moves from core/tickets.js): how long it took from added to accepted, split into waiting to start, in the
// queue, working, waiting on you, between turns and waiting for your review, and who was on it for how long (several
// agents can be). The Tasks review draws it (tasks.js); nothing here touches the page, so it's tested as it is.

// The phases, in the order a task goes through them. `you`: yours to shorten (they're the ones in Berry).
const TIME_PHASES = [
  { id: 'wait', label: 'Waiting to start', hint: 'added, and not handed to anyone yet' },
  { id: 'triage', label: 'Triage', hint: 'being sorted out: what it is, whose it is' },
  { id: 'queue', label: 'In the queue', hint: 'handed off, and its agent was busy or starting up' },
  { id: 'under', label: 'Under way', hint: 'handed off, and nobody was seen on it: its agent is on another computer, or it was worked on before the time was kept' },
  { id: 'work', label: 'Working', hint: 'an agent was at work on it' },
  { id: 'you', label: 'Waiting on you', hint: 'an agent on it had a question or needed your OK', you: true },
  { id: 'idle', label: 'Between turns', hint: 'under way, with nobody on it' },
  { id: 'review', label: 'Waiting for review', hint: 'reported, and waiting for you to accept it or send it back', you: true },
]

// 45 s, 12 min, 1 h 52 min, 2 d 3 h
function tookText(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  if (m < 48 * 60) return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`
  const h = Math.round(m / 60)
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h / 24} d`
}

// agents: the clique as the page has it (a turn still going counts up to now). -> null for a task nothing was written
// down for (one from before CLIque kept track), else:
// { start, end, total, done, partial (it was added before the time was kept: this is what's known), reportedAt, toReport, phases: { wait, triage, queue, under, work, you, idle, review },
//   segments: [{ k, at, ms }], agents: [{ name, base, clone, role, work, you, triage, tokens, added, removed, spans }],
//   rounds, asks, steps, files, checks, helpers }
function taskTiming(t, { now = Date.now(), agents = [] } = {}) {
  const moves = [...(t.moves ?? [])].sort((x, y) => x.at - y.at)
  const stored = t.time?.spans ?? []
  if (!moves.length && !stored.length) return null
  // A task added before the time was kept (it has no `timed`): only what was written down since is known, so its
  // time starts with the first of that, and it was under way already if the first thing it did was report.
  const partial = !t.timed
  const first = Math.min(moves[0]?.at ?? Infinity, ...stored.map((s) => s.at))
  const start = partial && Number.isFinite(first) ? first : (t.created ?? first)
  const before = partial && moves[0]?.to !== 'fixing' ? 'fixing' : 'new'
  const closed = t.status === 'done' ? (moves.findLast((m) => m.to === 'done')?.at ?? t.updated) : null
  const end = Math.max(start, closed ?? now)
  // a turn that's still going: its agent is on this task right now
  const live = closed ? [] : agents
    .filter((a) => (a.status === 'working' || a.status === 'waiting') && !t.home && (a.onTask === t.id || (t.status === 'fixing' && a.ticket != null && String(a.ticket) === String(t.key ?? t.id))))
    .map((a) => ({ w: a.name, k: a.status === 'waiting' ? 'you' : 'work', at: a.since, ms: now - a.since, live: true }))
  const spans = [...stored, ...live]
    .map((s) => ({ ...s, at: Math.max(start, s.at), to: Math.min(end, s.at + s.ms) }))
    .filter((s) => s.to > s.at)
    .sort((x, y) => x.at - y.at)

  const seen = spans.some((s) => s.k !== 'triage')
  // what the task was at any moment: its status (from the moves), and whether a turn on it had begun since it was
  // last handed off
  const statusAt = (at) => moves.findLast((m) => m.at <= at)?.to ?? before
  const handedAt = (at) => moves.findLast((m) => m.at <= at && m.to === 'fixing')?.at ?? start
  const kindAt = (at) => {
    const on = spans.filter((s) => s.at <= at && s.to > at)
    // an agent held up on you comes first, whoever else is at work meanwhile: that wait is the one you can shorten,
    // and it's the same number its own row shows
    if (on.some((s) => s.k === 'you')) return 'you'
    if (on.some((s) => s.k === 'work')) return 'work'
    if (on.some((s) => s.k === 'triage')) return 'triage'
    const status = statusAt(at)
    if (status === 'done') return 'closed' // landed, and reopened later: the time it was closed is nobody's
    if (status === 'check') return 'review'
    if (status !== 'fixing') return 'wait'
    if (!seen) return 'under' // nobody was ever seen on it: all that's known is that it was under way
    const handed = handedAt(at)
    return spans.some((s) => s.k !== 'triage' && s.at >= handed && s.at <= at) ? 'idle' : 'queue'
  }
  const cuts = [...new Set([start, end, ...moves.map((m) => m.at), ...spans.flatMap((s) => [s.at, s.to])].filter((x) => x >= start && x <= end))].sort((x, y) => x - y)
  const phases = Object.fromEntries(TIME_PHASES.map((p) => [p.id, 0]))
  const segments = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]]
    const k = kindAt((from + to) / 2)
    if (k === 'closed') continue
    phases[k] += to - from
    const last = segments.at(-1)
    if (last?.k === k) last.ms += to - from
    else segments.push({ k, at: from, ms: to - from })
  }

  // who was on it: one row per agent (a clone is its own row, under its original's name)
  const baseOf = (w) => t.time?.of?.[w] ?? w
  const rows = new Map()
  for (const s of spans) {
    const row = rows.get(s.w) ?? rows.set(s.w, { name: s.w, base: baseOf(s.w), clone: baseOf(s.w) !== s.w ? Number(String(s.w).split('.').at(-1)) || 2 : null, work: 0, you: 0, triage: 0, tokens: 0, added: 0, removed: 0, spans: [] }).get(s.w)
    row[s.k] += s.to - s.at
    row.spans.push({ k: s.k, at: s.at, ms: s.to - s.at, ...(s.live && { live: true }) })
  }
  for (const [w, share] of Object.entries(t.time?.by ?? {})) {
    const row = rows.get(w)
    if (row) Object.assign(row, { tokens: share.tokens ?? 0, added: share.added ?? 0, removed: share.removed ?? 0 })
  }
  const doer = String(t.fixer ?? t.owner ?? '').split('@')[0] // (a task on another computer names its agents name@computer)
  for (const row of rows.values()) row.role = row.base === doer ? 'did' : !row.work && !row.you && row.triage ? 'triaged' : 'helped'
  const order = { did: 0, helped: 1, triaged: 2 }
  const reportedAt = moves.findLast((m) => m.to === 'check')?.at ?? null
  // sent back: every time it went from reported to under way again
  const rounds = moves.filter((m, i) => m.to === 'fixing' && moves[i - 1]?.to === 'check').length
  // (the time it spent closed before a reopening is no part of what it took)
  const total = Object.values(phases).reduce((n, v) => n + v, 0)
  const shut = end - start - total
  return {
    start, end, total, done: Boolean(closed), partial, reportedAt, toReport: reportedAt ? Math.max(0, reportedAt - start - shut) : null,
    phases, segments,
    agents: [...rows.values()].sort((x, y) => order[x.role] - order[y.role] || y.work - x.work || x.name.localeCompare(y.name)),
    rounds, asks: spans.filter((s) => s.k === 'you').length,
    steps: t.time?.steps ?? [], checks: t.time?.checks ?? [], helpers: t.time?.helpers ?? 0,
    files: Object.entries(t.time?.files ?? {}).map(([file, n]) => ({ file, n })).sort((x, y) => y.n - x.n || x.file.localeCompare(y.file)),
  }
}

// What the phases of many tasks add up to: where the clique's time goes. list: taskTiming results of finished tasks.
// -> null with none, else { n, total, median, phases, top: the phase that took the most, yours: the share that
// waited on you (0..1), slowest: index of the task that took longest }
function timingSummary(list) {
  const done = list.filter(Boolean)
  if (!done.length) return null
  const phases = Object.fromEntries(TIME_PHASES.map((p) => [p.id, 0]))
  for (const x of done) for (const p of TIME_PHASES) phases[p.id] += x.phases[p.id] ?? 0
  const total = Object.values(phases).reduce((n, v) => n + v, 0)
  const sorted = done.map((x) => x.total).sort((x, y) => x - y)
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const top = TIME_PHASES.reduce((best, p) => (phases[p.id] > phases[best.id] ? p : best), TIME_PHASES[0])
  const yours = total ? TIME_PHASES.filter((p) => p.you).reduce((n, p) => n + phases[p.id], 0) / total : 0
  return { n: done.length, total, median, phases, top: top.id, yours, slowest: list.indexOf(done.reduce((x, y) => (y.total > x.total ? y : x))) }
}

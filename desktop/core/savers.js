// Token savers: changes to how the crew works that cut what its agents' CLIs spend. Each one can be switched on or off
// (config.json `savers`, or CREW_SAVERS for a benchmark run) and each one is measured. On, the ledger counts what it did
// and what that kept from being spent; off, what it would have done. And every turn's spend is filed under the savers
// that were on at the time, so cost per turn can be compared with them on and off. No Electron in here.
//
// The numbers behind them (2026-11-03, the long-session benchmark and real crews): a new conversation costs about
// 100-120k weighted tokens to find its way around again; Claude Code's cache lasts an hour for a subscription (5 minutes
// on an API key); a cache write costs 2x (1 hour) or 1.25x (5 minutes) an input token, a cache read 0.1x.
import fs from 'node:fs'

export const SAVERS = [
  {
    id: 'coldStart',
    label: 'Start fresh after a long break',
    about: "After an hour away, a big conversation costs double to pick back up. A hand-off that doesn't follow on from it starts a new one, with a note of where things stood. What you send never does.",
  },
  {
    id: 'boardNew',
    label: "Show only the notes an agent hasn't read",
    about: 'crew board shows only the notes added since that conversation last looked, and a note is kept to one decision or gotcha.',
  },
  {
    id: 'busyCheck',
    label: 'One quick check before building',
    about: 'Agents run crew busy before building, instead of reading the board and listing PRs and branches. An agent working alone skips it.',
  },
  {
    id: 'quickTriage',
    label: 'Quick triage',
    about: "New tasks are triaged in one short call to a small model, not in the triage agent's long conversation. If the call fails, the agent does it.",
  },
  {
    id: 'warmRoute',
    label: 'Auto picks the cheaper agent on a tie',
    about: 'When two agents fit a message equally well, Auto gives it to the one whose conversation is still cached, or is smaller.',
  },
  {
    id: 'noReportBack',
    label: 'No reports back',
    about: "An agent can't send a report back to the teammate whose work it's doing: its final message shows in the chat anyway. New work still goes.",
  },
]
export const SAVER_IDS = SAVERS.map((s) => s.id)

// Which savers are on. config.json `savers`: true or false for all of them, or { id: true|false } (one left out is on).
// CREW_SAVERS, for a benchmark run, wins: "on", "off", or the ids that are on ("coldStart,boardNew").
export function saversFrom(config, env = process.env) {
  const forced = String(env.CREW_SAVERS ?? '').trim()
  if (forced) {
    const ids = forced === 'on' ? SAVER_IDS : forced === 'off' ? [] : forced.split(/[\s,+]+/)
    return Object.fromEntries(SAVER_IDS.map((id) => [id, ids.includes(id)]))
  }
  const c = config?.savers
  return Object.fromEntries(SAVER_IDS.map((id) => [id, typeof c === 'boolean' ? c : c?.[id] !== false]))
}

// The savers that are on, as one name: what spend is filed under. "none" when they're all off.
export const modeOf = (on) => SAVER_IDS.filter((id) => on[id]).join('+') || 'none'

// What a cache write costs against a plain input token, and the restart it has to beat: picking a cold conversation back
// up rewrites its whole cache, so starting fresh pays once that rewrite costs more than a new conversation finding its
// way around (RESTART weighted tokens). Codex has no write premium: its cold input is billed as input.
export const RESTART = 120000
export const writePrice = ({ cli, ttl }) => (cli === 'codex' ? 1 : ttl <= 5 * 60000 ? 1.25 : 2)
export const HOUR = 60 * 60000

// The ledger: per day, each saver's counts with it on and with it off, and spend per mode. In the workspace's folder
// (savers.json). Counts are open-ended: { n, tokens, cost, ... }, whatever that saver measures.
const KEEP_DAYS = 90
const localDay = (t = Date.now()) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10)

export class Ledger {
  constructor(file) {
    this.file = file
    let data = null
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {}
    this.data = { since: data?.since ?? Date.now(), days: data?.days ?? {}, modes: data?.modes ?? {} }
  }

  // A saver did what it does (on), or would have (off). counts: { n: 1, tokens: 230000 }…
  add(id, on, counts) {
    const day = ((this.data.days[localDay()] ??= {})[id] ??= {})
    const side = (day[on ? 'on' : 'off'] ??= {})
    for (const [k, v] of Object.entries(counts)) if (Number.isFinite(v) && v) side[k] = (side[k] ?? 0) + v
    this.save()
  }

  // What the crew's work cost, under the savers that were on: { cost, tokens, turns, tasks, tools }.
  spend(mode, counts) {
    const m = (this.data.modes[mode] ??= { since: Date.now() })
    let any = false
    for (const [k, v] of Object.entries(counts)) if (Number.isFinite(v) && v) (m[k] = (m[k] ?? 0) + v), (any = true)
    if (any) (m.last = Date.now()), this.save()
  }

  // Debounced; `now` on quit. A failed write (the folder gone) must never take anything down.
  save(now = false) {
    clearTimeout(this.timer)
    const write = () => {
      const cutoff = localDay(Date.now() - KEEP_DAYS * 864e5)
      for (const d of Object.keys(this.data.days)) if (d < cutoff) delete this.data.days[d]
      try {
        fs.writeFileSync(this.file, JSON.stringify(this.data))
      } catch {}
    }
    if (now) return write()
    this.timer = setTimeout(write, 2000)
    this.timer.unref?.()
  }
}

// Ledgers added up (every workspace's, or the last `days` days of one): { since, savers: { id: { on, off } }, modes }.
export function report(ledgers, { days } = {}) {
  const from = days ? localDay(Date.now() - (days - 1) * 864e5) : ''
  const out = { since: Math.min(Date.now(), ...ledgers.map((l) => l.data.since)), savers: {}, modes: {} }
  const sum = (into, counts) => {
    for (const [k, v] of Object.entries(counts ?? {})) if (typeof v === 'number' && k !== 'since' && k !== 'last') into[k] = (into[k] ?? 0) + v
  }
  for (const l of ledgers) {
    for (const [d, byId] of Object.entries(l.data.days)) {
      if (d < from) continue
      for (const [id, sides] of Object.entries(byId)) {
        const s = (out.savers[id] ??= { on: {}, off: {} })
        sum(s.on, sides.on)
        sum(s.off, sides.off)
      }
    }
    for (const [mode, m] of Object.entries(l.data.modes)) sum((out.modes[mode] ??= {}), m)
  }
  return out
}

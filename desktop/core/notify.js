// Calmer notifications: when CLIque may interrupt you, and with what.
//
// Everything an agent needs from you still lands in the needs-you queue, the menu bar's count and the chat, whatever
// this file decides. What it governs is the interruption: the notification the system shows (and the sound it plays).
//
//   - a schedule ("Notify me every day from 8:00 to 22:00") and a pause ("for 1 hour") hold notifications, and when
//     the quiet time ends there is one summary of what still waits, not a burst;
//   - nothing pings for the place you're looking at;
//   - several things within a moment become one notification ("3 agents need you");
//   - one ping per matter: the same question never pings twice, and a card answered somewhere else (a phone, the
//     terminal) takes its notification away;
//   - the text is one clean line (preview).
//
// The decisions are pure functions (quietNow, decide, compose, preview): given the event, the time, the preferences,
// what you're looking at and what's already shown. Calm keeps the little state between them and is told everything it
// needs from outside (the clock, the timers, how to show a notification), so main.js only applies it and the tests
// drive it with a made-up clock.

export const DAYS = ['always', 'every', 'weekdays']
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const MIN = 60 * 1000
const HOUR = 60 * MIN

// How long things are gathered before one notification shows, and how long after a notification the next one waits:
// agents that ask together arrive as one, and CLIque never pings more than once in GAP.
export const BATCH = 2500
export const GAP = 20 * 1000
// A matter whose agent was never seen waiting (a question lifted out of a thread) is remembered this long, so the
// same line doesn't ping twice; one that waits is remembered until it's answered.
export const REMEMBER = 10 * MIN
const TIMER_MAX = 12 * HOUR // a timer further off than this is set again when it fires

// ---- preferences ---------------------------------------------------------------------------------------------------

// config.json's `notifications`, made whole: { days: 'always' | 'every' | 'weekdays', from: 'HH:MM', to: 'HH:MM',
// pause: null | { until: ms | null } } (until null: until you turn them back on). Nothing saved: any time, not paused.
export function prefsOf(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const pause = r.pause && typeof r.pause === 'object' ? { until: Number.isFinite(r.pause.until) ? r.pause.until : null } : null
  return {
    days: DAYS.includes(r.days) ? r.days : 'always',
    from: HHMM.test(r.from) ? r.from : '08:00',
    to: HHMM.test(r.to) ? r.to : '22:00',
    pause,
  }
}

// What config.json keeps: only what isn't the default, so an untouched install has no `notifications` at all.
export function prefsToSave(prefs) {
  const p = prefsOf(prefs)
  const out = {}
  if (p.days !== 'always') out.days = p.days
  if (p.from !== '08:00') out.from = p.from
  if (p.to !== '22:00') out.to = p.to
  if (p.pause) out.pause = p.pause
  return Object.keys(out).length ? out : null
}

// A change from the preferences ({ days, from, to }) or the tray ({ pause: 'hour' | 'morning' | 'manual' | 'off' })
// -> the whole preferences, or an error that says what's wrong in words.
export function changed(current, patch, now = Date.now()) {
  const p = prefsOf(current)
  const next = { ...p }
  if (!patch || typeof patch !== 'object') throw new Error('nothing to change')
  if ('days' in patch) {
    if (!DAYS.includes(patch.days)) throw new Error(`notifications are for any time, every day or weekdays, not "${patch.days}"`)
    next.days = patch.days
  }
  for (const k of ['from', 'to']) {
    if (!(k in patch)) continue
    if (!HHMM.test(patch[k])) throw new Error(`"${patch[k]}" isn't a time of day like 08:00`)
    next[k] = patch[k]
  }
  if ('pause' in patch) next.pause = pauseFor(patch.pause, next, now)
  else if (next.pause && next.pause.until !== null && next.pause.until <= now) next.pause = null // one that ran out
  return next
}

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const at = (day, mins) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, mins).getTime()
const dayOn = (prefs, d) => prefs.days === 'every' || (d.getDay() >= 1 && d.getDay() <= 5)

// The stretches you're notified in around `now`, soonest last: one per allowed day, from `from` to `to`; a `to` at or
// before `from` ends the next day (22:00 to 6:00), and the same time twice is the whole day.
function windows(prefs, now) {
  const [from, to] = [minutes(prefs.from), minutes(prefs.to)]
  const list = []
  for (let i = -1; i <= 8; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    if (!dayOn(prefs, day)) continue
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
    list.push([at(day, from), to > from ? at(day, to) : at(next, to)])
  }
  return list
}

// The schedule alone at `ms`: { on, changes } — whether you're notified then, and when that next changes (null: never).
function scheduleAt(prefs, ms) {
  if (prefs.days === 'always' || (prefs.days === 'every' && prefs.from === prefs.to)) return { on: true, changes: null }
  const list = windows(prefs, new Date(ms))
  const inside = list.filter(([a, b]) => ms >= a && ms < b)
  if (inside.length) {
    // windows that touch (every day, 8:00 to 8:00) run on as one
    let end = Math.max(...inside.map(([, b]) => b))
    for (const [a, b] of list) if (a <= end && b > end) end = b
    return { on: true, changes: end }
  }
  const next = list.map(([a]) => a).filter((a) => a > ms).sort((x, y) => x - y)[0]
  return { on: false, changes: next ?? null }
}

// Are notifications held right now? -> { quiet, why: 'pause' | 'schedule' | null, until } — until: when they come back
// (ms), or null for a pause you end yourself. A pause that runs out inside the schedule's quiet hours hands over to
// them: `until` is then the schedule's.
export function quietNow(prefs, now = Date.now()) {
  const p = prefsOf(prefs)
  const paused = Boolean(p.pause) && (p.pause.until === null || now < p.pause.until)
  if (paused && p.pause.until === null) return { quiet: true, why: 'pause', until: null }
  const after = paused ? p.pause.until : now
  const s = scheduleAt(p, after)
  if (paused) return { quiet: true, why: 'pause', until: s.on ? after : s.changes }
  return s.on ? { quiet: false, why: null, until: null } : { quiet: true, why: 'schedule', until: s.changes }
}

// When what quietNow says next changes (the summary is due, or the tray should say "held"): ms, or null.
export function nextChange(prefs, now = Date.now()) {
  const p = prefsOf(prefs)
  const q = quietNow(p, now)
  if (q.quiet) return q.until
  return scheduleAt(p, now).changes
}

// "Until tomorrow morning": the schedule's start time (8:00 without one) on the next day; before 5 in the morning,
// "tomorrow morning" is the one a few hours off.
export function morningAfter(prefs, now = Date.now()) {
  const p = prefsOf(prefs)
  const d = new Date(now)
  const mins = p.days === 'always' ? 8 * 60 : minutes(p.from)
  const today = at(d, mins)
  if (d.getHours() < 5 && today > now) return today
  return at(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), mins)
}

// A pause from the tray: 'hour', 'morning' or 'manual' -> what `pause` becomes; 'off' -> null.
export function pauseFor(choice, prefs, now = Date.now()) {
  if (choice === 'hour') return { until: now + HOUR }
  if (choice === 'morning') return { until: morningAfter(prefs, now) }
  if (choice === 'manual') return { until: null }
  if (choice === 'off') return null
  throw new Error(`notifications pause for an hour, until the morning or until you turn them back on, not "${choice}"`)
}

// ---- the text ------------------------------------------------------------------------------------------------------

// Things that look like a secret, each replaced by "[hidden]": well-known key shapes, a value after "token:" or
// "password=", a private key, and any long run of mixed letters and digits (or hex), which is what keys look like.
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bA[KS]IA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
]
const NAMED_SECRET = /\b([A-Za-z0-9_-]*(?:api[_-]?key|secret|token|passwd|password|authorization)[A-Za-z0-9_-]*)(\s*[:=]\s*)(["']?)[^\s"',;]{6,}\3/gi
const LONG = /[A-Za-z0-9+_=-]{32,}/g
const looksLikeKey = (s) => /\d/.test(s) && (/^[0-9a-f]+$/i.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s)))

export function hideSecrets(text) {
  let out = String(text)
  for (const re of SECRETS) out = out.replace(re, '[hidden]')
  out = out.replace(NAMED_SECRET, (_m, name, sep) => `${name}${sep}[hidden]`)
  return out.replace(LONG, (m) => (looksLikeKey(m) ? '[hidden]' : m))
}

const cut = (text, max) => {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text
}

// One clean line for a notification: code blocks out, links as their words, addresses as their site's name, markdown's
// marks gone, nothing that looks like a secret, and no longer than `max`.
export function preview(text, max = 140) {
  const plain = String(text ?? '').slice(0, 20000)
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/\bhttps?:\/\/[^\s<>()\]]+/gi, (url) => {
      const end = /[.,:;!?'"]+$/.exec(url)?.[0] ?? '' // the sentence's own mark after it
      try {
        return new URL(end ? url.slice(0, -end.length) : url).hostname.replace(/^www\./, '') + end
      } catch {
        return ''
      }
    })
    .replace(/<\/?[a-z][^>\n]*>/gi, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ')
    .replace(/(\*{1,3}|_{2,3}|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/`+/g, '')
    .replace(/\\([\\`*_{}[\]()#+.!-])/g, '$1')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​‎‏‪-‮⁠⁦-⁩]/g, '')
  // lines become one: a line that ends a sentence runs on, any other gets a dot between
  const line = hideSecrets(plain).replace(/[ \t]*\|[ \t]*/g, ' ').split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .reduce((out, l) => (!out ? l : `${out}${/[.:;!?,…]$/.test(out) ? ' ' : ' · '}${l}`), '')
  return cut(line, max)
}

// ---- the decisions -------------------------------------------------------------------------------------------------

// An agent and its clones are one conversation ("Theo.2" is Theo's).
export const familyOf = (name) => String(name ?? '').replace(/\.(\d+)(?=@|$)/, '')
const shown = (name) => String(name ?? '').replace(/\.(\d+)(?=@|$)/, ' (clone $1)')

// What an event is about, so the same thing is known when it comes again: an agent needing you is one matter per agent;
// a notice is one per thing it's about and what it says.
export const matterOf = (e) => (e.kind === 'alert' ? `alert\n${e.ws ?? ''}\n${e.name}` : `notice\n${e.ws ?? ''}\n${e.focus ?? ''}\n${e.title}`)

// Are you looking at where this event shows? views: what each focused window has open: { ws, agent (the conversation's,
// by family name), sees (agents whose question is on screen in the open channel), tasks (the Tasks board is open) }.
// A window that isn't focused isn't in the list, so a chat left open behind another app still notifies.
export function lookingAt(e, views = []) {
  return views.some((v) => {
    if (!v || (v.ws ?? '') !== (e.ws ?? '')) return false
    if (e.kind === 'alert') return (Boolean(v.agent) && familyOf(v.agent) === familyOf(e.name)) || (v.sees ?? []).includes(e.name)
    if (!e.focus) return false // an account's limit is nowhere in particular
    if (/^(task|bug):/.test(e.focus)) return Boolean(v.tasks)
    return Boolean(v.agent) && familyOf(v.agent) === familyOf(e.focus)
  })
}

// An event as it arrives -> { do: 'drop' | 'hold' | 'coalesce' | 'notify', why }.
//   known: what's remembered of its matter, if anything: { text, state: 'pending' | 'held' | 'shown' | 'seen' }
//   quiet: quietNow()'s answer; looking: lookingAt()'s; gathering: a notification is already being put together
export function decide(e, { known = null, quiet = { quiet: false }, looking = false, gathering = false } = {}) {
  if (known && known.text === e.text && (known.state === 'shown' || known.state === 'seen')) return { do: 'drop', why: 'already told' }
  if (known && (known.state === 'pending' || known.state === 'held')) return { do: 'coalesce', why: known.state === 'held' ? 'already held' : 'already gathering' }
  if (quiet.quiet) return { do: 'hold', why: quiet.why }
  if (looking) return { do: 'drop', why: 'looking' }
  return gathering ? { do: 'coalesce', why: 'gathering' } : { do: 'notify', why: 'first' }
}

const namesList = (names, max = 3) => {
  if (names.length <= 1) return names.join('')
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

// The one notification for these events -> { title, body, target: { ws, focus }, items }. label(ws): the workspace's
// name when there's more than one ("Storefront"), else ''. held: 'pause' | 'schedule' when this is the summary after a
// quiet time.
export function compose(items, { label = () => '', held = null } = {}) {
  if (!items.length) return null
  const alerts = []
  for (const e of items) if (e.kind === 'alert' && !alerts.some((x) => x.ws === e.ws && x.name === e.name)) alerts.push(e)
  const notices = items.filter((e) => e.kind === 'notice')
  const all = [...alerts, ...notices]
  const places = new Set(all.map((e) => e.ws ?? ''))
  const where = places.size === 1 && label([...places][0]) ? `${label([...places][0])} · ` : ''
  const first = alerts[0] ?? notices[0]
  const target = { ws: first.ws ?? '', focus: first.kind === 'alert' ? first.name : first.focus ?? '' }
  const after = held ? `Held while notifications were ${held === 'pause' ? 'paused' : 'off'}.` : ''
  if (all.length === 1) {
    const body = preview(first.kind === 'alert' ? first.text : first.body)
    return {
      title: cut(first.kind === 'alert' ? `${where}${shown(first.name)} needs you` : `${where}${preview(first.title, 90)}`, 100),
      body: [body, after].filter(Boolean).join(body && !/[.!?…]$/.test(body) ? ' · ' : ' '),
      target, items: all,
    }
  }
  const updates = notices.length ? `${notices.length} update${notices.length > 1 ? 's' : ''}` : ''
  const needs = alerts.length > 1 ? `${alerts.length} agents need you` : alerts.length ? `${shown(alerts[0].name)} needs you` : ''
  // with more than one workspace in it, each name says where it is
  const who = (e) => `${shown(e.name)}${places.size > 1 && label(e.ws) ? ` in ${label(e.ws)}` : ''}`
  const lines = [
    alerts.length > 1 ? namesList(alerts.map(who)) : alerts.length ? preview(alerts[0].text, 90) : '',
    notices.length ? namesList(notices.map((n) => preview(n.title, 60)), 2) : '',
  ].filter(Boolean)
  const body = cut(lines.join(' · '), 170)
  return { title: `${where}${[needs, updates].filter(Boolean).join(' · ')}`, body: [body, after].filter(Boolean).join(/[.!?…]$/.test(body) ? ' ' : '. '), target, items: all }
}

// ---- Calm: the state between the decisions ---------------------------------------------------------------------------

// new Calm({ prefs, now, after, show, views, needs, label, changed, log })
//   prefs()            -> config.json's notifications
//   now()              -> ms;  after(ms, fn) -> cancel()   (the clock and the timers)
//   show(note, shown)  -> { close() }   puts a notification up; shown() is called when the system has, and returns
//                         false when it shouldn't be there any more (the caller then closes it)
//   views()            -> what each focused window has open (lookingAt)
//   needs(ws, name)    -> is this agent still waiting for you
//   label(ws)          -> the workspace's name, when there's more than one
//   changed()          -> quiet time began or ended (the tray says so)
//   log(line)          -> what was decided, for the driver and the tests
export class Calm {
  constructor({ prefs, now = Date.now, after = (ms, fn) => {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  }, show, views = () => [], needs = () => true, label = () => '', changed = () => {}, log = () => {} }) {
    Object.assign(this, { prefs, now, after, show, views, needs, label, changed, log })
    this.matters = new Map() // matterOf -> { e, text, state, waited, at, note }
    this.pending = [] // events being gathered into the next notification
    this.held = [] // events kept through a quiet time
    this.notes = new Set() // notifications on screen: { handle, alerts: Set of matters, sticky }
    this.lastShown = -Infinity
    this.flushTimer = null
    this.clock = null
    this.wasQuiet = this.quiet().quiet
    this.arm()
  }

  quiet() {
    return quietNow(this.prefs(), this.now())
  }

  // For the tray and the preferences: are notifications held, why, until when, and how much is being kept.
  view() {
    const q = this.quiet()
    return { quiet: q.quiet, why: q.why, until: q.until, held: this.heldNow().length }
  }

  alert(name, text, ws = '') {
    this.take({ kind: 'alert', ws: ws ?? '', name, text: String(text ?? '') })
  }

  notice({ title, body, focus, workspace }) {
    this.take({ kind: 'notice', ws: workspace ?? '', title: String(title ?? ''), text: String(body ?? ''), body: String(body ?? ''), focus: focus ?? '' })
  }

  take(e) {
    this.forget()
    const key = matterOf(e)
    const known = this.matters.get(key) ?? null
    const verdict = decide(e, { known, quiet: this.quiet(), looking: lookingAt(e, this.views()), gathering: this.pending.length > 0 })
    this.log(`${verdict.do.padEnd(8)} ${e.kind === 'alert' ? `${e.name} needs you` : e.title}  (${verdict.why})`)
    if (verdict.do === 'drop') {
      // remembered either way, so the same words don't ping once you look away
      if (verdict.why === 'looking') {
        if (known?.note) known.note.alerts.delete(key)
        this.matters.set(key, { e, text: e.text, state: 'seen', waited: known?.waited ?? false, at: this.now() })
        if (e.kind === 'alert') this.after(0, () => this.settle())
      } else known.at = this.now()
      return verdict
    }
    if (known && (known.state === 'pending' || known.state === 'held')) {
      // the same agent asking something else before the first was shown: one line, the newer words
      Object.assign(known.e, e)
      known.text = e.text
      return verdict
    }
    const m = { e, text: e.text, state: verdict.do === 'hold' ? 'held' : 'pending', waited: known?.waited ?? false, at: this.now() }
    if (known?.note) known.note.alerts.delete(key) // the older notification is no longer this matter's
    this.matters.set(key, m)
    if (m.state === 'held') this.held.push(e)
    else {
      this.pending.push(e)
      if (!this.flushTimer) this.flushTimer = this.after(Math.max(BATCH, this.lastShown + GAP - this.now()), () => this.flush())
    }
    // the hub says "needs you" a moment before the agent's status says waiting: look once that has settled
    if (e.kind === 'alert') this.after(0, () => this.settle())
    return verdict
  }

  // The gathered events become one notification, checked again at this moment: a quiet time that began meanwhile holds
  // them, a card answered meanwhile is gone, and the place you've opened meanwhile needs no ping.
  flush() {
    this.flushTimer = null
    const items = this.pending
    this.pending = []
    if (!items.length) return
    const q = this.quiet()
    if (q.quiet) {
      for (const e of items) this.matters.get(matterOf(e)).state = 'held'
      this.held.push(...items)
      this.log(`hold     ${items.length} gathered  (${q.why} began)`)
      return
    }
    this.put(items, null)
  }

  // Which of these still deserve a notification: not answered, not on screen in front of you.
  still(items) {
    const views = this.views()
    return items.filter((e) => {
      const m = this.matters.get(matterOf(e))
      if (!m) return false
      if (e.kind === 'alert' && this.needs(e.ws, e.name)) m.waited = true
      else if (e.kind === 'alert' && m.waited) {
        this.matters.delete(matterOf(e))
        this.log(`drop     ${e.name} needs you  (answered meanwhile)`)
        return false
      }
      if (lookingAt(e, views)) {
        Object.assign(m, { state: 'seen', at: this.now() })
        this.log(`drop     ${e.kind === 'alert' ? `${e.name} needs you` : e.title}  (looking)`)
        return false
      }
      return true
    })
  }

  put(items, held) {
    const left = this.still(items)
    const note = compose(left, { label: this.label, held })
    if (!note) return null
    const record = { alerts: new Set(left.filter((e) => e.kind === 'alert').map(matterOf)), sticky: left.some((e) => e.kind === 'notice'), handle: null }
    for (const e of left) Object.assign(this.matters.get(matterOf(e)), { state: 'shown', at: this.now(), note: record })
    this.lastShown = this.now()
    this.log(`show     "${note.title}" — ${note.body}`)
    // the system shows it a moment later: if by then quiet time began or everyone in it was answered, it comes down
    record.handle = this.show(note, () => !this.quiet().quiet && (record.sticky || record.alerts.size > 0)) ?? null
    this.notes.add(record)
    if (this.notes.size > 40) this.notes.delete(this.notes.values().next().value) // ones the system never said were closed
    return note
  }

  // A notification went away (clicked, closed, swept by the system): nothing to keep of it.
  gone(handle) {
    for (const n of this.notes) if (n.handle === handle) this.notes.delete(n)
  }

  heldNow() {
    return this.held.filter((e) => this.matters.get(matterOf(e))?.state === 'held')
  }

  // Something changed in the clique: agents who no longer wait for you have been answered (here, on a phone, in their
  // terminal), so their notification comes down and nothing is kept of the matter.
  settle() {
    for (const [key, m] of this.matters) {
      if (m.e.kind !== 'alert') continue
      const waits = Boolean(this.needs(m.e.ws, m.e.name))
      if (waits) {
        m.waited = true
        continue
      }
      if (!m.waited) continue
      this.matters.delete(key)
      if (m.state === 'pending') this.pending = this.pending.filter((e) => matterOf(e) !== key)
      if (m.state === 'held') this.held = this.held.filter((e) => matterOf(e) !== key)
      if (m.state !== 'shown') this.log(`drop     ${m.e.name} needs you  (answered before it was shown)`)
      const note = m.note
      if (!note || !this.notes.has(note)) continue
      note.alerts.delete(key)
      if (!note.alerts.size && !note.sticky) {
        this.notes.delete(note)
        this.log(`close    ${m.e.name} was answered: its notification comes down`)
        try {
          note.handle?.close()
        } catch {}
      }
    }
    this.forget()
  }

  // Matters told (or seen) long enough ago that the same words may ping again. One whose agent still waits stays.
  forget() {
    const now = this.now()
    for (const [key, m] of this.matters) {
      if (m.state !== 'shown' && m.state !== 'seen') continue
      const keep = m.e.kind === 'alert' && m.waited ? Infinity : REMEMBER
      if (now - m.at > keep) this.matters.delete(key)
    }
  }

  // The preferences changed, or the clock reached the next change: when a quiet time has ended, one summary of what
  // still waits.
  tick() {
    const q = this.quiet()
    if (this.wasQuiet && !q.quiet) this.release(this.wasWhy)
    if (q.quiet !== this.wasQuiet || q.why !== this.wasWhy) this.changed()
    this.wasQuiet = q.quiet
    this.wasWhy = q.why
    this.arm()
  }

  release(why) {
    const items = this.heldNow()
    this.held = []
    if (!items.length) return this.log('quiet time over: nothing was held')
    this.log(`quiet time over: ${items.length} held`)
    if (this.flushTimer) (this.flushTimer(), (this.flushTimer = null))
    const gathered = this.pending
    this.pending = []
    if (!this.put([...items, ...gathered], why ?? 'schedule')) this.log('          nothing still waits: no summary')
  }

  arm() {
    this.clock?.()
    this.clock = null
    this.wasWhy = this.quiet().why
    const next = nextChange(this.prefs(), this.now())
    if (next === null) return
    this.clock = this.after(Math.min(Math.max(next - this.now(), 0) + 50, TIMER_MAX), () => {
      this.clock = null
      this.tick()
    })
  }

  stop() {
    this.clock?.()
    this.flushTimer?.()
    this.clock = this.flushTimer = null
  }
}

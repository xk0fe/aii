// Scheduled messages: something you'd send an agent or a channel, sent for you at a time, once or on a repeat
// ("every weekday at 9:00, @ada check CI"). A workspace keeps its own, in schedules.json beside its chat. This file is
// the rules (when one runs next, in wall-clock time) and the list; Clique.runSchedules (core/clique.js) sends what's
// due through Clique.send, the way your own message goes. No Electron in here.
//
// A rule is wall-clock: { repeat, date: 'YYYY-MM-DD', time: 'HH:MM' }, read in the computer's time zone when the next
// run is worked out, so 9:00 stays 9:00 across a clock change and on a laptop that travels.
//   once      on `date` at `time`
//   daily     every day at `time`, from `date`
//   weekdays  Monday to Friday at `time`, from `date`
//   weekly    at `time` on `date`'s day of the week, from `date`
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const REPEATS = ['once', 'daily', 'weekdays', 'weekly']
export const TICK = 15000 // how often what's due is looked for
export const LATE_AFTER = 2 * 60000 // sent later than this after it was due, a message says it went late
export const LATE_MAX = 6 * 3600000 // ...and past this it isn't sent at all: the moment has gone
export const TEXT_MAX = 16000
export const MAX = 100 // schedules in one workspace

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

// ---- wall-clock time in a zone ------------------------------------------------------------------------------------

export const zoneNow = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const FORMATS = new Map()
const formatIn = (tz) => {
  if (!FORMATS.has(tz)) FORMATS.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }))
  return FORMATS.get(tz)
}

// What the clocks in `tz` say at `ms`. -> { y, mo (1-12), d, h, mi, dow (0 Sunday) }
export function wallAt(ms, tz = zoneNow()) {
  const p = Object.fromEntries(formatIn(tz).formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]))
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() }
}

// When the clocks in `tz` say this. A time the clocks skip (02:30 on the night they go forward) is the moment an hour
// on (03:30); one they show twice (01:30 on the night they go back) is the first of the two.
export function wallToMs({ y, mo, d, h, mi }, tz = zoneNow()) {
  const wanted = Date.UTC(y, mo - 1, d, h, mi)
  const offset = (ms) => {
    const w = wallAt(ms, tz)
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / 60000) * 60000
  }
  const a = wanted - offset(wanted)
  const b = wanted - offset(a)
  const fits = (ms) => ms + offset(ms) === wanted
  const first = [a, b, a - 3600000, b - 3600000, a - 1800000, b - 1800000].filter(fits)
  return first.length ? Math.min(...first) : Math.max(a, b)
}

const dayOf = (date) => {
  const [y, mo, d] = String(date).split('-').map(Number)
  return { y, mo, d }
}
const dateText = ({ y, mo, d }) => `${y}-${pad(mo)}-${pad(d)}`
const plusDays = ({ y, mo, d }, n) => {
  const t = new Date(Date.UTC(y, mo - 1, d + n))
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
const dowOf = ({ y, mo, d }) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay()

// Today's date where the clocks are `tz`, n days on.
export const dateIn = (ms, tz = zoneNow(), plus = 0) => dateText(plusDays(wallAt(ms, tz), plus))

// ---- the rule -----------------------------------------------------------------------------------------------------

// "9", "9:00", "09:00", "9am", "5:30 pm" -> 'HH:MM'
export function timeOf(raw) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(String(raw ?? '').trim())
  if (!m) throw new Error(`give the time like 9:00 or 17:30, not ${String(raw ?? '').trim() || 'nothing'}`)
  let h = Number(m[1])
  const mi = Number(m[2] ?? 0)
  const half = m[3]?.toLowerCase()
  if (half && (h < 1 || h > 12)) throw new Error(`there's no ${m[1]}${half}`)
  if (half === 'pm' && h < 12) h += 12
  if (half === 'am' && h === 12) h = 0
  if (h > 23 || mi > 59) throw new Error(`there's no ${String(raw).trim()} on the clock`)
  return `${pad(h)}:${pad(mi)}`
}

// 'YYYY-MM-DD', checked to be a real day.
export function dateOf(raw) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(raw ?? '').trim())
  if (!m) throw new Error(`give the day like 2026-11-17, not ${String(raw ?? '').trim() || 'nothing'}`)
  const day = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }
  const back = plusDays(day, 0)
  if (back.y !== day.y || back.mo !== day.mo || back.d !== day.d) throw new Error(`there's no such day as ${raw}`)
  return dateText(day)
}

// A rule as given -> { repeat, date, time }, or an error in plain words.
export function ruleOf({ repeat = 'once', date, time } = {}) {
  if (!REPEATS.includes(repeat)) throw new Error(`a schedule repeats ${REPEATS.join(', ')}, not ${repeat}`)
  return { repeat, date: dateOf(date), time: timeOf(time) }
}

const runsOn = (rule, day) => rule.repeat === 'daily' || (rule.repeat === 'weekdays' && dowOf(day) >= 1 && dowOf(day) <= 5) || (rule.repeat === 'weekly' && dowOf(day) === dowOf(dayOf(rule.date)))

// When a rule runs next, after `after` (ms). null: a one-off whose time has passed.
export function nextRun(rule, after, tz = zoneNow()) {
  const [h, mi] = rule.time.split(':').map(Number)
  const start = dayOf(rule.date)
  if (rule.repeat === 'once') {
    const at = wallToMs({ ...start, h, mi }, tz)
    return at > after ? at : null
  }
  const today = wallAt(after, tz)
  const todayText = dateText(today)
  let day = rule.date > todayText ? start : today
  for (let i = 0; i < 9; i++, day = plusDays(day, 1)) {
    if (!runsOn(rule, day)) continue
    const at = wallToMs({ ...day, h, mi }, tz)
    if (at > after) return at
  }
  return null
}

const clock = (time) => `${Number(time.slice(0, 2))}:${time.slice(3)}`
const dayText = (date) => {
  const day = dayOf(date)
  return `${DAYS[dowOf(day)].slice(0, 3)} ${day.d} ${MONTHS[day.mo - 1]}`
}

// A rule in words: "every weekday at 9:00", "once, Tue 17 Nov at 9:00".
export function ruleText(rule) {
  const at = `at ${clock(rule.time)}`
  if (rule.repeat === 'daily') return `every day ${at}`
  if (rule.repeat === 'weekdays') return `every weekday ${at}`
  if (rule.repeat === 'weekly') return `every ${DAYS[dowOf(dayOf(rule.date))]} ${at}`
  return `once, ${dayText(rule.date)} ${at}`
}

// A moment in words, for the chat and for agents: "Tue 17 Nov at 9:00".
export function whenText(ms, tz = zoneNow()) {
  const w = wallAt(ms, tz)
  return `${DAYS[w.dow].slice(0, 3)} ${w.d} ${MONTHS[w.mo - 1]} at ${w.h}:${pad(w.mi)}`
}

// What an agent says for when (`clique app schedule add … --at 9 --every weekday --on monday`) -> a rule.
//   every: day | weekday | a day's name; without it, once
//   on:    the day it (first) runs: today, tomorrow, a day's name, or 2026-11-17; without it, the next time `at` comes
export function ruleFromWords({ at, every, on }, now = Date.now(), tz = zoneNow()) {
  const time = timeOf(at)
  const [h, mi] = time.split(':').map(Number)
  const today = wallAt(now, tz)
  const named = (word) => DAYS.findIndex((d) => d.toLowerCase() === word || d.slice(0, 3).toLowerCase() === word)
  // the next day that's `dow`, today counting while its time is still ahead
  const nextOn = (dow) => {
    for (let i = 0; i < 8; i++) {
      const day = plusDays(today, i)
      if (dowOf(day) === dow && wallToMs({ ...day, h, mi }, tz) > now) return day
    }
    return plusDays(today, 7)
  }
  const e = String(every ?? '').trim().toLowerCase().replace(/s$/, '')
  let repeat = 'once'
  let day = null
  if (e) {
    if (e === 'day' || e === 'daily') repeat = 'daily'
    else if (e === 'weekday') repeat = 'weekdays'
    else if (named(e) >= 0) (repeat = 'weekly'), (day = nextOn(named(e)))
    else throw new Error(`--every is day, weekday, or a day's name (monday), not ${every}`)
  }
  const o = String(on ?? '').trim().toLowerCase()
  if (o) {
    const given = o === 'today' ? today : o === 'tomorrow' ? plusDays(today, 1) : named(o) >= 0 ? nextOn(named(o)) : dayOf(dateOf(o))
    if (repeat === 'weekly' && dowOf(given) !== dowOf(day)) throw new Error(`--on ${on} isn't a ${DAYS[dowOf(day)]}: leave --on off, or give one that is`)
    day = given
  }
  day ??= wallToMs({ ...today, h, mi }, tz) > now ? today : plusDays(today, 1)
  const rule = { repeat, date: dateText(day), time }
  if (repeat === 'once' && nextRun(rule, now, tz) === null) throw new Error(`${ruleText(rule).replace(/^once, /, '')} has passed already`)
  return rule
}

// ---- "only when the repo changed" ----------------------------------------------------------------------------------
// A repeating schedule can run only when its workspace's folder has changed since its last run finished. Told by
// code, with no model call: git's HEAD, and each file git says is changed or new, with its size and when it was last
// written. null: not a repo (or no git): nothing to go by, so the schedule runs.

const expand = (dir) => String(dir ?? '').replace(/^~(?=[\\/]|$)/, os.homedir())
const git = (cwd, args) => new Promise((resolve, reject) => execFile('git', args, { cwd, timeout: 8000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(String(out)))))
const hash = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(36)
}

export async function repoMark(folder) {
  const cwd = expand(folder)
  if (!cwd) return null
  try {
    const top = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
    const head = (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']).catch(() => 'none')).trim()
    const status = await git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all'])
    const files = status.split('\0').filter(Boolean).slice(0, 2000).map((line) => {
      let stamp = ''
      try {
        const st = fs.statSync(path.join(top, line.slice(3)))
        stamp = `${st.size}@${Math.round(st.mtimeMs)}`
      } catch {}
      return `${line}=${stamp}`
    })
    return `${head}:${hash(files.join('\n'))}`
  } catch {
    return null
  }
}

// Is a folder inside a git repo? (Looked for on disk: the option is only offered where it can work.)
const REPOS = new Map() // folder -> { at, yes }
export function inRepo(folder, now = Date.now()) {
  const given = expand(folder)
  if (!given) return false
  const known = REPOS.get(given)
  if (known && now - known.at < 60000) return known.yes
  let yes = false
  for (let dir = path.resolve(given), i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      yes = true
      break
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  REPOS.set(given, { at: now, yes })
  return yes
}

// ---- a workspace's list ------------------------------------------------------------------------------------------

// What makes two schedules the same one: the words, who gets them, where, and when.
const sameKey = (s) => JSON.stringify([squash(s.text).toLowerCase(), names(s.to), s.channel ?? '', s.repeat, s.repeat === 'daily' || s.repeat === 'weekdays' ? '' : s.repeat === 'weekly' ? dowOf(dayOf(s.date)) : s.date, s.time, Boolean(s.ifChanged), (s.images ?? []).join('|')])
const names = (to) => [...new Set(String(to ?? '').split(/[\s,]+/).map((n) => n.replace(/^@/, '').trim()).filter(Boolean))].sort().join(',')

export class Schedules {
  // file: schedules.json in the workspace's folder. A file that can't be read is left as it is and nothing is
  // scheduled (saving over it would lose what it held).
  constructor(file) {
    this.file = file
    this.all = []
    this.broken = false
    let text = null
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {}
    if (text === null) return
    try {
      const data = JSON.parse(text)
      // (one that isn't a schedule, in a file edited by hand, is left out rather than tripping every run)
      this.all = (Array.isArray(data?.schedules) ? data.schedules : []).filter((s) => {
        try {
          return Boolean(s && typeof s.id === 'string' && typeof s.text === 'string' && s.text.trim() && typeof (s.to ?? '') === 'string' && ruleOf(s))
        } catch {
          return false
        }
      }).map((s) => ({ ...s, to: s.to ?? '' }))
    } catch {
      this.broken = true
    }
  }

  save() {
    if (this.broken) return
    const tmp = `${this.file}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify({ schedules: this.all }, null, 2) + '\n')
      fs.renameSync(tmp, this.file)
    } catch {}
  }

  get(id) {
    const s = this.all.find((x) => x.id === String(id ?? '').trim().toLowerCase())
    if (!s) throw new Error(`there's no schedule ${String(id ?? '').trim() || 'like that'} here`)
    return s
  }

  // The fields a schedule is made of, checked. -> { text, to, channel?, images?, repeat, date, time, ifChanged? }
  fields({ text, to, channel, images, repeat, date, time, ifChanged }) {
    text = String(text ?? '').trim()
    if (!text) throw new Error('write the message to send first')
    if (text.length > TEXT_MAX) throw new Error('that message is too long to schedule')
    const rule = ruleOf({ repeat, date, time })
    return {
      text, to: names(to), ...(channel && channel !== 'general' && { channel: String(channel) }),
      ...(Array.isArray(images) && images.length && { images: images.map(String) }),
      ...rule, ...(ifChanged && rule.repeat !== 'once' && { ifChanged: true }),
    }
  }

  // A new one. The same message to the same place on the same rule is kept as the one there is: -> { schedule, same }
  add(input, { by = 'you', now = Date.now(), tz = zoneNow() } = {}) {
    if (this.broken) throw new Error("this workspace's schedules.json can't be read: fix or remove the file first")
    const f = this.fields(input)
    const same = this.all.find((s) => sameKey(s) === sameKey(f))
    if (same) return { schedule: same, same: true }
    if (this.all.length >= MAX) throw new Error(`a workspace holds ${MAX} schedules: remove one first`)
    const next = nextRun(f, now, tz)
    if (next === null) throw new Error('that time has passed already: pick one that is still to come')
    let id
    do id = randomUUID().slice(0, 4)
    while (this.all.some((s) => s.id === id))
    const schedule = { id, ...f, by, created: now, next, zone: tz }
    this.all.push(schedule)
    this.save()
    return { schedule, same: false }
  }

  // Changed in the list: its words, who gets it, when. What it has done so far stays; a changed time starts from now.
  edit(id, patch, { now = Date.now(), tz = zoneNow() } = {}) {
    const s = this.get(id)
    const f = this.fields({ ...s, ...patch })
    const twin = this.all.find((x) => x !== s && sameKey(x) === sameKey(f))
    if (twin) throw new Error("there's a schedule just like that already")
    const next = nextRun(f, now, tz)
    if (next === null) throw new Error('that time has passed already: pick one that is still to come')
    for (const k of ['channel', 'images', 'ifChanged']) delete s[k]
    Object.assign(s, f, { next, zone: tz })
    if (!s.ifChanged) (delete s.mark), delete s.settle
    this.save()
    return s
  }

  // Paused, it keeps its place and sends nothing; resumed, it runs at the next time its rule comes (never for the
  // ones that went by).
  pause(id, paused, { now = Date.now(), tz = zoneNow() } = {}) {
    const s = this.get(id)
    if (Boolean(s.paused) === Boolean(paused)) return s
    if (paused) s.paused = true
    else {
      const next = nextRun(s, now, tz)
      if (next === null) throw new Error('its time has passed: change when it runs, or send it now')
      delete s.paused
      Object.assign(s, { next, zone: tz })
    }
    this.save()
    return s
  }

  remove(id) {
    const s = this.get(id)
    this.all.splice(this.all.indexOf(s), 1)
    this.save()
    return s
  }

  // An agent got a new name: what was scheduled for it still is.
  rename(from, to) {
    let changed = false
    for (const s of this.all) {
      const list = s.to ? s.to.split(',') : []
      if (!list.includes(from)) continue
      s.to = names(list.map((n) => (n === from ? to : n)).join(','))
      changed = true
    }
    if (changed) this.save()
  }

  // The list as the app shows it: soonest first, paused and finished ones after.
  view() {
    const rank = (s) => (s.paused || !s.next ? Infinity : s.next)
    return [...this.all].sort((a, b) => rank(a) - rank(b) || a.created - b.created).map(({ mark, settle, zone, told, sent, ...s }) => s)
  }
}

// One line of `clique app schedules`.
export const scheduleLine = (s, tz = zoneNow()) => {
  const state = s.paused ? 'paused' : s.next ? `next ${whenText(s.next, tz)}` : 'not sent'
  const last = s.last ? `last ${lastText(s.last)}` : ''
  return `${s.id}  ${ruleText(s)} · ${s.to ? s.to.split(',').map((n) => `@${n}`).join(' ') : 'whoever fits'}${s.channel ? ` · #${s.channel}` : ''} · ${state}${last ? ` · ${last}` : ''}${s.ifChanged ? ' · only when the repo changed' : ''}\n      ${squash(s.text).slice(0, 160)}`
}

// What its last run came to, in a few words.
export function lastText(last) {
  if (last.result === 'sent') return 'sent'
  if (last.result === 'late') return 'sent late'
  if (last.result === 'busy') return 'skipped: the run before was still going'
  if (last.result === 'unchanged') return 'skipped: nothing changed'
  if (last.result === 'missed') return 'missed'
  return `didn't go out: ${last.why ?? 'something went wrong'}`
}

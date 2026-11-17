// When a model runs out. A Claude plan can give a model a weekly limit of its own on top of the account's: Fable's, say.
// An agent on it then stops with "You've hit your Fable limit · resets Nov 20 at 6am (America/Fortaleza)" while the
// account itself has plenty left, and another model would carry on. What CLIque does then is yours to pick
// (config.json "onModelOut"):
//   switch  the agent goes on with the next model down its provider's list (Fable, then Opus, then Sonnet) until the
//           limit resets, then goes back to its own (the default)
//   wait    it waits for the reset, and CLIque types "continue" for it then
//   tell    it stops and tells you, as any other usage limit does
// The hub does the rest (core/hub.js modelRanOut); this is the reading of what the CLI said, and the picking.

export const ON_MODEL_OUT = ['switch', 'wait', 'tell']
export const onModelOutOf = (config) => (ON_MODEL_OUT.includes(config?.onModelOut) ? config.onModelOut : 'switch')

// The model of a provider's list (its menu: fable, opus, sonnet, haiku) that a model an agent is set to belongs to:
// 'fable', 'fable[1m]' and 'claude-fable-5-2' are all Fable. '' (the CLI's own default) and a model the list doesn't
// know: null.
export function familyOf(model, models = []) {
  const m = String(model ?? '').trim().toLowerCase()
  if (!m) return null
  return models.find((x) => m === x || m.startsWith(`${x}[`) || m.split(/[-_.\s[\]]/).includes(x)) ?? null
}

// A turn's end that says a model ran out, as Claude Code words it: "You've hit your Fable limit · resets …" ("reached"
// in some versions), or "Fable requires usage credits" once what the plan includes of it is used up. The name has to be
// one of the provider's models: a session, weekly, spend or usage credit limit is the account's, and another model
// doesn't get around it. -> { model: 'fable', name: 'Fable', resetsAt: ms or null } or null
export function ranOut(text, models = [], now = Date.now()) {
  const s = String(text ?? '')
  const said = s.match(/\bYou(?:'|’)ve (?:hit|reached) your ([A-Za-z][\w.-]*(?: [\w.-]+)?) limit\b/) ?? s.match(/^\W*([A-Z][\w.-]*(?: [\w.-]+)?) (?:requires|needs) usage credits\b/m)
  if (!said) return null
  const model = familyOf(said[1].split(' ')[0], models)
  if (!model) return null
  return { model, name: said[1].split(' ')[0], resetsAt: resetsAtOf(s, now) }
}

// The model a stand-in is for one set to `model` of family `from`: the stand-in's name, keeping a context suffix the
// alias had (fable[1m] → opus[1m]). A full model id names one model, so its stand-in is the plain alias.
export function withModel(model, from, to) {
  const suffix = String(model ?? '').toLowerCase().match(new RegExp(`^${from}(\\[[^\\]]*\\])$`))?.[1]
  return suffix ? `${to}${suffix}` : to
}

// The next model to use while `family` is out: down the provider's list first (Fable → Opus → Sonnet → Haiku), up it if
// nothing below is left, skipping any that ran out too. null: none left.
export function standInFor(family, models = [], out = new Set()) {
  const i = models.indexOf(family)
  const order = i < 0 ? models : [...models.slice(i + 1), ...models.slice(0, i).reverse()]
  return order.find((m) => m !== family && !out.has(m)) ?? null
}

// When what Claude Code said resets, in ms: "resets Nov 20 at 6am (America/Fortaleza)", "resets 9:10pm", "resets
// Nov 20, 2027 at 6:30am", "resets in 3h 20m". The time is the zone's in brackets, this computer's without one. A date
// without a year is the next one to come; a time without a date, the next time it's that time. null: it doesn't say.
export function resetsAtOf(text, now = Date.now()) {
  const s = String(text ?? '')
  const span = s.match(/\bresets in ((?:\d+\s*(?:d|days?|h|hrs?|hours?|m|mins?|minutes?)\b\s*)+)/i)
  if (span) {
    const unit = { d: 864e5, h: 36e5, m: 6e4 }
    let ms = 0
    for (const [, n, u] of span[1].matchAll(/(\d+)\s*([dhm])/gi)) ms += Number(n) * unit[u.toLowerCase()]
    return ms > 0 ? now + ms : null
  }
  const m = s.match(/\bresets\s+(?:on\s+)?(?:([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?,?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?(?![a-z]))?(?:\s*\(([^)]+)\))?/i)
  if (!m) return null
  const [, mon, day, year, h, min, ap, zone] = m
  if (!ap && min === undefined) return null // "resets 20": no time in that
  const month = mon ? MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) : -1
  if (mon && month < 0) return null
  if ((ap ? Number(h) > 12 : Number(h) > 23) || Number(min ?? 0) > 59) return null
  const hour = ap ? (Number(h) % 12) + (ap.toLowerCase() === 'p' ? 12 : 0) : Number(h)
  const tz = validZone(zone?.trim())
  const today = partsIn(now, tz)
  const minute = Number(min ?? 0)
  if (!mon) {
    let t = wallTime(today.year, today.month, today.day, hour, minute, tz)
    if (t <= now) t = wallTime(today.year, today.month, today.day + 1, hour, minute, tz)
    return t
  }
  const at = (y) => wallTime(y, month, Number(day), hour, minute, tz)
  if (year) return at(Number(year))
  const t = at(today.year)
  return t < now - 864e5 ? at(today.year + 1) : t
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// A time zone this computer knows (America/Fortaleza), or null for its own.
function validZone(zone) {
  if (!zone) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return null
  }
}

// What the calendar says at `t` in a zone (null: this computer's). month from 0.
function partsIn(t, tz) {
  if (!tz) {
    const d = new Date(t)
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }
  }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(t).map((x) => [x.type, x.value]))
  return { year: Number(p.year), month: Number(p.month) - 1, day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute) }
}

// The moment a zone's clocks show this date and time (null: this computer's). Day overflow rolls on (31 → the 1st).
function wallTime(year, month, day, hour, minute, tz) {
  if (!tz) return new Date(year, month, day, hour, minute).getTime()
  const wall = Date.UTC(year, month, day, hour, minute)
  const offset = (t) => {
    const p = partsIn(t, tz)
    return Date.UTC(p.year, p.month, p.day, p.hour, p.minute) - Math.floor(t / 6e4) * 6e4
  }
  const first = wall - offset(wall)
  return wall - offset(first) // (again from there: a daylight saving change between the two)
}

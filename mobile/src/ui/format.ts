// Words for times and statuses, as the Mac says them (desktop/ui/common.js).
import { CLOSE } from '@/net/shared'
import type { Agent } from '@/net/types'

export function ago(ts: number | undefined, now = Date.now()) {
  if (!ts) return ''
  const s = (now - ts) / 1000
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d`
}

export const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// "14:02" today, "Tue 14:02" this week, a date before that
export function when(ts: number, now = Date.now()) {
  const d = new Date(ts)
  if (d.toDateString() === new Date(now).toDateString()) return clock(ts)
  if (now - ts < 6 * 86400000) return `${d.toLocaleDateString([], { weekday: 'short' })} ${clock(ts)}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

// The line between days in the chat: "Today", "Yesterday", "Mon, Nov 2", with the year when it isn't this one.
export function dayLabel(ts: number, now = Date.now()) {
  if (sameDay(ts, now)) return 'Today'
  const before = new Date(now)
  before.setDate(before.getDate() - 1)
  if (sameDay(ts, before.getTime())) return 'Yesterday'
  const d = new Date(ts)
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date(now).getFullYear() && { year: 'numeric' }) })
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const blockedOn = (a: Agent) => (a.status === 'working' && a.waitingOn?.length ? a.waitingOn : null)

export function statusText(a: Agent, now = Date.now()) {
  const on = blockedOn(a)
  if (on) return `Waiting on ${displayName(on[0].name).base}${on.length > 1 ? ` and ${on.length - 1} more` : ''} · ${ago(on[0].since, now)}`
  if (!a.on) return 'Off'
  switch (a.status) {
    case 'working':
      return `Working · ${ago(a.since, now)}`
    case 'waiting':
      return 'Needs you'
    case 'idle':
      return 'Idle'
    case 'starting':
      return 'Starting…'
    case 'off':
      return 'Off'
    case 'parked':
      return 'Asleep'
    case 'away':
      return "Can't be reached"
    default:
      return 'Stopped'
  }
}

// What it's doing, in a few words: its current step while it works, otherwise how it is.
export function rowLine(a: Agent, now = Date.now()): { text: string; kind: string; mono?: boolean } {
  if (!a.on) return { text: 'Off', kind: 'off' }
  if (blockedOn(a)) return { text: statusText(a, now), kind: 'blocked' }
  if (a.status === 'working') return a.activity ? { text: activityWords(a.activity), kind: 'working' } : { text: statusText(a, now), kind: 'working' }
  if (a.status === 'waiting') return { text: a.activity ? `Needs you · ${activityWords(a.activity)}` : 'Needs you', kind: 'waiting' }
  const subs = (a.subs ?? []).filter((s) => !s.ended).length
  if (a.status === 'idle' && subs) return { text: `Idle · ${plural(subs, 'helper')} at work`, kind: 'idle' }
  return { text: statusText(a, now), kind: a.status }
}

// Rex@workstation → Rex (and "workstation" apart); Ada.2 → Ada 2. A one-letter name reads as an initial, so it's shown
// as a capital: q is Q, the system agent (desktop/core/system-agent.js).
export function displayName(name: string) {
  const [base, home] = String(name).split('@')
  const shown = base.length === 1 ? base.toUpperCase() : base
  return { base: shown.replace(/\.(\d+)$/, ' $1'), home: home ?? '' }
}

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase())
const low = (s: string) => s.replace(/^./, (c) => c.toLowerCase())

export const brain = (a: Agent, providers?: Record<string, { label: string }>) =>
  [providers?.[a.provider ?? '']?.label ?? (a.provider ? cap(a.provider) : ''), a.model, a.effort].filter(Boolean).join(' · ')

// "Claude Opus · High · Fast": who it is, in one quiet line (identity, so it stays on every row).
export function brainLine(a: Agent, providers?: Record<string, { label: string }>) {
  const who = providers?.[a.provider ?? '']?.label ?? (a.provider ? cap(a.provider) : '')
  return [[who, a.model ? cap(a.model) : ''].filter(Boolean).join(' '), a.effort ? cap(a.effort) : '', a.fast ? 'Fast' : ''].filter(Boolean).join(' · ')
}

// ---- what an agent is doing, in plain words (desktop/ui/common.js activityWords) ----
// The Mac describes a tool call as "Edit · hub.js" or "Bash · npm run e2e"; this says "Editing hub.js", "Running e2e".

const urlHost = (url: string) => {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)
  return m ? m[1].replace(/^www\./, '') : ''
}
function commandWords(cmd: string) {
  const c = String(cmd).replace(/^(?:cd\s+\S+\s*&&\s*)+/, '').trim()
  if (!c) return 'Running a command'
  const own = c.match(/^clique\s+(ask|send|lease|note|board)\b\s*([\w@.-]*)/)
  if (own) {
    const [, verb, what] = own
    const who = what.split('@')[0] || 'a teammate'
    return ({ ask: `Asking ${who}`, send: `Handing work to ${who}`, lease: `Booking the ${what || 'shared thing'}`, note: 'Leaving a note for the clique', board: "Reading the clique's notes" } as Record<string, string>)[verb]
  }
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/.test(c)) return 'Running the tests'
  const script = c.match(/^(?:(?:npm|pnpm|yarn|bun)\s+run|npx|pnpx|bunx)\s+(.+)/)
  return `Running ${script ? script[1] : c}`
}
const TOOL_WORDS: [RegExp, (x: string) => string][] = [
  [/^(edit|multiedit|notebookedit|apply_patch)$/i, (x) => (x ? `Editing ${x}` : 'Editing files')],
  [/^write$/i, (x) => (x ? `Writing ${x}` : 'Writing a file')],
  [/^(read|notebookread|view_image)$/i, (x) => (x ? `Reading ${x}` : 'Reading files')],
  [/^(bash|powershell|shell|exec_command|local_shell|unified_exec)$/i, (x) => (x ? commandWords(x) : 'Running a command')],
  [/^(grep|glob)$/i, (x) => (x ? `Searching for ${x}` : 'Searching the code')],
  [/^webfetch$/i, (x) => `Reading ${urlHost(x) || 'a web page'}`],
  [/^(websearch|web_search)$/i, (x) => (x ? `Searching the web for ${x}` : 'Searching the web')],
  [/^image_gen$/i, (x) => (x ? `Drawing ${x}` : 'Drawing')],
  [/^(agent|task)$/i, (x) => (x ? `Starting a helper: ${x}` : 'Starting a helper')],
  [/^(todowrite|update_plan)$/i, () => 'Planning its next steps'],
  [/^exitplanmode$/i, () => 'Writing up a plan'],
]
export function activityWords(text: string) {
  const m = String(text).match(/^([A-Za-z_][\w-]*)(?:\s*[·:]\s*|\s+|$)([\s\S]*)$/)
  const tool = m && TOOL_WORDS.find(([re]) => re.test(m[1]))
  if (tool) return tool[1](m![2].split('\n')[0].trim())
  const mcp = String(text).match(/^mcp__(.+?)__/)
  return mcp ? `Using ${mcp[1].replace(/_/g, ' ')}` : cap(String(text))
}

// ---- status in plain words (SPEC rule 8): "Idle", "Needs your OK", "Has a question" ----

export type AskKind = 'ok' | 'question' | 'plan' | 'terminal'
export const askKindOf = (ask: unknown): AskKind => (typeof ask === 'object' && ask ? ((ask as { type?: string }).type === 'question' ? 'question' : (ask as { type?: string }).type === 'plan' ? 'plan' : 'ok') : 'terminal')
export const NEEDS_WORD: Record<AskKind, string> = { ok: 'Needs your OK', question: 'Has a question', plan: 'Has a plan for you', terminal: 'Needs you in its terminal' }

// What a row says under the name: what it's doing while it works, otherwise how it is. `ask`: what it waits on you for.
export function statusWord(a: Agent, ask?: AskKind): { text: string; kind: 'working' | 'waiting' | 'idle' | 'off' | 'quiet' } {
  if (!a.on) return { text: 'Off', kind: 'off' }
  if (a.status === 'working' && a.waitingOn?.length) return { text: `Waiting on ${a.waitingOn.map((w) => displayName(w.name).base).join(' and ')}`, kind: 'quiet' }
  switch (a.status) {
    case 'working':
      return { text: a.activity ? activityWords(a.activity) : 'Working', kind: 'working' }
    case 'waiting':
      return { text: NEEDS_WORD[ask ?? 'terminal'], kind: 'waiting' }
    case 'idle':
      return { text: 'Idle', kind: 'idle' }
    case 'starting':
      return { text: 'Starting…', kind: 'quiet' }
    case 'parked':
      return { text: 'Parked', kind: 'off' }
    case 'away':
      return { text: "Can't be reached", kind: 'off' }
    case 'off':
      return { text: 'Off', kind: 'off' }
    default:
      return { text: 'Stopped', kind: 'off' }
  }
}

// ---- how the phone reaches a computer, in words (no addresses on screen) ----
// Tailscale's addresses are 100.64.0.0/10 and its names end in .ts.net; private and .local addresses are the Wi-Fi.
export function reachedOver(host?: string): string {
  const h = String(host ?? '').toLowerCase()
  if (!h) return ''
  if (/\.ts\.net\.?$/.test(h)) return 'Tailscale'
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 100 && b >= 64 && b <= 127) return 'Tailscale'
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return 'Wi-Fi'
    return 'the internet'
  }
  if (h.endsWith('.local') || !h.includes('.') || h.startsWith('fe80:') || h.startsWith('fd')) return 'Wi-Fi'
  return 'the internet'
}

// What one address did when the phone tried it, in words (the close codes are shared/PROTOCOL.md's).
export function tryWords(t: { host: string; why: string; code?: number }): { where: string; what: string } {
  const where = reachedOver(t.host) === 'Tailscale' ? 'Over Tailscale' : reachedOver(t.host) === 'Wi-Fi' ? 'Over Wi-Fi' : 'Over the internet'
  const byCode: Record<number, string> = { [CLOSE.notPaired]: "doesn't know this phone", [CLOSE.version]: 'runs another version', [CLOSE.noCode]: 'that code is used up', [CLOSE.badFrame]: 'that code is used up', [CLOSE.tooMany]: 'asked to wait a minute' }
  const what = (t.code && byCode[t.code]) || (/no answer|unreachable|timeout/i.test(t.why) ? 'no answer' : t.why === 'cancelled' ? 'stopped' : "didn't connect")
  return { where, what }
}

// ---- the creature's own voice, where it asks for something (SPEC v2 rule 8) ----
// "Can I run npm run build? I'd like to check the settings page." Code is a part of its own, set in mono.
export type Said = { text: string; code?: boolean }[]

// Why it wants to run a command, when the computer sends that in words (Claude Code's description of a command), not a
// path. The creature says it, so the card under it doesn't say it again.
export function reasonOf(ask: unknown): string {
  const q = (typeof ask === 'object' && ask ? ask : {}) as { type?: string; tool?: string; code?: string; detail?: string }
  if (q.type !== 'permission' || !String(q.code ?? '').trim()) return ''
  if (q.tool && !/^(bash|powershell|shell|exec_command|local_shell|unified_exec)$/i.test(q.tool)) return ''
  const d = String(q.detail ?? '').trim()
  return d && /\s/.test(d) && !/^[~/\\]|^[A-Za-z]:\\/.test(d) ? d.replace(/[.!]+$/, '') : ''
}
export function voiceOf(ask: unknown): Said {
  if (typeof ask !== 'object' || !ask) return [{ text: "I'm waiting for you in my terminal." }]
  const q = ask as { type?: string; tool?: string; title?: string; code?: string; detail?: string; say?: string; questions?: { question: string }[] }
  if (q.type === 'question') {
    const qs = q.questions ?? []
    // (the line about the rest is a part of its own: after steps set out as a list it stands under them, ask.tsx AskWords)
    return [{ text: qs[0]?.question ?? 'I have a question.' }, ...(qs.length > 1 ? [{ text: ` And ${qs.length - 1} more.` }] : [])]
  }
  if (q.type === 'plan') return [{ text: "Here's my plan. Can I go ahead?" }]
  if (q.say) return [{ text: q.say }] // an agent tool (clique app) asks in its own words: "Can I add a #design channel?"
  const first = String(q.code ?? '').split('\n')[0].trim()
  const shell = /^(bash|powershell|shell|exec_command|local_shell|unified_exec)$/i.test(q.tool ?? '') || (!q.tool && first)
  const reason = reasonOf(ask)
  const why = reason ? ` I'd like to ${low(reason)}.` : ''
  if (shell && first) return [{ text: 'Can I run ' }, { text: first.length > 48 ? `${first.slice(0, 47)}…` : first, code: true }, { text: `?${why}` }]
  const title = String(q.title ?? '').trim()
  if (/^(run|edit|write|read|use|fetch|search|delete|create|open|make|move|install|change|update)\b/i.test(title)) return [{ text: `Can I ${low(title)}?${shell ? why : ''}` }]
  return [{ text: `Can I use ${q.tool ?? 'a tool'}?` }]
}

// A file an agent attached, in a line: "Video · 0:12 · 2.1 MB", "HTML page · 14 KB", "PDF · 1.2 MB".
export function fileLine(f: { name: string; kind: string; size: number; dur?: number }): string {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(f.name)?.[1]?.toUpperCase()
  const what = f.kind === 'image' ? 'Picture' : f.kind === 'video' ? 'Video' : f.kind === 'html' ? 'HTML page' : ext || 'File'
  const two = (n: number) => String(n).padStart(2, '0')
  const secs = Math.max(0, Math.round(f.dur ?? 0))
  const time = f.dur ? (secs >= 3600 ? `${Math.floor(secs / 3600)}:${two(Math.floor(secs / 60) % 60)}:${two(secs % 60)}` : `${Math.floor(secs / 60)}:${two(secs % 60)}`) : ''
  let size = `${f.size} B`
  if (f.size >= 1024) {
    const units = ['KB', 'MB', 'GB']
    let v = f.size / 1024
    let u = 0
    while (v >= 1024 && u < units.length - 1) (v /= 1024), u++
    size = `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`
  }
  return [what, time, size].filter(Boolean).join(' · ')
}

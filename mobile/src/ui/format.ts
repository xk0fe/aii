// Words for times and statuses, as the Mac says them (desktop/ui/common.js).
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

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const blockedOn = (a: Agent) => (a.status === 'working' && a.waitingOn?.length ? a.waitingOn : null)

export function statusText(a: Agent, now = Date.now()) {
  const on = blockedOn(a)
  if (on) return `waiting on @${on[0].name}${on.length > 1 ? ` +${on.length - 1}` : ''} · ${ago(on[0].since, now)}`
  if (!a.on) return 'off'
  switch (a.status) {
    case 'working':
      return `working · ${ago(a.since, now)}`
    case 'waiting':
      return 'needs you'
    case 'idle':
      return 'free'
    case 'starting':
      return 'starting…'
    case 'off':
      return 'off'
    case 'parked':
      return 'parked'
    case 'away':
      return 'unreachable'
    default:
      return 'exited'
  }
}

// What it's doing, in a few words: its current step while it works, otherwise how it is.
export function rowLine(a: Agent, now = Date.now()): { text: string; kind: string; mono?: boolean } {
  if (!a.on) return { text: 'off', kind: 'off' }
  if (blockedOn(a)) return { text: statusText(a, now), kind: 'blocked' }
  if (a.status === 'working') return a.activity ? { text: a.activity, kind: 'working', mono: true } : { text: statusText(a, now), kind: 'working' }
  if (a.status === 'waiting') return { text: a.activity ? `needs you · ${a.activity}` : 'needs you', kind: 'waiting' }
  const subs = (a.subs ?? []).filter((s) => !s.ended).length
  if (a.status === 'idle' && subs) return { text: `free · ${plural(subs, 'sub-agent')} working`, kind: 'idle' }
  return { text: statusText(a, now), kind: a.status }
}

// gal@mac-mini → gal (and "mac-mini" apart); marc.2 → marc 2
export function displayName(name: string) {
  const [base, home] = String(name).split('@')
  return { base: base.replace(/\.(\d+)$/, ' $1'), home: home ?? '' }
}

export const brain = (a: Agent, providers?: Record<string, { label: string }>) =>
  [providers?.[a.provider ?? '']?.label ?? (a.provider ? a.provider[0].toUpperCase() + a.provider.slice(1) : ''), a.model, a.effort].filter(Boolean).join(' · ')

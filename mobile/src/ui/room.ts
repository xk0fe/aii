// Who needs you and the one headline that says how things are. Plain TypeScript, no React: the tests check it.
import { APP_NAME } from '@/brand'
import type { Agent, FeedEntry } from '@/net/types'

import { askKindOf, displayName, type AskKind } from './format'

const name = (a: { name: string }) => displayName(a.name).base

const family = (n: string) => n.replace(/\.\d+(?=@|$)/, '')

// Who needs you, and for what: each agent waiting on you (or one of its clones is: Ada.2's question is Ada's to
// answer), by its oldest open question, or its terminal without one. `everyone` has the clones, `agents` doesn't.
export function needsOf(agents: Agent[], open: FeedEntry[], everyone: Agent[] = agents): { agent: Agent; kind: AskKind }[] {
  const first = new Map<string, FeedEntry>()
  for (const e of open) {
    const n = family(e.from)
    if (!first.has(n)) first.set(n, e)
  }
  const waiting = new Set(everyone.filter((x) => x.on && x.status === 'waiting').map((x) => family(x.name)))
  return agents.filter((a) => a.on && (waiting.has(a.name) || first.has(a.name))).map((a) => ({ agent: a, kind: askKindOf(first.get(a.name)?.ask) }))
}

const WANTS: Record<AskKind, string> = { ok: 'needs your OK', question: 'has a question', plan: 'has a plan for you', terminal: 'is waiting in its terminal' }

// "Milo wants to run a command", from a permission card's title ("Run a command", "Edit cart.ts").
function wants(kind: AskKind, e?: FeedEntry) {
  const title = kind === 'ok' && typeof e?.ask === 'object' && e.ask.type === 'permission' ? String(e.ask.title ?? '') : ''
  return /^(run|edit|write|read|use|fetch|search|delete|create)\b/i.test(title) ? `wants to ${title.replace(/^./, (c) => c.toLowerCase())}` : WANTS[kind]
}

export const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

// The headline and the line under it, in plain words: "2 of your clique need you" / "Milo wants to run a command and
// Iris has a question." Then "Everyone's busy", "2 at work", "All quiet".
export function headline(agents: Agent[], open: FeedEntry[], parked = false, everyone: Agent[] = agents): { title: string; line: string } {
  if (!agents.length) return { title: 'No one here yet', line: `Add agents to this workspace in ${APP_NAME} on your computer.` }
  if (parked) return { title: 'Asleep', line: 'This workspace is asleep. Send a message and its clique wakes up.' }
  const needs = needsOf(agents, open, everyone)
  const byFrom = (a: Agent) => open.find((e) => family(e.from) === a.name)
  if (needs.length) {
    const said = needs.map(({ agent, kind }) => `${name(agent)} ${wants(kind, byFrom(agent))}`)
    const line = said.length > 3 ? `${said.slice(0, 2).join(', ')} and ${needs.length - 2} more are waiting.` : `${andList(said)}.`
    return { title: needs.length === 1 ? `${name(needs[0].agent)} needs you` : `${needs.length} of your clique need you`, line }
  }
  const on = agents.filter((a) => a.on)
  const busy = on.filter((a) => a.status === 'working' && !a.waitingOn?.length)
  if (busy.length) {
    const who = busy.map(name)
    const line = who.length > 3 ? `${who.slice(0, 2).join(', ')} and ${who.length - 2} more are at work.` : `${andList(who)} ${who.length === 1 ? 'is' : 'are'} at work.`
    return { title: busy.length === on.length ? 'Everyone’s busy' : `${busy.length} at work`, line }
  }
  return { title: 'All quiet', line: on.length ? 'Nobody needs you right now.' : 'Everyone is off. Turn someone on to get going.' }
}

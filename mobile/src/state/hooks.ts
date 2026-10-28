// Screens read the session and the live crew through these (useSyncExternalStore: no effects, no copies).
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import type { Agent, FeedEntry, State } from '@/net/types'

import { EMPTY, session } from './session'

export const useSession = () => useSyncExternalStore(session.subscribe, session.getSnapshot)
export const useClient = () => useSyncExternalStore(session.subscribe, () => session.client)

export function useCrew() {
  const client = useClient()
  const subscribe = useCallback((fn: () => void) => client?.subscribe(fn) ?? (() => {}), [client])
  const snap = useSyncExternalStore(subscribe, () => client?.getSnapshot() ?? EMPTY)
  return { client, ...snap }
}

// ---- what the screens derive from a state ----

export const familyOf = (name: string) => String(name ?? '').replace(/\.\d+(?=@|$)/, '')

export const isUnread = (e: FeedEntry, reads: State['reads']) =>
  e.kind === 'reply' && e.from !== 'you' && Boolean(reads) && e.ts > Math.max(reads?.since ?? 0, reads?.agents?.[e.from] ?? 0)

export const isOpenAsk = (e: FeedEntry) => e.kind === 'ask' && !e.answer && typeof e.ask === 'object'

export type Derived = {
  agents: Agent[] // without clones
  byName: Map<string, Agent>
  clones: Map<string, Agent[]>
  open: FeedEntry[] // questions waiting for you, oldest first
  unread: Map<string, number> // per agent family
  working: number
  waiting: number
}

export function derive(state: State | null): Derived {
  const all = state?.agents ?? []
  const byName = new Map(all.map((a) => [a.name, a]))
  const clones = new Map<string, Agent[]>()
  for (const a of all) if (a.cloneOf) clones.set(a.cloneOf, [...(clones.get(a.cloneOf) ?? []), a])
  const unread = new Map<string, number>()
  for (const e of state?.feed ?? []) if (isUnread(e, state?.reads)) unread.set(familyOf(e.from), (unread.get(familyOf(e.from)) ?? 0) + 1)
  const on = all.filter((a) => a.on)
  return {
    agents: all.filter((a) => !a.cloneOf),
    byName,
    clones,
    open: (state?.feed ?? []).filter(isOpenAsk),
    unread,
    working: on.filter((a) => a.status === 'working' && !a.waitingOn?.length).length,
    waiting: on.filter((a) => a.status === 'waiting').length,
  }
}

export const useDerived = (state: State | null) => useMemo(() => derive(state), [state])

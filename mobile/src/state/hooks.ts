// Screens read the session and the live crew through these (useSyncExternalStore: no effects, no copies).
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import type { Agent, Channel, FeedEntry, State } from '@/net/types'

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

// Read marks are kept per channel on the Mac: #general's in `agents`, the others' in `channels`.
export const readTo = (e: FeedEntry, reads: State['reads']) =>
  Math.max(reads?.since ?? 0, (e.channel && e.channel !== 'general' ? reads?.channels?.[e.channel] : reads?.agents)?.[e.from] ?? 0)
export const isUnread = (e: FeedEntry, reads: State['reads']) => e.kind === 'reply' && e.from !== 'you' && Boolean(reads) && e.ts > readTo(e, reads)

export const isOpenAsk = (e: FeedEntry) => e.kind === 'ask' && !e.answer && typeof e.ask === 'object'

// The channel an entry shows in (desktop/ui/common.js channelOf): its own, or #general when it has none or its
// channel was deleted. Without a channel list (a Mac from before channels reached phones) everything is #general.
export const GENERAL = 'general'
export const channelOf = (e: { channel?: string }, channels?: Channel[]) => (e.channel && channels?.some((c) => c.id === e.channel) ? e.channel : GENERAL)
// The agents of a channel: its members, or everyone (without clones) when it has none.
export const membersOf = (c: Channel | undefined, agents: Agent[]) => (c?.members ? agents.filter((a) => c.members!.includes(a.name)) : agents)

export type Derived = {
  agents: Agent[] // without clones
  byName: Map<string, Agent>
  clones: Map<string, Agent[]>
  open: FeedEntry[] // questions waiting for you, oldest first
  unread: Map<string, number> // per agent family
  channels: Channel[] | null // null: the Mac sends none (one chat)
  unreadIn: Map<string, number> // new replies per channel
  needsIn: Map<string, number> // questions waiting for you per channel
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
  const channels = state?.channels?.length ? state.channels : null
  const unreadIn = new Map<string, number>()
  const needsIn = new Map<string, number>()
  const open = (state?.feed ?? []).filter(isOpenAsk)
  for (const e of state?.feed ?? []) if (isUnread(e, state?.reads)) unreadIn.set(channelOf(e, channels ?? undefined), (unreadIn.get(channelOf(e, channels ?? undefined)) ?? 0) + 1)
  for (const e of open) needsIn.set(channelOf(e, channels ?? undefined), (needsIn.get(channelOf(e, channels ?? undefined)) ?? 0) + 1)
  return {
    agents: all.filter((a) => !a.cloneOf),
    byName,
    clones,
    open,
    unread,
    channels,
    unreadIn,
    needsIn,
    working: on.filter((a) => a.status === 'working' && !a.waitingOn?.length).length,
    waiting: on.filter((a) => a.status === 'waiting').length,
  }
}

export const useDerived = (state: State | null) => useMemo(() => derive(state), [state])

// Which conversation the chat shows: a channel's (null here, the channel itself is remembered per workspace) or one
// agent's. Other screens open one too (an agent's sheet has "Message"), so it lives outside the chat screen.
import { useSyncExternalStore } from 'react'

import { prefsNow, setPref, usePrefs } from './prefs'

let convo: string | null = null
const listeners = new Set<() => void>()

export function openConvo(name: string | null) {
  convo = name
  for (const fn of listeners) fn()
}

export const useConvo = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => convo,
  )

// A channel of a workspace, opened: the chat shows it, and the phone opens it again next time.
export function openChannel(ws: string, id: string) {
  setPref('channels', { ...prefsNow().channels, [ws]: id })
  openConvo(null)
}
// The channel the chat shows in a workspace: the one opened last there, #general when it's gone or none was; null when
// the Mac sends no channels.
export function usePickedChannel(ws: string, ids: string[] | null) {
  const prefs = usePrefs()
  if (!ids) return null
  const picked = prefs.channels[ws]
  return picked && ids.includes(picked) ? picked : 'general'
}

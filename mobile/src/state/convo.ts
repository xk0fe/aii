// Which conversation the chat shows: everyone's (null) or one agent's. Other screens open one too (an agent's sheet
// has "Message"), so it lives outside the chat screen.
import { useSyncExternalStore } from 'react'

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

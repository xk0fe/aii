// The one place effects live: components never call useEffect themselves (see the no-use-effect rule).
import { useEffect, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

// For true mount-time setup with an external system: an animation loop, a subscription.
export function useMountEffect(effect: () => void | (() => void)) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, [])
}

// Re-renders every `ms` so "3m ago" style text stays true.
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useMountEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  })
  return now
}

const subscribeAppState = (fn: () => void) => {
  const sub = AppState.addEventListener('change', fn)
  return () => sub.remove()
}
// Whether the app is in the foreground.
export const useAppActive = () => useSyncExternalStore(subscribeAppState, () => AppState.currentState === 'active')

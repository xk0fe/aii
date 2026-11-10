// Small choices the phone remembers between launches: the channel the chat was last in, per workspace. Kept beside the pairings (expo-secure-store is the one store the app has); read once at
// launch, written when changed.
import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

export type Prefs = { channels: Record<string, string> }

const KEY = 'clique.prefs'
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
let prefs: Prefs = { channels: {} }
let changed = false // a choice made before the saved ones were read wins
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

void SecureStore.getItemAsync(KEY, OPTS)
  .then((text) => {
    const saved = text ? (JSON.parse(text) as Partial<Prefs>) : {}
    if (changed) return
    const channels = saved.channels && typeof saved.channels === 'object' ? Object.fromEntries(Object.entries(saved.channels).filter(([, v]) => typeof v === 'string')) : {}
    prefs = { ...prefs, channels }
    emit()
  })
  .catch(() => {}) // unreadable: the defaults

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  changed = true
  prefs = { ...prefs, [key]: value }
  emit()
  void SecureStore.setItemAsync(KEY, JSON.stringify(prefs), OPTS).catch(() => {})
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const usePrefs = () => useSyncExternalStore(subscribe, () => prefs)
export const prefsNow = () => prefs

// What the phone keeps between launches, all in the platform's secure storage (Keychain, Android Keystore): the Macs
// it's paired with, which one is in use, and for each Mac its own private key D, which never leaves this device.
import * as SecureStore from 'expo-secure-store'

import { b64, unb64 } from '@/net/shared'
import type { MacRecord } from '@/net/types'

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
const LIST = 'crew.macs'
const keyName = (macId: string) => `crew.key.${macId.replace(/[^A-Za-z0-9._-]/g, '_')}`

export type Saved = { macs: MacRecord[]; active: string | null }

// Throws when the store can't be read (before the phone's first unlock, say), which isn't the same as "nothing saved":
// the caller mustn't save over what it couldn't read.
export async function loadSaved(): Promise<Saved> {
  const text = await SecureStore.getItemAsync(LIST, OPTS)
  let data: Partial<Saved> = {}
  try {
    data = text ? (JSON.parse(text) as Partial<Saved>) : {}
  } catch {} // unreadable JSON: start over
  return { macs: Array.isArray(data.macs) ? data.macs.filter((m) => m && typeof m.id === 'string' && typeof m.key === 'string' && Array.isArray(m.hosts)) : [], active: data.active ?? null }
}

export const save = (data: Saved) => SecureStore.setItemAsync(LIST, JSON.stringify(data), OPTS)

export async function loadSecret(macId: string): Promise<Uint8Array | null> {
  const text = await SecureStore.getItemAsync(keyName(macId), OPTS)
  const key = text ? unb64(text) : null
  return key?.length === 32 ? key : null
}

export const saveSecret = (macId: string, secret: Uint8Array) => SecureStore.setItemAsync(keyName(macId), b64(secret), OPTS)
export const forgetSecret = (macId: string) => SecureStore.deleteItemAsync(keyName(macId), OPTS)

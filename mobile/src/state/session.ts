// The app's one session: the paired Macs, which one is in use (or the demo crew), and its live connection. Screens
// read it with useSession() / useCrew() (useSyncExternalStore), and act through its methods.
import Constants from 'expo-constants'
import { getRandomBytes } from 'expo-crypto'
import * as Device from 'expo-device'
import { AppState, Platform } from 'react-native'

import { DemoClient } from '@/demo/client'
import { CrewClient, type Deps, type Snapshot } from '@/net/client'
import { parsePairCode } from '@/net/pairing'
import type { MacRecord } from '@/net/types'

import { forgetSecret, loadSaved, loadSecret, save, saveSecret } from './storage'
import type { CrewLink } from './types'

export const DEMO = 'demo'

export type SessionState = {
  loaded: boolean
  macs: MacRecord[]
  active: string | null // a Mac's id, DEMO, or nobody yet
}

const deps: Deps = {
  WebSocket: (globalThis as unknown as { WebSocket: Deps['WebSocket'] }).WebSocket,
  random: (n) => getRandomBytes(n),
  log: __DEV__ ? (...a) => console.log('[crew]', ...a) : undefined,
}

const device = () => ({
  name: Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android phone'),
  platform: (Platform.OS === 'android' ? 'android' : 'ios') as 'ios' | 'android',
  app: Constants.expoConfig?.version ?? '0.1.0',
})

class Session {
  private s: SessionState = { loaded: false, macs: [], active: null }
  private listeners = new Set<() => void>()
  client: CrewLink | null = null
  private unwatch: (() => void) | null = null
  private ready: Promise<void>
  private readable = false // what's saved was read; until then nothing is saved over it

  constructor() {
    this.ready = this.load()
    AppState.addEventListener('change', (st) => {
      if (st !== 'active') return
      // the store couldn't be read at launch (before the first unlock, say): try again now
      if (!this.readable) void this.load()
      // back in the foreground: prove the connection, or reconnect right away
      this.client?.wake()
    })
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.s
  private set(patch: Partial<SessionState>) {
    this.s = { ...this.s, ...patch }
    for (const fn of this.listeners) fn()
  }
  whenLoaded() {
    return this.ready
  }

  private async load() {
    try {
      const saved = await loadSaved()
      this.readable = true
      this.set({ macs: saved.macs, active: saved.active })
      if (saved.active === DEMO) this.setClient(this.demoClient())
      else if (saved.active && !(await this.connect(saved.active))) this.set({ active: null })
    } catch {
      // unreadable for now: show pairing, but don't save over what's there
    }
    this.set({ loaded: true })
  }

  private persist() {
    if (!this.readable) return Promise.resolve()
    return save({ macs: this.s.macs, active: this.s.active }).catch(() => {})
  }

  private demoClient() {
    const c = new DemoClient()
    c.start()
    return c
  }

  // The client in use. It remembers the workspace you watch per Mac, including when the Mac moves the phone to Home
  // because the one it watched was removed.
  private setClient(client: CrewLink | null) {
    this.unwatch?.()
    this.unwatch = null
    if (this.client && this.client !== client) this.client.stop()
    this.client = client
    if (client && !client.demo) {
      this.unwatch = client.subscribe(() => {
        const { ws, shown } = client.getSnapshot()
        const id = this.s.active
        const mac = this.s.macs.find((m) => m.id === id)
        if (!mac || client !== this.client || !shown || ws !== shown || mac.ws === ws) return
        this.set({ macs: this.s.macs.map((m) => (m.id === id ? { ...m, ws } : m)) })
        void this.persist()
      })
    }
  }

  // Connects to a saved Mac; false when it can't (its key is gone or unreadable).
  private async connect(macId: string) {
    const mac = this.s.macs.find((m) => m.id === macId)
    const secret = mac && (await loadSecret(mac.id).catch(() => null))
    this.setClient(null)
    if (!mac || !secret) return false
    try {
      const client = new CrewClient({ kind: 'mac', mac, secret }, deps, device())
      client.start()
      this.setClient(client)
      return true
    } catch {
      return false
    }
  }

  // Pairs with a code: resolves once the Mac has said `ready`, sent the state, and the pairing is saved; rejects with
  // words to show.
  pair(text: string): { done: Promise<void>; cancel: () => void } {
    let cancel = () => {}
    const done = new Promise<void>((resolve, reject) => {
      let code
      try {
        code = parsePairCode(text)
      } catch (e) {
        return reject(e)
      }
      const secret = getRandomBytes(32)
      let paired: MacRecord | null = null
      let over = false
      const client = new CrewClient({ kind: 'pair', code, secret }, deps, device(), {
        onPaired: ({ mac }) => {
          paired = mac
        },
      })
      const finish = (err?: Error) => {
        if (over) return
        over = true
        stop()
        clearTimeout(timer)
        if (err) {
          client.stop()
          return reject(err)
        }
        this.adopt(paired!, secret, client).then(resolve, (e) => {
          client.stop()
          reject(new Error(`Paired, but this phone couldn't save it (${String((e as Error)?.message ?? e)}). Try again with a new code.`))
        })
      }
      const timer = setTimeout(() => finish(new Error(`${code.name} didn't answer. Is this phone on the same network as the Mac, or on its Tailscale?`)), 25000)
      cancel = () => finish(new Error('cancelled'))
      const stop = client.subscribe(() => {
        const snap = client.getSnapshot()
        if (snap.link.status === 'offline' && !paired) {
          const reach = snap.link.fatal ? snap.link.reason : `Couldn't reach ${code.name} at ${code.hosts.join(', ')}. Is this phone on the same network as the Mac, or on its Tailscale?`
          return finish(new Error(reach))
        }
        if (paired && snap.state) finish()
      })
      client.start()
    })
    return { done, cancel: () => cancel() }
  }

  private async adopt(mac: MacRecord, secret: Uint8Array, client: CrewClient) {
    await saveSecret(mac.id, secret)
    this.readable = true // a fresh pairing is worth keeping even if the list couldn't be read before
    this.set({ macs: [...this.s.macs.filter((m) => m.id !== mac.id), mac], active: mac.id })
    this.setClient(client)
    await this.persist()
  }

  startDemo() {
    this.setClient(this.demoClient())
    this.set({ active: DEMO })
    void this.persist()
  }

  async use(macId: string) {
    if (this.s.active === macId && this.client) return
    const ok = await this.connect(macId)
    this.set({ active: ok ? macId : null })
    await this.persist()
  }

  // Leaves the demo, or forgets a Mac (its key too). The Mac keeps this phone on its list until it's removed there:
  // version 1 of the protocol has no call for that.
  async remove(id: string) {
    const wasActive = this.s.active === id
    if (wasActive) this.setClient(null)
    if (id !== DEMO) await forgetSecret(id).catch(() => {})
    const macs = this.s.macs.filter((m) => m.id !== id)
    let next = wasActive ? (macs[0]?.id ?? null) : this.s.active
    this.set({ macs, active: next })
    if (wasActive && next && !(await this.connect(next))) next = null
    this.set({ active: next })
    await this.persist()
  }

  // The workspace this phone watches on the Mac in use: its own choice, remembered per Mac (setClient saves it once
  // the Mac has sent it).
  async watch(ws: string) {
    await this.client?.watch(ws)
  }
}

export const session = new Session()

// What a screen shows when there's no connection at all.
export const EMPTY: Snapshot = { link: { status: 'connecting', since: 0 }, state: null, ws: 'default', shown: null, switching: false }

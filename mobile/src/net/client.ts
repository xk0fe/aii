// The phone's connection to Crew on a Mac (PROTOCOL.md): try every address at once, keep the first one whose
// handshake completes, then calls and replies over encrypted frames, the watched workspace's state kept current with
// patches, and reconnecting with backoff when the Mac goes away.
//
// Runtime-agnostic on purpose: no React, no Expo. The WebSocket class and the source of random bytes come from the
// caller, so this same file runs in the app, in Jest against a fake Mac, and under Node (scripts/smoke.ts) against a
// real one.
import { Channel, keyPair, phoneKeys, type Bytes, type KeyPair } from './crypto'
import { urlFor, type PairCode } from './pairing'
import { apply, b64, CLOSE, pack, unb64, unpack, VERSION } from './shared'
import type { MacRecord, Reply, State } from './types'

// ---- what the client needs from its runtime ------------------------------------------------------------

export type SocketLike = {
  binaryType: string
  readyState: number
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export type Timing = {
  handshake: number // the Mac allows 10 s
  call: number
  probe: number // proving a connection that may have died while the phone slept
  backoff: number[]
  tooMany: number // after 4008 the Mac doesn't listen to this address for a minute
}

const TIMING: Timing = { handshake: 10_000, call: 20_000, probe: 6_000, backoff: [1000, 2000, 4000, 8000, 15000, 30000], tooMany: 61_000 }

export type Deps = {
  WebSocket: new (url: string) => SocketLike
  random: (n: number) => Bytes
  now?: () => number
  log?: (...args: unknown[]) => void
  timing?: Partial<Timing>
}

export type Device = { name: string; platform: 'ios' | 'android'; app: string }

// Where we're connecting: a Mac we're paired with (and our key for it), or a code we're pairing with.
export type Target =
  | { kind: 'mac'; mac: MacRecord; secret: Bytes }
  | { kind: 'pair'; code: PairCode; secret: Bytes }

// What happened at one address in the last round: `no answer`, `unreachable`, `closed 4008`…
export type Try = { host: string; why: string; code?: number }

// How the connection is doing, for the UI: connecting the first time, online through one address, or offline since a
// moment (still trying again unless `fatal`). Offline also says which close code decided it, and, after a round where
// every address failed, what each one did.
export type Link =
  | { status: 'connecting'; since: number }
  | { status: 'online'; host: string; since: number }
  | { status: 'offline'; since: number; reason: string; fatal?: boolean; retryAt?: number; code?: number; tries?: Try[] }

export type Paired = { mac: MacRecord }

// What the Mac pushes besides state. A notice about your accounts' limits has no workspace: it's every workspace's.
export type Push =
  | { t: 'alert'; ws: string; name: string; text: string }
  | { t: 'notice'; ws?: string; title: string; body?: string; focus?: string }
  | { t: 'pty'; ws: string; name: string; data: string }

// `ws` is the workspace the phone watches (its own choice); `shown` is the one `state` belongs to. They differ only
// while switching (`switching`), and calls act on `shown`, the workspace on screen.
export type Snapshot = { link: Link; state: State | null; ws: string; shown: string | null; switching: boolean }

export class HandshakeError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message)
  }
}

// What a close code means, in words for the person holding the phone.
export function closeReason(code: number | undefined, macName = 'your Mac', pairing = false): { reason: string; fatal: boolean } {
  if (pairing && (code === CLOSE.noCode || code === CLOSE.badFrame)) return { reason: 'That code is no longer valid, make a new one on the Mac.', fatal: true }
  switch (code) {
    case CLOSE.notPaired:
      return { reason: `${macName} doesn't know this phone any more. Pair it again.`, fatal: true }
    case CLOSE.version:
      return { reason: `${macName} runs a different version of Crew. Update both.`, fatal: true }
    case CLOSE.noCode:
      return { reason: 'That code is no longer valid, make a new one on the Mac.', fatal: true }
    case CLOSE.tooMany:
      return { reason: 'Too many tries from this network. The Mac listens again in a minute.', fatal: false }
    default:
      return { reason: `${macName} is unreachable`, fatal: false }
  }
}

// ---- one encrypted connection, after the handshake --------------------------------------------------------

type Conn = {
  host: string
  ready: { mac: { id: string; name: string }; device: { id: string } }
  send(msg: unknown): void
  close(code?: number): void
  onMessage: (msg: any) => void
  onClose: (code?: number) => void
}

const bytesOf = (data: unknown): Bytes | null => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return null
}

// Only one attempt at a time says `hi`: the first to get the Mac's welcome. The others wait at `welcome`, and one of
// them goes on only if that one fails. So a pairing code is used once, and a reconnect makes one session, not one per
// address that answered.
type Gate = { busy: boolean; queue: (() => void)[] }

type HandshakeOpts = {
  host: string
  port: number
  d: KeyPair
  m: Bytes // the Mac's public key
  macId: string
  secret: Bytes | null // the pairing secret, only when pairing
  device: Device
  deps: Deps
  gate: Gate
  timeout: number
}

// Runs PROTOCOL.md's handshake against one address. Resolves with the connection once `ready` has opened.
function handshake(o: HandshakeOpts): { done: Promise<Conn>; cancel: () => void } {
  let socket: SocketLike | null = null
  let settled = false
  let holding = false
  let cancel = () => {}
  const passOn = () => {
    const next = o.gate.queue.shift()
    if (next) next()
    else o.gate.busy = false
  }
  const done = new Promise<Conn>((resolve, reject) => {
    const fail = (why: string, code?: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (holding) {
        holding = false
        passOn()
      }
      try {
        socket?.close(1000)
      } catch {}
      reject(new HandshakeError(why, code))
    }
    cancel = () => fail('cancelled')
    const timer = setTimeout(() => fail('no answer'), o.timeout)
    try {
      socket = new o.deps.WebSocket(urlFor(o.host, o.port))
    } catch (e) {
      fail(String((e as Error)?.message ?? e))
      return
    }
    const ws = socket
    ws.binaryType = 'arraybuffer'
    const e = keyPair(o.deps.random(32))
    let tx: Channel | null = null
    let rx: Channel | null = null
    let conn: Conn | null = null
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', v: VERSION, e: b64(e.public), d: b64(o.d.public), ...(o.secret && { pair: true }) }))
    }
    ws.onerror = () => {} // onclose follows with the code
    ws.onclose = (ev) => {
      if (conn) return conn.onClose(ev?.code)
      fail(ev?.code && ev.code >= 4000 ? `closed ${ev.code}` : 'unreachable', ev?.code)
    }
    ws.onmessage = (ev) => {
      if (settled && !conn) return
      const data = ev.data
      if (conn) {
        // after the handshake: binary frames only, each opening with the next counter
        const frame = bytesOf(data)
        let msg
        try {
          if (!frame || !rx) throw new Error('not a frame')
          msg = unpack(rx.openText(frame))
        } catch {
          return conn.close(1002)
        }
        return conn.onMessage(msg)
      }
      if (!tx) {
        // step 2: the Mac's welcome, as text
        let k
        try {
          const w = typeof data === 'string' ? JSON.parse(data) : null
          if (w?.t !== 'welcome' || w.v !== VERSION) throw new Error('not a welcome')
          const f = unb64(w.f)
          if (f.length !== 32) throw new Error('not a key')
          k = phoneKeys({ e, d: o.d, m: o.m, f, secret: o.secret }) // throws for a key X25519 can't agree with
        } catch {
          return fail('not a Crew Mac')
        }
        tx = new Channel(k.kPhone)
        rx = new Channel(k.kMac)
        const sender = tx
        const go = () => {
          if (settled) return passOn()
          holding = true
          ws.send(sender.sealText(JSON.stringify({ t: 'hi', ...o.device })))
        }
        if (o.gate.busy) o.gate.queue.push(go)
        else {
          o.gate.busy = true
          go()
        }
        return
      }
      // step 6: frame 0 from the Mac must be `ready`; only a Mac holding M can seal it
      if (!holding) return fail('spoke out of turn')
      const frame = bytesOf(data)
      let ready
      try {
        ready = frame && rx ? JSON.parse(rx.openText(frame)) : null
      } catch {}
      if (ready?.t !== 'ready') return fail("the Mac's answer didn't open")
      if (String(ready.mac?.id) !== o.macId) return fail('a different Mac answered')
      const sender = tx
      settled = true
      clearTimeout(timer)
      conn = {
        host: o.host,
        ready,
        send: (msg) => ws.send(sender.sealText(pack(msg))),
        close: (code) => {
          try {
            ws.close(code ?? 1000)
          } catch {}
        },
        onMessage: () => {},
        onClose: () => {},
      }
      resolve(conn)
    }
  })
  return { done, cancel: () => cancel() }
}

// ---- the client ------------------------------------------------------------------------------------------

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

// The Mac's words for a workspace that isn't there (core/remote.js: `… has no workspace "golf"`).
const gone = (e: unknown) => /no workspace/i.test(String((e as Error)?.message ?? e))

export class CrewClient {
  private target: Target
  private d: KeyPair
  private t: Timing
  private conn: Conn | null = null
  private attempts: { cancel: () => void }[] = []
  private pending = new Map<number, Pending>()
  private nextId = 1
  private tries = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private penaltyUntil = 0
  private stopped = true
  private v: number | null = null
  private watching = 0 // the latest watch call, so a stale reply is dropped
  private listeners = new Set<() => void>()
  private pushListeners = new Set<(p: Push) => void>()
  private snap: Snapshot

  constructor(
    target: Target,
    private deps: Deps,
    private device: Device,
    private hooks: { onPaired?: (p: Paired) => void } = {},
  ) {
    this.target = target
    this.d = keyPair(target.secret)
    this.t = { ...TIMING, ...deps.timing }
    const ws = target.kind === 'mac' ? (target.mac.ws ?? 'default') : 'default'
    this.snap = { link: { status: 'connecting', since: this.now() }, state: null, ws, shown: null, switching: false }
  }

  // ---- for the UI (useSyncExternalStore) ----
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap
  onPush(fn: (p: Push) => void) {
    this.pushListeners.add(fn)
    return () => this.pushListeners.delete(fn)
  }
  get macName() {
    return this.target.kind === 'mac' ? this.target.mac.name : this.target.code.name
  }
  get macId() {
    return this.target.kind === 'mac' ? this.target.mac.id : this.target.code.id
  }

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch }
    if (this.target.kind === 'mac' && this.target.mac.ws !== this.snap.ws) this.target = { ...this.target, mac: { ...this.target.mac, ws: this.snap.ws } }
    for (const fn of this.listeners) fn()
  }
  private now() {
    return this.deps.now?.() ?? Date.now()
  }
  private log(...args: unknown[]) {
    this.deps.log?.(...args)
  }

  // ---- connecting ----
  start() {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    this.clearRetry()
    for (const a of this.attempts) a.cancel()
    this.attempts = []
    const conn = this.conn
    this.conn = null
    conn?.close()
    this.failPending('disconnected')
  }

  // The app came back to the front. A connection that looks alive may have died while the phone slept, without a
  // close event: prove it with a quick watch, and start over if it doesn't answer. Offline: try right now (but not
  // inside the Mac's one-minute wait after too many tries, which more tries would only extend).
  wake() {
    if (this.stopped || this.attempts.length) return
    if (this.conn) {
      void this.watch(this.snap.ws, this.t.probe).catch(() => {})
      return
    }
    const link = this.snap.link
    if (link.status === 'offline' && link.fatal) return
    if (this.now() < this.penaltyUntil) return
    this.clearRetry()
    this.tries = 0
    this.connect()
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private connect() {
    if (this.stopped) return
    const t = this.target
    const hosts = t.kind === 'mac' ? t.mac.hosts : t.code.hosts
    const port = t.kind === 'mac' ? t.mac.port : t.code.port
    const m = t.kind === 'mac' ? unb64(t.mac.key) : t.code.key
    const secret = t.kind === 'pair' ? t.code.secret : null
    if (this.snap.link.status === 'offline') this.set({ link: { ...this.snap.link, retryAt: undefined } })
    const gate: Gate = { busy: false, queue: [] }
    const tries = hosts.map((host) => handshake({ host, port, d: this.d, m, macId: this.macId, secret, device: this.device, deps: this.deps, gate, timeout: this.t.handshake }))
    this.attempts = tries
    let left = tries.length
    const errors: HandshakeError[] = []
    const tried: Try[] = [] // by address, in the code's order
    if (!left) return this.lost(new HandshakeError('no address to try'), [])
    tries.forEach((attempt, i) =>
      attempt.done.then(
        (conn) => {
          if (this.attempts !== tries || this.stopped) return conn.close()
          tries.forEach((other, j) => j !== i && other.cancel())
          this.attempts = []
          this.online(conn)
        },
        (err: HandshakeError) => {
          errors.push(err)
          tried[i] = { host: hosts[i], why: err.message, ...(err.code !== undefined && { code: err.code }) }
          this.log('handshake', hosts[i], err.message, err.code ?? '')
          if (--left || this.attempts !== tries) return
          this.attempts = []
          this.lost(null, errors, tried)
        },
      ),
    )
  }

  // Every address failed (errors, and per address `tries`), or the connection we had closed (closed, with its code).
  private lost(closed: HandshakeError | null, errors: HandshakeError[], tries?: Try[]) {
    const pairing = this.target.kind === 'pair'
    let code: number | undefined
    let fatal = false
    if (closed) {
      code = closed.code
      fatal = closeReason(code, this.macName).fatal
    } else {
      // The most telling failure: a Mac's close code beats "unreachable". But an answer from one address isn't
      // necessarily from this Mac (another Crew Mac can have the same LAN address on another network), so "doesn't know
      // this phone" only counts when every address said so.
      const coded = errors.filter((e) => e.code && e.code >= 4000)
      const first = coded.find((e) => e.code !== CLOSE.notPaired) ?? coded[0]
      code = first?.code
      fatal = code !== undefined && closeReason(code, this.macName, pairing).fatal && (code !== CLOSE.notPaired || errors.every((e) => e.code === CLOSE.notPaired))
      if (code === CLOSE.notPaired && !fatal) code = undefined
    }
    const { reason } = closeReason(code, this.macName, pairing)
    const was = this.snap.link
    // "unreachable since 14:02": the time it went away, not the time of the last try
    const since = was.status === 'offline' ? was.since : this.now()
    this.clearRetry()
    const why = { ...(code !== undefined && { code }), ...(tries && { tries }) }
    if (fatal || this.stopped) {
      this.set({ link: { status: 'offline', since, reason, fatal, ...why } })
      return
    }
    const wait = code === CLOSE.tooMany ? this.t.tooMany : this.t.backoff[Math.min(this.tries, this.t.backoff.length - 1)] * (0.8 + Math.random() * 0.4)
    if (code === CLOSE.tooMany) this.penaltyUntil = this.now() + wait
    this.tries++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, wait)
    this.set({ link: { status: 'offline', since, reason, retryAt: this.now() + wait, ...why } })
  }

  private online(conn: Conn) {
    this.conn = conn
    this.tries = 0
    conn.onMessage = (msg) => this.receive(msg)
    conn.onClose = (code) => {
      if (this.conn !== conn) return
      this.conn = null
      this.failPending(`${this.macName} went away`)
      this.lost(new HandshakeError('closed', code), [])
    }
    if (this.target.kind === 'pair') {
      const c = this.target.code
      const mac: MacRecord = { id: String(conn.ready.mac.id), name: String(conn.ready.mac.name ?? c.name), key: b64(c.key), hosts: c.hosts, port: c.port, deviceId: String(conn.ready.device?.id ?? ''), ws: this.snap.ws, pairedAt: this.now() }
      // from now on it's a Mac we're paired with: reconnects say hello without the code
      this.target = { kind: 'mac', mac, secret: this.target.secret }
      this.hooks.onPaired?.({ mac })
    } else if (conn.ready.mac?.name && conn.ready.mac.name !== this.target.mac.name) {
      this.target = { ...this.target, mac: { ...this.target.mac, name: String(conn.ready.mac.name) } }
    }
    this.v = null
    this.set({ link: { status: 'online', host: conn.host, since: this.now() } })
    void this.watch(this.snap.ws).catch(() => {})
  }

  private failPending(why: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(why))
      this.pending.delete(id)
    }
  }

  // ---- what the Mac sends ----
  private receive(msg: any) {
    if (!msg || typeof msg !== 'object') return
    if (msg.t === 'reply') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error !== undefined && msg.error !== null) p.reject(new Error(String(msg.error)))
      else p.resolve(msg.ok ?? null)
      return
    }
    if (msg.t === 'state') {
      // The Mac only pushes a whole state when the watched workspace was removed: the phone watches Home from now on.
      this.watching++ // a watch still on its way is moot
      this.v = msg.v
      this.set({ ws: msg.ws, shown: msg.ws, state: msg.state, switching: false })
      return
    }
    if (msg.t === 'patch') {
      if (msg.ws !== this.snap.shown || this.v === null || !this.snap.state) return
      if (msg.v <= this.v) return // one we have
      let next: State | null = null
      // the next one in line applies; after a gap (or one that doesn't apply) the client asks for the whole state
      if (msg.v === this.v + 1) {
        try {
          next = apply(this.snap.state, msg.patch) as State
        } catch {}
      }
      if (!next) {
        this.log('patch gap', this.v, msg.v)
        this.v = null
        void this.watch(this.snap.ws).catch(() => {})
        return
      }
      this.v = msg.v
      this.set({ state: next })
      return
    }
    if (msg.t === 'alert' || msg.t === 'notice' || msg.t === 'pty') for (const fn of this.pushListeners) fn(msg as Push)
  }

  // ---- calls ----
  call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
    return this.callWithin<T>(this.t.call, name, ...args)
  }

  private callWithin<T>(timeout: number, name: string, ...args: unknown[]): Promise<T> {
    const conn = this.conn
    if (!conn) {
      const link = this.snap.link
      return Promise.reject(new Error(link.status === 'offline' ? link.reason : `still connecting to ${this.macName}`))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.macName} didn't answer in time`))
        // a Mac that doesn't answer is most likely gone without the socket noticing
        this.dropConn(conn)
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        conn.send({ t: 'call', id, name, args })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e as Error)
      }
    })
  }

  // Watch a workspace: its whole state now, patches after. Switching keeps the old state on screen until the new one
  // is in (`switching`), and if the Mac says no, the phone stays where it was.
  async watch(ws: string, timeout = this.t.call): Promise<void> {
    const n = ++this.watching
    const conn = this.conn
    this.set({ ws, switching: ws !== this.snap.shown && this.snap.shown !== null })
    try {
      // `v` counts up for the whole connection: the reply carries the next one, patches follow
      const r = await this.callWithin<{ v: number; state: State }>(timeout, 'watch', ws)
      if (n !== this.watching) return
      this.v = r.v
      this.set({ state: r.state, shown: ws, switching: false })
    } catch (e) {
      if (n !== this.watching) return
      if (gone(e) && ws !== 'default' && this.conn) return this.watch('default')
      this.set({ ws: this.snap.shown ?? ws, switching: false })
      // anything else leaves us unsure what the Mac is sending: start over (the new connection watches again)
      if (conn && this.conn === conn) this.dropConn(conn)
      throw e
    }
  }

  // ---- the calls a phone makes, by name (PROTOCOL.md, "Calls a phone can make"), in the workspace on screen ----
  private get here() {
    return this.snap.shown ?? this.snap.ws
  }
  send(to: string, text: string, opts?: { fresh?: boolean; re?: string }) {
    return this.call<string>('send', this.here, to, text, [], opts ?? {})
  }
  answer(id: string, reply: Reply) {
    return this.call('answer', this.here, id, reply)
  }
  approve(id: string) {
    return this.call('approve', this.here, id)
  }
  drop(id: string) {
    return this.call('drop', this.here, id)
  }
  // ws: the workspace the replies were seen in (marking them read can wait a moment, during which you can switch)
  read(seen: Record<string, number>, ws = this.here) {
    return this.call('read', ws, seen)
  }
  power(name: string, on: boolean) {
    return this.call('power', this.here, name, on)
  }
  setModes(name: string, modes: { yolo?: boolean; fast?: boolean }) {
    return this.call('set', this.here, name, modes)
  }
  agentAction(action: 'freshStart' | 'restart' | 'markIdle', name: string) {
    return this.call(action, this.here, name)
  }
  // Not on screen yet in version 1, but typed as the Mac answers: what it printed so far and the size it was drawn
  // at, then `pty` pushes.
  terminal(name: string, on: boolean) {
    return this.call<{ data: string; cols: number; rows: number } | null>('terminal', this.here, name, on)
  }
  input(name: string, data: string) {
    return this.call('input', this.here, name, data)
  }

  // A connection we can't trust any more (a call it never answered, a watch that failed): drop it and start over.
  private dropConn(conn: Conn) {
    if (this.conn !== conn) return
    this.conn = null
    conn.close()
    this.failPending(`${this.macName} went away`)
    this.lost(new HandshakeError('dropped'), [])
  }
}

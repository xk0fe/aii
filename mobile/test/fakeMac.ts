// A Mac for the tests: PROTOCOL.md's other side, written with the same crypto, on an in-memory network of
// WebSockets (text frames are strings, binary frames ArrayBuffers, delivered asynchronously like a real socket).
import crypto from 'node:crypto'

import type { SocketLike } from '@/net/client'
import { Channel, keyPair, macKeys, type KeyPair } from '@/net/crypto'
import { b64, CLOSE, diff, makePairCode, pack, unb64, unpack, VERSION } from '@/net/shared'
import type { State } from '@/net/types'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
// What a computer with no workspace sends (Clique.blank, core/clique.js).
const NO_WORKSPACE = { workspace: null, workspaces: [], agents: [], feed: [] } as unknown as State

// ---- the network ----

type Server = (socket: ServerSocket) => void

export class FakeNet {
  servers = new Map<string, Server>()
  opened: string[] = []

  listen(url: string, server: Server) {
    this.servers.set(url, server)
  }

  // a WebSocket class for the client's deps
  get WebSocket() {
    const net = this
    return class implements SocketLike {
      binaryType = 'blob'
      readyState = 0
      onopen: SocketLike['onopen'] = null
      onmessage: SocketLike['onmessage'] = null
      onclose: SocketLike['onclose'] = null
      onerror: SocketLike['onerror'] = null
      peer: ServerSocket | null = null
      constructor(public url: string) {
        net.opened.push(url)
        const server = net.servers.get(url)
        setTimeout(() => {
          if (!server) {
            this.readyState = 3
            this.onerror?.({})
            this.onclose?.({ code: 1006 })
            return
          }
          this.readyState = 1
          this.peer = new ServerSocket(this)
          server(this.peer)
          this.onopen?.({})
        }, 1)
      }
      send(data: string | Uint8Array) {
        if (this.readyState !== 1) return
        const copy = typeof data === 'string' ? data : new Uint8Array(data).slice()
        void tick().then(() => this.peer?.deliver(copy))
      }
      close(code = 1000) {
        if (this.readyState > 1) return
        this.readyState = 3
        void tick().then(() => {
          this.peer?.closed(code)
          this.onclose?.({ code })
        })
      }
      deliver(data: string | Uint8Array) {
        if (this.readyState !== 1) return
        this.onmessage?.({ data: typeof data === 'string' ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
      }
      closedByPeer(code: number) {
        if (this.readyState > 1) return
        this.readyState = 3
        this.onclose?.({ code })
      }
    }
  }
}

export class ServerSocket {
  onmessage: (data: string | Uint8Array) => void = () => {}
  onclose: (code: number) => void = () => {}
  open = true
  constructor(private client: { deliver(d: string | Uint8Array): void; closedByPeer(code: number): void }) {}
  deliver(data: string | Uint8Array) {
    if (this.open) this.onmessage(data)
  }
  send(data: string | Uint8Array) {
    if (!this.open) return
    void tick().then(() => this.client.deliver(data))
  }
  close(code: number) {
    if (!this.open) return
    this.open = false
    void tick().then(() => this.client.closedByPeer(code))
  }
  closed(code: number) {
    if (!this.open) return
    this.open = false
    this.onclose(code)
  }
}

// ---- the Mac ----

type Phone = { socket: ServerSocket; tx: Channel; ws: string | null; sent: State | null; v: number; deviceId: string; d: string }

export class FakeMac {
  m: KeyPair = keyPair(new Uint8Array(crypto.randomBytes(32)))
  id = b64(new Uint8Array(crypto.randomBytes(16)))
  name = 'Studio'
  secret: Uint8Array | null = null
  devices = new Map<string, string>() // b64(D.pub) -> device id
  phones = new Set<Phone>()
  calls: { name: string; args: unknown[] }[] = []
  states: Record<string, State>
  his: unknown[] = []
  answers: Record<string, unknown> = {}
  failNext: Record<string, string> = {} // call name -> the error its next call gets
  silent = false // stop answering calls (a connection that died without closing)

  constructor(states: Record<string, State>) {
    this.states = states
  }

  code(hosts: string[], port: number) {
    this.secret = new Uint8Array(crypto.randomBytes(32))
    return makePairCode({ id: this.id, name: this.name, key: this.m.public, secret: this.secret, hosts, port })
  }

  serve = (socket: ServerSocket) => {
    let rx: Channel | null = null
    let phone: Phone | null = null
    let hello: any = null
    socket.onclose = () => phone && this.phones.delete(phone)
    socket.onmessage = (data) => {
      if (!hello) {
        if (typeof data !== 'string') return socket.close(CLOSE.badFrame)
        hello = JSON.parse(data)
        if (hello.t !== 'hello') return socket.close(CLOSE.badFrame)
        if (hello.v !== VERSION) return socket.close(CLOSE.version)
        if (!hello.pair && !this.devices.has(hello.d)) return socket.close(CLOSE.notPaired)
        if (hello.pair && !this.secret) return socket.close(CLOSE.noCode)
        const pairing = hello.pair ? this.secret : null
        const f = keyPair(new Uint8Array(crypto.randomBytes(32)))
        const k = macKeys({ m: this.m, f, e: unb64(hello.e), d: unb64(hello.d), secret: pairing })
        rx = new Channel(k.kPhone)
        const tx = new Channel(k.kMac)
        phone = { socket, tx, ws: null, sent: null, v: 0, deviceId: '', d: hello.d }
        socket.send(JSON.stringify({ t: 'welcome', v: VERSION, f: b64(f.public) }))
        return
      }
      if (typeof data === 'string' || !rx || !phone) return socket.close(CLOSE.badFrame)
      let msg: any
      try {
        msg = unpack(rx.openText(data))
      } catch {
        return socket.close(CLOSE.badFrame)
      }
      if (msg.t === 'hi') {
        this.his.push(msg)
        // a code pairs one phone: one that got this far with it as well is too late (as core/remote.js)
        if (hello.pair && !this.secret) return socket.close(CLOSE.noCode)
        if (hello.pair) {
          this.devices.set(hello.d, `dev-${this.devices.size + 1}`)
          this.secret = null // the code pairs one phone
        }
        phone.deviceId = this.devices.get(hello.d)!
        this.phones.add(phone)
        return this.push(phone, { t: 'ready', mac: { id: this.id, name: this.name }, device: { id: phone.deviceId } })
      }
      if (msg.t === 'call') return this.call(phone, msg)
    }
  }

  private push(phone: Phone, msg: unknown) {
    phone.socket.send(phone.tx.sealText(pack(msg)))
  }

  private call(phone: Phone, { id, name, args }: { id: number; name: string; args: any[] }) {
    this.calls.push({ name, args })
    if (this.silent) return
    const reply = (ok: unknown = null) => this.push(phone, { t: 'reply', id, ok })
    const error = (text: string) => this.push(phone, { t: 'reply', id, error: text })
    if (this.failNext[name]) {
      const why = this.failNext[name]
      delete this.failNext[name]
      return error(why)
    }
    // none named: the one on the Mac's screen, the first
    const ws = args[0] || Object.keys(this.states)[0]
    if (name === 'watch' && !ws) {
      phone.ws = null
      phone.v++
      phone.sent = NO_WORKSPACE
      return reply({ v: phone.v, ws: null, state: NO_WORKSPACE })
    }
    const state = this.states[ws]
    if (!state) return error(`${this.name} has no workspace "${ws}"`)
    if (name === 'watch') {
      // v counts up for the whole connection: the reply carries the next one
      phone.ws = ws
      phone.v++
      phone.sent = state
      return reply({ v: phone.v, ws, state })
    }
    if (name === 'answer') {
      const [, card, answer] = args
      const e = state.feed.find((x) => x.id === card)
      if (!e || e.answer) return error('that question has already been answered')
      this.answers[card] = answer
      this.change(ws, { ...state, feed: state.feed.map((x) => (x.id === card ? { ...x, answer: { by: 'you', allow: Boolean(answer.allow), at: 1 } } : x)) })
      return reply()
    }
    if (name === 'send') {
      const [, to, text] = args
      this.change(ws, { ...state, feed: [...state.feed, { id: `m${state.feed.length + 1}`, ts: Date.now(), kind: 'msg', from: 'you', to: to || 'Ada', text }] })
      return reply(`sent to @${to || 'Ada'}\n`)
    }
    return error(`"${name}" isn't available on a phone`)
  }

  // A new state for a workspace: every phone watching it gets the patch.
  change(ws: string, next: State, { skip = false } = {}) {
    this.states[ws] = next
    for (const phone of this.phones) {
      if (phone.ws !== ws || !phone.sent) continue
      const patch = diff(phone.sent, next)
      phone.sent = next
      if (!patch) continue
      phone.v++
      if (skip) continue // a patch lost on the way, for the gap test
      this.push(phone, { t: 'patch', ws, v: phone.v, patch })
    }
  }

  kick(code = 1001) {
    for (const p of this.phones) p.socket.close(code)
  }

  // A workspace removed on the Mac: phones watching it get the first left's state, pushed whole.
  removeWorkspace(ws: string) {
    delete this.states[ws]
    const next = Object.keys(this.states)[0]
    for (const phone of this.phones) {
      if (phone.ws !== ws) continue
      phone.ws = next ?? null
      phone.v++
      phone.sent = next ? this.states[next] : NO_WORKSPACE
      this.push(phone, { t: 'state', ws: next ?? null, v: phone.v, state: phone.sent })
    }
  }

  // A workspace made on the Mac: a phone with none to watch gets it, pushed whole.
  addWorkspace(ws: string, state: State) {
    this.states[ws] = state
    for (const phone of this.phones) {
      if (phone.ws !== null) continue
      phone.ws = ws
      phone.v++
      phone.sent = state
      this.push(phone, { t: 'state', ws, v: phone.v, state })
    }
  }

  // The phone removed on the Mac: forgotten, and its live connection closes with 4003.
  removePhone() {
    this.devices.clear()
    this.kick(CLOSE.notPaired)
  }
}

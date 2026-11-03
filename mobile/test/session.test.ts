// Pairing through the session against a fake Mac: it rides out a round that fails (as the first one often does while
// iOS asks about the local network), stops at once on an answer that won't change, and says why in few words, with
// what each address did.
import crypto from 'node:crypto'

import type { Deps, Timing } from '@/net/client'
import { PairError, Session } from '@/state/session'

import { FakeMac, FakeNet, type ServerSocket } from './fakeMac'

// what the phone keeps, in memory
const mockSaved = { macs: [] as unknown[], active: null as string | null, secrets: new Map<string, Uint8Array>() }
jest.mock('@/state/storage', () => ({
  loadSaved: async () => ({ macs: [], active: null }),
  save: async (data: { macs: unknown[]; active: string | null }) => Object.assign(mockSaved, data),
  loadSecret: async (id: string) => mockSaved.secrets.get(id) ?? null,
  saveSecret: async (id: string, secret: Uint8Array) => void mockSaved.secrets.set(id, secret),
  forgetSecret: async (id: string) => void mockSaved.secrets.delete(id),
}))
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }))

const random = (n: number) => new Uint8Array(crypto.randomBytes(n))
const STATE = { agents: [{ name: 'Ada', status: 'idle', on: true }], feed: [], workspaces: [{ id: 'default', name: 'Home' }] }
const LAN = 'ws://192.168.1.20:7788'

function setup(timing: Partial<Timing> = {}) {
  const net = new FakeNet()
  const mac = new FakeMac({ default: structuredClone(STATE) })
  const deps: Deps = { WebSocket: net.WebSocket, random, timing: { handshake: 500, call: 300, probe: 200, backoff: [40, 80], ...timing } }
  const session = new Session(deps)
  // the Tailscale address never answers; the LAN one is the Mac (once it listens)
  const code = mac.code(['100.101.102.103', '192.168.1.20'], 7788)
  return { net, mac, session, code }
}

const failure = async (done: Promise<void>) => {
  const e = await done.then(() => null, (err: unknown) => err)
  expect(e).toBeInstanceOf(PairError)
  return e as PairError
}
const lines = (e: PairError) => (e.more.tries ?? []).map((t) => `${t.host} · ${t.why}`)

afterEach(() => {
  mockSaved.macs = []
  mockSaved.active = null
  mockSaved.secrets.clear()
})

test('a first round that fails is ridden out: the Mac answers on a later try, and the pairing is saved', async () => {
  const { net, mac, session, code } = setup()
  await session.whenLoaded()
  let retried = 0
  const attempt = session.pair(code, {
    timeout: 3000,
    onRetry: () => {
      retried++
      net.listen(LAN, mac.serve) // the person allowed Local Network: the next round gets through
    },
  })
  await attempt.done
  expect(retried).toBe(1)
  expect(session.getSnapshot()).toMatchObject({ active: mac.id, macs: [expect.objectContaining({ id: mac.id, name: 'Studio' })] })
  expect(mockSaved.active).toBe(mac.id)
  expect(mockSaved.secrets.has(mac.id)).toBe(true)
  expect(session.client?.getSnapshot().link.status).toBe('online')
  session.client?.stop()
})

test('a used-up code ends it at once, in few words', async () => {
  const { net, mac, session, code } = setup()
  net.listen(LAN, mac.serve)
  mac.secret = null // a newer code replaced it, or it ran out
  const started = Date.now()
  const e = await failure(session.pair(code, { timeout: 5000 }).done)
  expect(Date.now() - started).toBeLessThan(1000)
  expect(e).toMatchObject({ title: 'That code is no longer valid', hint: 'Make a new one on your computer.', more: { fatal: true } })
  expect(session.getSnapshot().active).toBeNull()
})

test("a Mac it can't reach: it keeps trying until the timeout, then says so, with what each address did", async () => {
  const { net, session, code } = setup({ handshake: 100 })
  net.listen(LAN, () => {}) // something that takes the connection and never answers
  let retried = 0
  const started = Date.now()
  const e = await failure(session.pair(code, { timeout: 600, onRetry: () => retried++ }).done)
  expect(Date.now() - started).toBeGreaterThan(400) // or as soon as the next round would start too late
  expect(retried).toBe(1)
  expect(net.opened.filter((u) => u === LAN).length).toBeGreaterThan(1) // more than one round
  expect(e).toMatchObject({ title: "Can't reach Studio", hint: 'Same Wi-Fi or Tailscale on both?' })
  expect(e.more.fatal).toBeFalsy()
  expect(lines(e)).toEqual(['100.101.102.103 · unreachable', '192.168.1.20 · no answer'])
})

test('"too many tries" from the Mac beats "can\'t reach", and ends it at once: the next try is a minute away', async () => {
  const { net, session, code } = setup({ tooMany: 61_000 })
  net.listen(LAN, (socket) => socket.close(4008))
  const started = Date.now()
  const e = await failure(session.pair(code, { timeout: 5000 }).done)
  expect(Date.now() - started).toBeLessThan(1000)
  expect(e).toMatchObject({ title: 'Too many tries', hint: 'Studio listens again in a minute.' })
  expect(e.more.fatal).toBeFalsy()
  expect(e.more.retryAt).toBeGreaterThan(Date.now() + 50_000)
  expect(lines(e)).toEqual(['100.101.102.103 · unreachable', '192.168.1.20 · closed 4008'])
})

test('a round still under way at the deadline may finish: a slow `ready` pairs instead of leaving the code used up', async () => {
  const { net, mac, session, code } = setup()
  let n = 0
  net.listen(LAN, (socket: ServerSocket) => {
    if (++n === 1) return // round 1 gets no answer (500 ms)
    // round 2 is the Mac, but its `ready` arrives 150 ms late, past the 600 ms deadline
    const send = socket.send.bind(socket)
    let sent = 0
    socket.send = (d) => void (++sent === 2 ? setTimeout(() => send(d), 150) : send(d))
    mac.serve(socket)
  })
  await session.pair(code, { timeout: 600 }).done
  expect(session.getSnapshot().active).toBe(mac.id)
  expect(mac.devices.size).toBe(1)
  session.client?.stop()
})

test("only the Mac's minute says when to try a code again, not the phone's own backoff", async () => {
  const { session, code } = setup({ backoff: [40, 80, 160, 320, 640] }) // nothing listens: every round fails at once
  const e = await failure(session.pair(code, { timeout: 700 }).done)
  expect(e.title).toBe("Can't reach Studio")
  expect(e.more.retryAt).toBeUndefined()
})

test('a code that is not a Crew code is refused before anything is opened', async () => {
  const { net, session } = setup()
  const e = await failure(session.pair('https://example.com').done)
  expect(e).toMatchObject({ title: "That's not a CLIque phone code", more: { fatal: true } })
  expect(net.opened).toEqual([])
})

test('cancel stops trying', async () => {
  const { net, session, code } = setup()
  const attempt = session.pair(code, { timeout: 5000, onRetry: () => attempt.cancel() })
  await expect(attempt.done).rejects.toThrow('cancelled')
  const opened = net.opened.length
  await new Promise((r) => setTimeout(r, 150)) // past the backoff: no new round
  expect(net.opened.length).toBe(opened)
  expect(session.getSnapshot().active).toBeNull()
})

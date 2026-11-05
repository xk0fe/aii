// The whole client against a fake Mac: pair with a code, ready, watch, patches applied (and a missed one recovered by
// watching again), an answer call, reconnecting, and the ways a Mac can turn the phone away.
import crypto from 'node:crypto'

import { CrewClient, type Deps, type Snapshot } from '@/net/client'
import { parsePairCode } from '@/net/pairing'
import type { MacRecord, State } from '@/net/types'

import { FakeMac, FakeNet } from './fakeMac'

const device = { name: 'Test Phone', platform: 'ios' as const, app: '0.1.0' }
const random = (n: number) => new Uint8Array(crypto.randomBytes(n))
// short timers for the tests that wait on them
const FAST = { handshake: 500, call: 300, probe: 200, backoff: [40, 80], tooMany: 200 }

const STATE: State = {
  agents: [
    { name: 'Ada', status: 'working', on: true, activity: 'Edit core/hub.js' },
    { name: 'Milo', status: 'waiting', on: true },
  ],
  feed: [
    { id: 'f1', ts: 1, kind: 'msg', from: 'you', to: 'Ada', text: 'hi' },
    { id: 'q1', ts: 2, kind: 'ask', from: 'Milo', to: 'you', cli: 'claude', ask: { type: 'permission', tool: 'Bash', title: 'Run a command', code: 'npm test', always: [{ i: 0, label: 'Always allow Bash(npm test:*)' }] } },
  ],
  reads: { since: 0, agents: {} },
  workspaces: [{ id: 'default', name: 'Home' }, { id: 'docs', name: 'Docs site' }],
}
const DOCS: State = { agents: [{ name: 'Iris', status: 'idle', on: true }], feed: [], workspaces: STATE.workspaces }

// Waits until the client's snapshot passes the check.
function until(client: CrewClient, check: (s: Snapshot) => boolean, ms = 3000): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    if (check(client.getSnapshot())) return resolve(client.getSnapshot())
    const timer = setTimeout(() => {
      stop()
      reject(new Error(`timed out; link is ${JSON.stringify(client.getSnapshot().link)}`))
    }, ms)
    const stop = client.subscribe(() => {
      if (!check(client.getSnapshot())) return
      clearTimeout(timer)
      stop()
      resolve(client.getSnapshot())
    })
  })
}

function setup() {
  const net = new FakeNet()
  const mac = new FakeMac({ default: structuredClone(STATE), docs: structuredClone(DOCS) })
  // the code lists an address that never answers, then the one that does: the second must win
  net.listen('ws://192.168.1.20:7788', mac.serve)
  const deps: Deps = { WebSocket: net.WebSocket, random }
  return { net, mac, deps }
}

async function pairedClient() {
  const { net, mac, deps } = setup()
  const code = parsePairCode(mac.code(['100.101.102.103', '192.168.1.20'], 7788))
  const secret = random(32)
  let paired: MacRecord | null = null
  const client = new CrewClient({ kind: 'pair', code, secret }, deps, device, { onPaired: ({ mac }) => (paired = mac) })
  client.start()
  await until(client, (s) => s.state !== null)
  return { net, mac, deps, client, secret, paired: paired as MacRecord | null }
}

test('pairs with a code: the first address that completes the handshake wins, then it watches', async () => {
  const { net, mac, client, paired } = await pairedClient()
  const snap = client.getSnapshot()
  expect(snap.link).toMatchObject({ status: 'online', host: '192.168.1.20' })
  expect(net.opened).toEqual(['ws://100.101.102.103:7788', 'ws://192.168.1.20:7788'])
  expect(mac.his).toEqual([{ t: 'hi', ...device }])
  expect(paired).toMatchObject({ id: mac.id, name: 'Studio', deviceId: 'dev-1', hosts: ['100.101.102.103', '192.168.1.20'], port: 7788 })
  expect(mac.secret).toBeNull() // the code is used up
  expect(snap.ws).toBe('default')
  expect(snap.state?.agents.map((a) => a.name)).toEqual(['Ada', 'Milo'])
  expect(mac.calls[0]).toEqual({ name: 'watch', args: [''] })
  client.stop()
})

test('applies patches as they come, and watches again after missing one', async () => {
  const { mac, client } = await pairedClient()
  const s = mac.states.default
  mac.change('default', { ...s, agents: s.agents.map((a) => (a.name === 'Ada' ? { ...a, status: 'idle', activity: '' } : a)) })
  await until(client, (x) => x.state?.agents[0].status === 'idle')

  // a patch lost on the way: the next one doesn't follow, so the client asks for the whole state again
  const watches = mac.calls.filter((c) => c.name === 'watch').length
  mac.change('default', { ...mac.states.default, autopilot: true }, { skip: true })
  mac.change('default', { ...mac.states.default, parked: false })
  await until(client, (x) => x.state?.autopilot === true && x.state.parked === false)
  expect(mac.calls.filter((c) => c.name === 'watch').length).toBe(watches + 1)
  client.stop()
})

test('answers a question card with the shape hub.decide takes, and the card comes back answered', async () => {
  const { mac, client } = await pairedClient()
  await client.answer('q1', { allow: true, always: 0 })
  expect(mac.calls.at(-1)).toEqual({ name: 'answer', args: ['default', 'q1', { allow: true, always: 0 }] })
  const snap = await until(client, (x) => Boolean(x.state?.feed.find((e) => e.id === 'q1')?.answer))
  expect(snap.state?.feed.find((e) => e.id === 'q1')?.answer).toMatchObject({ by: 'you', allow: true })
  await expect(client.answer('q1', { allow: false })).rejects.toThrow('already been answered')
  client.stop()
})

test('sends a message, and switches workspaces', async () => {
  const { mac, client } = await pairedClient()
  await expect(client.send('', 'make it fast')).resolves.toBe('sent to @Ada\n')
  expect(mac.calls.at(-1)).toEqual({ name: 'send', args: ['default', '', 'make it fast', [], {}] })
  await until(client, (x) => x.state?.feed.at(-1)?.text === 'make it fast')

  await client.watch('docs')
  expect(client.getSnapshot()).toMatchObject({ ws: 'docs', switching: false })
  expect(client.getSnapshot().state?.agents.map((a) => a.name)).toEqual(['Iris'])
  // patches for the workspace it no longer watches don't touch what's shown
  mac.change('default', { ...mac.states.default, autopilot: false })
  await new Promise((r) => setTimeout(r, 20))
  expect(client.getSnapshot().state?.agents.map((a) => a.name)).toEqual(['Iris'])
  client.stop()
})

test('a computer with no workspace left: an empty state, then the first it makes', async () => {
  const { mac, client } = await pairedClient()
  for (const ws of Object.keys(mac.states)) mac.removeWorkspace(ws)
  const none = await until(client, (s) => s.state?.workspace === null)
  expect([none.ws, none.shown]).toEqual(['', ''])
  // connected again in that state, or just asked: the same
  await client.watch('')
  expect(client.getSnapshot().state?.workspace).toBeNull()
  mac.addWorkspace('fresh', structuredClone(STATE))
  const first = await until(client, (s) => s.ws === 'fresh')
  expect(first.shown).toBe('fresh')
  expect(first.state?.agents.map((a) => a.name)).toEqual(['Ada', 'Milo'])
  client.stop()
})

test('a workspace that is gone falls back to the one on the computer', async () => {
  const { client } = await pairedClient()
  await client.watch('gone')
  expect(client.getSnapshot().ws).toBe('default')
  expect(client.getSnapshot().state?.agents.map((a) => a.name)).toEqual(['Ada', 'Milo'])
  client.stop()
})

test('reconnects without the code after the Mac goes away, and says since when it was offline', async () => {
  const { mac, client, paired, deps, secret } = await pairedClient()
  mac.kick()
  const off = await until(client, (x) => x.link.status === 'offline')
  expect(off.link).toMatchObject({ status: 'offline', reason: 'Studio is unreachable' })
  expect(off.state?.agents.length).toBe(2) // the last state stays on screen
  await expect(client.send('', 'hello?')).rejects.toThrow('unreachable')
  // backoff: the first retry comes about a second later
  await until(client, (x) => x.link.status === 'online', 4000)
  expect(mac.his.length).toBe(2)
  client.stop()

  // a fresh start from what was saved: reconnect mode, same keys
  const again = new CrewClient({ kind: 'mac', mac: paired!, secret }, deps, device)
  again.start()
  await until(again, (x) => x.state !== null)
  expect(again.getSnapshot().link).toMatchObject({ status: 'online' })
  again.stop()
})

test('a phone the Mac no longer knows is told to pair again, and stops trying', async () => {
  const { mac, deps, client, paired, secret } = await pairedClient()
  client.stop()
  mac.devices.clear()
  // only the address that answers: every address says "not paired"
  const again = new CrewClient({ kind: 'mac', mac: { ...paired!, hosts: ['192.168.1.20'] }, secret }, deps, device)
  again.start()
  const s = await until(again, (x) => x.link.status === 'offline')
  expect(s.link).toMatchObject({ fatal: true, reason: expect.stringContaining('Pair it again') })
  again.stop()
})

test('"not paired" from one address while another is unreachable keeps trying: it may be another Mac on that address', async () => {
  const { mac, deps, client, paired, secret } = await pairedClient()
  client.stop()
  mac.devices.clear()
  const again = new CrewClient({ kind: 'mac', mac: paired!, secret }, { ...deps, timing: FAST }, device)
  again.start()
  const s = await until(again, (x) => x.link.status === 'offline')
  expect(s.link).toMatchObject({ reason: 'Studio is unreachable' })
  expect((s.link as { fatal?: boolean }).fatal).toBeFalsy()
  again.stop()
})

test('removing the phone on the Mac ends its live connection: pair again', async () => {
  const { mac, client } = await pairedClient()
  mac.removePhone()
  const s = await until(client, (x) => x.link.status === 'offline')
  expect(s.link).toMatchObject({ fatal: true, reason: expect.stringContaining('Pair it again') })
  client.stop()
})

test('a used-up code is refused with a reason', async () => {
  const { mac, deps } = setup()
  const code = parsePairCode(mac.code(['192.168.1.20'], 7788))
  mac.secret = null // a newer code replaced it, or it ran out
  const client = new CrewClient({ kind: 'pair', code, secret: random(32) }, deps, device)
  client.start()
  const s = await until(client, (x) => x.link.status === 'offline')
  expect(s.link).toMatchObject({ fatal: true, reason: 'That code is no longer valid, make a new one on your computer.' })
  client.stop()
})

test('offline says what each address did, in the code\'s order, and which close code decided it', async () => {
  const { net, mac, deps } = setup()
  net.listen('ws://192.168.1.20:7788', (socket) => socket.close(4008))
  net.listen('ws://studio.tail1234.ts.net:7788', () => {}) // takes the connection, never answers
  const code = parsePairCode(mac.code(['100.101.102.103', '192.168.1.20', 'studio.tail1234.ts.net'], 7788))
  const client = new CrewClient({ kind: 'pair', code, secret: random(32) }, { ...deps, timing: { ...FAST, handshake: 100 } }, device)
  client.start()
  const s = await until(client, (x) => x.link.status === 'offline')
  expect(s.link).toMatchObject({
    code: 4008,
    reason: 'Too many tries from this network. Your computer listens again in a minute.',
    tries: [
      { host: '100.101.102.103', why: 'unreachable', code: 1006 },
      { host: '192.168.1.20', why: 'closed 4008', code: 4008 },
      { host: 'studio.tail1234.ts.net', why: 'no answer' },
    ],
  })
  client.stop()
})

test('a Mac with a different key never gets past the first frame', async () => {
  const { mac, deps } = setup()
  const real = parsePairCode(mac.code(['192.168.1.20'], 7788))
  // a code for this address, but with someone else's key: the Mac can't open our `hi`
  const forged = { ...real, key: new FakeMac({}).m.public }
  const client = new CrewClient({ kind: 'pair', code: forged, secret: random(32) }, deps, device)
  client.start()
  const s = await until(client, (x) => x.link.status === 'offline')
  expect(s.link.status).toBe('offline')
  expect(s.state).toBeNull()
  expect(mac.his).toEqual([])
  client.stop()
})

test("a code a newer one replaced is refused (its hi doesn't open: 4006), as no longer valid", async () => {
  const { mac, deps } = setup()
  const old = parsePairCode(mac.code(['192.168.1.20'], 7788))
  mac.code(['192.168.1.20'], 7788) // a new code ends the old one
  const client = new CrewClient({ kind: 'pair', code: old, secret: random(32) }, deps, device)
  client.start()
  const s = await until(client, (x) => x.link.status === 'offline')
  expect(s.link).toMatchObject({ fatal: true, reason: 'That code is no longer valid, make a new one on your computer.' })
  expect(mac.devices.size).toBe(0)
  client.stop()
})

test('two addresses that both reach the Mac make one session: only one says hi', async () => {
  const { net, mac, deps } = setup()
  net.listen('ws://studio.tail1234.ts.net:7788', mac.serve)
  const code = parsePairCode(mac.code(['192.168.1.20', 'studio.tail1234.ts.net'], 7788))
  const client = new CrewClient({ kind: 'pair', code, secret: random(32) }, deps, device)
  client.start()
  await until(client, (x) => x.state !== null)
  await new Promise((r) => setTimeout(r, 30))
  expect(mac.his.length).toBe(1)
  expect(mac.devices.size).toBe(1)
  client.stop()
})

test('v keeps counting across watch calls: after a switch, the next patch applies', async () => {
  const { mac, client } = await pairedClient()
  await client.watch('docs')
  mac.change('docs', { ...mac.states.docs, autopilot: true })
  const s = await until(client, (x) => x.state?.autopilot === true)
  expect(s).toMatchObject({ ws: 'docs', shown: 'docs' })
  expect(mac.calls.filter((c) => c.name === 'watch').length).toBe(2) // no re-watch needed
  client.stop()
})

test('a removed workspace: the Mac pushes Home, and the phone watches Home from then on', async () => {
  const { mac, client } = await pairedClient()
  await client.watch('docs')
  mac.removeWorkspace('docs')
  const s = await until(client, (x) => x.ws === 'default')
  expect(s.shown).toBe('default')
  expect(s.state?.agents.map((a) => a.name)).toEqual(['Ada', 'Milo'])
  // and patches go on from the pushed state's v
  mac.change('default', { ...mac.states.default, autopilot: true })
  await until(client, (x) => x.state?.autopilot === true)
  client.stop()
})

test('a switch the Mac turns down leaves the phone where it was, and calls still go to the workspace on screen', async () => {
  const { mac, deps, secret, paired, client: first } = await pairedClient()
  first.stop()
  const client = new CrewClient({ kind: 'mac', mac: paired!, secret }, { ...deps, timing: FAST }, device)
  client.start()
  await until(client, (x) => x.state !== null)
  mac.failNext.watch = 'Crew is busy'
  await expect(client.watch('docs')).rejects.toThrow('busy')
  // the connection is started over (a failed watch leaves the phone unsure what the Mac sends), on the old workspace
  const s = await until(client, (x) => x.link.status === 'online' && x.state !== null && x.ws === 'default', 3000)
  expect(s.shown).toBe('default')
  await client.send('Ada', 'still here?')
  expect(mac.calls.at(-1)).toEqual({ name: 'send', args: ['default', 'Ada', 'still here?', [], {}] })
  mac.change('default', { ...mac.states.default, autopilot: true })
  await until(client, (x) => x.state?.autopilot === true)
  client.stop()
})

test('a Mac that stops answering is dropped and reconnected (calls time out, wake() proves the link)', async () => {
  const { mac, deps, secret, paired, client: first } = await pairedClient()
  first.stop()
  const client = new CrewClient({ kind: 'mac', mac: { ...paired!, hosts: ['192.168.1.20'] }, secret }, { ...deps, timing: FAST }, device)
  client.start()
  await until(client, (x) => x.state !== null)
  const his = mac.his.length
  mac.silent = true
  client.wake() // the app came back to the front: a quick watch that gets no answer
  await until(client, (x) => x.link.status === 'offline', 2000)
  mac.silent = false
  await until(client, (x) => x.link.status === 'online' && x.state !== null, 3000)
  expect(mac.his.length).toBe(his + 1)
  client.stop()
})

test('calls that return nothing resolve with null; send resolves with what Crew says', async () => {
  const { mac, client } = await pairedClient()
  await expect(client.answer('q1', { allow: false, note: 'not now' })).resolves.toBeNull()
  expect(mac.answers.q1).toEqual({ allow: false, note: 'not now' })
  await expect(client.send('', 'hi')).resolves.toBe('sent to @Ada\n')
  client.stop()
})

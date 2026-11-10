// Finding computers nearby and linking one with a code checked on both screens (core/discover.js, core/link.js
// pairing): the beacons, macOS keeping the app off the network, the handshake (its code the same on both sides, and
// only with the computer the beacon named), and two real Cliques in their own processes finding each other and linking
// from the sheet's actions. Beacons go over loopback here, to each other's port, as broadcasts can't in a test.
// Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { Discovery, broadcastTargets } from '../core/discover.js'
import { LinkHost, PairClient, identity, makeCode, readCode, sasCode } from '../core/link.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (what, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) {
    const v = await what()
    if (v) return v
  }
  throw new Error('timed out waiting')
}
const base = 21000 + Math.floor(Math.random() * 18000)

test('beacons go to each network\'s broadcast address and 255.255.255.255, never Tailscale\'s or loopback', () => {
  const interfaces = {
    lo0: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    en0: [{ family: 'IPv4', address: '192.168.0.82', netmask: '255.255.255.0', internal: false }, { family: 'IPv6', address: 'fe80::1', netmask: 'ffff::', internal: false }],
    en7: [{ family: 'IPv4', address: '10.20.30.40', netmask: '255.255.0.0', internal: false }],
    utun4: [{ family: 'IPv4', address: '100.87.146.47', netmask: '255.255.255.255', internal: false }],
    en9: [{ family: 'IPv4', address: '169.254.3.4', netmask: '255.255.0.0', internal: false }],
  }
  assert.deepEqual(broadcastTargets({ interfaces, port: 7788 }).map((t) => t.address), ['192.168.0.255', '10.20.255.255', '255.255.255.255'])
})

// Two discoveries on loopback, each sending to both ports (its own beacons it ignores).
function pair(names, fingerprints = ['AA', 'BB']) {
  const ports = [base, base + 1]
  const targets = () => ports.map((port) => ({ address: '127.0.0.1', port }))
  return names.map((name, i) => new Discovery({ port: ports[i], targets, beacon: () => ({ name, agents: i + 2, port: 7787, fingerprint: fingerprints[i] }) }))
}

test('two computers with Computers open find each other, and lose each other when one closes it', async () => {
  const [a, b] = pair(['Studio', 'Laptop'])
  await Promise.all([a.start(), b.start()])
  try {
    const seen = await until(() => a.list()[0])
    assert.deepEqual({ name: seen.name, agents: seen.agents, port: seen.port, fingerprint: seen.fingerprint, address: seen.address }, { name: 'Laptop', agents: 3, port: 7787, fingerprint: 'BB', address: '127.0.0.1' })
    await until(() => b.list()[0]?.name === 'Studio')
    assert.equal(a.get(seen.id).name, 'Laptop')
    b.stop() // says goodbye: gone at once, not after a few seconds of silence
    await until(() => a.list().length === 0, 1000)
  } finally {
    a.stop()
    b.stop()
  }
})

test('a beacon reusing a listed computer\'s id with another certificate is a computer of its own, never a change to it', async () => {
  const d = new Discovery({ beacon: () => ({ name: 'me', fingerprint: 'ME', port: 1 }) })
  const beacon = (m, address = '192.168.0.93') => d.heard(Buffer.from(JSON.stringify({ app: 'clique', v: 1, id: 'mini', name: 'Mac mini', port: 7787, ...m })), { address })
  beacon({ fingerprint: 'REAL' })
  beacon({ fingerprint: 'FAKE', port: 9999 }, '192.168.0.66') // someone else on the Wi-Fi, saying it's the Mac mini
  const list = d.list()
  assert.equal(list.length, 2)
  const real = list.find((f) => f.fingerprint === 'REAL')
  assert.deepEqual([real.address, real.port], ['192.168.0.93', 7787], 'the real one is untouched')
  beacon({ bye: true, fingerprint: 'FAKE' }, '192.168.0.66')
  assert.deepEqual(d.list().map((f) => f.fingerprint), ['REAL'], 'a goodbye only takes off the one it names')
})

test('another copy of CLIque on this computer (the same certificate) isn\'t listed', async () => {
  const [a, b] = pair(['Studio', 'Studio (dev)'], ['AA', 'AA'])
  await Promise.all([a.start(), b.start()])
  try {
    await sleep(400)
    assert.equal(a.list().length, 0)
  } finally {
    a.stop()
    b.stop()
  }
})

test('macOS refusing 255.255.255.255 at once means Local Network is off for the app', async () => {
  const refuse = (code) => ({ send: (msg, port, address, cb) => cb(address === '255.255.255.255' && code ? Object.assign(new Error('no route'), { code }) : null) })
  const targets = () => [{ address: '192.168.0.255', port: 1 }, { address: '255.255.255.255', port: 1 }]
  const d = new Discovery({ platform: 'darwin', targets, beacon: () => ({ name: 'x', fingerprint: 'AA', port: 1 }) })
  const changes = []
  d.on('blocked', (b) => changes.push(b))
  await d.send(refuse('EHOSTUNREACH'), d.beacon())
  assert.equal(d.blocked, true)
  await d.send(refuse(null), d.beacon()) // turned on in System Settings
  assert.equal(d.blocked, false)
  assert.deepEqual(changes, [true, false])
  // no network at all: only 255.255.255.255 to send to, and nothing to say about Local Network
  const offline = new Discovery({ platform: 'darwin', targets: () => [{ address: '255.255.255.255', port: 1 }], beacon: () => ({ name: 'x', fingerprint: 'AA', port: 1 }) })
  await offline.send(refuse('EHOSTUNREACH'), offline.beacon())
  assert.equal(offline.blocked, false)
  // Windows says nothing of the sort
  const win = new Discovery({ platform: 'win32', targets, beacon: () => ({ name: 'x', fingerprint: 'AA', port: 1 }) })
  await win.send(refuse('EHOSTUNREACH'), win.beacon())
  assert.equal(win.blocked, false)
})

// ---- the handshake ----------------------------------------------------------------------------------

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `clique-pair-${n}-`))
const hostId = identity(tmp('host'))
const clientId = identity(tmp('client'))
const otherId = identity(tmp('other'))

async function host(port, { pairable = true } = {}) {
  const h = new LinkHost({ key: 'k'.repeat(32), cert: hostId.cert, keyPem: hostId.key, name: 'Mac mini', handle: async () => null })
  h.fingerprint = hostId.fingerprint
  h.pairable = () => pairable
  await h.start(port)
  return h
}
const ask = (port, fingerprint = hostId.fingerprint) => new PairClient({ host: '127.0.0.1', port, fingerprint, name: 'Studio', myFingerprint: clientId.fingerprint }).start()
const outcome = (c) => new Promise((resolve) => (c.on('code', (code) => resolve({ code })), c.on('end', (why) => resolve({ why }))))

test('both screens show the same code; yes hands over the link code, pinned to the computer the beacon named', async () => {
  const h = await host(base + 10)
  try {
    const asked = new Promise((r) => h.once('pair', r))
    const c = ask(base + 10)
    const done = outcome(c)
    const sas = await new Promise((r) => c.once('sas', r))
    const req = await asked
    assert.match(sas, /^\d{4}$/)
    assert.equal(req.sas, sas, 'the same four digits on both screens')
    assert.equal(req.name, 'Studio')
    assert.equal(req.fingerprint, clientId.fingerprint)
    const code = makeCode({ name: 'Mac mini', port: base + 10, key: 'k'.repeat(32), fingerprint: hostId.fingerprint, hosts: ['127.0.0.1'] })
    req.accept(code)
    assert.deepEqual(await done, { code })
    assert.equal(readCode((await done).code).fingerprint, hostId.fingerprint)
  } finally {
    h.stop()
  }
})

test('the code depends on both certificates and both nonces', () => {
  const at = { host: 'H', client: 'C', clientNonce: 'n1', hostNonce: 'n2' }
  const one = sasCode(at)
  assert.equal(sasCode({ ...at }), one)
  const others = [{ host: 'X' }, { client: 'X' }, { clientNonce: 'X' }, { hostNonce: 'X' }].map((d) => sasCode({ ...at, ...d }))
  assert.ok(others.filter((s) => s !== one).length >= 3, 'changing any input changes the code (allowing one chance collision)')
})

test('no, a sheet that isn\'t open, the wrong certificate and a host that\'s busy each end it, saying why', async () => {
  const h = await host(base + 11)
  try {
    h.once('pair', (req) => req.decline())
    assert.deepEqual(await outcome(ask(base + 11)), { why: 'declined' })
    let asked = 0
    h.on('pair', () => asked++)
    assert.deepEqual(await outcome(ask(base + 11)), { why: 'busy' }, 'told no, it waits a little before it can ask again')
    assert.equal(asked, 0, 'and the question isn\'t put on screen meanwhile')
    assert.deepEqual(await outcome(ask(base + 11, otherId.fingerprint)), { why: 'certificate' }, 'not the computer the beacon named: never asked')
  } finally {
    h.stop()
  }
  const busy = await host(base + 15)
  try {
    busy.once('pair', (req) => req.busy())
    assert.deepEqual(await outcome(ask(base + 15)), { why: 'busy' })
  } finally {
    busy.stop()
  }
  const closed = await host(base + 12, { pairable: false })
  try {
    assert.deepEqual(await outcome(ask(base + 12)), { why: 'closed' })
  } finally {
    closed.stop()
  }
  assert.deepEqual(await outcome(ask(base + 13)), { why: 'unreachable' })
})

test('cancelling on the asking computer takes the question off the other one', async () => {
  const h = await host(base + 14)
  try {
    const asked = new Promise((r) => h.once('pair', r))
    const c = ask(base + 14)
    const req = await asked
    const gone = new Promise((r) => req.once('gone', r))
    c.cancel()
    await gone
  } finally {
    h.stop()
  }
})

// ---- two real Cliques ---------------------------------------------------------------------------------

function computer(name, linkPort, discoverPort, peerPort, agents) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-discover-test-'))
  fs.mkdirSync(path.join(home, 'link'))
  fs.writeFileSync(path.join(home, 'link', 'link.json'), JSON.stringify({ name, port: linkPort, discoverPort, discoverTo: [`127.0.0.1:${discoverPort}`, `127.0.0.1:${peerPort}`] }))
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ agents: agents.map((a) => ({ off: true, ...a })) }))
  const p = spawn(process.execPath, [fileURLToPath(new URL('./helpers/computer.mjs', import.meta.url))], { env: { ...process.env, CLIQUE_HOME: home, NAME: name }, stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map()
  let seq = 0
  let ready
  const up = new Promise((r) => (ready = r))
  readline.createInterface({ input: p.stdout }).on('line', (line) => {
    let m
    try {
      m = JSON.parse(line)
    } catch {
      return
    }
    if (m.ready) return ready()
    const w = waiting.get(m.id)
    waiting.delete(m.id)
    m.error ? w?.reject(new Error(m.error)) : w?.resolve(m.ok)
  })
  const run = (code) => new Promise((resolve, reject) => {
    const id = ++seq
    waiting.set(id, { resolve, reject })
    p.stdin.write(JSON.stringify({ id, code }) + '\n')
  })
  return { up, run, stop: () => (p.kill(), fs.rmSync(home, { recursive: true, force: true, maxRetries: 10 })) }
}

const studio = computer('Studio', base + 20, base + 30, base + 31, [{ name: 'iris', area: 'design' }])
const mini = computer('Mac mini', base + 21, base + 31, base + 30, [{ name: 'rex', area: 'backend' }, { name: 'noor', area: 'docs' }])
after(() => (studio.stop(), mini.stop()))
const view = (c) => c.run('clique.snapshot().computers')

test('both with Computers open: each lists the other; Link, the same code on both, Link on both, and they\'re linked', async () => {
  await Promise.all([studio.up, mini.up])
  assert.equal((await view(studio)).nearby, null, 'nothing is looked for while the sheet is closed')
  await studio.run('clique.discover(true)')
  await mini.run('clique.discover(true)')
  const found = await until(async () => (await view(studio)).nearby?.find((n) => n.name === 'Mac mini'))
  assert.equal(found.agents, 2)
  await until(async () => (await view(mini)).nearby?.some((n) => n.name === 'Studio'))
  const names = async (c) => (await c.run('clique.snapshot().agents.map((a) => a.name)')).sort()

  // asked, said yes there, then cancelled here: nothing links, and the Mac mini says so
  await studio.run(`clique.pairWith(${JSON.stringify(found.id)})`)
  const asking = await until(async () => (await view(studio)).pairing?.out?.stage === 'confirm' && (await view(studio)).pairing.out)
  const asked = await until(async () => (await view(mini)).pairing?.in)
  assert.equal(asked.stage, 'ask')
  assert.equal(asked.name, 'Studio')
  assert.equal(asked.sas, asking.sas, 'the code on the Mac mini is the code on the Studio')
  await assert.rejects(mini.run(`clique.pairWith((clique.snapshot().computers.nearby[0]).id)`), /linking with/, 'one linking at a time')
  await mini.run(`clique.pairAnswer(${JSON.stringify(asked.id)}, true)`)
  const agreed = await until(async () => (await view(studio)).pairing?.out?.theyAgreed && (await view(studio)).pairing.out)
  assert.equal(agreed.stage, 'confirm', 'a yes there doesn\'t link: the code has to be checked here too')
  assert.ok(!('code' in agreed), 'the link code (its key) never reaches the page')
  await studio.run('clique.pairCancel()')
  const cancelled = await until(async () => (await view(mini)).pairing?.in?.stage === 'failed' && (await view(mini)).pairing.in, 8000)
  assert.equal(cancelled.error, 'cancelled')
  assert.deepEqual(await names(studio), ['iris'], 'nothing linked')
  await mini.run('clique.pairDone()')

  // again: Link here first (waiting for the Mac mini), then Link there
  await studio.run(`clique.pairWith(${JSON.stringify(found.id)})`)
  await until(async () => (await view(studio)).pairing?.out?.stage === 'confirm')
  await studio.run('clique.pairConfirm()')
  assert.equal((await view(studio)).pairing.out.stage, 'waiting')
  const again = await until(async () => (await view(mini)).pairing?.in?.stage === 'ask' && (await view(mini)).pairing.in)
  await mini.run(`clique.pairAnswer(${JSON.stringify(again.id)}, true)`)
  const linked = await until(async () => (await view(studio)).pairing?.out?.stage === 'linked' && (await view(studio)).pairing.out)
  assert.equal(linked.slug, 'mac-mini')
  assert.equal((await until(async () => (await view(mini)).pairing?.in?.stage === 'linked' && (await view(mini)).pairing.in)).slug, 'studio')
  // each one's workspace shows up on the other, as that computer's
  const hosted = (c) => c.run('clique.workspaces().filter((w) => w.owner).map((w) => w.ownerName)')
  await until(async () => (await hosted(studio)).length === 1 && (await hosted(mini)).length === 1)
  assert.deepEqual(await hosted(studio), ['Mac mini'])
  assert.deepEqual(await hosted(mini), ['Studio'])
  assert.equal((await view(studio)).nearby.length, 0, 'a linked computer leaves Nearby: it\'s under Linked')
  assert.equal(await mini.run('clique.settings.share'), true, 'the Mac mini keeps sharing, so the Studio comes back after a restart')
  assert.equal((await studio.run('clique.settings.peers')).length, 1, 'the Studio saved its code, as if pasted')
  await studio.run('clique.pairDone()')
  await mini.run('clique.pairDone()')
  assert.equal((await view(studio)).pairing, null)

  // the Mac mini stops letting computers link with its code, Computers still open: the Studio is let go, and stays out
  await mini.run('clique.share(false)')
  const off = await until(async () => (await view(studio)).links.find((l) => l.slug === 'mac-mini' && !l.online))
  await until(async () => /stopped letting/.test((await view(studio)).links.find((l) => l.slug === 'mac-mini').status?.error ?? ''), 8000)
  assert.ok(off)
  await mini.run('clique.share(true)')
  await until(async () => (await view(studio)).links.find((l) => l.slug === 'mac-mini')?.online, 10000)

  await studio.run('clique.discover(false)')
  assert.equal((await view(studio)).nearby, null)
})

test("a link port that's taken is an answer, not a crash", async () => {
  const blocker = net.createServer()
  await new Promise((r) => blocker.listen(0, '0.0.0.0', r))
  const { cert, key } = identity(fs.mkdtempSync(path.join(os.tmpdir(), 'clique-link-port-')))
  const host = new LinkHost({ key: 'k', cert, keyPem: key, name: 'Test', handle: () => {} })
  let crashed = null
  const watch = (e) => (crashed = e)
  process.once('uncaughtException', watch)
  await assert.rejects(host.start(blocker.address().port), /EADDRINUSE/)
  await new Promise((r) => setImmediate(r))
  process.off('uncaughtException', watch)
  blocker.close()
  assert.equal(crashed, null)
})

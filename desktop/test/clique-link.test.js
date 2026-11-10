// Two computers linked over CLIque Link, each a real CLIque in its own process and throwaway CLIQUE_HOME: a workspace of one
// computer's with both computers' agents in it, choosing agents, editing, sending and relaying across, export/import and
// moving agents between them.
// Every agent stays off, so no CLI is launched. Run with `npm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 20000 + Math.floor(Math.random() * 20000)

function computer(name, linkPort, agents) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-link-test-'))
  fs.mkdirSync(path.join(home, 'link'))
  fs.writeFileSync(path.join(home, 'link', 'link.json'), JSON.stringify({ name, port: linkPort }))
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
  const run = (code) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      waiting.set(id, { resolve, reject })
      p.stdin.write(JSON.stringify({ id, code }) + '\n')
    })
  return { up, run, home, stop: () => (p.kill(), fs.rmSync(home, { recursive: true, force: true, maxRetries: 10 })) }
}

const studio = computer('Studio Mac', port, [
  { name: 'iris', area: 'design, 3D, illustrations' },
  { name: 'bob', area: 'backend api servers' },
])
const laptop = computer('Laptop', port + 1, [{ name: 'ann', area: 'docs writing' }])
const names = async (c) => (await c.run(`clique.snapshot().agents.map((a) => a.name)`)).sort()

before(async () => {
  await Promise.all([studio.up, laptop.up])
  await studio.run(`clique.share(true)`)
  const code = await studio.run(`clique.snapshot().computers.me.code`)
  assert.equal(await laptop.run(`clique.connect(${JSON.stringify(code)})`), 'studio-mac')
  assert.equal(await laptop.run(`clique.connect(${JSON.stringify(code)})`), 'studio-mac', 'linking twice reuses the link')
  await sleep(300)
  // the studio's workspace shows up on the laptop on its own, as the studio's; ann joins it there
  const id = await laptop.run(`clique.workspaces().find((w) => w.owner === 'studio-mac').id`)
  await laptop.run(`(clique.workspaceAction('members', ${JSON.stringify(id)}, { add: ['ann'] }), clique.workspaceAction('switch', ${JSON.stringify(id)}), 1)`)
  await sleep(300)
})
after(() => {
  studio.stop()
  laptop.stop()
})

test('a workspace on two computers has both computers\' agents, the other\'s as name@computer', async () => {
  assert.deepEqual(await names(laptop), ['ann', 'bob@studio-mac', 'iris@studio-mac'])
  assert.deepEqual(await names(studio), ['ann@laptop', 'bob', 'iris'])
})

test('a bare name finds the agent wherever it lives; this computer wins a tie', async () => {
  assert.equal(await laptop.run(`clique.resolve('iris')`), 'iris@studio-mac')
  assert.equal(await laptop.run(`clique.resolve('ann')`), 'ann')
  await assert.rejects(laptop.run(`clique.resolve('nobody')`), /no agent named/)
})

test('edits reach the computer the agent lives on', async () => {
  await laptop.run(`clique.update('iris@studio-mac', { area: 'design and 3D' })`)
  await sleep(200)
  assert.equal(await studio.run(`clique.hubs.get('default').agents.get('iris').area`), 'design and 3D')
  assert.equal(await laptop.run(`clique.snapshot().agents.find((a) => a.name === 'iris@studio-mac').area`), 'design and 3D')
})

test('hiding a linked computer\'s agent takes it out of this clique only', async () => {
  await laptop.run(`clique.setHidden(['bob@studio-mac'], true)`)
  assert.deepEqual(await names(laptop), ['ann', 'iris@studio-mac'])
  assert.equal(await laptop.run(`clique.snapshot().computers.links[0].agents.find((a) => a.name === 'bob@studio-mac').hidden`), true)
  assert.ok((await names(studio)).includes('bob'))
  await laptop.run(`clique.setHidden(['bob@studio-mac'], false)`)
})

test('an agent\'s `clique send` reaches a teammate on the other computer, by bare name', async () => {
  await studio.run(`(clique.hubs.get('default').agents.get('bob').off = false, 1)`) // on, not launched: the message queues
  assert.match(await laptop.run(`clique.here.send({ from: 'ann', to: 'bob', text: 'check the api' })`), /bob/)
  await sleep(300)
  const there = await studio.run(`clique.hubs.get('default').feed.filter((e) => e.kind === 'msg').map((e) => e.from + '>' + e.to)`)
  assert.ok(there.includes('ann@laptop>bob'), there)
  const here = await laptop.run(`clique.snapshot().feed.filter((e) => e.kind === 'msg').map((e) => e.from + '>' + e.to)`)
  assert.ok(here.includes('ann>bob@studio-mac'), here)
  assert.match(await laptop.run(`clique.here.who()`), /bob@studio-mac/)
})

test('sending to an agent that is off on the other computer says so', async () => {
  await assert.rejects(laptop.run(`clique.send('iris', 'hi')`), /turned off/)
})

test('export from both computers, import onto either', async () => {
  const pack = await laptop.run(`clique.exportAgents(['iris@studio-mac', 'ann'])`)
  assert.deepEqual(pack.agents.map((a) => a.name), ['iris', 'ann'])
  assert.equal(pack.agents[0].avatar.seed, 'iris', 'the look survives a rename')
  const preview = await laptop.run(`clique.importPreview(${JSON.stringify(pack)})`)
  assert.deepEqual(preview.map((a) => a.name), ['iris', 'ann-2'], 'names already taken here get a free one')
  const added = await laptop.run(`clique.importAgents(${JSON.stringify(pack)}, [{ index: 0, name: 'iris-copy', home: 'studio-mac' }, { index: 1, name: 'ann-2' }])`)
  assert.deepEqual(added, ['iris-copy@studio-mac', 'ann-2'])
  assert.equal(await studio.run(`clique.hubs.get('default').agents.get('iris-copy').off`), true, 'imported agents start off')
})

test('moving an agent takes its definition and work experience, from either side', async () => {
  await studio.run(`(clique.hubs.get('default').stats.iris = { first: 1, days: {}, tasks: 3 }, clique.hubs.get('default').saveStats(), 1)`)
  assert.deepEqual(await laptop.run(`clique.moveAgent('iris@studio-mac', '', '~')`), { name: 'iris', conversation: 'fresh', reason: "it hadn't started a conversation yet" })
  await sleep(200)
  assert.equal(await studio.run(`clique.hubs.get('default').agents.has('iris')`), false)
  assert.equal(await laptop.run(`clique.here.stats.iris.tasks`), 3)
  assert.equal((await studio.run(`clique.moveAgent('iris@laptop', '')`)).name, 'iris')
  await sleep(200)
  assert.deepEqual((await names(laptop)).filter((n) => n.startsWith('iris')), ['iris-copy@studio-mac', 'iris@studio-mac'])
})

test('each computer\'s usage limits reach the other, with its link: its agents run on its own accounts', async () => {
  const soon = Date.now() + 3600000
  await studio.run(`clique.hubs.get('default').setUsage('claude', [{ id: 'five_hour', pct: 12, resetsAt: ${soon} }])`)
  await sleep(300)
  const there = await laptop.run(`clique.snapshot().computers.links[0].usage`)
  assert.deepEqual(there.claude.windows.map((w) => [w.id, w.pct]), [['five_hour', 12]])
  assert.equal(there.claude.label, 'Claude')
  assert.equal(await laptop.run(`JSON.stringify(clique.snapshot().usage)`), '{}', 'this computer\'s own stay its own')
  // read by an agent in another workspace there: the account is the computer's, so it still comes across
  await studio.run(`(clique.workspaceAction('create', null, { name: 'elsewhere', show: false }), clique.hubs.get('elsewhere').setUsage('codex', [{ id: 'seven_day', pct: 7, resetsAt: ${soon + 86400000} }]), 1)`)
  await sleep(300)
  assert.deepEqual(Object.keys(await laptop.run(`clique.snapshot().computers.links[0].usage`)).sort(), ['claude', 'codex'])
  // a window that has reset since its last word is gone (two hours on: Claude's 5-hour has, Codex's week hasn't)
  const later = await laptop.run(`((now) => { Date.now = () => now() + 7200000; try { return Object.keys(clique.snapshot().computers.links[0].usage) } finally { Date.now = now } })(Date.now)`)
  assert.deepEqual(later, ['codex'])
})

test('each computer\'s own workspace shows up on the other, as that computer\'s', async () => {
  const of = async (c) => (await c.run(`clique.workspaces().map((w) => [w.name, w.ownerName ?? ''])`))
  assert.deepEqual(await of(studio), [['Home', ''], ['elsewhere', ''], ['Home', 'Laptop']])
  assert.deepEqual((await of(laptop)).slice(0, 2), [['Home', ''], ['Home', 'Studio Mac']])
  // its clique there, and nobody of the studio's until you add them
  const id = await studio.run(`clique.workspaces().find((w) => w.owner === 'laptop').id`)
  assert.deepEqual(await studio.run(`clique.snapshot(clique.hubs.get(${JSON.stringify(id)})).agents.map((a) => a.name)`), ['ann@laptop'])
})

test('forgetting a computer drops its agents here, and it drops ours', async () => {
  await laptop.run(`clique.forget('studio-mac')`)
  await sleep(300)
  assert.deepEqual(await names(laptop), ['ann', 'ann-2'])
  assert.equal((await names(studio)).some((n) => n.includes('@')), false)
})

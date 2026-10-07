// Two computers linked over Crew Link, each a real Crew in its own process and throwaway CREW_HOME: the merged
// crew, choosing agents, editing, sending and relaying across, export/import and moving agents between them.
// Every agent stays off, so no CLI is launched. Run with `npm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 20000 + Math.floor(Math.random() * 20000)

function computer(name, linkPort, agents) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-link-test-'))
  fs.mkdirSync(path.join(home, 'link'))
  fs.writeFileSync(path.join(home, 'link', 'link.json'), JSON.stringify({ name, port: linkPort }))
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ agents: agents.map((a) => ({ off: true, ...a })) }))
  const p = spawn(process.execPath, [new URL('./helpers/computer.mjs', import.meta.url).pathname], { env: { ...process.env, CREW_HOME: home, NAME: name }, stdio: ['pipe', 'pipe', 'inherit'] })
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
  return { up, run, home, stop: () => (p.kill(), fs.rmSync(home, { recursive: true, force: true })) }
}

const studio = computer('Studio Mac', port, [
  { name: 'gal', area: 'design, 3D, illustrations' },
  { name: 'bob', area: 'backend api servers' },
])
const air = computer('Air', port + 1, [{ name: 'ann', area: 'docs writing' }])
const names = async (c) => (await c.run(`crew.snapshot().agents.map((a) => a.name)`)).sort()

before(async () => {
  await Promise.all([studio.up, air.up])
  await studio.run(`crew.share(true)`)
  const code = await studio.run(`crew.snapshot().computers.me.code`)
  assert.equal(await air.run(`crew.connect(${JSON.stringify(code)})`), 'studio-mac')
  assert.equal(await air.run(`crew.connect(${JSON.stringify(code)})`), 'studio-mac', 'linking twice reuses the link')
  await sleep(300)
})
after(() => {
  studio.stop()
  air.stop()
})

test('each computer sees the whole crew, the other computer\'s agents as name@computer', async () => {
  assert.deepEqual(await names(air), ['ann', 'bob@studio-mac', 'gal@studio-mac'])
  assert.deepEqual(await names(studio), ['ann@air', 'bob', 'gal'])
})

test('a bare name finds the agent wherever it lives; this computer wins a tie', async () => {
  assert.equal(await air.run(`crew.resolve('gal')`), 'gal@studio-mac')
  assert.equal(await air.run(`crew.resolve('ann')`), 'ann')
  await assert.rejects(air.run(`crew.resolve('nobody')`), /no agent named/)
})

test('edits reach the computer the agent lives on', async () => {
  await air.run(`crew.update('gal@studio-mac', { area: 'design and 3D' })`)
  await sleep(200)
  assert.equal(await studio.run(`crew.hub.agents.get('gal').area`), 'design and 3D')
  assert.equal(await air.run(`crew.snapshot().agents.find((a) => a.name === 'gal@studio-mac').area`), 'design and 3D')
})

test('hiding a linked computer\'s agent takes it out of this crew only', async () => {
  await air.run(`crew.setHidden(['bob@studio-mac'], true)`)
  assert.deepEqual(await names(air), ['ann', 'gal@studio-mac'])
  assert.equal(await air.run(`crew.snapshot().computers.links[0].agents.find((a) => a.name === 'bob@studio-mac').hidden`), true)
  assert.ok((await names(studio)).includes('bob'))
  await air.run(`crew.setHidden(['bob@studio-mac'], false)`)
})

test('an agent\'s `crew send` reaches a teammate on the other computer, by bare name', async () => {
  await studio.run(`(crew.hub.agents.get('bob').off = false, 1)`) // on, not launched: the message queues
  assert.match(await air.run(`crew.hub.send({ from: 'ann', to: 'bob', text: 'check the api' })`), /bob/)
  await sleep(300)
  const there = await studio.run(`crew.hub.feed.filter((e) => e.kind === 'msg').map((e) => e.from + '>' + e.to)`)
  assert.ok(there.includes('ann@air>bob'), there)
  const here = await air.run(`crew.snapshot().feed.filter((e) => e.kind === 'msg').map((e) => e.from + '>' + e.to)`)
  assert.ok(here.includes('ann>bob@studio-mac'), here)
  assert.match(await air.run(`crew.hub.who()`), /bob@studio-mac/)
})

test('sending to an agent that is off on the other computer says so', async () => {
  await assert.rejects(air.run(`crew.send('gal', 'hi')`), /turned off/)
})

test('export from both computers, import onto either', async () => {
  const pack = await air.run(`crew.exportAgents(['gal@studio-mac', 'ann'])`)
  assert.deepEqual(pack.agents.map((a) => a.name), ['gal', 'ann'])
  assert.equal(pack.agents[0].avatar.seed, 'gal', 'the look survives a rename')
  const preview = await air.run(`crew.importPreview(${JSON.stringify(pack)})`)
  assert.deepEqual(preview.map((a) => a.name), ['gal', 'ann-2'], 'names already taken here get a free one')
  const added = await air.run(`crew.importAgents(${JSON.stringify(pack)}, [{ index: 0, name: 'gal-copy', home: 'studio-mac' }, { index: 1, name: 'ann-2' }])`)
  assert.deepEqual(added, ['gal-copy@studio-mac', 'ann-2'])
  assert.equal(await studio.run(`crew.hub.agents.get('gal-copy').off`), true, 'imported agents start off')
})

test('moving an agent takes its definition and work experience, from either side', async () => {
  await studio.run(`(crew.hub.stats.gal = { first: 1, days: {}, tasks: 3 }, crew.hub.saveStats(), 1)`)
  assert.equal(await air.run(`crew.moveAgent('gal@studio-mac', '', '~')`), 'gal')
  await sleep(200)
  assert.equal(await studio.run(`crew.hub.agents.has('gal')`), false)
  assert.equal(await air.run(`crew.hub.stats.gal.tasks`), 3)
  assert.equal(await studio.run(`crew.moveAgent('gal@air', '')`), 'gal')
  await sleep(200)
  assert.deepEqual((await names(air)).filter((n) => n.startsWith('gal')), ['gal-copy@studio-mac', 'gal@studio-mac'])
})

test('forgetting a computer drops its agents here, and it drops ours', async () => {
  await air.run(`crew.forget('studio-mac')`)
  await sleep(300)
  assert.deepEqual(await names(air), ['ann', 'ann-2'])
  assert.equal((await names(studio)).some((n) => n.includes('@')), false)
})

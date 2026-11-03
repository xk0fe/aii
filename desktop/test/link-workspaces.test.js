// Crew Link in workspaces: a workspace with the same id on two linked computers is one crew. Each computer sees the
// other's agents in it (and only in it), edits and messages reach them there, their alerts say which workspace, and an
// agent moves to that workspace on the other computer. Two real Crews, each in its own process and throwaway
// CREW_HOME, linked over 127.0.0.1 only. No CLI is launched: agents are off, or on with launching stubbed. Run with
// `npm test`.
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

function computer(name, linkPort, config) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-link-ws-'))
  fs.mkdirSync(path.join(home, 'link'))
  fs.writeFileSync(path.join(home, 'link', 'link.json'), JSON.stringify({ name, port: linkPort }))
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config))
  const p = spawn(process.execPath, [fileURLToPath(new URL('./helpers/computer.mjs', import.meta.url))], { env: { ...process.env, CREW_HOME: home, NAME: name }, stdio: ['pipe', 'pipe', 'inherit'] })
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
  return { up, run, home, config: () => JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')), stop: () => (p.kill(), fs.rmSync(home, { recursive: true, force: true, maxRetries: 10 })) }
}

const off = { off: true }
// storefront on both; site only on the studio, lab only on the laptop
const studio = computer('Studio Mac', port, {
  agents: [{ name: 'iris', area: 'design', ...off }, { name: 'bob', area: 'backend', ...off }],
  workspaces: [
    { id: 'storefront', name: 'Storefront', members: { iris: off }, agents: [{ name: 'ivo', area: 'release', ...off }] },
    { id: 'site', members: { bob: off } },
  ],
})
const laptop = computer('Laptop', port + 1, {
  agents: [{ name: 'ann', area: 'docs', ...off }],
  workspaces: [
    { id: 'storefront', name: 'Storefront', members: { ann: off }, agents: [{ name: 'milo', area: 'writing', ...off }] },
    { id: 'lab', members: { ann: off } },
  ],
})
const names = async (c) => (await c.run(`crew.snapshot().agents.map((a) => a.name)`)).sort()
const until = async (c, code, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await c.run(code)) return
  throw new Error(`timed out: ${code}`)
}

before(async () => {
  await Promise.all([studio.up, laptop.up])
  await studio.run(`crew.share(true)`)
  // the code, with only this computer's loopback address: one connection, not one per network
  const code = await studio.run(`crew.snapshot().computers.me.code`)
  const c = JSON.parse(Buffer.from(code.slice(6), 'base64url'))
  const local = 'crew1.' + Buffer.from(JSON.stringify({ ...c, h: ['127.0.0.1'] })).toString('base64url')
  assert.equal(await laptop.run(`crew.connect(${JSON.stringify(local)})`), 'studio-mac')
  await until(studio, `Boolean(crew.links.get('laptop')?.spaces?.storefront)`)
  await until(laptop, `Boolean(crew.links.get('studio-mac')?.spaces?.storefront)`)
})
after(() => {
  studio.stop()
  laptop.stop()
})

test('a workspace with the same id on both computers is one crew; the others show only on their own computer', async () => {
  await studio.run(`crew.workspaceAction('switch', 'storefront')`)
  assert.deepEqual(await names(studio), ['ann@laptop', 'iris', 'ivo', 'milo@laptop'])
  assert.deepEqual(await studio.run(`crew.snapshot().computers.links[0].spaces`), ['storefront'], 'the workspaces both have: the laptop keeps its lab to itself')
  await studio.run(`crew.workspaceAction('switch', 'site')`)
  assert.deepEqual(await names(studio), ['bob'], "the laptop has no site: none of its agents here")
  await studio.run(`crew.workspaceAction('switch', 'default')`)
  assert.deepEqual(await names(studio), ['ann@laptop', 'bob', 'iris'], "the default as always: milo is only the laptop's storefront's")
  await laptop.run(`crew.workspaceAction('switch', 'lab')`)
  assert.deepEqual(await names(laptop), ['ann'])
  await laptop.run(`crew.workspaceAction('switch', 'default')`)
})

test('edits and messages in a workspace reach its agents on the other computer, in that workspace there', async () => {
  await studio.run(`crew.workspaceAction('switch', 'storefront')`)
  await studio.run(`crew.update('milo@laptop', { area: 'docs and guides' })`)
  await sleep(200)
  assert.equal(laptop.config().workspaces[0].agents[0].area, 'docs and guides', "the laptop's storefront's own milo")
  // on in config.json (so no reload turns it back off), with launching stubbed: no CLI, and the message queues
  const on = (name) => `(crew.hubs.get('storefront').launch = () => {}, crew.hubs.get('storefront').update(${JSON.stringify(name)}, { off: false }), 1)`
  await laptop.run(on('milo'))
  await studio.run(`crew.send('milo@laptop', 'write the readme')`)
  await sleep(200)
  assert.equal(await laptop.run(`crew.hubs.get('storefront').feed.some((e) => e.kind === 'msg' && e.text === 'write the readme')`), true)
  assert.equal(await laptop.run(`crew.hub.feed.some((e) => e.text === 'write the readme')`), false, 'not in its default')
  // an agent there writes back to one here, in storefront
  await studio.run(on('ivo'))
  assert.match(await laptop.run(`crew.hubs.get('storefront').send({ from: 'milo', to: 'ivo@studio-mac', text: 'check the release notes' })`), /ivo/)
  await sleep(200)
  const there = await studio.run(`crew.hubs.get('storefront').feed.filter((e) => e.kind === 'msg').map((e) => e.from + '>' + e.to + ':' + e.text)`)
  assert.ok(there.includes('milo@laptop>ivo:check the release notes'), there)
  assert.match(await studio.run(`crew.snapshot().feed.map((e) => e.text).join('|')`), /write the readme/, "studio's storefront chat has the laptop's storefront lines too")
})

test("alerts from a workspace on the other computer say which; one this computer hasn't got stays there", async () => {
  await studio.run(`(globalThis.alerts = [], crew.on('alert', (n, t, ws) => alerts.push([n, ws])), 1)`)
  await laptop.run(`(crew.hubs.get('storefront').emit('alert', { name: 'milo' }, 'needs you'), crew.hubs.get('lab').emit('alert', { name: 'ann' }, 'needs you'), 1)`)
  await sleep(200)
  assert.deepEqual(await studio.run(`alerts`), [['milo@laptop', 'storefront']])
})

test('moving an agent in a workspace takes it to that workspace on the other computer', async () => {
  await studio.run(`crew.workspaceAction('switch', 'storefront')`)
  await studio.run(`(crew.hubs.get('storefront').update('ivo', { off: true }), 1)`) // off, so it arrives off: no CLI there
  // one of storefront's own agents: storefront's own there
  assert.equal((await studio.run(`crew.moveAgent('ivo', 'laptop', '~')`)).name, 'ivo@laptop')
  await sleep(200)
  assert.deepEqual(laptop.config().workspaces[0].agents.map((a) => a.name), ['milo', 'ivo'])
  assert.equal(studio.config().workspaces[0].agents?.some((a) => a.name === 'ivo') ?? false, false)
  // one of your shared agents: it joins the laptop's crew (off in its default) and its storefront, and leaves only storefront here
  assert.equal((await studio.run(`crew.moveAgent('iris', 'laptop', '~')`)).name, 'iris@laptop')
  await sleep(200)
  assert.equal(laptop.config().agents.find((a) => a.name === 'iris')?.off, true)
  assert.ok('iris' in laptop.config().workspaces[0].members)
  assert.ok(studio.config().agents.some((a) => a.name === 'iris'), 'still in the studio\'s crew')
  assert.equal('iris' in studio.config().workspaces[0].members, false)
  // a computer without the workspace
  await studio.run(`crew.workspaceAction('switch', 'site')`)
  await assert.rejects(studio.run(`crew.moveAgent('bob', 'laptop', '~')`), /Laptop has no site workspace/)
})

test('a shared agent moved there and back rejoins its crew here, not as a copy', async () => {
  await studio.run(`crew.workspaceAction('switch', 'storefront')`)
  assert.equal((await studio.run(`crew.moveAgent('iris@laptop', '', '~')`)).name, 'iris')
  await sleep(200)
  assert.deepEqual(studio.config().agents.map((a) => a.name).sort(), ['bob', 'iris'], 'no iris-2')
  assert.ok('iris' in studio.config().workspaces[0].members)
  assert.equal('iris' in laptop.config().workspaces[0].members, false, "it left the laptop's storefront")
})

test('a workspace made on both shows up on both; one removed on one computer is gone from the other', async () => {
  await laptop.run(`crew.workspaceAction('create', null, { name: 'Side' })`)
  await studio.run(`crew.workspaceAction('create', null, { name: 'Side' })`)
  await until(studio, `Boolean(crew.links.get('laptop')?.spaces?.side)`)
  await until(laptop, `Boolean(crew.links.get('studio-mac')?.spaces?.side)`)
  await laptop.run(`crew.workspaceAction('remove', 'side')`)
  await until(studio, `!crew.links.get('laptop')?.spaces?.side`)
  assert.deepEqual(await studio.run(`crew.snapshot().computers.links[0].spaces`), ['storefront'])
})

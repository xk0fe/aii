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
  return { up, run, home, config: () => JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')), stop: () => (p.kill(), fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 })) }
}

const off = { off: true }
// golf on both; site only on the studio, lab only on the air
const studio = computer('Studio Mac', port, {
  agents: [{ name: 'gal', area: 'design', ...off }, { name: 'bob', area: 'backend', ...off }],
  workspaces: [
    { id: 'golf', name: 'Golf', members: { gal: off }, agents: [{ name: 'ivy', area: 'release', ...off }] },
    { id: 'site', members: { bob: off } },
  ],
})
const air = computer('Air', port + 1, {
  agents: [{ name: 'ann', area: 'docs', ...off }],
  workspaces: [
    { id: 'golf', name: 'Golf', members: { ann: off }, agents: [{ name: 'kim', area: 'writing', ...off }] },
    { id: 'lab', members: { ann: off } },
  ],
})
const names = async (c) => (await c.run(`crew.snapshot().agents.map((a) => a.name)`)).sort()
const until = async (c, code, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await c.run(code)) return
  throw new Error(`timed out: ${code}`)
}

before(async () => {
  await Promise.all([studio.up, air.up])
  await studio.run(`crew.share(true)`)
  // the code, with only this computer's loopback address: one connection, not one per network
  const code = await studio.run(`crew.snapshot().computers.me.code`)
  const c = JSON.parse(Buffer.from(code.slice(6), 'base64url'))
  const local = 'crew1.' + Buffer.from(JSON.stringify({ ...c, h: ['127.0.0.1'] })).toString('base64url')
  assert.equal(await air.run(`crew.connect(${JSON.stringify(local)})`), 'studio-mac')
  await until(studio, `Boolean(crew.links.get('air')?.spaces?.golf)`)
  await until(air, `Boolean(crew.links.get('studio-mac')?.spaces?.golf)`)
})
after(() => {
  studio.stop()
  air.stop()
})

test('a workspace with the same id on both computers is one crew; the others show only on their own computer', async () => {
  await studio.run(`crew.workspaceAction('switch', 'golf')`)
  assert.deepEqual(await names(studio), ['ann@air', 'gal', 'ivy', 'kim@air'])
  assert.deepEqual(await studio.run(`crew.snapshot().computers.links[0].spaces`), ['golf'], 'the workspaces both have: the air keeps its lab to itself')
  await studio.run(`crew.workspaceAction('switch', 'site')`)
  assert.deepEqual(await names(studio), ['bob'], "the air has no site: none of its agents here")
  await studio.run(`crew.workspaceAction('switch', 'default')`)
  assert.deepEqual(await names(studio), ['ann@air', 'bob', 'gal'], "the default as always: kim is only the air's golf's")
  await air.run(`crew.workspaceAction('switch', 'lab')`)
  assert.deepEqual(await names(air), ['ann'])
  await air.run(`crew.workspaceAction('switch', 'default')`)
})

test('edits and messages in a workspace reach its agents on the other computer, in that workspace there', async () => {
  await studio.run(`crew.workspaceAction('switch', 'golf')`)
  await studio.run(`crew.update('kim@air', { area: 'docs and guides' })`)
  await sleep(200)
  assert.equal(air.config().workspaces[0].agents[0].area, 'docs and guides', "the air's golf's own kim")
  // on in config.json (so no reload turns it back off), with launching stubbed: no CLI, and the message queues
  const on = (name) => `(crew.hubs.get('golf').launch = () => {}, crew.hubs.get('golf').update(${JSON.stringify(name)}, { off: false }), 1)`
  await air.run(on('kim'))
  await studio.run(`crew.send('kim@air', 'write the readme')`)
  await sleep(200)
  assert.equal(await air.run(`crew.hubs.get('golf').feed.some((e) => e.kind === 'msg' && e.text === 'write the readme')`), true)
  assert.equal(await air.run(`crew.hub.feed.some((e) => e.text === 'write the readme')`), false, 'not in its default')
  // an agent there writes back to one here, in golf
  await studio.run(on('ivy'))
  assert.match(await air.run(`crew.hubs.get('golf').send({ from: 'kim', to: 'ivy@studio-mac', text: 'check the release notes' })`), /ivy/)
  await sleep(200)
  const there = await studio.run(`crew.hubs.get('golf').feed.filter((e) => e.kind === 'msg').map((e) => e.from + '>' + e.to + ':' + e.text)`)
  assert.ok(there.includes('kim@air>ivy:check the release notes'), there)
  assert.match(await studio.run(`crew.snapshot().feed.map((e) => e.text).join('|')`), /write the readme/, "studio's golf chat has the air's golf lines too")
})

test("alerts from a workspace on the other computer say which; one this computer hasn't got stays there", async () => {
  await studio.run(`(globalThis.alerts = [], crew.on('alert', (n, t, ws) => alerts.push([n, ws])), 1)`)
  await air.run(`(crew.hubs.get('golf').emit('alert', { name: 'kim' }, 'needs you'), crew.hubs.get('lab').emit('alert', { name: 'ann' }, 'needs you'), 1)`)
  await sleep(200)
  assert.deepEqual(await studio.run(`alerts`), [['kim@air', 'golf']])
})

test('moving an agent in a workspace takes it to that workspace on the other computer', async () => {
  await studio.run(`crew.workspaceAction('switch', 'golf')`)
  await studio.run(`(crew.hubs.get('golf').update('ivy', { off: true }), 1)`) // off, so it arrives off: no CLI there
  // one of golf's own agents: golf's own there
  assert.equal((await studio.run(`crew.moveAgent('ivy', 'air', '~')`)).name, 'ivy@air')
  await sleep(200)
  assert.deepEqual(air.config().workspaces[0].agents.map((a) => a.name), ['kim', 'ivy'])
  assert.equal(studio.config().workspaces[0].agents?.some((a) => a.name === 'ivy') ?? false, false)
  // one of your shared agents: it joins the air's crew (off in its default) and its golf, and leaves only golf here
  assert.equal((await studio.run(`crew.moveAgent('gal', 'air', '~')`)).name, 'gal@air')
  await sleep(200)
  assert.equal(air.config().agents.find((a) => a.name === 'gal')?.off, true)
  assert.ok('gal' in air.config().workspaces[0].members)
  assert.ok(studio.config().agents.some((a) => a.name === 'gal'), 'still in the studio\'s crew')
  assert.equal('gal' in studio.config().workspaces[0].members, false)
  // a computer without the workspace
  await studio.run(`crew.workspaceAction('switch', 'site')`)
  await assert.rejects(studio.run(`crew.moveAgent('bob', 'air', '~')`), /Air has no site workspace/)
})

test('a shared agent moved there and back rejoins its crew here, not as a copy', async () => {
  await studio.run(`crew.workspaceAction('switch', 'golf')`)
  assert.equal((await studio.run(`crew.moveAgent('gal@air', '', '~')`)).name, 'gal')
  await sleep(200)
  assert.deepEqual(studio.config().agents.map((a) => a.name).sort(), ['bob', 'gal'], 'no gal-2')
  assert.ok('gal' in studio.config().workspaces[0].members)
  assert.equal('gal' in air.config().workspaces[0].members, false, "it left the air's golf")
})

test('a workspace made on both shows up on both; one removed on one computer is gone from the other', async () => {
  await air.run(`crew.workspaceAction('create', null, { name: 'Side' })`)
  await studio.run(`crew.workspaceAction('create', null, { name: 'Side' })`)
  await until(studio, `Boolean(crew.links.get('air')?.spaces?.side)`)
  await until(air, `Boolean(crew.links.get('studio-mac')?.spaces?.side)`)
  await air.run(`crew.workspaceAction('remove', 'side')`)
  await until(studio, `!crew.links.get('air')?.spaces?.side`)
  assert.deepEqual(await studio.run(`crew.snapshot().computers.links[0].spaces`), ['golf'])
})

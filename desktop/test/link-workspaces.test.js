// CLIque Link in workspaces: a workspace belongs to the computer that made it, and shows up on the computers linked to it
// on their own, as that computer's (one you hide stays hidden). Then it's one clique there, each computer seeing the
// other's agents in it (and only in it), edits and messages reach them there, their alerts say which workspace, and an
// agent moves to that workspace on the other computer. The same id or name on two computers is still two workspaces.
// Two real Cliques, each in its own process and throwaway
// CLIQUE_HOME, linked over 127.0.0.1 only. No CLI is launched: agents are off, or on with launching stubbed. Run with
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

function computer(name, linkPort, config, link = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-link-ws-'))
  fs.mkdirSync(path.join(home, 'link'))
  fs.writeFileSync(path.join(home, 'link', 'link.json'), JSON.stringify({ name, port: linkPort, ...link }))
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config))
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
  return { up, run, home, config: () => JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')), stop: () => (p.kill(), fs.rmSync(home, { recursive: true, force: true, maxRetries: 10 })) }
}

const off = { off: true }
// storefront is the studio's, shown on the laptop; site is on both but each computer's own; lab only on the laptop; and
// each has the workspace an older CLIque left it with (agents at the top of config.json). Each hid the other's site and that
// one (and the studio the laptop's lab), so they stay each computer's to itself
const studio = computer('Studio Mac', port, {
  agents: [{ name: 'iris', area: 'design', ...off }, { name: 'bob', area: 'backend', ...off }],
  workspaces: [
    { id: 'storefront', name: 'Storefront', members: { iris: off }, agents: [{ name: 'ivo', area: 'release', ...off }] },
    { id: 'site', members: { bob: off } },
  ],
}, { hiddenWorkspaces: ['laptop:site', 'laptop:lab', 'laptop:default'] })
const laptop = computer('Laptop', port + 1, {
  agents: [{ name: 'ann', area: 'docs', ...off }],
  workspaces: [
    { id: 'storefront', name: 'Storefront', of: { computer: 'studio-mac', id: 'storefront' }, members: { ann: off }, agents: [{ name: 'milo', area: 'writing', ...off }] },
    { id: 'site', name: 'site', members: { ann: off } },
    { id: 'lab', members: { ann: off } },
  ],
}, { hiddenWorkspaces: ['studio-mac:site', 'studio-mac:default'] })
const names = async (c) => (await c.run(`clique.snapshot().agents.map((a) => a.name)`)).sort()
const wsOf = (c, id) => c.config().workspaces.find((w) => w.id === id)
const until = async (c, code, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await c.run(code)) return
  throw new Error(`timed out: ${code}`)
}

before(async () => {
  await Promise.all([studio.up, laptop.up])
  await studio.run(`clique.share(true)`)
  // the code, with only this computer's loopback address: one connection, not one per network
  const code = await studio.run(`clique.snapshot().computers.me.code`)
  const c = JSON.parse(Buffer.from(code.slice('clique1.'.length), 'base64url'))
  const local = 'clique1.' + Buffer.from(JSON.stringify({ ...c, h: ['127.0.0.1'] })).toString('base64url')
  assert.equal(await laptop.run(`clique.connect(${JSON.stringify(local)})`), 'studio-mac')
  await until(studio, `Boolean(clique.links.get('laptop')?.spaces?.storefront)`)
  await until(laptop, `Boolean(clique.links.get('studio-mac')?.spaces?.storefront)`)
})
after(() => {
  studio.stop()
  laptop.stop()
})

test("a workspace shown from another computer is one clique; the same id on both computers is two workspaces, each its own computer's", async () => {
  await studio.run(`clique.workspaceAction('switch', 'storefront')`)
  assert.deepEqual(await names(studio), ['ann@laptop', 'iris', 'ivo', 'milo@laptop'])
  assert.deepEqual(await studio.run(`clique.snapshot().computers.links[0].spaces`), ['storefront'], 'only the joined one: the laptop keeps its site and lab to itself')
  await studio.run(`clique.workspaceAction('switch', 'site')`)
  assert.deepEqual(await names(studio), ['bob'], "the laptop's site is another workspace: none of its agents here")
  // each lists what the other owns, to join
  const theirs = async (c) => (await c.run(`clique.snapshot().remoteWorkspaces.map((w) => w.key + (w.joined ? '=' + w.joined : '') + (w.online ? '' : ' off'))`)).sort()
  assert.deepEqual(await theirs(laptop), ['studio-mac:default', 'studio-mac:site', 'studio-mac:storefront=storefront'])
  assert.deepEqual(await theirs(studio), ['laptop:default', 'laptop:lab', 'laptop:site'], "the laptop's storefront is the studio's own")
  const shop = await laptop.run(`clique.workspaces().find((w) => w.id === 'storefront')`)
  assert.deepEqual([shop.owner, shop.ownerName, shop.ownerOnline], ['studio-mac', 'Studio Mac', true])
  assert.equal(await studio.run(`clique.workspaces().find((w) => w.id === 'storefront').owner`), undefined, 'its own')
  await studio.run(`clique.workspaceAction('switch', 'default')`)
  assert.deepEqual(await names(studio), ['bob', 'iris'], 'the one an older CLIque left is a workspace like any other: this computer\'s own')
  await laptop.run(`clique.workspaceAction('switch', 'lab')`)
  assert.deepEqual(await names(laptop), ['ann'])
  await laptop.run(`clique.workspaceAction('switch', 'default')`)
})

test('edits and messages in a workspace reach its agents on the other computer, in that workspace there', async () => {
  await studio.run(`clique.workspaceAction('switch', 'storefront')`)
  await studio.run(`clique.update('milo@laptop', { area: 'docs and guides' })`)
  await sleep(200)
  assert.equal(wsOf(laptop, 'storefront').agents[0].area, 'docs and guides', "the laptop's storefront's own milo")
  // on in config.json (so no reload turns it back off), with launching stubbed: no CLI, and the message queues
  const on = (name) => `(clique.hubs.get('storefront').launch = () => {}, clique.hubs.get('storefront').update(${JSON.stringify(name)}, { off: false }), 1)`
  await laptop.run(on('milo'))
  await studio.run(`clique.send('milo@laptop', 'write the readme')`)
  await sleep(200)
  assert.equal(await laptop.run(`clique.hubs.get('storefront').feed.some((e) => e.kind === 'msg' && e.text === 'write the readme')`), true)
  assert.equal(await laptop.run(`clique.hubs.get('default').feed.some((e) => e.text === 'write the readme')`), false, 'not in its default')
  // an agent there writes back to one here, in storefront
  await studio.run(on('ivo'))
  assert.match(await laptop.run(`clique.hubs.get('storefront').send({ from: 'milo', to: 'ivo@studio-mac', text: 'check the release notes' })`), /ivo/)
  await sleep(200)
  const there = await studio.run(`clique.hubs.get('storefront').feed.filter((e) => e.kind === 'msg').map((e) => e.from + '>' + e.to + ':' + e.text)`)
  assert.ok(there.includes('milo@laptop>ivo:check the release notes'), there)
  assert.match(await studio.run(`clique.snapshot().feed.map((e) => e.text).join('|')`), /write the readme/, "studio's storefront chat has the laptop's storefront lines too")
})

test("alerts from a workspace on the other computer say which; one this computer hasn't got stays there", async () => {
  await studio.run(`(globalThis.alerts = [], clique.on('alert', (n, t, ws) => alerts.push([n, ws])), 1)`)
  await laptop.run(`(clique.hubs.get('storefront').emit('alert', { name: 'milo' }, 'needs you'), clique.hubs.get('lab').emit('alert', { name: 'ann' }, 'needs you'), 1)`)
  await sleep(200)
  assert.deepEqual(await studio.run(`alerts`), [['milo@laptop', 'storefront']])
})

test('moving an agent in a workspace takes it to that workspace on the other computer', async () => {
  await studio.run(`clique.workspaceAction('switch', 'storefront')`)
  await studio.run(`(clique.hubs.get('storefront').update('ivo', { off: true }), 1)`) // off, so it arrives off: no CLI there
  // one of storefront's own agents: storefront's own there
  assert.equal((await studio.run(`clique.moveAgent('ivo', 'laptop', '~')`)).name, 'ivo@laptop')
  await sleep(200)
  assert.deepEqual(wsOf(laptop, 'storefront').agents.map((a) => a.name), ['milo', 'ivo'])
  assert.equal(wsOf(studio, 'storefront').agents?.some((a) => a.name === 'ivo') ?? false, false)
  // one of your shared agents: it joins the laptop's clique and its storefront, and leaves only storefront here
  assert.equal((await studio.run(`clique.moveAgent('iris', 'laptop', '~')`)).name, 'iris@laptop')
  await sleep(200)
  assert.ok(laptop.config().agents.some((a) => a.name === 'iris'))
  assert.ok('iris' in wsOf(laptop, 'storefront').members)
  assert.ok(studio.config().agents.some((a) => a.name === 'iris'), 'still in the studio\'s clique')
  assert.equal('iris' in wsOf(studio, 'storefront').members, false)
  // a computer without the workspace
  await studio.run(`clique.workspaceAction('switch', 'site')`)
  await assert.rejects(studio.run(`clique.moveAgent('bob', 'laptop', '~')`), /Laptop has no site workspace/)
})

test('a shared agent moved there and back rejoins its clique here, not as a copy', async () => {
  await studio.run(`clique.workspaceAction('switch', 'storefront')`)
  assert.equal((await studio.run(`clique.moveAgent('iris@laptop', '', '~')`)).name, 'iris')
  await sleep(200)
  assert.deepEqual(studio.config().agents.map((a) => a.name).sort(), ['bob', 'iris'], 'no iris-2')
  assert.ok('iris' in wsOf(studio, 'storefront').members)
  assert.equal('iris' in wsOf(laptop, 'storefront').members, false, "it left the laptop's storefront")
})

test("the owner's new name and look reach the computers it shows up on", async () => {
  const shown = (key) => `clique.config.data.workspaces.find((w) => w.of && w.of.computer + ':' + w.of.id === ${JSON.stringify(key)})`
  await studio.run(`clique.workspaceAction('edit', 'storefront', { name: 'Shopfront', color: 'orange', icon: '🛒' })`)
  await until(laptop, `${shown('studio-mac:storefront')}.name === 'Shopfront'`)
  const copy = await laptop.run(shown('studio-mac:storefront'))
  assert.deepEqual([copy.name, copy.color, copy.icon], ['Shopfront', 'orange', '🛒'])
  assert.ok('ann' in copy.members, 'and who you put there stays')
  await studio.run(`clique.workspaceAction('edit', 'storefront', { name: 'Storefront', color: '', icon: '' })`)
  await until(laptop, `${shown('studio-mac:storefront')}.name === 'Storefront'`)
  assert.equal((await laptop.run(shown('studio-mac:storefront'))).color, undefined)
})

test("a workspace made on one computer shows up on the other on its own, as its; the same name there stays two; gone there, gone here", async () => {
  const of = (key) => `clique.config.data.workspaces.find((w) => w.of && w.of.computer + ':' + w.of.id === ${JSON.stringify(key)})?.id ?? null`
  await laptop.run(`clique.workspaceAction('create', null, { name: 'Side', color: 'teal' })`)
  await laptop.run(`clique.workspaceAction('switch', 'default')`)
  await until(studio, `Boolean(${of('laptop:side')})`)
  assert.equal(await studio.run(of('laptop:side')), 'side')
  const side = await studio.run(`clique.workspaces().find((w) => w.id === 'side')`)
  assert.deepEqual([side.owner, side.ownerName, side.ownerOnline, side.color], ['laptop', 'Laptop', true, 'teal'])
  assert.notEqual(await studio.run(`clique.current`), 'side', 'it shows up without taking the screen')
  assert.deepEqual(studio.config().workspaces.find((w) => w.id === 'side').members, {}, "none of the studio's agents in it: nothing starts there")
  // the studio makes a Side of its own: a second Side, the studio's, and it shows up on the laptop as the studio's
  const { id: mine } = await studio.run(`clique.workspaceAction('create', null, { name: 'Side' })`)
  assert.equal(mine, 'side-2', "the laptop's Side has the id here")
  await until(laptop, `Boolean(${of(`studio-mac:${mine}`)})`)
  assert.equal(await laptop.run(`clique.workspaces().find((w) => w.id === ${of(`studio-mac:${mine}`)}).ownerName`), 'Studio Mac')
  assert.equal(await laptop.run(`clique.workspaces().find((w) => w.id === 'side').owner`), undefined, "the laptop's own Side is its own")
  // the laptop removes its Side: it goes from the studio too (nobody of the studio's worked in it)
  await laptop.run(`clique.workspaceAction('remove', 'side')`)
  await until(studio, `!(${of('laptop:side')})`)
  await studio.run(`clique.workspaceAction('remove', ${JSON.stringify(mine)})`)
  await until(laptop, `!(${of(`studio-mac:${mine}`)})`)
  await studio.run(`clique.workspaceAction('switch', 'default')`)
})

// Usage across linked computers: each computer reads its own Claude Code and Codex logs, and the Usage view on one shows
// the other's beside its own. A workspace hosted on the studio, shown on the laptop, has one key on both, so what the
// studio's agents used there and what the laptop's did add up in it; what each ran outside CLIque stays its own. What a
// computer last said is kept for when it's off, and one on an older CLIque says so instead.
// Two real Cliques, each in its own process with a throwaway CLIQUE_HOME and throwaway CLI folders, linked over 127.0.0.1
// only. No CLI is launched. Run with `npm test`.
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
const DAY = '2026-11-10'
const at = new Date(`${DAY}T12:00:00`).toISOString()
const lines = (...rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join('')
const reply = (id, input) => ({ type: 'assistant', timestamp: at, requestId: `r${id}`, message: { id: `m${id}`, model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: 0 } } })
const prompt = () => ({ type: 'user', timestamp: at, message: { role: 'user', content: 'go' } })
const named = (name) => ({ type: 'agent-name', agentName: name })

// logs: { 'session-id': [lines] } in its Claude Code folder. ran: { workspace: { session: name } }, written down as if its agents had run them.
function computer(name, linkPort, config, { logs = {}, ran = {}, link = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-usage-link-'))
  const home = path.join(root, 'clique')
  fs.mkdirSync(path.join(home, 'link'), { recursive: true })
  fs.writeFileSync(path.join(home, 'link', 'link.json'), JSON.stringify({ name, port: linkPort, ...link }))
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ layout: 2, ...config }))
  for (const [ws, sessions] of Object.entries(ran)) {
    fs.mkdirSync(path.join(home, 'workspaces', ws), { recursive: true })
    fs.writeFileSync(path.join(home, 'workspaces', ws, 'ran.json'), JSON.stringify(sessions))
  }
  fs.mkdirSync(path.join(root, 'claude', 'projects', 'p'), { recursive: true })
  for (const [id, rows] of Object.entries(logs)) fs.writeFileSync(path.join(root, 'claude', 'projects', 'p', `${id}.jsonl`), lines(...rows))
  const env = { ...process.env, CLIQUE_HOME: home, NAME: name, CLAUDE_CONFIG_DIR: path.join(root, 'claude'), CODEX_HOME: path.join(root, 'codex'), PATH: '/usr/bin:/bin' }
  const p = spawn(process.execPath, [fileURLToPath(new URL('./helpers/computer.mjs', import.meta.url))], { env, stdio: ['pipe', 'pipe', 'inherit'] })
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
  return { up, run, home, stop: () => (p.kill(), fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 })) }
}

const off = { off: true }
// Storefront is the studio's, shown on the laptop, where ann works in it too; Site is the laptop's own (hidden on the studio)
const studio = computer('Studio Mac', port, {
  agents: [{ name: 'iris', area: 'design', ...off }],
  workspaces: [{ id: 'storefront', name: 'Storefront', color: 'teal', members: { iris: off }, agents: [{ name: 'ivo', area: 'release', avatar: { color: 'lime' }, ...off }] }],
}, {
  logs: { 's-ivo': [named('ivo'), prompt(), reply(1, 500)], 's-studio-own': [prompt(), reply(2, 70)] },
  ran: { storefront: { 's-ivo': 'ivo' } },
  link: { hiddenWorkspaces: ['laptop:site'] },
})
const laptop = computer('Laptop', port + 1, {
  agents: [{ name: 'ann', area: 'docs', ...off }],
  workspaces: [
    { id: 'storefront', name: 'Storefront', of: { computer: 'studio-mac', id: 'storefront' }, members: { ann: off } },
    { id: 'site', name: 'Site', members: { ann: off } },
  ],
}, {
  logs: { 's-ann': [named('ann'), prompt(), reply(3, 30)], 's-ann-site': [named('ann'), prompt(), reply(4, 8)], 's-laptop-own': [prompt(), reply(5, 2)] },
  ran: { storefront: { 's-ann': 'ann' }, site: { 's-ann-site': 'ann' } },
})

const until = async (c, code, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await c.run(code)) return
  throw new Error(`timed out: ${code}`)
}
// a computer's rows as the view gets them: [workspace, agent, tokens], sorted
const ROWS = `(c) => c.rows.map((r) => [r[c.cols.indexOf('ws')], r[c.cols.indexOf('who')], r[c.cols.indexOf('tokens')]]).sort((x, y) => y[2] - x[2])`
const view = (c) => c.run(`(() => { const u = clique.usageHistory(); const rows = ${ROWS}; return { here: u.here, spaces: u.spaces, computers: u.computers.map((x) => ({ slug: x.slug, name: x.name, here: Boolean(x.here), online: x.online, got: x.got > 0, note: x.note ?? null, rows: rows(x), faces: x.faces })) } })()`)
// asked again right away, rather than a few minutes after the last answer
const askAgain = (c, slug) => c.run(`(clique.usageOf.get(${JSON.stringify(slug)}).asked = 0, clique.usageHistory(), true)`)

before(async () => {
  await Promise.all([studio.up, laptop.up])
  await studio.run(`clique.share(true)`)
  const code = await studio.run(`clique.snapshot().computers.me.code`)
  const c = JSON.parse(Buffer.from(code.slice('clique1.'.length), 'base64url'))
  const local = 'clique1.' + Buffer.from(JSON.stringify({ ...c, h: ['127.0.0.1'] })).toString('base64url')
  assert.equal(await laptop.run(`clique.connect(${JSON.stringify(local)})`), 'studio-mac')
  await until(studio, `Boolean(clique.links.get('laptop')?.spaces?.storefront)`)
  await until(laptop, `Boolean(clique.links.get('studio-mac')?.spaces?.storefront)`)
  // each reads its own logs
  for (const c of [studio, laptop]) await until(c, `(clique.usageSummary(), clique.history.index.at > 0 && !clique.history.running)`)
})
after(() => {
  studio.stop()
  laptop.stop()
})

test("on the laptop: the studio's usage beside its own, and the workspace they share under one key", async () => {
  await laptop.run(`clique.usageHistory()`) // the first ask sends for the studio's
  await until(laptop, `clique.usageHistory().computers[1]?.rows.length > 0`)
  const u = await view(laptop)
  assert.deepEqual(u.computers.map((c) => [c.slug, c.name, c.here, c.online, c.note]), [['laptop', 'Laptop', true, true, null], ['studio-mac', 'Studio Mac', false, true, null]])
  // the laptop's own: ann in the studio's Storefront (its key is the studio's), ann in the laptop's Site, and a session of yours
  assert.deepEqual(u.computers[0].rows, [['studio-mac:storefront', 'ann', 30], ['laptop:site', 'ann', 8], ['', '', 2]])
  // the studio's: its agent in Storefront, and what was run there outside CLIque
  assert.deepEqual(u.computers[1].rows, [['studio-mac:storefront', 'ivo', 500], ['', '', 70]])
  assert.deepEqual(u.computers[1].faces, { 'studio-mac:storefront': { ivo: { color: 'lime' } } })
  // the workspaces: the shared one as it is here (hosted on the studio), the laptop's own
  assert.deepEqual(u.spaces['studio-mac:storefront'], { name: 'Storefront', color: 'teal', icon: null, id: 'storefront', ownerName: 'Studio Mac' })
  assert.deepEqual(u.spaces['laptop:site'], { name: 'Site', color: null, icon: null, id: 'site' })
  assert.equal(u.here, 'studio-mac:storefront')
  assert.ok(u.computers[1].got)
})

test("on the studio: what the laptop's agents used in the studio's workspace shows there too; the laptop's own workspace by its name", async () => {
  await studio.run(`clique.usageHistory()`)
  await until(studio, `clique.usageHistory().computers[1]?.rows.length > 0`)
  const u = await view(studio)
  assert.deepEqual(u.computers.map((c) => [c.slug, c.here, c.online]), [['studio-mac', true, true], ['laptop', false, true]])
  assert.deepEqual(u.computers[1].rows, [['studio-mac:storefront', 'ann', 30], ['laptop:site', 'ann', 8], ['', '', 2]])
  assert.deepEqual(u.spaces['studio-mac:storefront'], { name: 'Storefront', color: 'teal', icon: null, id: 'storefront' })
  // a workspace that isn't shown here: named as its computer names it, and said to be that computer's
  assert.deepEqual(u.spaces['laptop:site'], { name: 'Site', color: null, icon: null, ownerName: 'Laptop' })
})

test('new usage on the studio reaches the laptop the next time it asks', async () => {
  const dir = await studio.run(`process.env.CLAUDE_CONFIG_DIR`)
  fs.writeFileSync(path.join(dir, 'projects', 'p', 's-ivo-2.jsonl'), lines(named('ivo'), prompt(), reply(9, 1000)))
  await studio.run(`(clique.hubs.get('storefront').noteSession('ivo', 's-ivo-2'), clique.history.refresh().then(() => true))`)
  await askAgain(laptop, 'studio-mac')
  // (the same day, workspace, agent and model as its first session: one row, both added up)
  await until(laptop, `clique.usageHistory().computers[1].rows.some((r) => r[6] === 1500)`)
  assert.deepEqual((await view(laptop)).computers[1].rows, [['studio-mac:storefront', 'ivo', 1500], ['', '', 70]])
})

test("a computer on an older CLIque can't say: its note says to update it, and what it said before stays", async () => {
  await studio.run(`(clique.realServe = clique.serve, clique.serve = function (fn, ...rest) { if (fn === 'usageHistory') throw new Error('"usageHistory" isn\\'t available over CLIque Link'); return this.realServe(fn, ...rest) }, true)`)
  await askAgain(laptop, 'studio-mac')
  await until(laptop, `Boolean(clique.usageHistory().computers[1].note)`)
  const u = await view(laptop)
  assert.equal(u.computers[1].note, 'Studio Mac runs an older CLIque: update it to see what it used')
  assert.deepEqual(u.computers[1].rows[0], ['studio-mac:storefront', 'ivo', 1500], 'its last answer is still shown')
  await studio.run(`(clique.serve = clique.realServe, true)`)
  await askAgain(laptop, 'studio-mac')
  await until(laptop, `!clique.usageHistory().computers[1].note`)
})

test("a link that drops while it's asked isn't a computer that couldn't say: no notice, and it's asked again once it's back", async () => {
  // the laptop's ask goes out as the connection goes: as if the studio went off mid-ask
  await laptop.run(`(() => { const l = clique.links.get('studio-mac'); const peer = l.peer; const real = peer.call.bind(peer); globalThis.back = () => { l.peer = peer; peer.call = real }; peer.call = (fn, ...a) => (fn === 'usageHistory' ? (l.peer = null, Promise.reject(new Error('the link closed'))) : real(fn, ...a)); clique.usageOf.get('studio-mac').asked = 0; clique.usageHistory(); return true })()`)
  await sleep(150)
  let u = await view(laptop)
  assert.deepEqual([u.computers[1].online, u.computers[1].note, u.computers[1].rows.length], [false, null, 2], 'offline, with what it last said and nothing about "couldn\'t say"')
  await studio.run(`(clique.hubs.get('storefront').noteSession('ivo', 's-ivo-3'), true)`)
  const dir = await studio.run(`process.env.CLAUDE_CONFIG_DIR`)
  fs.writeFileSync(path.join(dir, 'projects', 'p', 's-ivo-3.jsonl'), lines(named('ivo'), prompt(), reply(11, 25)))
  await studio.run(`clique.history.refresh().then(() => true)`)
  await laptop.run(`(globalThis.back(), clique.usageHistory(), true)`) // back: asked right away, not minutes later
  await until(laptop, `clique.usageHistory().computers[1].rows.some((r) => r[6] === 1525)`)
})

test("a computer that isn't linked any more isn't listed beside the ones that are; what one said over a month ago goes", async () => {
  // as a rename leaves it: the studio's answer kept under the name it had before
  const kept = JSON.parse(fs.readFileSync(path.join(laptop.home, 'link', 'usage', 'studio-mac.json'), 'utf8'))
  fs.writeFileSync(path.join(laptop.home, 'link', 'usage', 'old-studio.json'), JSON.stringify({ ...kept, name: 'Old Studio' }))
  fs.writeFileSync(path.join(laptop.home, 'link', 'usage', 'long-gone.json'), JSON.stringify({ ...kept, name: 'Long Gone', got: Date.now() - 40 * 864e5 }))
  await laptop.run(`(clique.usageOf = null, true)`)
  const u = await view(laptop)
  assert.deepEqual(u.computers.map((c) => c.slug), ['laptop', 'studio-mac'], 'the same usage isn\'t there twice under an old name')
  assert.equal(fs.existsSync(path.join(laptop.home, 'link', 'usage', 'long-gone.json')), false)
  fs.rmSync(path.join(laptop.home, 'link', 'usage', 'old-studio.json'))
})

test("a linked computer's answer is taken only as far as it has the shape it should: no markup through a look or a colour", async () => {
  await studio.run(`(clique.realSummary = clique.usageSummary, clique.usageSummary = function () { const s = this.realSummary(); return { ...s, first: { toString: 1 }, faces: { 'studio-mac:storefront': { ivo: { color: '"><svg onload=alert(1)>', body: 'blob', cheeks: true, extra: { a: 1 } } } }, spaces: { ...s.spaces, 'studio-mac:storefront': { ...s.spaces['studio-mac:storefront'], color: 'red;background:url(x)', icon: '🛒🛒🛒🛒🛒🛒' } } } }, true)`)
  await askAgain(laptop, 'studio-mac')
  await until(laptop, `clique.usageHistory().computers[1].faces['studio-mac:storefront']?.ivo?.body === 'blob'`)
  const said = await laptop.run(`(() => { const u = clique.usageHistory(); return { face: u.computers[1].faces['studio-mac:storefront'].ivo, first: u.computers[1].first, kept: JSON.parse(require('node:fs').readFileSync(require('node:path').join(process.env.CLIQUE_HOME, 'link', 'usage', 'studio-mac.json'), 'utf8')).data.faces['studio-mac:storefront'].ivo } })()`).catch(() => null)
  const face = said?.face ?? (await laptop.run(`clique.usageHistory().computers[1].faces['studio-mac:storefront'].ivo`))
  assert.deepEqual(face, { body: 'blob', cheeks: true }, 'the colour that was markup is dropped, and what isn\'t a word or a switch')
  assert.equal(await laptop.run(`clique.usageHistory().computers[1].first`), null)
  await studio.run(`(clique.usageSummary = clique.realSummary, true)`)
  await askAgain(laptop, 'studio-mac')
  await until(laptop, `clique.usageHistory().computers[1].faces['studio-mac:storefront']?.ivo?.color === 'lime'`)
})

test("a computer that's off still shows what it last said, also after CLIque starts again; forgetting it forgets that", async () => {
  const kept = path.join(laptop.home, 'link', 'usage', 'studio-mac.json')
  assert.ok(fs.existsSync(kept), 'kept on disk')
  await studio.run(`(clique.share(false), true)`)
  await until(laptop, `!clique.links.get('studio-mac')?.peer`)
  let u = await view(laptop)
  assert.deepEqual([u.computers[1].slug, u.computers[1].online, u.computers[1].rows.length], ['studio-mac', false, 2])
  // as a CLIque that just started has it: read from what was kept
  await laptop.run(`(clique.usageOf = null, true)`)
  u = await view(laptop)
  assert.deepEqual([u.computers[1].name, u.computers[1].online, u.computers[1].rows[0]], ['Studio Mac', false, ['studio-mac:storefront', 'ivo', 1525]])
  assert.deepEqual(u.spaces['studio-mac:storefront'].name, 'Storefront')
  await laptop.run(`(clique.forget('studio-mac'), true)`)
  assert.equal(fs.existsSync(kept), false)
  assert.deepEqual((await view(laptop)).computers.map((c) => c.slug), ['laptop'])
})

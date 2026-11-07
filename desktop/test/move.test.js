// Moving an agent to another computer with its conversation (core/move.js). Where each CLI keeps a conversation,
// and three computers linked over Crew Link, each a real Crew in its own process with its own CREW_HOME,
// CLAUDE_CONFIG_DIR and CODEX_HOME. The agents' CLIs are stand-ins (a script that writes down how it was started
// and what was typed into it), and their hooks are played by the test. Run with `npm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const made = [] // every folder this makes, removed at the end
const tmp = (name) => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `crew-move-${name}-`)))
  made.push(dir)
  return dir
}
process.env.CREW_HOME = tmp('unit')
const { claudeSlug, claudeProject, sessionOf, requalify, safeRel, repoint, homeTwin } = await import('../core/move.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Waits (up to 5 s) for what a stand-in CLI writes down, or for a computer to catch up.
const until = async (fn) => {
  for (let i = 0; i < 100 && !(await fn()); i++) await sleep(50)
  return fn()
}
// What a stand-in CLI wrote down about how it was started, once the line is whole (a long one is written in pieces).
const launched = (c, name) => until(() => (c.read(`cli-${name}.log`).endsWith('\n') ? c.read(`cli-${name}.log`) : ''))
const write = (file, text) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, text))

// ---- where a conversation lives ------------------------------------------------------------------------

test("Claude Code's project folder: every character but letters and digits becomes a dash", () => {
  assert.equal(claudeSlug('/Users/ann/Projects/storefront'), '-Users-ann-Projects-storefront')
  assert.equal(claudeSlug('/private/tmp/b_dir.v2'), '-private-tmp-b-dir-v2')
  const long = `/Users/me/${'deep/'.repeat(50)}app`
  const slug = claudeSlug(long)
  assert.equal(slug.slice(0, 200), long.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200))
  assert.match(slug.slice(200), /^-[0-9a-z]+$/, 'cut at 200 with a hash of the whole path')
  assert.notEqual(claudeSlug(long + 'x'), claudeSlug(long.slice(0, -1) + 'y'))
})

test('a Claude conversation: the transcript its hooks named, else the folder it works in, else wherever it is', () => {
  const config = tmp('claude')
  const env = { CLAUDE_CONFIG_DIR: config }
  const cwd = tmp('cwd')
  const id = '11111111-2222-3333-4444-555555555555'
  const project = path.join(config, 'projects', claudeSlug(cwd))
  assert.equal(claudeProject(cwd, env), project)
  write(path.join(project, `${id}.jsonl`), '{}\n')
  write(path.join(project, id, 'subagents', 'agent-1.jsonl'), '{}\n')
  write(path.join(project, id, 'tool-results', 'big.txt'), 'x')
  const s = sessionOf('claude', id, { cwd, env })
  assert.equal(s.root, project)
  assert.deepEqual(s.files.map((f) => f.rel).sort(), [`${id}.jsonl`, `${id}/subagents/agent-1.jsonl`, `${id}/tool-results/big.txt`])
  // started in another folder: still found
  const elsewhere = path.join(config, 'projects', '-somewhere-else')
  fs.renameSync(project, elsewhere)
  assert.equal(sessionOf('claude', id, { cwd, env }).root, elsewhere)
  // what the hooks reported wins
  const reported = path.join(tmp('reported'), `${id}.jsonl`)
  write(reported, '{}\n')
  assert.equal(sessionOf('claude', id, { cwd, env, transcript: { id, path: reported } }).files[0].path, reported)
  assert.match(sessionOf('claude', 'nope', { cwd, env }).reason, /wasn't found/)
  assert.match(sessionOf('claude', undefined, { cwd, env }).reason, /hadn't started/)
})

test('a Codex conversation: its rollout file, named by its place under sessions/', () => {
  const home = tmp('codex')
  const id = '01a11823-82bf-7e20-b5e4-91dbe18be2be'
  const file = path.join(home, 'sessions', '2026', '10', '07', `rollout-2026-10-07T17-52-23-${id}.jsonl`)
  write(file, '{}\n')
  const s = sessionOf('codex', id, { env: { CODEX_HOME: home } })
  assert.equal(s.root, path.join(home, 'sessions'))
  assert.deepEqual(s.files, [{ rel: `2026/10/07/rollout-2026-10-07T17-52-23-${id}.jsonl`, path: file }])
})

test('names and task numbers, as the computer an agent moves to writes them', () => {
  const names = requalify({ from: 'studio', to: 'laptop', old: 'iris', name: 'iris-2' })
  assert.deepEqual(['iris', 'bob', 'ann@laptop', 'zoe@workstation', 'you', 'crew'].map(names), ['iris-2', 'bob@studio', 'ann', 'zoe@workstation', 'you', 'crew'])
  const tasks = requalify({ from: 'studio', to: 'laptop', numbers: true })
  assert.deepEqual([12, '12', '7@laptop', '3@workstation'].map(tasks), ['12@studio', '12@studio', 7, '3@workstation'])
  const lines = requalify({ from: 'studio', to: 'laptop' })
  assert.deepEqual(['a1b2c3d4', '12345678@laptop'].map(lines), ['a1b2c3d4@studio', '12345678'], 'ids stay strings')
})

// ---- between a Mac and Windows -----------------------------------------------------------------------------

test("a conversation's files, sent from a Mac or Windows, land inside its folder on either", () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  for (const rel of [`${id}/tool-results/out.txt`, `${id}\\tool-results\\out.txt`, `./${id}//tool-results/out.txt`]) {
    assert.equal(safeRel(rel, path.posix.join), `${id}/tool-results/out.txt`, rel)
    assert.equal(safeRel(rel, path.win32.join), `${id}\\tool-results\\out.txt`, rel)
  }
  assert.equal(safeRel('2026/10/07/rollout-2026-10-07T17-52-23-x.jsonl', path.win32.join), '2026\\10\\07\\rollout-2026-10-07T17-52-23-x.jsonl')
  for (const bad of ['../x', '..\\x', 'a/../../x', 'a\\..\\..\\x', '/etc/passwd', '\\Windows\\x', 'C:\\x', 'C:x', '\\\\nas\\share\\x', 'a/b:stream', '', '.', 'a\0b']) {
    assert.throws(() => safeRel(bad, path.posix.join), /not a conversation file/, JSON.stringify(bad))
    assert.throws(() => safeRel(bad, path.win32.join), /not a conversation file/, JSON.stringify(bad))
  }
})

test("Claude Code's long tool outputs point at the new project folder, with that computer's separators", () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const mac = { root: '/Users/me/.claude/projects/-Users-me-code-app', id, sep: '/' }
  const win = { root: 'C:\\Users\\me\\.claude\\projects\\C--Users-me-code-app', id, sep: '\\' }
  const line = (saved, more = '') => JSON.stringify({ type: 'user', text: `saved to ${saved}${more}`, saved }) + '\n'
  const at = (w, ...rest) => [w.root, id, ...rest].join(w.sep)
  // Mac to Windows
  const there = repoint(line(at(mac, 'tool-results', 'toolu_01.txt'), '\nand more') + line(at(mac, 'subagents', 'agent-a1b2.jsonl')), mac, win.root, '\\')
  assert.deepEqual(there.trim().split('\n').map((l) => JSON.parse(l).saved), [at(win, 'tool-results', 'toolu_01.txt'), at(win, 'subagents', 'agent-a1b2.jsonl')])
  assert.equal(JSON.parse(there.split('\n')[0]).text, `saved to ${at(win, 'tool-results', 'toolu_01.txt')}\nand more`, 'what follows a path stays')
  // Windows to a Mac, with \r\n line endings, which stay
  const back = repoint(line(at(win, 'tool-results', 'toolu_02.txt')).replace('\n', '\r\n'), win, mac.root, '/')
  assert.equal(JSON.parse(back).saved, at(mac, 'tool-results', 'toolu_02.txt'))
  assert.ok(back.endsWith('\r\n'))
  // between two Macs, as before; and nothing to change, nothing changed
  assert.equal(JSON.parse(repoint(line(at(mac, 'tool-results', 'x.txt')), mac, '/Users/you/.claude/projects/-Users-you-app', '/')).saved, `/Users/you/.claude/projects/-Users-you-app/${id}/tool-results/x.txt`)
  assert.equal(repoint('{"a":1}\n', win, mac.root, '/'), '{"a":1}\n')
})

test("a folder in the other computer's home is the same place in this one's", () => {
  const mac = (dir) => homeTwin(dir, '/Users/me', path.posix.join)
  const win = (dir) => homeTwin(dir, 'C:\\Users\\Me', path.win32.join)
  for (const dir of ['C:\\Users\\ann\\code\\app', 'c:/users/ann/code/app', '/Users/ann/code/app', '/home/ann/code/app', '~/code/app', '~\\code\\app', '/Users/ann//code/app/']) {
    assert.equal(mac(dir), '/Users/me/code/app', dir)
    assert.equal(win(dir), 'C:\\Users\\Me\\code\\app', dir)
  }
  assert.equal(mac('C:\\Users\\ann'), '/Users/me')
  assert.equal(win('~'), 'C:\\Users\\Me')
  for (const dir of ['/opt/app', 'D:\\work\\app', '/Users/Shared/app', 'C:\\Users\\Public\\app', 'code/app', '', '\\\\nas\\ann\\app']) assert.equal(mac(dir), null, dir)
})

// ---- three computers ------------------------------------------------------------------------------------

// The stand-in CLI: writes down its arguments and everything typed into it. A shell script, and on Windows, which
// has no sh, the same in Node behind a .cmd.
const bin = tmp('bin')
const fake = `#!/bin/sh
printf 'launch %s\\n' "$*" >> "$CREW_HOME/cli-$CREW_AGENT.log"
stty raw -echo 2>/dev/null
exec cat >> "$CREW_HOME/typed-$CREW_AGENT.log"
`
const fakeJs = path.join(bin, 'cli.mjs')
fs.writeFileSync(fakeJs, `import fs from 'node:fs'
import path from 'node:path'
const log = (what) => path.join(process.env.CREW_HOME, what + '-' + process.env.CREW_AGENT + '.log')
process.stdin.setRawMode?.(true) // as typed, and not echoed
fs.appendFileSync(log('cli'), 'launch ' + process.argv.slice(2).join(' ') + '\\n')
process.stdin.on('data', (d) => fs.appendFileSync(log('typed'), d))
`)
for (const cli of ['claude', 'codex']) {
  fs.writeFileSync(path.join(bin, cli), fake, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, `${cli}.cmd`), `@"${process.execPath}" "${fakeJs}" %*\r\n`)
}
const COMPUTER = fileURLToPath(new URL('./helpers/computer.mjs', import.meta.url))

const port = 20000 + Math.floor(Math.random() * 20000)
// you: the home folder of whoever uses it, when it isn't this one's
// joins: this computer has the Studio's workspace too (as a linked computer does once it's shown up), with its agents in it
function computer(name, linkPort, agents, { you, joins } = {}) {
  const home = tmp('home')
  const claude = tmp('claude')
  const codex = tmp('codex')
  fs.mkdirSync(path.join(home, 'link'))
  fs.writeFileSync(path.join(home, 'link', 'link.json'), JSON.stringify({ name, port: linkPort }))
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(joins
    ? { layout: 2, agents: agents.map(({ off, ...a }) => a), workspaces: [{ id: 'shop', name: 'Home', of: { computer: 'studio-mac', id: 'default' }, members: Object.fromEntries(agents.map((a) => [a.name, { ...(a.cwd && { folder: a.cwd }), off: a.off ?? true }])) }] }
    : { agents: agents.map((a) => ({ off: true, ...a })) }))
  // the stand-in CLIs first on PATH, under the name the environment gives it (Windows: Path), or it would hold both
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const env = { ...process.env, CREW_HOME: home, NAME: name, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, [key]: `${bin}${path.delimiter}${process.env[key]}`, ...(you && { HOME: you, USERPROFILE: you }) }
  const p = spawn(process.execPath, [COMPUTER], { env, stdio: ['pipe', 'pipe', 'inherit'] })
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
  const read = (file) => {
    try {
      return fs.readFileSync(path.join(home, file), 'utf8')
    } catch {
      return ''
    }
  }
  return { up, run, read, home, claude, codex, stop: () => p.kill() }
}

const work = { studio: tmp('work-studio'), laptop: tmp('work-laptop'), workstation: tmp('work-workstation') } // each computer's checkout
const studio = computer('Studio Mac', port, [
  { name: 'iris', area: 'design', cwd: work.studio, off: false },
  { name: 'bob', area: 'backend', cwd: work.studio, off: false },
  { name: 'milo', area: 'docs', cwd: work.studio },
  { name: 'zoe', area: 'ops', cwd: work.studio },
])
const laptop = computer('Laptop', port + 1, [
  { name: 'dev', area: 'mobile', provider: 'codex', cwd: work.laptop, off: false },
  { name: 'ann', area: 'docs writing' },
], { joins: true })
const miniHome = tmp('you') // Workstation's user, ann, has her own home folder, with code/app in it
fs.mkdirSync(path.join(miniHome, 'code', 'app'), { recursive: true })
const workstation = computer('Workstation', port + 2, [], { you: miniHome, joins: true })

// The CLI has started (its SessionStart hook), its terminal has gone quiet and it is free: messages go in right away.
// (agents rest until there's work: one that's resting is started first, and has drawn its first screen)
const ready = async (c, name) => {
  if ((await c.run(`crew.here.agents.get(${JSON.stringify(name)}).status`)) === 'resting') {
    await c.run(`(crew.here.restart(${JSON.stringify(name)}), 1)`)
    await launched(c, name)
    await sleep(200)
  }
  return c.run(`((a, proc) => (crew.here.onHook(${JSON.stringify(name)}, { hook_event_name: 'SessionStart', source: 'startup' }), a.holdUntil = 0, proc && (proc.lastOutput = 0), crew.here.pump(a), a.status))(crew.here.agents.get(${JSON.stringify(name)}), crew.runner.procs.get(${JSON.stringify(name)}))`)
}
const feedOf = (c) => c.run(`crew.here.feed`)

before(async () => {
  await Promise.all([studio.up, laptop.up, workstation.up])
  for (const c of [studio, workstation]) await c.run(`crew.share(true)`)
  for (const c of [studio, workstation]) await laptop.run(`crew.connect(${JSON.stringify(await c.run(`crew.snapshot().computers.me.code`))})`)
  // each has told the laptop how the workspace they share is doing there
  for (let i = 0; i < 100 && !(await laptop.run(`['studio-mac', 'workstation'].every((c) => crew.links.get(c)?.spaces?.shop)`)); i++) await sleep(100)
})
after(() => {
  for (const c of [studio, laptop, workstation]) c.stop()
  for (const d of made) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10 })
})

test('a working agent moves here from a linked computer: its conversation, queue, chat and tasks come along, and it is told', async () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const from = path.join(studio.claude, 'projects', claudeSlug(work.studio))
  const big = 'x'.repeat(9 * 1024 * 1024) // more than one Crew Link message carries
  write(path.join(from, id, 'tool-results', 'out.txt'), big)
  write(path.join(from, `${id}.jsonl`), JSON.stringify({ type: 'user', cwd: work.studio, saved: path.join(from, id, 'tool-results', 'out.txt') }) + '\n')
  // iris is working on a message, with one more (and an image) queued, and one sent to both iris and bob
  await ready(studio, 'iris')
  await ready(studio, 'bob')
  await studio.run(`(crew.here.onHook('iris', { hook_event_name: 'SessionStart', session_id: '${id}', transcript_path: ${JSON.stringify(path.join(from, `${id}.jsonl`))} }), 1)`)
  await studio.run(`crew.here.send({ to: 'iris', text: 'build the login page' })`)
  const working = await studio.run(`crew.here.feed.at(-1).id`)
  await studio.run(`(crew.here.onHook('iris', { hook_event_name: 'UserPromptSubmit', session_id: '${id}', prompt: 'build the login page' }), crew.here.agents.get('iris').status)`)
  const image = await studio.run(`crew.here.saveImage('shot.png', 'image/png', new Uint8Array([1, 2, 3]))`)
  await studio.run(`crew.here.send({ to: 'iris', text: 'and the signup page', images: [${JSON.stringify(image)}] })`)
  await studio.run(`crew.here.send({ to: 'iris,bob', text: 'both of you: review' })`)
  await studio.run(`crew.here.send({ from: 'iris', to: 'bob', text: 'the api for login, please' })`)
  await studio.run(`(crew.here.post({ kind: 'reply', from: 'iris', text: 'an earlier answer' }), crew.here.convos.iris.compactions = 2, crew.here.saveConvos(true), 1)`)
  await studio.run(`(crew.here.tickets.add({ title: 'Login is slow', by: 'you', owner: 'iris' }), crew.here.read({ iris: 1000 }), 1)`)
  await laptop.run(`(crew.here.read({ 'iris@studio-mac': 2000 }), 1)`)
  assert.equal(await studio.run(`crew.here.agents.get('iris').inbox.length`), 2)
  const before = (await feedOf(studio)).filter((e) => (e.kind === 'msg' ? e.to === 'iris' : e.from === 'iris')).map((e) => e.id)

  const moved = await laptop.run(`crew.moveAgent('iris@studio-mac', '', ${JSON.stringify(work.laptop)})`)
  assert.deepEqual(moved, { name: 'iris', conversation: 'moved' })

  // the transcript (all of it) is where Claude Code looks for it in the new folder, pointing at its new home
  const to = path.join(laptop.claude, 'projects', claudeSlug(work.laptop))
  assert.equal(fs.readFileSync(path.join(to, id, 'tool-results', 'out.txt'), 'utf8').length, big.length)
  assert.equal(JSON.parse(fs.readFileSync(path.join(to, `${id}.jsonl`), 'utf8')).saved, path.join(to, id, 'tool-results', 'out.txt'))
  assert.equal(await laptop.run(`crew.here.sessions.iris`), id)
  assert.match(await launched(laptop, 'iris'), new RegExp(`--resume ${id}`), 'it resumes that conversation')
  assert.equal(await laptop.run(`crew.here.convos.iris.compactions`), 2)

  // its lines in the chat moved, with their ids, and read right here
  const here = await feedOf(laptop)
  assert.deepEqual(before.filter((x) => !here.some((e) => e.id === x)), [])
  const byText = (t) => here.find((e) => e.text === t)
  assert.equal(byText('build the login page').to, 'iris')
  assert.deepEqual(byText('both of you: review').cc, ['iris', 'bob@studio-mac'])
  assert.equal(byText('an earlier answer').from, 'iris')
  assert.match(here.at(-1).text, /moved from Studio Mac to Laptop, with its conversation, and picks up where it left off/)
  // its queue came along, images saved here, after what Crew tells it first
  const queue = await laptop.run(`crew.here.agents.get('iris').inbox`)
  assert.deepEqual(queue.map((m) => m.text.slice(0, 20)), ['[crew] You were move', 'and the signup page', 'both of you: review'])
  assert.equal(queue[0].id, working, 'its reply will point at what it was working on')
  assert.ok(queue[1].images[0].startsWith(path.join(laptop.home, 'attachments')))
  assert.deepEqual([...fs.readFileSync(queue[1].images[0])], [1, 2, 3])
  assert.equal(here.find((e) => e.text === 'and the signup page').queued, true)
  assert.equal(await laptop.run(`crew.here.reads.agents.iris`), 2000)

  // once it's up, it's told where it is and what it was doing
  await ready(laptop, 'iris')
  const told = await until(() => laptop.read('typed-iris.log').includes('carry on.') && laptop.read('typed-iris.log'))
  assert.match(told, /\[crew\] You were moved from computer "Studio Mac" to "Laptop" while working on: "build the login page"\. Your conversation came with you/)
  assert.ok(told.includes(`your folder here is ${work.laptop} (it was ${work.studio} on Studio Mac)`))

  // the computer it left: gone, and what stays there points at it on Laptop
  await sleep(300)
  assert.equal(await studio.run(`crew.here.agents.has('iris')`), false)
  assert.equal(await studio.run(`crew.here.convos.iris`), undefined)
  const there = await feedOf(studio)
  assert.deepEqual(there.filter((e) => before.includes(e.id)), [])
  const handoff = there.find((e) => e.text === 'the api for login, please')
  assert.equal(handoff.from, 'iris@laptop', 'a hand-off stays with the agent it went to')
  assert.equal(handoff.re, `${working}@laptop`, 'and points at the request that led to it, now on Laptop')
  const seen = await until(async () => (await laptop.run(`crew.snapshot().feed`)).find((e) => e.text === 'the api for login, please' && e.re === working))
  assert.ok(seen, 'which this computer finds among its own lines')
  assert.deepEqual(there.find((e) => e.text === 'both of you: review').cc, ['iris@laptop', 'bob'])
  assert.equal(await studio.run(`crew.here.tickets.all[0].owner`), 'iris@laptop')
  assert.equal(await studio.run(`crew.here.reads.agents['iris@laptop']`), 1000)
  const saved = () => studio.read('feed.jsonl').trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(await until(() => !saved().some((e) => before.includes(e.id ?? e.amend))), 'feed.jsonl rewritten without them')
  assert.equal((await laptop.run(`crew.snapshot().feed`)).filter((e) => e.text === 'both of you: review').length, 2, 'each copy of a send in one place or the other')
})

test('a free Codex agent moves from here to a linked computer: its next message starts with a note', async () => {
  const id = '01a11823-82bf-7e20-b5e4-91dbe18be2be'
  const rel = path.join('2026', '10', '07', `rollout-2026-10-07T17-52-23-${id}.jsonl`)
  write(path.join(laptop.codex, 'sessions', rel), '{"type":"session_meta"}\n')
  await laptop.run(`(crew.here.saveSession('dev', '${id}'), 1)`)
  await ready(laptop, 'dev')
  assert.deepEqual(await laptop.run(`crew.moveAgent('dev', 'studio-mac', ${JSON.stringify(work.studio)})`), { name: 'dev@studio-mac', conversation: 'moved' })
  assert.equal(fs.readFileSync(path.join(studio.codex, 'sessions', rel), 'utf8'), '{"type":"session_meta"}\n')
  assert.equal(await studio.run(`crew.here.agents.get('dev').status`), 'resting', 'nothing to do yet: no terminal')
  assert.match(await studio.run(`crew.here.convos.dev.note`), /^\[crew\] Since your last message you moved from computer "Laptop" to "Studio Mac" \(your folder here is .*\); processes you started on Laptop didn't come along\.$/)
  assert.equal(await studio.run(`crew.here.agents.get('dev').inbox.length`), 0, 'no turn spent on telling it')
  await studio.run(`crew.here.send({ to: 'dev', text: 'hello there' })`)
  assert.match(await launched(studio, 'dev'), new RegExp(`launch resume ${id} -c tui.resume_cwd="current"`))
  await ready(studio, 'dev')
  assert.match(await until(() => studio.read('typed-dev.log').includes('hello there') && studio.read('typed-dev.log')), /\[crew\] Since your last message you moved from computer "Laptop"[^]*\n\nhello there/)
  assert.equal(await studio.run(`crew.here.convos.dev.note`), undefined, 'only once')
  assert.equal(await laptop.run(`crew.here.agents.has('dev')`), false)
})

test('no transcript to take: it still moves, and starts a new conversation there', async () => {
  await studio.run(`(crew.here.saveSession('milo', 'cccccccc-0000-0000-0000-000000000000'), 1)`)
  const out = await studio.run(`crew.moveAgent('milo', 'laptop')`)
  assert.deepEqual(out, { name: 'milo@laptop', conversation: 'fresh', reason: "its conversation wasn't found" })
  const event = (await feedOf(laptop)).at(-1)
  assert.deepEqual([event.from, event.fresh, event.text], ['milo', true, "moved from Studio Mac to Laptop, starting a new conversation: its conversation wasn't found"])
  assert.equal(await laptop.run(`crew.here.sessions.milo`), undefined)
  assert.equal(await laptop.run(`crew.here.agents.get('milo').off`), true, 'off stays off')
})

test('between two linked computers that are not linked to each other, everything passing through this one', async () => {
  const id = 'dddddddd-0000-0000-0000-000000000000'
  write(path.join(studio.claude, 'projects', claudeSlug(work.studio), `${id}.jsonl`), '{"zoe":1}\n')
  await studio.run(`(crew.here.saveSession('zoe', '${id}'), crew.here.post({ kind: 'reply', from: 'zoe', text: 'zoe was here' }), 1)`)
  await laptop.run(`(crew.here.read({ 'zoe@studio-mac': 3000 }), 1)`)
  assert.deepEqual(await laptop.run(`crew.moveAgent('zoe@studio-mac', 'workstation', ${JSON.stringify(work.workstation)})`), { name: 'zoe@workstation', conversation: 'moved' })
  assert.equal(fs.readFileSync(path.join(workstation.claude, 'projects', claudeSlug(work.workstation), `${id}.jsonl`), 'utf8'), '{"zoe":1}\n')
  assert.equal(await workstation.run(`crew.here.sessions.zoe`), id)
  assert.equal((await feedOf(workstation)).find((e) => e.text === 'zoe was here').from, 'zoe')
  assert.equal(await studio.run(`crew.here.agents.has('zoe')`), false)
  assert.equal(await laptop.run(`crew.here.reads.agents['zoe@workstation']`), 3000, 'this computer follows it too')
  // once Studio Mac's state has caught up here, one copy, Workstation's
  const copies = async () => (await laptop.run(`crew.snapshot().feed`)).filter((e) => e.text === 'zoe was here').map((e) => e.from)
  assert.deepEqual(await until(async () => String(await copies()) === 'zoe@workstation' && copies()), ['zoe@workstation'])
})

const nowhere = path.join(work.laptop, 'no', 'such', 'folder')

test('a running agent needs its folder on the other computer; nothing stops until that checks out', async () => {
  await assert.rejects(laptop.run(`crew.moveAgent('bob@studio-mac', '', ${JSON.stringify(nowhere)})`), (e) => e.message === `there's no folder ${nowhere} on Laptop`)
  assert.equal(await studio.run(`crew.here.runner.running('bob')`), true)
})

test('folders on another computer: does one exist, and which ones to offer', async () => {
  assert.deepEqual(await laptop.run(`crew.folderInfo('studio-mac', ${JSON.stringify(work.studio)})`), { exists: true, path: work.studio })
  assert.deepEqual(await laptop.run(`crew.folderInfo('studio-mac', ${JSON.stringify(nowhere)})`), { exists: false, path: nowhere })
  assert.equal((await laptop.run(`crew.folderInfo('', '~')`)).path, os.homedir())
  const offered = await laptop.run(`crew.folders('workstation', 'bob@studio-mac')`)
  assert.deepEqual(offered.find((f) => f.path === work.studio), { path: work.studio, label: 'same folder as now' })
  assert.deepEqual(offered.find((f) => f.path === work.workstation), { path: work.workstation, label: 'zoe' })
  assert.deepEqual(offered.at(-1), { path: miniHome, label: 'home folder' })
})

test("a folder in another computer's home is found in the same place in this one's: a Mac's path on Windows, and back", async () => {
  const app = path.join(miniHome, 'code', 'app')
  for (const dir of ['C:\\Users\\sam\\code\\app', '/Users/sam/code/app', '~\\code\\app', '~/code/app']) {
    assert.deepEqual(await laptop.run(`crew.folderInfo('workstation', ${JSON.stringify(dir)})`), { exists: true, path: app }, dir)
  }
  assert.deepEqual(await laptop.run(`crew.folderInfo('workstation', 'C:\\\\Users\\\\sam\\\\code\\\\nope')`), { exists: false, path: 'C:\\Users\\sam\\code\\nope' })
  // and offered as where it works now
  await laptop.run(`crew.here.addAgent({ name: 'pcdev', area: 'windows', cwd: 'C:\\\\Users\\\\sam\\\\code\\\\app', off: true })`)
  const offered = await laptop.run(`crew.folders('workstation', 'pcdev')`)
  assert.deepEqual(offered.find((f) => f.path === app), { path: app, label: 'same folder as now' })
  await laptop.run(`(crew.here.removeAgent('pcdev'), 1)`)
})

// What a Windows PC sends when one of its agents moves (see moveOut), arriving here: on Workstation, where the folder it worked
// in, C:\Users\sam\code\app, is ~/code/app.
test('an agent from Windows arrives on a Mac: its folder, its files and the paths in its transcript as this computer has them', async () => {
  const id = 'ffffffff-0000-0000-0000-000000000000'
  const root = 'C:\\Users\\sam\\.claude\\projects\\C--Users-sam-code-app'
  const transcript = JSON.stringify({ type: 'user', cwd: 'C:\\Users\\sam\\code\\app', saved: `${root}\\${id}\\tool-results\\toolu_01.txt` }) + '\r\n'
  const files = [[`${id}.jsonl`, transcript], [`${id}/tool-results/toolu_01.txt`, 'output'], [`${id}\\subagents\\agent-1.jsonl`, '{}\r\n']] // the last as an older Windows Crew might have sent it
  const pack = { crew: 1, agents: [{ name: 'win', area: 'windows builds', provider: 'claude', avatar: { seed: 'win' } }] }
  const out = { token: 'w1', name: 'win', files: files.map(([rel, text]) => ({ rel, size: Buffer.byteLength(text) })), pack, session: { cli: 'claude', id, root, sep: '\\' }, convo: null, feed: [], inbox: [], cwd: 'C:\\Users\\sam\\code\\app', working: false }
  const token = 'aaaaaaaa-1111-2222-3333-444444444444'
  for (const [i, [, text]] of files.entries()) await workstation.run(`crew.serve('moveWrite', [${JSON.stringify(token)}, ${i}, 0, new Uint8Array(Buffer.from(${JSON.stringify(text)}))])`)
  const res = await workstation.run(`crew.serve('moveIn', [${JSON.stringify(token)}, ${JSON.stringify(out)}, { name: 'win', folder: 'C:\\\\Users\\\\sam\\\\code\\\\app', on: false, from: { slug: 'pc', name: 'PC' } }], crew.here)`)
  assert.deepEqual(res, { name: 'win', conversation: 'moved' })
  const app = path.join(miniHome, 'code', 'app')
  assert.equal(await workstation.run(`crew.here.agents.get('win').cwd`), app, 'it works in the same place here')
  const project = path.join(workstation.claude, 'projects', claudeSlug(app))
  assert.equal(fs.readFileSync(path.join(project, id, 'tool-results', 'toolu_01.txt'), 'utf8'), 'output')
  assert.equal(fs.readFileSync(path.join(project, id, 'subagents', 'agent-1.jsonl'), 'utf8'), '{}\r\n')
  const moved = fs.readFileSync(path.join(project, `${id}.jsonl`), 'utf8')
  assert.equal(JSON.parse(moved).saved, path.join(project, id, 'tool-results', 'toolu_01.txt'))
  assert.ok(moved.endsWith('\r\n'), 'its line endings as they were')
  assert.equal(await workstation.run(`crew.here.sessions.win`), id)
  assert.match(await workstation.run(`crew.here.convos.win.note`), /your folder here is .*app \(it was C:\\Users\\sam\\code\\app on PC\)/)
})

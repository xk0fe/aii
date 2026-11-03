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
  assert.equal(claudeSlug('/Users/k0fe/Downloads/aii'), '-Users-k0fe-Downloads-aii')
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
  const names = requalify({ from: 'studio', to: 'air', old: 'gal', name: 'gal-2' })
  assert.deepEqual(['gal', 'bob', 'ann@air', 'zed@mini', 'you', 'crew'].map(names), ['gal-2', 'bob@studio', 'ann', 'zed@mini', 'you', 'crew'])
  const tasks = requalify({ from: 'studio', to: 'air', numbers: true })
  assert.deepEqual([12, '12', '7@air', '3@mini'].map(tasks), ['12@studio', '12@studio', 7, '3@mini'])
  const lines = requalify({ from: 'studio', to: 'air' })
  assert.deepEqual(['a1b2c3d4', '12345678@air'].map(lines), ['a1b2c3d4@studio', '12345678'], 'ids stay strings')
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
function computer(name, linkPort, agents, { you } = {}) {
  const home = tmp('home')
  const claude = tmp('claude')
  const codex = tmp('codex')
  fs.mkdirSync(path.join(home, 'link'))
  fs.writeFileSync(path.join(home, 'link', 'link.json'), JSON.stringify({ name, port: linkPort }))
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ agents: agents.map((a) => ({ off: true, ...a })) }))
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

const work = { studio: tmp('work-studio'), air: tmp('work-air'), mini: tmp('work-mini') } // each computer's checkout
const studio = computer('Studio Mac', port, [
  { name: 'gal', area: 'design', cwd: work.studio, off: false },
  { name: 'bob', area: 'backend', cwd: work.studio, off: false },
  { name: 'kim', area: 'docs', cwd: work.studio },
  { name: 'zed', area: 'ops', cwd: work.studio },
])
const air = computer('Air', port + 1, [
  { name: 'dev', area: 'mobile', provider: 'codex', cwd: work.air, off: false },
  { name: 'ann', area: 'docs writing' },
])
const miniHome = tmp('you') // Mini's user, ann, has her own home folder, with code/app in it
fs.mkdirSync(path.join(miniHome, 'code', 'app'), { recursive: true })
const mini = computer('Mini', port + 2, [], { you: miniHome })

// The CLI has started (its SessionStart hook), its terminal has gone quiet and it is free: messages go in right away.
const ready = (c, name) => c.run(`((a, proc) => (crew.hub.onHook(${JSON.stringify(name)}, { hook_event_name: 'SessionStart', source: 'startup' }), a.holdUntil = 0, proc && (proc.lastOutput = 0), crew.hub.pump(a), a.status))(crew.hub.agents.get(${JSON.stringify(name)}), crew.runner.procs.get(${JSON.stringify(name)}))`)
const feedOf = (c) => c.run(`crew.hub.feed`)

before(async () => {
  await Promise.all([studio.up, air.up, mini.up])
  for (const c of [studio, mini]) await c.run(`crew.share(true)`)
  for (const c of [studio, mini]) await air.run(`crew.connect(${JSON.stringify(await c.run(`crew.snapshot().computers.me.code`))})`)
  await sleep(300)
})
after(() => {
  for (const c of [studio, air, mini]) c.stop()
  for (const d of made) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10 })
})

test('a working agent moves here from a linked computer: its conversation, queue, chat and tasks come along, and it is told', async () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const from = path.join(studio.claude, 'projects', claudeSlug(work.studio))
  const big = 'x'.repeat(9 * 1024 * 1024) // more than one Crew Link message carries
  write(path.join(from, id, 'tool-results', 'out.txt'), big)
  write(path.join(from, `${id}.jsonl`), JSON.stringify({ type: 'user', cwd: work.studio, saved: path.join(from, id, 'tool-results', 'out.txt') }) + '\n')
  // gal is working on a message, with one more (and an image) queued, and one sent to both gal and bob
  await ready(studio, 'gal')
  await ready(studio, 'bob')
  await studio.run(`(crew.hub.onHook('gal', { hook_event_name: 'SessionStart', session_id: '${id}', transcript_path: ${JSON.stringify(path.join(from, `${id}.jsonl`))} }), 1)`)
  await studio.run(`crew.hub.send({ to: 'gal', text: 'build the login page' })`)
  const working = await studio.run(`crew.hub.feed.at(-1).id`)
  await studio.run(`(crew.hub.onHook('gal', { hook_event_name: 'UserPromptSubmit', session_id: '${id}', prompt: 'build the login page' }), crew.hub.agents.get('gal').status)`)
  const image = await studio.run(`crew.hub.saveImage('shot.png', 'image/png', new Uint8Array([1, 2, 3]))`)
  await studio.run(`crew.hub.send({ to: 'gal', text: 'and the signup page', images: [${JSON.stringify(image)}] })`)
  await studio.run(`crew.hub.send({ to: 'gal,bob', text: 'both of you: review' })`)
  await studio.run(`crew.hub.send({ from: 'gal', to: 'bob', text: 'the api for login, please' })`)
  await studio.run(`(crew.hub.post({ kind: 'reply', from: 'gal', text: 'an earlier answer' }), crew.hub.convos.gal.compactions = 2, crew.hub.saveConvos(true), 1)`)
  await studio.run(`(crew.hub.tickets.add({ title: 'Login is slow', by: 'you', owner: 'gal' }), crew.hub.read({ gal: 1000 }), 1)`)
  await air.run(`(crew.hub.read({ 'gal@studio-mac': 2000 }), 1)`)
  assert.equal(await studio.run(`crew.hub.agents.get('gal').inbox.length`), 2)
  const before = (await feedOf(studio)).filter((e) => (e.kind === 'msg' ? e.to === 'gal' : e.from === 'gal')).map((e) => e.id)

  const moved = await air.run(`crew.moveAgent('gal@studio-mac', '', ${JSON.stringify(work.air)})`)
  assert.deepEqual(moved, { name: 'gal', conversation: 'moved' })

  // the transcript (all of it) is where Claude Code looks for it in the new folder, pointing at its new home
  const to = path.join(air.claude, 'projects', claudeSlug(work.air))
  assert.equal(fs.readFileSync(path.join(to, id, 'tool-results', 'out.txt'), 'utf8').length, big.length)
  assert.equal(JSON.parse(fs.readFileSync(path.join(to, `${id}.jsonl`), 'utf8')).saved, path.join(to, id, 'tool-results', 'out.txt'))
  assert.equal(await air.run(`crew.hub.sessions.gal`), id)
  assert.match(await launched(air, 'gal'), new RegExp(`--resume ${id}`), 'it resumes that conversation')
  assert.equal(await air.run(`crew.hub.convos.gal.compactions`), 2)

  // its lines in the chat moved, with their ids, and read right here
  const here = await feedOf(air)
  assert.deepEqual(before.filter((x) => !here.some((e) => e.id === x)), [])
  const byText = (t) => here.find((e) => e.text === t)
  assert.equal(byText('build the login page').to, 'gal')
  assert.deepEqual(byText('both of you: review').cc, ['gal', 'bob@studio-mac'])
  assert.equal(byText('an earlier answer').from, 'gal')
  assert.match(here.at(-1).text, /moved from Studio Mac to Air, with its conversation, and picks up where it left off/)
  // its queue came along, images saved here, after what Crew tells it first
  const queue = await air.run(`crew.hub.agents.get('gal').inbox`)
  assert.deepEqual(queue.map((m) => m.text.slice(0, 20)), ['[crew] You were move', 'and the signup page', 'both of you: review'])
  assert.equal(queue[0].id, working, 'its reply will point at what it was working on')
  assert.ok(queue[1].images[0].startsWith(path.join(air.home, 'attachments')))
  assert.deepEqual([...fs.readFileSync(queue[1].images[0])], [1, 2, 3])
  assert.equal(here.find((e) => e.text === 'and the signup page').queued, true)
  assert.equal(await air.run(`crew.hub.reads.agents.gal`), 2000)

  // once it's up, it's told where it is and what it was doing
  await ready(air, 'gal')
  const told = await until(() => air.read('typed-gal.log').includes('carry on.') && air.read('typed-gal.log'))
  assert.match(told, /\[crew\] You were moved from computer "Studio Mac" to "Air" while working on: "build the login page"\. Your conversation came with you/)
  assert.ok(told.includes(`your folder here is ${work.air} (it was ${work.studio} on Studio Mac)`))

  // the computer it left: gone, and what stays there points at it on Air
  await sleep(300)
  assert.equal(await studio.run(`crew.hub.agents.has('gal')`), false)
  assert.equal(await studio.run(`crew.hub.convos.gal`), undefined)
  const there = await feedOf(studio)
  assert.deepEqual(there.filter((e) => before.includes(e.id)), [])
  const handoff = there.find((e) => e.text === 'the api for login, please')
  assert.equal(handoff.from, 'gal@air', 'a hand-off stays with the agent it went to')
  assert.equal(handoff.re, `${working}@air`, 'and points at the request that led to it, now on Air')
  const seen = await until(async () => (await air.run(`crew.snapshot().feed`)).find((e) => e.text === 'the api for login, please' && e.re === working))
  assert.ok(seen, 'which this computer finds among its own lines')
  assert.deepEqual(there.find((e) => e.text === 'both of you: review').cc, ['gal@air', 'bob'])
  assert.equal(await studio.run(`crew.hub.tickets.all[0].owner`), 'gal@air')
  assert.equal(await studio.run(`crew.hub.reads.agents['gal@air']`), 1000)
  const saved = () => studio.read('feed.jsonl').trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(await until(() => !saved().some((e) => before.includes(e.id ?? e.amend))), 'feed.jsonl rewritten without them')
  assert.equal((await air.run(`crew.snapshot().feed`)).filter((e) => e.text === 'both of you: review').length, 2, 'each copy of a send in one place or the other')
})

test('a free Codex agent moves from here to a linked computer: its next message starts with a note', async () => {
  const id = '01a11823-82bf-7e20-b5e4-91dbe18be2be'
  const rel = path.join('2026', '10', '07', `rollout-2026-10-07T17-52-23-${id}.jsonl`)
  write(path.join(air.codex, 'sessions', rel), '{"type":"session_meta"}\n')
  await air.run(`(crew.hub.saveSession('dev', '${id}'), 1)`)
  await ready(air, 'dev')
  assert.deepEqual(await air.run(`crew.moveAgent('dev', 'studio-mac', ${JSON.stringify(work.studio)})`), { name: 'dev@studio-mac', conversation: 'moved' })
  assert.equal(fs.readFileSync(path.join(studio.codex, 'sessions', rel), 'utf8'), '{"type":"session_meta"}\n')
  assert.match(await launched(studio, 'dev'), new RegExp(`launch resume ${id} -c tui.resume_cwd="current"`))
  assert.match(await studio.run(`crew.hub.convos.dev.note`), /^\[crew\] Since your last message you moved from computer "Air" to "Studio Mac" \(your folder here is .*\); processes you started on Air didn't come along\.$/)
  assert.equal(await studio.run(`crew.hub.agents.get('dev').inbox.length`), 0, 'no turn spent on telling it')
  await studio.run(`crew.hub.send({ to: 'dev', text: 'hello there' })`)
  await ready(studio, 'dev')
  assert.match(await until(() => studio.read('typed-dev.log').includes('hello there') && studio.read('typed-dev.log')), /\[crew\] Since your last message you moved from computer "Air"[^]*\n\nhello there/)
  assert.equal(await studio.run(`crew.hub.convos.dev.note`), undefined, 'only once')
  assert.equal(await air.run(`crew.hub.agents.has('dev')`), false)
})

test('no transcript to take: it still moves, and starts a new conversation there', async () => {
  await studio.run(`(crew.hub.saveSession('kim', 'cccccccc-0000-0000-0000-000000000000'), 1)`)
  const out = await studio.run(`crew.moveAgent('kim', 'air')`)
  assert.deepEqual(out, { name: 'kim@air', conversation: 'fresh', reason: "its conversation wasn't found" })
  const event = (await feedOf(air)).at(-1)
  assert.deepEqual([event.from, event.fresh, event.text], ['kim', true, "moved from Studio Mac to Air, starting a new conversation: its conversation wasn't found"])
  assert.equal(await air.run(`crew.hub.sessions.kim`), undefined)
  assert.equal(await air.run(`crew.hub.agents.get('kim').off`), true, 'off stays off')
})

test('between two linked computers that are not linked to each other, everything passing through this one', async () => {
  const id = 'dddddddd-0000-0000-0000-000000000000'
  write(path.join(studio.claude, 'projects', claudeSlug(work.studio), `${id}.jsonl`), '{"zed":1}\n')
  await studio.run(`(crew.hub.saveSession('zed', '${id}'), crew.hub.post({ kind: 'reply', from: 'zed', text: 'zed was here' }), 1)`)
  await air.run(`(crew.hub.read({ 'zed@studio-mac': 3000 }), 1)`)
  assert.deepEqual(await air.run(`crew.moveAgent('zed@studio-mac', 'mini', ${JSON.stringify(work.mini)})`), { name: 'zed@mini', conversation: 'moved' })
  assert.equal(fs.readFileSync(path.join(mini.claude, 'projects', claudeSlug(work.mini), `${id}.jsonl`), 'utf8'), '{"zed":1}\n')
  assert.equal(await mini.run(`crew.hub.sessions.zed`), id)
  assert.equal((await feedOf(mini)).find((e) => e.text === 'zed was here').from, 'zed')
  assert.equal(await studio.run(`crew.hub.agents.has('zed')`), false)
  assert.equal(await air.run(`crew.hub.reads.agents['zed@mini']`), 3000, 'this computer follows it too')
  // once Studio Mac's state has caught up here, one copy, Mini's
  const copies = async () => (await air.run(`crew.snapshot().feed`)).filter((e) => e.text === 'zed was here').map((e) => e.from)
  assert.deepEqual(await until(async () => String(await copies()) === 'zed@mini' && copies()), ['zed@mini'])
})

test('a computer on an older Crew: the agent moves without its conversation, and the result says why', async () => {
  const MOVE = ['folderInfo', 'folders', 'moveOut', 'moveRead', 'moveEnd', 'moveWrite', 'moveIn', 'moveDrop', 'agentMoved']
  await studio.run(`(crew.oldServe = crew.serve, crew.serve = (fn, args) => { if (${JSON.stringify(MOVE)}.includes(fn)) throw new Error('"' + fn + '" isn\\'t available over Crew Link'); return crew.oldServe(fn, args) }, 1)`)
  try {
    assert.deepEqual(await air.run(`crew.moveAgent('ann', 'studio-mac')`), { name: 'ann@studio-mac', conversation: 'fresh', reason: 'Studio Mac runs an older Crew', older: true })
    await sleep(200)
    assert.equal(await studio.run(`crew.hub.agents.has('ann')`), true)
    assert.equal(await air.run(`crew.hub.agents.has('ann')`), false)
    // and from it
    assert.deepEqual(await air.run(`crew.moveAgent('ann@studio-mac', '')`), { name: 'ann', conversation: 'fresh', reason: 'Studio Mac runs an older Crew', older: true })
  } finally {
    await studio.run(`(crew.serve = crew.oldServe, 1)`)
  }
})

const nowhere = path.join(work.air, 'no', 'such', 'folder')

test('a running agent needs its folder on the other computer; nothing stops until that checks out', async () => {
  await assert.rejects(air.run(`crew.moveAgent('bob@studio-mac', '', ${JSON.stringify(nowhere)})`), (e) => e.message === `there's no folder ${nowhere} on Air`)
  assert.equal(await studio.run(`crew.hub.runner.running('bob')`), true)
})

test('folders on another computer: does one exist, and which ones to offer', async () => {
  assert.deepEqual(await air.run(`crew.folderInfo('studio-mac', ${JSON.stringify(work.studio)})`), { exists: true, path: work.studio })
  assert.deepEqual(await air.run(`crew.folderInfo('studio-mac', ${JSON.stringify(nowhere)})`), { exists: false, path: nowhere })
  assert.equal((await air.run(`crew.folderInfo('', '~')`)).path, os.homedir())
  const offered = await air.run(`crew.folders('mini', 'bob@studio-mac')`)
  assert.deepEqual(offered.find((f) => f.path === work.studio), { path: work.studio, label: 'same folder as now' })
  assert.deepEqual(offered.find((f) => f.path === work.mini), { path: work.mini, label: 'zed' })
  assert.deepEqual(offered.at(-1), { path: miniHome, label: 'home folder' })
})

test("a folder in another computer's home is found in the same place in this one's: a Mac's path on Windows, and back", async () => {
  const app = path.join(miniHome, 'code', 'app')
  for (const dir of ['C:\\Users\\sam\\code\\app', '/Users/sam/code/app', '~\\code\\app', '~/code/app']) {
    assert.deepEqual(await air.run(`crew.folderInfo('mini', ${JSON.stringify(dir)})`), { exists: true, path: app }, dir)
  }
  assert.deepEqual(await air.run(`crew.folderInfo('mini', 'C:\\\\Users\\\\sam\\\\code\\\\nope')`), { exists: false, path: 'C:\\Users\\sam\\code\\nope' })
  // and offered as where it works now
  await air.run(`crew.hub.addAgent({ name: 'pcdev', area: 'windows', cwd: 'C:\\\\Users\\\\sam\\\\code\\\\app', off: true })`)
  const offered = await air.run(`crew.folders('mini', 'pcdev')`)
  assert.deepEqual(offered.find((f) => f.path === app), { path: app, label: 'same folder as now' })
  await air.run(`(crew.hub.removeAgent('pcdev'), 1)`)
})

// What a Windows PC sends when one of its agents moves (see moveOut), arriving here: on Mini, where the folder it worked
// in, C:\Users\sam\code\app, is ~/code/app.
test('an agent from Windows arrives on a Mac: its folder, its files and the paths in its transcript as this computer has them', async () => {
  const id = 'ffffffff-0000-0000-0000-000000000000'
  const root = 'C:\\Users\\sam\\.claude\\projects\\C--Users-sam-code-app'
  const transcript = JSON.stringify({ type: 'user', cwd: 'C:\\Users\\sam\\code\\app', saved: `${root}\\${id}\\tool-results\\toolu_01.txt` }) + '\r\n'
  const files = [[`${id}.jsonl`, transcript], [`${id}/tool-results/toolu_01.txt`, 'output'], [`${id}\\subagents\\agent-1.jsonl`, '{}\r\n']] // the last as an older Windows Crew might have sent it
  const pack = { crew: 1, agents: [{ name: 'win', area: 'windows builds', provider: 'claude', avatar: { seed: 'win' } }] }
  const out = { token: 'w1', name: 'win', files: files.map(([rel, text]) => ({ rel, size: Buffer.byteLength(text) })), pack, session: { cli: 'claude', id, root, sep: '\\' }, convo: null, feed: [], inbox: [], cwd: 'C:\\Users\\sam\\code\\app', working: false }
  const token = 'aaaaaaaa-1111-2222-3333-444444444444'
  for (const [i, [, text]] of files.entries()) await mini.run(`crew.serve('moveWrite', [${JSON.stringify(token)}, ${i}, 0, new Uint8Array(Buffer.from(${JSON.stringify(text)}))])`)
  const res = await mini.run(`crew.serve('moveIn', [${JSON.stringify(token)}, ${JSON.stringify(out)}, { name: 'win', folder: 'C:\\\\Users\\\\sam\\\\code\\\\app', on: false, from: { slug: 'pc', name: 'PC' } }])`)
  assert.deepEqual(res, { name: 'win', conversation: 'moved' })
  const app = path.join(miniHome, 'code', 'app')
  assert.equal(await mini.run(`crew.hub.agents.get('win').cwd`), app, 'it works in the same place here')
  const project = path.join(mini.claude, 'projects', claudeSlug(app))
  assert.equal(fs.readFileSync(path.join(project, id, 'tool-results', 'toolu_01.txt'), 'utf8'), 'output')
  assert.equal(fs.readFileSync(path.join(project, id, 'subagents', 'agent-1.jsonl'), 'utf8'), '{}\r\n')
  const moved = fs.readFileSync(path.join(project, `${id}.jsonl`), 'utf8')
  assert.equal(JSON.parse(moved).saved, path.join(project, id, 'tool-results', 'toolu_01.txt'))
  assert.ok(moved.endsWith('\r\n'), 'its line endings as they were')
  assert.equal(await mini.run(`crew.hub.sessions.win`), id)
  assert.match(await mini.run(`crew.hub.convos.win.note`), /your folder here is .*app \(it was C:\\Users\\sam\\code\\app on PC\)/)
})

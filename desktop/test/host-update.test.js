// What an update does to the agents: CLIque's files are replaced under a terminal host that's still running (macOS: the
// app is swapped in place; Windows runs the host from a copy outside the app, which test/ptyhost.test.js covers), and
// the new CLIque connects to it. For real: a host process run from a folder that stands in for the app, with terminals
// in it, in a throwaway CLIQUE_HOME. "Restart to update" promises what these check (core/updates.js restartWords).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { program, alive, gone, WIN } from './helpers/platform.mjs'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-hostup-'))
const { HostRunner, stage } = await import('../core/ptyclient.js')
const { ADDRESS, LOG, PROTOCOL, address } = await import('../core/ptyhost.js')
const tmp = os.tmpdir()
const HOST = fileURLToPath(new URL('../core/ptyhost.js', import.meta.url))
const PTY = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'))
const skip = WIN && 'Windows never replaces files a host runs from: it runs from a copy outside the app'
let last
const started = []
after(() => {
  last?.quit()
  for (const pid of started) if (alive(pid)) process.kill(pid)
  setTimeout(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }), 800)
})

const until = async (f, ms = 8000, why = () => '') => {
  for (const t = Date.now(); !(await f()); ) {
    if (Date.now() - t > ms) throw new Error(`timed out ${why()}\n${fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').slice(-3000) : ''}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}
const output = (r) => {
  const seen = new Map()
  r.on('data', (name, d) => seen.set(name, (seen.get(name) ?? '') + d))
  return seen
}
const run = (js, tag) => ({ ...program(js), cwd: tmp, env: {}, tag })
const ticking = "let n = 0; setInterval(() => console.log('tick ' + n++), 100)"
// Node as "the app's program": elsewhere than Windows it may need libraries next to where it's installed, so the
// copy gets a stand-in that runs it (as in test/ptyhost.test.js).
const nodeProgram = () => {
  if (WIN) return process.execPath
  const file = path.join(fs.mkdtempSync(path.join(tmp, 'clique-node-')), 'node')
  fs.writeFileSync(file, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 })
  return file
}
// "CLIque.app" as version 1.0.0 has it: the host's script with node-pty beside it -> { home, file, script }
const app = async (name) => {
  const into = path.join(process.env.CLIQUE_HOME, name)
  const copy = await stage({ exe: nodeProgram(), script: HOST, pty: PTY, into, busy: async () => true })
  return { home: path.dirname(copy.file), ...copy }
}
// Starts a host from there, as an older CLIque did, and waits until it listens.
const startHost = async ({ file, script }) => {
  const p = spawn(file, [script], { detached: true, stdio: 'ignore', cwd: tmp, env: process.env })
  p.unref()
  started.push(p.pid)
  await until(() => new Promise((r) => {
    const where = address()
    if (!where?.token) return r(false)
    const s = net.connect(where.path)
    s.once('connect', () => (s.destroy(), r(true)))
    s.once('error', () => r(false))
  }))
  return p.pid
}

test('an update swaps the app under a running host: the new CLIque finds the same host and the same terminals, still at work, and can start new ones', { skip }, async () => {
  const v1 = await app('app-keep')
  const hostPid = await startHost(v1)
  const old = new HostRunner({ runtime: { file: process.execPath, env: {} } })
  assert.deepEqual(await old.connect(), [])
  assert.equal(old.hostPid, hostPid, 'the older CLIque uses the host that runs from its app')
  const seen = output(old)
  old.start('ada', run(ticking, 'turn1'))
  await until(() => seen.get('ada')?.includes('tick 2'))
  const pid = old.pid('ada')
  old.detach() // Restart to update: CLIque lets go and quits

  // the update: the new app is moved to where the old one was, and the old one's files are deleted (what Squirrel.Mac
  // does), every file a new one, the host's script with other text in it
  const trash = `${v1.home}.old`
  fs.renameSync(v1.home, trash)
  fs.cpSync(trash, v1.home, { recursive: true })
  fs.appendFileSync(v1.script, '\n// 1.0.1\n')
  fs.rmSync(trash, { recursive: true, force: true })
  await new Promise((r) => setTimeout(r, 400))
  assert.ok(alive(hostPid), 'the host runs on with its files gone from under it')
  assert.ok(alive(pid), "and so does the agent's terminal")

  const next = new HostRunner({ runtime: { file: process.execPath, env: {} } })
  last = next
  const survivors = await next.connect()
  assert.equal(next.hostPid, hostPid, 'the new CLIque connects to the host that was running: no new one')
  assert.equal(next.replaced, undefined, 'and has no reason to replace it')
  assert.deepEqual(survivors, [{ name: 'ada', tag: 'turn1', pid }], 'ada is still there, the same process')
  const at = Number(/tick (\d+)\s*$/.exec(next.buffer('ada').data)?.[1])
  const more = output(next)
  await until(() => /tick \d+/.test(more.get('ada') ?? ''))
  assert.ok(Number(/tick (\d+)/.exec(more.get('ada'))[1]) > at - 1, 'and kept working the whole time')
  // a terminal started after the update, by the host from before it: it finds what it needs in the new app
  next.start('bo', run("console.log('started after the update')", 'turn2'))
  await until(() => more.get('bo')?.includes('started after the update'))
  assert.ok(alive(hostPid))
  next.quit()
  await until(() => !fs.existsSync(ADDRESS))
  assert.ok(await gone(pid))
  last = null
})

test("with the app gone altogether (moved, deleted) the host keeps the terminals it has, and one it can't start ends as an exit, not as a crash", { skip }, async () => {
  const v1 = await app('app-gone')
  const hostPid = await startHost(v1)
  const old = new HostRunner({ runtime: { file: process.execPath, env: {} } })
  await old.connect()
  const seen = output(old)
  old.start('ada', run(ticking, 'turn1'))
  await until(() => seen.get('ada')?.includes('tick 2'))
  const pid = old.pid('ada')
  old.detach()
  fs.rmSync(v1.home, { recursive: true, force: true })

  const next = new HostRunner({ runtime: { file: process.execPath, env: {} } })
  last = next
  const survivors = await next.connect()
  assert.deepEqual(survivors, [{ name: 'ada', tag: 'turn1', pid }])
  const more = output(next)
  await until(() => /tick \d+/.test(more.get('ada') ?? ''))
  const exits = []
  next.on('exit', (name, code) => exits.push([name, code]))
  next.start('bo', run("console.log('hi')", 'turn2'))
  await until(() => exits.length || more.get('bo')?.includes('hi'), 8000)
  // macOS: node-pty starts a terminal through a helper program in the app, so with the app gone it can't, and says so
  if (exits.length) assert.deepEqual(exits, [['bo', -1]], 'it ends at once, as a terminal that did not start')
  assert.ok(alive(hostPid), 'the host is still up')
  assert.ok(alive(pid), 'and ada with it')
  next.quit()
  await until(() => !fs.existsSync(ADDRESS))
  last = null
})

test('a host that speaks another protocol than the new CLIque is replaced: its terminals end, and CLIque knows how many', async () => {
  // a host from "another version": the same script with another PROTOCOL
  const v1 = await app('app-protocol')
  const text = fs.readFileSync(v1.script, 'utf8')
  assert.match(text, /export const PROTOCOL = \d+/)
  fs.writeFileSync(v1.script, text.replace(/export const PROTOCOL = \d+/, `export const PROTOCOL = ${PROTOCOL + 1}`))
  const hostPid = await startHost(v1)
  // its own CLIque, speaking its protocol, starts a terminal and goes
  const where = address()
  const sock = net.connect(where.path)
  let got = ''
  sock.setEncoding('utf8')
  sock.on('data', (d) => (got += d))
  sock.write(JSON.stringify({ t: 'hello', token: where.token, protocol: PROTOCOL + 1 }) + '\n')
  await until(() => got.includes('"hello"'))
  sock.write(JSON.stringify({ t: 'start', name: 'ada', ...program(ticking), cwd: tmp, env: process.env, tag: 'turn1' }) + '\n')
  await until(() => /"t":"started"/.test(got))
  const pid = JSON.parse(got.split('\n').find((l) => l.includes('"started"'))).pid
  sock.end()

  const next = new HostRunner({ runtime: { file: process.execPath, env: {} } })
  last = next
  const survivors = await next.connect()
  assert.equal(next.replaced, 1, 'one terminal went with the old host (core/clique.js says so in the chat)')
  assert.deepEqual(survivors, [], 'nothing is picked up')
  assert.notEqual(next.hostPid, hostPid, 'a host of its own version runs now')
  assert.ok(await gone(pid), "the old host's terminal was ended")
  assert.ok(await gone(hostPid), 'and the old host is gone')
  next.quit()
  await until(() => !fs.existsSync(ADDRESS))
  last = null
})

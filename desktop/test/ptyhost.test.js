// The terminal host (core/ptyhost.js) and its client (core/ptyclient.js), for real: a host process in a throwaway
// CREW_HOME, terminals that keep running while nobody is connected, and a second Crew that finds them. The same on
// macOS and Windows (a named pipe there, and the host run from a copy of its runtime). Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { program, alive, gone } from './helpers/platform.mjs'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-host-'))
const { HostRunner, rotate, stage } = await import('../core/ptyclient.js')
const { ADDRESS, PIPE, LOG, pipeName, isMain } = await import('../core/ptyhost.js')
const tmp = os.tmpdir()
const node = { file: process.execPath, env: {} }
let last
after(() => {
  last?.quit()
  setTimeout(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }), 800)
})

// why: what to say besides "timed out"; the host's log is said too
const until = async (f, ms = 8000, why = () => '') => {
  for (const t = Date.now(); !f(); ) {
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

test('terminals keep running while Crew is away, and the next Crew picks them up with what they printed', async () => {
  const first = new HostRunner({ runtime: node })
  assert.deepEqual(await first.connect(), [], 'a new host has nothing running yet')
  assert.ok(fs.existsSync(ADDRESS), 'it says where it is')
  const seen = output(first)
  first.start('iris', run("console.log('hello from iris'); process.stdin.pipe(process.stdout)", 'run1'))
  assert.ok(first.running('iris'), 'running right away, as the hub expects')
  await until(() => seen.get('iris')?.includes('hello from iris'))
  await until(() => first.pid('iris') > 0)
  const pid = first.pid('iris')
  first.detach() // Crew quits, the agent stays

  const second = new HostRunner({ runtime: node })
  last = second
  const survivors = await second.connect()
  assert.deepEqual(survivors, [{ name: 'iris', tag: 'run1', pid }])
  assert.ok(second.running('iris'))
  assert.match(second.buffer('iris').data, /hello from iris/, 'its terminal redraws from where it was')
  const more = output(second)
  second.write('iris', 'still here?\r')
  await until(() => more.get('iris')?.includes('still here?'))
})

test('an exit comes with its tag; a stop on purpose ends it without an exit, as in the in-process runner', async () => {
  const r = last
  const events = []
  r.on('exit', (name, code) => events.push(['exit', name, code]))
  r.on('ended', (name, tag) => events.push(['ended', name, tag]))
  // the host is still there after each, and says so in its log if it isn't
  const up = async (after) => {
    await new Promise((res) => setTimeout(res, 2000))
    assert.ok(alive(r.hostPid), `the host went after ${after}:\n${fs.readFileSync(LOG, 'utf8').slice(-3000)}`)
  }
  r.start('june', run('process.exit(3)', 'run2'))
  await until(() => events.length >= 2)
  assert.deepEqual(events.splice(0), [['ended', 'june', 'run2'], ['exit', 'june', 3]])
  assert.ok(!r.running('june'))
  await up('a terminal that ended by itself')
  await r.stop('iris')
  assert.deepEqual(events.splice(0), [['ended', 'iris', 'run1']])
  await up('a terminal stopped')
  // a new process under the same name isn't mistaken for the one it replaced
  r.start('ada', run('setTimeout(() => {}, 30000)', 'old'))
  r.start('ada', run('setTimeout(() => {}, 30000)', 'new'))
  await until(() => events.some(([, , tag]) => tag === 'old'), 8000, () => JSON.stringify(events))
  await up('a terminal replaced')
  assert.ok(r.running('ada'))
  assert.ok(!events.some(([kind, name]) => kind === 'exit' && name === 'ada'))
})

test('one that ends while Crew is away is gone the next time, and quitting the host ends everything', async () => {
  last.start('abe', run('setTimeout(() => {}, 300)', 'run3'))
  await until(() => last.pid('abe') > 0)
  last.detach()
  await until(() => !alive(last.pid('abe')))
  // node-pty says a Windows terminal ended a second after it did, once its output is drained
  await new Promise((r) => setTimeout(r, process.platform === 'win32' ? 2500 : 300))
  const next = new HostRunner({ runtime: node })
  last = next
  const survivors = await next.connect()
  assert.deepEqual(survivors.map((s) => s.name), ['ada'])
  assert.deepEqual(next.gone.map(({ name, tag }) => [name, tag]), [['abe', 'run3']])
  const ada = next.pid('ada')
  next.quit()
  await until(() => !fs.existsSync(ADDRESS))
  assert.ok(await gone(ada))
  last = null
})

test('the host runs from a copy of what it needs', async () => {
  const into = path.join(process.env.CREW_HOME, 'run', 'runtime')
  // Windows' Node is one program, as Crew.exe is with the DLLs beside it. Elsewhere Node may need libraries next to
  // where it's installed, so the copy gets a stand-in that runs it.
  let file = process.execPath
  if (process.platform !== 'win32') {
    file = path.join(fs.mkdtempSync(path.join(tmp, 'crew-node-')), 'node')
    fs.writeFileSync(file, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 })
  }
  const r = new HostRunner({ runtime: { file, env: {}, stage: true, into } })
  last = r
  await r.connect()
  assert.ok(r.started.staged, 'it started from the copy')
  const [version] = fs.readdirSync(into)
  const home = path.join(into, version)
  for (const f of ['crew-host.exe', 'app/ptyhost.js', 'app/package.json', 'app/node_modules/node-pty/package.json', 'app/node_modules/node-pty/lib/index.js', '.complete']) {
    assert.ok(fs.existsSync(path.join(home, f)), f)
  }
  const seen = output(r)
  r.start('noor', run("console.log('from the copy')", 'run4'))
  await until(() => seen.get('noor')?.includes('from the copy'))
  r.quit()
  await until(() => !fs.existsSync(ADDRESS))
  last = null
})

test("a program named without its folder is found on the agent's PATH, whatever its environment calls it (Windows: Path)", () => {
  const r = new HostRunner({ runtime: node })
  const sent = []
  r.sock = { write: (line) => sent.push(JSON.parse(line)) }
  r.start('ada', { file: 'node', args: [], cwd: tmp, env: { [process.platform === 'win32' ? 'Path' : 'PATH']: path.dirname(process.execPath) }, tag: 'run5' })
  assert.equal(sent[0].t, 'start')
  assert.equal(sent[0].file.toLowerCase(), process.execPath.toLowerCase())
})

test('a terminal whose program ends by itself leaves nothing behind that keeps its process up', () => {
  // as the terminal host and Crew's own runner hold terminals: on Windows node-pty kept the pseudoconsole and its
  // reading thread until a kill, so the process could never end by itself
  const runner = new URL('../core/runner.js', import.meta.url).href
  const script = `
    const { Runner } = await import(${JSON.stringify(runner)})
    const r = new Runner()
    r.on('exit', (name, code) => console.log('exited', code))
    r.start('a', { file: process.execPath, args: ['-e', 'console.log(1)'], cwd: process.cwd(), env: {}, tag: 't' })`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60000, windowsHide: true })
  assert.match(out, /exited 0/)
})

// ---- the parts that differ on Windows, checked on any computer ----------------------------------------------

test('on Windows the host listens on a pipe nobody can guess, a new one each time', () => {
  const a = pipeName()
  assert.match(a, /^\\\\\.\\pipe\\crew-pty-[0-9a-f]{32}$/)
  assert.notEqual(pipeName(), a)
  assert.equal(path.basename(PIPE), 'pty.pipe')
  assert.equal(path.dirname(PIPE), path.join(process.env.CREW_HOME, 'run'), "it's said in CREW_HOME, so each Crew home has its own")
})

test('the host knows it was run, from a folder with spaces in its name, or a Windows path in another case', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'crew host '))
  const file = path.join(dir, 'ptyhost.js')
  fs.writeFileSync(file, '')
  assert.ok(isMain(file, file))
  assert.ok(new URL(`file://${file}`).pathname !== file, 'a file URL spells the spaces differently')
  assert.ok(!isMain(path.join(dir, 'other.js'), file))
  assert.ok(isMain('C:\\Program Files\\Crew\\Core\\PtyHost.js', 'c:\\program files\\crew\\core\\ptyhost.js', true))
  assert.ok(!isMain('C:\\Program Files\\Crew\\Core\\PtyHost.js', 'c:\\program files\\crew\\core\\ptyhost.js', false))
  assert.ok(!isMain(undefined, file))
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
})

test("the host's log starts afresh once it's big, keeping the one before", () => {
  const file = path.join(fs.mkdtempSync(path.join(tmp, 'crew-log-')), 'ptyhost.log')
  fs.writeFileSync(file, 'x'.repeat(50))
  rotate(file, 100)
  assert.ok(fs.existsSync(file) && !fs.existsSync(`${file}.1`), 'small: left alone')
  fs.writeFileSync(file, 'y'.repeat(150))
  rotate(file, 100)
  assert.ok(!fs.existsSync(file))
  assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), 'y'.repeat(150))
  rotate(path.join(tmp, 'no-such-crew-log'), 100) // nothing there: nothing to do
  assert.equal(path.basename(LOG), 'ptyhost.log')
})

test("the copy has the runtime's program, DLLs and data, and only this computer's part of node-pty; old copies go once nothing runs from them", async () => {
  const root = fs.mkdtempSync(path.join(tmp, 'crew-stage-'))
  const put = (f, text = f) => (fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }), fs.writeFileSync(path.join(root, f), text))
  for (const f of ['rt/Crew.exe', 'rt/ffmpeg.dll', 'rt/icudtl.dat', 'rt/v8_context_snapshot.bin', 'rt/resources.pak', 'rt/vk_swiftshader_icd.json', 'rt/LICENSES.chromium.html', 'rt/Uninstall Crew.exe', 'rt/locales/en-US.pak', 'rt/resources/app.asar']) put(f)
  put('host.js', '// the host')
  const here = `prebuilds/${process.platform}-${process.arch}`
  for (const f of ['package.json', 'lib/index.js', 'lib/worker/conoutSocketWorker.js', 'lib/index.test.js', 'lib/index.js.map', `${here}/pty.node`, `${here}/pty.pdb`, `${here}/conpty/OpenConsole.exe`, 'prebuilds/sunos-sparc/pty.node', 'build/Release/pty.node', 'src/pty.cc']) put(`pty/${f}`)
  fs.chmodSync(path.join(root, `pty/${here}/pty.node`), 0o755)
  const into = path.join(root, 'runtime')
  const busy = new Set()
  const args = { exe: path.join(root, 'rt/Crew.exe'), script: path.join(root, 'host.js'), pty: path.join(root, 'pty'), into, busy: async (d) => busy.has(path.basename(d)) }

  const first = await stage(args)
  const home = path.dirname(first.file)
  const has = (f) => fs.existsSync(path.join(home, f))
  assert.equal(path.basename(first.file), 'crew-host.exe', 'not Crew.exe: the installer stops whatever runs as that')
  assert.equal(fs.readFileSync(first.file, 'utf8'), 'rt/Crew.exe')
  assert.equal(first.script, path.join(home, 'app', 'ptyhost.js'))
  assert.equal(fs.readFileSync(first.script, 'utf8'), '// the host')
  for (const f of ['ffmpeg.dll', 'icudtl.dat', 'v8_context_snapshot.bin', 'resources.pak', 'vk_swiftshader_icd.json', 'app/package.json']) assert.ok(has(f), f)
  for (const f of ['locales', 'resources', 'Crew.exe', 'Uninstall Crew.exe', 'LICENSES.chromium.html']) assert.ok(!has(f), `${f} isn't needed`)
  const pty = (f) => has(`app/node_modules/node-pty/${f}`)
  for (const f of ['package.json', 'lib/index.js', 'lib/worker/conoutSocketWorker.js', `${here}/pty.node`, `${here}/conpty/OpenConsole.exe`, 'build/Release/pty.node']) assert.ok(pty(f), f)
  for (const f of ['lib/index.test.js', 'lib/index.js.map', `${here}/pty.pdb`, 'prebuilds/sunos-sparc', 'src']) assert.ok(!pty(f), `${f} isn't needed`)
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, `app/node_modules/node-pty/${here}/pty.node`)).mode & 0o111, 0o111, 'what runs keeps running')

  // the next start: the same copy, as it was
  const before = fs.statSync(first.file).mtimeMs
  assert.deepEqual(await stage(args), first)
  assert.equal(fs.statSync(first.file).mtimeMs, before)

  // a new version: a new copy, and the old one stays while a host runs from it
  busy.add(path.basename(home))
  await new Promise((r) => setTimeout(r, 20))
  put('rt/Crew.exe', 'rt/Crew.exe, newer')
  const second = await stage(args)
  assert.notEqual(path.dirname(second.file), home)
  assert.equal(fs.readFileSync(second.file, 'utf8'), 'rt/Crew.exe, newer')
  assert.ok(fs.existsSync(home), 'its host is still running')
  busy.clear()
  await stage(args)
  assert.ok(!fs.existsSync(home), 'gone once nothing runs from it')
  assert.deepEqual(fs.readdirSync(into), [path.basename(path.dirname(second.file))])
  // a copy that didn't start (connect marks it) isn't tried again: the host runs from where Crew is
  fs.writeFileSync(path.join(path.dirname(second.file), '.broken'), '')
  await assert.rejects(stage(args), /didn't start before/)
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 })
})

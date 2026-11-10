// The Runner for agents that outlive CLIque: the same as core/runner.js to the hub, but the terminals live in the terminal
// host (core/ptyhost.js), a process of their own, started the first time it's needed. Quitting CLIque just lets go of
// them (detach); the next CLIque to connect finds them still running (survivors) and picks them up where they are.
// Keeps a copy of each terminal's state here (what it printed, when, its size), so running(), quietFor() and buffer()
// answer straight away, as the hub expects.
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { which, cleanEnv, TITLE_ONLY } from './runner.js'
import { pathKey } from './launch.js'
import { PROTOCOL, RUN, LOG, address } from './ptyhost.js'

const SCROLLBACK = 256 * 1024
// In an installed CLIque the host and node-pty are unpacked next to app.asar (electron-builder.config.mjs asarUnpack):
// the host runs from there as plain Node, and on Windows they're copied from there (stage).
const unpacked = (file) => file.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
const HOST = unpacked(fileURLToPath(new URL('./ptyhost.js', import.meta.url)))
const LOG_KEEP = 1024 * 1024 // past this the log starts afresh, and the one before is kept as ptyhost.log.1
// Where the host runs from on Windows: a copy per version (stage).
export const RUNTIMES = path.join(RUN, 'runtime')

export class HostRunner extends EventEmitter {
  procs = new Map() // name -> { pid, tag, chunks, size, startedAt, lastOutput, cols, rows }
  survivors = [] // what was already running when CLIque connected: [{ name, tag, pid }]
  sock = null
  outbox = [] // what to send once connected
  stopping = new Map() // name -> resolve, for stop()'s promise

  // runtime: how to run the host as Node ({ file, env }); CLIque passes its own Electron binary in Node mode. stage:
  // whether it runs from a copy (see stage(); into: where), by default when that binary is a packaged CLIque on Windows.
  constructor({ runtime } = {}) {
    super()
    this.runtime = runtime ?? { file: process.execPath, env: {} }
  }

  // Connects, starting the host if there's none, and resolves once it's said what's running.
  async connect() {
    let line = await dial().catch(() => null)
    if (!line) {
      // from the copy if there is one, and from where CLIque is if the copy won't start (a policy that keeps programs
      // out of your own folders, say)
      for (const runtime of await this.runtimes()) {
        this.spawnHost(runtime)
        // a program copied anew gets a look from antivirus before it first runs, which can take a while
        for (let i = 0; i < (runtime.staged ? 200 : 50) && !line; i++) {
          await new Promise((r) => setTimeout(r, 100))
          line = await dial().catch(() => null)
        }
        if (line) {
          this.started = runtime // what the host CLIque started runs from
          break
        }
        // next time straight to where CLIque is, without the wait
        if (runtime.staged) {
          note(`terminal host: the copy in ${path.dirname(runtime.file)} didn't start, so it runs from CLIque's folder`)
          fs.writeFileSync(path.join(path.dirname(runtime.file), '.broken'), '')
        }
      }
      if (!line) throw new Error(`couldn't start the terminal host (see ${LOG})`)
    }
    const hello = await this.greet(line.sock, line.token)
    if (hello.protocol !== PROTOCOL) {
      // a host from another CLIque version: its terminals go (the agents resume their conversations), and a new one starts
      line.sock.write(JSON.stringify({ t: 'quit' }) + '\n')
      line.sock.destroy()
      await new Promise((r) => setTimeout(r, 800))
      this.replaced = hello.procs.length
      return this.connect()
    }
    this.attach(line.sock)
    this.hostPid = hello.pid
    for (const x of hello.procs) {
      this.procs.set(x.name, { pid: x.pid, tag: x.tag, chunks: x.data ? [x.data] : [], size: x.data?.length ?? 0, startedAt: x.startedAt, lastOutput: x.lastOutput, cols: x.cols, rows: x.rows })
    }
    this.survivors = hello.procs.map(({ name, tag, pid }) => ({ name, tag, pid }))
    this.gone = hello.gone ?? []
    return this.survivors
  }

  // How to run the host, in the order to try: [{ file, env, script, staged }].
  async runtimes() {
    const direct = { file: this.runtime.file, env: this.runtime.env ?? {}, script: HOST }
    const packaged = process.platform === 'win32' && Boolean(process.versions.electron) && !process.defaultApp
    if (!(this.runtime.stage ?? packaged)) return [direct]
    try {
      const pty = unpacked(path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')))
      const copy = await stage({ exe: direct.file, script: HOST, pty, into: this.runtime.into ?? RUNTIMES })
      return [{ ...direct, ...copy, staged: true }, direct]
    } catch (e) {
      note(`terminal host: couldn't copy it out of CLIque's folder (${e.message}), so it runs from there`)
      return [direct]
    }
  }

  spawnHost({ file, env, script }) {
    fs.mkdirSync(RUN, { recursive: true, mode: 0o700 })
    rotate(LOG)
    const log = fs.openSync(LOG, 'a')
    // detached: on Windows that also keeps it out of the job that ends what CLIque started once CLIque goes.
    // windowsHide: a console program (Node, in the tests) would get a console window of its own otherwise.
    const p = spawn(file, [script], {
      detached: true, windowsHide: true, stdio: ['ignore', log, log], cwd: RUN,
      env: { ...process.env, ...env },
    })
    p.on('error', (e) => note(`terminal host: ${e.message}`))
    p.unref()
    fs.closeSync(log)
  }

  greet(sock, token) {
    return new Promise((resolve, reject) => {
      let buf = ''
      const onData = (chunk) => {
        buf += chunk
        const nl = buf.indexOf('\n')
        if (nl < 0) return
        sock.off('data', onData)
        sock.off('close', onClose)
        const rest = buf.slice(nl + 1)
        try {
          const m = JSON.parse(buf.slice(0, nl))
          if (rest) sock.unshift(rest)
          resolve(m)
        } catch (e) {
          reject(e)
        }
      }
      const onClose = () => reject(new Error('the terminal host turned CLIque away'))
      sock.setEncoding('utf8')
      sock.on('data', onData)
      sock.on('close', onClose)
      sock.write(JSON.stringify({ t: 'hello', token, protocol: PROTOCOL }) + '\n')
    })
  }

  attach(sock) {
    this.sock = sock
    let buf = ''
    sock.on('data', (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        try {
          this.receive(JSON.parse(line))
        } catch {}
      }
    })
    sock.on('error', (e) => note(`terminal host: the connection to it failed (${e.message})`))
    sock.on('close', () => {
      if (this.sock !== sock) return
      this.sock = null
      if (this.detached) return
      // the host is gone, and its terminals with it
      note('terminal host: the connection to it closed, so its terminals count as gone')
      for (const [name, x] of [...this.procs]) {
        this.procs.delete(name)
        this.emit('ended', name, x.tag)
        this.emit('exit', name, -1, Date.now() - x.startedAt)
      }
    })
    for (const m of this.outbox.splice(0)) this.send(m)
  }

  receive(m) {
    const x = this.procs.get(m.name)
    if (m.t === 'data') {
      if (!x) return
      if (!TITLE_ONLY.test(m.data)) x.lastOutput = Date.now()
      x.chunks.push(m.data)
      x.size += m.data.length
      if (x.size > SCROLLBACK * 1.5) trim(x)
      this.emit('data', m.name, m.data)
    } else if (m.t === 'started') {
      if (x && x.tag === m.tag) x.pid = m.pid
    } else if (m.t === 'exit') {
      this.emit('ended', m.name, m.tag)
      this.stopping.get(`${m.name}:${m.tag}`)?.()
      // a deliberate stop already let go of it, and a replaced one isn't this one
      if (!x || x.tag !== m.tag) return
      this.procs.delete(m.name)
      this.emit('exit', m.name, m.code, m.ms)
    }
  }

  send(m) {
    if (!this.sock) {
      this.outbox.push(m)
      if (!this.connecting) this.connecting = this.connect().catch(() => {}).finally(() => (this.connecting = null))
      return
    }
    this.sock.write(JSON.stringify(m) + '\n')
  }

  start(name, { file, args, cwd, env, tag }) {
    this.stop(name)
    const fullEnv = cleanEnv({ ...process.env, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' })
    this.procs.set(name, { pid: undefined, tag, chunks: [], size: 0, startedAt: Date.now(), lastOutput: Date.now(), cols: 120, rows: 36 })
    // looked up as core/runner.js does: under whatever name the environment gives PATH (Windows': Path)
    this.send({ t: 'start', name, file: which(file, fullEnv[pathKey(fullEnv)]), args, cwd, env: fullEnv, cols: 120, rows: 36, tag })
  }

  // Letting go of it first means a deliberate stop never emits 'exit' (as in core/runner.js). Resolves once it's gone,
  // or after 3 s.
  stop(name) {
    const x = this.procs.get(name)
    if (!x) return Promise.resolve()
    this.procs.delete(name)
    const gone = new Promise((resolve) => {
      const key = `${name}:${x.tag}`
      const done = () => (this.stopping.delete(key), clearTimeout(t), resolve())
      const t = setTimeout(done, 3000)
      this.stopping.set(key, done)
    })
    this.send({ t: 'stop', name })
    return gone
  }

  stopAll() {
    for (const name of [...this.procs.keys()]) this.stop(name)
  }

  // CLIque is quitting and the agents stay: lets go of the host without stopping anything.
  detach() {
    this.detached = true
    this.sock?.end()
  }

  // "Stop agents and quit": the host stops every terminal and goes.
  quit() {
    this.detached = true
    this.procs.clear()
    if (this.sock) this.sock.end(JSON.stringify({ t: 'quit' }) + '\n')
  }

  running(name) {
    return this.procs.has(name)
  }

  pid(name) {
    return this.procs.get(name)?.pid
  }

  write(name, data) {
    if (this.procs.has(name)) this.send({ t: 'write', name, data })
  }

  quietFor(name) {
    const x = this.procs.get(name)
    return x ? Date.now() - x.lastOutput : 0
  }

  // As core/runner.js: a bracketed paste, then Enter on its own.
  submit(name, text) {
    if (!this.procs.has(name)) return
    this.write(name, `\x1b[200~${text}\x1b[201~`)
    setTimeout(() => this.write(name, '\r'), 150)
  }

  resize(name, cols, rows) {
    const x = this.procs.get(name)
    if (!x || !(cols > 0 && rows > 0) || (x.cols === cols && x.rows === rows)) return
    Object.assign(x, { cols, rows })
    this.send({ t: 'resize', name, cols, rows })
  }

  buffer(name) {
    const x = this.procs.get(name)
    if (!x) return { data: '', cols: 120, rows: 36 }
    trim(x)
    return { data: x.chunks[0] ?? '', cols: x.cols, rows: x.rows }
  }
}

// A line to the host, and the token it wants: { sock, token }.
function dial() {
  return new Promise((resolve, reject) => {
    const where = address()
    if (!where) return reject(new Error('no terminal host has said where it is'))
    const sock = net.connect(where.path)
    sock.once('connect', () => resolve({ sock, token: where.token }))
    sock.once('error', reject)
  })
}

// A line in the host's log, from this side of it. The host holds the log open while it runs, so it can't start afresh
// then (rotate): past `max` this side's lines aren't kept.
export function note(line, file = LOG, max = 2 * LOG_KEEP) {
  try {
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > max) return
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {}
}

// The log, kept small: past `keep` bytes it becomes .1 (instead of the one before) and a new one starts.
export function rotate(file, keep = LOG_KEEP) {
  try {
    if (fs.statSync(file).size > keep) fs.renameSync(file, `${file}.1`)
  } catch {}
}

// Windows won't replace a program's files while it runs, and an update replaces CLIque's. A host running from CLIque's
// folder would have to stop for an update, every agent with it (the installer stops whatever runs as CLIque.exe there
// anyway). So on Windows it runs from a copy of what it needs, made once per version, in `into` (RUNTIMES):
//   <version>/clique-host.exe      CLIque's own binary (Electron, run as Node), with the DLLs and data files beside it
//   <version>/app/ptyhost.js     this host, with node-pty in app/node_modules
// Copies no host runs from any more are removed. Windows won't remove a running program's file, which is how `busy`
// tells by default. Files inside CLIque's app.asar are read the way Electron reads them. A copy that didn't start once
// (connect marks it .broken) isn't tried again. -> { file, script }
export async function stage({ exe, script, pty, into, busy = running }) {
  const fsp = fs.promises
  // what Electron loads beside its program; not locales/ and resources/, which only windows need
  const beside = (await fsp.readdir(path.dirname(exe))).filter((f) => /\.(dll|dat|bin|pak|json)$/i.test(f)).sort()
  const { size, mtimeMs } = await fsp.stat(exe)
  const version = crypto.createHash('sha256')
    .update(JSON.stringify([size, mtimeMs, beside, process.arch]))
    .update(await fsp.readFile(path.join(pty, 'package.json')))
    .update(await fsp.readFile(script))
    .digest('hex').slice(0, 16)
  const home = path.join(into, version)
  const out = { file: path.join(home, 'clique-host.exe'), script: path.join(home, 'app', 'ptyhost.js') }
  if (fs.existsSync(path.join(home, '.broken'))) throw new Error("the copy didn't start before")
  await fsp.mkdir(into, { recursive: true })
  if (!fs.existsSync(path.join(home, '.complete'))) {
    // copied aside first and moved into place whole, so a copy cut short is never run
    const tmp = path.join(into, `.${version}-${process.pid}-${Date.now()}`)
    await fsp.mkdir(path.join(tmp, 'app'), { recursive: true })
    await fsp.copyFile(exe, path.join(tmp, 'clique-host.exe'))
    for (const f of beside) await fsp.copyFile(path.join(path.dirname(exe), f), path.join(tmp, f))
    await fsp.writeFile(path.join(tmp, 'app', 'ptyhost.js'), await fsp.readFile(script))
    await fsp.writeFile(path.join(tmp, 'app', 'package.json'), '{ "type": "module" }\n')
    // node-pty: its code, and the native part for this computer, built or prebuilt
    const parts = ['lib', 'build/Release', `prebuilds/${process.platform}-${process.arch}`]
    const wanted = (rel, dir) => dir
      ? parts.some((p) => rel === p || rel.startsWith(`${p}/`) || p.startsWith(`${rel}/`))
      : rel === 'package.json' || (parts.some((p) => rel.startsWith(`${p}/`)) && !/(\.map|\.pdb|\.test\.js)$/.test(rel))
    await copyTree(pty, path.join(tmp, 'app', 'node_modules', 'node-pty'), wanted)
    await fsp.writeFile(path.join(tmp, '.complete'), '')
    await fsp.rm(home, { recursive: true, force: true }).catch(() => {})
    await fsp.rename(tmp, home).catch(async (e) => {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {})
      if (!fs.existsSync(path.join(home, '.complete'))) throw e // made meanwhile by another CLIque is just as good
    })
  }
  for (const name of await fsp.readdir(into)) {
    const dir = path.join(into, name)
    if (name === version) continue
    if (name.startsWith('.')) {
      // a copy cut short, unless it's another CLIque's still under way
      if (Date.now() - (await fsp.stat(dir)).mtimeMs > 3600e3) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    } else if (!(await busy(dir))) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
  return out
}

// Does a host run from this copy? On Windows its program can't be removed while it runs.
async function running(dir) {
  try {
    await fs.promises.unlink(path.join(dir, 'clique-host.exe'))
    return false
  } catch (e) {
    return e.code !== 'ENOENT'
  }
}

// Copies what `wanted(relativePath, isDirectory)` says of src into dst, through readFile and writeFile, which Electron
// serves from inside app.asar too, keeping what's a program a program.
async function copyTree(src, dst, wanted, rel = '') {
  const fsp = fs.promises
  for (const name of await fsp.readdir(path.join(src, rel))) {
    const r = rel ? `${rel}/${name}` : name
    const stat = await fsp.stat(path.join(src, r))
    if (!wanted(r, stat.isDirectory())) continue
    if (stat.isDirectory()) await copyTree(src, dst, wanted, r)
    else {
      await fsp.mkdir(path.join(dst, rel), { recursive: true })
      await fsp.writeFile(path.join(dst, r), await fsp.readFile(path.join(src, r)), { mode: stat.mode & 0o777 })
    }
  }
}

function trim(x) {
  if (x.chunks.length <= 1 && x.size <= SCROLLBACK) return
  const all = x.chunks.join('').slice(-SCROLLBACK)
  x.chunks = [all]
  x.size = all.length
}

// The Runner for agents that outlive Crew: the same as core/runner.js to the hub, but the terminals live in the terminal
// host (core/ptyhost.js), a process of their own, started the first time it's needed. Quitting Crew just lets go of
// them (detach); the next Crew to connect finds them still running (survivors) and picks them up where they are.
// Keeps a copy of each terminal's state here (what it printed, when, its size), so running(), quietFor() and buffer()
// answer straight away, as the hub expects.
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { which, cleanEnv, TITLE_ONLY } from './runner.js'
import { PROTOCOL, RUN, SOCKET, TOKEN } from './ptyhost.js'

const SCROLLBACK = 256 * 1024
const HOST = fileURLToPath(new URL('./ptyhost.js', import.meta.url))

export class HostRunner extends EventEmitter {
  procs = new Map() // name -> { pid, tag, chunks, size, startedAt, lastOutput, cols, rows }
  survivors = [] // what was already running when Crew connected: [{ name, tag, pid }]
  sock = null
  outbox = [] // what to send once connected
  stopping = new Map() // name -> resolve, for stop()'s promise

  // runtime: how to run the host as Node ({ file, env }); Crew passes its own Electron binary in Node mode.
  constructor({ runtime } = {}) {
    super()
    this.runtime = runtime ?? { file: process.execPath, env: {} }
  }

  // Connects, starting the host if there's none, and resolves once it's said what's running.
  async connect() {
    let sock = await dial().catch(() => null)
    if (!sock) {
      this.spawnHost()
      for (let i = 0; i < 50 && !sock; i++) {
        await new Promise((r) => setTimeout(r, 100))
        sock = await dial().catch(() => null)
      }
      if (!sock) throw new Error("couldn't start the terminal host (see ~/.crew/run/ptyhost.log)")
    }
    const hello = await this.greet(sock)
    if (hello.protocol !== PROTOCOL) {
      // a host from another Crew version: its terminals go (the agents resume their conversations), and a new one starts
      sock.write(JSON.stringify({ t: 'quit' }) + '\n')
      sock.destroy()
      await new Promise((r) => setTimeout(r, 800))
      this.replaced = hello.procs.length
      return this.connect()
    }
    this.attach(sock)
    for (const x of hello.procs) {
      this.procs.set(x.name, { pid: x.pid, tag: x.tag, chunks: x.data ? [x.data] : [], size: x.data?.length ?? 0, startedAt: x.startedAt, lastOutput: x.lastOutput, cols: x.cols, rows: x.rows })
    }
    this.survivors = hello.procs.map(({ name, tag, pid }) => ({ name, tag, pid }))
    this.gone = hello.gone ?? []
    return this.survivors
  }

  spawnHost() {
    fs.mkdirSync(RUN, { recursive: true, mode: 0o700 })
    const log = fs.openSync(path.join(RUN, 'ptyhost.log'), 'a')
    const p = spawn(this.runtime.file, [HOST], {
      detached: true, stdio: ['ignore', log, log], cwd: RUN,
      env: { ...process.env, ...this.runtime.env },
    })
    p.unref()
    fs.closeSync(log)
  }

  greet(sock) {
    return new Promise((resolve, reject) => {
      let token = ''
      try {
        token = fs.readFileSync(TOKEN, 'utf8').trim()
      } catch {}
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
      const onClose = () => reject(new Error('the terminal host turned Crew away'))
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
    sock.on('close', () => {
      if (this.sock !== sock) return
      this.sock = null
      if (this.detached) return
      // the host is gone, and its terminals with it
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
    this.send({ t: 'start', name, file: which(file, fullEnv.PATH), args, cwd, env: fullEnv, cols: 120, rows: 36, tag })
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

  // Crew is quitting and the agents stay: lets go of the host without stopping anything.
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

function dial() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET)
    sock.once('connect', () => resolve(sock))
    sock.once('error', reject)
  })
}

function trim(x) {
  if (x.chunks.length <= 1 && x.size <= SCROLLBACK) return
  const all = x.chunks.join('').slice(-SCROLLBACK)
  x.chunks = [all]
  x.size = all.length
}

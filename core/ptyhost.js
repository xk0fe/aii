// The terminal host: a small process of its own that owns the agents' pseudo-terminals, so they keep working while
// Crew quits, crashes or relaunches with new code. Crew connects over a Unix socket in CREW_HOME/run (core/ptyclient.js),
// starts and stops terminals, types into them and gets their output; while nobody is connected the terminals carry on and
// their output is kept, so whoever connects next can redraw them. It knows nothing about agents, and changes rarely:
// once it's running, newer Crews keep using it. It quits once it has no terminals and nobody has connected for a minute.
//
//   node core/ptyhost.js            (Crew runs it with its own Electron binary, as Node: ELECTRON_RUN_AS_NODE=1)
//
// Messages are JSON, one per line. In: hello { token, protocol }, start { name, file, args, cwd, env, cols, rows, tag },
// stop { name }, write { name, data }, resize { name, cols, rows }, quit. Out: hello { protocol, pid, procs, gone },
// data { name, data }, exit { name, tag, code, ms }, error { message }.
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import pty from 'node-pty'

export const PROTOCOL = 1
const HOME = process.env.CREW_HOME || path.join(os.homedir(), '.crew')
export const RUN = path.join(HOME, 'run')
export const SOCKET = path.join(RUN, 'pty.sock')
export const TOKEN = path.join(RUN, 'pty.token')
const SCROLLBACK = 256 * 1024 // as much as core/runner.js keeps
const IDLE = 60000

const procs = new Map() // name -> { p, tag, chunks, size, startedAt, lastOutput, cols, rows }
const gone = [] // terminals that ended while nobody was connected: { name, tag, code, ms }
let client = null
let idleTimer = null

function main() {
  fs.mkdirSync(RUN, { recursive: true, mode: 0o700 })
  fs.chmodSync(RUN, 0o700) // the socket's folder is yours alone
  const token = crypto.randomBytes(24).toString('hex')
  const server = net.createServer((sock) => welcome(sock, token))
  server.on('error', (e) => {
    console.error(`terminal host: ${e.message}`)
    process.exit(1)
  })
  // A socket file left by a host that died is in the way; one that answers belongs to a host that's alive.
  const listen = () => server.listen(SOCKET, () => {
    fs.chmodSync(SOCKET, 0o600)
    fs.writeFileSync(TOKEN, token, { mode: 0o600 })
    console.log(`terminal host ${process.pid} listening`)
    idle()
  })
  const probe = net.connect(SOCKET)
  probe.on('connect', () => {
    probe.destroy()
    console.error('terminal host: another one is running')
    process.exit(0)
  })
  probe.on('error', () => {
    fs.rmSync(SOCKET, { force: true })
    listen()
  })
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => quit())
}

function welcome(sock, token) {
  let buf = ''
  let ok = false
  sock.setEncoding('utf8')
  sock.on('data', (chunk) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      let m
      try {
        m = JSON.parse(line)
      } catch {
        continue
      }
      if (!ok) {
        if (m.t !== 'hello' || m.token !== token) return sock.destroy()
        ok = true
        // one Crew at a time: a newer one takes over
        if (client && client !== sock) client.destroy()
        client = sock
        clearTimeout(idleTimer)
        const list = [...procs].map(([name, x]) => ({ name, tag: x.tag, pid: x.p.pid, cols: x.cols, rows: x.rows, startedAt: x.startedAt, lastOutput: x.lastOutput, data: scrollback(x) }))
        send({ t: 'hello', protocol: PROTOCOL, pid: process.pid, procs: list, gone: gone.splice(0) })
        continue
      }
      handle(m)
    }
  })
  sock.on('error', () => {})
  sock.on('close', () => {
    if (client !== sock) return
    client = null
    idle()
  })
}

function handle(m) {
  const x = procs.get(m.name)
  switch (m.t) {
    case 'start':
      return start(m)
    case 'stop':
      return x?.p.kill()
    case 'write':
      return x?.p.write(String(m.data))
    case 'resize':
      if (x && m.cols > 0 && m.rows > 0 && (x.cols !== m.cols || x.rows !== m.rows)) {
        Object.assign(x, { cols: m.cols, rows: m.rows })
        x.p.resize(m.cols, m.rows)
      }
      return
    case 'quit':
      return quit()
  }
}

function start({ name, file, args = [], cwd, env = {}, cols = 120, rows = 36, tag }) {
  procs.get(name)?.p.kill() // a terminal by this name is replaced; its exit still comes, with its own tag
  let p
  try {
    p = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env })
  } catch (e) {
    return send({ t: 'exit', name, tag, code: -1, ms: 0, error: e.message })
  }
  const x = { p, tag, chunks: [], size: 0, startedAt: Date.now(), lastOutput: Date.now(), cols, rows }
  procs.set(name, x)
  p.onData((d) => {
    x.lastOutput = Date.now()
    x.chunks.push(d)
    x.size += d.length
    if (x.size > SCROLLBACK * 1.5) scrollback(x)
    send({ t: 'data', name, data: d })
  })
  p.onExit(({ exitCode }) => {
    if (procs.get(name) === x) procs.delete(name)
    const e = { name, tag, code: exitCode, ms: Date.now() - x.startedAt }
    if (client) send({ t: 'exit', ...e })
    else gone.push(e)
    idle()
  })
  send({ t: 'started', name, tag, pid: p.pid })
}

// The last SCROLLBACK characters, as one chunk.
function scrollback(x) {
  if (x.chunks.length > 1 || x.size > SCROLLBACK) {
    const all = x.chunks.join('').slice(-SCROLLBACK)
    x.chunks = [all]
    x.size = all.length
  }
  return x.chunks[0] ?? ''
}

function send(m) {
  if (client && !client.destroyed) client.write(JSON.stringify(m) + '\n')
}

// Nothing to keep and nobody here: go after a while, in case Crew is just relaunching.
function idle() {
  clearTimeout(idleTimer)
  if (procs.size || client) return
  idleTimer = setTimeout(() => quit(), IDLE)
}

function quit() {
  for (const x of procs.values()) x.p.kill()
  fs.rmSync(SOCKET, { force: true })
  // a moment for the terminals' processes to take the hint
  setTimeout(() => process.exit(0), procs.size ? 500 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main()

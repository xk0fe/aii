// The terminal host: a small process of its own that owns the agents' pseudo-terminals, so they keep working while
// Crew quits, crashes or relaunches with new code. Crew connects over a Unix socket in CREW_HOME/run (core/ptyclient.js),
// or a named pipe on Windows, starts and stops terminals, types into them and gets their output; while nobody is
// connected the terminals carry on and their output is kept, so whoever connects next can redraw them. It knows nothing
// about agents, and changes rarely: once it's running, newer Crews keep using it. It quits once it has no terminals and
// nobody has connected for a minute.
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
import { fileURLToPath } from 'node:url'
import pty from 'node-pty'

export const PROTOCOL = 1
const WIN = process.platform === 'win32'
const HOME = process.env.CREW_HOME || path.join(os.homedir(), '.crew')
export const RUN = path.join(HOME, 'run')
export const SOCKET = path.join(RUN, 'pty.sock')
export const TOKEN = path.join(RUN, 'pty.token')
// Windows has no Unix sockets here: the host listens on a named pipe, and says which in this file, with its token.
// The pipe is named afresh each time a host starts, so nobody else on the computer can take the name first and be
// the one Crew tells everything to; the file is in your own folder, where only you can write.
export const PIPE = path.join(RUN, 'pty.pipe')
// There while a host is listening.
export const ADDRESS = WIN ? PIPE : SOCKET
export const LOG = path.join(RUN, 'ptyhost.log')
const LOG_CAP = 1024 * 1024 // the host's own lines stop there; Crew starts the log afresh before it starts a host
const SCROLLBACK = 256 * 1024 // as much as core/runner.js keeps
const IDLE = 60000

// Where the host is and what it wants to hear: { path, token }, or null when no host has said.
export function address() {
  if (!WIN) {
    let token = ''
    try {
      token = fs.readFileSync(TOKEN, 'utf8').trim()
    } catch {}
    return { path: SOCKET, token }
  }
  try {
    const { pipe, token } = JSON.parse(fs.readFileSync(PIPE, 'utf8'))
    return typeof pipe === 'string' && pipe.startsWith('\\\\.\\pipe\\') ? { path: pipe, token: String(token ?? '') } : null
  } catch {
    return null
  }
}

// A named pipe nobody can guess: \\.\pipe\crew-pty-<32 hex digits>.
export const pipeName = (bytes = crypto.randomBytes(16)) => `\\\\.\\pipe\\crew-pty-${bytes.toString('hex')}`

const procs = new Map() // name -> { p, tag, chunks, size, startedAt, lastOutput, cols, rows }
const gone = [] // terminals that ended while nobody was connected: { name, tag, code, ms }
let client = null
let idleTimer = null
let here = null // where this host listens
let logged = 0

function log(line, error) {
  if (logged > LOG_CAP) return
  const text = `${new Date().toISOString()} ${line}\n`
  logged += text.length
  ;(error ? process.stderr : process.stdout).write(logged > LOG_CAP ? `${text}(the log is full, the rest isn't kept)\n` : text)
}

function main() {
  fs.mkdirSync(RUN, { recursive: true, mode: 0o700 })
  fs.chmodSync(RUN, 0o700) // the socket's folder is yours alone
  const token = crypto.randomBytes(24).toString('hex')
  const server = net.createServer((sock) => welcome(sock, token))
  server.on('error', (e) => {
    log(`terminal host: ${e.message}`, true)
    process.exit(1)
  })
  here = WIN ? pipeName() : SOCKET
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => quit(signal))
  // why it went, in its log: nothing there after "listening" means it crashed outside JavaScript
  process.on('exit', (code) => log(`terminal host ${process.pid} exits (${code})`))
  const listen = () => {
    // macOS: the token before the socket, so a Crew that finds the socket reads this host's token with it, not the last
    // host's (it was turned away, and ran its agents without a host, when it came in between)
    if (!WIN) {
      const tmp = `${TOKEN}.${process.pid}`
      fs.writeFileSync(tmp, token, { mode: 0o600 })
      fs.renameSync(tmp, TOKEN)
    }
    server.listen(here, () => {
      if (WIN) {
        // the pipe and its token at once, so Crew never reads one host's pipe with another's token
        const tmp = `${PIPE}.${process.pid}`
        fs.writeFileSync(tmp, JSON.stringify({ pipe: here, token, pid: process.pid }) + '\n', { mode: 0o600 })
        fs.renameSync(tmp, PIPE)
      } else {
        fs.chmodSync(SOCKET, 0o600)
      }
      log(`terminal host ${process.pid} listening`)
      idle()
    })
  }
  // A socket file left by a host that died is in the way; one that answers belongs to a host that's alive.
  const was = address()
  if (!was) return listen()
  const probe = net.connect(was.path)
  probe.on('connect', () => {
    probe.destroy()
    log('terminal host: another one is running', true)
    process.exit(0)
  })
  probe.on('error', () => {
    if (!WIN) fs.rmSync(SOCKET, { force: true })
    listen()
  })
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
        if (m.t !== 'hello' || m.token !== token) {
          log('terminal host: turned away a connection without its token')
          return sock.destroy()
        }
        ok = true
        // one Crew at a time: a newer one takes over
        if (client && client !== sock) {
          log('terminal host: a newer Crew connected, so the one before is let go')
          client.destroy()
        }
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
      return kill(x)
    case 'write':
      return x?.p.write(String(m.data))
    case 'resize':
      if (x && m.cols > 0 && m.rows > 0 && (x.cols !== m.cols || x.rows !== m.rows)) {
        Object.assign(x, { cols: m.cols, rows: m.rows })
        x.p.resize(m.cols, m.rows)
      }
      return
    case 'quit':
      return quit('Crew asked it to')
  }
}

function start({ name, file, args = [], cwd, env = {}, cols = 120, rows = 36, tag }) {
  kill(procs.get(name)) // a terminal by this name is replaced; its exit still comes, with its own tag
  let p
  try {
    p = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env })
  } catch (e) {
    log(`terminal host: ${name} didn't start (${file}): ${e.stack ?? e.message}`, true)
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
    // Windows: one that ended by itself still holds its pseudoconsole, and node-pty (1.1) the thread that reads it,
    // until it's killed, which a host that runs for days can't leave to its exit (core/runner.js release)
    if (WIN && !x.killed) {
      try {
        p.kill()
      } catch {}
    }
    const e = { name, tag, code: exitCode, ms: Date.now() - x.startedAt }
    if (client) send({ t: 'exit', ...e })
    else gone.push(e)
    idle()
  })
  send({ t: 'started', name, tag, pid: p.pid })
}

function kill(x) {
  if (!x) return
  x.killed = true
  x.p.kill()
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
  idleTimer = setTimeout(() => quit('nothing to keep'), IDLE)
}

function quit(why) {
  log(`terminal host ${process.pid} quits: ${why}`)
  for (const x of procs.values()) kill(x)
  if (!WIN) fs.rmSync(SOCKET, { force: true })
  else if (address()?.path === here) fs.rmSync(PIPE, { force: true }) // unless a newer host has said where it is
  // a moment for the terminals' processes to take the hint
  setTimeout(() => process.exit(0), procs.size ? 500 : 0)
}

// Run as a program (not imported for the names above). Compared as the system compares paths: on Windows without
// regard to case, and wherever the file is linked from.
export const isMain = (argv1, self, win = WIN) => {
  if (!argv1) return false
  const real = (f) => {
    try {
      return fs.realpathSync(f)
    } catch {
      return path.resolve(f)
    }
  }
  const [a, b] = [real(argv1), real(self)]
  return win ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (isMain(process.argv[1], fileURLToPath(import.meta.url))) main()

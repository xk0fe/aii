// Owns the pseudo-terminals. Knows nothing about agents beyond a name.
import { EventEmitter } from 'node:events'
import pty from 'node-pty'
import { which, pathKey } from './launch.js'
import { ROOT } from './workspaces.js'
import { pasteable } from './framing.js'

export { which } // where it always was, for core/ptyclient.js

const SCROLLBACK = 256 * 1024
// Output that only sets the window title (OSC 0/1/2), like the spinner Codex keeps in its title for half a minute
// after it starts: nothing on screen changes, so it doesn't count as drawing (see quietFor).
export const TITLE_ONLY = /^(?:\x1b\][012];[^\x07\x1b]*(?:\x07|\x1b\\))+$/
// Markers a parent Claude Code session leaves in the environment (e.g. when clique is started from inside one).
// Inherited, they make the agent think it's a child session and stop saving transcripts, which breaks resume.
const PARENT_SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_\w+))$/

// Windows: a terminal whose program ends by itself keeps its pseudoconsole, and node-pty (1.1) the thread that reads
// it, until it's killed: node-pty lets go of them only in kill(). Without this every agent that exits leaves both
// behind for as long as the process that ran it lives (it never could exit by itself). The terminal host does the same.
export function release(p, platform = process.platform) {
  if (platform !== 'win32') return
  try {
    p.kill()
  } catch {}
}

export function cleanEnv(env) {
  for (const key of Object.keys(env)) if (PARENT_SESSION_VARS.test(key)) delete env[key]
  return env
}

export class Runner extends EventEmitter {
  procs = new Map()

  // `tag` comes back with 'ended' once this process is gone, however it went (it exited, or was stopped or replaced).
  start(name, { file, args, cwd, env, tag }) {
    this.stop(name)
    const fullEnv = cleanEnv({ ...process.env, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' })
    const p = pty.spawn(which(file, fullEnv[pathKey(fullEnv)]), args, { name: 'xterm-256color', cols: 120, rows: 36, cwd, env: fullEnv })
    // Scrollback as the chunks that arrived, trimmed to the last SCROLLBACK characters only now and then: slicing a
    // 256 KB string on every chunk of a chatty agent's output was most of what a spinner cost.
    const proc = { p, chunks: [], size: 0, startedAt: Date.now(), lastOutput: Date.now(), cols: 120, rows: 36 }
    p.onData((d) => {
      if (!TITLE_ONLY.test(d)) proc.lastOutput = Date.now()
      proc.chunks.push(d)
      proc.size += d.length
      if (proc.size > SCROLLBACK * 1.5) trim(proc)
      this.emit('data', name, d)
    })
    p.onExit(({ exitCode }) => {
      this.emit('ended', name, tag)
      if (this.procs.get(name) !== proc) return // stopped or replaced: killed already
      release(p)
      this.procs.delete(name)
      this.emit('exit', name, exitCode, Date.now() - proc.startedAt)
    })
    this.procs.set(name, proc)
  }

  // Removing the entry first means a deliberate stop never emits 'exit'. Resolves once the process is gone (or
  // after 3 s), for when what it leaves behind matters: a transcript it finishes writing as it goes.
  stop(name) {
    const proc = this.procs.get(name)
    if (!proc) return Promise.resolve()
    this.procs.delete(name)
    const gone = new Promise((resolve) => {
      proc.p.onExit(() => resolve())
      setTimeout(resolve, 3000)
    })
    proc.p.kill()
    return gone
  }

  stopAll() {
    for (const name of [...this.procs.keys()]) this.stop(name)
  }

  running(name) {
    return this.procs.has(name)
  }

  pid(name) {
    return this.procs.get(name)?.p.pid
  }

  write(name, data) {
    this.procs.get(name)?.p.write(data)
  }

  // How long its terminal has drawn nothing: an idle CLI is silent, a busy or starting one keeps redrawing. A new
  // window title isn't drawing.
  quietFor(name) {
    const proc = this.procs.get(name)
    return proc ? Date.now() - proc.lastOutput : 0
  }

  // Type a prompt and press Enter. The text always goes in as a bracketed paste: newlines don't submit early, and
  // when a stalled CLI reads the text and the Enter together, the Enter still submits instead of joining the text.
  // Without its control characters (core/framing.js): an escape sequence in a message could end the paste early.
  submit(name, text) {
    const proc = this.procs.get(name)
    if (!proc) return
    proc.p.write(`\x1b[200~${pasteable(text)}\x1b[201~`)
    setTimeout(() => proc.p.write('\r'), 150)
  }

  resize(name, cols, rows) {
    const proc = this.procs.get(name)
    if (!proc || !(cols > 0 && rows > 0) || (proc.cols === cols && proc.rows === rows)) return
    Object.assign(proc, { cols, rows })
    proc.p.resize(cols, rows)
  }

  // Recent output plus the size it was drawn at; TUIs only replay correctly at that size.
  buffer(name) {
    const proc = this.procs.get(name)
    if (!proc) return { data: '', cols: 120, rows: 36 }
    trim(proc)
    return { data: proc.chunks[0] ?? '', cols: proc.cols, rows: proc.rows }
  }
}

// The last SCROLLBACK characters of a pty's output, as one chunk.
function trim(proc) {
  if (proc.chunks.length <= 1 && proc.size <= SCROLLBACK) return
  const all = proc.chunks.join('').slice(-SCROLLBACK)
  proc.chunks = [all]
  proc.size = all.length
}

// One workspace's terminals, in the runner all workspaces share (core/workspaces.js). The runner knows them by the
// workspace and the agent's name (storefront/june); ROOT's by the agent's name alone, as they were before there were
// workspaces, so terminals that outlived an older CLIque are still found.
export class Scoped extends EventEmitter {
  constructor(runner, workspace) {
    super()
    this.runner = runner
    this.prefix = workspace === ROOT ? '' : `${workspace}/`
    runner.setMaxListeners(0) // each workspace listens
    this.relays = ['data', 'exit', 'ended'].map((event) => {
      const relay = (name, ...rest) => {
        const own = this.own(name)
        if (own) this.emit(event, own, ...rest)
      }
      runner.on(event, relay)
      return [event, relay]
    })
  }

  // The workspace is gone: its hub hears no more.
  dispose() {
    for (const [event, relay] of this.relays) this.runner.off(event, relay)
  }

  // the agent's name, for a terminal of this workspace's
  own(name) {
    if (!this.prefix) return name.includes('/') ? null : name
    return name.startsWith(this.prefix) ? name.slice(this.prefix.length) : null
  }

  full(name) {
    return this.prefix + name
  }

  get survivors() {
    return this.runner.survivors?.filter((s) => this.own(s.name)).map((s) => ({ ...s, name: this.own(s.name) }))
  }

  start(name, opts) {
    return this.runner.start(this.full(name), opts)
  }

  stop(name) {
    return this.runner.stop(this.full(name))
  }

  running(name) {
    return this.runner.running(this.full(name))
  }

  pid(name) {
    return this.runner.pid?.(this.full(name))
  }

  write(name, data) {
    return this.runner.write(this.full(name), data)
  }

  quietFor(name) {
    return this.runner.quietFor?.(this.full(name))
  }

  submit(name, text) {
    return this.runner.submit(this.full(name), text)
  }

  resize(name, cols, rows) {
    return this.runner.resize(this.full(name), cols, rows)
  }

  buffer(name) {
    return this.runner.buffer(this.full(name))
  }
}

// Owns the pseudo-terminals. Knows nothing about agents beyond a name.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import pty from 'node-pty'

const SCROLLBACK = 256 * 1024
// Markers a parent Claude Code session leaves in the environment (e.g. when crew is started from inside one).
// Inherited, they make the agent think it's a child session and stop saving transcripts, which breaks resume.
const PARENT_SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_\w+))$/

export function cleanEnv(env) {
  for (const key of Object.keys(env)) if (PARENT_SESSION_VARS.test(key)) delete env[key]
  return env
}

export class Runner extends EventEmitter {
  procs = new Map()

  start(name, { file, args, cwd, env }) {
    this.stop(name)
    const fullEnv = cleanEnv({ ...process.env, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' })
    const p = pty.spawn(which(file, fullEnv.PATH), args, { name: 'xterm-256color', cols: 120, rows: 36, cwd, env: fullEnv })
    const proc = { p, buf: '', startedAt: Date.now(), lastOutput: Date.now(), cols: 120, rows: 36 }
    p.onData((d) => {
      proc.lastOutput = Date.now()
      proc.buf = (proc.buf + d).slice(-SCROLLBACK)
      this.emit('data', name, d)
    })
    p.onExit(({ exitCode }) => {
      if (this.procs.get(name) !== proc) return
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

  write(name, data) {
    this.procs.get(name)?.p.write(data)
  }

  // How long its terminal has drawn nothing: an idle CLI is silent, a busy or starting one keeps redrawing.
  quietFor(name) {
    const proc = this.procs.get(name)
    return proc ? Date.now() - proc.lastOutput : 0
  }

  // Type a prompt and press Enter. The text always goes in as a bracketed paste: newlines don't submit early, and
  // when a stalled CLI reads the text and the Enter together, the Enter still submits instead of joining the text.
  submit(name, text) {
    const proc = this.procs.get(name)
    if (!proc) return
    proc.p.write(`\x1b[200~${text}\x1b[201~`)
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
    return proc ? { data: proc.buf, cols: proc.cols, rows: proc.rows } : { data: '', cols: 120, rows: 36 }
  }
}

function which(cmd, PATH = '') {
  if (cmd.includes('/')) return cmd
  for (const dir of PATH.split(':')) {
    const file = path.join(dir, cmd)
    try {
      fs.accessSync(file, fs.constants.X_OK)
      return file
    } catch {}
  }
  return cmd
}

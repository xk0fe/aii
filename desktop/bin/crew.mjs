// Crew's commands for agents on Windows: what bin/crew, bin/crew-status (sh) and the hooks in core/adapters.js (sh +
// curl) do on macOS and Linux, in Node, which Crew always has with it. bin/win32-<arch>/crew.exe, crew-status.exe and
// crew-hook.exe (native/crew-shim.c) each run this as `crew.mjs <its name> <its arguments>`:
//
//   crew <command> ...      the crew CLI an agent uses (crew help), from PowerShell or cmd
//   crew-status             Claude Code's status line (its JSON on stdin)
//   crew-hook hook          a hook event (stdin) for Crew, or for the spool while Crew is closed
//   crew-hook ask <s>       a permission request, question or plan: waits up to <s> seconds for your answer in Crew
//   crew-hook lease         before a file tool writes: is the file free?
//
// The contract with Crew (core/hub.js sets these for every agent; packaging keeps bin/ outside the asar):
//   CREW_NODE       Crew's own runtime: its Electron binary (process.execPath), which crew.exe runs with
//                   ELECTRON_RUN_AS_NODE=1 for this one process. Without it, node.exe on PATH.
//   PATH            bin/win32-<arch> first. It also holds copies of bin/crew and bin/crew-status, which Git Bash runs
//                   (as macOS does); PowerShell and cmd run the .exe files (core/launch.js withTools).
//   CREW_HOME       where Crew writes its address (url) and token each time it starts; read on every call, since an
//                   agent can outlive the Crew that started it. CREW_URL and CREW_TOKEN when those files aren't there.
//   CREW_AGENT, CREW_WORKSPACE   who is asking, and in which workspace (none: the default).
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

delete process.env.ELECTRON_RUN_AS_NODE // only this process runs as Node: not your status line, nor what it starts

const env = process.env
const home = env.CREW_HOME || path.join(os.homedir(), '.crew')
const crewFile = (name) => {
  try {
    return fs.readFileSync(path.join(home, name), 'utf8').replace(/\n+$/, '')
  } catch {
    return ''
  }
}
const agent = env.CREW_AGENT ?? ''
// An agent's spool holds this much before it starts afresh (core/keep.js, which this can't import: it runs on its own).
const SPOOL_MAX = 4 * 1024 * 1024

// One request to Crew, given up `seconds` after it began (curl -m). -> { status, body (a Buffer) }, or null when Crew
// isn't there or took too long.
function call(url, route, { body, method = body === undefined ? 'GET' : 'POST', seconds = 5, token = crewFile('token') } = {}) {
  return new Promise((resolve) => {
    let target
    try {
      target = new URL(url + route)
    } catch {
      return resolve(null)
    }
    const done = (result) => (clearTimeout(timer), resolve(result))
    const req = http.request(target, { method, headers: { 'X-Crew': token, 'X-Crew-Workspace': env.CREW_WORKSPACE ?? '' } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode, body: Buffer.concat(chunks) }))
      res.on('error', () => done(null))
    })
    const timer = setTimeout(() => (req.destroy(), done(null)), seconds * 1000)
    req.on('error', () => done(null))
    req.end(body)
  })
}

async function stdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

const write = (text) => new Promise((resolve) => (text.length ? process.stdout.write(text, resolve) : resolve()))
const ok = (res) => res && res.status < 400 // curl -f

// A hook's decision as ASCII-only JSON (\u escapes), so no shell between Crew and the CLI can change its characters
// on the way (PowerShell may re-encode what a program prints).
function decision(body) {
  const text = body.toString('utf8')
  try {
    return JSON.stringify(JSON.parse(text)).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  } catch {
    return text
  }
}

// ---- crew-hook: what the CLIs' hooks run (core/adapters.js) ----------------------------------------------------

// Like the sh hooks, it always ends with 0, whatever happens: 2 would tell Claude Code to block the prompt or tool.
async function hook([kind, seconds]) {
  if (!['hook', 'ask', 'lease'].includes(kind)) return stop('crew-hook: hook | ask <seconds> | lease (is Claude Code 2.1.139 or later?)', 0)
  const url = crewFile('url')
  const input = await stdin()
  const route = `/${kind}/${agent}`
  if (kind === 'ask' || kind === 'lease') {
    // nothing printed (Crew gone, an error, time's up) and the agent decides as it would without Crew
    const res = await call(url, route, { body: input, seconds: kind === 'ask' ? Number(seconds) || 1 : 3 })
    if (ok(res)) await write(decision(res.body))
    return
  }
  const event = input.replace(/\n+$/, '')
  if (ok(await call(url, route, { body: event, seconds: 2 }))) return
  // Crew is closed: one line per event in the workspace's spool, replayed when it's back (Hub.replaySpool). Past
  // SPOOL_MAX it becomes <agent>.jsonl.1, the one before going, and a new one starts, as the sh hooks do.
  try {
    const spool = path.join(home, ...(env.CREW_WORKSPACE ? ['workspaces', env.CREW_WORKSPACE] : []), 'spool')
    const file = path.join(spool, `${agent}.jsonl`)
    fs.mkdirSync(spool, { recursive: true })
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > SPOOL_MAX) fs.renameSync(file, `${file}.1`)
    fs.appendFileSync(file, `${event.replace(/\r?\n/g, ' ')}\n`)
  } catch {}
}

// ---- crew-status: Claude Code's status line -----------------------------------------------------------------

// Tells Crew how full the conversation is (the context gauge), then shows your own status line if you have one in
// ~/.claude/settings.json (CREW_STATUS_LINE, run the way Claude Code runs it), or Crew's.
async function status() {
  const input = await stdin()
  const res = await call(crewFile('url'), `/status/${agent}`, { body: input, seconds: 1 })
  const crews = () => write(res ? res.body.toString('utf8').replace(/\n+$/, '') : '') // as $(...) left it
  if (!env.CREW_STATUS_LINE) return crews()
  const { spawn } = await import('node:child_process')
  const [shell, ...args] = yourShell()
  return new Promise((resolve) => {
    const child = spawn(shell, [...args, env.CREW_STATUS_LINE], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
    child.on('error', () => crews().then(resolve)) // no shell to run yours with: Crew's, rather than nothing
    child.on('exit', (code) => resolve((process.exitCode = code ?? 1)))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

// The shell Claude Code runs a status line command with: sh (your $SHELL) on macOS and Linux; on Windows Git Bash
// when it's installed, PowerShell when it isn't, which runs your .ps1 whatever the execution policy unless you say so.
function yourShell() {
  if (process.platform !== 'win32') return [env.SHELL || '/bin/sh', '-c']
  const bash = gitBash()
  if (bash) return [bash, '-c']
  const policy = env.CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY === '1' ? [] : ['-ExecutionPolicy', 'Bypass']
  return [onPath('pwsh.exe') ?? 'powershell.exe', '-NoProfile', ...policy, '-Command']
}

function gitBash() {
  const there = (file) => file && fs.existsSync(file) && file
  const git = onPath('git.exe')
  const root = git && path.resolve(path.dirname(git), /\\mingw64\\bin$/i.test(path.dirname(git)) ? '..\\..' : '..')
  return (
    there(env.CLAUDE_CODE_GIT_BASH_PATH) ||
    there(root && path.join(root, 'bin', 'bash.exe')) ||
    [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].map((dir) => there(dir && path.join(dir, 'Git', 'bin', 'bash.exe'))).find(Boolean)
  )
}

function onPath(name) {
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    const file = dir && path.join(dir.replace(/^"(.*)"$/, '$1'), name)
    if (file && fs.existsSync(file)) return file
  }
  return null
}

// ---- crew: the CLI (bin/crew) ----------------------------------------------------------------------------

const HELP = `crew who                    agents, their areas and status
crew ask <name|any> "..."   ask an agent and wait for its answer (its final message)
crew wait                   keep waiting for the answers to what you asked
crew answer ["@name"] "..." answer a question you were asked, right away, and carry on
crew send <name|any> "..."  hand a task to an agent for good (queued until it is free)
crew lease <thing> ["..."]  take something only one agent can use at a time (a simulator, a port), waiting if it's taken
crew release [thing]        give it back (everything you hold, without a name)
crew leases                 who has what
crew note "..."             share context with the whole crew
crew board                  read the shared notes
crew task                   the Tasks board: list, show, done, note, add (crew task help)
`

function stop(text, code) {
  process.stderr.write(`${text}\n`)
  process.exitCode = code
}

async function cli([cmd, ...args]) {
  // what Crew wrote when it started comes first: an agent can outlive the Crew that started it (core/ptyhost.js)
  const url = crewFile('url') || env.CREW_URL || ''
  const token = crewFile('token') || env.CREW_TOKEN || ''
  if (!url) return stop('crew app is not running', 1)
  const from = encodeURIComponent(env.CREW_AGENT || 'you')
  const q = encodeURIComponent
  // each word NUL-terminated, so quotes, newlines and flags arrive as typed (none: one empty word, as printf gives)
  const words = (list) => (list.length ? list : ['']).map((w) => `${w}\0`).join('')
  const send = async (route, opts) => {
    const res = await call(url, route, { token, ...opts })
    if (res) await write(res.body.toString('utf8'))
    else stop('crew app is not running', 0)
  }
  switch (cmd) {
    case 'who':
    case 'board':
    case 'leases':
      return send(`/${cmd}`)
    case 'send': {
      const [to, ...task] = args
      if (!to || !task.length) return stop('usage: crew send <name|any> "task"', 2)
      return send(`/send?from=${from}&to=${q(to)}`, { body: task.join(' ') })
    }
    case 'ask': {
      // held open until the answer comes; Crew lets go after 100s with where things stand
      const [to, ...question] = args
      if (!to || !question.length) return stop('usage: crew ask <name|any> "question"', 2)
      return send(`/question?from=${from}&to=${q(to)}`, { body: question.join(' '), seconds: 110 })
    }
    case 'wait':
      return send(`/wait?from=${from}`, { method: 'POST', seconds: 110 })
    case 'answer': {
      // crew answer "…" answers the question you were asked; crew answer "@name" "…" picks whose (quoted: PowerShell reads a bare @name as splatting)
      const to = args[0]?.startsWith('@') ? args.shift().slice(1) : ''
      if (!args.length) return stop('usage: crew answer ["@name"] "your answer"', 2)
      return send(`/answer?from=${from}&to=${q(to)}`, { body: args.join(' ') })
    }
    case 'lease':
      // held open while a teammate has it; Crew lets go after 100s with who has it
      if (!args[0]) return stop('usage: crew lease <thing> ["what for"]', 2)
      return send(`/claim?from=${from}`, { body: words(args), seconds: 110 })
    case 'release':
      return send(`/release?from=${from}`, { body: words(args) })
    case 'note':
      if (!args.length) return stop('usage: crew note "text"', 2)
      return send(`/note?from=${from}`, { body: args.join(' ') })
    case 'task':
    case 'bug':
      return send(`/task?from=${from}`, { body: words(args) })
    default:
      return write(HELP)
  }
}

const [as, ...args] = process.argv.slice(2)
const run = { crew: cli, 'crew-status': status, 'crew-hook': hook }[String(as).toLowerCase()]
if (run) await run(args)
else stop(`crew.mjs: run as crew, crew-status or crew-hook, not ${as}`, 2)

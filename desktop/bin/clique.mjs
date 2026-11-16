// CLIque's commands for agents on Windows: what bin/clique, bin/clique-status (sh) and the hooks in core/adapters.js (sh +
// curl) do on macOS and Linux, in Node, which CLIque always has with it. bin/win32-<arch>/clique.exe, clique-status.exe and
// clique-hook.exe (native/clique-shim.c) each run this as `clique.mjs <its name> <its arguments>`:
//
//   clique <command> ...      the clique CLI an agent uses (clique help), from PowerShell or cmd
//   clique-status             Claude Code's status line (its JSON on stdin)
//   clique-hook hook          a hook event (stdin) for CLIque, or for the spool while CLIque is closed
//   clique-hook ask <s>       a permission request, question or plan: waits up to <s> seconds for your answer in CLIque
//   clique-hook lease         before a file tool writes: is the file free?
//
// The contract with CLIque (core/hub.js sets these for every agent; packaging keeps bin/ outside the asar):
//   CLIQUE_NODE       CLIque's own runtime: its Electron binary (process.execPath), which clique.exe runs with
//                   ELECTRON_RUN_AS_NODE=1 for this one process. Without it, node.exe on PATH.
//   PATH            bin/win32-<arch> first. It also holds copies of bin/clique and bin/clique-status, which Git Bash runs
//                   (as macOS does); PowerShell and cmd run the .exe files (core/launch.js withTools).
//   CLIQUE_HOME       where CLIque writes its address (url) and token each time it starts; read on every call, since an
//                   agent can outlive the CLIque that started it. CLIQUE_URL and CLIQUE_TOKEN when those files aren't there.
//   CLIQUE_AGENT, CLIQUE_WORKSPACE   who is asking, and in which workspace (none: its files are in CLIQUE_HOME itself).
//   CLIQUE_BADGE      the agent's own key (core/keys.js): what it shows CLIque, which reads who's asking from it. Without one
//                   (a terminal of your own, an agent an older CLIque started), the token in CLIQUE_HOME.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

delete process.env.ELECTRON_RUN_AS_NODE // only this process runs as Node: not your status line, nor what it starts

const env = process.env
// An agent started before the app's rename (Crew) has its variables as CREW_*, and may call this by the old names
// (crew, crew-status, crew-hook): both still work. (core/home.js says the same for the app; this runs on its own.)
for (const k of Object.keys(env)) if (k.startsWith('CREW_') && env[`CLIQUE_${k.slice(5)}`] === undefined) env[`CLIQUE_${k.slice(5)}`] = env[k]
const dir = (name) => path.join(os.homedir(), name)
const home = env.CLIQUE_HOME || (!fs.existsSync(dir('.clique')) && fs.existsSync(dir('.crew')) ? dir('.crew') : dir('.clique'))
const cliqueFile = (name) => {
  try {
    return fs.readFileSync(path.join(home, name), 'utf8').replace(/\n+$/, '')
  } catch {
    return ''
  }
}
const agent = env.CLIQUE_AGENT ?? ''
// An agent's spool holds this much before it starts afresh (core/keep.js, which this can't import: it runs on its own).
const SPOOL_MAX = 4 * 1024 * 1024

// One request to CLIque, given up `seconds` after it began (curl -m). -> { status, body (a Buffer) }, or null when CLIque
// isn't there or took too long.
function call(url, route, { body, method = body === undefined ? 'GET' : 'POST', seconds = 5, token = env.CLIQUE_BADGE || cliqueFile('token') } = {}) {
  return new Promise((resolve) => {
    let target
    try {
      target = new URL(url + route)
    } catch {
      return resolve(null)
    }
    const done = (result) => (clearTimeout(timer), resolve(result))
    const req = http.request(target, { method, headers: { 'X-Clique': token, 'X-Clique-Workspace': env.CLIQUE_WORKSPACE ?? '' } }, (res) => {
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

// A hook's decision as ASCII-only JSON (\u escapes), so no shell between CLIque and the CLI can change its characters
// on the way (PowerShell may re-encode what a program prints).
function decision(body) {
  const text = body.toString('utf8')
  try {
    return JSON.stringify(JSON.parse(text)).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  } catch {
    return text
  }
}

// ---- clique-hook: what the CLIs' hooks run (core/adapters.js) ----------------------------------------------------

// Like the sh hooks, it always ends with 0, whatever happens: 2 would tell Claude Code to block the prompt or tool.
async function hook([kind, seconds]) {
  if (!['hook', 'ask', 'lease'].includes(kind)) return stop('clique-hook: hook | ask <seconds> | lease (is Claude Code 2.1.139 or later?)', 0)
  const url = cliqueFile('url')
  const input = await stdin()
  const route = `/${kind}/${agent}`
  if (kind === 'ask' || kind === 'lease') {
    // nothing printed (CLIque gone, an error, time's up) and the agent decides as it would without CLIque
    const res = await call(url, route, { body: input, seconds: kind === 'ask' ? Number(seconds) || 1 : 3 })
    if (ok(res)) await write(decision(res.body))
    return
  }
  const event = input.replace(/\n+$/, '')
  if (ok(await call(url, route, { body: event, seconds: 2 }))) return
  // CLIque is closed: one line per event in the workspace's spool, replayed when it's back (Hub.replaySpool). Past
  // SPOOL_MAX it becomes <agent>.jsonl.1, the one before going, and a new one starts, as the sh hooks do (and as they
  // do, by way of a name of its own, in case another hook has just started the new one).
  try {
    const spool = path.join(home, ...(env.CLIQUE_WORKSPACE ? ['workspaces', env.CLIQUE_WORKSPACE] : []), 'spool')
    const file = path.join(spool, `${agent}.jsonl`)
    fs.mkdirSync(spool, { recursive: true })
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > SPOOL_MAX) {
      const mine = `${file}.${process.pid}`
      try {
        fs.renameSync(file, mine)
        if (fs.statSync(mine).size > SPOOL_MAX) fs.renameSync(mine, `${file}.1`)
      } catch {}
      try {
        if (fs.existsSync(mine)) fs.appendFileSync(file, fs.readFileSync(mine)), fs.rmSync(mine, { force: true })
      } catch {}
    }
    fs.appendFileSync(file, `${event.replace(/\r?\n/g, ' ')}\n`)
  } catch {}
}

// ---- clique-status: Claude Code's status line -----------------------------------------------------------------

// Tells CLIque how full the conversation is (the context gauge), then shows your own status line if you have one in
// ~/.claude/settings.json (CLIQUE_STATUS_LINE, run the way Claude Code runs it), or CLIque's.
async function status() {
  const input = await stdin()
  const res = await call(cliqueFile('url'), `/status/${agent}`, { body: input, seconds: 1 })
  const cliques = () => write(res ? res.body.toString('utf8').replace(/\n+$/, '') : '') // as $(...) left it
  if (!env.CLIQUE_STATUS_LINE) return cliques()
  const { spawn } = await import('node:child_process')
  const [shell, ...args] = yourShell()
  return new Promise((resolve) => {
    const child = spawn(shell, [...args, env.CLIQUE_STATUS_LINE], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
    child.on('error', () => cliques().then(resolve)) // no shell to run yours with: CLIque's, rather than nothing
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

// ---- clique: the CLI (bin/clique) ----------------------------------------------------------------------------

const HELP = `clique who                    agents, their areas and status
clique ask <name|any> "..."   ask an agent and wait for its answer (its final message)
clique wait                   keep waiting for the answers to what you asked
clique answer ["@name"] "..." answer a question you were asked, right away, and carry on
clique send <name|any> "..."  hand a task to an agent for good (queued until it is free)
clique busy                   what each teammate is working on right now
clique lease <thing> ["..."]  take something only one agent can use at a time (a simulator, a port), waiting if it's taken
clique release [thing]        give it back (everything you hold, without a name)
clique leases                 who has what
clique note "..."             share context with the whole clique
clique board [words]          the shared notes you haven't read (--all for every one, or words to search)
clique channels               the channels here: who's in each, and its brief
clique post <channel> "..."   say it in that channel (@name someone to hand it to them there)
clique react <emoji>          put one emoji on the message you're answering, in place of a written "got it"
clique canvas                 draw a board in the chat, or add to one that's there (clique canvas help)
clique task                   the Tasks board: list, show, done, note, add (clique task help)
clique app <what> ...         change CLIque itself: agents, channels, workspaces, computers (clique app help)
`

function stop(text, code) {
  process.stderr.write(`${text}\n`)
  process.exitCode = code
}

async function cli([cmd, ...args]) {
  // what CLIque wrote when it started comes first: an agent can outlive the CLIque that started it (core/ptyhost.js)
  const url = cliqueFile('url') || env.CLIQUE_URL || ''
  const token = env.CLIQUE_BADGE || cliqueFile('token') || env.CLIQUE_TOKEN || ''
  if (!url) return stop('CLIque is not running', 1)
  const from = encodeURIComponent(env.CLIQUE_AGENT || 'you')
  const q = encodeURIComponent
  // each word NUL-terminated, so quotes, newlines and flags arrive as typed (none: one empty word, as printf gives)
  const words = (list) => (list.length ? list : ['']).map((w) => `${w}\0`).join('')
  const send = async (route, opts) => {
    const res = await call(url, route, { token, ...opts })
    if (res) await write(res.body.toString('utf8'))
    else stop('CLIque is not running', 0)
  }
  switch (cmd) {
    case 'who':
    case 'leases':
      return send(`/${cmd}`)
    case 'busy':
      return send(`/busy?from=${from}`)
    case 'board':
      return send(`/board?from=${from}`, { body: words(args) })
    case 'send': {
      const [to, ...task] = args
      if (!to || !task.length) return stop('usage: clique send <name|any> [--new] "task"', 2)
      return send(`/send?from=${from}&to=${q(to)}`, { body: task.join(' ') })
    }
    case 'ask': {
      // held open until the answer comes; CLIque lets go after 100s with where things stand
      const [to, ...question] = args
      if (!to || !question.length) return stop('usage: clique ask <name|any> "question"', 2)
      return send(`/question?from=${from}&to=${q(to)}`, { body: question.join(' '), seconds: 110 })
    }
    case 'wait':
      return send(`/wait?from=${from}`, { method: 'POST', seconds: 110 })
    case 'answer': {
      // clique answer "…" answers the question you were asked; clique answer "@name" "…" picks whose (quoted: PowerShell reads a bare @name as splatting)
      const to = args[0]?.startsWith('@') ? args.shift().slice(1) : ''
      if (!args.length) return stop('usage: clique answer ["@name"] "your answer"', 2)
      return send(`/answer?from=${from}&to=${q(to)}`, { body: args.join(' ') })
    }
    case 'lease':
      // held open while a teammate has it; CLIque lets go after 100s with who has it
      if (!args[0]) return stop('usage: clique lease <thing> ["what for"]', 2)
      return send(`/claim?from=${from}`, { body: words(args), seconds: 110 })
    case 'release':
      return send(`/release?from=${from}`, { body: words(args) })
    case 'note':
      if (!args.length) return stop('usage: clique note "text"', 2)
      return send(`/note?from=${from}`, { body: args.join(' ') })
    case 'channels':
      return send(`/channels?from=${from}`)
    case 'post':
      if (!args[0] || args.length < 2) return stop('usage: clique post <channel> "message" (the name alone: an unquoted # starts a shell comment)', 2)
      return send(`/post?from=${from}`, { body: words(args) })
    case 'react':
      return send(`/react?from=${from}`, { body: words(args) })
    case 'canvas':
      return send(`/canvas?from=${from}`, { body: words(args) })
    case 'task':
    case 'bug':
      return send(`/task?from=${from}`, { body: words(args) })
    case 'app':
      // clique app <what> ...: held open while the user is asked; CLIque lets go after 100s
      return send(`/app?from=${from}`, { body: words(args), seconds: 110 })
    default:
      return write(HELP)
  }
}

const [called, ...args] = process.argv.slice(2)
const as = String(called ?? '').replace(/^crew(?=$|-)/, 'clique')
const run = { clique: cli, 'clique-status': status, 'clique-hook': hook }[String(as).toLowerCase()]
if (run) await run(args)
else stop(`clique.mjs: run as clique, clique-status or clique-hook, not ${as}`, 2)

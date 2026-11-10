// What an agent leaves running. Each shell command an agent runs is the leader of a process group of its own, and what
// the command leaves behind (a dev server started with &, a simulator helper) stays in that group once the command is
// done, even after its parent is gone. CLIque notes the groups: bin/clique-sh writes down each command's for Claude Code,
// and the agent's process tree, looked at now and then, adds the rest for any CLI. When the agent's CLI ends, what's
// still in its groups is stopped (Hub.sweep). No Electron in here.
//
// Windows has no process groups, but a process there keeps its parent's id after the parent is gone. So there the file
// holds processes rather than groups, each with when it started and when it was last seen (pid start seen), and what's
// left is whatever descends from one of them: its parents are followed up while they're its parents (an id handed out
// again belongs to a process that started later than the child), and the id of the first one that's gone counts if it
// was one of the agent's at the time (between its start and when it was last seen). bin/clique-sh, run by Git Bash there,
// also writes down what a command left in its group once the command is done, so a dev server started with & is found
// even after the shells between it and the command are gone.
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathKey } from './launch.js'

const WIN = process.platform === 'win32'

// Every process on this computer: [{ pid, ppid, pgid, start (Unix seconds), name }]; on Windows without pgid. [] if
// they can't be listed. Listing them takes PowerShell on Windows, most of a second: maxAge (ms) lets a caller that only
// looks now and then take a list that recent. Elsewhere ps is quick and it always looks afresh.
export function processes({ maxAge = 0 } = {}) {
  return WIN ? windowsProcesses(maxAge) : psProcesses()
}

function psProcesses() {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,ppid=,pgid=,etime=,comm='], { maxBuffer: 16 * 1024 * 1024, timeout: 10000 }, (err, out) => {
      if (err) return resolve([])
      const now = Math.floor(Date.now() / 1000)
      const rows = out.split('\n').map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)).filter(Boolean)
      resolve(rows.map(([, pid, ppid, pgid, etime, comm]) => ({ pid: +pid, ppid: +ppid, pgid: +pgid, start: now - seconds(etime), name: path.basename(comm) })))
    })
  })
}

// ps's elapsed time, [[dd-]hh:]mm:ss, in seconds.
export function seconds(etime) {
  const [days, clock] = etime.includes('-') ? etime.split('-') : ['0', etime]
  return clock.split(':').reduce((s, n) => s * 60 + Number(n), 0) + Number(days) * 86400
}

// One line per process: its id, its parent's, when it started (a Windows file time, 0 when Windows won't say) and its
// name. wmic is gone from current Windows 11; CIM is what's left that says who started whom without admin rights.
const LIST = `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name | ForEach-Object {
  $t = 0; if ($_.CreationDate) { $t = $_.CreationDate.ToFileTimeUtc() }
  '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, $t, $_.Name
}`
let listing = null // the last Windows list: { at, procs }
let listingNow = null // the one on its way

function windowsProcesses(maxAge) {
  if (listing && Date.now() - listing.at <= maxAge) return Promise.resolve(listing.procs)
  // Windows PowerShell 5.1 is on every Windows 10 and 11, here; asked by its full path, not whatever's first on PATH
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(LIST, 'utf16le').toString('base64')]
  const at = Date.now()
  listingNow ??= new Promise((resolve) => {
    // windowsHide: CLIque has no console, and a console program it starts would flash one up otherwise
    execFile(ps, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 20000 }, (err, out) => {
      listingNow = null
      if (err && !out) return resolve([])
      const procs = parseWindows(out)
      if (procs.length) listing = { at, procs }
      resolve(procs)
    })
  })
  return listingNow
}

// LIST's lines -> [{ pid, ppid, start, name }], start in Unix seconds with the fraction (Windows knows it to 100 ns),
// name without ".exe", as ps would say it.
export function parseWindows(text) {
  const out = []
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+) (\d+) (\d+) (.+)$/)
    if (!m) continue
    const filetime = Number(m[3])
    out.push({ pid: +m[1], ppid: +m[2], start: filetime > 0 ? filetime / 1e7 - 11644473600 : 0, name: m[4].replace(/\.exe$/i, '') })
  }
  return out
}

// Windows: is k a child of p? Ids are handed out again there, and a process keeps its parent's id after the parent is
// gone, so it is only if p started first. With process groups the system keeps ppid true, and it always is.
const childOf = (k, p) => p.pgid !== undefined || k.start >= p.start

// `pid` and everything under it.
export function tree(procs, pid) {
  const kids = new Map()
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p])
  const out = []
  const seen = new Set()
  const todo = procs.filter((p) => p.pid === pid)
  while (todo.length) {
    const p = todo.pop()
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
    if (p.pid !== p.ppid) todo.push(...(kids.get(p.pid) ?? []).filter((k) => childOf(k, p)))
  }
  return out
}

// The groups an agent's process tree has right now, each with when it began: its leader's start, or its oldest
// member's once the leader is gone. -> Map(pgid -> start). On Windows, its processes: Map(pid -> start).
export function groupsOf(procs, pid) {
  const groups = new Map()
  for (const p of tree(procs, pid)) {
    if (p.pgid === undefined) {
      groups.set(p.pid, Math.floor(p.start))
      continue
    }
    const leader = procs.find((x) => x.pid === p.pgid)
    const start = leader ? leader.start : p.start
    if (!groups.has(p.pgid) || start < groups.get(p.pgid)) groups.set(p.pgid, start)
  }
  return groups
}

// What to add to an agent's file of groups (`known`: what's in it, readGroups) after a look at its process tree: the
// groups that are new. On Windows the processes that are new, and the agent's CLI (pid) as seen now, so what it starts
// later and leaves behind once it's gone is still its own. -> "id start[ seen]\n" lines, '' for none.
export function noteworthy(procs, pid, known, now = Date.now() / 1000) {
  const lines = []
  const windows = !procs.some((p) => p.pgid !== undefined)
  for (const [g, start] of groupsOf(procs, pid)) {
    if (!windows) {
      if (!known.has(g)) lines.push(`${g} ${start}\n`)
    } else if (g === pid || !(Math.abs(known.get(g) - start) <= 1)) {
      lines.push(`${g} ${start} ${Math.floor(now)}\n`)
    }
  }
  return lines.join('')
}

// The groups bin/clique-sh wrote down, one "pgid unix-seconds" line per command. -> Map(pgid -> start)
export function readGroups(file) {
  const groups = new Map()
  for (const [pgid, start] of lines(file)) if (pgid > 1 && start > 0 && !(start >= groups.get(pgid))) groups.set(pgid, start)
  return groups
}

// Windows: when each process written down was the agent's, from when it started to when it was last seen. A line
// without a seen time was written by the process itself (or right as it started). -> Map(pid -> [[start, seen], ...])
export function readSpans(file) {
  const spans = new Map()
  for (const [pid, start, seen = start] of lines(file)) {
    if (!(pid > 4 && start > 0 && seen >= start)) continue
    const list = spans.get(pid) ?? []
    const same = list.find((s) => Math.abs(s[0] - start) <= 1)
    if (same) same[1] = Math.max(same[1], seen)
    else list.push([start, seen])
    spans.set(pid, list)
  }
  return spans
}

function lines(file) {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {}
  return text.split('\n').map((line) => line.trim().split(/\s+/).map(Number)).filter((f) => f.length >= 2 && f.every(Number.isFinite))
}

// The processes still in `groups`. A member counts only if it started after its group did, and only while the group's
// leader is gone or is still the process that started the group: a number the system handed out again belongs to
// someone else by then. `keep`: pids never to touch (CLIque itself, other agents' CLIs and what runs under them).
// `spans` (readSpans): on Windows, which processes were the agent's when; groups' starts if not given.
export function leftovers(procs, groups, keep = new Set(), spans) {
  if (procs.length && !procs.some((p) => p.pgid !== undefined)) return windowsLeftovers(procs, spans ?? new Map([...groups].map(([g, s]) => [g, [[s, s]]])), keep)
  const ok = new Map()
  for (const [pgid, start] of groups) {
    const leader = procs.find((p) => p.pid === pgid)
    ok.set(pgid, !leader || Math.abs(leader.start - start) <= 5)
  }
  return procs.filter((p) => p.pid > 1 && ok.get(p.pgid) && p.start >= groups.get(p.pgid) - 2 && !keep.has(p.pid))
}

// Was the process numbered `pid` at time `t` one of the agent's? A start written down is a moment after the process
// started (clique-sh has to start before it can say so), so 3 s of slack before, and 1 after the last time it was seen.
const ours = (spans, pid, t) => (spans.get(pid) ?? []).some(([start, seen]) => t >= start - 3 && t <= seen + 1)

function windowsLeftovers(procs, spans, keep) {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const theirs = (p) => {
    for (let q = p, steps = 0; steps < 256; steps++) {
      if (ours(spans, q.pid, q.start)) return true
      const parent = byPid.get(q.ppid)
      if (!parent || parent === q || !(parent.start <= q.start)) return ours(spans, q.ppid, q.start) // its parent is gone
      q = parent
    }
    return false
  }
  return procs.filter((p) => p.pid > 4 && !keep.has(p.pid) && theirs(p))
}

// The groups never to sweep, whoever wrote them down, because `pid` (CLIque itself) is in them: CLIque started from an
// agent's terminal is in one of its groups. On Windows, its parents.
export function exempt(procs, pid) {
  const me = procs.find((p) => p.pid === pid)
  if (!me) return []
  if (me.pgid !== undefined) return [me.pgid]
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const out = []
  for (let q = me, parent; (parent = byPid.get(q.ppid)) && parent !== q && parent.start <= q.start && out.length < 256; q = parent) out.push(parent.pid)
  return out
}

// Asks them to stop, and makes sure 3 s later. Windows has no asking a program without a window to stop: they end
// straight away, as with SIGKILL.
export function stop(procs) {
  if (WIN) {
    for (const p of procs) {
      try {
        process.kill(p.pid)
      } catch {}
    }
    return
  }
  for (const p of procs) {
    try {
      process.kill(p.pid, 'SIGTERM')
    } catch {}
  }
  const t = setTimeout(() => {
    for (const p of procs) {
      try {
        process.kill(p.pid, 'SIGKILL')
      } catch {}
    }
  }, 3000)
  t.unref?.()
}

// Windows: where Git Bash is, looked for as Claude Code looks for the one it runs commands with:
// CLAUDE_CODE_GIT_BASH_PATH, then next to the git on PATH, then where Git for Windows installs. null if nowhere.
export function gitBash(env = process.env, exists = fs.existsSync) {
  const win = path.win32
  const found = []
  if (env.CLAUDE_CODE_GIT_BASH_PATH) found.push(env.CLAUDE_CODE_GIT_BASH_PATH)
  for (const dir of String(env[pathKey(env, 'win32')] ?? '').split(';').filter(Boolean)) {
    // Git\cmd\git.exe, Git\bin\git.exe or Git\mingw64\bin\git.exe
    if (exists(win.join(dir, 'git.exe'))) found.push(win.join(dir, '..', 'bin', 'bash.exe'), win.join(dir, '..', '..', 'bin', 'bash.exe'))
  }
  for (const root of [env.ProgramFiles, env['ProgramW6432'], env['ProgramFiles(x86)'], env.LOCALAPPDATA && win.join(env.LOCALAPPDATA, 'Programs')]) {
    if (root) found.push(win.join(root, 'Git', 'bin', 'bash.exe'))
  }
  return found.find((f) => exists(f)) ?? null
}

// Windows: does Git Bash run clique-sh the way Claude Code will (bash -c "'clique-sh' 'command'", with `extra` in its
// environment: the agent's PATH, { Path }, where it finds clique-sh by name), passing on the command's exit code and
// writing down its Windows id? Asked once per CLIque (it holds CLIque up for as long as Git Bash takes to start). If not,
// agents' commands run without clique-sh, rather than every one of them failing, and their process trees alone say what
// they leave running.
const tried = new Map()
export function prefixWorks(sh, bash, extra = {}) {
  const key = JSON.stringify([sh, bash, extra])
  if (!tried.has(key)) tried.set(key, tryPrefix(sh, bash, extra))
  return tried.get(key)
}

function tryPrefix(sh, bash, extra) {
  if (!bash) return false
  const file = path.join(os.tmpdir(), `clique-sh-${process.pid}-${Date.now()}`)
  const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`
  try {
    execFileSync(bash, ['-c', `${quote(sh)} ${quote('exit 7')}`], { env: { ...process.env, ...extra, CLIQUE_GROUPS: file }, stdio: 'ignore', windowsHide: true, timeout: 20000 })
    return false
  } catch (e) {
    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {}
    const ok = e.status === 7 && /^\d+ \d+\s*$/m.test(text)
    if (!ok) console.warn(`clique-sh doesn't run in ${bash} (exit ${e.status ?? e.code}), so agents' commands run without it`)
    return ok
  } finally {
    fs.rmSync(file, { force: true })
  }
}

// "node ×2, idb_companion"
export function summary(procs) {
  const counts = new Map()
  for (const p of procs) counts.set(p.name, (counts.get(p.name) ?? 0) + 1)
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ')
}

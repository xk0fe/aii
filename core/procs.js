// What an agent leaves running. Each shell command an agent runs is the leader of a process group of its own, and what
// the command leaves behind (a dev server started with &, a simulator helper) stays in that group once the command is
// done, even after its parent is gone. Crew notes the groups: bin/crew-sh writes down each command's for Claude Code,
// and the agent's process tree, looked at now and then, adds the rest for any CLI. When the agent's CLI ends, what's
// still in its groups is stopped (Hub.sweep). No Electron in here.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Every process on this computer: [{ pid, ppid, pgid, start (Unix seconds), name }]. [] if ps fails.
export function processes() {
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

// `pid` and everything under it.
export function tree(procs, pid) {
  const kids = new Map()
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p])
  const out = []
  const todo = procs.filter((p) => p.pid === pid)
  while (todo.length) {
    const p = todo.pop()
    out.push(p)
    if (p.pid !== p.ppid) todo.push(...(kids.get(p.pid) ?? []))
  }
  return out
}

// The groups an agent's process tree has right now, each with when it began: its leader's start, or its oldest
// member's once the leader is gone. -> Map(pgid -> start)
export function groupsOf(procs, pid) {
  const groups = new Map()
  for (const p of tree(procs, pid)) {
    const leader = procs.find((x) => x.pid === p.pgid)
    const start = leader ? leader.start : p.start
    if (!groups.has(p.pgid) || start < groups.get(p.pgid)) groups.set(p.pgid, start)
  }
  return groups
}

// The groups bin/crew-sh wrote down, one "pgid unix-seconds" line per command. -> Map(pgid -> start)
export function readGroups(file) {
  const groups = new Map()
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {}
  for (const line of text.split('\n')) {
    const [pgid, start] = line.trim().split(/\s+/).map(Number)
    if (pgid > 1 && start > 0 && !(start >= groups.get(pgid))) groups.set(pgid, start)
  }
  return groups
}

// The processes still in `groups`. A member counts only if it started after its group did, and only while the group's
// leader is gone or is still the process that started the group: a number the system handed out again belongs to
// someone else by then. `keep`: pids never to touch (Crew itself, other agents' CLIs and what runs under them).
export function leftovers(procs, groups, keep = new Set()) {
  const ok = new Map()
  for (const [pgid, start] of groups) {
    const leader = procs.find((p) => p.pid === pgid)
    ok.set(pgid, !leader || Math.abs(leader.start - start) <= 5)
  }
  return procs.filter((p) => p.pid > 1 && ok.get(p.pgid) && p.start >= groups.get(p.pgid) - 2 && !keep.has(p.pid))
}

// Asks them to stop, and makes sure 3 s later.
export function stop(procs) {
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

// "node ×2, idb_companion"
export function summary(procs) {
  const counts = new Map()
  for (const p of procs) counts.set(p.name, (counts.get(p.name) ?? 0) + 1)
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ')
}

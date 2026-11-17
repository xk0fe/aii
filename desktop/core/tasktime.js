// What a task took, written down as it happens: who was on it and when (several agents can be: its owner, a clone, a
// teammate it asked, the triage agent), which steps were the long ones, the files it changed and the checks it ran.
// It lives on the ticket (ticket.time), so the review of a task can say where its time went (ui/tasktime.js reads it).
// The hub calls these from setStatus and onHook (core/hub.js). No Electron in here.
import path from 'node:path'

export const SPAN_CAP = 160 // spans kept per task: past that, the two closest of one agent become one
export const STEP_CAP = 6 // the longest steps kept
export const FILE_CAP = 60
export const CHECK_CAP = 8
const JOIN = 3000 // two spans of one agent's this close are one (a permission answered at once, a hook between tools)
const SHORT = 1000 // shorter than this isn't worth a span

const timeOf = (t) => (t.time ??= { spans: [] })

// `who` was on the task from `from` to `to` (ms): 'work' in a turn on it, 'you' waiting on you in one (a question, a
// permission), 'triage' sorting it out before it starts.
export function addSpan(t, who, kind, from, to) {
  if (!(to - from >= SHORT)) return false
  const { spans } = timeOf(t)
  const last = spans.findLast((s) => s.w === who)
  if (last && last.k === kind && from - (last.at + last.ms) < JOIN && from >= last.at) last.ms = to - last.at
  else spans.push({ w: who, k: kind, at: from, ms: to - from })
  while (spans.length > SPAN_CAP) merge(spans)
  return true
}

// Too many to keep: the two neighbours of one agent and kind with the least time between them become one. How long
// each took stays exact (the sum); only where the second one sat in the picture is lost.
function merge(spans) {
  let best = null
  const lastOf = new Map()
  for (const [i, s] of spans.entries()) {
    const key = `${s.w}\u0000${s.k}`
    const j = lastOf.get(key)
    if (j !== undefined) {
      const gap = s.at - (spans[j].at + spans[j].ms)
      if (!best || gap < best.gap) best = { i, j, gap }
    }
    lastOf.set(key, i)
  }
  if (!best) return void spans.shift() // (every span a different agent's or kind: the oldest goes)
  spans[best.j].ms += spans[best.i].ms
  spans.splice(best.i, 1)
}

// One step of a turn on the task took `ms` (thinking it up and running it). Only the longest are kept.
export function addStep(t, who, text, ms) {
  if (!(ms >= SHORT) || !text) return
  const time = timeOf(t)
  const steps = (time.steps ??= [])
  steps.push({ w: who, ms: Math.round(ms), text: String(text).slice(0, 120) })
  steps.sort((x, y) => y.ms - x.ms)
  steps.length = Math.min(steps.length, STEP_CAP)
}

// A file a step changed, as its agent's folder names it (how many times it was changed).
export function addFile(t, file) {
  if (!file) return
  const time = timeOf(t)
  const files = (time.files ??= {})
  if (!(file in files) && Object.keys(files).length >= FILE_CAP) return
  files[file] = (files[file] ?? 0) + 1
}

// A check CLIque saw run on the task (a test run, a build, a lint): the last few, the latest run of each command.
export function addCheck(t, who, text, ms) {
  const time = timeOf(t)
  const checks = (time.checks ??= []).filter((c) => c.text !== text)
  checks.push({ w: who, ms: Math.round(ms), text: String(text).slice(0, 120), at: Date.now() })
  time.checks = checks.slice(-CHECK_CAP)
}

// What one agent's part cost: tokens, lines added and removed.
export function addShare(t, who, { tokens = 0, added = 0, removed = 0 }) {
  if (!(tokens > 0 || added > 0 || removed > 0)) return
  const time = timeOf(t)
  const by = ((time.by ??= {})[who] ??= { tokens: 0, added: 0, removed: 0 })
  by.tokens += tokens
  by.added += added
  by.removed += removed
}

// An agent was renamed: its part of the task goes by its new name (its clones' too: ada.2 is bea.2 now).
export function renameWho(t, from, to) {
  const time = t.time
  if (!time) return false
  const named = (w) => (w === from ? to : String(w).startsWith(`${from}.`) ? `${to}${String(w).slice(from.length)}` : w)
  let changed = false
  for (const list of [time.spans, time.steps, time.checks]) for (const x of list ?? []) if (named(x.w) !== x.w) (x.w = named(x.w)), (changed = true)
  for (const key of ['by', 'of']) {
    if (!time[key]) continue
    const next = Object.fromEntries(Object.entries(time[key]).map(([w, v]) => [named(w), key === 'of' ? named(v) : v]))
    if (JSON.stringify(next) !== JSON.stringify(time[key])) (time[key] = next), (changed = true)
  }
  return changed
}

// A sub-agent one of its agents started for it (a helper).
export function addHelper(t) {
  const time = timeOf(t)
  time.helpers = (time.helpers ?? 0) + 1
}

// A file as its agent's folder names it (src/cart.ts), or as it is when it's somewhere else.
export function inFolder(file, cwd) {
  if (!cwd || !path.isAbsolute(file)) return file
  const rel = path.relative(cwd, file)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file
}

// Does this command check the work (rather than do it)? A test run, a type check, a lint, a build.
const CHECKS = /(^|[\s;&|(/])(npm (run )?(test|lint|build|check|typecheck)|(npx |pnpm |yarn |bun )?(vitest|jest|playwright|mocha|ava|eslint|tsc|biome|prettier --check)|pnpm (run )?(test|lint|build|check|typecheck)|yarn (run )?(test|lint|build|check|typecheck)|bun (run )?(test|lint|build)|node --test|pytest|python3? -m (pytest|unittest)|go (test|vet|build)|cargo (test|check|clippy|build)|swift (test|build)|xcodebuild|gradlew? \S*(test|check|build)|mvn (test|verify)|dotnet (test|build)|make (test|check|lint)|ruff( check)?|mypy|rspec|phpunit)(\s|$)/
export function isCheck({ tool_name: tool, tool_input: input = {} } = {}) {
  if (!/^(Bash|shell|exec_command|local_shell)$/i.test(String(tool ?? ''))) return false
  const cmd = Array.isArray(input.command) ? input.command.join(' ') : String(input.command ?? '')
  return CHECKS.test(cmd)
}

// How full an agent's conversation is: { used, size, pct } in tokens. A long conversation with many unrelated
// tasks in it is where agents start mixing things up, so the UI shows this and offers a fresh start.
//   Claude Code: reports it to its status line, which CLIque points at the hub (see adapters.js).
//   Codex: writes token counts into its session log, read after each turn.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// From the JSON Claude Code gives its status line command.
export function fromStatusLine(s) {
  const w = s?.context_window
  const size = num(w?.context_window_size)
  if (!size) return null
  const u = w.current_usage
  const used = u ? num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens) : 0
  const pct = w.used_percentage == null ? (used / size) * 100 : num(w.used_percentage)
  return { used, size, pct: clamp(pct) }
}

// numbers only: this arrives over the local API
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0)

// The account's usage limits, from the same JSON. Claude Code passes on what each API response says about a
// subscription's windows (and a gateway's spend limit), each one only until it resets. Not a subscriber, before the
// first response, or a provider that doesn't report them: null. -> [{ id, pct, resetsAt }], resetsAt in ms.
export const LIMITS = { five_hour: '5-hour limit', seven_day: 'weekly limit', spend_limit: 'spend limit' }
export function limitsFrom(s, now = Date.now()) {
  const r = s?.rate_limits
  if (!r || typeof r !== 'object') return null
  const windows = []
  for (const id of Object.keys(LIMITS)) {
    const pct = real(r[id]?.used_percentage)
    const resets = real(r[id]?.resets_at) // Unix seconds
    if (pct === null || resets === null || resets * 1000 <= now) continue
    windows.push({ id, pct: clamp(pct), resetsAt: Math.round(resets * 1000) })
  }
  return windows.length ? windows : null
}

const real = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Codex treats this much as always in use (instructions, tools) when it shows "context left"; same math here.
const CODEX_BASELINE = 12000

// The end of a Codex session log, where the newest token count is. null if it can't be read.
function tail(file) {
  try {
    const fd = fs.openSync(file, 'r')
    const { size } = fs.fstatSync(fd)
    const len = Math.min(size, 512 * 1024)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    fs.closeSync(fd)
    return buf.toString('utf8')
  } catch {
    return null
  }
}

export function fromCodexLog(file) {
  const text = tail(file)
  if (text === null) return null
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"token_count"')) continue
    let info
    try {
      info = JSON.parse(lines[i]).payload?.info
    } catch {
      continue
    }
    const size = info?.model_context_window
    const used = info?.last_token_usage?.total_tokens
    if (!size || used === undefined) continue
    return { used, size, pct: clamp(size > CODEX_BASELINE ? ((used - CODEX_BASELINE) / (size - CODEX_BASELINE)) * 100 : 100) }
  }
  return null
}

// Codex's usage limits, from the same log: each token count also carries its account's rate limits, a primary and a
// secondary window, each as a share of a window so many minutes long (Codex's weekly limit is 10080). The newest
// reading wins. -> { windows: [{ id, pct, resetsAt, label? }], credits?: { balance, unlimited } }, or null.
export function codexLimitsFrom(file, now = Date.now()) {
  const text = tail(file)
  if (text === null) return null
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue
    let r
    try {
      r = JSON.parse(lines[i]).payload?.rate_limits
    } catch {
      continue
    }
    // another meter than the account's own (Codex names it "codex"): not the account's limits
    if (!r || typeof r !== 'object' || (r.limit_id != null && r.limit_id !== 'codex')) continue
    const windows = [r.primary, r.secondary].map((w) => codexWindow(w, now)).filter(Boolean)
    const c = r.credits
    const balance = Number(c?.balance)
    const credits = c && typeof c === 'object' && c.has_credits ? { unlimited: c.unlimited === true, ...(Number.isFinite(balance) && { balance }) } : null
    if (!windows.length && !credits) continue
    return { windows, ...(credits && { credits }) }
  }
  return null
}

function codexWindow(w, now) {
  const pct = real(w?.used_percent)
  const minutes = real(w?.window_minutes)
  const resets = real(w?.resets_at) // Unix seconds
  if (pct === null || !(minutes > 0) || resets === null || resets * 1000 <= now) return null
  const id = minutes === 300 ? 'five_hour' : minutes === 10080 ? 'seven_day' : `window_${minutes}`
  const label = LIMITS[id] ? undefined : `${minutes % 1440 === 0 ? `${minutes / 1440}-day` : minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`} limit`
  return { id, pct: clamp(pct), resetsAt: Math.round(resets * 1000), ...(label && { label }) }
}

// What a window is called: "weekly limit", or what Codex's own windows say they are.
export const limitName = (w) => LIMITS[w.id] ?? w.label ?? 'limit'

// Codex names its session logs rollout-<time>-<session id>.jsonl, in sessions/YYYY/MM/DD. Newest days first.
const found = new Map()
export function codexLog(sessionId, home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  if (!sessionId) return null
  if (found.has(sessionId)) return found.get(sessionId)
  const desc = (dir) => {
    try {
      return fs.readdirSync(dir).sort().reverse()
    } catch {
      return []
    }
  }
  const root = path.join(home, 'sessions')
  for (const y of desc(root)) {
    for (const m of desc(path.join(root, y))) {
      for (const d of desc(path.join(root, y, m))) {
        const name = desc(path.join(root, y, m, d)).find((f) => f.endsWith(`${sessionId}.jsonl`))
        if (!name) continue
        const file = path.join(root, y, m, d, name)
        found.set(sessionId, file)
        return file
      }
    }
  }
  return null
}

// An agent's own context limit, below its model's window: the numbers measured against that instead, so a 1M
// model held to 250k reads 80% at 200k. `window` keeps the model's real size.
export function againstLimit(ctx, limit) {
  limit = Number(limit)
  if (!ctx || !(limit > 0) || limit >= ctx.size) return ctx
  return { ...ctx, size: limit, window: ctx.size, limit, pct: clamp((ctx.used / limit) * 100) }
}

// 1.2M, 340k, 900
export const tokens = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

const clamp = (pct) => Math.max(0, Math.min(100, Math.round(pct)))

// ---- spend: what a session has used so far, as its CLI counts it ------------------------------------------------

// Claude Code's own running total for the session, from the status line JSON: what it cost (as /cost prices it, at
// list price or your organization's rates), the lines it changed and the time spent waiting on the API. Each number is
// the session's total so far. Numbers only: this arrives over the local API. -> { cost, added, removed, apiMs } or null
export function spentFrom(s) {
  const c = s?.cost
  if (!c || typeof c !== 'object' || real(c.total_cost_usd) === null) return null
  return { cost: Math.max(0, c.total_cost_usd), added: whole(c.total_lines_added), removed: whole(c.total_lines_removed), apiMs: whole(c.total_api_duration_ms) }
}

const whole = (v) => (real(v) === null ? 0 : Math.max(0, Math.round(v)))

// Codex reports tokens, not money: the newest running total in its session log. -> { tokens } or null
export function codexSpent(file) {
  const text = tail(file)
  const lines = text?.split('\n') ?? []
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"total_token_usage"')) continue
    try {
      const total = JSON.parse(lines[i]).payload?.info?.total_token_usage
      if (total && typeof total === 'object') return { tokens: whole(real(total.total_tokens) ?? (real(total.input_tokens) ?? 0) + (real(total.output_tokens) ?? 0)) }
    } catch {}
  }
  return null
}

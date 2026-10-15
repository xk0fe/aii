// How full an agent's conversation is: { used, size, pct } in tokens. A long conversation with many unrelated
// tasks in it is where agents start mixing things up, so the UI shows this and offers a fresh start.
//   Claude Code: reports it to its status line, which Crew points at the hub (see adapters.js).
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

export function fromCodexLog(file) {
  let text
  try {
    const fd = fs.openSync(file, 'r')
    const { size } = fs.fstatSync(fd)
    const len = Math.min(size, 512 * 1024) // the newest count is near the end
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    fs.closeSync(fd)
    text = buf.toString('utf8')
  } catch {
    return null
  }
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

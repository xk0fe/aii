// Usage, day by day: what Claude Code and Codex used on this computer, for the Usage view's calendars. Read from the
// CLIs' own logs, the only record there is of it (CLIque's agents and anything you ran outside CLIque alike): Claude
// Code's transcripts say what each API response used and which model answered; Codex's session logs keep a running
// token count. Nothing is sent anywhere, and no message is kept: only numbers per day.
//
// The index (history.json in CLIque's folder) holds what each log added, so a log is read once and then only where it
// grew, and a day stays counted after its log is gone (Claude Code deletes transcripts after 30 days). Reading runs in
// a worker thread: a first look can be gigabytes. No Electron in here.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { costOf } from './backfill.js'

const VERSION = 1
const CHUNK = 4 * 1024 * 1024
const MARK = 64 // the bytes before where reading stopped: the same next time, or the log was rewritten
const ACTIVE = 2 * 864e5 // a session heard from this recently may still write: its responses' ids are kept to tell copies

export const emptyIndex = () => ({ v: VERSION, at: 0, files: {}, kept: {} })
// What was saved, as an index: anything from another version, or not an index at all, starts over.
const asIndex = (x) => (x?.v === VERSION && typeof x.files === 'object' && x.files && typeof x.kept === 'object' && x.kept ? { ...x, at: Number.isFinite(x.at) ? x.at : 0 } : emptyIndex())

const localDay = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// When a line was written, in ms: the logs' own ISO time. Anything else (a number, a year nobody logged in) is no time.
const FIRST = Date.UTC(2020, 0, 1)
function when(ts) {
  const t = typeof ts === 'string' ? Date.parse(ts) : NaN
  return t >= FIRST && t <= Date.now() + 2 * 864e5 ? t : NaN
}
const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0)
const base = (name) => String(name).replace(/\.\d+$/, '') // a clone's work is its original's
const json = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ---- a log's lines, from where reading stopped -------------------------------------------------------------------
// Whole lines only (one still being written waits for the next look), and only the ones that have one of `needles` in
// them: most of a log is tool output nobody needs to parse. -> where the last whole line ended.
function eachLine(fd, from, needles, fn) {
  const buf = Buffer.allocUnsafe(CHUNK)
  let pos = from
  let end = from
  let parts = [] // a line longer than a chunk, so far
  for (;;) {
    const n = fs.readSync(fd, buf, 0, CHUNK, pos)
    if (!n) break
    let start = 0
    for (;;) {
      const nl = buf.indexOf(10, start)
      if (nl < 0 || nl >= n) break
      let line = buf.subarray(start, nl)
      if (parts.length) {
        line = Buffer.concat([...parts, line])
        parts = []
      }
      end = pos + nl + 1
      start = nl + 1
      if (needles.some((x) => line.indexOf(x) >= 0)) fn(line)
    }
    if (start < n) parts.push(Buffer.from(buf.subarray(start, n)))
    pos += n
  }
  return end
}

function markAt(fd, offset) {
  const len = Math.min(MARK, offset)
  if (!len) return ''
  const buf = Buffer.alloc(len)
  fs.readSync(fd, buf, 0, len, offset - len)
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)
}

function head(fd, len) {
  const buf = Buffer.alloc(len)
  return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, len, 0))
}

// A day of one log: m (messages sent to it), and per model [responses, input, output, cached input read, cache
// written, cost at list prices].
function addTo(days, day, model, [n, input, output, read, write, cost]) {
  const d = (days[day] ??= { m: 0, models: {} })
  const row = (d.models[model] ??= [0, 0, 0, 0, 0, 0])
  row[0] += n
  row[1] += input
  row[2] += output
  row[3] += read
  row[4] += write
  row[5] += cost
}

// ---- Claude Code: a transcript ------------------------------------------------------------------------------------
// An API response is written as several lines (one per block of it), each with the same usage: counted once. A
// sub-agent that carries on from another's conversation gets a copy of its responses, ids and all, so a response is
// also counted once across a session's logs (taken: is this id another log's of the same session?). A message is a
// prompt someone typed or sent (not a tool's result, a note of Claude Code's own, or a sub-agent's brief).
const N_ASSISTANT = Buffer.from('"type":"assistant"')
const N_USER = Buffer.from('"type":"user"')
const N_RESULT = Buffer.from('"tool_use_id"')
const N_NAME = Buffer.from('"type":"agent-name"')
const OWN_NOTE = /^\s*<(local-command|command-|system-reminder|task-notification|bash-)/
const promptText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text ?? '' : b?.type === 'image' ? 'image' : '')).join(' ') : '').trim()
// A response's id, short: the ends of its message id and its request's (their starts are all alike). Neither: no id,
// so it's never taken for another.
const idOf = (m, x) => (m.id || x.requestId ? `${String(m.id ?? '').slice(-12)}|${String(x.requestId ?? '').slice(-6)}` : null)

function readClaude(fd, from, e, taken) {
  const seen = new Set(e.seen ?? [])
  const offset = eachLine(fd, from, [N_ASSISTANT, N_USER, N_NAME], (line) => {
    if (line.indexOf(N_ASSISTANT) >= 0) {
      const x = json(line.toString('utf8'))
      const m = x?.message
      const t = when(x?.timestamp)
      if (x?.type !== 'assistant' || !m?.usage || !m.model || m.model === '<synthetic>' || !Number.isFinite(t)) return
      if (!e.dir && typeof x.cwd === 'string') e.dir = x.cwd // the folder it worked in (its first: a session rarely moves)
      const id = idOf(m, x)
      if (id && (seen.has(id) || taken?.(id))) return
      if (id) seen.add(id)
      const u = m.usage
      addTo(e.days, localDay(t), m.model, [1, num(u.input_tokens), num(u.output_tokens), num(u.cache_read_input_tokens), num(u.cache_creation_input_tokens), costOf(u, m.model) ?? 0])
    } else if (line.indexOf(N_NAME) >= 0) {
      if (!e.who) e.who = json(line.toString('utf8'))?.agentName || e.who
    } else if (line.indexOf(N_RESULT) < 0) {
      const x = json(line.toString('utf8'))
      const t = when(x?.timestamp)
      if (x?.type !== 'user' || x.isMeta || x.isSidechain || x.isCompactSummary || !Number.isFinite(t)) return
      const text = promptText(x.message?.content)
      if (!text || OWN_NOTE.test(text)) return
      ;(e.days[localDay(t)] ??= { m: 0, models: {} }).m += 1
    }
  })
  e.seen = [...seen] // while the session may still write (scan drops them once it's gone quiet)
  return offset
}

// ---- Codex: a session log -------------------------------------------------------------------------------------------
// Its token counts are running totals for the session (input includes what was cached): what grew since the last one
// is what that step used, and a total that drops started over. The model is the turn's (older logs don't say which:
// ''), and each turn that starts is a message it got. Whose it is, when CLIque started it, is in the turn's
// instructions: looked for until it's found (a look can land before the first turn is written).
const N_TOKENS = Buffer.from('"token_count"')
const N_TURN = Buffer.from('"turn_context"')
const N_TURN_START = Buffer.from('"task_started"')
const N_META = Buffer.from('"session_meta"')
const CODEX_NAME = /You are \\+"([A-Za-z0-9._-]+)\\+", one of several AI agents/

function readCodex(fd, from, e) {
  let last = e.last ?? { input: 0, cached: 0, output: 0, total: 0 }
  const offset = eachLine(fd, from, [N_TOKENS, N_TURN, N_TURN_START, N_META], (line) => {
    const text = line.toString('utf8')
    const x = json(text)
    const p = x?.payload
    if (!p || typeof p !== 'object') return
    if (x.type === 'session_meta' || x.type === 'turn_context') {
      if (!e.who) e.who = text.match(CODEX_NAME)?.[1] ?? null
      if (x.type === 'turn_context') return void (typeof p.model === 'string' && p.model && (e.model = p.model))
      e.via ||= typeof p.model_provider === 'string' ? p.model_provider : ''
      if (!e.dir && typeof p.cwd === 'string') e.dir = p.cwd
      return
    }
    const t = when(x.timestamp)
    if (x.type !== 'event_msg' || !Number.isFinite(t)) return
    if (p.type === 'task_started') return void ((e.days[localDay(t)] ??= { m: 0, models: {} }).m += 1)
    const total = p.type === 'token_count' && p.info?.total_token_usage
    if (!total || typeof total !== 'object') return
    const now = { input: num(total.input_tokens), cached: num(total.cached_input_tokens), output: num(total.output_tokens), total: num(total.total_tokens) || num(total.input_tokens) + num(total.output_tokens) }
    if (now.total < last.total) last = { input: 0, cached: 0, output: 0, total: 0 }
    const grew = { input: Math.max(0, now.input - last.input), cached: Math.max(0, now.cached - last.cached), output: Math.max(0, now.output - last.output) }
    const more = now.total > last.total
    last = now
    if (more) addTo(e.days, localDay(t), e.model || '', [1, Math.max(0, grew.input - grew.cached), grew.output, grew.cached, 0, 0])
  })
  e.last = last
  return offset
}

// Whose a log is, from its first lines: CLIque starts Claude Code with --name, and its prompt for Codex says "You are
// "ada", one of several AI agents". A sub-agent's transcript sits in its session's folder, and is that session's.
const CLAUDE_NAME = /"agentName":"([^"\\]+)"/
const sessionOf = (file) => {
  const parts = file.split(path.sep)
  const sub = parts.lastIndexOf('subagents')
  return sub < 2 ? null : `${parts.slice(0, sub).join(path.sep)}.jsonl`
}
function whoOf(fd, file, cli) {
  if (cli === 'codex') return head(fd, 512 * 1024).match(CODEX_NAME)?.[1] ?? null
  const session = sessionOf(file)
  if (!session) return head(fd, 64 * 1024).match(CLAUDE_NAME)?.[1] ?? null
  try {
    const parent = fs.openSync(session, 'r')
    try {
      return head(parent, 64 * 1024).match(CLAUDE_NAME)?.[1] ?? null
    } finally {
      fs.closeSync(parent)
    }
  } catch {
    return null
  }
}

// One log, read from where the last look stopped when it only grew since (the bytes before that spot are the same),
// from its start otherwise. prev: what the index has for it. taken(id): a response another log of its session has
// counted. -> its entry.
export function readLog(file, { cli, pin = null, size, mtime }, prev = null, { taken } = {}) {
  const fd = fs.openSync(file, 'r')
  try {
    const on = prev && prev.cli === cli && prev.offset > 0 && size >= prev.offset && markAt(fd, prev.offset) === prev.mark
    const e = on ? { ...prev, days: structuredClone(prev.days) } : { cli, ...(pin && { pin }), who: null, ...(sessionOf(file) && { sub: true }), days: {} }
    if (!e.who) e.who = whoOf(fd, file, cli) // until it has a name: a log's first lines can be written after a first look
    e.offset = cli === 'codex' ? readCodex(fd, on ? prev.offset : 0, e) : readClaude(fd, on ? prev.offset : 0, e, taken)
    e.mark = markAt(fd, e.offset)
    e.size = size
    e.mtime = mtime
    return e
  } finally {
    fs.closeSync(fd)
  }
}

// ---- every log ------------------------------------------------------------------------------------------------------

// The logs under a folder, and the folders in it that couldn't be listed (blocked: what the index has from there stays
// as it is, and the rest is still read). null: the folder itself isn't there or can't be read.
function logsUnder(root) {
  const out = []
  const blocked = []
  const walk = (dir, top) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      if (top) return false
      blocked.push(dir + path.sep)
      return true
    }
    for (const x of entries) {
      const file = path.join(dir, x.name)
      if (x.isDirectory()) walk(file, false)
      else if (x.name.endsWith('.jsonl')) {
        try {
          const st = fs.statSync(file)
          if (st.isFile()) out.push({ file, cli: root.cli, pin: root.provider ?? null, size: st.size, mtime: Math.round(st.mtimeMs) })
        } catch {}
      }
    }
    return true
  }
  return walk(root.dir, true) ? { logs: out, blocked } : null
}

// Which log this is, wherever it sits: a session's log is named by its id, a sub-agent's by its own in its session's
// folder. A log that turns up under another folder (an agent moved, a project folder renamed) is the same log.
const logId = (l) => {
  const parts = l.file.split(path.sep)
  const sub = parts.lastIndexOf('subagents')
  return `${l.cli}:${sub >= 2 ? `${parts[sub - 1]}/` : ''}${parts.at(-1)}`
}
// The logs of one session, which may copy each other's responses: a Claude Code session and its sub-agents.
const groupOf = (file, cli) => (cli === 'claude' ? sessionOf(file) ?? file : null)

// The model most of a day's tokens went to (the log's most used, for a day with messages and no answer yet): the day's
// messages and its session are filed under that model's provider.
const tokensOf = (r) => r[1] + r[2] + r[3] + r[4]
const most = (totals) => Object.entries(totals).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0]
function leadOf(e) {
  const all = {}
  for (const d of Object.values(e.days ?? {})) for (const [model, r] of Object.entries(d.models ?? {})) all[model] = (all[model] ?? 0) + tokensOf(r)
  const overall = most(all) ?? ''
  return (d) => most(Object.fromEntries(Object.entries(d.models ?? {}).map(([model, r]) => [model, tokensOf(r)]))) ?? overall
}

// A sub-agent's log is its session's: whose it is and where it ran, when its own lines don't say.
function sourceOf(index, file, e) {
  if (!e.sub || (e.who && e.dir)) return e
  const parent = index.files[sessionOf(file)]
  return parent ? { ...e, who: e.who ?? parent.who, dir: e.dir ?? parent.dir } : e
}

// A log that's gone (Claude Code cleaned it up): its days are kept, added up with the others of its kind. A kept day:
// its models, and under each model that led a log's day, [messages, sessions].
function keep(index, e) {
  const k = (index.kept[JSON.stringify([e.cli, e.via ?? '', e.pin ?? '', e.who ?? '', e.dir ?? ''])] ??= {})
  const lead = leadOf(e)
  for (const [day, d] of Object.entries(e.days)) {
    const into = (k[day] ??= { models: {}, lead: {} })
    for (const [model, row] of Object.entries(d.models)) addTo(k, day, model, row)
    const by = (into.lead[lead(d)] ??= [0, 0])
    by[0] += d.m
    by[1] += e.sub ? 0 : 1
  }
}

// Bring the index up to date. roots: [{ dir, cli: 'claude' | 'codex', provider? }] (provider: a folder that's one of
// your own providers', whatever its model is called). Newest logs first, so the days nearest today fill in first.
// onProgress({ done, total, files }): bytes read of the bytes to read; given often, and once more at the end.
export function scan(index, roots, { onProgress } = {}) {
  index = asIndex(index)
  const found = new Map() // path -> the log there
  const listed = [] // the roots that could be listed
  const blocked = [] // and the folders in them that couldn't
  for (const root of roots) {
    const under = logsUnder(root)
    if (!under) continue
    listed.push(path.resolve(root.dir) + path.sep)
    blocked.push(...under.blocked)
    for (const l of under.logs) found.set(l.file, l)
  }
  // one log per id: a copy left behind where a log moved from isn't counted beside it (the bigger one is the live one)
  const byId = new Map()
  for (const l of found.values()) {
    const id = logId(l)
    const other = byId.get(id)
    if (!other || l.size > other.size || (l.size === other.size && l.mtime > other.mtime)) byId.set(id, l)
  }
  for (const l of [...found.values()]) if (byId.get(logId(l)) !== l) found.delete(l.file)
  // a log the index knows under another path, which isn't there any more: it moved, and carries on where it was read to
  const gone = (file) => !found.has(file) && listed.some((dir) => path.resolve(file).startsWith(dir)) && !blocked.some((dir) => file.startsWith(dir))
  for (const [file, e] of Object.entries(index.files)) {
    if (found.has(file)) continue
    const moved = byId.get(logId({ file, cli: e.cli }))
    if (!moved || index.files[moved.file] || !gone(file)) continue
    index.files[moved.file] = e
    delete index.files[file]
  }

  // A session heard from lately may still write, and copy: its logs keep their responses' ids between looks. One
  // that's gone quiet has no copies still to come, and its ids go (they're most of what a log's entry weighs).
  const started = Date.now()
  const heard = new Map()
  for (const l of found.values()) {
    const group = groupOf(l.file, l.cli)
    if (group) heard.set(group, Math.max(heard.get(group) ?? 0, l.mtime))
  }
  const quiet = (file, cli) => started - (heard.get(groupOf(file, cli)) ?? 0) > ACTIVE
  // the ids each session's logs have counted, so a copy in another of its logs isn't counted again: id -> the log
  const sessions = new Map()
  const idsOf = (group) => {
    let ids = sessions.get(group)
    if (ids) return ids
    sessions.set(group, (ids = new Map()))
    for (const [file, e] of Object.entries(index.files)) if (e.seen && groupOf(file, e.cli) === group) for (const id of e.seen) ids.set(id, file)
    return ids
  }

  const todo = [...found.values()].filter((l) => {
    const e = index.files[l.file]
    return !e || e.size !== l.size || e.mtime !== l.mtime || e.cli !== l.cli
  }).sort((x, y) => y.mtime - x.mtime)
  const total = todo.reduce((n, l) => n + Math.max(0, l.size - (index.files[l.file]?.offset ?? 0)), 0)
  let done = 0
  todo.forEach((l, i) => {
    const prev = index.files[l.file]
    const group = groupOf(l.file, l.cli)
    const ids = group && idsOf(group)
    try {
      const e = readLog(l.file, l, prev, { taken: ids && ((id) => ids.has(id) && ids.get(id) !== l.file) })
      index.files[l.file] = e
      if (ids) {
        for (const id of prev?.seen ?? []) if (ids.get(id) === l.file) ids.delete(id)
        for (const id of e.seen ?? []) ids.set(id, l.file)
      }
      if (quiet(l.file, l.cli)) delete e.seen // (this look still knows them, for the session's other logs)
    } catch {} // gone or unreadable right now: the next look tries again
    done += Math.max(0, l.size - (prev?.offset ?? 0))
    onProgress?.({ done, total, files: todo.length - i - 1 })
  })

  // logs that are gone give their days to `kept` (resolved first: a sub-agent's log may need its session's, going too)
  const going = Object.entries(index.files).filter(([file]) => gone(file)).map(([file, e]) => [file, sourceOf(index, file, e)])
  for (const [file, e] of going) {
    keep(index, e)
    delete index.files[file]
  }
  for (const [file, e] of Object.entries(index.files)) if (e.seen && quiet(file, e.cli)) delete e.seen
  index.at = Date.now()
  return index
}

// ---- what the Usage view draws ----------------------------------------------------------------------------------------

// Which of your providers a log's model is: Claude Code runs Claude, GLM and your own Anthropic-compatible ones; Codex
// runs OpenAI's models and, through Ollama, the ones on your machine. providers: config's, as { id: { cli, models } }.
export function providerOf({ cli, via, pin, model }, providers = {}) {
  if (pin && providers[pin]) return pin
  const own = Object.entries(providers).find(([id, p]) => id !== 'claude' && id !== 'codex' && (p?.cli ?? 'claude') === cli && (p?.models ?? []).includes(model))?.[0]
  if (cli === 'codex') return via && via !== 'openai' ? own ?? (providers.local ? 'local' : 'codex') : 'codex'
  if (/^claude/i.test(model)) return 'claude'
  return own ?? (/^glm/i.test(model) && providers.glm ? 'glm' : 'claude')
}

// The index as days per provider. names: the clique's agents, whose work is listed under their names (anything else is
// what you ran outside CLIque: who ''), and where: the folder each session worked in ('' when its log doesn't say). ->
// { first, providers: { id: { days: { 'YYYY-MM-DD': { tokens, input, output, cached, written, replies, messages, cost,
//   sessions, models: { model: tokens }, who: { name: tokens }, where: { folder: tokens } } } } } }
// The same whether a log is still there or its days are kept: a summary doesn't change when a log goes.
export function summarize(index, { names = [], providers = {} } = {}) {
  const clique = new Set(names)
  const out = {}
  let first = null
  const dayOf = (id, day) => {
    if (!first || day < first) first = day
    return ((out[id] ??= { days: {} }).days[day] ??= { tokens: 0, input: 0, output: 0, cached: 0, written: 0, replies: 0, messages: 0, cost: 0, sessions: 0, models: {}, who: {}, where: {} })
  }
  // a source's day: its tokens to each model's provider, then what `led` says of its messages and sessions
  const add = (src, day, models, led) => {
    const who = src.who && clique.has(base(src.who)) ? base(src.who) : ''
    const where = src.dir ?? ''
    for (const [model, [n, input, output, read, write, cost]] of Object.entries(models)) {
      const tokens = input + output + read + write
      const x = dayOf(providerOf({ ...src, model }, providers), day)
      x.tokens += tokens
      x.input += input
      x.output += output
      x.cached += read
      x.written += write
      x.replies += n
      x.cost += cost
      x.models[model] = (x.models[model] ?? 0) + tokens
      x.who[who] = (x.who[who] ?? 0) + tokens
      x.where[where] = (x.where[where] ?? 0) + tokens
    }
    for (const [model, [messages, sessions]] of led) {
      if (!messages && !sessions) continue
      const x = dayOf(providerOf({ ...src, model }, providers), day)
      x.messages += messages
      x.sessions += sessions
    }
  }
  for (const [file, e] of Object.entries(index?.files ?? {})) {
    const src = sourceOf(index, file, e)
    const lead = leadOf(e)
    for (const [day, d] of Object.entries(e.days ?? {})) add(src, day, d.models ?? {}, [[lead(d), [d.m ?? 0, e.sub ? 0 : 1]]])
  }
  for (const [key, days] of Object.entries(index?.kept ?? {})) {
    const [cli, via, pin, who, dir] = JSON.parse(key)
    for (const [day, d] of Object.entries(days)) add({ cli, via, pin, who, dir }, day, d.models ?? {}, Object.entries(d.lead ?? {}))
  }
  return { first, providers: out }
}

// ---- in the app: the index on disk, brought up to date in a worker thread ------------------------------------------

const FRESH = 90 * 1000 // a look this recent is the answer; anything older starts another

export class History {
  // roots: () => [{ dir, cli, provider? }], asked before each look (a provider of your own can add a folder).
  constructor({ file, roots, worker = true }) {
    this.file = file
    this.roots = roots
    this.worker = worker
    this.index = null
    this.progress = null
    this.running = null
  }

  load() {
    if (this.index) return this.index
    let saved = null
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {}
    this.index = asIndex(saved)
    return this.index
  }

  // What's known now, when the logs were last read through (at: 0 before the first time), and whether a look is under
  // way ({ done, total } in bytes): the page asks again until it isn't.
  state(opts) {
    const index = this.load()
    if (!this.running && Date.now() - index.at > FRESH) this.refresh().catch(() => {})
    return { ...summarize(this.index, opts), at: this.index.at, reading: this.progress }
  }

  refresh() {
    if (this.running) return this.running
    this.load()
    this.progress = { done: 0, total: 0 }
    const done = () => {
      this.running = null
      this.progress = null
    }
    let look
    try {
      look = this.worker ? this.inWorker(this.roots()) : this.inline(this.roots())
    } catch (e) {
      look = Promise.reject(e) // the folders to read couldn't be said
    }
    this.running = look.then(done, (e) => {
      done()
      this.index.at = Date.now() // a look that failed isn't tried again on every ask, and the page isn't left waiting
      throw e
    })
    return this.running
  }

  async inline(roots) {
    await new Promise((r) => setImmediate(r)) // like the worker: whoever asked hears a look is under way first
    this.index = scan(this.index, roots, { onProgress: (p) => (this.progress = p) })
    save(this.file, this.index)
  }

  inWorker(roots) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./history.js', import.meta.url), { workerData: { history: { file: this.file, roots } } })
      worker.unref()
      worker.on('message', (m) => {
        if (m.progress) this.progress = m.progress
        if (m.index) this.index = m.index
        if (m.error) reject(new Error(m.error))
        if (m.done || m.error) worker.terminate()
        if (m.done) resolve()
      })
      worker.once('error', reject)
      worker.once('exit', () => reject(new Error('the usage history stopped before it finished'))) // (after a resolve, nothing)
    })
  }
}

function save(file, index) {
  try {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(index))
    fs.renameSync(`${file}.tmp`, file)
  } catch {} // CLIque's folder gone: the next look reads the logs again
}

// The worker: reads its own copy of the index, says how far along it is, and hands the index over as it fills (so the
// calendar does too) and when it's done. Saved along the way: quitting mid-look keeps what was read.
if (!isMainThread && workerData?.history) {
  const { file, roots } = workerData.history
  try {
    let index = emptyIndex()
    try {
      index = asIndex(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch {}
    let told = 0
    let saved = Date.now()
    index = scan(index, roots, {
      onProgress: (progress) => {
        const now = Date.now()
        if (now - told < 1200) return void parentPort.postMessage({ progress })
        told = now
        parentPort.postMessage({ progress, index })
        if (now - saved < 15000) return
        saved = now
        save(file, index)
      },
    })
    save(file, index)
    parentPort.postMessage({ index, done: true })
  } catch (e) {
    parentPort.postMessage({ error: e?.message ?? String(e) })
  }
}

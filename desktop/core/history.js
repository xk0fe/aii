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

export const emptyIndex = () => ({ v: VERSION, at: 0, files: {}, kept: {} })

const localDay = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
// message is a prompt someone typed or sent (not a tool's result, a note of Claude Code's own, or a sub-agent's brief).
const N_ASSISTANT = Buffer.from('"type":"assistant"')
const N_USER = Buffer.from('"type":"user"')
const N_RESULT = Buffer.from('"tool_use_id"')
const N_NAME = Buffer.from('"type":"agent-name"')
const OWN_NOTE = /^\s*<(local-command|command-|system-reminder|task-notification|bash-)/
const promptText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text ?? '' : b?.type === 'image' ? 'image' : '')).join(' ') : '').trim()

function readClaude(fd, from, e) {
  const seen = new Set(e.seen ?? [])
  const recent = [...seen]
  const offset = eachLine(fd, from, [N_ASSISTANT, N_USER, N_NAME], (line) => {
    if (line.indexOf(N_ASSISTANT) >= 0) {
      const x = json(line.toString('utf8'))
      const m = x?.message
      const t = Date.parse(x?.timestamp)
      if (x?.type !== 'assistant' || !m?.usage || !m.model || m.model === '<synthetic>' || !Number.isFinite(t)) return
      if (!e.dir && typeof x.cwd === 'string') e.dir = x.cwd // the folder it worked in (its first: a session rarely moves)
      const key = `${m.id}|${x.requestId}`
      if (seen.has(key)) return
      seen.add(key)
      recent.push(key)
      const u = m.usage
      addTo(e.days, localDay(t), m.model, [1, num(u.input_tokens), num(u.output_tokens), num(u.cache_read_input_tokens), num(u.cache_creation_input_tokens), costOf(u, m.model) ?? 0])
    } else if (line.indexOf(N_NAME) >= 0) {
      if (!e.who) e.who = json(line.toString('utf8'))?.agentName || e.who
    } else if (line.indexOf(N_RESULT) < 0) {
      const x = json(line.toString('utf8'))
      const t = Date.parse(x?.timestamp)
      if (x?.type !== 'user' || x.isMeta || x.isSidechain || x.isCompactSummary || !Number.isFinite(t)) return
      const text = promptText(x.message?.content)
      if (!text || OWN_NOTE.test(text)) return
      ;(e.days[localDay(t)] ??= { m: 0, models: {} }).m += 1
    }
  })
  e.seen = recent.slice(-40) // a response half written when reading stopped isn't counted again
  return offset
}

// ---- Codex: a session log -------------------------------------------------------------------------------------------
// Its token counts are running totals for the session (input includes what was cached): what grew since the last one
// is what that step used, and a total that drops started over. The model is the turn's (older logs don't say which:
// ''), and each turn that starts is a message it got.
const N_TOKENS = Buffer.from('"token_count"')
const N_TURN = Buffer.from('"turn_context"')
const N_TURN_START = Buffer.from('"task_started"')
const N_META = Buffer.from('"session_meta"')

function readCodex(fd, from, e) {
  let last = e.last ?? { input: 0, cached: 0, output: 0, total: 0 }
  const offset = eachLine(fd, from, [N_TOKENS, N_TURN, N_TURN_START, N_META], (line) => {
    const x = json(line.toString('utf8'))
    const p = x?.payload
    if (!p || typeof p !== 'object') return
    if (x.type === 'session_meta') {
      e.via ||= typeof p.model_provider === 'string' ? p.model_provider : ''
      if (!e.dir && typeof p.cwd === 'string') e.dir = p.cwd
      return
    }
    if (x.type === 'turn_context') return void (typeof p.model === 'string' && p.model && (e.model = p.model))
    const t = Date.parse(x.timestamp)
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

// Whose a log is: CLIque starts Claude Code with --name, and its prompt for Codex says "You are "ada", one of several AI
// agents". A sub-agent's transcript sits in its session's folder, and is that session's.
const CLAUDE_NAME = /"agentName":"([^"\\]+)"/
const CODEX_NAME = /You are \\+"([A-Za-z0-9._-]+)\\+", one of several AI agents/
function whoOf(fd, file, cli) {
  if (cli === 'codex') return head(fd, 512 * 1024).match(CODEX_NAME)?.[1] ?? null
  const parts = file.split(path.sep)
  const sub = parts.lastIndexOf('subagents')
  if (sub < 2) return head(fd, 64 * 1024).match(CLAUDE_NAME)?.[1] ?? null
  try {
    const parent = fs.openSync(`${parts.slice(0, sub).join(path.sep)}.jsonl`, 'r')
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
// from its start otherwise. prev: what the index has for it. -> its entry.
export function readLog(file, { cli, pin = null, size, mtime }, prev = null) {
  const fd = fs.openSync(file, 'r')
  try {
    const on = prev && prev.cli === cli && prev.offset > 0 && size >= prev.offset && markAt(fd, prev.offset) === prev.mark
    const e = on
      ? { ...prev, days: structuredClone(prev.days) }
      : { cli, ...(pin && { pin }), who: whoOf(fd, file, cli), ...(file.includes(`${path.sep}subagents${path.sep}`) && { sub: true }), days: {} }
    e.offset = (cli === 'codex' ? readCodex : readClaude)(fd, on ? prev.offset : 0, e)
    e.mark = markAt(fd, e.offset)
    e.size = size
    e.mtime = mtime
    if (cli === 'claude' && Date.now() - mtime > 2 * 864e5) delete e.seen // a log that's done has no response half written
    return e
  } finally {
    fs.closeSync(fd)
  }
}

// ---- every log ------------------------------------------------------------------------------------------------------

function logsUnder(root) {
  const out = []
  let names
  try {
    names = fs.readdirSync(root.dir, { recursive: true })
  } catch {
    return null // not there, or can't be read: what the index has of it stays as it is
  }
  for (const name of names) {
    if (!String(name).endsWith('.jsonl')) continue
    const file = path.join(root.dir, String(name))
    try {
      const st = fs.statSync(file)
      if (st.isFile()) out.push({ file, cli: root.cli, pin: root.provider ?? null, size: st.size, mtime: Math.round(st.mtimeMs) })
    } catch {}
  }
  return out
}

// A log that's gone (Claude Code cleaned it up): its days are kept, added up with the others of its kind.
function keep(index, e) {
  const k = (index.kept[JSON.stringify([e.cli, e.via ?? '', e.pin ?? '', e.who ?? '', e.dir ?? ''])] ??= {})
  for (const [day, d] of Object.entries(e.days)) {
    const into = (k[day] ??= { m: 0, s: 0, models: {} })
    into.m += d.m
    into.s += e.sub ? 0 : 1
    for (const [model, row] of Object.entries(d.models)) addTo(k, day, model, row)
  }
}

// Bring the index up to date. roots: [{ dir, cli: 'claude' | 'codex', provider? }] (provider: a folder that's one of
// your own providers', whatever its model is called). Newest logs first, so the days nearest today fill in first.
// onProgress({ done, total, files }): bytes read of the bytes to read; given often, and once more at the end.
export function scan(index, roots, { onProgress } = {}) {
  if (index?.v !== VERSION) index = emptyIndex()
  const found = new Map()
  const read = [] // the roots that could be listed
  for (const root of roots) {
    const logs = logsUnder(root)
    if (!logs) continue
    read.push(path.resolve(root.dir) + path.sep)
    for (const l of logs) found.set(l.file, l)
  }
  const todo = [...found.values()].filter((l) => {
    const e = index.files[l.file]
    return !e || e.size !== l.size || e.mtime !== l.mtime || e.cli !== l.cli
  }).sort((x, y) => y.mtime - x.mtime)
  const total = todo.reduce((n, l) => n + Math.max(0, l.size - (index.files[l.file]?.offset ?? 0)), 0)
  let done = 0
  todo.forEach((l, i) => {
    const prev = index.files[l.file]
    try {
      index.files[l.file] = readLog(l.file, l, prev)
    } catch {} // gone or unreadable right now: the next look tries again
    done += Math.max(0, l.size - (prev?.offset ?? 0))
    onProgress?.({ done, total, files: todo.length - i - 1 })
  })
  for (const [file, e] of Object.entries(index.files)) {
    if (found.has(file) || !read.some((dir) => path.resolve(file).startsWith(dir))) continue
    keep(index, e)
    delete index.files[file]
  }
  index.at = Date.now()
  return index
}

// ---- what the Usage view draws ----------------------------------------------------------------------------------------

// Which of your providers a log's model is: Claude Code runs Claude, GLM and your own Anthropic-compatible ones; Codex
// runs OpenAI's models and, through Ollama, the ones on your machine. providers: config's, as { id: { cli, models } }.
export function providerOf({ cli, via, pin, model }, providers = {}) {
  if (pin && providers[pin]) return pin
  const own = Object.entries(providers).find(([id, p]) => id !== 'claude' && id !== 'codex' && (p.cli ?? 'claude') === cli && (p.models ?? []).includes(model))?.[0]
  if (cli === 'codex') return via && via !== 'openai' ? own ?? (providers.local ? 'local' : 'codex') : 'codex'
  if (/^claude/i.test(model)) return 'claude'
  return own ?? (/^glm/i.test(model) && providers.glm ? 'glm' : 'claude')
}

// The index as days per provider. names: the clique's agents, whose work is listed under their names (anything else is
// what you ran outside CLIque: who ''), and where: the folder each session worked in ('' when its log doesn't say). ->
// { first, providers: { id: { days: { 'YYYY-MM-DD': { tokens, input, output, cached, written, replies, messages, cost,
//   sessions, models: { model: tokens }, who: { name: tokens }, where: { folder: tokens } } } } } }
export function summarize(index, { names = [], providers = {} } = {}) {
  const clique = new Set(names)
  const out = {}
  let first = null
  const add = (src, days, sessions) => {
    const who = src.who && clique.has(base(src.who)) ? base(src.who) : ''
    const where = src.dir ?? ''
    for (const [day, d] of Object.entries(days)) {
      const ids = new Set()
      for (const [model, [n, input, output, read, write, cost]] of Object.entries(d.models)) {
        const id = providerOf({ ...src, model }, providers)
        ids.add(id)
        const tokens = input + output + read + write
        const x = dayOf(id, day)
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
      // its messages and the session itself go to the provider that answered (a day with messages and no answer yet:
      // the CLI's own)
      const id = ids.values().next().value ?? providerOf({ ...src, model: '' }, providers)
      const x = dayOf(id, day)
      x.messages += d.m
      x.sessions += sessions(d)
    }
  }
  const dayOf = (id, day) => {
    if (!first || day < first) first = day
    return ((out[id] ??= { days: {} }).days[day] ??= { tokens: 0, input: 0, output: 0, cached: 0, written: 0, replies: 0, messages: 0, cost: 0, sessions: 0, models: {}, who: {}, where: {} })
  }
  for (const e of Object.values(index?.files ?? {})) add(e, e.days, () => (e.sub ? 0 : 1))
  for (const [key, days] of Object.entries(index?.kept ?? {})) {
    const [cli, via, pin, who, dir] = JSON.parse(key)
    add({ cli, via, pin, who, dir }, days, (d) => d.s ?? 0)
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
    this.index = saved?.v === VERSION ? saved : emptyIndex()
    return this.index
  }

  // What's known now, and whether a look is under way ({ done, total } in bytes): the page asks again until it isn't.
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
    this.running = (this.worker ? this.inWorker() : this.inline()).then(done, (e) => {
      done()
      this.index.at = Date.now() // a look that failed isn't tried again on every call
      throw e
    })
    return this.running
  }

  async inline() {
    await new Promise((r) => setImmediate(r)) // like the worker: whoever asked hears a look is under way first
    this.index = scan(this.index, this.roots(), { onProgress: (p) => (this.progress = p) })
    save(this.file, this.index)
  }

  inWorker() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./history.js', import.meta.url), { workerData: { history: { file: this.file, roots: this.roots() } } })
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
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (saved?.v === VERSION) index = saved
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

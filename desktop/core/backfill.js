// Spend from before CLIque counted it: a one-time look back through the agents' own logs (Hub.lookBack), so the Stats view
// starts with the last month instead of empty. Claude Code's transcripts name the agent that wrote them (CLIque starts it
// with --name) and say what each API response used; Claude Code's own /cost figure isn't kept, so they're priced here at
// list prices. Codex's session logs carry the clique prompt, with the agent's name, and its token counts. A conversation
// started for a task opens with the task's brief, so its spend goes to the task too. Runs in a worker thread: reading a
// month of transcripts mustn't hold up the app. No Electron in here.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'

// List prices, $ per million tokens: input, output, cache read. Cache writes cost 1.25x input for the 5-minute cache and
// 2x for the 1-hour one (Claude Code's), and fast mode doubles everything. The longest matching id wins, so a dated
// snapshot (claude-haiku-4-5-20251001) prices as its model.
export const PRICES = {
  'claude-fable-5-1': [10, 50, 0.25], 'claude-mythos-5-1': [10, 50, 0.25], 'claude-fable-5': [10, 50, 1], 'claude-mythos-5': [10, 50, 1],
  'claude-opus-5-5': [4, 20, 0.2], 'claude-opus-5': [5, 25, 0.5], 'claude-opus-4-8': [5, 25, 0.5], 'claude-opus-4-7': [5, 25, 0.5], 'claude-opus-4-6': [5, 25, 0.5],
  'claude-sonnet-5': [2, 10, 0.2], 'claude-sonnet-4-6': [3, 15, 0.3], 'claude-haiku-4-5': [1, 5, 0.1],
}
const IDS = Object.keys(PRICES).sort((x, y) => y.length - x.length)

// What one response cost, from its usage and model; null for a model without a price here.
export function costOf(usage, model) {
  const id = IDS.find((k) => String(model ?? '').startsWith(k))
  if (!id || !usage) return null
  const [input, output, read] = PRICES[id]
  const n = (v) => (Number.isFinite(v) ? v : 0)
  const split = usage.cache_creation
  const hour = split ? n(split.ephemeral_1h_input_tokens) : 0
  const minutes = split ? n(split.ephemeral_5m_input_tokens) : n(usage.cache_creation_input_tokens)
  const dollars = n(usage.input_tokens) * input + n(usage.output_tokens) * output + n(usage.cache_read_input_tokens) * read + minutes * input * 1.25 + hour * input * 2
  return (dollars / 1e6) * (usage.speed === 'fast' ? 2 : 1)
}

// A task's brief opens its conversation: "[bug #12] …", with "clique task done 12" further down. A task that lives on
// another computer reads "clique task done 12@laptop", and isn't this computer's #12.
export function taskOf(text) {
  const m = String(text ?? '').slice(0, 4000).match(/\[(?:bug|task|feature) #(\d+)\]/)
  const ref = String(text ?? '').match(/clique task done (\S+)/)?.[1]
  return m && (!ref || ref === m[1]) ? Number(m[1]) : null
}

const localDay = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const base = (name) => String(name).replace(/\.\d+$/, '') // a clone's work is its original's

// claude: Claude Code's projects folders; codex: Codex's sessions folder; names: the clique's agents; [since, until): the
// window to count, in ms. -> { agents: { name: { 'YYYY-MM-DD': { cost, tokens } } }, hours: { day: [24 costs] },
// tickets: { id: { cost, tokens } }, sessions: [ids it counted] }
export async function lookBack({ claude = [], codex = null, names = [], since, until }) {
  const clique = new Set(names)
  const out = { agents: {}, hours: {}, tickets: {}, sessions: [] }
  const add = (name, t, ticket, { cost = 0, tokens = 0 }) => {
    const day = localDay(t)
    const d = ((out.agents[name] ??= {})[day] ??= { cost: 0, tokens: 0 })
    d.cost += cost
    d.tokens += tokens
    if (cost) (out.hours[day] ??= Array(24).fill(0))[new Date(t).getHours()] += cost
    if (ticket !== null) {
      const k = (out.tickets[ticket] ??= { cost: 0, tokens: 0 })
      k.cost += cost
      k.tokens += tokens
    }
  }
  const recent = (file) => {
    try {
      return fs.statSync(file).mtimeMs >= since
    } catch {
      return false
    }
  }
  const files = (dir) => {
    try {
      return fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.jsonl')).map((f) => path.join(dir, f)).filter(recent)
    } catch {
      return []
    }
  }

  // Claude Code: whose a session is says its first lines (--name); a sub-agent's file sits in its session's folder
  const owners = new Map() // session id -> { name, ticket }
  const transcripts = claude.flatMap(files)
  for (const file of transcripts.filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))) {
    const name = head(file).match(/"agentName":"([^"]+)"/)?.[1]
    if (name && clique.has(base(name))) owners.set(path.basename(file, '.jsonl'), { name: base(name), ticket: null, file })
  }
  for (const file of transcripts) {
    const parts = file.split(path.sep)
    const sub = parts.lastIndexOf('subagents')
    const owner = owners.get(sub > 0 ? parts[sub - 1] : path.basename(file, '.jsonl'))
    if (!owner) continue
    const seen = new Set()
    let first = sub > 0 // a sub-agent's prompt isn't a task's brief
    let counted = false
    for await (const line of lines(file)) {
      if (!first && line.includes('"type":"user"')) {
        const text = promptText(json(line)?.message?.content)
        if (text) (first = true), (owner.ticket = taskOf(text))
      }
      if (!line.includes('"usage"')) continue
      const e = json(line)
      const m = e?.message
      const t = Date.parse(e?.timestamp)
      if (!m?.usage || !(t >= since && t < until)) continue
      const key = `${m.id}|${e.requestId}` // a response streams as several lines; count it once
      if (seen.has(key)) continue
      seen.add(key)
      const cost = costOf(m.usage, m.model)
      if (cost) (add(owner.name, t, owner.ticket, { cost }), (counted = true))
    }
    if (counted && sub < 0) out.sessions.push(path.basename(file, '.jsonl'))
  }

  // Codex: the clique prompt names the agent; token counts are running totals (a total that drops started over)
  for (const file of codex ? files(codex) : []) {
    if (!/one of several AI agents/.test(head(file, 256 * 1024))) continue
    let name = null
    let ticket = null
    let last = 0
    let counted = false
    for await (const line of lines(file)) {
      if (!name && line.includes('"developer"')) {
        const who = JSON.stringify(json(line)?.payload ?? '').match(/You are \\"([a-z0-9.-]+)\\", one of several AI agents/)?.[1]
        if (who) name = clique.has(base(who)) ? base(who) : ''
        continue
      }
      if (ticket === null && line.includes('"role":"user"')) ticket = taskOf(promptText(json(line)?.payload?.content))
      if (!name || !line.includes('"total_token_usage"')) continue
      const e = json(line)
      const total = e?.payload?.info?.total_token_usage?.total_tokens
      const t = Date.parse(e?.timestamp)
      if (!Number.isFinite(total)) continue
      const grew = total >= last ? total - last : total
      last = total
      if (grew > 0 && t >= since && t < until) (add(name, t, ticket, { tokens: grew }), (counted = true))
    }
    if (counted) out.sessions.push(path.basename(file, '.jsonl').replace(/^rollout-.*?-(?=[0-9a-f]{8}-)/, ''))
  }
  return out
}

function head(file, len = 16 * 1024) {
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(len)
    const n = fs.readSync(fd, buf, 0, len, 0)
    fs.closeSync(fd)
    return buf.toString('utf8', 0, n)
  } catch {
    return ''
  }
}

function lines(file) {
  return readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
}

function json(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

// A prompt's words, whether it came as a string or as content blocks
const promptText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b?.text ?? '').join(' ') : '').trim()

if (!isMainThread && workerData?.lookBack) {
  lookBack(workerData.lookBack).then((r) => parentPort.postMessage(r), (e) => parentPort.postMessage({ error: e.message }))
}

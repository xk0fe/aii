// The brain: agents, their status, inboxes, the shared feed and routing. No Electron in here.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { adapters, ASK_WAIT } from './adapters.js'
import { providersFrom, expandEnv, discoverCodex } from './providers.js'
import { generatePrompt } from './promptgen.js'
import { Tickets, ticketLine, ticketText, fixPrompt, triagePrompt, TASK_HELP, KINDS, priorityOf } from './tickets.js'
import { fromStatusLine, fromCodexLog, codexLog, againstLimit, tokens as tokenCount } from './context.js'

export const HOME = process.env.CREW_HOME || path.join(os.homedir(), '.crew')
export const CONFIG = path.join(HOME, 'config.json')
export const ATTACHMENTS = path.join(HOME, 'attachments')
const localDay = (t = Date.now()) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const at = (file) => path.join(HOME, file)

const DEFAULTS = { autopilot: true, theme: 'system', hotkey: 'Alt+Shift+Space', agents: [] }
const AGENT_KEYS = ['area', 'prompt', 'images', 'provider', 'cli', 'model', 'effort', 'tier', 'cwd', 'args', 'yolo', 'off', 'avatar', 'contextLimit', 'onContextLimit', 'clones']
const RESERVED = new Set(['you', 'any', 'crew'])
const SUB_TOOLS = new Set(['Agent', 'Task']) // Claude Code's sub-agent tool ("Task" in older versions)
const SUB_LINGER = 6000 // a finished sub-agent stays in the live view this long
const FEED_KEEP = 300
// A clone with nothing to do waits this long before it goes away, in case a teammate's answer is on its way.
const CLONE_LINGER = 5 * 60000
export const MAX_CLONES = 5
// An idle CLI draws nothing; one still starting up or finishing a turn (a hook's spinner) keeps drawing. A message
// waits for this much quiet before it's typed, but never longer than SETTLE_MAX.
const SETTLE_QUIET = 700
const SETTLE_MAX = 20000
// Enter again until the CLI reports the prompt, then call for help: about three minutes in all.
const PICKUP_WAITS = [2500, 3000, 5000, 10000, 20000, 30000, 60000, 60000]
const STOP_WORDS = new Set(
  'a an and are as at be but by can could do for from has have if in into is it me my no not of on or our please should so that the this to up us we with would you your'.split(' '),
)

export class Hub extends EventEmitter {
  agents = new Map() // name -> agent; clones too (gal.2), with cloneOf: 'gal'
  pinned = new WeakSet() // messages that only one particular clone (or the original) should take
  config = { ...DEFAULTS }
  discovered = {}
  url = null

  constructor(runner, { bin }) {
    super()
    fs.mkdirSync(ATTACHMENTS, { recursive: true })
    this.runner = runner
    this.bin = bin
    this.token = randomBytes(16).toString('hex')
    this.sessions = readJSON(at('sessions.json')) ?? {}
    this.stats = readJSON(at('stats.json')) ?? {}
    this.feed = loadFeed()
    this.asks = new Map() // feed id of an open question -> { resolve, name, cli, input }
    this.saving = Promise.resolve() // feed.jsonl appends, one after another (an answer must land after its card)
    this.tickets = new Tickets(at('tickets.json'))
    // Each agent's current conversation: when it started, tasks in it, compactions, and how full it is.
    this.convos = readJSON(at('conversations.json')) ?? {}
    // Unread replies: up to when you've read each agent's. A first run starts from now, so old history isn't "new".
    this.reads = readJSON(at('reads.json')) ?? { since: Date.now(), agents: {} }
    this.loadConfig()
    runner.on('exit', (name, code, ms) => this.onExit(name, code, ms))
  }

  start(url) {
    this.url = url
    fs.writeFileSync(at('url'), url)
    fs.writeFileSync(at('token'), this.token)
    fs.chmodSync(at('token'), 0o600)
    for (const a of this.agents.values()) if (!a.off) this.launch(a)
    fs.watchFile(CONFIG, { interval: 1000 }, () => this.loadConfig())
    discoverCodex().then((codex) => {
      if (!codex) return
      this.discovered.codex = codex
      this.loadConfig()
    })
  }

  // ---- config ------------------------------------------------------------

  loadConfig() {
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
    } catch (e) {
      if (e.code !== 'ENOENT') return this.post({ kind: 'event', from: 'crew', text: `config.json: ${e.message}` })
      raw = {}
      fs.writeFileSync(CONFIG, JSON.stringify(DEFAULTS, null, 2) + '\n')
    }
    this.config = { ...DEFAULTS, ...raw }
    this.providers = providersFrom(this.config, this.discovered)
    const names = new Set(this.config.agents.map((c) => c.name))
    for (const [name, a] of this.agents) {
      if (a.cloneOf || names.has(name)) continue // clones follow their original, below
      this.forgetAsks(name)
      this.runner.stop(name)
      this.agents.delete(name)
    }
    for (const c of this.config.agents) {
      let a = this.agents.get(c.name)
      if (!a) this.agents.set(c.name, (a = { status: 'off', since: Date.now(), activity: '', inbox: [], holdUntil: 0, hookAt: 0 }))
      for (const k of AGENT_KEYS) delete a[k]
      Object.assign(a, c)
      // config.json decides on/off, whether it was toggled in the UI or edited by hand.
      if (a.off && a.status !== 'off') {
        this.runner.stop(a.name)
        this.setStatus(a, 'off')
      } else if (!a.off && a.status === 'off' && this.url) this.launch(a)
    }
    // Clones work with their original's settings. One whose original was removed, renamed or turned off goes too.
    for (const c of this.clones()) {
      const base = this.agents.get(c.cloneOf)
      if (!base || base.off) this.dismiss(c.name)
      else this.dress(c, base)
    }
    this.changed()
  }

  saveConfig() {
    fs.writeFileSync(CONFIG, JSON.stringify(this.config, null, 2) + '\n')
    this.loadConfig()
  }

  addAgent({ name, ...fields }) {
    name = this.freeName(name)
    this.config.agents.push(JSON.parse(JSON.stringify({ name, ...clean(fields) })))
    this.saveConfig()
    return name
  }

  freeName(raw) {
    const name = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!name || RESERVED.has(name)) throw new Error('pick another name')
    if (this.agents.has(name)) throw new Error(`"${name}" already exists`)
    return name
  }

  removeAgent(name) {
    this.config.agents = this.config.agents.filter((c) => c.name !== name)
    this.saveSession(name, null)
    delete this.stats[name]
    this.saveStats()
    this.saveConfig()
  }

  // The one edit path: a patch for one agent or many at once (bulk edit in the collection).
  // `off` is saved, so it survives restarts. Launch settings restart a running agent, resuming its
  // session, as soon as it's free.
  update(names, patch) {
    names = [].concat(names)
    if (names.length === 1 && patch.name !== undefined && patch.name !== names[0]) names = [this.rename(names[0], patch.name)]
    const { name, ...fields } = clean(patch)
    const before = new Map(names.map((n) => [n, this.launchKey(this.agents.get(n))]))
    for (const n of names) {
      const c = this.config.agents.find((x) => x.name === n)
      if (!c) continue
      const oldHome = [c.provider ?? c.cli ?? 'claude', c.cwd]
      for (const [k, v] of Object.entries(fields)) v === undefined ? delete c[k] : (c[k] = v)
      if ('provider' in fields) delete c.cli
      // A session belongs to one CLI and one folder; switching either starts a fresh conversation.
      if (oldHome[0] !== (c.provider ?? c.cli ?? 'claude') || oldHome[1] !== c.cwd) this.saveSession(n, null)
    }
    this.saveConfig()
    for (const n of names) {
      const a = this.agents.get(n)
      // its clones too: they pick up the new settings, each resuming its own conversation
      for (const x of a ? [a, ...this.clonesOf(a)] : []) {
        if (this.runner.running(x.name) && this.launchKey(x) !== before.get(n)) this.relaunchWhenFree(x)
        if ('contextLimit' in fields || 'onContextLimit' in fields) this.checkLimit(x) // a lower limit may be passed already
      }
    }
  }

  rename(from, to) {
    to = this.freeName(to)
    const c = this.config.agents.find((x) => x.name === from)
    if (!c) throw new Error(`no agent named "${from}"`)
    c.name = to
    if (this.sessions[from]) this.sessions[to] = this.sessions[from]
    this.saveSession(from, null) // also writes the moved session
    if (this.stats[from]) [this.stats[to], this.stats[from]] = [this.stats[from], undefined] // experience moves with the name
    this.saveStats()
    // so do its conversation's numbers and the tasks it owns or is working on
    if (this.convos[from]) [this.convos[to], this.convos[from]] = [this.convos[from], undefined]
    this.saveConvos()
    for (const t of this.tickets.all) for (const k of ['owner', 'fixer']) if (t[k] === from) t[k] = to
    this.tickets.save()
    if (this.config.triage === from) this.config.triage = to
    this.saveConfig() // stops `from`, starts `to` resuming the same conversation
    return to
  }

  launchKey(a) {
    return a && JSON.stringify([this.providerOf(a)?.id, a.model, a.effort, a.tier, a.cwd, a.args, a.yolo, a.area, a.prompt, a.images])
  }

  relaunchWhenFree(a) {
    if (a.status === 'working' || a.status === 'waiting') a.relaunch = true
    else this.launch(a)
    this.changed()
  }

  // A first draft of an agent's instructions, written by its own brain from its name and area.
  draftPrompt(agent) {
    const provider = this.providers[agent.provider ?? 'claude']
    if (!provider) throw new Error(`unknown provider "${agent.provider}"`)
    if (provider.missing.length) throw new Error(`${provider.label} needs ${provider.missing.join(', ')} in your shell environment`)
    const teammates = [...this.agents.values()].filter((a) => a.name !== agent.name && !a.cloneOf).map((a) => `${a.name} (${a.area || 'general'})`).join(', ')
    return generatePrompt(agent, provider, teammates)
  }

  providerOf(a) {
    return this.providers[a.provider ?? a.cli ?? 'claude']
  }

  // You've seen an agent's replies up to `ts` (the chat marks what's been on screen): { name: ts }.
  // Names can be agents on other computers (gal@mac-mini): what you've read is this computer's to remember.
  read(seen) {
    let moved = false
    for (const [name, ts] of Object.entries(seen ?? {})) {
      if (!(Number(ts) > (this.reads.agents[name] ?? 0))) continue
      this.reads.agents[name] = Number(ts)
      moved = true
    }
    if (!moved) return
    this.saveReads()
    this.changed()
  }

  saveReads() {
    clearTimeout(this.readsTimer)
    this.readsTimer = setTimeout(() => {
      try {
        fs.writeFileSync(at('reads.json'), JSON.stringify(this.reads))
      } catch {}
    }, 500)
  }

  setTheme(theme) {
    this.config.theme = ['light', 'dark'].includes(theme) ? theme : 'system'
    this.saveConfig()
  }

  setAutopilot(on) {
    this.config.autopilot = Boolean(on)
    this.saveConfig()
  }

  // ---- lifecycle ---------------------------------------------------------

  launch(a, fresh = false) {
    this.forgetAsks(a.name)
    a.relaunch = false
    a.subs = new Map() // sub-agents don't outlive their process
    a.subPending = []
    clearTimeout(a.readyTimer)
    if (fresh) this.saveSession(a.name, null)
    const provider = this.providerOf(a)
    const adapter = adapters[provider?.cli]
    const fail = (text) => {
      this.runner.stop(a.name)
      this.setStatus(a, 'stopped')
      this.post({ kind: 'event', from: a.name, text })
    }
    if (!adapter) return fail(`unknown provider "${a.provider}", define it under "providers" in config.json`)
    if (provider.missing.length) return fail(`${provider.label} needs ${provider.missing.join(', ')} in your shell environment`)
    const resume = this.sessions[a.name]
    const { file, args, readyAfter, env: extraEnv } = adapter(a, { resume, session: randomUUID(), attachments: ATTACHMENTS })
    a.resumed = Boolean(resume)
    if (!resume) this.newConvo(a)
    try {
      const cwd = expand(a.cwd)
      if (!fs.existsSync(cwd)) throw new Error(`folder not found: ${cwd}`)
      const env = { ...expandEnv(provider.env), ...extraEnv, PATH: `${this.bin}:${process.env.PATH}`, CREW_AGENT: a.name, CREW_URL: this.url, CREW_TOKEN: this.token, CREW_HOME: HOME }
      this.runner.start(a.name, { file, args: [...args, ...(provider.args ?? []), ...(a.args ?? [])], cwd, env })
      this.setStatus(a, 'starting')
      if (readyAfter) a.readyTimer = setTimeout(() => a.status === 'starting' && this.setStatus(a, 'idle'), readyAfter)
    } catch (e) {
      this.setStatus(a, 'stopped')
      this.post({ kind: 'event', from: a.name, text: `failed to start: ${e.message}` })
    }
  }

  restart(name, fresh = false) {
    const a = this.agents.get(name)
    if (a) this.launch(a, fresh)
  }

  // ---- clones: one agent on several tasks at once ---------------------------------------------------
  // An agent with `clones: n` doesn't make a message wait while it's busy. A clone takes it: the same agent (its
  // settings, instructions, folder and look) in a terminal and conversation of its own, named gal.2, gal.3… up to
  // n of them. A clone with nothing left to do goes away after CLONE_LINGER, and its work counts as the agent's.

  clones() {
    return [...this.agents.values()].filter((a) => a.cloneOf)
  }

  clonesOf(a) {
    return this.clones().filter((c) => c.cloneOf === a.name).sort((x, y) => x.clone - y.clone)
  }

  // Every agent with its clones right after it.
  ordered() {
    return [...this.agents.values()].filter((a) => !a.cloneOf).flatMap((a) => [a, ...this.clonesOf(a)])
  }

  // The agent a name belongs to: a clone's original, or the agent itself. A clone that went away still names its
  // original (gal.2 -> gal), and so does one on another computer (gal.2@air -> gal@air).
  baseOf(name) {
    const a = this.agents.get(name)
    return a ? (a.cloneOf ?? a.name) : String(name).replace(/\.\d+(?=@|$)/, '')
  }

  maxClones(a) {
    return Math.min(Math.max(0, Math.floor(Number(a?.clones) || 0)), MAX_CLONES)
  }

  // A clone takes its original's settings (and follows them when they change).
  dress(c, base) {
    for (const k of AGENT_KEYS) delete c[k]
    for (const k of AGENT_KEYS) if (base[k] !== undefined) c[k] = structuredClone(base[k])
  }

  // Which of an agent and its clones takes a message. One meant for a particular one goes to it: a clone addressed
  // by name, or whichever asked what this answers (its conversation has the context). Otherwise whoever is free,
  // then a new clone if there's room for one, and failing that the agent's queue, which the first of them to
  // finish takes from (takeOver).
  placeFor(a, msg) {
    if (a.cloneOf || !this.maxClones(a) || !this.runner.running(a.name)) return a
    const family = [a, ...this.clonesOf(a)]
    const asked = msg.re && this.feed.find((e) => e.id === msg.re)
    const asker = asked && family.find((x) => x.name === asked.from)
    if (asker) {
      this.pinned.add(msg)
      return asker
    }
    const free = family.find((x) => x.status === 'idle' && !x.inbox.length && this.runner.running(x.name)) ?? family.find((x) => x.status === 'starting' && !x.inbox.length)
    if (free) return free
    if (family.length - 1 >= this.maxClones(a)) return a
    const c = this.spawnClone(a, msg)
    if (c.status === 'starting') return c
    this.dismiss(c.name) // it couldn't start (it said why in the feed)
    return a
  }

  spawnClone(base, msg) {
    let n = 2
    while (this.agents.has(`${base.name}.${n}`)) n++
    const c = { name: `${base.name}.${n}`, cloneOf: base.name, clone: n, status: 'off', since: Date.now(), activity: '', inbox: [], holdUntil: 0, hookAt: 0 }
    this.dress(c, base)
    this.agents.set(c.name, c)
    if (msg.fresh) c.freshFor = msg.id // it starts in a new conversation anyway
    this.launch(c, true)
    return c
  }

  // A free clone takes the first message waiting for its original that isn't the original's own to answer.
  takeOver(c) {
    const base = this.agents.get(c.cloneOf)
    if (!base || this.surplus(c)) return
    const i = base.inbox.findIndex((m) => !this.pinned.has(m))
    if (i < 0) return
    const [msg] = base.inbox.splice(i, 1)
    this.amend(msg, { to: c.name })
    c.inbox.push(msg)
  }

  // More clones than the agent may have now (its number went down), or its original is gone or off.
  surplus(c) {
    const base = this.agents.get(c.cloneOf)
    return !base || base.off || this.clonesOf(base).indexOf(c) >= this.maxClones(base)
  }

  // A clone with nothing to do waits a while, in case more work or a teammate's answer comes its way.
  linger(c) {
    clearTimeout(c.reapTimer)
    c.reapTimer = setTimeout(() => this.reap(c), this.surplus(c) ? 0 : CLONE_LINGER)
  }

  reap(c) {
    if (this.agents.get(c.name) !== c || c.status !== 'idle' || c.inbox.length || this.asking(c.name)) return // busy again: it lingers once it's done
    if ([...(c.subs?.values() ?? [])].some((x) => !x.ended)) return this.linger(c) // its sub-agents are still at it
    if (this.owed(c) && !this.surplus(c)) return this.linger(c)
    this.dismiss(c.name)
  }

  // Is a teammate still working on something this clone asked for? Its answer should find the clone still there.
  owed(c) {
    const from = (id) => this.feed.find((e) => e.id === id)?.from
    return this.feed.some((e) => e.held && e.from === c.name) ||
      [...this.agents.values()].some((x) => x.inbox.some((m) => m.from === c.name) || ((x.status === 'working' || x.status === 'waiting') && from(x.current) === c.name))
  }

  // A clone goes away: its terminal stops and its conversation ends with it. Anything still queued for it goes
  // back to its original's queue.
  dismiss(name) {
    const c = this.agents.get(name)
    if (!c?.cloneOf) throw new Error(`@${name} isn't a clone`)
    for (const t of ['reapTimer', 'timer', 'ack', 'readyTimer']) clearTimeout(c[t])
    this.forgetAsks(name)
    this.runner.stop(name)
    this.setStatus(c, 'off')
    this.agents.delete(name)
    delete this.sessions[name]
    delete this.convos[name]
    const base = this.agents.get(c.cloneOf)
    if (base && c.inbox.length) {
      for (const msg of c.inbox) this.amend(msg, { to: base.name })
      base.inbox.push(...c.inbox)
      this.pump(base)
      for (const x of this.clonesOf(base)) this.pump(x)
    }
    this.changed()
  }

  // How an agent looks to routing: free when it, a clone of it, or a clone it could start can take work now.
  lineup(a) {
    const family = [a, ...this.clonesOf(a)]
    const room = family.some((x) => x.status === 'idle' && !x.inbox.length) || (this.maxClones(a) > family.length - 1 && this.runner.running(a.name))
    return { name: a.name, area: a.area, status: room ? 'idle' : a.status, queue: room ? 0 : family.reduce((n, x) => n + x.inbox.length, 0) }
  }

  // ---- conversations: starting fresh, and how full the current one is ------------------------------

  // A new conversation for an agent, so a new task doesn't share its context with the last ten. Its
  // instructions, folder and the crew's notes stay; the old conversation stays in the CLI's history.
  // A busy agent finishes what it's doing first.
  freshStart(name) {
    const a = this.agents.get(name)
    if (!a) throw new Error(`no agent named "${name}"`)
    if (a.off) {
      this.saveSession(name, null)
      this.newConvo(a)
      this.post({ kind: 'event', from: name, text: 'starts a new conversation when it comes back on', fresh: true })
      return
    }
    if (a.status === 'working' || a.status === 'waiting') {
      a.freshPending = true
      return this.changed()
    }
    this.startFresh(a)
  }

  startFresh(a, why = a.freshWhy ?? '') {
    a.freshPending = false
    a.freshWhy = undefined
    if (a.inbox[0]?.fresh) a.freshFor = a.inbox[0].id // this new conversation is the one that task waits for
    this.post({ kind: 'event', from: a.name, text: `started a new conversation${why}`, fresh: true })
    this.launch(a, true)
  }

  // Every way a new conversation starts (fresh start, no session to resume, /clear) comes through here,
  // so what the old one was about (a bug it was fixing) never carries over.
  newConvo(a) {
    this.convos[a.name] = { since: Date.now(), tasks: 0, compactions: 0 }
    this.saveConvos()
  }

  convoOf(a) {
    return (this.convos[a.name] ??= { since: Date.now(), tasks: 0, compactions: 0 })
  }

  // Debounced: the status line reports often. `now` on quit, so the last numbers aren't lost.
  saveConvos(now = false) {
    clearTimeout(this.convoTimer)
    // only the context gauges' memory: a failed write (the folder gone) must never take anything down
    const write = () => {
      try {
        fs.writeFileSync(at('conversations.json'), JSON.stringify(this.lasting(this.convos)))
      } catch {}
    }
    if (now) write()
    else this.convoTimer = setTimeout(write, 1000)
  }

  setContext(a, context) {
    const c = this.convoOf(a)
    if (JSON.stringify(c.context) === JSON.stringify(context)) return
    c.context = context
    this.saveConvos()
    this.checkLimit(a)
    this.changed()
  }

  // An agent's own context limit (contextLimit, in tokens), for a model whose window is bigger than you want
  // it to use: once its conversation passes the limit, it starts a new one as soon as it's free (the default),
  // or Crew just tells you (onContextLimit: 'notify'). Once per conversation; it re-arms if the conversation
  // shrinks back under the limit (the CLI compacted it).
  checkLimit(a) {
    const c = this.convoOf(a)
    const limit = Number(a.contextLimit)
    if (!(limit > 0) || !c.context || a.off || a.status === 'stopped') return
    if (c.context.used < limit) {
      if (c.limitHit) delete c.limitHit
      return
    }
    if (c.limitHit === limit) return
    c.limitHit = limit
    this.saveConvos()
    const passed = `passed its ${tokenCount(limit)} context limit (${tokenCount(c.context.used)} used)`
    if (a.onContextLimit === 'notify') {
      this.post({ kind: 'event', from: a.name, text: `${passed}. Start a new conversation when it suits you`, alert: true })
      this.emit('notice', { title: `@${a.name} ${passed}`, body: 'Start a new conversation from its terminal or its card when it suits you.', focus: a.name })
      return this.changed()
    }
    const why = ` (it passed its ${tokenCount(limit)} context limit)`
    if (a.status === 'idle') return this.startFresh(a, why)
    a.freshPending = true
    a.freshWhy = why
    this.post({ kind: 'event', from: a.name, text: `${passed}, so it starts a new conversation when it finishes this task` })
    this.changed()
  }

  // Claude Code's status line: remember how full the context is, and answer with the line it shows.
  onStatusLine(name, s) {
    const a = this.agents.get(name)
    if (!a) return ''
    const context = fromStatusLine(s)
    // Before the first message of a resumed session there's no usage yet: keep what we knew.
    if (context && (s.context_window.current_usage || !this.convoOf(a).context)) this.setContext(a, context)
    const c = this.convoOf(a)
    if (!c.context) return ''
    const { pct, used, size, limit } = againstLimit(c.context, a.contextLimit)
    const color = pct >= 85 ? '31' : pct >= 60 ? '33' : '2'
    return `\x1b[${color}mcontext ${pct}% · ${tokenCount(used)} of ${tokenCount(size)}${limit ? ' limit' : ''}\x1b[0m\x1b[2m · ${c.tasks} task${c.tasks === 1 ? '' : 's'} in this conversation\x1b[0m`
  }

  // Codex writes its token counts to its session log; read the newest after each step.
  readCodexContext(a, e) {
    if (this.providerOf(a)?.cli !== 'codex') return
    const now = Date.now()
    if (e.hook_event_name === 'PostToolUse' && now - (a.contextAt ?? 0) < 5000) return
    a.contextAt = now
    const file = e.transcript_path || codexLog(e.session_id ?? this.sessions[a.name])
    const context = file && fromCodexLog(file)
    if (context) this.setContext(a, context)
  }

  onExit(name, code, ms) {
    const a = this.agents.get(name)
    if (!a) return
    this.forgetAsks(name)
    this.setStatus(a, 'stopped')
    if (a.resumed && code !== 0 && ms < 5000) {
      this.post({ kind: 'event', from: name, text: "couldn't resume the previous session, starting a fresh one" })
      return this.launch(a, true)
    }
    this.post({ kind: 'event', from: name, text: code ? `exited (code ${code})` : 'exited' })
    if (a.cloneOf) this.dismiss(name) // a clone isn't restarted: what it had queued goes back to its original
  }

  saveSession(name, id) {
    if (id) this.sessions[name] = id
    else delete this.sessions[name]
    if (this.agents.get(name)?.cloneOf) return // a clone's conversation goes away with it
    fs.writeFileSync(at('sessions.json'), JSON.stringify(this.lasting(this.sessions), null, 2) + '\n')
  }

  // What's worth saving of a per-agent record: clones come and go.
  lasting(byName) {
    return Object.fromEntries(Object.entries(byName).filter(([name]) => !this.agents.get(name)?.cloneOf))
  }

  // ---- status, from Claude Code hooks ------------------------------------

  onHook(name, e) {
    const a = this.agents.get(name)
    if (!a) return
    a.hookAt = Date.now()
    // where its CLI keeps this conversation, so a move to another computer can take it along (core/move.js)
    if (e.transcript_path && e.session_id && !e.agent_id) a.transcript = { id: e.session_id, path: String(e.transcript_path) }
    switch (e.hook_event_name) {
      case 'SessionStart': // Claude: at launch. Codex: with the first prompt, so only "starting" counts.
        if (e.source === 'compact') {
          // The CLI summarized the conversation to make room: older details are now fuzzy.
          this.convoOf(a).compactions += 1
          this.saveConvos()
          this.post({ kind: 'event', from: name, text: 'ran out of room and compacted its conversation (older details are summarized now)' })
          return
        }
        if (e.source === 'clear') {
          // /clear typed in its terminal
          this.newConvo(a)
          this.post({ kind: 'event', from: name, text: 'started a new conversation (/clear)', fresh: true })
          return this.setStatus(a, 'idle')
        }
        if (a.status !== 'starting') return
        hold(a, 2000) // the prompt box isn't ready the moment the session starts
        return this.setStatus(a, 'idle')
      case 'UserPromptSubmit':
        // Remembered only once it has a prompt: Claude Code doesn't save empty sessions, so they can't be resumed.
        if (e.session_id && this.sessions[name] !== e.session_id) this.saveSession(name, e.session_id)
        clearTimeout(a.ack)
        a.activity = ''
        // Remember what the agent is answering, so its reply (and any hand-off it makes) can point back to it.
        // A prompt typed straight into its terminal joins the feed too, so replies to it have something to point at.
        if (a.expect && samePrompt(e.prompt, a.expect.text)) {
          a.current = a.expect.id
          a.expect = null
        } else if (e.prompt && !e.prompt.startsWith('/')) a.current = this.post({ kind: 'msg', from: 'you', to: name, text: e.prompt.slice(0, 4000), via: 'terminal' }).id
        this.record(name, { tasks: 1 })
        if (!e.prompt?.startsWith('/')) (this.convoOf(a).tasks += 1), this.saveConvos()
        a.turnStart = Date.now()
        this.readCodexContext(a, e)
        return this.setStatus(a, 'working')
      case 'PreToolUse': // only for the Agent tool (see adapters.js): what the next sub-agent is for
        if (SUB_TOOLS.has(e.tool_name) && !e.agent_id) (a.subPending ??= []).push({ description: String(e.tool_input?.description ?? ''), type: String(e.tool_input?.subagent_type ?? '') })
        return
      case 'SubagentStart':
        return this.subStart(a, e)
      case 'SubagentStop':
        return this.subStop(a, e)
      case 'PostToolUse':
        if (e.agent_id) return this.subTool(a, e) // a sub-agent's own step: it's the sub-agent that's busy
        if (SUB_TOOLS.has(e.tool_name)) this.subLaunched(a, e)
        a.activity = describe(e)
        this.record(name, { tools: 1 })
        this.readCodexContext(a, e)
        return this.setStatus(a, 'working')
      case 'Notification':
        // Permission prompts come with a card in the chat (see ask), which alerts on its own; both hooks fire at
        // the same moment, so this one may even arrive first.
        if (e.notification_type === 'permission_prompt' || this.asking(name)) return
        if (a.status === 'working') this.needsYou(a, e.message || 'needs your input')
        return
      case 'Interrupt':
        a.activity = ''
        a.turnStart = null
        return this.setStatus(a, 'idle')
      case 'Stop': {
        a.activity = ''
        this.readCodexContext(a, e)
        if (a.turnStart) this.record(name, { turns: 1, turnMs: Date.now() - a.turnStart })
        a.turnStart = null
        const subs = this.subsThisTurn(a, e.background_tasks)
        if (e.last_assistant_message) this.post({ kind: 'reply', from: name, text: e.last_assistant_message.slice(0, 4000), ...(a.current && { re: a.current }), ...(subs.length && { subs }) })
        hold(a, 600)
        return this.setStatus(a, 'idle')
      }
    }
  }

  // ---- sub-agents: Claude Code's Agent tool ------------------------------------------------------
  // An agent can hand parts of its work to sub-agents, several at once, and they may keep running after its turn
  // ends (in the background). Its hooks tell Crew: PreToolUse for Agent says what one is for, SubagentStart and
  // SubagentStop bracket it (agent_id), and each tool the sub-agent uses arrives with that agent_id. Each agent
  // keeps a.subs: agent_id -> { id, type, description, started, ended, tools, activity, result }.

  subStart(a, e) {
    const subs = (a.subs ??= new Map())
    const known = subs.get(e.agent_id)
    if (known) {
      Object.assign(known, { ended: null, told: false, started: Date.now() }) // resumed
      return this.changed()
    }
    // the oldest Agent call of this type that hasn't started yet is this one
    const pending = a.subPending ?? []
    const i = pending.findIndex((p) => !p.type || p.type === e.agent_type)
    const call = i >= 0 ? pending.splice(i, 1)[0] : pending.shift()
    subs.set(e.agent_id, { id: e.agent_id, type: String(e.agent_type || call?.type || 'agent'), description: call?.description ?? '', started: Date.now(), ended: null, tools: 0, activity: '', result: '' })
    this.changed()
  }

  subOf(a, id, type) {
    const subs = (a.subs ??= new Map())
    if (!subs.has(id)) subs.set(id, { id, type: String(type || 'agent'), description: '', started: Date.now(), ended: null, tools: 0, activity: '', result: '' })
    return subs.get(id)
  }

  subTool(a, e) {
    const sub = this.subOf(a, e.agent_id, e.agent_type)
    sub.tools += 1
    sub.activity = describe(e)
    this.record(a.name, { tools: 1 })
    this.changed()
  }

  // The Agent call returns with the sub-agent's id: when it runs in the background, right away; otherwise once
  // it's done. Either way it names the sub-agent for sure.
  subLaunched(a, e) {
    const r = e.tool_response ?? {}
    if (!r.agentId) return
    const sub = this.subOf(a, r.agentId, e.tool_input?.subagent_type)
    if (!sub.description) sub.description = String(e.tool_input?.description ?? r.description ?? '')
    if (r.status === 'completed' && !sub.ended) sub.ended = Date.now()
  }

  subStop(a, e) {
    const sub = this.subOf(a, e.agent_id, e.agent_type)
    sub.ended = Date.now()
    sub.activity = ''
    sub.result = String(e.last_assistant_message ?? '').slice(0, 600)
    this.changed()
    setTimeout(() => this.changed(), SUB_LINGER + 100) // so a finished one leaves the live view
  }

  // The sub-agents for this turn's reply in the feed: the ones still running, and the ones that finished since the
  // last reply. Stop lists those still running in the background: any other that never reported its end is over.
  subsThisTurn(a, background) {
    const subs = a.subs
    if (!subs?.size) return []
    if (Array.isArray(background)) {
      const running = new Set(background.filter((t) => t?.type === 'subagent' && t.status === 'running').map((t) => t.id))
      for (const t of background) if (t?.type === 'subagent' && t.status === 'running' && !subs.has(t.id)) subs.set(t.id, { id: t.id, type: String(t.agent_type || 'agent'), description: String(t.description ?? ''), started: Date.now(), ended: null, tools: 0, activity: '', result: '' })
      for (const sub of subs.values()) if (!sub.ended && !running.has(sub.id)) sub.ended = Date.now()
    }
    const now = Date.now()
    for (const [id, sub] of subs) if (sub.ended && now - sub.ended > 10 * 60000) subs.delete(id) // long gone
    return [...subs.values()]
      .filter((sub) => !sub.ended || !sub.told)
      .map((sub) => {
        if (sub.ended) sub.told = true
        return { type: sub.type, description: sub.description, tools: sub.tools, ms: (sub.ended ?? now) - sub.started, running: !sub.ended }
      })
  }

  // ---- questions, answered in the chat ----------------------------------------------------------
  // Permission prompts, AskUserQuestion and plan approvals reach the agent's PermissionRequest hook, which waits
  // on the /ask route (core/server.js) for your answer: a card in the feed here, and answer() sends it back.
  // Claude keeps its own dialog up meanwhile, so either place works: the first answer wins, and answering in
  // the terminal cancels the hook (`closed`). Codex waits on the hook instead, so its card can hand the
  // question back to the terminal (and typing there does too). Agents on other computers answer through
  // core/crew.js, by the card's id; so would a phone.
  ask(name, payload, closed) {
    const a = this.agents.get(name)
    if (!a) return ''
    const cli = this.providerOf(a)?.cli ?? 'claude'
    const input = { ...payload, tool_input: payload?.tool_input ?? {}, permission_suggestions: payload?.permission_suggestions ?? [] }
    let ask
    try {
      ask = askOf(input, cli)
    } catch {
      return '' // something we can't show: the agent asks in its terminal as usual
    }
    const e = this.post({ kind: 'ask', from: name, to: 'you', ask, cli, ...(a.current && { re: a.current }) })
    this.record(name, { waits: 1 })
    this.emit('alert', a, ask.alert)
    this.setStatus(a, 'waiting')
    const started = Date.now()
    return new Promise((resolve) => {
      this.asks.set(e.id, { resolve, name, cli, input, entry: e })
      // The hook went away before you answered. Claude: mostly you answered its dialog (it cancels the hook);
      // after a day of waiting, its dialog is simply still up. Codex: its hook ran out, or it was interrupted,
      // and either way it's its terminal's turn now.
      closed?.addEventListener('abort', () => {
        const ranOut = Date.now() - started > ((ASK_WAIT[cli] ?? 0) - 15) * 1000
        if (cli === 'codex' || ranOut) this.settle(e.id, '', { by: 'terminal', handedOver: true }, true)
        else this.settle(e.id, '', { by: 'terminal' })
      }, { once: true })
    })
  }

  // reply: { allow, always?, note? } for a permission or plan, { answers: { question: label(s) or text } } for
  // questions, or { terminal: true } to answer in the agent's terminal instead.
  answer(id, reply = {}) {
    const q = this.asks.get(id)
    if (!q) throw new Error('that question has already been answered')
    if (reply.terminal) return this.settle(id, '', { by: 'terminal', handedOver: true }, true)
    const { output, answer } = decide(q.entry.ask, q.input, q.cli, reply)
    this.settle(id, JSON.stringify(output), { by: 'you', ...answer })
  }

  settle(id, output, answer, stillWaiting = false) {
    const q = this.asks.get(id)
    if (!q) return
    this.asks.delete(id)
    q.resolve(output)
    this.amend(q.entry, { answer: { ...answer, at: Date.now() } })
    const a = this.agents.get(q.name)
    if (a?.status === 'waiting' && !stillWaiting && !this.asking(q.name)) this.setStatus(a, 'working')
  }

  asking(name) {
    return [...this.asks.values()].some((q) => q.name === name)
  }

  // An agent that exits, restarts or goes away isn't waiting on its questions any more (even if a hook
  // process outlives it, nothing would read the answer).
  forgetAsks(name) {
    for (const [id, q] of this.asks) if (q.name === name) this.settle(id, '', { stale: true }, true)
  }

  needsYou(a, text) {
    this.record(a.name, { waits: 1 })
    this.post({ kind: 'event', from: a.name, text, alert: true })
    this.emit('alert', a, text)
    this.setStatus(a, 'waiting')
  }

  setStatus(a, status) {
    if (a.status !== status) {
      const spent = Date.now() - a.since
      if (a.status === 'working') this.record(a.name, { activeMs: spent })
      if (a.status === 'waiting') this.record(a.name, { waitMs: spent })
      Object.assign(a, { status, since: Date.now() })
    }
    if (status === 'idle' && a.freshPending) return this.startFresh(a)
    if (status === 'idle' && a.relaunch) return this.launch(a)
    if (status === 'idle') this.pump(a)
    this.changed()
  }

  // ---- work experience: what each agent actually did, kept across restarts -----

  record(name, counts) {
    name = this.baseOf(name) // a clone's work is its original's experience
    const s = (this.stats[name] ??= { first: Date.now(), days: {} })
    const day = (s.days[localDay()] ??= {})
    for (const [k, v] of Object.entries(counts)) {
      s[k] = (s[k] ?? 0) + v
      if (k === 'tasks' || k === 'activeMs') day[k] = (day[k] ?? 0) + v
    }
    s.last = Date.now()
    clearTimeout(this.statsTimer)
    this.statsTimer = setTimeout(() => this.saveStats(), 2000)
  }

  saveStats() {
    const cutoff = localDay(Date.now() - 60 * 864e5)
    for (const s of Object.values(this.stats)) if (s) for (const d of Object.keys(s.days)) if (d < cutoff) delete s.days[d]
    fs.writeFileSync(at('stats.json'), JSON.stringify(this.stats))
  }

  statsOf(a) {
    const s = this.stats[a.cloneOf ?? a.name] ?? { days: {} }
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = localDay(Date.now() - (13 - i) * 864e5)
      return { day: d, tasks: s.days[d]?.tasks ?? 0 }
    })
    return {
      tasks: s.tasks ?? 0,
      turns: s.turns ?? 0,
      activeMs: (s.activeMs ?? 0) + (a.status === 'working' ? Date.now() - a.since : 0),
      avgTurnMs: s.turns ? s.turnMs / s.turns : 0,
      tools: s.tools ?? 0,
      waits: s.waits ?? 0,
      waitMs: s.waitMs ?? 0,
      avgQueueMs: s.delivered ? s.queuedMs / s.delivered : 0,
      fromYou: s.fromYou ?? 0,
      fromTeam: s.fromTeam ?? 0,
      handoffs: s.handoffs ?? 0,
      first: s.first,
      last: s.last,
      days,
    }
  }

  markIdle(name) {
    const a = this.agents.get(name)
    if (a && this.runner.running(name)) this.setStatus(a, 'idle')
  }

  // Keystrokes typed into an agent's terminal in the dashboard.
  input(name, data) {
    const a = this.agents.get(name)
    if (!a) return
    // Codex waits on its hook while a question is in the chat: typing in its terminal hands the question over.
    // Only real keys count, not what the terminal reports by itself (focus in/out, cursor position, mouse).
    if (typed(data)) for (const [id, q] of this.asks) if (q.name === name && q.cli === 'codex') this.answer(id, { terminal: true })
    hold(a, 3000)
    this.runner.write(name, data)
    if (a.status === 'waiting' && data === '\r') this.setStatus(a, 'working')
    // Esc / Ctrl+C interrupt Claude without a Stop hook, so assume idle unless a hook says otherwise.
    if ((data === '\x1b' || data === '\x03') && (a.status === 'working' || a.status === 'waiting')) {
      const pressed = Date.now()
      setTimeout(() => a.hookAt < pressed && a.status !== 'idle' && this.setStatus(a, 'idle'), 1500)
    }
  }

  // ---- messages ----------------------------------------------------------

  // Images pasted, dropped or picked in the UI become files that agents open by path.
  saveImage(name, type, bytes) {
    const ext = IMAGE_TYPES[type]
    if (!ext) throw new Error('only PNG, JPEG, GIF and WebP images')
    if (bytes.length > 20 * 1024 * 1024) throw new Error(`${name || 'image'} is over 20 MB`)
    const file = path.join(ATTACHMENTS, `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.${ext}`)
    fs.writeFileSync(file, Buffer.from(bytes))
    return file
  }

  // Who gets a message: the `to` field (a name, several names, or "any") plus every @name in the text.
  // Explicit recipients skip routing. All of them are checked before anything is posted, so one unknown,
  // turned-off or self recipient rejects the whole send rather than reaching half the crew.
  // Names on another computer (gal@mac-mini) go to `relay`, which main.js wires to Crew Link; `mentions: false`
  // means `to` is final (the message was already addressed on another computer).
  // `fresh`: deliver into a new conversation (started when it's this message's turn). `ticket`: the bug it's about.
  // `re`: the message you're replying to (a feed id here); the copy links to it, so the feed threads it. `quote`
  // ({ from, text }): the same for a message that lives on another computer, which can only be quoted.
  send({ from = 'you', to, text, images = [], mentions = true, fresh = false, ticket, title, type, triage = false, re: replyTo, quote }) {
    text = String(text ?? '').trim()
    images = [].concat(images).filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep))
    if (!text && images.length) text = images.length > 1 ? 'Have a look at these images.' : 'Have a look at this image.'
    if (!text) throw new Error('nothing to send')
    // a clone that went away means its original; a bare name that isn't here but is on exactly one linked
    // computer means that agent
    const local = (n) => [n, this.baseOf(n)].find((x) => this.agents.has(x))
    const all = addressees(to, mentions ? text : '').map((n) => (n.includes('@') ? n : (local(n) ?? this.elsewhere?.(n) ?? n)))
    const away = all.filter((n) => n.includes('@'))
    const names = all.filter((n) => !n.includes('@'))
    if (away.length && !this.relay) throw new Error(`${away.map((n) => `@${n}`).join(', ')} is on another computer, and Crew Link isn't on`)
    const extra = { ...(fresh && { fresh: true }), ...(ticket !== undefined && { ticket, title, ...(type && { type }) }), ...(triage && { triage: true }) }
    if (away.length && !names.length) return this.relay(from, away, text, images, extra)
    const targets = names.length ? this.recipients(names, from) : [this.route(text, from)]
    if (!targets[0]) throw new Error('no agents to send to')

    const held = from !== 'you' && !this.config.autopilot
    const quoted = replyTo ? this.feed.find((e) => e.id === replyTo) : undefined
    const re = quoted?.id ?? this.agents.get(from)?.current // a hand-off points at the request that led to it
    if (this.agents.has(from)) this.record(from, { handoffs: targets.length })
    // Copies of one send share `cc` and `sendId`, so the feed can show them as one message. Each copy keeps its own
    // id, queue state and approval.
    const group = targets.length > 1 && { cc: targets.map((a) => a.name), sendId: randomUUID().slice(0, 8) }
    const said = quoted ? { from: quoted.from, text: quoted.ticket !== undefined ? `#${quoted.ticket} ${quoted.title ?? ''}` : quoted.text } : quote
    const msgs = targets.map((a) => {
      const replying = said && this.replyTag(a, said, quoted)
      return this.post({ kind: 'msg', from, to: a.name, text, ...group, ...extra, ...(images.length && { images }), ...(re && { re }), ...(replying && { replying }), queued: !held, held })
    })
    if (held) return `waiting for the user to approve this hand-off to ${targets.map((a) => `@${a.name}`).join(' ')}\n`
    const here = targets.map((a, i) => this.enqueue(a, msgs[i])).join('')
    return away.length ? this.relay(from, away, text, images, extra).then((there) => here + there) : here
  }

  // What the agent is told about the message you're replying to, so it knows which one: "replying to your message
  // "…"". Nothing when that's simply the last thing it said, or when you're following up on your own message.
  replyTag(a, said, quoted) {
    const who = String(said.from ?? '')
    if (!who || who === 'you') return ''
    const last = this.feed.findLast((e) => e.kind === 'reply' && e.from === a.name)
    if (quoted && who === a.name && last?.id === quoted.id) return ''
    const line = String(said.text ?? '').replace(/```[\s\S]*?```/g, '[code]').replace(/\s+/g, ' ').trim()
    const snip = line.length > 160 ? `${line.slice(0, 157)}…` : line
    return `replying to ${who === a.name ? 'your message' : `@${who}'s message`} "${snip}"`
  }

  recipients(names, from) {
    const list = (xs) => xs.map((n) => `@${n}`).join(', ')
    const after = names.length > 1 ? ' (nothing was sent)' : ''
    const unknown = names.filter((n) => !this.agents.has(n))
    if (unknown.length) throw new Error(`no agent named ${unknown.map((n) => `"${n}"`).join(', ')} (try: crew who)${after}`)
    // an agent and its clones are one agent
    const me = names.find((n) => this.baseOf(n) === this.baseOf(from))
    if (me) throw new Error(`${names.length > 1 ? `@${me} is you, leave yourself off` : "that's you, pick a teammate (crew who)"}${me === from ? '' : ` (@${me} and @${from} are the same agent)`}${after}`)
    const off = names.filter((n) => this.agents.get(n).off)
    if (off.length) throw new Error(`${list(off)} ${off.length > 1 ? 'are' : 'is'} turned off, turn ${off.length > 1 ? 'them' : 'it'} on first${after}`)
    const moving = names.filter((n) => this.agents.get(n).moving)
    if (moving.length) throw new Error(`${list(moving)} ${moving.length > 1 ? 'are' : 'is'} moving to another computer, send it again in a moment${after}`)
    return names.map((n) => this.agents.get(n))
  }

  enqueue(a, msg) {
    const to = this.placeFor(a, msg)
    if (to !== a) this.amend(msg, { to: to.name })
    to.inbox.push(msg)
    const busy = to.status !== 'idle' || to.inbox.length > 1
    const starting = to.status === 'starting'
    this.pump(to)
    if (to.cloneOf === a.name && !this.pinned.has(msg)) return `@${a.name} is busy, so ${starting ? `a clone, @${to.name}, is starting up to take this` : `its clone @${to.name} took this`}\n`
    return busy ? `queued for @${to.name} (${to.status}, ${to.inbox.length} waiting)\n` : `sent to @${to.name}\n`
  }

  // Hand-offs between agents wait here for you when autopilot is off.
  approve(id) {
    const msg = this.feed.find((m) => m.id === id && m.held)
    const a = msg && (this.agents.get(msg.to) ?? this.agents.get(this.baseOf(msg.to))) // for a clone that went away: its original
    if (!a) return
    Object.assign(msg, { held: false, queued: true })
    this.enqueue(a, msg)
    this.changed()
  }

  drop(id) {
    const msg = this.feed.find((m) => m.id === id && m.held)
    if (!msg) return
    Object.assign(msg, { held: false, dropped: true })
    this.changed()
  }

  // Best agent for an un-addressed task: area match first, then whoever is free, then the shortest queue.
  // An area matches on shared words and on shared intents (see INTENTS), so "keep the crew in working order"
  // finds the organiser even though none of its words are in "admin work, assistant, organiser".
  route(text, from) {
    const ready = [...this.agents.values()].filter((a) => !a.cloneOf && a.name !== this.baseOf(from) && this.runner.running(a.name))
    const best = bestFor(text, ready.map((a) => this.lineup(a)))
    return best && this.agents.get(best.name)
  }

  // Deliver the next queued message once the agent is idle and nothing asked to hold off (e.g. you typing in its terminal).
  pump(a) {
    clearTimeout(a.timer)
    if (a.status !== 'idle' || !this.runner.running(a.name)) return
    if (a.cloneOf && !a.inbox.length) this.takeOver(a) // a clone with nothing of its own takes what waits for its original
    if (!a.inbox.length) return a.cloneOf && this.linger(a)
    const wait = a.holdUntil - Date.now()
    if (wait > 0) {
      a.timer = setTimeout(() => this.pump(a), wait)
      return
    }
    // A task meant for a fresh conversation: start one, and deliver once it's up.
    if (a.inbox[0].fresh && a.freshFor !== a.inbox[0].id) {
      a.freshFor = a.inbox[0].id
      return this.startFresh(a, a.inbox[0].ticket !== undefined ? ` for #${a.inbox[0].ticket}` : ' for its next task')
    }
    // Still drawing: starting up, or finishing a turn under a hook's spinner. Text typed now can be dropped, or read
    // together with its Enter, which the CLI then takes as part of the text.
    if (a.settleFor !== a.inbox[0].id) Object.assign(a, { settleFor: a.inbox[0].id, settleFrom: Date.now() })
    const drawing = SETTLE_QUIET - (this.runner.quietFor?.(a.name) ?? Infinity)
    if (drawing > 0 && Date.now() - a.settleFrom < SETTLE_MAX) {
      a.timer = setTimeout(() => this.pump(a), drawing)
      return
    }
    const msg = a.inbox.shift()
    msg.queued = false
    if (msg.ticket !== undefined && !msg.triage) (this.convoOf(a).ticket = msg.ticket), this.saveConvos() // this conversation is about that bug now
    const also = msg.cc?.filter((n) => n !== a.name).map((n) => `@${n}`).join(' ')
    const tag = [msg.from !== 'you' && `from @${msg.from}`, msg.replying, also && `also sent to ${also}, split the work`].filter(Boolean).join(', ')
    // A line Crew owes the agent (it moved to this computer while free) goes on top of the next message it gets.
    const note = this.convos[a.name]?.note
    if (note) delete this.convos[a.name].note, this.saveConvos()
    const text = [note, tag ? `[${tag}] ${msg.text}` : msg.text].filter(Boolean).join('\n\n')
    this.runner.submit(a.name, withImages(text, msg.images))
    // Matched against the prompt the agent reports, even if it shows up late. Only the words count:
    // Claude Code turns attached image paths into "[Image #1]" and moves them around.
    a.expect = { id: msg.id, text }
    // (Crew's own prompts, like "you were moved here", aren't messages anyone sent it)
    if (!msg.crew) this.record(a.name, { [msg.from === 'you' ? 'fromYou' : 'fromTeam']: 1, delivered: 1, queuedMs: Date.now() - msg.ts })
    this.awaitPickup(a)
    this.setStatus(a, 'working')
  }

  // UserPromptSubmit cancels this. Until then, press Enter again in case the first one was swallowed: a loaded Mac
  // can stall the CLI long enough that the next Enter is lost too, so keep at it for minutes, not seconds.
  awaitPickup(a, waits = PICKUP_WAITS) {
    clearTimeout(a.ack)
    const [ms, ...rest] = waits
    a.ack = setTimeout(() => {
      if (a.status !== 'working') return
      if (a.holdUntil > Date.now()) return this.awaitPickup(a, waits) // you're typing in its terminal: don't send your line
      if (!rest.length) return this.needsYou(a, "didn't pick up the last message, check its terminal")
      this.runner.write(a.name, '\r')
      this.awaitPickup(a, rest)
    }, ms)
  }

  // ---- tasks ------------------------------------------------------------------------------------

  // You add a task (a bug, a feature, a chore) in the chat or on the Tasks board. The triage agent, if you
  // picked one, makes it clear and assigns it; otherwise it goes to whoever's area it matches. With Auto-start
  // on, the owner gets it right away, in a fresh conversation. `owner` (an @name you typed) skips all that.
  fileTask({ text, images = [], by = 'you', kind = 'task', owner }) {
    images = [].concat(images).filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep))
    if (!String(text ?? '').trim() && images.length) text = 'See the screenshot'
    owner = owner ? this.agentName(owner) : null
    const t = this.tickets.add({ text, images, by, kind: KINDS.includes(kind) ? kind : 'task', owner })
    if (owner) {
      t.triaged = true // you said who: nothing to triage
      this.postTask(t, by, 'filed')
      if (this.config.autofix) this.autoDispatch(t)
      return `added #${t.id} for @${owner}\n`
    }
    const triage = this.triager()
    if (!triage) {
      const owner = ownerFor(`${t.title} ${t.body}`, this.teammates())
      if (owner) this.tickets.edit(t.id, { owner: owner.name }, 'crew')
    }
    this.postTask(t, by, 'filed')
    if (triage) this.send({ from: 'you', to: triage, text: triagePrompt(t, t.id), images: t.images, mentions: false, ticket: t.id, title: t.title, type: t.kind, triage: true })
    else if (this.config.autofix && t.owner) this.autoDispatch(t)
    return `added #${t.id}${triage ? `, @${triage} is triaging it` : t.owner ? ` for @${t.owner}` : ''}\n`
  }

  // The triage agent you picked, if it's around to do it.
  triager() {
    const a = this.agents.get(this.config.triage)
    return a && !a.off ? a.name : null
  }

  // Everyone who can own a task: agents here that are on, and the ones on linked computers.
  teammates() {
    const here = [...this.agents.values()].filter((a) => !a.off && !a.cloneOf).map((a) => this.lineup(a))
    return [...here, ...(this.directory?.() ?? []).filter((a) => a.on && !a.cloneOf).map((a) => ({ name: a.name, area: a.area, status: a.status, queue: a.queue ?? 0 }))]
  }

  // A task goes to its owner in a fresh conversation with just this task in it. If the owner is still in the
  // conversation where it worked on this task, "send back" goes there, with everything it already tried.
  async dispatch(id, opts) {
    const { to, note } = opts ?? {} // over Crew Link a missing argument arrives as null
    const t = this.tickets.get(id)
    const owner = this.agentName(to || t.owner || ownerFor(`${t.title} ${t.body}`, this.teammates())?.name)
    if (!owner) throw new Error(`who should fix #${t.id}? Pick an owner first`)
    const here = this.agents.get(owner)
    // a double click, or Auto-fix and you at once: it's already on its way
    if (!note && here && [here, ...this.clonesOf(here)].some((x) => x.inbox.some((m) => m.ticket === t.id && !m.triage))) return `#${t.id} is already queued for @${owner}\n`
    // the owner, or the clone of it, still in the conversation where it worked on this task
    const on = t.fixer === owner ? this.stillOn(owner, t.id) : null
    const again = Boolean(on)
    const ref = owner.includes('@') ? `${t.id}@${this.self}` : String(t.id)
    const out = await this.send({ from: 'you', to: on ?? owner, text: fixPrompt(t, ref, note, again), images: again ? [] : t.images, mentions: false, fresh: !again, ticket: t.id, title: t.title, type: t.kind })
    if (owner !== t.owner) this.tickets.edit(t.id, { owner }, 'you')
    t.fixer = owner
    this.tickets.move(t.id, 'fixing', 'you', again ? `sent it back to @${owner}` : `sent it to @${owner}, in a new conversation`)
    this.postTask(t, 'you', 'fixing', owner)
    return out
  }

  // Which of `name` and its clones is still in the conversation about task `id`, with nothing else lined up to start
  // fresh first? Its name, or null.
  stillOn(name, id) {
    const a = this.agents.get(name)
    if (a) return [a, ...this.clonesOf(a)].find((x) => this.convos[x.name]?.ticket === id && !x.freshPending && !x.inbox.some((m) => m.fresh))?.name ?? null
    const there = (this.directory?.() ?? []).filter((x) => x.name === name || x.cloneOf === name) // an agent on a linked computer
    return there.find((x) => String(x.ticket) === String(id) && !x.freshPending && !x.queue)?.name ?? null
  }

  autoDispatch(t) {
    this.dispatch(t.id).catch((e) => this.post({ kind: 'event', from: 'crew', text: `couldn't send #${t.id} on: ${e.message}` }))
  }

  // A name for an owner: an agent here, or (bare or name@computer) one on a linked computer.
  agentName(name) {
    if (!name) return null
    name = this.baseOf(String(name).trim().replace(/^@/, '').toLowerCase()) // a task belongs to the agent, not one of its clones
    if (this.agents.has(name)) return name
    const there = (this.directory?.() ?? []).map((a) => a.name)
    if (there.includes(name)) return name
    const found = this.elsewhere?.(name)
    if (found) return found
    throw new Error(`no agent named "${name}" (try: crew who)`)
  }

  // One line in the feed for what happened to a task (`type` is its kind: bug, feature, task). A task filed for
  // someone says who, so it shows in your conversation with them too.
  postTask(t, from, act, text) {
    this.post({ kind: 'task', type: t.kind, from, ticket: t.id, title: t.title, act, ...(text && { text }), ...(act === 'filed' && t.owner && { owner: t.owner }) })
  }

  // `crew task ...` (or `crew bug ...`) from an agent or your terminal. args are the words after it.
  taskCommand(from, args) {
    let [op = 'help', ...rest] = args
    op = { fixed: 'done', report: 'add' }[op] ?? op // the names from when it was the Bugs board
    const flags = {}
    const words = []
    for (let i = 0; i < rest.length; i++) {
      const m = rest[i].match(/^--(owner|severity|priority|kind|title|details)(?:=(.*))?$/)
      if (m) flags[m[1] === 'severity' ? 'priority' : m[1]] = m[2] ?? rest[++i]
      else words.push(rest[i])
    }
    if (flags.priority !== undefined && !priorityOf(flags.priority)) throw new Error('--priority is one of: urgent, high, medium, low')
    if (flags.kind !== undefined && !KINDS.includes(flags.kind)) throw new Error(`--kind is one of: ${KINDS.join(', ')}`)
    // 12 is a task here; 12@air one that lives on another computer (12@<this computer> is here too)
    const split = (r) => {
      const [id, host] = String(r ?? '').replace(/^#/, '').split('@')
      return { id, host: host && host !== this.self ? host : null }
    }
    const withId = ['show', 'done', 'note', 'triage', 'dup'].includes(op)
    const { id: ref, host } = withId ? split(words[0]) : { id: '', host: null }
    const original = op === 'dup' ? split(words[1]) : null
    if (original && !original.id) throw new Error('usage: crew task dup <n> <original>')
    if (original && original.host !== host) throw new Error('both tasks must be on the same computer')
    if (host) {
      // the same command on the computer the task lives on, with the numbers as it knows them
      if (!this.relayTask) throw new Error(`#${words[0]} is on another computer, and Crew Link isn't on`)
      const there = rest.map((w) => (w === words[0] ? ref : original && w === words[1] ? original.id : w))
      return this.relayTask(host, from, [op, ...there])
    }
    if (original) words[1] = original.id
    const by = this.baseOf(from) // the board remembers the agent; the feed shows which clone of it did it
    const t = withId ? this.tickets.get(ref) : null
    const text = words.slice(1).join(' ')
    switch (op) {
      case 'list': {
        const open = this.tickets.open()
        return open.length ? open.map(ticketLine).join('\n') + '\n' : '(no open tasks)\n'
      }
      case 'show':
        return ticketText(t)
      case 'add': {
        const owner = flags.owner ? this.agentName(flags.owner) : null
        const n = this.tickets.add({ title: words[0], body: flags.details ?? words.slice(1).join(' '), by, owner, severity: priorityOf(flags.priority), kind: flags.kind ?? 'task' })
        this.postTask(n, from, 'filed')
        return `added #${n.id}\n`
      }
      case 'triage': {
        const owner = flags.owner ? this.agentName(flags.owner) : undefined
        this.tickets.edit(t.id, { owner, severity: flags.priority, kind: flags.kind, title: flags.title, body: flags.details, triaged: true }, by)
        this.postTask(t, from, 'triaged', t.owner)
        if (this.config.autofix && t.status === 'new' && t.owner) this.autoDispatch(t)
        return `#${t.id}: ${t.kind}, ${t.owner ? `for @${t.owner}` : 'unassigned'}${this.config.autofix && t.owner ? ', sent to them' : ''}\n`
      }
      case 'done': {
        if (!text) throw new Error(`usage: crew task done ${ref} "what you did, how you checked"`)
        if (t.status === 'done') throw new Error(`#${t.id} is already closed${t.dupOf ? ` (same as #${t.dupOf})` : ''}`)
        const bug = t.kind === 'bug'
        Object.assign(t, { fix: text, fixer: by })
        this.tickets.move(t.id, 'check', by, `${bug ? 'fixed' : 'did'} it: ${text}`)
        this.postTask(t, from, 'fixed', text)
        this.emit('notice', { title: `@${by} ${bug ? 'fixed' : 'finished'} #${t.id}`, body: `${t.title}. Review it`, focus: `task:${t.id}` })
        return `#${t.id} is waiting for the user to review it\n`
      }
      case 'note':
        this.tickets.note(t.id, by, text)
        this.postTask(t, from, 'note', text)
        return `noted on #${t.id}\n`
      case 'dup': {
        const original = this.tickets.dup(t.id, words[1], by)
        this.postTask(t, from, 'dup', `#${original.id}`)
        return `#${t.id} is #${original.id} (seen ${original.seen}x now)\n`
      }
      default:
        return TASK_HELP
    }
  }

  // What the Tasks board can do. op: file, edit, note, dispatch, accept, sendBack, move, dup, remove.
  // (works / broken are the names from when it was the Bugs board.)
  async ticket(op, id, arg) {
    op = { works: 'accept', broken: 'sendBack' }[op] ?? op
    if (op === 'file') return this.fileTask(arg)
    const t = this.tickets.get(id)
    switch (op) {
      case 'edit':
        if (arg.owner) arg = { ...arg, owner: this.agentName(arg.owner) }
        if (arg.images) arg = { ...arg, images: arg.images.filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep)) }
        return void this.tickets.edit(t.id, arg, 'you')
      case 'note':
        this.tickets.note(t.id, 'you', arg)
        return void this.postTask(t, 'you', 'note', arg)
      case 'dispatch':
        return this.dispatch(t.id, arg)
      case 'accept':
        this.tickets.move(t.id, 'done', 'you', t.kind === 'bug' ? 'checked it: works' : 'accepted it')
        return void this.postTask(t, 'you', 'done')
      case 'sendBack':
        if (arg?.trim()) this.tickets.note(t.id, 'you', `${t.kind === 'bug' ? 'still broken' : 'sent back'}: ${arg.trim()}`)
        if (t.fixer) return this.dispatch(t.id, { to: t.fixer, note: arg?.trim() })
        this.tickets.move(t.id, 'new', 'you', 'reopened it')
        return void this.postTask(t, 'you', 'reopened')
      case 'move':
        if (arg === t.status) return
        if (arg === 'fixing') return this.dispatch(t.id)
        if (arg === 'done') return this.ticket('accept', id)
        this.tickets.move(t.id, arg, 'you', arg === 'check' ? 'marked it done' : 'moved it back to To do')
        return void this.postTask(t, 'you', arg === 'check' ? 'fixed' : 'reopened')
      case 'dup':
        return void this.postTask(t, 'you', 'dup', `#${this.tickets.dup(t.id, arg, 'you').id}`)
      case 'remove':
        return void this.tickets.remove(t.id)
    }
    throw new Error(`unknown task action "${op}"`)
  }

  setTaskSettings({ triage, autofix }) {
    if (triage !== undefined) this.config.triage = triage || undefined
    if (autofix !== undefined) this.config.autofix = Boolean(autofix) || undefined
    this.saveConfig()
  }

  note(from, text) {
    text = String(text ?? '').trim()
    if (!text) throw new Error('nothing to note')
    const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
    fs.appendFileSync(at('board.md'), `- **${from}** (${when}): ${text.replace(/\s*\n\s*/g, ' ')}\n`)
    this.post({ kind: 'note', from, text })
    return 'shared with the crew\n'
  }

  board() {
    try {
      return fs.readFileSync(at('board.md'), 'utf8').split('\n').slice(-200).join('\n')
    } catch {
      return '(no shared notes yet)\n'
    }
  }

  who() {
    if (!this.agents.size) return '(no agents)\n'
    const rows = this.ordered().map((a) => {
      const queue = a.inbox.length ? `, ${a.inbox.length} queued` : ''
      if (a.off) return `${a.name.padEnd(16)} off`
      if (a.cloneOf) return `${a.name.padEnd(16)} ${(a.status + queue).padEnd(20)} ${''.padEnd(22)} a clone of ${a.cloneOf}, on a task of its own`
      const brain = [this.providerOf(a)?.label, a.model, a.effort].filter(Boolean).join(' ')
      const clones = this.maxClones(a) ? ` (clones itself when busy, up to ${this.maxClones(a)})` : ''
      return `${a.name.padEnd(16)} ${(a.status + queue).padEnd(20)} ${brain.padEnd(22)} ${a.area ?? ''}${clones}`
    })
    // teammates on your other computers (Crew Link), addressed as name@computer
    for (const a of this.directory?.() ?? []) rows.push(`${a.name.padEnd(16)} ${(a.on ? a.status : 'off').padEnd(20)} ${''.padEnd(22)} ${a.area ?? ''}`)
    return rows.join('\n') + '\n'
  }

  // ---- feed + snapshots --------------------------------------------------

  post(entry) {
    const e = { id: randomUUID().slice(0, 8), ts: Date.now(), ...entry }
    this.feed.push(e)
    if (this.feed.length > FEED_KEEP) this.feed.splice(0, this.feed.length - FEED_KEEP)
    this.save(e)
    this.changed()
    return e
  }

  // A later change to a feed entry (a question's answer), saved after it so it survives a restart.
  amend(e, patch) {
    Object.assign(e, patch)
    this.save({ amend: e.id, ...patch })
    this.changed()
  }

  save(line) {
    this.saving = this.saving.then(() => fs.promises.appendFile(at('feed.jsonl'), JSON.stringify(line) + '\n')).catch(() => {})
  }

  // ---- an agent moving between computers (core/move.js) ---------------------------------------------

  // feed.jsonl, written anew: it only ever grows, but lines leave with an agent that moves away and arrive (older
  // than what's here) with one that moves in. The lines are taken now, so one posted meanwhile lands after them.
  rewriteFeed() {
    const text = this.feed.map((e) => JSON.stringify(e) + '\n').join('')
    this.saving = this.saving.then(() => fs.promises.writeFile(at('feed.jsonl'), text)).catch(() => {})
  }

  // Lines from another computer, for an agent that moved here: merged in by time.
  adoptFeed(entries) {
    const have = new Set(this.feed.map((e) => e.id))
    this.feed.push(...entries.filter((e) => !have.has(e.id)))
    this.feed.sort((x, y) => x.ts - y.ts)
    if (this.feed.length > FEED_KEEP) this.feed.splice(0, this.feed.length - FEED_KEEP)
    this.rewriteFeed()
    this.changed()
  }

  // An agent goes by another name now (it moved to another computer, or here): `from` and `to` as this computer
  // writes them (gal, gal@air). Lines in the chat, the Tasks board and what you've read follow it.
  // Returns whether the feed changed (the caller rewrites it).
  renameRefs(from, to) {
    if (!from || !to || from === to) return false
    let feed = false
    let board = false
    for (const e of this.feed) {
      for (const k of ['from', 'to']) if (e[k] === from) (e[k] = to), (feed = true)
      if (e.cc?.includes(from)) (e.cc = e.cc.map((n) => (n === from ? to : n))), (feed = true)
      if ((e.act === 'fixing' || e.act === 'triaged') && e.text === from) (e.text = to), (feed = true)
    }
    for (const t of this.tickets.all) {
      for (const k of ['owner', 'fixer', 'by']) if (t[k] === from) (t[k] = to), (board = true)
      for (const l of t.log ?? []) if (l.by === from) (l.by = to), (board = true)
    }
    if (board) this.tickets.save()
    if (this.reads.agents[from] !== undefined) {
      this.reads.agents[to] = Math.max(this.reads.agents[to] ?? 0, this.reads.agents[from])
      delete this.reads.agents[from]
      this.saveReads()
    }
    this.changed()
    return feed
  }

  changed() {
    this.emit('change')
  }

  snapshot() {
    return {
      autopilot: this.config.autopilot,
      theme: this.config.theme,
      providers: Object.fromEntries(
        Object.values(this.providers).map((p) => [p.id, { label: p.label, models: p.models, efforts: p.efforts, modelEfforts: p.modelEfforts, missing: p.missing, fastByDefault: p.fastByDefault }]),
      ),
      agents: this.ordered().map((a) => ({
        name: a.name, area: a.area, prompt: a.prompt, images: a.images, provider: this.providerOf(a)?.id ?? a.provider, model: a.model, effort: a.effort, cwd: a.cwd,
        tier: a.tier, fast: this.providerOf(a)?.fastByDefault === undefined ? undefined : a.tier ? a.tier === 'fast' : this.providerOf(a).fastByDefault,
        args: (a.args ?? []).join(' '), avatar: a.avatar, status: a.status, since: a.since, activity: a.activity,
        queue: a.inbox.length, yolo: Boolean(a.yolo), pending: Boolean(a.relaunch), on: !a.off, stats: this.statsOf(a),
        // how full, measured against its own context limit when it has one
        convo: this.convos[a.name] ? { ...this.convos[a.name], context: againstLimit(this.convos[a.name].context, a.contextLimit) } : null,
        contextLimit: Number(a.contextLimit) > 0 ? Number(a.contextLimit) : null, onContextLimit: a.onContextLimit === 'notify' ? 'notify' : 'fresh',
        freshPending: Boolean(a.freshPending), ticket: this.convos[a.name]?.ticket ?? null,
        // a clone: whose, and its number (gal.2 is clone 2); it looks like its original
        clones: this.maxClones(a), ...(a.cloneOf && { cloneOf: a.cloneOf, clone: a.clone, avatar: { seed: a.avatar?.seed ?? a.cloneOf, ...a.avatar } }),
        // its sub-agents: the running ones, and ones that just finished
        subs: [...(a.subs?.values() ?? [])].filter((x) => !x.ended || Date.now() - x.ended < SUB_LINGER).map(({ id, type, description, started, ended, tools, activity }) => ({ id, type, description, started, ended, tools, activity })),
      })),
      feed: withOpenAsks(this.feed.slice(-200), this.asks),
      reads: this.reads,
      tasks: {
        tickets: [...this.tickets.open(), ...this.tickets.all.filter((t) => t.status === 'done').sort((x, y) => x.updated - y.updated).slice(-60)],
        triage: this.config.triage ?? null,
        autofix: Boolean(this.config.autofix),
      },
    }
  }
}

// Form values -> config values: trim, split flags, and drop empties (so `false`/"" delete the key).
function clean(patch) {
  const out = {}
  for (let [k, v] of Object.entries(patch)) {
    if (typeof v === 'string') v = v.trim()
    if (k === 'args' && typeof v === 'string') v = v ? v.split(/\s+/) : undefined
    out[k] = v === '' || v === false || v === null || (Array.isArray(v) && !v.length) ? undefined : v
  }
  return out
}

// Does the prompt an agent reports match what we typed into it? (Whitespace can differ.)
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const samePrompt = (reported, sent) => reported === undefined || squash(reported).includes(squash(sent).slice(0, 60))

// Agents get images as file paths (Claude Code and Codex can both open local images).
const withImages = (text, images) =>
  images?.length ? `${text}\n\nAttached image${images.length > 1 ? 's' : ''} (open to view):\n${images.join('\n')}` : text

const hold = (a, ms) => {
  a.holdUntil = Math.max(a.holdUntil, Date.now() + ms)
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function loadFeed() {
  let lines
  try {
    lines = fs.readFileSync(at('feed.jsonl'), 'utf8').trim().split('\n')
  } catch {
    return []
  }
  if (lines.length > FEED_KEEP * 2) {
    lines = lines.slice(-FEED_KEEP)
    fs.writeFileSync(at('feed.jsonl'), lines.join('\n') + '\n')
  }
  const feed = []
  const byId = new Map()
  for (const line of lines) {
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.amend) {
      const { amend, ...patch } = e
      Object.assign(byId.get(amend) ?? {}, patch)
      continue
    }
    const entry = { ...e, queued: false, held: false }
    feed.push(entry)
    byId.set(entry.id, entry)
  }
  // An unanswered question's hook ended with the last run: the agent isn't waiting on it any more.
  for (const e of feed) if (e.kind === 'ask' && !e.answer) e.answer = { stale: true }
  return feed.slice(-FEED_KEEP) // amendments don't count against the history kept
}

// ---- questions: what the agent wants, as a card; your answer, as its hook's decision ----------------

// What a terminal sends without anyone typing: focus in/out, cursor position and device replies, mouse reports,
// OSC replies. Anything else is a key.
const typed = (data) => !/^(?:\x1b\[(?:I|O|\d+;\d+R|[?>][\d;]*c|<[\d;]+[Mm])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/.test(String(data))

// A question that's still open stays on screen however long it waits, even past the last 200 entries.
const withOpenAsks = (recent, asks) => {
  const older = [...asks.values()].map((q) => q.entry).filter((e) => !recent.includes(e))
  return older.length ? [...older, ...recent] : recent
}

const clip = (text, max = 4000) => (String(text ?? '').length > max ? `${String(text).slice(0, max)}\n…` : String(text ?? ''))
const firstLines = (text, n) => clip(String(text ?? '').split('\n').slice(0, n).join('\n'))

// The card for a PermissionRequest hook payload (Claude or Codex), plus the line for the notification.
function askOf({ tool_name: tool = '', tool_input: input = {}, permission_suggestions: suggestions = [] } = {}, cli) {
  if (tool === 'AskUserQuestion') {
    const questions = (input.questions ?? []).slice(0, 4).map((q) => ({
      question: String(q.question ?? ''),
      header: q.header ? String(q.header) : '',
      multiSelect: Boolean(q.multiSelect),
      options: (q.options ?? []).map((o) => ({ label: String(o.label ?? ''), ...(o.description && { description: String(o.description) }) })),
    }))
    return { type: 'question', questions, alert: `asks: ${questions[0]?.question ?? 'a question'}` }
  }
  if (tool === 'ExitPlanMode') return { type: 'plan', plan: clip(input.plan, 20000), alert: 'has a plan for you to approve' }
  const file = input.file_path ?? input.notebook_path
  const name = file ? path.basename(file) : ''
  const shown = {
    Bash: { title: 'Run a command', code: clip(input.command), detail: input.description },
    Edit: { title: `Edit ${name}`, code: firstLines(`- ${String(input.old_string ?? '').split('\n').join('\n- ')}\n+ ${String(input.new_string ?? '').split('\n').join('\n+ ')}`, 40), detail: file },
    MultiEdit: { title: `Edit ${name}`, code: firstLines((input.edits ?? []).map((x) => `- ${x.old_string}\n+ ${x.new_string}`).join('\n'), 40), detail: file },
    Write: { title: `Write ${name}`, code: firstLines(input.content, 30), detail: file },
    NotebookEdit: { title: `Edit ${name}`, code: firstLines(input.new_source, 30), detail: file },
    Read: { title: `Read ${name || 'a file'}`, code: file },
    WebFetch: { title: 'Open a web page', code: input.url, detail: input.prompt },
    WebSearch: { title: 'Search the web', code: input.query },
  }[tool] ?? { title: tool.startsWith('mcp__') ? `Use ${tool.split('__').slice(1).join(' › ')}` : `Use ${tool || 'a tool'}`, code: clip(JSON.stringify(input, null, 2), 2000) }
  // Claude's "yes, and don't ask again" choices for this request; Codex has none.
  const always = cli === 'claude' ? suggestions.map((s, i) => ({ i, label: alwaysLabel(s) })).filter((s) => s.label) : []
  const gist = String(shown.code ?? '').split('\n')[0].slice(0, 80) // the notification says what, not just "a command"
  const alert = `wants to ${shown.title.charAt(0).toLowerCase()}${shown.title.slice(1)}${gist && tool !== 'Edit' && tool !== 'MultiEdit' && tool !== 'Write' ? `: ${gist}` : ''}`
  return { type: 'permission', tool, ...shown, ...(shown.detail && { detail: clip(shown.detail, 400) }), always, alert }
}

function alwaysLabel(s) {
  const when = s.destination === 'session' ? ' this session' : ''
  if (s.type === 'addRules' && s.behavior === 'allow' && s.rules?.length) return `Always allow ${s.rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(', ')}${when}`
  if (s.type === 'addDirectories' && s.directories?.length) return `Always allow in ${s.directories.map((d) => path.basename(d)).join(', ')}${when}`
  if (s.type === 'setMode' && s.mode === 'acceptEdits') return 'Allow all edits this session'
  return null
}

// Your reply as a PermissionRequest decision. Claude and Codex share its shape; only Claude takes
// updatedInput (answers, the approved plan) and updatedPermissions (an "always" choice).
function decide(ask, input, cli, reply) {
  const out = (decision) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } })
  const note = String(reply.note ?? '').trim().slice(0, 2000)
  if (ask.type === 'question') {
    const answers = {}
    for (const q of ask.questions) {
      const v = reply.answers?.[q.question]
      const text = Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v ?? '').trim()
      if (text) answers[q.question] = text
    }
    if (!Object.keys(answers).length) throw new Error('pick an answer first')
    return { output: out({ behavior: 'allow', updatedInput: { ...input.tool_input, answers } }), answer: { answers } }
  }
  if (reply.allow) {
    const decision = { behavior: 'allow' }
    if (cli === 'claude' && ask.type === 'plan') decision.updatedInput = input.tool_input // it has to see the plan approved
    const always = cli === 'claude' && Number.isInteger(reply.always) ? input.permission_suggestions?.[reply.always] : null
    if (always) decision.updatedPermissions = [always]
    return { output: out(decision), answer: { allow: true, ...(always && { always: alwaysLabel(always) }) } }
  }
  const message = ask.type === 'plan' ? `The user wants you to keep planning${note ? `: ${note}` : '.'}` : note ? `The user said no: ${note}` : 'The user said no.'
  return { output: out({ behavior: 'deny', message }), answer: { allow: false, ...(note && { note }) } }
}

const expand = (dir) => (dir ? dir.replace(/^~(?=\/|$)/, os.homedir()) : os.homedir())

const tokens = (s) =>
  (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP_WORDS.has(w)).map((w) => w.replace(/(?<=...)s$/, ''))

// Kinds of work an area can own beyond its literal words. A word counts when it starts with one of the stems;
// phrases are matched as written. A fixed list, so it only knows the intents spelled out here.
const INTENTS = {
  coordination: {
    stems: ['organi', 'orchestrat', 'coordinat', 'delegat', 'dispatch', 'triag', 'assign', 'reassign', 'prioriti', 'admin', 'assistant', 'crew', 'roster', 'handoff'],
    phrases: ['hand off', 'hand-off', 'working order', 'multiple agents', 'several agents', 'other agents', 'all agents', 'which agent', 'who should', 'who does what', 'split the work'],
  },
}

const intents = (s) => {
  const text = String(s).toLowerCase().replace(/\s+/g, ' ')
  const words = text.match(/[a-z0-9]+/g) ?? []
  return new Set(
    Object.entries(INTENTS)
      .filter(([, { stems, phrases }]) => words.some((w) => stems.some((st) => w.startsWith(st))) || phrases.some((p) => text.includes(p)))
      .map(([name]) => name),
  )
}

// Who a message is addressed to: `to` (one name, "david,joseph", "david joseph", or "any"/empty) plus every
// bare @name in the text, wherever it is. The text itself is left as written. Not addresses: @words glued to
// something (someone@example.com, @types/node, @david's), code in backticks, and @any/@you/@crew.
// Names are case-insensitive and come back lowercase, without duplicates, in the order they appear.
// An agent on another computer is name@computer: "@gal@mac-mini" in text, or "gal@mac-mini" in `to`.
export function addressees(to, text) {
  const prose = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
  const mentions = [...prose.matchAll(/(?<![\w.@/'-])@([\w-]+(?:@[\w-]+)?)(?![\w@/'-]|\.\w)/g)].map((m) => m[1])
  const names = [...String(to ?? '').split(/[\s,]+/), ...mentions].map((n) => n.toLowerCase())
  return [...new Set(names)].filter((n) => n && !RESERVED.has(n) && n !== 'auto')
}

// The best agent for an un-addressed task: area match first, then whoever is free, then the shortest queue.
// agents: [{ name, area, status, queue }], already narrowed to the ones that can take work.
export function bestFor(text, agents) {
  const score = areaScore(text)
  const free = (a) => Number(a.status === 'idle' && !a.queue)
  return [...agents].sort((x, y) => score(y) - score(x) || free(y) - free(x) || x.queue - y.queue)[0]
}

// How well each agent's name and area match a piece of text: shared words, plus shared intents counted double.
function areaScore(text) {
  const words = new Set(tokens(text))
  const asks = intents(text)
  return (a) => {
    const own = `${a.name.split('@')[0]} ${a.area ?? ''}`
    return [...new Set(tokens(own))].filter((w) => words.has(w)).length + 2 * [...intents(own)].filter((i) => asks.has(i)).length
  }
}

// Who owns a bug by area: the best match, only if its area actually matches (no "whoever's free" fallback).
export function ownerFor(text, agents) {
  const score = areaScore(text)
  const best = bestFor(text, agents)
  return best && score(best) > 0 ? best : null
}

function describe({ tool_name: tool, tool_input: input = {} }) {
  const arg = input.file_path ? path.basename(input.file_path) : (input.command ?? input.pattern ?? input.url ?? input.description ?? '')
  const short = String(arg).split('\n')[0].slice(0, 60)
  return short ? `${tool} · ${short}` : tool
}

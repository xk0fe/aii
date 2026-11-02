// The brain: agents, their status, inboxes, the shared feed and routing. No Electron in here.
import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { adapters, ASK_WAIT } from './adapters.js'
import { providersFrom, expandEnv, discoverCodex } from './providers.js'
import { generatePrompt } from './promptgen.js'
import { Tickets, ticketLine, ticketText, fixPrompt, triagePrompt, TASK_HELP, KINDS, priorityOf, PRIORITY_NAME } from './tickets.js'
import { fromStatusLine, fromCodexLog, codexLog, againstLimit, tokens as tokenCount, limitsFrom, codexLimitsFrom, limitName, spentFrom, codexSpent } from './context.js'
import { callResult } from './transcript.js'
import { processes, tree, noteworthy, readGroups, readSpans, leftovers, exempt, gitBash, prefixWorks, stop as stopProcesses, summary } from './procs.js'
import { Config } from './config.js'
import { DEFAULT, dirOf, space, forget, renameShared, sharedNames } from './workspaces.js'

export const HOME = process.env.CREW_HOME || path.join(os.homedir(), '.crew')
export const CONFIG = path.join(HOME, 'config.json')
export const ATTACHMENTS = path.join(HOME, 'attachments')
const localDay = (t = Date.now()) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
// Files about you or this computer. A workspace's own files are in its folder (Hub.at).
const at = (file) => path.join(HOME, file)
// Where each agent's CLI writes down the process groups of the commands it runs, a file per launch (core/procs.js), in
// its workspace's folder.
const GROUPS = path.join('run', 'groups')
// How often an agent's process tree is looked at for groups bin/crew-sh doesn't see (Codex, the CLI's own children).
const TREE_CHECK = 15000
// Hook events an agent's CLI couldn't deliver while Crew was closed (adapters.js), replayed when it's back. In the
// agent's workspace's folder.
const SPOOL = 'spool'
// What Crew remembers of each agent at work, so it can pick them up after a restart while their terminals carried on in
// the terminal host (core/ptyhost.js): saved as things change, read back by adopt(). In the workspace's folder.
const RUNTIME = 'runtime.json'
// How far back the first look through the agents' logs goes for what their work cost (Hub.lookBack, core/backfill.js).
const LOOK_BACK_DAYS = 30
const KEEP = ['run', 'status', 'since', 'sessionId', 'transcript', 'current', 'replyDue', 'turnStart', 'background', 'activity', 'readyAfter', 'resumed',
  'freshPending', 'freshWhy', 'freshLimit', 'freshFor', 'wrapUp', 'wrapFor', 'wrapNote', 'relaunch', 'retrying', 'apiRetries', 'cloneOf', 'clone']

const DEFAULTS = { autopilot: true, theme: 'system', hotkey: 'Alt+Shift+Space', agents: [] }
// config.json, for every workspace's hub to share.
export const openConfig = () => new Config(CONFIG, DEFAULTS)
const AGENT_KEYS = ['area', 'prompt', 'images', 'provider', 'cli', 'model', 'effort', 'tier', 'cwd', 'args', 'yolo', 'off', 'avatar', 'contextLimit', 'onContextLimit', 'clones', 'shared']
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
// How long `crew ask` holds on for the answer before the asker carries on (the answer then comes as a message).
// Under Claude Code's two minutes for a shell command, so the command ends on its own terms.
export const ASK_HOLD = 100000
// A file an agent edits is its own until its turn ends. One it hasn't touched for this long is free again, in case
// a turn's end went unreported.
const LEASE_STALE = 30 * 60000
// A turn an API error cut short: the errors that pass, which Crew answers with "continue", and how long it waits
// before each try. After the last one it calls you.
const PASSING_ERRORS = new Set(['server_error', 'overloaded', 'unknown', 'max_output_tokens'])
const API_RETRY = [20000, 60000, 180000]
// How often an open question looks at its agent's transcript, in case Claude Code settled it by itself (see watchAsk).
const ASK_CHECK = 5000
const CONTINUE = 'continue'
// An account's usage limits: crossing these (percent of a window) is said once each, in the chat and as a notification.
// At NEAR_LIMIT of its 5-hour or weekly window, routing prefers agents on other providers among equal area matches.
const LIMIT_WARN = [80, 95]
const NEAR_LIMIT = 90
// The pace forecast (paceOf): readings this recent give the 5-hour window's pace right now; the heads-up that a window
// runs out before it resets comes once it's less than a quarter of the window away (weekly: under 42 hours).
const RECENT = 20 * 60000
const PACE_WARN = 0.25
// What the chat shows for a turn that answered a message without a word (see Stop).
const NO_WORDS = 'Finished without a final message. Its terminal shows what it did.'
// Asked before a new conversation that the context limit starts (see freshWhenDone).
const WRAP_UP = "[crew] Your conversation passed its context limit, so a new one starts after this reply. If your task isn't finished, write down where it stands for your next conversation: the worktree and branch, what's done, what's left, and anything you had running. Under 80 words. If it's all finished, reply with just: done"
// A task in progress counts as stalled once the agent on it has been idle this long (stallMinutes in config.json, 0 for
// never) with no word on the task. Three times as long when it left something running in the background, which calls
// it back when it's done. Looked at once a minute.
const STALL_MINUTES = 10
const STALL_CHECK = 60000
const STOP_WORDS = new Set(
  'a an and are as at be but by can could do for from has have if in into is it me my no not of on or our please should so that the this to up us we with would you your'.split(' '),
)

// One workspace's crew (core/workspaces.js): its agents as they work there, its chat, notes and tasks. Crew runs one
// per workspace, all on the one config.json (config) and local server (token).
export class Hub extends EventEmitter {
  agents = new Map() // name -> agent; clones too (gal.2), with cloneOf: 'gal'
  pinned = new WeakSet() // messages that only one particular clone (or the original) should take
  url = null
  parked = false // started, but its agents only run once it's opened (see start)
  carryOn = new Set() // renamed while running: starts again under the new name even here parked (see renameAgent)

  // config, token, usage, samples, locks: what every workspace's hub shares (one of each of its own when it's the only
  // hub).
  constructor(runner, { bin, workspace = DEFAULT, config, token, usage, samples, locks }) {
    super()
    this.ws = workspace
    this.dir = dirOf(HOME, workspace)
    fs.mkdirSync(ATTACHMENTS, { recursive: true })
    fs.mkdirSync(this.at(GROUPS), { recursive: true })
    this.bin = bin
    this.token = token ?? randomBytes(16).toString('hex')
    this.sessions = readJSON(this.at('sessions.json')) ?? {}
    this.stats = readJSON(this.at('stats.json')) ?? {}
    this.feed = loadFeed(this.at('feed.jsonl'))
    this.asks = new Map() // feed id of an open question -> { resolve, name, cli, input }
    // Right of way (see question): what each `crew ask` is still owed, and which agent edits which file.
    this.calls = new Map() // id (the question's feed id) -> { id, msg, from, to, parent, at, hold, remote }
    // A file, or a simulator, is one thing whichever workspace's agent uses it: every workspace's hub shares these, and
    // each entry says whose workspace (ws) its holder works in (see hubOf).
    this.locks = locks ?? { files: new Map(), held: new Map(), waits: [] }
    this.leases = this.locks.files // absolute path (see fileKey) -> { name, ws, at }
    this.held = this.locks.held // a thing only one agent can use at a time (crew lease), lowercased -> { thing, name, ws, why, at }
    this.leaseWaits = this.locks.waits // `crew lease`s waiting for a thing someone else has: { key, from, ws, thing, why, resolve }
    this.runs = new Map() // launch id -> { name, file, pid, at }: each CLI process and the file of groups it started
    this.turnedAway = new Set() // "who:file" told this turn that a file is taken, so the chat says it once
    this.saving = Promise.resolve() // feed.jsonl appends, one after another (an answer must land after its card)
    this.tickets = new Tickets(this.at('tickets.json'))
    this.stalls = new Map() // task id -> { at, told }: Crew reminded its agent at `at`, or (told) called you
    // Each agent's current conversation: when it started, tasks in it, compactions, and how full it is.
    this.convos = readJSON(this.at('conversations.json')) ?? {}
    // Unread replies: up to when you've read each agent's. A first run starts from now, so old history isn't "new".
    this.reads = readJSON(this.at('reads.json')) ?? { since: Date.now(), agents: {} }
    // Each provider's usage limits, as its agents' status lines last reported them (see setUsage). Your accounts', so
    // every workspace's hub shares them.
    this.usage = usage ?? readJSON(at('usage.json')) ?? {}
    // ...and the recent readings of each window, for its pace (see sample): every workspace's agents add to the one record
    this.samples = samples ?? {}
    // What this workspace's work has cost: the last running totals of each CLI process and of each session (so nothing
    // is counted twice), and its spend per hour of each day (for "usual by now"). See countSpend.
    this.spend = { runs: {}, sessions: {}, hours: {}, ...readJSON(this.at('spend.json')) }
    this.useRunner(runner)
    this.cfg = config ?? new Config(CONFIG, DEFAULTS)
    this.onConfig = () => this.apply()
    this.onProblem = (text) => this.post({ kind: 'event', from: 'crew', text })
    this.cfg.on('change', this.onConfig)
    if (this.ws === DEFAULT) this.cfg.on('problem', this.onProblem) // said once, in the default workspace's chat
    if (!this.cfg.tried) this.cfg.load()
    if (!this.space) this.apply() // read before this hub was made, or unreadable: as it is
  }

  // The workspace is gone from config.json (apply has stopped its agents already): what's pending is saved, and this
  // hub stops listening.
  dispose() {
    this.cfg.off('change', this.onConfig)
    this.cfg.off('problem', this.onProblem)
    this.runner.dispose?.()
    clearInterval(this.stallTimer)
    if (this.statsTimer) this.saveStats()
    if (this.ticketsTimer) this.tickets.save()
    this.saveConvos(true)
    this.saveSpend(true)
    // its agents were just stopped (apply), but their CLIs end after this hub stops listening: what they left running
    // is swept once they've had a moment to go
    const runs = [...this.runs.keys()]
    if (runs.length) setTimeout(() => runs.forEach((id) => this.sweep(id)), 4000).unref?.()
    for (const t of ['statsTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(this[t])
    for (const a of this.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'steerTimer', 'retryTimer', 'reapTimer']) clearTimeout(a[t])
  }

  // A file of this workspace's, in its folder.
  at(...parts) {
    return path.join(this.dir, ...parts)
  }

  // config.json as it is (core/config.js). What's this workspace's in it is this.space.
  get config() {
    return this.cfg.data
  }

  // The terminals: in this process (core/runner.js), or in the terminal host, where they outlive Crew (core/ptyclient.js).
  useRunner(runner) {
    this.runner = runner
    runner.on('exit', (name, code, ms) => this.onExit(name, code, ms))
    runner.on('data', (name, data) => this.onOutput(name, data))
    runner.on('ended', (name, run) => this.sweep(run))
  }

  // survivors: terminals still running from before Crew restarted ([{ name, tag, pid }], from the terminal host). Their
  // agents carry on where they are instead of starting again. The rest start, unless config.json says the workspace is
  // parked: then they wait until it's opened.
  start(url, { survivors = [] } = {}) {
    this.url = url
    const park = (this.parked = this.space.parked)
    this.startedAt = Date.now()
    if (this.ws === DEFAULT) {
      // where agents' hooks and `crew` find Crew: every workspace's, told apart by the X-Crew-Workspace header
      fs.writeFileSync(at('url'), url)
      fs.writeFileSync(at('token'), this.token)
      fs.chmodSync(at('token'), 0o600)
    }
    this.keepRuntime = Boolean(this.runner.survivors)
    const adopted = this.adopt(survivors)
    this.replaySpool()
    this.sweepStale()
    if (!park) for (const a of this.agents.values()) if (!a.off && !adopted.has(a.name)) this.launch(a)
    for (const name of adopted) {
      const a = this.agents.get(name)
      if (a?.status === 'idle') this.pump(a)
      if (a?.status === 'working') this.steer(a)
    }
    this.cfg.watch()
    this.stallTimer = setInterval(() => this.checkStalls(), STALL_CHECK)
    this.stallTimer.unref?.()
    // the agents' logs don't say which workspace they worked in, and what came before workspaces is the default's
    if (this.ws === DEFAULT && !this.spend.lookedBack) {
      this.lookingBack = true
      this.lookTimer = setTimeout(() => this.lookBack(), 5000)
      this.lookTimer.unref?.()
    }
    this.cfg.discovering ??= discoverCodex().then((codex) => {
      if (!codex) return
      this.cfg.discovered.codex = codex
      this.loadConfig()
    })
  }

  // ---- config ------------------------------------------------------------

  // config.json read again: every workspace's hub applies it.
  loadConfig() {
    this.cfg.load()
  }

  // This workspace's part of config.json, put into effect: agents come, go, change, start and stop to match it.
  apply() {
    const before = new Map([...this.agents].map(([n, a]) => [n, [this.launchKey(a), a.contextLimit, a.onContextLimit]]))
    this.providers = providersFrom(this.config, this.cfg.discovered)
    this.space = space(this.config, this.ws) ?? space({ agents: [] }, DEFAULT) // no agents once it's gone from config.json
    const list = this.space.agents
    const names = new Set(list.map((c) => c.name))
    for (const [name, a] of this.agents) {
      if (a.cloneOf || names.has(name)) continue // clones follow their original, below
      this.forgetAsks(name)
      this.forgetCalls(name, 'went away before it answered')
      this.runner.stop(name)
      this.agents.delete(name)
    }
    for (const c of list) {
      let a = this.agents.get(c.name)
      if (!a) this.agents.set(c.name, (a = { status: 'off', since: Date.now(), activity: '', inbox: [], holdUntil: 0, hookAt: 0 }))
      const home = a.name && sessionHome(a)
      for (const k of AGENT_KEYS) delete a[k]
      Object.assign(a, c)
      // A session belongs to one CLI and one folder: changing either (here, in another workspace it's in, or by hand)
      // starts a fresh conversation.
      if (home && home !== sessionHome(a)) this.saveSession(a.name, null)
      // config.json decides on/off, whether it was toggled in the UI or edited by hand.
      if (a.off && a.status !== 'off') {
        this.runner.stop(a.name)
        this.setStatus(a, 'off')
      } else if (!a.off && a.status === 'off' && this.url && (!this.parked || this.carryOn.delete(a.name))) {
        this.launch(a)
        this.startWaiting(a)
      }
    }
    // Clones work with their original's settings. One whose original was removed, renamed or turned off goes too.
    for (const c of this.clones()) {
      const base = this.agents.get(c.cloneOf)
      if (!base || base.off) this.dismiss(c.name)
      else this.dress(c, base)
    }
    // New launch settings (from the UI, another workspace the agent is in too, or by hand): a running agent and its
    // clones start again with them, each resuming its conversation, as soon as they're free. And a lower context limit
    // may be passed already.
    for (const [n, [key, limit, onLimit]] of before) {
      const a = this.agents.get(n)
      if (!a) continue
      if (this.runner.running(n) && this.launchKey(a) !== key) this.relaunchWhenFree(a)
      if (a.contextLimit !== limit || a.onContextLimit !== onLimit) this.checkLimit(a)
    }
    // parked or opened in config.json, from the app or by hand
    if (this.url && this.space.parked !== this.parked) this.space.parked ? this.park() : this.unpark()
    this.changed()
  }

  // Opened: its agents that are on start, each picking up its conversation.
  unpark() {
    if (!this.parked) return
    this.parked = false
    const starting = [...this.agents.values()].filter((a) => !a.off && !a.cloneOf && !this.runner.running(a.name))
    for (const a of starting) {
      this.launch(a)
      this.startWaiting(a)
    }
    if (starting.length) this.post({ kind: 'event', from: 'crew', text: `opened: ${starting.map((a) => `@${a.name}`).join(', ')} pick${starting.length === 1 ? 's' : ''} up where ${starting.length === 1 ? 'it' : 'they'} left off` })
    this.changed()
  }

  // Parked: its agents stop, and their conversations wait for it to open again. Clones go home first, so what they had
  // queued waits with their original.
  park() {
    const running = [...this.agents.values()].filter((a) => !a.cloneOf && (a.status !== 'off' || this.runner.running(a.name)))
    if (this.parked && !running.some((a) => this.runner.running(a.name))) return
    this.parked = true
    // the agents first, so what their clones had queued waits with them instead of being typed into a terminal that's
    // about to stop
    const stopping = running
    for (const a of stopping) {
      this.forgetAsks(a.name)
      this.forgetCalls(a.name, 'its workspace was parked before it answered')
      // what it leaves running is stopped as always, without a line each: parking stops everything on purpose
      const run = this.runs.get(a.run)
      if (run) run.quiet = true
      this.runner.stop(a.name)
      this.setStatus(a, 'off')
    }
    for (const c of this.clones()) {
      const run = this.runs.get(c.run)
      if (run) run.quiet = true
      this.dismiss(c.name)
    }
    if (stopping.length) this.post({ kind: 'event', from: 'crew', text: `parked: ${stopping.map((a) => `@${a.name}`).join(', ')} stopped, and their conversations wait for the workspace to open again` })
    this.changed()
  }

  // How this workspace is doing, for the switcher: its agents, who's at work or waiting on you, the replies you haven't
  // read (as its chat counts them), and a few faces.
  // An agent counts as working while it or any of its clones does; each one waiting on you counts.
  summary() {
    const agents = this.ordered().filter((a) => !a.cloneOf)
    const live = agents.filter((a) => !a.off && (!this.parked || this.runner.running(a.name)))
    const read = (from) => Math.max(this.reads.since ?? 0, this.reads.agents?.[from] ?? 0)
    return {
      agents: agents.length,
      on: agents.filter((a) => !a.off).length,
      working: live.filter((a) => [a, ...this.clonesOf(a)].some((x) => x.status === 'working')).length,
      waiting: live.flatMap((a) => [a, ...this.clonesOf(a)]).filter((x) => x.status === 'waiting').length,
      unread: this.feed.slice(-200).filter((e) => e.kind === 'reply' && e.from !== 'you' && e.ts > read(e.from)).length,
      faces: agents.filter((a) => !a.off).slice(0, 4).map((a) => ({ name: a.name, avatar: a.avatar, status: this.parked ? 'parked' : a.status })),
      // who's waiting on you there, so another workspace can say so
      needs: live.flatMap((a) => [a, ...this.clonesOf(a)]).filter((x) => x.status === 'waiting').slice(0, 4).map((x) => ({ name: x.name, avatar: x.avatar ?? (x.cloneOf && this.agents.get(x.cloneOf)?.avatar), activity: x.activity })),
    }
  }

  saveConfig() {
    this.cfg.save()
  }

  // The hubs of the other workspaces, for what's kept about a shared agent in each (Crew sets this).
  others() {
    return []
  }

  // shared: in a workspace other than the default, whether the new agent is one of your shared ones (it's in this
  // workspace and the default) or this workspace's own. In the default workspace every agent is shared.
  addAgent({ name, shared, ...fields }) {
    const own = this.ws !== DEFAULT && !shared
    name = this.freeName(name, own ? undefined : (n) => this.agents.has(n) || sharedNames(this.config, n).has(n))
    const def = JSON.parse(JSON.stringify({ name, ...clean(fields) }))
    if (own || this.ws === DEFAULT) this.space.add(def, { shared: !own })
    else {
      // Where it works here, and whether it's on, are this workspace's. In the default workspace it starts off, until
      // it's turned on there.
      const { cwd, off, ...who } = def
      this.space.add({ ...who, off: true }, { shared: true, member: { ...(cwd && { folder: cwd }), ...(off && { off }) } })
    }
    this.saveConfig()
    return name
  }

  freeName(raw, taken = (n) => this.agents.has(n)) {
    const name = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!name || RESERVED.has(name)) throw new Error('pick another name')
    if (taken(name)) throw new Error(`"${name}" already exists`)
    return name
  }

  // An agent out of this workspace. Its own, or a shared one in the default workspace, is gone for good, and so is what
  // every workspace kept about it. A shared one leaving any other workspace is still yours, and still in the others.
  // everywhere: a shared agent off the roster even from another workspace (a move that didn't go through, core/move.js).
  removeAgent(name, { everywhere = this.ws === DEFAULT } = {}) {
    if (everywhere) forget(this.config, name)
    else this.space.remove(name)
    for (const h of everywhere ? [this, ...this.others()] : [this]) h.forgetAgent(name)
    this.saveConfig()
  }

  // What this workspace kept about an agent that's gone: its conversation and experience here.
  forgetAgent(name) {
    this.saveSession(name, null)
    delete this.stats[name]
    this.saveStats()
  }

  // The one edit path: a patch for one agent or many at once (bulk edit in the collection).
  // `off` is saved, so it survives restarts. Launch settings restart a running agent, resuming its
  // session, as soon as it's free (see apply).
  update(names, patch) {
    names = [].concat(names)
    if (names.length === 1 && patch.name !== undefined && patch.name !== names[0]) names = [this.rename(names[0], patch.name)]
    const { name, ...fields } = clean(patch)
    for (const n of names) {
      if (!this.space.has(n)) continue
      for (const [k, v] of Object.entries(fields)) this.space.set(n, k, v)
      if ('provider' in fields) this.space.set(n, 'cli', undefined)
    }
    this.saveConfig()
  }

  // A shared agent's new name is its name in every workspace; one of a workspace's own is renamed there.
  rename(from, to) {
    if (!this.space.has(from)) throw new Error(`no agent named "${from}"`)
    const shared = this.space.shared(from)
    to = this.freeName(to, shared ? (n) => this.agents.has(n) || sharedNames(this.config, from).has(n) : undefined)
    if (shared) renameShared(this.config, from, to)
    else {
      this.space.def(from).name = to
      if (this.space.triage === from) this.space.triage = to
    }
    for (const h of shared ? [this, ...this.others()] : [this]) h.renameAgent(from, to)
    this.saveConfig() // stops `from`, starts `to` resuming the same conversation
    return to
  }

  // What this workspace keeps about an agent, under its new name: its conversation, experience, the conversation's
  // numbers, and the tasks it owns or is working on.
  renameAgent(from, to) {
    if (this.runner.running(from)) this.carryOn.add(to)
    if (this.sessions[from]) this.sessions[to] = this.sessions[from]
    this.saveSession(from, null) // also writes the moved session
    if (this.stats[from]) [this.stats[to], this.stats[from]] = [this.stats[from], undefined]
    this.saveStats()
    if (this.convos[from]) [this.convos[to], this.convos[from]] = [this.convos[from], undefined]
    this.saveConvos()
    for (const t of this.tickets.all) for (const k of ['owner', 'fixer']) if (t[k] === from) t[k] = to
    this.tickets.save()
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
        fs.writeFileSync(this.at('reads.json'), JSON.stringify(this.reads))
      } catch {}
    }, 500)
  }

  setTheme(theme) {
    this.config.theme = ['light', 'dark'].includes(theme) ? theme : 'system'
    this.saveConfig()
  }

  setAutopilot(on) {
    this.space.autopilot = on
    this.saveConfig()
  }

  // ---- lifecycle ---------------------------------------------------------

  launch(a, fresh = false) {
    this.forgetAsks(a.name)
    if (a.serving?.length) this.settleCalls(a, null, 'restarted before it answered')
    this.release(a.name)
    this.letGo(a.name)
    a.relaunch = false
    clearTimeout(a.retryTimer)
    a.retrying = false
    a.subs = new Map() // sub-agents don't outlive their process
    a.background = 0 // nor does anything else it ran
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
    const session = randomUUID()
    const { file, args, readyAfter, trust, env: extraEnv } = adapter(a, { resume, session, attachments: ATTACHMENTS })
    a.sessionId = resume ?? session // the conversation this process runs (see onStatusLine)
    Object.assign(a, { readyAfter, trust, trustAsk: false, boot: '' }) // see onOutput
    a.resumed = Boolean(resume)
    if (!resume) this.newConvo(a)
    try {
      const cwd = expand(a.cwd)
      if (!fs.existsSync(cwd)) throw new Error(`folder not found: ${cwd}`)
      const run = randomUUID().slice(0, 8)
      const groups = this.at(GROUPS, `${a.name}.${run}`)
      const env = {
        ...expandEnv(provider.env), ...extraEnv, PATH: `${this.bin}:${process.env.PATH}`, CREW_AGENT: a.name, CREW_URL: this.url, CREW_TOKEN: this.token, CREW_HOME: HOME,
        CREW_GROUPS: groups, ...(provider.cli === 'claude' && shellPrefix(this.bin)),
        // which workspace its hooks and `crew` talk to: empty for the default (as for agents started before workspaces),
        // whatever Crew itself was started with
        CREW_WORKSPACE: this.ws === DEFAULT ? '' : this.ws,
      }
      this.runner.start(a.name, { file, args: [...args, ...(provider.args ?? []), ...(a.args ?? [])], cwd, env, tag: run })
      // its own group first: what the CLI starts without a group of its own lands there
      const pid = this.runner.pid?.(a.name)
      if (pid) fs.writeFileSync(groups, `${pid} ${Math.floor(Date.now() / 1000)}\n`)
      this.runs.set(run, { name: a.name, file: groups, pid, at: 0 })
      a.run = run
      a.launchedAt = Date.now()
      this.setStatus(a, 'starting')
      this.readyIn(a)
    } catch (e) {
      this.setStatus(a, 'stopped')
      this.post({ kind: 'event', from: a.name, text: `failed to start: ${e.message}` })
    }
  }

  // A CLI that doesn't say when it's up (Codex) counts as ready this long after it starts.
  readyIn(a) {
    clearTimeout(a.readyTimer)
    if (a.readyAfter) a.readyTimer = setTimeout(() => a.status === 'starting' && this.setStatus(a, 'idle'), a.readyAfter)
  }

  // The first time a CLI runs in a folder it asks whether you trust it, YOLO or not, and nothing typed reaches its
  // prompt until that's answered: Codex would take the Enter after the first message as "Trust and continue" and lose
  // the message, and Claude Code doesn't even say it started. So until it's up and has taken its first prompt, Crew
  // watches its screen for that question and hands it to you. Messages wait in its queue meanwhile.
  onOutput(name, data) {
    const a = this.agents.get(name)
    if (!a?.trust || a.trustAsk) return
    a.boot = (a.boot + data).slice(-6000)
    if (!a.trust.test(flat(a.boot))) return
    clearTimeout(a.readyTimer)
    Object.assign(a, { trustAsk: true, boot: '' })
    this.needsYou(a, `asks whether to trust its folder, ${a.cwd}. Answer in its terminal: messages wait until then`)
  }

  restart(name, fresh = false) {
    const a = this.agents.get(name)
    if (a && this.parked && !this.runner.running(name)) throw new Error(`${this.space.name} is parked: open it to start its agents`)
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
    if (a.cloneOf || !this.maxClones(a) || !this.runner.running(a.name) || this.pinned.has(msg)) return a
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
    return this.feed.some((e) => e.held && e.from === c.name) || [...this.calls.values()].some((call) => call.from === c.name) ||
      [...this.agents.values()].some((x) => x.inbox.some((m) => m.from === c.name) || ((x.status === 'working' || x.status === 'waiting') && from(x.current) === c.name))
  }

  // A clone goes away: its terminal stops and its conversation ends with it. Anything still queued for it goes
  // back to its original's queue.
  dismiss(name) {
    const c = this.agents.get(name)
    if (!c?.cloneOf) throw new Error(`@${name} isn't a clone`)
    for (const t of ['reapTimer', 'timer', 'ack', 'readyTimer', 'steerTimer']) clearTimeout(c[t])
    this.forgetAsks(name)
    this.runner.stop(name)
    this.setStatus(c, 'off')
    this.agents.delete(name)
    delete this.sessions[name]
    delete this.convos[name]
    // a question it was answering, or had put aside while it asked a teammate, won't get its answer from it
    for (const call of [...this.calls.values()]) if (this.ownerOf(call) === name && !c.inbox.includes(call.msg)) this.respond(call, { by: name, why: 'went away before it answered' })
    const base = this.agents.get(c.cloneOf)
    if (base && c.inbox.length) {
      for (const msg of c.inbox) {
        this.amend(msg, { to: base.name })
        const call = msg.ask && base.off && this.calls.get(msg.id)
        if (call) this.respond(call, { by: base.name, why: "was turned off, so it can't answer" })
        else this.queue(base, msg)
      }
      this.pump(base)
      this.steer(base)
      for (const x of this.clonesOf(base)) this.pump(x)
    }
    this.changed()
  }

  // How an agent looks to routing: free when it, a clone of it, or a clone it could start can take work now.
  lineup(a) {
    const family = [a, ...this.clonesOf(a)]
    const room = family.some((x) => x.status === 'idle' && !x.inbox.length) || (this.maxClones(a) > family.length - 1 && this.runner.running(a.name))
    return { name: a.name, area: a.area, status: room ? 'idle' : a.status, queue: room ? 0 : family.reduce((n, x) => n + x.inbox.length, 0), nearLimit: this.nearLimit(this.providerOf(a)?.id) }
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
    // parked: the next time it starts, it starts fresh
    if (this.parked && !this.runner.running(name)) {
      this.saveSession(name, null)
      this.newConvo(a)
      return this.changed()
    }
    this.startFresh(a)
  }

  startFresh(a, why = a.freshWhy ?? '') {
    const note = String(a.wrapNote ?? '').trim()
    const carry = note && !/^\W*done\W*$/i.test(note) ? { text: note, for: a.wrapFor } : null
    Object.assign(a, { freshPending: false, freshWhy: undefined, freshLimit: false, wrapUp: false, wrapNote: undefined, wrapFor: undefined, toldBackground: false })
    if (a.inbox[0]?.fresh) a.freshFor = a.inbox[0].id // this new conversation is the one that task waits for
    this.post({ kind: 'event', from: a.name, text: `started a new conversation${why}${carry ? `, and picks up where it left off: ${gist(carry.text, 160)}` : ''}`, fresh: true })
    this.launch(a, true)
    // where it left off, in its own words: the first thing in the new conversation, threaded to the task it was on
    if (carry) a.inbox.unshift(crewPrompt(a, `[crew] Your last conversation passed its context limit, so this is a new one. You hadn't finished. Where you left off, in your own words:\n\n${carry.text}\n\nCheck where things stand, then carry on.`, carry.for))
  }

  // A new conversation once the agent is free. One you asked for starts right away. One for its context limit
  // can't take the end of a turn on trust: a turn also ends while the agent waits on what it started in the
  // background (a build, a server, a sub-agent), and a restart then drops the task half-way. So Crew waits for those
  // (or for its next task), asks the agent where things stand, and the new conversation starts from its answer.
  freshWhenDone(a) {
    if (!a.freshLimit || a.wrapNote !== undefined) return this.startFresh(a)
    if (a.wrapUp && a.inbox.some((m) => m.wrapUp)) return this.pump(a) // asked, not taken up yet: it's next in its queue
    if (a.wrapUp) return this.startFresh(a) // asked, and its turn ended without an answer (you stopped it)
    if (a.background && !a.inbox.length) {
      if (!a.toldBackground) {
        a.toldBackground = true
        this.post({ kind: 'event', from: a.name, text: `waits for ${a.background === 1 ? 'the task' : `the ${a.background} tasks`} it left running in the background, then starts a new conversation` })
      }
      return this.changed()
    }
    this.askWrapUp(a)
  }

  askWrapUp(a) {
    a.wrapUp = true
    a.wrapFor = a.current
    a.inbox.unshift({ ...crewPrompt(a, WRAP_UP), wrapUp: true })
    this.pump(a)
    this.changed()
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
        fs.writeFileSync(this.at('conversations.json'), JSON.stringify(this.lasting(this.convos)))
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
    a.freshPending = true
    a.freshWhy = ` (it passed its ${tokenCount(limit)} context limit)`
    a.freshLimit = true
    if (a.status === 'idle') return this.freshWhenDone(a)
    this.post({ kind: 'event', from: a.name, text: `${passed}, so it starts a new conversation when it finishes this task` })
    this.changed()
  }

  // Claude Code's status line: remember how full the context is, and answer with the line it shows.
  onStatusLine(name, s) {
    const a = this.agents.get(name)
    if (!a) return ''
    // A report from another conversation: the process a new conversation just replaced, still drawing its status line
    // on its way out. Taken as the new conversation's, it would count the old one's tokens against the new one's limit.
    if (s?.session_id && a.sessionId && s.session_id !== a.sessionId) return ''
    const context = fromStatusLine(s)
    // Before the first message of a resumed session there's no usage yet: keep what we knew.
    if (context && (s.context_window.current_usage || !this.convoOf(a).context)) this.setContext(a, context)
    const id = this.providerOf(a)?.id ?? 'claude'
    const limits = limitsFrom(s)
    if (limits) this.setUsage(id, limits)
    this.countSpend(a, s?.session_id, spentFrom(s))
    const c = this.convoOf(a)
    if (!c.context) return ''
    const { pct, used, size, limit } = againstLimit(c.context, a.contextLimit)
    const color = (p) => (p >= 85 ? '31' : p >= 60 ? '33' : '2')
    const five = this.liveUsage(id).find((w) => w.id === 'five_hour')
    return `\x1b[${color(pct)}mcontext ${pct}% · ${tokenCount(used)} of ${tokenCount(size)}${limit ? ' limit' : ''}\x1b[0m\x1b[2m · ${c.tasks} task${c.tasks === 1 ? '' : 's'} in this conversation\x1b[0m${
      five ? `\x1b[2m · \x1b[0m\x1b[${color(five.pct)}m5h limit ${five.pct}%\x1b[0m` : ''}`
  }

  // ---- usage limits: how much of its account's 5-hour and weekly windows a provider has used ---------------
  // Agents on one provider share its account, so the newest reading from any of them is the account's: Claude Code's
  // status line, or Codex's session log (readCodexContext). A window that has reset is gone until the next reading.
  // credits: what Codex says is left on the account ({ balance, unlimited }), shown with its windows.
  // The account is yours, not a workspace's: whichever workspace's agent reports it, it's said once, where you are
  // (aboutAccount), and its notification belongs to no workspace.

  // A line in the chat about your accounts. Crew puts it in the workspace on screen; on its own, a hub keeps it.
  aboutAccount(entry) {
    this.post(entry)
  }

  setUsage(id, windows, credits) {
    const before = JSON.stringify([this.liveUsage(id), this.usage[id]?.credits])
    const u = (this.usage[id] ??= { told: {} })
    Object.assign(u, { at: Date.now(), windows, credits: credits ?? undefined })
    for (const w of windows) {
      this.sample(id, w)
      this.warnUsage(id, u, w)
      this.warnPace(id, u, w)
    }
    this.saveUsage()
    if (JSON.stringify([this.liveUsage(id), u.credits]) !== before) this.changed()
  }

  liveUsage(id) {
    const now = Date.now()
    return (this.usage[id]?.windows ?? []).filter((w) => w.resetsAt > now)
  }

  // Close to running out: new work goes to agents elsewhere when they're as good a match (see bestFor).
  nearLimit(id) {
    return this.liveUsage(id).some((w) => (w.id === 'five_hour' || w.id === 'seven_day') && w.pct >= NEAR_LIMIT)
  }

  // Crossing 80%, then 95%, of a window: one line in the chat and a notification each, once per window. Said once
  // already survives a restart (usage.json); a new window (another reset time) starts over.
  warnUsage(id, u, w) {
    u.told ??= {}
    if (u.told[w.id] && Math.abs(u.told[w.id].resetsAt - w.resetsAt) > 60000) delete u.told[w.id]
    const level = LIMIT_WARN.findLast((l) => w.pct >= l)
    if (!level || (u.told[w.id]?.level ?? 0) >= level) return
    u.told[w.id] = { level, resetsAt: w.resetsAt }
    const what = `${this.providers[id]?.label ?? id} is at ${w.pct}% of its ${limitName(w)}`
    const when = resetsWhen(w.resetsAt)
    this.aboutAccount({ kind: 'event', from: 'crew', text: `${what}, resets ${when}`, ...(level >= 95 && { alert: true }) })
    this.emit('notice', { title: what, body: `It resets ${when}.${level >= NEAR_LIMIT ? ' Until then, new work goes to agents on other providers when they cover the same area.' : ''}`, focus: '', account: true })
  }

  // Readings of a window over the last RECENT minutes, for its pace right now. A drop or a new reset time is a new window.
  sample(id, w) {
    const list = (this.samples[id] ??= {})[w.id] ?? []
    const last = list.at(-1)
    const now = Date.now()
    const keep = last && last[1] <= w.pct && last[2] === w.resetsAt ? list.filter(([t]) => now - t <= RECENT) : []
    this.samples[id][w.id] = [...keep, [now, w.pct, w.resetsAt]]
  }

  pace(id, w) {
    return paceOf(w, this.samples[id]?.[w.id])
  }

  // At this pace a window runs out before it resets: one line in the chat and a notification, once per window, when it's
  // close enough to plan around (PACE_WARN of the window away).
  warnPace(id, u, w) {
    const p = this.pace(id, w)
    const key = `pace:${w.id}`
    const length = windowMs(w)
    if (!p?.runsOut || u.told[key]?.resetsAt === w.resetsAt || p.runsOut - Date.now() > length * PACE_WARN) return
    u.told[key] = { resetsAt: w.resetsAt }
    const what = `At this pace, ${this.providers[id]?.label ?? id}'s ${limitName(w)} runs out ${resetsWhen(p.runsOut)}`
    this.aboutAccount({ kind: 'event', from: 'crew', text: `${what}, before it resets ${resetsWhen(w.resetsAt)}`, alert: true })
    this.emit('notice', { title: what, body: `It resets ${resetsWhen(w.resetsAt)}.`, focus: '', account: true })
  }

  // Debounced like the context gauges; `now` on quit.
  saveUsage(now = false) {
    clearTimeout(this.usageTimer)
    const write = () => {
      const t = Date.now()
      for (const u of Object.values(this.usage)) for (const [k, told] of Object.entries(u.told ?? {})) if (told.resetsAt <= t) delete u.told[k]
      try {
        fs.writeFileSync(at('usage.json'), JSON.stringify(this.usage))
      } catch {}
    }
    if (now) return write()
    this.usageTimer = setTimeout(write, 1000)
    this.usageTimer.unref?.()
  }

  // ---- spend: what each agent's work costs ------------------------------------------------------------------
  // Claude Code tells its status line what it has cost so far (priced as /cost prices it), the lines it changed and its
  // time on the API; Codex's log has the tokens it has used. Those are running totals: what grew since the last report
  // goes to the agent (a clone's to its original), the task its conversation is on, and the hour. Totals are kept per
  // CLI process (its launch), where they only grow or start over from zero. A process's first report is measured against
  // what its session last said (a resumed session can pick its total up again), and a resumed session Crew has never
  // seen only counts from here on. So nothing is counted twice.

  countSpend(a, session, now) {
    if (!now || !(a.run || session)) return
    const run = a.run ?? session
    const less = (x, y) => Object.keys(x).some((k) => x[k] < (y[k] ?? 0))
    const minus = (x, y) => Object.fromEntries(Object.keys(x).map((k) => [k, x[k] - (y[k] ?? 0)]))
    const seen = this.spend.runs[run]
    const before = !seen && session ? this.spend.sessions[session] : null
    // a session already under way when Crew started counts from here on while the look back covers what came before
    const unseen = a.resumed || (this.lookingBack && !(a.launchedAt >= this.startedAt)) ? null : now
    // a session the look back counted (baseline) counts from its next report on
    const sinceBefore = before && (before.baseline ? null : less(now, before) ? now : minus(now, before))
    const grew = seen ? (less(now, seen) ? now : minus(now, seen)) : before ? sinceBefore : unseen
    const stamp = { ...now, at: Date.now() }
    this.spend.runs[run] = stamp
    if (session) this.spend.sessions[session] = stamp
    this.saveSpend()
    if (grew && Object.values(grew).some((v) => v > 0)) this.addSpend(a, grew)
  }

  addSpend(a, { cost = 0, added = 0, removed = 0, apiMs = 0, tokens = 0 }) {
    const counts = Object.fromEntries(Object.entries({ cost, linesAdded: added, linesRemoved: removed, apiMs, tokens }).filter(([, v]) => v > 0))
    this.record(a.name, counts)
    if (cost) (this.spend.hours[localDay()] ??= Array(24).fill(0))[new Date().getHours()] += cost
    // the task its conversation is about (one that lives on this computer)
    const id = this.convos[a.name]?.ticket
    const t = typeof id === 'number' && this.tickets.all.find((x) => x.id === id)
    if (t) {
      t.spent = { cost: (t.spent?.cost ?? 0) + cost, tokens: (t.spent?.tokens ?? 0) + tokens, added: (t.spent?.added ?? 0) + added, removed: (t.spent?.removed ?? 0) + removed }
      clearTimeout(this.ticketsTimer)
      this.ticketsTimer = setTimeout(() => this.tickets.save(), 5000)
      this.ticketsTimer.unref?.()
    }
    this.changed()
  }

  // Debounced like the context gauges; `now` on quit. Sessions not heard from in 60 days and days older than that go.
  saveSpend(now = false) {
    clearTimeout(this.spendTimer)
    const write = () => {
      const cutoff = Date.now() - 60 * 864e5
      for (const k of ['runs', 'sessions']) for (const [id, s] of Object.entries(this.spend[k])) if (!(s.at > cutoff)) delete this.spend[k][id]
      for (const d of Object.keys(this.spend.hours)) if (d < localDay(cutoff)) delete this.spend.hours[d]
      try {
        fs.writeFileSync(this.at('spend.json'), JSON.stringify(this.spend))
      } catch {}
    }
    if (now) return write()
    this.spendTimer = setTimeout(write, 2000)
    this.spendTimer.unref?.()
  }

  // The first time Crew counts spend, it looks back through the agents' logs for the last LOOK_BACK_DAYS (core/backfill.js,
  // in a worker thread), up to when it started counting: when this Crew started, or the first hour live counting ever
  // saw. Sessions it counted are a baseline from then on, so the live count only adds what comes after.
  lookBack() {
    const counted = Object.entries(this.spend.hours).filter(([, h]) => h.some((v) => v > 0)).map(([d, h]) => new Date(`${d}T${String(h.findIndex((v) => v > 0)).padStart(2, '0')}:00`).getTime())
    const until = Math.min(this.startedAt ?? Date.now(), ...counted)
    const claude = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
    const codex = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')
    const names = this.space.agents.map((c) => c.name)
    const worker = new Worker(new URL('./backfill.js', import.meta.url), { workerData: { lookBack: { claude: [claude], codex, names, since: until - LOOK_BACK_DAYS * 864e5, until } } })
    worker.unref()
    worker.once('message', (r) => {
      worker.terminate()
      if (r.error) return void (this.lookingBack = false)
      this.mergeLookBack(r, until)
    })
    worker.once('error', () => (this.lookingBack = false))
  }

  // What the look back found, added to each agent's days, the crew's hours and the tasks. -> { cost, tokens }
  mergeLookBack({ agents, hours, tickets, sessions }, until) {
    let cost = 0
    let tokens = 0
    for (const [name, days] of Object.entries(agents)) {
      if (!this.agents.has(name)) continue
      const s = (this.stats[name] ??= { first: Date.now(), days: {} })
      for (const [d, v] of Object.entries(days)) {
        const day = (s.days[d] ??= {})
        if (v.cost) (day.cost = (day.cost ?? 0) + v.cost), (s.cost = (s.cost ?? 0) + v.cost), (cost += v.cost)
        if (v.tokens) (day.tokens = (day.tokens ?? 0) + v.tokens), (s.tokens = (s.tokens ?? 0) + v.tokens), (tokens += v.tokens)
      }
    }
    for (const [d, h] of Object.entries(hours)) {
      const mine = (this.spend.hours[d] ??= Array(24).fill(0))
      h.forEach((v, i) => (mine[i] += v))
    }
    for (const [id, v] of Object.entries(tickets)) {
      const t = this.tickets.all.find((x) => x.id === Number(id))
      if (t) t.spent = { cost: (t.spent?.cost ?? 0) + v.cost, tokens: (t.spent?.tokens ?? 0) + v.tokens, added: t.spent?.added ?? 0, removed: t.spent?.removed ?? 0 }
    }
    for (const id of sessions) this.spend.sessions[id] ??= { baseline: true, at: Date.now() }
    this.spend.lookedBack = { at: Date.now(), until, cost, tokens }
    this.lookingBack = false
    this.saveStats()
    this.saveSpend(true)
    this.tickets.save()
    if (cost >= 0.005 || tokens) {
      const what = [cost >= 0.005 && `$${cost < 10 ? cost.toFixed(2) : Math.round(cost).toLocaleString('en-US')} at API prices`, tokens && `${tokenCount(tokens)} Codex tokens`].filter(Boolean).join(' and ')
      this.post({ kind: 'event', from: 'crew', text: `added up what the crew's work cost before Crew counted it: ${what} over the last ${LOOK_BACK_DAYS} days` })
    }
    this.changed()
    return { cost, tokens }
  }

  // The crew's spend for the dashboard: today, and what it usually is by this time of day (on the days the crew spent
  // anything, over the last four weeks); the last 7 and 30 days, and the 7 before.
  spendNow() {
    const day = (n) => localDay(Date.now() - n * 864e5)
    const on = (d) => Object.values(this.stats).reduce((sum, s) => sum + (s?.days?.[d]?.cost ?? 0), 0)
    const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => on(day(from + i))).reduce((x, y) => x + y, 0)
    const now = new Date()
    const byNow = (h) => h.slice(0, now.getHours()).reduce((x, y) => x + y, 0) + h[now.getHours()] * (now.getMinutes() / 60)
    const past = Object.entries(this.spend.hours).filter(([d, h]) => d < day(0) && d >= day(28) && h.some((v) => v > 0)).map(([, h]) => byNow(h))
    return { today: on(day(0)), usual: past.length >= 3 ? past.reduce((x, y) => x + y, 0) / past.length : null, week: days(0, 6), weekBefore: days(7, 13), month: days(0, 29) }
  }

  // Codex writes its token counts to its session log, and its account's usage limits with them; read the newest after
  // each step.
  readCodexContext(a, e) {
    if (this.providerOf(a)?.cli !== 'codex') return
    const now = Date.now()
    if (e.hook_event_name === 'PostToolUse' && now - (a.contextAt ?? 0) < 5000) return
    a.contextAt = now
    const file = e.transcript_path || codexLog(e.session_id ?? this.sessions[a.name])
    const context = file && fromCodexLog(file)
    if (context) this.setContext(a, context)
    const limits = file && codexLimitsFrom(file)
    if (limits) this.setUsage(this.providerOf(a).id, limits.windows, limits.credits)
    if (file) this.countSpend(a, e.session_id ?? this.sessions[a.name], codexSpent(file))
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

  // ---- what an agent leaves running ---------------------------------------------------------------------
  // Each launch writes down its process groups (core/procs.js): bin/crew-sh adds every command Claude Code runs, and
  // noteGroups what turns up in the CLI's process tree. When the CLI ends (it exits, is turned off, or restarts for a new
  // conversation), whatever is still in those groups is stopped: the dev server it started with &, the simulator helpers.

  // Groups bin/crew-sh doesn't see: what the CLI starts itself, and every command of a CLI without a shell prefix (Codex).
  noteGroups(a) {
    const run = this.runs.get(a.run)
    if (run && !run.pid) run.pid = this.runner.pid?.(a.name) // the terminal host says it a moment after the start
    if (!run?.pid || Date.now() - run.at < TREE_CHECK) return
    run.at = Date.now()
    // listing them is slow on Windows: every agent's look shares one list for a while
    processes({ maxAge: TREE_CHECK / 2 }).then((procs) => {
      const lines = noteworthy(procs, run.pid, readGroups(run.file))
      if (lines) fs.appendFile(run.file, lines, () => {})
    })
  }

  // A CLI is gone: what's left in its groups is stopped, with one line in the chat saying what. Crew itself, and what
  // other agents run, are never touched (Crew started from an agent's terminal sits in one of its groups).
  async sweep(id) {
    const run = this.runs.get(id)
    if (!run) return
    this.runs.delete(id)
    const groups = readGroups(run.file)
    const spans = readSpans(run.file)
    fs.rm(run.file, { force: true }, () => {})
    if (!groups.size) return
    // the CLI was there until a moment ago (Windows: what it started meanwhile is still its own)
    if (run.pid) for (const span of spans.get(run.pid) ?? []) span[1] = Math.max(span[1], Date.now() / 1000)
    const procs = await processes()
    const keep = new Set(tree(procs, process.pid).map((p) => p.pid))
    for (const r of this.runs.values()) if (r.pid) for (const p of tree(procs, r.pid)) keep.add(p.pid)
    for (const g of exempt(procs, process.pid)) groups.delete(g), spans.delete(g)
    const left = leftovers(procs, groups, keep, spans)
    if (!left.length) return
    stopProcesses(left)
    const n = left.length
    if (!run.quiet) this.post({ kind: 'event', from: run.name, text: `left ${n === 1 ? 'a process' : `${n} processes`} running (${summary(left)}), so Crew stopped ${n === 1 ? 'it' : 'them'}` })
  }

  // Launches that ended while Crew wasn't there to see it (it quit, or crashed): swept now.
  sweepStale() {
    let files = []
    try {
      files = fs.readdirSync(this.at(GROUPS))
    } catch {}
    for (const f of files) {
      const m = f.match(/^(.+)\.([0-9a-f]{8})$/)
      if (!m || this.runs.has(m[2])) continue
      this.runs.set(m[2], { name: m[1], file: this.at(GROUPS, f), at: 0 })
      this.sweep(m[2])
    }
  }

  saveSession(name, id) {
    if (id) this.sessions[name] = id
    else delete this.sessions[name]
    if (this.agents.get(name)?.cloneOf) return // a clone's conversation goes away with it
    fs.writeFileSync(this.at('sessions.json'), JSON.stringify(this.lasting(this.sessions), null, 2) + '\n')
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
    this.noteGroups(a)
    if (e.hook_event_name === 'SessionStart' || e.hook_event_name === 'UserPromptSubmit') Object.assign(a, { trust: null, boot: '' }) // past any trust question
    // where its CLI keeps this conversation, so a move to another computer can take it along (core/move.js)
    if (e.transcript_path && e.session_id && !e.agent_id) a.transcript = { id: e.session_id, path: String(e.transcript_path) }
    if (e.hook_event_name === 'SessionStart' && e.session_id && !e.agent_id) a.sessionId = e.session_id // /clear starts another
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
      case 'UserPromptSubmit': {
        // a "continue" Crew owes it after an API error: this prompt (Crew's, or anything you typed) takes its place
        clearTimeout(a.retryTimer)
        a.retrying = false
        const again = Boolean(a.expect?.again) && samePrompt(e.prompt, a.expect.text)
        // Remembered only once it has a prompt: Claude Code doesn't save empty sessions, so they can't be resumed.
        if (e.session_id && this.sessions[name] !== e.session_id) this.saveSession(name, e.session_id)
        // Claude Code's own prompt: something the agent left running in the background finished. It's not a message
        // from you, nor a new task. It comes in mid-turn, or starts a turn of its own once the last one is over; either
        // way the agent is still on what it was answering, and its reply threads there.
        if (isNotice(e.prompt)) {
          if (a.status !== 'working') (a.activity = ''), (a.turnStart = Date.now())
          return this.setStatus(a, 'working')
        }
        // A question or an answer Crew typed into the turn it's in (steer): it's part of this turn now. (A turn that
        // ended before it got there starts with it instead, as any other turn does.)
        if (a.steering && samePrompt(e.prompt, a.steering.text)) {
          const { msgs } = a.steering
          clearTimeout(a.steerTimer)
          a.steering = null
          if (a.status === 'working') {
            a.serving = [...(a.serving ?? []), ...msgs]
            this.changed()
            return this.steer(a)
          }
          a.expect = { id: msgs[0].id, text: e.prompt, msgs }
        }
        clearTimeout(a.ack)
        a.activity = ''
        // Remember what the agent is answering, so its reply (and any hand-off it makes) can point back to it.
        // A prompt typed straight into its terminal joins the feed too, so replies to it have something to point at.
        if (a.expect && samePrompt(e.prompt, a.expect.text)) {
          a.current = a.expect.id
          a.serving = a.expect.msgs // what this turn answers (several, when hand-offs came in together)
          a.expect = null
        } else if (e.prompt && !e.prompt.startsWith('/')) a.current = this.post({ kind: 'msg', from: 'you', to: name, text: e.prompt.slice(0, 4000), via: 'terminal' }).id
        a.replyDue = Boolean(e.prompt && !e.prompt.startsWith('/')) // a message, not a /command
        if (!again) {
          this.record(name, { tasks: 1 })
          if (!e.prompt?.startsWith('/')) (this.convoOf(a).tasks += 1), this.saveConvos()
        }
        a.turnStart = Date.now()
        this.readCodexContext(a, e)
        return this.setStatus(a, 'working')
      }
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
        if (e.notification_type === 'permission_prompt' || this.asking(name) || a.retrying) return
        if (a.status === 'working') this.needsYou(a, e.message || 'needs your input')
        return
      case 'Interrupt':
        clearTimeout(a.retryTimer)
        a.retrying = false
        a.replyDue = false
        a.activity = ''
        a.turnStart = null
        return this.setStatus(a, 'idle')
      case 'Stop': {
        this.closeAsks(a)
        a.activity = ''
        a.apiRetries = 0
        this.readCodexContext(a, e)
        if (a.turnStart) this.record(name, { turns: 1, turnMs: Date.now() - a.turnStart })
        a.turnStart = null
        const subs = this.subsThisTurn(a, e.background_tasks)
        // what it left running in the background (a build, a server, a sub-agent): it's called back when they finish
        a.background = Array.isArray(e.background_tasks) ? e.background_tasks.filter((t) => t?.status === 'running' || t?.status === 'pending').length : 0
        // its answer to where things stand, before a new conversation (see freshWhenDone): for Crew, not the chat
        if ((a.serving ?? []).some((m) => m.wrapUp)) {
          a.wrapNote = String(e.last_assistant_message ?? '')
          a.serving = []
          a.replyDue = false
          hold(a, 600)
          return this.setStatus(a, 'idle')
        }
        // one turn can answer several messages that came in together: the reply threads to the first, and the rest
        const also = (a.serving ?? []).slice(1).map((m) => m.id)
        // A turn can also end without a word (Codex does, after a task that was all tool calls). It was asked
        // something, so the chat still says it's done instead of leaving your message hanging.
        const said = String(e.last_assistant_message ?? '')
        const reply = said || a.replyDue
          ? this.post({ kind: 'reply', from: name, text: said ? said.slice(0, 4000) : NO_WORDS, ...(!said && { empty: true }), ...(a.current && { re: a.current }), ...(also.length && { also }), ...(subs.length && { subs }) })
          : null
        a.replyDue = false
        this.settleCalls(a, said ? reply : null) // a teammate who asked hears it finished without an answer, as before
        hold(a, 600)
        return this.setStatus(a, 'idle')
      }
      case 'StopFailure':
        this.closeAsks(a)
        return this.apiError(a, e)
    }
  }

  // A turn an API error cut short (Claude Code's StopFailure, in place of Stop). A dropped connection or a busy
  // server passes: Crew types "continue" for it, as you would, waiting longer each time. A usage limit, a login or
  // a billing problem doesn't, so that one is for you. Its turn isn't over meanwhile: nothing else is typed in.
  apiError(a, e) {
    a.activity = ''
    if (a.turnStart) this.record(a.name, { turns: 1, turnMs: Date.now() - a.turnStart })
    a.turnStart = null
    const error = String(e.error || 'unknown')
    const tries = a.apiRetries ?? 0
    if (!PASSING_ERRORS.has(error) || tries >= API_RETRY.length) {
      a.apiRetries = 0
      const said = gist(e.last_assistant_message, 160).replace(/[.\s]+$/, '')
      return this.needsYou(a, `stopped on an API error (${error})${said ? `: ${said}` : ''}. Type "continue" in its terminal once that's sorted`)
    }
    const ms = API_RETRY[tries]
    a.apiRetries = tries + 1
    a.retrying = true
    clearTimeout(a.retryTimer)
    a.retryTimer = setTimeout(() => this.resumeTurn(a), ms)
    this.post({ kind: 'event', from: a.name, text: `lost its turn to an API error (${error}), so Crew types "continue" for it in ${ms < 60000 ? `${ms / 1000}s` : `${ms / 60000} min`}` })
    this.changed()
  }

  resumeTurn(a) {
    if (!a.retrying) return
    if (!this.runner.running(a.name)) return void (a.retrying = false)
    const wait = a.holdUntil - Date.now() // you're typing in its terminal
    if (wait > 0) return void (a.retryTimer = setTimeout(() => this.resumeTurn(a), wait))
    a.retrying = false
    this.runner.submit(a.name, CONTINUE)
    a.expect = { id: a.current, text: CONTINUE, msgs: a.serving ?? [], again: true }
    this.awaitPickup(a)
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
      this.watchAsk(e.id, input.transcript_path ?? a.transcript?.path)
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
    clearInterval(q.timer)
    q.resolve(output)
    this.amend(q.entry, { answer: { ...answer, at: Date.now() } })
    const a = this.agents.get(q.name)
    if (a?.status === 'waiting' && !stillWaiting && !this.asking(q.name)) this.setStatus(a, 'working')
  }

  asking(name) {
    return [...this.asks.values()].some((q) => q.name === name)
  }

  // Claude Code can settle a question without anyone answering it: its built-in safety check turns a risky command
  // down after two minutes and the agent carries on, but the hook waiting on the card is never cancelled, and no hook
  // says so. Its transcript does: the call gets its result. So while one of its own questions is up (a sub-agent's
  // lives in another file), Crew looks there every few seconds, and the card closes once the call has a result.
  watchAsk(id, file) {
    const q = this.asks.get(id)
    if (q.cli !== 'claude' || q.input.agent_id || !file) return
    let from = 0
    try {
      from = fs.statSync(file).size
    } catch {}
    q.watch = { file, from }
    q.timer = setInterval(() => this.checkAsk(id), ASK_CHECK)
    q.timer.unref?.()
  }

  // Has the call behind this question got its result? It ran: you allowed it in its terminal. Turned down, with no
  // answer from you: Claude Code's own decision.
  checkAsk(id, stillWaiting = false) {
    const q = this.asks.get(id)
    const r = q?.watch && callResult(q.watch, q.input.tool_name, q.input.tool_input)
    if (!r) return false
    const denied = r.error && /\b(denied|blocked|rejected)\b/i.test(r.text.slice(0, 400))
    this.settle(id, '', denied ? { by: 'cli', why: /safety check/i.test(r.text) ? 'its safety check' : '' } : { by: 'terminal' }, stillWaiting)
    return true
  }

  // Its turn is over, so nothing it asked in that turn is waiting any more. (A sub-agent's question can outlive the
  // turn: those stay.)
  closeAsks(a) {
    for (const [id, q] of this.asks) if (q.name === a.name && !q.input.agent_id && !this.checkAsk(id, true)) this.settle(id, '', { stale: true }, true)
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
    // Its turn is over, whichever way it ended: the files it edited are free again, and whoever asked it something
    // this turn hears that no answer is coming (a Stop has settled those already). Turned off, it won't get to the
    // questions in its queue either, so their askers hear that now rather than wait. (A clone's queue goes back to
    // its original instead, see dismiss.)
    if (status === 'idle' || status === 'stopped' || status === 'off') {
      this.release(a.name)
      if (status !== 'idle' || !a.background) this.letGo(a.name) // what it left running may still be using a lease
      if (a.steering && status === 'idle' && !a.freshPending && !a.relaunch) {
        // what Crew typed mid-turn wasn't taken in yet: give the CLI a moment to start a turn with it (see unsteer)
        hold(a, 5000)
        clearTimeout(a.steerTimer)
        a.steerTimer = setTimeout(() => this.unsteer(a), 5000)
      } else if (a.steering) this.unsteer(a) // gone: it's back in the queue, for what happens to that below
      if (a.serving?.length) this.settleCalls(a, null, { idle: 'stopped before it answered', stopped: 'exited before it answered', off: 'was turned off before it answered' }[status])
      if (status === 'off' && !a.cloneOf) this.forgetCalls(a.name, "was turned off, so it can't answer")
    }
    if (status === 'idle' && a.freshPending) return this.freshWhenDone(a)
    if (status === 'idle' && a.relaunch) return this.launch(a)
    if (status === 'idle') this.pump(a)
    if (status === 'working') this.steer(a)
    this.changed()
  }

  // Questions and answers don't wait for the end of a turn. A busy agent gets them typed into the turn it's in: its
  // CLI takes them in at its next step (Claude Code and Codex both do, between two tool calls), so a teammate waiting
  // on its answer waits seconds rather than the rest of a task. It answers with `crew answer` and carries on.
  // Never while a dialog is up in its terminal (a permission prompt), while you're typing there, or while the last
  // thing Crew typed hasn't been taken in yet; then as soon as that clears.
  steer(a) {
    if (a.status !== 'working' || !this.runner.running(a.name) || a.expect || a.steering || a.retrying || this.asking(a.name)) return
    const msgs = a.inbox.filter((m) => m.ask || m.answers)
    if (!msgs.length) return
    clearTimeout(a.steerTimer)
    const wait = a.holdUntil - Date.now()
    if (wait > 0) return void (a.steerTimer = setTimeout(() => this.steer(a), wait))
    for (const m of msgs) {
      a.inbox.splice(a.inbox.indexOf(m), 1)
      m.queued = false
      this.record(a.name, { fromTeam: 1, delivered: 1, queuedMs: Date.now() - m.ts })
    }
    const text = msgs.map((m) => this.framed(a, m, { busy: true })).join('\n\n')
    this.runner.submit(a.name, withImages(text, msgs.flatMap((m) => m.images ?? [])))
    a.steering = { text, msgs, at: Date.now() }
    // Enter again in case the first was lost on a stalled CLI (an empty prompt box ignores it)
    const retry = (waits) => {
      a.steerTimer = setTimeout(() => {
        if (!a.steering || a.status !== 'working' || a.typedAt > a.steering.at) return // you've typed there since
        this.runner.write(a.name, '\r')
        if (waits.length > 1) retry(waits.slice(1))
      }, waits[0])
    }
    retry([3000, 8000])
    this.changed()
  }

  // The turn ended before its CLI took in what Crew typed into it. If the CLI doesn't start a turn with it by itself
  // in a few seconds, it goes back to the front of the queue and in as the next prompt.
  unsteer(a) {
    clearTimeout(a.steerTimer)
    if (!a.steering) return
    const { msgs } = a.steering
    a.steering = null
    for (const m of [...msgs].sort((x, y) => rank(y) - rank(x))) (a.inbox.unshift(m), (m.queued = true))
    this.pump(a)
  }

  // ---- work experience: what each agent actually did, kept across restarts -----

  record(name, counts) {
    name = this.baseOf(name) // a clone's work is its original's experience
    const s = (this.stats[name] ??= { first: Date.now(), days: {} })
    const day = (s.days[localDay()] ??= {})
    for (const [k, v] of Object.entries(counts)) {
      s[k] = (s[k] ?? 0) + v
      if (['tasks', 'activeMs', 'cost', 'tokens'].includes(k)) day[k] = (day[k] ?? 0) + v
    }
    s.last = Date.now()
    clearTimeout(this.statsTimer)
    this.statsTimer = setTimeout(() => this.saveStats(), 2000)
  }

  saveStats() {
    const cutoff = localDay(Date.now() - 60 * 864e5)
    for (const s of Object.values(this.stats)) if (s) for (const d of Object.keys(s.days)) if (d < cutoff) delete s.days[d]
    fs.writeFileSync(this.at('stats.json'), JSON.stringify(this.stats))
  }

  statsOf(a) {
    const s = this.stats[a.cloneOf ?? a.name] ?? { days: {} }
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = localDay(Date.now() - (13 - i) * 864e5)
      return { day: d, tasks: s.days[d]?.tasks ?? 0, cost: s.days[d]?.cost ?? 0 }
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
      // what its work cost (Claude, priced as Claude Code prices it) or used (Codex reports tokens), and the lines it changed
      cost: s.cost ?? 0,
      costToday: s.days[localDay()]?.cost ?? 0,
      costPerTask: s.cost && s.tasks ? s.cost / s.tasks : 0,
      tokens: s.tokens ?? 0,
      linesAdded: s.linesAdded ?? 0,
      linesRemoved: s.linesRemoved ?? 0,
      apiMs: s.apiMs ?? 0,
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
    if (typed(data)) a.typedAt = Date.now()
    hold(a, 3000)
    this.runner.write(name, data)
    // Enter on its trust question: it's starting up now (or quitting, if that's what you picked)
    if (a.trustAsk && data.includes('\r')) {
      a.trustAsk = false
      this.setStatus(a, 'starting')
      return this.readyIn(a)
    }
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
    const ext = Object.hasOwn(IMAGE_TYPES, type) && IMAGE_TYPES[type]
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
  // From a linked computer, `ask` is a question asked there (its id there: the answer goes back with it), and
  // `answers` the answer to one asked here.
  send({ from = 'you', to, text, images = [], mentions = true, fresh = false, ticket, title, type, triage = false, re: replyTo, quote, ask, answers }) {
    text = String(text ?? '').trim()
    images = [].concat(images).filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep))
    if (!text && images.length) text = images.length > 1 ? 'Have a look at these images.' : 'Have a look at this image.'
    if (!text) throw new Error('nothing to send')
    if (answers) {
      const call = this.calls.get(answers)
      if (call) this.respond(call, { by: from, text })
      return 'answered\n'
    }
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
    // Work can't go back to a teammate that's waiting on your answer: your final message goes back to it by itself.
    for (const t of this.agents.has(from) ? targets : []) {
      const answering = this.agents.get(from).serving ?? []
      const call = [...this.calls.values()].find((c) => this.ownerOf(c) === from && (c.from === t.name || this.baseOf(c.from) === t.name) && (c.hold || answering.includes(c.msg)))
      if (!call) continue
      this.ruling('back', from, call.from)
      throw new Error(`@${call.from} is waiting for your answer to "${gist(call.text, 80)}". Don't hand it back: put what you'd send it in your answer. Your final message goes back to @${call.from} by itself.${targets.length > 1 ? ' (nothing was sent)' : ''}`)
    }

    const held = from !== 'you' && !this.space.autopilot
    if (ask) {
      const msg = this.post({ kind: 'msg', from, to: targets[0].name, text, ask: true, ...(images.length && { images }), queued: !held, held })
      this.open({ id: msg.id, msg, from, text, back: ask })
      if (!held) this.enqueue(targets[0], msg)
      return `asked @${targets[0].name}\n`
    }
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

  // An agent's queue, in the order it takes things up: answers to its own questions first (they unblock work it's in
  // the middle of), then teammates' questions (someone is waiting), then everything else as it came.
  queue(a, msg) {
    const i = a.inbox.findIndex((m) => rank(m) > rank(msg))
    if (i < 0) a.inbox.push(msg)
    else a.inbox.splice(i, 0, msg)
  }

  enqueue(a, msg) {
    const to = this.placeFor(a, msg)
    if (to !== a) this.amend(msg, { to: to.name })
    this.queue(to, msg)
    const busy = to.status !== 'idle' || to.inbox.length > 1
    const starting = to.status === 'starting'
    this.pump(to)
    this.steer(to) // a question or an answer for a busy agent goes into the turn it's in
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
    const call = this.calls.get(id) // a question you dropped: its asker hears so, instead of waiting
    if (call) this.respond(call, { by: msg.to, why: 'never got it: the user dropped the question' })
    this.changed()
  }

  // ---- right of way: questions that come back, and who goes first -------------------------------------------
  // Agents that need each other can stall a crew: two of them each waiting for the other, an answer that never finds
  // its way back, work handed back and forth, two editors in one file. Crew settles these by rule instead of leaving
  // the agents to sort it out between them:
  // - `crew ask` holds the asker's shell until the answer comes. The question reaches the teammate even mid-task (it's
  //   typed into the turn it's in, see steer), and its `crew answer`, or else its final message, comes straight back
  //   into the asker's turn (or into the turn it's in by then, if it gave up waiting). Nobody has to remember to
  //   reply, and nobody polls.
  // - Whoever is being waited on never waits on its waiter: an ask that would close a loop is refused on the spot.
  //   And work can't be handed back to an agent that's waiting on your answer: the answer goes back by itself.
  // - Answers go in first, then questions, then the rest; hand-offs that piled up go in together, in one turn.
  // - One file, one editor (lease).

  // `crew ask <name> "…"`. Resolves with the answer, or after `hold` ms with where things stand.
  async question({ from = 'you', to, text, images = [], closed, hold = ASK_HOLD }) {
    text = String(text ?? '').trim()
    images = [].concat(images).filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep))
    if (!text) throw new Error('usage: crew ask <name> "what you need"')
    const named = addressees(to, '')
    if (named.length > 1) throw new Error('ask one teammate at a time: crew ask <name> "…"')
    const local = (n) => [n, this.baseOf(n)].find((x) => this.agents.has(x))
    const name = named.length ? (named[0].includes('@') ? named[0] : (local(named[0]) ?? this.elsewhere?.(named[0]) ?? named[0])) : this.route(text, from)?.name
    if (!name) throw new Error('no agents to ask')
    const asker = this.agents.get(from)
    this.mayWait(from, name)
    if (name.includes('@')) return this.questionElsewhere({ from, name, text, images, closed, hold })
    const [target] = this.recipients([name], from)
    // the same question again (a retry after a "hasn't answered yet"): wait on the one already asked
    const same = [...this.calls.values()].find((c) => c.from === from && this.baseOf(this.ownerOf(c)) === target.name && squash(c.text) === squash(text))
    if (same) return this.hold([same], hold, closed)
    const held = from !== 'you' && !this.space.autopilot
    const msg = this.post({ kind: 'msg', from, to: target.name, text, ask: true, ...(images.length && { images }), ...(asker?.current && { re: asker.current }), queued: !held, held })
    const call = this.open({ id: msg.id, msg, from, text, parent: this.workingOn(asker) })
    if (asker) this.record(from, { handoffs: 1 })
    if (!held) this.enqueue(target, msg)
    return this.hold([call], hold, closed)
  }

  // A question for an agent on a linked computer: asked there (where it's queued and answered by the same rules), and
  // waited on here. Its answer comes back through send({ answers }).
  async questionElsewhere({ from, name, text, images, closed, hold }) {
    if (!this.relay) throw new Error(`@${name} is on another computer, and Crew Link isn't on`)
    // from your own terminal there's no one there to send the answer back to: it shows in the chat
    if (from === 'you') return `${await this.relay(from, [name], text, images, {})}(its answer will show in the chat)\n`
    const call = this.open({ id: randomUUID().slice(0, 8), to: name, from, text, parent: this.workingOn(this.agents.get(from)) })
    let out
    try {
      out = await this.relay(from, [name], text, images, { ask: call.id })
    } catch (e) {
      this.calls.delete(call.id)
      throw e
    }
    if (!/^asked /.test(out)) {
      // a computer on an older Crew took it as a hand-off: no answer will come back by itself
      this.calls.delete(call.id)
      return `${out}(its computer runs an older Crew, so this went as a hand-off: the answer won't come back by itself)\n`
    }
    if (this.agents.has(from)) this.record(from, { handoffs: 1 })
    return this.hold([call], hold, closed)
  }

  open(call) {
    // a question that never got its answer back (its computer went away for good) is forgotten after a day
    for (const [id, c] of this.calls) if (!c.hold && Date.now() - c.at > 864e5) this.calls.delete(id)
    this.calls.set(call.id, { at: Date.now(), hold: null, ...call })
    this.changed()
    return this.calls.get(call.id)
  }

  // `name` won't answer any more (turned off, removed, renamed, moved to another computer): whoever is waiting on it
  // hears so now, whether its question was queued, being answered or put aside while it asked a teammate. What it
  // asked itself isn't waited on any more either.
  forgetCalls(name, why) {
    const a = this.agents.get(name)
    for (const m of a?.inbox.filter((m) => m.ask) ?? []) a.inbox.splice(a.inbox.indexOf(m), 1)
    for (const call of [...this.calls.values()]) {
      if (this.ownerOf(call) === name) this.respond(call, { by: name, why })
      else if (call.from === name) {
        this.calls.delete(call.id)
        call.hold?.resolve('')
      }
    }
  }

  // Who owes a question its answer: whoever took it (a clone, maybe), or the agent on another computer it went to.
  ownerOf(call) {
    return call.msg?.to ?? call.to
  }

  // The question `a` is answering right now, if any: anything it asks in turn is part of answering that one.
  workingOn(a) {
    for (const m of a?.serving ?? []) {
      const id = m.ask ? m.id : m.for
      if (id && this.calls.has(id)) return id
    }
    return undefined
  }

  // Whoever is being waited on never waits on its waiter. `from` may wait on `to` unless `to` is already waiting on
  // `from`, directly or down a line of teammates: `from` would then wait forever, so it's told to answer first.
  mayWait(from, to) {
    const line = this.waitPath(to, from)
    if (!line) return
    this.ruling('loop', from, to, { line })
    const via = line.slice(1, -1).map((n) => `@${n}`)
    const why = via.length ? `@${to} is waiting on ${via.join(', which is waiting on ')}, which is waiting for your answer` : `@${to} is waiting for your answer`
    throw new Error(`${why}, so it can't answer you until you answer. Don't wait on it: finish with what you know, say what you couldn't check, and your answer unblocks it.`)
  }

  // [start, …, goal] when `start` is stuck waiting on `goal`, through whoever it waits on in turn. null when it isn't.
  waitPath(start, goal) {
    const prev = new Map([[start, null]])
    const todo = [start]
    while (todo.length) {
      const n = todo.shift()
      for (const m of this.blockedOn(n)) {
        if (prev.has(m)) continue
        prev.set(m, n)
        if (m === goal) {
          const line = [m]
          for (let x = n; x !== null; x = prev.get(x)) line.unshift(x)
          return line
        }
        todo.push(m)
      }
    }
    return null
  }

  // The teammates `name` is stuck waiting on right now: whoever owes an answer to a `crew ask` of its that's still
  // holding on. An agent on a linked computer: as its computer reports it.
  blockedOn(name) {
    if (this.agents.has(name)) return [...this.calls.values()].filter((c) => c.from === name && c.hold).map((c) => this.ownerOf(c))
    return (this.directory?.() ?? []).find((a) => a.name === name)?.waitingOn?.map((w) => w.name) ?? []
  }

  // The asker waits in its shell for the first of `calls` to be answered, for up to `ms`. Then it's told where
  // things stand and to carry on, and the answers come to it as messages instead. The shell command ending early
  // (Esc, a timeout) lets go the same way.
  hold(calls, ms, closed) {
    return new Promise((resolve) => {
      const h = {}
      const timer = setTimeout(() => h.resolve(this.stillWaiting(calls)), ms)
      h.resolve = (text) => {
        clearTimeout(timer)
        for (const c of calls) if (c.hold === h) c.hold = null
        this.changed()
        resolve(text)
      }
      h.since = Date.now()
      for (const c of calls) {
        c.hold?.resolve(this.stillWaiting([c])) // a second wait on it takes over from the first
        c.hold = h
      }
      closed?.addEventListener('abort', () => h.resolve(''), { once: true })
      this.changed()
    })
  }

  stillWaiting(calls) {
    const lines = calls.map((c) => {
      const to = this.ownerOf(c)
      const b = this.agents.get(to)
      const at = b ? b.inbox.indexOf(c.msg) : -1
      const where = !b ? '' : b.serving?.includes(c.msg) ? "it's on it now" : b.steering?.msgs.includes(c.msg) ? 'it gets your question at its next step' : at === 0 ? (b.status === 'idle' ? "it's about to start on it" : 'your question is next, once it finishes what it is doing') : at > 0 ? `${at} message${at > 1 ? 's' : ''} ahead of yours` : ''
      return `@${to} hasn't answered yet${where ? ` (${where})` : ''}.`
    })
    return `${lines.join('\n')}\nDon't ask again. Carry on with other work and the answer comes to you as a message, or wait more with: crew wait\n`
  }

  // `crew wait`: hold on for the answers to the questions you asked. One that came in while you were busy (queued
  // for your next turn) is handed over right here instead.
  wait({ from = 'you', closed, hold = ASK_HOLD } = {}) {
    const a = this.agents.get(from)
    const arrived = a ? a.inbox.filter((m) => m.answers) : []
    if (arrived.length) {
      for (const m of arrived) {
        a.inbox.splice(a.inbox.indexOf(m), 1)
        this.amend(m, { queued: false })
      }
      a.serving = [...(a.serving ?? []), ...arrived] // this turn takes them up now
      return arrived.map((m) => `@${m.from} answered${m.question ? ` "${m.question}"` : ''}:\n\n${m.text}`).join('\n\n') + '\n'
    }
    const open = [...this.calls.values()].filter((c) => c.from === from)
    if (!open.length) return 'Nothing to wait for: every question you asked has been answered.\n'
    for (const c of open) this.mayWait(from, this.ownerOf(c)) // the same rule as crew ask: never wait on your waiter
    return this.hold(open, hold, closed)
  }

  // `crew answer [@name] "…"`: answer a question you were asked, right away, without ending what you're doing (the
  // oldest still open, or the one from `to`). It shows in the chat as your reply to it, and the asker has it now.
  answerNow({ from, to, text }) {
    text = String(text ?? '').trim()
    if (!text) throw new Error('usage: crew answer "your answer"')
    const a = this.agents.get(from)
    const asked = (to ? [to] : []).map((n) => String(n).replace(/^@/, '').toLowerCase())
    const all = (a?.serving ?? []).filter((m) => m.ask && this.calls.has(m.id))
    const open = all.filter((m) => !asked.length || asked.includes(m.from) || asked.includes(this.baseOf(m.from)))
    if (!open.length) throw new Error(asked.length ? `@${asked[0]} hasn't asked you anything that's still open` : 'No question to answer: nobody is waiting on you (or it was answered already).')
    const m = open[0]
    const reply = this.post({ kind: 'reply', from, text: text.slice(0, 4000), re: m.id })
    this.respond(this.calls.get(m.id), { by: from, text, reply })
    const left = all.length - 1
    return `@${m.from} has your answer.${left ? ` ${left} more question${left > 1 ? 's' : ''} waiting: crew answer @name "…"` : ''}\n`
  }

  // An agent's turn is over: the questions it was answering get its final message (or why there isn't one). One it
  // asked a teammate about in turn, still unanswered, stays open: the turn in which that answer comes in settles it.
  settleCalls(a, reply, why) {
    const served = a.serving ?? []
    a.serving = []
    for (const id of new Set(served.map((m) => (m.ask ? m.id : m.for)))) {
      const call = id && this.calls.get(id)
      if (!call || this.ownerOf(call) !== a.name) continue
      if (!why && [...this.calls.values()].some((c) => c.from === a.name && c.parent === id)) continue
      this.respond(call, { by: a.name, text: reply?.text, reply, why: why ?? (reply ? undefined : 'finished without an answer') })
    }
  }

  // A question's answer, whichever way it comes: back into the asker's `crew ask` if that's still waiting, else to the
  // asker as its next message (ahead of anything else in its queue), or back to its computer if it's on another.
  respond(call, { by, text, reply, why }) {
    this.calls.delete(call.id)
    const said = why ? `(@${by} ${why}.)` : String(text ?? '').trim()
    if (call.msg) this.amend(call.msg, { answered: { by, at: Date.now(), ...(reply && { reply: reply.id }), ...(why && { why }) } })
    if (call.hold) return call.hold.resolve(`@${by} answered:\n\n${said}\n`)
    if (call.back) return this.sendBack(by, call, said)
    const asker = this.agents.get(call.from) ?? this.agents.get(this.baseOf(call.from))
    if (!asker || asker.off) return this.changed()
    const msg = this.post({ kind: 'msg', from: by, to: asker.name, text: said, answers: call.id, question: gist(call.text), re: call.msg?.id ?? call.id, ...(reply && { reply: reply.id }), ...(call.parent && { for: call.parent }), queued: true })
    this.pinned.add(msg) // its asker's, not a clone's that happens to be free
    this.enqueue(asker, msg)
  }

  // An answer for a question asked on another computer goes back there. If that computer can't be reached right now,
  // it tries again for a minute before giving up (the asker there is told where things stand by its own hold).
  sendBack(by, call, said, tries = 0) {
    Promise.resolve(this.relay?.(by, [call.from], said, [], { answers: call.back })).catch(() => {
      if (tries < 5) setTimeout(() => this.sendBack(by, call, said, tries + 1), 12000)
    })
  }

  // Crew stepping in, as a line in the chat: who was stopped from what, and why. The same one twice in a row (an
  // agent trying again) shows once.
  ruling(rule, from, to, extra = {}) {
    const last = this.feed.findLast((e) => e.kind === 'rule')
    if (last && last.rule === rule && last.from === from && last.to === to && last.file === extra.file && last.ticket === extra.ticket && Date.now() - last.ts < 120000) return
    this.post({ kind: 'rule', rule, from, to, ...extra })
  }

  // One file, one editor. An agent's file tools check here before they write (Claude Code's Edit, Write, MultiEdit
  // and NotebookEdit; Codex's apply_patch): the first agent to edit a file holds it until its turn ends, and anyone
  // else is turned away, told who has it. So an agent and its clones, or two agents in one folder, never write over
  // each other. An agent answering the holder's question may edit its files: the holder is waiting on it, not
  // editing. The answer is the PreToolUse hook's output: '' lets the edit through.
  // An agent in another workspace holds files and things too: two workspaces in one folder, or a shared agent at work in
  // both, still edit a file one at a time. It can't be asked (crew ask stays in a workspace), so it's named with its
  // workspace.
  lease(name, e) {
    const a = this.agents.get(name)
    if (!a || !e) return ''
    const files = editedFiles(e, expand(a.cwd))
    for (const [key, file] of files) {
      const held = this.leases.get(key)
      if (!held || this.mine(held, name)) continue
      const there = this.hubOf(held.ws ?? this.ws)
      const holder = there?.agents.get(held.name)
      if (!holder || !there.holding(holder, held) || (there === this && this.waitPath(holder.name, name))) continue
      const short = path.basename(file)
      const away = there !== this && there.space.name
      if (!this.turnedAway.has(`${name}:${key}`)) {
        this.turnedAway.add(`${name}:${key}`)
        this.ruling('file', name, holder.name, { file: short, ...(away && { in: away }) })
      }
      const reason = away
        ? `${short} is being edited by ${holder.name} in your ${away} workspace right now, and Crew lets one agent edit a file at a time, whichever workspace it works in. Leave it be and do the rest of your work: the file is free again once ${holder.name} there finishes its turn.`
        : `${short} is being edited by @${holder.name} right now, and Crew lets one agent edit a file at a time. Leave it to @${holder.name} and do the rest of your work: the file is free again once @${holder.name} finishes its turn. If you need a change in it, crew ask ${holder.name}.`
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })
    }
    for (const key of files.keys()) {
      const held = this.leases.get(key)
      const there = held && this.hubOf(held.ws ?? this.ws)
      // free, or its own already: it's this agent's now (one answering the holder edits under the holder's lease)
      if (!held || this.mine(held, name) || !there?.holding(there.agents.get(held.name), held)) this.leases.set(key, { name, ws: this.ws, at: Date.now() })
    }
    return ''
  }

  // The hub of the workspace a lease's holder works in. Crew sets this, to find any workspace's; on its own, a hub knows
  // only itself.
  hubOf(ws) {
    return ws === this.ws ? this : null
  }

  // A lease of this agent's: one of this workspace's (the same name in another workspace is another agent), or yours
  // from any of them.
  mine(entry, name) {
    return entry.name === name && (name === 'you' || (entry.ws ?? this.ws) === this.ws)
  }

  // Is an agent still holding a file it edited? Only mid-turn, and only for so long without touching it.
  holding(a, lease) {
    return Boolean(a) && this.runner.running(a.name) && (a.status === 'working' || a.status === 'waiting') && Date.now() - lease.at < LEASE_STALE
  }

  release(name) {
    let freed = false
    for (const [file, l] of this.leases) if (this.mine(l, name)) (this.leases.delete(file), (freed = true))
    for (const k of this.turnedAway) if (k.startsWith(`${name}:`)) this.turnedAway.delete(k)
    if (freed) this.changed()
  }

  // One user at a time, for things that aren't files: a simulator, a device, a dev server's port, an API that rate-limits
  // the whole office. `crew lease <thing>` takes it before using it; someone else has it, and it waits for it like
  // `crew ask` waits for an answer, then says who has it. It's the holder's until it gives it back (`crew release`), its
  // turn ends with nothing of its left running in the background, or its CLI stops. An agent answering the holder's
  // question may use it: the holder is waiting on it, not using it. From your own terminal it's yours until you release it.
  async claim({ from = 'you', words = [], closed, hold = ASK_HOLD }) {
    const [thing = '', ...why] = words.map((w) => String(w).trim())
    const key = leaseKey(thing)
    if (!key) throw new Error('usage: crew lease <thing> ["what for"], e.g. crew lease simulator "QA pass for #12"')
    if (from !== 'you' && !this.agents.has(from)) throw new Error(`no agent named "${from}"`)
    const held = this.held.get(key)
    const there = held && (held.name === 'you' ? this : this.hubOf(held.ws ?? this.ws))
    if (!held || this.mine(held, from) || !there?.stillHolds(held)) return this.grant(key, from, thing, why.join(' '))
    if (there === this && this.waitPath(held.name, from)) return `@${held.name} has ${held.thing}, but it's waiting on you: use it for what @${held.name} asked you.\n`
    if (!this.turnedAway.has(`${from}:lease:${key}`)) {
      this.turnedAway.add(`${from}:lease:${key}`)
      this.ruling('lease', from, held.name, { thing: held.thing, ...(there !== this && { in: there.space.name }) })
    }
    return new Promise((resolve) => {
      const w = { key, from, ws: this.ws, thing, why: why.join(' ') }
      const timer = setTimeout(() => w.resolve(this.takenText(this.held.get(key) ?? held)), hold)
      w.resolve = (text) => {
        clearTimeout(timer)
        const at = this.leaseWaits.indexOf(w)
        if (at >= 0) this.leaseWaits.splice(at, 1) // in place: every workspace's hub has this list
        resolve(text)
      }
      closed?.addEventListener('abort', () => w.resolve(''), { once: true })
      this.leaseWaits.push(w)
    })
  }

  grant(key, name, thing, why) {
    const was = this.held.get(key)
    const again = was?.name === name
    if (again) thing = was.thing // as it was first written
    this.held.set(key, { thing, name, ws: this.ws, why: why ? why.slice(0, 200) : (again ? was.why : ''), at: again ? was.at : Date.now() })
    this.changed()
    const until = name === 'you' ? 'until you crew release it' : `until your turn ends with nothing left running, or you crew release ${thing}`
    return `${again ? 'Still yours' : 'Yours now'}: ${thing}, ${until}.\n`
  }

  // Still the holder's? Yours until you let go; an agent's while it's at work, or something it left running is.
  stillHolds({ name }) {
    if (name === 'you') return true
    const a = this.agents.get(name)
    return Boolean(a) && this.runner.running(name) && !['off', 'stopped'].includes(a.status) && (a.status !== 'idle' || a.background > 0)
  }

  takenText(h) {
    const mins = Math.max(1, Math.round((Date.now() - h.at) / 60000))
    const away = h.name !== 'you' && (h.ws ?? this.ws) !== this.ws && (this.hubOf(h.ws)?.space.name ?? h.ws)
    const who = h.name === 'you' ? 'the user' : away ? `${h.name} (in your ${away} workspace)` : `@${h.name}`
    return `${h.thing} is still ${who}'s (${mins} min${h.why ? `: ${h.why}` : ''}). Don't use it meanwhile: carry on with other work and try again later${h.name === 'you' || away ? '' : `, or crew ask ${h.name}`}.\n`
  }

  // `crew release [thing]`: one thing, or everything it holds.
  give({ from = 'you', words = [] }) {
    const thing = words.join(' ').trim()
    const keys = (thing ? [leaseKey(thing)] : [...this.held.keys()]).filter((k) => this.held.get(k) && this.mine(this.held.get(k), from))
    if (!keys.length) return thing ? `${thing} isn't yours\n` : 'You hold nothing\n'
    const things = keys.map((k) => this.held.get(k).thing)
    for (const k of keys) this.free(k)
    return `released ${things.join(', ')}\n`
  }

  // Everything `name` holds goes back: its turn is over, or its CLI stopped.
  letGo(name) {
    for (const [k, h] of [...this.held]) if (this.mine(h, name)) this.free(k)
  }

  // Free again: the first one waiting for it gets it, in whichever workspace it waits.
  free(key) {
    this.held.delete(key)
    const next = this.leaseWaits.find((w) => w.key === key && (w.from === 'you' || this.hubOf(w.ws ?? this.ws)?.runner.running(w.from)))
    const there = next && (this.hubOf(next.ws ?? this.ws) ?? this) // yours, from a workspace since removed: here
    if (next) next.resolve(there.grant(key, next.from, next.thing, next.why))
    this.changed()
  }

  holdsOf(name) {
    return [...this.held.values()].filter((h) => this.mine(h, name) && this.stillHolds(h)).map((h) => h.thing)
  }

  // `crew leases`: who has what, in every workspace.
  leasesText() {
    const now = [...this.held.values()].filter((h) => (h.name === 'you' ? this : this.hubOf(h.ws ?? this.ws))?.stillHolds(h))
    if (!now.length) return 'Nothing is leased right now.\n'
    const who = (h) => (h.name === 'you' ? 'the user' : (h.ws ?? this.ws) === this.ws ? `@${h.name}` : `${h.name} (${this.hubOf(h.ws)?.space.name ?? h.ws})`)
    return now.map((h) => `${h.thing.padEnd(22)} ${who(h).padEnd(16)} ${Math.max(1, Math.round((Date.now() - h.at) / 60000))} min${h.why ? `  ${h.why}` : ''}`).join('\n') + '\n'
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
    // past its context limit, and free while it waited on what it left running: its next task is the moment for
    // the new conversation, once it has said where things stand
    if (a.freshPending && a.freshLimit && !a.wrapUp) return this.askWrapUp(a)
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
    const msgs = this.nextUp(a)
    const [msg] = msgs
    for (const m of msgs) m.queued = false
    if (msg.ticket !== undefined && !msg.triage) (this.convoOf(a).ticket = msg.ticket), this.saveConvos() // this conversation is about that bug now
    // A line Crew owes the agent (it moved to this computer while free) goes on top of the next message it gets.
    const note = this.convos[a.name]?.note
    if (note) delete this.convos[a.name].note, this.saveConvos()
    const head = msgs.length < 2 ? '' : msg.answers ? `[${msgs.length} answers to your questions came in]` : `[${msgs.length} hand-offs came in while you were busy, oldest first. Take them together, in this one turn.]`
    const text = [note, head, ...msgs.map((m) => this.framed(a, m))].filter(Boolean).join('\n\n')
    this.runner.submit(a.name, withImages(text, msgs.flatMap((m) => m.images ?? [])))
    // Matched against the prompt the agent reports, even if it shows up late. Only the words count:
    // Claude Code turns attached image paths into "[Image #1]" and moves them around.
    a.expect = { id: msg.id, text, msgs }
    // (Crew's own prompts, like "you were moved here", aren't messages anyone sent it)
    for (const m of msgs) if (!m.crew) this.record(a.name, { [m.from === 'you' ? 'fromYou' : 'fromTeam']: 1, delivered: 1, queuedMs: Date.now() - m.ts })
    this.awaitPickup(a)
    this.setStatus(a, 'working')
  }

  // What goes in next: the head of the queue, with every other answer when it's an answer, and every other teammate
  // hand-off when it's one of those. They're read together, in one turn: a pile of hand-offs costs one turn instead
  // of one each, and two that crossed are read side by side. A question, a message from you and a task each get a
  // turn of their own.
  nextUp(a) {
    const kind = (m) => (m.answers ? 'answer' : !m.ask && !m.fresh && m.ticket === undefined && m.from !== 'you' && !m.crew ? 'handoff' : null)
    const k = kind(a.inbox[0])
    const msgs = k ? a.inbox.filter((m) => kind(m) === k) : [a.inbox[0]]
    for (const m of msgs) a.inbox.splice(a.inbox.indexOf(m), 1)
    return msgs
  }

  // A message as the agent reads it: in brackets, what it is and who it's from, so it knows what's expected of it.
  // Several agents sent the same message: the first named leads and owns the result, the rest each take their part.
  // busy: typed into the turn it's in (steer), so it answers right away and carries on.
  framed(a, m, { busy = false } = {}) {
    if (m.answers) return `[answer from @${m.from} to your question${m.question ? ` "${m.question}"` : ''}] ${m.text}`
    if (m.ask && busy) return `[question from @${m.from}, who is waiting on your answer. Answer it now with crew answer "…", then carry on with what you were doing] ${m.text}`
    if (m.ask) return `[question from @${m.from}, who is waiting on your answer: your final message is the answer, and goes back to @${m.from} by itself] ${m.text}`
    const others = (m.cc ?? []).filter((n) => this.baseOf(n) !== this.baseOf(a.name))
    const leads = others.length && this.baseOf(m.cc[0]) === this.baseOf(a.name)
    const split = !others.length ? '' : leads
      ? `also sent to ${others.map((n) => `@${n}`).join(' ')}: you lead this and own the result, and they each take the part in their own area`
      : `also sent to ${others.map((n) => `@${n}`).join(' ')}, and @${m.cc[0]} leads it: take only the part in your own area`
    const tag = [m.from !== 'you' && `from @${m.from}: it's yours now, no need to report back`, m.replying, split].filter(Boolean).join(', ')
    return tag ? `[${tag}] ${m.text}` : m.text
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
    owner = owner ? this.taskOwner(owner, by) : null
    const t = this.tickets.add({ text, images, by, kind: KINDS.includes(kind) ? kind : 'task', owner })
    if (owner) {
      t.triaged = true // you said who: nothing to triage
      this.postTask(t, by, 'filed')
      if (this.space.autofix) this.autoDispatch(t)
      return `added #${t.id} for @${owner}\n`
    }
    const triage = this.triager()
    if (!triage) {
      const owner = ownerFor(`${t.title} ${t.body}`, this.teammates())
      if (owner) this.tickets.edit(t.id, { owner: owner.name }, 'crew')
    }
    this.postTask(t, by, 'filed')
    if (triage) this.send({ from: 'you', to: triage, text: triagePrompt(t, t.id), images: t.images, mentions: false, ticket: t.id, title: t.title, type: t.kind, triage: true })
    else if (this.space.autofix && t.owner) this.autoDispatch(t)
    return `added #${t.id}${triage ? `, @${triage} is triaging it` : t.owner ? ` for @${t.owner}` : ''}\n`
  }

  // The triage agent you picked, if it's around to do it.
  triager() {
    const a = this.agents.get(this.space.triage)
    return a && !a.off ? a.name : null
  }

  // Everyone who can own a task: agents here that are on, and the ones on linked computers.
  teammates() {
    const here = [...this.agents.values()].filter((a) => !a.off && !a.cloneOf).map((a) => this.lineup(a))
    return [...here, ...(this.directory?.() ?? []).filter((a) => a.on && !a.cloneOf).map((a) => ({ name: a.name, area: a.area, status: a.status, queue: a.queue ?? 0, nearLimit: Boolean(a.nearLimit) }))]
  }

  // A task goes to its owner in a fresh conversation with just this task in it. If the owner is still in the
  // conversation where it worked on this task, "send back" goes there, with everything it already tried.
  // quiet: no line in the chat for it (a bulk Start posts one for all of them).
  async dispatch(id, opts) {
    const { to, note, quiet } = opts ?? {} // over Crew Link a missing argument arrives as null
    const t = this.tickets.get(id)
    const owner = this.agentName(to || t.owner || ownerFor(`${t.title} ${t.body}`, this.teammates().filter((a) => !t.declined?.includes(this.baseOf(a.name))))?.name)
    if (!owner) throw new Error(`who should fix #${t.id}? Pick an owner first`)
    if (!this.isOn(owner)) throw new Error(`@${owner} is turned off: turn it on to start #${t.id}, or give it to someone else`)
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
    if (!quiet) this.postTask(t, 'you', 'fixing', owner)
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
    // An owner that's off: the task waits for it, and starts once it's back on (startWaiting).
    if (t.owner && !this.isOn(t.owner)) return void this.post({ kind: 'event', from: 'crew', text: `#${t.id} waits for @${t.owner}, who is turned off: it starts once @${t.owner} is back on` })
    this.dispatch(t.id).catch((e) => this.post({ kind: 'event', from: 'crew', text: `couldn't send #${t.id} on: ${e.message}` }))
  }

  // An agent just came back on: with Auto-start, the tasks that waited for it start now, each in a new conversation.
  startWaiting(a) {
    if (!this.space.autofix) return
    for (const t of this.tickets.open()) if (t.status === 'new' && t.owner === a.name) this.autoDispatch(t)
  }

  // An owner for a task. An agent giving a task away (triage, `crew task add --owner`) can only give it to a teammate
  // who's on: one that's off never picks it up, and the task just sits there. You can, and the task waits for it.
  taskOwner(name, by, t) {
    const owner = this.agentName(name)
    if (by === 'you' || this.isOn(owner)) return owner
    throw new Error(`@${owner} is turned off, so it can't take ${t ? `#${t.id}` : 'this task'}. Give it to a teammate who's on (crew who), or leave out --owner for the user to decide`)
  }

  // Is this agent switched on? One here, or name@computer as its computer reports it.
  isOn(name) {
    const a = this.agents.get(name)
    if (a) return !a.off
    return Boolean((this.directory?.() ?? []).find((x) => x.name === name)?.on)
  }

  // ---- stalled tasks: in progress, and nobody on them --------------------------------------------------
  // A task can sit In progress while its agent does nothing: its turn ended on "I'll take the screenshots once it
  // settles", or the conversation moved on, and nothing calls it back. Once the agent on it has been idle a while with
  // nothing lined up, nothing it's waiting on and no word on the task, Crew reminds it once: carry on, or say what's in
  // the way. If it stops again without finishing, its last reply asked you something, or no conversation is on the task
  // any more, it's yours to look at: one line in the chat and a notification.

  checkStalls(now = Date.now()) {
    const after = Number(this.config.stallMinutes ?? STALL_MINUTES) * 60000
    if (!(after > 0)) return
    for (const t of this.tickets.open()) {
      if (t.status !== 'fixing' || !t.fixer || t.fixer.includes('@')) continue // a task an agent elsewhere works on: its computer can't tell this one
      const base = this.agents.get(t.fixer)
      if (!base || base.off || base.moving) continue
      const family = [base, ...this.clonesOf(base)]
      if (family.some((x) => x.inbox.some((m) => m.ticket === t.id))) continue // lined up, not started yet
      const word = lastWord(t)
      let s = this.stalls.get(t.id) ?? (t.stalled ? { at: t.stalled, told: true } : null) // you were told before a restart
      if (s && word >= s.at) {
        // a note, a status change: someone's on it again, so the next stall starts from scratch
        this.stalls.delete(t.id)
        delete t.stalled
        s = null
      }
      if (s?.told) continue
      const w = family.find((x) => this.convos[x.name]?.ticket === t.id)
      if (!w) {
        if (family.some((x) => x.status !== 'idle') || now - Math.max(word, base.since) < after) continue
        this.tellStalled(t, base, `isn't on #${t.id} any more, but it's still in progress. Start it again or move it`)
        continue
      }
      if (w.status !== 'idle' || !this.runner.running(w.name) || w.retrying || w.freshPending || w.relaunch || this.owed(w)) continue
      const idle = now - Math.max(w.since, word)
      if (idle < after * (w.background ? 3 : 1)) continue
      const mins = Math.round(idle / 60000)
      const last = this.feed.findLast((e) => e.kind === 'reply' && e.from === w.name)
      if (s) {
        if (w.since >= s.at) this.tellStalled(t, w, `stopped on #${t.id} again without finishing it. Have a look`)
      } else if (last && last.ts >= word && /\?\s*$/.test(last.text)) this.tellStalled(t, w, `asked you something about #${t.id} ${mins} min ago and is waiting for your answer`)
      else this.remind(t, w, mins)
    }
  }

  remind(t, w, mins) {
    this.stalls.set(t.id, { at: Date.now() })
    this.post({ kind: 'event', from: w.name, text: `stopped on #${t.id} ${mins} min ago without finishing it, so Crew reminded it` })
    const handed = this.feed.findLast((e) => e.kind === 'msg' && e.ticket === t.id) // its reply threads to the task
    const text = `[crew] Task #${t.id} "${t.title}" is still in progress, and your turn ended ${mins} min ago without finishing it. If it's done, run: crew task done ${t.id} "what you did, how you checked". If something is in the way (an answer, a decision, access), say what with crew task note ${t.id} "…" and stop. Otherwise carry on with it now.`
    this.queue(w, crewPrompt(w, text, handed?.id))
    this.pump(w)
  }

  tellStalled(t, a, text) {
    this.stalls.set(t.id, { at: Date.now(), told: true })
    t.stalled = Date.now()
    this.tickets.save()
    this.post({ kind: 'event', from: a.name, text, alert: true })
    this.emit('notice', { title: `#${t.id} has stalled`, body: `@${a.name} ${text}`, focus: `task:${t.id}` })
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
    const withId = ['show', 'done', 'note', 'triage', 'dup', 'decline'].includes(op)
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
        const owner = flags.owner ? this.taskOwner(flags.owner, by) : null
        const n = this.tickets.add({ title: words[0], body: flags.details ?? words.slice(1).join(' '), by, owner, severity: priorityOf(flags.priority), kind: flags.kind ?? 'task' })
        this.postTask(n, from, 'filed')
        return `added #${n.id}\n`
      }
      case 'triage': {
        const owner = flags.owner ? this.taskOwner(flags.owner, by, t) : undefined
        this.tickets.edit(t.id, { owner, severity: flags.priority, kind: flags.kind, title: flags.title, body: flags.details, triaged: true }, by)
        this.postTask(t, from, 'triaged', t.owner)
        if (this.space.autofix && t.status === 'new' && t.owner) this.autoDispatch(t)
        return `#${t.id}: ${t.kind}, ${t.owner ? `for @${t.owner}` : 'unassigned'}${this.space.autofix && t.owner ? ', sent to them' : ''}\n`
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
      case 'decline':
        if (!text) throw new Error(`usage: crew task decline ${ref} "why it isn't yours"`)
        return this.decline(t, by, text)
      case 'dup': {
        const original = this.tickets.dup(t.id, words[1], by)
        this.postTask(t, from, 'dup', `#${original.id}`)
        return `#${t.id} is #${original.id} (seen ${original.seen}x now)\n`
      }
      default:
        return TASK_HELP
    }
  }

  // `crew task decline <n> "why"`: its owner can't or shouldn't do it. A task never sits with an owner that said no: it
  // goes straight to the next agent whose area it matches (never back to one that declined it), and on to it in a new
  // conversation if it was under way or Auto-start is on. With no one left, it goes back to To do, unassigned, and
  // you hear about it.
  decline(t, by, why) {
    if (t.status === 'done' || t.status === 'check') throw new Error(`#${t.id} is ${t.status === 'done' ? 'closed' : 'waiting for review'} already`)
    if (by !== t.owner && by !== t.fixer) throw new Error(`#${t.id} is ${t.owner ? `@${t.owner}'s` : 'nobody\'s yet'}: only its owner can decline it`)
    t.declined = [...new Set([...(t.declined ?? []), by])]
    this.tickets.note(t.id, by, `declined: ${why}`)
    const next = ownerFor(`${t.title} ${t.body}`, this.teammates().filter((a) => !t.declined.includes(this.baseOf(a.name))))
    const started = t.status === 'fixing'
    if (started) this.tickets.move(t.id, 'new', 'crew', `back to To do: @${by} declined it`)
    this.tickets.edit(t.id, { owner: next?.name ?? '' }, 'crew')
    this.ruling('decline', by, next?.name ?? null, { ticket: t.id, title: t.title, text: why })
    if (!next) {
      this.emit('notice', { title: `#${t.id} needs an owner`, body: `@${by} declined it: ${why}`, focus: `task:${t.id}` })
      return `#${t.id} is back on To do, for the user to give to someone\n`
    }
    if (started || this.space.autofix) this.autoDispatch(t)
    return `#${t.id} went to @${next.name}${started || this.space.autofix ? ', who starts on it now' : ''}\n`
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

  // A bulk action from the board, on many tasks at once (`ids` as this computer numbers them): one write to the board
  // and one line in the chat for all of them ("closed 23 tasks"), not one each. A task it doesn't apply to (closing one
  // that's closed already) is left as it is. op: start, close, move (arg: new, check or done), owner (arg: a name, ''
  // for nobody), priority (arg: urgent, high, medium, low), remove, and clear: every task in Done goes, picked or not.
  async bulk(op, ids, arg) {
    if (op === 'move' && arg === 'done') op = 'close'
    if (op === 'move' && arg === 'fixing') op = 'start'
    if (op === 'move' && arg !== 'new' && arg !== 'check') throw new Error('move them to new, check or done')
    const picked = [].concat(ids ?? []).map((id) => this.tickets.all.find((t) => t.id === Number(String(id).replace(/^#/, '')))).filter(Boolean)
    const open = picked.filter((t) => t.status !== 'done')
    const plural = (n, what = 'task') => `${n} ${what}${n === 1 ? '' : 's'}`
    const changed = []
    let said = ''
    let out = ''
    await this.tickets.batch(async () => {
      switch (op) {
        case 'start':
          // each in a new conversation of its own, as Start does it: only the line in the chat is shared
          for (const t of picked.filter((x) => x.status === 'new' && x.owner)) {
            try {
              await this.dispatch(t.id, { quiet: true })
              changed.push(t)
            } catch (e) {
              out += `#${t.id}: ${e.message}\n`
            }
          }
          said = `started ${plural(changed.length)}, each in a new conversation`
          break
        case 'close':
          changed.push(...open)
          for (const t of open) this.tickets.move(t.id, 'done', 'you', t.status !== 'check' ? 'closed it' : t.kind === 'bug' ? 'checked it: works' : 'accepted it')
          said = `closed ${plural(changed.length)}`
          break
        case 'move':
          changed.push(...(arg === 'new' ? picked.filter((t) => t.status !== 'new') : open.filter((t) => t.status !== 'check')))
          for (const t of changed) this.tickets.move(t.id, arg, 'you', arg === 'check' ? 'marked it done' : 'moved it back to To do')
          said = `moved ${plural(changed.length)} to ${arg === 'check' ? 'Review' : 'To do'}`
          break
        case 'owner': {
          const owner = arg ? this.agentName(arg) : ''
          changed.push(...open.filter((t) => (t.owner ?? '') !== owner))
          for (const t of changed) this.tickets.edit(t.id, { owner }, 'you')
          said = owner ? `gave ${plural(changed.length)} to @${owner}` : `unassigned ${plural(changed.length)}`
          break
        }
        case 'priority': {
          const severity = priorityOf(arg)
          if (!severity) throw new Error('priority is one of: urgent, high, medium, low')
          changed.push(...open.filter((t) => t.severity !== severity))
          for (const t of changed) this.tickets.edit(t.id, { severity }, 'you')
          said = `made ${plural(changed.length)} ${PRIORITY_NAME[severity]} priority`
          break
        }
        case 'remove':
          changed.push(...picked)
          for (const t of picked) this.tickets.remove(t.id)
          said = `deleted ${plural(changed.length)}`
          break
        case 'clear':
          changed.push(...this.tickets.all.filter((t) => t.status === 'done'))
          for (const t of changed) this.tickets.remove(t.id)
          said = `cleared ${plural(changed.length, 'done task')}`
          break
        default:
          throw new Error(`unknown bulk action "${op}"`)
      }
    })
    if (!changed.length) return out || 'nothing to change\n'
    this.post({ kind: 'task', type: 'task', act: 'bulk', from: 'you', text: said, count: changed.length })
    return `${said}\n${out}`
  }

  setTaskSettings({ triage, autofix }) {
    if (triage !== undefined) this.space.triage = triage || undefined
    if (autofix !== undefined) this.space.autofix = Boolean(autofix) || undefined
    this.saveConfig()
  }

  note(from, text) {
    text = String(text ?? '').trim()
    if (!text) throw new Error('nothing to note')
    const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
    fs.appendFileSync(this.at('board.md'), `- **${from}** (${when}): ${text.replace(/\s*\n\s*/g, ' ')}\n`)
    this.post({ kind: 'note', from, text })
    return 'shared with the crew\n'
  }

  board() {
    try {
      return fs.readFileSync(this.at('board.md'), 'utf8').split('\n').slice(-200).join('\n')
    } catch {
      return '(no shared notes yet)\n'
    }
  }

  // Who `crew ask` of `a`'s is holding on for right now. [{ name, since, id, text }]
  waitingOn(a) {
    return [...this.calls.values()].filter((c) => c.from === a.name && c.hold).map((c) => ({ name: this.ownerOf(c), since: c.at, id: c.msg?.id ?? null, text: gist(c.text) }))
  }

  // Who's owed an answer by `a`, and whether they're waiting on it right now. [{ name, since, id, waiting }]
  owes(a) {
    return [...this.calls.values()].filter((c) => this.ownerOf(c) === a.name).map((c) => ({ name: c.from, since: c.at, id: c.msg?.id ?? null, waiting: Boolean(c.hold) }))
  }

  who() {
    if (!this.agents.size) return '(no agents)\n'
    const rows = this.ordered().map((a) => {
      const queue = a.inbox.length ? `, ${a.inbox.length} queued` : ''
      const waits = this.blockedOn(a.name)
      const holds = this.holdsOf(a.name)
      const status = (waits.length ? `waiting on ${waits.map((n) => `@${n}`).join(' ')}` : a.status) + queue + (holds.length ? `, has ${holds.join(', ')}` : '')
      if (a.off) return `${a.name.padEnd(16)} off`
      if (a.cloneOf) return `${a.name.padEnd(16)} ${status.padEnd(20)} ${''.padEnd(22)} a clone of ${a.cloneOf}, on a task of its own`
      const brain = [this.providerOf(a)?.label, a.model, a.effort].filter(Boolean).join(' ')
      const clones = this.maxClones(a) ? ` (clones itself when busy, up to ${this.maxClones(a)})` : ''
      return `${a.name.padEnd(16)} ${status.padEnd(20)} ${brain.padEnd(22)} ${a.area ?? ''}${clones}`
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
    this.saving = this.saving.then(() => fs.promises.appendFile(this.at('feed.jsonl'), JSON.stringify(line) + '\n')).catch(() => {})
  }

  // ---- an agent moving between computers (core/move.js) ---------------------------------------------

  // feed.jsonl, written anew: it only ever grows, but lines leave with an agent that moves away and arrive (older
  // than what's here) with one that moves in. The lines are taken now, so one posted meanwhile lands after them.
  rewriteFeed() {
    const text = this.feed.map((e) => JSON.stringify(e) + '\n').join('')
    this.saving = this.saving.then(() => fs.promises.writeFile(this.at('feed.jsonl'), text)).catch(() => {})
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
    if (this.keepRuntime) this.saveRuntime()
  }

  // ---- outliving Crew: picking agents up again after a restart ----------------------------------------------
  // With the terminal host, quitting Crew leaves the agents' CLIs running. What Crew knew about them (what each is
  // answering, its queue, its clones, questions between them, who holds which file) is saved as it changes, and read
  // back when Crew starts again and finds their terminals still there. Hook events they sent meanwhile were spooled
  // (adapters.js) and replay in order, so a reply finished while Crew was closed still lands in the chat, threaded.

  saveRuntime(now = false) {
    clearTimeout(this.runtimeTimer)
    const write = () => {
      const agents = {}
      for (const a of this.agents.values()) {
        if (a.status === 'off' && !a.inbox.length) continue
        const s = {}
        for (const k of KEEP) if (a[k] !== undefined) s[k] = a[k]
        agents[a.name] = { ...s, inbox: a.inbox, serving: a.serving ?? [], expect: a.expect ?? null, steering: a.steering ? { text: a.steering.text, msgs: a.steering.msgs, at: a.steering.at } : null }
      }
      const calls = [...this.calls.values()].map((c) => ({ ...c, msg: c.msg?.id, to: this.ownerOf(c), hold: null }))
      try {
        fs.writeFileSync(this.at(RUNTIME), JSON.stringify({ at: Date.now(), agents, calls, leases: [...this.leases].filter(([, l]) => this.mine(l, l.name)), held: [...this.held].filter(([, h]) => (h.name === 'you' ? this.ws === DEFAULT : this.mine(h, h.name))) }))
      } catch {}
    }
    if (now) return write()
    this.runtimeTimer = setTimeout(write, 300)
    this.runtimeTimer.unref?.()
  }

  // The terminals that survived, matched with what was saved about them. Returns the names picked up. Any other terminal
  // (its agent was removed or turned off meanwhile, or nothing is known about it) is stopped. Queues of agents whose CLI
  // ended while Crew was closed still go to them once they start again.
  adopt(survivors) {
    const saved = readJSON(this.at(RUNTIME)) ?? {}
    // kept up to date only with the terminal host; otherwise it was written on quit, and read once is enough (a crash
    // later mustn't queue the same messages again)
    if (!this.keepRuntime) fs.rmSync(this.at(RUNTIME), { force: true })
    const states = saved.agents ?? {}
    const live = (m) => (m ? (this.feed.find((e) => e.id === m.id) ?? m) : m) // the same message as the one in the chat
    const alive = new Map(survivors.map((p) => [p.name, p]))
    // clones still at work come back, wearing their original's settings
    for (const [name, s] of Object.entries(states)) {
      const base = s.cloneOf && alive.has(name) && this.agents.get(s.cloneOf)
      if (!base || base.off || this.agents.has(name)) continue
      const c = { name, cloneOf: s.cloneOf, clone: s.clone, status: 'off', since: Date.now(), activity: '', inbox: [], holdUntil: 0, hookAt: 0 }
      this.dress(c, base)
      this.agents.set(name, c)
    }
    const adopted = new Set()
    for (const [name, p] of alive) {
      const a = this.agents.get(name)
      const s = states[name]
      if (!a || a.off || !s || s.run !== p.tag) {
        this.runner.stop(name)
        continue
      }
      for (const k of KEEP) if (s[k] !== undefined) a[k] = s[k]
      a.inbox = (s.inbox ?? []).map(live)
      a.serving = (s.serving ?? []).map(live)
      a.expect = s.expect ? { ...s.expect, msgs: s.expect.msgs.map(live) } : null
      a.steering = s.steering ? { ...s.steering, msgs: s.steering.msgs.map(live) } : null
      Object.assign(a, { subs: new Map(), subPending: [] })
      this.runs.set(p.tag, { name, file: this.at(GROUPS, `${name}.${p.tag}`), pid: p.pid, at: 0 })
      adopted.add(name)
      if (a.status === 'starting') this.readyIn(a)
      if (a.status === 'working' && a.expect) this.awaitPickup(a)
      if (a.retrying) a.retryTimer = setTimeout(() => this.resumeTurn(a), API_RETRY[0])
    }
    for (const [name, s] of Object.entries(states)) {
      if (adopted.has(name) || !s.inbox?.length) continue
      const a = this.agents.get(name) ?? this.agents.get(s.cloneOf)
      if (!a || a.off) continue
      for (const m of s.inbox.map(live)) {
        if (m.to !== a.name && !m.crew) this.amend(m, { to: a.name }) // a clone's, gone: its original takes it
        this.queue(a, m)
      }
    }
    for (const c of saved.calls ?? []) this.calls.set(c.id, { ...c, msg: c.msg ? this.feed.find((e) => e.id === c.msg) : undefined, hold: null })
    for (const [file, l] of saved.leases ?? []) if (adopted.has(l.name)) this.leases.set(file, { ...l, ws: this.ws })
    for (const [k, h] of saved.held ?? []) if (h.name === 'you' || adopted.has(h.name)) this.held.set(k, { ...h, ws: this.ws })
    if (adopted.size) this.post({ kind: 'event', from: 'crew', text: `picked up ${[...adopted].map((n) => `@${n}`).join(' ')} where ${adopted.size === 1 ? 'it was' : 'they were'}: ${adopted.size === 1 ? 'it' : 'they'} kept working while Crew was closed` })
    return adopted
  }

  // What agents' hooks couldn't tell Crew while it was closed, in the order it happened.
  replaySpool() {
    let files = []
    try {
      files = fs.readdirSync(this.at(SPOOL))
    } catch {}
    for (const f of files) {
      const file = this.at(SPOOL, f)
      let text = ''
      try {
        text = fs.readFileSync(file, 'utf8')
        fs.rmSync(file)
      } catch {
        continue
      }
      const name = f.replace(/\.jsonl$/, '')
      if (!this.agents.has(name)) continue
      for (const line of text.split('\n')) {
        let e
        try {
          e = JSON.parse(line)
        } catch {
          continue
        }
        try {
          this.onHook(name, e)
        } catch {}
      }
    }
  }

  snapshot() {
    return {
      parked: this.parked,
      autopilot: this.space.autopilot,
      theme: this.config.theme,
      providers: Object.fromEntries(
        Object.values(this.providers).map((p) => [p.id, { label: p.label, models: p.models, efforts: p.efforts, modelEfforts: p.modelEfforts, missing: p.missing, fastByDefault: p.fastByDefault }]),
      ),
      agents: this.ordered().map((a) => ({
        name: a.name, area: a.area, prompt: a.prompt, images: a.images, provider: this.providerOf(a)?.id ?? a.provider, model: a.model, effort: a.effort, cwd: a.cwd,
        tier: a.tier, fast: this.providerOf(a)?.fastByDefault === undefined ? undefined : a.tier ? a.tier === 'fast' : this.providerOf(a).fastByDefault,
        args: (a.args ?? []).join(' '), avatar: a.avatar, status: this.parked && !a.off && a.status === 'off' ? 'parked' : a.status, since: a.since, activity: a.activity,
        queue: a.inbox.length, yolo: Boolean(a.yolo), pending: Boolean(a.relaunch), on: !a.off, stats: this.statsOf(a), nearLimit: this.nearLimit(this.providerOf(a)?.id),
        // how full, measured against its own context limit when it has one
        convo: this.convos[a.name] ? { ...this.convos[a.name], context: againstLimit(this.convos[a.name].context, a.contextLimit) } : null,
        contextLimit: Number(a.contextLimit) > 0 ? Number(a.contextLimit) : null, onContextLimit: a.onContextLimit === 'notify' ? 'notify' : 'fresh',
        freshPending: Boolean(a.freshPending), ticket: this.convos[a.name]?.ticket ?? null,
        // in a workspace other than the default: one of your shared agents (in other workspaces too), or only this one's
        ...(this.ws !== DEFAULT && !a.cloneOf && { shared: Boolean(a.shared) }),
        // a clone: whose, and its number (gal.2 is clone 2); it looks like its original
        clones: this.maxClones(a), ...(a.cloneOf && { cloneOf: a.cloneOf, clone: a.clone, avatar: { seed: a.avatar?.seed ?? a.cloneOf, ...a.avatar } }),
        // its sub-agents: the running ones, and ones that just finished
        subs: [...(a.subs?.values() ?? [])].filter((x) => !x.ended || Date.now() - x.ended < SUB_LINGER).map(({ id, type, description, started, ended, tools, activity }) => ({ id, type, description, started, ended, tools, activity })),
        // right of way: the teammates its `crew ask` is waiting on right now, and who's owed an answer by it
        waitingOn: this.waitingOn(a), owes: this.owes(a),
        // what it has leased (crew lease): the simulator, a port
        holds: this.holdsOf(a.name),
      })),
      feed: withOpenAsks(this.feed.slice(-200), this.asks),
      reads: this.reads,
      spend: this.spendNow(),
      // each provider's usage limits that haven't reset yet: { claude: { label, at, windows: [{ id, pct, resetsAt, label? }], credits? } }
      // each window with where it's heading at this pace: { projected (percent at its reset), runsOut (ms) }
      usage: Object.fromEntries(Object.keys(this.usage).map((id) => [id, { label: this.providers[id]?.label ?? id, at: this.usage[id].at, windows: this.liveUsage(id).map((w) => ({ ...w, pace: this.pace(id, w) ?? undefined })), ...(this.usage[id].credits && { credits: this.usage[id].credits }) }]).filter(([, u]) => u.windows.length)),
      tasks: {
        tickets: [...this.tickets.open(), ...this.tickets.all.filter((t) => t.status === 'done').sort((x, y) => x.updated - y.updated).slice(-60)],
        triage: this.space.triage ?? null,
        autofix: Boolean(this.space.autofix),
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
// What Claude Code submits by itself when a command or sub-agent the agent ran in the background finishes.
const isNotice = (prompt) => /^\s*<task-notification>/.test(String(prompt ?? ''))

// Agents get images as file paths (Claude Code and Codex can both open local images).
const withImages = (text, images) =>
  images?.length ? `${text}\n\nAttached image${images.length > 1 ? 's' : ''} (open to view):\n${images.join('\n')}` : text

// A terminal's text without its escape sequences and spaces: what's on screen, however it was drawn.
const flat = (s) => s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '').replace(/\x1b./g, '').replace(/\s+/g, '')

const hold = (a, ms) => {
  a.holdUntil = Math.max(a.holdUntil, Date.now() + ms)
}

// A prompt from Crew itself, queued like a message (it isn't one: it's not in the chat). See move.js.
const crewPrompt = (a, text, id) => ({ id: id ?? randomUUID().slice(0, 8), ts: Date.now(), kind: 'msg', from: 'you', to: a.name, text, crew: true, queued: true })

// The last time anyone but Crew did something with a task: added it, started it, wrote a note, moved it.
const lastWord = (t) => t.log.findLast((l) => l.by !== 'crew')?.ts ?? t.created

// What `crew lease` calls a thing, however it's written: "iOS  Simulator" and "ios simulator" are one.
const leaseKey = (thing) => String(thing ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60)

// Claude Code runs every command through bin/crew-sh, which writes down its process group (see Hub.sweep). Your own
// prefix, if you have one, still runs after it (unless it's crew-sh itself: Crew started from an agent's terminal).
// Claude Code quotes the prefix, spaces and all, but takes whatever follows its last " -" as options for it, so in a
// folder with " -" in its name there's none, and the agent's process tree alone says what it leaves running. On
// Windows Git Bash runs the commands, and reads C:/ paths best; CREW_BASH is that Git Bash, for bin/crew-sh.cmd. There
// crew-sh is tried once first (prefixWorks): if Git Bash won't run it right, commands run without it instead of failing.
export const shellPrefix = (bin, env = process.env, platform = process.platform, works = prefixWorks) => {
  const win = platform === 'win32'
  const sh = win ? path.win32.join(bin, 'crew-sh').replaceAll('\\', '/') : path.posix.join(bin, 'crew-sh')
  if (sh.includes(' -')) return {}
  const bash = win ? gitBash(env) : null
  if (win && !works(sh, bash)) return {}
  const yours = env.CLAUDE_CODE_SHELL_PREFIX
  const again = yours && /^crew-sh(\.cmd)?$/i.test(path.posix.basename(yours.replaceAll('\\', '/')))
  return { CLAUDE_CODE_SHELL_PREFIX: sh, ...(yours && !again && { CREW_SHELL_PREFIX: yours }), ...(win && { CREW_BASH: bash }) }
}

// Where a message goes in an agent's queue: answers to its questions, then questions for it, then the rest.
const rank = (m) => (m.answers ? 0 : m.ask ? 1 : 2)

// How long a window is (Codex names its own by length: window_120 is two hours); null when unknown, as a spend limit's is.
const windowMs = (w) => ({ five_hour: 5 * 3600000, seven_day: 7 * 864e5 })[w.id] ?? (Number(String(w.id).match(/^window_(\d+)$/)?.[1]) * 60000 || null)

// Where a window is heading, as Side A forecasts it without a weekly rhythm: the share used so far at the pace it has
// gone since the window began, carried on to its reset. The 5-hour window, with readings at least five minutes apart in
// the last RECENT minutes, goes at the pace of those instead: what it's burning right now. -> { projected (percent at the
// reset), runsOut (ms, when it reaches 100% before the reset, else null) }, or null when it's too early to say.
export function paceOf(w, samples = [], now = Date.now()) {
  const length = windowMs(w)
  if (!length || !(w.resetsAt > now) || !(w.pct > 0)) return null
  const recent = w.id === 'five_hour' ? samples.filter(([t]) => now - t <= RECENT) : []
  const span = recent.length >= 2 ? recent.at(-1)[0] - recent[0][0] : 0
  const elapsed = now - (w.resetsAt - length)
  if (span < 5 * 60000 && elapsed < length * 0.05) return null
  const rate = span >= 5 * 60000 ? (recent.at(-1)[1] - recent[0][1]) / span : w.pct / elapsed // percent a millisecond
  if (!(rate > 0)) return { projected: w.pct, runsOut: null }
  const runsOut = now + Math.max(0, (100 - w.pct) / rate)
  return { projected: Math.round(w.pct + rate * (w.resetsAt - now)), runsOut: runsOut < w.resetsAt ? Math.round(runsOut) : null }
}

// When a usage window resets, as the chat says it: "at 15:00" today, "Thu at 09:00" later in the week.
const resetsWhen = (ms) => {
  const d = new Date(ms)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === new Date().toDateString() ? `at ${time}` : `${d.toLocaleDateString('en-US', { weekday: 'short' })} at ${time}`
}

// A message in one line, for quoting it back: code blocks folded, cut at `max`.
const gist = (text, max = 100) => {
  const line = String(text ?? '').replace(/```[\s\S]*?```/g, '[code]').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// The files a tool call is about to write: Claude Code's file tools name one, and Codex's apply_patch lists them in the
// patch (in whichever field its input carries it). -> Map of lease key (see fileKey) -> the file's absolute path
function editedFiles({ tool_name: tool = '', tool_input: input } = {}, cwd) {
  if (!input || typeof input !== 'object') return new Map()
  const named = input.file_path ?? input.notebook_path
  const strings = Object.values(input).flatMap((v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []))
  // a patch counts when it's apply_patch's own input, or a shell command that runs apply_patch (not a `crew ask` that
  // quotes one, say)
  const patch = tool === 'apply_patch' || strings.some((x) => /(^|[\s;&|(])apply_patch\b/.test(x) && !/^\s*crew\s/.test(x))
  const patched = (x) => [...x.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)].map((m) => m[1].trim())
  const paths = typeof named === 'string' ? [named] : patch ? strings.flatMap(patched) : []
  return new Map(paths.filter(Boolean).map((p) => filePath(p, cwd)).map((file) => [fileKey(file), file]))
}

// A file an agent names, as an absolute path, however it wrote it. On Windows that can be C:\Users\me\app\x.js,
// C:/Users/me/app/x.js, or Git Bash's /c/Users/me/app/x.js (Claude Code runs its commands in Git Bash there), relative to
// a folder written any of those ways.
export function filePath(file, cwd, platform = process.platform) {
  if (platform !== 'win32') return path.posix.resolve(cwd, file)
  const drive = (p) => String(p).replace(/^\\\\[?.]\\(?=[a-zA-Z]:)/, '').replace(/^\/(?:cygdrive\/)?([a-zA-Z])(?=\/|$)/, '$1:\\')
  return path.win32.resolve(drive(cwd), drive(file)).replace(/^[a-z](?=:)/, (d) => d.toUpperCase())
}

// What a file's lease is held under: its path, and on Windows, where README.md and readme.md are one file, in lower
// case. macOS keeps the case: a case-sensitive volume can have both.
export const fileKey = (file, platform = process.platform) => (platform === 'win32' ? file.toLowerCase() : file)

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function loadFeed(file) {
  let lines
  try {
    lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  } catch {
    return []
  }
  if (lines.length > FEED_KEEP * 2) {
    lines = lines.slice(-FEED_KEEP)
    fs.writeFileSync(file, lines.join('\n') + '\n')
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

const expand = (dir) => (dir ? dir.replace(/^~(?=[\\/]|$)/, os.homedir()) : os.homedir()) // ~/code or, on Windows, ~\code
// What an agent's conversation is tied to: the CLI that keeps it, and the folder it was started in.
const sessionHome = (a) => JSON.stringify([a.provider ?? a.cli ?? 'claude', expand(a.cwd)])

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

// The best agent for an un-addressed task: area match first, then one whose provider isn't close to its usage limit,
// then whoever is free, then the shortest queue. A limit never sends work outside an agent's area: it only decides
// between equally good matches.
// agents: [{ name, area, status, queue, nearLimit }], already narrowed to the ones that can take work.
export function bestFor(text, agents) {
  const score = areaScore(text)
  const free = (a) => Number(a.status === 'idle' && !a.queue)
  const near = (a) => Number(Boolean(a.nearLimit))
  return [...agents].sort((x, y) => score(y) - score(x) || near(x) - near(y) || free(y) - free(x) || x.queue - y.queue)[0]
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

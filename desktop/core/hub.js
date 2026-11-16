// The brain: agents, their status, inboxes, the shared feed and routing. No Electron in here.
import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { SYSTEM_AGENT, SYSTEM_AGENT_CHOICES, systemAgentHello } from './system-agent.js'
import { adapters, ASK_WAIT, RESUME_ASK, TRUST } from './adapters.js'
import { providersFrom, expandEnv, discoverCodex } from './providers.js'
import { generatePrompt, quickAsk } from './promptgen.js'
import { pathKey, resolveCommand, which, withTools } from './launch.js'
import { Tickets, ticketLine, ticketText, fixPrompt, triagePrompt, quickTriagePrompt, readTriage, TASK_HELP, KINDS, priorityOf, PRIORITY_NAME } from './tickets.js'
import { fromStatusLine, fromCodexLog, codexLog, againstLimit, tokens as tokenCount, limitsFrom, codexLimitsFrom, limitName, spentFrom, codexSpent } from './context.js'
import { callResult } from './transcript.js'
import { asksSomething, echoOf, familyOf as familyName, forClients, gistOf, inThread, nothingNew, stampAll, threadDigest, threadFields } from './threads.js'
import { processes, tree, noteworthy, readGroups, readSpans, leftovers, exempt, gitBash, prefixWorks, stop as stopProcesses, summary } from './procs.js'
import { Config } from './config.js'
import { HOME, movedPath, movedImages } from './home.js'
import { ROOT, GENERAL, channelName, dirOf, space, forget, renameShared, sharedNames, settle } from './workspaces.js'
import { keepFeed, keepLines, lineSize, rewriteAt, replaceFile, replaceFileAsync, BOARD_KEEP, BOARD_MAX } from './keep.js'
import { CANVAS_HELP, CANVAS_LINES, asCanvas, canvasLines, canvasTitle, typedLines, withCanvas } from './canvas.js'
import { saversFrom, modeOf, Ledger, RESTART, writePrice, HOUR } from './savers.js'

export { HOME } // ~/.clique (core/home.js)
export const CONFIG = path.join(HOME, 'config.json')
export const ATTACHMENTS = path.join(HOME, 'attachments')
const localDay = (t = Date.now()) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
// Files about you or this computer. A workspace's own files are in its folder (Hub.at).
const at = (file) => path.join(HOME, file)
// Where each agent's CLI writes down the process groups of the commands it runs, a file per launch (core/procs.js), in
// its workspace's folder.
const GROUPS = path.join('run', 'groups')
// How often an agent's process tree is looked at for groups bin/clique-sh doesn't see (Codex, the CLI's own children).
const TREE_CHECK = 15000
// Hook events an agent's CLI couldn't deliver while CLIque was closed (adapters.js), replayed when it's back. In the
// agent's workspace's folder.
const SPOOL = 'spool'
// What CLIque remembers of each agent at work, so it can pick them up after a restart while their terminals carried on in
// the terminal host (core/ptyhost.js): saved as things change, read back by adopt(). In the workspace's folder.
const RUNTIME = 'runtime.json'
// How far back the first look through the agents' logs goes for what their work cost (Hub.lookBack, core/backfill.js).
const LOOK_BACK_DAYS = 30
const KEEP = ['run', 'status', 'since', 'sessionId', 'transcript', 'current', 'replyDue', 'turnStart', 'background', 'activity', 'readyAfter', 'resumed',
  'freshPending', 'freshWhy', 'freshLimit', 'freshFor', 'wrapUp', 'wrapFor', 'wrapNote', 'relaunch', 'promptAt', 'retrying', 'apiRetries', 'cloneOf', 'clone', 'checks',
  'trustAsk', 'trustAt', 'halted']

const DEFAULTS = { autopilot: true, theme: 'system', hotkey: 'Alt+Shift+Space', agents: [] }
// An image saved with this computer's attachments, whichever workspace it's for. -> where
export function saveImage(name, type, bytes) {
  const ext = Object.hasOwn(IMAGE_TYPES, type) && IMAGE_TYPES[type]
  if (!ext) throw new Error('only PNG, JPEG, GIF and WebP images')
  if (bytes.length > 20 * 1024 * 1024) throw new Error(`${name || 'image'} is over 20 MB`)
  fs.mkdirSync(ATTACHMENTS, { recursive: true })
  const file = path.join(ATTACHMENTS, `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.${ext}`)
  fs.writeFileSync(file, Buffer.from(bytes))
  return file
}

// config.json, for every workspace's hub to share. A file from before today's layout (core/workspaces.js settle) is
// copied once as it was, and reads in today's: the first save writes it.
const BEFORE = at('config.before-layout-2.json')
export const openConfig = (also) => new Config(CONFIG, DEFAULTS, {
  settle: (data) => {
    if (settle(data, { hadFiles: fs.existsSync(at('feed.jsonl')) }) && !fs.existsSync(BEFORE)) {
      try {
        fs.copyFileSync(CONFIG, BEFORE)
      } catch {}
    }
    also?.(data)
  },
})
const AGENT_KEYS = ['system', 'area', 'prompt', 'images', 'provider', 'cli', 'model', 'effort', 'tier', 'cwd', 'args', 'yolo', 'off', 'avatar', 'contextLimit', 'onContextLimit', 'clones', 'shared']
const RESERVED = new Set(['you', 'any', 'clique', 'crew']) // (crew: what the app called itself in chats before its rename)
// an unquoted # starts a comment in the shell, and `clique post` is all that arrives
const POST_USAGE = 'usage: clique post <channel> "message" (the name alone: an unquoted # starts a shell comment)'
const SUB_TOOLS = new Set(['Agent', 'Task']) // Claude Code's sub-agent tool ("Task" in older versions)
const SUB_LINGER = 6000 // a finished sub-agent stays in the live view this long
// A clone with nothing to do waits this long before it goes away, in case a teammate's answer is on its way.
const CLONE_LINGER = 5 * 60000
export const MAX_CLONES = 5
// An idle CLI draws nothing; one still starting up or finishing a turn (a hook's spinner) keeps drawing. A message
// waits for this much quiet before it's typed, but never longer than SETTLE_MAX.
const SETTLE_QUIET = 700
const SETTLE_MAX = 20000
// Enter again until the CLI reports the prompt, then call for help: about three minutes in all.
const PICKUP_WAITS = [2500, 3000, 5000, 10000, 20000, 30000, 60000, 60000]
// How long `clique ask` holds on for the answer before the asker carries on (the answer then comes as a message).
// Under Claude Code's two minutes for a shell command, so the command ends on its own terms.
export const ASK_HOLD = 100000
// A file an agent edits is its own until its turn ends. One it hasn't touched for this long is free again, in case
// a turn's end went unreported.
const LEASE_STALE = 30 * 60000
// A turn an API error cut short: the errors that pass, which CLIque answers with "continue", and how long it waits
// before each try. After the last one it calls you.
const PASSING_ERRORS = new Set(['server_error', 'overloaded', 'unknown', 'max_output_tokens'])
const API_RETRY = [20000, 60000, 180000]
// How often an open question looks at its agent's transcript, in case Claude Code settled it by itself (see watchAsk).
const ASK_CHECK = 5000
// Answering a trust question from the chat (Hub.pickTrust): not before this long after it asked, a look at its screen
// this long after it last drew, again after PICK_WAIT if it doesn't, and at most PICK_KEYS arrow keys.
const TRUST_SETTLE = 1500
const PICK_SETTLE = 300 // (Claude Code ignores keys for 150 ms after it draws)
const PICK_WAIT = 1000
const PICK_KEYS = 4
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
const WRAP_UP = "[clique] Your conversation passed its context limit, so a new one starts after this reply. If your task isn't finished, write down where it stands for your next conversation: the worktree and branch, what's done, what's left, and anything you had running. Under 80 words. If it's all finished, reply with just: done"
// A task in progress counts as stalled once the agent on it has been idle this long (stallMinutes in config.json, 0 for
// never) with no word on the task. Three times as long when it left something running in the background, which calls
// it back when it's done. Looked at once a minute.
const STALL_MINUTES = 10
// boardNew: a conversation's first `clique board` shows this many of the newest notes, and a note is kept to this many
// characters (one decision, interface or gotcha).
const BOARD_FIRST = 20
const NOTE_MAX = 800
const STALL_CHECK = 60000
// An agent with nothing to do gives up its terminal after this long (restMinutes in config.json, 0 to keep them up).
// That costs no tokens: a resumed conversation reads the cache as the running one would have (measured 2026-11-06 on
// Claude Code 2.1.319 and Codex 0.166, across rests, new commits, new teammates and edited instructions files).
const REST_MINUTES = 10
// What a CLI itself keeps going once it has taken a prompt: it goes when the CLI goes (see leftRunning).
const HELPER = /^(caffeinate|codex-code-mode-host|conhost|OpenConsole)(\.exe)?$/i
// A CLI that doesn't say when it's up (Codex) but hasn't drawn anything yet is given this long before it counts as ready
// anyway: what's typed before its trust question shows answers that question.
const READY_MAX = 30000
// Stop (Hub.interrupt): the key that ends a turn in Claude Code and in Codex, and how CLIque makes sure it did. A CLI at
// work keeps drawing (its spinner, several times a second); one that stopped falls silent. So a turn counts as stopped
// once its terminal has been quiet for STOP_QUIET, no sooner than STOP_SETTLE after the key (Claude Code redraws its
// prompt box about a second after it's interrupted), or at once when the CLI says so itself (Codex's Interrupt hook).
// Still drawing STOP_AGAIN after the key: it's pressed again, up to STOP_PRESSES times in all.
const ESC = '\x1b'
const CTRL_C = '\x03'
const STOP_TICK = 300
const STOP_SETTLE = 1200
const STOP_QUIET = 700
const STOP_AGAIN = 2500
const STOP_PRESSES = 3
// Claude Code quits on a second Ctrl+C within a moment of the first: CLIque never sends two this close together, nor one
// right after you typed in its terminal.
const CLEAR_APART = 5000
const STOP_WORDS = new Set(
  'a an and are as at be but by can could do for from has have if in into is it me my no not of on or our please should so that the this to up us we with would you your'.split(' '),
)

// One workspace's clique (core/workspaces.js): its agents as they work there, its chat, notes and tasks. CLIque runs one
// per workspace, all on the one config.json (config) and local server (token).
export class Hub extends EventEmitter {
  agents = new Map() // name -> agent; clones too (iris.2), with cloneOf: 'iris'
  pinned = new WeakSet() // messages that only one particular clone (or the original) should take
  url = null
  parked = false // started, but its agents only run once it's opened (see start)
  carryOn = new Set() // renamed while running: starts again under the new name even here parked (see renameAgent)

  // config, token, usage, samples, locks: what every workspace's hub shares (one of each of its own when it's the only
  // hub).
  constructor(runner, { bin, workspace = ROOT, config, token, usage, samples, locks }) {
    super()
    this.ws = workspace
    this.dir = dirOf(HOME, workspace)
    fs.mkdirSync(ATTACHMENTS, { recursive: true })
    fs.mkdirSync(this.at(GROUPS), { recursive: true })
    this.bin = bin
    this.token = token ?? randomBytes(16).toString('hex')
    this.sessions = readJSON(this.at('sessions.json')) ?? {}
    this.stats = readJSON(this.at('stats.json')) ?? {}
    // The chat (core/keep.js says how much of it is kept). feedFile: how much feed.jsonl holds, amendments included,
    // and when it's written anew (see save); sizes: each line's length there, worked out once.
    const { feed, lines, bytes } = loadFeed(this.at('feed.jsonl'), runtimeIds(readJSON(this.at(RUNTIME))))
    this.feed = feed
    this.sizes = new WeakMap()
    this.feedFile = { lines, bytes, at: rewriteAt(feed.length, feed.reduce((n, e) => n + this.sizeOf(e), 0)) }
    this.asks = new Map() // feed id of an open question -> { resolve, name, cli, input }
    // Right of way (see question): what each `clique ask` is still owed, and which agent edits which file.
    this.calls = new Map() // id (the question's feed id) -> { id, msg, from, to, parent, at, hold, remote }
    this.openThreads = new Map() // thread id -> when something was last said in it, until it goes quiet (threadTick)
    // A file, or a simulator, is one thing whichever workspace's agent uses it: every workspace's hub shares these, and
    // each entry says whose workspace (ws) its holder works in (see hubOf).
    this.locks = locks ?? { files: new Map(), held: new Map(), waits: [] }
    this.leases = this.locks.files // absolute path (see fileKey) -> { name, ws, at }
    this.held = this.locks.held // a thing only one agent can use at a time (clique lease), lowercased -> { thing, name, ws, why, at }
    this.leaseWaits = this.locks.waits // `clique lease`s waiting for a thing someone else has: { key, from, ws, thing, why, resolve }
    this.runs = new Map() // launch id -> { name, file, pid, at }: each CLI process and the file of groups it started
    this.turnedAway = new Set() // "who:file" told this turn that a file is taken, so the chat says it once
    this.saving = Promise.resolve() // feed.jsonl appends, one after another (an answer must land after its card)
    this.tickets = new Tickets(this.at('tickets.json'))
    this.stalls = new Map() // task id -> { at, told }: CLIque reminded its agent at `at`, or (told) called you
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
    // What the token savers did, and spend under each mix of them that was on (core/savers.js).
    this.ledger = new Ledger(this.at('savers.json'))
    this.fellBack = new Set() // tasks quick triage handed to the triage agent after all
    this.useRunner(runner)
    // the only hub (no CLIque around it): its config.json has this workspace, and what's wrong with the file is said here
    this.cfg = config ?? openConfig((data) => {
      if (space(data, workspace)) return
      data.workspaces = [{ id: workspace, name: 'Workspace', members: {} }, ...(Array.isArray(data.workspaces) ? data.workspaces : [])]
    })
    this.onConfig = () => this.apply()
    this.onProblem = (text) => this.post({ kind: 'event', from: 'clique', text })
    this.cfg.on('change', this.onConfig)
    if (!config) this.cfg.on('problem', this.onProblem)
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
    clearInterval(this.threadTimer)
    if (this.statsTimer) this.saveStats()
    if (this.ticketsTimer) this.tickets.save()
    this.saveConvos(true)
    this.saveSpend(true)
    this.ledger.save(true)
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

  // Which token savers are on (core/savers.js): config.json's `savers`, or CLIQUE_SAVERS for a benchmark run.
  get savers() {
    return saversFrom(this.config)
  }

  // The terminals: in this process (core/runner.js), or in the terminal host, where they outlive CLIque (core/ptyclient.js).
  useRunner(runner) {
    this.runner = runner
    runner.on('exit', (name, code, ms) => this.onExit(name, code, ms))
    runner.on('data', (name, data) => this.onOutput(name, data))
    runner.on('ended', (name, run) => this.sweep(run))
  }

  // survivors: terminals still running from before CLIque restarted ([{ name, tag, pid }], from the terminal host). Their
  // agents carry on where they are. The rest are resting: no terminal until there's work for them (see pump), and what
  // was still queued for them wakes them now. A parked workspace's wait until it's opened.
  start(url, { survivors = [] } = {}) {
    this.url = url
    const park = (this.parked = this.space.parked)
    this.startedAt = Date.now()
    // where agents' hooks and `clique` find CLIque: every workspace's, told apart by the X-Clique-Workspace header
    fs.writeFileSync(at('url'), url)
    fs.writeFileSync(at('token'), this.token)
    fs.chmodSync(at('token'), 0o600)
    this.keepRuntime = Boolean(this.runner.survivors)
    const adopted = this.adopt(survivors)
    this.replaySpool()
    this.sweepStale()
    if (!park) {
      for (const a of [...this.agents.values()]) {
        if (a.off || adopted.has(a.name)) continue
        if (a.cloneOf) this.dismiss(a.name) // its terminal wasn't the one CLIque knew: what it had goes back to its original
        else this.standBy(a)
      }
    }
    this.toolsLost()
    for (const name of adopted) {
      const a = this.agents.get(name)
      if (a?.status === 'idle') this.pump(a)
      if (a?.status === 'working') this.steer(a)
    }
    this.cfg.watch()
    this.resumeThreads()
    this.greet()
    this.stallTimer = setInterval(() => {
      this.checkStalls()
      this.restIdle().catch(() => {})
    }, STALL_CHECK)
    this.stallTimer.unref?.()
    this.threadTimer = setInterval(() => this.threadTick(), THREAD_LOOK)
    this.threadTimer.unref?.()
    // the agents' logs don't say which workspace they worked in: one workspace counts what came before (the first to
    // start on a computer where none has yet)
    if (!this.spend.lookedBack && !this.others().some((h) => h.spend.lookedBack || h.lookingBack)) {
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
    this.space = space(this.config, this.ws) ?? space({ workspaces: [{ id: this.ws, of: 'gone' }] }, this.ws) // no agents once it's gone from config.json
    const list = this.space.agents
    for (const c of list) if (c.system) this.dressSystemAgent(c)
    const names = new Set(list.map((c) => c.name))
    for (const [name, a] of this.agents) {
      if (a.cloneOf || names.has(name)) continue // clones follow their original, below
      this.forgetAsks(name, { gone: true })
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
      } else if (!a.off && a.status === 'off' && this.url && (!this.parked || this.carryOn.has(a.name))) {
        // on again, or new: it rests until there's work for it. One renamed while it ran carries on under its new name.
        if (this.carryOn.delete(a.name)) this.launch(a)
        else this.standBy(a)
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
    // busyCheck switched on or off: what a running agent checks before building is in its system prompt, so it starts
    // again with the new one once it's free. A teammate coming or going doesn't count (a lone agent's 'none' and 'busy'):
    // that would rewrite its whole cache for one line, so it waits for its next launch.
    for (const a of this.agents.values()) if (a.checks && this.runner.running(a.name) && (a.checks === 'full') !== (this.checksFor(a) === 'full')) this.relaunchWhenFree(a)
    // parked or opened in config.json, from the app or by hand
    if (this.url && this.space.parked !== this.parked) this.space.parked ? this.park() : this.unpark()
    this.changed()
  }

  // Opened: its agents that are on rest, and each picks up its conversation once there's work for it. What waited for
  // them while it was parked wakes them now.
  unpark() {
    if (!this.parked) return
    this.parked = false
    this.greet()
    for (const a of [...this.agents.values()].filter((x) => !x.off && !x.cloneOf && !this.runner.running(x.name))) {
      this.standBy(a)
      this.startWaiting(a)
    }
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
    const stopping = running.filter((a) => a.status !== 'resting')
    for (const a of running) {
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
    if (stopping.length) this.post({ kind: 'event', from: 'clique', text: `went to sleep: ${atNames(stopping.map((a) => a.name))} stopped, and pick up their conversations when it wakes` })
    this.changed()
  }

  // How this workspace is doing, for the switcher: its agents, who's at work or waiting on you, the replies you haven't
  // read (as its chat counts them), and a few faces.
  // An agent counts as working while it or any of its clones does; each one waiting on you counts.
  summary() {
    const all = this.ordered().filter((a) => !a.cloneOf)
    const agents = all.filter((a) => !a.system) // who you've put here: every workspace has Q
    const live = all.filter((a) => !a.off && (!this.parked || this.runner.running(a.name)))
    // an agent tool's card still up needs you, even once its agent has carried on with other work
    const carded = new Set([...this.asks.values()].filter((q) => q.plan).map((q) => q.name))
    const needs = (x) => x.status === 'waiting' || carded.has(x.name)
    return {
      agents: agents.length,
      on: agents.filter((a) => !a.off).length,
      working: live.filter((a) => [a, ...this.clonesOf(a)].some((x) => x.status === 'working')).length,
      waiting: live.flatMap((a) => [a, ...this.clonesOf(a)]).filter(needs).length,
      unread: forClients(this.feed).filter((e) => e.kind === 'reply' && e.from !== 'you' && !inThread(e) && e.ts > this.readTo(e)).length,
      faces: agents.filter((a) => !a.off).slice(0, 4).map((a) => ({ name: a.name, avatar: a.avatar, status: this.parked ? 'parked' : a.status })),
      // who's waiting on you there, so another workspace can say so
      needs: live.flatMap((a) => [a, ...this.clonesOf(a)]).filter(needs).slice(0, 4).map((x) => ({ name: x.name, avatar: x.avatar ?? (x.cloneOf && this.agents.get(x.cloneOf)?.avatar), activity: x.activity })),
    }
  }

  saveConfig() {
    this.cfg.save()
  }

  // ---- Q, the system agent (core/system-agent.js) ------------------------------------------------------------------

  // His folder and, the first time, his brain: what the clique here runs on, or else whichever CLI this computer has. On
  // the first he picks, a mid-size model at low effort: he talks and hands on, and he's the one you wait for each time.
  dressSystemAgent(c) {
    c.cwd = this.at(SYSTEM_AGENT)
    try {
      fs.mkdirSync(c.cwd, { recursive: true })
    } catch {
      c.cwd = os.tmpdir() // something else has that name there: an empty folder is all he needs
    }
    c.args = this.systemAgentFlags(c)
    const mine = this.space.def(c.name)
    if (mine.name !== c.name) {
      mine.name = c.name
      // new under this name: anything kept here for an agent that had it before him isn't his
      if (this.sessions[c.name]) this.saveSession(c.name, null)
      delete this.stats[c.name]
    }
    if (c.provider || c.cli) return
    const ready = (id) => {
      const p = this.providers[id]
      return p && !p.missing?.length && path.isAbsolute(which(p.cli ?? id, process.env[pathKey(process.env)] ?? ''))
    }
    const clique = this.space.agents.filter((a) => !a.system).map((a) => a.provider ?? a.cli ?? 'claude')
    const found = [...clique, 'claude', 'codex'].find(ready)
    const id = found ?? 'claude'
    const brain = { provider: id, ...(id === 'claude' && { model: 'sonnet' }), ...(this.providers[id]?.efforts?.includes('low') && { effort: 'low' }) }
    // (no CLI found yet: nothing's decided, so he looks again next time)
    if (found) for (const [k, v] of Object.entries(brain)) this.space.set(c.name, k, v)
    Object.assign(c, brain, { args: this.systemAgentFlags({ ...c, ...brain }) })
  }

  // On Claude Code he has a shell for `clique` and nothing else: no file tools, no sub-agents, none of your tool servers. So
  // he can't quietly edit something, and every message of his costs less, with far fewer tool definitions to keep in its
  // cache. (Codex has no such switch: there it's his empty folder and his instructions.)
  systemAgentFlags(c) {
    if ((this.providers[c.provider ?? c.cli ?? 'claude']?.cli ?? 'claude') !== 'claude') return []
    return ['--tools', process.platform === 'win32' ? 'Bash,PowerShell' : 'Bash', '--strict-mcp-config']
  }

  systemAgent() {
    return [...this.agents.values()].find((a) => a.system) ?? null
  }

  // Whether what you send without naming anyone should go to him now. Not while he can't take it soon: asking you something
  // in his terminal, stuck starting, or with his account at its limit. Auto picks then, as it does with him off.
  systemAgentReady(now = Date.now()) {
    const a = this.systemAgent()
    if (!a || a.off || a.moving || a.resumeAsk || (a.trustAsk && !a.trustPick)) return false
    if (a.status === 'stopped' || a.status === 'away' || a.status === 'waiting' || a.status === 'off') return false
    if (a.status === 'starting' && now - a.since > SYSTEM_AGENT_START_MAX) return false
    if (a.status === 'resting' && !this.canStart(a)) return false
    return !this.nearLimit(this.providerOf(a)?.id)
  }

  // He can't take what's waiting for him (his CLI won't start, he was turned off, he's stuck): your messages go to whoever
  // Auto would have picked, instead of sitting in his queue while a teammate is free.
  systemAgentHandOver(a) {
    const moved = []
    for (const m of a.inbox.filter((x) => x.from === 'you' && !x.clique)) {
      const to = this.route(m.text, 'you', m.channel)
      if (!to || to === a) continue
      a.inbox.splice(a.inbox.indexOf(m), 1)
      this.amend(m, { to: to.name, auto: true, queued: true })
      moved.push(to.name)
      this.enqueue(to, m)
    }
    if (moved.length) this.post({ kind: 'event', from: a.name, text: `couldn't take what you sent, so it went to ${[...new Set(moved)].map((n) => `@${n}`).join(' ')}` })
  }

  // He says hello once, in a workspace that was going before he came along. It costs no tokens, and it's no news that needs
  // a badge: nothing's running yet. (A new workspace's chat has its welcome, which introduces him.)
  greet() {
    const a = this.systemAgent()
    if (!a || a.off || this.parked || this.space.def(a.name).greeted) return
    const going = this.feed.some((e) => (e.kind === 'msg' || e.kind === 'reply') && e.from !== a.name)
    const said = this.feed.some((e) => e.from === a.name)
    this.space.def(a.name).greeted = true
    try {
      this.cfg.save()
    } catch {
      return // settings that can't be read: nothing to keep it in, so he says it another time
    }
    if (!going || said) return
    const hi = this.post({ kind: 'reply', from: a.name, text: systemAgentHello(!this.space.agents.some((x) => !x.system)) })
    this.read({ [a.name]: hi.ts })
  }

  // The hubs of the other workspaces, for what's kept about a shared agent in each (CLIque sets this).
  others() {
    return []
  }

  // shared: whether the new agent is one of your shared ones, or this workspace's own.
  addAgent({ name, shared, ...fields }) {
    name = this.freeName(name, shared ? (n) => this.agents.has(n) || sharedNames(this.config, n).has(n) : undefined)
    const def = JSON.parse(JSON.stringify({ name, ...clean(fields) }))
    if (!shared) this.space.add(def)
    else {
      // where it works here, and whether it's on, are this workspace's
      const { cwd, off, ...who } = def
      this.space.add(who, { shared: true, member: { ...(cwd && { folder: cwd }), ...(off && { off }) } })
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

  // An agent out of this workspace. Its own is gone for good, and so is what this workspace kept about it. A shared one is
  // still yours, and still in the others.
  // everywhere: a shared agent off the roster and out of every workspace (Agents, or a move that didn't go through,
  // core/move.js).
  removeAgent(name, { everywhere = false } = {}) {
    if (this.agents.get(name)?.system) throw new Error(`${name} comes with every workspace, so it can't be removed. You can turn it off`)
    const kept = everywhere ? this.keptBy(name) : [this]
    if (everywhere) forget(this.config, name)
    else this.space.remove(name)
    for (const h of kept) h.forgetAgent(name)
    this.saveConfig()
  }

  // The workspaces that may have kept something about a shared agent: all but one whose own agent has that name, which is
  // another agent. (Asked before the change: renaming one changes its definition where they read it.)
  keptBy(name) {
    return [this, ...this.others()].filter((h) => h.space.shared(name) || !h.space.has(name))
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
      const sys = this.agents.get(n)?.system
      for (const [k, v] of Object.entries(fields)) if (!sys || SYSTEM_AGENT_CHOICES.has(k)) this.space.set(n, k, v)
      if (sys && 'provider' in fields && !('model' in fields)) this.space.set(n, 'model', undefined) // one brain's model is nothing to another
      if ('provider' in fields) this.space.set(n, 'cli', undefined)
    }
    this.saveConfig()
  }

  // A shared agent's new name is its name in every workspace; one of a workspace's own is renamed there.
  rename(from, to) {
    if (!this.space.has(from)) throw new Error(`no agent named "${from}"`)
    if (this.agents.get(from)?.system) throw new Error(`${from} comes with every workspace, and keeps its name`)
    const shared = this.space.shared(from)
    to = this.freeName(to, shared ? (n) => this.agents.has(n) || sharedNames(this.config, from).has(n) : undefined)
    const kept = shared ? this.keptBy(from) : [this]
    if (shared) renameShared(this.config, from, to)
    else {
      this.space.def(from).name = to
      this.space.renamed(from, to)
      if (this.space.triage === from) this.space.triage = to
    }
    for (const h of kept) h.renameAgent(from, to)
    this.saveConfig() // stops `from`, starts `to` resuming the same conversation
    return to
  }

  // What this workspace keeps about an agent, under its new name: its conversation, experience, the conversation's
  // numbers, and the tasks it owns or is working on.
  renameAgent(from, to) {
    if (this.runner.running(from)) this.carryOn.add(to)
    for (const q of this.asks.values()) if (q.plan && q.name === from) q.name = to // an agent tool's card: its answer finds it
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
    if (!provider) throw new Error(`CLIque doesn't know how to run "${agent.provider}": pick Claude Code or Codex`)
    if (provider.missing.length) throw new Error(`${provider.label} needs ${provider.missing.join(', ')} in your shell environment`)
    const teammates = [...this.agents.values()].filter((a) => a.name !== agent.name && !a.cloneOf).map((a) => `${a.name} (${a.area || 'general'})`).join(', ')
    return generatePrompt(agent, provider, teammates)
  }

  providerOf(a) {
    return this.providers[a.provider ?? a.cli ?? 'claude']
  }

  // You've seen an agent's replies up to `ts` (the chat marks what's been on screen): { name: ts }, or { 'name#channel':
  // ts } for its replies in one channel (#general's are the plain name's). A plain name from a chat that shows every
  // channel at once (a phone) is read in all of them. Names can be agents on other computers (iris@workstation): what
  // you've read is this computer's to remember.
  read(seen) {
    let moved = false
    const raise = (book, name, ts) => {
      if (!(ts > (book[name] ?? 0))) return
      book[name] = ts
      moved = true
    }
    for (const [key, at] of Object.entries(seen ?? {})) {
      const ts = Number(at)
      const [name, channel] = key.split('#')
      if (!name) continue
      if (channel && channel !== GENERAL) raise((this.reads.channels ??= {})[channel] ??= {}, name, ts)
      else raise(this.reads.agents, name, ts)
      if (channel !== undefined) continue
      const everywhere = new Set([...Object.keys(this.reads.channels ?? {}), ...this.feed.map((e) => e.channel).filter(Boolean)])
      for (const ch of everywhere) raise((this.reads.channels ??= {})[ch] ??= {}, name, ts)
    }
    if (!moved) return
    this.saveReads()
    this.changed()
  }

  // Up to when you've read an agent's replies where this one is: its channel's, or #general's.
  readTo(e) {
    const book = e.channel && e.channel !== GENERAL ? this.reads.channels?.[e.channel] : this.reads.agents
    return Math.max(this.reads.since ?? 0, book?.[e.from] ?? 0)
  }

  saveReads() {
    clearTimeout(this.readsTimer)
    this.readsTimer = setTimeout(() => {
      try {
        fs.writeFileSync(this.at('reads.json'), JSON.stringify(this.reads))
      } catch {}
    }, 500)
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
    clearTimeout(a.stopTimer)
    Object.assign(a, { stopping: null, halted: null }) // a new process: nothing of a stopped turn is left to come back
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
    if (!adapter) return fail(`can't start: it's set to run "${a.provider}", which CLIque doesn't know how to run. Pick Claude Code or Codex for it in its settings`)
    if (provider.missing.length) return fail(`${provider.label} needs ${provider.missing.join(', ')} in your shell environment`)
    const resume = this.sessions[a.name]
    const session = randomUUID()
    a.checks = this.checksFor(a) // what it checks before building, as its system prompt says (see apply)
    const { file, args, readyAfter, trust, env: extraEnv } = adapter(a, { resume, session, attachments: ATTACHMENTS, bin: this.bin, checks: a.checks })
    a.sessionId = resume ?? session // the conversation this process runs (see onStatusLine)
    this.stopPick(a, { stale: true })
    Object.assign(a, { readyAfter, trust, trustAsk: false, trustNo: false, boot: '', upAt: 0, resumeAsk: null, promptAt: 0 }) // see onOutput
    a.resumeWatch = resume && RESUME_ASK[provider.cli] ? { ask: RESUME_ASK[provider.cli], screen: '' } : null
    a.resumed = Boolean(resume)
    if (!resume) this.newConvo(a)
    try {
      const cwd = expand(a.cwd)
      if (!fs.existsSync(cwd)) throw new Error(`folder not found: ${cwd}`)
      const run = randomUUID().slice(0, 8)
      const groups = this.at(GROUPS, `${a.name}.${run}`)
      // CLIque's tools first on PATH (on Windows under the name Windows gave PATH, so there's one), and CLIque's own runtime
      // for them (bin/clique.mjs): never ELECTRON_RUN_AS_NODE itself, which would make every Electron app the agent starts
      // run as Node.
      const env = {
        ...expandEnv(provider.env), ...extraEnv, ...withTools(process.env, this.bin), CLIQUE_NODE: process.execPath, CLIQUE_AGENT: a.name, CLIQUE_URL: this.url, CLIQUE_TOKEN: this.token, CLIQUE_HOME: HOME,
        CLIQUE_GROUPS: groups, ...(provider.cli === 'claude' && shellPrefix(this.bin)),
        // which workspace its hooks and `clique` talk to: empty for the default (as for agents started before workspaces),
        // whatever CLIque itself was started with
        CLIQUE_WORKSPACE: this.ws === ROOT ? '' : this.ws, // ROOT's files are in CLIQUE_HOME itself, where its hooks' spool is (core/adapters.js)
      }
      // the program itself on Windows, through the .cmd npm installs it as (core/launch.js)
      const command = resolveCommand(file, [...args, ...(provider.args ?? []), ...(a.args ?? [])], { ...process.env, ...env })
      this.runner.start(a.name, { file: command.file, args: command.args, cwd, env, tag: run })
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
    if (!a.readyAfter) return
    a.readyTimer = setTimeout(() => {
      if (a.status !== 'starting') return
      if (a.trust && !flat(a.boot) && Date.now() - a.launchedAt < READY_MAX) return this.readyIn(a) // nothing on its screen yet
      this.setStatus(a, 'idle')
    }, a.readyAfter)
  }

  // The first time a CLI runs in a folder it asks whether you trust it, YOLO or not, and nothing typed reaches its
  // prompt until that's answered: Codex would take the Enter after the first message as "Trust and continue" and lose
  // the message, and Claude Code doesn't even say it started. So until it's up and has taken its first prompt, CLIque
  // watches its screen for that question and hands it to you, as a card in the chat (trustCard). Messages wait in its
  // queue meanwhile. While it's up the screen is still read: answering from the chat picks by what's selected there.
  onOutput(name, data) {
    const a = this.agents.get(name)
    if (a?.resumeWatch) this.watchResume(a, data)
    if (!a?.trust) return
    a.boot = (a.boot + data).slice(-6000)
    if (a.trustAsk) return a.trustPick && this.pickSoon(a)
    if (!a.trust.ask.test(flat(a.boot))) return
    clearTimeout(a.readyTimer)
    Object.assign(a, { trustAsk: true, trustAt: Date.now() })
    this.trustCard(a)
  }

  // Until it has taken its first prompt, a CLI picking up a conversation can ask whether to (RESUME_ASK). It's about your
  // usage limit, so it's yours to answer: in its terminal, and what's queued waits. A message that went in just before
  // the question showed was lost to it, so it goes back in the queue.
  watchResume(a, data) {
    const watch = a.resumeWatch
    watch.screen = (watch.screen + data).slice(-6000)
    if (a.resumeAsk || !watch.ask.test(flat(watch.screen))) return
    a.resumeAsk = true
    clearTimeout(a.timer)
    if (a.expect) {
      clearTimeout(a.ack)
      this.unbrief(a, a.expect.msgs)
      for (const m of [...a.expect.msgs].reverse()) (a.inbox.unshift(m), (m.queued = true))
      a.expect = null
    }
    const share = flat(watch.screen).match(/about(\d+)%of/)?.[1]
    this.needsYou(a, `asks before resuming its long conversation: it would use ${share ? `about ${share}%` : 'a good part'} of your 5-hour limit. Answer in its terminal: messages wait until then`)
  }

  // Answered in its terminal: on it goes, and what's queued goes in.
  resumeAnswered(a) {
    Object.assign(a, { resumeAsk: null, resumeWatch: null })
    hold(a, 1500)
    this.setStatus(a, a.upAt ? 'idle' : 'starting')
  }

  // Its trust question as a card in the chat, like a permission prompt's: Trust or Don't trust there answers it in
  // its terminal for you (pickTrust), and answering in the terminal itself closes the card.
  trustCard(a) {
    if (a.system) return this.pickTrust(a, true, null) // Q's own empty folder: nothing there to ask you about
    const cli = this.providerOf(a)?.cli ?? 'claude'
    const folder = String(a.cwd ?? '')
    const base = path.basename(expand(folder)) || folder
    const alert = `asks whether to trust its folder, ${folder}. Messages wait until you answer`
    const ask = { type: 'permission', trust: true, title: 'Trust this folder', detail: folder, say: `First time in ${base}. Can I trust this folder?`, always: [], alert }
    const e = this.post({ kind: 'ask', from: a.name, to: 'you', ask, cli })
    this.asks.set(e.id, { name: a.name, cli, input: {}, entry: e, trust: true, resolve() {} })
    this.record(a.name, { waits: 1 })
    this.emit('alert', a, alert)
    this.setStatus(a, 'waiting')
  }

  // Your answer from the chat (or a phone). Trusting it answers the same question from every agent on the same CLI in
  // that folder: it's the folder that's trusted, and they all started before it was.
  answerTrust(id, q, reply) {
    const a = this.agents.get(q.name)
    if (reply.terminal || !a?.trustAsk) return this.settle(id, '', { by: 'terminal', handedOver: true }, true)
    const yes = Boolean(reply.allow)
    const same = yes ? [...this.asks].filter(([, x]) => x.trust && x.name !== q.name && x.cli === q.cli && folderOf(this.agents.get(x.name)) === folderOf(a)) : []
    for (const [other, x] of [[id, q], ...same]) {
      const b = this.agents.get(x.name)
      this.settle(other, '', { by: 'you', allow: yes }, true)
      if (b?.trustAsk) this.pickTrust(b, yes, x.entry)
    }
  }

  // Answering it for you: its selection moves one arrow key at a time, and Enter goes in only once its screen shows
  // your answer selected. (Claude Code redraws the question right after drawing it, back on "No, exit", so keys sent
  // blind can quit it; not before TRUST_SETTLE has passed since it asked, either.) The card says your answer meanwhile;
  // if it can't be picked, the card says what became of it instead, and the question goes back to you in its terminal.
  pickTrust(a, yes, entry) {
    this.stopPick(a)
    a.trustPick = { want: yes ? 'yes' : 'no', keys: 0, due: 0, entry }
    a.trustPick.timer = setTimeout(() => this.stepTrust(a), Math.max(0, (a.trustAt ?? 0) + TRUST_SETTLE - Date.now()))
  }

  // Its screen changed while CLIque is picking: look again once it has settled, but no later than PICK_WAIT after the last
  // key (a CLI can keep drawing for a while: Codex animates its title for half a minute after it starts). Before the
  // first look, TRUST_SETTLE stands.
  pickSoon(a) {
    const p = a.trustPick
    if (!p.due) return
    clearTimeout(p.timer)
    p.timer = setTimeout(() => this.stepTrust(a), Math.max(0, Math.min(PICK_SETTLE, p.due - Date.now())))
  }

  stepTrust(a) {
    const p = a.trustPick
    if (!p) return
    clearTimeout(p.timer)
    if (!a.trustAsk || !this.runner.running(a.name)) return this.stopPick(a, { stale: true })
    const screen = flat(a.boot)
    if (trustSelected(screen, a.trust) === p.want) {
      this.stopPick(a)
      this.runner.write(a.name, '\r')
      return this.trustAnswered(a)
    }
    const key = trustKey(screen, a.trust, p.want)
    if (!key || p.keys >= PICK_KEYS) {
      this.stopPick(a, { by: 'terminal', handedOver: true })
      return this.needsYou(a, `asks whether to trust its folder, and CLIque couldn't answer it for you. Answer in its terminal: messages wait until then`)
    }
    p.keys += 1
    p.due = Date.now() + PICK_WAIT
    this.runner.write(a.name, key)
    p.timer = setTimeout(() => this.stepTrust(a), PICK_WAIT) // in case it doesn't redraw
  }

  // The pick ends: with Enter in (its card already says your answer), or without, and then its card says `answer`.
  stopPick(a, answer) {
    const p = a.trustPick
    if (!p) return
    clearTimeout(p.timer)
    a.trustPick = null
    if (answer && p.entry) this.amend(p.entry, { answer: { ...answer, at: Date.now() } })
  }

  // Enter on its trust question, from its terminal or from the chat: it's starting up now, or quitting if "no" was
  // selected (onExit then knows it wasn't a failed resume). A card still up was answered in the terminal.
  trustAnswered(a) {
    const no = trustSelected(flat(a.boot), a.trust) === 'no'
    Object.assign(a, { trustAsk: false, trustNo: no, boot: '' })
    for (const [id, q] of this.asks) if (q.trust && q.name === a.name) this.settle(id, '', { by: 'terminal' }, true)
    this.setStatus(a, 'starting')
    this.readyIn(a)
  }

  // It exited or was turned off with its question up: the question went with it.
  dropTrust(a) {
    this.stopPick(a, { stale: true })
    a.trustAsk = false
    for (const [id, q] of this.asks) if (q.trust && q.name === a.name) this.settle(id, '', { stale: true }, true)
  }

  restart(name, fresh = false) {
    const a = this.agents.get(name)
    if (a && this.parked && !this.runner.running(name)) throw new Error(`${this.space.name} is asleep: send a message there to wake it`)
    if (a) this.launch(a, fresh)
  }

  // ---- resting: no terminal while there's nothing to do -------------------------------------------------
  // An agent that's on doesn't need its CLI running to be there: a message, a task or a teammate's question starts it
  // (pump) and it picks up its conversation. So nobody starts with the app, and one that has been idle gives its terminal
  // up. Unlike off, resting takes work: you see a free agent.

  // On, with nothing to do yet: it rests. One that couldn't start says why now, as it would have at launch, rather than
  // when the first message finds out.
  standBy(a) {
    if (this.canStart(a)) this.setStatus(a, 'resting')
    else this.launch(a)
  }

  canStart(a) {
    const provider = this.providerOf(a)
    return Boolean(adapters[provider?.cli]) && !provider.missing.length && fs.existsSync(expand(a.cwd))
  }

  // Can Auto give it work? Not one on its way to another computer, nor one resting that couldn't start.
  workable(a) {
    return !a.moving && (a.status !== 'resting' || this.canStart(a))
  }

  // Nothing it's doing, waiting for or looking after would end with its CLI. You typing in its terminal counts as doing.
  mayRest(a, now, after) {
    if (a.cloneOf || a.off || a.moving || a.status !== 'idle' || !this.runner.running(a.name)) return false
    if (a.inbox.length || a.background || a.retrying || a.freshPending || a.relaunch || a.steering || a.expect || a.resumeAsk) return false
    if (this.clonesOf(a).length || [...(a.subs?.values() ?? [])].some((x) => !x.ended)) return false
    if (this.asking(a.name) || this.owed(a) || this.holdsOf(a.name).length) return false
    return now - Math.max(a.since, a.typedAt ?? 0, a.hookAt ?? 0) >= after
  }

  // Each minute: those with nothing to do rest, unless stopping them would end something they started. Without a list of
  // what's running (it couldn't be read) nobody can tell, so nobody rests.
  async restIdle(now = Date.now()) {
    const after = Number(this.config.restMinutes ?? REST_MINUTES) * 60000
    if (!(after > 0) || this.parked) return
    if (![...this.agents.values()].some((a) => this.mayRest(a, now, after))) return
    const procs = await processes({ maxAge: TREE_CHECK / 2 })
    if (!procs.length) return
    for (const a of this.agents.values()) if (this.mayRest(a, now, after) && !this.leftRunning(a, procs)) this.rest(a)
  }

  // Would stopping its CLI end something it started: the dev server it left behind with &, or a command its CLI still
  // holds on to (Codex runs them as its own children, with no shell around them)? So: anything under the CLI that started
  // since its first prompt (give or take the second process times are rounded to), bar its known helpers. What came up
  // before that is its tool servers, and whatever those start. On Windows the CLI itself is under a wrapper that came up
  // before its first prompt too, so everything is looked through. Something else of the CLI's own only keeps the agent up,
  // which does no harm; stopping a dev server would.
  leftRunning(a, procs) {
    const run = this.runs.get(a.run)
    if (!run) return false
    if (this.strays(procs, readGroups(run.file), readSpans(run.file)).length) return true
    if (!a.promptAt) return false
    const since = a.promptAt / 1000 + 1
    const going = (pid) => procs.some((p) => p.ppid === pid && (p.start > since ? !HELPER.test(p.name) || going(p.pid) : process.platform === 'win32' && going(p.pid)))
    return going(run.pid)
  }

  rest(a) {
    const run = this.runs.get(a.run)
    if (run) run.quiet = true
    this.runner.stop(a.name)
    this.setStatus(a, 'resting')
  }

  // ---- clones: one agent on several tasks at once ---------------------------------------------------
  // An agent with `clones: n` doesn't make a message wait while it's busy. A clone takes it: the same agent (its
  // settings, instructions, folder and look) in a terminal and conversation of its own, named iris.2, iris.3… up to
  // n of them. A clone with nothing left to do goes away after CLONE_LINGER, and its work counts as the agent's.

  clones() {
    return [...this.agents.values()].filter((a) => a.cloneOf)
  }

  clonesOf(a) {
    return this.clones().filter((c) => c.cloneOf === a.name).sort((x, y) => x.clone - y.clone)
  }

  // Every agent with its clones right after it.
  ordered() {
    const all = [...this.agents.values()].filter((a) => !a.cloneOf)
    return [...all.filter((a) => a.system), ...all.filter((a) => !a.system)].flatMap((a) => [a, ...this.clonesOf(a)])
  }

  // The agent a name belongs to: a clone's original, or the agent itself. A clone that went away still names its
  // original (iris.2 -> iris), and so does one on another computer (iris.2@laptop -> iris@laptop).
  baseOf(name) {
    const a = this.agents.get(name)
    return a ? (a.cloneOf ?? a.name) : String(name).replace(/\.\d+(?=@|$)/, '')
  }

  maxClones(a) {
    if (a?.system) return 0
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
    for (const t of ['reapTimer', 'timer', 'ack', 'readyTimer', 'steerTimer', 'stopTimer']) clearTimeout(c[t])
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
    const room = family.some((x) => (x.status === 'idle' || x.status === 'resting') && !x.inbox.length) || (this.maxClones(a) > family.length - 1 && this.runner.running(a.name))
    return { name: a.name, area: a.area, status: room ? 'idle' : a.status, queue: room ? 0 : family.reduce((n, x) => n + x.inbox.length, 0), nearLimit: this.nearLimit(this.providerOf(a)?.id) }
  }

  // ---- conversations: starting fresh, and how full the current one is ------------------------------

  // A new conversation for an agent, so a new task doesn't share its context with the last ten. Its
  // instructions, folder and the clique's notes stay; the old conversation stays in the CLI's history.
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
    // parked or resting: the next time it starts, it starts fresh
    if ((this.parked || a.status === 'resting') && !this.runner.running(name)) {
      this.saveSession(name, null)
      this.newConvo(a)
      if (a.status === 'resting') this.post({ kind: 'event', from: name, text: 'starts a new conversation with its next message', fresh: true })
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
    if (carry) a.inbox.unshift(cliquePrompt(a, `[clique] Your last conversation passed its context limit, so this is a new one. You hadn't finished. Where you left off, in your own words:\n\n${carry.text}\n\nCheck where things stand, then carry on.`, carry.for))
  }

  // A new conversation once the agent is free. One you asked for starts right away. One for its context limit
  // can't take the end of a turn on trust: a turn also ends while the agent waits on what it started in the
  // background (a build, a server, a sub-agent), and a restart then drops the task half-way. So CLIque waits for those
  // (or for its next task), asks the agent where things stand, and the new conversation starts from its answer.
  freshWhenDone(a) {
    if (!a.freshLimit || a.wrapNote !== undefined) return this.startFresh(a)
    // you stopped it: it isn't asked where things stand now (that's a turn, and its answer would carry the stopped work
    // into the new conversation by itself). Its next message asks (pump).
    if (a.halted && !a.wrapUp) return this.changed()
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
    a.inbox.unshift({ ...cliquePrompt(a, WRAP_UP), wrapUp: true })
    this.pump(a)
    this.changed()
  }

  // ---- token savers: what the clique does to keep its agents from spending tokens they don't need to (core/savers.js) ----

  // How long this agent's cache lasts after its last request: Claude Code's is an hour on a subscription and 5 minutes on
  // an API key, which its transcript says (the kind of its last cache write). Codex doesn't say: an hour, as it held in
  // real sessions.
  cacheTTL(a) {
    if (this.providerOf(a)?.cli !== 'claude' || !a.transcript?.path) return HOUR
    const tail = tailOf(a.transcript.path)
    const last = (key) => Number([...tail.matchAll(new RegExp(`"${key}":(\\d+)`, 'g'))].at(-1)?.[1] ?? 0)
    return last('ephemeral_5m_input_tokens') > 0 && !last('ephemeral_1h_input_tokens') ? 5 * 60000 : HOUR
  }

  // How cheap an agent is to wake: how big its conversation is, whether its cache is still there, and what its next
  // request costs to read (or, cold, to write) all of it, in input tokens.
  // One with no conversation yet has the whole project to find its way around, as a new conversation does (RESTART).
  warmth(a) {
    const c = this.convos[a.name]
    const used = c?.context?.used ?? 0
    if (!used || !this.sessions[a.name]) return { used: 0, warm: false, wake: RESTART }
    const last = c?.lastAt ?? mtimeOf(a.transcript?.path)
    const ttl = this.cacheTTL(a)
    const warm = Boolean(last) && Date.now() - last < ttl
    return { used, warm, wake: Math.round(used * (warm ? 0.1 : writePrice({ cli: this.providerOf(a)?.cli, ttl }))) }
  }

  // coldStart: the messages that would wake a conversation whose cache has gone cold (what goes in next: peek). { used,
  // idle, recache } when picking it back up (rewriting all of its cache) costs more than starting fresh (RESTART), after
  // an hour or more away; null otherwise. Never when one of them follows on from that conversation (followsOn), nor for
  // a clone (it goes away when it's done), one that moved here with its conversation and hasn't been told yet, or an
  // agent with something still running in the background or a question out.
  coldFor(a, msgs) {
    const c = this.convos[a.name]
    if (a.cloneOf || !this.sessions[a.name] || a.background || a.freshPending || c?.note || msgs.some((m) => this.followsOn(a, m))) return null
    const used = c?.context?.used
    const last = c?.lastAt ?? mtimeOf(a.transcript?.path)
    if (!(used > 0) || !last) return null
    const ttl = this.cacheTTL(a)
    const idle = Date.now() - last
    const recache = Math.round(used * writePrice({ cli: this.providerOf(a)?.cli, ttl }))
    if (idle < Math.max(ttl, HOUR) || recache < RESTART) return null
    if ([...this.calls.values()].some((call) => call.from === a.name)) return null
    return { used, idle, recache }
  }

  // A message that belongs in the conversation it finds: one you sent this agent yourself (in its chat, or by name: Auto's
  // picks don't count), an answer to its question, a teammate's question, CLIque's own prompt, the task it was on sent
  // back, or a reply to something it said there. Those never start a new conversation.
  followsOn(a, m) {
    const c = this.convos[a.name]
    // (what goes to Q wasn't meant for his conversation in particular: he can start afresh like any Auto pick)
    if (m.clique || m.fresh || m.answers || m.ask || (m.from === 'you' && !m.auto && !a.system)) return true
    if (m.ticket !== undefined && m.ticket === c?.ticket) return true
    const re = m.re && this.feed.findLast((e) => e.id === m.re)
    return Boolean(re && re.ts >= (c?.since ?? 0) && (re.from === a.name || re.to === a.name))
  }

  // A new conversation instead of a cold one, and on top of the message, a note of where the last one stood, from what
  // CLIque already has: the task it was on and the last thing it said. Nothing for the agent to write first.
  coldStart(a, { used, idle, recache }) {
    const c = this.convos[a.name]
    const t = typeof c.ticket === 'number' && this.tickets.all.find((x) => x.id === c.ticket)
    const said = this.feed.findLast((e) => e.kind === 'reply' && e.from === a.name && e.ts >= (c.since ?? 0) && !e.empty)
    this.ledger.add('coldStart', true, { n: 1, tokens: recache })
    a.freshFor = a.inbox[0].id
    this.startFresh(a, `: the last one had sat idle ${spanOf(idle)}, and picking it back up would have re-read its ${tokenCount(used)} tokens`)
    this.convoOf(a).note = [
      `[clique] This is a new conversation. Your last one sat idle ${spanOf(idle)}, so CLIque started fresh rather than have you re-read all of it.`,
      t && `You were on #${t.id} "${t.title}".`,
      said && `The last thing you said in it: "${gist(said.text, 400)}"`,
    ].filter(Boolean).join(' ')
    this.saveConvos()
  }

  // What the agent is told to check before it builds something (adapters.js): the board, PRs and branches, as before;
  // with busyCheck on, clique busy, or nothing at all when it works alone (no teammate in this workspace, no clones of its
  // own, no linked computer's). Decided at launch: it's in the system prompt, and a new one rewrites the whole cache.
  checksFor(a) {
    if (a.system) return 'none' // he doesn't build anything
    if (!this.savers.busyCheck) return 'full'
    const base = (a.cloneOf && this.agents.get(a.cloneOf)) || a
    const alone = !a.cloneOf && !this.maxClones(base) && ![...this.agents.values()].some((x) => !x.cloneOf && !x.system && x.name !== base.name) && !(this.directory?.() ?? []).some((x) => !x.system)
    return alone ? 'none' : 'busy'
  }

  // Auto's pick among `lineups` (lineup(), with warmth() for agents here). With warmRoute on, a tie on area, limits, being
  // free and queue goes to the agent that's cheaper to wake. Either way the ledger hears when that changes the pick.
  pick(text, lineups) {
    const on = this.savers.warmRoute
    const plain = bestFor(text, lineups)
    const warm = bestFor(text, lineups, { warm: true })
    if (plain && warm && plain.name !== warm.name) this.ledger.add('warmRoute', on, { n: 1, tokens: Math.max(0, (plain.wake ?? 0) - (warm.wake ?? 0)) })
    return on ? warm : plain
  }

  // quickTriage: a new task triaged in one short call to the triage agent's provider, on its small model, with the open
  // tasks and the clique written into the prompt (tickets.js), instead of a turn in the triage agent's own long
  // conversation. What it decides goes through `clique task triage` or `clique task dup`, as the agent's would. If the call
  // fails or what it says doesn't hold (an owner who's off, a task that isn't there), the triage agent gets it as before.
  async quickTriage(t, name) {
    const a = this.agents.get(name)
    let r = null
    try {
      r = await this.oneShot(this.providerOf(a), { prompt: quickTriagePrompt(t, this.tickets.open().filter((x) => x.id !== t.id), this.teammates()) })
      this.quickSpend(a, t, r)
      if (t.triaged || t.status !== 'new') return // you got to it first
      const d = readTriage(r.text)
      if (!d) throw new Error("its answer wasn't a triage")
      if (d.dup) this.taskCommand(name, ['dup', String(t.id), String(d.dup)])
      else this.taskCommand(name, ['triage', String(t.id), ...(d.owner ? ['--owner', d.owner] : []), '--priority', d.priority, '--kind', d.kind, '--title', d.title, '--details', d.details])
      this.ledger.add('quickTriage', true, { n: 1, cost: r.cost, tokens: r.tokens })
    } catch {
      this.ledger.add('quickTriage', true, { n: 1, failed: 1, cost: r?.cost, tokens: r?.tokens })
      if (!t.triaged && t.status === 'new') this.triageByAgent(t, true)
    }
  }

  // The triage agent triages it in its own conversation, as without quick triage (fellBack: the saver handed it over, so
  // the turn's cost is the saver's to count). If that can't be (it's off, gone or moving), the agent whose area it is
  // gets it, as with no triage agent; failing that, it waits in To do.
  triageByAgent(t, fellBack) {
    const to = this.triager()
    try {
      if (!to) throw new Error('no triage agent')
      if (fellBack) this.fellBack.add(t.id)
      this.send({ from: 'you', to, text: triagePrompt(t, t.id), images: t.images, mentions: false, ticket: t.id, title: t.title, type: t.kind, triage: true })
    } catch {
      this.fellBack.delete(t.id)
      const owner = ownerFor(`${t.title} ${t.body}`, this.teammates())
      if (owner) this.tickets.edit(t.id, { owner: owner.name }, 'clique')
      this.post({ kind: 'event', from: 'clique', text: owner ? `couldn't triage #${t.id}, so it goes to @${owner.name}, whose area it is` : `couldn't triage #${t.id}: it waits in To do for you` })
      if (owner && this.space.autofix) this.autoDispatch(t)
    }
  }

  // What a quick call cost: the triage agent's spend and the clique's, and the task's it was about (not whatever the triage
  // agent's own conversation is on, as addSpend would have it).
  quickSpend(a, t, r) {
    const cost = r?.cost > 0 ? r.cost : 0
    const tokens = this.providerOf(a)?.cli === 'codex' && r?.tokens > 0 ? r.tokens : 0
    if (!cost && !tokens) return
    this.record(a.name, { ...(cost && { cost }), ...(tokens && { tokens }) })
    if (cost) (this.spend.hours[localDay()] ??= Array(24).fill(0))[new Date().getHours()] += cost
    this.saveSpend()
    t.spent = { cost: (t.spent?.cost ?? 0) + cost, tokens: (t.spent?.tokens ?? 0) + tokens, added: t.spent?.added ?? 0, removed: t.spent?.removed ?? 0 }
    this.tickets.save()
  }

  // One short call to a provider (core/promptgen.js). Tests put a stand-in here.
  oneShot(provider, opts) {
    return quickAsk(provider, opts)
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
    // much smaller than it was: the CLI compacted it (Codex says so nowhere else), and the briefs went with the rest
    if (c.context?.used > 0 && context?.used < c.context.used / 2) delete c.briefs, delete c.boardSeen
    c.context = context
    this.saveConvos()
    this.checkLimit(a)
    this.changed()
  }

  // An agent's own context limit (contextLimit, in tokens), for a model whose window is bigger than you want
  // it to use: once its conversation passes the limit, it starts a new one as soon as it's free (the default),
  // or CLIque just tells you (onContextLimit: 'notify'). Once per conversation; it re-arms if the conversation
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
    this.post({ kind: 'event', from: a.name, text: `${passed}, so it starts a new conversation ${a.status === 'resting' ? 'with its next message' : 'when it finishes this task'}` })
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

  // A line in the chat about your accounts. CLIque puts it in the workspace on screen; on its own, a hub keeps it. A
  // window's line takes the place of the one before it, wherever that is (CLIque looks in every workspace).
  aboutAccount(entry) {
    this.unsayLimit(entry.limit)
    this.post(entry)
  }

  // A usage window's earlier lines leave the chat: its newer line says what they said, and more.
  unsayLimit(limit) {
    if (limit) for (const e of this.feed.filter((x) => sameWindow(x.limit, limit))) this.unsay(e)
  }

  setUsage(id, windows, credits) {
    const before = JSON.stringify([this.liveUsage(id), this.usage[id]?.credits])
    const u = (this.usage[id] ??= { told: {} })
    Object.assign(u, { at: Date.now(), windows, credits: credits ?? undefined })
    for (const w of windows) {
      this.sample(id, w)
      this.warnUsage(id, u, w)
    }
    this.saveUsage()
    if (JSON.stringify([this.liveUsage(id), u.credits]) === before) return
    this.changed()
    this.emit('usage') // the account's, not this workspace's: CLIque tells linked computers through the default's state
  }

  liveUsage(id) {
    const now = Date.now()
    return (this.usage[id]?.windows ?? []).filter((w) => w.resetsAt > now)
  }

  // Close to running out: new work goes to agents elsewhere when they're as good a match (see bestFor).
  nearLimit(id) {
    return this.liveUsage(id).some((w) => (w.id === 'five_hour' || w.id === 'seven_day') && w.pct >= NEAR_LIMIT)
  }

  // Crossing 80%, then 95%, of a window (each said once; that survives a restart, usage.json, and a new window, another
  // reset time, starts over), or heading to run out before it resets once that's close enough to plan around (PACE_WARN
  // of the window away; said once per window): one line in the chat and one notification, however many of those come
  // at once. The line says all of it (limit, for the chat to draw), so it takes the place of the window's line before it.
  warnUsage(id, u, w) {
    u.told ??= {}
    if (u.told[w.id] && Math.abs(u.told[w.id].resetsAt - w.resetsAt) > 60000) delete u.told[w.id]
    const level = LIMIT_WARN.findLast((l) => w.pct >= l) ?? 0
    const crossed = level > (u.told[w.id]?.level ?? 0)
    const p = this.pace(id, w)
    const runsOut = p?.runsOut && p.runsOut - Date.now() <= windowMs(w) * PACE_WARN ? p.runsOut : null
    const pace = `pace:${w.id}`
    const forecast = runsOut && u.told[pace]?.resetsAt !== w.resetsAt
    if (!crossed && !forecast) return
    if (crossed) u.told[w.id] = { level, resetsAt: w.resetsAt }
    if (forecast) u.told[pace] = { resetsAt: w.resetsAt }
    const label = this.providers[id]?.label ?? id
    const at = `${label} is at ${w.pct}% of its ${limitName(w)}`
    const when = resetsWhen(w.resetsAt)
    const out = runsOut && `At this pace it runs out ${resetsWhen(runsOut)}, before it resets ${when}`
    const limit = { account: id, label, window: w.id, name: limitName(w), pct: w.pct, resetsAt: w.resetsAt, ...(runsOut && { runsOut }) }
    this.aboutAccount({ kind: 'event', from: 'clique', text: out ? `${at}. ${out}` : `${at}, resets ${when}`, limit, ...((level >= 95 || runsOut) && { alert: true }) })
    const routing = w.pct >= NEAR_LIMIT ? ' Until then, new work goes to agents on other providers when they cover the same area.' : ''
    if (crossed) this.emit('notice', { title: at, body: `${out ? `${out}.` : `It resets ${when}.`}${routing}`, focus: '', account: true })
    else this.emit('notice', { title: `At this pace, ${label}'s ${limitName(w)} runs out ${resetsWhen(runsOut)}`, body: `It's at ${w.pct}% and resets ${when}.${routing}`, focus: '', account: true })
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
  // what its session last said (a resumed session can pick its total up again), and a resumed session CLIque has never
  // seen only counts from here on. So nothing is counted twice.

  countSpend(a, session, now) {
    if (!now || !(a.run || session)) return
    const run = a.run ?? session
    const less = (x, y) => Object.keys(x).some((k) => x[k] < (y[k] ?? 0))
    const minus = (x, y) => Object.fromEntries(Object.keys(x).map((k) => [k, x[k] - (y[k] ?? 0)]))
    const seen = this.spend.runs[run]
    const before = !seen && session ? this.spend.sessions[session] : null
    // a session already under way when CLIque started counts from here on while the look back covers what came before
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
    // a triage turn in the triage agent's conversation: what quick triage would save (or, after it fell back, spent)
    const triage = (a.serving ?? []).find((m) => m.triage)
    if (triage) this.ledger.add('quickTriage', this.fellBack.has(triage.ticket), { cost, tokens })
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

  // The first time CLIque counts spend, it looks back through the agents' logs for the last LOOK_BACK_DAYS (core/backfill.js,
  // in a worker thread), up to when it started counting: when this CLIque started, or the first hour live counting ever
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

  // What the look back found, added to each agent's days, the clique's hours and the tasks. -> { cost, tokens }
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
      this.post({ kind: 'event', from: 'clique', text: `added up what the clique's work cost before CLIque counted it: ${what} over the last ${LOOK_BACK_DAYS} days` })
    }
    this.changed()
    return { cost, tokens }
  }

  // The clique's spend for the dashboard: today, and what it usually is by this time of day (on the days the clique spent
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
    // (quitting because its folder wasn't trusted is no failed resume: its conversation stays)
    if (a.resumed && code !== 0 && ms < 5000 && !a.trustNo) {
      this.post({ kind: 'event', from: name, text: "couldn't resume the previous session, starting a fresh one" })
      return this.launch(a, true)
    }
    this.post({ kind: 'event', from: name, text: a.trustNo ? "quit: its folder wasn't trusted" : code ? `exited (code ${code})` : 'exited' })
    if (a.cloneOf) this.dismiss(name) // a clone isn't restarted: what it had queued goes back to its original
  }

  // ---- what an agent leaves running ---------------------------------------------------------------------
  // Each launch writes down its process groups (core/procs.js): bin/clique-sh adds every command Claude Code runs, and
  // noteGroups what turns up in the CLI's process tree. When the CLI ends (it exits, is turned off, or restarts for a new
  // conversation), whatever is still in those groups is stopped: the dev server it started with &, the simulator helpers.

  // Groups bin/clique-sh doesn't see: what the CLI starts itself, and every command of a CLI without a shell prefix (Codex).
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

  // A CLI is gone: what's left in its groups is stopped, with one line in the chat saying what. CLIque itself, and what
  // other agents run, are never touched (CLIque started from an agent's terminal sits in one of its groups).
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
    const left = this.strays(await processes(), groups, spans)
    if (!left.length) return
    stopProcesses(left)
    // Windows starts a console host for a console program that has no console: that program's window, not something
    // the agent left, so it goes without a word
    const said = left.filter((p) => !/^(conhost|OpenConsole)$/i.test(p.name))
    const n = said.length
    if (!run.quiet && n) this.post({ kind: 'event', from: run.name, text: `left ${n === 1 ? 'a process' : `${n} processes`} running (${summary(said)}), so CLIque stopped ${n === 1 ? 'it' : 'them'}` })
  }

  // What's in these groups that isn't CLIque's or part of a running CLI's own tree.
  strays(procs, groups, spans) {
    const keep = new Set(tree(procs, process.pid).map((p) => p.pid))
    for (const r of this.runs.values()) if (r.pid) for (const p of tree(procs, r.pid)) keep.add(p.pid)
    for (const g of exempt(procs, process.pid)) groups.delete(g), spans.delete(g)
    return leftovers(procs, groups, keep, spans)
  }

  // Launches that ended while CLIque wasn't there to see it (it quit, or crashed): swept now.
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
    if (a.status === 'resting' && !this.runner.running(name)) return // the last word of the CLI it just gave up
    a.hookAt = Date.now()
    this.noteGroups(a)
    // when its conversation last went to the API (its cache lasts from then: see coldFor). A sub-agent's steps don't count.
    if (!e.agent_id && ['UserPromptSubmit', 'PostToolUse', 'Stop', 'StopFailure'].includes(e.hook_event_name)) (this.convoOf(a).lastAt = a.hookAt), this.saveConvos()
    if ((a.stopping || a.halted) && !e.agent_id && this.afterStop(a, e)) return // you stopped it: see interrupt
    if (e.hook_event_name === 'SessionStart' || e.hook_event_name === 'UserPromptSubmit') {
      // past any trust question: one still up was answered after all (a late redraw can bring its card back)
      if (a.trustAsk && !e.agent_id) this.stopPick(a, { by: 'terminal' }), this.trustAnswered(a)
      Object.assign(a, { trust: null, trustNo: false, boot: '' })
    }
    // where its CLI keeps this conversation, so a move to another computer can take it along (core/move.js)
    if (e.transcript_path && e.session_id && !e.agent_id) a.transcript = { id: e.session_id, path: String(e.transcript_path) }
    if (e.hook_event_name === 'SessionStart' && e.session_id && !e.agent_id) a.sessionId = e.session_id // /clear starts another
    switch (e.hook_event_name) {
      case 'SessionStart': // Claude: at launch. Codex: with the first prompt, so only "starting" counts.
        if (e.source === 'compact') {
          // The CLI summarized the conversation to make room: older details are now fuzzy.
          this.convoOf(a).compactions += 1
          delete this.convoOf(a).briefs // summarized with the rest: each channel's brief comes again with its next message
          delete this.convoOf(a).boardSeen // and the notes it had read: clique board shows the newest again
          this.saveConvos()
          this.post({ kind: 'event', from: name, text: 'ran out of room and compacted its conversation (older details are summarized now)' })
          return
        }
        if (e.source === 'clear') {
          // /clear typed in its terminal. The new session has no prompt yet, so it can't be resumed: stopped before it
          // has one, this agent starts a new conversation rather than go back to the one you cleared.
          this.saveSession(name, null)
          this.newConvo(a)
          this.post({ kind: 'event', from: name, text: 'started a new conversation (/clear)', fresh: true })
          return this.setStatus(a, 'idle')
        }
        a.upAt = Date.now()
        if (a.status !== 'starting') return
        hold(a, 2000) // the prompt box isn't ready the moment the session starts
        return this.setStatus(a, 'idle')
      case 'UserPromptSubmit': {
        a.resumeWatch = null // it's taking prompts: no question about resuming comes now
        a.promptAt ||= Date.now()
        // a "continue" CLIque owes it after an API error: this prompt (CLIque's, or anything you typed) takes its place
        clearTimeout(a.retryTimer)
        a.retrying = false
        const again = Boolean(a.expect?.again) && samePrompt(e.prompt, a.expect.text)
        // Remembered only once it has a prompt: Claude Code doesn't save empty sessions, so they can't be resumed.
        if (e.session_id && this.sessions[name] !== e.session_id) this.saveSession(name, e.session_id)
        // Claude Code's own prompt: something the agent left running in the background finished. It's not a message
        // from you, nor a new task. It comes in mid-turn, or starts a turn of its own once the last one is over; either
        // way the agent is still on what it was answering, and its reply threads there.
        if (isNotice(e.prompt)) {
          if (a.status !== 'working') (a.activity = ''), (a.turnStart = a.turnBegan = Date.now())
          return this.setStatus(a, 'working')
        }
        // A question or an answer CLIque typed into the turn it's in (steer): it's part of this turn now. (A turn that
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
        a.slash = Boolean(e.prompt?.startsWith('/')) // ...whose output is no part of what it was on before
        if (!again) {
          this.record(name, { tasks: 1 })
          if (!e.prompt?.startsWith('/')) (this.convoOf(a).tasks += 1), this.saveConvos()
        }
        a.turnStart = a.turnBegan = Date.now()
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
        // its answer to where things stand, before a new conversation (see freshWhenDone): for CLIque, not the chat
        if ((a.serving ?? []).some((m) => m.wrapUp)) {
          a.wrapNote = String(e.last_assistant_message ?? '')
          a.serving = []
          a.replyDue = false
          hold(a, 600)
          return this.setStatus(a, 'idle')
        }
        // asked for a thread's closing line, and its last message already said it all: that one comes out instead
        const closing = (a.serving ?? []).find((m) => m.closes)
        if (closing && (!String(e.last_assistant_message ?? '').trim() || nothingNew(e.last_assistant_message))) {
          this.bringOut(closing.closes, a.name)
          this.settleCalls(a, null)
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
          ? this.post({ kind: 'reply', from: name, text: said ? clip(said, REPLY_MAX) : NO_WORDS, ...(!said && { empty: true }), ...(closing ? { re: closing.closeRe } : !a.slash && a.current ? { re: a.current } : {}), ...(also.length && { also }), ...(subs.length && { subs }) })
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
  // server passes: CLIque types "continue" for it, as you would, waiting longer each time. A usage limit, a login or
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
    this.post({ kind: 'event', from: a.name, text: `lost its turn to an API error (${error}), so CLIque types "continue" for it in ${ms < 60000 ? `${ms / 1000}s` : `${ms / 60000} min`}` })
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
  // ends (in the background). Its hooks tell CLIque: PreToolUse for Agent says what one is for, SubagentStart and
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
  // core/clique.js, by the card's id; so would a phone.
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
    if (q.plan) return this.answerTool(id, q, reply)
    if (q.trust) return this.answerTrust(id, q, reply)
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

  // (an agent tool's card that the agent's command has stopped waiting on doesn't keep the agent waiting)
  asking(name) {
    return [...this.asks.values()].some((q) => q.name === name && (!q.plan || q.held))
  }

  // Claude Code can settle a question without anyone answering it: its built-in safety check turns a risky command
  // down after two minutes and the agent carries on, but the hook waiting on the card is never cancelled, and no hook
  // says so. Its transcript does: the call gets its result. So while one of its own questions is up (a sub-agent's
  // lives in another file), CLIque looks there every few seconds, and the card closes once the call has a result.
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
  // turn: those stay. So does an agent tool's card: what you decide comes to the agent as a message.)
  closeAsks(a) {
    for (const [id, q] of this.asks) if (q.name === a.name && !q.plan && !q.trust && !q.input.agent_id && !this.checkAsk(id, true)) this.settle(id, '', { stale: true }, true)
  }

  // An agent that exits, restarts or goes away isn't waiting on its questions any more (even if a hook
  // process outlives it, nothing would read the answer). An agent tool's card stays up for you to answer, unless its
  // agent is gone for good: what you decide reaches the agent as a message once it's back (a clone's, its original).
  forgetAsks(name, { gone = false } = {}) {
    for (const [id, q] of this.asks) {
      if (q.name !== name) continue
      if (q.plan && !gone) q.resolve('')
      else this.settle(id, '', { stale: true }, true)
    }
  }

  // ---- agent tools (core/tools.js): a change to CLIque that waits for your OK -----------------------------------
  // `clique app …` asking first is a card like a permission prompt's, in the chat where the agent is working. Its
  // command waits for your answer, up to `hold`, and prints what came of it. Past that the agent carries on, the card
  // stays up, and what you decide comes to it as a message. What asks and what doesn't is Clique.tool's (core/clique.js),
  // which sets appTool.
  appTool() {
    throw new Error("this CLIque can't change itself for agents")
  }

  toolAsk(from, plan, closed, hold = ASK_HOLD) {
    const a = this.agents.get(from)
    const ask = { type: 'permission', tool: 'clique app', app: true, title: plan.title, ...(plan.code && { code: plan.code }), ...(plan.detail && { detail: plan.detail }), say: plan.say, always: [], alert: plan.alert }
    const e = this.post({ kind: 'ask', from, to: 'you', ask, cli: 'clique', ...(a.current && { re: a.current }) })
    this.record(from, { waits: 1 })
    this.emit('alert', a, ask.alert)
    this.setStatus(a, 'waiting')
    return new Promise((resolve) => {
      const q = { name: from, cli: 'clique', input: {}, entry: e, plan, held: true }
      // The command lets go: with what came of it, with where things stand, or with nothing (it was closed, or the
      // agent went away). -> whether it was still waiting
      q.resolve = (text) => {
        if (!q.held) return false
        q.held = false
        clearTimeout(q.holdTimer)
        resolve(text)
        const b = this.agents.get(from)
        if (b?.status === 'waiting' && !this.asking(from)) this.setStatus(b, 'working')
        this.changed()
        return true
      }
      q.holdTimer = setTimeout(() => q.resolve("The user hasn't answered yet: the card waits for them in CLIque. Don't ask again. Carry on with other work, and what they decide comes to you as a message.\n"), hold)
      q.holdTimer.unref?.()
      closed?.addEventListener('abort', () => q.resolve(''), { once: true })
      this.asks.set(e.id, q)
    })
  }

  // Your answer to an agent tool's card. Allowed, the change is made now; either way, what came of it goes back into
  // the agent's command if that's still waiting, else to the agent as a message.
  async answerTool(id, q, reply) {
    if (reply.terminal) throw new Error('this one is answered here, in the chat')
    this.asks.delete(id) // the first answer wins: the app and a phone can both answer
    let answer
    let text
    if (reply.allow) {
      try {
        text = `The user allowed it: ${await q.plan.run()}.`
        answer = { by: 'you', allow: true }
      } catch (e) {
        answer = { by: 'you', allow: true, failed: clip(e?.message ?? String(e), 300) }
        text = `The user allowed it, but it didn't work: ${answer.failed}`
      }
    } else {
      const note = String(reply.note ?? '').trim().slice(0, 2000)
      answer = { by: 'you', allow: false, ...(note && { note }) }
      text = note ? `The user said no: ${note}` : 'The user said no.'
    }
    this.amend(q.entry, { answer: { ...answer, at: Date.now() } })
    this.toolReply(q, text)
  }

  // What came of an agent tool's card: into the agent's command while that waits, else a message to the agent (a
  // clone that's gone: its original).
  toolReply(q, text) {
    if (q.resolve(`${text}\n`)) return
    const a = this.agents.get(q.name) ?? this.agents.get(this.baseOf(q.name))
    if (!a) return
    this.queue(a, cliquePrompt(a, `[clique] You asked to ${q.plan.title.charAt(0).toLowerCase()}${q.plan.title.slice(1)} (clique app). ${text}`, q.entry.id))
    this.pump(a)
  }

  // Agent tools turned off: the cards still up close, and their agents hear why.
  dropTools(text) {
    for (const [id, q] of this.asks) {
      if (!q.plan) continue
      this.asks.delete(id)
      this.amend(q.entry, { answer: { stale: true, at: Date.now() } })
      this.toolReply(q, text)
    }
  }

  // CLIque restarted while an agent tool's card was up (loadFeed closed it): its agent hears that nothing was made.
  toolsLost() {
    for (const e of this.feed) {
      if (!e.answer?.lost) continue
      this.amend(e, { answer: { stale: true, at: e.answer.at } })
      const a = this.agents.get(e.from) ?? this.agents.get(this.baseOf(e.from))
      if (!a) continue
      const title = String(e.ask?.title ?? 'change CLIque')
      this.queue(a, cliquePrompt(a, `[clique] CLIque restarted before the user answered when you asked to ${title.charAt(0).toLowerCase()}${title.slice(1)} (clique app), so it wasn't made. If it's still needed, ask again.`, e.id))
      this.pump(a)
    }
  }

  // Automatic: an agent tool's change went through without asking, and the chat says so where the agent is working.
  toolDone(from, plan) {
    const current = this.agents.get(from)?.current
    const channel = current && this.feed.findLast((x) => x.id === current)?.channel
    this.post({ kind: 'event', from, text: plan.did, app: true, ...(channel && { channel }) })
  }

  needsYou(a, text) {
    this.record(a.name, { waits: 1 })
    this.post({ kind: 'event', from: a.name, text, alert: true })
    this.emit('alert', a, text)
    this.setStatus(a, 'waiting')
  }

  setStatus(a, status) {
    if ((status === 'stopped' || status === 'off') && (a.trustAsk || a.trustPick)) this.dropTrust(a)
    if (a.status !== status) {
      const spent = Date.now() - a.since
      if (a.status === 'working') this.record(a.name, { activeMs: spent })
      if (a.status === 'waiting') this.record(a.name, { waitMs: spent })
      Object.assign(a, { status, since: Date.now() })
    }
    if (a.system && (status === 'stopped' || status === 'off')) this.systemAgentHandOver(a)
    // Its turn is over, whichever way it ended: the files it edited are free again, and whoever asked it something
    // this turn hears that no answer is coming (a Stop has settled those already). Turned off, it won't get to the
    // questions in its queue either, so their askers hear that now rather than wait. (A clone's queue goes back to
    // its original instead, see dismiss.)
    if (status === 'idle' || status === 'stopped' || status === 'off') {
      this.release(a.name)
      if (status !== 'idle' || !a.background) this.letGo(a.name) // what it left running may still be using a lease
      if (a.steering && status === 'idle' && !a.freshPending && !a.relaunch) {
        // what CLIque typed mid-turn wasn't taken in yet: give the CLI a moment to start a turn with it (see unsteer)
        hold(a, 5000)
        clearTimeout(a.steerTimer)
        a.steerTimer = setTimeout(() => this.unsteer(a), 5000)
      } else if (a.steering) this.unsteer(a) // gone: it's back in the queue, for what happens to that below
      if (a.serving?.length) this.settleCalls(a, null, { idle: 'stopped before it answered', stopped: 'exited before it answered', off: 'was turned off before it answered' }[status])
      if (status === 'off' && !a.cloneOf) this.forgetCalls(a.name, "was turned off, so it can't answer")
    }
    if (status === 'idle' && a.freshPending) return this.freshWhenDone(a)
    if (status === 'idle' && a.relaunch) return this.launch(a)
    if (status === 'idle' || status === 'resting') this.pump(a)
    if (status === 'working') this.steer(a)
    this.changed()
  }

  // Questions and answers don't wait for the end of a turn. A busy agent gets them typed into the turn it's in: its
  // CLI takes them in at its next step (Claude Code and Codex both do, between two tool calls), so a teammate waiting
  // on its answer waits seconds rather than the rest of a task. It answers with `clique answer` and carries on.
  // Never while a dialog is up in its terminal (a permission prompt), while you're typing there, or while the last
  // thing CLIque typed hasn't been taken in yet; then as soon as that clears.
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

  // The turn ended before its CLI took in what CLIque typed into it. If the CLI doesn't start a turn with it by itself
  // in a few seconds, it goes back to the front of the queue and in as the next prompt.
  unsteer(a) {
    clearTimeout(a.steerTimer)
    if (!a.steering) return
    const { msgs } = a.steering
    a.steering = null
    this.unbrief(a, msgs)
    for (const m of [...msgs].sort((x, y) => rank(y) - rank(x))) (a.inbox.unshift(m), (m.queued = true))
    this.pump(a)
  }

  // Messages that went back to the queue: the briefs they carried weren't given after all.
  unbrief(a, msgs) {
    const briefs = this.convos[a.name]?.briefs
    for (const m of msgs) {
      const was = briefs && BRIEFED.get(m)
      if (!was) continue
      if (was.had === undefined) delete briefs[was.id]
      else briefs[was.id] = was.had
      BRIEFED.delete(m)
    }
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
    // the same work, filed under the savers that are on, for comparing cost per turn with them on and off
    const { cost, tokens, turns, tasks, tools } = counts
    if (cost || tokens || turns || tasks || tools) this.ledger.spend(modeOf(this.savers), { cost, tokens, turns, tasks, tools })
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

  // ---- Stop -----------------------------------------------------------------------------------------------------
  // Stopping an agent ends the turn it's in. It stays on and keeps its conversation; it just isn't working any more, and
  // nothing of the stopped request carries on by itself. To continue, ask again.
  //
  // What ends a turn, as tried on Claude Code 2.1.325 and Codex 0.166:
  // - Esc, in both. Claude Code fires no hook when it's interrupted, so CLIque watches its terminal go quiet. Codex fires
  //   Interrupt at once.
  // - With a question up (a permission prompt, AskUserQuestion, a plan), Esc turns it down and ends the turn, in both.
  //   Its card in the chat closes as stopped.
  // - Sub-agents running in the turn end with it. Claude Code's background sub-agents end on the Ctrl+C below; a
  //   background shell command (a dev server) keeps running, as it does when you press Esc yourself.
  // - A prompt the CLI had queued (one CLIque typed into the turn) starts a turn of its own the moment Esc lands, in
  //   both. So does Claude Code when something it left running in the background finishes. A turn that begins by
  //   itself after a stop is stopped again (afterStop), until you ask for something.
  // - Claude Code puts the stopped prompt back in its prompt box when it had answered nothing yet, where the next
  //   message would be typed after it. One Ctrl+C empties the box (and only says "press again to exit" when it was
  //   empty). Codex quits on Ctrl+C when it's free, so it never gets one.

  // In a turn that can be stopped: at work, or waiting on you mid-turn (not on whether to trust its folder, or to pick
  // up its conversation: Esc there quits the CLI).
  stoppable(a) {
    return Boolean(a && !a.stopping && !a.trustAsk && !a.resumeAsk && (a.status === 'working' || a.status === 'waiting') && this.runner.running(a.name))
  }

  // End this agent's turn now. -> whether there was one to end.
  // Only the turn: its queue is the caller's business (stopTurns empties it; anything left in it goes in once the agent
  // is free, as after any turn).
  interrupt(name) {
    const a = this.agents.get(name)
    if (!this.stoppable(a)) return false
    for (const t of ['ack', 'steerTimer', 'retryTimer', 'stopTimer']) clearTimeout(a[t])
    Object.assign(a, { retrying: false, apiRetries: 0 })
    // a prompt CLIque typed that the CLI hasn't reported taking yet is this turn's too: whoever asked hears it stopped
    if (a.expect) a.serving = [...new Set([...(a.serving ?? []), ...a.expect.msgs])]
    a.expect = null
    this.runner.write(name, ESC)
    // its questions in the chat close with the turn (the hook behind each gets no decision: Esc has turned it down)
    for (const [id, q] of [...this.asks]) if (q.name === name && !q.plan && !q.trust) this.settle(id, '', { by: 'you', stopped: true }, true)
    const now = Date.now()
    if (a.turnStart) this.record(name, { turns: 1, turnMs: now - a.turnStart })
    // its sub-agents end with the turn (Claude Code says nothing of them when it's interrupted; one that goes on says so)
    for (const sub of a.subs?.values() ?? []) if (!sub.ended) Object.assign(sub, { ended: now, activity: '' })
    Object.assign(a, { replyDue: false, activity: '', turnStart: null, halted: { at: now }, stopping: { pressed: now, presses: 1, heard: false } })
    this.setStatus(a, 'idle') // what it was editing is free, and whoever waited on its answer hears it was stopped
    this.watchStop(a)
    return true
  }

  watchStop(a, ms = STOP_TICK) {
    clearTimeout(a.stopTimer)
    a.stopTimer = setTimeout(() => this.checkStop(a), ms)
    a.stopTimer.unref?.()
  }

  // Has its turn really ended? Nothing is typed into its terminal until it has (pump waits on a.stopping).
  checkStop(a, now = Date.now()) {
    const s = a.stopping
    if (!s) return
    if (this.agents.get(a.name) !== a || !this.runner.running(a.name)) return void (a.stopping = null)
    const since = now - s.pressed
    const quiet = this.runner.quietFor?.(a.name) ?? Infinity
    if (s.heard || (since >= STOP_SETTLE && quiet >= STOP_QUIET)) return this.stopDone(a, now)
    if (since < STOP_AGAIN) return this.watchStop(a)
    if (s.presses >= STOP_PRESSES) {
      // still at it after three tries: it's working, and the chat says so rather than show it free
      a.stopping = null
      a.halted = null
      this.post({ kind: 'event', from: a.name, text: "didn't stop when asked. Press Esc in its terminal", alert: true })
      this.emit('alert', a, "didn't stop when asked")
      return this.setStatus(a, 'working')
    }
    s.presses += 1
    s.pressed = now
    this.runner.write(a.name, ESC)
    this.watchStop(a)
  }

  stopDone(a, now = Date.now()) {
    a.stopping = null
    clearTimeout(a.stopTimer)
    if (this.providerOf(a)?.cli === 'claude' && now - Math.max(a.clearedAt ?? 0, a.typedAt ?? 0) > CLEAR_APART) {
      this.runner.write(a.name, CTRL_C)
      a.clearedAt = now
      hold(a, 800) // its prompt box redraws: the next message goes in after that
    }
    this.pump(a)
    this.changed()
  }

  // A hook from an agent you stopped. -> true when it's been dealt with here.
  afterStop(a, e) {
    const s = a.stopping
    switch (e.hook_event_name) {
      case 'Interrupt':
      case 'Stop': // (its turn ended by itself as you pressed: its last message still shows)
        if (s) (s.heard = true), this.watchStop(a, 50)
        return false
      case 'StopFailure': // an API error: no "continue" is typed for a turn you stopped
        if (s) (s.heard = true), this.watchStop(a, 50)
        return true
      case 'UserPromptSubmit':
      case 'PostToolUse': {
        const began = e.hook_event_name === 'UserPromptSubmit'
        // a step of the turn being stopped: if it goes on, its terminal keeps drawing and Esc goes in again (checkStop)
        if (s && !began) return true
        // you typed in its terminal since: that's you asking again (a prompt of yours, or a step of the turn it started)
        if ((a.typedAt ?? 0) > (a.halted?.at ?? 0)) {
          clearTimeout(a.stopTimer)
          Object.assign(a, { stopping: null, halted: null })
          return false
        }
        // a turn that began by itself: a prompt its CLI had queued, or word that something it left running finished.
        // One that Esc can't end (six tries in a row) is working, and the chat says so.
        const tries = (a.halted.again = (a.halted.again ?? 0) + 1)
        if (tries > 2 * STOP_PRESSES) {
          clearTimeout(a.stopTimer)
          Object.assign(a, { stopping: null, halted: null })
          this.post({ kind: 'event', from: a.name, text: "started again after you stopped it, and didn't stop when asked. Press Esc in its terminal", alert: true })
          this.emit('alert', a, "didn't stop when asked")
          return false
        }
        const st = (a.stopping ??= { pressed: 0, presses: 0, heard: false })
        if (st.presses < STOP_PRESSES) {
          Object.assign(st, { pressed: Date.now(), presses: st.presses + 1, heard: false })
          this.runner.write(a.name, ESC)
        }
        this.watchStop(a)
        return true
      }
      case 'PreToolUse':
      case 'Notification':
        return Boolean(s)
    }
    return false
  }

  // Stop, as you press it: these agents' turns end, and everything lined up behind each one is withdrawn rather than
  // delivered the moment it's free. One line in the chat says who you stopped. -> { stopped: [names], dropped }
  // channel: where you pressed it, for the line.
  stopTurns(names, { channel } = {}) {
    const stopped = []
    let dropped = 0
    let where
    for (const name of new Set([].concat(names ?? []).map(String))) {
      const a = this.agents.get(name)
      if (!this.stoppable(a)) continue
      where ??= this.channelFor(a.name)
      dropped += this.withdraw(a)
      this.interrupt(name)
      stopped.push(name)
    }
    if (!stopped.length) return { stopped, dropped }
    const ch = this.channel(channel) ? channel : where
    const who = stopped.map((n) => `@${n}`)
    const list = who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : who[0]
    const left = dropped ? `. ${dropped === 1 ? "A waiting message wasn't" : `${dropped} waiting messages weren't`} delivered` : ''
    this.post({ kind: 'event', from: 'clique', text: `you stopped ${list}${left}`, stop: true, about: stopped, ...(ch && ch !== GENERAL && { channel: ch }) })
    return { stopped, dropped }
  }

  // Everything lined up behind the turn you're stopping, taken back: what waits in its queue (your messages, teammates'
  // hand-offs and questions, answers to what it asked, CLIque's own follow-ups), what CLIque was typing into the turn, the
  // questions it has out with teammates, and the hand-offs it made this turn that nobody has started on. Each stays in
  // the chat, marked as not delivered. -> how many.
  withdraw(a) {
    const mine = [...(a.steering?.msgs ?? []), ...a.inbox]
    if (a.steering) this.unbrief(a, a.steering.msgs)
    clearTimeout(a.steerTimer)
    a.steering = null
    a.inbox = []
    // hand-offs it made in this turn, still waiting in a teammate's queue
    const since = a.turnBegan ?? Infinity
    const sent = []
    for (const b of this.agents.values()) {
      if (b === a) continue
      for (const m of b.inbox.filter((m) => m.from === a.name && !m.answers && !m.clique && m.ts >= since)) {
        b.inbox.splice(b.inbox.indexOf(m), 1)
        sent.push(m)
      }
    }
    let n = 0
    // a teammate's question it had put aside while it asked someone else in turn: with that answer gone, so is its own
    const parents = new Set()
    for (const m of [...mine, ...sent]) {
      m.queued = false
      if (m.answers && m.for) parents.add(m.for)
      if (m.clique) {
        // CLIque's own prompt, not a message in the chat. A thread's closing line it was to write: its last report stands in
        if (m.closes) this.bringOut(m.closes)
        if (m.wrapUp) a.wrapUp = false
        continue
      }
      n += 1
      this.amend(m, { queued: false, dropped: true, stopped: true })
      // a question (to it, or one of its own to a teammate): nobody waits on the answer any more
      const call = m.ask && this.calls.get(m.id)
      if (call && m.to === a.name) this.respond(call, { by: a.name, why: "was stopped by the user, so it won't answer" })
      else if (call) (this.calls.delete(call.id), call.hold?.resolve(''))
      // a task sent to it that it never started goes back to the board
      try {
        if (m.ticket !== undefined && !m.triage && this.tickets.get(m.ticket)?.status === 'fixing') this.tickets.move(m.ticket, 'new', 'you', `stopped @${a.name} before it started this`)
      } catch {} // (a task that's gone, or another computer's)
    }
    // what it asked teammates and is still waiting to hear: the answers would start it again
    for (const call of [...this.calls.values()]) {
      if (call.from !== a.name) continue
      if (call.parent) parents.add(call.parent)
      this.calls.delete(call.id)
      call.hold?.resolve('')
    }
    for (const id of parents) {
      const call = this.calls.get(id)
      if (call && this.ownerOf(call) === a.name) this.respond(call, { by: a.name, why: "was stopped by the user, so it won't answer" })
    }
    return n
  }

  // Keystrokes typed into an agent's terminal in the dashboard.
  input(name, data) {
    const a = this.agents.get(name)
    if (!a) return
    // Codex waits on its hook while a question is in the chat: typing in its terminal hands the question over.
    // Only real keys count, not what the terminal reports by itself (focus in/out, cursor position, mouse).
    if (typed(data)) for (const [id, q] of this.asks) if (q.name === name && q.cli === 'codex' && !q.trust) this.answer(id, { terminal: true })
    if (typed(data)) a.typedAt = Date.now()
    if (typed(data) && !a.stopping) a.halted = null // you're at its terminal yourself: what you start there runs
    if (typed(data)) this.stopPick(a, { by: 'terminal' }) // you're answering its trust question yourself
    hold(a, 3000)
    this.runner.write(name, data)
    if (a.resumeAsk && (data.includes('\r') || data === '\x1b')) return this.resumeAnswered(a)
    if (a.trustAsk && data.includes('\r')) return this.trustAnswered(a)
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
    return saveImage(name, type, bytes)
  }

  // Who gets a message: the `to` field (a name, several names, or "any") plus every @name in the text.
  // Explicit recipients skip routing. All of them are checked before anything is posted, so one unknown,
  // turned-off or self recipient rejects the whole send rather than reaching half the clique.
  // Names on another computer (iris@workstation) go to `relay`, which main.js wires to CLIque Link; `mentions: false`
  // means `to` is final (the message was already addressed on another computer).
  // `fresh`: deliver into a new conversation (started when it's this message's turn). `ticket`: the bug it's about.
  // `re`: the message you're replying to (a feed id here); the copy links to it, so the feed threads it. `quote`
  // ({ from, text }): the same for a message that lives on another computer, which can only be quoted.
  // From a linked computer, `ask` is a question asked there (its id there: the answer goes back with it), and
  // `answers` the answer to one asked here.
  send({ from = 'you', to, text, images = [], mentions = true, fresh = false, ticket, title, type, triage = false, re: replyTo, quote, ask, answers, auto = false, channel, channelName, brief, newWork = false, thread }) {
    text = String(text ?? '').trim()
    images = [].concat(images).map((p) => movedPath(p)).filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep))
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
    if (away.length && !this.relay) throw new Error(`${away.map((n) => `@${n}`).join(', ')} is on another computer, and CLIque Link isn't on`)
    const extra = { ...(fresh && { fresh: true }), ...(ticket !== undefined && { ticket, title, ...(type && { type }) }), ...(triage && { triage: true }) }
    // the channel it's said in: the one you said it in, or the one an agent's working in. One from another computer that
    // this workspace doesn't have keeps its name and brief, so its agents get the brief all the same.
    const remote = channelName && channel !== GENERAL && /^[a-z0-9][a-z0-9-]{0,39}$/.test(String(channel))
    const ch = remote ? channel : this.channelFor(from, channel)
    const carried = remote && { channelName: String(channelName).slice(0, 40), ...(brief && { brief: String(brief).slice(0, 4000) }) }
    // to agents on other computers: with the channel's name and brief, for their hubs to give it
    const there = ch && (carried || (this.channel(ch) && { channelName: this.channel(ch).name, ...(this.channel(ch).brief && { brief: this.channel(ch).brief }) }))
    const awayExtra = there ? { ...extra, channel: ch, ...there } : extra
    if (away.length && !names.length) return this.relay(from, away, text, images, awayExtra)
    const targets = names.length ? this.recipients(names, from) : [this.route(text, from, ch)]
    if (!targets[0]) throw new Error('no agents to send to')
    // Q hands on inside the channel it came from, as Auto picks from its members, and what you attached goes along
    const sender = this.agents.get(from)
    if (sender?.system) {
      const room = this.channel(ch)
      const outside = room?.members?.length ? targets.find((x) => !room.members.includes(this.baseOf(x.name))) : null
      if (outside) throw new Error(`not sent: #${room.name} is for ${room.members.map((n) => `@${n}`).join(' ')}, and @${outside.name} isn't in it. Hand it to one of them, or tell the user nobody there fits`)
      const asked = [...(sender.serving ?? []), this.feed.findLast((e) => e.id === sender.current)]
      if (!images.length) images = [...new Set(asked.flatMap((m) => m?.images ?? []))]
    }
    // nobody named: the clique picked who takes it (here, or in Clique.send for you), and the chat says so rather than that
    // you chose them
    const routed = (auto || !names.length) && { auto: true }
    // Work can't go back to a teammate that's waiting on your answer: your final message goes back to it by itself.
    for (const t of this.agents.has(from) ? targets : []) {
      const answering = this.agents.get(from).serving ?? []
      const call = [...this.calls.values()].find((c) => this.ownerOf(c) === from && (c.from === t.name || this.baseOf(c.from) === t.name) && (c.hold || answering.includes(c.msg)))
      if (!call) continue
      this.ruling('back', from, call.from)
      throw new Error(`@${call.from} is waiting for your answer to "${gist(call.text, 80)}". Don't hand it back: put what you'd send it in your answer. Your final message goes back to @${call.from} by itself.${targets.length > 1 ? ' (nothing was sent)' : ''}`)
    }

    const held = from !== 'you' && !this.space.autopilot && !this.agents.get(from)?.system // (you asked Q: his hand-off is your request going on)
    if (ask) {
      const msg = this.post({ kind: 'msg', from, to: targets[0].name, text, ask: true, ...(images.length && { images }), ...(ch && { channel: ch }), ...carried, queued: !held, held })
      this.open({ id: msg.id, msg, from, text, back: ask })
      if (!held) this.enqueue(targets[0], msg)
      return `asked @${targets[0].name}\n`
    }
    // noReportBack: a report to the teammate whose hand-off this agent is on. That teammate needs nothing back, and the
    // agent's final message shows in the chat by itself. New work for it goes with `clique send <name> --new`.
    // Only a teammate named in `to` (not one @mentioned in the text, nor Auto's pick), and not when its hand-off asked
    // something (a question the old way, by clique send: the answer goes back to it).
    const handers = new Set((newWork ? [] : sender?.serving ?? []).filter((m) => m.from !== 'you' && !m.ask && !m.answers && !m.clique && !/\?\s*$/m.test(m.text ?? '')).map((m) => this.baseOf(m.from)))
    const named = new Set(addressees(to, '').map((n) => this.baseOf(local(n) ?? n)))
    const back = targets.find((t) => handers.has(this.baseOf(t.name)) && named.has(this.baseOf(t.name)))
    if (back) {
      this.ledger.add('noReportBack', this.savers.noReportBack, { n: 1, tokens: this.warmth(back).wake })
      if (this.savers.noReportBack) throw new Error(`not sent: @${back.name} handed you this and needs nothing back. Your final message shows in the chat by itself. If this is new work for @${back.name}, send it with: clique send ${back.name} --new "…"${targets.length > 1 ? ' (nothing was sent)' : ''}`)
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
      return this.post({ kind: 'msg', from, to: a.name, text, ...group, ...routed, ...extra, ...(images.length && { images }), ...(re && { re }), ...(thread && { thread }), ...((ch || channel !== undefined) && { channel: ch }), ...carried, ...(replying && { replying }), queued: !held, held })
    })
    if (held) return `waiting for the user to approve this hand-off to ${targets.map((a) => `@${a.name}`).join(' ')}\n`
    const here = targets.map((a, i) => this.enqueue(a, msgs[i])).join('')
    return away.length ? this.relay(from, away, text, images, awayExtra).then((there) => here + there) : here
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
    if (unknown.length) throw new Error(`no agent named ${unknown.map((n) => `"${n}"`).join(', ')} (try: clique who)${after}`)
    // an agent and its clones are one agent
    const me = names.find((n) => this.baseOf(n) === this.baseOf(from))
    if (me) throw new Error(`${names.length > 1 ? `@${me} is you, leave yourself off` : "that's you, pick a teammate (clique who)"}${me === from ? '' : ` (@${me} and @${from} are the same agent)`}${after}`)
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
    const busy = (to.status !== 'idle' && to.status !== 'resting') || to.inbox.length > 1
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
    Object.assign(msg, { held: false, queued: true, ...(msg.thread && { out: false }) }) // settled: it goes to its thread
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
  // Agents that need each other can stall a clique: two of them each waiting for the other, an answer that never finds
  // its way back, work handed back and forth, two editors in one file. CLIque settles these by rule instead of leaving
  // the agents to sort it out between them:
  // - `clique ask` holds the asker's shell until the answer comes. The question reaches the teammate even mid-task (it's
  //   typed into the turn it's in, see steer), and its `clique answer`, or else its final message, comes straight back
  //   into the asker's turn (or into the turn it's in by then, if it gave up waiting). Nobody has to remember to
  //   reply, and nobody polls.
  // - Whoever is being waited on never waits on its waiter: an ask that would close a loop is refused on the spot.
  //   And work can't be handed back to an agent that's waiting on your answer: the answer goes back by itself.
  // - Answers go in first, then questions, then the rest; hand-offs that piled up go in together, in one turn.
  // - One file, one editor (lease).

  // `clique ask <name> "…"`. Resolves with the answer, or after `hold` ms with where things stand.
  async question({ from = 'you', to, text, images = [], closed, hold = ASK_HOLD }) {
    text = String(text ?? '').trim()
    images = [].concat(images).map((p) => movedPath(p)).filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep))
    if (!text) throw new Error('usage: clique ask <name> "what you need"')
    const named = addressees(to, '')
    if (named.length > 1) throw new Error('ask one teammate at a time: clique ask <name> "…"')
    const local = (n) => [n, this.baseOf(n)].find((x) => this.agents.has(x))
    const name = named.length ? (named[0].includes('@') ? named[0] : (local(named[0]) ?? this.elsewhere?.(named[0]) ?? named[0])) : this.route(text, from, this.channelFor(from))?.name
    if (!name) throw new Error('no agents to ask')
    const asker = this.agents.get(from)
    this.mayWait(from, name)
    if (name.includes('@')) return this.questionElsewhere({ from, name, text, images, closed, hold })
    const [target] = this.recipients([name], from)
    // the same question again (a retry after a "hasn't answered yet"): wait on the one already asked
    const same = [...this.calls.values()].find((c) => c.from === from && this.baseOf(this.ownerOf(c)) === target.name && squash(c.text) === squash(text))
    if (same) return this.hold([same], hold, closed)
    const held = from !== 'you' && !this.space.autopilot && !this.agents.get(from)?.system // (you asked Q: his hand-off is your request going on)
    const msg = this.post({ kind: 'msg', from, to: target.name, text, ask: true, ...(images.length && { images }), ...(asker?.current && { re: asker.current }), queued: !held, held })
    const call = this.open({ id: msg.id, msg, from, text, parent: this.workingOn(asker) })
    if (asker) this.record(from, { handoffs: 1 })
    if (!held) this.enqueue(target, msg)
    return this.hold([call], hold, closed)
  }

  // A question for an agent on a linked computer: asked there (where it's queued and answered by the same rules), and
  // waited on here. Its answer comes back through send({ answers }).
  async questionElsewhere({ from, name, text, images, closed, hold }) {
    if (!this.relay) throw new Error(`@${name} is on another computer, and CLIque Link isn't on`)
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
      // a computer on an older CLIque took it as a hand-off: no answer will come back by itself
      this.calls.delete(call.id)
      return `${out}(its computer runs an older CLIque, so this went as a hand-off: the answer won't come back by itself)\n`
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

  // The teammates `name` is stuck waiting on right now: whoever owes an answer to a `clique ask` of its that's still
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
    return `${lines.join('\n')}\nDon't ask again. Carry on with other work and the answer comes to you as a message, or wait more with: clique wait\n`
  }

  // `clique wait`: hold on for the answers to the questions you asked. One that came in while you were busy (queued
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
    for (const c of open) this.mayWait(from, this.ownerOf(c)) // the same rule as clique ask: never wait on your waiter
    return this.hold(open, hold, closed)
  }

  // `clique answer [@name] "…"`: answer a question you were asked, right away, without ending what you're doing (the
  // oldest still open, or the one from `to`). It shows in the chat as your reply to it, and the asker has it now.
  answerNow({ from, to, text }) {
    text = String(text ?? '').trim()
    if (!text) throw new Error('usage: clique answer "your answer"')
    const a = this.agents.get(from)
    const asked = (to ? [to] : []).map((n) => String(n).replace(/^@/, '').toLowerCase())
    const all = (a?.serving ?? []).filter((m) => m.ask && this.calls.has(m.id))
    const open = all.filter((m) => !asked.length || asked.includes(m.from) || asked.includes(this.baseOf(m.from)))
    if (!open.length) throw new Error(asked.length ? `@${asked[0]} hasn't asked you anything that's still open` : 'No question to answer: nobody is waiting on you (or it was answered already).')
    const m = open[0]
    const reply = this.post({ kind: 'reply', from, text: clip(text, REPLY_MAX), re: m.id })
    this.respond(this.calls.get(m.id), { by: from, text, reply })
    const left = all.length - 1
    return `@${m.from} has your answer.${left ? ` ${left} more question${left > 1 ? 's' : ''} waiting: clique answer "@name" "…"` : ''}\n`
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

  // A question's answer, whichever way it comes: back into the asker's `clique ask` if that's still waiting, else to the
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

  // CLIque stepping in, as a line in the chat: who was stopped from what, and why. The same one twice in a row (an
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
  // both, still edit a file one at a time. It can't be asked (clique ask stays in a workspace), so it's named with its
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
        ? `${short} is being edited by ${holder.name} in your ${away} workspace right now, and CLIque lets one agent edit a file at a time, whichever workspace it works in. Leave it be and do the rest of your work: the file is free again once ${holder.name} there finishes its turn.`
        : `${short} is being edited by @${holder.name} right now, and CLIque lets one agent edit a file at a time. Leave it to @${holder.name} and do the rest of your work: the file is free again once @${holder.name} finishes its turn. If you need a change in it, clique ask ${holder.name}.`
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

  // The hub of the workspace a lease's holder works in. CLIque sets this, to find any workspace's; on its own, a hub knows
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
  // the whole office. `clique lease <thing>` takes it before using it; someone else has it, and it waits for it like
  // `clique ask` waits for an answer, then says who has it. It's the holder's until it gives it back (`clique release`), its
  // turn ends with nothing of its left running in the background, or its CLI stops. An agent answering the holder's
  // question may use it: the holder is waiting on it, not using it. From your own terminal it's yours until you release it.
  async claim({ from = 'you', words = [], closed, hold = ASK_HOLD }) {
    const [thing = '', ...why] = words.map((w) => String(w).trim())
    const key = leaseKey(thing)
    if (!key) throw new Error('usage: clique lease <thing> ["what for"], e.g. clique lease simulator "QA pass for #12"')
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
    const until = name === 'you' ? 'until you clique release it' : `until your turn ends with nothing left running, or you clique release ${thing}`
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
    return `${h.thing} is still ${who}'s (${mins} min${h.why ? `: ${h.why}` : ''}). Don't use it meanwhile: carry on with other work and try again later${h.name === 'you' || away ? '' : `, or clique ask ${h.name}`}.\n`
  }

  // `clique release [thing]`: one thing, or everything it holds.
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

  // `clique leases`: who has what, in every workspace.
  leasesText() {
    const now = [...this.held.values()].filter((h) => (h.name === 'you' ? this : this.hubOf(h.ws ?? this.ws))?.stillHolds(h))
    if (!now.length) return 'Nothing is leased right now.\n'
    const who = (h) => (h.name === 'you' ? 'the user' : (h.ws ?? this.ws) === this.ws ? `@${h.name}` : `${h.name} (${this.hubOf(h.ws)?.space.name ?? h.ws})`)
    return now.map((h) => `${h.thing.padEnd(22)} ${who(h).padEnd(16)} ${Math.max(1, Math.round((Date.now() - h.at) / 60000))} min${h.why ? `  ${h.why}` : ''}`).join('\n') + '\n'
  }

  // Best agent for an un-addressed task: area match first, then whoever is free, then the shortest queue.
  // An area matches on shared words and on shared intents (see INTENTS), so "keep the clique in working order"
  // finds the organiser even though none of its words are in "admin work, assistant, organiser".
  route(text, from, channel) {
    const members = this.channel(channel)?.members
    const ready = [...this.agents.values()].filter((a) => !a.cloneOf && !a.system && a.name !== this.baseOf(from) && (this.runner.running(a.name) || a.status === 'resting') && this.workable(a) && (!members || members.includes(a.name)))
    const best = this.pick(text, ready.map((a) => ({ ...this.lineup(a), ...this.warmth(a) })))
    // (nobody else here: Q, unless it's Q asking)
    return best ? this.agents.get(best.name) : !this.systemAgent() || this.baseOf(from) === this.systemAgent().name || !this.systemAgentReady() ? undefined : this.systemAgent()
  }

  // Deliver the next queued message once the agent is idle and nothing asked to hold off (e.g. you typing in its terminal).
  // A resting agent starts for it, and takes it once it's up.
  pump(a) {
    clearTimeout(a.timer)
    const resting = a.status === 'resting'
    if (a.resumeAsk || a.stopping || (resting ? a.moving || this.agents.get(a.name) !== a : a.status !== 'idle' || !this.runner.running(a.name))) return
    // a clone with nothing of its own takes what waits for its original (not one you just stopped: Stop isn't "next, please")
    if (a.cloneOf && !a.inbox.length && !a.halted) this.takeOver(a)
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
    // A conversation whose cache has gone cold, and a message that doesn't follow on from it (coldStart)
    const cold = this.coldFor(a, this.peek(a))
    if (cold && this.savers.coldStart) return this.coldStart(a, cold)
    if (cold && a.coldSeen !== a.inbox[0].id) (a.coldSeen = a.inbox[0].id), this.ledger.add('coldStart', false, { n: 1, tokens: cold.recache })
    if (resting) return this.launch(a)
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
    // A line CLIque owes the agent (it moved to this computer while free) goes on top of the next message it gets.
    const note = this.convos[a.name]?.note
    if (note) delete this.convos[a.name].note, this.saveConvos()
    const head = msgs.length < 2 ? '' : msg.answers ? `[${msgs.length} answers to your questions came in]` : `[${msgs.length} hand-offs came in while you were busy, oldest first. Take them together, in this one turn.]`
    const text = [note, head, ...msgs.map((m) => this.framed(a, m))].filter(Boolean).join('\n\n')
    a.halted = null // asked again: what starts now is wanted
    a.turnBegan = Date.now() // (what it hands on from here is this turn's: see withdraw)
    this.runner.submit(a.name, withImages(text, msgs.flatMap((m) => m.images ?? [])))
    a.promptAt ||= Date.now()
    // Matched against the prompt the agent reports, even if it shows up late. Only the words count:
    // Claude Code turns attached image paths into "[Image #1]" and moves them around.
    a.expect = { id: msg.id, text, msgs }
    // (CLIque's own prompts, like "you were moved here", aren't messages anyone sent it)
    for (const m of msgs) if (!m.clique) this.record(a.name, { [m.from === 'you' ? 'fromYou' : 'fromTeam']: 1, delivered: 1, queuedMs: Date.now() - m.ts })
    this.awaitPickup(a)
    this.setStatus(a, 'working')
  }

  // What goes in next: the head of the queue, with every other answer when it's an answer, and every other teammate
  // hand-off when it's one of those. They're read together, in one turn: a pile of hand-offs costs one turn instead
  // of one each, and two that crossed are read side by side. A question, a message from you and a task each get a
  // turn of their own.
  nextUp(a) {
    const msgs = this.peek(a)
    for (const m of msgs) a.inbox.splice(a.inbox.indexOf(m), 1)
    return msgs
  }

  // What nextUp would take, left in the queue.
  peek(a) {
    const kind = (m) => (m.answers ? 'answer' : !m.ask && !m.fresh && m.ticket === undefined && m.from !== 'you' && !m.clique ? 'handoff' : null)
    const k = kind(a.inbox[0])
    // ...and only from one channel at a time: what comes of them goes back to the channel each was said in
    const where = a.inbox[0].channel
    // ...and never from two threads: its reply goes in the thread of what it answers
    const thread = a.inbox[0].thread
    return k ? a.inbox.filter((m) => kind(m) === k && (k === 'answer' || (m.channel === where && (!thread || !m.thread || m.thread === thread)))) : [a.inbox[0]]
  }

  // A message as the agent reads it: in brackets, what it is and who it's from, so it knows what's expected of it.
  // Several agents sent the same message: the first named leads and owns the result, the rest each take their part.
  // busy: typed into the turn it's in (steer), so it answers right away and carries on.
  framed(a, m, { busy = false } = {}) {
    if (m.answers) return `[answer from @${m.from} to your question${m.question ? ` "${m.question}"` : ''}] ${m.text}`
    const where = this.briefed(a, m)
    return where ? `${where} ${this.tagged(a, m, busy)}` : this.tagged(a, m, busy)
  }

  // The channel a message is in, as the agent reads it: the channel's brief the first time this conversation gets a
  // message from there (and again once it's changed), after that just its name. #general without a brief: nothing, as
  // before there were channels. Called as the message goes in, so the conversation counts the brief as given.
  briefed(a, m) {
    // one said on another computer comes with its name and brief (Clique.send); one of this workspace's, as it is now
    const c = (m.channelName && { id: m.channel, name: m.channelName, brief: m.brief ?? '' }) || (this.channel(m.channel) ?? this.channel(GENERAL))
    const convo = this.convoOf(a)
    const had = convo.briefs?.[c.id]
    const now = c.brief ? briefHash(c.brief) : undefined
    if (had === now) return c.id === GENERAL && !c.brief ? '' : `[in #${c.name}]`
    convo.briefs = { ...convo.briefs }
    if (now) convo.briefs[c.id] = now
    else delete convo.briefs[c.id]
    BRIEFED.set(m, { id: c.id, had }) // taken back if the message doesn't go in after all (unsteer)
    this.saveConvos()
    if (!now) return `[in #${c.name}. #${c.name} has no brief any more: what it said before doesn't apply]`
    return had
      ? `[in #${c.name}. #${c.name}'s brief changed, for every message in #${c.name} from now on: ${c.brief}]`
      : `[in #${c.name}. Channel brief, for every message in #${c.name}: ${c.brief}]`
  }

  // ---- channels: #general and the ones you made (core/workspaces.js) ----

  channel(id) {
    return id ? this.space.channels.find((c) => c.id === id) : undefined
  }

  // The channel a message from `from` goes in: the one it was given (#general is no channel at all, as before), else
  // the one the agent is working in right now.
  channelFor(from, given) {
    if (given !== undefined) return given !== GENERAL && this.channel(given) ? given : undefined
    const current = this.agents.get(from)?.current
    const channel = current && this.feed.findLast((e) => e.id === current)?.channel
    return channel && this.channel(channel) ? channel : undefined
  }

  // A channel by its name (with or without the #), or else its id: a renamed one keeps its id, which a newer channel's
  // name can be.
  channelNamed(raw) {
    const want = channelName(raw)
    const list = this.space.channels
    return list.find((c) => c.name === want) ?? list.find((c) => c.id === want)
  }

  // Has this agent's conversation had the channel's brief? It's given once (see briefed), and again once it's changed.
  hasBrief(a, c) {
    return this.convoOf(a).briefs?.[c.id] === briefHash(c.brief)
  }

  giveBrief(a, c) {
    const convo = this.convoOf(a)
    convo.briefs = { ...convo.briefs, [c.id]: briefHash(c.brief) }
    this.saveConvos()
  }

  // `clique channels`: the channels, who's in each and its brief, which goes for every message there. An agent (`from`)
  // has read those briefs now, and sees the channels it can't post in.
  channelsText(from) {
    const a = this.agents.get(from)
    return `${this.space.channels.map((c) => {
      if (a && c.brief) this.giveBrief(a, c)
      const out = a && !a.system && c.members?.length && !c.members.includes(this.baseOf(from)) ? " (you're not in it)" : ''
      return `#${c.name.padEnd(20)} ${(c.members?.map((n) => `@${n}`).join(' ') || 'everyone').padEnd(24)} ${c.brief ? c.brief.replace(/\s+/g, ' ') : '(no brief)'}${out}`
    }).join('\n')}\n`
  }

  // `clique post <channel> "…"`: an agent says something in the channel it picks, whichever one it's working in. It reads
  // as anything else that agent says there, unread in that channel until you've seen it, and takes up nobody's turn. An
  // @name hands it to that teammate there, by the rules of any hand-off. From your own terminal it goes as what you type
  // in that channel does. Two things only CLIque can see, so they're rules rather than a line in the agent's prompt: what
  // it would say twice, and a brief it hasn't read.
  postIn(from, [channel = '', ...words]) {
    const text = words.join(' ').trim()
    if (!channel.trim() || !text) throw new Error(POST_USAGE)
    const c = this.channelNamed(channel)
    if (!c) throw new Error(`there's no #${channelName(channel)} here: there's ${this.space.channels.map((x) => `#${x.name}`).join(', ')} (clique channels)`)
    const a = this.agents.get(from)
    if (!a) return this.send({ from, text, channel: c.id })
    if (c.members?.length && !c.members.includes(this.baseOf(from)) && !this.agents.get(from)?.system) throw new Error(`you're not in #${c.name}, so nothing was posted: it's for ${c.members.map((n) => `@${n}`).join(', ')}. Hand it to one of them, or ask the user to add you.`)
    const handing = addressees('', text).length > 0
    if (!handing && a.current && (this.channelFor(from) ?? GENERAL) === c.id) throw new Error(`not posted: you're working in #${c.name}, and your final message shows there by itself. Say it there.`)
    if (c.brief && !this.hasBrief(a, c)) {
      this.giveBrief(a, c)
      throw new Error(`not posted yet. #${c.name}'s brief, for every message there: ${c.brief}\nPost it again, by that brief.`)
    }
    if (handing) return this.send({ from, text, channel: c.id })
    this.post({ kind: 'reply', from, text: clip(text, REPLY_MAX), ...(c.id !== GENERAL && { channel: c.id }) })
    return `posted in #${c.name}\n`
  }

  // `clique canvas <op> …`: a board drawn in the chat (core/canvas.js). A canvas is the message that holds it, known by
  // that message's id, and anyone here can draw on it: a change rewrites the message where it stands, so the board in
  // the chat is always the latest one, and a teammate's change says so on a line of its own. `by` keeps who wrote each
  // line (without it, a block from a final message: all its author's).
  canvas(from, [op = '', ...args]) {
    if (!op || op === 'help') return CANVAS_HELP
    const all = () => this.feed.filter((e) => (e.kind === 'reply' || e.kind === 'msg') && canvasLines(e.text))
    const name = (e) => `canvas ${e.id}${canvasTitle(canvasLines(e.text)) ? ` "${canvasTitle(canvasLines(e.text))}"` : ''}`
    const whose = (e, lines) => (e.canvas?.by?.length === lines.length ? [...e.canvas.by] : lines.map(() => e.from))
    const numbered = (lines) => lines.map((l, i) => `${String(i + 1).padStart(2)}  ${l}`).join('\n')
    const listed = () => {
      const list = all().slice(-12)
      if (!list.length) return '(no canvases in the chat yet: clique canvas help)\n'
      return `${list.map((e) => {
        const lines = canvasLines(e.text)
        return `${e.id}  #${(this.channel(e.channel ?? GENERAL)?.name ?? GENERAL).padEnd(16)} ${[...new Set(whose(e, lines))].map((n) => (n === 'you' ? 'you' : `@${n}`)).join(' ').padEnd(20)} ${canvasTitle(lines) || lines[0]} (${lines.length} lines)`
      }).join('\n')}\n`
    }
    if (op === 'show' && !args[0]) return listed()
    if (op === 'new') {
      const lines = typedLines(args)
      if (!lines.length) throw new Error('usage: clique canvas new "<line>" "<line>" ... (clique canvas help for the lines)')
      if (lines.length > CANVAS_LINES) throw new Error(`a canvas holds ${CANVAS_LINES} lines at most, and that's ${lines.length}: say less on it`)
      if (!this.agents.get(from)) throw new Error('clique canvas new is an agent\'s: in the chat, type a ```canvas block in your message instead')
      const channel = this.channelFor(from)
      const e = this.post({ kind: 'reply', from, text: asCanvas(lines), canvas: { by: lines.map(() => from) }, ...(channel && { channel }) })
      return `drawn in #${this.channel(channel ?? GENERAL)?.name ?? GENERAL}: canvas ${e.id}. It's in the chat already, so don't repeat it in your final message. A teammate adds to it with: clique canvas add ${e.id} "<line>"\n`
    }
    if (!['show', 'add', 'set', 'cut'].includes(op)) throw new Error(`there's no clique canvas ${op}: it's new, show, add, set or cut (clique canvas help)`)
    const found = all().filter((x) => x.id === args[0] || (args[0].length >= 4 && x.id.startsWith(args[0])))
    const e = found.find((x) => x.id === args[0]) ?? (found.length === 1 ? found[0] : null)
    if (!e) throw new Error(`there's no canvas ${args[0]} in the chat. The ones there are:\n${listed()}`)
    const lines = canvasLines(e.text)
    if (op === 'show') return `${name(e)}, drawn by ${[...new Set(whose(e, lines))].map((n) => (n === 'you' ? 'you' : `@${n}`)).join(', ')}:\n${numbered(lines)}\n`
    const c = this.channel(e.channel ?? GENERAL)
    if (c?.members?.length && this.agents.get(from) && !c.members.includes(this.baseOf(from)) && !this.agents.get(from).system) throw new Error(`that canvas is in #${c.name} and you're not, so it stays as it is: it's for ${c.members.map((n) => `@${n}`).join(', ')}`)
    const by = whose(e, lines)
    let did
    if (op === 'add') {
      const more = typedLines(args.slice(1))
      if (!more.length) throw new Error('usage: clique canvas add <id> "<line>" ...')
      if (lines.length + more.length > CANVAS_LINES) throw new Error(`a canvas holds ${CANVAS_LINES} lines at most and this one has ${lines.length}: cut some, or draw a new one`)
      lines.push(...more)
      by.push(...more.map(() => from))
      did = 'added to'
    } else {
      const n = Number(args[1])
      if (!Number.isInteger(n) || n < 1 || n > lines.length) throw new Error(`${name(e)} has lines 1 to ${lines.length}:\n${numbered(lines)}`)
      if (op === 'set') {
        const [line] = typedLines(args.slice(2))
        if (!line) throw new Error('usage: clique canvas set <id> <n> "<line>"')
        lines[n - 1] = line
        by[n - 1] = from
      } else {
        if (lines.length === 1) throw new Error("that's its only line, and a canvas with nothing on it can't stay in the chat")
        lines.splice(n - 1, 1)
        by.splice(n - 1, 1)
      }
      did = 'changed'
    }
    this.amend(e, { text: withCanvas(e.text, lines), canvas: { by, rev: (e.canvas?.rev ?? 0) + 1 } })
    // somebody else's canvas: the chat says who drew on it (once, however many changes follow one another)
    const last = this.feed.at(-1)
    if (from !== e.from && !(last?.kind === 'event' && last.canvasOf === e.id && last.from === from)) {
      const title = canvasTitle(lines)
      this.post({ kind: 'event', from, text: `${did} ${e.from === 'you' ? 'your' : `@${e.from}'s`} canvas${title ? ` "${title}"` : ''}`, canvasOf: e.id, ...(e.channel && { channel: e.channel }) })
    }
    return `${name(e)} now reads:\n${numbered(lines)}\n`
  }

  // A message's own bracket: what it is and who it's from.
  tagged(a, m, busy) {
    if (m.ask && busy) return `[question from @${m.from}, who is waiting on your answer. Answer it now with clique answer "…", then carry on with what you were doing] ${m.text}`
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
    images = [].concat(images).map((p) => movedPath(p)).filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep))
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
      if (owner) this.tickets.edit(t.id, { owner: owner.name }, 'clique')
    }
    this.postTask(t, by, 'filed')
    if (triage && this.savers.quickTriage && !t.images.length) this.quickTriage(t, triage)
    else if (triage && this.savers.quickTriage) {
      // quick triage reads text only: a screenshot needs the triage agent's eyes
      this.ledger.add('quickTriage', true, { n: 1, images: 1 })
      this.triageByAgent(t, true)
    } else if (triage) {
      this.ledger.add('quickTriage', false, { n: 1 })
      this.send({ from: 'you', to: triage, text: triagePrompt(t, t.id), images: t.images, mentions: false, ticket: t.id, title: t.title, type: t.kind, triage: true })
    } else if (this.space.autofix && t.owner) this.autoDispatch(t)
    return `added #${t.id}${triage ? `, @${triage} is triaging it` : t.owner ? ` for @${t.owner}` : ''}\n`
  }

  // The triage agent you picked, if it's around to do it.
  triager() {
    const a = this.agents.get(this.space.triage)
    return a && !a.off ? a.name : null
  }

  // Everyone who can own a task: agents here that are on, and the ones on linked computers.
  teammates() {
    const here = [...this.agents.values()].filter((a) => !a.off && !a.cloneOf && !a.system).map((a) => this.lineup(a))
    return [...here, ...(this.directory?.() ?? []).filter((a) => a.on && !a.cloneOf && !a.system).map((a) => ({ name: a.name, area: a.area, status: a.status, queue: a.queue ?? 0, nearLimit: Boolean(a.nearLimit) }))]
  }

  // A task goes to its owner in a fresh conversation with just this task in it. If the owner is still in the
  // conversation where it worked on this task, "send back" goes there, with everything it already tried.
  // quiet: no line in the chat for it (a bulk Start posts one for all of them).
  async dispatch(id, opts) {
    const { to, note, quiet } = opts ?? {} // over CLIque Link a missing argument arrives as null
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
    if (t.owner && !this.isOn(t.owner)) return void this.post({ kind: 'event', from: 'clique', text: `#${t.id} waits for @${t.owner}, who is turned off: it starts once @${t.owner} is back on` })
    this.dispatch(t.id).catch((e) => this.post({ kind: 'event', from: 'clique', text: `couldn't send #${t.id} on: ${e.message}` }))
  }

  // An agent just came back on: with Auto-start, the tasks that waited for it start now, each in a new conversation.
  startWaiting(a) {
    if (!this.space.autofix) return
    for (const t of this.tickets.open()) if (t.status === 'new' && t.owner === a.name) this.autoDispatch(t)
  }

  // An owner for a task. An agent giving a task away (triage, `clique task add --owner`) can only give it to a teammate
  // who's on: one that's off never picks it up, and the task just sits there. You can, and the task waits for it.
  taskOwner(name, by, t) {
    const owner = this.agentName(name)
    this.notSystemAgent(owner)
    if (by === 'you' || this.isOn(owner)) return owner
    throw new Error(`@${owner} is turned off, so it can't take ${t ? `#${t.id}` : 'this task'}. Give it to a teammate who's on (clique who), or leave out --owner for the user to decide`)
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
  // nothing lined up, nothing it's waiting on and no word on the task, CLIque reminds it once: carry on, or say what's in
  // the way. If it stops again without finishing, its last reply asked you something, or no conversation is on the task
  // any more, it's yours to look at: one line in the chat and a notification.

  checkStalls(now = Date.now()) {
    const sys = this.systemAgent()
    if (sys?.inbox.length && (sys.resumeAsk || (sys.status === 'starting' && now - sys.since > SYSTEM_AGENT_START_MAX))) this.systemAgentHandOver(sys)
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
        if (family.some((x) => x.status !== 'idle' && x.status !== 'resting') || now - Math.max(word, base.since) < after) continue
        this.tellStalled(t, base, `isn't on #${t.id} any more, but it's still in progress. Start it again or move it`)
        continue
      }
      if ((w.status === 'idle' ? !this.runner.running(w.name) : w.status !== 'resting') || w.retrying || w.freshPending || w.relaunch || this.owed(w)) continue
      if (w.halted) continue // you stopped it: it isn't reminded to carry on
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
    this.post({ kind: 'event', from: w.name, text: `stopped on #${t.id} ${mins} min ago without finishing it, so CLIque reminded it` })
    const handed = this.feed.findLast((e) => e.kind === 'msg' && e.ticket === t.id) // its reply threads to the task
    const text = `[clique] Task #${t.id} "${t.title}" is still in progress, and your turn ended ${mins} min ago without finishing it. If it's done, run: clique task done ${t.id} "what you did, how you checked". If something is in the way (an answer, a decision, access), say what with clique task note ${t.id} "…" and stop. Otherwise carry on with it now.`
    this.queue(w, cliquePrompt(w, text, handed?.id))
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
    throw new Error(`no agent named "${name}" (try: clique who)`)
  }

  // One line in the feed for what happened to a task (`type` is its kind: bug, feature, task). A task filed for
  // someone says who, so it shows in your conversation with them too.
  postTask(t, from, act, text) {
    this.post({ kind: 'task', type: t.kind, from, ticket: t.id, title: t.title, act, ...(text && { text }), ...(act === 'filed' && t.owner && { owner: t.owner }) })
  }

  // `clique task ...` (or `clique bug ...`) from an agent or your terminal. args are the words after it.
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
    // 12 is a task here; 12@laptop one that lives on another computer (12@<this computer> is here too)
    const split = (r) => {
      const [id, host] = String(r ?? '').replace(/^#/, '').split('@')
      return { id, host: host && host !== this.self ? host : null }
    }
    const withId = ['show', 'done', 'note', 'triage', 'dup', 'decline'].includes(op)
    const { id: ref, host } = withId ? split(words[0]) : { id: '', host: null }
    const original = op === 'dup' ? split(words[1]) : null
    if (original && !original.id) throw new Error('usage: clique task dup <n> <original>')
    if (original && original.host !== host) throw new Error('both tasks must be on the same computer')
    if (host) {
      // the same command on the computer the task lives on, with the numbers as it knows them
      if (!this.relayTask) throw new Error(`#${words[0]} is on another computer, and CLIque Link isn't on`)
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
        if (!text) throw new Error(`usage: clique task done ${ref} "what you did, how you checked"`)
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
        if (!text) throw new Error(`usage: clique task decline ${ref} "why it isn't yours"`)
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

  // `clique task decline <n> "why"`: its owner can't or shouldn't do it. A task never sits with an owner that said no: it
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
    if (started) this.tickets.move(t.id, 'new', 'clique', `back to To do: @${by} declined it`)
    this.tickets.edit(t.id, { owner: next?.name ?? '' }, 'clique')
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
        if (arg.images) arg = { ...arg, images: arg.images.map((p) => movedPath(p)).filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep)) }
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

  // Q hands work on, so a task can't be his.
  notSystemAgent(name) {
    const who = this.agents.get(name) ?? (this.directory?.() ?? []).find((a) => a.name === name)
    if (who?.system) throw new Error(`${name} hands work on rather than doing it, so it can't take a task. Give it to a teammate`)
  }

  setTaskSettings({ triage, autofix }) {
    if (triage) this.notSystemAgent(triage)
    if (triage !== undefined) this.space.triage = triage || undefined
    if (autofix !== undefined) this.space.autofix = Boolean(autofix) || undefined
    this.saveConfig()
  }

  note(from, text) {
    text = String(text ?? '').trim()
    if (!text) throw new Error('nothing to note')
    // every agent reads every note once per conversation (boardNew): one decision, interface or gotcha each
    if (this.savers.boardNew && this.agents.has(from) && text.length > NOTE_MAX) throw new Error(`not shared: a note is one decision, interface or gotcha, and this one is ${text.length.toLocaleString('en-US')} characters (keep it under ${NOTE_MAX}). Put the details in a file in the repo, and note where it is.`)
    const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const file = this.at('board.md')
    fs.appendFileSync(file, `- **${from}** (${when}): ${text.replace(/\s*\n\s*/g, ' ')}\n`)
    // the last BOARD_KEEP notes are what `clique board` shows: past BOARD_MAX, only they're kept (core/keep.js)
    try {
      if (fs.statSync(file).size > BOARD_MAX) replaceFile(file, keepLines(fs.readFileSync(file, 'utf8')))
    } catch {} // the note is in: it's kept whole next time
    const channel = this.channelFor(from)
    this.post({ kind: 'note', from, text, ...(channel && { channel }) })
    return 'shared with the clique\n'
  }

  // `clique board`: the shared notes. Words search them, --all shows every one. Otherwise, with boardNew on, an agent sees
  // only the notes added since its conversation last looked (its first look: the last BOARD_FIRST), and how many older
  // ones there are; off, the last BOARD_KEEP as before. You, in a terminal, always see them all. Where each conversation
  // has read up to is kept either way, so the ledger can say what showing only the new ones leaves out.
  board(from = 'you', words = []) {
    let text = ''
    try {
      text = fs.readFileSync(this.at('board.md'), 'utf8')
    } catch {}
    const notes = text.split('\n').filter(Boolean).slice(-BOARD_KEEP)
    if (!notes.length) return '(no shared notes yet)\n'
    const full = `${notes.join('\n')}\n`
    words = words.map((w) => String(w).trim()).filter(Boolean)
    const a = this.agents.get(from)
    if (!a || words.includes('--all')) return full
    if (words.length) {
      const want = words.map((w) => w.toLowerCase())
      const hits = notes.filter((n) => want.every((w) => n.toLowerCase().includes(w)))
      if (!hits.length) return `(no note mentions ${words.map((w) => `"${w}"`).join(' and ')})\n`
      const shown = hits.slice(-BOARD_FIRST)
      return `${shown.join('\n')}\n(${shown.length < hits.length ? `the last ${shown.length} of ${hits.length} notes` : hits.length === 1 ? '1 note' : `${hits.length} notes`} mentioning ${words.join(' ')})\n`
    }
    const c = this.convoOf(a)
    const at = c.boardSeen ? notes.findLastIndex((n) => briefHash(n) === c.boardSeen) : -1
    const fresh = at >= 0 ? notes.slice(at + 1) : notes.slice(-BOARD_FIRST)
    const older = notes.length - fresh.length
    const more = older ? `${older} older: clique board --all, or clique board <words> to search` : ''
    const short = at < 0 ? `${fresh.join('\n')}\n${more ? `(the last ${fresh.length} notes; ${more})\n` : ''}`
      : fresh.length ? `${fresh.join('\n')}\n(${fresh.length} new since you last looked${more ? `; ${more}` : ''})\n`
      : `(nothing new on the board since you last looked${more ? `; ${more}` : ''})\n`
    c.boardSeen = briefHash(notes.at(-1))
    this.saveConvos()
    const on = this.savers.boardNew
    this.ledger.add('boardNew', on, { n: 1, tokens: Math.max(0, Math.ceil(full.length / 4) - Math.ceil(short.length / 4)) })
    return on ? short : full
  }

  // `clique busy`: what each teammate is on right now, one line each, so an agent can tell whether someone is already
  // building what it's about to build: its message or task, the files it's editing, what it has leased.
  busy(from = 'you') {
    this.ledger.add('busyCheck', this.savers.busyCheck, { n: 1 })
    const editing = new Map()
    for (const [file, l] of this.leases) if (l.ws === this.ws) editing.set(l.name, [...(editing.get(l.name) ?? []), path.basename(file)])
    const rows = this.ordered().filter((a) => a.name !== from && !a.off).map((a) => {
      const files = editing.get(a.name) ?? []
      const holds = this.holdsOf(a.name)
      const extra = [files.length && `editing ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}`, holds.length && `has ${holds.join(', ')}`, a.cloneOf && `a clone of ${a.cloneOf}`].filter(Boolean)
      return `${a.name.padEnd(16)} ${this.onNow(a)}${extra.length ? ` · ${extra.join(' · ')}` : ''}`
    })
    for (const a of this.directory?.() ?? []) if (a.on) rows.push(`${a.name.padEnd(16)} ${a.status === 'idle' || a.status === 'resting' ? 'free' : a.status}${a.ticket ? ` · on #${a.ticket}` : ''}`)
    return rows.length ? `${rows.join('\n')}\n` : '(nobody else in the clique right now)\n'
  }

  // What an agent is on, in a few words: its task, or the message it's answering.
  onNow(a) {
    if (a.status === 'starting') return 'starting up'
    if (a.status !== 'working' && a.status !== 'waiting') return a.inbox.length ? `free, ${a.inbox.length} queued` : 'free'
    const t = this.convos[a.name]?.ticket
    const task = typeof t === 'number' && this.tickets.all.find((x) => x.id === t)
    const msg = !task && a.current && this.feed.findLast((e) => e.id === a.current)
    const what = task ? `#${task.id} "${gist(task.title, 70)}"` : msg ? `"${gist(msg.text, 70)}"` : 'something you typed in its terminal'
    return `${a.status === 'waiting' ? 'waiting for the user, on' : 'working on'} ${what}`
  }

  // Who `clique ask` of `a`'s is holding on for right now. [{ name, since, id, text }]
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
      const status = (waits.length ? `waiting on ${waits.map((n) => `@${n}`).join(' ')}` : a.status === 'resting' ? 'idle' : a.status) + queue + (holds.length ? `, has ${holds.join(', ')}` : '')
      if (a.off) return `${a.name.padEnd(16)} off`
      if (a.cloneOf) return `${a.name.padEnd(16)} ${status.padEnd(20)} ${''.padEnd(22)} a clone of ${a.cloneOf}, on a task of its own`
      const brain = [this.providerOf(a)?.label, a.model, a.effort].filter(Boolean).join(' ')
      const clones = this.maxClones(a) ? ` (clones itself when busy, up to ${this.maxClones(a)})` : ''
      return `${a.name.padEnd(16)} ${status.padEnd(20)} ${brain.padEnd(22)} ${a.area ?? ''}${clones}`
    })
    // teammates on your other computers (CLIque Link), addressed as name@computer
    for (const a of this.directory?.() ?? []) rows.push(`${a.name.padEnd(16)} ${(a.on ? a.status : 'off').padEnd(20)} ${''.padEnd(22)} ${a.area ?? ''}`)
    return rows.join('\n') + '\n'
  }

  // ---- feed + snapshots --------------------------------------------------

  post(entry) {
    const parent = entry.re ? this.feed.findLast((x) => x.id === entry.re) : undefined
    // What follows from a message is in its channel: an agent's reply to it, its question about it, a hand-off it led to.
    if (!('channel' in entry) && parent?.channel) entry = { ...entry, channel: parent.channel }
    // A note, or CLIque stepping in, in the middle of a turn on something threaded: that thread's too.
    if ((entry.kind === 'note' || entry.kind === 'rule') && !entry.thread && !entry.re) {
      const a = this.agents.get(entry.from)
      const on = a?.status === 'working' && a.current ? this.feed.findLast((x) => x.id === a.current) : null
      if (on) entry = { ...entry, thread: on.thread ?? on.id, ...(!('channel' in entry) && on.channel && { channel: on.channel }) }
    }
    const e = { id: randomUUID().slice(0, 8), ts: Date.now(), ...entry, ...threadFields(entry, parent) }
    if (e.thread) {
      if (e.text) e.gist = gistOf(e.text, e.from)
      // when the turn it ends began: what it says can't take in anything said after that
      if (e.kind === 'reply' && this.agents.get(e.from)?.turnBegan) e.began = this.agents.get(e.from).turnBegan
      // (a hand-off of this turn: one from an earlier turn on the same message isn't what this reply is about)
      const began = this.agents.get(e.from)?.turnBegan ?? 0
      const echo = echoOf(e, parent, e.kind === 'reply' ? this.feed.findLast((x) => x.kind === 'msg' && x.from === e.from && x.re === e.re && !x.answers && x.ts >= began) : null)
      if (echo) e.echo = echo
      this.openThreads.set(e.thread, e.ts)
    }
    this.feed.push(e)
    this.trimFeed()
    this.save(e)
    this.changed()
    return e
  }

  // The chat's history down to what's kept of it (core/keep.js): the newest lines, and every older one still in use
  // (neededLines), plus `keep` (ids). Lines that go stay in feed.jsonl until it's next written anew.
  trimFeed(keep) {
    let needed
    const kept = keepFeed(this.feed, { size: (e) => this.sizeOf(e), needed: (e) => (needed ??= this.neededLines(keep))(e) })
    if (kept.length < this.feed.length) this.feed = kept
  }

  sizeOf(e) {
    let n = this.sizes.get(e)
    if (n === undefined) this.sizes.set(e, (n = lineSize(e)))
    return n
  }

  // The lines the chat can't let go of yet, however old: a question waiting for your answer, a message still queued
  // or held for its agent, one an agent is answering, what a teammate's `clique ask` is about, and an agent's lines on
  // their way to another computer (core/move.js). -> (entry) => whether it's needed
  neededLines(keep = []) {
    const ids = new Set(keep)
    for (const a of this.agents.values()) {
      if (a.current) ids.add(a.current)
      for (const m of [...(a.inbox ?? []), ...(a.serving ?? []), ...(a.expect?.msgs ?? []), ...(a.steering?.msgs ?? [])]) if (m?.id) ids.add(m.id)
    }
    for (const c of this.calls.values()) if (c.msg?.id) ids.add(c.msg.id)
    for (const id of this.asks.keys()) ids.add(id)
    for (const m of this.moves?.values() ?? []) for (const id of m.ids) ids.add(id)
    return (e) => ids.has(e.id) || (e.kind === 'ask' && !e.answer) || Boolean(e.queued || e.held)
  }

  // ---- threads (core/threads.js) -------------------------------------------------------------------------------

  // The thread a line is in, or the one hanging off it.
  threadOf(id) {
    const e = this.feed.findLast((x) => x.id === id)
    return e ? (e.thread ?? e.id) : undefined
  }

  // After a restart: a thread that was still going picks up where it was. One long over just shows its last report, since
  // whoever it asks has moved on. (A thread with a closing line already asked for after its last line is settled.)
  resumeThreads(now = Date.now()) {
    const lastOf = new Map()
    for (const e of this.feed) if (e.thread && !e.answers && e.kind !== 'rule') lastOf.set(e.thread, e)
    for (const [id, last] of lastOf) {
      if (last.out || last.from === 'you') continue
      const root = this.feed.find((e) => e.id === id)
      if ((root?.closed ?? 0) >= last.ts) continue
      if (now - last.ts < THREAD_RESUME) this.openThreads.set(id, last.ts)
      else this.bringOut(id, null, { quietly: true })
    }
  }

  // Every few seconds, for the threads something was said in since they last went quiet: a question nobody took up comes
  // out to you, and a thread that's over gets its last word in the channel.
  threadTick(now = Date.now()) {
    for (const [id, at] of this.openThreads) {
      const rows = this.feed.filter((e) => e.thread === id && !e.answers)
      if (!rows.length) {
        this.openThreads.delete(id)
        continue
      }
      this.liftQuestions(rows, now)
      if (now - at < THREAD_QUIET || this.threadBusy(id, rows)) continue
      this.openThreads.delete(id)
      this.closeThread(id, rows, now)
    }
  }

  // Anyone still on it: someone working on one of its messages or with one queued, a question between agents waiting for
  // its answer, or something only you can settle (a hand-off waiting for your OK, a question card).
  threadBusy(id, rows) {
    const ids = new Set([id, ...rows.map((e) => e.id)])
    const inIt = (m) => m && (ids.has(m.id) || m.closes === id)
    for (const a of this.agents.values()) {
      if ([...(a.inbox ?? []), ...(a.expect?.msgs ?? []), ...(a.steering?.msgs ?? [])].some(inIt)) return true
      const on = (a.current && ids.has(a.current)) || (a.serving ?? []).some(inIt)
      if (on && (a.status === 'working' || a.status === 'waiting' || a.status === 'starting' || a.background > 0)) return true
    }
    for (const c of this.calls.values()) if (c.msg?.id && ids.has(c.msg.id)) return true
    return rows.some((e) => (e.held && !e.dropped) || (e.kind === 'ask' && !e.answer))
  }

  // An agent's reply that ends by asking something, with nobody taking it up for a while. The team usually sorts these
  // out by itself; when it doesn't, you need to see it. Not one answering a teammate's question (it went back to them), nor
  // while whoever it answers is still at work: they may be about to take it up.
  liftQuestions(rows, now) {
    const lastBy = new Map()
    for (const e of rows) if (e.kind === 'reply') lastBy.set(familyName(e.from), e)
    for (const [who, e] of lastBy) {
      if (e.out || !asksSomething(e.text) || now - e.ts < THREAD_QUIET) continue
      if (rows.slice(rows.indexOf(e) + 1).some((x) => familyName(x.from) === who || familyName(x.to) === who)) continue
      const a = this.agents.get(e.from)
      if (a?.status === 'working' || a?.inbox?.length) continue
      const asked = this.feed.findLast((x) => x.id === e.re)
      const by = asked && this.agents.get(asked.from)
      if (asked?.ask || by?.status === 'working' || by?.status === 'waiting') continue
      this.surface(e, { out: true, asks: true }, now)
      this.emit('alert', a ?? { name: e.from }, 'is asking you something in a thread')
    }
  }

  // A line of a thread coming out to the channel: it arrives now, at the end of the chat, as anything said now would, so
  // you see it and it counts as new.
  surface(e, patch, now = Date.now()) {
    const i = this.feed.indexOf(e)
    if (i >= 0 && i < this.feed.length - 1) this.feed.push(...this.feed.splice(i, 1))
    this.amend(e, { ...patch, ts: Math.max(now, e.ts) })
  }

  // A thread that went quiet. If the agent you asked had the last word, that comes out to the channel. If teammates said
  // more after it, it's told what they said and asked for one closing line (a reply to your message, which the channel
  // shows by itself). You talking in the thread, or a question waiting for you, means you've got it already. Nobody to ask
  // (it's off, stopped or moving, or was asked a moment ago): the thread's last report comes out instead.
  closeThread(id, rows, now = Date.now()) {
    const root = this.feed.findLast((e) => e.id === id)
    const said = rows.filter((e) => e.kind !== 'rule' && !e.echo)
    const you = rows.findLast((e) => e.from === 'you') ?? (root?.from === 'you' ? root : null)
    if (!you || (you !== root && inThread(you))) return
    if (!said.length || said.at(-1).from === 'you') return
    if (rows.some((e, i) => e.asks && !rows.slice(i + 1).some((x) => familyName(x.to) === familyName(e.from)))) return
    const family = familyName(you.to)
    const mine = said.findLast((e) => e.kind === 'reply' && familyName(e.from) === family)
    // What teammates said that its last word can't have taken in: since that turn began, however soon after it landed. A
    // quick teammate's report can land before "June has it", and that line knows nothing of it.
    const since = mine?.began ?? mine?.ts ?? 0
    const unseen = said.filter((e) => inThread(e) && familyName(e.from) !== family && e.ts >= since)
    if (!unseen.length) return mine && this.bringOut(id, mine.from)
    const owner = this.agents.get(you.to) ?? this.agents.get(this.baseOf(you.to))
    const asked = root?.closed ?? 0
    // (one you stopped isn't asked for a closing line either: that would be its work going on)
    const up = owner && !owner.off && !this.parked && !owner.moving && !owner.halted && owner.status !== 'stopped' && owner.status !== 'away' && this.workable(owner)
    if (!up || now - asked < THREAD_ASK_AGAIN) return this.bringOut(id)
    if (root) this.amend(root, { closed: now })
    this.queue(owner, { ...cliquePrompt(owner, CLOSE_THREAD(threadDigest(unseen))), closes: id, closeRe: you.id, ...(you.channel && { channel: you.channel }) })
    this.pump(owner)
  }

  // What a thread comes to, into the channel: what `name` last said in it, or else the last report anyone gave.
  bringOut(id, name, { quietly = false } = {}) {
    const said = (x) => x.thread === id && x.kind === 'reply' && !x.empty
    // (nobody named: the last report not in the channel yet)
    const e = name ? this.feed.findLast((x) => said(x) && familyName(x.from) === familyName(name)) : this.feed.findLast((x) => said(x) && !x.out)
    if (!e || e.out) return
    if (quietly) this.amend(e, { out: true })
    else this.surface(e, { out: true })
  }

  // A later change to a feed entry (a question's answer), saved after it so it survives a restart.
  amend(e, patch) {
    Object.assign(e, patch)
    this.sizes.delete(e)
    this.save({ amend: e.id, ...patch })
    this.changed()
  }

  // A line that leaves the chat (another says it again, better). feed.jsonl drops it when it's next read or written.
  unsay(e) {
    const i = this.feed.indexOf(e)
    if (i < 0) return
    this.feed.splice(i, 1)
    this.sizes.delete(e)
    this.save({ amend: e.id, gone: true })
    this.changed()
  }

  // Appended, one line after another, until feed.jsonl holds about twice what's kept (rewriteAt): then it's written
  // anew with what's kept (the line included), so it never grows past about that.
  save(line) {
    const text = JSON.stringify(line) + '\n'
    this.feedFile.lines++
    this.feedFile.bytes += Buffer.byteLength(text)
    if (this.feedFile.lines > this.feedFile.at.lines || this.feedFile.bytes > this.feedFile.at.bytes) return this.rewriteFeed()
    this.saving = this.saving.then(() => fs.promises.appendFile(this.at('feed.jsonl'), text)).catch(() => {})
  }

  // ---- an agent moving between computers (core/move.js) ---------------------------------------------

  // feed.jsonl, written anew with what's kept of the chat: when it holds twice that (save), and when lines leave with an
  // agent that moves away or arrive (older than what's here) with one that moves in. The lines are taken now, so one
  // posted meanwhile lands after them. `keep`: ids to keep however old (see trimFeed).
  rewriteFeed(keep) {
    this.trimFeed(keep)
    const text = this.feed.map((e) => JSON.stringify(e) + '\n').join('')
    const bytes = Buffer.byteLength(text)
    this.feedFile = { lines: this.feed.length, bytes, at: rewriteAt(this.feed.length, bytes) }
    this.saving = this.saving.then(() => replaceFileAsync(this.at('feed.jsonl'), text)).catch(() => {})
  }

  // Lines from another computer, for an agent that moved here: merged in by time. `keep`: the ids of the ones it still
  // needs (what it was answering), kept however old they are.
  adoptFeed(entries, keep = []) {
    const have = new Set(this.feed.map((e) => e.id))
    this.feed.push(...entries.filter((e) => !have.has(e.id)))
    this.feed.sort((x, y) => x.ts - y.ts)
    this.rewriteFeed(keep)
    this.changed()
  }

  // An agent goes by another name now (it moved to another computer, or here): `from` and `to` as this computer
  // writes them (iris, iris@laptop). Lines in the chat, the Tasks board and what you've read follow it.
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
    for (const book of [this.reads.agents, ...Object.values(this.reads.channels ?? {})]) {
      if (book[from] === undefined) continue
      book[to] = Math.max(book[to] ?? 0, book[from])
      delete book[from]
      this.saveReads()
    }
    this.changed()
    return feed
  }

  changed() {
    this.emit('change')
    if (this.keepRuntime) this.saveRuntime()
  }

  // ---- outliving CLIque: picking agents up again after a restart ----------------------------------------------
  // With the terminal host, quitting CLIque leaves the agents' CLIs running. What CLIque knew about them (what each is
  // answering, its queue, its clones, questions between them, who holds which file) is saved as it changes, and read
  // back when CLIque starts again and finds their terminals still there. Hook events they sent meanwhile were spooled
  // (adapters.js) and replay in order, so a reply finished while CLIque was closed still lands in the chat, threaded.

  saveRuntime(now = false) {
    clearTimeout(this.runtimeTimer)
    const write = () => {
      const agents = {}
      for (const a of this.agents.values()) {
        if ((a.status === 'off' || a.status === 'resting') && !a.inbox.length) continue
        const s = {}
        for (const k of KEEP) if (a[k] !== undefined) s[k] = a[k]
        agents[a.name] = { ...s, inbox: a.inbox, serving: a.serving ?? [], expect: a.expect ?? null, steering: a.steering ? { text: a.steering.text, msgs: a.steering.msgs, at: a.steering.at } : null }
      }
      const calls = [...this.calls.values()].map((c) => ({ ...c, msg: c.msg?.id, to: this.ownerOf(c), hold: null }))
      try {
        fs.writeFileSync(this.at(RUNTIME), JSON.stringify({ at: Date.now(), agents, calls, leases: [...this.leases].filter(([, l]) => this.mine(l, l.name)), held: [...this.held].filter(([, h]) => (h.name === 'you' ? (h.ws ?? this.ws) === this.ws : this.mine(h, h.name))) }))
      } catch {}
    }
    if (now) return write()
    this.runtimeTimer = setTimeout(write, 300)
    this.runtimeTimer.unref?.()
  }

  // The terminals that survived, matched with what was saved about them. Returns the names picked up. Any other terminal
  // (its agent was removed or turned off meanwhile, or nothing is known about it) is stopped. Queues of agents whose CLI
  // ended while CLIque was closed still go to them once they start again.
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
      // (a note of the app's own, queued before its rename, and images written down before its folder moved)
      const mine = (m) => live(movedImages(m.crew && !m.clique ? { ...m, clique: m.crew } : m))
      a.inbox = (s.inbox ?? []).map(mine)
      a.serving = (s.serving ?? []).map(mine)
      a.expect = s.expect ? { ...s.expect, msgs: s.expect.msgs.map(mine) } : null
      a.steering = s.steering ? { ...s.steering, msgs: s.steering.msgs.map(mine) } : null
      Object.assign(a, { subs: new Map(), subPending: [] })
      this.runs.set(p.tag, { name, file: this.at(GROUPS, `${name}.${p.tag}`), pid: p.pid, at: 0 })
      adopted.add(name)
      // its trust question, up or still to come: watched for again, and its card back up (the last one closed with the
      // chat when CLIque quit) with the screen as it last was
      if (a.status === 'starting' || a.trustAsk) Object.assign(a, { trust: TRUST[this.providerOf(a)?.cli] ?? null, boot: '' })
      if (a.trustAsk && a.trust) {
        a.boot = String(this.runner.buffer?.(name)?.data ?? '').slice(-6000)
        this.trustCard(a)
      } else a.trustAsk = false
      if (a.status === 'starting') this.readyIn(a)
      if (a.status === 'working' && a.expect) this.awaitPickup(a)
      if (a.retrying) a.retryTimer = setTimeout(() => this.resumeTurn(a), API_RETRY[0])
    }
    for (const [name, s] of Object.entries(states)) {
      if (adopted.has(name) || !s.inbox?.length) continue
      const a = this.agents.get(name) ?? this.agents.get(s.cloneOf)
      if (!a || a.off) continue
      for (const m of s.inbox.map(live)) {
        if (m.to !== a.name && !m.clique) this.amend(m, { to: a.name }) // a clone's, gone: its original takes it
        this.queue(a, m)
      }
    }
    for (const c of saved.calls ?? []) this.calls.set(c.id, { ...c, msg: c.msg ? this.feed.find((e) => e.id === c.msg) : undefined, hold: null })
    for (const [file, l] of saved.leases ?? []) if (adopted.has(l.name)) this.leases.set(file, { ...l, ws: this.ws })
    for (const [k, h] of saved.held ?? []) if (h.name === 'you' || adopted.has(h.name)) this.held.set(k, { ...h, ws: this.ws })
    if (adopted.size) this.post({ kind: 'event', from: 'clique', text: `picked up ${atNames([...adopted])} where ${adopted.size === 1 ? 'it was' : 'they were'}: ${adopted.size === 1 ? 'it' : 'they'} kept working while CLIque was closed` })
    return adopted
  }

  // What agents' hooks couldn't tell CLIque while it was closed, in the order it happened: an agent's <name>.jsonl.1
  // (what came before its spool filled up: SPOOL_MAX, core/keep.js), then one a hook was moving there when it was cut
  // short (<name>.jsonl.<its pid>), then its <name>.jsonl.
  replaySpool() {
    let files = []
    try {
      files = fs.readdirSync(this.at(SPOOL))
    } catch {}
    const nameOf = (f) => f.replace(/\.jsonl(\.\d+)?$/, '')
    const order = (f) => `${nameOf(f)}\0${f.endsWith('.jsonl.1') ? 0 : f.endsWith('.jsonl') ? 2 : 1}`
    files.sort((x, y) => (order(x) < order(y) ? -1 : 1))
    for (const f of files) {
      const file = this.at(SPOOL, f)
      let text = ''
      try {
        text = fs.readFileSync(file, 'utf8')
        fs.rmSync(file)
      } catch {
        continue
      }
      const name = nameOf(f)
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

  // Each provider's usage limits that haven't reset yet (your accounts', the same from any workspace's hub).
  usageNow() {
    return Object.fromEntries(Object.keys(this.usage).map((id) => [id, { label: this.providers[id]?.label ?? id, at: this.usage[id].at, windows: this.liveUsage(id).map((w) => ({ ...w, pace: this.pace(id, w) ?? undefined })), ...(this.usage[id].credits && { credits: this.usage[id].credits }) }]).filter(([, u]) => u.windows.length))
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
        name: a.name, ...(a.system && { system: true }), area: a.area, prompt: a.prompt, images: a.images, provider: this.providerOf(a)?.id ?? a.provider, model: a.model, effort: a.effort, cwd: a.cwd,
        tier: a.tier, fast: this.providerOf(a)?.fastByDefault === undefined ? undefined : a.tier ? a.tier === 'fast' : this.providerOf(a).fastByDefault,
        args: (a.args ?? []).join(' '), avatar: a.avatar, status: this.parked && !a.off && a.status === 'off' ? 'parked' : a.status, since: a.since, activity: a.activity,
        queue: a.inbox.length, yolo: Boolean(a.yolo), pending: Boolean(a.relaunch), on: !a.off, stats: this.statsOf(a), nearLimit: this.nearLimit(this.providerOf(a)?.id),
        // how full, measured against its own context limit when it has one
        convo: this.convos[a.name] ? { ...this.convos[a.name], context: againstLimit(this.convos[a.name].context, a.contextLimit) } : null,
        contextLimit: Number(a.contextLimit) > 0 ? Number(a.contextLimit) : null, onContextLimit: a.onContextLimit === 'notify' ? 'notify' : 'fresh',
        freshPending: Boolean(a.freshPending), ticket: this.convos[a.name]?.ticket ?? null,
        // in a turn you can stop (Stop shows only then)
        ...(this.stoppable(a) && { canStop: true }),
        // one of your shared agents (in other workspaces too), or only this one's
        ...(!a.cloneOf && { shared: Boolean(a.shared) }),
        // a clone: whose, and its number (iris.2 is clone 2); it looks like its original
        clones: this.maxClones(a), ...(a.cloneOf && { cloneOf: a.cloneOf, clone: a.clone, avatar: { seed: a.avatar?.seed ?? a.cloneOf, ...a.avatar } }),
        // its sub-agents: the running ones, and ones that just finished
        subs: [...(a.subs?.values() ?? [])].filter((x) => !x.ended || Date.now() - x.ended < SUB_LINGER).map(({ id, type, description, started, ended, tools, activity }) => ({ id, type, description, started, ended, tools, activity })),
        // right of way: the teammates its `clique ask` is waiting on right now, and who's owed an answer by it
        waitingOn: this.waitingOn(a), owes: this.owes(a),
        // what it has leased (clique lease): the simulator, a port
        holds: this.holdsOf(a.name),
        // the channel of what it's working on (none: #general's), so a channel shows who's at work there
        channel: (a.status === 'working' || a.status === 'waiting') ? this.channelFor(a.name) : undefined,
        // the thread of what it's working on, if that has one, so the line saying who's at work can open it
        thread: (a.status === 'working' || a.status === 'waiting') && a.current ? this.threadOf(a.current) : undefined,
      })),
      feed: withOpenAsks(forClients(this.feed), this.asks),
      channels: this.space.channels,
      reads: this.reads,
      spend: this.spendNow(),
      // { claude: { label, at, windows: [{ id, pct, resetsAt, label? }], credits? } }
      // each window with where it's heading at this pace: { projected (percent at its reset), runsOut (ms) }
      usage: this.usageNow(),
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
// Which channel's brief a message carried in (see Hub.briefed), so it can be taken back if it never went in.
const BRIEFED = new WeakMap()
// Which version of a channel's brief an agent was given (FNV-1a): a changed brief is given again.
const briefHash = (text) => {
  let h = 0x811c9dc5
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0
  return h.toString(36)
}
// Its start and its end: a channel's brief, or a teammate's hand-off tag, starts many messages the same way.
const samePrompt = (reported, sent) => {
  if (reported === undefined) return true
  const [r, s] = [squash(reported), squash(sent)]
  return r.includes(s.slice(0, 60)) && r.includes(s.slice(-60))
}
// What Claude Code submits by itself when a command or sub-agent the agent ran in the background finishes.
const isNotice = (prompt) => /^\s*<task-notification>/.test(String(prompt ?? ''))

// Agents get images as file paths (Claude Code and Codex can both open local images).
const withImages = (text, images) =>
  images?.length ? `${text}\n\nAttached image${images.length > 1 ? 's' : ''} (open to view):\n${images.join('\n')}` : text

// A terminal's text without its escape sequences and spaces: what's on screen, however it was drawn.
const flat = (s) => s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '').replace(/\x1b./g, '').replace(/\s+/g, '')

// Which answer to its trust question is selected on screen: the one right after the last pointer it drew (past a "1."
// in front of it). -> 'yes', 'no', or '' when the screen doesn't say.
function trustSelected(screen, t) {
  const i = screen.lastIndexOf(t.pointer)
  if (i < 0) return ''
  const next = screen.slice(i + t.pointer.length).replace(/^\d+\./, '')
  return next.startsWith(t.yes) ? 'yes' : next.startsWith(t.no) ? 'no' : ''
}
// The arrow key that moves its selection toward the answer wanted: down if that answer was last drawn after the
// pointer, up if before. '' when the screen shows no pointer, or not that answer.
function trustKey(screen, t, want) {
  const at = screen.lastIndexOf(t.pointer)
  const label = screen.lastIndexOf(want === 'yes' ? t.yes : t.no)
  return at < 0 || label < 0 ? '' : label > at ? '\x1b[B' : '\x1b[A'
}
// The folder an agent works in, however it's written (~, a trailing slash).
const folderOf = (a) => (a ? path.resolve(expand(a.cwd)) : null)

const hold = (a, ms) => {
  a.holdUntil = Math.max(a.holdUntil, Date.now() + ms)
}

// A prompt from CLIque itself, queued like a message (it isn't one: it's not in the chat). See move.js.
// A thread counts as over this long after its last line, with nobody still on it. A question at the end of an agent's reply
// waits as long for a teammate to take it up, before it's brought out to you. Short, because you're waiting: whoever is
// still at work or has a message queued keeps the thread going however long that takes (threadBusy).
const THREAD_QUIET = 20000
const THREAD_LOOK = 10000
// How soon a thread's addressee may be asked for a closing line again, however much more gets said.
const THREAD_ASK_AGAIN = 10 * 60000
// A thread that was going when CLIque closed, back open within this long, carries on where it was.
const THREAD_RESUME = 60 * 60000
const CLOSE_THREAD = (said) => `[clique] The thread your request led to has gone quiet.${said ? ` What was said since your last message:\n\n${said}\n\n` : ' '}Tell the user where it ended, in one or two sentences: what's done, what isn't, and anything they have to do. If something failed or wasn't checked, say that first. Don't start anything new or message anyone. If your last message to them already says all that, reply with just: nothing new`
// How long Q may take starting up before what you send stops waiting for him.
const SYSTEM_AGENT_START_MAX = 90000
const cliquePrompt = (a, text, id) => ({ id: id ?? randomUUID().slice(0, 8), ts: Date.now(), kind: 'msg', from: 'you', to: a.name, text, clique: true, queued: true })

// The last time anyone but CLIque did something with a task: added it, started it, wrote a note, moved it.
const lastWord = (t) => t.log.findLast((l) => l.by !== 'clique')?.ts ?? t.created

// What `clique lease` calls a thing, however it's written: "iOS  Simulator" and "ios simulator" are one.
const leaseKey = (thing) => String(thing ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60)

// Claude Code runs every command through bin/clique-sh, which writes down its process group (see Hub.sweep). Your own
// prefix, if you have one, still runs after it (unless it's clique-sh itself: CLIque started from an agent's terminal).
// Claude Code (2.1.316) shell-quotes the prefix, spaces and all, but takes whatever follows its last " -" as options for
// it, so in a folder with " -" in its name there's none, and the agent's process tree alone says what it leaves running.
// Its docs promise only "<prefix> '<command>'" (env-vars: CLAUDE_CODE_SHELL_PREFIX), so on Windows, where CLIque's
// folder is under C:\Users\<you> and often has spaces, the prefix is the bare name clique-sh: Git Bash finds it on the
// agent's PATH, in bin\win32-<arch> (core/launch.js withTools), where copies of clique-sh and clique-sh.cmd sit, and an
// MCP server's start finds clique-sh.cmd there. CLIQUE_BASH is the Git Bash Claude Code runs commands with, for
// clique-sh.cmd. There clique-sh is tried once first (prefixWorks), with the agent's PATH: if Git Bash won't find it or run
// it right, commands run without it instead of failing.
export const shellPrefix = (bin, env = process.env, platform = process.platform, works = prefixWorks) => {
  const win = platform === 'win32'
  const sh = win ? 'clique-sh' : path.posix.join(bin, 'clique-sh')
  if (sh.includes(' -')) return {}
  const bash = win ? gitBash(env) : null
  if (win && !works(sh, bash, withTools(env, bin, { platform }))) return {}
  const yours = env.CLAUDE_CODE_SHELL_PREFIX
  const again = yours && /^clique-sh(\.cmd)?$/i.test(path.posix.basename(yours.replaceAll('\\', '/')))
  return { CLAUDE_CODE_SHELL_PREFIX: sh, ...(yours && !again && { CLIQUE_SHELL_PREFIX: yours }), ...(win && { CLIQUE_BASH: bash }) }
}

// Where a message goes in an agent's queue: answers to its questions, then questions for it, then the rest.
const rank = (m) => (m.answers ? 0 : m.ask ? 1 : 2)

// How long a window is (Codex names its own by length: window_120 is two hours); null when unknown, as a spend limit's is.
// Two lines about the same usage window: one account's, one window of it, the same reset (give or take a minute).
const sameWindow = (a, b) => Boolean(a && b && a.account === b.account && a.window === b.window && Math.abs(a.resetsAt - b.resetsAt) <= 60000)
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

// Agents named in a line of the chat: "@ada", "@ada and @june", "@ada, @june and @milo".
const atNames = (names) => (names.length > 1 ? `${names.slice(0, -1).map((n) => `@${n}`).join(', ')} and @${names.at(-1)}` : names.map((n) => `@${n}`).join(''))

// A message in one line, for quoting it back: code blocks folded, cut at `max`.
const gist = (text, max = 100) => {
  const line = String(text ?? '').replace(/```[\s\S]*?```/g, '[code]').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// The end of a file (an agent's transcript), or '' when it can't be read.
function tailOf(file, bytes = 64 * 1024) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const buf = Buffer.alloc(Math.min(bytes, size))
    fs.readSync(fd, buf, 0, buf.length, size - buf.length)
    return buf.toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
// When a file last changed (an agent's transcript: its last request), or 0.
const mtimeOf = (file) => {
  try {
    return file ? fs.statSync(file).mtimeMs : 0
  } catch {
    return 0
  }
}
// "26 days", "15 hours", "2 hours", "50 minutes"
const spanOf = (ms) => {
  const [n, unit] = ms >= 2 * 864e5 ? [Math.round(ms / 864e5), 'day'] : ms >= 2 * 36e5 ? [Math.round(ms / 36e5), 'hour'] : ms >= 36e5 ? [1, 'hour'] : [Math.max(1, Math.round(ms / 60000)), 'minute']
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

// The files a tool call is about to write: Claude Code's file tools name one, and Codex's apply_patch lists them in the
// patch (in whichever field its input carries it). -> Map of lease key (see fileKey) -> the file's absolute path
function editedFiles({ tool_name: tool = '', tool_input: input } = {}, cwd) {
  if (!input || typeof input !== 'object') return new Map()
  const named = input.file_path ?? input.notebook_path
  const strings = Object.values(input).flatMap((v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []))
  // a patch counts when it's apply_patch's own input, or a shell command that runs apply_patch (not a `clique ask` that
  // quotes one, say)
  const patch = tool === 'apply_patch' || strings.some((x) => /(^|[\s;&|(])apply_patch\b/.test(x) && !/^\s*clique\s/.test(x))
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

// The chat as feed.jsonl has it, down to what's kept of it (core/keep.js): `keep` holds the ids of lines the agents at
// work still point at (runtimeIds). A file that holds more than twice that is written anew. -> { feed, lines, bytes }:
// the lines, and how much the file holds now.
function loadFeed(file, keep = new Set()) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return { feed: [], lines: 0, bytes: 0 }
  }
  const lines = text.split('\n').filter((l) => l.trim())
  const all = []
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
    // (what the app said in the chat before its rename, it said as "crew")
    if (e.from === 'crew') e.from = 'clique'
    if (e.cli === 'crew') e.cli = 'clique'
    const entry = { ...movedImages(e), queued: false, held: false }
    all.push(entry)
    byId.set(entry.id, entry)
  }
  // An unanswered question's hook ended with the last run: the agent isn't waiting on it any more. (An agent tool's
  // agent was told to wait for a message: lost says to tell it, see toolsLost.)
  for (const e of all) if (e.kind === 'ask' && !e.answer) e.answer = { stale: true, ...(e.ask?.app && { lost: true, at: Date.now() }) }
  stampAll(all)
  const feed = keepFeed(all.filter((e) => !e.gone), { needed: (e) => keep.has(e.id) })
  const bytes = Buffer.byteLength(text)
  const at = rewriteAt(feed.length, feed.reduce((n, e) => n + lineSize(e), 0))
  if (lines.length <= at.lines && bytes <= at.bytes) return { feed, lines: lines.length, bytes }
  const kept = feed.map((e) => JSON.stringify(e) + '\n').join('')
  try {
    replaceFile(file, kept)
  } catch {
    return { feed, lines: lines.length, bytes }
  }
  return { feed, lines: feed.length, bytes: Buffer.byteLength(kept) }
}

// The ids of the feed lines that what CLIque saved about its agents at work (runtime.json, see saveRuntime) points at:
// what each is answering, its queue, what a teammate's question is about.
function runtimeIds(saved) {
  const ids = new Set()
  for (const s of Object.values(saved?.agents ?? {})) {
    if (s?.current) ids.add(s.current)
    for (const m of [...(s?.inbox ?? []), ...(s?.serving ?? []), ...(s?.expect?.msgs ?? []), ...(s?.steering?.msgs ?? [])]) if (m?.id) ids.add(m.id)
  }
  for (const c of saved?.calls ?? []) if (c?.msg) ids.add(c.msg)
  return ids
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

// A reply is kept whole up to here: a plan or a review runs past 4000 characters, and the chat (on the computer and the
// phone) is where you read it. Past it, the cut shows as "…" instead of stopping mid-word.
const REPLY_MAX = 16000
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
    // Claude Code's PowerShell tool, on Windows: a command like any other to whoever answers
    PowerShell: { title: 'Run a command', code: clip(input.command), detail: input.description },
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
    stems: ['organi', 'orchestrat', 'coordinat', 'delegat', 'dispatch', 'triag', 'assign', 'reassign', 'prioriti', 'admin', 'assistant', 'clique', 'roster', 'handoff'],
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

// Who a message is addressed to: `to` (one name, "ada,june", "ada june", or "any"/empty) plus every
// bare @name in the text, wherever it is. The text itself is left as written. Not addresses: @words glued to
// something (someone@example.com, @types/node, @ada's), code in backticks, and @any/@you/@clique.
// Names are case-insensitive and come back lowercase, without duplicates, in the order they appear.
// An agent on another computer is name@computer: "@iris@workstation" in text, or "iris@workstation" in `to`.
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
// warm (warmRoute): a tie that's left goes to the one cheaper to wake (Hub.warmth's `wake`), when both say.
export function bestFor(text, agents, { warm = false } = {}) {
  const score = areaScore(text)
  const free = (a) => Number((a.status === 'idle' || a.status === 'resting') && !a.queue)
  const near = (a) => Number(Boolean(a.nearLimit))
  const cheap = (x, y) => (warm && x.wake !== undefined && y.wake !== undefined ? x.wake - y.wake : 0)
  return [...agents].sort((x, y) => score(y) - score(x) || near(x) - near(y) || free(y) - free(x) || x.queue - y.queue || cheap(x, y))[0]
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

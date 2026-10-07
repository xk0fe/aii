// The brain: agents, their status, inboxes, the shared feed and routing. No Electron in here.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { adapters } from './adapters.js'
import { providersFrom, expandEnv, discoverCodex } from './providers.js'
import { generatePrompt } from './promptgen.js'

export const HOME = process.env.CREW_HOME || path.join(os.homedir(), '.crew')
export const CONFIG = path.join(HOME, 'config.json')
export const ATTACHMENTS = path.join(HOME, 'attachments')
const localDay = (t = Date.now()) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const at = (file) => path.join(HOME, file)

const DEFAULTS = { autopilot: true, theme: 'system', hotkey: 'Alt+Shift+Space', agents: [] }
const AGENT_KEYS = ['area', 'prompt', 'images', 'provider', 'cli', 'model', 'effort', 'tier', 'cwd', 'args', 'yolo', 'off', 'avatar']
const RESERVED = new Set(['you', 'any', 'crew'])
const FEED_KEEP = 300
const STOP_WORDS = new Set(
  'a an and are as at be but by can could do for from has have if in into is it me my no not of on or our please should so that the this to up us we with would you your'.split(' '),
)

export class Hub extends EventEmitter {
  agents = new Map()
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
    for (const name of this.agents.keys()) {
      if (names.has(name)) continue
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
      if (a && this.runner.running(n) && this.launchKey(a) !== before.get(n)) this.relaunchWhenFree(a)
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
    const teammates = [...this.agents.values()].filter((a) => a.name !== agent.name).map((a) => `${a.name} (${a.area || 'general'})`).join(', ')
    return generatePrompt(agent, provider, teammates)
  }

  providerOf(a) {
    return this.providers[a.provider ?? a.cli ?? 'claude']
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
    a.relaunch = false
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
    const { file, args, readyAfter } = adapter(a, { resume, session: randomUUID(), attachments: ATTACHMENTS })
    a.resumed = Boolean(resume)
    try {
      const cwd = expand(a.cwd)
      if (!fs.existsSync(cwd)) throw new Error(`folder not found: ${cwd}`)
      const env = { ...expandEnv(provider.env), PATH: `${this.bin}:${process.env.PATH}`, CREW_AGENT: a.name, CREW_URL: this.url, CREW_TOKEN: this.token, CREW_HOME: HOME }
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

  onExit(name, code, ms) {
    const a = this.agents.get(name)
    if (!a) return
    this.setStatus(a, 'stopped')
    if (a.resumed && code !== 0 && ms < 5000) {
      this.post({ kind: 'event', from: name, text: "couldn't resume the previous session, starting a fresh one" })
      return this.launch(a, true)
    }
    this.post({ kind: 'event', from: name, text: code ? `exited (code ${code})` : 'exited' })
  }

  saveSession(name, id) {
    if (id) this.sessions[name] = id
    else delete this.sessions[name]
    fs.writeFileSync(at('sessions.json'), JSON.stringify(this.sessions, null, 2) + '\n')
  }

  // ---- status, from Claude Code hooks ------------------------------------

  onHook(name, e) {
    const a = this.agents.get(name)
    if (!a) return
    a.hookAt = Date.now()
    switch (e.hook_event_name) {
      case 'SessionStart': // Claude: at launch. Codex: with the first prompt, so only "starting" counts.
        if (e.source === 'compact' || a.status !== 'starting') return
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
        a.turnStart = Date.now()
        return this.setStatus(a, 'working')
      case 'PreToolUse': // only AskUserQuestion is hooked
        return this.needsYou(a, `asks: ${e.tool_input?.questions?.[0]?.question ?? 'a question'}`)
      case 'PostToolUse':
        a.activity = describe(e)
        this.record(name, { tools: 1 })
        return this.setStatus(a, 'working')
      case 'Notification':
        if (a.status === 'working') this.needsYou(a, e.message || 'needs your input')
        return
      case 'PermissionRequest':
        return this.needsYou(a, `wants to run ${describe(e)}`)
      case 'Interrupt':
        a.activity = ''
        a.turnStart = null
        return this.setStatus(a, 'idle')
      case 'Stop':
        a.activity = ''
        if (a.turnStart) this.record(name, { turns: 1, turnMs: Date.now() - a.turnStart })
        a.turnStart = null
        if (e.last_assistant_message) this.post({ kind: 'reply', from: name, text: e.last_assistant_message.slice(0, 4000), ...(a.current && { re: a.current }) })
        hold(a, 600)
        return this.setStatus(a, 'idle')
    }
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
    if (status === 'idle' && a.relaunch) return this.launch(a)
    if (status === 'idle') this.pump(a)
    this.changed()
  }

  // ---- work experience: what each agent actually did, kept across restarts -----

  record(name, counts) {
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
    const s = this.stats[a.name] ?? { days: {} }
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
  send({ from = 'you', to, text, images = [], mentions = true }) {
    text = String(text ?? '').trim()
    images = [].concat(images).filter((p) => typeof p === 'string' && p.startsWith(ATTACHMENTS + path.sep))
    if (!text && images.length) text = images.length > 1 ? 'Have a look at these images.' : 'Have a look at this image.'
    if (!text) throw new Error('nothing to send')
    // a bare name that isn't here but is on exactly one linked computer means that agent
    const all = addressees(to, mentions ? text : '').map((n) => (n.includes('@') || this.agents.has(n) ? n : (this.elsewhere?.(n) ?? n)))
    const away = all.filter((n) => n.includes('@'))
    const names = all.filter((n) => !n.includes('@'))
    if (away.length && !this.relay) throw new Error(`${away.map((n) => `@${n}`).join(', ')} is on another computer, and Crew Link isn't on`)
    if (away.length && !names.length) return this.relay(from, away, text, images)
    const targets = names.length ? this.recipients(names, from) : [this.route(text, from)]
    if (!targets[0]) throw new Error('no agents to send to')

    const held = from !== 'you' && !this.config.autopilot
    const re = this.agents.get(from)?.current // a hand-off points at the request that led to it
    if (this.agents.has(from)) this.record(from, { handoffs: targets.length })
    // Copies of one send share `cc` and `sendId`, so the feed can show them as one message. Each copy keeps its own
    // id, queue state and approval.
    const group = targets.length > 1 && { cc: targets.map((a) => a.name), sendId: randomUUID().slice(0, 8) }
    const msgs = targets.map((a) =>
      this.post({ kind: 'msg', from, to: a.name, text, ...group, ...(images.length && { images }), ...(re && { re }), queued: !held, held }),
    )
    if (held) return `waiting for the user to approve this hand-off to ${targets.map((a) => `@${a.name}`).join(' ')}\n`
    const here = targets.map((a, i) => this.enqueue(a, msgs[i])).join('')
    return away.length ? this.relay(from, away, text, images).then((there) => here + there) : here
  }

  recipients(names, from) {
    const list = (xs) => xs.map((n) => `@${n}`).join(', ')
    const after = names.length > 1 ? ' (nothing was sent)' : ''
    const unknown = names.filter((n) => !this.agents.has(n))
    if (unknown.length) throw new Error(`no agent named ${unknown.map((n) => `"${n}"`).join(', ')} (try: crew who)${after}`)
    if (names.includes(from)) throw new Error(`${names.length > 1 ? `@${from} is you, leave yourself off` : "that's you, pick a teammate (crew who)"}${after}`)
    const off = names.filter((n) => this.agents.get(n).off)
    if (off.length) throw new Error(`${list(off)} ${off.length > 1 ? 'are' : 'is'} turned off, turn ${off.length > 1 ? 'them' : 'it'} on first${after}`)
    return names.map((n) => this.agents.get(n))
  }

  enqueue(a, msg) {
    a.inbox.push(msg)
    const busy = a.status !== 'idle' || a.inbox.length > 1
    this.pump(a)
    return busy ? `queued for @${a.name} (${a.status}, ${a.inbox.length} waiting)\n` : `sent to @${a.name}\n`
  }

  // Hand-offs between agents wait here for you when autopilot is off.
  approve(id) {
    const msg = this.feed.find((m) => m.id === id && m.held)
    const a = msg && this.agents.get(msg.to)
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
    const ready = [...this.agents.values()].filter((a) => a.name !== from && this.runner.running(a.name))
    const best = bestFor(text, ready.map((a) => ({ name: a.name, area: a.area, status: a.status, queue: a.inbox.length })))
    return best && this.agents.get(best.name)
  }

  // Deliver the next queued message once the agent is idle and nothing asked to hold off (e.g. you typing in its terminal).
  pump(a) {
    clearTimeout(a.timer)
    if (a.status !== 'idle' || !a.inbox.length || !this.runner.running(a.name)) return
    const wait = a.holdUntil - Date.now()
    if (wait > 0) {
      a.timer = setTimeout(() => this.pump(a), wait)
      return
    }
    const msg = a.inbox.shift()
    msg.queued = false
    const also = msg.cc?.filter((n) => n !== a.name).map((n) => `@${n}`).join(' ')
    const tag = [msg.from !== 'you' && `from @${msg.from}`, also && `also sent to ${also}, split the work`].filter(Boolean).join(', ')
    const text = tag ? `[${tag}] ${msg.text}` : msg.text
    this.runner.submit(a.name, withImages(text, msg.images))
    // Matched against the prompt the agent reports, even if it shows up late. Only the words count:
    // Claude Code turns attached image paths into "[Image #1]" and moves them around.
    a.expect = { id: msg.id, text }
    this.record(a.name, { [msg.from === 'you' ? 'fromYou' : 'fromTeam']: 1, delivered: 1, queuedMs: Date.now() - msg.ts })
    this.awaitPickup(a)
    this.setStatus(a, 'working')
  }

  // UserPromptSubmit cancels this. Until then, press Enter again in case the first one was swallowed.
  // Slow starters (a CLI still loading its MCP servers) get about 20s before we call for help.
  awaitPickup(a, waits = [2500, 3000, 14000]) {
    clearTimeout(a.ack)
    const [ms, ...rest] = waits
    a.ack = setTimeout(() => {
      if (a.status !== 'working') return
      if (!rest.length) return this.needsYou(a, "didn't pick up the last message, check its terminal")
      this.runner.write(a.name, '\r')
      this.awaitPickup(a, rest)
    }, ms)
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
    const rows = [...this.agents.values()].map((a) => {
      const queue = a.inbox.length ? `, ${a.inbox.length} queued` : ''
      if (a.off) return `${a.name.padEnd(16)} off`
      const brain = [this.providerOf(a)?.label, a.model, a.effort].filter(Boolean).join(' ')
      return `${a.name.padEnd(16)} ${(a.status + queue).padEnd(20)} ${brain.padEnd(22)} ${a.area ?? ''}`
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
    fs.appendFile(at('feed.jsonl'), JSON.stringify(e) + '\n', () => {})
    this.changed()
    return e
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
      agents: [...this.agents.values()].map((a) => ({
        name: a.name, area: a.area, prompt: a.prompt, images: a.images, provider: this.providerOf(a)?.id ?? a.provider, model: a.model, effort: a.effort, cwd: a.cwd,
        tier: a.tier, fast: this.providerOf(a)?.fastByDefault === undefined ? undefined : a.tier ? a.tier === 'fast' : this.providerOf(a).fastByDefault,
        args: (a.args ?? []).join(' '), avatar: a.avatar, status: a.status, since: a.since, activity: a.activity,
        queue: a.inbox.length, yolo: Boolean(a.yolo), pending: Boolean(a.relaunch), on: !a.off, stats: this.statsOf(a),
      })),
      feed: this.feed.slice(-200),
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
  return lines.slice(-FEED_KEEP).flatMap((line) => {
    try {
      return [{ ...JSON.parse(line), queued: false, held: false }]
    } catch {
      return []
    }
  })
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
  const words = new Set(tokens(text))
  const asks = intents(text)
  const score = (a) => {
    const own = `${a.name.split('@')[0]} ${a.area ?? ''}`
    return [...new Set(tokens(own))].filter((w) => words.has(w)).length + 2 * [...intents(own)].filter((i) => asks.has(i)).length
  }
  const free = (a) => Number(a.status === 'idle' && !a.queue)
  return [...agents].sort((x, y) => score(y) - score(x) || free(y) - free(x) || x.queue - y.queue)[0]
}

function describe({ tool_name: tool, tool_input: input = {} }) {
  const arg = input.file_path ? path.basename(input.file_path) : (input.command ?? input.pattern ?? input.url ?? input.description ?? '')
  const short = String(arg).split('\n')[0].slice(0, 60)
  return short ? `${tool} · ${short}` : tool
}

// One crew across your computers: this computer's hub plus every linked computer's agents, merged into one
// list (agents elsewhere are name@computer), with each action routed to the computer the agent lives on.
// No Electron in here: main.js owns windows and dialogs and talks to this.
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Hub, HOME, ATTACHMENTS, addressees, bestFor, openConfig } from './hub.js'
import { Runner, Scoped } from './runner.js'
import { DEFAULT, workspacesIn, space, addWorkspace, setLook, dropWorkspace, addChannel, editChannel, dropChannel } from './workspaces.js'
import { HostRunner } from './ptyclient.js'
import { serve } from './server.js'
import { LinkHost, LinkClient, identity, addresses, firewallWarning, makeCode, readCode, slug, DEFAULT_PORT } from './link.js'
import { packAgents, unpackAgents } from './pack.js'
import { moveOut, moveRead, moveEnd, moveWrite, moveIn, moveDrop, agentMoved, folderInfo, folders } from './move.js'
import { Phones } from './phones.js'
import { sweepFiles, ATTACHMENT_DAYS, CACHE_DAYS } from './keep.js'

export const LINK_DIR = path.join(HOME, 'link')
export const CACHE = path.join(LINK_DIR, 'cache')
const SETTINGS = path.join(LINK_DIR, 'link.json')
// Images nothing needs any more go this long after Crew starts (sweepImages), once its workspaces have read their chats.
const SWEEP_AFTER = 60000
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const readJSON = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export class Crew extends EventEmitter {
  links = new Map() // computer slug -> { slug, name, peer, client, state, toHost, fetching }

  // host: run the agents' terminals in the terminal host, where they outlive Crew ({ file, env }: how to run it as
  // Node, core/ptyclient.js). Without it they live in this process and stop with it.
  constructor({ bin, computerName, host }) {
    super()
    // { share, port, key, name, peers: [codes], hidden: [agent names] }
    this.settings = readJSON(SETTINGS) ?? {}
    if (this.settings.remote) this.settings.peers = [this.settings.remote] // from when a link replaced this crew
    delete this.settings.remote
    this.me = { name: this.settings.name || computerName, slug: slug(this.settings.name || computerName) }
    // the phones paired with this computer; main.js serves them (core/remote.js)
    this.phones = new Phones(LINK_DIR)
    this.phones.on('change', () => this.changed())
    this.bin = bin
    this.runner = host ? new HostRunner({ runtime: host }) : new Runner()
    // A hub per workspace (core/workspaces.js), all on one config.json, one terminal runner and one local server.
    this.token = crypto.randomBytes(16).toString('hex')
    this.config = openConfig() // read by the first hub, so a broken one is said in its chat
    this.usage = readJSON(path.join(HOME, 'usage.json')) ?? {} // your accounts' limits, the same in every workspace
    this.samples = {} // and their recent readings, for the pace
    this.locks = { files: new Map(), held: new Map(), waits: [] } // files being edited and things leased, in any workspace
    this.hubs = new Map()
    this.hub = this.workspace(DEFAULT) // the default workspace's: what a linked computer on an older Crew sees
    this.syncWorkspaces()
    this.config.on('change', () => this.syncWorkspaces())
  }

  // A workspace's hub, made when it's first needed. What it says to you (alerts, notices) says which workspace it's from,
  // and anything that changes there redraws the app (the switcher counts every workspace).
  workspace(id) {
    let hub = this.hubs.get(id)
    if (hub) return hub
    hub = new Hub(new Scoped(this.runner, id, id === DEFAULT), { bin: this.bin, workspace: id, config: this.config, token: this.token, usage: this.usage, samples: this.samples, locks: this.locks })
    hub.others = () => [...this.hubs.values()].filter((h) => h !== hub)
    hub.hubOf = (ws) => this.hubs.get(ws) // whose a lease is
    hub.aboutAccount = (entry) => this.here.post(entry) // your accounts' limits: said where you are
    // Its agents reach the agents of the same workspace on linked computers (name@computer), and its tasks theirs.
    hub.relay = (from, names, text, images, extra) => this.relay(from, names, text, images, extra, hub)
    hub.relayTask = (host, from, args) => this.linkCall(this.link(host), 'task', [`${from}@${this.me.slug}`, args], hub.ws)
    hub.self = this.me.slug
    hub.directory = () => this.linkedAgents(hub)
    hub.elsewhere = (name) => {
      const there = hub.directory().filter((a) => a.seed === name)
      return there.length === 1 ? there[0].name : undefined
    }
    if (id !== DEFAULT) {
      // the default's go further, to linked computers on older Crews too: see start
      hub.on('notice', (n) => this.emit('notice', { ...n, ...(!n.account && { workspace: id }) }))
      hub.on('alert', (a, text) => {
        this.emit('alert', a.name, text, id)
        this.pushSpace(id, 'alert', `${id}/${a.name}`, text)
      })
      let pending = null
      hub.on('change', () => {
        this.changed()
        if (![...this.links.values()].some((l) => l.peer && l.aware && l.theirs?.has(id))) return
        pending ??= setTimeout(() => {
          pending = null
          if (this.hubs.get(id) === hub) this.pushSpace(id, 'space', id, hub.snapshot())
        }, 50)
      })
    }
    this.hubs.set(id, hub)
    if (this.url) this.startWorkspace(hub)
    return hub
  }

  // A hub for each workspace in config.json; one that's gone stops (its hub has stopped its agents already). The one on
  // screen is the one config.json says ("current"), or the default.
  syncWorkspaces() {
    const ids = new Set([DEFAULT, ...workspacesIn(this.config.data).map((w) => w.id)])
    for (const id of ids) this.workspace(id)
    for (const [id, hub] of this.hubs) {
      if (ids.has(id)) continue
      hub.dispose()
      this.hubs.delete(id)
    }
    // linked computers learn which workspaces this one has now: they drop what's gone, and send theirs for what's new
    const named = [...ids].filter((id) => id !== DEFAULT)
    if (String(named) !== String(this.named ?? '')) (this.named = named), this.pushAware('spaces', named)
    const current = ids.has(this.config.data.current) ? this.config.data.current : DEFAULT
    if (current !== this.current) {
      this.current = current
      this.changed()
    }
  }

  // The workspace on screen: what the app shows, and where what you do in it goes.
  get here() {
    return this.hubs.get(this.current) ?? this.hub
  }

  // Each workspace's agents start unless it's parked; those still at work from before Crew restarted carry on either way
  // (still running: a workspace taken out of config.json and put back has had its stopped).
  startWorkspace(hub, survivors = this.runner.survivors ?? []) {
    const own = survivors.filter((s) => hub.runner.own(s.name) && this.runner.running(s.name)).map((s) => ({ ...s, name: hub.runner.own(s.name) }))
    hub.start(this.url, { survivors: own })
  }

  // ---- workspaces: the switcher, and making, changing, opening and parking them ---------------------------------

  // Every workspace, for the switcher: its look and folder, whether it's on screen or parked, and how it's doing.
  workspaces() {
    // in config.json's order (which order() changes), the default first
    const rank = new Map(workspacesIn(this.config.data).map((w, i) => [w.id, i + 1]))
    return [...this.hubs.values()].sort((a, b) => (a.ws === DEFAULT ? 0 : rank.get(a.ws) ?? Infinity) - (b.ws === DEFAULT ? 0 : rank.get(b.ws) ?? Infinity)).map((h) => ({
      id: h.ws, name: h.space.name, color: h.space.color, icon: h.space.icon, folder: h.space.folder, parked: h.parked, current: h === this.here,
      members: h.ws === DEFAULT ? null : h.space.agents.filter((a) => a.shared).map((a) => ({ name: a.name, folder: this.memberFolder(h.ws, a.name) })),
      ...h.summary(),
    }))
  }

  // A shared agent's own folder in a workspace (empty: it works in the workspace's).
  memberFolder(id, name) {
    const m = workspacesIn(this.config.data).find((w) => w.id === id)?.members?.[name]
    return (m && typeof m === 'object' && m.folder) || ''
  }

  // switch(id): put it on screen. create({ name, color, icon, folder, members }): a new workspace, opened and on screen.
  // edit(id, { name, color, icon, folder }), open(id), park(id), remove(id). order(null, [ids]): the order they're listed
  // in (the default stays first; ids left out keep their order after the ones given). members(id, { add, remove, folders }): which
  // shared agents work there, and the folder each has of its own there ('' for the workspace's). In the default
  // workspace, where every shared agent is, only folders: each agent's own ('' for the home folder).
  workspaceAction(op, id, arg) {
    const data = this.config.data
    const has = (x) => x === DEFAULT || workspacesIn(data).some((w) => w.id === x)
    if (op !== 'create' && op !== 'order' && !has(id)) throw new Error('no such workspace')
    const where = () => space(data, id)
    const ops = {
      switch: () => {
        if (id === DEFAULT) delete data.current
        else data.current = id
      },
      create: () => {
        id = addWorkspace(data, arg ?? {}) // members with folders of their own start there, the first time
        data.current = id
      },
      edit: () => setLook(data, id, arg ?? {}),
      open: () => (where().parked = false),
      park: () => (where().parked = true),
      remove: () => dropWorkspace(data, id),
      order: () => {
        const ids = Array.isArray(arg) ? arg.map(String) : []
        const at = (w) => (w && ids.includes(w.id) ? ids.indexOf(w.id) : ids.length)
        if (Array.isArray(data.workspaces)) data.workspaces = data.workspaces.map((w, i) => [w, i]).sort(([a, i], [b, j]) => at(a) - at(b) || i - j).map(([w]) => w)
      },
      members: () => {
        const { add = [], remove = [], folders = {} } = arg ?? {}
        if (id === DEFAULT && (add.length || remove.length)) throw new Error('every shared agent is in the default workspace')
        const w = where()
        const shared = new Set((data.agents ?? []).map((a) => a?.name))
        for (const name of add) {
          if (!shared.has(name) || w.shared(name)) continue
          if (w.has(name)) throw new Error(`${w.name} has an agent of its own called ${name}`)
          w.join(name, {})
        }
        for (const name of remove) if (w.shared(name)) w.leave(name)
        const now = where() // as it is after joining
        for (const [name, folder] of Object.entries(folders)) if (now.shared(name)) now.set(name, 'cwd', String(folder ?? '').trim() || undefined)
      },
    }
    if (!Object.hasOwn(ops, op)) throw new Error(`unknown workspace action "${op}"`)
    ops[op]()
    this.config.save()
    // parked by hand while Crew was closed, and still running what carried on: park stops those too
    if (op === 'park') this.hubs.get(id)?.park()
    // out right away rather than after the usual pause, so what follows it (a notification's click focusing an agent
    // there) lands in the workspace now on screen
    const state = this.snapshot()
    clearTimeout(this.changeTimer)
    this.emit('state', state)
    return { id, state }
  }

  // The channels of the workspace on screen: channel('create', null, { name, brief, members }), channel('edit', id,
  // { name, brief, members }), channel('remove', id). -> { id, state }
  // ws: the workspace it's for (the sheet's, which may not be on screen any more); the one on screen if not given.
  channelAction(op, id, arg, ws = this.current) {
    if (ws !== DEFAULT && !workspacesIn(this.config.data).some((w) => w.id === ws)) throw new Error('no such workspace')
    const ops = {
      create: () => (id = addChannel(this.config.data, ws, arg ?? {})),
      edit: () => editChannel(this.config.data, ws, id, arg ?? {}),
      remove: () => dropChannel(this.config.data, ws, id),
    }
    if (!Object.hasOwn(ops, op)) throw new Error(`unknown channel action "${op}"`)
    ops[op]()
    this.config.save()
    const state = this.snapshot()
    clearTimeout(this.changeTimer)
    this.emit('state', state)
    return { id, state }
  }

  async start() {
    const server = (this.server = await serve({ token: this.token, hubFor: (id) => this.hubs.get(id) }))
    let survivors = []
    if (this.runner.connect) {
      try {
        survivors = await this.runner.connect()
      } catch (e) {
        // no terminal host: the agents run in here, as before, and stop when Crew quits
        this.runner = new Runner()
        for (const hub of this.hubs.values()) hub.useRunner(new Scoped(this.runner, hub.ws, hub.ws === DEFAULT))
        this.hub.post({ kind: 'event', from: 'crew', text: `${e.message}, so agents stop when CLIque quits this time` })
      }
    }
    if (this.runner.replaced) this.hub.post({ kind: 'event', from: 'crew', text: 'the terminal host was from another CLIque version, so its agents started again, resuming their conversations' })
    this.url = `http://127.0.0.1:${server.address().port}`
    for (const hub of this.hubs.values()) this.startWorkspace(hub, survivors)
    // terminals still running for a workspace that's gone from config.json: nothing would ever hear from them again
    const stray = survivors.filter((s) => ![...this.hubs.values()].some((hub) => hub.runner.own(s.name)))
    for (const s of stray) this.runner.stop(s.name)
    if (stray.length) this.hub.post({ kind: 'event', from: 'crew', text: `stopped ${stray.map((s) => s.name).join(', ')}: ${stray.length === 1 ? 'it was' : 'they were'} still running for a workspace that's been removed` })
    const pushAll = (...msg) => this.pushAll(...msg)
    // Terminal output is batched per frame so a chatty agent doesn't flood IPC or the network. The app gets the
    // terminals of the workspace on screen by its agents' names. Linked computers get the default's by name, and any
    // other workspace's as workspace/name, if they know about workspaces. Phones get any workspace's they asked for
    // ('terminal': workspace, name, data).
    const out = new Map()
    this.flushPty = () => {
      clearTimeout(this.ptyTimer)
      this.ptyTimer = null
      for (const [name, data] of out) {
        const shown = this.here.runner.own(name)
        if (shown) this.emit('pty', shown, data)
        const linked = this.hub.runner.own(name)
        if (linked) pushAll('pty', linked, data)
        else this.pushSpace(Crew.split(name)[0], 'pty', name, data)
        this.emit('terminal', ...Crew.split(name), data)
      }
      out.clear()
    }
    this.runner.on('data', (name, data) => {
      out.set(name, (out.get(name) ?? '') + data)
      this.ptyTimer ??= setTimeout(this.flushPty, 16)
    })
    let pending = null
    this.hub.on('change', () => {
      pending ??= setTimeout(() => {
        pending = null
        pushAll('state', this.hub.snapshot())
        this.changed()
      }, 50)
    })
    this.hub.on('notice', (n) => this.emit('notice', { ...n, ...(!n.account && { workspace: DEFAULT }) }))
    this.hub.on('alert', (a, text) => {
      this.emit('alert', a.name, text, DEFAULT)
      pushAll('alert', a.name, text)
    })
    if (this.settings.share) await this.share(true).catch(() => {})
    for (const code of this.settings.peers ?? []) this.connect(code, { save: false }).catch(() => {})
    this.sweepTimer = setTimeout(() => this.sweepImages(), SWEEP_AFTER)
    this.sweepTimer.unref?.()
  }

  // Images nothing needs any more (core/keep.js): attachments that no workspace's chat, task or agent refers to, saved
  // over ATTACHMENT_DAYS ago, and linked computers' images fetched over CACHE_DAYS ago (fetched again when they're
  // shown). -> { attachments, cache }: how many went.
  sweepImages(now = Date.now()) {
    const key = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
    const used = new Set()
    const add = (images) => {
      for (const p of [].concat(images ?? [])) if (typeof p === 'string') used.add(key(p))
    }
    for (const hub of this.hubs.values()) {
      for (const e of hub.feed) add(e.images)
      for (const t of hub.tickets.all) add(t.images)
      for (const a of hub.agents.values()) {
        add(a.images)
        for (const m of [...(a.inbox ?? []), ...(a.serving ?? []), ...(a.expect?.msgs ?? []), ...(a.steering?.msgs ?? [])]) add(m?.images)
      }
      for (const c of hub.calls.values()) add(c.msg?.images)
    }
    const attachments = sweepFiles(ATTACHMENTS, { days: ATTACHMENT_DAYS, inUse: (f) => used.has(key(f)), now })
    let cache = 0
    let computers = []
    try {
      computers = fs.readdirSync(CACHE, { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {}
    for (const d of computers) cache += sweepFiles(path.join(CACHE, d.name), { days: CACHE_DAYS, now })
    return { attachments, cache }
  }

  // Quitting, agents and all ("Stop agents and quit"), or with agents kept running in the terminal host (detach): the
  // next Crew picks them up.
  stop() {
    this.close()
    if (this.runner.quit) this.runner.quit()
    else this.runner.stopAll()
  }

  detach() {
    this.close()
    for (const hub of this.hubs.values()) hub.saveRuntime(true)
    if (this.runner.detach) this.runner.detach()
    else this.runner.stopAll()
  }

  close() {
    clearTimeout(this.sweepTimer)
    for (const l of this.links.values()) {
      l.client?.close()
      l.peer?.close()
    }
    this.sharing?.stop()
    for (const hub of this.hubs.values()) {
      hub.saveStats()
      hub.saveConvos(true)
      hub.saveUsage(true)
      hub.saveSpend(true)
    }
  }

  // Do the agents keep working once Crew quits?
  get outlives() {
    return Boolean(this.runner.detach)
  }

  saveSettings() {
    fs.mkdirSync(LINK_DIR, { recursive: true })
    fs.writeFileSync(SETTINGS, JSON.stringify(this.settings, null, 2))
    fs.chmodSync(SETTINGS, 0o600)
  }

  changed() {
    clearTimeout(this.changeTimer)
    this.changeTimer = setTimeout(() => this.emit('state', this.snapshot()), 40)
  }

  // ---- Crew Link and workspaces ------------------------------------------------------------------
  // A workspace is the same project on every computer that has one with its id: "storefront" here and "storefront" on
  // the Workstation are one crew, each computer's agents working in its own checkout. The default workspace is the
  // default everywhere.
  // A linked computer gets the default's state, terminals and alerts as always, and those of every other workspace
  // ('space' messages, workspace/name for terminals and alerts) once it has said it knows about workspaces (aware, see
  // attach). Calls for a workspace other than the default go through 'in'.

  pushAll(...msg) {
    for (const l of this.links.values()) l.peer?.push(...msg)
  }

  pushAware(...msg) {
    for (const l of this.links.values()) if (l.aware) l.peer?.push(...msg)
  }

  // Only to the linked computers that have workspace `id` too: the rest would drop it.
  pushSpace(id, ...msg) {
    for (const l of this.links.values()) if (l.aware && l.theirs?.has(id)) l.peer?.push(...msg)
  }

  // A linked computer's workspaces (besides the default), from its answer to 'spaces' or its 'spaces' message: what it
  // no longer has goes, and it gets ours for every one we both have.
  theirSpaces(l, peer, ids) {
    l.theirs = new Set(ids)
    for (const id of Object.keys(l.spaces ?? {})) if (!l.theirs.has(id)) delete l.spaces[id]
    for (const id of l.theirs) if (id !== DEFAULT && this.hubs.has(id)) peer.push('space', id, this.hubs.get(id).snapshot())
    this.changed()
  }

  // A call to a linked computer, for a workspace (the one on screen unless said).
  async linkCall(l, fn, args = [], ws = this.here.ws) {
    if (ws === DEFAULT) return l.peer.call(fn, args)
    try {
      return await l.peer.call('in', [ws, fn, args])
    } catch (e) {
      if (/isn't available over Crew Link/.test(e.message) && /"in"/.test(e.message)) throw new Error(`${l.name} runs an older CLIque, without workspaces: update it to work with its agents here`)
      throw e
    }
  }

  // Typing into an agent's terminal, here or on its computer (in the workspace on screen, or `here`).
  input(name, data, here = this.here) {
    const { l, base } = this.where(name)
    if (!l) return here.input(base, data)
    l.peer?.input(here === this.hub ? base : `${here.ws}/${base}`, data)
  }

  // workspace/name (a terminal or an alert from a linked computer) -> [workspace, name]; a bare name is the default's.
  static split(n) {
    const s = String(n)
    const at = s.indexOf('/')
    return at < 0 ? [DEFAULT, s] : [s.slice(0, at), s.slice(at + 1)]
  }

  // What a linked computer has of a workspace: its state for the default or for one of the same id.
  linkedState(l, ws) {
    return ws === DEFAULT ? l.state : l.spaces?.[ws]
  }

  // ---- the merged crew -------------------------------------------------------------------------

  // Names from a linked computer, as seen here: theirs get @computer, ours come back bare.
  qualifier(l) {
    return (n) => {
      if (!n || n === 'you' || n === 'crew') return n
      const at = n.indexOf('@')
      if (at < 0) return `${n}@${l.slug}`
      return n.slice(at + 1) === this.me.slug ? n.slice(0, at) : n
    }
  }

  // The workspace on screen (or `here`), with the linked computers' agents when that's the default (theirs are in their
  // own defaults), and every workspace for the switcher.
  snapshot(here = this.here) {
    const s = here.snapshot()
    const agents = s.agents.map((a) => ({ ...a, home: null }))
    const feed = [...s.feed]
    const tickets = s.tasks.tickets.map((t) => ({ ...t, key: String(t.id), home: null }))
    const providers = {}
    for (const l of this.links.values()) {
      const st = this.linkedState(l, here.ws)
      if (!st) continue
      const q = this.qualifier(l)
      Object.assign(providers, st.providers)
      for (const a of st.agents) agents.push(this.linkedAgent(l, a, q))
      for (const e of st.feed) {
        feed.push({
          ...e, id: `${e.id}@${l.slug}`, from: q(e.from), to: q(e.to), cc: e.cc?.map(q), re: e.re && q(e.re), images: e.images?.map((p) => this.fetchImage(l, p)),
          ...(e.ticket !== undefined && { ticket: q(String(e.ticket)) }), ...((e.act === 'fixing' || e.act === 'triaged') && e.text && { text: q(e.text) }),
          ...(e.also && { also: e.also.map(q) }), ...(e.reply && { reply: q(e.reply) }), ...(e.line && { line: e.line.map(q) }),
          ...(e.answered && { answered: { ...e.answered, by: q(e.answered.by), ...(e.answered.reply && { reply: q(e.answered.reply) }) } }),
        })
      }
      // Tasks that live there: #12 there is 12@that-computer here. (`bugs`: a computer on the previous version.)
      for (const t of (st.tasks ?? st.bugs)?.tickets ?? []) {
        tickets.push({
          ...t, key: `${t.id}@${l.slug}`, home: l.slug, homeName: l.name, owner: q(t.owner), fixer: q(t.fixer), by: q(t.by),
          images: t.images.map((p) => this.fetchImage(l, p)), log: t.log.map((x) => ({ ...x, by: q(x.by) })),
        })
      }
    }
    feed.sort((x, y) => x.ts - y.ts)
    const hidden = new Set(this.settings.hidden ?? [])
    // the last 200 entries, plus any question still waiting for an answer from before them
    const recent = feed.slice(-200)
    const open = feed.slice(0, -200).filter((e) => e.kind === 'ask' && !e.answer)
    const workspaces = this.workspaces()
    return {
      ...s, providers: { ...providers, ...s.providers }, agents: agents.filter((a) => !hidden.has(a.cloneOf ?? a.name)), feed: [...open, ...recent], computers: this.computers(),
      tasks: { ...s.tasks, tickets }, workspace: workspaces.find((w) => w.id === here.ws), workspaces,
      // your shared agents, to pick who works in a workspace, each with the folder of its own (where it works in the
      // default workspace)
      roster: (this.config.data.agents ?? []).filter((a) => a?.name).map((a) => ({ name: a.name, area: a.area, avatar: a.avatar, cwd: a.cwd })),
    }
  }

  // A linked computer's agent, as this computer writes it.
  linkedAgent(l, a, q = this.qualifier(l)) {
    // who it waits on and who waits on it: names and the questions' feed ids, as this computer writes them
    const waits = (list) => list?.map((w) => ({ ...w, name: q(w.name), id: w.id && q(w.id) }))
    return {
      ...a, name: q(a.name), seed: a.name, home: l.slug, homeName: l.name, status: l.peer ? a.status : 'away', images: a.images?.map((p) => this.fetchImage(l, p)),
      ticket: a.ticket == null ? null : q(String(a.ticket)), ...(a.cloneOf && { cloneOf: q(a.cloneOf) }), waitingOn: waits(a.waitingOn), owes: waits(a.owes),
    }
  }

  // Just the linked computers' agents in a workspace, for its hub (crew who, names, who's on): without building the
  // whole snapshot, and nothing at all without links.
  linkedAgents(hub) {
    if (!this.links.size) return []
    const hidden = new Set(this.settings.hidden ?? [])
    const out = []
    for (const l of this.links.values()) {
      const st = this.linkedState(l, hub.ws)
      if (!st) continue
      const q = this.qualifier(l)
      for (const a of st.agents) if (!hidden.has(q(a.cloneOf ?? a.name))) out.push(this.linkedAgent(l, a, q))
    }
    return out
  }

  // Where an agent lives: { l, base } for a linked computer, { l: null, base } for this one.
  where(name) {
    const at = String(name).lastIndexOf('@')
    if (at < 0) return { l: null, base: name }
    const home = name.slice(at + 1)
    if (home === this.me.slug) return { l: null, base: name.slice(0, at) }
    return { l: this.link(home), base: name.slice(0, at) }
  }

  link(home) {
    const l = this.links.get(home)
    if (!l) throw new Error(`no linked computer called "${home}"`)
    if (!l.peer) throw new Error(`${l.name} is unreachable right now`)
    return l
  }

  // Bare names resolve to this computer first, then to the one linked computer with an agent by that name (in the
  // workspace on screen, or `here`).
  resolve(name, here = this.here) {
    const agents = this.snapshot(here).agents
    if (name.includes('@')) {
      const { l, base } = this.where(name)
      if (l && !this.linkedState(l, here.ws)?.agents.some((a) => a.name === base)) throw new Error(`no agent named "${name}" (try: crew who)`)
      return l ? name : base
    }
    if (here.agents.has(name)) return name
    if (here.agents.has(here.baseOf(name))) return here.baseOf(name) // a clone that went away: its original
    const there = agents.filter((a) => a.home && a.seed === name)
    if (there.length === 1) return there[0].name
    if (there.length > 1) throw new Error(`which ${name}? ${there.map((a) => `@${a.name}`).join(' or ')}`)
    throw new Error(`no agent named "${name}" (try: crew who)`)
  }

  // Images are files on the computer an agent lives on: fetched on demand into a cache for display here,
  // and sent over (or mapped back) when they travel to another computer.
  fetchImage(l, hostPath) {
    const file = path.join(CACHE, l.slug, crypto.createHash('sha1').update(hostPath).digest('hex').slice(0, 20) + path.extname(hostPath))
    l.toHost.set(file, hostPath)
    if (fs.existsSync(file) || l.fetching.has(hostPath) || !l.peer) return file
    l.fetching.add(hostPath)
    l.peer
      .call('readImage', [hostPath])
      .then((bytes) => {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, bytes)
        this.changed()
      }, () => {})
      .finally(() => l.fetching.delete(hostPath))
    return file
  }

  async toHome(paths, l) {
    if (!paths?.length) return paths
    return Promise.all(
      paths.map((p) => l.toHost.get(p) ?? l.peer.call('saveImage', [path.basename(p), MIME[path.extname(p).toLowerCase()] ?? 'image/png', new Uint8Array(fs.readFileSync(p))])),
    )
  }

  group(names) {
    const groups = new Map()
    for (const n of names) {
      const { l, base } = this.where(n)
      const key = l?.slug ?? ''
      groups.set(key, [...(groups.get(key) ?? []), base])
    }
    return groups
  }

  // ---- actions from this computer's UI, and from phones -------------------------------------------
  // Each acts in the workspace on screen unless it's given another one's hub (`here`): what a phone does lands in the
  // workspace it watches, whatever this computer shows.

  // opts.fresh: deliver into a new conversation. opts.re: the message you're replying to (an id from the feed
  // shown here: on this computer, or id@computer). Each computer links what it has and quotes the rest.
  // here: the workspace it was sent in, whatever's on screen by the time it goes.
  // opts.channel: the channel it's said in (its id); Auto picks from that channel's members.
  async send(to, text, images = [], { fresh = false, re, channel } = {}, here = this.here) {
    const quoted = re ? this.snapshot(here).feed.find((e) => e.id === re) : undefined
    const quote = quoted && { from: quoted.from, text: quoted.ticket !== undefined ? `#${String(quoted.ticket).split('@')[0]} ${quoted.title ?? ''}` : quoted.text }
    const idThere = (slug) => (id) => (slug ? (id?.endsWith(`@${slug}`) ? id.slice(0, -slug.length - 1) : undefined) : id && !id.includes('@') ? id : undefined)
    const unq = (slug) => (name) => (slug && String(name).endsWith(`@${slug}`) ? String(name).slice(0, -slug.length - 1) : name)
    let names = addressees(to, text).map((n) => this.resolve(n, here))
    const auto = !names.length && { auto: true } // nobody named: Auto picks, and the chat says Auto picked them
    if (!names.length) {
      // agents, not their clones; one here that can clone itself counts as free
      const members = here.channel(channel)?.members
      const ready = this.snapshot(here).agents.filter((a) => a.on && !a.cloneOf && !['stopped', 'off', 'away'].includes(a.status) && (!members || members.includes(a.name)))
      const best = bestFor(text, ready.map((a) => (a.home ? a : { ...a, ...here.lineup(here.agents.get(a.name)) })))
      if (!best) throw new Error(members ? `nobody in #${here.channel(channel).name} is on to take it: turn one on, or @name someone` : 'no agents to send to')
      names = [best.name]
    }
    // to another computer: the channel with its name and brief, which its hub gives its agents (its own channels differ)
    const c = channel !== undefined && channel !== 'general' ? here.channel(channel) : null
    const away = c ? { channel: c.id, channelName: c.name, ...(c.brief && { brief: c.brief }) } : {}
    const out = []
    for (const [home, bases] of this.group(names)) {
      const reply = quoted ? { re: idThere(home)(re), quote: { ...quote, from: unq(home)(quote.from) } } : {}
      if (!home) out.push(await here.send({ to: bases.join(','), text, images, mentions: false, fresh, ...auto, ...reply, ...(channel !== undefined && { channel }) }))
      else {
        const l = this.link(home)
        out.push(await this.linkCall(l, 'deliver', [{ to: bases.join(','), text, images: await this.toHome(images, l), fresh, ...auto, ...reply, ...away }], here.ws))
      }
    }
    return out.join('')
  }

  // A local agent's `crew send` (or a bug sent to its fixer) to agents on other computers, in its workspace there.
  async relay(from, names, text, images, extra = {}, hub = this.hub) {
    const out = []
    for (const [home, bases] of this.group(names)) {
      if (!home) throw new Error(`${bases.join(', ')}: that's this computer, leave off the @${this.me.slug}`)
      const l = this.link(home)
      // a bug's number, as that computer names it
      const ticket = extra.ticket !== undefined ? { ticket: `${extra.ticket}@${this.me.slug}` } : {}
      const sender = from === 'you' ? 'you' : `${from}@${this.me.slug}`
      out.push(await this.linkCall(l, 'deliver', [{ ...extra, ...ticket, from: sender, to: bases.join(','), text, images: await this.toHome(images, l) }], hub.ws))
    }
    return out.join('')
  }

  // Run fn on whichever computer `name` lives on.
  async at(name, fn, args = [], here = this.here) {
    const { l, base } = this.where(name)
    if (l) return this.linkCall(l, fn, [base, ...args], here.ws)
    return this.serve(fn, [base, ...args], here)
  }

  async update(names, patch, here = this.here) {
    for (const [home, bases] of this.group([].concat(names))) {
      if (!home) here.update(bases, patch)
      else {
        const l = this.link(home)
        await this.linkCall(l, 'update', [bases, patch.images ? { ...patch, images: await this.toHome(patch.images, l) } : patch], here.ws)
      }
    }
  }

  async addAgent({ home, ...fields }) {
    const here = this.here
    if (!home) return here.addAgent(fields)
    const l = this.link(home)
    return `${await this.linkCall(l, 'addAgent', [{ ...fields, images: await this.toHome(fields.images, l) }], here.ws)}@${l.slug}`
  }

  // A Tasks board action. A task lives on the computer it was added on: 12@laptop is #12 on Laptop.
  async ticket(op, key, arg, here = this.here) {
    if (op === 'file') return here.fileTask(arg)
    if (op === 'bulk') return this.bulkTickets(arg, here)
    const { l, base } = this.where(String(key))
    if (!l) return here.ticket(op, base, arg)
    if (arg?.owner) arg = { ...arg, owner: this.qualifierFor(l)(arg.owner) }
    if (arg?.images) arg = { ...arg, images: await this.toHome(arg.images, l) } // screenshots live with the bug
    return this.linkCall(l, 'ticket', [op, base, op === 'dispatch' && arg?.to ? { ...arg, to: this.qualifierFor(l)(arg.to) } : arg], here.ws)
  }

  // A bulk action on the Tasks board ({ op, keys, arg }, see Hub.bulk): each computer gets its own tasks in one call.
  // One on an older Crew, without bulk actions, gets them one at a time; one that can't be reached is left out.
  async bulkTickets({ op, keys = [], arg } = {}, here = this.here) {
    const groups = new Map() // computer ('' for this one) -> its task numbers
    for (const key of keys.map(String)) {
      const at = key.lastIndexOf('@')
      const home = at < 0 || key.slice(at + 1) === this.me.slug ? '' : key.slice(at + 1)
      groups.set(home, [...(groups.get(home) ?? []), at < 0 ? key : key.slice(0, at)])
    }
    if (op === 'clear' && !groups.size) groups.set('', [])
    const out = []
    for (const [home, ids] of groups) {
      if (!home) {
        out.push(await here.bulk(op, ids, arg))
        continue
      }
      const l = this.links.get(home)
      if (!l?.peer) {
        out.push(`${ids.length} on ${l?.name ?? home} left as they were: it's unreachable right now\n`)
        continue
      }
      const there = op === 'owner' && arg ? this.qualifierFor(l)(arg) : arg
      try {
        out.push(`on ${l.name}: ${await this.linkCall(l, 'bulk', [op, ids, there], here.ws)}`)
      } catch (e) {
        if (!/isn't available over Crew Link/.test(e.message)) throw e
        out.push(await this.oneByOne(l, op, ids, there, here.ws))
      }
    }
    return out.join('')
  }

  // A bulk action as single-task calls, for a computer on an older Crew.
  async oneByOne(l, op, ids, arg, ws) {
    const [fn, value] = { start: ['dispatch'], close: ['accept'], move: arg === 'done' ? ['accept'] : ['move', arg], owner: ['edit', { owner: arg }], priority: ['edit', { severity: arg }], remove: ['remove'], clear: ['remove'] }[op] ?? []
    if (!fn) throw new Error(`unknown bulk action "${op}"`)
    let n = 0
    for (const id of ids) {
      try {
        await this.linkCall(l, 'ticket', [fn, id, value], ws)
        n++
      } catch {}
    }
    return `on ${l.name}: ${n} of ${ids.length} done one at a time (it runs an older CLIque)\n`
  }

  // Names as another computer sees them: its agents bare, ours as name@this-computer.
  qualifierFor(l) {
    return (n) => {
      if (!n) return n
      const at = n.lastIndexOf('@')
      if (at >= 0 && n.slice(at + 1) === l.slug) return n.slice(0, at)
      return at >= 0 ? n : `${n}@${this.me.slug}`
    }
  }

  feedAction(id, fn, args = [], here = this.here) {
    const { l, base } = this.where(id)
    return l ? this.linkCall(l, fn, [base, ...args], here.ws) : here[fn](base, ...args)
  }

  draftPrompt({ home, ...agent }) {
    return home ? this.linkCall(this.link(home), 'draftPrompt', [agent]) : this.here.draftPrompt(agent)
  }

  // ---- what linked computers may ask of this one -----------------------------------------------

  // h: the hub it's for (linked computers only ever reach the default's; this computer's app, the one on screen).
  serve(fn, args, h = this.hub) {
    const allowed = {
      // the same call, for one of this computer's workspaces (not on an older Crew); and which ones it has
      in: (ws, call, rest) => {
        const there = this.hubs.get(ws)
        if (!there) throw new Error(`${this.me.name} has no workspace "${ws}"`)
        if (call === 'in') throw new Error('one workspace at a time')
        return this.serve(call, rest ?? [], there)
      },
      spaces: () => [...this.hubs.keys()].filter((id) => id !== DEFAULT),
      state: () => h.snapshot(),
      deliver: (opts) => h.send({ ...opts, mentions: false }),
      saveImage: (name, type, bytes) => h.saveImage(name, type, bytes),
      readImage: (file) => {
        if (!String(file).startsWith(ATTACHMENTS + path.sep)) throw new Error('not an attachment')
        return new Uint8Array(fs.readFileSync(file))
      },
      approve: (id) => h.approve(id),
      drop: (id) => h.drop(id),
      answer: (id, reply) => h.answer(id, reply),
      update: (names, patch) => h.update(names, patch),
      draftPrompt: (agent) => h.draftPrompt(agent),
      addAgent: (fields) => h.addAgent(fields),
      removeAgent: (name) => h.removeAgent(name),
      restart: (name) => h.restart(name),
      markIdle: (name) => h.markIdle(name),
      dismiss: (name) => h.dismiss(name),
      resize: (name, cols, rows) => h.runner.resize(name, cols, rows),
      // Flush first: chunks already batched are in the buffer, so a viewer replaying it won't see them twice.
      buffer: (name) => {
        this.flushPty()
        return h.runner.buffer(name)
      },
      exportAgents: (names, opts) => packAgents(h, names, opts),
      freshStart: (name) => h.freshStart(name),
      task: (from, args) => h.taskCommand(from, args),
      bug: (from, args) => h.taskCommand(from, args), // a computer on the previous version
      ticket: (op, id, arg) => h.ticket(op, id, arg),
      bulk: (op, ids, arg) => h.bulk(op, ids, arg),
      importAgents: (pack, choices) => unpackAgents(h, pack, choices),
      // moving an agent with its conversation (see moveAgent): the computer it leaves, the one it goes to, the rest
      moveOut: (name) => moveOut(h, name),
      moveRead: (token, i, offset) => moveRead(h, token, i, offset),
      moveEnd: (token, done) => moveEnd(h, token, done),
      moveWrite: (token, i, offset, bytes) => moveWrite(token, i, offset, bytes),
      moveIn: (token, out, pick) => moveIn(h, token, out, pick, this.me.name),
      moveDrop: (token) => moveDrop(token),
      agentMoved: (move) => agentMoved(h, move),
      // folders there, for picking where an agent works
      folderInfo: (dir) => folderInfo(dir),
      folders: (like) => folders(h, like),
    }
    if (!Object.hasOwn(allowed, fn)) throw new Error(`"${fn}" isn't available over Crew Link`)
    return allowed[fn](...args)
  }

  // ---- export, import, move ----------------------------------------------------------------------

  async exportAgents(names, opts = {}) {
    const here = this.here
    const packs = []
    for (const [home, bases] of this.group(names)) packs.push(home ? await this.linkCall(this.link(home), 'exportAgents', [bases, opts], here.ws) : packAgents(here, bases, opts))
    return { crew: 1, exported: new Date().toISOString(), agents: packs.flatMap((p) => p.agents), providers: Object.assign({}, ...packs.map((p) => p.providers)) }
  }

  // Every name in use on a computer (home '' = this one), to suggest free ones.
  namesOn(home) {
    const l = home && this.links.get(home)
    const ws = this.here.ws
    if (l) return new Set([...(l.state?.agents ?? []), ...(ws === DEFAULT ? [] : l.spaces?.[ws]?.agents ?? [])].map((a) => a.name))
    return new Set([...this.here.agents.keys(), ...this.hub.agents.keys()])
  }

  freeName(name, home) {
    const taken = this.namesOn(home ?? '')
    let candidate = name
    for (let i = 2; taken.has(candidate); i++) candidate = `${name}-${i}`
    return candidate
  }

  importPreview(pack) {
    return pack.agents.map((a, index) => ({
      index, name: this.freeName(a.name, ''), area: a.area, provider: a.provider, model: a.model, effort: a.effort, yolo: a.yolo,
      avatar: a.avatar, seed: a.name, folder: a.folder, images: a.images?.length ?? 0, hasPrompt: Boolean(a.prompt),
    }))
  }

  // choices: [{ index, name, folder, home }]. Imported agents start switched off, to be looked over first.
  async importAgents(pack, choices) {
    const here = this.here
    const added = new Map() // choice -> name it got, in the order they were chosen
    const byHome = new Map()
    for (const c of choices) byHome.set(c.home ?? '', [...(byHome.get(c.home ?? '') ?? []), c])
    for (const [home, list] of byHome) {
      const sub = { ...pack, agents: list.map((c) => pack.agents[c.index]) }
      const picks = list.map((c, i) => ({ index: i, name: c.name, folder: c.folder, on: false }))
      const names = home ? (await this.linkCall(this.link(home), 'importAgents', [sub, picks], here.ws)).map((n) => `${n}@${home}`) : unpackAgents(here, sub, picks)
      list.forEach((c, i) => added.set(c, names[i]))
    }
    return choices.map((c) => added.get(c))
  }

  // Moves an agent to another computer (home: a linked computer, '' for this one), from whichever computer it's on,
  // with its definition, look, work experience, queued messages, its lines in the chat and its conversation: the
  // CLI's session files go along and it resumes there (core/move.js). Everything passes through this computer, so
  // the two needn't be linked to each other. A computer on an older Crew can only take the agent, not its
  // conversation (`older`). -> { name, conversation: 'moved' | 'fresh', reason?, older? }
  // In a workspace other than the default, it moves to that workspace on the other computer, which needs one with the
  // same id: one of the workspace's own agents is its own there too, one of your shared agents joins that computer's
  // crew (off in its default workspace until you turn it on there) and leaves only this workspace here.
  async moveAgent(name, home, folder) {
    home ??= ''
    const here = this.here
    const ws = here.ws
    const src = this.where(name)
    const from = src.l?.slug ?? ''
    if (from === home) throw new Error('it already lives there')
    const agent = this.snapshot().agents.find((a) => a.name === name)
    if (!agent) throw new Error(`no agent named "${name}"`)
    if (ws !== DEFAULT && home && !this.links.get(home)?.spaces?.[ws]) throw new Error(`${this.links.get(home)?.name ?? home} has no ${here.space.name} workspace: make one with that name there first`)
    folder = String(folder ?? '').trim() || agent.cwd || '~'
    const on = (h, fn, ...args) => (h ? this.linkCall(this.link(h), fn, args, ws) : this.serve(fn, args, here))
    const label = (h) => (h ? this.links.get(h)?.name ?? h : this.me.name)
    // one of your shared agents that the other computer's crew has already (it was there before) rejoins it there,
    // rather than arriving as a copy under another name
    const shared = ws !== DEFAULT && Boolean(agent.shared)
    const l = home && this.links.get(home)
    const crewThere = new Set(l ? (l.state?.agents ?? []).filter((a) => !a.cloneOf).map((a) => a.name) : this.hub.agents.keys())
    const inThere = new Set(l ? (l.spaces?.[ws]?.agents ?? []).map((a) => a.name) : here.agents.keys())
    const join = shared && crewThere.has(src.base) && !inThere.has(src.base)
    const move = { from: from || this.me.slug, to: home || this.me.slug, old: src.base, name: join ? src.base : this.freeName(src.base, home) }
    const older = (e) => ws === DEFAULT && /isn't available over Crew Link/.test(e.message) // in a workspace: no way back
    // A running agent needs its folder there; and a computer on an older Crew says so here, before anything stops.
    let there
    try {
      there = await on(home, 'folderInfo', folder)
    } catch (e) {
      if (older(e)) return this.packMove(src, home, folder, agent, move, label(home))
      throw e
    }
    if (agent.on && !there.exists) throw new Error(`there's no folder ${there.path} on ${label(home)}`)
    let out
    try {
      out = await on(from, 'moveOut', src.base)
    } catch (e) {
      if (older(e)) return this.packMove(src, home, folder, agent, move, label(from))
      throw e
    }
    const token = crypto.randomUUID()
    let res
    try {
      for (const [i, f] of out.files.entries()) {
        let offset = 0
        do {
          const bytes = await on(from, 'moveRead', out.token, i, offset)
          await on(home, 'moveWrite', token, i, offset, bytes)
          if (!bytes.length) break
          offset += bytes.length
        } while (offset < f.size)
      }
      res = await on(home, 'moveIn', token, out, { name: move.name, folder, on: Boolean(agent.on), shared, join, from: { slug: move.from, name: label(from) } })
    } catch (e) {
      await on(home, 'moveDrop', token).catch(() => {})
      await on(from, 'moveEnd', out.token, null).catch(() => {}) // it carries on where it was
      throw e
    }
    try {
      await on(from, 'moveEnd', out.token, { to: move.to, name: res.name })
    } catch (e) {
      here.post({ kind: 'event', from: 'crew', text: `${src.base} moved to ${label(home)}, but ${label(from)} still has it (${e.message}): remove it there` })
    }
    this.tellMoved({ ...move, name: res.name }, [from, home], ws)
    return { name: home ? `${res.name}@${home}` : res.name, conversation: res.conversation, ...(res.reason && { reason: res.reason }) }
  }

  // The move from before conversations could travel, for a computer on an older Crew: the agent goes, its
  // conversation and its lines in the chat stay where they were.
  async packMove(src, home, folder, agent, move, who) {
    const pack = src.l ? await src.l.peer.call('exportAgents', [[src.base], { stats: true }]) : packAgents(this.hub, [src.base], { stats: true })
    const pick = [{ index: 0, name: move.name, folder, on: Boolean(agent.on) }]
    const [moved] = home ? await this.link(home).peer.call('importAgents', [pack, pick]) : unpackAgents(this.hub, pack, pick)
    await (src.l ? src.l.peer.call('removeAgent', [src.base]) : this.hub.removeAgent(src.base))
    this.tellMoved({ ...move, name: moved }, [])
    return { name: home ? `${moved}@${home}` : moved, conversation: 'fresh', reason: `${who} runs an older CLIque`, older: true }
  }

  // Every computer within reach (this one too) but `skip` writes the agent by its new name from now on, in the
  // workspace it moved in.
  tellMoved(move, skip, ws = DEFAULT) {
    if (!skip.includes('') && this.hubs.has(ws)) agentMoved(this.hubs.get(ws), move)
    for (const l of this.links.values()) if (l.peer && !skip.includes(l.slug) && (ws === DEFAULT || l.spaces?.[ws])) this.linkCall(l, 'agentMoved', [move], ws).catch(() => {})
  }

  // Folders on any computer (home '' = this one): the folder picker only browses this one.
  // folderInfo -> { exists, path }; folders -> [{ path, label }], with the folder at the same path as where the agent
  // `name` works now, if it's there.
  folderInfo(home, dir) {
    return home ? this.link(home).peer.call('folderInfo', [dir]) : folderInfo(dir)
  }

  folders(home, name) {
    const like = name ? (this.snapshot().agents.find((a) => a.name === name)?.cwd ?? null) : null
    return home ? this.linkCall(this.link(home), 'folders', [like]) : folders(this.here, like)
  }

  // ---- computers: sharing this one, linking others, choosing which agents to use -------------

  computers() {
    const hidden = new Set(this.settings.hidden ?? [])
    const port = this.settings.port ?? DEFAULT_PORT
    let me = { name: this.me.name, slug: this.me.slug, sharing: Boolean(this.sharing), error: this.linkError, agents: this.hub.config.agents.length }
    // while other computers or phones may connect: networks come and go (Wi-Fi, Tailscale), and so does a firewall's say
    const phones = this.phones.devices.length > 0 || Boolean(this.phones.open())
    if ((this.sharing || phones) && Date.now() - this.hosts.at > 30000) this.findHosts()
    if (this.sharing) {
      const hosts = this.hosts.list
      me = { ...me, port, hosts, code: makeCode({ name: this.me.name, port, key: this.settings.key, fingerprint: this.sharing.fingerprint, hosts: hosts.map((h) => h.address) }) }
      if (this.hosts.warning) me.warning = this.hosts.warning
    }
    const links = [...this.links.values()].map((l) => {
      const q = this.qualifier(l)
      return {
        slug: l.slug, name: l.name, online: Boolean(l.peer), saved: Boolean(l.code), status: l.client?.status, spaces: Object.keys(l.spaces ?? {}),
        agents: (l.state?.agents ?? []).filter((a) => !a.cloneOf).map((a) => ({ name: q(a.name), seed: a.name, area: a.area, avatar: a.avatar, status: a.status, on: a.on, hidden: hidden.has(q(a.name)) })),
      }
    })
    return { me, links, phones: { ...this.phones.view(), ...(phones && this.hosts.warning && { warning: this.hosts.warning }) } }
  }

  hosts = { at: 0, list: [], warning: null } // warning: why connections can't get in (Windows Firewall), if they can't

  async findHosts() {
    this.hosts.at = Date.now()
    const list = await addresses()
    this.findFirewall(list).catch(() => {}) // on Windows PowerShell is asked, which can take seconds: not waited for
    if (JSON.stringify(list) === JSON.stringify(this.hosts.list)) return
    this.hosts.list = list
    this.changed()
  }

  async findFirewall(list) {
    const warning = await firewallWarning(list)
    if (warning === this.hosts.warning) return
    this.hosts.warning = warning
    this.changed()
  }

  async share(on) {
    this.settings.share = Boolean(on)
    this.saveSettings()
    if (on && !this.sharing) await this.startSharing()
    if (!on) this.stopSharing()
    this.changed()
  }

  async startSharing() {
    if (!this.settings.key) {
      this.settings.key = crypto.randomBytes(24).toString('base64url')
      this.saveSettings()
    }
    const id = identity(LINK_DIR)
    const host = new LinkHost({ key: this.settings.key, cert: id.cert, keyPem: id.key, name: this.me.name, handle: (fn, args) => this.serve(fn, args) })
    host.fingerprint = id.fingerprint
    host.on('peer', (peer) => this.attach(peer))
    const port = this.settings.port ?? DEFAULT_PORT
    try {
      await host.start(port)
      await this.findHosts()
      this.sharing = host
      this.linkError = null
    } catch (e) {
      host.stop()
      this.linkError = e.code === 'EADDRINUSE' ? `port ${port} is in use, set another "port" in ${SETTINGS}` : e.message
      throw new Error(this.linkError)
    }
  }

  stopSharing() {
    this.sharing?.stop()
    this.sharing = null
  }

  // A new key: every computer using the old code is disconnected.
  async reset() {
    this.settings.key = crypto.randomBytes(24).toString('base64url')
    this.saveSettings()
    if (this.sharing) {
      this.stopSharing()
      await this.startSharing()
    }
    this.changed()
  }

  // Link a computer by its pairing code. Resolves with its short name once connected (or after 8s with the
  // reason it isn't yet), so the UI can show its agents right away.
  connect(code, { save = true } = {}) {
    code = String(code).trim()
    const info = readCode(code)
    if (this.sharing && info.fingerprint === this.sharing.fingerprint) throw new Error("that's this computer's own code")
    const known = [...this.links.values()].find((l) => l.code === code)
    if (known) return Promise.resolve(known.slug) // already linked (or reconnecting on its own)
    const client = new LinkClient(code, { name: this.me.name, handle: (fn, args) => this.serve(fn, args) })
    client.on('status', () => this.changed())
    if (save) {
      this.settings.peers = [...new Set([...(this.settings.peers ?? []), code])]
      this.saveSettings()
    }
    // Listed right away, so a computer that's off shows as unreachable (and can be forgotten).
    const key = slug(info.name)
    const placeholder = this.links.get(key) ?? this.newLink(key)
    Object.assign(placeholder, { name: placeholder.name ?? info.name, client, code })
    this.changed()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(client.status.error ?? `couldn't reach ${info.name} yet, it keeps trying`)), 8000)
      client.on('peer', (peer) => {
        if (slug(peer.name) !== key && this.links.get(key) === placeholder) this.links.delete(key) // renamed since the code was made
        const l = this.attach(peer, client)
        l.code = code
        clearTimeout(timer)
        resolve(l.slug)
      })
      client.connect()
    })
  }

  newLink(key) {
    const l = { slug: key, peer: null, toHost: new Map(), fetching: new Set() }
    this.links.set(key, l)
    return l
  }

  attach(peer, client) {
    const key = slug(peer.name)
    const l = this.links.get(key) ?? this.newLink(key)
    Object.assign(l, { name: peer.name, peer, client: client ?? l.client, aware: false }) // until it says otherwise
    const q = this.qualifier(l)
    peer.on('state', (s) => {
      l.state = s
      this.changed()
    })
    // its other workspaces, by id: shown here in the workspace of the same id, if this computer has one
    peer.on('space', (id, s) => {
      if (l.peer !== peer) return
      l.spaces ??= {}
      if (s) l.spaces[id] = s
      else delete l.spaces[id]
      this.changed()
    })
    peer.on('spaces', (ids) => l.peer === peer && l.aware && this.theirSpaces(l, peer, ids))
    // terminals and alerts say which workspace (workspace/name; a bare name is the default's): a terminal shows when
    // its workspace is on screen, an alert when this computer has that workspace
    peer.on('pty', (n, d) => {
      const [ws, base] = Crew.split(n)
      if (ws === this.current) this.emit('pty', q(base), d)
      this.emit('terminal', ws, q(base), d)
    })
    peer.on('alert', (n, t) => {
      const [ws, base] = Crew.split(n)
      if (this.hubs.has(ws)) this.emit('alert', q(base), t, ws)
    })
    peer.on('input', (n, d) => {
      const [ws, base] = Crew.split(n)
      this.hubs.get(ws)?.input(base, d)
    })
    peer.on('close', () => {
      if (l.peer !== peer) return
      l.peer = null
      if (!l.client) this.links.delete(key) // a computer that linked to us: it'll come back on its own
      this.changed()
    })
    peer.push('state', this.hub.snapshot())
    peer.call('state').then((s) => {
      l.state = s
      this.changed()
    }, () => {})
    // Does it know about workspaces? Then it gets ours (and asks the same of us, so we get its). An older Crew doesn't
    // answer 'spaces', and only ever sees the default.
    peer.call('spaces').then((ids) => {
      if (l.peer !== peer) return
      l.aware = true
      this.theirSpaces(l, peer, Array.isArray(ids) ? ids : [])
    }, () => {
      if (l.peer !== peer) return // a connection that lost to another one
      l.aware = false
      l.spaces = {} // a computer back on an older Crew: what it had of workspaces is gone
      this.changed()
    })
    this.changed()
    return l
  }

  forget(home) {
    const l = this.links.get(home)
    if (!l) return
    l.client?.close()
    l.peer?.close()
    this.links.delete(home)
    this.settings.peers = (this.settings.peers ?? []).filter((c) => c !== l.code)
    this.settings.hidden = (this.settings.hidden ?? []).filter((n) => !n.endsWith(`@${home}`))
    this.saveSettings()
    this.changed()
  }

  // Which of a linked computer's agents this computer uses: hidden ones still run there, just not here.
  setHidden(names, hidden) {
    const set = new Set(this.settings.hidden ?? [])
    for (const n of [].concat(names)) hidden ? set.add(n) : set.delete(n)
    this.settings.hidden = [...set]
    this.saveSettings()
    this.changed()
  }

  rename(name) {
    name = String(name ?? '').trim()
    if (!name) throw new Error('give this computer a name')
    this.settings.name = name
    this.me = { name, slug: slug(name) }
    for (const hub of this.hubs.values()) hub.self = this.me.slug
    this.saveSettings()
    // other computers learn the new name when they reconnect
    if (this.sharing) this.stopSharing(), this.startSharing().catch(() => {})
    for (const l of this.links.values()) l.peer?.close()
    this.changed()
  }
}

// One crew across your computers: this computer's hub plus every linked computer's agents, merged into one
// list (agents elsewhere are name@computer), with each action routed to the computer the agent lives on.
// No Electron in here: main.js owns windows and dialogs and talks to this.
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Hub, HOME, ATTACHMENTS, addressees, bestFor } from './hub.js'
import { Runner } from './runner.js'
import { serve } from './server.js'
import { LinkHost, LinkClient, identity, addresses, makeCode, readCode, slug, DEFAULT_PORT } from './link.js'
import { packAgents, unpackAgents } from './pack.js'

export const LINK_DIR = path.join(HOME, 'link')
export const CACHE = path.join(LINK_DIR, 'cache')
const SETTINGS = path.join(LINK_DIR, 'link.json')
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

  constructor({ bin, computerName }) {
    super()
    // { share, port, key, name, peers: [codes], hidden: [agent names] }
    this.settings = readJSON(SETTINGS) ?? {}
    if (this.settings.remote) this.settings.peers = [this.settings.remote] // from when a link replaced this crew
    delete this.settings.remote
    this.me = { name: this.settings.name || computerName, slug: slug(this.settings.name || computerName) }
    this.runner = new Runner()
    this.hub = new Hub(this.runner, { bin })
    this.hub.relay = (from, names, text, images, extra) => this.relay(from, names, text, images, extra)
    this.hub.relayTask = (host, from, args) => this.link(host).peer.call('task', [`${from}@${this.me.slug}`, args])
    this.hub.self = this.me.slug
    this.hub.directory = () => this.snapshot().agents.filter((a) => a.home)
    this.hub.elsewhere = (name) => {
      const there = this.hub.directory().filter((a) => a.seed === name)
      return there.length === 1 ? there[0].name : undefined
    }
  }

  async start() {
    const server = await serve(this.hub)
    this.hub.start(`http://127.0.0.1:${server.address().port}`)
    const pushAll = (...msg) => {
      for (const l of this.links.values()) l.peer?.push(...msg)
    }
    // Terminal output is batched per frame so a chatty agent doesn't flood IPC or the network.
    const out = new Map()
    this.flushPty = () => {
      clearTimeout(this.ptyTimer)
      this.ptyTimer = null
      for (const [name, data] of out) {
        this.emit('pty', name, data)
        pushAll('pty', name, data)
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
    this.hub.on('notice', (n) => this.emit('notice', n))
    this.hub.on('alert', (a, text) => {
      this.emit('alert', a.name, text)
      pushAll('alert', a.name, text)
    })
    if (this.settings.share) await this.share(true).catch(() => {})
    for (const code of this.settings.peers ?? []) this.connect(code, { save: false }).catch(() => {})
  }

  stop() {
    for (const l of this.links.values()) {
      l.client?.close()
      l.peer?.close()
    }
    this.sharing?.stop()
    this.hub.saveStats()
    this.hub.saveConvos(true)
    this.runner.stopAll()
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

  snapshot() {
    const s = this.hub.snapshot()
    const agents = s.agents.map((a) => ({ ...a, home: null }))
    const feed = [...s.feed]
    const tickets = s.tasks.tickets.map((t) => ({ ...t, key: String(t.id), home: null }))
    const providers = {}
    for (const l of this.links.values()) {
      if (!l.state) continue
      const q = this.qualifier(l)
      Object.assign(providers, l.state.providers)
      for (const a of l.state.agents) {
        agents.push({
          ...a, name: q(a.name), seed: a.name, home: l.slug, homeName: l.name, status: l.peer ? a.status : 'away', images: a.images?.map((p) => this.fetchImage(l, p)),
          ticket: a.ticket == null ? null : q(String(a.ticket)), ...(a.cloneOf && { cloneOf: q(a.cloneOf) }),
        })
      }
      for (const e of l.state.feed) {
        feed.push({
          ...e, id: `${e.id}@${l.slug}`, from: q(e.from), to: q(e.to), cc: e.cc?.map(q), re: e.re && `${e.re}@${l.slug}`, images: e.images?.map((p) => this.fetchImage(l, p)),
          ...(e.ticket !== undefined && { ticket: q(String(e.ticket)) }), ...((e.act === 'fixing' || e.act === 'triaged') && e.text && { text: q(e.text) }),
        })
      }
      // Tasks that live there: #12 there is 12@that-computer here. (`bugs`: a computer on the previous version.)
      for (const t of (l.state.tasks ?? l.state.bugs)?.tickets ?? []) {
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
    return {
      ...s, providers: { ...providers, ...s.providers }, agents: agents.filter((a) => !hidden.has(a.cloneOf ?? a.name)), feed: [...open, ...recent], computers: this.computers(),
      tasks: { ...s.tasks, tickets },
    }
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

  // Bare names resolve to this computer first, then to the one linked computer with an agent by that name.
  resolve(name) {
    const agents = this.snapshot().agents
    if (name.includes('@')) {
      const { l, base } = this.where(name)
      if (l && !l.state?.agents.some((a) => a.name === base)) throw new Error(`no agent named "${name}" (try: crew who)`)
      return l ? name : base
    }
    if (this.hub.agents.has(name)) return name
    if (this.hub.agents.has(this.hub.baseOf(name))) return this.hub.baseOf(name) // a clone that went away: its original
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

  // ---- actions from this computer's UI -----------------------------------------------------------

  // opts.fresh: deliver into a new conversation.
  async send(to, text, images = [], { fresh = false } = {}) {
    let names = addressees(to, text).map((n) => this.resolve(n))
    if (!names.length) {
      // agents, not their clones; one here that can clone itself counts as free
      const ready = this.snapshot().agents.filter((a) => a.on && !a.cloneOf && !['stopped', 'off', 'away'].includes(a.status))
      const best = bestFor(text, ready.map((a) => (a.home ? a : { ...a, ...this.hub.lineup(this.hub.agents.get(a.name)) })))
      if (!best) throw new Error('no agents to send to')
      names = [best.name]
    }
    const out = []
    for (const [home, bases] of this.group(names)) {
      if (!home) out.push(await this.hub.send({ to: bases.join(','), text, images, mentions: false, fresh }))
      else {
        const l = this.link(home)
        out.push(await l.peer.call('deliver', [{ to: bases.join(','), text, images: await this.toHome(images, l), fresh }]))
      }
    }
    return out.join('')
  }

  // A local agent's `crew send` to agents on other computers.
  // A local agent's `crew send` (or a bug sent to its fixer) to agents on other computers.
  async relay(from, names, text, images, extra = {}) {
    const out = []
    for (const [home, bases] of this.group(names)) {
      if (!home) throw new Error(`${bases.join(', ')}: that's this computer, leave off the @${this.me.slug}`)
      const l = this.link(home)
      // a bug's number, as that computer names it
      const ticket = extra.ticket !== undefined ? { ticket: `${extra.ticket}@${this.me.slug}` } : {}
      const sender = from === 'you' ? 'you' : `${from}@${this.me.slug}`
      out.push(await l.peer.call('deliver', [{ ...extra, ...ticket, from: sender, to: bases.join(','), text, images: await this.toHome(images, l) }]))
    }
    return out.join('')
  }

  // Run fn on whichever computer `name` lives on.
  async at(name, fn, ...args) {
    const { l, base } = this.where(name)
    if (l) return l.peer.call(fn, [base, ...args])
    return this.serve(fn, [base, ...args])
  }

  async update(names, patch) {
    for (const [home, bases] of this.group([].concat(names))) {
      if (!home) this.hub.update(bases, patch)
      else {
        const l = this.link(home)
        await l.peer.call('update', [bases, patch.images ? { ...patch, images: await this.toHome(patch.images, l) } : patch])
      }
    }
  }

  async addAgent({ home, ...fields }) {
    if (!home) return this.hub.addAgent(fields)
    const l = this.link(home)
    return `${await l.peer.call('addAgent', [{ ...fields, images: await this.toHome(fields.images, l) }])}@${l.slug}`
  }

  // A Tasks board action. A task lives on the computer it was added on: 12@air is #12 on Air.
  async ticket(op, key, arg) {
    if (op === 'file') return this.hub.fileTask(arg)
    const { l, base } = this.where(String(key))
    if (!l) return this.hub.ticket(op, base, arg)
    if (arg?.owner) arg = { ...arg, owner: this.qualifierFor(l)(arg.owner) }
    if (arg?.images) arg = { ...arg, images: await this.toHome(arg.images, l) } // screenshots live with the bug
    return l.peer.call('ticket', [op, base, op === 'dispatch' && arg?.to ? { ...arg, to: this.qualifierFor(l)(arg.to) } : arg])
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

  feedAction(id, fn, ...args) {
    const { l, base } = this.where(id)
    return l ? l.peer.call(fn, [base, ...args]) : this.hub[fn](base, ...args)
  }

  draftPrompt({ home, ...agent }) {
    return home ? this.link(home).peer.call('draftPrompt', [agent]) : this.hub.draftPrompt(agent)
  }

  // ---- what linked computers may ask of this one -----------------------------------------------

  serve(fn, args) {
    const h = this.hub
    const allowed = {
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
      resize: (name, cols, rows) => this.runner.resize(name, cols, rows),
      // Flush first: chunks already batched are in the buffer, so a viewer replaying it won't see them twice.
      buffer: (name) => {
        this.flushPty()
        return this.runner.buffer(name)
      },
      exportAgents: (names, opts) => packAgents(h, names, opts),
      freshStart: (name) => h.freshStart(name),
      task: (from, args) => h.taskCommand(from, args),
      bug: (from, args) => h.taskCommand(from, args), // a computer on the previous version
      ticket: (op, id, arg) => h.ticket(op, id, arg),
      importAgents: (pack, choices) => unpackAgents(h, pack, choices),
    }
    if (!Object.hasOwn(allowed, fn)) throw new Error(`"${fn}" isn't available over Crew Link`)
    return allowed[fn](...args)
  }

  // ---- export, import, move ----------------------------------------------------------------------

  async exportAgents(names, opts = {}) {
    const packs = []
    for (const [home, bases] of this.group(names)) packs.push(home ? await this.link(home).peer.call('exportAgents', [bases, opts]) : packAgents(this.hub, bases, opts))
    return { crew: 1, exported: new Date().toISOString(), agents: packs.flatMap((p) => p.agents), providers: Object.assign({}, ...packs.map((p) => p.providers)) }
  }

  // Every name in use on a computer (home '' = this one), to suggest free ones.
  namesOn(home) {
    return new Set(home ? (this.links.get(home)?.state?.agents ?? []).map((a) => a.name) : this.hub.agents.keys())
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
    const added = new Map() // choice -> name it got, in the order they were chosen
    const byHome = new Map()
    for (const c of choices) byHome.set(c.home ?? '', [...(byHome.get(c.home ?? '') ?? []), c])
    for (const [home, list] of byHome) {
      const sub = { ...pack, agents: list.map((c) => pack.agents[c.index]) }
      const picks = list.map((c, i) => ({ index: i, name: c.name, folder: c.folder, on: false }))
      const names = home ? (await this.link(home).peer.call('importAgents', [sub, picks])).map((n) => `${n}@${home}`) : unpackAgents(this.hub, sub, picks)
      list.forEach((c, i) => added.set(c, names[i]))
    }
    return choices.map((c) => added.get(c))
  }

  // Moves an agent to another computer with its definition, look and work experience. Its conversation
  // stays behind (transcripts are files on the old computer), so it starts fresh there.
  async moveAgent(name, home, folder) {
    const src = this.where(name)
    const from = src.l?.slug ?? ''
    if (from === (home ?? '')) throw new Error('it already lives there')
    const agent = this.snapshot().agents.find((a) => a.name === name)
    const pack = src.l ? await src.l.peer.call('exportAgents', [[src.base], { stats: true }]) : packAgents(this.hub, [src.base], { stats: true })
    const pick = [{ index: 0, name: this.freeName(src.base, home), folder: folder ?? agent?.cwd, on: Boolean(agent?.on) }]
    const [moved] = home ? await this.link(home).peer.call('importAgents', [pack, pick]) : unpackAgents(this.hub, pack, pick)
    await (src.l ? src.l.peer.call('removeAgent', [src.base]) : this.hub.removeAgent(src.base))
    return home ? `${moved}@${home}` : moved
  }

  // ---- computers: sharing this one, linking others, choosing which agents to use -------------

  computers() {
    const hidden = new Set(this.settings.hidden ?? [])
    const port = this.settings.port ?? DEFAULT_PORT
    let me = { name: this.me.name, slug: this.me.slug, sharing: Boolean(this.sharing), error: this.linkError, agents: this.hub.config.agents.length }
    if (this.sharing) {
      if (Date.now() - this.hosts.at > 30000) this.findHosts() // networks come and go (Wi-Fi, Tailscale)
      const hosts = this.hosts.list
      me = { ...me, port, hosts, code: makeCode({ name: this.me.name, port, key: this.settings.key, fingerprint: this.sharing.fingerprint, hosts: hosts.map((h) => h.address) }) }
    }
    const links = [...this.links.values()].map((l) => {
      const q = this.qualifier(l)
      return {
        slug: l.slug, name: l.name, online: Boolean(l.peer), saved: Boolean(l.code), status: l.client?.status,
        agents: (l.state?.agents ?? []).filter((a) => !a.cloneOf).map((a) => ({ name: q(a.name), seed: a.name, area: a.area, avatar: a.avatar, status: a.status, on: a.on, hidden: hidden.has(q(a.name)) })),
      }
    })
    return { me, links }
  }

  hosts = { at: 0, list: [] }

  async findHosts() {
    this.hosts.at = Date.now()
    const list = await addresses()
    if (JSON.stringify(list) === JSON.stringify(this.hosts.list)) return
    this.hosts.list = list
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
    Object.assign(l, { name: peer.name, peer, client: client ?? l.client })
    const q = this.qualifier(l)
    peer.on('state', (s) => {
      l.state = s
      this.changed()
    })
    peer.on('pty', (n, d) => this.emit('pty', q(n), d))
    peer.on('alert', (n, t) => this.emit('alert', q(n), t))
    peer.on('input', (n, d) => this.hub.input(n, d))
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
    this.hub.self = this.me.slug
    this.saveSettings()
    // other computers learn the new name when they reconnect
    if (this.sharing) this.stopSharing(), this.startSharing().catch(() => {})
    for (const l of this.links.values()) l.peer?.close()
    this.changed()
  }
}

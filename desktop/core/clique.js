// One clique across your computers: this computer's hub plus every linked computer's agents, merged into one
// list (agents elsewhere are name@computer), with each action routed to the computer the agent lives on.
// No Electron in here: main.js owns windows and dialogs and talks to this.
import { forClients } from './threads.js'
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hub, HOME, ATTACHMENTS, addressees, openConfig, saveImage, checkInOf, expand, sessionsLeft, arrivedLeft } from './hub.js'
import { movedPath } from './home.js'
import { FETCH_MAX, kindOf, travels } from './attachments.js'
import { LinkFiles, readPiece, inside, NO_PIECES } from './linkfiles.js'
import { BROKEN } from './config.js'
import { Runner, Scoped } from './runner.js'
import { ROOT, named, workspacesIn, space, channelsIn, addWorkspace, setLook, dropWorkspace, addChannel, editChannel, dropChannel, dirOf } from './workspaces.js'
import { providersFrom, expandEnv, isOffered } from './providers.js'
import { accountsIn, accountsInUse, addAccount, renameAccount, moveAgents, dropAccount, signsIn, accountDir, prepare as prepareAccount, whoIs, signIn, signOut, removeFolder } from './accounts.js'
import { History, UNKNOWN } from './history.js'
import { HostRunner } from './ptyclient.js'
import { serve } from './server.js'
import { LinkHost, LinkClient, PairClient, identity, addresses, firewallWarning, makeCode, readCode, slug, DEFAULT_PORT } from './link.js'
import { Discovery, DISCOVER_PORT } from './discover.js'
import { packAgents, unpackAgents } from './pack.js'
import { moveOut, moveRead, moveEnd, moveWrite, moveIn, moveDrop, agentMoved, folderInfo, folders } from './move.js'
import { Phones } from './phones.js'
import { workingHere } from './awake.js'
import { sweepFiles, ATTACHMENT_DAYS, CACHE_DAYS } from './keep.js'
import { SAVERS, SAVER_IDS, saversFrom, report } from './savers.js'
import { prefsOf, prefsToSave, changed as notifyChanged } from './notify.js'
import { MODES, toolMode, parse as parseTool, help as toolHelp, offText, alertOf } from './tools.js'
import { TICK, LATE_AFTER, LATE_MAX, nextRun, ruleText, whenText, zoneNow, repoMark } from './schedules.js'

// Where Claude Code and Codex keep their logs (as Hub.lookBack reads them), the folder of any provider of yours that has
// its own (CLAUDE_CONFIG_DIR or CODEX_HOME in its env: that folder's logs are that provider's), and your accounts' folders.
export function logRoots(providers = {}, env = process.env, accounts = []) {
  const claude = (dir) => path.join(dir, 'projects')
  const codex = (dir) => path.join(dir, 'sessions')
  const roots = [
    { dir: claude(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')), cli: 'claude' },
    { dir: codex(env.CODEX_HOME || path.join(os.homedir(), '.codex')), cli: 'codex' },
  ]
  for (const p of Object.values(providers)) {
    if (!p || typeof p.env !== 'object' || !p.env) continue // (config.json is yours to write: an env that isn't one is none)
    const cli = p.cli ?? 'claude'
    const home = expandEnv(p.env)[cli === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']
    const dir = home && (cli === 'codex' ? codex(home) : claude(home))
    if (dir && !roots.some((r) => path.resolve(r.dir) === path.resolve(dir))) roots.push({ dir, cli, provider: p.id })
  }
  // and each of your accounts' folders (core/accounts.js): what's logged there is that account's
  for (const a of accounts) {
    const p = providers[a.provider]
    if (!p) continue
    const cli = p.cli ?? 'claude'
    const dir = cli === 'codex' ? codex(accountDir(a.id)) : claude(accountDir(a.id))
    if (!roots.some((r) => path.resolve(r.dir) === path.resolve(dir))) roots.push({ dir, cli, provider: a.provider, account: a.id })
  }
  return roots
}

export const LINK_DIR = path.join(HOME, 'link')
export const CACHE = path.join(LINK_DIR, 'cache')
export const USAGE_DIR = path.join(LINK_DIR, 'usage')
const USAGE_SPACES = path.join(HOME, 'usage-spaces.json') // (Clique.rememberSpaces)
const SETTINGS = path.join(LINK_DIR, 'link.json')
const DISCOVER_FOR = 150000 // Computers open, as the dashboard last said: it says so every minute
// Images nothing needs any more go this long after CLIque starts (sweepImages), once its workspaces have read their chats.
const SWEEP_AFTER = 60000
// The usage history (core/history.js) is brought up to date a few minutes after CLIque starts, then a few times a day.
const HISTORY_AFTER = 3 * 60000
const HISTORY_EVERY = 6 * 3600000
// A linked computer's usage history (theirUsage) is asked for again this long after its last answer, while the Usage
// view is open; sooner while that computer is still reading its logs. What it last said is kept in USAGE_DIR.
const THEIR_USAGE_EVERY = 3 * 60000
const THEIR_USAGE_READING = 2000
const THEIR_USAGE_LEFT = 60000 // which sessions removed workspaces ran is read from their files this often
const THEIR_USAGE_KEPT = 30 * 864e5 // what a computer last said it used is kept this long after it said it
// Who's signed in to each account (core/accounts.js) is asked of its CLI when the Accounts sheet opens, after a sign-in,
// and otherwise no more often than this; a little after CLIque starts when you have accounts of your own.
const ACCOUNTS_EVERY = 5 * 60000
const ACCOUNTS_AFTER = 8000
// What a linked computer may ask with no workspace (see serve).
const COMPUTER_CALLS = new Set(['in', 'spaces', 'workspaces', 'state', 'saveImage', 'readImage', 'readFile', 'moveWrite', 'moveDrop', 'folderInfo', 'usageHistory'])
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const readJSON = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// A linked computer's answer to 'usageHistory', as far as the Usage view needs it to be one.
const usable = (d) => Boolean(d) && typeof d === 'object' && Array.isArray(d.rows) && Array.isArray(d.cols) && d.rows.every((r) => Array.isArray(r))
// ...and taken no further than that: its rows as they are (the view reads them as text and numbers), and of the rest
// only what has the shape it should. A workspace's colour and an agent's look end up in the page's markup and styles, so
// they're kept only when they read as a colour's name or a look's part.
const WORD = /^[\w#. -]{1,40}$/
function tidy(d) {
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  const word = (v) => (typeof v === 'string' && WORD.test(v) ? v : undefined)
  const look = (v) => Object.fromEntries(Object.entries(obj(v)).map(([k, x]) => [k, typeof x === 'boolean' ? x : word(x)]).filter(([k, x]) => WORD.test(k) && x !== undefined))
  return {
    at: Number(d.at) || 0,
    reading: d.reading && typeof d.reading === 'object' ? { done: Number(d.reading.done) || 0, total: Number(d.reading.total) || 0 } : null,
    first: typeof d.first === 'string' && /^\d{4}-\d\d-\d\d$/.test(d.first) ? d.first : null,
    cols: d.cols.map(String),
    rows: d.rows,
    providers: Object.fromEntries(Object.entries(obj(d.providers)).map(([id, label]) => [id, String(label).slice(0, 80)])),
    spaces: Object.fromEntries(Object.entries(obj(d.spaces)).map(([key, w]) => [key, { name: String(obj(w).name ?? key).slice(0, 120), ...(word(obj(w).color) && { color: word(obj(w).color) }), ...(typeof obj(w).icon === 'string' && { icon: [...obj(w).icon].slice(0, 4).join('') }), ...(obj(w).gone && { gone: true }) }])),
    faces: Object.fromEntries(Object.entries(obj(d.faces)).map(([key, names]) => [key, Object.fromEntries(Object.entries(obj(names)).map(([name, v]) => [name, look(v)]))])),
    // its accounts, by the names it gave them (core/accounts.js)
    accounts: Object.fromEntries(Object.entries(obj(d.accounts)).map(([id, a]) => [id, { name: String(obj(a).name ?? id).slice(0, 80), provider: String(obj(a).provider ?? '').slice(0, 80) }])),
  }
}

export class Clique extends EventEmitter {
  links = new Map() // computer slug -> { slug, name, peer, client, state, toHost }

  // host: run the agents' terminals in the terminal host, where they outlive CLIque ({ file, env }: how to run it as
  // Node, core/ptyclient.js). Without it they live in this process and stop with it.
  constructor({ bin, computerName, host }) {
    super()
    // { share, port, key, name, peers: [codes], hidden: [agent names] }
    this.settings = readJSON(SETTINGS) ?? {}
    if (this.settings.remote) this.settings.peers = [this.settings.remote] // from when a link replaced this clique
    delete this.settings.remote
    this.me = { name: this.settings.name || computerName, slug: slug(this.settings.name || computerName) }
    // the phones paired with this computer; main.js serves them (core/remote.js)
    this.phones = new Phones(LINK_DIR)
    this.phones.on('change', () => this.changed())
    // linked computers' files, fetched a piece at a time as the chat shows, plays or opens them (core/linkfiles.js)
    this.files = new LinkFiles({ cache: CACHE, peer: (key) => this.links.get(key)?.peer ?? null, name: (key) => this.links.get(key)?.name ?? key })
    this.files.on('done', () => this.changed()) // a picture that's here now shows, on phones too
    this.files.on('old', () => this.changed()) // that computer can't send pieces: its recordings say they stay there
    this.bin = bin
    this.runner = host ? new HostRunner({ runtime: host }) : new Runner()
    // A hub per workspace (core/workspaces.js), all on one config.json, one terminal runner and one local server.
    this.token = crypto.randomBytes(16).toString('hex')
    fs.mkdirSync(ATTACHMENTS, { recursive: true })
    this.config = openConfig()
    this.config.on('problem', (text) => this.say(text)) // what's wrong with the file: said where you are
    this.usage = readJSON(path.join(HOME, 'usage.json')) ?? {} // your accounts' limits, the same in every workspace
    this.samples = {} // and their recent readings, for the pace
    this.locks = { files: new Map(), held: new Map(), waits: [] } // files being edited and things leased, in any workspace
    this.hubs = new Map()
    this.config.on('change', () => this.syncWorkspaces())
    this.config.load()
  }

  // CLIque's own word about this computer (a shortcut that's taken, a terminal host that's gone), in the chat on screen. It
  // waits for a workspace when there's none yet.
  say(text) {
    const hub = this.screen
    if (hub) hub.post({ kind: 'event', from: 'clique', text })
    else (this.unsaid ??= []).push(text)
  }

  // A workspace's hub, made when it's first needed. What it says to you (alerts, notices) says which workspace it's from,
  // and anything that changes there redraws the app (the switcher counts every workspace).
  workspace(id) {
    let hub = this.hubs.get(id)
    if (hub) return hub
    hub = new Hub(new Scoped(this.runner, id), { bin: this.bin, workspace: id, config: this.config, token: this.token, usage: this.usage, samples: this.samples, locks: this.locks })
    hub.others = () => [...this.hubs.values()].filter((h) => h !== hub)
    hub.hubOf = (ws) => this.hubs.get(ws) // whose a lease is
    // your accounts' limits: said where you are, and a window's line before it goes from whichever workspace it's in
    hub.aboutAccount = (entry) => {
      for (const h of this.hubs.values()) h.unsayLimit(entry.limit)
      this.here.post(entry)
    }
    // Its agents reach the agents of the same workspace on linked computers (name@computer), and its tasks theirs.
    hub.relay = (from, names, text, images, extra) => this.relay(from, names, text, images, extra, hub)
    hub.relayTask = (host, from, args) => this.linkCall(this.link(host), 'task', [`${from}@${this.me.slug}`, args], hub.ws)
    hub.self = this.me.slug
    // is an account signed in, as its CLI last said (undefined: not asked yet)? One that isn't is asked again, so
    // signing in by hand is noticed the next time its agent is started
    hub.signedIn = (id) => {
      const [key, said] = [...this.accountSaid].find(([k]) => k.endsWith(`@${id}`)) ?? []
      if (said?.signedIn === false && Date.now() - (said.at ?? 0) > 20000) this.checkAccounts({ only: key, force: true }).catch(() => {})
      return said?.signedIn
    }
    hub.appTool = (from, words, closed) => this.tool(hub, from, words, closed) // `clique app …`
    hub.directory = () => this.linkedAgents(hub)
    hub.elsewhere = (name) => {
      const there = hub.directory().filter((a) => a.seed === name)
      return there.length === 1 ? there[0].name : undefined
    }
    hub.on('notice', (n) => this.emit('notice', { ...n, ...(!n.account && { workspace: id }) }))
    hub.on('alert', (a, text) => {
      this.emit('alert', a.name, text, id)
      this.pushSpace(id, 'alert', `${this.keyOf(id)}/${a.name}`, text)
    })
    // usage is the computer's, not the workspace's: linked computers read it from computerState
    hub.on('usage', () => this.pushComputer())
    let pending = null
    hub.on('change', () => {
      this.changed()
      if (![...this.links.values()].some((l) => l.peer && l.aware && l.theirs?.has(id))) return
      pending ??= setTimeout(() => {
        pending = null
        if (this.hubs.get(id) === hub) this.pushSpace(id, 'ws', this.keyOf(id), hub.snapshot())
      }, 50)
    })
    this.hubs.set(id, hub)
    if (this.url) this.startWorkspace(hub)
    return hub
  }

  // A hub for each workspace in config.json; one that's gone stops (its hub has stopped its agents already). The one on
  // screen is the one config.json says ("current"), or the first; with none, nothing is.
  syncWorkspaces() {
    const ids = new Set(workspacesIn(this.config.data).map((w) => w.id))
    for (const id of ids) this.workspace(id)
    for (const [id, hub] of this.hubs) {
      if (ids.has(id)) continue
      hub.dispose()
      this.hubs.delete(id)
    }
    // linked computers learn which workspaces this one has now: they drop what's gone, and send theirs for what's new
    const list = this.spaceList()
    const named = JSON.stringify(list)
    if (named !== this.named) {
      this.named = named
      this.pushAware('wslist', list)
      for (const l of this.links.values()) if (l.peer && l.aware && l.list) this.theirSpaces(l, l.peer, l.list)
    }
    // and who's on your roster: a shared agent that moves there rejoins by name
    const roster = JSON.stringify(this.sharedNames())
    if (roster !== this.rosterWas) {
      this.rosterWas = roster
      this.pushComputer()
    }
    const current = ids.has(this.config.data.current) ? this.config.data.current : ids.values().next().value ?? null
    if (current !== this.current) {
      this.current = current
      this.changed()
    }
    const unsaid = this.unsaid
    if (unsaid && this.screen) {
      this.unsaid = null
      for (const text of unsaid) this.say(text)
    }
  }

  // The workspace on screen: what the app shows. null when there's no workspace at all.
  get screen() {
    return this.hubs.get(this.current) ?? null
  }

  // ...and where what you do in it goes, which needs one.
  get here() {
    if (!this.screen) throw new Error('make a workspace first')
    return this.screen
  }

  // Each workspace's agents rest until there's work for them; those still at work from before CLIque restarted carry on
  // whether it's parked or not (still running: a workspace taken out of config.json and put back has had its stopped).
  startWorkspace(hub, survivors = this.runner.survivors ?? []) {
    const own = survivors.filter((s) => hub.runner.own(s.name) && this.runner.running(s.name)).map((s) => ({ ...s, name: hub.runner.own(s.name) }))
    hub.start(this.url, { survivors: own })
  }

  // ---- workspaces: the switcher, and making, changing, opening and parking them ---------------------------------

  // Every workspace, for the switcher: its look and folder, whether it's on screen or parked, and how it's doing.
  workspaces() {
    // in config.json's order (which order() changes)
    const rank = new Map(workspacesIn(this.config.data).map((w, i) => [w.id, i]))
    return [...this.hubs.values()].sort((a, b) => (rank.get(a.ws) ?? Infinity) - (rank.get(b.ws) ?? Infinity)).map((h) => ({
      id: h.ws, name: h.space.name, color: h.space.color, icon: h.space.icon, folder: h.space.folder, parked: h.parked, current: h === this.screen,
      ...this.ownerOf(h.ws),
      members: h.space.agents.filter((a) => a.shared).map((a) => ({ name: a.name, folder: this.memberFolder(h.ws, a.name) })),
      ...h.summary(),
    }))
  }

  // A workspace's folder on this computer, as a path to open (Open in Finder / Explorer). Said in words when it has
  // none, or when the folder isn't there any more.
  workspaceFolder(id = this.current) {
    const w = workspacesIn(this.config.data).find((x) => x.id === id)
    if (!w) throw new Error('no such workspace')
    const folder = String(w.folder ?? '').trim()
    if (!folder) throw new Error(`${w.name ?? id} has no folder: pick one in its settings`)
    const dir = path.resolve(folder.replace(/^~(?=[\\/]|$)/, os.homedir())) // ~/code or, on Windows, ~\code
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${folder} isn't on this computer any more`)
    return dir
  }

  // A shared agent's own folder in a workspace (empty: it works in the workspace's).
  memberFolder(id, name) {
    const m = workspacesIn(this.config.data).find((w) => w.id === id)?.members?.[name]
    return (m && typeof m === 'object' && m.folder) || ''
  }

  // switch(id): put it on screen. create({ name, color, icon, folder, members }): a new workspace, opened and on screen.
  // edit(id, { name, color, icon, folder }), open(id), park(id), remove(id). order(null, [ids]): the order they're listed
  // in (ids left out keep their order after the ones given). members(id, { add, remove, folders }): which shared agents
  // work there, and the folder each has of its own there ('' for the workspace's).
  workspaceAction(op, id, arg) {
    // what's in memory isn't what's on disk: saving would overwrite a file that can still be fixed
    if (this.config.broken) throw new Error(BROKEN)
    const data = this.config.data
    const has = (x) => workspacesIn(data).some((w) => w.id === x)
    if (op !== 'create' && op !== 'order' && op !== 'join' && !has(id)) throw new Error('no such workspace')
    const where = () => space(data, id)
    const ops = {
      // going to a workspace that's asleep wakes it
      switch: () => {
        data.current = id
        where().parked = false
      },
      // (show: false, an agent made it: it opens without taking over the screen)
      create: () => {
        const { show = true, ...fields } = arg ?? {}
        id = addWorkspace(data, fields) // members with folders of their own start there, the first time
        // this computer's own go before linked computers' ones, so the rail keeps them together
        const list = data.workspaces
        const first = list.findIndex((w) => w?.of)
        if (first >= 0 && first < list.length - 1) list.splice(first, 0, list.pop())
        if (show) data.current = id
      },
      // join(key): a linked computer's workspace (key from remoteWorkspaces), here too and on screen. It stays its
      // owner's: its chat, tasks and agents are there, and this computer adds its own agents to it with members.
      // (A linked computer's workspaces show up on their own, showTheirs: this is for one you hid, to show it again.)
      join: () => {
        const r = this.remoteWorkspaces().find((w) => w.key === id)
        if (!r) throw new Error('no such workspace on your linked computers')
        if (this.settings.hiddenWorkspaces?.includes(r.key)) {
          this.settings.hiddenWorkspaces = this.settings.hiddenWorkspaces.filter((k) => k !== r.key)
          this.saveSettings()
        }
        const have = this.localOf(r.key)
        if (have) {
          id = have
        } else {
          if (!r.online) throw new Error(`${r.computerName} is offline: open its workspaces while it's on`)
          id = this.addTheirs(data, r)
        }
        data.current = id
        where().parked = false
      },
      edit: () => setLook(data, id, arg ?? {}),
      open: () => (where().parked = false),
      park: () => (where().parked = true),
      // a linked computer's: hidden here, and it doesn't come back on its own (join shows it again)
      remove: () => {
        const of = workspacesIn(data).find((w) => w.id === id)?.of
        if (of) {
          this.settings.hiddenWorkspaces = [...new Set([...(this.settings.hiddenWorkspaces ?? []), `${of.computer}:${of.id}`])]
          this.saveSettings()
        }
        dropWorkspace(data, id)
      },
      order: () => {
        const ids = Array.isArray(arg) ? arg.map(String) : []
        const at = (w) => (w && ids.includes(w.id) ? ids.indexOf(w.id) : ids.length)
        if (!has(data.current) && this.current) data.current = this.current // on screen as "the first": it stays on screen
        if (Array.isArray(data.workspaces)) data.workspaces = data.workspaces.map((w, i) => [w, i]).sort(([a, i], [b, j]) => at(a) - at(b) || i - j).map(([w]) => w)
      },
      members: () => {
        const { add = [], remove = [], folders = {} } = arg ?? {}
        const w = where()
        const shared = new Set(named(data.agents).map((a) => a.name))
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
    // parked by hand while CLIque was closed, and still running what carried on: park stops those too
    if (op === 'park') this.hubs.get(id)?.park()
    // the last of yours out of a linked computer's workspace it has removed since, or you left one that was on screen
    // when it did: that one goes now
    const of = op === 'members' && workspacesIn(data).find((w) => w.id === id)?.of
    if (of) this.showTheirs(of.computer)
    if (op === 'switch') for (const computer of this.knownSpaces.keys()) this.showTheirs(computer)
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
  // One shown from a linked computer has that computer's channels: the change is made there, and comes back with its
  // list (-> a promise of the same).
  channelAction(op, id, arg, ws = this.current) {
    if (!workspacesIn(this.config.data).some((w) => w.id === ws)) throw new Error('no such workspace')
    if (this.ownerOf(ws).owner) return this.theirChannel(op, id, arg, ws)
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

  async theirChannel(op, id, arg, ws) {
    const { owner, ownerName } = this.ownerOf(ws)
    const l = this.links.get(owner)
    if (!l?.peer) throw new Error(`${ownerName} is offline: its channels are changed while it's on`)
    const there = arg && Array.isArray(arg.members) ? { ...arg, members: arg.members.map(this.qualifierFor(l)) } : arg
    try {
      id = await this.linkCall(l, 'channel', [op, id, there], ws)
    } catch (e) {
      if (/"channel" isn't available over CLIque Link/.test(e.message)) throw new Error(`${ownerName} runs an older CLIque: change its channels there, or update it`)
      throw e
    }
    // its list comes back on its own, a moment later: the channel is here by the time this says it's made
    const has = () => this.hubs.get(ws)?.space.channels.some((c) => c.id === id)
    for (const end = Date.now() + 2000; op !== 'edit' && has() !== (op === 'create') && Date.now() < end; ) await new Promise((r) => setTimeout(r, 25))
    return { id, state: this.snapshot() }
  }

  // ---- agent tools (core/tools.js): `clique app …` from an agent's shell -------------------------------------------
  // hub: the workspace it came from. Looking runs as it is. A change runs right away in Automatic, unless it's one that
  // always asks; otherwise it waits for your OK on a card in that workspace's chat. Only an agent can ask: anything
  // else (your own terminal, or a caller saying it's no agent) gets only what runs without asking.
  // -> what the command prints
  async tool(hub, from, words, closed, { hold } = {}) {
    const call = parseTool(words)
    const mode = toolMode(this.config.data)
    if (call.help) return toolHelp(mode)
    if (mode === 'off') throw new Error(offText())
    const plan = call.tool.plan({ clique: this, hub, from }, call)
    if (call.tool.read) return plan.run()
    // Checked again when it runs, which may be a while after the card went up: tools turned off since, config.json that
    // can't be read (what's in memory isn't what's on disk, and saving would overwrite it), or the workspace it was for
    // gone.
    const { run, hub: target } = plan
    const where = target?.space.name // as it was: a hub that's gone reads as no workspace
    plan.run = () => {
      if (toolMode(this.config.data) === 'off') throw new Error('the user has turned agent tools off')
      if (this.config.broken) throw new Error(BROKEN)
      if (target && this.hubs.get(target.ws) !== target) throw new Error(`${where} isn't there any more`)
      return run()
    }
    if (this.config.broken) throw new Error(BROKEN)
    const risky = Boolean(call.tool.risky || plan.risky)
    if (mode === 'auto' && !risky) {
      const text = await plan.run()
      hub.toolDone(from, plan)
      return `${text}\n`
    }
    if (!hub.agents.has(from)) throw new Error(`that needs the user's OK, and only one of their agents can ask for it here: ${mode === 'auto' ? 'it always asks' : 'agent tools ask first'}. Do it in CLIque instead`)
    return hub.toolAsk(from, { ...plan, risky, alert: alertOf(plan) }, closed, hold)
  }

  setTheme(theme) {
    this.config.data.theme = ['light', 'dark'].includes(theme) ? theme : 'system'
    this.config.save()
  }

  // Where the floating chat lives on this computer: 'sticky', a pill you put somewhere (nothing in config.json says so),
  // or 'mouse', a buddy that follows the pointer and opens where it is (core/follow.js). -> which it is now
  setChatAt(where) {
    if (where === 'mouse') this.config.data.chatAt = 'mouse'
    else delete this.config.data.chatAt
    this.config.save()
    return this.config.data.chatAt === 'mouse' ? 'mouse' : 'sticky'
  }

  // When CLIque may notify you (core/notify.js): config.json's `notifications`, there only once something isn't the
  // default. setNotifications({ days, from, to }) is the schedule, ({ pause: 'hour' | 'morning' | 'manual' | 'off' }) the
  // pause from the menu bar. It's this computer's: each of your computers notifies on its own.
  get notifications() {
    return prefsOf(this.config.data.notifications)
  }

  setNotifications(patch, now = Date.now()) {
    const kept = prefsToSave(notifyChanged(this.config.data.notifications, patch, now))
    if (kept) this.config.data.notifications = kept
    else delete this.config.data.notifications
    this.config.save()
    this.changed()
    return this.notifications
  }

  // Is this agent still waiting for you in a workspace: its status says so, or a card of its is still up (an agent tool's
  // card stays while its agent carries on). One on a linked computer: as that computer last said, and not while it's
  // unreachable. A notification for it comes down once this says no.
  stillNeeds(ws, name) {
    const hub = this.hubs.get(ws)
    if (!hub) return false
    if (hub.agents.has(name)) return hub.agents.get(name).status === 'waiting' || [...hub.asks.values()].some((q) => q.name === name)
    for (const l of this.links.values()) {
      const st = l.peer && this.linkedState(l, hub.ws)
      if (!st) continue
      const q = this.qualifier(l)
      if (st.agents.some((a) => q(a.name) === name && a.status === 'waiting')) return true
      if (st.feed.some((e) => e.kind === 'ask' && !e.answer && q(e.from) === name)) return true
    }
    return false
  }

  // Whether this computer stays awake while its agents work (core/awake.js). On unless config.json says
  // "keepAwake": false.
  setKeepAwake(on) {
    if (on) delete this.config.data.keepAwake
    else this.config.data.keepAwake = false
    this.config.save()
    this.changed()
    return Boolean(on)
  }

  // What could keep this computer awake right now, for decide() in core/awake.js.
  awakeNow() {
    return {
      working: workingHere(this.hubs.values()),
      enabled: this.config.data.keepAwake !== false,
      sharing: Boolean(this.sharing),
      linked: [...this.links.values()].some((l) => l.peer),
      phones: this.phones.live.size > 0,
    }
  }

  // Agent tools: 'off', 'ask' (the default, so config.json doesn't say it) or 'auto'. Turned off, the cards still up
  // close, and their agents hear that nothing was made.
  setTools(mode) {
    if (!MODES.includes(mode)) throw new Error(`agent tools are ${MODES.join(', ')}, not ${mode}`)
    if (mode === 'ask') delete this.config.data.tools
    else this.config.data.tools = mode
    this.config.save()
    if (mode === 'off') for (const hub of this.hubs.values()) hub.dropTools('The user turned agent tools off, so it wasn\'t made.')
    this.changed()
    return mode
  }

  async start() {
    // anywhere: no workspace said, by something that isn't an agent's hook: ROOT's, else the one on screen
    const server = (this.server = await serve({ token: this.token, hubFor: (id, { anywhere } = {}) => this.hubs.get(id) ?? (anywhere ? this.screen : undefined) }))
    let survivors = []
    if (this.runner.connect) {
      try {
        survivors = await this.runner.connect()
      } catch (e) {
        // no terminal host: the agents run in here, as before, and stop when CLIque quits
        this.runner = new Runner()
        for (const hub of this.hubs.values()) hub.useRunner(new Scoped(this.runner, hub.ws))
        this.say(`${e.message}, so agents stop when CLIque quits this time`)
      }
    }
    if (this.runner.replaced) this.say('the terminal host was from another CLIque version, so its agents stopped: each picks up its conversation once it has work')
    this.url = `http://127.0.0.1:${server.address().port}`
    for (const hub of this.hubs.values()) this.startWorkspace(hub, survivors)
    this.config.watch() // (a hub does too, but there may be none yet)
    // terminals still running for a workspace that's gone from config.json: nothing would ever hear from them again
    // (a config.json that can't be read says nothing about what's gone)
    const stray = this.config.broken ? [] : survivors.filter((s) => ![...this.hubs.values()].some((hub) => hub.runner.own(s.name)))
    for (const s of stray) this.runner.stop(s.name)
    if (stray.length) this.say(`stopped ${stray.map((s) => s.name).join(', ')}: ${stray.length === 1 ? 'it was' : 'they were'} still running for a workspace that's been removed`)
    // Terminal output is batched per frame so a chatty agent doesn't flood IPC or the network. The app gets the
    // terminals of the workspace on screen by its agents' names. Linked computers that share a workspace get its
    // terminals as key/name. Phones get any workspace's they asked for ('terminal': workspace, name, data).
    const out = new Map()
    this.flushPty = () => {
      clearTimeout(this.ptyTimer)
      this.ptyTimer = null
      for (const [name, data] of out) {
        const shown = this.screen?.runner.own(name)
        if (shown) this.emit('pty', shown, data)
        const [ws, base] = Clique.split(name)
        this.pushSpace(ws, 'pty', `${this.keyOf(ws)}/${base}`, data)
        this.emit('terminal', ws, base, data)
      }
      out.clear()
    }
    this.runner.on('data', (name, data) => {
      out.set(name, (out.get(name) ?? '') + data)
      this.ptyTimer ??= setTimeout(this.flushPty, 16)
    })
    if (this.settings.share) await this.share(true).catch(() => {})
    for (const code of this.settings.peers ?? []) this.connect(code, { save: false }).catch(() => {})
    this.sweepTimer = setTimeout(() => this.sweepImages(), SWEEP_AFTER)
    this.sweepTimer.unref?.()
    // scheduled messages: what came due while CLIque was closed is looked at once everything has had a moment to start
    this.scheduleTimer = setInterval(() => this.runSchedules().catch(() => {}), TICK)
    this.scheduleTimer.unref?.()
    this.keepHistory(HISTORY_AFTER)
    if (accountsIn(this.config.data).length) {
      this.accountsTimer = setTimeout(() => this.checkAccounts().catch(() => {}), ACCOUNTS_AFTER)
      this.accountsTimer.unref?.()
    }
  }

  // The usage history keeps itself up to date while CLIque runs, whether or not the Usage view is ever opened: Claude
  // Code deletes its logs after a month, so a day that isn't read by then is gone. A look only reads what was added
  // since the last one, in a worker thread.
  keepHistory(wait = HISTORY_EVERY) {
    clearTimeout(this.historyTimer)
    this.historyTimer = setTimeout(() => {
      try {
        this.usageSummary() // (this computer's: asking for it starts a look when the last one is a while ago)
      } catch {}
      this.keepHistory()
    }, wait)
    this.historyTimer.unref?.()
  }

  // ---- scheduled messages (core/schedules.js) ---------------------------------------------------------------------
  // A workspace's own, kept beside its chat on the computer they were made on, and sent from it.

  // schedule('add', null, { text, to, channel, images, repeat, date, time, ifChanged }), schedule('edit', id, patch),
  // schedule('pause' | 'resume' | 'remove', id), schedule('now', id): send it now, whatever its time.
  // by: who made it ('you', or the agent that asked). -> { id, same?, state }
  async scheduleAction(op, id, arg, ws = this.current, { by = 'you' } = {}) {
    const hub = this.hubs.get(ws)
    if (!hub) throw new Error('no such workspace')
    const list = hub.schedules
    const now = this.clock()
    let same = false
    const checked = (input) => {
      const names = String(input?.to ?? '').split(/[\s,]+/).map((n) => n.replace(/^@/, '').trim()).filter(Boolean)
      // someone here, or on a linked computer (name@computer): a wrong name is said now, not at 9:00
      const to = names.map((n) => this.resolve(n, hub))
      const off = to.filter((n) => hub.agents.get(n)?.off)
      if (off.length) throw new Error(`@${off[0]} is turned off: turn it on first`)
      return { ...input, to: to.join(','), channel: (input?.channel && hub.space.channels.find((c) => c.id === input.channel)?.id) || null }
    }
    const ops = {
      add: () => {
        const made = list.add(checked(arg ?? {}), { by, now })
        same = made.same && (made.schedule.paused ? 'paused' : true)
        id = made.schedule.id
      },
      edit: () => list.edit(id, checked({ ...list.get(id), ...(arg ?? {}) }), { now }),
      pause: () => list.pause(id, true, { now }),
      resume: () => {
        const s = list.pause(id, false, { now })
        delete s.told
      },
      remove: () => list.remove(id),
      now: () => this.fire(hub, list.get(id), now, { byHand: true }),
    }
    if (!Object.hasOwn(ops, op)) throw new Error(`unknown schedule action "${op}"`)
    await ops[op]()
    hub.changed()
    return { id, ...(same && { same }), state: this.snapshot() }
  }

  // The time, as schedules read it (tests set their own).
  clock() {
    return Date.now()
  }

  // What's due goes out: each schedule at most once, however long ago its time was (CLIque closed, the computer
  // asleep), and then waits for its next time. Called every TICK.
  async runSchedules(now = this.clock()) {
    if (this.scheduling) return
    this.scheduling = true
    try {
      const tz = zoneNow()
      for (const hub of [...this.hubs.values()]) {
        const list = hub.schedules
        let changed = false
        for (const s of [...list.all]) {
          // "only when the repo changed" goes by how the repo was once the run before had finished
          if (s.settle && !this.scheduleBusy(hub, s)) {
            const mark = await repoMark(hub.space.folder)
            if (mark) s.mark = mark
            else delete s.mark
            delete s.settle
            changed = true
          }
          if (!list.all.includes(s)) continue
          if (s.paused || !s.next) continue
          // the clocks are another place's now (a laptop that travelled): 9:00 is 9:00 here
          // (a one-off whose time has gone by there keeps the time it had: it goes out late, or says it was missed)
          if (s.zone !== tz && s.next > now) {
            Object.assign(s, { next: nextRun(s, now, tz) ?? s.next, zone: tz })
            changed = true
          }
          // (removed or paused while the one before it was going out: not this one)
          if (!list.all.includes(s) || s.paused || !s.next || s.next > now) continue
          // one that can't run (a schedules.json edited by hand) doesn't hold up the rest
          try {
            await this.fire(hub, s, now)
          } catch (e) {
            s.next = null
            s.last = { at: now, result: 'failed', why: String(e?.message ?? e).slice(0, 300) }
          }
          changed = true
        }
        if (changed) {
          list.save()
          hub.changed()
        }
      }
    } finally {
      this.scheduling = false
    }
  }

  // Is a schedule's last run still going: here, or on a linked computer it was sent to?
  scheduleBusy(hub, s) {
    if (!s.sent) return false
    if (hub.scheduleBusy(s.id, s.sent)) return true
    for (const l of this.links.values()) {
      const st = this.linkedState(l, hub.ws)
      for (const e of st?.feed ?? []) {
        if (e.scheduled?.id !== s.id || e.scheduled.at !== s.sent) continue
        if (e.queued || e.held) return true
        const a = st.agents.find((x) => x.name === e.to)
        if (a && ['working', 'waiting'].includes(a.status) && !st.feed.some((r) => r.kind === 'reply' && r.re === e.id)) return true
      }
    }
    return false
  }

  // One schedule's turn. byHand: you pressed Send now, so nothing holds it back and its next time stays as it is.
  async fire(hub, s, now, { byHand = false } = {}) {
    const list = hub.schedules
    const tz = zoneNow()
    const repeating = s.repeat !== 'once'
    // the time it's for: the one that came due, or, after several went by (closed for days), the latest of them
    let due = s.next
    for (let i = 0, n; !byHand && repeating && i < 800 && (n = nextRun(s, due, tz)) !== null && n <= now; i++) due = n
    const gist = `"${s.text.replace(/\s+/g, ' ').trim().slice(0, 60)}${s.text.trim().length > 60 ? '…' : ''}"`
    const say = (text) => hub.post({ kind: 'event', from: 'clique', text, schedule: s.id, ...(s.channel && hub.channel(s.channel) && { channel: s.channel }) })
    if (!byHand) {
      // its next time first: whatever happens below, it can't come due twice
      s.next = repeating ? nextRun(s, now, tz) : null
      s.zone = tz
      const late = now - due
      if (late > LATE_MAX) {
        s.last = { at: now, result: 'missed', due }
        say(`Scheduled message ${gist} wasn't sent: it was due ${whenText(due, tz)}, while CLIque was closed or this computer was asleep.${repeating ? ` Next: ${whenText(s.next, tz)}` : ' Send it now from Scheduled messages, or remove it'}`)
        return list.save()
      }
      if (repeating && this.scheduleBusy(hub, s)) {
        s.last = { at: now, result: 'busy' }
        // said once, until a run goes out again
        if (!s.told) say(`Scheduled message ${gist} skipped this time: its last run is still going. It goes out again once that's done (next: ${whenText(s.next, tz)})`)
        s.told = true
        return list.save()
      }
      if (repeating && s.ifChanged && s.mark && s.last?.result !== 'failed') {
        const mark = await repoMark(hub.space.folder)
        if (!list.all.includes(s) || s.paused) return list.save() // removed or paused while the repo was read
        if (mark && mark === s.mark) {
          s.last = { at: now, result: 'unchanged' }
          return list.save()
        }
      }
    }
    const late = !byHand && now - due > LATE_AFTER
    try {
      // (sent without it, it would go to everyone's channel, for Auto to pick from all of them)
      if (s.channel && !hub.space.channels.some((c) => c.id === s.channel)) throw new Error(`its channel, #${s.channel}, isn't there any more: change the schedule, or remove it`)
      await this.send(s.to || undefined, s.text, s.images ?? [], { ...(s.channel && { channel: s.channel }), scheduled: { id: s.id, at: now, ...(late && { late: due }) } }, hub)
      s.last = { at: now, result: late ? 'late' : 'sent', ...(late && { due }) }
      s.sent = now
      delete s.told
      if (s.ifChanged) s.settle = true
      // a one-off that went out is done: it's in the chat now
      if (!repeating && list.all.includes(s)) list.all.splice(list.all.indexOf(s), 1)
    } catch (e) {
      const why = String(e?.message ?? e).split('\n')[0].slice(0, 300)
      s.last = { at: now, result: 'failed', why }
      say(`Scheduled message ${gist} (${ruleText(s)}) didn't go out: ${why}`)
    }
    list.save()
  }

  // Images nothing needs any more (core/keep.js): attachments that no workspace's chat, task or agent refers to, saved
  // over ATTACHMENT_DAYS ago, and linked computers' files fetched over CACHE_DAYS ago (fetched again when they're
  // shown or played). -> { attachments, cache }: how many went.
  sweepImages(now = Date.now()) {
    if (this.config.broken) return { attachments: 0, cache: 0 } // which workspaces there are isn't known: nor is what they need
    // (movedPath: an image written down before the app's folder moved is the same file, where it is now)
    const key = (p) => (process.platform === 'win32' ? path.resolve(movedPath(p)).toLowerCase() : path.resolve(movedPath(p)))
    const used = new Set()
    const add = (images) => {
      for (const p of [].concat(images ?? [])) if (typeof p === 'string') used.add(key(p))
    }
    for (const hub of this.hubs.values()) {
      for (const e of hub.feed) (add(e.images), add(e.files?.map((f) => f.path))) // what you attached, and what an agent did (core/attachments.js)
      for (const t of hub.tickets.all) add(t.images)
      for (const s of hub.schedules.all) add(s.images)
      for (const a of hub.agents.values()) {
        add(a.images)
        for (const m of [...(a.inbox ?? []), ...(a.serving ?? []), ...(a.expect?.msgs ?? []), ...(a.steering?.msgs ?? [])]) add(m?.images)
      }
      for (const c of hub.calls.values()) add(c.msg?.images)
    }
    // your agents, whichever workspaces they're in right now
    for (const a of named(this.config.data.agents)) add(a.images)
    // and what a removed workspace's files refer to: made again, it has its chat back
    let kept = ''
    let dirs = []
    try {
      dirs = fs.readdirSync(path.join(HOME, 'workspaces'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(HOME, 'workspaces', d.name))
    } catch {}
    const open = new Set([...this.hubs.values()].map((h) => h.dir))
    for (const dir of [HOME, ...dirs].filter((d) => !open.has(d))) {
      for (const file of ['feed.jsonl', 'tickets.json']) {
        try {
          kept += fs.readFileSync(path.join(dir, file), 'utf8')
        } catch {}
      }
    }
    const attachments = sweepFiles(ATTACHMENTS, { days: ATTACHMENT_DAYS, inUse: (f) => used.has(key(f)) || kept.includes(path.basename(f)), now })
    let cache = 0
    let computers = []
    try {
      computers = fs.readdirSync(CACHE, { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {}
    for (const d of computers) cache += sweepFiles(path.join(CACHE, d.name), { days: CACHE_DAYS, now })
    return { attachments, cache }
  }

  // Quitting, agents and all ("Stop agents and quit"), or with agents kept running in the terminal host (detach): the
  // next CLIque picks them up.
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
    clearInterval(this.scheduleTimer)
    clearTimeout(this.historyTimer)
    clearTimeout(this.computerTimer)
    clearTimeout(this.accountsTimer)
    for (const s of this.accountSaid.values()) s.signing?.handle.cancel()
    for (const l of this.links.values()) {
      l.client?.close()
      l.peer?.close()
    }
    this.discover(false)
    this.sharing?.stop()
    for (const hub of this.hubs.values()) {
      hub.saveStats()
      hub.saveConvos(true)
      hub.saveUsage(true)
      hub.saveSpend(true)
      hub.saveTaskTime()
    }
  }

  // Do the agents keep working once CLIque quits?
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

  // ---- CLIque Link and workspaces ------------------------------------------------------------------
  // A workspace belongs to the computer that made it, and shows up on the computers linked with it (showTheirs). Where
  // two computers have the one workspace, its clique is both computers' agents, each working in that computer's folder.
  // A linked computer gets what's about this computer ('state': computerState) and, once it has said it knows about
  // workspaces (aware, see attach), each workspace's state, terminals and alerts ('ws', key/name for the others). Calls
  // for a workspace go through 'in'.

  // A workspace's key on CLIque Link: the computer it belongs to and its id there (owner:id). One made here is this
  // computer's; one joined from a linked computer keeps its owner's ("of" in config.json). Two computers' workspaces
  // are one clique only when their keys match, so the same name or id on two computers stays two workspaces.
  keyOf(id) {
    const of = workspacesIn(this.config.data).find((w) => w.id === id)?.of
    return of && typeof of.computer === 'string' && typeof of.id === 'string' ? `${of.computer}:${of.id}` : `${this.me.slug}:${id}`
  }

  // The workspace here with that key, or null.
  localOf(key) {
    for (const id of this.hubs.keys()) if (this.keyOf(id) === key) return id
    return null
  }

  // A joined workspace's owner, for the switcher: { owner, ownerName, ownerOnline }. Nothing for this computer's own.
  ownerOf(id) {
    const key = this.keyOf(id)
    const owner = key.slice(0, key.indexOf(':'))
    if (owner === this.me.slug) return {}
    const l = this.links.get(owner)
    const kept = workspacesIn(this.config.data).find((w) => w.id === id)?.of?.name
    return { owner, ownerName: l?.name ?? this.knownSpaces.get(owner)?.name ?? kept ?? owner, ownerOnline: Boolean(l?.peer) }
  }

  // This computer's workspaces, as linked computers get them.
  spaceList() {
    return [...this.hubs.keys()].map((id) => {
      const h = this.hubs.get(id)
      const key = this.keyOf(id)
      const owner = key.slice(0, key.indexOf(':'))
      // its channels go with one of this computer's own: the computers it shows on have the same ones (showTheirs)
      return { key, owner, name: h.space.name, color: h.space.color, icon: h.space.icon, ...(owner === this.me.slug && { channels: h.space.channels }) }
    })
  }

  // Workspaces linked computers own that you can join: each with its owner and whether it's on now. A computer that
  // went offline keeps its last list here, so its workspaces show as unavailable instead of vanishing.
  remoteWorkspaces() {
    const out = []
    for (const [computer, { name, list }] of this.knownSpaces) {
      const online = Boolean(this.links.get(computer)?.peer)
      for (const w of list) out.push({ ...w, computer, computerName: name, online, joined: this.localOf(w.key) })
    }
    return out
  }

  // What's about this computer rather than any workspace, as a linked computer gets it: its accounts' usage, and who's on
  // its roster. A computer on an older CLIque reads this as the clique of its default workspace: an empty one.
  computerState() {
    const hub = this.screen ?? this.hubs.values().next().value
    return { agents: [], feed: [], tasks: { tickets: [] }, providers: {}, usage: hub?.usageNow() ?? {}, roster: this.sharedNames() }
  }

  pushComputer() {
    this.computerTimer ??= setTimeout(() => {
      this.computerTimer = null
      if (this.links.size) this.pushAll('state', this.computerState())
    }, 50)
    this.computerTimer.unref?.()
  }

  // Your shared agents' names.
  sharedNames() {
    return named(this.config.data.agents).map((a) => a.name)
  }

  // name as it crosses the link (key/name) -> [this computer's workspace or null, name].
  fromWire(n) {
    const [key, base] = Clique.split(n)
    return [this.localOf(key), base]
  }

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

  // A linked computer's workspaces, from its answer to 'workspaces' or its 'wslist' message.
  // l.theirs: the ones here with the same key, by their id here; what it no longer shares goes, and it gets ours for
  // every one we share. The ones it owns are remembered for remoteWorkspaces.
  theirSpaces(l, peer, list) {
    if (this.links.get(l.slug) !== l) return // forgotten while its list was on the way
    l.list = (Array.isArray(list) ? list : []).filter((w) => w && typeof w.key === 'string' && w.key.includes(':') && !w.key.includes('/'))
    l.theirs = new Set(l.list.map((w) => this.localOf(w.key)).filter(Boolean))
    for (const id of Object.keys(l.spaces ?? {})) if (!l.theirs.has(id)) delete l.spaces[id]
    for (const id of l.theirs) peer.push('ws', this.keyOf(id), this.hubs.get(id).snapshot())
    this.knownSpaces.set(l.slug, { name: l.name, list: l.list.filter((w) => w.owner === l.slug).map(({ key, owner, name, color, icon, channels }) => ({ key, owner, name: String(name ?? key), color, icon, ...(Array.isArray(channels) && { channels }) })) })
    this.showTheirs(l.slug)
    this.changed()
  }

  // A linked computer's workspaces show up here on their own, each as that computer's (its owner, on the rail and in
  // the header): no agents of this computer's are in one until you add them, so nothing starts here. One you hid stays
  // hidden (settings.hiddenWorkspaces) until you show it again; one its computer no longer has goes again, unless you put
  // agents of yours in it. Checked against config.json itself, not the hubs: saving runs this again, before they're made.
  showTheirs(computer) {
    const known = this.knownSpaces.get(computer)
    // a config.json that couldn't be read isn't saved over (it runs again once the file reads: syncWorkspaces)
    if (!known || this.showing || this.config.broken) return
    this.showing = true
    try {
      const data = this.config.data
      const hidden = new Set(this.settings.hiddenWorkspaces ?? [])
      const here = new Set(workspacesIn(data).map((w) => this.entryKey(w)))
      let changed = false
      for (const r of known.list) {
        // shown here already: as its computer has it now
        const shown = workspacesIn(data).find((w) => w.of && this.entryKey(w) === r.key)
        if (shown && (shown.name !== r.name || (shown.color ?? null) !== (r.color ?? null) || (shown.icon ?? null) !== (r.icon ?? null))) {
          try {
            setLook(data, shown.id, { name: r.name, color: r.color ?? '', icon: r.icon ?? '' })
            changed = true
          } catch {} // a look this version can't show
        }
        // and its channels, as its computer has them now (one on an older CLIque doesn't say: what's here stays)
        const channels = this.theirChannels(computer, r.channels)
        if (shown && channels && JSON.stringify(shown.of.channels ?? null) !== JSON.stringify(channels)) {
          shown.of = { ...shown.of, channels }
          changed = true
        }
        if (here.has(r.key) || hidden.has(r.key)) continue
        try {
          this.addTheirs(data, { ...r, computer, computerName: known.name })
          changed = true
        } catch {} // one it says oddly doesn't keep the rest from showing
      }
      const listed = new Set(known.list.map((r) => r.key))
      for (const w of workspacesIn(data)) {
        if (w.of?.computer !== computer || listed.has(this.entryKey(w)) || !this.untouched(w) || data.current === w.id) continue
        dropWorkspace(data, w.id) // its computer removed it, and nothing of this computer's is in it
        changed = true
      }
      if (changed) this.config.save()
    } finally {
      this.showing = false
    }
  }

  // A linked computer's channels for one of its workspaces, as kept here ("of.channels" in config.json): the ones that
  // read as channels, with who's in each named as this computer sees them (its ada is ada@it, milo@this-one is milo).
  // -> undefined when it said none (an older CLIque)
  theirChannels(computer, list) {
    if (!Array.isArray(list)) return undefined
    const q = this.qualifier({ slug: computer })
    return channelsIn({ channels: list }).map((c) => ({ ...c, ...(c.members && { members: c.members.map(q) }) }))
  }

  entryKey(w) {
    return w.of ? `${w.of.computer}:${w.of.id}` : `${this.me.slug}:${w.id}`
  }

  // A linked computer's workspace here as it showed up: nobody of yours in it, and nothing of yours set on it (a folder,
  // channels, triage…). Only such a one goes on its own when its computer removes it; one you've made yours stays, and
  // its banner says its computer is offline or doesn't have it.
  untouched(w) {
    const own = new Set(['id', 'name', 'color', 'icon', 'of', 'members', 'parked'])
    return Object.keys(w).every((k) => own.has(k)) && !Object.keys(w.members ?? {}).length
  }

  // A linked computer's workspace (one of remoteWorkspaces), here as its: under an id of this computer's, with its look
  // and its computer's name (for when that computer is gone), after the other workspaces of that computer.
  addTheirs(data, r) {
    const name = String(r.name ?? '').trim() || r.key.slice(r.key.indexOf(':') + 1)
    const id = addWorkspace(data, { name }, { again: false })
    try {
      setLook(data, id, { color: r.color ?? '', icon: r.icon ?? '' })
    } catch {} // a look this version can't show: it keeps the default one
    const list = data.workspaces
    const w = list.pop()
    const channels = this.theirChannels(r.computer ?? r.owner, r.channels)
    w.of = { computer: r.computer ?? r.owner, id: r.key.slice(r.key.indexOf(':') + 1), ...(r.computerName && { name: r.computerName }), ...(channels && { channels }) }
    const last = list.findLastIndex((x) => x?.of?.computer === w.of.computer)
    list.splice(last >= 0 ? last + 1 : list.length, 0, w)
    return id
  }

  // A call to a linked computer, for a workspace (the one on screen unless said).
  async linkCall(l, fn, args = [], ws = this.here.ws) {
    try {
      return await l.peer.call('in', [this.keyOf(ws), fn, args])
    } catch (e) {
      if (/isn't available over CLIque Link/.test(e.message) && /"in"/.test(e.message)) throw new Error(`${l.name} runs an older CLIque, without workspaces: update it to work with its agents here`)
      throw e
    }
  }

  // Typing into an agent's terminal, here or on its computer (in the workspace on screen, or `here`).
  input(name, data, here = this.here) {
    const { l, base } = this.where(name)
    if (!l) return here.input(base, data)
    l.peer?.input(`${this.keyOf(here.ws)}/${base}`, data)
  }

  // A terminal's name in the runner (workspace/name, see Scoped), or from a linked computer (key/name) -> [workspace or
  // key, name].
  static split(n) {
    const s = String(n)
    const at = s.indexOf('/')
    return at < 0 ? [ROOT, s] : [s.slice(0, at), s.slice(at + 1)]
  }

  // What a linked computer has of a workspace: its state for the one they share.
  linkedState(l, ws) {
    return l.spaces?.[ws]
  }

  // ---- the merged clique -------------------------------------------------------------------------

  // Names from a linked computer, as seen here: theirs get @computer, ours come back bare.
  qualifier(l) {
    return (n) => {
      if (!n || n === 'you' || n === 'clique') return n
      const at = n.indexOf('@')
      if (at < 0) return `${n}@${l.slug}`
      return n.slice(at + 1) === this.me.slug ? n.slice(0, at) : n
    }
  }

  // A workspace's state when there's no workspace: nothing in it, for the app to ask you to make one.
  blank() {
    const providers = providersFrom(this.config.data, this.config.discovered)
    return {
      parked: false, autopilot: this.config.data.autopilot ?? true, theme: this.config.data.theme,
      providers: Object.fromEntries(Object.values(providers).map((p) => [p.id, { label: p.label, models: p.models, efforts: p.efforts, modelEfforts: p.modelEfforts, missing: p.missing, fastByDefault: p.fastByDefault, ...(p.meter && { meter: p.meter }) }])),
      agents: [], feed: [], channels: channelsIn({}), reads: { since: 0, agents: {} },
      spend: { today: 0, usual: null, week: 0, weekBefore: 0 }, checkIn: checkInOf(this.config.data), usage: {}, tasks: { tickets: [], triage: null, autofix: false },
    }
  }

  // The workspace on screen (or `here`), with its linked computers' agents, and every workspace for the switcher.
  snapshot(here = this.screen) {
    const s = here?.snapshot() ?? this.blank()
    const agents = s.agents.map((a) => ({ ...a, home: null }))
    const feed = [...s.feed]
    const tickets = s.tasks.tickets.map((t) => ({ ...t, key: String(t.id), home: null }))
    const providers = {}
    for (const l of this.links.values()) {
      const st = here && this.linkedState(l, here.ws)
      if (!st) continue
      const q = this.qualifier(l)
      Object.assign(providers, st.providers)
      for (const a of st.agents) agents.push(this.linkedAgent(l, a, q))
      for (const e of st.feed) {
        feed.push({
          ...e, id: `${e.id}@${l.slug}`, from: q(e.from), to: q(e.to), cc: e.cc?.map(q), re: e.re && q(e.re), ...(e.thread && { thread: q(e.thread) }), ...(e.echo && { echo: q(e.echo) }), images: e.images?.map((p) => this.fetchImage(l, p)),
          // what an agent there attached (linkedFile)
          ...(e.files && { files: e.files.map((f) => this.linkedFile(l, f)) }),
          ...(e.ticket !== undefined && { ticket: q(String(e.ticket)) }), ...((e.act === 'fixing' || e.act === 'triaged') && e.text && { text: q(e.text) }),
          ...(e.reactions && { reactions: e.reactions.map((r) => ({ ...r, by: q(r.by) })) }),
          ...(e.also && { also: e.also.map(q) }), ...(e.reply && { reply: q(e.reply) }), ...(e.line && { line: e.line.map(q) }), ...(e.about && { about: e.about.map(q) }),
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
    // the last 200 entries of the channel and of the threads, plus any question still waiting for an answer from before them
    const recent = forClients(feed)
    const kept = new Set(recent)
    const open = feed.filter((e) => e.kind === 'ask' && !e.answer && !kept.has(e))
    const workspaces = this.workspaces()
    return {
      ...s, providers: { ...providers, ...s.providers }, agents: agents.filter((a) => !hidden.has(a.cloneOf ?? a.name)), feed: [...open, ...recent], computers: this.computers(),
      tasks: { ...s.tasks, tickets }, workspace: workspaces.find((w) => w.id === here?.ws) ?? null, workspaces,
      // linked computers' workspaces you can join (workspaceAction('join', key)), greyed while their computer is off
      remoteWorkspaces: this.remoteWorkspaces().map(({ channels, ...w }) => w),
      savers: this.saversState(),
      settingsBroken: Boolean(this.config.broken), // config.json can't be read: with no workspace, the app says so instead of asking for one
      tools: toolMode(this.config.data), // what agents may change in CLIque: off, ask or auto (core/tools.js)
      accounts: this.accountsView(), // each provider's sign-ins (core/accounts.js)
      // your shared agents, to pick who works in a workspace
      roster: named(this.config.data.agents).map((a) => ({ name: a.name, area: a.area, avatar: a.avatar })),
    }
  }

  // The token savers for the sheet: which are on (CLIQUE_SAVERS, when it's set, decides and the switches can't), what each
  // is for, and what each has counted in every workspace: in all, and over the last 7 days.
  saversState() {
    const ledgers = [...this.hubs.values()].map((h) => h.ledger)
    return {
      on: saversFrom(this.config.data), forced: Boolean(String(process.env.CLIQUE_SAVERS ?? '').trim()),
      list: SAVERS.map(({ id, label, about }) => ({ id, label, about })),
      all: report(ledgers), week: report(ledgers, { days: 7 }),
    }
  }

  // Savers on and off: { coldStart: false, … }. config.json keeps only the ones that are off.
  setSavers(patch) {
    const now = { ...saversFrom(this.config.data, {}), ...patch }
    const off = SAVER_IDS.filter((id) => now[id] === false)
    if (off.length) this.config.data.savers = Object.fromEntries(off.map((id) => [id, false]))
    else delete this.config.data.savers
    this.config.save()
    return this.saversState()
  }

  // The spend check-in (Hub.checkIn), per provider: setCheckIn({ at: { claude: 5 } }) asks once Claude agents have used
  // $5 on one request, { at: { claude: null } } is off again, { then: 'tell' } only tells. A value is in the unit that
  // provider's CLI reports (its meter); a provider without one has no check-in. It's yours, so it's one for every
  // workspace on this computer. Cards of a provider that no longer asks are answered: keep going.
  setCheckIn(patch = {}) {
    const providers = providersFrom(this.config.data, this.config.discovered)
    const now = checkInOf(this.config.data)
    for (const [id, v] of Object.entries(patch.at ?? {})) {
      const unit = providers[id]?.meter?.unit
      if (!unit) throw new Error(`${providers[id]?.label ?? id} doesn't report what its agents use, so it has no check-in`)
      if (v === null || v === false || v === 0 || v === '') {
        delete now.at[id]
        continue
      }
      const n = unit === 'usd' ? Math.round(Number(v) * 100) / 100 : Math.round(Number(v))
      if (!(n > 0) || !Number.isFinite(n)) throw new Error(unit === 'usd' ? 'a check-in is an amount in dollars' : 'a check-in is a number of tokens')
      now.at[id] = n
    }
    if (patch.then !== undefined) now.then = patch.then === 'tell' ? 'tell' : 'ask'
    if (Object.keys(now.at).length || now.then === 'tell') this.config.data.checkIn = { at: now.at, ...(now.then === 'tell' && { then: 'tell' }) }
    else delete this.config.data.checkIn
    this.config.save()
    for (const h of this.hubs.values()) h.checkInChanged()
    this.changed()
    return checkInOf(this.config.data)
  }

  // ---- usage, day by day (core/history.js), for the Usage view ---------------------------------------------------
  // Read from the CLIs' own logs, so it's everything Claude Code and Codex did on this computer: every workspace's
  // agents, and what you ran outside CLIque. Each computer reads its own logs; the Usage view shows this computer's
  // beside each linked computer's (usageHistory), which is how a workspace hosted elsewhere, or with agents on two
  // computers, shows what all of it used.

  // Who ran what, for the usage history (core/history.js placer): the sessions each workspace wrote down as its agents
  // ran them (one that's been removed: from the files it left), who works where now, and the logs that came with agents
  // moved from another computer (what they held then is that computer's to count).
  usagePlacing() {
    const owners = {}
    const arrived = {}
    const agents = []
    // a session a workspace wrote down (with its agent's name) is that workspace's, whoever else counted its spend
    const take = (found) => {
      for (const [id, own] of Object.entries(found)) if (!owners[id] || own.length > 1 || owners[id].length === 1) owners[id] = own
    }
    // what removed workspaces left is read from their files now and then, and again whenever a workspace comes or goes
    const open = [...this.hubs.keys()].sort().join('\n')
    const left = (this.leftSessions ??= { at: 0, open: null, owners: {}, arrived: {} })
    if (left.open !== open || Date.now() - left.at > THEIR_USAGE_LEFT) {
      Object.assign(left, { at: Date.now(), open, owners: {}, arrived: {} })
      let ids = []
      try {
        ids = fs.readdirSync(path.join(HOME, 'workspaces'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      } catch {}
      for (const id of [ROOT, ...ids]) {
        if (this.hubs.has(id)) continue
        Object.assign(left.owners, sessionsLeft(id, dirOf(HOME, id)))
        Object.assign(left.arrived, arrivedLeft(dirOf(HOME, id)))
      }
    }
    take(left.owners)
    Object.assign(arrived, left.arrived)
    for (const hub of this.hubs.values()) {
      take(hub.sessionsRun())
      Object.assign(arrived, hub.arrived)
      for (const a of hub.space.agents) agents.push({ name: a.name, ws: hub.ws, dir: expand(a.cwd) })
    }
    // ...and who worked where in the workspaces that are gone, as it was written down
    for (const [ws, w] of Object.entries(this.rememberSpaces())) {
      if (!this.hubs.has(ws)) for (const [name, dir] of Array.isArray(w?.agents) ? w.agents : []) agents.push({ name, ws, dir })
    }
    return { owners, agents, arrived }
  }

  // Each workspace this computer has, written down as it is now (usage-spaces.json: id -> { key, name, color, icon,
  // agents: [[name, folder]] }): once one is removed, or a linked computer's is hidden, its usage still says which
  // workspace it was (its key on CLIque Link, its name as you wrote it), and a conversation from before conversations
  // were written down is still told by where its agent worked there, instead of falling to the workspaces that are left.
  // Saved only when something changed.
  rememberSpaces() {
    const known = (this.usageSpaces ??= readJSON(USAGE_SPACES) ?? {})
    if (this.config.broken) return known
    let changed = false
    for (const h of this.hubs.values()) {
      const now = { key: this.keyOf(h.ws), name: h.space.name, ...(h.space.color && { color: h.space.color }), ...(h.space.icon && { icon: h.space.icon }), agents: h.space.agents.map((a) => [a.name, expand(a.cwd)]) }
      if (JSON.stringify(known[h.ws]) === JSON.stringify(now)) continue
      known[h.ws] = now
      changed = true
    }
    if (changed) {
      try {
        fs.writeFileSync(`${USAGE_SPACES}.tmp`, JSON.stringify(known))
        fs.renameSync(`${USAGE_SPACES}.tmp`, USAGE_SPACES)
      } catch {} // (not kept this time: it's written again the next time something changes)
    }
    return known
  }

  // This computer's usage, as the Usage view and linked computers get it:
  // { at, reading: { done, total } | null, first, cols, rows, spaces, providers, faces }
  // rows: one per day, workspace, agent, provider, model and folder (history.js COLS). A row's workspace is its key on
  // CLIque Link (keyOf), the same on every computer that has the workspace; '' is what ran outside CLIque.
  // spaces: { key: { name, color, icon, gone? } } for this computer's workspaces (gone: one that's been removed, named
  // as it was). providers: { id: label }. faces: { key: { name: avatar } } for agents that chose their look.
  usageSummary() {
    const providers = () => providersFrom(this.config.data, this.config.discovered)
    this.history ??= new History({ file: path.join(HOME, 'history.json'), roots: () => logRoots(providers(), process.env, accountsIn(this.config.data)), owners: () => this.usagePlacing().owners, arrived: () => this.usagePlacing().arrived })
    const all = providers()
    const { owners, agents } = this.usagePlacing()
    const { rows, ...rest } = this.history.state({ owners, agents, providers: all })
    // a workspace's key: as it is now, or for one that isn't here any more, as it was written down (rememberSpaces)
    const was = this.usageSpaces ?? {}
    const keys = new Map()
    const keyOf = (ws) => keys.get(ws) ?? keys.set(ws, this.hubs.has(ws) ? this.keyOf(ws) : was[ws]?.key ?? this.keyOf(ws)).get(ws)
    const labels = {}
    const out = rows.map((r) => {
      labels[r[3]] ??= all[r[3]]?.label ?? r[3]
      return r[1] && r[1] !== UNKNOWN ? [r[0], keyOf(r[1]), ...r.slice(2)] : r
    })
    const spaces = {}
    const faces = {}
    for (const h of this.hubs.values()) {
      const key = this.keyOf(h.ws)
      spaces[key] = { name: h.space.name, color: h.space.color, icon: h.space.icon }
      for (const a of h.space.agents) if (a.avatar) (faces[key] ??= {})[a.name] = a.avatar
    }
    // one that's gone from here: by the name and look it had (a linked computer's, hidden here, is still its computer's:
    // not "removed"); from before that was written down, by the name config.json kept for it
    const gone = this.config.data.workspacesGone && typeof this.config.data.workspacesGone === 'object' ? this.config.data.workspacesGone : {}
    for (const [ws, key] of keys) {
      if (spaces[key]) continue
      const k = was[ws]
      const theirs = k && !key.startsWith(`${this.me.slug}:`)
      spaces[key] = { name: k?.name ?? Object.keys(gone).find((name) => gone[name] === ws) ?? ws, ...(k?.color && { color: k.color }), ...(k?.icon && { icon: k.icon }), ...(!theirs && { gone: true }) }
    }
    // the accounts the rows name (core/accounts.js): { id: { name, provider } }; one that's been removed keeps its days, under its id
    const accounts = Object.fromEntries(accountsIn(this.config.data).map((a) => [a.id, { name: a.name, provider: a.provider }]))
    return { ...rest, rows: out, spaces, providers: labels, faces, accounts }
  }

  // The Usage view's data: this computer's usage and each linked computer's, as it last gave it.
  // -> { here, computers: [{ slug, name, here?, online, at, got?, reading, first, cols, rows, providers, faces, note? }], spaces }
  // here: the key of the workspace on screen. got: when a linked computer last answered (0: never); note: why it has
  // nothing to show. spaces: every workspace the rows name, { key: { name, color, icon, id?, ownerName?, gone? } } (id:
  // the workspace here with that key; ownerName: the computer it's hosted on, when that's another one).
  usageHistory() {
    const { spaces: mine, ...own } = this.usageSummary()
    const computers = [{ slug: this.me.slug, name: this.me.name, here: true, online: true, ...own }]
    const spaces = {}
    for (const [slug, u] of this.theirUsage()) {
      // (only the computers linked now, as Computers lists them: one that was renamed or unlinked isn't counted beside itself)
      const l = this.links.get(slug)
      if (!l) continue
      const d = u.data
      computers.push({
        slug, name: l?.name ?? u.name ?? slug, online: Boolean(l?.peer), got: u.got, at: d?.at ?? 0, reading: (l?.peer && d?.reading) || null, first: d?.first ?? null,
        cols: d?.cols ?? [], rows: d?.rows ?? [], providers: d?.providers ?? {}, faces: d?.faces ?? {}, accounts: d?.accounts ?? {}, ...(u.note && { note: u.note }), ...(u.asking && { asking: true }),
      })
      for (const [key, w] of Object.entries(d?.spaces ?? {})) spaces[key] ??= { name: String(w?.name ?? key), color: w?.color ?? null, icon: w?.icon ?? null, ...(w?.gone && { gone: true }), ownerName: l?.name ?? u.name ?? slug }
    }
    for (const [key, w] of Object.entries(mine)) {
      const id = this.localOf(key)
      spaces[key] = { ...w, ...(id && { id, ...(this.ownerOf(id).ownerName && { ownerName: this.ownerOf(id).ownerName }) }) }
    }
    return { here: this.current ? this.keyOf(this.current) : null, computers, spaces }
  }

  // Each linked computer's usage: what it last answered (kept in USAGE_DIR, so a computer that's off still shows what
  // it had), asked again once that's THEIR_USAGE_EVERY old, in the background: the Usage view asks again and finds it.
  // One on an older CLIque can't say: its note says so. -> Map slug -> { name, got, data, note, asking }
  theirUsage() {
    if (!this.usageOf) {
      this.usageOf = new Map()
      let files = []
      try {
        files = fs.readdirSync(USAGE_DIR).filter((f) => f.endsWith('.json'))
      } catch {}
      for (const f of files) {
        const kept = readJSON(path.join(USAGE_DIR, f))
        const got = Number(kept?.got) || 0
        // (what a computer said over a month ago, and it hasn't been linked since: it goes)
        if (!kept || typeof kept !== 'object' || !usable(kept.data) || Date.now() - got > THEIR_USAGE_KEPT) fs.rmSync(path.join(USAGE_DIR, f), { force: true })
        else this.usageOf.set(f.slice(0, -5), { name: String(kept.name ?? ''), got, data: tidy(kept.data), note: '', asking: null })
      }
    }
    for (const l of this.links.values()) {
      const u = this.usageOf.get(l.slug) ?? this.usageOf.set(l.slug, { name: l.name, got: 0, data: null, note: '', asking: null }).get(l.slug)
      if (l.name) u.name = l.name
      // a new connection to it (it was off, or the link dropped): asked afresh, and what the last one couldn't say is forgotten
      if (l.peer && u.peer !== l.peer) Object.assign(u, { peer: l.peer, asked: 0, note: '' })
      const every = u.data?.reading && !u.note ? THEIR_USAGE_READING : THEIR_USAGE_EVERY
      if (!l.peer || u.asking || Date.now() - (u.asked ?? 0) < every) continue
      u.asked = Date.now()
      const peer = l.peer
      u.asking = peer.call('usageHistory').then((data) => {
        if (!usable(data)) throw new Error(`${l.name} answered with something that isn't its usage`)
        data = tidy(data)
        Object.assign(u, { data, got: Date.now(), note: '' })
        try {
          fs.mkdirSync(USAGE_DIR, { recursive: true })
          fs.writeFileSync(path.join(USAGE_DIR, `${l.slug}.json`), JSON.stringify({ name: l.name, got: u.got, data }))
        } catch {} // not kept: it's asked again next time
      }, (e) => {
        // the link went while it was asked: it's simply off, and is asked again when it's back
        if (l.peer !== peer) return void (u.asked = 0)
        u.note = /isn't available over CLIque Link/.test(e?.message ?? '') ? `${l.name} runs an older CLIque: update it to see what it used` : `${l.name} couldn't say what it used: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`
      }).finally(() => {
        u.asking = null
      })
    }
    return this.usageOf
  }

  // ---- accounts (core/accounts.js): more than one sign-in for a provider --------------------------------------------
  // Each provider that signs you in has its own sign-in (the CLI's) and the accounts you add. An account's key is what
  // its usage limits go by too: 'claude' for the provider's own, 'claude@claude-work' for one of yours.

  accountSaid = new Map() // key -> { at, signedIn, email, plan, org, missing, asking, signing: { handle, link, since }, problem }

  // Every sign-in, for the Accounts sheet and each agent's picker:
  // [{ key, id, provider, cli, label, name, own?, agents, signedIn?, email?, plan?, org?, missing?, signing?: { link, since }, problem? }]
  // id '' and own: the provider's own sign-in. signedIn undefined: its CLI hasn't been asked yet (checkAccounts).
  accountsView() {
    const data = this.config.data
    const providers = providersFrom(data, this.config.discovered)
    const inUse = accountsInUse(data)
    const added = accountsIn(data)
    const said = (key) => {
      const s = this.accountSaid.get(key) ?? {}
      return {
        ...(s.signedIn !== undefined && { signedIn: s.signedIn }), ...(s.email && { email: s.email }), ...(s.plan && { plan: s.plan }), ...(s.org && { org: s.org }), ...(s.missing && { missing: true }),
        ...(s.signing && { signing: { link: s.signing.link, since: s.signing.since } }), ...(s.problem && { problem: s.problem }),
      }
    }
    const out = []
    for (const p of Object.values(providers)) {
      if (!signsIn(p) || !isOffered(p.id, data)) continue
      const cli = p.cli ?? 'claude'
      out.push({ key: p.id, id: '', provider: p.id, cli, label: p.label, name: '', own: true, agents: inUse[`:${p.id}`] ?? 0, ...said(p.id) })
      for (const a of added) if (a.provider === p.id) out.push({ key: `${p.id}@${a.id}`, id: a.id, provider: p.id, cli, label: p.label, name: a.name, agents: inUse[a.id] ?? 0, ...said(`${p.id}@${a.id}`) })
    }
    return out
  }

  // Asks each account's CLI who's signed in. force: now, however lately it was asked. only: one account's key.
  async checkAccounts({ force = false, only } = {}) {
    const providers = providersFrom(this.config.data, this.config.discovered)
    await Promise.all(this.accountsView().filter((a) => !only || a.key === only).map(async (a) => {
      const s = this.accountSaid.get(a.key) ?? this.accountSaid.set(a.key, {}).get(a.key)
      if (s.asking || (!force && Date.now() - (s.at ?? 0) < ACCOUNTS_EVERY)) return
      s.asking = true
      try {
        const who = await whoIs(a.id ? { id: a.id } : null, providers[a.provider])
        Object.assign(s, { at: Date.now(), signedIn: who.signedIn, email: who.email, plan: who.plan, org: who.org, missing: who.missing })
      } catch {} // its CLI couldn't be asked: what was known stays
      s.asking = false
    }))
    this.changed()
  }

  // The agents that still run on an account, or whose conversation is still in its folder (an agent at work changes
  // account when its turn is over): removing the account now would lose those conversations.
  accountBusy(id) {
    const names = new Set()
    for (const hub of this.hubs.values()) {
      for (const a of hub.agents.values()) if (!a.cloneOf && hub.accountOf(a)?.id === id) names.add(a.name)
      for (const [name, c] of Object.entries(hub.convos)) if (c?.account === id && hub.sessions[name]) names.add(name)
    }
    return [...names]
  }

  // account('check'): ask who's signed in everywhere. account('add', { provider, name }): a new account, its folder
  // made ready and its sign-in started in your browser -> its id. account('signIn', { provider, id }) (id '': the
  // provider's own), account('code', { key, text }): a code the sign-in page gave, account('cancel', { key }),
  // account('signOut', { id }), account('rename', { id, name }), account('move', { provider, from, to }): every agent on
  // one onto another ('' the provider's own) -> how many, account('remove', { id }).
  async accountAction(op, arg = {}) {
    if (this.config.broken) throw new Error(BROKEN)
    const data = this.config.data
    const providers = providersFrom(data, this.config.discovered)
    const find = (id) => {
      const a = accountsIn(data).find((x) => x.id === id)
      if (!a) throw new Error('no such account')
      return a
    }
    const keyOf = (provider, id) => (id ? `${provider}@${id}` : provider)
    const said = (key) => this.accountSaid.get(key) ?? this.accountSaid.set(key, {}).get(key)
    const able = (id) => {
      if (!signsIn(providers[id])) throw new Error(`${providers[id]?.label ?? id} doesn't sign you in (it runs on a key from your environment, or on this computer), so it has no accounts`)
      return providers[id]
    }
    const start = (provider, id) => {
      const p = able(provider)
      const account = id ? find(id) : null
      const key = keyOf(provider, id)
      const s = said(key)
      if (s.signing) return key
      const going = signIn(account, p, {
        onLink: (link) => {
          if (s.signing) s.signing.link = link
          this.changed()
        },
      })
      s.signing = { handle: going, link: null, since: Date.now() }
      delete s.problem
      this.changed()
      going.done.then(async (r) => {
        delete s.signing
        if (!r.ok && r.why !== 'stopped') s.problem = r.why
        await this.checkAccounts({ only: key, force: true })
      })
      return key
    }
    const ops = {
      check: () => this.checkAccounts({ force: true }),
      add: () => {
        const p = able(arg.provider)
        const id = addAccount(data, { provider: arg.provider, name: arg.name })
        this.config.save()
        prepareAccount(find(id), p)
        start(arg.provider, id)
        return id
      },
      signIn: () => start(arg.provider ?? find(arg.id).provider, arg.id ?? ''),
      code: () => void this.accountSaid.get(arg.key)?.signing?.handle.code(arg.text),
      cancel: () => void this.accountSaid.get(arg.key)?.signing?.handle.cancel(),
      signOut: async () => {
        const a = find(arg.id)
        await signOut(a, providers[a.provider])
        await this.checkAccounts({ only: keyOf(a.provider, a.id), force: true })
      },
      rename: () => {
        renameAccount(data, arg.id, arg.name)
        this.config.save()
      },
      move: () => {
        able(arg.provider)
        const n = moveAgents(data, arg.provider, arg.from ?? '', arg.to ?? '')
        if (n) this.config.save()
        return n
      },
      remove: async () => {
        const a = find(arg.id)
        const busy = this.accountBusy(a.id)
        if (busy.length) throw new Error(`${busy.length === 1 ? `@${busy[0]} still runs` : `${busy.length} agents still run`} on ${a.name}: move ${busy.length === 1 ? 'it' : 'them'} to another account first, and let ${busy.length === 1 ? 'it' : 'them'} finish what ${busy.length === 1 ? "it's" : "they're"} on`)
        const key = keyOf(a.provider, a.id)
        this.accountSaid.get(key)?.signing?.handle.cancel()
        // signed out by its CLI, so the sign-in goes from wherever it was kept; and what it used is read before its logs go
        if (providers[a.provider]) await signOut(a, providers[a.provider]).catch(() => {})
        try {
          this.usageSummary()
          await this.history.refresh()
        } catch {}
        dropAccount(data, a.id)
        this.config.save()
        removeFolder(a.id)
        this.accountSaid.delete(key)
      },
    }
    if (!Object.hasOwn(ops, op)) throw new Error(`unknown account action "${op}"`)
    const out = await ops[op]()
    this.changed()
    return out
  }

  // A linked computer's agent, as this computer writes it.
  linkedAgent(l, a, q = this.qualifier(l)) {
    // who it waits on and who waits on it: names and the questions' feed ids, as this computer writes them
    const waits = (list) => list?.map((w) => ({ ...w, name: q(w.name), id: w.id && q(w.id) }))
    return {
      ...a, name: q(a.name), seed: a.name, home: l.slug, homeName: l.name, status: l.peer ? a.status : 'away', ...(!l.peer && a.status === 'resting' && { rested: true }), ...(!l.peer && { canStop: undefined }), images: a.images?.map((p) => this.fetchImage(l, p)),
      ticket: a.ticket == null ? null : q(String(a.ticket)), ...(a.cloneOf && { cloneOf: q(a.cloneOf) }), ...(a.thread && { thread: q(a.thread) }), waitingOn: waits(a.waitingOn), owes: waits(a.owes),
    }
  }

  // Just the linked computers' agents in a workspace, for its hub (clique who, names, who's on): without building the
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
      if (l && !this.linkedState(l, here.ws)?.agents.some((a) => a.name === base)) throw new Error(`no agent named "${name}" (try: clique who)`)
      return l ? name : base
    }
    if (here.agents.has(name)) return name
    if (here.agents.has(here.baseOf(name))) return here.baseOf(name) // a clone that went away: its original
    const there = agents.filter((a) => a.home && a.seed === name)
    if (there.length === 1) return there[0].name
    if (there.length > 1) throw new Error(`which ${name}? ${there.map((a) => `@${a.name}`).join(' or ')}`)
    throw new Error(`no agent named "${name}" (try: clique who)`)
  }

  // Images are files on the computer an agent lives on: fetched into a cache for display here (core/linkfiles.js),
  // and sent over (or mapped back) when they travel to another computer. -> where it is (or will be) in the cache
  fetchImage(l, hostPath) {
    const file = this.files.place(l.slug, hostPath)
    l.toHost.set(file, hostPath)
    this.files.want(file) // (when it's here the clique changes, and what shows it is drawn again)
    return file
  }

  // A file an agent on a linked computer attached, as the chat here gets it: `path` is where it is in this computer's
  // cache, and `home` that computer's name. A picture or a page is fetched as soon as it's seen, like your images; a
  // recording or any other file when it's played or opened (it plays while it's still coming). From a computer whose
  // CLIque sends no pieces, those stay there (`away`: its name, for the card to say so).
  linkedFile(l, f) {
    if (travels(f)) return { ...f, path: this.fetchImage(l, f.path), home: l.name }
    if (this.files.old.has(l.slug)) return { ...f, path: '', away: l.name }
    const file = this.files.place(l.slug, f.path)
    l.toHost.set(file, f.path)
    return { ...f, path: file, home: l.name }
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
  // opts.scheduled: one of your scheduled messages going out ({ id, at, late? }, see runSchedules).
  // now: don't wait for a busy agent's turn to end (Hub.sendNow)
  async send(to, text, images = [], { fresh = false, re, channel, thread, scheduled, now = false } = {}, here = this.here) {
    // asleep (put to sleep while on screen, or watched from a phone): what you send wakes it, and the agent it's for
    // picks up its conversation; the message waits for it to start
    if (here.space?.parked) this.workspaceAction('open', here.ws)
    const quoted = re ? this.snapshot(here).feed.find((e) => e.id === re) : undefined
    const quote = quoted && { from: quoted.from, text: quoted.ticket !== undefined ? `#${String(quoted.ticket).split('@')[0]} ${quoted.title ?? ''}` : quoted.text }
    const idThere = (slug) => (id) => (slug ? (id?.endsWith(`@${slug}`) ? id.slice(0, -slug.length - 1) : undefined) : id && !id.includes('@') ? id : undefined)
    const unq = (slug) => (name) => (slug && String(name).endsWith(`@${slug}`) ? String(name).slice(0, -slug.length - 1) : name)
    let names = addressees(to, text).map((n) => this.resolve(n, here))
    // nobody named: it goes to Q (core/system-agent.js), who gets it to whoever should do it. With Q off, Auto picks.
    if (!names.length) {
      const there = here.systemAgentReady() ? null : this.snapshot(here).agents.find((a) => a.system && a.home && a.on && !a.nearLimit && !['stopped', 'off', 'away', 'waiting'].includes(a.status))
      const sys = here.systemAgentReady() ? here.systemAgent().name : there?.name
      if (sys) names = [sys]
    }
    if (thread && !names.length) throw new Error('nobody left in this thread to send it to: @name someone')
    const auto = !names.length && { auto: true } // nobody named: Auto picks, and the chat says Auto picked them
    if (!names.length) {
      // agents, not their clones; one here that can clone itself counts as free
      const members = here.channel(channel)?.members
      const ready = this.snapshot(here).agents.filter((a) => a.on && !a.cloneOf && !a.system && !['stopped', 'off', 'away'].includes(a.status) && (a.home || here.workable(here.agents.get(a.name))) && (!members || members.includes(a.name)))
      const best = here.pick(text, ready.map((a) => (a.home ? a : { ...a, ...here.lineup(here.agents.get(a.name)), ...here.warmth(here.agents.get(a.name)) })))
      if (!best) throw new Error(members ? `nobody in #${here.channel(channel).name} is on to take it: turn one on, or @name someone` : 'no agents to send to')
      names = [best.name]
    }
    // to another computer: the channel with its name and brief, which its hub gives its agents (its own channels differ)
    const c = channel !== undefined && channel !== 'general' ? here.channel(channel) : null
    const away = c ? { channel: c.id, channelName: c.name, ...(c.brief && { brief: c.brief }) } : {}
    const out = []
    for (const [home, bases] of this.group(names)) {
      // said in a thread's reply box: it stays in that thread, wherever that lives
      const inside = thread && idThere(home)(thread)
      const reply = { ...(quoted && { re: idThere(home)(re), quote: { ...quote, from: unq(home)(quote.from) } }), ...(inside && { thread: inside }) }
      if (!home) out.push(await here.send({ to: bases.join(','), text, images, mentions: false, fresh, ...auto, ...reply, ...(channel !== undefined && { channel }), ...(scheduled && { scheduled }), ...(now && { now: true }) }))
      else {
        const l = this.link(home)
        out.push(await this.linkCall(l, 'deliver', [{ to: bases.join(','), text, images: await this.toHome(images, l), fresh, ...auto, ...reply, ...away, ...(scheduled && { scheduled }), ...(now && { now: true }) }], here.ws))
      }
    }
    return out.join('')
  }

  // A local agent's `clique send` (or a bug sent to its fixer) to agents on other computers, in its workspace there.
  async relay(from, names, text, images, extra = {}, hub = this.here) {
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

  // Stop: end these agents' turns, each on its own computer (Hub.stopTurns). -> { stopped: [names as given], dropped }
  // A linked computer on an older CLIque has no Stop: its agent gets Esc in its terminal, as you'd press it there.
  async stopTurns(names, { channel } = {}, here = this.here) {
    const out = { stopped: [], dropped: 0 }
    for (const [home, bases] of this.group([].concat(names ?? []).map(String))) {
      if (!home) {
        const r = here.stopTurns(bases, { channel })
        out.stopped.push(...r.stopped)
        out.dropped += r.dropped
        continue
      }
      const l = this.link(home)
      try {
        const r = await this.linkCall(l, 'stop', [bases, { channel }], here.ws)
        out.stopped.push(...(r?.stopped ?? []).map((n) => `${n}@${home}`))
        out.dropped += r?.dropped ?? 0
      } catch (e) {
        if (!/isn't available over CLIque Link/.test(e.message)) throw e
        for (const base of bases) l.peer?.input(`${this.keyOf(here.ws)}/${base}`, '\x1b')
        out.stopped.push(...bases.map((n) => `${n}@${home}`))
      }
    }
    return out
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
  // One on an older CLIque, without bulk actions, gets them one at a time; one that can't be reached is left out.
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
        if (!/isn't available over CLIque Link/.test(e.message)) throw e
        out.push(await this.oneByOne(l, op, ids, there, here.ws))
      }
    }
    return out.join('')
  }

  // A bulk action as single-task calls, for a computer on an older CLIque.
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

  // h: the hub it's for ('in' says which, and this computer's app and moves pass the one on screen). What's for no
  // workspace needs none; a call without one otherwise is a computer on an older CLIque, asking for its default workspace.
  // Who a linked computer says something is from, as this computer takes it: you (its user is you), or an agent of its
  // own, named as its agents are here (iris@studio). Whatever name it gives, never one of this computer's agents.
  senderFrom(peer, from) {
    const said = String(from ?? 'you')
    if (said === 'you') return 'you'
    const base = said.split('@')[0]
    if (!/^[\w.-]{1,64}$/.test(base)) throw new Error(`not sent: "${said.slice(0, 80)}" isn't a name ${peer.name} can send as`)
    return `${base}@${slug(peer.name)}`
  }

  // peer: the linked computer that's asking (none: this computer itself, for one of its own workspaces).
  serve(fn, args, h, peer) {
    if (!h && !COMPUTER_CALLS.has(fn)) throw new Error(`${this.me.name} runs a newer CLIque, where every workspace is its own: update this computer's to work with its agents`)
    const allowed = {
      // the same call, for one of this computer's workspaces (not on an older CLIque); and which ones it has
      in: (key, call, rest) => {
        const there = this.hubs.get(this.localOf(String(key)))
        if (!there) throw new Error(`${this.me.name} has no workspace "${key}"`)
        if (call === 'in') throw new Error('one workspace at a time')
        return this.serve(call, rest ?? [], there, peer)
      },
      // an older CLIque matched workspaces by id: it gets none (see keyOf)
      spaces: () => [],
      // not while config.json can't be read: what's in memory then isn't its workspaces, and an empty list would make
      // linked computers drop theirs (it says so as an older CLIque would, and they keep what they have)
      workspaces: () => {
        if (this.config.broken) throw new Error(`${this.me.name} can't read its settings right now`)
        return this.spaceList()
      },
      state: () => h?.snapshot() ?? this.computerState(),
      // what this computer's CLIs used, day by day, for a linked computer's Usage view (usageSummary)
      usageHistory: () => this.usageSummary(),
      deliver: (opts) => h.send({ ...opts, ...(peer && { from: this.senderFrom(peer, opts?.from) }), mentions: false }),
      saveImage: (name, type, bytes) => saveImage(name, type, bytes),
      // one of this computer's attachments, a piece at a time: a recording, a picture, a page, any file (core/linkfiles.js)
      readFile: (file, start, length) => readPiece(ATTACHMENTS, movedPath(String(file ?? '')), start, length),
      // ...and whole, as a CLIque from before pieces asks: a picture or a page, never a recording or anything big
      readImage: (file) => {
        file = inside(movedPath(String(file ?? '')), [ATTACHMENTS])
        if (!file) throw new Error('not an attachment')
        if (kindOf(file) === 'video' || fs.statSync(file).size > FETCH_MAX) throw new Error('too big to send: open it on the computer it is on')
        return new Uint8Array(fs.readFileSync(file))
      },
      approve: (id) => h.approve(id),
      drop: (id) => h.drop(id),
      // Send now, pressed on a computer this one's agents show on
      sendNow: (id, opts) => h.sendNow(String(id), { stop: Boolean(opts?.stop) }),
      // your reaction, on a message this computer has (you're the same person on both)
      reactTo: (id, emoji) => h.reactTo(id, emoji),
      answer: (id, reply) => h.answer(id, reply),
      update: (names, patch) => h.update(names, patch),
      draftPrompt: (agent) => h.draftPrompt(agent),
      addAgent: (fields) => h.addAgent(fields),
      // a channel of one of this computer's workspaces, changed from a computer it shows on (theirChannel)
      channel: (op, id, arg) => {
        if (this.ownerOf(h.ws).owner) throw new Error(`${h.space.name} isn't ${this.me.name}'s workspace`)
        const a = arg && typeof arg === 'object' ? arg : {}
        const clean = {
          ...(typeof a.name === 'string' && { name: a.name }),
          ...(typeof a.brief === 'string' && { brief: a.brief }),
          ...('members' in a && { members: Array.isArray(a.members) ? a.members.map(String) : null }),
        }
        return this.channelAction(String(op), op === 'create' ? null : String(id ?? ''), clean, h.ws).id
      },
      removeAgent: (name, opts) => h.removeAgent(name, { everywhere: Boolean(opts?.everywhere) }),
      restart: (name) => h.restart(name),
      markIdle: (name) => h.markIdle(name),
      // Stop pressed on a computer this one's agents show on
      stop: (names, opts) => h.stopTurns([].concat(names ?? []).map(String), { channel: typeof opts?.channel === 'string' ? opts.channel : undefined }),
      dismiss: (name) => h.dismiss(name),
      resize: (name, cols, rows) => h.runner.resize(name, cols, rows),
      // Flush first: chunks already batched are in the buffer, so a viewer replaying it won't see them twice.
      buffer: (name) => {
        this.flushPty()
        return h.runner.buffer(name)
      },
      exportAgents: (names, opts) => packAgents(h, names, opts),
      freshStart: (name) => h.freshStart(name),
      task: (from, args) => h.taskCommand(peer ? this.senderFrom(peer, from) : from, args),
      bug: (from, args) => h.taskCommand(peer ? this.senderFrom(peer, from) : from, args), // a computer on the previous version
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
    if (!Object.hasOwn(allowed, fn)) throw new Error(`"${fn}" isn't available over CLIque Link`)
    return allowed[fn](...args)
  }

  // ---- export, import, move ----------------------------------------------------------------------

  async exportAgents(names, opts = {}) {
    const here = this.here
    const packs = []
    for (const [home, bases] of this.group(names)) packs.push(home ? await this.linkCall(this.link(home), 'exportAgents', [bases, opts], here.ws) : packAgents(here, bases, opts))
    return { clique: 1, exported: new Date().toISOString(), agents: packs.flatMap((p) => p.agents), providers: Object.assign({}, ...packs.map((p) => p.providers)) }
  }

  // Every name in use on a computer (home '' = this one), to suggest free ones.
  namesOn(home) {
    const l = home && this.links.get(home)
    const ws = this.here.ws
    if (l) return new Set([...(l.state?.roster ?? []), ...(l.spaces?.[ws]?.agents ?? []).map((a) => a.name)])
    return new Set([...this.here.agents.keys(), ...this.sharedNames()])
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
  // the two needn't be linked to each other. -> { name, conversation: 'moved' | 'fresh', reason? }
  // It moves to the same workspace on the other computer: one of the workspace's own agents is its own there too, one of
  // your shared agents joins that computer's clique and leaves only this workspace here.
  async moveAgent(name, home, folder) {
    home ??= ''
    const here = this.here
    if (this.snapshot(here).agents.find((a) => a.name === name)?.system) throw new Error(`${String(name).split('@')[0]} comes with every workspace, so it stays where it is`)
    const ws = here.ws
    const src = this.where(name)
    const from = src.l?.slug ?? ''
    if (from === home) throw new Error('it already lives there')
    const agent = this.snapshot().agents.find((a) => a.name === name)
    if (!agent) throw new Error(`no agent named "${name}"`)
    if (home && !this.links.get(home)?.spaces?.[ws]) throw new Error(`${this.links.get(home)?.name ?? home} has no ${here.space.name} workspace: make one with that name there first`)
    folder = String(folder ?? '').trim() || agent.cwd || '~'
    const on = (h, fn, ...args) => (h ? this.linkCall(this.link(h), fn, args, ws) : this.serve(fn, args, here))
    const label = (h) => (h ? this.links.get(h)?.name ?? h : this.me.name)
    // one of your shared agents that the other computer's clique has already (it was there before) rejoins it there,
    // rather than arriving as a copy under another name
    const shared = Boolean(agent.shared)
    const l = home && this.links.get(home)
    const cliqueThere = new Set(l ? l.state?.roster ?? [] : this.sharedNames())
    const inThere = new Set(l ? (l.spaces?.[ws]?.agents ?? []).map((a) => a.name) : here.agents.keys())
    const join = shared && cliqueThere.has(src.base) && !inThere.has(src.base)
    const move = { from: from || this.me.slug, to: home || this.me.slug, old: src.base, name: join ? src.base : this.freeName(src.base, home) }
    // a running agent needs its folder there
    const there = await on(home, 'folderInfo', folder)
    if (agent.on && !there.exists) throw new Error(`there's no folder ${there.path} on ${label(home)}`)
    const out = await on(from, 'moveOut', src.base)
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
      here.post({ kind: 'event', from: 'clique', text: `${src.base} moved to ${label(home)}, but ${label(from)} still has it (${e.message}): remove it there` })
    }
    this.tellMoved({ ...move, name: res.name }, [from, home], ws)
    return { name: home ? `${res.name}@${home}` : res.name, conversation: res.conversation, ...(res.reason && { reason: res.reason }) }
  }

  // Every computer within reach (this one too) but `skip` writes the agent by its new name from now on, in the
  // workspace it moved in.
  tellMoved(move, skip, ws) {
    if (!skip.includes('') && this.hubs.has(ws)) agentMoved(this.hubs.get(ws), move)
    for (const l of this.links.values()) if (l.peer && !skip.includes(l.slug) && l.spaces?.[ws]) this.linkCall(l, 'agentMoved', [move], ws).catch(() => {})
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
    let me = { name: this.me.name, slug: this.me.slug, sharing: Boolean(this.sharing), share: Boolean(this.settings.share), error: this.linkError, agents: this.agentCount() }
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
        agents: this.agentsOn(l).map((a) => ({ name: q(a.name), seed: a.name, area: a.area, avatar: a.avatar, status: a.status, on: a.on, hidden: hidden.has(q(a.name)), ...(a.system && { system: true }) })),
        usage: this.linkedUsage(l),
      }
    })
    // blocked: macOS keeps this app off the local network (Local Network is off for it), as discovery or a link found
    if (this.discovery?.blocked || links.some((l) => !l.online && l.status?.blocked)) me.localNetwork = 'blocked'
    return { me, links, phones: { ...this.phones.view(), ...(phones && this.hosts.warning && { warning: this.hosts.warning }) }, ...this.nearbyView() }
  }

  // A linked computer's agents in the workspaces you share with it, each once (one working in two is on in either).
  agentsOn(l) {
    const seen = new Map()
    for (const s of Object.values(l.spaces ?? {})) {
      for (const a of s?.agents ?? []) if (!a.cloneOf && !(seen.get(a.name)?.on)) seen.set(a.name, a)
    }
    return [...seen.values()]
  }

  // How many agents this computer has: yours, and each workspace's own.
  agentCount() {
    const own = workspacesIn(this.config.data).reduce((n, w) => n + (Array.isArray(w.agents) ? w.agents.filter((a) => a?.name).length : 0), 0)
    return this.sharedNames().length + own
  }

  // A linked computer's usage limits: its own accounts, the ones its agents run on, as a snapshot's `usage` says them
  // ({ claude: { label, at, windows, credits? } }). Each account's newest reading from any of its workspaces' states
  // we have, without the windows that have reset since (an offline computer's last word stays until then).
  linkedUsage(l) {
    const now = Date.now()
    const out = {}
    for (const s of [l.state, ...Object.values(l.spaces ?? {})]) {
      for (const [id, u] of Object.entries(s?.usage ?? {})) {
        const windows = (u?.windows ?? []).filter((w) => w.resetsAt > now)
        if (windows.length && !((out[id]?.at ?? -1) >= (u.at ?? 0))) out[id] = { ...u, windows }
      }
    }
    return out
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
    if (!on && this.sharing) {
      this.stopSharing() // the computers that linked with its code are let go
      if (this.discovery) await this.startSharing().catch(() => {}) // still there for computers nearby to ask
    }
    this.changed()
  }

  async startSharing() {
    if (!this.settings.key) {
      this.settings.key = crypto.randomBytes(24).toString('base64url')
      this.saveSettings()
    }
    const id = identity(LINK_DIR)
    const host = new LinkHost({ key: this.settings.key, cert: id.cert, keyPem: id.key, name: this.me.name, handle: (fn, args, peer) => this.serve(fn, args, undefined, peer) })
    host.fingerprint = id.fingerprint
    host.pairable = () => Boolean(this.discovery) // only while Computers is open here
    host.authable = () => Boolean(this.settings.share) // linked computers' key: not while it runs only for Nearby
    host.on('peer', (peer) => this.attach(peer))
    host.on('pair', (req) => this.asked(req))
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
    const client = new LinkClient(code, { name: this.me.name, handle: (fn, args, peer) => this.serve(fn, args, undefined, peer) })
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

  // ---- nearby: linking a computer found on this network (core/discover.js), with a code checked on both screens ----
  // While Computers is open (the dashboard says so, and again every minute: a page that went away stops it after
  // DISCOVER_FOR), this computer says who it is on the local network and lists the others doing the same. It shares
  // meanwhile, so the one you click can be asked; it stops again when the sheet closes, unless sharing was on anyway.

  knownSpaces = new Map() // linked computers' own workspaces, by computer: { name, list } as it last said (see theirSpaces)
  pairing = { out: null, in: null } // out: { id, name, stage, sas, error, slug }; in: { id, name, sas, stage, slug }

  async discover(on) {
    clearTimeout(this.discoverTimer)
    await this.discoverStarting // one that's starting finishes first, so there's never two
    if (!on) {
      if (!this.discovery) return
      this.discovery.stop()
      this.discovery = null
      this.pairCancel()
      if (this.pairing.in?.stage === 'ask') this.pairing.in.request.decline()
      this.pairing.in = null
      if (!this.settings.share && this.sharing) this.stopSharing()
      return this.changed()
    }
    this.discoverTimer = setTimeout(() => this.discover(false), DISCOVER_FOR)
    this.discoverTimer.unref?.()
    if (this.discovery) return
    this.discoverStarting = this.startDiscovery()
    await this.discoverStarting
    this.discoverStarting = null
  }

  async startDiscovery() {
    if (!this.sharing) await this.startSharing().catch(() => {}) // a port in use: the sheet says so, and nothing can ask
    const fingerprint = this.sharing?.fingerprint ?? identity(LINK_DIR).fingerprint
    const d = new Discovery({
      port: this.settings.discoverPort ?? DISCOVER_PORT,
      // for tests, and networks where broadcasts need a nudge: "host:port" to send beacons to instead
      ...(this.settings.discoverTo && { targets: () => this.settings.discoverTo.map((t) => ({ address: t.split(':')[0], port: Number(t.split(':')[1]) })) }),
      beacon: () => ({ name: this.me.name, agents: this.agentCount(), port: this.settings.port ?? DEFAULT_PORT, fingerprint }),
    })
    d.on('change', () => this.changed())
    d.on('blocked', () => this.changed())
    this.discovery = d
    await d.start()
    this.changed()
  }

  // The computers nearby that aren't linked already, and any pairing under way, for the Computers sheet.
  nearbyView() {
    if (!this.discovery) return { nearby: null, pairing: this.pairingView() }
    const linkedPrints = new Set([...this.links.values()].map((l) => { try { return l.code && readCode(l.code).fingerprint } catch { return null } }).filter(Boolean))
    const found = this.discovery.list().filter((f) => !linkedPrints.has(f.fingerprint) && !this.links.get(slug(f.name))?.peer)
    // two of the same name (one of them may be pretending): each says where it is, so they can be told apart
    const twins = new Set(found.filter((f, i) => found.findIndex((g) => g.name === f.name) !== i).map((f) => f.name))
    const nearby = found
      .map(({ id, name, platform, agents, address }) => ({ id, name, platform, agents, ...(twins.has(name) && { address }) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { nearby, pairing: this.pairingView() }
  }

  pairingView() {
    const out = this.pairing.out && (({ client, code, ...rest }) => rest)(this.pairing.out) // the code has the key in it
    const inn = this.pairing.in && (({ request, ...rest }) => rest)(this.pairing.in)
    return out || inn ? { out, in: inn } : null
  }

  // Ask the computer found nearby with this id to link. The sheet follows it in pairing.out: 'asking', then 'confirm'
  // with the code to check on both screens, then 'linking' and 'linked' (with its slug), or 'failed' with why. It links
  // only once the code is checked on both: there (it sends its link code) and here (pairConfirm). Checking it here is
  // what keeps a computer pretending to be the one you clicked from getting linked: the real one shows no code.
  pairWith(id) {
    const found = this.discovery?.get(id)
    if (!found) throw new Error("that computer isn't nearby any more: is Computers still open on it?")
    if (this.pairing.in && !['linked', 'failed'].includes(this.pairing.in.stage)) throw new Error(`${this.pairing.in.name} is linking with ${this.me.name} right now`)
    this.pairCancel()
    const myFingerprint = this.sharing?.fingerprint ?? identity(LINK_DIR).fingerprint
    const client = new PairClient({ host: found.address, port: found.port, fingerprint: found.fingerprint, name: this.me.name, myFingerprint })
    const out = { id, name: found.name, stage: 'asking', client }
    this.pairing.out = out
    client.on('sas', (sas) => this.outNow(out, { stage: 'confirm', sas }))
    client.on('end', (why) => this.outNow(out, { stage: 'failed', error: why }))
    client.on('code', (code) => {
      out.code = code
      if (out.agreed) this.linkWith(out)
      else this.outNow(out, { theyAgreed: true })
    })
    client.start()
    this.changed()
  }

  outNow(out, change) {
    if (this.pairing.out !== out) return
    Object.assign(out, change)
    this.changed()
  }

  // The code matches here too: link, if the other computer said yes already, or wait for it ('waiting').
  pairConfirm() {
    const out = this.pairing.out
    if (!out || out.stage !== 'confirm') return
    out.agreed = true
    if (out.code) this.linkWith(out)
    else this.outNow(out, { stage: 'waiting' })
  }

  linkWith(out) {
    this.outNow(out, { stage: 'linking' })
    this.connect(out.code).then(
      (key) => (out.client.close(), this.outNow(out, { stage: 'linked', slug: key })),
      (e) => (out.client.close(), this.outNow(out, { stage: 'failed', error: e.message })),
    )
  }

  pairCancel() {
    const out = this.pairing.out
    if (!out) return
    this.pairing.out = null
    out.client.cancel()
    this.changed()
  }

  // A computer nearby asking to link this one: the sheet asks you, with the code. Another one asking while a linking is
  // under way (either way) is told this one's busy. One that goes after you said yes, without linking (it said no on
  // its side), ends as 'failed': 'cancelled'.
  asked(request) {
    const busy = (p) => p && !['linked', 'failed'].includes(p.stage)
    if (busy(this.pairing.in) || busy(this.pairing.out)) return request.busy()
    const inn = { id: request.id, name: request.name, sas: request.sas, stage: 'ask', request }
    this.pairing.in = inn
    request.on('gone', () => {
      if (this.pairing.in !== inn) return
      if (inn.stage === 'ask') this.pairing.in = null // it gave up, or the minute ran out
      // it closes this once it has linked, and a link that came first made this 'linked'; a moment's grace for one
      // whose connection is still coming in
      else if (inn.stage === 'accepted') return void setTimeout(() => this.pairing.in === inn && inn.stage === 'accepted' && (Object.assign(inn, { stage: 'failed', error: 'cancelled' }), this.changed()), 3000)
      this.changed()
    })
    this.changed()
  }

  // Yes: it gets this computer's link code and connects with it, and this computer keeps sharing so it can come back.
  pairAnswer(id, yes) {
    const inn = this.pairing.in
    if (!inn || inn.id !== id) throw new Error('that computer stopped asking')
    if (inn.stage !== 'ask') return (this.pairing.in = null), this.changed() // done with the result
    if (!yes) {
      inn.request.decline()
      this.pairing.in = null
      return this.changed()
    }
    if (!this.sharing) throw new Error(this.linkError ?? `${this.me.name} isn't sharing`)
    this.settings.share = true
    this.saveSettings()
    const port = this.settings.port ?? DEFAULT_PORT
    inn.request.accept(makeCode({ name: this.me.name, port, key: this.settings.key, fingerprint: this.sharing.fingerprint, hosts: this.hosts.list.map((h) => h.address) }))
    inn.stage = 'accepted'
    this.changed()
  }

  // This computer's link code, to paste on another one ("Link with a code"); copying it is what turns sharing on.
  async linkCode() {
    if (!this.settings.share || !this.sharing) await this.share(true)
    return makeCode({ name: this.me.name, port: this.settings.port ?? DEFAULT_PORT, key: this.settings.key, fingerprint: this.sharing.fingerprint, hosts: this.hosts.list.map((h) => h.address) })
  }

  pairDone() {
    if (this.pairing.out && ['linked', 'failed'].includes(this.pairing.out.stage)) this.pairing.out = null
    if (this.pairing.in && ['linked', 'failed'].includes(this.pairing.in.stage)) this.pairing.in = null
    this.changed()
  }

  newLink(key) {
    const l = { slug: key, peer: null, toHost: new Map() }
    this.links.set(key, l)
    return l
  }

  attach(peer, client) {
    const key = slug(peer.name)
    const l = this.links.get(key) ?? this.newLink(key)
    const asked = this.pairing.in
    if (asked?.stage === 'accepted' && slug(asked.name) === key) this.pairing.in = { ...asked, stage: 'linked', slug: key }
    Object.assign(l, { name: peer.name, peer, client: client ?? l.client, aware: false }) // until it says otherwise
    const q = this.qualifier(l)
    peer.on('state', (s) => {
      l.state = s
      this.changed()
    })
    // its other workspaces, by key: shown here in the workspace with that key, if this computer has one
    peer.on('ws', (key, s) => {
      const id = this.localOf(String(key))
      // from either connection to it (two computers that each have the other's code keep two, and push on their own)
      if (this.links.get(l.slug) !== l || !l.peer || !l.aware || !id) return
      l.spaces ??= {}
      if (s) l.spaces[id] = s
      else delete l.spaces[id]
      this.changed()
    })
    // (only a computer that knows workspaces sends one, even if it couldn't say when it was asked: see attach)
    peer.on('wslist', (list) => {
      if (!l.peer) return
      l.aware = true
      this.theirSpaces(l, l.peer, list)
    })
    // terminals and alerts say which workspace (key/name): a terminal shows when its workspace is on screen, an alert
    // when this computer has that workspace
    peer.on('pty', (n, d) => {
      const [ws, base] = this.fromWire(n)
      if (!ws) return
      if (ws === this.current) this.emit('pty', q(base), d)
      this.emit('terminal', ws, q(base), d)
    })
    peer.on('alert', (n, t) => {
      const [ws, base] = this.fromWire(n)
      if (ws) this.emit('alert', q(base), t, ws)
    })
    peer.on('input', (n, d) => {
      const [ws, base] = this.fromWire(n)
      if (ws) this.hubs.get(ws)?.input(base, d)
    })
    peer.on('close', () => {
      if (l.peer !== peer) return
      l.peer = null
      if (!l.client) this.links.delete(key) // a computer that linked to us: it'll come back on its own
      this.changed()
    })
    peer.push('state', this.computerState())
    peer.call('state').then((s) => {
      l.state = s
      this.changed()
    }, () => {})
    // Can it send its files a piece at a time (core/linkfiles.js)? A CLIque from before that says it has no such call.
    this.files.back(key)
    peer.call('readFile', ['']).catch((e) => {
      if (l.peer !== peer) return
      const old = NO_PIECES.test(e.message)
      if (old === this.files.old.has(key)) return
      old ? this.files.old.add(key) : this.files.old.delete(key)
      this.changed()
    })
    // Does it know workspaces by owner (keyOf)? Then it gets ours (and asks the same of us, so we get its). An older
    // CLIque doesn't answer 'workspaces', and shares nothing with this one.
    peer.call('workspaces').then((list) => {
      if (l.peer !== peer) return
      l.aware = true
      this.theirSpaces(l, peer, list)
    }, () => {
      if (l.peer !== peer) return // a connection that lost to another one
      l.aware = false
      l.spaces = {} // a computer back on an older CLIque: what it had of workspaces is gone
      this.changed()
    })
    this.changed()
    return l
  }

  forget(home) {
    const l = this.links.get(home)
    l?.client?.close()
    l?.peer?.close()
    this.links.delete(home)
    if (l) this.settings.peers = (this.settings.peers ?? []).filter((c) => c !== l.code)
    this.settings.hidden = (this.settings.hidden ?? []).filter((n) => !n.endsWith(`@${home}`))
    this.saveSettings()
    // its workspaces go with it, as when it removes one: the ones you've made yours stay (and say it's offline). Also
    // for a computer known only by its workspaces here (renamed since, or gone before this CLIque started).
    this.knownSpaces.delete(home)
    this.usageOf?.delete(home) // and what it said it used
    fs.rmSync(path.join(USAGE_DIR, `${home}.json`), { force: true })
    const data = this.config.data
    const gone = this.config.broken ? [] : workspacesIn(data).filter((w) => w.of?.computer === home && this.untouched(w))
    for (const w of gone) dropWorkspace(data, w.id)
    if (gone.length) this.config.save()
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

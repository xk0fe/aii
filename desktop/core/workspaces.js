// Workspaces: the projects the crew works on, several at once if you like. Every one works the same way: a name and a
// look, a folder, who works there, its own chat, notes and tasks. You make them, you can remove any of them, and there
// can be none (the app then asks you to make one). Your agents are yours: a shared agent can work in any workspace, and a
// workspace can also have agents of its own that exist only there. Everything about a project is kept per workspace: its
// chat, notes and tasks, each agent's conversation there, what's running there. What's about you is kept once: who your
// agents are, providers, look and feel, linked computers, attachments.
//
// A workspace keeps its files in CREW_HOME/workspaces/<id>/. In config.json, next to "agents" (the shared ones):
//   "workspaces": [{
//     "id": "storefront", "name": "Storefront", "folder": "~/Projects/storefront",  where its agents work
//     "members": { "ada": {}, "milo": { "folder": "~/Projects/storefront-web" } },  shared agents in it, one with a folder of its own
//     "agents": [{ "name": "june", "area": "docs" }],                                its own agents, set up like shared ones
//     "autopilot": false, "triage": "ada", "autofix": true
//     "color": "teal", "icon": "🛒", "parked": true                                  its look, and whether its agents are stopped
//   }]
// "current" is the workspace on screen (none, or one that's gone: the first).
// Channels: each workspace's chat is #general plus the channels you make, in its "channels":
//   "channels": [{ "id": "review", "name": "review", "brief": "Review only…", "members": ["ada", "milo"] }]
// A channel's brief is what its agents are told to do there (core/hub.js framed). Without "members" everyone in the
// workspace is in it. #general is always there: an entry with id "general" only gives it a brief.
// Where an agent works in a workspace: its own folder there (a member's "folder", an own agent's "cwd"), else the
// workspace's, else (a shared agent) the folder it has of its own, else home. Whether it's on ("off") is per workspace
// too. Who it is (its job, instructions, model, look) is the same wherever it works.
//
// One id is only about where things are: ROOT, the workspace an install from before this layout had (see settle). Its
// files stay in CREW_HOME itself and its terminals go by the agent's name alone, because agents outlive Crew in the
// terminal host and moving them under a running one isn't worth the risk. Nothing else treats it differently.
// No Electron in here.
import { ottoIn, ottoOn } from './otto.js'
import path from 'node:path'

export const ROOT = 'default'
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
// a color by name (one of the creatures', ui/avatar.js) or as #hex: nothing that could break out of a style
const COLOR = /^(?:[a-z]{2,20}|#[0-9a-f]{3,8})$/i

// config.json's layout: 2 has every workspace in "workspaces". See settle.
const LAYOUT = 2
// What the one workspace used to keep at the top of config.json.
const TOP_LEVEL = ['color', 'icon', 'parked', 'channels', 'channelsGone', 'triage', 'autofix']
// The colors a workspace can have (ui/workspaces.js offers the same).
const COLORS = ['blue', 'sky', 'teal', 'mint', 'lime', 'yellow', 'orange', 'peach', 'red', 'pink', 'lilac', 'purple']

// Where a workspace keeps its files.
export const dirOf = (home, id) => (id === ROOT ? home : path.join(home, 'workspaces', id))

// The workspaces in config.json, each once and with an id that can name a folder.
export function workspacesIn(config) {
  const seen = new Set()
  const list = Array.isArray(config.workspaces) ? config.workspaces : []
  return list.filter((w) => w && typeof w === 'object' && ID.test(w.id) && !seen.has(w.id) && seen.add(w.id))
}

export const named = (list) => (Array.isArray(list) ? list.filter((a) => a && typeof a.name === 'string' && a.name) : [])
const memberMap = (w) => (w.members && typeof w.members === 'object' && !Array.isArray(w.members) ? w.members : {})

// config.json as an older Crew left it, in the layout of today. It had one workspace with no entry of its own: its look
// and settings at the top of the file, every shared agent in it, each shared agent's "cwd" and "off" being that
// workspace's. It becomes an entry like any other, first in the list, with its agents as members working where they
// did. No files move: it keeps ROOT as its id. hadFiles: is there a chat in CREW_HOME itself? (An install with no agents
// left can still have one.) A file with no such history gets no entry: you make your first workspace.
// -> whether it made one. In a workspace with no folder, a shared agent's "cwd" was where it worked there too: that goes
// in its member entry, so its folder in each workspace is that workspace's to change.
export function settle(config, { hadFiles = false } = {}) {
  if (Number(config.layout) >= LAYOUT) return false
  config.layout = LAYOUT
  const agents = named(config.agents)
  const had = agents.length > 0 || hadFiles || typeof config.name === 'string' || TOP_LEVEL.some((k) => config[k] !== undefined)
  if (!had) return false
  const others = workspacesIn(config)
  const own = {
    id: ROOT,
    name: (typeof config.name === 'string' && config.name.trim()) || 'Home',
    // a color like any other's, so it doesn't look like the odd one out
    color: COLORS.find((c) => !others.some((w) => w.color === c)) ?? COLORS[0],
    members: Object.fromEntries(agents.map((a) => [a.name, { ...(a.cwd && { folder: a.cwd }), ...(a.off && { off: true }) }])),
  }
  for (const k of TOP_LEVEL) {
    if (config[k] !== undefined) own[k] = config[k]
    delete config[k]
  }
  delete config.name
  for (const a of agents) {
    for (const w of others) {
      const m = memberMap(w)
      if (!a.cwd || w.folder || !Object.hasOwn(m, a.name) || m[a.name]?.folder) continue
      m[a.name] = { ...(m[a.name] && typeof m[a.name] === 'object' ? m[a.name] : {}), folder: a.cwd }
    }
    delete a.cwd
    delete a.off
  }
  config.workspaces = [own, ...(Array.isArray(config.workspaces) ? config.workspaces : [])]
  return true
}

// One workspace, as config.json has it: its agents as they work there, and its settings, which read and write the file
// in place (space.autopilot = false lands where it belongs). null when there's no such workspace.
export function space(config, id) {
  const own = workspacesIn(config).find((w) => w.id === id)
  if (!own) return null
  const members = memberMap(own)
  const joined = named(config.agents).filter((a) => Object.hasOwn(members, a.name))
  const taken = new Set(joined.map((a) => a.name))
  // its own agents, unless one has a name a member has (or another of its own has) already
  const owned = named(own.agents).filter((a) => !taken.has(a.name) && taken.add(a.name))
  // Otto (core/otto.js), in every workspace of this computer's. `of`: one shown from a linked computer has that one's.
  const otto = own.of || !ottoOn() ? null : ottoIn(own.system, taken)
  if (otto) taken.add(otto.name)
  const isMember = (name) => joined.some((a) => a.name === name)
  const entry = (name) => (members[name] && typeof members[name] === 'object' ? members[name] : {})

  const agents = [
    ...(otto ? [otto] : []),
    ...joined.map(({ off, ...who }) => {
      const m = entry(who.name)
      return { ...who, cwd: m.folder || own.folder || who.cwd, ...(m.off && { off: true }), shared: true }
    }),
    ...owned.map((a) => ({ ...a, cwd: a.cwd || own.folder, shared: false })),
  ]

  // (what's chosen for Otto is kept on the workspace: there's no more to him in the file)
  const def = (name) => (name === otto?.name ? (own.system = own.system && typeof own.system === 'object' ? own.system : {}) : [...joined, ...owned].find((a) => a.name === name))
  return {
    id,
    name: own.name || own.id,
    folder: own.folder || null,
    color: typeof own.color === 'string' && COLOR.test(own.color) ? own.color : null,
    icon: typeof own.icon === 'string' ? own.icon : null,
    agents,
    has: (name) => taken.has(name),
    // the agent's definition in config.json, wherever it's kept (shared, or this workspace's own)
    def,
    shared: (name) => joined.some((a) => a.name === name),
    // One field of an agent, as it is in this workspace: where it works (cwd) and whether it's on (off) go in a
    // shared agent's member entry here, anything else in its definition.
    set(name, key, value) {
      const here = isMember(name) && (key === 'cwd' || key === 'off')
      if (here && !(members[name] && typeof members[name] === 'object')) members[name] = {}
      const target = here ? members[name] : def(name)
      const k = here && key === 'cwd' ? 'folder' : key
      if (!target) return
      if (value === undefined) delete target[k]
      else target[k] = value
    },
    // A new agent: a shared one joins the roster and this workspace, with `member` as its entry here; any other is this
    // workspace's own.
    add(fields, { shared: isShared = false, member = {} } = {}) {
      if (isShared) {
        config.agents = [...(Array.isArray(config.agents) ? config.agents : []), fields]
        own.members = { ...members, [fields.name]: member }
      } else own.agents = [...(Array.isArray(own.agents) ? own.agents : []), fields]
    },
    // (as the file is now: several in a row each see the last)
    join(name, fields = {}) {
      own.members = { ...memberMap(own), [name]: fields }
    },
    leave(name) {
      delete memberMap(own)[name]
      renameInChannels(own, name, null)
      if (own.triage === name) delete own.triage
    },
    // one of its own agents goes; a shared one only leaves (see forget for taking it off the roster)
    remove(name) {
      if (name === otto?.name) return
      if (isMember(name)) delete members[name]
      else own.agents = named(own.agents).filter((a) => a.name !== name)
      renameInChannels(own, name, null)
      if (own.triage === name) delete own.triage
    },
    // one of its own agents renamed: its channels know it by the new name (a shared one's: renameShared)
    renamed(from, to) {
      renameInChannels(own, from, to)
    },
    get autopilot() {
      return own.autopilot ?? config.autopilot ?? true
    },
    set autopilot(on) {
      own.autopilot = Boolean(on)
    },
    get triage() {
      return own.triage
    },
    set triage(name) {
      own.triage = name || undefined
    },
    get autofix() {
      return own.autofix
    },
    set autofix(on) {
      own.autofix = Boolean(on) || undefined
    },
    // #general first, then the channels you made, in the order you made them
    get channels() {
      return channelsIn(own)
    },
    // parked: its agents don't run (their conversations wait for it to open again)
    get parked() {
      return Boolean(own.parked)
    },
    set parked(on) {
      own.parked = Boolean(on) || undefined
    },
  }
}

// A free id for a new workspace, from its name: "Docs site" -> docs-site, docs-site-2.
// Workspaces you removed, by name ("workspacesGone" in config.json: name -> id). Their files stay, and a workspace made
// again by that name has them back; an id comes from the name a workspace was first given, so the id alone can't say.
const goneKey = (name) => String(name ?? '').trim().toLowerCase()
const goneList = (config) => (config.workspacesGone && typeof config.workspacesGone === 'object' ? config.workspacesGone : {})

// again: it may pick up the files of one you removed under that name. (Not a linked computer's, which has its own. Nor
// can anything else take an id whose files wait for that name.)
export function newId(config, name, { again = true } = {}) {
  const taken = new Set([ROOT, ...workspacesIn(config).map((w) => w.id), ...Object.values(goneList(config))])
  const was = goneList(config)[goneKey(name)]
  if (again && was && !workspacesIn(config).some((w) => w.id === was)) return was
  const base = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'workspace'
  let id = base
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  return id
}

// A workspace's name, look and folder, as the app sets them. Empty values go.
const LOOK = ['name', 'color', 'icon', 'folder']
// A look that can't be set says so before anything changes: a half-made change would stay in memory, and the next save
// would write it.
export function checkLook(patch = {}) {
  const color = typeof patch.color === 'string' ? patch.color.trim() : ''
  if (color && !COLOR.test(color)) throw new Error(`"${color}" isn't a color`)
}
export function setLook(config, id, patch) {
  const own = workspacesIn(config).find((w) => w.id === id)
  if (!own) throw new Error('no such workspace')
  checkLook(patch)
  for (const k of LOOK) {
    if (!(k in patch)) continue
    const v = typeof patch[k] === 'string' ? patch[k].trim() : ''
    if (v) own[k] = v
    else delete own[k]
  }
}

// A new workspace: its look, its folder, and which of your shared agents work in it. -> its id
// folders: { name: folder } for members with a folder of their own there. again: see newId.
export function addWorkspace(config, { name, members = [], folders = {}, ...look }, { again } = {}) {
  name = String(name ?? '').trim()
  if (!name) throw new Error('give the workspace a name')
  checkLook(look)
  const id = newId(config, name, { again })
  // back: its files are in use again
  const left = Object.entries(goneList(config)).filter(([, was]) => was !== id)
  if (left.length) config.workspacesGone = Object.fromEntries(left)
  else delete config.workspacesGone
  const shared = new Set(named(config.agents).map((a) => a.name))
  const entry = (n) => (String(folders[n] ?? '').trim() ? { folder: String(folders[n]).trim() } : {})
  const w = { id, name, members: Object.fromEntries(members.filter((n) => shared.has(n)).map((n) => [n, entry(n)])) }
  config.workspaces = [...(Array.isArray(config.workspaces) ? config.workspaces : []), w]
  setLook(config, id, look)
  return id
}

// A workspace out of config.json. Its files stay in its folder, so one made again by the same name picks its chat, notes
// and tasks back up. (A linked computer's is that computer's: nothing here to pick up.)
export function dropWorkspace(config, id) {
  const w = workspacesIn(config).find((x) => x.id === id)
  if (w && !w.of) config.workspacesGone = { ...goneList(config), [goneKey(w.name || w.id)]: id }
  config.workspaces = (Array.isArray(config.workspaces) ? config.workspaces : []).filter((w) => w?.id !== id)
  if (config.current === id) delete config.current
}

// A shared agent off the roster: out of every workspace too.
export function forget(config, name) {
  config.agents = named(config.agents).filter((a) => a.name !== name)
  for (const w of workspacesIn(config)) {
    delete memberMap(w)[name]
    renameInChannels(w, name, null)
    if (w.triage === name) delete w.triage
  }
}

// A shared agent's new name, everywhere config.json mentions it: the roster, each workspace it's in, triage.
export function renameShared(config, from, to) {
  const def = named(config.agents).find((a) => a.name === from)
  if (def) def.name = to
  for (const w of workspacesIn(config)) {
    renameInChannels(w, from, to)
    const m = memberMap(w)
    if (!Object.hasOwn(m, from)) continue
    w.members = Object.fromEntries(Object.entries(m).map(([k, v]) => [k === from ? to : k, v])) // in the same place
    if (w.triage === from) w.triage = to
  }
}

// Names a shared agent can't take: another shared agent's, or one of the own agents of a workspace it's in.
export function sharedNames(config, name) {
  const out = new Set(named(config.agents).map((a) => a.name))
  for (const w of workspacesIn(config)) if (Object.hasOwn(memberMap(w), name)) for (const a of named(w.agents)) out.add(a.name)
  return out
}

// ---- channels -------------------------------------------------------------------------------------------------

export const GENERAL = 'general'
export const BRIEF_MAX = 4000
// What a channel can be called: what Slack allows, lowercase words joined by hyphens. "iOS Release" -> ios-release.
export const channelName = (raw) =>
  String(raw ?? '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/^#+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
const listOf = (own) => (Array.isArray(own.channels) ? own.channels.filter((c) => c && typeof c === 'object' && ID.test(c.id)) : [])
const cleanBrief = (b) => String(b ?? '').trim().slice(0, BRIEF_MAX)
const cleanMembers = (m) => (Array.isArray(m) ? [...new Set(m.filter((n) => typeof n === 'string' && n))] : undefined)

// A workspace's channels as config.json has them (own: the workspace's entry), #general first. -> [{ id, name, brief, members? }], each id once.
export function channelsIn(own) {
  const seen = new Set([GENERAL])
  const general = listOf(own).find((c) => c.id === GENERAL)
  const rest = listOf(own).filter((c) => !seen.has(c.id) && seen.add(c.id))
  const one = (c) => ({ id: c.id, name: channelName(c.name) || c.id, brief: cleanBrief(c.brief), ...(cleanMembers(c.members) && { members: cleanMembers(c.members) }) })
  return [{ id: GENERAL, name: GENERAL, brief: cleanBrief(general?.brief) }, ...rest.map(one)]
}

const ownOf = (config, ws) => {
  const own = workspacesIn(config).find((w) => w.id === ws)
  if (!own) throw new Error('no such workspace')
  return own
}

// A new channel in a workspace: its name (made channel-like), its brief, and who's in it (none given: everyone).
// -> its id, which stays when it's renamed (the chat's messages point at it).
export function addChannel(config, ws, { name, brief, members } = {}) {
  const own = ownOf(config, ws)
  const n = channelName(name)
  if (!n) throw new Error('give the channel a name')
  const list = channelsIn(own)
  if (list.some((c) => c.name === n)) throw new Error(`there's a #${n} already`)
  // never an id a channel had before: its messages are still in the chat, shown in #general, and must stay there
  const taken = new Set([...list.map((c) => c.id), ...retired(own)])
  let id = n
  for (let i = 2; taken.has(id); i++) id = `${n.slice(0, 39 - String(i).length).replace(/-+$/, '')}-${i}`
  const c = { id, name: n, ...(cleanBrief(brief) && { brief: cleanBrief(brief) }), ...(cleanMembers(members)?.length && { members: cleanMembers(members) }) }
  own.channels = [...listOf(own), c]
  return id
}

// A channel's name, brief or members. #general keeps its name and has everyone; only its brief changes.
// members: [] or null is everyone again.
export function editChannel(config, ws, id, patch = {}) {
  const own = ownOf(config, ws)
  if (!channelsIn(own).some((c) => c.id === id)) throw new Error('no such channel')
  let c = listOf(own).find((x) => x.id === id)
  if (!c) own.channels = [...listOf(own), (c = { id })] // #general, given a brief for the first time
  if ('name' in patch && id !== GENERAL) {
    const n = channelName(patch.name)
    if (!n) throw new Error('give the channel a name')
    if (channelsIn(own).some((x) => x.name === n && x.id !== id)) throw new Error(`there's a #${n} already`)
    c.name = n
  }
  if ('brief' in patch) {
    if (cleanBrief(patch.brief)) c.brief = cleanBrief(patch.brief)
    else delete c.brief
  }
  if ('members' in patch && id !== GENERAL) {
    const m = cleanMembers(patch.members)
    if (m?.length) c.members = m
    else delete c.members
  }
  if (id === GENERAL && !c.brief) own.channels = listOf(own).filter((x) => x.id !== GENERAL)
  if (Array.isArray(own.channels) && !own.channels.length) delete own.channels
}

// A channel out of a workspace (never #general). Its messages stay in the chat, shown in #general.
export function dropChannel(config, ws, id) {
  if (id === GENERAL) throw new Error("#general can't be removed")
  const own = ownOf(config, ws)
  if (!listOf(own).some((c) => c.id === id)) throw new Error('no such channel')
  own.channels = listOf(own).filter((c) => c.id !== id)
  if (!own.channels.length) delete own.channels
  own.channelsGone = [...new Set([...retired(own), id])]
}

// Ids of channels that were removed: "channelsGone" in config.json, so a new channel never takes one.
const retired = (own) => (Array.isArray(own.channelsGone) ? own.channelsGone.filter((x) => typeof x === 'string') : [])

// An agent renamed (to) or gone (null), in a workspace's channel members.
function renameInChannels(own, from, to) {
  for (const c of listOf(own)) {
    if (!Array.isArray(c.members) || !c.members.includes(from)) continue
    c.members = to ? c.members.map((n) => (n === from ? to : n)) : c.members.filter((n) => n !== from)
    if (!c.members.length) delete c.members
  }
}
export { renameInChannels }

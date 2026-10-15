// Workspaces: the projects the crew works on, several at once if you like. Your agents are yours: a shared agent can
// work in any workspace, and a workspace can also have agents of its own that exist only there. Everything about a
// project is kept per workspace: its chat, notes and tasks, each agent's conversation there, what's running there.
// What's about you is kept once: who your agents are, providers, look and feel, linked computers, attachments.
//
// "No workspace" is the default one. Every shared agent is in it, working in its own folder, and its files are where
// Crew always kept them: in CREW_HOME itself. Any other workspace keeps its files in CREW_HOME/workspaces/<id>/.
//
// In config.json, next to "agents" (the shared ones):
//   "workspaces": [{
//     "id": "golf", "name": "Golf", "folder": "~/code/api",            where its agents work
//     "members": { "joseph": {}, "david": { "folder": "~/code/app" } }, shared agents in it, one with a folder of its own
//     "agents": [{ "name": "kim", "area": "docs" }],                    its own agents, set up like shared ones
//     "autopilot": false, "triage": "joseph", "autofix": true          as the top-level ones, which are the default's
//   }]
// Where an agent works in a workspace: its own folder there (a member's "folder", an own agent's "cwd"), else the
// workspace's, else (a shared agent) the folder it has of its own, else home. Whether it's on ("off") is per workspace
// too. Who it is (its job, instructions, model, look) is the same wherever it works.
// No Electron in here.
import path from 'node:path'

export const DEFAULT = 'default'
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/

// Where a workspace keeps its files.
export const dirOf = (home, id) => (id === DEFAULT ? home : path.join(home, 'workspaces', id))

// The workspaces in config.json besides the default, each once and with an id that can name a folder.
export function workspacesIn(config) {
  const seen = new Set([DEFAULT])
  const list = Array.isArray(config.workspaces) ? config.workspaces : []
  return list.filter((w) => w && typeof w === 'object' && ID.test(w.id) && !seen.has(w.id) && seen.add(w.id))
}

const named = (list) => (Array.isArray(list) ? list.filter((a) => a && typeof a.name === 'string' && a.name) : [])
const memberMap = (w) => (w.members && typeof w.members === 'object' && !Array.isArray(w.members) ? w.members : {})

// One workspace, as config.json has it: its agents as they work there, and its settings, which read and write the file
// in place (space.autopilot = false lands where it belongs). null when there's no such workspace.
export function space(config, id) {
  const own = id === DEFAULT ? config : workspacesIn(config).find((w) => w.id === id)
  if (!own) return null
  const shared = named(config.agents)
  const members = id === DEFAULT ? null : memberMap(own)
  const joined = members ? shared.filter((a) => Object.hasOwn(members, a.name)) : shared
  const taken = new Set(joined.map((a) => a.name))
  // its own agents, unless one has a name a member has (or another of its own has) already
  const owned = members ? named(own.agents).filter((a) => !taken.has(a.name) && taken.add(a.name)) : []
  const isMember = (name) => Boolean(members) && joined.some((a) => a.name === name)
  const entry = (name) => (members[name] && typeof members[name] === 'object' ? members[name] : {})

  const agents = [
    ...joined.map((a) => {
      if (!members) return { ...a, shared: true }
      const { off, ...who } = a // a shared agent's own "off" is its switch in the default workspace
      const m = entry(a.name)
      return { ...who, cwd: m.folder || own.folder || a.cwd, ...(m.off && { off: true }), shared: true }
    }),
    ...owned.map((a) => ({ ...a, cwd: a.cwd || own.folder, shared: false })),
  ]

  const def = (name) => [...joined, ...owned].find((a) => a.name === name)
  return {
    id,
    name: members ? own.name || own.id : null,
    folder: members ? own.folder || null : null,
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
    // A new agent: a shared one joins the roster (and this workspace, with `member` as its entry here, if it isn't the
    // default); any other is this workspace's own.
    add(fields, { shared: isShared = !members, member = {} } = {}) {
      if (isShared) {
        config.agents = [...(Array.isArray(config.agents) ? config.agents : []), fields]
        if (members) own.members = { ...members, [fields.name]: member }
      } else own.agents = [...(Array.isArray(own.agents) ? own.agents : []), fields]
    },
    join(name, fields = {}) {
      own.members = { ...members, [name]: fields }
    },
    leave(name) {
      if (members) delete members[name]
    },
    // one of its own agents goes; a shared one only leaves (see forget for taking it off the roster)
    remove(name) {
      if (isMember(name)) delete members[name]
      else if (members) own.agents = named(own.agents).filter((a) => a.name !== name)
      else forget(config, name)
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
  }
}

// A shared agent off the roster: out of every workspace too.
export function forget(config, name) {
  config.agents = named(config.agents).filter((a) => a.name !== name)
  for (const w of workspacesIn(config)) delete memberMap(w)[name]
}

// A shared agent's new name, everywhere config.json mentions it: the roster, each workspace it's in, triage.
export function renameShared(config, from, to) {
  const def = named(config.agents).find((a) => a.name === from)
  if (def) def.name = to
  if (config.triage === from) config.triage = to
  for (const w of workspacesIn(config)) {
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

// Agent tools: what an agent can change about CLIque itself, by running `crew app …` in its shell (bin/crew, the /app
// route in core/server.js). Adding an agent, a channel or a workspace, linking a computer: what you'd do in the app,
// done by an agent you asked to. How far they go is yours to say ("tools" in config.json, the Agent tools sheet):
//   off    agents can't use them
//   ask    every change waits for your OK: a card in the chat, like a permission prompt's (the default)
//   auto   changes go through right away and say so in the chat. What can't be undone (removing), what lets another
//          computer in (linking) and a YOLO agent still ask.
// Looking (crew app agents, workspaces, …) never asks. This isn't a sandbox: an agent runs as you and could edit
// config.json itself. It's the way an agent asks before it changes your app, and the way you say yes or no.
// Crew.tool runs them: core/crew.js. No Electron in here.
import path from 'node:path'
import { GENERAL, channelName, checkLook, named, sharedNames, workspacesIn } from './workspaces.js'
import { isOffered } from './providers.js'
import { readCode } from './link.js'
import { folderInfo } from './move.js'

export const MODES = ['off', 'ask', 'auto']
export const toolMode = (config) => (MODES.includes(config?.tools) ? config.tools : 'ask')

// ---- reading the words ----------------------------------------------------------------------------------------

// `crew app <what> [words] [--flag value]`: which tool, the words naming what it's for, its flags. A flag's value is
// the word after it (--area "QA for checkout") or after = (--area=QA); a switch (--crew) takes none.
// -> { help: true } or { key, tool, name, flags }
export function parse(words) {
  words = words.map(String)
  while (words.length && !words[0].trim()) words.shift() // `crew app` alone sends one empty word
  const [w0 = '', w1 = ''] = words.map((w) => w.trim().toLowerCase())
  if (!w0 || ['help', '--help', '-h'].includes(w0)) return { help: true }
  const key = Object.hasOwn(TOOLS, `${w0} ${w1}`) ? `${w0} ${w1}` : Object.hasOwn(TOOLS, w0) ? w0 : null
  if (!key) throw new Error(`there's no crew app ${words.slice(0, 2).join(' ').trim()} (crew app help lists them)`)
  const tool = TOOLS[key]
  const rest = words.slice(key.split(' ').length)
  const flags = {}
  const plain = []
  for (let i = 0; i < rest.length; i++) {
    const m = /^--([a-z][a-z-]*)(?:=([\s\S]*))?$/.exec(rest[i])
    if (!m) {
      plain.push(rest[i])
      continue
    }
    const [, flag, inline] = m
    const kind = tool.flags?.[flag]
    if (!kind) throw new Error(`crew app ${key} takes no --${flag}. Use: ${usage(key)}`)
    if (kind === 'switch') flags[flag] = true
    else {
      const value = inline ?? rest[++i]
      if (value === undefined) throw new Error(`--${flag} needs a value. Use: ${usage(key)}`)
      flags[flag] = value
    }
  }
  const name = plain.join(' ').trim()
  if (tool.what && !name) throw new Error(`which ${tool.what}? Use: ${usage(key)}`)
  if (!tool.what && name) throw new Error(`crew app ${key} takes no words. Use: ${usage(key)}`)
  return { key, tool, name, flags }
}

const usage = (key) => `crew app ${key}${TOOLS[key].use ? ` ${TOOLS[key].use}` : ''}`

// "ada, milo" or "@ada @milo" -> ['ada', 'milo']
const names = (v) => [...new Set(String(v ?? '').split(/[\s,]+/).map((n) => n.replace(/^@/, '').trim().toLowerCase()).filter(Boolean))]
const clip = (s, n = 300) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))
const lowerFirst = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1)

// ---- what they're about -----------------------------------------------------------------------------------------

// A workspace on this computer by its name (any case) or id. -> its entry in Crew.workspaces()
function workspaceNamed(crew, raw) {
  const want = String(raw ?? '').trim()
  const all = crew.workspaces()
  const byId = all.find((w) => w.id === want)
  if (byId) return byId
  const byName = all.filter((w) => w.name.toLowerCase() === want.toLowerCase())
  if (byName.length > 1) throw new Error(`${byName.length} workspaces are called ${want}: give its id instead (crew app workspaces)`)
  if (!byName.length) throw new Error(`there's no workspace called ${want} (crew app workspaces lists them)`)
  return byName[0]
}

// The hub a tool works in: the caller's workspace, or the one --in names.
function hubFor(crew, hub, flags) {
  if (!flags.in) return hub
  return crew.hubs.get(workspaceNamed(crew, flags.in).id)
}

// A linked computer's workspace is changed on that computer: here it only shows.
function notHosted(crew, w, what) {
  const owner = crew.ownerOf(w.id)
  if (owner.owner) throw new Error(`${w.name} is ${owner.ownerName}'s workspace: its ${what} are changed on ${owner.ownerName}`)
}

// " in Storefront", when a change is for a workspace other than the asking agent's own (--in): its card says where.
const inWs = (hub, mine) => (hub !== mine ? ` in ${hub.space.name}` : '')

// One of this workspace's agents (not a clone, not one on a linked computer).
function agentIn(hub, raw) {
  const name = String(raw).replace(/^@/, '').trim().toLowerCase()
  if (name.includes('@')) throw new Error(`@${name} is on another computer: an agent there can change it`)
  const a = hub.agents.get(name)
  if (a?.cloneOf) throw new Error(`@${name} is a clone of @${a.cloneOf}: change @${a.cloneOf} instead`)
  if (!hub.space.has(name)) throw new Error(`there's no agent called ${name} in ${hub.space.name} (crew who lists them)`)
  return name
}

// A channel of a workspace by its name (with or without #) or id.
function channelIn(hub, raw) {
  const want = channelName(raw)
  const c = hub.space.channels.find((x) => x.name === want || x.id === want)
  if (!c) throw new Error(`there's no #${want} in ${hub.space.name} (crew app channels lists them)`)
  return c
}

// The brain an agent runs on: a provider by id or label (claude, Codex, GLM), offered here and ready to run.
function brainOf(hub, raw) {
  const want = String(raw ?? 'claude').trim().toLowerCase()
  const p = Object.values(hub.providers).find((x) => x.id.toLowerCase() === want || String(x.label).toLowerCase() === want)
  const offered = Object.values(hub.providers).filter((x) => isOffered(x.id, hub.config)).map((x) => x.id)
  if (!p || !isOffered(p.id, hub.config)) throw new Error(`there's no brain called ${raw}: it's one of ${offered.join(', ')} (crew app brains)`)
  if (p.missing?.length) throw new Error(`${p.label} needs ${p.missing.join(', ')} in your shell environment first`)
  return p
}

function effortOf(provider, raw) {
  if (raw === undefined) return undefined
  const e = String(raw).trim().toLowerCase()
  if (!provider.efforts?.length) throw new Error(`${provider.label} has no effort levels to pick from`)
  if (!provider.efforts.includes(e)) throw new Error(`${provider.label}'s effort is one of ${provider.efforts.join(', ')}`)
  return e
}

// A folder on this computer, written out in full (~ is fine): an agent's own folder isn't known here, so nothing relative.
function folderOf(raw) {
  const given = String(raw ?? '').trim()
  if (!given) return ''
  if (!/^~(?=[\\/]|$)/.test(given) && !path.isAbsolute(given)) throw new Error(`give the folder's whole path (~/… or /…), not ${given}`)
  const info = folderInfo(given)
  if (!info.exists) throw new Error(`there's no folder at ${given}`)
  return given
}

// Whether one of your shared agents runs YOLO.
const yoloOf = (crew, name) => Boolean(named(crew.config.data.agents).find((a) => a.name === name)?.yolo)

// Your shared agents, who can work in any workspace.
const rosterOf = (crew) => named(crew.config.data.agents).map((a) => a.name)

function rosterNames(crew, raw) {
  const roster = new Set(rosterOf(crew))
  const list = names(raw)
  const unknown = list.filter((n) => !roster.has(n))
  if (unknown.length) throw new Error(`${unknown.map((n) => `@${n}`).join(', ')} ${unknown.length > 1 ? "aren't" : "isn't"} one of your agents (crew app agents lists them)`)
  return list
}

const brainText = (hub, a) => [hub.providers[a.provider ?? a.cli ?? 'claude']?.label, a.model, a.effort].filter(Boolean).join(' ')

// The fields an agent's card shows, old → new for a change.
const FIELD_NAMES = { name: 'name', area: 'job', provider: 'brain', model: 'model', effort: 'effort', tier: 'Fast mode', cwd: 'folder', prompt: 'instructions', yolo: 'YOLO' }
const shown = (k, v) => (v === undefined || v === '' ? '(none)' : k === 'yolo' ? (v ? 'on' : 'off') : k === 'prompt' ? clip(String(v).replace(/\s+/g, ' '), 80) : String(v))

// ---- the tools ------------------------------------------------------------------------------------------------
// Each one's plan({ crew, hub, from }, call) checks what it can now (a wrong name fails before anyone is asked) and
// says what the card shows: { title, code?, detail?, say, risky?, run }. run() makes the change and says what it did
// (to the agent), and did is what the chat says it did when it went through without asking. A read tool's run() is
// what it prints.

const AGENT_FLAGS = { area: 'value', brain: 'value', model: 'value', effort: 'value', folder: 'value', prompt: 'value', in: 'value' }

export const TOOLS = {
  agents: {
    group: 'look', about: 'your agents: their jobs, brains, and the workspaces each works in', read: true,
    plan: ({ crew, hub }) => ({
      run: () => {
        const data = crew.config.data
        const rows = []
        for (const a of named(data.agents)) {
          const where = workspacesIn(data).filter((w) => !w.of && Object.hasOwn(w.members ?? {}, a.name)).map((w) => w.name || w.id)
          rows.push(`${a.name.padEnd(16)} ${clip(a.area || 'general', 40).padEnd(40)} ${brainText(hub, a).padEnd(18)} ${where.length ? `works in ${where.join(', ')}` : 'in no workspace right now'}`)
        }
        for (const w of workspacesIn(data).filter((x) => !x.of)) {
          for (const a of (w.agents ?? []).filter((x) => x?.name)) rows.push(`${a.name.padEnd(16)} ${clip(a.area || 'general', 40).padEnd(40)} ${brainText(hub, a).padEnd(18)} ${w.name || w.id} only`)
        }
        return rows.length ? `${rows.join('\n')}\n` : '(no agents yet)\n'
      },
    }),
  },
  brains: {
    group: 'look', about: 'the brains an agent can run on, with their models and effort levels', read: true,
    plan: ({ hub }) => ({
      run: () => `${Object.values(hub.providers).filter((p) => isOffered(p.id, hub.config)).map((p) => {
        const parts = [p.models?.length && `models ${p.models.join(', ')}`, p.efforts?.length && `effort ${p.efforts.join(', ')}`, p.missing?.length && `needs ${p.missing.join(', ')}`].filter(Boolean)
        return `${p.id.padEnd(10)} ${String(p.label).padEnd(10)} ${parts.join(' · ')}`
      }).join('\n')}\n`,
    }),
  },
  channels: {
    group: 'look', about: "this workspace's channels, who's in each and its brief", read: true, flags: { in: 'value' },
    plan: ({ crew, hub }, { flags }) => {
      const h = hubFor(crew, hub, flags)
      return { run: () => `${h.space.channels.map((c) => `#${c.name.padEnd(20)} ${(c.members?.map((n) => `@${n}`).join(' ') || 'everyone').padEnd(24)} ${c.brief ? clip(c.brief.replace(/\s+/g, ' '), 100) : '(no brief)'}`).join('\n')}\n` }
    },
  },
  workspaces: {
    group: 'look', about: 'your workspaces: their folders, who works in each, which are asleep', read: true,
    plan: ({ crew, hub }) => ({
      run: () => `${crew.workspaces().map((w) => {
        const bits = [`id ${w.id}`, w.folder, w.ownerName && `hosted on ${w.ownerName}`, w.members?.length && w.members.map((m) => `@${m.name}`).join(' '), w.parked && 'asleep', w.id === hub.ws && "you're here"]
        return `${w.name.padEnd(20)} ${bits.filter(Boolean).join(' · ')}`
      }).join('\n')}\n`,
    }),
  },
  computers: {
    group: 'look', about: 'this computer and the computers linked to it', read: true,
    plan: ({ crew }) => ({
      run: () => {
        const c = crew.computers()
        const rows = [`${c.me.name.padEnd(20)} this computer${c.me.sharing ? ', letting computers link with its code' : ''}`]
        for (const l of c.links) rows.push(`${l.name.padEnd(20)} linked, ${l.online ? 'online' : 'offline'}`)
        return `${rows.join('\n')}\n`
      },
    }),
  },

  'agent add': {
    group: 'agents', what: 'name', about: "a new agent, the workspace's own; --crew makes it one of your agents, who can work in any workspace",
    use: '<name> --area "<its job>" [--brain claude|codex|…] [--model <m>] [--effort <e>] [--folder <dir>] [--prompt "<instructions>"] [--crew] [--off] [--yolo] [--in <workspace>]',
    flags: { ...AGENT_FLAGS, crew: 'switch', off: 'switch', yolo: 'switch' },
    plan: ({ crew, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(crew, mine, flags)
      notHosted(crew, { id: hub.ws, name: hub.space.name }, 'agents')
      const shared = Boolean(flags.crew)
      const name = hub.freeName(raw, shared ? (n) => hub.agents.has(n) || sharedNames(hub.config, n).has(n) : undefined)
      const brain = brainOf(hub, flags.brain)
      const effort = effortOf(brain, flags.effort)
      const cwd = folderOf(flags.folder)
      const area = String(flags.area ?? '').trim()
      const prompt = String(flags.prompt ?? '').trim()
      const where = shared ? `joins your crew and works in ${hub.space.name}` : `only ${hub.space.name} has it`
      return {
        title: 'Add an agent',
        code: [`@${name}${area ? ` · ${area}` : ''}`, [brain.label, flags.model, effort, cwd].filter(Boolean).join(' · '), flags.yolo && 'YOLO: runs every command without asking'].filter(Boolean).join('\n'),
        detail: `${where[0].toUpperCase()}${where.slice(1)}, and ${flags.off ? 'starts off' : 'starts right away'}.${prompt ? ` Instructions: ${clip(prompt)}` : ''}`,
        say: `Can I add a new agent, @${name}${area ? `, for ${clip(area, 60)}` : ''}?`,
        risky: Boolean(flags.yolo),
        hub,
        did: `added a new agent, @${name}${inWs(hub, mine)}`,
        run: () => {
          const made = hub.addAgent({ name, area, prompt, provider: brain.id, model: flags.model, effort, cwd, shared, off: flags.off, yolo: flags.yolo })
          return `added @${made}${hub !== mine ? ` in ${hub.space.name}` : ''}${flags.off ? `, off (crew app agent on ${made} starts it)` : ', starting now'}`
        },
      }
    },
  },
  'agent edit': {
    group: 'agents', what: 'agent', about: "change an agent's name, job, brain, folder or instructions",
    use: '<name> [--name <new>] [--area "…"] [--brain …] [--model …] [--effort …] [--folder <dir>] [--prompt "…"] [--yolo | --no-yolo] [--in <workspace>]',
    flags: { ...AGENT_FLAGS, name: 'value', yolo: 'switch', 'no-yolo': 'switch' },
    plan: ({ crew, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(crew, mine, flags)
      const name = agentIn(hub, raw)
      const a = hub.space.agents.find((x) => x.name === name)
      const patch = {}
      if (flags.name !== undefined) patch.name = hub.freeName(flags.name, hub.space.shared(name) ? (n) => hub.agents.has(n) || sharedNames(hub.config, name).has(n) : undefined)
      if (flags.area !== undefined) patch.area = String(flags.area).trim()
      if (flags.prompt !== undefined) patch.prompt = String(flags.prompt).trim()
      if (flags.folder !== undefined) patch.cwd = folderOf(flags.folder)
      const before = hub.providers[a.provider ?? a.cli ?? 'claude']
      const brain = flags.brain !== undefined ? brainOf(hub, flags.brain) : before
      if (flags.brain !== undefined) patch.provider = brain.id
      if (flags.model !== undefined) patch.model = String(flags.model).trim()
      if (flags.effort !== undefined) patch.effort = effortOf(brain, flags.effort)
      // a new brain starts from its own defaults: the old one's model, effort and Fast mode go (as in the app's editor)
      if (brain !== before) {
        if (flags.model === undefined && a.model) patch.model = ''
        if (flags.effort === undefined && a.effort) patch.effort = ''
        if (a.tier) patch.tier = ''
      }
      if (flags.yolo && flags['no-yolo']) throw new Error('--yolo or --no-yolo, not both')
      if (flags.yolo) patch.yolo = true
      if (flags['no-yolo']) patch.yolo = false
      const changed = Object.keys(FIELD_NAMES).filter((k) => k in patch && JSON.stringify(patch[k] || undefined) !== JSON.stringify(a[k] || undefined))
      const was = { ...a, provider: hub.providers[a.provider ?? a.cli ?? 'claude']?.label }
      const now = { ...patch, provider: brain.label }
      if (!changed.length) throw new Error(`nothing to change: say what, e.g. ${usage('agent edit')}`)
      // a conversation is kept by its CLI, in the folder it began in: another of either starts a new one
      const fresh = brain.cli !== before?.cli || changed.includes('cwd')
      return {
        title: `Change @${name}${inWs(hub, mine)}`,
        code: changed.map((k) => `${FIELD_NAMES[k]}: ${shown(k, was[k])} → ${shown(k, now[k])}`).join('\n'),
        detail: ['provider', 'model', 'effort', 'cwd', 'yolo', 'prompt', 'area'].some((k) => changed.includes(k)) ? (fresh ? `@${name} restarts with it once it's free, in a new conversation.` : `@${name} restarts with it once it's free, and keeps its conversation.`) : '',
        say: `Can I change @${name}'s ${changed.map((k) => FIELD_NAMES[k]).join(', ')}${inWs(hub, mine)}?`,
        // a YOLO agent runs whatever it's told without asking: pointing one somewhere new, or telling it what to do, asks
        risky: patch.yolo === true || (Boolean(a.yolo) && patch.yolo !== false),
        hub,
        did: `changed @${name}'s ${changed.map((k) => FIELD_NAMES[k]).join(', ')}${inWs(hub, mine)}`,
        run: () => {
          hub.update([name], Object.fromEntries(changed.map((k) => [k, patch[k]])))
          return `changed @${patch.name ?? name}: ${changed.map((k) => FIELD_NAMES[k]).join(', ')}`
        },
      }
    },
  },
  'agent on': {
    group: 'agents', what: 'agent', about: 'turn an agent on', use: '<name> [--in <workspace>]', flags: { in: 'value' },
    plan: (ctx, call) => onOff(ctx, call, true),
  },
  'agent off': {
    group: 'agents', what: 'agent', about: 'turn an agent off (its conversation waits for it)', use: '<name> [--in <workspace>]', flags: { in: 'value' },
    plan: (ctx, call) => onOff(ctx, call, false),
  },
  'agent remove': {
    group: 'agents', what: 'agent', risky: true, about: 'take an agent out of a workspace; --everywhere takes one of your own agents out of CLIque', use: '<name> [--everywhere] [--in <workspace>]', flags: { in: 'value', everywhere: 'switch' },
    plan: ({ crew, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(crew, mine, flags)
      const name = agentIn(hub, raw)
      const shared = hub.space.shared(name)
      const leaves = shared && !flags.everywhere
      return {
        title: `Remove @${name}${inWs(hub, mine)}`,
        code: `@${name}${hub.space.agents.find((a) => a.name === name)?.area ? ` · ${hub.space.agents.find((a) => a.name === name).area}` : ''}`,
        detail: leaves ? `It leaves ${hub.space.name}, and stays one of your agents everywhere else.` : 'It stops and is gone for good, with its conversation here (the transcript stays with the CLI).',
        say: leaves ? `Can I take @${name} out of ${hub.space.name}?` : `Can I remove @${name} for good?`,
        hub,
        did: leaves ? `took @${name} out of ${hub.space.name}` : `removed @${name}`,
        run: () => {
          hub.removeAgent(name, { everywhere: shared && !leaves })
          return leaves ? `@${name} is out of ${hub.space.name}` : `removed @${name}`
        },
      }
    },
  },

  'channel add': {
    group: 'channels', what: 'name', about: 'a new channel. Its brief is what agents are told to do there; without --members everyone is in it',
    use: '<name> [--brief "<what agents do there>"] [--members a,b] [--in <workspace>]', flags: { brief: 'value', members: 'value', in: 'value' },
    plan: ({ crew, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(crew, mine, flags)
      notHosted(crew, { id: hub.ws, name: hub.space.name }, 'channels')
      const name = channelName(raw)
      if (!name) throw new Error('give the channel a name')
      if (hub.space.channels.some((c) => c.name === name)) throw new Error(`there's a #${name} already`)
      const members = names(flags.members).map((n) => agentIn(hub, n))
      const brief = String(flags.brief ?? '').trim()
      return {
        title: `Add a channel${inWs(hub, mine)}`,
        code: `#${name}${brief ? `\n${clip(brief, 600)}` : ''}`,
        detail: members.length ? `For ${members.map((n) => `@${n}`).join(', ')}` : `Everyone in ${hub.space.name} is in it`,
        say: `Can I add a #${name} channel${inWs(hub, mine)}?`,
        hub,
        did: `added the #${name} channel${inWs(hub, mine)}`,
        run: () => {
          crew.channelAction('create', null, { name, brief, ...(members.length && { members }) }, hub.ws)
          return `added #${name}${hub !== mine ? ` in ${hub.space.name}` : ''}`
        },
      }
    },
  },
  'channel edit': {
    group: 'channels', what: 'channel', about: "change a channel's name, brief or members (--members everyone: all of them)",
    use: '<name> [--name <new>] [--brief "…"] [--members a,b | --members everyone] [--in <workspace>]', flags: { name: 'value', brief: 'value', members: 'value', in: 'value' },
    plan: ({ crew, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(crew, mine, flags)
      notHosted(crew, { id: hub.ws, name: hub.space.name }, 'channels')
      const c = channelIn(hub, raw)
      const patch = {}
      const lines = []
      if (flags.name !== undefined) {
        if (c.id === GENERAL) throw new Error('#general keeps its name')
        patch.name = channelName(flags.name)
        if (!patch.name) throw new Error('give the channel a name')
        if (hub.space.channels.some((x) => x.name === patch.name && x.id !== c.id)) throw new Error(`there's a #${patch.name} already`)
        lines.push(`name: #${c.name} → #${patch.name}`)
      }
      if (flags.brief !== undefined) {
        patch.brief = String(flags.brief).trim()
        lines.push(`brief: ${patch.brief ? clip(patch.brief, 600) : '(none)'}`)
      }
      if (flags.members !== undefined) {
        if (c.id === GENERAL) throw new Error('everyone is in #general')
        const everyone = ['everyone', 'all', '*'].includes(String(flags.members).trim().toLowerCase())
        patch.members = everyone ? [] : names(flags.members).map((n) => agentIn(hub, n))
        lines.push(`members: ${patch.members.length ? patch.members.map((n) => `@${n}`).join(', ') : 'everyone'}`)
      }
      if (!lines.length) throw new Error(`nothing to change: say what, e.g. ${usage('channel edit')}`)
      return {
        title: `Change #${c.name}${inWs(hub, mine)}`,
        code: lines.join('\n'),
        say: `Can I change #${c.name}${inWs(hub, mine)}?`,
        hub,
        did: `changed #${c.name}${inWs(hub, mine)}`,
        run: () => {
          crew.channelAction('edit', c.id, patch, hub.ws)
          return `changed #${patch.name ?? c.name}`
        },
      }
    },
  },
  'channel remove': {
    group: 'channels', what: 'channel', risky: true, about: 'remove a channel (its messages stay, under #general)', use: '<name> [--in <workspace>]', flags: { in: 'value' },
    plan: ({ crew, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(crew, mine, flags)
      notHosted(crew, { id: hub.ws, name: hub.space.name }, 'channels')
      const c = channelIn(hub, raw)
      if (c.id === GENERAL) throw new Error("#general can't be removed")
      return {
        title: `Remove #${c.name}${inWs(hub, mine)}`,
        code: `#${c.name}`,
        detail: 'Its messages stay in the chat, under #general.',
        say: `Can I remove #${c.name}${inWs(hub, mine)}?`,
        hub,
        did: `removed #${c.name}${inWs(hub, mine)}`,
        run: () => {
          crew.channelAction('remove', c.id, null, hub.ws)
          return `removed #${c.name}`
        },
      }
    },
  },

  'workspace add': {
    group: 'workspaces', what: 'name', about: 'a new workspace, with your agents who work in it. It opens in the background: the screen stays where it is',
    use: '<name> [--folder <dir>] [--members a,b] [--icon <emoji>] [--color <color>]', flags: { folder: 'value', members: 'value', icon: 'value', color: 'value' },
    plan: ({ crew }, { name, flags }) => {
      if (crew.workspaces().some((w) => w.name.toLowerCase() === name.toLowerCase())) throw new Error(`there's a workspace called ${name} already`)
      const folder = folderOf(flags.folder)
      const members = rosterNames(crew, flags.members)
      checkLook({ color: flags.color })
      const yolo = members.filter((n) => yoloOf(crew, n))
      return {
        title: 'Add a workspace',
        code: [`${flags.icon ? `${flags.icon} ` : ''}${name}`, folder].filter(Boolean).join('\n'),
        detail: members.length ? `${members.map((n) => `@${n}`).join(', ')} work${members.length === 1 ? 's' : ''} there, and start${members.length === 1 ? 's' : ''} right away.` : 'No agents in it yet.',
        say: `Can I make a workspace called ${name}?`,
        risky: yolo.length > 0, // a YOLO agent starting work somewhere new
        did: `made the ${name} workspace`,
        run: () => {
          const { id } = crew.workspaceAction('create', null, { name, folder, members, icon: flags.icon, color: flags.color, show: false })
          return `made the workspace ${name} (id ${id})${members.length ? `: ${members.map((n) => `@${n}`).join(', ')} work${members.length === 1 ? 's' : ''} there` : ''}`
        },
      }
    },
  },
  'workspace edit': {
    group: 'workspaces', what: 'workspace', about: "change a workspace's name, folder, icon or color",
    use: '<name> [--name <new>] [--folder <dir>] [--icon <emoji>] [--color <color>]', flags: { name: 'value', folder: 'value', icon: 'value', color: 'value' },
    plan: ({ crew }, { name: raw, flags }) => {
      const w = workspaceNamed(crew, raw)
      notHosted(crew, w, 'settings')
      const patch = {}
      if (flags.name !== undefined) patch.name = String(flags.name).trim()
      if (flags.folder !== undefined) patch.folder = folderOf(flags.folder)
      if (flags.icon !== undefined) patch.icon = flags.icon
      if (flags.color !== undefined) patch.color = flags.color
      checkLook(patch)
      const keys = Object.keys(patch)
      if (!keys.length) throw new Error(`nothing to change: say what, e.g. ${usage('workspace edit')}`)
      return {
        title: `Change ${w.name}`,
        code: keys.map((k) => `${k}: ${w[k] || '(none)'} → ${patch[k] || '(none)'}`).join('\n'),
        say: `Can I change the ${w.name} workspace?`,
        did: `changed the ${w.name} workspace`,
        run: () => {
          crew.workspaceAction('edit', w.id, patch)
          return `changed ${patch.name || w.name}`
        },
      }
    },
  },
  'workspace members': {
    group: 'workspaces', what: 'workspace', about: 'which of your agents work in a workspace', use: '<name> [--add a,b] [--remove a,b]', flags: { add: 'value', remove: 'value' },
    plan: ({ crew }, { name: raw, flags }) => {
      const w = workspaceNamed(crew, raw)
      const add = rosterNames(crew, flags.add).filter((n) => !w.members.some((m) => m.name === n))
      const remove = names(flags.remove).filter((n) => w.members.some((m) => m.name === n))
      if (!add.length && !remove.length) throw new Error(`nothing to change: ${flags.add || flags.remove ? `that's how ${w.name} is already` : `say who, e.g. ${usage('workspace members')}`}`)
      const lines = [add.length && `in: ${add.map((n) => `@${n}`).join(', ')}`, remove.length && `out: ${remove.map((n) => `@${n}`).join(', ')}`].filter(Boolean)
      return {
        risky: add.some((n) => yoloOf(crew, n)), // a YOLO agent starting work somewhere new
        title: `Change who works in ${w.name}`,
        code: lines.join('\n'),
        detail: remove.length ? 'Agents taken out stop there, and stay your agents everywhere else.' : '',
        say: `Can I change who works in ${w.name}?`,
        did: `changed who works in ${w.name}: ${lines.join(', ')}`,
        run: () => {
          crew.workspaceAction('members', w.id, { add, remove })
          return `${w.name}: ${lines.join(', ')}`
        },
      }
    },
  },
  'workspace sleep': {
    group: 'workspaces', what: 'workspace', about: "put a workspace to sleep: its agents stop, and pick up where they left off when it wakes", use: '<name>',
    plan: ({ crew, hub }, { name: raw }) => {
      const w = workspaceNamed(crew, raw)
      if (w.parked) throw new Error(`${w.name} is asleep already`)
      return {
        title: `Put ${w.name} to sleep`,
        code: w.name,
        detail: `Its agents stop${w.id === hub.ws ? ', you too' : ''}, and pick up their conversations when it wakes.`,
        say: `Can I put ${w.name} to sleep?`,
        did: `put ${w.name} to sleep`,
        run: () => {
          crew.workspaceAction('park', w.id)
          return `${w.name} is asleep`
        },
      }
    },
  },
  'workspace wake': {
    group: 'workspaces', what: 'workspace', about: 'wake a workspace that is asleep: its agents start again', use: '<name>',
    plan: ({ crew }, { name: raw }) => {
      const w = workspaceNamed(crew, raw)
      if (!w.parked) throw new Error(`${w.name} is awake already`)
      return {
        title: `Wake ${w.name}`,
        code: w.name,
        say: `Can I wake ${w.name}?`,
        did: `woke ${w.name}`,
        run: () => {
          crew.workspaceAction('open', w.id)
          return `${w.name} is awake`
        },
      }
    },
  },
  'workspace remove': {
    group: 'workspaces', what: 'workspace', risky: true, about: 'remove a workspace (its chat, notes and tasks stay on disk)', use: '<name>',
    plan: ({ crew, hub }, { name: raw }) => {
      const w = workspaceNamed(crew, raw)
      const owner = crew.ownerOf(w.id)
      const own = (workspacesIn(crew.config.data).find((x) => x.id === w.id)?.agents ?? []).filter((a) => a?.name).length
      return {
        title: owner.owner ? `Hide ${w.name} on this computer` : `Remove ${w.name}`,
        code: w.name,
        detail: owner.owner
          ? `It's ${owner.ownerName}'s, and stays there with its chat, tasks and agents. Your agents in it stop here.`
          : `Its agents stop${w.id === hub.ws ? ', you too' : ''}.${own ? ` ${own} agent${own > 1 ? 's' : ''} of its own go${own > 1 ? '' : 'es'} with it.` : ''} Its chat, notes and tasks stay on disk: a workspace made again with the same name picks them back up.`,
        say: owner.owner ? `Can I hide ${w.name} on this computer?` : `Can I remove the ${w.name} workspace?`,
        did: owner.owner ? `hid ${w.name}` : `removed the ${w.name} workspace`,
        run: () => {
          crew.workspaceAction('remove', w.id)
          return owner.owner ? `${w.name} is hidden here` : `removed ${w.name}`
        },
      }
    },
  },

  link: {
    group: 'computers', what: 'code', risky: true, about: "link this computer with another, by the code the other one's Computers sheet shows (crew1.…)", use: '<code>',
    plan: ({ crew }, { name: code }) => {
      const info = readCode(code)
      const linked = [...crew.links.values()].find((l) => l.code === code.trim())
      if (linked) throw new Error(`this computer is linked with ${linked.name ?? info.name} already`)
      return {
        title: `Link with ${info.name}`,
        code: info.name,
        detail: `Linked, the two computers use each other's agents: each can send them work, see their chat and their terminals.`,
        say: `Can I link this computer with ${info.name}?`,
        did: `linked this computer with ${info.name}`,
        run: async () => {
          await crew.connect(code)
          return `linked with ${info.name}`
        },
      }
    },
  },
  unlink: {
    group: 'computers', what: 'computer', risky: true, about: 'unlink a linked computer', use: '<computer>',
    plan: ({ crew }, { name: raw }) => {
      const want = String(raw).trim().toLowerCase()
      const l = [...crew.links.values()].find((x) => x.slug === want || String(x.name ?? '').toLowerCase() === want)
      if (!l) throw new Error(`this computer isn't linked with ${raw} (crew app computers lists them)`)
      return {
        title: `Unlink ${l.name ?? l.slug}`,
        code: l.name ?? l.slug,
        detail: 'Its agents leave this computer, and yours leave it. Linking again takes a new code.',
        say: `Can I unlink ${l.name ?? l.slug}?`,
        did: `unlinked ${l.name ?? l.slug}`,
        run: () => {
          crew.forget(l.slug)
          return `unlinked ${l.name ?? l.slug}`
        },
      }
    },
  },
}

function onOff({ crew, hub: mine }, { name: raw, flags }, on) {
  const hub = hubFor(crew, mine, flags)
  const name = agentIn(hub, raw)
  const a = hub.space.agents.find((x) => x.name === name)
  if (Boolean(a.off) !== on) throw new Error(`@${name} is ${on ? 'on' : 'off'} already`)
  const word = on ? 'on' : 'off'
  return {
    title: `Turn @${name} ${word}${inWs(hub, mine)}`,
    code: `@${name}${a.area ? ` · ${a.area}` : ''}${a.yolo ? '\nYOLO: runs every command without asking' : ''}`,
    ...(!on && { detail: 'Its conversation waits for it to come back on.' }),
    say: `Can I turn @${name} ${word}${inWs(hub, mine)}?`,
    risky: on && Boolean(a.yolo), // starting a YOLO agent asks
    hub,
    did: `turned @${name} ${word}${inWs(hub, mine)}`,
    run: () => {
      hub.update([name], { off: !on })
      return `@${name} is ${word}`
    },
  }
}

const MODE_WORDS = {
  off: 'Agent tools are off: the user turned them off in CLIque (⋯ › Agent tools), so none of these work. Ask the user to do it in the app instead.',
  ask: 'Every change waits for the user to allow it in CLIque: your command waits for their answer.',
  auto: 'Changes go through right away. Removing something, linking a computer, and starting or changing a YOLO agent still wait for the user to allow them.',
}

// `crew app help`, as things are now.
export function help(mode) {
  const line = (key) => `  ${usage(key)}\n      ${TOOLS[key].about}${TOOLS[key].risky ? ' (always asks the user first)' : ''}`
  const keys = Object.keys(TOOLS)
  return `crew app: change CLIque itself, when the user asks you to. ${MODE_WORDS[mode]}
To look (never asks):
${keys.filter((k) => TOOLS[k].read).map((k) => `  crew app ${k.padEnd(12)} ${TOOLS[k].about}`).join('\n')}
To change:
${keys.filter((k) => !TOOLS[k].read).map(line).join('\n')}
Agents and channels are your workspace's unless you add --in <workspace>. Names are lowercase words (ada, ios-release).
`
}

export const offText = () => MODE_WORDS.off

// What an agent asking in the chat says about it: "wants to add a channel".
export const alertOf = (plan) => `wants to ${lowerFirst(plan.title)}`


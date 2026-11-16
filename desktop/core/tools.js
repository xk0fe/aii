// Agent tools: what an agent can change about CLIque itself, by running `clique app …` in its shell (bin/clique, the /app
// route in core/server.js). Adding an agent, a channel or a workspace, linking a computer: what you'd do in the app,
// done by an agent you asked to. How far they go is yours to say ("tools" in config.json, the Agent tools sheet):
//   off    agents can't use them
//   ask    every change waits for your OK: a card in the chat, like a permission prompt's (the default)
//   auto   changes go through right away and say so in the chat. What can't be undone (removing), what lets another
//          computer in (linking) and a YOLO agent still ask.
// Looking (clique app agents, workspaces, …) never asks. This isn't a sandbox: an agent runs as you and could edit
// config.json itself. It's the way an agent asks before it changes your app, and the way you say yes or no.
// Clique.tool runs them: core/clique.js. No Electron in here.
import { SYSTEM_AGENT_CHOICES } from './system-agent.js'
import path from 'node:path'
import { GENERAL, channelName, checkLook, named, sharedNames, workspacesIn } from './workspaces.js'
import { isOffered } from './providers.js'
import { readCode } from './link.js'
import { folderInfo } from './move.js'
import { ruleFromWords, ruleText, whenText, nextRun, scheduleLine, inRepo } from './schedules.js'

export const MODES = ['off', 'ask', 'auto']
export const toolMode = (config) => (MODES.includes(config?.tools) ? config.tools : 'ask')

// ---- reading the words ----------------------------------------------------------------------------------------

// `clique app <what> [words] [--flag value]`: which tool, the words naming what it's for, its flags. A flag's value is
// the word after it (--area "QA for checkout") or after = (--area=QA); a switch (--clique) takes none.
// -> { help: true } or { key, tool, name, flags }
export function parse(words) {
  words = words.map(String)
  while (words.length && !words[0].trim()) words.shift() // `clique app` alone sends one empty word
  const [w0 = '', w1 = ''] = words.map((w) => w.trim().toLowerCase())
  if (!w0 || ['help', '--help', '-h'].includes(w0)) return { help: true }
  const key = Object.hasOwn(TOOLS, `${w0} ${w1}`) ? `${w0} ${w1}` : Object.hasOwn(TOOLS, w0) ? w0 : null
  if (!key) throw new Error(`there's no clique app ${words.slice(0, 2).join(' ').trim()} (clique app help lists them)`)
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
    if (!kind) throw new Error(`clique app ${key} takes no --${flag}. Use: ${usage(key)}`)
    if (kind === 'switch') flags[flag] = true
    else {
      const value = inline ?? rest[++i]
      if (value === undefined) throw new Error(`--${flag} needs a value. Use: ${usage(key)}`)
      flags[flag] = value
    }
  }
  const name = plain.join(' ').trim()
  if (tool.what && !name) throw new Error(`which ${tool.what}? Use: ${usage(key)}`)
  if (!tool.what && name) throw new Error(`clique app ${key} takes no words. Use: ${usage(key)}`)
  return { key, tool, name, flags }
}

const usage = (key) => `clique app ${key}${TOOLS[key].use ? ` ${TOOLS[key].use}` : ''}`

// "ada, milo" or "@ada @milo" -> ['ada', 'milo']
const names = (v) => [...new Set(String(v ?? '').split(/[\s,]+/).map((n) => n.replace(/^@/, '').trim().toLowerCase()).filter(Boolean))]
// Who a channel is for, as named. Q's in every channel, so naming him adds nothing: a channel only he was in would have
// nobody to work in it.
const membersOf = (hub, list) => {
  const given = names(list).map((n) => agentIn(hub, n))
  const them = given.filter((n) => !hub.agents.get(n)?.system)
  if (given.length && !them.length) throw new Error(`@${given[0]} is in every channel already: name who else it's for`)
  return them
}

const clip = (s, n = 300) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))
const lowerFirst = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1)

// ---- what they're about -----------------------------------------------------------------------------------------

// A workspace on this computer by its name (any case) or id. -> its entry in Clique.workspaces()
function workspaceNamed(clique, raw) {
  const want = String(raw ?? '').trim()
  const all = clique.workspaces()
  const byId = all.find((w) => w.id === want)
  if (byId) return byId
  const byName = all.filter((w) => w.name.toLowerCase() === want.toLowerCase())
  if (byName.length > 1) throw new Error(`${byName.length} workspaces are called ${want}: give its id instead (clique app workspaces)`)
  if (!byName.length) throw new Error(`there's no workspace called ${want} (clique app workspaces lists them)`)
  return byName[0]
}

// The hub a tool works in: the caller's workspace, or the one --in names.
function hubFor(clique, hub, flags) {
  if (!flags.in) return hub
  return clique.hubs.get(workspaceNamed(clique, flags.in).id)
}

// A linked computer's workspace is changed on that computer: here it only shows.
function notHosted(clique, w, what) {
  const owner = clique.ownerOf(w.id)
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
  if (!hub.space.has(name)) throw new Error(`there's no agent called ${name} in ${hub.space.name} (clique who lists them)`)
  return name
}

// A channel of a workspace by its name (with or without #) or id.
function channelIn(hub, raw) {
  const c = hub.channelNamed(raw)
  if (!c) throw new Error(`there's no #${channelName(raw)} in ${hub.space.name} (clique app channels lists them)`)
  return c
}

// The brain an agent runs on: a provider by id or label (claude, Codex, GLM), offered here and ready to run.
function brainOf(hub, raw) {
  const want = String(raw ?? 'claude').trim().toLowerCase()
  const p = Object.values(hub.providers).find((x) => x.id.toLowerCase() === want || String(x.label).toLowerCase() === want)
  const offered = Object.values(hub.providers).filter((x) => isOffered(x.id, hub.config)).map((x) => x.id)
  if (!p || !isOffered(p.id, hub.config)) throw new Error(`there's no brain called ${raw}: it's one of ${offered.join(', ')} (clique app brains)`)
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
const yoloOf = (clique, name) => Boolean(named(clique.config.data.agents).find((a) => a.name === name)?.yolo)

// Your shared agents, who can work in any workspace.
const rosterOf = (clique) => named(clique.config.data.agents).map((a) => a.name)

function rosterNames(clique, raw) {
  const roster = new Set(rosterOf(clique))
  const list = names(raw)
  const unknown = list.filter((n) => !roster.has(n))
  if (unknown.length) throw new Error(`${unknown.map((n) => `@${n}`).join(', ')} ${unknown.length > 1 ? "aren't" : "isn't"} one of your agents (clique app agents lists them)`)
  return list
}

const brainText = (hub, a) => [hub.providers[a.provider ?? a.cli ?? 'claude']?.label, a.model, a.effort].filter(Boolean).join(' ')

// The fields an agent's card shows, old → new for a change.
const FIELD_NAMES = { name: 'name', area: 'job', provider: 'brain', model: 'model', effort: 'effort', tier: 'Fast mode', cwd: 'folder', prompt: 'instructions', yolo: 'YOLO' }
const shown = (k, v) => (v === undefined || v === '' ? '(none)' : k === 'yolo' ? (v ? 'on' : 'off') : k === 'prompt' ? clip(String(v).replace(/\s+/g, ' '), 80) : String(v))

// ---- the tools ------------------------------------------------------------------------------------------------
// Each one's plan({ clique, hub, from }, call) checks what it can now (a wrong name fails before anyone is asked) and
// says what the card shows: { title, code?, detail?, say, risky?, run }. run() makes the change and says what it did
// (to the agent), and did is what the chat says it did when it went through without asking. A read tool's run() is
// what it prints.

const AGENT_FLAGS = { area: 'value', brain: 'value', model: 'value', effort: 'value', folder: 'value', prompt: 'value', in: 'value' }

export const TOOLS = {
  agents: {
    group: 'look', about: 'your agents: their jobs, brains, and the workspaces each works in', read: true,
    plan: ({ clique, hub }) => ({
      run: () => {
        const data = clique.config.data
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
    plan: ({ clique, hub }, { flags }) => {
      const h = hubFor(clique, hub, flags)
      return { run: () => h.channelsText() }
    },
  },
  workspaces: {
    group: 'look', about: 'your workspaces: their folders, who works in each, which are asleep', read: true,
    plan: ({ clique, hub }) => ({
      run: () => `${clique.workspaces().map((w) => {
        const bits = [`id ${w.id}`, w.folder, w.ownerName && `hosted on ${w.ownerName}`, w.members?.length && w.members.map((m) => `@${m.name}`).join(' '), w.parked && 'asleep', w.id === hub.ws && "you're here"]
        return `${w.name.padEnd(20)} ${bits.filter(Boolean).join(' · ')}`
      }).join('\n')}\n`,
    }),
  },
  schedules: {
    group: 'look', about: "this workspace's scheduled messages: when each goes out next, and how its last run went", read: true, flags: { in: 'value' },
    plan: ({ clique, hub }, { flags }) => {
      const h = hubFor(clique, hub, flags)
      return { run: () => (h.schedules.all.length ? `${h.schedules.view().map((x) => scheduleLine(x)).join('\n')}\n` : '(nothing scheduled)\n') }
    },
  },
  computers: {
    group: 'look', about: 'this computer and the computers linked to it', read: true,
    plan: ({ clique }) => ({
      run: () => {
        const c = clique.computers()
        const rows = [`${c.me.name.padEnd(20)} this computer${c.me.sharing ? ', letting computers link with its code' : ''}`]
        for (const l of c.links) rows.push(`${l.name.padEnd(20)} linked, ${l.online ? 'online' : 'offline'}`)
        return `${rows.join('\n')}\n`
      },
    }),
  },

  'agent add': {
    group: 'agents', what: 'name', about: "a new agent, the workspace's own; --clique makes it one of your agents, who can work in any workspace",
    use: '<name> --area "<its job>" [--brain claude|codex|…] [--model <m>] [--effort <e>] [--folder <dir>] [--prompt "<instructions>"] [--clique] [--off] [--yolo] [--in <workspace>]',
    flags: { ...AGENT_FLAGS, clique: 'switch', off: 'switch', yolo: 'switch' },
    plan: ({ clique, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(clique, mine, flags)
      notHosted(clique, { id: hub.ws, name: hub.space.name }, 'agents')
      const shared = Boolean(flags.clique)
      const name = hub.freeName(raw, shared ? (n) => hub.agents.has(n) || sharedNames(hub.config, n).has(n) : undefined)
      const brain = brainOf(hub, flags.brain)
      const effort = effortOf(brain, flags.effort)
      const cwd = folderOf(flags.folder)
      const area = String(flags.area ?? '').trim()
      const prompt = String(flags.prompt ?? '').trim()
      const where = shared ? `joins your clique and works in ${hub.space.name}` : `only ${hub.space.name} has it`
      return {
        title: 'Add an agent',
        code: [`@${name}${area ? ` · ${area}` : ''}`, [brain.label, flags.model, effort, cwd].filter(Boolean).join(' · '), flags.yolo && 'YOLO: runs every command without asking'].filter(Boolean).join('\n'),
        detail: `${where[0].toUpperCase()}${where.slice(1)}, and ${flags.off ? 'starts off' : 'starts when it gets work'}.${prompt ? ` Instructions: ${clip(prompt)}` : ''}`,
        say: `Can I add a new agent, @${name}${area ? `, for ${clip(area, 60)}` : ''}?`,
        risky: Boolean(flags.yolo),
        hub,
        did: `added a new agent, @${name}${inWs(hub, mine)}`,
        run: () => {
          const made = hub.addAgent({ name, area, prompt, provider: brain.id, model: flags.model, effort, cwd, shared, off: flags.off, yolo: flags.yolo })
          return `added @${made}${hub !== mine ? ` in ${hub.space.name}` : ''}${flags.off ? `, off (clique app agent on ${made} turns it on)` : ', ready for work'}`
        },
      }
    },
  },
  'agent edit': {
    group: 'agents', what: 'agent', about: "change an agent's name, job, brain, folder or instructions",
    use: '<name> [--name <new>] [--area "…"] [--brain …] [--model …] [--effort …] [--folder <dir>] [--prompt "…"] [--yolo | --no-yolo] [--in <workspace>]',
    flags: { ...AGENT_FLAGS, name: 'value', yolo: 'switch', 'no-yolo': 'switch' },
    plan: ({ clique, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(clique, mine, flags)
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
      if (a.system && changed.some((k) => !SYSTEM_AGENT_CHOICES.has(k))) throw new Error(`@${name} comes with every workspace: only its brain, model and effort can change`)
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
    plan: ({ clique, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(clique, mine, flags)
      const name = agentIn(hub, raw)
      if (hub.agents.get(name)?.system) throw new Error(`@${name} comes with every workspace, so it can't be removed. Turn it off with: clique app agent off ${name}`)
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
    plan: ({ clique, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(clique, mine, flags)
      notHosted(clique, { id: hub.ws, name: hub.space.name }, 'channels')
      const name = channelName(raw)
      if (!name) throw new Error('give the channel a name')
      if (hub.space.channels.some((c) => c.name === name)) throw new Error(`there's a #${name} already`)
      const members = membersOf(hub, flags.members)
      const brief = String(flags.brief ?? '').trim()
      return {
        title: `Add a channel${inWs(hub, mine)}`,
        code: `#${name}${brief ? `\n${clip(brief, 600)}` : ''}`,
        detail: members.length ? `For ${members.map((n) => `@${n}`).join(', ')}` : `Everyone in ${hub.space.name} is in it`,
        say: `Can I add a #${name} channel${inWs(hub, mine)}?`,
        hub,
        did: `added the #${name} channel${inWs(hub, mine)}`,
        run: () => {
          clique.channelAction('create', null, { name, brief, ...(members.length && { members }) }, hub.ws)
          return `added #${name}${hub !== mine ? ` in ${hub.space.name}` : ''}`
        },
      }
    },
  },
  'channel edit': {
    group: 'channels', what: 'channel', about: "change a channel's name, brief or members (--members everyone: all of them)",
    use: '<name> [--name <new>] [--brief "…"] [--members a,b | --members everyone] [--in <workspace>]', flags: { name: 'value', brief: 'value', members: 'value', in: 'value' },
    plan: ({ clique, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(clique, mine, flags)
      notHosted(clique, { id: hub.ws, name: hub.space.name }, 'channels')
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
        patch.members = everyone ? [] : membersOf(hub, flags.members)
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
          clique.channelAction('edit', c.id, patch, hub.ws)
          return `changed #${patch.name ?? c.name}`
        },
      }
    },
  },
  'channel remove': {
    group: 'channels', what: 'channel', risky: true, about: 'remove a channel (its messages stay, under #general)', use: '<name> [--in <workspace>]', flags: { in: 'value' },
    plan: ({ clique, hub: mine }, { name: raw, flags }) => {
      const hub = hubFor(clique, mine, flags)
      notHosted(clique, { id: hub.ws, name: hub.space.name }, 'channels')
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
          clique.channelAction('remove', c.id, null, hub.ws)
          return `removed #${c.name}`
        },
      }
    },
  },

  'workspace add': {
    group: 'workspaces', what: 'name', about: 'a new workspace, with your agents who work in it. It opens in the background: the screen stays where it is',
    use: '<name> [--folder <dir>] [--members a,b] [--icon <emoji>] [--color <color>]', flags: { folder: 'value', members: 'value', icon: 'value', color: 'value' },
    plan: ({ clique }, { name, flags }) => {
      if (clique.workspaces().some((w) => w.name.toLowerCase() === name.toLowerCase())) throw new Error(`there's a workspace called ${name} already`)
      const folder = folderOf(flags.folder)
      const members = rosterNames(clique, flags.members)
      checkLook({ color: flags.color })
      const yolo = members.filter((n) => yoloOf(clique, n))
      return {
        title: 'Add a workspace',
        code: [`${flags.icon ? `${flags.icon} ` : ''}${name}`, folder].filter(Boolean).join('\n'),
        detail: members.length ? `${members.map((n) => `@${n}`).join(', ')} work${members.length === 1 ? 's' : ''} there.` : 'No agents in it yet.',
        say: `Can I make a workspace called ${name}?`,
        risky: yolo.length > 0, // a YOLO agent starting work somewhere new
        did: `made the ${name} workspace`,
        run: () => {
          const { id } = clique.workspaceAction('create', null, { name, folder, members, icon: flags.icon, color: flags.color, show: false })
          return `made the workspace ${name} (id ${id})${members.length ? `: ${members.map((n) => `@${n}`).join(', ')} work${members.length === 1 ? 's' : ''} there` : ''}`
        },
      }
    },
  },
  'workspace edit': {
    group: 'workspaces', what: 'workspace', about: "change a workspace's name, folder, icon or color",
    use: '<name> [--name <new>] [--folder <dir>] [--icon <emoji>] [--color <color>]', flags: { name: 'value', folder: 'value', icon: 'value', color: 'value' },
    plan: ({ clique }, { name: raw, flags }) => {
      const w = workspaceNamed(clique, raw)
      notHosted(clique, w, 'settings')
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
          clique.workspaceAction('edit', w.id, patch)
          return `changed ${patch.name || w.name}`
        },
      }
    },
  },
  'workspace members': {
    group: 'workspaces', what: 'workspace', about: 'which of your agents work in a workspace', use: '<name> [--add a,b] [--remove a,b]', flags: { add: 'value', remove: 'value' },
    plan: ({ clique }, { name: raw, flags }) => {
      const w = workspaceNamed(clique, raw)
      const add = rosterNames(clique, flags.add).filter((n) => !w.members.some((m) => m.name === n))
      const remove = names(flags.remove).filter((n) => w.members.some((m) => m.name === n))
      if (!add.length && !remove.length) throw new Error(`nothing to change: ${flags.add || flags.remove ? `that's how ${w.name} is already` : `say who, e.g. ${usage('workspace members')}`}`)
      const lines = [add.length && `in: ${add.map((n) => `@${n}`).join(', ')}`, remove.length && `out: ${remove.map((n) => `@${n}`).join(', ')}`].filter(Boolean)
      return {
        risky: add.some((n) => yoloOf(clique, n)), // a YOLO agent starting work somewhere new
        title: `Change who works in ${w.name}`,
        code: lines.join('\n'),
        detail: remove.length ? 'Agents taken out stop there, and stay your agents everywhere else.' : '',
        say: `Can I change who works in ${w.name}?`,
        did: `changed who works in ${w.name}: ${lines.join(', ')}`,
        run: () => {
          clique.workspaceAction('members', w.id, { add, remove })
          return `${w.name}: ${lines.join(', ')}`
        },
      }
    },
  },
  'workspace sleep': {
    group: 'workspaces', what: 'workspace', about: "put a workspace to sleep: its agents stop, and pick up where they left off when it wakes", use: '<name>',
    plan: ({ clique, hub }, { name: raw }) => {
      const w = workspaceNamed(clique, raw)
      if (w.parked) throw new Error(`${w.name} is asleep already`)
      return {
        title: `Put ${w.name} to sleep`,
        code: w.name,
        detail: `Its agents stop${w.id === hub.ws ? ', you too' : ''}, and pick up their conversations when it wakes.`,
        say: `Can I put ${w.name} to sleep?`,
        did: `put ${w.name} to sleep`,
        run: () => {
          clique.workspaceAction('park', w.id)
          return `${w.name} is asleep`
        },
      }
    },
  },
  'workspace wake': {
    group: 'workspaces', what: 'workspace', about: 'wake a workspace that is asleep: its agents take work again', use: '<name>',
    plan: ({ clique }, { name: raw }) => {
      const w = workspaceNamed(clique, raw)
      if (!w.parked) throw new Error(`${w.name} is awake already`)
      return {
        title: `Wake ${w.name}`,
        code: w.name,
        say: `Can I wake ${w.name}?`,
        did: `woke ${w.name}`,
        run: () => {
          clique.workspaceAction('open', w.id)
          return `${w.name} is awake`
        },
      }
    },
  },
  'workspace remove': {
    group: 'workspaces', what: 'workspace', risky: true, about: 'remove a workspace (its chat, notes and tasks stay on disk)', use: '<name>',
    plan: ({ clique, hub }, { name: raw }) => {
      const w = workspaceNamed(clique, raw)
      const owner = clique.ownerOf(w.id)
      const own = (workspacesIn(clique.config.data).find((x) => x.id === w.id)?.agents ?? []).filter((a) => a?.name).length
      return {
        title: owner.owner ? `Hide ${w.name} on this computer` : `Remove ${w.name}`,
        code: w.name,
        detail: owner.owner
          ? `It's ${owner.ownerName}'s, and stays there with its chat, tasks and agents. Your agents in it stop here.`
          : `Its agents stop${w.id === hub.ws ? ', you too' : ''}.${own ? ` ${own} agent${own > 1 ? 's' : ''} of its own go${own > 1 ? '' : 'es'} with it.` : ''} Its chat, notes and tasks stay on disk: a workspace made again with the same name picks them back up.`,
        say: owner.owner ? `Can I hide ${w.name} on this computer?` : `Can I remove the ${w.name} workspace?`,
        did: owner.owner ? `hid ${w.name}` : `removed the ${w.name} workspace`,
        run: () => {
          clique.workspaceAction('remove', w.id)
          return owner.owner ? `${w.name} is hidden here` : `removed ${w.name}`
        },
      }
    },
  },

  // Scheduled messages (core/schedules.js): a message from the user to an agent or a channel, sent at a time, once or
  // on a repeat. A run of one can't make more: what a schedule sets off doesn't get to set off schedules.
  'schedule add': {
    group: 'schedules', what: 'message', about: "send a message for the user later, or on a repeat: to an agent, or to whoever fits. It goes out as theirs, at the computer's local time",
    use: '"<message>" --at <9:00> [--every day|weekday|<monday…>] [--on today|tomorrow|<monday…>|<2026-11-17>] [--to a,b] [--channel <name>] [--if-changed] [--in <workspace>]',
    flags: { at: 'value', every: 'value', on: 'value', to: 'value', channel: 'value', 'if-changed': 'switch', in: 'value' },
    plan: ({ clique, hub: mine, from }, { name: text, flags }) => {
      noScheduleFromRun(mine, from)
      const hub = hubFor(clique, mine, flags)
      if (flags.at === undefined) throw new Error(`say when: --at 9:00. Use: ${usage('schedule add')}`)
      const now = clique.clock()
      const rule = ruleFromWords(flags, now)
      const to = names(flags.to).map((n) => clique.resolve(n, hub))
      const off = to.filter((n) => hub.agents.get(n)?.off)
      if (off.length) throw new Error(`@${off[0]} is turned off: turn it on first (clique app agent on ${off[0]})`)
      const c = flags.channel !== undefined ? channelIn(hub, flags.channel) : null
      if (flags['if-changed'] && rule.repeat === 'once') throw new Error('--if-changed is for a message that repeats (--every …)')
      if (flags['if-changed'] && !inRepo(hub.space.folder)) throw new Error(`--if-changed goes by git, and ${hub.space.name}'s folder isn't in a git repo`)
      const fields = { text, to: to.join(','), ...(c && c.id !== GENERAL && { channel: c.id }), ...rule, ...(flags['if-changed'] && { ifChanged: true }) }
      hub.schedules.fields(fields) // the words themselves
      const twin = hub.schedules.all.find((x) => x.text.replace(/\s+/g, ' ').trim().toLowerCase() === text.replace(/\s+/g, ' ').trim().toLowerCase() && x.to === [...to].sort().join(',') && (x.channel ?? '') === (fields.channel ?? '') && ruleText(x) === ruleText(rule))
      if (twin && Boolean(twin.ifChanged) === Boolean(fields.ifChanged)) throw new Error(twin.paused ? `that's scheduled already (${twin.id}, ${ruleText(twin)}) and paused, so nothing was added: clique app schedule resume ${twin.id} starts it again` : `that's scheduled already (${twin.id}, ${ruleText(twin)}): it's kept as it is, and nothing was added`)
      const who = to.length ? to.map((n) => `@${n}`).join(' ') : 'whoever fits'
      const where = `${who}${c && c.id !== GENERAL ? ` in #${c.name}` : ''}${inWs(hub, mine)}`
      return {
        title: 'Schedule a message',
        code: [`${upFirst(ruleText(rule))} · to ${where}`, clip(text, 600)].join('\n'),
        detail: `It goes out as a message from you${rule.repeat === 'once' ? '' : `, first on ${whenText(nextRun(rule, now), undefined)}`}.${fields.ifChanged ? ' Only when the repo has changed since its last run.' : ''} Pause or remove it under Scheduled messages.`,
        say: `Can I schedule a message to ${where}, ${ruleText(rule)}?`,
        // a YOLO agent runs whatever it's sent without asking: sending it things on a timer asks
        risky: yoloGets(hub, to, text),
        hub,
        did: `scheduled a message to ${where}, ${ruleText(rule)}`,
        run: async () => {
          const made = await clique.scheduleAction('add', null, fields, hub.ws, { by: from })
          return made.same ? `that was scheduled already (${made.id})${made.same === 'paused' ? ', and is paused' : ''}: kept as it is` : `scheduled (${made.id}): ${ruleText(rule)}, to ${where}. It goes out next on ${whenText(hub.schedules.get(made.id).next)}`
        },
      }
    },
  },
  'schedule pause': {
    group: 'schedules', what: 'schedule', about: 'pause a scheduled message (its id: clique app schedules)', use: '<id> [--in <workspace>]', flags: { in: 'value' },
    plan: (ctx, call) => pauseSchedule(ctx, call, true),
  },
  'schedule resume': {
    group: 'schedules', what: 'schedule', about: 'let a paused scheduled message run again, from its next time', use: '<id> [--in <workspace>]', flags: { in: 'value' },
    plan: (ctx, call) => pauseSchedule(ctx, call, false),
  },
  'schedule remove': {
    group: 'schedules', what: 'schedule', risky: true, about: 'remove a scheduled message', use: '<id> [--in <workspace>]', flags: { in: 'value' },
    plan: ({ clique, hub: mine }, { name: id, flags }) => {
      const hub = hubFor(clique, mine, flags)
      const x = hub.schedules.get(id)
      return {
        title: `Remove a scheduled message${inWs(hub, mine)}`,
        code: scheduleCode(x),
        detail: "It won't go out again.",
        say: `Can I remove the scheduled message "${clip(x.text.replace(/\s+/g, ' '), 60)}"${inWs(hub, mine)}?`,
        hub,
        did: `removed a scheduled message${inWs(hub, mine)}`,
        run: async () => {
          await clique.scheduleAction('remove', x.id, null, hub.ws)
          return `removed ${x.id}`
        },
      }
    },
  },

  link: {
    group: 'computers', what: 'code', risky: true, about: "link this computer with another, by the code the other one's Computers sheet shows (clique1.…)", use: '<code>',
    plan: ({ clique }, { name: code }) => {
      const info = readCode(code)
      const linked = [...clique.links.values()].find((l) => l.code === code.trim())
      if (linked) throw new Error(`this computer is linked with ${linked.name ?? info.name} already`)
      return {
        title: `Link with ${info.name}`,
        code: info.name,
        detail: `Linked, the two computers use each other's agents: each can send them work, see their chat and their terminals.`,
        say: `Can I link this computer with ${info.name}?`,
        did: `linked this computer with ${info.name}`,
        run: async () => {
          await clique.connect(code)
          return `linked with ${info.name}`
        },
      }
    },
  },
  unlink: {
    group: 'computers', what: 'computer', risky: true, about: 'unlink a linked computer', use: '<computer>',
    plan: ({ clique }, { name: raw }) => {
      const want = String(raw).trim().toLowerCase()
      const l = [...clique.links.values()].find((x) => x.slug === want || String(x.name ?? '').toLowerCase() === want)
      if (!l) throw new Error(`this computer isn't linked with ${raw} (clique app computers lists them)`)
      return {
        title: `Unlink ${l.name ?? l.slug}`,
        code: l.name ?? l.slug,
        detail: 'Its agents leave this computer, and yours leave it. Linking again takes a new code.',
        say: `Can I unlink ${l.name ?? l.slug}?`,
        did: `unlinked ${l.name ?? l.slug}`,
        run: () => {
          clique.forget(l.slug)
          return `unlinked ${l.name ?? l.slug}`
        },
      }
    },
  },
}

const upFirst = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1)
const scheduleCode = (x) => [`${upFirst(ruleText(x))} · to ${x.to ? x.to.split(',').map((n) => `@${n}`).join(' ') : 'whoever fits'}${x.channel ? ` in #${x.channel}` : ''}`, clip(x.text, 600)].join('\n')

// Could a YOLO agent get it? One named (--to, or @named in the words: that's who it goes to as well), or, with nobody
// named, any that's here to be picked. A YOLO agent runs whatever it's sent without asking: sending it things on a
// timer asks first.
function yoloGets(hub, to, text) {
  const all = [...hub.agents.values()].filter((x) => x.yolo && !x.cloneOf)
  const said = all.filter((x) => new RegExp(`(^|[^\\w.@/'-])@${x.name}(?![\\w-])`, 'i').test(text))
  if (to.some((n) => hub.agents.get(n)?.yolo) || said.length) return true
  const named = to.length > 0 || [...hub.agents.values()].some((x) => new RegExp(`(^|[^\\w.@/'-])@${x.name}(?![\\w-])`, 'i').test(text))
  return !named && all.some((x) => !x.off)
}

// What a scheduled message set off can't schedule more (nor start a paused one again).
function noScheduleFromRun(hub, from) {
  if (hub.inScheduledRun(from)) throw new Error("this turn came from a scheduled message, and a scheduled run can't set up schedules. Tell the user what you'd schedule instead")
}

function pauseSchedule({ clique, hub: mine, from }, { name: id, flags }, paused) {
  if (!paused) noScheduleFromRun(mine, from)
  const hub = hubFor(clique, mine, flags)
  const x = hub.schedules.get(id)
  if (Boolean(x.paused) === paused) throw new Error(`${x.id} is ${paused ? 'paused' : 'running'} already`)
  if (!paused && nextRun(x, clique.clock()) === null) throw new Error(`${x.id}'s time has passed: the user can send it now or change it under Scheduled messages`)
  return {
    title: `${paused ? 'Pause' : 'Resume'} a scheduled message${inWs(hub, mine)}`,
    code: scheduleCode(x),
    detail: paused ? 'It keeps its place and sends nothing until it runs again.' : `It goes out next on ${whenText(nextRun(x, clique.clock()))}.`,
    say: `Can I ${paused ? 'pause' : 'resume'} the scheduled message "${clip(x.text.replace(/\s+/g, ' '), 60)}"${inWs(hub, mine)}?`,
    risky: !paused && yoloGets(hub, x.to ? x.to.split(',') : [], x.text),
    hub,
    did: `${paused ? 'paused' : 'resumed'} a scheduled message${inWs(hub, mine)}`,
    run: async () => {
      await clique.scheduleAction(paused ? 'pause' : 'resume', x.id, null, hub.ws)
      return `${x.id} is ${paused ? 'paused' : 'running again'}`
    },
  }
}

function onOff({ clique, hub: mine }, { name: raw, flags }, on) {
  const hub = hubFor(clique, mine, flags)
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

// `clique app help`, as things are now.
export function help(mode) {
  const line = (key) => `  ${usage(key)}\n      ${TOOLS[key].about}${TOOLS[key].risky ? ' (always asks the user first)' : ''}`
  const keys = Object.keys(TOOLS)
  return `clique app: change CLIque itself, when the user asks you to. ${MODE_WORDS[mode]}
To look (never asks):
${keys.filter((k) => TOOLS[k].read).map((k) => `  clique app ${k.padEnd(12)} ${TOOLS[k].about}`).join('\n')}
To change:
${keys.filter((k) => !TOOLS[k].read).map(line).join('\n')}
Agents, channels and scheduled messages are your workspace's unless you add --in <workspace>. Names are lowercase words (ada, ios-release).
`
}

export const offText = () => MODE_WORDS.off

// What an agent asking in the chat says about it: "wants to add a channel".
export const alertOf = (plan) => `wants to ${lowerFirst(plan.title)}`


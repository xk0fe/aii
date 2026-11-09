// Agent packs: agents as a portable .crew file. Everything that defines an agent travels (area, instructions,
// reference images, brain, flags, look, and any custom provider it needs); nothing that belongs to one machine
// does (folder paths, sessions). Work experience only travels when an agent moves between your own computers.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BUILT_IN } from './providers.js'
import { MAX_CLONES } from './hub.js'
import { ROOT, space } from './workspaces.js'

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const expand = (dir) => (dir ? dir.replace(/^~(?=[\\/]|$)/, os.homedir()) : os.homedir()) // ~/code, or ~\code on Windows

export function packAgents(hub, names, { stats = false } = {}) {
  // (Q comes with every workspace: he isn't yours to pack)
  const agents = names.filter((name) => !hub.agents?.get(name)?.system).map((name) => {
    const c = space(hub.config, hub.ws ?? ROOT)?.agents.find((a) => a.name === name) // as it is in its workspace (its folder there)
    if (!c) throw new Error(`no agent named "${name}"`)
    return {
      name: c.name,
      area: c.area,
      prompt: c.prompt,
      provider: c.provider ?? c.cli ?? 'claude',
      model: c.model,
      effort: c.effort,
      tier: c.tier,
      yolo: c.yolo,
      contextLimit: c.contextLimit,
      onContextLimit: c.onContextLimit,
      clones: c.clones,
      args: c.args,
      avatar: { seed: c.avatar?.seed ?? c.name, ...c.avatar }, // looks partly come from the name: keep them if it's renamed
      folder: c.cwd ? path.basename(expand(c.cwd)) : undefined, // a hint for whoever imports it
      images: (c.images ?? []).flatMap((file) => {
        try {
          return [{ type: MIME[path.extname(file).toLowerCase()] ?? 'image/png', data: fs.readFileSync(file).toString('base64') }]
        } catch {
          return []
        }
      }),
      ...(stats && hub.stats[name] && { stats: hub.stats[name] }),
    }
  })
  const providers = Object.fromEntries(
    [...new Set(agents.map((a) => a.provider))].filter((id) => !BUILT_IN[id] && hub.config.providers?.[id]).map((id) => [id, hub.config.providers[id]]),
  )
  return JSON.parse(JSON.stringify({ crew: 1, exported: new Date().toISOString(), agents, ...(Object.keys(providers).length && { providers }) }))
}

export function readPack(text) {
  let pack
  try {
    pack = JSON.parse(text)
  } catch {
    throw new Error("that file isn't a CLIque agent pack")
  }
  if (pack?.crew !== 1 || !Array.isArray(pack.agents)) throw new Error("that file isn't a CLIque agent pack")
  return pack
}

// choices: [{ index, name, folder, on, shared }] — which agents to take, what to call them here, where they work, and
// whether it's one of your shared agents or only that workspace's.
export function unpackAgents(hub, pack, choices) {
  if (pack.providers) hub.config.providers = { ...pack.providers, ...hub.config.providers } // never replaces yours
  return choices.map((choice) => {
    const a = pack.agents[choice.index]
    if (!a) throw new Error('that agent is not in the pack')
    const images = (a.images ?? []).map((im) => hub.saveImage('reference', im.type, Buffer.from(im.data, 'base64')))
    const name = hub.addAgent({
      name: choice.name || a.name,
      area: a.area,
      prompt: a.prompt,
      images,
      provider: a.provider,
      model: a.model,
      effort: a.effort,
      tier: a.tier,
      yolo: a.yolo,
      contextLimit: Number(a.contextLimit) > 0 ? Number(a.contextLimit) : undefined,
      onContextLimit: a.onContextLimit === 'notify' ? 'notify' : undefined,
      clones: Math.min(Math.max(0, Math.floor(Number(a.clones) || 0)), MAX_CLONES) || undefined,
      args: (a.args ?? []).join(' '),
      avatar: a.avatar,
      cwd: choice.folder,
      off: !choice.on,
      ...(choice.shared && { shared: true }),
    })
    if (a.stats && typeof a.stats === 'object') {
      hub.stats[name] = { ...a.stats, days: { ...a.stats.days } }
      hub.saveStats()
    }
    return name
  })
}

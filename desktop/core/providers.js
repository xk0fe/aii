// Where an agent's brain comes from. A provider = which CLI adapter runs it (claude or codex),
// plus optional env/args, and the model + effort menus the editor offers.
// Add your own under "providers" in config.json; same shape as these, and they override built-ins by id.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveCommand } from './launch.js'

export const BUILT_IN = {
  claude: {
    label: 'Claude',
    cli: 'claude',
    models: ['fable', 'opus', 'sonnet', 'haiku'],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  codex: {
    label: 'Codex',
    cli: 'codex',
    models: [], // filled from `codex debug models` at startup
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  // Z.ai's Anthropic-compatible endpoint, driven by Claude Code. Needs ZAI_API_KEY in your shell env.
  glm: {
    label: 'GLM',
    cli: 'claude',
    env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: '${ZAI_API_KEY}' },
    needs: ['ZAI_API_KEY'],
    models: ['glm-5.1', 'glm-5-turbo', 'glm-4.7'],
    efforts: [],
  },
  // Open-weight models on your machine through Ollama, driven by Codex.
  local: {
    label: 'Ollama',
    cli: 'codex',
    args: ['--oss', '--local-provider', 'ollama'],
    models: ['gpt-oss:20b', 'gpt-oss:120b', 'qwen3-coder'],
    efforts: [],
  },
}

export function providersFrom(config, discovered = {}) {
  const all = {}
  for (const [id, p] of Object.entries({ ...BUILT_IN, ...config.providers })) {
    const found = discovered[id] ?? {}
    all[id] = { id, label: id, models: [], efforts: [], ...p, ...found, missing: (p.needs ?? []).filter((v) => !process.env[v]) }
  }
  return all
}

// "${VAR}" in provider env values comes from your environment, so keys never live in config.json.
export const expandEnv = (env = {}) =>
  Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v).replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')]))

// Codex knows its own model catalog, including which reasoning efforts each model supports.
export function discoverCodex() {
  return new Promise((resolve) => {
    let codex
    try {
      codex = resolveCommand('codex', ['debug', 'models']) // on Windows the program behind npm's codex.cmd
    } catch {
      return resolve(null)
    }
    const done = (err, stdout) => {
      if (err) return resolve(null)
      try {
        const list = JSON.parse(stdout).models ?? []
        const visible = list.filter((m) => m.visibility === 'list')
        const efforts = (m) => (m.supported_reasoning_levels ?? []).map((e) => e.effort ?? e)
        // Fast mode is Codex's "fast" service tier; agents without a setting follow your config.toml.
        let tier = 'default'
        try {
          tier = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8').match(/^service_tier\s*=\s*"(\w+)"/m)?.[1] ?? 'default'
        } catch {}
        resolve({
          models: visible.map((m) => m.slug),
          modelEfforts: Object.fromEntries(visible.map((m) => [m.slug, efforts(m)])),
          fastByDefault: tier === 'fast',
        })
      } catch {
        resolve(null)
      }
    }
    // a codex that isn't a program the system can start (an empty or broken codex.exe on PATH) throws right here
    // rather than calling back, which took CLIque's start down with it
    try {
      execFile(codex.file, codex.args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, done)
    } catch (e) {
      done(e)
    }
  })
}

// ---- which providers the model picker offers --------------------------------------------------------------------
// Claude and Codex always, and providers of your own (config.json "providers"). GLM and Ollama wait behind "Add
// provider…" until you add one (config.json "addedProviders": ["glm"]); one an agent of yours already runs on (a shared
// agent's, or a workspace's own) counts as added, so it stays where it was.
export const OPTIONAL = ['glm', 'local']

const listOf = (v) => (Array.isArray(v) ? v : [])

// The providers your agents run on, as config.json has them.
export function providersInUse(config) {
  const agents = [...listOf(config.agents), ...listOf(config.workspaces).flatMap((w) => listOf(w?.agents))]
  return new Set(agents.map((a) => a?.provider).filter((id) => typeof id === 'string'))
}

export const isOffered = (id, config) =>
  !OPTIONAL.includes(id) || Object.hasOwn(config.providers ?? {}, id) || listOf(config.addedProviders).includes(id) || providersInUse(config).has(id)

// A snapshot's providers, each saying whether the picker offers it (added) and, for GLM and Ollama, that "Add
// provider…" is where it's added (optional). Providers that came from a linked computer are offered as they are.
export const markOffered = (providers = {}, config = {}) =>
  Object.fromEntries(Object.entries(providers).map(([id, p]) => [id, { ...p, added: isOffered(id, config), ...(OPTIONAL.includes(id) && !Object.hasOwn(config.providers ?? {}, id) && { optional: true }) }]))

// Add provider…: GLM or Ollama in the picker from now on (saved in config.json).
export function addProvider(cfg, id) {
  if (!OPTIONAL.includes(id)) throw new Error('CLIque has no such provider to add')
  const added = listOf(cfg.data.addedProviders)
  if (added.includes(id)) return
  cfg.data.addedProviders = [...added, id]
  cfg.save()
}

// ...and out of it again, once no agent runs on it.
export function removeProvider(cfg, id) {
  if (providersInUse(cfg.data).has(id)) throw new Error(`An agent still runs on ${BUILT_IN[id]?.label ?? id}: give it another model first`)
  const added = listOf(cfg.data.addedProviders)
  if (!added.includes(id)) return
  cfg.data.addedProviders = added.filter((x) => x !== id)
  cfg.save()
}

// Once, as CLIque starts: GLM or Ollama, when an agent runs on it, is written down as added, so it stays in the picker
// after that agent goes. -> whether config.json changed.
export function keepProvidersInUse(cfg) {
  const added = listOf(cfg.data.addedProviders)
  const more = OPTIONAL.filter((id) => providersInUse(cfg.data).has(id) && !added.includes(id))
  if (!more.length) return false
  cfg.data.addedProviders = [...added, ...more]
  cfg.save()
  return true
}

// What GLM or Ollama needs, looked at now (Add provider… says it in words): GLM your Z.ai key in your environment;
// Ollama the Ollama app running on this computer, where Codex reaches it (its port, unless CODEX_OSS_PORT or
// CODEX_OSS_BASE_URL moves it). The CLI each runs through is the first-run check's (core/setup.js).
export async function checkProvider(id, { env = process.env, fetch = globalThis.fetch, timeout = 1500 } = {}) {
  if (id === 'glm') return { id, key: Boolean(env.ZAI_API_KEY) }
  if (id !== 'local') throw new Error('CLIque has no such provider to add')
  const base = String(env.CODEX_OSS_BASE_URL?.trim() || `http://127.0.0.1:${Number(env.CODEX_OSS_PORT) || 11434}`).replace(/\/$/, '').replace(/\/v1$/, '')
  try {
    const res = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(timeout) })
    return { id, running: res.ok }
  } catch {
    return { id, running: false }
  }
}

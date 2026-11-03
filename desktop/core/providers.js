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
    label: 'Local',
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
    // rather than calling back, which took Crew's start down with it
    try {
      execFile(codex.file, codex.args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, done)
    } catch (e) {
      done(e)
    }
  })
}

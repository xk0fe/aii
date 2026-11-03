// Drafts an agent's system prompt with the agent's own brain (Claude or Codex), headless and without tools.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandEnv } from './providers.js'
import { cleanEnv } from './runner.js'
import { resolveCommand } from './launch.js'

const ask = ({ name, area }, teammates) => `Write the system prompt for an AI coding agent called "${name}".
Its area of work: ${area || 'general software work'}.
It works in a crew of agents running side by side in terminals, each owning an area. Teammates: ${teammates || 'none yet'}.

Write it in second person ("You are..."). Cover:
- who it is and exactly what it owns, and what it leaves to teammates
- how it works: the quality bar, conventions to follow, how it checks its own work
- when to hand work to a teammate or ask the user

Under 200 words, concrete and specific to this area. No headings, no preamble, no quotes. Output only the prompt.`

// On Windows: the program behind npm's .cmd, which execFile couldn't start (core/launch.js), and no console window.
const run = (name, argv, opts) =>
  new Promise((resolve, reject) => {
    const { file, args } = resolveCommand(name, argv, opts.env)
    const child = execFile(file, args, { timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim().split('\n').slice(-3).join(' '))) : resolve(stdout),
    )
    child.stdin?.end() // `codex exec` otherwise waits for more prompt on stdin
  })

const tidy = (text) => text.trim().replace(/^```\w*\n?|\n?```$/g, '').replace(/^"([\s\S]*)"$/, '$1').trim()

export async function generatePrompt(agent, provider, teammates) {
  const dir = agent.cwd?.replace(/^~(?=[\\/]|$)/, os.homedir()) // ~/code, or ~\code on Windows
  const cwd = dir && fs.existsSync(dir) ? dir : os.homedir() // run in the project so its CLAUDE.md / AGENTS.md can inform the draft
  const env = cleanEnv({ ...process.env, ...expandEnv(provider.env) })
  const prompt = ask(agent, teammates)

  if (provider.cli === 'codex') {
    const out = path.join(os.tmpdir(), `crew-prompt-${process.pid}-${Date.now()}.txt`)
    await run('codex', ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-o', out,
      ...(agent.model ? ['-m', agent.model] : []), '-c', 'model_reasoning_effort="low"', ...(provider.args ?? []), prompt], { cwd, env })
    const text = fs.readFileSync(out, 'utf8')
    fs.rmSync(out, { force: true })
    return tidy(text)
  }
  return tidy(await run('claude', ['-p', prompt, '--tools', '', '--no-session-persistence', ...(agent.model ? ['--model', agent.model] : [])], { cwd, env }))
}

// One short headless call for a small job Crew does itself (quick triage, core/savers.js): no tools, no MCP servers,
// nothing kept, in an empty folder so no project's instructions come along. Claude on its small model (haiku, or what
// the provider maps it to); Codex on the model given, or its own, at low effort.
// -> { text, cost (USD at API prices, Claude), tokens (all the call read and wrote) }
export async function quickAsk(provider, { prompt, model, timeout = 90000 }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-quick-'))
  const env = cleanEnv({ ...process.env, ...expandEnv(provider.env) })
  try {
    if (provider.cli === 'codex') {
      const out = path.join(cwd, 'answer.txt')
      const log = await run('codex', ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--json', '-o', out,
        ...(model ? ['-m', model] : []), '-c', 'model_reasoning_effort="low"', ...(provider.args ?? []), prompt], { cwd, env, timeout })
      let tokens = 0
      for (const line of log.split('\n')) {
        try {
          const u = JSON.parse(line).usage
          if (u) tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
        } catch {}
      }
      return { text: fs.readFileSync(out, 'utf8'), cost: 0, tokens }
    }
    const r = JSON.parse(await run('claude', ['-p', prompt, '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json', '--model', model || 'haiku'], { cwd, env, timeout }))
    if (r.is_error) throw new Error(String(r.result || 'the call failed'))
    const u = r.usage ?? {}
    return { text: String(r.result ?? ''), cost: Number(r.total_cost_usd) || 0, tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0) }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

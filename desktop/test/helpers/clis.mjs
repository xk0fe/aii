// Loaded before every test file (npm test: node --test --import ./test/helpers/clis.mjs).
//
// On Windows CLIque finds an agent's CLI before it starts it (core/launch.js resolveCommand) and won't start one that
// isn't installed, where macOS hands the name to the terminal as it is. The tests start agents in fake terminals, so
// they mustn't depend on Claude Code or Codex being installed: on Windows stand-ins named claude.exe and codex.exe go
// first on PATH. Nothing runs them (codex debug models, tried by the hub, fails as with no Codex at all).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The token savers (core/savers.js) are off unless a test turns them on (savers.test.js): the suite pins down how the
// clique works without them, and quick triage would otherwise call the real Claude Code.
process.env.CLIQUE_SAVERS ??= 'off'
// Q, the system agent (core/system-agent.js), is in every workspace unless this is off. The suite pins down who's in a
// clique, and who a message goes to, without him; system-agent.test.js turns him on.
process.env.CLIQUE_SYSTEM_AGENT ??= 'off'

if (process.platform === 'win32') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-clis-'))
  for (const name of ['claude.exe', 'codex.exe']) fs.writeFileSync(path.join(dir, name), '')
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path'
  process.env[key] = `${dir};${process.env[key] ?? ''}`
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }))
}

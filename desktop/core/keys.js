// Who is calling CLIque's local server (core/server.js). Each agent has a key of its own, in its environment and nowhere
// else: the server reads who's calling from the key, so an agent can't say it's the user or a teammate by changing a name.
//
// A key is made from the agent's workspace and name and a secret that stays in CLIque's folder (never in an agent's
// environment), so it's the same each time CLIque starts: an agent can outlive the CLIque that started it
// (core/ptyhost.js), and its key still has to count. A renamed agent gets a new one with its new name.
//
// What this is not: a sandbox. Agents run as you, and so can read CLIque's folder like any program of yours. It stops
// an agent from speaking as someone else by accident or because something it read told it to, not one set on doing so.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { HOME } from './home.js'

const FILE = 'agent-secret'
const PREFIX = 'a1.'
const secrets = new Map()

// The secret keys are made from: written once, readable by you alone.
export function secret(home = HOME) {
  if (secrets.has(home)) return secrets.get(home)
  const file = path.join(home, FILE)
  let s = ''
  try {
    s = fs.readFileSync(file, 'utf8').trim()
  } catch {}
  if (!/^[0-9a-f]{64}$/.test(s)) {
    s = crypto.randomBytes(32).toString('hex')
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(file, `${s}\n`, { mode: 0o600 })
    try {
      fs.chmodSync(file, 0o600)
    } catch {}
  }
  secrets.set(home, s)
  return s
}

const sign = (who, home) => crypto.createHmac('sha256', secret(home)).update(who).digest('base64url')

// The key of the agent `name` in workspace `ws`.
export function agentKey(ws, name, home = HOME) {
  const who = Buffer.from(`${ws}\n${name}`).toString('base64url')
  return `${PREFIX}${who}.${sign(who, home)}`
}

// Whose key this is -> { ws, name }, or null when it isn't one CLIque made.
export function keyOwner(key, home = HOME) {
  const m = typeof key === 'string' && key.startsWith(PREFIX) && /^([\w-]+)\.([\w-]+)$/.exec(key.slice(PREFIX.length))
  if (!m) return null
  const [want, got] = [Buffer.from(sign(m[1], home)), Buffer.from(m[2])]
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
  const [ws, name] = Buffer.from(m[1], 'base64url').toString().split('\n')
  return name ? { ws, name } : null
}

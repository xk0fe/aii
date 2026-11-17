// Accounts: more than one sign-in for a provider, side by side. Claude Code and Codex each keep who's signed in (and
// their conversations) in one folder: ~/.claude, ~/.codex. An account is another such folder, in CLIque's own
// (CLIQUE_HOME/accounts/<id>), that an agent's CLI is pointed at when it starts (CLAUDE_CONFIG_DIR, CODEX_HOME). So two
// agents can run on two accounts at once, each account has its own usage limits, and its logs say what it used.
// The sign-in you already had is each provider's first account: it stays where the CLI keeps it, and nothing of it is
// touched. In config.json:
//   "accounts": [{ "id": "claude-work", "provider": "claude", "name": "Work" }]
// and on an agent, "account": "claude-work" (none: its provider's own sign-in).
// A new account's folder shares your settings, instructions, skills and commands with the CLI's own folder (linked, so
// they stay one), and nothing else: not the sign-in, not the conversations. CLIque never reads or copies a credential:
// signing in is the CLI's own `claude auth login` / `codex login`, run for that folder, in your browser.
// No Electron in here.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HOME } from './home.js'
import { resolveCommand } from './launch.js'

export const ACCOUNTS = path.join(HOME, 'accounts')
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const NAME_MAX = 40
// Where each CLI is told its folder is.
const HOME_VAR = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }
const cliOf = (provider) => provider?.cli ?? 'claude'
const expand = (dir) => String(dir).replace(/^~(?=[\\/]|$)/, os.homedir())
// The folder a CLI uses when nobody says otherwise: its own sign-in's.
export const ownHome = (cli, env = process.env) => (cli === 'codex' ? (env.CODEX_HOME ? expand(env.CODEX_HOME) : path.join(os.homedir(), '.codex')) : env.CLAUDE_CONFIG_DIR ? expand(env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude'))

// Can a provider have accounts? One whose CLI signs you in (Claude Code, Codex) and that doesn't bring its own key or
// folder: GLM runs on a key from your environment and Ollama on your own machine, so there's nobody to sign in as, and a
// provider of yours with its own CLAUDE_CONFIG_DIR is already a sign-in of its own.
export function signsIn(provider) {
  const home = HOME_VAR[cliOf(provider)]
  if (!provider || !home) return false
  const env = provider.env && typeof provider.env === 'object' ? provider.env : {}
  return !provider.needs?.length && !(provider.args ?? []).includes('--oss') && !env[home] && !env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_BASE_URL && !env.OPENAI_API_KEY
}

// The accounts in config.json, each once: [{ id, provider, name }].
export function accountsIn(config) {
  const seen = new Set()
  const list = Array.isArray(config?.accounts) ? config.accounts : []
  return list.filter((a) => a && typeof a === 'object' && ID.test(a.id) && typeof a.provider === 'string' && a.provider && !seen.has(a.id) && seen.add(a.id))
    .map((a) => ({ id: a.id, provider: a.provider, name: String(a.name ?? '').trim().slice(0, NAME_MAX) || a.id }))
}
export const accountDir = (id) => path.join(ACCOUNTS, id)
// The account an agent's definition names, when there is such an account for its provider (else its provider's own).
export function accountOf(config, agent, providerId = agent?.provider ?? agent?.cli ?? 'claude') {
  return (typeof agent?.account === 'string' && accountsIn(config).find((x) => x.id === agent.account && x.provider === providerId)) || null
}

const listOf = (v) => (Array.isArray(v) ? v : [])
// Every agent's definition in config.json: your shared ones, and each workspace's own.
const agentDefs = (config) => [...listOf(config.agents), ...listOf(config.workspaces).flatMap((w) => listOf(w?.agents))].filter((a) => a && typeof a === 'object')
// How many agents run on each account: { id: n }, '' + provider for a provider's own sign-in ("claude", "codex").
export function accountsInUse(config) {
  const ids = new Set(accountsIn(config).map((a) => a.id))
  const out = {}
  for (const a of agentDefs(config)) {
    const key = typeof a.account === 'string' && ids.has(a.account) ? a.account : `:${a.provider ?? a.cli ?? 'claude'}`
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

// A new account for a provider, by the name you give it ("Work"). -> its id (claude-work, claude-work-2)
export function addAccount(config, { provider, name } = {}) {
  name = String(name ?? '').trim().slice(0, NAME_MAX)
  if (!name) throw new Error('give the account a name: Work, Personal…')
  const all = accountsIn(config)
  if (all.some((a) => a.provider === provider && a.name.toLowerCase() === name.toLowerCase())) throw new Error(`there's an account called ${name} already`)
  const base = `${provider}-${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'account'}`.replace(/[^a-z0-9-]/g, '').slice(0, 40)
  let id = ID.test(base) ? base : 'account'
  // (never an id whose folder is still there: a removed account's sign-in isn't the new one's)
  for (let i = 2; all.some((a) => a.id === id) || fs.existsSync(accountDir(id)); i++) id = `${base}-${i}`
  config.accounts = [...listOf(config.accounts), { id, provider, name }]
  return id
}
export function renameAccount(config, id, name) {
  name = String(name ?? '').trim().slice(0, NAME_MAX)
  if (!name) throw new Error('give the account a name')
  const own = listOf(config.accounts).find((a) => a?.id === id)
  if (!own) throw new Error('no such account')
  if (accountsIn(config).some((a) => a.id !== id && a.provider === own.provider && a.name.toLowerCase() === name.toLowerCase())) throw new Error(`there's an account called ${name} already`)
  own.name = name
}
// Every agent on one account of a provider, onto another ('' for the provider's own sign-in). -> how many moved
export function moveAgents(config, provider, from, to) {
  const ids = new Set(accountsIn(config).filter((a) => a.provider === provider).map((a) => a.id))
  if (to && !ids.has(to)) throw new Error('no such account')
  let n = 0
  for (const a of agentDefs(config)) {
    if ((a.provider ?? a.cli ?? 'claude') !== provider) continue
    const now = typeof a.account === 'string' && ids.has(a.account) ? a.account : ''
    if (now !== (from || '')) continue
    if (to) a.account = to
    else delete a.account
    n++
  }
  return n
}
// An account out of config.json: its agents go back to their provider's own sign-in. Its folder is the caller's to remove.
export function dropAccount(config, id) {
  const own = accountsIn(config).find((a) => a.id === id)
  if (!own) throw new Error('no such account')
  for (const a of agentDefs(config)) if (a.account === id) delete a.account
  config.accounts = listOf(config.accounts).filter((a) => a?.id !== id)
  if (!config.accounts.length) delete config.accounts
}

// ---- what an agent on an account is started with ------------------------------------------------------------------

// Its CLI's folder, on top of its provider's environment. Codex is also told to keep the sign-in in that folder (it can
// keep it in the system's keychain instead, where two folders may share one).
export const accountEnv = (account, provider) => (account ? { [HOME_VAR[cliOf(provider)]]: accountDir(account.id) } : {})
export const accountArgs = (account, provider) => (account && cliOf(provider) === 'codex' ? ['-c', 'cli_auth_credentials_store="file"'] : [])

// ---- an account's folder --------------------------------------------------------------------------------------------

// What every account shares with the CLI's own folder: how you've set the CLI up, not who you are in it.
const SHARED = {
  claude: ['settings.json', 'CLAUDE.md', 'skills', 'agents', 'commands', 'plugins', 'hooks', 'rules', 'output-styles', 'keybindings.json'],
  codex: ['config.toml', 'AGENTS.md', 'prompts', 'skills', 'agents', 'rules', 'hooks.json'],
}
// Of Claude Code's own notes (~/.claude.json), what a new folder starts with: that you've been through its first run,
// and your tool servers. Never who's signed in.
const CLAUDE_NOTES = ['hasCompletedOnboarding', 'lastOnboardingVersion', 'installMethod', 'autoUpdates', 'autoUpdatesProtectedForNative', 'mcpServers']

function link(from, to) {
  let st
  try {
    st = fs.statSync(from)
  } catch {
    return false // you don't have one: neither does the account
  }
  try {
    fs.lstatSync(to)
    return false // there already (linked before, or the CLI made its own since)
  } catch {}
  try {
    fs.symlinkSync(from, to, st.isDirectory() ? 'junction' : 'file') // (Windows: a folder links without special rights)
    return true
  } catch {}
  try {
    fs.cpSync(from, to, { recursive: true }) // no links here (a file on Windows without the right): a copy, as it is now
    return true
  } catch {
    return false
  }
}

// Makes an account's folder ready for its CLI: there, private, and sharing your setup. Safe to run again: what's there
// stays. from: the CLI's own folder (tests give their own).
export function prepare(account, provider, { from = ownHome(cliOf(provider)), notes = path.join(os.homedir(), '.claude.json') } = {}) {
  const cli = cliOf(provider)
  const dir = accountDir(account.id)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const name of SHARED[cli] ?? []) link(path.join(from, name), path.join(dir, name))
  if (cli === 'claude' && !fs.existsSync(path.join(dir, '.claude.json'))) {
    let mine = {}
    try {
      mine = JSON.parse(fs.readFileSync(notes, 'utf8'))
    } catch {}
    const start = Object.fromEntries(CLAUDE_NOTES.filter((k) => mine?.[k] !== undefined).map((k) => [k, mine[k]]))
    if (Object.keys(start).length) fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(start, null, 2), { mode: 0o600 })
  }
  return dir
}

// ---- who's signed in ------------------------------------------------------------------------------------------------

// A CLI's command, run to its end: { code, out, err }. code -1: there's no such program to run.
const run = (cmd, args, env, { timeout = 15000 } = {}) =>
  new Promise((resolve) => {
    let c
    try {
      c = resolveCommand(cmd, args, env)
    } catch (e) {
      return resolve({ code: -1, out: '', err: e.message })
    }
    try {
      execFile(c.file, c.args, { env, timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (e, out, err) => resolve({ code: !e ? 0 : e.code === 'ENOENT' ? -1 : typeof e.code === 'number' ? e.code : 1, out: String(out ?? ''), err: String(err ?? '') }))
    } catch (e) {
      resolve({ code: -1, out: '', err: e.message })
    }
  })
const PLAN = { max_20x: 'Max 20x', max_5x: 'Max 5x', max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', plus: 'Plus', free: 'Free', business: 'Business', edu: 'Edu', go: 'Go' }
const planName = (id) => (id ? PLAN[String(id).toLowerCase()] ?? String(id).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '')
// A token's own word about who it's for (its middle part is JSON): read, never kept.
function claims(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// Who an account is signed in as, asked of its CLI. account: null for the provider's own sign-in.
// -> { signedIn, email?, plan?, org? }, or { signedIn: false, missing: true } when the CLI isn't installed.
export async function whoIs(account, provider, { env = process.env } = {}) {
  const cli = cliOf(provider)
  const mine = { ...env, ...accountEnv(account, provider) }
  if (cli === 'claude') {
    const r = await run('claude', ['auth', 'status'], mine)
    if (r.code === -1) return { signedIn: false, missing: true }
    let s = null
    try {
      s = JSON.parse(r.out)
    } catch {}
    if (!s?.loggedIn) return { signedIn: false }
    return { signedIn: true, ...(s.email && { email: String(s.email) }), ...(planName(s.planTier ?? s.subscriptionType) && { plan: planName(s.planTier ?? s.subscriptionType) }), ...(s.orgName && { org: String(s.orgName) }) }
  }
  // Codex says only whether; its sign-in's own file says who (when it keeps one)
  const r = await run('codex', ['login', 'status', ...accountArgs(account, provider)], mine)
  if (r.code === -1) return { signedIn: false, missing: true }
  if (r.code !== 0 || /not logged in/i.test(r.out + r.err)) return { signedIn: false }
  let who = null
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(account ? accountDir(account.id) : ownHome('codex', env), 'auth.json'), 'utf8'))
    who = claims(auth?.tokens?.id_token)
  } catch {}
  const plan = planName(who?.['https://api.openai.com/auth']?.chatgpt_plan_type)
  return { signedIn: true, ...(who?.email && { email: String(who.email) }), ...(plan && { plan }) }
}

// ---- signing in and out: the CLI's own, for that folder -----------------------------------------------------------

const SIGN_IN_FOR = 10 * 60000 // a sign-in nobody finishes is given up
const LINK = /https:\/\/[^\s\u0007\u001b"'<>]+/

// Starts the CLI's sign-in for an account: it opens your browser, and is done when you've signed in there.
// -> { done: Promise<{ ok, why? }>, cancel(), code(text) }; onLink(url): the page, should the browser not open.
// code(text): Claude Code's page can give a code to paste instead (when the browser is on another computer).
export function signIn(account, provider, { env = process.env, onLink, timeout = SIGN_IN_FOR } = {}) {
  const cli = cliOf(provider)
  const args = cli === 'claude' ? ['auth', 'login'] : ['login', ...accountArgs(account, provider)]
  let child
  let said = ''
  let told = false
  let timer
  const done = new Promise((resolve) => {
    try {
      if (account) prepare(account, provider)
      const c = resolveCommand(cli, args, env)
      child = spawn(c.file, c.args, { env: { ...env, ...accountEnv(account, provider) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      return resolve({ ok: false, why: e.message })
    }
    const hear = (chunk) => {
      said = (said + chunk).slice(-8000)
      const url = !told && said.match(LINK)?.[0]
      // (the whole link: its line has ended, or something that isn't part of it follows)
      if (url && said.length > said.indexOf(url) + url.length) (told = true), onLink?.(url)
    }
    child.stdout.on('data', hear)
    child.stderr.on('data', hear)
    child.stdin.on('error', () => {})
    child.once('error', (e) => resolve({ ok: false, why: e.code === 'ENOENT' ? `${cli} isn't installed, or isn't on PATH` : e.message }))
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve(code === 0 ? { ok: true } : { ok: false, why: signal ? 'stopped' : lastLine(said) || `${cli} gave up (code ${code})` })
    })
    timer = setTimeout(() => child.kill(), timeout)
    timer.unref?.()
  })
  return {
    done,
    cancel: () => child?.kill(),
    code: (text) => child?.stdin.writable && child.stdin.write(`${String(text).trim()}\n`),
  }
}
// What a CLI said last, without its colours, its link or its prompt: why it gave up, in its own words. Only what came
// after it showed where to sign in counts (before that it has said nothing about how it went).
function lastLine(said) {
  // eslint-disable-next-line no-control-regex
  const lines = said.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/).map((l) => l.replace(/^paste code[^>]*>\s*/i, '').trim())
  const shown = lines.findLastIndex((l) => LINK.test(l) || /\b(visit|navigate to|opening browser)\b/i.test(l))
  return lines.slice(shown + 1).filter(Boolean).at(-1)?.slice(0, 200) ?? ''
}

// Signs an account out: the CLI's own, so the sign-in goes from wherever it kept it.
export async function signOut(account, provider, { env = process.env } = {}) {
  const cli = cliOf(provider)
  const r = await run(cli, cli === 'claude' ? ['auth', 'logout'] : ['logout', ...accountArgs(account, provider)], { ...env, ...accountEnv(account, provider) })
  if (r.code === -1) throw new Error(r.err || `${cli} isn't installed`)
  return r.code === 0
}

// An account's folder, gone: its sign-in file, its conversations' logs and what it linked. (Its days of usage stay in
// the history: they were read before.) Only ever a folder under ACCOUNTS.
export function removeFolder(id) {
  if (!ID.test(id)) return
  fs.rmSync(accountDir(id), { recursive: true, force: true })
}

// Can this computer run an agent? For Claude Code and Codex: whether each is installed (found the way CLIque starts it,
// core/launch.js), its version, and whether it's signed in; on Windows also Claude Code's oldest version CLIque works
// with, and Git for Windows. The first-run screen and "Claude Code and Codex…" show it (ui/setup.js).
//
// Asked in the background when CLIque starts, kept, and asked again when you press Check again: nothing waits for it.
// Nothing here signs in or writes Claude Code's or Codex's files:
// - Claude Code: signed in when its config says so (an account, or a key, in .claude.json or .config.json, or a
//   credentials file beside it), or your environment or its settings hold a key. When the config is there but says
//   neither, `claude auth status` (2.1.41 and later) is asked, without its telemetry: with no sign-in it has no token to
//   refresh, and with its config there it has none to create. No config and no folder of its own means Claude Code has
//   never started here: not signed in, and nothing is run. A key helper of yours isn't run: it counts as signed in.
// - Codex: signed in when auth.json is in its home folder (where it keeps a sign-in unless config.toml says to use the
//   system's keychain: then it can't be told without asking Codex, and it counts as signed in). Codex sets up helper
//   files in its home each time it starts, even to say its version, so it says it with a throwaway home instead.
// No Electron in here.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveCommand } from './launch.js'
import { gitBash } from './procs.js'
import { markOffered } from './providers.js'

// CLIque's hooks on Windows name a program and its arguments, which Claude Code starts without a shell from 2.1.139 on
// (core/adapters.js claudeHook, bin/clique.mjs).
export const CLAUDE_ON_WINDOWS = '2.1.139'
const AUTH_STATUS = '2.1.41' // the first Claude Code with `claude auth status`; before it, those words were a prompt
const TIMEOUT = 15000 // a program Windows is scanning for the first time can take its time

// The vendors' own instructions: their installers, which keep the CLIs up to date, rather than npm.
// code.claude.com/docs/en/setup, github.com/openai/codex (README), git-scm.com/install/windows
export const STEPS = {
  claude: {
    name: 'Claude Code',
    install: { darwin: 'curl -fsSL https://claude.ai/install.sh | bash', win32: 'irm https://claude.ai/install.ps1 | iex' },
    signin: 'claude auth login',
    update: 'claude update',
    page: 'https://code.claude.com/docs/en/setup',
    signinPage: 'https://code.claude.com/docs/en/authentication',
  },
  codex: {
    name: 'Codex',
    install: { darwin: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh', win32: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"' },
    signin: 'codex login',
    page: 'https://developers.openai.com/codex/cli',
    signinPage: 'https://developers.openai.com/codex/auth',
  },
  git: { name: 'Git for Windows', page: 'https://git-scm.com/install/windows' },
}

// A key or a cloud provider in your environment is a sign-in of its own (Claude Code asks once whether to use a key).
const CLAUDE_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']

const disk = {
  isFile: (file) => {
    try {
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  },
  isDir: (file) => {
    try {
      return fs.statSync(file).isDirectory()
    } catch {
      return false
    }
  },
  read: (file) => fs.readFileSync(file, 'utf8'),
}

// A program's run: { code (null when it didn't start, or was stopped), stdout }. Never throws.
export function runFile(file, args, { env, timeout = TIMEOUT } = {}) {
  return new Promise((resolve) => {
    const done = (err, stdout) => resolve({ code: !err ? 0 : typeof err.code === 'number' ? err.code : null, stdout: String(stdout ?? '') })
    try {
      execFile(file, args, { env, timeout, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' }, done)
    } catch (e) {
      done(e) // a file Windows can't start throws right here
    }
  })
}

const numbers = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0)
// "2.1.139" or later?
export function atLeast(version, min) {
  if (!version) return false
  const [a, b] = [numbers(version), numbers(min)]
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

// What to do about it, for the screen: the command to paste and the page that says more. null when it's ready.
function howTo(id, state, platform) {
  const s = STEPS[id]
  if (state === 'missing' || state === 'broken') return { command: s.install[platform === 'win32' ? 'win32' : 'darwin'], page: s.page }
  if (state === 'signin') return { command: s.signin, page: s.signinPage }
  if (state === 'update') return { command: s.update, page: s.page }
  return null
}

const entry = (id, state, platform, extra = {}) => ({ id, name: STEPS[id].name, state, version: null, signedIn: null, ...extra, how: howTo(id, state, platform) })

// One CLI: 'ready' | 'missing' | 'broken' (found, but it doesn't start) | 'signin' | 'update' (Windows: older than
// CLAUDE_ON_WINDOWS). signedIn is null when that can't be told without side effects: it counts as signed in, and the
// CLI asks in its terminal if it isn't.
async function cli(id, ctx) {
  const { env, platform } = ctx
  let cmd
  try {
    cmd = resolveCommand(id, [], env, { platform, files: ctx.launch })
  } catch (e) {
    return entry(id, /isn't installed/.test(e.message) ? 'missing' : 'broken', platform)
  }
  // macOS and Linux: a name not found on PATH comes back as it is
  if (platform !== 'win32' && !cmd.file.includes('/')) return entry(id, 'missing', platform)
  const v = await asked(id, cmd, ['--version'], ctx)
  if (v.code !== 0) return entry(id, 'broken', platform)
  const version = v.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null
  if (id === 'claude' && platform === 'win32' && version && !atLeast(version, CLAUDE_ON_WINDOWS)) return entry(id, 'update', platform, { version, needs: CLAUDE_ON_WINDOWS })
  const signedIn = await (id === 'claude' ? claudeSignedIn : codexSignedIn)(cmd, version, ctx)
  return entry(id, signedIn === false ? 'signin' : 'ready', platform, { version, signedIn })
}

// Codex runs with a home folder of its own here (see the top).
async function asked(id, cmd, args, { env, run, timeout }) {
  if (id !== 'codex') return run(cmd.file, [...cmd.args, ...args], { env, timeout })
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-codex-'))
  try {
    return await run(cmd.file, [...cmd.args, ...args], { env: { ...env, CODEX_HOME: home }, timeout })
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

async function claudeSignedIn(cmd, version, { env, home, files, run, timeout, paths }) {
  if (CLAUDE_KEYS.some((k) => env[k])) return true
  const dir = env.CLAUDE_CONFIG_DIR || paths.join(home, '.claude')
  const json = (file) => {
    try {
      return JSON.parse(files.read(file))
    } catch {
      return undefined
    }
  }
  // its config, where Claude Code reads it: .config.json in its folder when that has something in it, else .claude.json
  const file = [paths.join(dir, '.config.json'), env.CLAUDE_CONFIG_DIR ? paths.join(dir, '.claude.json') : paths.join(home, '.claude.json')]
    .find((f) => files.isFile(f) && String(files.read(f)).trim())
  // none: never started here (not signed in), unless its folder is there all the same (another Claude app's): can't tell
  if (!file) return files.isDir(dir) ? null : false
  const config = json(file)
  if (config === undefined) return null
  if (config?.oauthAccount || config?.primaryApiKey || files.isFile(paths.join(dir, '.credentials.json'))) return true
  // settings of yours that sign it in: a key or a cloud provider in their env, or a key helper (which asking could run)
  const settings = json(paths.join(dir, 'settings.json'))
  if (CLAUDE_KEYS.some((k) => settings?.env?.[k])) return true
  if (settings?.apiKeyHelper || !atLeast(version, AUTH_STATUS)) return null
  const out = await run(cmd.file, [...cmd.args, 'auth', 'status'], { env: { ...env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, timeout })
  try {
    const status = JSON.parse(out.stdout)
    if (typeof status?.loggedIn === 'boolean') return status.loggedIn
  } catch {}
  return null
}

async function codexSignedIn(_cmd, _version, { env, home, files, paths }) {
  if (env.CODEX_ACCESS_TOKEN) return true
  const dir = env.CODEX_HOME || paths.join(home, '.codex')
  if (files.isFile(paths.join(dir, 'auth.json'))) return true
  let toml = ''
  try {
    toml = files.read(paths.join(dir, 'config.toml'))
  } catch {}
  // its settings before the first [table]: a sign-in kept in the keychain, or a model provider of your own
  const top = toml.split(/^\s*\[/m)[0]
  if (/^\s*cli_auth_credentials_store\s*=\s*["'](?!file["'])/m.test(top) || /^\s*model_provider\s*=\s*["'](?!openai["'])/m.test(top)) return null
  return false
}

// Everything at once -> { checked, at, platform, clis: [claude, codex], git (Windows: { state }), ready (an agent can
// run here) }. Everything it uses can be handed in, for the tests.
export async function detect({ env = process.env, platform = process.platform, home = os.homedir(), files, run = runFile, timeout = TIMEOUT } = {}) {
  // files: what launch.js looks at to find a program (its own disk unless handed in), and what's read here
  const ctx = { env, platform, home, run, timeout, launch: files, files: { ...disk, ...files }, paths: platform === 'win32' ? path.win32 : path.posix }
  const clis = await Promise.all(['claude', 'codex'].map((id) => cli(id, ctx).catch(() => entry(id, 'broken', platform))))
  // Recommended rather than needed: Claude Code runs its commands in Git Bash when Git for Windows is there, and in
  // PowerShell when it isn't (and CLIque's clique-sh runs only in Git Bash: core/hub.js shellPrefix).
  const git = platform === 'win32' ? { id: 'git', name: STEPS.git.name, state: gitBash(env, (f) => ctx.files.isFile(f)) ? 'ready' : 'missing', how: { page: STEPS.git.page } } : null
  return { checked: true, at: Date.now(), platform, clis, git, ready: clis.some((c) => c.state === 'ready') }
}

// The check, kept: CLIque asks once as it starts, and again when you press Check again. A check asked for while one runs
// waits for it and then looks again, so what it says is never older than the asking.
export class Setup {
  status = { checked: false, checking: false, ready: false, clis: [], git: null }
  running = null

  constructor({ detect: look = detect, env = process.env, platform = process.platform, shell = loginEnv } = {}) {
    this.look = look
    this.env = env
    this.platform = platform
    this.shell = shell
  }

  check({ again = false } = {}) {
    if (!again && (this.status.checked || this.running)) return this.running ?? Promise.resolve(this.status)
    const before = this.running ?? Promise.resolve()
    const run = before.then(async () => {
      try {
        this.status = { ...(await this.look({ env: this.env, platform: this.platform })), checking: this.running !== run }
      } catch {
        this.status = { ...this.status, checking: this.running !== run } // a check that fails says nothing new
      }
      return this.status
    })
    this.status = { ...this.status, checking: true }
    this.running = run
    run.then(() => this.running === run && (this.running = null))
    return run
  }

  // macOS and Linux: your login shell's environment again (as main.js reads it once at start), for a CLI installed, or
  // a key set, since CLIque started. -> whether anything changed.
  async refresh() {
    if (this.platform === 'win32') return false
    return adoptEnv(this.env, await this.shell(this.env.SHELL || '/bin/zsh'), { home: os.homedir() })
  }
}

// A snapshot for the pages: the check as it is (state.setup), and which providers the model picker offers.
export const withSetup = (state, config, status) => ({ ...state, providers: markOffered(state.providers, config), setup: status })

// Any agents in config.json yet (yours, or a workspace's own)? With none, CLIque opens on its dashboard.
export const hasAgents = (config) =>
  [config.agents, ...(Array.isArray(config.workspaces) ? config.workspaces.map((w) => w?.agents) : [])].some((list) => Array.isArray(list) && list.length > 0)

// Your login shell's environment, as main.js reads it at start (loadShellEnv). null when it can't be read.
export function loginEnv(shell) {
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', 'printf "\\n__CLIQUE__\\n"; env -0'], { encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err || !String(out).includes('\n__CLIQUE__\n')) return resolve(null)
      const env = {}
      for (const pair of String(out).split('\n__CLIQUE__\n')[1].split('\0')) {
        const i = pair.indexOf('=')
        if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1)
      }
      resolve(env)
    })
  })
}

// Into env: the folders on fresh's PATH that env's lacks (after its own, which keep their order), and the variables it
// doesn't have yet (a key you set). The vendors' installers put claude and codex in ~/.local/bin and add that to your
// shell's profile; one installed where the profile doesn't say is found there all the same. -> whether env changed.
export function adoptEnv(env, fresh, { home = os.homedir(), files = disk } = {}) {
  const before = JSON.stringify(env)
  const mine = String(env.PATH ?? '').split(':').filter(Boolean)
  const theirs = String(fresh?.PATH ?? '').split(':').filter(Boolean)
  const local = path.join(home, '.local', 'bin')
  const extra = ['claude', 'codex'].some((c) => files.isFile(path.join(local, c))) ? [local] : []
  env.PATH = [...new Set([...mine, ...theirs, ...extra])].join(':')
  for (const [k, v] of Object.entries(fresh ?? {})) if (!(k in env)) env[k] = v
  return JSON.stringify(env) !== before
}

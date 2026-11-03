// First run (core/setup.js): whether Claude Code and Codex are installed, their versions, whether they're signed in,
// and on Windows Claude Code's version floor and Git for Windows. Fake CLIs on a PATH of their own (a script on macOS,
// an npm-style .cmd on Windows, which Crew sees through), and Windows itself simulated with made-up files. Nothing
// here looks at your own ~/.claude or ~/.codex: every check gets a home and environment of its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { detect, Setup, STEPS, CLAUDE_ON_WINDOWS, atLeast, adoptEnv, withSetup, hasAgents } = await import('../core/setup.js')
const { providersFrom } = await import('../core/providers.js')

const WIN = process.platform === 'win32'
const OS = WIN ? 'win32' : 'darwin'

// A folder for one test: bin/ (the only thing on PATH) and home/ (where Claude Code and Codex keep their files).
function place() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-setup-'))
  const bin = path.join(root, 'bin')
  const home = path.join(root, 'home')
  fs.mkdirSync(bin)
  fs.mkdirSync(home)
  // Windows' own variables a program needs to start; nothing that says where your CLIs or Git are
  const env = { PATH: bin, ...(WIN && { SystemRoot: process.env.SystemRoot, PATHEXT: '.COM;.EXE;.BAT;.CMD' }) }
  return { root, bin, home, env, calls: path.join(bin, 'calls.log') }
}

// A CLI that answers --version (exit `versionExit`), `claude auth status` (signed in while bin/<name>-signed-in exists)
// and writes down each run: its arguments and the CODEX_HOME it was given.
function fakeCli(bin, name, { version = name === 'codex' ? 'codex-cli 0.162.1' : '2.1.316 (Claude Code)', versionExit = 0 } = {}) {
  const js = path.join(bin, `${name}-fake.cjs`)
  fs.writeFileSync(js, `const fs = require('fs'), path = require('path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'calls.log'), JSON.stringify({ name: ${JSON.stringify(name)}, args, codexHome: process.env.CODEX_HOME ?? null, homeThere: process.env.CODEX_HOME ? fs.existsSync(process.env.CODEX_HOME) : null }) + '\\n')
if (args[0] === '--version') { console.log(${JSON.stringify(version)}); process.exit(${versionExit}) }
if (args[0] === 'auth' && args[1] === 'status') {
  const loggedIn = fs.existsSync(path.join(__dirname, ${JSON.stringify(`${name}-signed-in`)}))
  console.log(JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none', apiProvider: 'firstParty' }))
  process.exit(loggedIn ? 0 : 1)
}
process.exit(2)
`)
  if (WIN) {
    fs.writeFileSync(path.join(bin, `${name}.cmd`), `@"${process.execPath}" "${js}" %*\r\n`)
  } else {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`)
    fs.chmodSync(path.join(bin, name), 0o755)
  }
}
const calls = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const row = (status, id) => status.clis.find((c) => c.id === id)
const look = (p, extra = {}) => detect({ env: p.env, home: p.home, ...extra })

test('nothing installed: both say Not installed, with the vendors’ own installers for this computer, and nothing is ready', async () => {
  const p = place()
  const s = await look(p)
  assert.equal(s.checked, true)
  assert.equal(s.ready, false)
  assert.deepEqual(s.clis.map((c) => [c.id, c.state]), [['claude', 'missing'], ['codex', 'missing']])
  assert.equal(row(s, 'claude').how.command, STEPS.claude.install[OS])
  assert.equal(row(s, 'codex').how.command, STEPS.codex.install[OS])
  assert.match(row(s, 'claude').how.page, /^https:\/\/code\.claude\.com\//)
  assert.match(row(s, 'codex').how.page, /^https:\/\/developers\.openai\.com\//)
  assert.equal(s.git === null, !WIN, 'Git for Windows is asked about on Windows only')
  assert.deepEqual(fs.readdirSync(p.home), [], 'nothing was written in the home folder')
})

test('the installers are the vendors’ own, not npm: claude.ai and chatgpt.com scripts, PowerShell on Windows', () => {
  assert.equal(STEPS.claude.install.darwin, 'curl -fsSL https://claude.ai/install.sh | bash')
  assert.equal(STEPS.claude.install.win32, 'irm https://claude.ai/install.ps1 | iex')
  assert.equal(STEPS.codex.install.darwin, 'curl -fsSL https://chatgpt.com/codex/install.sh | sh')
  assert.match(STEPS.codex.install.win32, /irm https:\/\/chatgpt\.com\/codex\/install\.ps1 \| iex/)
  for (const s of Object.values(STEPS)) for (const c of Object.values(s.install ?? {})) assert.doesNotMatch(c, /\bnpm\b/)
  assert.equal(STEPS.git.page, 'https://git-scm.com/install/windows')
})

test('a claude that appears on PATH is found when asked again (Check again), with its version; until then the last look stands', async () => {
  const p = place()
  const setup = new Setup({ detect: (o) => detect({ ...o, home: p.home }), env: p.env, shell: async () => null })
  assert.equal(row(await setup.check(), 'claude').state, 'missing')
  fakeCli(p.bin, 'claude')
  fs.writeFileSync(path.join(p.home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'ada@example.com' } }))
  assert.equal(row(await setup.check(), 'claude').state, 'missing', 'kept: a check is asked again only on purpose')
  const s = await setup.check({ again: true })
  assert.deepEqual([row(s, 'claude').state, row(s, 'claude').version, row(s, 'claude').signedIn], ['ready', '2.1.316', true])
  assert.equal(s.ready, true)
  assert.equal(row(s, 'claude').how, null)
  assert.deepEqual(calls(p.calls).map((c) => c.args), [['--version']], 'signed in, as its config says: nothing else is run')
})

test('Claude Code never started here: Sign in needed, without running anything that would create its config', async () => {
  const p = place()
  fakeCli(p.bin, 'claude')
  const s = await look(p)
  assert.deepEqual([row(s, 'claude').state, row(s, 'claude').signedIn], ['signin', false])
  assert.equal(row(s, 'claude').how.command, 'claude auth login')
  assert.deepEqual(calls(p.calls).map((c) => c.args), [['--version']])
  assert.deepEqual(fs.readdirSync(p.home), [])
})

test('its config there but no account in it: `claude auth status` says, signed in or not', async () => {
  const p = place()
  fakeCli(p.bin, 'claude')
  fs.writeFileSync(path.join(p.home, '.claude.json'), JSON.stringify({ firstStartTime: '2026-11-01T10:00:00Z' }))
  assert.equal(row(await look(p), 'claude').state, 'signin')
  assert.deepEqual(calls(p.calls).at(-1).args, ['auth', 'status'])
  fs.writeFileSync(path.join(p.bin, 'claude-signed-in'), '')
  assert.deepEqual([row(await look(p), 'claude').state, row(await look(p), 'claude').signedIn], ['ready', true])
})

test('CLAUDE_CONFIG_DIR: its config and credentials are looked for there', async () => {
  const p = place()
  fakeCli(p.bin, 'claude')
  const dir = path.join(p.root, 'claude-config')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, '.claude.json'), '{}')
  fs.writeFileSync(path.join(dir, '.credentials.json'), '{}')
  const s = await detect({ env: { ...p.env, CLAUDE_CONFIG_DIR: dir }, home: p.home })
  assert.deepEqual([row(s, 'claude').state, row(s, 'claude').signedIn], ['ready', true])
  assert.ok(!calls(p.calls).some((c) => c.args[0] === 'auth'), 'a credentials file is enough')
})

test('a key in the environment is a sign-in: Ready, and Claude Code is asked nothing more', async () => {
  const p = place()
  fakeCli(p.bin, 'claude')
  const s = await detect({ env: { ...p.env, ANTHROPIC_API_KEY: 'sk-test' }, home: p.home })
  assert.deepEqual([row(s, 'claude').state, row(s, 'claude').signedIn], ['ready', true])
  assert.deepEqual(calls(p.calls).map((c) => c.args), [['--version']])
})

test('a Claude Code from before `claude auth status` is never asked it (those words would be its prompt): Ready', async () => {
  const p = place()
  fakeCli(p.bin, 'claude', { version: '2.0.50 (Claude Code)' })
  fs.writeFileSync(path.join(p.home, '.claude.json'), '{}')
  const s = await look(p)
  assert.deepEqual([row(s, 'claude').state, row(s, 'claude').signedIn], WIN ? ['update', null] : ['ready', null])
  assert.deepEqual(calls(p.calls).map((c) => c.args), [['--version']])
})

test('Codex: signed in when auth.json is in its home; says its version from a throwaway home, so its own stays untouched', async () => {
  const p = place()
  fakeCli(p.bin, 'codex')
  const codexHome = path.join(p.root, 'codex-home')
  fs.mkdirSync(codexHome)
  const env = { ...p.env, CODEX_HOME: codexHome }
  let s = await detect({ env, home: p.home })
  assert.deepEqual([row(s, 'codex').state, row(s, 'codex').version, row(s, 'codex').how.command], ['signin', '0.162.1', 'codex login'])
  fs.writeFileSync(path.join(codexHome, 'auth.json'), '{}')
  s = await detect({ env, home: p.home })
  assert.deepEqual([row(s, 'codex').state, row(s, 'codex').signedIn], ['ready', true])
  const runs = calls(p.calls)
  assert.ok(runs.length >= 2 && runs.every((c) => c.args[0] === '--version'), 'only --version: login status is never run')
  assert.ok(runs.every((c) => c.codexHome && c.codexHome !== codexHome && c.homeThere), 'a home of its own, there while it runs')
  assert.ok(runs.every((c) => !fs.existsSync(c.codexHome)), '...and gone afterwards')
  assert.deepEqual(fs.readdirSync(codexHome), ['auth.json'])
})

test('Codex keeping its sign-in in the keychain, or a model provider of your own, can’t be told: it counts as ready', async () => {
  const p = place()
  fakeCli(p.bin, 'codex')
  fs.mkdirSync(path.join(p.home, '.codex'))
  const toml = (text) => fs.writeFileSync(path.join(p.home, '.codex', 'config.toml'), text)
  toml('cli_auth_credentials_store = "keyring"\n')
  assert.deepEqual([row(await look(p), 'codex').state, row(await look(p), 'codex').signedIn], ['ready', null])
  toml('model_provider = "azure"\n')
  assert.equal(row(await look(p), 'codex').state, 'ready')
  toml('cli_auth_credentials_store = "file"\nmodel_provider = "openai"\n[profiles.x]\nmodel_provider = "azure"\n')
  assert.equal(row(await look(p), 'codex').state, 'signin', 'the file, OpenAI, and a profile’s own setting: signed in or not, auth.json says')
})

test('one that is found but doesn’t start says Not working, with the install step to put it right', async () => {
  const p = place()
  fakeCli(p.bin, 'claude', { versionExit: 3 })
  const s = await look(p)
  assert.equal(row(s, 'claude').state, 'broken')
  assert.equal(row(s, 'claude').how.command, STEPS.claude.install[OS])
  assert.equal(s.ready, false)
})

// ---- Windows, simulated --------------------------------------------------------------------------------------

// A made-up Windows: these files exist (case as written), and each program "runs" by saying what's in `answers`.
function windows(files, answers = {}) {
  const have = new Map(Object.entries(files).map(([f, text]) => [f.toLowerCase(), text]))
  const disk = {
    isFile: (f) => have.has(f.toLowerCase()),
    canRun: (f) => have.has(f.toLowerCase()),
    read: (f) => {
      if (!have.has(f.toLowerCase())) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return have.get(f.toLowerCase())
    },
  }
  const ran = []
  const run = async (file, args) => {
    ran.push([file, ...args])
    const say = answers[`${path.win32.basename(file).toLowerCase()} ${args.filter((a) => !/[\\/]/.test(a)).join(' ')}`]
    return say ? { code: 0, stdout: say } : { code: 1, stdout: '' }
  }
  return { files: disk, run, ran }
}
const NPM = 'C:\\Users\\ada\\AppData\\Roaming\\npm'
const WINENV = { Path: `C:\\Windows\\system32;${NPM}`, PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS', USERPROFILE: 'C:\\Users\\ada', LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local', ProgramFiles: 'C:\\Program Files', ANTHROPIC_API_KEY: 'sk-test' }
const NPM_SHIM = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n'
const winLook = (w, env = WINENV) => detect({ platform: 'win32', env, home: 'C:\\Users\\ada', files: w.files, run: w.run })

test('Windows: claude.cmd from npm is found by PATHEXT and seen through to what it runs; the installers are PowerShell’s', async () => {
  const w = windows(
    { [`${NPM}\\claude.cmd`]: NPM_SHIM, [`${NPM}\\node.exe`]: '', [`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: '' },
    { 'node.exe --version': '2.1.316 (Claude Code)' },
  )
  const s = await winLook(w)
  assert.deepEqual([row(s, 'claude').state, row(s, 'claude').version], ['ready', '2.1.316'])
  assert.deepEqual(w.ran[0], [`${NPM}\\node.exe`, `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`, '--version'])
  assert.equal(row(s, 'codex').state, 'missing')
  assert.equal(row(s, 'codex').how.command, STEPS.codex.install.win32)
})

test(`Windows: a Claude Code older than ${CLAUDE_ON_WINDOWS} says Update needed (Crew's hooks need it); ${CLAUDE_ON_WINDOWS} itself is ready`, async () => {
  const exe = 'C:\\Users\\ada\\.local\\bin\\claude.exe'
  const old = await winLook(windows({ [exe]: '' }, { 'claude.exe --version': '2.1.100 (Claude Code)' }))
  assert.deepEqual([row(old, 'claude').state, row(old, 'claude').version, row(old, 'claude').needs, row(old, 'claude').how.command], ['update', '2.1.100', CLAUDE_ON_WINDOWS, 'claude update'])
  assert.equal(old.ready, false)
  const now = await winLook(windows({ [exe]: '' }, { 'claude.exe --version': `${CLAUDE_ON_WINDOWS} (Claude Code)` }))
  assert.equal(row(now, 'claude').state, 'ready', 'found where its installer puts it, though not on PATH yet')
})

test('Windows: Git for Windows is recommended, not needed: Claude Code is ready without it, and Git shows once it’s installed', async () => {
  const exe = 'C:\\Users\\ada\\.local\\bin\\claude.exe'
  const without = await winLook(windows({ [exe]: '' }, { 'claude.exe --version': '2.1.316 (Claude Code)' }))
  assert.deepEqual([without.git.state, row(without, 'claude').state, without.ready], ['missing', 'ready', true])
  assert.equal(without.git.how.page, STEPS.git.page)
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  const withGit = await winLook(windows({ [exe]: '', [bash]: '' }, { 'claude.exe --version': '2.1.316 (Claude Code)' }))
  assert.equal(withGit.git.state, 'ready')
  const onPath = await winLook(windows({ [exe]: '', 'D:\\Git\\cmd\\git.exe': '', 'D:\\Git\\bin\\bash.exe': '' }, { 'claude.exe --version': '2.1.316 (Claude Code)' }), { ...WINENV, ProgramFiles: undefined, Path: `${WINENV.Path};D:\\Git\\cmd` })
  assert.equal(onPath.git.state, 'ready', 'next to the git on PATH, as Claude Code looks for it')
})

test('Windows: Codex from its own installer is found where that puts it; an empty codex.exe on PATH is Not working', async () => {
  const exe = 'C:\\Users\\ada\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe'
  const s = await winLook(windows({ [exe]: '', 'C:\\Users\\ada\\.codex\\auth.json': '{}' }, { 'codex.exe --version': 'codex-cli 0.162.1' }))
  assert.deepEqual([row(s, 'codex').state, row(s, 'codex').signedIn], ['ready', true])
  const broken = await winLook(windows({ [`${NPM}\\codex.exe`]: '' }))
  assert.equal(row(broken, 'codex').state, 'broken')
  const batch = await winLook(windows({ [`${NPM}\\claude.bat`]: '@echo hi\r\n' }))
  assert.equal(row(batch, 'claude').state, 'broken', 'a batch file Crew can’t see through')
})

// ---- the check, kept --------------------------------------------------------------------------------------------

test('the check is made once and kept; Check again looks again; one asked for mid-check waits and then looks again', async () => {
  let n = 0
  let release
  const gate = new Promise((r) => (release = r))
  const setup = new Setup({
    detect: async () => {
      n++
      if (n === 1) await gate
      return { checked: true, ready: n > 1, clis: [], git: null, n }
    },
    shell: async () => null,
  })
  assert.equal(setup.status.checked, false)
  const first = setup.check()
  assert.equal(setup.status.checking, true)
  assert.equal(setup.check(), first, 'the same check, not a second one')
  const again = setup.check({ again: true })
  release()
  assert.equal((await first).n, 1)
  assert.equal((await again).n, 2, 'looked again after the first')
  assert.equal((await setup.check()).n, 2, 'kept')
  assert.equal(n, 2)
  assert.equal(setup.status.checking, false)
})

test('a check that fails leaves what it said before, and never throws', async () => {
  const never = new Setup({ detect: async () => Promise.reject(new Error('boom')), shell: async () => null })
  assert.equal((await never.check()).checked, false, 'nothing to say: the first-run screen stays away')
  let fail = false
  const setup = new Setup({ detect: async () => (fail ? Promise.reject(new Error('boom')) : { checked: true, ready: true, clis: [], git: null }), shell: async () => null })
  assert.equal((await setup.check()).ready, true)
  fail = true
  const s = await setup.check({ again: true })
  assert.deepEqual([s.checked, s.ready, s.checking], [true, true, false])
})

test('macOS: Check again takes in what your login shell has now (new PATH folders, a key you set), keeping what Crew had', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-setup-home-'))
  const env = { PATH: '/usr/bin:/bin', ZAI_API_KEY: 'mine', SHELL: '/bin/zsh' }
  assert.equal(adoptEnv(env, { PATH: '/opt/homebrew/bin:/usr/bin', ZAI_API_KEY: 'theirs', NEW_KEY: 'x' }, { home }), true)
  assert.deepEqual([env.PATH, env.ZAI_API_KEY, env.NEW_KEY], ['/usr/bin:/bin:/opt/homebrew/bin', 'mine', 'x'])
  assert.equal(adoptEnv(env, { PATH: '/usr/bin' }, { home }), false, 'nothing new')
  const local = path.join(home, '.local', 'bin')
  fs.mkdirSync(local, { recursive: true })
  fs.writeFileSync(path.join(local, 'claude'), '')
  assert.equal(adoptEnv(env, null, { home }), true, 'the installers’ folder, though the profile doesn’t name it')
  assert.ok(env.PATH.endsWith(`:${local}`))
})

test('Windows: Check again asks no login shell (its installers find their own way: core/launch.js)', async () => {
  const setup = new Setup({ platform: 'win32', shell: () => assert.fail('asked') })
  assert.equal(await setup.refresh(), false)
})

test('versions compare part by part', () => {
  assert.equal(atLeast('2.1.139', '2.1.139'), true)
  assert.equal(atLeast('2.1.140', '2.1.139'), true)
  assert.equal(atLeast('2.2.0', '2.1.139'), true)
  assert.equal(atLeast('2.1.99', '2.1.139'), false)
  assert.equal(atLeast('10.0.0', '9.9.9'), true)
  assert.equal(atLeast(null, '2.1.139'), false)
})

test('the pages’ state: the check as it is, and providers marked, the snapshot itself untouched', () => {
  const snapshot = { agents: [], providers: providersFrom({}) }
  const status = { checked: true, ready: false, clis: [], git: null }
  const state = withSetup(snapshot, { addedProviders: ['local'] }, status)
  assert.equal(state.setup, status)
  assert.deepEqual([state.providers.glm.added, state.providers.local.added], [false, true])
  assert.equal(snapshot.providers.glm.added, undefined)
})

test('a first run is one with no agents in config.json, yours or a workspace’s own', () => {
  assert.equal(hasAgents({ agents: [] }), false)
  assert.equal(hasAgents({}), false)
  assert.equal(hasAgents({ agents: [{ name: 'Ada' }] }), true)
  assert.equal(hasAgents({ agents: [], workspaces: [{ id: 'docs', agents: [{ name: 'June' }] }] }), true)
})

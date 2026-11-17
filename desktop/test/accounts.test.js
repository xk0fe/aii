// Accounts (core/accounts.js): more than one sign-in for a provider. An account is a folder of CLIque's that its CLI is
// pointed at; it shares your setup with the CLI's own folder and nothing else; signing in, out and "who is it" are the
// CLI's own commands, run for that folder. Stand-in `claude` and `codex` programs here (sh scripts that keep "who's
// signed in" as a file in the folder they're pointed at): the real ones, and your real sign-ins, are never run or read.
// Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-accounts-'))
process.env.CLIQUE_HOME = path.join(root, 'clique')
fs.mkdirSync(process.env.CLIQUE_HOME, { recursive: true })
after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 }))
const { accountsIn, accountOf, accountsInUse, addAccount, renameAccount, moveAgents, dropAccount, accountDir, accountEnv, accountArgs, signsIn, prepare, whoIs, signIn, signOut, removeFolder, ACCOUNTS } = await import('../core/accounts.js')
const { BUILT_IN } = await import('../core/providers.js')

const claude = { id: 'claude', ...BUILT_IN.claude }
const codex = { id: 'codex', ...BUILT_IN.codex }
const POSIX = process.platform !== 'win32'

// ---- config.json ----------------------------------------------------------------------------------------------------

test('accounts in config.json: each once, with a name; an agent names one of its own provider', () => {
  const config = { accounts: [{ id: 'claude-work', provider: 'claude', name: ' Work ' }, { id: 'claude-work', provider: 'claude', name: 'again' }, { id: 'Bad Id', provider: 'claude' }, { id: 'codex-2', provider: 'codex' }, null, 'x'] }
  assert.deepEqual(accountsIn(config), [{ id: 'claude-work', provider: 'claude', name: 'Work' }, { id: 'codex-2', provider: 'codex', name: 'codex-2' }])
  assert.deepEqual(accountsIn({}), [])
  assert.equal(accountOf(config, { provider: 'claude', account: 'claude-work' }).name, 'Work')
  assert.equal(accountOf(config, { account: 'claude-work' }).id, 'claude-work', 'an agent with no provider runs Claude')
  assert.equal(accountOf(config, { provider: 'codex', account: 'claude-work' }), null, "another provider's account isn't its")
  assert.equal(accountOf(config, { provider: 'claude', account: 'gone' }), null)
  assert.equal(accountOf(config, { provider: 'claude' }), null, "none named: its provider's own sign-in")
})

test('adding, renaming, moving agents and removing', () => {
  const config = { agents: [{ name: 'ada' }, { name: 'rex', provider: 'codex' }, { name: 'iris', provider: 'claude' }], workspaces: [{ id: 'shop', agents: [{ name: 'june', provider: 'claude' }] }] }
  const work = addAccount(config, { provider: 'claude', name: 'Work' })
  assert.equal(work, 'claude-work')
  assert.equal(addAccount(config, { provider: 'claude', name: 'Side project!' }), 'claude-side-project')
  assert.equal(addAccount(config, { provider: 'codex', name: 'Work' }), 'codex-work', 'the same name under another provider')
  assert.throws(() => addAccount(config, { provider: 'claude', name: 'work' }), /already/)
  assert.throws(() => addAccount(config, { provider: 'claude', name: '  ' }), /name/)
  // an id whose folder is still on disk isn't given again: a removed account's sign-in isn't the next one's
  fs.mkdirSync(accountDir('claude-old'), { recursive: true })
  assert.equal(addAccount(config, { provider: 'claude', name: 'Old' }), 'claude-old-2')
  renameAccount(config, work, 'Team')
  assert.equal(accountsIn(config)[0].name, 'Team')
  assert.throws(() => renameAccount(config, work, 'side project!'), /already/)
  assert.throws(() => renameAccount(config, 'nope', 'x'), /no such/)
  // every Claude agent on its own sign-in moves to Team: yours and a workspace's own; Codex's stays
  assert.equal(moveAgents(config, 'claude', '', work), 3)
  assert.deepEqual([config.agents.map((a) => a.account), config.workspaces[0].agents[0].account], [[work, undefined, work], work])
  assert.deepEqual(accountsInUse(config), { [work]: 3, ':codex': 1 })
  assert.throws(() => moveAgents(config, 'claude', work, 'codex-work'), /no such/, "not onto another provider's")
  assert.equal(moveAgents(config, 'claude', work, 'claude-side-project'), 3)
  // removing one sends its agents back to the provider's own sign-in
  dropAccount(config, 'claude-side-project')
  assert.deepEqual(config.agents.map((a) => 'account' in a), [false, false, false])
  assert.deepEqual(accountsIn(config).map((a) => a.id), [work, 'codex-work', 'claude-old-2'])
  assert.throws(() => dropAccount(config, 'claude-side-project'), /no such/)
})

test('which providers have accounts: the ones whose CLI signs you in', () => {
  assert.equal(signsIn(claude), true)
  assert.equal(signsIn(codex), true)
  assert.equal(signsIn({ id: 'glm', ...BUILT_IN.glm }), false, 'a key from your environment')
  assert.equal(signsIn({ id: 'local', ...BUILT_IN.local }), false, 'your own machine')
  assert.equal(signsIn({ id: 'house', cli: 'claude', env: { CLAUDE_CONFIG_DIR: '/x' } }), false, 'a folder of its own already')
  assert.equal(signsIn({ id: 'mine', cli: 'codex' }), true, 'a provider of yours on Codex')
  assert.equal(signsIn({ id: 'odd', cli: 'gemini' }), false)
  assert.equal(signsIn(null), false)
})

test('what an agent on an account starts with: its folder, and for Codex the sign-in kept in it', () => {
  const work = { id: 'claude-work', provider: 'claude', name: 'Work' }
  assert.deepEqual(accountEnv(work, claude), { CLAUDE_CONFIG_DIR: path.join(ACCOUNTS, 'claude-work') })
  assert.deepEqual(accountEnv({ id: 'codex-2' }, codex), { CODEX_HOME: path.join(ACCOUNTS, 'codex-2') })
  assert.deepEqual(accountArgs({ id: 'codex-2' }, codex), ['-c', 'cli_auth_credentials_store="file"'])
  assert.deepEqual([accountEnv(null, claude), accountArgs(null, codex), accountArgs(work, claude)], [{}, [], []], "the provider's own sign-in: nothing changes")
})

// ---- the folder -----------------------------------------------------------------------------------------------------

test("a new account's folder shares your setup, and nothing of who you are", () => {
  const own = path.join(root, 'own-claude')
  fs.mkdirSync(path.join(own, 'skills', 'review'), { recursive: true })
  fs.mkdirSync(path.join(own, 'projects', 'p'), { recursive: true })
  fs.writeFileSync(path.join(own, 'settings.json'), '{"model":"opus"}')
  fs.writeFileSync(path.join(own, 'skills', 'review', 'SKILL.md'), 'review')
  fs.writeFileSync(path.join(own, '.credentials.json'), '{"secret":true}')
  fs.writeFileSync(path.join(own, 'projects', 'p', 'a.jsonl'), '{}')
  const notes = path.join(root, 'claude.json')
  fs.writeFileSync(notes, JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0', mcpServers: { docs: { command: 'docs' } }, oauthAccount: { emailAddress: 'me@example.com' }, userID: 'u1', projects: { '/x': { hasTrustDialogAccepted: true } } }))
  const work = { id: 'claude-shares', provider: 'claude', name: 'Work' }
  const dir = prepare(work, claude, { from: own, notes })
  assert.equal(dir, accountDir('claude-shares'))
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.claude.json', 'settings.json', 'skills'])
  // linked: a change in your own is a change there
  fs.writeFileSync(path.join(own, 'settings.json'), '{"model":"sonnet"}')
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{"model":"sonnet"}')
  assert.equal(fs.readFileSync(path.join(dir, 'skills', 'review', 'SKILL.md'), 'utf8'), 'review')
  // Claude Code's notes: past its first run, your tool servers; not who's signed in, not your id, not what you trusted
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8')), { hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0', mcpServers: { docs: { command: 'docs' } } })
  if (POSIX) assert.equal(fs.statSync(dir).mode & 0o077, 0, 'the folder is yours alone')
  // again: what's there stays (the CLI has written its own since)
  fs.writeFileSync(path.join(dir, '.claude.json'), '{"oauthAccount":{"emailAddress":"work@example.com"}}')
  fs.mkdirSync(path.join(own, 'commands'))
  prepare(work, claude, { from: own, notes })
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8')).oauthAccount.emailAddress, 'work@example.com')
  assert.ok(fs.existsSync(path.join(dir, 'commands')), 'and what you added since is shared now')
  // gone with the account: the folder and its links, never what they pointed at
  removeFolder('claude-shares')
  assert.equal(fs.existsSync(dir), false)
  assert.equal(fs.readFileSync(path.join(own, 'skills', 'review', 'SKILL.md'), 'utf8'), 'review')
  assert.ok(fs.existsSync(path.join(own, 'commands')))
  removeFolder('../own-claude') // not a name an account can have: nothing happens
  assert.ok(fs.existsSync(own))
})

// ---- the CLI's own sign-in, by stand-ins ----------------------------------------------------------------------------

const bin = path.join(root, 'bin')
fs.mkdirSync(bin)
// who's signed in is a file in the folder the stand-in is pointed at (or in its "own" folder)
const FAKE_CLAUDE = `#!/bin/sh
dir="\${CLAUDE_CONFIG_DIR:-${path.join(root, 'home-claude')}}"
mkdir -p "$dir"
case "$1 $2" in
  "auth status") if [ -f "$dir/who" ]; then printf '{"loggedIn":true,"email":"%s","subscriptionType":"max","planTier":"max_20x","orgName":"Example"}' "$(cat "$dir/who")"; else printf '{"loggedIn":false,"authMethod":"none"}'; fi ;;
  "auth login")
    echo "Opening browser to sign in…"
    printf 'If the browser didn%st open, visit: \\033]8;;https://signin.example/authorize?code=true&state=abc\\033\\\\link\\033]8;;\\033\\\\\\n' "'"
    printf 'Paste code here if prompted > '
    read code || exit 3
    [ "$code" = "nope" ] && { echo "Login failed: that code isn't right"; exit 1; }
    echo "$code@example.com" > "$dir/who"; echo "Login successful." ;;
  "auth logout") rm -f "$dir/who" ;;
  *) exit 2 ;;
esac
`
const idToken = `x.${Buffer.from(JSON.stringify({ email: 'rex@example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } })).toString('base64url')}.y`
const FAKE_CODEX = `#!/bin/sh
dir="\${CODEX_HOME:-${path.join(root, 'home-codex')}}"
mkdir -p "$dir"
echo "$@" >> "$dir/args"
case "$1 $2" in
  "login status") if [ -f "$dir/auth.json" ]; then echo "Logged in using ChatGPT"; else echo "Not logged in"; fi ;;
  "login -c")
    echo "Starting local login server on http://localhost:1455."
    echo "If your browser did not open, navigate to this URL to authenticate:"
    echo
    echo "https://auth.example/oauth/authorize?response_type=code&state=xyz"
    echo
    while [ ! -f "$dir/go" ]; do sleep 0.05; done
    printf '{"tokens":{"id_token":"${idToken}"}}' > "$dir/auth.json"; echo "Successfully logged in" ;;
  "logout -c") rm -f "$dir/auth.json" ;;
  *) exit 2 ;;
esac
`
if (POSIX) {
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'codex'), FAKE_CODEX, { mode: 0o755 })
}
const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` }
delete env.CLAUDE_CONFIG_DIR
delete env.CODEX_HOME
const until = async (fn, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (fn()) return true
  return false
}

test('signing in to a Claude account: the CLI is pointed at its folder, its link is passed on, and it says who it is after', { skip: !POSIX }, async () => {
  const work = { id: 'claude-in', provider: 'claude', name: 'Work' }
  assert.deepEqual(await whoIs(work, claude, { env }), { signedIn: false })
  assert.deepEqual(await whoIs(null, claude, { env }), { signedIn: false }, "the provider's own sign-in is asked without a folder")
  let link = null
  const going = signIn(work, claude, { env, onLink: (url) => (link = url) })
  assert.ok(await until(() => link), 'the link came')
  assert.equal(link, 'https://signin.example/authorize?code=true&state=abc', "the whole link, without the terminal's wrapping")
  assert.ok(fs.existsSync(accountDir('claude-in')), 'its folder was made ready first')
  going.code(' work ') // (the code its page showed; in the real one, the browser finishes it on its own)
  assert.deepEqual(await going.done, { ok: true })
  assert.deepEqual(await whoIs(work, claude, { env }), { signedIn: true, email: 'work@example.com', plan: 'Max 20x', org: 'Example' })
  assert.deepEqual(await whoIs(null, claude, { env }), { signedIn: false }, 'and only that account')
  assert.equal(await signOut(work, claude, { env }), true)
  assert.deepEqual(await whoIs(work, claude, { env }), { signedIn: false })
})

test("a sign-in that fails says why in the CLI's words; one you cancel stops; one nobody finishes is given up", { skip: !POSIX }, async () => {
  const work = { id: 'claude-fail', provider: 'claude', name: 'Work' }
  const wrong = signIn(work, claude, { env })
  await new Promise((r) => setTimeout(r, 200))
  wrong.code('nope')
  assert.deepEqual(await wrong.done, { ok: false, why: "Login failed: that code isn't right" })
  const stopped = signIn(work, claude, { env })
  await new Promise((r) => setTimeout(r, 200))
  stopped.cancel()
  assert.deepEqual(await stopped.done, { ok: false, why: 'stopped' })
  const slow = signIn(work, claude, { env, timeout: 300 })
  assert.deepEqual(await slow.done, { ok: false, why: 'stopped' })
  // no such program
  const none = signIn(work, claude, { env: { ...env, PATH: '/nonexistent' } })
  assert.match((await none.done).why, /isn't installed|ENOENT|not found/i)
  assert.deepEqual(await whoIs(work, claude, { env: { ...env, PATH: '/nonexistent' } }), { signedIn: false, missing: true })
})

test('a Codex account: signed in from its own folder with the sign-in kept there, who it is read from that', { skip: !POSIX }, async () => {
  const second = { id: 'codex-in', provider: 'codex', name: 'Second' }
  assert.deepEqual(await whoIs(second, codex, { env }), { signedIn: false })
  let link = null
  const going = signIn(second, codex, { env, onLink: (url) => (link = url) })
  assert.ok(await until(() => link))
  assert.equal(link, 'https://auth.example/oauth/authorize?response_type=code&state=xyz')
  fs.writeFileSync(path.join(accountDir('codex-in'), 'go'), '') // you signed in, in the browser
  assert.deepEqual(await going.done, { ok: true })
  assert.deepEqual(await whoIs(second, codex, { env }), { signedIn: true, email: 'rex@example.com', plan: 'Plus' })
  assert.match(fs.readFileSync(path.join(accountDir('codex-in'), 'args'), 'utf8'), /^login -c cli_auth_credentials_store="file"$/m, 'told to keep the sign-in in the folder')
  assert.equal(await signOut(second, codex, { env }), true)
  assert.deepEqual(await whoIs(second, codex, { env }), { signedIn: false })
})

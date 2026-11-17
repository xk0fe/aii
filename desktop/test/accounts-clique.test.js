// Accounts, the way the app drives them (Clique.accountAction, core/accounts.js): each provider's own sign-in and the
// accounts you add, who's signed in to each, adding one (its folder made ready, its sign-in started), signing out,
// moving agents between accounts, removing one, and each account's usage in the history. A stand-in `claude` here keeps
// "who's signed in" as a file in the folder it's pointed at: the real CLI and your real sign-ins are never run or read.
// Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const POSIX = process.platform !== 'win32'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-accounts-app-'))
const bin = path.join(root, 'bin')
process.env.CLIQUE_HOME = path.join(root, 'clique')
process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude')
process.env.CODEX_HOME = path.join(root, 'codex')
process.env.PATH = `${bin}:/usr/bin:/bin`
for (const dir of [bin, process.env.CLIQUE_HOME, process.env.CLAUDE_CONFIG_DIR, path.join(root, 'work')]) fs.mkdirSync(dir, { recursive: true })
if (POSIX) {
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
dir="$CLAUDE_CONFIG_DIR"
case "$1 $2" in
  "auth status") if [ -f "$dir/who" ]; then printf '{"loggedIn":true,"email":"%s","planTier":"max_5x"}' "$(cat "$dir/who")"; else printf '{"loggedIn":false}'; fi ;;
  "auth login") echo "If the browser didn't open, visit: https://signin.example/authorize?state=abc"; printf 'Paste code here if prompted > '; read code || exit 3
    [ "$code" = "nope" ] && { echo "Login failed: that code isn't right"; exit 1; }
    echo "$code@example.com" > "$dir/who" ;;
  "auth logout") rm -f "$dir/who" ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 })
  fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'who'), 'me@example.com') // your own sign-in
}
const { CONFIG } = await import('../core/hub.js')
const { Clique, logRoots } = await import('../core/clique.js')
const { accountDir } = await import('../core/accounts.js')

const cwd = path.join(root, 'work')
fs.writeFileSync(CONFIG, JSON.stringify({
  layout: 2,
  agents: [{ name: 'june', area: 'backend' }, { name: 'iris', area: 'design' }, { name: 'rex', area: 'ops', provider: 'codex' }, { name: 'zoe', area: 'docs', provider: 'glm' }],
  workspaces: [{ id: 'shop', name: 'Shop', folder: cwd, members: { june: {}, iris: {}, rex: {}, zoe: {} } }],
}))
const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
Object.assign(clique.runner, { running: () => false, quietFor: () => Infinity, submit() {}, write() {}, start() {}, stop() {} })
after(() => {
  for (const hub of clique.hubs.values()) {
    for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer', 'spendTimer']) clearTimeout(hub[t])
    clearTimeout(hub.ledger.timer)
    for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'retryTimer', 'stopTimer']) clearTimeout(a[t])
  }
  clearTimeout(clique.changeTimer)
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 })
})
const until = async (fn, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (fn()) return true
  return false
}
const view = (key) => clique.accountsView().find((a) => a.key === key)
const hub = () => clique.hubs.get('shop')

test("every provider that signs you in has its own sign-in; one that runs on a key doesn't", { skip: !POSIX }, async () => {
  assert.deepEqual(clique.accountsView().map((a) => [a.key, a.own, a.agents, a.signedIn]), [['claude', true, 2, undefined], ['codex', true, 1, undefined]], 'not asked yet, and no GLM')
  await clique.accountAction('check')
  assert.deepEqual([view('claude').signedIn, view('claude').email, view('claude').plan], [true, 'me@example.com', 'Max 5x'])
  assert.deepEqual([view('codex').signedIn, view('codex').missing], [false, true], "Codex isn't installed here")
  assert.deepEqual(clique.snapshot().accounts.map((a) => a.key), ['claude', 'codex'], "in the app's state")
  await assert.rejects(clique.accountAction('add', { provider: 'glm', name: 'Second' }), /doesn't sign you in/)
})

test('adding an account: its folder is made ready and its sign-in starts; signed in, it says who it is', { skip: !POSIX }, async () => {
  const id = await clique.accountAction('add', { provider: 'claude', name: 'Work' })
  assert.equal(id, 'claude-work')
  assert.deepEqual(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).accounts, [{ id: 'claude-work', provider: 'claude', name: 'Work' }])
  assert.ok(fs.statSync(accountDir(id)).isDirectory())
  assert.ok(await until(() => view('claude@claude-work').signing?.link), 'the sign-in is under way, with its link for a browser that didn\'t open')
  assert.equal(view('claude@claude-work').signing.link, 'https://signin.example/authorize?state=abc')
  assert.equal(view('claude@claude-work').signedIn, undefined)
  // a wrong code: the CLI says why, and the account says it too
  await clique.accountAction('code', { key: 'claude@claude-work', text: 'nope' })
  assert.ok(await until(() => view('claude@claude-work').problem))
  assert.deepEqual([view('claude@claude-work').problem, view('claude@claude-work').signing, view('claude@claude-work').signedIn], ["Login failed: that code isn't right", undefined, false])
  // again, and through
  await clique.accountAction('signIn', { id })
  assert.ok(await until(() => view('claude@claude-work').signing?.link))
  assert.equal(view('claude@claude-work').problem, undefined, 'a new try starts clean')
  await clique.accountAction('code', { key: 'claude@claude-work', text: 'work' })
  assert.ok(await until(() => view('claude@claude-work').signedIn === true))
  assert.deepEqual([view('claude@claude-work').email, view('claude@claude-work').plan, view('claude@claude-work').name, view('claude@claude-work').agents], ['work@example.com', 'Max 5x', 'Work', 0])
  assert.equal(view('claude').email, 'me@example.com', 'your own sign-in is as it was')
  await assert.rejects(clique.accountAction('add', { provider: 'claude', name: 'work' }), /already/)
})

test('an agent is given the account, and starts in its folder; signed out, it says so instead of starting', { skip: !POSIX }, async () => {
  const started = new Map()
  hub().runner.start = (name, opts) => started.set(name, opts)
  hub().url = 'http://127.0.0.1:1'
  hub().update('june', { account: 'claude-work' })
  assert.equal(view('claude@claude-work').agents, 1)
  assert.equal(clique.snapshot().agents.find((a) => a.name === 'june').account, 'claude-work')
  hub().launch(hub().agents.get('june'))
  assert.equal(started.get('june').env.CLAUDE_CONFIG_DIR, accountDir('claude-work'))
  // signed out (here, or by hand in a terminal): the next start says so
  await clique.accountAction('signOut', { id: 'claude-work' })
  assert.equal(view('claude@claude-work').signedIn, false)
  started.clear()
  hub().launch(hub().agents.get('june'))
  assert.equal(started.has('june'), false)
  assert.match(hub().feed.at(-1).text, /Claude · Work isn't signed in/)
})

test('moving agents between accounts, and removing one once nobody is on it', { skip: !POSIX }, async () => {
  assert.equal(await clique.accountAction('move', { provider: 'claude', from: '', to: 'claude-work' }), 1, 'iris, the one still on your own sign-in')
  assert.deepEqual([view('claude').agents, view('claude@claude-work').agents], [0, 2])
  await assert.rejects(clique.accountAction('remove', { id: 'claude-work' }), /2 agents still run on Work: move them to another account first/)
  assert.equal(await clique.accountAction('move', { provider: 'claude', from: 'claude-work', to: '' }), 2)
  // a conversation still in its folder keeps it too (an agent at work moves when its turn is over)
  hub().sessions.june = 's1'
  hub().convos.june = { since: 1, tasks: 0, compactions: 0, account: 'claude-work' }
  await assert.rejects(clique.accountAction('remove', { id: 'claude-work' }), /@june still runs on Work/)
  delete hub().sessions.june
  await clique.accountAction('rename', { id: 'claude-work', name: 'Team' })
  assert.equal(view('claude@claude-work').name, 'Team')
  await clique.accountAction('remove', { id: 'claude-work' })
  assert.equal(fs.existsSync(accountDir('claude-work')), false, 'its folder went with it')
  assert.equal(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).accounts, undefined)
  assert.deepEqual(clique.accountsView().map((a) => a.key), ['claude', 'codex'])
  await assert.rejects(clique.accountAction('remove', { id: 'claude-work' }), /no such account/)
})

test("each account's folder is read for the usage history, and its rows say which account", async () => {
  const providers = { claude: { id: 'claude', cli: 'claude' }, codex: { id: 'codex', cli: 'codex' } }
  assert.deepEqual(logRoots(providers, {}, [{ id: 'claude-work', provider: 'claude' }, { id: 'codex-two', provider: 'codex' }, { id: 'odd', provider: 'gone' }]).slice(2), [
    { dir: path.join(accountDir('claude-work'), 'projects'), cli: 'claude', provider: 'claude', account: 'claude-work' },
    { dir: path.join(accountDir('codex-two'), 'sessions'), cli: 'codex', provider: 'codex', account: 'codex-two' },
  ])
  // an account by hand in config.json, with a log in its folder
  const data = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
  fs.writeFileSync(CONFIG, JSON.stringify({ ...data, accounts: [{ id: 'claude-side', provider: 'claude', name: 'Side' }] }))
  clique.config.load()
  const at = new Date('2026-11-10T12:00:00').toISOString()
  const log = path.join(accountDir('claude-side'), 'projects', 'p', 's-side.jsonl')
  fs.mkdirSync(path.dirname(log), { recursive: true })
  fs.writeFileSync(log, [{ type: 'agent-name', agentName: 'june' }, { type: 'user', timestamp: at, message: { role: 'user', content: 'go' } }, { type: 'assistant', timestamp: at, requestId: 'r1', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 42, output_tokens: 0 } } }].map((r) => `${JSON.stringify(r)}\n`).join(''))
  clique.usageSummary()
  await clique.history.refresh() // (a look this soon after the last one is asked for)
  const mine = clique.usageHistory().computers[0]
  const col = (name) => mine.cols.indexOf(name)
  assert.deepEqual(mine.rows.map((r) => [r[col('ws')], r[col('who')], r[col('account')], r[col('tokens')]]), [['studio:shop', 'june', 'claude-side', 42]])
  assert.deepEqual(mine.accounts, { 'claude-side': { name: 'Side', provider: 'claude' } })
})

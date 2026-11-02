// `crew`, the status line and the hooks on Windows: bin/crew.mjs, which bin/win32-<arch>/crew.exe, crew-status.exe and
// crew-hook.exe run, does exactly what bin/crew, bin/crew-status and the sh hooks do on macOS (checked side by side
// here, against one server); the .exe files are what native/crew-shim.c builds; and on Windows (or under wine, with
// CREW_WINE_NODE set to a Windows node.exe) the real .exe files reach Crew from no shell, PowerShell, cmd and Git Bash
// with every argument intact. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN = path.join(DESKTOP, 'bin')
const CREW_MJS = path.join(BIN, 'crew.mjs')
const { adapters } = await import('../core/adapters.js')
const { toolsDir } = await import('../core/launch.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-windows-'))
const servers = new Set()
after(() => {
  for (const server of servers) server.close(), server.closeAllConnections()
  fs.rmSync(tmp, { recursive: true, force: true })
})

// A Crew that writes down every request and answers as told.
async function crewServer(answer = (r) => ({ body: `${r.route} ok\n` })) {
  const got = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const r = { method: req.method, url: req.url, route: req.url.split(/[/?]/)[1], token: req.headers['x-crew'], ws: req.headers['x-crew-workspace'] ?? '', body: Buffer.concat(chunks).toString('utf8') }
      got.push(r)
      const { status = 200, body = '', delay = 0 } = answer(r) ?? {}
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      if (!res.destroyed) res.writeHead(status).end(body)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.add(server)
  const close = () => new Promise((resolve) => (servers.delete(server), server.close(resolve), server.closeAllConnections()))
  return { got, url: `http://127.0.0.1:${server.address().port}`, close }
}

function home(name, { url, token = 'tok' } = {}) {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  if (url) fs.writeFileSync(path.join(dir, 'url'), url)
  if (url) fs.writeFileSync(path.join(dir, 'token'), token)
  return dir
}

function run(file, args, { env, input = '' }) {
  return new Promise((resolve) => {
    const p = spawn(file, args, { env })
    const out = []
    const err = []
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => err.push(d))
    p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }))
    p.stdin.on('error', () => {})
    p.stdin.end(input)
  })
}

const posixEnv = (crewHome, over = {}) => ({ PATH: '/usr/bin:/bin', HOME: tmp, SHELL: '/bin/sh', CREW_HOME: crewHome, CREW_AGENT: 'david', CREW_WORKSPACE: '', ...over })
const settings = JSON.parse(adapters.claude({ name: 'david' }, { session: 's', attachments: '/tmp', platform: 'darwin' }).args.find((x) => x.startsWith('{"permissions"')))
// the macOS hooks, as Claude Code runs them, and what crew-hook.exe runs for each on Windows
const SH = { hook: settings.hooks.Stop[0].hooks[0].command, ask: settings.hooks.PermissionRequest[0].hooks[0].command.replace('-m 86390', '-m 1'), lease: settings.hooks.PreToolUse[1].hooks[0].command }
const NODE_ARGS = { hook: ['hook'], ask: ['ask', '1'], lease: ['lease'] }

const both = {
  crew: (args, opts) => Promise.all([run(path.join(BIN, 'crew'), args, opts), run(process.execPath, [CREW_MJS, 'crew', ...args], opts)]),
  status: (opts) => Promise.all([run(path.join(BIN, 'crew-status'), [], opts), run(process.execPath, [CREW_MJS, 'crew-status'], opts)]),
  hook: (kind, opts) => Promise.all([run('/bin/sh', ['-c', SH[kind]], opts), run(process.execPath, [CREW_MJS, 'crew-hook', ...NODE_ARGS[kind]], opts)]),
}

// ---- the same as on macOS, side by side ---------------------------------------------------------------------

const TRICKY = 'fix the build\nthen ship it & tell me | 100% "done" > é ✓ $HOME `x`'

test('crew: every command asks Crew the same thing as bin/crew and prints the same, usage errors and help too', async () => {
  const crew = await crewServer((r) => (r.route === 'answer' ? { status: 400, body: 'nobody asked you anything\n' } : { body: `${r.route}: ${r.body.replaceAll('\0', '|')}\n` }))
  const env = posixEnv(home('cli', { url: crew.url }), { CREW_WORKSPACE: 'golf' })
  const cases = [
    ['who'], ['board'], ['leases'], ['send', 'bob', TRICKY], ['send', 'bob'], ['send'], ['ask', 'any', 'which port?', 'the dev one'], ['ask', 'any'], ['wait'],
    ['answer', '@bob', 'port 3000'], ['answer', 'yes'], ['answer', '@bob'], ['lease', 'iOS Simulator', 'UI tests'], ['lease'], ['release'], ['release', 'iOS Simulator'],
    ['note', 'we use pnpm', 'now'], ['note'], ['task', 'add', 'Fix login', '--priority', 'high', TRICKY], ['task'], ['bug', 'it crashes'], ['help'], [], ['nonsense'],
  ]
  for (const args of cases) {
    crew.got.length = 0
    const [sh] = await both.crew(args, { env })
    const shAsked = crew.got.splice(0)
    const [, node] = await both.crew(args, { env })
    assert.deepEqual(node, sh, `crew ${args.join(' ')}: what it prints and exits with`)
    assert.deepEqual(crew.got, shAsked, `crew ${args.join(' ')}: what Crew is asked`)
  }
  assert.deepEqual(crew.got.at(-1) ?? null, null, 'help asks nothing')
  await crew.close()
})

test("crew: Crew not running says so, and the address and token come from the environment when Crew's files aren't there", async () => {
  const none = posixEnv(home('none'))
  const [sh, node] = await both.crew(['who'], { env: none })
  assert.deepEqual(node, sh)
  assert.deepEqual(node, { code: 1, stdout: '', stderr: 'crew app is not running\n' })
  const crew = await crewServer()
  const fromEnv = { ...none, CREW_URL: crew.url, CREW_TOKEN: 'from-env' }
  const [sh2, node2] = await both.crew(['note', 'hi'], { env: fromEnv })
  assert.deepEqual(node2, sh2)
  assert.deepEqual(crew.got.map((r) => r.token), ['from-env', 'from-env'])
  await crew.close()
  // its address is there, but nothing answers: said on stderr, as curl's failure was
  const [sh3, node3] = await both.crew(['who'], { env: fromEnv })
  assert.equal(node3.code, sh3.code)
  assert.equal(node3.stdout, sh3.stdout)
  assert.ok(sh3.stderr.endsWith('crew app is not running\n') && node3.stderr === 'crew app is not running\n')
})

test('crew-hook hook: the same event reaches Crew, and the same line lands in the spool while Crew is closed', async () => {
  const crew = await crewServer()
  const event = `${JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: TRICKY }, null, 2)}\n`
  for (const ws of ['', 'golf']) {
    const env = posixEnv(home(`hook-${ws || 'default'}`, { url: crew.url }), { CREW_WORKSPACE: ws })
    crew.got.length = 0
    const [sh, node] = await both.hook('hook', { env, input: event })
    assert.deepEqual(node, sh)
    assert.deepEqual(node, { code: 0, stdout: '', stderr: '' })
    assert.equal(crew.got.length, 2)
    assert.deepEqual(crew.got[1], crew.got[0])
    assert.deepEqual(crew.got[0], { method: 'POST', url: '/hook/david', route: 'hook', token: 'tok', ws, body: event.trimEnd() })
  }
  await crew.close()
  // closed (nothing at its address), or a stale token: both spool
  const gone = await crewServer(() => ({ status: 403, body: 'bad token, is crew running?\n' }))
  for (const [name, url] of [['closed', 'http://127.0.0.1:9'], ['forbidden', gone.url]]) {
    const dir = home(`spool-${name}`, { url })
    const env = posixEnv(dir, { CREW_WORKSPACE: 'golf' })
    const spool = path.join(dir, 'workspaces', 'golf', 'spool', 'david.jsonl')
    await run('/bin/sh', ['-c', SH.hook], { env, input: event })
    const shLine = fs.readFileSync(spool, 'utf8')
    fs.rmSync(path.join(dir, 'workspaces'), { recursive: true })
    await run(process.execPath, [CREW_MJS, 'crew-hook', 'hook'], { env, input: event })
    assert.equal(fs.readFileSync(spool, 'utf8'), shLine, name)
    assert.equal(JSON.parse(shLine).last_assistant_message, TRICKY)
  }
  await gone.close()
})

test("crew-hook ask and lease: Crew's decision is printed, as ASCII that no shell can re-encode; nothing on an error or when time's up", async () => {
  const decision = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { answers: { 'Which colour?': 'Grün ✓' } } } } }
  const crew = await crewServer((r) => (r.body.includes('slow') ? { delay: 3000 } : r.body.includes('broken') ? { status: 500, body: 'oops' } : { body: `${JSON.stringify(decision)}\n` }))
  const env = posixEnv(home('ask', { url: crew.url }))
  for (const kind of ['ask', 'lease']) {
    const [sh, node] = await both.hook(kind, { env, input: '{"tool_name":"AskUserQuestion"}' })
    assert.deepEqual(JSON.parse(node.stdout), JSON.parse(sh.stdout), kind)
    assert.match(node.stdout, /^[\x20-\x7e]+$/, 'ASCII only')
    assert.deepEqual(crew.got.at(-1), { ...crew.got.at(-2), url: `/${kind}/david`, route: kind })
    const [sh2, node2] = await both.hook(kind, { env, input: '{"broken":1}' })
    assert.deepEqual([node2.stdout, sh2.stdout], ['', ''])
  }
  const started = Date.now()
  const [sh3, node3] = await both.hook('ask', { env, input: '{"slow":1}' })
  assert.deepEqual([node3.stdout, sh3.stdout, node3.code], ['', '', 0])
  assert.ok(Date.now() - started < 2900, 'both gave up after their second')
  await crew.close()
})

test("crew-status: tells Crew the context, then prints Crew's line, or yours (with the same JSON) when you have one", async () => {
  const crew = await crewServer(() => ({ body: '\x1b[32mcontext 12% · 24k of 200k\x1b[0m' }))
  const env = posixEnv(home('status', { url: crew.url }), { CREW_WORKSPACE: 'golf', COLUMNS: '80' })
  const input = JSON.stringify({ session_id: 's', context_window: { used_percentage: 12 } })
  const [sh, node] = await both.status({ env, input })
  assert.deepEqual(node, sh)
  assert.equal(node.stdout, '\x1b[32mcontext 12% · 24k of 200k\x1b[0m')
  assert.deepEqual(crew.got[1], crew.got[0])
  assert.deepEqual(crew.got[0], { method: 'POST', url: '/status/david', route: 'status', token: 'tok', ws: 'golf', body: input })
  const yours = { ...env, CREW_STATUS_LINE: 'printf "mine %s " "$COLUMNS"; head -c 14' }
  const [sh2, node2] = await both.status({ env: yours, input })
  assert.deepEqual(node2, sh2)
  assert.equal(node2.stdout, 'mine 80 {"session_id":')
  await crew.close()
  const [sh3, node3] = await both.status({ env, input })
  assert.deepEqual([node3.stdout, sh3.stdout], ['', ''], 'Crew closed: an empty line')
})

test("crew.mjs is started only as crew, crew-status or crew-hook, and never passes ELECTRON_RUN_AS_NODE on", async () => {
  const bad = await run(process.execPath, [CREW_MJS, 'crew-other'], { env: posixEnv(tmp) })
  assert.equal(bad.code, 2)
  const crew = await crewServer()
  const env = posixEnv(home('runas', { url: crew.url }), { ELECTRON_RUN_AS_NODE: '1', CREW_STATUS_LINE: 'printf "%s" "${ELECTRON_RUN_AS_NODE:-unset}"' })
  assert.equal((await run(process.execPath, [CREW_MJS, 'crew-status'], { env, input: '{}' })).stdout, 'unset')
  assert.equal((await run(process.execPath, [CREW_MJS, 'crew-hook', 'nonsense'], { env })).code, 2)
  await crew.close()
})

// ---- the .exe files ------------------------------------------------------------------------------------------

const zig = (() => {
  try {
    execFileSync('zig', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('bin/win32-x64 and bin/win32-arm64 are what native/crew-shim.c builds, one program under three names', { skip: !zig && 'needs zig' }, async () => {
  const { build, TARGETS, NAMES } = await import('../scripts/build-shims.mjs')
  for (const arch of Object.keys(TARGETS)) {
    const fresh = path.join(tmp, `crew-${arch}.exe`)
    build(arch, fresh)
    for (const name of NAMES) assert.ok(fs.readFileSync(path.join(BIN, `win32-${arch}`, name)).equals(fs.readFileSync(fresh)), `bin/win32-${arch}/${name}: run node scripts/build-shims.mjs`)
  }
})

// ---- the real thing: on Windows, or under wine ---------------------------------------------------------------

const wineNode = process.platform !== 'win32' && process.env.CREW_WINE_NODE
const real = process.platform === 'win32' || Boolean(wineNode)
const TOOLS = process.platform === 'win32' ? toolsDir(BIN) : path.join(BIN, 'win32-x64') // wine runs x64
const winPath = (p) => (wineNode ? `Z:${p.replaceAll('/', '\\')}` : p)

// One of Crew's .exe files, started as a CLI would start it with no shell: directly on Windows; under wine with files
// for its stdin and stdout (wine can't hand macOS pipes to Node).
async function exe(name, args, { env, input = '' }) {
  const winEnv = { ...env, CREW_NODE: wineNode ? wineNode : process.execPath, CREW_HOME: winPath(env.CREW_HOME) }
  if (!wineNode) return run(path.join(TOOLS, `${name}.exe`), args, { env: { ...process.env, ...winEnv }, input })
  const io = fs.mkdtempSync(path.join(tmp, 'io-'))
  fs.writeFileSync(path.join(io, 'in'), input)
  const fds = ['in', 'out', 'err'].map((f, i) => fs.openSync(path.join(io, f), i ? 'w' : 'r'))
  const code = await new Promise((resolve) => {
    spawn('wine', [path.join(TOOLS, `${name}.exe`), ...args], { stdio: fds, env: { ...process.env, ...winEnv, WINEDEBUG: '-all' } }).on('close', resolve)
  })
  fds.forEach((fd) => fs.closeSync(fd))
  return { code, stdout: fs.readFileSync(path.join(io, 'out'), 'utf8'), stderr: fs.readFileSync(path.join(io, 'err'), 'utf8') }
}

const winEnv = (crewHome, over = {}) => ({ CREW_HOME: crewHome, CREW_AGENT: 'david', CREW_WORKSPACE: '', ...over })

test('Windows: crew-hook.exe, started with no shell as Claude Code starts it, reaches Crew, spools while Crew is closed, prints decisions', { skip: !real && 'Windows only (or CREW_WINE_NODE)', timeout: 120000 }, async () => {
  const crew = await crewServer((r) => (r.route === 'ask' ? { body: JSON.stringify({ decision: { behavior: 'allow', message: 'Grün ✓' } }) } : { body: 'ok\n' }))
  const dir = home('win-hook', { url: crew.url })
  const event = JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: TRICKY })
  assert.deepEqual(await exe('crew-hook', ['hook'], { env: winEnv(dir, { CREW_WORKSPACE: 'golf' }), input: event }), { code: 0, stdout: '', stderr: '' })
  assert.deepEqual(crew.got.at(-1), { method: 'POST', url: '/hook/david', route: 'hook', token: 'tok', ws: 'golf', body: event })
  const asked = await exe('crew-hook', ['ask', '5'], { env: winEnv(dir), input: '{"tool_name":"Bash"}' })
  assert.equal(JSON.parse(asked.stdout).decision.message, 'Grün ✓')
  assert.match(asked.stdout, /^[\x20-\x7e]+$/)
  await crew.close()
  await exe('crew-hook', ['hook'], { env: winEnv(dir, { CREW_WORKSPACE: 'golf' }), input: event })
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'workspaces', 'golf', 'spool', 'david.jsonl'), 'utf8')).last_assistant_message, TRICKY)
})

test('Windows: crew.exe and crew-status.exe pass every argument and byte through, and say when Crew is gone', { skip: !real && 'Windows only (or CREW_WINE_NODE)', timeout: 120000 }, async () => {
  const crew = await crewServer((r) => ({ body: r.route === 'status' ? 'context 12% · 24k' : `${r.route} ok\n` }))
  const dir = home('win-cli', { url: crew.url })
  const sent = await exe('crew', ['send', 'bob', TRICKY, '', 'C:\\Program Files\\x\\'], { env: winEnv(dir) })
  assert.deepEqual(sent, { code: 0, stdout: 'send ok\n', stderr: '' })
  assert.equal(crew.got.at(-1).body, `${TRICKY}  C:\\Program Files\\x\\`)
  await exe('crew', ['task', 'add', 'say "hi"', '--priority', 'high'], { env: winEnv(dir) })
  assert.deepEqual(crew.got.at(-1).body.split('\0'), ['add', 'say "hi"', '--priority', 'high', ''])
  const status = await exe('crew-status', [], { env: winEnv(dir), input: '{"session_id":"s"}' })
  assert.equal(status.stdout, 'context 12% · 24k')
  await crew.close()
  const gone = await exe('crew', ['who'], { env: winEnv(dir) })
  assert.deepEqual([gone.code, gone.stderr.trim()], [0, 'crew app is not running'])
})

// What only Windows itself can show: the shells the CLIs really use. Codex: `pwsh|powershell -NoProfile -Command
// <hook>`, or `cmd.exe /C "<hook>"`; Claude Code's status line: Git Bash, or PowerShell; an agent typing `crew` in
// PowerShell, cmd or Git Bash.
const shells = () => {
  const pwsh = execFileSync('where.exe', ['powershell.exe'], { encoding: 'utf8' }).split(/\r?\n/)[0]
  const git = (() => {
    try {
      return path.join(path.dirname(execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' }).split(/\r?\n/)[0]), '..', 'bin', 'bash.exe')
    } catch {
      return null
    }
  })()
  return { pwsh, bash: git && fs.existsSync(git) ? git : null }
}

test('Windows: through PowerShell, cmd and Git Bash, the hooks, the status line and crew reach Crew with text intact', { skip: process.platform !== 'win32' && 'Windows only', timeout: 120000 }, async () => {
  const { pwsh, bash } = shells()
  const crew = await crewServer((r) => ({ body: r.route === 'ask' ? '{"decision":{"behavior":"allow"}}' : r.route === 'status' ? 'context 12%' : `${r.route} ok\n` }))
  const dir = home('win-shells', { url: crew.url })
  const env = { ...process.env, ...winEnv(dir), CREW_NODE: process.execPath, Path: `${TOOLS};${process.env.Path ?? process.env.PATH}` }
  delete env.PATH
  const viaShell = (file, args, input = '', windowsVerbatimArguments = false) =>
    new Promise((resolve) => {
      const p = spawn(file, args, { env, windowsVerbatimArguments })
      const out = []
      p.stdout.on('data', (d) => out.push(d))
      p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString('utf8') }))
      p.stdin.end(input)
    })
  const event = '{"hook_event_name":"Stop","last_assistant_message":"Grün ✓ & | > 100%"}'
  // Codex's hooks
  await viaShell(pwsh, ['-NoProfile', '-Command', 'crew-hook hook'], event)
  assert.equal(crew.got.at(-1).body, event, 'PowerShell')
  assert.equal(JSON.parse((await viaShell(pwsh, ['-NoProfile', '-Command', 'crew-hook ask 5'], '{}')).stdout).decision.behavior, 'allow')
  await viaShell(process.env.ComSpec || 'cmd.exe', ['/C', '"crew-hook hook"'], event, true)
  assert.equal(crew.got.at(-1).body, event, 'cmd')
  // Claude Code's status line, in PowerShell and Git Bash
  assert.equal((await viaShell(pwsh, ['-NoProfile', '-Command', 'crew-status'], '{}')).stdout.trim(), 'context 12%')
  if (bash) assert.equal((await viaShell(bash, ['-c', 'crew-status'], '{}')).stdout, 'context 12%')
  // crew as an agent types it: a newline, quotes and & | % in the text
  await viaShell(pwsh, ['-NoProfile', '-Command', 'crew send bob "line one`nline \'two\' & | > 100% é"'])
  assert.equal(crew.got.at(-1).body, "line one\nline 'two' & | > 100% é", 'PowerShell')
  await viaShell(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"crew note "50% & done | ok""'], '', true)
  assert.equal(crew.got.at(-1).body, '50% & done | ok', 'cmd')
  if (bash) {
    await viaShell(bash, ['-c', `crew send bob $'line one\\nline "two" & | > 100% é'`])
    assert.equal(crew.got.at(-1).body, 'line one\nline "two" & | > 100% é', 'Git Bash')
  }
  await crew.close()
})

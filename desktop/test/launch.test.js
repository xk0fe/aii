// Starting agents' CLIs on Windows as on macOS (core/launch.js, core/adapters.js): finding claude and codex however
// they were installed, npm's .cmd shims seen through to the program they run, the agent's PATH, and the hooks and
// status line each CLI runs. The Windows logic runs here on any computer, against Windows paths and the shims npm and
// pnpm really write. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { which, pathKey, resolveCommand, shimTarget, toolsDir, withTools } = await import('../core/launch.js')
const { adapters, ASK_WAIT } = await import('../core/adapters.js')
const { argsToCommandLine } = createRequire(import.meta.url)('node-pty/lib/windowsPtyAgent.js')

// ---- a Windows computer, on paper ---------------------------------------------------------------------------

const ANN = 'C:\\Users\\Ann Lee'
const NPM = `${ANN}\\AppData\\Roaming\\npm`
const env = (over = {}) => ({
  Path: `C:\\Windows\\system32;"C:\\Program Files\\nodejs";${NPM}`,
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
  USERPROFILE: ANN,
  LOCALAPPDATA: `${ANN}\\AppData\\Local`,
  APPDATA: `${ANN}\\AppData\\Roaming`,
  ...over,
})
// Files by their Windows paths, any case, as Windows sees them.
const disk = (files) => {
  const all = new Map(Object.entries(files).map(([file, text]) => [file.toLowerCase(), text]))
  return {
    isFile: (file) => all.has(file.toLowerCase()),
    canRun: () => false,
    read(file) {
      if (!all.has(file.toLowerCase())) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' })
      return all.get(file.toLowerCase())
    },
  }
}
const win = (files, over) => ({ platform: 'win32', env: env(over), files: disk(files) })
const resolve = (cmd, args, { platform, env, files }) => resolveCommand(cmd, args, env, { platform, files })

// What npm (cmd-shim 9) and pnpm (@zkochan/cmd-shim 9) write for `npm i -g @anthropic-ai/claude-code @openai/codex`,
// byte for byte; and yarn 1's global bin, a shim of a shim.
const SHIM = {
  npmClaude: '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',
  npmCodex: '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
  pnpmClaude: '@SETLOCAL\r\n@"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',
  pnpmCodex: '@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n) ELSE (\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n)\r\n',
  yarnCodex: '@"%~dp0\\..\\Data\\global\\node_modules\\.bin\\codex.cmd"   %*\r\n',
}
const NODE = 'C:\\Program Files\\nodejs\\node.exe'
const CLAUDE_EXE = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
const CODEX_JS = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`

// CommandLineToArgvW's (and the C runtime's, Rust's, Node's) reading of a Windows command line.
function argv(line) {
  const out = []
  let i = 0
  let program = ''
  if (line[0] === '"') {
    for (i = 1; i < line.length && line[i] !== '"'; i++) program += line[i]
    i++
  } else for (; i < line.length && line[i] !== ' ' && line[i] !== '\t'; i++) program += line[i]
  out.push(program)
  for (;;) {
    while (line[i] === ' ' || line[i] === '\t') i++
    if (i >= line.length) return out
    let arg = ''
    let quoted = false
    while (i < line.length && (quoted || (line[i] !== ' ' && line[i] !== '\t'))) {
      if (line[i] === '\\') {
        let n = 0
        while (line[i] === '\\') n++, i++
        if (line[i] !== '"') arg += '\\'.repeat(n)
        else {
          arg += '\\'.repeat(n >> 1)
          if (n % 2) arg += '"', i++
        }
      } else if (line[i] === '"') {
        if (quoted && line[i + 1] === '"') arg += '"', (i += 2)
        else (quoted = !quoted), i++
      } else arg += line[i++]
    }
    out.push(arg)
  }
}

// ---- finding the program ---------------------------------------------------------------------------------

test('Windows: a command is found the way cmd.exe finds it, by PATHEXT, in PATH order, folders with spaces and quotes too', () => {
  const where = win({ 'C:\\Program Files\\nodejs\\node.exe': '', [`${NPM}\\claude.cmd`]: '', [`${NPM}\\claude.exe`]: '', [`${NPM}\\codex`]: '' })
  assert.equal(which('node', where.env.Path, where), NODE, 'a quoted PATH entry')
  assert.equal(which('claude', where.env.Path, where), `${NPM}\\claude.exe`, '.EXE comes before .CMD')
  assert.equal(which('claude.cmd', where.env.Path, where), `${NPM}\\claude.cmd`, 'named with its extension')
  assert.equal(which('codex', where.env.Path, where), 'codex', "a file without an extension isn't a program")
  assert.equal(which('C:\\Tools\\claude.exe', where.env.Path, where), 'C:\\Tools\\claude.exe', 'a path stays as it is')
  const first = win({ 'C:\\Windows\\system32\\claude.cmd': '', [`${NPM}\\claude.exe`]: '' })
  assert.equal(which('claude', first.env.Path, first), 'C:\\Windows\\system32\\claude.cmd', 'an earlier folder wins')
})

test("Windows: PATH is the environment's own key, so an agent's environment never holds Path and PATH both", () => {
  assert.equal(pathKey({ Path: 'x', TEMP: 'y' }, 'win32'), 'Path')
  assert.equal(pathKey({ PATH: 'x' }, 'win32'), 'PATH', 'as Git Bash passes it on')
  assert.equal(pathKey({}, 'win32'), 'Path')
  assert.equal(pathKey({ Path: 'x' }, 'darwin'), 'PATH')
  const bin = 'C:\\Program Files\\Crew\\resources\\app.asar.unpacked\\desktop\\bin'
  assert.deepEqual(withTools({ Path: 'C:\\Windows' }, bin, { platform: 'win32', arch: 'x64' }), { Path: `${bin}\\win32-x64;C:\\Windows` })
  assert.deepEqual(withTools({ Path: 'C:\\Windows' }, bin, { platform: 'win32', arch: 'arm64' }), { Path: `${bin}\\win32-arm64;C:\\Windows` })
  assert.deepEqual(withTools({ PATH: '/usr/bin:/bin' }, '/Applications/Crew.app/bin', { platform: 'darwin' }), { PATH: '/Applications/Crew.app/bin:/usr/bin:/bin' }, 'macOS: as before')
  assert.equal(toolsDir('/b', { platform: 'darwin' }), '/b')
})

test("Windows: Claude Code's native installer, WinGet and npm and pnpm installs all start as the program itself", () => {
  const args = ['--settings', '{"a":1}']
  const native = win({ [`${ANN}\\.local\\bin\\claude.exe`]: '' }, { Path: `${ANN}\\.local\\bin;C:\\Windows` })
  assert.deepEqual(resolve('claude', args, native), { file: `${ANN}\\.local\\bin\\claude.exe`, args })
  // npm and pnpm: the claude.exe the .cmd runs, none of the shim's own arguments
  for (const shim of [SHIM.npmClaude, SHIM.pnpmClaude]) {
    const npm = win({ [`${NPM}\\claude.cmd`]: shim, [CLAUDE_EXE]: 'MZ' })
    assert.deepEqual(resolve('claude', args, npm), { file: CLAUDE_EXE, args })
  }
  // installed after Crew started: not on Crew's PATH yet, but where the installer puts it
  const fresh = win({ [`${ANN}\\.local\\bin\\claude.exe`]: '' }, { Path: 'C:\\Windows' })
  assert.equal(resolve('claude', [], fresh).file, `${ANN}\\.local\\bin\\claude.exe`)
  const winget = win({ [`${ANN}\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe`]: '' }, { Path: 'C:\\Windows' })
  assert.equal(resolve('claude', [], winget).file, `${ANN}\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe`)
})

test("Windows: Codex's npm, pnpm and yarn shims start node with codex.js first: node.exe beside the shim, else node on PATH", () => {
  const args = ['-c', 'check_for_update_on_startup=false']
  for (const shim of [SHIM.npmCodex, SHIM.pnpmCodex]) {
    const onPath = win({ [`${NPM}\\codex.cmd`]: shim, [NODE]: 'MZ', [CODEX_JS]: '' })
    assert.deepEqual(resolve('codex', args, onPath), { file: NODE, args: [CODEX_JS, ...args] })
    const beside = win({ [`${NPM}\\codex.cmd`]: shim, [`${NPM}\\node.exe`]: 'MZ', [NODE]: 'MZ', [CODEX_JS]: '' })
    assert.deepEqual(resolve('codex', args, beside), { file: `${NPM}\\node.exe`, args: [CODEX_JS, ...args] })
  }
  const yarnBin = `${ANN}\\AppData\\Local\\Yarn\\bin`
  const yarnJs = `${ANN}\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\@openai\\codex\\bin\\codex.js`
  const yarn = win(
    { [`${yarnBin}\\codex.cmd`]: SHIM.yarnCodex, [`${ANN}\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\.bin\\codex.cmd`]: SHIM.pnpmCodex.replaceAll('node_modules\\@openai', '..\\@openai'), [NODE]: 'MZ' },
    { Path: `"C:\\Program Files\\nodejs";${yarnBin}` },
  )
  assert.deepEqual(resolve('codex', args, yarn), { file: NODE, args: [yarnJs, ...args] }, 'a shim of a shim')
  // Codex's own installer and WinGet: the program
  const installer = win({ [`${ANN}\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe`]: '' }, { Path: 'C:\\Windows' })
  assert.equal(resolve('codex', args, installer).file, `${ANN}\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe`)
})

test("Windows: a batch file Crew can't see through, or no program at all, fails with a reason instead of going through cmd.exe", () => {
  const odd = win({ [`${NPM}\\claude.cmd`]: '@echo off\r\ncall "%~dp0\\setup.bat"\r\nstart claude-real\r\n' })
  assert.throws(() => resolve('claude', [], odd), /claude\.cmd is a batch file, which Windows can't start with these arguments intact/)
  const loop = win({ [`${NPM}\\codex.cmd`]: '@"%~dp0\\codex.cmd" %*\r\n' })
  assert.throws(() => resolve('codex', [], loop), /batch file/, 'a shim that runs itself')
  assert.throws(() => resolve('codex', [], win({})), /codex isn't installed, or isn't on PATH/)
  assert.equal(shimTarget(SHIM.npmCodex, `${NPM}\\codex.cmd`, { env: env(), files: disk({}) }), null, "a shim whose program isn't there")
})

test('macOS: a command is still the first runnable file on PATH, and one that is nowhere stays its name', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-launch-'))
  fs.writeFileSync(path.join(tmp, 'claude'), '#!/bin/sh\n', { mode: 0o755 })
  fs.writeFileSync(path.join(tmp, 'codex'), '', { mode: 0o644 })
  const PATH = `/nowhere:${tmp}`
  assert.deepEqual(resolveCommand('claude', ['-x'], { PATH }, { platform: 'darwin' }), { file: path.join(tmp, 'claude'), args: ['-x'] })
  assert.deepEqual(resolveCommand('codex', [], { PATH }, { platform: 'darwin' }), { file: 'codex', args: [] }, "not executable: as before, pty.spawn says so")
  assert.equal(which('/bin/sh', PATH), '/bin/sh')
  fs.rmSync(tmp, { recursive: true, force: true })
})

// ---- what the CLIs are given --------------------------------------------------------------------------------

const BIN = 'C:\\Program Files\\Crew\\resources\\app.asar.unpacked\\desktop\\bin'
const HOOK_EXE = `${BIN}\\win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}\\crew-hook.exe`
const agent = {
  name: 'gal.2', cloneOf: 'gal', area: 'the API: routes, "auth" & rate limits | 100% covered', model: 'opus', effort: 'high',
  prompt: `Keep PRs small.\nRun "npm test" before you push & never force-push.\n${'Write tests first; keep the API stable. '.repeat(40)}`,
  images: ['C:\\Users\\Ann Lee\\Pictures\\api flow.png'],
}

test('Windows: Claude Code starts every hook as crew-hook.exe with its arguments and no shell, whatever shell Windows has', () => {
  const claude = adapters.claude(agent, { session: 's', attachments: `${ANN}\\.crew\\attachments`, platform: 'win32', bin: BIN })
  const settings = JSON.parse(claude.args[claude.args.indexOf('--settings') + 1])
  const hooks = Object.values(settings.hooks).flat().flatMap((h) => h.hooks)
  assert.ok(hooks.every((h) => h.type === 'command' && h.command === HOOK_EXE && Array.isArray(h.args)), 'exec form: no Git Bash or PowerShell in between')
  assert.deepEqual(settings.hooks.Stop[0].hooks[0].args, ['hook'])
  assert.deepEqual(settings.hooks.PermissionRequest[0].hooks[0], { type: 'command', command: HOOK_EXE, args: ['ask', String(ASK_WAIT.claude - 10)], timeout: ASK_WAIT.claude })
  assert.deepEqual(settings.hooks.PreToolUse[1], { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: HOOK_EXE, args: ['lease'], timeout: 5 }] })
  assert.deepEqual(settings.hooks.PreToolUse.map((h) => h.matcher), ['Agent|Task', 'Edit|Write|MultiEdit|NotebookEdit'])
  // the status line always goes through a shell: a bare name means the same in Git Bash and PowerShell
  assert.deepEqual(settings.statusLine, { type: 'command', command: 'crew-status', padding: 0 })
  assert.deepEqual(settings.permissions, { allow: ['Bash(crew *)', 'PowerShell(crew *)'], deny: ['SendMessage'] }, 'crew runs from the PowerShell tool unasked too')
})

test('Windows: Codex runs its hooks through PowerShell or cmd, so each is a bare crew-hook command that reads the same in both', () => {
  const codex = adapters.codex(agent, { resume: 'r', platform: 'win32' })
  const hooks = codex.args.filter((x) => x.startsWith('hooks.')).map((x) => [x.slice(6, x.indexOf('=')), [...x.matchAll(/command="([^"]*)"/g)].map((m) => m[1])])
  assert.deepEqual(Object.fromEntries(hooks), {
    SessionStart: ['crew-hook hook'], UserPromptSubmit: ['crew-hook hook'], PostToolUse: ['crew-hook hook'], Stop: ['crew-hook hook'], Interrupt: ['crew-hook hook'],
    PermissionRequest: [`crew-hook ask ${ASK_WAIT.codex - 10}`], PreToolUse: ['crew-hook lease'],
  })
  assert.match(codex.args.find((x) => x.startsWith('hooks.PermissionRequest=')), new RegExp(`timeout=${ASK_WAIT.codex},statusMessage=`))
})

test("Windows: the arguments survive CreateProcess, as node-pty's ConPTY hands them over, and fit Windows' 32767 characters", () => {
  for (const [cli, opts] of [['claude', { session: 's', attachments: `${ANN}\\.crew\\attachments` }], ['codex', { resume: 'r' }]]) {
    const { file, args } = adapters[cli](agent, { ...opts, platform: 'win32', bin: BIN })
    const launched = resolve(file, args, win({ [`${ANN}\\.local\\bin\\claude.exe`]: '', [`${ANN}\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe`]: '' }))
    const line = argsToCommandLine(launched.file, launched.args)
    assert.deepEqual(argv(line), [launched.file, ...args], `${cli}: every argument comes back as it went in`)
    assert.ok(line.length < 32767, `${cli}: ${line.length} characters`)
  }
  // instructions too long for Windows' limit (macOS takes a megabyte): a reason, not CreateProcess failing
  const long = adapters.claude({ ...agent, prompt: 'x'.repeat(30000) }, { session: 's', attachments: 'C:\\a', platform: 'win32', bin: BIN })
  assert.throws(() => resolve(long.file, long.args, win({ [`${ANN}\\.local\\bin\\claude.exe`]: '' })), /Windows takes 32767: shorten this agent's instructions/)
})

test('macOS: the hooks and status line are what they always were', () => {
  const claude = adapters.claude({ name: 'j' }, { session: 's', attachments: '/tmp', platform: 'darwin', bin: '/b' })
  const settings = JSON.parse(claude.args[claude.args.indexOf('--settings') + 1])
  assert.match(settings.hooks.Stop[0].hooks[0].command, /^p=\$\(cat\); printf '%s' "\$p" \| curl -sf -m 2 /)
  assert.equal(settings.hooks.Stop[0].hooks[0].args, undefined)
  assert.deepEqual(settings.permissions.allow, ['Bash(crew *)'])
  assert.match(adapters.codex({ name: 'm' }, { platform: 'darwin' }).args.find((x) => x.startsWith('hooks.Stop=')), /curl -sf -m 2 /)
})

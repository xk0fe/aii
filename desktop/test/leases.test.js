// Things only one agent can use at a time (crew lease), and what an agent leaves running, stopped once its CLI is gone.
// The leases run against the real Hub with a fake runner; the sweeps against real processes, on macOS and Windows
// alike, and Windows' way of telling what's left (no process groups there) also on made-up process lists, so it's
// checked on any computer. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WIN, BIN, SH, program, alive, gone } from './helpers/platform.mjs'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-leases-'))
const { Hub, CONFIG, shellPrefix, filePath, fileKey } = await import('../core/hub.js')
const { Runner } = await import('../core/runner.js')
const { withTools, pathKey } = await import('../core/launch.js')
const { seconds, leftovers, readGroups, readSpans, parseWindows, tree, groupsOf, noteworthy, exempt, gitBash, prefixWorks } = await import('../core/procs.js')

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
}

let hub, runner
beforeEach(() => {
  for (const f of ['feed.jsonl', 'sessions.json', 'conversations.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'scarlett', area: 'QA' }, { name: 'levi', area: 'mobile app' }, { name: 'gal', area: 'design' }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: BIN })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'working'))
})
afterEach(() => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.readyTimer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

const claim = (from, words, hold = 100000) => hub.claim({ from, words, hold })
const stop = (name, extra = {}) => hub.onHook(name, { hook_event_name: 'Stop', last_assistant_message: 'done', ...extra })

test('one agent on the simulator at a time: the next one waits, and gets it when the first is done', async () => {
  assert.match(await claim('scarlett', ['simulator', 'QA pass for #4754']), /^Yours now: simulator, until your turn ends with nothing left running/)
  assert.deepEqual(hub.snapshot().agents.find((a) => a.name === 'scarlett').holds, ['simulator'])
  assert.match(hub.who(), /scarlett +working, has simulator/)
  assert.match(hub.leasesText(), /simulator +@scarlett +1 min +QA pass for #4754/)
  // the same thing, however it's written; asking again is fine
  assert.match(await claim('scarlett', ['Simulator']), /^Still yours: simulator/)
  const waiting = claim('levi', ['SIMULATOR'])
  await new Promise((r) => setImmediate(r))
  const rules = hub.feed.filter((e) => e.kind === 'rule' && e.rule === 'lease')
  assert.equal(rules.length, 1, 'one quiet line in the chat')
  assert.deepEqual([rules[0].from, rules[0].to, rules[0].thing], ['levi', 'scarlett', 'simulator'])
  stop('scarlett') // her turn ends with nothing left running: it's levi's now
  assert.match(await waiting, /^Yours now: SIMULATOR/)
  assert.deepEqual(hub.holdsOf('levi'), ['SIMULATOR'])
  assert.deepEqual(hub.holdsOf('scarlett'), [])
})

test('taken past the wait: it says who has it and what for, and not to touch it', async () => {
  await claim('scarlett', ['simulator', 'QA pass'])
  assert.match(await claim('levi', ['simulator'], 30), /^simulator is still @scarlett's \(1 min: QA pass\)\. Don't use it meanwhile[\s\S]*crew ask scarlett/)
})

test('something left running in the background keeps the lease; crew release gives it back', async () => {
  await claim('scarlett', ['metro:8081', 'dev server for QA'])
  stop('scarlett', { background_tasks: [{ id: 'b1', type: 'bash', status: 'running' }] })
  assert.match(await claim('levi', ['metro:8081'], 30), /still @scarlett's/)
  assert.equal(hub.give({ from: 'levi', words: ['metro:8081'] }), "metro:8081 isn't yours\n")
  const waiting = claim('levi', ['metro:8081'])
  assert.equal(hub.give({ from: 'scarlett', words: [] }), 'released metro:8081\n')
  assert.match(await waiting, /^Yours now: metro:8081/)
})

test('the holder waiting on you: you may use it for its question', async () => {
  await claim('scarlett', ['simulator'])
  hub.open({ id: 'q1', from: 'scarlett', to: 'gal', text: 'does the card look right?', hold: {} }) // her crew ask, holding on
  assert.match(await claim('gal', ['simulator']), /@scarlett has simulator, but it's waiting on you/)
})

test('yours from your terminal until you let go; an agent that stops lets go of everything', async () => {
  await claim('you', ['android device'])
  stop('scarlett')
  assert.match(await claim('scarlett', ['android device'], 30), /still the user's/)
  await claim('levi', ['simulator'])
  hub.setStatus(hub.agents.get('levi'), 'stopped')
  assert.deepEqual(hub.holdsOf('levi'), [])
  assert.match(hub.give({ from: 'you', words: ['Android  device'] }), /released android device/)
  await assert.rejects(hub.claim({ from: 'levi', words: [] }), /usage: crew lease/)
})

// ---- one file, however it's written ----------------------------------------------------------------------

const edit = (name, file_path) => hub.lease(name, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path, old_string: 'a', new_string: 'b' } })

test('a file an agent names another way is still the one leased', () => {
  const dir = path.join(os.tmpdir(), 'crew-leases-app')
  assert.equal(edit('scarlett', path.join(dir, 'src', 'Board.tsx')), '')
  const other = path.join(dir, 'src', '..', 'src', '.', 'Board.tsx')
  assert.match(JSON.parse(edit('levi', other)).hookSpecificOutput.permissionDecisionReason, /^Board\.tsx is being edited by @scarlett/)
  if (process.platform === 'win32') assert.ok(edit('levi', path.join(dir, 'SRC', 'board.TSX')), 'on Windows, in any case')
})

test('on Windows: C:\\, C:/ and Git Bash\'s /c/ are one drive, and the case of a name is no other file', () => {
  const win = (file, cwd = 'C:\\Users\\me\\app') => fileKey(filePath(file, cwd, 'win32'), 'win32')
  const key = 'c:\\users\\me\\app\\src\\board.tsx'
  for (const spelling of ['C:\\Users\\me\\app\\src\\Board.tsx', 'C:/Users/me/app/src/Board.tsx', '/c/Users/me/app/src/Board.tsx', '/cygdrive/c/Users/me/app/src/Board.tsx',
    'c:\\users\\ME\\App\\SRC\\board.tsx', 'src\\Board.tsx', 'src/Board.tsx', './src/../src/Board.tsx', '\\\\?\\C:\\Users\\me\\app\\src\\Board.tsx']) assert.equal(win(spelling), key, spelling)
  assert.equal(win('src/Board.tsx', '/c/Users/me/app'), key, 'a folder in Git Bash spelling too')
  assert.equal(win('src/Board.tsx', 'c:/users/me/app/'), key)
  assert.equal(filePath('/c/Users/me/app/src/Board.tsx', 'C:\\x', 'win32'), 'C:\\Users\\me\\app\\src\\Board.tsx', 'as it reads: a drive, \\ between folders, the case kept')
  assert.equal(filePath('d:/work/x.js', 'C:\\x', 'win32'), 'D:\\work\\x.js')
  assert.notEqual(win('D:\\Users\\me\\app\\src\\Board.tsx'), key, 'another drive is another file')
  assert.equal(win('\\\\nas\\share\\Board.tsx'), '\\\\nas\\share\\board.tsx', 'a network share stays one')
})

test('on a Mac, two names that differ in case are two files (a volume can be case-sensitive)', () => {
  const mac = (file, cwd = '/Users/me/app') => fileKey(filePath(file, cwd, 'darwin'), 'darwin')
  assert.equal(mac('src/Board.tsx'), '/Users/me/app/src/Board.tsx')
  assert.equal(mac('/Users/me/app/./src/../src/Board.tsx'), '/Users/me/app/src/Board.tsx')
  assert.notEqual(mac('src/board.tsx'), mac('src/Board.tsx'))
  assert.equal(mac('/c/Users/me/x.js'), '/c/Users/me/x.js', 'no drives on a Mac')
})

// ---- what an agent leaves running ----------------------------------------------------------------------

const now = () => Math.floor(Date.now() / 1000)
// A command the way Claude Code runs one: the leader of its own process group, gone once it's done, its `&` left behind.
function detached(cmd, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { detached: true, windowsHide: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('exit', () => resolve({ leader: p.pid, out: out.trim() }))
  })
}
// A command, in Node, that leaves a process running and ends: in its group (it leads it), or on Windows out of the
// job that would end it along with its parent, which keeps its parent's id.
const LEAVES = program(`const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300000)'], { detached: ${WIN}, stdio: 'ignore', windowsHide: true }); c.unref(); console.log(c.pid)`)
const leaveOne = () => detached([LEAVES.file, ...LEAVES.args])
const groupsFile = (name) => path.join(process.env.CREW_HOME, 'run', 'groups', name)

test("ps's elapsed times; only members of a group that's still the one written down count", () => {
  assert.equal(seconds('05'), 5)
  assert.equal(seconds('01:05'), 65)
  assert.equal(seconds('02:01:05'), 7265)
  assert.equal(seconds('3-02:01:05'), 3 * 86400 + 7265)
  const t = 1_000_000
  const procs = [
    { pid: 10, pgid: 10, start: t + 500 }, // pid 10 handed out again: its group isn't the one written down
    { pid: 11, pgid: 10, start: t + 501 },
    { pid: 21, pgid: 20, start: t + 3 }, // leader 20 gone: an orphan of the group written down
    { pid: 22, pgid: 20, start: t - 100 }, // started before the group did: someone else's
    { pid: 31, pgid: 30, start: t + 9 },
  ]
  const groups = new Map([[10, t], [20, t], [30, t]])
  assert.deepEqual(leftovers(procs, groups, new Set([31])).map((p) => p.pid), [21])
})

test('a CLI that ends: what its commands left in their groups is stopped, with one line in the chat', async () => {
  const { leader, out } = await leaveOne()
  const orphan = Number(out)
  assert.ok(alive(orphan))
  fs.writeFileSync(groupsFile('levi.0000beef'), `${leader} ${now()}\n`)
  hub.runs.set('0000beef', { name: 'levi', file: groupsFile('levi.0000beef'), at: 0 })
  await hub.sweep('0000beef')
  assert.ok(await gone(orphan), 'what it left behind is stopped')
  assert.match(hub.feed.findLast((e) => e.kind === 'event').text, /^left a process running \(node\), so Crew stopped it$/)
  assert.equal(hub.feed.findLast((e) => e.kind === 'event').from, 'levi')
  assert.ok(!fs.existsSync(groupsFile('levi.0000beef')))
})

test('bin/crew-sh writes down each command\'s group and runs it as the shell would; Crew sweeps it later', { skip: !SH && 'no Git Bash here' }, async () => {
  const file = groupsFile('scarlett.0000cafe')
  // Git Bash numbers its processes its own way: the sleep's Windows id is what Crew can stop
  const pid = WIN ? 'read -r w < /proc/$!/winpid; echo $w' : 'echo $!'
  const { leader, out } = await detached([SH, path.join(BIN, 'crew-sh'), `echo "$((40 + 2))"; sleep 300 >/dev/null 2>&1 & ${pid}`], { CREW_GROUPS: file, SHELL: '/bin/sh' })
  const [answer, sleep] = out.split('\n')
  assert.equal(answer, '42', 'the command ran, in a shell')
  if (WIN) assert.ok(readSpans(file).has(Number(sleep)), 'on Windows also what it left in its group, by its Windows id')
  else assert.deepEqual([...readGroups(file).keys()], [leader])
  // Crew wasn't running when the CLI ended: the next start sweeps it
  hub.sweepStale()
  assert.ok(await gone(Number(sleep), 8000))
  assert.match(hub.feed.findLast((e) => e.kind === 'event').text, /left a process running \(sleep\)/)
})

test('a group number the system handed out again is left alone', async () => {
  const { out } = await leaveOne()
  const pid = Number(out)
  // written down long before this process existed: someone else's by now
  fs.writeFileSync(groupsFile('gal.0000f00d'), `${pid} ${now() - 86400}\n`)
  hub.runs.set('0000f00d', { name: 'gal', file: groupsFile('gal.0000f00d'), at: 0 })
  await hub.sweep('0000f00d')
  assert.ok(alive(pid))
  process.kill(pid, 'SIGKILL')
})

test("the runner says when a terminal's process is gone, with its tag, however it went", async () => {
  const r = new Runner()
  const ended = []
  r.on('ended', (name, tag) => ended.push([name, tag]))
  r.start('a', { ...program('process.exit(0)'), cwd: os.tmpdir(), env: {}, tag: 'run1' })
  r.start('b', { ...program('setTimeout(() => {}, 30000)'), cwd: os.tmpdir(), env: {}, tag: 'run2' })
  assert.ok(r.pid('b') > 0)
  await r.stop('b')
  for (let i = 0; i < 50 && ended.length < 2; i++) await new Promise((res) => setTimeout(res, 100))
  assert.deepEqual(ended.sort(), [['a', 'run1'], ['b', 'run2']])
})

// ---- Windows, on made-up process lists ------------------------------------------------------------------

// Unix seconds as a Windows file time, as Get-CimInstance says a process's CreationDate.
const filetime = (t) => String(Math.round((t + 11644473600) * 1e7))

test('the Windows process list as PowerShell writes it', () => {
  const t = 1_793_000_000.25
  const text = `\uFEFF0 0 0 System Idle Process\r\n4 0 0 System\r\n4120 3988 ${filetime(t)} node.exe\r\n5000 4120 ${filetime(t + 1.5)} Code - Insiders.exe\r\n\r\nWARNING: something\r\n`
  const procs = parseWindows(text)
  assert.deepEqual(procs.map((p) => [p.pid, p.ppid, p.name]), [[0, 0, 'System Idle Process'], [4, 0, 'System'], [4120, 3988, 'node'], [5000, 4120, 'Code - Insiders']])
  assert.equal(procs[0].start, 0)
  assert.ok(Math.abs(procs[2].start - t) < 0.001, 'to the millisecond')
  assert.ok(procs.every((p) => p.pgid === undefined), 'no process groups there')
})

test('Windows: a parent counts only if it started first, since a gone process keeps its id with its children', () => {
  const procs = [
    { pid: 100, ppid: 1, start: 1000 }, // the agent's CLI
    { pid: 200, ppid: 100, start: 1001 }, // its shell
    { pid: 300, ppid: 200, start: 990 }, // a child of whoever had 200 before: not the shell's
    { pid: 400, ppid: 200, start: 1002 },
  ]
  assert.deepEqual(tree(procs, 100).map((p) => p.pid).sort(), [100, 200, 400])
  assert.deepEqual([...groupsOf(procs, 100)], [[100, 1000], [200, 1001], [400, 1002]])
  // with process groups ppid is always true, and the start isn't looked at
  assert.deepEqual(tree(procs.map((p) => ({ ...p, pgid: 1 })), 100).map((p) => p.pid).sort(), [100, 200, 300, 400])
})

test("Windows: what's left is what descends from the agent's processes, while they were the agent's", () => {
  const t = 1_000_000
  const p = (pid, ppid, start) => ({ pid, ppid, start, name: `p${pid}` })
  const procs = [
    p(4, 0, 0),
    p(510, 500, t + 0.5), // 500 (a command's shell, written down by crew-sh) is gone: an orphan of it
    p(520, 510, t + 1), // and its child, through a parent that's still there
    p(530, 500, t + 600), // a child of whoever got 500 next, long after the agent's was last seen
    p(600, 1, t - 0.4), // a CLI written down a moment after it started, still running
    p(610, 600, t + 20),
    p(700, 1, t + 200), // 700 handed out again: not the one written down
    p(710, 700, t + 201),
    p(820, 810, t + 4), // a dev server whose shell (810) went: crew-sh wrote 810 down at the end
    p(900, 1, t - 50),
    p(910, 900, t + 2), // a child of an unrelated process
    p(950, 510, t + 3), // kept: another agent's, say
  ]
  const spans = new Map([[500, [[t, t]]], [600, [[t, t]]], [700, [[t, t]]], [810, [[t, t + 9]]]])
  const left = leftovers(procs, new Map([...spans].map(([k, [[s]]]) => [k, s])), new Set([950]), spans)
  assert.deepEqual(left.map((x) => x.pid).sort(), [510, 520, 600, 610, 820])
  // without when each was last seen, a start is all there is
  assert.deepEqual(leftovers(procs, new Map([[500, t]]), new Set([950])).map((x) => x.pid).sort(), [510, 520])
})

test("Windows: the agent's processes as written down, and what to add after a look", () => {
  const file = path.join(process.env.CREW_HOME, 'spans')
  fs.writeFileSync(file, '600 1000\n610 1005 1010\n610 1005 1040\n610 1900 1950\n1 1000\nnot a line\n')
  assert.deepEqual([...readSpans(file)], [[600, [[1000, 1000]]], [610, [[1005, 1040], [1900, 1950]]]])
  assert.deepEqual([...readGroups(file)], [[600, 1000], [610, 1005]], 'the same file, read the Unix way')
  const procs = [{ pid: 600, ppid: 4, start: 1000.2 }, { pid: 610, ppid: 600, start: 1005.7 }, { pid: 620, ppid: 600, start: 1100.1 }]
  assert.equal(noteworthy(procs, 600, readGroups(file), 1200), '600 1000 1200\n620 1100 1200\n', 'what is new, and the CLI seen now')
  const unix = procs.map((x) => ({ ...x, pgid: x.pid === 600 ? 600 : 620 }))
  assert.equal(noteworthy(unix, 600, new Map([[600, 1000]])), '620 1100.1\n', 'elsewhere, as before: groups not written down yet')
})

test("Windows: Crew's own parents are never swept (Crew started from an agent's terminal)", () => {
  const procs = [{ pid: 800, ppid: 4, start: 1 }, { pid: 850, ppid: 800, start: 2 }, { pid: 900, ppid: 850, start: 3 }, { pid: 860, ppid: 850, start: 2.5 }]
  assert.deepEqual(exempt(procs, 900), [850, 800])
  assert.deepEqual(exempt(procs.map((p) => ({ ...p, pgid: 850 })), 900), [850], 'elsewhere: its group')
  assert.deepEqual(exempt(procs, 12345), [])
})

test('Windows: Git Bash is found where Claude Code finds it', () => {
  const at = (...files) => (f) => files.includes(f)
  assert.equal(gitBash({ CLAUDE_CODE_GIT_BASH_PATH: 'D:\\Git\\bin\\bash.exe' }, at('D:\\Git\\bin\\bash.exe')), 'D:\\Git\\bin\\bash.exe')
  assert.equal(gitBash({ PATH: 'C:\\Windows;E:\\Tools\\Git\\cmd' }, at('E:\\Tools\\Git\\cmd\\git.exe', 'E:\\Tools\\Git\\bin\\bash.exe')), 'E:\\Tools\\Git\\bin\\bash.exe')
  assert.equal(gitBash({ PATH: 'E:\\Git\\mingw64\\bin' }, at('E:\\Git\\mingw64\\bin\\git.exe', 'E:\\Git\\bin\\bash.exe')), 'E:\\Git\\bin\\bash.exe')
  assert.equal(gitBash({ ProgramFiles: 'C:\\Program Files' }, at('C:\\Program Files\\Git\\bin\\bash.exe')), 'C:\\Program Files\\Git\\bin\\bash.exe')
  assert.equal(gitBash({ PATH: 'C:\\Windows\\System32' }, at('C:\\Windows\\System32\\bash.exe')), null, "WSL's bash isn't it")
})

test("the shell prefix: quoted by Claude Code itself, by name from the agent's PATH on Windows, never crew-sh twice", () => {
  assert.deepEqual(shellPrefix('/Applications/My Apps/Crew.app/bin', {}, 'darwin'), { CLAUDE_CODE_SHELL_PREFIX: '/Applications/My Apps/Crew.app/bin/crew-sh' })
  assert.deepEqual(shellPrefix('/Users/jean -luc/crew/bin', {}, 'darwin'), {}, 'Claude Code would take "-luc/crew/bin/crew-sh" for options')
  assert.deepEqual(shellPrefix('/crew/bin', { CLAUDE_CODE_SHELL_PREFIX: '/usr/local/bin/audit' }, 'darwin'), { CLAUDE_CODE_SHELL_PREFIX: '/crew/bin/crew-sh', CREW_SHELL_PREFIX: '/usr/local/bin/audit' })
  assert.deepEqual(shellPrefix('/crew/bin', { CLAUDE_CODE_SHELL_PREFIX: '/old/crew/bin/crew-sh' }, 'darwin'), { CLAUDE_CODE_SHELL_PREFIX: '/crew/bin/crew-sh' })
  const tried = []
  const works = (sh, bash, extra) => (tried.push([sh, bash, extra]), true)
  const env = { CLAUDE_CODE_SHELL_PREFIX: 'C:\\Users\\me\\.crew\\bin\\crew-sh.cmd', CLAUDE_CODE_GIT_BASH_PATH: '/bin/sh' }
  const bin = 'C:\\Users\\Jean -Luc\\AppData\\Local\\Programs\\Crew\\resources\\app.asar.unpacked\\bin'
  const win = shellPrefix(bin, { ...env, Path: 'C:\\Windows' }, 'win32', works)
  assert.equal(win.CLAUDE_CODE_SHELL_PREFIX, 'crew-sh', 'no path to quote, spaces and " -" and all: Git Bash finds it on PATH')
  assert.ok(!('CREW_SHELL_PREFIX' in win), "Crew started from an agent's terminal: crew-sh doesn't run itself")
  assert.equal(win.CREW_BASH, '/bin/sh')
  const tools = `${bin}\\win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  assert.deepEqual(tried, [['crew-sh', '/bin/sh', { Path: `${tools};C:\\Windows` }]], "tried in Git Bash first, with the agent's PATH")
  assert.deepEqual(shellPrefix('C:\\Crew\\bin', env, 'win32', () => false), {}, "if Git Bash won't run it, commands run without it")
  for (const arch of ['x64', 'arm64']) {
    const dir = path.join(BIN, `win32-${arch}`)
    assert.ok(fs.existsSync(path.join(dir, 'crew-sh')), `bin/win32-${arch}/crew-sh: what Git Bash finds on the agent's PATH`)
    assert.ok(fs.existsSync(path.join(dir, 'crew-sh.cmd')), 'what Claude Code finds for an MCP server on Windows, beside crew-sh')
    assert.match(fs.readFileSync(path.join(dir, 'crew-sh.cmd'), 'utf8'), /\r\n"%bash%" "%~dp0crew-sh" %\*\r\n/)
  }
})

test('crew-sh is tried in the shell that will run it, as Claude Code runs it, before agents get it', { skip: !SH && 'no Git Bash here' }, () => {
  // Windows: by name, from the agent's PATH; macOS: where it is
  const sh = WIN ? 'crew-sh' : path.join(BIN, 'crew-sh')
  const agent = WIN ? withTools(process.env, BIN) : {}
  assert.equal(prefixWorks(sh, SH, agent), true)
  assert.equal(prefixWorks(path.join(BIN, 'no-such-crew-sh'), SH, agent), false)
  assert.equal(prefixWorks(sh, null, agent), false, 'no Git Bash, no prefix')
  if (WIN) assert.equal(prefixWorks(sh, SH, { [pathKey()]: 'C:\\Windows\\System32' }), false, "not on the agent's PATH: no prefix")
})

test('bin/crew-sh on Windows still runs the command, with its exit code, when it can\'t say what it was', { skip: WIN }, async () => {
  // Git Bash's /proc isn't here: only the running part of the Windows way can be checked
  const file = path.join(process.env.CREW_HOME, 'win-groups')
  const { execFile } = await import('node:child_process')
  const run = (cmd) => new Promise((resolve) => {
    execFile('/bin/sh', [path.join(BIN, 'crew-sh'), cmd], { env: { ...process.env, OS: 'Windows_NT', CREW_GROUPS: file, CLAUDE_CODE_SHELL: '/bin/sh' } }, (e, out) => resolve({ code: e?.code ?? 0, out }))
  })
  assert.deepEqual(await run('echo "$((40 + 2))"'), { code: 0, out: '42\n' })
  assert.equal((await run('exit 7')).code, 7)
  assert.ok(!fs.existsSync(file) || fs.readFileSync(file, 'utf8') === '', 'nothing made up')
})

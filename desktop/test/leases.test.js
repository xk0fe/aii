// Things only one agent can use at a time (crew lease), and what an agent leaves running, stopped once its CLI is gone.
// The leases run against the real Hub with a fake runner; the sweeps against real processes. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-leases-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { Runner } = await import('../core/runner.js')
const { seconds, leftovers, readGroups } = await import('../core/procs.js')
const BIN = new URL('../bin', import.meta.url).pathname

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

// ---- what an agent leaves running ----------------------------------------------------------------------

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const gone = async (pid) => {
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100))
  return !alive(pid)
}
const now = () => Math.floor(Date.now() / 1000)
// A command the way Claude Code runs one: the leader of its own process group, gone once it's done, its `&` left behind.
function detached(cmd, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { detached: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('exit', () => resolve({ leader: p.pid, out: out.trim() }))
  })
}
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
  const { leader, out } = await detached(['/bin/sh', '-c', 'sleep 300 >/dev/null 2>&1 & echo $!'])
  const orphan = Number(out)
  assert.ok(alive(orphan))
  fs.writeFileSync(groupsFile('levi.0000beef'), `${leader} ${now()}\n`)
  hub.runs.set('0000beef', { name: 'levi', file: groupsFile('levi.0000beef'), at: 0 })
  await hub.sweep('0000beef')
  assert.ok(await gone(orphan), 'the sleep it left behind is stopped')
  assert.match(hub.feed.findLast((e) => e.kind === 'event').text, /^left a process running \(sleep\), so Crew stopped it$/)
  assert.equal(hub.feed.findLast((e) => e.kind === 'event').from, 'levi')
  assert.ok(!fs.existsSync(groupsFile('levi.0000beef')))
})

test('bin/crew-sh writes down each command\'s group and runs it as the shell would; Crew sweeps it later', async () => {
  const file = groupsFile('scarlett.0000cafe')
  const { leader, out } = await detached([path.join(BIN, 'crew-sh'), 'echo "$((40 + 2))"; sleep 300 >/dev/null 2>&1 & echo $!'], { CREW_GROUPS: file, SHELL: '/bin/sh' })
  const [answer, pid] = out.split('\n')
  assert.equal(answer, '42', 'the command ran, in a shell')
  assert.deepEqual([...readGroups(file).keys()], [leader])
  // Crew wasn't running when the CLI ended: the next start sweeps it
  hub.sweepStale()
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(await gone(Number(pid)))
  assert.match(hub.feed.findLast((e) => e.kind === 'event').text, /left a process running \(sleep\)/)
})

test('a group number the system handed out again is left alone', async () => {
  const { out } = await detached(['/bin/sh', '-c', 'sleep 300 >/dev/null 2>&1 & echo $!'])
  const pid = Number(out)
  // written down long before this group existed: someone else's by now
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
  r.start('a', { file: '/bin/sh', args: ['-c', 'exit 0'], cwd: os.tmpdir(), env: {}, tag: 'run1' })
  r.start('b', { file: '/bin/sh', args: ['-c', 'sleep 30'], cwd: os.tmpdir(), env: {}, tag: 'run2' })
  assert.ok(r.pid('b') > 0)
  await r.stop('b')
  for (let i = 0; i < 30 && ended.length < 2; i++) await new Promise((res) => setTimeout(res, 100))
  assert.deepEqual(ended.sort(), [['a', 'run1'], ['b', 'run2']])
})

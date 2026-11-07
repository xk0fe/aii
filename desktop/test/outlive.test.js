// Agents outliving Crew: a Crew quits mid-turn, the agent's CLI carries on in the terminal host, and the next Crew picks
// it up: what it was answering, its queue, a teammate's question, its clones, and the hook events it sent meanwhile
// (spooled by the hook itself). Against the real Hub with a fake runner that has survivors. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { WIN, BIN, SH } from './helpers/platform.mjs'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-outlive-'))
// no codex to discover: Hub.start would look its models up after the test is over (a Windows runner has none)
if (!WIN) process.env.PATH = '/usr/bin:/bin'
const { Hub, CONFIG } = await import('../core/hub.js')
const { adapters } = await import('../core/adapters.js')
const at = (f) => path.join(process.env.CREW_HOME, f)

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  starts = []
  stops = []
  constructor(survivors = []) {
    super()
    this.survivors = survivors
    for (const s of survivors) this.live.add(s.name)
  }
  running = (n) => this.live.has(n)
  start = (n) => (this.starts.push(n), this.live.add(n))
  stop = (n) => (this.stops.push(n), this.live.delete(n))
  submit = (n, text) => this.typed.push({ n, text })
  pid = () => 4242
  write() {}
}

const hubs = []
function crew(survivors) {
  const runner = new FakeRunner(survivors)
  const hub = new Hub(runner, { bin: BIN })
  hub.start('http://127.0.0.1:1', { survivors })
  hubs.push(hub)
  return { hub, runner }
}
// Crew quits: what it knows is saved, nothing of it keeps running here.
function quit(hub) {
  hub.saveRuntime(true)
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'steerTimer', 'retryTimer', 'reapTimer']) clearTimeout(a[t])
  clearInterval(hub.stallTimer)
  for (const t of ['runtimeTimer', 'statsTimer', 'convoTimer', 'usageTimer', 'readsTimer']) clearTimeout(hub[t])
  hub.keepRuntime = false
}
const spool = (name, events) => {
  fs.mkdirSync(at('spool'), { recursive: true })
  fs.appendFileSync(at(`spool/${name}.jsonl`), events.map((e) => JSON.stringify(e) + '\n').join(''))
}
const typedTo = (runner, name) => runner.typed.filter((t) => t.n === name).map((t) => t.text)

beforeEach(() => {
  for (const f of ['feed.jsonl', 'sessions.json', 'conversations.json', 'runtime.json', 'tickets.json']) fs.rmSync(at(f), { force: true })
  fs.rmSync(at('spool'), { recursive: true, force: true, maxRetries: 10 })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'ada', area: 'mobile app' }, { name: 'june', area: 'backend api' }] }))
})
afterEach(() => {
  for (const h of hubs.splice(0)) quit(h)
  fs.unwatchFile(CONFIG)
})
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

const ready = (hub, name) => {
  hub.restart(name) // agents rest until there's work: this one's up
  const a = hub.agents.get(name)
  a.status = 'idle'
  a.holdUntil = 0
  return a
}

test('Crew quits mid-turn; the next one picks the agent up: the reply threads, a question is answered, the queue goes in', async () => {
  const { hub, runner } = crew([])
  const ada = ready(hub, 'ada')
  ready(hub, 'june')
  // you ask ada for something, and he's on it
  hub.send({ to: 'ada', text: 'build option C of the hole card' })
  const yours = hub.feed.findLast((e) => e.kind === 'msg' && e.from === 'you')
  hub.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: typedTo(runner, 'ada').at(-1), session_id: 's1' })
  // june hands him more, which waits, and asks him something, which goes into the turn he's in
  hub.send({ from: 'june', to: 'ada', text: 'also fix the footer spacing', mentions: false })
  assert.match(await hub.question({ from: 'june', to: 'ada', text: 'which port does the dev API use?', hold: 20 }), /hasn't answered yet/)
  const asked = typedTo(runner, 'ada').at(-1)
  const run = ada.run
  quit(hub) // Crew is closed now; ada's CLI keeps going in the terminal host

  // meanwhile ada took the question in and finished his turn: his hooks couldn't reach Crew, so they spooled
  spool('ada', [
    { hook_event_name: 'UserPromptSubmit', prompt: asked, session_id: 's1' },
    { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm run screenshots' } },
    { hook_event_name: 'Stop', last_assistant_message: 'Option C is built, PR #4860. The dev API is on port 4000.' },
  ])

  const next = crew([{ name: 'ada', tag: run, pid: 4242 }])
  assert.ok(!next.runner.starts.includes('ada'), "ada isn't started again: he kept working")
  assert.ok(next.runner.starts.includes('june'), "june's CLI ended with the old Crew, and an answer waits for it, so it starts (resuming)")
  assert.ok(next.hub.feed.some((e) => e.kind === 'event' && /picked up @ada where it was/.test(e.text)))
  const reply = next.hub.feed.findLast((e) => e.kind === 'reply' && e.from === 'ada')
  assert.match(reply.text, /Option C is built/)
  assert.equal(reply.re, yours.id, 'the reply threads to your message')
  // the question's answer went back to june, ahead of anything else
  const answer = next.hub.agents.get('june').inbox.find((m) => m.answers)
  assert.match(answer.text, /port 4000/)
  // and ada, free now, gets the hand-off that waited for him (after the moment a CLI gets once its turn ends)
  await new Promise((r) => setTimeout(r, 700))
  assert.match(typedTo(next.runner, 'ada').at(-1), /also fix the footer spacing/)
  assert.equal(next.hub.agents.get('ada').status, 'working')
})

test('clones come back too; a terminal whose agent was removed meanwhile is stopped', () => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'ada', area: 'mobile app', clones: 2 }, { name: 'june', area: 'backend api' }] }))
  fs.writeFileSync(at('runtime.json'), JSON.stringify({
    agents: {
      ada: { run: 'aaaa1111', status: 'idle', inbox: [] },
      'ada.2': { run: 'bbbb2222', status: 'working', cloneOf: 'ada', clone: 2, inbox: [] },
      iris: { run: 'cccc3333', status: 'working', inbox: [] },
    },
  }))
  const { hub, runner } = crew([{ name: 'ada', tag: 'aaaa1111' }, { name: 'ada.2', tag: 'bbbb2222' }, { name: 'iris', tag: 'cccc3333' }, { name: 'june', tag: 'stale000' }])
  const clone = hub.agents.get('ada.2')
  assert.equal(clone.cloneOf, 'ada')
  assert.equal(clone.status, 'working')
  assert.equal(clone.area, 'mobile app', "it wears its original's settings")
  // iris isn't in the crew any more, and june's terminal isn't the one Crew knew: both stop, june rests until there's work
  assert.deepEqual(runner.stops.sort(), ['iris', 'june'])
  assert.equal(hub.agents.get('june').status, 'resting')
  assert.deepEqual(runner.starts, [])
})

test("an agent whose CLI ended while Crew was closed still gets what was queued for it, and a clone's goes to its original", () => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'ada', area: 'mobile app', clones: 2 }, { name: 'june', area: 'backend api' }] }))
  fs.writeFileSync(at('runtime.json'), JSON.stringify({
    agents: {
      june: { run: 'dead0001', status: 'working', inbox: [{ id: 'm1', ts: Date.now(), kind: 'msg', from: 'you', to: 'june', text: 'add rate limiting', queued: true }] },
      'ada.3': { run: 'dead0002', status: 'working', cloneOf: 'ada', clone: 3, inbox: [{ id: 'm2', ts: Date.now(), kind: 'msg', from: 'june', to: 'ada.3', text: 'check the build', queued: true }] },
    },
  }))
  const { hub } = crew([])
  assert.deepEqual(hub.agents.get('june').inbox.map((m) => m.text), ['add rate limiting'])
  assert.deepEqual(hub.agents.get('ada').inbox.map((m) => [m.text, m.to]), [['check the build', 'ada']])
  assert.ok(!hub.agents.has('ada.3'))
})

test('the hook spools what it sends while Crew is closed, one line per event, and still sends it when Crew is there', async () => {
  const settings = JSON.parse(adapters.claude({ name: 'ada' }, { session: 's', attachments: os.tmpdir(), bin: BIN }).args.find((x) => x.startsWith('{"permissions"')))
  // as Claude Code runs it: a command line for sh on macOS; crew-hook.exe and its arguments, with no shell, on Windows
  const { command, args } = settings.hooks.Stop[0].hooks[0]
  const [file, argv] = WIN ? [command, args] : ['/bin/sh', ['-c', command]]
  const env = { ...process.env, CREW_HOME: process.env.CREW_HOME, CREW_NODE: process.execPath, CREW_AGENT: 'ada', CREW_WORKSPACE: '' }
  const payload = JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'line one\nline two' }, null, 2) // even spread over lines
  // Crew closed: its last address answers nothing
  fs.writeFileSync(at('url'), 'http://127.0.0.1:9')
  fs.writeFileSync(at('token'), 'old')
  execFileSync(file, argv, { input: payload, env })
  const lines = fs.readFileSync(at('spool/ada.jsonl'), 'utf8').split('\n').filter(Boolean)
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]).last_assistant_message, 'line one\nline two')
  // Crew back (a new address and token, which the hook reads each time): it goes straight there
  const got = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => (got.push([req.url, req.headers['x-crew'], JSON.parse(body).hook_event_name]), res.end('ok\n')))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  fs.writeFileSync(at('url'), `http://127.0.0.1:${server.address().port}`)
  fs.writeFileSync(at('token'), 'new')
  await new Promise((resolve, reject) => {
    import('node:child_process').then(({ execFile }) => {
      const p = execFile(file, argv, { env }, (e) => (e ? reject(e) : resolve()))
      p.stdin.end(payload)
    })
  })
  server.close()
  assert.deepEqual(got, [['/hook/ada', 'new', 'Stop']])
  assert.equal(fs.readFileSync(at('spool/ada.jsonl'), 'utf8').split('\n').filter(Boolean).length, 1, 'nothing more spooled')
})

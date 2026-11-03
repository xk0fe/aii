// The first time a CLI runs in a folder it asks whether you trust it. Crew hands that question to you instead of
// typing a message into it, and delivers once you've answered. Screens as Claude Code 2.1.300 and Codex 0.162 draw
// them (trimmed). Real Hub, fake runner and clock, throwaway CREW_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-trust-'))
const { Hub, CONFIG } = await import('../core/hub.js')
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 }))

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  keys = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push(text)
  write = (n, data) => this.keys.push(data)
  draw = (n, data) => this.emit('data', n, data)
}

const CODEX_TRUST = '\x1b[2J\x1b[H>_ OpenAI Codex (v0.162.1)\r\n\x1b[1m› \x1b[0mAsk Codex to do anything\r\n\x1b[38;5;8m? for shortcuts\x1b[0m\r\n\x1b[10;3HTrust this folder?\x1b[11;3HCodex can read, edit, and run files here, subject to your permission settings.\x1b[13;3H\x1b[36m› 1. Trust and continue\x1b[0m\x1b[14;5H2. Quit\x1b[16;3Henter continue · esc quit'
// Claude moves the cursor between words instead of printing spaces
const CLAUDE_TRUST = '\x1b[?25l Accessing workspace:\x1b[2C/Users/me/new-project\r\n Quick\x1b[1Csafety\x1b[1Ccheck:\x1b[1CIs\x1b[1Cthis\x1b[1Ca\x1b[1Cproject\x1b[1Cyou\x1b[1Ccreated\x1b[1Cor\x1b[1Cone\x1b[1Cyou\x1b[1Ctrust?\r\n\x1b[36m❯\x1b[1C1.\x1b[1CNo,\x1b[1Cexit\x1b[0m\r\n\x1b[3C2.\x1b[1CYes,\x1b[1CI\x1b[1Ctrust\x1b[1Cthis\x1b[1Cfolder\r\n Enter\x1b[1Cto\x1b[1Cconfirm'

let hub, runner, alerts
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json']) fs.rmSync(path.join(process.env.CREW_HOME, f), { force: true })
  const cwd = os.tmpdir()
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'rex', area: 'art', provider: 'codex', cwd }, { name: 'june', area: 'backend', cwd }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  hub.url = 'http://127.0.0.1:1'
  alerts = []
  hub.on('alert', (a, text) => alerts.push(`${a.name}: ${text}`))
})
afterEach(() => {
  mock.timers.reset()
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'steerTimer']) clearTimeout(a[t])
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})

const agent = (name) => hub.agents.get(name)
const launch = (name) => (hub.launch(agent(name)), agent(name))

test('Codex asks to trust its folder: you hear about it, and the message waits instead of being typed into it', () => {
  const rex = launch('rex')
  hub.send({ to: 'rex', text: 'draw the cover' })
  runner.draw('rex', CODEX_TRUST.slice(0, 120))
  runner.draw('rex', CODEX_TRUST.slice(120))
  assert.equal(rex.status, 'waiting')
  assert.match(alerts.at(-1), /^rex: asks whether to trust its folder, .*Answer in its terminal: messages wait until then$/)
  mock.timers.tick(60000)
  assert.deepEqual(runner.typed, [], 'nothing typed into the dialog')
  // you press Enter on "Trust and continue" in its terminal
  hub.input('rex', '\r')
  assert.deepEqual(runner.keys, ['\r'])
  assert.equal(rex.status, 'starting')
  mock.timers.tick(3000)
  assert.equal(rex.status, 'working')
  assert.deepEqual(runner.typed, ['draw the cover'])
})

test('Claude Code asks to trust its folder: it says so, and starts when you answer', () => {
  const june = launch('june')
  hub.send({ to: 'june', text: 'fix the 500s' })
  runner.draw('june', CLAUDE_TRUST)
  assert.equal(june.status, 'waiting')
  assert.equal(alerts.length, 1)
  hub.input('june', '\x1b[B') // down to "Yes, I trust this folder"
  runner.draw('june', CLAUDE_TRUST) // it redraws the dialog: still one alert
  assert.equal(alerts.length, 1)
  assert.equal(june.status, 'waiting')
  hub.input('june', '\r')
  assert.equal(june.status, 'starting')
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(3000) // you just typed there: Crew holds off for three seconds, as always
  assert.deepEqual(runner.typed, ['fix the 500s'])
})

test('a folder it already trusts: no question, and Codex is ready after three seconds as before', () => {
  const rex = launch('rex')
  hub.send({ to: 'rex', text: 'draw the cover' })
  runner.draw('rex', '>_ OpenAI Codex (v0.162.1)\r\n› Ask Codex to do anything')
  mock.timers.tick(3000)
  assert.deepEqual(alerts, [])
  assert.deepEqual(runner.typed, ['draw the cover'])
})

test('once it has taken a prompt, the words on its screen are just output', () => {
  const rex = launch('rex')
  mock.timers.tick(3000)
  hub.send({ to: 'rex', text: 'what does the trust dialog say?' })
  hub.onHook('rex', { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  runner.draw('rex', CODEX_TRUST)
  assert.equal(rex.status, 'working')
  assert.deepEqual(alerts, [])
})

test('a resumed conversation that only mentions the question is no question', () => {
  const rex = launch('rex')
  runner.draw('rex', '› Why does Codex ask "Trust this folder?" every time?\r\n• Because the folder is not in config.toml.')
  assert.equal(rex.status, 'starting')
  assert.deepEqual(alerts, [])
})

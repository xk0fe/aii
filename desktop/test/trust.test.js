// The first time a CLI runs in a folder it asks whether you trust it. Crew hands that question to you instead of
// typing a message into it, as a card in the chat, and delivers once you've answered, there or in its terminal.
// Screens as Claude Code 2.1.300 / 2.1.318 and Codex 0.162 draw them (trimmed). Real Hub, fake runner and clock, throwaway CREW_HOME. Run with `npm test`.
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
  draw = (n, data) => ((this.screen = (this.screen ?? '') + data), this.emit('data', n, data))
  buffer = () => ({ data: this.screen ?? '' })
}

const CODEX_TRUST = '\x1b[2J\x1b[H>_ OpenAI Codex (v0.162.1)\r\n\x1b[1m› \x1b[0mAsk Codex to do anything\r\n\x1b[38;5;8m? for shortcuts\x1b[0m\r\n\x1b[10;3HTrust this folder?\x1b[11;3HCodex can read, edit, and run files here, subject to your permission settings.\x1b[13;3H\x1b[36m› 1. Trust and continue\x1b[0m\x1b[14;5H2. Quit\x1b[16;3Henter continue · esc quit'
// Claude moves the cursor between words instead of printing spaces
const CLAUDE_TRUST_OLD = '\x1b[?25l Accessing workspace:\x1b[2C/Users/me/new-project\r\n Quick\x1b[1Csafety\x1b[1Ccheck:\x1b[1CIs\x1b[1Cthis\x1b[1Ca\x1b[1Cproject\x1b[1Cyou\x1b[1Ccreated\x1b[1Cor\x1b[1Cone\x1b[1Cyou\x1b[1Ctrust?\r\n\x1b[36m❯\x1b[1C1.\x1b[1CNo,\x1b[1Cexit\x1b[0m\r\n\x1b[3C2.\x1b[1CYes,\x1b[1CI\x1b[1Ctrust\x1b[1Cthis\x1b[1Cfolder\r\n Enter\x1b[1Cto\x1b[1Cconfirm'

// 2.1.318: no numbers, and moving the selection redraws just the two answers
const CLAUDE_TRUST = '\x1b[?25l Accessing workspace:\x1b[2C/Users/me/new-project\r\n Quick\x1b[1Csafety\x1b[1Ccheck:\x1b[1CIs\x1b[1Cthis\x1b[1Ca\x1b[1Cproject\x1b[1Cyou\x1b[1Ccreated\x1b[1Cor\x1b[1Cone\x1b[1Cyou\x1b[1Ctrust?\r\n Security\x1b[1Cguide\r\n\x1b[36m❯\x1b[1CNo,\x1b[1Cexit\x1b[0m\r\n\x1b[2CYes,\x1b[1CI\x1b[1Ctrust\x1b[1Cthis\x1b[1Cfolder\r\n Enter\x1b[1Cto\x1b[1Cconfirm\x1b[1C·\x1b[1CEsc\x1b[1Cto\x1b[1Ccancel'
const CLAUDE_ON_YES = '\x1b[3A\r\x1b[2CNo,\x1b[1Cexit\r\n\x1b[36m❯\x1b[1CYes,\x1b[1CI\x1b[1Ctrust\x1b[1Cthis\x1b[1Cfolder\x1b[0m'
const CLAUDE_ON_NO = '\x1b[3A\r\x1b[36m❯\x1b[1CNo,\x1b[1Cexit\x1b[0m\r\n\x1b[2CYes,\x1b[1CI\x1b[1Ctrust\x1b[1Cthis\x1b[1Cfolder'
const CODEX_ON_QUIT = '\x1b[13;3H  1. Trust and continue\x1b[14;3H\x1b[36m› 2. Quit\x1b[0m'
const DOWN = '\x1b[B'
const UP = '\x1b[A'

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
const card = (name) => hub.feed.findLast((e) => e.kind === 'ask' && e.from === name)

test('Codex asks to trust its folder: you hear about it, and the message waits instead of being typed into it', () => {
  const rex = launch('rex')
  hub.send({ to: 'rex', text: 'draw the cover' })
  runner.draw('rex', CODEX_TRUST.slice(0, 120))
  runner.draw('rex', CODEX_TRUST.slice(120))
  assert.equal(rex.status, 'waiting')
  assert.match(alerts.at(-1), /^rex: asks whether to trust its folder, .*Messages wait until you answer$/)
  assert.deepEqual(card('rex').ask, { type: 'permission', trust: true, title: 'Trust this folder', detail: os.tmpdir(), say: `First time in ${path.basename(os.tmpdir())}. Can I trust this folder?`, always: [], alert: alerts.at(-1).slice(5) })
  mock.timers.tick(60000)
  assert.deepEqual(runner.typed, [], 'nothing typed into the dialog')
  assert.deepEqual(runner.keys, [], 'nor any key')
  // you press Enter on "Trust and continue" in its terminal: the card says so
  hub.input('rex', '\r')
  assert.deepEqual(runner.keys, ['\r'])
  assert.equal(rex.status, 'starting')
  assert.equal(card('rex').answer.by, 'terminal')
  assert.equal(hub.asks.size, 0)
  mock.timers.tick(3000)
  assert.equal(rex.status, 'working')
  assert.deepEqual(runner.typed, ['draw the cover'])
})

test('Claude Code asks to trust its folder: it says so, and starts when you answer', () => {
  const june = launch('june')
  hub.send({ to: 'june', text: 'fix the 500s' })
  runner.draw('june', CLAUDE_TRUST_OLD)
  assert.equal(june.status, 'waiting')
  assert.equal(alerts.length, 1)
  hub.input('june', '\x1b[B') // down to "Yes, I trust this folder"
  runner.draw('june', CLAUDE_TRUST_OLD) // it redraws the dialog: still one alert
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

// ---- answered from the chat ------------------------------------------------------------------------

test('Trust in the chat: Claude Code\'s selection moves to "Yes" first, and Enter goes in once its screen shows it there', () => {
  const june = launch('june')
  hub.send({ to: 'june', text: 'fix the 500s' })
  runner.draw('june', CLAUDE_TRUST)
  hub.answer(card('june').id, { allow: true })
  assert.deepEqual(card('june').answer && { by: card('june').answer.by, allow: card('june').answer.allow }, { by: 'you', allow: true })
  assert.deepEqual(runner.keys, [], 'not the moment it asked: it redraws the question right after')
  mock.timers.tick(1500)
  assert.deepEqual(runner.keys, [DOWN])
  runner.draw('june', CLAUDE_ON_YES)
  mock.timers.tick(300)
  assert.deepEqual(runner.keys, [DOWN, '\r'])
  assert.equal(june.status, 'starting')
  assert.equal(hub.asks.size, 0)
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(3000)
  assert.deepEqual(runner.typed, ['fix the 500s'])
})

test('a redraw back on "No" while it picks: it moves again, and never presses Enter on "No"', () => {
  const june = launch('june')
  runner.draw('june', CLAUDE_TRUST)
  mock.timers.tick(2000)
  hub.answer(card('june').id, { allow: true })
  mock.timers.tick(0)
  assert.deepEqual(runner.keys, [DOWN])
  runner.draw('june', CLAUDE_ON_YES)
  runner.draw('june', CLAUDE_ON_NO) // its startup redraw lands right after
  mock.timers.tick(300)
  assert.deepEqual(runner.keys, [DOWN, DOWN])
  runner.draw('june', CLAUDE_ON_YES)
  mock.timers.tick(300)
  assert.deepEqual(runner.keys, [DOWN, DOWN, '\r'])
})

test('Codex already sits on "Trust and continue": Trust in the chat is just Enter, and the message follows', () => {
  const rex = launch('rex')
  hub.send({ to: 'rex', text: 'draw the cover' })
  runner.draw('rex', CODEX_TRUST)
  mock.timers.tick(5000)
  hub.answer(card('rex').id, { allow: true })
  mock.timers.tick(0)
  assert.deepEqual(runner.keys, ['\r'])
  assert.equal(rex.status, 'starting')
  runner.draw('rex', '› ')
  mock.timers.tick(3000)
  assert.deepEqual(runner.typed, ['draw the cover'])
})

test("woken by a message, Codex isn't typed into before it has drawn anything: its trust question may be still to come", () => {
  const rex = launch('rex')
  hub.send({ to: 'rex', text: 'draw the cover' })
  mock.timers.tick(3000)
  assert.deepEqual(runner.typed, [], 'nothing on its screen yet')
  assert.equal(rex.status, 'starting')
  mock.timers.tick(3000)
  runner.draw('rex', CODEX_TRUST)
  assert.deepEqual(runner.typed, [], 'the question came late, and the message waits for it')
  assert.ok(card('rex'))
})

test('a Codex that draws nothing at all still counts as ready after a while', () => {
  const rex = launch('rex')
  mock.timers.tick(36000)
  assert.equal(rex.status, 'idle')
})

test("Don't trust: it moves to Quit and presses Enter there", () => {
  const rex = launch('rex')
  runner.draw('rex', CODEX_TRUST)
  mock.timers.tick(5000)
  hub.answer(card('rex').id, { allow: false })
  assert.equal(card('rex').answer.allow, false)
  mock.timers.tick(0)
  assert.deepEqual(runner.keys, [DOWN])
  runner.draw('rex', CODEX_ON_QUIT)
  mock.timers.tick(300)
  assert.deepEqual(runner.keys, [DOWN, '\r'])
})

test('"Yes" drawn above "No": it moves up', () => {
  const june = launch('june')
  runner.draw('june', ' Do you trust the files in this folder?\r\n   1. Yes, I trust this folder\r\n \x1b[36m❯ 2. No, exit\x1b[0m')
  hub.answer(card('june').id, { allow: true })
  mock.timers.tick(1500)
  assert.deepEqual(runner.keys, [UP])
})

test("a screen that never shows the answer: no Enter, and the question goes back to you in its terminal", () => {
  const june = launch('june')
  runner.draw('june', CLAUDE_TRUST)
  hub.answer(card('june').id, { allow: true })
  mock.timers.tick(1500)
  for (let i = 0; i < 5; i++) mock.timers.tick(1000) // it never redraws
  assert.deepEqual(runner.keys, [DOWN, DOWN, DOWN, DOWN])
  assert.equal(june.status, 'waiting')
  assert.match(alerts.at(-1), /couldn't answer it for you\. Answer in its terminal/)
  // so you do
  hub.input('june', '\r')
  assert.equal(june.status, 'starting')
})

test('typing in its terminal while CLIque picks: you answer it, CLIque stops', () => {
  const june = launch('june')
  runner.draw('june', CLAUDE_TRUST)
  hub.answer(card('june').id, { allow: true })
  mock.timers.tick(1500)
  hub.input('june', UP)
  mock.timers.tick(5000)
  assert.deepEqual(runner.keys, [DOWN, UP])
})

test('trusting the folder for one answers it for every agent on that CLI asking about the same folder', () => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'june', cwd: os.tmpdir() }, { name: 'ada', cwd: os.tmpdir() }, { name: 'rex', provider: 'codex', cwd: os.tmpdir() }] }))
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const n of ['june', 'ada']) launch(n), runner.draw(n, CLAUDE_TRUST)
  launch('rex')
  runner.draw('rex', CODEX_TRUST)
  hub.answer(card('june').id, { allow: true })
  assert.equal(card('ada').answer.allow, true)
  assert.equal(card('rex').answer, undefined, 'Codex asks about its own trust')
  mock.timers.tick(1500)
  for (const n of ['june', 'ada']) runner.draw(n, CLAUDE_ON_YES)
  mock.timers.tick(300)
  assert.equal(agent('june').status, 'starting')
  assert.equal(agent('ada').status, 'starting')
  assert.equal(agent('rex').status, 'waiting')
})

test('it exits before you answer: the card closes, and nothing is typed', () => {
  const june = launch('june')
  runner.draw('june', CLAUDE_TRUST)
  hub.answer(card('june').id, { allow: true })
  runner.live.delete('june')
  hub.onExit('june', 1, 9000)
  mock.timers.tick(5000)
  assert.deepEqual(runner.keys, [])
  assert.equal(june.status, 'stopped')
})

test('CLIque restarts while it asks: its card comes back, and Trust there still works', () => {
  const june = launch('june')
  hub.send({ to: 'june', text: 'fix the 500s' })
  runner.draw('june', CLAUDE_TRUST)
  hub.saveRuntime(true)
  // its CLI kept running in the terminal host, its question on screen
  const host = new FakeRunner()
  host.live.add('june')
  host.screen = runner.screen
  const again = new Hub(host, { bin: '/nonexistent' })
  again.url = 'http://127.0.0.1:1'
  again.adopt([{ name: 'june', tag: june.run }])
  const j = again.agents.get('june')
  assert.equal(j.status, 'waiting')
  const q = [...again.asks.values()].find((x) => x.trust && x.name === 'june')
  assert.ok(q, 'its card is up again')
  assert.equal(again.feed.filter((e) => e.kind === 'ask' && e.from === 'june' && !e.answer).length, 1, 'one open card: the old one closed with CLIque')
  again.answer(q.entry.id, { allow: true })
  mock.timers.tick(1500)
  assert.deepEqual(host.keys, [DOWN])
  host.draw('june', CLAUDE_ON_YES)
  mock.timers.tick(300)
  assert.deepEqual(host.keys, [DOWN, '\r'])
  assert.equal(j.status, 'starting')
  again.onHook('june', { hook_event_name: 'SessionStart', source: 'startup' })
  mock.timers.tick(3000)
  assert.deepEqual(host.typed, ['fix the 500s'])
  for (const t of ['readyTimer', 'steerTimer']) clearTimeout(j[t])
  clearTimeout(again.statsTimer)
  clearTimeout(again.convoTimer)
})

test('a redraw of the answers after Enter is no new question; SessionStart closes a card that came back anyway', () => {
  const june = launch('june')
  hub.send({ to: 'june', text: 'fix the 500s' })
  runner.draw('june', CLAUDE_TRUST)
  hub.input('june', DOWN)
  hub.input('june', '\r')
  runner.draw('june', CLAUDE_ON_YES) // the redraw from Down, landing after Enter
  assert.equal(hub.feed.filter((e) => e.kind === 'ask').length, 1)
  assert.equal(june.status, 'starting')
  // and if the whole question did come back on screen, SessionStart says it was answered
  runner.draw('june', CLAUDE_TRUST)
  assert.equal(june.status, 'waiting')
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'startup' })
  assert.equal(hub.asks.size, 0)
  mock.timers.tick(3000)
  assert.deepEqual(runner.typed, ['fix the 500s'])
})

test("turned off while it asks: its card closes, and Trust can't type into a stopped terminal", () => {
  const june = launch('june')
  runner.draw('june', CLAUDE_TRUST)
  const id = card('june').id
  runner.live.delete('june')
  hub.setStatus(june, 'off')
  assert.equal(card('june').answer.stale, true)
  assert.equal(hub.asks.size, 0)
  assert.throws(() => hub.answer(id, { allow: true }), /already been answered/)
  mock.timers.tick(5000)
  assert.deepEqual(runner.keys, [])
})

test("Don't trust on a resumed conversation: it quits and keeps its conversation, no fresh start", () => {
  hub.saveSession('june', '11111111-2222-3333-4444-555555555555')
  const june = launch('june')
  assert.equal(june.resumed, true)
  runner.draw('june', CLAUDE_TRUST)
  mock.timers.tick(1500)
  hub.answer(card('june').id, { allow: false })
  mock.timers.tick(0)
  assert.deepEqual(runner.keys, ['\r'], '"No, exit" is already selected')
  runner.live.delete('june')
  hub.onExit('june', 1, 2000)
  assert.equal(june.status, 'stopped')
  assert.equal(hub.sessions.june, '11111111-2222-3333-4444-555555555555')
  assert.equal(hub.feed.at(-1).text, "quit: its folder wasn't trusted")
})

test('steady output while it picks (Codex animates for half a minute): it still presses a key every second at most', () => {
  const june = launch('june')
  runner.draw('june', CLAUDE_TRUST)
  hub.answer(card('june').id, { allow: true })
  for (let i = 0; i < 100; i++) runner.draw('june', '\x1b]0;⠋ claude\x07'), mock.timers.tick(100) // never quiet for 300 ms
  assert.deepEqual(runner.keys, [DOWN, DOWN, DOWN, DOWN], 'no Enter: its screen never showed "Yes"')
  assert.equal(card('june').answer.by, 'terminal', 'the card says it went back to the terminal, not "Trusted"')
  assert.match(alerts.at(-1), /couldn't answer it for you/)
})

test('an answer it doesn\'t name selected ("No, continue without these permissions"): it moves to "Yes" all the same', () => {
  const june = launch('june')
  runner.draw('june', ' Do you trust the files in this folder?\r\n \x1b[36m❯ No, continue without these permissions\x1b[0m\r\n   Yes, I trust this folder')
  hub.answer(card('june').id, { allow: true })
  mock.timers.tick(1500)
  assert.deepEqual(runner.keys, [DOWN])
})

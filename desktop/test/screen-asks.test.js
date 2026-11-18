// What a CLI asks in its terminal that no hook brings to CLIque is read off its screen (core/screen.js) and becomes a
// card in the chat, so nothing an agent needs from you takes its terminal: the question as the screen says it, its
// choices, and the one you pick picked in the terminal for you. The screens are real ones (test/screens.json). Real
// Hub, fake runner and clock, throwaway CLIQUE_HOME. Run with `npm test`.
import { test, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-screen-asks-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { screenOf, dialogOf, keyToward, screenTail } = await import('../core/screen.js')
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

const SCREENS = JSON.parse(fs.readFileSync(new URL('./screens.json', import.meta.url), 'utf8'))
const real = (name) => (SCREENS.raw[name] ? screenOf({ data: SCREENS.raw[name] }) : SCREENS.lines[name])
const DOWN = '\x1b[B'
const UP = '\x1b[A'

// ---- reading a screen -----------------------------------------------------------------------------------------------

test("the menus Claude Code and Codex draw, read as you'd read them: the question, its choices, the one selected", () => {
  const trust = dialogOf(real('claudeTrust'))
  assert.equal(trust.title, 'Accessing workspace:')
  assert.match(trust.text, /^Accessing workspace:\n\n\/Users\/me\/new-project\n[\s\S]*Quick safety check: Is this a project you created or one you trust\?/)
  assert.deepEqual(trust.options, [{ label: 'No, exit' }, { label: 'Yes, I trust this folder' }], 'no numbers since 2.1.318: the pointer says which')
  assert.equal(trust.selected, 0)

  const bash = dialogOf(real('claudeBash'))
  assert.equal(bash.title, 'Bash command')
  assert.equal(bash.text.split('\n').at(-1), 'Do you want to proceed?')
  assert.match(bash.text, /\ntouch made-by-probe\.txt\n/, 'the command, between its dashed rules')
  assert.deepEqual(bash.options, [
    { label: 'Yes' },
    { label: 'Yes, and always allow access to', description: '/Users/me/storefront from this project' }, // (a line of its own under it)
    { label: 'Yes, and switch to auto mode · auto mode handles these prompts for you' },
    { label: 'No' },
  ])

  const question = dialogOf(real('claudeQuestion'))
  assert.equal(question.text, '☐ Button colour\n\nWhich colour should the button be?', "the prompt you typed above it isn't part of it")
  assert.deepEqual(question.options.map((o) => o.label), ['Red (warm)', 'Blue (calm)', 'Green (fresh)', 'Type something.', 'Chat about this'], 'a rule between two choices')
  assert.equal(question.options[1].description, 'A calm, cool blue.')

  const codex = dialogOf(real('codexApprove'))
  assert.equal(codex.title, 'Would you like to run the following command?')
  assert.match(codex.text, /Reason: Do you approve running `touch codex-probe\.txt` outside the sandbox\?\n\n\$ touch codex-probe\.txt$/)
  assert.deepEqual(codex.options.map((o) => o.label), ['Yes, proceed', "Yes, and don't ask again for commands that start with `touch codex-probe.txt`", 'No, and tell Codex what to do differently'], 'its keys, (y) (p) (esc), left off')
})

test('no menu: a reply made to look like one, a working spinner, an empty prompt, nothing at all', () => {
  assert.equal(dialogOf(real('claudeReply')), null, 'Claude listing "❯ 1. Enter to confirm" in a reply is no menu')
  assert.equal(dialogOf([' ✻ Thinking… (12s · esc to interrupt)', '', '❯ ']), null)
  assert.equal(dialogOf(['› Ask Codex to do anything', '', '  ? for shortcuts']), null)
  assert.equal(dialogOf([]), null)
  // numbers that skip, or two choices selected: not a menu either
  assert.equal(dialogOf([' Pick one', ' ❯ 1. A', '   3. B', ' Enter to confirm']), null)
  assert.equal(dialogOf([' Pick one', ' ❯ A', ' ❯ B', ' Enter to confirm']), null)
})

test('the key toward a choice, and what a screen without a menu shows at its foot', () => {
  const d = dialogOf(real('claudeBash'))
  assert.equal(keyToward(d, 3), DOWN)
  assert.equal(keyToward(d, 0), '')
  assert.equal(keyToward({ ...d, selected: 2 }, 1), UP)
  assert.match(screenTail(real('claudeReply')), /⏺ 1\. Apple\n {2}2\. Banana\n {2}3\. Cherry\n\n {2}❯ 1\. Enter to confirm\n\n✻ Baked for 2s/)
  assert.ok(!/─{10}/.test(screenTail(real('claudeReply'))), "its prompt box's rules left out")
})

// ---- the hub --------------------------------------------------------------------------------------------------------

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  keys = []
  screens = new Map()
  drawn = new Map()
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push(text)
  write = (n, data) => this.keys.push(data)
  buffer = (n) => ({ data: this.screens.get(n) ?? '', cols: 120, rows: 36 })
  quietFor = (n) => Date.now() - (this.drawn.get(n) ?? 0)
  draw(n, data) {
    this.screens.set(n, (this.screens.get(n) ?? '') + data)
    this.drawn.set(n, Date.now())
    this.emit('data', n, data)
  }
  // a screen drawn whole: lines, or what a CLI wrote
  show(n, screen) {
    this.screens.set(n, '')
    this.draw(n, `\x1b[2J\x1b[H${Array.isArray(screen) ? screen.join('\r\n') : screen}`)
  }
}

// Codex's approval with the pointer on choice i, as it redraws it when the selection moves
const codexOn = (i) => SCREENS.lines.codexApprove.map((l) => l.replace(/^(?:› | {2})([123]\. )/, (_, rest) => (rest.startsWith(`${i + 1}.`) ? '› ' : '  ') + rest))
// a question a CLI asks before it starts, as Claude Code draws its menus
const MCP = (i = 0) => [' New MCP server found in .mcp.json: figma', '', ' MCP servers may execute code or access system resources. All tool calls require approval.', '', ...['Use this and all future MCP servers in this project', 'Use this MCP server', 'Continue without using this MCP server'].map((t, n) => ` ${n === i ? '❯' : ' '} ${n + 1}. ${t}`), '', ' Enter to confirm · Esc to cancel']
const RESUME = (i = 0) => [' Resume this conversation?', '', ' This conversation has been inactive for 3h and is 900k tokens long. Resuming it will use about 18% of your 5-hour usage limit.', '', ...['Resume from summary (recommended)', 'Resume full session as-is', "Don't ask me again"].map((t, n) => ` ${n === i ? '❯' : ' '} ${n + 1}. ${t}`), '', ' Enter to confirm · Esc to cancel']
const PROMPT = [' ▐▛███▜▌   Claude Code v2.1.321', '', '────', '❯ ', '────', '  ? for shortcuts']

let hub, runner, alerts
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'stats.json']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
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
  for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'readyTimer', 'steerTimer', 'screenTimer', 'startTimer', 'retryTimer']) clearTimeout(a[t])
  for (const a of hub.agents.values()) clearTimeout(a.screenPick?.timer)
  clearTimeout(hub.statsTimer)
  clearTimeout(hub.convoTimer)
})

const agent = (name) => hub.agents.get(name)
const card = (name) => hub.feed.findLast((e) => e.kind === 'ask' && e.from === name)
const cards = (name) => hub.feed.filter((e) => e.kind === 'ask' && e.from === name)
const pick = (name, label) => hub.answer(card(name).id, { answers: { [card(name).ask.questions[0].question]: label } })
// at work on a message of yours, its terminal up
function atWork(name, text = 'draw the cover') {
  const a = agent(name)
  runner.live.add(name)
  a.status = 'idle'
  hub.send({ to: name, text })
  hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.at(-1) })
  assert.equal(a.status, 'working')
  return a
}
// its terminal stays as it is long enough for CLIque to look at it (with CLIque running, every few seconds)
const still = () => (mock.timers.tick(4500), hub.screenTick())

test("Codex's own approval, up once its hook stopped waiting: a card with its choices, picked from the chat in its terminal", () => {
  const rex = atWork('rex')
  runner.show('rex', SCREENS.lines.codexApprove)
  still()
  const ask = card('rex').ask
  assert.equal(ask.screen, true)
  assert.equal(ask.type, 'question', 'a question with options: a phone draws it as it draws any')
  assert.deepEqual(ask.questions[0].options.map((o) => o.label), ['Yes, proceed', "Yes, and don't ask again for commands that start with `touch codex-probe.txt`", 'No, and tell Codex what to do differently'])
  assert.deepEqual(alerts, ['rex: asks in its terminal: Would you like to run the following command?'])
  assert.equal(ask.say, 'Do you approve running `touch codex-probe.txt` outside the sandbox?', 'what its creature says: the question in it')
  assert.equal(rex.status, 'waiting')
  assert.equal(hub.asking('rex'), true, 'nothing is typed into it meanwhile')
  still()
  assert.equal(cards('rex').length, 1, 'one card for one question')
  // you pick its "No": two arrows, each once the screen shows the last one moved it, then Enter
  pick('rex', 'No, and tell Codex what to do differently')
  assert.deepEqual(runner.keys, [DOWN])
  runner.show('rex', codexOn(1))
  mock.timers.tick(300)
  assert.deepEqual(runner.keys, [DOWN, DOWN])
  runner.show('rex', codexOn(2))
  mock.timers.tick(300)
  assert.deepEqual(runner.keys, [DOWN, DOWN, '\r'])
  assert.equal(card('rex').answer.by, 'you')
  assert.deepEqual(Object.values(card('rex').answer.answers), ['No, and tell Codex what to do differently'])
  assert.equal(rex.status, 'working', 'back at what it was doing')
  assert.equal(hub.asking('rex'), false)
})

test('answered in its terminal instead: its menu goes, and its card says so', () => {
  const rex = atWork('rex')
  runner.show('rex', SCREENS.lines.codexApprove)
  still()
  runner.show('rex', ['• Ran touch codex-probe.txt', '', '› Ask Codex to do anything'])
  mock.timers.tick(700)
  assert.equal(card('rex').answer.by, 'terminal')
  assert.equal(rex.status, 'working')
})

test('a menu that changes before the answer goes in: CLIque stops pressing keys, and the new one gets a card of its own', () => {
  atWork('rex')
  runner.show('rex', SCREENS.lines.codexApprove)
  still()
  const first = card('rex')
  pick('rex', 'No, and tell Codex what to do differently')
  runner.show('rex', MCP())
  mock.timers.tick(300)
  assert.deepEqual(runner.keys, [DOWN], 'no Enter on a question you never saw')
  assert.equal(first.answer.by, 'terminal')
  assert.equal(card('rex').ask.title, 'New MCP server found in .mcp.json: figma')
  assert.equal(card('rex').answer, undefined)
})

test('the CLI moves on (a hook says so): its card closes, answered in the terminal', () => {
  const rex = atWork('rex')
  runner.show('rex', SCREENS.lines.codexApprove)
  still()
  hub.onHook('rex', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'touch codex-probe.txt' } })
  assert.equal(card('rex').answer.by, 'terminal')
  assert.equal(rex.status, 'working')
})

test("a permission prompt's own card takes over from the menu on its screen", async () => {
  atWork('june')
  runner.show('june', real('claudeBash'))
  still()
  const screenCard = card('june')
  assert.equal(screenCard.ask.screen, true)
  const waiting = hub.ask('june', { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'touch made-by-probe.txt' } })
  assert.equal(screenCard.answer.by, 'terminal')
  assert.equal(card('june').ask.type, 'permission')
  hub.answer(card('june').id, { allow: true })
  assert.match(await waiting, /"behavior":"allow"/)
})

test('a still screen with no menu on it, from an agent at work: no card, however long', () => {
  const june = atWork('june')
  runner.show('june', real('claudeReply'))
  for (let i = 0; i < 5; i++) still()
  assert.equal(cards('june').length, 0)
  assert.equal(june.status, 'working')
})

test('a dialog of its own a Notification hook tells of ("Session paused"): a card once it is drawn', () => {
  const june = atWork('june')
  hub.onHook('june', { hook_event_name: 'Notification', notification_type: 'agent_needs_input', message: 'Session paused' })
  runner.show('june', real('claudeQuestion'))
  mock.timers.tick(600)
  assert.deepEqual(card('june').ask.questions[0].options.map((o) => o.label), ['Red (warm)', 'Blue (calm)', 'Green (fresh)', 'Type something.', 'Chat about this'])
  assert.equal(june.status, 'waiting')
})

test('"waiting for your input" with no menu up: what its terminal shows, with Enter, Esc, and a line to type into it', () => {
  const june = atWork('june')
  runner.show('june', PROMPT)
  hub.onHook('june', { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  mock.timers.tick(600)
  const ask = card('june').ask
  assert.equal(ask.snapshot, true)
  assert.equal(ask.title, 'Claude is waiting for your input')
  assert.deepEqual(ask.questions[0].options.map((o) => o.label), ['Press Enter', 'Press Esc'])
  assert.match(ask.questions[0].question, /Claude Code v2\.1\.321/)
  assert.deepEqual(alerts, ['june: Claude is waiting for your input'])
  // you write it something: typed in, with Enter after
  pick('june', 'go on with the tests')
  assert.equal(runner.typed.at(-1), 'go on with the tests')
  assert.equal(card('june').answer.by, 'you')
  assert.equal(june.status, 'working')
})

test("one that's free and says it waits for your input: nothing to answer", () => {
  const june = agent('june')
  runner.live.add('june')
  june.status = 'idle'
  hub.onHook('june', { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  mock.timers.tick(600)
  assert.equal(cards('june').length, 0)
})

test("a message it doesn't take: what its terminal shows, and Enter from the chat", () => {
  const june = atWork('june')
  runner.show('june', PROMPT)
  hub.awaitPickup(june, [10])
  mock.timers.tick(10)
  assert.match(card('june').ask.title, /^Didn't pick up the last message/)
  pick('june', 'Press Enter')
  assert.deepEqual(runner.keys, ['\r'])
})

test('a question before it starts (an MCP server to approve): a card within seconds, picked, and it starts as ever', () => {
  const june = agent('june')
  hub.launch(june)
  hub.send({ to: 'june', text: 'fix the login page' })
  runner.show('june', MCP())
  still()
  assert.equal(card('june').ask.title, 'New MCP server found in .mcp.json: figma')
  assert.equal(june.status, 'waiting')
  assert.deepEqual(runner.typed, [], 'nothing typed into it')
  pick('june', 'Use this MCP server')
  runner.show('june', MCP(1))
  mock.timers.tick(300)
  assert.deepEqual(runner.keys, [DOWN, '\r'])
  assert.equal(june.status, 'starting', 'back to starting: it comes up as ever')
  runner.show('june', PROMPT)
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'startup' })
  for (let i = 0; i < 3; i++) mock.timers.tick(1000)
  assert.match(runner.typed.join('\n'), /fix the login page/)
})

test('"Resume this conversation?": a card with its choices; picked, and the message that waited goes in', () => {
  hub.saveSession('june', 'sess-june')
  const june = agent('june')
  hub.launch(june)
  hub.send({ to: 'june', text: 'carry on' })
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'resume' })
  runner.show('june', RESUME())
  assert.equal(june.status, 'waiting', 'held from the moment it asks')
  mock.timers.tick(600)
  assert.equal(card('june').ask.title, 'Resume this conversation?')
  assert.match(alerts.at(-1), /^june: asks in its terminal: Resume this conversation\?/)
  pick('june', 'Resume full session as-is')
  runner.show('june', RESUME(1))
  mock.timers.tick(300)
  assert.deepEqual(runner.keys, [DOWN, '\r'])
  assert.equal(june.resumeAsk, null)
  runner.show('june', PROMPT)
  for (let i = 0; i < 3; i++) mock.timers.tick(1000)
  assert.match(runner.typed.join('\n'), /carry on/)
})

test('a choice the menu does not have, or a card already answered: said so, and nothing pressed', () => {
  atWork('rex')
  runner.show('rex', SCREENS.lines.codexApprove)
  still()
  assert.throws(() => pick('rex', 'Maybe later'), /pick one of its choices/)
  assert.deepEqual(runner.keys, [])
  const id = card('rex').id
  pick('rex', 'Yes, proceed')
  assert.deepEqual(runner.keys, ['\r'], 'already selected: Enter alone')
  assert.throws(() => hub.answer(id, { answers: { x: 'Yes, proceed' } }), /already been answered/)
})

test('one question right after another: it stays waiting in between, so nothing is typed into the second', () => {
  const rex = atWork('rex')
  runner.show('rex', SCREENS.lines.codexApprove)
  still()
  const statuses = []
  const set = hub.setStatus.bind(hub)
  hub.setStatus = (a, status) => (a === rex && statuses.push(status), set(a, status))
  runner.show('rex', MCP())
  mock.timers.tick(700)
  assert.equal(cards('rex').length, 2)
  assert.equal(cards('rex')[0].answer.by, 'terminal')
  assert.ok(!statuses.includes('working'), `never at work in between: ${statuses}`)
  // answered, it goes back to what it was doing before the first
  pick('rex', 'Use this and all future MCP servers in this project')
  assert.equal(rex.status, 'working')
})

test('the resume question with no menu CLIque can read: Enter from the chat answers it, and the message goes in', () => {
  hub.saveSession('june', 'sess-june')
  const june = agent('june')
  hub.launch(june)
  hub.send({ to: 'june', text: 'carry on' })
  hub.onHook('june', { hook_event_name: 'SessionStart', source: 'resume' })
  runner.show('june', [' Resume this conversation?', ' Resuming it will use about 18% of your 5-hour usage limit.', ' ❯ Resume', '   Start a new conversation'])
  mock.timers.tick(600)
  assert.equal(card('june').ask.snapshot, true)
  assert.match(card('june').ask.title, /^Asks before resuming its long conversation: it would use about 18% of your 5-hour limit/)
  pick('june', 'Press Enter')
  assert.deepEqual(runner.keys, ['\r'])
  assert.equal(june.resumeAsk, null)
  runner.show('june', PROMPT)
  for (let i = 0; i < 3; i++) mock.timers.tick(1000)
  assert.match(runner.typed.join('\n'), /carry on/)
})

test('a Notification holds it at once; answered in its terminal before its card is drawn, there is no card', () => {
  const june = atWork('june')
  runner.show('june', real('claudeQuestion'))
  hub.onHook('june', { hook_event_name: 'Notification', notification_type: 'agent_needs_input', message: 'Session paused' })
  assert.equal(june.status, 'waiting', 'nothing goes in from the moment it says so')
  hub.input('june', '\r')
  runner.show('june', PROMPT)
  mock.timers.tick(600)
  assert.equal(cards('june').length, 0)
  assert.equal(june.status, 'working')
})

// Agents' questions answered in the chat: the PermissionRequest payloads Claude Code 2.1 and Codex 0.160
// actually send (recorded from real sessions), the cards they become, and the decisions your answers turn
// into. Fake runner, throwaway CLIQUE_HOME, a real local HTTP server for the /ask route. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-ask-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { serve } = await import('../core/server.js')
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

class FakeRunner extends EventEmitter {
  running = () => true
  written = []
  write = (name, data) => this.written.push({ name, data })
  submit() {}
  stop() {}
  start() {}
}

// Recorded payloads (trimmed to what matters)
const BASH = {
  hook_event_name: 'PermissionRequest', permission_mode: 'default', tool_name: 'Bash',
  tool_input: { command: 'rm -rf dist && npm run build', description: 'Clean and rebuild' },
  permission_suggestions: [
    { type: 'addDirectories', directories: ['/Users/me/code/app'], destination: 'session' },
    { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run build:*' }], behavior: 'allow', destination: 'localSettings' },
    { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
  ],
}
const QUESTION = {
  hook_event_name: 'PermissionRequest', permission_mode: 'bypassPermissions', tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [
      { question: 'Which color do you prefer?', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: 'A warm color' }, { label: 'Blue', description: 'A cool color' }] },
      { question: 'Which platforms?', header: 'Platforms', multiSelect: true, options: [{ label: 'iOS' }, { label: 'Android' }, { label: 'Web' }] },
    ],
  },
}
const PLAN = { hook_event_name: 'PermissionRequest', permission_mode: 'plan', tool_name: 'ExitPlanMode', tool_input: { plan: '## Plan\n1. Add plan.txt', planFilePath: '/Users/me/.claude/plans/x.md' } }
const CODEX = { hook_event_name: 'PermissionRequest', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'touch codex-ok.txt', description: 'May I run touch codex-ok.txt?' } }

let hub, runner, alerts
beforeEach(() => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'june', area: 'backend' }, { name: 'rex', area: 'art', provider: 'codex' }] }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) a.status = 'working'
  alerts = []
  hub.on('alert', (a, text) => alerts.push(`${a.name}: ${text}`))
})
afterEach(() => {
  clearTimeout(hub.statsTimer)
  for (const a of hub.agents.values()) clearTimeout(a.timer)
})

const card = () => hub.feed.findLast((e) => e.kind === 'ask')
const open = () => hub.feed.findLast((e) => e.kind === 'ask' && !e.answer)
const decision = (out) => JSON.parse(out).hookSpecificOutput.decision

test('a permission prompt becomes a card, an alert and "needs you"; Allow sends allow back', async () => {
  const waiting = hub.ask('june', BASH)
  const e = card()
  assert.equal(e.from, 'june')
  assert.equal(e.cli, 'claude')
  assert.deepEqual({ type: e.ask.type, title: e.ask.title, code: e.ask.code, detail: e.ask.detail }, { type: 'permission', title: 'Run a command', code: 'rm -rf dist && npm run build', detail: 'Clean and rebuild' })
  assert.deepEqual(e.ask.always.map((s) => s.label), ['Always allow in app this session', 'Always allow Bash(npm run build:*)', 'Allow all edits this session'])
  assert.deepEqual(alerts, ['june: wants to run a command: rm -rf dist && npm run build'])
  assert.equal(hub.agents.get('june').status, 'waiting')
  hub.answer(e.id, { allow: true })
  const out = await waiting
  assert.deepEqual(JSON.parse(out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
  assert.equal(e.answer.by, 'you')
  assert.equal(e.answer.allow, true)
  assert.equal(hub.agents.get('june').status, 'working')
})

test("Claude Code's PowerShell tool on Windows asks in the same plain words as Bash", async () => {
  const waiting = hub.ask('june', { ...BASH, tool_name: 'PowerShell', tool_input: { command: 'Remove-Item dist -Recurse; npm run build', description: 'Clean and rebuild' }, permission_suggestions: [] })
  const e = card()
  assert.deepEqual({ title: e.ask.title, code: e.ask.code, detail: e.ask.detail }, { title: 'Run a command', code: 'Remove-Item dist -Recurse; npm run build', detail: 'Clean and rebuild' })
  assert.deepEqual(alerts, ['june: wants to run a command: Remove-Item dist -Recurse; npm run build'])
  hub.answer(e.id, { allow: true })
  assert.equal(decision(await waiting).behavior, 'allow')
})

test('"always allow" passes Claude\'s own suggestion back as the permission update', async () => {
  const waiting = hub.ask('june', BASH)
  hub.answer(card().id, { allow: true, always: 1 })
  const d = decision(await waiting)
  assert.deepEqual(d.updatedPermissions, [BASH.permission_suggestions[1]])
  assert.equal(card().answer.always, 'Always allow Bash(npm run build:*)')
})

test('deny, with or without a note, tells the agent why', async () => {
  let waiting = hub.ask('june', BASH)
  hub.answer(card().id, { allow: false, note: 'use npm ci instead' })
  assert.deepEqual(decision(await waiting), { behavior: 'deny', message: 'The user said no: use npm ci instead' })
  waiting = hub.ask('june', BASH)
  hub.answer(card().id, { allow: false })
  assert.deepEqual(decision(await waiting), { behavior: 'deny', message: 'The user said no.' })
})

test('AskUserQuestion: picked options (several for multi-select, or your own words) become its answers', async () => {
  const waiting = hub.ask('june', QUESTION)
  const e = card()
  assert.equal(e.ask.type, 'question')
  assert.deepEqual(e.ask.questions.map((q) => [q.question, q.multiSelect, q.options.length]), [['Which color do you prefer?', false, 2], ['Which platforms?', true, 3]])
  assert.throws(() => hub.answer(e.id, { answers: {} }), /pick an answer/)
  hub.answer(e.id, { answers: { 'Which color do you prefer?': 'Something greenish', 'Which platforms?': ['iOS', 'Web'] } })
  const d = decision(await waiting)
  assert.equal(d.behavior, 'allow')
  assert.deepEqual(d.updatedInput.answers, { 'Which color do you prefer?': 'Something greenish', 'Which platforms?': 'iOS, Web' })
  assert.deepEqual(d.updatedInput.questions, QUESTION.tool_input.questions, 'the questions go back unchanged')
})

test('a plan: approving hands the plan back approved; "keep planning" sends your feedback', async () => {
  let waiting = hub.ask('june', PLAN)
  assert.equal(card().ask.type, 'plan')
  assert.match(card().ask.plan, /Add plan\.txt/)
  hub.answer(card().id, { allow: true })
  assert.deepEqual(decision(await waiting), { behavior: 'allow', updatedInput: PLAN.tool_input })
  waiting = hub.ask('june', PLAN)
  hub.answer(card().id, { allow: false, note: 'split it into two steps' })
  assert.deepEqual(decision(await waiting), { behavior: 'deny', message: 'The user wants you to keep planning: split it into two steps' })
})

test('Codex gets a plain allow/deny (anything else makes it fail closed), and no "always" choices', async () => {
  const waiting = hub.ask('rex', { ...CODEX, permission_suggestions: BASH.permission_suggestions })
  const e = card()
  assert.equal(e.cli, 'codex')
  assert.deepEqual(e.ask.always, [])
  hub.answer(e.id, { allow: true, always: 0 })
  assert.deepEqual(decision(await waiting), { behavior: 'allow' })
})

test('handing a question to the terminal: no decision, and the agent still needs you', async () => {
  const waiting = hub.ask('rex', CODEX)
  hub.answer(card().id, { terminal: true })
  assert.equal(await waiting, '')
  assert.equal(card().answer.by, 'terminal')
  assert.equal(hub.agents.get('rex').status, 'waiting')
})

test('typing in a Codex terminal hands its open question over (Codex shows nothing while its hook waits)', async () => {
  const waiting = hub.ask('rex', CODEX)
  hub.input('rex', 'y')
  assert.equal(await waiting, '')
  assert.equal(card().answer.handedOver, true)
  assert.deepEqual(runner.written.at(-1), { name: 'rex', data: 'y' })
})

test("answered in the terminal (the hook was cancelled): the card says so and the agent's back to work", async () => {
  const closed = new AbortController()
  const waiting = hub.ask('june', BASH, closed.signal)
  closed.abort()
  assert.equal(await waiting, '')
  assert.equal(card().answer.by, 'terminal')
  assert.equal(hub.agents.get('june').status, 'working')
  assert.throws(() => hub.answer(card().id, { allow: true }), /already been answered/)
})

test('one alert per question: Claude\'s own "needs permission" notification is dropped while the card is up', async () => {
  const waiting = hub.ask('june', BASH)
  const before = hub.feed.length
  hub.onHook('june', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })
  assert.equal(hub.feed.length, before)
  assert.equal(alerts.length, 1)
  hub.answer(card().id, { allow: true })
  await waiting
})

test('answers survive a restart; a question nobody answered is marked as no longer waiting', async () => {
  const waiting = hub.ask('june', BASH)
  const answered = card().id
  hub.answer(answered, { allow: false, note: 'not now' })
  await waiting
  hub.ask('june', QUESTION) // left open when the app quits
  const left = card().id
  await hub.saving // feed.jsonl is appended in the background
  const again = new Hub(new FakeRunner(), { bin: '/nonexistent' })
  const reloaded = again.feed.find((e) => e.id === answered).answer
  assert.deepEqual([reloaded.by, reloaded.allow, reloaded.note], ['you', false, 'not now'])
  assert.deepEqual(again.feed.find((e) => e.id === left).answer, { stale: true })
  assert.equal(again.feed.filter((e) => e.amend).length, 0, 'amendments merge into their entries')
})

test('the /ask route holds the hook open until you answer, and notices when the hook gives up', async () => {
  const server = await serve(hub)
  const { port } = server.address()
  const post = (body) => {
    const req = http.request({ port, method: 'POST', path: '/ask/june', headers: { 'x-clique': hub.keyOf('june') } }) // its own key says it's june
    const res = new Promise((resolve) => req.on('response', (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve(b)) }))
    req.on('error', () => {})
    req.end(JSON.stringify(body))
    return { req, res }
  }
  try {
    const one = post(BASH)
    while (!open()) await new Promise((r) => setTimeout(r, 10))
    hub.answer(open().id, { allow: true })
    assert.deepEqual(decision(await one.res), { behavior: 'allow' })

    const two = post(BASH)
    while (!open()) await new Promise((r) => setTimeout(r, 10))
    const e = open()
    two.req.destroy() // the hook timed out, or the terminal answered and Claude cancelled it
    while (!e.answer) await new Promise((r) => setTimeout(r, 10))
    assert.equal(e.answer.by, 'terminal')
  } finally {
    server.close()
  }
})

// ---- found in review ----

test('a Codex terminal reporting focus or the cursor is not typing: the question stays in the chat', { timeout: 5000 }, async () => {
  const waiting = hub.ask('rex', CODEX)
  for (const report of ['\x1b[I', '\x1b[O', '\x1b[24;80R', '\x1b[?1;2c', '\x1b[<0;10;5M', '\x1b]11;rgb:0f0f/1010/1212\x07']) hub.input('rex', report)
  assert.equal(card().answer, undefined, 'clicking the notification focuses the terminal; that must not hand it over')
  hub.input('rex', '\r') // a real key does
  assert.equal(await waiting, '')
  assert.equal(card().answer.handedOver, true)
})

test("a payload with nulls still makes a card (it mustn't turn into an error the agent reads as a decision)", { timeout: 5000 }, async () => {
  const waiting = hub.ask('june', { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: null, permission_suggestions: null })
  assert.equal(card().ask.title, 'Run a command')
  assert.deepEqual(card().ask.always, [])
  hub.answer(card().id, { allow: true })
  assert.equal(decision(await waiting).behavior, 'allow')
})

test("a Codex hook that goes away has handed over to its terminal: the agent still needs you there", { timeout: 5000 }, async () => {
  const closed = new AbortController()
  const waiting = hub.ask('rex', CODEX, closed.signal)
  closed.abort()
  assert.equal(await waiting, '')
  assert.deepEqual([card().answer.by, card().answer.handedOver], ['terminal', true])
  assert.equal(hub.agents.get('rex').status, 'waiting')
})

test('an agent that exits, restarts or is removed takes its open questions with it', { timeout: 5000 }, async () => {
  let waiting = hub.ask('june', BASH)
  runner.emit('exit', 'june', 0, 60000)
  assert.equal(await waiting, '')
  assert.deepEqual(card().answer.stale, true)
  assert.equal(hub.asking('june'), false)
  waiting = hub.ask('rex', CODEX)
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'june', area: 'backend' }] })) // rex removed
  hub.loadConfig()
  assert.equal(await waiting, '')
  assert.equal(hub.asking('rex'), false)
  assert.throws(() => hub.answer(card().id, { allow: true }), /already been answered/)
})

test("Claude's permission notification is dropped even when it beats the card", { timeout: 5000 }, async () => {
  const before = hub.feed.length
  hub.onHook('june', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })
  assert.equal(hub.feed.length, before)
  assert.equal(alerts.length, 0)
  hub.onHook('june', { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  assert.equal(alerts.length, 1, 'other notifications still need you')
})

test('a question waiting for hours stays answerable after 200 newer entries', { timeout: 5000 }, async () => {
  const waiting = hub.ask('june', BASH)
  const id = card().id
  for (let i = 0; i < 320; i++) hub.post({ kind: 'event', from: 'clique', text: `busy ${i}` })
  assert.ok(hub.snapshot().feed.some((e) => e.id === id), 'still on screen')
  hub.answer(id, { allow: true })
  assert.equal(decision(await waiting).behavior, 'allow')
})

test('the hook prints nothing on an HTTP error and always ends before the agent would kill it', { timeout: 5000 }, async () => {
  const { adapters, ASK_WAIT } = await import('../core/adapters.js')
  const settingsOf = (platform) => {
    const claude = adapters.claude({ name: 'june' }, { session: 'x', attachments: '/tmp', platform, bin: platform === 'win32' ? 'C:\\CLIque\\bin' : '/clique/bin' })
    return JSON.parse(claude.args[claude.args.indexOf('--settings') + 1])
  }
  const settings = settingsOf('darwin')
  const hook = settings.hooks.PermissionRequest[0].hooks[0]
  assert.match(hook.command, /curl -sf -m 86390 /)
  assert.equal(hook.timeout, ASK_WAIT.claude)
  // AskUserQuestion comes through PermissionRequest now; PreToolUse reports what a sub-agent is for, and checks a file
  // is free before a file tool writes it (core/hub.js lease), never waiting on you
  assert.deepEqual(settings.hooks.PreToolUse.map((h) => h.matcher), ['Agent|Task', 'Edit|Write|MultiEdit|NotebookEdit'])
  assert.doesNotMatch(JSON.stringify(settings.hooks.PreToolUse), /\/ask\//)
  const codex = adapters.codex({ name: 'rex' }, { platform: 'darwin' }).args.find((a) => a.startsWith('hooks.PermissionRequest='))
  assert.match(codex, /curl -sf -m 1790 /)
  assert.match(codex, /timeout=1800/)
  // Windows: clique-hook.exe gives up as curl does, 10 s before each CLI would kill it
  const win = settingsOf('win32').hooks.PermissionRequest[0].hooks[0]
  assert.deepEqual([win.args, win.timeout], [['ask', '86390'], ASK_WAIT.claude])
  const winCodex = adapters.codex({ name: 'rex' }, { platform: 'win32' }).args.find((a) => a.startsWith('hooks.PermissionRequest='))
  assert.match(winCodex, /clique-hook ask 1790/)
  assert.match(winCodex, /timeout=1800/)
})

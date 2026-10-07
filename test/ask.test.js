// Agents' questions answered in the chat: the PermissionRequest payloads Claude Code 2.1 and Codex 0.160
// actually send (recorded from real sessions), the cards they become, and the decisions your answers turn
// into. Fake runner, throwaway CREW_HOME, a real local HTTP server for the /ask route. Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-ask-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { serve } = await import('../core/server.js')
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))

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
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'joseph', area: 'backend' }, { name: 'marc', area: 'art', provider: 'codex' }] }))
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
  const waiting = hub.ask('joseph', BASH)
  const e = card()
  assert.equal(e.from, 'joseph')
  assert.equal(e.cli, 'claude')
  assert.deepEqual({ type: e.ask.type, title: e.ask.title, code: e.ask.code, detail: e.ask.detail }, { type: 'permission', title: 'Run a command', code: 'rm -rf dist && npm run build', detail: 'Clean and rebuild' })
  assert.deepEqual(e.ask.always.map((s) => s.label), ['Always allow in app this session', 'Always allow Bash(npm run build:*)', 'Allow all edits this session'])
  assert.deepEqual(alerts, ['joseph: wants to run a command: rm -rf dist && npm run build'])
  assert.equal(hub.agents.get('joseph').status, 'waiting')
  hub.answer(e.id, { allow: true })
  const out = await waiting
  assert.deepEqual(JSON.parse(out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
  assert.equal(e.answer.by, 'you')
  assert.equal(e.answer.allow, true)
  assert.equal(hub.agents.get('joseph').status, 'working')
})

test('"always allow" passes Claude\'s own suggestion back as the permission update', async () => {
  const waiting = hub.ask('joseph', BASH)
  hub.answer(card().id, { allow: true, always: 1 })
  const d = decision(await waiting)
  assert.deepEqual(d.updatedPermissions, [BASH.permission_suggestions[1]])
  assert.equal(card().answer.always, 'Always allow Bash(npm run build:*)')
})

test('deny, with or without a note, tells the agent why', async () => {
  let waiting = hub.ask('joseph', BASH)
  hub.answer(card().id, { allow: false, note: 'use npm ci instead' })
  assert.deepEqual(decision(await waiting), { behavior: 'deny', message: 'The user said no: use npm ci instead' })
  waiting = hub.ask('joseph', BASH)
  hub.answer(card().id, { allow: false })
  assert.deepEqual(decision(await waiting), { behavior: 'deny', message: 'The user said no.' })
})

test('AskUserQuestion: picked options (several for multi-select, or your own words) become its answers', async () => {
  const waiting = hub.ask('joseph', QUESTION)
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
  let waiting = hub.ask('joseph', PLAN)
  assert.equal(card().ask.type, 'plan')
  assert.match(card().ask.plan, /Add plan\.txt/)
  hub.answer(card().id, { allow: true })
  assert.deepEqual(decision(await waiting), { behavior: 'allow', updatedInput: PLAN.tool_input })
  waiting = hub.ask('joseph', PLAN)
  hub.answer(card().id, { allow: false, note: 'split it into two steps' })
  assert.deepEqual(decision(await waiting), { behavior: 'deny', message: 'The user wants you to keep planning: split it into two steps' })
})

test('Codex gets a plain allow/deny (anything else makes it fail closed), and no "always" choices', async () => {
  const waiting = hub.ask('marc', { ...CODEX, permission_suggestions: BASH.permission_suggestions })
  const e = card()
  assert.equal(e.cli, 'codex')
  assert.deepEqual(e.ask.always, [])
  hub.answer(e.id, { allow: true, always: 0 })
  assert.deepEqual(decision(await waiting), { behavior: 'allow' })
})

test('handing a question to the terminal: no decision, and the agent still needs you', async () => {
  const waiting = hub.ask('marc', CODEX)
  hub.answer(card().id, { terminal: true })
  assert.equal(await waiting, '')
  assert.equal(card().answer.by, 'terminal')
  assert.equal(hub.agents.get('marc').status, 'waiting')
})

test('typing in a Codex terminal hands its open question over (Codex shows nothing while its hook waits)', async () => {
  const waiting = hub.ask('marc', CODEX)
  hub.input('marc', 'y')
  assert.equal(await waiting, '')
  assert.equal(card().answer.handedOver, true)
  assert.deepEqual(runner.written.at(-1), { name: 'marc', data: 'y' })
})

test("answered in the terminal (the hook was cancelled): the card says so and the agent's back to work", async () => {
  const closed = new AbortController()
  const waiting = hub.ask('joseph', BASH, closed.signal)
  closed.abort()
  assert.equal(await waiting, '')
  assert.equal(card().answer.by, 'terminal')
  assert.equal(hub.agents.get('joseph').status, 'working')
  assert.throws(() => hub.answer(card().id, { allow: true }), /already been answered/)
})

test('one alert per question: Claude\'s own "needs permission" notification is dropped while the card is up', async () => {
  const waiting = hub.ask('joseph', BASH)
  const before = hub.feed.length
  hub.onHook('joseph', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })
  assert.equal(hub.feed.length, before)
  assert.equal(alerts.length, 1)
  hub.answer(card().id, { allow: true })
  await waiting
})

test('answers survive a restart; a question nobody answered is marked as no longer waiting', async () => {
  const waiting = hub.ask('joseph', BASH)
  const answered = card().id
  hub.answer(answered, { allow: false, note: 'not now' })
  await waiting
  hub.ask('joseph', QUESTION) // left open when the app quits
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
    const req = http.request({ port, method: 'POST', path: '/ask/joseph', headers: { 'x-crew': hub.token } })
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

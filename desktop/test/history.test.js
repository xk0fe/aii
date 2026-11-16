// Usage, day by day (core/history.js): what Claude Code and Codex used on this computer, read from their own logs into
// an index that reads each log once and then only where it grew. Fixture logs in a throwaway folder. Run with `npm test`.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scan, summarize as rowsOf, readLog, providerOf, emptyIndex, History, placer, sessionId, COLS, UNKNOWN } from '../core/history.js'

// A summary's rows, added up the way most of these tests read them: per provider and day, with each day's models, who
// used it and where. names: the clique's agents, all in one workspace.
function fold({ first, rows }) {
  const providers = {}
  for (const [day, , who, provider, model, dir, tokens, input, output, cached, written, replies, messages, sessions, cost] of rows) {
    const d = ((providers[provider] ??= { days: {} }).days[day] ??= { tokens: 0, input: 0, output: 0, cached: 0, written: 0, replies: 0, messages: 0, cost: 0, sessions: 0, models: {}, who: {}, where: {} })
    for (const [k, v] of Object.entries({ tokens, input, output, cached, written, replies, messages, cost, sessions })) d[k] += v
    if (!tokens) continue
    d.models[model] = (d.models[model] ?? 0) + tokens
    d.who[who] = (d.who[who] ?? 0) + tokens
    d.where[dir] = (d.where[dir] ?? 0) + tokens
  }
  return { first, providers }
}
const summarize = (index, { names = [], ...opts } = {}) => fold(rowsOf(index, { agents: names.map((name) => ({ name, ws: 'shop' })), ...opts }))

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-history-'))
after(() => fs.rmSync(root, { recursive: true, force: true }))
let claude, codex, roots
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(root, 'run-'))
  claude = path.join(dir, 'claude', 'projects')
  codex = path.join(dir, 'codex', 'sessions')
  fs.mkdirSync(claude, { recursive: true })
  fs.mkdirSync(codex, { recursive: true })
  roots = [{ dir: claude, cli: 'claude' }, { dir: codex, cli: 'codex' }]
})

// local noon on a day: whatever the timezone, the day it's counted on is that day
const at = (day, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString()
const lines = (...rows) => rows.map((r) => `${typeof r === 'string' ? r : JSON.stringify(r)}\n`).join('')
function write(file, text, { append = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs[append ? 'appendFileSync' : 'writeFileSync'](file, text)
  return file
}
const info = (file, cli) => ({ cli, size: fs.statSync(file).size, mtime: Math.round(fs.statSync(file).mtimeMs) })

// Claude Code's lines
const reply = (id, day, usage, { model = 'claude-opus-5-5', ...more } = {}) => ({ type: 'assistant', timestamp: at(day), requestId: `req_${id}`, message: { id: `msg_${id}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage }, ...more })
const prompt = (day, content, more = {}) => ({ type: 'user', timestamp: at(day), message: { role: 'user', content }, ...more })
const named = (name) => ({ type: 'agent-name', agentName: name, sessionId: 's' })
const USE = { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 400, cache_creation: { ephemeral_1h_input_tokens: 400, ephemeral_5m_input_tokens: 0 } }
// Codex's
const meta = (via = 'openai') => ({ timestamp: at('2026-11-01'), type: 'session_meta', payload: { id: 's', model_provider: via, base_instructions: 'x' } })
const turn = (day, model, who) => ({ timestamp: at(day), type: 'turn_context', payload: { model, collaboration_mode: { settings: { developer_instructions: who ? `You are "${who}", one of several AI agents working side by side` : '' } } } })
const started = (day) => ({ timestamp: at(day), type: 'event_msg', payload: { type: 'task_started', turn_id: 't' } })
const count = (day, input, cached, output) => ({ timestamp: at(day), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } }, rate_limits: {} } })

const dayOf = (index, id, day, opts) => summarize(index, opts).providers[id]?.days[day]

test('a Claude Code transcript: each response once, its tokens by kind and its cost; messages are what was sent to it', () => {
  write(path.join(claude, 'proj', 'a.jsonl'), lines(
    named('ada'),
    prompt('2026-11-10', 'fix the totals'),
    // one response, written as three lines (a block each) with the same usage
    reply('1', '2026-11-10', USE), reply('1', '2026-11-10', USE), reply('1', '2026-11-10', USE),
    // what a tool gave back, a note of Claude Code's own, a compaction's summary: not messages
    prompt('2026-11-10', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'done' }]),
    prompt('2026-11-10', '<local-command-stdout>ok</local-command-stdout>'),
    prompt('2026-11-10', 'caveat', { isMeta: true }),
    prompt('2026-11-10', 'summary', { isCompactSummary: true }),
    reply('2', '2026-11-10', { input_tokens: 5, output_tokens: 50 }, { model: 'claude-sonnet-5-5' }),
    reply('3', '2026-11-10', { input_tokens: 1, output_tokens: 1 }, { model: '<synthetic>' }), // an error Claude Code wrote itself
    prompt('2026-11-11', [{ type: 'text', text: 'and the tax line' }]),
    reply('4', '2026-11-11', USE),
    '{ not json',
  ))
  const index = scan(emptyIndex(), roots)
  const d = dayOf(index, 'claude', '2026-11-10', { names: ['ada'] })
  assert.deepEqual({ input: d.input, output: d.output, cached: d.cached, written: d.written, replies: d.replies, messages: d.messages, sessions: d.sessions }, { input: 15, output: 250, cached: 3000, written: 400, replies: 2, messages: 1, sessions: 1 })
  assert.equal(d.tokens, 15 + 250 + 3000 + 400)
  assert.deepEqual(d.models, { 'claude-opus-5-5': 3610, 'claude-sonnet-5-5': 55 })
  assert.deepEqual(d.who, { ada: 3665 })
  assert.deepEqual(d.where, { '': 3665 }) // these lines don't say which folder
  // Opus 5.5 at list price: $4 in, $20 out, $0.20 read, 1-hour writes 2x input; Sonnet 5: $2 in, $10 out
  assert.ok(Math.abs(d.cost - ((10 * 4 + 200 * 20 + 3000 * 0.2 + 400 * 8) / 1e6 + (5 * 2 + 50 * 10) / 1e6)) < 1e-12)
  const next = dayOf(index, 'claude', '2026-11-11', { names: ['ada'] })
  assert.deepEqual([next.replies, next.messages, next.sessions], [1, 1, 1])
  assert.equal(summarize(index).first, '2026-11-10')
})

test("a sub-agent's transcript is its session's agent's: its tokens count, its brief isn't a message and it isn't a session", () => {
  write(path.join(claude, 'proj', 'sess.jsonl'), lines(named('milo'), prompt('2026-11-10', 'look into it'), reply('1', '2026-11-10', { input_tokens: 1, output_tokens: 9 })))
  write(path.join(claude, 'proj', 'sess', 'subagents', 'agent-1.jsonl'), lines(prompt('2026-11-10', 'explore the repo', { isSidechain: true }), reply('2', '2026-11-10', { input_tokens: 2, output_tokens: 88 }, { model: 'claude-haiku-4-5', isSidechain: true })))
  const d = dayOf(scan(emptyIndex(), roots), 'claude', '2026-11-10', { names: ['milo'] })
  assert.deepEqual([d.tokens, d.messages, d.sessions], [100, 1, 1])
  assert.deepEqual(d.who, { milo: 100 })
})

test("a Codex log: its running totals become what each step used, by the turn's model; a total that drops started over", () => {
  write(path.join(codex, '2026', '11', '10', 'rollout-2026-11-10T10-00-00-aaaa.jsonl'), lines(
    meta(), started('2026-11-10'), turn('2026-11-10', 'gpt-6-luna', 'rex'),
    count('2026-11-10', 1000, 0, 50), // 1000 in (none cached), 50 out
    count('2026-11-10', 1000, 0, 50), // said again (a rate limit update): nothing new
    count('2026-11-10', 3000, 1800, 150), // +2000 in, 1800 of it cached, +100 out
    { timestamp: at('2026-11-10'), type: 'event_msg', payload: { type: 'token_count', info: null } },
    started('2026-11-11'), turn('2026-11-11', 'gpt-6.1-sol'),
    count('2026-11-11', 3500, 2000, 250), // the next day, another model: +500 in (200 cached), +100 out
    count('2026-11-11', 400, 0, 20), // the count started over
  ))
  const index = scan(emptyIndex(), roots)
  const d = dayOf(index, 'codex', '2026-11-10', { names: ['rex'] })
  assert.deepEqual({ input: d.input, cached: d.cached, output: d.output, written: d.written, tokens: d.tokens, replies: d.replies, messages: d.messages, sessions: d.sessions, cost: d.cost }, { input: 1200, cached: 1800, output: 150, written: 0, tokens: 3150, replies: 2, messages: 1, sessions: 1, cost: 0 })
  assert.deepEqual(d.models, { 'gpt-6-luna': 3150 })
  assert.deepEqual(d.who, { rex: 3150 })
  const next = dayOf(index, 'codex', '2026-11-11', { names: ['rex'] })
  assert.deepEqual({ input: next.input, cached: next.cached, output: next.output, tokens: next.tokens, messages: next.messages }, { input: 300 + 400, cached: 200, output: 100 + 20, tokens: 600 + 420, messages: 1 })
  assert.deepEqual(next.models, { 'gpt-6.1-sol': 1020 })
})

test('an older Codex log that never says its model still counts, under no model', () => {
  write(path.join(codex, '2026', '05', '03', 'rollout-old.jsonl'), lines(meta(), started('2026-05-03'), count('2026-05-03', 900, 0, 100)))
  assert.deepEqual(dayOf(scan(emptyIndex(), roots), 'codex', '2026-05-03').models, { '': 1000 })
})

test('a log that grew is read only where it grew; one that was rewritten is read again from its start', () => {
  const file = write(path.join(claude, 'p', 'grow.jsonl'), lines(prompt('2026-11-10', 'one'), reply('1', '2026-11-10', { input_tokens: 111, output_tokens: 1 }), reply('2', '2026-11-10', { input_tokens: 1, output_tokens: 1 })))
  let index = scan(emptyIndex(), roots)
  const first = index.files[file]
  assert.equal(first.offset, fs.statSync(file).size)
  assert.equal(dayOf(index, 'claude', '2026-11-10').input, 112)
  // the start of the log changed behind the index's back (same length, the end as it was), and a response was added:
  // only the new one is read, so the day still has what the first look counted
  const text = fs.readFileSync(file, 'utf8').replace('"input_tokens":111', '"input_tokens":999')
  write(file, text + lines(reply('3', '2026-11-10', { input_tokens: 7, output_tokens: 1 })))
  index = scan(index, roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').input, 112 + 7)
  assert.ok(index.files[file].offset > first.offset)
  // rewritten (the bytes before where reading stopped are others now): read from its start
  write(file, lines(prompt('2026-11-10', 'one'), reply('1', '2026-11-10', { input_tokens: 5, output_tokens: 1 }), reply('9', '2026-11-10', { input_tokens: 5, output_tokens: 1 }), reply('8', '2026-11-10', { input_tokens: 5, output_tokens: 1 }), reply('7', '2026-11-10', { input_tokens: 5, output_tokens: 1 })))
  index = scan(index, roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').input, 20)
  // shorter than where reading stopped: from its start too
  write(file, lines(reply('1', '2026-11-10', { input_tokens: 3, output_tokens: 1 })))
  index = scan(index, roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').input, 3)
})

test('a line still being written waits for the next look, and a response split across two looks is counted once', () => {
  const whole = JSON.stringify(reply('2', '2026-11-10', { input_tokens: 40, output_tokens: 1 }))
  const file = write(path.join(claude, 'p', 'live.jsonl'), lines(reply('1', '2026-11-10', { input_tokens: 2, output_tokens: 1 })) + whole.slice(0, 60))
  let index = scan(emptyIndex(), roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').input, 2)
  write(file, `${whole.slice(60)}\n`, { append: true })
  index = scan(index, roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').input, 42)
  // the same response's next block arrives after the look: not counted again
  write(file, lines(reply('2', '2026-11-10', { input_tokens: 40, output_tokens: 1 })), { append: true })
  index = scan(index, roots)
  assert.deepEqual([dayOf(index, 'claude', '2026-11-10').input, dayOf(index, 'claude', '2026-11-10').replies], [42, 2])
})

test("a Codex log that grew carries its running total and its turn's model on", () => {
  const file = write(path.join(codex, '2026', '11', '10', 'rollout-x.jsonl'), lines(meta(), started('2026-11-10'), turn('2026-11-10', 'gpt-6-luna'), count('2026-11-10', 1000, 0, 100)))
  let index = scan(emptyIndex(), roots)
  write(file, lines(count('2026-11-10', 1600, 500, 200)), { append: true })
  index = scan(index, roots)
  const d = dayOf(index, 'codex', '2026-11-10')
  assert.deepEqual([d.tokens, d.input, d.cached, d.output], [1800, 1100, 500, 200])
  assert.deepEqual(d.models, { 'gpt-6-luna': 1800 })
})

test('a line longer than what is read at a time (a big tool result) is skipped whole, and what follows it is read', () => {
  const big = JSON.stringify({ type: 'user', timestamp: at('2026-11-10'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(9 * 1024 * 1024) }] } })
  const file = write(path.join(claude, 'p', 'big.jsonl'), lines(reply('1', '2026-11-10', { input_tokens: 1, output_tokens: 1 }), big, reply('2', '2026-11-10', { input_tokens: 10, output_tokens: 1 }), prompt('2026-11-10', 'next')))
  const e = readLog(file, info(file, 'claude'))
  assert.equal(e.offset, fs.statSync(file).size)
  assert.deepEqual(e.days['2026-11-10'], { m: 1, models: { 'claude-opus-5-5': [2, 11, 2, 0, 0, e.days['2026-11-10'].models['claude-opus-5-5'][5]] } })
})

test("a log that's gone keeps its days; a folder that can't be listed keeps what the index has of it", () => {
  const a = write(path.join(claude, 'p', 'a.jsonl'), lines(named('ada'), prompt('2026-10-01', 'hi'), reply('1', '2026-10-01', { input_tokens: 100, output_tokens: 1 })))
  const b = write(path.join(claude, 'p', 'b.jsonl'), lines(prompt('2026-10-01', 'hi'), reply('2', '2026-10-01', { input_tokens: 10, output_tokens: 1 })))
  write(path.join(codex, '2026', '10', '01', 'rollout-c.jsonl'), lines(meta(), started('2026-10-01'), turn('2026-10-01', 'gpt-6-luna'), count('2026-10-01', 50, 0, 5)))
  let index = scan(emptyIndex(), roots)
  const before = summarize(index, { names: ['ada'] })
  // Claude Code cleaned both up (and one comes back as another session's log later): the day stands as it was
  fs.rmSync(a)
  fs.rmSync(b)
  index = scan(index, roots)
  assert.deepEqual(Object.keys(index.files).filter((f) => f.startsWith(claude)), [])
  assert.deepEqual(summarize(index, { names: ['ada'] }), before)
  assert.deepEqual(before.providers.claude.days['2026-10-01'].who, { ada: 101, '': 11 })
  assert.equal(before.providers.claude.days['2026-10-01'].sessions, 2)
  index = scan(index, roots) // and isn't added twice
  assert.deepEqual(summarize(index, { names: ['ada'] }), before)
  // Codex's folder can't be read (a disk that's away): nothing of it is given up, or folded
  const entries = Object.keys(index.files).length
  index = scan(index, [roots[0], { dir: path.join(codex, 'nope'), cli: 'codex' }])
  assert.equal(Object.keys(index.files).length, entries)
  assert.deepEqual(summarize(index, { names: ['ada'] }), before)
})

test("a look reads only the logs that changed, newest first, and says how far along it is", () => {
  const old = write(path.join(claude, 'p', 'old.jsonl'), lines(reply('1', '2026-10-01', { input_tokens: 1, output_tokens: 1 })))
  const fresh = write(path.join(claude, 'p', 'new.jsonl'), lines(reply('2', '2026-11-01', { input_tokens: 1, output_tokens: 1 })))
  fs.utimesSync(old, new Date('2026-10-01'), new Date('2026-10-01'))
  const seen = []
  let index = scan(emptyIndex(), roots, { onProgress: (p) => seen.push(p) })
  assert.deepEqual(seen.map((p) => p.files), [1, 0])
  assert.equal(seen.at(-1).done, seen.at(-1).total)
  assert.equal(seen[0].done, fs.statSync(fresh).size) // the newer log first
  const kept = index.files[old]
  seen.length = 0
  write(fresh, lines(reply('3', '2026-11-01', { input_tokens: 1, output_tokens: 1 })), { append: true })
  index = scan(index, roots, { onProgress: (p) => seen.push(p) })
  assert.equal(seen.length, 1)
  assert.equal(index.files[old], kept)
  assert.ok(seen[0].total < fs.statSync(fresh).size) // only what was added
})

test('whose work it is: the clique by name (a clone under its original), everything else as outside CLIque', () => {
  write(path.join(claude, 'p', 'ada.jsonl'), lines(named('ada.2'), reply('1', '2026-11-10', { input_tokens: 10, output_tokens: 0 })))
  write(path.join(claude, 'p', 'someone.jsonl'), lines(named('scratch'), reply('2', '2026-11-10', { input_tokens: 20, output_tokens: 0 })))
  write(path.join(claude, 'p', 'plain.jsonl'), lines(reply('3', '2026-11-10', { input_tokens: 30, output_tokens: 0 })))
  write(path.join(codex, '2026', '11', '10', 'rollout-r.jsonl'), lines(meta(), turn('2026-11-10', 'gpt-6-luna', 'rex'), count('2026-11-10', 40, 0, 0)))
  const index = scan(emptyIndex(), roots)
  const s = summarize(index, { names: ['ada', 'rex'] })
  assert.deepEqual(s.providers.claude.days['2026-11-10'].who, { ada: 10, '': 50 })
  assert.deepEqual(s.providers.codex.days['2026-11-10'].who, { rex: 40 })
  assert.deepEqual(summarize(index).providers.codex.days['2026-11-10'].who, { '': 40 })
})

test("where it ran: each session's folder, as its log says it, kept when the log is gone", () => {
  const shop = '/Users/you/code/shop'
  const a = write(path.join(claude, 'p', 'a.jsonl'), lines(prompt('2026-11-10', 'hi'), reply('1', '2026-11-10', { input_tokens: 10, output_tokens: 0 }, { cwd: shop }), reply('2', '2026-11-10', { input_tokens: 5, output_tokens: 0 }, { cwd: '/elsewhere/later' })))
  write(path.join(claude, 'p', 'b.jsonl'), lines(reply('3', '2026-11-10', { input_tokens: 7, output_tokens: 0 }, { cwd: 'C:\\Users\\you\\code\\site' })))
  write(path.join(codex, '2026', '11', '10', 'rollout-w.jsonl'), lines({ timestamp: at('2026-11-10'), type: 'session_meta', payload: { model_provider: 'openai', cwd: shop } }, turn('2026-11-10', 'gpt-6-luna'), count('2026-11-10', 40, 0, 0)))
  let index = scan(emptyIndex(), roots)
  const want = { [shop]: 15, 'C:\\Users\\you\\code\\site': 7 } // a session's first folder is the one it's filed under
  assert.deepEqual(dayOf(index, 'claude', '2026-11-10').where, want)
  assert.deepEqual(dayOf(index, 'codex', '2026-11-10').where, { [shop]: 40 })
  fs.rmSync(a)
  index = scan(index, roots)
  assert.deepEqual(dayOf(index, 'claude', '2026-11-10').where, want)
})

test('which provider a log is: by its model, by what Codex ran it through, or by the folder of a provider of your own', () => {
  const providers = { claude: { cli: 'claude' }, codex: { cli: 'codex' }, glm: { cli: 'claude', models: ['glm-5.1'] }, local: { cli: 'codex', models: ['qwen3-coder'] }, mine: { cli: 'claude', models: ['house-model'] } }
  assert.equal(providerOf({ cli: 'claude', model: 'claude-opus-5-5' }, providers), 'claude')
  assert.equal(providerOf({ cli: 'claude', model: 'glm-5.1' }, providers), 'glm')
  assert.equal(providerOf({ cli: 'claude', model: 'glm-9' }, providers), 'glm')
  assert.equal(providerOf({ cli: 'claude', model: 'house-model' }, providers), 'mine')
  assert.equal(providerOf({ cli: 'claude', model: 'something-else' }, providers), 'claude')
  assert.equal(providerOf({ cli: 'codex', via: 'openai', model: 'gpt-6-luna' }, providers), 'codex')
  assert.equal(providerOf({ cli: 'codex', via: '', model: '' }, providers), 'codex')
  assert.equal(providerOf({ cli: 'codex', via: 'ollama', model: 'gpt-oss:20b' }, providers), 'local')
  assert.equal(providerOf({ cli: 'codex', via: 'ollama', model: 'gpt-oss:20b' }, { codex: { cli: 'codex' } }), 'codex')
  assert.equal(providerOf({ cli: 'claude', pin: 'mine', model: 'claude-opus-5-5' }, providers), 'mine')
  // in a summary: GLM's days are GLM's, Ollama's are Ollama's
  write(path.join(claude, 'p', 'glm.jsonl'), lines(prompt('2026-11-10', 'hi'), reply('1', '2026-11-10', { input_tokens: 7, output_tokens: 0 }, { model: 'glm-5.1' })))
  write(path.join(codex, '2026', '11', '10', 'rollout-o.jsonl'), lines(meta('ollama'), started('2026-11-10'), turn('2026-11-10', 'qwen3-coder'), count('2026-11-10', 9, 0, 0)))
  const s = summarize(scan(emptyIndex(), roots), { providers })
  assert.deepEqual(Object.keys(s.providers).sort(), ['glm', 'local'])
  assert.deepEqual([s.providers.glm.days['2026-11-10'].tokens, s.providers.glm.days['2026-11-10'].messages, s.providers.glm.days['2026-11-10'].cost], [7, 1, 0])
  assert.deepEqual([s.providers.local.days['2026-11-10'].tokens, s.providers.local.days['2026-11-10'].messages], [9, 1])
})

test('in the app: the first ask starts a look and says one is under way; what it finds is saved and there the next time', async () => {
  write(path.join(claude, 'p', 'a.jsonl'), lines(prompt('2026-11-10', 'hi'), reply('1', '2026-11-10', { input_tokens: 10, output_tokens: 5 })))
  const file = path.join(path.dirname(claude), 'history.json')
  for (const worker of [false, true]) {
    fs.rmSync(file, { force: true })
    const history = new History({ file, roots: () => roots, worker })
    const first = history.state()
    assert.deepEqual([first.rows, first.at], [[], 0])
    assert.ok(first.reading, 'a look is under way')
    await history.running
    const then = history.state()
    assert.equal(then.reading, null)
    assert.equal(fold(then).providers.claude.days['2026-11-10'].tokens, 15)
    assert.ok(then.at > 0)
    assert.equal(history.running, null, 'a look this recent is the answer')
    // another CLIque start: the saved index answers before anything is read
    const again = new History({ file, roots: () => roots, worker })
    assert.equal(fold(again.state()).providers.claude.days['2026-11-10'].tokens, 15)
    assert.equal(again.running, null)
  }
})

test("an index from another version, or one that can't be read, starts over", async () => {
  write(path.join(claude, 'p', 'a.jsonl'), lines(reply('1', '2026-11-10', { input_tokens: 10, output_tokens: 5 })))
  const file = path.join(path.dirname(claude), 'history.json')
  for (const saved of ['{ broken', JSON.stringify({ v: 0, at: Date.now(), files: { x: { cli: 'claude', days: { '2020-01-01': { m: 9, models: {} } } } }, kept: {} })]) {
    fs.writeFileSync(file, saved)
    const history = new History({ file, roots: () => roots, worker: false })
    history.state()
    await history.running
    assert.deepEqual(Object.keys(fold(history.state()).providers.claude.days), ['2026-11-10'])
  }
})

// ---- what an independent review of the first version found --------------------------------------------------------

const old = (file, days = 10) => fs.utimesSync(file, new Date(Date.now() - days * 864e5), new Date(Date.now() - days * 864e5))

test("a name that's written after the first look is still found: a Codex agent's, and a sub-agent's session's", () => {
  const file = write(path.join(codex, '2026', '11', '10', 'rollout-late.jsonl'), lines(meta(), started('2026-11-10')))
  let index = scan(emptyIndex(), roots)
  write(file, lines(turn('2026-11-10', 'gpt-6-luna', 'rex'), count('2026-11-10', 1000, 0, 100)), { append: true })
  index = scan(index, roots)
  assert.deepEqual(dayOf(index, 'codex', '2026-11-10', { names: ['rex'] }).who, { rex: 1100 })
  // a sub-agent's log read while its session's has no name yet
  const session = write(path.join(claude, 'p', 'sess.jsonl'), lines(prompt('2026-11-10', 'go'), reply('1', '2026-11-10', { input_tokens: 7, output_tokens: 0 }, { cwd: '/work/shop' })))
  write(path.join(claude, 'p', 'sess', 'subagents', 'agent-1.jsonl'), lines(reply('2', '2026-11-10', { input_tokens: 100, output_tokens: 0 }, { isSidechain: true })))
  index = scan(index, roots)
  write(session, lines(named('milo')), { append: true })
  index = scan(index, roots)
  const d = dayOf(index, 'claude', '2026-11-10', { names: ['milo'] })
  assert.deepEqual([d.who, d.where], [{ milo: 107 }, { '/work/shop': 107 }])
  // ...and it keeps them when both logs are gone
  fs.rmSync(path.join(claude, 'p'), { recursive: true })
  index = scan(index, roots)
  assert.deepEqual(dayOf(index, 'claude', '2026-11-10', { names: ['milo'] }).who, { milo: 107 })
})

test('a log that moved is the same log: its days are counted once, a copy left behind too, and it carries on where it was read to', () => {
  const from = write(path.join(claude, 'old-folder', 'sid-1.jsonl'), lines(prompt('2026-11-10', 'hi'), reply('1', '2026-11-10', { input_tokens: 200, output_tokens: 0 })))
  write(path.join(claude, 'old-folder', 'sid-1', 'subagents', 'agent-9.jsonl'), lines(reply('5', '2026-11-10', { input_tokens: 50, output_tokens: 0 }, { isSidechain: true })))
  let index = scan(emptyIndex(), roots)
  const before = summarize(index)
  fs.renameSync(path.join(claude, 'old-folder'), path.join(claude, 'new-folder')) // the project's folder was renamed
  index = scan(index, roots)
  assert.deepEqual(summarize(index), before)
  assert.deepEqual(Object.keys(index.kept), [])
  // the agent moved to another folder, its log copied there and grown since; the one it left stays behind
  const to = write(path.join(claude, 'third', 'sid-1.jsonl'), fs.readFileSync(path.join(claude, 'new-folder', 'sid-1.jsonl'), 'utf8') + lines(reply('2', '2026-11-10', { input_tokens: 30, output_tokens: 0 })))
  index = scan(index, roots)
  const d = dayOf(index, 'claude', '2026-11-10')
  assert.deepEqual([d.tokens, d.sessions, d.messages], [280, 1, 1])
  assert.ok(index.files[to] && !index.files[from])
  index = scan(index, roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').tokens, 280)
})

test("a response copied into another of its session's logs is counted once, whichever log is read first, in one look or two", () => {
  // (each session's log is named by its own id, as Claude Code names them)
  const session = (dir) => path.join(claude, dir, `sess-${dir}.jsonl`)
  const sub = (dir, n) => path.join(claude, dir, `sess-${dir}`, 'subagents', `agent-${n}.jsonl`)
  const mine = (n, input) => reply(n, '2026-11-10', { input_tokens: input, output_tokens: 0 })
  // a sub-agent carries on from its session (1 and 2 are copies), and another from that one (3 is)
  const build = (dir) => {
    write(session(dir), lines(prompt('2026-11-10', 'go'), mine('1', 100), mine('2', 10)))
    write(sub(dir, 'a'), lines(mine('1', 100), mine('2', 10), mine('3', 5)))
    write(sub(dir, 'b'), lines(mine('3', 5), mine('4', 1)))
  }
  build('one')
  old(sub('one', 'a'), 0.5) // read after the others
  assert.equal(dayOf(scan(emptyIndex(), roots), 'claude', '2026-11-10').tokens, 116)
  build('two')
  old(session('two'), 0.5)
  old(session('one'), 0.6)
  let index = scan(emptyIndex(), roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').tokens, 232)
  // a later look: one more sub-agent with a copy of everything, plus its own
  write(sub('two', 'c'), lines(mine('1', 100), mine('2', 10), mine('3', 5), mine('4', 1), mine('5', 1000)))
  index = scan(index, roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').tokens, 232 + 1000)
  // a log read again from its start keeps what's its own, and doesn't take back what another log counted
  write(session('two'), lines(prompt('2026-11-10', 'go'), mine('1', 100), mine('2', 10), mine('6', 7)))
  index = scan(index, roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').tokens, 232 + 1000 + 7)
  // another session's response with the same id is its own
  write(path.join(claude, 'three', 'other.jsonl'), lines(mine('1', 100)))
  assert.equal(dayOf(scan(index, roots), 'claude', '2026-11-10').tokens, 232 + 1000 + 7 + 100)
})

test('a response is told from the others by its ids, however far apart its lines are; one with no id is its own', () => {
  const many = Array.from({ length: 300 }, (_, i) => reply(`n${i}`, '2026-11-10', { input_tokens: 1, output_tokens: 0 }))
  const file = write(path.join(claude, 'p', 'ids.jsonl'), lines(reply('first', '2026-11-10', { input_tokens: 1000, output_tokens: 0 }), ...many.slice(0, 150)))
  let index = scan(emptyIndex(), roots)
  write(file, lines(...many.slice(150), reply('first', '2026-11-10', { input_tokens: 1000, output_tokens: 0 })), { append: true })
  index = scan(index, roots)
  assert.equal(dayOf(index, 'claude', '2026-11-10').tokens, 1300)
  assert.equal(dayOf(scan(emptyIndex(), roots), 'claude', '2026-11-10').tokens, 1300, 'the same read in one go')
  const bare = (input) => ({ type: 'assistant', timestamp: at('2026-11-11'), message: { model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: 0 } } })
  write(path.join(claude, 'p', 'bare.jsonl'), lines(bare(10), bare(20), bare(30)))
  assert.equal(dayOf(scan(index, roots), 'claude', '2026-11-11').tokens, 60)
})

test("the ids go once a session has gone quiet: a finished log's entry is small", () => {
  const live = write(path.join(claude, 'p', 'live.jsonl'), lines(reply('1', '2026-11-10', { input_tokens: 1, output_tokens: 0 })))
  const done = write(path.join(claude, 'p', 'done.jsonl'), lines(reply('2', '2026-11-01', { input_tokens: 1, output_tokens: 0 })))
  const doneSub = write(path.join(claude, 'p', 'done', 'subagents', 'agent-1.jsonl'), lines(reply('3', '2026-11-01', { input_tokens: 1, output_tokens: 0 })))
  old(done)
  old(doneSub)
  let index = scan(emptyIndex(), roots)
  assert.deepEqual([index.files[live].seen?.length, index.files[done].seen, index.files[doneSub].seen], [1, undefined, undefined])
  // a log read while its session was live, never changed again: its ids go on a later look
  old(live)
  index = scan(index, roots)
  assert.equal(index.files[live].seen, undefined)
  assert.equal(dayOf(index, 'claude', '2026-11-10').tokens, 1)
})

test('a summary is the same before and after a log goes, with two providers sharing a day', () => {
  const day = '2026-10-01'
  write(path.join(claude, 'p', 'a.jsonl'), lines(prompt(day, '1'), prompt(day, '2'), prompt(day, '3'), reply('1', day, { input_tokens: 10, output_tokens: 0 })))
  write(path.join(claude, 'p', 'b.jsonl'), lines(prompt(day, '1'), prompt(day, '2'), prompt(day, '3'), reply('2', day, { input_tokens: 90, output_tokens: 0 }, { model: 'glm-5.1' })))
  // one log on both: its messages and its session go with the model that did most
  write(path.join(claude, 'p', 'c.jsonl'), lines(prompt(day, '1'), reply('3', day, { input_tokens: 5, output_tokens: 0 }), reply('4', day, { input_tokens: 50, output_tokens: 0 }, { model: 'glm-5.1' })))
  // asked just before midnight, answered after: the question is the answering provider's too
  write(path.join(claude, 'p', 'd.jsonl'), lines(prompt('2026-10-02', 'late'), reply('5', '2026-10-03', { input_tokens: 1, output_tokens: 0 }, { model: 'glm-5.1' })))
  const providers = { claude: { cli: 'claude' }, glm: { cli: 'claude', models: ['glm-5.1'] } }
  let index = scan(emptyIndex(), roots)
  const before = summarize(index, { providers })
  assert.deepEqual([before.providers.claude.days[day].messages, before.providers.claude.days[day].sessions, before.providers.glm.days[day].messages, before.providers.glm.days[day].sessions], [3, 1, 4, 2])
  assert.deepEqual(Object.keys(before.providers.claude.days), [day])
  assert.deepEqual([before.providers.glm.days['2026-10-02'].messages, before.providers.glm.days['2026-10-02'].tokens], [1, 0])
  fs.rmSync(path.join(claude, 'p'), { recursive: true })
  index = scan(index, roots)
  assert.deepEqual(Object.keys(index.files), [])
  assert.deepEqual(summarize(index, { providers }), before)
})

test("a folder that can't be listed doesn't stop the rest from being read, and nothing of it is given up", { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  write(path.join(claude, 'open', 'a.jsonl'), lines(reply('1', '2026-11-10', { input_tokens: 100, output_tokens: 0 })))
  write(path.join(claude, 'locked', 'b.jsonl'), lines(reply('2', '2026-11-10', { input_tokens: 1000, output_tokens: 0 })))
  let index = scan(emptyIndex(), roots)
  fs.chmodSync(path.join(claude, 'locked'), 0o000)
  try {
    write(path.join(claude, 'open', 'a.jsonl'), lines(reply('3', '2026-11-10', { input_tokens: 5, output_tokens: 0 })), { append: true })
    index = scan(index, roots)
    assert.equal(dayOf(index, 'claude', '2026-11-10').tokens, 1105)
    assert.deepEqual(Object.keys(index.kept), [])
  } finally {
    fs.chmodSync(path.join(claude, 'locked'), 0o755)
  }
  assert.equal(dayOf(scan(index, roots), 'claude', '2026-11-10').tokens, 1105)
})

test("a line with no time, or a time nobody logged at, isn't a day", () => {
  const timed = (timestamp, input) => ({ ...reply(`t${input}`, '2026-11-10', { input_tokens: input, output_tokens: 0 }), timestamp })
  write(path.join(claude, 'p', 'odd.jsonl'), lines(timed(0, 1), timed('1970-01-01T00:00:00Z', 2), timed('0', 4), timed('2999-01-01T00:00:00Z', 8), timed(undefined, 16), timed(at('2026-11-10'), 32)))
  const s = summarize(scan(emptyIndex(), roots))
  assert.deepEqual([s.first, Object.keys(s.providers.claude.days), s.providers.claude.days['2026-11-10'].tokens], ['2026-11-10', ['2026-11-10'], 32])
})

test('a saved index with parts missing is read as far as it goes, and the logs are looked at', async () => {
  write(path.join(claude, 'p', 'a.jsonl'), lines(reply('1', '2026-11-10', { input_tokens: 10, output_tokens: 5 })))
  const file = path.join(path.dirname(claude), 'history.json')
  for (const saved of ['{"v":1}', '{"v":1,"files":null,"kept":{}}', '{"v":1,"at":"soon","files":{},"kept":{}}', '[]', 'null']) {
    fs.writeFileSync(file, saved)
    const history = new History({ file, roots: () => roots, worker: false })
    assert.ok(history.state().reading, saved)
    await history.running
    assert.equal(fold(history.state()).providers.claude.days['2026-11-10'].tokens, 15, saved)
  }
  // the folders to read can't be said: the look fails, the asker isn't left waiting, and it's tried again later
  const broken = new History({ file: path.join(path.dirname(claude), 'none.json'), roots: () => { throw new Error('no') }, worker: false })
  broken.state()
  await broken.running.catch(() => {})
  const after = broken.state()
  assert.deepEqual([after.reading, after.at > 0, broken.running], [null, true, null])
})

// ---- whose it is in CLIque: the workspace a session ran in, and the agent it ran as -------------------------------

const rowsBy = (summary, ...names) => summary.rows.map((r) => Object.fromEntries(names.map((n) => [n, r[COLS.indexOf(n)]])))

test('a log is named by its session: a transcript by its id, a sub-agent\'s by its session\'s, a Codex log by the id its name ends in', () => {
  assert.equal(sessionId(path.join('p', '3f9a.jsonl'), 'claude'), '3f9a')
  assert.equal(sessionId(path.join('p', '3f9a', 'subagents', 'agent-1.jsonl'), 'claude'), '3f9a')
  assert.equal(sessionId(path.join('2026', '11', '10', 'rollout-2026-11-10T09-30-00-0199c2aa-1b2c-7d3e-8f90-a1b2c3d4e5f6.jsonl'), 'codex'), '0199c2aa-1b2c-7d3e-8f90-a1b2c3d4e5f6')
})

test('where a log belongs: the workspace that wrote its session down, else by its agent\'s name, else outside CLIque', () => {
  const place = placer({
    owners: { s1: ['shop', 'ada'], s2: ['docs'] },
    agents: [{ name: 'ada', ws: 'shop', dir: '/code/shop' }, { name: 'ada', ws: 'docs', dir: '/code/docs' }, { name: 'june', ws: 'docs', dir: '/code/docs' }, { name: 'q', ws: 'shop', dir: '/code/shop' }, { name: 'q', ws: 'docs', dir: '/code/docs' }, { name: 'q', ws: 'lab', dir: '/code/docs' }],
  })
  // written down: that workspace, under the name it was written down with (a rename since), or the log's own
  assert.deepEqual(place({ session: 's1', who: 'old-name', dir: '/elsewhere' }), { ws: 'shop', who: 'ada' })
  assert.deepEqual(place({ session: 's2', who: 'rex.2', dir: '' }), { ws: 'docs', who: 'rex' })
  assert.deepEqual(place({ session: 's2', who: null, dir: '' }), { ws: 'docs', who: '' })
  // not written down: the one workspace with an agent by that name
  assert.deepEqual(place({ session: 'x', who: 'june', dir: '/anywhere' }), { ws: 'docs', who: 'june' })
  // ...or, for an agent that works in several, the one where it works in that folder
  assert.deepEqual(place({ session: 'x', who: 'ada.3', dir: '/code/docs' }), { ws: 'docs', who: 'ada' })
  assert.deepEqual(place({ session: 'x', who: 'ada', dir: '/code/shop/' }), { ws: 'shop', who: 'ada' })
  // ...and when the folder doesn't say (nowhere it works, or two workspaces with the one folder): the clique's, workspace unknown
  assert.deepEqual(place({ session: 'x', who: 'ada', dir: '/tmp' }), { ws: UNKNOWN, who: 'ada' })
  assert.deepEqual(place({ session: 'x', who: 'q', dir: '/code/docs' }), { ws: UNKNOWN, who: 'q' })
  assert.deepEqual(place({ session: 'x', who: 'q', dir: '/code/shop' }), { ws: 'shop', who: 'q' })
  // nobody of the clique's: what you ran outside it, whatever name you gave the session
  assert.deepEqual(place({ session: 'x', who: 'scratch', dir: '/code/shop' }), { ws: '', who: '' })
  assert.deepEqual(place({ session: 'x', who: null, dir: '/code/shop' }), { ws: '', who: '' })
  assert.deepEqual(placer()({ session: 's1', who: 'ada', dir: '' }), { ws: '', who: '' })
})

test('rows: one for each day, workspace, agent, provider, model and folder; a shared agent\'s work goes to the workspace each session ran in', () => {
  const shop = '/code/shop'
  write(path.join(claude, 'p', 's-shop.jsonl'), lines(named('ada'), prompt('2026-11-10', 'hi'), reply('1', '2026-11-10', { input_tokens: 100, output_tokens: 0 }, { cwd: shop })))
  write(path.join(claude, 'p', 's-shop', 'subagents', 'agent-a.jsonl'), lines(reply('2', '2026-11-10', { input_tokens: 20, output_tokens: 0 }))) // its sub-agent: the same session
  write(path.join(claude, 'p', 's-docs.jsonl'), lines(named('ada'), prompt('2026-11-10', 'hi'), prompt('2026-11-10', 'more'), reply('3', '2026-11-10', { input_tokens: 7, output_tokens: 0 }, { cwd: shop })))
  write(path.join(claude, 'p', 's-mine.jsonl'), lines(prompt('2026-11-11', 'hi'), reply('4', '2026-11-11', { input_tokens: 5, output_tokens: 1 }, { cwd: shop, model: 'claude-sonnet-5-5' })))
  write(path.join(codex, '2026', '11', '10', 'rollout-2026-11-10T09-30-00-0199c2aa-1b2c-7d3e-8f90-a1b2c3d4e5f6.jsonl'), lines(meta(), started('2026-11-10'), turn('2026-11-10', 'gpt-6-luna', 'rex'), count('2026-11-10', 40, 10, 2)))
  const owners = { 's-shop': ['shop', 'ada'], 's-docs': ['docs', 'ada'], '0199c2aa-1b2c-7d3e-8f90-a1b2c3d4e5f6': ['docs', 'rex'] }
  const s = rowsOf(scan(emptyIndex(), roots), { owners })
  assert.deepEqual(s.cols, COLS)
  assert.equal(s.first, '2026-11-10')
  assert.deepEqual(rowsBy(s, 'day', 'ws', 'who', 'provider', 'model', 'dir', 'tokens', 'messages', 'sessions').sort((x, y) => `${x.day}${x.ws}${x.provider}`.localeCompare(`${y.day}${y.ws}${y.provider}`)), [
    { day: '2026-11-10', ws: 'docs', who: 'ada', provider: 'claude', model: 'claude-opus-5-5', dir: shop, tokens: 7, messages: 2, sessions: 1 },
    { day: '2026-11-10', ws: 'docs', who: 'rex', provider: 'codex', model: 'gpt-6-luna', dir: '', tokens: 42, messages: 1, sessions: 1 },
    { day: '2026-11-10', ws: 'shop', who: 'ada', provider: 'claude', model: 'claude-opus-5-5', dir: shop, tokens: 120, messages: 1, sessions: 1 },
    { day: '2026-11-11', ws: '', who: '', provider: 'claude', model: 'claude-sonnet-5-5', dir: shop, tokens: 6, messages: 1, sessions: 1 },
  ])
  // a row's numbers: every kind of token, what it would cost
  const codexRow = Object.fromEntries(COLS.map((c, i) => [c, s.rows.find((r) => r[3] === 'codex')[i]]))
  assert.deepEqual([codexRow.input, codexRow.cached, codexRow.output, codexRow.written, codexRow.replies, codexRow.cost], [30, 10, 2, 0, 1, 0])
})

test("a log that's gone keeps the workspace that ran it: the rows are the same before and after, whoever is in the clique by then", () => {
  const a = write(path.join(claude, 'p', 's-shop.jsonl'), lines(named('ada'), prompt('2026-10-01', 'hi'), reply('1', '2026-10-01', { input_tokens: 100, output_tokens: 1 }, { cwd: '/code/shop' })))
  const sub = write(path.join(claude, 'p', 's-shop', 'subagents', 'agent-a.jsonl'), lines(reply('2', '2026-10-01', { input_tokens: 9, output_tokens: 0 })))
  const b = write(path.join(claude, 'p', 's-old.jsonl'), lines(named('ada'), prompt('2026-10-01', 'hi'), reply('3', '2026-10-01', { input_tokens: 10, output_tokens: 1 }, { cwd: '/code/docs' })))
  const owners = { 's-shop': ['shop', 'ada'] }
  const agents = [{ name: 'ada', ws: 'shop', dir: '/code/shop' }, { name: 'ada', ws: 'docs', dir: '/code/docs' }]
  let index = scan(emptyIndex(), roots, { owners })
  const before = rowsOf(index, { owners, agents })
  assert.deepEqual(rowsBy(before, 'ws', 'who', 'tokens').sort((x, y) => x.ws.localeCompare(y.ws)), [{ ws: 'docs', who: 'ada', tokens: 11 }, { ws: 'shop', who: 'ada', tokens: 110 }])
  for (const f of [a, sub, b]) fs.rmSync(f)
  index = scan(index, roots, { owners })
  assert.deepEqual(Object.keys(index.files), [])
  assert.deepEqual(rowsOf(index, { owners, agents }), before)
  // the session written down stays its workspace's with nothing to go by any more; the other was only ever told by name
  assert.deepEqual(rowsBy(rowsOf(index), 'ws', 'who', 'tokens').sort((x, y) => x.ws.localeCompare(y.ws)), [{ ws: '', who: '', tokens: 11 }, { ws: 'shop', who: 'ada', tokens: 110 }])
})

// ---- accounts: a folder per sign-in (core/accounts.js), each with its own logs --------------------------------------

test("an account's folder: its logs' rows say which account, also once the logs are gone", () => {
  const work = path.join(path.dirname(claude), 'accounts', 'claude-work', 'projects')
  const both = [...roots, { dir: work, cli: 'claude', provider: 'claude', account: 'claude-work' }]
  write(path.join(claude, 'p', 'own.jsonl'), lines(prompt('2026-11-10', 'hi'), reply('1', '2026-11-10', { input_tokens: 10, output_tokens: 0 })))
  const a = write(path.join(work, 'p', 's-work.jsonl'), lines(named('ada'), prompt('2026-11-10', 'hi'), reply('2', '2026-11-10', { input_tokens: 70, output_tokens: 0 })))
  const sub = write(path.join(work, 'p', 's-work', 'subagents', 'agent-a.jsonl'), lines(reply('3', '2026-11-10', { input_tokens: 5, output_tokens: 0 })))
  const owners = { 's-work': ['shop', 'ada'] }
  let index = scan(emptyIndex(), both, { owners })
  const before = rowsOf(index, { owners })
  assert.equal(before.cols.at(-1), 'account')
  assert.deepEqual(rowsBy(before, 'ws', 'who', 'provider', 'account', 'tokens').sort((x, y) => y.tokens - x.tokens), [
    { ws: 'shop', who: 'ada', provider: 'claude', account: 'claude-work', tokens: 75 },
    { ws: '', who: '', provider: 'claude', account: '', tokens: 10 },
  ])
  fs.rmSync(a)
  fs.rmSync(sub)
  index = scan(index, both, { owners })
  assert.deepEqual(rowsOf(index, { owners }), before, 'the same rows from what was kept')
  // a session nobody wrote down, on an account: its account is kept all the same
  const b = write(path.join(work, 'p', 's-plain.jsonl'), lines(prompt('2026-11-11', 'hi'), reply('4', '2026-11-11', { input_tokens: 3, output_tokens: 0 })))
  index = scan(index, both, { owners })
  fs.rmSync(b)
  index = scan(index, both, { owners })
  assert.deepEqual(rowsBy(rowsOf(index, { owners }), 'ws', 'account', 'tokens').find((r) => r.tokens === 3), { ws: '', account: 'claude-work', tokens: 3 })
})

test("a conversation that moves to another account's folder: what it used before stays the old account's, what it uses after is the new one's", () => {
  const work = path.join(path.dirname(claude), 'accounts', 'claude-work', 'projects')
  const both = [...roots, { dir: work, cli: 'claude', provider: 'claude', account: 'claude-work' }]
  const was = write(path.join(claude, 'p', 's1.jsonl'), lines(named('ada'), prompt('2026-11-10', 'hi'), reply('1', '2026-11-10', { input_tokens: 100, output_tokens: 0 })))
  const subWas = write(path.join(claude, 'p', 's1', 'subagents', 'agent-a.jsonl'), lines(reply('2', '2026-11-10', { input_tokens: 9, output_tokens: 0 })))
  const owners = { s1: ['shop', 'ada'] }
  let index = scan(emptyIndex(), both, { owners })
  // its agent changes account: the files are moved (Hub.carrySession), then it carries on there
  const now = path.join(work, 'p', 's1.jsonl')
  fs.mkdirSync(path.join(work, 'p', 's1', 'subagents'), { recursive: true })
  fs.renameSync(was, now)
  fs.renameSync(subWas, path.join(work, 'p', 's1', 'subagents', 'agent-a.jsonl'))
  write(now, lines(prompt('2026-11-10', 'more'), reply('3', '2026-11-10', { input_tokens: 40, output_tokens: 0 }), reply('4', '2026-11-11', { input_tokens: 7, output_tokens: 0 })), { append: true })
  index = scan(index, both, { owners })
  const rows = rowsBy(rowsOf(index, { owners }), 'day', 'ws', 'who', 'account', 'tokens', 'messages').sort((x, y) => y.tokens - x.tokens)
  assert.deepEqual(rows, [
    { day: '2026-11-10', ws: 'shop', who: 'ada', account: '', tokens: 109, messages: 1 },
    { day: '2026-11-10', ws: 'shop', who: 'ada', account: 'claude-work', tokens: 40, messages: 1 },
    { day: '2026-11-11', ws: 'shop', who: 'ada', account: 'claude-work', tokens: 7, messages: 0 },
  ])
  assert.deepEqual(Object.keys(index.files).sort(), [now, path.join(work, 'p', 's1', 'subagents', 'agent-a.jsonl')].sort(), 'one entry per log, where it is now')
  // nothing is read twice on the next look, and a response copied into the session's other log is still told
  index = scan(index, both, { owners })
  assert.equal(rowsOf(index, { owners }).rows.reduce((n, r) => n + r[COLS.indexOf('tokens')], 0), 156)
  // back to your own sign-in: the same again, the other way
  fs.renameSync(now, was)
  write(was, lines(reply('5', '2026-11-12', { input_tokens: 1, output_tokens: 0 })), { append: true })
  index = scan(index, both, { owners })
  assert.deepEqual(rowsBy(rowsOf(index, { owners }), 'day', 'account', 'tokens').filter((r) => r.day === '2026-11-12'), [{ day: '2026-11-12', account: '', tokens: 1 }])
  assert.equal(rowsOf(index, { owners }).rows.reduce((n, r) => n + r[COLS.indexOf('tokens')], 0), 157)
})

// ---- a conversation that came from another computer (core/move.js): what it had used there is that computer's ----

test("a log that arrived with a moved agent counts from where it was then: Claude Code's by its lines, Codex's by its running total", () => {
  const a = write(path.join(claude, 'p', 's-moved.jsonl'), lines(named('ada'), prompt('2026-11-09', 'there'), reply('1', '2026-11-09', { input_tokens: 500, output_tokens: 0 })))
  const c = write(path.join(codex, '2026', '11', '09', 'rollout-2026-11-09T10-00-00-0199c2aa-1b2c-7d3e-8f90-a1b2c3d4e5f6.jsonl'), lines(meta(), started('2026-11-09'), turn('2026-11-09', 'gpt-6-luna', 'rex'), count('2026-11-09', 4000, 0, 0)))
  const arrived = { [a]: fs.statSync(a).size, [c]: fs.statSync(c).size }
  // nothing new yet: nothing of theirs is this computer's
  let index = scan(emptyIndex(), roots, { arrived })
  assert.deepEqual(rowsOf(index).rows, [])
  // they carry on here
  write(a, lines(prompt('2026-11-10', 'here'), reply('1', '2026-11-10', { input_tokens: 500, output_tokens: 0 }), reply('2', '2026-11-10', { input_tokens: 20, output_tokens: 0 })), { append: true })
  write(c, lines(started('2026-11-10'), count('2026-11-10', 4300, 0, 0)), { append: true })
  index = scan(index, roots, { arrived })
  const now = rowsBy(rowsOf(index), 'day', 'provider', 'tokens', 'messages').sort((x, y) => x.provider.localeCompare(y.provider))
  assert.deepEqual(now, [
    { day: '2026-11-10', provider: 'claude', tokens: 20, messages: 1 }, // (response 1 again is the one it brought: told by its id)
    { day: '2026-11-10', provider: 'codex', tokens: 300, messages: 1 }, // what grew since, not its whole total
  ])
  // read again from scratch (a new index): the same
  assert.deepEqual(rowsBy(rowsOf(scan(emptyIndex(), roots, { arrived })), 'day', 'provider', 'tokens', 'messages').sort((x, y) => x.provider.localeCompare(y.provider)), now)
  // without knowing they arrived, all of it would be counted here too
  assert.equal(rowsOf(scan(emptyIndex(), roots)).rows.reduce((n, r) => n + r[COLS.indexOf('tokens')], 0), 520 + 4300)
})

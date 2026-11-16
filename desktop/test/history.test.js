// Usage, day by day (core/history.js): what Claude Code and Codex used on this computer, read from their own logs into
// an index that reads each log once and then only where it grew. Fixture logs in a throwaway folder. Run with `npm test`.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scan, summarize, readLog, providerOf, emptyIndex, History } from '../core/history.js'

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
    assert.deepEqual([first.providers, first.at], [{}, 0])
    assert.ok(first.reading, 'a look is under way')
    await history.running
    const then = history.state()
    assert.equal(then.reading, null)
    assert.equal(then.providers.claude.days['2026-11-10'].tokens, 15)
    assert.ok(then.at > 0)
    assert.equal(history.running, null, 'a look this recent is the answer')
    // another CLIque start: the saved index answers before anything is read
    const again = new History({ file, roots: () => roots, worker })
    assert.equal(again.state().providers.claude.days['2026-11-10'].tokens, 15)
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
    assert.deepEqual(Object.keys(history.state().providers.claude.days), ['2026-11-10'])
  }
})

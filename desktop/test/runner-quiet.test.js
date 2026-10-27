// When is a terminal quiet enough to type into? Real ptys running small shell loops. A spinner in the window title
// (Codex keeps one there for half a minute after it starts) isn't drawing; text on screen is. Run with `npm test`.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Runner } from '../core/runner.js'

const runner = new Runner()
afterEach(() => runner.stopAll())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const loop = (name, printf) => runner.start(name, { file: '/bin/sh', args: ['-c', `while true; do printf '${printf}'; sleep 0.1; done`], cwd: '/', env: {} })

test('a spinner in the window title is quiet', async () => {
  loop('codex', '\\033]0;⠙ project\\007')
  await sleep(1500)
  assert.ok(runner.quietFor('codex') > 1000, `quiet for ${runner.quietFor('codex')} ms`)
  assert.match(runner.buffer('codex').data, /\x1b\]0;⠙ project\x07/, 'the title still reaches the terminal')
})

test('a spinner on screen is drawing', async () => {
  loop('claude', '\\r✻ Thinking…')
  await sleep(1500)
  assert.ok(runner.quietFor('claude') < 500, `quiet for ${runner.quietFor('claude')} ms`)
})

test('a title change that comes with something drawn is drawing', async () => {
  loop('both', '\\033]0;⠙ project\\007\\r● working')
  await sleep(1500)
  assert.ok(runner.quietFor('both') < 500, `quiet for ${runner.quietFor('both')} ms`)
})

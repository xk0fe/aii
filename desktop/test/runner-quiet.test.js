// When is a terminal quiet enough to type into? Real ptys running small loops, in Node so they run on Windows too. A
// spinner in the window title (Codex keeps one there for half a minute after it starts) isn't drawing; text on screen
// is. Run with `npm test`.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { Runner } from '../core/runner.js'
import { program } from './helpers/platform.mjs'

const runner = new Runner()
afterEach(() => runner.stopAll())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const loop = (name, text) => runner.start(name, { ...program(`setInterval(() => process.stdout.write(${JSON.stringify(text)}), 100)`), cwd: os.tmpdir(), env: {} })

test('a spinner in the window title is quiet', async () => {
  loop('codex', '\x1b]0;⠙ project\x07')
  await sleep(1500)
  assert.ok(runner.quietFor('codex') > 1000, `quiet for ${runner.quietFor('codex')} ms`)
  assert.match(runner.buffer('codex').data, /\x1b\]0;⠙ project\x07/, 'the title still reaches the terminal')
})

test('a spinner on screen is drawing', async () => {
  loop('claude', '\r✻ Thinking…')
  await sleep(1500)
  assert.ok(runner.quietFor('claude') < 500, `quiet for ${runner.quietFor('claude')} ms`)
})

test('a title change that comes with something drawn is drawing', async () => {
  loop('both', '\x1b]0;⠙ project\x07\r● working')
  await sleep(1500)
  assert.ok(runner.quietFor('both') < 500, `quiet for ${runner.quietFor('both')} ms`)
})

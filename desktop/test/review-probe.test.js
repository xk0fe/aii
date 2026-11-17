// The Tasks review, tried for real in the dashboard (scripts/review-probe.mjs): a task that came back opens there with
// who was on it and where its time went, and the keys do what they say. Run with `npm test`; by itself: npm run
// probe:review. It needs a real window and a real keyboard: what it caught the day it was written was the cursor
// staying in the note box after a send back, so the next A typed an "a" instead of accepting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ELECTRON } from './helpers/platform.mjs'

const DESKTOP = fileURLToPath(new URL('..', import.meta.url))
const skip = (process.platform !== 'darwin' && 'run it by hand: npm run probe:review') || (!fs.existsSync(ELECTRON) && 'no Electron to run')

test('the review, every key and button, in a real window with a real keyboard (npm run probe:review)', { skip, timeout: 240000 }, async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))
  const run = () => new Promise((resolve) => execFile(ELECTRON, [path.join(DESKTOP, 'scripts', 'review-probe.mjs')], { cwd: DESKTOP, encoding: 'utf8', timeout: 100000, env, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve({ error, out: String(stdout) })))
  let { error, out } = await run()
  if (error || /^FAIL/m.test(out)) ({ error, out } = await run()) // (a busy computer can stretch what it waits for: once more before it counts)
  const failed = out.split('\n').filter((l) => l.startsWith('FAIL'))
  assert.equal(failed.length, 0, `the probe found:\n${failed.join('\n')}`)
  assert.ok(!error, `the probe didn't finish: ${error?.message}\n${out.slice(-2000)}`)
  assert.match(out, /\nall ok\s*$/)
  assert.ok(out.split('\n').filter((l) => l.startsWith('ok')).length >= 30, out.slice(-1500))
})

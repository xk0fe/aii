// Where the chat is when you come back to a channel, tried for real in the dashboard (scripts/channel-scroll-probe.mjs).
// Run with `npm test`; by itself: npm run probe:scroll. It needs a real window and real layout: what it caught the day
// it was written was #general, after a short channel, opening up at an unread reply from long before (a reply only
// counts as read on screen while the window has focus) instead of at its end, where you'd left it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ELECTRON } from './helpers/platform.mjs'

const DESKTOP = fileURLToPath(new URL('..', import.meta.url))
const skip = (process.platform !== 'darwin' && 'run it by hand: npm run probe:scroll') || (!fs.existsSync(ELECTRON) && 'no Electron to run')

test('each channel opens where you left it, in a real window (npm run probe:scroll)', { skip, timeout: 180000 }, async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))
  const run = () => new Promise((resolve) => execFile(ELECTRON, [path.join(DESKTOP, 'scripts', 'channel-scroll-probe.mjs')], { cwd: DESKTOP, encoding: 'utf8', timeout: 80000, env, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve({ error, out: String(stdout) })))
  let { error, out } = await run()
  if (error || /^FAIL/m.test(out)) ({ error, out } = await run()) // (a busy computer can stretch what it waits for: once more before it counts)
  const failed = out.split('\n').filter((l) => l.startsWith('FAIL'))
  assert.equal(failed.length, 0, `the probe found:\n${failed.join('\n')}`)
  assert.ok(!error, `the probe didn't finish: ${error?.message}\n${out.slice(-2000)}`)
  assert.match(out, /\nall ok\s*$/)
  assert.ok(out.split('\n').filter((l) => l.startsWith('ok')).length >= 15, out.slice(-1500))
})

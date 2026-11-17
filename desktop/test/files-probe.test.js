// Everything you can do with a file in the chat, tried for real in the dashboard (scripts/files-probe.mjs: a recording's
// player in a message, in the viewer and on the whole screen, pictures, pages, plain files, and all of it for files on a
// linked computer). Run with `npm test`; by itself, with pictures: npm run probe:files -- --shots=<folder>.
// What it guards, beyond each action doing what it says: the page staying alive. A player moved between its message and
// the viewer once killed the page at the next press of the mouse (Chromium, a crash), which no test without a real
// window and a real mouse would have seen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ELECTRON } from './helpers/platform.mjs'

const DESKTOP = fileURLToPath(new URL('..', import.meta.url))
const ffmpeg = () => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const skip = (process.platform !== 'darwin' && 'run it by hand: npm run probe:files') || (!fs.existsSync(ELECTRON) && 'no Electron to run') || (!ffmpeg() && 'no ffmpeg to make the recordings with')

test('files in the chat, every action, in a real window with a real mouse and keyboard (npm run probe:files)', { skip, timeout: 420000 }, async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))
  const run = () => new Promise((resolve) => execFile(ELECTRON, [path.join(DESKTOP, 'scripts', 'files-probe.mjs')], { cwd: DESKTOP, encoding: 'utf8', timeout: 200000, env, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve({ error, out: stdout ?? '' })))
  let { error, out } = await run()
  // (what it times, a busy computer can stretch: the bar going after a still moment, a jump landing. Once more, alone, before it counts.)
  if (error || /^FAIL/m.test(out)) ({ error, out } = await run())
  const failed = out.split('\n').filter((l) => l.startsWith('FAIL'))
  assert.equal(failed.length, 0, `the probe found:\n${failed.join('\n')}\n\n${error?.killed ? 'and it was stopped for taking too long' : ''}`)
  assert.ok(!error, `the probe didn't finish: ${error?.message}\n${out.slice(-2000)}`)
  assert.match(out, /\n\d+ held, 0 didn't\s*$/)
  assert.ok(out.split('\n').filter((l) => l.startsWith('ok')).length >= 240, out.slice(-1500))
  for (const section of ['player', 'more', 'fullscreen', 'viewer', 'cant', 'others', 'linked', 'away', 'threads', 'floating']) assert.ok(out.includes(`\n# ${section}\n`), `the ${section} part ran`)
})

// CLIque's own license and the open source notices that ship inside the app: THIRD_PARTY_NOTICES.txt names everything
// the app carries as it's installed now (scripts/notices.mjs writes it: run it again when this fails), and the app
// ships it with LICENSE. Every package of CLIque's is private and unlicensed. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipped, fonts, NOTICES, NOT_SHIPPED } from '../scripts/notices.mjs'

const DESKTOP = fileURLToPath(new URL('..', import.meta.url))
const REPO = path.join(DESKTOP, '..')
const notices = fs.readFileSync(NOTICES, 'utf8')
const lines = new Set(notices.split(/\r?\n/))

test('the notices name every package the app carries, at the version installed, and every font in it', () => {
  const packages = shipped()
  assert.ok(['electron', 'node-pty', '@xterm/xterm', 'ws'].every((n) => packages.some((p) => p.name === n)))
  for (const p of packages) assert.ok(lines.has(`${p.name} ${p.version}`), `${p.name} ${p.version} isn't in THIRD_PARTY_NOTICES.txt: run node scripts/notices.mjs`)
  for (const f of fonts()) assert.ok(lines.has(`Font: ${path.basename(f)}`), `${f} isn't in THIRD_PARTY_NOTICES.txt: run node scripts/notices.mjs`)
  for (const part of ['winpty', 'ConPTY', '.NET runtime', 'Whisper.net', 'whisper.cpp', 'Whisper speech model', 'Zig', 'MinGW-w64 runtime'])
    assert.ok([...lines].some((l) => l.startsWith(part)), `Windows' ${part}`)
  assert.ok(!/\/Users\/|C:\\Users\\/.test(notices), 'nobody\'s home folder in it')
})

test("the app ships the notices and CLIque's license, and leaves out what isn't in it", async () => {
  const { default: config } = await import('../electron-builder.config.mjs')
  const extra = config.extraResources.map((r) => [path.resolve(DESKTOP, r.from), r.to])
  assert.deepEqual(extra.find(([, to]) => to === 'THIRD_PARTY_NOTICES.txt'), [NOTICES, 'THIRD_PARTY_NOTICES.txt'])
  assert.deepEqual(extra.find(([, to]) => to === 'LICENSE.txt'), [path.join(REPO, 'LICENSE'), 'LICENSE.txt'])
  for (const name of NOT_SHIPPED) if (name !== 'clique-shared') for (const os of ['mac', 'win']) assert.ok(config[os].files.includes(`!node_modules/${name}/**`), `${name} on ${os}`)
  assert.match(fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf8'), /^Copyright \(c\) 2026 Green Grass Inc\. All rights reserved\./)
})

test("every package of CLIque's is private and unlicensed", () => {
  for (const dir of ['', 'desktop', 'shared', 'mobile']) {
    const file = path.join(REPO, dir, 'package.json')
    if (!fs.existsSync(file)) continue
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.deepEqual([pkg.private, pkg.license], [true, 'UNLICENSED'], file)
  }
})

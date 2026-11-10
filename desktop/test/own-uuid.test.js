// CLIque.app's executables get Mach-O UUIDs of their own (scripts/own-uuid.mjs): Electron's, copied as they come, are
// every other Electron app's too, and macOS's Local Network privacy goes by the main executable's UUID. Run with
// `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { executables, giveOwnUUID, giveOwnUUIDs, uuidsIn } from '../scripts/own-uuid.mjs'

const ELECTRON = fileURLToPath(new URL('../node_modules/electron/dist/Electron.app', import.meta.url))
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clique-uuid-test-'))

// A small 64-bit Mach-O: a segment, then the UUID (when there is one), then some "code"
function macho(uuid) {
  const segment = Buffer.alloc(16)
  segment.writeUInt32LE(0x19, 0)
  segment.writeUInt32LE(16, 4)
  const cmds = [segment]
  if (uuid) {
    const c = Buffer.alloc(24)
    c.writeUInt32LE(0x1b, 0)
    c.writeUInt32LE(24, 4)
    Buffer.from(uuid.replaceAll('-', ''), 'hex').copy(c, 8)
    cmds.push(c)
  }
  const head = Buffer.alloc(32)
  head.writeUInt32LE(0xfeedfacf, 0)
  head.writeUInt32LE(0x0100000c, 4) // arm64
  head.writeUInt32LE(2, 12) // an executable
  head.writeUInt32LE(cmds.length, 16)
  head.writeUInt32LE(cmds.reduce((n, c) => n + c.length, 0), 20)
  return Buffer.concat([head, ...cmds, Buffer.from('the code')])
}

// A universal binary of those, one slice every 4 KB
function fat(...slices) {
  const head = Buffer.alloc(4096)
  head.writeUInt32BE(0xcafebabe, 0)
  head.writeUInt32BE(slices.length, 4)
  const body = slices.map((s, i) => {
    head.writeUInt32BE((i + 1) * 4096, 8 + i * 20 + 8)
    head.writeUInt32BE(s.length, 8 + i * 20 + 12)
    return Buffer.concat([s, Buffer.alloc(4096 - s.length)])
  })
  return Buffer.concat([head, ...body])
}

const ELECTRONS = '4C4C448F-5555-3144-A1AB-F1A26EB65237'

test("a copied executable gets a UUID of its own: the same on every build, another for another app", () => {
  const dir = tmp()
  const build = (seed) => {
    const file = path.join(dir, `${seed}-${Math.random()}`)
    fs.writeFileSync(file, macho(ELECTRONS))
    return { file, changed: giveOwnUUID(file, seed) }
  }
  const one = build('com.greengrass.clique')
  assert.equal(one.changed.length, 1)
  assert.equal(one.changed[0].from, ELECTRONS)
  assert.notEqual(one.changed[0].to, ELECTRONS)
  assert.match(one.changed[0].to, /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/)
  assert.deepEqual(uuidsIn(fs.readFileSync(one.file)).map((s) => s.uuid), [one.changed[0].to], 'written where it was')
  assert.equal(build('com.greengrass.clique').changed[0].to, one.changed[0].to, 'rebuilt, macOS still knows it')
  assert.notEqual(build('com.greengrass.clique.dev').changed[0].to, one.changed[0].to, 'the dev launcher is an app of its own')

  // only those 16 bytes change
  const before = macho(ELECTRONS)
  const after = fs.readFileSync(one.file)
  const at = uuidsIn(before)[0].offset
  assert.equal(after.length, before.length)
  assert.deepEqual(after.subarray(0, at), before.subarray(0, at))
  assert.deepEqual(after.subarray(at + 16), before.subarray(at + 16))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('each architecture in a universal binary gets its own', () => {
  const dir = tmp()
  const file = path.join(dir, 'CLIque')
  fs.writeFileSync(file, fat(macho(ELECTRONS), macho('4C4C4410-5555-3144-A141-3B25E9C2D865')))
  const changed = giveOwnUUID(file, 'com.greengrass.clique')
  assert.equal(changed.length, 2)
  const now = uuidsIn(fs.readFileSync(file)).map((s) => s.uuid)
  assert.deepEqual(now, changed.map((c) => c.to))
  assert.equal(new Set([...now, ELECTRONS, '4C4C4410-5555-3144-A141-3B25E9C2D865']).size, 4)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('an executable with no UUID, or not one at all, stops the build', () => {
  const dir = tmp()
  const none = path.join(dir, 'none')
  fs.writeFileSync(none, macho(null))
  assert.throws(() => giveOwnUUID(none, 'x'), /no UUID/)
  const script = path.join(dir, 'script')
  fs.writeFileSync(script, '#!/bin/sh\necho hi\n')
  assert.throws(() => giveOwnUUID(script, 'x'), /not a Mach-O/)
  assert.throws(() => giveOwnUUIDs(path.join(dir, 'Empty.app'), 'x'), /no executables/)
  fs.rmSync(dir, { recursive: true, force: true })
})

// Electron's real executables, in an app laid out like CLIque.app: what's read agrees with Apple's own tool, none of
// them is left with Electron's UUID, and they still sign.
test("Electron's own executables, as the build gives them theirs", { skip: process.platform !== 'darwin' || !fs.existsSync(ELECTRON) }, () => {
  const dir = tmp()
  const app = path.join(dir, 'CLIque.app')
  const helper = path.join(app, 'Contents', 'Frameworks', 'CLIque Helper.app', 'Contents', 'MacOS')
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true })
  fs.mkdirSync(helper, { recursive: true })
  fs.copyFileSync(path.join(ELECTRON, 'Contents', 'MacOS', 'Electron'), path.join(app, 'Contents', 'MacOS', 'CLIque'))
  fs.copyFileSync(path.join(ELECTRON, 'Contents', 'Frameworks', 'Electron Helper.app', 'Contents', 'MacOS', 'Electron Helper'), path.join(helper, 'CLIque Helper'))
  const dwarfdump = (f) => [...execFileSync('dwarfdump', ['--uuid', f], { encoding: 'utf8' }).matchAll(/UUID: (\S+)/g)].map((m) => m[1])

  const files = executables(app)
  assert.equal(files.length, 2)
  const stock = files.map(dwarfdump)
  assert.deepEqual(files.map((f) => uuidsIn(fs.readFileSync(f)).map((s) => s.uuid)), stock)

  const changed = giveOwnUUIDs(app, 'com.greengrass.clique')
  const now = files.map(dwarfdump)
  assert.deepEqual(now, files.map((f) => changed.filter((c) => c.file === f).map((c) => c.to)))
  assert.equal(new Set([...stock.flat(), ...now.flat()]).size, stock.flat().length * 2, "none left with Electron's, none shared")
  for (const f of files) {
    execFileSync('codesign', ['--force', '--sign', '-', f], { stdio: 'ignore' })
    execFileSync('codesign', ['--verify', '--strict', f], { stdio: 'ignore' })
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

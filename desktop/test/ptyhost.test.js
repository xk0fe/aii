// The terminal host (core/ptyhost.js) and its client (core/ptyclient.js), for real: a host process in a throwaway
// CREW_HOME, terminals that keep running while nobody is connected, and a second Crew that finds them. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-host-'))
const { HostRunner } = await import('../core/ptyclient.js')
const { SOCKET } = await import('../core/ptyhost.js')
const tmp = os.tmpdir()
const node = { file: process.execPath, env: {} }
let last
after(() => {
  last?.quit()
  setTimeout(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 5 }), 800)
})

const until = async (f, ms = 5000) => {
  for (const t = Date.now(); !f(); ) {
    if (Date.now() - t > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}
const output = (r) => {
  const seen = new Map()
  r.on('data', (name, d) => seen.set(name, (seen.get(name) ?? '') + d))
  return seen
}

test('terminals keep running while Crew is away, and the next Crew picks them up with what they printed', async () => {
  const first = new HostRunner({ runtime: node })
  assert.deepEqual(await first.connect(), [], 'a new host has nothing running yet')
  const seen = output(first)
  first.start('gal', { file: '/bin/sh', args: ['-c', 'echo hello from gal; exec cat'], cwd: tmp, env: {}, tag: 'run1' })
  assert.ok(first.running('gal'), 'running right away, as the hub expects')
  await until(() => seen.get('gal')?.includes('hello from gal'))
  await until(() => first.pid('gal') > 0)
  const pid = first.pid('gal')
  first.detach() // Crew quits, the agent stays

  const second = new HostRunner({ runtime: node })
  last = second
  const survivors = await second.connect()
  assert.deepEqual(survivors, [{ name: 'gal', tag: 'run1', pid }])
  assert.ok(second.running('gal'))
  assert.match(second.buffer('gal').data, /hello from gal/, 'its terminal redraws from where it was')
  const more = output(second)
  second.write('gal', 'still here?\r')
  await until(() => more.get('gal')?.includes('still here?'))
})

test('an exit comes with its tag; a stop on purpose ends it without an exit, as in the in-process runner', async () => {
  const r = last
  const events = []
  r.on('exit', (name, code) => events.push(['exit', name, code]))
  r.on('ended', (name, tag) => events.push(['ended', name, tag]))
  r.start('joseph', { file: '/bin/sh', args: ['-c', 'exit 3'], cwd: tmp, env: {}, tag: 'run2' })
  await until(() => events.length >= 2)
  assert.deepEqual(events.splice(0), [['ended', 'joseph', 'run2'], ['exit', 'joseph', 3]])
  assert.ok(!r.running('joseph'))
  await r.stop('gal')
  assert.deepEqual(events.splice(0), [['ended', 'gal', 'run1']])
  // a new process under the same name isn't mistaken for the one it replaced
  r.start('david', { file: '/bin/sh', args: ['-c', 'sleep 30'], cwd: tmp, env: {}, tag: 'old' })
  r.start('david', { file: '/bin/sh', args: ['-c', 'sleep 30'], cwd: tmp, env: {}, tag: 'new' })
  await until(() => events.some(([, , tag]) => tag === 'old'))
  assert.ok(r.running('david'))
  assert.ok(!events.some(([kind, name]) => kind === 'exit' && name === 'david'))
})

test('one that ends while Crew is away is gone the next time, and quitting the host ends everything', async () => {
  last.start('arie', { file: '/bin/sh', args: ['-c', 'sleep 0.3'], cwd: tmp, env: {}, tag: 'run3' })
  await until(() => last.pid('arie') > 0)
  last.detach()
  await new Promise((r) => setTimeout(r, 700))
  const next = new HostRunner({ runtime: node })
  last = next
  const survivors = await next.connect()
  assert.deepEqual(survivors.map((s) => s.name), ['david'])
  assert.deepEqual(next.gone.map(({ name, tag }) => [name, tag]), [['arie', 'run3']])
  const david = next.pid('david')
  next.quit()
  await until(() => !fs.existsSync(SOCKET))
  await until(() => {
    try {
      process.kill(david, 0)
      return false
    } catch {
      return true
    }
  })
  last = null
})

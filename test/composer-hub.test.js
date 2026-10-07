// Composer -> hub contract: the composer's `to` and hint formatting, read out of ui/common.js, fed to the real
// Hub with a fake runner in a throwaway CREW_HOME. Written by david; run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const A = path.resolve(import.meta.dirname, '..')
const src = fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8')
const line = src.match(/const to = (target === 'auto'[^\n]*)/)
assert.ok(line, 'composer to-expression not found')
assert.doesNotMatch(line[1], /test\(text\)/, 'leading-mention override still present')
const composerTo = new Function('target', 'text', `return ${line[1]}`)
const hint = src.match(/say\(\(await crew\.call\('send', to, text, images\)\)(.*)\)$/m)[1]
const format = new Function('r', `return r${hint}`)

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-composer-'))
const { Hub, CONFIG } = await import(path.join(A, 'core/hub.js'))
const CREW = ['joseph', 'david', 'gal', 'arie', 'jeff'].map((name) => ({ name, area: name })).concat({ name: 'ye', area: 'x', off: true })
class FakeRunner extends EventEmitter { on_ = new Set(); running = (n) => this.on_.has(n); submit() {}; write() {}; stop() {}; start() {} }
let hub
beforeEach(() => {
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: CREW }))
  const r = new FakeRunner()
  hub = new Hub(r, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) if (!a.off) (r.on_.add(a.name), (a.status = 'working'))
})
afterEach(() => { for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer); clearTimeout(hub.statsTimer) })
after(() => fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true }))
const send = (target, text) => format(hub.send({ to: composerTo(target, text), text }))
const queued = () => Object.fromEntries([...hub.agents.values()].filter((a) => a.inbox.length).map((a) => [a.name, a.inbox.length]))

test('chip + leading @mention: both get it (was: chip dropped)', () => {
  send('david', '@joseph fix the payload')
  assert.deepEqual(queued(), { david: 1, joseph: 1 })
  assert.equal(hub.agents.get('david').inbox[0].text, '@joseph fix the payload')
})
test('chip + mentioning the chip agent again: delivered once', () => {
  send('david', '@david @gal sync on the composer')
  assert.deepEqual(queued(), { david: 1, gal: 1 })
})
test('chip + later mention: both, text kept whole', () => {
  send('david', 'build it, check with @joseph')
  assert.deepEqual(queued(), { david: 1, joseph: 1 })
  assert.equal(hub.agents.get('joseph').inbox[0].text, 'build it, check with @joseph')
})
test('chip alone: only the chip', () => { send('gal', 'review frames'); assert.deepEqual(queued(), { gal: 1 }) })
test('Auto + leading mention: only the mention', () => { send('auto', '@jeff hi'); assert.deepEqual(queued(), { jeff: 1 }) })
test('chip + unknown leading @name: nothing sent, error surfaces', () => {
  assert.throws(() => send('david', '@nobody do x'), /no agent named "nobody"/)
  assert.deepEqual(queued(), {})
})
test('chip + unknown @name later in the text: nothing sent', () => {
  assert.throws(() => send('david', 'fix it, then tell @nobody'), /no agent named "nobody"/)
  assert.deepEqual(queued(), {})
})
test('chip + off agent mentioned up front: nothing sent', () => {
  assert.throws(() => send('david', '@ye pull numbers'), /turned off/)
  assert.deepEqual(queued(), {})
})
test('hint for several recipients is one readable line', () => {
  const h = send('david', '@joseph go')
  assert.doesNotMatch(h, /\n/)
  assert.match(h, /@david.* · .*@joseph/)
})
test('emails, package names, possessives and code never address anyone', () => {
  send('david', "mail a@b.com, bump @types/node, @david's branch, run `@nobody`")
  assert.deepEqual(queued(), { david: 1 })
})
test('a rejected send keeps the draft and leaves the error up until the draft is edited', () => {
  const submit = src.slice(src.indexOf('const submit = async'), src.indexOf('chips.addEventListener'))
  assert.ok(submit.indexOf("ta.value = ''") > submit.indexOf("await crew.call('send'"), 'draft cleared only after a successful send')
  assert.match(submit, /catch \(e\) \{\s*say\(e\.message, true\)/)
  assert.match(src, /if \(!error\) say\.timer = setTimeout/)
})

// Auto: a message you send naming nobody goes to whoever Auto picks, and the chat says Auto picked them, through
// Crew.send as the app and phones send (it picks there, then names the agent to the hub). Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-auto-'))
const { CONFIG } = await import('../core/hub.js')
const { Crew } = await import('../core/crew.js')
fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'iris', area: 'ui/ux designer' }, { name: 'june', area: 'Senior Backend SWE' }] }))

let crew
after(() => {
  for (const hub of crew?.hubs.values() ?? []) {
    for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
    clearTimeout(hub.statsTimer)
    clearTimeout(hub.convoTimer)
  }
  fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 })
})

test('a message naming nobody is marked Auto; one with a To pick, an @name or a reply is not', async () => {
  crew = new Crew({ bin: '/nonexistent', computerName: 'Studio' })
  Object.assign(crew.runner, { running: () => true, submit() {}, write() {} })
  for (const a of crew.hubs.get('default').agents.values()) a.status = 'working' // busy: messages queue
  await crew.send(undefined, 'ui/ux designer needed for the login screen')
  await crew.send('june', 'and the endpoint behind it')
  await crew.send(undefined, '@june the payload too')
  const [first] = crew.hubs.get('default').feed.filter((e) => e.kind === 'msg')
  await crew.send('iris', 'and the colours', [], { re: first.id }) // a reply goes to who got the message, as the composer sends it
  assert.deepEqual(crew.hubs.get('default').feed.filter((e) => e.kind === 'msg').map((m) => [m.to, m.auto]), [['iris', true], ['june', undefined], ['june', undefined], ['iris', undefined]])
})

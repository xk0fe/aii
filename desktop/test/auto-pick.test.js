// Auto: a message you send naming nobody goes to whoever Auto picks, and the chat says Auto picked them, through
// Clique.send as the app and phones send (it picks there, then names the agent to the hub). Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-auto-'))
const { CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'iris', area: 'ui/ux designer' }, { name: 'june', area: 'Senior Backend SWE' }] }))

let clique
after(() => {
  for (const hub of clique?.hubs.values() ?? []) {
    for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
    clearTimeout(hub.statsTimer)
    clearTimeout(hub.convoTimer)
  }
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
})

test('a message naming nobody is marked Auto; one with a To pick, an @name or a reply is not', async () => {
  clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
  Object.assign(clique.runner, { running: () => true, submit() {}, write() {} })
  for (const a of clique.hubs.get('default').agents.values()) a.status = 'working' // busy: messages queue
  await clique.send(undefined, 'ui/ux designer needed for the login screen')
  await clique.send('june', 'and the endpoint behind it')
  await clique.send(undefined, '@june the payload too')
  const [first] = clique.hubs.get('default').feed.filter((e) => e.kind === 'msg')
  await clique.send('iris', 'and the colours', [], { re: first.id }) // a reply goes to who got the message, as the composer sends it
  assert.deepEqual(clique.hubs.get('default').feed.filter((e) => e.kind === 'msg').map((m) => [m.to, m.auto]), [['iris', true], ['june', undefined], ['june', undefined], ['iris', undefined]])
})

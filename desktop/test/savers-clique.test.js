// The Token savers sheet's switches, the way the app flips them: Clique.setSavers writes config.json, every workspace's hub
// reads it, and the state the sheet draws from says so. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-savers-clique-'))
const { CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
const { SAVER_IDS } = await import('../core/savers.js')

fs.writeFileSync(CONFIG, JSON.stringify({
  autopilot: true,
  agents: [{ name: 'iris', area: 'design' }, { name: 'june', area: 'backend' }],
  workspaces: [{ id: 'shop', name: 'Shop', members: { iris: {} }, agents: [] }],
}))
const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
Object.assign(clique.runner, { running: () => false, quietFor: () => Infinity, submit() {}, write() {} })
after(() => {
  for (const hub of clique.hubs.values()) for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(hub[t])
  for (const hub of clique.hubs.values()) clearTimeout(hub.ledger.timer)
  clearTimeout(clique.changeTimer)
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
})
const saved = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8')).savers

test('a switch turned off is kept in config.json, every workspace follows it, and turning it back on leaves no trace', () => {
  delete process.env.CLIQUE_SAVERS
  try {
    const state = clique.snapshot().savers
    assert.deepEqual(state.list.map((s) => s.id), SAVER_IDS)
    assert.equal(state.forced, false)
    assert.ok(SAVER_IDS.every((id) => state.on[id]))
    clique.setSavers({ coldStart: false })
    assert.deepEqual(saved(), { coldStart: false })
    assert.equal(clique.snapshot().savers.on.coldStart, false)
    clique.workspaceAction('create', null, { name: 'Docs' })
    for (const hub of clique.hubs.values()) assert.equal(hub.savers.coldStart, false, hub.ws)
    clique.setSavers({ boardNew: false })
    assert.deepEqual(saved(), { coldStart: false, boardNew: false })
    clique.setSavers({ coldStart: true, boardNew: true })
    assert.equal(saved(), undefined)
    // a benchmark run's CLIQUE_SAVERS decides, and the sheet says so
    process.env.CLIQUE_SAVERS = 'off'
    const forced = clique.snapshot().savers
    assert.equal(forced.forced, true)
    assert.ok(SAVER_IDS.every((id) => !forced.on[id]))
  } finally {
    process.env.CLIQUE_SAVERS = 'off'
  }
})

test("what every workspace's ledger counted adds up in the sheet's state", () => {
  const hubs = [...clique.hubs.values()]
  hubs[0].ledger.add('coldStart', true, { n: 1, tokens: 200000 })
  hubs[1].ledger.add('coldStart', true, { n: 2, tokens: 300000 })
  hubs[1].ledger.add('coldStart', false, { n: 1, tokens: 90000 })
  const s = clique.snapshot().savers
  assert.deepEqual(s.all.savers.coldStart, { on: { n: 3, tokens: 500000 }, off: { n: 1, tokens: 90000 } })
  assert.deepEqual(s.week.savers.coldStart.on, { n: 3, tokens: 500000 })
})

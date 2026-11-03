// The Token savers sheet's switches, the way the app flips them: Crew.setSavers writes config.json, every workspace's hub
// reads it, and the state the sheet draws from says so. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-savers-crew-'))
const { CONFIG } = await import('../core/hub.js')
const { Crew } = await import('../core/crew.js')
const { SAVER_IDS } = await import('../core/savers.js')

fs.writeFileSync(CONFIG, JSON.stringify({
  autopilot: true,
  agents: [{ name: 'iris', area: 'design' }, { name: 'june', area: 'backend' }],
  workspaces: [{ id: 'shop', name: 'Shop', members: { iris: {} }, agents: [] }],
}))
const crew = new Crew({ bin: '/nonexistent', computerName: 'Studio' })
Object.assign(crew.runner, { running: () => false, quietFor: () => Infinity, submit() {}, write() {} })
after(() => {
  for (const hub of crew.hubs.values()) for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(hub[t])
  for (const hub of crew.hubs.values()) clearTimeout(hub.ledger.timer)
  clearTimeout(crew.changeTimer)
  fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 })
})
const saved = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8')).savers

test('a switch turned off is kept in config.json, every workspace follows it, and turning it back on leaves no trace', () => {
  delete process.env.CREW_SAVERS
  try {
    const state = crew.snapshot().savers
    assert.deepEqual(state.list.map((s) => s.id), SAVER_IDS)
    assert.equal(state.forced, false)
    assert.ok(SAVER_IDS.every((id) => state.on[id]))
    crew.setSavers({ coldStart: false })
    assert.deepEqual(saved(), { coldStart: false })
    assert.equal(crew.snapshot().savers.on.coldStart, false)
    crew.workspaceAction('create', null, { name: 'Docs' })
    for (const hub of crew.hubs.values()) assert.equal(hub.savers.coldStart, false, hub.ws)
    crew.setSavers({ boardNew: false })
    assert.deepEqual(saved(), { coldStart: false, boardNew: false })
    crew.setSavers({ coldStart: true, boardNew: true })
    assert.equal(saved(), undefined)
    // a benchmark run's CREW_SAVERS decides, and the sheet says so
    process.env.CREW_SAVERS = 'off'
    const forced = crew.snapshot().savers
    assert.equal(forced.forced, true)
    assert.ok(SAVER_IDS.every((id) => !forced.on[id]))
  } finally {
    process.env.CREW_SAVERS = 'off'
  }
})

test("what every workspace's ledger counted adds up in the sheet's state", () => {
  const hubs = [...crew.hubs.values()]
  hubs[0].ledger.add('coldStart', true, { n: 1, tokens: 200000 })
  hubs[1].ledger.add('coldStart', true, { n: 2, tokens: 300000 })
  hubs[1].ledger.add('coldStart', false, { n: 1, tokens: 90000 })
  const s = crew.snapshot().savers
  assert.deepEqual(s.all.savers.coldStart, { on: { n: 3, tokens: 500000 }, off: { n: 1, tokens: 90000 } })
  assert.deepEqual(s.week.savers.coldStart.on, { n: 3, tokens: 500000 })
})

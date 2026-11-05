// Workspaces in the UI, from ui/common.js: each workspace's tile and line in the switcher, what other workspaces need of
// you, a parked workspace's crew, and linked computers only in the workspaces they share. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ crew: {}, COLORS: { teal: '#16b9c6' }, avatarHTML: (a) => `<av:${a.name}>`, agentColor: () => '#888', avatarOf: (a) => a, CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { wsTile, wsColor, wsStatus, elsewhere, hasWorkspaces, crewGroups, crewSummary, statusText }', ctx)
const { wsTile, wsColor, wsStatus, elsewhere, hasWorkspaces, crewGroups, crewSummary, statusText } = ctx.__x

const ws = (id, extra = {}) => ({ id, name: id, color: null, icon: null, parked: false, current: false, agents: 2, on: 2, working: 0, waiting: 0, unread: 0, faces: [], ...extra })

test("a workspace's tile: its icon or initial on its color, every one of them", () => {
  assert.match(wsTile(ws('storefront', { name: 'storefront app', color: 'teal' })), /--w:#16b9c6[^>]*>S</)
  assert.match(wsTile(ws('storefront', { icon: '🛒', color: '#123456' })), /--w:#123456[\s\S]*ws-emoji">🛒</)
  assert.match(wsTile(ws('default', { name: 'Home' })), />H</, 'whatever its id, and with no look yet: never the crew\'s mark')
  assert.doesNotMatch(wsTile(ws('default', { name: 'Home' })), /<svg|plain/)
  assert.match(wsTile(ws('storefront', { parked: true })), /ws-tile +parked/)
  assert.equal(wsColor(ws('storefront')), null)
})

test("each workspace's line in the switcher: who needs you and who works first, else how it is", () => {
  assert.equal(wsStatus(ws('storefront', { waiting: 2, working: 1, unread: 1 })), '2 need you · 1 working · 1 new reply')
  assert.equal(wsStatus(ws('storefront', { waiting: 1 })), '1 needs you')
  assert.equal(wsStatus(ws('storefront', { waiting: 3, parked: true })), 'Asleep')
  assert.equal(wsStatus(ws('storefront', { on: 3 })), 'all 3 free')
  assert.equal(wsStatus(ws('storefront', { on: 0 })), 'All off')
  assert.equal(wsStatus(ws('storefront', { agents: 0, on: 0 })), 'No agents yet')
})

test('what other open workspaces need of you: the one on screen and parked ones leave it be', () => {
  const state = { workspaces: [ws('home', { current: true, waiting: 4 }), ws('storefront', { waiting: 2, unread: 1 }), ws('site', { unread: 3 }), ws('lab', { parked: true, waiting: 5 })] }
  const away = elsewhere(state)
  assert.deepEqual([away.waiting, away.unread, away.who.map((w) => w.id)], [2, 4, ['storefront', 'site']])
})

test('one workspace or several, it is on screen; none until you make the first', () => {
  assert.equal(hasWorkspaces({ workspaces: [ws('shop')], workspace: ws('shop') }), true)
  assert.equal(hasWorkspaces({ workspaces: [], workspace: null }), false)
})

test("a parked workspace's crew says so; linked computers show only in the workspaces they have too", () => {
  const agent = (name, extra) => ({ name, on: true, status: 'parked', since: Date.now(), ...extra })
  assert.match(crewSummary({ parked: true, agents: [agent('milo')] }), /parked/)
  assert.equal(statusText(agent('milo')), 'asleep')
  const computers = { me: { name: 'Studio Mac' }, links: [{ slug: 'mini', name: 'Workstation', online: true, spaces: ['shop'] }] }
  const names = (workspace) => [...crewGroups({ agents: [], computers, workspace }).map((g) => g.name)]
  assert.deepEqual(names(ws('shop')), ['Studio Mac', 'Workstation'])
  assert.deepEqual(names(ws('storefront')), ['Studio Mac'])
})

// The crew roster (sidebar and menu bar) and the chat's "who's on it" line, from ui/common.js: agents grouped by
// computer in your own order, off agents folded, search, and a big crew folded down to a few rows. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ crew: {}, avatarHTML: (a) => `<av:${a.name}>`, agentColor: () => '#888', avatarOf: (a) => a, CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { rosterHTML, crewGroups, grouped, typingHTML }', ctx)
const { rosterHTML, crewGroups, grouped, typingHTML } = ctx.__x

const agent = (name, extra = {}) => ({ name, area: `${name}'s area`, on: true, status: 'idle', since: Date.now(), activity: '', queue: 0, subs: [], ...extra })
const remote = (seed, home, homeName, extra) => agent(`${seed}@${home}`, { seed, home, homeName, ...extra })
const rows = (html) => [...html.matchAll(/class="crow [^"]*" data-agent="([^"]+)"/g)].map((m) => m[1])
const heads = (html) => [...html.matchAll(/<div class="cgroup-head"[\s\S]*?<b>([^<]+)<\/b>/g)].map((m) => m[1])

const state = (agents, links = []) => ({ agents, computers: { me: { name: 'Studio Mac', slug: 'studio-mac' }, links } })

test('one computer: no group headers, agents in config order', () => {
  const s = state([agent('june'), agent('ada', { status: 'working' }), agent('iris')])
  assert.equal(grouped(crewGroups(s)), false)
  const html = rosterHTML(s)
  assert.deepEqual(heads(html), [])
  assert.deepEqual(rows(html), ['june', 'ada', 'iris'])
})

test('linked computers: one group each, this computer first, a linked one listed even when empty', () => {
  const s = state(
    [agent('june'), remote('theo', 'workstation', 'Workstation'), agent('ada')],
    [{ slug: 'workstation', name: 'Workstation', online: true }, { slug: 'laptop', name: 'Laptop', online: false }],
  )
  const html = rosterHTML(s)
  assert.deepEqual(heads(html), ['Studio Mac', 'Workstation', 'Laptop'])
  assert.deepEqual(rows(html), ['june', 'ada', 'theo@workstation'])
  assert.match(html, /data-home="laptop"[\s\S]*offline[\s\S]*No agents/)
})

test('status changes never reorder rows', () => {
  const agents = [agent('a'), agent('b'), agent('c')]
  const before = rows(rosterHTML(state(agents)))
  agents[2].status = 'waiting'
  agents[0].status = 'working'
  assert.deepEqual(rows(rosterHTML(state(agents))), before)
})

test('off agents fold into one line per group until it is opened', () => {
  const s = state([agent('june'), agent('uma', { on: false, status: 'off' }), agent('pia', { on: false, status: 'off' })])
  const folded = rosterHTML(s)
  assert.deepEqual(rows(folded), ['june'])
  assert.match(folded, /data-fold="off:"[\s\S]*2 off/)
  assert.deepEqual(rows(rosterHTML(s, { folds: new Set(['off:']) })), ['june', 'uma', 'pia'])
})

test('a folded computer keeps its header and its faces, and hides its rows', () => {
  const s = state([agent('june'), remote('bo', 'workstation', 'Workstation', { status: 'working' }), remote('ivo', 'workstation', 'Workstation', { status: 'waiting' })], [{ slug: 'workstation', name: 'Workstation', online: true }])
  const html = rosterHTML(s, { folds: new Set(['group:workstation']) })
  assert.deepEqual(rows(html), ['june'])
  assert.match(html, /class="cgroup folded[^"]*" data-home="workstation"/)
  assert.match(html, /data-home="workstation"[\s\S]*class="faces"><av:bo@workstation><av:ivo@workstation>/)
})

test('search matches names and areas, and shows through folds', () => {
  const s = state([agent('june', { area: 'backend' }), agent('uma', { on: false, status: 'off', area: 'analytics' }), remote('bo', 'workstation', 'Workstation', { area: 'iOS builds' })], [{ slug: 'workstation', name: 'Workstation', online: true }])
  assert.deepEqual(rows(rosterHTML(s, { filter: 'anal' })), ['uma'])
  assert.deepEqual(rows(rosterHTML(s, { filter: 'ios', folds: new Set(['group:workstation']) })), ['bo@workstation'])
  assert.match(rosterHTML(s, { filter: 'zzz' }), /No one matches/)
})

test("who's on it: a big crew shows three rows, the ones waiting on you first, and folds the rest", () => {
  const agents = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => agent(n, { status: 'working', activity: `doing ${n}` }))
  agents[4].status = 'waiting'
  const html = typingHTML(agents)
  const shown = [...html.matchAll(/class="typing-row (?:working|waiting)"[^>]*data-agent="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(shown, ['e', 'a', 'b'])
  assert.match(html, /data-typing="all"[\s\S]*3 more at work/)
  const all = typingHTML(agents, new Map(), { all: true })
  assert.equal([...all.matchAll(/class="typing-row (?:working|waiting)"/g)].length, 6)
  assert.match(all, /data-typing="less"/)
})

test("who's on it: four or fewer are all shown, nothing folded", () => {
  const agents = ['a', 'b', 'c', 'd'].map((n) => agent(n, { status: 'working' }))
  const html = typingHTML(agents)
  assert.equal([...html.matchAll(/class="typing-row working"/g)].length, 4)
  assert.doesNotMatch(html, /data-typing/)
})

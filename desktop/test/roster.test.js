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
  const s = state([agent('joseph'), agent('david', { status: 'working' }), agent('gal')])
  assert.equal(grouped(crewGroups(s)), false)
  const html = rosterHTML(s)
  assert.deepEqual(heads(html), [])
  assert.deepEqual(rows(html), ['joseph', 'david', 'gal'])
})

test('linked computers: one group each, this computer first, a linked one listed even when empty', () => {
  const s = state(
    [agent('joseph'), remote('scarlett', 'mac-mini', 'Mac mini'), agent('david')],
    [{ slug: 'mac-mini', name: 'Mac mini', online: true }, { slug: 'air', name: 'MacBook Air', online: false }],
  )
  const html = rosterHTML(s)
  assert.deepEqual(heads(html), ['Studio Mac', 'Mac mini', 'MacBook Air'])
  assert.deepEqual(rows(html), ['joseph', 'david', 'scarlett@mac-mini'])
  assert.match(html, /data-home="air"[\s\S]*offline[\s\S]*No agents/)
})

test('status changes never reorder rows', () => {
  const agents = [agent('a'), agent('b'), agent('c')]
  const before = rows(rosterHTML(state(agents)))
  agents[2].status = 'waiting'
  agents[0].status = 'working'
  assert.deepEqual(rows(rosterHTML(state(agents))), before)
})

test('off agents fold into one line per group until it is opened', () => {
  const s = state([agent('joseph'), agent('ye', { on: false, status: 'off' }), agent('pia', { on: false, status: 'off' })])
  const folded = rosterHTML(s)
  assert.deepEqual(rows(folded), ['joseph'])
  assert.match(folded, /data-fold="off:"[\s\S]*2 off/)
  assert.deepEqual(rows(rosterHTML(s, { folds: new Set(['off:']) })), ['joseph', 'ye', 'pia'])
})

test('a folded computer keeps its header and counts, and hides its rows', () => {
  const s = state([agent('joseph'), remote('bo', 'mac-mini', 'Mac mini', { status: 'working' }), remote('ivy', 'mac-mini', 'Mac mini', { status: 'waiting' })], [{ slug: 'mac-mini', name: 'Mac mini', online: true }])
  const html = rosterHTML(s, { folds: new Set(['group:mac-mini']) })
  assert.deepEqual(rows(html), ['joseph'])
  assert.match(html, /class="cgroup folded[^"]*" data-home="mac-mini"/)
  assert.match(html, /gc working[^>]*>1</)
  assert.match(html, /gc waiting[^>]*>1</)
})

test('search matches names and areas, and shows through folds', () => {
  const s = state([agent('joseph', { area: 'backend' }), agent('ye', { on: false, status: 'off', area: 'analytics' }), remote('bo', 'mac-mini', 'Mac mini', { area: 'iOS builds' })], [{ slug: 'mac-mini', name: 'Mac mini', online: true }])
  assert.deepEqual(rows(rosterHTML(s, { filter: 'anal' })), ['ye'])
  assert.deepEqual(rows(rosterHTML(s, { filter: 'ios', folds: new Set(['group:mac-mini']) })), ['bo@mac-mini'])
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

// The first-run screen (ui/setup.js), driven through its states with a tiny stand-in for the page: when it comes up
// by itself and when it doesn't, the way out of every state, the ⋯ menu's version of it, Escape, and Add provider…'s
// Remove. (scripts/ has the Electron interaction test that clicks through the real page.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const A = path.resolve(import.meta.dirname, '..')

function page({ layers = null } = {}) {
  const made = []
  const keys = []
  const calls = []
  const node = (tag) => {
    const el = { tag, hidden: false, open: false, style: {}, html: '', on: {}, setAttribute() {}, addEventListener(type, fn) { this.on[type] = fn }, querySelector: () => ({ focus() {} }), showModal() { this.open = true }, close() { this.open = false } }
    made.push(el)
    return el
  }
  const ctx = vm.createContext({
    document: { createElement: node, body: { append() {} }, querySelector: (sel) => (sel.includes('.menu') ? layers?.() ?? null : null) },
    addEventListener: (type, fn) => type === 'keydown' && keys.push(fn),
    crew: { call: async (...args) => (calls.push(args), args[1] === 'provider' ? { id: args[2], key: false, running: false } : undefined) },
    esc: (s) => String(s ?? ''),
    morph: (el, html) => (el.html = html),
    avatarHTML: () => '<i class="av"></i>',
    oops: () => {},
    errorLine: (e) => String(e?.message ?? e),
    ON_WINDOWS: false,
    setTimeout,
    clearTimeout,
  })
  vm.runInContext(`${fs.readFileSync(path.join(A, 'ui/setup.js'), 'utf8')};globalThis.__mount = mountSetup`, ctx)
  const screen = ctx.__mount({ onAdd: () => calls.push(['onAdd']) })
  const [view, sheet] = made
  const escape = (prevented = false) => keys.forEach((fn) => fn({ key: 'Escape', defaultPrevented: prevented }))
  // a click on one of its buttons, as the page's own handler sees it
  const press = (el, dataset) => el.on.click({ target: { closest: () => ({ dataset }) } })
  const buttons = () => [...view.html.matchAll(/data-act="(\w+)"[^>]*>([^<]*)</g)].map((m) => m[2])
  const title = () => view.html.match(/su-title">([^<]*)</)?.[1]
  return { screen, view, sheet, escape, press, buttons, title, calls }
}

const cli = (id, state) => ({ id, name: id === 'claude' ? 'Claude Code' : 'Codex', state, how: state === 'ready' ? null : { command: `${id} install`, page: 'https://example.com' } })
const setup = (claude, codex = 'missing') => ({ checked: true, ready: [claude, codex].includes('ready'), clis: [cli('claude', claude), cli('codex', codex)], git: null })
const state = (extra) => ({ agents: [], computers: { me: { name: 'Studio' }, links: [] }, providers: {}, ...extra })

test('it comes up by itself only once the check says nothing here can run an agent', () => {
  const p = page()
  p.screen.render(state({}))
  assert.equal(p.view.hidden, true, 'no check yet (an older main.js): nothing shows')
  p.screen.render(state({ setup: { checked: false, clis: [] } }))
  assert.equal(p.view.hidden, true, 'still checking')
  p.screen.render(state({ setup: setup('ready') }))
  assert.equal(p.view.hidden, true, 'Claude Code ready')
  p.screen.render(state({ setup: setup('missing'), computers: { me: {}, links: [{ slug: 'workstation', name: 'Workstation', online: false }] } }))
  assert.equal(p.view.hidden, true, 'a linked computer lends its agents (even before it connects)')
  p.screen.render(state({ setup: setup('missing', 'signin') }))
  assert.equal(p.view.hidden, false)
  assert.equal(p.title(), 'Let’s get your crew ready')
  assert.deepEqual(p.buttons(), ['Check again', 'Not now', 'Add a provider…'])
})

test('once one is ready it invites the first agent, and there is still a way out', () => {
  const p = page()
  p.screen.render(state({ setup: setup('missing') }))
  p.screen.render(state({ setup: setup('ready') }))
  assert.equal(p.view.hidden, false, 'stays up to say so')
  assert.equal(p.title(), 'Let’s build your crew')
  assert.deepEqual(p.buttons(), ['Add your first agent', 'Check again', 'Not now', 'Add a provider…'])
  p.press(p.view, { act: 'add' })
  assert.deepEqual([p.view.hidden, p.calls.some((c) => c[0] === 'onAdd')], [true, true], 'Add your first agent: the new agent’s sheet')
})

test('Not now puts it away until the dashboard opens again, however many states come in', () => {
  const p = page()
  p.screen.render(state({ setup: setup('missing') }))
  p.press(p.view, { act: 'close' })
  assert.equal(p.view.hidden, true)
  p.screen.render(state({ setup: setup('missing') }))
  assert.equal(p.view.hidden, true)
  p.screen.open()
  assert.equal(p.view.hidden, false, 'the ⋯ menu brings it back')
})

test('from the ⋯ menu with agents elsewhere (another workspace, your roster), it says what’s ready and Done', () => {
  const p = page()
  p.screen.render(state({ setup: setup('ready', 'signin'), roster: [{ name: 'Ada' }], workspaces: [{ id: 'default', agents: 1 }, { id: 'docs', agents: 0 }] }))
  p.screen.open()
  assert.equal(p.title(), 'Claude Code and Codex')
  assert.deepEqual(p.buttons(), ['Done', 'Check again', 'Add a provider…'])
})

test('Escape that another layer took (the agent’s sheet, a menu) leaves the screen where it is', () => {
  let layer = null
  const p = page({ layers: () => layer })
  p.screen.render(state({ setup: setup('missing') }))
  p.escape(true)
  assert.equal(p.view.hidden, false, 'taken by the agent’s sheet')
  layer = {}
  p.escape()
  assert.equal(p.view.hidden, false, 'a menu or dialog is open')
  layer = null
  p.escape()
  assert.equal(p.view.hidden, true)
})

test('Add provider…: Add for GLM and Ollama; Remove only for what Add put there, not your own provider of that name', async () => {
  const p = page()
  p.screen.render(state({ setup: setup('ready'), providers: { glm: { label: 'GLM', added: true, optional: true }, local: { label: 'My Ollama', added: true } } }))
  p.screen.addProvider()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(p.sheet.open, true)
  assert.match(p.sheet.html, /data-remove="glm"/)
  assert.doesNotMatch(p.sheet.html, /data-remove="local"/)
  p.screen.render(state({ setup: setup('ready'), providers: { glm: { label: 'GLM', added: false, optional: true }, local: { label: 'Ollama', added: false, optional: true } } }))
  assert.match(p.sheet.html, /data-add="glm"/)
  assert.match(p.sheet.html, /data-add="local"/)
  assert.deepEqual(p.calls.filter((c) => c[1] === 'provider').map((c) => c[2]), ['glm', 'local'], 'what each needs is looked at')
})

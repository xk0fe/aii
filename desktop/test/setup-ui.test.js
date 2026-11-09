// The first-run screen (ui/setup.js), driven through its states with a tiny stand-in for the page: when it comes up
// by itself and when it doesn't, the way out of every state, the ⋯ menu's version of it, Escape, and Add provider…'s
// Remove. And the first run itself, Q's conversation, once the page has what it needs for it (saved: what's kept in
// localStorage). (scripts/ has the Electron interaction test that clicks through the real page.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const A = path.resolve(import.meta.dirname, '..')

function page({ layers = null, saved = null, answers = () => undefined } = {}) {
  const made = []
  const keys = []
  const calls = []
  const node = (tag) => {
    const el = { tag, hidden: false, open: false, style: {}, html: '', on: {}, classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener(type, fn) { this.on[type] = fn }, querySelector: () => ({ focus() {}, getBoundingClientRect: () => ({ top: 40, height: 64 }), style: { setProperty() {} } }), getAnimations: () => [], showModal() { this.open = true }, close() { this.open = false } }
    made.push(el)
    return el
  }
  // what a first run needs of the page: the kept step, the wordmark's fold, the motion setting, its icons and paths
  const firstRun = saved && {
    store: { get: (k) => saved.get(k) ?? null, set: (k, v) => saved.set(k, v) },
    foldHTML: () => '<div class="fold"></div>',
    matchMedia: () => ({ matches: false }),
    innerHeight: 800,
    ICONS: { folder: '', plus: '', check: '' },
    tildePath: (p) => p,
    pathParts: (p) => String(p).split('/').filter(Boolean),
  }
  const ctx = vm.createContext({
    document: { createElement: node, body: { append() {} }, querySelector: (sel) => (sel.includes('.menu') ? layers?.() ?? null : null) },
    addEventListener: (type, fn) => type === 'keydown' && keys.push(fn),
    crew: { call: async (...args) => (calls.push(args), answers(args) ?? (args[1] === 'provider' ? { id: args[2], key: false, running: false } : undefined)) },
    ...firstRun,
    esc: (s) => String(s ?? ''),
    morph: (el, html) => (el.html = html),
    avatarHTML: () => '<i class="av"></i>',
    oops: () => {},
    errorLine: (e) => String(e?.message ?? e),
    ON_WINDOWS: false,
    PRODUCT_NAME: 'CLIque',
    setTimeout,
    clearTimeout,
  })
  vm.runInContext(`${fs.readFileSync(path.join(A, 'ui/setup.js'), 'utf8')};globalThis.__mount = mountSetup`, ctx)
  const screen = ctx.__mount({ onAdd: () => calls.push(['onAdd']), onWorkspace: () => calls.push(['onWorkspace']), onComputers: () => calls.push(['onComputers']), onMade: (next) => calls.push(['onMade', next]), onTour: () => calls.push(['onTour']), onLand: () => calls.push(['onLand']) })
  const [view, sheet] = made
  const escape = (prevented = false) => keys.forEach((fn) => fn({ key: 'Escape', defaultPrevented: prevented }))
  // a click on one of its buttons, as the page's own handler sees it
  const press = (el, dataset) => el.on.click({ target: { closest: () => ({ dataset, classList: { add() {} } }) } })
  const buttons = () => [...view.html.matchAll(/data-act="(\w+)"[^>]*>([^<]*)</g)].map((m) => m[2])
  const title = () => view.html.match(/<h1 class="display"[^>]*>([^<]*)</)?.[1]
  const step = () => view.html.match(/<div class="fr[^"]*" data-step="(\w+)"/)?.[1]
  return { screen, view, sheet, escape, press, buttons, title, calls, step }
}

const cli = (id, state) => ({ id, name: id === 'claude' ? 'Claude Code' : 'Codex', state, how: state === 'ready' ? null : { command: `${id} install`, page: 'https://example.com' } })
const setup = (claude, codex = 'missing') => ({ checked: true, ready: [claude, codex].includes('ready'), clis: [cli('claude', claude), cli('codex', codex)], git: null })
const state = (extra) => ({ agents: [], computers: { me: { name: 'Studio' }, links: [] }, providers: {}, workspace: { id: 'shop', name: 'Shop' }, ...extra })

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
  assert.equal(p.title(), 'Let’s get your clique ready')
  assert.deepEqual(p.buttons(), ['Check again', 'Not now', 'Add a provider…'])
})

test('once one is ready it invites the first agent, and there is still a way out', () => {
  const p = page()
  p.screen.render(state({ setup: setup('missing') }))
  p.screen.render(state({ setup: setup('ready') }))
  assert.equal(p.view.hidden, false, 'stays up to say so')
  assert.equal(p.title(), 'Let’s build your clique')
  assert.deepEqual(p.buttons(), ['Add your first agent', 'Check again', 'Not now', 'Add a provider…'])
  p.press(p.view, { act: 'add' })
  assert.deepEqual([p.view.hidden, p.calls.some((c) => c[0] === 'onAdd')], [true, true], 'Add your first agent: the new agent’s sheet')
})

test('no workspace yet: there is nothing else to show, so it stays, and asks for the first once something can run an agent', () => {
  const p = page()
  const none = (extra) => state({ workspace: null, workspaces: [], ...extra })
  p.screen.render(none({ setup: { checked: false, clis: [] } }))
  assert.equal(p.view.hidden, false)
  assert.equal(p.title(), 'Looking for Claude Code and Codex')
  p.screen.render(none({ setup: setup('missing') }))
  assert.equal(p.title(), 'Let’s get your clique ready')
  // Not now, with nothing behind it: on to the workspace
  p.press(p.view, { act: 'close' })
  assert.equal(p.view.hidden, false)
  assert.equal(p.title(), 'Make your first workspace')
  assert.deepEqual(p.buttons(), ['Create a workspace', 'Link a computer'])
  p.screen.render(none({ setup: setup('ready') }))
  assert.equal(p.title(), 'Make your first workspace')
  p.escape()
  assert.equal(p.view.hidden, false, 'Escape leaves it: there is nothing behind it')
  p.press(p.view, { act: 'workspace' })
  assert.ok(p.calls.some((c) => c[0] === 'onWorkspace'), 'the sheet every workspace is made with')
  assert.equal(p.view.hidden, false, 'it stays until there is one')
  p.press(p.view, { act: 'computers' })
  assert.ok(p.calls.some((c) => c[0] === 'onComputers'), 'a second computer can link first')
  // made: it goes, whatever was dismissed
  p.screen.render(state({ setup: setup('ready') }))
  assert.equal(p.view.hidden, true)
  // and comes back when the last one goes
  p.screen.render(none({ setup: setup('ready') }))
  assert.equal(p.view.hidden, false)
  assert.equal(p.title(), 'Make your first workspace')
  // config.json unreadable: not a fresh start, and it says so rather than asking
  p.screen.render(none({ setup: setup('ready'), settingsBroken: true }))
  assert.match(p.title(), /can’t read its settings/)
  assert.deepEqual(p.buttons(), [])
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
  p.screen.render(state({ setup: setup('ready', 'signin'), roster: [{ name: 'Ada' }], workspaces: [{ id: 'shop', agents: 1 }, { id: 'docs', agents: 0 }] }))
  p.screen.open()
  assert.equal(p.title(), 'Claude Code and Codex')
  assert.deepEqual(p.buttons(), ['Done', 'Check again', 'Add a provider…'])
})

test('Q thinks while it looks, then says his line; his line keeps its place, so the dots going don’t start it over', () => {
  const p = page()
  p.screen.render(state({ setup: { checked: false, clis: [] }, roster: [{ name: 'Ada' }] }))
  p.screen.open()
  // a morph matches children by place: the line's bubble comes right after Q, empty while he thinks, the dots after it
  assert.match(p.view.html, /<span class="su-who q"[^>]*><i class="av"><\/i><\/span>\s*<p class="su-say" data-name="" hidden><\/p><span class="su-think/)
  p.screen.render(state({ setup: setup('ready'), roster: [{ name: 'Ada' }] }))
  assert.match(p.view.html, /<span class="su-who q"[^>]*><i class="av"><\/i><\/span>\s*<p class="su-say" data-name="We’re all set\."[^>]*><span style="--i:0">We’re<\/span> <span style="--i:1">all<\/span> <span style="--i:2">set\.<\/span><\/p>\s*<\/div>/)
  assert.doesNotMatch(p.view.html, /su-think/, 'done thinking')
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

// ---- the first run ---------------------------------------------------------------------------------------------------

const settle = (ms = 220) => new Promise((r) => setTimeout(r, ms)) // past a scene's change (go: 170ms)
const fresh = (extra) => state({ workspace: null, setup: setup('ready'), ...extra })

test('a new install opens with the first run: the name, + New agent, which makes Q, and his two lines move on by themselves', async () => {
  const saved = new Map()
  const p = page({ saved })
  p.screen.render(fresh())
  assert.equal(p.view.hidden, false)
  assert.equal(p.step(), 'title')
  assert.match(p.view.html, /class="fold"/)
  p.view.on.pointerdown() // a click skips the title
  assert.equal(p.step(), 'meet')
  assert.match(p.view.html, /data-fr="new"/)
  p.press(p.view, { fr: 'new' })
  await settle()
  assert.equal(p.step(), 'hello')
  assert.match(p.view.html, /class="fr-fig q pop"/, 'he pops out of it')
  assert.match(p.view.html, /Hi,<\/span> <span[^>]*>I’m<\/span> <span class="em"[^>]*>Q\.</, 'his name in the brand colour')
  assert.equal(saved.get('crew.firstRun'), 'hello', 'kept, so a quit picks up here')
  assert.doesNotMatch(p.view.html, /data-fr="hi"/, 'nothing to press: the line moves on')
  p.view.on.pointerdown() // (or wait for it)
  await settle()
  assert.equal(p.step(), 'role')
  assert.match(p.view.html, /clique\./)
  p.view.on.pointerdown()
  await settle()
  assert.equal(p.step(), 'work', 'and then he asks what kind of work it is')
  assert.match(p.view.html, /clique<\/b>.*sticks together/, 'what a clique is, for whoever hovers the name')
})

test('a quit during his opening lines starts it over: nothing had been asked yet', () => {
  const p = page({ saved: new Map([['crew.firstRun', 'role']]) })
  p.screen.render(fresh())
  assert.equal(p.step(), 'title')
})

test('the kind of work is kept, and decides the clique he proposes', async () => {
  const saved = new Map([['crew.firstRun', 'work']])
  const p = page({ saved })
  p.screen.render(fresh())
  assert.equal(p.step(), 'work')
  for (const w of ['software', 'design', 'writing', 'research', 'marketing', 'other']) assert.match(p.view.html, new RegExp(`data-fr-work="${w}"`))
  p.press(p.view, { frWork: 'writing' })
  assert.match(p.view.html, /class="fr-role on" data-fr-work="writing"/)
  assert.equal(saved.get('crew.firstWork'), 'writing')
  await settle(700)
  assert.equal(p.step(), 'workspace', 'Claude Code is ready: no need to ask for it')
  assert.deepEqual(p.screen.starters('writing').length, 3)
  assert.notDeepEqual(p.screen.starters('writing'), p.screen.starters('software'))
  assert.deepEqual(p.screen.starters(null), p.screen.starters('other'), 'a workspace made another way gets the general ones')
})

test('an install that already has a workspace never sees it', () => {
  const saved = new Map()
  const p = page({ saved })
  p.screen.render(state({ setup: setup('ready') }))
  assert.equal(saved.get('crew.firstRun'), 'done')
  assert.equal(p.step(), undefined)
  assert.equal(p.view.hidden, true)
})

test('with neither Claude Code nor Codex, Q asks for one, and goes on by himself once the check finds it', async () => {
  const saved = new Map([['crew.firstRun', 'work']])
  const p = page({ saved })
  p.screen.render(fresh({ setup: setup('missing') }))
  p.press(p.view, { frWork: 'software' })
  await settle(700)
  assert.equal(p.step(), 'cli')
  assert.match(p.view.html, /Claude Code[\s\S]*Not installed/)
  assert.match(p.view.html, /data-act="check"/)
  p.screen.render(fresh({ setup: setup('ready') }))
  assert.match(p.view.html, /Found<\/span> <span[^>]*>Claude/)
  await settle(2200)
  assert.equal(p.step(), 'workspace')
})

test('the workspace is made with the folder you picked, and the first run stays up for its clique', async () => {
  const saved = new Map([['crew.firstRun', 'workspace']])
  const made = state({ workspace: { id: 'shop', name: 'Shop' }, setup: setup('ready') })
  const p = page({ saved, answers: ([what, op]) => (what === 'pickFolder' ? '/Users/you/code/shop' : what === 'folderInfo' ? { exists: true, path: '/Users/you/code/shop' } : what === 'workspace' && op === 'create' ? { state: made } : undefined) })
  p.screen.render(fresh())
  assert.equal(p.step(), 'workspace')
  assert.match(p.view.html, /data-fr="make" disabled/, 'nothing to make until there is a folder')
  p.press(p.view, { fr: 'pick' })
  await settle(0)
  assert.match(p.view.html, /value="Shop"/, 'named after its folder')
  p.press(p.view, { fr: 'make' })
  await settle()
  const create = p.calls.find(([w, op]) => w === 'workspace' && op === 'create')
  assert.equal(create[3].folder, '/Users/you/code/shop')
  assert.equal(create[3].name, 'Shop')
  assert.equal(saved.get('crew.work.shop'), 'software', 'what #general offers to ask first')
  assert.ok(p.calls.some(([w]) => w === 'onMade'), 'the dashboard goes to it')
  p.screen.render(made) // the state that brings it
  assert.equal(p.step(), 'crew')
  assert.equal(saved.get('crew.firstRun'), 'crew')
  assert.equal(p.view.hidden, false)
})

test('the clique for that work stands beside Q, anyone can be left out, and the rest join on whichever CLI is ready', async () => {
  const saved = new Map([['crew.firstRun', 'crew'], ['crew.firstWork', 'writing']])
  const p = page({ saved })
  const here = (agents) => state({ setup: setup('missing', 'ready'), agents })
  p.screen.render(here([]))
  assert.equal(p.step(), 'crew')
  assert.match(p.view.html, /clique<\/span> <span[^>]*>for<\/span> <span class="em"[^>]*>writing\./)
  for (const n of ['nora', 'felix', 'maya', 'otis']) assert.match(p.view.html, new RegExp(`data-name="mate-${n}"`))
  assert.match(p.view.html, /Start with these four/)
  p.press(p.view, { frPick: 'Otis' })
  assert.match(p.view.html, /class="fr-fig mate out" data-name="mate-otis"/)
  assert.match(p.view.html, /Start with these three/)
  p.press(p.view, { fr: 'bring' })
  await settle()
  const added = p.calls.filter(([w]) => w === 'addAgent').map(([, f]) => f)
  assert.deepEqual(added.map((f) => [f.name, f.provider]), [['Nora', 'codex'], ['Felix', 'codex'], ['Maya', 'codex']])
  assert.ok(added.every((f) => f.area && f.avatar), 'each with its job and its look')
  p.screen.render(here([{ name: 'nora' }, { name: 'felix' }, { name: 'maya' }, { name: 'q', system: true }]))
  await settle(600)
  assert.equal(saved.get('crew.firstRun'), 'done')
  assert.equal(saved.get('crew.hints'), 'on', 'the app says what each new thing is, in place of a tour')
  assert.ok(p.calls.some(([w]) => w === 'onLand'))
  assert.ok(!p.calls.some(([w]) => w === 'onTour'))
  assert.equal(p.view.hidden, true, 'and the dashboard is there')
})

test('with everyone left out it starts with just Q', async () => {
  const saved = new Map([['crew.firstRun', 'crew']])
  const p = page({ saved })
  p.screen.render(state({ setup: setup('ready') }))
  for (const n of ['Ada', 'Theo', 'Iris', 'June']) p.press(p.view, { frPick: n })
  assert.match(p.view.html, /Start with just Q/)
  p.press(p.view, { fr: 'bring' })
  await settle(600)
  assert.equal(p.calls.filter(([w]) => w === 'addAgent').length, 0)
  assert.equal(saved.get('crew.firstRun'), 'done')
})

test('a workspace that came another way (a linked computer’s) ends the first run where it is', async () => {
  const saved = new Map([['crew.firstRun', 'workspace']])
  const p = page({ saved })
  p.screen.render(fresh())
  assert.equal(p.step(), 'workspace')
  p.screen.render(state({ setup: setup('ready') }))
  assert.equal(saved.get('crew.firstRun'), 'done')
  assert.equal(p.view.hidden, true)
})

test('Skip leaves the first run for the setup screen, for good', () => {
  const saved = new Map()
  const p = page({ saved })
  p.screen.render(fresh())
  p.press(p.view, { fr: 'skip' })
  assert.equal(saved.get('crew.firstRun'), 'done')
  assert.equal(p.step(), undefined)
  assert.equal(p.title(), 'Make your first workspace')
})

test('a tour the first run ended with, quit before it began, begins once the dashboard is back', async () => {
  const saved = new Map([['crew.firstRun', 'tour']])
  const p = page({ saved })
  p.screen.render(state({ setup: setup('ready') }))
  await settle(400)
  assert.equal(p.calls.filter(([w]) => w === 'onTour').length, 1)
  p.screen.render(state({ setup: setup('ready') }))
  await settle(400)
  assert.equal(p.calls.filter(([w]) => w === 'onTour').length, 1, 'once')
})

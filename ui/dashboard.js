// Full-screen view: the crew collection, every agent's live terminal, and the crew feed.
/* global themeButton, nameHTML, contextRing, mountTasks, crew, live, store, morph, agentCard, statusText, brainLabel, brainShort, crewSummary, segmented, celebrate, agentColor, markSVG, mountFeed, mountComposer, mountCollection, avatarHTML, esc, ICONS, Terminal, FitAddon */

const $ = (s) => document.querySelector(s)
const THEME = {
  background: '#0f1012', foreground: '#e4e4e7', cursor: '#e4e4e7', cursorAccent: '#0f1012', selectionBackground: 'rgba(122, 162, 255, 0.3)',
  black: '#1d1f21', red: '#ff6b6b', green: '#4cd38a', yellow: '#ffd166', blue: '#7aa2ff', magenta: '#c58cff', cyan: '#36cfc9', white: '#d4d4d8',
  brightBlack: '#5c5f66', brightRed: '#ff8787', brightGreen: '#69db9a', brightYellow: '#ffe08a', brightBlue: '#9bb8ff', brightMagenta: '#d6a8ff', brightCyan: '#5fe0da', brightWhite: '#fafafa',
}

const terms = new Map() // name -> { tile, head, term, fit, ready }
const feed = mountFeed($('.feed'), { onAgent: (name) => select(name), onTicket: (key) => openTask(key) })
const composer = mountComposer($('.compose'), { dropZone: $('.chat') })
const collection = mountCollection($('.collection'), { onTerminal: (name) => select(name), onImport: () => importPack() })
const tasks = mountTasks($('.tasks-view'), { onTerminal: (name) => select(name) })
let view = store.get('crew.view') === 'bugs' ? 'tasks' : store.get('crew.view') || 'crew'
let selected = null
let state = { agents: [], providers: {} }

$('.titlebar .logo').outerHTML = markSVG('0 6 24 16')
$('.blank .blank-mark').outerHTML = ICONS.mark
$('.titlebar [data-act=add]').innerHTML = `${ICONS.plus}Agent`
$('.side .autopilot .glyph').innerHTML = ICONS.plane
$('[data-act=config]').innerHTML = ICONS.braces
$('#link .h-icon').innerHTML = ICONS.computers
$('#import .h-icon').innerHTML = ICONS.import
const drawTheme = themeButton($('[data-act=theme]'))

// ---- terminals -------------------------------------------------------------

function createTile(name) {
  const tile = document.createElement('div')
  tile.className = 'tile'
  tile.dataset.name = name
  tile.innerHTML = '<div class="tile-head"></div><div class="term"></div>'
  $('.terms').append(tile)

  const term = new Terminal({ theme: THEME, fontFamily: '"SF Mono", Menlo, monospace', fontSize: 12, lineHeight: 1.12, cursorBlink: true, macOptionIsMeta: true, scrollback: 5000 })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit)
  term.open(tile.querySelector('.term'))
  // Shift+Enter = newline in Claude Code, same as /terminal-setup configures.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || e.key !== 'Enter' || !e.shiftKey) return true
    crew.input(name, '\x1b\r')
    return false
  })
  term.onData((data) => crew.input(name, data))

  const t = { tile, head: tile.querySelector('.tile-head'), term, fit, ready: false }
  terms.set(name, t)
  let timer
  new ResizeObserver(() => {
    clearTimeout(timer)
    timer = setTimeout(() => resize(name), 40)
  }).observe(tile.querySelector('.term'))
  replay(t)
  return t
}

// Replay what the agent already printed at the size it was drawn, then fit (the agent redraws on resize).
// Live chunks that arrive before this are already in the buffer. Again after an agent's computer comes back.
function replay(t) {
  const name = t.tile.dataset.name
  t.ready = false
  crew.call('buffer', name).then(({ data, cols, rows }) => {
    t.term.reset()
    t.term.resize(cols, rows)
    t.term.write(data, () => {
      t.ready = true
      resize(name)
    })
  }, () => (t.ready = true))
}

function resize(name) {
  const t = terms.get(name)
  if (!t || !t.tile.offsetWidth) return
  t.fit.fit()
  crew.call('resize', name, t.term.cols, t.term.rows).catch(() => {})
}

crew.onPty((name, data) => {
  const t = terms.get(name)
  if (t?.ready) t.term.write(data)
})

function tileHead(a) {
  const busy = a.status === 'working' || a.status === 'waiting'
  return `${avatarHTML(a, { size: 26 })}<b>${nameHTML(a)}</b><span class="model" title="${esc(brainLabel(a, state.providers))}">${esc(brainShort(a, state.providers))}</span>
    <span class="state ${a.status}" ${busy ? 'data-act="markIdle" title="Stuck? Click to mark it free"' : ''}>${esc(statusText(a))}</span>
    ${a.fast ? `<span class="tag fast-tag" title="Fast: Codex's fast service tier">${ICONS.bolt}</span>` : ''}
    ${a.yolo ? '<span class="tag yolo-tag" title="Skips all permission prompts">YOLO</span>' : ''}
    <span class="activity">${esc(a.activity)}</span>
    ${a.queue ? `<span class="tag">${a.queue} queued</span>` : ''}
    ${contextRing(a)}
    <button class="icon" data-act="fresh" aria-pressed="${Boolean(a.freshPending)}" title="${a.freshPending ? 'Starts a new conversation when it finishes this task' : 'New conversation: a clean slate for its next task (the old one stays in its history)'}">${ICONS.fresh}</button>
    <button class="icon" data-act="edit" title="Edit agent">${ICONS.edit}</button>
    <button class="icon" data-act="restart" title="Restart (resumes the session)">${ICONS.restart}</button>
    <button class="icon" data-act="off" title="Turn off (stays off after restarts)">${ICONS.power}</button>`
}

$('.terms').addEventListener('click', (e) => {
  const tile = e.target.closest('.tile')
  if (!tile) return
  const name = tile.dataset.name
  const act = e.target.closest('[data-act]')?.dataset.act
  if (act === 'restart') {
    terms.get(name).term.reset()
    crew.call('restart', name)
  } else if (act === 'fresh') crew.call('freshStart', name).catch((err) => alert(err.message))
  else if (act === 'off') crew.call('update', name, { off: true })
  else if (act === 'markIdle') crew.call('markIdle', name)
  else if (act === 'edit') edit(name)
  else if (!act) highlight(name)
})
$('.terms').addEventListener('dblclick', (e) => {
  const head = e.target.closest('.tile-head')
  if (head && !e.target.closest('button')) {
    highlight(head.parentElement.dataset.name)
    setView(view === 'focus' ? 'grid' : 'focus')
  }
})

// ---- selection + views -----------------------------------------------------

function highlight(name) {
  selected = name
  for (const [n, t] of terms) t.tile.classList.toggle('on', n === name)
  for (const el of document.querySelectorAll('.side .agent')) el.classList.toggle('on', el.dataset.agent === name)
}

// Show an agent's terminal and aim the composer at it. Agents that are off have no terminal: open their card.
function select(name) {
  if (!terms.has(name)) return edit(name)
  highlight(name)
  composer.setTarget(name)
  setView('focus')
  terms.get(name).term.focus()
}

function edit(name) {
  setView('crew')
  collection.open(name)
}

function setView(next) {
  view = next
  store.set('crew.view', next)
  if (!terms.has(selected)) highlight(terms.keys().next().value)
  const crewView = view === 'crew'
  const tasksView = view === 'tasks'
  $('.collection').classList.toggle('hidden', !crewView)
  $('.tasks-view').classList.toggle('hidden', !tasksView)
  $('.terms').classList.toggle('hidden', crewView || tasksView)
  $('.terms').classList.toggle('focus', view === 'focus')
  drawBlank()
  segmented($('.seg.views'), (b) => b.dataset.view === view)
  requestAnimationFrame(() => terms.forEach((_, name) => resize(name)))
}

function drawBlank() {
  const on = state.agents.filter((a) => a.on).length
  $('.blank').classList.toggle('hidden', view === 'crew' || view === 'tasks' || on > 0)
  $('.blank b').textContent = state.agents.length ? 'All agents are off' : 'No agents yet'
  $('.blank span').textContent = state.agents.length ? 'Flip one on in the sidebar, it picks up its last session.' : 'Make your first one in the Crew view.'
}

$('.seg.views').addEventListener('click', (e) => e.target.dataset.view && setView(e.target.dataset.view))
// ⌘1 ⌘2 ⌘3: Crew, Grid, Focus
const VIEWS = ['crew', 'tasks', 'grid', 'focus']
document.querySelectorAll('.seg.views button').forEach((b, i) => (b.title += ` (⌘${i + 1})`))
document.addEventListener('keydown', (e) => {
  const n = Number(e.key)
  if (!e.metaKey || e.altKey || e.ctrlKey || !(n >= 1 && n <= VIEWS.length)) return
  e.preventDefault()
  setView(VIEWS[n - 1])
})
$('.side .agents').addEventListener('click', (e) => {
  if (e.target.closest('.mode, .switch')) return
  const card = e.target.closest('.agent')
  if (card) (view === 'crew' ? edit : select)(card.dataset.agent)
})
$('.autopilot .switch').addEventListener('change', (e) => crew.call('autopilot', e.target.checked))
$('[data-act=config]').addEventListener('click', () => crew.call('config'))
for (const b of document.querySelectorAll('[data-act=add]')) b.addEventListener('click', addAgent)

function addAgent() {
  setView('crew')
  collection.create()
}

function handleFocus(arg) {
  if (arg === ':add') addAgent()
  else if (arg?.startsWith('task:') || arg?.startsWith('bug:')) openTask(arg.slice(arg.indexOf(':') + 1))
  else if (arg) select(arg)
}

function openTask(key) {
  setView('tasks')
  tasks.open(key)
}
crew.onFocus(handleFocus)

// ---- render ----------------------------------------------------------------

const ready = live((next) => {
  state = next
  drawTheme(state.theme)
  drawComputers(state)
  // Terminals only for agents that are on; the sidebar lists everyone so off agents are one click from coming back.
  const on = state.agents.filter((a) => a.on)
  const names = new Set(on.map((a) => a.name))
  for (const [name, t] of terms) {
    if (names.has(name)) continue
    t.term.dispose()
    t.tile.remove()
    terms.delete(name)
  }
  for (const a of on) {
    const t = terms.get(a.name) ?? createTile(a.name)
    // back from being unreachable, or a new conversation: show the terminal as it is now
    const convo = a.convo?.since
    if ((t.away && a.status !== 'away') || (t.convo && convo && convo !== t.convo)) replay(t)
    t.away = a.status === 'away'
    t.convo = convo
    t.tile.style.setProperty('--c', agentColor(a))
    morph(t.head, tileHead(a))
  }

  morph($('.side .agents'), state.agents.map((a) => agentCard(a, state.providers)).join(''))
  $('.autopilot .switch').checked = state.autopilot
  $('.side-count').textContent = state.agents.length ? `${on.length} of ${state.agents.length} on` : ''
  morph($('.titlebar .sums'), crewSummary(state))
  highlight(terms.has(selected) ? selected : on[0]?.name)
  drawBlank()
  feed.render(state)
  composer.render(state)
  collection.render(state)
  tasks.render(state)
  const badge = tasks.badge(state)
  const el = $('.seg-badge')
  el.textContent = badge.review || badge.open || ''
  el.classList.toggle('review', badge.review > 0)
  el.title = badge.review ? `${badge.review} waiting for your review` : badge.open ? `${badge.open} open` : ''
  celebrate($('.side .agents'), state.agents) // after the cards, so a visible card gets the confetti
})

// ---- Computers (Crew Link) -------------------------------------------------------

const linkDialog = $('#link')
let linkKey = ''
let fresh = null // a computer just linked: its agents are shown to pick from
let linkErr = '' // kept across redraws until the next try

function drawComputers(state) {
  const c = state.computers ?? { me: {}, links: [] }
  const online = c.links.filter((l) => l.online).length
  const chip = $('.link-chip')
  chip.classList.toggle('on', Boolean(online || c.me.sharing))
  chip.innerHTML = c.links.length
    ? `<span class="dot ${online === c.links.length ? 'working' : 'waiting'}"></span>${c.links.length + 1} computers`
    : c.me.sharing ? '<span class="dot working"></span>Sharing' : `${ICONS.computers}Computers`
  const next = JSON.stringify([c, fresh, linkErr])
  if (next === linkKey) return
  linkKey = next
  // keep what's being typed across redraws
  const body = linkDialog.querySelector('.link-body')
  const typed = body.querySelector('[data-link-code]')?.value ?? ''
  morph(body, computersHTML(c))
  const box = body.querySelector('[data-link-code]')
  if (box) box.value = typed
}

const computersHTML = ({ me, links }) => `
  <section class="ls">
    <div class="ls-row small" style="margin:0"><div><input class="me-name" data-me-name value="${esc(me.name)}" spellcheck="false" title="This computer's name; others see its agents as name@${esc(me.slug)}">
      <p>This computer · ${me.agents} agent${me.agents === 1 ? '' : 's'} run here · others see them as <b>name@${esc(me.slug)}</b></p></div></div>
    <label class="ls-row"><div><b>Share this computer</b><p>Let your other computers link to it.</p></div><input type="checkbox" class="switch" data-link-share ${me.sharing ? 'checked' : ''}></label>
    ${me.sharing ? `
      <div class="code-box"><code>${esc(me.code)}</code><button class="btn" data-link-copy>Copy</button></div>
      <p>On your other computer: <b>Computers → Link a computer → paste → Link</b>. Anyone with this code can use and drive your agents, so keep it to your own machines.</p>
      <div class="addr">${me.hosts.map((h) => `<span><b>${esc(h.address)}</b> ${esc(h.via)}</span>`).join('')}</div>
      <div class="ls-row small"><span>port ${me.port}</span><button class="btn" data-link-reset title="Makes a new code; computers using the old one are disconnected">New code</button></div>`
    : me.error ? `<p class="err">${esc(me.error)}</p>` : ''}
  </section>
  ${links.map(linkHTML).join('')}
  <section class="ls">
    <b>Link a computer</b>
    <p>Paste the code from the other computer's <b>Share this computer</b>. Linking works both ways: each computer sees the other's agents.</p>
    <div class="code-in"><textarea data-link-code rows="2" placeholder="crew1.…" spellcheck="false"></textarea><button class="btn primary" data-link-connect>Link</button></div>
    <p class="err" data-link-err>${esc(linkErr)}</p>
  </section>`

// A linked computer and its agents: tick the ones to use from here, or bring one over to run here.
function linkHTML(l) {
  const used = l.agents.filter((a) => !a.hidden).length
  const status = l.online ? (l.status?.address ? `linked via ${esc(l.status.address)}` : 'linked to this computer') : esc(l.status?.error ?? 'unreachable, it reconnects on its own')
  return `<section class="ls ${fresh === l.slug ? 'fresh' : ''}" data-computer="${esc(l.slug)}">
    <div class="pc-head"><span class="dot ${l.online ? 'working' : 'waiting'}"></span><div class="grow"><b>${esc(l.name)}</b><p>${status}</p></div>
      ${l.saved ? `<button class="btn small" data-forget="${esc(l.slug)}" title="Unlink it from this computer">Forget</button>` : ''}</div>
    ${fresh === l.slug ? `<p><b>Pick which of ${esc(l.name)}'s agents to use here.</b> The rest keep running there. Move one here to run it on this computer instead.</p>` : ''}
    ${l.agents.length ? `<ul class="pc-agents">${l.agents.map((a) => `
      <li class="${a.hidden ? 'unused' : ''}">${avatarHTML(a, { size: 30, mood: 'still' })}
        <span class="who"><b>${esc(a.seed)}</b><small>${esc(a.area || 'no area')}</small></span>
        ${l.online ? `<button class="btn small" data-move="${esc(a.name)}" title="Run it on this computer instead, with its instructions, look and work experience">Move here</button>` : ''}
        <label class="use"><input type="checkbox" class="switch" data-use="${esc(a.name)}" ${a.hidden ? '' : 'checked'}>Use</label>
      </li>`).join('')}</ul>
      ${l.agents.length > 1 ? `<div class="ls-row small"><span>using ${used} of ${l.agents.length}</span><span><button class="btn small" data-use-all="${esc(l.slug)}">All</button> <button class="btn small" data-use-none="${esc(l.slug)}">None</button></span></div>` : ''}`
    : `<p>${l.online ? 'No agents there yet.' : ''}</p>`}
  </section>`
}

function openComputers() {
  fresh = null
  linkErr = ''
  linkKey = ''
  drawComputers(state)
  linkDialog.showModal()
}

$('.link-chip').addEventListener('click', openComputers)
linkDialog.addEventListener('click', async (e) => {
  const t = e.target
  if (t.closest('[data-close]') || t === linkDialog) return linkDialog.close()
  const linked = (slug) => state.computers.links.find((l) => l.slug === slug)
  const fail = (text) => {
    linkErr = text
    drawComputers(state)
  }
  try {
    if (t.closest('[data-link-copy]')) {
      await crew.call('copy', linkDialog.querySelector('.code-box code').textContent)
      t.closest('[data-link-copy]').textContent = 'Copied ✓'
    }
    if (t.closest('[data-link-reset]') && confirm('Make a new code? Computers using the current one are disconnected until they link again with the new one.')) await crew.call('link', 'reset')
    if (t.closest('[data-link-connect]')) {
      const code = linkDialog.querySelector('[data-link-code]').value.trim()
      if (!code) return fail('Paste the code from the other computer first')
      const btn = t.closest('[data-link-connect]')
      btn.disabled = true
      btn.textContent = 'Linking…'
      linkErr = ''
      try {
        fresh = await crew.call('link', 'connect', code)
        linkDialog.querySelector('[data-link-code]').value = ''
        linkKey = ''
        drawComputers(state)
        linkDialog.querySelector(`[data-computer="${CSS.escape(fresh)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } finally {
        btn.disabled = false
        btn.textContent = 'Link'
      }
    }
    const forget = t.closest('[data-forget]')?.dataset.forget
    if (forget && confirm(`Forget ${linked(forget)?.name}? Its agents disappear from here (they keep running there). Link it again with its code any time.`)) await crew.call('link', 'forget', forget)
    const all = t.closest('[data-use-all]')?.dataset.useAll
    const none = t.closest('[data-use-none]')?.dataset.useNone
    if (all || none) await crew.call('link', 'hide', linked(all || none).agents.map((a) => a.name), Boolean(none))
    const move = t.closest('[data-move]')?.dataset.move
    if (move) {
      // the agent's card, set to run here: its folder on this computer can be checked before saving
      linkDialog.close()
      setView('crew')
      collection.open(move, { home: '' })
    }
  } catch (x) {
    fail(x.message)
  }
})
linkDialog.addEventListener('change', async (e) => {
  const d = e.target.dataset
  try {
    if ('linkShare' in d) await crew.call('link', 'share', e.target.checked)
    if (d.use) await crew.call('link', 'hide', [d.use], !e.target.checked)
    if ('meName' in d) {
      const name = e.target.value.trim()
      if (name && name !== state.computers.me.name && confirm(`Rename this computer to "${name}"? Linked computers reconnect, and see its agents as name@${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.`)) await crew.call('link', 'rename', name)
      else e.target.value = state.computers.me.name
    }
  } catch (x) {
    linkKey = ''
    drawComputers(state)
    alert(x.message)
  }
})
linkDialog.addEventListener('keydown', (e) => e.key === 'Enter' && e.target.matches('[data-me-name]') && e.target.blur())

// ---- import: a .crew file, picked or dropped ------------------------------------------

const importDialog = $('#import')
let pending = null // { file, pack, agents }

async function importPack(dropped) {
  try {
    const opened = await crew.call('openPack', dropped)
    if (!opened) return
    pending = opened
    drawImport()
    importDialog.showModal()
  } catch (x) {
    alert(x.message)
  }
}

function drawImport() {
  const { file, pack, agents } = pending
  const places = [{ slug: '', name: 'this computer' }, ...(state.computers?.links ?? []).filter((l) => l.online)]
  const brain = (a) => [state.providers[a.provider]?.label ?? a.provider, a.model, a.effort].filter(Boolean).join(' · ')
  importDialog.querySelector('.lead').innerHTML = `<b>${esc(file)}</b> · ${agents.length} agent${agents.length === 1 ? '' : 's'}${pack.exported ? `, exported ${new Date(pack.exported).toLocaleDateString()}` : ''}. Imported agents start switched off, so you can look them over first.`
  importDialog.querySelector('.imp-list').innerHTML = agents.map((a) => `
    <div class="imp" data-i="${a.index}">
      <input type="checkbox" class="switch" data-take checked>
      ${avatarHTML({ name: a.seed, avatar: a.avatar }, { size: 40, mood: 'still' })}
      <div class="imp-what"><input type="text" class="imp-name" data-name value="${esc(a.name)}" spellcheck="false" title="Its name here"><small title="${esc(a.area)}">${esc(a.area || 'no area')} · ${esc(brain(a))}${a.yolo ? ' · YOLO' : ''}${a.images ? ` · ${a.images} reference image${a.images > 1 ? 's' : ''}` : ''}</small></div>
      <div class="imp-fields">
        <input type="text" class="imp-folder" data-folder placeholder="Folder (home if empty)${a.folder ? `, it worked in …/${esc(a.folder)}` : ''}" spellcheck="false">
        ${places.length > 1 ? `<select data-home title="Which computer it runs on">${places.map((p) => `<option value="${esc(p.slug)}">on ${esc(p.name)}</option>`).join('')}</select>` : ''}
      </div>
    </div>`).join('')
  importDialog.querySelector('[data-import-err]').textContent = ''
  syncImport()
}

function syncImport() {
  const rows = [...importDialog.querySelectorAll('.imp')]
  for (const r of rows) r.classList.toggle('skip', !r.querySelector('[data-take]').checked)
  const n = rows.filter((r) => r.querySelector('[data-take]').checked).length
  const go = importDialog.querySelector('[data-import-go]')
  go.disabled = !n
  go.textContent = n ? `Import ${n}` : 'Import'
}

importDialog.addEventListener('change', async (e) => {
  syncImport()
  // a name free on one computer may be taken on another
  if (e.target.matches('[data-home]')) {
    const row = e.target.closest('.imp')
    const box = row.querySelector('[data-name]')
    box.value = await crew.call('freeName', pending.agents[row.dataset.i].seed, e.target.value).catch(() => box.value)
  }
})
importDialog.addEventListener('click', async (e) => {
  if (e.target.closest('[data-close]') || e.target === importDialog) return importDialog.close()
  if (!e.target.closest('[data-import-go]')) return
  const choices = [...importDialog.querySelectorAll('.imp')]
    .filter((r) => r.querySelector('[data-take]').checked)
    .map((r) => ({ index: Number(r.dataset.i), name: r.querySelector('[data-name]').value.trim(), folder: r.querySelector('[data-folder]').value.trim() || undefined, home: r.querySelector('[data-home]')?.value || '' }))
  try {
    const added = await crew.call('importAgents', pending.pack, choices)
    importDialog.close()
    setView('crew')
    if (added.length === 1) collection.open(added[0])
  } catch (x) {
    importDialog.querySelector('[data-import-err]').textContent = x.message
  }
})

crew.onImport(importPack)
// A .crew file dropped anywhere on the window (image drop zones only take images).
document.addEventListener('dragover', (e) => [...e.dataTransfer.items].some((i) => i.kind === 'file') && e.preventDefault())
document.addEventListener('drop', async (e) => {
  const file = [...e.dataTransfer.files].find((f) => f.name.endsWith('.crew'))
  if (!file) return
  e.preventDefault()
  e.stopPropagation()
  importPack({ name: file.name, text: await file.text() })
}, true)

ready.then(() => {
  setView(state.agents.length ? view : 'crew')
  handleFocus(new URLSearchParams(location.search).get('focus'))
})

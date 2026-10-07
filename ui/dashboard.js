// Full-screen view: the crew on the left, Crew / Tasks / Terminals in the middle, the chat on the right.
/* global isUnread, themeButton, orbitHTML, subsChip, nameHTML, contextRing, mountTasks, crew, live, store, morph, rosterHTML, modeMarks, statusText, brainShort, crewSummary, crewGroups, segmented, celebrate, agentColor, markSVG, mountFeed, mountComposer, mountCollection, avatarHTML, esc, plural, popMenu, ICONS, Terminal, FitAddon */

const $ = (s) => document.querySelector(s)
const THEME = {
  background: '#0f1012', foreground: '#e4e4e7', cursor: '#e4e4e7', cursorAccent: '#0f1012', selectionBackground: 'rgba(122, 162, 255, 0.3)',
  black: '#1d1f21', red: '#ff6b6b', green: '#4cd38a', yellow: '#ffd166', blue: '#7aa2ff', magenta: '#c58cff', cyan: '#36cfc9', white: '#d4d4d8',
  brightBlack: '#5c5f66', brightRed: '#ff8787', brightGreen: '#69db9a', brightYellow: '#ffe08a', brightBlue: '#9bb8ff', brightMagenta: '#d6a8ff', brightCyan: '#5fe0da', brightWhite: '#fafafa',
}

const terms = new Map() // name -> { tile, head, term, fit, ready }
const feed = mountFeed($('.feed'), { onAgent: (name) => select(name), onTicket: (key) => openTask(key), onReply: (e) => composer.replyTo(e) })
const composer = mountComposer($('.compose'), { dropZone: $('.chat') })
const collection = mountCollection($('.collection'), { onTerminal: (name) => select(name), onImport: () => importPack(), onMove: (name, home) => moveSheet(name, home) })
const tasks = mountTasks($('.tasks-view'), { onTerminal: (name) => select(name) })
// Views: Crew, Tasks and Terminals, the terminals laid out as a grid or one big one. Older saves said grid,
// focus or bugs.
const saved = store.get('crew.view')
let view = saved === 'bugs' ? 'tasks' : saved === 'grid' || saved === 'focus' ? 'terminals' : ['crew', 'tasks', 'terminals'].includes(saved) ? saved : 'crew'
let layout = saved === 'focus' || (saved !== 'grid' && store.get('crew.layout') === 'focus') ? 'focus' : 'grid'
let show = store.get('crew.show') === 'busy' ? 'busy' : 'all' // the grid: every terminal, or the busy ones
let selected = null
let state = { agents: [], providers: {} }
// the roster's folds: computers you folded away, and the "off" lines you opened
const folds = new Set((() => {
  try {
    return JSON.parse(store.get('crew.folds') || '[]')
  } catch {
    return []
  }
})())
let find = ''

$('.titlebar .logo').outerHTML = markSVG('0 6 24 16')
$('.blank .blank-mark').outerHTML = ICONS.mark
const VIEW_LABEL = { crew: [markSVG('0 4 24 18'), 'Crew'], tasks: [ICONS.task, 'Tasks'], terminals: [ICONS.terminal, 'Terminals'] }
for (const b of document.querySelectorAll('.seg.views button')) b.innerHTML = `${VIEW_LABEL[b.dataset.view][0]}<span>${VIEW_LABEL[b.dataset.view][1]}</span>${b.dataset.view === 'tasks' ? '<i class="seg-badge"></i>' : ''}`
$('[data-layout=grid]').innerHTML = `${ICONS.grid}Grid`
$('[data-layout=focus]').innerHTML = `${ICONS.focus}Focus`
$('.find-icon').outerHTML = ICONS.search
$('.side-top [data-act=add]').innerHTML = ICONS.plus
$('.side .autopilot .glyph').innerHTML = ICONS.plane
$('[data-act=config]').innerHTML = ICONS.braces
$('#link .h-icon').innerHTML = ICONS.computers
$('#import .h-icon').innerHTML = ICONS.import
const drawTheme = themeButton($('[data-act=theme]'))
$('[data-panel=side]').innerHTML = ICONS.sidebar
$('[data-panel=chat]').innerHTML = ICONS.chatPanel

// The sidebar and the chat can each be put away for more room in the middle; remembered across launches.
function setPanel(which, on) {
  document.body.classList.toggle(`no-${which}`, !on)
  $(`[data-panel=${which}]`).setAttribute('aria-pressed', String(on))
  store.set(`crew.panel.${which}`, on ? '1' : '0')
  setTimeout(() => terms.forEach((_, name) => resize(name)), 340)
}
for (const which of ['side', 'chat']) setPanel(which, store.get(`crew.panel.${which}`) !== '0')
document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => setPanel(b.dataset.panel, document.body.classList.contains(`no-${b.dataset.panel}`))))

// ---- terminals -------------------------------------------------------------

function createTile(name) {
  const tile = document.createElement('div')
  tile.className = 'tile'
  tile.dataset.name = name
  tile.innerHTML = '<div class="tile-head"></div><div class="ribbon"></div><div class="term"></div>'
  $('.terms').append(tile)
  drawShow()

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

  const t = { tile, head: tile.querySelector('.tile-head'), ribbon: tile.querySelector('.ribbon'), term, fit, ready: false, replaying: false }
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
  const done = () => {
    t.ready = true
    t.replaying = false
    drawRibbon(t)
  }
  t.ready = false
  t.replaying = true
  drawRibbon(t)
  crew.call('buffer', name).then(({ data, cols, rows }) => {
    t.term.reset()
    t.term.resize(cols, rows)
    t.term.write(data, () => {
      done()
      resize(name)
    })
  }, done)
}

function resize(name) {
  const t = terms.get(name)
  if (!t || !t.tile.offsetWidth) return
  t.fit.fit()
  crew.call('resize', name, t.term.cols, t.term.rows).catch(() => {})
  drawRibbon(t)
}

// The ribbon under each terminal's header says what you're looking at. These aren't terminal apps: Crew runs
// the agent's CLI in a pseudo-terminal and draws its output with xterm.js, replaying what it printed before the
// view opened. So it says whether that's live (typing goes straight to the agent), streamed from another
// computer, still being redrawn, or frozen (its computer is unreachable, or the process exited).
const RIBBON = {
  live: (a) => ['Live', `Crew's view of ${a.name}'s terminal · earlier output replayed`,
    `This isn't a terminal app. Crew runs ${a.name}'s CLI in a pseudo-terminal and draws its output here; what you type goes straight to ${a.name}. Output from before this view opened (up to 256 KB) is replayed, so older lines can look off until ${a.name} redraws.`],
  mirror: (a) => ['Mirror', `Streamed from ${a.homeName} · earlier output replayed`,
    `${a.name} runs on ${a.homeName}. Its terminal output streams here over Crew Link and what you type goes back to it. Output from before this view opened is replayed, so older lines can look off until it redraws.`],
  replay: (a) => ['Replay', `Redrawing ${a.name}'s recent output…`, 'Crew is replaying what the agent printed before this view opened. Live output follows.'],
  offline: (a) => ['Offline', `${a.homeName ?? 'Its computer'} is unreachable · showing the last output`,
    `Not live: ${a.homeName ?? 'the computer it runs on'} can't be reached, so this is the last output it sent. It reconnects on its own.`],
  ended: (a) => ['Ended', 'The process exited · showing its last output', `Not live: ${a.name}'s CLI exited. Restart it from the header to pick its session back up.`],
}

function drawRibbon(t) {
  const a = t.agent
  if (!a) return
  const mode = t.replaying ? 'replay' : a.status === 'away' ? 'offline' : a.status === 'stopped' ? 'ended' : a.home ? 'mirror' : 'live'
  const [badge, line, tip] = RIBBON[mode](a)
  const size = t.term.cols && t.ready ? `${t.term.cols}×${t.term.rows}` : ''
  t.tile.dataset.mode = mode
  t.ribbon.dataset.mode = mode
  t.ribbon.title = tip
  morph(t.ribbon, `<span class="rb-badge">${badge}</span><span class="rb-text">${esc(line)}</span><span class="rb-meta">${esc([brainShort(a, state.providers), size].filter(Boolean).join(' · '))}</span>`)
}

crew.onPty((name, data) => {
  const t = terms.get(name)
  if (t?.ready) t.term.write(data)
})

// Who and what they're doing on the left; modes, the context gauge and the actions on the right. The brain and
// terminal size live in the ribbon below, so this line never crowds.
function tileHead(a) {
  const busy = a.status === 'working' || a.status === 'waiting'
  return `<span class="tile-av">${avatarHTML(a, { size: 24 })}${orbitHTML(a)}</span><b>${nameHTML(a)}</b>
    <span class="state ${a.status}" ${busy ? 'data-act="markIdle" title="Stuck? Click to mark it free"' : ''}>${esc(statusText(a))}</span>
    <span class="activity">${esc(a.activity)}</span>
    ${subsChip(a)}${a.queue ? `<span class="tag">${a.queue} queued</span>` : ''}${modeMarks(a)}
    ${contextRing(a)}
    <span class="tile-acts">
      <button class="icon" data-act="fresh" aria-pressed="${Boolean(a.freshPending)}" title="${a.freshPending ? 'Starts a new conversation when it finishes this task' : 'New conversation: a clean slate for its next task (the old one stays in its history)'}">${ICONS.fresh}</button>
      <button class="icon" data-act="edit" title="Edit agent">${ICONS.edit}</button>
      <button class="icon" data-act="restart" title="Restart (resumes the session)">${ICONS.restart}</button>
      <button class="icon" data-act="off" title="Turn off (stays off after restarts)">${ICONS.power}</button>
    </span>`
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
    setLayout(layout === 'focus' ? 'grid' : 'focus')
  }
})

// ---- selection + views -----------------------------------------------------

function highlight(name) {
  selected = name
  for (const [n, t] of terms) t.tile.classList.toggle('on', n === name)
  for (const el of document.querySelectorAll('.roster .crow')) el.classList.toggle('on', el.dataset.agent === name)
}

// Show an agent's terminal and aim the composer at it. Agents that are off have no terminal: open their card.
function select(name) {
  if (!terms.has(name)) return edit(name)
  highlight(name)
  composer.setTarget(name)
  layout = 'focus'
  store.set('crew.layout', layout)
  setView('terminals')
  terms.get(name).term.focus()
}

function edit(name) {
  if (view !== 'crew') setView('crew')
  collection.open(name)
}

// grid and focus are still accepted, for ⌘3 / ⌘4 and older callers
function setView(next) {
  if (next === 'grid' || next === 'focus') {
    layout = next
    store.set('crew.layout', layout)
    next = 'terminals'
  }
  view = next
  store.set('crew.view', next)
  if (!terms.has(selected)) highlight(terms.keys().next().value)
  $('.collection').classList.toggle('hidden', view !== 'crew')
  $('.tasks-view').classList.toggle('hidden', view !== 'tasks')
  $('.terms-view').classList.toggle('hidden', view !== 'terminals')
  $('.terms').classList.toggle('focus', layout === 'focus')
  segmented($('.seg.views'), (b) => b.dataset.view === view)
  segmented($('[data-layout]'), (b) => b.dataset.layout === layout)
  $('[data-show]').classList.toggle('hidden', layout === 'focus')
  drawShow()
  drawBlank()
  requestAnimationFrame(() => terms.forEach((_, name) => resize(name)))
}
const setLayout = (next) => setView(next)

function drawBlank() {
  const on = state.agents.filter((a) => a.on).length
  $('.blank').classList.toggle('hidden', view !== 'terminals' || on > 0)
  $('.blank b').textContent = state.agents.length ? 'All agents are off' : 'No agents yet'
  $('.blank span').textContent = state.agents.length ? 'Turn one on in the sidebar: it picks up its last session.' : 'Make your first one in the Crew view.'
}

// The grid shows every terminal, or just the busy ones (working, or waiting on you).
const busy = (a) => a && (a.status === 'working' || a.status === 'waiting' || a.status === 'starting')
function drawShow() {
  segmented($('[data-show]'), (b) => b.dataset.show === show)
  let shown = 0
  for (const t of terms.values()) {
    const hide = show === 'busy' && !busy(t.agent)
    t.tile.classList.toggle('filtered', hide)
    if (!hide) shown++
  }
  const none = $('.terms .terms-none')
  if (show === 'busy' && !shown && terms.size) {
    if (!none) $('.terms').insertAdjacentHTML('beforeend', '<p class="terms-none">Nobody is busy right now</p>')
  } else none?.remove()
  $('.tv-count').textContent = layout === 'focus' ? '' : show === 'busy' ? `${shown} of ${plural(terms.size, 'terminal')}` : plural(terms.size, 'terminal')
}

$('.seg.views').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]')
  if (b) setView(b.dataset.view)
})
$('[data-layout]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-layout]')
  if (b?.dataset.layout) setLayout(b.dataset.layout)
})
$('[data-show]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-show]')
  if (!b?.dataset.show) return
  show = b.dataset.show
  store.set('crew.show', show)
  drawShow()
  requestAnimationFrame(() => terms.forEach((_, name) => resize(name)))
})
// ⌘1 Crew, ⌘2 Tasks, ⌘3 the terminals side by side, ⌘4 one big; ⌘F finds an agent, ⌘N makes one
const KEYS = { 1: 'crew', 2: 'tasks', 3: 'grid', 4: 'focus' }
document.querySelectorAll('.seg.views button').forEach((b, i) => (b.title += ` (⌘${i + 1})`))
document.addEventListener('keydown', (e) => {
  if (!e.metaKey || e.ctrlKey) return
  if (KEYS[e.key] && !e.altKey) return void (e.preventDefault(), setView(KEYS[e.key]))
  if (e.code === 'KeyS' && e.altKey) return void (e.preventDefault(), setPanel('side', document.body.classList.contains('no-side')))
  if (e.code === 'KeyC' && e.altKey) return void (e.preventDefault(), setPanel('chat', document.body.classList.contains('no-chat')))
  if (e.key === 'f' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), setPanel('side', true), $('[data-find]').focus(), $('[data-find]').select())
  if (e.key === 'n' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), addAgent())
})

// ---- the roster: every agent, by computer ------------------------------------

function drawRoster() {
  morph($('.roster'), rosterHTML(state, { folds, selected, filter: find }))
  $('[data-find]').placeholder = state.agents.length > 1 ? `Search ${state.agents.length} agents` : 'Search'
  if (dragging) document.querySelector(`.roster .crow[data-agent="${CSS.escape(dragging.name)}"]`)?.classList.add('dragging')
  if (cursor) document.querySelector(`.roster .crow[data-agent="${CSS.escape(cursor)}"]`)?.classList.add('cursor')
}
let cursor = null // the search's marked match, kept across redraws

function toggleFold(key) {
  folds.has(key) ? folds.delete(key) : folds.add(key)
  store.set('crew.folds', JSON.stringify([...folds]))
  drawRoster()
}

const findBox = $('[data-find]')
findBox.addEventListener('input', () => {
  find = findBox.value
  cursor = null
  drawRoster()
})
// ↑↓ move through the matches, Enter opens the one marked (the first, until you move)
findBox.addEventListener('blur', () => {
  cursor = null
  document.querySelector('.roster .crow.cursor')?.classList.remove('cursor')
})
findBox.addEventListener('keydown', (e) => {
  const rows = [...document.querySelectorAll('.roster .crow')]
  const at = rows.findIndex((r) => r.classList.contains('cursor'))
  if (e.key === 'Escape') {
    findBox.value = find = ''
    cursor = null
    drawRoster()
    findBox.blur()
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
    rows.forEach((r) => r.classList.toggle('cursor', r === next))
    cursor = next?.dataset.agent ?? null
    next?.scrollIntoView({ block: 'nearest' })
  }
  if (e.key === 'Enter') {
    const row = rows[Math.max(0, at)]
    if (row) (view === 'crew' ? edit : select)(row.dataset.agent)
  }
})

$('.roster').addEventListener('click', (e) => {
  if (e.target.closest('.mode, .switch')) return
  const fold = e.target.closest('[data-fold]')
  if (fold) return toggleFold(fold.dataset.fold)
  const row = e.target.closest('.crow')
  if (row) (view === 'crew' ? edit : select)(row.dataset.agent)
})
$('.roster').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.crow')
  if (row && !e.target.closest('.mode, .switch') && terms.has(row.dataset.agent)) select(row.dataset.agent)
})

// Right-click an agent (in the roster, a card, a terminal) for everything you can do with it, moving it to
// another computer included.
function agentMenu(name, at) {
  const a = state.agents.find((x) => x.name === name)
  if (!a) return
  const here = a.home ?? ''
  const places = crewGroups(state).filter((g) => g.key !== here)
  popMenu(at, [
    { head: a.seed ?? a.name },
    { label: 'Message', icon: ICONS.reply, act: 'message', disabled: !a.on },
    { label: 'Open terminal', icon: ICONS.terminal, act: 'terminal', disabled: !terms.has(name) },
    { label: 'Edit…', icon: ICONS.edit, act: 'edit' },
    { label: 'New conversation', icon: ICONS.fresh, act: 'fresh', disabled: !a.on || a.freshPending },
    ...(places.length ? ['-', ...places.map((g) => ({ label: `Move to ${g.name}`, icon: g.here ? ICONS.desktop : ICONS.laptop, act: `move:${g.key}`, disabled: !g.online, hint: g.online ? '' : 'offline' }))] : []),
    '-',
    { label: a.on ? 'Turn off' : 'Turn on', icon: ICONS.power, act: 'power' },
    { label: 'Remove…', icon: ICONS.trash, act: 'remove', danger: true },
  ], async (act) => {
    try {
      if (act === 'message') {
        composer.setTarget(name)
        composer.focus()
      }
      if (act === 'terminal') select(name)
      if (act === 'edit') edit(name)
      if (act === 'fresh') await crew.call('freshStart', name)
      if (act.startsWith('move:')) moveSheet(name, act.slice(5))
      if (act === 'power') {
        if (a.on && busy(a) && !confirm(`${a.seed ?? a.name} is in the middle of something. Turn it off anyway?`)) return
        await crew.call('update', name, { off: a.on })
      }
      if (act === 'remove' && confirm(`Remove ${a.seed ?? a.name}? Its session stops (the transcript stays with the CLI).`)) await crew.call('removeAgent', name)
    } catch (err) {
      alert(err.message)
    }
  })
}
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.roster .crow, .pcard[data-name], .tile-head')
  if (!el) return
  e.preventDefault()
  agentMenu(el.dataset.agent ?? el.dataset.name ?? el.closest('.tile').dataset.name, { x: e.clientX, y: e.clientY })
})

// Drag an agent onto another computer to move it there (the move sheet asks where its folder is).
let dragging = null
const roster = $('.roster')
roster.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.crow')
  dragging = row && state.agents.find((a) => a.name === row.dataset.agent)
  if (!dragging) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/x-crew-agent', dragging.name)
  row.classList.add('dragging')
  const online = new Map(crewGroups(state).map((g) => [g.key, g.online]))
  for (const g of roster.querySelectorAll('.cgroup')) g.classList.toggle('drop-ok', g.dataset.home !== (dragging.home ?? '') && online.get(g.dataset.home))
})
roster.addEventListener('dragover', (e) => {
  const g = e.target.closest('.cgroup.drop-ok')
  if (!g || !dragging) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  for (const x of roster.querySelectorAll('.cgroup.over')) x.classList.toggle('over', x === g)
  g.classList.add('over')
})
roster.addEventListener('dragleave', (e) => {
  const g = e.target.closest('.cgroup')
  if (g && !g.contains(e.relatedTarget)) g.classList.remove('over')
})
roster.addEventListener('drop', (e) => {
  const g = e.target.closest('.cgroup.drop-ok')
  if (!g || !dragging) return
  e.preventDefault()
  const name = dragging.name
  endDrag()
  moveSheet(name, g.dataset.home)
})
const endDrag = () => {
  dragging = null
  for (const x of roster.querySelectorAll('.drop-ok, .over, .dragging')) x.classList.remove('drop-ok', 'over', 'dragging')
}
roster.addEventListener('dragend', endDrag)

// The titlebar's counts are shortcuts: "need you" jumps to the first question waiting in the chat (or that
// agent's terminal), "new" to the first reply you haven't read.
$('.tb-left .sums').addEventListener('click', (e) => {
  const kind = e.target.closest('[data-sum]')?.dataset.sum
  if (kind === 'waiting') {
    const ask = state.feed.find((x) => x.kind === 'ask' && !x.answer && state.agents.some((a) => a.name === x.from && a.status === 'waiting'))
    if (ask) return feed.jump(ask.id)
    const a = state.agents.find((x) => x.on && x.status === 'waiting')
    if (a) select(a.name)
  }
  if (kind === 'unread') {
    const first = state.feed.find((x) => isUnread(x, state.reads))
    if (first) feed.jump(first.id)
  }
  if (kind === 'working') setView('terminals'), show !== 'busy' && $('[data-show=busy]').click()
})
$('.autopilot .switch').addEventListener('change', (e) => crew.call('autopilot', e.target.checked))
$('[data-act=config]').addEventListener('click', () => crew.call('config'))
for (const b of document.querySelectorAll('[data-act=add]')) b.addEventListener('click', addAgent)

function addAgent() {
  if (view !== 'crew') setView('crew')
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
    t.agent = a
    morph(t.head, tileHead(a))
    drawRibbon(t)
  }
  if (!terms.has(selected)) selected = on[0]?.name
  drawRoster()
  $('.autopilot .switch').checked = state.autopilot
  $('.autopilot small').textContent = state.autopilot ? 'Hand-offs go through' : 'Hand-offs wait for you'
  morph($('.tb-left .sums'), crewSummary(state, { unread: true }))
  highlight(selected)
  drawShow()
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
  celebrate($('.roster'), state.agents) // after the rows, so a visible one gets the confetti
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
        ${l.online ? `<button class="btn small pc-move" data-move="${esc(a.name)}" title="Run it on another computer, with its conversation, instructions, look and work experience">${ICONS.move}Move to…</button>` : ''}
        <label class="use"><input type="checkbox" class="switch" data-use="${esc(a.name)}" ${a.hidden ? '' : 'checked'}>Use</label>
      </li>`).join('')}</ul>
      ${l.agents.length > 1 ? `<div class="ls-row small"><span>using ${used} of ${l.agents.length} · drag one onto a computer in the sidebar to move it</span><span><button class="btn small" data-use-all="${esc(l.slug)}">All</button> <button class="btn small" data-use-none="${esc(l.slug)}">None</button></span></div>` : ''}`
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
    const move = t.closest('[data-move]')
    if (move) {
      const name = move.dataset.move
      const from = state.agents.find((a) => a.name === name)?.home ?? ''
      const places = crewGroups(state).filter((g) => g.key !== from)
      popMenu(move, [{ head: 'Move to' }, ...places.map((g) => ({ label: g.name, icon: g.here ? ICONS.desktop : ICONS.laptop, act: g.key || ':here', disabled: !g.online, hint: g.here ? 'this Mac' : g.online ? '' : 'offline' }))], (home) => {
        linkDialog.close()
        moveSheet(name, home === ':here' ? '' : home)
      })
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

// ---- moving an agent to another computer ------------------------------------------
// From any computer, to any linked one: drag it onto a computer in the sidebar, pick Move to… on it, or choose
// Runs on in its card. Its conversation and its part of the chat go along; what it had running (servers,
// simulators, builds) can't, and the sheet says so. The folder is a path on the other computer, checked there.

const moveDialog = $('#move')
let moving = null // { name, home, folder, check }

async function moveSheet(name, home) {
  const a = state.agents.find((x) => x.name === name)
  const groups = crewGroups(state)
  const from = groups.find((g) => g.key === (a?.home ?? ''))
  const to = groups.find((g) => g.key === home)
  if (!a || !to || !from || from.key === to.key) return
  moving = { name, home, folder: a.cwd || '~', check: null, seq: 0 }
  const who = esc(a.seed ?? a.name)
  const working = busy(a)
  moveDialog.querySelector('.mv-body').innerHTML = `
    <div class="mv-route" style="--c:${agentColor(a)}">
      <span class="mv-pc">${from.here ? ICONS.desktop : ICONS.laptop}<b>${esc(from.name)}</b></span>
      <span class="mv-path"><i></i><span class="mv-av">${avatarHTML(a, { size: 46 })}</span><i></i></span>
      <span class="mv-pc to">${to.here ? ICONS.desktop : ICONS.laptop}<b>${esc(to.name)}</b></span>
    </div>
    <h3>Move ${who} to ${esc(to.name)}</h3>
    <label class="mv-folder"><span>Folder on ${esc(to.name)}</span>
      <span class="mv-field"><input data-mv-folder value="${esc(moving.folder)}" spellcheck="false" autocomplete="off">${to.here ? '<button class="btn small" data-mv-pick>Choose…</button>' : ''}</span>
      <span class="mv-check" data-mv-check></span>
    </label>
    <div class="mv-sugs" data-mv-sugs></div>
    <ul class="mv-carry">
      <li class="yes">${ICONS.check}<span>Its conversation and its messages in the chat</span></li>
      <li class="yes">${ICONS.check}<span>Instructions, brain, look and work experience</span></li>
      <li class="no">${ICONS.close}<span>Anything it has running on ${esc(from.name)}: servers, simulators, builds</span></li>
    </ul>
    ${working ? `<p class="mv-busy">${who} is ${a.status === 'waiting' ? 'waiting on you' : 'working'} right now. It stops on ${esc(from.name)} and picks the task back up on ${esc(to.name)}.</p>` : ''}
    <p class="err" data-mv-err></p>`
  const go = moveDialog.querySelector('[data-mv-go]')
  go.disabled = false
  go.textContent = `Move to ${to.name}`
  moveDialog.showModal()
  checkFolder()
  crew.call('folders', home, name).then((list) => {
    if (moving?.name !== name) return
    // each one by its folder's name, with who works there (or "same folder as now") beside it
    const short = (f) => (f.label === 'home folder' ? 'Home' : f.path.split('/').filter(Boolean).pop() || f.path)
    moveDialog.querySelector('[data-mv-sugs]').innerHTML = (list ?? []).map((f) => `<button class="mv-sug ${f.path === moving.folder || f.path === moving.check?.path ? 'on' : ''}" data-mv-sug="${esc(f.path)}" title="${esc(f.path)}">${ICONS.folder}<span>${esc(short(f))}</span>${f.label && f.label !== 'home folder' ? `<small>${esc(f.label)}</small>` : ''}</button>`).join('')
  }, () => {})
}

// Is the folder there on that computer? Asked as you type (a little after you stop).
let checkTimer = null
function checkFolder() {
  clearTimeout(checkTimer)
  const box = moveDialog.querySelector('[data-mv-check]')
  if (!moving || !box) return
  const seq = ++moving.seq
  box.className = 'mv-check'
  box.textContent = ''
  checkTimer = setTimeout(async () => {
    try {
      const info = await crew.call('folderInfo', moving.home, moving.folder)
      if (seq !== moving?.seq) return
      moving.check = info
      // a suggestion is the same folder whichever way it's written (~/code/app or /Users/you/code/app)
      for (const b of moveDialog.querySelectorAll('[data-mv-sug]')) b.classList.toggle('on', b.dataset.mvSug === moving.folder || b.dataset.mvSug === info?.path)
      box.className = `mv-check ${info?.exists ? 'ok' : 'bad'}`
      box.innerHTML = info?.exists ? `${ICONS.check}<span>Found${info.path && info.path !== moving.folder ? `: ${esc(info.path)}` : ''}</span>` : `${ICONS.close}<span>Not on that computer${info?.path ? `: ${esc(info.path)}` : ''}</span>`
    } catch {
      box.textContent = ''
    }
  }, 250)
}

moveDialog.addEventListener('input', (e) => {
  if (!('mvFolder' in e.target.dataset)) return
  moving.folder = e.target.value.trim()
  for (const b of moveDialog.querySelectorAll('[data-mv-sug]')) b.classList.toggle('on', b.dataset.mvSug === moving.folder)
  checkFolder()
})
moveDialog.addEventListener('click', async (e) => {
  if (e.target.closest('[data-close]') || e.target === moveDialog) return moveDialog.close()
  const sug = e.target.closest('[data-mv-sug]')
  if (sug) {
    moving.folder = moveDialog.querySelector('[data-mv-folder]').value = sug.dataset.mvSug
    for (const b of moveDialog.querySelectorAll('[data-mv-sug]')) b.classList.toggle('on', b === sug)
    return checkFolder()
  }
  if (e.target.closest('[data-mv-pick]')) {
    const dir = await crew.call('pickFolder', moving.home).catch(() => null)
    if (dir) (moving.folder = moveDialog.querySelector('[data-mv-folder]').value = dir), checkFolder()
    return
  }
  const go = e.target.closest('[data-mv-go]')
  if (!go || !moving) return
  const err = moveDialog.querySelector('[data-mv-err]')
  if (moving.check && !moving.check.exists && !confirm(`${moving.folder} isn't on that computer. Move it anyway? It won't start until the folder exists.`)) return
  go.disabled = true
  go.textContent = 'Moving…'
  err.textContent = ''
  try {
    const res = await crew.call('moveAgent', moving.name, moving.home, moving.folder)
    // where it went is in view: its computer unfolds, and its row is the selected one
    if (folds.delete(`group:${moving.home}`)) store.set('crew.folds', JSON.stringify([...folds]))
    if (res?.name) selected = res.name
    const to = crewGroups(state).find((g) => g.key === moving.home)?.name ?? 'there'
    const who = state.agents.find((a) => a.name === moving.name)?.seed ?? moving.name
    moveDialog.close()
    toast(res?.conversation === 'fresh'
      ? `${who} moved to ${to}. Its conversation couldn't come along (${res.older ? `${to} runs an older Crew` : res.reason ?? 'not found'}), so it starts a new one there.`
      : `${who} moved to ${to}, conversation and all.`, res?.conversation === 'fresh')
  } catch (x) {
    err.textContent = x.message
    go.disabled = false
    go.textContent = 'Try again'
  }
})
moveDialog.addEventListener('close', () => (moving = null))

// A note at the bottom of the window for things that happened out of view.
function toast(text, warn = false) {
  const el = $('.toast')
  el.textContent = text
  el.className = `toast show ${warn ? 'warn' : ''}`
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('show'), warn ? 7000 : 4200)
}

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

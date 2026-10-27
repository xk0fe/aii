// Full-screen view: the crew on the left, Crew / Tasks / Terminals in the middle, the chat on the right.
/* global isUnread, mountWorkspaces, shortPath, burst, wsColor, wsTile, statusClass, rosterParts, mountConvoHead, displayName, contextRing, ctxLevel, mountTasks, crew, live, store, morph, modeMarks, statusText, brainShort, brainLabel, crewGroups, segmented, celebrate, agentColor, markSVG, mountFeed, mountComposer, mountCollection, avatarHTML, esc, plural, popMenu, ICONS, Terminal, FitAddon, needsYou, needText, clonesOf, cloneTag, runningSubs, paceWarning, usageTip, usageLine, resetsText */

const $ = (s) => document.querySelector(s)
const THEME = {
  background: '#0f1012', foreground: '#e4e4e7', cursor: '#e4e4e7', cursorAccent: '#0f1012', selectionBackground: 'rgba(122, 162, 255, 0.3)',
  black: '#1d1f21', red: '#ff6b6b', green: '#4cd38a', yellow: '#ffd166', blue: '#7aa2ff', magenta: '#c58cff', cyan: '#36cfc9', white: '#d4d4d8',
  brightBlack: '#5c5f66', brightRed: '#ff8787', brightGreen: '#69db9a', brightYellow: '#ffe08a', brightBlue: '#9bb8ff', brightMagenta: '#d6a8ff', brightCyan: '#5fe0da', brightWhite: '#fafafa',
}

const terms = new Map() // name -> { tile, head, term, fit, ready }
// The chat: everyone's messages, or your conversation with one agent (its header on top, back to everyone).
const head = mountConvoHead($('.chat .convo-head'), { onBack: () => (composer.setTarget('auto'), composer.focus()), onTerminal: (name) => select(name) })
const feed = mountFeed($('.feed'), {
  onAgent: (name) => select(name),
  onConvo: (name) => (composer.setTarget(name), composer.focus()),
  onLeave: () => composer.setTarget('auto'),
  onTicket: (key) => openTask(key),
  onReply: (e) => composer.replyTo(e),
})
const composer = mountComposer($('.compose'), { dropZone: $('.chat'), onSend: () => feed.toLatest(), onTarget: (to) => (head.set(to), feed.setConvo(to)) })
const collection = mountCollection($('.collection'), { onTerminal: (name) => select(name), onImport: () => importPack(), onMove: (name, home) => moveSheet(name, home) })
const tasks = mountTasks($('.tasks-view'), { onTerminal: (name) => select(name) })
const workspaces = mountWorkspaces({ button: $('.ws-switch'), banner: $('.ws-banner'), dock: $('.ws-dock'), dialog: $('#ws'), onSwitch: (id, opts) => switchTo(id, opts), onSwitched: (next) => switched(next) })
// Views: Crew, Tasks and Terminals, the terminals laid out as a grid or one big one. Older saves said grid,
// focus or bugs.
const saved = store.get('crew.view')
let view = saved === 'bugs' ? 'tasks' : saved === 'grid' || saved === 'focus' ? 'terminals' : ['crew', 'tasks', 'terminals'].includes(saved) ? saved : 'crew'
let layout = saved === 'focus' || (saved !== 'grid' && store.get('crew.layout') === 'focus') ? 'focus' : 'grid'
let show = ['busy', 'needs'].includes(store.get('crew.show')) ? store.get('crew.show') : 'all' // the grid: every terminal, the busy ones, or the ones waiting on you
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

$('.blank .blank-mark').outerHTML = ICONS.mark
const VIEW_LABEL = { crew: [markSVG('0 4 24 18'), 'Crew'], tasks: [ICONS.task, 'Tasks'], terminals: [ICONS.terminal, 'Terminals'] }
for (const b of document.querySelectorAll('.seg.views button')) b.innerHTML = `${VIEW_LABEL[b.dataset.view][0]}<span>${VIEW_LABEL[b.dataset.view][1]}</span>${b.dataset.view === 'tasks' ? '<i class="seg-badge"></i>' : ''}`
$('[data-layout=grid]').innerHTML = ICONS.grid
$('[data-layout=focus]').innerHTML = ICONS.focus
$('.find-icon').outerHTML = ICONS.search
$('.side-top [data-act=add]').innerHTML = ICONS.plus
$('.side .autopilot .glyph').innerHTML = ICONS.plane
$('.tb-more').innerHTML = ICONS.more
$('#link .h-icon').innerHTML = ICONS.computers
$('#link [data-link-add]').innerHTML = `${ICONS.link}Link a computer…`
$('#import .h-icon').innerHTML = ICONS.import

// The sidebar and the chat can each be put away for more room in the middle (the ⋯ menu, ⌘⌥S, ⌘⌥C); remembered
// across launches.
function setPanel(which, on) {
  document.body.classList.toggle(`no-${which}`, !on)
  store.set(`crew.panel.${which}`, on ? '1' : '0')
  setTimeout(() => terms.forEach((_, name) => resize(name)), 340)
}
const panelShown = (which) => !document.body.classList.contains(`no-${which}`)
for (const which of ['side', 'chat']) setPanel(which, store.get(`crew.panel.${which}`) !== '0')

// ---- the titlebar's right end: who needs you, and ⋯ for the rest ------------------------------------------

// Their faces and how many. A click brings the chat's queue into view (the chat listens for crew:needs).
function drawNeedsButton() {
  const list = needsYou(state)
  const btn = $('.tb-needs')
  // replies you haven't read: a dot on ⋯, whose menu jumps to the first one
  $('.tb-more').classList.toggle('has-new', state.feed.some((x) => isUnread(x, state.reads)))
  btn.classList.toggle('hidden', !list.length)
  if (!list.length) return
  const n = list.length
  const faces = [...new Map(list.map((x) => [x.agent.name, x.agent])).values()] // an agent with two questions is one face
  btn.title = `${list.map((x) => `${displayName(x.agent)}: ${needText(x)}`).join('\n')}\n\nClick to answer, oldest first`
  morph(btn, `<span class="tb-faces">${faces.slice(0, 3).map((a) => avatarHTML(a, { size: 20 })).join('')}</span>${n} need${n === 1 ? 's' : ''} you`)
}
function showNeeds(name) {
  if (!panelShown('chat')) setPanel('chat', true)
  document.dispatchEvent(new CustomEvent('crew:needs', name ? { detail: { name } } : undefined))
}
$('.tb-needs').addEventListener('click', () => showNeeds())

// Everything the titlebar used to carry: the panels, Computers, the theme and config.json.
const THEME_CHOICES = [['system', 'Auto', 'auto', 'follows macOS'], ['light', 'Light', 'sun', ''], ['dark', 'Dark', 'moon', '']]
$('.tb-more').addEventListener('click', (e) => {
  const theme = state.theme ?? 'system'
  const unread = state.feed.filter((x) => isUnread(x, state.reads))
  popMenu(e.currentTarget, [
    ...(unread.length ? [{ label: `Jump to ${unread.length} new ${unread.length === 1 ? 'reply' : 'replies'}`, icon: ICONS.reply, act: 'unread' }, '-'] : []),
    { label: panelShown('side') ? 'Hide the crew' : 'Show the crew', icon: ICONS.sidebar, act: 'side', hint: '⌥⌘S' },
    { label: panelShown('chat') ? 'Hide the chat' : 'Show the chat', icon: ICONS.chatPanel, act: 'chat', hint: '⌥⌘C' },
    '-',
    { label: 'Computers…', icon: ICONS.computers, act: 'computers' },
    '-',
    { head: 'Theme' },
    ...THEME_CHOICES.map(([id, label, icon, note]) => ({ label, icon: ICONS[icon], act: `theme:${id}`, hint: theme === id ? '✓' : note })),
    '-',
    { label: 'Open config.json', icon: ICONS.braces, act: 'config' },
  ], (act) => {
    if (act === 'unread') {
      setPanel('chat', true)
      if (unread[0]) feed.jump(unread[0].id)
    }
    if (act === 'side' || act === 'chat') setPanel(act, !panelShown(act))
    if (act === 'computers') openComputers()
    if (act.startsWith('theme:')) crew.call('theme', act.slice(6))
    if (act === 'config') crew.call('config')
  })
})

// ---- terminals -------------------------------------------------------------

// `before`: the tile it goes in front of, so a new clone's terminal lands right after its original's.
function createTile(name, before = null) {
  const tile = document.createElement('div')
  tile.className = 'tile'
  tile.dataset.name = name
  tile.innerHTML = '<div class="tile-head"></div><div class="tile-acts"></div><div class="term"></div>'
  $('.terms').insertBefore(tile, before)
  drawShow()

  const term = new Terminal({ theme: THEME, fontFamily: '"SF Mono", Menlo, monospace', fontSize: 12, lineHeight: 1.12, cursorBlink: true, macOptionIsMeta: true, scrollback: 5000 })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit)
  term.open(tile.querySelector('.term'))
  quietSelection(term)
  // Shift+Enter = newline in Claude Code, same as /terminal-setup configures.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || e.key !== 'Enter' || !e.shiftKey) return true
    crew.input(name, '\x1b\r')
    return false
  })
  term.onData((data) => crew.input(name, data))

  const t = { tile, head: tile.querySelector('.tile-head'), acts: tile.querySelector('.tile-acts'), term, fit, ready: false, replaying: false }
  terms.set(name, t)
  let timer
  new ResizeObserver(() => {
    clearTimeout(timer)
    timer = setTimeout(() => resize(name), 40)
  }).observe(tile.querySelector('.term'))
  replay(t)
  return t
}

// xterm redraws a terminal's selection every time its output scrolls a line, and its DOM renderer does that by
// re-rendering every row, even with nothing selected and even for a terminal that's out of view (which otherwise
// waits to be shown). With no selection before or after, that redraw changes nothing: skip it. (xterm internals,
// so only if they're there.)
function quietSelection(term) {
  const render = term._core?._renderService
  if (typeof render?.handleSelectionChanged !== 'function') return
  const redraw = render.handleSelectionChanged.bind(render)
  let selected = false
  render.handleSelectionChanged = (start, end, columnSelectMode) => {
    const now = Boolean(start && end)
    if (!now && !selected) return
    selected = now
    redraw(start, end, columnSelectMode)
  }
}

// Replay what the agent already printed at the size it was drawn, then fit (the agent redraws on resize).
// Live chunks that arrive before this are already in the buffer. Again after an agent's computer comes back.
function replay(t) {
  const name = t.tile.dataset.name
  const done = () => {
    t.ready = true
    t.replaying = false
    drawTile(t)
  }
  t.ready = false
  t.replaying = true
  drawTile(t)
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
  drawTile(t)
}

// The badge in each terminal's header says what you're looking at. These aren't terminal apps: Crew runs the
// agent's CLI in a pseudo-terminal and draws its output with xterm.js, replaying what it printed before the view
// opened. So it says whether that's live (typing goes straight to the agent), streamed from another computer, still
// being redrawn, or frozen (its computer is unreachable, or the process exited); its tooltip says it in full.
// [badge, line, explanation] for each.
const RIBBON = {
  live: (a, n) => ['Live', `Crew's view of ${n}'s terminal · earlier output replayed`,
    `This isn't a terminal app. Crew runs ${n}'s CLI in a pseudo-terminal and draws its output here; what you type goes straight to ${n}. Output from before this view opened (up to 256 KB) is replayed, so older lines can look off until ${n} redraws.`],
  mirror: (a, n) => ['Mirror', `Streamed from ${a.homeName} · earlier output replayed`,
    `${n} runs on ${a.homeName}. Its terminal output streams here over Crew Link and what you type goes back to it. Output from before this view opened is replayed, so older lines can look off until it redraws.`],
  replay: (a, n) => ['Replay', `Redrawing ${n}'s recent output…`, 'Crew is replaying what the agent printed before this view opened. Live output follows.'],
  offline: (a) => ['Offline', `${a.homeName ?? 'Its computer'} is unreachable · showing the last output`,
    `Not live: ${a.homeName ?? 'the computer it runs on'} can't be reached, so this is the last output it sent. It reconnects on its own.`],
  ended: (a, n) => ['Ended', 'The process exited · showing its last output', `Not live: ${n}'s CLI exited. Restart it from the header to pick its session back up.`],
}

const tileMode = (t) => (t.replaying ? 'replay' : t.agent.status === 'away' ? 'offline' : t.agent.status === 'stopped' ? 'ended' : t.agent.home ? 'mirror' : 'live')

// The tile's mode (frozen ones look frozen), whether it waits on you, its header and its actions. One that's off
// screen is left stale, and freshen() draws it when it comes into view.
function drawTile(t) {
  const a = t.agent
  if (!a) return
  t.tile.dataset.mode = tileMode(t)
  t.tile.classList.toggle('needs', a.status === 'waiting')
  if (!tileShown(t)) return void (t.stale = true)
  t.stale = false
  morph(t.head, tileHead(t))
  morph(t.acts, tileActs(a))
}

crew.onPty((name, data) => {
  const t = terms.get(name)
  if (t?.ready) t.term.write(data)
})

// The brain in one word: its model when it has one (opus, sonnet), its provider otherwise (Codex).
const modelWord = (a) => a.model || (state.providers?.[a.provider]?.label ?? a.provider ?? '')
// Its name, a clone with its number, and an agent on another computer with that computer: "scarlett · Mac mini".
const tileName = (a) => `${esc(a.cloneOf ? a.cloneOf.split('@')[0] : a.home ? a.seed ?? a.name : a.name)}${cloneTag(a)}${a.home ? `<span class="t-home"> · ${esc(a.homeName ?? a.home)}</span>` : ''}`

// Who helps it right now: its clones at work (their faces), or else its sub-agents. A clone's own tile has no clones.
function tileHelpers(a) {
  const clones = clonesOf(state.agents, a).filter((c) => c.on)
  if (clones.length) return `<span class="t-chip clones" title="${esc(`${plural(clones.length, 'clone')} at work: ${clones.map(displayName).join(', ')}`)}">${clones.slice(0, 3).map((c) => avatarHTML(c, { size: 16, mood: 'still' })).join('')}${clones.length}</span>`
  const subs = runningSubs(a)
  return subs.length ? `<span class="t-chip" title="${esc(`${plural(subs.length, 'sub-agent')} working:\n${subs.map((s) => `${s.type === 'general-purpose' ? 'general' : s.type || 'agent'}${s.description ? `: ${s.description}` : ''}`).join('\n')}`)}">${ICONS.subs}${subs.length}</span>` : ''
}

// One row: who (and its YOLO and ⚡ marks), how it is in words, its model; then the context ring once it runs hot, its
// helpers and the badge, which carries what the ribbon used to say. Waiting on you, an Answer button. The model word
// sits in a one-line wrapping box: without room it wraps out of sight whole (the badge's tooltip has it too).
function tileHead(t) {
  const a = t.agent
  const mode = tileMode(t)
  const [badge, line, tip] = RIBBON[mode](a, displayName(a))
  const size = t.term.cols && t.ready ? `${t.term.cols}×${t.term.rows}` : ''
  const busyNow = a.status === 'working' || a.status === 'waiting'
  const stateTip = [a.activity, a.queue ? `${a.queue} queued` : '', a.freshPending ? 'New conversation when it finishes this task' : '', busyNow ? 'Stuck? Click to mark it free' : ''].filter(Boolean).join('\n')
  const badgeTip = [line, tip, [brainShort(a, state.providers), size].filter(Boolean).join(' · ')].filter(Boolean).join('\n\n')
  return `<span class="tile-av">${avatarHTML(a, { size: 24 })}</span><b class="t-name">${tileName(a)}</b>${modeMarks(a)}
    <span class="t-mid"><span class="t-state ${statusClass(a)}" ${busyNow ? 'data-act="markIdle"' : ''} title="${esc(stateTip)}">${esc(statusText(a))}</span><span class="t-model" title="${esc(brainLabel(a, state.providers))}">${esc(modelWord(a))}</span></span>
    ${ctxLevel(a.convo?.context?.pct ?? 0) === 'hot' ? contextRing(a) : ''}${tileHelpers(a)}
    <span class="t-badge" data-mode="${mode}" title="${esc(badgeTip)}">${badge}</span>
    ${a.status === 'waiting' ? `<button class="t-answer" data-act="answer" title="${esc(needsYou(state).find((x) => x.agent.name === a.name)?.ask ? 'Answer it in the chat' : 'It asks in its terminal: answer there')}">Answer</button>` : ''}`
}

// The four actions, floating over the terminal's corner.
const tileActs = (a) => `
  <button class="icon" data-act="fresh" aria-pressed="${Boolean(a.freshPending)}" title="${a.freshPending ? 'Starts a new conversation when it finishes this task' : 'New conversation: a clean slate for its next task (the old one stays in its history)'}">${ICONS.fresh}</button>
  <button class="icon" data-act="edit" title="${a.cloneOf ? `Edit ${esc(a.cloneOf)} (its clones follow)` : 'Edit agent'}">${ICONS.edit}</button>
  <button class="icon" data-act="restart" title="Restart (resumes the session)">${ICONS.restart}</button>
  ${a.cloneOf
    ? `<button class="icon" data-act="dismiss" title="Send this clone away: its terminal closes, and anything queued for it goes back to ${esc(a.cloneOf)}">${ICONS.close}</button>`
    : `<button class="icon" data-act="off" title="Turn off (stays off after restarts)">${ICONS.power}</button>`}`

// Answer: its question in the chat's queue when it asked there, otherwise its terminal, where it's asking.
function answerTile(name) {
  if (needsYou(state).find((x) => x.agent.name === name)?.ask) return showNeeds(name)
  highlight(name)
  terms.get(name)?.term.focus()
}

$('.terms').addEventListener('click', (e) => {
  const tile = e.target.closest('.tile')
  if (!tile) return
  const name = tile.dataset.name
  const act = e.target.closest('[data-act]')?.dataset.act
  if (act === 'answer') answerTile(name)
  else if (act === 'restart') {
    terms.get(name).term.reset()
    crew.call('restart', name)
  } else if (act === 'fresh') crew.call('freshStart', name).catch((err) => alert(err.message))
  else if (act === 'off') crew.call('update', name, { off: true })
  else if (act === 'dismiss') {
    const a = terms.get(name)?.agent
    if (a && (a.status === 'working' || a.status === 'waiting') && !confirm(`${displayName(a)} is in the middle of something. Send it away anyway?`)) return
    crew.call('dismiss', name).catch((err) => alert(err.message))
  }
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
  for (const el of $('.roster').querySelectorAll('.crow, .clone-line')) el.classList.toggle('on', el.dataset.agent === name)
  freshen() // in Focus, the one picked is the one on screen
}

// A terminal's header and actions are drawn while it's on screen: in the Terminals view, not filtered out of the grid,
// and in Focus only the one picked. The rest catch up as they come into view, so a state push doesn't redraw
// twenty headers nobody can see.
const tileShown = (t) => view === 'terminals' && !t.tile.classList.contains('filtered') && (layout === 'grid' || t.tile.classList.contains('on'))
function freshen() {
  for (const t of terms.values()) if (t.stale && t.agent && tileShown(t)) drawTile(t)
}

// Show an agent's terminal, with your conversation with it in the chat. Agents that are off have no terminal:
// open their card.
function select(name) {
  if (!terms.has(name) && !state.agents.some((a) => a.name === name)) name = name.replace(/\.\d+(?=@|$)/, '') // a clone that has gone: its original
  if (!terms.has(name)) return edit(name)
  highlight(name)
  composer.setTarget(name)
  layout = 'focus'
  store.set('crew.layout', layout)
  setView('terminals')
  terms.get(name).term.focus()
}

// A click in the sidebar: the agent whose terminal and conversation are already up, clicked again, lets go of it.
// The chat goes back to everyone's and Focus to the grid. The second click of a double-click doesn't count.
function pick(name, e) {
  if (e.detail > 1) return
  if (view !== 'terminals' || selected !== name || composer.target() !== name) return select(name)
  composer.setTarget('auto')
  if (layout === 'focus') setLayout('grid')
}

function edit(name) {
  if (view !== 'crew') setView('crew')
  collection.open(state.agents.find((a) => a.name === name)?.cloneOf ?? name) // a clone is edited through its original
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
  // views that are hidden skip their redraws: the one coming into view catches up first, still hidden
  collection.setVisible(view === 'crew')
  tasks.setVisible(view === 'tasks')
  $('.collection').classList.toggle('hidden', view !== 'crew')
  $('.tasks-view').classList.toggle('hidden', view !== 'tasks')
  $('.terms-view').classList.toggle('hidden', view !== 'terminals')
  $('.terms').classList.toggle('focus', layout === 'focus')
  segmented($('.seg.views'), (b) => b.dataset.view === view)
  segmented($('[data-layout]'), (b) => b.dataset.layout === layout)
  $('[data-show]').classList.toggle('idle', layout === 'focus') // stays in place, so nothing moves
  drawShow()
  drawBlank()
  requestAnimationFrame(() => terms.forEach((_, name) => resize(name)))
}
const setLayout = (next) => setView(next)

function drawBlank() {
  const on = state.agents.filter((a) => a.on && a.status !== 'parked').length
  $('.blank').classList.toggle('hidden', view !== 'terminals' || on > 0)
  const parked = state.parked && state.agents.some((a) => a.on)
  $('.blank b').textContent = parked ? `${state.workspace.name} is parked` : state.agents.length ? 'All agents are off' : 'No agents yet'
  $('.blank span').textContent = parked ? 'Open it to start its agents: each picks up its conversation.' : state.agents.length ? 'Turn one on in the sidebar: it picks up its last session.' : 'Make your first one in the Crew view.'
}

// The grid shows every terminal, the busy ones (working, starting or waiting on you), or the ones waiting on you; each
// with how many there are.
const busy = (a) => a && (a.status === 'working' || a.status === 'waiting' || a.status === 'starting')
const SHOW_NONE = { busy: 'Nobody is busy right now', needs: 'Nobody needs you right now' }
function drawShow() {
  segmented($('[data-show]'), (b) => b.dataset.show === show)
  const waiting = new Set(needsYou(state).map((x) => x.agent.name))
  const count = { all: terms.size, busy: 0, needs: 0 }
  let shown = 0
  for (const [name, t] of terms) {
    const isBusy = busy(t.agent)
    const needs = waiting.has(name)
    count.busy += isBusy ? 1 : 0
    count.needs += needs ? 1 : 0
    const hide = layout === 'grid' && (show === 'busy' ? !isBusy : show === 'needs' ? !needs : false) // focus shows the one you picked
    t.tile.classList.toggle('filtered', hide)
    if (!hide) shown++
  }
  for (const b of $('[data-show]').children) {
    const i = b.querySelector('i')
    if (i.textContent !== String(count[b.dataset.show])) i.textContent = count[b.dataset.show]
    i.classList.toggle('some', count[b.dataset.show] > 0)
  }
  freshen()
  const none = $('.terms .terms-none')
  if (SHOW_NONE[show] && !shown && terms.size) {
    if (!none) $('.terms').insertAdjacentHTML('beforeend', `<p class="terms-none">${SHOW_NONE[show]}</p>`)
    else if (none.textContent !== SHOW_NONE[show]) none.textContent = SHOW_NONE[show]
  } else none?.remove()
}

$('.seg.views').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]')
  if (b) setView(b.dataset.view)
})
$('[data-layout]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-layout]')
  if (b?.dataset.layout) setLayout(b.dataset.layout)
})
// In Focus, picking a filter goes back to the grid with it.
$('[data-show]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-show]')
  if (!b?.dataset.show) return
  show = b.dataset.show
  store.set('crew.show', show)
  if (layout === 'focus') return setLayout('grid')
  drawShow()
  requestAnimationFrame(() => terms.forEach((_, name) => resize(name)))
})
// ⌘1 Crew, ⌘2 Tasks, ⌘3 the terminals side by side, ⌘4 one big; ⌘F finds an agent, ⌘N makes one
const KEYS = { 1: 'crew', 2: 'tasks', 3: 'grid', 4: 'focus' }
document.querySelectorAll('.seg.views button').forEach((b, i) => (b.title += ` (⌘${i + 1})`))
document.addEventListener('keydown', (e) => {
  if (!e.metaKey || e.ctrlKey) return
  if (document.querySelector('.ed-layer.open, dialog[open]')) return // the agent's sheet or a dialog is in front
  if (KEYS[e.key] && !e.altKey) return void (e.preventDefault(), setView(KEYS[e.key]))
  if (e.code === 'KeyS' && e.altKey) return void (e.preventDefault(), setPanel('side', document.body.classList.contains('no-side')))
  if (e.code === 'KeyC' && e.altKey) return void (e.preventDefault(), setPanel('chat', document.body.classList.contains('no-chat')))
  if (e.key === 'f' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), setPanel('side', true), $('[data-find]').focus(), $('[data-find]').select())
  if (e.key === 'n' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), addAgent())
})

// ⌃1–9: the workspaces, in the switcher's order (a parked one opens). ⌃Tab and ⌃⇧Tab: the next and previous open one.
// Ahead of the terminals (capture), which would take ⌃1 as a key of their own.
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.ed-layer.open, dialog[open]')) return
  const list = state.workspaces ?? []
  if (list.length < 2) return // nothing to switch to: ⌃1 stays the terminal's
  if (e.key === 'Tab') {
    const open = list.filter((w) => !w.parked || w.current)
    const at = open.findIndex((w) => w.current)
    const next = open[(at + (e.shiftKey ? -1 : 1) + open.length) % open.length]
    if (!next || next.current) return
    e.preventDefault()
    e.stopPropagation()
    return switchTo(next.id)
  }
  const w = /^[1-9]$/.test(e.key) && list[Number(e.key) - 1]
  if (!w) return
  e.preventDefault()
  e.stopPropagation()
  switchTo(w.id, { open: w.parked })
}, true)

// ---- workspaces: switching, with the crew sliding over to the next one ----------------------------

// The new workspace renders inside a view transition, from the state the switch answers with; the side it slides in
// from is where it sits in the switcher. A parked one is opened first when asked.
let push = null
async function switchTo(id, { open = false } = {}) {
  const list = state.workspaces ?? []
  const from = list.findIndex((w) => w.current)
  const to = list.findIndex((w) => w.id === id)
  if (to < 0 || (to === from && !open)) return
  const unsaved = collection.unsaved()
  if (unsaved && !confirm(`Discard your changes to ${unsaved}?`)) return
  const go = async () => {
    try {
      if (open) await crew.call('workspace', 'open', id)
      const { state: next } = await crew.call('workspace', 'switch', id)
      ;(push ??= await ready)(next)
    } catch (err) {
      alert(err.message)
    }
  }
  slide(to < from ? -1 : 1, go)
}
// A workspace the sheet just made: already on screen in Crew, now here too.
function switched(next) {
  slide(1, async () => (push ??= await ready)(next))
  setTimeout(() => burst($('.ws-switch .ws-tile'), { count: 9, color: wsColor(next.workspace) ?? undefined }), 520)
}
let sliding = 0 // transitions under way: a second switch mid-slide mustn't drop the first one's class from under it
function slide(dir, update) {
  const html = document.documentElement
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  html.style.setProperty('--ws-dir', dir)
  html.classList.add('ws-switching')
  sliding++
  document.startViewTransition(update).finished.finally(() => --sliding || html.classList.remove('ws-switching'))
}

// What's on screen belongs to one workspace: switching closes what was open in the last one, and its terminals go
// (a shared agent has a terminal in each workspace it's in, under the same name).
let shownWorkspace = null
function workspaceChanged(next) {
  const id = next.workspace?.id ?? 'default'
  if (shownWorkspace === id) return
  const first = shownWorkspace === null
  shownWorkspace = id
  if (first) return
  for (const t of terms.values()) {
    t.term.dispose()
    t.tile.remove()
  }
  terms.clear()
  selected = null
  composer.stopReply() // the message it answered is in the other workspace's chat
  composer.setTarget('auto')
  const unsaved = collection.unsaved() // switched from the menu bar or a notification, with an agent's sheet open
  collection.close()
  if (unsaved) toast(`Closed ${unsaved} without saving: you switched to ${next.workspace.name}`, true)
  tasks.close()
}

// ---- the roster: every agent, by computer ------------------------------------

// Not while you're dragging a row: a redraw would drop the drop targets (and could replace the row you hold).
let rosterStale = false
function drawRoster() {
  if (dragging) return void (rosterStale = true)
  rosterStale = false
  morph($('.roster'), rosterParts(state, { folds, selected, filter: find, drag: true }))
  const count = state.agents.filter((a) => !a.cloneOf).length
  $('[data-find]').placeholder = count > 1 ? `Search ${count} agents` : 'Search'
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
    if (!row) return
    findBox.blur()
    ;(view === 'crew' ? edit : select)(row.dataset.agent)
  }
})

$('.roster').addEventListener('click', (e) => {
  if (e.target.closest('.mode, .switch')) return
  const fold = e.target.closest('[data-fold]')
  if (fold) return toggleFold(fold.dataset.fold)
  const clone = e.target.closest('[data-clone]')
  if (clone) return pick(clone.dataset.clone, e)
  const row = e.target.closest('.crow')
  if (row) view === 'crew' ? edit(row.dataset.agent) : pick(row.dataset.agent, e)
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
  // a clone: talk to it, watch it, or send it away (it's edited and moved through its agent)
  if (a.cloneOf) {
    return popMenu(at, [
      { head: displayName(a) },
      { label: 'Message', icon: ICONS.reply, act: 'message' },
      { label: 'Open terminal', icon: ICONS.terminal, act: 'terminal', disabled: !terms.has(name) },
      { label: `Edit ${a.cloneOf.split('@')[0]}…`, icon: ICONS.edit, act: 'edit' },
      '-',
      { label: 'Send it away', icon: ICONS.close, act: 'dismiss', danger: true },
    ], (act) => {
      if (act === 'message') (setPanel('chat', true), composer.setTarget(name), composer.focus())
      if (act === 'terminal') select(name)
      if (act === 'edit') edit(name)
      if (act === 'dismiss' && (!busy(a) || confirm(`${displayName(a)} is in the middle of something. Send it away anyway?`))) crew.call('dismiss', name).catch((err) => alert(err.message))
    })
  }
  const here = a.home ?? ''
  const places = crewGroups(state).filter((g) => g.key !== here)
  // in the default workspace, a shared agent can join the others; in another one, a shared agent only leaves it
  const ws = state.workspace
  const named = ws && ws.id !== 'default'
  const joins = !named && !a.home ? (state.workspaces ?? []).filter((w) => w.id !== 'default' && !w.members?.some((m) => m.name === name)) : []
  const leave = named && a.shared
  popMenu(at, [
    { head: a.seed ?? a.name },
    { label: 'Message', icon: ICONS.reply, act: 'message', disabled: !a.on },
    { label: 'Open terminal', icon: ICONS.terminal, act: 'terminal', disabled: !terms.has(name) },
    { label: 'Edit…', icon: ICONS.edit, act: 'edit' },
    { label: 'New conversation', icon: ICONS.fresh, act: 'fresh', disabled: !a.on || a.freshPending },
    ...(places.length ? ['-', ...places.map((g) => ({ label: `Move to ${g.name}`, icon: g.here ? ICONS.desktop : ICONS.laptop, act: `move:${g.key}`, disabled: !g.online, hint: g.online ? '' : 'offline' }))] : []),
    ...(joins.length ? ['-', ...joins.map((w) => ({ label: `Add to ${w.name}`, icon: wsTile(w, { size: 16 }), act: `join:${w.id}`, hint: w.parked ? 'parked' : '' }))] : []),
    '-',
    { label: a.on ? 'Turn off' : 'Turn on', icon: ICONS.power, act: 'power' },
    { label: leave ? `Take out of ${ws.name}…` : 'Remove…', icon: ICONS.trash, act: 'remove', danger: true },
  ], async (act) => {
    try {
      if (act === 'message') {
        setPanel('chat', true)
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
      if (act.startsWith('join:')) {
        const w = state.workspaces.find((x) => x.id === act.slice(5))
        await crew.call('workspace', 'members', w.id, { add: [name] })
        toast(`${name} joins ${w.name}${w.folder ? `, working in ${shortPath(w.folder)}` : ''}`)
      }
      const sure = act === 'remove' && confirm(leave
        ? `Take ${name} out of ${ws.name}? It stops working here, and starts a fresh conversation if it comes back. It stays in your crew and your other workspaces.`
        : named ? `Remove ${name}? It's only in ${ws.name}, so it's gone for good. Its session stops (the transcript stays with the CLI).` : `Remove ${a.seed ?? a.name}? Its session stops (the transcript stays with the CLI).${(state.workspaces ?? []).length > 1 ? ' It leaves every workspace it\'s in.' : ''}`)
      if (sure) await crew.call('removeAgent', name)
    } catch (err) {
      alert(err.message)
    }
  })
}
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.roster .crow, .roster .clone-line, .pcard[data-name], .tile-head')
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
  if (!dragging) return
  dragging = null
  for (const x of roster.querySelectorAll('.drop-ok, .over, .dragging')) x.classList.remove('drop-ok', 'over', 'dragging')
  if (rosterStale) drawRoster()
}
// on the document too: the row you started from may be gone by the time you let go
document.addEventListener('dragend', endDrag)
document.addEventListener('drop', endDrag)

$('.autopilot .switch').addEventListener('change', (e) => crew.call('autopilot', e.target.checked))
for (const b of document.querySelectorAll('[data-act=add]')) b.addEventListener('click', addAgent)

// ---- the sidebar's footer: Autopilot, then the computers and the account's usage as two quiet chips --------------

function drawFoot(state) {
  const pilot = $('.side .autopilot')
  pilot.querySelector('.switch').checked = state.autopilot
  pilot.title = `${state.autopilot ? 'Hand-offs go through' : 'Hand-offs wait for you'}\nOn: agents hand work to each other without asking. Off: each hand-off waits in the chat for your Send it.`
  // Computers: how many, or This Mac; a hollow dot when a linked one can't be reached
  const c = state.computers ?? { me: {}, links: [] }
  const away = c.links.filter((l) => !l.online)
  const chip = $('.link-chip')
  const label = `${ICONS.computers}<span>${c.links.length ? `${c.links.length + 1} computers` : 'This Mac'}</span>${away.length ? '<i class="pc-off"></i>' : ''}`
  if (chip.label !== label) chip.innerHTML = chip.label = label // asked on every push, replaced only when it changes
  chip.title = c.links.length
    ? `Computers: this Mac and ${c.links.map((l) => `${l.name} (${l.online ? 'online' : 'offline'})`).join(', ')}`
    : `Computers: link your other Macs into one crew${c.me.sharing ? '. This Mac lets others link to it' : ''}`
  // Usage: the account closest to its limit, its fullest window as a little gauge. Amber only when it will run out
  // before it resets, at this pace.
  const accounts = Object.values(state.usage ?? {}).filter((u) => u.windows?.length)
  const use = $('.use-chip')
  use.classList.toggle('hidden', !accounts.length)
  if (!accounts.length) return
  const fullest = (u) => Math.max(...u.windows.map((w) => w.pct))
  const top = accounts.find((u) => paceWarning(u)) ?? [...accounts].sort((x, y) => fullest(y) - fullest(x))[0]
  const pct = fullest(top)
  const warn = paceWarning(top)
  use.classList.toggle('warm', Boolean(warn))
  use.title = `${accounts.map(usageTip).join('\n\n')}${warn ? `\n\n${top.label}: ${warn}` : ''}`
  morph(use, `<i class="use-gauge"><i style="width:${Math.min(100, Math.max(pct, 3))}%"></i></i><span>${esc(top.label)} ${pct}%</span>`)
  if (usePop.matches(':popover-open')) drawUsePop()
}

// A click on the usage chip: every account's limits, one line each, and when one runs out at this pace.
const usePop = $('.use-pop')
function drawUsePop() {
  morph(usePop, Object.entries(state.usage ?? {}).filter(([, u]) => u.windows?.length).map(([provider, u]) => {
    const warn = paceWarning(u)
    return `<div class="up-row">${usageLine({ provider }, state)}<small class="${warn ? 'warn' : ''}">${esc(warn || u.windows.map((w) => `${w.pct}% ${resetsText(w.resetsAt)}`).join(' · '))}</small></div>`
  }).join(''))
}
// The chip is its invoker (popovertarget), so a second click closes it and a click anywhere else does too.
usePop.addEventListener('beforetoggle', (e) => {
  if (e.newState !== 'open') return
  drawUsePop()
  const r = $('.use-chip').getBoundingClientRect()
  usePop.style.left = `${Math.round(r.left)}px`
  usePop.style.bottom = `${Math.round(innerHeight - r.top + 6)}px`
})

function addAgent() {
  if (view !== 'crew') setView('crew')
  collection.create()
}

function handleFocus(arg) {
  if (arg === ':add') addAgent()
  else if (arg === ':workspace') workspaces.create()
  else if (arg === ':workspace-settings') workspaces.settings()
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
  workspaceChanged(next)
  state = next
  workspaces.render(state)
  drawComputers(state)
  drawFoot(state)
  // Terminals only for agents that are on (and not parked); the sidebar lists everyone so off agents are one click from
  // coming back.
  const on = state.agents.filter((a) => a.on && a.status !== 'parked')
  const names = new Set(on.map((a) => a.name))
  for (const [name, t] of terms) {
    if (names.has(name)) continue
    t.term.dispose()
    t.tile.remove()
    terms.delete(name)
  }
  on.forEach((a, i) => {
    const next = on.slice(i + 1).find((x) => terms.has(x.name))
    const t = terms.get(a.name) ?? createTile(a.name, next ? terms.get(next.name).tile : null)
    // back from being unreachable, or a new conversation: show the terminal as it is now
    const convo = a.convo?.since
    if ((t.away && a.status !== 'away') || (t.convo && convo && convo !== t.convo)) replay(t)
    t.away = a.status === 'away'
    t.convo = convo
    t.tile.style.setProperty('--c', agentColor(a))
    t.agent = a
    t.stale = true // drawn by freshen() below, if it's on screen
  })
  if (!terms.has(selected)) selected = on[0]?.name
  drawRoster()
  drawNeedsButton()
  highlight(selected)
  drawShow() // and the terminals now on screen catch up (freshen)
  drawBlank()
  head.render(state)
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
// what's unfolded: this Mac's addresses, each linked computer's agents, the paste-a-code form; and "Copied" for a moment
const linkOpen = { details: false, computers: new Set(), form: false, copied: false }
let copiedTimer = null

function drawComputers(state) {
  const c = state.computers ?? { me: {}, links: [] }
  const paired = phonePair && c.phones?.devices.find((d) => d.paired >= phonePair.made)
  if (paired) (phoneFresh = paired.id), (phonePair = null) // the code on screen did its job: the new phone is highlighted
  const next = JSON.stringify([c, fresh, linkErr, phonePair?.expires, phonePair && Date.now() >= phonePair.expires, phoneFresh, phoneErr, phoneBusy, linkOpen, [...linkOpen.computers]])
  if (next === linkKey) return
  linkKey = next
  // keep what's being typed across redraws
  const body = linkDialog.querySelector('.link-body')
  const typed = body.querySelector('[data-link-code]')?.value ?? ''
  morph(body, computersHTML(c))
  const box = body.querySelector('[data-link-code]')
  if (box) box.value = typed
  linkDialog.querySelector('[data-link-add]').setAttribute('aria-pressed', String(linkOpen.form))
}

const LINK_CHEV = `<span class="lk-chev">${ICONS.chevron}</span>`
// A computer's icon by its name: a MacBook is a laptop, anything else a desktop.
const machineIcon = (name) => (/book|laptop/i.test(name ?? '') ? ICONS.laptop : ICONS.desktop)

// This Mac (its name, sharing, the code and the details behind it), the linked computers, the paste-a-code form
// when it's asked for, and phones.
function computersHTML({ me, links, phones }) {
  const mine = `
    <div class="lk-li"><span class="lk-ic">${machineIcon(me.name)}</span><div class="lk-k">
      <input class="me-name" data-me-name value="${esc(me.name)}" spellcheck="false" title="This Mac's name: click to rename it. Linked computers see its agents as name@${esc(me.slug)}">
      <small>${plural(me.agents ?? 0, 'agent')} run here</small></div></div>
    <label class="lk-li lk-sw"><div class="lk-k">Let your other Macs link to this one</div><input type="checkbox" class="switch" data-link-share ${me.sharing ? 'checked' : ''}></label>
    ${me.sharing ? `
      <div class="lk-li"><button class="btn primary lk-copy" data-link-copy title="Anyone with this code can use and drive your agents, so keep it to your own Macs">${linkOpen.copied ? `${ICONS.check}Copied` : `${ICONS.copy}Copy link code`}</button>
        <span class="lk-note">Paste it on the other Mac, under Link a computer.</span></div>
      <button class="lk-li lk-more" data-lk-details aria-expanded="${linkOpen.details}"><span>Addresses, port and a new code</span>${LINK_CHEV}</button>
      ${linkOpen.details ? `<div class="lk-details">
        <p>Anyone with the link code can use and drive your agents, so keep it to your own Macs. Linked computers see these agents as <b>name@${esc(me.slug)}</b>.</p>
        <code>${esc(me.code)}</code>
        <div class="addr">${(me.hosts ?? []).map((h) => `<span><b>${esc(h.address)}</b> ${esc(h.via)}</span>`).join('')}</div>
        <div class="lk-row"><span>Port ${me.port}</span><button class="btn small" data-link-reset title="Makes a new code; computers using the old one are disconnected">New code</button></div>
      </div>` : ''}`
    : me.error ? `<div class="lk-li"><p class="err">${esc(me.error)}</p></div>` : ''}`
  const form = linkOpen.form || linkErr ? `
    <div class="lk-label">Link a computer</div>
    <div class="lk-list"><div class="lk-form">
      <p>Paste the code from the other Mac's <b>Copy link code</b>. Linking works both ways: each Mac sees the other's agents.</p>
      <div class="code-in"><textarea data-link-code rows="2" placeholder="crew1.…" spellcheck="false"></textarea><button class="btn primary" data-link-connect>Link</button></div>
      <p class="err" data-link-err>${esc(linkErr)}</p>
    </div></div>` : ''
  return `<div class="lk-label">This Mac</div><div class="lk-list">${mine}</div>
    <div class="lk-label">Linked</div>
    <div class="lk-list">${links.length ? links.map(linkHTML).join('') : '<div class="lk-li lk-empty">No other Macs yet. Copy the link code on one, then Link a computer… here.</div>'}</div>
    ${form}
    <div class="lk-label">Phones</div>
    ${phonesHTML(phones ?? { devices: [] })}`
}

// How a linked computer is: "Online · local network · 7 agents", or "Offline · 3 agents" (why, on hover).
function linkStatus(l) {
  const used = l.agents.filter((a) => !a.hidden).length
  const count = used < l.agents.length ? `${used} of ${plural(l.agents.length, 'agent')}` : plural(l.agents.length, 'agent')
  if (!l.online) return { text: `Offline · ${count}`, tip: `${l.status?.error ?? 'Unreachable'}: it reconnects on its own` }
  const addr = l.status?.address
  const via = !addr ? 'linked to this Mac' : /\.ts\.net$/.test(addr) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(addr) ? 'Tailscale' : 'local network'
  return { text: `Online · ${via} · ${count}`, tip: addr ? `Linked via ${addr}` : 'It linked to this Mac' }
}

// A linked computer: one row (its faces, how it is); its chevron unfolds its agents, to tick the ones to use from here
// or bring one over to run here, and Forget.
function linkHTML(l) {
  const open = linkOpen.computers.has(l.slug)
  const status = linkStatus(l)
  const shown = l.agents.filter((a) => !a.hidden)
  const faces = (shown.length ? shown : l.agents).slice(0, 4)
  const used = shown.length
  return `<section class="lk-pc ${fresh === l.slug ? 'fresh' : ''}" data-computer="${esc(l.slug)}">
    <button class="lk-li" data-lk-open="${esc(l.slug)}" aria-expanded="${open}">
      <span class="lk-ic">${machineIcon(l.name)}</span>
      <span class="lk-k">${esc(l.name)}<small title="${esc(status.tip)}"><span class="lk-dot ${l.online ? '' : 'off'}"></span>${esc(status.text)}</small></span>
      ${faces.length ? `<span class="lk-faces">${faces.map((a) => avatarHTML(a, { size: 24, mood: 'still' })).join('')}${l.agents.length > faces.length ? `<i>+${l.agents.length - faces.length}</i>` : ''}</span>` : ''}
      ${LINK_CHEV}
    </button>
    ${open ? `<div class="lk-body">
      ${fresh === l.slug ? `<p><b>Pick which of ${esc(l.name)}'s agents to use here.</b> The rest keep running there. Move one here to run it on this Mac instead.</p>` : ''}
      ${l.agents.length ? `<ul class="lk-agents">${l.agents.map((a) => `
        <li class="${a.hidden ? 'unused' : ''}">${avatarHTML(a, { size: 30, mood: 'still' })}
          <span class="who"><b>${esc(a.seed)}</b><small>${esc(a.area || 'no area')}</small></span>
          ${l.online ? `<button class="btn small lk-move" data-move="${esc(a.name)}" title="Run it on another computer, with its conversation, instructions, look and work experience">${ICONS.move}Move to…</button>` : ''}
          <label class="use"><input type="checkbox" class="switch" data-use="${esc(a.name)}" ${a.hidden ? '' : 'checked'}>Use</label>
        </li>`).join('')}</ul>` : `<p>${l.online ? 'No agents there yet.' : 'Its agents show here once it\'s back.'}</p>`}
      <div class="lk-row"><span title="Move one with its Move to…, or drag it onto a computer in the sidebar">${l.agents.length > 1 ? `Using ${used} of ${l.agents.length}` : ''}</span>
        <span class="lk-btns">${l.agents.length > 1 ? `<button class="btn small" data-use-all="${esc(l.slug)}">All</button><button class="btn small" data-use-none="${esc(l.slug)}">None</button>` : ''}${l.saved ? `<button class="btn small" data-forget="${esc(l.slug)}" title="Unlink it from this Mac">Forget</button>` : ''}</span></div>
    </div>` : ''}
  </section>`
}

// ---- Phones (core/phones.js): the Crew app on your phone, paired with a code it scans ----------------------------

let phonePair = null // the code this window shows: { code, qr (SVG), expires, made }
let phoneFresh = null // the phone that just paired with it
let phoneErr = ''
let phoneBusy = false // making a code

function phonesHTML(p) {
  const code = phonePair
  const expired = code && Date.now() >= code.expires
  const until = code && new Date(code.expires).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `<section class="lk-list phones">
    <div class="ph-head"><div class="grow"><p style="margin:0">The chat and the questions agents wait on you for, in the Crew app on your phone, over the same Wi-Fi or Tailscale.</p></div>
      <button class="btn" data-phone-add ${phoneBusy ? 'disabled' : ''}>${phoneBusy ? 'Making a code…' : code ? 'New code' : 'Add a phone'}</button></div>
    ${code ? `<div class="ph-pair ${expired ? 'expired' : ''}">
      <div class="ph-qr">${code.qr}${expired ? '<span>Expired</span>' : ''}</div>
      <div class="ph-side">
        <b>${expired ? 'This code has expired' : 'Scan it with the Crew app'}</b>
        <p>${expired ? 'A code works for ten minutes and pairs one phone. Make a new one to add a phone.' : 'Open Crew on your phone and scan this code, or copy it and paste it there. It pairs one phone.'}</p>
        <code>${esc(code.code)}</code>
        <div class="ls-row small"><span>${expired ? `Ended at ${until}` : `Works until ${until}`}</span><span class="ph-btns">${expired ? '' : '<button class="btn small" data-phone-copy>Copy code</button>'}<button class="btn small" data-phone-cancel>${expired ? 'Done' : 'Cancel'}</button></span></div>
      </div>
    </div>` : ''}
    ${p.devices.length ? `<ul class="ph-list">${p.devices.map(phoneHTML).join('')}</ul>` : ''}
    <p class="err">${esc(phoneErr || p.error || '')}</p>
  </section>`
}

function phoneHTML(d) {
  const kind = { ios: 'iPhone', android: 'Android' }[d.platform] ?? 'Phone'
  const seen = d.online ? 'Connected' : phoneDay(d.seen) === 'today' ? `Seen at ${new Date(d.seen).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `Seen ${phoneDay(d.seen)}`
  return `<li class="${d.id === phoneFresh ? 'fresh' : ''}" data-phone="${esc(d.id)}">
    <span class="ph-icon">${ICONS.phone}</span>
    <span class="who"><b>${esc(d.name)}</b><small>${kind}${d.app ? ` · Crew ${esc(d.app)}` : ''} · paired ${phoneDay(d.paired)}</small></span>
    <span class="ph-seen"><span class="dot ${d.online ? 'live' : 'off'}"></span>${seen}</span>
    <button class="btn small" data-phone-remove="${esc(d.id)}">Remove</button>
  </li>`
}

// 'today', 'yesterday' or '12 Oct'
function phoneDay(ts) {
  const day = (t) => new Date(t).toDateString()
  if (day(ts) === day(Date.now())) return 'today'
  if (day(ts) === day(Date.now() - 864e5)) return 'yesterday'
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

async function phoneAction(t) {
  if (t.closest('[data-phone-add]')) {
    const made = Date.now()
    phoneBusy = true
    phoneErr = ''
    drawComputers(state)
    try {
      phonePair = { ...(await crew.call('phones', 'code')), made }
      phoneFresh = null
    } catch (x) {
      phoneErr = x.message
    } finally {
      phoneBusy = false
      drawComputers(state)
    }
  }
  if (t.closest('[data-phone-copy]')) {
    await crew.call('copy', phonePair.code)
    t.closest('[data-phone-copy]').textContent = 'Copied ✓'
  }
  if (t.closest('[data-phone-cancel]')) {
    const open = Date.now() < phonePair.expires
    phonePair = null
    drawComputers(state)
    if (open) await crew.call('phones', 'cancel')
  }
  const remove = t.closest('[data-phone-remove]')?.dataset.phoneRemove
  const phone = remove && state.computers.phones.devices.find((d) => d.id === remove)
  if (phone && confirm(`Remove ${phone.name}? It can't reach this Mac any more, until you pair it again.`)) await crew.call('phones', 'revoke', remove)
}

async function openComputers() {
  fresh = null
  linkErr = ''
  Object.assign(linkOpen, { details: false, form: false, copied: false })
  linkOpen.computers.clear()
  phoneFresh = null
  phoneErr = ''
  if (phonePair && Date.now() >= phonePair.expires) phonePair = null // long gone: no need to say so
  // one made before this window opened, and still open: shown again, to scan or to cancel (codes last ten minutes)
  if (!phonePair && state.computers?.phones?.pairing) {
    const open = await crew.call('phones', 'open').catch(() => null)
    if (open) phonePair = { ...open, made: open.expires - 10 * 60000 }
  }
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
  if (t.closest('.phones')) return phoneAction(t).catch((x) => ((phoneErr = x.message), drawComputers(state)))
  // what folds: the details, a linked computer's agents, the paste-a-code form
  if (t.closest('[data-lk-details]')) return void ((linkOpen.details = !linkOpen.details), drawComputers(state))
  const pc = t.closest('[data-lk-open]')?.dataset.lkOpen
  if (pc) return void (linkOpen.computers.has(pc) ? linkOpen.computers.delete(pc) : linkOpen.computers.add(pc), drawComputers(state))
  if (t.closest('[data-link-add]')) {
    linkOpen.form = !linkOpen.form
    if (!linkOpen.form) linkErr = ''
    drawComputers(state)
    const box = linkDialog.querySelector('[data-link-code]')
    box?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    return box?.focus({ preventScroll: true })
  }
  try {
    if (t.closest('[data-link-copy]')) {
      await crew.call('copy', state.computers.me.code)
      linkOpen.copied = true
      drawComputers(state)
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => ((linkOpen.copied = false), drawComputers(state)), 1800)
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
        linkOpen.computers.add(fresh) // its agents unfolded, to pick from
        linkOpen.form = false
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
  const clonesAt = state.agents.filter((x) => x.cloneOf === a.name)
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
    ${clonesAt.length ? `<p class="mv-busy">${who}'s ${plural(clonesAt.length, 'clone')} at work ${clonesAt.length > 1 ? 'stop' : 'stops'} on ${esc(from.name)}: clones don't move.</p>` : ''}
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
  const m = moving // closing the sheet (or opening another) mustn't lose this one's result
  try {
    const res = await crew.call('moveAgent', m.name, m.home, m.folder)
    // where it went is in view: its computer unfolds, and its row is the selected one
    if (folds.delete(`group:${m.home}`)) store.set('crew.folds', JSON.stringify([...folds]))
    if (res?.name) selected = res.name
    const to = crewGroups(state).find((g) => g.key === m.home)?.name ?? 'there'
    const who = state.agents.find((a) => a.name === m.name)?.seed ?? m.name.split('@')[0]
    if (moving === m) moveDialog.close()
    toast(res?.conversation === 'fresh'
      ? `${who} moved to ${to}. Its conversation couldn't come along (${res.older ? `${to} runs an older Crew` : res.reason ?? 'not found'}), so it starts a new one there.`
      : `${who} moved to ${to}, conversation and all.`, res?.conversation === 'fresh')
  } catch (x) {
    if (moving !== m) return toast(`Couldn't move ${m.name.split('@')[0]}: ${x.message}`, true)
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
  // in a workspace other than the default, the linked computers that have it too
  const ws = state.workspace?.id ?? 'default'
  const places = [{ slug: '', name: 'this computer' }, ...(state.computers?.links ?? []).filter((l) => l.online && (ws === 'default' || l.spaces?.includes(ws)))]
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

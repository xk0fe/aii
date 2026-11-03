// Full-screen view, laid out like a group chat: the sidebar (the workspace, its places, and a conversation with each
// agent) and what's open: #crew, one agent's conversation with its terminal docked beside it, Agents, Tasks or Terminals.
/* global pageHead, headTitle, mountSearch, glide, reduceMotion, EASE, DUR, isUnread, mountWorkspaces, shortPath, pathParts, keys, keysIn, commandKey, workspaceKey, ON_WINDOWS, THIS_COMPUTER, upFirst, notify, oops, errorReason, errorLine, burst, wsColor, wsTile, statusClass, displayName, contextRing, ctxLevel, mountTasks, crew, live, store, morph, modeMarks, modeChips, powerSwitch, statusText, brainShort, brainLabel, brainWords, crewGroups, grouped, segmented, celebrate, agentColor, markSVG, mountFeed, mountComposer, mountCollection, avatarHTML, esc, plural, popMenu, ICONS, svg, Terminal, FitAddon, needsYou, needText, clonesOf, cloneTag, runningSubs, blockedOn, activityWords, isConvo, familyOf, nameHTML, hasWorkspaces, paceWarning, usageTip, usageLine, resetsText, modelName, PRODUCT_NAME, mountSetup, faceStack */

const $ = (s) => document.querySelector(s)
const THEME = {
  background: '#0f1012', foreground: '#e4e4e7', cursor: '#e4e4e7', cursorAccent: '#0f1012', selectionBackground: 'rgba(122, 162, 255, 0.3)',
  black: '#1d1f21', red: '#ff6b6b', green: '#4cd38a', yellow: '#ffd166', blue: '#7aa2ff', magenta: '#c58cff', cyan: '#36cfc9', white: '#d4d4d8',
  brightBlack: '#5c5f66', brightRed: '#ff8787', brightGreen: '#69db9a', brightYellow: '#ffe08a', brightBlue: '#9bb8ff', brightMagenta: '#d6a8ff', brightCyan: '#5fe0da', brightWhite: '#fafafa',
}

const terms = new Map() // name -> { tile, head, term, fit, ready }
let booted = false // the composer says who it's aimed at as it mounts, before what that opens exists
// The chat: #crew (everyone's messages), or your conversation with one agent. What it's aimed at is the composer's
// target: an agent's name is that agent's conversation (see isConvo). Questions are cards in the conversation,
// answered where they are (inline), not in a queue above it.
const feed = mountFeed($('.feed'), {
  inline: true,
  face: 36,
  onAgent: (name) => select(name),
  onConvo: (name) => openDM(name),
  onLeave: () => composer.setTarget('auto'),
  onTicket: (key) => openTask(key),
  onReply: (e) => composer.replyTo(e),
  onFound: () => closeSearch({ keep: true }),
  welcome: () => welcomeHTML(),
})
const composer = mountComposer($('.compose'), { dropZone: $('.chat'), onSend: () => feed.toLatest(), onTarget: (to) => targetChanged(to), onDictate: () => place === 'chat' || place === 'dm' || goPlace('chat') })
const collection = mountCollection($('.collection'), {
  headIn: $('.heads'),
  onTerminal: (name) => select(name), onImport: () => importPack(), onMove: (name, home) => moveSheet(name, home),
  onWorkspace: () => workspaces.settings(),
  onRenamed: (from, to) => renamed(from, to),
})
const tasks = mountTasks($('.tasks-view'), { headIn: $('.heads'), onTerminal: (name) => select(name) })
const workspaces = mountWorkspaces({ button: $('.ws-switch'), banner: $('.ws-banner'), dock: $('.ws-dock'), dialog: $('#ws'), onSwitch: (id, opts) => switchTo(id, opts), onSwitched: (next) => switched(next), onMembers: (at) => openMembers(at) })
// first run: Claude Code and Codex, what to install or sign in to, then the first agent (ui/setup.js)
const setup = mountSetup({ onAdd: () => addAgent() })

// Where you are: 'chat' (#crew), 'dm' (the conversation the composer is aimed at), 'crew' (Agents, the cards),
// 'tasks' or 'terminals'. The terminals are laid out as a grid or one big one.
const PLACES = ['chat', 'crew', 'tasks', 'terminals']
let place = store.get('crew.place') === 'dm' || PLACES.includes(store.get('crew.place')) ? store.get('crew.place') : 'chat'
let layout = store.get('crew.layout') === 'focus' ? 'focus' : 'grid'
let show = ['busy', 'needs'].includes(store.get('crew.show')) ? store.get('crew.show') : 'all' // the grid: every terminal, the busy ones, or the ones waiting on you
let lastDm = null // the agent whose conversation was open last, and when you left it (an agent renamed or gone)
let left = null
let selected = null // the terminal picked in Terminals
let dockPick = null // the terminal picked in a conversation's dock: the agent's own, or one of its clones'
let state = { agents: [], providers: {}, feed: [] }
// the roster's folds: computers you folded away
const folds = new Set((() => {
  try {
    return JSON.parse(store.get('crew.folds') || '[]')
  } catch {
    return []
  }
})())
let find = ''
// The conversation the composer was aimed at last time is the one that opens (in #crew), and Agents, Tasks or
// Terminals open on everyone's.
if (isConvo(composer.target()) && place === 'chat') place = 'dm'
else if (isConvo(composer.target()) && place !== 'dm') composer.setTarget('auto')

$('.blank .blank-mark').outerHTML = ICONS.mark
// Windows has no traffic lights: the app's mark sits at the sidebar's top instead
if (ON_WINDOWS) $('.side-top').innerHTML = `<span class="app-mark" aria-hidden="true">${markSVG('0 4 24 18')}</span>`
const NAV_ICON = { crew: markSVG('0 4 24 18'), tasks: ICONS.task, terminals: ICONS.terminal }
for (const b of document.querySelectorAll('.nv .nv-icon')) b.outerHTML = NAV_ICON[b.closest('.nv').dataset.place]
// Terminals' header: which terminals (with how many), and the grid or one big one
$('.heads').insertAdjacentHTML('beforeend', pageHead({
  id: 'terminals', glyph: ICONS.terminal, title: 'Terminals', sub: 'Every agent’s terminal, live',
  tools: `<div class="seg tv-show" data-show><button data-show="all" title="Every terminal">All <i class="n"></i></button><button data-show="busy" title="The ones working, starting or waiting on you">Busy <i class="n"></i></button><button data-show="needs" title="The ones waiting on you">Needs you <i class="n"></i></button></div>
    <div class="seg icons tv-layout" data-layout><button data-layout="grid" title="Every terminal side by side" aria-label="Grid">${ICONS.grid}</button><button data-layout="focus" title="One terminal, big" aria-label="Focus">${ICONS.focus}</button></div>`,
}))
// Only the open place's header shows, from the first paint (the state that draws the rest comes a moment later).
function showHead() {
  for (const h of document.querySelectorAll('.heads > .page-head')) h.classList.toggle('hidden', h.dataset.for !== (place === 'dm' ? 'chat' : place))
}
showHead()
$('.find-icon').outerHTML = ICONS.search
$('[data-act=find]').innerHTML = ICONS.search
$('.side-ws [data-act=add]').innerHTML = ICONS.plus
$('.side-more').innerHTML = ICONS.more
$('#link .h-icon').outerHTML = ICONS.computers
$('#link [data-link-add]').innerHTML = `${ICONS.link}Link a computer…`
$('#import .h-icon').outerHTML = ICONS.import
const DOWN = svg('<path d="M12 5v14M5 12l7 7 7-7"/>', 'stroke-width="2.4"')
// the page's own hints in this computer's keys (⌘F is Ctrl+F on Windows)
for (const el of document.querySelectorAll('[title]')) el.title = keysIn(el.title)

// ---- what's open ----------------------------------------------------------------------------------------------

// The agent whose conversation is open (an agent, for a clone's), and its terminal in the dock: the one picked there,
// else the one the conversation is with, else its first clone's. Off agents have no terminal: no dock.
const dmAgent = () => (isConvo(composer.target()) ? state.agents.find((a) => a.name === familyOf(composer.target())) ?? state.agents.find((a) => a.name === composer.target()) : null)
const family = (name) => [...terms.keys()].filter((n) => familyOf(n) === familyOf(name))
function dockName() {
  if (place !== 'dm') return null
  const fam = family(composer.target())
  return [dockPick, composer.target(), familyOf(composer.target())].find((n) => n && fam.includes(n)) ?? fam[0] ?? null
}
const dockOn = () => store.get('crew.dock') !== '0'
const docked = () => place === 'dm' && dockOn() && Boolean(dockName())

// Open a place, or the conversation the composer's aimed at ('dm'). Views that are hidden skip their redraws: the one
// coming into view catches up first, still hidden.
function showPlace(next) {
  if (next === 'dm' && !isConvo(composer.target())) next = 'chat'
  const moved = next !== place
  if (moved) (openMenu?.close(), document.querySelector('.use-pop:popover-open')?.hidePopover()) // a menu from the last place doesn't float over this one
  if (moved) closeSearch()
  place = next
  store.set('crew.place', next)
  if (place === 'dm') lastDm = dmAgent()?.name ?? lastDm
  const dock = docked()
  collection.setVisible(place === 'crew')
  tasks.setVisible(place === 'tasks')
  $('.chat').classList.toggle('hidden', place !== 'chat' && place !== 'dm')
  $('.collection').classList.toggle('hidden', place !== 'crew')
  $('.tasks-view').classList.toggle('hidden', place !== 'tasks')
  $('.terms-view').classList.toggle('hidden', place !== 'terminals' && !dock)
  $('.terms-view').classList.toggle('docked', dock)
  $('.stage').classList.toggle('docked', dock)
  $('.terms').classList.toggle('focus', dock || layout === 'focus')
  for (const b of document.querySelectorAll('.nv')) b.dataset.place === place ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')
  showHead()
  segmented($('[data-layout]'), (b) => b.dataset.layout === layout)
  $('[data-show]').classList.toggle('idle', layout === 'focus') // stays in place, so nothing moves
  if (!terms.has(selected)) selected = terms.keys().next().value ?? null
  highlight(dock ? dockName() : selected)
  drawRoster()
  drawHead()
  drawDock()
  drawShow()
  drawBlank()
  if (moved && (place === 'chat' || place === 'dm')) requestAnimationFrame(() => feed.reveal())
  // the terminals fit their new boxes when those changed (a place, the dock, the layout), not on every state push
  const shape = `${place}|${dock}|${dockName()}|${layout}|${terms.size}`
  if (shape !== lastShape) requestAnimationFrame(() => terms.forEach((_, name) => resize(name)))
  lastShape = shape
}
let lastShape = ''
// A place from the sidebar (or ⌘1–4): the composer goes back to everyone, which only #crew shows.
function goPlace(next) {
  if (isConvo(composer.target())) composer.setTarget('auto') // targetChanged: back to #crew's messages
  showPlace(next)
  if (next === 'chat') composer.focus()
}
// The composer's target changed (an agent in the sidebar, a face in a message, the To picker, Reply): its
// conversation, or everyone's.
function targetChanged(to) {
  feed.setConvo(to)
  if (!booted) return
  closeSearch() // the search was the last conversation's
  if (place === 'dm' && !isConvo(to)) left = { name: lastDm, at: Date.now() }
  dockPick = null
  if (isConvo(to)) showPlace('dm')
  else if (place === 'dm') showPlace('chat')
  else drawHead()
}
// An agent renamed in its sheet: if its conversation was open, it follows the new name, with what you were writing.
// The save and the state with the new name come in either order.
let renaming = null
function renamed(from, to) {
  renaming = { from, to }
  followRename()
}
function followRename() {
  if (!renaming || !state.agents.some((a) => a.name === renaming.to)) return
  const { from, to } = renaming
  renaming = null
  const open = place === 'dm' ? dmAgent()?.name : null
  if (open === to || (open !== from && !(left?.name === from && Date.now() - left.at < 10000))) return
  composer.moveDraft(from, to)
  openDM(to)
}

// Your conversation with an agent. terminal: with its terminal docked beside it (and that one picked, for a clone).
function openDM(name, { terminal = false } = {}) {
  if (terminal) store.set('crew.dock', '1')
  if (composer.target() !== name) composer.setTarget(name)
  else showPlace('dm')
  if (terminal && terms.has(name)) {
    dockPick = name
    showPlace('dm')
  }
}

// ---- the header: #crew, or who you're talking to ---------------------------------------------------------------

const chatHeadEl = $('.page-head[data-for=chat]')
function drawHead() {
  const a = place === 'dm' ? dmAgent() : null
  const [title, acts] = place === 'chat' ? chatHead() : a ? dmHead(a) : ['', '']
  chatHeadEl.classList.toggle('none', !title)
  morph(chatHeadEl.querySelector('.ph-title'), title)
  morph(chatHeadEl.querySelector('.ph-acts'), acts)
}
// #crew: who it reaches, what's waiting on you (a click goes to the oldest), and who's in it (a click opens Agents).
function chatHead() {
  const needs = needsYou(state)
  const members = state.agents.filter((a) => !a.cloneOf)
  const faces = [...members.filter((a) => a.on), ...members.filter((a) => !a.on)]
  const who = hasWorkspaces(state) ? `Everyone in ${state.workspace.name}` : 'Your whole crew'
  const folder = state.workspace?.folder
  return [headTitle({ glyph: '#', title: 'crew', sub: `${esc(who)} · ${folder ? esc(tildePath(folder)) : 'Auto picks who answers'}`, tip: folder ? `Its agents work in ${folder}, unless one has a folder of its own here` : 'Each agent works in its own folder' }),
    `${needs.length ? `<button class="mh-needs" data-head="needs" title="${esc(`${needs.map((x) => `${displayName(x.agent)}: ${needText(x)}`).join('\n')}\n\nClick for the oldest`)}">${needs.length} waiting on you${DOWN}</button>` : ''}
      ${members.length ? `<button class="mh-faces" data-head="members" aria-haspopup="dialog" title="${esc(`Who works here: ${plural(members.length, 'agent')}, ${faces.filter((a) => a.on).length} on`)}">${faces.slice(0, 5).map((a) => avatarHTML(a, { size: 24, mood: 'still' })).join('')}<span>${members.length}</span></button>` : ''}`]
}
// An agent: its creature and name, what it is and its brain in one line (with its clones or helpers), then its
// switches (YOLO, Fast, on/off), its terminal, its profile (the sheet) and everything else (⋯).
function dmHead(a) {
  const clones = clonesOf(state.agents, a).filter((c) => c.on)
  const helpers = runningSubs(a).length
  const meta = [a.area, brainWords(a, state.providers, { short: true }), clones.length ? plural(clones.length, 'clone') : helpers ? plural(helpers, 'helper') : ''].filter(Boolean)
  const canDock = family(a.name).length > 0
  return [headTitle({ glyph: avatarHTML(a, { size: 28 }), title: nameHTML({ ...a, cloneOf: null }), sub: esc(meta.join(' · ')), tip: [statusText(a), brainLabel(a, state.providers)].join('\n') }),
    `${modeChips(a)}
      <label class="mh-power" title="${esc(a.on ? 'On: turn it off (it stays off after restarts)' : 'Off: turn it on (it picks up its session)')}">${powerSwitch(a)}<span>${a.on ? 'On' : 'Off'}</span></label>
      <button class="btn" data-head="terminal" aria-pressed="${docked()}" ${canDock ? '' : 'disabled'} title="${canDock ? (docked() ? 'Put its terminal away' : 'Show its terminal beside the conversation') : `${esc(a.seed ?? a.name)} is off: no terminal`}">${ICONS.terminal}<span>Terminal</span></button>
      <button class="btn" data-head="profile" title="Its brain, folder, rules, instructions and look">${ICONS.edit}<span>Profile</span></button>
      <button class="icon" data-head="menu" title="More" aria-label="More" aria-haspopup="menu">${ICONS.more}</button>`]
}
chatHeadEl.addEventListener('click', (e) => {
  if (e.target.closest('.ph-glyph')) return dmAgent() && place === 'dm' && edit(dmAgent().name) // its creature: its profile
  const b = e.target.closest('[data-head], [data-place]')
  if (!b) return
  if (b.dataset.place) return goPlace(b.dataset.place)
  const a = dmAgent()
  const act = b.dataset.head
  if (act === 'needs') return answerOldest()
  if (act === 'members') return openMembers(b)
  if (!a) return
  if (act === 'terminal') {
    store.set('crew.dock', docked() ? '0' : '1')
    showPlace('dm')
  }
  if (act === 'profile') edit(a.name)
  if (act === 'menu') agentMenu(a.name, b)
})

// ---- who works here: the workspace's agents, from #crew's faces, the workspace's menu or its welcome -----------------
// Its agents (one shared with your other workspaces can be taken out of this one), the rest of your crew (bring one
// in: it starts here in a conversation of its own), and a new agent. The default workspace has everyone.
const membersPop = $('.members-pop')
let membersAt = null
// a second click on what opened it closes it: the press already did (light dismiss), so the click doesn't reopen it
let membersWasOpen = false
document.addEventListener('pointerdown', (e) => (membersWasOpen = membersPop.matches(':popover-open') && Boolean(e.target.closest?.('[data-head=members]'))), true)
function openMembers(at) {
  if (membersWasOpen) return void (membersWasOpen = false)
  membersAt = at
  drawMembers()
  if (!membersPop.matches(':popover-open')) membersPop.showPopover()
  membersPop.focus({ preventScroll: true }) // Tab goes on into the list
  const r = (at?.isConnected ? at : $('.mainhead')).getBoundingClientRect()
  const w = membersPop.offsetWidth
  membersPop.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - w - 8, r.right - w)))}px`
  membersPop.style.top = `${Math.round(Math.min(r.bottom + 6, innerHeight - membersPop.offsetHeight - 8))}px`
  if (r.left < 200) membersPop.style.left = `${Math.round(Math.max(8, r.left))}px` // from the sidebar or the rail: under it, to the right
}
function drawMembers() {
  const w = state.workspace ?? { id: 'default', name: 'Home' }
  const named = w.id !== 'default'
  const here = state.agents.filter((a) => !a.cloneOf)
  const others = named ? (state.roster ?? []).filter((r) => !here.some((a) => a.name === r.name)) : []
  const row = (a, end) => `<div class="mp-row" data-agent="${esc(a.name)}">${avatarHTML(a, { size: 30, mood: 'still' })}<span class="mp-who"><b>${esc(a.seed ?? a.name)}</b><small>${esc(a.area || (a.status ? upFirst(statusText(a)) : ''))}</small></span>${end}</div>`
  const take = (a) => (named && a.shared ? `<button class="btn plain mp-take" data-mp-take="${esc(a.name)}" title="${esc(`Take ${a.name} out of ${w.name}: it stays in your crew and your other workspaces`)}">Take out</button>` : named ? '<span class="mp-only" title="Made for this workspace: it works only here">only here</span>' : '')
  morph(membersPop, `<header class="mp-head"><b>Who works here</b><span>${here.length}</span></header>
    <p class="mp-lead">${named ? `${esc(w.name)}'s agents${w.folder ? `, in ${esc(tildePath(w.folder))}` : ''}. One from your crew works here in a conversation of its own.` : 'Everyone in your crew works here, each in its own folder.'}</p>
    <div class="mp-body">
      ${here.length ? here.map((a) => row(a, take(a))).join('') : `<p class="mp-lead">Nobody yet.</p>`}
      ${others.length ? `<div class="mp-sec">From your crew</div>${others.map((r) => row({ ...r, status: '' }, `<button class="btn mp-add" data-mp-add="${esc(r.name)}">Add</button>`)).join('')}` : ''}
    </div>
    <footer class="mp-foot"><button class="btn" data-mp-new>${ICONS.plus}<span>New agent${named ? ` for ${esc(w.name)}` : ''}</span></button><span class="grow"></span><button class="btn plain" data-mp-agents>All agents</button></footer>`)
}
// closed with Esc or a click outside: the focus goes back to what opened it, if nothing else took it
membersPop.addEventListener('toggle', (e) => e.newState === 'closed' && (document.activeElement === document.body || membersPop.contains(document.activeElement)) && membersAt?.isConnected && membersAt.focus({ preventScroll: true }))
membersPop.addEventListener('click', async (e) => {
  const w = state.workspace
  const add = e.target.closest('[data-mp-add]')?.dataset.mpAdd
  const out = e.target.closest('[data-mp-take]')?.dataset.mpTake
  try {
    if (add) {
      await crew.call('workspace', 'members', w.id, { add: [add] })
      toast(`${add} joins ${w.name}${w.folder ? `, working in ${shortPath(w.folder)}` : ''}`)
    }
    if (out) {
      const a = state.agents.find((x) => x.name === out)
      if (busy(a) ? !confirm(`${out} is in the middle of something in ${w.name}. Take it out anyway? It stops working here, and starts a fresh conversation if it comes back.`) : !confirm(`Take ${out} out of ${w.name}? It stops working here, and starts a fresh conversation if it comes back. It stays in your crew and your other workspaces.`)) return
      await crew.call('workspace', 'members', w.id, { remove: [out] })
    }
  } catch (err) {
    oops(add ? `Couldn't add ${add} to ${w.name}` : `Couldn't take ${out} out of ${w.name}`, err)
  }
  if (e.target.closest('[data-mp-new]')) (membersPop.hidePopover(), addAgent())
  if (e.target.closest('[data-mp-agents]')) (membersPop.hidePopover(), goPlace('crew'))
  const row = !add && !out && e.target.closest('.mp-row:not(:has([data-mp-add]))')
  if (row) (membersPop.hidePopover(), openDM(row.dataset.agent), composer.focus())
})

// ---- an empty #crew: its first steps, like Discord's welcome to a new server ------------------------------------
// Who works here, its folder (a workspace of your own), and the first message; each a click away, ticked once done.
// "Ada", "Ada and Iris", "Ada, Iris and June", "Ada, Iris and 3 others"
const nameList = (list) => (list.length > 3 ? `${list.slice(0, 2).join(', ')} and ${list.length - 2} others` : list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] ?? '')
function welcomeHTML() {
  if (!state.agents.length && !hasWorkspaces(state)) return '' // the very first run: setup and Agents say what to do
  const w = state.workspace ?? { id: 'default', name: 'Home' }
  const named = w.id !== 'default'
  const here = state.agents.filter((a) => !a.cloneOf)
  const step = (done, act, title, sub) => `<button class="wl-step ${done ? 'done' : ''}" data-welcome="${act}"><i class="wl-mark">${done ? ICONS.check : ''}</i><span><b>${esc(title)}</b><small>${esc(sub)}</small></span><i class="wl-go">${ICONS.chevron}</i></button>`
  return `<div class="welcome">${wsTile(w, { size: 64 })}<h2>${hasWorkspaces(state) ? `Welcome to ${esc(w.name)}` : 'Welcome to #crew'}</h2>
    <p>Everyone here sees what's said in #crew. Ask for something and Auto picks who answers, or @name someone.</p>
    <div class="wl-steps">
      ${step(here.length > 0, 'members', here.length ? `${plural(here.length, 'agent')} work${here.length > 1 ? '' : 's'} here` : 'Choose who works here', named ? 'Agents from your crew, or new ones just for this workspace' : 'Everyone in your crew, each in its own folder')}
      ${named ? step(Boolean(w.folder), 'settings', w.folder ? `They work in ${tildePath(w.folder)}` : 'Pick its folder', 'Where its agents work, unless one has a folder of its own') : ''}
      ${step(false, 'message', 'Send the first message', here.length ? `${nameList(here.map((a) => a.seed ?? a.name))} ${here.length > 2 ? 'all see' : here.length > 1 ? 'both see' : 'sees'} it` : 'Once someone works here')}
    </div></div>`
}
$('.feed').addEventListener('click', (e) => {
  const act = e.target.closest('[data-welcome]')?.dataset.welcome
  if (act === 'members') openMembers(e.target.closest('[data-welcome]'))
  if (act === 'settings') workspaces.settings()
  if (act === 'message') composer.focus()
})

// What's waiting on you, oldest first: a question goes to its card in #crew, an agent asking in its terminal to that.
function answerOldest() {
  const n = needsYou(state)[0]
  if (!n) return
  if (!n.ask) return select(n.agent.name)
  if (place !== 'chat') goPlace('chat')
  requestAnimationFrame(() => feed.jump(n.ask.id))
}

// ---- searching the messages: #crew's, or the conversation's ------------------------------------------------------

// The magnifier opens a field; what you type narrows the chat to the messages with every word (marked), with how many
// in the field. A click on one shows it where it was. Esc, or leaving, ends it.
const msearch = mountSearch($('.chat-search'), {
  label: 'Search messages',
  placeholder: () => (place === 'dm' && dmAgent() ? `Search with ${dmAgent().seed ?? dmAgent().name}` : 'Search #crew'),
  delay: 120,
  onSearch: (q) => {
    const n = feed.search(q)
    $('.feed').classList.toggle('searching', Boolean(q.trim()))
    return n >= 200 ? `${n}+` : n
  },
  onClose: ({ escape }) => {
    $('.feed').classList.remove('searching')
    if (escape) composer.focus()
  },
})
const openSearch = () => msearch.open()
const closeSearch = (opts) => msearch.close(opts)

// ---- the dock: the conversation's agent's terminal, with a tab for each of its clones -----------------------------

function drawDock() {
  const bar = $('.dock-bar')
  const name = docked() && dockName()
  const t = name && terms.get(name)
  if (!t?.agent) return morph(bar, '')
  const waiting = new Set(needsYou(state).map((x) => x.agent.name))
  const fam = family(name).map((n) => terms.get(n).agent).filter(Boolean)
  const mode = tileMode(t)
  const [badge, line, tip] = RIBBON[mode](t.agent, displayName(t.agent))
  morph(bar, `<div class="dock-tabs" role="tablist" aria-label="${esc(`${displayName(fam[0] ?? t.agent)}'s terminals`)}">${fam.map((a) => `<button class="dock-tab" role="tab" data-dock="${esc(a.name)}" aria-selected="${a.name === name}" title="${esc(`${displayName(a)}: ${statusText(a)}`)}">${avatarHTML(a, { size: 18, mood: 'still' })}<span>${esc(a.cloneOf ? `Clone ${a.clone}` : a.seed ?? a.name)}</span>${waiting.has(a.name) ? '<i class="need-badge" aria-label="needs you">!</i>' : ''}</button>`).join('')}</div>
    <span class="grow"></span><span class="t-badge" data-mode="${mode}" title="${esc([line, tip, brainShort(t.agent, state.providers)].filter(Boolean).join('\n\n'))}">${badge}</span>
    <button class="icon" data-dock-act="expand" title="Open it in Terminals">${ICONS.expand}</button>
    <button class="icon" data-dock-act="close" title="Put the terminal away">${ICONS.close}</button>`)
}
$('.dock-bar').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-dock]')
  if (tab) {
    dockPick = tab.dataset.dock
    showPlace('dm')
    return terms.get(dockPick)?.term.focus()
  }
  const act = e.target.closest('[data-dock-act]')?.dataset.dockAct
  if (act === 'close') {
    store.set('crew.dock', '0')
    showPlace('dm')
  }
  if (act === 'expand') {
    selected = dockName()
    layout = 'focus'
    store.set('crew.layout', layout)
    goPlace('terminals')
  }
})

// Everything the titlebar used to carry, at the sidebar's foot: Autopilot, Computers, the CLIs and the theme (and,
// running from source, config.json).
const THEME_CHOICES = [['system', 'Auto', 'auto', `follows ${ON_WINDOWS ? 'Windows' : 'macOS'}`], ['light', 'Light', 'sun', ''], ['dark', 'Dark', 'moon', '']]
$('.side-more').addEventListener('click', (e) => {
  const theme = state.theme ?? 'system'
  const c = state.computers ?? { me: {}, links: [] }
  const away = c.links.filter((l) => !l.online).length
  popMenu(e.currentTarget, [
    { label: 'Autopilot', icon: ICONS.plane, act: 'autopilot', hint: state.autopilot ? 'On: hand-offs go through' : 'Off: hand-offs wait for you' },
    '-',
    { label: 'Computers…', icon: ICONS.computers, act: 'computers', hint: away ? `${away} offline` : c.links.length ? `${c.links.length + 1} linked` : '' },
    { label: 'Claude Code and Codex…', icon: ICONS.terminal, act: 'setup' },
    '-',
    { head: 'Theme' },
    ...THEME_CHOICES.map(([id, label, icon, note]) => ({ label, icon: ICONS[icon], act: `theme:${id}`, hint: theme === id ? '✓' : note })),
    ...(crew.dev ? ['-', { label: 'Open config.json', icon: ICONS.braces, act: 'config', hint: 'developer' }] : []),
  ], (act) => {
    if (act === 'autopilot') crew.call('autopilot', !state.autopilot).catch((err) => oops("Couldn't change Autopilot", err))
    if (act === 'computers') openComputers()
    if (act === 'setup') setup.open()
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

  const term = new Terminal({ theme: THEME, fontFamily: '"SF Mono", Menlo, "Cascadia Mono", Consolas, monospace', fontSize: 12, lineHeight: 1.12, cursorBlink: true, macOptionIsMeta: true, scrollback: 5000 })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit)
  term.open(tile.querySelector('.term'))
  quietSelection(term)
  // Shift+Enter = newline in Claude Code, same as /terminal-setup configures.
  term.attachCustomKeyEventHandler((e) => {
    if (ON_WINDOWS && !windowsTerminalKey(term, e)) return false
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

// On Windows, Ctrl is the terminal's own key (Ctrl+C stops what the agent runs), so copy and paste go as in Windows
// Terminal: Ctrl+C copies when there's a selection, Ctrl+Shift+C always, Ctrl+V and Ctrl+Shift+V paste (the page's paste,
// which xterm types in). Ctrl+1–4 and Ctrl+Alt+S/C stay Crew's (a Mac's ⌘ keys never reach the terminal); the other
// Ctrl keys go to the agent. false: xterm leaves the key alone.
function windowsTerminalKey(term, e) {
  if (e.type !== 'keydown' || !e.ctrlKey || e.metaKey || e.getModifierState('AltGraph')) return true
  const key = e.key.toLowerCase()
  if (key === 'c' && !e.altKey && (e.shiftKey || term.hasSelection())) {
    e.preventDefault()
    if (term.hasSelection()) crew.call('copy', term.getSelection()).catch(() => {})
    if (!e.shiftKey) term.clearSelection()
    return false
  }
  if (key === 'v' && !e.altKey) return false
  if (/^[1-4]$/.test(e.key) && !e.altKey && !e.shiftKey) return false
  return true
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
  live: (a, n) => ['Live', `${PRODUCT_NAME}'s view of ${n}'s terminal · earlier output replayed`,
    `This isn't a terminal app. ${PRODUCT_NAME} runs ${n}'s CLI in a pseudo-terminal and draws its output here; what you type goes straight to ${n}. Output from before this view opened (up to 256 KB) is replayed, so older lines can look off until ${n} redraws.`],
  mirror: (a, n) => ['Mirror', `Streamed from ${a.homeName} · earlier output replayed`,
    `${n} runs on ${a.homeName}. Its terminal output streams here over ${PRODUCT_NAME} Link and what you type goes back to it. Output from before this view opened is replayed, so older lines can look off until it redraws.`],
  replay: (a, n) => ['Replay', `Redrawing ${n}'s recent output…`, `${PRODUCT_NAME} is replaying what the agent printed before this view opened. Live output follows.`],
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
const modelWord = (a) => [a.model ? modelName(a.model) : (state.providers?.[a.provider]?.label ?? a.provider ?? ''), a.fast ? 'Fast' : ''].filter(Boolean).join(' · ')
// Its name, a clone with its number, and an agent on another computer with that computer: "Rex · Workstation".
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
    <span class="t-mid"><span class="t-state ${statusClass(a)}" ${busyNow ? 'data-act="markIdle"' : ''} title="${esc(stateTip)}">${esc(upFirst(statusText(a)))}</span><span class="t-model" title="${esc(brainLabel(a, state.providers))}">${esc(modelWord(a))}</span></span>
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

// Answer: its question's card in your conversation with it when it asked there, otherwise its terminal, where it's
// asking.
function answerTile(name) {
  const ask = needsYou(state).find((x) => x.agent.name === name)?.ask
  if (!ask) return select(name)
  openDM(name, { terminal: true }) // a clone asking: its tab in the dock
  requestAnimationFrame(() => feed.jump(ask.id))
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
  } else if (act === 'fresh') crew.call('freshStart', name).catch((err) => oops(`Couldn't start a new conversation for ${displayName(terms.get(name)?.agent ?? { name })}`, err))
  else if (act === 'off') crew.call('update', name, { off: true })
  else if (act === 'dismiss') {
    const a = terms.get(name)?.agent
    if (a && (a.status === 'working' || a.status === 'waiting') && !confirm(`${displayName(a)} is in the middle of something. Send it away anyway?`)) return
    crew.call('dismiss', name).catch((err) => oops(`Couldn't send ${a ? displayName(a) : name} away`, err))
  }
  else if (act === 'markIdle') crew.call('markIdle', name)
  else if (act === 'edit') edit(name)
  else if (!act && place === 'terminals') highlight((selected = name))
})
$('.terms').addEventListener('dblclick', (e) => {
  const head = e.target.closest('.tile-head')
  if (head && !e.target.closest('button') && place === 'terminals') {
    selected = head.parentElement.dataset.name
    setLayout(layout === 'focus' ? 'grid' : 'focus')
  }
})

// ---- selection + views -----------------------------------------------------

// Which terminal is the one on: the dock's in a conversation, the one picked in Terminals.
function highlight(name) {
  for (const [n, t] of terms) t.tile.classList.toggle('on', n === name)
  freshen() // in Focus and in the dock, the one picked is the one on screen
}

// A terminal's header and actions are drawn while it's on screen: in Terminals, not filtered out of the grid, and in
// Focus only the one picked; in a conversation's dock, the one docked. The rest catch up as they come into view, so a
// state push doesn't redraw twenty headers nobody can see.
const tileShown = (t) => (place === 'terminals' && !t.tile.classList.contains('filtered') && (layout === 'grid' || t.tile.classList.contains('on'))) || (docked() && t.tile.classList.contains('on'))
function freshen() {
  for (const t of terms.values()) if (t.stale && t.agent && tileShown(t)) drawTile(t)
}

// Show an agent's terminal: your conversation with it, its terminal docked beside it. One that's off has no terminal:
// its conversation, with its switch in the header.
function select(name) {
  if (!terms.has(name) && !state.agents.some((a) => a.name === name)) name = familyOf(name) // a clone that has gone: its original
  openDM(name, { terminal: terms.has(name) })
  terms.get(dockName())?.term.focus()
}

// Its profile: the agent's sheet, over whatever is open (a clone is edited through its original).
function edit(name) {
  collection.open(state.agents.find((a) => a.name === name)?.cloneOf ?? name)
}

function setLayout(next) {
  layout = next
  store.set('crew.layout', layout)
  showPlace('terminals')
}

function drawBlank() {
  const on = state.agents.filter((a) => a.on && a.status !== 'parked').length
  $('.blank').classList.toggle('hidden', place !== 'terminals' || on > 0)
  const parked = state.parked && state.agents.some((a) => a.on)
  $('.blank h1').textContent = parked ? `${state.workspace.name} is parked` : state.agents.length ? 'All agents are off' : 'No agents yet'
  $('.blank .lead').textContent = parked ? 'Open it to start its agents: each picks up its conversation.' : state.agents.length ? 'Turn one on in Agents: it picks up its last session.' : 'Make your first one in Agents.'
  $('.blank .acts').classList.toggle('hidden', state.agents.length > 0) // Add your first agent, only when there's none
}

// The grid shows every terminal, the busy ones (working, starting or waiting on you), or the ones waiting on you; each
// with how many there are. The dock shows its own, whatever the grid's filter.
const busy = (a) => a && (a.status === 'working' || a.status === 'waiting' || a.status === 'starting')
const SHOW_NONE = {
  busy: ['Nobody is busy right now', 'A terminal shows here while its agent works.'],
  needs: ['Nobody needs you right now', 'A terminal shows here when its agent waits on you.'],
}
function drawShow() {
  segmented($('[data-show]'), (b) => b.dataset.show === show)
  const waiting = new Set(needsYou(state).map((x) => x.agent.name))
  const count = { all: terms.size, busy: 0, needs: 0 }
  const grid = place === 'terminals' && layout === 'grid'
  let shown = 0
  for (const [name, t] of terms) {
    const isBusy = busy(t.agent)
    const needs = waiting.has(name)
    count.busy += isBusy ? 1 : 0
    count.needs += needs ? 1 : 0
    const hide = grid && (show === 'busy' ? !isBusy : show === 'needs' ? !needs : false) // focus shows the one you picked
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
  if (grid && SHOW_NONE[show] && !shown && terms.size) {
    const [title, line] = SHOW_NONE[show]
    const html = `${ICONS.terminal}<b>${title}</b><span>${line}</span>`
    if (!none) $('.terms').insertAdjacentHTML('beforeend', `<div class="terms-none empty-state small" data-none="${show}">${html}</div>`)
    else if (none.dataset.none !== show) (none.dataset.none = show), (none.innerHTML = html)
  } else none?.remove()
}

$('.side-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-place]')
  if (b) goPlace(b.dataset.place)
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
// ⌘1 #crew, ⌘2 Agents, ⌘3 Tasks, ⌘4 Terminals; ⌘F searches the messages in #crew and a conversation (elsewhere it
// finds an agent), ⌘K finds an agent, ⌘N makes one (Ctrl on Windows, where Ctrl+F and Ctrl+N typed in a terminal are
// the agent's: windowsTerminalKey)
const KEYS = { 1: 'chat', 2: 'crew', 3: 'tasks', 4: 'terminals' }
document.addEventListener('keydown', (e) => {
  if (!commandKey(e)) return
  if (document.querySelector('.ed-layer.open, dialog[open]')) return // the agent's sheet or a dialog is in front
  if (KEYS[e.key] && !e.altKey && !e.shiftKey) return void (e.preventDefault(), goPlace(KEYS[e.key]))
  if (e.key === 'f' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), place === 'chat' || place === 'dm' ? openSearch() : place === 'tasks' ? tasks.search() : startFind())
  if (e.key === 'k' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), startFind())
  if (e.key === 'n' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), addAgent())
})

// ⌃1–9: the workspaces, in the switcher's order (a parked one opens). ⌃Tab and ⌃⇧Tab: the next and previous open one.
// On Windows, Alt+1–9 (Ctrl+1–4 are the views there) and Ctrl+Tab. Ahead of the terminals (capture), which would take ⌃1
// as a key of their own.
document.addEventListener('keydown', (e) => {
  const tab = e.key === 'Tab' && e.ctrlKey && !e.metaKey && !e.altKey
  if (!(tab || workspaceKey(e)) || document.querySelector('.ed-layer.open, dialog[open]')) return
  const list = state.workspaces ?? []
  if (list.length < 2) return // nothing to switch to: ⌃1 stays the terminal's
  if (tab) {
    const open = list.filter((w) => !w.parked || w.current)
    const at = open.findIndex((w) => w.current)
    const next = open[(at + (e.shiftKey ? -1 : 1) + open.length) % open.length]
    if (!next || next.current) return
    e.preventDefault()
    e.stopPropagation()
    return switchTo(next.id)
  }
  // the digit keys only: on Windows, Alt and the number pad type a character (Alt+0151 is —)
  const w = /^[1-9]$/.test(e.key) && (!ON_WINDOWS || e.code.startsWith('Digit')) && list[Number(e.key) - 1]
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
      oops(`Couldn't switch to ${list[to]?.name ?? 'that workspace'}`, err)
    }
  }
  slide(to < from ? -1 : 1, go)
}
// A workspace the sheet just made: already on screen in Crew, now here too.
function switched(next) {
  slide(1, async () => (push ??= await ready)(next))
  setTimeout(() => {
    const tile = $(`.rail-ws[data-ws="${CSS.escape(next.workspace?.id ?? '')}"] .ws-tile`)
    if (tile) burst(tile, { count: 9, color: wsColor(next.workspace) ?? undefined })
  }, 520)
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
  openMenu?.close() // a menu or the list of who works here was about the last one
  if (membersPop.matches(':popover-open')) membersPop.hidePopover()
  composer.setTarget('auto')
  const unsaved = collection.unsaved() // switched from the menu bar or a notification, with an agent's sheet open
  collection.close()
  if (unsaved) toast(`Closed ${unsaved} without saving: you switched to ${next.workspace.name}`, true)
  tasks.close()
}

// ---- the sidebar's agents: a conversation with each, by computer ---------------------------------------------------

// How it is, in a word, for the end of its line: what it's doing while it works ("editing", "testing"), otherwise
// "free", "starting", "off".
const DOING = [[/^(Planning|Writing up a plan)/, 'planning'], [/^Editing\b/, 'editing'], [/^Writing\b/, 'writing'], [/^Reading\b/, 'reading'], [/^Searching\b/, 'searching'], [/^Running the tests/, 'testing'], [/^Running\b/, 'running'], [/^Asking\b/, 'asking'], [/^Handing work/, 'handing off'], [/^Starting a sub-agent/, 'delegating'], [/^Drawing\b/, 'drawing']]
function doingWord(a) {
  if (!a.on) return a.status === 'parked' ? 'parked' : 'off'
  if (blockedOn(a)) return 'waiting'
  switch (a.status) {
    case 'working': {
      const what = a.activity ? activityWords(a.activity) : ''
      return DOING.find(([re]) => re.test(what))?.[1] ?? 'working'
    }
    case 'waiting': return 'needs you'
    case 'idle': return runningSubs(a).length ? 'helpers at work' : 'free'
    case 'starting': return 'starting'
    case 'away': return 'offline'
    case 'parked': return 'parked'
    default: return 'stopped'
  }
}

// One line: its creature, its name (YOLO, how many clones), then what needs you from it and its clones (berry), new
// replies (a quiet count), or how it is.
function dmRow(a, { selected = false, clones = [], needs = 0, drag = false }) {
  const unread = [a, ...clones].reduce((n, x) => n + (x.unread ?? 0), 0)
  const tip = [`${a.seed ?? a.name}${a.area ? ` · ${a.area}` : ''}`, upFirst(statusText(a)), brainLabel(a, state.providers), clones.length ? `${plural(clones.length, 'clone')} at work` : '', a.queue ? `${a.queue} queued` : ''].filter(Boolean).join('\n')
  const end = needs ? `<i class="need-badge" title="${esc(`${needs} waiting on you`)}">${needs}</i>`
    : unread ? `<i class="dm-new" title="${esc(plural(unread, 'new reply', 'new replies'))}">${unread > 9 ? '9+' : unread}</i>`
    : `<span class="dm-word">${esc(doingWord(a))}</span>`
  return `<div class="dm ${a.on ? a.status : 'off'}${selected ? ' on' : ''}${needs ? ' needs' : ''}${unread ? ' fresh' : ''}" data-agent="${esc(a.name)}" role="button" tabindex="0" ${drag ? 'draggable="true"' : ''} title="${esc(tip)}" style="--c:${agentColor(a)}">
    <span class="dm-av">${avatarHTML(a, { size: 26 })}</span>
    <span class="dm-name"><b>${esc(a.seed ?? a.name)}</b>${a.yolo ? '<i class="mark-yolo" title="YOLO: skips every permission prompt">YOLO</i>' : ''}${clones.length ? `<span class="dm-clones">+${clones.length}</span>` : ''}</span>
    <span class="dm-end">${end}</span>
  </div>`
}

// Agents grouped by the computer they run on once there's more than one (fold one away with a click on its name), each
// group in your own order with the ones that are off at its end. In parts for morph(): a section per computer.
function dmParts(state, { folds = new Set(), selected, filter = '', drag = false } = {}) {
  const q = filter.trim().toLowerCase()
  const match = (a) => !q || `${a.seed ?? a.name} ${a.area ?? ''}`.toLowerCase().includes(q)
  const groups = crewGroups(state)
  const headed = grouped(groups)
  const needs = new Map()
  for (const n of needsYou(state)) needs.set(familyOf(n.agent.name), (needs.get(familyOf(n.agent.name)) ?? 0) + 1)
  const parts = groups.map((g) => {
    const agents = g.agents.filter(match)
    if ((q || !headed) && !agents.length) return null
    const folded = headed && !q && folds.has(`group:${g.key}`)
    const waiting = agents.reduce((n, a) => n + (needs.get(a.name) ?? 0), 0)
    const head = headed
      ? `<div class="cg-label" data-fold="group:${esc(g.key)}" title="${esc(g.here ? `${g.name}: ${THIS_COMPUTER}` : `${g.name}: ${g.online ? 'linked' : 'unreachable, it reconnects on its own'}`)}"><span class="chev">${ICONS.chevron}</span><span>${esc(g.name)}</span>${g.online ? '' : '<span class="cg-tag">· offline</span>'}${folded && waiting ? `<span class="grow"></span><i class="need-badge">${waiting}</i>` : ''}</div>`
      : ''
    const rows = [...agents.filter((a) => a.on), ...agents.filter((a) => !a.on)].map((a) => dmRow(a, { selected: a.name === selected, clones: g.clones.filter((c) => c.cloneOf === a.name && c.on), needs: needs.get(a.name) ?? 0, drag: drag && headed }))
    const empty = !agents.length ? [`<div class="roster-none">${g.online ? 'No agents here yet' : 'No agents'}</div>`] : []
    return { start: `<section class="cgroup ${folded ? 'folded' : ''} ${g.online ? '' : 'away'}" data-home="${esc(g.key)}">${head}<div class="cgroup-body">`, end: '</div></section>', slot: '.cgroup-body', parts: folded ? [] : [...rows, ...empty] }
  }).filter(Boolean)
  return parts.length ? parts : [`<div class="roster-none">${q ? `No one matches “${esc(filter.trim())}”` : 'No agents yet'}</div>`]
}

// Not while you're dragging a row: a redraw would drop the drop targets (and could replace the row you hold).
let rosterStale = false
function drawRoster() {
  if (dragging) return void (rosterStale = true)
  rosterStale = false
  const open = place === 'dm' ? dmAgent()?.name : null
  morph($('.roster'), dmParts(state, { folds, selected: open, filter: find, drag: true }))
  const count = state.agents.filter((a) => !a.cloneOf).length
  $('[data-find]').placeholder = count > 1 ? `Find among ${count} agents` : 'Find an agent'
  if (dragging) document.querySelector(`.roster .dm[data-agent="${CSS.escape(dragging.name)}"]`)?.classList.add('dragging')
  if (cursor) document.querySelector(`.roster .dm[data-agent="${CSS.escape(cursor)}"]`)?.classList.add('cursor')
}
let cursor = null // the search's marked match, kept across redraws

function toggleFold(key) {
  folds.has(key) ? folds.delete(key) : folds.add(key)
  store.set('crew.folds', JSON.stringify([...folds]))
  // the rows under it glide up or down to make room, and what it opens fades in (never a height animated)
  glide(() => $('.roster').querySelectorAll('.cg-label, .cgroup-body > *'), () => drawRoster(), { appear: true })
}

// Find (⌘F, or the search button by Direct): the label becomes a field that narrows the list; ↑↓ move through the
// matches, Enter opens the one marked (the first, until you move), Esc puts it away.
const findBox = $('[data-find]')
const sec = $('.side-sec')
function startFind() {
  sec.classList.add('finding')
  findBox.focus()
  findBox.select()
}
function stopFind() {
  findBox.value = find = ''
  cursor = null
  sec.classList.remove('finding')
  drawRoster()
}
$('[data-act=find]').addEventListener('click', startFind)
findBox.addEventListener('input', () => {
  find = findBox.value
  cursor = null
  drawRoster()
})
findBox.addEventListener('blur', () => {
  cursor = null
  document.querySelector('.roster .dm.cursor')?.classList.remove('cursor')
  if (!findBox.value) stopFind()
})
findBox.addEventListener('keydown', (e) => {
  const rows = [...document.querySelectorAll('.roster .dm')]
  const at = rows.findIndex((r) => r.classList.contains('cursor'))
  if (e.key === 'Escape') {
    e.preventDefault()
    stopFind()
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
    stopFind()
    findBox.blur()
    openDM(row.dataset.agent)
    composer.focus()
  }
})

// A click opens your conversation with it; a double-click, with its terminal beside it.
$('.roster').addEventListener('click', (e) => {
  const fold = e.target.closest('[data-fold]')
  if (fold) return toggleFold(fold.dataset.fold)
  const row = e.target.closest('.dm')
  if (!row || e.detail > 1) return
  openDM(row.dataset.agent)
  composer.focus()
})
$('.roster').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.dm')
  if (row && terms.has(row.dataset.agent)) select(row.dataset.agent)
})
$('.roster').addEventListener('keydown', (e) => {
  const row = e.target.closest('.dm')
  if (!row || (e.key !== 'Enter' && e.key !== ' ')) return
  e.preventDefault()
  openDM(row.dataset.agent)
  composer.focus()
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
      if (act === 'message') (openDM(name), composer.focus())
      if (act === 'terminal') select(name)
      if (act === 'edit') edit(name)
      if (act === 'dismiss' && (!busy(a) || confirm(`${displayName(a)} is in the middle of something. Send it away anyway?`))) crew.call('dismiss', name).catch((err) => oops(`Couldn't send ${displayName(a)} away`, err))
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
    const who = a.seed ?? a.name
    const doing = { fresh: `Couldn't start a new conversation for ${who}`, power: `Couldn't turn ${who} ${a.on ? 'off' : 'on'}`, remove: `Couldn't remove ${who}` }[act] ?? (act.startsWith('join:') ? `Couldn't add ${who} to that workspace` : `Couldn't do that for ${who}`)
    try {
      if (act === 'message') {
        openDM(name)
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
      oops(doing, err)
    }
  })
}
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.roster .dm, .pcard[data-name], .tile-head, .dock-tab, .page-head[data-for=chat] .ph-glyph .av, .page-head[data-for=chat] .ph-name')
  if (!el) return
  e.preventDefault()
  agentMenu(el.dataset.agent ?? el.dataset.name ?? el.dataset.dock ?? el.closest('.tile')?.dataset.name ?? dmAgent()?.name, { x: e.clientX, y: e.clientY })
})

// Drag an agent onto another computer to move it there (the move sheet asks where its folder is).
let dragging = null
const roster = $('.roster')
roster.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.dm')
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

for (const b of document.querySelectorAll('[data-act=add]')) b.addEventListener('click', addAgent)

// ---- the sidebar's foot: the account's usage (click for every limit), and ⋯ ---------------------------------------

// The account closest to its limit, its fullest window as a bar. Berry only when it will run out before it resets, at
// this pace. A dot on ⋯ when a linked computer can't be reached (Computers says which).
function drawFoot(state) {
  const c = state.computers ?? { me: {}, links: [] }
  const away = c.links.filter((l) => !l.online)
  $('.side-more').classList.toggle('warn', away.length > 0)
  $('.side-more').title = `Autopilot, Computers, Claude Code and Codex, theme${away.length ? `\n${away.map((l) => l.name).join(', ')} can't be reached` : ''}`
  const accounts = Object.values(state.usage ?? {}).filter((u) => u.windows?.length)
  const use = $('.use-line')
  use.classList.toggle('none', !accounts.length)
  if (!accounts.length) return
  const fullest = (u) => Math.max(...u.windows.map((w) => w.pct))
  const top = accounts.find((u) => paceWarning(u)) ?? [...accounts].sort((x, y) => fullest(y) - fullest(x))[0]
  const pct = fullest(top)
  const warn = paceWarning(top)
  use.classList.toggle('warm', Boolean(warn))
  use.title = `${accounts.map(usageTip).join('\n\n')}${warn ? `\n\n${top.label}: ${warn}` : ''}`
  morph(use, `<span>${esc(top.label)}</span><i class="use-bar"><i style="width:${Math.min(100, Math.max(pct, 3))}%"></i></i><span>${pct}%</span>`)
  if (usePop.matches(':popover-open')) drawUsePop()
}

// A click on the usage line: every account's limits, one line each, and when one runs out at this pace.
const usePop = $('.use-pop')
function drawUsePop() {
  morph(usePop, Object.entries(state.usage ?? {}).filter(([, u]) => u.windows?.length).map(([provider, u]) => {
    const warn = paceWarning(u)
    return `<div class="up-row">${usageLine({ provider }, state)}<small class="${warn ? 'warn' : ''}">${esc(warn || u.windows.map((w) => `${w.pct}% ${resetsText(w.resetsAt)}`).join(' · '))}</small></div>`
  }).join(''))
}
// The line is its invoker (popovertarget), so a second click closes it and a click anywhere else does too.
usePop.addEventListener('beforetoggle', (e) => {
  if (e.newState !== 'open') return
  drawUsePop()
  const r = $('.use-line').getBoundingClientRect()
  usePop.style.left = `${Math.round(r.left)}px`
  usePop.style.bottom = `${Math.round(innerHeight - r.top + 6)}px`
})

function addAgent() {
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
  goPlace('tasks')
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
  if (!terms.has(selected)) selected = on[0]?.name ?? null
  feed.render(state)
  composer.render(state) // first: it may move the conversation (a clone gone, an agent moved), which redraws the place
  showPlace(place) // the dock (a terminal that came or went), the header, the sidebar, the filters' counts
  followRename()
  collection.render(state)
  tasks.render(state)
  setup.render(state)
  drawNav()
  if (membersPop.matches(':popover-open')) drawMembers()
  celebrate($('.roster'), state.agents) // after the rows, so a visible one gets the confetti
})

// The places' counts: Tasks waiting for your review (berry), or else how many are open.
function drawNav() {
  const badge = tasks.badge(state)
  const el = $('.nv[data-place=tasks] .nv-n')
  const html = badge.review ? `<span class="need-badge">${badge.review}</span>` : badge.open ? String(badge.open) : ''
  morph(el, html)
  el.title = badge.review ? `${badge.review} waiting for your review` : badge.open ? `${badge.open} open` : ''
}

// ---- Computers (Crew Link) -------------------------------------------------------

const linkDialog = $('#link')
let linkKey = ''
let fresh = null // a computer just linked: its agents are shown to pick from
let linkErr = '' // kept across redraws until the next try
// what's unfolded: this computer's security details, each linked computer's agents, the paste-a-code form; and "Copied" for a moment
const linkOpen = { details: false, computers: new Set(), form: false, copied: false, detailsCopied: false }
let copiedTimer = null

function drawComputers(state) {
  const c = state.computers ?? { me: {}, links: [] }
  drawPairing(c.phones)
  const next = JSON.stringify([c, fresh, linkErr, phoneFresh, phoneErr, linkOpen, [...linkOpen.computers]])
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

// This computer (its name, sharing, the code to copy, and how safe it is behind that), the linked computers, the
// paste-a-code form when it's asked for, and phones. The code itself, the addresses and the port aren't shown: Copy link
// code is what you need, and Copy connection details has the rest for when something doesn't connect.
function computersHTML({ me, links, phones }) {
  const mine = `
    <div class="lk-li"><span class="lk-ic">${machineIcon(me.name)}</span><div class="lk-k">
      <input class="me-name" data-me-name value="${esc(me.name)}" spellcheck="false" title="${esc(upFirst(THIS_COMPUTER))}'s name: click to rename it. Linked computers see its agents as name@${esc(me.slug)}">
      <small>${plural(me.agents ?? 0, 'agent')} run here</small></div></div>
    <label class="lk-li lk-sw"><div class="lk-k">Let your other computers link to this one</div><input type="checkbox" class="switch" data-link-share ${me.sharing ? 'checked' : ''}></label>
    ${me.sharing ? `
      <div class="lk-li"><button class="btn primary lk-copy" data-link-copy title="Anyone with this code can use and drive your agents, so keep it to your own computers">${linkOpen.copied ? `${ICONS.check}Copied` : `${ICONS.copy}Copy link code`}</button>
        <span class="lk-note"><b>Ready to link.</b> Paste the code on your other computer, under Link a computer.</span></div>
      ${me.warning ? `<div class="lk-li"><p class="err">${esc(me.warning)}</p></div>` : ''}
      <button class="lk-li lk-more" data-lk-details aria-expanded="${linkOpen.details}"><span>Security and a new code</span>${LINK_CHEV}</button>
      ${linkOpen.details ? `<div class="lk-details">
        <p>Anyone with the link code can use and drive your agents, so keep it to your own computers. Linked computers see these agents as <b>name@${esc(me.slug)}</b>.</p>
        <p>${esc(reachText(me.hosts))}</p>
        <div class="lk-row"><span>A new code disconnects the computers using this one, until they link again.</span><span class="lk-btns"><button class="btn sm" data-link-details-copy title="This computer's addresses and port, for when a computer can't connect">${linkOpen.detailsCopied ? 'Copied' : 'Copy connection details'}</button><button class="btn sm" data-link-reset>New code</button></span></div>
      </div>` : ''}`
    : me.error ? `<div class="lk-li"><p class="err">${esc(sharingError(me.error))}</p></div>` : ''}`
  const form = linkOpen.form || linkErr ? `
    <div class="section-label">Link a computer</div>
    <div class="group-list"><div class="lk-form">
      <p>Paste the code from the other computer's <b>Copy link code</b>. Linking works both ways: each computer sees the other's agents.</p>
      <div class="code-in"><textarea class="field" data-link-code rows="2" placeholder="crew1.…" spellcheck="false"></textarea><button class="btn primary" data-link-connect>Link</button></div>
      <p class="err" data-link-err>${esc(linkErr)}</p>
    </div></div>` : ''
  return `<div class="section-label">${upFirst(THIS_COMPUTER)}</div><div class="group-list">${mine}</div>
    <div class="section-label">Linked</div>
    <div class="group-list">${links.length ? links.map(linkHTML).join('') : '<div class="lk-li lk-empty">No other computers yet. Copy the link code on one, then Link a computer… here.</div>'}</div>
    ${form}
    <div class="section-label">Phones</div>
    ${phonesHTML(phones ?? { devices: [] })}`
}

// Why this computer can't share, in words. A port another app has is the usual one, and there's no setting for the port
// on screen (it's in Crew's settings file), so it says what you can do instead.
const sharingError = (error) => (/port \d+ is in use/.test(error)
  ? `Another app is using the port ${PRODUCT_NAME} Link listens on, so this computer can't share right now. Quit that app and turn sharing off and on again.`
  : errorReason(error) || `${PRODUCT_NAME} couldn't start sharing this computer. Turn it off and on again.`)
// How others reach this computer, in words: "Reachable over your local network and Tailscale."
function reachText(hosts = []) {
  const ways = [...new Set(hosts.map((h) => (/tailscale/i.test(h.via) ? 'Tailscale' : 'your local network')))]
  return ways.length ? `Reachable over ${ways.join(' and ')}.` : 'Not reachable over a network right now: check this computer is on Wi-Fi or Ethernet.'
}
// For Copy connection details: what someone helping you would ask for.
const connectionDetails = (me) => [`${me.name} (${me.slug}), ${PRODUCT_NAME} Link port ${me.port}`, ...(me.hosts ?? []).map((h) => `${h.address} (${h.via})`)].join('\n')

// How a linked computer is: "Online · local network · 7 agents", or "Offline · 3 agents" (why, on hover).
function linkStatus(l) {
  const used = l.agents.filter((a) => !a.hidden).length
  const count = used < l.agents.length ? `${used} of ${plural(l.agents.length, 'agent')}` : plural(l.agents.length, 'agent')
  if (!l.online) return { text: `Offline · ${count}`, tip: `${l.status?.error ?? 'Unreachable'}: it reconnects on its own` }
  const addr = l.status?.address
  const via = !addr ? `linked to ${THIS_COMPUTER}` : /\.ts\.net$/.test(addr) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(addr) ? 'Tailscale' : 'local network'
  return { text: `Online · ${via} · ${count}`, tip: addr ? `Linked via ${addr}` : `It linked to ${THIS_COMPUTER}` }
}

// A linked computer: one row (its faces, how it is); its chevron unfolds its agents, to tick the ones to use from here
// or bring one over to run here, and Forget.
function linkHTML(l) {
  const open = linkOpen.computers.has(l.slug)
  const status = linkStatus(l)
  const shown = l.agents.filter((a) => !a.hidden)
  const used = shown.length
  return `<section class="lk-pc ${fresh === l.slug ? 'fresh' : ''}" data-computer="${esc(l.slug)}">
    <button class="lk-li" data-lk-open="${esc(l.slug)}" aria-expanded="${open}">
      <span class="lk-ic">${machineIcon(l.name)}</span>
      <span class="lk-k">${esc(l.name)}<small title="${esc(status.tip)}"><span class="dot ${l.online ? 'working' : 'away'}"></span>${esc(status.text)}</small></span>
      ${l.agents.length ? faceStack(shown.length ? shown : l.agents, 4) : ''}
      ${LINK_CHEV}
    </button>
    ${open ? `<div class="lk-body">
      ${fresh === l.slug ? `<p><b>Pick which of ${esc(l.name)}'s agents to use here.</b> The rest keep running there. Move one here to run it on ${THIS_COMPUTER} instead.</p>` : ''}
      ${l.agents.length ? `<ul class="lk-agents">${l.agents.map((a) => `
        <li class="${a.hidden ? 'unused' : ''}">${avatarHTML(a, { size: 30, mood: 'still' })}
          <span class="who"><b>${esc(a.seed)}</b><small>${esc(a.area || 'no area')}</small></span>
          ${l.online ? `<button class="btn sm lk-move" data-move="${esc(a.name)}" title="Run it on another computer, with its conversation, instructions, look and work experience">${ICONS.move}Move to…</button>` : ''}
          <label class="use"><input type="checkbox" class="switch" data-use="${esc(a.name)}" ${a.hidden ? '' : 'checked'}>Use</label>
        </li>`).join('')}</ul>` : `<p>${l.online ? 'No agents there yet.' : 'Its agents show here once it\'s back.'}</p>`}
      <div class="lk-row"><span title="Move one with its Move to…, or drag it onto a computer in the sidebar">${l.agents.length > 1 ? `Using ${used} of ${l.agents.length}` : ''}</span>
        <span class="lk-btns">${l.agents.length > 1 ? `<button class="btn sm" data-use-all="${esc(l.slug)}">All</button><button class="btn sm" data-use-none="${esc(l.slug)}">None</button>` : ''}${l.saved ? `<button class="btn sm" data-forget="${esc(l.slug)}" title="Unlink it from ${THIS_COMPUTER}">Forget</button>` : ''}</span></div>
    </div>` : ''}
  </section>`
}

// ---- Phones (core/phones.js): the Crew app on your phone, paired with a code it scans ----------------------------
// Add a phone turns the dialog into the pairing view: one big code to scan, and nothing to keep an eye on. A code ends
// after ten minutes, so the view asks for a new one a minute before (the QR just changes), until a phone pairs with it
// or the view closes, which ends it.

let phonePair = null // the pairing view while it's open: { made, code, qr, expires, renewAt, making, err, copied, phone }
let phoneFresh = null // the phone that just paired: highlighted in the list
let phoneErr = ''
let pairTick = null

function phonesHTML(p) {
  const err = phoneErr || p.error || p.warning
  return `<section class="group-list phones">
    <div class="lk-li"><p class="lk-note">The chat and the questions agents wait on you for, in the ${PRODUCT_NAME} app on your phone, over the same Wi-Fi or Tailscale.</p>
      <button class="btn" data-phone-add>Add a phone</button></div>
    ${p.devices.map(phoneHTML).join('')}
    ${err ? `<div class="lk-li"><p class="err">${esc(err)}</p></div>` : ''}
  </section>`
}

function phoneHTML(d) {
  const kind = { ios: 'iPhone', android: 'Android' }[d.platform] ?? 'Phone'
  const seen = d.online ? 'Connected' : phoneDay(d.seen) === 'today' ? `Seen at ${new Date(d.seen).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `Seen ${phoneDay(d.seen)}`
  return `<div class="lk-li lk-phone ${d.id === phoneFresh ? 'fresh' : ''}" data-phone="${esc(d.id)}">
    <span class="lk-ic">${ICONS.phone}</span>
    <span class="lk-k">${esc(d.name)}<small>${kind}${d.app ? ` · ${PRODUCT_NAME} ${esc(d.app)}` : ''} · paired ${phoneDay(d.paired)}</small></span>
    <span class="ph-seen"><span class="dot ${d.online ? 'working' : 'away'}"></span>${seen}</span>
    <button class="btn sm" data-phone-remove="${esc(d.id)}">Remove</button>
  </div>`
}

// 'today', 'yesterday' or '12 Oct'
function phoneDay(ts) {
  const day = (t) => new Date(t).toDateString()
  if (day(ts) === day(Date.now())) return 'today'
  if (day(ts) === day(Date.now() - 864e5)) return 'yesterday'
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

async function phoneAction(t) {
  if (t.closest('[data-phone-add]')) return openPairing()
  const remove = t.closest('[data-phone-remove]')?.dataset.phoneRemove
  const phone = remove && state.computers.phones.devices.find((d) => d.id === remove)
  if (phone && confirm(`Remove ${phone.name}? It can't reach ${THIS_COMPUTER} any more, until you pair it again.`)) await crew.call('phones', 'revoke', remove)
}

// The QR card: as big as the window leaves room for, high in the dialog so the phone looks straight at it. The code's
// modules land on whole screen pixels (one drawn between them blurs, and a blurry code is what makes a phone hunt), and
// the card's white margin round it, at least four modules, is the quiet zone a camera needs, in dark mode too.
function qrFit(qr) {
  const card = Math.max(220, Math.min(336, innerHeight - 300))
  const n = Number(/viewBox="0 0 (\d+)/.exec(qr ?? '')?.[1]) || 0
  const px = devicePixelRatio || 1
  return { card, size: n && (n * Math.floor((card * px) / (n + 8))) / px }
}

function pairHTML(v) {
  const { card, size } = qrFit(v.qr)
  const look = v.phone ? 'paired' : v.err ? 'off' : v.qr ? '' : 'wait'
  const line = v.phone ? `<b>${esc(v.phone.name)}</b> is paired` : v.err ? esc(v.err.charAt(0).toUpperCase() + v.err.slice(1)) : `Scan this with ${PRODUCT_NAME} on your phone`
  return `<h2 class="sheet-title">${ICONS.phone}Add a phone</h2>
    <div class="pv-card ${look}" style="--card: ${card}px; --qr: ${size}px">${v.err && !v.phone ? `<span class="pv-off">${ICONS.phone}</span>` : v.qr ?? ''}${v.phone ? `<span class="pv-done">${ICONS.check}</span>` : ''}</div>
    <p class="pv-line ${v.err && !v.phone ? 'failed' : ''}" aria-live="polite">${line}</p>
    <div class="sheet-foot">
      ${v.err && !v.phone ? `<button class="btn pv-act" data-pair-retry ${v.making ? 'disabled' : ''}>${ICONS.restart}${v.making ? 'Trying…' : 'Try again'}</button>`
        : `<button class="btn pv-act" data-pair-copy ${v.code && !v.phone ? '' : 'disabled'} ${v.phone ? 'hidden' : ''} title="To paste it in ${PRODUCT_NAME} on your phone instead">${v.copied ? `${ICONS.check}Copied` : `${ICONS.copy}Copy code`}</button>`}
      <span class="grow"></span><button class="btn pv-close" data-pair-close>${v.phone ? 'Done' : 'Cancel'}</button>
    </div>`
}

// The view as it is now. A phone that paired with its code (any of them): the view says so, then hands over to the
// list with that phone highlighted.
function drawPairing(phones) {
  const view = phonePair
  const paired = view && !view.phone && phones?.devices.find((d) => d.paired >= view.made)
  if (paired) {
    view.phone = { id: paired.id, name: paired.name }
    phoneFresh = paired.id
    clearInterval(pairTick)
    crew.call('phones', 'cancel').catch(() => {}) // its code is used up; one renewed just as it paired ends here
    setTimeout(() => phonePair === view && closePairing(), 1800)
  }
  linkDialog.classList.toggle('pairing', Boolean(view))
  if (view) morph(linkDialog.querySelector('.pair-view'), pairHTML(view))
  if (paired && !linkDialog.contains(document.activeElement)) linkDialog.querySelector('.pair-view').focus({ preventScroll: true }) // Copy code, which had it, steps aside
}

function openPairing() {
  phonePair = { made: Date.now(), renewAt: Infinity }
  phoneFresh = null
  phoneErr = ''
  // the clock is checked rather than one timer set: a Mac that slept, or a window in the background, still renews in time
  clearInterval(pairTick)
  pairTick = setInterval(() => phonePair?.renewAt <= Date.now() && pairCode(), 1000)
  drawComputers(state)
  linkDialog.querySelector('.pair-view').focus({ preventScroll: true })
  pairCode()
}

// A code for the view: its first, the next one before that one ends, or another try after an error. -> that request,
// or the one already under way.
function pairCode() {
  const view = phonePair
  if (!view || view.phone) return Promise.resolve()
  if (!view.making) {
    view.making = makeCode(view)
    drawComputers(state) // Try again says it's trying
  }
  return view.making
}

async function makeCode(view) {
  try {
    const made = await crew.call('phones', 'code')
    if (phonePair === view && !view.phone) {
      const left = made.expires - Date.now()
      Object.assign(view, made, { err: '', renewAt: made.expires - Math.min(60000, left / 6) })
    } else if (!phonePair || phonePair === view) {
      crew.call('phones', 'cancel').catch(() => {}) // the view closed, or a phone paired, while this one was being made
    }
  } catch (x) {
    if (phonePair === view) Object.assign(view, { code: null, qr: null, err: errorLine(x, `${PRODUCT_NAME} couldn't make a code for your phone. Try again.`), renewAt: Infinity })
  } finally {
    view.making = null
    drawComputers(state)
  }
}

// Back to the list, which is where it was: a code still open ends here, and a phone that just paired is in view.
function closePairing() {
  const view = phonePair
  if (!view) return
  phonePair = null
  clearInterval(pairTick)
  if (!view.phone) crew.call('phones', 'cancel').catch(() => {})
  drawComputers(state)
  if (!linkDialog.open) return
  linkDialog.classList.add('back')
  setTimeout(() => linkDialog.classList.remove('back'), 400)
  linkDialog.querySelector(view.phone ? `[data-phone="${CSS.escape(view.phone.id)}"]` : '.phones')?.scrollIntoView({ block: 'nearest' })
  linkDialog.querySelector('[data-phone-add]')?.focus({ preventScroll: true })
}

async function pairAction(t) {
  const view = phonePair
  if (!view) return
  if (t.closest('[data-pair-close]')) return closePairing()
  if (t.closest('[data-pair-retry]')) return pairCode()
  if (t.closest('[data-pair-copy]') && view.code) {
    // a code to paste on the phone has a few minutes in it: one that's renewed soon is renewed first
    if (view.renewAt - Date.now() < 4 * 60000) await pairCode()
    if (phonePair !== view || !view.code) return
    await crew.call('copy', view.code)
    view.copied = true
    drawComputers(state)
    clearTimeout(view.copiedTimer)
    view.copiedTimer = setTimeout(() => ((view.copied = false), drawComputers(state)), 1600)
  }
}

// The QR card fits the window, and its modules the screen's pixels: on a resize, and on a move to a display of another
// scale, which fires no resize.
const refitPairing = () => phonePair && drawComputers(state)
addEventListener('resize', refitPairing)
function watchScale() {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => (refitPairing(), watchScale()), { once: true })
}
watchScale()

function openComputers() {
  fresh = null
  linkErr = ''
  Object.assign(linkOpen, { details: false, form: false, copied: false, detailsCopied: false })
  linkOpen.computers.clear()
  phoneFresh = null
  phoneErr = ''
  linkKey = ''
  drawComputers(state)
  linkDialog.showModal()
}

linkDialog.addEventListener('click', async (e) => {
  const t = e.target
  if (t.closest('[data-close]') || t === linkDialog) return linkDialog.close()
  const linked = (slug) => state.computers.links.find((l) => l.slug === slug)
  const fail = (text) => {
    linkErr = text
    drawComputers(state)
  }
  if (t.closest('.phones')) return phoneAction(t).catch((x) => ((phoneErr = errorLine(x)), drawComputers(state)))
  if (t.closest('.pair-view')) return pairAction(t)
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
    if (t.closest('[data-link-details-copy]')) {
      await crew.call('copy', connectionDetails(state.computers.me))
      linkOpen.detailsCopied = true
      drawComputers(state)
      setTimeout(() => ((linkOpen.detailsCopied = false), drawComputers(state)), 1800)
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
      popMenu(move, [{ head: 'Move to' }, ...places.map((g) => ({ label: g.name, icon: g.here ? ICONS.desktop : ICONS.laptop, act: g.key || ':here', disabled: !g.online, hint: g.here ? THIS_COMPUTER : g.online ? '' : 'offline' }))], (home) => {
        linkDialog.close()
        moveSheet(name, home === ':here' ? '' : home)
      })
    }
  } catch (x) {
    fail(errorLine(x))
  }
})
linkDialog.addEventListener('change', async (e) => {
  const d = e.target.dataset
  // said before the redraw below puts the switch back the way it was
  const what = 'linkShare' in d ? `Couldn't ${e.target.checked ? 'start' : 'stop'} sharing ${THIS_COMPUTER}` : 'meName' in d ? `Couldn't rename ${THIS_COMPUTER}` : "Couldn't change which agents you use"
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
    oops(what, x)
  }
})
linkDialog.addEventListener('keydown', (e) => e.key === 'Enter' && e.target.matches('[data-me-name]') && e.target.blur())
// Esc in the pairing view goes back to the list. On keydown, since Chromium lets a dialog's cancel be stopped only so
// often before it closes the dialog anyway; cancel covers an Esc from outside it. Closing the dialog ends the pairing.
linkDialog.addEventListener('keydown', (e) => e.key === 'Escape' && phonePair && (e.preventDefault(), closePairing()))
linkDialog.addEventListener('cancel', (e) => phonePair && (e.preventDefault(), closePairing()))
linkDialog.addEventListener('close', closePairing)

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
    <h2 class="sheet-title">Move ${who} to ${esc(to.name)}</h2>
    <div class="mv-route" style="--c:${agentColor(a)}">
      <span class="mv-pc">${from.here ? ICONS.desktop : ICONS.laptop}<b>${esc(from.name)}</b></span>
      <span class="mv-path"><i></i><span class="mv-av">${avatarHTML(a, { size: 46 })}</span><i></i></span>
      <span class="mv-pc to">${to.here ? ICONS.desktop : ICONS.laptop}<b>${esc(to.name)}</b></span>
    </div>
    <label class="mv-folder"><span>Folder on ${esc(to.name)}</span>
      <span class="mv-field field"><input data-mv-folder value="${esc(moving.folder)}" spellcheck="false" autocomplete="off">${to.here ? '<button class="btn" data-mv-pick>Choose…</button>' : ''}</span>
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
    const short = (f) => (f.label === 'home folder' ? 'Home' : pathParts(f.path).pop() || f.path)
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
      ? `${who} moved to ${to}. Its conversation couldn't come along (${res.older ? `${to} runs an older ${PRODUCT_NAME}` : res.reason ?? 'not found'}), so it starts a new one there.`
      : `${who} moved to ${to}, conversation and all.`, res?.conversation === 'fresh')
  } catch (x) {
    if (moving !== m) return oops(`Couldn't move ${m.name.split('@')[0]}`, x)
    err.textContent = errorLine(x)
    go.disabled = false
    go.textContent = 'Try again'
  }
})
moveDialog.addEventListener('close', () => (moving = null))

// A note at the bottom of the window for things that happened out of view (notify, in common.js).
const toast = (text, warn = false) => notify(text, { warn })

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
    oops(`Couldn't open ${dropped?.name ?? 'that file'}`, x, `Pick a .crew file someone exported from ${PRODUCT_NAME}.`)
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
      <div class="imp-what"><input type="text" class="imp-name field" data-name value="${esc(a.name)}" spellcheck="false" title="Its name here"><small title="${esc(a.area)}">${esc(a.area || 'no area')} · ${esc(brain(a))}${a.yolo ? ' · YOLO' : ''}${a.images ? ` · ${a.images} reference image${a.images > 1 ? 's' : ''}` : ''}</small></div>
      <div class="imp-fields">
        <input type="text" class="imp-folder field" data-folder placeholder="Folder (home if empty)${a.folder ? `, it worked in …/${esc(a.folder)}` : ''}" spellcheck="false">
        ${places.length > 1 ? `<select class="field" data-home title="Which computer it runs on">${places.map((p) => `<option value="${esc(p.slug)}">on ${esc(p.name)}</option>`).join('')}</select>` : ''}
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
    goPlace('crew')
    if (added.length === 1) collection.open(added[0])
  } catch (x) {
    importDialog.querySelector('[data-import-err]').textContent = errorLine(x)
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

booted = true
ready.then(() => {
  showPlace(state.agents.length ? place : 'crew')
  handleFocus(new URLSearchParams(location.search).get('focus'))
})

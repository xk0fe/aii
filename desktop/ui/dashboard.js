// Full-screen view, laid out like a group chat: the sidebar (the workspace, its places, and a conversation with each
// agent) and what's open: a channel (#general or one you made), one agent's conversation with its terminal docked beside it,
// Agents, Tasks or Terminals.
/* global pageHead, headTitle, mountSearch, glide, reduceMotion, EASE, DUR, isUnread, mountWorkspaces, shortPath, pathParts, keys, keysIn, commandKey, workspaceKey, ON_WINDOWS, THIS_COMPUTER, upFirst, notify, oops, errorReason, errorLine, burst, wsColor, wsTile, wsLabel, statusClass, displayName, contextRing, ctxLevel, mountTasks, crew, live, store, morph, modeMarks, modeChips, powerSwitch, statusText, brainShort, brainLabel, brainWords, crewGroups, grouped, segmented, celebrate, agentColor, markSVG, mountFeed, mountComposer, mountCollection, avatarHTML, esc, plural, popMenu, ICONS, svg, Terminal, FitAddon, needsYou, needText, clonesOf, cloneTag, runningSubs, blockedOn, activityWords, isConvo, familyOf, nameHTML, hasWorkspaces, paceWarning, usageTip, usageLine, usageByComputer, resetsText, modelName, PRODUCT_NAME, mountSetup, faceStack, computerIcon */

const $ = (s) => document.querySelector(s)
const THEME = {
  background: '#0f1012', foreground: '#e4e4e7', cursor: '#e4e4e7', cursorAccent: '#0f1012', selectionBackground: 'rgba(122, 162, 255, 0.3)',
  black: '#1d1f21', red: '#ff6b6b', green: '#4cd38a', yellow: '#ffd166', blue: '#7aa2ff', magenta: '#c58cff', cyan: '#36cfc9', white: '#d4d4d8',
  brightBlack: '#5c5f66', brightRed: '#ff8787', brightGreen: '#69db9a', brightYellow: '#ffe08a', brightBlue: '#9bb8ff', brightMagenta: '#d6a8ff', brightCyan: '#5fe0da', brightWhite: '#fafafa',
}

const terms = new Map() // name -> { tile, head, term, fit, ready }
let booted = false // the composer says who it's aimed at as it mounts, before what that opens exists
// The chat: a channel's messages, or your conversation with one agent (in every channel). What it's aimed at is the composer's
// target: an agent's name is that agent's conversation (see isConvo). Questions are cards in the conversation,
// answered where they are (inline), not in a queue above it.
const feed = mountFeed($('.feed'), {
  inline: true,
  face: 36,
  onAgent: (name) => select(name),
  onConvo: (name) => openDM(name),
  onLeave: () => composer.setTarget('auto'),
  onChannel: (id) => setChannel(id, { go: false }),
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
const setup = mountSetup({ onAdd: () => addAgent(), onWorkspace: () => workspaces.create(), onComputers: () => openComputers() })

// Where you are: 'chat' (the channel open, see setChannel), 'dm' (the conversation the composer is aimed at), 'crew' (Agents, the cards),
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
// The conversation the composer was aimed at last time is the one that opens (in the chat), and Agents, Tasks or
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
$('.chan-sec [data-act=new-channel]').innerHTML = ICONS.plus
$('.side-more').innerHTML = ICONS.more
$('#link .h-icon').outerHTML = ICONS.computers
$('#link [data-link-add]').innerHTML = `${ICONS.link}Link with a code…`
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
  drawChannels()
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
// A place from the sidebar (or ⌘1–4): the composer goes back to everyone, which only a channel shows.
function goPlace(next) {
  if (isConvo(composer.target())) composer.setTarget('auto') // targetChanged: back to the channel's messages
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

// ---- the header: the channel, or who you're talking to -----------------------------------------------------------

const chatHeadEl = $('.page-head[data-for=chat]')
function drawHead() {
  const a = place === 'dm' ? dmAgent() : null
  const [title, acts] = place === 'chat' ? chatHead() : a ? dmHead(a) : ['', '']
  chatHeadEl.classList.toggle('none', !title)
  morph(chatHeadEl.querySelector('.ph-title'), title)
  morph(chatHeadEl.querySelector('.ph-acts'), acts)
}
// A channel: its name and its brief's first line (#general without one: who it reaches and where they work), what's
// waiting on you anywhere (a click goes to the oldest), who's in it (a click: who works here, or the channel's members),
// and its menu.
function chatHead() {
  const needs = needsYou(state)
  const c = openChannel()
  const everyone = state.agents.filter((a) => !a.cloneOf)
  const members = c.members ? everyone.filter((a) => c.members.includes(a.name)) : everyone
  const faces = [...members.filter((a) => a.on), ...members.filter((a) => !a.on)]
  const who = `Everyone in ${wsLabel(state.workspace)}`
  const folder = state.workspace?.folder
  const brief = c.brief.split('\n').find((l) => l.trim())?.trim()
  const sub = brief ? esc(brief) : c.id === 'general' ? `${esc(who)} · ${folder ? esc(tildePath(folder)) : 'Auto picks who answers'}` : c.members ? esc(nameList(members.map((a) => a.seed ?? a.name))) : esc(who)
  const tip = c.brief || (folder ? `Its agents work in ${folder}, unless one has a folder of its own here` : 'Each agent works in its own folder')
  return [headTitle({ glyph: '#', title: esc(c.name), sub, tip }),
    `${needs.length ? `<button class="mh-needs" data-head="needs" title="${esc(`${needs.map((x) => `${displayName(x.agent)}: ${needText(x)}`).join('\n')}\n\nClick for the oldest`)}">${needs.length} waiting on you${DOWN}</button>` : ''}
      ${members.length ? `<button class="mh-faces" data-head="members" aria-haspopup="dialog" title="${esc(c.members ? `In #${c.name}: ${plural(members.length, 'agent')}. Click to change` : `Who works here: ${plural(members.length, 'agent')}, ${faces.filter((a) => a.on).length} on`)}">${faces.slice(0, 5).map((a) => avatarHTML(a, { size: 24, mood: 'still' })).join('')}<span>${members.length}</span></button>` : ''}
      <button class="icon" data-head="channel" title="Channel: its brief, name and members" aria-label="Channel menu" aria-haspopup="menu">${ICONS.more}</button>`]
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
  if (act === 'members') return place === 'chat' && openChannel().members ? channelSheet(openChannel().id) : openMembers(b)
  if (act === 'channel') return channelMenu(openChannel().id, b)
  if (!a) return
  if (act === 'terminal') {
    store.set('crew.dock', docked() ? '0' : '1')
    showPlace('dm')
  }
  if (act === 'profile') edit(a.name)
  if (act === 'menu') agentMenu(a.name, b)
})

// ---- channels: #general and the ones you make (core/workspaces.js) ----------------------------------------------
// The chat shows one channel at a time. Each workspace remembers the one you had open. A channel's brief is what its
// agents are told to do there, once per conversation (core/hub.js briefed): its sheet says so as you write it.

let chan = 'general' // the channel open in the chat
const channelsNow = () => state.channels ?? [{ id: 'general', name: 'general', brief: '' }]
const openChannel = () => channelsNow().find((c) => c.id === chan) ?? channelsNow()[0]
const chanKey = () => `crew.channel.${state.workspace?.id}`
// The workspace's channel, as it was left (one that's gone: #general), told to the chat and the composer.
function syncChannel() {
  const kept = store.get(chanKey())
  const next = channelsNow().some((c) => c.id === kept) ? kept : 'general'
  if (next !== chan && booted) closeSearch() // the search was the last channel's
  chan = next
  feed.setChannel(chan)
  composer.setChannel({ ...openChannel(), ws: state.workspace?.id }) // each workspace's channels keep their own drafts
}
// Open a channel. go: as a place from the sidebar (the composer back to everyone's); otherwise only the chat changes,
// for a jump into another channel's message.
function setChannel(id, { go = true } = {}) {
  store.set(chanKey(), channelsNow().some((c) => c.id === id) ? id : 'general')
  syncChannel()
  if (go) return goPlace('chat')
  drawChannels()
  drawHead()
}

// Each channel's row: bold with a count of replies you haven't read there, berry when an agent there needs you.
function drawChannels() {
  const list = channelsNow()
  const asks = needsYou(state).filter((n) => n.ask)
  morph($('.channels'), list.map((c) => {
    const unread = state.feed.filter((e) => isUnread(e, state.reads) && channelOf(e, list) === c.id).length
    const needs = asks.filter((n) => channelOf(n.ask, list) === c.id).length
    const on = place === 'chat' && c.id === chan
    const tip = [`#${c.name}`, c.brief && (c.brief.length > 240 ? `${c.brief.slice(0, 240)}…` : c.brief), needs && `${plural(needs, 'question')} for you`, unread && plural(unread, 'new reply', 'new replies')].filter(Boolean).join('\n')
    return `<button class="nv ch${unread || needs ? ' fresh' : ''}" data-channel="${esc(c.id)}" role="listitem"${on ? ' aria-current="page"' : ''} title="${esc(tip)}"><span class="hash" aria-hidden="true">#</span><span class="ch-name">${esc(c.name)}</span><i class="nv-n">${needs ? `<span class="need-badge">${needs}</span>` : unread ? (unread > 9 ? '9+' : unread) : ''}</i></button>`
  }))
}
$('.channels').addEventListener('click', (e) => {
  const row = e.target.closest('[data-channel]')
  if (row) setChannel(row.dataset.channel)
})
$('.channels').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('[data-channel]')
  if (!row) return
  e.preventDefault()
  channelMenu(row.dataset.channel, { x: e.clientX, y: e.clientY })
})
$('.chan-sec [data-act=new-channel]').addEventListener('click', () => channelSheet(null))

function channelMenu(id, at) {
  const c = channelsNow().find((x) => x.id === id)
  if (!c) return
  popMenu(at, [
    { head: `#${c.name}` },
    { label: c.id === 'general' ? (c.brief ? 'Edit its brief…' : 'Give it a brief…') : 'Edit channel…', icon: ICONS.edit, act: 'edit' },
    ...(c.id === 'general' ? [] : ['-', { label: `Delete #${c.name}…`, icon: ICONS.trash, act: 'remove', danger: true }]),
  ], (act) => {
    if (act === 'edit') channelSheet(id)
    if (act === 'remove') removeChannel(c)
  })
}

async function removeChannel(c, ws = state.workspace?.id) {
  if (!confirm(`Delete #${c.name}? Its messages stay, in #general. Agents stop getting its brief.`)) return
  try {
    const { state: next } = await crew.call('channel', 'remove', c.id, null, ws)
    ;(push ??= await ready)(next)
    if (chan === c.id) setChannel('general')
  } catch (err) {
    oops(`Couldn't delete #${c.name}`, err)
  }
}

// The sheet: a new channel, or one's name, brief and members (#general: only its brief). The name is typed the way it
// will show (lowercase, hyphens); the brief's size says what it costs, since every agent here reads it once per
// conversation.
const channelDialog = $('#channel')
channelDialog.innerHTML = `
  <header class="ws-hero">
    <span class="ch-hero-glyph" aria-hidden="true">#</span>
    <div class="ws-hero-main">
      <input class="ws-title" data-ch-name placeholder="new-channel" spellcheck="false" maxlength="40" autocomplete="off" aria-label="Channel name">
      <span class="ws-hero-sub" data-ch-sub></span>
    </div>
    <button type="button" class="icon sheet-x" data-close aria-label="Close">${ICONS.close}</button>
  </header>
  <div class="sheet-body ws-body">
    <section class="ws-sec">
      <h4 class="section-label">Brief<small data-ch-cost></small></h4>
      <textarea class="field ch-brief-field" data-ch-brief rows="5" spellcheck="true" placeholder="What agents should do here, e.g. Review only: don't change files. List findings, most severe first, each tagged [high], [med] or [low]."></textarea>
      <p class="ws-note">Each agent reads it with its first message in this channel, and again whenever you change it. Hand-offs and questions that start here stay here, so the agents they reach read it too.</p>
    </section>
    <section class="ws-sec" data-ch-sec="members">
      <h4 class="section-label"><span>Who's in it</span><small class="ws-count" data-ch-count></small></h4>
      <div class="seg fill ch-who-seg" role="radiogroup" aria-label="Who's in it"><button type="button" data-ch-all="1" role="radio">Everyone here</button><button type="button" data-ch-all="0" role="radio">Only some agents</button></div>
      <ul class="ws-crew ch-crew"></ul>
      <p class="ws-note" data-ch-note></p>
    </section>
  </div>
  <p class="err" data-ch-err></p>
  <div class="sheet-foot">
    <button type="button" class="btn danger" data-ch-remove>${ICONS.trash}<span>Delete channel…</span></button>
    <span class="grow"></span>
    <button type="button" class="btn" data-close>Cancel</button>
    <button type="button" class="btn primary" data-ch-save></button>
  </div>`
const $c = (sel) => channelDialog.querySelector(sel)
let chDraft = null // { id, name, brief, everyone, members: Set }
const tokensIn = (text) => Math.ceil(String(text).trim().length / 4) // about: a token is ~4 characters of English

function channelSheet(id) {
  const c = id ? channelsNow().find((x) => x.id === id) : null
  if (id && !c) return
  const agents = state.agents.filter((a) => !a.cloneOf)
  // ws: the workspace it's for, whichever is on screen by the time it's saved. Only some: you pick them.
  chDraft = { ws: state.workspace?.id, id: c?.id ?? null, name: c?.name ?? '', brief: c?.brief ?? '', everyone: !c?.members, members: new Set(c?.members ?? []) }
  const general = c?.id === 'general'
  $c('[data-ch-name]').value = chDraft.name
  $c('[data-ch-name]').disabled = general
  $c('[data-ch-brief]').value = chDraft.brief
  $c('[data-ch-sec=members]').classList.toggle('hidden', general || !agents.length)
  $c('[data-ch-remove]').classList.toggle('hidden', !c || general)
  $c('[data-ch-save]').textContent = c ? 'Save' : 'Create channel'
  $c('[data-ch-err]').textContent = ''
  drawChannelSheet()
  channelDialog.showModal()
  setTimeout(() => $c(general ? '[data-ch-brief]' : '[data-ch-name]').focus(), 60)
}

// list: the agents too (typing the name or the brief leaves them be)
function drawChannelSheet({ list = true } = {}) {
  const d = chDraft
  const agents = state.agents.filter((a) => !a.cloneOf)
  const name = channelName(d.name)
  const general = d.id === 'general'
  const tokens = tokensIn(d.brief)
  $c('[data-ch-cost]').textContent = tokens ? `about ${plural(tokens, 'token')}, once per conversation` : ''
  const members = d.everyone ? agents : agents.filter((a) => d.members.has(a.name))
  $c('[data-ch-sub]').innerHTML = general
    ? `${faceStack(agents, 6)}<span>Everyone in ${esc(state.workspace?.name ?? 'your crew')}. Messages from a phone or the floating chat land here.</span>`
    : name && name !== d.name.trim() ? `<span>It will be #${esc(name)}</span>`
    : members.length ? `${faceStack(members, 6)}<span>${d.everyone ? `Everyone in ${esc(state.workspace?.name ?? 'your crew')}` : plural(members.length, 'agent')}</span>` : '<span>Nobody in it yet</span>'
  segmented($c('.ch-who-seg'), (b) => (b.dataset.chAll === '1') === d.everyone)
  $c('[data-ch-count]').textContent = d.everyone ? '' : `${members.length} of ${agents.length}`
  $c('.ch-crew').classList.toggle('hidden', d.everyone)
  $c('[data-ch-note]').textContent = d.everyone
    ? 'Auto picks from everyone in the workspace, as in #general.'
    : 'Auto picks only from these agents. An @mention still reaches anyone.'
  if (list) {
    $c('.ch-crew').innerHTML = agents.map((a) => {
      const on = d.members.has(a.name)
      return `<li class="ws-agent ${on ? 'in' : ''}" style="--c:${agentColor(a)}"><span class="ws-av">${avatarHTML(a, { size: 30, mood: on ? undefined : 'still' })}</span>
        <span class="who"><b>${esc(displayName(a))}</b><small>${esc(a.area || 'no area')}</small></span>
        <input type="checkbox" class="switch sm" data-ch-member="${esc(a.name)}" ${on ? 'checked' : ''} aria-label="${esc(displayName(a))} is in it"></li>`
    }).join('')
  }
  $c('[data-ch-save]').disabled = !general && !name
}
// as the hub names it (core/workspaces.js channelName)
const channelName = (raw) => String(raw ?? '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/^#+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

channelDialog.addEventListener('input', (e) => {
  if (e.target.matches('[data-ch-name]')) (chDraft.name = e.target.value), drawChannelSheet({ list: false })
  if (e.target.matches('[data-ch-brief]')) (chDraft.brief = e.target.value), drawChannelSheet({ list: false })
})
channelDialog.addEventListener('change', (e) => {
  const m = e.target.closest('[data-ch-member]')
  if (!m) return
  chDraft.members[m.checked ? 'add' : 'delete'](m.dataset.chMember)
  m.closest('.ws-agent').classList.toggle('in', m.checked)
  drawChannelSheet({ list: false })
})
channelDialog.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-ch-name]')) (e.preventDefault(), saveChannel())
})
channelDialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === channelDialog) return channelDialog.close()
  const all = e.target.closest('[data-ch-all]')
  if (all) {
    chDraft.everyone = all.dataset.chAll === '1'
    return drawChannelSheet({ list: false })
  }
  if (e.target.closest('[data-ch-remove]')) {
    const c = channelsNow().find((x) => x.id === chDraft.id)
    channelDialog.close()
    return c && removeChannel(c, chDraft.ws)
  }
  if (e.target.closest('[data-ch-save]')) saveChannel()
})

async function saveChannel() {
  const d = chDraft
  const patch = { brief: d.brief.trim(), ...(d.id !== 'general' && { name: d.name, members: d.everyone ? [] : [...d.members] }) }
  if (d.id !== 'general' && !d.everyone && !d.members.size) return void ($c('[data-ch-err]').textContent = 'Pick at least one agent, or let everyone in')
  try {
    const { id, state: next } = await crew.call('channel', d.id ? 'edit' : 'create', d.id, patch, d.ws)
    channelDialog.close()
    ;(push ??= await ready)(next)
    if (!d.id) setChannel(id) // a new one opens; an edited one stays where you are
  } catch (err) {
    $c('[data-ch-err]').textContent = errorLine(err)
  }
}

// ---- who works here: the workspace's agents, from #general's faces, the workspace's menu or its welcome -----------------
// Its agents (one shared with your other workspaces can be taken out of this one), the rest of your crew (bring one
// in: it starts here in a conversation of its own), and a new agent.
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
  const r = (at?.isConnected ? at : chatHeadEl).getBoundingClientRect()
  const w = membersPop.offsetWidth
  membersPop.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - w - 8, r.right - w)))}px`
  membersPop.style.top = `${Math.round(Math.min(r.bottom + 6, innerHeight - membersPop.offsetHeight - 8))}px`
  if (r.left < 200) membersPop.style.left = `${Math.round(Math.max(8, r.left))}px` // from the sidebar or the rail: under it, to the right
}
function drawMembers() {
  const w = state.workspace
  if (!w) return
  const here = state.agents.filter((a) => !a.cloneOf)
  const others = (state.roster ?? []).filter((r) => !here.some((a) => a.name === r.name))
  const row = (a, end) => `<div class="mp-row" data-agent="${esc(a.name)}">${avatarHTML(a, { size: 30, mood: 'still' })}<span class="mp-who"><b>${esc(a.seed ?? a.name)}</b><small>${esc(a.area || (a.status ? upFirst(statusText(a)) : ''))}</small></span>${end}</div>`
  const take = (a) => (a.shared ? `<button class="btn sm plain mp-take" data-mp-take="${esc(a.name)}" title="${esc(`Take ${a.name} out of ${w.name}: it stays in your crew and your other workspaces`)}">Take out</button>` : '<span class="mp-only" title="Made for this workspace: it works only here">only here</span>')
  morph(membersPop, `<header class="mp-head"><b>Who works here</b><span>${here.length}</span></header>
    <p class="mp-lead">${esc(w.name)}'s agents${w.folder ? `, in ${esc(tildePath(w.folder))}` : ''}. One from your crew works here in a conversation of its own.</p>
    <div class="mp-body">
      ${here.length ? here.map((a) => row(a, take(a))).join('') : `<p class="mp-lead">Nobody yet.</p>`}
      ${others.length ? `<div class="mp-sec section-label">From your crew</div>${others.map((r) => row({ ...r, status: '' }, `<button class="btn sm mp-add" data-mp-add="${esc(r.name)}">Add</button>`)).join('')}` : ''}
    </div>
    <footer class="mp-foot"><button class="btn" data-mp-new>${ICONS.plus}<span>New agent for ${esc(w.name)}</span></button><span class="grow"></span><button class="btn plain" data-mp-agents>All agents</button></footer>`)
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

// ---- an empty #general: its first steps, like Discord's welcome to a new server ------------------------------------
// Who works here, its folder (a workspace of your own), and the first message; each a click away, ticked once done.
function welcomeHTML() {
  const w = state.workspace
  if (!w) return '' // the very first run: the setup screen asks for one
  const here = state.agents.filter((a) => !a.cloneOf)
  const step = (done, act, title, sub) => `<button class="wl-step ${done ? 'done' : ''}" data-welcome="${act}"><i class="pick ${done ? 'on' : ''}">${ICONS.check}</i><span><b>${esc(title)}</b><small>${esc(sub)}</small></span><i class="wl-go">${ICONS.chevron}</i></button>`
  return `<div class="welcome empty-state">${wsTile(w, { size: 64 })}<h2 class="display">Welcome to ${esc(w.name)}</h2>
    <p class="lead">Everyone here sees what's said in #general. Ask for something and Auto picks who answers, or @name someone. Make a channel (+ by Channels) for work with rules of its own.</p>
    <div class="wl-steps">
      ${step(here.length > 0, 'members', here.length ? `${plural(here.length, 'agent')} work${here.length > 1 ? '' : 's'} here` : 'Choose who works here', 'Agents from your crew, or new ones just for this workspace')}
      ${step(Boolean(w.folder), 'settings', w.folder ? `They work in ${tildePath(w.folder)}` : 'Pick its folder', 'Where its agents work, unless one has a folder of its own')}
      ${step(false, 'message', 'Send the first message', here.length ? `${nameList(here.map((a) => a.seed ?? a.name))} ${here.length > 2 ? 'all see' : here.length > 1 ? 'both see' : 'sees'} it` : 'Once someone works here')}
    </div></div>`
}
$('.feed').addEventListener('click', (e) => {
  const act = e.target.closest('[data-welcome]')?.dataset.welcome
  if (act === 'members') openMembers(e.target.closest('[data-welcome]'))
  if (act === 'settings') workspaces.settings()
  if (act === 'message') composer.focus()
})

// What's waiting on you, oldest first: a question goes to its card in its channel, an agent asking in its terminal to
// that.
function answerOldest() {
  const n = needsYou(state)[0]
  if (!n) return
  if (!n.ask) return select(n.agent.name)
  if (place !== 'chat' || channelOf(n.ask, channelsNow()) !== chan) setChannel(channelOf(n.ask, channelsNow()))
  requestAnimationFrame(() => feed.jump(n.ask.id))
}

// ---- searching the messages: the channel's, or the conversation's ------------------------------------------------------

// The magnifier opens a field; what you type narrows the chat to the messages with every word (marked), with how many
// in the field. A click on one shows it where it was. Esc, or leaving, ends it.
const msearch = mountSearch($('.chat-search'), {
  label: 'Search messages',
  placeholder: () => (place === 'dm' && dmAgent() ? `Search with ${dmAgent().seed ?? dmAgent().name}` : `Search #${openChannel().name}`),
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
    { label: 'Token savers…', icon: ICONS.chart, act: 'savers', hint: saversHint() },
    { label: 'Agent tools…', icon: ICONS.mark, act: 'tools', hint: toolHint() },
    '-',
    { label: 'Computers…', icon: ICONS.computers, act: 'computers', hint: away ? `${away} offline` : c.links.length ? `${c.links.length + 1} linked` : '' },
    { label: 'Claude Code and Codex…', icon: ICONS.terminal, act: 'setup' },
    ...(ON_WINDOWS ? [] : [{ label: 'Permissions…', icon: ICONS.shield, act: 'permissions' }]),
    '-',
    { head: 'Theme' },
    ...THEME_CHOICES.map(([id, label, icon, note]) => ({ label, icon: ICONS[icon], act: `theme:${id}`, hint: theme === id ? '✓' : note })),
    ...(crew.dev ? ['-', { label: 'Open config.json', icon: ICONS.braces, act: 'config', hint: 'developer' }] : []),
  ], (act) => {
    if (act === 'autopilot') crew.call('autopilot', !state.autopilot).catch((err) => oops("Couldn't change Autopilot", err))
    if (act === 'savers') openSavers()
    if (act === 'tools') openTools()
    if (act === 'computers') openComputers()
    if (act === 'setup') setup.open()
    if (act === 'permissions') crew.call('openPermissions').catch((err) => oops('Couldn’t open that', err))
    if (act.startsWith('theme:')) crew.call('theme', act.slice(6)).catch((err) => oops('Couldn’t change the theme', err))
    if (act === 'config') crew.call('config')
  })
})

// ---- token savers (core/savers.js): one switch each, and what each has counted ----

const saversDialog = $('#savers')
saversDialog.querySelector('.h-icon').innerHTML = ICONS.chart
const saversOn = () => (state.savers?.list ?? []).filter((s) => state.savers.on[s.id]).length
const saversHint = () => (state.savers ? `${saversOn()} of ${state.savers.list.length} on` : '')
const times = (n) => (n === 1 ? 'once' : `${n.toLocaleString('en-US')} times`)
const tok = (n) => `${tokenCount(Math.round(n ?? 0))} tokens`
// What a saver counted: with it on, what it did; with it off, what it would have done. Both when it's been both.
const SAVER_COUNTS = {
  coldStart: [(c) => `Started fresh ${times(c.n)} instead of re-reading ${tok(c.tokens)}`, (c) => `${plural(c.n, 'cold conversation')} picked back up, re-reading ${tok(c.tokens)}`],
  boardNew: [(c) => `Left ${tok(c.tokens)} of notes already read out of ${plural(c.n, 'board read')}`, (c) => `${plural(c.n, 'board read')} could have left out ${tok(c.tokens)}`],
  busyCheck: [(c) => `crew busy was run ${times(c.n)}`, (c) => `crew busy was run ${times(c.n)}`],
  quickTriage: [
    (c) => `${plural(c.n, 'task')} triaged${c.cost ? `, ${money(c.cost / c.n)} each` : c.tokens ? `, ${tok(c.tokens / c.n)} each` : ''}${c.failed ? ` (${c.failed} by the triage agent after all)` : ''}`,
    (c) => `${plural(c.n || 0, 'triage turn')}${c.cost && c.n ? `, ${money(c.cost / c.n)} each` : c.tokens && c.n ? `, ${tok(c.tokens / c.n)} each` : ''}`,
  ],
  warmRoute: [(c) => `Picked the cheaper agent ${times(c.n)}, about ${tok(c.tokens)} less to wake`, (c) => `Could have picked a cheaper agent ${times(c.n)} (about ${tok(c.tokens)})`],
  noReportBack: [(c) => `Stopped ${plural(c.n, 'report')} back`, (c) => `${plural(c.n, 'report')} back went out`],
}
function saverCount(id) {
  const s = state.savers.all.savers[id]
  const [onText, offText] = SAVER_COUNTS[id] ?? []
  const lines = [s?.on?.n && `<span class="sv-count">${esc(onText(s.on))}</span>`, s?.off?.n && `<span class="sv-count off">With it off: ${esc(offText(s.off))}</span>`].filter(Boolean)
  return lines.join('') || '<span class="sv-count none">Nothing to count yet</span>'
}
// Cost per turn under each mix of savers that was on, once there's more than one to compare.
const MODE_NAMES = (mode, all) => (mode === 'none' ? 'All off' : mode.split('+').length === all ? 'All on' : `${mode.split('+').length} of ${all} on`)
function drawSaverModes() {
  const all = state.savers.list.length
  const rows = Object.entries(state.savers.all.modes).filter(([, m]) => m.turns >= 1 && (m.cost >= 0.005 || m.tokens))
  if (rows.length < 2) return ''
  return `<h4 class="section-label">Cost per turn, by which savers were on</h4><div class="group-list">${rows
    .sort(([, x], [, y]) => y.turns - x.turns)
    .map(([mode, m]) => `<div class="sv-mode" title="${esc(mode)}"><span>${esc(MODE_NAMES(mode, all))}</span><b>${m.cost >= 0.005 ? money(m.cost / m.turns) : tok(m.tokens / m.turns)}</b><small>${plural(m.turns, 'turn')}${m.tools ? ` · ${(m.tools / m.turns).toFixed(1)} tool calls each` : ''}</small></div>`)
    .join('')}</div><p class="sv-note">${esc(SPEND_NOTE)} Different weeks bring different work, so compare over a while.</p>`
}
// Drawn again only when what it shows changed (counts move with every turn while agents work), and patched in place,
// so a switch keeps its focus and a click isn't lost to a row being replaced under it.
let saversKey = ''
function drawSavers(force = false) {
  if (!state.savers) return
  const key = JSON.stringify(state.savers)
  if (!force && key === saversKey) return
  saversKey = key
  const { list, on, forced } = state.savers
  morph(saversDialog.querySelector('.sv-list'), list.map((s) => `
    <label class="sv" data-saver="${esc(s.id)}">
      <b>${esc(s.label)}</b>
      <span class="sv-about">${esc(s.about)}</span>
      ${saverCount(s.id)}
      <input type="checkbox" class="switch" data-sv="${esc(s.id)}" ${on[s.id] ? 'checked' : ''} ${forced ? 'disabled' : ''} aria-label="${esc(s.label)}">
    </label>`).join(''))
  morph(saversDialog.querySelector('.sv-modes'), drawSaverModes())
  for (const sw of saversDialog.querySelectorAll('[data-sv]')) sw.checked = Boolean(on[sw.dataset.sv]) // a property morph leaves be
  saversDialog.querySelector('.sv-forced').textContent = forced ? 'CREW_SAVERS is set, so it decides which are on.' : ''
}
function openSavers() {
  saversDialog.querySelector('[data-sv-err]').textContent = ''
  drawSavers(true)
  saversDialog.showModal()
}
saversDialog.addEventListener('change', (e) => {
  const sw = e.target.closest('[data-sv]')
  if (!sw) return
  saversDialog.querySelector('[data-sv-err]').textContent = ''
  crew.call('savers', { [sw.dataset.sv]: sw.checked }).catch((x) => {
    sw.checked = !sw.checked
    saversDialog.querySelector('[data-sv-err]').textContent = errorLine(x)
  })
})
saversDialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === saversDialog) saversDialog.close()
})

// ---- agent tools (core/tools.js): what agents may change in CLIque with `crew app`, and whether they ask first ----

const toolsDialog = $('#tools')
toolsDialog.querySelector('.h-icon').innerHTML = ICONS.mark
const TOOL_MODES = [
  ['off', 'Off', "Agents can't change CLIque, or look at it. Ask one, and it tells you to do it yourself."],
  ['ask', 'Ask first', 'Each change waits for your OK in the chat, like a permission prompt. Looking never asks.'],
  ['auto', 'Automatic', 'Changes go through right away, and the chat says what changed. Removing something, linking a computer, and starting or changing a YOLO agent still ask first.'],
]
// icon (as the sidebar draws it), what, what agents can do with it, and whether Automatic lets it through
const TOOL_KINDS = [
  ['mark', 'Agents', 'Add agents, change their job, brain or folder, turn them on and off. Removing one always asks.', true],
  ['#', 'Channels', 'Add channels, change their briefs and who’s in them. Removing one always asks.', true],
  ['tiles', 'Workspaces', 'Make workspaces, choose who works in them, put them to sleep. Removing one always asks.', true],
  ['computers', 'Computers', 'Link and unlink your other computers. Always asks.', false],
]
const toolHint = () => TOOL_MODES.find(([id]) => id === (state.tools ?? 'ask'))?.[1] ?? ''
toolsDialog.querySelector('.tl-modes').innerHTML = TOOL_MODES.map(([id, label]) => `<button data-tl="${id}">${label}</button>`).join('')
// every mode's words in one cell, the one picked showing: the sheet keeps its height as you switch
toolsDialog.querySelector('.tl-about').innerHTML = TOOL_MODES.map(([id, , about]) => `<p data-mode="${id}">${esc(about)}</p>`).join('')
toolsDialog.querySelector('.tl-list').innerHTML = TOOL_KINDS.map(([icon, label, can, auto]) => `
  <div class="tl-kind" data-auto="${auto ? 1 : 0}"><span class="tl-icon">${ICONS[icon] ?? `<span class="tl-hash" aria-hidden="true">${icon}</span>`}</span><b>${label}</b><span class="tl-can">${esc(can)}</span><span class="tl-how"></span></div>`).join('')
function drawTools() {
  const mode = state.tools ?? 'ask'
  segmented(toolsDialog.querySelector('.tl-modes'), (b) => b.dataset.tl === mode)
  for (const p of toolsDialog.querySelectorAll('.tl-about p')) p.classList.toggle('on', p.dataset.mode === mode)
  for (const row of toolsDialog.querySelectorAll('.tl-kind')) {
    row.classList.toggle('off', mode === 'off')
    row.querySelector('.tl-how').textContent = mode === 'off' ? 'Off' : mode === 'auto' && row.dataset.auto === '1' ? 'Automatic' : 'Asks first'
  }
}
function openTools() {
  toolsDialog.querySelector('[data-tl-err]').textContent = ''
  drawTools()
  toolsDialog.showModal()
}
toolsDialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === toolsDialog) return toolsDialog.close()
  const pick = e.target.closest('button[data-tl]')
  if (!pick || pick.dataset.tl === (state.tools ?? 'ask')) return
  const was = state.tools
  state.tools = pick.dataset.tl // shown now; the state that follows says it for good
  toolsDialog.querySelector('[data-tl-err]').textContent = ''
  drawTools()
  crew.call('tools', pick.dataset.tl).catch((x) => {
    state.tools = was
    drawTools()
    toolsDialog.querySelector('[data-tl-err]').textContent = errorLine(x)
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
  shownTerm.observe(tile.querySelector('.term'))
  replay(t)
  return t
}

function dropTile(t) {
  shownTerm.unobserve(t.tile.querySelector('.term'))
  t.term.dispose()
  t.tile.remove()
}

// A terminal out of sight replays once it comes into view. xterm keeps each character's width as it draws a row, but
// in a hidden terminal every character measures 0 wide and nothing is kept, so it lays the window out again for every
// character of every row. Replaying a workspace's terminals while you were in #crew (every switch) held the window for
// seconds.
const shownTerm = new IntersectionObserver((seen) => {
  for (const e of seen) {
    const t = e.isIntersecting && terms.get(e.target.closest('.tile').dataset.name)
    if (t?.waiting) replay(t)
  }
})

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
  // out of sight (in #crew, or Focus showing another one): shownTerm replays it when it shows
  t.waiting = !t.tile.querySelector('.term').offsetWidth
  if (t.waiting) return void (t.ready = false)
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
  $('.blank h1').textContent = parked ? `${state.workspace.name} is asleep` : state.agents.length ? 'All agents are off' : 'No agents yet'
  $('.blank .lead').textContent = parked ? 'Send a message to wake it: each agent picks up its conversation.' : state.agents.length ? 'Turn one on in Agents: it picks up its last session.' : 'Make your first one in Agents.'
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
// ⌘1 the channel, ⌘2 Agents, ⌘3 Tasks, ⌘4 Terminals; ⌘F searches the messages in a channel and a conversation (elsewhere it
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

// ⌃1–9: the workspaces, in the switcher's order (one asleep wakes). ⌃Tab and ⌃⇧Tab: the next and previous awake one.
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
  switchTo(w.id)
}, true)

// ---- workspaces: switching, with the crew sliding over to the next one ----------------------------

// The new workspace renders inside a view transition, from the state the switch answers with; the side it slides in
// from is where it sits in the switcher. One that's asleep wakes (Crew does that), the one on screen too.
let push = null
async function switchTo(id) {
  const list = state.workspaces ?? []
  const from = list.findIndex((w) => w.current)
  const to = list.findIndex((w) => w.id === id)
  if (to < 0 || (to === from && !list[to].parked)) return
  const unsaved = collection.unsaved()
  if (unsaved && !confirm(`Discard your changes to ${unsaved}?`)) return
  const go = async () => {
    try {
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
  const id = next.workspace?.id ?? ''
  if (shownWorkspace === id) return
  const first = shownWorkspace === null
  shownWorkspace = id
  if (first) return
  for (const t of terms.values()) dropTile(t)
  terms.clear()
  selected = null
  composer.stopReply() // the message it answered is in the other workspace's chat
  if (channelDialog.open) channelDialog.close() // a channel's sheet was the last workspace's
  openMenu?.close() // a menu or the list of who works here was about the last one
  if (membersPop.matches(':popover-open')) membersPop.hidePopover()
  composer.setTarget('auto')
  const unsaved = collection.unsaved() // switched from the menu bar or a notification, with an agent's sheet open
  collection.close()
  if (unsaved && next.workspace) toast(`Closed ${unsaved} without saving: you switched to ${next.workspace.name}`, true)
  tasks.close()
}

// ---- the sidebar's agents: a conversation with each, by computer ---------------------------------------------------

// How it is, in a word, for the end of its line: what it's doing while it works ("editing", "testing"), otherwise
// "free", "starting", "off".
const DOING = [[/^(Planning|Writing up a plan)/, 'planning'], [/^Editing\b/, 'editing'], [/^Writing\b/, 'writing'], [/^Reading\b/, 'reading'], [/^Searching\b/, 'searching'], [/^Running the tests/, 'testing'], [/^Running\b/, 'running'], [/^Asking\b/, 'asking'], [/^Handing work/, 'handing off'], [/^Starting a sub-agent/, 'delegating'], [/^Drawing\b/, 'drawing']]
function doingWord(a) {
  if (!a.on) return a.status === 'parked' ? 'asleep' : 'off'
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
    case 'parked': return 'asleep'
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
const sec = $('.dm-sec')
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
  // one of your shared agents can join your other workspaces, and leave this one (or leave your crew altogether);
  // a workspace's own agent is only here
  const ws = state.workspace
  const joins = a.shared && !a.home ? (state.workspaces ?? []).filter((w) => w.id !== ws?.id && !w.members?.some((m) => m.name === name)) : []
  const leave = Boolean(a.shared)
  popMenu(at, [
    { head: a.seed ?? a.name },
    { label: 'Message', icon: ICONS.reply, act: 'message', disabled: !a.on },
    { label: 'Open terminal', icon: ICONS.terminal, act: 'terminal', disabled: !terms.has(name) },
    { label: 'Edit…', icon: ICONS.edit, act: 'edit' },
    { label: 'New conversation', icon: ICONS.fresh, act: 'fresh', disabled: !a.on || a.freshPending },
    ...(places.length ? ['-', ...places.map((g) => ({ label: `Move to ${g.name}`, icon: g.here ? ICONS.desktop : ICONS.laptop, act: `move:${g.key}`, disabled: !g.online, hint: g.online ? '' : 'offline' }))] : []),
    ...(joins.length ? ['-', ...joins.map((w) => ({ label: `Add to ${w.name}`, icon: wsTile(w, { size: 16 }), act: `join:${w.id}`, hint: w.parked ? 'asleep' : '' }))] : []),
    '-',
    { label: a.on ? 'Turn off' : 'Turn on', icon: ICONS.power, act: 'power' },
    { label: leave ? `Take out of ${ws.name}…` : 'Remove…', icon: ICONS.trash, act: 'remove', danger: true },
    ...(leave ? [{ label: 'Remove from your crew…', icon: ICONS.trash, act: 'forget', danger: true }] : []),
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
        : `Remove ${name}? It's only in ${ws.name}, so it's gone for good. Its session stops (the transcript stays with the CLI).`)
      if (sure) await crew.call('removeAgent', name)
      if (act === 'forget' && confirm(`Remove ${a.seed ?? a.name} from your crew? It stops and leaves every workspace it's in, for good. Its transcripts stay with the CLI.`)) await crew.call('removeAgent', name, { everywhere: true })
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

// ---- the sidebar's foot: your accounts' usage (click for every limit), and ⋯ --------------------------------------

// The account closest to its limit, its fullest window as a bar. Berry only when it will run out before it resets, at
// this pace. With linked computers that report theirs, a row like that for each computer, under its name: their
// agents run on their own accounts. A dot on ⋯ when a linked computer can't be reached (Computers says which).
const fullestPct = (u) => Math.max(...u.windows.map((w) => w.pct))
const topAccount = (accounts) => accounts.find((u) => paceWarning(u)) ?? [...accounts].sort((x, y) => fullestPct(y) - fullestPct(x))[0]
const useBar = (pct) => `<i class="use-bar"><i style="width:${Math.min(100, Math.max(pct, 3))}%"></i></i><span class="use-pct">${pct}%</span>`
function drawFoot(state) {
  const c = state.computers ?? { me: {}, links: [] }
  const away = c.links.filter((l) => !l.online)
  $('.side-more').classList.toggle('warn', away.length > 0)
  $('.side-more').title = `Autopilot, Computers, Claude Code and Codex, theme${away.length ? `\n${away.map((l) => l.name).join(', ')} can't be reached` : ''}`
  const machines = usageByComputer(state)
  const use = $('.use-line')
  use.classList.toggle('none', !machines.length)
  const each = machines.length > 1 || machines.some((m) => !m.here)
  use.classList.toggle('each', each)
  if (!machines.length) {
    if (usePop.matches(':popover-open')) usePop.hidePopover()
    return
  }
  const tip = (m) => m.accounts.map((u) => `${usageTip(u, !m.here && m.name)}${paceWarning(u) ? `\n${paceWarning(u)}` : ''}`).join('\n\n')
  if (!each) {
    const top = topAccount(machines[0].accounts)
    use.classList.toggle('warm', Boolean(paceWarning(top)))
    use.title = tip(machines[0])
    morph(use, `<span class="use-row"><span class="use-name">${esc(top.label)}</span>${useBar(fullestPct(top))}</span>`)
  } else {
    use.classList.remove('warm')
    use.title = ''
    morph(use, machines.map((m) => {
      const top = topAccount(m.accounts)
      const warn = paceWarning(top)
      const where = m.here ? `${m.name}: ${THIS_COMPUTER}` : `${m.name}${m.online ? '' : ': offline, as it last said'}`
      return `<span class="use-row ${warn ? 'warm' : ''} ${m.online ? '' : 'off'}" data-key="${esc(m.key)}" title="${esc(`${where}\n\n${tip(m)}`)}">` +
        `<span class="use-pc">${computerIcon(m.name)}</span><span class="use-name">${esc(m.name)}</span>${useBar(fullestPct(top))}</span>`
    }).join(''))
  }
  if (usePop.matches(':popover-open')) drawUsePop()
}

// A click on the usage line: every account's limits, one line each, and when one runs out at this pace. With linked
// computers, under each computer's name.
const usePop = $('.use-pop')
function drawUsePop() {
  const machines = usageByComputer(state)
  const each = machines.length > 1 || machines.some((m) => !m.here)
  morph(usePop, machines.map((m) => {
    const head = each ? `<div class="up-pc ${m.online ? '' : 'off'}" data-key="${esc(m.key)}"><span class="use-pc">${computerIcon(m.name)}</span><b>${esc(m.name)}</b><small>${m.here ? THIS_COMPUTER : m.online ? '' : 'offline'}</small></div>` : ''
    const rows = m.accounts.map((u) => {
      const warn = paceWarning(u)
      return `<div class="up-row">${usageLine({ provider: u.provider, home: m.here ? null : m.key, homeName: m.name }, state)}<small class="${warn ? 'warn' : ''}">${esc(warn || u.windows.map((w) => `${w.pct}% ${resetsText(w.resetsAt)}`).join(' · '))}</small></div>`
    })
    return `<div class="up-group" data-key="${esc(m.key)}">${head}${rows.join('')}</div>`
  }).join(''))
  placeUsePop()
}
// Over the usage line, which grows a row per computer: placed again on every redraw, not only when it opens.
function placeUsePop() {
  const r = $('.use-line').getBoundingClientRect()
  usePop.style.left = `${Math.round(r.left)}px`
  usePop.style.bottom = `${Math.round(innerHeight - r.top + 6)}px`
}
// The line is its invoker (popovertarget), so a second click closes it and a click anywhere else does too.
usePop.addEventListener('beforetoggle', (e) => {
  if (e.newState === 'open') drawUsePop()
})

function addAgent() {
  if (!state.workspace) return workspaces.create() // the menu bar's New agent, say: it needs somewhere to work first
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
  syncChannel()
  workspaces.render(state)
  drawComputers(state)
  if (saversDialog.open) drawSavers()
  if (toolsDialog.open) drawTools()
  drawFoot(state)
  // Terminals only for agents that are on (and not parked); the sidebar lists everyone so off agents are one click from
  // coming back.
  const on = state.agents.filter((a) => a.on && a.status !== 'parked')
  const names = new Set(on.map((a) => a.name))
  for (const [name, t] of terms) {
    if (names.has(name)) continue
    dropTile(t)
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
// One list of your computers, this one first; under it Nearby: the computers on this network with Computers open too
// (core/discover.js), to link with a click and a code checked on both screens. Linking (either way) and Link with a code
// take the sheet over, the way Add a phone does, and hand back to the list with the new computer's agents unfolded.

const linkDialog = $('#link')
let linkKey = ''
let fresh = null // a computer just linked: its agents are shown to pick from
let linkErr = '' // Link with a code's, kept across redraws until the next try
// what's unfolded: each linked computer's agents; the Link with a code view; "Copied" for a moment
const linkOpen = { computers: new Set(), code: false, copied: false, detailsCopied: false }
let copiedTimer = null
let discoverTick = null // Computers says it's open every minute, so a page that went away stops discovery (core/crew.js)
let handing = null // the computer a finished linking is handing over to the list
let codeTyped = '' // what's in Link with a code's box, kept while something else takes the sheet over (one asking)

// What takes the sheet over: a computer asking to link this one, one this one is asking, or Link with a code.
const linkView = (c) => (c.pairing?.in ? 'in' : c.pairing?.out ? 'out' : linkOpen.code ? 'code' : null)

function drawComputers(state) {
  const c = state.computers ?? { me: {}, links: [] }
  drawPairing(c.phones)
  const view = phonePair ? null : linkView(c)
  const next = JSON.stringify([c, fresh, linkErr, phoneFresh, phoneErr, linkOpen, [...linkOpen.computers], view])
  if (next === linkKey) return
  linkKey = next
  morph(linkDialog.querySelector('.link-body'), computersHTML(c))
  const was = linkDialog.classList.contains('linking')
  linkDialog.classList.toggle('linking', Boolean(view))
  const lv = linkDialog.querySelector('.link-view')
  const typing = lv.querySelector('[data-link-code]')
  if (typing) codeTyped = typing.value // however it got there (typed, pasted, dropped)
  if (view) {
    morph(lv, view === 'code' ? codeHTML(c) : linkingHTML(c, view))
    const box = lv.querySelector('[data-link-code]')
    if (box) box.value = codeTyped // what was typed, across redraws and back from a computer asking
    if (!was) lv.focus({ preventScroll: true })
  } else if (was && linkDialog.open) {
    linkDialog.classList.add('back')
    setTimeout(() => linkDialog.classList.remove('back'), 400)
  }
  handOver(c)
}

// A linking that's done says so for a moment, then the list shows the new computer with its agents unfolded.
function handOver(c) {
  const done = [c.pairing?.out, c.pairing?.in].find((p) => p?.stage === 'linked')
  if (!done || handing === done.slug) return
  handing = done.slug
  setTimeout(() => linkHanded(done.slug), 1600)
}
function linkHanded(slug) {
  if (!slug || handing !== slug) return
  handing = null
  fresh = slug
  linkOpen.computers.add(slug)
  crew.call('link', 'pairDone').catch(() => {})
  requestAnimationFrame(() => linkDialog.querySelector(`[data-computer="${CSS.escape(slug)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}

const LINK_CHEV = `<span class="lk-chev">${ICONS.chevron}</span>`
// A computer's icon by its name: a MacBook is a laptop, anything else a desktop.
const machineIcon = (name) => computerIcon(name)

// The list: macOS keeping the app off the network (when it is), your computers, Nearby, phones.
function computersHTML({ me, links, phones, nearby }) {
  const blocked = me.localNetwork === 'blocked'
  const why = me.error ? sharingError(me.error) : me.warning
  return `${blocked ? blockedHTML() : ''}
    <div class="section-label">Your computers</div>
    <div class="group-list">
      <div class="lk-li lk-me"><span class="lk-ic">${machineIcon(me.name)}</span><div class="lk-k">
        <input class="me-name" data-me-name value="${esc(me.name)}" spellcheck="false" aria-label="${esc(upFirst(THIS_COMPUTER))}'s name" title="Click to rename it. Linked computers see its agents as name@${esc(me.slug)}">
        <small>${upFirst(THIS_COMPUTER)} · ${plural(me.agents ?? 0, 'agent')}</small></div></div>
      ${links.map(linkHTML).join('')}
    </div>
    ${why ? `<p class="err lk-why">${esc(why)}</p>` : ''}
    <div class="section-label lk-near-label">Nearby${nearby && !blocked ? '<span class="lk-looking"><span class="lk-ping"></span>Looking on this network</span>' : ''}</div>
    ${nearbyHTML(me, nearby, blocked)}
    <div class="section-label">Phones</div>
    ${phonesHTML(phones ?? { devices: [] })}`
}

// macOS's Local Network privacy, off for this app: nothing on this Wi-Fi can be reached until it's on (link.js and
// discover.js tell it by an address refused at once).
const blockedHTML = () => `<div class="well lk-banner" role="alert"><span class="lk-ic">${ICONS.shield}</span>
  <div class="lk-k">macOS is keeping ${PRODUCT_NAME} off this network<small>Turn on ${PRODUCT_NAME} in Privacy &amp; Security › Local Network, so your other computers and phones on this Wi-Fi can be found and reached.</small></div>
  <button class="btn sm" data-local-network>Open Settings</button></div>`

// Computers found nearby, each with Link; none yet, a radar and what to do on the other computer.
function nearbyHTML(me, nearby, blocked) {
  if (nearby?.length && !blocked) {
    return `<div class="group-list">${nearby.map((n) => `<div class="lk-li lk-near">
      <span class="lk-ic">${machineIcon(n.name)}</span>
      <span class="lk-k">${esc(n.name)}<small>${plural(n.agents, 'agent')} · ${n.address ? `at ${esc(n.address)}` : 'Computers is open there'}</small></span>
      <button class="btn primary sm" data-pair="${esc(n.id)}">${ICONS.link}Link</button></div>`).join('')}</div>`
  }
  return `<div class="well lk-find ${blocked ? 'off' : ''}">
    <div class="lk-radar" aria-hidden="true"><i></i><i></i><span class="lk-ic">${machineIcon(me.name)}</span></div>
    <div class="lk-find-k"><b>${blocked ? 'Nothing nearby can be found right now' : 'Open Computers on your other computer'}</b>
      <p>${blocked ? `Once ${PRODUCT_NAME} is allowed onto the local network, computers with Computers open show up here.` : 'It shows up here while Computers is open on both, on the same Wi-Fi.'}
      Another network, or Tailscale? <button class="lk-a" data-link-code-open>Link with a code</button></p></div>
  </div>`
}

// Linking one found nearby, or answering one asking: both computers, the code both screens show, and one line on
// what to do. Nothing in it changes size as it goes: the code's place is kept while there's none.
const LINK_FAILS = {
  declined: (n) => `<b>${n}</b> said no.`,
  timeout: (n) => `Nobody answered on <b>${n}</b> in time.`,
  closed: (n) => `Computers closed on <b>${n}</b>. Open it there and try again.`,
  busy: (n) => `<b>${n}</b> is answering another computer. Try again in a moment.`,
  version: (n) => `<b>${n}</b> runs a different ${PRODUCT_NAME} version. Update both, then try again.`,
  certificate: (n) => `Something other than <b>${n}</b> answered, so nothing was sent. Try again, or link with a code.`,
  blocked: () => `macOS is keeping ${PRODUCT_NAME} off this network. Turn it on in Privacy &amp; Security › Local Network.`,
  unreachable: (n) => `Couldn't reach <b>${n}</b>. Is it still on this Wi-Fi, with Computers open?`,
  cancelled: (n) => `<b>${n}</b> didn't link after all.`,
}
function linkingHTML({ me, pairing }, view) {
  const p = pairing[view]
  const them = esc(p.name)
  const { stage } = p
  const asking = view === 'in'
  const code = ['confirm', 'waiting', 'ask', 'accepted', 'linking'].includes(stage) ? p.sas : null
  const done = stage === 'linked'
  const failed = stage === 'failed'
  // Both screens ask the same: check the code, and Link on both. Neither links alone.
  const check = stage === 'confirm' || stage === 'ask'
  const line = done ? `<b>${them}</b>'s agents are part of your crew now.`
    : failed ? (LINK_FAILS[p.error]?.(them) ?? esc(upFirst(String(p.error ?? 'it didn\'t link'))))
    : stage === 'asking' ? `Asking <b>${them}</b>…`
    : check && p.theyAgreed ? `<b>${them}</b> clicked Link. If it shows the same code, click <b>Link</b> here too.`
    : check ? `If <b>${them}</b> shows the same code, click <b>Link</b> here and on ${them}.`
    : stage === 'waiting' || stage === 'accepted' ? `Now click <b>Link</b> on <b>${them}</b>.`
    : 'Linking…'
  const foot = done ? `<span class="grow"></span><button class="btn" data-pair-done>Done</button>`
    : check ? `<button class="btn" ${asking ? 'data-pair-no' : 'data-pair-cancel'}>${asking ? 'Not now' : 'Cancel'}</button><span class="grow"></span><button class="btn primary" ${asking ? 'data-pair-yes' : 'data-pair-confirm'}>${ICONS.link}Link</button>`
    : failed ? `<button class="btn" data-pair-back>${ICONS.back}Back</button><span class="grow"></span>${p.error === 'blocked' ? '<button class="btn" data-local-network>Open Settings</button>' : ''}${asking ? '' : `<button class="btn primary" data-pair-retry>${ICONS.restart}Try again</button>`}`
    : `<span class="grow"></span><button class="btn" data-pair-cancel ${asking ? 'disabled' : ''}>Cancel</button>`
  return `<h2 class="sheet-title"><span class="h-icon">${ICONS.computers}</span>${asking && !done ? `${them} wants to link` : done ? `Linked with ${them}` : `Link with ${them}`}</h2>
    <div class="lk-pair ${done ? 'done' : failed ? 'failed' : ['asking', 'waiting', 'accepted', 'linking'].includes(stage) ? 'busy' : ''}">
      <div class="lk-end"><span class="lk-ic">${machineIcon(me.name)}</span><b>${esc(me.name)}</b><small>${upFirst(THIS_COMPUTER)}</small></div>
      <div class="lk-wire" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="lk-end"><span class="lk-ic">${machineIcon(p.name)}</span><b>${them}</b><small>${asking ? 'Asking to link' : 'Nearby'}</small></div>
    </div>
    ${done || failed ? `<div class="lk-result ${done ? 'ok' : 'no'}" aria-hidden="true"><span>${done ? ICONS.check : ICONS.close}</span></div>`
      : `<div class="lk-sas ${code ? '' : 'empty'}" ${code ? `aria-label="Code ${code.split('').join(' ')}"` : 'aria-hidden="true"'}>${[0, 1, 2, 3].map((i) => `<span>${code?.[i] ?? ''}</span>`).join('')}</div>`}
    <p class="pv-line ${failed ? 'failed' : ''}" aria-live="polite">${line}</p>
    <div class="sheet-foot">${foot}</div>`
}

// Link with a code: copy this computer's on one, paste it on the other. For another network, Tailscale, or a computer
// Nearby doesn't find. Copying it is what lets computers link to this one with it (sharing).
function codeHTML({ me }) {
  return `<h2 class="sheet-title"><span class="h-icon">${ICONS.link}</span>Link with a code</h2>
    <p class="lead">Copy the code on one computer and paste it on the other. For another network, Tailscale, or a computer Nearby doesn't find.</p>
    <div class="lk-codes">
      <section class="well lk-code">
        <b>${upFirst(THIS_COMPUTER)}'s code</b>
        <p>Paste it on your other computer, under Computers › Link with a code.</p>
        <div class="lk-row"><button class="btn primary lk-copy" data-link-copy>${linkOpen.copied ? `${ICONS.check}Copied` : `${ICONS.copy}Copy code`}</button>
          <span class="lk-hint">Anyone with it can use and drive your agents, so keep it to your own computers.</span></div>
      </section>
      <div class="lk-or"><span>or</span></div>
      <section class="well lk-code">
        <b>The other computer's code</b>
        <div class="code-in"><textarea class="field" data-link-code rows="2" placeholder="crew1.…" spellcheck="false" aria-label="The other computer's code"></textarea><button class="btn primary" data-link-connect>Link</button></div>
        <p class="err" data-link-err>${esc(linkErr)}</p>
      </section>
    </div>
    <div class="lk-share">
      <label class="lk-sw-row" title="Off: computers can't link to ${THIS_COMPUTER} with its code, and the ones that did are disconnected"><span>Let computers link with this code</span><input type="checkbox" class="switch" data-link-share ${me.share ? 'checked' : ''}></label>
      <span class="lk-btns" ${me.share && me.sharing ? '' : 'hidden'}><button class="btn sm" data-link-details-copy title="${esc(reachText(me.hosts))} For when a computer can't connect.">${linkOpen.detailsCopied ? 'Copied' : 'Copy connection details'}</button><button class="btn sm" data-link-reset>New code</button></span>
    </div>
    <div class="sheet-foot"><button class="btn" data-link-code-close>${ICONS.back}Back</button><span class="grow"></span><button class="btn" data-close>Done</button></div>`
}

// Why this computer can't share, in words. A port another app has is the usual one, and there's no setting for the port
// on screen (it's in Crew's settings file), so it says what you can do instead.
const sharingError = (error) => (/port \d+ is in use/.test(error)
  ? `Another app is using the port ${PRODUCT_NAME} Link listens on, so this computer can't share right now. Quit that app and reopen Computers.`
  : errorReason(error) || `${PRODUCT_NAME} couldn't start sharing this computer. Close Computers and open it again.`)
// How others reach this computer, in words: "Reachable over your local network and Tailscale."
function reachText(hosts = []) {
  const ways = [...new Set(hosts.map((h) => (/tailscale/i.test(h.via) ? 'Tailscale' : 'your local network')))]
  return ways.length ? `Reachable over ${ways.join(' and ')}.` : 'Not reachable over a network right now: check this computer is on Wi-Fi or Ethernet.'
}
// For Copy connection details: what someone helping you would ask for.
const connectionDetails = (me) => [`${me.name} (${me.slug}), ${PRODUCT_NAME} Link port ${me.port}`, ...(me.hosts ?? []).map((h) => `${h.address} (${h.via})`)].join('\n')

// How a linked computer is, in words on the row: "Online · local network · 7 agents", or "Offline · 3 agents · off,
// asleep or on another network" (it reconnects on its own).
function linkStatus(l) {
  const used = l.agents.filter((a) => !a.hidden).length
  const count = used < l.agents.length ? `${used} of ${plural(l.agents.length, 'agent')}` : plural(l.agents.length, 'agent')
  if (!l.online) {
    const err = l.status?.error ?? ''
    const why = l.status?.blocked ? 'macOS keeps it off the network' : /certificate|reset|version|stopped/.test(err) ? err : 'off, asleep or on another network'
    return { text: `Offline · ${count} · ${why}`, tip: 'It reconnects on its own' }
  }
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
  handing = null
  Object.assign(linkOpen, { code: false, copied: false, detailsCopied: false })
  linkOpen.computers.clear()
  phoneFresh = null
  phoneErr = ''
  linkKey = ''
  drawComputers(state)
  linkDialog.showModal()
  // Nearby: this computer says who it is on the network while the sheet is open, and lists the others doing the same
  const discover = () => crew.call('link', 'discover', true).catch((x) => crew.call('log', `discover: ${x.message}`))
  discover()
  clearInterval(discoverTick)
  discoverTick = setInterval(discover, 60000)
}

// Back from a takeover to the list: Link with a code closes, a linking that's done or failed is put away, one asking
// this computer is told no, and one this computer is asking is cancelled.
function linkBack() {
  const p = state.computers?.pairing
  if (p?.in) return crew.call('link', ...(p.in.stage === 'ask' ? ['pairAnswer', p.in.id, false] : ['pairDone']))
  if (p?.out) return crew.call('link', ['linked', 'failed'].includes(p.out.stage) ? 'pairDone' : 'pairCancel')
  linkOpen.code = false
  linkErr = ''
  codeTyped = ''
  drawComputers(state)
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
  const pc = t.closest('[data-lk-open]')?.dataset.lkOpen
  if (pc) return void (linkOpen.computers.has(pc) ? linkOpen.computers.delete(pc) : linkOpen.computers.add(pc), drawComputers(state))
  if (t.closest('[data-link-add], [data-link-code-open]')) {
    linkOpen.code = true
    drawComputers(state)
    return
  }
  if (t.closest('[data-link-code-close]')) return linkBack()
  try {
    // nearby: Link, and the linking view's buttons
    const pair = t.closest('[data-pair]')?.dataset.pair
    if (pair) await crew.call('link', 'pair', pair)
    if (t.closest('[data-pair-retry]')) await crew.call('link', 'pair', state.computers.pairing.out.id)
    if (t.closest('[data-pair-cancel], [data-pair-back], [data-pair-no]')) await linkBack()
    if (t.closest('[data-pair-yes]')) await crew.call('link', 'pairAnswer', state.computers.pairing.in.id, true)
    if (t.closest('[data-pair-confirm]')) await crew.call('link', 'pairConfirm')
    if (t.closest('[data-pair-done]')) handing ? linkHanded(handing) : await crew.call('link', 'pairDone')
    if (t.closest('[data-local-network]')) await crew.call('link', 'localNetwork')
    if (t.closest('[data-link-copy]')) {
      await crew.call('copy', await crew.call('link', 'code'))
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
        codeTyped = ''
        linkOpen.computers.add(fresh) // its agents unfolded, to pick from
        linkOpen.code = false
        linkKey = ''
        drawComputers(state)
        linkDialog.querySelector(`[data-computer="${CSS.escape(fresh)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } finally {
        btn.disabled = false
        btn.textContent = 'Link'
      }
    }
    const forget = t.closest('[data-forget]')?.dataset.forget
    if (forget && confirm(`Forget ${linked(forget)?.name}? Its agents disappear from here (they keep running there). Link it again any time.`)) await crew.call('link', 'forget', forget)
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
    if (linkOpen.code) fail(errorLine(x))
    else oops("Couldn't do that", x)
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
linkDialog.addEventListener('input', (e) => e.target.matches('[data-link-code]') && (codeTyped = e.target.value))
// Esc in a takeover (Add a phone, linking, Link with a code) goes back to the list. On keydown, since Chromium lets a
// dialog's cancel be stopped only so often before it closes the dialog anyway; cancel covers an Esc from outside it.
const inTakeover = () => phonePair || linkDialog.classList.contains('linking')
const takeoverBack = () => (phonePair ? closePairing() : linkBack())
linkDialog.addEventListener('keydown', (e) => e.key === 'Escape' && inTakeover() && (e.preventDefault(), takeoverBack()))
linkDialog.addEventListener('cancel', (e) => inTakeover() && (e.preventDefault(), takeoverBack()))
// Closing the sheet ends the phone pairing, stops Nearby (which cancels a linking under way, and says no to one asking)
linkDialog.addEventListener('close', () => {
  closePairing()
  clearInterval(discoverTick)
  discoverTick = null
  linkOpen.code = false
  codeTyped = ''
  crew.call('link', 'discover', false).catch(() => {})
})

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
  // the linked computers that have this workspace too
  const ws = state.workspace?.id
  const places = [{ slug: '', name: 'this computer' }, ...(state.computers?.links ?? []).filter((l) => l.online && l.spaces?.includes(ws))]
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

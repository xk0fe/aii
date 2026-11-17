// Full-screen view, laid out like a group chat: the sidebar (the workspace, its places, and a conversation with each
// agent) and what's open: a channel (#general or one you made), one agent's conversation with its terminal docked beside it,
// Agents, Tasks, Terminals or Usage.
/* global stopNow, mountSchedules, mountAccounts, mountUsage, shownName, mountTour, pageHead, headTitle, mountSearch, glide, reduceMotion, EASE, DUR, isUnread, mountWorkspaces, shortPath, pathParts, keys, keysIn, commandKey, workspaceKey, ON_WINDOWS, THIS_COMPUTER, upFirst, notify, oops, errorReason, errorLine, burst, wsColor, wsTile, wsLabel, statusClass, displayName, contextRing, ctxLevel, mountTasks, clique, live, store, morph, modeMarks, modeChips, powerSwitch, statusText, brainShort, brainLabel, brainWords, cliqueGroups, grouped, segmented, celebrate, agentColor, markSVG, mountFeed, mountComposer, mountCollection, avatarHTML, esc, plural, popMenu, ICONS, svg, Terminal, FitAddon, needsYou, needText, clonesOf, cloneTag, runningSubs, blockedOn, activityWords, isConvo, familyOf, nameHTML, hasWorkspaces, paceWarning, usageTip, usageLine, usageByComputer, resetsText, modelName, PRODUCT_NAME, mountSetup, faceStack, computerIcon, channelOf, pauseMenu, notifyTime, notifyClock, notifyHeld */

const $ = (s) => document.querySelector(s)
const THEME = {
  background: '#0f1012', foreground: '#e4e4e7', cursor: '#e4e4e7', cursorAccent: '#0f1012', selectionBackground: 'rgba(122, 162, 255, 0.3)',
  black: '#1d1f21', red: '#ff6b6b', green: '#4cd38a', yellow: '#ffd166', blue: '#7aa2ff', magenta: '#c58cff', cyan: '#36cfc9', white: '#d4d4d8',
  brightBlack: '#5c5f66', brightRed: '#ff8787', brightGreen: '#69db9a', brightYellow: '#ffe08a', brightBlue: '#9bb8ff', brightMagenta: '#d6a8ff', brightCyan: '#5fe0da', brightWhite: '#fafafa',
}

const terms = new Map() // name -> { tile, head, term, fit, ready }
let booted = false // the composer says who it's aimed at as it mounts, before what that opens exists
// The chat: a channel's messages, or your conversation with one agent (in every channel). What it's aimed at is the composer's
// target: an agent's name is that agent's conversation (see isConvo). What needs you is docked above the message box, one
// at a time (Needs you, as in the floating chat), not cards in the conversation.
const feed = mountFeed($('.feed'), {
  face: 36,
  onAgent: (name) => select(name),
  onConvo: (name) => openDM(name),
  onLeave: () => composer.setTarget('auto'),
  onChannel: (id) => setChannel(id, { go: false }),
  onTicket: (key) => openTask(key),
  onReply: (e) => composer.replyTo(e),
  onThread: (id, at) => openThread(id, at),
  onFound: () => closeSearch({ keep: true }),
  welcome: () => welcomeHTML(),
})
// A thread, beside the channel it's in. It closes when you go anywhere else.
const threadPane = mountThread($('.stage > .thread'), {
  onClose: () => $('.stage').classList.remove('threaded'),
  onSeen: () => feed.refresh(),
  onAgent: (name) => openDM(familyOf(name)),
  onCard: (id) => (threadPane.close(), feed.jump(id)),
})
function openThread(id, at) {
  threadPane.render(state)
  $('.stage').classList.add('threaded')
  threadPane.open(id, at)
}
const composer = mountComposer($('.compose'), { dropZone: $('.chat'), onSend: () => feed.toLatest(), onTarget: (to) => targetChanged(to), onDictate: () => place === 'chat' || place === 'dm' || goPlace('chat'), onLater: (button, held) => schedules.pick(button, held) })
// Scheduled messages (ui/schedules.js): the clock beside Send, the Send later sheet, and the list.
const schedules = mountSchedules({ later: $('#later'), list: $('#scheduled'), getState: () => state, push: async (next) => (push ??= await ready)(next) })
// Accounts (ui/accounts.js): each provider's sign-ins, from the ⋯ menu, the limits' popover and an agent's sheet.
const accounts = mountAccounts({ sheet: $('#accounts'), getState: () => state })
const collection = mountCollection($('.collection'), {
  onAccounts: () => accounts.open(),
  headIn: $('.heads'),
  onTerminal: (name) => select(name), onImport: () => importPack(), onMove: (name, home) => moveSheet(name, home),
  onWorkspace: () => workspaces.settings(),
  onRenamed: (from, to) => renamed(from, to),
})
const tasks = mountTasks($('.tasks-view'), { headIn: $('.heads'), onTerminal: (name) => select(name) })
// What Claude Code and Codex used on this computer, day by day (ui/usage.js)
const usage = mountUsage($('.usage-view'), { headIn: $('.heads') })
const workspaces = mountWorkspaces({ button: $('.ws-switch'), banner: $('.ws-banner'), dock: $('.ws-dock'), dialog: $('#ws'), onSwitch: (id, opts) => switchTo(id, opts), onSwitched: (next) => switched(next), onMembers: (at) => openMembers(at) })
// A new install's first run: Q makes its first workspace and clique with you, then shows you around (ui/setup.js). After
// that, the setup screen: Claude Code and Codex, what to install or sign in to, then the first agent.
// (onMade: the first run made its workspace. It comes in under the stage with no slide, whose parts would show over it.)
const setup = mountSetup({ onAdd: () => addAgent(), onWorkspace: () => workspaces.create(), onComputers: () => openComputers(), onMade: async (next) => (push ??= await ready)(next), onTour: () => startTour(), onLand: () => landed() })

// Q's tour of the app (ui/tour.js): where a first run ends, and in the ⋯ menu any time.
const Q_LOOK = { avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true } } // (core/system-agent.js)
const TOUR = [
  { at: '.stage .chat', before: () => goPlace('chat'), say: 'This is #general, the workspace’s chat. Everyone here reads it. When agents talk among themselves, it goes into a thread under your message, so this stays short.' },
  { at: '.compose', say: 'What you write goes to me, and I hand it on. Pick someone in To, or type @name, to talk to them directly.' },
  { at: '.roster', say: 'Your agents. Each one has its own conversation with you, and the dot shows who’s working and who needs you.' },
  { at: '.side-nav [data-place="clique"]', say: 'Agents: everyone’s card, with their brain, their look and a switch to turn them on and off.' },
  { at: '.side-nav [data-place="tasks"]', say: 'Tasks: a board for bigger work. An agent takes a task and reports back when it’s done.' },
  { at: '.side-nav [data-place="terminals"]', say: 'Every agent is a real Claude Code or Codex in a terminal. Watch one work, or type into it.' },
  { at: '.chan-sec', say: 'Channels keep one topic, with its own clique and its own rules.' },
  { at: '.rail', say: 'Each project is a workspace. Add another here, or link another computer and share its clique.' },
  { say: 'That’s the tour. Tell me what we’re working on.' },
]
const tour = mountTour({
  steps: () => TOUR,
  who: () => state?.agents?.find((a) => a.system) ?? Q_LOOK,
  onEnd: (done) => {
    store.set('clique.firstRun', 'done')
    if (done) composer.focus()
  },
})
// The first run is over, and its stage has been carried into the sidebar: #general, with what to ask first.
function landed() {
  goPlace('chat')
  composer.focus()
}
function startTour() {
  if (state?.workspace && !tour.isOn()) tour.start()
}

// Where you are: 'chat' (the channel open, see setChannel), 'dm' (the conversation the composer is aimed at), 'clique' (Agents, the cards),
// 'tasks', 'terminals' or 'usage'. The terminals are laid out as a grid or one big one.
const PLACES = ['chat', 'clique', 'tasks', 'terminals', 'usage']
let place = store.get('clique.place') === 'dm' || PLACES.includes(store.get('clique.place')) ? store.get('clique.place') : 'chat'
let layout = store.get('clique.layout') === 'focus' ? 'focus' : 'grid'
let lastDm = null // the agent whose conversation was open last, and when you left it (an agent renamed or gone)
let left = null
let selected = null // the terminal picked in Terminals
let dockPick = null // the terminal picked in a conversation's dock: the agent's own, or one of its clones'
let state = { agents: [], providers: {}, feed: [] }
// the roster's folds: computers you folded away
const folds = new Set((() => {
  try {
    return JSON.parse(store.get('clique.folds') || '[]')
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
const NAV_ICON = { clique: markSVG('0 4 24 18'), tasks: ICONS.task, terminals: ICONS.terminal, usage: ICONS.chart }
for (const b of document.querySelectorAll('.nv .nv-icon')) b.outerHTML = NAV_ICON[b.closest('.nv').dataset.place]
// Terminals' header: the grid or one big one. (Every terminal shows; the ones waiting on you come first.)
$('.heads').insertAdjacentHTML('beforeend', pageHead({
  id: 'terminals', glyph: ICONS.terminal, title: 'Terminals',
  tools: `<div class="seg icons tv-layout" data-layout><button data-layout="grid" title="Every terminal side by side" aria-label="Grid">${ICONS.grid}</button><button data-layout="focus" title="One terminal, big" aria-label="Focus">${ICONS.focus}</button></div>`,
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
// the page's own hints in this computer's keys (⌘F is Ctrl+F on Windows)
for (const el of document.querySelectorAll('[title]')) el.title = keysIn(el.title)

// ---- what's open ----------------------------------------------------------------------------------------------

// The agent whose conversation is open (an agent, for a clone's), and its terminal in the dock: the one picked there,
// else the one the conversation is with, else its first clone's. Off agents have no terminal: no dock. A resting one has
// none yet: the dock keeps its place, and says so.
const dmAgent = () => (isConvo(composer.target()) ? state.agents.find((a) => a.name === familyOf(composer.target())) ?? state.agents.find((a) => a.name === composer.target()) : null)
const family = (name) => [...terms.keys()].filter((n) => familyOf(n) === familyOf(name))
function dockName() {
  if (place !== 'dm') return null
  const fam = family(composer.target())
  return [dockPick, composer.target(), familyOf(composer.target())].find((n) => n && fam.includes(n)) ?? fam[0] ?? null
}
const dockOn = () => store.get('clique.dock') !== '0'
const restingHere = () => {
  const a = place === 'dm' ? dmAgent() : null
  return a?.status === 'resting' && !family(a.name).length ? a : null
}
const docked = () => place === 'dm' && dockOn() && Boolean(dockName() || restingHere())

// Open a place, or the conversation the composer's aimed at ('dm'). Views that are hidden skip their redraws: the one
// coming into view catches up first, still hidden.
function showPlace(next) {
  if (next === 'dm' && !isConvo(composer.target())) next = 'chat'
  const moved = next !== place
  if (moved) (openMenu?.close(), document.querySelector('.use-pop:popover-open')?.hidePopover()) // a menu from the last place doesn't float over this one
  if (moved) closeSearch()
  if (moved && next !== 'chat') threadPane.close()
  place = next
  store.set('clique.place', next)
  if (place === 'dm') lastDm = dmAgent()?.name ?? lastDm
  const dock = docked()
  collection.setVisible(place === 'clique')
  tasks.setVisible(place === 'tasks')
  usage.setVisible(place === 'usage')
  $('.usage-view').classList.toggle('hidden', place !== 'usage')
  $('.chat').classList.toggle('hidden', place !== 'chat' && place !== 'dm')
  $('.collection').classList.toggle('hidden', place !== 'clique')
  $('.tasks-view').classList.toggle('hidden', place !== 'tasks')
  $('.terms-view').classList.toggle('hidden', place !== 'terminals' && !dock)
  $('.terms-view').classList.toggle('docked', dock)
  $('.stage').classList.toggle('docked', dock)
  $('.terms').classList.toggle('focus', dock || layout === 'focus')
  for (const b of document.querySelectorAll('.nv')) b.dataset.place === place ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')
  showHead()
  segmented($('[data-layout]'), (b) => b.dataset.layout === layout)
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
  tellLooking()
}
// What's open here, said to the app whenever it changes, so nothing notifies you about the place you're looking at
// (core/notify.js lookingAt): the conversation's agent, the agents whose question shows in the open channel, or Tasks.
let lookingSaid = ''
function tellLooking() {
  const view = {
    ws: state.workspace?.id ?? '',
    agent: place === 'dm' ? dmAgent()?.name ?? null : null,
    // (Needs you is over the message box in a channel and in a conversation, whichever channel it was asked in)
    sees: place === 'chat' || place === 'dm' ? needsYou(state).filter((n) => n.ask).map((n) => n.agent.name) : [],
    tasks: place === 'tasks',
  }
  const said = JSON.stringify(view)
  if (said === lookingSaid) return
  lookingSaid = said
  clique.looking?.(view)
}
let lastShape = ''
// A place from the sidebar (or ⌘1–5): the composer goes back to everyone, which only a channel shows.
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
  if (terminal) store.set('clique.dock', '1')
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
// A channel: its name, and its menu (its brief, who's in it, its folder). Its brief and who it reaches are in the name's
// tooltip; what's waiting on you is docked over the message box (Needs you), and who's in it is in the menu.
function chatHead() {
  const c = openChannel()
  const folder = state.workspace?.folder
  const tip = [c.brief || `Everyone in ${wsLabel(state.workspace)}`, folder && `Its agents work in ${tildePath(folder)}, unless one has a folder of its own here`].filter(Boolean).join('\n\n')
  return [headTitle({ glyph: '#', title: `<span title="${esc(tip)}">${esc(c.name)}</span>` }),
    `<button class="icon" data-head="channel" title="Channel: its brief, who's in it, its folder" aria-label="Channel menu" aria-haspopup="menu">${ICONS.more}</button>`]
}
// An agent: its creature and name, and its job (Off when it's off), then its terminal, its profile (the sheet: brain,
// YOLO, folder, instructions, look) and everything else (⋯: on and off, a new conversation, moving it). How it is, its
// brain, its modes, its clones and helpers are in the name's tooltip.
function dmHead(a) {
  const clones = clonesOf(state.agents, a).filter((c) => c.on)
  const helpers = runningSubs(a).length
  const tip = [a.area, upFirst(statusText(a)), brainLabel(a, state.providers), a.yolo && 'YOLO: skips every permission prompt', clones.length ? plural(clones.length, 'clone') : helpers ? plural(helpers, 'helper') : ''].filter(Boolean).join('\n')
  const canDock = family(a.name).length > 0 || a.status === 'resting'
  return [headTitle({ glyph: avatarHTML(a, { size: 28 }), title: `<span title="${esc(tip)}">${nameHTML({ ...a, cloneOf: null })}</span>`, sub: esc(a.on ? a.area ?? '' : 'Off') }),
    `<button class="btn" data-head="terminal" aria-pressed="${docked()}" ${canDock ? '' : 'disabled'} title="${canDock ? (docked() ? 'Put its terminal away' : 'Show its terminal beside the conversation') : `${esc(a.seed ?? a.name)} is off: no terminal`}">${ICONS.terminal}<span>Terminal</span></button>
      <button class="btn" data-head="profile" title="Its brain, YOLO, folder, rules, instructions and look">${ICONS.edit}<span>Profile</span></button>
      <button class="icon" data-head="menu" title="On and off, a new conversation, moving it" aria-label="More" aria-haspopup="menu">${ICONS.more}</button>`]
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
  if (act === 'channel') return channelMenu(openChannel().id, b, { head: true })
  if (act === 'folder') return openFolder(state.workspace)
  if (!a) return
  if (act === 'terminal') {
    store.set('clique.dock', docked() ? '0' : '1')
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
const chanKey = () => `clique.channel.${state.workspace?.id}`
// The workspace's channel, as it was left (one that's gone: #general), told to the chat and the composer.
function syncChannel() {
  const kept = store.get(chanKey())
  const next = channelsNow().some((c) => c.id === kept) ? kept : 'general'
  if (next !== chan && booted) (closeSearch(), threadPane.close()) // the search and the thread were the last channel's
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
  tellLooking()
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
    // new replies make its name bold; its questions for you are in Needs you and on who asked them, not counted here too
    return `<button class="nv ch${unread ? ' fresh' : ''}" data-channel="${esc(c.id)}" role="listitem"${on ? ' aria-current="page"' : ''} title="${esc(tip)}"><span class="hash" aria-hidden="true">#</span><span class="ch-name">${esc(c.name)}</span></button>`
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

// head: opened from the channel's header, so it also has who's in it and its folder (the header shows only its name)
function channelMenu(id, at, { head = false } = {}) {
  const c = channelsNow().find((x) => x.id === id)
  if (!c) return
  const everyone = state.agents.filter((a) => !a.cloneOf)
  const members = c.members ? everyone.filter((a) => c.members.includes(a.name)) : everyone
  const folder = state.workspace?.folder
  popMenu(at, [
    { head: `#${c.name}` },
    { label: c.id === 'general' ? (c.brief ? 'Edit its brief…' : 'Give it a brief…') : 'Edit channel…', icon: ICONS.edit, act: 'edit' },
    ...(head ? [{ label: c.members ? 'Members…' : 'Who works here…', icon: ICONS.computers, act: 'members', hint: plural(members.length, 'agent') }] : []),
    ...(head && folder && FOLDER_APP ? [{ label: OPEN_FOLDER, icon: ICONS.folder, act: 'folder', hint: tildePath(folder) }] : []),
    ...(c.id === 'general' ? [] : ['-', { label: `Delete #${c.name}…`, icon: ICONS.trash, act: 'remove', danger: true }]),
  ], (act) => {
    if (act === 'edit') channelSheet(id)
    if (act === 'members') return c.members ? channelSheet(id) : openMembers(at)
    if (act === 'folder') openFolder(state.workspace)
    if (act === 'remove') removeChannel(c)
  })
}

async function removeChannel(c, ws = state.workspace?.id) {
  if (!confirm(`Delete #${c.name}? Its messages stay, in #general. Agents stop getting its brief.`)) return
  try {
    const { state: next } = await clique.call('channel', 'remove', c.id, null, ws)
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
      <ul class="ws-clique ch-clique"></ul>
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
  const agents = state.agents.filter((a) => !a.cloneOf && !a.system) // (Q is in every channel)
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
  const agents = state.agents.filter((a) => !a.cloneOf && !a.system)
  const name = channelName(d.name)
  const general = d.id === 'general'
  const tokens = tokensIn(d.brief)
  $c('[data-ch-cost]').textContent = tokens ? `about ${plural(tokens, 'token')}, once per conversation` : ''
  const members = d.everyone ? agents : agents.filter((a) => d.members.has(a.name))
  $c('[data-ch-sub]').innerHTML = general
    ? `${faceStack(agents, 6)}<span>Everyone in ${esc(state.workspace?.name ?? 'your clique')}. Messages from a phone or the floating chat land here.</span>`
    : name && name !== d.name.trim() ? `<span>It will be #${esc(name)}</span>`
    : members.length ? `${faceStack(members, 6)}<span>${d.everyone ? `Everyone in ${esc(state.workspace?.name ?? 'your clique')}` : plural(members.length, 'agent')}</span>` : '<span>Nobody in it yet</span>'
  segmented($c('.ch-who-seg'), (b) => (b.dataset.chAll === '1') === d.everyone)
  $c('[data-ch-count]').textContent = d.everyone ? '' : `${members.length} of ${agents.length}`
  $c('.ch-clique').classList.toggle('hidden', d.everyone)
  const picks = systemAgentOf(state.agents) ? `${displayName(systemAgentOf(state.agents))} hands work` : 'Auto picks'
  $c('[data-ch-note]').textContent = d.everyone
    ? `${picks} ${systemAgentOf(state.agents) ? 'to' : 'from'} everyone in the workspace, as in #general.`
    : `${picks} ${systemAgentOf(state.agents) ? 'only to' : 'only from'} these agents. An @mention still reaches anyone.`
  if (list) {
    $c('.ch-clique').innerHTML = agents.map((a) => {
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
    const { id, state: next } = await clique.call('channel', d.id ? 'edit' : 'create', d.id, patch, d.ws)
    channelDialog.close()
    ;(push ??= await ready)(next)
    if (!d.id) setChannel(id) // a new one opens; an edited one stays where you are
  } catch (err) {
    $c('[data-ch-err]').textContent = errorLine(err)
  }
}

// ---- who works here: the workspace's agents, from #general's faces, the workspace's menu or its welcome -----------------
// Its agents (one shared with your other workspaces can be taken out of this one), the rest of your clique (bring one
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
  const here = state.agents.filter((a) => !a.cloneOf && !a.system) // (Q comes with it: he's not yours to choose)
  const others = (state.roster ?? []).filter((r) => !here.some((a) => a.name === r.name))
  const row = (a, end) => `<div class="mp-row" data-agent="${esc(a.name)}">${avatarHTML(a, { size: 30, mood: 'still' })}<span class="mp-who"><b>${esc(a.seed ?? a.name)}</b><small>${esc(a.area || (a.status ? upFirst(statusText(a)) : ''))}</small></span>${end}</div>`
  const take = (a) => (a.shared ? `<button class="btn sm plain mp-take" data-mp-take="${esc(a.name)}" title="${esc(`Take ${a.name} out of ${w.name}: it stays in your clique and your other workspaces`)}">Take out</button>` : '<span class="mp-only" title="Made for this workspace: it works only here">only here</span>')
  morph(membersPop, `<header class="mp-head"><b>Who works here</b><span>${here.length}</span></header>
    <p class="mp-lead">${esc(w.name)}'s agents${w.folder ? `, in ${esc(tildePath(w.folder))}` : ''}. One from your clique works here in a conversation of its own.</p>
    <div class="mp-body">
      ${here.length ? here.map((a) => row(a, take(a))).join('') : `<p class="mp-lead">Nobody yet.</p>`}
      ${others.length ? `<div class="mp-sec section-label">From your clique</div>${others.map((r) => row({ ...r, status: '' }, `<button class="btn sm mp-add" data-mp-add="${esc(r.name)}">Add</button>`)).join('')}` : ''}
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
      await clique.call('workspace', 'members', w.id, { add: [add] })
      toast(`${add} joins ${w.name}${w.folder ? `, working in ${shortPath(w.folder)}` : ''}`)
    }
    if (out) {
      const a = state.agents.find((x) => x.name === out)
      if (busy(a) ? !confirm(`${out} is in the middle of something in ${w.name}. Take it out anyway? It stops working here, and starts a fresh conversation if it comes back.`) : !confirm(`Take ${out} out of ${w.name}? It stops working here, and starts a fresh conversation if it comes back. It stays in your clique and your other workspaces.`)) return
      await clique.call('workspace', 'members', w.id, { remove: [out] })
    }
  } catch (err) {
    oops(add ? `Couldn't add ${add} to ${w.name}` : `Couldn't take ${out} out of ${w.name}`, err)
  }
  if (e.target.closest('[data-mp-new]')) (membersPop.hidePopover(), addAgent())
  if (e.target.closest('[data-mp-agents]')) (membersPop.hidePopover(), goPlace('clique'))
  const row = !add && !out && e.target.closest('.mp-row:not(:has([data-mp-add]))')
  if (row) (membersPop.hidePopover(), openDM(row.dataset.agent), composer.focus())
})

// ---- an empty #general: what to do first -------------------------------------------------------------------------------
// One question at display size and three things to ask, for the kind of work this workspace was made for (ui/setup.js
// WORK; a click writes one in the message box). Under them, quietly: who works here and where, each a click away.
function welcomeHTML() {
  const w = state.workspace
  if (!w) return '' // the very first run: the setup screen asks for one
  const here = state.agents.filter((a) => !a.cloneOf && !a.system)
  const sys = systemAgentOf(state.agents)
  const starters = sys || here.length ? setup.starters(store.get(`clique.work.${w.id}`)) : []
  const who = here.length ? `${plural(here.length, 'agent')} work${here.length > 1 ? '' : 's'} here` : 'Choose who works here'
  return `<div class="welcome empty-state">${sys ? `<span class="wl-q">${avatarHTML(sys, { size: 96, mood: 'idle' })}</span>` : wsTile(w, { size: 64 })}
    <h2 class="display wl-ask">${starters.length ? 'What should we do first?' : `Welcome to ${esc(w.name)}`}</h2>
    ${starters.length ? `<div class="wl-starters">${starters.map((s) => `<button type="button" class="wl-start" data-welcome-say="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <p class="wl-meta"><button type="button" data-welcome="members">${esc(who)}</button><span>·</span><button type="button" data-welcome="settings">${w.folder ? esc(tildePath(w.folder)) : 'Pick its folder'}</button></p></div>`
}
$('.feed').addEventListener('click', (e) => {
  const act = e.target.closest('[data-welcome]')?.dataset.welcome
  if (act === 'members') openMembers(e.target.closest('[data-welcome]'))
  if (act === 'settings') workspaces.settings()
  const say = e.target.closest('[data-welcome-say]')?.dataset.welcomeSay
  if (say) composer.setText(say)
})

// What's waiting on you, oldest first: a question goes to its card in its channel, an agent asking in its terminal to
// that.
function answerOldest() {
  const n = needsYou(state)[0]
  if (!n) return
  if (!n.ask) return select(n.agent.name)
  if (place !== 'chat' && place !== 'dm') goPlace('chat')
  requestAnimationFrame(() => feed.jump(n.ask.id)) // (it opens in Needs you, over the message box)
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
  const resting = docked() && restingHere()
  $('.terms-view').classList.toggle('resting', Boolean(resting))
  morph($('.dock-rest'), resting ? restPanel(resting) : '')
  if (resting) return morph(bar, `<div class="dock-tabs" role="tablist"><button class="dock-tab" role="tab" aria-selected="true" tabindex="-1">${avatarHTML(resting, { size: 18, mood: 'still' })}<span>${esc(resting.seed ?? resting.name)}</span></button></div>
    <span class="grow"></span><span class="t-badge" data-mode="resting" title="Its terminal isn't running. A message starts it.">Resting</span>
    <button class="icon" data-dock-act="close" title="Put the terminal away">${ICONS.close}</button>`)
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
    store.set('clique.dock', '0')
    showPlace('dm')
  }
  if (act === 'expand') {
    selected = dockName()
    layout = 'focus'
    store.set('clique.layout', layout)
    goPlace('terminals')
  }
})

// In the dock while nothing runs: who, why, and the one thing there is to do about it.
const restPanel = (a) => `${avatarHTML(a, { size: 72, pose: 'mug' })}<h3>${esc(displayName(a))} is resting</h3>
  <p>Its terminal isn't running. A message starts it, and it picks up its conversation.</p>
  <button class="btn" data-rest-start="${esc(a.name)}">${ICONS.terminal}<span>Start its terminal</span></button>`
$('.dock-rest').addEventListener('click', (e) => {
  const name = e.target.closest('[data-rest-start]')?.dataset.restStart
  if (name) clique.call('restart', name).catch((err) => oops(`Couldn't start ${name}'s terminal`, err))
})

// Everything the titlebar used to carry, at the sidebar's foot: Autopilot, staying awake, Computers, the CLIs, where the
// floating chat lives and the theme (and, running from source, config.json).
const THEME_CHOICES = [['system', 'Auto', 'auto', `follows ${ON_WINDOWS ? 'Windows' : 'macOS'}`], ['light', 'Light', 'sun', ''], ['dark', 'Dark', 'moon', '']]
$('.side-more').addEventListener('click', (e) => {
  const theme = state.theme ?? 'system'
  const c = state.computers ?? { me: {}, links: [] }
  const away = c.links.filter((l) => !l.online).length
  popMenu(e.currentTarget, [
    { label: 'Autopilot', icon: ICONS.plane, act: 'autopilot', hint: state.autopilot ? 'On: hand-offs go through' : 'Off: hand-offs wait for you' },
    { label: 'Spend check-in…', icon: ICONS.coin, act: 'checkin', hint: checkInHint() },
    { label: 'Stay awake', icon: ICONS.mug, act: 'awake', hint: state.awake?.enabled ?? true ? 'On: while agents work' : `Off: this ${ON_WINDOWS ? 'PC' : 'Mac'} may sleep mid-task` },
    { label: 'Token savers…', icon: ICONS.chart, act: 'savers', hint: saversHint() },
    { label: 'Agent tools…', icon: ICONS.mark, act: 'tools', hint: toolHint() },
    { label: 'Notifications…', icon: state.notify?.quiet ? ICONS.bellZ : ICONS.bell, act: 'notify', hint: notifyHint() },
    ...(state.workspace ? [{ label: 'Scheduled messages…', icon: ICONS.clock, act: 'scheduled', hint: schedules.count() ? `${schedules.count()} set up` : '' }] : []),
    '-',
    { label: 'Computers…', icon: ICONS.computers, act: 'computers', hint: away ? `${away} offline` : c.links.length ? `${c.links.length + 1} linked` : '' },
    { label: 'Claude Code and Codex…', icon: ICONS.terminal, act: 'setup' },
    { label: 'Accounts…', icon: ICONS.user, act: 'accounts', hint: accountsHint() },
    ...(state.workspace ? [{ label: 'Take the tour', icon: ICONS.sparkles, act: 'tour', hint: 'Q shows you around' }] : []),
    ...(ON_WINDOWS ? [] : [{ label: 'Permissions…', icon: ICONS.shield, act: 'permissions' }]),
    ...appItems(state),
    ...chatItems(state),
    '-',
    { head: 'Theme' },
    ...THEME_CHOICES.map(([id, label, icon, note]) => ({ label, icon: ICONS[icon], act: `theme:${id}`, hint: theme === id ? '✓' : note })),
    ...(clique.dev ? ['-', { label: 'Open config.json', icon: ICONS.braces, act: 'config', hint: 'developer' }] : []),
  ], (act) => {
    if (act === 'autopilot') clique.call('autopilot', !state.autopilot).catch((err) => oops("Couldn't change Autopilot", err))
    if (act === 'checkin') openCheckIn()
    if (act === 'awake') clique.call('keepAwake', !(state.awake?.enabled ?? true)).catch((err) => oops("Couldn't change that", err))
    if (act === 'savers') openSavers()
    if (act === 'tools') openTools()
    if (act === 'notify') openNotify()
    if (act === 'scheduled') schedules.openList()
    if (act === 'computers') openComputers()
    if (act === 'setup') setup.open()
    if (act === 'accounts') accounts.open()
    if (act === 'tour') startTour()
    if (act === 'permissions') clique.call('openPermissions').catch((err) => oops('Couldn’t open that', err))
    if (act.startsWith('theme:')) clique.call('theme', act.slice(6)).catch((err) => oops('Couldn’t change the theme', err))
    if (act === 'config') clique.call('config')
    chatPick(act, state)
    appPick(act, state)
  })
})

// ---- an update that's ready: a note in the corner, once per version (core/updates.js) -----------------------------

// "CLIque 1.0.1 is ready", with Restart to update and Later. Restart while agents work turns it into the question
// first, with what happens to them (main.js restartToUpdate): the button that's safe is the one that's filled. Later
// puts it away for this version; the ⋯ menu keeps Restart to update. It floats over the corner: nothing moves for it.
const updateNote = $('.update-note')
function drawUpdate(state) {
  const u = state.app?.update
  const show = Boolean(u?.next) && (u.phase === 'restarting' || (u.phase === 'ready' && (!u.later || u.asking || u.stuck)))
  updateNote.classList.toggle('show', show)
  updateNote.inert = !show
  if (!show) return // it keeps its words while it fades
  placeUpdateNote()
  const name = `${PRODUCT_NAME} ${u.next.version}`
  const ask = u.phase === 'ready' ? u.asking : null
  const btn = (act, label, primary) => `<button class="btn ${primary ? 'primary' : ''}" data-update="${act}">${esc(label)}</button>`
  const body = u.phase === 'restarting' ? `<b class="un-title">Restarting…</b><p>${esc(name)} opens in a moment.</p>`
    : ask ? `<b class="un-title">Restart to update?</b><p>${esc(ask.text)}</p>
      <div class="un-acts">${ask.safe === 'go' ? btn('go', ask.go, true) + btn('wait', ask.wait) : btn('wait', ask.wait, true) + btn('go', ask.go)}</div>`
      : `<b class="un-title">${esc(name)} is ready</b>
      <p>${u.stuck ? `${esc(PRODUCT_NAME)} couldn’t restart. Try again.` : 'Restart to update.'}${u.next.notesUrl ? ` <a href="#" data-update="notes">What’s new</a>` : ''}</p>
      <div class="un-acts">${btn('go', 'Restart to update', true)}${btn('later', 'Later')}</div>`
  morph(updateNote, `<span class="un-mark">${ICONS.mark}</span><div class="un-body">${body}</div>`)
}
// Over the corner, but never over a message box: with one down there (the chat's, a thread's), it sits just above it.
const noteWatch = new ResizeObserver(() => placeUpdateNote())
function placeUpdateNote() {
  let bottom = 16
  for (const box of document.querySelectorAll('.composer')) {
    noteWatch.observe(box) // (once each: observing again does nothing)
    const r = box.getBoundingClientRect()
    if (r.width && r.right > innerWidth - 16 - updateNote.offsetWidth && r.bottom > innerHeight - 160) bottom = Math.max(bottom, Math.round(innerHeight - r.top) + 4)
  }
  updateNote.style.bottom = `${bottom}px`
}
addEventListener('resize', placeUpdateNote)
updateNote.addEventListener('click', (e) => {
  const act = e.target.closest('[data-update]')?.dataset.update
  if (!act) return
  e.preventDefault()
  const u = state.app?.update
  if (act === 'notes') return u?.next?.notesUrl && clique.call('openUrl', u.next.notesUrl)
  // Not now and Later both put it away; Restart says which question (if any) you said yes to
  const call = act === 'go' ? clique.call('update', 'restart', u?.asking?.text ?? null) : clique.call('update', 'later')
  call.catch((err) => oops('Couldn’t do that', err))
})

// ---- the spend check-in (core/hub.js checkIn): per provider, what its agents may use on one request before they
// check in, in the unit that provider's CLI reports. Built like an agent's Context limit (ui/collection.js drawLimit):
// a row of values and a Custom field for each provider, what happens when it's reached, and one line that says it.

const checkInDialog = $('#checkin')
checkInDialog.querySelector('.h-icon').innerHTML = ICONS.coin
// The providers that have a meter (core/providers.js), the ones your picker offers. One without a meter has no row.
const checkInProviders = () => Object.entries(state.providers ?? {}).filter(([, p]) => p.meter && p.added !== false).map(([id, p]) => ({ id, label: p.label ?? id, ...p.meter }))
const checkInSet = () => checkInProviders().filter((p) => state.checkIn?.at?.[p.id])
const checkInHint = () => {
  const set = checkInSet()
  return set.length ? set.map((p) => `${set.length > 1 ? `${p.label} ` : ''}${meterPick(p.unit, state.checkIn.at[p.id])}`).join(' · ') : 'Off'
}
// A Custom field holds dollars, or millions of tokens.
const checkInTyped = (unit, v) => (unit === 'usd' ? Math.round(Number(v) * 100) / 100 : Math.round(Number(v) * 1e6))
let checkInKey = ''
function drawCheckIn() {
  const list = checkInProviders()
  const host = checkInDialog.querySelector('.ci-list')
  const key = JSON.stringify(list)
  if (key !== checkInKey) {
    checkInKey = key
    host.innerHTML = list.map((p) => `
      <div class="ed-row" data-ci-row="${esc(p.id)}"><span class="ed-label">${esc(p.label)}<small>check in after</small></span><div class="ed-ctl">
        <div class="seg fill" data-ci="${esc(p.id)}"><button type="button" data-v="">Off</button>${p.presets.map((v) => `<button type="button" data-v="${v}">${meterPick(p.unit, v)}</button>`).join('')}<label class="limit-custom ci-custom ${p.unit}"><input type="number" min="0" step="${p.unit === 'usd' ? 1 : 0.5}" data-ci-custom="${esc(p.id)}" placeholder="Custom" title="${p.unit === 'usd' ? 'Any amount, in dollars' : 'Any number, in millions of tokens'}"><span>${p.unit === 'usd' ? '$' : 'M'}</span></label></div>
      </div></div>`).join('') +
      '<div class="ed-row when-row"><span class="ed-label">When it’s reached</span><div class="ed-ctl"><div class="seg fill" data-ci-then><button type="button" data-v="ask">Ask me</button><button type="button" data-v="tell">Just tell me</button></div></div></div>' +
      '<p class="limit-note ci-says"></p>'
  }
  syncCheckIn()
}
// What a pick changes, in place (so the thumb slides and a field keeps its focus): the picks, whether "When it's
// reached" applies, and the line under them.
function syncCheckIn() {
  const host = checkInDialog.querySelector('.ci-list')
  const at = state.checkIn?.at ?? {}
  for (const p of checkInProviders()) {
    const seg = host.querySelector(`[data-ci="${CSS.escape(p.id)}"]`)
    if (!seg) continue
    const v = at[p.id] || 0
    const preset = !v || p.presets.includes(v)
    segmented(seg, (el) => (el.matches('.ci-custom') ? !preset : (Number(el.dataset.v) || 0) === v), { none: true })
    const field = seg.querySelector('[data-ci-custom]')
    if (document.activeElement !== field) field.value = preset ? '' : p.unit === 'usd' ? v : +(v / 1e6).toFixed(2)
  }
  const set = checkInSet()
  const tell = state.checkIn?.then === 'tell'
  segmented(host.querySelector('[data-ci-then]'), (el) => el.dataset.v === (tell ? 'tell' : 'ask'), { none: true })
  host.querySelector('.when-row').classList.toggle('off', !set.length)
  const past = set.map((p) => `${meterPick(p.unit, at[p.id])}${p.unit === 'tokens' ? ' tokens' : ''} for ${p.label}`).join(' or ')
  host.querySelector('.ci-says').textContent = !set.length ? 'Off. Nothing checks in until you pick a value.'
    : tell ? `Past ${past} since you last spoke, you get one line in the chat and a notification. Nothing is held.`
    : `Past ${past} since you last spoke, one card asks you. Until you answer, nothing new starts; turns already running finish.`
}
function openCheckIn() {
  checkInDialog.querySelector('[data-ci-err]').textContent = ''
  drawCheckIn()
  checkInDialog.showModal()
}
// shown now; the state that follows says it for good
function setCheckIn(patch) {
  const was = state.checkIn
  const at = { ...(was?.at ?? {}), ...(patch.at ?? {}) }
  for (const k of Object.keys(at)) if (!at[k]) delete at[k]
  state.checkIn = { at, then: patch.then ?? was?.then ?? 'ask' }
  checkInDialog.querySelector('[data-ci-err]').textContent = ''
  syncCheckIn()
  clique.call('checkIn', patch).catch((x) => {
    state.checkIn = was
    syncCheckIn()
    checkInDialog.querySelector('[data-ci-err]').textContent = errorLine(x)
  })
}
checkInDialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === checkInDialog) return checkInDialog.close()
  const pick = e.target.closest('[data-ci] button[data-v]')
  if (pick) {
    const id = pick.closest('[data-ci]').dataset.ci
    const v = Number(pick.dataset.v) || null
    if ((state.checkIn?.at?.[id] ?? null) !== v) setCheckIn({ at: { [id]: v } })
    return
  }
  const then = e.target.closest('[data-ci-then] button[data-v]')
  if (then && then.dataset.v !== (state.checkIn?.then ?? 'ask')) setCheckIn({ then: then.dataset.v })
})
// a value of your own: taken as you type it (an empty field is Off)
checkInDialog.addEventListener('input', (e) => {
  const id = e.target.dataset.ciCustom
  if (!id) return
  const p = checkInProviders().find((x) => x.id === id)
  const v = checkInTyped(p.unit, e.target.value)
  setCheckIn({ at: { [id]: v > 0 ? v : null } })
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
  busyCheck: [(c) => `clique busy was run ${times(c.n)}`, (c) => `clique busy was run ${times(c.n)}`],
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
  saversDialog.querySelector('.sv-forced').textContent = forced ? 'CLIQUE_SAVERS is set, so it decides which are on.' : ''
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
  clique.call('savers', { [sw.dataset.sv]: sw.checked }).catch((x) => {
    sw.checked = !sw.checked
    saversDialog.querySelector('[data-sv-err]').textContent = errorLine(x)
  })
})
saversDialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === saversDialog) saversDialog.close()
})

// ---- agent tools (core/tools.js): what agents may change in CLIque with `clique app`, and whether they ask first ----

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
  ['clock', 'Scheduled messages', 'Set up messages that go out later or on a repeat, pause them and start them again. Removing one always asks.', true],
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
  clique.call('tools', pick.dataset.tl).catch((x) => {
    state.tools = was
    drawTools()
    toolsDialog.querySelector('[data-tl-err]').textContent = errorLine(x)
  })
})

// ---- notifications (core/notify.js): the hours CLIque may interrupt you in, and the pause ----

const notifyDialog = $('#notify')
notifyDialog.querySelector('.h-icon').innerHTML = ICONS.bell
notifyDialog.querySelector('[data-nf-bar]').textContent = ON_WINDOWS ? 'taskbar' : 'menu bar'
notifyDialog.querySelector('[data-nf-icon=eye]').innerHTML = ICONS.eye
notifyDialog.querySelector('[data-nf-icon=stack]').innerHTML = ICONS.stack
const notifyNow = () => state.notify ?? { days: 'always', from: '08:00', to: '22:00', pause: null, quiet: false, why: null, until: null, held: 0 }
const notifyHint = () => {
  const n = notifyNow()
  if (n.quiet) return n.why === 'pause' ? (n.until == null ? 'Paused' : `Paused until ${notifyTime(n.until)}`) : n.until == null ? 'Off' : `Off until ${notifyTime(n.until)}`
  return n.days === 'always' ? 'Any time' : `${n.days === 'weekdays' ? 'Weekdays' : 'Every day'}, ${notifyClock(n.from)} to ${notifyClock(n.to)}`
}
// When you won't be notified, in a sentence (the hours a schedule leaves out, and its days).
function notifySentence(n) {
  if (n.days === 'always') return 'CLIque may notify you at any time. Pause it below, or from its icon, when you need quiet.'
  const [from, to] = [notifyClock(n.from), notifyClock(n.to)]
  const night = n.from === n.to ? '' : `between ${to} and ${from}`
  const weekend = n.days === 'weekdays' ? (n.to > n.from || n.from === n.to ? 'on Saturday and Sunday' : 'over the weekend') : ''
  if (!night && !weekend) return 'CLIque may notify you at any time: these hours cover the whole day.'
  return `You won’t be notified ${[night, weekend].filter(Boolean).join(', or ')}. What comes up then is held, and you get one summary when your hours start again.`
}
const NF_TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
function drawNotify() {
  const n = notifyNow()
  segmented(notifyDialog.querySelector('.nf-days'), (b) => b.dataset.nfDays === n.days)
  notifyDialog.querySelector('.nf-any').classList.toggle('on', n.days === 'always')
  notifyDialog.querySelector('.nf-hours').classList.toggle('on', n.days !== 'always')
  for (const sel of notifyDialog.querySelectorAll('[data-nf-time]')) {
    const value = n[sel.dataset.nfTime]
    const times = NF_TIMES.includes(value) ? NF_TIMES : [...NF_TIMES, value].sort() // a time typed into config.json
    if (sel.options.length !== times.length) sel.innerHTML = times.map((t) => `<option value="${t}">${esc(notifyClock(t))}</option>`).join('')
    if (document.activeElement !== sel) sel.value = value
    sel.tabIndex = n.days === 'always' ? -1 : 0
  }
  notifyDialog.querySelector('.nf-say').textContent = notifySentence(n)
  const paused = n.quiet && n.why === 'pause'
  const row = notifyDialog.querySelector('.nf-pause')
  row.querySelector('.nf-icon').innerHTML = n.quiet ? ICONS.bellZ : ICONS.bell
  row.querySelector('b').textContent = paused ? (n.until == null ? 'Paused until you turn them back on' : `Paused until ${notifyTime(n.until)}`) : n.quiet ? `Off until ${n.until == null ? 'later' : notifyTime(n.until)}` : 'Pause notifications'
  row.querySelector('.nf-about').textContent = n.quiet ? notifyHeld(n) : 'For an hour, until tomorrow morning, or until you turn them back on. Also one click away from CLIque’s icon.'
  row.querySelector('[data-nf-pause]').textContent = paused ? 'Resume' : 'Pause…'
}
function openNotify() {
  notifyDialog.querySelector('[data-nf-err]').textContent = ''
  drawNotify()
  if (!notifyDialog.open) notifyDialog.showModal()
}
// Shown at once; the state that follows says it for good, and what couldn't be saved goes back.
function setNotify(patch) {
  const was = state.notify
  state.notify = { ...notifyNow(), ...patch }
  notifyDialog.querySelector('[data-nf-err]').textContent = ''
  drawNotify()
  clique.call('notifications', patch).then((n) => ((state.notify = n), drawNotify()), (x) => {
    state.notify = was
    drawNotify()
    notifyDialog.querySelector('[data-nf-err]').textContent = errorLine(x)
  })
}
notifyDialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === notifyDialog) return notifyDialog.close()
  const days = e.target.closest('button[data-nf-days]')?.dataset.nfDays
  if (days && days !== notifyNow().days) return setNotify({ days })
  const pause = e.target.closest('[data-nf-pause]')
  if (!pause) return
  const n = notifyNow()
  if (n.quiet && n.why === 'pause') clique.call('notifications', { pause: 'off' }).catch((x) => (notifyDialog.querySelector('[data-nf-err]').textContent = errorLine(x)))
  else pauseMenu(pause, n)
})
notifyDialog.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-nf-time]')
  if (sel) setNotify({ [sel.dataset.nfTime]: sel.value })
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
    clique.input(name, '\x1b\r')
    return false
  })
  term.onData((data) => clique.input(name, data))

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
// character of every row. Replaying a workspace's terminals while you were in #clique (every switch) held the window for
// seconds.
const shownTerm = new IntersectionObserver((seen) => {
  for (const e of seen) {
    const t = e.isIntersecting && terms.get(e.target.closest('.tile').dataset.name)
    if (t?.waiting) replay(t)
  }
})

// On Windows, Ctrl is the terminal's own key (Ctrl+C stops what the agent runs), so copy and paste go as in Windows
// Terminal: Ctrl+C copies when there's a selection, Ctrl+Shift+C always, Ctrl+V and Ctrl+Shift+V paste (the page's paste,
// which xterm types in). Ctrl+1–5 and Ctrl+Alt+S/C stay CLIque's (a Mac's ⌘ keys never reach the terminal); the other
// Ctrl keys go to the agent. false: xterm leaves the key alone.
function windowsTerminalKey(term, e) {
  if (e.type !== 'keydown' || !e.ctrlKey || e.metaKey || e.getModifierState('AltGraph')) return true
  const key = e.key.toLowerCase()
  if (key === 'c' && !e.altKey && (e.shiftKey || term.hasSelection())) {
    e.preventDefault()
    if (term.hasSelection()) clique.call('copy', term.getSelection()).catch(() => {})
    if (!e.shiftKey) term.clearSelection()
    return false
  }
  if (key === 'v' && !e.altKey) return false
  if (/^[1-5]$/.test(e.key) && !e.altKey && !e.shiftKey) return false
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
  // out of sight (in #clique, or Focus showing another one): shownTerm replays it when it shows
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
  clique.call('buffer', name).then(({ data, cols, rows }) => {
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
  clique.call('resize', name, t.term.cols, t.term.rows).catch(() => {})
  drawTile(t)
}

// The badge in each terminal's header says what you're looking at. These aren't terminal apps: CLIque runs the
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

clique.onPty((name, data) => {
  const t = terms.get(name)
  if (t?.ready) t.term.write(data)
})

// One row: who, and one line saying what it's doing (berry while it needs you); then its context ring once it runs hot,
// and Answer while it waits on you. One that isn't this computer's live terminal says so in its line ("· Workstation") or
// by a tag (Replay, Offline, Ended). How it is, its brain, its modes, its helpers and the terminal's size are in the
// name's tooltip.
function tileHead(t) {
  const a = t.agent
  const mode = tileMode(t)
  const [badge, line, tip] = RIBBON[mode](a, displayName(a))
  const size = t.term.cols && t.ready ? `${t.term.cols}×${t.term.rows}` : ''
  const busyNow = a.status === 'working' || a.status === 'waiting'
  const what = rowLine(a, askTypes(state).get(a.name))
  const clones = clonesOf(state.agents, a).filter((c) => c.on).length
  const subs = runningSubs(a).length
  const nameTip = [upFirst(statusText(a)), brainLabel(a, state.providers), a.yolo && 'YOLO: skips every permission prompt', a.fast && 'Fast', clones ? `${plural(clones, 'clone')} at work` : subs ? `${plural(subs, 'sub-agent')} working` : '', a.holds?.length && `Has ${a.holds.join(', ')} (clique lease)`, size, line, tip].filter(Boolean).join('\n')
  const stateTip = [a.activity, a.queue ? `${a.queue} queued` : '', a.freshPending ? 'New conversation when it finishes this task' : '', busyNow ? 'Stuck? Click to mark it free' : ''].filter(Boolean).join('\n')
  const where = mode === 'mirror' ? `<span class="t-home"> · ${esc(a.homeName ?? a.home)}</span>` : ''
  return `<span class="tile-av">${avatarHTML(a, { size: 24 })}</span><b class="t-name" title="${esc(nameTip)}">${esc(plainName(a))}${cloneTag(a)}</b>
    <span class="t-mid"><span class="t-state ${what.cls}" ${busyNow ? 'data-act="markIdle"' : ''} title="${esc(stateTip)}">${esc(what.text)}${where}</span></span>
    ${ctxLevel(a.convo?.context?.pct ?? 0) === 'hot' ? contextRing(a) : ''}
    ${mode === 'live' || mode === 'mirror' ? '' : `<span class="t-badge" data-mode="${mode}" title="${esc(tip)}">${badge}</span>`}
    ${a.status === 'waiting' ? `<button class="t-answer" data-act="answer" title="${esc(needsYou(state).find((x) => x.agent.name === a.name)?.ask ? 'Answer it in the chat' : 'It asks in its terminal: answer there')}">Answer</button>` : ''}`
}

// The four actions, floating over the terminal's corner.
const tileActs = (a) => `
  ${a.canStop ? `<button class="icon" data-stop="${esc(a.name)}" title="${esc(`Stop ${displayName(a)}: end what it's doing now. It stays on`)}" aria-label="${esc(`Stop ${displayName(a)}`)}">${ICONS.stop}</button>` : ''}
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
    clique.call('restart', name)
  } else if (act === 'fresh') clique.call('freshStart', name).catch((err) => oops(`Couldn't start a new conversation for ${displayName(terms.get(name)?.agent ?? { name })}`, err))
  else if (act === 'off') clique.call('update', name, { off: true })
  else if (act === 'dismiss') {
    const a = terms.get(name)?.agent
    if (a && (a.status === 'working' || a.status === 'waiting') && !confirm(`${displayName(a)} is in the middle of something. Send it away anyway?`)) return
    clique.call('dismiss', name).catch((err) => oops(`Couldn't send ${a ? displayName(a) : name} away`, err))
  }
  else if (act === 'markIdle') clique.call('markIdle', name)
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
// its conversation, with its switch in the header. One that's resting has the dock's way to start it.
function select(name) {
  if (!terms.has(name) && !state.agents.some((a) => a.name === name)) name = familyOf(name) // a clone that has gone: its original
  openDM(name, { terminal: terms.has(name) || state.agents.find((a) => a.name === name)?.status === 'resting' })
  terms.get(dockName())?.term.focus()
}

// Its profile: the agent's sheet, over whatever is open (a clone is edited through its original).
function edit(name) {
  collection.open(state.agents.find((a) => a.name === name)?.cloneOf ?? name)
}

// On, and running: a parked or resting agent has no terminal, and starts when there's work for it.
const hasTerminal = (a) => a.on && !a.rested && a.status !== 'parked' && a.status !== 'resting'

function setLayout(next) {
  layout = next
  store.set('clique.layout', layout)
  showPlace('terminals')
}

function drawBlank() {
  const on = state.agents.filter(hasTerminal).length
  $('.blank').classList.toggle('hidden', place !== 'terminals' || on > 0)
  const parked = state.parked && state.agents.some((a) => a.on)
  const resting = state.agents.some((a) => a.on && a.status === 'resting')
  $('.blank h1').textContent = parked ? `${state.workspace.name} is asleep` : resting ? 'Nobody is at work right now' : state.agents.some((a) => !a.system) ? 'All agents are off' : 'No agents yet'
  $('.blank .lead').textContent = parked ? 'Send a message to wake it: each agent picks up its conversation.' : resting ? 'A terminal shows here once its agent has work. A message starts it, and it picks up its conversation.' : state.agents.length ? 'Turn one on in Agents: it picks up its last session.' : 'Make your first one in Agents.'
  $('.blank .acts').classList.toggle('hidden', state.agents.some((a) => !a.system)) // Add your first agent, only when there's none
}

// The grid shows every terminal, the busy ones (working, starting or waiting on you), or the ones waiting on you; each
// with how many there are. The dock shows its own, whatever the grid's filter.
const busy = (a) => a && (a.status === 'working' || a.status === 'waiting' || a.status === 'starting')
// The grid: every terminal (the ones waiting on you first, by their tile's CSS order), or the one you picked, big.
function drawShow() {
  for (const t of terms.values()) t.tile.classList.remove('filtered')
  freshen()
}

$('.side-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-place]')
  if (b) goPlace(b.dataset.place)
})
$('[data-layout]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-layout]')
  if (b?.dataset.layout) setLayout(b.dataset.layout)
})
// ⌘1 the channel, ⌘2 Agents, ⌘3 Tasks, ⌘4 Terminals, ⌘5 Usage; ⌘F searches the messages in a channel and a conversation (elsewhere it
// finds an agent), ⌘K finds an agent, ⌘N makes one (Ctrl on Windows, where Ctrl+F and Ctrl+N typed in a terminal are
// the agent's: windowsTerminalKey)
const KEYS = { 1: 'chat', 2: 'clique', 3: 'tasks', 4: 'terminals', 5: 'usage' }
document.addEventListener('keydown', (e) => {
  if (!commandKey(e)) return
  if (document.querySelector('.ed-layer.open, dialog[open]')) return // the agent's sheet or a dialog is in front
  if (KEYS[e.key] && !e.altKey && !e.shiftKey) return void (e.preventDefault(), goPlace(KEYS[e.key]))
  if (e.key === 'f' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), place === 'chat' || place === 'dm' ? openSearch() : place === 'tasks' ? tasks.search() : startFind())
  if (e.key === 'k' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), startFind())
  if (e.key === 'n' && !e.shiftKey && !e.altKey) return void (e.preventDefault(), addAgent())
})

// ⌃1–9: the workspaces, in the switcher's order (one asleep wakes). ⌃Tab and ⌃⇧Tab: the next and previous awake one.
// On Windows, Alt+1–9 (Ctrl+1–5 are the views there) and Ctrl+Tab. Ahead of the terminals (capture), which would take ⌃1
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

// ---- workspaces: switching, with the clique sliding over to the next one ----------------------------

// The new workspace renders inside a view transition, from the state the switch answers with; the side it slides in
// from is where it sits in the switcher. One that's asleep wakes (CLIque does that), the one on screen too.
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
      const { state: next } = await clique.call('workspace', 'switch', id)
      ;(push ??= await ready)(next)
    } catch (err) {
      oops(`Couldn't switch to ${list[to]?.name ?? 'that workspace'}`, err)
    }
  }
  slide(to < from ? -1 : 1, go)
}
// A workspace the sheet just made: already on screen in CLIque, now here too.
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
  threadPane.close()
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
    case 'resting': return 'free'
    case 'starting': return 'starting'
    case 'away': return 'offline'
    case 'parked': return 'asleep'
    default: return 'stopped'
  }
}

// One line: its creature and its name. What needs you from it (and its clones) is a berry dot; new replies make its name
// bold. How it is, what it's doing, its brain and its modes are in its tooltip: the row says only what you'd act on.
function dmRow(a, { selected = false, clones = [], needs = 0, drag = false }) {
  const unread = [a, ...clones].reduce((n, x) => n + (x.unread ?? 0), 0)
  const tip = [`${a.seed ?? a.name}${a.area ? ` · ${a.area}` : ''}`, upFirst(doingWord(a)), brainLabel(a, state.providers), a.yolo ? 'YOLO: skips every permission prompt' : '', clones.length ? `${plural(clones.length, 'clone')} at work` : '', a.queue ? `${a.queue} queued` : '', needs ? `${needs} waiting on you` : '', unread ? plural(unread, 'new reply', 'new replies') : ''].filter(Boolean).join('\n')
  const end = needs ? '<i class="dm-dot needs" aria-label="needs you"></i>' : ''
  return `<div class="dm ${a.on ? a.status : 'off'}${selected ? ' on' : ''}${needs ? ' needs' : ''}${unread ? ' fresh' : ''}" data-agent="${esc(a.name)}" role="button" tabindex="0" ${drag && !a.system ? 'draggable="true"' : ''} title="${esc(tip)}" style="--c:${agentColor(a)}">
    <span class="dm-av">${avatarHTML(a, { size: 26 })}</span>
    <span class="dm-name"><b>${esc(shownName(a.seed ?? a.name))}</b>${clones.length ? `<span class="dm-clones">+${clones.length}</span>` : ''}</span>
    <span class="dm-end">${end}</span>
  </div>`
}

// Agents grouped by the computer they run on once there's more than one (fold one away with a click on its name), each
// group in your own order with the ones that are off at its end. In parts for morph(): a section per computer.
function dmParts(state, { folds = new Set(), selected, filter = '', drag = false } = {}) {
  const q = filter.trim().toLowerCase()
  const match = (a) => !q || `${a.seed ?? a.name} ${a.area ?? ''}`.toLowerCase().includes(q)
  const groups = cliqueGroups(state).map((g) => ({ ...g, agents: g.agents.filter((a) => !a.system) })) // (Q has a row of his own, above them)
  const headed = grouped(groups)
  const needs = new Map()
  for (const n of needsYou(state)) needs.set(familyOf(n.agent.name), (needs.get(familyOf(n.agent.name)) ?? 0) + 1)
  const parts = groups.map((g) => {
    const agents = g.agents.filter(match)
    if ((q || !headed) && !agents.length) return null
    const folded = headed && !g.here && !q && folds.has(`group:${g.key}`)
    const waiting = agents.reduce((n, a) => n + (needs.get(a.name) ?? 0), 0)
    // (this computer's agents come first and need no label; another computer's say where they are)
    const head = headed && !g.here
      ? `<div class="cg-label" data-fold="group:${esc(g.key)}" title="${esc(`${g.name}: ${g.online ? 'linked' : 'unreachable, it reconnects on its own'}`)}"><span class="chev">${ICONS.chevron}</span><span>On ${esc(g.name)}</span>${g.online ? '' : '<span class="cg-tag">· offline</span>'}${folded && waiting ? '<span class="grow"></span><i class="dm-dot needs"></i>' : ''}</div>`
      : ''
    const rows = [...agents.filter((a) => a.on), ...agents.filter((a) => !a.on)].map((a) => dmRow(a, { selected: a.name === selected, clones: g.clones.filter((c) => c.cloneOf === a.name && c.on), needs: needs.get(a.name) ?? 0, drag: drag && headed }))
    const empty = !agents.length ? [`<div class="roster-none">${g.online ? 'No agents here yet' : 'No agents'}</div>`] : []
    return { start: `<section class="cgroup ${folded ? 'folded' : ''} ${g.online ? '' : 'away'}" data-home="${esc(g.key)}">${head}<div class="cgroup-body">`, end: '</div></section>', slot: '.cgroup-body', parts: folded ? [] : [...rows, ...empty] }
  }).filter(Boolean)
  return parts.length ? parts : [`<div class="roster-none">${q ? `No one matches “${esc(filter.trim())}”` : 'No agents yet'}</div>`]
}

// ---- what each new thing is, the first time it shows -----------------------------------------------------------------
// After a first run (ui/setup.js sets clique.hints), in place of a tour up front: a line beside the first thread, the
// first question and the first card, each once, and gone at the next click, key or scroll. One at a time. Each sits
// where there's room for it: beside its thing, on its top right corner, or under it.
const HINTS = [
  { key: 'thread', at: '.stage .feed .thread-card', where: 'right', say: 'That’s a thread. The clique talks in there, so this stays short.' },
  { key: 'ask', at: '.stage .feed .ask-card:not(.done)', where: 'corner', say: 'Someone needs you. Answer here, and they carry on.' },
  { key: 'cards', at: '.cards .pcard[data-name]', where: 'under', say: 'Everyone’s card. Click one to change its job, its brain or its look.' },
]
let hintEl = null
function hints() {
  if (hintEl || store.get('clique.hints') !== 'on' || setup.isOpen() || tour.isOn() || document.querySelector('dialog[open], .ed-layer.open, [popover]:popover-open')) return
  const visible = (el) => { const r = el?.getBoundingClientRect(); return r && r.width > 4 && r.height > 4 && r.top > 60 && r.bottom < innerHeight - 20 ? r : null }
  for (const h of HINTS) {
    if (store.get(`clique.hint.${h.key}`)) continue
    const r = visible(document.querySelector(h.at))
    if (!r) continue
    store.set(`clique.hint.${h.key}`, '1')
    if (HINTS.every((x) => store.get(`clique.hint.${x.key}`))) store.set('clique.hints', 'done')
    hintEl = Object.assign(document.createElement('p'), { className: 'hint-tip', textContent: h.say })
    hintEl.setAttribute('role', 'status')
    document.body.append(hintEl)
    const w = hintEl.offsetWidth
    const ht = hintEl.offsetHeight
    const where = h.where === 'right' && r.right + 16 + w > innerWidth - 16 ? 'under' : h.where
    const [x, y] = where === 'right' ? [r.right + 16, r.top + (r.height - ht) / 2] : where === 'corner' ? [r.right - w - 16, r.top - ht / 2] : [r.left + 16, r.bottom - 10]
    Object.assign(hintEl.style, { left: `${Math.round(Math.min(Math.max(x, 16), innerWidth - w - 16))}px`, top: `${Math.round(Math.min(Math.max(y, 64), innerHeight - ht - 16))}px` })
    const put = () => {
      const el = hintEl
      if (!el) return
      hintEl = null
      clearTimeout(timer)
      for (const type of ['pointerdown', 'keydown', 'wheel']) removeEventListener(type, put, true)
      el.classList.add('leaving')
      setTimeout(() => el.remove(), 200)
    }
    const timer = setTimeout(put, 12000)
    setTimeout(() => { for (const type of ['pointerdown', 'keydown', 'wheel']) addEventListener(type, put, true) }, 600)
    return
  }
}

// Not while you're dragging a row: a redraw would drop the drop targets (and could replace the row you hold).
let rosterStale = false
function drawRoster() {
  if (dragging) return void (rosterStale = true)
  rosterStale = false
  const open = place === 'dm' ? dmAgent()?.name : null
  morph($('.roster'), dmParts(state, { folds, selected: open, filter: find, drag: true }))
  // Q, who runs the clique: by himself above it
  const sys = state.agents.find((a) => a.system && !a.cloneOf)
  const q = find.trim().toLowerCase()
  const found = sys && (!q || `${shownName(sys.seed ?? sys.name)} ${sys.area ?? ''}`.toLowerCase().includes(q))
  morph($('.q-row'), found ? dmRow(sys, { selected: sys.name === open, needs: needsYou(state).filter((n) => familyOf(n.agent.name) === sys.name).length }) : '')
  if (q && found) $('.roster .roster-none')?.remove() // (someone matches: him)
  requestAnimationFrame(hints)
  const count = state.agents.filter((a) => !a.cloneOf).length
  $('[data-find]').placeholder = count > 1 ? `Find among ${count} agents` : 'Find an agent'
  if (dragging) document.querySelector(`.roster .dm[data-agent="${CSS.escape(dragging.name)}"]`)?.classList.add('dragging')
  if (cursor) document.querySelector(`:is(.q-row, .roster) .dm[data-agent="${CSS.escape(cursor)}"]`)?.classList.add('cursor')
}
let cursor = null // the search's marked match, kept across redraws

function toggleFold(key) {
  folds.has(key) ? folds.delete(key) : folds.add(key)
  store.set('clique.folds', JSON.stringify([...folds]))
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
  document.querySelector(':is(.q-row, .roster) .dm.cursor')?.classList.remove('cursor')
  if (!findBox.value) stopFind()
})
findBox.addEventListener('keydown', (e) => {
  const rows = [...document.querySelectorAll(':is(.q-row, .roster) .dm')]
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
for (const list of [$('.roster'), $('.q-row')]) list.addEventListener('click', (e) => {
  const fold = e.target.closest('[data-fold]')
  if (fold) return toggleFold(fold.dataset.fold)
  const row = e.target.closest('.dm')
  if (!row || e.detail > 1) return
  openDM(row.dataset.agent)
  composer.focus()
})
for (const list of [$('.roster'), $('.q-row')]) list.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.dm')
  if (row && terms.has(row.dataset.agent)) select(row.dataset.agent)
})
for (const list of [$('.roster'), $('.q-row')]) list.addEventListener('keydown', (e) => {
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
      ...(a.canStop ? [{ label: 'Stop', icon: ICONS.stop, act: 'stop', hint: 'it stays on' }] : []),
      '-',
      { label: 'Send it away', icon: ICONS.close, act: 'dismiss', danger: true },
    ], (act) => {
      if (act === 'message') (openDM(name), composer.focus())
      if (act === 'terminal') select(name)
      if (act === 'edit') edit(name)
      if (act === 'stop') stopNow(name)
      if (act === 'dismiss' && (!busy(a) || confirm(`${displayName(a)} is in the middle of something. Send it away anyway?`))) clique.call('dismiss', name).catch((err) => oops(`Couldn't send ${displayName(a)} away`, err))
    })
  }
  const here = a.home ?? ''
  const places = cliqueGroups(state).filter((g) => g.key !== here)
  // one of your shared agents can join your other workspaces, and leave this one (or leave your clique altogether);
  // a workspace's own agent is only here
  const ws = state.workspace
  const joins = a.shared && !a.home ? (state.workspaces ?? []).filter((w) => w.id !== ws?.id && !w.members?.some((m) => m.name === name)) : []
  const leave = Boolean(a.shared)
  popMenu(at, [
    { head: a.seed ?? a.name },
    { label: 'Message', icon: ICONS.reply, act: 'message', disabled: !a.on },
    { label: 'Open terminal', icon: ICONS.terminal, act: 'terminal', disabled: !terms.has(name) && a.status !== 'resting' },
    { label: 'Edit…', icon: ICONS.edit, act: 'edit' },
    { label: 'New conversation', icon: ICONS.fresh, act: 'fresh', disabled: !a.on || a.freshPending },
    ...(a.on && a.canStop ? [{ label: 'Stop', icon: ICONS.stop, act: 'stop', hint: 'it stays on' }] : []), // only while it's in a turn
    ...(places.length && !a.system ? ['-', ...places.map((g) => ({ label: `Move to ${g.name}`, icon: g.here ? ICONS.desktop : ICONS.laptop, act: `move:${g.key}`, disabled: !g.online, hint: g.online ? '' : 'offline' }))] : []),
    ...(joins.length ? ['-', ...joins.map((w) => ({ label: `Add to ${w.name}`, icon: wsTile(w, { size: 16 }), act: `join:${w.id}`, hint: w.parked ? 'asleep' : '' }))] : []),
    '-',
    { label: a.on ? 'Turn off' : 'Turn on', icon: ICONS.power, act: 'power' },
    ...(a.system ? [] : [{ label: leave ? `Take out of ${ws.name}…` : 'Remove…', icon: ICONS.trash, act: 'remove', danger: true }]),
    ...(leave ? [{ label: 'Remove from your clique…', icon: ICONS.trash, act: 'forget', danger: true }] : []),
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
      if (act === 'fresh') await clique.call('freshStart', name)
      if (act === 'stop') stopNow(name)
      if (act.startsWith('move:')) moveSheet(name, act.slice(5))
      if (act === 'power') {
        if (a.on && busy(a) && !confirm(`${a.seed ?? a.name} is in the middle of something. Turn it off anyway?`)) return
        await clique.call('update', name, { off: a.on })
      }
      if (act.startsWith('join:')) {
        const w = state.workspaces.find((x) => x.id === act.slice(5))
        await clique.call('workspace', 'members', w.id, { add: [name] })
        toast(`${name} joins ${w.name}${w.folder ? `, working in ${shortPath(w.folder)}` : ''}`)
      }
      const sure = act === 'remove' && confirm(leave
        ? `Take ${name} out of ${ws.name}? It stops working here, and starts a fresh conversation if it comes back. It stays in your clique and your other workspaces.`
        : `Remove ${name}? It's only in ${ws.name}, so it's gone for good. Its session stops (the transcript stays with the CLI).`)
      if (sure) await clique.call('removeAgent', name)
      if (act === 'forget' && confirm(`Remove ${a.seed ?? a.name} from your clique? It stops and leaves every workspace it's in, for good. Its transcripts stay with the CLI.`)) await clique.call('removeAgent', name, { everywhere: true })
    } catch (err) {
      oops(doing, err)
    }
  })
}
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.roster .dm, .q-row .dm, .pcard[data-name], .tile-head, .dock-tab, .page-head[data-for=chat] .ph-glyph .av, .page-head[data-for=chat] .ph-name')
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
  e.dataTransfer.setData('application/x-clique-agent', dragging.name)
  row.classList.add('dragging')
  const online = new Map(cliqueGroups(state).map((g) => [g.key, g.online]))
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
  $('.side-more').title = `Autopilot, staying awake, Computers, Claude Code and Codex, theme${away.length ? `\n${away.map((l) => l.name).join(', ')} can't be reached` : ''}`
  // only what's close to a limit (80% of a window, or running out before it resets at this pace): the rest is in Usage
  const near = (u) => fullestPct(u) >= 80 || Boolean(paceWarning(u))
  const machines = usageByComputer(state).filter((m) => m.accounts.some(near)).map((m) => ({ ...m, accounts: m.accounts.filter(near) }))
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
  }).join('') + `<button class="up-more" data-place="usage">Usage by day${ICONS.chevron}</button><button class="up-more" data-open="accounts">Accounts${ICONS.chevron}</button>`)
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
// Under the limits: the Usage view, where every day is
usePop.addEventListener('click', (e) => {
  if (e.target.closest('[data-open=accounts]')) return void (usePop.hidePopover(), accounts.open())
  if (!e.target.closest('[data-place=usage]')) return
  usePop.hidePopover()
  goPlace('usage')
})
// The ⋯ menu's word beside Accounts: how many you've added, or that one needs signing in.
function accountsHint() {
  const added = (state.accounts ?? []).filter((a) => !a.own)
  const out = added.filter((a) => a.signedIn === false && !a.signing).length
  return out ? `${out} not signed in` : added.length ? `${added.length} added` : ''
}

function addAgent() {
  if (!state.workspace) return workspaces.create() // the menu bar's New agent, say: it needs somewhere to work first
  collection.create()
}

function handleFocus(arg) {
  if (arg === ':add') addAgent()
  else if (arg === ':notifications') openNotify()
  else if (arg === ':workspace') workspaces.create()
  else if (arg === ':workspace-settings') workspaces.settings()
  else if (arg?.startsWith('task:') || arg?.startsWith('bug:')) openTask(arg.slice(arg.indexOf(':') + 1))
  // a file from the floating chat, to look at closer: this window has the room (ui/files.js)
  else if (arg?.startsWith('file:')) {
    try {
      const { files, i, from } = JSON.parse(arg.slice(5))
      fxRemember('elsewhere', files)
      fxView('elsewhere', i, null, from ?? null) // (from: where a recording was, playing there)
    } catch {}
  }
  else if (arg) select(arg)
}

function openTask(key) {
  goPlace('tasks')
  tasks.open(key)
}
clique.onFocus(handleFocus)

// ---- render ----------------------------------------------------------------

const ready = live((next) => {
  workspaceChanged(next)
  state = next
  syncChannel()
  workspaces.render(state)
  drawComputers(state)
  if (saversDialog.open) drawSavers()
  if (checkInDialog.open) drawCheckIn()
  if (toolsDialog.open) drawTools()
  if (notifyDialog.open) drawNotify()
  schedules.render()
  accounts.render()
  drawFoot(state)
  drawUpdate(state)
  // Terminals only for agents that have one running; the sidebar lists everyone so off agents are one click from coming
  // back.
  const on = state.agents.filter(hasTerminal)
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
  threadPane.render(state)
  composer.render(state) // first: it may move the conversation (a clone gone, an agent moved), which redraws the place
  showPlace(place) // the dock (a terminal that came or went), the header, the sidebar, the filters' counts
  followRename()
  collection.render(state)
  tasks.render(state)
  usage.render(state)
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

// ---- Computers (CLIque Link) -------------------------------------------------------
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
let discoverTick = null // Computers says it's open every minute, so a page that went away stops discovery (core/clique.js)
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
  clique.call('link', 'pairDone').catch(() => {})
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
  const line = done ? `<b>${them}</b>'s agents are part of your clique now.`
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
        <div class="code-in"><textarea class="field" data-link-code rows="2" placeholder="clique1.…" spellcheck="false" aria-label="The other computer's code"></textarea><button class="btn primary" data-link-connect>Link</button></div>
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
// on screen (it's in CLIque's settings file), so it says what you can do instead.
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
          <span class="who"><b>${esc(shownName(a.seed))}</b><small>${esc(a.area || 'no area')}</small></span>
          ${l.online && !a.system ? `<button class="btn sm lk-move" data-move="${esc(a.name)}" title="Run it on another computer, with its conversation, instructions, look and work experience">${ICONS.move}Move to…</button>` : ''}
          <label class="use"><input type="checkbox" class="switch" data-use="${esc(a.name)}" ${a.hidden ? '' : 'checked'}>Use</label>
        </li>`).join('')}</ul>` : `<p>${l.online ? 'No agents there yet.' : 'Its agents show here once it\'s back.'}</p>`}
      <div class="lk-row"><span title="Move one with its Move to…, or drag it onto a computer in the sidebar">${l.agents.length > 1 ? `Using ${used} of ${l.agents.length}` : ''}</span>
        <span class="lk-btns">${l.agents.length > 1 ? `<button class="btn sm" data-use-all="${esc(l.slug)}">All</button><button class="btn sm" data-use-none="${esc(l.slug)}">None</button>` : ''}${l.saved ? `<button class="btn sm" data-forget="${esc(l.slug)}" title="Unlink it from ${THIS_COMPUTER}">Forget</button>` : ''}</span></div>
    </div>` : ''}
  </section>`
}

// ---- Phones (core/phones.js): the CLIque app on your phone, paired with a code it scans ----------------------------
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
  if (phone && confirm(`Remove ${phone.name}? It can't reach ${THIS_COMPUTER} any more, until you pair it again.`)) await clique.call('phones', 'revoke', remove)
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
    clique.call('phones', 'cancel').catch(() => {}) // its code is used up; one renewed just as it paired ends here
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
    const made = await clique.call('phones', 'code')
    if (phonePair === view && !view.phone) {
      const left = made.expires - Date.now()
      Object.assign(view, made, { err: '', renewAt: made.expires - Math.min(60000, left / 6) })
    } else if (!phonePair || phonePair === view) {
      clique.call('phones', 'cancel').catch(() => {}) // the view closed, or a phone paired, while this one was being made
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
  if (!view.phone) clique.call('phones', 'cancel').catch(() => {})
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
    await clique.call('copy', view.code)
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
  const discover = () => clique.call('link', 'discover', true).catch((x) => clique.call('log', `discover: ${x.message}`))
  discover()
  clearInterval(discoverTick)
  discoverTick = setInterval(discover, 60000)
}

// Back from a takeover to the list: Link with a code closes, a linking that's done or failed is put away, one asking
// this computer is told no, and one this computer is asking is cancelled.
function linkBack() {
  const p = state.computers?.pairing
  if (p?.in) return clique.call('link', ...(p.in.stage === 'ask' ? ['pairAnswer', p.in.id, false] : ['pairDone']))
  if (p?.out) return clique.call('link', ['linked', 'failed'].includes(p.out.stage) ? 'pairDone' : 'pairCancel')
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
    if (pair) await clique.call('link', 'pair', pair)
    if (t.closest('[data-pair-retry]')) await clique.call('link', 'pair', state.computers.pairing.out.id)
    if (t.closest('[data-pair-cancel], [data-pair-back], [data-pair-no]')) await linkBack()
    if (t.closest('[data-pair-yes]')) await clique.call('link', 'pairAnswer', state.computers.pairing.in.id, true)
    if (t.closest('[data-pair-confirm]')) await clique.call('link', 'pairConfirm')
    if (t.closest('[data-pair-done]')) handing ? linkHanded(handing) : await clique.call('link', 'pairDone')
    if (t.closest('[data-local-network]')) await clique.call('link', 'localNetwork')
    if (t.closest('[data-link-copy]')) {
      await clique.call('copy', await clique.call('link', 'code'))
      linkOpen.copied = true
      drawComputers(state)
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => ((linkOpen.copied = false), drawComputers(state)), 1800)
    }
    if (t.closest('[data-link-details-copy]')) {
      await clique.call('copy', connectionDetails(state.computers.me))
      linkOpen.detailsCopied = true
      drawComputers(state)
      setTimeout(() => ((linkOpen.detailsCopied = false), drawComputers(state)), 1800)
    }
    if (t.closest('[data-link-reset]') && confirm('Make a new code? Computers using the current one are disconnected until they link again with the new one.')) await clique.call('link', 'reset')
    if (t.closest('[data-link-connect]')) {
      const code = linkDialog.querySelector('[data-link-code]').value.trim()
      if (!code) return fail('Paste the code from the other computer first')
      const btn = t.closest('[data-link-connect]')
      btn.disabled = true
      btn.textContent = 'Linking…'
      linkErr = ''
      try {
        fresh = await clique.call('link', 'connect', code)
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
    if (forget && confirm(`Forget ${linked(forget)?.name}? Its agents disappear from here (they keep running there). Link it again any time.`)) await clique.call('link', 'forget', forget)
    const all = t.closest('[data-use-all]')?.dataset.useAll
    const none = t.closest('[data-use-none]')?.dataset.useNone
    if (all || none) await clique.call('link', 'hide', linked(all || none).agents.map((a) => a.name), Boolean(none))
    const move = t.closest('[data-move]')
    if (move) {
      const name = move.dataset.move
      const from = state.agents.find((a) => a.name === name)?.home ?? ''
      const places = cliqueGroups(state).filter((g) => g.key !== from)
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
    if ('linkShare' in d) await clique.call('link', 'share', e.target.checked)
    if (d.use) await clique.call('link', 'hide', [d.use], !e.target.checked)
    if ('meName' in d) {
      const name = e.target.value.trim()
      if (name && name !== state.computers.me.name && confirm(`Rename this computer to "${name}"? Linked computers reconnect, and see its agents as name@${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.`)) await clique.call('link', 'rename', name)
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
  clique.call('link', 'discover', false).catch(() => {})
})

// ---- moving an agent to another computer ------------------------------------------
// From any computer, to any linked one: drag it onto a computer in the sidebar, pick Move to… on it, or choose
// Runs on in its card. Its conversation and its part of the chat go along; what it had running (servers,
// simulators, builds) can't, and the sheet says so. The folder is a path on the other computer, checked there.

const moveDialog = $('#move')
let moving = null // { name, home, folder, check }

async function moveSheet(name, home) {
  const a = state.agents.find((x) => x.name === name)
  if (a?.system) return // Q comes with every workspace, and stays where he is
  const groups = cliqueGroups(state)
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
  clique.call('folders', home, name).then((list) => {
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
      const info = await clique.call('folderInfo', moving.home, moving.folder)
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
    const dir = await clique.call('pickFolder', moving.home).catch(() => null)
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
    const res = await clique.call('moveAgent', m.name, m.home, m.folder)
    // where it went is in view: its computer unfolds, and its row is the selected one
    if (folds.delete(`group:${m.home}`)) store.set('clique.folds', JSON.stringify([...folds]))
    if (res?.name) selected = res.name
    const to = cliqueGroups(state).find((g) => g.key === m.home)?.name ?? 'there'
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

// ---- import: a .clique file, picked or dropped ------------------------------------------

const importDialog = $('#import')
let pending = null // { file, pack, agents }

async function importPack(dropped) {
  try {
    const opened = await clique.call('openPack', dropped)
    if (!opened) return
    pending = opened
    drawImport()
    importDialog.showModal()
  } catch (x) {
    oops(`Couldn't open ${dropped?.name ?? 'that file'}`, x, `Pick a .clique file someone exported from ${PRODUCT_NAME}.`)
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
    box.value = await clique.call('freeName', pending.agents[row.dataset.i].seed, e.target.value).catch(() => box.value)
  }
})
importDialog.addEventListener('click', async (e) => {
  if (e.target.closest('[data-close]') || e.target === importDialog) return importDialog.close()
  if (!e.target.closest('[data-import-go]')) return
  const choices = [...importDialog.querySelectorAll('.imp')]
    .filter((r) => r.querySelector('[data-take]').checked)
    .map((r) => ({ index: Number(r.dataset.i), name: r.querySelector('[data-name]').value.trim(), folder: r.querySelector('[data-folder]').value.trim() || undefined, home: r.querySelector('[data-home]')?.value || '' }))
  try {
    const added = await clique.call('importAgents', pending.pack, choices)
    importDialog.close()
    goPlace('clique')
    if (added.length === 1) collection.open(added[0])
  } catch (x) {
    importDialog.querySelector('[data-import-err]').textContent = errorLine(x)
  }
})

clique.onImport(importPack)
// A .clique file dropped anywhere on the window (image drop zones only take images).
document.addEventListener('dragover', (e) => [...e.dataTransfer.items].some((i) => i.kind === 'file') && e.preventDefault())
document.addEventListener('drop', async (e) => {
  const file = [...e.dataTransfer.files].find((f) => /\.(clique|crew)$/i.test(f.name)) // (.crew: a pack from before the app's rename)
  if (!file) return
  e.preventDefault()
  e.stopPropagation()
  importPack({ name: file.name, text: await file.text() })
}, true)

booted = true
ready.then(() => {
  showPlace(state.agents.length ? place : 'clique')
  handleFocus(new URLSearchParams(location.search).get('focus'))
})

// Floating pill on the screen edge; click it (or press the hotkey) for the chat panel.
/* global wordmarkHTML, PRODUCT_NAME, clique, live, morph, esc, mountConvoHead, unreadBadge, statusText, displayName, cloneTag, runningSubs, orbitHTML, plural, agentColor, mountFeed, mountComposer, avatarHTML, markSVG, cliqueSummary, celebrate, ICONS, wsTile, wsLabel, elsewhere, hasWorkspaces */

const $ = (s) => document.querySelector(s)
$('.home').innerHTML = markSVG('0 6 24 16', { split: true }) // its buddies bob while anyone works
$('.home').title = PRODUCT_NAME
// the panel's header: the wordmark, or the workspace it shows (drawn on each push)
$('[data-act=dashboard]').innerHTML = ICONS.expand
$('[data-act=close]').innerHTML = ICONS.close

// Your conversation with one agent takes the header's left side: back to everyone, and who it's with.
const everyone = () => (composer.setTarget('auto'), composer.focus())
const head = mountConvoHead($('.panel header .convo-head'), { onBack: everyone, onTerminal: (name) => clique.call('dashboard', name) })
const feed = mountFeed($('.feed'), { limit: 80, onAgent: (name) => clique.call('dashboard', name), onConvo: (name) => (composer.setTarget(name), composer.focus()), onLeave: () => composer.setTarget('auto'), onReply: (e) => composer.replyTo(e), onThread: (id, at) => (threadPane.render(state), threadPane.open(id, at)) })
const threadPane = mountThread($('.panel > .thread'), {
  onSeen: () => feed.refresh(),
  onAgent: (name) => (threadPane.close(), composer.setTarget(familyOf(name)), composer.focus()),
  onCard: (id) => (threadPane.close(), feed.jump(id)),
})
const composer = mountComposer($('.compose'), { dropZone: $('.panel'), onSend: () => feed.toLatest(), onTarget: (to) => (head.set(to), feed.setConvo(to), queueMicrotask(tellLooking)) })
let size = ''

// The window wraps what's drawn; main.js places it so the pill stays where it is, so it's told where the pill is.
function fit(focus = false) {
  const r = $('.wrap').getBoundingClientRect()
  // where it's laid out, not where an animation has it right now (it drops out of the hatch from above the window)
  const p = $('.pill')
  const pill = { x: p.offsetLeft, y: p.offsetTop, width: p.offsetWidth, height: p.offsetHeight }
  const next = `${Math.ceil(r.width)}x${Math.ceil(r.height)}@${Object.values(pill)}`
  if (next === size && !focus) return
  size = next
  clique.fit(Math.ceil(r.width), Math.ceil(r.height), focus, pill)
}

// Which side of the pill the chat goes on, from main.js (core/pill.js): by the left edge it opens to the right,
// at the top below, and so on. At the top and bottom the pill lies flat.
clique.onPlace(({ side, align, hatch }) => {
  const body = document.body
  const moved = body.dataset.side && body.dataset.side !== side
  body.dataset.side = side
  body.dataset.align = align
  // in the hatch: its own look, built around the notch it's docked to
  body.classList.toggle('hatch-look', side === 'hatch')
  $('.pill').classList.toggle('hatch-shoulders', side === 'hatch')
  if (hatch) {
    body.style.setProperty('--notch-w', `${hatch.width}px`)
    body.style.setProperty('--notch-h', `${hatch.height}px`)
  }
  if (moved && body.classList.contains('open')) {
    body.classList.remove('moved')
    void body.offsetWidth
    body.classList.add('moved') // the panel swaps sides with a little settle, once
  }
  if (state) drawPill() // the creatures are another size in the hatch, and fewer of them fit
  size = '' // always tell main.js: even when nothing changed size, the pill's place on screen did
  fit()
})

$('.panel').addEventListener('animationend', (e) => e.animationName === 'panel-moved' && document.body.classList.remove('moved'))

// Drag the pill (or the chat by its header) anywhere; main.js moves the window with the pointer and, when you
// let go, picks the chat's side for where you left it. It's a drag once the pointer has moved a few pixels, so
// a click stays a click. Buttons and creatures stay clickable. In the hatch there's little else to hold, so the mark
// drags it too, taking the pointer only once it's a drag, so a click on the mark still lands on the mark.
const inHatch = () => document.body.dataset.side === 'hatch'
let justDragged = false
for (const handle of [$('.pill'), $('.panel header')]) {
  handle.addEventListener('pointerdown', (e) => {
    const onMark = inHatch() && handle === $('.pill') && e.target.closest('.home')
    if (e.button !== 0 || (!onMark && e.target.closest('button, .face, .sums, a, input, textarea'))) return
    e.preventDefault()
    if (!onMark) handle.setPointerCapture(e.pointerId)
    const [x0, y0] = [e.screenX, e.screenY]
    let dragging = false
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.screenX - x0, ev.screenY - y0) < 3) return
      if (!dragging) {
        dragging = true
        if (onMark) handle.setPointerCapture(e.pointerId)
        document.body.classList.add('dragging')
        clique.drag('start', x0, y0)
      }
      clique.drag('move', ev.screenX, ev.screenY)
    }
    const end = (ev) => {
      const source = onMark ? window : handle
      source.removeEventListener('pointermove', move)
      source.removeEventListener('pointerup', end)
      source.removeEventListener('pointercancel', end)
      handle.removeEventListener('lostpointercapture', end)
      document.body.classList.remove('dragging')
      if (!dragging) return
      clique.drag('end', ev.screenX, ev.screenY)
      justDragged = true // the click that ends a drag isn't a click
      setTimeout(() => (justDragged = false))
    }
    // (from the mark the pointer isn't captured yet, and a quick flick can leave the band before the first move)
    const source = onMark ? window : handle
    source.addEventListener('pointermove', move)
    source.addEventListener('pointerup', end)
    source.addEventListener('pointercancel', end)
    handle.addEventListener('lostpointercapture', end) // the window went away mid-drag
  })
}

// focus=false opens the chat without pulling you out of the app you're in (e.g. after closing the dashboard).
function setOpen(open, focus = open) {
  if (!open) composer.stopVoice() // closing the panel ends dictation, keeping what it heard
  document.body.classList.toggle('open', open)
  tellLooking()
  fit(focus)
  if (!open) return
  $('.feed').scrollTop = $('.feed').scrollHeight // it can't scroll while hidden, so catch up on open
  if (focus) composer.focus()
}

$('.home').addEventListener('click', () => setOpen(!document.body.classList.contains('open')))
// in the hatch the whole band is a button: the mark and the creatures are small, up by the edge of the screen
$('.pill').addEventListener('click', (e) => {
  if (inHatch() && !justDragged && !e.target.closest('button, .face')) setOpen(!document.body.classList.contains('open'))
})
$('[data-act=close]').addEventListener('click', () => setOpen(false))
$('[data-act=dashboard]').addEventListener('click', () => clique.call('dashboard'))
document.addEventListener('keydown', (e) => e.key === 'Escape' && !composer.stopVoice() && setOpen(false))
clique.onToggle((opts = {}) => {
  const open = opts.open ?? !document.body.classList.contains('open')
  setOpen(open, opts.focus ?? open)
})
// Tap a creature in the pill for your conversation with that agent; with replies you haven't read, it opens on
// the first.
let state = null
$('.dots').addEventListener('click', (e) => {
  if (e.target.closest('[data-more-faces]')) return setOpen(true)
  const face = e.target.closest('[data-agent]')
  if (!face) return
  // the one you're talking to, tapped again with the chat open: back to everyone's
  if (document.body.classList.contains('open') && composer.target() === face.dataset.agent) return everyone()
  composer.setTarget(face.dataset.agent)
  setOpen(true)
  requestAnimationFrame(() => feed.reveal()) // the panel was closed: it couldn't scroll yet
})

const HATCH_FACES = 4 // beside the notch, over the menu bar's own items: a few, however big the screen

function drawPill() {
  const on = state.agents.filter((a) => a.on)
  // A big clique doesn't fit along a screen edge: the pill keeps the ones that need a look (waiting on you, new
  // replies, at work) in their usual order, and the rest become "+N", which opens the chat.
  const flat = ['above', 'below'].includes(document.body.dataset.side)
  const room = inHatch() ? HATCH_FACES : Math.max(4, Math.min(14, Math.floor(((flat ? screen.availWidth : screen.availHeight) * 0.72 - 90) / 32)))
  const sized = (a) => (inHatch() ? (a.cloneOf ? 18 : 22) : a.cloneOf ? 24 : 30)
  let shown = on
  if (on.length > room) {
    const look = new Set(on.filter((a) => a.status === 'waiting' || a.unread || a.status === 'working').slice(0, room - 1).map((a) => a.name))
    for (const a of on) if (look.size < room - 1) look.add(a.name)
    shown = on.filter((a) => look.has(a.name))
  }
  const hidden = on.length - shown.length
  // a clone pops out next to its original, a little smaller, with its number
  morph($('.dots'), [...shown.map((a) => {
    const subs = runningSubs(a).length
    return `<span class="face${a.cloneOf ? ' clone' : ''}" data-agent="${esc(a.name)}" style="--c:${agentColor(a)}" title="${esc(`${displayName(a)}${a.cloneOf ? ` (a clone of ${a.cloneOf})` : ''}: ${statusText(a)}${subs ? ` · ${plural(subs, 'sub-agent')} working` : ''}${a.unread ? ` · ${plural(a.unread, 'new reply', 'new replies')}` : ''}`)}">${avatarHTML(a, { size: sized(a) })}${orbitHTML(a)}${cloneTag(a)}${unreadBadge(a.unread)}</span>`
  }), hidden ? `<button class="more-faces" data-more-faces title="${esc(`${plural(hidden, 'more agent')}: ${on.filter((a) => !shown.includes(a)).map((a) => a.name).join(', ')}`)}">+${hidden}</button>` : ''])
}

live((next) => {
  state = next
  const on = state.agents.filter((a) => a.on)
  const working = on.filter((a) => a.status === 'working').length
  document.body.classList.toggle('busy', working > 0)
  // anyone waiting on you, in this workspace or another open one
  document.body.classList.toggle('alert', state.agents.some((a) => a.status === 'waiting') || elsewhere(state).waiting > 0)
  // while notifications are held (paused, or outside your hours) the warm edge stays, but still: it doesn't breathe
  document.body.classList.toggle('quiet', Boolean(state.notify?.quiet))
  // with workspaces, the chat says whose it is
  morph($('.panel header .brand'), hasWorkspaces(state) ? `${wsTile(state.workspace, { size: 20 })}<b>${esc(wsLabel(state.workspace))}</b>` : wordmarkHTML(20))
  drawPill()
  celebrate($('.dots'), state.agents)
  morph($('.sums'), cliqueSummary(state))
  // the mark in the pill counts every reply you haven't read
  const fresh = state.agents.reduce((n, a) => n + a.unread, 0)
  morph($('.home-badge'), fresh ? `<span class="unread-badge">${fresh > 9 ? '9+' : fresh}</span>` : '')
  head.render(state)
  feed.render(state)
  threadPane.render(state)
  composer.render(state)
  fit()
  tellLooking()
})
// What the chat shows while it's open, said to the app when it changes, so nothing notifies you about what's in front of
// you (core/notify.js lookingAt): one agent's conversation, or everyone's chat with every question in it.
let lookingSaid = ''
function tellLooking() {
  const to = composer.target()
  const view = !state || !document.body.classList.contains('open') ? null
    : { ws: state.workspace?.id ?? '', agent: isConvo(to) ? familyOf(to) : null, sees: isConvo(to) ? [] : needsYou(state).filter((n) => n.ask).map((n) => n.agent.name), tasks: false }
  const said = JSON.stringify(view)
  if (said === lookingSaid) return
  lookingSaid = said
  clique.looking?.(view)
}

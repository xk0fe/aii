// Floating pill on the screen edge; click it (or press the hotkey) for the chat panel.
/* global needsYou, needText, isConvo, familyOf, mountThread, reduceMotion, wordmarkHTML, PRODUCT_NAME, clique, live, morph, esc, mountConvoHead, unreadBadge, statusText, displayName, cloneTag, runningSubs, orbitHTML, plural, agentColor, mountFeed, mountComposer, avatarHTML, markSVG, cliqueSummary, celebrate, ICONS, wsTile, wsLabel, elsewhere, hasWorkspaces */

const $ = (s) => document.querySelector(s)
// Under the mouse (main.js opens this page with ?at=mouse): there's no pill to click. The mark follows the pointer, and
// the hotkeys open the message box ("quick": only the composer) or the chat where the pointer is (core/follow.js).
const MOUSE = new URLSearchParams(location.search).get('at') === 'mouse'
const isOpen = () => document.body.classList.contains('open')
const isQuick = () => document.body.classList.contains('quick')
// Under the mouse the pill is a wisp: one tiny buddy (its glow, tail and ring are ui/overlay.html's .wisp-*).
const WISP = `<svg viewBox="0 0 14 12" aria-hidden="true"><defs><linearGradient id="wisp-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e9effc"/></linearGradient></defs>
  <path d="M.5 8.3C.5 2.9 2.7.5 7 .5S13.5 2.9 13.5 8.3Q13.5 11.5 10.3 11.5L3.7 11.5Q.5 11.5 .5 8.3Z" fill="url(#wisp-body)" stroke="rgba(15,23,42,.3)" stroke-width=".5"/>
  <ellipse cx="4.6" cy="6.9" rx="1.3" ry="1.4"/><ellipse cx="9.4" cy="6.9" rx="1.3" ry="1.4"/></svg>`
if (MOUSE) {
  $('.home').innerHTML = WISP
  $('.pill').insertAdjacentHTML('afterbegin', '<span class="wisp-aura"></span><span class="wisp-need"></span><span class="wisp-tail"></span><span class="wisp-ring"></span>')
} else $('.home').innerHTML = markSVG('0 6 24 16', { split: true }) // its buddies bob while anyone works
$('.home').title = PRODUCT_NAME
// the panel's header: the wordmark, or the workspace it shows (drawn on each push)
$('[data-act=dashboard]').innerHTML = ICONS.expand
$('[data-act=close]').innerHTML = ICONS.close

// Your conversation with one agent takes the header's left side: back to everyone, and who it's with.
const everyone = () => (composer.setTarget('auto'), composer.focus())
const head = mountConvoHead($('.panel header .convo-head'), { onBack: everyone, onTerminal: (name) => clique.call('dashboard', name) })
document.documentElement.dataset.fxElsewhere = '1' // a file opens in the main window's viewer: this one is too small to look closer in (ui/files.js)
const feed = mountFeed($('.feed'), { limit: 80, headSays: true, onAgent: (name) => clique.call('dashboard', name), onConvo: (name) => (composer.setTarget(name), composer.focus()), onLeave: () => composer.setTarget('auto'), onReply: (e) => composer.replyTo(e), onThread: (id, at) => (threadPane.render(state), threadPane.open(id, at)) })
const threadPane = mountThread($('.panel > .thread'), {
  onSeen: () => feed.refresh(),
  onAgent: (name) => (threadPane.close(), composer.setTarget(familyOf(name)), composer.focus()),
  onCard: (id) => (threadPane.close(), feed.jump(id)),
})
const composer = mountComposer($('.compose'), {
  dropZone: $('.panel'), onSend: () => feed.toLatest(), onTarget: (to) => (head.set(to), feed.setConvo(to), queueMicrotask(tellLooking)),
  // the message box: sent, it's done (the buddies hop as they take it); its @names list opens where there's room for it
  onSent: () => isQuick() && (setOpen(false), took()),
  popups: () => (isQuick() && document.body.dataset.align !== 'end' ? 'below' : 'above'),
  stops: () => !isQuick(), // (the message box is for sending: who's at work isn't in view there)
  // the dictation hotkey, with nothing open under the mouse (it closed a moment ago): the box opens, it never listens unseen
  onDictate: () => MOUSE && !isOpen() && setOpen(true, true, { quick: true }),
})
let size = ''

// The window wraps what's drawn; main.js places it so the pill stays where it is, so it's told where the pill is.
function fit(focus = false) {
  const r = $('.wrap').getBoundingClientRect()
  // where it's laid out, not where an animation has it right now (it drops out of the hatch from above the window)
  // Under the mouse, what's held in place is whatever is open, and main.js hears which that is.
  const p = MOUSE && isOpen() ? $('.panel') : $('.pill')
  const pill = { x: p.offsetLeft, y: p.offsetTop, width: p.offsetWidth, height: p.offsetHeight, ...(MOUSE && { open: isOpen() ? (isQuick() ? 'quick' : 'chat') : false }) }
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
// drags it too, taking the pointer only once it's a drag, so a click on the mark still lands on the mark. So does the
// minimised dock, which is little more than its mark.
const inHatch = () => document.body.dataset.side === 'hatch'
const isMini = () => document.body.classList.contains('mini') && !inHatch()
let justDragged = false
for (const handle of [$('.pill'), $('.panel header')]) {
  handle.addEventListener('pointerdown', (e) => {
    const onMark = (inHatch() || isMini()) && handle === $('.pill') && e.target.closest('.home')
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
// quick: only the message box (under the mouse).
function setOpen(open, focus = open, { quick = false } = {}) {
  if (!open) composer.stopVoice() // closing the panel ends dictation, keeping what it heard
  if (open && quick !== isQuick()) threadPane.close() // (the message box has no room for a thread)
  document.body.classList.toggle('open', open)
  document.body.classList.toggle('quick', open && quick)
  if (state && inHatch()) drawHatch()
  if (MOUSE && state) composer.render(state) // its send button is Stop in the chat, never in the message box
  tellLooking()
  fit(focus)
  if (!open) return
  $('.feed').scrollTop = $('.feed').scrollHeight // it can't scroll while hidden, so catch up on open
  if (focus) composer.focus()
}

$('.home').addEventListener('click', () => setOpen(!document.body.classList.contains('open')))
// in the hatch the whole band is a button: the mark and the creatures are small, up by the edge of the screen. The
// minimised dock is one button too.
$('.pill').addEventListener('click', (e) => {
  if ((inHatch() || isMini()) && !justDragged && !e.target.closest('button, .face')) setOpen(!document.body.classList.contains('open'))
})
$('[data-act=close]').addEventListener('click', () => setOpen(false))
$('[data-act=dashboard]').addEventListener('click', () => clique.call('dashboard'))
document.addEventListener('keydown', (e) => e.key === 'Escape' && !composer.stopVoice() && setOpen(false))
clique.onToggle((opts = {}) => {
  const open = opts.open ?? !document.body.classList.contains('open')
  if (opts.align) document.body.dataset.align = opts.align // under the mouse: below the pointer or above it
  if (MOUSE) size = '' // main.js always hears what came of it
  setOpen(open, opts.focus ?? open, { quick: Boolean(opts.quick) })
})
// The message box is there for one message: a click away from it, or the keyboard going to another app, puts it away
// (what you wrote stays for next time). Not while it listens: you may be looking at what you're talking about.
if (MOUSE) {
  let away = false // the keyboard went elsewhere while it listened
  addEventListener('focus', () => (away = false))
  addEventListener('blur', () => {
    if (!isQuick()) return
    if (composer.dictating()) away = true
    else setOpen(false)
  })
  // ...and it stopped listening with the keyboard still elsewhere: put away then, unless it has something to say (the
  // microphone isn't allowed, say), which stays up to be read
  new MutationObserver(() => {
    if (!away || composer.dictating()) return
    away = false
    if (isQuick() && !$('.compose .voice-hint.error:not(.hidden)')) setOpen(false)
  }).observe($('.compose'), { attributes: true, attributeFilter: ['class'] })
  document.addEventListener('pointerdown', (e) => isQuick() && !e.target.closest('.panel, .menu, .mentions, .toast') && setOpen(false))
  // What's open grows and shrinks by itself (lines you write, a picture you paste): main.js holds it by the right corner
  // only if it hears each new size.
  new ResizeObserver(() => isOpen() && fit()).observe($('.panel'))
}
// A message went out of the message box: the wisp hops once, and a few motes fly off it.
function took() {
  document.body.classList.remove('sent')
  void document.body.offsetWidth
  document.body.classList.add('sent')
  setTimeout(() => document.body.classList.remove('sent'), 900)
  if (reduceMotion()) return
  const motes = document.createElement('span')
  motes.className = 'wisp-motes'
  motes.innerHTML = ['#3db8ff', '#ff45a8', '#8b6cff', '#fff', '#3db8ff'].map((b, i, all) => {
    const angle = (i / all.length) * Math.PI * 2 - Math.PI / 2 + Math.random() * 0.5
    const d = 13 + Math.random() * 7
    return `<i style="--x:${(Math.cos(angle) * d).toFixed(1)}px;--y:${(Math.sin(angle) * d).toFixed(1)}px;--b:${b}"></i>`
  }).join('')
  $('.pill').append(motes)
  setTimeout(() => motes.remove(), 800)
}
// The wisp's own life (under the mouse): its tail while it's carried along, a ring once when there's something new, and
// a blink now and then.
const wisp = { fresh: 0, alert: false, seen: false, turned: 0 }
function drawWisp(fresh, alert) {
  morph($('.home-badge'), fresh || alert ? '<i class="wisp-dot"></i>' : '')
  // a reply came in, or someone started needing you, while you watched: one ring
  if (wisp.seen && (fresh > wisp.fresh || (alert && !wisp.alert)) && !isOpen()) {
    const p = $('.pill')
    p.classList.remove('ping')
    void p.offsetWidth
    p.classList.add('ping')
  }
  Object.assign(wisp, { fresh, alert, seen: true })
}
if (MOUSE) {
  // which way it's going (degrees) and how fast (0 to 1), from core/follow.js: the tail lies behind it, turning the
  // short way round
  clique.onTrail?.((angle, speed) => {
    if (speed) wisp.turned += ((((angle - wisp.turned) % 360) + 540) % 360) - 180
    $('.pill').style.setProperty('--a', `${wisp.turned}deg`)
    $('.pill').style.setProperty('--s', String(speed))
  })
  const blink = () => {
    if (!document.hidden && !isOpen() && !reduceMotion()) {
      $('.pill').classList.add('blink')
      setTimeout(() => $('.pill').classList.remove('blink'), 140)
    }
    setTimeout(blink, 5000 + Math.random() * 5000)
  }
  setTimeout(blink, 4000)
}
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
  if (MOUSE) return // the wisp alone follows the pointer
  if (inHatch()) return drawHatch()
  morph($('.hatch-who'), '')
  $('.home').title = isMini() ? miniSays() : PRODUCT_NAME
  if (isMini()) return morph($('.dots'), '') // the mark and its beat (ui/overlay.html .beat) say it
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

// The minimised dock has no creatures to hover: its mark says what they would, "CLIque: 2 at work · Ada needs you".
function miniSays() {
  const on = state.agents.filter((a) => a.on)
  const working = on.filter((a) => a.status === 'working').length
  const needs = needsYou(state)
  const fresh = state.agents.reduce((n, a) => n + a.unread, 0)
  const says = [
    working ? `${working} at work` : on.length ? 'Nobody at work' : '',
    needs.length === 1 ? `${displayName(needs[0].agent)} needs you` : needs.length ? `${needs.length} need you` : '',
    fresh ? plural(fresh, 'new reply', 'new replies') : '',
  ].filter(Boolean)
  return says.length ? `${PRODUCT_NAME}: ${says.join(' · ')}` : PRODUCT_NAME
}

// In the hatch the band says one thing, the most pressing: who needs you (its creature comes out of the notch holding up
// its sign, and what it wants), else who wrote while you were away and how many new replies, else a slow dot while
// anyone works, else nothing. Open, the chat says it all: only the dot stays.
function drawHatch() {
  const needs = needsYou(state)
  const away = elsewhere(state).waiting
  const fresh = state.agents.filter((a) => a.unread)
  const unread = fresh.reduce((n, a) => n + a.unread, 0)
  const working = state.agents.some((a) => a.on && a.status === 'working')
  const dot = working ? '<i class="hatch-dot" title="At work"></i>' : ''
  let who = ''
  let fact = dot
  if (!isOpen() && needs.length) {
    const n = needs[0]
    const type = n.ask?.ask?.type
    const what = needs.length > 1 ? `${needs.length} need you` : type === 'question' ? `${displayName(n.agent)} asks` : type === 'plan' ? `${displayName(n.agent)} has a plan` : `${displayName(n.agent)} needs your OK`
    who = avatarHTML(n.agent, { size: 28, mood: 'waiting', pose: type === 'question' ? 'question' : 'sign', poseMin: 20 })
    fact = `<span class="hatch-fact needs" title="${esc(needs.map((x) => `${displayName(x.agent)}: ${needText(x)}`).join('\n'))}">${esc(what)}</span>`
  } else if (!isOpen() && away) {
    fact = `<span class="hatch-fact needs">${esc(`${plural(away, 'agent')} in another workspace need${away > 1 ? '' : 's'} you`)}</span>`
  } else if (!isOpen() && unread) {
    const latest = fresh.sort((x, y) => (y.since ?? 0) - (x.since ?? 0))[0]
    who = avatarHTML(latest, { size: 22, mood: 'still' })
    fact = `<span class="hatch-fact">${esc(unread > 1 ? `${unread} new` : `${displayName(latest)} replied`)}</span>${dot}`
  }
  morph($('.hatch-who'), who)
  morph($('.dots'), fact)
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
  // the minimised dock (an experiment, from settings): the pill's look, so not under the mouse
  document.body.classList.toggle('mini', !MOUSE && Boolean(state.app?.chat?.mini))
  // with workspaces, the chat says whose it is
  morph($('.panel header .brand'), hasWorkspaces(state) ? `${wsTile(state.workspace, { size: 20 })}<b>${esc(wsLabel(state.workspace))}</b>` : wordmarkHTML(20))
  drawPill()
  if (!MOUSE) celebrate($('.dots'), state.agents)
  morph($('.sums'), cliqueSummary(state, { needs: false })) // (Needs you, docked over the message box, says who)
  // the mark in the pill counts every reply you haven't read (the wisp only says there are some)
  const fresh = state.agents.reduce((n, a) => n + a.unread, 0)
  if (MOUSE) drawWisp(fresh, document.body.classList.contains('alert'))
  else morph($('.home-badge'), fresh ? `<span class="unread-badge">${fresh > 9 ? '9+' : fresh}</span>` : '')
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
  // (the message box shows no chat: what comes in while it's up still notifies)
  const view = !state || !isOpen() || isQuick() ? null
    : { ws: state.workspace?.id ?? '', agent: isConvo(to) ? familyOf(to) : null, sees: needsYou(state).filter((n) => n.ask).map((n) => n.agent.name), tasks: false } // (Needs you is over the message box in a conversation too)
  const said = JSON.stringify(view)
  if (said === lookingSaid) return
  lookingSaid = said
  clique.looking?.(view)
}

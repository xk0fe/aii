// Floating pill on the screen edge; click it (or press the hotkey) for the chat panel.
/* global crew, live, morph, esc, isUnread, unreadBadge, statusText, displayName, cloneTag, runningSubs, orbitHTML, plural, agentColor, mountFeed, mountComposer, avatarHTML, markSVG, crewSummary, celebrate, ICONS */

const $ = (s) => document.querySelector(s)
$('.home').innerHTML = markSVG('0 6 24 16')
$('.panel header .logo').outerHTML = markSVG('0 6 24 16')
$('[data-act=dashboard]').innerHTML = ICONS.expand
$('[data-act=close]').innerHTML = ICONS.close

const feed = mountFeed($('.feed'), { limit: 80, onAgent: (name) => crew.call('dashboard', name), onReply: (e) => composer.replyTo(e) })
const composer = mountComposer($('.compose'), { dropZone: $('.panel') })
let size = ''

// The window wraps what's drawn; main.js places it so the pill stays where it is, so it's told where the pill is.
function fit(focus = false) {
  const r = $('.wrap').getBoundingClientRect()
  const p = $('.pill').getBoundingClientRect()
  const pill = { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) }
  const next = `${Math.ceil(r.width)}x${Math.ceil(r.height)}@${Object.values(pill)}`
  if (next === size && !focus) return
  size = next
  crew.fit(Math.ceil(r.width), Math.ceil(r.height), focus, pill)
}

// Which side of the pill the chat goes on, from main.js (core/pill.js): by the left edge it opens to the right,
// at the top below, and so on. At the top and bottom the pill lies flat.
crew.onPlace(({ side, align }) => {
  const body = document.body
  const moved = body.dataset.side && body.dataset.side !== side
  body.dataset.side = side
  body.dataset.align = align
  if (moved && body.classList.contains('open')) {
    body.classList.remove('moved')
    void body.offsetWidth
    body.classList.add('moved') // the panel swaps sides with a little settle, once
  }
  size = '' // always tell main.js: even when nothing changed size, the pill's place on screen did
  fit()
})

$('.panel').addEventListener('animationend', (e) => e.animationName === 'panel-moved' && document.body.classList.remove('moved'))

// Drag the pill (or the chat by its header) anywhere; main.js moves the window with the pointer and, when you
// let go, picks the chat's side for where you left it. It's a drag once the pointer has moved a few pixels, so
// a click stays a click. Buttons and creatures stay clickable.
for (const handle of [$('.pill'), $('.panel header')]) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, .face, .sums, a, input, textarea')) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    const [x0, y0] = [e.screenX, e.screenY]
    let dragging = false
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.screenX - x0, ev.screenY - y0) < 3) return
      if (!dragging) {
        dragging = true
        document.body.classList.add('dragging')
        crew.drag('start', x0, y0)
      }
      crew.drag('move', ev.screenX, ev.screenY)
    }
    const end = (ev) => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      handle.removeEventListener('lostpointercapture', end)
      document.body.classList.remove('dragging')
      if (dragging) crew.drag('end', ev.screenX, ev.screenY)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
    handle.addEventListener('lostpointercapture', end) // the window went away mid-drag
  })
}

// focus=false opens the chat without pulling you out of the app you're in (e.g. after closing the dashboard).
function setOpen(open, focus = open) {
  if (!open) composer.stopVoice() // closing the panel ends dictation, keeping what it heard
  document.body.classList.toggle('open', open)
  fit(focus)
  if (!open) return
  $('.feed').scrollTop = $('.feed').scrollHeight // it can't scroll while hidden, so catch up on open
  if (focus) composer.focus()
}

$('.home').addEventListener('click', () => setOpen(!document.body.classList.contains('open')))
$('[data-act=close]').addEventListener('click', () => setOpen(false))
$('[data-act=dashboard]').addEventListener('click', () => crew.call('dashboard'))
document.addEventListener('keydown', (e) => e.key === 'Escape' && !composer.stopVoice() && setOpen(false))
crew.onToggle((opts = {}) => {
  const open = opts.open ?? !document.body.classList.contains('open')
  setOpen(open, opts.focus ?? open)
})
// Tap a creature in the pill to talk to that agent; with replies you haven't read, the chat opens on the first.
let state = null
$('.dots').addEventListener('click', (e) => {
  if (e.target.closest('[data-more-faces]')) return setOpen(true)
  const face = e.target.closest('[data-agent]')
  if (!face) return
  composer.setTarget(face.dataset.agent)
  setOpen(true)
  const first = state?.feed.find((x) => x.from === face.dataset.agent && isUnread(x, state.reads))
  if (first) requestAnimationFrame(() => feed.jump(first.id))
})

live((next) => {
  state = next
  const on = state.agents.filter((a) => a.on)
  const working = on.filter((a) => a.status === 'working').length
  document.body.classList.toggle('busy', working > 0)
  document.body.classList.toggle('alert', state.agents.some((a) => a.status === 'waiting'))
  // A big crew doesn't fit along a screen edge: the pill keeps the ones that need a look (waiting on you, new
  // replies, at work) in their usual order, and the rest become "+N", which opens the chat.
  const flat = ['above', 'below'].includes(document.body.dataset.side)
  const room = Math.max(4, Math.min(14, Math.floor(((flat ? screen.availWidth : screen.availHeight) * 0.72 - 90) / 32)))
  let shown = on
  if (on.length > room) {
    const look = new Set(on.filter((a) => a.status === 'waiting' || a.unread || a.status === 'working').slice(0, room - 1).map((a) => a.name))
    for (const a of on) if (look.size < room - 1) look.add(a.name)
    shown = on.filter((a) => look.has(a.name))
  }
  const hidden = on.length - shown.length
  // a clone pops out next to its original, a little smaller, with its number
  morph($('.dots'), shown.map((a) => {
    const subs = runningSubs(a).length
    return `<span class="face${a.cloneOf ? ' clone' : ''}" data-agent="${esc(a.name)}" style="--c:${agentColor(a)}" title="${esc(`${displayName(a)}${a.cloneOf ? ` (a clone of ${a.cloneOf})` : ''}: ${statusText(a)}${subs ? ` · ${plural(subs, 'sub-agent')} working` : ''}${a.unread ? ` · ${plural(a.unread, 'new reply', 'new replies')}` : ''}`)}">${avatarHTML(a, { size: a.cloneOf ? 24 : 30 })}${orbitHTML(a)}${cloneTag(a)}${unreadBadge(a.unread)}</span>`
  }).join('') + (hidden ? `<button class="more-faces" data-more-faces title="${esc(`${plural(hidden, 'more agent')}: ${on.filter((a) => !shown.includes(a)).map((a) => a.name).join(', ')}`)}">+${hidden}</button>` : ''))
  celebrate($('.dots'), state.agents)
  morph($('.sums'), crewSummary(state))
  // the mark in the pill counts every reply you haven't read
  const fresh = state.agents.reduce((n, a) => n + a.unread, 0)
  morph($('.home-badge'), fresh ? `<span class="unread-badge">${fresh > 9 ? '9+' : fresh}</span>` : '')
  feed.render(state)
  composer.render(state)
  fit()
})

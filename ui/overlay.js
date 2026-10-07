// Floating pill on the screen edge; click it (or press the hotkey) for the chat panel.
/* global crew, live, morph, esc, statusText, mountFeed, mountComposer, avatarHTML, markSVG, ICONS */

const $ = (s) => document.querySelector(s)
$('.home').innerHTML = markSVG('0 6 24 16')
$('[data-act=dashboard]').innerHTML = ICONS.expand
$('[data-act=close]').innerHTML = ICONS.close

const feed = mountFeed($('.feed'), { limit: 80, onAgent: (name) => crew.call('dashboard', name) })
const composer = mountComposer($('.compose'), { dropZone: $('.panel') })
let size = ''

function fit(focus = false) {
  const r = $('.wrap').getBoundingClientRect()
  const next = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (next === size && !focus) return
  size = next
  crew.fit(Math.ceil(r.width), Math.ceil(r.height), focus)
}

// focus=false opens the chat without pulling you out of the app you're in (e.g. after closing the dashboard).
function setOpen(open, focus = open) {
  document.body.classList.toggle('open', open)
  fit(focus)
  if (!open) return
  $('.feed').scrollTop = $('.feed').scrollHeight // it can't scroll while hidden, so catch up on open
  if (focus) composer.focus()
}

$('.home').addEventListener('click', () => setOpen(!document.body.classList.contains('open')))
$('[data-act=close]').addEventListener('click', () => setOpen(false))
$('[data-act=dashboard]').addEventListener('click', () => crew.call('dashboard'))
document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false))
crew.onToggle((opts = {}) => {
  const open = opts.open ?? !document.body.classList.contains('open')
  setOpen(open, opts.focus ?? open)
})
// Tap a creature in the pill to talk to that agent.
$('.dots').addEventListener('click', (e) => {
  const face = e.target.closest('[data-agent]')
  if (!face) return
  composer.setTarget(face.dataset.agent)
  setOpen(true)
})

live((state) => {
  const on = state.agents.filter((a) => a.on)
  const working = on.filter((a) => a.status === 'working').length
  document.body.classList.toggle('busy', working > 0)
  document.body.classList.toggle('alert', state.agents.some((a) => a.status === 'waiting'))
  morph($('.dots'), on.map((a) => `<span class="face" data-agent="${esc(a.name)}" title="${esc(`${a.name}: ${statusText(a)}`)}">${avatarHTML(a, { size: 30 })}</span>`).join(''))
  const where = state.link?.mode === 'remote' ? ` · on ${state.link.name}` : ''
  $('.sub').textContent = (on.length ? `${working} of ${on.length} working` : '') + where
  feed.render(state)
  composer.render(state)
  fit()
})

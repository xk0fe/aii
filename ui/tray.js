// Menu bar popover: who's doing what, autopilot, and the way into everything else.
/* global themeButton, crew, live, morph, agentCard, crewSummary, celebrate, markSVG, ICONS */

const $ = (s) => document.querySelector(s)
$('.logo').outerHTML = markSVG('0 6 24 16')
$('.autopilot .glyph').innerHTML = ICONS.plane
$('[data-act=add]').innerHTML = `${ICONS.plus}Add agent`
$('[data-act=dashboard]').innerHTML = ICONS.expand
$('[data-act=config]').innerHTML = ICONS.braces
const drawTheme = themeButton($('[data-theme]'))
$('[data-act=quit]').innerHTML = ICONS.power

document.addEventListener('click', (e) => {
  if (e.target.closest('.mode, .switch')) return
  const card = e.target.closest('.agent')
  if (card) return crew.call('dashboard', card.dataset.agent)
  const el = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  if (act === 'add') crew.call('dashboard', ':add')
  else crew.call(act)
})
$('.autopilot .switch').addEventListener('change', (e) => crew.call('autopilot', e.target.checked))

// The window is hidden, not closed, between clicks on the menu bar icon: replay the entrance on each open.
const opened = () => {
  document.body.classList.remove('opened')
  void document.body.offsetWidth
  document.body.classList.add('opened')
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && opened())
opened()

live((state) => {
  drawTheme(state.theme)
  morph($('.agents'), state.agents.length
    ? state.agents.map((a) => agentCard(a, state.providers)).join('')
    : '<div class="empty">No agents yet. Add one per area of work, like onboarding or the 3D character.</div>')
  celebrate($('.agents'), state.agents)
  morph($('.sums'), crewSummary(state))
  $('.autopilot .switch').checked = state.autopilot
  crew.fit(340, document.body.scrollHeight)
})

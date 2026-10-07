// Menu bar popover: who's doing what, autopilot, and the way into everything else.
/* global themeButton, crew, live, morph, agentCard, ICONS */

const $ = (s) => document.querySelector(s)
$('[data-act=dashboard]').innerHTML = ICONS.expand
$('[data-act=config]').innerHTML = ICONS.braces
const drawTheme = themeButton($('[data-theme]'))
$('[data-act=quit]').innerHTML = ICONS.power

document.addEventListener('click', (e) => {
  if (e.target.closest('.yolo, .switch')) return
  const card = e.target.closest('.agent')
  if (card) return crew.call('dashboard', card.dataset.agent)
  const el = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  if (act === 'add') crew.call('dashboard', ':add')
  else crew.call(act)
})
$('.autopilot .switch').addEventListener('change', (e) => crew.call('autopilot', e.target.checked))

live((state) => {
  drawTheme(state.theme)
  morph($('.agents'), state.agents.length
    ? state.agents.map((a) => agentCard(a, state.providers)).join('')
    : '<div class="empty">No agents yet. Add one per area of work, like onboarding or the 3D character.</div>')
  const on = state.agents.filter((a) => a.on)
  const working = on.filter((a) => a.status === 'working').length
  const where = state.link?.mode === 'remote' ? ` · on ${state.link.name}${state.link.connected ? '' : ' (reconnecting)'}` : ''
  $('.summary').textContent = (state.agents.length ? `${working} of ${on.length} working` : '') + where
  $('.autopilot .switch').checked = state.autopilot
  crew.fit(340, document.body.scrollHeight)
})

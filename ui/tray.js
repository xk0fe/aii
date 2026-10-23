// Menu bar popover: who's doing what, autopilot, and the way into everything else.
/* global themeButton, crew, live, morph, esc, rosterParts, crewSummary, usageTip, limitNums, paceWarning, spendLine, spendTip, celebrate, markSVG, store, ICONS */

const $ = (s) => document.querySelector(s)
$('.logo').outerHTML = markSVG('0 6 24 16')
$('.autopilot .glyph').innerHTML = ICONS.plane
$('[data-act=add]').innerHTML = `${ICONS.plus}Add agent`
$('[data-act=dashboard]').innerHTML = ICONS.expand
$('[data-act=config]').innerHTML = ICONS.braces
const drawTheme = themeButton($('[data-theme]'))
$('[data-act=quit]').innerHTML = ICONS.power

// folds are shared with nothing else: the popover remembers its own
const folds = new Set((() => {
  try {
    return JSON.parse(store.get('crew.tray.folds') || '[]')
  } catch {
    return []
  }
})())
let state = null
document.addEventListener('click', (e) => {
  if (e.target.closest('.mode, .switch')) return
  const clone = e.target.closest('[data-clone]')
  if (clone) return crew.call('dashboard', clone.dataset.clone) // its terminal
  const fold = e.target.closest('[data-fold]')
  if (fold) {
    folds.has(fold.dataset.fold) ? folds.delete(fold.dataset.fold) : folds.add(fold.dataset.fold)
    store.set('crew.tray.folds', JSON.stringify([...folds]))
    return draw()
  }
  const card = e.target.closest('.crow')
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

// The popover grows with the crew up to most of the screen, then the crew scrolls inside it.
function draw() {
  drawTheme(state.theme)
  document.documentElement.style.setProperty('--max', `${Math.max(260, Math.min(620, screen.availHeight - 260))}px`)
  morph($('.roster'), state.agents.length
    ? rosterParts(state, { folds })
    : ['<div class="empty">No agents yet. Add one per area of work, like onboarding or the 3D character.</div>'])
  celebrate($('.roster'), state.agents)
  morph($('.sums'), crewSummary(state))
  const spent = spendLine(state.spend)
  morph($('.usage'), Object.values(state.usage ?? {}).map((u) => `<div class="usage-row" title="${esc(usageTip(u))}"><span>${esc(u.label)} limits</span><span class="grow"></span>${limitNums(u)}</div>${paceWarning(u) ? `<div class="usage-pace">${esc(paceWarning(u))}</div>` : ''}`).join('') +
    (spent ? `<div class="usage-row" title="${esc(spendTip(state.spend))}"><span>Spent</span><span class="grow"></span><b>${spent}</b></div>` : ''))
  $('.autopilot .switch').checked = state.autopilot
  $('.autopilot p').textContent = state.autopilot ? 'Agents hand off work without asking you first' : 'Each hand-off waits for your Send it'
  crew.fit(340, document.body.scrollHeight)
}

live((next) => {
  state = next
  draw()
})

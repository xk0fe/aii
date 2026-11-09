// Q's tour of the app: at the end of a first run (ui/setup.js), and from the ⋯ menu any time. One part of the dashboard
// at a time is lit, with the rest dimmed, and Q's card beside it says what it's for. Next and Back step through it, and
// Skip (or Escape) ends it; the arrow keys and Enter step too. A part that isn't on screen is passed over.
// steps: [{ at: a selector, or none for a card in the middle; say: what Q says; before(): put it on screen }].
// who(): Q as the state has him, for his face. onEnd(done): done when it ran to its end rather than being skipped.
/* global avatarHTML, esc */

function mountTour({ steps, who, onEnd = () => {} }) {
  const root = Object.assign(document.createElement('div'), { className: 'tour', hidden: true })
  root.innerHTML = '<div class="tour-hole"></div><div class="tour-card" role="dialog" aria-modal="true" aria-label="A tour of the app"></div>'
  document.body.append(root)
  const hole = root.querySelector('.tour-hole')
  const card = root.querySelector('.tour-card')
  let list = []
  let at = -1
  let timer = 0

  const shown = (s) => {
    if (!s.at) return true
    const r = document.querySelector(s.at)?.getBoundingClientRect()
    return Boolean(r && r.width > 4 && r.height > 4)
  }

  // the lit part, and Q's card beside it: right of it where there's room, else left, below or above; a part that
  // fills most of the window gets the card over it
  function place() {
    const s = list[at]
    const r = s?.at ? document.querySelector(s.at)?.getBoundingClientRect() : null
    root.classList.toggle('middle', !r)
    if (r) Object.assign(hole.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` })
    const W = innerWidth
    const H = innerHeight
    const cw = card.offsetWidth
    const ch = card.offsetHeight
    const gap = 18
    const m = 16
    let x = (W - cw) / 2
    let y = (H - ch) / 2
    if (r && r.width > W * 0.45 && r.height > H * 0.45) (x = r.left + (r.width - cw) / 2), (y = r.top + Math.min(r.height * 0.22, 140))
    else if (r && r.right + gap + cw <= W - m) (x = r.right + gap), (y = r.top)
    else if (r && r.left - gap - cw >= m) (x = r.left - gap - cw), (y = r.top)
    else if (r && r.bottom + gap + ch <= H - m) (x = r.left), (y = r.bottom + gap)
    else if (r) (x = r.left), (y = r.top - gap - ch)
    Object.assign(card.style, { left: `${Math.round(Math.min(Math.max(x, m), W - cw - m))}px`, top: `${Math.round(Math.min(Math.max(y, m), H - ch - m))}px` })
  }

  function draw() {
    const s = list[at]
    const last = at === list.length - 1
    const words = s.say.split(' ').map((w, i) => `<span style="--i:${i}">${esc(w)}</span>`).join(' ')
    card.innerHTML = `<span class="tour-q">${avatarHTML({ ...(who?.() ?? {}), name: 'Q', status: 'idle', on: true }, { size: 44, mood: 'idle' })}</span>
      <div class="tour-body"><p class="tour-say">${words}</p>
        <div class="tour-foot"><span class="tour-n">${at + 1} of ${list.length}</span><span class="grow"></span>
          ${at ? '<button type="button" class="btn sm" data-tour="back">Back</button>' : '<button type="button" class="btn sm" data-tour="skip">Skip tour</button>'}
          <button type="button" class="btn sm brand-btn" data-tour="next">${last ? 'Start' : 'Next'}</button></div></div>`
  }

  // a step: what was lit fades, the next part is put on screen, then it's lit and Q's card comes in beside it
  function go(next) {
    while (next >= 0 && next < list.length && !shown(list[next]) && !list[next].before) next += next > at ? 1 : -1
    if (next < 0) return
    if (next >= list.length) return end(true)
    root.classList.add('moving')
    clearTimeout(timer)
    timer = setTimeout(() => {
      at = next
      list[at].before?.()
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!shown(list[at])) return go(at + (next >= at ? 1 : -1)) // put on screen, and still not there
        draw()
        place()
        root.classList.remove('moving')
        card.querySelector('[data-tour="next"]')?.focus({ preventScroll: true })
      }))
    }, at < 0 ? 0 : 140)
  }

  function end(done) {
    if (root.hidden) return
    clearTimeout(timer)
    root.hidden = true
    at = -1
    onEnd(done)
  }

  card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-tour]')?.dataset.tour
    if (act === 'next') go(at + 1)
    if (act === 'back') go(at - 1)
    if (act === 'skip') end(false)
  })
  addEventListener('keydown', (e) => {
    if (root.hidden) return
    if (e.key === 'Escape') return e.preventDefault(), end(false)
    if (e.key === 'ArrowRight') return e.preventDefault(), go(at + 1)
    if (e.key === 'ArrowLeft') return e.preventDefault(), go(at - 1)
  }, true)
  addEventListener('resize', () => !root.hidden && at >= 0 && place())

  return {
    start() {
      const all = typeof steps === 'function' ? steps() : steps
      if (!all.length) return
      all[0].before?.() // the dashboard as the tour begins it (the chat), before anything's counted
      at = -1
      root.hidden = false
      root.classList.add('moving')
      // what can be shown, so the count is right: a part that's off screen and that nothing puts on it is left out
      requestAnimationFrame(() => requestAnimationFrame(() => {
        list = all.filter((s) => s.before || shown(s))
        go(0)
      }))
    },
    stop: () => end(false),
    isOn: () => !root.hidden,
  }
}

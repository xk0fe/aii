// The Tasks board: work for the crew (bugs, features, chores) as To do → In progress → Review → Done.
// Add one with New task or a column's + (or from the chat). Starting one hands it to its owner in a fresh
// conversation, so tasks don't pile into one long context; you review what comes back. Board or list, filtered by
// kind, owner or search; open a task for everything about it. Data comes from the hub (core/tickets.js) via crew.call('task').
/* global PRODUCT_NAME, ownerIn, mountMentions, mountInk, crew, store, esc, avatarHTML, agentColor, mountAttach, morph, ago, md, snippet, nameHTML, ICONS, fileURL, bounce, contextRing, segmented, money, tokenCount, SPEND_NOTE, keys, errorLine */

const STATUS = [
  { id: 'new', label: 'To do' },
  { id: 'fixing', label: 'In progress' },
  { id: 'check', label: 'Review' },
  { id: 'done', label: 'Done' },
]
const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.id, s.label]))
const PRIORITIES = [
  { id: 'blocker', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Medium' },
  { id: 'low', label: 'Low' },
]
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.label]))
const PRIORITY_RANK = { blocker: 0, high: 1, normal: 2, low: 3 }
const KINDS = [
  { id: 'task', label: 'Task', plural: 'Tasks' },
  { id: 'bug', label: 'Bug', plural: 'Bugs' },
  { id: 'feature', label: 'Feature', plural: 'Features' },
]
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]))
const DONE_SHOWN = 30

// Little glyphs, drawn at 16px: status (Linear-style rings), priority (signal bars) and kind.
const icon = (body, cls = '') => `<svg class="ti ${cls}" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`
const STATUS_ICON = {
  new: icon('<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.3 1.9"/>', 'st-new'),
  fixing: icon('<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.4a3.6 3.6 0 0 1 0 7.2z" fill="currentColor"/>', 'st-fixing'),
  check: icon('<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.4a3.6 3.6 0 1 1-3.6 3.6H8z" fill="currentColor"/>', 'st-check'),
  done: icon('<circle cx="8" cy="8" r="6.4" fill="currentColor"/><path d="M5.3 8.2l1.8 1.8 3.6-3.8" fill="none" stroke="var(--surface)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>', 'st-done'),
}
const bars = (n) => [0, 1, 2].map((i) => `<rect x="${2.5 + i * 4}" y="${10.5 - i * 3}" width="2.6" height="${3.5 + i * 3}" rx=".8" fill="currentColor" opacity="${i < n ? 1 : 0.28}"/>`).join('')
const PRIORITY_ICON = {
  blocker: icon('<rect x="2" y="2" width="12" height="12" rx="3.2" fill="currentColor"/><path d="M8 4.8v4.1" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.2" r="1" fill="var(--surface)"/>', 'pr-blocker'),
  high: icon(bars(3), 'pr-high'),
  normal: icon(bars(2), 'pr-normal'),
  low: icon(bars(1), 'pr-low'),
}
const KIND_ICON = Object.fromEntries(['task', 'bug', 'feature'].map((k) => [k, `<span class="ki ki-${k}">${ICONS[k]}</span>`]))
const GEAR = icon('<path d="M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7 3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>')
const BOARD = icon('<rect x="2" y="2.5" width="3.4" height="11" rx="1.2" fill="currentColor"/><rect x="6.3" y="2.5" width="3.4" height="7.5" rx="1.2" fill="currentColor"/><rect x="10.6" y="2.5" width="3.4" height="9" rx="1.2" fill="currentColor"/>')
const LIST = icon('<rect x="2" y="3" width="12" height="2.2" rx="1.1" fill="currentColor"/><rect x="2" y="6.9" width="12" height="2.2" rx="1.1" fill="currentColor"/><rect x="2" y="10.8" width="12" height="2.2" rx="1.1" fill="currentColor"/>')
const PICTURE = icon('<rect x="2" y="3" width="12" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="6.7" r="1.2" fill="currentColor"/><path d="M3 12l3.4-3.2 2.4 2 2.2-1.9L14 11.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>')
const BACK = icon('<path d="M6.2 4.2 2.8 7.4l3.4 3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.2 7.4h6.3a3.6 3.6 0 0 1 0 7.2H8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>')
const CHEVRON = icon('<path d="M5.5 6.5L8 9l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>')
const PICK_ALL = icon('<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8.1l2 2 3.8-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>')
const TK_FUNNEL = icon('<path d="M2.6 3.4h10.8L9.3 8.4v4.3l-2.6-1.3v-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>')
// The columns you can add to with their +: To do adds, In progress adds and starts it right away.
const TK_ADD_TO = { new: 'Add a task', fixing: 'Start a new task' }

function mountTasks(root, { onTerminal }) {
  root.innerHTML = `
    <section class="tasks">
      <header class="tk-head">
        <div class="tk-headline"><h2>Tasks</h2><div class="tk-sub"></div></div>
        <span class="grow"></span>
        <div class="tk-search"><input type="search" placeholder="Search tasks" spellcheck="false" data-search><button class="icon tk-search-btn" data-search-btn></button></div>
        <span class="tk-active"></span>
        <button class="btn tk-hbtn" data-filter-btn title="Filter by kind or owner" aria-haspopup="true" aria-expanded="false">${TK_FUNNEL}<span>Filter</span></button>
        <div class="seg tk-views"><button data-mode="board" title="Board">${BOARD}</button><button data-mode="list" title="List">${LIST}</button></div>
        <button class="btn primary tk-hbtn" data-new-task title="New task (N)">${ICONS.plus}<span>New task</span></button>
        <button class="icon tk-more" data-board-menu title="Workflow, and acting on many tasks at once">${ICONS.more}</button>
      </header>
      <div class="tk-body">
        <div class="tk-board"></div>
        <div class="tk-list"></div>
        <div class="tk-empty"></div>
      </div>
      <div class="tk-fpop hidden" data-filter-pop role="menu" aria-label="Filter"></div>
      <div class="tk-add-pop hidden"></div>
      <div class="tk-add-home hidden">
        <div class="tk-add" data-kind="task">
          <textarea rows="1" spellcheck="true" data-add></textarea>
          <div class="thumbs tk-add-shots hidden"></div>
          <div class="tk-add-foot">
            <button class="tk-kind" data-kind-pick title="Kind (click to change)"></button>
            <span class="tk-to"></span>
            <span class="grow"></span>
            <button class="icon attach" title="Add a screenshot (or paste / drop one)">${PICTURE}</button>
            <button class="tk-btn go tk-add-go" disabled>Add</button>
          </div>
        </div>
      </div>
      <div class="tk-bulk"></div>
      <div class="tk-toast"></div>
    </section>
    <aside class="tp"></aside>`
  const $ = (s) => root.querySelector(s)
  const tp = $('.tp')
  const add = $('[data-add]')
  let ink = null // mentions in color (mountInk), set up with the composer's other listeners below
  const addGo = $('.tk-add-go')
  let state = null
  let tickets = []
  let mode = store.get('crew.tasks.view') === 'list' ? 'list' : 'board'
  let doneOpen = store.get('crew.tasks.done') === '1'
  let addKind = 'task'
  const filter = { q: '', kind: '', owner: '' }
  let selected = null // the open task's key
  const picked = new Set() // tasks picked to act on all at once (⌘-click, Shift-click, a lane's select-all)
  let anchor = null // the last one picked or let go: Shift-click picks from there
  let panelFor = null // the task the panel was built for
  let shots = null
  let sendingBack = false
  let editingBody = false
  let first = true
  let fresh = null // a task just added: it pops in
  let showAllDone = false
  let composeAt = null // the column the composer adds to while it's open ('new' or 'fixing'), or null
  let composeFrom = null // the button that opened it (the list's popover hangs from it)

  const agent = (n) => (n ? (state.agents.find((a) => a.name === n) ?? { name: n, seed: n.split('@')[0], on: false, status: 'off' }) : null)
  // Who is on a task right now: its owner, or the clone of it that took the task.
  const worker = (t) => (t.fixer ? (state.agents.find((a) => (a.name === t.fixer || a.cloneOf === t.fixer) && String(a.ticket) === t.key) ?? agent(t.fixer)) : null)
  const ticket = (key) => tickets.find((t) => t.key === key)
  const who = (n) => (n === 'you' ? 'You' : n === 'crew' ? PRODUCT_NAME : `@${esc(n)}`)
  const call = async (...args) => {
    try {
      return await crew.call('task', ...args)
    } catch (e) {
      toast(errorLine(e), true)
      throw e
    }
  }
  const toast = (text, error = false) => {
    const el = $('.tk-toast')
    el.textContent = text
    el.className = `tk-toast show ${error ? 'error' : ''}`
    clearTimeout(toast.timer)
    toast.timer = setTimeout(() => el.classList.remove('show'), error ? 5000 : 2600)
  }

  // ---- pop-up menus: status, priority, kind, owner, and the workflow settings ---------------------

  let pop = null
  function closePop() {
    pop?.remove()
    pop = null
    document.removeEventListener('pointerdown', outside, true)
  }
  const outside = (e) => pop && !pop.contains(e.target) && !e.target.closest('[data-board-menu], [data-menu], [data-kind-pick]') && closePop()
  function openPop(anchor, html, { width } = {}) {
    closePop()
    pop = document.createElement('div')
    pop.className = 'tk-pop'
    if (width) pop.style.width = `${width}px`
    pop.innerHTML = html
    document.body.append(pop)
    const r = anchor.getBoundingClientRect()
    const w = pop.offsetWidth
    const h = pop.offsetHeight
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8)
    const top = r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px` })
    setTimeout(() => document.addEventListener('pointerdown', outside, true))
    return pop
  }
  // items: [{ value, label, icon, hint, on, attr }]
  function menu(anchor, items, onPick) {
    const el = openPop(anchor, items.map((it, i) => `<button class="tk-pop-item ${it.on ? 'on' : ''}" data-i="${i}" ${it.attr ?? ''}>${it.icon ?? ''}<span class="tk-pop-label">${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}${it.on ? `<i class="tk-pop-check">${ICONS.check}</i>` : ''}</button>`).join(''))
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]')
      if (!b) return
      closePop()
      onPick(items[b.dataset.i].value)
    })
    el.querySelector('.on, .tk-pop-item')?.focus()
    el.addEventListener('keydown', (e) => {
      const list = [...el.querySelectorAll('.tk-pop-item')]
      const i = list.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') (e.preventDefault(), list[(i + 1) % list.length].focus())
      if (e.key === 'ArrowUp') (e.preventDefault(), list[(i - 1 + list.length) % list.length].focus())
    })
  }
  const ownerItems = (current) => [
    ...state.agents.filter((a) => !a.cloneOf && (a.on || a.name === current)).map((a) => ({ value: a.name, label: a.home ? `${a.seed}@${a.home}` : a.name, hint: a.area, icon: avatarHTML(a, { size: 20, mood: 'still' }), on: a.name === current })),
    { value: '', label: 'Nobody', icon: '<i class="tk-nobody">?</i>', on: !current },
  ]
  const statusItems = (t) => STATUS.map((s) => ({ value: s.id, label: s.label, icon: STATUS_ICON[s.id], on: t.status === s.id, hint: s.id === 'fixing' && t.status !== 'fixing' ? 'starts it' : '' }))
  const priorityItems = (t) => PRIORITIES.map((p) => ({ value: p.id, label: p.label, icon: PRIORITY_ICON[p.id], on: t.severity === p.id }))
  const kindItems = (current) => KINDS.map((k) => ({ value: k.id, label: k.label, icon: KIND_ICON[k.id], on: current === k.id }))

  // A task's property, changed from a menu.
  function pick(t, prop, anchor) {
    if (prop === 'owner') return menu(anchor, ownerItems(t.owner), (v) => v !== (t.owner ?? '') && call('edit', t.key, { owner: v }).catch(() => {}))
    if (prop === 'priority') return menu(anchor, priorityItems(t), (v) => v !== t.severity && call('edit', t.key, { severity: v }).catch(() => {}))
    if (prop === 'kind') return menu(anchor, kindItems(t.kind), (v) => v !== t.kind && call('edit', t.key, { kind: v }).catch(() => {}))
    if (prop === 'status') return menu(anchor, statusItems(t), (v) => move(t, v))
  }

  async function move(t, status) {
    if (t.status === status) return
    if (status === 'fixing' && !t.owner) {
      toast(`Pick who does #${t.id} first`, true)
      return open(t.key)
    }
    await call('move', t.key, status).catch(() => {})
    if (status === 'fixing') toast(`#${t.id} went to @${t.owner}, in a new conversation`)
  }

  // Triage and Auto-start, from the header's ⋯.
  function workflow(anchor) {
    const el = openPop(anchor, `
      <div class="tk-flow-pop" data-flow-pop>
        <label class="tk-flow-row"><span><b>Triage</b><small>An agent that makes what you add clear (steps, priority, kind), gives it to the right agent and spots duplicates. Without one, tasks go to whoever's area they match.</small></span>
          <select data-triage><option value="">Nobody</option>${state.agents.filter((a) => !a.home && !a.cloneOf).map((a) => `<option value="${esc(a.name)}" ${state.tasks.triage === a.name ? 'selected' : ''}>${esc(a.name)}${a.on ? '' : ' (off)'}</option>`).join('')}</select></label>
        <label class="tk-flow-row"><span><b>Auto-start</b><small>A task goes to its owner as soon as it has one, in a fresh conversation. Off: you start each one.</small></span>
          <input type="checkbox" class="switch sm" data-autofix ${state.tasks.autofix ? 'checked' : ''}></label>
      </div>`, { width: 360 })
    el.addEventListener('change', (e) => {
      if ('triage' in e.target.dataset) crew.call('taskSettings', { triage: e.target.value || null })
      if ('autofix' in e.target.dataset) crew.call('taskSettings', { autofix: e.target.checked })
    })
  }

  // ---- adding a task -----------------------------------------------------------------------------
  // One composer: New task or a column's + opens it at the top of that column (in the list, as a popover under the
  // button). Kind, a title where @name assigns it, screenshots pasted, dropped or picked. Enter adds, Escape closes;
  // what you typed stays for next time. From In progress's +, the new task starts right away.

  const composer = $('.tk-add')
  const addPop = $('.tk-add-pop')
  const attach = mountAttach({
    zone: composer,
    field: add,
    tray: $('.tk-add-shots'),
    button: composer.querySelector('.attach'),
    onChange: () => syncAdd(),
    onError: (msg) => toast(msg, true),
  })
  const drafted = () => Boolean(add.value.trim() || attach.get().length)
  function syncAdd() {
    // measured only when it's on screen (a closed composer would measure 0 and squash it); empty, it fits the
    // placeholder, which wraps in a slim column
    add.style.height = 'auto'
    if (add.offsetParent) add.style.height = `${Math.min(add.scrollHeight, 140)}px`
    add.style.overflowY = add.scrollHeight > 140 ? 'auto' : '' // a scrollbar only once it stops growing
    addGo.disabled = !drafted()
    const starting = composeAt === 'fixing'
    if (addGo.textContent !== (starting ? 'Start' : 'Add')) addGo.textContent = starting ? 'Start' : 'Add'
    add.placeholder = starting ? 'Start a task…  @name does it' : 'Add a task…  @name assigns it'
    ink?.paint()
    morph($('[data-kind-pick]'), `${KIND_ICON[addKind]}<span>${KIND_LABEL[addKind]}</span>${CHEVRON}`)
    composer.dataset.kind = addKind
    // who it'll go to, as you type @name
    const { owner } = state ? ownerIn(add.value, state.agents) : { owner: null }
    morph($('.tk-to'), owner ? `<span class="tk-to-chip" title="It goes to @${esc(owner)}">→ ${avatarHTML(agent(owner), { size: 18, mood: 'still' })}<span class="tk-to-name">${nameHTML(agent(owner))}</span></span>` : '')
  }

  /* global EASE, DUR */ // the app's motion lengths and curves (common.js)
  // The cards below the composer make room for it (or close the gap it leaves) by sliding, not jumping.
  const slideList = (list, dy) => dy && list?.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: DUR.move, easing: EASE.move })
  function openComposer(lane = 'new', from = $('[data-new-task]')) {
    closeFilters()
    const slot = mode === 'board' ? root.querySelector(`.tk-board [data-lane=${lane}] .lane-compose`) : addPop
    if (!slot) return
    if (composer.parentElement !== slot) {
      if (composeAt) closeComposer()
      const was = slot.offsetHeight
      slot.append(composer)
      if (slot !== addPop) slideList(slot.nextElementSibling, was - slot.offsetHeight)
      composer.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: DUR.move, easing: EASE.out })
      document.addEventListener('pointerdown', composeOutside, true)
    }
    if (slot === addPop) placeAddPop(from) // (again, if another + in the list opened it)
    composeAt = lane
    composeFrom = from
    syncAdd()
    add.focus({ preventScroll: true })
    add.setSelectionRange(add.value.length, add.value.length)
  }
  function closeComposer() {
    if (!composeAt) return
    const slot = composer.parentElement
    const was = slot.offsetHeight
    $('.tk-add-home').append(composer)
    addPop.classList.add('hidden')
    if (slot !== addPop) slideList(slot.nextElementSibling, was - slot.offsetHeight)
    composeAt = null
    composeFrom = null
    document.removeEventListener('pointerdown', composeOutside, true)
  }
  // New task or a +, clicked again: closes an empty composer, or goes back to the one you're writing.
  function toggleComposer(lane, from) {
    if (composeAt === lane && (mode === 'board' || composeFrom === from)) return drafted() ? add.focus() : closeComposer()
    openComposer(lane, from)
  }
  // The list's popover: under the button, its right edge on the button's (above it if there's no room below).
  function placeAddPop(from) {
    addPop.classList.remove('hidden')
    const box = $('.tasks').getBoundingClientRect()
    const r = from.getBoundingClientRect()
    const w = addPop.offsetWidth
    const h = addPop.offsetHeight
    const below = r.bottom - box.top + 6
    addPop.style.left = `${Math.max(16, Math.min(r.right - box.left - w, box.width - w - 16))}px`
    addPop.style.top = `${below + h > box.height - 8 ? Math.max(8, r.top - box.top - h - 6) : below}px`
  }
  // A click somewhere else closes it, unless something's written in it (Escape always does).
  const composeOutside = (e) => {
    if (composer.contains(e.target) || e.target.closest?.('.tk-pop, .mentions, [data-new-task], [data-add-to]')) return
    if (!drafted()) closeComposer()
  }

  async function submit() {
    if (!state) return
    const { owner, text } = ownerIn(add.value, state.agents)
    const images = attach.get()
    if (!text && !images.length) return
    const start = composeAt === 'fixing'
    addGo.disabled = true
    try {
      const out = (await crew.call('task', 'file', null, { text, images, kind: addKind, ...(owner && { owner }) })).trim()
      const id = out.match(/#(\d+)/)?.[1] ?? null
      fresh = id
      add.value = ''
      attach.set([], false)
      // with a triage agent on it and no @name, the triage agent assigns it first: starting it too would send it twice
      if (start && id && /is triaging it/.test(out)) toast(`${out.charAt(0).toUpperCase() + out.slice(1)}. It starts once it has an owner`)
      else if (start && id) {
        // In progress's +: it goes to its owner (the @name, or whoever's area it is) now, in a new conversation
        const went = await crew.call('task', 'dispatch', id).then(() => true, (e) => (toast(errorLine(e), true), false))
        if (went) toast(`#${id} went to ${owner ? `@${owner}` : 'its owner'}, in a new conversation`)
      } else toast(out.charAt(0).toUpperCase() + out.slice(1))
    } catch (e) {
      toast(errorLine(e), true)
    }
    syncAdd()
  }
  add.addEventListener('input', syncAdd)
  // the @ list lines up with the composer, but never narrower than a readable row (a column can be slim)
  const mentionBox = {
    getBoundingClientRect: () => {
      const r = composer.getBoundingClientRect()
      const width = Math.max(r.width, 300)
      return { left: Math.max(8, Math.min(r.left, innerWidth - width - 8)), width, top: r.top, bottom: r.bottom }
    },
  }
  mountMentions(add, { agents: () => state?.agents ?? [], box: mentionBox, place: 'below', heading: () => (composeAt === 'fixing' ? 'Who does it' : 'Assign to') })
  ink = mountInk(add, { agents: () => state?.agents ?? [], strict: () => false })
  add.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation() // the panel or a selection behind it stays
      closeComposer()
    }
  })
  addGo.addEventListener('click', submit)
  $('[data-kind-pick]').addEventListener('click', (e) => menu(e.currentTarget, kindItems(addKind), (v) => ((addKind = v), syncAdd(), add.focus())))
  $('[data-new-task]').addEventListener('click', (e) => toggleComposer('new', e.currentTarget))

  // ---- header: search, filters, board or list, the ⋯ menu ------------------------------------------

  // Search: a magnifier that opens a field to its left, so nothing beside it moves; it closes when you leave it empty.
  const search = $('[data-search]')
  const searchBox = $('.tk-search')
  const searchBtn = $('[data-search-btn]')
  function drawSearch() {
    const open = searchBox.classList.contains('open')
    morph(searchBtn, filter.q ? ICONS.close : ICONS.search)
    searchBtn.title = filter.q ? 'Clear the search' : open ? 'Close the search' : 'Search tasks'
  }
  function openSearch() {
    closeFilters()
    searchBox.classList.add('open')
    search.focus()
    drawSearch()
  }
  function closeSearch() {
    if (search.value) {
      search.value = ''
      filter.q = ''
      draw()
    }
    searchBox.classList.remove('open')
    drawSearch()
  }
  searchBtn.addEventListener('mousedown', (e) => e.preventDefault()) // the field keeps the focus, so a click toggles it
  searchBtn.addEventListener('click', () => (searchBox.classList.contains('open') ? closeSearch() : openSearch()))
  search.addEventListener('input', () => {
    filter.q = search.value.trim().toLowerCase()
    drawSearch()
    draw()
  })
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), closeSearch(), search.blur())
    if (e.key === 'Enter') search.blur()
  })
  search.addEventListener('blur', () => !search.value && (searchBox.classList.remove('open'), drawSearch()))

  // Filters: kind and owner, in the Filter button's popover. While some are on, one chip beside the button says
  // which ("Bugs · Iris") and its × clears them.
  const fpop = $('[data-filter-pop]')
  const fbtn = $('[data-filter-btn]')
  const filtersOpen = () => !fpop.classList.contains('hidden')
  function openFilters() {
    closePop()
    fpop.classList.remove('hidden')
    fbtn.classList.add('on')
    fbtn.setAttribute('aria-expanded', 'true')
    const box = $('.tasks').getBoundingClientRect()
    const r = fbtn.getBoundingClientRect()
    fpop.style.left = `${Math.max(16, Math.min(r.left - box.left, box.width - fpop.offsetWidth - 16))}px`
    fpop.style.top = `${r.bottom - box.top + 6}px`
    document.addEventListener('pointerdown', filtersOutside, true)
    fpop.querySelector('.tk-fp-item.on, .tk-fp-item')?.focus({ preventScroll: true })
  }
  function closeFilters() {
    if (!filtersOpen()) return
    fpop.classList.add('hidden')
    fbtn.classList.remove('on')
    fbtn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', filtersOutside, true)
  }
  const filtersOutside = (e) => !fpop.contains(e.target) && !e.target.closest('[data-filter-btn], [data-filter-open]') && closeFilters()
  // all: the search too (the empty board's "Clear filters"); the chip's × leaves the search be
  function clearFilters(all) {
    Object.assign(filter, { kind: '', owner: '' })
    if (all) {
      filter.q = ''
      search.value = ''
      if (document.activeElement !== search) searchBox.classList.remove('open')
      drawSearch()
    }
    draw()
  }
  const onFilter = (e) => {
    if (e.target.closest('[data-filter-open]')) return filtersOpen() ? closeFilters() : openFilters()
    const f = e.target.closest('[data-filter]')
    if (!f) return
    const spec = f.dataset.filter
    const [k, v] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)] // owner::none is "owner", ":none"
    if (k === 'clear') return clearFilters(false)
    filter[k] = filter[k] === v ? '' : v
    draw()
  }
  fbtn.addEventListener('click', () => (filtersOpen() ? closeFilters() : openFilters()))
  fpop.addEventListener('click', onFilter)
  $('.tk-active').addEventListener('click', onFilter)
  fpop.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (!step) return
    e.preventDefault()
    const list = [...fpop.querySelectorAll('button:not(:disabled)')]
    list[(list.indexOf(document.activeElement) + step + list.length) % list.length]?.focus()
  })

  $('.tk-views').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]')?.dataset.mode
    if (!m || m === mode) return
    // the composer follows you across (a column on the board, a popover in the list) if you'd written something
    const lane = composeAt
    const keep = lane && drafted()
    closeComposer()
    mode = m
    store.set('crew.tasks.view', m)
    first = true // no slide-in animation across the switch
    draw()
    if (keep) openComposer(lane)
  })
  $('[data-board-menu]').addEventListener('click', (e) => (pop ? closePop() : boardMenu(e.currentTarget)))
  // the popovers hang from their buttons: a resized window closes the filters and moves the list's composer along
  // ...and so does a redraw (rows come and go above it) or scrolling the list
  const followPop = () => {
    if (!root.offsetParent || !composeAt || composer.parentElement !== addPop) return
    if (!composeFrom?.isConnected) composeFrom = root.querySelector(`[data-add-to="${CSS.escape(composeAt)}"]`) ?? $('[data-new-task]')
    placeAddPop(composeFrom)
  }
  addEventListener('resize', () => {
    closeFilters()
    followPop()
  })
  $('.tk-list').addEventListener('scroll', followPop, { passive: true })

  const matches = (t) =>
    (!filter.kind || t.kind === filter.kind) &&
    (!filter.owner || (filter.owner === ':none' ? !t.owner : (t.fixer ?? t.owner) === filter.owner || t.owner === filter.owner)) &&
    (!filter.q || `#${t.id} ${t.title} ${t.body} ${t.owner ?? ''}`.toLowerCase().includes(filter.q))

  function drawFilters() {
    const open = tickets.filter((t) => t.status !== 'done')
    const count = (pred) => open.filter(pred).length
    const item = (k, v, label, n, iconHTML) => `<button class="tk-fp-item ${filter[k] === v ? 'on' : ''}" data-filter="${k}:${esc(v)}" role="menuitemcheckbox" aria-checked="${filter[k] === v}">${iconHTML}<span class="tk-fp-label">${label}</span><i class="tk-fp-n">${n || ''}</i><i class="tk-fp-check">${ICONS.check}</i></button>`
    // owners in name order, so a push never shuffles the list under your pointer (and the one filtered stays)
    const owners = [...new Set([...open.map((t) => t.fixer ?? t.owner), filter.owner !== ':none' && filter.owner].filter(Boolean))].sort()
    const unassigned = count((t) => !t.owner)
    const any = filter.kind || filter.owner
    morph(fpop,
      `<div class="tk-fp-sec"><h6>Kind</h6>${KINDS.map((k) => item('kind', k.id, k.plural, count((t) => t.kind === k.id), KIND_ICON[k.id])).join('')}</div>` +
      (owners.length || unassigned || filter.owner ? `<div class="tk-fp-sec tk-fp-owners"><h6>Owner</h6>${owners.map((n) => item('owner', n, nameHTML(agent(n)), count((t) => (t.fixer ?? t.owner) === n), avatarHTML(agent(n), { size: 20, mood: 'still' }))).join('')}${unassigned || filter.owner === ':none' ? item('owner', ':none', 'Unassigned', unassigned, '<i class="tk-nobody">?</i>') : ''}</div>` : '') +
      `<div class="tk-fp-foot"><button class="tk-fp-clear" data-filter="clear:pick" ${any ? '' : 'disabled'}>Clear filters</button></div>`)
    const words = [filter.kind && KINDS.find((k) => k.id === filter.kind)?.plural, filter.owner && (filter.owner === ':none' ? 'Unassigned' : esc(filter.owner))].filter(Boolean)
    morph($('.tk-active'), words.length ? `<span class="tk-on-chip"><button class="tk-on-what" data-filter-open title="Change the filters">${words.join(' · ')}</button><button class="tk-on-x" data-filter="clear:pick" title="Clear filters">${ICONS.close}</button></span>` : '')
  }

  // ---- what each task looks like -------------------------------------------------------------------

  // What its agent is up to with it: on it, starting fresh, finishing something else first, waiting on you.
  function live(t) {
    const a = worker(t)
    if (!a || !a.on) return { cls: 'off', text: a?.status === 'away' ? 'unreachable' : 'off' }
    if (t.stalled && a.status !== 'working') return { cls: 'waiting', text: 'stalled, have a look' } // Crew called you about it
    if (String(a.ticket) === t.key) {
      if (a.status === 'working') return { cls: 'working', text: a.activity || `on it · ${ago(a.since)}`, since: ago(a.since), shimmer: Boolean(a.activity) }
      if (a.status === 'waiting') return { cls: 'waiting', text: 'needs you' }
      if (a.status === 'starting') return { cls: 'starting', text: 'starting fresh…' }
      return { cls: 'idle', text: "idle, hasn't reported yet" }
    }
    if (a.status === 'starting' || a.freshPending) return { cls: 'starting', text: 'starting fresh…' }
    return { cls: 'queued', text: a.status === 'working' ? 'up next' : 'queued' }
  }
  // The same, in a word or two for a card or a row: a dot and how long while it works (the sentence is its tooltip,
  // and the panel's). Only "needs you" is in colour besides working's green.
  function stateHTML(t) {
    const s = live(t)
    const word = { working: s.since, starting: 'starting…', waiting: s.text === 'needs you' ? 'needs you' : 'stalled', idle: 'idle' }[s.cls] ?? s.text
    const tip = s.cls === 'working' && s.shimmer ? `${s.text} · ${s.since}` : s.text
    return `<span class="tk-state ${s.cls}" title="${esc(tip)}">${s.cls === 'starting' ? '' : `<i class="dot ${s.cls === 'queued' ? 'idle' : s.cls}"></i>`}${esc(word)}</span>`
  }

  const face = (n, { size = 20, live: moving = false } = {}) => {
    const a = agent(n)
    return `<span class="tk-face" data-agent="${esc(n)}" title="@${esc(n)}">${avatarHTML(a, { size, mood: moving ? undefined : 'still' })}</span>`
  }
  const ownerHTML = (t, size = 20) => {
    const n = (t.status === 'fixing' && worker(t)?.name) || t.fixer || t.owner // a clone on it shows as itself: Theo ②
    if (!n) return `<button class="tk-assign" data-menu="owner" title="Who does it?"><i class="tk-nobody">?</i><span>Assign</span></button>`
    return `<span class="tk-owner">${face(n, { size, live: t.status === 'fixing' })}<span class="tk-owner-name">${nameHTML(agent(n))}</span></span>`
  }
  // A task whose owner is switched off waits for it: no Start until it's back on.
  const ownerOff = (t) => Boolean(t.owner) && !agent(t.owner).on
  const offHTML = (t) => `<span class="tk-state" title="@${esc(t.owner)} is turned off: turn it on, or give this task to someone else"><i class="dot off"></i>off</span>`
  const startHTML = (t) => `<button class="tk-btn go tk-start" data-act="start" title="Hand it to @${esc(t.owner)} in a new conversation">Start</button>`
  const urgentHTML = '<span class="tk-urgent">Urgent</span>'
  const isUrgent = (t) => t.severity === 'blocker' && t.status !== 'done'

  // The bottom of a card: who, and on the right what's happening with it (or Start, when you point at it).
  function footHTML(t) {
    if (t.status === 'new') {
      const triage = state.tasks.triage
      if (!t.owner && triage && !t.triaged && t.by === 'you') return `<span class="tk-owner">${face(triage, { size: 22 })}<span class="tk-note">${esc(triage)} is triaging…</span></span>`
      if (!t.owner) return ownerHTML(t, 22)
      return `${ownerHTML(t, 22)}<span class="grow"></span>${ownerOff(t) ? offHTML(t) : startHTML(t)}`
    }
    if (t.status === 'fixing') return `${ownerHTML(t, 22)}<span class="grow"></span>${stateHTML(t)}`
    return `${ownerHTML(t, 22)}<span class="grow"></span><span class="tk-age">${esc(ago(t.updated))}</span>`
  }

  // A card: kind and number, Urgent when it is, the title, and its owner. A task to review has what came back and
  // the board's only coloured buttons instead. Cost, tokens and priority live in the panel.
  function cardHTML(t) {
    const pics = t.images.length
      ? `<div class="tk-shots">${t.images.slice(0, 3).map((p) => `<img src="${fileURL(p)}" alt="" draggable="false">`).join('')}${t.images.length > 3 ? `<span>+${t.images.length - 3}</span>` : ''}</div>`
      : ''
    const review = t.status === 'check'
    const summary = review && t.fix ? `<p class="tk-summary">${esc(snippet(t.fix))}</p>` : ''
    const verdict = `<div class="tk-verdict"><button class="tk-btn" data-act="sendBack" title="Tell @${esc(t.fixer ?? 'them')} what's ${t.kind === 'bug' ? 'still broken' : 'missing'}">Send back</button><button class="tk-btn good" data-act="accept" title="It's done">Accept</button></div>`
    return `<article class="tc st-${t.status} kind-${t.kind}${isUrgent(t) ? ' urgent' : ''}${selected === t.key ? ' sel' : ''}${picked.has(t.key) ? ' picked' : ''}" data-name="${esc(t.key)}" draggable="true">
      <i class="tc-check" data-pick title="${picked.has(t.key) ? 'Let go' : 'Pick'} (${keys('⌘-click')})">${ICONS.check}</i>
      <div class="tc-top">${KIND_ICON[t.kind]}<span class="tk-id">#${t.id}</span>${t.home ? `<span class="tk-home" title="On ${esc(t.homeName)}">${esc(t.homeName)}</span>` : ''}${t.dupOf ? `<span class="tk-home">same as #${t.dupOf}</span>` : ''}${isUrgent(t) ? urgentHTML : ''}</div>
      <div class="tc-title">${esc(t.title)}</div>
      ${pics}${summary}
      ${review ? verdict : `<div class="tc-foot">${footHTML(t)}</div>`}
    </article>`
  }

  // One row of the list: the same facts as a card, in columns.
  function rowHTML(t) {
    const right =
      t.status === 'new' && ownerOff(t) ? offHTML(t)
      : t.status === 'new' && t.owner ? startHTML(t)
      : t.status === 'fixing' ? stateHTML(t)
      : t.status === 'check' ? `<button class="tk-btn only" data-act="sendBack" title="Send back">${BACK}</button><button class="tk-btn good" data-act="accept">Accept</button>`
      : ''
    // while some are picked, each row leads with its check instead of its kind
    const lead = picked.size ? `<i class="tr-check" data-pick title="${picked.has(t.key) ? 'Let go' : 'Pick'}">${ICONS.check}</i>` : KIND_ICON[t.kind]
    return `<div class="tr st-${t.status}${selected === t.key ? ' sel' : ''}${picked.has(t.key) ? ' picked' : ''}" data-name="${esc(t.key)}" draggable="true">
      ${lead}
      <span class="tk-id">#${t.id}</span>
      <span class="tr-title"><span class="tr-name" title="${esc(t.title)}">${esc(t.title)}</span>${isUrgent(t) ? urgentHTML : ''}${t.home ? `<span class="tk-home">${esc(t.homeName)}</span>` : ''}${t.images.length ? `<span class="tr-pics" title="${t.images.length} screenshot${t.images.length > 1 ? 's' : ''}">${PICTURE}${t.images.length}</span>` : ''}</span>
      <span class="tr-right">${right}</span>
      ${ownerHTML(t)}
      <span class="tk-age" title="${esc(new Date(t.updated).toLocaleString())}">${esc(ago(t.updated))}</span>
    </div>`
  }

  // To do: most urgent first, then most reported, then newest (what you just added is in sight). In progress:
  // most urgent first. Review and Done: latest first.
  const order = {
    new: (x, y) => PRIORITY_RANK[x.severity] - PRIORITY_RANK[y.severity] || y.seen - x.seen || y.created - x.created,
    fixing: (x, y) => PRIORITY_RANK[x.severity] - PRIORITY_RANK[y.severity] || x.updated - y.updated,
    check: (x, y) => y.updated - x.updated,
    done: (x, y) => y.updated - x.updated,
  }
  const grouped = () => Object.fromEntries(STATUS.map((s) => [s.id, tickets.filter((t) => t.status === s.id && matches(t)).sort(order[s.id])]))

  // The tasks a lane shows (Done stops at DONE_SHOWN until you ask for more).
  const shownIn = (status, list) => (status === 'done' && !showAllDone ? list.slice(0, DONE_SHOWN) : list)

  // A lane's select-all (when you point at the lane), and Done's fold.
  function laneAct(status, list) {
    // select all it shows, or let them all go again (a folded Done lane is just its title)
    const shown = shownIn(status, list)
    const all = shown.length && shown.every((t) => picked.has(t.key))
    const pickAll = shown.length && (status !== 'done' || doneOpen) ? `<button class="icon lane-pick ${all ? 'on' : ''}" data-act="pick-lane" title="${all ? 'Let these go' : `Select all ${shown.length}`}">${PICK_ALL}</button>` : ''
    if (status === 'done') return `${pickAll}<button class="icon tk-fold" data-act="fold-done" title="${doneOpen ? 'Fold Done away' : 'Show Done'}">${CHEVRON}</button>`
    return pickAll
  }
  const laneAdd = (status) => (TK_ADD_TO[status] ? `<button class="icon lane-add" data-add-to="${status}" title="${TK_ADD_TO[status]}">${ICONS.plus}</button>` : '')

  function drawBoard(by) {
    const board = $('.tk-board')
    if (!board.children.length) {
      // the composer opens in .lane-compose, which no redraw touches
      board.innerHTML = STATUS.map((s) => `
        <section class="lane" data-lane="${s.id}">
          <header class="lane-head">${STATUS_ICON[s.id]}<b>${s.label}</b><span class="lane-count"></span><span class="grow"></span><span class="lane-act"></span>${laneAdd(s.id)}</header>
          <div class="lane-compose"></div>
          <div class="lane-list"></div>
        </section>`).join('')
      for (const lane of board.querySelectorAll('.lane')) dropZone(lane, lane.dataset.lane)
    }
    board.classList.toggle('done-folded', !doneOpen)
    for (const s of STATUS) {
      const lane = board.querySelector(`[data-lane=${s.id}]`)
      let list = by[s.id]
      const hidden = s.id === 'done' && !showAllDone ? Math.max(0, list.length - DONE_SHOWN) : 0
      if (hidden) list = list.slice(0, DONE_SHOWN)
      lane.querySelector('.lane-count').textContent = by[s.id].length || ''
      morph(lane.querySelector('.lane-act'), laneAct(s.id, by[s.id]))
      morph(lane.querySelector('.lane-list'), [...list.map(cardHTML), hidden ? `<button class="lane-more" data-act="more">Show ${hidden} more</button>` : ''])
    }
  }

  function drawList(by) {
    morph($('.tk-list'), STATUS.map((s) => {
      const list = by[s.id]
      const folded = s.id === 'done' && !doneOpen
      return `<section class="tl-group" data-lane="${s.id}">
        <header class="tl-head">${STATUS_ICON[s.id]}<b>${s.label}</b><span class="lane-count">${list.length || ''}</span><span class="grow"></span>${laneAct(s.id, list)}${laneAdd(s.id)}</header>
        ${folded ? '' : list.slice(0, s.id === 'done' && !showAllDone ? DONE_SHOWN : undefined).map(rowHTML).join('') || '<p class="tl-none">Nothing here</p>'}
      </section>`
    }).join(''))
    for (const g of $('.tk-list').querySelectorAll('.tl-group:not([data-dz])')) (g.dataset.dz = '1'), dropZone(g, g.dataset.lane)
  }

  function draw() {
    const by = grouped()
    // Cards slide to their new place (FLIP): remember where each was before the board changes.
    const before = new Map([...root.querySelectorAll('.tc, .tr')].map((el) => [el.dataset.name, el.getBoundingClientRect()]))
    root.classList.toggle('mode-list', mode === 'list')
    segmented($('.tk-views'), (b) => b.dataset.mode === mode)
    for (const key of picked) if (!ticket(key)) picked.delete(key) // deleted, or gone from the board
    root.classList.toggle('picking', picked.size > 0)
    drawFilters()
    drawBulk()
    const shown = Object.values(by).flat().length
    const none = !tickets.length
    // nothing yet: the board's columns stay (so nothing jumps when the first task lands), and the crew waits with mugs
    const crewNow = state.agents.filter((a) => !a.cloneOf)
    morph($('.tk-empty'), none ? `<div class="tk-hello">${crewNow.length ? mugsRoomHTML(crewNow.filter((a) => a.on).concat(crewNow.filter((a) => !a.on))) : ''}<h1 class="display">${crewNow.length ? 'We’re all here. What should we work on?' : 'Nothing to work on yet'}</h1><p>Add a task, or just ask in the chat: whoever’s free picks it up.</p><div><button class="btn primary lg" data-add-to="new">${ICONS.plus}New task</button></div></div>`
      : !shown ? '<div class="tk-hello small"><b>No tasks match</b><button class="btn" data-filter="clear:1">Clear filters</button></div>' : '')
    $('.tk-body').classList.toggle('empty', none || !shown)
    if (mode === 'board') drawBoard(by)
    else drawList(by)
    for (const el of root.querySelectorAll('.tc, .tr')) {
      const was = before.get(el.dataset.name)
      if (!was) {
        if (!first && (fresh === null || el.dataset.name === fresh)) el.animate([{ opacity: 0, transform: 'translateY(-8px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: DUR.move, easing: EASE.out })
        continue
      }
      const now = el.getBoundingClientRect()
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: DUR.move, easing: EASE.move })
    }
    const added = fresh && root.querySelector(`[data-name="${CSS.escape(fresh)}"]`)
    if (added) {
      added.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      fresh = null
    }
    followPop()
    first = false
  }

  function drawHead() {
    const open = tickets.filter((t) => t.status !== 'done').length
    const review = tickets.filter((t) => t.status === 'check').length
    const urgent = tickets.filter((t) => t.status !== 'done' && t.severity === 'blocker').length
    morph($('.tk-sub'), [open ? `${open} open` : 'Nothing open', urgent && `<span class="sub-urgent">${urgent} urgent</span>`, review && `<span class="sub-review">${review} to review</span>`].filter(Boolean).join(' · '))
  }

  // ---- picking several tasks, and the bar that acts on them all at once ----------------------------

  // The tasks on screen right now, in the order they're shown (lane by lane on the board).
  const onScreen = () => [...root.querySelectorAll(mode === 'board' ? '.tk-board .tc' : '.tk-list .tr')].map((el) => el.dataset.name)

  // ⌘-click picks a task or lets it go; Shift-click picks every task from the last one picked to this one.
  function pickTask(key, range = false) {
    const keys = onScreen()
    const [i, j] = [keys.indexOf(anchor), keys.indexOf(key)]
    if (range && i >= 0 && j >= 0) for (const k of keys.slice(Math.min(i, j), Math.max(i, j) + 1)) picked.add(k)
    else picked.has(key) ? picked.delete(key) : picked.add(key)
    anchor = key
    draw()
  }
  // A lane's select-all: picks what it shows, or lets them all go if they're all picked already.
  function pickAll(keys, toggle = true) {
    const all = toggle && keys.length && keys.every((k) => picked.has(k))
    for (const k of keys) all ? picked.delete(k) : picked.add(k)
    draw()
  }
  function unpick() {
    picked.clear()
    anchor = null
    closePop()
    draw()
  }

  // One call for all of them (see Hub.bulk), and one line in the chat. What's left picked after it: the ones you
  // may want to change some more (a new owner, a priority); the rest have moved on.
  async function bulk(op, keys, arg, { keep = false } = {}) {
    const out = (await call('bulk', null, { op, keys, arg }).catch(() => null))?.trim()
    if (out) toast(out.charAt(0).toUpperCase() + out.slice(1).replace(/\n/g, ' · '))
    if (!keep) unpick()
  }

  function drawBulk() {
    const list = [...picked].map(ticket).filter(Boolean)
    if (!list.length) return morph($('.tk-bulk'), '')
    const open = list.filter((t) => t.status !== 'done')
    const ready = list.filter((t) => t.status === 'new' && t.owner && !ownerOff(t))
    const moves = STATUS.filter((s) => s.id !== 'fixing' && list.some((t) => t.status !== s.id && (s.id !== 'check' || t.status !== 'done')))
    morph($('.tk-bulk'), `<span class="tk-bulk-count"><b>${list.length}</b> selected</span>` +
      (ready.length ? `<button class="tk-btn go" data-bulk="start" title="Hand each to its owner, in a new conversation">${ICONS.fresh}Start ${ready.length}</button>` : '') +
      (open.length ? `<button class="tk-btn" data-bulk="owner">Assign${CHEVRON}</button><button class="tk-btn" data-bulk="priority">Priority${CHEVRON}</button>` : '') +
      (moves.length ? `<button class="tk-btn" data-bulk="move">Move to${CHEVRON}</button>` : '') +
      (open.length ? `<button class="tk-btn" data-bulk="close" title="Move ${open.length > 1 ? 'them' : 'it'} to Done">${ICONS.check}Close ${open.length}</button>` : '') +
      `<button class="tk-btn danger" data-bulk="remove">Delete</button>` +
      `<button class="icon tk-bulk-x" data-bulk="unpick" title="Let them go (Esc)">${ICONS.close}</button>`)
  }

  $('.tk-bulk').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bulk]')
    if (!b) return
    const list = [...picked].map(ticket).filter(Boolean)
    const open = list.filter((t) => t.status !== 'done')
    const keys = (ts) => ts.map((t) => t.key)
    // what they all share, if they do (a menu marks it); undefined when they differ
    const same = (f) => (new Set(open.map(f)).size === 1 ? f(open[0]) : undefined)
    const op = b.dataset.bulk
    if (op === 'unpick') return unpick()
    if (op === 'start') return bulk('start', keys(list.filter((t) => t.status === 'new' && t.owner && !ownerOff(t))))
    if (op === 'close') return bulk('close', keys(open))
    if (op === 'remove') return confirm(`Delete ${list.length > 1 ? `these ${list.length} tasks` : `#${list[0].id}`}? ${list.length > 1 ? "They're" : "It's"} gone for good.`) && bulk('remove', keys(list))
    if (op === 'owner') return menu(b, ownerItems(same((t) => t.owner ?? '') ?? ':mixed'), (v) => bulk('owner', keys(open), v, { keep: true }))
    if (op === 'priority') return menu(b, priorityItems({ severity: same((t) => t.severity) }), (v) => bulk('priority', keys(open), v, { keep: true }))
    if (op === 'move') {
      const items = STATUS.filter((s) => s.id !== 'fixing' && list.some((t) => t.status !== s.id && (s.id !== 'check' || t.status !== 'done')))
      return menu(b, items.map((s) => ({ value: s.id, label: s.label, icon: STATUS_ICON[s.id] })), (v) => bulk('move', keys(list), v))
    }
  })

  // The header's ⋯: the workflow (triage, auto-start), starting every task that's ready, picking everything shown,
  // or clearing the board in one go (work you finished somewhere else).
  function boardMenu(anchor) {
    const filtered = Boolean(filter.kind || filter.owner || filter.q)
    const open = tickets.filter((t) => t.status !== 'done' && (!filtered || matches(t)))
    const ready = tickets.filter((t) => t.status === 'new' && t.owner && !ownerOff(t) && matches(t))
    const done = tickets.filter((t) => t.status === 'done')
    const shown = onScreen()
    const flow = `Triage ${state.tasks.triage ? `@${state.tasks.triage}` : 'off'} · Auto-start ${state.tasks.autofix ? 'on' : 'off'}`
    menu(anchor, [
      { value: 'flow', label: 'Workflow…', hint: flow, icon: GEAR, attr: 'data-flow' },
      ...(ready.length > 1 ? [{ value: 'start', label: `Start the ${ready.length} ready`, hint: 'each in a new conversation', icon: `<span class="tk-pop-ico">${ICONS.fresh}</span>` }] : []),
      ...(shown.length ? [{ value: 'pick', label: 'Select all shown', hint: keys('⌘A'), icon: PICK_ALL }] : []),
      ...(open.length ? [{ value: 'close', label: filtered ? `Close the ${open.length} open shown` : `Close all ${open.length} open`, hint: 'to Done', icon: STATUS_ICON.done }] : []),
      ...(done.length ? [{ value: 'clear', label: 'Clear Done', hint: 'deletes them', icon: `<span class="danger-ico">${ICONS.close}</span>` }] : []),
    ], (v) => {
      if (v === 'flow') workflow(anchor)
      if (v === 'start') bulk('start', ready.map((t) => t.key), null, { keep: true })
      if (v === 'pick') pickAll(shown, false)
      if (v === 'close' && confirm(`Close ${open.length > 1 ? `all ${open.length} open tasks${filtered ? ' shown' : ''}` : `#${open[0].id}`}? ${open.length > 1 ? 'They move' : 'It moves'} to Done.`)) bulk('close', open.map((t) => t.key))
      // every task in Done goes, on every computer with some there (older ones beyond what the board shows too)
      if (v === 'clear' && confirm("Delete every task in Done? They're gone for good.")) bulk('clear', done.map((t) => t.key))
    })
  }

  // ---- dragging between lanes (or list groups) -----------------------------------------------------

  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.tc, .tr')
    if (!card) return
    e.dataTransfer.setData('text/crew-task', card.dataset.name)
    e.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => card.classList.add('dragging'))
    root.classList.add('dragging-task')
  })
  root.addEventListener('dragend', (e) => {
    e.target.closest?.('.tc, .tr')?.classList.remove('dragging')
    root.classList.remove('dragging-task')
    root.querySelectorAll('.over').forEach((l) => l.classList.remove('over'))
  })
  function dropZone(el, status) {
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/crew-task')) return
      e.preventDefault()
      el.classList.add('over')
    })
    el.addEventListener('dragleave', (e) => el.contains(e.relatedTarget) || el.classList.remove('over'))
    el.addEventListener('drop', (e) => {
      const key = e.dataTransfer.getData('text/crew-task')
      el.classList.remove('over')
      if (!key) return
      e.preventDefault()
      // one of several picked: they all go (to In progress, the ones that can start)
      if (picked.has(key) && picked.size > 1) return void bulk(status === 'fixing' ? 'start' : 'move', [...picked], status)
      const t = ticket(key)
      if (t) move(t, status)
    })
  }

  // ---- clicks on cards and rows ----------------------------------------------------------------------

  $('.tk-body').addEventListener('click', async (e) => {
    if (composer.contains(e.target)) return // the composer, open in a column, has its own
    const f = e.target.closest('[data-filter]')
    if (f) return clearFilters(true)
    const plus = e.target.closest('[data-add-to]')
    if (plus) return toggleComposer(plus.dataset.addTo, plus)
    const item = e.target.closest('.tc, .tr')
    const t = item && ticket(item.dataset.name)
    // ⌘/Ctrl-click or Shift-click picks it (its check does too, while some are picked); a plain click opens it
    if (t && (e.metaKey || e.ctrlKey || e.shiftKey || e.target.closest('[data-pick]'))) return pickTask(t.key, e.shiftKey)
    const m = e.target.closest('[data-menu]')
    if (m && t) return pick(t, m.dataset.menu, m)
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'more') return void ((showAllDone = true), draw())
    if (act === 'fold-done') return void ((doneOpen = !doneOpen), store.set('crew.tasks.done', doneOpen ? '1' : '0'), draw())
    if (act === 'pick-lane') {
      const lane = e.target.closest('[data-lane]').dataset.lane
      return pickAll(shownIn(lane, grouped()[lane]).map((x) => x.key))
    }
    if (act && t) {
      if (act === 'start') {
        bounce(item.querySelector('.av'), 'pop')
        return call('dispatch', t.key).then(() => toast(`#${t.id} went to @${t.owner}, in a new conversation`), () => {})
      }
      if (act === 'accept') {
        burst(e.target.closest('[data-act]'))
        return call('accept', t.key).catch(() => {})
      }
      if (act === 'sendBack') return open(t.key, { sendBack: true })
    }
    if (e.target.closest('.tk-face') && t?.status === 'fixing') return onTerminal(worker(t)?.name ?? t.fixer)
    // a folded Done lane opens when you click it
    if (e.target.closest('.done-folded [data-lane=done]')) return void ((doneOpen = true), store.set('crew.tasks.done', '1'), draw())
    if (t) open(t.key)
  })

  // A little cheer when you accept one.
  function burst(el) {
    const r = el.getBoundingClientRect()
    const b = document.createElement('div')
    b.className = 'burst'
    b.style.left = `${r.left + r.width / 2}px`
    b.style.top = `${r.top + r.height / 2}px`
    const colors = ['#34c759', '#0a84ff', '#ffcc00', '#ff6fb5', '#5ac8fa', '#5e5ce6']
    b.innerHTML = Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2
      const d = 26 + Math.random() * 24
      return `<i style="--b:${colors[i % colors.length]};--x:${Math.cos(angle) * d}px;--y:${Math.sin(angle) * d}px;--r:${Math.random() * 360}deg"></i>`
    }).join('')
    document.body.append(b)
    setTimeout(() => b.remove(), 900)
  }

  // ---- one task, open ----------------------------------------------------------------------------------

  function open(key, { sendBack = false } = {}) {
    selected = key
    sendingBack = sendBack
    editingBody = false
    drawPanel()
    draw()
    if (sendBack) setTimeout(() => tp.querySelector('[data-sendback-note]')?.focus({ preventScroll: true }), 320)
  }

  function close() {
    selected = null
    panelFor = null
    sendingBack = false
    tp.classList.remove('open')
    root.classList.remove('panel-open')
    closePop()
    draw()
  }

  const prop = (name, value, menuName) =>
    `<div class="tp-prop"><span class="tp-key">${name}</span>${menuName ? `<button class="tp-val" data-menu="${menuName}">${value}${CHEVRON}</button>` : `<span class="tp-val plain">${value}</span>`}</div>`

  function propsHTML(t) {
    const owner = t.owner ? agent(t.owner) : null
    return prop('Status', `${STATUS_ICON[t.status]}<span>${STATUS_LABEL[t.status]}</span>`, 'status') +
      prop('Priority', `${PRIORITY_ICON[t.severity]}<span>${PRIORITY_LABEL[t.severity]}</span>`, 'priority') +
      prop('Kind', `${KIND_ICON[t.kind]}<span>${KIND_LABEL[t.kind]}</span>`, 'kind') +
      prop('Owner', owner ? `${avatarHTML(owner, { size: 20, mood: 'still' })}<span>${nameHTML(owner)}</span>` : '<i class="tk-nobody">?</i><span class="muted">Nobody</span>', 'owner') +
      prop('Added', `${who(t.by)} · ${esc(ago(t.created))}${ago(t.created) === 'just now' ? '' : ' ago'}${t.seen > 1 ? ` · <b>×${t.seen}</b>` : ''}${t.home ? ` · on ${esc(t.homeName)}` : ''}`) +
      (t.spent?.cost >= 0.005 || t.spent?.tokens ? prop('Spent', `<span title="${esc(SPEND_NOTE)}">${t.spent.cost >= 0.005 ? money(t.spent.cost) : `${tokenCount(t.spent.tokens)} tokens`}${t.spent.added || t.spent.removed ? ` · +${t.spent.added} −${t.spent.removed} lines` : ''}</span>`) : '')
  }

  // While it's being worked on: who, what they're doing right now, how full their conversation is.
  function liveHTML(t) {
    if (t.status !== 'fixing' || !t.fixer) return ''
    const a = worker(t)
    const s = live(t)
    return `<div class="tp-live ${s.cls}" style="--c:${agentColor(a)}">
      <span class="tp-live-av" data-agent="${esc(a.name)}">${avatarHTML(a, { size: 38 })}</span>
      <div class="tp-live-what"><b>${nameHTML(a)}</b><span class="${s.shimmer ? 'shimmer' : ''}">${esc(s.text)}</span></div>
      ${contextRing(a)}
      <button class="btn" data-tp="terminal">Terminal</button>
    </div>`
  }

  function reviewHTML(t) {
    if (!t.fix) return ''
    const a = agent(t.fixer)
    const review = t.status === 'check'
    return `<div class="tp-review ${review ? 'open' : ''}">
      <div class="tp-review-head">${a ? avatarHTML(a, { size: 24, mood: 'still' }) : ''}<b>${who(t.fixer)}</b><span>${t.kind === 'bug' ? 'fixed it' : 'did it'}</span>${review ? '<span class="tp-badge">to review</span>' : ''}</div>
      <div class="tp-review-text bubble">${md(t.fix)}</div>
      ${review ? `<div class="tp-review-acts"><button class="btn" data-tp="sendback" aria-pressed="${sendingBack}">Send back…</button><span class="grow"></span><button class="btn primary good" data-tp="accept">${ICONS.check}Accept</button></div>
        <div class="tp-sendback ${sendingBack ? 'open' : ''}"><textarea rows="2" data-sendback-note placeholder="What's ${t.kind === 'bug' ? 'still broken' : 'missing'}? It goes back to @${esc(t.fixer)}, in the same conversation."></textarea><button class="btn primary" data-tp="send-back">Send back</button></div>` : ''}
    </div>`
  }

  function logHTML(t) {
    return [...t.log].reverse().map((l) => {
      const a = l.by === 'you' || l.by === 'crew' ? null : agent(l.by)
      return `<li class="${l.kind === 'note' ? 'note' : ''}">
        <span class="lg-face">${a ? avatarHTML(a, { size: 22, mood: 'still' }) : `<i class="lg-you">${l.by === 'crew' ? '✦' : 'you'}</i>`}</span>
        <div class="lg-body"><span class="lg-who">${who(l.by)}</span> ${l.kind === 'note' ? 'noted' : esc(l.text)}<time title="${esc(new Date(l.ts).toLocaleString())}">${esc(ago(l.ts))}</time>${l.kind === 'note' ? `<div class="lg-note">${md(l.text)}</div>` : ''}</div>
      </li>`
    }).join('')
  }

  function footHTMLPanel(t) {
    const more = `<button class="icon" data-tp="more" title="More">${icon('<circle cx="3.5" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="12.5" cy="8" r="1.4" fill="currentColor"/>')}</button>`
    const main =
      t.status === 'new' ? `<button class="btn primary" data-tp="start" ${t.owner && !ownerOff(t) ? '' : 'disabled'} title="A new conversation with just this task in it">${ICONS.fresh}${ownerOff(t) ? `Turn @${esc(t.owner)} on to start` : t.owner ? `Start with @${esc(t.owner)}` : 'Pick an owner to start'}</button>`
      : t.status === 'fixing' ? `<button class="btn" data-tp="mark-done" title="Move it to Review yourself">Mark done</button>`
      : t.status === 'done' ? '<button class="btn" data-tp="reopen">Reopen</button>'
      : ''
    return `${more}<span class="grow"></span>${main}`
  }

  function drawPanel() {
    const t = selected && ticket(selected)
    if (!t) {
      if (selected) close()
      return
    }
    root.classList.add('panel-open')
    // Built once per task (the screenshot picker and what you're typing live in it), then patched.
    if (panelFor !== t.key) {
      panelFor = t.key
      tp.innerHTML = `
        <header class="tp-head"></header>
        <div class="tp-body">
          <textarea class="tp-title" rows="1" data-field="title" spellcheck="false"></textarea>
          <div class="tp-props"></div>
          <div class="tp-live-slot"></div>
          <div class="tp-review-slot"></div>
          <section class="tp-sec"><h5>Description <button class="link" data-tp="edit-body">Edit</button></h5>
            <div class="tp-desc" data-tp="edit-body"></div>
            <textarea class="tp-details hidden" data-field="body" rows="5" placeholder="What's wanted, how to tell it's done${t.kind === 'bug' ? ', steps to reproduce' : ''}…"></textarea></section>
          <section class="tp-sec tp-orig-slot"></section>
          <section class="tp-sec"><h5>Attachments <button type="button" class="link" data-shot>+ Add</button></h5><div class="thumbs tp-shots"></div><p class="tp-none" data-no-shots>None. Paste or drop screenshots here.</p></section>
          <section class="tp-sec"><h5>Activity</h5>
            <div class="tp-note"><textarea rows="1" data-note placeholder="Leave a note for whoever does it…"></textarea><button class="btn" data-tp="note">Add</button></div>
            <ol class="tp-log"></ol></section>
        </div>
        <footer class="tp-foot"></footer>`
      shots = mountAttach({
        zone: tp.querySelector('.tp-body'),
        field: tp.querySelector('.tp-details'),
        tray: tp.querySelector('.tp-shots'),
        button: tp.querySelector('[data-shot]'),
        onChange: (images) => call('edit', t.key, { images }).catch(() => {}),
        onError: (msg) => toast(msg, true),
      })
      shots.set(t.images, false)
      tp.dataset.images = JSON.stringify(t.images)
      for (const f of tp.querySelectorAll('[data-field]')) f.value = t[f.dataset.field] ?? ''
      requestAnimationFrame(() => {
        tp.classList.add('open')
        fit(tp.querySelector('.tp-title'))
        tp.querySelector('.tp-body').scrollTop = 0
      })
    }
    morph(tp.querySelector('.tp-head'), `${KIND_ICON[t.kind]}<span class="tk-id">#${t.id}</span><span class="tp-status st-${t.status}">${STATUS_ICON[t.status]}${STATUS_LABEL[t.status]}</span>${t.dupOf ? `<span class="tp-status">same as #${t.dupOf}</span>` : ''}<span class="grow"></span><button class="icon" data-tp="close" title="Close (Esc)">${ICONS.close}</button>`)
    morph(tp.querySelector('.tp-props'), propsHTML(t))
    morph(tp.querySelector('.tp-live-slot'), liveHTML(t))
    const reviewSlot = tp.querySelector('.tp-review-slot')
    const typing = reviewSlot.querySelector('[data-sendback-note]')?.value ?? ''
    morph(reviewSlot, reviewHTML(t))
    const box = reviewSlot.querySelector('[data-sendback-note]')
    if (box && typing) box.value = typing
    morph(tp.querySelector('.tp-desc'), t.body ? md(t.body) : '<p class="tp-none">No description. Click to add one.</p>')
    tp.querySelector('.tp-desc').classList.toggle('hidden', editingBody)
    tp.querySelector('.tp-details').classList.toggle('hidden', !editingBody)
    const reworded = t.report && t.report !== t.body && t.report !== t.title
    morph(tp.querySelector('.tp-orig-slot'), reworded ? `<h5>As you wrote it</h5><blockquote class="tp-orig">${esc(t.report)}</blockquote>` : '')
    tp.querySelector('.tp-orig-slot').classList.toggle('hidden', !reworded)
    tp.querySelector('[data-no-shots]').classList.toggle('hidden', t.images.length > 0)
    morph(tp.querySelector('.tp-log'), logHTML(t))
    morph(tp.querySelector('.tp-foot'), footHTMLPanel(t))
    // Someone else changed it (a triage agent): show it, unless you're typing there.
    for (const f of tp.querySelectorAll('[data-field]')) if (document.activeElement !== f && f.value !== (t[f.dataset.field] ?? '')) (f.value = t[f.dataset.field] ?? ''), fit(f)
    if (tp.dataset.images !== JSON.stringify(t.images)) (shots.set(t.images, false), (tp.dataset.images = JSON.stringify(t.images)))
  }

  const fit = (el, min = 0) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(min, el.scrollHeight)}px`
  }

  tp.addEventListener('input', (e) => {
    if (e.target.matches('.tp-title')) fit(e.target)
    if (e.target.matches('.tp-details')) fit(e.target, 110)
    if (e.target.matches('[data-note], [data-sendback-note]')) fit(e.target)
  })
  // Title and description save when you leave them (Enter in the title too).
  tp.addEventListener('focusout', (e) => {
    const f = e.target.dataset?.field
    const t = ticket(panelFor)
    if (!f || !t) return
    if (f === 'body') {
      editingBody = false
      setTimeout(drawPanel)
    }
    if (e.target.value.trim() === (t[f] ?? '')) return
    if (f === 'title' && !e.target.value.trim()) return void (e.target.value = t.title)
    call('edit', t.key, { [f]: e.target.value }).catch(() => {})
  })
  tp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.tp-title')) (e.preventDefault(), e.target.blur())
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('[data-note]')) (e.preventDefault(), tp.querySelector('[data-tp=note]').click())
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('[data-sendback-note]')) (e.preventDefault(), tp.querySelector('[data-tp=send-back]').click())
    if (e.key === 'Escape' && e.target.matches('.tp-details')) e.target.blur()
  })
  tp.addEventListener('click', async (e) => {
    const t = ticket(panelFor)
    if (!t) return
    const m = e.target.closest('[data-menu]')
    if (m) return pick(t, m.dataset.menu, m)
    if (e.target.closest('.tp-live-av')) return onTerminal(worker(t)?.name ?? t.fixer)
    if (e.target.closest('a[href]')) return
    const op = e.target.closest('[data-tp]')?.dataset.tp
    if (!op) return
    if (op === 'close') return close()
    if (op === 'edit-body') {
      editingBody = true
      drawPanel()
      const box = tp.querySelector('.tp-details')
      fit(box, 110)
      return box.focus()
    }
    if (op === 'note') {
      const box = tp.querySelector('[data-note]')
      if (!box.value.trim()) return box.focus()
      await call('note', t.key, box.value.trim()).catch(() => {})
      box.value = ''
      return fit(box)
    }
    if (op === 'start') return call('dispatch', t.key).then(() => toast(`#${t.id} went to @${t.owner}, in a new conversation`), () => {})
    if (op === 'terminal') return onTerminal(worker(t)?.name ?? t.fixer)
    if (op === 'mark-done') return call('move', t.key, 'check').catch(() => {})
    if (op === 'accept') {
      burst(e.target.closest('[data-tp]'))
      await call('accept', t.key).catch(() => {})
      return setTimeout(close, 450)
    }
    if (op === 'sendback') {
      sendingBack = !sendingBack
      drawPanel()
      if (sendingBack) setTimeout(() => tp.querySelector('[data-sendback-note]')?.focus({ preventScroll: true }), 150)
      return
    }
    if (op === 'send-back') {
      const box = tp.querySelector('[data-sendback-note]')
      await call('sendBack', t.key, box.value.trim()).catch(() => {})
      sendingBack = false
      toast(t.fixer ? `Sent #${t.id} back to @${t.fixer}` : `#${t.id} is open again`)
      return drawPanel()
    }
    if (op === 'reopen') return call('move', t.key, 'new').catch(() => {})
    if (op === 'more') {
      const dups = tickets.filter((x) => x.status !== 'done' && x.key !== t.key && x.home === t.home)
      return menu(e.target.closest('[data-tp]'), [
        ...(dups.length ? [{ value: 'dup', label: 'Same as another task…', icon: icon('<rect x="2" y="4.5" width="8" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 4.5V3.6A1.6 1.6 0 0 1 7.6 2H12.4A1.6 1.6 0 0 1 14 3.6v6.8A1.6 1.6 0 0 1 12.4 12H10" fill="none" stroke="currentColor" stroke-width="1.5"/>') }] : []),
        { value: 'remove', label: 'Delete', icon: `<span class="danger-ico">${ICONS.close}</span>` },
      ], (v) => {
        if (v === 'remove' && confirm(`Delete #${t.id}? It's gone for good.`)) call('remove', t.key).then(close, () => {})
        if (v === 'dup') {
          setTimeout(() => menu(tp.querySelector('[data-tp=more]'), dups.map((x) => ({ value: x.id, label: `#${x.id} ${x.title}`, icon: KIND_ICON[x.kind] })), (id) => {
            if (confirm(`Close #${t.id} as the same as #${id}? It counts as another report there.`)) call('dup', t.key, id).then(close, () => {})
          }))
        }
      })
    }
  })

  document.addEventListener('keydown', (e) => {
    if (!root.offsetParent) return
    if (e.key === 'Escape' && pop) return closePop()
    if (e.key === 'Escape' && filtersOpen()) return void (closeFilters(), fbtn.focus({ preventScroll: true }))
    if (e.key === 'Escape' && selected && !e.target.matches?.('.tp-details')) return close()
    if (e.key === 'Escape' && composeAt) return closeComposer()
    if (e.key === 'Escape' && picked.size) return unpick()
    // ⌘A outside a text field: pick every task shown
    if (e.key === 'a' && (e.metaKey || e.ctrlKey) && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
      e.preventDefault()
      return pickAll(onScreen(), false)
    }
    // "/" or "n": add a task (New task), like a search box
    if ((e.key === '/' || e.key === 'n') && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
      e.preventDefault()
      openComposer('new')
    }
  })

  syncAdd()
  drawSearch()
  // While another view is up, the board isn't redrawn on every push: it catches up just before it's shown again,
  // without the slide-ins it would have played out of sight.
  let shown = true
  let stale = false
  return {
    render(next) {
      state = next
      tickets = next.tasks?.tickets ?? []
      drawHead()
      if (shown) {
        draw()
        if (selected) drawPanel()
        syncAdd()
      } else stale = true
    },
    setVisible(on) {
      shown = on
      if (!on || !stale || !state) return
      stale = false
      first = true
      draw()
      if (selected) drawPanel()
      syncAdd()
    },
    open: (key) => (state ? open(String(key)) : setTimeout(() => open(String(key)), 300)),
    focus: () => openComposer('new'),
    close: () => selected && close(),
    // the titlebar tab's count: tasks waiting on your review first
    badge: (next) => {
      const list = next.tasks?.tickets ?? []
      return { review: list.filter((t) => t.status === 'check').length, open: list.filter((t) => t.status === 'new' || t.status === 'fixing').length }
    },
  }
}

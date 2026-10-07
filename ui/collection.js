// The crew as a collection: a Pokédex of agent cards, grouped by the computer each one runs on. Cards come big
// or compact (compact by default once the crew outgrows a screen), or as a Stats table. Click a card to open its
// sheet: who it is on the left (creature, name, area, level, conversation), everything you can set on the right,
// in four tabs that each fit without scrolling. "Select" turns on bulk mode to change many agents at once.
/* global crew, store, esc, nameHTML, contextRing, contextTip, ctxLevel, tokenCount, plural, avatarHTML, avatarOf, colorOf, randomAvatar, statusText, mountAttach, morph, segmented, bounce, celebrate, duration, levelOf, ago, crewGroups, grouped, popMenu, PARTS, COLORS, ICONS */

const LIGHT = new Set(['yellow', 'lime', 'mint', 'sky', 'peach'])
const pad = (n) => String(n).padStart(3, '0')
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
const FIELDS = ['name', 'area', 'prompt', 'images', 'provider', 'model', 'effort', 'tier', 'cwd', 'args', 'yolo', 'contextLimit', 'onContextLimit']
// Context limits offered as one tap (only those below the model's window, at most four); any other can be typed.
const LIMITS = [100000, 150000, 200000, 250000, 400000, 600000]
const limitPresets = (win) => {
  const under = LIMITS.filter((n) => !win || n < win)
  return under.length > 4 ? [100000, 250000, 400000, 600000].filter((n) => under.includes(n)) : under
}
// An agent's full name as the crew knows it: on another computer it carries that computer's name.
const qualified = (name, home) => (home ? `${name}@${home}` : name)
const TABS = [
  { id: 'setup', label: 'Setup', icon: ICONS.brain },
  { id: 'instructions', label: 'Instructions', icon: ICONS.doc },
  { id: 'look', label: 'Look', icon: ICONS.palette },
  { id: 'stats', label: 'Stats', icon: ICONS.chart },
]
const atWork = (a) => a?.status === 'working' || a?.status === 'waiting'

function mountCollection(root, { onTerminal, onImport, onMove }) {
  root.innerHTML = `
    <section class="col-list">
      <header class="col-head">
        <div class="col-title"><h2>Your crew</h2><p class="col-sub"></p></div>
        <span class="grow"></span>
        <div class="seg icons" data-mode-switch>
          <button data-mode="cards" title="Cards">${ICONS.grid}</button><button data-mode="tiles" title="Compact cards">${ICONS.tiles}</button><button data-mode="stats" title="Stats: compare the crew">${ICONS.chart}</button>
        </div>
        <button class="btn" data-act="select" title="Pick several agents to change or export at once">Select</button>
        <button class="btn icon-btn" data-act="import" title="Import agents from a .crew file (or drop one on the window)">${ICONS.import}</button>
        <button class="btn primary" data-act="new" title="New agent (⌘N)">${ICONS.plus}New agent</button>
      </header>
      <div class="col-grid"></div>
      <div class="col-stats"></div>
      <div class="bulk"></div>
    </section>`
  // The sheet lives at the top of the page, over everything (sidebar and chat included), not inside the view.
  const sheet = document.createElement('div')
  sheet.className = 'ed-layer'
  sheet.innerHTML = '<div class="ed-scrim" data-act="back"></div><section class="ed" role="dialog" aria-modal="true"></section>'
  document.body.append(sheet)
  sheet.querySelector('.ed-scrim').addEventListener('click', () => close())
  const $ = (s) => root.querySelector(s)
  const grid = $('.col-grid')
  const card = sheet.querySelector('.ed')
  const bulk = $('.bulk')
  const list = $('.col-list')
  const picked = new Set()
  // View Transitions move the creature from its card into the sheet and back; without them, a plain fade.
  const canMorph = typeof document.startViewTransition === 'function'
  let state = null
  let gridKey = ''
  let selecting = false
  // cards, tiles (compact) or stats. Until you pick, compact once the crew is bigger than a screenful of cards.
  let mode = store.get('crew.collection')
  let sortBy = 'tasks'
  let editing = null // agent name, or ':new'
  let original = null
  let draft = null
  let tab = 'setup'
  let reopen = null // name to open once it shows up in state (after add/rename)
  let transitioning = false

  const modeNow = () => mode ?? (state.agents.length > 9 ? 'tiles' : 'cards')
  const agentNamed = (name) => state.agents.find((a) => a.name === name)
  const providerOf = (id) => state.providers[id] ?? { label: id, models: [], efforts: [] }
  const effortsFor = (d) => providerOf(d.provider).modelEfforts?.[d.model] ?? providerOf(d.provider).efforts ?? []

  // ---- grid ------------------------------------------------------------------

  function cardHTML(a, i) {
    const look = avatarOf(a)
    const chips = [providerOf(a.provider).label, [a.model, a.effort].filter(Boolean).join(' · ')].filter(Boolean).map((c) => `<span>${esc(c)}</span>`).join('')
    const modes = (a.fast ? `<span class="pc-fast" title="Fast: Codex's fast service tier">${ICONS.bolt}</span>` : '') + (a.yolo ? '<span class="pc-yolo" title="YOLO: skips every permission prompt">YOLO</span>' : '')
    const doing = a.on && a.activity && atWork(a) ? `<span class="pc-doing">${esc(a.activity)}</span>` : ''
    return `<button class="pcard hop ${LIGHT.has(look.color) ? 'light' : ''} ${a.on ? a.status : 'off'} ${picked.has(a.name) ? 'picked' : ''}" data-name="${esc(a.name)}" style="--c:${colorOf(look)}">
      <span class="pc-mark">${ICONS.mark}</span>
      <span class="pc-no"><b title="${levelOf(a.stats).xp} XP">Lv ${levelOf(a.stats).lv}</b><span>#${pad(i + 1)}</span></span>
      <span class="pc-name">${esc(a.seed ?? a.name)}</span>
      <span class="pc-area" title="${esc(a.area)}">${esc(a.area || 'No area yet. Open the card to set one.')}</span>
      ${modes ? `<span class="pc-modes">${modes}</span>` : ''}
      <span class="pc-chips">${chips}</span>
      <span class="pc-state" title="${esc(statusText(a))}"><span><span class="dot ${a.status}"></span><span>${esc(statusText(a))}</span>${contextRing(a)}</span>${doing}</span>
      <span class="pc-av">${avatarHTML(a, { size: 104 })}</span>
      <span class="pc-check">${ICONS.check}</span>
    </button>`
  }

  // Compact: the creature, the name and how it is. Area and brain are a hover away (and in its sheet).
  function tileHTML(a) {
    const look = avatarOf(a)
    const line = a.on && a.activity && atWork(a) ? a.activity : statusText(a)
    return `<button class="pcard mini hop ${LIGHT.has(look.color) ? 'light' : ''} ${a.on ? a.status : 'off'} ${picked.has(a.name) ? 'picked' : ''}" data-name="${esc(a.name)}" style="--c:${colorOf(look)}" title="${esc([a.seed ?? a.name, a.area, `${providerOf(a.provider).label}${a.model ? ` · ${a.model}` : ''}${a.effort ? ` · ${a.effort}` : ''}`].filter(Boolean).join('\n'))}">
      <span class="pc-mark">${ICONS.mark}</span>
      <span class="pc-name">${esc(a.seed ?? a.name)}</span>
      <span class="pc-line"><span class="dot ${a.on ? a.status : 'off'}"></span><span class="${a.activity && atWork(a) ? 'mono' : ''}">${esc(line)}</span></span>
      <span class="pc-tags">${a.yolo ? '<i class="mark-yolo">YOLO</i>' : ''}${a.fast ? `<i class="mark-fast">${ICONS.bolt}</i>` : ''}${contextRing(a, { label: false })}</span>
      <span class="pc-av">${avatarHTML(a, { size: 62 })}</span>
      <span class="pc-check">${ICONS.check}</span>
    </button>`
  }

  function drawGrid() {
    if (transitioning) return
    const m = modeNow()
    root.classList.toggle('stats-mode', m === 'stats')
    segmented($('[data-mode-switch]'), (b) => b.dataset.mode === m)
    if (m === 'stats') drawStatsTable()
    const groups = crewGroups(state)
    const next = JSON.stringify([m, selecting, [...picked], groups.map((g) => [g.key, g.name, g.online]), state.agents.map((a) => [a.name, a.status, a.activity, a.provider, a.model, a.effort, a.yolo, a.fast, a.on, a.avatar, levelOf(a.stats).lv, a.convo?.context?.pct, a.convo?.compactions])])
    if (next === gridKey) return
    gridKey = next
    const index = new Map(state.agents.map((a, i) => [a.name, i]))
    const one = (a) => (m === 'tiles' ? tileHTML(a) : cardHTML(a, index.get(a.name)))
    // on agents first in each group, off ones after them; your order otherwise
    const order = (agents) => [...agents.filter((a) => a.on), ...agents.filter((a) => !a.on)]
    const add = `<button class="pcard add ${m === 'tiles' ? 'mini' : ''}" data-act="new"><b>${ICONS.plus}</b>New agent</button>`
    const html = grouped(groups)
      ? groups.filter((g) => g.agents.length).map((g, i) => `<section class="col-group" data-home="${esc(g.key)}">
          <h3>${g.here ? ICONS.desktop : ICONS.laptop}<b>${esc(g.name)}</b><span>${plural(g.agents.length, 'agent')}${g.here ? ' · this Mac' : g.online ? '' : ' · offline'}</span></h3>
          <div class="col-cards ${m}">${order(g.agents).map(one).join('')}${i === 0 ? add : ''}</div></section>`).join('')
      : `<div class="col-cards ${m}">${order(state.agents).map(one).join('')}${add}</div>`
    morph(grid, html)
    celebrate(grid, state.agents)
    const on = state.agents.filter((a) => a.on).length
    const pcs = groups.filter((g) => g.agents.length).length
    $('.col-sub').textContent = state.agents.length ? `${plural(state.agents.length, 'agent')} · ${on} on${pcs > 1 ? ` · ${pcs} computers` : ''}` : 'Start with one agent per area of work'
    root.classList.toggle('selecting', selecting)
    $('[data-act=select]').textContent = selecting ? 'Done' : 'Select'
    drawBulkCount()
  }

  // The hovered card tilts toward the pointer (see .pcard:hover). The position lives on the grid, which morph()
  // never rewrites, so a state push mid-hover doesn't snap the card back.
  grid.addEventListener('pointermove', (e) => {
    const c = e.target.closest('.pcard:not(.add)')
    if (!c) return
    const r = c.getBoundingClientRect()
    grid.style.setProperty('--mx', ((e.clientX - r.left) / r.width).toFixed(3))
    grid.style.setProperty('--my', ((e.clientY - r.top) / r.height).toFixed(3))
  })
  // ...and the creature in the open sheet watches the pointer.
  card.addEventListener('pointermove', (e) => {
    const hero = card.querySelector('.ed-id')
    if (!hero) return
    const r = hero.getBoundingClientRect()
    hero.style.setProperty('--mx', Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)).toFixed(3))
    hero.style.setProperty('--my', Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)).toFixed(3))
  })
  list.addEventListener('scroll', () => list.classList.toggle('scrolled', list.scrollTop > 4), { passive: true })

  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.pcard')
    if (!c) return
    if (c.dataset.act === 'new') return open(null)
    if (!selecting) return open(c.dataset.name)
    picked[picked.has(c.dataset.name) ? 'delete' : 'add'](c.dataset.name)
    drawGrid()
  })
  $('.col-head').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'new') open(null)
    if (act === 'import') onImport()
    if (act === 'select') setSelecting(!selecting)
    const m = e.target.closest('[data-mode]')?.dataset.mode
    if (m) {
      mode = m
      store.set('crew.collection', m)
      if (m === 'stats' && selecting) setSelecting(false)
      gridKey = ''
      drawGrid()
    }
  })

  // ---- stats: compare the crew side by side ----------------------------------------

  // better: which direction wins. has: whether an agent has data for it (no turns yet means no average).
  const METRICS = [
    { key: 'tasks', label: 'Tasks', better: 'high', show: (s) => s.tasks, tip: (s) => `${s.fromYou} from you · ${s.fromTeam} from teammates` },
    { key: 'activeMs', label: 'Active', better: 'high', show: (s) => duration(s.activeMs) },
    { key: 'avgTurnMs', label: 'Avg turn', better: 'low', show: (s) => duration(s.avgTurnMs), has: (s) => s.turns > 0 },
    { key: 'tools', label: 'Tool calls', better: 'high', show: (s) => s.tools },
    { key: 'handoffs', label: 'Hand-offs', better: 'high', show: (s) => s.handoffs, tip: (s) => `made ${s.handoffs} · received ${s.fromTeam}` },
    { key: 'waits', label: 'Needs you', better: 'low', show: (s) => s.waits, tip: (s) => `waited ${duration(s.waitMs)} on you in total` },
    { key: 'avgQueueMs', label: 'Queue wait', better: 'low', show: (s) => duration(s.avgQueueMs), has: (s) => s.fromYou + s.fromTeam > 0, tip: () => 'how long messages wait before it is free (busy agents wait longer)' },
  ]
  const BEST = `<i class="best" title="best in the crew">${ICONS.crown}</i>`
  const SLOW = `<i class="slow" title="slowest in the crew">${ICONS.snail}</i>`

  // best in a column, and slowest (for the "lower is better" timing columns)
  function standouts(metric) {
    const rows = state.agents.filter((a) => (metric.has ?? ((s) => s[metric.key] > 0))(a.stats))
    if (!rows.length) return {}
    const sorted = [...rows].sort((x, y) => (x.stats[metric.key] - y.stats[metric.key]) * (metric.better === 'high' ? -1 : 1))
    return { best: sorted[0].name, worst: metric.better === 'low' && metric.key !== 'waits' && sorted.length > 1 ? sorted.at(-1).name : null }
  }

  function bar(value, max) {
    return `<i class="mbar"><b style="width:${max ? Math.max(4, Math.round((value / max) * 100)) : 0}%"></b></i>`
  }

  function sparkline(days, max = Math.max(1, ...days.map((d) => d.tasks))) {
    return `<span class="spark" title="tasks per day, last 14 days">${days.map((d) => `<i style="height:${Math.max(8, Math.round((d.tasks / max) * 100))}%" class="${d.tasks ? 'on' : ''}" title="${d.day}: ${d.tasks} task${d.tasks === 1 ? '' : 's'}"></i>`).join('')}</span>`
  }

  function drawStatsTable() {
    const metric = METRICS.find((m) => m.key === sortBy) ?? METRICS[0]
    const value = (a) => ((metric.has ?? (() => true))(a.stats) ? a.stats[metric.key] : metric.better === 'high' ? -1 : Infinity)
    const rows = [...state.agents].sort((x, y) => (value(x) - value(y)) * (metric.better === 'high' ? -1 : 1))
    const marks = Object.fromEntries(METRICS.map((m) => [m.key, standouts(m)]))
    const maxOf = Object.fromEntries(METRICS.map((m) => [m.key, Math.max(0, ...state.agents.map((a) => a.stats[m.key] || 0))]))
    const sparkMax = Math.max(1, ...state.agents.flatMap((a) => a.stats.days.map((d) => d.tasks)))
    // morph, not innerHTML: rows animate in once, and bars glide to new values instead of redrawing
    morph($('.col-stats'), `<table class="stats-table"><thead><tr><th>Agent</th>${METRICS.map((m) => `<th data-sort="${m.key}" class="${m.key === sortBy ? 'on' : ''}" title="${m.better === 'high' ? 'more is better' : 'less is better'}">${m.label}</th>`).join('')}<th>14 days</th></tr></thead><tbody>${
      rows.map((a) => `<tr data-name="${esc(a.name)}" class="${a.on ? '' : 'off'}" style="--c:${colorOf(avatarOf(a))}">
        <td class="who" title="${esc(a.area)}">${avatarHTML(a, { size: 30, mood: 'still' })}<span><b>${nameHTML(a)}</b><small title="last active">Lv ${levelOf(a.stats).lv} · ${!a.stats.last ? 'no work yet' : Date.now() - a.stats.last < 60000 ? 'just now' : `${ago(a.stats.last)} ago`}</small></span></td>
        ${METRICS.map((m) => {
          const s = a.stats
          const has = (m.has ?? (() => true))(s)
          const mark = marks[m.key].best === a.name ? BEST : marks[m.key].worst === a.name ? SLOW : ''
          return `<td title="${esc(m.tip?.(s) ?? '')}">${has ? `<span>${m.show(s)}${mark}</span>${bar(s[m.key], maxOf[m.key])}` : '<span class="na">–</span>'}</td>`
        }).join('')}
        <td>${sparkline(a.stats.days, sparkMax)}</td></tr>`).join('')
    }</tbody></table>
    <p class="stats-note">${BEST} best in the column · ${SLOW} slowest · bars compare against the busiest agent · counted since each agent's first task</p>`)
  }

  $('.col-stats').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]')
    if (th) {
      sortBy = th.dataset.sort
      return drawStatsTable()
    }
    const row = e.target.closest('tr[data-name]')
    if (row) open(row.dataset.name)
  })

  // ---- bulk edit -------------------------------------------------------------

  function setSelecting(on) {
    selecting = on
    picked.clear()
    if (on) drawBulk()
    root.classList.toggle('selecting', on)
    drawGrid()
  }

  function drawBulk() {
    const providers = Object.entries(state.providers)
    const efforts = [...new Set(providers.flatMap(([, p]) => p.efforts))]
    const models = [...new Set(providers.flatMap(([, p]) => p.models))]
    bulk.innerHTML = `
      <div class="bulk-who"></div>
      <select data-b="provider"><option value="">Provider</option>${providers.map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`).join('')}</select>
      <input data-b="model" placeholder="Model" list="bulk-models"><datalist id="bulk-models">${models.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      <select data-b="effort"><option value="">Effort</option><option value="-">default</option>${efforts.map((v) => `<option>${v}</option>`).join('')}</select>
      <select data-b="yolo"><option value="">YOLO</option><option value="1">YOLO on</option><option value="0">YOLO off</option></select>
      <select data-b="tier" title="Codex agents only"><option value="">Fast</option><option value="fast">Fast on</option><option value="default">Fast off</option></select>
      <select data-b="power"><option value="">Power</option><option value="1">Turn on</option><option value="0">Turn off</option></select>
      <button class="btn" data-act="all">All</button>
      <button class="btn" data-act="export" title="Save the picked agents as a .crew file to share">${ICONS.export}Export</button>
      <button class="btn primary" data-act="apply"></button>`
    drawBulkCount()
  }

  function drawBulkCount() {
    const who = bulk.querySelector('.bulk-who')
    if (!who) return
    const names = [...picked]
    who.innerHTML = names.slice(0, 6).map((n) => avatarHTML(agentNamed(n) ?? { name: n }, { size: 28, mood: 'still' })).join('') + `<b>${names.length ? `${names.length} selected` : 'Tap cards to pick them'}</b>`
    const apply = bulk.querySelector('[data-act=apply]')
    apply.disabled = bulk.querySelector('[data-act=export]').disabled = !names.length
    apply.textContent = names.length ? `Apply to ${names.length}` : 'Apply'
  }

  bulk.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'all') {
      state.agents.forEach((a) => picked.add(a.name))
      gridKey = ''
      drawGrid()
    }
    if (act === 'export' && picked.size) {
      const saved = await exportAgents([...picked])
      if (saved) setSelecting(false)
    }
    if (act !== 'apply' || !picked.size) return
    const v = Object.fromEntries([...bulk.querySelectorAll('[data-b]')].map((el) => [el.dataset.b, el.value.trim()]))
    const patch = {}
    if (v.provider) Object.assign(patch, { provider: v.provider, model: '', effort: '' }) // old models rarely fit a new provider
    if (v.model) patch.model = v.model
    if (v.effort) patch.effort = v.effort === '-' ? '' : v.effort
    if (v.yolo) patch.yolo = v.yolo === '1'
    if (v.tier) patch.tier = v.tier
    if (v.power) patch.off = v.power === '0'
    if (!Object.keys(patch).length) return
    const names = [...picked]
    await crew.call('update', names, patch)
    setSelecting(false)
    cheer(names)
  })

  // A .crew file with these agents: their definitions, looks and reference images (not their folders or chats).
  async function exportAgents(names) {
    try {
      return await crew.call('exportAgents', names)
    } catch (err) {
      alert(`Couldn't export: ${err.message}`)
    }
  }

  // Little celebratory hop on cards that just changed.
  function cheer(names) {
    setTimeout(() => {
      for (const n of names) bounce(grid.querySelector(`.pcard[data-name="${CSS.escape(n)}"] .av`), 'pop')
    }, 120)
  }

  // ---- the sheet: one agent, everything about it ------------------------------------

  // `home` opens a new agent set to run on another computer ('' = this one).
  function open(name, { home, at } = {}) {
    if (editing && name !== editing && dirty() && !confirm('Discard your changes?')) return
    const a = name && agentNamed(name)
    original = a
      ? { name: a.seed ?? a.name, home: a.home ?? '', area: a.area ?? '', prompt: a.prompt ?? '', images: a.images ?? [], provider: a.provider ?? 'claude', model: a.model ?? '', effort: a.effort ?? '', tier: a.tier ?? '', cwd: a.cwd ?? '', args: a.args ?? '', yolo: a.yolo, on: a.on, avatar: avatarOf(a), contextLimit: a.contextLimit ?? '', onContextLimit: a.onContextLimit ?? 'fresh' }
      : null
    draft = original
      ? structuredClone(original)
      : { name: '', home: '', area: '', prompt: '', images: [], provider: 'claude', model: '', effort: '', tier: '', cwd: '', args: '', yolo: store.get('crew.yolo') === '1', on: true, avatar: randomAvatar(), contextLimit: '', onContextLimit: 'fresh' }
    if (home !== undefined && !a) draft.home = home
    editing = a ? a.name : ':new'
    tab = at ?? (a ? store.get('crew.edTab') || 'setup' : 'setup')
    if (!a && tab === 'stats') tab = 'setup'
    if (selecting) setSelecting(false)
    morphTo(a?.name, 'open', () => {
      drawCard()
      sheet.classList.add('open')
    })
    if (!a) setTimeout(() => card.querySelector('.pd-name')?.focus(), 250)
  }

  function close(force = false) {
    if (!force && dirty() && !confirm('Discard your changes?')) return false
    const name = editing
    editing = null
    morphTo(name, 'close', () => sheet.classList.remove('open'))
    return true
  }

  // Card <-> sheet as one motion: the card grows into the sheet's left side and its creature travels with it.
  // Elements share a view-transition-name only for the length of the transition.
  function morphTo(name, dir, update) {
    const tile = name && modeNow() !== 'stats' && root.offsetParent ? grid.querySelector(`.pcard[data-name="${CSS.escape(name)}"]`) : null
    const already = dir === 'open' && sheet.classList.contains('open') // e.g. reopening after Save
    if (!canMorph || !tile?.getClientRects().length || already || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update()
      if (dir === 'open' && !already) card.classList.remove('enter'), void card.offsetWidth, card.classList.add('enter') // the plain rise
      return
    }
    const parts = (inCard) => (inCard
      ? [[tile, 'pd-hero'], [tile.querySelector('.av'), 'pd-av']]
      : [[card.querySelector('.ed-id'), 'pd-hero'], [card.querySelector('.ed-av .av'), 'pd-av']])
    const tag = (pairs, on) => pairs.forEach(([el, n]) => el && (el.style.viewTransitionName = on ? n : ''))
    let from = parts(dir === 'open')
    tag(from, true)
    transitioning = true // a redraw now would drop the names or swap the creature out from under the snapshot
    sheet.classList.add('vt')
    const t = document.startViewTransition(() => {
      tag(from, false)
      update()
      from = parts(dir !== 'open')
      tag(from, true)
    })
    t.finished.finally(() => {
      tag(from, false)
      sheet.classList.remove('vt')
      transitioning = false
      gridKey = ''
      drawGrid()
    })
  }

  const dirty = () => (original ? JSON.stringify(draft) !== JSON.stringify(original) : Boolean(draft?.name.trim()))

  function drawCard() {
    const d = draft
    const live = agentNamed(editing)
    const i = state.agents.findIndex((x) => x.name === editing)
    card.innerHTML = `
      <aside class="ed-id">
        <div class="ed-top"><span class="pd-state"></span><span class="pd-no">${i >= 0 ? `#${pad(i + 1)}` : 'new'}</span></div>
        <span class="pd-mark">${ICONS.mark}</span>
        <button class="ed-av" data-tab="look" title="Change its look"><span class="pd-av"></span><i class="ed-av-edit">${ICONS.palette}</i></button>
        <input class="pd-name" data-k="name" value="${esc(d.name)}" placeholder="Name" spellcheck="false" autocomplete="off" aria-label="Name">
        <textarea class="pd-area" data-k="area" rows="2" placeholder="What does it own? e.g. 3D character: rig, animations, materials" aria-label="Area of work">${esc(d.area)}</textarea>
        <div class="ed-level"></div>
        <div class="ed-glance"></div>
        <div class="convo"></div>
        <span class="grow"></span>
        ${live ? `<div class="ed-id-acts">
          <button class="btn" data-act="terminal" ${live.on ? '' : 'disabled'} title="Open its terminal">${ICONS.terminal}<span>Terminal</span></button>
          <button class="btn" data-act="more" title="Export, move, remove">${ICONS.more}<span>More</span></button>
        </div>` : ''}
      </aside>
      <div class="ed-main">
        <header class="ed-head">
          <div class="seg ed-tabs" role="tablist">${TABS.map((t) => `<button role="tab" data-tab="${t.id}" ${t.id === 'stats' && !live ? 'disabled' : ''}>${t.icon}<span>${t.label}</span></button>`).join('')}</div>
          <span class="grow"></span>
          <button class="icon ed-close" data-act="back" title="Close (Esc)" aria-label="Close">${ICONS.close}</button>
        </header>
        <div class="ed-panes">
          <section class="ed-pane" data-pane="setup">
            <h4>Brain</h4>
            <div class="ed-list brain"></div>
            <h4>Modes</h4>
            <div class="ed-modes"></div>
            <h4>Where it works</h4>
            <div class="ed-list where"></div>
            <h4>Conversation</h4>
            <div class="ed-list limit"></div>
          </section>
          <section class="ed-pane" data-pane="instructions">
            <div class="ed-pane-head"><p>Its system prompt, on top of the crew basics: what it owns, its bar, when to hand off.</p><button class="btn small" data-act="write" title="Its own brain drafts them from its name and area">${ICONS.sparkles}<span>Write it</span></button></div>
            <textarea class="pd-prompt" data-k="prompt" placeholder="Leave it empty, or press Write it for a first draft from the name and area." aria-label="Instructions">${esc(d.prompt)}</textarea>
            <div class="refs"><div class="thumbs refs-thumbs"></div><button type="button" class="btn small" data-ref title="Mockups, brand guides, screenshots: paste or drop them on the instructions too">${ICONS.plus}<span>Reference image</span></button></div>
          </section>
          <section class="ed-pane" data-pane="look">
            <div class="ed-pane-head"><p>Every option shows ${esc(d.name || 'it')} wearing it.</p><button class="btn small" data-act="shuffle">${ICONS.dice}<span>Shuffle</span></button></div>
            <div class="look"></div>
          </section>
          <section class="ed-pane" data-pane="stats"><div class="experience"></div></section>
        </div>
        <footer class="pd-foot">
          <span class="pd-msg"></span><span class="grow"></span><span class="pd-dirty">Unsaved changes</span>
          <button class="btn" data-act="back">Cancel</button>
          <button class="btn primary" data-act="save" title="Save (⌘S)">${live ? 'Save' : 'Add to crew'}</button>
        </footer>
      </div>`
    drawTab()
    drawState()
    drawLevel()
    drawExperience()
    drawConvo()
    drawLimit()
    drawBrain()
    drawLook()
    drawAvatar()
    const prompt = card.querySelector('.pd-prompt')
    mountAttach({
      zone: prompt,
      field: prompt,
      tray: card.querySelector('.refs-thumbs'),
      button: card.querySelector('[data-ref]'),
      onChange: (paths) => {
        draft.images = paths
        syncSave()
      },
      onError: (text) => (card.querySelector('.pd-msg').textContent = text),
    }).set(d.images, false)
    syncSave()
  }

  function drawTab() {
    segmented(card.querySelector('.ed-tabs'), (b) => b.dataset.tab === tab)
    for (const p of card.querySelectorAll('.ed-pane')) p.classList.toggle('on', p.dataset.pane === tab)
  }

  function setTab(next) {
    if (next === tab) return
    tab = next
    if (editing !== ':new') store.set('crew.edTab', next)
    drawTab()
    if (next === 'instructions') card.querySelector('.pd-prompt')?.focus({ preventScroll: true })
  }

  // Level and XP, under the name: the card's "Lv" grown up. The full stats are on the Stats tab.
  function drawLevel() {
    const host = card.querySelector('.ed-level')
    const a = agentNamed(editing)
    if (!host) return
    if (!a) return void (host.innerHTML = '')
    const lv = levelOf(a.stats)
    morph(host, `<span class="lv">Lv ${lv.lv}</span><i class="xpbar"><b style="width:${Math.round(lv.progress * 100)}%"></b></i><span class="xp-n" title="${lv.toNext} XP to Lv ${lv.lv + 1}">${lv.xp} XP</span>`)
    // a glance at its work: what it's done and its last two weeks (the Stats tab has the rest)
    const s = a.stats
    morph(card.querySelector('.ed-glance'), s.tasks
      ? `<dl><dt>Tasks</dt><dd>${s.tasks}</dd><dt>Active</dt><dd>${duration(s.activeMs)}</dd><dt>Avg turn</dt><dd>${s.turns ? duration(s.avgTurnMs) : '–'}</dd></dl>${sparkline(s.days)}`
      : '')
  }

  // Pokédex-style base stats: this agent against the busiest one in the crew.
  function drawExperience() {
    const host = card.querySelector('.experience')
    const a = agentNamed(editing)
    if (!host) return
    if (!a || !a.stats.tasks) {
      host.innerHTML = `<div class="xp-empty">${ICONS.chart}<b>No work yet</b><span>Send it a task and its stats start counting.</span></div>`
      return
    }
    const s = a.stats
    const lv = levelOf(s)
    host.innerHTML = `
      <div class="xp-big"><span class="lv">Lv ${lv.lv}</span><div class="grow"><i class="xpbar"><b style="width:${Math.round(lv.progress * 100)}%"></b></i><span class="h4-note">${lv.xp} XP · ${lv.toNext} to Lv ${lv.lv + 1}${s.first ? ` · working since ${new Date(s.first).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</span></div></div>
      <div class="base-stats">${METRICS.map((m) => {
        const has = (m.has ?? (() => true))(s)
        const max = Math.max(0, ...state.agents.map((x) => x.stats[m.key] || 0))
        const mark = standouts(m)
        return `<div class="bs-row" title="${esc(m.tip?.(s) ?? '')}"><span class="bs-label">${m.label}</span><b>${has ? m.show(s) : '–'}${mark.best === a.name ? BEST : mark.worst === a.name ? SLOW : ''}</b>${has ? bar(s[m.key], max) : '<i class="mbar"></i>'}</div>`
      }).join('')}</div>
      <div class="days"><span class="bs-label">Tasks a day, last 14 days</span>${sparkline(s.days)}</div>`
  }

  // How full its current conversation is, and a way to start a new one. Long conversations with many
  // unrelated tasks are where agents start mixing things up.
  function drawConvo() {
    const host = card.querySelector('.convo')
    if (!host) return
    const a = agentNamed(editing)
    const c = a?.convo
    if (!a || !c) {
      host.innerHTML = ''
      return
    }
    const ctx = c.context
    const level = ctx ? ctxLevel(ctx.pct) : 'calm'
    const advice = !a.on ? 'It picks this conversation up when it comes back on.'
      : ctx?.limit && level !== 'calm' ? (a.onContextLimit === 'notify' ? `Close to its ${tokenCount(ctx.limit)} limit: you'll get a heads-up.` : `It starts fresh by itself past ${tokenCount(ctx.limit)}.`)
      : c.compactions ? `It ran out of room ${c.compactions === 1 ? 'once' : `${c.compactions} times`} and summarized older details.`
      : level === 'hot' ? 'Nearly full: start fresh before its next task.'
      : level === 'warm' ? 'Getting long. Start fresh before something unrelated.'
      : 'Plenty of room.'
    morph(host, `
      <div class="convo-card ${level}" title="${esc(contextTip(a))}">
        <div class="convo-gauge">${ctx && a.on ? contextRing(a, { label: false, size: 40 }) : '<span class="ctx calm" style="--s:40px"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.6" class="ctx-track"/></svg></span>'}<b>${ctx ? `${ctx.pct}%` : '–'}</b></div>
        <div class="convo-info">
          <div class="convo-nums">${ctx ? `<b>${tokenCount(ctx.used)}</b> of ${tokenCount(ctx.limit ?? ctx.size)}` : 'Not measured yet'} · ${plural(c.tasks, 'task')}</div>
          <p>${esc(advice)}</p>
        </div>
        <button class="icon convo-fresh" data-act="fresh" ${a.freshPending || !a.on ? 'disabled' : ''} title="${a.freshPending ? 'Starts a new conversation when it’s free' : 'New conversation: a clean slate (the old one stays in its history)'}">${ICONS.fresh}</button>
      </div>`)
  }

  // A row of the grouped list: what it is on the left, the control on the right.
  const row = (label, control, { note = '', cls = '' } = {}) => `<div class="ed-row ${cls}"><span class="ed-label">${label}${note ? `<small>${note}</small>` : ''}</span><div class="ed-ctl">${control}</div></div>`
  const pill = (v, label, on, attrs = '') => `<button class="pill ${on ? 'on' : ''}" data-v="${esc(v)}" ${attrs}>${label}</button>`

  // Its own context limit, below the model's window, and what happens when the conversation passes it.
  function drawLimit() {
    const host = card.querySelector('.limit')
    if (!host) return
    const a = agentNamed(editing)
    const ctx = a?.convo?.context
    const win = ctx?.window ?? ctx?.size // the model's real window, once it has reported one
    const limit = Number(draft.contextLimit) || 0
    const presets = limitPresets(win)
    const custom = limit && !presets.includes(limit)
    const fresh = draft.onContextLimit !== 'notify'
    const past = limit && ctx && ctx.used >= limit
    const note = !limit ? `Long conversations full of unrelated tasks are where agents mix things up; a limit keeps it sharp.`
      : past ? (fresh ? `Already past ${tokenCount(limit)}: once you save, it starts fresh as soon as it's free.` : `Already past ${tokenCount(limit)}: you'll get a heads-up once you save.`)
      : fresh ? `At ${tokenCount(limit)} it finishes what it's doing and starts a new conversation.`
      : `At ${tokenCount(limit)} you get a notification and decide when to start fresh.`
    host.innerHTML =
      row('Context limit', `<div class="pills small" data-pick="contextLimit">${pill('', win ? `Full ${tokenCount(win)}` : 'Full window', !limit)}${presets.map((n) => pill(n, tokenCount(n), limit === n)).join('')}
        <label class="limit-custom ${custom ? 'on' : ''}"><input type="number" min="10" step="10" data-limit-k value="${custom ? Math.round(limit / 1000) : ''}" placeholder="Custom" title="Any limit, in thousands of tokens"><span>k</span></label></div>`) +
      row('When it’s reached', `<div class="pills small" data-pick="onContextLimit">${pill('fresh', 'New conversation', fresh)}${pill('notify', 'Just tell me', !fresh)}</div>`, { cls: limit ? '' : 'off' }) +
      `<p class="limit-note ${past ? 'past' : ''}">${esc(note)}</p>`
  }

  function drawState() {
    const live = agentNamed(editing)
    const el = card.querySelector('.pd-state')
    if (el) el.innerHTML = live ? `<span class="dot ${live.on ? live.status : 'off'}"></span>${esc(statusText(live))}${live.pending ? ' · restarts when free' : ''}` : `${ICONS.sparkles}New agent`
  }

  function drawBrain() {
    const d = draft
    const p = providerOf(d.provider)
    const efforts = effortsFor(d)
    const fastKnown = p.fastByDefault !== undefined
    card.querySelector('.brain').innerHTML =
      row('Provider', `<div class="pills" data-pick="provider">${Object.entries(state.providers)
        .map(([id, pr]) => pill(id, `${esc(pr.label)}${pr.missing?.length ? ' ⚠︎' : ''}`, d.provider === id, pr.missing?.length ? `title="needs ${esc(pr.missing.join(', '))} in your environment"` : ''))
        .join('')}</div>`) +
      row('Model', `<input class="ed-input" data-k="model" list="pd-models" value="${esc(d.model)}" placeholder="default" autocomplete="off"><datalist id="pd-models">${p.models.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`) +
      row('Effort', efforts.length ? `<div class="pills small" data-pick="effort">${['', ...efforts].map((v) => pill(v, v || 'default', d.effort === v)).join('')}</div>` : '<em>set by the model</em>', { cls: 'effort-row' })
    // three switches side by side; Fast stays in its place for non-Codex brains, just unavailable
    card.querySelector('.ed-modes').innerHTML = `
      <label class="mtile yolo"><i class="glyph">!</i><span><b>YOLO</b><small>No permission prompts</small></span><input type="checkbox" class="switch" data-k="yolo" ${d.yolo ? 'checked' : ''}></label>
      <label class="mtile fast ${fastKnown ? '' : 'na'}" title="${fastKnown ? '' : 'Only Codex has a fast service tier'}"><i class="glyph">${ICONS.bolt}</i><span><b>Fast</b><small>${fastKnown ? `Codex's fast tier${d.tier ? '' : ', as in your config'}` : 'Codex only'}</small></span><input type="checkbox" class="switch" data-fast-tier ${fastKnown && (d.tier ? d.tier === 'fast' : p.fastByDefault) ? 'checked' : ''} ${fastKnown ? '' : 'disabled'}></label>
      <label class="mtile power"><i class="glyph">${ICONS.power}</i><span><b>${d.on ? 'On' : 'Off'}</b><small>Stays ${d.on ? 'on' : 'off'} after restarts</small></span><input type="checkbox" class="switch" data-k="on" ${d.on ? 'checked' : ''}></label>`
    drawWhere()
  }

  // Which computer it runs on and its folder there, plus extra CLI flags. An agent that exists moves with the
  // move sheet (its conversation goes along); a new one is simply made there.
  function drawWhere() {
    const d = draft
    const c = state.computers ?? { me: {}, links: [] }
    const places = [{ slug: '', name: c.me?.name || 'This computer', online: true, here: true }, ...(c.links ?? [])]
    const live = agentNamed(editing)
    const at = places.find((p) => p.slug === (d.home ?? '')) ?? { name: d.home, online: false }
    const computer = places.length < 2 && !d.home ? ''
      : live
        ? row('Computer', `<span class="ed-pc">${at.here ? ICONS.desktop : ICONS.laptop}<b>${esc(at.name)}</b>${at.here ? '<small>this Mac</small>' : ''}</span><button class="btn small" data-act="move-to" ${places.some((p) => p.slug !== (d.home ?? '') && p.online) ? '' : 'disabled'}>${ICONS.move}<span>Move…</span></button>`, { note: 'its chat comes along' })
        : row('Computer', `<div class="pills small" data-pick="home">${places.filter((p) => p.online || p.slug === d.home).map((p) => pill(p.slug, esc(p.name), d.home === p.slug)).join('')}</div>`)
    card.querySelector('.where').innerHTML = computer +
      row('Folder', `<input class="ed-input mono" data-k="cwd" value="${esc(d.cwd)}" placeholder="~/code/my-app" autocomplete="off">${d.home ? '' : '<button type="button" class="btn small" data-act="pick">Choose…</button>'}`, { note: d.home ? `a path on ${esc(at.name)}` : '' }) +
      row('Extra flags', `<input class="ed-input mono" data-k="args" value="${esc(d.args)}" placeholder="passed straight to the CLI" autocomplete="off">`)
  }

  // A character creator: every option is shown as a tiny version of this agent wearing it.
  function drawLook() {
    const s = draft.avatar
    const name = draft.name || 'new'
    const opt = (k, v) => `<button class="opt ${s[k] === v ? 'on' : ''}" data-look="${k}" data-v="${v}" title="${v}">${avatarHTML({ name, avatar: { ...s, [k]: v } }, { size: 50, mood: 'still' })}</button>`
    const line = (title, k) => `<div class="look-row"><span>${title}</span><div class="opts">${PARTS[k].map((v) => opt(k, v)).join('')}</div></div>`
    card.querySelector('.look').innerHTML =
      line('Body', 'body') +
      `<div class="look-row"><span>Color</span><div class="opts">${PARTS.color.map((c) => `<button class="swatch ${s.color === c ? 'on' : ''}" data-look="color" data-v="${c}" style="--sw:${COLORS[c]}" title="${c}"></button>`).join('')}</div></div>` +
      line('Eyes', 'eyes') + line('Mouth', 'mouth') + line('Extras', 'hat') +
      `<div class="look-row"><span>Blush</span><div class="opts"><input type="checkbox" class="switch" data-look="cheeks" ${s.cheeks ? 'checked' : ''}></div></div>`
  }

  function drawAvatar(hop = false) {
    card.style.setProperty('--c', colorOf(draft.avatar))
    card.style.setProperty('--ed-c', colorOf(draft.avatar))
    card.classList.toggle('light', LIGHT.has(draft.avatar.color))
    const live = agentNamed(editing)
    const host = card.querySelector('.pd-av')
    const mood = live?.status === 'working' || live?.status === 'waiting' ? undefined : live && !live.on ? 'sleep' : 'idle'
    host.innerHTML = avatarHTML({ name: draft.name || 'new', avatar: draft.avatar, status: live?.status }, { size: 150, mood })
    if (hop) bounce(host.querySelector('.av'), 'pop')
  }

  function syncSave() {
    const btn = card.querySelector('[data-act=save]')
    if (btn) btn.disabled = !dirty()
    card.querySelector('.pd-foot')?.classList.toggle('dirty', Boolean(original) && dirty())
  }

  card.addEventListener('input', (e) => {
    if ('limitK' in e.target.dataset) {
      const k = Math.round(Number(e.target.value))
      draft.contextLimit = k >= 10 ? k * 1000 : ''
      for (const p of card.querySelectorAll('[data-pick=contextLimit] .pill')) p.classList.toggle('on', Number(p.dataset.v || 0) === (Number(draft.contextLimit) || 0) && !(k >= 10 && !p.dataset.v))
      e.target.closest('.limit-custom').classList.toggle('on', k >= 10 && !LIMITS.includes(draft.contextLimit))
      card.querySelector('.limit .ed-row + .ed-row')?.classList.toggle('off', !draft.contextLimit)
      return syncSave()
    }
    const k = e.target.dataset.k
    if (!k) return
    draft[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    if (k === 'model') drawEffortOnly()
    if (k === 'name') card.querySelector('.ed-pane[data-pane=look] .ed-pane-head p').textContent = `Every option shows ${draft.name || 'it'} wearing it.`
    if (k === 'on') drawBrain()
    syncSave()
  })

  // Changing model can change which efforts exist (Codex models differ); redraw just that bit.
  function drawEffortOnly() {
    const efforts = effortsFor(draft)
    if (!efforts.includes(draft.effort)) draft.effort = ''
    const ctl = card.querySelector('.effort-row .ed-ctl')
    if (ctl) ctl.innerHTML = efforts.length ? `<div class="pills small" data-pick="effort">${['', ...efforts].map((v) => pill(v, v || 'default', draft.effort === v)).join('')}</div>` : '<em>set by the model</em>'
  }

  card.addEventListener('change', (e) => {
    if ('fastTier' in e.target.dataset) {
      draft.tier = e.target.checked ? 'fast' : 'default'
      return syncSave()
    }
    if (e.target.dataset.look !== 'cheeks') return
    draft.avatar.cheeks = e.target.checked
    drawLook()
    drawAvatar(true)
    syncSave()
  })

  card.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]')
    if (t && !t.disabled) return setTab(t.dataset.tab)
    const p = e.target.closest('[data-pick] .pill')
    if (p && ['contextLimit', 'onContextLimit'].includes(p.closest('[data-pick]').dataset.pick)) {
      const k = p.closest('[data-pick]').dataset.pick
      draft[k] = k === 'contextLimit' ? Number(p.dataset.v) || '' : p.dataset.v
      drawLimit()
      return syncSave()
    }
    if (p) {
      const k = p.closest('[data-pick]').dataset.pick
      if (k === 'provider' && draft.provider !== p.dataset.v) Object.assign(draft, { model: '', effort: '', tier: '' })
      draft[k] = p.dataset.v
      drawBrain()
      return syncSave()
    }
    const look = e.target.closest('[data-look]')
    if (look && look.dataset.look !== 'cheeks') {
      draft.avatar = { ...draft.avatar, [look.dataset.look]: look.dataset.v }
      drawLook()
      drawAvatar(true)
      return syncSave()
    }
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'back') close()
    if (act === 'shuffle') {
      draft.avatar = randomAvatar()
      drawLook()
      drawAvatar(true)
      syncSave()
    }
    if (act === 'pick') {
      try {
        const dir = await crew.call('pickFolder', draft.home)
        if (dir) card.querySelector('[data-k=cwd]').value = draft.cwd = dir
        syncSave()
      } catch (err) {
        card.querySelector('.pd-msg').textContent = err.message // an agent on another computer works in that computer's folders
      }
    }
    if (act === 'terminal') {
      const name = editing
      if (close()) onTerminal(name)
    }
    if (act === 'move-to') moveMenu(e.target.closest('[data-act]'))
    if (act === 'more') moreMenu(e.target.closest('[data-act]'))
    if (act === 'fresh') {
      try {
        await crew.call('freshStart', editing)
        card.querySelector('.pd-msg').textContent = 'New conversation ✓'
      } catch (err) {
        card.querySelector('.pd-msg').textContent = err.message
      }
    }
    if (act === 'save') save()
    if (act === 'write') write()
  })

  // Move…: the computers it could go to. The move sheet takes it from there (folder, what comes along).
  function moveMenu(anchor) {
    const c = state.computers ?? { me: {}, links: [] }
    const places = [{ slug: '', name: c.me?.name || 'This computer', online: true, here: true }, ...(c.links ?? [])].filter((p) => p.slug !== (draft.home ?? ''))
    popMenu(anchor, [{ head: 'Move to' }, ...places.map((p) => ({ label: p.name, icon: p.here ? ICONS.desktop : ICONS.laptop, act: p.slug, disabled: !p.online, hint: p.online ? (p.here ? 'this Mac' : '') : 'offline' }))], (home) => {
      const name = editing
      if (close()) onMove?.(name, home)
    })
  }

  function moreMenu(anchor) {
    popMenu(anchor, [
      { label: 'Export…', icon: ICONS.export, act: 'export', hint: '.crew file' },
      { label: 'Move to another computer…', icon: ICONS.move, act: 'move', disabled: !(state.computers?.links ?? []).some((l) => l.online) && !draft.home },
      '-',
      { label: 'Remove…', icon: ICONS.trash, act: 'remove', danger: true },
    ], async (act) => {
      if (act === 'export') exportAgents([editing])
      if (act === 'move') moveMenu(anchor)
      if (act === 'remove' && confirm(`Remove ${draft.name || editing}? Its session stops (the transcript stays with the CLI).`)) {
        await crew.call('removeAgent', editing)
        close(true)
      }
    })
  }

  // The agent's own brain drafts its instructions; the creature hops while it writes.
  async function write() {
    const msg = card.querySelector('.pd-msg')
    const btn = card.querySelector('[data-act=write]')
    const box = card.querySelector('.pd-prompt')
    if (!draft.name.trim()) return void (msg.textContent = 'Give it a name first')
    if (draft.prompt.trim() && !confirm('Replace the current instructions with a fresh draft?')) return
    const label = providerOf(draft.provider).label
    btn.disabled = true
    btn.querySelector('span').textContent = `${label} is writing…`
    box.classList.add('writing')
    card.querySelector('.pd-av .av')?.classList.add('working')
    msg.textContent = ''
    try {
      const { name, area, provider, model, cwd } = draft
      box.value = draft.prompt = await crew.call('draftPrompt', { name: slug(name), area, provider, model, cwd, home: draft.home })
      syncSave()
      msg.textContent = 'Drafted ✓ (review it, then Save)'
    } catch (err) {
      msg.textContent = `Couldn't write it: ${err.message}`
    } finally {
      btn.disabled = false
      btn.querySelector('span').textContent = 'Write it'
      box.classList.remove('writing')
      drawAvatar(true)
    }
  }

  async function save() {
    if (!dirty()) return
    const msg = card.querySelector('.pd-msg')
    msg.textContent = ''
    try {
      if (!original) {
        const { on, ...fields } = draft
        reopen = await crew.call('addAgent', { ...fields, off: !on }) // a name@computer when it runs elsewhere
        store.set('crew.yolo', draft.yolo ? '1' : '0')
      } else {
        const patch = {}
        for (const k of FIELDS) if (JSON.stringify(draft[k]) !== JSON.stringify(original[k])) patch[k] = draft[k]
        if (draft.on !== original.on) patch.off = !draft.on
        if (JSON.stringify(draft.avatar) !== JSON.stringify(original.avatar)) patch.avatar = draft.avatar
        if (Object.keys(patch).length) await crew.call('update', editing, patch)
        reopen = 'name' in patch ? qualified(slug(draft.name), draft.home) : editing
      }
    } catch (err) {
      msg.textContent = err.message
    }
  }

  document.addEventListener('keydown', (e) => {
    if (editing && e.metaKey && e.key === 's') return void (e.preventDefault(), save())
    if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open], .menu, .mentions:not(.hidden)')) return
    if (editing) return void (e.preventDefault(), close())
    if (selecting && root.offsetParent) setSelecting(false)
  })

  return {
    render(next) {
      state = next
      drawGrid()
      if (reopen && agentNamed(reopen)) {
        const name = reopen
        reopen = null
        open(name, { at: tab })
        drawAvatar(true)
        card.querySelector('.pd-msg').textContent = 'Saved ✓'
      } else if (editing && editing !== ':new' && !agentNamed(editing)) {
        editing = null
        sheet.classList.remove('open')
      } else if (editing) {
        drawState()
        drawLevel()
        drawExperience()
        drawConvo()
        if (!card.querySelector('.limit')?.contains(document.activeElement)) drawLimit()
      }
    },
    open,
    create: () => open(null),
  }
}

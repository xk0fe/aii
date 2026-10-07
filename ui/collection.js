// The crew as a collection: a Pokédex of agent cards. Click a card to open it and edit everything about
// the agent (brain, folder, flags, look). "Select" turns on bulk mode to change many agents at once.
/* global crew, store, esc, nameHTML, clonesOf, cloneTag, displayName, contextRing, contextTip, ctxLevel, tokenCount, plural, avatarHTML, avatarOf, colorOf, randomAvatar, statusText, mountAttach, morph, segmented, bounce, celebrate, duration, levelOf, ago, PARTS, COLORS, ICONS */

const LIGHT = new Set(['yellow', 'lime', 'mint', 'sky', 'peach'])
const pad = (n) => String(n).padStart(3, '0')
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
const FIELDS = ['name', 'area', 'prompt', 'images', 'provider', 'model', 'effort', 'tier', 'cwd', 'args', 'yolo', 'contextLimit', 'onContextLimit', 'clones']
// How many clones an agent may run at once (core/hub.js MAX_CLONES).
const CLONES = [1, 2, 3, 4, 5]
// Context limits offered as one tap (only those below the model's window show); any other number can be typed.
const LIMITS = [100000, 150000, 200000, 250000, 400000, 600000]
// An agent's full name as the crew knows it: on another computer it carries that computer's name.
const qualified = (name, home) => (home ? `${name}@${home}` : name)

function mountCollection(root, { onTerminal, onImport }) {
  root.innerHTML = `
    <section class="col-list">
      <header class="col-head">
        <div><h2>Your crew</h2><p class="col-sub"></p></div><span class="grow"></span>
        <div class="seg" data-mode-switch><button data-mode="cards">Cards</button><button data-mode="stats">Stats</button></div>
        <button class="btn" data-act="import" title="Add agents from a .crew file (or drop one on the window)">${ICONS.import}Import</button>
        <button class="btn" data-act="select">Select</button>
        <button class="btn primary" data-act="new">${ICONS.plus}New agent</button>
      </header>
      <div class="col-grid"></div>
      <div class="col-stats"></div>
      <div class="bulk"></div>
    </section>
    <section class="col-card"></section>`
  const $ = (s) => root.querySelector(s)
  const grid = $('.col-grid')
  const card = $('.col-card')
  const bulk = $('.bulk')
  const list = $('.col-list')
  const picked = new Set()
  // View Transitions move the creature from its card into the editor and back; without them, a plain fade.
  const canMorph = typeof document.startViewTransition === 'function'
  let state = null
  let gridKey = ''
  let selecting = false
  let mode = store.get('crew.collection') || 'cards'
  let sortBy = 'tasks'
  let editing = null // agent name, or ':new'
  let original = null
  let draft = null
  let reopen = null // name to open once it shows up in state (after add/rename)
  let transitioning = false

  const agentNamed = (name) => state.agents.find((a) => a.name === name)
  const roster = () => state.agents.filter((a) => !a.cloneOf) // the crew's cards: agents, not their clones
  const providerOf = (id) => state.providers[id] ?? { label: id, models: [], efforts: [] }
  const effortsFor = (d) => providerOf(d.provider).modelEfforts?.[d.model] ?? providerOf(d.provider).efforts ?? []

  // ---- grid ------------------------------------------------------------------

  function cardHTML(a, i) {
    const look = avatarOf(a)
    const chips = [providerOf(a.provider).label, [a.model, a.effort].filter(Boolean).join(' · ')].filter(Boolean).map((c) => `<span>${esc(c)}</span>`).join('')
    const modes = (a.fast ? `<span class="pc-fast" title="Fast: Codex's fast service tier">${ICONS.bolt}</span>` : '') + (a.yolo ? '<span class="pc-yolo" title="YOLO: skips every permission prompt">YOLO</span>' : '')
    // its clones at work peek out from behind it, smaller, each with its number
    const clones = a.on ? clonesOf(state.agents, a) : []
    const litter = clones.length ? `<span class="pc-clones" style="--n:${clones.length}">${clones.map((c, j) => `<span class="pc-clone" style="--j:${j}" title="${esc(`${displayName(c)}: ${statusText(c)}${c.activity ? ` · ${c.activity}` : ''}`)}">${avatarHTML(c, { size: 50 })}${cloneTag(c)}</span>`).join('')}</span>` : ''
    const doing = a.on && a.activity && (a.status === 'working' || a.status === 'waiting') ? `<span class="pc-doing">${esc(a.activity)}</span>` : ''
    return `<button class="pcard hop ${LIGHT.has(look.color) ? 'light' : ''} ${a.on ? a.status : 'off'} ${picked.has(a.name) ? 'picked' : ''} ${clones.length ? 'has-clones' : ''}" data-name="${esc(a.name)}" style="--c:${colorOf(look)}; --clones:${clones.length}">
      <span class="pc-mark">${ICONS.mark}</span>
      <span class="pc-no"><b title="${levelOf(a.stats).xp} XP">Lv ${levelOf(a.stats).lv}</b><span>#${pad(i + 1)}</span></span>
      <span class="pc-name">${nameHTML(a)}</span>
      <span class="pc-area" title="${esc(a.area)}">${esc(a.area || 'No area yet. Open the card to set one.')}</span>
      ${modes ? `<span class="pc-modes">${modes}</span>` : ''}
      <span class="pc-chips">${chips}</span>
      <span class="pc-state" title="${esc(statusText(a))}"><span><span class="dot ${a.status}"></span><span>${esc(statusText(a))}</span>${contextRing(a)}</span>${doing}</span>
      ${litter}<span class="pc-av">${avatarHTML(a, { size: 104 })}</span>
      <span class="pc-check">✓</span>
    </button>`
  }

  function drawGrid() {
    if (transitioning) return
    root.classList.toggle('stats-mode', mode === 'stats')
    segmented($('[data-mode-switch]'), (b) => b.dataset.mode === mode)
    if (mode === 'stats') drawStatsTable()
    const next = JSON.stringify([selecting, [...picked], roster().map((a) => [a.name, a.status, a.activity, a.provider, a.model, a.effort, a.yolo, a.fast, a.on, a.avatar, levelOf(a.stats).lv, a.convo?.context?.pct, a.convo?.compactions, clonesOf(state.agents, a).map((c) => [c.name, c.status, c.activity])])])
    if (next === gridKey) return
    gridKey = next
    morph(grid, roster().map(cardHTML).join('') + `<button class="pcard add" data-act="new"><b>${ICONS.plus}</b>New agent</button>`)
    celebrate(grid, state.agents)
    const on = roster().filter((a) => a.on).length
    $('.col-sub').textContent = roster().length ? `${roster().length} agents · ${on} on` : 'Start with one agent per area of work'
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
  // ...and the creature in the open card watches the pointer.
  card.addEventListener('pointermove', (e) => {
    const hero = card.querySelector('.pd-hero')
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

  // 👑 best in a column, 🐢 slowest (for the "lower is better" timing columns)
  function standouts(metric) {
    const rows = roster().filter((a) => (metric.has ?? ((s) => s[metric.key] > 0))(a.stats))
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
    const rows = roster().sort((x, y) => (value(x) - value(y)) * (metric.better === 'high' ? -1 : 1))
    const marks = Object.fromEntries(METRICS.map((m) => [m.key, standouts(m)]))
    const maxOf = Object.fromEntries(METRICS.map((m) => [m.key, Math.max(0, ...roster().map((a) => a.stats[m.key] || 0))]))
    const sparkMax = Math.max(1, ...roster().flatMap((a) => a.stats.days.map((d) => d.tasks)))
    // morph, not innerHTML: rows animate in once, and bars glide to new values instead of redrawing
    morph($('.col-stats'), `<table class="stats-table"><thead><tr><th>Agent</th>${METRICS.map((m) => `<th data-sort="${m.key}" class="${m.key === sortBy ? 'on' : ''}" title="${m.better === 'high' ? 'more is better' : 'less is better'}">${m.label}</th>`).join('')}<th>14 days</th></tr></thead><tbody>${
      rows.map((a) => `<tr data-name="${esc(a.name)}" class="${a.on ? '' : 'off'}" style="--c:${colorOf(avatarOf(a))}">
        <td class="who" title="${esc(a.area)}">${avatarHTML(a, { size: 30, mood: 'still' })}<span><b>${nameHTML(a)}</b><small title="last active">Lv ${levelOf(a.stats).lv} · ${!a.stats.last ? 'no work yet' : Date.now() - a.stats.last < 60000 ? 'just now' : `${ago(a.stats.last)} ago`}</small></span></td>
        ${METRICS.map((m) => {
          const s = a.stats
          const has = (m.has ?? (() => true))(s)
          const mark = marks[m.key].best === a.name ? ' 👑' : marks[m.key].worst === a.name ? ' 🐢' : ''
          return `<td title="${esc(m.tip?.(s) ?? '')}">${has ? `<span>${m.show(s)}${mark}</span>${bar(s[m.key], maxOf[m.key])}` : '<span class="na">–</span>'}</td>`
        }).join('')}
        <td>${sparkline(a.stats.days, sparkMax)}</td></tr>`).join('')
    }</tbody></table>
    <p class="stats-note">👑 best in the column · 🐢 slowest · bars compare against the busiest agent · counted since each agent's first task</p>`)
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
      roster().forEach((a) => picked.add(a.name))
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

  // ---- card (detail + editor) ------------------------------------------------

  // `home` opens it set to run on another computer ('' = this one), which Save turns into a move.
  function open(name, { home } = {}) {
    const a = name && agentNamed(name)
    original = a
      ? { name: a.seed ?? a.name, home: a.home ?? '', area: a.area ?? '', prompt: a.prompt ?? '', images: a.images ?? [], provider: a.provider ?? 'claude', model: a.model ?? '', effort: a.effort ?? '', tier: a.tier ?? '', cwd: a.cwd ?? '', args: a.args ?? '', yolo: a.yolo, on: a.on, avatar: avatarOf(a), contextLimit: a.contextLimit ?? '', onContextLimit: a.onContextLimit ?? 'fresh', clones: a.clones || '' }
      : null
    draft = original
      ? structuredClone(original)
      : { name: '', home: '', area: '', prompt: '', images: [], provider: 'claude', model: '', effort: '', tier: '', cwd: '', args: '', yolo: store.get('crew.yolo') === '1', on: true, avatar: randomAvatar(), contextLimit: '', onContextLimit: 'fresh', clones: '' }
    if (home !== undefined) draft.home = home
    editing = a ? a.name : ':new'
    if (selecting) setSelecting(false)
    morphTo(a?.name, 'open', () => {
      drawCard()
      root.classList.add('detail')
      card.scrollTop = 0
    })
    if (!a) setTimeout(() => card.querySelector('.pd-name')?.focus(), 250)
  }

  function close() {
    if (dirty() && !confirm('Discard your changes?')) return
    const name = editing
    editing = null
    morphTo(name, 'close', () => root.classList.remove('detail'))
  }

  // Card <-> editor as one motion: the card grows into the editor's header and its creature travels with it.
  // Elements share a view-transition-name only for the length of the transition.
  function morphTo(name, dir, update) {
    const tile = name && mode === 'cards' ? grid.querySelector(`.pcard[data-name="${CSS.escape(name)}"]`) : null
    const already = dir === 'open' && root.classList.contains('detail') // e.g. reopening after Save
    if (!canMorph || !tile?.getClientRects().length || already || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update()
      if (dir === 'open' && !already) card.querySelector('.pd')?.classList.add('enter') // the plain fade-up
      return
    }
    const parts = (inCard) => (inCard
      ? [[tile, 'pd-hero'], [tile.querySelector('.av'), 'pd-av']]
      : [[card.querySelector('.pd-hero'), 'pd-hero'], [card.querySelector('.pd-av .av'), 'pd-av']])
    const tag = (pairs, on) => pairs.forEach(([el, n]) => el && (el.style.viewTransitionName = on ? n : ''))
    if (dir === 'close' && tile.offsetTop < list.scrollTop) list.scrollTop = Math.max(0, tile.offsetTop - 90)
    let from = parts(dir === 'open')
    tag(from, true)
    transitioning = true // a redraw now would drop the names or swap the creature out from under the snapshot
    root.classList.add('vt')
    const t = document.startViewTransition(() => {
      tag(from, false)
      update()
      from = parts(dir !== 'open')
      tag(from, true)
    })
    t.finished.finally(() => {
      tag(from, false)
      root.classList.remove('vt')
      transitioning = false
      gridKey = ''
      drawGrid()
    })
  }

  const dirty = () => (original ? JSON.stringify(draft) !== JSON.stringify(original) : Boolean(draft?.name.trim()))

  function drawCard() {
    const d = draft
    const live = agentNamed(editing)
    const i = roster().findIndex((x) => x.name === editing)
    card.innerHTML = `
      <div class="pd">
        <div class="pd-hero">
          <button class="icon pd-back" data-act="back" title="Back to the crew (Esc)">${ICONS.back}</button>
          <span class="pd-state"></span>
          <span class="pd-mark">${ICONS.mark}</span>
          <div class="pd-av"></div>
        </div>
        <div class="pd-sheet">
          <div class="pd-title">
            <input class="pd-name" data-k="name" value="${esc(d.name)}" placeholder="name" spellcheck="false" autocomplete="off">
            <span class="pd-no">${i >= 0 ? `#${pad(i + 1)}` : 'new'}</span>
          </div>
          <textarea class="pd-area" data-k="area" rows="2" placeholder="What does it own? e.g. 3D character: rig, animations, materials">${esc(d.area)}</textarea>
          <h4>Work experience <span class="h4-note xp-since"></span></h4>
          <div class="experience"></div>
          <h4>Conversation <span class="h4-note convo-since"></span></h4>
          <div class="convo"></div>
          <div class="limit"></div>
          <h4>Clones <span class="h4-note">more than one task at a time</span></h4>
          <div class="clones-set"></div>
          <h4>Instructions <button class="btn small" data-act="write">✨ Write it</button><span class="h4-note">its system prompt, on top of the crew basics</span></h4>
          <textarea class="pd-prompt" data-k="prompt" rows="7" placeholder="How this agent works: what it owns, its quality bar, conventions, when to hand off. Leave it empty, or let ✨ write a first draft from the name and area.">${esc(d.prompt)}</textarea>
          <div class="refs"><button type="button" class="btn small" data-ref>+ Reference image</button><span class="h4-note">mockups, brand guides, screenshots… paste or drop them on the instructions too</span></div>
          <div class="thumbs refs-thumbs hidden"></div>
          <h4>Brain</h4>
          <div class="brain"></div>
          <h4>Look <button class="btn small" data-act="shuffle">🎲 Shuffle</button></h4>
          <div class="look"></div>
          <footer class="pd-foot">
            ${live ? `<button class="btn" data-act="terminal">Open terminal</button><button class="btn" data-act="export" title="Save it as a .crew file to share">Export</button><button class="btn danger" data-act="remove">Remove</button>` : ''}
            <span class="grow"></span><span class="pd-msg"></span><span class="pd-dirty">Unsaved changes</span>
            <button class="btn" data-act="back">Cancel</button>
            <button class="btn primary" data-act="save">${live ? 'Save' : 'Add to crew'}</button>
          </footer>
        </div>
      </div>`
    drawState()
    drawExperience()
    drawConvo()
    drawLimit()
    drawClones()
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

  // Pokédex-style base stats: this agent against the busiest one in the crew.
  function drawExperience() {
    const host = card.querySelector('.experience')
    const a = agentNamed(editing)
    if (!host) return
    if (!a || !a.stats.tasks) {
      host.innerHTML = '<p class="xp-empty">No work yet. Send it a task and its stats start counting.</p>'
      return
    }
    const s = a.stats
    const lv = levelOf(s)
    card.querySelector('.xp-since').textContent = s.first ? `since ${new Date(s.first).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''
    host.innerHTML = `
      <div class="xp"><span class="lv">Lv ${lv.lv}</span><i class="xpbar"><b style="width:${Math.round(lv.progress * 100)}%"></b></i><span class="h4-note">${lv.xp} XP · ${lv.toNext} to Lv ${lv.lv + 1}</span></div>
      <div class="base-stats">${METRICS.map((m) => {
        const has = (m.has ?? (() => true))(s)
        const max = Math.max(0, ...roster().map((x) => x.stats[m.key] || 0))
        const mark = standouts(m)
        return `<div class="bs-row" title="${esc(m.tip?.(s) ?? '')}"><span class="bs-label">${m.label}</span><b>${has ? m.show(s) : '–'}${mark.best === a.name ? ' 👑' : mark.worst === a.name ? ' 🐢' : ''}</b>${has ? bar(s[m.key], max) : '<i class="mbar"></i>'}</div>`
      }).join('')}</div>
      <div class="bs-row"><span class="bs-label">Last 14 days</span>${sparkline(s.days)}</div>`
  }

  // How full its current conversation is, and a way to start a new one. Long conversations with many
  // unrelated tasks are where agents start mixing things up.
  function drawConvo() {
    const host = card.querySelector('.convo')
    if (!host) return
    const a = agentNamed(editing)
    const c = a?.convo
    if (!a || !c) {
      host.innerHTML = `<p class="xp-empty">${a ? 'No conversation yet. It starts one with its first task.' : 'It starts a conversation with its first task.'}</p>`
      return
    }
    const ctx = c.context
    const level = ctx ? ctxLevel(ctx.pct) : 'calm'
    const advice = !a.on ? 'It picks this conversation up when it comes back on.'
      : ctx?.limit && level !== 'calm' ? (a.onContextLimit === 'notify' ? `Getting close to its ${tokenCount(ctx.limit)} limit. You'll get a heads-up when it passes.` : `It starts a new conversation by itself once it passes ${tokenCount(ctx.limit)}.`)
      : c.compactions ? `It ran out of room ${c.compactions === 1 ? 'once' : `${c.compactions} times`} and summarized older details. A new conversation gives it a clean slate.`
      : level === 'hot' ? 'Nearly full: it will soon summarize older details to make room. Start fresh before its next task.'
      : level === 'warm' ? 'Getting long. Start fresh before giving it something unrelated.'
      : 'Plenty of room.'
    card.querySelector('.convo-since').textContent = c.since ? `since ${new Date(c.since).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''
    morph(host, `
      <div class="convo-card ${level}">
        <div class="convo-gauge">${ctx && a.on ? contextRing(a, { label: false, size: 54 }) : '<span class="ctx calm" style="--s:54px"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.6" class="ctx-track"/></svg></span>'}<b>${ctx ? `${ctx.pct}%` : '–'}</b></div>
        <div class="convo-info">
          <div class="convo-nums">${ctx ? `<b>${tokenCount(ctx.used)}</b> of ${ctx.limit ? `its ${tokenCount(ctx.limit)} limit (${tokenCount(ctx.window)} window)` : `${tokenCount(ctx.size)} tokens`}` : 'Not measured yet'} · ${plural(c.tasks, 'task')}${c.compactions ? ` · compacted ${c.compactions}×` : ''}</div>
          <p>${esc(advice)}</p>
        </div>
        <button class="btn convo-fresh" data-act="fresh" ${a.freshPending ? 'disabled' : ''} title="${esc(contextTip(a))}">${ICONS.fresh}${a.freshPending ? 'When it’s free…' : 'New conversation'}</button>
      </div>`)
  }

  // Its own context limit, below the model's window, and what happens when the conversation passes it.
  function drawLimit() {
    const host = card.querySelector('.limit')
    if (!host) return
    const a = agentNamed(editing)
    const ctx = a?.convo?.context
    const win = ctx?.window ?? ctx?.size // the model's real window, once it has reported one
    const limit = Number(draft.contextLimit) || 0
    const pill = (k, v, label, on) => `<button class="pill ${on ? 'on' : ''}" data-v="${v}">${label}</button>`
    const presets = LIMITS.filter((n) => !win || n < win)
    const custom = limit && !presets.includes(limit)
    const fresh = draft.onContextLimit !== 'notify'
    const past = limit && ctx && ctx.used >= limit
    const note = !limit ? `It can use the model's whole window${win ? ` (${tokenCount(win)})` : ''}. Long conversations full of unrelated tasks are where agents start mixing things up; a limit keeps it sharp.`
      : past ? (fresh ? `It's already past ${tokenCount(limit)}: once you save, it starts a new conversation as soon as it's free.` : `It's already past ${tokenCount(limit)}: you'll get a heads-up once you save.`)
      : fresh ? `At ${tokenCount(limit)} it finishes what it's doing and starts a new conversation. Its instructions, folder and the crew's notes stay; the old conversation stays in the CLI's history.`
      : `At ${tokenCount(limit)} you get a notification and a line in the chat, and decide when to start fresh.`
    host.innerHTML = `
      <div class="limit-row">
        <span class="limit-label">Context limit</span>
        <div class="pills small" data-pick="contextLimit">${pill('contextLimit', '', win ? `Full ${tokenCount(win)}` : 'Full window', !limit)}${presets.map((n) => pill('contextLimit', n, tokenCount(n), limit === n)).join('')}
          <label class="limit-custom ${custom ? 'on' : ''}"><input type="number" min="10" step="10" data-limit-k value="${custom ? Math.round(limit / 1000) : ''}" placeholder="Custom" title="Any limit, in thousands of tokens"><span>k</span></label></div>
      </div>
      <div class="limit-row ${limit ? '' : 'off'}">
        <span class="limit-label">When it's reached</span>
        <div class="pills small" data-pick="onContextLimit">${pill('onContextLimit', 'fresh', 'New conversation', fresh)}${pill('onContextLimit', 'notify', 'Just tell me', !fresh)}</div>
      </div>
      <p class="limit-note ${past ? 'past' : ''}">${esc(note)}</p>`
  }

  // Clones: busy with one task, it takes the next on a clone of itself instead of making it wait in its queue.
  function drawClones() {
    const host = card.querySelector('.clones-set')
    if (!host) return
    const a = agentNamed(editing)
    const n = Number(draft.clones) || 0
    const live = a ? clonesOf(state.agents, a) : []
    const pill = (v, label, on) => `<button class="pill ${on ? 'on' : ''}" data-v="${v}">${label}</button>`
    const name = draft.name.trim() || 'it'
    const note = !n ? `Busy with one task, ${name} makes the next one wait in its queue. With clones, a copy of ${name} takes it right away instead.`
      : `When ${name} is busy, a clone takes the next task: the same agent in a conversation of its own, up to ${n} at once. A clone with nothing left to do goes away after 5 minutes, and its work counts as ${name}'s. Clones share its folder, so they suit tasks that don't touch the same files.`
    morph(host, `<div class="limit-row">
        <span class="limit-label">Clones at once</span>
        <div class="pills small" data-pick="clones">${pill('', 'None', !n)}${CLONES.map((v) => pill(v, v, n === v)).join('')}</div>
      </div>
      <div class="clones-now">${live.length
        ? live.map((c) => `<button class="clone-chip ${c.status}" data-clone="${esc(c.name)}" title="Open its terminal">${avatarHTML(c, { size: 22 })}${cloneTag(c)}<span>${esc(c.activity && c.status === 'working' ? c.activity : statusText(c))}</span></button>`).join('')
        : `<span class="clones-none">${a?.on && n ? 'No clones at work right now.' : ''}</span>`}</div>
      <p class="limit-note">${esc(note)}</p>`)
  }

  function drawState() {
    const live = agentNamed(editing)
    const el = card.querySelector('.pd-state')
    if (el) el.innerHTML = live ? `<span class="dot ${live.status}"></span>${esc(statusText(live))}${live.pending ? ' · restarts when free' : ''}` : 'New agent'
  }

  function drawBrain() {
    const d = draft
    const p = providerOf(d.provider)
    const efforts = effortsFor(d)
    card.querySelector('.brain').innerHTML = `
      ${runsOnHTML(d)}
      <div class="pills" data-pick="provider">${Object.entries(state.providers)
        .map(([id, pr]) => `<button class="pill ${d.provider === id ? 'on' : ''}" data-v="${id}" title="${pr.missing?.length ? `needs ${pr.missing.join(', ')} in your environment` : ''}">${esc(pr.label)}${pr.missing?.length ? ' ⚠︎' : ''}</button>`)
        .join('')}</div>
      <div class="pd-stats">
        <label class="stat"><span>Model</span><input data-k="model" list="pd-models" value="${esc(d.model)}" placeholder="default" autocomplete="off">
          <datalist id="pd-models">${p.models.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></label>
        <div class="stat"><span>Effort</span>${
          efforts.length
            ? `<div class="pills small" data-pick="effort">${['', ...efforts].map((v) => `<button class="pill ${d.effort === v ? 'on' : ''}" data-v="${v}">${v || 'default'}</button>`).join('')}</div>`
            : '<em>set by the model</em>'
        }</div>
        <label class="stat wide"><span>Folder</span><div class="pick"><input data-k="cwd" value="${esc(d.cwd)}" placeholder="~/code/my-app" autocomplete="off"><button type="button" class="btn" data-act="pick">Choose…</button></div></label>
        ${p.fastByDefault === undefined ? '' : `<label class="stat toggle fast"><span><i class="glyph">${ICONS.bolt}</i><span>Fast mode<small>Codex's fast service tier${d.tier ? '' : ' (following your Codex config)'}</small></span></span><input type="checkbox" class="switch" data-fast-tier ${(d.tier ? d.tier === 'fast' : p.fastByDefault) ? 'checked' : ''}></label>`}
        <label class="stat toggle yolo"><span><i class="glyph">!</i><span>YOLO<small>skip every permission prompt</small></span></span><input type="checkbox" class="switch" data-k="yolo" ${d.yolo ? 'checked' : ''}></label>
        <label class="stat toggle"><span><i class="glyph">${ICONS.power}</i><span>Power<small>on now and after restarts</small></span></span><input type="checkbox" class="switch" data-k="on" ${d.on ? 'checked' : ''}></label>
        <label class="stat wide"><span>Extra flags</span><input data-k="args" value="${esc(d.args)}" placeholder="passed straight to the CLI" autocomplete="off"></label>
      </div>`
  }

  // Which computer the agent runs on, once there's more than one. Picking another for an existing agent moves it
  // there on Save.
  function runsOnHTML(d) {
    const c = state.computers ?? { me: {}, links: [] }
    const places = [{ slug: '', name: c.me.name ?? 'This computer', online: true }, ...c.links]
    if (places.length < 2 && !d.home) return ''
    const shown = places.filter((p) => p.online || p.slug === d.home || p.slug === original?.home)
    const to = places.find((p) => p.slug === d.home)?.name ?? d.home
    const moving = original && d.home !== original.home
    return `<div class="runs-on"><span class="label">Runs on</span><div class="pills small" data-pick="home">${shown
      .map((p) => `<button class="pill ${d.home === p.slug ? 'on' : ''}" data-v="${esc(p.slug)}" ${p.online ? '' : 'disabled title="unreachable right now"'}>${esc(p.name)}${p.slug ? '' : ' (this one)'}</button>`)
      .join('')}</div>
      ${moving ? `<p class="move-note">Moves to <b>${esc(to)}</b> when you save. Its instructions, look and work experience go along; its conversation starts fresh there. Check the folder below exists on ${esc(to)}.</p>` : ''}</div>`
  }

  // A character creator: every option is shown as a tiny version of this agent wearing it.
  function drawLook() {
    const s = draft.avatar
    const name = draft.name || 'new'
    const opt = (k, v) => `<button class="opt ${s[k] === v ? 'on' : ''}" data-look="${k}" data-v="${v}" title="${v}">${avatarHTML({ name, avatar: { ...s, [k]: v } }, { size: 50, mood: 'still' })}</button>`
    const row = (title, k) => `<div class="look-row"><span>${title}</span><div class="opts">${PARTS[k].map((v) => opt(k, v)).join('')}</div></div>`
    card.querySelector('.look').innerHTML =
      row('Body', 'body') +
      `<div class="look-row"><span>Color</span><div class="opts">${PARTS.color.map((c) => `<button class="swatch ${s.color === c ? 'on' : ''}" data-look="color" data-v="${c}" style="--sw:${COLORS[c]}" title="${c}"></button>`).join('')}</div></div>` +
      row('Eyes', 'eyes') + row('Mouth', 'mouth') + row('Extras', 'hat') +
      `<div class="look-row"><span>Blush</span><div class="opts"><input type="checkbox" class="switch" data-look="cheeks" ${s.cheeks ? 'checked' : ''}></div></div>`
  }

  function drawAvatar(hop = false) {
    const pd = card.querySelector('.pd')
    pd.style.setProperty('--c', colorOf(draft.avatar))
    pd.classList.toggle('light', LIGHT.has(draft.avatar.color))
    const live = agentNamed(editing)
    const host = card.querySelector('.pd-av')
    const mood = live?.status === 'working' || live?.status === 'waiting' ? undefined : 'idle'
    host.innerHTML = avatarHTML({ name: draft.name || 'new', avatar: draft.avatar, status: live?.status }, { size: 200, mood })
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
      card.querySelector('.limit-row + .limit-row')?.classList.toggle('off', !draft.contextLimit)
      return syncSave()
    }
    const k = e.target.dataset.k
    if (!k) return
    draft[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    if (k === 'model') drawEffortOnly()
    if (k === 'name') drawClones()
    syncSave()
  })

  // Changing model can change which efforts exist (Codex models differ); redraw just that bit.
  function drawEffortOnly() {
    const efforts = effortsFor(draft)
    if (!efforts.includes(draft.effort)) draft.effort = ''
    const stat = card.querySelector('[data-pick=effort]')?.closest('.stat') ?? card.querySelector('.stat em')?.closest('.stat')
    if (!stat) return
    stat.innerHTML = `<span>Effort</span>${
      efforts.length ? `<div class="pills small" data-pick="effort">${['', ...efforts].map((v) => `<button class="pill ${draft.effort === v ? 'on' : ''}" data-v="${v}">${v || 'default'}</button>`).join('')}</div>` : '<em>set by the model</em>'
    }`
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
    const pill = e.target.closest('[data-pick] .pill')
    if (pill && pill.closest('[data-pick]').dataset.pick === 'clones') {
      draft.clones = Number(pill.dataset.v) || ''
      drawClones()
      return syncSave()
    }
    const clone = e.target.closest('[data-clone]')
    if (clone) return onTerminal(clone.dataset.clone)
    if (pill && ['contextLimit', 'onContextLimit'].includes(pill.closest('[data-pick]').dataset.pick)) {
      const k = pill.closest('[data-pick]').dataset.pick
      draft[k] = k === 'contextLimit' ? Number(pill.dataset.v) || '' : pill.dataset.v
      drawLimit()
      return syncSave()
    }
    if (pill) {
      const k = pill.closest('[data-pick]').dataset.pick
      if (k === 'provider' && draft.provider !== pill.dataset.v) Object.assign(draft, { model: '', effort: '', tier: '' })
      draft[k] = pill.dataset.v
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
    if (act === 'terminal') onTerminal(editing)
    if (act === 'export') exportAgents([editing])
    if (act === 'fresh') {
      try {
        await crew.call('freshStart', editing)
        card.querySelector('.pd-msg').textContent = 'New conversation ✓'
      } catch (err) {
        card.querySelector('.pd-msg').textContent = err.message
      }
    }
    if (act === 'remove' && confirm(`Remove ${editing}? Its session stops (the transcript stays with the CLI).`)) {
      await crew.call('removeAgent', editing)
      editing = null
      root.classList.remove('detail')
    }
    if (act === 'save') save()
    if (act === 'write') write()
  })

  // The agent's own brain drafts its instructions; the creature hops while it writes.
  async function write() {
    const msg = card.querySelector('.pd-msg')
    const btn = card.querySelector('[data-act=write]')
    const box = card.querySelector('.pd-prompt')
    if (!draft.name.trim()) return void (msg.textContent = 'Give it a name first')
    if (draft.prompt.trim() && !confirm('Replace the current instructions with a fresh draft?')) return
    const label = providerOf(draft.provider).label
    btn.disabled = true
    btn.textContent = `✨ ${label} is writing…`
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
      btn.textContent = '✨ Write it'
      box.classList.remove('writing')
      drawAvatar(true)
    }
  }

  async function save() {
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
        let name = editing
        if (draft.home !== original.home) {
          // reference images are files on the computer it leaves; the move carries the saved ones
          if ('images' in patch) throw new Error('Save the reference image changes first, then move it')
          msg.textContent = 'Moving…'
          name = await crew.call('moveAgent', editing, draft.home, draft.cwd)
          delete patch.cwd
          msg.textContent = ''
        }
        if (Object.keys(patch).length) await crew.call('update', name, patch)
        reopen = 'name' in patch ? qualified(slug(draft.name), draft.home) : name
      }
    } catch (err) {
      msg.textContent = err.message
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !root.offsetParent) return
    if (editing) close()
    else if (selecting) setSelecting(false)
  })

  return {
    render(next) {
      state = next
      drawGrid()
      if (reopen && agentNamed(reopen)) {
        const name = reopen
        reopen = null
        open(name)
        drawAvatar(true)
        card.querySelector('.pd-msg').textContent = 'Saved ✓'
      } else if (editing && editing !== ':new' && !agentNamed(editing)) {
        editing = null
        root.classList.remove('detail')
      } else if (editing) {
        drawState()
        drawExperience()
        drawConvo()
        drawClones()
        if (!card.querySelector('.limit')?.contains(document.activeElement)) drawLimit()
      }
    },
    open,
    create: () => open(null),
  }
}

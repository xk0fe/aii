// The clique as a collection: one line saying how things are on top, then a card per agent, grouped by the computer
// each one runs on, in your order (turning one off or on never moves its card). Cards come big
// or compact (compact by default once the clique outgrows a screen), or as a Stats table. Click a card to open its
// sheet: who it is on the left (creature, name, area, a few facts), everything you can set on the right, in four
// tabs. "Select" (in the header's ⋯) turns on bulk mode to change many agents at once.
/* global stopButton, glowBedHTML, reduceMotion, DUR, EASE, shownName, pageHead, markSVG, powerSwitch, patchSVG, firstRoomHTML, poseOf, statusWord, askTypes, brainWords, helpersText, activityWords, clique, store, esc, statusClass, nameHTML, clonesOf, cloneTag, displayName, contextRing, contextTip, ctxLevel, usageLine, tokenCount, plural, money, spentText, linesText, spendLine, spendTip, SPEND_NOTE, avatarHTML, avatarOf, colorOf, randomAvatar, statusText, mountAttach, morph, segmented, bounce, celebrate, duration, levelOf, ago, cliqueGroups, grouped, popMenu, PARTS, COLORS, ICONS, wsTile, hasWorkspaces, shortPath, needsYou, needText, runningSubs, brainShort, brainLabel, keys, commandKey, THIS_COMPUTER, tildePath, oops, errorLine */

const LIGHT = new Set(['yellow', 'lime', 'mint', 'sky', 'peach'])
const pad = (n) => String(n).padStart(3, '0')
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
const FIELDS = ['name', 'area', 'prompt', 'images', 'provider', 'model', 'effort', 'tier', 'cwd', 'args', 'yolo', 'contextLimit', 'onContextLimit', 'clones', 'account']
// How many clones an agent may run at once (core/hub.js MAX_CLONES).
const CLONES = [1, 2, 3, 4, 5]
// Context limits offered as one tap (only those below the model's window, at most four); any other can be typed.
const LIMITS = [100000, 150000, 200000, 250000, 400000, 600000]
const limitPresets = (win) => {
  const under = LIMITS.filter((n) => !win || n < win)
  return under.length > 4 ? [100000, 250000, 400000, 600000].filter((n) => under.includes(n)) : under
}
// An agent's full name as the clique knows it: on another computer it carries that computer's name.
const qualified = (name, home) => (home ? `${name}@${home}` : name)
const TABS = [
  { id: 'setup', label: 'Setup', icon: ICONS.brain },
  { id: 'instructions', label: 'Instructions', icon: ICONS.doc },
  { id: 'look', label: 'Look', icon: ICONS.palette },
  { id: 'stats', label: 'Stats', icon: ICONS.chart },
]
// at work: what it's doing says more than its status. Waiting on a teammate, the status says it (who it waits on).
const atWork = (a) => (a?.status === 'working' && !a.waitingOn?.length) || a?.status === 'waiting'
function mountCollection(root, { headIn = root, onTerminal, onImport, onMove, onWorkspace, onRenamed, onAccounts }) {
  // the header: in the dashboard's row of place headers (common.js pageHead), like every place's
  headIn.insertAdjacentHTML('beforeend', pageHead({
    id: 'clique', glyph: markSVG('0 4 24 18'), title: 'Agents',
    tools: `<div class="seg icons" data-mode-switch><button data-mode="cards" title="Cards" aria-label="Cards">${ICONS.grid}</button><button data-mode="tiles" title="Compact cards" aria-label="Compact cards">${ICONS.tiles}</button><button data-mode="stats" title="Stats: compare the clique" aria-label="Stats">${ICONS.table}</button></div>
      <button class="btn" data-act="new" title="${esc(keysIn('New agent (⌘N)'))}">${ICONS.plus}<span>New agent</span></button>
      <button class="icon" data-act="more" title="Select, export, import" aria-label="More" aria-haspopup="menu">${ICONS.more}</button>`,
  }))
  const head = headIn.lastElementChild
  root.innerHTML = `
    <section class="col-list">
      <div class="col-grid"></div>
      <div class="col-stats"></div>
      <div class="col-empty empty-state hidden"></div>
    </section>
    <div class="bulk bulk-bar"></div>`
  // The sheet lives at the top of the page, over everything (sidebar and chat included), not inside the view.
  const sheet = document.createElement('div')
  sheet.className = 'ed-layer'
  sheet.innerHTML = '<div class="ed-scrim" data-act="back"></div><section class="ed" role="dialog" aria-modal="true" tabindex="-1"></section>'
  document.body.append(sheet)
  sheet.querySelector('.ed-scrim').addEventListener('click', () => close())
  const $ = (s) => root.querySelector(s)
  const grid = $('.col-grid')
  const card = sheet.querySelector('.ed')
  const bulk = $('.bulk')
  const list = $('.col-list')
  const empty = $('.col-empty')
  const picked = new Set()
  let state = null
  let gridKey = ''
  let selecting = false
  // cards, tiles (compact) or stats. Until you pick, compact once the clique is bigger than a screenful of cards.
  let mode = store.get('clique.collection')
  let sortBy = 'tasks'
  let editing = null // agent name, or ':new'
  let original = null
  let draft = null
  let tab = 'setup'
  let advOpen = false // the Setup tab's Advanced fold
  let modelTyping = false // the Model row is a text field (a model the menu doesn't list)
  let reopen = null // name to open once it shows up in state (after add/rename)
  let stage = false // a new agent opens as a stage (drawStage), until More settings turns it into the sheet
  let bringing = false // Bring in was pressed: it's being added, and lands once it shows up in state

  const modeNow = () => mode ?? (state.agents.length > 9 ? 'tiles' : 'cards')
  const agentNamed = (name) => state.agents.find((a) => a.name === name)
  const roster = () => state.agents.filter((a) => !a.cloneOf) // the clique's cards: agents, not their clones
  const providerOf = (id) => state.providers[id] ?? { label: id, models: [], efforts: [] }
  const effortsFor = (d) => providerOf(d.provider).modelEfforts?.[d.model] ?? providerOf(d.provider).efforts ?? []

  // ---- grid ------------------------------------------------------------------

  // What it's waiting on you for, by agent (needsYou: its open question or prompt), and the type of each one's open
  // question. Refreshed with each grid draw.
  let needsByName = new Map()
  let asksByName = new Map()

  // What it's doing, in plain words, under its status: its step while it works, what it wants (or asks) while it
  // needs you, the question it put to a teammate while it waits on one. Its helpers are a count of their own.
  // { text, tip } or null.
  function doingOf(a) {
    if (!a.on) return null
    const subs = runningSubs(a)
    const subsTip = subs.map((s) => s.description || s.type || 'sub-agent').join('\n')
    if (a.status === 'waiting') {
      const text = needText(needsByName.get(a.name) ?? { agent: a, ask: null })
      return { text, tip: text }
    }
    if (a.waitingOn?.length && a.status === 'working') return a.waitingOn[0].text ? { text: `“${a.waitingOn[0].text}”`, tip: a.waitingOn[0].text } : null
    if (atWork(a) && a.activity) return { text: activityWords(a.activity), tip: [a.activity, subsTip].filter(Boolean).join('\n') }
    if (!subs.length) return null
    if (a.status === 'idle') return { text: 'Its helpers are still working', tip: subsTip }
    return null
  }
  // The context ring only once the conversation is nearly full; calm, it's a number in the sheet.
  const hotRing = (a, opts) => (ctxLevel(a.convo?.context?.pct ?? 0) === 'hot' ? contextRing(a, opts) : '')

  // A card: its creature (which acts out how it is), its name and switch, its job, and one line saying what it's doing
  // (berry while it needs you), with its context only once it's nearly full. Its brain, YOLO, how long, its helpers and
  // clones and what's queued are in the card's tooltip, and all of it in its sheet.
  function cardHTML(a) {
    const look = avatarOf(a)
    const what = doingOf(a)
    const ask = asksByName.get(a.name)
    const clones = a.on ? clonesOf(state.agents, a) : []
    const subs = runningSubs(a)
    const ctx = a.on ? a.convo?.context : null
    const since = a.on && (a.status === 'working' || a.status === 'waiting') && a.since ? ago(a.since) : ''
    const tip = [a.area, `${statusWord(a, ask)}${since && since !== 'just now' ? ` · ${since}` : ''}`, brainLabel(a, state.providers), a.yolo && 'YOLO: skips every permission prompt',
      subs.length && `${helpersText(a)}: ${subs.map((x) => x.description || x.type).join(', ')}`, clones.length && `${plural(clones.length, 'clone')} at work`, a.on && a.queue && `${plural(a.queue, 'message')} waiting`].filter(Boolean).join('\n')
    const needs = a.on && a.status === 'waiting'
    const line = what?.text ?? statusWord(a, ask)
    // its helpers (sub-agents and clones at work) huddle beside it, at laptops of their own
    const huddle = Math.min(3, subs.length + clones.length)
    const helpers = huddle ? `<span class="c2-helpers">${Array.from({ length: huddle }, (_, i) => avatarHTML({ ...a, name: `${a.name}·${i + 2}`, avatar: look, status: 'working', on: true }, { size: 42, mood: 'working', pose: 'laptop', poseMin: 40 })).join('')}</span>` : ''
    const pose = poseOf(a, { ask })
    return `<div class="pcard c2 ${a.on ? a.status : 'off'} ${picked.has(a.name) ? 'picked' : ''}" data-name="${esc(a.name)}" style="--c:${colorOf(look)}" role="button" tabindex="0" title="${esc(tip)}" aria-label="${esc(`${a.seed ?? a.name}: ${statusWord(a, ask)}`)}">
      <span class="c-name"><b>${esc(shownName(a.seed ?? a.name))}</b></span>
      <span class="pc-power">${powerSwitch(a)}</span>
      <span class="c-job">${esc(a.area || 'No job yet. Open the card to give it one.')}</span>
      <span class="c-state"><span class="c-line"><span class="c-doing${needs ? ' needs-text' : ''}">${esc(line)}</span>${stopButton(a, 'c-stop')}</span>${ctx && ctx.pct >= 80 ? `<span class="c-meta"><span class="c-ctx">${contextRing(a, { label: false, size: 13 })}Context ${ctx.pct}% full</span></span>` : ''}</span>
      <span class="c2-stage felt${huddle ? ' has-helpers' : ''}">${patchSVG(136, 136, { r: 8, inset: 5, dash: '4 3' })}<span class="c2-av">${avatarHTML(a, { size: huddle ? 92 : 112, pose })}</span>${helpers}${needs ? '<i class="dot needs c2-dot"></i>' : ''}</span>
      <span class="pick pc-check">${ICONS.check}</span>
    </div>`
  }

  // Compact: the creature, the name and how it is, in one line: its step while it works, otherwise its status (what
  // it wants from you is on hover). Its sub-agents and clones are counts beside its marks. Area and brain are a hover
  // away (and in its sheet).
  function tileHTML(a) {
    const look = avatarOf(a)
    const what = doingOf(a)
    const clones = a.on ? clonesOf(state.agents, a).length : 0
    const subs = runningSubs(a)
    const ask = asksByName.get(a.name)
    const line = atWork(a) && a.status !== 'waiting' && a.activity ? activityWords(a.activity) : statusWord(a, ask)
    const cls = !a.on ? 'off' : a.status === 'waiting' ? 'needs' : a.status === 'working' && !a.waitingOn?.length ? 'working' : a.status === 'starting' ? 'starting' : 'idle'
    const said = a.status === 'waiting' && a.on ? statusWord(a, ask) : line
    const tip = [a.seed ?? a.name, a.area, brainWords(a, state.providers), a.yolo && 'YOLO: skips every permission prompt', subs.length && helpersText(a), clones && plural(clones, 'clone'), what?.tip].filter(Boolean).join('\n')
    return `<div class="pcard mini ${a.on ? a.status : 'off'} ${picked.has(a.name) ? 'picked' : ''}" data-name="${esc(a.name)}" style="--c:${colorOf(look)}" title="${esc(tip)}" role="button" tabindex="0" aria-label="${esc(`${a.seed ?? a.name}: ${said}`)}">
      <span class="pc-name"><b>${esc(shownName(a.seed ?? a.name))}</b></span>
      <span class="pc-power">${powerSwitch(a)}</span>
      <span class="pc-line ${cls === 'needs' ? 'needs-text' : ''}"><i class="dot ${cls}"></i><span>${esc(said)}</span>${stopButton(a, 'c-stop')}</span>
      <span class="pc-av">${avatarHTML(a, { size: 56 })}</span>
      <span class="pick pc-check">${ICONS.check}</span>
    </div>`
  }

  function drawGrid() {
    const m = modeNow()
    root.classList.toggle('stats-mode', m === 'stats')
    segmented(head.querySelector('[data-mode-switch]'), (b) => b.dataset.mode === m)
    const groups = cliqueGroups(state)
    const needs = needsYou(state)
    needsByName = new Map(needs.map((n) => [n.agent.name, n]))
    asksByName = askTypes(state)
    drawHead()
    const none = !roster().some((a) => !a.system) // (every workspace has Q: this is about who you've brought in)
    root.classList.toggle('empty', none)
    empty.classList.toggle('hidden', !none)
    if (none) drawEmpty()
    if (m === 'stats') drawStatsTable()
    const next = JSON.stringify([m, selecting, [...picked], groups.map((g) => [g.key, g.name, g.online]), roster().map((a) => [a.name, a.status, a.since && Math.floor((Date.now() - a.since) / 60000), a.activity, a.provider, a.model, a.effort, a.yolo, a.fast, a.on, a.avatar, a.area, a.queue, a.convo?.context?.pct, a.convo?.compactions, doingOf(a), asksByName.get(a.name), runningSubs(a).length, clonesOf(state.agents, a).map((c) => [c.name, c.status, c.activity])])])
    if (next === gridKey) return
    gridKey = next
    const one = (a) => (m === 'tiles' ? tileHTML(a) : cardHTML(a))
    // in parts (see morph): a push that changes one agent re-reads its card alone
    const filled = groups.filter((g) => g.agents.length)
    // (this computer's agents need no heading; another computer's say where they are, as in the sidebar)
    const parts = grouped(groups) && filled.length
      ? filled.map((g) => ({
          start: `<section class="col-group" data-home="${esc(g.key)}">
          ${g.here ? '' : `<h3><b>On ${esc(g.name)}</b>${g.online ? '' : '<span>offline</span>'}</h3>`}
          <div class="col-cards ${m}">`,
          end: '</div></section>', slot: '.col-cards', parts: g.agents.map(one),
        }))
      : [{ start: `<div class="col-cards ${m}">`, end: '</div>', slot: '.col-cards', parts: roster().map(one) }]
    morph(grid, none ? '' : parts)
    celebrate(grid, state.agents)
    root.classList.toggle('selecting', selecting)
    drawBulkCount()
  }

  // The header: Agents, who they are and how many are on (what needs you is in the chat and beside each name in the
  // sidebar: here it's the clique itself).
  function drawHead() {
    // (no line under it: who's on is each card's switch, and the cards are everyone here)
    const cliqueNow = roster()
    const on = cliqueNow.filter((a) => a.on).length
    head.querySelector('.ph-name').title = cliqueNow.length ? `${on} of ${cliqueNow.length} on` : 'Nobody yet'
  }

  // ---- no clique yet: one creature pops up in an empty room and asks who it should be ----

  let emptyKey = ''
  function drawEmpty() {
    // anyone to pick? With nobody on your roster yet, it's your first agent, whichever workspace you're in
    const ws = state.roster?.length ? state.workspace : null
    const next = JSON.stringify([ws?.id, ws?.name])
    if (next === emptyKey) return
    emptyKey = next
    empty.innerHTML = ws
      ? `${firstRoomHTML()}<h1 class="display">Who works on ${esc(ws.name)}?</h1>
        <p class="lead">Pick teammates for it in its settings, or make an agent only it needs. Everyone keeps their own creature.</p>
        <div class="acts"><button class="btn primary lg" data-act="new">Add an agent</button><button class="btn lg" data-act="ws-settings">Workspace settings</button></div>`
      : `${firstRoomHTML()}<h1 class="display">Let’s build your clique</h1>
        <p class="lead">Each agent is a teammate with a job, a model and a creature of its own. Start with one; you can add more any time.</p>
        <div class="acts"><button class="btn primary lg" data-act="new">Add your first agent</button><button class="btn lg" data-act="import">Import agents</button></div>`
  }
  empty.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'new') open(null)
    if (act === 'import') onImport()
    if (act === 'ws-settings') onWorkspace?.()
  })
  // The creature in the open sheet watches the pointer.
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
    if (!c || e.target.closest('.pc-power')) return // its on/off switch: handled with every other power switch (common.js)
    if (c.dataset.act === 'new') return open(null)
    if (!selecting) return open(c.dataset.name)
    picked[picked.has(c.dataset.name) ? 'delete' : 'add'](c.dataset.name)
    drawGrid()
  })
  // a card is a button to the keyboard too: Enter or Space opens it (or picks it while selecting)
  grid.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches?.('.pcard[data-name]')) return
    e.preventDefault()
    e.target.click()
  })
  // ⋯ in the header: a new agent (also the dashed card, the sidebar's + and ⌘N or Ctrl+N), picking several agents, the whole clique
  // as a .clique file, and bringing agents in from one.
  function headMenu(anchor) {
    const out = roster().filter((a) => a.status !== 'away') // an asleep computer can't pack its agents
    popMenu(anchor, [
      { label: selecting ? 'Done selecting' : 'Select…', icon: ICONS.task, act: 'select', disabled: !selecting && modeNow() === 'stats', hint: !selecting && modeNow() === 'stats' ? 'in the card views' : 'change several at once' },
      '-',
      { label: 'Export the clique…', icon: ICONS.export, act: 'export', disabled: !out.length, hint: out.length ? `${plural(out.length, 'agent')} · .clique` : '' },
      { label: 'Import…', icon: ICONS.import, act: 'import', hint: 'or drop a .clique file' },
    ], (act) => {
      if (act === 'new') open(null)
      if (act === 'select') setSelecting(!selecting)
      if (act === 'export') exportAgents(out.map((a) => a.name))
      if (act === 'import') onImport()
    })
  }

  head.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]')
    if (btn?.dataset.act === 'more') headMenu(btn)
    if (btn?.dataset.act === 'new') open(null)
    const m = e.target.closest('[data-mode]')?.dataset.mode
    if (m) {
      mode = m
      store.set('clique.collection', m)
      if (m === 'stats' && selecting) setSelecting(false)
      gridKey = ''
      drawGrid()
    }
  })

  // ---- stats: compare the clique side by side ----------------------------------------

  // better: which direction wins ('none': no winner, just more first). has: whether an agent has data for it (no turns
  // yet means no average). table: false keeps it to the agent's own Stats tab (the table is wide enough as it is).
  const METRICS = [
    { key: 'tasks', label: 'Tasks', better: 'high', show: (s) => s.tasks, tip: (s) => `${s.fromYou} from you · ${s.fromTeam} from teammates` },
    {
      key: 'cost', label: 'Spent', better: 'none', show: (s) => spentText(s, { short: true }), has: (s) => s.cost >= 0.005 || s.tokens > 0,
      tip: (s) => [s.cost >= 0.005 && `${money(s.costToday)} today`, s.costPerTask >= 0.005 && `${money(s.costPerTask)} a task`, linesText(s), s.cost >= 0.005 ? SPEND_NOTE : 'Codex reports tokens, not money'].filter(Boolean).join(' · '),
    },
    { key: 'costPerTask', label: 'Per task', better: 'low', table: false, show: (s) => money(s.costPerTask), has: (s) => s.costPerTask >= 0.005, tip: () => `what a task costs it on average. ${SPEND_NOTE}` },
    { key: 'activeMs', label: 'Active', better: 'high', show: (s) => duration(s.activeMs) },
    { key: 'avgTurnMs', label: 'Avg turn', better: 'low', show: (s) => duration(s.avgTurnMs), has: (s) => s.turns > 0 },
    { key: 'tools', label: 'Tool calls', better: 'high', show: (s) => s.tools },
    { key: 'handoffs', label: 'Hand-offs', better: 'high', show: (s) => s.handoffs, tip: (s) => `made ${s.handoffs} · received ${s.fromTeam}` },
    { key: 'waits', label: 'Needs you', better: 'low', show: (s) => s.waits, tip: (s) => `waited ${duration(s.waitMs)} on you in total` },
    { key: 'avgQueueMs', label: 'Queue wait', better: 'low', show: (s) => duration(s.avgQueueMs), has: (s) => s.fromYou + s.fromTeam > 0, tip: () => 'how long messages wait before it is free (busy agents wait longer)' },
  ]
  const BEST = `<i class="best" title="best in the clique">${ICONS.crown}</i>`
  const SLOW = `<i class="slow" title="slowest in the clique">${ICONS.snail}</i>`

  // best in a column, and slowest (for the "lower is better" timing columns)
  function standouts(metric) {
    if (metric.better === 'none') return {}
    const rows = roster().filter((a) => (metric.has ?? ((s) => s[metric.key] > 0))(a.stats))
    if (!rows.length) return {}
    const sorted = [...rows].sort((x, y) => (x.stats[metric.key] - y.stats[metric.key]) * (metric.better === 'high' ? -1 : 1))
    return { best: sorted[0].name, worst: metric.better === 'low' && metric.key.endsWith('Ms') && sorted.length > 1 ? sorted.at(-1).name : null }
  }

  function bar(value, max) {
    return `<i class="mbar"><b style="width:${max ? Math.max(4, Math.round((value / max) * 100)) : 0}%"></b></i>`
  }

  function sparkline(days, max = Math.max(1, ...days.map((d) => d.tasks))) {
    return `<span class="spark" title="tasks per day, last 14 days">${days.map((d) => `<i style="height:${Math.max(8, Math.round((d.tasks / max) * 100))}%" class="${d.tasks ? 'on' : ''}" title="${d.day}: ${d.tasks} task${d.tasks === 1 ? '' : 's'}"></i>`).join('')}</span>`
  }

  function drawStatsTable() {
    const COLUMNS = METRICS.filter((m) => m.table !== false)
    const metric = COLUMNS.find((m) => m.key === sortBy) ?? COLUMNS[0]
    const value = (a) => ((metric.has ?? (() => true))(a.stats) ? a.stats[metric.key] : metric.better === 'low' ? Infinity : -1)
    const rows = roster().sort((x, y) => (value(x) - value(y)) * (metric.better === 'low' ? 1 : -1))
    const marks = Object.fromEntries(COLUMNS.map((m) => [m.key, standouts(m)]))
    const maxOf = Object.fromEntries(COLUMNS.map((m) => [m.key, Math.max(0, ...roster().map((a) => a.stats[m.key] || 0))]))
    const sparkMax = Math.max(1, ...roster().flatMap((a) => a.stats.days.map((d) => d.tasks)))
    // morph, not innerHTML: rows animate in once, and bars glide to new values instead of redrawing
    const sp = spendLine(state.spend)
    morph($('.col-stats'), `${sp ? `<p class="stats-spend" title="${esc(spendTip(state.spend))}">The clique: <b>${sp}</b> · last 7 days ${money(state.spend.week)} · 30 days ${money(state.spend.month)}</p>` : ''}<table class="stats-table"><thead><tr><th>Agent</th>${COLUMNS.map((m) => `<th data-sort="${m.key}" class="${m.key === sortBy ? 'on' : ''}" title="${{ high: 'more is better', low: 'less is better' }[m.better] ?? ''}">${m.label}</th>`).join('')}<th>14 days</th></tr></thead><tbody>${
      rows.map((a) => `<tr data-name="${esc(a.name)}" class="${a.on ? '' : 'off'}" style="--c:${colorOf(avatarOf(a))}">
        <td class="who" title="${esc(a.area)}">${avatarHTML(a, { size: 30, mood: 'still' })}<span><b>${nameHTML(a)}</b><small title="last active">${!a.stats.last ? 'No work yet' : Date.now() - a.stats.last < 60000 ? 'Active just now' : `Active ${ago(a.stats.last)} ago`}</small></span></td>
        ${COLUMNS.map((m) => {
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

  // The bulk bar (common.css .bulk-bar), floating over the cards: who's picked, what to change for all of them (left
  // as it is unless you pick something), Export and Apply, and × to stop selecting.
  function drawBulk() {
    const providers = Object.entries(state.providers).filter(([, p]) => p.added !== false)
    const efforts = [...new Set(providers.flatMap(([, p]) => p.efforts))]
    const models = [...new Set(providers.flatMap(([, p]) => p.models))]
    // a choice as a field, like the sheet's Model: its name until you pick, a chevron at its end
    const field = (k, name, options, tip = '') => `<label class="bulk-field"${tip ? ` title="${esc(tip)}"` : ''}><select data-b="${k}" aria-label="${name}"><option value="">${name}</option>${options}</select><i>${ICONS.updown}</i></label>`
    bulk.innerHTML = `
      <span class="bulk-count"></span>
      <button class="btn plain" data-act="all" title="Pick every agent">All</button>
      <div class="bulk-fields">
        ${field('provider', 'Provider', providers.map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`).join(''))}
        <label class="bulk-field"><input data-b="model" placeholder="Model" list="bulk-models" aria-label="Model" autocomplete="off" spellcheck="false"></label><datalist id="bulk-models">${models.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
        ${field('effort', 'Effort', `<option value="-">default</option>${efforts.map((v) => `<option>${v}</option>`).join('')}`)}
        ${field('yolo', 'YOLO', '<option value="1">YOLO on</option><option value="0">YOLO off</option>')}
        ${field('tier', 'Fast', '<option value="fast">Fast on</option><option value="default">Fast off</option>', 'Codex agents only')}
        ${field('power', 'Power', '<option value="1">Turn on</option><option value="0">Turn off</option>')}
      </div>
      <button class="btn" data-act="export" title="Save the picked agents as a .clique file to share">${ICONS.export}<span>Export</span></button>
      <button class="btn primary" data-act="apply"></button>
      <button class="icon" data-act="done" title="Done selecting (Esc)" aria-label="Done selecting">${ICONS.close}</button>`
    drawBulkCount()
  }

  function drawBulkCount() {
    const count = bulk.querySelector('.bulk-count')
    if (!count) return
    const names = [...picked]
    count.innerHTML = names.length
      ? `<span class="bulk-faces">${names.slice(0, 4).map((n) => avatarHTML(agentNamed(n) ?? { name: n }, { size: 24, mood: 'still' })).join('')}</span><span><b>${names.length}</b> selected</span>`
      : 'Tap cards to pick them'
    const apply = bulk.querySelector('[data-act=apply]')
    apply.disabled = bulk.querySelector('[data-act=export]').disabled = !names.length
    apply.textContent = names.length ? `Apply to ${names.length}` : 'Apply'
  }

  bulk.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'done') return setSelecting(false)
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
    await clique.call('update', names, patch)
    setSelecting(false)
    cheer(names)
  })

  // A .clique file with these agents: their definitions, looks and reference images (not their folders or chats).
  async function exportAgents(names) {
    names = names.filter((n) => !agentNamed(n)?.system) // he comes with every workspace: he isn't yours to pack
    if (!names.length) return null
    try {
      return await clique.call('exportAgents', names)
    } catch (err) {
      oops(`Couldn't export ${names.length === 1 ? names[0].split('@')[0] : 'the clique'}`, err)
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
  // force: reopening after a save (a new agent or a renamed one), where the draft is what was just saved
  function open(name, { home, at, force = false } = {}) {
    if (!force && editing && name !== editing && dirty() && !confirm('Discard your changes?')) return
    const a = name && agentNamed(name)
    original = a
      ? { name: a.seed ?? a.name, home: a.home ?? '', area: a.area ?? '', prompt: a.prompt ?? '', images: a.images ?? [], provider: a.provider ?? 'claude', model: a.model ?? '', effort: a.effort ?? '', tier: a.tier ?? '', cwd: a.cwd ?? '', args: a.args ?? '', yolo: a.yolo, on: a.on, avatar: avatarOf(a), contextLimit: a.contextLimit ?? '', onContextLimit: a.onContextLimit ?? 'fresh', clones: a.clones || '', account: a.account ?? '' }
      : null
    draft = original
      ? structuredClone(original)
      : { name: '', home: '', area: '', prompt: '', images: [], provider: 'claude', model: '', effort: '', tier: '', cwd: '', args: '', yolo: store.get('clique.yolo') === '1', on: true, avatar: randomAvatar(), contextLimit: '', onContextLimit: 'fresh', clones: '', shared: '', account: '' }
    if (home !== undefined && !a) draft.home = home
    editing = a ? a.name : ':new'
    stage = !a && !force
    bringing = false
    tab = at ?? (a ? store.get('clique.edTab') || 'setup' : 'setup')
    if (!a && tab === 'stats') tab = 'setup'
    if (selecting) setSelecting(false)
    // reopening after a save keeps the sheet as you left it: Advanced unfolded, scrolled where it was
    if (!force) advOpen = false
    modelTyping = false
    const scrolled = force && sheet.classList.contains('open') ? card.querySelector('.ed-pane.on')?.scrollTop ?? 0 : 0
    const opening = !sheet.classList.contains('open')
    morphTo(a?.name, 'open', () => {
      drawCard()
      if (scrolled) card.querySelector('.ed-pane.on').scrollTop = scrolled
      sheet.classList.add('open')
    })
    // the keyboard goes with it: into the sheet, and not to the cards behind it (their switches would turn agents off
    // under the sheet) until it closes
    list.inert = true
    if (opening && !card.contains(document.activeElement)) card.focus({ preventScroll: true })
    if (!a) setTimeout(() => card.querySelector('.na-name, .pd-name')?.focus(), 250)
  }

  function close(force = false) {
    if (!force && dirty() && !confirm('Discard your changes?')) return false
    const name = editing
    editing = null
    morphTo(name, 'close', () => sheet.classList.remove('open'))
    list.inert = false
    // focus back where it came from: the agent's card (when the keyboard was in the sheet)
    if (!document.activeElement || document.activeElement === document.body || card.contains(document.activeElement)) {
      const from = name && grid.querySelector(`.pcard[data-name="${CSS.escape(name)}"]`)
      if (from) from.focus({ preventScroll: true })
      else document.activeElement?.blur?.()
    }
    return true
  }

  // Card <-> sheet: the sheet rises over a fading scrim and sinks back, quicker (collection.css .ed-layer). Opacity and
  // transforms only: nothing is snapshotted or stretched, and the grid keeps drawing underneath.
  function morphTo(name, dir, update) {
    update()
  }

  const dirty = () => (original ? JSON.stringify(draft) !== JSON.stringify(original) : Boolean(draft?.name.trim()))

  // ---- a new agent: the stage -----------------------------------------------------------
  // Someone new stands on the glow, big, and one line asks who it is: a name, what it does, Bring in. A click on it
  // (or Another look) gives it another look. Everything else it could be set to waits behind More settings, which
  // turns the stage into the sheet below with what's been typed kept. Pushes from the app never redraw it, so what
  // you're typing stays put.
  function drawStage() {
    const d = draft
    card.innerHTML = `
      <div class="na">
        <button class="icon sheet-x" data-act="back" title="Close (Esc)" aria-label="Close">${ICONS.close}</button>
        <div class="na-stage">${glowBedHTML()}
          <button class="na-av" data-act="shuffle" title="Another look" aria-label="Another look"></button>
          <button class="btn sm na-roll" data-act="shuffle">${ICONS.dice}<span>Another look</span></button>
        </div>
        <h2 class="na-line">Who’s joining?</h2>
        <label class="na-handle" title="Its name is how you call it: write @ and its name in any message"><span aria-hidden="true">@</span><input class="na-name" data-k="name" value="${esc(d.name)}" placeholder="name" maxlength="40" spellcheck="false" autocomplete="off" aria-label="Name"></label>
        <input class="na-area" data-k="area" value="${esc(d.area)}" placeholder="What does it do? Drafts, checks facts, builds screens…" autocomplete="off" aria-label="What it does">
        <div class="na-setup">
          <div class="ed-list group-list brain" aria-label="Its brain"></div>
          <div class="ed-list group-list behave na-modes" aria-label="How it works"></div>
        </div>
        <p class="pd-msg na-msg" role="alert"></p>
        <button class="btn lg brand-btn na-go" data-act="bring"></button>
        <button class="btn plain na-more" data-act="settings" title="Its folder, computer, instructions and the rest">More settings</button>
      </div>`
    drawStageAvatar('starting')
    drawBrain() // which brain it runs on is part of who it is: picked here, not behind More settings (and YOLO, Fast)
    syncStage()
  }

  // how: 'starting' as it arrives, 'pop' for another look, 'cheer' once it's in
  function drawStageAvatar(how) {
    const host = card.querySelector('.na-av')
    if (!host) return
    host.innerHTML = avatarHTML({ name: 'new', avatar: draft.avatar }, { size: 140, mood: how === 'starting' ? 'starting' : 'idle' })
    if (how !== 'starting') bounce(host.querySelector('.av'), how)
  }

  function syncStage() {
    const go = card.querySelector('.na-go')
    if (!go) return
    const name = draft.name.trim()
    go.textContent = name ? `Bring in ${name}` : 'Bring in'
    go.disabled = !name || bringing
  }

  // More settings: the same draft, in the full sheet.
  function stageToSheet() {
    stage = false
    drawCard()
    if (!reduceMotion()) card.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: DUR.move, easing: EASE.out })
    card.querySelector('.pd-name')?.focus({ preventScroll: true })
  }

  // It's in: it cheers, the stage closes, and it travels to its card here (or its row in the sidebar, from another
  // view), as the first run's stage is carried into the app (ui/setup.js carry). Without motion, or with nowhere to
  // go, the stage simply closes.
  function land(name) {
    bringing = false
    if (!card.querySelector('.na-av') || reduceMotion()) return void close(true)
    drawStageAvatar('cheer')
    const av = card.querySelector('.na-av .av')
    const spot = () => [`.col-grid .pcard[data-name="${CSS.escape(name)}"] .av`, `.side [data-agent="${CSS.escape(name)}"] .dm-av`].map((q) => document.querySelector(q)).find((el) => el?.getClientRects().length)
    setTimeout(() => {
      if (editing !== ':new' || !stage) return // closed meanwhile
      const from = av.getBoundingClientRect()
      const to = spot()
      const end = to?.getBoundingClientRect()
      if (!from.width || !end?.width) return void close(true)
      const layer = Object.assign(document.createElement('div'), { className: 'fr-carry' })
      const el = Object.assign(document.createElement('span'), { className: 'fr-carried', innerHTML: av.outerHTML })
      el.style.transform = `translate(${from.left}px, ${from.top}px)`
      layer.append(el)
      document.body.append(layer)
      av.style.visibility = 'hidden'
      to.style.visibility = 'hidden'
      close(true)
      requestAnimationFrame(() => requestAnimationFrame(() => (el.style.transform = `translate(${end.left}px, ${end.top}px) scale(${end.width / from.width})`)))
      setTimeout(() => {
        to.style.visibility = ''
        const there = spot() // the grid may have redrawn while it travelled
        if (there) there.style.visibility = ''
        layer.remove()
        bounce(there?.matches('.av') ? there : there?.querySelector('.av'), 'pop')
      }, 760)
    }, 460)
  }

  function drawCard() {
    card.classList.toggle('ed-stage', stage)
    if (stage) return drawStage()
    const d = draft
    const live = agentNamed(editing)
    // Q comes with every workspace (core/system-agent.js): you pick his brain, and the rest is who he is
    const sys = Boolean(live?.system)
    card.classList.toggle('ed-system', sys)
    if (sys && (tab === 'instructions' || tab === 'look')) tab = 'setup'
    card.innerHTML = `
      <aside class="ed-id">
        <div class="ed-top"><span class="pd-state"></span></div>
        <button class="ed-av felt" ${sys ? 'disabled' : 'data-tab="look" title="Change its look"'}>${patchSVG(256, 220, { r: 10, inset: 6, dash: '5 3.5' })}<span class="pd-av"></span><i class="ed-av-edit">${ICONS.palette}</i></button>
        <input class="pd-name" data-k="name" value="${esc(sys ? shownName(d.name) : d.name)}" placeholder="Name" spellcheck="false" autocomplete="off" aria-label="Name" ${sys ? 'readonly' : ''}>
        <textarea class="pd-area" data-k="area" rows="2" placeholder="What does it own? e.g. Checkout: the cart, payments and coupons" aria-label="Area of work" ${sys ? 'readonly' : ''}>${esc(d.area)}</textarea>
        <div class="ed-facts"></div>
        <span class="grow"></span>
        ${live ? `<div class="ed-id-acts">
          <button class="btn" data-act="terminal" ${live.on ? '' : 'disabled'} title="Open its terminal">${ICONS.terminal}<span>Terminal</span></button>
          <button class="btn" data-act="more" title="Export, move, remove">${ICONS.more}<span>More</span></button>
        </div>` : ''}
      </aside>
      <div class="ed-main">
        <header class="ed-head">
          <div class="seg ed-tabs" role="tablist">${TABS.filter((t) => !sys || t.id === 'setup' || t.id === 'stats').map((t) => `<button role="tab" data-tab="${t.id}" ${t.id === 'stats' && !live ? 'disabled' : ''}>${t.icon}<span>${t.label}</span></button>`).join('')}</div>
          <button class="icon sheet-x ed-close" data-act="back" title="Close (Esc)" aria-label="Close">${ICONS.close}</button>
        </header>
        <div class="ed-panes">
          <section class="ed-pane" data-pane="setup">
            <h4 class="section-label">Brain</h4>
            <div class="ed-list group-list brain"></div>
            ${sys ? '<p class="ed-sys-note">Q comes with every workspace and works in an empty folder of his own, handing the work on to your agents. Turn him off and Auto picks by area instead.</p>' : ''}
            <h4 class="section-label not-sys">Where it works</h4>
            <div class="ed-list group-list where not-sys"></div>
            <h4 class="section-label not-sys">Behaviour</h4>
            <div class="ed-list group-list behave not-sys"></div>
            <div class="ed-adv group-list ${advOpen ? 'open' : ''}">
              <button class="ed-adv-head" data-act="advanced" aria-expanded="${advOpen}"><i class="ed-adv-chev">${ICONS.chevron}</i><b>Advanced</b><span class="ed-adv-sum"></span></button>
              <div class="ed-adv-body"><div class="limit"></div><div class="flags"></div></div>
            </div>
          </section>
          <section class="ed-pane" data-pane="instructions">
            <div class="ed-pane-head"><p>Its system prompt, on top of the clique basics: what it owns, its bar, when to hand off.</p><button class="btn" data-act="write" title="Its own brain drafts them from its name and area">${ICONS.sparkles}<span>Write it</span></button></div>
            <textarea class="pd-prompt" data-k="prompt" placeholder="Leave it empty, or press Write it for a first draft from the name and area." aria-label="Instructions">${esc(d.prompt)}</textarea>
            <div class="refs"><div class="thumbs refs-thumbs"></div><button type="button" class="btn" data-ref title="Mockups, brand guides, screenshots: paste or drop them on the instructions too">${ICONS.plus}<span>Reference image</span></button></div>
          </section>
          <section class="ed-pane" data-pane="look">
            <div class="ed-pane-head"><p>Every option shows ${esc(d.name || 'it')} wearing it.</p><button class="btn" data-act="shuffle">${ICONS.dice}<span>Shuffle</span></button></div>
            <div class="look"></div>
          </section>
          <section class="ed-pane" data-pane="stats"><div class="experience"></div></section>
        </div>
        <footer class="sheet-foot">
          <span class="pd-msg"></span><span class="grow"></span><span class="pd-dirty">Unsaved changes</span>
          <button class="btn" data-act="back">Cancel</button>
          <button class="btn primary" data-act="save" title="Save (${keys('⌘S')})">${live ? 'Save' : 'Add to the clique'}</button>
        </footer>
      </div>`
    drawTab()
    drawState()
    drawFacts()
    drawExperience()
    drawLimit()
    drawBrain()
    drawWhere()
    drawFlags()
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
    card.dataset.tab = tab // on Look, an agent that's off shows its colours: they're what you're choosing
  }

  function setTab(next) {
    if (next === tab) return
    tab = next
    if (editing !== ':new') store.set('clique.edTab', next)
    drawTab()
    if (next === 'instructions') card.querySelector('.pd-prompt')?.focus({ preventScroll: true })
  }

  // Under its name, a few plain facts: how full its conversation is (red only when nearly full), what it has cost,
  // and its helpers while they work (a clone opens its terminal). Numbers and charts live on the Stats tab.
  function drawFacts() {
    const host = card.querySelector('.ed-facts')
    const a = agentNamed(editing)
    if (!host) return
    if (!a) return void morph(host, '')
    const ctx = a.convo?.context
    const s = a.stats
    const fact = (label, value, { tip = '', cls = '' } = {}) => `<div class="ed-fact" title="${esc(tip)}"><span>${label}</span><b class="${cls}">${value}</b></div>`
    const subs = runningSubs(a)
    const clones = a.on ? clonesOf(state.agents, a) : []
    const spent = [spentText(s), s.tasks ? plural(s.tasks, 'task') : ''].filter(Boolean).join(' · ')
    morph(host,
      fact('Context', ctx ? `${ctx.pct}% full` : 'not measured yet', { tip: contextTip(a), cls: ctx ? (ctxLevel(ctx.pct) === 'hot' ? 'hot' : '') : 'quiet' }) +
      fact('Spent', spent || 'nothing yet', { tip: s.cost >= 0.005 ? SPEND_NOTE : '', cls: spent ? '' : 'quiet' }) +
      (subs.length ? fact('Sub-agents', `${subs.length} at work`, { tip: subs.map((x) => x.description || x.type).join('\n') }) : '') +
      (clones.length ? `<div class="ed-fact"><span>Clones</span><span class="ed-clone-faces">${clones.map((c) => `<button class="ed-clone ${c.status}" data-clone="${esc(c.name)}" title="${esc(`${displayName(c)}: ${c.activity && c.status === 'working' ? c.activity : statusText(c)}\nClick for its terminal`)}">${avatarHTML(c, { size: 24 })}${cloneTag(c)}</button>`).join('')}</span></div>` : ''))
  }

  // Pokédex-style base stats: this agent against the busiest one in the clique.
  function drawExperience() {
    const host = card.querySelector('.experience')
    const a = agentNamed(editing)
    if (!host) return
    if (!a || !a.stats.tasks) {
      morph(host, `<div class="xp-empty empty-state small">${ICONS.chart}<b>No work yet</b><span>Send it a task and its stats start counting.</span></div>${a ? convoHTML(a) : ''}`)
      return
    }
    const s = a.stats
    const lv = levelOf(s)
    // its level and its number in the clique live here, and only here
    const no = roster().findIndex((x) => x.name === a.name)
    morph(host, `
      <div class="xp-big"><span class="lv">Lv ${lv.lv}</span><div class="grow"><i class="xpbar"><b style="width:${Math.round(lv.progress * 100)}%"></b></i><span class="h4-note">${no >= 0 ? `#${pad(no + 1)} · ` : ''}${lv.xp} XP · ${lv.toNext} to Lv ${lv.lv + 1}${s.first ? ` · working since ${new Date(s.first).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</span></div></div>
      <div class="base-stats well">${METRICS.map((m) => {
        const has = (m.has ?? (() => true))(s)
        const max = Math.max(0, ...roster().map((x) => x.stats[m.key] || 0))
        const mark = standouts(m)
        return `<div class="bs-row" title="${esc(m.tip?.(s) ?? '')}"><span class="bs-label">${m.label}</span><b>${has ? m.show(s) : '–'}${mark.best === a.name ? BEST : mark.worst === a.name ? SLOW : ''}</b>${has ? bar(s[m.key], max) : '<i class="mbar"></i>'}</div>`
      }).join('')}</div>
      <div class="days well"><span class="bs-label">Tasks a day, last 14 days</span>${sparkline(s.days)}</div>
      ${convoHTML(a)}`)
  }

  // How full its current conversation is, its account's limits, and a way to start a new one. Long conversations
  // with many unrelated tasks are where agents start mixing things up.
  function convoHTML(a) {
    const c = a.convo
    if (!c) return ''
    const ctx = c.context
    const level = ctx ? ctxLevel(ctx.pct) : 'calm'
    const advice = !a.on ? 'It picks this conversation up when it comes back on.'
      : ctx?.limit && level !== 'calm' ? (a.onContextLimit === 'notify' ? `Close to its ${tokenCount(ctx.limit)} limit: you'll get a heads-up.` : `It starts fresh by itself past ${tokenCount(ctx.limit)}.`)
      : c.compactions ? `It ran out of room ${c.compactions === 1 ? 'once' : `${c.compactions} times`} and summarized older details.`
      : level === 'hot' ? 'Nearly full: start fresh before its next task.'
      : level === 'warm' ? 'Getting long. Start fresh before something unrelated.'
      : 'Plenty of room.'
    return `<div class="convo-stat well ${level}" title="${esc(contextTip(a))}">
        <div class="convo-gauge">${ctx && a.on ? contextRing(a, { label: false, size: 40 }) : '<span class="ctx calm" style="--s:40px"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.6" class="ctx-track"/></svg></span>'}<b>${ctx ? `${ctx.pct}%` : '–'}</b></div>
        <div class="convo-info">
          <span class="bs-label">This conversation</span>
          <div class="convo-nums">${ctx ? `<b>${tokenCount(ctx.used)}</b> of ${tokenCount(ctx.limit ?? ctx.size)}` : 'Not measured yet'} · ${plural(c.tasks, 'task')}</div>
          <p>${esc(advice)}</p>
          ${usageLine(a, state)}
        </div>
        <button class="btn convo-fresh" data-act="fresh" ${a.freshPending || !a.on ? 'disabled' : ''} title="${a.freshPending ? 'Starts a new conversation when it’s free' : 'A clean slate (the old one stays in its history)'}">${ICONS.fresh}<span>${a.freshPending ? 'When it’s free' : 'New conversation'}</span></button>
      </div>`
  }

  // A row of the grouped list: what it is on the left, the control on the right.
  const row = (label, control, { note = '', cls = '' } = {}) => `<div class="ed-row ${cls}"><span class="ed-label">${label}${note ? `<small>${note}</small>` : ''}</span><div class="ed-ctl">${control}</div></div>`
  // One choice of a few: the app's segmented control (common.css .seg, as the tabs above), filling its row unless it's
  // a short one. Which segment is on comes from the draft (drawPicks), so a pick slides the thumb over, as tabs do.
  const choices = (k, segments, { fill = true, tip = '' } = {}) => `<div class="seg ${fill ? 'fill' : ''}" data-pick="${k}"${tip ? ` title="${esc(tip)}"` : ''}>${segments}</div>`
  const choice = (v, label) => `<button type="button" data-v="${esc(v)}">${label}</button>`
  // The segment the draft has picked in each choice under host: none for an effort left to the model, the typed field
  // for a context limit that isn't one of the presets.
  function drawPicks(host = card) {
    for (const el of host.querySelectorAll('.seg[data-pick]')) {
      const k = el.dataset.pick
      if (k === 'contextLimit') {
        const limit = Number(draft.contextLimit) || 0
        const preset = [...el.querySelectorAll('button')].some((b) => (Number(b.dataset.v) || 0) === limit)
        segmented(el, (s) => (s.matches('.limit-custom') ? !preset : (Number(s.dataset.v) || 0) === limit), { none: true })
      } else if (k === 'clones') segmented(el, (s) => (Number(s.dataset.v) || 0) === (Number(draft.clones) || 0), { none: true })
      else if (k === 'onContextLimit') segmented(el, (s) => s.dataset.v === (draft.onContextLimit === 'notify' ? 'notify' : 'fresh'), { none: true })
      else if (k === 'shared') segmented(el, (s) => s.dataset.v === (draft.shared ? '1' : ''), { none: true })
      else segmented(el, (s) => s.dataset.v === String(draft[k] ?? ''), { none: true })
    }
  }
  // A switch row: the setting and a one-line hint on the left, the switch on the right. Clicking the row flips it.
  const switchRow = (label, hint, input, cls = '', tip = '') => `<label class="ed-row sw ${cls}" ${tip ? `title="${esc(tip)}"` : ''}><span class="ed-label">${label}<small>${hint}</small></span>${input}</label>`

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
    host.innerHTML =
      row('Context limit', choices('contextLimit', `${choice('', win ? `Full ${tokenCount(win)}` : 'Full')}${presets.map((n) => choice(n, tokenCount(n))).join('')}<label class="limit-custom"><input type="number" min="10" step="10" data-limit-k value="${custom ? Math.round(limit / 1000) : ''}" placeholder="Custom" title="Any limit, in thousands of tokens"><span>k</span></label>`)) +
      row('When it’s reached', choices('onContextLimit', choice('fresh', 'New conversation') + choice('notify', 'Just tell me')), { cls: 'when-row' }) +
      '<p class="limit-note"></p>' +
      // its provider's spend check-in (ui/dashboard.js drawCheckIn), as it stands: set for every agent on that provider
      (state.providers?.[draft.provider]?.meter ? row('Spend check-in', '<em class="checkin-read"></em>', { cls: 'checkin-row' }) : '') +
      `<div class="ed-row clones-row"><span class="ed-label">Clones at once<small>when it's busy</small></span><div class="ed-ctl">${choices('clones', choice('', 'None') + CLONES.map((v) => choice(v, v)).join(''))}</div></div>`
    syncLimit()
  }

  // What a pick in Advanced changes, in place (so the thumb slides): the picks, whether "When it's reached" applies,
  // the line under them, and what clones would do.
  function syncLimit() {
    const host = card.querySelector('.limit')
    if (!host) return
    const ctx = agentNamed(editing)?.convo?.context
    const limit = Number(draft.contextLimit) || 0
    const fresh = draft.onContextLimit !== 'notify'
    const past = Boolean(limit && ctx && ctx.used >= limit)
    drawPicks(host)
    host.querySelector('.when-row').classList.toggle('off', !limit)
    const note = host.querySelector('.limit-note')
    note.textContent = !limit ? `Long conversations full of unrelated tasks are where agents mix things up; a limit keeps it sharp.`
      : past ? (fresh ? `Already past ${tokenCount(limit)}: once you save, it starts fresh as soon as it's free.` : `Already past ${tokenCount(limit)}: you'll get a heads-up once you save.`)
      : fresh ? `At ${tokenCount(limit)} it finishes what it's doing and starts a new conversation.`
      : `At ${tokenCount(limit)} you get a notification and decide when to start fresh.`
    note.classList.toggle('past', past)
    const read = host.querySelector('.checkin-read')
    if (read) {
      const label = state.providers?.[draft.provider]?.label ?? draft.provider
      read.textContent = `${checkInSays(state, draft.provider)} · every ${label} agent`
      read.closest('.ed-row').title = `Set for every ${label} agent in the sidebar's ⋯ menu, under Spend check-in`
    }
    host.querySelector('.clones-row').title = clonesTip()
  }

  // Clones: busy with one task, it takes the next on a clone of itself (its own conversation) instead of making it
  // wait in its queue. The row says how many at once; the clones at work show on the left, under its level.
  function clonesTip() {
    const n = Number(draft.clones) || 0
    const name = draft.name.trim() || 'it'
    return !n ? `Busy with one task, ${name} makes the next one wait in its queue. With clones, a copy of ${name} takes it right away instead.`
      : `When ${name} is busy, a clone takes the next task: the same agent in a conversation of its own, up to ${n} at once. A clone with nothing left to do goes away after 5 minutes, and its work counts as ${name}'s. Clones share its folder, so they suit tasks that don't touch the same files.`
  }

  // Extra CLI flags, in Advanced with the rest of what you rarely touch.
  function drawFlags() {
    const host = card.querySelector('.flags')
    if (host) host.innerHTML = row('Extra flags', `<input class="ed-input field mono" data-k="args" value="${esc(draft.args)}" placeholder="passed straight to the CLI" autocomplete="off" spellcheck="false">`)
  }

  // Advanced, folded: the four settings in a few words, so you know what's in there without opening it.
  function drawAdvSummary() {
    const host = card.querySelector('.ed-adv-sum')
    if (!host) return
    const ctx = agentNamed(editing)?.convo?.context
    const win = ctx?.window ?? ctx?.size
    const limit = Number(draft.contextLimit) || 0
    const n = Number(draft.clones) || 0
    const flags = String(draft.args ?? '').split(/\s+/).filter((t) => t.startsWith('-')).length || (String(draft.args ?? '').trim() ? 1 : 0)
    host.textContent = [
      limit ? `${tokenCount(limit)} context, then ${draft.onContextLimit === 'notify' ? 'a heads-up' : 'a new conversation'}` : `Full ${win ? `${tokenCount(win)} ` : ''}context`,
      ...(agentNamed(editing)?.system ? [] : [n ? `up to ${plural(n, 'clone')}` : 'no clones', flags ? plural(flags, 'extra flag') : 'no extra flags']),
    ].join(' · ')
  }

  function setAdvanced(on) {
    advOpen = on
    const fold = card.querySelector('.ed-adv')
    fold.classList.toggle('open', on)
    fold.querySelector('.ed-adv-head').setAttribute('aria-expanded', String(on))
    // unfolded, it's below the fold of a short pane: bring it into view, leaving what's above where it was
    if (on) requestAnimationFrame(() => fold.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
  }

  function drawState() {
    const live = agentNamed(editing)
    const el = card.querySelector('.pd-state')
    if (el) el.innerHTML = live ? `<span class="dot ${!live.on ? 'off' : live.status === 'waiting' ? 'needs' : live.status === 'working' && !live.waitingOn?.length ? 'working' : 'idle'}"></span>${esc(statusWord(live, asksByName.get(live.name)))}${live.pending ? ' · restarts when free' : ''}` : 'New agent'
  }

  // The brain: one Model control (provider and model together, picked from a menu) and its efforts.
  function drawBrain() {
    const efforts = effortsFor(draft)
    card.querySelector('.brain').innerHTML =
      row('Model', modelControl(), { cls: 'model-row' }) +
      row('Effort', efforts.length ? effortChoices(efforts) : '<em>set by the model</em>', { cls: 'effort-row' }) +
      accountRow()
    drawPicks(card.querySelector('.brain'))
    drawBehaviour()
  }

  // Which sign-in it runs on, once its provider has more than its default one (Accounts): each has its own usage limits.
  // An agent on a linked computer runs on that computer's accounts, which are picked there.
  function accountRow() {
    if (draft.home) return ''
    const mine = (state.accounts ?? []).filter((x) => x.provider === draft.provider)
    if (mine.length < 2) return ''
    if (!mine.some((x) => x.id === draft.account)) draft.account = '' // (an account that's gone: its default)
    const tip = (x) => [x.own ? `${providerOf(draft.provider).label}'s own sign-in` : x.name, x.email, x.plan, x.signedIn === false && 'not signed in'].filter(Boolean).join(' · ')
    return row('Account', `${choices('account', mine.map((x) => `<button type="button" data-v="${esc(x.id)}" title="${esc(tip(x))}">${x.own ? 'Default' : esc(x.name)}</button>`).join(''), { fill: false })}<button type="button" class="btn sm plain ed-accounts" data-act="accounts" title="Add an account, or see who's signed in">Accounts…</button>`, { cls: 'account-row' })
  }

  function modelControl() {
    const p = providerOf(draft.provider)
    const warn = p.missing?.length ? `<small class="ed-model-warn" title="${esc(`${p.label} needs ${p.missing.join(', ')} in your shell environment`)}">⚠︎ needs ${esc(p.missing.join(', '))}</small>` : ''
    if (modelTyping) {
      return `<label class="ed-model typing"><span class="prov">${esc(p.label)} ·</span><input data-k="model" list="pd-models" value="${esc(draft.model)}" placeholder="a model name" autocomplete="off" spellcheck="false" aria-label="Model"><datalist id="pd-models">${p.models.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>${warn}</label>`
    }
    return `<button class="ed-model" data-act="model" aria-haspopup="menu" title="Pick the brain: a provider and its model"><span class="prov">${esc(p.label)} ·</span>${draft.model ? `<b>${esc(draft.model)}</b>` : '<span class="def">default model</span>'}${warn}<i class="ed-model-chev">${ICONS.updown}</i></button>`
  }

  // Effort: the model's own levels, none picked meaning its default. Picking the picked one again clears it.
  const effortChoices = (efforts) => choices('effort', efforts.map((v) => choice(v, v)).join(''), { tip: "Pick the selected one again for the model's default" })

  // The menu behind Model: every provider's known models, grouped, and a way to type one it doesn't list.
  function modelMenu(anchor) {
    const choices = []
    const items = []
    for (const [id, p] of Object.entries(state.providers)) {
      if (p.added === false && draft.provider !== id) continue // GLM and Ollama, until Add provider… (ui/setup.js)
      if (items.length) items.push('-')
      items.push({ head: p.missing?.length ? `${p.label} ⚠︎ needs ${p.missing.join(', ')}` : p.label })
      const models = draft.provider === id && draft.model && !p.models.includes(draft.model) ? [...p.models, draft.model] : p.models
      for (const m of ['', ...models]) {
        const on = draft.provider === id && draft.model === m
        items.push({ label: m || 'Default model', on, act: String(choices.length), hint: !m ? 'its CLI picks' : p.models.includes(m) ? '' : 'typed' })
        choices.push({ provider: id, model: m })
      }
    }
    items.push('-', { label: 'Type a model…', icon: ICONS.edit, act: 'type', hint: `for ${providerOf(draft.provider).label}` }, { label: 'Add provider…', icon: ICONS.plus, act: 'provider' })
    const menu = popMenu(anchor, items, (act) => {
      if (act === 'type') return typeModel()
      if (act === 'provider') return openAddProvider()
      const pick = choices[Number(act)]
      if (!pick) return
      if (pick.provider !== draft.provider) Object.assign(draft, { provider: pick.provider, effort: '', tier: '', account: '' }) // (an account is one provider's)
      draft.model = pick.model
      if (!effortsFor(draft).includes(draft.effort)) draft.effort = ''
      drawBrain()
      syncSave()
      card.querySelector('[data-act=model]')?.focus({ preventScroll: true })
    })
    menu.el.classList.add('ed-model-menu')
    // a long list stays on screen and scrolls rather than running off it
    const r = menu.el.getBoundingClientRect()
    if (r.bottom > innerHeight - 8) menu.el.style.maxHeight = `${Math.max(160, innerHeight - 8 - r.top)}px`
  }

  // A model the menu doesn't list: the Model row turns into a field until you're done typing.
  let typedFrom = ''
  function typeModel() {
    typedFrom = draft.model
    modelTyping = true
    card.querySelector('.model-row .ed-ctl').innerHTML = modelControl()
    const input = card.querySelector('.model-row input')
    input.focus()
    input.select()
  }
  function doneTyping() {
    if (!modelTyping) return
    modelTyping = false
    draft.model = draft.model.trim()
    const ctl = card.querySelector('.model-row .ed-ctl')
    if (ctl) ctl.innerHTML = modelControl()
    drawEffortOnly()
    syncSave()
  }

  // On, YOLO and Fast as plain switch rows, each only where the brain picked has it: Fast is Codex's, so it shows for a
  // Codex brain and isn't there (rather than greyed out) for any other. Every brain can run YOLO today.
  function drawBehaviour() {
    const d = draft
    const p = providerOf(d.provider)
    const fastKnown = p.fastByDefault !== undefined
    const fastOn = fastKnown && (d.tier ? d.tier === 'fast' : p.fastByDefault)
    // (the stage for a new agent leaves On out: it starts on, and More settings has the switch)
    card.querySelector('.behave').innerHTML =
      (stage ? '' : switchRow('On', onHint(), `<input type="checkbox" class="switch" data-k="on" ${d.on ? 'checked' : ''}>`)) +
      switchRow('YOLO', stage ? 'No permission prompts' : 'Skips every permission prompt', `<input type="checkbox" class="switch" data-k="yolo" ${d.yolo ? 'checked' : ''}>`, 'yolo') +
      (fastKnown ? switchRow('Fast', stage ? 'Codex’s fast tier' : `Codex's fast service tier${d.tier ? '' : ', as in your config'}`, `<input type="checkbox" class="switch" data-fast-tier ${fastOn ? 'checked' : ''}>`, 'fast') : '')
  }
  const onHint = () => `Stays ${draft.on ? 'on' : 'off'} after restarts`

  // Linked computers an agent can run on from here: the ones that have this workspace too.
  const linkedHere = (c) => (c.links ?? []).filter((l) => l.spaces?.includes(state.workspace?.id))

  // Its folder and which computer it runs on. An agent that exists moves with the move sheet (its conversation goes
  // along); a new one is simply made there.
  function drawWhere() {
    const d = draft
    const c = state.computers ?? { me: {}, links: [] }
    const places = [{ slug: '', name: c.me?.name || 'This computer', online: true, here: true }, ...linkedHere(c)]
    const live = agentNamed(editing)
    const at = places.find((p) => p.slug === (d.home ?? '')) ?? { name: d.home, online: false }
    const computer = places.length < 2 && !d.home ? ''
      : live
        ? row('Computer', `<span class="ed-pc">${at.here ? ICONS.desktop : ICONS.laptop}<b>${esc(at.name)}</b>${at.here ? `<small>${THIS_COMPUTER}</small>` : ''}</span><button class="btn" data-act="move-to" title="Its chat comes along" ${places.some((p) => p.slug !== (d.home ?? '') && p.online) ? '' : 'disabled'}>${ICONS.move}<span>Move…</span></button>`)
        : row('Computer', choices('home', places.filter((p) => p.online || p.slug === d.home).map((p) => choice(p.slug, esc(p.name))).join(''), { fill: false }))
    // whether it's one of your shared agents or only this workspace's, and its folder is the workspace's unless it has
    // one of its own
    const ws = state.workspace
    const lives = !ws ? ''
      : live
        ? row('Lives in', `<span class="ed-pc">${wsTile(ws, { size: 18 })}<b>${live.shared ? 'Your clique' : `${esc(ws.name)} only`}</b></span>`, { note: live.shared ? 'the same agent in every workspace it works in' : `only ${esc(ws.name)} has it` })
        : row('Lives in', choices('shared', choice('', `${esc(ws.name)} only`) + choice('1', 'Your whole clique'), { fill: false }), { note: d.shared ? `joins your clique, and works here in ${esc(ws.name)}` : `only ${esc(ws.name)} has it` })
    const folder = ws?.folder ? tildePath(ws.folder) : ''
    const where = card.querySelector('.where')
    where.innerHTML = lives +
      row('Folder', `<input class="ed-input field mono" data-k="cwd" value="${esc(d.cwd)}" placeholder="${esc(folder || '~/code/my-app')}" autocomplete="off" spellcheck="false">${d.home ? '' : '<button type="button" class="btn" data-act="pick">Choose…</button>'}`, { note: d.home ? `a path on ${esc(at.name)}` : folder && !d.cwd ? `${esc(ws.name)}'s folder` : '' }) +
      computer
    drawPicks(where)
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

  let writing = false // its brain is drafting its instructions (write, below)
  function drawAvatar(hop = false) {
    card.style.setProperty('--c', colorOf(draft.avatar))
    card.style.setProperty('--ed-c', colorOf(draft.avatar))
    card.classList.toggle('light', LIGHT.has(draft.avatar.color))
    const live = agentNamed(editing)
    const host = card.querySelector('.pd-av')
    // while it writes it's at its laptop, whatever it was doing
    const mood = writing ? 'working' : live?.status === 'working' || live?.status === 'waiting' ? undefined : live && !live.on ? 'sleep' : 'idle'
    const pose = writing ? 'laptop' : live ? poseOf(live, { ask: asksByName.get(live.name) }) : undefined
    host.innerHTML = avatarHTML({ name: draft.name || 'new', avatar: draft.avatar, status: writing ? 'working' : live?.status }, { size: 168, mood, pose })
    if (hop) bounce(host.querySelector('.av'), 'pop')
  }

  function syncSave() {
    const btn = card.querySelector('[data-act=save]')
    if (btn) btn.disabled = !dirty()
    card.querySelector('.sheet-foot')?.classList.toggle('dirty', Boolean(original) && dirty())
    drawAdvSummary()
  }

  card.addEventListener('input', (e) => {
    if ('limitK' in e.target.dataset) {
      const k = Math.round(Number(e.target.value))
      draft.contextLimit = k >= 10 ? k * 1000 : ''
      syncLimit()
      return syncSave()
    }
    const k = e.target.dataset.k
    if (!k) return
    if (stage && (k === 'name' || k === 'area')) {
      draft[k] = e.target.value
      card.querySelector('.pd-msg').textContent = ''
      return syncStage()
    }
    draft[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    if (k === 'model') drawEffortOnly()
    if (k === 'name' && !stage) card.querySelector('.ed-pane[data-pane=look] .ed-pane-head p').textContent = `Every option shows ${draft.name || 'it'} wearing it.`
    if (k === 'on' && !stage) card.querySelector('[data-k=on]').closest('.ed-row').querySelector('small').textContent = onHint()
    syncSave()
  })

  // Changing model can change which efforts exist (Codex models differ); redraw just that bit.
  function drawEffortOnly() {
    const efforts = effortsFor(draft)
    if (!efforts.includes(draft.effort)) draft.effort = ''
    const ctl = card.querySelector('.effort-row .ed-ctl')
    if (!ctl) return
    ctl.innerHTML = efforts.length ? effortChoices(efforts) : '<em>set by the model</em>'
    drawPicks(ctl)
  }

  // Typing a model: Enter or leaving the field is done, Esc puts back the one it had.
  card.addEventListener('focusout', (e) => {
    if (modelTyping && e.target.dataset.k === 'model') doneTyping()
  })
  card.addEventListener('keydown', (e) => {
    // on the stage, Enter in either field brings it in
    if (stage && e.key === 'Enter' && ['name', 'area'].includes(e.target.dataset.k) && !e.isComposing) return void (e.preventDefault(), save())
    if (!modelTyping || e.target.dataset.k !== 'model') return
    if (e.key === 'Enter') e.preventDefault()
    else if (e.key === 'Escape') (e.preventDefault(), (draft.model = typedFrom))
    else return
    doneTyping()
    card.querySelector('[data-act=model]')?.focus({ preventScroll: true })
  })

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
    if (stage) {
      const act = e.target.closest('[data-act]')?.dataset.act
      if (act === 'back') close()
      if (act === 'settings' && !bringing) stageToSheet()
      if (act === 'bring') save()
      if (act === 'shuffle' && !bringing) {
        draft.avatar = randomAvatar()
        drawStageAvatar('pop')
      }
      if (['back', 'settings', 'bring', 'shuffle'].includes(act)) return
      // (its brain and its switches are the sheet's own controls: handled below, as there)
    }
    // a tab, or the creature (Look); not the sheet itself, which carries the open tab's name too
    const t = e.target.closest('button[data-tab]')
    if (t && !t.disabled) return setTab(t.dataset.tab)
    const p = e.target.closest('[data-pick] button[data-v]')
    if (p && p.closest('[data-pick]').dataset.pick === 'clones') {
      draft.clones = Number(p.dataset.v) || ''
      syncLimit()
      return syncSave()
    }
    const clone = e.target.closest('[data-clone]')
    if (clone) {
      const name = clone.dataset.clone
      if (close()) onTerminal(name)
      return
    }
    if (p && ['contextLimit', 'onContextLimit'].includes(p.closest('[data-pick]').dataset.pick)) {
      const k = p.closest('[data-pick]').dataset.pick
      draft[k] = k === 'contextLimit' ? Number(p.dataset.v) || '' : p.dataset.v
      if (k === 'contextLimit') card.querySelector('[data-limit-k]').value = '' // a preset, not what was typed
      syncLimit()
      return syncSave()
    }
    if (p && p.closest('[data-pick]').dataset.pick === 'effort') {
      // picking the picked one again goes back to the model's default
      draft.effort = draft.effort === p.dataset.v ? '' : p.dataset.v
      drawPicks(p.closest('.ed-ctl'))
      return syncSave()
    }
    if (p) {
      const k = p.closest('[data-pick]').dataset.pick
      draft[k] = p.dataset.v
      drawWhere()
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
    if (act === 'advanced') setAdvanced(!advOpen)
    if (act === 'model') modelMenu(e.target.closest('[data-act]'))
    if (act === 'accounts') onAccounts?.()
    if (act === 'shuffle') {
      draft.avatar = randomAvatar()
      drawLook()
      drawAvatar(true)
      syncSave()
    }
    if (act === 'pick') {
      try {
        const dir = await clique.call('pickFolder', draft.home)
        if (dir) card.querySelector('[data-k=cwd]').value = draft.cwd = dir
        syncSave()
      } catch (err) {
        card.querySelector('.pd-msg').textContent = errorLine(err) // an agent on another computer works in that computer's folders
      }
    }
    if (act === 'terminal') {
      const name = editing
      if (close()) onTerminal(name)
    }
    if (act === 'move-to') moveMenu(e.target.closest('[data-act]'))
    if (act === 'more') moreMenu(e.target.closest('[data-act]'))
    if (act === 'fresh') freshStart()
    if (act === 'save') save()
    if (act === 'write') write()
  })

  // A clean slate: the old conversation stays in its history. A busy agent finishes its task first.
  async function freshStart() {
    try {
      await clique.call('freshStart', editing)
      card.querySelector('.pd-msg').textContent = 'New conversation ✓'
    } catch (err) {
      card.querySelector('.pd-msg').textContent = errorLine(err)
    }
  }

  // Move…: the computers it could go to. The move sheet takes it from there (folder, what comes along).
  function moveMenu(anchor) {
    const c = state.computers ?? { me: {}, links: [] }
    const places = [{ slug: '', name: c.me?.name || 'This computer', online: true, here: true }, ...linkedHere(c)].filter((p) => p.slug !== (draft.home ?? ''))
    popMenu(anchor, [{ head: 'Move to' }, ...places.map((p) => ({ label: p.name, icon: p.here ? ICONS.desktop : ICONS.laptop, act: p.slug, disabled: !p.online, hint: p.online ? (p.here ? THIS_COMPUTER : '') : 'offline' }))], (home) => {
      const name = editing
      if (close()) onMove?.(name, home)
    })
  }

  function moreMenu(anchor) {
    const a = agentNamed(editing)
    const shared = Boolean(a?.shared)
    popMenu(anchor, a?.system ? [{ label: 'New conversation', icon: ICONS.fresh, act: 'fresh', disabled: !a.on || a.freshPending, hint: a.freshPending ? 'when it’s free' : '' }] : [
      { label: 'New conversation', icon: ICONS.fresh, act: 'fresh', disabled: !a?.on || a.freshPending, hint: a?.freshPending ? 'when it’s free' : a?.convo?.context ? `${a.convo.context.pct}% full` : '' },
      { label: 'Export…', icon: ICONS.export, act: 'export', hint: '.clique file' },
      { label: 'Move to another computer…', icon: ICONS.move, act: 'move', disabled: !linkedHere(state.computers ?? {}).some((l) => l.online) && !draft.home },
      '-',
      { label: shared ? `Take out of ${state.workspace.name}…` : 'Remove…', icon: ICONS.trash, act: 'remove', danger: true },
      ...(shared ? [{ label: 'Remove from your clique…', icon: ICONS.trash, act: 'forget', danger: true }] : []),
    ], async (act) => {
      if (act === 'fresh') freshStart()
      if (act === 'export') exportAgents([editing])
      if (act === 'move') moveMenu(anchor)
      if (act === 'remove' && confirm(shared
        ? `Take ${draft.name || editing} out of ${state.workspace.name}? It stops working here, and starts a fresh conversation if it comes back. It stays in your clique and your other workspaces.`
        : `Remove ${draft.name || editing}? It's only in ${state.workspace.name}, so it's gone for good. Its session stops (the transcript stays with the CLI).`)) {
        await clique.call('removeAgent', editing)
        close(true)
      }
      if (act === 'forget' && confirm(`Remove ${draft.name || editing} from your clique? It stops and leaves every workspace it's in, for good. Its transcripts stay with the CLI.`)) {
        await clique.call('removeAgent', editing, { everywhere: true })
        close(true)
      }
    })
  }

  // The agent's own brain drafts its instructions; the creature types at its laptop while it writes.
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
    writing = true
    drawAvatar()
    msg.textContent = ''
    try {
      const { name, area, provider, model, cwd } = draft
      box.value = draft.prompt = await clique.call('draftPrompt', { name: slug(name), area, provider, model, cwd, home: draft.home })
      syncSave()
      msg.textContent = 'Drafted ✓ (review it, then Save)'
    } catch (err) {
      msg.textContent = `Couldn't write it. ${errorLine(err, 'Try again in a moment.')}`
    } finally {
      btn.disabled = false
      btn.querySelector('span').textContent = 'Write it'
      box.classList.remove('writing')
      writing = false
      drawAvatar(true)
    }
  }

  async function save() {
    doneTyping() // a model being typed counts as typed
    if (!dirty() || bringing) return
    const msg = card.querySelector('.pd-msg')
    msg.textContent = ''
    try {
      if (!original) {
        const { on, ...fields } = draft
        if (stage) (bringing = true), syncStage()
        reopen = await clique.call('addAgent', { ...fields, off: !on }) // a name@computer when it runs elsewhere
        store.set('clique.yolo', draft.yolo ? '1' : '0')
        if (bringing && agentNamed(reopen)) landReopen() // it showed up before the answer did
      } else {
        const patch = {}
        for (const k of FIELDS) if (JSON.stringify(draft[k]) !== JSON.stringify(original[k])) patch[k] = draft[k]
        if (draft.on !== original.on) patch.off = !draft.on
        if (JSON.stringify(draft.avatar) !== JSON.stringify(original.avatar)) patch.avatar = draft.avatar
        if (Object.keys(patch).length) await clique.call('update', editing, patch)
        reopen = 'name' in patch ? qualified(slug(draft.name), draft.home) : editing
        if ('name' in patch) onRenamed?.(editing, reopen)
      }
    } catch (err) {
      msg.textContent = errorLine(err)
      bringing = false
      if (stage) syncStage()
    }
  }

  // The agent the stage just added is in state: off it goes (land).
  function landReopen() {
    const name = reopen
    reopen = null
    land(name)
  }

  document.addEventListener('keydown', (e) => {
    if (editing && commandKey(e) && !e.altKey && e.key === 's') return void (e.preventDefault(), save())
    if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open], .menu:not(.leaving, .hidden), .mentions:not(.hidden), [popover]:popover-open')) return
    if (editing) return void (e.preventDefault(), close())
    if (selecting && root.offsetParent) setSelecting(false)
  })

  // While another view is up, the grid isn't redrawn on every push: it catches up when it's shown again. What it
  // would have celebrated meanwhile is remembered all the same (and not saved for later), as when it redrew hidden.
  let shown = true
  let stale = false

  return {
    render(next) {
      state = next
      if (shown) drawGrid()
      else (stale = true), celebrate(grid, state.agents)
      if (reopen && bringing && agentNamed(reopen)) landReopen()
      else if (reopen && agentNamed(reopen)) {
        const name = reopen
        reopen = null
        open(name, { at: tab, force: true })
        drawAvatar(true)
        card.querySelector('.pd-msg').textContent = 'Saved'
      } else if (editing && editing !== ':new' && !agentNamed(editing)) {
        editing = null // it's gone (removed, or moved away): its sheet closes with it
        sheet.classList.remove('open')
        list.inert = false
        if (card.contains(document.activeElement)) document.activeElement.blur()
      } else if (editing && !stage) {
        drawState()
        drawFacts()
        drawExperience()
        if (!card.querySelector('.limit')?.contains(document.activeElement)) drawLimit()
        drawAdvSummary()
      }
    },
    open,
    create: () => open(null),
    close: () => editing && close(true),
    // the agent whose sheet has changes not saved yet, if any
    unsaved: () => (editing && dirty() ? (editing === ':new' ? 'the new agent' : editing) : null),
    setVisible(on) {
      shown = on
      if (on && stale && state) (stale = false), drawGrid()
    },
  }
}

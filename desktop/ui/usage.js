// The Usage view: what Claude Code and Codex used on this computer, day by day (core/history.js reads their own logs,
// so it's every workspace's agents and what you ran outside CLIque). A calendar per provider, a square a day, darker
// for more tokens, on one scale for every calendar so two providers compare. Above them the range's numbers; under
// them who used it and on which models, for the whole range until you pick a day. Data comes from clique.call('history').
/* global pageHead, popMenu, clique, store, esc, morph, reduceMotion, tildePath, shortPath, ICONS, avatarHTML, money, plural, limitNums, usageTip, THIS_COMPUTER, PRODUCT_NAME, shownName, ago */

function mountUsage(root, { headIn = root }) {
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const HUES = ['claude', 'codex', 'glm', 'local'] // each has a colour of its own (usage.css); any other is ink
  const ROWS = 6 // who and which models: the top ones, the rest as one line
  const COST_NOTE = `What these tokens would cost at API list prices. On a subscription this measures use, not a bill. Models ${PRODUCT_NAME} has no price for are left out.`
  const TOKENS_NOTE = 'Everything the models read and wrote, the cached context they re-read included.'

  headIn.insertAdjacentHTML('beforeend', pageHead({
    id: 'usage', glyph: ICONS.chart, title: 'Usage', sub: '',
    tools: `<button class="btn has-menu" data-us="range" aria-haspopup="menu" title="Which days: the last 12 months, or a year">Last 12 months${ICONS.chevron}</button>`,
  }))
  const headEl = headIn.querySelector('.page-head[data-for=usage]')
  const rangeBtn = headEl.querySelector('[data-us=range]')
  root.innerHTML = `<i class="us-prog" aria-hidden="true"><i></i></i>
    <div class="us-scroll"><div class="us-wrap"></div></div>
    <div class="us-none empty-state hidden">${ICONS.chart}<h2 class="display">No usage yet</h2><p class="lead">When Claude Code or Codex has worked on ${esc(THIS_COMPUTER)}, in ${esc(PRODUCT_NAME)} or outside it, each day shows up here.</p></div>
    <div class="us-tip" role="tooltip"></div>`
  const wrap = root.querySelector('.us-wrap')
  const tip = root.querySelector('.us-tip')

  let state = null // the app's: the agents (their creatures), the accounts' limits now
  let data = null // clique.call('history'): { at, reading, first, providers: [{ id, label, days }] }
  let shown = false
  let timer = null
  let asked = 0 // only the newest answer is drawn
  let picked = null // the day picked, 'YYYY-MM-DD'
  let cursor = null // the day the keys are on: the one square in each calendar that Tab stops at
  let range = store.get('clique.usage.range') || 'last'

  // ---- days ----
  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const dateOf = (k) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7))
  const dayShort = (d) => `${DAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`
  const dayLong = (d, today) => `${DAY_LONG[d.getDay()]}, ${MONTH_LONG[d.getMonth()]} ${d.getDate()}${d.getFullYear() === today.getFullYear() ? '' : `, ${d.getFullYear()}`}`

  // What's on screen: the last 53 weeks up to today, or one year. start: the Monday the first column begins on.
  function rangeOf(id, today) {
    const year = /^\d{4}$/.test(id) ? Number(id) : null
    if (!year) {
      const start = addDays(monday(today), -52 * 7)
      return { id: 'last', label: 'Last 12 months', from: start, to: today, start, cols: 53 }
    }
    const from = new Date(year, 0, 1)
    const end = new Date(year, 11, 31)
    const start = monday(from)
    return { id: String(year), label: String(year), from, to: end > today ? today : end, start, cols: Math.round((monday(end) - start) / (7 * 864e5)) + 1 }
  }
  // The years there's anything in, newest first.
  function years(today) {
    const first = data?.first ? Number(data.first.slice(0, 4)) : today.getFullYear()
    return Array.from({ length: Math.max(1, today.getFullYear() - first + 1) }, (_, i) => today.getFullYear() - i)
  }

  // ---- numbers ----
  // 17.1B, 342M, 2.5M, 340k, 900
  const big = (n) => (n >= 1e9 ? `${+(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n ?? 0)))
  const count = (n) => Math.round(n).toLocaleString('en-US')
  // "1,204 messages", the number in bold where it's a fact in a line
  const things = (n, word, { bold = false } = {}) => `${bold ? `<b>${count(n)}</b>` : count(n)} ${Math.round(n) === 1 ? word : `${word}s`}`
  const hueOf = (id) => (HUES.includes(id) ? id : 'other')

  // The days of a range that have anything, per provider, and all of it added up.
  function tally(providers, r) {
    const from = keyOf(r.from)
    const to = keyOf(r.to)
    const total = { tokens: 0, messages: 0, sessions: 0, cost: 0, input: 0, output: 0, cached: 0, written: 0 }
    const active = new Set()
    const values = []
    const per = providers.map((p) => {
      const sum = { tokens: 0, messages: 0, sessions: 0, cost: 0, days: 0 }
      for (const [k, d] of Object.entries(p.days)) {
        if (k < from || k > to || !(d.tokens > 0 || d.messages > 0)) continue
        for (const f of Object.keys(total)) total[f] += d[f] ?? 0
        for (const f of ['tokens', 'messages', 'sessions', 'cost']) sum[f] += d[f] ?? 0
        if (d.tokens > 0) (sum.days++, active.add(k), values.push(d.tokens))
      }
      return sum
    })
    // one scale for every calendar: the square is full at the 95th percentile day (a single huge day doesn't wash the
    // rest out), and each step down is a quarter of the way in square root, so quiet days still show
    values.sort((x, y) => x - y)
    const cap = values.length ? values[values.length >= 20 ? Math.floor(0.95 * (values.length - 1)) : values.length - 1] : 0
    // streaks: days in a row with anything, in any provider
    let longest = 0
    let run = 0
    let busiest = null
    const byDay = new Map()
    for (const p of providers) for (const [k, d] of Object.entries(p.days)) if (k >= from && k <= to && d.tokens > 0) byDay.set(k, (byDay.get(k) ?? 0) + d.tokens)
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
      const k = keyOf(d)
      run = active.has(k) ? run + 1 : 0
      longest = Math.max(longest, run)
      if (byDay.has(k) && (!busiest || byDay.get(k) > byDay.get(busiest))) busiest = k
    }
    // the one running now: up to today, or to yesterday when today hasn't started
    let now = 0
    for (let d = active.has(to) ? r.to : addDays(r.to, -1); d >= r.from && active.has(keyOf(d)); d = addDays(d, -1)) now++
    return { total, per, active: active.size, longest, now, busiest, cap, level: (v) => (v > 0 && cap > 0 ? Math.max(1, Math.min(4, Math.ceil(4 * Math.sqrt(v / cap)))) : 0) }
  }

  // Who used it, in which folders and on which models: a day's, or a whole range's.
  function breakdown(providers, from, to) {
    const who = new Map()
    const where = new Map()
    const models = new Map()
    const kinds = { input: 0, cached: 0, written: 0, output: 0 }
    const sum = { tokens: 0, messages: 0, sessions: 0, cost: 0 }
    for (const p of providers) {
      for (const [k, d] of Object.entries(p.days)) {
        if (k < from || k > to) continue
        for (const f of Object.keys(kinds)) kinds[f] += d[f] ?? 0
        for (const f of Object.keys(sum)) sum[f] += d[f] ?? 0
        for (const [name, v] of Object.entries(d.who ?? {})) who.set(name, (who.get(name) ?? 0) + v)
        for (const [dir, v] of Object.entries(d.where ?? {})) where.set(dir, (where.get(dir) ?? 0) + v)
        for (const [model, v] of Object.entries(d.models ?? {})) {
          const row = models.get(`${p.id}\u0000${model}`) ?? { provider: p, model, tokens: 0 }
          row.tokens += v
          models.set(`${p.id}\u0000${model}`, row)
        }
      }
    }
    const top = (rows) => {
      const sorted = rows.filter((x) => x.tokens > 0).sort((x, y) => y.tokens - x.tokens)
      if (sorted.length <= ROWS) return sorted
      const rest = sorted.slice(ROWS - 1)
      return [...sorted.slice(0, ROWS - 1), { rest: rest.length, tokens: rest.reduce((n, x) => n + x.tokens, 0) }]
    }
    return { who: top([...who].map(([name, tokens]) => ({ name, tokens }))), where: top([...where].map(([dir, tokens]) => ({ dir, tokens }))), models: top([...models.values()]), kinds, sum }
  }
  // What the tokens were, in a line for a tooltip: most of any day is context read again from the cache.
  const kindsText = (k) => [['read new', k.input], ['re-read from cache', k.cached], ['written to cache', k.written], ['written by the models', k.output]].filter(([, v]) => v > 0).map(([label, v]) => `${big(v)} ${label}`).join(' · ')

  // ---- drawing ----
  // A line of facts, each kept whole when the line wraps; what it would cost at API prices last, when there's a price.
  // (each fact but the last carries its dot, so a line that wraps never starts with one)
  const factsHTML = (facts, cost) => `${[...facts.map((f) => `<span>${f}`), cost >= 0.005 && `<span class="us-cost" title="${esc(COST_NOTE)}"><b>≈ ${money(cost)}</b> at API prices`].filter(Boolean).join('<i>·</i></span> ')}</span>`
  const tile = (label, value, sub, title = '') => `<div class="us-tile"${title ? ` title="${esc(title)}"` : ''}><span>${label}</span><b>${value}</b><small>${sub}</small></div>`

  function calendarHTML(p, r, t, today) {
    const todayKey = keyOf(today)
    const from = keyOf(r.from)
    const to = keyOf(r.to)
    // the day Tab lands on: where the keys left off, the one picked, or the newest
    const tab = [cursor, picked].find((k) => k && k >= from && k <= to) ?? to
    let cells = ''
    const months = []
    for (let c = 0; c < r.cols; c++) {
      for (let w = 0; w < 7; w++) {
        const d = addDays(r.start, c * 7 + w)
        const k = keyOf(d)
        if (k < from || k > to) {
          cells += '<i class="us-x"></i>'
          continue
        }
        if (d.getDate() === 1 || (c === 0 && w === 0)) months.push({ col: c, label: MONTH[d.getMonth()], first: d.getDate() === 1 })
        const day = p.days[k]
        const v = day?.tokens ?? 0
        const label = `${dayShort(d)}: ${v > 0 ? `${big(v)} tokens` : 'nothing'}`
        cells += `<button class="us-c${k === todayKey ? ' today' : ''}" data-day="${k}" data-l="${t.level(v)}" tabindex="${k === tab ? 0 : -1}"${k === picked ? ' aria-pressed="true"' : ''} aria-label="${label}"></button>`
      }
    }
    // a month's name over the week its first day is in; the range's first weeks get theirs only with room before the next
    const marks = months.filter((m, i) => m.first || (months[i + 1]?.col ?? r.cols) - m.col >= 3).filter((m, i, all) => i === 0 || m.col - all[i - 1].col >= 3)
    return `<div class="us-cal" style="--cols:${r.cols}">
      <div class="us-months" aria-hidden="true">${marks.map((m) => `<span style="grid-column:${m.col + 1}">${m.label}</span>`).join('')}</div>
      <div class="us-wd" aria-hidden="true"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
      <div class="us-cells" role="group" aria-label="${esc(p.label)}: tokens a day">${cells}</div>
    </div>`
  }

  function providerHTML(p, sum, r, t, today) {
    const u = state?.usage?.[p.id]
    const facts = sum && (sum.tokens > 0 || sum.messages > 0)
      ? factsHTML([`<b>${big(sum.tokens)}</b> tokens`, things(sum.messages, 'message', { bold: true }), things(sum.days, 'day', { bold: true })], sum.cost)
      : p.ghost ? '' : `Nothing in ${r.id === 'last' ? 'the last 12 months' : r.label}`
    return `<section class="us-prov" data-prov="${esc(p.id)}" data-hue="${hueOf(p.id)}">
      <header class="us-ph"><i class="us-dot"></i><h2>${esc(p.label)}</h2><span class="us-facts">${facts}</span>${
        u?.windows?.length ? `<span class="us-lim" title="${esc(usageTip(u))}">${limitNums(u)}</span>` : ''}</header>
      ${calendarHTML(p, r, t, today)}
    </section>`
  }

  // An agent's row: its creature (as it looks now, or as its name makes it), or what ran outside CLIque.
  function whoHTML(row, max) {
    const bar = `<i class="us-bar"><i style="width:${Math.max(2, (row.tokens / max) * 100)}%"></i></i>`
    if (row.rest) return `<div class="us-row rest"><span class="us-ic"></span><span class="us-name">${row.rest} more</span><b>${big(row.tokens)}</b>${bar}</div>`
    if (!row.name) return `<div class="us-row" title="Claude Code and Codex sessions you started yourself, and agents that aren't in your clique any more"><span class="us-ic">${ICONS.terminal}</span><span class="us-name">Outside ${esc(PRODUCT_NAME)}</span><b>${big(row.tokens)}</b>${bar}</div>`
    const a = state?.agents?.find((x) => !x.home && !x.cloneOf && x.name === row.name) ?? state?.roster?.find((x) => x.name === row.name) ?? { name: row.name }
    return `<div class="us-row"><span class="us-ic">${avatarHTML({ name: a.name, seed: a.seed, avatar: a.avatar }, { size: 22, mood: 'still' })}</span><span class="us-name">${esc(shownName(row.name))}</span><b>${big(row.tokens)}</b>${bar}</div>`
  }
  // A folder's row: where the sessions worked, your home as ~ and a long path down to its last two folders.
  function whereHTML(row, max) {
    const bar = `<i class="us-bar"><i style="width:${Math.max(2, (row.tokens / max) * 100)}%"></i></i>`
    if (row.rest) return `<div class="us-row rest"><span class="us-ic"></span><span class="us-name">${row.rest} more</span><b>${big(row.tokens)}</b>${bar}</div>`
    return `<div class="us-row"${row.dir ? ` title="${esc(tildePath(row.dir))}"` : ''}><span class="us-ic">${ICONS.folder}</span><span class="us-name">${row.dir ? esc(shortPath(row.dir)) : 'Folder not logged'}</span><b>${big(row.tokens)}</b>${bar}</div>`
  }
  function modelHTML(row, max) {
    const bar = `<i class="us-bar"><i style="width:${Math.max(2, (row.tokens / max) * 100)}%"></i></i>`
    if (row.rest) return `<div class="us-row rest"><span class="us-ic"></span><span class="us-name">${row.rest} more</span><b>${big(row.tokens)}</b>${bar}</div>`
    return `<div class="us-row" data-hue="${hueOf(row.provider.id)}" title="${esc(row.provider.label)}"><span class="us-ic"><i class="us-dot"></i></span><span class="us-name">${esc(row.model || 'Model not logged')}</span><b>${big(row.tokens)}</b>${bar}</div>`
  }

  function detailHTML(providers, r, today) {
    const day = picked && dateOf(picked)
    const b = day ? breakdown(providers, picked, picked) : breakdown(providers, keyOf(r.from), keyOf(r.to))
    const title = day ? dayLong(day, today) : r.label
    const none = !(b.sum.tokens > 0 || b.sum.messages > 0)
    const facts = none ? (day ? 'Nothing ran that day' : '')
      : factsHTML([`<abbr title="${esc(`${TOKENS_NOTE}\n${kindsText(b.kinds)}`)}"><b>${big(b.sum.tokens)}</b> tokens</abbr>`, things(b.sum.messages, 'message', { bold: true }), things(b.sum.sessions, 'session', { bold: true })], b.sum.cost)
    return `<section class="us-detail${day ? ' day' : ''}">
      <header class="us-ph"><h2>${esc(title)}</h2><span class="us-facts">${facts}</span>${day ? `<button class="btn sm" data-us="clear">Back to ${esc(r.id === 'last' ? 'the last 12 months' : r.label)}</button>` : ''}</header>
      <div class="us-cols${none ? ' none' : ''}">
        <div class="us-col"><h3 class="section-label">Who used it</h3>${b.who.map((x) => whoHTML(x, b.who[0].tokens)).join('')}</div>
        <div class="us-col"><h3 class="section-label">Where</h3>${b.where.map((x) => whereHTML(x, b.where[0].tokens)).join('')}</div>
        <div class="us-col"><h3 class="section-label">Models</h3>${b.models.map((x) => modelHTML(x, b.models[0].tokens)).join('')}</div>
      </div>
    </section>`
  }

  function draw() {
    if (!shown || !data) return
    const today = new Date()
    const reading = data.reading
    const none = !data.providers.length
    // nothing read yet: the two calendars everyone has, empty, so they fill in where they stand
    const providers = none && reading ? [{ id: 'claude', label: 'Claude', days: {}, ghost: true }, { id: 'codex', label: 'Codex', days: {}, ghost: true }] : data.providers
    const r = rangeOf(range, today)
    if (picked && (picked < keyOf(r.from) || picked > keyOf(r.to))) picked = null
    const pct = reading?.total ? Math.min(100, Math.floor((reading.done / reading.total) * 100)) : 0
    headEl.querySelector('.ph-sub').textContent = reading && (none || reading.total > 64e6) ? `Reading Claude Code’s and Codex’s logs${reading.total ? ` · ${pct}%` : '…'}` : `What Claude Code and Codex used on ${THIS_COMPUTER}`
    if (rangeBtn.firstChild.nodeValue !== r.label) rangeBtn.firstChild.nodeValue = r.label
    rangeBtn.classList.toggle('hidden', none && !reading)
    root.querySelector('.us-prog').classList.toggle('on', Boolean(reading && (none || reading.total > 64e6)))
    root.querySelector('.us-prog i').style.transform = `scaleX(${pct / 100})`
    root.querySelector('.us-none').classList.toggle('hidden', !(none && !reading))
    root.querySelector('.us-scroll').classList.toggle('hidden', none && !reading)
    if (none && !reading) return
    const t = tally(providers, r)
    const within = r.id === 'last' ? 'in the last 12 months' : `in ${r.label}`
    const steps = [1, 2, 3, 4].map((l) => `<i data-l="${l}" title="${t.cap ? (l < 4 ? `Up to ${big(t.cap * (l / 4) ** 2)} tokens a day` : `More than ${big(t.cap * (3 / 4) ** 2)} tokens a day`) : ''}"></i>`).join('')
    morph(wrap, `<div class="us-tiles">${
      tile('Tokens', big(t.total.tokens), t.total.cost >= 0.005 ? `≈ ${money(t.total.cost)} at API prices` : within, [TOKENS_NOTE, kindsText(t.total), t.total.cost >= 0.005 && COST_NOTE].filter(Boolean).join('\n'))}${
      tile('Messages', count(t.total.messages), `in ${things(t.total.sessions, 'session')}`, `What you, the clique and ${PRODUCT_NAME} sent to Claude Code and Codex: each one starts a turn.`)}${
      tile('Active days', count(t.active), t.busiest ? `busiest ${MONTH[dateOf(t.busiest).getMonth()]} ${dateOf(t.busiest).getDate()}` : within, 'Days anything ran, on any provider.')}${
      tile('Longest streak', plural(t.longest, 'day'), t.now ? `${plural(t.now, 'day')} running now` : t.longest ? 'none running now' : within, 'Days in a row with anything running.')}</div>
      ${providers.map((p, i) => providerHTML(p, t.per[i], r, t, today)).join('')}
      <div class="us-foot"><span class="us-note">From Claude Code’s and Codex’s own logs on ${esc(THIS_COMPUTER)}: your clique in every workspace, and what you ran outside ${esc(PRODUCT_NAME)}. Nothing leaves ${esc(THIS_COMPUTER)}.${data.at && !reading ? ` Read ${Date.now() - data.at < 60000 ? 'just now' : `${ago(data.at)} ago`}.` : ''}</span>
        <span class="us-legend" title="${esc(TOKENS_NOTE)} The same scale in every calendar.">Less<i data-l="0"></i>${steps}More</span></div>
      ${detailHTML(providers, r, today)}`)
  }

  // ---- the data: asked for when the view opens, again while the logs are being read, then every couple of minutes ----
  async function refresh() {
    clearTimeout(timer)
    const mine = ++asked
    let next = null
    try {
      next = await clique.call('history')
    } catch {} // CLIque couldn't say right now: what's on screen stays, and it's asked again
    if (mine !== asked) return
    if (next) data = next
    draw()
    if (shown) timer = setTimeout(refresh, !next ? 15000 : next.reading ? 700 : 120000)
  }

  // ---- the range ----
  rangeBtn.addEventListener('click', (e) => {
    const today = new Date()
    const items = [{ label: 'Last 12 months', act: 'last', on: range === 'last' }, '-', ...years(today).map((y) => ({ label: String(y), act: String(y), on: range === String(y) }))]
    popMenu(e.currentTarget, items, (act) => {
      range = act
      store.set('clique.usage.range', range)
      hideTip()
      draw()
    })
  })

  // ---- a day: pick it with a click or Enter, move between days with the arrows, Esc lets go ----
  function pick(day) {
    picked = picked === day ? null : day
    draw()
    // its breakdown is under the calendars: brought into view when it's off the bottom, by as little as shows it
    if (picked) wrap.querySelector('.us-detail')?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' })
  }
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-us=clear]')) return void (hideTip(), pick(picked))
    const c = e.target.closest('.us-c')
    if (!c) return
    cursor = c.dataset.day
    pick(c.dataset.day)
  })
  wrap.addEventListener('keydown', (e) => {
    const c = e.target.closest?.('.us-c')
    if (!c) return
    if (e.key === 'Escape' && picked) return void (e.preventDefault(), e.stopPropagation(), pick(picked))
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key]
    if (!step) return
    e.preventDefault()
    const next = keyOf(addDays(dateOf(c.dataset.day), step))
    const cells = c.parentElement
    if (!cells.querySelector(`.us-c[data-day="${next}"]`)) return // off the calendar's edge
    cursor = next
    draw() // the tab stop moves with it, in every calendar
    cells.querySelector(`.us-c[data-day="${next}"]`)?.focus()
  })

  // ---- a day's numbers, over the square the pointer or the focus is on ----
  function tipFor(c) {
    const p = data?.providers.find((x) => x.id === c.closest('.us-prov')?.dataset.prov)
    const d = p?.days[c.dataset.day]
    const when = `${dayShort(dateOf(c.dataset.day))}${p ? ` · ${p.label}` : ''}`
    tip.innerHTML = d && d.tokens > 0
      ? `<b>${big(d.tokens)} tokens</b><span>${[things(d.messages, 'message'), things(d.sessions, 'session'), d.cost >= 0.005 && `≈ ${money(d.cost)}`].filter(Boolean).join(' · ')}</span><small>${esc(when)}</small>`
      : `<b>Nothing</b><small>${esc(when)}</small>`
    tip.classList.add('on')
    const at = c.getBoundingClientRect()
    const box = root.getBoundingClientRect()
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    const above = at.top - h - 8 >= box.top
    tip.style.left = `${Math.round(Math.max(8, Math.min(at.left + at.width / 2 - w / 2 - box.left, box.width - w - 8)))}px`
    tip.style.top = `${Math.round((above ? at.top - h - 8 : at.bottom + 8) - box.top)}px`
  }
  const hideTip = () => tip.classList.remove('on')
  wrap.addEventListener('pointerover', (e) => {
    const c = e.target.closest('.us-c')
    if (c) tipFor(c)
    else hideTip()
  })
  wrap.addEventListener('pointerleave', hideTip)
  wrap.addEventListener('focusin', (e) => e.target.matches?.('.us-c:focus-visible') && tipFor(e.target))
  wrap.addEventListener('focusout', hideTip)
  root.querySelector('.us-scroll').addEventListener('scroll', hideTip, { passive: true })

  return {
    // the app's state: the creatures and the limits may have changed
    render(next) {
      state = next
      draw()
    },
    setVisible(on) {
      if (on === shown) return
      shown = on
      clearTimeout(timer)
      hideTip()
      if (on) (draw(), refresh())
    },
    refresh,
  }
}

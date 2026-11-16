// The Usage view: what Claude Code and Codex used, by the app's own things. The workspace on screen (its agents, on
// every computer that has it) or everything (each workspace, and what ran outside CLIque), on this computer, a linked
// one, or all of them added up. core/history.js reads each computer's logs into rows (a day, a workspace, an agent, a
// provider, a model, a folder); this view filters and adds them up: the range's numbers, tokens over time by workspace,
// agent, provider or computer, a calendar per provider, and who used it, where and on which models, for the whole range
// until you pick a day. Every row of a list is a filter. Data comes from clique.call('history').
/* global pageHead, popMenu, clique, store, esc, morph, reduceMotion, tildePath, shortPath, ICONS, avatarHTML, money, plural, limitNums, usageTip, THIS_COMPUTER, PRODUCT_NAME, shownName, ago, wsTile, computerIcon, upFirst */

function mountUsage(root, { headIn = root }) {
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const HUES = ['claude', 'codex', 'glm', 'local'] // each provider has a colour of its own (usage.css); any other is ink
  const ROWS = 6 // a list's rows before "N more"
  const TOP = 5 // the chart's series with a colour of their own (usage.css --us-s0…4); the rest are one "Other"
  const PLOT = 240 // the chart's height in px (usage.css .us-plot)
  const OUT = '' // what ran outside CLIque: no workspace, no agent
  const UNKNOWN = '?' // the clique's, in a workspace (or by an agent) its log doesn't say
  const COST_NOTE = `What these tokens would cost at API list prices. On a subscription this measures use, not a bill. Models ${PRODUCT_NAME} has no price for are left out.`
  const TOKENS_NOTE = 'Everything the models read and wrote, the cached context they re-read included.'
  const RANGES = [['d7', 'Last 7 days'], ['d30', 'Last 30 days'], ['last', 'Last 12 months']]
  // What the chart and the lists can be split by. all: what its menu says with nothing picked.
  const DIMS = {
    ws: { label: 'Workspaces', short: 'Workspace', all: 'All workspaces' },
    who: { label: 'Agents', short: 'Agent', all: 'Everyone' },
    provider: { label: 'Providers', short: 'Provider', all: 'All providers' },
    computer: { label: 'Computers', short: 'Computer', all: 'All computers' },
    model: { label: 'Models', short: 'Model' },
    dir: { label: 'Folders', short: 'Folder' },
  }
  const NUMBERS = ['tokens', 'input', 'output', 'cached', 'written', 'replies', 'messages', 'sessions', 'cost']

  headIn.insertAdjacentHTML('beforeend', pageHead({
    id: 'usage', glyph: ICONS.chart, title: 'Usage', sub: '',
    tools: `<div class="seg us-scope ready" role="group" aria-label="Whose usage"><button type="button" data-scope="here"></button><button type="button" data-scope="all" title="Every workspace, and what you ran outside ${esc(PRODUCT_NAME)}">Everything</button></div>
      <button class="btn has-menu" data-us="range" aria-haspopup="menu" title="Which days">Last 12 months${ICONS.chevron}</button>`,
  }))
  const headEl = headIn.querySelector('.page-head[data-for=usage]')
  const rangeBtn = headEl.querySelector('[data-us=range]')
  const scopeSeg = headEl.querySelector('.us-scope')
  root.innerHTML = `<i class="us-prog" aria-hidden="true"><i></i></i>
    <div class="us-scroll"><div class="us-wrap"></div></div>
    <div class="us-none empty-state hidden">${ICONS.chart}<h2 class="display">No usage yet</h2><p class="lead">When Claude Code or Codex has worked on ${esc(THIS_COMPUTER)}, in ${esc(PRODUCT_NAME)} or outside it, each day shows up here.</p></div>
    <div class="us-tip" role="tooltip"></div>`
  const wrap = root.querySelector('.us-wrap')
  const tip = root.querySelector('.us-tip')

  let state = null // the app's: the workspace on screen, the accounts' limits now
  let data = null // clique.call('history'): { here, computers: [{ slug, name, here, online, at, got, reading, cols, rows, providers, faces, note }], spaces }
  let facts = [] // its rows, one object each (see read)
  let shown = false
  let timer = null
  let asked = 0 // only the newest answer is drawn
  let picked = null // the day picked, 'YYYY-MM-DD'
  let cursor = null // the day the keys are on: the one square in each calendar that Tab stops at
  let barAt = null // ...and the bar of the chart they're on (its place in the row)
  let range = store.get('clique.usage.range') || 'last'
  let scope = store.get('clique.usage.scope') === 'all' ? 'all' : 'here' // the workspace on screen, or everything
  const by = { here: store.get('clique.usage.by.here') || 'who', all: store.get('clique.usage.by.all') || 'ws' } // what the chart is split by, in each
  const filters = { ws: null, who: null, provider: null, computer: null, model: null, dir: null } // one value of a kind, or null for all
  const open = new Set() // the lists shown whole, past their first rows
  let view = null // what the last draw worked out, for the tooltips and the menus

  // ---- days ----
  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const dateOf = (k) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7))
  const dayShort = (d) => `${DAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`
  const dayLong = (d, today) => `${DAY_LONG[d.getDay()]}, ${MONTH_LONG[d.getMonth()]} ${d.getDate()}${d.getFullYear() === today.getFullYear() ? '' : `, ${d.getFullYear()}`}`

  // What's on screen. from/to: the days the numbers, the chart and the lists are of. The calendars show a year either
  // way (the last 53 weeks, or the one picked), so a short range is seen where it sits in it: start is the Monday their
  // first column begins on. unit: what one bar of the chart is.
  function rangeOf(id, today) {
    const year = /^\d{4}$/.test(id) ? Number(id) : null
    if (year) {
      const from = new Date(year, 0, 1)
      const end = new Date(year, 11, 31)
      const to = end > today ? today : end
      const start = monday(from)
      return { id: String(year), label: String(year), words: `in ${year}`, from, to, calFrom: from, calTo: to, start, cols: Math.round((monday(end) - start) / (7 * 864e5)) + 1, unit: 'week' }
    }
    const start = addDays(monday(today), -52 * 7)
    const days = { d7: 7, d30: 30 }[id]
    if (days) return { id, label: `Last ${days} days`, words: `in the last ${days} days`, from: addDays(today, 1 - days), to: today, calFrom: start, calTo: today, start, cols: 53, unit: 'day' }
    return { id: 'last', label: 'Last 12 months', words: 'in the last 12 months', from: start, to: today, calFrom: start, calTo: today, start, cols: 53, unit: 'week' }
  }
  // The years there's anything in, newest first.
  function years(today) {
    const firsts = (data?.computers ?? []).map((c) => c.first).filter(Boolean).sort()
    const first = firsts.length ? Number(firsts[0].slice(0, 4)) : today.getFullYear()
    return Array.from({ length: Math.min(12, Math.max(1, today.getFullYear() - first + 1)) }, (_, i) => today.getFullYear() - i)
  }

  // ---- numbers ----
  // 17.1B, 342M, 2.5M, 340k, 1.5k, 900: three figures at most, and a number that rounds up to a thousand of its unit
  // goes by the next one (999,960 is 1M, not 1000k)
  const UNITS = [['k', 1e3], ['M', 1e6], ['B', 1e9], ['T', 1e12]]
  function big(n) {
    n = Math.round(Number(n) || 0)
    if (n < 1000) return String(n)
    const write = (i) => +(n / UNITS[i][1]).toFixed(n / UNITS[i][1] >= 100 || (i === 0 && n / UNITS[i][1] >= 10) ? 0 : n / UNITS[i][1] >= 10 || i <= 1 ? 1 : 2)
    let i = UNITS.findLastIndex(([, size]) => n >= size)
    if (write(i) >= 1000 && i < UNITS.length - 1) i++
    return `${write(i).toLocaleString('en-US')}${UNITS[i][0]}`
  }
  const count = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')
  // "1,204 messages", the number in bold where it's a fact in a line
  const things = (n, word, { bold = false } = {}) => `${bold ? `<b>${count(n)}</b>` : count(n)} ${Math.round(n) === 1 ? word : `${word}s`}`
  const hueOf = (id) => (HUES.includes(id) ? id : 'other')
  // A share in words: 41%, 0.4%, and <0.1% for what's there but too small to say (never "0%" for something)
  const pct = (part, whole) => {
    if (!(whole > 0) || !(part > 0)) return '0%'
    const p = (part / whole) * 100
    if (part >= whole) return '100%'
    // (never 100% beside a part that's left over: 99.7%, and past 99.9, more than that)
    return p >= 99.95 ? '>99.9%' : p >= 99.5 ? `${Math.floor(p * 10) / 10}%` : p >= 10 ? `${Math.round(p)}%` : p >= 0.1 ? `${+p.toFixed(1)}%` : '<0.1%'
  }
  // The top of the chart's scale: the next round number over its tallest bar (1, 1.5, 2, 3, 4, 5, 6, 8 × a power of ten)
  function niceMax(v) {
    if (!(v > 0)) return 0
    const pow = 10 ** Math.floor(Math.log10(v))
    return [1, 1.5, 2, 3, 4, 5, 6, 8, 10].map((m) => m * pow).find((m) => m >= v)
  }

  // ---- the rows ----
  // Each computer's rows as objects. who: the agent as this computer names it (ada, or ada@studio for one on a linked
  // computer; UNKNOWN for the clique's work its log names nobody for); name: its name there.
  function read(next) {
    const out = []
    for (const c of next?.computers ?? []) {
      const at = Object.fromEntries((c.cols ?? []).map((name, i) => [name, i]))
      if (at.day === undefined || at.tokens === undefined) continue
      const str = (r, k) => (at[k] === undefined ? '' : String(r[at[k]] ?? ''))
      for (const r of c.rows ?? []) {
        const ws = str(r, 'ws')
        const name = ws ? str(r, 'who') : ''
        const f = { computer: c.slug, day: str(r, 'day'), ws, name, who: !ws ? OUT : !name ? UNKNOWN : c.here ? name : `${name}@${c.slug}`, provider: str(r, 'provider'), model: str(r, 'model'), dir: str(r, 'dir') }
        for (const k of NUMBERS) f[k] = at[k] === undefined ? 0 : Number(r[at[k]]) || 0
        out.push(f)
      }
    }
    return out
  }
  const valueOf = { ws: (f) => f.ws, who: (f) => f.who, provider: (f) => f.provider, computer: (f) => f.computer, model: (f) => `${f.provider}\t${f.model}`, dir: (f) => f.dir }
  // The workspace on screen, as the rows name it: the app's own word for it (it switches before the next answer comes).
  // (one the last answer doesn't know yet, just made: a key nothing has, until the next answer)
  const hereKey = () => (state?.workspace ? Object.entries(data?.spaces ?? {}).find(([, w]) => w.id === state.workspace.id)?.[0] ?? '\u0000' : null)
  const scopeNow = () => (scope === 'here' && hereKey() ? 'here' : 'all')
  // The rows of the scope, with every filter but `skip` (a list of one kind shows all of that kind, the picked one marked).
  function slice(skip) {
    const here = scopeNow() === 'here' ? hereKey() : null
    return facts.filter((f) => (here === null || f.ws === here) && Object.entries(filters).every(([dim, v]) => v === null || dim === skip || (dim === 'ws' && here !== null) || valueOf[dim](f) === v))
  }
  const sum = (rows, keys = NUMBERS) => {
    const out = Object.fromEntries(keys.map((k) => [k, 0]))
    for (const f of rows) for (const k of keys) out[k] += f[k]
    return out
  }
  // rows added up by one kind: [{ id, tokens, … }], most tokens first
  function group(rows, dim) {
    const by = new Map()
    for (const f of rows) {
      const id = valueOf[dim](f)
      let g = by.get(id)
      if (!g) by.set(id, (g = { id, tokens: 0, messages: 0, sessions: 0, cost: 0 }))
      g.tokens += f.tokens
      g.messages += f.messages
      g.sessions += f.sessions
      g.cost += f.cost
    }
    return [...by.values()].filter((g) => g.tokens > 0).sort((x, y) => y.tokens - x.tokens || (x.id < y.id ? -1 : 1))
  }

  // ---- what a row is called, and its picture ----
  const computerOf = (slug) => data?.computers?.find((c) => c.slug === slug)
  const computerName = (slug) => (computerOf(slug)?.here ? upFirst(THIS_COMPUTER) : computerOf(slug)?.name ?? slug)
  const providerLabel = (id) => data?.computers?.map((c) => c.providers?.[id]).find(Boolean) ?? id
  // (a look's parts end up in the creature's markup: only the ones that read as a word or a switch are taken)
  const lookOf = (v) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k, x]) => /^\w{1,24}$/.test(k) && (typeof x === 'boolean' || (typeof x === 'string' && /^[\w#. -]{1,40}$/.test(x))))) : undefined)
  const face = (name, slug, ws) => ({ name, avatar: lookOf(computerOf(slug)?.faces?.[ws]?.[name] ?? Object.values(computerOf(slug)?.faces ?? {}).map((f) => f?.[name]).find(Boolean) ?? state?.roster?.find((x) => x.name === name)?.avatar) })
  // -> { label, sub, icon, tip }: sub is the small word after the name (whose computer), icon its picture's html
  function thing(dim, id, size = 22) {
    if ((dim === 'ws' || dim === 'who') && id === OUT) return { label: `Outside ${PRODUCT_NAME}`, icon: ICONS.terminal, tip: `Claude Code and Codex sessions you started yourself, and agents that aren't in your clique any more` }
    if (dim === 'ws') {
      if (id === UNKNOWN) return { label: 'Workspace not recorded', icon: ICONS.folder, tip: `Work by agents that are in several workspaces, from before ${PRODUCT_NAME} wrote down which workspace each conversation ran in` }
      const w = data?.spaces?.[id]
      const name = w?.name ?? id.slice(id.indexOf(':') + 1)
      return { label: name, sub: w?.gone ? 'removed' : w?.ownerName ? `on ${w.ownerName}` : '', icon: wsTile(w?.gone ? { name, parked: true } : { name, ...w }, { size: Math.min(size, 20) }), tip: w?.ownerName ? `${name}, hosted on ${w.ownerName}` : name }
    }
    if (dim === 'who') {
      if (id === UNKNOWN) return { label: 'Agent not named', icon: ICONS.mark, tip: `The clique's work in a session whose log doesn't say which agent ran it` }
      const at = id.lastIndexOf('@')
      const name = at < 0 ? id : id.slice(0, at)
      const slug = at < 0 ? data?.computers?.find((c) => c.here)?.slug : id.slice(at + 1)
      const ws = scopeNow() === 'here' ? hereKey() : filters.ws
      return { label: shownName(name), sub: at < 0 ? '' : `on ${computerOf(slug)?.name ?? slug}`, icon: avatarHTML(face(name, slug, ws), { size, mood: 'still' }), tip: at < 0 ? shownName(name) : `${shownName(name)}, on ${computerOf(slug)?.name ?? slug}` }
    }
    if (dim === 'provider') return { label: providerLabel(id), icon: `<i class="us-dot" data-hue="${hueOf(id)}"></i>` }
    if (dim === 'computer') return { label: computerOf(id)?.name ?? id, sub: computerOf(id)?.here ? THIS_COMPUTER : computerOf(id)?.online ? '' : 'offline', icon: computerIcon(computerOf(id)?.name) }
    if (dim === 'model') {
      const [provider, model] = [id.slice(0, id.indexOf('\t')), id.slice(id.indexOf('\t') + 1)]
      // (a dated snapshot goes by its model: claude-sonnet-4-5, with the whole id on hover)
      return { label: model.replace(/-20\d{6}$/, '') || 'Model not logged', icon: `<i class="us-dot" data-hue="${hueOf(provider)}"></i>`, tip: `${model || 'Model not logged'} · ${providerLabel(provider)}` }
    }
    return { label: id ? shortPath(id) : 'Folder not logged', icon: ICONS.folder, tip: id ? tildePath(id) : '' }
  }

  // ---- the chart's colours: an entity keeps its own whatever is filtered ----
  // A provider has its hue. A workspace, an agent or a computer gets one of TOP series colours by where it ranks in the
  // scope over all time, with nothing filtered: the filters and the range never repaint it. Past TOP it's "Other";
  // what ran outside CLIque is always the neutral one.
  function seriesOf(dim, scoped) {
    if (dim === 'provider') return (id) => (HUES.includes(id) ? `p-${id}` : 'other')
    const ranked = dim === 'computer' ? (data?.computers ?? []).map((c) => c.slug) : group(scoped, dim).map((g) => g.id).filter((id) => id !== OUT)
    const slot = new Map(ranked.slice(0, TOP).map((id, i) => [id, `s${i}`]))
    return (id) => (id === OUT && dim !== 'computer' ? 'out' : slot.get(id) ?? 'other')
  }
  // bottom to top: the clique's by their colours, the rest of it, then what ran outside CLIque
  const SERIES = ['s0', 's1', 's2', 's3', 's4', 'p-claude', 'p-codex', 'p-glm', 'p-local', 'other', 'out']

  // The days of the calendars that have anything, per provider, and the range's own added up.
  function tally(providers, r, today) {
    const from = keyOf(r.from)
    const to = keyOf(r.to)
    const calFrom = keyOf(r.calFrom)
    const calTo = keyOf(r.calTo)
    const active = new Set()
    const values = []
    const byDay = new Map()
    const per = providers.map((p) => {
      const s = { tokens: 0, messages: 0, sessions: 0, cost: 0, days: 0 }
      for (const [k, d] of Object.entries(p.days)) {
        if (k < calFrom || k > calTo || !(d.tokens > 0 || d.messages > 0)) continue
        if (d.tokens > 0) values.push(d.tokens)
        if (k < from || k > to) continue
        for (const f of ['tokens', 'messages', 'sessions', 'cost']) s[f] += d[f] ?? 0
        if (d.tokens > 0) (s.days++, active.add(k), byDay.set(k, (byDay.get(k) ?? 0) + d.tokens))
      }
      return s
    })
    // one scale for every calendar: the square is full at the 95th percentile day (a single huge day doesn't wash the
    // rest out), and each step down is a quarter of the way in square root, so quiet days still show
    values.sort((x, y) => x - y)
    const cap = values.length ? values[values.length >= 20 ? Math.floor(0.95 * (values.length - 1)) : values.length - 1] : 0
    // streaks: days in a row with anything, in any provider
    let longest = 0
    let run = 0
    let busiest = null
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
      const k = keyOf(d)
      run = active.has(k) ? run + 1 : 0
      longest = Math.max(longest, run)
      if (byDay.has(k) && (!busiest || byDay.get(k) > byDay.get(busiest))) busiest = k
    }
    return { per, active: active.size, longest, busiest, cap, level: (v) => (v > 0 && cap > 0 ? Math.max(1, Math.min(4, Math.ceil(4 * Math.sqrt(v / cap)))) : 0) }
  }

  // What the tokens were, in a line for a tooltip: most of any day is context read again from the cache.
  const kindsText = (k) => [['read new', k.input], ['re-read from cache', k.cached], ['written to cache', k.written], ['written by the models', k.output]].filter(([, v]) => v > 0).map(([label, v]) => `${big(v)} ${label}`).join(' · ')

  // ---- drawing ----
  // A line of facts, each kept whole when the line wraps; what it would cost at API prices last, when there's a price.
  // (each fact but the last carries its dot, so a line that wraps never starts with one)
  const factsHTML = (list, cost) => `${[...list.map((f) => `<span>${f}`), cost >= 0.005 && `<span class="us-cost" title="${esc(COST_NOTE)}"><b>≈ ${money(cost)}</b> at API prices`].filter(Boolean).join('<i>·</i></span> ')}</span>`
  const tile = (label, value, sub, title = '') => `<div class="us-tile"${title ? ` title="${esc(title)}"` : ''}><span>${label}</span><b>${value}</b><small>${sub}</small></div>`

  // ---- the filters: one row over everything they narrow ----
  // The computers as a switch (all of them added up, or one), then a menu for each other kind; what a click on a row
  // picked (a model, a folder) sits beside them as a chip. The row is always there, so picking one moves nothing.
  function filtersHTML(v) {
    const here = scopeNow() === 'here'
    const computers = data?.computers ?? []
    const seg = computers.length > 1 && computers.length <= 3
    const i = filters.computer === null ? 0 : 1 + computers.findIndex((c) => c.slug === filters.computer)
    const machine = !seg ? '' : `<div class="seg ready us-comp" role="group" aria-label="Which computer" style="--n:${computers.length + 1};--i:${Math.max(0, i)}">${
      [{ slug: '', label: 'All computers', tip: 'Every computer, added up' }, ...computers.map((c) => ({ slug: c.slug, label: c.here ? upFirst(THIS_COMPUTER) : c.name, tip: c.here ? `Only ${c.name}` : `Only ${c.name}${c.online ? '' : ', as it last said'}` }))]
        .map((c, j) => `<button type="button" class="${j === Math.max(0, i) ? 'on' : ''}" aria-pressed="${j === Math.max(0, i)}" data-computer="${esc(c.slug)}" title="${esc(c.tip)}">${esc(c.label)}</button>`).join('')}</div>`
    const menu = (dim, cls = '') => {
      const on = filters[dim] !== null
      const t = on ? thing(dim, filters[dim], 16) : null
      return `<button type="button" class="btn has-menu us-f${on ? ' on' : ''}${cls}" data-menu="${dim}" aria-haspopup="menu" title="${esc(on ? `Only ${t.label}: pick another, or all` : `Narrow to one ${DIMS[dim].short.toLowerCase()}`)}">${on ? `<span class="us-fi">${t.icon}</span><span class="us-fl">${esc(t.label)}</span>` : esc(DIMS[dim].all)}${ICONS.chevron}</button>`
    }
    const chip = (dim) => {
      if (filters[dim] === null) return ''
      const t = thing(dim, filters[dim], 16)
      return `<button type="button" class="btn us-chip" data-clear="${dim}" title="${esc(`Only ${t.tip || t.label}. Click to show every ${DIMS[dim].short.toLowerCase()} again`)}"><span class="us-fi">${t.icon}</span><span class="us-fl">${esc(t.label)}</span>${ICONS.close}</button>`
    }
    const any = Object.entries(filters).some(([dim, x]) => x !== null && !(dim === 'ws' && here))
    // (a few computers: a switch, and in a narrow window the menu instead)
    return `<div class="us-filters${seg ? ` has-seg c${computers.length}` : ''}${here ? '' : ' all'}" role="toolbar" aria-label="Filters">${machine}${computers.length > 1 ? menu('computer', ' us-comp-menu') : ''}${here ? '' : menu('ws')}${menu('who')}${v.providers.length > 1 ? menu('provider') : ''}${chip('model')}${chip('dir')}${
      any ? `<button type="button" class="btn plain us-clear" data-clear="all">Clear filters</button>` : ''}</div>`
  }

  // ---- tokens over time: a bar a week (a day in a short range), split by one kind ----
  function chartHTML(v, r) {
    const dim = v.by
    const rows = v.rows // the scope, filtered, in the range
    // which bar each day is in, and what each bar says of itself
    const bucket = new Map()
    const bars = []
    if (r.unit === 'day') {
      for (let d = r.from; d <= r.to; d = addDays(d, 1)) (bucket.set(keyOf(d), bars.length), bars.push({ label: dayShort(d), day: keyOf(d), date: d, parts: {}, total: 0 }))
    } else {
      for (let c = 0; c < r.cols; c++) {
        const first = addDays(r.start, c * 7)
        const last = addDays(first, 6)
        const a = first < r.from ? r.from : first
        const b = last > r.to ? r.to : last
        if (a > b) {
          bars.push(null) // a week outside the year
          continue
        }
        for (let d = a; d <= b; d = addDays(d, 1)) bucket.set(keyOf(d), bars.length)
        bars.push({ label: keyOf(a) === keyOf(b) ? dayShort(a) : `${MONTH[a.getMonth()]} ${a.getDate()} – ${a.getMonth() === b.getMonth() ? '' : `${MONTH[b.getMonth()]} `}${b.getDate()}`, date: first, parts: {}, total: 0 })
      }
    }
    for (const f of rows) {
      const bar = bars[bucket.get(f.day)]
      if (!bar || !f.tokens) continue
      const s = v.series(valueOf[dim](f))
      bar.parts[s] = (bar.parts[s] ?? 0) + f.tokens
      bar.total += f.tokens
      ;((bar.ids ??= new Map()).set(valueOf[dim](f), (bar.ids.get(valueOf[dim](f)) ?? 0) + f.tokens))
    }
    const max = niceMax(Math.max(0, ...bars.map((b) => b?.total ?? 0)))
    v.bars = bars
    // the axis under it: a month's name where it starts (weeks), or a few of the days
    let marks = []
    if (r.unit === 'week') {
      const months = []
      bars.forEach((b, i) => {
        if (!b) return
        for (let w = 0; w < 7; w++) {
          const d = addDays(b.date, w)
          if (d.getDate() === 1 && d >= r.calFrom && d <= r.calTo) months.push({ col: i, label: MONTH[d.getMonth()] })
        }
      })
      marks = months.filter((m, i, all) => i === 0 || m.col - all[i - 1].col >= 3)
    } else {
      const step = bars.length <= 7 ? 1 : 5
      marks = bars.map((b, i) => ({ col: i, label: bars.length <= 7 ? DAY[b.date.getDay()] : `${MONTH[b.date.getMonth()]} ${b.date.getDate()}` })).filter((m, i) => (bars.length - 1 - i) % step === 0)
    }
    // the bar Tab stops at: where the keys left off, or the newest one there is (a year's last weeks are still to come)
    const stop = bars[barAt] ? barAt : bars.findLastIndex(Boolean)
    const cols = bars.map((b, i) => {
      if (!b) return '<i class="us-bx"></i>'
      const h = max ? Math.max(b.total > 0 ? 1.5 : 0, (b.total / max) * 100) : 0
      // a part too thin to draw (under a pixel and a half of the plot) goes without, and a bar too short for the
      // hairlines between its parts has none: a sliver of stripes says nothing
      const px = (v) => (v / max) * PLOT
      const parts = SERIES.filter((s) => b.parts[s] > 0 && (px(b.parts[s]) >= 1.5 || b.parts[s] === Math.max(...Object.values(b.parts))))
      const tight = px(b.total) < parts.length * 5
      const segs = parts.map((s) => `<i data-s="${s}" style="flex-grow:${Math.max(1, Math.round((b.parts[s] / b.total) * 1000))}"></i>`).join('')
      return `<button type="button" class="us-bar-col${b.day && b.day === picked ? ' picked' : ''}" data-bar="${i}"${b.day ? ` data-day="${b.day}"` : ''} tabindex="${i === stop ? 0 : -1}" aria-label="${esc(`${b.label}: ${b.total > 0 ? `${big(b.total)} tokens` : 'nothing'}`)}"><i class="us-stack${tight ? ' tight' : ''}" style="height:${h.toFixed(2)}%">${segs}</i></button>`
    }).join('')
    const ticks = max ? [max, max / 2, 0].map((t) => `<span>${big(t)}</span>`).join('') : '<span></span><span></span><span>0</span>'
    // its legend is a list: each entity's colour, name, tokens and share, most first; a click narrows to it
    const all = group(v.rowsBut(dim), dim)
    const whole = all.reduce((n, g) => n + g.tokens, 0)
    const first = all.length <= ROWS + 1 ? all : all.slice(0, ROWS)
    const legend = first.map((g) => rowHTML(dim, g, whole, { series: v.series(g.id), max: all[0].tokens })).join('') + (all.length > first.length ? restHTML(all.slice(first.length), whole, { key: true }) : '')
    const kinds = v.kinds
    const title = r.unit === 'day' ? 'Tokens a day' : 'Tokens a week'
    return `<section class="us-card us-trend" data-by="${dim}">
      <header class="us-ph"><h2>${title}</h2><span class="us-facts"></span>
        <div class="seg ready us-by" role="group" aria-label="Split the chart by" style="--n:${kinds.length};--i:${Math.max(0, kinds.indexOf(dim))}">${kinds.map((k) => `<button type="button" class="${k === dim ? 'on' : ''}" aria-pressed="${k === dim}" data-by="${k}" title="By ${DIMS[k].short.toLowerCase()}">${DIMS[k].label}</button>`).join('')}</div></header>
      <div class="us-trend-body">
        <div class="us-plot${whole ? '' : ' none'}" style="--n:${bars.length}">
          <div class="us-ya" aria-hidden="true">${ticks}</div>
          <div class="us-bars" role="group" aria-label="${esc(`${title}, by ${DIMS[dim].short.toLowerCase()}`)}">${cols}</div>
          <div class="us-xa${r.unit === 'day' ? ' daily' : ''}" aria-hidden="true">${marks.map((m) => `<span style="grid-column:${m.col + 1}">${m.label}</span>`).join('')}</div>
        </div>
        <div class="us-legend-list" role="group" aria-label="${esc(DIMS[dim].label)}">${legend || `<p class="us-quiet">Nothing ${esc(r.words)}</p>`}</div>
      </div>
    </section>`
  }

  // A row of a list: its picture, its name, its tokens and share, a bar under them. A button: a click narrows
  // everything to it, another lets go. series: the chart's colour for it (the row is its legend); none: an ink bar.
  function rowHTML(dim, g, whole, { series = null, max, hue = null } = {}) {
    const t = thing(dim, g.id)
    const scoped = dim === 'ws' && scopeNow() === 'here' // (the workspace is the scope's: not a filter)
    const on = filters[dim] === g.id && !scoped
    const off = filters[dim] !== null && !on && !scoped
    const fill = series ? ` data-s="${series}"` : hue ? ` data-hue="${hue}"` : ''
    return `<button type="button" class="us-row${series ? ' key' : ''}${off ? ' off' : ''}" data-f="${dim}" data-v="${esc(g.id)}" aria-pressed="${on}" title="${esc(`${t.tip || t.label}\n${on ? 'Click to show everything again' : 'Click to see only this'}`)}">${
      series ? `<i class="us-sw" data-s="${series}"></i>` : ''}<span class="us-ic">${t.icon}</span><span class="us-name"><span>${esc(t.label)}</span>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</span><b>${big(g.tokens)}</b><em>${pct(g.tokens, whole)}</em><i class="us-bar"><i style="width:${Math.max(2, (g.tokens / max) * 100).toFixed(1)}%"${fill}></i></i></button>`
  }
  // The rows past a list's first ones, as one: how many, and what they add up to.
  const restHTML = (rest, whole, { key = false, more = '' } = {}) => {
    const tokens = rest.reduce((n, g) => n + g.tokens, 0)
    const inner = `${key ? '<i class="us-sw" data-s="other"></i>' : ''}<span class="us-ic"></span><span class="us-name">${rest.length} more</span><b>${big(tokens)}</b><em>${pct(tokens, whole)}</em>`
    return more ? `<button type="button" class="us-row rest${key ? ' key' : ''}" data-more="${more}" title="Show all of them">${inner}</button>` : `<div class="us-row rest${key ? ' key' : ''}">${inner}</div>`
  }
  // A list of one kind, in the range or on the day picked: its first rows, then "N more" (a click shows them all).
  function listHTML(dim, rows) {
    const all = group(rows, dim)
    if (!all.length) return `<div class="us-col"><h3 class="section-label">${DIMS[dim].label}</h3><p class="us-quiet">Nothing</p></div>`
    const whole = all.reduce((n, g) => n + g.tokens, 0)
    const first = open.has(dim) || all.length <= ROWS ? all : all.slice(0, ROWS - 1)
    const rest = all.slice(first.length)
    const hue = (g) => (dim === 'model' ? hueOf(g.id.slice(0, g.id.indexOf('\t'))) : dim === 'provider' ? hueOf(g.id) : null)
    return `<div class="us-col"><h3 class="section-label">${DIMS[dim].label}${all.length > 1 ? `<small>${all.length}</small>` : ''}</h3>${first.map((g) => rowHTML(dim, g, whole, { max: all[0].tokens, hue: hue(g) })).join('')}${
      rest.length ? restHTML(rest, whole, { more: dim })
      : open.has(dim) && all.length > ROWS ? `<button type="button" class="us-row rest" data-more="${dim}"><span class="us-ic"></span><span class="us-name">Show fewer</span></button>` : ''}</div>`
  }

  function calendarHTML(p, r, t, today) {
    const todayKey = keyOf(today)
    const from = keyOf(r.calFrom)
    const to = keyOf(r.calTo)
    const inFrom = keyOf(r.from)
    const inTo = keyOf(r.to)
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
        cells += `<button class="us-c${k === todayKey ? ' today' : ''}${k < inFrom || k > inTo ? ' out' : ''}" data-day="${k}" data-l="${t.level(v)}" tabindex="${k === tab ? 0 : -1}"${k === picked ? ' aria-pressed="true"' : ''} aria-label="${label}"></button>`
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

  function providerHTML(p, s, r, t, today) {
    // this computer's account, when its part is on screen
    const u = filters.computer === null || computerOf(filters.computer)?.here ? state?.usage?.[p.id] : null
    const line = s && (s.tokens > 0 || s.messages > 0)
      ? factsHTML([`<b>${big(s.tokens)}</b> tokens`, things(s.messages, 'message', { bold: true }), things(s.days, 'day', { bold: true })], s.cost)
      : p.ghost ? '' : Object.keys(p.days).length ? `Nothing ${r.words}` : `Nothing ${Object.values(filters).some((x) => x !== null) ? 'in what’s picked' : scopeNow() === 'here' ? 'in this workspace' : r.words}`
    return `<section class="us-card us-prov" data-prov="${esc(p.id)}" data-hue="${hueOf(p.id)}">
      <header class="us-ph"><i class="us-dot"></i><h2>${esc(p.label)}</h2><span class="us-facts">${line}</span>${
        u?.windows?.length ? `<span class="us-lim" title="${esc(usageTip(u))}">${limitNums(u)}</span>` : ''}</header>
      ${calendarHTML(p, r, t, today)}
    </section>`
  }

  // Who used it, where and on which models: the range's, or the picked day's. Each list is of everything else that's
  // picked (a list of agents shows them all, the picked one marked).
  function detailHTML(v, r, today) {
    const day = picked && dateOf(picked)
    const within = (rows) => (day ? rows.filter((f) => f.day === picked) : rows.filter((f) => f.day >= v.from && f.day <= v.to))
    const rows = within(v.all)
    const s = sum(rows)
    const title = day ? dayLong(day, today) : r.label
    const none = !(s.tokens > 0 || s.messages > 0)
    const line = none ? (day ? 'Nothing ran that day' : '')
      : factsHTML([`<abbr title="${esc(`${TOKENS_NOTE}\n${kindsText(s)}`)}"><b>${big(s.tokens)}</b> tokens</abbr>`, things(s.messages, 'message', { bold: true }), things(s.sessions, 'session', { bold: true })], s.cost)
    const dims = [scopeNow() === 'all' && 'ws', 'who', 'dir', 'model', (data?.computers?.length ?? 0) > 1 && 'computer'].filter(Boolean)
    return `<section class="us-card us-detail${day ? ' day' : ''}">
      <header class="us-ph"><h2>${esc(title)}</h2><span class="us-facts">${line}</span>${day ? `<button class="btn sm" data-us="clear">Back to ${esc(r.id === 'last' ? 'the last 12 months' : r.label.replace(/^Last/, 'the last'))}</button>` : ''}</header>
      <div class="us-cols${none ? ' none' : ''}" style="--k:${dims.length}">${dims.map((dim) => listHTML(dim, within(v.rowsButAll(dim)))).join('')}</div>
    </section>`
  }

  // What a computer that has nothing to show says for itself, when its part is what you're looking at.
  function noticesHTML() {
    const here = scopeNow() === 'here' ? data?.spaces?.[hereKey()] : null
    const out = []
    for (const c of data?.computers ?? []) {
      if (c.here || (filters.computer !== null && filters.computer !== c.slug)) continue
      const hosts = here?.ownerName === c.name
      const nothing = !(c.got > 0)
      if (c.note) out.push(`${esc(c.note)}.${hosts ? ` ${esc(here.name)} is hosted there, so until then this is only what ${esc(THIS_COMPUTER)} used in it.` : ''}`)
      else if (nothing && !c.online) out.push(`${esc(c.name)} is off and hasn't said what it used yet.${hosts ? ` ${esc(here.name)} is hosted there, so this is only what ${esc(THIS_COMPUTER)} used in it.` : ' Its part shows once it has been on.'}`)
    }
    return `<div class="us-notices">${out.map((text) => `<p class="us-notice">${ICONS.computers}<span>${text}</span></p>`).join('')}</div>`
  }

  // Where the numbers come from, in a line: each computer's own logs, and when each last answered.
  function sourceText() {
    const when = (t) => (Date.now() - t < 60000 ? 'just now' : `${ago(t)} ago`)
    const mine = data.computers.find((c) => c.here)
    const others = data.computers.filter((c) => !c.here && c.got > 0)
    const parts = [`${THIS_COMPUTER}’s${mine?.at ? `, read ${when(mine.at)}` : ''}`, ...others.map((c) => `${esc(c.name)}’s, as it said ${when(c.got)}${c.online ? '' : ' (it’s off now)'}`)]
    return `From Claude Code’s and Codex’s own logs: ${parts.join('; ')}. A conversation’s workspace is written down as its agent takes a prompt; earlier ones go by the agent’s name and folder.`
  }

  function draw() {
    if (!shown || !data) return
    const today = new Date()
    const mine = data.computers.find((c) => c.here)
    const reading = mine?.reading
    const none = !facts.length
    // The first look ever (the logs have never been read through): the header says how far along it is and, with
    // nothing in yet, the two calendars everyone has stand empty, so the days fill in where they are. Every look after
    // that only reads what was added: it's said when that's a lot, and otherwise nothing on the page changes for it.
    const first = Boolean(reading && !mine.at)
    const busy = Boolean(reading && (first || reading.total > 64e6))
    const empty = none && !first
    const r = rangeOf(range, today)
    if (picked && (picked < keyOf(r.calFrom) || picked > keyOf(r.calTo))) picked = null
    const here = scopeNow() === 'here'
    const space = here ? data.spaces?.[hereKey()] : null
    // a filter that names something that isn't there any more (a computer forgotten, another workspace on screen) lets go
    for (const dim of Object.keys(filters)) if (filters[dim] !== null && dim !== 'ws' && !slice(dim).some((f) => valueOf[dim](f) === filters[dim])) filters[dim] = null
    if (!here && filters.ws !== null && !slice('ws').some((f) => f.ws === filters.ws)) filters.ws = null

    // ---- the header: whose usage, in words; the switch; the range ----
    const done = reading?.total ? Math.min(100, Math.floor((reading.done / reading.total) * 100)) : 0
    const others = data.computers.filter((c) => !c.here)
    const where = filters.computer !== null ? computerName(filters.computer).replace(/^This/, 'this') : others.length ? `${THIS_COMPUTER} and ${others.length === 1 ? others[0].name : `${others.length} linked computers`}` : THIS_COMPUTER
    headEl.querySelector('.ph-sub').textContent = busy ? `Reading Claude Code’s and Codex’s logs${reading.total ? ` · ${done}%` : '…'}` : here ? `${space?.name ?? state.workspace.name}’s agents, on ${where}` : `Claude Code and Codex, on ${where}`
    // (said whole or not at all: with a long workspace name in the switch there may be no room for it)
    const sub = headEl.querySelector('.ph-sub')
    sub.classList.remove('hidden')
    if (sub.scrollWidth > sub.clientWidth + 1) sub.classList.add('hidden')
    if (rangeBtn.firstChild.nodeValue !== r.label) rangeBtn.firstChild.nodeValue = r.label
    rangeBtn.classList.toggle('hidden', empty)
    const hereBtn = scopeSeg.querySelector('[data-scope=here]')
    const w = state?.workspace
    const label = w ? `${wsTile(w, { size: 16 })}<span>${esc(w.name)}</span>` : ''
    if (hereBtn.dataset.html !== label) (hereBtn.innerHTML = label, hereBtn.dataset.html = label)
    hereBtn.title = w ? `What ${w.name}’s agents used` : ''
    scopeSeg.classList.toggle('hidden', empty || !hereKey())
    scopeSeg.style.setProperty('--n', 2)
    scopeSeg.style.setProperty('--i', here ? 0 : 1)
    for (const b of scopeSeg.children) (b.classList.toggle('on', (b.dataset.scope === 'here') === here), b.setAttribute('aria-pressed', String((b.dataset.scope === 'here') === here)))

    root.querySelector('.us-prog').classList.toggle('on', busy)
    root.querySelector('.us-prog i').style.transform = `scaleX(${done / 100})`
    root.querySelector('.us-none').classList.toggle('hidden', !empty)
    root.querySelector('.us-scroll').classList.toggle('hidden', empty)
    if (empty) return

    // ---- the rows on screen ----
    const from = keyOf(r.from)
    const to = keyOf(r.to)
    const all = slice() // the scope, with every filter, on any day
    const rows = all.filter((f) => f.day >= from && f.day <= to)
    const scoped = facts.filter((f) => !here || f.ws === hereKey()) // the scope, nothing filtered: what colours go by
    const kinds = [!here && 'ws', 'who', 'provider', data.computers.length > 1 && 'computer'].filter(Boolean)
    const dim = kinds.includes(by[here ? 'here' : 'all']) ? by[here ? 'here' : 'all'] : kinds[0]
    // each provider's days, for its calendar: Claude and Codex first
    const order = (id) => (id === 'claude' ? 0 : id === 'codex' ? 1 : 2)
    const days = new Map()
    for (const f of all) {
      const d = ((days.get(f.provider) ?? days.set(f.provider, {}).get(f.provider))[f.day] ??= { tokens: 0, messages: 0, sessions: 0, cost: 0 })
      d.tokens += f.tokens
      d.messages += f.messages
      d.sessions += f.sessions
      d.cost += f.cost
    }
    // a calendar for every provider that has anything anywhere, whatever is picked now: a filter or another workspace
    // empties a calendar, it doesn't take it away (and nothing under it moves)
    const everyone = [...new Set(facts.map((f) => f.provider))]
    let providers = everyone.sort((x, y) => order(x) - order(y) || x.localeCompare(y)).map((id) => ({ id, label: providerLabel(id), days: days.get(id) ?? {} }))
    if (!providers.length) providers = ['claude', 'codex'].map((id) => ({ id, label: upFirst(id), days: {}, ghost: true }))
    const t = tally(providers, r, today)
    const total = sum(rows)
    view = {
      by: dim, kinds, rows, all, from, to, providers, series: seriesOf(dim, scoped),
      rowsBut: (d) => slice(d).filter((f) => f.day >= from && f.day <= to), rowsButAll: (d) => slice(d),
    }

    // ---- the tiles: the range's numbers, and how much of everything this is ----
    // (everything: what the same computers used in the range, nothing else filtered)
    const everything = sum(facts.filter((f) => f.day >= from && f.day <= to && (filters.computer === null || f.computer === filters.computer)), ['tokens']).tokens
    const inClique = sum(rows.filter((f) => f.ws !== OUT), ['tokens']).tokens
    const one = here ? space?.name ?? 'this workspace' : filters.ws !== null ? thing('ws', filters.ws).label : null
    const last = one
      ? tile('Share of everything', pct(total.tokens, everything), everything > 0 ? `of ${big(everything)} tokens in all` : r.words, `How much of everything Claude Code and Codex used ${r.words} this is (${one}${Object.entries(filters).some(([d, x]) => x !== null && d !== 'ws' && d !== 'computer') ? ', as filtered' : ''}): every workspace, and what you ran outside ${PRODUCT_NAME}.`)
      : tile(`Through ${esc(PRODUCT_NAME)}`, pct(inClique, total.tokens), total.tokens > inClique ? `${pct(total.tokens - inClique, total.tokens)} ran outside it` : total.tokens > 0 ? 'nothing ran outside it' : r.words, `How much of this your clique's agents used. The rest is Claude Code and Codex sessions you started yourself.`)
    // What's under the pointer stays under it: a filter can make the page shorter than where it's scrolled to, and the
    // scroll would jump back by the difference (the row just clicked gone from under the pointer). So the page keeps
    // room down to where it's scrolled; scrolling back up gives it back on the next draw.
    const scroller = root.querySelector('.us-scroll')
    const top = scroller.scrollTop
    wrap.style.minHeight = ''
    const steps = [1, 2, 3, 4].map((l) => `<i data-l="${l}" title="${t.cap ? (l < 4 ? `Up to ${big(t.cap * (l / 4) ** 2)} tokens a day` : `More than ${big(t.cap * (3 / 4) ** 2)} tokens a day`) : ''}"></i>`).join('')
    morph(wrap, `${filtersHTML(view)}${noticesHTML()}
      <div class="us-tiles">${
      tile('Tokens', big(total.tokens), total.cost >= 0.005 ? `≈ ${money(total.cost)} at API prices` : r.words, [TOKENS_NOTE, kindsText(total), total.cost >= 0.005 && COST_NOTE].filter(Boolean).join('\n'))}${
      tile('Messages', count(total.messages), `in ${things(total.sessions, 'session')}`, `What you, the clique and ${PRODUCT_NAME} sent to Claude Code and Codex: each one starts a turn.`)}${
      tile('Active days', count(t.active), t.longest > 1 ? `${plural(t.longest, 'day')} in a row at most` : t.busiest ? `busiest ${MONTH[dateOf(t.busiest).getMonth()]} ${dateOf(t.busiest).getDate()}` : r.words, `Days anything ran${t.busiest ? `. The busiest was ${dayShort(dateOf(t.busiest))}` : ''}.`)}${last}</div>
      ${chartHTML(view, r)}
      ${providers.map((p, i) => providerHTML(p, t.per[i], r, t, today)).join('')}
      <div class="us-foot"><span class="us-note">${sourceText()}</span>
        <span class="us-legend" title="${esc(TOKENS_NOTE)} The same scale in every calendar.">Less<i data-l="0"></i>${steps}More</span></div>
      ${detailHTML(view, r, today)}`)
    if (top > 0 && scroller.scrollHeight < top + scroller.clientHeight) {
      wrap.style.minHeight = `${top + scroller.clientHeight}px`
      scroller.scrollTop = top
    }
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
    if (next?.computers) (data = next, facts = read(next))
    draw()
    // sooner while this computer reads its logs, or a linked one is being asked (or reads its own)
    const soon = next?.computers?.some((c) => c.reading || c.asking)
    if (shown) timer = setTimeout(refresh, !next ? 15000 : soon ? 700 : 120000)
  }

  // ---- the header's controls ----
  rangeBtn.addEventListener('click', (e) => {
    const today = new Date()
    const items = [...RANGES.map(([act, label]) => ({ label, act, on: range === act })), '-', ...years(today).map((y) => ({ label: String(y), act: String(y), on: range === String(y) }))]
    popMenu(e.currentTarget, items, (act) => {
      range = act
      barAt = null
      store.set('clique.usage.range', range)
      hideTip()
      draw()
    })
  })
  scopeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope]')
    if (!b || b.dataset.scope === scope) return
    scope = b.dataset.scope
    store.set('clique.usage.scope', scope)
    filters.ws = null
    hideTip()
    draw()
  })

  // ---- filters: a menu's pick, a row's click, a chip let go ----
  function setFilter(dim, value) {
    filters[dim] = filters[dim] === value ? null : value
    hideTip()
    draw()
  }
  function filterMenu(button, dim) {
    const all = group(view.rowsBut(dim), dim)
    if (filters[dim] !== null && !all.some((g) => g.id === filters[dim])) all.push({ id: filters[dim], tokens: 0 }) // (nothing of it in these days: still the one picked)
    const items = [{ label: DIMS[dim].all, act: '\u0001all', on: filters[dim] === null }, '-', ...all.slice(0, 40).map((g) => {
      const t = thing(dim, g.id, 16)
      return { label: t.sub ? `${t.label} (${t.sub})` : t.label, act: g.id, on: filters[dim] === g.id, icon: `<i class="us-mi">${t.icon}</i>`, hint: big(g.tokens) }
    })]
    popMenu(button, items, (act) => {
      filters[dim] = act === '\u0001all' ? null : act
      hideTip()
      draw()
    })
  }

  // ---- a day: pick it with a click or Enter, move between days with the arrows, Esc lets go ----
  function pick(day) {
    picked = picked === day ? null : day
    draw()
    // its breakdown is under the calendars: brought into view when it's off the bottom, by as little as shows it
    if (picked) wrap.querySelector('.us-detail')?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' })
  }
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-us=clear]')) return void (hideTip(), pick(picked))
    const comp = e.target.closest('[data-computer]')
    if (comp) return void ((filters.computer = comp.dataset.computer || null), hideTip(), draw())
    const menu = e.target.closest('[data-menu]')
    if (menu) return filterMenu(menu, menu.dataset.menu)
    const clear = e.target.closest('[data-clear]')
    if (clear) {
      for (const dim of clear.dataset.clear === 'all' ? Object.keys(filters) : [clear.dataset.clear]) filters[dim] = null
      hideTip()
      draw()
      if (!wrap.contains(document.activeElement)) wrap.querySelector('.us-filters [data-menu]:not(.us-comp-menu), .us-filters button')?.focus({ preventScroll: true })
      return
    }
    const split = e.target.closest('.us-by [data-by]')
    if (split) {
      const key = scopeNow()
      by[key] = split.dataset.by
      store.set(`clique.usage.by.${key}`, by[key])
      return void (hideTip(), draw())
    }
    const more = e.target.closest('[data-more]')
    if (more) return void (open.has(more.dataset.more) ? open.delete(more.dataset.more) : open.add(more.dataset.more), draw())
    const row = e.target.closest('.us-row[data-f]')
    if (row) return setFilter(row.dataset.f, row.dataset.v)
    const c = e.target.closest('.us-c, .us-bar-col[data-day]')
    if (!c) return
    cursor = c.dataset.day
    pick(c.dataset.day)
  })
  wrap.addEventListener('keydown', (e) => {
    // the chart: the arrows move along its bars
    const bar = e.target.closest?.('.us-bar-col')
    // (Esc lets a day go, picked from a bar as from a square)
    if (bar && e.key === 'Escape' && picked) return void (e.preventDefault(), e.stopPropagation(), pick(picked))
    if (bar && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      let next = bar
      do next = e.key === 'ArrowLeft' ? next.previousElementSibling : next.nextElementSibling
      while (next && !next.matches('.us-bar-col'))
      if (!next) return
      barAt = Number(next.dataset.bar) // (kept: the next redraw leaves the tab stop where the keys are)
      bar.tabIndex = -1
      next.tabIndex = 0
      return next.focus()
    }
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

  // ---- the numbers over what the pointer or the focus is on: a day's square, or a bar of the chart ----
  function place(at) {
    tip.classList.add('on')
    const box = root.getBoundingClientRect()
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    const above = at.top - h - 8 >= box.top
    tip.style.left = `${Math.round(Math.max(8, Math.min(at.left + at.width / 2 - w / 2 - box.left, box.width - w - 8)))}px`
    tip.style.top = `${Math.round((above ? at.top - h - 8 : at.bottom + 8) - box.top)}px`
  }
  function tipFor(c) {
    const p = view?.providers.find((x) => x.id === c.closest('.us-prov')?.dataset.prov)
    const d = p?.days[c.dataset.day]
    const when = `${dayShort(dateOf(c.dataset.day))}${p ? ` · ${p.label}` : ''}`
    tip.innerHTML = d && d.tokens > 0
      ? `<b>${big(d.tokens)} tokens</b><span>${[things(d.messages, 'message'), things(d.sessions, 'session'), d.cost >= 0.005 && `≈ ${money(d.cost)}`].filter(Boolean).join(' · ')}</span><small>${esc(when)}</small>`
      : `<b>Nothing</b><small>${esc(when)}</small>`
    place(c.getBoundingClientRect())
  }
  // a bar: its total, then each part of it by name, most first (the value leads, the name follows)
  function tipForBar(el) {
    const b = view?.bars?.[Number(el.dataset.bar)]
    if (!b) return hideTip()
    const parts = [...(b.ids ?? [])].sort((x, y) => y[1] - x[1])
    const top = parts.slice(0, 6)
    const rest = parts.slice(6).reduce((n, [, v]) => n + v, 0)
    tip.innerHTML = b.total > 0
      ? `<b>${big(b.total)} tokens</b><small>${esc(b.label)}</small><div class="us-tip-rows">${top.map(([id, v]) => `<span><i class="us-key" data-s="${view.series(id)}"></i><b>${big(v)}</b>${esc(thing(view.by, id).label)}</span>`).join('')}${rest ? `<span><i class="us-key" data-s="other"></i><b>${big(rest)}</b>${parts.length - 6} more</span>` : ''}</div>`
      : `<b>Nothing</b><small>${esc(b.label)}</small>`
    place((el.querySelector('.us-stack')?.offsetHeight ? el.querySelector('.us-stack') : el).getBoundingClientRect())
  }
  const hideTip = () => tip.classList.remove('on')
  wrap.addEventListener('pointerover', (e) => {
    const c = e.target.closest('.us-c')
    const bar = !c && e.target.closest('.us-bar-col')
    if (c) tipFor(c)
    else if (bar) tipForBar(bar)
    else hideTip()
  })
  wrap.addEventListener('pointerleave', hideTip)
  wrap.addEventListener('focusin', (e) => {
    if (e.target.matches?.('.us-c:focus-visible')) tipFor(e.target)
    else if (e.target.matches?.('.us-bar-col:focus-visible')) tipForBar(e.target)
  })
  wrap.addEventListener('focusout', hideTip)
  root.querySelector('.us-scroll').addEventListener('scroll', hideTip, { passive: true })

  return {
    // the app's state: the workspace on screen and the limits may have changed
    render(next) {
      const was = state?.workspace?.id
      state = next
      // another workspace on screen: its usage, and what's known of it asked for again
      if (shown && was !== next?.workspace?.id) (hideTip(), refresh())
      draw()
    },
    setVisible(on) {
      if (on === shown) return
      shown = on
      clearTimeout(timer)
      hideTip()
      if (on) {
        // (its parts rise into place as it opens: usage.css; not again when a redraw rebuilds one of them)
        wrap.classList.add('entering')
        setTimeout(() => wrap.classList.remove('entering'), 700)
        draw()
        refresh()
      }
    },
    refresh,
  }
}

// Shared rendering for the three views. Plain functions and template strings; views re-render on every state push.
/* global crew, avatarHTML, avatarOf, agentColor, mountVoice */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const svg = (paths, attrs = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${attrs}>${paths}</svg>`

// Crew's mark: three little mochis in a huddle. Eyes are evenodd holes, so the same shape works as the
// menu bar template icon; each buddy is its own path (.m0 .m1 .m2) so CSS can make them hop in turn.
function markSVG(viewBox = '0 0 24 24') {
  const n = (v) => +v.toFixed(2)
  const hole = (x, y, r) => `M${n(x - r)} ${n(y)}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0 ${n(-2 * r)} 0Z`
  const mochi = (cx, w, h, rc, eye, gap, tilt) => {
    const by = 21, l = cx - w / 2, r = cx + w / 2, t = by - h, ey = by - h * 0.42
    const d = `M${n(l)} ${n(by - rc)}C${n(l)} ${n(by - h * 0.78)} ${n(cx - w * 0.33)} ${n(t)} ${n(cx)} ${n(t)}C${n(cx + w * 0.33)} ${n(t)} ${n(r)} ${n(by - h * 0.78)} ${n(r)} ${n(by - rc)}Q${n(r)} ${by} ${n(r - rc)} ${by}L${n(l + rc)} ${by}Q${n(l)} ${by} ${n(l)} ${n(by - rc)}Z`
    return { d: d + hole(cx - gap, ey, eye) + hole(cx + gap, ey, eye), t: tilt ? `rotate(${tilt} ${cx} ${by})` : '' }
  }
  const buddies = [mochi(3.85, 7.3, 6.6, 2.3, 0.72, 1.3, 4), mochi(12, 9.4, 9.4, 2.8, 1, 1.75, 0), mochi(20.15, 7.3, 6.6, 2.3, 0.72, 1.3, -4)]
  return `<svg viewBox="${viewBox}" fill="currentColor" class="mark">${buddies
    .map((b, i) => `<path class="m${i}" fill-rule="evenodd"${b.t ? ` transform="${b.t}"` : ''} d="${b.d}"/>`)
    .join('')}</svg>`
}

const ICONS = {
  mark: markSVG(),
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  auto: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>'),
  braces: svg('<path d="M8.5 4C6.6 4 6 5 6 6.8v2.4C6 10.6 5.2 11.6 4 12c1.2.4 2 1.4 2 2.8v2.4C6 19 6.6 20 8.5 20M15.5 4c1.9 0 2.5 1 2.5 2.8v2.4c0 1.4.8 2.4 2 2.8-1.2.4-2 1.4-2 2.8v2.4c0 1.8-.6 2.8-2.5 2.8"/>'),
  power: svg('<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>'),
  restart: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 'stroke-width="2.4"'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>', 'stroke-width="2.4"'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="2.4"'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.2"'),
  import: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15"/>'),
  export: svg('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15"/>'),
  task: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8 12.2l2.8 2.8L16.2 9.4"/>', 'stroke-width="2"'),
  feature: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.6l2.2 6.3 6.3 2.2-6.3 2.2L12 19.6l-2.2-6.3-6.3-2.2 6.3-2.2z"/></svg>',
  bug: svg('<path d="M8.6 7.6a3.4 3.4 0 0 1 6.8 0"/><rect x="6.6" y="7.6" width="10.8" height="12.4" rx="5.4"/><path d="M12 11v9M3.8 12.6h2.8M17.4 12.6h2.8M4.6 8l2.3 1.6M19.4 8l-2.3 1.6M4.6 18l2.4-1.5M19.4 18 17 16.5"/>'),
  fresh: svg('<path d="M20.2 12a8.2 8.2 0 0 1-12 7.3L3.8 20.4l1.1-4.2A8.2 8.2 0 1 1 20.2 12z"/><path d="M12 8.4l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9z" fill="currentColor" stroke-width="1"/>'),
  computers: svg('<rect x="2.5" y="4" width="13" height="9.5" rx="1.8"/><path d="M6 17h6M9 13.5V17"/><rect x="17.5" y="7" width="4.5" height="10" rx="1.2"/>'),
  plane: svg('<path d="M21 3 3 10.4l7.2 2.4L12.6 20 21 3z"/><path d="m10.2 12.8 4.6-4.6"/>'),
  shield: svg('<path d="M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6l-7-3z"/><path d="m9 12 2 2 4-4"/>'),
  ask: svg('<path d="M4 12a8 8 0 1 1 3.3 6.5L4 20l1.2-3.7A8 8 0 0 1 4 12z"/><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.9-2.2 3.1M12 16.6v.1"/>'),
  plan: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>'),
  reply: svg('<path d="M9.5 14.5 4 9l5.5-5.5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5V20"/>'),
  subs: svg('<circle cx="5.5" cy="5.5" r="2.5"/><circle cx="18.5" cy="11" r="2.5"/><circle cx="18.5" cy="19" r="2.5"/><path d="M5.5 8v7a4 4 0 0 0 4 4H16M5.5 11H16"/>'),
  thread: svg('<path d="M5 4v6.5A3.5 3.5 0 0 0 8.5 14H19M15 10l4 4-4 4"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 'stroke-width="2.2"'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 'stroke-width="2.4"'),
  dash: svg('<path d="M7 12h10"/>', 'stroke-width="2.8"'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h1M10.5 10h1M14.5 10h1M6.5 14h11"/>', 'stroke-width="2.2"'),
  sparkles: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 3.5l1.9 5.4 5.4 1.9-5.4 1.9L10 18.1l-1.9-5.4-5.4-1.9 5.4-1.9z"/><path d="M18.5 13.6l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.6 2.5 4.8 13.2c-.4.5 0 1.2.6 1.2H11l-1.2 7.1c-.1.6.7.9 1 .4l8.8-10.7c.4-.5 0-1.2-.6-1.2H13.4l1.2-7.1c.1-.6-.7-.9-1-.4z"/></svg>',
}

// Update el's children to match html without recreating unchanged nodes. Avatars (data-sig) are left alone
// unless their look or mood changed, so their animations don't restart on every status tick.
function morph(el, html) {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  patchChildren(el, tpl.content)
}

function patchChildren(parent, next) {
  const olds = [...parent.childNodes]
  const news = [...next.childNodes]
  news.forEach((n, i) => {
    const o = olds[i]
    if (!o) return parent.appendChild(n)
    const same = o.nodeName === n.nodeName && o.dataset?.sig === n.dataset?.sig && o.dataset?.agent === n.dataset?.agent && o.dataset?.name === n.dataset?.name
    if (!same) return parent.replaceChild(n, o)
    if (o.nodeType === Node.TEXT_NODE) {
      if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue
      return
    }
    if (o.nodeType !== Node.ELEMENT_NODE || o.dataset.sig) return
    for (const { name } of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name)
    for (const { name, value } of [...n.attributes]) if (o.getAttribute(name) !== value) o.setAttribute(name, value)
    if (o.type === 'checkbox') o.checked = n.hasAttribute('checked')
    patchChildren(o, n)
  })
  for (let i = olds.length - 1; i >= news.length; i--) olds[i].remove()
}

// 42s · 3m 10s · 2h 05m
function duration(ms) {
  const s = Math.round((ms ?? 0) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return m < 10 ? `${m}m ${s % 60}s` : `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// Experience: 10 XP per finished task plus 1 per active minute. Level n needs 25·(n-1)² XP.
function levelOf(stats = {}) {
  const xp = (stats.turns ?? 0) * 10 + Math.floor((stats.activeMs ?? 0) / 60000)
  const lv = Math.floor(Math.sqrt(xp / 25)) + 1
  const from = 25 * (lv - 1) ** 2
  const to = 25 * lv ** 2
  return { lv, xp, toNext: to - xp, progress: (xp - from) / (to - from) }
}

// "Claude · opus · high"
const brainLabel = (a, providers = {}) => [providers[a.provider]?.label ?? a.provider, a.model || 'default', a.effort, a.fast && 'fast'].filter(Boolean).join(' · ')
// The same without the filler, for tight rows: "Codex · high" (Fast has its own chip).
const brainShort = (a, providers = {}) => [providers[a.provider]?.label ?? a.provider, a.model, a.effort].filter(Boolean).join(' · ')

const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}

function ago(ts) {
  const s = (Date.now() - ts) / 1000
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function statusText(a) {
  switch (a.status) {
    case 'working': return `working · ${ago(a.since)}`
    case 'waiting': return 'needs you'
    case 'idle': return 'free'
    case 'starting': return Date.now() - a.since > 15000 ? 'starting… check its terminal' : 'starting…'
    case 'off': return 'off'
    case 'away': return 'unreachable'
    default: return 'exited'
  }
}

// A chip you just clicked keeps its new value until the state agrees, so a push that was already on its way
// doesn't flip it back for a moment. "name:mode" -> { on, at }
const flips = new Map()
function flipped(name, mode, actual) {
  const f = flips.get(`${name}:${mode}`)
  if (f && f.on !== actual && Date.now() - f.at < 8000) return f.on
  flips.delete(`${name}:${mode}`)
  return actual
}

// YOLO and Fast as chips that toggle in place. Modes that are off only show up when you hover the row.
function modeChips(a) {
  const turn = (on) => `Click to turn ${on ? 'off' : 'on'}`
  const yolo = flipped(a.name, 'yolo', Boolean(a.yolo))
  const yoloTip = a.pending ? 'Restarts with the new YOLO setting as soon as it is free' : `YOLO ${yolo ? 'on' : 'off'}: skip every permission prompt. ${turn(yolo)}`
  // Codex agents only: its fast service tier.
  const on = a.fast === undefined ? undefined : flipped(a.name, 'fast', Boolean(a.fast))
  const fast = on === undefined ? '' : `<button class="mode fast" data-fast="${esc(a.name)}" aria-pressed="${on}" title="Fast ${on ? 'on' : 'off'}: Codex's fast service tier. ${turn(on)}">${ICONS.bolt}</button>`
  return `${fast}<button class="mode yolo" data-yolo="${esc(a.name)}" aria-pressed="${yolo}" title="${yoloTip}">YOLO</button>`
}

function powerSwitch(a) {
  const busy = a.status === 'working' || a.status === 'waiting'
  return `<input type="checkbox" class="switch sm" data-power="${esc(a.name)}" ${busy ? 'data-busy' : ''} ${a.on ? 'checked' : ''} title="${a.on ? 'Turn off (stays off after restarts)' : 'Turn on (resumes its session)'}">`
}

// One row per agent: name and status / what it owns / brain and modes, plus what it's doing while it works.
// An agent's name; one on another computer carries its computer: gal@mac-mini.
const nameHTML = (a) => (a.home ? `${esc(a.seed)}<span class="at" title="runs on ${esc(a.homeName)}">@${esc(a.home)}</span>` : esc(a.name))

// ---- context: how full an agent's conversation is ----------------------------------------------------

// 1.2M, 340k, 900
const tokenCount = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n ?? 0))
// calm: plenty of room. warm: past half, start fresh before unrelated work. hot: compaction is close.
const ctxLevel = (pct) => (pct >= 80 ? 'hot' : pct >= 50 ? 'warm' : 'calm')
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

function contextTip(a) {
  const c = a.convo
  if (!c) return ''
  const x = c.context
  const parts = [
    !x ? 'Context: not measured yet'
      : x.limit ? `Context ${x.pct}% of its ${tokenCount(x.limit)} limit: ${tokenCount(x.used)} used (${tokenCount(x.window)} window)`
      : `Context ${x.pct}% full: ${tokenCount(x.used)} of ${tokenCount(x.size)} tokens`,
    `${plural(c.tasks, 'task')} in this conversation`,
  ]
  if (c.compactions) parts.push(`compacted ${c.compactions}× (older details are summaries)`)
  if (c.context?.pct >= 50 || c.compactions) parts.push('a new conversation gives it a clean slate')
  return parts.join(' · ')
}

// A little fuel gauge: the ring fills as the conversation grows and turns amber, then red.
function contextRing(a, { label = true, size = 15 } = {}) {
  const ctx = a.convo?.context
  if (!ctx || !a.on) return ''
  return `<span class="ctx ${ctxLevel(ctx.pct)}${a.convo.compactions ? ' compacted' : ''}" title="${esc(contextTip(a))}" style="--s:${size}px">` +
    `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.6" class="ctx-track"/><circle cx="10" cy="10" r="7.6" class="ctx-fill" pathLength="100" stroke-dasharray="${Math.max(ctx.pct, 3)} 100"/></svg>` +
    `${label ? `<b>${ctx.pct}%</b>` : ''}</span>`
}

// ---- sub-agents: the helpers an agent hands parts of its work to (Claude Code's Agent tool) -----------

const runningSubs = (a) => (a.on ? (a.subs ?? []).filter((s) => !s.ended) : [])
// "general-purpose" is Claude Code's default helper; the rest keep their names (Explore, Plan, code-reviewer…)
const subType = (t) => (t === 'general-purpose' ? 'general' : String(t || 'agent'))
const subsTip = (subs) => subs.map((s) => `${subType(s.type)}${s.description ? `: ${s.description}` : ''}`).join('\n')
// Little dots circling the creature while its sub-agents run, one per sub-agent (up to four).
const orbitHTML = (a) => {
  const n = Math.min(4, runningSubs(a).length)
  return n ? `<span class="orbit" style="--n:${n}" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<i style="--k:${k}"></i>`).join('')}</span>` : ''
}
const subsChip = (a) => {
  const subs = runningSubs(a)
  return subs.length ? `<span class="subs-chip" title="${esc(`${plural(subs.length, 'sub-agent')} working:\n${subsTip(subs)}`)}">${ICONS.subs}${subs.length}</span>` : ''
}

function agentCard(a, providers) {
  const doing = a.on && (a.activity || a.queue || runningSubs(a).length)
  const later = a.freshPending ? '<span class="pending" title="It finishes what it is doing first">✦ new conversation when free</span>' : a.pending ? '<span class="pending" title="It restarts with your changes as soon as it is free">↻ restarts when free</span>' : ''
  const activity = doing || later
    ? `<div class="activity">${a.activity && a.on ? `<span class="${a.status === 'working' ? 'shimmer' : ''}">${esc(a.activity)}</span>` : '<span></span>'}${subsChip(a)}${a.queue && a.on ? `<span class="queue">${a.queue} queued</span>` : ''}${later}</div>`
    : ''
  return `<div class="agent hop ${a.on ? a.status : 'off'}" data-agent="${esc(a.name)}" style="--c:${agentColor(a)}">
    <div class="agent-av">${avatarHTML(a, { size: 38 })}${orbitHTML(a)}${unreadBadge(a.unread)}</div>
    <div class="agent-body">
      <div class="agent-top"><span class="name">${nameHTML(a)}</span><span class="state ${a.status}">${esc(statusText(a))}</span><span class="grow"></span>${powerSwitch(a)}</div>
      <div class="area" title="${esc(a.area)}">${esc(a.area || 'No area yet')}</div>
      <div class="agent-foot"><span class="brain" title="${esc(brainLabel(a, providers))}">${esc(brainShort(a, providers))}</span>${a.convo?.context?.pct >= 50 ? contextRing(a, { label: false }) : ''}${modeChips(a)}</div>
      ${activity}
    </div>
  </div>`
}

// ---- unread: agents' replies you haven't seen yet ------------------------------------------------------
// state.reads (core/hub.js read): up to when you've read each agent; `since` keeps history from before the first
// run from counting as new. Only replies count: questions, hand-offs and notes have their own ways to get your eye.
const isUnread = (e, reads) => e.kind === 'reply' && e.from !== 'you' && Boolean(reads) && e.ts > Math.max(reads.since ?? 0, reads.agents?.[e.from] ?? 0)
const unreadBadge = (n) => (n ? `<span class="unread-badge" title="${plural(n, 'new reply', 'new replies')}">${n > 9 ? '9+' : n}</span>` : '')

// "2 working · 1 needs you" as little pills, for the headers of every view.
// unread: also count new replies (the dashboard's wide titlebar; narrow headers have the pill's badge instead)
function crewSummary(state, { unread = false } = {}) {
  const on = state.agents.filter((a) => a.on)
  const working = on.filter((a) => a.status === 'working').length
  const waiting = on.filter((a) => a.status === 'waiting').length
  const pill = (cls, text, dot = cls) => `<span class="sum ${cls}">${dot ? `<i class="dot ${dot}"></i>` : ''}${text}</span>`
  if (!state.agents.length) return ''
  if (!on.length) return pill('', 'all off', 'off')
  const fresh = unread ? state.agents.reduce((n, a) => n + (a.unread ?? 0), 0) : 0
  return (working ? pill('working', `${working} working`) : '') + (waiting ? pill('waiting', `${waiting} need${waiting > 1 ? '' : 's'} you`) : '') + (working || waiting ? '' : pill('idle', on.length > 1 ? `all ${on.length} free` : 'free')) + (fresh ? pill('unread', `${fresh} new`) : '')
}

// Segmented control: marks the segment that isOn() picks and slides the thumb to it (see .seg in common.css).
function segmented(el, isOn) {
  const buttons = [...el.querySelectorAll('button')]
  const i = Math.max(0, buttons.findIndex(isOn))
  buttons.forEach((b, j) => {
    b.classList.toggle('on', j === i)
    b.setAttribute('aria-pressed', String(j === i))
  })
  el.style.setProperty('--n', buttons.length)
  el.style.setProperty('--i', i)
  // no slide on first paint, only when you switch
  if (!el.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('ready')))
}

// Replays an avatar's one-shot animation (cheer, pop), then lets it go back to breathing.
function bounce(av, cls = 'cheer') {
  if (!av) return
  av.classList.remove(cls)
  void av.offsetWidth
  av.classList.add(cls)
  av.addEventListener('animationend', () => av.classList.remove(cls), { once: true })
}

// A little burst of confetti from an element: a few sparkles in one color, or a big multicolor one.
function burst(el, { count = 7, color, spread = 26 } = {}) {
  const r = el.getBoundingClientRect()
  if (!r.width || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const party = ['#ff5aa8', '#ffc61f', '#3db8ff', '#72d63a', '#8b5cf6', '#ff8a1f']
  const b = document.createElement('span')
  b.className = 'burst'
  b.style.left = `${r.left + r.width / 2}px`
  b.style.top = `${r.top + r.height * 0.4}px`
  b.innerHTML = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6
    const d = spread * (0.75 + Math.random() * 0.6)
    return `<i style="--x:${(Math.cos(angle) * d).toFixed(1)}px;--y:${(Math.sin(angle) * d - 8).toFixed(1)}px;--r:${Math.round(Math.random() * 540)}deg;--b:${color ?? party[i % party.length]}"></i>`
  }).join('')
  document.body.append(b)
  setTimeout(() => b.remove(), 900)
}

// Finished a task: the creature jumps and a few sparkles pop. Levelled up: real confetti.
// Remembers what each view (root) last showed, so it only celebrates changes it saw happen.
const celebrated = new WeakMap()
const burstAt = new Map() // agent name -> when its last burst played, so two views of it don't both throw one
function celebrate(root, agents) {
  const last = celebrated.get(root)
  const now = new Map(agents.map((a) => [a.name, { status: a.status, lv: levelOf(a.stats).lv }]))
  celebrated.set(root, now)
  if (!last) return
  for (const a of agents) {
    const was = last.get(a.name)
    if (!was) continue
    const levelUp = now.get(a.name).lv > was.lv
    if (!levelUp && !(was.status === 'working' && a.status === 'idle')) continue
    const av = root.querySelector(`[data-agent="${CSS.escape(a.name)}"] .av, [data-name="${CSS.escape(a.name)}"] .av`)
    if (!av || !av.getClientRects().length) continue // a hidden view remembers, but doesn't save the party for later
    bounce(av)
    if (Date.now() - (burstAt.get(a.name) ?? 0) < 1500) continue
    burstAt.set(a.name, Date.now())
    burst(av, levelUp ? { count: 18, spread: 52 } : { color: agentColor(a) })
  }
}

// Just enough Markdown for agent replies: code, bold/italic/strike, headings, lists, quotes and links.
// The text is escaped first, so whatever an agent writes can't inject HTML.
function md(src) {
  const blocks = []
  const text = esc(src).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(`<pre><button class="copy" data-copy title="Copy">${ICONS.copy}</button><code>${code.replace(/\n$/, '')}</code></pre>`) - 1}\u0000`)
  const inline = (line) => {
    const codes = []
    return line
      .replace(/`([^`]+)`/g, (_, c) => `\u0001${codes.push(c) - 1}\u0001`)
      .replace(/\*\*(?=\S)(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(?=\S)(.+?)__/g, '<b>$1</b>')
      .replace(/(^|[\s(])[*_](?=\S)([^*_]+?)[*_](?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/(?<![\w.@/'-]|&#\d+;)@([\w-]+(?:@[\w-]+)?)(?![\w@/'-]|\.\w|&#39;)/g, (m, n) => (NOT_NAMES.has(n.toLowerCase()) ? m : `<span class="mention" data-m="${n.toLowerCase()}">@${n}</span>`))
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]*[^\s<).,!?:;])/g, '$1<a href="$2">$2</a>')
      .replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${codes[i]}</code>`)
  }
  let html = ''
  let list = null
  let para = []
  const flush = () => {
    if (para.length) html += `<p>${para.map(inline).join('<br>')}</p>`
    para = []
  }
  const close = () => {
    if (list) html += `</${list}>`
    list = null
  }
  const item = (tag, body) => {
    flush()
    if (list !== tag) {
      close()
      html += `<${tag}>`
      list = tag
    }
    html += `<li>${inline(body)}</li>`
  }
  // GFM tables: a pipe row, then a --- delimiter row with the same column count, then rows until a blank line.
  // `\|` keeps a literal pipe inside a cell.
  const cells = (row) => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
  const isRule = (row) => row.includes('|') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(row)
  const isRow = (row) => row.includes('|') && row.trim() && !/^\s*\u0000\d+\u0000\s*$/.test(row)
  const table = (head, rule, rows) => {
    const align = rule.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''))
    const tr = (row, tag) => `<tr>${align.map((a, i) => `<${tag}${a ? ` style="text-align:${a}"` : ''}>${inline(row[i] ?? '')}</${tag}>`).join('')}</tr>`
    return `<div class="tbl"><table><thead>${tr(head, 'th')}</thead>${rows.length ? `<tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody>` : ''}</table></div>`
  }
  const lines = text.split('\n')
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    let m
    if (isRow(line) && isRule(lines[n + 1] ?? '') && cells(line).length === cells(lines[n + 1]).length) {
      flush()
      close()
      const rule = cells(lines[n + 1])
      const rows = []
      n += 1
      while (isRow(lines[n + 1] ?? '')) rows.push(cells(lines[++n]))
      html += table(cells(line), rule, rows)
    } else if (/^\s*\u0000\d+\u0000\s*$/.test(line)) (flush(), close(), (html += line.trim()))
    else if ((m = line.match(/^(#{1,4})\s+(.*)/))) (flush(), close(), (html += `<h4>${inline(m[2])}</h4>`))
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) item('ul', m[1])
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) item('ol', m[1])
    else if ((m = line.match(/^&#62;\s?(.*)/))) (flush(), close(), (html += `<blockquote>${inline(m[1])}</blockquote>`))
    else if (!line.trim()) (flush(), close())
    else (close(), para.push(line))
  }
  flush()
  close()
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i])
}

// One line of a message, for "replying to" quotes.
const snippet = (text) => String(text ?? '').replace(/```[\s\S]*?```/g, '[code]').replace(/^[\s|:-]*-[\s|:-]*$/gm, '').replace(/[*_`#>~|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)

// The hub stores a message you send to several agents once per recipient, each with its own delivery,
// and stamps every copy with the same sendId. The feed shows it once, at its first visible copy,
// addressed to all of them. Hand-offs between agents stay separate: each one is approved or dropped on
// its own. `as` maps every feed id to the entry that shows it.
const mergeSends = (feed) => {
  const shown = []
  const as = {}
  const bySend = {}
  for (const e of feed) {
    const lead = e.from === 'you' && e.sendId ? bySend[e.sendId] : undefined
    if (lead) {
      if (e.queued) lead.queued = true
      as[e.id] = lead
      continue
    }
    const x = e.from === 'you' && e.sendId ? (bySend[e.sendId] = { ...e }) : e
    shown.push(x)
    as[e.id] = x
  }
  return { shown, as }
}

// What the feed shows: the last `limit` entries after merging, and their HTML. Replies to any copy of a
// merged send link to the copy that's shown.
// reads: what you've read (state.reads); divider: the message the "New" line goes above.
const feedView = (feed, agents, open, limit, drafts = new Map(), { reads, divider } = {}) => {
  const { shown, as } = mergeSends(feed)
  // the last `limit` entries, plus questions still waiting for you from before them
  const items = [...shown.slice(0, -limit).filter((e) => e.kind === 'ask' && !e.answer), ...shown.slice(-limit)]
  const ctx = { byName: Object.fromEntries(agents.map((a) => [a.name, a])), byId: as, repliesTo: {}, open, drafts, reads }
  for (const e of feed) if (e.re) (ctx.repliesTo[as[e.re]?.id ?? e.re] ??= []).push(e)
  const line = '<div class="new-line" aria-label="New replies"><span>New</span></div>'
  return { items, html: () => items.map((e, i) => (e.id === divider ? line : '') + feedItem(e, items[i - 1], ctx)).join('') }
}

// ---- tasks (ui/tasks.js) in the chat -------------------------------------------------------------------

// "Fix the login @david" -> the task and who it's for (an agent's name, typed as @name anywhere).
function ownerIn(text, agents) {
  const names = new Set(agents.map((a) => a.name))
  for (const m of String(text).matchAll(/(^|\s)@([\w-]+(?:@[\w-]+)?)\b/g)) {
    const name = m[2].toLowerCase()
    if (names.has(name)) return { owner: name, text: (text.slice(0, m.index) + m[1] + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim() }
  }
  return { owner: null, text: String(text).trim() }
}

// What happened to a task, as one line in the feed. Click it to open the task. (Entries from when the board
// was Bugs have kind 'bug' and no type.)
const typeOf = (e) => e.type ?? 'bug'
const TASK_ACTS = {
  filed: (e, who) => `${e.from === 'you' ? 'You' : who(e.from)} ${typeOf(e) === 'bug' ? 'reported' : 'added'}`,
  triaged: (e, who) => `${who(e.from)} triaged${e.text ? ` it for ${who(e.text)}` : ''}`,
  fixing: (e, who) => `went to ${who(e.text)}`,
  fixed: (e, who) => `${who(e.from)} ${typeOf(e) === 'bug' ? 'fixed' : 'finished'}`,
  note: (e, who) => `${who(e.from)} noted on`,
  done: (e) => (typeOf(e) === 'bug' ? 'checked: works ✓' : 'accepted ✓'),
  reopened: () => 'reopened',
  dup: (e) => `is the same as ${esc(e.text)}`,
}

function taskEvent(e, who) {
  const key = String(e.ticket)
  const type = typeOf(e)
  const act = TASK_ACTS[e.act]?.(e, who) ?? esc(e.act)
  const tail = (e.act === 'fixed' || e.act === 'note') && e.text ? `<span class="task-ev-text">${esc(snippet(e.text))}</span>` : ''
  const lead = e.act === 'filed' || e.act === 'triaged' || e.act === 'fixed' || e.act === 'note'
  return `<div class="task-ev type-${esc(type)} act-${esc(e.act)}" id="m-${e.id}" data-ticket="${esc(key)}" title="Open #${esc(key)}">
    <span class="task-ev-icon">${ICONS[type] ?? ICONS.task}</span>
    <span class="task-ev-line">${lead ? `${act} <b>#${esc(key.split('@')[0])}</b>` : `<b>#${esc(key.split('@')[0])}</b> ${act}`} <span class="task-ev-title">${esc(e.title)}</span></span>${tail}
  </div>`
}

function feedItem(e, prev, ctx) {
  const { byName, byId, repliesTo, open } = ctx
  const agent = (n) => byName[n] ?? { name: n }
  const tint = (n) => (n === 'you' ? 'var(--accent)' : agentColor(agent(n)))
  const who = (n) => (n === 'you' ? 'you' : `<span class="who" data-agent="${esc(n)}" style="--c:${agentColor(agent(n))}">@${esc(n)}</span>`)
  // In captions an agent goes by its plain name, like a group chat; one on another computer keeps its @computer.
  const label = (n) => {
    const [base, home] = String(n).split('@')
    return `${esc(base)}${home ? `<span class="at">@${esc(home)}</span>` : ''}`
  }
  const name = (n) => (n === 'you' ? 'You' : `<span class="who" data-agent="${esc(n)}" style="--c:${agentColor(agent(n))}">${label(n)}</span>`)
  const time = new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const repeat = prev && prev.kind === e.kind && prev.from === e.from && prev.to === e.to && e.ts - prev.ts < 120000 && !e.re
  const tags = (e.queued ? '<span class="tag">queued</span>' : '') + (e.held ? '<span class="tag">needs your OK</span>' : '') + (e.via === 'terminal' ? '<span class="tag">in terminal</span>' : '')
  const cont = repeat && !tags ? ' cont' : '' // stacks under the message before it, without its own caption
  const pics = e.images?.length ? `<div class="pics">${e.images.map((p) => `<img src="${fileURL(p)}" data-open="${esc(p)}" alt="" title="Open image">`).join('')}</div>` : ''
  // A reply quotes the message it answers, with a bar in the quoted sender's color; click to jump back to it.
  const orig = e.re && byId[e.re]
  const quoted = orig?.ticket !== undefined ? `#${String(orig.ticket).split('@')[0]} ${orig.title ?? ''}` : snippet(orig?.text)
  const quote = orig ? `<button class="quote" data-jump="${orig.id}" style="--qc:${tint(orig.from)}" title="Jump to the message this answers"><b>${orig.from === 'you' ? 'You' : label(orig.from)}</b> ${esc(quoted)}</button>` : ''
  // ...and a message you sent links forward to the agents' replies.
  const answers = repliesTo[e.id] ?? []
  const replied = answers.length
    ? `<button class="replied" data-jump="${answers[0].id}" title="Jump to the reply">${ICONS.thread}<span>${[...new Set(answers.map((r) => (r.from === 'you' ? 'You' : `@${esc(r.from)}`)))].join(', ')} ${answers.some((r) => r.kind === 'reply' || r.from === 'you') ? 'replied' : answers.some((r) => r.kind === 'ask') ? 'has a question' : 'handed it on'}</span></button>`
    : ''
  // @names in the text take their agent's color; one nobody here has stays a plain word
  const text = md(e.text).replace(/<span class="mention" data-m="([^"]+)">([^<]*)<\/span>/g, (_, n, at) => {
    const a = mentioned(n, Object.values(byName))
    return a ? `<span class="mention" style="--c:${agentColor(a)}">${at}</span>` : at
  })
  const bubble = `${quote}${pics}<div class="bubble ${open.has(e.id) ? 'open' : ''}" data-id="${e.id}">${text}</div>`
  const cap = (html) => (cont ? '' : `<div class="cap">${html}${tags}<span class="time">${time}</span></div>`)
  // hover a message for its tools: Reply (the chat's message box then answers it)
  const tools = `<div class="msg-tools"><button class="msg-tool" data-reply="${e.id}" title="Reply to this message">${ICONS.reply}<span>Reply</span></button></div>`
  const fresh = isUnread(e, ctx.reads)
  const seen = e.kind === 'reply' ? ` data-from="${esc(e.from)}" data-ts="${e.ts}"` : ''
  // Agents talk with their little face next to the bubble, like a group chat.
  const said = (cls, capHTML, rest = '', body = bubble, withTools = true) =>
    `<div class="item said ${cls}${cont}${fresh ? ' unread' : ''}" id="m-${e.id}" style="--c:${agentColor(agent(e.from))}" title="${time}"${seen}><span class="face" data-agent="${esc(e.from)}">${cont ? '' : avatarHTML(agent(e.from), { size: 28, mood: 'still' })}</span><div class="stack">${cap(capHTML)}${body}${rest}${replied}</div>${withTools ? tools : ''}</div>`

  if (e.kind === 'task' || e.kind === 'bug') return taskEvent(e, who)
  // a new conversation starts: a line across the feed, so what came before is visibly "before"
  if (e.kind === 'event' && e.fresh) return `<div class="fresh-ev" id="m-${e.id}" title="${time}"><span>${ICONS.fresh}${who(e.from)} ${esc(e.text)}</span></div>`
  if (e.kind === 'event') return `<div class="event ${e.alert ? 'alert' : ''}" id="m-${e.id}" title="${time}">${who(e.from)} ${esc(e.text)}</div>`
  // a bug sent to an agent (to fix, or to triage): the ticket, not the whole brief
  if (e.ticket !== undefined && e.from === 'you') {
    const key = String(e.ticket)
    const why = e.triage ? '<span class="tag">to triage</span>' : e.fresh ? '<span class="tag fresh">new conversation</span>' : ''
    return `<div class="item me ticket-msg" id="m-${e.id}" title="${time}"><div class="cap">to ${who(e.to)}${why}${tags}<span class="time">${time}</span></div>
      <button class="bubble ticket-bubble" data-ticket="${esc(key)}" data-id="${e.id}"><span class="tb-icon">${ICONS[e.type ?? 'bug'] ?? ICONS.task}</span><b>#${esc(key.split('@')[0])}</b> ${esc(e.title ?? '')}</button>${replied}</div>`
  }
  if (e.kind === 'note') return said('note', `${name(e.from)} <span>shared a note</span>`)
  if (e.kind === 'reply') return said(e.subs?.length ? 'with-subs' : '', name(e.from), subsUsed(e, open))
  if (e.kind === 'ask') {
    const verb = { permission: 'needs your OK', question: 'asks', plan: 'has a plan for you' }[e.ask?.type] ?? 'asks'
    return said(`ask ${e.answer ? 'answered' : 'open'}`, `${name(e.from)} <span>${verb}</span>`, '', `${quote}${askCard(e, ctx.drafts.get(e.id))}`, false)
  }
  if (e.from === 'you') return `<div class="item me${cont}" id="m-${e.id}" title="${time}">${cap(`to ${(e.cc ?? [e.to]).map(who).join(' ')}`)}${bubble}${replied}${tools}</div>`
  const actions = e.held
    ? `<div class="actions"><button class="btn primary" data-act="approve" data-id="${e.id}">Send it</button><button class="btn" data-act="drop" data-id="${e.id}">Drop</button></div>`
    : ''
  return said(`handoff ${e.dropped ? 'dropped' : ''}`, `${name(e.from)}<span class="via" title="handed off to">${ICONS.arrow}</span>${name(e.to)}`, actions)
}

// An agent's question as a card you answer right in the chat (see hub.ask): a permission prompt, its own
// multiple-choice questions, or a plan to approve. Answered, it folds into a line saying what happened.
// draft: what you've picked or typed so far, kept across re-renders.
function askCard(e, draft = {}) {
  const q = e.ask ?? {}
  const name = esc(String(e.from).split('@')[0])
  const icon = ICONS[{ permission: 'shield', question: 'ask', plan: 'plan' }[q.type] ?? 'ask']
  if (e.answer) return `<div class="ask-card done" data-ask="${e.id}">${askSummary(q, e.answer)}</div>`
  const code = q.code ? `<pre class="ask-code"><code>${esc(q.code)}</code></pre>` : ''
  const note = (placeholder) => `<input class="ask-note" data-note value="${esc(draft.note ?? '')}" placeholder="${placeholder}" spellcheck="false">`
  const elsewhere = e.cli === 'codex'
    ? `<button class="ask-elsewhere" data-answer="terminal" title="${name} shows its own prompt once you hand it over">Answer in its terminal instead</button>`
    : '<span class="ask-elsewhere">or answer in its terminal</span>'
  if (q.type === 'question') {
    const picked = (qi, label) => [].concat(draft.picks?.[qi] ?? []).includes(label)
    const ready = q.questions.every((x, qi) => draft.other?.[qi]?.trim() || [].concat(draft.picks?.[qi] ?? []).length)
    const quick = q.questions.length === 1 && !q.questions[0].multiSelect // one tap answers
    return `<div class="ask-card" data-ask="${e.id}">${q.questions.map((x, qi) => `
      <div class="ask-q">
        <div class="ask-head">${x.header ? `<span class="ask-chip">${esc(x.header)}</span>` : ''}${x.multiSelect ? '<span class="ask-multi">pick any</span>' : ''}</div>
        <div class="ask-question">${esc(x.question)}</div>
        <div class="ask-options">${x.options.map((o) => `<button class="ask-option ${picked(qi, o.label) ? 'on' : ''}" data-pick="${qi}" data-label="${esc(o.label)}"><b>${esc(o.label)}</b>${o.description ? `<span>${esc(o.description)}</span>` : ''}</button>`).join('')}</div>
        <input class="ask-other" data-other="${qi}" value="${esc(draft.other?.[qi] ?? '')}" placeholder="Something else…" spellcheck="false">
      </div>`).join('')}
      <div class="ask-actions">${quick ? '' : `<button class="btn primary" data-answer="send" ${ready ? '' : 'disabled'}>Send ${q.questions.length > 1 ? 'answers' : 'answer'}</button>`}${elsewhere}</div>
      <div class="ask-error"></div>
    </div>`
  }
  if (q.type === 'plan') {
    return `<div class="ask-card" data-ask="${e.id}">
      <div class="ask-title">${icon}<span>Plan</span></div>
      <div class="ask-plan">${md(q.plan)}</div>
      <div class="ask-actions"><button class="btn primary" data-answer="allow">Approve plan</button><button class="btn" data-answer="deny">Keep planning</button>${elsewhere}</div>
      ${note(`What should ${name} change?`)}
      <div class="ask-error"></div>
    </div>`
  }
  return `<div class="ask-card" data-ask="${e.id}">
    <div class="ask-title">${icon}<span>${esc(q.title ?? 'Use a tool')}</span></div>
    ${code}${q.detail ? `<div class="ask-detail">${esc(q.detail)}</div>` : ''}
    <div class="ask-actions"><button class="btn primary" data-answer="allow">Allow</button><button class="btn deny" data-answer="deny">Deny</button></div>
    ${q.always?.length ? `<div class="ask-always">${q.always.map((s) => `<button data-answer="always" data-i="${s.i}" title="Allow, and don't ask again">${ICONS.check}${esc(s.label)}</button>`).join('')}</div>` : ''}
    ${note(`Or tell ${name} what to do instead… (Enter)`)}
    <div class="ask-foot">${elsewhere}</div>
    <div class="ask-error"></div>
  </div>`
}

// An answered card, in one line or two.
function askSummary(q, a) {
  const what = q.type === 'question' ? '' : `<span class="ask-what">${esc(q.type === 'plan' ? 'the plan' : q.title ?? '')}</span>`
  const mark = (cls, icon) => `<span class="ask-mark ${cls}">${ICONS[icon]}</span>`
  if (a.stale) return `${mark('', 'dash')}<span>No longer waiting</span>${what}`
  if (a.by === 'terminal') return `${mark('', 'keyboard')}<span>${a.handedOver ? 'Handed to its terminal' : 'Answered in the terminal'}</span>${what}`
  if (q.type === 'question') return Object.entries(a.answers ?? {}).map(([k, v]) => `<div class="ask-answer">${mark('ok', 'check')}<span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')
  if (q.type === 'plan') return a.allow ? `${mark('ok', 'check')}<span>Plan approved</span>` : `${mark('', 'undo')}<span>Keep planning${a.note ? `: “${esc(a.note)}”` : ''}</span>`
  if (a.allow) return `${mark('ok', 'check')}<span>Allowed${a.always ? ` · ${esc(a.always)}` : ''}</span>${what}`
  return `${mark('no', 'close')}<span>Said no${a.note ? `: “${esc(a.note)}”` : ''}</span>${what}`
}

// Who's on it right now, under the last message: one slim line per busy agent with what it's doing, and an
// orange Answer button when it needs you. asks: agent -> its open question's id, so the line can point at the
// card instead of the terminal.
const typingHTML = (agents, asks = new Map()) =>
  agents
    .filter((a) => a.on && (a.status === 'working' || a.status === 'waiting' || a.subs?.length))
    .map((a) => {
      const card = a.status === 'waiting' && asks.get(a.name)
      const waiting = a.status === 'waiting'
      const busy = waiting || a.status === 'working'
      const what = waiting ? (card ? 'is waiting for your answer' : 'needs you in its terminal') : busy ? a.activity || 'working…' : 'free, its sub-agents are still working'
      const end = waiting ? `<span class="tr-go">${card ? `Answer${ICONS.up}` : 'Open'}</span>` : busy ? '<span class="typing"><i></i><i></i><i></i></span>' : ''
      return `<div class="typing-row ${a.status}" ${card ? `data-jump="${card}"` : `data-agent="${esc(a.name)}"`} style="--c:${agentColor(a)}" title="${card ? 'Jump to the question' : waiting ? 'Open its terminal to answer' : 'Open its terminal'}">
      <span class="face">${avatarHTML(a, { size: 22 })}${orbitHTML(a)}</span><span class="tr-name">${nameHTML(a)}</span><span class="tr-what ${busy ? '' : 'quiet'}">${esc(what)}</span>${end}</div>${subTree(a)}`
    })
    .join('')

// Its sub-agents, as branches under its line: each one's kind and job, what it's doing, how many steps and how
// long. Finished ones tick off and fade out.
function subTree(a) {
  const subs = a.subs ?? []
  if (!subs.length) return ''
  const look = { ...a, avatar: avatarOf(a), status: 'working' } // its helpers are little copies of it
  return `<div class="sub-tree" style="--c:${agentColor(a)}" data-agent="${esc(a.name)}" title="Open its terminal">${subs.map((s) => {
    const done = Boolean(s.ended)
    return `<div class="sub-row ${done ? 'done' : 'running'}" data-sub="${esc(s.id)}">
      <span class="sub-face">${done ? `<span class="sub-done">${ICONS.check}</span>` : avatarHTML({ ...look, name: `${a.name}·${s.id}` }, { size: 16, mood: 'working' })}</span>
      <span class="sub-body">
        <span class="sub-line"><span class="sub-kind">${esc(subType(s.type))}</span><span class="sub-job">${esc(s.description || 'sub-agent')}</span></span>
        <span class="sub-doing">${esc(done ? 'done' : s.activity || 'starting…')}</span>
      </span>
      <span class="sub-meta">${s.tools ? `${plural(s.tools, 'step')}<br>` : ''}${duration((s.ended ?? Date.now()) - s.started)}</span>
    </div>`
  }).join('')}</div>`
}

// Under a reply: the sub-agents it used for that turn, folded into one line until you open it.
function subsUsed(e, open) {
  if (!e.subs?.length) return ''
  const running = e.subs.filter((s) => s.running).length
  return `<details class="subs-used" data-subs="${e.id}" ${open.has(`subs:${e.id}`) ? 'open' : ''}><summary>${ICONS.subs}<span>Used ${plural(e.subs.length, 'sub-agent')}${running ? ` · ${running} still working` : ''}</span></summary>
    <div class="subs-list">${e.subs.map((s) => `<div class="subs-item ${s.running ? 'running' : ''}"><span class="sub-kind">${esc(subType(s.type))}</span><span class="sub-job">${esc(s.description || 'sub-agent')}</span><span class="sub-meta">${s.tools ? `${plural(s.tools, 'step')} · ` : ''}${duration(s.ms)}${s.running ? ' · working' : ''}</span></div>`).join('')}</div></details>`
}

function mountFeed(el, { onAgent, onReply, onTicket = (key) => crew.call('dashboard', `task:${key}`), limit = 200 } = {}) {
  const open = new Set()
  const seen = new Set()
  const drafts = new Map() // question card id -> { picks: { qi: [labels] }, other: { qi: text }, note }
  const sending = new Set() // cards whose answer is on its way: one answer each, even with a held Enter
  let shown = new Map() // id -> feed entry on screen
  let key = ''
  let last = null // the state last drawn, to redraw when the "New" line goes
  let first = true
  // Pinned while you're at the bottom: new messages, typing rows and folding long bubbles keep it there.
  let pinned = true
  let gliding = false
  const atEnd = () => el.scrollHeight - el.scrollTop - el.clientHeight < 60
  const pin = (smooth = false) => {
    const top = el.scrollHeight - el.clientHeight
    if (!pinned || Math.abs(top - el.scrollTop) < 1) return
    gliding = smooth
    el.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' })
  }
  // A smooth glide fires scroll events on the way down; judge where you are once it (or your own scroll) ends.
  el.addEventListener('scroll', () => gliding || (pinned = atEnd()), { passive: true })
  el.addEventListener('scrollend', () => {
    gliding = false
    pinned = atEnd()
  })
  el.innerHTML = '<div class="feed-list"></div><div class="feed-list typing-list"></div>'
  const list = el.firstElementChild
  const typing = el.lastElementChild
  const jump = (id) => {
    const target = el.querySelector(`#m-${CSS.escape(id)}`)
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target.classList.remove('flash')
    void target.offsetWidth // restart the flash animation
    target.classList.add('flash')
  }
  // a reply's sub-agent list stays open across re-renders ('toggle' doesn't bubble, so catch it on the way down)
  el.addEventListener('toggle', (ev) => {
    const d = ev.target.closest?.('details[data-subs]')
    if (d) open[d.open ? 'add' : 'delete'](`subs:${d.dataset.subs}`)
  }, true)
  el.addEventListener('click', (ev) => {
    const link = ev.target.closest('a[href]')
    if (link) {
      ev.preventDefault()
      return crew.call('openUrl', link.href)
    }
    const to = ev.target.closest('[data-jump]')
    if (to) return jump(to.dataset.jump)
    const re = ev.target.closest('[data-reply]')
    if (re) return onReply?.(shown.get(re.dataset.reply))
    const pick = ev.target.closest('[data-pick]')
    if (pick) return choose(pick)
    const ans = ev.target.closest('[data-answer]')
    if (ans) return answerFrom(ans.closest('[data-ask]'), ans.dataset.answer, ans.dataset.i)
    const bug = ev.target.closest('[data-ticket]')
    if (bug && !ev.target.closest('.who')) return onTicket?.(bug.dataset.ticket)
    const agent = ev.target.closest('[data-agent]')
    if (agent) return onAgent?.(agent.dataset.agent)
    const act = ev.target.closest('[data-act]')
    if (act) return crew.call(act.dataset.act, act.dataset.id)
    const pic = ev.target.closest('[data-open]')
    if (pic) return crew.call('openFile', pic.dataset.open)
    const copy = ev.target.closest('[data-copy]')
    if (copy) {
      crew.call('copy', copy.nextElementSibling.textContent)
      copy.innerHTML = ICONS.check
      copy.classList.add('done')
      return setTimeout(() => {
        copy.innerHTML = ICONS.copy
        copy.classList.remove('done')
      }, 1500)
    }
    const more = ev.target.closest('[data-more]')
    if (more) return toggle(el.querySelector(`.bubble[data-id="${CSS.escape(more.dataset.more)}"]`))
    const bubble = ev.target.closest('.bubble.long')
    if (bubble && !getSelection().toString()) toggle(bubble)
  })
  // ---- answering a question card (see askCard) ----
  const draftOf = (id) => (drafts.has(id) ? drafts.get(id) : drafts.set(id, {}).get(id))
  const answersOf = (e, d) =>
    Object.fromEntries(e.ask.questions.map((x, qi) => [x.question, d.other?.[qi]?.trim() || (x.multiSelect ? (d.picks?.[qi] ?? []) : d.picks?.[qi]?.[0])]).filter(([, v]) => v?.length))
  const syncSend = (card) => {
    const e = shown.get(card.dataset.ask)
    const send = card.querySelector('[data-answer="send"]')
    if (send) send.disabled = Object.keys(answersOf(e, draftOf(e.id))).length < e.ask.questions.length
  }
  const answer = async (card, reply) => {
    const id = card.dataset.ask
    if (sending.has(id)) return
    sending.add(id)
    card.classList.add('sending')
    card.querySelector('.ask-error').textContent = ''
    try {
      await crew.call('answer', id, reply)
      drafts.delete(id)
    } catch (err) {
      const now = list.querySelector(`[data-ask="${CSS.escape(id)}"]`) ?? card // it may have been re-rendered meanwhile
      now.classList.remove('sending')
      const box = now.querySelector('.ask-error')
      if (box) box.textContent = err.message
    } finally {
      sending.delete(id)
    }
  }
  const answerFrom = (card, how, i) => {
    const e = card && shown.get(card.dataset.ask)
    if (!e || e.answer) return
    const d = draftOf(e.id)
    if (how === 'allow') return answer(card, { allow: true })
    if (how === 'always') return answer(card, { allow: true, always: Number(i) })
    if (how === 'deny') return answer(card, { allow: false, note: d.note ?? '' })
    if (how === 'terminal') return answer(card, { terminal: true })
    if (how === 'send') return answer(card, { answers: answersOf(e, d) })
  }
  // One question with one answer: a tap sends it. Otherwise taps pick (several, for "pick any") until Send.
  const choose = (button) => {
    const card = button.closest('[data-ask]')
    const e = shown.get(card.dataset.ask)
    const qi = Number(button.dataset.pick)
    const x = e.ask.questions[qi]
    const label = button.dataset.label
    if (e.ask.questions.length === 1 && !x.multiSelect) return answer(card, { answers: { [x.question]: label } })
    const d = draftOf(e.id)
    d.picks ??= {}
    const now = new Set(d.picks[qi] ?? [])
    if (x.multiSelect) now.has(label) ? now.delete(label) : now.add(label)
    else (now.clear(), now.add(label))
    d.picks[qi] = [...now]
    for (const b of card.querySelectorAll(`[data-pick="${qi}"]`)) b.classList.toggle('on', now.has(b.dataset.label))
    syncSend(card)
  }
  el.addEventListener('input', (ev) => {
    const card = ev.target.closest('[data-ask]')
    if (!card) return
    const d = draftOf(card.dataset.ask)
    if ('note' in ev.target.dataset) d.note = ev.target.value
    if ('other' in ev.target.dataset) (d.other ??= {})[ev.target.dataset.other] = ev.target.value
    syncSend(card)
  })
  el.addEventListener('keydown', (ev) => {
    const card = ev.target.closest('[data-ask]')
    if (!card || ev.key !== 'Enter' || ev.isComposing) return
    const e = shown.get(card.dataset.ask)
    if ('note' in ev.target.dataset && ev.target.value.trim()) answerFrom(card, 'deny') // "no, and here's what to do instead"
    else if ('other' in ev.target.dataset && ev.target.value.trim()) {
      if (e.ask.questions.length === 1) answer(card, { answers: { [e.ask.questions[0].question]: ev.target.value.trim() } })
      else syncSend(card)
    } else return
    ev.preventDefault()
  })

  const toggle = (bubble) => {
    if (!bubble) return
    bubble.classList.toggle('open')
    open[open.has(bubble.dataset.id) ? 'delete' : 'add'](bubble.dataset.id)
    measure()
  }
  // Long messages fold with a fade and a "Show more" button. Measured whenever the feed is visible and changes
  // size (a hidden chat panel has no layout, so it's measured again when it opens).
  const measure = () => {
    for (const b of el.querySelectorAll('.bubble')) {
      if (!b.offsetParent) continue
      const long = b.scrollHeight > parseFloat(getComputedStyle(b).fontSize) * 22 + 4
      b.classList.toggle('long', long)
      let more = b.nextElementSibling?.matches('.more') ? b.nextElementSibling : null
      if (long && !more) {
        b.insertAdjacentHTML('afterend', `<button class="more" data-more="${b.dataset.id}"></button>`)
        more = b.nextElementSibling
      }
      if (!long) more?.remove()
      else more.textContent = b.classList.contains('open') ? 'Show less' : 'Show more'
    }
  }
  new ResizeObserver(() => {
    measure()
    pin()
  }).observe(el)
  // ---- unread: a reply counts as read once it has been on screen for a moment while this window has focus ----
  const onScreen = new Map() // element id -> { from, ts } of unread replies at least 60% visible
  let readTimer = null
  const markSeen = () => {
    if (!onScreen.size || !document.hasFocus() || document.hidden || !el.offsetParent) return
    const seenUpTo = {}
    for (const v of onScreen.values()) seenUpTo[v.from] = Math.max(seenUpTo[v.from] ?? 0, v.ts)
    crew.call('read', seenUpTo).catch(() => {})
  }
  const soon = () => {
    clearTimeout(readTimer)
    if (onScreen.size) readTimer = setTimeout(markSeen, 900)
  }
  const watch = new IntersectionObserver((entries) => {
    for (const x of entries) {
      if (x.isIntersecting) onScreen.set(x.target.id, { from: x.target.dataset.from, ts: Number(x.target.dataset.ts) })
      else onScreen.delete(x.target.id)
    }
    soon()
  }, { root: el, threshold: 0.6 })
  addEventListener('focus', soon)
  document.addEventListener('visibilitychange', soon)
  // The "New" line stays above the first reply that was unread until a few seconds after you've caught up, so
  // you can see where the new ones began even though looking at them reads them.
  let divider = null
  let dividerTimer = null

  return {
    jump,
    render({ feed, agents, reads }) {
      const unread = feed.filter((e) => isUnread(e, reads))
      if (unread.length) {
        clearTimeout(dividerTimer)
        dividerTimer = null
        if (!divider || !feed.some((e) => e.id === divider)) divider = unread[0].id
      } else if (divider && !dividerTimer) dividerTimer = setTimeout(() => ((divider = null), (key = ''), this.render(last)), 4000)
      last = { feed, agents, reads }
      const view = feedView(feed, agents, open, limit, drafts, { reads, divider })
      shown = new Map(view.items.map((e) => [e.id, e]))
      let next = view.items.map((e) => e.id + (e.queued ? 'q' : '') + (e.held ? 'h' : '') + (e.dropped ? 'd' : '') + (e.answer ? 'a' : '') + (isUnread(e, reads) ? 'u' : '')).join() + JSON.stringify(agents.map((a) => [a.name, a.avatar])) + divider
      const asks = new Map(view.items.filter((e) => e.kind === 'ask' && !e.answer).map((e) => [e.from, e.id]))
      const busy = typingHTML(agents, asks)
      let added = false
      if (!view.items.length) next += busy ? ':busy' : ':empty' // the empty-feed hint shows only when nobody's busy
      if (next !== key) {
        key = next
        // a re-render mustn't take away what you're typing into a question card
        const active = list.contains(document.activeElement) && document.activeElement.closest('[data-ask]') ? document.activeElement : null
        const keep = active && { id: active.closest('[data-ask]').dataset.ask, field: 'note' in active.dataset ? '[data-note]' : `[data-other="${active.dataset.other}"]`, from: active.selectionStart, to: active.selectionEnd }
        list.innerHTML = view.items.length || busy ? view.html() : `<div class="empty">${ICONS.mark}<b>No messages yet</b><span>Tasks, hand-offs and replies show up here.</span></div>`
        // New messages pop in; the ones already on screen stay put.
        for (const e of view.items) {
          if (seen.has(e.id)) continue
          seen.add(e.id)
          if (!first) (list.querySelector(`#m-${CSS.escape(e.id)}`)?.classList.add('enter'), (added = true))
        }
        for (const id of sending) list.querySelector(`[data-ask="${CSS.escape(id)}"]`)?.classList.add('sending')
        watch.disconnect()
        onScreen.clear()
        for (const item of list.querySelectorAll('.item.unread')) watch.observe(item)
        const back = keep && list.querySelector(`[data-ask="${CSS.escape(keep.id)}"] ${keep.field}`)
        if (back) (back.focus({ preventScroll: true }), back.setSelectionRange(keep.from, keep.to))
        measure()
      }
      morph(typing, busy)
      pin(added)
      first = false
    },
  }
}

const fileURL = (p) => `file://${String(p).split('/').map(encodeURIComponent).join('/')}`
const isImage = (f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type)

// Images for a prompt: paste them, drop them, or pick them with the button. Each is saved under
// ~/.crew/attachments and reaches the agent as a file path it can open.
function mountAttach({ zone, field, tray, button, onChange, onError }) {
  let paths = []
  const picker = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true })
  button.after(picker)
  const draw = (notify = true) => {
    tray.innerHTML = paths.map((p, i) => `<span class="thumb"><img src="${fileURL(p)}" data-open="${esc(p)}" alt=""><button type="button" data-rm="${i}" title="Remove">×</button></span>`).join('')
    tray.classList.toggle('hidden', !paths.length)
    if (notify) onChange?.([...paths])
  }
  const add = async (files) => {
    const images = files.filter(isImage)
    if (files.length && !images.length) return onError?.('Only PNG, JPEG, GIF and WebP images')
    for (const f of images) {
      try {
        paths.push(await crew.call('saveImage', f.name, f.type, new Uint8Array(await f.arrayBuffer())))
      } catch (e) {
        onError?.(e.message)
      }
    }
    draw()
  }
  const dragging = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')
  zone.addEventListener('dragover', (e) => {
    if (!dragging(e)) return
    e.preventDefault()
    zone.classList.add('dropping')
  })
  zone.addEventListener('dragleave', (e) => zone.contains(e.relatedTarget) || zone.classList.remove('dropping'))
  zone.addEventListener('drop', (e) => {
    zone.classList.remove('dropping')
    if (!dragging(e)) return
    e.preventDefault()
    add([...e.dataTransfer.files])
  })
  field.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter(isImage)
    if (!files.length) return
    e.preventDefault()
    add(files)
  })
  button.addEventListener('click', () => picker.click())
  picker.addEventListener('change', () => {
    add([...picker.files])
    picker.value = ''
  })
  tray.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]')
    if (rm) {
      paths.splice(Number(rm.dataset.rm), 1)
      return draw()
    }
    const pic = e.target.closest('[data-open]')
    if (pic) crew.call('openFile', pic.dataset.open)
  })
  draw(false)
  return {
    get: () => [...paths],
    set: (list, notify = true) => {
      paths = [...(list ?? [])]
      draw(notify)
    },
  }
}

// @mentions, like Slack or Discord: type @ and the crew pops up, filtered as you type (name first, then area).
// ↑↓ move, Enter or Tab picks, Esc closes; a click picks too. Picking writes the agent's full name (gal@mac-mini
// for one on another computer) and a space. Agents that are off are listed but can't be picked: a message to one
// would be refused. field: the textarea. box: what the list lines up with. place: 'above' or 'below' it.
// Register it before the field's own keydown (Enter to send), so a pick doesn't also send.
function mountMentions(field, { agents, box = field, place = 'above', heading = () => 'Agents' }) {
  const list = document.createElement('div')
  list.className = 'mentions hidden'
  list.setAttribute('role', 'listbox')
  document.body.append(list)
  let items = []
  let active = 0
  let at = null // the "@query" being typed: { start, end, q }
  // "@jo" right before the cursor, at the start or after a space or bracket; not in an email, not in `code`
  const find = () => {
    if (field.selectionStart !== field.selectionEnd) return null
    const before = field.value.slice(0, field.selectionStart)
    const m = before.match(/(?:^|[\s([{,;])@([\w-]*(?:@[\w-]*)?)$/)
    if (!m) return null
    if (((before.slice(before.lastIndexOf('\n') + 1).match(/`/g)) ?? []).length % 2) return null
    return { start: before.length - m[1].length - 1, end: before.length, q: m[1].toLowerCase() }
  }
  // the start of its name first; from two letters on, anywhere in its name, then a word in its area
  const rank = (a, q) => {
    if (!q) return 0
    const n = String(a.name).toLowerCase()
    if (n.startsWith(q) || String(a.seed ?? '').toLowerCase().startsWith(q)) return 0
    if (q.length < 2) return -1
    if (n.includes(q)) return 1
    return String(a.area ?? '').toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(q)) ? 2 : -1
  }
  const label = (a, q) => {
    const [base, home] = String(a.name).split('@')
    const hit = q && base.toLowerCase().startsWith(q.split('@')[0]) ? q.split('@')[0].length : 0
    return `<mark>${esc(base.slice(0, hit))}</mark>${esc(base.slice(hit))}${home ? `<span class="at">@${esc(home)}</span>` : ''}`
  }
  const row = (a, i) =>
    `<div class="mn-item ${i === active ? 'on' : ''} ${i < 0 ? 'off' : ''}" ${i >= 0 ? `data-i="${i}" id="mn-${i}"` : ''} role="option" aria-selected="${i === active}" style="--c:${agentColor(a)}">${avatarHTML(a, { size: 24 })}<span class="mn-name">${label(a, at.q)}</span><span class="mn-area">${esc(a.area ?? '')}</span><span class="mn-state ${i < 0 ? 'off' : a.status}">${esc(i < 0 ? 'off' : statusText(a))}</span></div>`
  const close = () => {
    at = null
    list.classList.add('hidden')
  }
  const place_ = () => {
    const r = box.getBoundingClientRect()
    Object.assign(list.style, { left: `${r.left}px`, width: `${r.width}px` })
    if (place === 'above') Object.assign(list.style, { top: '', bottom: `${innerHeight - r.top + 6}px`, maxHeight: `${Math.max(140, r.top - 14)}px` })
    else Object.assign(list.style, { bottom: '', top: `${r.bottom + 6}px`, maxHeight: `${Math.max(140, innerHeight - r.bottom - 14)}px` })
  }
  const draw = () => {
    const was = at?.q
    at = find()
    if (!at) return close()
    const all = agents()
    items = all.map((a, i) => [rank(a, at.q), i, a]).filter(([r, , a]) => r >= 0 && a.on).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(([, , a]) => a)
    const off = all.filter((a) => !a.on && rank(a, at.q) >= 0)
    if (!items.length && !off.length) return close()
    if (at.q !== was) active = 0
    active = Math.min(active, Math.max(0, items.length - 1))
    list.innerHTML = `<div class="mn-head"><span>${esc(heading())}</span><span class="mn-keys"><kbd>↑</kbd><kbd>↓</kbd><kbd>⏎</kbd><span>to pick</span></span></div>
      <div class="mn-list">${items.map(row).join('')}${off.length ? `<div class="mn-sep">Off · turn them on to message them</div>${off.map((a) => row(a, -1)).join('')}` : ''}</div>`
    place_()
    list.classList.remove('hidden')
    list.querySelector('.mn-item.on')?.scrollIntoView({ block: 'nearest' })
  }
  const highlight = () => {
    for (const el of list.querySelectorAll('[data-i]')) {
      const on = Number(el.dataset.i) === active
      el.classList.toggle('on', on)
      el.setAttribute('aria-selected', String(on))
    }
    list.querySelector('.mn-item.on')?.scrollIntoView({ block: 'nearest' })
  }
  const pick = (i) => {
    const a = items[i]
    if (!a || !at) return
    const after = field.value.slice(at.end)
    const text = `@${a.name}${/^\s/.test(after) ? '' : ' '}`
    field.value = field.value.slice(0, at.start) + text + after
    const caret = at.start + text.length
    field.focus()
    field.setSelectionRange(caret, caret)
    close()
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  field.addEventListener('keydown', (e) => {
    if (!at || e.isComposing) return
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (step && items.length) (active = (active + step + items.length) % items.length), highlight()
    else if ((e.key === 'Enter' || e.key === 'Tab') && items.length && !e.shiftKey) pick(active)
    else if (e.key === 'Escape') close()
    else return
    e.preventDefault()
    e.stopImmediatePropagation() // the field's own Enter (send) and the window's Esc (close) stay out of it
  })
  field.addEventListener('input', draw)
  field.addEventListener('click', draw)
  field.addEventListener('keyup', (e) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && draw())
  field.addEventListener('blur', () => setTimeout(() => document.activeElement !== field && close(), 100))
  list.addEventListener('mousedown', (e) => {
    e.preventDefault() // keep the cursor in the field
    const it = e.target.closest('[data-i]')
    if (it) pick(Number(it.dataset.i))
  })
  list.addEventListener('mousemove', (e) => {
    const it = e.target.closest('[data-i]')
    if (it && Number(it.dataset.i) !== active) (active = Number(it.dataset.i)), highlight()
  })
  addEventListener('resize', close)
  return { close, open: () => Boolean(at) }
}

// What counts as an @mention: the hub's rule (addressees in core/hub.js), so the box colors exactly what will be
// delivered. Not one: @words glued to something (a@b.com, @types/node, @david's), code in backticks, @you/@any/@crew.
const MENTION = /(?<![\w.@/'-])@([\w-]+(?:@[\w-]+)?)(?![\w@/'-]|\.\w)/g
const NOT_NAMES = new Set(['you', 'any', 'crew', 'auto'])
// code spans blanked out, same length, so positions still line up with the text
const proseOf = (text) => String(text).replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length)).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
// @gal is the gal here, or the only gal on a linked computer (as the hub resolves it)
function mentioned(name, agents) {
  const n = name.toLowerCase()
  const exact = agents.find((a) => a.name === n)
  if (exact || n.includes('@')) return exact
  const there = agents.filter((a) => a.seed === n)
  return there.length === 1 ? there[0] : undefined
}

// Mentions in color, right in the message box. A textarea can't color part of its text, so a copy of the text
// sits under it (same font, padding and wrapping) with each @mention painted in its agent's color, and the
// textarea's own letters are transparent (the caret and selection stay). A name nobody on the crew has gets a red
// underline and one that's off an amber one, since the hub would refuse the send; the name still being typed
// stays plain. strict(): whether unknown names matter here (a task's @owner doesn't refuse anything).
function mountInk(field, { agents, strict = () => true }) {
  const ink = document.createElement('div')
  ink.className = 'ink'
  ink.setAttribute('aria-hidden', 'true')
  field.before(ink)
  field.classList.add('inked')
  if (getComputedStyle(field.parentElement).position === 'static') field.parentElement.style.position = 'relative'
  const cs = getComputedStyle(field)
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'wordBreak', 'overflowWrap']) ink.style[k] = cs[k]
  const place = () => {
    Object.assign(ink.style, { left: `${field.offsetLeft}px`, top: `${field.offsetTop}px`, width: `${field.offsetWidth}px`, height: `${field.offsetHeight}px` })
    // a scrollbar in the field narrows its text: narrow the copy the same, so lines break in the same places
    const bar = field.offsetWidth - field.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
    ink.style.paddingRight = `${parseFloat(cs.paddingRight) + Math.max(0, bar)}px`
    ink.scrollTop = field.scrollTop
  }
  const paint = () => {
    const text = field.value
    const caret = document.activeElement === field ? field.selectionEnd : -1
    const crew = agents()
    let html = ''
    let last = 0
    for (const m of proseOf(text).matchAll(MENTION)) {
      if (NOT_NAMES.has(m[1].toLowerCase())) continue
      const end = m.index + m[0].length
      const a = mentioned(m[1], crew)
      const cls = a ? (a.on ? 'ok' : 'off') : end !== caret && strict() && crew.length ? 'unknown' : ''
      if (!cls) continue
      html += `${esc(text.slice(last, m.index))}<span class="mention ${cls}"${a ? ` style="--c:${agentColor(a)}"` : ''}>${esc(text.slice(m.index, end))}</span>`
      last = end
    }
    // a trailing newline only gets its line in the copy if something follows it
    ink.innerHTML = `${html}${esc(text.slice(last))}​`
    place()
  }
  field.addEventListener('input', paint)
  field.addEventListener('scroll', () => (ink.scrollTop = field.scrollTop), { passive: true })
  for (const ev of ['keyup', 'click', 'focus', 'blur']) field.addEventListener(ev, paint)
  // the field moves when something appears above it in its box (a reply preview, thumbnails)
  const moved = new ResizeObserver(place)
  moved.observe(field)
  moved.observe(field.parentElement)
  paint()
  return { paint }
}

function mountComposer(el, { dropZone = el } = {}) {
  el.classList.add('composer')
  el.innerHTML = `<div class="chips" role="group" aria-label="Send to"></div>
    <div class="input">
      <div class="reply-to hidden"></div>
      <div class="thumbs hidden"></div>
      <textarea rows="1"></textarea>
      <div class="input-bar">
        <button class="attach" title="Add images (or paste or drop them)">${ICONS.plus}</button>
        <button class="fresh-toggle" aria-pressed="false">${ICONS.fresh}<span>New conversation</span></button>
        <span class="grow"></span>
        <button class="mic" aria-label="Dictate"></button>
        <button class="send" disabled title="Send (Enter)" aria-label="Send">${ICONS.up}</button>
      </div>
    </div>
    <div class="hint"></div>
    <div class="rail-tip" aria-hidden="true"></div>`
  const chips = el.querySelector('.chips')
  const ta = el.querySelector('textarea')
  const send = el.querySelector('.send')
  const hint = el.querySelector('.hint')
  const tip = el.querySelector('.rail-tip')
  const freshBtn = el.querySelector('.fresh-toggle')
  // Task mode lasts while you're adding tasks, not across launches: Auto again next time.
  let target = store.get('crew.target') || 'auto'
  if (target === 'task' || target === 'bug') target = 'auto'
  // New conversation: the task starts with a clean slate instead of joining everything the agent did before.
  let fresh = store.get('crew.fresh') === '1'
  let agents = []
  let feed = []
  // Replying: to a message in the feed (its Reply button), and then staying in that thread, each message answering
  // the newest one in it. A message sent into a new conversation starts a thread too, so what you send next goes
  // on in that conversation. Esc, ×, or picking someone on the To line leaves it.
  let reply = null // { to: [names], id, from, text, ids: thread ids it answers, freshConvo }
  let follow = null // just sent: { at, to } until the next state shows the message, which the thread then answers
  const replyBox = el.querySelector('.reply-to')
  const quoteOf = (e) => (e.ticket !== undefined ? `#${String(e.ticket).split('@')[0]} ${e.title ?? ''}` : snippet(e.text))
  const short = (n) => String(n).split('@')[0]
  const listed = (names) => (names.length > 2 ? `${names.slice(0, -1).map(short).join(', ')} and ${short(names.at(-1))}` : names.map(short).join(' and '))
  const replyTo = (e) => {
    if (!e || !['reply', 'handoff', 'note', 'msg', 'task'].includes(e.kind) || e.ticket !== undefined && e.from !== 'you') return
    reply = { to: e.from === 'you' ? [...(e.cc ?? [e.to])] : [e.from], id: e.id, from: e.from, text: quoteOf(e) }
    follow = null
    draw()
    ta.focus()
  }
  const stopReply = () => {
    if (!reply && !follow) return false
    reply = null
    follow = null
    draw()
    return true
  }
  // the thread moves on: what you just sent, then the newest answer to it
  const advance = () => {
    if (follow) {
      const mine = feed.findLast((e) => e.from === 'you' && e.kind === 'msg' && e.ts >= follow.at - 1500 && (!follow.to || (e.cc ?? [e.to]).some((n) => follow.to.includes(n))))
      if (mine) {
        reply = { to: [...(mine.cc ?? [mine.to])], id: mine.id, from: 'you', text: quoteOf(mine), freshConvo: Boolean(mine.fresh) || Boolean(reply?.freshConvo && follow.to) }
        follow = null
      } else if (Date.now() - follow.at > 20000) follow = null
    }
    if (!reply) return
    const copies = (e) => (e.sendId ? feed.filter((x) => x.sendId === e.sendId).map((x) => x.id) : [e.id])
    for (let ids = copies(reply), next; (next = feed.findLast((e) => ids.includes(e.re) && ['reply', 'handoff', 'msg'].includes(e.kind) && e.id !== reply.id)); ids = copies(next)) {
      reply = { ...reply, id: next.id, from: next.from, text: quoteOf(next) }
    }
  }
  const drawReply = () => {
    replyBox.classList.toggle('hidden', !reply)
    if (!reply) return
    const color = reply.from === 'you' ? 'var(--accent)' : agentColor(agents.find((a) => a.name === reply.from) ?? { name: reply.from })
    const others = reply.to.filter((n) => n !== reply.from)
    const head = reply.from === 'you'
      ? `Continuing ${reply.freshConvo ? 'the new conversation ' : ''}with ${esc(listed(reply.to))}`
      : `Replying to ${esc(short(reply.from))}${others.length ? `<span> · also to ${esc(listed(others))}</span>` : ''}`
    morph(replyBox, `<span class="rt-bar" style="--qc:${color}"></span><span class="rt-text"><b>${head}</b><span class="rt-quote">${reply.from === 'you' ? 'You: ' : ''}${esc(reply.text)}</span></span><button class="rt-close" data-stop-reply title="Stop replying (Esc)" aria-label="Stop replying">${ICONS.close}</button>`)
  }
  replyBox.addEventListener('click', (e) => e.target.closest('[data-stop-reply]') && (stopReply(), ta.focus()))
  const attach = mountAttach({
    zone: dropZone,
    field: ta,
    tray: el.querySelector('.thumbs'),
    button: el.querySelector('.attach'),
    onChange: () => autosize(),
    onError: (msg) => say(msg, true),
  })

  // `task: …`, `bug: …` or `feature: …` (or /task…) adds to the Tasks board whatever chip is picked.
  const TASK_PREFIX = /^\s*(?:(task|bug|feature):|\/(task|bug|feature)\b)\s*/i
  const kindIn = (text) => {
    const m = String(text).match(TASK_PREFIX)
    return m ? (m[1] ?? m[2]).toLowerCase() : target === 'task' ? 'task' : null
  }
  // Who it's for, on one line: Auto, Task, then the crew. Each chip carries a tooltip (data-tip), since a big
  // crew shows only faces.
  const chip = (to, cls, inner, tipText, sub, c) =>
    `<button class="chip ${cls} ${target === to ? 'on' : ''}" data-to="${esc(to)}" aria-pressed="${target === to}" aria-label="${esc(tipText)}" data-tip="${esc(tipText)}" data-sub="${esc(sub)}"${c ? ` style="--c:${c}"` : ''}>${inner}</button>`
  const draw = () => {
    if (!['auto', 'task'].includes(target) && agents.length && !agents.some((a) => a.on && a.name === target)) target = 'auto'
    const task = Boolean(kindIn(ta.value))
    morph(chips,
      '<span class="chips-label">To</span>' +
      chip('auto', '', `${ICONS.sparkles}<span class="label">Auto</span>`, 'Auto', 'picks by area, prefers whoever is free') +
      chip('task', 'task-chip', `${ICONS.task}<span class="label">Task</span>`, 'Task', 'adds it to the Tasks board, @name assigns it') +
      '<span class="chip-sep"></span>' +
      agents.filter((a) => a.on).map((a) => chip(a.name, 'agent', `${avatarHTML(a, { size: 22 })}<span class="label">${nameHTML(a)}</span>${unreadBadge(a.unread)}`, a.name, `${statusText(a)}${a.unread ? ` · ${plural(a.unread, 'new reply', 'new replies')}` : ''}`, agentColor(a))).join(''))
    fitRail()
    el.classList.toggle('task-mode', task)
    freshBtn.setAttribute('aria-pressed', String(fresh))
    freshBtn.title = fresh ? 'On: the agent starts this task in a new conversation, with a clean slate (click to turn off)' : 'Start this task in a new conversation, with a clean slate instead of everything the agent did before'
    drawReply()
    const who = target.split('@')[0]
    ta.placeholder = task ? 'Add a task… @name assigns it'
      : reply ? `Reply to ${listed(reply.to)}…`
      : target === 'auto' ? (fresh ? 'New conversation, Auto picks who…' : 'Message the crew, Auto picks who…')
      : fresh ? `New conversation with ${who}…` : `Message ${who}…`
  }
  // Names while they fit on the line, faces only once they don't (the same for every chip, so picking one never
  // moves the others), then Auto and Task as icons; past that the line scrolls, with a fade where it continues.
  const railEnd = () => chips.classList.toggle('at-end', chips.scrollLeft + chips.clientWidth >= chips.scrollWidth - 2)
  const fitRail = () => {
    if (!chips.clientWidth) return
    const over = () => chips.scrollWidth > chips.clientWidth + 1
    chips.classList.remove('compact', 'tight')
    if (over()) chips.classList.add('compact')
    if (over()) chips.classList.add('tight')
    chips.classList.toggle('overflow', over())
    railEnd()
  }
  const autosize = () => {
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
    ta.style.overflowY = ta.scrollHeight > 160 ? 'auto' : 'hidden'
    send.disabled = !ta.value.trim() && !attach?.get().length
    ink?.paint() // dictation and sending change the text without an input event
  }
  const say = (text, error = false) => {
    hint.textContent = text
    hint.className = `hint ${error ? 'error' : ''}`
    clearTimeout(say.timer)
    // A rejected send (e.g. an @name that isn't a teammate) stays up until the draft is edited.
    if (!error) say.timer = setTimeout(() => (hint.textContent = ''), 4000)
  }
  const setTarget = (name) => {
    target = name
    if (name !== 'task') store.set('crew.target', name)
    draw()
  }
  const submit = async () => {
    if (voice?.busy()) return voice.stop({ send: true }) // sends once the last words are in
    const text = ta.value.trim()
    const images = attach.get()
    if (!text && !images.length) return
    // The chip stays a recipient; the hub adds any @mentions to it.
    const to = target === 'auto' ? undefined : target
    const sentAt = Date.now()
    try {
      const kind = kindIn(text)
      if (kind) {
        const { owner, text: what } = ownerIn(text.replace(TASK_PREFIX, ''), agents)
        say((await crew.call('task', 'file', null, { text: what, images, kind, ...(owner && { owner }) })).trim())
      }
      else {
        say((await crew.call('send', reply ? reply.to.join(',') : to, text, images, { fresh, ...(reply && { re: reply.id }) })).trim().split('\n').join(' · '))
        // New conversation is for one message: what you send next goes on in that conversation, as a reply
        if (fresh || reply) follow = { at: sentAt, to: reply?.to ?? (to ? [to] : null) }
        if (fresh) (fresh = false), store.set('crew.fresh', '0')
        draw()
      }
      ta.value = ''
      attach.set([])
      autosize()
    } catch (e) {
      say(e.message, true)
    }
  }

  chips.addEventListener('click', (e) => {
    const picked = e.target.closest('[data-to]')
    if (!picked) return
    stopReply() // picking someone else leaves the thread
    setTarget(picked.dataset.to)
    tip.classList.remove('on')
    ta.focus()
  })
  new ResizeObserver(fitRail).observe(chips)
  chips.addEventListener('scroll', () => (railEnd(), tip.classList.remove('on')), { passive: true })
  chips.addEventListener('wheel', (e) => {
    if (!chips.classList.contains('overflow') || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    chips.scrollLeft += e.deltaY
    e.preventDefault()
  }, { passive: false })
  chips.addEventListener('pointerover', (e) => {
    const c = e.target.closest('[data-tip]')
    if (!c) return
    tip.innerHTML = `${esc(c.dataset.tip)}<small>${esc(c.dataset.sub)}</small>`
    const r = c.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    const half = tip.offsetWidth / 2
    tip.style.left = `${Math.min(Math.max(r.left - box.left + r.width / 2, half + 6), box.width - half - 6)}px`
    tip.style.top = `${r.top - box.top - 5}px`
    tip.classList.add('on')
  })
  chips.addEventListener('pointerleave', () => tip.classList.remove('on'))
  // the whole box is the text field: a click on its empty parts puts the cursor in
  el.querySelector('.input').addEventListener('mousedown', (e) => {
    if (e.target.closest('button, textarea, .thumbs')) return
    e.preventDefault()
    ta.focus()
  })
  ta.addEventListener('input', () => {
    autosize()
    if (hint.classList.contains('error')) say('')
    if (el.classList.contains('task-mode') !== Boolean(kindIn(ta.value))) draw()
  })
  freshBtn.addEventListener('click', () => {
    fresh = !fresh
    store.set('crew.fresh', fresh ? '1' : '0')
    draw()
    ta.focus()
  })
  // mentions in their agent's color as you type
  const ink = mountInk(ta, { agents: () => agents, strict: () => !el.classList.contains('task-mode') })
  // @name opens the crew list; in task mode a mention assigns the task
  const mentions = mountMentions(ta, { agents: () => agents, box: el.querySelector('.input'), heading: () => (el.classList.contains('task-mode') ? 'Assign to' : 'Mention: they get it too') })
  ta.addEventListener('keydown', (e) => {
    if (voice?.key(e)) return
    if (e.key === 'Escape' && !e.isComposing && stopReply()) return void (e.preventDefault(), e.stopPropagation())
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  })
  send.addEventListener('click', submit)
  // Dictation (ui/voice.js): the mic button fills in the message as you talk.
  const voice = typeof mountVoice === 'function' && crew.onVoice ? mountVoice({ composer: el, textarea: ta, button: el.querySelector('.mic'), changed: autosize, submit }) : null
  if (!voice) el.querySelector('.mic').remove()
  draw()

  return {
    render(state) {
      agents = state.agents
      feed = state.feed ?? []
      advance()
      draw()
      ink.paint() // someone switched on, off, or joined
    },
    setTarget,
    replyTo,
    focus: () => ta.focus(),
    // true when it stopped a dictation (so Esc can stop that first, and close things on the next press)
    stopVoice: () => Boolean(voice?.busy() && (voice.stop(), true)),
  }
}

// Agent rows appear on several views; these listeners handle their mode chips and on/off switch.
// A chip flips right away and the next state push confirms it.
document.addEventListener('click', (e) => {
  const chip = e.target.closest?.('.mode[data-yolo], .mode[data-fast]')
  if (!chip) return
  const on = chip.getAttribute('aria-pressed') !== 'true'
  const [name, mode] = chip.dataset.yolo ? [chip.dataset.yolo, 'yolo'] : [chip.dataset.fast, 'fast']
  chip.setAttribute('aria-pressed', String(on))
  flips.set(`${name}:${mode}`, { on, at: Date.now() })
  crew.call('update', name, mode === 'yolo' ? { yolo: on } : { tier: on ? 'fast' : 'default' }).catch((err) => {
    flips.delete(`${name}:${mode}`)
    chip.setAttribute('aria-pressed', String(!on))
    alert(`Couldn't change ${name}: ${err.message}`)
  })
})
document.addEventListener('change', (e) => {
  const { power } = e.target.dataset ?? {}
  if (!power) return
  if (!e.target.checked && 'busy' in e.target.dataset && !confirm(`${power} is in the middle of something. Turn it off anyway?`)) {
    e.target.checked = true
    return
  }
  crew.call('update', power, { off: !e.target.checked })
})

// Theme button: Auto (follow macOS) → Light → Dark. Saved in config.json, applied to every window.
const THEMES = { system: ['auto', 'Theme: follows macOS'], light: ['sun', 'Theme: light'], dark: ['moon', 'Theme: dark'] }
const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' }
function themeButton(btn) {
  let theme = 'system'
  btn.addEventListener('click', () => crew.call('theme', NEXT_THEME[theme]))
  return (next) => {
    theme = next ?? 'system'
    const [icon, label] = THEMES[theme]
    btn.innerHTML = ICONS[icon]
    btn.title = `${label} (click for ${NEXT_THEME[theme] === 'system' ? 'auto' : NEXT_THEME[theme]})`
  }
}

// Every view: fetch state once, then re-render on pushes and every 15s so "working · 3m" stays fresh.
async function live(render) {
  // every view gets each agent's count of unread replies as a.unread
  const counted = (s) => {
    const n = {}
    for (const e of s.feed ?? []) if (isUnread(e, s.reads)) n[e.from] = (n[e.from] ?? 0) + 1
    for (const a of s.agents) a.unread = n[a.name] ?? 0
    return s
  }
  let state = counted(await crew.call('state'))
  render(state)
  crew.onState((next) => render((state = counted(next))))
  setInterval(() => render(state), 15000)
}

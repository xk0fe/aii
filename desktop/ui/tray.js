// Menu bar popover: what needs you first, who's at work, the accounts' limits, and the way into everything else.
/* global activityWords, unreadBadge, avatarHTML, popMenu, wsTile, wsStatus, wsLabel, joinable, joinItem, oops, elsewhere, hasWorkspaces, clique, live, morph, esc, celebrate, markSVG, store, ICONS,
   needsYou, needText, usageTip, usageByComputer, computerIcon, THIS_COMPUTER, paceWarning, resetsText, runningSubs, subsTip, clonesOf, displayName, statusText, blockedOn, ago,
   pauseMenu, notifyTime, notifyHeld, plural, modeChips, powerSwitch, COLORS, ON_WINDOWS, keys, wordmarkHTML, stripHTML, PRODUCT_NAME */
// Everything here is local: classic scripts share one global scope with common.js and avatar.js.
;(() => {
  const $ = (s) => document.querySelector(s)
  $('header .brand').innerHTML = wordmarkHTML(22)
  $('[data-act=quit]').title = `Quit ${PRODUCT_NAME}`
  $('.autopilot .glyph').innerHTML = ICONS.plane
  $('[data-act=add]').innerHTML = `${ICONS.plus}New agent`
  $('[data-act=dashboard]').innerHTML = ICONS.expand
  $('[data-act=settings]').innerHTML = ICONS.gear
  $('[data-act=quit]').innerHTML = ICONS.power

  // ---- Windows: the icon in the notification area ------------------------------------------------------------
  // Windows has no menu bar title for "2/5", so the icon carries the count, drawn here because a page has a canvas: the
  // three buddies in their colors (they read on a light taskbar and a dark one), and in the corner how many need you
  // (amber) or are at work (green). main.js asks for it at each size Windows may want (16px at 100%, 32px at 200%).
  const BUDDY_COLORS = [COLORS.sky, COLORS.pink, COLORS.lime]
  const buddies = [...new DOMParser().parseFromString(markSVG(), 'image/svg+xml').querySelectorAll('path')].map((p) => ({
    path: new Path2D(p.getAttribute('d')),
    turn: /rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)/.exec(p.getAttribute('transform') ?? '')?.slice(1).map(Number),
  }))
  const BADGE = { need: ['#ff9f0a', '#241500'], work: ['#34c759', '#062b10'] }
  function badge(ctx, px, count, tone, { x, y, r }) {
    const [fill, ink] = BADGE[tone]
    const text = count <= 9 ? String(count) : px >= 24 ? '9+' : '' // too small for two figures: just the dot
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out' // a gap round the badge, so it never runs into the buddies
    ctx.beginPath()
    ctx.arc(x, y, r + Math.max(1, px / 16), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    if (!text) return
    ctx.fillStyle = ink
    ctx.font = `700 ${Math.round(r * (text.length > 1 ? 1.25 : 1.55))}px 'Segoe UI Variable Text', 'Segoe UI', -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y + r * 0.08)
  }
  // -> a PNG data URL for each size
  window.cliqueTrayIcon = ({ count = 0, tone = '' } = {}, sizes = [16, 20, 24, 32]) => sizes.map((px) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: px, height: px })
    const ctx = canvas.getContext('2d')
    // the mark is 24 wide and about 9.5 tall: as wide as the icon, sitting a little low like a creature on the taskbar
    const k = px / 24
    ctx.save()
    ctx.translate(0, px * 0.62 - 16.3 * k)
    ctx.scale(k, k)
    buddies.forEach((b, i) => {
      ctx.save()
      if (b.turn) ctx.translate(b.turn[1], b.turn[2]), ctx.rotate((b.turn[0] * Math.PI) / 180), ctx.translate(-b.turn[1], -b.turn[2])
      ctx.fillStyle = BUDDY_COLORS[i]
      ctx.fill(b.path, 'evenodd')
      ctx.restore()
    })
    ctx.restore()
    if (count > 0 && BADGE[tone]) badge(ctx, px, count, tone, { x: px * 0.72, y: px * 0.28, r: px * 0.28 })
    return canvas.toDataURL('image/png')
  })
  // The taskbar button's overlay, while someone needs you: the badge alone, 16px (Windows draws it in the corner).
  window.cliqueBadge = (count) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 32, height: 32 })
    badge(canvas.getContext('2d'), 32, count, 'need', { x: 16, y: 16, r: 15 })
    return canvas.toDataURL('image/png')
  }

  // An agent in the dashboard: its terminal, with the chat on it, where a question it asked waits for your answer.
  const openAgent = (name) => clique.call('dashboard', name)

  // Lists you opened past their first few ('needs', 'work') and the quiet line's rows ('rest'): the popover remembers.
  const unfolded = new Set((() => {
    try {
      return JSON.parse(store.get('clique.tray.open') || '[]')
    } catch {
      return []
    }
  })())
  const toggle = (key) => {
    unfolded.has(key) ? unfolded.delete(key) : unfolded.add(key)
    store.set('clique.tray.open', JSON.stringify([...unfolded]))
  }
  let state = null

  // ---- what an agent is doing, in plain words (activityWords is in common.js) ------------------------------------

  const sentence = (s) => String(s).replace(/^./, (c) => c.toUpperCase())
  // "on the Mac mini", "on the MacBook Pro", but "on Studio" and "on Ann's MacBook": only a computer named after its
  // kind of computer takes "the"
  const theOf = (name) => (/^(mac|macbook|imac|laptop|surface)\b/i.test(name) && !/'s\b/i.test(name) ? `the ${name}` : name)
  const where = (a) => (a.home ? ` on ${theOf(a.homeName ?? a.home)}` : '')
  const nameOf = (a) => (a.cloneOf ? displayName(a) : a.seed ?? a.name)
  function doing(a) {
    const on = blockedOn(a)
    if (on) return `Waiting on ${on[0].name.split('@')[0]}${on.length > 1 ? ` and ${plural(on.length - 1, 'other')}` : ''}`
    if (a.status === 'starting') return sentence(statusText(a))
    if (a.status !== 'working') return sentence(statusText(a))
    if (a.activity) return activityWords(a.activity)
    return Date.now() - a.since < 60000 ? 'Working' : `Working for ${ago(a.since)}`
  }
  // a free, off or unreachable one's line, when the quiet line is open
  function restWords(a) {
    if (!a.on) return 'Off'
    if (a.status === 'away') return `Offline${where(a)}`
    if (a.status === 'parked') return 'Parked'
    if (a.status !== 'idle' && a.status !== 'resting') return 'Stopped'
    return `Idle${where(a)}` // its sub-agents are the count beside it
  }
  // its creature, with how many of its replies you haven't read (as on the dashboard's rows)
  const face = (a, size) => `<span class="t-face">${avatarHTML(a, { size })}${unreadBadge(a.unread)}</span>`
  const tipOf = (a, line) => [`${displayName(a)}${a.area ? ` · ${a.area}` : ''}`, line, a.activity && a.status === 'working' ? a.activity : '',
    a.unread ? plural(a.unread, 'new reply', 'new replies') : '', a.queue ? `${a.queue} queued` : '', a.freshPending ? 'New conversation when free' : a.pending ? 'Restarts when free' : ''].filter(Boolean).join('\n')

  // ---- rows -------------------------------------------------------------------------------------------------------

  const tags = (a) => (a.yolo ? '<i class="t-yolo" title="YOLO: skips every permission prompt">YOLO</i>' : '') +
    (a.fast ? '<i class="t-fast" title="Fast: the fast service tier">Fast</i>' : '')
  const clonesAt = (a) => clonesOf(state.agents, a).filter((c) => c.on)
  // its clones (a click lists them, each one's terminal a click away) and its sub-agents, as counts
  function counts(a) {
    const clones = clonesAt(a)
    const subs = runningSubs(a)
    return (clones.length ? `<button class="t-count clones" data-clones="${esc(a.name)}" title="${esc(`${plural(clones.length, 'clone')} at work. Click for their terminals`)}">${clones.slice(0, 2).map((c) => avatarHTML(c, { size: 16, mood: 'still' })).join('')}${clones.length}</button>` : '') +
      (subs.length ? `<span class="t-count" title="${esc(`${plural(subs.length, 'sub-agent')} working:\n${subsTip(subs)}`)}">${ICONS.subs}${subs.length}</span>` : '')
  }
  // YOLO, Fast and power on hover, as on the dashboard's rows (common.js handles their clicks)
  const acts = (a) => (a.cloneOf ? '' : `<span class="t-acts">${modeChips(a)}${powerSwitch(a)}</span>`)

  function needRow({ agent: a, ask }) {
    const text = needText({ agent: a, ask })
    return `<div class="t-row t-need t-in" data-agent="${esc(a.name)}" data-open="${esc(a.name)}" title="${esc(tipOf(a, text))}">${face(a, 30)}` +
      `<span class="t-who"><span class="t-top"><b>${esc(nameOf(a))}</b>${tags(a)}${counts(a)}${a.home ? `<small>${esc(where(a).trim())}</small>` : ''}</span><span class="t-line">${esc(text)}</span></span>` +
      `<button class="t-go" data-open="${esc(a.name)}" title="${ask ? 'Answer it in the dashboard' : 'It asks in its terminal: open it'}">${ask ? 'Answer' : 'Open'}</button></div>`
  }
  // someone waiting on you in another open workspace: a click switches there
  function awayRow({ w, a }) {
    return `<div class="t-row t-need t-in" data-agent="${esc(`${w.id}/${a.name}`)}" data-away-ws="${esc(w.id)}" data-away-agent="${esc(a.name)}" title="${esc(`${a.name} needs you in ${w.name}${a.activity ? `: ${a.activity}` : ''}`)}">${avatarHTML({ ...a, status: 'waiting' }, { size: 30 })}` +
      `<span class="t-who"><span class="t-top"><b>${esc(a.seed ?? a.name.split('@')[0])}</b></span><span class="t-line">${wsTile(w, { size: 15 })}Needs you in ${esc(w.name)}</span></span>` +
      `<button class="t-go" data-away-ws="${esc(w.id)}" data-away-agent="${esc(a.name)}" title="Switch to ${esc(w.name)} and open it">Open</button></div>`
  }
  function workRow(a) {
    const line = doing(a) + where(a)
    return `<div class="t-row t-in" data-agent="${esc(a.name)}" data-open="${esc(a.name)}" title="${esc(tipOf(a, line))}">${face(a, 30)}` +
      `<span class="t-who"><span class="t-top"><b>${esc(nameOf(a))}</b>${tags(a)}</span><span class="t-line">${esc(line)}</span></span>` +
      `<span class="t-end">${counts(a)}${acts(a)}</span></div>`
  }
  function slimRow(a) {
    const line = restWords(a)
    return `<div class="t-row t-slim ${a.on ? esc(a.status) : 'off'} t-in" data-agent="${esc(a.name)}" data-open="${esc(a.name)}" title="${esc(tipOf(a, line))}">${face(a, 24)}` +
      `<span class="t-who"><span class="t-top"><b>${esc(nameOf(a))}</b>${tags(a)}</span><span class="t-line">${esc(line)}</span></span>` +
      `<span class="t-end">${counts(a)}${acts(a)}</span></div>`
  }
  const label = (text, cls = '') => `<div class="t-label ${cls}">${esc(text)}</div>`
  // "+3 more" under a list cut short, with the first faces it hides; "Show fewer" once it's open
  const moreLine = (key, hidden, open) => `<button class="t-fold t-more t-in" data-fold="${key}" aria-expanded="${open}">` +
    (open ? '<span class="gap"></span>Show fewer' : `<span class="faces">${hidden.slice(0, 2).map((a) => avatarHTML(a, { size: 18, mood: 'still' })).join('')}</span>+${hidden.length} more`) +
    `<span class="chev">${ICONS.chevron}</span></button>`

  // "June is idle, with 1 helper at work · Noor is off", or with many, "5 idle · 4 off · the Laptop is offline"
  const together = (names, one, many) => (!names.length ? '' : names.length === 1 ? `${names[0]} ${one}` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} ${many}`)
  function restText(rest) {
    const free = rest.filter((a) => a.on && (a.status === 'idle' || a.status === 'resting'))
    const away = rest.filter((a) => a.on && a.status === 'away')
    const parked = rest.filter((a) => a.on && a.status === 'parked')
    const stopped = rest.filter((a) => a.on && !['idle', 'resting', 'away', 'parked'].includes(a.status))
    const off = rest.filter((a) => !a.on)
    const computers = [...new Set(away.map((a) => a.homeName ?? a.home))].map(theOf)
    const offline = computers.length ? `${together(computers, 'is', 'are')} offline` : ''
    if (rest.length > 3) return [free.length && `${free.length} idle`, stopped.length && `${stopped.length} stopped`, parked.length && `${parked.length} asleep`, off.length && `${off.length} off`, offline].filter(Boolean).join(' · ')
    const names = (list) => list.map(nameOf)
    const helped = free.filter((a) => runningSubs(a).length)
    return [
      ...helped.map((a) => `${nameOf(a)} is idle, with ${plural(runningSubs(a).length, 'helper')} at work`),
      together(names(free.filter((a) => !helped.includes(a))), 'is idle', 'are idle'),
      together(names(stopped), 'has stopped', 'have stopped'),
      together(names(parked), 'is asleep', 'are asleep'),
      together(names(off), 'is off', 'are off'),
      offline,
    ].filter(Boolean).join(' · ')
  }

  // Who goes where: needs you (oldest first, then other workspaces'), at work (in your own order, clones counted on their
  // agent's row unless it isn't there), and everyone else in one line.
  function sections() {
    const needs = needsYou(state)
    const away = elsewhere(state).who.flatMap((w) => (w.needs ?? []).map((a) => ({ w, a })))
    const busy = (a) => a.on && (a.status === 'working' || a.status === 'starting')
    const atWork = new Set(state.agents.filter((a) => !a.cloneOf && busy(a)).map((a) => a.name))
    const work = state.agents.filter((a) => busy(a) && (!a.cloneOf || !atWork.has(a.cloneOf)))
    const asking = new Set(needs.map((n) => n.agent.name))
    const rest = state.agents.filter((a) => !a.cloneOf && !busy(a) && !asking.has(a.name))
    return { needs, away, work, rest }
  }

  // Short lists show whole. Longer ones show their first few and a "+N more" line that opens the rest: up to four that need
  // you, and fewer at work the more need you, so a big clique keeps the popover a glance tall.
  const capOf = (list, cap, key) => (list.length <= cap + 1 || unfolded.has(key) ? list.length : cap)
  function capped(list, cap, key, row) {
    if (list.length <= cap + 1) return list.map(row)
    const open = unfolded.has(key)
    return [...list.slice(0, open ? list.length : cap).map(row), moreLine(key, list.slice(cap).map((x) => x.a ?? x), open)]
  }

  function drawLists() {
    if (!state.agents.length && !elsewhere(state).waiting) {
      morph($('.lists > .needs'), [])
      morph($('.lists > .work'), ['<div class="empty">No agents yet. Add one per area of work, like the checkout or the docs.</div>'])
      morph($('.lists > .rest'), [])
      return
    }
    const { needs, away, work, rest } = sections()
    const asks = [...needs.map((n) => ({ a: n.agent, html: () => needRow(n) })), ...away.map((x) => ({ a: x.a, html: () => awayRow(x) }))]
    morph($('.lists > .needs'), asks.length ? [label(`Needs you · ${asks.length}`, 'amber'), ...capped(asks, 4, 'needs', (x) => x.html())] : [])
    morph($('.lists > .work'), work.length ? [label(`At work · ${work.length}`), ...capped(work, Math.max(3, 7 - capOf(asks, 4, 'needs')), 'work', workRow)] : [])
    const open = unfolded.has('rest')
    morph($('.lists > .rest'), rest.length ? [`<button class="t-fold t-in" data-fold="rest" aria-expanded="${open}" title="${open ? 'Hide them' : 'Show them'}"><span class="gap"></span><span class="grow">${esc(restText(rest))}</span><span class="chev">${ICONS.chevron}</span></button>`,
      ...(open ? rest.map(slimRow) : [])] : [])
    celebrate($('.lists'), state.agents)
  }

  // ---- usage: a bar per account, and what matters about it -------------------------------------------------------

  // "out at 17:53" today, "out Thu 09:00" later on
  const outAt = (ms) => {
    const t = resetsText(ms).replace(/^resets /, '')
    return /^\d/.test(t) ? `out at ${t}` : `out ${t}`
  }
  function usageRow(u, where) {
    const warn = paceWarning(u)
    const w = (warn && u.windows.filter((x) => x.pace?.runsOut).sort((x, y) => x.pace.runsOut - y.pace.runsOut)[0]) || [...u.windows].sort((x, y) => y.pct - x.pct)[0]
    const say = warn ? `${w.pct}% · ${outAt(w.pace.runsOut)}` : w.id === 'seven_day' ? `${w.pct}% this week` : `${w.pct}% · ${resetsText(w.resetsAt)}`
    return `<div class="t-use" title="${esc(`${usageTip(u, where)}${warn ? `\n${warn}` : ''}`)}"><b>${esc(u.label)}</b>` +
      `<span class="bar ${warn ? 'warm' : ''}"><i style="width:${Math.min(100, Math.max(2, w.pct))}%"></i></span><span class="say ${warn ? 'warm' : ''}">${esc(say)}</span></div>`
  }

  // ---- header and footer -------------------------------------------------------------------------------------------

  // With workspaces, the header says which one you're looking at, and switches (a parked one opens).
  $('.ws-switch').addEventListener('click', (e) => {
    e.stopPropagation()
    const list = state.workspaces ?? []
    popMenu($('.ws-switch'), [
      { head: 'Workspaces' },
      ...list.map((w) => ({ label: wsLabel(w), icon: wsTile(w, { size: 18 }), act: w.id, hint: w.current ? 'on screen' : wsStatus(w) })),
      '-',
      { label: 'New workspace…', icon: ICONS.plus, act: ':new' },
      ...(joinable(state).length ? ['-', { head: 'On your other computers' }, ...joinable(state).map(joinItem)] : []),
    ], async (id) => {
      if (id === ':new') return clique.call('dashboard', ':workspace')
      if (id.startsWith('join:')) return clique.call('workspace', 'join', id.slice('join:'.length)).catch((err) => oops("Couldn't show that workspace", err))
      const w = list.find((x) => x.id === id)
      if (w.parked) await clique.call('workspace', 'open', id)
      await clique.call('workspace', 'switch', id)
    })
  })

  // Settings: the theme (and, running from source, config.json). A second click on the gear closes it (the press outside
  // already did).
  let settingsMenu = null
  let settingsWasOpen = false
  addEventListener('pointerdown', (e) => (settingsWasOpen = Boolean(e.target.closest?.('[data-act=settings]') && settingsMenu?.el.isConnected && !settingsMenu.el.classList.contains('leaving'))), true)
  function settings(btn) {
    if (settingsWasOpen) return (settingsWasOpen = false)
    const theme = state.theme ?? 'system'
    settingsMenu = popMenu(btn, [
      { head: 'Theme' },
      ...[['system', `Match ${ON_WINDOWS ? 'Windows' : 'macOS'}`], ['light', 'Light'], ['dark', 'Dark']].map(([id, text]) => ({ label: text, act: `theme:${id}`, icon: id === theme ? ICONS.check : undefined })),
      ...(clique.dev ? ['-', { label: 'Open config.json', icon: ICONS.braces, act: 'config', hint: 'developer' }] : []),
    ], (act) => (act === 'config' ? clique.call('config') : clique.call('theme', act.slice('theme:'.length)).catch((err) => oops('Couldn’t change the theme', err))))
  }

  // Notifications: a click opens the pause menu (for an hour, until tomorrow morning, until you turn them back on, and
  // the schedule in the dashboard); while paused, Resume turns them back on in one click.
  let pauseOpen = null
  let pauseWasOpen = false
  addEventListener('pointerdown', (e) => (pauseWasOpen = Boolean(e.target.closest?.('.notif') && pauseOpen?.el.isConnected && !pauseOpen.el.classList.contains('leaving'))), true)
  $('.notif').addEventListener('click', (e) => {
    if (e.target.closest('[data-resume]')) return clique.call('notifications', { pause: 'off' }).catch((err) => oops('Couldn’t turn notifications back on', err))
    if (pauseWasOpen) return (pauseWasOpen = false)
    pauseOpen = pauseMenu($('.notif'), state.notify, { schedule: () => clique.call('dashboard', ':notifications') })
  })
  function drawNotify() {
    const n = state.notify ?? { quiet: false }
    const paused = n.quiet && n.why === 'pause'
    $('.notif').classList.toggle('held', Boolean(n.quiet))
    morph($('.notif .glyph'), n.quiet ? ICONS.bellZ : ICONS.bell)
    const until = n.quiet && n.until != null ? `until ${notifyTime(n.until)}` : ''
    morph($('.nf-open'), `<b>${paused ? 'Notifications paused' : n.quiet ? 'Notifications off' : 'Notifications'}</b><small>${esc(n.quiet ? until : 'On')}</small>`)
    morph($('.nf-end'), paused ? '<button class="t-go" data-resume title="Turn notifications back on">Resume</button>' : `<span class="chev">${ICONS.updown}</span>`)
    $('.notif').title = n.quiet
      ? `${paused ? (n.until == null ? 'Paused until you turn them back on.' : `Paused until ${notifyTime(n.until)}.`) : `Outside the hours you set: back ${n.until == null ? 'later' : notifyTime(n.until)}.`} ${notifyHeld(n)}\nWhat needs you is still listed here and counted in the ${ON_WINDOWS ? 'taskbar' : 'menu bar'}.`
      : 'Notifications come through. Click to pause them.'
  }

  // an agent's clones, each a click from its terminal
  function cloneMenu(btn) {
    const a = state.agents.find((x) => x.name === btn.dataset.clones)
    if (!a) return
    popMenu(btn, [{ head: `${nameOf(a)}'s clones` }, ...clonesAt(a).map((c) => ({ label: `${displayName(c)}: ${doing(c)}`, icon: avatarHTML(c, { size: 16, mood: 'still' }), act: c.name }))], openAgent)
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.mode, .switch, .menu, .notif')) return
    const clones = e.target.closest('[data-clones]')
    if (clones) return cloneMenu(clones)
    const fold = e.target.closest('[data-fold]')
    if (fold) {
      toggle(fold.dataset.fold)
      return draw()
    }
    const away = e.target.closest('[data-away-ws]')
    if (away) return clique.call('workspace', 'switch', away.dataset.awayWs).then(() => clique.call('dashboard', away.dataset.awayAgent))
    const row = e.target.closest('[data-open]')
    if (row) return openAgent(row.dataset.open)
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'add') clique.call('dashboard', ':add')
    else if (act === 'settings') settings(e.target.closest('[data-act]'))
    else if (act) clique.call(act) // dashboard, quit
  })
  $('.autopilot .switch').addEventListener('change', (e) => clique.call('autopilot', e.target.checked).catch((err) => oops('Couldn’t change autopilot', err)))

  // The window is hidden, not closed, between clicks on the menu bar icon: replay the entrance on each open. The class
  // goes once it's played, so a row that turns up later doesn't play it again.
  let settle = 0
  const opened = () => {
    document.body.classList.remove('opened')
    void document.body.offsetWidth
    document.body.classList.add('opened')
    clearTimeout(settle)
    settle = setTimeout(() => document.body.classList.remove('opened'), 1400)
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && opened())
  opened()

  // The popover grows with the clique up to most of the screen, then the lists scroll inside it.
  function draw() {
    const ws = hasWorkspaces(state)
    $('header .brand').classList.toggle('hidden', ws)
    $('.ws-switch').classList.toggle('hidden', !ws)
    if (ws) {
      const away = elsewhere(state)
      morph($('.ws-switch'), `${wsTile(state.workspace, { size: 22 })}<b>${esc(wsLabel(state.workspace))}</b><span class="ws-chev">${ICONS.updown}</span>${away.waiting ? `<i class="ws-alert waiting">${away.waiting}</i>` : away.unread ? '<i class="ws-alert unread"></i>' : ''}`)
      $('.ws-switch').title = ['Switch workspaces', ...away.who.map((w) => `${wsLabel(w)}: ${wsStatus(w)}`)].join('\n')
    }
    document.documentElement.style.setProperty('--max', `${Math.max(260, Math.min(620, screen.availHeight - 330))}px`)
    // the mini clique strip: everyone at a glance, at the top
    const cliqueNow = state.agents.filter((a) => !a.cloneOf)
    morph($('.t-strip'), cliqueNow.length ? stripHTML(cliqueNow, 318) : '')
    drawLists()
    // a bar per account; with a linked computer that reports its own, each computer's under its name
    const machines = usageByComputer(state)
    const each = machines.length > 1 || machines.some((m) => !m.here)
    const pcHead = (m) => `<div class="t-use-pc ${m.online ? '' : 'off'}">${computerIcon(m.name)}<b>${esc(m.name)}</b><small>${m.here ? THIS_COMPUTER : m.online ? '' : 'offline'}</small></div>`
    morph($('.usage'), machines.length ? `<div class="t-hr first"></div>${machines.map((m) => `${each ? pcHead(m) : ''}${m.accounts.map((u) => usageRow(u, !m.here && m.name)).join('')}`).join('')}` : '')
    drawNotify()
    $('.autopilot').classList.toggle('hidden', !ws) // it's a workspace's
    $('.autopilot .switch').checked = state.autopilot
    $('.autopilot').title = state.autopilot ? 'Autopilot is on: agents hand work to each other without asking you first' : 'Autopilot is off: each hand-off waits in the chat for your Send it'
    clique.fit(340, Math.ceil(document.body.getBoundingClientRect().height)) // rounded up, or the page scrolls by a fraction
  }

  live((next) => {
    state = next
    draw()
  })
})()

// Menu bar popover: what needs you first, who's at work, the accounts' limits, and the way into everything else.
/* global activityWords, unreadBadge, avatarHTML, popMenu, wsTile, wsStatus, elsewhere, hasWorkspaces, crew, live, morph, esc, celebrate, markSVG, store, ICONS,
   needsYou, needText, usageTip, paceWarning, resetsText, runningSubs, subsTip, clonesOf, displayName, statusText, blockedOn, ago,
   plural, modeChips, powerSwitch */
// Everything here is local: classic scripts share one global scope with common.js and avatar.js.
;(() => {
  const $ = (s) => document.querySelector(s)
  $('.logo').outerHTML = markSVG('0 6 24 16')
  $('.autopilot .glyph').innerHTML = ICONS.plane
  $('[data-act=add]').innerHTML = `${ICONS.plus}New agent`
  $('[data-act=dashboard]').innerHTML = ICONS.expand
  $('[data-act=settings]').innerHTML = ICONS.gear
  $('[data-act=quit]').innerHTML = ICONS.power

  // An agent in the dashboard: its terminal, with the chat on it, where a question it asked waits for your answer.
  const openAgent = (name) => crew.call('dashboard', name)

  // Lists you opened past their first few ('needs', 'work') and the quiet line's rows ('rest'): the popover remembers.
  const unfolded = new Set((() => {
    try {
      return JSON.parse(store.get('crew.tray.open') || '[]')
    } catch {
      return []
    }
  })())
  const toggle = (key) => {
    unfolded.has(key) ? unfolded.delete(key) : unfolded.add(key)
    store.set('crew.tray.open', JSON.stringify([...unfolded]))
  }
  let state = null

  // ---- what an agent is doing, in plain words (activityWords is in common.js) ------------------------------------

  const sentence = (s) => String(s).replace(/^./, (c) => c.toUpperCase())
  const theOf = (name) => (/'s\b/i.test(name) ? name : `the ${name}`)
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
    if (a.status !== 'idle') return 'Stopped'
    return `Free${where(a)}` // its sub-agents are the count beside it
  }
  // its creature, with how many of its replies you haven't read (as on the dashboard's rows)
  const face = (a, size) => `<span class="t-face">${avatarHTML(a, { size })}${unreadBadge(a.unread)}</span>`
  const tipOf = (a, line) => [`${displayName(a)}${a.area ? ` · ${a.area}` : ''}`, line, a.activity && a.status === 'working' ? a.activity : '',
    a.unread ? plural(a.unread, 'new reply', 'new replies') : '', a.queue ? `${a.queue} queued` : '', a.freshPending ? 'New conversation when free' : a.pending ? 'Restarts when free' : ''].filter(Boolean).join('\n')

  // ---- rows -------------------------------------------------------------------------------------------------------

  const tags = (a) => (a.yolo ? '<i class="t-yolo" title="YOLO: skips every permission prompt">YOLO</i>' : '') +
    (a.fast ? `<i class="t-fast" title="Fast: Codex's fast service tier">${ICONS.bolt}</i>` : '')
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

  // "arie is free, with 1 sub-agent · ye is off", or with many, "5 free · 4 off · the MacBook Air is offline"
  const together = (names, one, many) => (!names.length ? '' : names.length === 1 ? `${names[0]} ${one}` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} ${many}`)
  function restText(rest) {
    const free = rest.filter((a) => a.on && a.status === 'idle')
    const away = rest.filter((a) => a.on && a.status === 'away')
    const parked = rest.filter((a) => a.on && a.status === 'parked')
    const stopped = rest.filter((a) => a.on && !['idle', 'away', 'parked'].includes(a.status))
    const off = rest.filter((a) => !a.on)
    const computers = [...new Set(away.map((a) => a.homeName ?? a.home))].map(theOf)
    const offline = computers.length ? `${together(computers, 'is', 'are')} offline` : ''
    if (rest.length > 3) return [free.length && `${free.length} free`, stopped.length && `${stopped.length} stopped`, parked.length && `${parked.length} parked`, off.length && `${off.length} off`, offline].filter(Boolean).join(' · ')
    const names = (list) => list.map(nameOf)
    const helped = free.filter((a) => runningSubs(a).length)
    return [
      ...helped.map((a) => `${nameOf(a)} is free, with ${plural(runningSubs(a).length, 'sub-agent')}`),
      together(names(free.filter((a) => !helped.includes(a))), 'is free', 'are free'),
      together(names(stopped), 'has stopped', 'have stopped'),
      together(names(parked), 'is parked', 'are parked'),
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
  // you, and fewer at work the more need you, so a big crew keeps the popover a glance tall.
  const capOf = (list, cap, key) => (list.length <= cap + 1 || unfolded.has(key) ? list.length : cap)
  function capped(list, cap, key, row) {
    if (list.length <= cap + 1) return list.map(row)
    const open = unfolded.has(key)
    return [...list.slice(0, open ? list.length : cap).map(row), moreLine(key, list.slice(cap).map((x) => x.a ?? x), open)]
  }

  function drawLists() {
    if (!state.agents.length && !elsewhere(state).waiting) {
      morph($('.needs'), [])
      morph($('.work'), ['<div class="empty">No agents yet. Add one per area of work, like onboarding or the 3D character.</div>'])
      morph($('.rest'), [])
      return
    }
    const { needs, away, work, rest } = sections()
    const asks = [...needs.map((n) => ({ a: n.agent, html: () => needRow(n) })), ...away.map((x) => ({ a: x.a, html: () => awayRow(x) }))]
    morph($('.needs'), asks.length ? [label(`Needs you · ${asks.length}`, 'amber'), ...capped(asks, 4, 'needs', (x) => x.html())] : [])
    morph($('.work'), work.length ? [label(`At work · ${work.length}`), ...capped(work, Math.max(3, 7 - capOf(asks, 4, 'needs')), 'work', workRow)] : [])
    const open = unfolded.has('rest')
    morph($('.rest'), rest.length ? [`<button class="t-fold t-in" data-fold="rest" aria-expanded="${open}" title="${open ? 'Hide them' : 'Show them'}"><span class="gap"></span><span class="grow">${esc(restText(rest))}</span><span class="chev">${ICONS.chevron}</span></button>`,
      ...(open ? rest.map(slimRow) : [])] : [])
    celebrate($('.lists'), state.agents)
  }

  // ---- usage: a bar per account, and what matters about it -------------------------------------------------------

  // "out at 17:53" today, "out Thu 09:00" later on
  const outAt = (ms) => {
    const t = resetsText(ms).replace(/^resets /, '')
    return /^\d/.test(t) ? `out at ${t}` : `out ${t}`
  }
  function usageRow(u) {
    const warn = paceWarning(u)
    const w = (warn && u.windows.filter((x) => x.pace?.runsOut).sort((x, y) => x.pace.runsOut - y.pace.runsOut)[0]) || [...u.windows].sort((x, y) => y.pct - x.pct)[0]
    const say = warn ? `${w.pct}% · ${outAt(w.pace.runsOut)}` : w.id === 'seven_day' ? `${w.pct}% this week` : `${w.pct}% · ${resetsText(w.resetsAt)}`
    return `<div class="t-use" title="${esc(`${usageTip(u)}${warn ? `\n${warn}` : ''}`)}"><b>${esc(u.label)}</b>` +
      `<span class="bar ${warn ? 'warm' : ''}"><i style="width:${Math.min(100, Math.max(2, w.pct))}%"></i></span><span class="say ${warn ? 'warm' : ''}">${esc(say)}</span></div>`
  }

  // ---- header and footer -------------------------------------------------------------------------------------------

  // With workspaces, the header says which one you're looking at, and switches (a parked one opens).
  $('.ws-switch').addEventListener('click', (e) => {
    e.stopPropagation()
    const list = state.workspaces ?? []
    popMenu($('.ws-switch'), [
      { head: 'Workspaces' },
      ...list.map((w) => ({ label: w.name, icon: wsTile(w, { size: 18 }), act: w.id, hint: w.current ? 'on screen' : wsStatus(w) })),
      '-',
      { label: 'New workspace…', icon: ICONS.plus, act: ':new' },
    ], async (id) => {
      if (id === ':new') return crew.call('dashboard', ':workspace')
      const w = list.find((x) => x.id === id)
      if (w.parked) await crew.call('workspace', 'open', id)
      await crew.call('workspace', 'switch', id)
    })
  })

  // Settings: the theme and config.json. A second click on the gear closes it (the press outside already did).
  let settingsMenu = null
  let settingsWasOpen = false
  addEventListener('pointerdown', (e) => (settingsWasOpen = Boolean(e.target.closest?.('[data-act=settings]') && settingsMenu?.el.isConnected)), true)
  function settings(btn) {
    if (settingsWasOpen) return (settingsWasOpen = false)
    const theme = state.theme ?? 'system'
    settingsMenu = popMenu(btn, [
      { head: 'Theme' },
      ...[['system', 'Match macOS'], ['light', 'Light'], ['dark', 'Dark']].map(([id, text]) => ({ label: text, act: `theme:${id}`, icon: id === theme ? ICONS.check : undefined })),
      '-',
      { label: 'Open config.json', icon: ICONS.braces, act: 'config', hint: 'in your editor' },
    ], (act) => (act === 'config' ? crew.call('config') : crew.call('theme', act.slice('theme:'.length))))
  }

  // an agent's clones, each a click from its terminal
  function cloneMenu(btn) {
    const a = state.agents.find((x) => x.name === btn.dataset.clones)
    if (!a) return
    popMenu(btn, [{ head: `${nameOf(a)}'s clones` }, ...clonesAt(a).map((c) => ({ label: `${displayName(c)}: ${doing(c)}`, icon: avatarHTML(c, { size: 16, mood: 'still' }), act: c.name }))], openAgent)
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.mode, .switch, .menu')) return
    const clones = e.target.closest('[data-clones]')
    if (clones) return cloneMenu(clones)
    const fold = e.target.closest('[data-fold]')
    if (fold) {
      toggle(fold.dataset.fold)
      return draw()
    }
    const away = e.target.closest('[data-away-ws]')
    if (away) return crew.call('workspace', 'switch', away.dataset.awayWs).then(() => crew.call('dashboard', away.dataset.awayAgent))
    const row = e.target.closest('[data-open]')
    if (row) return openAgent(row.dataset.open)
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'add') crew.call('dashboard', ':add')
    else if (act === 'settings') settings(e.target.closest('[data-act]'))
    else if (act) crew.call(act) // dashboard, quit
  })
  $('.autopilot .switch').addEventListener('change', (e) => crew.call('autopilot', e.target.checked))

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

  // The popover grows with the crew up to most of the screen, then the lists scroll inside it.
  function draw() {
    const ws = hasWorkspaces(state)
    $('header .brand').classList.toggle('hidden', ws)
    $('.ws-switch').classList.toggle('hidden', !ws)
    if (ws) {
      const away = elsewhere(state)
      morph($('.ws-switch'), `${wsTile(state.workspace, { size: 22 })}<b>${esc(state.workspace.name)}</b><span class="ws-chev">${ICONS.updown}</span>${away.waiting ? `<i class="ws-alert waiting">${away.waiting}</i>` : away.unread ? '<i class="ws-alert unread"></i>' : ''}`)
      $('.ws-switch').title = ['Switch workspaces', ...away.who.map((w) => `${w.name}: ${wsStatus(w)}`)].join('\n')
    }
    document.documentElement.style.setProperty('--max', `${Math.max(260, Math.min(620, screen.availHeight - 260))}px`)
    drawLists()
    const usage = Object.values(state.usage ?? {}).filter((u) => u.windows?.length)
    morph($('.usage'), usage.length ? `<div class="t-hr first"></div>${usage.map(usageRow).join('')}` : '')
    $('.autopilot .switch').checked = state.autopilot
    $('.autopilot').title = state.autopilot ? 'Autopilot is on: agents hand work to each other without asking you first' : 'Autopilot is off: each hand-off waits in the chat for your Send it'
    crew.fit(340, Math.ceil(document.body.getBoundingClientRect().height)) // rounded up, or the page scrolls by a fraction
  }

  live((next) => {
    state = next
    draw()
  })
})()

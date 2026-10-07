// The Bugs lane: what you call out while play-testing, as tickets on a board: New → Fixing → Check → Done.
// Report one in the bar at the top (or from the chat: the 🐞 chip, or start with "bug:"). Sending a bug to its
// owner starts a fresh conversation with just that bug in it, so fixes don't pile into one long context.
// Drag cards between lanes; open one to edit it, follow what happened, and say whether the fix works.
/* global crew, esc, avatarHTML, agentColor, statusText, mountAttach, morph, ago, md, snippet, nameHTML, ICONS, fileURL, bounce */

const LANES = [
  { status: 'new', title: 'New', empty: 'Nothing waiting. Report what broke in the bar above, or with 🐞 in the chat.' },
  { status: 'fixing', title: 'Fixing', empty: 'Send a bug to its owner: each one gets a conversation of its own.' },
  { status: 'check', title: 'Check', empty: 'Fixed bugs wait here for you to try them.' },
  { status: 'done', title: 'Done', empty: 'Bugs you checked end up here.' },
]
const STATUS_LABEL = { new: 'New', fixing: 'Fixing', check: 'Check', done: 'Done' }
const SEV = { blocker: 'Blocker', high: 'High', normal: 'Normal', low: 'Low' }
const SEV_RANK = { blocker: 0, high: 1, normal: 2, low: 3 }
const DONE_SHOWN = 25

function mountBugs(root, { onTerminal }) {
  root.innerHTML = `
    <section class="bugs-board">
      <header class="bugs-head">
        <div><h2>Bugs</h2><p class="bugs-sub"></p></div><span class="grow"></span>
        <label class="bugs-opt" title="An agent that turns what you type mid-game into a clear ticket (steps, severity, owner) and spots duplicates. Without one, bugs go to whoever's area they match.">
          <span class="opt-label">Triage</span><span class="triage-av"></span><select data-triage></select></label>
        <label class="bugs-opt" title="Auto-fix: a bug goes to its owner as soon as it has one, each in a fresh conversation. Off: you send them yourself.">
          <span class="opt-label">${ICONS.fresh}Auto-fix</span><input type="checkbox" class="switch sm" data-autofix></label>
      </header>
      <div class="capture">
        <div class="capture-box">
          <span class="capture-bug">${ICONS.bug}</span>
          <textarea rows="1" placeholder="What went wrong? Enter to report it, paste a screenshot too"></textarea>
          <button class="attach" title="Add a screenshot (or paste / drop one)">${ICONS.plus}</button>
          <button class="btn primary capture-go" disabled>Report</button>
        </div>
        <div class="thumbs capture-thumbs hidden"></div>
      </div>
      <div class="lanes">${LANES.map((l) => `
        <section class="lane" data-lane="${l.status}">
          <header class="lane-head"><i class="lane-dot"></i><b>${l.title}</b><span class="lane-count"></span><span class="grow"></span><span class="lane-act"></span></header>
          <div class="lane-list"></div>
        </section>`).join('')}
      </div>
      <div class="bugs-toast"></div>
    </section>
    <aside class="tp"></aside>`
  const $ = (s) => root.querySelector(s)
  const tp = $('.tp')
  const capture = $('.capture textarea')
  const go = $('.capture-go')
  let state = null
  let tickets = []
  let selected = null // the open ticket's key
  let panelFor = null // the ticket the panel was built for
  let shots = null // the open ticket's screenshot picker
  let broken = false // the "still broken" note is open
  let first = true
  let flash = null // a ticket just reported: it pops in
  let showAllDone = false

  const agent = (n) => state.agents.find((a) => a.name === n) ?? (n ? { name: n, seed: n.split('@')[0], on: false, status: 'off' } : null)
  const ticket = (key) => tickets.find((t) => t.key === key)
  const who = (n) => (n === 'you' ? 'You' : n === 'crew' ? 'Crew' : `@${esc(n)}`)
  const call = async (...args) => {
    try {
      return await crew.call('bug', ...args)
    } catch (e) {
      toast(e.message, true)
      throw e
    }
  }
  const toast = (text, error = false) => {
    const el = $('.bugs-toast')
    el.textContent = text
    el.className = `bugs-toast show ${error ? 'error' : ''}`
    clearTimeout(toast.timer)
    toast.timer = setTimeout(() => el.classList.remove('show'), error ? 5000 : 2800)
  }

  // ---- reporting -------------------------------------------------------------------------------

  const attach = mountAttach({
    zone: $('.capture-box'),
    field: capture,
    tray: $('.capture-thumbs'),
    button: $('.capture .attach'),
    onChange: () => sync(),
    onError: (msg) => toast(msg, true),
  })
  const sync = () => {
    capture.style.height = 'auto'
    capture.style.height = `${Math.min(capture.scrollHeight, 140)}px`
    go.disabled = !capture.value.trim() && !attach.get().length
  }
  async function report() {
    const text = capture.value.trim()
    const images = attach.get()
    if (!text && !images.length) return
    go.disabled = true
    try {
      const out = (await crew.call('bug', 'file', null, { text, images })).trim()
      flash = out.match(/#(\d+)/)?.[1] ?? null
      capture.value = ''
      attach.set([], false)
      toast(out.charAt(0).toUpperCase() + out.slice(1)) // a toast, so the board doesn't shift under you
    } catch (e) {
      toast(e.message, true)
    }
    sync()
  }
  capture.addEventListener('input', sync)
  capture.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      report()
    }
  })
  go.addEventListener('click', report)

  $('.bugs-head').addEventListener('change', (e) => {
    if ('triage' in e.target.dataset) crew.call('bugSettings', { triage: e.target.value || null })
    if ('autofix' in e.target.dataset) crew.call('bugSettings', { autofix: e.target.checked })
  })

  // ---- the board -------------------------------------------------------------------------------

  // New: worst first, then most reported, then oldest. The rest: most recently moved first.
  const order = {
    new: (x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity] || y.seen - x.seen || x.created - y.created,
    fixing: (x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity] || x.updated - y.updated,
    check: (x, y) => y.updated - x.updated,
    done: (x, y) => y.updated - x.updated,
  }

  // What the fixer is up to with this bug: on it, starting its fresh conversation, or still finishing something else.
  function fixerState(t, fixer) {
    if (!fixer || !fixer.on) return { cls: 'off', text: fixer?.status === 'away' ? 'unreachable' : 'off' }
    if (String(fixer.ticket) === t.key) {
      if (fixer.status === 'working') return { cls: 'working', text: `on it · ${ago(fixer.since)}` }
      if (fixer.status === 'waiting') return { cls: 'waiting', text: 'needs you' }
      if (fixer.status === 'starting') return { cls: 'starting', text: 'fresh start…' }
      return { cls: 'idle', text: 'done? waiting on its word' }
    }
    if (fixer.status === 'starting') return { cls: 'starting', text: 'fresh start…' }
    return { cls: 'queued', text: fixer.status === 'working' ? 'up next' : 'queued' }
  }

  function footHTML(t) {
    const owner = agent(t.owner)
    const fixer = agent(t.fixer)
    const face = (a, { live = false, name = true } = {}) => `<span class="tk-who" data-agent="${esc(a.name)}" title="@${esc(a.name)}">${avatarHTML(a, { size: 22, mood: live ? undefined : 'still' })}${name ? `<span>${nameHTML(a)}</span>` : ''}</span>`
    if (t.status === 'new') {
      const triage = state.bugs.triage
      if (!t.owner && triage && !t.triaged && t.by === 'you') return `<span class="tk-who">${avatarHTML(agent(triage), { size: 22 })}<span class="shimmer">@${esc(triage)} is triaging…</span></span>`
      if (!owner) return '<span class="tk-who nobody"><i>?</i>Unassigned</span><span class="grow"></span><button class="tk-btn" data-tk="open">Assign</button>'
      return `${face(owner)}<span class="grow"></span><button class="tk-btn go" data-tk="dispatch" title="Send it to @${esc(owner.name)} in a new conversation">${ICONS.fresh}Fix</button>`
    }
    if (t.status === 'fixing') {
      const s = fixerState(t, fixer)
      return `${fixer ? face(fixer, { live: true, name: false }) : ''}<span class="tk-live ${s.cls}"><i class="dot ${s.cls === 'queued' ? 'idle' : s.cls}"></i>${esc(s.text)}</span>`
    }
    if (t.status === 'check') {
      return `<div class="tk-verdict"><button class="tk-btn bad" data-tk="broken" title="Still broken: tell @${esc(t.fixer ?? 'the fixer')} what's wrong">Broken</button><button class="tk-btn good" data-tk="works" title="You tried it and it works">${ICONS.check}Works</button></div>`
    }
    return `<span class="tk-who done-mark">${ICONS.check}${t.dupOf ? `same as #${t.dupOf}` : 'works'}</span><span class="grow"></span><span class="tk-age">${esc(ago(t.updated))}</span>`
  }

  function cardHTML(t) {
    const owner = agent(t.fixer ?? t.owner)
    const sev = t.severity !== 'normal' ? `<span class="sev sev-${t.severity}">${SEV[t.severity]}</span>` : ''
    const seen = t.seen > 1 ? `<span class="seen" title="Reported ${t.seen} times">×${t.seen}</span>` : ''
    const home = t.home ? `<span class="tk-home" title="Filed on ${esc(t.homeName)}">${esc(t.homeName)}</span>` : ''
    const pics = t.images.length
      ? `<div class="tk-shots">${t.images.slice(0, 3).map((p) => `<img src="${fileURL(p)}" alt="" draggable="false">`).join('')}${t.images.length > 3 ? `<span>+${t.images.length - 3}</span>` : ''}</div>`
      : ''
    const fix = t.fix && (t.status === 'check' || t.status === 'done') ? `<p class="tk-fix">${esc(snippet(t.fix))}</p>` : ''
    return `<article class="tk st-${t.status} sev-${t.severity}${selected === t.key ? ' sel' : ''}" data-name="${esc(t.key)}" draggable="true" style="--c:${owner ? agentColor(owner) : 'var(--fg3)'}">
      <div class="tk-top"><span class="tk-id">#${t.id}</span>${sev}${seen}${home}<span class="grow"></span><span class="tk-age" title="Reported ${esc(new Date(t.created).toLocaleString())}">${esc(ago(t.created))}</span></div>
      <div class="tk-title">${esc(t.title)}</div>
      ${pics}${fix}
      <div class="tk-foot">${footHTML(t)}</div>
    </article>`
  }

  function drawBoard() {
    const by = Object.fromEntries(LANES.map((l) => [l.status, tickets.filter((t) => t.status === l.status).sort(order[l.status])]))
    // Cards slide to their new place (FLIP): remember where each one was before the board changes.
    const before = new Map([...root.querySelectorAll('.tk')].map((el) => [el.dataset.name, el.getBoundingClientRect()]))
    for (const l of LANES) {
      const lane = root.querySelector(`[data-lane=${l.status}]`)
      let list = by[l.status]
      const hidden = l.status === 'done' && !showAllDone ? Math.max(0, list.length - DONE_SHOWN) : 0
      if (hidden) list = list.slice(0, DONE_SHOWN)
      lane.querySelector('.lane-count').textContent = by[l.status].length || ''
      const ready = l.status === 'new' ? by.new.filter((t) => t.owner) : []
      morph(lane.querySelector('.lane-act'), ready.length > 1 ? `<button class="tk-btn go" data-tk="send-all" title="Send all ${ready.length} to their owners, each in a new conversation">${ICONS.fresh}Send all</button>` : '')
      morph(lane.querySelector('.lane-list'),
        (list.length ? list.map(cardHTML).join('') : `<p class="lane-empty">${l.empty}</p>`) +
        (hidden ? `<button class="lane-more" data-tk="more">Show ${hidden} more</button>` : ''))
    }
    for (const el of root.querySelectorAll('.tk')) {
      const was = before.get(el.dataset.name)
      if (!was) {
        if (!first && (flash === null || el.dataset.name === flash)) el.animate([{ opacity: 0, transform: 'translateY(-10px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.3, 1.5, .5, 1)' })
        continue
      }
      const now = el.getBoundingClientRect()
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.22, 1, .36, 1)' })
    }
    if (flash && root.querySelector(`.tk[data-name="${CSS.escape(flash)}"]`)) flash = null
    first = false
  }

  function drawHead() {
    const open = tickets.filter((t) => t.status !== 'done').length
    const check = tickets.filter((t) => t.status === 'check').length
    const blockers = tickets.filter((t) => t.status !== 'done' && t.severity === 'blocker').length
    morph($('.bugs-sub'), !tickets.length ? 'Play-testing? Report what breaks; each fix gets a fresh conversation.'
      : !open ? 'All clear ✨'
      : [`${open} open`, blockers && `<span class="sub-blocker">${blockers} blocker${blockers > 1 ? 's' : ''}</span>`, check && `<span class="sub-check">${check} to check</span>`].filter(Boolean).join(' · '))
    const sel = $('[data-triage]')
    const options = `<option value="">Nobody: route by area</option>${state.agents.filter((a) => !a.home).map((a) => `<option value="${esc(a.name)}">${esc(a.name)}${a.on ? '' : ' (off)'}</option>`).join('')}`
    if (sel.dataset.key !== options) (sel.innerHTML = options), (sel.dataset.key = options)
    sel.value = state.bugs.triage ?? ''
    const t = state.bugs.triage && agent(state.bugs.triage)
    morph($('.triage-av'), t ? avatarHTML(t, { size: 22, mood: 'still' }) : '')
    $('[data-autofix]').checked = state.bugs.autofix
  }

  // ---- dragging cards between lanes ------------------------------------------------------------

  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.tk')
    if (!card) return
    e.dataTransfer.setData('text/crew-ticket', card.dataset.name)
    e.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => card.classList.add('dragging'))
    root.classList.add('dragging-tk')
  })
  root.addEventListener('dragend', (e) => {
    e.target.closest?.('.tk')?.classList.remove('dragging')
    root.classList.remove('dragging-tk')
    root.querySelectorAll('.lane.over').forEach((l) => l.classList.remove('over'))
  })
  for (const lane of root.querySelectorAll('.lane')) {
    lane.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/crew-ticket')) return
      e.preventDefault()
      lane.classList.add('over')
    })
    lane.addEventListener('dragleave', (e) => lane.contains(e.relatedTarget) || lane.classList.remove('over'))
    lane.addEventListener('drop', async (e) => {
      const key = e.dataTransfer.getData('text/crew-ticket')
      lane.classList.remove('over')
      if (!key) return
      e.preventDefault()
      const t = ticket(key)
      const to = lane.dataset.lane
      if (!t || t.status === to) return
      if (to === 'fixing' && !(t.owner ?? null)) {
        toast(`Pick who fixes #${t.id} first`, true)
        return open(key)
      }
      await call('move', key, to).catch(() => {})
      if (to === 'fixing') toast(`#${t.id} went to @${t.owner}, in a new conversation`)
    })
  }

  // ---- clicks on the board ---------------------------------------------------------------------

  root.querySelector('.lanes').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tk]')
    const card = e.target.closest('.tk')
    const t = card && ticket(card.dataset.name)
    if (btn) {
      const op = btn.dataset.tk
      if (op === 'more') return (showAllDone = true), drawBoard()
      if (op === 'send-all') {
        const ready = tickets.filter((x) => x.status === 'new' && x.owner)
        for (const x of ready) await call('dispatch', x.key).catch(() => {})
        return toast(`Sent ${ready.length} bugs, each in its own conversation`)
      }
      if (op === 'open') return open(t.key)
      if (op === 'broken') return open(t.key, { broken: true })
      if (op === 'dispatch') {
        bounce(card.querySelector('.av'), 'pop')
        await call('dispatch', t.key).catch(() => {})
        return
      }
      if (op === 'works') {
        burst(btn)
        return call('works', t.key).catch(() => {})
      }
      return
    }
    if (e.target.closest('.tk-who[data-agent]') && t?.status === 'fixing') return onTerminal(e.target.closest('[data-agent]').dataset.agent)
    if (t) open(t.key)
  })

  // A little cheer when you confirm a fix.
  function burst(el) {
    const r = el.getBoundingClientRect()
    const b = document.createElement('div')
    b.className = 'burst'
    b.style.left = `${r.left + r.width / 2}px`
    b.style.top = `${r.top + r.height / 2}px`
    const colors = ['#34c759', '#0a84ff', '#ffcc00', '#ff6fb5', '#5ac8fa']
    b.innerHTML = Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2
      const d = 26 + Math.random() * 22
      return `<i style="--b:${colors[i % colors.length]};--x:${Math.cos(angle) * d}px;--y:${Math.sin(angle) * d}px;--r:${Math.random() * 360}deg"></i>`
    }).join('')
    document.body.append(b)
    setTimeout(() => b.remove(), 900)
  }

  // ---- the ticket panel ------------------------------------------------------------------------

  function open(key, { broken: wantBroken = false } = {}) {
    selected = key
    broken = wantBroken
    drawPanel()
    drawBoard()
    if (wantBroken) setTimeout(() => tp.querySelector('[data-broken-note]')?.focus({ preventScroll: true }), 320)
  }

  function close() {
    selected = null
    panelFor = null
    broken = false
    tp.classList.remove('open')
    root.classList.remove('panel-open')
    drawBoard()
  }

  function ownersHTML(t) {
    const list = state.agents.filter((a) => a.on || a.name === t.owner)
    return list.map((a) => `<button class="own ${t.owner === a.name ? 'on' : ''}" data-owner="${esc(a.name)}" style="--c:${agentColor(a)}" title="${esc(a.area || '')}">${avatarHTML(a, { size: 22, mood: 'still' })}${nameHTML(a)}</button>`).join('') +
      `<button class="own nobody ${t.owner ? '' : 'on'}" data-owner="" title="Nobody yet">Nobody</button>`
  }

  function logHTML(t) {
    return t.log.map((l) => {
      const a = l.by === 'you' || l.by === 'crew' ? null : agent(l.by)
      return `<li class="${l.kind === 'note' ? 'note' : ''}">
        <span class="lg-face">${a ? avatarHTML(a, { size: 22, mood: 'still' }) : `<i class="lg-you">${l.by === 'crew' ? '✦' : 'you'}</i>`}</span>
        <div class="lg-body"><span class="lg-who">${who(l.by)}</span> ${l.kind === 'note' ? `<div class="lg-note">${md(l.text)}</div>` : esc(l.text)}<time title="${esc(new Date(l.ts).toLocaleString())}">${esc(ago(l.ts))}</time></div>
      </li>`
    }).join('')
  }

  function footActions(t) {
    const owner = t.owner
    const dups = tickets.filter((x) => x.status !== 'done' && x.key !== t.key && x.home === t.home)
    const dupPick = dups.length ? `<select class="dup-pick" data-dup title="Same bug as another one: it counts there and this one closes"><option value="">Duplicate of…</option>${dups.map((x) => `<option value="${x.id}">#${x.id} ${esc(x.title.slice(0, 48))}</option>`).join('')}</select>` : ''
    switch (t.status) {
      case 'new':
        return `<button class="btn danger" data-tp="remove">Delete</button>${dupPick}<span class="grow"></span>
          <button class="btn primary" data-tp="dispatch" ${owner ? '' : 'disabled'} title="Starts a new conversation with just this bug in it">${ICONS.fresh}${owner ? `Send to @${esc(owner)}` : 'Pick an owner first'}</button>`
      case 'fixing':
        return `${t.fixer ? `<button class="btn" data-tp="terminal">Open @${esc(t.fixer)}'s terminal</button>` : ''}<span class="grow"></span><button class="btn" data-tp="fixed" title="Move it to Check yourself">Mark fixed</button>`
      case 'check':
        return `<button class="btn" data-tp="broken" aria-pressed="${broken}">Still broken…</button><span class="grow"></span><button class="btn primary good" data-tp="works">${ICONS.check}It works</button>`
      default:
        return `<button class="btn danger" data-tp="remove">Delete</button><span class="grow"></span><button class="btn" data-tp="reopen">Reopen</button>`
    }
  }

  function drawPanel() {
    const t = selected && ticket(selected)
    if (!t) {
      if (selected) close()
      return
    }
    root.classList.add('panel-open')
    // Built once per ticket (the screenshot picker and what you're typing live in it), then patched.
    if (panelFor !== t.key) {
      panelFor = t.key
      tp.innerHTML = `
        <header class="tp-head"></header>
        <div class="tp-body">
          <textarea class="tp-title" rows="1" data-field="title" spellcheck="false"></textarea>
          <div class="tp-meta"></div>
          <div class="tp-field"><span class="tp-label">Severity</span><div class="sev-pick">${Object.entries(SEV).map(([k, v]) => `<button class="sevp sev-${k}" data-sev="${k}">${v}</button>`).join('')}</div></div>
          <div class="tp-field top"><span class="tp-label">Owner</span><div class="owner-pick"></div></div>
          <div class="tp-field col"><span class="tp-label">Details</span><textarea class="tp-details" data-field="body" rows="4" placeholder="Steps to reproduce, what you expected, what happened instead…"></textarea></div>
          <div class="tp-orig"></div>
          <div class="tp-field col"><span class="tp-label">Screenshots <button type="button" class="btn small" data-shot>+ Add</button></span><div class="thumbs tp-shots"></div></div>
          <div class="tp-fix"></div>
          <div class="tp-field col"><span class="tp-label">What happened</span><ol class="tp-log"></ol></div>
          <div class="tp-note"><textarea rows="1" data-note placeholder="Add a note for whoever fixes it…"></textarea><button class="btn" data-tp="note">Add</button></div>
        </div>
        <div class="tp-broken"><textarea rows="2" data-broken-note placeholder="What's still wrong? It goes back to the fixer, in the same conversation."></textarea><button class="btn primary" data-tp="send-back">Send back</button></div>
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
        fit(tp.querySelector('.tp-details'), 90)
        tp.querySelector('.tp-body').scrollTop = 0
      })
    }
    morph(tp.querySelector('.tp-head'), `<span class="tp-bug sev-${t.severity}">${ICONS.bug}</span><span class="tk-id">#${t.id}</span><span class="tp-status st-${t.status}">${STATUS_LABEL[t.status]}</span>${t.home ? `<span class="tk-home">${esc(t.homeName)}</span>` : ''}<span class="grow"></span><button class="icon" data-tp="close" title="Close (Esc)">${ICONS.close}</button>`)
    morph(tp.querySelector('.tp-meta'), `Reported by ${who(t.by).replace('You', 'you')} · ${esc(ago(t.created))}${ago(t.created) === 'just now' ? '' : ' ago'}${t.seen > 1 ? ` · <b>seen ${t.seen}×</b>` : ''}${t.dupOf ? ` · same as #${t.dupOf}` : ''}`)
    for (const b of tp.querySelectorAll('[data-sev]')) b.classList.toggle('on', b.dataset.sev === t.severity)
    morph(tp.querySelector('.owner-pick'), ownersHTML(t))
    // triage rewrote it: your own words stay visible (and the fixer gets them too)
    const reworded = t.report && t.report !== t.body && t.report !== t.title
    morph(tp.querySelector('.tp-orig'), reworded ? `<span class="tp-label">As you reported it</span><blockquote>${esc(t.report)}</blockquote>` : '')
    const fixer = agent(t.fixer)
    morph(tp.querySelector('.tp-fix'), t.fix ? `<div class="tp-fix-head">${fixer ? avatarHTML(fixer, { size: 24, mood: 'still' }) : ''}<b>${who(t.fixer)}</b>&nbsp;fixed it</div><div class="tp-fix-text bubble">${md(t.fix)}</div>` : '')
    morph(tp.querySelector('.tp-log'), logHTML(t))
    morph(tp.querySelector('.tp-foot'), footActions(t))
    tp.querySelector('.tp-broken').classList.toggle('open', broken && t.status === 'check')
    // Someone else changed it (an agent triaging): show it, unless you're typing there.
    for (const f of tp.querySelectorAll('[data-field]')) if (document.activeElement !== f && f.value !== (t[f.dataset.field] ?? '')) (f.value = t[f.dataset.field] ?? ''), fit(f, f.dataset.field === 'body' ? 90 : 0)
    if (tp.dataset.images !== JSON.stringify(t.images)) (shots.set(t.images, false), (tp.dataset.images = JSON.stringify(t.images)))
  }

  const fit = (el, min = 0) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(min, el.scrollHeight)}px`
  }

  tp.addEventListener('input', (e) => {
    if (e.target.matches('.tp-title')) fit(e.target)
    if (e.target.matches('.tp-details')) fit(e.target, 90)
    if (e.target.matches('[data-note], [data-broken-note]')) fit(e.target)
  })
  // Title and details save when you leave the field (Enter in the title too).
  tp.addEventListener('focusout', (e) => {
    const f = e.target.dataset?.field
    const t = ticket(panelFor)
    if (!f || !t || e.target.value.trim() === (t[f] ?? '')) return
    if (f === 'title' && !e.target.value.trim()) return void (e.target.value = t.title)
    call('edit', t.key, { [f]: e.target.value }).catch(() => {})
  })
  tp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.tp-title')) {
      e.preventDefault()
      e.target.blur()
    }
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('[data-note]')) {
      e.preventDefault()
      tp.querySelector('[data-tp=note]').click()
    }
    if (e.key === 'Enter' && (e.metaKey || !e.shiftKey) && e.target.matches('[data-broken-note]')) {
      e.preventDefault()
      tp.querySelector('[data-tp=send-back]').click()
    }
  })
  tp.addEventListener('change', async (e) => {
    const t = ticket(panelFor)
    if (!t || !('dup' in e.target.dataset) || !e.target.value) return
    if (!confirm(`Close #${t.id} as the same bug as #${e.target.value}? It counts as another report there.`)) return void (e.target.value = '')
    await call('dup', t.key, e.target.value).catch(() => {})
    close()
  })
  tp.addEventListener('click', async (e) => {
    const t = ticket(panelFor)
    if (!t) return
    const sev = e.target.closest('[data-sev]')?.dataset.sev
    if (sev && sev !== t.severity) return call('edit', t.key, { severity: sev }).catch(() => {})
    const own = e.target.closest('[data-owner]')
    if (own) {
      bounce(own.querySelector('.av'), 'pop')
      return own.dataset.owner !== (t.owner ?? '') && call('edit', t.key, { owner: own.dataset.owner }).catch(() => {})
    }
    const op = e.target.closest('[data-tp]')?.dataset.tp
    if (!op) return
    if (op === 'close') return close()
    if (op === 'note') {
      const box = tp.querySelector('[data-note]')
      if (!box.value.trim()) return box.focus()
      await call('note', t.key, box.value.trim()).catch(() => {})
      box.value = ''
      fit(box)
      return
    }
    if (op === 'dispatch') {
      await call('dispatch', t.key).catch(() => {})
      return toast(`#${t.id} went to @${t.owner}, in a new conversation`)
    }
    if (op === 'terminal') return onTerminal(t.fixer)
    if (op === 'fixed') return call('move', t.key, 'check').catch(() => {})
    if (op === 'works') {
      burst(e.target.closest('[data-tp]'))
      await call('works', t.key).catch(() => {})
      return setTimeout(close, 450)
    }
    if (op === 'broken') {
      broken = !broken
      drawPanel()
      if (broken) setTimeout(() => tp.querySelector('[data-broken-note]').focus({ preventScroll: true }), 200)
      return
    }
    if (op === 'send-back') {
      const box = tp.querySelector('[data-broken-note]')
      await call('broken', t.key, box.value.trim()).catch(() => {})
      box.value = ''
      broken = false
      toast(t.fixer ? `Sent #${t.id} back to @${t.fixer}` : `#${t.id} is open again`)
      return drawPanel()
    }
    if (op === 'reopen') return call('move', t.key, 'new').catch(() => {})
    if (op === 'remove' && confirm(`Delete #${t.id}? It's gone for good.`)) {
      await call('remove', t.key).catch(() => {})
      close()
    }
  })

  document.addEventListener('keydown', (e) => {
    if (!root.offsetParent) return
    if (e.key === 'Escape' && selected) return close()
    // "/" jumps to the report bar, like a search box
    if (e.key === '/' && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
      e.preventDefault()
      capture.focus()
    }
  })

  return {
    render(next) {
      state = next
      tickets = next.bugs?.tickets ?? []
      drawHead()
      drawBoard()
      if (selected) drawPanel()
    },
    open: (key) => (state ? open(String(key)) : setTimeout(() => open(String(key)), 300)),
    focus: () => capture.focus(),
    // what the titlebar's Bugs tab shows: bugs waiting on you first
    badge: (next) => {
      const list = next.bugs?.tickets ?? []
      const check = list.filter((t) => t.status === 'check').length
      return { check, open: list.filter((t) => t.status === 'new' || t.status === 'fixing').length }
    },
  }
}

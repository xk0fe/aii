// Scheduled messages (core/schedules.js): the clock beside Send (a few quick times, or your own), the Send later sheet
// (day, time, repeat), and the list of what's scheduled in this workspace, to pause, change, send now or delete.
// A classic script: its names are shared with every other file in ui/, so they all start with sched or SCHED.
/* global clique, ICONS, esc, morph, popMenu, segmented, notify, oops, errorLine, avatarHTML, agentColor, displayName, plural, snippet, systemAgentOf, isPicture */

const SCHED_REPEATS = [['once', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly']]
const schedPad = (n) => String(n).padStart(2, '0')
const schedDate = (d) => `${d.getFullYear()}-${schedPad(d.getMonth() + 1)}-${schedPad(d.getDate())}`
const schedAt = (date, time) => {
  const [y, mo, d] = String(date).split('-').map(Number)
  const [h, mi] = String(time).split(':').map(Number)
  return new Date(y, mo - 1, d, h, mi)
}
const schedClock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const schedDay = (d) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
// "today at 9:00", "tomorrow at 9:00", "Mon 23 Nov at 9:00"
function schedWhen(ms, now = Date.now()) {
  const d = new Date(ms)
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate())) / 86400000)
  return `${days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : schedDay(d)} at ${schedClock(d)}`
}
// A rule in words, as the list and the sheet say it.
function schedRule(s) {
  const at = schedAt(s.date, s.time)
  if (s.repeat === 'daily') return `Every day at ${schedClock(at)}`
  if (s.repeat === 'weekdays') return `Every weekday at ${schedClock(at)}`
  if (s.repeat === 'weekly') return `Every ${at.toLocaleDateString([], { weekday: 'long' })} at ${schedClock(at)}`
  return `Once, ${schedDay(at)} at ${schedClock(at)}`
}
// How its last run went: [words, whether it's something to look at]
function schedLast(s) {
  const l = s.last
  if (!l) return ['', false]
  const when = schedWhen(l.at)
  if (l.result === 'sent') return [`Last sent ${when}`, false]
  if (l.result === 'late') return [`Last sent ${when}, late`, false]
  if (l.result === 'busy') return ['Skipped last time: the run before was still going', false]
  if (l.result === 'unchanged') return ['Skipped last time: nothing had changed', false]
  if (l.result === 'missed') return [`Missed ${schedWhen(l.due)}: CLIque was closed, or this computer asleep`, true]
  return [`Didn't go out ${when}: ${l.why ?? 'something went wrong'}`, true]
}

function mountSchedules({ later, list, getState, push }) {
  let draft = null // what the Send later sheet is for: { id?, text, images, to, channel, repeat, date, time, ifChanged, clear?, ws }
  const agentsNow = () => (getState().agents ?? []).filter((a) => !a.cloneOf)
  const agentOf = (name) => agentsNow().find((a) => a.name === name) ?? { name }
  const channelOf = (id) => (getState().channels ?? []).find((c) => c.id === id)
  const schedules = () => getState().schedules?.list ?? []
  const names = (to) => (to ? String(to).split(',') : [])
  // who it goes to: who was picked, or else anyone @named in its words (as when you send it); nobody: Q, or Auto, picks
  const sentTo = (s) => {
    const picked = names(s.to)
    if (picked.length) return picked
    const said = new Set([...String(s.text ?? '').matchAll(/(^|[^\w.@/'-])@([\w-]+(?:@[\w-]+)?)/g)].map((m) => m[2].toLowerCase()))
    return agentsNow().filter((a) => said.has(a.name.toLowerCase())).map((a) => a.name)
  }
  // who gets it, in words: "Ada", "Ada and Milo", "whoever fits" (Q, or Auto, picks when it goes out)
  const whoText = (s) => {
    const to = sentTo(s).map((n) => displayName(agentOf(n)))
    const who = to.length ? (to.length > 2 ? `${to.slice(0, -1).join(', ')} and ${to.at(-1)}` : to.join(' and ')) : systemAgentOf(getState().agents) ? displayName(systemAgentOf(getState().agents)) : 'whoever fits'
    const c = s.channel && s.channel !== 'general' && channelOf(s.channel)
    return `${who}${c ? ` in #${c.name}` : ''}`
  }
  const call = async (op, id, arg, ws = getState().workspace?.id) => {
    const out = await clique.call('schedule', op, id, arg, ws)
    push(out.state)
    return out
  }

  // ---- the clock beside Send: a few times worth one click, or your own -------------------------------------------

  const quickTimes = (now = new Date()) => {
    const nine = (plus) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + plus, 9, 0)
    const out = []
    if (now.getHours() < 8) out.push({ label: `Today at ${schedClock(nine(0))}`, repeat: 'once', at: nine(0) })
    out.push({ label: `Tomorrow at ${schedClock(nine(1))}`, repeat: 'once', at: nine(1) })
    const toMonday = ((8 - now.getDay()) % 7) || 7
    if (toMonday > 1) out.push({ label: `Monday at ${schedClock(nine(toMonday))}`, repeat: 'once', at: nine(toMonday) })
    out.push({ label: `Every weekday at ${schedClock(nine(1))}`, repeat: 'weekdays', at: nine(now.getHours() < 9 ? 0 : 1) })
    return out
  }

  function pick(button, held) {
    const n = schedules().length
    const quick = held.text || held.images.length ? quickTimes() : []
    popMenu(button, [
      ...(quick.length ? [{ head: 'Send later' }, ...quick.map((q, i) => ({ label: q.label, icon: ICONS[q.repeat === 'once' ? 'clock' : 'restart'], act: `quick:${i}` })), { label: 'Pick a time…', icon: ICONS.edit, act: 'custom' }, '-'] : [{ head: 'Write a message to send it later' }]),
      { label: 'Scheduled messages…', icon: ICONS.clock, act: 'list', hint: n ? String(n) : '' },
    ], async (act) => {
      if (act === 'list') return openList()
      if (act === 'custom') return openLater({ ...held, repeat: 'once', date: schedDate(quick[0].at), time: '09:00' })
      const q = quick[Number(act.slice(6))]
      try {
        const out = await call('add', null, { text: held.text, images: held.images, to: held.to, channel: held.channel, repeat: q.repeat, date: schedDate(q.at), time: '09:00' })
        if (out.same === 'paused') return notify('That one is scheduled already, but paused. Turn it on under Scheduled messages')
        held.clear()
        notify(out.same ? 'That one is scheduled already' : `Scheduled: ${q.repeat === 'once' ? schedWhen(q.at.getTime()) : q.label.toLowerCase()}`)
      } catch (err) {
        oops("Couldn't schedule that", err)
      }
    })
  }

  // ---- Send later: the message, the day and time, how it repeats --------------------------------------------------

  later.innerHTML = `
    <h2 class="sheet-title"><span class="h-icon">${ICONS.clock}</span><span data-lt-title>Send later</span></h2>
    <button type="button" class="icon sheet-x" data-close aria-label="Close">${ICONS.close}</button>
    <div class="sheet-body lt-body">
      <textarea class="field lt-text" data-lt-text rows="3" spellcheck="true" placeholder="What to send" aria-label="Message"></textarea>
      <p class="lt-to" data-lt-to></p>
      <div class="lt-when">
        <label><span class="section-label">Day</span><input type="date" class="field" data-lt-date required></label>
        <label><span class="section-label">Time</span><input type="time" class="field" data-lt-time required></label>
      </div>
      <h4 class="section-label">Repeat</h4>
      <div class="seg fill" data-lt-repeat role="radiogroup" aria-label="Repeat">${SCHED_REPEATS.map(([id, label]) => `<button type="button" role="radio" data-rp="${id}">${label}</button>`).join('')}</div>
      <p class="lt-sum" data-lt-sum></p>
      <label class="lt-changed" data-lt-changed title="Skips a run when the workspace's git repo is as the last run left it: the same commit, and the same changed files. Checked on this computer, without asking an agent."><input type="checkbox" data-lt-if><span>Only when the repo changed since its last run</span></label>
    </div>
    <p class="err" data-lt-err></p>
    <div class="sheet-foot">
      <span class="grow"></span>
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="button" class="btn primary" data-lt-go></button>
    </div>`
  const $l = (sel) => later.querySelector(sel)

  function drawLater() {
    segmented($l('[data-lt-repeat]'), (b) => b.dataset.rp === draft.repeat)
    for (const b of later.querySelectorAll('[data-rp]')) b.setAttribute('aria-checked', String(b.dataset.rp === draft.repeat))
    const at = draft.date && draft.time ? schedAt(draft.date, draft.time) : null
    const sum = $l('[data-lt-sum]')
    const first = at && `${schedDay(at)} at ${schedClock(at)}`
    const past = at && draft.repeat === 'once' && at.getTime() <= Date.now()
    sum.classList.toggle('bad', !at || past)
    sum.textContent = !at ? 'Pick a day and a time.'
      : past ? 'That time has passed already.'
      : draft.repeat === 'once' ? `Goes out once, ${first}.`
      : draft.repeat === 'daily' ? `Goes out every day at ${schedClock(at)}, from ${schedDay(at)}.`
      : draft.repeat === 'weekdays' ? `Goes out Monday to Friday at ${schedClock(at)}, from ${schedDay(at)}.`
      : `Goes out every ${at.toLocaleDateString([], { weekday: 'long' })} at ${schedClock(at)}, from ${schedDay(at)}.`
    // only where it can work: a repeat, in a workspace whose folder is a git repo. Its room stays, so nothing jumps
    const can = Boolean(getState().schedules?.repo)
    $l('[data-lt-changed]').classList.toggle('hidden', !can)
    $l('[data-lt-changed]').classList.toggle('unseen', draft.repeat === 'once')
    $l('[data-lt-if]').checked = Boolean(draft.ifChanged)
  }

  // what: what the composer holds (a new one), or a schedule from the list (to change)
  function openLater(what) {
    draft = { ws: getState().workspace?.id, images: [], ...what, ifChanged: Boolean(what.ifChanged) }
    $l('[data-lt-title]').textContent = draft.id ? 'Scheduled message' : 'Send later'
    $l('[data-lt-go]').textContent = draft.id ? 'Save' : 'Schedule'
    $l('[data-lt-text]').value = draft.text ?? ''
    $l('[data-lt-date]').value = draft.date
    $l('[data-lt-date]').min = schedDate(new Date())
    $l('[data-lt-time]').value = draft.time
    $l('[data-lt-err]').textContent = ''
    const pics = draft.images?.length ? ` · ${plural(draft.images.length, draft.images.every(isPicture) ? 'image' : 'attachment')}` : ''
    $l('[data-lt-to]').innerHTML = `To <b>${esc(whoText(draft))}</b>${sentTo(draft).length ? '' : '<span> · picked when it goes out</span>'}${pics}`
    drawLater()
    if (list.open) list.close()
    later.showModal()
    setTimeout(() => $l(draft.id || !draft.text ? '[data-lt-text]' : '[data-lt-time]').focus(), 60)
  }

  later.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === later) return later.close()
    const rp = e.target.closest('[data-rp]')
    if (rp) {
      draft.repeat = rp.dataset.rp
      return drawLater()
    }
    if (e.target.closest('[data-lt-go]')) saveLater()
  })
  later.addEventListener('input', (e) => {
    if (e.target.matches('[data-lt-date]')) draft.date = e.target.value
    if (e.target.matches('[data-lt-time]')) draft.time = e.target.value
    if (e.target.matches('[data-lt-if]')) draft.ifChanged = e.target.checked
    if (e.target.matches('[data-lt-text]')) draft.text = e.target.value
    else drawLater()
    $l('[data-lt-err]').textContent = ''
  })
  later.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), saveLater())
  })
  // (closed while the list was what led here: back to the list)
  let backToList = false
  later.addEventListener('close', () => {
    if (backToList) openList()
    backToList = false
  })

  async function saveLater() {
    const d = draft
    const fields = { text: String(d.text ?? '').trim(), repeat: d.repeat, date: d.date, time: d.time, ifChanged: d.repeat !== 'once' && Boolean(d.ifChanged) }
    if (!fields.text) return void ($l('[data-lt-err]').textContent = 'Write the message to send first.')
    if (!d.date || !d.time) return void ($l('[data-lt-err]').textContent = 'Pick a day and a time.')
    const go = $l('[data-lt-go]')
    go.disabled = true
    try {
      const out = d.id ? await call('edit', d.id, fields, d.ws) : await call('add', null, { ...fields, images: d.images, to: d.to, channel: d.channel }, d.ws)
      if (out.same === 'paused') return void ($l('[data-lt-err]').textContent = 'That one is scheduled already, but paused. Turn it on under Scheduled messages.')
      d.clear?.()
      later.close()
      if (!d.id) notify(out.same ? 'That one is scheduled already' : `Scheduled: ${schedRule(fields).replace(/^./, (c) => c.toLowerCase())}`)
    } catch (err) {
      $l('[data-lt-err]').textContent = errorLine(err)
    } finally {
      go.disabled = false
    }
  }

  // ---- Scheduled messages: what's set up in this workspace --------------------------------------------------------

  list.innerHTML = `
    <h2 class="sheet-title"><span class="h-icon">${ICONS.clock}</span>Scheduled messages</h2>
    <button type="button" class="icon sheet-x" data-close aria-label="Close">${ICONS.close}</button>
    <p class="lead" data-sc-lead></p>
    <div class="sheet-body sc-body"></div>
    <p class="err" data-sc-err></p>
    <div class="sheet-foot"><span class="sc-foot-note">Times are this computer's. They go out while CLIque is open.</span><span class="grow"></span><button type="button" class="btn" data-close autofocus>Done</button></div>`
  const $s = (sel) => list.querySelector(sel)

  const face = (s) => {
    const to = sentTo(s)
    if (!to.length) {
      const q = systemAgentOf(getState().agents)
      return q ? avatarHTML(q, { size: 28, mood: 'still' }) : `<span class="sc-auto">${ICONS.sparkles}</span>`
    }
    return avatarHTML(agentOf(to[0]), { size: 28, mood: 'still' }) + (to.length > 1 ? `<i class="sc-more">+${to.length - 1}</i>` : '')
  }
  const row = (s) => {
    const [last, bad] = schedLast(s)
    const state = s.paused ? 'Paused' : s.next ? `Next ${schedWhen(s.next)}` : s.last?.result === 'missed' ? '' : 'Not sent'
    const by = s.by && s.by !== 'you' ? `set up by ${displayName(agentOf(s.by))}` : ''
    return `<div class="sc-row${s.paused ? ' paused' : ''}" data-sc="${esc(s.id)}">
      <span class="sc-face">${face(s)}</span>
      <button type="button" class="sc-main" data-sc-edit title="Change it">
        <b>${esc(snippet(s.text) || s.text)}</b>
        <span class="sc-rule">${esc(schedRule(s))} · to ${esc(whoText(s))}${s.ifChanged ? ' · if the repo changed' : ''}</span>
        <span class="sc-state">${[state && esc(state), last && (bad ? `<i class="bad">${esc(last)}</i>` : esc(last)), by && esc(by)].filter(Boolean).join(' · ')}</span>
      </button>
      ${s.next || s.paused ? `<input type="checkbox" class="switch sm" data-sc-on ${s.paused ? '' : 'checked'} title="${s.paused ? 'Paused: turn on to run it again' : 'On: turn off to pause it'}" aria-label="On">` : '<button type="button" class="btn sm" data-sc-now>Send now</button>'}
      <button type="button" class="icon sc-menu" data-sc-menu aria-label="More" aria-haspopup="menu">${ICONS.more}</button>
    </div>`
  }

  let drawn = ''
  function drawList(force = false) {
    const all = schedules()
    const st = getState()
    const key = JSON.stringify([all, st.workspace?.id, st.workspace?.name, agentsNow().map((a) => [a.name, a.avatar]), new Date().toDateString()])
    if (!force && key === drawn) return
    drawn = key
    const q = systemAgentOf(st.agents)
    $s('[data-sc-lead]').textContent = all.length ? `What CLIque sends for you in ${st.workspace?.name ?? 'this workspace'}: each goes out as your message, to the agent or channel you picked.` : ''
    $s('[data-sc-lead]').classList.toggle('hidden', !all.length)
    morph($s('.sc-body'), all.length
      ? `<div class="group-list sc-list">${all.map(row).join('')}</div>`
      : `<div class="empty-state small sc-empty">${q ? avatarHTML(q, { size: 56, pose: 'mug' }) : ICONS.clock}<b>Nothing scheduled</b><span>Write a message, then press the clock beside Send to send it later, or every weekday at 9:00.${q ? ` Or say it to ${esc(displayName(q))}: “every weekday at 9, have someone check CI”.` : ''}</span></div>`)
    for (const sw of list.querySelectorAll('[data-sc-on]')) sw.checked = !all.find((s) => s.id === sw.closest('[data-sc]').dataset.sc)?.paused // a property morph leaves be
  }

  function openList() {
    $s('[data-sc-err]').textContent = ''
    drawList(true)
    if (!list.open) list.showModal()
  }

  const act = async (op, id, what) => {
    $s('[data-sc-err]').textContent = ''
    try {
      await call(op, id)
    } catch (err) {
      $s('[data-sc-err]').textContent = `${what}: ${errorLine(err)}`
      drawList(true)
    }
  }
  const edit = (s) => {
    backToList = true
    openLater({ id: s.id, text: s.text, to: s.to, channel: s.channel, images: s.images ?? [], repeat: s.repeat, date: s.repeat === 'once' || s.date > schedDate(new Date()) ? s.date : schedDate(s.next ? new Date(s.next) : new Date()), time: s.time, ifChanged: s.ifChanged })
  }
  list.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === list) return list.close()
    const id = e.target.closest('[data-sc]')?.dataset.sc
    const s = id && schedules().find((x) => x.id === id)
    if (!s) return
    if (e.target.closest('[data-sc-now]')) return act('now', id, "Couldn't send it")
    if (e.target.closest('[data-sc-edit]')) return edit(s)
    const menu = e.target.closest('[data-sc-menu]')
    if (!menu) return
    popMenu(menu, [
      { label: 'Change…', icon: ICONS.edit, act: 'edit' },
      { label: 'Send now', icon: ICONS.up, act: 'now', hint: s.next ? 'keeps its time' : '' },
      '-',
      { label: 'Delete…', icon: ICONS.trash, act: 'remove', danger: true },
    ], (picked) => {
      if (picked === 'edit') edit(s)
      if (picked === 'now') act('now', id, "Couldn't send it")
      if (picked === 'remove' && confirm(`Delete this scheduled message? It won't go out again.\n\n“${snippet(s.text) || s.text}”`)) act('remove', id, "Couldn't delete it")
    })
  })
  list.addEventListener('change', (e) => {
    const sw = e.target.closest('[data-sc-on]')
    if (sw) act(sw.checked ? 'resume' : 'pause', sw.closest('[data-sc]').dataset.sc, sw.checked ? "Couldn't turn it on" : "Couldn't pause it")
  })

  return {
    pick,
    openList,
    openLater,
    count: () => schedules().length,
    // a state push: the list follows what ran, was paused from a phone, or was set up by an agent
    render() {
      if (list.open) drawList()
    },
  }
}

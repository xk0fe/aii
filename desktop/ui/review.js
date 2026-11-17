// The Tasks review (ui/tasks.js opens it): what came back, one task at a time, with its receipts. For each task: who
// was on it (several agents can be), where its time went, what you asked for, what changed, how it was checked and what
// it took. Beside it, the tasks waiting for you and the ones that landed, and where the clique's time goes over all of
// them. These build the HTML; tasks.js owns the clicks and the keys, and tasktime.js works out where the time went.
/* global esc, md, openLink, avatarHTML, nameHTML, tokenCount, activityWords, tookText, TIME_PHASES, ICONS, KIND_ICON, KIND_LABEL, PRODUCT_NAME, keys */

const RV_LANDED = 12 // the landed tasks the review lists, and sums up
const RV_PHASE = Object.fromEntries(TIME_PHASES.map((p) => [p.id, p]))
const rvClock = (ts, far) => new Date(ts).toLocaleString([], far ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
const rvPlural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const rvKey = (k) => `<kbd class="rv-kbd">${k}</kbd>`

// What was asked and what came back are Markdown, and so can have links: a click on one opens it in your browser,
// not in the app's window. tasks.js asks this first about every click in the review. -> was it a link?
const rvLink = (e) => openLink(e)

// The whole task as one strip: each phase as wide as the time it took (a sliver stays visible).
function rvStrip(segments, cls = '') {
  const label = (s) => `${RV_PHASE[s.k].label} · ${tookText(s.ms)}`
  return `<div class="rv-strip ${cls}" role="img" aria-label="${esc(segments.map(label).join(', '))}">${segments.map((s) => `<i class="ph-${s.k}" style="flex-grow:${Math.max(1, Math.round(s.ms / 1000))}" title="${esc(label(s))}"></i>`).join('')}</div>`
}
// What the strip's shades stand for, with how long each took: only the phases there were.
const rvLegend = (phases) =>
  `<div class="rv-legend">${TIME_PHASES.filter((p) => phases[p.id] >= 1000).map((p) => `<span class="rv-key${p.you ? ' you' : ''}" title="${esc(p.hint)}"><i class="ph-${p.id}"></i>${p.label}<b>${tookText(phases[p.id])}</b></span>`).join('')}</div>`

// A step as you'd say it, and the command behind it: "Running the tests" (npm test -- cart).
function rvStepWords(text) {
  const helper = String(text).match(/^Agent · (.*)$/)
  if (helper) return { words: `A helper: ${helper[1]}`, raw: '' }
  const words = activityWords(text)
  const raw = String(text).replace(/^[\w-]+ · /, '')
  return { words, raw: raw && !words.includes(raw) ? raw : '' }
}

// Where the time went: the strip, a row per agent on the same scale, and the longest steps.
// x: taskTiming's answer for the task; agentOf(row, t): the agent to draw for a row (a clone as its original, numbered;
// known: the name is one the page has already, like the task's owner, not one from its time record).
function rvTimeHTML(t, x, agentOf) {
  if (!x) return `<section class="rv-sec rv-time"><h5 class="section-label">Where the time went</h5><p class="rv-none">No timing for this one: it was worked on before ${esc(PRODUCT_NAME)} kept track.</p></section>`
  const far = x.end - x.start > 20 * 3600000
  const waiting = t.status === 'check' && x.reportedAt ? x.end - x.reportedAt : 0
  const since = `${tookText(x.total)} since ${rvClock(x.start, true)}: it was added before ${PRODUCT_NAME} kept the time`
  const head = x.partial ? esc(since) : x.done ? `${tookText(x.total)} from added to accepted` : x.toReport != null ? `${tookText(x.toReport)} from added to reported${waiting >= 60000 ? ` · ${tookText(waiting)} waiting for you since` : ''}` : `${tookText(x.total)} so far`
  const at = (ts) => `${(((ts - x.start) / x.total) * 100).toFixed(3)}%`
  const role = { did: t.kind === 'bug' ? 'fixed it' : 'did it', helped: 'helped', triaged: 'triaged it' }
  const lanes = x.agents.map((row) => {
    const a = agentOf(row, t)
    const mine = [row.work >= 1000 && tookText(row.work), !row.work && row.triage >= 1000 && tookText(row.triage), row.you >= 1000 && `<span class="needs">${tookText(row.you)} on you</span>`, row.tokens > 0 && `${tokenCount(row.tokens)} tokens`].filter(Boolean)
    return `<div class="rv-lane">
      <span class="rv-lane-who">${avatarHTML(a, { size: 22, mood: 'still' })}<span class="rv-lane-name">${nameHTML(a)}</span><small>${row.clone ? 'a clone' : role[row.role]}</small></span>
      <span class="rv-track">${row.spans.map((s) => `<i class="ph-${s.k}${s.live ? ' live' : ''}" style="left:${at(s.at)};width:${((s.ms / x.total) * 100).toFixed(3)}%" title="${esc(`${RV_PHASE[s.k].label} · ${tookText(s.ms)}`)}"></i>`).join('')}</span>
      <span class="rv-lane-n">${mine.join(' · ')}</span>
    </div>`
  }).join('')
  // the long steps: what an agent ran, and the stretches it waited on you
  const waits = x.agents.flatMap((row) => row.spans.filter((s) => s.k === 'you').map((s) => ({ you: true, w: row.name, ms: s.ms, text: '' })))
  const steps = [...x.steps, ...waits].sort((p, q) => q.ms - p.ms).slice(0, 5)
  const row = (s) => {
    const who = x.agents.find((r) => r.name === s.w)
    const { words, raw } = s.you ? { words: 'Waiting on you: a question, or your OK', raw: '' } : rvStepWords(s.text)
    return `<li${s.you ? ' class="you"' : ''}><span class="rv-step-t" title="${esc(s.text)}">${esc(words)}${raw ? `<small>${esc(raw)}</small>` : ''}</span><span class="rv-step-w">${who ? nameHTML(agentOf(who, t)) : esc(s.w)}</span><b>${tookText(s.ms)}</b></li>`
  }
  return `<section class="rv-sec rv-time">
    <h5 class="section-label">Where the time went <small>${head}</small></h5>
    ${rvStrip(x.segments)}
    ${rvLegend(x.phases)}
    ${lanes ? `<div class="rv-lanes">${lanes}<div class="rv-axis"><span>${esc(rvClock(x.start, far))}</span><span>${esc(rvClock(x.end, far))}</span></div></div>` : ''}
    ${steps.length ? `<h6 class="rv-sub">The longest steps</h6><ol class="rv-steps">${steps.map(row).join('')}</ol>` : ''}
  </section>`
}

// Who was on it, in a line: "Milo did it, with Ada. June triaged it."
function rvWhoHTML(t, x, agentOf) {
  const bases = (role) => [...new Map((x?.agents ?? []).filter((r) => r.role === role).map((r) => [r.base, r])).values()]
  let [did, helped, triaged] = [bases('did'), bases('helped'), bases('triaged')]
  if (!did.length && (t.fixer ?? t.owner)) did = [{ name: t.fixer ?? t.owner, base: t.fixer ?? t.owner, clone: null, known: true }]
  const plain = (r) => agentOf({ ...r, name: r.base, clone: null }, t) // the agent itself, whichever of its clones it was
  const names = (rows) => rows.map((r) => `<b>${nameHTML(plain(r))}</b>`).join(rows.length > 2 ? ', ' : ' and ')
  const faces = [...did, ...helped, ...triaged].map((r) => avatarHTML(plain(r), { size: 28, mood: 'still' })).join('')
  const said = [
    did.length ? `${names(did)} ${t.kind === 'bug' ? 'fixed it' : 'did it'}${helped.length ? `, with ${names(helped)}` : ''}` : helped.length ? `${names(helped)} worked on it` : '',
    triaged.length ? `${names(triaged)} triaged it` : '',
  ].filter(Boolean)
  return said.length ? `<div class="rv-who"><span class="rv-faces">${faces}</span><span>${said.join('. ')}.</span></div>` : ''
}

// One task's receipt: who, where the time went, then what was asked beside what came back.
// at: { index, count } among the tasks to review (null for a landed one).
function rvReceiptHTML(t, x, { agentOf, at = null } = {}) {
  const reworded = t.report && t.report !== t.body && t.report !== t.title
  const doer = t.fixer ? agentOf({ name: t.fixer, base: t.fixer, clone: null, known: true }, t) : null
  const lines = t.spent?.added || t.spent?.removed ? `+${t.spent.added ?? 0} −${t.spent.removed ?? 0}` : ''
  const files = x?.files ?? []
  const checks = x?.checks ?? []
  const took = [
    t.spent?.tokens > 0 && `${tokenCount(t.spent.tokens)} tokens`,
    lines && `${lines} lines`,
    x?.helpers > 0 && rvPlural(x.helpers, 'helper'),
    x && (x.asks ? `asked you ${x.asks === 1 ? 'once' : `${x.asks} times`}` : 'no questions asked'),
    x?.rounds > 0 && `sent back ${x.rounds === 1 ? 'once' : `${x.rounds} times`}`,
  ].filter(Boolean)
  const state = t.status === 'check' ? `To review${at && at.count > 1 ? ` · ${at.index + 1} of ${at.count}` : ''}` : t.status === 'done' ? 'Landed' : 'Under way'
  return `<header class="rv-head">
      <div class="rv-crumb">${KIND_ICON[t.kind]}<span>${KIND_LABEL[t.kind]} · #${t.id}${t.home ? ` · on ${esc(t.homeName)}` : ''}</span><span class="rv-state st-${t.status}">${state}</span><span class="grow"></span><button class="btn sm" data-rv="details" title="Its description, notes and history">Details</button></div>
      <h2 class="rv-title">${esc(t.title)}</h2>
      ${rvWhoHTML(t, x, agentOf)}
    </header>
    ${rvTimeHTML(t, x, agentOf)}
    <div class="rv-cols">
      <div class="rv-stack">
        <section class="rv-sec"><h5 class="section-label">What you asked for</h5>
          <div class="bubble rv-md">${t.body ? md(t.body) : `<p>${esc(t.title)}</p>`}</div>
          ${reworded ? `<h6 class="rv-sub">As you wrote it</h6><blockquote class="tp-orig">${esc(t.report)}</blockquote>` : ''}</section>
        <section class="rv-sec"><h5 class="section-label">What ${doer ? nameHTML(doer) : 'came back'}${doer ? ' says' : ''}</h5>
          ${t.fix ? `<div class="bubble rv-md rv-say">${md(t.fix)}</div>` : '<p class="rv-none">Nothing was written about it.</p>'}</section>
      </div>
      <div class="rv-stack">
        <section class="rv-sec"><h5 class="section-label">What changed <small>${[files.length && rvPlural(files.length, 'file'), lines].filter(Boolean).join(' · ')}</small></h5>
          ${files.length ? `<div class="rv-files">${files.map((f) => `<div class="rv-file"><span title="${esc(f.file)}">${esc(f.file)}</span>${f.n > 1 ? `<small>${f.n} edits</small>` : ''}</div>`).join('')}</div>` : `<p class="rv-none">${lines ? 'The files it touched weren’t seen, only the line count.' : `${esc(PRODUCT_NAME)} saw no files change.`}</p>`}</section>
        <section class="rv-sec"><h5 class="section-label">How it was checked</h5>
          ${t.checked ? `<div class="bubble rv-md">${md(t.checked)}</div>` : ''}
          ${checks.length ? `<h6 class="rv-sub">${esc(PRODUCT_NAME)} saw it run</h6><ul class="rv-checks">${checks.map((c) => { const { words, raw } = rvStepWords(c.text); return `<li>${ICONS.check}<span title="${esc(c.text)}">${esc(words)}${raw ? `<small>${esc(raw)}</small>` : ''}</span><b>${tookText(c.ms)}</b></li>` }).join('')}</ul>` : ''}
          ${!t.checked && !checks.length ? '<p class="rv-none">Nothing says how it was checked, and no test or build was seen running.</p>' : ''}</section>
        ${took.length ? `<section class="rv-sec"><h5 class="section-label">What it took</h5><div class="rv-took">${took.map((w) => `<span>${w}</span>`).join('')}</div></section>` : ''}
      </div>
    </div>`
}

// Under the receipt: what's missing goes back with Send back; Accept lands it. A landed one can be reopened.
function rvBarHTML(t) {
  if (t.status === 'check') {
    return `<textarea class="field rv-note" rows="1" data-rv-note placeholder="What's ${t.kind === 'bug' ? 'still broken' : 'missing'}? It goes back to ${t.fixer ? `@${esc(t.fixer)}, in the same conversation` : 'To do'}."></textarea>
      <button class="btn lg" data-rv="send-back" title="Send it back with what you wrote (S)">Send back${rvKey('S')}</button>
      <button class="btn brand-btn lg" data-rv="accept" title="It's done (A)">${ICONS.check}Accept${rvKey('A')}</button>`
  }
  if (t.status === 'done') return `<span class="rv-landed">${ICONS.check}Landed ${esc(new Date(t.updated).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span><span class="grow"></span><button class="btn lg" data-rv="reopen">Reopen</button>`
  return '<span class="grow"></span>'
}

// Beside the receipt: the tasks to review, the ones that landed (each with what it took), and what they add up to.
// items: [{ t, x }], current: the open task's key, summary: timingSummary of the landed ones.
function rvListHTML({ review, landed, current, summary, agentOf, now = Date.now() }) {
  const row = ({ t, x }) => {
    const who = t.fixer ?? t.owner
    const others = x ? new Set(x.agents.map((r) => r.base)).size - 1 : 0
    const sub = [who && `${nameHTML(agentOf({ name: who, base: who, clone: null, known: true }, t))}${others > 0 ? ` +${others}` : ''}`, t.status === 'check' && x?.reportedAt ? `waiting ${tookText(now - x.reportedAt)}` : ''].filter(Boolean).join(' · ')
    const n = x && !x.partial ? tookText(t.status === 'check' ? (x.toReport ?? x.total) : x.total) : '' // (a part of it is no number to compare)
    return `<button class="rv-row${t.key === current ? ' on' : ''}" data-rv-open="${esc(t.key)}"${t.key === current ? ' aria-current="true"' : ''}>
      ${who ? avatarHTML(agentOf({ name: who, base: who, clone: null, known: true }, t), { size: 24, mood: 'still' }) : '<i class="tk-nobody">?</i>'}
      <span class="rv-row-t"><span class="rv-row-name">${esc(t.title)}</span><small>${sub}</small></span>
      <span class="rv-row-n" title="${t.status === 'check' ? 'From added to reported' : 'From added to accepted'}">${n}</span>
    </button>`
  }
  const sum = summary && `<div class="rv-sum">
      <h5 class="section-label">Where the time goes <small>${summary.n === 1 ? 'the last one landed' : `the last ${summary.n} landed`}</small></h5>
      ${rvStrip(TIME_PHASES.filter((p) => summary.phases[p.id] >= 1000).map((p) => ({ k: p.id, ms: summary.phases[p.id] })), 'sm')}
      <p><b>${tookText(summary.median)}</b> a task${summary.n > 2 ? ', in the middle' : ''}${summary.yours >= 0.005 ? ` · <span class="needs">${Math.round(summary.yours * 100)}% waited on you</span>` : ''}</p>
      <p class="rv-sum-top">Most of it: ${RV_PHASE[summary.top].label.toLowerCase()}, ${tookText(summary.phases[summary.top])}.</p>
    </div>`
  return `<div class="rv-group"><h5 class="section-label">To review${review.length ? `<span class="count-badge needs">${review.length}</span>` : ''}</h5>
      ${review.map(row).join('') || '<p class="rv-none">Nothing is waiting for you.</p>'}</div>
    ${landed.length ? `<div class="rv-group"><h5 class="section-label">Landed</h5>${landed.map(row).join('')}</div>` : ''}
    ${sum || ''}
    <div class="rv-keys"><span>${rvKey('J')}${rvKey('K')} next, previous</span><span>${rvKey('A')} accept</span><span>${rvKey('S')} send back</span><span>${rvKey('Esc')} the board</span></div>`
}

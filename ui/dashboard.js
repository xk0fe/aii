// Full-screen view: the crew collection, every agent's live terminal, and the crew feed.
/* global themeButton, crew, live, store, morph, agentCard, statusText, brainLabel, brainShort, crewSummary, segmented, celebrate, agentColor, markSVG, mountFeed, mountComposer, mountCollection, avatarHTML, esc, ICONS, Terminal, FitAddon */

const $ = (s) => document.querySelector(s)
const THEME = {
  background: '#0f1012', foreground: '#e4e4e7', cursor: '#e4e4e7', cursorAccent: '#0f1012', selectionBackground: 'rgba(122, 162, 255, 0.3)',
  black: '#1d1f21', red: '#ff6b6b', green: '#4cd38a', yellow: '#ffd166', blue: '#7aa2ff', magenta: '#c58cff', cyan: '#36cfc9', white: '#d4d4d8',
  brightBlack: '#5c5f66', brightRed: '#ff8787', brightGreen: '#69db9a', brightYellow: '#ffe08a', brightBlue: '#9bb8ff', brightMagenta: '#d6a8ff', brightCyan: '#5fe0da', brightWhite: '#fafafa',
}

const terms = new Map() // name -> { tile, head, term, fit, ready }
const feed = mountFeed($('.feed'), { onAgent: (name) => select(name) })
const composer = mountComposer($('.compose'), { dropZone: $('.chat') })
const collection = mountCollection($('.collection'), { onTerminal: (name) => select(name) })
let view = store.get('crew.view') || 'crew'
let selected = null
let state = { agents: [], providers: {} }

$('.titlebar .logo').outerHTML = markSVG('0 6 24 16')
$('.blank .blank-mark').outerHTML = ICONS.mark
$('.titlebar [data-act=add]').innerHTML = `${ICONS.plus}Agent`
$('.side .autopilot .glyph').innerHTML = ICONS.plane
$('[data-act=config]').innerHTML = ICONS.braces
$('#link .h-icon').innerHTML = ICONS.link
const drawTheme = themeButton($('[data-act=theme]'))

// ---- terminals -------------------------------------------------------------

function createTile(name) {
  const tile = document.createElement('div')
  tile.className = 'tile'
  tile.dataset.name = name
  tile.innerHTML = '<div class="tile-head"></div><div class="term"></div>'
  $('.terms').append(tile)

  const term = new Terminal({ theme: THEME, fontFamily: '"SF Mono", Menlo, monospace', fontSize: 12, lineHeight: 1.12, cursorBlink: true, macOptionIsMeta: true, scrollback: 5000 })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit)
  term.open(tile.querySelector('.term'))
  // Shift+Enter = newline in Claude Code, same as /terminal-setup configures.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || e.key !== 'Enter' || !e.shiftKey) return true
    crew.input(name, '\x1b\r')
    return false
  })
  term.onData((data) => crew.input(name, data))

  const t = { tile, head: tile.querySelector('.tile-head'), term, fit, ready: false }
  terms.set(name, t)
  let timer
  new ResizeObserver(() => {
    clearTimeout(timer)
    timer = setTimeout(() => resize(name), 40)
  }).observe(tile.querySelector('.term'))
  // Replay what the agent already printed at the size it was drawn, then fit (the agent redraws on resize).
  // Live chunks that arrive before this are already in the buffer.
  crew.call('buffer', name).then(({ data, cols, rows }) => {
    term.resize(cols, rows)
    term.write(data, () => {
      t.ready = true
      resize(name)
    })
  })
  return t
}

function resize(name) {
  const t = terms.get(name)
  if (!t || !t.tile.offsetWidth) return
  t.fit.fit()
  crew.call('resize', name, t.term.cols, t.term.rows)
}

crew.onPty((name, data) => {
  const t = terms.get(name)
  if (t?.ready) t.term.write(data)
})

function tileHead(a) {
  const busy = a.status === 'working' || a.status === 'waiting'
  return `${avatarHTML(a, { size: 26 })}<b>${esc(a.name)}</b><span class="model" title="${esc(brainLabel(a, state.providers))}">${esc(brainShort(a, state.providers))}</span>
    <span class="state ${a.status}" ${busy ? 'data-act="markIdle" title="Stuck? Click to mark it free"' : ''}>${esc(statusText(a))}</span>
    ${a.fast ? `<span class="tag fast-tag" title="Fast: Codex's fast service tier">${ICONS.bolt}</span>` : ''}
    ${a.yolo ? '<span class="tag yolo-tag" title="Skips all permission prompts">YOLO</span>' : ''}
    <span class="activity">${esc(a.activity)}</span>
    ${a.queue ? `<span class="tag">${a.queue} queued</span>` : ''}
    <button class="icon" data-act="edit" title="Edit agent">${ICONS.edit}</button>
    <button class="icon" data-act="restart" title="Restart (resumes the session)">${ICONS.restart}</button>
    <button class="icon" data-act="off" title="Turn off (stays off after restarts)">${ICONS.power}</button>`
}

$('.terms').addEventListener('click', (e) => {
  const tile = e.target.closest('.tile')
  if (!tile) return
  const name = tile.dataset.name
  const act = e.target.closest('[data-act]')?.dataset.act
  if (act === 'restart') {
    terms.get(name).term.reset()
    crew.call('restart', name)
  } else if (act === 'off') crew.call('update', name, { off: true })
  else if (act === 'markIdle') crew.call('markIdle', name)
  else if (act === 'edit') edit(name)
  else if (!act) highlight(name)
})
$('.terms').addEventListener('dblclick', (e) => {
  const head = e.target.closest('.tile-head')
  if (head && !e.target.closest('button')) {
    highlight(head.parentElement.dataset.name)
    setView(view === 'focus' ? 'grid' : 'focus')
  }
})

// ---- selection + views -----------------------------------------------------

function highlight(name) {
  selected = name
  for (const [n, t] of terms) t.tile.classList.toggle('on', n === name)
  for (const el of document.querySelectorAll('.side .agent')) el.classList.toggle('on', el.dataset.agent === name)
}

// Show an agent's terminal and aim the composer at it. Agents that are off have no terminal: open their card.
function select(name) {
  if (!terms.has(name)) return edit(name)
  highlight(name)
  composer.setTarget(name)
  setView('focus')
  terms.get(name).term.focus()
}

function edit(name) {
  setView('crew')
  collection.open(name)
}

function setView(next) {
  view = next
  store.set('crew.view', next)
  if (!terms.has(selected)) highlight(terms.keys().next().value)
  const crewView = view === 'crew'
  $('.collection').classList.toggle('hidden', !crewView)
  $('.terms').classList.toggle('hidden', crewView)
  $('.terms').classList.toggle('focus', view === 'focus')
  drawBlank()
  segmented($('.seg.views'), (b) => b.dataset.view === view)
  requestAnimationFrame(() => terms.forEach((_, name) => resize(name)))
}

function drawBlank() {
  const on = state.agents.filter((a) => a.on).length
  $('.blank').classList.toggle('hidden', view === 'crew' || on > 0)
  $('.blank b').textContent = state.agents.length ? 'All agents are off' : 'No agents yet'
  $('.blank span').textContent = state.agents.length ? 'Flip one on in the sidebar, it picks up its last session.' : 'Make your first one in the Crew view.'
}

$('.seg.views').addEventListener('click', (e) => e.target.dataset.view && setView(e.target.dataset.view))
// ⌘1 ⌘2 ⌘3: Crew, Grid, Focus
const VIEWS = ['crew', 'grid', 'focus']
document.querySelectorAll('.seg.views button').forEach((b, i) => (b.title += ` (⌘${i + 1})`))
document.addEventListener('keydown', (e) => {
  const n = Number(e.key)
  if (!e.metaKey || e.altKey || e.ctrlKey || !(n >= 1 && n <= 3)) return
  e.preventDefault()
  setView(VIEWS[n - 1])
})
$('.side .agents').addEventListener('click', (e) => {
  if (e.target.closest('.mode, .switch')) return
  const card = e.target.closest('.agent')
  if (card) (view === 'crew' ? edit : select)(card.dataset.agent)
})
$('.autopilot .switch').addEventListener('change', (e) => crew.call('autopilot', e.target.checked))
$('[data-act=config]').addEventListener('click', () => crew.call('config'))
for (const b of document.querySelectorAll('[data-act=add]')) b.addEventListener('click', addAgent)

function addAgent() {
  setView('crew')
  collection.create()
}

function handleFocus(arg) {
  if (arg === ':add') addAgent()
  else if (arg) select(arg)
}
crew.onFocus(handleFocus)

// ---- render ----------------------------------------------------------------

const ready = live((next) => {
  state = next
  drawTheme(state.theme)
  drawLink(state)
  // Terminals only for agents that are on; the sidebar lists everyone so off agents are one click from coming back.
  const on = state.agents.filter((a) => a.on)
  const names = new Set(on.map((a) => a.name))
  for (const [name, t] of terms) {
    if (names.has(name)) continue
    t.term.dispose()
    t.tile.remove()
    terms.delete(name)
  }
  for (const a of on) {
    const t = terms.get(a.name) ?? createTile(a.name)
    t.tile.style.setProperty('--c', agentColor(a))
    morph(t.head, tileHead(a))
  }

  morph($('.side .agents'), state.agents.map((a) => agentCard(a, state.providers)).join(''))
  $('.autopilot .switch').checked = state.autopilot
  $('.side-count').textContent = state.agents.length ? `${on.length} of ${state.agents.length} on` : ''
  morph($('.titlebar .sums'), crewSummary(state))
  highlight(terms.has(selected) ? selected : on[0]?.name)
  drawBlank()
  feed.render(state)
  composer.render(state)
  collection.render(state)
  celebrate($('.side .agents'), state.agents) // after the cards, so a visible card gets the confetti
})

// ---- Crew Link -------------------------------------------------------------------

const linkDialog = $('#link')
let linkKey = ''

function drawLink(state) {
  const l = state.link ?? { mode: 'local' }
  const chip = $('.link-chip')
  chip.classList.toggle('on', l.mode === 'remote' || l.sharing)
  chip.innerHTML =
    l.mode === 'remote'
      ? `<span class="dot ${l.connected ? 'working' : 'waiting'}"></span>${l.connected ? `on ${esc(l.name)}` : `Reconnecting to ${esc(l.name)}…`}`
      : l.sharing
        ? `<span class="dot working"></span>Sharing${l.clients ? ` · ${l.clients}` : ''}`
        : `${ICONS.link}Link`
  const next = JSON.stringify(l)
  if (next === linkKey) return
  linkKey = next
  const typed = linkDialog.querySelector('[data-link-code]')?.value ?? ''
  linkDialog.querySelector('.link-body').innerHTML = l.mode === 'remote' ? remoteHTML(l) : localHTML(l)
  const box = linkDialog.querySelector('[data-link-code]')
  if (box) box.value = typed
}

const localHTML = (l) => `
  <section class="ls">
    <label class="ls-row"><div><b>Share this crew</b><p>Let your other computers use the agents on this Mac.</p></div><input type="checkbox" class="switch" data-link-share ${l.sharing ? 'checked' : ''}></label>
    ${l.sharing ? `
      <div class="code-box"><code>${esc(l.code)}</code><button class="btn" data-link-copy>Copy</button></div>
      <p>On your other computer: <b>Crew Link → paste → Connect</b>. Anyone with this code can run your agents, so keep it to your own machines.</p>
      <div class="addr">${l.hosts.map((h) => `<span><b>${esc(h.address)}</b> ${esc(h.via)}</span>`).join('')}</div>
      <div class="ls-row small"><span>${l.clients ? `${l.clients} computer${l.clients > 1 ? 's' : ''} connected` : 'Nobody connected yet'} · port ${l.port}</span><button class="btn" data-link-reset title="Makes a new code; computers using the old one are disconnected">New code</button></div>`
    : l.error ? `<p class="err">${esc(l.error)}</p>` : ''}
  </section>
  <section class="ls">
    <b>Use a crew from another computer</b>
    <p>Paste the pairing code from the Mac that runs your agents. This Mac's own agents stop while you're connected, and come back when you disconnect.</p>
    <div class="code-in"><textarea data-link-code rows="2" placeholder="crew1.…" spellcheck="false"></textarea><button class="btn primary" data-link-connect>Connect</button></div>
    <p class="err" data-link-err></p>
  </section>`

const remoteHTML = (l) => `
  <section class="ls">
    <div class="remote-card"><span class="dot ${l.connected ? 'working' : 'waiting'}"></span><div><b>${l.connected ? 'Connected to' : 'Reconnecting to'} ${esc(l.name)}</b><p>${l.connected ? `via ${esc(l.address)}` : esc(l.error ?? 'trying…')}</p></div></div>
    <p>Agents, terminals and history live on ${esc(l.name)}; everything you do here happens there.</p>
    <div class="ls-row small"><span>Back to this Mac's own crew</span><button class="btn" data-link-disconnect>Disconnect</button></div>
  </section>`

$('.link-chip').addEventListener('click', () => linkDialog.showModal())
linkDialog.addEventListener('click', async (e) => {
  const t = e.target
  if (t.closest('[data-close]') || t === linkDialog) return linkDialog.close()
  const err = linkDialog.querySelector('[data-link-err]')
  try {
    if (t.closest('[data-link-copy]')) {
      await crew.call('copy', linkDialog.querySelector('.code-box code').textContent)
      t.closest('[data-link-copy]').textContent = 'Copied ✓'
    }
    if (t.closest('[data-link-reset]') && confirm('Make a new code? Computers using the current one are disconnected.')) await crew.call('link', 'reset')
    if (t.closest('[data-link-connect]')) {
      const code = linkDialog.querySelector('[data-link-code]').value.trim()
      if (!code) return void (err.textContent = 'Paste the code from the other Mac first')
      const running = state.agents.filter((a) => a.on).length
      if (running && !confirm(`Connect? The ${running} agent${running > 1 ? 's' : ''} running on this Mac stop until you disconnect, then pick up where they left off.`)) return
      await crew.call('link', 'connect', code) // Crew restarts connected
    }
    if (t.closest('[data-link-disconnect]') && confirm("Disconnect and go back to this Mac's own crew?")) await crew.call('link', 'disconnect')
  } catch (x) {
    if (err) err.textContent = x.message
    else alert(x.message)
  }
})
linkDialog.addEventListener('change', async (e) => {
  if (!('linkShare' in e.target.dataset)) return
  try {
    await crew.call('link', 'share', e.target.checked)
  } catch (x) {
    e.target.checked = false
    linkKey = ''
    alert(`Couldn't start sharing: ${x.message}`)
  }
})

ready.then(() => {
  setView(state.agents.length ? view : 'crew')
  handleFocus(new URLSearchParams(location.search).get('focus'))
})

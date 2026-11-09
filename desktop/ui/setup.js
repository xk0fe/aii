// The first run, the setup screen and Add provider…. A new install opens with the first run: a conversation with Q
// that makes its first workspace and crew (below). Whether Claude Code and Codex can run on this computer comes from
// state.setup (core/setup.js): with neither ready, the screen shows what to install or sign in to, with the command to
// paste and Check again; once one is, the crew invites you to make its first agent. "Claude Code and Codex…" in the ⋯
// menu shows the same screen any time. Add provider… (here, and in the model picker) adds GLM or Ollama, which the
// picker offers only once added (state.providers[id].added, core/providers.js).
/* global crew, esc, morph, avatarHTML, oops, errorLine, ON_WINDOWS, foldHTML, PRODUCT_NAME, store, ICONS, tildePath, pathParts */

let setupScreen = null // the dashboard's, once mounted: the model picker (ui/collection.js) opens Add provider… with it
function openAddProvider() {
  setupScreen?.addProvider()
}

// onMade(state): the first run made a workspace, so show it. onTour(): the first run ends with Q's tour (ui/tour.js).
function mountSetup({ onAdd = () => {}, onWorkspace = () => {}, onComputers = () => {}, onMade = () => {}, onTour = () => {} } = {}) {
  const view = Object.assign(document.createElement('section'), { className: 'setup-view', hidden: true })
  view.setAttribute('aria-label', 'Set up Claude Code and Codex')
  const sheet = Object.assign(document.createElement('dialog'), { className: 'sheet su-sheet' })
  document.body.append(view, sheet)

  let state = null
  let manual = false // opened from the ⋯ menu
  let shown = false // came up by itself (nothing can run here): it stays until you leave it, even once something's ready
  let dismissed = false // Not now: until the dashboard opens again
  let checking = false
  let copied = '' // the row whose command was just copied, which says Copied for a moment
  let copiedTimer = 0
  let checks = {} // Add provider…: what GLM and Ollama need, as last looked at
  let sheetError = ''

  // ---- the first run -------------------------------------------------------------------------------------------
  // A new install's first minutes, as a conversation with Q (core/system-agent.js), one scene at a time:
  //   title      the name folds together in the middle of the window, then rises to the top
  //   meet       "+ New agent", which makes Q: he pops out of it
  //   hello      who he is
  //   role       what he does, and what agents are
  //   cli        Claude Code or Codex, when neither is here yet (he thinks while the app looks)
  //   workspace  a workspace, made right in his card: its folder and its name
  //   crew       a first crew to pick, who pop up beside him; or your own, in the agent sheet
  //   ready      and the offer of his tour of the app (onTour, ui/tour.js)
  // Where it's got to is kept (crew.firstRun), so a quit picks up there. An install that already has a workspace never
  // sees it, and Skip leaves it for the screen below.
  const FIRST = ['title', 'meet', 'hello', 'role', 'cli', 'workspace', 'crew', 'ready']
  const KEY = 'crew.firstRun'
  const TITLE_MS = 3350 // the fold, then the name rising
  let fr = null // { step, pop, leaving, rise, timer, folder, name, made, picked, busy, error, found, linked }
  let toured = false
  const quiet = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase())
  const sayList = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

  // A first crew to start with. Each brings its job, and a look of its own.
  const PRESETS = [
    { name: 'Ada', job: 'Builds features and fixes bugs', area: 'Builder: features, fixes and refactors across the codebase', avatar: { body: 'blob', color: 'mint', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true } },
    { name: 'Theo', job: 'Tests and reviews changes', area: 'Tester and reviewer: writes and runs the tests, and reviews changes before they land', avatar: { body: 'frog', color: 'lime', eyes: 'googly', mouth: 'smile', hat: 'none', cheeks: false } },
    { name: 'Iris', job: 'Designs screens and styles', area: 'Designer: UI and UX, layouts, styles and the words on screen', avatar: { body: 'heart', color: 'lilac', eyes: 'happy', mouth: 'smile', hat: 'none', cheeks: true } },
    { name: 'June', job: 'Writes docs and copy', area: 'Writer: docs, release notes and copy', avatar: { body: 'bunny', color: 'peach', eyes: 'dot', mouth: 'smile', hat: 'none', cheeks: true } },
  ]
  const SLOTS = [-1, 1, -2, 2, -3, 3] // where the crew stands beside Q: left, right, further out

  // Whether this install has a first run to go through, and where it picks up.
  function firstRunFrom(next) {
    if (typeof foldHTML !== 'function' || typeof store === 'undefined') return // (the tests' stand-in page)
    const saved = store.get(KEY)
    if (saved === 'done' || saved === 'tour') return
    const at = FIRST.indexOf(saved)
    if (!next.workspace) {
      if (next.settingsBroken) return // not a new install: the screen says what's wrong
      fr = { step: at < 2 ? 'title' : at > 5 ? 'workspace' : saved }
    } else if (saved === 'crew' || saved === 'ready') fr = { step: saved, made: next.workspace.name }
    else if (saved) fr = { step: 'ready', linked: true } // its workspace came another way: a linked computer's
    else store.set(KEY, 'done') // an install from before the first run: it has a workspace already
    if (!fr) return
    fr.picked = new Set()
    if (fr.step === 'title') {
      if (quiet()) fr.step = 'meet'
      else fr.timer = setTimeout(() => fr?.step === 'title' && go('meet', {}, false), TITLE_MS)
    }
  }

  // On to the next scene: what Q said and showed blurs away, then the new one comes in.
  function go(step, extra = {}, fade = true) {
    if (!fr) return
    const swap = () => {
      if (!fr) return
      Object.assign(fr, { step, leaving: false, pop: false, error: '', busy: false }, extra)
      if (FIRST.indexOf(step) >= 2) store.set(KEY, step)
      draw()
    }
    if (!fade || quiet()) return swap()
    fr.leaving = true
    draw()
    setTimeout(swap, 170)
  }

  function finish(next) {
    store.set(KEY, next)
    clearTimeout(fr?.timer)
    fr = null
    draw() // the screen below, if there's still no workspace (Skip)
    if (next === 'tour') (toured = true), onTour()
  }

  // the title is skipped by the first click or key: pointerdown, so the click it starts lands on what's there after
  function skipTitle() {
    if (fr?.step !== 'title') return
    for (const a of view.getAnimations({ subtree: true })) if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish()
    clearTimeout(fr.timer)
    go('meet', {}, false)
  }

  const needsCli = () => !(status()?.checked && (status().ready || lent()))

  async function pickFolder() {
    const dir = await crew.call('pickFolder').catch(() => null)
    if (!dir || !fr) return
    fr.folder = dir
    if (!fr.name?.trim()) fr.name = cap((pathParts(dir).pop() ?? '').replace(/[-_]+/g, ' '))
    draw()
    view.querySelector('[data-fr-name]')?.focus({ preventScroll: true })
  }

  async function makeWorkspace() {
    if (!fr?.folder || fr.busy) return
    const name = (fr.name ?? '').trim() || 'My project'
    Object.assign(fr, { busy: true, error: '' })
    draw()
    try {
      // its agents start there: a folder that isn't there would only stop them
      const where = await crew.call('folderInfo', '', fr.folder)
      if (where && !where.exists) throw new Error(`There's no folder ${tildePath(where.path)}`)
      store.set(KEY, 'crew') // first: the state that brings the new workspace mustn't end the first run
      const { state: next } = await crew.call('workspace', 'create', null, { name, color: '', icon: '', folder: fr.folder, members: [], folders: {} })
      go('crew', { made: name })
      onMade(next)
    } catch (x) {
      store.set(KEY, 'workspace')
      if (fr) Object.assign(fr, { busy: false, error: errorLine(x) }), draw()
    }
  }

  // The picked ones join, on whichever of Claude Code and Codex is ready here.
  async function bringCrew() {
    if (!fr || fr.busy || !fr.picked.size) return
    Object.assign(fr, { busy: true, error: '' })
    draw()
    const provider = ready('claude') || !ready('codex') ? 'claude' : 'codex'
    try {
      for (const p of PRESETS.filter((x) => fr.picked.has(x.name))) {
        if (crewHere().some((a) => (a.seed ?? a.name) === p.name.toLowerCase())) continue // in already (a second try)
        await crew.call('addAgent', { name: p.name, area: p.area, provider, avatar: p.avatar, off: false })
      }
      go('ready')
    } catch (x) {
      if (fr) Object.assign(fr, { busy: false, error: errorLine(x) }), draw()
    }
  }

  const crewHere = () => (state?.agents ?? []).filter((a) => !a.system && !a.cloneOf)

  // What Q says in each scene, and what's under it: a card to fill in, or answers to pick.
  function scene(s) {
    const cli = status()
    if (s === 'hello') return { line: 'Hi, I’m Q, the queue in CLIque.', chips: [['hi', 'Hi, Q', true]] }
    if (s === 'role') return { line: 'I run your crew. Agents are your teammates, each a real Claude Code or Codex with a job of its own. Tell me what you need, and I’ll get it to the right one.', chips: [['role', 'Sounds good', true]] }
    if (s === 'cli') {
      if (!cli?.checked) return { line: '' } // he thinks while the app looks
      if (cli.ready || lent()) return { line: `Found ${sayList(cli.clis.filter((c) => c.state === 'ready').map((c) => c.name)) || 'what I need'}. That’s all I need.` }
      const signIn = cli.clis.some((c) => c.state === 'signin')
      return {
        line: signIn ? 'Almost there. Sign me in to Claude Code or Codex, and I’m ready.' : 'First I need Claude Code or Codex on this computer. Either one will do.',
        card: `<div class="group-list su-list">${cli.clis.map(cliRow).join('')}${cli.git ? gitRow(cli.git) : ''}</div>
          <div class="fr-acts"><button type="button" class="btn lg brand-btn" data-act="check" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check again'}</button></div>
          <p class="fr-alt">Want other models? <button type="button" class="su-link" data-act="providers">Add a provider…</button></p>`,
      }
    }
    if (s === 'workspace') {
      return {
        line: 'Now a workspace: the project we’ll work on, with its own folder, chat and tasks.',
        card: `<button type="button" class="fr-folder ${fr.folder ? 'set' : ''}" data-fr="pick">${ICONS.folder}<span>${fr.folder ? esc(tildePath(fr.folder)) : 'Choose its folder…'}</span>${fr.folder ? '<small>Change</small>' : ''}</button>
          ${fr.folder ? `<label class="fr-name"><span>Name</span><input class="field" data-fr-name value="${esc(fr.name ?? '')}" spellcheck="false" autocomplete="off"></label>` : ''}
          <p class="err fr-err">${esc(fr.error ?? '')}</p>
          <div class="fr-acts"><button type="button" class="btn lg brand-btn" data-fr="make" ${fr.folder && !fr.busy ? '' : 'disabled'}>${fr.busy ? 'Making it…' : 'Make the workspace'}</button></div>
          <p class="fr-alt">Already have a crew on another computer? <button type="button" class="su-link" data-act="computers">Link it</button></p>`,
      }
    }
    if (s === 'crew') {
      const own = crewHere().filter((a) => !PRESETS.some((p) => p.name.toLowerCase() === (a.seed ?? a.name)))
      const n = fr.picked.size
      const tile = (p) => {
        const on = fr.picked.has(p.name)
        return `<button type="button" class="fr-pick ${on ? 'on' : ''}" data-fr-pick="${p.name}" aria-pressed="${on}">${avatarHTML(p, { size: 44, mood: 'still' })}<span><b>${p.name}</b><small>${esc(p.job)}</small></span><i class="pick ${on ? 'on' : ''}">${ICONS.check}</i></button>`
      }
      return {
        line: `That’s ${fr.made ?? state?.workspace?.name ?? 'your workspace'}. Now, who should we bring in?`,
        card: `<p class="fr-hint">Pick a few to start. You can add more, or change them, any time.</p>
          <div class="fr-picks">${PRESETS.map(tile).join('')}</div>
          <p class="fr-alt">Someone else in mind? <button type="button" class="su-link" data-fr="own">Make your own…</button></p>
          <p class="err fr-err">${esc(fr.error ?? '')}</p>
          <div class="fr-acts"><button type="button" class="btn lg brand-btn" data-fr="bring" ${n && !fr.busy ? '' : 'disabled'}>${fr.busy ? 'Bringing them in…' : n === 1 ? `Bring in ${[...fr.picked][0]}` : n ? `Bring in all ${n}` : 'Pick someone'}</button><button type="button" class="btn lg" data-fr="alone" ${fr.busy ? 'disabled' : ''}>${own.length ? 'That’s everyone' : 'Just me for now'}</button></div>`,
      }
    }
    if (s === 'ready') {
      const names = crewHere().map((a) => cap(a.seed ?? a.name))
      const hi = fr.linked ? 'We’re linked, and the crew from that computer is here too.' : names.length ? `Welcome, ${sayList(names)}. That’s your crew, and I’ll run it.` : 'Just us for now, then. Bring agents in any time.'
      return { line: `${hi} Want me to show you around?`, chips: [['tour', 'Show me around', true], ['later', 'I’ll look around myself']] }
    }
    return { line: '' }
  }

  function drawFirstRun() {
    view.hidden = false
    view.classList.add('fr-on')
    const s = fr.step
    const at = FIRST.indexOf(s)
    // the scene changes once a check finds Claude Code or Codex: Q says so, then goes on by himself
    if (s === 'cli' && !needsCli() && !fr.found) (fr.found = true), setTimeout(() => fr?.step === 'cli' && go('workspace'), 1900)
    const { line, card, chips } = scene(s)
    // Q's line comes in a beat after he does (longer as he pops out); what's under it, once he's said it
    const sayAt = fr.pop ? 760 : 160
    const then = sayAt + (line ? line.split(' ').length : 0) * 48 + 320
    const real = crewHere()
    const mates = [
      ...PRESETS.map((p) => real.find((a) => (a.seed ?? a.name) === p.name.toLowerCase()) ?? (s === 'crew' && fr.picked.has(p.name) ? p : null)),
      ...real.filter((a) => !PRESETS.some((p) => p.name.toLowerCase() === (a.seed ?? a.name))),
    ].slice(0, SLOTS.length).map((a, i) => (a // (an empty slot keeps its place: picking or unpicking one doesn't move the rest)
      ? `<span class="fr-mate" data-name="mate-${esc(String(a.seed ?? a.name).toLowerCase())}" style="--x:${SLOTS[i]}">${avatarHTML({ ...a, status: 'idle', on: true }, { size: 84, mood: 'idle' })}</span>`
      : `<span class="fr-mate" data-name="slot-${i}" hidden></span>`))
    // the felt flecks Q pops out with: a ring of them, each its own colour
    const burst = fr.pop ? `<span class="fr-burst" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2
      const r = 78 + (i % 3) * 22
      return `<i style="--dx:${Math.round(Math.cos(a) * r)}px;--dy:${Math.round(Math.sin(a) * r * 0.8)}px;--c:${['#ff45a8', '#3db8ff', '#ffc61f', '#2fd3a6', '#72d63a', '#ff8a1f', '#8b5cf6'][i % 7]};--d:${(i % 4) * 25}ms"></i>`
    }).join('')}</span>` : ''
    const chipsHTML = chips ? `<div class="fr-chips" data-name="chips-${s}" style="--at:${then}ms">${chips.map(([act, label, brand]) => `<button type="button" class="btn lg ${brand ? 'brand-btn' : ''}" data-fr="${act}">${esc(label)}</button>`).join('')}</div>` : ''
    morph(view, `<div class="fr${fr.leaving ? ' leaving' : ''}" data-step="${s}">
      <div class="fr-mark ${s === 'title' ? 'title' : 'still'}" style="--rise:${fr.rise ?? 0}px">${foldHTML(60)}</div>
      <div class="fr-stage">
        <span class="su-glow sky"></span><span class="su-glow pink"></span><span class="su-glow lime"></span>
        <span class="su-floor${at < 2 ? ' later' : ''}"></span>
        ${s === 'meet' ? `<button type="button" class="fr-new" data-fr="new"><span class="fr-plus">${ICONS.plus}</span><span>New agent</span></button>` : ''}
        ${mates.join('')}
        ${at >= 2 ? `<span class="fr-q${fr.pop ? ' pop' : ''}" data-name="q-${fr.pop ? 'pop' : s}">${avatarHTML(Q, { size: 120, mood: 'idle' })}</span>` : ''}
        ${burst}
      </div>
      <div class="fr-talk">
        ${at >= 2 ? sayHTML(line, 'fr-say', sayAt) : '<p class="fr-say" data-name="" hidden></p>'}${at >= 2 && !line ? THINK : ''}
        ${card ? `<div class="fr-card" data-name="card-${s}" style="--at:${then}ms">${card}</div>` : ''}
        ${chipsHTML}
      </div>
      <button type="button" class="fr-skip" data-fr="skip">Skip</button>
    </div>`)
    // the name starts in the middle of the window and rises to where it's drawn: how far, measured once it's there
    if (s === 'title' && fr.rise === undefined) {
      const mark = view.querySelector('.fr-mark')
      const r = mark.getBoundingClientRect()
      fr.rise = Math.round(innerHeight / 2 - (r.top + r.height / 2))
      mark.style.setProperty('--rise', `${fr.rise}px`)
    }
  }

  function frClick(act, b) {
    if (act === 'new') return void (b.classList.add('pressed'), setTimeout(() => go('hello', { pop: true }, false), 150))
    if (act === 'hi') return go('role')
    if (act === 'role') return go(needsCli() ? 'cli' : 'workspace')
    if (act === 'pick') return void pickFolder()
    if (act === 'make') return void makeWorkspace()
    if (act === 'own') return onAdd() // the agent sheet, over this screen
    if (act === 'bring') return void bringCrew()
    if (act === 'alone') return go('ready')
    if (act === 'tour') return finish('tour')
    if (act === 'later' || act === 'skip') return finish('done')
  }

  // Q's line, word by word (setup.css .su-say/.fr-say). A new line is a new node (data-name), so it's said afresh and the
  // same line is left be; with nothing to say there's still a node in its place, since a morph matches children by place.
  const sayHTML = (line, cls, at = 0) => (line ? `<p class="${cls}" data-name="${esc(line)}" style="--at:${at}ms">${line.split(' ').map((x, i) => `<span style="--i:${i}">${esc(x)}</span>`).join(' ')}</p>` : `<p class="${cls}" data-name="" hidden></p>`)
  const THINK = '<span class="su-think" aria-hidden="true"><i style="--n:0"></i><i style="--n:1"></i><i style="--n:2"></i></span>'

  // The crew from the app's icon: Q in front (core/system-agent.js), the blue one and the green one behind him.
  const Q = { name: 'Q', avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true }, status: 'idle' }
  const BLUE = { name: 'Blue', avatar: { body: 'blob', color: 'sky', eyes: 'sparkle', mouth: 'none', hat: 'none', cheeks: true }, status: 'idle' }
  const GREEN = { name: 'Green', avatar: { body: 'blob', color: 'lime', eyes: 'happy', mouth: 'none', hat: 'none', cheeks: true }, status: 'idle' }

  const status = () => state?.setup
  const rowOf = (id) => status()?.clis?.find((c) => c.id === id)
  const ready = (id) => rowOf(id)?.state === 'ready'
  // Nothing can run an agent: neither CLI is ready here, and there's no linked computer to lend one (whose agents can
  // take a moment to show up as it connects).
  const lent = () => Boolean(state?.agents?.some((a) => a.home) || state?.computers?.links?.length)
  const stuck = () => Boolean(status()?.checked && !status().ready && !lent())
  const SHELL = ON_WINDOWS ? 'PowerShell' : 'Terminal'

  // ---- the screen ------------------------------------------------------------------------------------------------

  const STATE_WORDS = { ready: 'Ready', missing: 'Not installed', broken: 'Not working', signin: 'Sign in needed', update: 'Update needed' }
  const LINK_WORDS = { signin: 'Help with signing in', update: 'More about updates' }
  const BY = { claude: 'By Anthropic, with your Claude account', codex: 'By OpenAI, with your ChatGPT account' }

  function stepWords(c) {
    if (c.state === 'missing') return `Open ${SHELL} and paste this:`
    if (c.state === 'broken') return `It's here but doesn't start. Installing it again usually fixes that. Open ${SHELL} and paste this:`
    if (c.state === 'signin') return `Open ${SHELL}, paste this and follow the steps in your browser:`
    if (c.state === 'update') return `${PRODUCT_NAME} needs a newer ${c.name} on Windows. Open ${SHELL} and paste this:`
    return ''
  }

  function cliRow(c) {
    const how = c.how
    const step = how
      ? `<div class="su-how"><span class="su-step">${esc(stepWords(c))}</span>
          <div class="su-cmd"><code>${esc(how.command)}</code><button type="button" class="btn sm su-copy" data-copy="${esc(c.id)}">${copied === c.id ? 'Copied' : 'Copy'}</button></div>
          <button type="button" class="su-link" data-url="${esc(how.page)}">${LINK_WORDS[c.state] ?? 'Other ways to install'}</button></div>`
      : ''
    const tip = c.version ? `Version ${c.version}${c.needs ? `; ${PRODUCT_NAME} needs ${c.needs} or later` : ''}` : ''
    return `<div class="su-row" data-row="${esc(c.id)}">
      <div class="su-top"><span class="su-name">${esc(c.name)}</span><span class="su-state ${c.state === 'ready' ? 'ready' : 'needs'}" title="${esc(tip)}"><i></i>${STATE_WORDS[c.state] ?? ''}</span></div>
      <div class="su-by">${esc(BY[c.id] ?? '')}</div>${step}</div>`
  }

  function gitRow(g) {
    const here = g.state === 'ready'
    return `<div class="su-row" data-row="git">
      <div class="su-top"><span class="su-name">${esc(g.name)}</span><span class="su-state ${here ? 'ready' : 'quiet'}"><i></i>${here ? 'Ready' : 'Not installed'}</span></div>
      <div class="su-by">Recommended for Claude Code: it runs its commands in Git Bash, which comes with Git, and ${PRODUCT_NAME} can then stop anything those commands leave running. Without it, Claude Code uses PowerShell.</div>
      ${here ? '' : `<div class="su-how"><button type="button" class="btn su-get" data-url="${esc(g.how.page)}">Download Git for Windows</button></div>`}</div>`
  }

  // Until there's a workspace there's nothing else to show: this screen stays, and asks for the first.
  const noWorkspace = () => Boolean(state) && !state.workspace

  // What the screen says: nothing ready yet, ready with no workspace or no agents (make the first), or ready (opened from
  // the menu).
  function words() {
    if (noWorkspace() && state.settingsBroken) {
      return {
        say: 'Hmm.',
        title: `${PRODUCT_NAME} can’t read its settings`,
        lead: 'Something in config.json can’t be read right now. Nothing is written over it, and everything comes back as soon as it can be read again.',
        more: [],
      }
    }
    // no agents anywhere: none here, none of yours (the roster), none in another workspace
    const none = !state.agents?.some((a) => !a.system) && !state.roster?.length && !state.workspaces?.some((w) => w.agents > 0)
    if (!status()?.checked) return { say: 'One moment…', title: 'Looking for Claude Code and Codex', lead: '', primary: ['check', 'Checking…'], more: [['close', 'Close']] }
    // (Not now, with nothing else to show: on to the workspace, and it says what's missing when an agent starts)
    if (!status().ready && !(noWorkspace() && dismissed)) {
      const signIn = status().clis.some((c) => c.state === 'signin')
      return {
        say: signIn ? 'Almost there! Can you sign me in?' : 'Hi, I’m Q. I just need Claude Code or Codex.',
        title: 'Let’s get your crew ready',
        lead: 'Your crew works through Claude Code or Codex, with your own account. Set up either one, then check again.',
        primary: ['check', checking ? 'Checking…' : 'Check again'],
        more: [['close', 'Not now']],
      }
    }
    if (noWorkspace()) {
      return {
        say: 'Hi, I’m Q. What are we working on?',
        title: 'Make your first workspace',
        lead: 'A workspace is a project: its folder, the agents who work on it, and its own chat and tasks. Make one for each thing you work on.',
        primary: ['workspace', 'Create a workspace'],
        // a second computer: linked, the first one's workspaces show up here on their own
        more: [['computers', 'Link a computer']],
        bare: true,
      }
    }
    if (none) {
      return {
        say: 'Who should we bring in?',
        title: 'Let’s build your crew',
        lead: 'Each agent is a teammate with a job, a model and a creature of its own. Start with one; you can add more any time.',
        primary: ['add', 'Add your first agent'],
        more: [['check', checking ? 'Checking…' : 'Check again'], ['close', 'Not now']],
      }
    }
    return {
      say: 'We’re all set.',
      title: 'Claude Code and Codex',
      lead: 'What your crew runs on, on this computer.',
      primary: ['close', 'Done'],
      more: [['check', checking ? 'Checking…' : 'Check again']],
    }
  }

  function draw() {
    if (fr) return drawFirstRun()
    view.classList.remove('fr-on')
    const open = manual || (shown && !dismissed) || noWorkspace()
    view.hidden = !open
    if (!open) return
    const w = words()
    const s = status()?.checked ? status() : { clis: [], git: null }
    const off = (act) => act === 'check' && (checking || !status()?.checked)
    const btn = ([act, label], cls) => `<button type="button" class="btn lg ${cls}" data-act="${act}" ${off(act) ? 'disabled' : ''}>${esc(label)}</button>`
    // Q thinks (typing dots) while the app looks for Claude Code and Codex, then says his line, word by word: his
    // line's place comes first and the dots after it, so the dots going away don't start the line over (sayHTML)
    const line = status()?.checked ? w.say : ''
    const list = w.bare || !w.primary ? '' : `<div class="group-list su-list">${s.clis.map(cliRow).join('')}${s.git ? gitRow(s.git) : ''}</div>`
    // the empty-state column (common.css .empty-state): the stage for its art, the headline, one line, then the list
    morph(view, `<div class="empty-state su-col">
      <div class="su-stage">
        <span class="su-glow sky"></span><span class="su-glow pink"></span><span class="su-glow lime"></span>
        <span class="su-floor"></span>
        <span class="su-who blue">${avatarHTML(BLUE, { size: 100, mood: 'idle' })}</span>
        <span class="su-who green">${avatarHTML(GREEN, { size: 88, mood: 'idle' })}</span>
        <span class="su-who q">${avatarHTML(Q, { size: 128, mood: 'idle' })}</span>
        ${sayHTML(line, 'su-say')}${line ? '' : THINK}
      </div>
      <h1 class="display">${esc(w.title)}</h1>
      <p class="lead">${esc(w.lead)}</p>
      ${list}
      <div class="acts">${w.primary ? btn(w.primary, 'brand-btn su-primary') : ''}${w.more.map((b) => btn(b, '')).join('')}</div>
      ${w.bare || !w.primary ? '' : '<p class="su-more">Want other models? <button type="button" class="su-link" data-act="providers">Add a provider…</button></p>'}
    </div>`)
  }

  async function check() {
    if (checking) return
    checking = true
    draw()
    const started = Date.now()
    try {
      const next = await crew.call('setup', 'check')
      await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - started)))) // long enough to see it looked
      if (next) state = { ...state, setup: next }
    } catch (err) {
      oops('Couldn’t check Claude Code and Codex', err)
    }
    checking = false
    draw()
    if (sheet.open) await lookAtProviders()
  }

  function copy(id) {
    const c = rowOf(id)
    if (!c?.how?.command) return
    crew.call('copy', c.how.command).catch((err) => oops('Couldn’t copy that', err))
    copied = id
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => ((copied = ''), draw(), drawSheet()), 1600)
    draw()
  }

  function close() {
    manual = false
    dismissed = true
    shown = false
    draw()
  }

  view.addEventListener('pointerdown', skipTitle, true)
  addEventListener('keydown', () => !view.hidden && skipTitle(), true)
  view.addEventListener('input', (e) => {
    if (fr && e.target.matches('[data-fr-name]')) fr.name = e.target.value
  })
  view.addEventListener('keydown', (e) => {
    if (fr && e.key === 'Enter' && e.target.matches('[data-fr-name]')) (e.preventDefault(), makeWorkspace())
  })
  view.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (fr && b.dataset.fr) return frClick(b.dataset.fr, b)
    if (fr && b.dataset.frPick) {
      const name = b.dataset.frPick
      fr.picked[fr.picked.has(name) ? 'delete' : 'add'](name)
      return draw()
    }
    if (b.dataset.copy) return copy(b.dataset.copy)
    if (b.dataset.url) return void crew.call('openUrl', b.dataset.url).catch((err) => oops('Couldn’t open that page', err))
    const act = b.dataset.act
    if (act === 'check') check()
    if (act === 'close') close()
    if (act === 'providers') addProvider()
    if (act === 'workspace') onWorkspace()
    if (act === 'computers') onComputers()
    if (act === 'add') {
      close()
      onAdd()
    }
  })
  addEventListener('keydown', (e) => {
    // not one another layer took (the agent's sheet over this screen, a menu, a popover, a dialog); Tasks' filter menu waits hidden
    if (e.key !== 'Escape' || fr || e.defaultPrevented || view.hidden || document.querySelector('dialog[open], .ed-layer.open, .menu:not(.leaving, .hidden), [popover]:popover-open')) return
    close()
  })

  // ---- Add provider… ---------------------------------------------------------------------------------------------

  const PROVIDERS = [
    { id: 'glm', name: 'GLM', by: 'Z.ai’s models, through Claude Code', needs: 'Needs your Z.ai API key in your environment, as ZAI_API_KEY.', cli: 'claude' },
    { id: 'local', name: 'Ollama', by: 'Open models on this computer, through Codex', needs: 'Needs the Ollama app installed and running.', cli: 'codex' },
  ]

  function providerLines(p) {
    const c = checks[p.id]
    const lines = []
    if (c && p.id === 'glm') {
      lines.push(c.key ? [true, 'Your key is set.'] : [false, ON_WINDOWS ? `No key yet. Add ZAI_API_KEY to your environment variables in Windows settings, then quit ${PRODUCT_NAME} and open it again.` : 'No key yet. Add ZAI_API_KEY to your shell profile, then check again.'])
    }
    if (c && p.id === 'local') lines.push(c.running ? [true, 'Ollama is running.'] : [false, 'Ollama isn’t running. Open it, or get it first.', 'https://ollama.com/download', 'Get Ollama'])
    if (status()?.checked && !ready(p.cli)) lines.push([false, `It runs through ${p.cli === 'claude' ? 'Claude Code' : 'Codex'}, which isn’t ready on this computer yet.`])
    if (!c) lines.push([null, 'Checking…'])
    return lines
      .map(([ok, text, url, label]) => `<div class="su-check ${ok === true ? 'ok' : ok === false ? 'no' : ''}"><i></i><span>${esc(text)}${url ? ` <button type="button" class="su-link" data-url="${esc(url)}">${esc(label)}</button>` : ''}</span></div>`)
      .join('')
  }

  function drawSheet() {
    if (!sheet.open) return
    const providers = state?.providers ?? {}
    morph(sheet, `<h2 class="sheet-title">Add a provider</h2>
      <p class="lead">Claude Code and Codex are always in the model menu. These add other models, run through them.</p>
      <div class="sheet-body"><div class="group-list su-plist">${PROVIDERS.map((p) => {
        const { added, optional } = providers[p.id] ?? {}
        // one of your own in config.json's providers stays: only what Add put there can be removed
        const act = added
          ? `<span class="su-added">Added</span>${optional ? `<button type="button" class="btn" data-remove="${p.id}">Remove</button>` : ''}`
          : `<button type="button" class="btn" data-add="${p.id}">Add ${esc(p.name)}</button>`
        return `<div class="su-prow" data-provider="${p.id}">
          <div class="su-top"><span class="su-name">${esc(p.name)}</span><span class="su-pact">${act}</span></div>
          <div class="su-by">${esc(p.by)}</div><div class="su-step">${esc(p.needs)}</div>${providerLines(p)}</div>`
      }).join('')}</div></div>
      <p class="err su-err">${esc(sheetError)}</p>
      <div class="sheet-foot"><button type="button" class="btn" data-act="check" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check again'}</button><span class="grow"></span><button type="button" class="btn" data-act="done">Done</button></div>`)
  }

  async function lookAtProviders() {
    const found = await Promise.all(PROVIDERS.map((p) => crew.call('setup', 'provider', p.id).catch(() => null)))
    found.forEach((c, i) => (checks[PROVIDERS[i].id] = c ?? checks[PROVIDERS[i].id]))
    drawSheet()
  }

  function addProvider() {
    sheetError = ''
    if (!sheet.open) sheet.showModal()
    drawSheet()
    lookAtProviders()
  }

  sheet.addEventListener('click', async (e) => {
    if (e.target === sheet) return sheet.close()
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.url) return void crew.call('openUrl', b.dataset.url).catch((err) => oops('Couldn’t open that page', err))
    if (b.dataset.act === 'done') return sheet.close()
    if (b.dataset.act === 'check') return check()
    const [op, id] = b.dataset.add ? ['add', b.dataset.add] : b.dataset.remove ? ['remove', b.dataset.remove] : []
    if (!op) return
    sheetError = ''
    try {
      await crew.call('setup', op, id)
      // until the state that says so arrives
      state = { ...state, providers: { ...state.providers, [id]: { ...state.providers?.[id], added: op === 'add' } } }
    } catch (err) {
      sheetError = errorLine(err)
    }
    drawSheet()
  })

  setupScreen = {
    render(next) {
      state = next
      if (!fr) firstRunFrom(next)
      if (fr) {
        // its workspace came another way (a linked computer's) while it asked for one: on to the end
        if (next.workspace && !fr.linked && FIRST.indexOf(fr.step) < FIRST.indexOf('crew') && store.get(KEY) !== 'crew') (fr.linked = true), go('ready', { linked: true })
        draw()
        return drawSheet()
      }
      // a first run that ended with the tour, quit before it began: it begins now
      if (!toured && next.workspace && typeof store !== 'undefined' && store.get(KEY) === 'tour') (toured = true), setTimeout(onTour, 300)
      if ((stuck() && !dismissed && !shown) || (noWorkspace() && view.hidden)) {
        shown = stuck()
        const appears = view.hidden // (not already open from the ⋯ menu, where focus is wherever you left it)
        draw()
        if (appears) view.querySelector('.su-primary')?.focus({ preventScroll: true })
        return
      }
      draw()
      drawSheet()
    },
    // "Claude Code and Codex…" in the ⋯ menu
    open() {
      manual = true
      dismissed = false
      draw()
      view.querySelector('.su-primary')?.focus({ preventScroll: true })
    },
    addProvider,
    isOpen: () => !view.hidden,
    firstRun: () => Boolean(fr),
  }
  return setupScreen
}

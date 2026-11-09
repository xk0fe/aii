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

// onMade(state): the first run made a workspace, so show it. onLand(): the first run is over and its stage has been
// carried into the app. onTour(): a first run from before that ended with Q's tour (ui/tour.js).
function mountSetup({ onAdd = () => {}, onWorkspace = () => {}, onComputers = () => {}, onMade = () => {}, onTour = () => {}, onLand = () => {} } = {}) {
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
  // A new install's first minutes, led by Q (core/system-agent.js) on one stage, a scene at a time:
  //   title      the name folds together in the middle of the window, then rises to the top
  //   meet       "+ New agent", which makes Q: he pops out of it
  //   hello      "Hi, I'm Q."  and  role  "I run your clique.": two lines that move on by themselves (or at a click)
  //   work       what kind of work it is, which decides who he proposes (WORK)
  //   cli        Claude Code or Codex, when neither is here yet (he thinks while the app looks)
  //   workspace  where the work lives: its folder (chosen, or dropped on the window) and its name
  //   crew       a clique for that work, standing beside him, each one switched in or out with a click
  // Then the stage is carried into the app: everyone travels to their row in the sidebar (carry), and #general opens
  // on what to do first (ui/dashboard.js welcomeHTML). Where it's got to is kept (crew.firstRun), so a quit picks up
  // there. An install that already has a workspace never sees it, and Skip leaves it for the screen below.
  // Hovering the name, in any scene after the first, says what a clique is.
  const FIRST = ['title', 'meet', 'hello', 'role', 'work', 'cli', 'workspace', 'crew']
  const KEY = 'crew.firstRun'
  const TITLE_MS = 3350 // the fold, then the name rising
  const LINE_MS = { hello: 2300, role: 2500 } // how long each of his opening lines stays
  let fr = null // { step, pop, leaving, rise, timer, work, folder, name, made, out, busy, error, found }
  let toured = false
  const quiet = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase())
  const sayList = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
  const look = (body, color, eyes, cheeks = true) => ({ body, color, eyes, mouth: 'smile', hat: 'none', cheeks })

  // A clique to start with, for each kind of work: four agents with a job each (area is what the agent itself is
  // told), and three things to ask first (ui/dashboard.js offers them in an empty #general).
  const WORK = [
    { id: 'software', label: 'Software', for: 'software', crew: [
      { name: 'Ada', job: 'Builds and fixes', area: 'Builder: features, fixes and refactors across the codebase', avatar: look('blob', 'mint', 'sparkle') },
      { name: 'Theo', job: 'Tests and reviews', area: 'Tester and reviewer: writes and runs the tests, and reviews changes before they land', avatar: look('frog', 'lime', 'googly', false) },
      { name: 'Iris', job: 'Designs the screens', area: 'Designer: UI and UX, layouts, styles and the words on screen', avatar: look('heart', 'lilac', 'happy') },
      { name: 'June', job: 'Writes the docs', area: 'Writer: docs, release notes and copy', avatar: look('bunny', 'peach', 'dot') },
    ], starters: ['Look around this project and tell me what you see', 'Find something small to fix, and fix it', 'Write a README for this project'] },
    { id: 'design', label: 'Design', for: 'design', crew: [
      { name: 'Iris', job: 'Explores directions', area: 'Explorer: sketches several directions for a screen or a flow before one is chosen', avatar: look('heart', 'lilac', 'happy') },
      { name: 'Milo', job: 'Builds the screens', area: 'Maker: turns the chosen direction into finished screens, components and assets', avatar: look('cat', 'sky', 'sparkle') },
      { name: 'June', job: 'Writes the words', area: 'Writer: labels, messages and every word on screen', avatar: look('bunny', 'peach', 'dot') },
      { name: 'Theo', job: 'Checks every detail', area: 'Checker: contrast, spacing, consistency and whether everyone can use it', avatar: look('frog', 'lime', 'googly', false) },
    ], starters: ['Look at what’s in this folder and tell me what you see', 'Show me two better versions of one screen', 'Check everything here for consistency'] },
    { id: 'writing', label: 'Writing', for: 'writing', crew: [
      { name: 'Nora', job: 'Drafts', area: 'Drafter: writes first drafts from notes, outlines and what’s already in the folder', avatar: look('blob', 'mint', 'sparkle') },
      { name: 'Felix', job: 'Edits', area: 'Editor: tightens the writing, fixes structure and keeps one voice', avatar: look('frog', 'lime', 'googly', false) },
      { name: 'Maya', job: 'Checks the facts', area: 'Fact checker: verifies names, dates, numbers and quotes, and says what it could not confirm', avatar: look('heart', 'lilac', 'happy') },
      { name: 'Otis', job: 'Lays it out', area: 'Layout: formats the finished text, its headings, tables and files', avatar: look('bunny', 'peach', 'dot') },
    ], starters: ['Read the draft and tell me what’s missing', 'Tighten the first chapter', 'Check every name, date and number'] },
    { id: 'research', label: 'Research', for: 'research', crew: [
      { name: 'Vera', job: 'Finds the sources', area: 'Finder: looks for sources, data and prior work, and keeps where each came from', avatar: look('drop', 'sky', 'sparkle') },
      { name: 'Hugo', job: 'Reads and sums up', area: 'Reader: reads the sources closely and sums up what each one says', avatar: look('mochi', 'yellow', 'dot') },
      { name: 'Lena', job: 'Checks the numbers', area: 'Analyst: checks the numbers, runs the analysis and says how sure it is', avatar: look('cat', 'teal', 'happy') },
      { name: 'Emil', job: 'Writes it up', area: 'Writer: turns the findings into a clear report', avatar: look('bunny', 'peach', 'dot') },
    ], starters: ['What do we already know? Read this folder and tell me', 'Find the five best sources on this', 'What’s the weakest claim here?'] },
    { id: 'marketing', label: 'Marketing', for: 'marketing', crew: [
      { name: 'Zoe', job: 'Plans the launch', area: 'Planner: the audience, the message, the channels and the calendar', avatar: look('heart', 'red', 'sparkle') },
      { name: 'Remy', job: 'Writes the copy', area: 'Copywriter: headlines, posts, emails and landing pages', avatar: look('blob', 'orange', 'happy') },
      { name: 'Kai', job: 'Makes the visuals', area: 'Visuals: images, layouts and assets for each channel', avatar: look('cat', 'purple', 'sparkle') },
      { name: 'Bea', job: 'Tracks the results', area: 'Analyst: what to measure, the numbers and what they say to do next', avatar: look('mochi', 'yellow', 'dot') },
    ], starters: ['Draft a launch plan from what’s in this folder', 'Write three versions of the headline', 'Who is this for? Tell me what you’d guess'] },
    { id: 'other', label: 'Something else', for: '', crew: [
      { name: 'Sam', job: 'Does the work', area: 'Maker: does the main work that’s asked for', avatar: look('blob', 'mint', 'sparkle') },
      { name: 'Robin', job: 'Looks things up', area: 'Finder: looks things up, in the folder and beyond it', avatar: look('drop', 'sky', 'googly', false) },
      { name: 'Alex', job: 'Checks it', area: 'Checker: reviews the work and says what’s wrong with it', avatar: look('heart', 'lilac', 'happy') },
      { name: 'Jo', job: 'Writes it up', area: 'Writer: notes, summaries and the final write-up', avatar: look('bunny', 'peach', 'dot') },
    ], starters: ['Look around this folder and tell me what you see', 'What would you do first here?', 'Make a plan for this, and ask me what you need'] },
  ]
  const workOf = (id) => WORK.find((w) => w.id === id) ?? WORK[0]
  const ORDER = [2, 0, null, 1, 3] // who stands where: Q in the middle, the first two beside him, the others further out
  const COUNT = ['just Q', 'this one', 'these two', 'these three', 'these four']

  // Whether this install has a first run to go through, and where it picks up.
  function firstRunFrom(next) {
    if (typeof foldHTML !== 'function' || typeof store === 'undefined') return // (the tests' stand-in page)
    const saved = store.get(KEY)
    if (saved === 'done' || saved === 'tour') return
    if (saved === 'ready') return void store.set(KEY, 'done') // (an older first run's last scene)
    const at = FIRST.indexOf(saved)
    if (!next.workspace) {
      if (next.settingsBroken) return // not a new install: the screen says what's wrong
      // a quit before he'd asked anything opens it again; after the workspace scene there'd be a workspace
      fr = { step: at < 4 ? 'title' : at > 6 ? 'workspace' : saved }
    } else if (saved === 'crew') fr = { step: 'crew', made: next.workspace.name }
    else store.set(KEY, 'done') // an install from before the first run, or one whose workspace came from a linked computer
    if (!fr) return
    fr.work = store.get('crew.firstWork') || null
    fr.out = new Set()
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
      clearTimeout(fr.timer)
      Object.assign(fr, { step, leaving: false, pop: false, error: '', busy: false }, extra)
      if (FIRST.indexOf(step) >= 2) store.set(KEY, step)
      // his opening lines move on by themselves
      if (LINE_MS[step]) fr.timer = setTimeout(() => fr?.step === step && next(), LINE_MS[step] + (fr.pop ? 700 : 0))
      draw()
    }
    if (!fade || quiet()) return swap()
    fr.leaving = true
    draw()
    setTimeout(swap, 170)
  }
  // what follows his opening lines
  const next = () => (fr?.step === 'hello' ? go('role') : fr?.step === 'role' ? go('work') : undefined)

  function finish(how) {
    store.set(KEY, how === 'tour' ? 'tour' : 'done')
    clearTimeout(fr?.timer)
    const land = how === 'land' && state?.workspace
    if (land) store.set('crew.hints', 'on') // the app says what each new thing is, the first time it shows (dashboard.js)
    if (land) onLand() // the app is put on #general under the stage, before the stage is carried into it
    const after = () => {
      fr = null
      draw() // the screen below, if there's still no workspace (Skip)
      if (how === 'tour') (toured = true), onTour()
    }
    if (land) carry(after)
    else after()
  }

  // The stage is carried into the app: the screen fades, and everyone on it travels to their row in the sidebar.
  // Without motion, or with nowhere to go, it's simply put away.
  function carry(done) {
    const figs = typeof view.querySelectorAll === 'function' && !quiet() ? [...view.querySelectorAll('.fr-fig:not([hidden]):not(.out)')] : []
    const moves = figs.map((f) => {
      const av = f.querySelector('.av')
      const to = document.querySelector(`.side [data-agent="${CSS.escape(f.dataset.agent)}"] .dm-av`)
      const from = av?.getBoundingClientRect()
      const end = to?.getBoundingClientRect()
      return from?.width && end?.width ? { av, to, from, end, size: parseFloat(av.style.getPropertyValue('--size')) || from.width } : null
    }).filter(Boolean)
    if (!moves.length) return done()
    const layer = Object.assign(document.createElement('div'), { className: 'fr-carry' })
    for (const m of moves) {
      const el = Object.assign(document.createElement('span'), { className: 'fr-carried', innerHTML: m.av.outerHTML })
      el.style.transform = `translate(${m.from.left}px, ${m.from.top}px) scale(${m.from.width / m.size})`
      m.el = el
      m.to.style.visibility = 'hidden'
      m.av.style.visibility = 'hidden'
      layer.append(el)
    }
    document.body.append(layer)
    view.classList.add('fr-away')
    requestAnimationFrame(() => requestAnimationFrame(() => {
      moves.forEach((m, i) => {
        m.el.style.transitionDelay = `${i * 40}ms`
        m.el.style.transform = `translate(${m.end.left}px, ${m.end.top}px) scale(${m.end.width / m.size})`
      })
    }))
    setTimeout(() => {
      for (const m of moves) m.to.style.visibility = ''
      layer.remove()
      view.classList.remove('fr-away')
      done()
    }, 760 + moves.length * 40)
  }

  // the title is skipped, and his opening lines hurried, by a click or a key: pointerdown, so the click it starts lands
  // on what's there after
  function hurry(e) {
    if (!fr || e?.target?.closest?.('button, input, a')) return
    if (fr.step === 'title') {
      for (const a of view.getAnimations({ subtree: true })) if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish()
      clearTimeout(fr.timer)
      return go('meet', {}, false)
    }
    if (LINE_MS[fr.step] && !fr.leaving) next()
  }

  const needsCli = () => !(status()?.checked && (status().ready || lent()))

  function setFolder(dir) {
    if (!dir || !fr) return
    fr.folder = dir
    fr.error = ''
    if (!fr.name?.trim()) fr.name = cap((pathParts(dir).pop() ?? '').replace(/[-_]+/g, ' '))
    draw()
    view.querySelector('[data-fr-name]')?.focus({ preventScroll: true })
  }
  const pickFolder = async () => setFolder(await crew.call('pickFolder').catch(() => null))

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
      const { state: made } = await crew.call('workspace', 'create', null, { name, color: '', icon: '', folder: fr.folder, members: [], folders: {} })
      if (made?.workspace?.id) store.set(`crew.work.${made.workspace.id}`, workOf(fr.work).id) // what #general offers to ask first
      go('crew', { made: name })
      onMade(made)
    } catch (x) {
      store.set(KEY, 'workspace')
      if (fr) Object.assign(fr, { busy: false, error: errorLine(x) }), draw()
    }
  }

  const crewHere = () => (state?.agents ?? []).filter((a) => !a.system && !a.cloneOf)
  const joined = (p) => crewHere().find((a) => (a.seed ?? a.name) === p.name.toLowerCase())
  const picked = () => workOf(fr.work).crew.filter((p) => !fr.out.has(p.name))

  // The ones left standing join, on whichever of Claude Code and Codex is ready here; then the stage is carried into
  // the app.
  async function bringCrew() {
    if (!fr || fr.busy) return
    Object.assign(fr, { busy: true, error: '' })
    draw()
    const provider = ready('claude') || !ready('codex') ? 'claude' : 'codex'
    try {
      for (const p of picked()) {
        if (joined(p)) continue // in already (a second try)
        await crew.call('addAgent', { name: p.name, area: p.area, provider, avatar: p.avatar, off: false })
      }
      fr.bringing = true
      draw()
      setTimeout(() => fr && finish('land'), 420) // the rows they travel to are in the sidebar by then
    } catch (x) {
      if (fr) Object.assign(fr, { busy: false, error: errorLine(x) }), draw()
    }
  }

  // What Q says in each scene (*a word* is the one in the brand's colour), and what's under it.
  function scene(s) {
    const cli = status()
    if (s === 'hello') return { line: 'Hi, I’m *Q.*' }
    if (s === 'role') return { line: 'I run your *clique.*' }
    if (s === 'work') {
      return {
        line: 'What kind of *work* is it?',
        ctl: `<div class="fr-roles">${WORK.map((w) => `<button type="button" class="fr-role${fr.work === w.id ? ' on' : ''}${w.for ? '' : ' other'}" data-fr-work="${w.id}" aria-pressed="${fr.work === w.id}">${esc(w.label)}</button>`).join('')}</div>`,
      }
    }
    if (s === 'cli') {
      if (!cli?.checked) return { line: '' } // he thinks while the app looks
      if (cli.ready || lent()) return { line: `Found *${esc(sayList(cli.clis.filter((c) => c.state === 'ready').map((c) => c.name)) || 'what I need')}.*` }
      const signIn = cli.clis.some((c) => c.state === 'signin')
      return {
        line: signIn ? 'Almost there. *Sign me in.*' : 'First I need *Claude Code* or *Codex.*',
        ctl: `<div class="fr-card"><div class="group-list su-list">${cli.clis.map(cliRow).join('')}${cli.git ? gitRow(cli.git) : ''}</div>
          <div class="fr-acts"><button type="button" class="btn lg brand-btn fr-go" data-act="check" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check again'}</button></div>
          <p class="fr-alt">Want other models? <button type="button" class="su-link" data-act="providers">Add a provider…</button></p></div>`,
      }
    }
    if (s === 'workspace') {
      return {
        line: 'Where does it *live?*',
        ctl: `<div class="fr-card">
          <div class="fr-folder ${fr.folder ? 'set' : ''}">
            ${fr.folder
              ? `${ICONS.folder}<span class="fr-where"><input class="fr-name" data-fr-name value="${esc(fr.name ?? '')}" spellcheck="false" autocomplete="off" aria-label="The workspace's name"><small>${esc(tildePath(fr.folder))}</small></span><button type="button" class="su-link" data-fr="pick">Change</button>`
              : `<button type="button" class="fr-choose" data-fr="pick">${ICONS.folder}<span>Choose its folder, or drop it here</span></button>`}
          </div>
          <p class="err fr-err">${esc(fr.error ?? '')}</p>
          <div class="fr-acts"><button type="button" class="btn lg brand-btn fr-go" data-fr="make" ${fr.folder && !fr.busy ? '' : 'disabled'}>${fr.busy ? 'One moment…' : 'That’s the one'}</button></div>
          <p class="fr-alt">Already have a clique on another computer? <button type="button" class="su-link" data-act="computers">Link it</button></p></div>`,
      }
    }
    if (s === 'crew') {
      const w = workOf(fr.work)
      const n = picked().length + crewHere().filter((a) => !w.crew.some((p) => p.name.toLowerCase() === (a.seed ?? a.name))).length
      return {
        line: w.for ? `Here’s a clique for *${w.for}.*` : 'Here’s your *clique.*',
        ctl: `<div class="fr-card">
          <p class="err fr-err">${esc(fr.error ?? '')}</p>
          <div class="fr-acts"><button type="button" class="btn lg brand-btn fr-go" data-fr="bring" ${fr.busy ? 'disabled' : ''}>${fr.busy ? 'Bringing them in…' : `Start with ${COUNT[Math.min(n, 4)]}`}</button></div>
          <p class="fr-alt">Click anyone to leave them out, or <button type="button" class="su-link" data-fr="own">make your own…</button></p></div>`,
      }
    }
    return { line: '' }
  }

  // His line, large: each word comes into focus in turn, and the marked ones are in the brand's colour.
  function lineHTML(line, at = 0) {
    if (!line) return '<p class="fr-line" data-name="" hidden></p>'
    let i = 0
    const words = line.split(/(\*[^*]+\*)/).filter(Boolean).flatMap((part) => {
      const em = part.startsWith('*')
      return (em ? part.slice(1, -1) : part).split(' ').filter(Boolean).map((w) => `<span${em ? ' class="em"' : ''} style="--i:${i++}">${w}</span>`)
    })
    return `<p class="fr-line" data-name="${esc(line)}" style="--at:${at}ms">${words.join(' ')}</p>`
  }

  function drawFirstRun() {
    view.hidden = false
    view.classList.add('fr-on')
    const s = fr.step
    const at = FIRST.indexOf(s)
    // the scene changes once a check finds Claude Code or Codex: Q says so, then goes on by himself
    if (s === 'cli' && !needsCli() && !fr.found) (fr.found = true), setTimeout(() => fr?.step === 'cli' && go('workspace'), 1900)
    const { line, ctl } = scene(s)
    const sayAt = fr.pop ? 760 : 160 // his line comes in a beat after he does (longer as he pops out)
    const then = sayAt + (line ? line.split(' ').length : 0) * 70 + 260 // and what's under it, once he's said it
    // who stands beside him: the clique for this work in the last scene (and your own, made from there), each a
    // switch; an empty place keeps its slot, so a morph leaves the others be
    const w = workOf(fr.work)
    const own = crewHere().filter((a) => !w.crew.some((p) => p.name.toLowerCase() === (a.seed ?? a.name)))
    const fig = (p, i) => {
      if (!p || s !== 'crew') return `<span class="fr-fig" data-name="slot-${i}" hidden></span>`
      const off = fr.out.has(p.name) && !joined(p)
      return `<button type="button" class="fr-fig mate${off ? ' out' : ''}" data-name="mate-${esc(p.name.toLowerCase())}" data-agent="${esc(p.name.toLowerCase())}" data-fr-pick="${esc(p.name)}" aria-pressed="${!off}" style="--n:${i}" ${fr.busy ? 'disabled' : ''}>
        <span class="fr-av">${avatarHTML({ ...p, status: 'idle', on: true }, { size: 120, mood: 'idle' })}</span><span class="fr-who"><b>${esc(p.name)}</b><small>${esc(p.job)}</small></span></button>`
    }
    const mine = (a, i) => `<span class="fr-fig mate" data-name="mate-${esc(a.name)}" data-agent="${esc(a.name)}" style="--n:${i}"><span class="fr-av">${avatarHTML({ ...a, status: 'idle', on: true }, { size: 120, mood: 'idle' })}</span><span class="fr-who"><b>${esc(cap(a.seed ?? a.name))}</b><small>${esc(String(a.area ?? '').split(':')[0])}</small></span></span>`
    const q = at >= 2
      ? `<span class="fr-fig q${fr.pop ? ' pop' : ''}${s === 'crew' ? ' small' : ''}" data-name="q-${fr.pop ? 'pop' : 'in'}" data-agent="q"><span class="fr-av">${avatarHTML(Q, { size: 200, mood: 'idle' })}</span><span class="fr-who"><b>Q</b><small>Runs the clique</small></span></span>`
      : '<span class="fr-fig" data-name="q-none" hidden></span>'
    // the felt flecks Q pops out with: a ring of them, each its own colour
    const burst = fr.pop ? `<span class="fr-burst" aria-hidden="true">${Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2
      const r = 130 + (i % 3) * 34
      return `<i style="--dx:${Math.round(Math.cos(a) * r)}px;--dy:${Math.round(Math.sin(a) * r * 0.8)}px;--c:${['#ff45a8', '#3db8ff', '#ffc61f', '#2fd3a6', '#72d63a', '#ff8a1f', '#8b5cf6'][i % 7]};--d:${(i % 4) * 25}ms"></i>`
    }).join('')}</span>` : ''
    morph(view, `<div class="fr${fr.leaving ? ' leaving' : ''}" data-step="${s}">
      <div class="fr-mark ${s === 'title' ? 'title' : 'still'}" style="--rise:${fr.rise ?? 0}px" ${s === 'title' ? '' : 'tabindex="0"'}>${foldHTML(96)}
        <p class="fr-tip" role="tooltip"><b>clique</b><span>/kliːk/</span><i>n.</i>A tight group that sticks together. <em>Yours lives in a CLI.</em></p></div>
      <div class="fr-stage">
        <span class="su-glow sky"></span><span class="su-glow pink"></span><span class="su-glow lime"></span>
        <span class="su-floor${at < 2 ? ' later' : ''}"></span>
        ${s === 'meet' ? `<button type="button" class="fr-new" data-fr="new"><span class="fr-plus">${ICONS.plus}</span><span>New agent</span></button>` : '<span data-name="no-new" hidden></span>'}
        <div class="fr-row">${ORDER.map((k, i) => (k === null ? q : fig(w.crew[k], i))).join('')}${s === 'crew' ? own.slice(0, 2).map((a, i) => mine(a, 5 + i)).join('') : ''}</div>
        ${burst}
      </div>
      <div class="fr-talk">
        ${at >= 2 ? lineHTML(line, sayAt) : '<p class="fr-line" data-name="" hidden></p>'}${at >= 2 && !line ? THINK : ''}
        ${ctl ? `<div class="fr-ctl" data-name="ctl-${s}" style="--at:${then}ms">${ctl}</div>` : ''}
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
    if (act === 'pick') return void pickFolder()
    if (act === 'make') return void makeWorkspace()
    if (act === 'own') return onAdd() // the agent sheet, over this screen
    if (act === 'bring') return void bringCrew()
    if (act === 'skip') return finish('done')
  }
  // the kind of work: it's marked, then he moves on
  function pickWork(id) {
    if (!fr || fr.step !== 'work' || fr.leaving) return
    fr.work = workOf(id).id
    store.set('crew.firstWork', fr.work)
    draw()
    setTimeout(() => fr?.step === 'work' && go(needsCli() ? 'cli' : 'workspace'), quiet() ? 0 : 320)
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
        title: 'Let’s get your clique ready',
        lead: 'Your clique works through Claude Code or Codex, with your own account. Set up either one, then check again.',
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
        title: 'Let’s build your clique',
        lead: 'Each agent is a teammate with a job, a model and a creature of its own. Start with one; you can add more any time.',
        primary: ['add', 'Add your first agent'],
        more: [['check', checking ? 'Checking…' : 'Check again'], ['close', 'Not now']],
      }
    }
    return {
      say: 'We’re all set.',
      title: 'Claude Code and Codex',
      lead: 'What your clique runs on, on this computer.',
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

  view.addEventListener('pointerdown', hurry, true)
  addEventListener('keydown', (e) => !view.hidden && !e.metaKey && !e.ctrlKey && hurry(e), true)
  // its folder, dropped on the window
  view.addEventListener('dragover', (e) => fr?.step === 'workspace' && e.preventDefault())
  view.addEventListener('drop', async (e) => {
    if (fr?.step !== 'workspace') return
    e.preventDefault()
    const dir = crew.pathOf?.(e.dataTransfer?.files?.[0])
    const where = dir && (await crew.call('folderInfo', '', dir).catch(() => null))
    if (where?.exists) setFolder(where.path ?? dir)
    else if (fr) (fr.error = 'That isn’t a folder I can open'), draw()
  })
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
    if (fr && b.dataset.frWork) return pickWork(b.dataset.frWork)
    if (fr && b.dataset.frPick) {
      const name = b.dataset.frPick
      if (fr.busy) return
      fr.out[fr.out.has(name) ? 'delete' : 'add'](name)
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
        if (next.workspace && FIRST.indexOf(fr.step) < FIRST.indexOf('crew') && store.get(KEY) !== 'crew') return finish('land'), drawSheet()
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
    // what to ask first, for the kind of work a workspace was made for (the first run's choice)
    starters: (id) => (WORK.find((w) => w.id === id) ?? WORK.at(-1)).starters,
  }
  return setupScreen
}

// The first-run screen and Add provider…. Whether Claude Code and Codex can run on this computer comes from
// state.setup (core/setup.js): with neither ready, the dashboard shows what to install or sign in to, with the command
// to paste and Check again; once one is, the crew invites you to make its first agent. "Claude Code and Codex…" in the
// ⋯ menu shows the same screen any time. Add provider… (here, and in the model picker) adds GLM or Ollama, which the
// picker offers only once added (state.providers[id].added, core/providers.js).
/* global crew, esc, morph, avatarHTML, oops, errorLine, ON_WINDOWS, foldHTML, PRODUCT_NAME */

let setupScreen = null // the dashboard's, once mounted: the model picker (ui/collection.js) opens Add provider… with it
function openAddProvider() {
  setupScreen?.addProvider()
}

function mountSetup({ onAdd = () => {}, onWorkspace = () => {}, onComputers = () => {} } = {}) {
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

  // A first run (no workspace yet) opens like a short film (setup.css): the name folds together, the crew from the
  // app's icon pops up under it, the words come into focus, and Q says his first line. It plays once, and a click or a
  // key skips to its end. introAt: when it began. Each part's delay is fixed the first time it's drawn, since a redraw
  // that moved a running animation would make it jump; whatever's drawn after that (Q's next line, the list a check
  // brings) just comes in.
  const INTRO_MS = 4600
  let introAt = null
  let introOver = false
  let fontAsked = false
  const delays = new Map()
  const after = (key, ms) => {
    if (!delays.has(key)) delays.set(key, introAt === null ? 0 : Math.max(0, Math.round(ms - (performance.now() - introAt))))
    return delays.get(key)
  }
  function begin() {
    delays.clear()
    introAt = performance.now()
    introOver = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!introOver) setTimeout(() => ((introOver = true), draw()), INTRO_MS)
  }
  function skip() {
    if (introAt === null || introOver) return
    introOver = true
    introAt = -Infinity // anything drawn from now on comes in at once
    for (const a of view.getAnimations({ subtree: true })) if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish()
    draw()
  }

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
    const open = manual || (shown && !dismissed) || noWorkspace()
    view.hidden = !open
    if (!open) return
    const w = words()
    const s = status()?.checked ? status() : { clis: [], git: null }
    const off = (act) => act === 'check' && (checking || !status()?.checked)
    const btn = ([act, label], cls) => `<button type="button" class="btn lg ${cls}" data-act="${act}" ${off(act) ? 'disabled' : ''}>${esc(label)}</button>`
    // a first run opens with the name folding together (brand.js foldHTML), and the rest comes after it
    const named = noWorkspace() && !state.settingsBroken && typeof foldHTML === 'function'
    // (it starts once the brand face is in, so the fold and the rest keep time: a frame or so, hidden till then)
    if (named && introAt === null) {
      if (fontAsked || (document.fonts?.check?.('700 56px Fredoka') ?? true)) begin()
      else (fontAsked = true), document.fonts.load('700 56px Fredoka').then(draw, draw)
    }
    const intro = introAt !== null && !introOver
    const at = (key, ms) => `--at:${after(key, ms)}ms`
    // Q thinks (typing dots) while the app looks for Claude Code and Codex, then says his line, word by word. A new
    // line is a new bubble (data-name), so it's said afresh; the same line is left be. The line's bubble keeps its place
    // (empty while he thinks) and the dots come after it: a morph matches children by place, so the dots going away
    // mustn't move the line, which would start it over.
    const line = status()?.checked ? w.say : ''
    const sayAt = line ? after(`say:${line}`, 3400) : 0
    const said = line ? `<p class="su-say" data-name="${esc(line)}" style="--at:${sayAt}ms">${line.split(' ').map((x, i) => `<span style="--i:${i}">${esc(x)}</span>`).join(' ')}</p>` : '<p class="su-say" data-name="" hidden></p>'
    const think = !line || (intro && sayAt > 0) ? `<span class="su-think${line ? ' over' : ''}" style="${at('think', 2800)};--off:${Math.max(0, sayAt - 140)}ms" aria-hidden="true"><i style="--n:0"></i><i style="--n:1"></i><i style="--n:2"></i></span>` : ''
    const list = w.bare || !w.primary ? '' : `<div class="group-list su-list" style="${at('list', 2600)}">${s.clis.map(cliRow).join('')}${s.git ? gitRow(s.git) : ''}</div>`
    // the empty-state column (common.css .empty-state): the stage for its art, the headline, one line, then the list
    morph(view, `<div class="empty-state su-col${intro ? ' intro' : ''}${named && introAt === null ? ' waiting' : ''}">
      <div class="su-stage${named ? ' named' : ''}">
        <span class="su-glow sky" style="${at('glow-sky', 200)}"></span><span class="su-glow pink" style="${at('glow-pink', 0)}"></span><span class="su-glow lime" style="${at('glow-lime', 350)}"></span>
        ${named ? foldHTML(56) : ''}
        <span class="su-floor" style="${at('floor', 2100)}"></span>
        <span class="su-who blue" style="${at('blue', 2260)}">${avatarHTML(BLUE, { size: 100, mood: 'idle' })}</span>
        <span class="su-who green" style="${at('green', 2340)}">${avatarHTML(GREEN, { size: 88, mood: 'idle' })}</span>
        <span class="su-who q" style="${at('q', 2150)}">${avatarHTML(Q, { size: 128, mood: 'idle' })}</span>
        ${said}${think}
      </div>
      <h1 class="display" style="${at('h1', 2350)}">${esc(w.title)}</h1>
      <p class="lead" style="${at('lead', 2450)}">${esc(w.lead)}</p>
      ${list}
      <div class="acts" style="${at('acts', 2550)}">${w.primary ? btn(w.primary, 'brand-btn su-primary') : ''}${w.more.map((b) => btn(b, '')).join('')}</div>
      ${w.bare || !w.primary ? '' : `<p class="su-more" style="${at('more', 2650)}">Want other models? <button type="button" class="su-link" data-act="providers">Add a provider…</button></p>`}
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

  // the opening is skipped by the first click or key: pointerdown, so the click it starts lands on what's there after
  view.addEventListener('pointerdown', skip, true)
  addEventListener('keydown', () => !view.hidden && skip(), true)
  view.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
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
    if (e.key !== 'Escape' || e.defaultPrevented || view.hidden || document.querySelector('dialog[open], .ed-layer.open, .menu:not(.leaving, .hidden), [popover]:popover-open')) return
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
  }
  return setupScreen
}

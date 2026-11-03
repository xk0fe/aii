// The first-run screen and Add provider…. Whether Claude Code and Codex can run on this computer comes from
// state.setup (core/setup.js): with neither ready, the dashboard shows what to install or sign in to, with the command
// to paste and Check again; once one is, the crew invites you to make its first agent. "Claude Code and Codex…" in the
// ⋯ menu shows the same screen any time. Add provider… (here, and in the model picker) adds GLM or Ollama, which the
// picker offers only once added (state.providers[id].added, core/providers.js).
/* global crew, esc, morph, avatarHTML, oops, errorLine, ON_WINDOWS, roomFeltHTML, PRODUCT_NAME */

let setupScreen = null // the dashboard's, once mounted: the model picker (ui/collection.js) opens Add provider… with it
function openAddProvider() {
  setupScreen?.addProvider()
}

function mountSetup({ onAdd = () => {} } = {}) {
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
          <div class="su-cmd"><code>${esc(how.command)}</code><button type="button" class="btn su-copy" data-copy="${esc(c.id)}">${copied === c.id ? 'Copied' : 'Copy'}</button></div>
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

  // What the screen says: nothing ready yet, ready with no agents (make the first), or ready (opened from the menu).
  function words() {
    // no agents anywhere: none here, none of yours (the roster), none in another workspace
    const none = !state.agents?.length && !state.roster?.length && !state.workspaces?.some((w) => w.agents > 0)
    if (!status()?.checked) return { say: 'One moment…', title: 'Looking for Claude Code and Codex', lead: '', primary: ['check', 'Checking…'], more: [['close', 'Close']] }
    if (!status().ready) {
      const signIn = status().clis.some((c) => c.state === 'signin')
      return {
        say: signIn ? 'Almost there! Can you sign me in?' : 'Hi! I just need Claude Code or Codex.',
        title: 'Let’s get your crew ready',
        lead: 'Your crew works through Claude Code or Codex, with your own account. Set up either one, then check again.',
        primary: ['check', checking ? 'Checking…' : 'Check again'],
        more: [['close', 'Not now']],
      }
    }
    if (none) {
      return {
        say: 'Hi! Who should I be?',
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
    const open = manual || (shown && !dismissed)
    view.hidden = !open
    if (!open) return
    view.style.top = `${Math.round(document.querySelector('.titlebar')?.getBoundingClientRect().bottom ?? 46)}px`
    const w = words()
    const s = status()?.checked ? status() : { clis: [], git: null }
    const creature = { name: 'New', avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true }, status: 'starting' }
    const off = (act) => act === 'check' && (checking || !status()?.checked)
    const btn = ([act, label], cls) => `<button type="button" class="btn su-btn ${cls}" data-act="${act}" ${off(act) ? 'disabled' : ''}>${esc(label)}</button>`
    morph(view, `<div class="su-col">
      <div class="su-scene">${typeof roomFeltHTML === 'function' ? roomFeltHTML(52) : ''}<span class="su-spot" style="left:52px"></span><span class="su-spot" style="left:128px"></span><span class="su-spot" style="right:56px"></span>
        <span class="su-who">${avatarHTML(creature, { size: 96, mood: 'starting', pose: 'pop' })}</span><span class="su-say">${esc(w.say)}</span></div>
      <h1 class="su-title">${esc(w.title)}</h1>
      <p class="su-lead">${esc(w.lead)}</p>
      <div class="su-list">${s.clis.map(cliRow).join('')}${s.git ? gitRow(s.git) : ''}</div>
      <div class="su-acts">${btn(w.primary, 'su-primary')}${w.more.map((b) => btn(b, '')).join('')}</div>
      <p class="su-more">Want other models? <button type="button" class="su-link" data-act="providers">Add a provider…</button></p>
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

  view.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.copy) return copy(b.dataset.copy)
    if (b.dataset.url) return void crew.call('openUrl', b.dataset.url).catch((err) => oops('Couldn’t open that page', err))
    const act = b.dataset.act
    if (act === 'check') check()
    if (act === 'close') close()
    if (act === 'providers') addProvider()
    if (act === 'add') {
      close()
      onAdd()
    }
  })
  addEventListener('keydown', (e) => {
    // not one another layer took (the agent's sheet over this screen, a menu, a dialog)
    if (e.key !== 'Escape' || e.defaultPrevented || view.hidden || document.querySelector('dialog[open], .ed-layer.open, .menu:not(.leaving)')) return
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
    morph(sheet, `<h3>Add a provider</h3>
      <p class="lead">Claude Code and Codex are always in the model menu. These add other models, run through them.</p>
      <div class="sheet-body su-plist">${PROVIDERS.map((p) => {
        const { added, optional } = providers[p.id] ?? {}
        // one of your own in config.json's providers stays: only what Add put there can be removed
        const act = added
          ? `<span class="su-added">Added</span>${optional ? `<button type="button" class="btn su-btn" data-remove="${p.id}">Remove</button>` : ''}`
          : `<button type="button" class="btn su-btn" data-add="${p.id}">Add ${esc(p.name)}</button>`
        return `<div class="su-prow" data-provider="${p.id}">
          <div class="su-top"><span class="su-name">${esc(p.name)}</span><span class="su-pact">${act}</span></div>
          <div class="su-by">${esc(p.by)}</div><div class="su-step">${esc(p.needs)}</div>${providerLines(p)}</div>`
      }).join('')}</div>
      <p class="err su-err">${esc(sheetError)}</p>
      <div class="buttons"><button type="button" class="btn" data-act="check" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check again'}</button><span class="grow"></span><button type="button" class="btn" data-act="done">Done</button></div>`)
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
      if (stuck() && !dismissed && !shown) {
        shown = true
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

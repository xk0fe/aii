// Accounts (core/accounts.js): more than one sign-in for a provider. The sheet lists each provider that signs you in
// with its default account (the sign-in its CLI has on this computer) and the ones you added: who's signed in, its
// usage limits now, how many agents run on it. From here you add one (it signs in in your browser), sign one in or
// out, rename it, move its agents to another, or remove it. State comes with the app's (state.accounts, state.usage);
// what you do goes through clique.call('account', …).
/* global clique, esc, morph, popMenu, ICONS, limitNums, usageTip, plural, errorLine, notify, oops, PRODUCT_NAME, THIS_COMPUTER */

function mountAccounts({ sheet, getState }) {
  sheet.innerHTML = `
    <h2 class="sheet-title"><span class="h-icon">${ICONS.user}</span>Accounts</h2>
    <button type="button" class="icon sheet-x" data-close aria-label="Close">${ICONS.close}</button>
    <p class="lead">Run your agents on more than one sign-in. Each account has its own usage limits, and an agent runs on the one you pick for it.</p>
    <div class="sheet-body ac-body"></div>
    <p class="err" data-ac-err></p>
    <div class="sheet-foot"><span class="ac-foot-note">Signing in happens in your browser, with the CLI's own sign-in. ${esc(PRODUCT_NAME)} never sees a password.</span><span class="grow"></span><button type="button" class="btn" data-close autofocus>Done</button></div>`
  const $ = (sel) => sheet.querySelector(sel)
  const body = $('.ac-body')

  let adding = null // { provider, name }: the name being typed for a new account
  let renaming = null // { id, name }
  const busy = new Set() // keys with a call under way

  const accounts = () => getState()?.accounts ?? []
  // What a CLI is called where its sign-in is talked about: Claude signs in through Claude Code.
  const cliName = (a) => (a.cli === 'codex' ? 'Codex' : 'Claude Code')
  const who = (a) => [a.email, a.plan].filter(Boolean).join(' · ')

  // One account's row: what it is, who's signed in (or what it needs), its limits now, its agents, and more.
  function rowHTML(a) {
    const u = getState()?.usage?.[a.key]
    const limits = u?.windows?.length ? `<span class="ac-lim" title="${esc(usageTip(u))}">${limitNums(u)}</span>` : ''
    const agents = `<span class="ac-agents" title="${a.agents ? `${plural(a.agents, 'agent')} run${a.agents === 1 ? 's' : ''} on it, in every workspace` : 'No agent runs on it yet: pick it for one in its settings'}">${a.agents ? plural(a.agents, 'agent') : 'no agents'}</span>`
    if (renaming?.id === a.id && !a.own) {
      return `<form class="ac-row ac-form" data-ac="${esc(a.key)}" data-ac-rename><input class="field" name="name" value="${esc(renaming.name)}" maxlength="40" autocomplete="off" spellcheck="false" aria-label="Its name"><button type="submit" class="btn primary">Rename</button><button type="button" class="btn" data-ac-cancel-edit>Cancel</button></form>`
    }
    // the default one says what it is beside its name: the sign-in its CLI already had
    const title = a.own ? `Default<small>${esc(cliName(a))}’s own sign-in on ${esc(THIS_COMPUTER)}</small>` : esc(a.name)
    let sub
    let action = ''
    if (a.signing) {
      sub = `<span class="ac-wait">Finish signing in in your browser…</span>`
      action = `${a.signing.link ? `<button type="button" class="btn sm" data-ac-copy title="If the browser didn't open: copy the sign-in page's address">Copy link</button>` : ''}<button type="button" class="btn sm" data-ac-stop>Cancel</button>`
    } else if (a.missing) sub = `<span class="ac-need">${esc(cliName(a))} isn't installed</span>`
    else if (a.signedIn === false) {
      sub = a.problem ? `<span class="ac-need" title="${esc(a.problem)}">Sign-in didn't go through: ${esc(a.problem)}</span>` : `<span class="ac-need">Not signed in</span>`
      action = `<button type="button" class="btn sm primary" data-ac-signin>Sign in</button>`
    } else if (a.signedIn === undefined) sub = '<span class="ac-quiet">Checking who’s signed in…</span>'
    else sub = esc(who(a) || 'Signed in')
    // a code its page gave instead of finishing by itself (Claude Code's, when the browser is somewhere else)
    const code = a.signing && a.cli !== 'codex' ? `<form class="ac-code" data-ac-code><input class="field" name="code" placeholder="If the page shows a code, paste it here" autocomplete="off" spellcheck="false" aria-label="The code the sign-in page shows"><button type="submit" class="btn sm">Use code</button></form>` : ''
    return `<div class="ac-row${a.signing ? ' signing' : ''}" data-ac="${esc(a.key)}">
      <div class="ac-main"><b>${title}</b><span class="ac-sub">${sub}</span>${code}</div>
      <div class="ac-side">${action || `${limits}${agents}`}</div>
      <button type="button" class="icon ac-menu" data-ac-menu aria-label="More" aria-haspopup="menu"${busy.has(a.key) ? ' disabled' : ''}>${ICONS.more}</button>
    </div>`
  }

  function draw() {
    if (!sheet.open) return
    const all = accounts()
    const providers = [...new Set(all.map((a) => a.provider))]
    morph(body, providers.map((id) => {
      const mine = all.filter((a) => a.provider === id)
      const add = adding?.provider === id
        ? `<form class="ac-row ac-form" data-ac-add="${esc(id)}"><input class="field" name="name" value="${esc(adding.name)}" placeholder="Its name: Work, Personal…" maxlength="40" autocomplete="off" spellcheck="false" aria-label="The new account's name"><button type="submit" class="btn primary">Add and sign in</button><button type="button" class="btn" data-ac-cancel-edit>Cancel</button></form>`
        : ''
      return `<section class="ac-group" data-provider="${esc(id)}">
        <h3 class="section-label"><span>${esc(mine[0].label)}</span><span class="grow"></span><button type="button" class="btn sm plain" data-ac-new="${esc(id)}"${add ? ' disabled' : ''}>${ICONS.plus}Add account</button></h3>
        <div class="group-list ac-list">${mine.map(rowHTML).join('')}${add}</div>
      </section>`
    }).join('') || `<div class="empty-state small">${ICONS.user}<b>Nothing signs in here</b><span>Accounts are for Claude Code and Codex. Install one first.</span></div>`)
  }

  const say = (text) => ($('[data-ac-err]').textContent = text ?? '')
  async function call(key, op, arg, what) {
    say('')
    busy.add(key)
    draw()
    try {
      return await clique.call('account', op, arg)
    } catch (err) {
      say(`${what}: ${errorLine(err)}`)
      return undefined
    } finally {
      busy.delete(key)
      draw()
    }
  }

  function menuFor(a, anchor) {
    const others = accounts().filter((x) => x.provider === a.provider && x.key !== a.key)
    const items = [
      ...(a.signing ? [] : [{ label: a.signedIn ? 'Sign in again…' : 'Sign in…', icon: ICONS.user, act: 'signin', hint: a.signedIn ? 'as someone else' : '' }]),
      ...(!a.own && a.signedIn ? [{ label: 'Sign out', icon: ICONS.power, act: 'signout' }] : []),
      ...(!a.own ? [{ label: 'Rename…', icon: ICONS.edit, act: 'rename' }] : []),
      ...(a.agents && others.length ? ['-', { head: `Move its ${plural(a.agents, 'agent')} to` }, ...others.map((x, i) => ({ label: x.own ? 'Default' : x.name, act: `move:${i}`, hint: x.signedIn === false ? 'not signed in' : who(x) }))] : []),
      ...(!a.own ? ['-', { label: 'Remove…', icon: ICONS.trash, act: 'remove', danger: true }] : []),
    ]
    popMenu(anchor, items, async (act) => {
      if (act === 'signin') return call(a.key, 'signIn', { provider: a.provider, id: a.id }, "Couldn't start the sign-in")
      if (act === 'signout') return call(a.key, 'signOut', { id: a.id }, "Couldn't sign out")
      if (act === 'rename') return void ((renaming = { id: a.id, name: a.name }), (adding = null), draw(), body.querySelector('[data-ac-rename] input')?.select())
      if (act.startsWith('move:')) {
        const to = others[Number(act.slice(5))]
        const n = await call(a.key, 'move', { provider: a.provider, from: a.id, to: to.id }, "Couldn't move them")
        if (n) notify(`${plural(n, 'agent')} now ${n === 1 ? 'runs' : 'run'} on ${to.own ? `${a.label}’s default account` : to.name}. ${n === 1 ? 'It restarts' : 'They restart'} there when free, each with its conversation`)
        return undefined
      }
      if (act === 'remove') {
        if (!confirm(`Remove ${a.name}? It's signed out and its folder goes. What it used stays in Usage.`)) return undefined
        return call(a.key, 'remove', { id: a.id }, `Couldn't remove ${a.name}`)
      }
      return undefined
    })
  }

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === sheet) return sheet.close()
    const fresh = e.target.closest('[data-ac-new]')
    if (fresh) return void ((adding = { provider: fresh.dataset.acNew, name: '' }), (renaming = null), say(''), draw(), body.querySelector('[data-ac-add] input')?.focus())
    if (e.target.closest('[data-ac-cancel-edit]')) return void ((adding = null), (renaming = null), draw())
    const key = e.target.closest('[data-ac]')?.dataset.ac
    const a = key && accounts().find((x) => x.key === key)
    if (!a) return undefined
    if (e.target.closest('[data-ac-signin]')) return call(a.key, 'signIn', { provider: a.provider, id: a.id }, "Couldn't start the sign-in")
    if (e.target.closest('[data-ac-stop]')) return call(a.key, 'cancel', { key: a.key }, "Couldn't stop it")
    if (e.target.closest('[data-ac-copy]')) return navigator.clipboard.writeText(a.signing?.link ?? '').then(() => notify('Copied: open it in your browser to sign in'), (err) => oops("Couldn't copy the link", err))
    const menu = e.target.closest('[data-ac-menu]')
    if (menu) return menuFor(a, menu)
    return undefined
  })
  sheet.addEventListener('input', (e) => {
    if (e.target.closest('[data-ac-add]') && adding) adding.name = e.target.value
    if (e.target.closest('[data-ac-rename]') && renaming) renaming.name = e.target.value
  })
  sheet.addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    if (form.matches('[data-ac-add]')) {
      const provider = form.dataset.acAdd
      const name = form.elements.name.value.trim()
      if (!name) return void form.elements.name.focus()
      const id = await call(`+${provider}`, 'add', { provider, name }, "Couldn't add it")
      if (id) adding = null
      return draw()
    }
    if (form.matches('[data-ac-rename]')) {
      const { id } = renaming ?? {}
      const name = form.elements.name.value.trim()
      if (!id || !name) return undefined
      const key = form.closest('[data-ac]')?.dataset.ac
      say('')
      try {
        await clique.call('account', 'rename', { id, name })
        renaming = null
      } catch (err) {
        say(`Couldn't rename it: ${errorLine(err)}`)
      }
      busy.delete(key)
      return draw()
    }
    if (form.matches('[data-ac-code]')) {
      const key = form.closest('[data-ac]')?.dataset.ac
      const text = form.elements.code.value.trim()
      if (key && text) await call(key, 'code', { key, text }, "Couldn't use the code")
    }
    return undefined
  })
  // Esc leaves a name being typed before it leaves the sheet
  sheet.addEventListener('cancel', (e) => {
    if (!adding && !renaming) return
    e.preventDefault()
    adding = renaming = null
    draw()
  })

  return {
    // from the ⋯ menu, the limits' popover, or an agent's sheet. provider: with Add account open for it.
    open({ add } = {}) {
      say('')
      adding = add ? { provider: add, name: '' } : null
      renaming = null
      if (!sheet.open) sheet.showModal()
      draw()
      if (adding) body.querySelector('[data-ac-add] input')?.focus()
      clique.call('account', 'check').catch(() => {}) // who's signed in, asked of each CLI now
    },
    // the app's state changed: a sign-in went through, a limit moved
    render: draw,
  }
}

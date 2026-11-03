// Workspaces in the dashboard (core/workspaces.js): the rail of every workspace down the window's left edge (like
// Discord's servers), which says which needs you and switches; the name at the top of the sidebar, whose menu has
// what you do with the one on screen; the sheet that makes a workspace or changes one; and the banner over a parked
// one. The dashboard does the switching itself (onSwitch), so it can animate it.
/* global crew, esc, plural, morph, markSVG, popMenu, shortPath, tildePath, pathField, pathParts, keys, oops, errorLine, ICONS, COLORS, wsTile, wsColor, wsStatus, elsewhere, hasWorkspaces, faceStack, avatarHTML, agentColor, bounce */

const WS_COLORS = ['blue', 'sky', 'teal', 'mint', 'lime', 'yellow', 'orange', 'peach', 'red', 'pink', 'lilac', 'purple']
const WS_ICONS = ['⛳', '🚀', '🎮', '📱', '🛒', '🎨', '🧪', '📚', '🏡', '💼', '🌱', '⚡', '🔧', '🌍']
// a folder in a field (pathField: ~/code/app on a Mac, written out on Windows), and in words (tildePath)
const tilde = (p) => pathField(p)

// onSwitch(id, { open }): put a workspace on screen (opening it first if it's parked). onSwitched(state): a workspace
// the sheet just made is on screen. onMembers(anchor): show who works in the one on screen. dock: the rail.
function mountWorkspaces({ button, banner, dock, dialog, onSwitch, onSwitched, onMembers }) {
  let state = null

  // ---- the switcher ----------------------------------------------------------------------------------------

  function drawButton() {
    const w = state.workspace
    const on = hasWorkspaces(state)
    // its name (the rail has the tiles, and what the others need of you)
    morph(button, on
      ? `<b>${esc(w.name)}</b><span class="ws-chev">${ICONS.chevron}</span>`
      : `<span class="ws-mark">${markSVG('0 6 24 16')}</span><b>${esc(PRODUCT_NAME)}</b><span class="ws-chev">${ICONS.chevron}</span>`)
    button.title = on ? `${w.name}${w.folder ? `, in ${tildePath(w.folder)}` : ''}: who works here, settings, a new workspace` : 'Workspaces: a crew, chat and tasks per project'
    // the workspace's color tints the sidebar, so you always know where you are
    const color = on ? wsColor(w) : null
    document.body.classList.toggle('ws-tint', Boolean(color))
    if (color) document.body.style.setProperty('--ws', color)
  }

  // ---- the name's menu: what you do with the workspace on screen (like Discord's server menu) ---------------------

  function menu() {
    const w = state.workspace
    const list = state.workspaces ?? []
    const named = w && w.id !== 'default'
    const on = hasWorkspaces(state)
    button.setAttribute('aria-expanded', 'true')
    const m = popMenu(button, [
      ...(on ? [{ head: w.folder ? `${w.name} · ${tildePath(w.folder)}` : w.name }] : []),
      { label: 'Who works here…', icon: ICONS.subs, act: 'members', hint: plural(state.agents.filter((a) => !a.cloneOf).length, 'agent') },
      ...(on || named ? [{ label: 'Settings…', icon: ICONS.gear, act: 'settings' }] : []),
      ...(list.length > 1 ? [w.parked ? { label: `Open ${w.name}`, icon: ICONS.play, act: 'open' } : { label: `Park ${w.name}`, icon: ICONS.pause, act: 'park', hint: 'stops its agents' }] : []),
      '-',
      { label: 'New workspace…', icon: ICONS.plus, act: 'new' },
    ], (act) => {
      if (act === 'members') onMembers?.(button)
      if (act === 'settings') openSheet(w.id)
      if (act === 'open') crew.call('workspace', 'open', w.id).catch((err) => oops(`Couldn't open ${w.name}`, err))
      if (act === 'park') park(w)
      if (act === 'new') openSheet(null)
    })
    // the menu says when it's gone (it closes itself on a pick, Esc or a click elsewhere)
    new MutationObserver((_, o) => !m.el.isConnected && (o.disconnect(), button.setAttribute('aria-expanded', 'false'))).observe(document.body, { childList: true })
  }
  button.addEventListener('click', menu)

  async function park(w) {
    const busy = w.working + w.waiting
    if (busy && !confirm(`${plural(busy, 'agent')} in ${w.name} ${busy > 1 ? 'are' : 'is'} in the middle of something. Park it anyway? They stop now, and pick their conversations back up when you open it.`)) return
    try {
      await crew.call('workspace', 'park', w.id)
    } catch (err) {
      oops(`Couldn't park ${w.name}`, err)
    }
  }

  // ---- the rail: every workspace down the window's left edge, each with what it needs of you ---------------------
  // Like Discord's servers: one click away, and a glance says which one wants you (a berry count) or has news for you
  // (a short pill). Parked ones are in black and white. Drag one up or down to move it; right-click for the rest.

  let dragging = null // the workspace being dragged, while it is
  let railStale = false
  function drawDock() {
    const list = state.workspaces ?? []
    const on = list.length > 1
    document.body.classList.toggle('has-rail', on)
    if (!on) return morph(dock, '')
    if (dragging) return void (railStale = true) // a redraw mid-drag would drop where it's going
    railStale = false
    const badge = (w) => (w.current || w.parked || !w.waiting ? '' : `<i class="need-badge" aria-label="${esc(`${w.waiting} need${w.waiting > 1 ? '' : 's'} you`)}">${w.waiting > 9 ? '9+' : w.waiting}</i>`)
    morph(dock, list.map((w, i) => `<button class="rail-ws ${w.current ? 'current' : ''} ${w.parked ? 'parked' : ''} ${!w.current && !w.parked && w.unread ? 'unread' : ''}" data-ws="${esc(w.id)}" role="tab" aria-selected="${w.current}" draggable="${w.id !== 'default'}" style="--w:${esc(wsColor(w) ?? 'var(--fg3)')}" title="${esc(`${w.name}: ${wsStatus(w)}${i < 9 ? ` (${keys(`⌃${i + 1}`)})` : ''}`)}"><i class="rail-pill"></i>${wsTile({ ...w, parked: false }, { size: 44 })}${badge(w)}</button>${i === 0 ? '<i class="rail-sep"></i>' : ''}`).join('') +
      `<button class="rail-add" data-ws-new title="New workspace: a folder, who works on it, and its own chat and tasks" aria-label="New workspace">${ICONS.plus}</button>`)
  }

  dock.addEventListener('click', (e) => {
    if (e.target.closest('[data-ws-new]')) return openSheet(null)
    const w = state.workspaces.find((x) => x.id === e.target.closest('[data-ws]')?.dataset.ws)
    if (w && !w.current) onSwitch(w.id)
  })
  dock.addEventListener('contextmenu', (e) => {
    const w = state.workspaces.find((x) => x.id === e.target.closest('[data-ws]')?.dataset.ws)
    if (!w) return
    e.preventDefault()
    e.stopPropagation()
    const others = state.workspaces.length > 1
    popMenu({ x: e.clientX, y: e.clientY }, [
      { head: w.name },
      ...(w.current ? [] : [{ label: 'Switch to it', icon: ICONS.arrow, act: 'switch' }]),
      ...(w.current ? [{ label: 'Who works here…', icon: ICONS.subs, act: 'members' }] : []),
      ...(others ? [w.parked ? { label: 'Open', icon: ICONS.play, act: 'open', hint: 'starts its agents' } : { label: 'Park', icon: ICONS.pause, act: 'park', hint: 'stops its agents' }] : []),
      { label: 'Settings…', icon: ICONS.gear, act: 'settings' },
      ...(w.id === 'default' ? [] : ['-', { label: 'Remove…', icon: ICONS.trash, act: 'remove', danger: true }]),
    ], (act) => {
      if (act === 'switch') onSwitch(w.id)
      if (act === 'members') onMembers?.(e.target.closest('[data-ws]'))
      if (act === 'open') crew.call('workspace', 'open', w.id).catch((err) => oops(`Couldn't open ${w.name}`, err))
      if (act === 'park') park(w)
      if (act === 'settings') openSheet(w.id)
      if (act === 'remove') remove(w)
    })
  })
  // Drag a workspace up or down the rail to move it (the default, first, stays put): a line shows where it lands.
  const marks = () => dock.querySelectorAll('.drop-before, .drop-after')
  dock.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.rail-ws')
    if (!el || el.dataset.ws === 'default') return e.preventDefault()
    dragging = el.dataset.ws
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-crew-workspace', dragging)
    el.classList.add('dragging')
  })
  const target = (e) => {
    const el = e.target.closest('.rail-ws')
    if (!el || !dragging) return null
    const r = el.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    if (el.dataset.ws === 'default' && !after) return null // nothing goes above the default
    return { el, after }
  }
  dock.addEventListener('dragover', (e) => {
    const t = target(e)
    if (!t) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    for (const x of marks()) if (x !== t.el) x.classList.remove('drop-before', 'drop-after')
    t.el.classList.toggle('drop-before', !t.after)
    t.el.classList.toggle('drop-after', t.after)
  })
  dock.addEventListener('drop', async (e) => {
    const t = target(e)
    if (!t) return
    e.preventDefault()
    const moving = dragging
    const ids = state.workspaces.map((w) => w.id).filter((id) => id !== moving)
    ids.splice(ids.indexOf(t.el.dataset.ws) + (t.after ? 1 : 0), 0, moving)
    endDrag()
    try {
      await crew.call('workspace', 'order', null, ids.filter((id) => id !== 'default'))
    } catch (err) {
      oops("Couldn't move that workspace", err)
    }
  })
  const endDrag = () => {
    if (!dragging) return
    dragging = null
    for (const x of dock.querySelectorAll('.dragging, .drop-before, .drop-after')) x.classList.remove('dragging', 'drop-before', 'drop-after')
    if (railStale) drawDock()
  }
  dock.addEventListener('dragend', endDrag)
  dock.addEventListener('dragleave', (e) => !dock.contains(e.relatedTarget) && marks().forEach((x) => x.classList.remove('drop-before', 'drop-after')))

  // ---- the banner over a parked workspace ------------------------------------------------------------------

  function drawBanner() {
    const w = state.workspace
    const parked = Boolean(w?.parked)
    document.body.classList.toggle('ws-parked', parked)
    banner.classList.toggle('hidden', !parked)
    if (!parked) return
    banner.style.setProperty('--w', wsColor(w) ?? 'var(--fg3)')
    morph(banner, `${wsTile(w, { size: 30 })}
      <div class="grow"><b>${esc(w.name)} is parked</b><span>Its agents aren't running. Their chat, tasks and conversations wait right where they were.</span></div>
      <button class="btn primary" data-ws-open>${ICONS.play}<span>Open ${esc(w.name)}</span></button>`)
  }

  banner.addEventListener('click', (e) => {
    if (e.target.closest('[data-ws-open]')) crew.call('workspace', 'open', state.workspace.id).catch((err) => oops(`Couldn't open ${state.workspace.name}`, err))
  })

  // ---- the sheet: a new workspace, or one's settings -------------------------------------------------------

  let draft = null // { id, name, color, icon, folder, members: Set, folders: {}, running }
  let before = null // the workspace as it was, when changing one

  dialog.innerHTML = `
    <header class="ws-hero">
      <span class="ws-hero-tile"></span>
      <div class="ws-hero-main">
        <input class="ws-title" data-ws-name placeholder="Name it" spellcheck="false" maxlength="40" autocomplete="off">
        <span class="ws-hero-sub"></span>
      </div>
      <button type="button" class="icon ws-x" data-close aria-label="Close">${ICONS.close}</button>
    </header>
    <div class="sheet-body ws-body">
      <section class="ws-sec">
        <h4>Look</h4>
        <div class="ws-swatches" role="radiogroup" aria-label="Color"></div>
        <div class="ws-icons" role="radiogroup" aria-label="Icon"></div>
      </section>
      <section class="ws-sec" data-sec="folder">
        <h4>Folder</h4>
        <div class="mv-field"><input data-ws-folder class="mono" placeholder="~/code/my-app" spellcheck="false" autocomplete="off"><button type="button" class="btn small" data-ws-pick>Choose…</button></div>
        <p class="ws-note">Where its agents work, unless one has a folder of its own here.</p>
      </section>
      <section class="ws-sec" data-sec="crew">
        <h4><span data-crew-title>Who works here</span> <small class="ws-count"></small></h4>
        <ul class="ws-crew"></ul>
        <p class="ws-note" data-crew-note></p>
      </section>
      <section class="ws-sec" data-sec="run">
        <label class="ws-run"><span class="ws-run-glyph"></span><div class="grow"><b></b><small></small></div><input type="checkbox" class="switch" data-ws-running></label>
      </section>
    </div>
    <p class="err" data-ws-err></p>
    <div class="buttons">
      <button type="button" class="btn ws-remove" data-ws-remove>${ICONS.trash}<span>Remove workspace…</span></button>
      <span class="grow"></span>
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="button" class="btn primary" data-ws-save></button>
    </div>`
  const $d = (s) => dialog.querySelector(s)

  function openSheet(id) {
    const w = id ? state.workspaces.find((x) => x.id === id) : null
    const named = !w || w.id !== 'default'
    before = w
    // Home has every agent, each in the folder of its own; any other workspace, its members and their folders there
    const home = w?.id === 'default'
    const roster = state.roster ?? []
    draft = {
      id: w?.id ?? null, name: w?.name ?? '', color: w?.color ?? (w ? '' : freshColor()), icon: w?.icon ?? '', folder: w?.folder ?? '',
      members: new Set(home ? roster.map((a) => a.name) : w?.members?.map((m) => m.name) ?? []),
      folders: Object.fromEntries(home ? roster.filter((a) => a.cwd).map((a) => [a.name, a.cwd]) : (w?.members ?? []).filter((m) => m.folder).map((m) => [m.name, m.folder])),
      running: w ? !w.parked : true,
    }
    $d('[data-ws-name]').value = draft.name
    $d('[data-ws-folder]').value = tilde(draft.folder)
    $d('[data-sec=folder]').classList.toggle('hidden', !named)
    $d('[data-sec=run]').classList.toggle('hidden', !w)
    $d('[data-ws-remove]').classList.toggle('hidden', !w || !named)
    $d('[data-ws-save]').textContent = w ? 'Save' : 'Create workspace'
    $d('[data-ws-err]').textContent = ''
    dialog.classList.toggle('new', !w)
    drawSheet()
    dialog.showModal()
    if (!w) setTimeout(() => $d('[data-ws-name]').focus(), 60)
  }

  // A color no workspace has yet, so each new one looks different.
  function freshColor() {
    const used = new Set((state.workspaces ?? []).map((w) => w.color))
    return WS_COLORS.find((c) => !used.has(c)) ?? WS_COLORS[(state.workspaces?.length ?? 0) % WS_COLORS.length]
  }

  // crew: the list of agents too (typing a name or a folder leaves it be)
  function drawSheet({ crew: list = true } = {}) {
    const named = draft.id !== 'default'
    const look = { id: draft.id ?? 'new', name: draft.name || 'New workspace', color: draft.color, icon: draft.icon, parked: !draft.running }
    $d('.ws-hero-tile').innerHTML = wsTile(look, { size: 58, cls: 'hero' })
    dialog.style.setProperty('--hero', wsColor(look) ?? 'var(--fg3)')
    const roster = state.roster ?? []
    const members = roster.filter((a) => draft.members.has(a.name))
    $d('.ws-hero-sub').innerHTML = !named
      ? `${faceStack(roster, 6)}<span>Every agent in your crew, each in its own folder</span>`
      : members.length ? `${faceStack(members, 6)}<span>${plural(members.length, 'agent')}${draft.folder ? ` · ${esc(shortPath(draft.folder))}` : ''}</span>` : `<span>${draft.id ? 'No shared agents here yet' : 'A new workspace'}</span>`
    $d('.ws-swatches').innerHTML = `<button type="button" class="ws-sw none ${draft.color ? '' : 'on'}" data-ws-color="" title="No color" role="radio" aria-checked="${!draft.color}"></button>` +
      WS_COLORS.map((c) => `<button type="button" class="ws-sw ${draft.color === c ? 'on' : ''}" data-ws-color="${c}" style="--w:${COLORS[c]}" title="${c}" role="radio" aria-checked="${draft.color === c}"></button>`).join('')
    $d('.ws-icons').innerHTML = `<button type="button" class="ws-ic letter ${draft.icon ? '' : 'on'}" data-ws-icon="" title="Its initial" role="radio" aria-checked="${!draft.icon}">${esc((draft.name.trim()[0] ?? 'A').toUpperCase())}</button>` +
      WS_ICONS.map((i) => `<button type="button" class="ws-ic ${draft.icon === i ? 'on' : ''}" data-ws-icon="${i}" role="radio" aria-checked="${draft.icon === i}">${i}</button>`).join('')
    $d('[data-sec=crew]').classList.toggle('hidden', !roster.length)
    $d('[data-crew-title]').textContent = named ? 'Who works here' : 'Where they work'
    $d('.ws-count').textContent = !roster.length ? '' : named ? `${draft.members.size} of ${roster.length}` : plural(roster.length, 'agent')
    if (list) drawCrew(roster)
    const run = $d('.ws-run')
    run.querySelector('b').textContent = draft.running ? 'Running' : 'Parked'
    run.querySelector('small').textContent = draft.running ? 'Its agents are on. Park it to stop them; nothing is lost.' : 'Its agents are stopped. Its chat, tasks and conversations wait.'
    run.querySelector('.ws-run-glyph').innerHTML = draft.running ? ICONS.play : ICONS.pause
    run.querySelector('input').checked = draft.running
    run.classList.toggle('on', draft.running)
  }

  // Home: every agent, each with the folder of its own to change. Any other workspace: who's in it (the switches), and a
  // folder of its own there for any of them.
  function drawCrew(roster) {
    const home = draft.id === 'default'
    $d('.ws-crew').innerHTML = roster.map((a) => {
      const on = draft.members.has(a.name)
      const own = draft.folders[a.name]
      const tip = home ? `Works in ${own ? esc(own) : 'your home folder'}. Click to change` : own ? `Works in ${esc(own)} here. Click to change` : "Give it a folder of its own here, instead of the workspace's"
      return `<li class="ws-agent ${on ? 'in' : ''}" data-agent="${esc(a.name)}" style="--c:${agentColor(a)}">
        <span class="ws-av">${avatarHTML(a, { size: 30, mood: on ? undefined : 'still' })}</span>
        <span class="who"><b>${esc(a.name)}</b><small>${esc(a.area || 'no area')}</small></span>
        ${on ? `<button type="button" class="ws-own ${own || home ? 'set' : ''}" data-ws-own="${esc(a.name)}" title="${tip}">${ICONS.folder}<span>${own ? esc(tilde(own)) : home ? '~' : 'Own folder'}</span></button>` : ''}
        ${home ? '' : `<input type="checkbox" class="switch sm" data-ws-member="${esc(a.name)}" ${on ? 'checked' : ''} aria-label="${esc(a.name)} works here">`}
      </li>`
    }).join('')
    $d('[data-crew-note]').textContent = home
      ? 'Home has no folder of its own: each agent works in its own, as you set it here or in its sheet. For a project the whole crew works on in one folder, make a workspace for it.'
      : draft.id
        ? 'Who an agent is (its job, brain and look) is the same in every workspace; where it works and whether it’s on is each workspace’s. Agents only this workspace needs: make them with New agent while you’re in it.'
        : 'Your agents bring who they are (job, brain, look) and start fresh conversations here. Agents only this workspace needs: make them with New agent once you’re in it.'
  }

  dialog.addEventListener('input', (e) => {
    if (e.target.matches('[data-ws-name]')) {
      draft.name = e.target.value
      drawSheet({ crew: false })
    }
    if (e.target.matches('[data-ws-folder]')) {
      draft.folder = e.target.value
      drawSheet({ crew: false })
    }
  })

  dialog.addEventListener('change', (e) => {
    const t = e.target
    if (t.matches('[data-ws-member]')) {
      const name = t.dataset.wsMember
      t.checked ? draft.members.add(name) : draft.members.delete(name)
      drawSheet()
      if (t.checked) bounce(dialog.querySelector(`.ws-agent[data-agent="${CSS.escape(name)}"] .av`))
    }
    if (t.matches('[data-ws-running]')) {
      draft.running = t.checked
      drawSheet()
    }
    if (t.matches('[data-ws-own-input]')) setOwn(t)
  })

  function setOwn(input) {
    const name = input.dataset.wsOwnInput
    const value = input.value.trim()
    // shown with ~ for your home: left as it was, it keeps the path it had
    if (value !== tilde(draft.folders[name] ?? '')) {
      if (value) draft.folders[name] = value
      else delete draft.folders[name]
    }
    drawSheet()
  }

  dialog.addEventListener('click', async (e) => {
    const t = e.target
    if (t === dialog || t.closest('[data-close]')) return dialog.close()
    const color = t.closest('[data-ws-color]')
    if (color) return ((draft.color = color.dataset.wsColor), drawSheet(), bounce($d('.ws-hero-tile .ws-tile')))
    const icon = t.closest('[data-ws-icon]')
    if (icon) return ((draft.icon = icon.dataset.wsIcon), drawSheet(), bounce($d('.ws-hero-tile .ws-tile')))
    const own = t.closest('[data-ws-own]')
    if (own) {
      // in place: a field for its folder here, empty for the workspace's
      const name = own.dataset.wsOwn
      own.outerHTML = `<input class="ws-own-input mono" data-ws-own-input="${esc(name)}" value="${esc(tilde(draft.folders[name] ?? ''))}" placeholder="${esc(draft.id === 'default' ? '~ (your home folder)' : tilde(draft.folder) || '~/code/…')}" spellcheck="false">`
      const input = dialog.querySelector(`[data-ws-own-input="${CSS.escape(name)}"]`)
      input.focus()
      input.addEventListener('keydown', (k) => k.key === 'Enter' && (k.preventDefault(), setOwn(input)))
      input.addEventListener('blur', () => input.isConnected && setOwn(input))
      return
    }
    if (t.closest('[data-ws-pick]')) {
      const dir = await crew.call('pickFolder').catch(() => null)
      if (dir) {
        $d('[data-ws-folder]').value = tilde(dir)
        draft.folder = dir
        if (!draft.name.trim()) $d('[data-ws-name]').value = draft.name = (pathParts(dir).pop() ?? '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
        drawSheet()
      }
      return
    }
    if (t.closest('[data-ws-remove]')) return remove()
    if (t.closest('[data-ws-save]')) return save()
  })

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-ws-name], [data-ws-folder]')) (e.preventDefault(), save())
  })

  async function save() {
    const err = $d('[data-ws-err]')
    const btn = $d('[data-ws-save]')
    if (!draft.name.trim()) {
      err.textContent = 'Give it a name'
      return $d('[data-ws-name]').focus()
    }
    err.textContent = ''
    btn.disabled = true
    const look = { name: draft.name, color: draft.color, icon: draft.icon, folder: draft.folder }
    try {
      // its agents start there: a folder that isn't there would only stop them
      const where = draft.folder.trim() && draft.id !== 'default' ? await crew.call('folderInfo', '', draft.folder.trim()) : null
      if (where && !where.exists) throw new Error(`There's no folder ${tildePath(where.path)}`)
      if (!draft.id) {
        const { state: next } = await crew.call('workspace', 'create', null, { ...look, members: [...draft.members], folders: draft.folders })
        dialog.close()
        onSwitched(next)
      } else {
        const id = draft.id
        // folders that changed, checked first: an agent can't start in one that isn't there
        const folderWas = (n) => (id === 'default' ? (state.roster ?? []).find((a) => a.name === n)?.cwd : before.members.find((m) => m.name === n)?.folder) ?? ''
        const moved = Object.fromEntries([...draft.members].map((n) => [n, draft.folders[n] ?? '']).filter(([n, f]) => f !== folderWas(n)))
        for (const f of Object.values(moved).filter(Boolean)) {
          const there = await crew.call('folderInfo', '', f)
          if (!there.exists) throw new Error(`There's no folder ${tilde(there.path)}`)
        }
        await crew.call('workspace', 'edit', id, look)
        if (id === 'default' && Object.keys(moved).length) await crew.call('workspace', 'members', id, { folders: moved })
        if (id !== 'default') {
          const was = new Set(before.members.map((m) => m.name))
          const folders = Object.fromEntries([...draft.members].map((n) => [n, draft.folders[n] ?? '']).filter(([n, f]) => f !== (before.members.find((m) => m.name === n)?.folder ?? '')))
          await crew.call('workspace', 'members', id, { add: [...draft.members].filter((n) => !was.has(n)), remove: [...was].filter((n) => !draft.members.has(n)), folders })
        }
        if (draft.running === before.parked) await crew.call('workspace', draft.running ? 'open' : 'park', id)
        dialog.close()
      }
    } catch (x) {
      err.textContent = errorLine(x)
    } finally {
      btn.disabled = false
    }
  }

  async function remove(w = before) {
    const own = (w.agents ?? 0) - (w.members?.length ?? 0)
    if (!confirm(`Remove ${w.name}?\n\nIts agents stop and it leaves the switcher.${own > 0 ? ` ${plural(own, 'agent')} of its own ${own > 1 ? 'go' : 'goes'} with it.` : ''} Your shared agents stay in your crew.\n\nIts chat, notes and tasks are kept on disk: a workspace made again with the same name picks them back up.`)) return
    try {
      await crew.call('workspace', 'remove', w.id)
      if (dialog.open) dialog.close()
    } catch (x) {
      if (dialog.open) $d('[data-ws-err]').textContent = errorLine(x)
      else oops(`Couldn't remove ${w.name}`, x)
    }
  }

  return {
    render(next) {
      state = next
      drawButton()
      drawBanner()
      drawDock()
      if (dialog.open && draft?.id && !state.workspaces.some((w) => w.id === draft.id)) dialog.close() // removed meanwhile
    },
    menu,
    create: () => openSheet(null),
    settings: (id) => openSheet(id ?? state.workspace.id),
  }
}

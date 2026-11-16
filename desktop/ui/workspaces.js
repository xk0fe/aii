// Workspaces in the dashboard (core/workspaces.js): the rail of every workspace down the window's left edge (like
// Discord's servers), which says which needs you and switches; the name at the top of the sidebar, whose menu has
// what you do with the one on screen; the sheet that makes a workspace or changes one; and the banner over a parked
// one. The dashboard does the switching itself (onSwitch), so it can animate it.
/* global shownName, clique, esc, plural, morph, markSVG, popMenu, shortPath, tildePath, pathField, pathParts, keys, oops, errorLine, ICONS, COLORS, wsTile, wsColor, wsStatus, wsLabel, joinable, joinItem, computerIcon, elsewhere, hasWorkspaces, faceStack, avatarHTML, agentColor, bounce */

const WS_COLORS = ['blue', 'sky', 'teal', 'mint', 'lime', 'yellow', 'orange', 'peach', 'red', 'pink', 'lilac', 'purple']
const WS_ICONS = ['⛳', '🚀', '🎮', '📱', '🛒', '🎨', '🧪', '📚', '🏡', '💼', '🌱', '⚡', '🔧', '🌍']
// a folder in a field (pathField: ~/code/app on a Mac, written out on Windows), and in words (tildePath)
const tilde = (p) => pathField(p)

// onSwitch(id): put a workspace on screen (one that's asleep wakes). onSwitched(state): a workspace
// the sheet just made is on screen. onMembers(anchor): show who works in the one on screen. dock: the rail.
function mountWorkspaces({ button, banner, dock, dialog, onSwitch, onSwitched, onMembers }) {
  let state = null

  // ---- the switcher ----------------------------------------------------------------------------------------

  function drawButton() {
    const w = state.workspace
    const on = Boolean(w)
    // its name (the rail has the tiles, and what the others need of you); one hosted on a linked computer says which on
    // a second line in the same button, so the header is the same height whichever workspace is on screen
    morph(button, on
      ? `<span class="ws-names"><b>${esc(w.name)}</b>${w.ownerName ? `<small class="ws-host ${w.ownerOnline ? '' : 'off'}">${computerIcon(w.ownerName)}<span>on ${esc(w.ownerName)}${w.ownerOnline ? '' : ' · offline'}</span></small>` : ''}</span><span class="ws-chev">${ICONS.chevron}</span>`
      : `<span class="ws-mark">${markSVG('0 6 24 16')}</span><b>${esc(PRODUCT_NAME)}</b><span class="ws-chev">${ICONS.chevron}</span>`)
    button.title = on ? `${w.ownerName ? `${w.name}, hosted on ${w.ownerName}${w.ownerOnline ? '' : ' (offline)'}` : w.name}${w.folder ? `, in ${tildePath(w.folder)}` : ''}: who works here, settings, a new workspace` : 'Workspaces: a clique, chat and tasks per project'
    // the workspace's color tints the sidebar, so you always know where you are
    const color = on ? wsColor(w) : null
    document.body.classList.toggle('ws-tint', Boolean(color))
    if (color) document.body.style.setProperty('--ws', color)
  }

  // ---- the name's menu: what you do with the workspace on screen (like Discord's server menu) ---------------------

  // A second click on the name closes its menu (the press outside already did): it doesn't open another. The menu
  // gives the focus back to the name when nothing else took it.
  let current = null
  let wasOpen = false
  button.addEventListener('pointerdown', () => (wasOpen = Boolean(current)))
  function menu() {
    if (wasOpen) return void (wasOpen = false)
    const w = state.workspace
    const list = state.workspaces ?? []
    button.setAttribute('aria-expanded', 'true')
    const m = popMenu(button, [
      ...(w ? [
        { head: w.folder ? `${wsLabel(w)} · ${tildePath(w.folder)}` : wsLabel(w) },
        { label: 'Who works here…', icon: ICONS.subs, act: 'members', hint: plural(state.agents.filter((a) => !a.cloneOf).length, 'agent') },
        ...(w.folder && FOLDER_APP ? [{ label: OPEN_FOLDER, icon: ICONS.folder, act: 'folder' }] : []),
        { label: 'Settings…', icon: ICONS.gear, act: 'settings' },
        // the one thing to do about running: sleep. Waking is going there, or sending it a message.
        ...(list.length > 1 && !w.parked ? [{ label: 'Put to sleep', icon: ICONS.moon, act: 'park', hint: 'stops its agents' }] : []),
        '-',
      ] : []),
      { label: 'New workspace…', icon: ICONS.plus, act: 'new' },
      // what your linked computers have: joining one puts it here too, with its owner's chat, tasks and agents
      ...(joinable(state).length ? ['-', { head: 'On your other computers' }, ...joinable(state).map(joinItem)] : []),
    ], (act) => {
      if (act.startsWith('join:')) join(act.slice('join:'.length))
      if (act === 'members') onMembers?.(button)
      if (act === 'folder') openFolder(w)
      if (act === 'settings') openSheet(w.id)
      if (act === 'park') park(w)
      if (act === 'new') openSheet(null)
    })
    current = m
    // the menu says when it's gone (it closes itself on a pick, Esc or a click elsewhere)
    new MutationObserver((_, o) => {
      if (m.el.isConnected) return
      o.disconnect()
      if (current !== m) return
      current = null
      button.setAttribute('aria-expanded', 'false')
      if (document.activeElement === document.body) button.focus({ preventScroll: true })
    }).observe(document.body, { childList: true })
  }
  button.addEventListener('click', menu)

  async function join(key) {
    const r = (state.remoteWorkspaces ?? []).find((x) => x.key === key)
    try {
      const { state: next } = await clique.call('workspace', 'join', key)
      onSwitched(next)
    } catch (err) {
      oops(`Couldn't show ${r ? `${r.name} · ${r.computerName}` : 'that workspace'}`, err)
    }
  }

  async function park(w) {
    const busy = w.working + w.waiting
    if (busy && !confirm(`${plural(busy, 'agent')} in ${w.name} ${busy > 1 ? 'are' : 'is'} in the middle of something. Put it to sleep anyway? They stop now, and pick their conversations back up when it wakes.`)) return
    try {
      await clique.call('workspace', 'park', w.id)
    } catch (err) {
      oops(`Couldn't put ${w.name} to sleep`, err)
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
    // Hosted on a linked computer: that computer's icon on the tile, and a line between this computer's workspaces and
    // each other computer's, so where each one lives shows at a glance
    const host = (w) => w?.owner ?? ''
    const named = (w) => (w.ownerName ? `${w.name}, hosted on ${w.ownerName}` : w.name)
    morph(dock, list.map((w, i) => `<button class="rail-ws ${w.current ? 'current' : ''} ${w.parked ? 'parked' : ''} ${w.ownerName ? 'hosted' : ''} ${w.ownerName && !w.ownerOnline ? 'owner-off' : ''} ${!w.current && !w.parked && w.unread ? 'unread' : ''}" data-ws="${esc(w.id)}" role="tab" aria-selected="${w.current}" draggable="true" style="--w:${esc(wsColor(w) ?? 'var(--fg3)')}" title="${esc(`${named(w)}: ${wsStatus(w)}${i < 9 ? ` (${keys(`⌃${i + 1}`)})` : ''}`)}"><i class="rail-pill"></i>${wsTile({ ...w, parked: false }, { size: 44 })}${w.ownerName ? `<i class="rail-owner" aria-label="${esc(`on ${w.ownerName}`)}">${computerIcon(w.ownerName)}</i>` : ''}${badge(w)}</button>${list[i + 1] && host(list[i + 1]) !== host(w) ? '<i class="rail-sep"></i>' : ''}`).join('') +
      `<button class="rail-add" data-ws-new title="New workspace: a folder, who works on it, and its own chat and tasks" aria-label="New workspace">${ICONS.plus}</button>`)
  }

  dock.addEventListener('click', (e) => {
    if (e.target.closest('[data-ws-new]')) return openSheet(null)
    const w = state.workspaces.find((x) => x.id === e.target.closest('[data-ws]')?.dataset.ws)
    if (w && (!w.current || w.parked)) onSwitch(w.id) // its own tile wakes the one on screen
  })
  dock.addEventListener('contextmenu', (e) => {
    const w = state.workspaces.find((x) => x.id === e.target.closest('[data-ws]')?.dataset.ws)
    if (!w) return
    e.preventDefault()
    e.stopPropagation()
    const others = state.workspaces.length > 1
    popMenu({ x: e.clientX, y: e.clientY }, [
      { head: wsLabel(w) },
      ...(w.current && !w.parked ? [] : [{ label: w.current ? 'Wake it' : 'Switch to it', icon: ICONS.arrow, act: 'switch', ...(w.parked && { hint: 'wakes it up' }) }]),
      ...(w.current ? [{ label: 'Who works here…', icon: ICONS.subs, act: 'members' }] : []),
      ...(others && !w.parked ? [{ label: 'Put to sleep', icon: ICONS.moon, act: 'park', hint: 'stops its agents' }] : []),
      ...(w.folder && FOLDER_APP ? [{ label: OPEN_FOLDER, icon: ICONS.folder, act: 'folder' }] : []),
      { label: 'Settings…', icon: ICONS.gear, act: 'settings' },
      '-',
      w.ownerName ? { label: 'Hide on this computer…', icon: ICONS.close, act: 'remove' } : { label: 'Remove…', icon: ICONS.trash, act: 'remove', danger: true },
    ], (act) => {
      if (act === 'switch') onSwitch(w.id)
      if (act === 'members') onMembers?.(e.target.closest('[data-ws]'))
      if (act === 'park') park(w)
      if (act === 'folder') openFolder(w)
      if (act === 'settings') openSheet(w.id)
      if (act === 'remove') remove(w)
    })
  })
  // Drag a workspace up or down the rail to move it: a line shows where it lands.
  const marks = () => dock.querySelectorAll('.drop-before, .drop-after')
  dock.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.rail-ws')
    if (!el) return e.preventDefault()
    dragging = el.dataset.ws
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-clique-workspace', dragging)
    el.classList.add('dragging')
  })
  const target = (e) => {
    const el = e.target.closest('.rail-ws')
    if (!el || !dragging || el.dataset.ws === dragging) return null // back where it was: nowhere to move to
    const r = el.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    return { el, after }
  }
  dock.addEventListener('dragover', (e) => {
    const t = target(e)
    for (const x of marks()) if (x !== t?.el) x.classList.remove('drop-before', 'drop-after') // the line is only where it'd land
    if (!t) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
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
      await clique.call('workspace', 'order', null, ids)
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
  // on the document too: the tile you started from may be gone by the time you let go
  document.addEventListener('dragend', endDrag)
  document.addEventListener('drop', endDrag)
  dock.addEventListener('dragleave', (e) => !dock.contains(e.relatedTarget) && marks().forEach((x) => x.classList.remove('drop-before', 'drop-after')))

  // ---- the banner over a workspace that's asleep: what wakes it, and no button for it ----------------------

  // A joined workspace whose owner is off gets one too: its chat, tasks and agents are on that computer.
  function drawBanner() {
    const w = state.workspace
    const parked = Boolean(w?.parked)
    const away = Boolean(w?.ownerName && !w.ownerOnline)
    document.body.classList.toggle('ws-parked', parked)
    banner.classList.toggle('hidden', !parked && !away)
    if (!parked && !away) return
    banner.style.setProperty('--w', wsColor(w) ?? 'var(--fg3)')
    morph(banner, parked
      ? `${wsTile(w, { size: 30 })}
      <div class="grow"><b>${esc(w.name)} is asleep</b><span>Its agents are stopped. Send a message and they wake up where they left off.</span></div>`
      : `${wsTile(w, { size: 30 })}
      <div class="grow"><b>${esc(w.ownerName)} is offline</b><span>${esc(w.name)} is ${esc(w.ownerName)}'s: its chat, tasks and agents are back when that computer is on.</span></div>`)
  }

  // ---- the sheet: a new workspace, or one's settings -------------------------------------------------------

  let draft = null // { id, name, color, icon, folder, members: Set, folders: {} }
  let before = null // the workspace as it was, when changing one

  dialog.innerHTML = `
    <header class="ws-hero">
      <span class="ws-hero-tile"></span>
      <div class="ws-hero-main">
        <input class="ws-title" data-ws-name placeholder="Name it" spellcheck="false" maxlength="40" autocomplete="off">
        <span class="ws-hero-sub"></span>
      </div>
      <button type="button" class="icon sheet-x" data-close aria-label="Close">${ICONS.close}</button>
    </header>
    <div class="sheet-body ws-body">
      <section class="ws-sec">
        <h4 class="section-label">Look</h4>
        <div class="ws-swatches" role="radiogroup" aria-label="Color"></div>
        <div class="ws-icons" role="radiogroup" aria-label="Icon"></div>
      </section>
      <section class="ws-sec" data-sec="folder">
        <h4 class="section-label">Folder</h4>
        <div class="mv-field field"><input data-ws-folder class="mono" placeholder="~/code/my-app" spellcheck="false" autocomplete="off"><button type="button" class="btn" data-ws-pick>Choose…</button></div>
        <p class="ws-note">Where its agents work, unless one has a folder of its own here.</p>
      </section>
      <section class="ws-sec" data-sec="clique">
        <h4 class="section-label"><span data-clique-title>Who works here</span><small class="ws-count"></small></h4>
        <ul class="ws-clique"></ul>
        <p class="ws-note" data-clique-note></p>
      </section>
    </div>
    <p class="err" data-ws-err></p>
    <div class="sheet-foot">
      <button type="button" class="btn danger" data-ws-remove>${ICONS.trash}<span>Remove workspace…</span></button>
      <span class="grow"></span>
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="button" class="btn primary" data-ws-save></button>
    </div>`
  const $d = (s) => dialog.querySelector(s)

  function openSheet(id) {
    const w = id ? state.workspaces.find((x) => x.id === id) : null
    before = w
    draft = {
      id: w?.id ?? null, name: w?.name ?? '', color: w?.color ?? (w ? '' : freshColor()), icon: w?.icon ?? '', folder: w?.folder ?? '',
      members: new Set(w?.members?.map((m) => m.name) ?? []),
      folders: Object.fromEntries((w?.members ?? []).filter((m) => m.folder).map((m) => [m.name, m.folder])),
    }
    $d('[data-ws-name]').value = draft.name
    $d('[data-ws-folder]').value = tilde(draft.folder)
    $d('[data-ws-remove]').classList.toggle('hidden', !w)
    $d('[data-ws-remove] span').textContent = w?.ownerName ? 'Hide on this computer…' : 'Remove workspace…'
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

  // clique: the list of agents too (typing a name or a folder leaves it be)
  function drawSheet({ clique: list = true } = {}) {
    const look = { id: draft.id ?? 'new', name: draft.name || 'New workspace', color: draft.color, icon: draft.icon }
    $d('.ws-hero-tile').innerHTML = wsTile(look, { size: 58, cls: 'hero' })
    dialog.style.setProperty('--hero', wsColor(look) ?? 'var(--fg3)')
    const roster = state.roster ?? []
    const members = roster.filter((a) => draft.members.has(a.name))
    $d('.ws-hero-sub').innerHTML = members.length ? `${faceStack(members, 6)}<span>${plural(members.length, 'agent')}${draft.folder ? ` · ${esc(shortPath(draft.folder))}` : ''}</span>` : `<span>${draft.id ? 'No shared agents here yet' : 'A new workspace'}</span>`
    $d('.ws-swatches').innerHTML = `<button type="button" class="ws-sw none ${draft.color ? '' : 'on'}" data-ws-color="" title="No color" role="radio" aria-checked="${!draft.color}"></button>` +
      WS_COLORS.map((c) => `<button type="button" class="ws-sw ${draft.color === c ? 'on' : ''}" data-ws-color="${c}" style="--w:${COLORS[c]}" title="${c}" role="radio" aria-checked="${draft.color === c}"></button>`).join('')
    $d('.ws-icons').innerHTML = `<button type="button" class="ws-ic letter ${draft.icon ? '' : 'on'}" data-ws-icon="" title="Its initial" role="radio" aria-checked="${!draft.icon}">${esc((draft.name.trim()[0] ?? 'A').toUpperCase())}</button>` +
      WS_ICONS.map((i) => `<button type="button" class="ws-ic ${draft.icon === i ? 'on' : ''}" data-ws-icon="${i}" role="radio" aria-checked="${draft.icon === i}">${i}</button>`).join('')
    $d('[data-sec=clique]').classList.toggle('hidden', !roster.length)
    $d('.ws-count').textContent = roster.length ? `${draft.members.size} of ${roster.length}` : ''
    if (list) drawClique(roster)
  }

  // Who's in it (the switches), and a folder of its own there for any of them.
  function drawClique(roster) {
    $d('.ws-clique').innerHTML = roster.map((a) => {
      const on = draft.members.has(a.name)
      const own = draft.folders[a.name]
      const tip = own ? `Works in ${esc(own)} here. Click to change` : "Give it a folder of its own here, instead of the workspace's"
      return `<li class="ws-agent ${on ? 'in' : ''}" data-agent="${esc(a.name)}" style="--c:${agentColor(a)}">
        <span class="ws-av">${avatarHTML(a, { size: 30, mood: on ? undefined : 'still' })}</span>
        <span class="who"><b>${esc(shownName(a.name))}</b><small>${esc(a.area || 'no area')}</small></span>
        ${on ? `<button type="button" class="ws-own ${own ? 'set' : ''}" data-ws-own="${esc(a.name)}" title="${tip}">${ICONS.folder}<span>${own ? esc(tilde(own)) : 'Own folder'}</span></button>` : ''}
        <input type="checkbox" class="switch sm" data-ws-member="${esc(a.name)}" ${on ? 'checked' : ''} aria-label="${esc(a.name)} works here">
      </li>`
    }).join('')
    $d('[data-clique-note]').textContent = draft.id
        ? 'Who an agent is (its job, brain and look) is the same in every workspace; where it works and whether it’s on is each workspace’s. Agents only this workspace needs: make them with New agent while you’re in it.'
        : 'Your agents bring who they are (job, brain, look) and start fresh conversations here. Agents only this workspace needs: make them with New agent once you’re in it.'
  }

  dialog.addEventListener('input', (e) => {
    if (e.target.matches('[data-ws-name]')) {
      draft.name = e.target.value
      drawSheet({ clique: false })
    }
    if (e.target.matches('[data-ws-folder]')) {
      draft.folder = e.target.value
      drawSheet({ clique: false })
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
      own.outerHTML = `<input class="ws-own-input field mono" data-ws-own-input="${esc(name)}" value="${esc(tilde(draft.folders[name] ?? ''))}" placeholder="${esc(tilde(draft.folder) || '~/code/…')}" spellcheck="false">`
      const input = dialog.querySelector(`[data-ws-own-input="${CSS.escape(name)}"]`)
      input.focus()
      input.addEventListener('keydown', (k) => k.key === 'Enter' && (k.preventDefault(), setOwn(input)))
      input.addEventListener('blur', () => input.isConnected && setOwn(input))
      return
    }
    if (t.closest('[data-ws-pick]')) {
      const dir = await clique.call('pickFolder').catch(() => null)
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
      const where = draft.folder.trim() ? await clique.call('folderInfo', '', draft.folder.trim()) : null
      if (where && !where.exists) throw new Error(`There's no folder ${tildePath(where.path)}`)
      if (!draft.id) {
        const { state: next } = await clique.call('workspace', 'create', null, { ...look, members: [...draft.members], folders: draft.folders })
        dialog.close()
        onSwitched(next)
      } else {
        const id = draft.id
        // folders that changed, checked first: an agent can't start in one that isn't there
        const folders = Object.fromEntries([...draft.members].map((n) => [n, draft.folders[n] ?? '']).filter(([n, f]) => f !== (before.members.find((m) => m.name === n)?.folder ?? '')))
        for (const f of Object.values(folders).filter(Boolean)) {
          const there = await clique.call('folderInfo', '', f)
          if (!there.exists) throw new Error(`There's no folder ${tilde(there.path)}`)
        }
        await clique.call('workspace', 'edit', id, look)
        const was = new Set(before.members.map((m) => m.name))
        await clique.call('workspace', 'members', id, { add: [...draft.members].filter((n) => !was.has(n)), remove: [...was].filter((n) => !draft.members.has(n)), folders })
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
    if (w.ownerName && !confirm(`Hide ${w.name} on this computer?\n\nIt's hosted on ${w.ownerName}, and stays there with its chat, tasks and agents. Any of your agents you added to it stop here. Show it again from the workspace menu, under On your other computers.`)) return
    if (!w.ownerName && !confirm(`Remove ${w.name}?\n\nIts agents stop and it leaves the switcher.${own > 0 ? ` ${plural(own, 'agent')} of its own ${own > 1 ? 'go' : 'goes'} with it.` : ''} Your shared agents stay in your clique.\n\nIts chat, notes and tasks are kept on disk: a workspace made again with the same name picks them back up.`)) return
    try {
      await clique.call('workspace', 'remove', w.id)
      if (dialog.open) dialog.close()
    } catch (x) {
      if (dialog.open) $d('[data-ws-err]').textContent = errorLine(x)
      else oops(`Couldn't ${w.ownerName ? 'leave' : 'remove'} ${wsLabel(w)}`, x)
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
    settings: (id) => openSheet(id ?? state.workspace?.id ?? null),
  }
}

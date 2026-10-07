// Shared rendering for the three views. Plain functions and template strings; views re-render on every state push.
/* global crew, avatarHTML, agentColor */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const svg = (paths, attrs = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${attrs}>${paths}</svg>`

// Crew's mark: three little mochis in a huddle. Eyes are evenodd holes, so the same shape works as the
// menu bar template icon; each buddy is its own path (.m0 .m1 .m2) so CSS can make them hop in turn.
function markSVG(viewBox = '0 0 24 24') {
  const n = (v) => +v.toFixed(2)
  const hole = (x, y, r) => `M${n(x - r)} ${n(y)}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0 ${n(-2 * r)} 0Z`
  const mochi = (cx, w, h, rc, eye, gap, tilt) => {
    const by = 21, l = cx - w / 2, r = cx + w / 2, t = by - h, ey = by - h * 0.42
    const d = `M${n(l)} ${n(by - rc)}C${n(l)} ${n(by - h * 0.78)} ${n(cx - w * 0.33)} ${n(t)} ${n(cx)} ${n(t)}C${n(cx + w * 0.33)} ${n(t)} ${n(r)} ${n(by - h * 0.78)} ${n(r)} ${n(by - rc)}Q${n(r)} ${by} ${n(r - rc)} ${by}L${n(l + rc)} ${by}Q${n(l)} ${by} ${n(l)} ${n(by - rc)}Z`
    return { d: d + hole(cx - gap, ey, eye) + hole(cx + gap, ey, eye), t: tilt ? `rotate(${tilt} ${cx} ${by})` : '' }
  }
  const buddies = [mochi(3.85, 7.3, 6.6, 2.3, 0.72, 1.3, 4), mochi(12, 9.4, 9.4, 2.8, 1, 1.75, 0), mochi(20.15, 7.3, 6.6, 2.3, 0.72, 1.3, -4)]
  return `<svg viewBox="${viewBox}" fill="currentColor" class="mark">${buddies
    .map((b, i) => `<path class="m${i}" fill-rule="evenodd"${b.t ? ` transform="${b.t}"` : ''} d="${b.d}"/>`)
    .join('')}</svg>`
}

const ICONS = {
  mark: markSVG(),
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  auto: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>'),
  braces: svg('<path d="M8.5 4C6.6 4 6 5 6 6.8v2.4C6 10.6 5.2 11.6 4 12c1.2.4 2 1.4 2 2.8v2.4C6 19 6.6 20 8.5 20M15.5 4c1.9 0 2.5 1 2.5 2.8v2.4c0 1.4.8 2.4 2 2.8-1.2.4-2 1.4-2 2.8v2.4c0 1.8-.6 2.8-2.5 2.8"/>'),
  power: svg('<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>'),
  restart: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 'stroke-width="2.4"'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>', 'stroke-width="2.4"'),
}

// Update el's children to match html without recreating unchanged nodes. Avatars (data-sig) are left alone
// unless their look or mood changed, so their animations don't restart on every status tick.
function morph(el, html) {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  patchChildren(el, tpl.content)
}

function patchChildren(parent, next) {
  const olds = [...parent.childNodes]
  const news = [...next.childNodes]
  news.forEach((n, i) => {
    const o = olds[i]
    if (!o) return parent.appendChild(n)
    const same = o.nodeName === n.nodeName && o.dataset?.sig === n.dataset?.sig && o.dataset?.agent === n.dataset?.agent && o.dataset?.name === n.dataset?.name
    if (!same) return parent.replaceChild(n, o)
    if (o.nodeType === Node.TEXT_NODE) {
      if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue
      return
    }
    if (o.nodeType !== Node.ELEMENT_NODE || o.dataset.sig) return
    for (const { name } of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name)
    for (const { name, value } of [...n.attributes]) if (o.getAttribute(name) !== value) o.setAttribute(name, value)
    if (o.type === 'checkbox') o.checked = n.hasAttribute('checked')
    patchChildren(o, n)
  })
  for (let i = olds.length - 1; i >= news.length; i--) olds[i].remove()
}

// 42s · 3m 10s · 2h 05m
function duration(ms) {
  const s = Math.round((ms ?? 0) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return m < 10 ? `${m}m ${s % 60}s` : `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// Experience: 10 XP per finished task plus 1 per active minute. Level n needs 25·(n-1)² XP.
function levelOf(stats = {}) {
  const xp = (stats.turns ?? 0) * 10 + Math.floor((stats.activeMs ?? 0) / 60000)
  const lv = Math.floor(Math.sqrt(xp / 25)) + 1
  const from = 25 * (lv - 1) ** 2
  const to = 25 * lv ** 2
  return { lv, xp, toNext: to - xp, progress: (xp - from) / (to - from) }
}

// "Claude · opus · high"
const brainLabel = (a, providers = {}) => [providers[a.provider]?.label ?? a.provider, a.model || 'default', a.effort, a.fast && 'fast'].filter(Boolean).join(' · ')

const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}

function ago(ts) {
  const s = (Date.now() - ts) / 1000
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function statusText(a) {
  switch (a.status) {
    case 'working': return `working · ${ago(a.since)}`
    case 'waiting': return 'needs you'
    case 'idle': return 'free'
    case 'starting': return Date.now() - a.since > 15000 ? 'starting… check its terminal' : 'starting…'
    case 'off': return 'off'
    default: return 'exited'
  }
}

function yoloBox(a) {
  const tip = a.pending ? 'Restarts in YOLO mode as soon as it is free' : 'Skip all permission prompts (--dangerously-skip-permissions)'
  return `<label class="yolo" title="${tip}"><input type="checkbox" data-yolo="${esc(a.name)}" ${a.yolo ? 'checked' : ''}>YOLO</label>`
}

// Codex agents only: its fast service tier.
const fastBox = (a) =>
  a.fast === undefined ? '' : `<label class="yolo fast" title="Codex fast mode (the fast service tier)"><input type="checkbox" data-fast="${esc(a.name)}" ${a.fast ? 'checked' : ''}>FAST</label>`

function powerSwitch(a) {
  const busy = a.status === 'working' || a.status === 'waiting'
  return `<input type="checkbox" class="switch sm" data-power="${esc(a.name)}" ${busy ? 'data-busy' : ''} ${a.on ? 'checked' : ''} title="${a.on ? 'Turn off (stays off after restarts)' : 'Turn on (resumes its session)'}">`
}

function agentCard(a, providers) {
  const more = a.on && (a.activity || a.queue)
  return `<div class="agent hop ${a.on ? '' : 'off'}" data-agent="${esc(a.name)}">
    <div class="row">${avatarHTML(a, { size: 40 })}<div class="ident"><span class="name">${esc(a.name)}</span><span class="model">${esc(brainLabel(a, providers))}</span></div><span class="grow"></span>${powerSwitch(a)}</div>
    <div class="row meta"><span class="area" title="${esc(a.area)}">${esc(a.area || 'no area set')}</span><span class="state ${a.status}">${esc(statusText(a))}${a.pending ? ' · restarts when free' : ''}</span>${fastBox(a)}${yoloBox(a)}</div>
    <div class="bar ${a.status}" style="--c:${agentColor(a)}"><i></i></div>
    ${more ? `<div class="row meta"><span class="activity">${esc(a.activity)}</span>${a.queue ? `<span>${a.queue} queued</span>` : ''}</div>` : ''}
  </div>`
}

// Just enough Markdown for agent replies: code, bold/italic/strike, headings, lists, quotes and links.
// The text is escaped first, so whatever an agent writes can't inject HTML.
function md(src) {
  const blocks = []
  const text = esc(src).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`) - 1}\u0000`)
  const inline = (line) => {
    const codes = []
    return line
      .replace(/`([^`]+)`/g, (_, c) => `\u0001${codes.push(c) - 1}\u0001`)
      .replace(/\*\*(?=\S)(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(?=\S)(.+?)__/g, '<b>$1</b>')
      .replace(/(^|[\s(])[*_](?=\S)([^*_]+?)[*_](?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]*[^\s<).,!?:;])/g, '$1<a href="$2">$2</a>')
      .replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${codes[i]}</code>`)
  }
  let html = ''
  let list = null
  let para = []
  const flush = () => {
    if (para.length) html += `<p>${para.map(inline).join('<br>')}</p>`
    para = []
  }
  const close = () => {
    if (list) html += `</${list}>`
    list = null
  }
  const item = (tag, body) => {
    flush()
    if (list !== tag) {
      close()
      html += `<${tag}>`
      list = tag
    }
    html += `<li>${inline(body)}</li>`
  }
  for (const line of text.split('\n')) {
    let m
    if (/^\s*\u0000\d+\u0000\s*$/.test(line)) (flush(), close(), (html += line.trim()))
    else if ((m = line.match(/^(#{1,4})\s+(.*)/))) (flush(), close(), (html += `<h4>${inline(m[2])}</h4>`))
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) item('ul', m[1])
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) item('ol', m[1])
    else if ((m = line.match(/^&#62;\s?(.*)/))) (flush(), close(), (html += `<blockquote>${inline(m[1])}</blockquote>`))
    else if (!line.trim()) (flush(), close())
    else (close(), para.push(line))
  }
  flush()
  close()
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i])
}

// One line of a message, for "replying to" quotes.
const snippet = (text) => String(text ?? '').replace(/```[\s\S]*?```/g, '[code]').replace(/[*_`#>~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90)

function feedItem(e, prev, ctx) {
  const { byName, byId, repliesTo, open } = ctx
  const agent = (n) => byName[n] ?? { name: n }
  const who = (n) => (n === 'you' ? 'you' : `<span class="who" data-agent="${esc(n)}" style="color:${agentColor(agent(n))}">@${esc(n)}</span>`)
  const time = new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const repeat = prev && prev.kind === e.kind && prev.from === e.from && prev.to === e.to && e.ts - prev.ts < 120000 && !e.re
  const tags = (e.queued ? '<span class="tag">queued</span>' : '') + (e.held ? '<span class="tag">needs your OK</span>' : '') + (e.via === 'terminal' ? '<span class="tag">in terminal</span>' : '')
  const pics = e.images?.length ? `<div class="pics">${e.images.map((p) => `<img src="${fileURL(p)}" data-open="${esc(p)}" alt="" title="Open image">`).join('')}</div>` : ''
  // A reply quotes the message it answers; click to jump back to it.
  const orig = e.re && byId[e.re]
  const quote = orig ? `<button class="quote" data-jump="${orig.id}" title="Jump to the message this answers">↩ ${orig.from === 'you' ? 'you' : `@${esc(orig.from)}`}: ${esc(snippet(orig.text))}</button>` : ''
  // ...and a message you sent links forward to the agents' replies.
  const answers = repliesTo[e.id] ?? []
  const replied = answers.length
    ? `<button class="replied" data-jump="${answers[0].id}" title="Jump to the reply">↪ ${[...new Set(answers.map((r) => `@${esc(r.from)}`))].join(', ')} ${answers.some((r) => r.kind === 'reply') ? 'replied' : 'handed it on'}</button>`
    : ''
  const bubble = `${quote}${pics}<div class="bubble ${open.has(e.id) ? 'open' : ''}" data-id="${e.id}">${md(e.text)}</div>`
  const cap = (html) => (repeat && !tags ? '' : `<div class="cap">${html}${tags}</div>`)
  // Agents talk with their little face next to the bubble, like a group chat.
  const said = (cls, capHTML, rest = '', style = '') =>
    `<div class="item said ${cls}" id="m-${e.id}" style="${style}" title="${time}"><span class="face" data-agent="${esc(e.from)}">${repeat ? '' : avatarHTML(agent(e.from), { size: 30, mood: 'still' })}</span><div class="stack">${cap(capHTML)}${bubble}${rest}${replied}</div></div>`

  if (e.kind === 'event') return `<div class="event ${e.alert ? 'alert' : ''}" id="m-${e.id}" title="${time}">${who(e.from)} ${esc(e.text)}</div>`
  if (e.kind === 'note') return said('note', `${who(e.from)} shared a note`)
  if (e.kind === 'reply') return said('', who(e.from))
  if (e.from === 'you') return `<div class="item me" id="m-${e.id}" title="${time}">${cap(`to ${who(e.to)}`)}${bubble}${replied}</div>`
  const actions = e.held
    ? `<div class="actions"><button class="btn primary" data-act="approve" data-id="${e.id}">Send it</button><button class="btn" data-act="drop" data-id="${e.id}">Drop</button></div>`
    : ''
  return said(`handoff ${e.dropped ? 'dropped' : ''}`, `${who(e.from)} → ${who(e.to)}`, actions, `--c:${agentColor(agent(e.from))}`)
}

function mountFeed(el, { onAgent, limit = 200 } = {}) {
  const open = new Set()
  let key = ''
  const jump = (id) => {
    const target = el.querySelector(`#m-${CSS.escape(id)}`)
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target.classList.remove('flash')
    void target.offsetWidth // restart the flash animation
    target.classList.add('flash')
  }
  el.addEventListener('click', (ev) => {
    const link = ev.target.closest('a[href]')
    if (link) {
      ev.preventDefault()
      return crew.call('openUrl', link.href)
    }
    const to = ev.target.closest('[data-jump]')
    if (to) return jump(to.dataset.jump)
    const agent = ev.target.closest('[data-agent]')
    if (agent) return onAgent?.(agent.dataset.agent)
    const act = ev.target.closest('[data-act]')
    if (act) return crew.call(act.dataset.act, act.dataset.id)
    const pic = ev.target.closest('[data-open]')
    if (pic) return crew.call('openFile', pic.dataset.open)
    const more = ev.target.closest('[data-more]')
    if (more) return toggle(el.querySelector(`.bubble[data-id="${CSS.escape(more.dataset.more)}"]`))
    const bubble = ev.target.closest('.bubble.long')
    if (bubble && !getSelection().toString()) toggle(bubble)
  })
  const toggle = (bubble) => {
    if (!bubble) return
    bubble.classList.toggle('open')
    open[open.has(bubble.dataset.id) ? 'delete' : 'add'](bubble.dataset.id)
    measure()
  }
  // Long messages fold with a fade and a "Show more" button. Measured whenever the feed is visible and changes
  // size (a hidden chat panel has no layout, so it's measured again when it opens).
  const measure = () => {
    for (const b of el.querySelectorAll('.bubble')) {
      if (!b.offsetParent) continue
      const long = b.scrollHeight > parseFloat(getComputedStyle(b).fontSize) * 22 + 4
      b.classList.toggle('long', long)
      let more = b.nextElementSibling?.matches('.more') ? b.nextElementSibling : null
      if (long && !more) {
        b.insertAdjacentHTML('afterend', `<button class="more" data-more="${b.dataset.id}"></button>`)
        more = b.nextElementSibling
      }
      if (!long) more?.remove()
      else more.textContent = b.classList.contains('open') ? 'Show less' : 'Show more'
    }
  }
  new ResizeObserver(() => measure()).observe(el)
  return {
    render({ feed, agents }) {
      const items = feed.slice(-limit)
      const next = items.map((e) => e.id + (e.queued ? 'q' : '') + (e.held ? 'h' : '') + (e.dropped ? 'd' : '')).join() + JSON.stringify(agents.map((a) => [a.name, a.avatar]))
      if (next === key) return
      key = next
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      const ctx = { byName: Object.fromEntries(agents.map((a) => [a.name, a])), byId: Object.fromEntries(feed.map((e) => [e.id, e])), repliesTo: {}, open }
      for (const e of feed) if (e.re) (ctx.repliesTo[e.re] ??= []).push(e)
      el.innerHTML = items.length
        ? items.map((e, i) => feedItem(e, items[i - 1], ctx)).join('')
        : '<div class="empty">Tasks, hand-offs and replies show up here.</div>'
      measure()
      if (atBottom) el.scrollTop = el.scrollHeight
    },
  }
}

const fileURL = (p) => `file://${String(p).split('/').map(encodeURIComponent).join('/')}`
const isImage = (f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type)

// Images for a prompt: paste them, drop them, or pick them with the button. Each is saved under
// ~/.crew/attachments and reaches the agent as a file path it can open.
function mountAttach({ zone, field, tray, button, onChange, onError }) {
  let paths = []
  const picker = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true })
  button.after(picker)
  const draw = (notify = true) => {
    tray.innerHTML = paths.map((p, i) => `<span class="thumb"><img src="${fileURL(p)}" data-open="${esc(p)}" alt=""><button type="button" data-rm="${i}" title="Remove">×</button></span>`).join('')
    tray.classList.toggle('hidden', !paths.length)
    if (notify) onChange?.([...paths])
  }
  const add = async (files) => {
    const images = files.filter(isImage)
    if (files.length && !images.length) return onError?.('Only PNG, JPEG, GIF and WebP images')
    for (const f of images) {
      try {
        paths.push(await crew.call('saveImage', f.name, f.type, new Uint8Array(await f.arrayBuffer())))
      } catch (e) {
        onError?.(e.message)
      }
    }
    draw()
  }
  const dragging = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')
  zone.addEventListener('dragover', (e) => {
    if (!dragging(e)) return
    e.preventDefault()
    zone.classList.add('dropping')
  })
  zone.addEventListener('dragleave', (e) => zone.contains(e.relatedTarget) || zone.classList.remove('dropping'))
  zone.addEventListener('drop', (e) => {
    zone.classList.remove('dropping')
    if (!dragging(e)) return
    e.preventDefault()
    add([...e.dataTransfer.files])
  })
  field.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter(isImage)
    if (!files.length) return
    e.preventDefault()
    add(files)
  })
  button.addEventListener('click', () => picker.click())
  picker.addEventListener('change', () => {
    add([...picker.files])
    picker.value = ''
  })
  tray.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]')
    if (rm) {
      paths.splice(Number(rm.dataset.rm), 1)
      return draw()
    }
    const pic = e.target.closest('[data-open]')
    if (pic) crew.call('openFile', pic.dataset.open)
  })
  draw(false)
  return {
    get: () => [...paths],
    set: (list, notify = true) => {
      paths = [...(list ?? [])]
      draw(notify)
    },
  }
}

function mountComposer(el, { dropZone = el } = {}) {
  el.classList.add('composer')
  el.innerHTML = `<div class="chips"></div>
    <div class="thumbs hidden"></div>
    <div class="input"><button class="attach" title="Add images (you can also paste or drop them)">+</button><textarea rows="1"></textarea><button class="send" disabled title="Send (Enter)">${ICONS.up}</button></div>
    <div class="hint"></div>`
  const chips = el.querySelector('.chips')
  const ta = el.querySelector('textarea')
  const send = el.querySelector('.send')
  const hint = el.querySelector('.hint')
  let target = store.get('crew.target') || 'auto'
  let agents = []
  const attach = mountAttach({
    zone: dropZone,
    field: ta,
    tray: el.querySelector('.thumbs'),
    button: el.querySelector('.attach'),
    onChange: () => autosize(),
    onError: (msg) => say(msg, true),
  })

  const draw = () => {
    if (target !== 'auto' && agents.length && !agents.some((a) => a.on && a.name === target)) target = 'auto'
    morph(chips,
      `<button class="chip ${target === 'auto' ? 'on' : ''}" data-to="auto" title="Picks by area, prefers whoever is free">✦ Auto</button>` +
      agents.filter((a) => a.on).map((a) => `<button class="chip ${target === a.name ? 'on' : ''}" data-to="${esc(a.name)}" title="${esc(statusText(a))}">${avatarHTML(a, { size: 20 })}${esc(a.name)}</button>`).join(''))
    ta.placeholder = target === 'auto' ? 'Describe a task, crew picks who' : `Message @${target}…`
  }
  const autosize = () => {
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
    ta.style.overflowY = ta.scrollHeight > 160 ? 'auto' : 'hidden'
    send.disabled = !ta.value.trim() && !attach?.get().length
  }
  const say = (text, error = false) => {
    hint.textContent = text
    hint.className = `hint ${error ? 'error' : ''}`
    clearTimeout(say.timer)
    say.timer = setTimeout(() => (hint.textContent = ''), 4000)
  }
  const setTarget = (name) => {
    target = name
    store.set('crew.target', name)
    draw()
  }
  const submit = async () => {
    const text = ta.value.trim()
    const images = attach.get()
    if (!text && !images.length) return
    const to = target === 'auto' || /^@[\w-]+\s/.test(text) ? undefined : target
    try {
      say((await crew.call('send', to, text, images)).trim())
      ta.value = ''
      attach.set([])
      autosize()
    } catch (e) {
      say(e.message, true)
    }
  }

  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-to]')
    if (!chip) return
    setTarget(chip.dataset.to)
    ta.focus()
  })
  ta.addEventListener('input', autosize)
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  })
  send.addEventListener('click', submit)
  draw()

  return {
    render(state) {
      agents = state.agents
      draw()
    },
    setTarget,
    focus: () => ta.focus(),
  }
}

// Agent cards appear on several views; one listener handles their YOLO checkbox and on/off switch.
document.addEventListener('change', (e) => {
  const { yolo, power, fast } = e.target.dataset ?? {}
  if (yolo) crew.call('update', yolo, { yolo: e.target.checked })
  if (fast) crew.call('update', fast, { tier: e.target.checked ? 'fast' : 'default' })
  if (!power) return
  if (!e.target.checked && 'busy' in e.target.dataset && !confirm(`${power} is in the middle of something. Turn it off anyway?`)) {
    e.target.checked = true
    return
  }
  crew.call('update', power, { off: !e.target.checked })
})

// Theme button: Auto (follow macOS) → Light → Dark. Saved in config.json, applied to every window.
const THEMES = { system: ['auto', 'Theme: follows macOS'], light: ['sun', 'Theme: light'], dark: ['moon', 'Theme: dark'] }
const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' }
function themeButton(btn) {
  let theme = 'system'
  btn.addEventListener('click', () => crew.call('theme', NEXT_THEME[theme]))
  return (next) => {
    theme = next ?? 'system'
    const [icon, label] = THEMES[theme]
    btn.innerHTML = ICONS[icon]
    btn.title = `${label} (click for ${NEXT_THEME[theme] === 'system' ? 'auto' : NEXT_THEME[theme]})`
  }
}

// Every view: fetch state once, then re-render on pushes and every 15s so "working · 3m" stays fresh.
async function live(render) {
  let state = await crew.call('state')
  render(state)
  crew.onState((next) => render((state = next)))
  setInterval(() => render(state), 15000)
}

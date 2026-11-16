// Files in the chat: what an agent attached to a message (core/attachments.js: pictures, a recording, a page it built,
// any file), drawn under what it said, and the viewer a picture, a recording or a page opens into. Loaded after
// common.js, by the pages that show a chat (dashboard.html, overlay.html).
//
// A page (HTML) is never put into this page: it's shown in a sandboxed frame whose address is clique-sandbox://…
// (core/sandbox.js), still until you press Run. A recording never plays by itself. What's playing or running is carried
// across the chat's redraws as it is (fxHold), so a new message doesn't stop it.
/* global clique, esc, fileURL, svg, ICONS, popMenu, oops, notify */

const FX_ICONS = {
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>'),
  video: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M10.2 9.4v5.2l4.4-2.6z" fill="currentColor"/>'),
  html: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17M10 12.5l-2 2 2 2M14 12.5l2 2-2 2"/>'),
  file: svg('<path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M14 3.5V8h4"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6a.7.7 0 0 0 1.07.6l10.7-6.8a.7.7 0 0 0 0-1.2L9.07 4.6A.7.7 0 0 0 8 5.2z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  more: svg('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
  prev: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  minus: svg('<path d="M6 12h12"/>'),
  plus: svg('<path d="M12 6v12M6 12h12"/>'),
  open: svg('<path d="M13 5h6v6M19 5l-8 8M10 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V14"/>'),
  folder: svg('<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17z"/>'),
}

// What "Open" hands to the system's own app: things that are looked at (core/attachments.js OPENS, which decides; a test
// keeps the two the same). Anything else is only shown in its folder.
const FX_OPENS = /\.(png|jpe?g|gif|webp|svg|avif|bmp|mp4|m4v|mov|webm|html?|pdf|txt|log|md|json|csv|xml|mp3|wav|har|diff|patch|ya?ml)$/i
const FX_FOLDER = () => (clique.platform === 'win32' ? 'Show in Explorer' : 'Show in Finder')

function fxSize(n) {
  if (!(n >= 0)) return ''
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) (v /= 1024), u++
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`
}
function fxTime(s) {
  const n = Math.max(0, Math.round(s))
  const two = (x) => String(x).padStart(2, '0')
  return n >= 3600 ? `${Math.floor(n / 3600)}:${two(Math.floor(n / 60) % 60)}:${two(n % 60)}` : `${Math.floor(n / 60)}:${two(n % 60)}`
}
const fxExt = (f) => (/\.([A-Za-z0-9]{1,8})$/.exec(f.name ?? f.path ?? '')?.[1] ?? '').toUpperCase()
// "Video · 0:12 · 2.1 MB", "HTML · 14 KB", "PDF · 1.2 MB"
function fxMeta(f, { dims = false } = {}) {
  const kind = f.kind === 'video' ? 'Video' : f.kind === 'html' ? 'HTML' : fxExt(f) || 'File'
  return [kind, dims && f.w && f.h && `${f.w}×${f.h}`, f.dur && fxTime(f.dur), fxSize(f.size), f.away ? `on ${f.away}` : f.home ? `from ${f.home}` : ''].filter(Boolean).join(' · ')
}
const fxClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const fxSandbox = (file, run) => `clique-sandbox://page/?f=${encodeURIComponent(file)}${run ? '&run=1' : ''}`

// The files of the messages on screen, by message id: what a click looks up.
const fxKnown = new Map()
function fxRemember(id, files) {
  fxKnown.delete(id)
  fxKnown.set(id, files)
  if (fxKnown.size > 600) fxKnown.delete(fxKnown.keys().next().value)
}
// Your own pictures on a message open in the same viewer.
const fxOwn = (images) => images.map((p) => ({ path: p, kind: 'image', name: String(p).split(/[\\/]/).pop() }))
function fxPics(e) {
  fxRemember(`${e.id}:own`, fxOwn(e.images))
  return `<div class="pics">${e.images.map((p, i) => `<img src="${fileURL(p)}" data-fx="view" data-id="${esc(e.id)}:own" data-i="${i}" tabindex="0" role="button" alt="" title="Look closer">`).join('')}</div>`
}

// A message's files, under what it says. Every box is its final size from the start (the sizes were read when the file
// was attached), so nothing moves when a picture or a recording loads.
function filesHTML(e) {
  const files = e.files ?? []
  if (!files.length) return ''
  fxRemember(e.id, files)
  const at = (i) => `data-id="${esc(e.id)}" data-i="${i}"`
  const pics = files.map((f, i) => ({ f, i })).filter(({ f }) => f.kind === 'image' && f.path)
  const one = pics.length === 1
  const gallery = pics.length
    ? `<div class="fx-pics${one ? ' one' : ''}">${pics.map(({ f, i }) => {
        const ratio = fxClamp((f.w || 4) / (f.h || 3), 0.4, 3)
        // one picture: as big as 360 × 260 lets it be; several: a row of tiles, all the same height
        const w = one ? Math.round(Math.min(360, 260 * ratio, f.w || 360)) : Math.round(fxClamp(140 * ratio, 64, 240))
        const h = one ? Math.round(w / ratio) : 140
        return `<button type="button" class="fx-pic" data-fx="view" ${at(i)} style="width:${w}px;aspect-ratio:${w}/${h}" title="${esc(f.name)}"><img src="${fileURL(f.path)}" alt="${esc(f.name)}" draggable="false" loading="lazy"></button>`
      }).join('')}</div>`
    : ''
  const cards = files.map((f, i) => (f.kind === 'image' && f.path ? '' : fxCard(e.id, f, i, at(i)))).join('')
  return `<div class="files">${gallery}${cards}</div>`
}

function fxCard(id, f, i, at) {
  const head = (tools = '') => `<div class="fx-head"><span class="fx-icon">${FX_ICONS[f.kind] ?? FX_ICONS.file}</span><span class="fx-what"><b class="fx-name" title="${esc(f.name)}">${esc(f.name)}</b><small>${esc(fxMeta(f))}</small></span><span class="fx-tools">${tools}</span></div>`
  const tool = (act, icon, title) => `<button type="button" class="btn sm square" data-fx="${act}" ${at} title="${esc(title)}" aria-label="${esc(title)}">${icon}</button>`
  const more = tool('more', FX_ICONS.more, 'More')
  // on a linked computer, and not something that's fetched (a recording, any other file): the card says where it is
  if (!f.path) return `<div class="fx-card away">${head()}<p class="fx-note">Kept on ${esc(f.away ?? 'another computer')}. Open it there.</p></div>`
  if (f.kind === 'video') {
    const ratio = fxClamp((f.w || 16) / (f.h || 9), 0.75, 2.5)
    const w = Math.round(fxClamp(280 * ratio, 240, 440))
    return `<div class="fx-card fx-video" data-live="${esc(id)}:${i}" style="width:${w}px">${head(tool('view', FX_ICONS.expand, 'Open in the viewer') + more)}<div class="fx-stage" style="aspect-ratio:${ratio}"><video src="${fileURL(f.path)}#t=0.01" preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate nofullscreen noremoteplayback" ${at}></video><button type="button" class="fx-play" data-fx="play" ${at} aria-label="Play ${esc(f.name)}">${FX_ICONS.play}</button>${f.dur ? `<span class="fx-dur">${fxTime(f.dur)}</span>` : ''}</div></div>`
  }
  if (f.kind === 'html')
    return `<div class="fx-card fx-page" data-live="${esc(id)}:${i}">${head(`<span class="fx-running">Running</span>${tool('stop', FX_ICONS.stop, 'Stop the page')}${tool('view', FX_ICONS.expand, 'Open in the viewer')}${more}`)}<div class="fx-stage"><iframe class="fx-frame still" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" tabindex="-1" title="${esc(f.name)}, not running" src="${esc(fxSandbox(f.path, false))}"></iframe><button type="button" class="fx-run btn" data-fx="run" ${at}>${FX_ICONS.play}<span>Run page</span></button></div></div>`
  const acts = `${FX_OPENS.test(f.path) ? `<button type="button" class="btn sm" data-fx="open" ${at}>Open</button>` : ''}<button type="button" class="btn sm" data-fx="show" ${at}>${FX_FOLDER()}</button>`
  return `<div class="fx-card fx-file">${head(acts)}</div>`
}

// ---- what's playing or running stays so through a redraw ----------------------------------------------------------

// Before a chat is drawn again: what's live in it (a recording that was started, a page that's running) is set aside
// as it is. -> a function that puts each back where the new drawing has its box. (moveBefore moves a frame or a video
// without reloading or pausing it.)
function fxHold(root) {
  const live = [...root.querySelectorAll('[data-live].on')]
  if (!live.length) return () => {}
  let shelf = document.getElementById('fx-shelf')
  if (!shelf) {
    shelf = Object.assign(document.createElement('div'), { id: 'fx-shelf', hidden: true })
    document.body.append(shelf)
  }
  const move = (parent, node, before = null) => (parent.moveBefore ? parent.moveBefore(node, before) : parent.insertBefore(node, before))
  for (const node of live) move(shelf, node)
  return () => {
    for (const node of live) {
      const now = root.querySelector(`[data-live="${CSS.escape(node.dataset.live)}"]`)
      if (!now) {
        node.remove()
        continue
      }
      move(now.parentNode, node, now)
      now.remove()
    }
  }
}

const fxFile = (el) => {
  const at = el.closest('[data-id][data-i]')
  const files = at && fxKnown.get(at.dataset.id)
  return files ? { files, i: Number(at.dataset.i), f: files[Number(at.dataset.i)], id: at.dataset.id } : null
}

// Plays the recording where it is: from then on it has the usual controls (pause, the bar, the time, sound).
// A recording out of sight stops: the chat scrolled away from it, or the floating chat was closed over it.
let fxSeen = null
function fxPlay(card) {
  const video = card.querySelector('video')
  fxSeen ??= new IntersectionObserver((all) => {
    for (const it of all) if (!it.isIntersecting && it.target.isConnected && !it.target.closest('#fx-shelf')) it.target.pause()
  })
  fxSeen.observe(video)
  card.classList.add('on')
  video.controls = true
  video.play().catch(() => {})
  video.focus({ preventScroll: true })
}

// Runs the page, in its sandbox, in the box the still preview was in.
function fxRun(card, f) {
  const frame = card.querySelector('.fx-frame')
  card.classList.remove('left')
  card.classList.add('on')
  frame.classList.remove('still')
  frame.removeAttribute('tabindex')
  frame.title = f.name
  frame.src = fxSandbox(f.path, true)
}
function fxStop(card, f, { left = false } = {}) {
  const frame = card.querySelector('.fx-frame')
  card.classList.remove('on')
  card.classList.toggle('left', left)
  frame.classList.add('still')
  frame.tabIndex = -1
  frame.title = `${f.name}, not running`
  frame.src = fxSandbox(f.path, false)
}

async function fxOpen(f, how = 'openFile') {
  try {
    const out = await clique.call(how, f.path)
    if (out === 'shown') notify(`${f.name} is shown in its folder: opening it would run it.`)
  } catch (err) {
    oops(`Couldn't open ${f.name}`, err, '')
  }
}

function fxMenu(at, f) {
  popMenu(at, [
    ...(FX_OPENS.test(f.path) ? [{ act: 'openFile', label: f.kind === 'html' ? 'Open in your browser' : 'Open', icon: FX_ICONS.open }] : []),
    { act: 'showFile', label: FX_FOLDER(), icon: FX_ICONS.folder },
    { act: 'copy', label: 'Copy its path', icon: ICONS.copy },
  ], (act) => (act === 'copy' ? clique.call('copy', f.path) : fxOpen(f, act)))
}

// ---- the viewer ---------------------------------------------------------------------------------------------------

// One at a time, over the whole window: a picture fitted to it (click or + / − to zoom), a recording, a page running in
// its sandbox. ← → go through the message's files, Esc closes, and the keyboard goes back to what opened it.
let fxViewer = null
const fxViews = (files) => files.map((f, i) => ({ f, i })).filter(({ f }) => f.path && (f.kind === 'image' || f.kind === 'video' || f.kind === 'html'))

function fxView(id, i, opener) {
  const files = fxKnown.get(id)
  const views = files && fxViews(files)
  if (!views?.length) return
  fxViewer?.close()
  // the floating chat is too small a window to look closer in: the main window shows it
  if (document.documentElement.dataset.fxElsewhere) return clique.call('dashboard', `file:${JSON.stringify({ files, i })}`)
  const el = document.createElement('div')
  el.className = 'fxv'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  const btn = (act, icon, title, cls = 'btn square') => `<button type="button" class="${cls}" data-fxv="${act}" title="${esc(title)}" aria-label="${esc(title)}">${icon}</button>`
  el.innerHTML = `<div class="fxv-bar"><span class="fx-icon"></span><span class="fx-what"><b class="fx-name"></b><small></small></span><span class="fxv-count"></span>
    <span class="fxv-zoom">${btn('out', FX_ICONS.minus, 'Zoom out (−)')}<button type="button" class="btn fxv-pct" data-fxv="fit" title="Fit to the window (0)"></button>${btn('in', FX_ICONS.plus, 'Zoom in (+)')}</span>
    <button type="button" class="btn" data-fxv="open">${FX_ICONS.open}<span>Open</span></button><button type="button" class="btn" data-fxv="show">${FX_ICONS.folder}<span>${FX_FOLDER()}</span></button>${btn('close', FX_ICONS.close, 'Close (Esc)')}</div>
    <div class="fxv-stage"></div>${btn('prev', FX_ICONS.prev, 'Previous (←)', 'fxv-nav prev')}${btn('next', FX_ICONS.next, 'Next (→)', 'fxv-nav next')}`
  const stage = el.querySelector('.fxv-stage')
  let at = Math.max(0, views.findIndex((v) => v.i === i))
  let zoom = null // a picture's size as a share of its own; null: fitted to the window
  let img = null
  let natural = null
  const fit = () => (natural ? Math.min(1, (stage.clientWidth - 48) / natural.w, (stage.clientHeight - 48) / natural.h) : 1)
  const size = () => {
    if (!img || !natural) return
    const z = zoom ?? fit()
    img.style.width = `${Math.max(1, Math.round(natural.w * z))}px`
    img.style.height = `${Math.max(1, Math.round(natural.h * z))}px`
    el.querySelector('.fxv-pct').textContent = zoom === null ? 'Fit' : `${Math.round(z * 100)}%`
    stage.classList.toggle('zoomed', zoom !== null && z > fit())
  }
  const zoomTo = (z) => ((zoom = z === null ? null : fxClamp(z, 0.05, 8)), size())
  const show = () => {
    const { f } = views[at]
    // (what was showing ends: a recording stops, a page's frame goes)
    stage.replaceChildren()
    stage.className = `fxv-stage ${f.kind}`
    img = natural = zoom = null
    el.setAttribute('aria-label', f.name)
    el.querySelector('.fx-icon').innerHTML = FX_ICONS[f.kind]
    el.querySelector('.fx-name').textContent = f.name
    el.querySelector('.fx-what small').textContent = fxMeta(f, { dims: true })
    el.querySelector('.fxv-count').textContent = views.length > 1 ? `${at + 1} of ${views.length}` : ''
    el.classList.toggle('alone', views.length < 2)
    el.querySelector('[data-fxv=open] span').textContent = f.kind === 'html' ? 'Open in your browser' : 'Open'
    if (f.kind === 'image') {
      img = Object.assign(document.createElement('img'), { alt: f.name, draggable: false })
      if (f.w && f.h) natural = { w: f.w, h: f.h }
      img.addEventListener('load', () => ((natural ??= { w: img.naturalWidth || 300, h: img.naturalHeight || 150 }), size()))
      img.addEventListener('error', () => stage.replaceChildren(fxGone(f)))
      img.src = fileURL(f.path)
      stage.append(img)
      size()
    } else if (f.kind === 'video') {
      const video = Object.assign(document.createElement('video'), { controls: true, playsInline: true, disablePictureInPicture: true })
      video.setAttribute('controlslist', 'nodownload noremoteplayback')
      // it carries on from where the one in the message was, playing if that one was (which stops)
      const inline = opener?.closest?.('.fx-video')?.querySelector('video')
      const from = inline && !inline.error ? { t: inline.currentTime, playing: !inline.paused } : { t: 0, playing: false }
      inline?.pause()
      video.addEventListener('error', () => stage.replaceChildren(fxGone(f, "This recording can't play here.")))
      video.src = `${fileURL(f.path)}#t=${Math.max(0.01, from.t)}`
      if (from.playing) video.play().catch(() => {})
      stage.append(video)
    } else {
      const frame = Object.assign(document.createElement('iframe'), { className: 'fx-frame', title: f.name, referrerPolicy: 'no-referrer' })
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.src = fxSandbox(f.path, true)
      stage.append(frame)
    }
  }
  const go = (d) => {
    if (views.length < 2) return
    at = (at + d + views.length) % views.length
    show()
  }
  const close = () => {
    if (fxViewer?.el !== el) return
    fxViewer = null
    removeEventListener('keydown', keys, true)
    removeEventListener('resize', size)
    // a recording goes back to the message where this one got to
    const video = stage.querySelector('video')
    const inline = opener?.isConnected ? opener.closest('.fx-video')?.querySelector('video') : null
    if (video && inline && views[at].f === fxFile(inline)?.f && Number.isFinite(video.currentTime)) inline.currentTime = video.currentTime
    el.remove()
    // (the chat may have been drawn again meanwhile: the same button, where it is now)
    const back = opener?.isConnected ? opener : opener?.dataset?.id ? document.querySelector(`[data-fx="${opener.dataset.fx}"][data-id="${CSS.escape(opener.dataset.id)}"][data-i="${opener.dataset.i}"]`) : null
    back?.focus({ preventScroll: true })
  }
  const keys = (ev) => {
    if (ev.isComposing) return
    const k = ev.key
    const typing = ev.target instanceof HTMLVideoElement // the recording's own keys (space, the arrows) are its own
    if (k === 'Escape') close()
    else if (k === 'ArrowLeft' && !typing) go(-1)
    else if (k === 'ArrowRight' && !typing) go(1)
    else if ((k === '+' || k === '=') && img) zoomTo((zoom ?? fit()) * 1.25)
    else if (k === '-' && img) zoomTo((zoom ?? fit()) / 1.25)
    else if (k === '0' && img) zoomTo(null)
    else if (k === 'Tab') {
      // the keyboard stays in the viewer while it's open
      const stops = [...el.querySelectorAll('button, video, iframe')].filter((b) => b.offsetParent)
      const here = stops.indexOf(document.activeElement)
      const to = stops[(here + (ev.shiftKey ? -1 : 1) + stops.length) % stops.length]
      if (to?.tagName === 'IFRAME' || document.activeElement?.tagName === 'IFRAME') return // into the page and out of it: the browser's own order
      to?.focus()
    } else return
    ev.preventDefault()
    ev.stopPropagation()
  }
  el.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-fxv]')?.dataset.fxv
    const { f } = views[at]
    if (act === 'close') close()
    else if (act === 'prev') go(-1)
    else if (act === 'next') go(1)
    else if (act === 'in') zoomTo((zoom ?? fit()) * 1.25)
    else if (act === 'out') zoomTo((zoom ?? fit()) / 1.25)
    else if (act === 'fit') zoomTo(null)
    else if (act === 'open') fxOpen(f)
    else if (act === 'show') fxOpen(f, 'showFile')
    else if (act === 'again') show()
    // a click on the picture: its real size, and back; beside it: closed
    else if (ev.target === img) zoomTo(zoom === null ? (fit() < 1 ? 1 : 2) : null)
    else if (ev.target === stage) close()
  })
  addEventListener('keydown', keys, true)
  addEventListener('resize', size)
  document.body.append(el)
  fxViewer = { el, close, stage, left: () => stage.replaceChildren(fxGone(views[at].f, 'This page tried to go somewhere else, so it was stopped.', true)) }
  show()
  el.querySelector('[data-fxv=close]').focus()
}

function fxGone(f, words = "This file isn't kept any more.", again = false) {
  const el = document.createElement('div')
  el.className = 'fx-gone'
  el.innerHTML = `<span class="fx-icon">${FX_ICONS[f.kind] ?? FX_ICONS.file}</span><p>${esc(words)}</p>${again ? '<button type="button" class="btn" data-fxv="again" data-fx="again">Run it again</button>' : ''}`
  return el
}

// ---- clicks, keys, and what the frames and files say -------------------------------------------------------------

if (typeof document !== 'undefined' && typeof clique !== 'undefined') {
  // (first, so a click on a file is never also a click on the message around it)
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest?.('[data-fx]')
    if (!el || el.closest('.fxv')) return
    const hit = fxFile(el)
    if (!hit?.f) return
    ev.preventDefault()
    ev.stopPropagation()
    const { f, i, id } = hit
    const card = el.closest('.fx-card')
    const act = el.dataset.fx
    if (act === 'view') fxView(id, i, el)
    else if (act === 'play') fxPlay(card)
    else if (act === 'run') fxRun(card, f)
    else if (act === 'stop') fxStop(card, f)
    else if (act === 'more') fxMenu(el, f)
    else if (act === 'open') fxOpen(f)
    else if (act === 'show') fxOpen(f, 'showFile')
  }, true)
  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('img[data-fx]')) (ev.preventDefault(), ev.target.click())
  })
  // A picture or a recording that won't load. One from a linked computer may still be on its way: it's tried again a
  // few times first. A recording Chromium can't play keeps its box, with the ways to open it elsewhere.
  document.addEventListener('error', (ev) => {
    const el = ev.target
    if (!(el instanceof HTMLElement) || !el.closest('.files')) return
    const hit = fxFile(el.closest('[data-id][data-i]') ?? el)
    if (!hit?.f) return
    if (el.tagName === 'IMG') {
      const tries = Number(el.dataset.tries ?? 0)
      if (hit.f.home && tries < 5) return void setTimeout(() => ((el.dataset.tries = tries + 1), (el.src = `${fileURL(hit.f.path)}?again=${tries + 1}`)), 1200)
      el.closest('.fx-pic')?.classList.add('gone')
    } else if (el.tagName === 'VIDEO') {
      const card = el.closest('.fx-card')
      if (card.classList.contains('cant')) return
      card.classList.add('cant')
      card.classList.remove('on')
      const stage = card.querySelector('.fx-stage')
      const note = fxGone(hit.f, el.error?.code === 4 || el.error?.code === 3 ? "This recording can't play here." : "This file isn't kept any more.")
      if (el.error?.code === 4 || el.error?.code === 3) note.insertAdjacentHTML('beforeend', `<span class="fx-acts"><button type="button" class="btn sm" data-fx="open" data-id="${esc(hit.id)}" data-i="${hit.i}">Open</button><button type="button" class="btn sm" data-fx="show" data-id="${esc(hit.id)}" data-i="${hit.i}">${FX_FOLDER()}</button></span>`)
      stage.replaceChildren(note)
    }
  }, true)
  // What a sandbox's shell says (core/sandbox.js), and only that: the page in it tried to leave, or Esc was pressed in it.
  addEventListener('message', (ev) => {
    if (ev.data !== 'clique:leave' && ev.data !== 'clique:esc') return
    const frame = [...document.querySelectorAll('iframe.fx-frame')].find((f) => f.contentWindow === ev.source)
    if (!frame) return
    const inViewer = fxViewer && fxViewer.el.contains(frame)
    if (ev.data === 'clique:esc') return inViewer ? fxViewer.close() : frame.blur()
    if (inViewer) return fxViewer.left()
    const hit = fxFile(frame.closest('.fx-card').querySelector('[data-fx=run]'))
    if (hit?.f && frame.closest('.fx-card').classList.contains('on')) fxStop(frame.closest('.fx-card'), hit.f, { left: true })
  })
}

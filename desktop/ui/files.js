// Files in the chat: what an agent attached to a message (core/attachments.js: pictures, a recording, a page it built,
// any file), drawn under what it said, and the viewer a picture, a recording or a page opens into. Loaded after
// common.js, by the pages that show a chat (dashboard.html, overlay.html).
//
// A page (HTML) is never put into this page: it's shown in a sandboxed frame whose address is clique-sandbox://…
// (core/sandbox.js), still until you press Run. A recording never plays by itself; it has a player of its own (fxPlayer),
// the same one in the message, in the viewer and on the whole screen. What's playing or running is carried across the
// chat's redraws as it is (fxHold), so a new message doesn't stop it.
//
// A file from a linked computer is kept in this computer's cache of them, and comes from that computer a piece at a time
// as it's shown, played or opened (core/linkfiles.js; fileURL in common.js gives it its clique-file:// address).
/* global clique, esc, fileURL, svg, ICONS, popMenu, oops, notify */

const FX_ICONS = {
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>'),
  video: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M10.2 9.4v5.2l4.4-2.6z" fill="currentColor"/>'),
  html: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17M10 12.5l-2 2 2 2M14 12.5l2 2-2 2"/>'),
  file: svg('<path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M14 3.5V8h4"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6a.7.7 0 0 0 1.07.6l10.7-6.8a.7.7 0 0 0 0-1.2L9.07 4.6A.7.7 0 0 0 8 5.2z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  again: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4h4"/>'),
  sound: svg('<path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" fill="currentColor"/><path d="M14.5 9a4 4 0 0 1 0 6M17 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" fill="currentColor"/><path d="M15 9.5l5 5M20 9.5l-5 5"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  unfull: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
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
// A linked computer's file being brought here because you asked to open it: path -> { have, size, shown }. Its card
// says how far it is (fxOpen).
const fxGetting = new Map()
// "Video · 0:12 · 2.1 MB", "HTML · 14 KB", "PDF · 1.2 MB · from Workstation"; while it's being brought: "Getting it from
// Workstation · 42%"
function fxMeta(f, { dims = false } = {}) {
  const coming = f.path && fxGetting.get(f.path)
  if (coming?.shown) return `Getting it from ${f.home ?? 'its computer'}${coming.size ? ` · ${Math.min(99, Math.floor((100 * coming.have) / coming.size))}%` : ''}`
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
  // on a linked computer whose CLIque can't send it here (one from before files came a piece at a time): the card says where it is
  if (!f.path) return `<div class="fx-card away">${head()}<p class="fx-note">Kept on ${esc(f.away ?? 'another computer')}. Open it there.</p></div>`
  if (f.kind === 'video') {
    const ratio = fxClamp((f.w || 16) / (f.h || 9), 0.75, 2.5)
    const w = Math.round(fxClamp(280 * ratio, 240, 440))
    return `<div class="fx-card fx-video" data-live="${esc(id)}:${i}" style="width:${w}px">${head(tool('view', FX_ICONS.expand, 'Open in the viewer') + more)}<div class="fx-stage" style="aspect-ratio:${ratio}">${fxPlayerHTML(f, at)}</div></div>`
  }
  if (f.kind === 'html')
    return `<div class="fx-card fx-page" data-live="${esc(id)}:${i}">${head(`<span class="fx-running">Running</span>${tool('stop', FX_ICONS.stop, 'Stop the page')}${tool('view', FX_ICONS.expand, 'Open in the viewer')}${more}`)}<div class="fx-stage"><iframe class="fx-frame still" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" tabindex="-1" title="${esc(f.name)}, not running" src="${esc(fxSandbox(f.path, false))}"></iframe><button type="button" class="fx-run btn" data-fx="run" ${at}>${FX_ICONS.play}<span>Run page</span></button></div></div>`
  const busy = fxGetting.has(f.path) ? ' disabled' : ''
  const acts = `${FX_OPENS.test(f.path) ? `<button type="button" class="btn sm" data-fx="open" ${at}${busy}>Open</button>` : ''}<button type="button" class="btn sm" data-fx="show" ${at}${busy}>${FX_FOLDER()}</button>`
  return `<div class="fx-card fx-file">${head(acts)}</div>`
}

// ---- the player ----------------------------------------------------------------------------------------------------

// A recording's player, as it's written into a message and into the viewer: the picture (its first frame until it's
// played), a Play button over it, and the controls, which show once it has been started. fxPlayer() makes it work, the
// first time the pointer or the keyboard comes to it.
//
//   the bar      play / pause · where it is, of how long · the track (what has played, what's here to play, drag or click
//                to go there, a look at any moment under the pointer) · sound (only for one that has any) · speed · full
//                screen. It goes when the pointer has been still for a moment or has left, so the picture is all there is.
//   the keys     Space or K play/pause · ← → 5 s · J L 10 s · , . one frame · < > slower, faster · ↑ ↓ and M sound ·
//                0–9 tenths of it · Home End · F full screen
function fxPlayerHTML(f, at = '') {
  const dur = f.dur ? fxTime(f.dur) : ''
  const btn = (act, inner, title, cls = '') => `<button type="button" class="fxp-btn${cls ? ` ${cls}` : ''}" data-fxp="${act}" title="${esc(title)}" aria-label="${esc(title)}">${inner}</button>`
  return `<div class="fxp${f.sound === false ? ' silent' : ''}" ${at} tabindex="0" role="group" aria-label="${esc(`Recording: ${f.name}`)}" style="--ratio:${(f.w || 16) / (f.h || 9)}">` +
    `<video src="${fileURL(f.path)}#t=0.01" preload="metadata" playsinline disablepictureinpicture tabindex="-1"></video>` +
    `<button type="button" class="fxp-big" data-fxp="toggle" tabindex="-1" aria-label="Play ${esc(f.name)}">${FX_ICONS.play}</button>` +
    (dur ? `<span class="fxp-badge">${dur}</span>` : '') +
    `<i class="fxp-wait"></i><b class="fxp-flash"></b><span class="fxp-top">${esc(f.name)}</span><i class="fxp-line"><i></i></i>` +
    `<div class="fxp-bar">` +
    `<div class="fxp-track" data-fxp="track" role="slider" tabindex="0" aria-label="Where it is" aria-valuemin="0" aria-valuemax="${Math.round(f.dur || 0)}" aria-valuenow="0" aria-valuetext="0:00${dur ? ` of ${dur}` : ''}"><span class="fxp-rail"><i class="fxp-buf"></i><i class="fxp-fill"></i></span><i class="fxp-at"><i class="fxp-knob"></i></i></div>` +
    `<div class="fxp-row">${btn('toggle', FX_ICONS.play, 'Play (Space)', 'fxp-toggle')}<span class="fxp-time"><b>0:00</b><i>${dur ? ` / ${dur}` : ''}</i></span><span class="fxp-gap"></span>` +
    `<span class="fxp-vol">${btn('mute', FX_ICONS.sound, 'Mute (M)', 'fxp-mute')}<input type="range" class="fxp-level" data-fxp="level" min="0" max="1" step="0.05" value="1" aria-label="Volume"></span>` +
    `${btn('rate', '1×', 'Speed (< and >)', 'fxp-rate')}${btn('full', `${FX_ICONS.full}${FX_ICONS.unfull}`, 'Full screen (F)', 'fxp-full')}</div>` +
    `</div>` +
    `<span class="fxp-tip"><video muted playsinline disablepictureinpicture preload="none" tabindex="-1"></video><b></b></span>` +
    `</div>`
}

const FXP_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const fxRateWords = (r) => `${r}×`
// The speed you chose stays for the recordings you play next, until CLIque is closed; how loud stays for good.
let fxRate = 1
const fxSound = {
  read() {
    try {
      const s = JSON.parse(localStorage.getItem('clique.fx.sound') ?? '{}')
      return { level: Number.isFinite(s.level) ? fxClamp(s.level, 0, 1) : 1, muted: Boolean(s.muted) }
    } catch {
      return { level: 1, muted: false }
    }
  },
  save(level, muted) {
    try {
      localStorage.setItem('clique.fx.sound', JSON.stringify({ level, muted }))
    } catch {}
  },
}
// Where each recording got to, so it carries on from there when it's played again in this run of the app (by its path).
const fxSpots = new Map()
let fxNowPlaying = null // one recording plays at a time
let fxByKeys = false // the keyboard was used last, not the pointer: a control it's on stays in view
let fxTries = 0 // every try at a file that didn't load is under an address of its own

const fxMove = (parent, node, before = null) => {
  try {
    if (parent.moveBefore) return parent.moveBefore(node, before)
  } catch {}
  parent.insertBefore(node, before)
}

const fxPlayers = new WeakMap()
// The player of a .fxp element (made the first time it's asked for): { play, pause, toggle, seek, key, … }.
function fxPlayer(root) {
  const known = fxPlayers.get(root)
  if (known) return known
  const video = root.querySelector(':scope > video')
  const q = (sel) => root.querySelector(sel)
  const track = q('.fxp-track')
  const tip = q('.fxp-tip')
  const look = tip.querySelector('video')
  const level = q('.fxp-level')
  const file = () => fxFile(root)?.f
  const length = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : file()?.dur || 0)
  let dragging = null // { resume }: the track is being dragged; it plays on after if it was playing
  let wanted = null // while dragging or jumping: where it's going, shown at once (the picture follows)
  let asked = null // ...and the place the picture was last sent to
  let overBar = false
  let menu = null
  let idle = 0
  let waiting = 0
  let frame = 0

  // ---- what shows ----
  const paint = () => {
    const d = length()
    const t = wanted ?? video.currentTime
    const p = d ? fxClamp(t / d, 0, 1) : 0
    q('.fxp-fill').style.transform = `scaleX(${p})`
    q('.fxp-line > i').style.transform = `scaleX(${p})`
    q('.fxp-at').style.transform = `translateX(${p * 100}%)`
    q('.fxp-time b').textContent = fxTime(t)
    if (d) q('.fxp-time i').textContent = ` / ${fxTime(d)}`
    track.setAttribute('aria-valuemax', String(Math.round(d)))
    track.setAttribute('aria-valuenow', String(Math.round(t)))
    track.setAttribute('aria-valuetext', `${fxTime(t)}${d ? ` of ${fxTime(d)}` : ''}`)
  }
  // what's here to play: every stretch of it, as bands on the track (a recording from a linked computer fills in as it comes)
  const paintHere = () => {
    const d = length()
    const b = video.buffered
    if (!d || !b.length) return void (q('.fxp-buf').style.background = 'none')
    const stops = []
    for (let i = 0; i < b.length; i++) {
      const from = ((100 * b.start(i)) / d).toFixed(2)
      const to = ((100 * Math.min(d, b.end(i))) / d).toFixed(2)
      stops.push(`transparent ${from}%`, `var(--fxp-here) ${from}%`, `var(--fxp-here) ${to}%`, `transparent ${to}%`)
    }
    q('.fxp-buf').style.background = `linear-gradient(to right, ${stops.join(', ')})`
  }
  const tick = () => {
    paint()
    frame = video.paused || video.ended ? 0 : requestAnimationFrame(tick)
  }
  const state = () => {
    const playing = !video.paused && !video.ended
    root.classList.toggle('playing', playing)
    root.classList.toggle('ended', video.ended)
    const b = q('.fxp-toggle')
    const words = video.ended ? 'Play again (Space)' : playing ? 'Pause (Space)' : 'Play (Space)'
    b.innerHTML = video.ended ? FX_ICONS.again : playing ? FX_ICONS.pause : FX_ICONS.play
    b.title = words
    b.setAttribute('aria-label', words.replace(' (Space)', ''))
    if (playing && !frame) frame = requestAnimationFrame(tick)
    paint()
  }
  const sound = () => {
    const off = video.muted || video.volume === 0
    const b = q('.fxp-mute')
    b.innerHTML = off ? FX_ICONS.muted : FX_ICONS.sound
    b.title = off ? 'Unmute (M)' : 'Mute (M)'
    b.setAttribute('aria-label', off ? 'Unmute' : 'Mute')
    level.value = String(off ? 0 : video.volume)
    level.style.setProperty('--at', `${(off ? 0 : video.volume) * 100}%`)
  }
  const rateShown = () => {
    q('.fxp-rate').textContent = fxRateWords(video.playbackRate)
    q('.fxp-rate').classList.toggle('set', video.playbackRate !== 1)
  }
  // a word in the middle for what a key just did, where the bar may not be showing
  const say = (words) => {
    const el = q('.fxp-flash')
    el.textContent = words
    el.classList.remove('show')
    void el.offsetWidth
    el.classList.add('show')
  }

  // ---- the bar comes and goes ----
  const wake = (ms = 2600) => {
    root.classList.remove('idle')
    clearTimeout(idle)
    idle = setTimeout(() => {
      // not while it's in use: dragged, its speeds open, the pointer on it, a control of it holding the keyboard, or at the end
      if (!root.isConnected || !root.classList.contains('on')) return
      if (dragging || menu || overBar || video.ended || (fxByKeys && q('.fxp-bar').contains(document.activeElement))) return wake(ms)
      root.classList.add('idle')
      hideTip()
    }, ms)
  }

  // ---- playing ----
  // Once it knows what it is (how long, what shape): at once, when it does already. (A place set before that, Chromium
  // never gets round to loading it at all.)
  const loaded = (fn) => (video.readyState >= 1 ? fn() : video.addEventListener('loadedmetadata', fn, { once: true }))
  const start = () => {
    if (root.classList.contains('on')) return
    root.classList.add('on')
    root.closest('.fx-card')?.classList.add('on')
    const s = fxSound.read()
    video.volume = s.level
    video.muted = s.muted
    video.playbackRate = fxRate
    sound()
    rateShown()
    // it carries on from where it was left, unless that was the end
    const spot = fxSpots.get(file()?.path)
    if (spot > 1) loaded(() => spot < length() - 1 && video.currentTime < 0.5 && wanted === null && (video.currentTime = spot))
    fxSeen ??= new IntersectionObserver((all) => {
      // out of sight (the chat scrolled away from it, the floating chat closed over it), it stops
      for (const it of all) if (!it.isIntersecting && it.target.isConnected && !it.target.closest('#fx-shelf, .fxv') && document.fullscreenElement !== it.target.parentNode) it.target.pause()
    })
    fxSeen.observe(video)
    wake()
  }
  const play = () => {
    start()
    if (video.ended) video.currentTime = 0
    video.play().catch(() => {})
    wake()
  }
  const pause = () => video.pause()
  const toggle = () => (video.paused || video.ended ? play() : pause())
  const seek = (t, { quiet = false } = {}) => {
    const d = length()
    if (!d) return
    t = fxClamp(t, 0, d)
    wanted = t
    // (one jump at a time: while the picture is still getting to the last one, the newest waits its turn)
    loaded(() => !video.seeking && wanted !== null && (video.currentTime = asked = wanted))
    paint()
    if (!quiet) wake()
  }
  const skip = (s) => {
    start()
    seek((wanted ?? video.currentTime) + s)
    say(`${s > 0 ? '+' : '−'}${Math.abs(s)} s`)
  }
  const step = (dir) => {
    start()
    pause()
    seek((wanted ?? video.currentTime) + dir / 30)
  }
  const setRate = (r, { tell = true } = {}) => {
    fxRate = video.playbackRate = r
    rateShown()
    if (tell) say(fxRateWords(r))
  }
  const setLevel = (v, { tell = true } = {}) => {
    video.volume = fxClamp(v, 0, 1)
    video.muted = video.volume === 0
    fxSound.save(video.volume || 0.5, video.muted)
    if (tell) say(video.muted ? 'Muted' : `Sound ${Math.round(video.volume * 100)}%`)
  }
  const mute = ({ tell = true } = {}) => {
    video.muted = !(video.muted || video.volume === 0)
    if (!video.muted && video.volume === 0) video.volume = 0.5
    fxSound.save(video.volume, video.muted)
    if (tell) say(video.muted ? 'Muted' : 'Sound on')
  }
  const hasSound = () => !root.classList.contains('silent')
  const full = () => {
    // the floating chat is too small a window to fill the screen from: the main window shows it
    if (document.documentElement.dataset.fxElsewhere) return void q('.fxp-full').dispatchEvent(new CustomEvent('fx-elsewhere', { bubbles: true }))
    if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {})
    else {
      start()
      root.requestFullscreen().catch(() => {})
    }
  }

  // ---- its speeds ----
  const closeMenu = (focus = false) => {
    if (!menu) return
    menu.remove()
    menu = null
    root.classList.remove('speeds')
    q('.fxp-rate').setAttribute('aria-expanded', 'false')
    if (focus) q('.fxp-rate').focus({ preventScroll: true })
  }
  const openMenu = () => {
    if (menu) return closeMenu()
    menu = document.createElement('div')
    menu.className = 'fxp-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', 'Speed')
    menu.innerHTML = FXP_RATES.map((r) => `<button type="button" role="menuitemradio" aria-checked="${r === video.playbackRate}" data-fxp="pick" data-rate="${r}">${fxRateWords(r)}</button>`).join('')
    root.append(menu)
    // (a press anywhere else closes it)
    const outside = (ev) => {
      if (!menu || root.contains(ev.target)) return
      removeEventListener('pointerdown', outside, true)
      closeMenu()
    }
    addEventListener('pointerdown', outside, true)
    root.classList.add('speeds')
    q('.fxp-rate').setAttribute('aria-expanded', 'true')
    ;(menu.querySelector('[aria-checked=true]') ?? menu.firstChild).focus({ preventScroll: true })
    wake()
  }

  // ---- a look at any moment, under the pointer on the track ----
  let lookAt = null
  const hideTip = () => root.classList.remove('tip')
  const showTip = (x) => {
    const d = length()
    if (!d) return
    const r = track.getBoundingClientRect()
    const box = root.getBoundingClientRect()
    const t = fxClamp((x - r.left) / r.width, 0, 1) * d
    tip.querySelector('b').textContent = fxTime(t)
    root.classList.add('tip')
    const w = tip.offsetWidth
    tip.style.transform = `translateX(${Math.round(fxClamp(x - box.left - w / 2, 6, box.width - w - 6))}px)`
    if (!look.getAttribute('src')) {
      look.src = video.currentSrc.replace(/#.*$/, '')
      look.preload = 'auto'
      look.addEventListener('seeked', () => {
        tip.classList.add('seen')
        if (lookAt !== null && Math.abs(lookAt - look.currentTime) > 0.05) look.currentTime = lookAt
      })
      look.addEventListener('loadedmetadata', () => (look.currentTime = lookAt), { once: true })
      look.addEventListener('error', () => tip.classList.add('blind'))
    }
    lookAt = t
    if (!look.seeking && look.readyState >= 1) look.currentTime = t
  }
  const timeAt = (x) => {
    const r = track.getBoundingClientRect()
    return fxClamp((x - r.left) / r.width, 0, 1) * length()
  }

  // ---- the keys ----
  // -> whether the key was one of its own
  const key = (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing || root.classList.contains('cant')) return false
    const k = ev.key
    // (a key the viewer passes on, pressed with the keyboard somewhere else in it, counts as pressed on the player)
    const on = ev.target instanceof Element && root.contains(ev.target) ? ev.target : root
    // a control of its own that has the keyboard keeps the keys that are its own
    if ((k === ' ' || k === 'Enter') && on.closest('button, input')) return false
    if (on === level && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return false
    if (menu && menu.contains(on)) {
      const all = [...menu.children]
      if (k === 'ArrowRight' || k === 'ArrowDown') all[(all.indexOf(on) + 1) % all.length].focus()
      else if (k === 'ArrowLeft' || k === 'ArrowUp') all[(all.indexOf(on) - 1 + all.length) % all.length].focus()
      else if (k === 'Escape') closeMenu(true)
      else return false
      return true
    }
    if (k === 'Escape') {
      if (!menu) return false
      closeMenu(true)
    } else if (k === ' ' || k === 'k' || k === 'K') toggle()
    else if (k === 'ArrowLeft') skip(-5)
    else if (k === 'ArrowRight') skip(5)
    else if (k === 'j' || k === 'J') skip(-10)
    else if (k === 'l' || k === 'L') skip(10)
    else if (k === ',') step(-1)
    else if (k === '.') step(1)
    else if (k === '<' || k === '>') {
      const i = FXP_RATES.indexOf(video.playbackRate)
      setRate(FXP_RATES[fxClamp((i < 0 ? 2 : i) + (k === '>' ? 1 : -1), 0, FXP_RATES.length - 1)])
    } else if ((k === 'ArrowUp' || k === 'ArrowDown') && hasSound()) setLevel((video.muted ? 0 : video.volume) + (k === 'ArrowUp' ? 0.1 : -0.1))
    else if ((k === 'm' || k === 'M') && hasSound()) mute()
    else if (k === 'f' || k === 'F') full()
    else if (k === 'Home') (start(), seek(0))
    else if (k === 'End') (start(), seek(length()))
    else if (/^[0-9]$/.test(k)) (start(), seek((length() * Number(k)) / 10))
    else return false
    wake()
    return true
  }

  // ---- what it hears ----
  root.addEventListener('keydown', (ev) => {
    if (!key(ev)) return
    ev.preventDefault()
    ev.stopPropagation()
  })
  root.addEventListener('click', (ev) => {
    ev.stopPropagation() // a click on a recording is never also a click on the message around it
    const b = ev.target.closest('[data-fxp]')
    const act = b?.dataset.fxp
    if (menu && act !== 'rate' && act !== 'pick') closeMenu()
    if (root.classList.contains('cant')) {
      const f = file()
      if (act === 'retry') again()
      else if (f && act === 'open') fxOpen(f)
      else if (f && act === 'show') fxOpen(f, 'showFile')
      return
    }
    if (act === 'toggle') toggle()
    else if (act === 'mute') mute({ tell: false })
    else if (act === 'rate') openMenu()
    else if (act === 'pick') (setRate(Number(b.dataset.rate), { tell: false }), closeMenu(true))
    else if (act === 'full') full()
    else if (!act && (ev.target === video || ev.target === root)) toggle() // the picture itself
    // after a click with the mouse the keyboard is the player's, not the button's that was clicked (Space plays and
    // pauses, whatever was clicked last); a button pressed from the keyboard keeps it
    if (ev.detail > 0 && !menu) root.focus({ preventScroll: true })
    wake()
  })
  root.addEventListener('dblclick', (ev) => {
    if (ev.target === video || ev.target === root) full()
  })
  root.addEventListener('pointermove', () => wake())
  root.addEventListener('pointerleave', () => (hideTip(), wake(700)))
  root.addEventListener('focusin', () => wake())
  q('.fxp-bar').addEventListener('pointerenter', () => (overBar = true))
  q('.fxp-bar').addEventListener('pointerleave', () => (overBar = false))
  level.addEventListener('input', () => setLevel(Number(level.value), { tell: false }))

  track.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !length()) return
    ev.preventDefault()
    root.focus({ preventScroll: true })
    track.setPointerCapture(ev.pointerId)
    dragging = { resume: !video.paused && !video.ended }
    root.classList.add('seeking')
    pause()
    seek(timeAt(ev.clientX))
    showTip(ev.clientX)
  })
  track.addEventListener('pointermove', (ev) => {
    if (dragging) seek(timeAt(ev.clientX))
    showTip(ev.clientX)
  })
  const drop = () => {
    if (!dragging) return
    const { resume } = dragging
    dragging = null
    root.classList.remove('seeking')
    if (resume && !video.ended) play()
  }
  track.addEventListener('pointerup', drop)
  track.addEventListener('pointercancel', drop)
  track.addEventListener('lostpointercapture', drop)
  track.addEventListener('pointerleave', () => dragging || hideTip())

  const settle = () => {
    clearTimeout(waiting)
    root.classList.remove('waiting')
  }
  // (a moment's wait isn't shown: only one long enough to wonder about)
  const wait = () => {
    clearTimeout(waiting)
    waiting = setTimeout(() => {
      root.classList.add('waiting')
      // One from a linked computer that goes on waiting: is it still coming? If its computer went away (or it isn't
      // kept there any more), the player says so rather than turn for ever.
      if (!file()?.home) return
      waiting = setTimeout(async () => {
        let st = null
        try {
          st = await clique.call('fileState', file().path)
        } catch {}
        if (root.classList.contains('waiting') && st && !st.here && st.why) fxCant(root, null, st)
        else if (root.classList.contains('waiting')) wait()
      }, 2200)
    }, 350)
  }
  video.addEventListener('play', () => {
    if (fxNowPlaying && fxNowPlaying !== video && !fxNowPlaying.paused) fxNowPlaying.pause()
    fxNowPlaying = video
    state()
  })
  video.addEventListener('playing', () => (settle(), state()))
  video.addEventListener('pause', () => (settle(), state(), fxSpots.set(file()?.path, video.currentTime)))
  video.addEventListener('ended', () => (settle(), state(), fxSpots.delete(file()?.path), wake()))
  video.addEventListener('waiting', wait)
  video.addEventListener('canplay', settle)
  video.addEventListener('seeking', () => video.readyState < 3 && wait())
  video.addEventListener('seeked', () => {
    // the newest place asked for while it was getting to the last one
    if (wanted !== null && wanted !== asked && !video.seeking) return void (video.currentTime = asked = wanted)
    wanted = asked = null
    if (video.readyState >= 2) settle()
    state()
  })
  video.addEventListener('timeupdate', () => {
    // (a jump made before it had loaded is there now; one asked for while another was under way is still to come: 'seeked')
    if (wanted !== null && wanted === asked && !video.seeking && !dragging) wanted = asked = null
    if (!frame) paint()
    // a recording whose sound was never read from its file: with pictures decoded and no sound at all, it has none
    if (hasSound() && file()?.sound === undefined && video.currentTime > 1 && video.webkitAudioDecodedByteCount === 0 && video.webkitVideoDecodedByteCount > 0) root.classList.add('silent')
  })
  video.addEventListener('progress', paintHere)
  video.addEventListener('durationchange', () => (paint(), paintHere()))
  video.addEventListener('loadedmetadata', () => {
    if (video.videoWidth && video.videoHeight) root.style.setProperty('--ratio', String(video.videoWidth / video.videoHeight))
    sized()
    fxViewer?.fit()
    paint()
    paintHere()
  })
  video.addEventListener('volumechange', sound)
  video.addEventListener('ratechange', rateShown)

  // It couldn't be played: why, and what can be done about it (fxCant, which lets go of the file so nothing goes on
  // asking for it). Once more: the file again, and where it was.
  const again = () => {
    root.classList.remove('cant')
    delete root.dataset.away
    root.querySelector(':scope > .fx-gone')?.remove()
    const at = Number(root.dataset.at ?? video.currentTime)
    // (under an address of its own: Chromium remembers that one failed, and wouldn't ask again)
    const [url, spot = ''] = (root.dataset.src ?? video.getAttribute('src') ?? '').split('#')
    const bare = url.replace(/[?&]again=\d+/, '')
    video.setAttribute('src', `${bare}${bare.includes('?') ? '&' : '?'}again=${++fxTries}${spot ? `#${spot}` : ''}`)
    delete root.dataset.src
    delete root.dataset.at
    wanted = asked = null
    video.load()
    if (!root.classList.contains('on')) return
    root.closest('.fx-card')?.classList.add('on')
    if (at > 0.5) video.addEventListener('loadedmetadata', () => (video.currentTime = at), { once: true })
  }

  // What depends on how wide it is (a tall recording in a message is 240 across, the whole screen a few thousand): what
  // its bar keeps, and how big the look at a moment is. (Not container queries: see common.css.)
  const sized = () => {
    const w = root.clientWidth
    if (!w) return
    root.classList.toggle('narrow', w < 330)
    root.classList.toggle('tiny', w < 250)
    const ratio = Number(root.style.getPropertyValue('--ratio')) || 16 / 9
    let across = fxClamp(0.34 * w, 96, 220)
    if (across / ratio > 0.46 * w) across = 0.46 * w * ratio // (a tall one: no taller than about half the player is wide)
    root.style.setProperty('--look', `${Math.round(across)}px`)
  }
  new ResizeObserver(sized).observe(root)

  const api = { root, video, play, pause, toggle, seek, key, full, again, start, closeMenu, wake }
  fxPlayers.set(root, api)
  sized()
  sound()
  rateShown()
  paint()
  paintHere()
  return api
}

// A recording that won't play: the player says why, in its own box, with what can be done. From a linked computer, the
// app knows more than the player does (clique.call fileState): its computer is away, the file isn't kept, its CLIque is
// too old to send it. One whose computer is away is tried again when that computer is back (fxBack).
// known: what the app already said of it ({ here, why, computer }), when it's the app that says it can't be had.
async function fxCant(root, code, known = null) {
  if (root.classList.contains('cant')) return
  const hit = fxFile(root)
  if (!hit?.f) return
  root.classList.add('cant')
  root.classList.remove('waiting', 'tip')
  // It lets go of the file (Chromium goes on asking for one that fails, for half a minute); Try again takes it up
  // where it was.
  const video = root.querySelector(':scope > video')
  const look = root.querySelector('.fxp-tip video')
  if (video.getAttribute('src')) {
    root.dataset.src = video.getAttribute('src')
    root.dataset.at = String(fxPlayers.get(root) ? video.currentTime : 0)
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  if (look.getAttribute('src')) (look.removeAttribute('src'), look.load())
  let st = known
  try {
    st ??= await clique.call('fileState', hit.f.path)
  } catch {}
  if (!root.classList.contains('cant')) return // (tried again meanwhile)
  const acts = (...which) => `<span class="fx-acts">${which.map((w) => `<button type="button" class="btn sm" data-fxp="${w}">${w === 'retry' ? 'Try again' : w === 'open' ? 'Open' : FX_FOLDER()}</button>`).join('')}</span>`
  let words = "This recording can't play here."
  let more = acts('open', 'show')
  if (st && !st.here && st.why === 'away') {
    words = `${st.computer ?? 'Its computer'} is away. This plays once it's back.`
    more = acts('retry')
    root.dataset.away = st.computer ?? ''
  } else if (st && !st.here && st.why === 'old') {
    words = `${st.computer ?? 'Its computer'} runs an older CLIque, which can't send recordings. Update it there to watch this here.`
    more = ''
  } else if (st && !st.here && (st.why === 'gone' || !st.computer)) {
    words = "This file isn't kept any more."
    more = ''
  } else if (st && !st.here) {
    words = `It stopped coming from ${st.computer}.`
    more = acts('retry')
  } else if (!st && code !== 3 && code !== 4) {
    words = "This file isn't kept any more."
    more = ''
  }
  const note = fxGone(hit.f, words)
  note.insertAdjacentHTML('beforeend', more)
  root.querySelector(':scope > .fx-gone')?.remove()
  root.append(note)
  root.closest('.fx-card')?.classList.remove('on')
}

// A linked computer is connected again: what was waiting for it (a recording, a picture) is asked for once more.
function fxBack(state) {
  const online = new Set((state?.computers?.links ?? []).filter((l) => l.online).map((l) => l.name))
  for (const el of document.querySelectorAll('.fxp.cant[data-away]')) if (online.has(el.dataset.away)) fxPlayer(el).again()
  for (const el of document.querySelectorAll('.fx-pic.gone[data-away], .pics img.gone[data-away]')) {
    if (!online.has(el.dataset.away)) continue
    const img = el.tagName === 'IMG' ? el : el.querySelector('img')
    el.classList.remove('gone')
    delete el.dataset.away
    delete el.dataset.why
    const bare = img.src.replace(/[?&]again=\d+/, '')
    img.src = `${bare}${bare.includes('?') ? '&' : '?'}again=${++fxTries}`
  }
}

// ---- what's playing or running stays so through a redraw ----------------------------------------------------------

// Before a chat is drawn again: what's live in it (a recording that was started, a page that's running) is set aside
// as it is. -> a function that puts each back where the new drawing has its box. (moveBefore moves a frame or a video
// without reloading or pausing it, and what fills the screen goes on filling it.)
function fxHold(root) {
  const live = [...root.querySelectorAll('[data-live].on')]
  if (!live.length) return () => {}
  let shelf = document.getElementById('fx-shelf')
  if (!shelf) {
    shelf = Object.assign(document.createElement('div'), { id: 'fx-shelf' })
    document.body.append(shelf)
  }
  for (const node of live) fxMove(shelf, node)
  return () => {
    for (const node of live) {
      const now = root.querySelector(`[data-live="${CSS.escape(node.dataset.live)}"]`)
      if (!now) {
        node.remove()
        continue
      }
      fxMove(now.parentNode, node, now)
      now.remove()
    }
  }
}

const fxFile = (el) => {
  const at = el.closest('[data-id][data-i]')
  const files = at && fxKnown.get(at.dataset.id)
  return files ? { files, i: Number(at.dataset.i), f: files[Number(at.dataset.i)], id: at.dataset.id } : null
}

let fxSeen = null

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

// What a file's card and the viewer say of it right now (its size and kind, or how far it is on its way here).
function fxSay(f) {
  for (const card of document.querySelectorAll('.fx-card')) {
    const hit = fxFile(card.querySelector('[data-id][data-i]') ?? card)
    if (hit?.f?.path !== f.path) continue
    card.querySelector('.fx-what small').textContent = fxMeta(hit.f)
    for (const b of card.querySelectorAll('.fx-file [data-fx=open], .fx-file [data-fx=show]')) b.disabled = fxGetting.has(f.path)
  }
  fxViewer?.said()
}

// Opens it in its own app (openFile), shows it in its folder (showFile) or copies where it is (copyFilePath). One from a
// linked computer is brought here first, all of it; its card says how far that is.
async function fxOpen(f, how = 'openFile') {
  if (fxGetting.has(f.path)) return
  const coming = f.home ? { have: 0, size: f.size ?? 0, shown: false } : null
  let later = 0
  if (coming) {
    fxGetting.set(f.path, coming)
    // (one that's here already answers at once: nothing to say then)
    later = setTimeout(() => ((coming.shown = true), fxSay(f)), 250)
    fxSay(f)
  }
  try {
    const out = await clique.call(how, f.path)
    if (out === 'shown') notify(`${f.name} is shown in its folder: opening it would run it.`)
  } catch (err) {
    oops(how === 'copyFilePath' ? `Couldn't get ${f.name}` : `Couldn't open ${f.name}`, err, '')
  } finally {
    clearTimeout(later)
    if (coming) (fxGetting.delete(f.path), fxSay(f))
  }
}

function fxMenu(at, f) {
  popMenu(at, [
    ...(FX_OPENS.test(f.path) ? [{ act: 'openFile', label: f.kind === 'html' ? 'Open in your browser' : 'Open', icon: FX_ICONS.open }] : []),
    { act: 'showFile', label: FX_FOLDER(), icon: FX_ICONS.folder },
    { act: 'copy', label: 'Copy its path', icon: ICONS.copy },
  ], (act) => (act !== 'copy' ? fxOpen(f, act) : f.home ? fxOpen(f, 'copyFilePath') : clique.call('copy', f.path)))
}

// ---- the viewer ---------------------------------------------------------------------------------------------------

// One at a time, over the whole window: a picture fitted to it (click or + / − to zoom), a recording, a page running in
// its sandbox. ← → go through the message's files, Esc closes, and the keyboard goes back to what opened it.
//
// A recording is the same player the message has, moved here as it is (still playing, if it was) and moved back when
// the viewer closes or goes on to another file: nothing loads twice and nothing skips.
let fxViewer = null
const fxViews = (files) => files.map((f, i) => ({ f, i })).filter(({ f }) => f.path && (f.kind === 'image' || f.kind === 'video' || f.kind === 'html'))

// from: { t, playing } for a recording that was playing in another window (the floating chat), to carry on from there
function fxView(id, i, opener, from = null) {
  const files = fxKnown.get(id)
  const views = files && fxViews(files)
  if (!views?.length) return
  fxViewer?.close()
  // the floating chat is too small a window to look closer in: the main window shows it
  if (document.documentElement.dataset.fxElsewhere) {
    const inline = views.find((v) => v.i === i)?.f.kind === 'video' ? document.querySelector(`.fx-video[data-live="${CSS.escape(`${id}:${i}`)}"] video`) : null
    const at = inline && !inline.error ? { t: inline.currentTime, playing: !inline.paused && !inline.ended } : null
    inline?.pause()
    return clique.call('dashboard', `file:${JSON.stringify({ files, i, ...(at && { from: at }) })}`)
  }
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
  let lent = null // the message's player, while it's here: { player, live }
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
  // A recording: as big as the stage lets its shape be.
  const fitPlayer = () => {
    const player = stage.querySelector(':scope > .fxp')
    if (!player) return
    const pad = getComputedStyle(stage)
    const w = stage.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight)
    const h = stage.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom)
    const ratio = Number(player.style.getPropertyValue('--ratio')) || 16 / 9
    const across = Math.max(1, Math.floor(Math.min(w, h * ratio)))
    player.style.width = `${across}px`
    player.style.height = `${Math.round(across / ratio)}px`
  }
  const fitAll = () => (size(), fitPlayer())
  const said = () => {
    const { f } = views[at]
    el.querySelector('.fx-what small').textContent = fxMeta(f, { dims: true })
    for (const b of el.querySelectorAll('[data-fxv=open], [data-fxv=show]')) b.disabled = fxGetting.has(f.path)
  }
  // What was showing ends: a recording stops and goes back to its message as it is, a page's frame goes.
  const leave = () => {
    const player = stage.querySelector(':scope > .fxp')
    if (player) {
      const p = fxPlayer(player)
      p.closeMenu()
      p.pause()
      if (document.fullscreenElement === player) document.exitFullscreen().catch(() => {})
      if (player.contains(document.activeElement)) el.querySelector('[data-fxv=close]').focus({ preventScroll: true })
    }
    if (lent) {
      const { player, live } = lent
      lent = null
      // (the chat may have been drawn again meanwhile: the card that's there now)
      const card = document.querySelector(`.fx-video[data-live="${CSS.escape(live)}"]`)
      const slot = card?.querySelector(':scope > .fx-stage')
      player.style.width = player.style.height = '' // (its card sizes it there)
      if (slot) {
        const fresh = slot.querySelector(':scope > .fxp')
        fxMove(slot, player, fresh)
        fresh?.remove()
        card.classList.remove('lent')
        card.classList.toggle('on', player.classList.contains('on') && !player.classList.contains('cant'))
        fxPlayer(player).wake(700)
      }
    }
    stage.replaceChildren()
  }
  const show = (first = false) => {
    const { f, i: fi } = views[at]
    leave()
    stage.className = `fxv-stage ${f.kind}`
    img = natural = zoom = null
    el.setAttribute('aria-label', f.name)
    el.querySelector('.fx-icon').innerHTML = FX_ICONS[f.kind]
    el.querySelector('.fx-name').textContent = f.name
    el.querySelector('.fxv-count').textContent = views.length > 1 ? `${at + 1} of ${views.length}` : ''
    el.classList.toggle('alone', views.length < 2)
    el.querySelector('[data-fxv=open] span').textContent = f.kind === 'html' ? 'Open in your browser' : 'Open'
    said()
    if (f.kind === 'image') {
      img = Object.assign(document.createElement('img'), { alt: f.name, draggable: false })
      if (f.w && f.h) natural = { w: f.w, h: f.h }
      img.addEventListener('load', () => ((natural ??= { w: img.naturalWidth || 300, h: img.naturalHeight || 150 }), size()))
      img.addEventListener('error', () => fxWhy(f).then((why) => img?.isConnected && stage.replaceChildren(fxGone(f, why.words))))
      img.src = fileURL(f.path)
      stage.append(img)
      size()
    } else if (f.kind === 'video') {
      const live = `${id}:${fi}`
      const card = document.querySelector(`.fx-video[data-live="${CSS.escape(live)}"]`)
      let player = card?.querySelector(':scope > .fx-stage > .fxp')
      if (player) {
        // the message's own player, as it is
        lent = { player, live }
        card.classList.add('lent')
        fxMove(stage, player)
      } else {
        stage.innerHTML = fxPlayerHTML(f, `data-id="${esc(id)}" data-i="${fi}"`)
        player = stage.firstChild
      }
      fitPlayer()
      const p = fxPlayer(player)
      if (first && from && !player.classList.contains('cant')) {
        // it was playing in the floating chat: from where it was
        const carry = () => {
          if (from.t > 0.1) p.seek(from.t, { quiet: true })
          if (from.playing) p.play()
        }
        p.start()
        carry()
      }
      p.wake()
      // opened on it: the keyboard is the player's (Space plays). Come to it with ← →, the keyboard stays on the way through.
      if (first) player.focus({ preventScroll: true })
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
    removeEventListener('resize', fitAll)
    leave()
    el.remove()
    // (the chat may have been drawn again meanwhile: the same button, where it is now)
    const back = opener?.isConnected ? opener : opener?.dataset?.id ? document.querySelector(`[data-fx="${opener.dataset.fx}"][data-id="${CSS.escape(opener.dataset.id)}"][data-i="${opener.dataset.i}"]`) : null
    back?.focus({ preventScroll: true })
  }
  const keys = (ev) => {
    if (ev.isComposing) return
    const k = ev.key
    const player = stage.querySelector(':scope > .fxp')
    if (k === 'Escape') {
      if (player?.classList.contains('speeds')) return // (its speeds close first: the player hears it)
      close()
    } else if (k === 'Tab') {
      // the keyboard stays in the viewer while it's open
      const stops = [...el.querySelectorAll('button, input, [tabindex="0"], iframe')].filter((b) => b.offsetParent && !b.disabled && b.tabIndex !== -1 && (!b.closest('.fxp') || b.closest('.fxp').classList.contains('on') || b.classList.contains('fxp')))
      const here = stops.indexOf(document.activeElement)
      const to = stops[(here + (ev.shiftKey ? -1 : 1) + stops.length) % stops.length]
      if (to?.tagName === 'IFRAME' || document.activeElement?.tagName === 'IFRAME') return // into the page and out of it: the browser's own order
      to?.focus()
    } else if (player?.contains(ev.target)) return // the recording has the keyboard: its keys are its own
    else if (k === 'ArrowLeft' && (views.length > 1 || !player)) go(-1)
    else if (k === 'ArrowRight' && (views.length > 1 || !player)) go(1)
    else if ((k === '+' || k === '=') && img) zoomTo((zoom ?? fit()) * 1.25)
    else if (k === '-' && img) zoomTo((zoom ?? fit()) / 1.25)
    else if (k === '0' && img) zoomTo(null)
    // a recording's keys work wherever the keyboard is in the viewer (Space plays it even with Close in hand)
    else if (player && !ev.target.closest?.('.fxv-bar input') && fxPlayer(player).key(ev)) {}
    else return
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
  addEventListener('resize', fitAll)
  document.body.append(el)
  fxViewer = { el, close, stage, said, fit: fitPlayer, left: () => stage.replaceChildren(fxGone(views[at].f, 'This page tried to go somewhere else, so it was stopped.', true)) }
  el.querySelector('[data-fxv=close]').focus()
  show(true)
}

function fxGone(f, words = "This file isn't kept any more.", again = false) {
  const el = document.createElement('div')
  el.className = 'fx-gone'
  el.innerHTML = `<span class="fx-icon">${FX_ICONS[f.kind] ?? FX_ICONS.file}</span><p>${esc(words)}</p>${again ? '<button type="button" class="btn" data-fxv="again" data-fx="again">Run it again</button>' : ''}`
  return el
}

// Why a picture won't show: { words, away } (away: the linked computer it's waiting for, to try again when that's back).
async function fxWhy(f) {
  let st = null
  try {
    st = f.path ? await clique.call('fileState', f.path) : null
  } catch {}
  if (st && !st.here && st.why === 'away') return { words: `On ${st.computer ?? 'a computer'}, which is away`, away: st.computer ?? '' }
  if (st && !st.here && st.computer && st.why !== 'gone') return { words: `It didn't come from ${st.computer}`, away: st.computer }
  return { words: 'Not kept any more', away: null }
}

// ---- clicks, keys, and what the frames and files say -------------------------------------------------------------

if (typeof document !== 'undefined' && typeof clique !== 'undefined') {
  document.addEventListener('keydown', () => (fxByKeys = true), true)
  document.addEventListener('pointerdown', () => (fxByKeys = false), true)
  // A recording's player is made the moment the pointer or the keyboard comes to it (it's only a still picture before).
  for (const type of ['pointerover', 'pointerdown', 'focusin', 'keydown', 'click']) {
    document.addEventListener(type, (ev) => {
      const root = ev.target.closest?.('.fxp')
      if (root) fxPlayer(root)
    }, true)
  }
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
    else if (act === 'run') fxRun(card, f)
    else if (act === 'stop') fxStop(card, f)
    else if (act === 'more') fxMenu(el, f)
    else if (act === 'open') fxOpen(f)
    else if (act === 'show') fxOpen(f, 'showFile')
  }, true)
  // Into the whole screen and out of it (Esc there is the system's own key: it leaves the whole screen, whatever else
  // is open): a player's speeds close, and its bar shows for a moment in the place it's now in.
  document.addEventListener('fullscreenchange', () => {
    for (const root of document.querySelectorAll('.fxp.on')) {
      const p = fxPlayers.get(root)
      p?.closeMenu()
      p?.wake()
    }
  })
  // the floating chat's player asks for the whole screen: the main window's viewer has it
  document.addEventListener('fx-elsewhere', (ev) => {
    const hit = fxFile(ev.target)
    if (hit) fxView(hit.id, hit.i, ev.target)
  })
  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('img[data-fx]')) (ev.preventDefault(), ev.target.click())
  })
  // A picture or a recording that won't load says why, where it would have been. (One from a linked computer is asked
  // for when it's shown and its box waits for it, so this is only what really can't be had.)
  document.addEventListener('error', (ev) => {
    const el = ev.target
    if (!(el instanceof HTMLElement)) return
    if (el.tagName === 'VIDEO') {
      const root = el.closest('.fxp')
      // (not the one it let go of itself: fxCant empties it)
      if (root && el.parentNode === root && el.getAttribute('src')) fxCant(root, el.error?.code)
      return
    }
    if (el.tagName !== 'IMG' || !el.closest('.files, .pics')) return
    const hit = fxFile(el.closest('[data-id][data-i]') ?? el)
    if (!hit?.f) return
    const box = el.closest('.fx-pic') ?? el
    fxWhy(hit.f).then((why) => {
      if (!box.isConnected) return
      box.classList.add('gone')
      box.dataset.why = why.words
      if (why.away !== null) box.dataset.away = why.away
    })
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
  // How far a linked computer's file is on its way here, while one you asked to open is being brought. Or that one this
  // page asked for can't be had (its computer is away, it isn't kept there): a recording that has nothing to show yet
  // says so at once. (One that's playing goes on with what's here, and says so when it runs out: fxPlayer wait.)
  clique.onFile?.(({ path, have, size, why, computer }) => {
    if (why) {
      for (const root of document.querySelectorAll('.fxp:not(.cant)')) {
        const video = root.querySelector(':scope > video')
        if (fxFile(root)?.f?.path === path && video.readyState < 2) fxCant(root, null, { here: false, why, computer })
      }
      return
    }
    const coming = fxGetting.get(path)
    if (!coming) return
    Object.assign(coming, { have, size })
    for (const files of fxKnown.values()) for (const f of files) if (f.path === path) return void fxSay(f)
  })
  clique.onState?.((state) => fxBack(state))
}

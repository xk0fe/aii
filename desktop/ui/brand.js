// CLIque's brand layer: the name the app shows, its felt, and the Agents view's header. Felt is the creatures' material,
// and the brand surfaces are made of it too: each creature's patch on its card, the menu bar's clique strip, empty
// states and the wordmark. Never on controls, and text never sits on it. One felt surface per region.
/* global avatarHTML, poseOf, statusWord, plainName, esc */

// The product's name wherever it's shown (the wordmark, window titles). A rename is this line and PRODUCT_NAME in
// core/appid.js (the app, its menus and installers); the `clique` command, the ~/.clique folder, environment variables and
// app IDs keep theirs.
const PRODUCT_NAME = 'CLIque'
document.title = PRODUCT_NAME

// The felt of brand surfaces: the creatures' av-fuzz idea (a fuzzy edge and fibre grain), tuned for flat areas
// measured in px. Shared by every felt surface on the page.
function ensureFeltDefs() {
  if (document.getElementById('felt-defs')) return
  document.body.insertAdjacentHTML('afterbegin', `<svg id="felt-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <filter id="felt-grain" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="3" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" result="edge"/>
      <feTurbulence type="fractalNoise" baseFrequency="1.8" numOctaves="2" seed="9" result="g"/>
      <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .32 0 0 0 -.13" result="dark"/>
      <feColorMatrix in="g" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 .4 0 0 -.2" result="light"/>
      <feComposite in="dark" in2="edge" operator="in" result="d2"/>
      <feComposite in="light" in2="edge" operator="in" result="l2"/>
      <feMerge><feMergeNode in="edge"/><feMergeNode in="d2"/><feMergeNode in="l2"/></feMerge>
    </filter>
  </defs></svg>`)
}

// A sewn-on felt patch of a fixed size: a felt fill and a stitched seam inset from its edge. fill and thread are CSS
// colours; on a .felt element they default to its creature's tint (--patch, --thread from --c).
function patchSVG(w, h, { r = 10, fill = 'var(--patch)', thread = 'var(--thread)', inset = 6, dash = '5 3.5', cls = '' } = {}) {
  ensureFeltDefs()
  return `<svg class="patch ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${r}" style="fill:${fill}" filter="url(#felt-grain)"/>
    <rect x="${inset}" y="${inset}" width="${w - 2 * inset}" height="${h - 2 * inset}" rx="${Math.max(2, r - inset + 2)}" fill="none" style="stroke:${thread}" stroke-width="1.5" stroke-dasharray="${dash}" stroke-linecap="round"/>
  </svg>`
}

// A room's felt, as wide as whatever holds it: a soft back wall, a floor `floor` px tall, a seam between them, and a
// stitch all round. The pieces are sized by their boxes (CSS), so the room follows the window without a redraw.
function roomFeltHTML(floor = 44) {
  ensureFeltDefs()
  const fill = (v) => `<svg width="100%" height="100%" aria-hidden="true"><rect width="100%" height="100%" style="fill:var(${v})" filter="url(#felt-grain)"/></svg>`
  const thread = 'style="stroke:var(--room-thread)" stroke-width="1.5" stroke-dasharray="5 3.5" stroke-linecap="round"'
  return `<span class="room-felt" aria-hidden="true"><span class="rf-wall">${fill('--room-wall')}</span><span class="rf-floor" style="height:${floor}px">${fill('--room-floor')}</span></span>
    <span class="rf-seam" style="bottom:${floor}px" aria-hidden="true"><svg width="100%" height="2"><line x1="0" y1="1" x2="100%" y2="1" ${thread}/></svg></span>
    <span class="rf-stitch" aria-hidden="true"><svg width="100%" height="100%"><rect width="100%" height="100%" rx="10" fill="none" ${thread}/></svg></span>`
}

// The wordmark: the product's name in the brand face, as it's written (the capitals are the CLI in CLIque), each
// letter in a creature's colour, felt edges, sewn on with one stitch (dropped below 40px, where it would only blur).
// Drawn as SVG text so the felt and the stitch follow the letters; spaced by the face's own advances once it's loaded
// (wordmarks drawn before that are redrawn). The stitch shows only in a band along the letters' edges: Fredoka draws
// some letters from overlapping strokes (the q's bowl and stem), and a stitch along every outline would cross them.
const WORDMARK_INKS = ['#ff45a8', '#3db8ff', '#ffc61f', '#2fd3a6', '#72d63a', '#ff8a1f', '#8b5cf6']
let wordmarkCtx = null
function wordmarkHTML(size = 24, { stitch = size >= 40 } = {}) {
  ensureFeltDefs()
  const letters = [...PRODUCT_NAME]
  wordmarkCtx ??= document.createElement('canvas').getContext('2d')
  wordmarkCtx.font = `700 ${size}px Fredoka`
  const ready = document.fonts?.check?.(`700 ${size}px Fredoka`) ?? true
  if (!ready) document.fonts.load(`700 ${size}px Fredoka`).then(redrawWordmarks, () => {})
  const xs = []
  let x = 0
  for (const l of letters) {
    xs.push(x)
    x += wordmarkCtx.measureText(l).width - size * 0.02
  }
  const w = Math.ceil(x + size * 0.08)
  const h = Math.ceil(size * 1.06)
  const base = +(size * 0.8).toFixed(1)
  const id = `wm-${size}` // the same wordmark draws the same HTML (morph leaves it be); same-size copies share identical defs
  const text = (l, i, attrs) => `<text x="${(xs[i] + size * 0.04).toFixed(1)}" y="${base}" font-family="Fredoka" font-weight="700" font-size="${size}" ${attrs}>${esc(l)}</text>`
  const ink = letters.map((l, i) => text(l, i, `fill="${WORDMARK_INKS[i % WORDMARK_INKS.length]}"`)).join('')
  const edge = stitch ? `<filter id="${id}-edge"><feMorphology in="SourceAlpha" operator="erode" radius="${(size * 0.03).toFixed(2)}" result="core"/><feComposite in="SourceGraphic" in2="core" operator="out"/></filter><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><g filter="url(#${id}-edge)" fill="#fff">${letters.map((l, i) => text(l, i, '')).join('')}</g></mask>` : ''
  const seam = stitch ? `<g mask="url(#${id})">${letters.map((l, i) => text(l, i, `fill="none" stroke="rgba(255,255,255,.85)" stroke-width="${(size / 32).toFixed(2)}" stroke-dasharray="${(size / 26).toFixed(2)} ${(size / 34).toFixed(2)}" stroke-linecap="round"`)).join('')}</g>` : ''
  return `<span class="wordmark${ready ? '' : ' stale'}" data-size="${size}" data-stitch="${stitch ? 1 : 0}" role="img" aria-label="${esc(PRODUCT_NAME)}"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${stitch ? `<defs>${edge}</defs>` : ''}<g filter="url(#felt-grain)">${ink}</g>${seam}</svg></span>`
}
function redrawWordmarks() {
  for (const el of document.querySelectorAll('.wordmark.stale')) el.outerHTML = wordmarkHTML(Number(el.dataset.size), { stitch: el.dataset.stitch === '1' })
}

// The first-run fold (ui/setup.js): the name's own story, "CLI agent queue" becoming CLI queue becoming CLIque, before
// Q (the queue in it, core/system-agent.js) pops up to say hello. The words come into focus one by one; the letters the
// name keeps wear the wordmark's inks from the start and the rest are faint. Those blur away, the kept ones glide to
// where the wordmark's own letters sit (the same advances, so they land exactly), and the felt wordmark is sewn on over
// them (setup.css). It plays once, when it's put on the page: a morph drawing the same html leaves it be.
const FOLD_FROM = 'CLI agent queue'
const FOLD_KEPT = [0, 1, 2, 10, 11, 12] // C, L, I and q, u, e: the wordmark's letters, in order
function foldHTML(size = 40) {
  const font = `700 ${size}px Fredoka`
  const h = Math.ceil(size * 1.06)
  if (!(document.fonts?.check?.(font) ?? true)) {
    const redraw = () => {
      for (const el of document.querySelectorAll('.fold.stale')) el.outerHTML = foldHTML(Number(el.dataset.size))
    }
    document.fonts.load(font).then(redraw, () => {})
    return `<div class="fold stale" data-size="${size}" style="height:${h}px" role="img" aria-label="${esc(PRODUCT_NAME)}"></div>`
  }
  wordmarkCtx ??= document.createElement('canvas').getContext('2d')
  wordmarkCtx.font = font
  // where each letter's drawn and how wide the whole is, as wordmarkHTML spaces them
  const advance = (s) => {
    const xs = []
    let x = 0
    for (const l of s) {
      xs.push(x + size * 0.04)
      x += wordmarkCtx.measureText(l).width - size * 0.02
    }
    return { xs, w: Math.ceil(x + size * 0.08) }
  }
  const from = advance(FOLD_FROM)
  const to = advance(PRODUCT_NAME)
  const shift = (from.w - to.w) / 2 // the wordmark sits in the middle of where the words were
  const base = +(size * 0.8).toFixed(1)
  const letter = (l, x, attrs) => `<text x="${x.toFixed(1)}" y="${base}" font-family="Fredoka" font-weight="700" font-size="${size}" ${attrs}>${esc(l)}</text>`
  const kept = new Map(FOLD_KEPT.map((at, i) => [at, i]))
  let dropped = 0
  const words = [[]]
  ;[...FOLD_FROM].forEach((l, at) => {
    if (l === ' ') return void words.push([])
    if (!kept.has(at)) return void words.at(-1).push(letter(l, from.xs[at], `class="fold-drop" style="--i:${dropped++}"`))
    const i = kept.get(at)
    const x = shift + to.xs[i]
    words.at(-1).push(letter(l, x, `class="fold-keep" style="--dx:${(from.xs[at] - x).toFixed(1)}px;fill:${WORDMARK_INKS[i % WORDMARK_INKS.length]}"`))
  })
  const letters = words.map((w, i) => `<g class="fold-word" style="--w:${i}">${w.join('')}</g>`).join('')
  return `<div class="fold" style="width:${from.w}px;height:${h}px" role="img" aria-label="${esc(PRODUCT_NAME)}"><svg class="fold-words" width="${from.w}" height="${h}" viewBox="0 0 ${from.w} ${h}" aria-hidden="true">${letters}</svg><span class="fold-mark" style="left:${shift.toFixed(1)}px">${wordmarkHTML(size)}</span></div>`
}

// Who matters most right now, for a strip too small for everyone: needing you, then working, starting, free, off.
const ROOM_RANK = { waiting: 0, working: 1, starting: 2, idle: 3 }

// The stage's light, wherever the creatures stand with nothing behind them (the first run, an empty Agents view, an
// empty Tasks board): three soft glows in their colours, and a shadow to stand on. No card, no felt: felt is for the
// creatures themselves and their patches.
const glowBedHTML = () => '<span class="glowbed" aria-hidden="true"><i class="sky"></i><i class="pink"></i><i class="lime"></i><b></b></span>'

// Everyone in a row, for the menu bar's popover (small creatures: at their laptops while they work, wiggling
// when they need you, asleep when off). A click opens one (data-open). A clique too big for it shows the ones that
// matter most right now, in your order, and how many more at the end.
function stripHTML(agents, width = 318) {
  const fit = Math.max(1, Math.floor((width - 16) / 40))
  const keep = agents.length <= fit ? null : new Set([...agents].sort((x, y) => (ROOM_RANK[x.on ? x.status : 'off'] ?? 4) - (ROOM_RANK[y.on ? y.status : 'off'] ?? 4)).slice(0, fit - 1).map((a) => a.name))
  const cast = keep ? agents.filter((a) => keep.has(a.name)) : agents
  const more = agents.length - cast.length
  const who = (a) => `<button class="strip-who" data-open="${esc(a.name)}" title="${esc(a.seed ?? a.name)}">${avatarHTML(a, { size: 36 })}${a.on && a.status === 'waiting' ? '<i class="dot waiting"></i>' : ''}</button>`
  return `<div class="strip"><div class="strip-clique">${cast.map(who).join('')}${more ? `<button class="strip-more" data-act="dashboard" title="Everyone, in the dashboard">+${more}</button>` : ''}</div></div>`
}
// Someone new popping up on the stage: the empty Agents view. And everyone waiting with their mugs: the empty Tasks
// board.
function firstRoomHTML(w = 440, h = 176) {
  // the blue one from the app's icon: the pink one is Q (core/system-agent.js), and this is someone new
  const first = { name: 'New', avatar: { body: 'blob', color: 'sky', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true }, status: 'starting', on: true }
  return `<div class="scene" style="width:${w}px;height:${h}px">${glowBedHTML()}<span class="scene-who" style="left:${w / 2 - 64}px;top:${h - 140}px">${avatarHTML(first, { size: 128, mood: 'starting', pose: 'pop' })}</span></div>`
}
function mugsRoomHTML(agents, w = 360, h = 168) {
  const three = agents.slice(0, 3)
  const gap = (w - 56 - three.length * 96) / Math.max(1, three.length - 1)
  return `<div class="scene" style="width:${w}px;height:${h}px">${glowBedHTML()}${three.map((a, i) => `<span class="scene-who" style="left:${Math.round(28 + i * (96 + gap))}px;top:${h - 108}px">${avatarHTML({ ...a, status: 'idle', on: true }, { size: 96, mood: 'idle', pose: 'mug' })}</span>`).join('')}</div>`
}

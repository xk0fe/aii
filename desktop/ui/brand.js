// Crew's brand layer: the name the app shows, its felt, and the Crew room. Felt is the creatures' material, and the
// brand surfaces are made of it too: the room at the top of the Crew view, each creature's patch on its card, empty
// states and the wordmark. Never on controls, and text never sits on it. One felt surface per region.
/* global avatarHTML, poseOf, statusWord, esc */

// The product's name wherever it's shown (the wordmark, window titles). A rename is this one line; the `crew` command,
// the ~/.crew folder, environment variables and app IDs keep theirs.
const PRODUCT_NAME = 'Crew'
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

// The wordmark: the product's name in the brand face, each letter in a creature's colour, felt edges, sewn on with
// one stitch (dropped below 40px, where it would only blur). Drawn as SVG text so the felt and the stitch follow
// the letters; spaced by the face's own advances once it's loaded (wordmarks drawn before that are redrawn).
const WORDMARK_INKS = ['#ff45a8', '#3db8ff', '#ffc61f', '#2fd3a6', '#72d63a', '#ff8a1f', '#8b5cf6']
let wordmarkCtx = null
function wordmarkHTML(size = 24, { stitch = size >= 40 } = {}) {
  ensureFeltDefs()
  const letters = [...PRODUCT_NAME.toLowerCase()]
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
  const seam = stitch ? `<g clip-path="url(#${id})">${letters.map((l, i) => text(l, i, `fill="none" stroke="rgba(255,255,255,.85)" stroke-width="${(size / 32).toFixed(2)}" stroke-dasharray="${(size / 26).toFixed(2)} ${(size / 34).toFixed(2)}" stroke-linecap="round"`)).join('')}</g>` : ''
  return `<span class="wordmark${ready ? '' : ' stale'}" data-size="${size}" data-stitch="${stitch ? 1 : 0}" role="img" aria-label="${esc(PRODUCT_NAME)}"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${stitch ? `<defs><clipPath id="${id}">${ink}</clipPath></defs>` : ''}<g filter="url(#felt-grain)">${ink}</g>${seam}</svg></span>`
}
function redrawWordmarks() {
  for (const el of document.querySelectorAll('.wordmark.stale')) el.outerHTML = wordmarkHTML(Number(el.dataset.size), { stitch: el.dataset.stitch === '1' })
}

// ---- the Crew room: the whole crew in one felt scene, each acting out its status ----

// The one line the room says, in plain words: who needs you comes first, then how busy everyone is.
function crewHeadline(agents, needs) {
  const asking = [...new Map(needs.map((n) => [n.agent.name, n.agent])).values()]
  if (asking.length === 1) return `${asking[0].seed ?? asking[0].name} needs you`
  if (asking.length) return `${asking.length} of your crew need you`
  const on = agents.filter((a) => a.on && a.status !== 'parked')
  const busy = on.filter((a) => a.status === 'working' && !a.waitingOn?.length)
  if (!on.length) return agents.length ? 'Everyone’s off' : 'No crew yet'
  if (busy.length && busy.length === on.length) return on.length === 1 ? `${busy[0].seed ?? busy[0].name} is busy` : 'Everyone’s busy'
  if (busy.length) return `${busy.length} at work`
  return 'All quiet'
}

// "Ada and Theo", "Ada, Theo and June", "Ada, Theo and 3 others"
function namesList(names, max = 3) {
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? ''
  return `${names.slice(0, max - 1).join(', ')} and ${names.length - max + 1} others`
}

// The sentence under the headline: what each one asking you wants, then who's at work.
function crewSentence(agents, needs) {
  const nameOf = (a) => a.seed ?? a.name
  const seen = new Set()
  const wants = []
  for (const n of needs) {
    if (seen.has(n.agent.name)) continue
    seen.add(n.agent.name)
    const q = n.ask?.ask
    wants.push(`${nameOf(n.agent)} ${!q ? 'is waiting in its terminal' : q.type === 'question' ? 'has a question' : q.type === 'plan' ? 'has a plan for you' : q.code ? 'wants to run a command' : 'wants your OK'}`)
  }
  const ask = wants.length > 2 ? `${wants[0]}, ${wants[1]} and ${wants.length - 2} more need you.` : wants.length ? `${wants.join(' and ')}.` : ''
  const busy = agents.filter((a) => a.on && a.status === 'working' && !a.waitingOn?.length && !seen.has(a.name)).map(nameOf)
  const work = busy.length ? `${namesList(busy)} ${busy.length === 1 ? 'is' : 'are'} working.` : ''
  if (ask || work) return [ask, work].filter(Boolean).join(' ')
  const on = agents.filter((a) => a.on && a.status !== 'parked')
  if (!on.length) return agents.length ? 'Turn someone on in the sidebar and they pick up where they left off.' : ''
  return 'Nobody’s working right now. Send a message or add a task, and whoever’s free picks it up.'
}

// Who stands in a room this wide: everyone if they fit at 64px or more, else the ones that matter most right now
// (needing you, then working, starting, free, off), kept in your order so nobody swaps places.
const ROOM_RANK = { waiting: 0, working: 1, starting: 2, idle: 3 }
function roomCast(agents, width) {
  const fit = Math.max(1, Math.floor(width / 76))
  if (agents.length <= fit) return { cast: agents, more: 0, size: Math.max(64, Math.min(96, Math.floor(width / agents.length) - 8)) }
  const keep = new Set([...agents].sort((x, y) => (ROOM_RANK[x.on ? x.status : 'off'] ?? 4) - (ROOM_RANK[y.on ? y.status : 'off'] ?? 4)).slice(0, fit - 1).map((a) => a.name))
  return { cast: agents.filter((a) => keep.has(a.name)), more: agents.length - keep.size, size: 64 }
}

// The room: its felt, the crew standing on its floor (each a button: a click picks it), and their names under it
// (off the felt). asks: agent name -> its open ask's type, so a question gets the speech bubble and an OK the sign.
function roomHTML(agents, { width = 728, asks = new Map(), picked = null } = {}) {
  const { cast, more, size } = roomCast(agents, width)
  const nameOf = (a) => a.seed ?? a.name
  const said = (a) => `${nameOf(a)}: ${statusWord(a, asks.get(a.name))}`
  const slot = (a) => `<button class="room-who${a.name === picked ? ' on' : ''}" data-room="${esc(a.name)}" style="--slot:${size}px" aria-label="${esc(said(a))}">${avatarHTML(a, { size, pose: poseOf(a, { ask: asks.get(a.name) }) })}</button>`
  const dot = (a) => (a.on && (a.status === 'working' || a.status === 'waiting') ? `<i class="dot ${a.status === 'waiting' ? 'needs' : a.waitingOn?.length ? 'idle' : 'working'}"></i>` : '')
  const name = (a) => `<button class="room-name${a.name === picked ? ' on' : ''}" data-room="${esc(a.name)}" style="--slot:${size}px" tabindex="-1">${dot(a)}<span>${esc(nameOf(a))}</span></button>`
  const extra = more ? `<span class="room-more" style="--slot:${size}px"></span>` : ''
  return `<div class="room">${roomFeltHTML(44)}<div class="room-crew">${cast.map(slot).join('')}${extra}</div></div>
    <div class="room-names">${cast.map(name).join('')}${more ? `<span class="room-name room-extra" style="--slot:${size}px">${more} more</span>` : ''}</div>`
}

// The mini crew strip, for the menu bar's popover: the room in small, the crew on its floor (plain creatures at this
// size, hopping while they work, wiggling when they need you, asleep when off). A click opens one (data-open).
function stripHTML(agents, width = 318) {
  const fit = Math.max(1, Math.floor((width - 16) / 40))
  const keep = agents.length <= fit ? null : new Set([...agents].sort((x, y) => (ROOM_RANK[x.on ? x.status : 'off'] ?? 4) - (ROOM_RANK[y.on ? y.status : 'off'] ?? 4)).slice(0, fit).map((a) => a.name))
  const cast = keep ? agents.filter((a) => keep.has(a.name)) : agents
  return `<div class="strip">${roomFeltHTML(16)}<div class="strip-crew">${cast.map((a) => `<button class="strip-who" data-open="${esc(a.name)}" title="${esc(a.seed ?? a.name)}">${avatarHTML(a, { size: 36 })}${a.on && a.status === 'waiting' ? '<i class="dot waiting"></i>' : ''}</button>`).join('')}</div></div>`
}

// An empty room with one creature popping up and dashed spots where the rest of the crew will stand: the empty
// Crew view. And the crew waiting with their mugs: the empty Tasks board.
function firstRoomHTML(w = 440, h = 196) {
  const first = { name: 'New', avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true }, status: 'starting', on: true }
  return `<div class="scene" style="width:${w}px;height:${h}px">${roomFeltHTML(56)}
    <span class="spot" style="left:52px"></span><span class="spot" style="left:136px"></span><span class="spot" style="left:${w - 116}px"></span>
    <span class="scene-who" style="left:${w / 2 - 56}px;top:${h - 122}px">${avatarHTML(first, { size: 112, mood: 'starting', pose: 'pop' })}</span>
    <span class="say" style="left:${w / 2 + 40}px;top:44px">Hi! Who should I be?</span></div>`
}
function mugsRoomHTML(agents, w = 360, h = 168) {
  const three = agents.slice(0, 3)
  const gap = (w - 56 - three.length * 96) / Math.max(1, three.length - 1)
  return `<div class="scene" style="width:${w}px;height:${h}px">${roomFeltHTML(48)}${three.map((a, i) => `<span class="scene-who" style="left:${Math.round(28 + i * (96 + gap))}px;top:${h - 108}px">${avatarHTML({ ...a, status: 'idle', on: true }, { size: 96, mood: 'idle', pose: 'mug' })}</span>`).join('')}</div>`
}

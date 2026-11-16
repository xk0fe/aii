// Plush little creatures, one per agent. Pure SVG: a fuzzy felt body (filtered) under a crisp face.
// An avatar is a spec { body, color, eyes, mouth, hat, cheeks }; agents without one get a stable random one from their name.
// From 64px up a creature can act out its status with a felt prop (a pose: poseOf below). The dark felt accessories
// (the beret, the headphones) carry class="av-acc" / "av-acc-line", so dark mode can lift them (common.css).

const INK = '#17161a'
const LINE = `fill="none" stroke="${INK}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"`
const THIN = `fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`

const COLORS = {
  blue: '#2f6bff', sky: '#3db8ff', lime: '#72d63a', mint: '#2fd3a6', yellow: '#ffc61f', orange: '#ff8a1f',
  pink: '#ff45a8', red: '#ff5252', purple: '#8b5cf6', lilac: '#c38bff', peach: '#ffa27f', teal: '#16b9c6',
}

// Each body: outline path, optional extra shapes (ears, eye bumps), and where its face and head-top sit (100x100 box).
const BODIES = {
  blob: {
    d: 'M21 96C10 96 4 88 8 79C1 71 5 57 17 54C16 41 29 32 42 37C48 26 64 25 71 35C85 33 95 45 90 57C98 63 98 77 90 83C93 91 88 96 80 96Z',
    eyes: [[40, 67], [60, 67]], mouth: [50, 77], top: [55, 31],
  },
  frog: {
    d: 'M9 96C7 73 24 57 50 57C76 57 93 73 91 96Z',
    extra: '<circle cx="31" cy="54" r="14.5"/><circle cx="69" cy="54" r="14.5"/>',
    eyes: [[31, 52], [69, 52]], mouth: [50, 80], top: [50, 41], wide: true,
  },
  drop: {
    d: 'M50 25C61 25 91 65 91 81C91 92 80 96 50 96C20 96 9 92 9 81C9 65 39 25 50 25Z',
    eyes: [[41, 70], [59, 70]], mouth: [50, 80], top: [50, 27],
  },
  heart: {
    d: 'M50 95C33 85 8 71 8 50C8 34 19 25 31 25C40 25 46 30 50 37C54 30 60 25 69 25C81 25 92 34 92 50C92 71 67 85 50 95Z',
    eyes: [[38, 55], [62, 55]], mouth: [50, 65], top: [69, 27],
  },
  bean: {
    d: 'M31 96C19 96 17 88 17 72V51C17 32 31 19 50 19C69 19 83 32 83 51V72C83 88 81 96 69 96Z',
    eyes: [[40, 53], [60, 53]], mouth: [50, 63], top: [50, 20],
  },
  mochi: {
    d: 'M5 96C5 71 25 51 50 51C75 51 95 71 95 96Z',
    eyes: [[37, 76], [63, 76]], mouth: [50, 84], top: [50, 51], wide: true,
  },
  cat: {
    d: 'M12 96C10 77 15 63 22 57L19 31L39 45C46 43 54 43 61 45L81 31L78 57C85 63 90 77 88 96Z',
    eyes: [[39, 67], [61, 67]], mouth: [50, 76], top: [50, 43],
  },
  bunny: {
    d: 'M14 96C12 75 28 59 50 59C72 59 88 75 86 96Z',
    extra: '<ellipse cx="38" cy="38" rx="8.5" ry="22" transform="rotate(-12 38 38)"/><ellipse cx="62" cy="38" rx="8.5" ry="22" transform="rotate(12 62 38)"/>',
    eyes: [[40, 77], [60, 77]], mouth: [50, 85], top: [50, 59],
  },
}

const EYES = {
  dot: (x, y) => `<ellipse cx="${x}" cy="${y}" rx="3.8" ry="5" fill="${INK}"/><circle cx="${x - 1.2}" cy="${y - 1.9}" r="1.35" fill="#fff"/>`,
  sparkle: (x, y) => `<ellipse cx="${x}" cy="${y}" rx="4.8" ry="5.9" fill="${INK}"/><circle cx="${x - 1.6}" cy="${y - 2.1}" r="2" fill="#fff"/><circle cx="${x + 1.7}" cy="${y + 2}" r="1" fill="#fff"/>`,
  googly: (x, y) => {
    const look = x < 50 ? 1.6 : -1.6
    return `<circle cx="${x}" cy="${y}" r="8" fill="#fff"/><circle cx="${x + look}" cy="${y + 1.2}" r="4.1" fill="${INK}"/><circle cx="${x + look - 1.3}" cy="${y - 0.4}" r="1.3" fill="#fff"/>`
  },
  happy: (x, y) => `<path d="M${x - 4.6} ${y + 1.6}Q${x} ${y - 4.6} ${x + 4.6} ${y + 1.6}" ${LINE}/>`,
  sleepy: (x, y) => `<path d="M${x - 4.6} ${y - 1}Q${x} ${y + 3.6} ${x + 4.6} ${y - 1}" ${LINE}/>`,
  line: (x, y) => `<path d="M${x - 4} ${y}H${x + 4}" ${LINE}/>`,
}

const MOUTHS = {
  none: () => '',
  smile: (x, y) => `<path d="M${x - 3.6} ${y}Q${x} ${y + 3.6} ${x + 3.6} ${y}" ${THIN}/>`,
  cat: (x, y) => `<path d="M${x - 5} ${y}Q${x - 2.5} ${y + 3.2} ${x} ${y}Q${x + 2.5} ${y + 3.2} ${x + 5} ${y}" ${THIN}/>`,
  grin: (x, y) => `<path d="M${x - 4.6} ${y - 0.6}Q${x} ${y + 7} ${x + 4.6} ${y - 0.6}Z" fill="${INK}"/><path d="M${x - 2.3} ${y + 2.9}Q${x} ${y + 5.2} ${x + 2.3} ${y + 2.9}Z" fill="#ff7a9c"/>`,
  o: (x, y) => `<ellipse cx="${x}" cy="${y + 1}" rx="2.3" ry="2.9" fill="${INK}"/>`,
}

// Felt accessories ride on the fuzzy body layer; glasses are crisp and sit on the face.
const HATS = {
  none: () => '',
  beret: ([x, y]) => `<g transform="translate(${x} ${y + 2}) rotate(-14)"><path class="av-acc-line" d="M-2 -10Q0 -17 5 -16" fill="none" stroke="#1d1c22" stroke-width="3.6" stroke-linecap="round"/><ellipse class="av-acc" cy="-2" rx="25" ry="10.5" fill="#1d1c22"/><ellipse cx="-6" cy="-6" rx="13" ry="3.5" fill="#fff" opacity=".1"/></g>`,
  party: ([x, y]) => `<g transform="translate(${x} ${y + 3}) rotate(10)"><path d="M-12 0L0 -28L12 0Z" fill="#ffd23f"/><path d="M-8.5 -8L6 -14M-5 -16L3.5 -20M-10.5 -3L9.5 -7" stroke="#ff5aa8" stroke-width="2.6" stroke-linecap="round"/><circle cy="-29" r="4.4" fill="#ff5aa8"/></g>`,
  crown: ([x, y]) => `<g transform="translate(${x} ${y + 2})"><path d="M-14 0L-16 -17L-7 -9L0 -21L7 -9L16 -17L14 0Z" fill="#ffcf3a" stroke="#f0a500" stroke-width="1.6" stroke-linejoin="round"/><circle cy="-5" r="2.6" fill="#ff5a7a"/><circle cx="-8" cy="-4" r="1.8" fill="#4dabf7"/><circle cx="8" cy="-4" r="1.8" fill="#4dabf7"/></g>`,
  bow: ([x, y]) => `<g transform="translate(${x + 13} ${y + 4}) rotate(18)"><path d="M0 0C-6 -10 -19 -10 -17 0C-19 10 -6 10 0 0Z" fill="#ff4fa3"/><path d="M0 0C6 -10 19 -10 17 0C19 10 6 10 0 0Z" fill="#ff4fa3"/><circle r="4.3" fill="#ff86c0"/></g>`,
  sprout: ([x, y]) => `<g transform="translate(${x} ${y + 2})"><path d="M0 0V-13" stroke="#2f9e44" stroke-width="3" stroke-linecap="round"/><path d="M0 -10C-2 -19 -13 -21 -16 -14C-11 -10 -5 -9 0 -10Z" fill="#51cf66"/><path d="M0 -12C2 -21 13 -23 16 -16C11 -12 5 -11 0 -12Z" fill="#69db7c"/></g>`,
  flower: ([x, y]) => `<g transform="translate(${x + 15} ${y + 6})">${[0, 72, 144, 216, 288].map((r) => `<ellipse cy="-6.5" rx="4.2" ry="6.5" fill="#fff" transform="rotate(${r})"/>`).join('')}<circle r="4.2" fill="#ffc61f"/></g>`,
  headphones: ([x, y], b) => {
    const w = b.wide ? 40 : 33
    return `<g transform="translate(${x} ${y + 18})"><path class="av-acc-line" d="M${-w} 6A${w} ${w + 4} 0 0 1 ${w} 6" fill="none" stroke="#25242b" stroke-width="5.5" stroke-linecap="round"/><rect class="av-acc" x="${-w - 6}" y="0" width="12" height="18" rx="6" fill="#25242b"/><rect class="av-acc" x="${w - 6}" y="0" width="12" height="18" rx="6" fill="#25242b"/><rect x="${-w - 3}" y="3" width="6" height="12" rx="3" fill="#ff5aa8"/><rect x="${w - 3}" y="3" width="6" height="12" rx="3" fill="#ff5aa8"/></g>`
  },
  glasses: () => '',
  shades: () => '',
}

const FACEWEAR = {
  glasses: (b) => {
    const r = b.wide ? 10 : 8.6
    const [[x1, y1], [x2, y2]] = b.eyes
    return `<circle cx="${x1}" cy="${y1}" r="${r}" fill="#fff" fill-opacity=".18" stroke="${INK}" stroke-width="2.3"/><circle cx="${x2}" cy="${y2}" r="${r}" fill="#fff" fill-opacity=".18" stroke="${INK}" stroke-width="2.3"/><path d="M${x1 + r} ${y1 - 1}Q50 ${y1 - 4} ${x2 - r} ${y2 - 1}" ${THIN}/>`
  },
  shades: (b) => {
    const r = b.wide ? 10.5 : 9.2
    const [[x1, y1], [x2, y2]] = b.eyes
    const lens = (x, y) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/><path d="M${x - r * 0.55} ${y - r * 0.3}Q${x - r * 0.3} ${y - r * 0.62} ${x + r * 0.05} ${y - r * 0.62}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.8" stroke-linecap="round"/>`
    return `${lens(x1, y1)}${lens(x2, y2)}<path d="M${x1 + r} ${y1 - 1}Q50 ${y1 - 4} ${x2 - r} ${y2 - 1}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`
  },
}

const PARTS = {
  body: Object.keys(BODIES),
  color: Object.keys(COLORS),
  eyes: ['dot', 'sparkle', 'googly', 'happy', 'line'],
  mouth: Object.keys(MOUTHS),
  hat: Object.keys(HATS),
}

function hash(s) {
  let h = 2166136261
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

// Every part gets its own hash of the name, so similar names still get clearly different creatures.
function seeded(name) {
  const pick = (part, list) => list[hash(`${name}:${part}`) % list.length]
  const body = pick('body', PARTS.body)
  return {
    body,
    color: pick('color', PARTS.color),
    eyes: body === 'frog' ? 'googly' : pick('eyes', ['dot', 'dot', 'sparkle', 'sparkle', 'happy']),
    mouth: pick('mouth', ['none', 'smile', 'cat', 'grin', 'none']),
    hat: pick('hat', ['none', 'none', 'beret', 'glasses', 'shades', 'bow', 'sprout', 'party', 'crown', 'flower', 'headphones']),
    cheeks: pick('cheeks', [true, true, true, false]),
  }
}

// Whatever the look doesn't set comes from a seed: the name it was made with (kept through imports and moves).
const avatarOf = (agent) => ({ ...seeded(agent.avatar?.seed ?? agent.seed ?? agent.name), ...agent.avatar })
const agentColor = (agent) => COLORS[avatarOf(agent).color] ?? avatarOf(agent).color ?? '#888'

function randomAvatar() {
  const any = (list) => list[Math.floor(Math.random() * list.length)]
  const spec = seeded(Math.random())
  return { ...spec, hat: any(PARTS.hat), mouth: any(PARTS.mouth) }
}

// The SVG filter + gradients are shared by every avatar on the page.
function ensureDefs() {
  if (document.getElementById('av-defs')) return
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<svg id="av-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
      <filter id="av-fuzz" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="4.2" xChannelSelector="R" yChannelSelector="G" result="fuzz"/>
        <feTurbulence type="fractalNoise" baseFrequency="2.1" numOctaves="2" seed="11" result="g"/>
        <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .9 0 0 0 -.38" result="grain"/>
        <feComposite in="grain" in2="fuzz" operator="in" result="felt"/>
        <feComposite in="felt" in2="fuzz" operator="over"/>
      </filter>
      <radialGradient id="av-hi" cx=".32" cy=".2" r=".72"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset=".45" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <radialGradient id="av-lo" cx=".55" cy="1.08" r=".8"><stop offset=".15" stop-color="#000" stop-opacity=".34"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs></svg>`,
  )
}

const MOODS = { working: 'working', waiting: 'waiting', starting: 'starting', off: 'sleep', stopped: 'sleep', parked: 'sleep', away: 'sleep' }
const colorOf = (spec) => COLORS[spec.color] ?? spec.color

// How far each kind of eye reaches above and below its center (Chrome's tight bounds of the shapes in EYES), so the
// blink squeezes about the middle of the eyes.
const EYE_EXTENT = { dot: [-5, 5], sparkle: [-5.9, 5.9], googly: [-8, 8], happy: [-1.5, 1.6], sleepy: [-1, 1.3], line: [0, 0] }

// The same agent, look, size and mood always draw the same creature, and the views redraw often: built once.
const avatarCache = new Map()

// agent: anything with a name (+ optional avatar/status). Big avatars get the felt filter; tiny ones skip it.
// pose: the creature acts out its status with a felt prop, 'laptop' | 'mug' | 'sign' | 'question' | 'pop' | 'sleep'
// (poseOf picks one from a status). Only from 64px up: smaller creatures stay plain, except at work: a working
// creature sits at its laptop at every size (below POSE_MIN a simpler one, drawn to read small: LAPTOP_SMALL).
function avatarHTML(agent, { size = 48, mood, pose, poseMin = POSE_MIN } = {}) {
  ensureDefs()
  // waiting on a teammate's answer, it rests instead of working: it isn't working, it's waiting (core/hub.js question)
  mood ??= agent.status === 'working' && agent.waitingOn?.length ? 'idle' : (MOODS[agent.status] ?? 'idle')
  if (size < poseMin || !POSES.has(pose)) pose = undefined
  if (mood === 'working') pose ??= 'laptop'
  const key = `${agent.name}\u0000${agent.seed ?? ''}\u0000${size}\u0000${mood}\u0000${pose ?? ''}\u0000${asleepNow(agent, mood) ? 1 : 0}\u0000${agent.avatar ? JSON.stringify(agent.avatar) : ''}`
  let html = avatarCache.get(key)
  if (html === undefined) {
    if (avatarCache.size > 2000) avatarCache.clear()
    avatarCache.set(key, (html = creatureHTML(agent, size, mood, pose)))
  }
  return html
}

// Asleep: off, stopped, parked, or on a computer that's asleep. It's drawn in black and white, whatever its mood (a
// still face in a list included), so an agent that isn't running never shows its colours.
const asleepNow = (agent, mood) => mood === 'sleep' || agent.on === false || ['off', 'stopped', 'parked', 'away'].includes(agent.status)

// ---- poses: the creature acts out its status with a felt prop ----
const POSES = new Set(['laptop', 'mug', 'sign', 'question', 'pop', 'sleep'])
const POSE_MIN = 64
// Which pose a status gets: at a laptop while it works, a mug while it's free (or waits on a teammate's answer), a
// sign that asks "OK?" while it needs your OK, a speech bubble while it has a question (ask: the open ask's type),
// popping up from its patch while it starts, asleep while it's off. The status text and dot stay as they are; the pose
// only adds the character.
function poseOf(agent, { ask } = {}) {
  if (!agent) return undefined
  if (agent.on === false || agent.status === 'off' || agent.status === 'stopped' || agent.status === 'parked' || agent.status === 'away') return 'sleep'
  if (agent.status === 'waiting') return ask === 'question' ? 'question' : 'sign'
  if (agent.status === 'working') return agent.waitingOn?.length ? 'mug' : 'laptop'
  if (agent.status === 'starting') return 'pop'
  if (agent.status === 'idle' || agent.status === 'resting') return 'mug'
  return undefined
}
// Where each body's right side sits around paw height (100x100 box), so a paw can reach the stick of a sign.
const SIDE = { blob: 92, frog: 89, drop: 86, heart: 86, bean: 83, mochi: 90, cat: 87, bunny: 85 }
// Felt for the props: soft warm neutrals, so the creature's own colour stays the only loud one.
const PROP = { lid: '#dfe2e8', base: '#a3a9b4', mug: '#f6efe3', band: '#ff9478', coffee: '#7b4a2c', steam: '#c9c1b6', board: '#fff3d6', wood: '#c48a55', bubble: '#fffaf1', hole: '#2a2230', zz: '#a69fd0' }
const BRAND_FACE = 'Fredoka, ui-rounded, "SF Pro Rounded", sans-serif'
const LAPTOP_SMALL = { s: 0.86, lid: 67, gap: 3, w: 27, fill: '#b4bac6', base: '#7f8694', logo: 4.2, paw: 15, pawR: 6 }

// What a pose adds: how the figure sits (scale s, shift dx/dy in % of the box, tilt rot, clip from the bottom) and the
// felt layers around it: back (behind), held (moves with the creature), stand (in front, still), paws (typing), float.
function poseLayers(pose, b, body, color, fuzz, size) {
  const felt = (shape, fill) => `<g ${fuzz}><g fill="${fill}">${shape}</g><g fill="url(#av-hi)">${shape}</g><g fill="url(#av-lo)">${shape}</g></g>`
  const paw = (x, y, rx = 5, ry = 3.8) => felt(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`, color)
  if (pose === 'laptop' && size < POSE_MIN) {
    // The small laptop, as an emoji draws one: a few chunky shapes in a silver that reads on a light and on a dark
    // window, and no fine detail. The creature stays as large as it can with its mouth clear of the lid.
    const L = LAPTOP_SMALL
    const s = L.s, lid = L.lid
    const mouth = 97 - (97 - b.mouth[1]) * s
    const dy = -Math.max(0, mouth + L.gap - lid)
    const stand = felt(`<path d="M${50 - L.w + 2} ${lid + 4}Q${50 - L.w + 2} ${lid} ${50 - L.w + 6} ${lid}H${50 + L.w - 6}Q${50 + L.w - 2} ${lid} ${50 + L.w - 2} ${lid + 4}L${50 + L.w} 92H${50 - L.w}Z"/>`, L.fill) +
      felt(`<rect x="${50 - L.w - 9}" y="90" width="${2 * L.w + 18}" height="7" rx="3.5"/>`, L.base) +
      `<circle cx="50" cy="${(lid + 90) / 2 + 0.5}" r="${L.logo}" fill="#fff" opacity=".9"/>`
    return { s, dx: 0, dy, small: true, stand, paws: [paw(50 - L.paw, lid + 0.5, L.pawR, L.pawR * 0.8), paw(50 + L.paw, lid + 0.5, L.pawR, L.pawR * 0.8)] }
  }
  if (pose === 'laptop') {
    const s = 0.84, lid = 70
    const mouth = 97 - (97 - b.mouth[1]) * s
    const dy = -Math.max(4, mouth + 5 - lid)
    const stand = `<ellipse cx="50" cy="96.8" rx="35" ry="2.8" fill="#000" opacity=".2"/>` +
      felt(`<path d="M27 ${lid + 3}Q27 ${lid} 30 ${lid}H70Q73 ${lid} 73 ${lid + 3}L75 92H25Z"/>`, PROP.lid) +
      felt('<rect x="18" y="90.5" width="64" height="5.5" rx="2.75"/>', PROP.base) +
      `<path d="M45.5 ${lid + 14.5}Q45.5 ${lid + 9.5} 50 ${lid + 9.5}Q54.5 ${lid + 9.5} 54.5 ${lid + 14.5}Z" fill="#fff" opacity=".6"/>`
    return { s, dx: 0, dy, stand, paws: [paw(37, lid + 0.6), paw(63, lid + 0.6)] }
  }
  if (pose === 'mug') {
    const s = 0.88
    const eye = 50 + (b.eyes[1][0] - 50) * s
    const mx = Math.min(72, Math.max(62, eye + 7))
    const held = felt(`<rect x="${mx}" y="71" width="19" height="22" rx="4"/>`, PROP.mug) +
      `<g ${fuzz}><path d="M${mx + 18} 76q7.5 0 7.5 6t-7.5 6" fill="none" stroke="${PROP.mug}" stroke-width="3.4" stroke-linecap="round"/>` +
      `<rect x="${mx}" y="80" width="19" height="4" fill="${PROP.band}" opacity=".85"/><ellipse cx="${mx + 9.5}" cy="72.6" rx="7.8" ry="1.9" fill="${PROP.coffee}"/></g>` +
      paw(mx + 1, 85, 5, 4.6)
    const float = `<path d="M${mx + 6} 67q-2.6-3.2 0-6.4t0-6.4M${mx + 13} 67q-2.6-3.2 0-6.4t0-6.4" stroke="${PROP.steam}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
    return { s, dx: -3, dy: -1, rot: -4, held, float }
  }
  if (pose === 'sign') {
    const s = 0.84
    const px = 50 + ((SIDE[body] ?? 88) - 50) * s
    const dx = Math.min(6, 80 - px)
    const x = 50 + ((SIDE[body] ?? 88) - 50) * s + dx + 2
    const held = felt(`<rect x="${x - 1.6}" y="34" width="3.2" height="58" rx="1.6"/>`, PROP.wood) +
      felt(`<rect x="${x - 15}" y="11" width="30" height="25" rx="4.5"/>`, PROP.board) +
      `<text x="${x}" y="28.3" text-anchor="middle" font-family='${BRAND_FACE}' font-weight="700" font-size="11.5" fill="${INK}">OK?</text>` +
      paw(x - 0.5, 66, 4.8, 4.6)
    return { s, dx, dy: 0, held }
  }
  if (pose === 'question') {
    const bubble = '<path d="M67 2H89Q98 2 98 11V20Q98 29 89 29H75L63 38L67 29Q58 29 58 20V11Q58 2 67 2Z"/>'
    const float = felt(bubble, PROP.bubble) +
      `<path d="M67 2H89Q98 2 98 11V20Q98 29 89 29H75L63 38L67 29Q58 29 58 20V11Q58 2 67 2Z" fill="none" stroke="#000" stroke-opacity=".08" stroke-width=".8"/>` +
      `<text x="78" y="22.5" text-anchor="middle" font-family='${BRAND_FACE}' font-weight="700" font-size="19" fill="${INK}">?</text>`
    return { s: 0.82, dx: -8, dy: 0, float }
  }
  if (pose === 'pop') {
    // it rises out of a hole in its patch: sunk until its eyes sit just above the rim (short bodies barely sink)
    const s = 0.9, rim = 87
    const eyes = 97 - (97 - Math.max(b.eyes[0][1], b.eyes[1][1])) * s
    const dy = Math.max(0, Math.min(14, rim - 9 - eyes))
    const back = felt(`<ellipse cx="50" cy="${rim}" rx="46" ry="9"/>`, PROP.hole) + `<ellipse cx="50" cy="${rim + 1}" rx="38" ry="6" fill="#000" opacity=".35"/>`
    const float = felt('<circle cx="12" cy="78" r="2.8"/><circle cx="88" cy="72" r="2.3"/><circle cx="82" cy="60" r="1.7"/><circle cx="20" cy="64" r="1.6"/>', color)
    return { s, dx: 0, dy, clip: 100 - rim, back, float }
  }
  if (pose === 'sleep') {
    // felt letters: chunky, softly outlined in their own colour (the fuzz filter would melt letters this small)
    const z = (x, y, fs) => `<text x="${x}" y="${y}" font-family='${BRAND_FACE}' font-weight="700" font-size="${fs}" stroke="${PROP.zz}" stroke-width="1.2" stroke-linejoin="round">z</text>`
    const float = `<g fill="${PROP.zz}">${z(72, 34, 22)}${z(86, 17, 15)}</g>`
    return { s: 0.86, dx: -6, dy: 0, rot: 3, float }
  }
  return null
}

// The eyes are an <svg> of their own in a <span>, between the cheeks and the mouth, so the blink is a transform on an
// HTML element rather than inside an SVG (Chrome only plays those on the compositor): a page full of blinking
// creatures costs no main-thread frames. Same picture as one face <svg>: three layers drawn in the same order, and
// the eyes and what's drawn over them (.av-eye, .av-front) are layered as Chrome layers a blinking SVG group, so
// they land on the same pixels as before (see common.css).
function creatureHTML(agent, size, mood, pose) {
  const s = avatarOf(agent)
  const b = BODIES[s.body] ?? BODIES.blob
  const color = COLORS[s.color] ?? s.color
  const asleep = mood === 'sleep'
  const fuzz = size >= 40 ? 'filter="url(#av-fuzz)"' : ''
  const shape = `${b.extra ?? ''}<path d="${b.d}"/>`
  const look = asleep ? 'sleepy' : EYES[s.eyes] ? s.eyes : 'dot'
  const eye = EYES[look]
  const [[x1, y1], [x2, y2]] = b.eyes
  const cheeks = s.cheeks
    ? `<ellipse cx="${x1 - 6}" cy="${y1 + 7}" rx="5" ry="3" fill="#ff5c9d" opacity=".42"/><ellipse cx="${x2 + 6}" cy="${y2 + 7}" rx="5" ry="3" fill="#ff5c9d" opacity=".42"/>`
    : ''
  const [lo, hi] = EYE_EXTENT[look]
  const pivot = +((Math.min(x1, x2) + Math.max(x1, x2)) / 2).toFixed(3) + '% ' + +((Math.min(y1, y2) + lo + Math.max(y1, y2) + hi) / 2).toFixed(3) + '%'
  const eyes = s.hat === 'shades' ? '' : `<span class="av-face av-eyes" style="transform-origin:${pivot}"><svg viewBox="0 0 100 100" aria-hidden="true"><g class="av-eye">${eye(x1, y1)}${eye(x2, y2)}</g></svg></span>`
  const front = `${(MOUTHS[s.mouth] ?? MOUTHS.none)(...b.mouth)}${FACEWEAR[s.hat]?.(b) ?? ''}`
  const over = front && `<g class="av-front">${front}</g>`
  const delay = -((hash(agent.name) % 4000) / 1000).toFixed(2)
  const grey = asleepNow(agent, mood)
  const sig = hash(JSON.stringify([s, mood, size, pose ?? '', grey])) // lets morph() keep a running avatar untouched
  const p = pose ? poseLayers(pose, b, s.body, color, fuzz, size) : null
  const layer = (cls, inner) => (inner ? `<svg viewBox="0 0 100 100" class="av-prop ${cls}" aria-hidden="true">${inner}</svg>` : '')
  let figure = `<svg viewBox="0 0 100 100" class="av-body" aria-hidden="true">
        <ellipse cx="50" cy="97.5" rx="33" ry="3.2" fill="#000" opacity=".22"/>
        <g ${fuzz}>
          <g fill="${color}">${shape}</g><g fill="url(#av-hi)">${shape}</g><g fill="url(#av-lo)">${shape}</g>
          ${HATS[s.hat]?.(b.top, b) ?? ''}
        </g>
      </svg>
      ${cheeks ? `<svg viewBox="0 0 100 100" class="av-face" aria-hidden="true">${cheeks}</svg>` : ''}${eyes}${over ? `<svg viewBox="0 0 100 100" class="av-face" aria-hidden="true">${over}</svg>` : ''}`
  if (p) {
    figure = `<span class="av-fig" style="transform:translate(${+p.dx.toFixed(2)}%, ${+p.dy.toFixed(2)}%) rotate(${p.rot ?? 0}deg) scale(${p.s})">${figure}</span>`
    if (p.clip) figure = `<span class="av-clip" style="clip-path:inset(-40% -40% ${p.clip}% -40%)">${figure}</span>`
  }
  const paws = p?.paws ? p.paws.map((g, i) => `<span class="av-paw p${i}">${layer('', g)}</span>`).join('') : ''
  return `<span class="av ${mood}${pose ? ` posed pose-${pose}` : ''}${p?.small ? ' small' : ''}${grey ? ' asleep' : ''}" data-sig="${sig}" style="--size:${size}px;--delay:${delay}s" title="${String(agent.name).replace(/"/g, '')}">
    ${layer('av-back', p?.back)}<span class="av-in">
      ${figure}${layer('av-held', p?.held)}
    </span>${layer('av-stand', p?.stand)}${paws}${p?.float ? `<span class="av-float">${layer('', p.float)}</span>` : ''}
    ${mood === 'waiting' ? '<span class="av-bang">!</span>' : ''}${asleep && pose !== 'sleep' ? '<span class="av-z">z</span>' : ''}
  </span>`
}

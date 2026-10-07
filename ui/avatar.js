// Plush little creatures, one per agent. Pure SVG: a fuzzy felt body (filtered) under a crisp face.
// An avatar is a spec { body, color, eyes, mouth, hat, cheeks }; agents without one get a stable random one from their name.

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
  beret: ([x, y]) => `<g transform="translate(${x} ${y + 2}) rotate(-14)"><path d="M-2 -10Q0 -17 5 -16" fill="none" stroke="#1d1c22" stroke-width="3.6" stroke-linecap="round"/><ellipse cy="-2" rx="25" ry="10.5" fill="#1d1c22"/><ellipse cx="-6" cy="-6" rx="13" ry="3.5" fill="#fff" opacity=".1"/></g>`,
  party: ([x, y]) => `<g transform="translate(${x} ${y + 3}) rotate(10)"><path d="M-12 0L0 -28L12 0Z" fill="#ffd23f"/><path d="M-8.5 -8L6 -14M-5 -16L3.5 -20M-10.5 -3L9.5 -7" stroke="#ff5aa8" stroke-width="2.6" stroke-linecap="round"/><circle cy="-29" r="4.4" fill="#ff5aa8"/></g>`,
  crown: ([x, y]) => `<g transform="translate(${x} ${y + 2})"><path d="M-14 0L-16 -17L-7 -9L0 -21L7 -9L16 -17L14 0Z" fill="#ffcf3a" stroke="#f0a500" stroke-width="1.6" stroke-linejoin="round"/><circle cy="-5" r="2.6" fill="#ff5a7a"/><circle cx="-8" cy="-4" r="1.8" fill="#4dabf7"/><circle cx="8" cy="-4" r="1.8" fill="#4dabf7"/></g>`,
  bow: ([x, y]) => `<g transform="translate(${x + 13} ${y + 4}) rotate(18)"><path d="M0 0C-6 -10 -19 -10 -17 0C-19 10 -6 10 0 0Z" fill="#ff4fa3"/><path d="M0 0C6 -10 19 -10 17 0C19 10 6 10 0 0Z" fill="#ff4fa3"/><circle r="4.3" fill="#ff86c0"/></g>`,
  sprout: ([x, y]) => `<g transform="translate(${x} ${y + 2})"><path d="M0 0V-13" stroke="#2f9e44" stroke-width="3" stroke-linecap="round"/><path d="M0 -10C-2 -19 -13 -21 -16 -14C-11 -10 -5 -9 0 -10Z" fill="#51cf66"/><path d="M0 -12C2 -21 13 -23 16 -16C11 -12 5 -11 0 -12Z" fill="#69db7c"/></g>`,
  flower: ([x, y]) => `<g transform="translate(${x + 15} ${y + 6})">${[0, 72, 144, 216, 288].map((r) => `<ellipse cy="-6.5" rx="4.2" ry="6.5" fill="#fff" transform="rotate(${r})"/>`).join('')}<circle r="4.2" fill="#ffc61f"/></g>`,
  headphones: ([x, y], b) => {
    const w = b.wide ? 40 : 33
    return `<g transform="translate(${x} ${y + 18})"><path d="M${-w} 6A${w} ${w + 4} 0 0 1 ${w} 6" fill="none" stroke="#25242b" stroke-width="5.5" stroke-linecap="round"/><rect x="${-w - 6}" y="0" width="12" height="18" rx="6" fill="#25242b"/><rect x="${w - 6}" y="0" width="12" height="18" rx="6" fill="#25242b"/><rect x="${-w - 3}" y="3" width="6" height="12" rx="3" fill="#ff5aa8"/><rect x="${w - 3}" y="3" width="6" height="12" rx="3" fill="#ff5aa8"/></g>`
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

const MOODS = { working: 'working', waiting: 'waiting', starting: 'starting', off: 'sleep', stopped: 'sleep' }
const colorOf = (spec) => COLORS[spec.color] ?? spec.color

// agent: anything with a name (+ optional avatar/status). Big avatars get the felt filter; tiny ones skip it.
function avatarHTML(agent, { size = 48, mood } = {}) {
  ensureDefs()
  const s = avatarOf(agent)
  const b = BODIES[s.body] ?? BODIES.blob
  const color = COLORS[s.color] ?? s.color
  mood ??= MOODS[agent.status] ?? 'idle'
  const asleep = mood === 'sleep'
  const shape = `${b.extra ?? ''}<path d="${b.d}"/>`
  const eye = EYES[asleep ? 'sleepy' : s.eyes] ?? EYES.dot
  const [[x1, y1], [x2, y2]] = b.eyes
  const cheeks = s.cheeks
    ? `<ellipse cx="${x1 - 6}" cy="${y1 + 7}" rx="5" ry="3" fill="#ff5c9d" opacity=".42"/><ellipse cx="${x2 + 6}" cy="${y2 + 7}" rx="5" ry="3" fill="#ff5c9d" opacity=".42"/>`
    : ''
  const delay = -((hash(agent.name) % 4000) / 1000).toFixed(2)
  const sig = hash(JSON.stringify([s, mood, size])) // lets morph() keep a running avatar untouched
  return `<span class="av ${mood}" data-sig="${sig}" style="--size:${size}px;--delay:${delay}s" title="${String(agent.name).replace(/"/g, '')}">
    <span class="av-in">
      <svg viewBox="0 0 100 100" class="av-body" aria-hidden="true">
        <ellipse cx="50" cy="97.5" rx="33" ry="3.2" fill="#000" opacity=".22"/>
        <g ${size >= 40 ? 'filter="url(#av-fuzz)"' : ''}>
          <g fill="${color}">${shape}</g><g fill="url(#av-hi)">${shape}</g><g fill="url(#av-lo)">${shape}</g>
          ${HATS[s.hat]?.(b.top, b) ?? ''}
        </g>
      </svg>
      <svg viewBox="0 0 100 100" class="av-face" aria-hidden="true">
        ${cheeks}
        ${s.hat === 'shades' ? '' : `<g class="av-eyes">${eye(x1, y1)}${eye(x2, y2)}</g>`}
        ${(MOUTHS[s.mouth] ?? MOUTHS.none)(...b.mouth)}
        ${FACEWEAR[s.hat]?.(b) ?? ''}
      </svg>
    </span>
    ${mood === 'waiting' ? '<span class="av-bang">!</span>' : ''}${asleep ? '<span class="av-z">z</span>' : ''}
  </span>`
}

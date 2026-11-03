// Felt without SVG filters. On the Mac the creatures' felt is an SVG filter (avatar.js av-fuzz: a displacement map for
// the fuzzy edge, turbulence for the fibre grain); react-native-svg runs neither. So the fuzzy edge is geometry here:
// the outline walked in small steps, each point pushed in or out a little by noise that's the same every time. The
// grain is a bundled texture (assets/images/felt-*.png, rendered from the same turbulence) laid over the shape.
// Plain TypeScript, no React: the tests check it.

export type Pt = [number, number]

const r1 = (n: number) => Math.round(n * 10) / 10

// An SVG path's outline as polygons, one per subpath: M L H V C S Q T Z, absolute and relative (what the creatures and
// their props are drawn with). Curves become short straight steps.
export function flatten(d: string): Pt[][] {
  const out: Pt[][] = []
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? []
  let i = 0
  let cmd = ''
  let cur: Pt = [0, 0]
  let start: Pt = [0, 0]
  let ctrl: Pt | null = null // the last curve's second control point, for S and T
  let poly: Pt[] = []
  const num = () => Number(tokens[i++])
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])
  const close = () => {
    if (poly.length > 1) out.push(poly)
    poly = []
  }
  const cubic = (p1: Pt, p2: Pt, p3: Pt) => {
    const p0 = cur
    const n = 12
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const u = 1 - t
      poly.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]])
    }
    cur = p3
  }
  const quad = (p1: Pt, p2: Pt) => {
    const p0 = cur
    const n = 10
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const u = 1 - t
      poly.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]])
    }
    cur = p2
  }
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++]
    else if (!cmd) break
    const rel = cmd === cmd.toLowerCase()
    const at = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y])
    switch (cmd.toUpperCase()) {
      case 'M': {
        close()
        cur = at(num(), num())
        start = cur
        poly = [cur]
        cmd = rel ? 'l' : 'L' // more pairs after a moveto are linetos
        ctrl = null
        break
      }
      case 'L':
        cur = at(num(), num())
        poly.push(cur)
        ctrl = null
        break
      case 'H': {
        const x = num()
        cur = [rel ? cur[0] + x : x, cur[1]]
        poly.push(cur)
        ctrl = null
        break
      }
      case 'V': {
        const y = num()
        cur = [cur[0], rel ? cur[1] + y : y]
        poly.push(cur)
        ctrl = null
        break
      }
      case 'C': {
        const p1 = at(num(), num())
        const p2 = at(num(), num())
        const p3 = at(num(), num())
        cubic(p1, p2, p3)
        ctrl = p2
        break
      }
      case 'S': {
        const p1: Pt = ctrl ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur
        const p2 = at(num(), num())
        const p3 = at(num(), num())
        cubic(p1, p2, p3)
        ctrl = p2
        break
      }
      case 'Q': {
        const p1 = at(num(), num())
        const p2 = at(num(), num())
        quad(p1, p2)
        ctrl = p1
        break
      }
      case 'T': {
        const p1: Pt = ctrl ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur
        const p2 = at(num(), num())
        quad(p1, p2)
        ctrl = p1
        break
      }
      case 'Z':
        cur = start
        close()
        ctrl = null
        while (isNum()) i++ // nothing follows a closepath
        break
      default:
        // an arc or anything else: not used by anything this draws
        while (isNum()) i++
    }
  }
  close()
  return out
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rotate = 0): Pt[] {
  const n = 48
  const a = (rotate * Math.PI) / 180
  const pts: Pt[] = []
  for (let k = 0; k < n; k++) {
    const t = (k / n) * 2 * Math.PI
    const x = rx * Math.cos(t)
    const y = ry * Math.sin(t)
    pts.push([cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)])
  }
  return pts
}

export function roundRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  const pts: Pt[] = []
  const corner = (cx: number, cy: number, from: number) => {
    for (let k = 0; k <= 6; k++) {
      const t = ((from + (k / 6) * 90) * Math.PI) / 180
      pts.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)])
    }
  }
  corner(x + w - rr, y + rr, -90)
  corner(x + w - rr, y + h - rr, 0)
  corner(x + rr, y + h - rr, 90)
  corner(x + rr, y + rr, 180)
  return pts
}

// A small stable noise: the same seed and index give the same number, in [-1, 1].
function noise(seed: number, i: number) {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 0x7fffffff - 1
}

// The polygon's outline resampled every `step` and pushed along its normal by up to `amp`: a soft hum (neighbouring
// fibres lean the same way) plus a sharper fringe, like av-fuzz's displacement of a shape's edge.
export function fuzz(poly: Pt[], seed: number, { amp = 1.5, step = 0.75 } = {}): Pt[] {
  if (poly.length < 3) return poly
  const ring = [...poly, poly[0]]
  const seg: number[] = []
  let total = 0
  for (let k = 1; k < ring.length; k++) {
    const l = Math.hypot(ring[k][0] - ring[k - 1][0], ring[k][1] - ring[k - 1][1])
    seg.push(l)
    total += l
  }
  if (!total) return poly
  const n = Math.max(12, Math.round(total / step))
  const out: Pt[] = []
  let k = 0
  let walked = 0
  for (let s = 0; s < n; s++) {
    const want = (s / n) * total
    while (k < seg.length - 1 && walked + seg[k] < want) walked += seg[k++]
    const t = seg[k] ? (want - walked) / seg[k] : 0
    const [ax, ay] = ring[k]
    const [bx, by] = ring[k + 1]
    const len = seg[k] || 1
    const nx = (by - ay) / len
    const ny = -(bx - ax) / len
    const hum = (noise(seed, Math.floor(s / 4)) * (4 - (s % 4)) + noise(seed, Math.floor(s / 4) + 1) * (s % 4)) / 4
    const d = amp * (0.45 * hum + 0.55 * noise(seed + 7, s))
    out.push([ax + (bx - ax) * t + nx * d, ay + (by - ay) * t + ny * d])
  }
  return out
}

export const toPath = (polys: Pt[][]) => polys.map((p) => `M${p.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`).join('')

// The fuzzy version of a path, ellipse or rounded rectangle, made once per shape.
const made = new Map<string, string>()
export function fuzzy(key: string, polys: () => Pt[][], seed: number, opts?: { amp?: number; step?: number }) {
  const k = `${key}|${seed}|${opts?.amp ?? ''}|${opts?.step ?? ''}`
  let d = made.get(k)
  if (d === undefined) {
    if (made.size > 400) made.clear()
    made.set(k, (d = toPath(polys().map((p) => fuzz(p, seed, opts)))))
  }
  return d
}

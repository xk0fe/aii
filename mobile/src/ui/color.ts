// Small color math for what CSS does with color-mix() and filters on the Mac.

type RGBA = [number, number, number, number]

export function parse(color: string): RGBA {
  const c = color.trim()
  if (c.startsWith('#')) {
    const h = c.slice(1)
    const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1]
  }
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim())
    return [Number(r), Number(g), Number(b), Number(a)]
  }
  return [136, 136, 136, 1]
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
export const hex = ([r, g, b]: RGBA | [number, number, number]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`
export const rgba = (color: string, alpha: number) => {
  const [r, g, b] = parse(color)
  return `rgba(${r},${g},${b},${alpha})`
}

// color-mix(in srgb, a p%, b): p of a, the rest of b (alpha ignored: both are solid here)
export function mix(a: string, b: string, p: number) {
  const x = parse(a)
  const y = parse(b)
  return hex([x[0] * p + y[0] * (1 - p), x[1] * p + y[1] * (1 - p), x[2] * p + y[2] * (1 - p)])
}

// CSS's saturate() then brightness(), as the Mac dims a sleeping creature (saturate(.3) brightness(.82)).
export function dim(color: string, s = 0.3, b = 0.82) {
  const [r, g, bl, a] = parse(color)
  const out: RGBA = [
    ((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * bl) * b,
    ((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * bl) * b,
    ((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * bl) * b,
    a,
  ]
  return hex(out)
}

// An agent's name in its creature's color, mixed toward the text color so it reads on either background (the Mac's
// color-mix(in oklab, var(--c) 62%, var(--fg))). Never the raw creature color.
export const nameInk = (creature: string, fg: string, p = 0.62) => mix(creature, fg, p)

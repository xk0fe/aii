// Canvases: a ```canvas block in a message, drawn as a hand-drawn board instead of shown as code.
// The agent writes lines of plain data and no coordinates; this file lays them out and returns one SVG string.
// Nothing here runs what the agent wrote, and every word is escaped on its way into the SVG.
//
//   title: One small task, enormous practice     the heading
//   sub: how a model learns to answer            a grey line under it
//   1: [The] [sky] [is] -> [blue]{pink}          a numbered row: [boxes], -> arrows, -label-> arrows, plain words
//   Your question -> [an answer]{green}          a row without a number
//   bar: Green 0.6713 {green}                    bars next to each other share one scale: the last number is the value
//   ok: hashes verified                          a tick and a line
//   no: not human-reviewed                       a cross and a line
//   note: proxy scores, not accuracy {yellow}    a sticky note
//   source: selected-v1-aggregate.json           a small grey credit
// Anywhere in a row: ==words== are highlighted, ✓ and ✗ are drawn. Colours: yellow pink blue green orange purple grey.
// The look is in common.css (.canvas, .cv-*): the pen draws each stroke once, in order, and then holds still.

const CV_W = 640
const CV_PAD = 18
const CV_MAX_LINES = 80
// Patrick Hand's advance widths for ASCII 32..126, in hundredths of the font size, so a board is laid out without a DOM
const CV_ADV = [23, 25, 30, 46, 51, 64, 53, 16, 33, 36, 40, 48, 20, 40, 21, 42, 45, 36, 47, 45, 38, 42, 40, 50, 43, 37, 23, 23, 40, 57, 40, 37, 55, 49, 51, 55, 48, 44, 38, 48, 47, 24, 37, 52, 37, 60, 53, 56, 48, 66, 45, 46, 47, 55, 56, 62, 60, 44, 51, 30, 42, 30, 37, 57, 22, 39, 41, 39, 39, 40, 36, 44, 42, 22, 24, 42, 27, 68, 45, 40, 43, 46, 38, 38, 34, 40, 40, 46, 45, 42, 43, 34, 18, 33, 53]
const CV_TONES = { yellow: 'yellow', butter: 'yellow', pink: 'pink', red: 'pink', berry: 'pink', blue: 'blue', sky: 'blue', green: 'green', mint: 'green', orange: 'orange', peach: 'orange', purple: 'purple', lilac: 'purple', violet: 'purple', grey: 'grey', gray: 'grey' }

const cvEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const cvWidth = (text, size) => {
  let w = 0
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    w += c >= 32 && c < 127 ? CV_ADV[c - 32] : c >= 0x2e80 ? 100 : 50
  }
  return (w * size) / 100
}
// words wrapped to a width, a word longer than the width on a line of its own
function cvWrap(text, size, max) {
  const lines = []
  let line = ''
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && cvWidth(next, size) > max) (lines.push(line), (line = word))
    else line = next
  }
  if (line) lines.push(line)
  return lines
}

// One row's pieces: boxes, arrows, highlights, ticks, crosses and words
function cvTokens(line) {
  const out = []
  const re = /\[([^\]\n]+)\](?:\{(\w+)\})?|(?<!\S)-(?:([^>\n]+?)-|-*)>|→|=>|==(.+?)==(?:\{(\w+)\})?|[✓✔]|[✗✘✕]|[^\s[]+|\[/gu
  for (const m of line.matchAll(re)) {
    const t = m[0]
    if (m[1] !== undefined) out.push({ kind: 'box', text: m[1].trim(), tone: CV_TONES[m[2]?.toLowerCase()] ?? 'blue' })
    else if (m[4] !== undefined) out.push({ kind: 'hl', text: m[4].trim(), tone: CV_TONES[m[5]?.toLowerCase()] ?? 'yellow' })
    else if (t === '→' || t === '=>' || /^-.*>$/.test(t)) out.push({ kind: 'arrow', label: (m[3] ?? '').trim() })
    else if (/^[✓✔]$/u.test(t)) out.push({ kind: 'ok' })
    else if (/^[✗✘✕]$/u.test(t)) out.push({ kind: 'no' })
    else out.push({ kind: 'word', text: t })
  }
  return out
}

// A board's lines, read: [{ kind, ... }]. Lines it can't place as anything else are rows of words.
function cvParse(src) {
  const items = []
  for (const raw of String(src).split('\n').slice(0, CV_MAX_LINES)) {
    const line = raw.trim()
    if (!line) continue
    let m
    const toned = (text, fallback) => {
      const t = text.match(/^(.*?)\s*\{(\w+)\}$/)
      return t && CV_TONES[t[2].toLowerCase()] ? [t[1], CV_TONES[t[2].toLowerCase()]] : [text, fallback]
    }
    if ((m = line.match(/^(title|sub|ok|no|note|source|bar)\s*:\s*(.+)$/i))) {
      const kind = m[1].toLowerCase()
      if (kind === 'bar') {
        const [text, tone] = toned(m[2], 'blue')
        // the value is the last number on the line; what follows it is its unit ("13%", "6.5 s", "1,184 m²")
        const v = text.match(/^(.*?)\s*(-?\d[\d,]*\.?\d*|-?\.\d+)(\D*)$/)
        if (v) items.push({ kind, label: v[1].replace(/[:=]$/, '').trim(), value: Math.abs(Number(v[2].replace(/,/g, ''))) || 0, shown: (v[2] + v[3]).trim(), tone })
        else items.push({ kind: 'row', tokens: cvTokens(text) })
      } else if (kind === 'note') {
        const [text, tone] = toned(m[2], 'yellow')
        items.push({ kind, text, tone })
      } else items.push({ kind, text: m[2] })
    } else if ((m = line.match(/^(\d{1,2})[.:)]\s+(.+)$/))) items.push({ kind: 'row', n: m[1], tokens: cvTokens(m[2]) })
    else items.push({ kind: 'row', tokens: cvTokens(line) })
  }
  return items
}

// The board as an SVG string, or null when the block holds nothing to draw (it then shows as code).
function canvasBoard(source) {
  const src = String(source ?? '').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
  const items = cvParse(src)
  if (!items.length) return null

  // the same text always wobbles the same way
  let seed = 2166136261
  for (const ch of src) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  const j = (a) => (rnd() - 0.5) * 2 * a
  const f = (n) => (Math.round(n * 10) / 10).toString()

  let out = [] // what's drawn, in the order the pen draws it: { open, words?, kids? }
  const stroke = (d, { w = 2.2, cls = '' } = {}) => out.push({ open: `<path class="cv-pen${cls ? ` ${cls}` : ''}" d="${d}" pathLength="1" stroke-width="${w}"` })
  const text = (x, y, words, { size = 20, anchor = 'start', cls = '' } = {}) => out.push({ open: `<text class="cv-text${cls ? ` ${cls}` : ''}" x="${f(x)}" y="${f(y)}" font-size="${size}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}`, words: cvEsc(words) })
  // a straight line as a hand draws it: the ends land a little off and the middle bows
  const seg = (x1, y1, x2, y2) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    const bow = Math.min(2.6, 0.5 + len * 0.012)
    const nx = -(y2 - y1) / len
    const ny = (x2 - x1) / len
    const a = j(bow)
    const b = j(bow)
    return `M${f(x1 + j(0.9))} ${f(y1 + j(0.9))}C${f(x1 + (x2 - x1) / 3 + nx * a)} ${f(y1 + (y2 - y1) / 3 + ny * a)} ${f(x1 + ((x2 - x1) * 2) / 3 + nx * b)} ${f(y1 + ((y2 - y1) * 2) / 3 + ny * b)} ${f(x2 + j(0.9))} ${f(y2 + j(0.9))}`
  }
  // a box: the colour goes down first and misses the edges a little, then four pen lines that overshoot their corners
  const box = (x, y, w, h, tone) => {
    if (tone) out.push({ open: `<path class="cv-fill cv-t-${tone}" d="M${f(x + 1 + j(1.5))} ${f(y + 2 + j(1.5))}L${f(x + w + 2 + j(1.5))} ${f(y + 1 + j(1.5))}L${f(x + w + 1 + j(1.5))} ${f(y + h + 2 + j(1.5))}L${f(x + j(1.5))} ${f(y + h + 1 + j(1.5))}Z"` })
    const o = () => 1 + rnd() * 2.5
    stroke(seg(x - o(), y, x + w + o(), y) + seg(x + w, y - o(), x + w, y + h + o()) + seg(x + w + o(), y + h, x - o(), y + h) + seg(x, y + h + o(), x, y - o()))
  }
  const arrow = (x1, y, x2) => {
    stroke(seg(x1, y, x2, y))
    stroke(seg(x2 - 9, y - 6 + j(1), x2, y) + seg(x2 - 9, y + 6 + j(1), x2, y))
  }
  const tick = (x, y) => stroke(seg(x - 7, y, x - 2, y + 6) + seg(x - 2, y + 6, x + 8, y - 8), { w: 2.8, cls: 'cv-ok' })
  const cross = (x, y) => stroke(seg(x - 6, y - 6, x + 6, y + 6) + seg(x + 6, y - 6, x - 6, y + 6), { w: 2.8, cls: 'cv-no' })
  const marker = (x, y, w, size, tone) => stroke(seg(x - 2, y + j(1), x + w + 2, y + j(1)), { w: size * 0.85, cls: `cv-hl cv-t-${tone}` })

  const numbered = items.some((i) => i.n)
  const left = CV_PAD + (numbered ? 40 : 0)
  const right = CV_W - CV_PAD
  let y = CV_PAD
  let title = ''

  // A row: its pieces go left to right and wrap; each line is as tall as its tallest piece, and all sit on its middle.
  const row = (tokens, n, x0 = left) => {
    const SIZE = 20
    const GAP = 10
    const space = cvWidth(' ', SIZE)
    const lines = [{ parts: [], h: 34 }]
    let x = x0
    for (const t of tokens) {
      const p = { ...t }
      if (t.kind === 'box') {
        p.lines = cvWrap(t.text, SIZE, right - x0 - 28)
        p.w = Math.max(...p.lines.map((l) => cvWidth(l, SIZE)), 12) + 24
        p.h = 12 + p.lines.length * 24
      } else if (t.kind === 'arrow') (p.w = Math.max(44, t.label ? cvWidth(t.label, 15) + 18 : 0)), (p.h = 34)
      else if (t.kind === 'ok' || t.kind === 'no') (p.w = 20), (p.h = 34)
      else (p.w = cvWidth(t.text, SIZE)), (p.h = 30)
      const cur = lines[lines.length - 1]
      const prev = cur.parts[cur.parts.length - 1]
      const gap = !prev ? 0 : prev.kind === 'word' && p.kind === 'word' ? space : GAP
      if (prev && x + gap + p.w > right) {
        lines.push({ parts: [], h: 34 })
        x = x0
      } else x += gap
      p.x = x
      x += p.w
      const line = lines[lines.length - 1]
      line.parts.push(p)
      line.h = Math.max(line.h, p.h + 4)
    }
    if (n) {
      const cy = y + lines[0].h / 2
      const cx = CV_PAD + 14
      const r = 13
      // a circle in one pull of the pen, which doesn't quite meet where it started
      const pts = [0, 1, 2, 3, 4, 5, 6, 7, 8.4].map((k) => [cx + Math.cos((k * Math.PI) / 4 - 2) * (r + j(1)), cy + Math.sin((k * Math.PI) / 4 - 2) * (r + j(1))])
      let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]
        const b = pts[k]
        const mx = (a[0] + b[0]) / 2 - cx
        const my = (a[1] + b[1]) / 2 - cy
        const s = (r * 1.08) / (Math.hypot(mx, my) || 1)
        d += `Q${f(cx + mx * s)} ${f(cy + my * s)} ${f(b[0])} ${f(b[1])}`
      }
      stroke(d, { w: 1.8 })
      text(cx, cy + 6, n, { size: 17, anchor: 'middle' })
    }
    for (const line of lines) {
      const cy = y + line.h / 2
      let run = null // words next to each other are one piece of text
      const flush = () => {
        if (run) text(run.x, cy + SIZE * 0.34, run.words.join(' '), { size: SIZE })
        run = null
      }
      for (const p of line.parts) {
        if (p.kind === 'word') {
          if (run) run.words.push(p.text)
          else run = { x: p.x, words: [p.text] }
          continue
        }
        flush()
        if (p.kind === 'box') {
          box(p.x, cy - p.h / 2, p.w, p.h, p.tone)
          p.lines.forEach((l, i) => text(p.x + p.w / 2, cy - (p.lines.length * 24) / 2 + i * 24 + 12 + SIZE * 0.34, l, { size: SIZE, anchor: 'middle' }))
        } else if (p.kind === 'arrow') {
          arrow(p.x + 2, cy, p.x + p.w - 2)
          if (p.label) text(p.x + p.w / 2 - 3, cy - 7, p.label, { size: 15, anchor: 'middle', cls: 'cv-dim' })
        } else if (p.kind === 'ok') tick(p.x + 10, cy)
        else if (p.kind === 'no') cross(p.x + 10, cy)
        else if (p.kind === 'hl') {
          marker(p.x, cy + 1, p.w, SIZE, p.tone)
          text(p.x, cy + SIZE * 0.34, p.text, { size: SIZE })
        }
      }
      flush()
      y += line.h
    }
    y += 12
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'title') {
      title ||= it.text
      for (const l of cvWrap(it.text, 28, CV_W - CV_PAD * 2)) (text(CV_PAD, y + 26, l, { size: 28, cls: 'cv-title' }), (y += 34))
      y += 2
    } else if (it.kind === 'sub') {
      for (const l of cvWrap(it.text, 18, CV_W - CV_PAD * 2)) (text(CV_PAD, y + 16, l, { size: 18, cls: 'cv-dim' }), (y += 22))
      y += 12
    } else if (it.kind === 'source') {
      y += 4
      for (const l of cvWrap(it.text, 15, CV_W - CV_PAD * 2)) (text(CV_PAD, y + 13, l, { size: 15, cls: 'cv-dim' }), (y += 19))
      y += 4
    } else if (it.kind === 'ok' || it.kind === 'no') {
      row([{ kind: it.kind }, ...cvTokens(it.text)], null, CV_PAD)
      y -= 10
    } else if (it.kind === 'note') {
      const lines = cvWrap(it.text, 19, CV_W - CV_PAD * 2 - 60)
      const w = Math.max(...lines.map((l) => cvWidth(l, 19))) + 36
      const h = lines.length * 24 + 22
      const x = CV_PAD + 6
      y += 6
      // the words sit in the note's own group, so they tilt with it
      const page = out
      out = [{ open: `<path class="cv-note cv-t-${it.tone}" d="M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h - 12)}L${f(x + w - 12)} ${f(y + h)}H${f(x)}Z"` }]
      lines.forEach((l, k) => text(x + 18, y + 11 + k * 24 + 19 * 0.8, l, { size: 19, cls: 'cv-on-note' }))
      page.push({ open: `<g transform="rotate(${f(-1.4 + j(0.5))} ${f(x + w / 2)} ${f(y + h / 2)})"`, kids: out })
      out = page
      y += h + 16
    } else if (it.kind === 'bar') {
      let end = i
      while (items[end + 1]?.kind === 'bar') end++
      const bars = items.slice(i, end + 1)
      i = end
      const top = Math.max(...bars.map((b) => b.value)) || 1
      const labelW = Math.min(230, Math.max(...bars.map((b) => cvWidth(b.label, 19))))
      const valueW = Math.max(...bars.map((b) => cvWidth(b.shown, 19)))
      const x = CV_PAD + labelW + 12
      const room = right - x - valueW - 12
      y += 4
      for (const b of bars) {
        const w = Math.max(4, (b.value / top) * room)
        let label = b.label
        while (label.length > 3 && cvWidth(label, 19) > labelW) label = `${label.slice(0, -2).trimEnd()}…`
        text(x - 12, y + 21, label, { size: 19, anchor: 'end' })
        box(x, y + 5, w, 20, b.tone)
        text(x + w + 10, y + 21, b.shown, { size: 19 })
        y += 32
      }
      y += 8
    } else if (it.tokens.length) row(it.tokens, it.n)
  }
  if (!out.length) return null

  // The pen takes its turns: one piece after another, the whole board inside about two seconds
  const count = (nodes) => nodes.reduce((n, p) => n + (p.kids ? count(p.kids) : 1), 0)
  const step = Math.min(0.09, 2.2 / count(out))
  let turn = 0
  const write = (nodes) =>
    nodes
      .map((p) => {
        if (p.kids) return `${p.open}>${write(p.kids)}</g>`
        const delay = ` style="animation-delay:${(turn++ * step).toFixed(2)}s"`
        return p.words === undefined ? `${p.open}${delay}/>` : `${p.open}${delay}>${p.words}</text>`
      })
      .join('')
  const svg = write(out)
  const h = Math.ceil(y + CV_PAD - 8)
  return `<figure class="canvas"><svg viewBox="0 0 ${CV_W} ${h}" width="${CV_W}" height="${h}" role="img" aria-label="${cvEsc(title || 'Canvas')}">${svg}</svg></figure>`
}

// A canvas in a line of preview text: its title, not its source
const canvasTitle = (source) => String(source).match(/^\s*title\s*:\s*(.+)$/im)?.[1].trim() ?? ''

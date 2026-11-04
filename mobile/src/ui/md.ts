// Markdown as agents write it, parsed into blocks (no React here, so it's tested on its own; markdown.tsx draws them):
// paragraphs, headings, fenced code with its language, lists (nested, numbered, checklists), quotes, tables with their
// alignment, rules. Inline marks (bold, code, links, @mentions) are left in the text for the renderer.
export type Item = { text: string; level: number; ordered: boolean; n: number; check: boolean | null }
export type Align = 'left' | 'center' | 'right'

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; items: Item[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; rows: string[][]; align: Align[] }
  | { kind: 'hr' }

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))

const LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const indent = (s: string) => s.replace(/\t/g, '    ').length

export function blocks(src: string): Block[] {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++
      // the fence's own indentation (a block inside a list item) comes off every line
      const cut = indent(line.match(/^\s*/)![0])
      out.push({ kind: 'code', lang: fence[2] ?? '', text: body.map((l) => l.slice(Math.min(cut, indent(l.match(/^\s*/)![0])))).join('\n') })
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      out.push({ kind: 'h', level: h[1].length, text: h[2] })
      i++
      continue
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      out.push({ kind: 'hr' })
      i++
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && RULE.test(lines[i + 1])) {
      const align = cells(lines[i + 1]).map((c): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'))
      const rows = [cells(line)]
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      out.push({ kind: 'table', rows, align })
      continue
    }
    if (LI.test(line)) {
      const items: Item[] = []
      const stack: number[] = [] // the indentation of each level
      while (i < lines.length) {
        const m = lines[i].match(LI)
        if (m) {
          const ind = indent(m[1])
          while (stack.length && stack[stack.length - 1] > ind) stack.pop()
          if (!stack.length || stack[stack.length - 1] < ind) stack.push(ind)
          const level = stack.length - 1
          const ordered = /\d/.test(m[2])
          // numbering runs on from the item before it on the same level, so "1. 1. 1." still counts 1, 2, 3
          const prev = items.findLast((x) => x.level <= level)
          const n = ordered && prev && prev.level === level && prev.ordered ? prev.n + 1 : ordered ? parseInt(m[2], 10) : 0
          const task = m[3].match(/^\[([ xX])\]\s+(.*)$/)
          items.push({ text: task ? task[2] : m[3], level, ordered, n, check: task ? task[1] !== ' ' : null })
          i++
          continue
        }
        const text = lines[i]
        if (text.trim() && /^\s{2,}/.test(text) && items.length && !/^\s*(```|~~~)/.test(text)) {
          items[items.length - 1].text += ` ${text.trim()}`
          i++
          continue
        }
        // a blank line between items keeps the list going
        if (!text.trim()) {
          let j = i
          while (j < lines.length && !lines[j].trim()) j++
          if (j < lines.length && LI.test(lines[j])) {
            i = j
            continue
          }
        }
        break
      }
      out.push({ kind: 'list', items })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push({ kind: 'quote', text: body.join('\n') })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i]) && !(lines[i].includes('|') && RULE.test(lines[i + 1] ?? ''))) para.push(lines[i++])
    if (!para.length) para.push(lines[i++])
    out.push({ kind: 'p', text: para.join('\n') })
  }
  return out
}

// A short code span stays in one piece: "#training-runs" or "api/cart.ts" moves to the next line whole instead of
// breaking at its hyphen or slash (iOS paints the tint to the end of a line it breaks). Narrow no-break spaces give
// it a hair of room inside the tint, since inline text can't have padding.
const NNBSP = String.fromCharCode(0x202f) // narrow no-break space
const NBHY = String.fromCharCode(0x2011) // non-breaking hyphen
const JOIN = String.fromCharCode(0x2060) // word joiner: no line break here
export const codeText = (s: string) => {
  const body = s.replace(/^ (.*) $/, '$1')
  const whole = body.length <= 40 && !/\s/.test(body) ? body.replace(/-/g, NBHY).replace(/([/._:=,+@#])/g, `$1${JOIN}`) : body
  return `${NNBSP}${whole}${NNBSP}`
}

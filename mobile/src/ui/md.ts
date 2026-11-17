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
// a table's separator row has a pipe in it: a bare "---" under a line is a rule, not a table
const isRule = (line: string) => line.includes('|') && RULE.test(line)
const indent = (s: string) => s.replace(/\t/g, '    ').length
const lead = (s: string) => indent(s.match(/^\s*/)![0])
// Up to `cut` columns of leading whitespace off a line, a tab counting as 4, without eating into the code itself.
function dedent(line: string, cut: number) {
  let col = 0
  let at = 0
  while (at < line.length && (line[at] === ' ' ? col + 1 <= cut : line[at] === '\t' && col + 4 <= cut)) col += line[at++] === '\t' ? 4 : 1
  return line.slice(at)
}
// A fence line is the fence and an info string, nothing else: "```npm install``` then restart" is a sentence.
const FENCE = /^\s*(```+|~~~+)\s*([^`]*)$/

export function blocks(src: string): Block[] {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  // A numbered list goes on counting past code or a paragraph indented under its item ("1. Install", the commands,
  // "1. Run" reads 1, 2): the last number, while what follows still belongs to the list.
  let carry: number | null = null
  const push = (b: Block, inItem: boolean) => {
    if (b.kind === 'list') {
      const top = b.items.filter((x) => x.level === 0)
      if (carry !== null && top[0]?.ordered && (top[0].n === 1 || top[0].n === carry + 1)) {
        const shift = carry + 1 - top[0].n
        for (const x of top) if (x.ordered) x.n += shift
      }
      const last = top.at(-1)
      carry = last?.ordered ? last.n : null
    } else if (!inItem) carry = null
    out.push(b)
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const inItem = carry !== null && lead(line) >= 2
    const fence = line.match(FENCE)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++
      // the fence's own indentation (a block inside a list item) comes off every line
      const cut = lead(line)
      push({ kind: 'code', lang: fence[2].trim().split(/\s+/)[0] ?? '', text: body.map((l) => dedent(l, cut)).join('\n') }, inItem)
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/)
    if (h) {
      push({ kind: 'h', level: h[1].length, text: h[2] }, false)
      i++
      continue
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      push({ kind: 'hr' }, false)
      i++
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isRule(lines[i + 1])) {
      const align = cells(lines[i + 1]).map((c): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'))
      const rows = [cells(line)]
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      push({ kind: 'table', rows, align }, false)
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
      push({ kind: 'list', items }, false)
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      push({ kind: 'quote', text: body.join('\n') }, false)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !/^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i]) && !(lines[i].includes('|') && isRule(lines[i + 1] ?? ''))) para.push(lines[i++])
    if (!para.length) para.push(lines[i++])
    // indentation means nothing inside a paragraph (one under a list item comes in indented)
    push({ kind: 'p', text: para.map((l) => l.trimStart()).join('\n') }, inItem)
  }
  return out
}

// Steps written in a run, as a question often comes (an agent's question is one line, with no room for a list): "Sign-in
// setup. (1) Open the console. (2) Create a project. Where are you?" is the words before, each step, and the closing
// question on its own. The numbers count up from 1, as "(1)", "1)" or, where a sentence starts, "1."; two or more of
// them, after a sentence that has ended. null for anything else: "Should I (1) rebase or (2) merge?" is one sentence,
// and "options (1) and (2)" names things, it doesn't list them. (The desktop's: desktop/ui/common.js.)
const RUN_MARKS = [/(?<=^|\s)\((\d{1,2})\)(?=\s+\S)/g, /(?<=^|\s)(\d{1,2})\)(?=\s+\S)/g, /(?<=^|[.:;!?]["')\]]?\s)(\d{1,2})\.(?=\s+\S)/g]
const RUN_JOINS = /^(and|or|andor|to|through|vs|versus|nor|then|plus|&)?$/i
export type Run = { before: string; items: string[]; after: string }
export function runInList(text: string): Run | null {
  const line = String(text ?? '')
  const probe = line.replace(/`[^`]*`/g, (code) => 'x'.repeat(code.length)) // a number inside `code` is code
  for (const mark of RUN_MARKS) {
    const all = [...probe.matchAll(mark)].map((m) => ({ n: Number(m[1]), at: m.index, end: m.index + m[0].length }))
    let best: { before: string; items: string[] } | null = null
    for (let i = 0; i < all.length; i++) {
      if (all[i].n !== 1) continue
      const run = [all[i]]
      for (const m of all.slice(i + 1)) if (m.n === run.length + 1) run.push(m)
      const before = line.slice(0, run[0].at).trim()
      const items = run.map((m, k) => line.slice(m.end, run[k + 1]?.at ?? line.length).trim())
      if (run.length < 2 || !/^$|[.:;!?…—–-]["'”’)\]]*$/.test(before) || items.some((x) => RUN_JOINS.test(x.replace(/[^\p{L}\p{N}&]+/gu, '')))) continue
      // of two that count as far, the later one is the list: a "(1)" before it was a mention
      if (run.length >= (best?.items.length ?? 0)) best = { before, items }
    }
    if (!best) continue
    // the question the steps lead up to is not the last step's
    const closing = best.items[best.items.length - 1].match(/^([\s\S]*[.!?…]["'”’)\]]*)\s+(\p{Lu}(?:[^.!?]|[.!?](?=\S))*\?)$/u)
    return closing ? { before: best.before, items: [...best.items.slice(0, -1), closing[1]], after: closing[2] } : { ...best, after: '' }
  }
  return null
}

// A question's words as Markdown: what its agent wrote, with steps written in a run set out as the list they are.
export function askMarkdown(text: string) {
  let fenced = false
  return String(text ?? '')
    .split('\n')
    .map((line) => {
      const fence = (line.match(/```|~~~/g) ?? []).length
      if (fence % 2) fenced = !fenced
      const run = fenced || fence || /^\s*([-*+•>#|])/.test(line) ? null : runInList(line)
      return run ? [run.before, run.items.map((x, i) => `${i + 1}. ${x}`).join('\n'), run.after].filter(Boolean).join('\n\n') : line
    })
    .join('\n')
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

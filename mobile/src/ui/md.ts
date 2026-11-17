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
// question on its own. The numbers count up from 1, as "(1)", "1)" or "1.", two or more of them, after a lead-in that
// has ended. null for anything else, and the words stay as written: "Should I (1) rebase or (2) merge?" is one
// sentence, "options (1) and (2)" names things, and "PR no. 1. Then no. 2." ends two sentences with a number.
// (The desktop has its own copy, desktop/ui/common.js; both are tested against shared/ask-steps.json.)
const RUN_MARKS = [/(?<=^|\s)\((\d{1,2})\)(?=\s+\S)/g, /(?<=^|\s)(\d{1,2})\)(?=\s+\S)/g, /(?<=^|[.:;!?]["')\]]?\s)(\d{1,2})\.(?=\s+\S)/g]
const RUN_JOINS = /^(and|or|andor|nor|to|through|vs|versus|then|plus|&|и|или|либо|und|oder|y|o|u|e|et|ou)?$/iu
const RUN_ENDS = /[.:;!?…—–-]["'”’)\]*_]*$/ // a sentence or a lead-in has ended here
export type Run = { before: string; items: string[]; after: string }
export function runInList(text: string): Run | null {
  const line = String(text ?? '')
  const probe = line.replace(/`[^`]*`/g, (code) => 'x'.repeat(code.length)) // a number inside `code` is code
  // a ")" that closes a bracket, as in "(see step 2)" or "(1 of 2)", is not the ")" of a step's "2)"
  const closes = new Set<number>()
  for (let i = 0, open = 0; i < probe.length; i++) {
    if (probe[i] === '(') open++
    else if (probe[i] === ')' && open) {
      open--
      closes.add(i)
    }
  }
  let best: (Run & { at: number }) | null = null
  for (const [form, mark] of RUN_MARKS.entries()) {
    const all = [...probe.matchAll(mark)].map((m) => ({ n: Number(m[1]), at: m.index, end: m.index + m[0].length })).filter((m) => form !== 1 || !closes.has(m.end - 1))
    let found: (Run & { at: number }) | null = null
    for (const first of all.filter((m) => m.n === 1)) {
      const before = line.slice(0, first.at).trim()
      // "1." only after a colon or a dash: after a full stop, the "1." of "PR no. 1." would read as a step
      if (before && !(form === 2 ? /[:—–-]["'”’)\]*_]*$/ : RUN_ENDS).test(before)) continue
      const upFrom = (ended: boolean) => {
        const run = [first]
        for (const m of all) if (m.at > run[run.length - 1].at && m.n === run.length + 1 && (!ended || RUN_ENDS.test(probe.slice(0, m.at).trimEnd()))) run.push(m)
        return run
      }
      // a step may name the next one, "(1) Create it; skip (2) if you have one. (2) Enable billing.": the numbers that
      // follow a finished sentence are the steps, when they count as far
      const [ended, any] = [upFrom(true), upFrom(false)]
      const run = ended.length >= any.length ? ended : any
      const items = run.map((m, k) => line.slice(m.end, run[k + 1]?.at ?? line.length).trim())
      if (run.length < 2 || items.some((x) => RUN_JOINS.test(x.replace(/[^\p{L}\p{N}&]+/gu, '')))) continue
      // of two that count as far, the first is the list: what comes after it talks about its steps
      if (run.length > (found?.items.length ?? 0)) found = { before, items, after: '', at: first.at }
    }
    // written two ways, "1) Read: (1) intro (2) body. 2) Reply.", the list that starts first holds the other
    if (found && found.at < (best?.at ?? Infinity)) best = found
  }
  if (!best) return null
  // the questions the steps lead up to are not the last step's
  const items = [...best.items]
  let after = ''
  for (let m; (m = items[items.length - 1].match(/^([\s\S]*[.!?…]["'”’)\]*_]*)\s+([*_"'“‘(¿¡]*\p{Lu}(?:[^.!?]|[.!?](?=\S))*\?[*_"'”’)]*)$/u)); ) {
    items[items.length - 1] = m[1]
    after = after ? `${m[2]} ${after}` : m[2]
  }
  return { before: best.before, items, after }
}

// A question with steps written in a run somewhere in it, as what to show, line by line: words, steps, words. null
// when it has none, and the question is shown as it always was. Code and a list its agent wrote are left alone.
export type AskBlock = { text: string } | { steps: string[] }
export function askBlocks(text: string): AskBlock[] | null {
  const out: AskBlock[] = []
  let fenced = false
  let found = false
  for (const line of String(text ?? '').split('\n')) {
    const fence = (line.match(/```|~~~/g) ?? []).length
    if (fence % 2) fenced = !fenced
    const run = fenced || fence || /^\s*[-*+•]\s/.test(line) ? null : runInList(line)
    if (run && !/^\d{1,3}[.)]\s/.test(run.before)) {
      found = true
      if (run.before) out.push({ text: run.before })
      out.push({ steps: run.items })
      if (run.after) out.push({ text: run.after })
    } else if (line.trim()) out.push({ text: line.trim() })
  }
  return found ? out : null
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

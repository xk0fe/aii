// What an agent's terminal shows right now, read the way you would read it, and the question its CLI is asking there
// when it's one of the CLI's own menus. CLIque has hooks for the questions it knows (permission prompts, a CLI's own
// questions, plans: core/hub.js ask), and reads the trust question off the screen (Hub.trustCard). Every other one a CLI
// can put up is a menu like theirs: Claude Code's "Resume this conversation?", "Session paused", an MCP server to approve,
// the questions a newer version asks before it starts; Codex's own approval once its hook has given up waiting. So
// whatever it is, it can be answered from the chat (Hub.screenCard): the question as the screen says it, and its choices.
//
// A menu, as both CLIs draw one (Claude Code 2.1.321, Codex 0.169):
//
//    Do you want to proceed?                          ← the question, up to the rule or the gap above it
//    ❯ 1. Yes                                         ← the selected choice: the pointer (❯ or ›) in front of it
//      2. Yes, and always allow access to             ← the others, lined up under it (numbered or not)
//         /Users/me/project from this project         ← more of a choice: a line indented under it
//      3. No
//                                                     (a rule or a blank line can sit between choices)
//    Esc to cancel · Tab to amend                     ← the keys, under it: what makes it a menu and not text
import { createRequire } from 'node:module'

// (Loaded so that a checkout pulled without `npm install` since this came in still starts: it just reads no screens.)
const Terminal = (() => {
  try {
    return createRequire(import.meta.url)('@xterm/headless').Terminal
  } catch {
    return null
  }
})()

// The screen as lines of text: the terminal's recent output (Runner.buffer, at the size it was drawn at) replayed into a
// terminal that draws nowhere. Synchronous, so CLIque can look again between two keys it presses.
export function screenOf({ data = '', cols = 120, rows = 36 } = {}) {
  if (!Terminal) return []
  const term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true, logLevel: 'off' })
  try {
    term._core.writeSync(String(data)) // (@xterm/headless 6.0.0; its write() would finish on a later tick)
    const b = term.buffer.active
    const lines = []
    for (let i = 0; i < rows; i++) lines.push((b.getLine(b.baseY + i)?.translateToString(true) ?? '').replace(/\s+$/, ''))
    return lines
  } finally {
    term.dispose()
  }
}

// The keys under a menu: Claude Code's "Enter to confirm · Esc to cancel", "Enter to select · ↑/↓ to navigate · Esc to
// cancel", "Esc to cancel · Tab to amend"; Codex's "Press enter to confirm or esc to cancel", "enter continue · esc quit".
// (Not a working agent's "esc to interrupt": that's no menu.)
const KEYS = /\b(?:enter|esc)\b.*\b(?:confirm|cancel|select|continue|navigate|amend|quit|exit|go back)\b|↑\/↓/i
const POINTER = '❯›'
// the pointer, the gap after it, the choice's number and what follows that ("1. "), and its words
const POINTED = new RegExp(`^( *)[${POINTER}]( +)(?:(\\d{1,2})([.)] +))?(\\S.*)$`)
const RULE = /^ *[─━═╌┄┈╍┅┉]{6,} *$/
const SOLID = /^ *[─━═]{6,} *$/ // a dialog's top edge (Claude Code)
const BULLET = /^ *[⏺●•✻✢✳✶✽·] /u // a line of the conversation above it: a step, a reply, a spinner
const blank = (l) => !l.trim()
// a box's side, as older Claude Code drew dialogs ("│ ❯ 1. Yes   │"): a space in its place, so columns stay put
const unboxed = (l) => l.replace(/^( *)[│┃]/, '$1 ').replace(/ *[│┃] *$/, '')
// a key a choice can also be picked with, at its end: Codex's "Yes, proceed (y)", "No, and tell Codex … (esc)"
const label = (s) => words(s).replace(/ \((?:[a-z]|esc|enter|tab)\)$/i, '')
// (a CLI can place words by column rather than with spaces: one space between them)
const words = (s) => s.replace(/\s+/g, ' ').trim()

// The menu on screen, if there is one: { title, text, options: [{ label, description? }], selected, key }. text is the
// question as it stands above the choices, a line per line; title its first line; selected the index of the choice
// the pointer is on; key what makes it this menu and no other (its words, not where the pointer is, nor where its lines
// wrap). null: no menu.
export function dialogOf(screen) {
  const lines = screen.map(unboxed)
  let foot = lines.length - 1
  while (foot >= 0 && !KEYS.test(lines[foot])) foot--
  if (foot < 0) return null
  // the selected choice: the last line with the pointer in front of it, above the keys
  let at = foot - 1
  while (at >= 0 && foot - at <= 30 && !POINTED.test(lines[at])) at--
  const m = at >= 0 && foot - at <= 30 && lines[at].match(POINTED)
  if (!m) return null
  const pointerCol = m[1].length
  const numbered = m[3] !== undefined
  const textCol = pointerCol + 1 + m[2].length // where a choice starts: its number, or its words
  const labelCol = textCol + (numbered ? m[3].length + m[4].length : 0) // where its words start
  // Is this line a choice (its number, or its words, in line with the selected one's), more of the one above it, or
  // neither? The pointer stands in front of the selected one only.
  const choice = (l) => {
    const p = l.match(POINTED)
    if (p) return p[1].length === pointerCol ? { pointed: true, n: p[3], words: p[5] } : null
    const lead = l.match(/^ */)[0].length
    if (lead !== textCol) return null
    const n = numbered && l.slice(lead).match(/^(\d{1,2})[.)] +(\S.*)$/)
    if (numbered) return n ? { n: n[1], words: n[2] } : null
    return { words: l.slice(lead) }
  }
  const more = (l) => !blank(l) && l.match(/^ */)[0].length >= labelCol && !RULE.test(l)
  // the choices: from the selected one, up and down while lines are choices, more of one, a rule or a blank line
  const rows = []
  let first = at
  for (let i = at - 1; i >= 0 && at - i <= 30; i--) {
    const l = lines[i]
    if (choice(l) || RULE.test(l) || blank(l) || more(l)) {
      if (choice(l)) first = i
      continue
    }
    break
  }
  for (let i = first; i < foot; i++) {
    const l = lines[i]
    const c = choice(l)
    if (c) rows.push({ ...c, description: [] })
    else if (more(l) && rows.length) rows.at(-1).description.push(l.trim())
    else if (!blank(l) && !RULE.test(l)) return null // something that's neither, inside the menu: not one after all
  }
  const options = rows.map((r) => ({ label: label(r.words), ...(r.description.length && { description: words(r.description.join(' ')) }) }))
  const selected = rows.findIndex((r) => r.pointed)
  if (options.length < 2 || options.length > 12 || rows.filter((r) => r.pointed).length !== 1) return null
  if (numbered && rows.some((r, i) => Number(r.n) !== i + 1)) return null
  // the question: what stands above the choices, up to the dialog's top edge, a gap of three blank lines, a line of the
  // conversation, or the prompt you typed (the pointer at the start of a line again)
  const above = []
  let gap = 0
  for (let i = first - 1; i >= 0 && first - i <= 24; i--) {
    const l = lines[i]
    if (SOLID.test(l) || BULLET.test(l) || /^ *[❯›>] /.test(l)) break
    if (blank(l)) {
      if (++gap >= 3) break
    } else gap = 0
    above.unshift(l)
  }
  const said = above.filter((l) => !RULE.test(l)).map((l) => l.trim())
  while (said.length && !said[0]) said.shift()
  while (said.length && !said.at(-1)) said.pop()
  const text = said.filter((l, i) => l || said[i - 1]).join('\n') // (one blank line between parts at most)
  const title = said[0] ?? ''
  // (its key: the words of its title and choices, however a narrower terminal wraps them)
  return { title, text, options, selected, key: JSON.stringify([words(title), ...options.map((o) => o.label)]) }
}

// The arrow key that moves the selection one step toward choice `want`, or '' once it's there.
export const keyToward = (d, want) => (d.selected === want ? '' : want > d.selected ? '\x1b[B' : '\x1b[A')

// What a screen with no menu on it shows at its foot, for a card that says so: its last lines with words on them (a CLI's
// own frame, its rules and its empty prompt box left out), at most `n`.
export function screenTail(screen, n = 14) {
  const lines = screen.map(unboxed).filter((l) => !RULE.test(l) && !/^ *[❯›>] *$/.test(l))
  while (lines.length && blank(lines.at(-1))) lines.pop()
  const kept = lines.slice(-n * 2).filter((l, i, all) => !blank(l) || !blank(all[i - 1] ?? ''))
  return kept.slice(-n).join('\n').replace(/^\n+/, '')
}

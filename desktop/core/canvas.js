// Canvases: a board an agent draws in the chat instead of a wall of text (ui/canvas.js draws it by hand). A canvas is a
// message whose text holds a ```canvas block, so it's kept, synced, searched and shown on every client like any other
// message, and one that can't draw it shows the lines as code. `crew canvas` makes one and changes one that's there
// (Hub.canvas): a teammate's lines go onto the same board, and the message says who drew on it.

export const CANVAS_LINES = 60 // the most one canvas holds
const LINE_MAX = 240
const FENCE = /```canvas\n([\s\S]*?)```/

// A message's canvas as its lines, or null when it has none
export const canvasLines = (text) => {
  const m = FENCE.exec(String(text ?? ''))
  if (!m) return null
  const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length ? lines : null
}
// The message with its canvas holding these lines instead
export const withCanvas = (text, lines) => String(text).replace(FENCE, () => asCanvas(lines))
export const asCanvas = (lines) => `\`\`\`canvas\n${lines.join('\n')}\n\`\`\``
export const canvasTitle = (lines) => lines.find((l) => /^title\s*:/i.test(l))?.replace(/^title\s*:\s*/i, '') ?? ''
// What an agent typed, as lines: each word of the command is a line (or several, when it holds newlines), and nothing
// in one can end the block it goes in
export const typedLines = (words) =>
  words
    .flatMap((w) => String(w ?? '').split('\n'))
    .map((l) => l.replace(/`{3,}/g, "'''").trim().slice(0, LINE_MAX))
    .filter(Boolean)

export const CANVAS_HELP = `A canvas is a hand-drawn board in the chat. Draw one when a picture says it better than a paragraph: how something
flows, numbers side by side, what's checked and what isn't. Every line is one piece, and there are no coordinates.

crew canvas new "<line>" "<line>" ...        draw one where you're working; prints its id
crew canvas show [id]                        the canvases in the chat, or one's lines, numbered
crew canvas add <id> "<line>" ...            add lines to a canvas, yours or a teammate's
crew canvas set <id> <n> "<line>"            write line n again
crew canvas cut <id> <n>                     take line n out

Lines:
  title: How checkout works                  the heading (start with one)
  sub: what happens to an order              a grey line under it
  1: [cart] -> [payment]{yellow} -> [receipt]   a numbered row: [boxes], -> arrows, -label-> arrows, plain words
  [orders] -every hour-> [warehouse]         a row without a number
  bar: Chrome 412 ms {green}                 bars next to each other share a scale: the last number is the value
  ok: all 48 tests pass                      a tick and a line
  no: Safari not run                         a cross and a line
  note: a proxy score, not a pass {pink}     a sticky note
  source: results/checkout.json              a small grey credit
Anywhere in a row: ==words== are highlighted. Colours, after a box, bar, note or highlight:
{yellow} {pink} {blue} {green} {orange} {purple} {grey}. Keep a box to a few words and a canvas to what fits on a page.
Quote each line in single quotes in the shell, so [ ] > and = arrive as typed.
A \`\`\`canvas block in your final message draws the same board, and teammates can add to that one too.
`

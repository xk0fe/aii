// Canvases (ui/canvas.js): a ```canvas block in a message becomes a hand-drawn board, through md() in ui/common.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ crew: {}, avatarHTML: () => '', agentColor: () => '', CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/canvas.js'), 'utf8') + '\n' + fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { md, snippet, canvasBoard, cvParse }', ctx)
const { md, snippet, canvasBoard, cvParse } = ctx.__x
const count = (s, re) => (s.match(re) || []).length
const plain = (v) => JSON.parse(JSON.stringify(v)) // out of the vm's realm, for deepEqual
const fence = (body) => '```canvas\n' + body + '\n```'

test('a canvas block is drawn as a board, and other code stays code', () => {
  const html = md(`Before.\n\n${fence('title: How it works\n1: [in] -> [out]')}\n\nAfter.`)
  assert.match(html, /<p>Before\.<\/p><figure class="canvas"><svg [^>]*aria-label="How it works"/)
  assert.match(html, /<\/figure><p>After\.<\/p>/)
  assert.doesNotMatch(html, /<pre>/)
  assert.match(md('```js\nlet a = 1\n```'), /<pre>.*<code>let a = 1<\/code><\/pre>/)
})

test('an empty canvas block stays a code block', () => {
  assert.match(md('```canvas\n\n```'), /<pre>/)
  assert.equal(canvasBoard('   \n  '), null)
})

test('rows read as boxes, arrows, highlights, marks and words', () => {
  const [row] = cvParse('2: [The sky]{pink} -> plain words -then-> ==hot=={green} ✓ ✗')
  assert.equal(row.n, '2')
  assert.deepEqual(plain(row.tokens), [
    { kind: 'box', text: 'The sky', tone: 'pink' },
    { kind: 'arrow', label: '' },
    { kind: 'word', text: 'plain' },
    { kind: 'word', text: 'words' },
    { kind: 'arrow', label: 'then' },
    { kind: 'hl', text: 'hot', tone: 'green' },
    { kind: 'ok' },
    { kind: 'no' },
  ])
})

test('a hyphen inside words is not an arrow, and an unknown colour falls back', () => {
  const [row] = cvParse('course-balanced well-known -> [x]{neon}')
  assert.deepEqual(plain(row.tokens.map((t) => t.kind)), ['word', 'word', 'arrow', 'box'])
  assert.equal(row.tokens[3].tone, 'blue')
})

test('bars take the last number as their value and share one scale', () => {
  const items = cvParse('bar: Green 0.67 {green}\nbar: Pooled area 1,184,128.92 m²\nbar: Tee 13%')
  assert.deepEqual(plain(items.map((b) => [b.label, b.value, b.shown, b.tone])), [['Green', 0.67, '0.67', 'green'], ['Pooled area', 1184128.92, '1,184,128.92 m²', 'blue'], ['Tee', 13, '13%', 'blue']])
  const html = canvasBoard('bar: A 10\nbar: B 5')
  const widths = [...html.matchAll(/class="cv-pen" d="M([\d.-]+) [\d.-]+C[^M]*? ([\d.-]+) [\d.-]+M/g)].map((m) => Number(m[2]) - Number(m[1]))
  assert.equal(widths.length, 2)
  assert.ok(widths[0] > widths[1] * 1.8 && widths[0] < widths[1] * 2.2, `${widths}`)
})

test("whatever an agent writes can't inject markup", () => {
  const html = md(fence('title: <img src=x onerror=1>\n1: [<b>"x"</b>] -> <script>alert(1)</script>\nnote: </svg><i>'))
  assert.doesNotMatch(html, /<img|<b>|<script|<i>|<\/svg><i/)
  assert.equal(count(html, /<\/svg>/g), 1)
  assert.match(html, /&#60;script&#62;alert\(1\)&#60;\/script&#62;/)
})

test('a long row wraps inside the board and a long box wraps its words', () => {
  const html = canvasBoard(`1: ${Array.from({ length: 12 }, (_, i) => `[step number ${i}]`).join(' -> ')}\n[${'a very long sentence in one box '.repeat(6)}]`)
  const xs = [...html.matchAll(/ x="([\d.-]+)"/g)].map((m) => Number(m[1]))
  assert.ok(Math.max(...xs) < 640, `${Math.max(...xs)}`)
  const ends = [...html.matchAll(/[ML]([\d.-]+) [\d.-]+/g)].map((m) => Number(m[1]))
  assert.ok(Math.max(...ends) < 640 && Math.min(...ends) > 0, `${Math.min(...ends)}..${Math.max(...ends)}`)
})

test('the same text always draws the same board', () => {
  const src = 'title: T\n1: [a] -> [b]\nbar: x 3\nnote: n'
  assert.equal(canvasBoard(src), canvasBoard(src))
})

test('every drawn piece takes its turn, all inside about two seconds', () => {
  const html = canvasBoard(Array.from({ length: 40 }, (_, i) => `${i % 9}: [box ${i}] -> word`).join('\n'))
  const delays = [...html.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => Number(m[1]))
  assert.ok(delays.length > 100)
  assert.ok(Math.max(...delays) <= 2.2)
  assert.deepEqual(delays, [...delays].sort((a, b) => a - b))
})

test('a preview line names the board instead of showing its source', () => {
  assert.equal(snippet(`Here: ${fence('title: How it works\n[a] -> [b]')}`), 'Here: [canvas: How it works]')
  assert.equal(snippet(fence('[a] -> [b]')), '[canvas]')
})

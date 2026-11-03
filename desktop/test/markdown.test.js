// md() from ui/common.js, the Markdown in feed bubbles: GFM tables and the cases that must not become one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ crew: {}, avatarHTML: () => '', agentColor: () => '', CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { md, snippet }', ctx)
const { md, snippet } = ctx.__x
const count = (s, re) => (s.match(re) || []).length

test('a standard table, with or without outer pipes', () => {
  const html = md('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')
  assert.equal(count(html, /<th>/g), 2)
  assert.equal(count(html, /<td>/g), 4)
  assert.match(md('A | B\n--- | ---\n1 | 2'), /<table>/)
})

test('delimiter colons set column alignment', () => {
  assert.match(md('| L | C | R |\n|:--|:-:|--:|\n| a | b | c |'), /<th style="text-align:left">L<\/th><th style="text-align:center">C<\/th><th style="text-align:right">R<\/th>/)
})

test('cells render inline Markdown', () => {
  assert.match(md('| Who | Note |\n|---|---|\n| **june** | `GET /x` and [doc](https://a.b) |'), /<td><b>june<\/b><\/td><td><code>GET \/x<\/code> and <a href="https:\/\/a.b">doc<\/a><\/td>/)
})

test('an escaped pipe stays inside its cell, in text and in inline code', () => {
  assert.match(md('| Expr | V |\n|---|---|\n| a \\| b | 1 |'), /<td>a \| b<\/td><td>1<\/td>/)
  assert.match(md('| Expr | V |\n|---|---|\n| `a \\| b` | 1 |'), /<td><code>a \| b<\/code><\/td><td>1<\/td>/)
})

test('ragged rows: missing cells are empty, extra cells are dropped', () => {
  const html = md('| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |')
  assert.equal(count(html, /<tr>/g), 3)
  assert.equal(count(html, /<td>/g), 6)
})

test('a table sits between paragraphs and lists without swallowing them', () => {
  assert.match(md('Intro line\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nAfter para\n- item'), /^<p>Intro line<\/p><div class="tbl"><table>.*<\/table><\/div><p>After para<\/p><ul><li>item<\/li><\/ul>$/)
})

test('a header-only table has no body', () => {
  const html = md('| A | B |\n|---|---|')
  assert.match(html, /<thead>.*<\/thead><\/table>/)
  assert.doesNotMatch(html, /tbody/)
})

test('not tables: column mismatch, no delimiter row, a plain rule, fenced code', () => {
  assert.doesNotMatch(md('| A | B |\n|---|\n| 1 | 2 |'), /<table>/)
  assert.doesNotMatch(md('a | b is just text\nno rule here'), /<table>/)
  assert.doesNotMatch(md('text\n---\nmore'), /<table>/)
  const fenced = md('```\n| A | B |\n|---|---|\n```')
  assert.doesNotMatch(fenced, /<table>/)
  assert.match(fenced, /<pre>/)
})

test('HTML in cells is escaped', () => {
  assert.doesNotMatch(md('| <img src=x onerror=alert(1)> | B |\n|---|---|\n| <script>x</script> | 2 |'), /<img|<script/)
})

test('a quoted table reads as words, not pipes', () => {
  assert.equal(snippet('| A | B |\n|---|---|\n| 1 | 2 |'), 'A B 1 2')
})

test('@mentions are marked the way the hub reads them: not emails, packages, possessives or code', () => {
  assert.match(md('@ada fix it, then @iris@workstation.'), /<span class="mention" data-m="ada">@ada<\/span> fix it, then <span class="mention" data-m="iris@workstation">@iris@workstation<\/span>\./)
  for (const text of ["@ada's branch", 'mail a@b.com', 'bump @types/node', 'run `@nobody`', 'ask @you']) assert.doesNotMatch(md(text), /class="mention"/, text)
})

test('an ordered list starts at its first number, so an answer that starts with one reads as written', () => {
  assert.equal(md('4000. Staging and local use the same port.'), '<ol start="4000"><li>Staging and local use the same port.</li></ol>')
  assert.equal(md('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>')
})

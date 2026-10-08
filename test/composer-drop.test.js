// A folder dropped on the chat goes into the message as its path, at the cursor (ui/common.js). Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ crew: {}, CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { insertAt, pathRefs, pathOf }', ctx)
const { insertAt, pathRefs, pathOf } = ctx.__x
const put = (value, start, end, text) => ({ ...insertAt(value, start, end, text) })

test('paths go in backticks, several on one line', () => {
  assert.equal(pathRefs(['/a/b', '/Users/me/My Project']), '`/a/b` `/Users/me/My Project`')
})

test('into an empty box: the path and a space to type on', () => {
  assert.deepEqual(put('', 0, 0, '`/src`'), { value: '`/src` ', caret: 7 })
})

test('after a word: a space before it; before one: a space after it', () => {
  assert.deepEqual(put('look in', 7, 7, '`/src`'), { value: 'look in `/src` ', caret: 15 })
  assert.deepEqual(put('see and', 3, 3, '`/src`'), { value: 'see `/src` and', caret: 10 })
  assert.deepEqual(put('see  and', 4, 4, '`/src`'), { value: 'see `/src` and', caret: 10 })
})

test('a selection is replaced', () => {
  assert.deepEqual(put('open THIS now', 5, 9, '`/src`'), { value: 'open `/src` now', caret: 11 })
})

test('no way to tell where a file is: no path', () => {
  assert.equal(pathOf({}), '')
  ctx.crew.pathOf = () => { throw new TypeError('not a File') }
  assert.equal(pathOf({}), '')
  ctx.crew.pathOf = () => '/Users/me/src'
  assert.equal(pathOf({}), '/Users/me/src')
})

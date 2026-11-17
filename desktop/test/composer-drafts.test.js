// What the message box holds when you go from one conversation to another (ui/common.js draftSwap). Looking around
// (the sidebar, a face), each conversation keeps what you were writing in it. Changing who it's for on the To line, the
// message goes with you. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const A = path.resolve(import.meta.dirname, '..')
const src = fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8')
const ctx = vm.createContext({ clique: {}, CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(`${src};globalThis.__x = { draftSwap }`, ctx)
const swap = (...args) => JSON.parse(JSON.stringify(ctx.__x.draftSwap(...args)))
const draft = (text = '', extra = {}) => ({ text, images: [], reply: null, follow: null, ...extra })
const QUOTE = { to: ['Ada'], id: 'm1', from: 'Ada', text: 'Which one?' }

test('looking around: yours waits where you wrote it, the one there comes back', () => {
  assert.deepEqual(swap(draft('for Ada'), draft('for Milo')), { box: draft('for Milo'), behind: draft('for Ada') })
  assert.deepEqual(swap(draft('for Ada'), undefined), { box: draft(), behind: draft('for Ada') })
  assert.deepEqual(swap(draft(), undefined), { box: draft(), behind: null })
})

test('looking around: a quote waits with its conversation, even with nothing written under it', () => {
  assert.deepEqual(swap(draft('', { reply: QUOTE }), undefined), { box: draft(), behind: draft('', { reply: QUOTE }) })
})

test('To line: what you wrote goes with you, and nothing of it waits behind', () => {
  assert.deepEqual(swap(draft('Fix the coupon field'), undefined, { move: true }), { box: draft('Fix the coupon field'), behind: null })
})

test('To line: the text arrives as it was written, so the cursor keeps its place', () => {
  assert.equal(swap(draft('  indented\n\nand spaced  '), undefined, { move: true }).box.text, '  indented\n\nand spaced  ')
})

test('To line: its images go with it', () => {
  assert.deepEqual(swap(draft('Look', { images: ['/a.png', '/b.png'] }), undefined, { move: true }), { box: draft('Look', { images: ['/a.png', '/b.png'] }), behind: null })
  // images with no words are a message too
  assert.deepEqual(swap(draft('', { images: ['/a.png'] }), undefined, { move: true }), { box: draft('', { images: ['/a.png'] }), behind: null })
})

test('To line: a draft waiting there is kept, yours goes under it', () => {
  const there = draft('One more thing\n', { images: ['/old.png'] })
  assert.deepEqual(swap(draft('Fix the coupon field', { images: ['/new.png'] }), there, { move: true }), {
    box: draft('One more thing\nFix the coupon field', { images: ['/old.png', '/new.png'] }),
    behind: null,
  })
  // one that's only images, or only spaces, adds no empty line
  assert.equal(swap(draft('Fix it'), draft('  ', { images: ['/old.png'] }), { move: true }).box.text, 'Fix it')
})

test('To line: the message it answered stays with the conversation you left', () => {
  const got = swap(draft('Thanks', { reply: QUOTE, follow: { at: 1, to: ['Ada'] } }), undefined, { move: true })
  assert.deepEqual(got.box, draft('Thanks'))
  assert.deepEqual(got.behind, draft('', { reply: QUOTE, follow: { at: 1, to: ['Ada'] } }))
  // and the one you were answering where you're going is still the one you answer there
  assert.deepEqual(swap(draft('Thanks'), draft('', { reply: QUOTE }), { move: true }).box, draft('Thanks', { reply: QUOTE }))
})

test('To line: with nothing written there is nothing to move, so their draft comes back', () => {
  assert.deepEqual(swap(draft('   '), draft('for Milo'), { move: true }), { box: draft('for Milo'), behind: null })
  assert.deepEqual(swap(draft('', { reply: QUOTE }), draft('for Milo'), { move: true }), { box: draft('for Milo'), behind: draft('', { reply: QUOTE }) })
})

test('the To picker and the Task switch move the message; the sidebar, a face and Reply do not', () => {
  const composer = src.slice(src.indexOf('function mountComposer'), src.indexOf('// ---- notes at the bottom of the window'))
  const pickTo = composer.slice(composer.indexOf('const pickTo ='), composer.indexOf('let told'))
  assert.match(pickTo, /setTarget\(to, \{ move: true \}\)/)
  const chips = composer.slice(composer.indexOf("chips.addEventListener('click'"), composer.indexOf('new ResizeObserver(fitRail)'))
  assert.match(chips, /setTarget\(picked\.dataset\.to, \{ move: true \}\)/)
  assert.equal(composer.match(/move: true/g).length, 2, 'only the To line moves a message')
  // what the dashboard and the floating chat call to open a conversation takes a name and nothing else
  for (const file of ['ui/dashboard.js', 'ui/overlay.js']) assert.doesNotMatch(fs.readFileSync(path.join(A, file), 'utf8'), /setTarget\([^)]*move/)
})

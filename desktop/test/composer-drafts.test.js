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
// (moved: whether what you wrote came along; told apart from the rest below)
const whole = (...args) => JSON.parse(JSON.stringify(ctx.__x.draftSwap(...args)))
const swap = (...args) => (({ box, behind }) => ({ box, behind }))(whole(...args))
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
  assert.deepEqual(whole(draft('Fix the coupon field'), undefined, { move: true }), { box: draft('Fix the coupon field'), behind: null, moved: true })
  // looking around moves nothing
  assert.equal(whole(draft('Fix the coupon field'), undefined).moved, false)
  assert.equal(whole(draft('Fix the coupon field'), undefined, { everyone: true }).moved, false)
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
  // in an agent's conversation, a quote that waited there only quotes: it's still there
  assert.deepEqual(swap(draft('Thanks'), draft('', { reply: QUOTE }), { move: true }).box, draft('Thanks', { reply: QUOTE }))
})

test("To line, into everyone's chat: the message is for who the To line says, so it leaves the thread that waited there", () => {
  // (there, the thread you're in decides who gets what you send next: left in, Auto would have sent this to Ada)
  const thread = draft('', { reply: QUOTE, follow: { at: 1, to: ['Ada'] } })
  assert.deepEqual(swap(draft('Can anyone review PR 12?'), thread, { move: true, everyone: true }), { box: draft('Can anyone review PR 12?'), behind: null })
  // a draft that waited in that thread keeps its words
  assert.equal(swap(draft('Can anyone review PR 12?'), draft('half a reply', { reply: QUOTE }), { move: true, everyone: true }).box.text, 'half a reply\nCan anyone review PR 12?')
  // with nothing written, nothing arrives: back in the channel, you're still in the thread
  assert.deepEqual(swap(draft(), thread, { move: true, everyone: true }).box, thread)
  assert.deepEqual(swap(draft('for Theo'), thread, { everyone: true }).box, thread, 'and looking around never leaves it')
})

test('To line: with nothing written there is nothing to move, so their draft comes back', () => {
  assert.deepEqual(swap(draft('   '), draft('for Milo'), { move: true }), { box: draft('for Milo'), behind: null })
  assert.deepEqual(swap(draft('', { reply: QUOTE }), draft('for Milo'), { move: true }), { box: draft('for Milo'), behind: draft('', { reply: QUOTE }) })
})

// How the message box is wired to it, read from the source (the box itself needs a page: `npm run probe:composer`
// drives it in the real dashboard, through every case here and the ones only clicks and timing show).
test('the To picker, Add a task and the Task chip move the message; the sidebar, a face and Reply do not', () => {
  const composer = src.slice(src.indexOf('function mountComposer'), src.indexOf('// ---- notes at the bottom of the window'))
  const pickTo = composer.slice(composer.indexOf('const pickTo ='), composer.indexOf('let told'))
  assert.match(pickTo, /setTarget\(to, \{ move: true \}\)/)
  const chips = composer.slice(composer.indexOf("chips.addEventListener('click'"), composer.indexOf('new ResizeObserver(fitRail)'))
  assert.match(chips, /setTarget\(picked\.dataset\.to, \{ move: true \}\)/)
  // + > Add a task (the Task switch that was beside the To picker)
  const plus = composer.slice(composer.indexOf("plus.addEventListener('click'"), composer.indexOf('const sendLater ='))
  assert.match(plus, /setTarget\(target === 'task' \? 'auto' : 'task', \{ move: true \}\)/)
  // nowhere else: not as another value, not beside carry
  assert.equal(composer.match(/[{,]\s*move\s*:\s*(?!move\b)\S/g).length, 3, 'only the To line, Add a task and the Task chip move a message')
  // from there to the box: setTarget hands what it was given to swapDraft, which hands it on with where it's going;
  // nothing moves unless asked, or while a message is on its way
  assert.match(composer, /const setTarget = \(name, how\) => \{\s*if \(draftKey\(name\) !== draftKey\(target\)\) swapDraft\(name, how\)/)
  assert.match(composer, /const swapDraft = \(next, how\) => swapKeys\(draftKey\(target\), draftKey\(next\), \{ \.\.\.how, everyone: !isConvo\(next\) \}\)/)
  assert.match(composer, /const swapKeys = \(mineKey, nextKey, \{ carry = false, move = false, everyone = false \} = \{\}\) => \{/)
  assert.match(composer, /draftSwap\(mine, there, \{ move: move && !going, everyone \}\)/)
  assert.match(composer, /going \+= 1[^\n]*\n\s*try \{/)
  assert.match(composer, /\} finally \{\s*going -= 1\s*\}/)
  // what the dashboard and the floating chat call to open a conversation never asks for a move, whatever else they pass
  for (const file of ['ui/dashboard.js', 'ui/overlay.js']) {
    const calls = fs.readFileSync(path.join(A, file), 'utf8').match(/setTarget\((?:[^()]|\([^()]*\))*\)/g) ?? []
    assert.ok(calls.length, `${file} opens conversations`)
    for (const c of calls) assert.doesNotMatch(c, /\bmove\b|,\s*[a-z]\w*\s*\)$/i, `${file}: ${c}`)
  }
})

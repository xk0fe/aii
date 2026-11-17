// A question whose steps came written in a run, "(1) … (2) …": runInList and askBlocks from ui/common.js against the
// cases both apps share (shared/ask-steps.json; the phone's copy is tested in mobile/test/markdown.test.ts), then the
// card, the Needs you bubble and the answered line that show them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ clique: {}, avatarHTML: () => '', agentColor: () => '', CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { runInList, askBlocks, askCard, sayLine, askSummary }', ctx)
const { runInList, askBlocks, askCard, sayLine, askSummary } = ctx.__x
const cases = JSON.parse(fs.readFileSync(path.join(A, '../shared/ask-steps.json'), 'utf8'))
const plain = (v) => JSON.parse(JSON.stringify(v)) // out of the vm's realm, so deepEqual compares values

for (const c of cases.runs) test(`steps in a run: ${c.name}`, () => assert.deepEqual(plain(runInList(c.text)), c.run))
for (const c of cases.blocks) test(`a question set out: ${c.name}`, () => assert.deepEqual(plain(askBlocks(c.text)), c.blocks))

test('nothing of a question is lost or reworded: between its pieces there is only a number', () => {
  for (const c of cases.runs.filter((x) => x.run)) {
    let at = 0
    for (const piece of [c.run.before, ...c.run.items, c.run.after].filter(Boolean)) {
      const found = c.text.indexOf(piece, at)
      assert.match(c.text.slice(at, found), /^\s*(\(?\d+[.)])?\s*$/, `${c.name}: before "${piece}"`)
      at = found + piece.length
    }
    assert.equal(c.text.slice(at).trim(), '', c.name)
  }
})

const STEPS = 'Two things by hand. (1) Open the <b>console</b>. (2) Create a project. Where are you?'
const SET_OUT = '<p>Two things by hand.</p><ol><li>Open the &#60;b&#62;console&#60;/b&#62;.</li><li>Create a project.</li></ol><p>Where are you?</p>'
const ask = (questions) => ({ id: 'a1', kind: 'ask', from: 'June', cli: 'claude', ask: { type: 'question', questions: questions.map((question) => ({ question, options: [{ label: 'Done' }, { label: 'Later' }] })) } })
const question = (html) => html.match(/<div class="ask-question ask-words">([\s\S]*?)<\/div>/)[1]

test('the card sets the steps out as a list between what leads in and the question itself', () => {
  assert.equal(question(askCard(ask([STEPS]))), SET_OUT)
})

test('a question without steps is shown as it was asked, character for character: nothing in it is Markdown', () => {
  for (const text of [
    'Should the empty cart show suggestions?',
    'Should I (1) rebase onto main, (2) merge main in, or (3) leave it?',
    'Should I also format *.md and *.json files?',
    'Should __init__.py re-export the client?',
    'Glob src/**/*.ts or lib/**/*.ts?',
    'Use the ```npm ci``` way?',
    '1. Which region?',
    '# of retries: 3 or 5?',
    '- or + for the diff marker?',
    'Use **strict** mode, see https://example.com/a_b_c?',
  ]) {
    assert.equal(question(askCard(ask([text]))), text.replace(/</g, '&#60;').replace(/>/g, '&#62;'), text)
    assert.equal(sayLine({ agent: { name: 'June' }, ask: ask([text]) }), text, text)
  }
})

test('steps keep their own characters too', () => {
  assert.equal(question(askCard(ask(['By hand: (1) Format *.md and *.json. (2) Keep __init__.py. Done?']))), '<p>By hand:</p><ol><li>Format *.md and *.json.</li><li>Keep __init__.py.</li></ol><p>Done?</p>')
})

test('the answer still goes back under the question as the agent asked it', () => {
  const e = ask([STEPS])
  askCard(e)
  assert.equal(e.ask.questions[0].question, STEPS)
})

test('in Needs you the creature says the steps as a list, and the line about more questions stands after them', () => {
  assert.equal(sayLine({ agent: { name: 'June' }, ask: ask([STEPS]) }), SET_OUT)
  assert.equal(sayLine({ agent: { name: 'June' }, ask: ask([STEPS, 'And the region?']) }), `${SET_OUT}<p>And 1 more question.</p>`)
  assert.equal(sayLine({ agent: { name: 'June' }, ask: ask(['Which region?', 'And the name?', 'And the plan?']) }), 'Which region? And 2 more questions.')
})

test('answered: the question keeps its steps, and the answer comes right after what was asked', () => {
  const answered = (q, v) => askSummary({ type: 'question' }, { by: 'you', answers: { [q]: v } }).match(/<div class="ask-asked ask-words">([\s\S]*)<\/div><\/div>$/)[1]
  assert.equal(answered(STEPS, 'Done'), `${SET_OUT}<b>Done</b>`)
  assert.equal(answered('Which region?', 'eu-west-1'), '<p>Which region?</p><b>eu-west-1</b>')
  assert.equal(answered('Use **strict** mode?', '<Yes>'), '<p>Use **strict** mode?</p><b>&#60;Yes&#62;</b>')
})

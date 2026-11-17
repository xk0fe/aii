// A question whose steps came written in a run, "(1) … (2) …": runInList and askMarkdown from ui/common.js against the
// cases both apps share (shared/ask-steps.json; the phone's copy is tested in mobile/test/markdown.test.ts), then the
// card and the Needs you bubble that show them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ clique: {}, avatarHTML: () => '', agentColor: () => '', CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { runInList, askMarkdown, askCard, sayLine }', ctx)
const { runInList, askMarkdown, askCard, sayLine } = ctx.__x
const cases = JSON.parse(fs.readFileSync(path.join(A, '../shared/ask-steps.json'), 'utf8'))
const plain = (v) => JSON.parse(JSON.stringify(v)) // out of the vm's realm, so deepEqual compares values

for (const c of cases.runs) test(`steps in a run: ${c.name}`, () => assert.deepEqual(plain(runInList(c.text)), c.run))
for (const c of cases.markdown) test(`a question as Markdown: ${c.name}`, () => assert.equal(askMarkdown(c.text), c.markdown))

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
const ask = (questions) => ({ id: 'a1', kind: 'ask', from: 'June', cli: 'claude', ask: { type: 'question', questions: questions.map((question) => ({ question, options: [{ label: 'Done' }, { label: 'Later' }] })) } })
const question = (html) => html.match(/<div class="ask-question ask-md">([\s\S]*?)<\/div>/)[1]

test('the card sets the steps out as a list between what leads in and the question itself', () => {
  assert.equal(question(askCard(ask([STEPS]))), '<p>Two things by hand.</p><ol><li>Open the &#60;b&#62;console&#60;/b&#62;.</li><li>Create a project.</li></ol><p>Where are you?</p>')
})

test('a plain question is one paragraph, as written', () => {
  assert.equal(question(askCard(ask(['Should the empty cart show suggestions?']))), '<p>Should the empty cart show suggestions?</p>')
  assert.equal(question(askCard(ask(['Should I (1) rebase onto main, (2) merge main in, or (3) leave it?']))), '<p>Should I (1) rebase onto main, (2) merge main in, or (3) leave it?</p>')
})

test('the answer still goes back under the question as the agent asked it', () => {
  const e = ask([STEPS])
  askCard(e)
  assert.equal(e.ask.questions[0].question, STEPS)
})

test('in Needs you the creature says the steps as a list, and the line about more questions stands after them', () => {
  assert.equal(sayLine({ agent: { name: 'June' }, ask: ask([STEPS]) }), '<p>Two things by hand.</p><ol><li>Open the &#60;b&#62;console&#60;/b&#62;.</li><li>Create a project.</li></ol><p>Where are you?</p>')
  assert.match(sayLine({ agent: { name: 'June' }, ask: ask([STEPS, 'And the region?']) }), /<p>Where are you\?<\/p><p>And 1 more question\.<\/p>$/)
  assert.equal(sayLine({ agent: { name: 'June' }, ask: ask(['Which region?', 'And the name?', 'And the plan?']) }), '<p>Which region? And 2 more questions.</p>')
})

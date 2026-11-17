// Links in rendered Markdown (ui/common.js openLink): a click opens the page in your browser. The window itself never
// navigates (main.js stops it), so a view that shows Markdown and doesn't ask leaves a link that does nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const A = path.resolve(import.meta.dirname, '..')
const calls = []
const ctx = vm.createContext({ clique: { call: async (...args) => void calls.push(args) }, avatarHTML: () => '', agentColor: () => '', CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { openLink }', ctx)
const { openLink } = ctx.__x

// a click whose target sits inside `link` (or inside no link at all)
const click = (link) => ({ prevented: false, preventDefault() { this.prevented = true }, target: { closest: (sel) => (sel === 'a[href]' ? link : null) } })

test('a click on a link opens it in the browser, and the page stays where it is', () => {
  const ev = click({ href: 'https://example.com/spec?id=12' })
  assert.equal(openLink(ev), true)
  assert.equal(ev.prevented, true)
  assert.deepEqual(calls, [['openUrl', 'https://example.com/spec?id=12']])
})

test('a click anywhere else is left to the view', () => {
  calls.length = 0
  const ev = click(null)
  assert.equal(openLink(ev), false)
  assert.equal(ev.prevented, false)
  assert.deepEqual(calls, [])
})

test('every view that shows Markdown opens its links: the chat, a thread, a task', () => {
  for (const file of fs.readdirSync(path.join(A, 'ui')).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(A, 'ui', file), 'utf8')
    if (/\bmd\(/.test(src.replace(/^function md\(.*$/m, ''))) assert.match(src, /\bopenLink\((e|ev)\)/, `${file} shows Markdown, so its click handler starts with openLink(ev)`)
  }
  assert.match(fs.readFileSync(path.join(A, 'ui/tasks.js'), 'utf8'), /tp\.addEventListener\('click'[\s\S]{0,600}openLink\(e\)/, 'the task panel: its description, notes and review')
})

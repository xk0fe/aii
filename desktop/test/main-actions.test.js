// What the pages can ask of the app: main.js's `actions`, called as clique.call('<name>', ...args). Two keys of one name
// in an object literal is no error: the second quietly wins. That happened (2026-11-16, app updates took `update`), and
// for a week every Save on the agent sheet came back "unknown update action": no model, effort or switch changed from
// the app. main.js needs Electron, so this reads it. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(DESKTOP, file), 'utf8')

// The action names, in the order main.js gives them: each key of `actions`, and each of a `...(cond && { … })` in it.
// (main.js is laid out by one formatter: a key two spaces in, a spread's keys four.)
function actionNames(main) {
  const lines = main.split('\n')
  const from = lines.indexOf('const actions = {')
  assert.ok(from >= 0, 'main.js has no `const actions = {`')
  const to = lines.indexOf('}', from)
  const names = []
  let spread = false
  for (const line of lines.slice(from + 1, to)) {
    if (/^ {2}\.\.\.\(.*\{$/.test(line)) spread = true
    else if (/^ {2}\}\),?$/.test(line)) spread = false
    const key = (spread ? /^ {4}(?:async )?([A-Za-z_$][\w$]*)\s*[:(]/ : /^ {2}(?:async )?([A-Za-z_$][\w$]*)\s*[:(]/).exec(line)
    if (key) names.push(key[1])
  }
  return names
}

test('no two actions share a name, so none hides another', () => {
  const names = actionNames(read('main.js'))
  // (the scan found them: some from the start, the middle, the end and the spread)
  for (const n of ['state', 'send', 'update', 'addAgent', 'config', 'appUpdate', 'openAtLogin']) assert.ok(names.includes(n), `found ${n}`)
  assert.ok(names.length > 60, `${names.length} actions`)
  const twice = names.filter((n, i) => names.indexOf(n) !== i)
  assert.deepEqual(twice, [], `more than one action called ${twice.join(', ')}`)
})

test("update is an agent's settings and appUpdate is CLIque updating itself, and the pages ask each for its own", () => {
  const main = read('main.js')
  assert.match(main, /^ {2}update: \(names, patch\) => clique\.update\(names, patch\),$/m)
  assert.match(main, /^ {2}appUpdate: \(op, arg\) => \{\n {4}const ops = \{ check: .*restart: .*later: /m)
  const ui = ['ui/common.js', 'ui/dashboard.js', 'ui/collection.js'].map(read).join('\n')
  // the app's own update: Check for Updates…, Restart to update, Later / Not now
  const app = [...ui.matchAll(/clique\.call\('(\w+)', '(check|restart|later)'/g)].map((m) => m[1])
  assert.equal(app.length, 4)
  assert.deepEqual([...new Set(app)], ['appUpdate'])
  // an agent's: the sheet's Save, the bulk edit, the switches
  const agents = [...ui.matchAll(/clique\.call\('update', (\w+)/g)].map((m) => m[1])
  assert.ok(agents.includes('editing') && agents.includes('names'), agents.join(' '))
  // and the demo page answers the same names (scripts/screenshot-preload.cjs)
  assert.match(read('scripts/screenshot-preload.cjs'), /if \(action === 'appUpdate'\) return updateAction\(\.\.\.args\)/)
})

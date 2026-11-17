// Settings' Experiments, as config.json keeps them: the floating chat following the mouse ("chatAt": "mouse") and the
// minimised dock ("pillMini": true). Each is in the file only while it's on, and changing one tells the windows. What
// they look like is checked in the shots (npm run shots -- mini, follow). Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-experiments-'))
if (process.platform !== 'win32') process.env.PATH = '/usr/bin:/bin' // no codex to discover once a hub starts
const { CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
fs.writeFileSync(CONFIG, JSON.stringify({ agents: [] }))

const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
const saved = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
// the next state the windows are sent
const nextState = () => new Promise((resolve) => clique.once('state', resolve))

after(() => {
  for (const hub of clique.hubs.values()) {
    clearInterval(hub.stallTimer)
    for (const t of ['statsTimer', 'convoTimer', 'lookTimer']) clearTimeout(hub[t])
  }
  clearTimeout(clique.changeTimer)
  fs.unwatchFile(CONFIG)
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
})

test('the minimised dock is off until config.json says "pillMini": true, and turning it off takes that out', async () => {
  assert.equal('pillMini' in saved(), false)
  let told = nextState()
  assert.equal(clique.setPillMini(true), true)
  assert.equal(saved().pillMini, true)
  await told
  told = nextState()
  assert.equal(clique.setPillMini(false), false)
  assert.equal('pillMini' in saved(), false)
  await told
})

test('the two are kept apart: following the mouse leaves the minimised dock as it was, for when the pill is back', () => {
  clique.setPillMini(true)
  assert.equal(clique.setChatAt('mouse'), 'mouse')
  assert.equal(saved().pillMini, true)
  assert.equal(clique.setChatAt('sticky'), 'sticky')
  assert.equal('chatAt' in saved(), false)
  assert.equal(saved().pillMini, true)
  clique.setPillMini(false)
})

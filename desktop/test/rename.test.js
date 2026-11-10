// The app was Crew before it was CLIque. An install from then is carried over (core/migrate.js), and what was written
// or started under the old names still reads and runs (core/home.js, bin/, and the places that load what was saved).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { homeDir, oldEnv, movedPath, movedImages } from '../core/home.js'
import { moveHome, moveUserData } from '../core/migrate.js'
import { readPack } from '../core/pack.js'
import { makeCode, readCode } from '../core/link.js'
import { Tickets } from '../core/tickets.js'

const A = path.resolve(import.meta.dirname, '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clique-rename-'))
const POSIX = process.platform !== 'win32'

test('the folder: ~/.clique, an older install\'s ~/.crew while that is all there is, and CLIQUE_HOME over both', () => {
  const home = tmp()
  assert.equal(homeDir({ env: {}, home }), path.join(home, '.clique'), 'a new install')
  fs.mkdirSync(path.join(home, '.crew'))
  assert.equal(homeDir({ env: {}, home }), path.join(home, '.crew'), 'not moved yet: used where it is')
  fs.mkdirSync(path.join(home, '.clique'))
  assert.equal(homeDir({ env: {}, home }), path.join(home, '.clique'))
  assert.equal(homeDir({ env: { CLIQUE_HOME: '/elsewhere' }, home }), '/elsewhere')
})

test('a variable set under its old name counts, unless the new one is set too', () => {
  const env = oldEnv({ CREW_HOME: '/old', CREW_SAVERS: 'off', CLIQUE_SAVERS: 'on', PATH: '/bin' })
  assert.equal(env.CLIQUE_HOME, '/old')
  assert.equal(env.CLIQUE_SAVERS, 'on')
  assert.equal(env.PATH, '/bin')
})

test('the app moves an older install\'s folder once, and leaves a link where it was', () => {
  const home = tmp()
  const was = path.join(home, '.crew')
  fs.mkdirSync(path.join(was, 'workspaces', 'shop'), { recursive: true })
  fs.writeFileSync(path.join(was, 'config.json'), '{"agents":[]}')
  assert.equal(moveHome({ env: {}, home }), path.join(home, '.clique'))
  assert.equal(fs.readFileSync(path.join(home, '.clique', 'config.json'), 'utf8'), '{"agents":[]}')
  assert.ok(fs.lstatSync(was).isSymbolicLink(), 'what was written down with the old path still gets there')
  assert.ok(fs.existsSync(path.join(was, 'workspaces', 'shop')))
  assert.equal(moveHome({ env: {}, home }), null, 'the second time there is nothing to move')
  assert.equal(homeDir({ env: {}, home }), path.join(home, '.clique'))
})

test('nothing is moved for a new install, when both folders are there, or when CLIQUE_HOME says where', () => {
  const fresh = tmp()
  assert.equal(moveHome({ env: {}, home: fresh }), null)
  assert.deepEqual(fs.readdirSync(fresh), [])
  const both = tmp()
  fs.mkdirSync(path.join(both, '.crew'))
  fs.mkdirSync(path.join(both, '.clique'))
  fs.writeFileSync(path.join(both, '.clique', 'config.json'), '{}')
  assert.equal(moveHome({ env: {}, home: both }), null)
  assert.ok(!fs.lstatSync(path.join(both, '.crew')).isSymbolicLink())
  for (const name of ['CLIQUE_HOME', 'CREW_HOME']) {
    const own = tmp()
    fs.mkdirSync(path.join(own, '.crew'))
    assert.equal(moveHome({ env: { [name]: path.join(own, 'mine') }, home: own }), null, name)
    assert.ok(fs.existsSync(path.join(own, '.crew')) && !fs.existsSync(path.join(own, '.clique')), name)
  }
})

test('a folder that cannot be moved stays where it is, and is used there', () => {
  const home = tmp()
  fs.mkdirSync(path.join(home, '.crew'))
  const files = { ...fs, renameSync: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) } }
  assert.equal(moveHome({ env: {}, home, files }), null)
  assert.equal(homeDir({ env: {}, home }), path.join(home, '.crew'))
})

test('the windows\' saved settings move with it: Electron\'s folder for Crew becomes CLIque\'s', () => {
  const appData = tmp()
  fs.mkdirSync(path.join(appData, 'Crew', 'Local Storage'), { recursive: true })
  assert.equal(moveUserData(appData, 'CLIque'), path.join(appData, 'CLIque'))
  assert.ok(fs.existsSync(path.join(appData, 'CLIque', 'Local Storage')))
  assert.ok(!fs.existsSync(path.join(appData, 'Crew')))
  assert.equal(moveUserData(tmp(), 'CLIque').endsWith('CLIque'), true, 'a new install: just where it goes')
})

test('an agent pack exported before the rename still imports', () => {
  assert.equal(readPack(JSON.stringify({ crew: 1, agents: [{ name: 'ada' }] })).agents.length, 1)
  assert.equal(readPack(JSON.stringify({ clique: 1, agents: [] })).agents.length, 0)
  assert.throws(() => readPack(JSON.stringify({ agents: [] })), /isn't a CLIque agent pack/)
})

test('a link code from a computer that has not updated yet is still read', () => {
  const code = makeCode({ name: 'studio', port: 7777, key: 'k', fingerprint: 'f', hosts: ['10.0.0.2'] })
  assert.match(code, /^clique1\./)
  assert.equal(readCode(code).name, 'studio')
  assert.equal(readCode(code.replace(/^clique1/, 'crew1')).port, 7777)
})

test('what the app did on the board before the rename is still its own', () => {
  const file = path.join(tmp(), 'tickets.json')
  fs.writeFileSync(file, JSON.stringify({ next: 2, tickets: [{ id: 1, title: 'x', status: 'new', log: [{ by: 'crew', ts: 1 }, { by: 'ada', ts: 2 }] }] }))
  assert.deepEqual(new Tickets(file).all[0].log.map((l) => l.by), ['clique', 'ada'])
})

test('the old names of the tools run the new ones, with the old variables', { skip: !POSIX && 'sh scripts' }, () => {
  for (const name of ['crew', 'crew-status', 'crew-sh']) assert.match(fs.readFileSync(path.join(A, 'bin', name), 'utf8'), new RegExp(`exec "\\$\\(dirname "\\$0"\\)/${name.replace('crew', 'clique')}"`))
  const home = tmp()
  const env = { PATH: process.env.PATH, HOME: home, CREW_HOME: path.join(home, 'none') }
  const out = spawnSync(path.join(A, 'bin', 'crew'), ['who'], { env, encoding: 'utf8' })
  assert.equal(out.stderr.trim(), 'CLIque is not running')
  assert.equal(out.status, 1)
  // an agent from before the rename: its folder and who it is come from CREW_*
  fs.mkdirSync(path.join(home, 'old'))
  fs.writeFileSync(path.join(home, 'old', 'url'), 'http://127.0.0.1:9')
  fs.writeFileSync(path.join(home, 'old', 'token'), 't')
  const there = spawnSync(path.join(A, 'bin', 'crew'), ['who'], { env: { ...env, CREW_HOME: path.join(home, 'old') }, encoding: 'utf8' })
  assert.match(there.stderr, /CLIque is not running/, 'it found the address in the old folder, and nothing answers there')
  assert.equal(execFileSync(path.join(A, 'bin', 'crew-sh'), ['echo hi'], { env, encoding: 'utf8' }), 'hi\n')
})

test('clique.mjs answers to the old names too', () => {
  const run = (as) => spawnSync(process.execPath, [path.join(A, 'bin', 'clique.mjs'), as, 'who'], { env: { PATH: process.env.PATH, HOME: tmp(), CREW_HOME: path.join(tmp(), 'none') }, encoding: 'utf8' })
  for (const as of ['crew', 'clique']) {
    const out = run(as)
    assert.equal(out.stderr.trim(), 'CLIque is not running', as)
    assert.equal(out.status, 1)
  }
  assert.equal(run('crow').status, 2, 'any other name is refused')
})

test('a stray empty ~/.clique does not hide the install: it is used where it is, and moved over the empty one', () => {
  const home = tmp()
  fs.mkdirSync(path.join(home, '.crew'))
  fs.writeFileSync(path.join(home, '.crew', 'config.json'), '{"agents":[]}')
  fs.mkdirSync(path.join(home, '.clique'))
  assert.equal(homeDir({ env: {}, home }), path.join(home, '.crew'), 'the one with the settings in it')
  assert.equal(moveHome({ env: {}, home }), path.join(home, '.clique'))
  assert.equal(fs.readFileSync(path.join(home, '.clique', 'config.json'), 'utf8'), '{"agents":[]}')
  assert.equal(homeDir({ env: {}, home }), path.join(home, '.clique'))
  // one with something in it but no settings is left alone, and the install is still the one used
  const other = tmp()
  fs.mkdirSync(path.join(other, '.crew'))
  fs.writeFileSync(path.join(other, '.crew', 'config.json'), '{}')
  fs.mkdirSync(path.join(other, '.clique', 'logs'), { recursive: true })
  assert.equal(moveHome({ env: {}, home: other }), null)
  assert.equal(homeDir({ env: {}, home: other }), path.join(other, '.crew'))
})

test('the window-settings folder that cannot be moved is used where it is, so the older app\'s lock is met there', () => {
  const appData = tmp()
  fs.mkdirSync(path.join(appData, 'Crew'))
  const files = { ...fs, renameSync: () => { throw Object.assign(new Error('in use'), { code: 'EPERM' }) } }
  assert.equal(moveUserData(appData, 'CLIque', { files, env: {} }), path.join(appData, 'Crew'))
  // a run with a folder of its own moves nothing
  assert.equal(moveUserData(appData, 'CLIque', { env: { CREW_HOME: '/x' } }), path.join(appData, 'CLIque'))
  assert.ok(fs.existsSync(path.join(appData, 'Crew')))
})

test('an image written down before the folder moved is found where it is now', () => {
  const user = '/Users/you'
  const home = path.join(user, '.clique')
  const at = (p) => movedPath(p, { home, user })
  assert.equal(at('/Users/you/.crew/attachments/2026-10-01-ab.png'), '/Users/you/.clique/attachments/2026-10-01-ab.png')
  assert.equal(at('/Users/you/.crewcut/x.png'), '/Users/you/.crewcut/x.png', 'only that folder')
  assert.equal(at('/Users/you/.clique/attachments/a.png'), '/Users/you/.clique/attachments/a.png')
  assert.equal(at(undefined), undefined)
  assert.equal(movedPath('/Users/you/.crew/attachments/a.png', { home: '/elsewhere', user }), '/Users/you/.crew/attachments/a.png', 'a folder of your own: nothing moved')
  assert.deepEqual(movedImages({ id: 1, text: 'x' }), { id: 1, text: 'x' })
})

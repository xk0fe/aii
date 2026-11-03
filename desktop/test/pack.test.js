// Agent packs (.crew files), against a stand-in hub: what travels, what doesn't, and what a pack can't change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { packAgents, readPack, unpackAgents } from '../core/pack.js'

function fakeHub(agents, providers = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-pack-test-'))
  return {
    dir,
    config: { agents, providers },
    stats: {},
    added: [],
    saveStats() {},
    saveImage(name, type, bytes) {
      const file = path.join(dir, `${this.added.length}-${name}.png`)
      fs.writeFileSync(file, bytes)
      return file
    },
    addAgent(fields) {
      this.added.push(fields)
      return fields.name
    },
  }
}

test('a pack carries the definition, look, images and custom providers, not folders or sessions', () => {
  const src = fakeHub([], { mine: { label: 'Mine', cli: 'claude' } })
  const image = path.join(src.dir, 'ref.png')
  fs.writeFileSync(image, 'png bytes')
  src.config.agents.push({ name: 'iris', area: 'design', prompt: 'be nice', provider: 'mine', model: 'opus', yolo: true, cwd: '/Users/me/code/app', images: [image], avatar: { color: 'pink' } })
  const pack = packAgents(src, ['iris'])
  const [a] = pack.agents
  assert.equal(a.folder, 'app')
  assert.equal(a.cwd, undefined)
  assert.deepEqual(a.avatar, { seed: 'iris', color: 'pink' })
  assert.equal(Buffer.from(a.images[0].data, 'base64').toString(), 'png bytes')
  assert.deepEqual(pack.providers, { mine: { label: 'Mine', cli: 'claude' } })
  assert.equal(a.stats, undefined, 'work experience only travels in moves')
})

test('importing: chosen name and folder, starts off, never overrides your providers', () => {
  const pack = readPack(JSON.stringify({ crew: 1, agents: [{ name: 'iris', area: 'design', provider: 'mine', images: [{ type: 'image/png', data: Buffer.from('x').toString('base64') }] }], providers: { mine: { label: 'Theirs' } } }))
  const dst = fakeHub([], { mine: { label: 'Mine' } })
  assert.deepEqual(unpackAgents(dst, pack, [{ index: 0, name: 'iris-2', folder: '~/work', on: false }]), ['iris-2'])
  const [added] = dst.added
  assert.equal(added.cwd, '~/work')
  assert.equal(added.off, true)
  assert.equal(fs.readFileSync(added.images[0], 'utf8'), 'x')
  assert.equal(dst.config.providers.mine.label, 'Mine')
})

test('not a pack: a clear error', () => {
  assert.throws(() => readPack('{"agents": []}'), /isn't a CLIque agent pack/)
  assert.throws(() => readPack('nope'), /isn't a CLIque agent pack/)
})

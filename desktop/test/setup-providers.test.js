// Which providers the model picker offers (core/providers.js): Claude and Codex always; GLM and Ollama once added
// with Add provider… (saved in config.json), or when an agent already runs on one, which keeps working as before.
// And what each of those needs, looked at: a Z.ai key in the environment, Ollama running.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const { providersFrom, markOffered, isOffered, providersInUse, addProvider, removeProvider, keepProvidersInUse, checkProvider, OPTIONAL } = await import('../core/providers.js')
const { Config } = await import('../core/config.js')

const offered = (config) => Object.fromEntries(Object.entries(markOffered(providersFrom(config), config)).map(([id, p]) => [id, p.added]))

// config.json in a folder of its own, read as CLIque reads it
function configFile(data) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clique-providers-')), 'config.json')
  fs.writeFileSync(file, JSON.stringify(data))
  const cfg = new Config(file, { agents: [] })
  cfg.load()
  return cfg
}
const onDisk = (cfg) => JSON.parse(fs.readFileSync(cfg.file, 'utf8'))

test('a new clique’s picker offers Claude and Codex; GLM and Ollama wait behind Add provider…', () => {
  assert.deepEqual(offered({}), { claude: true, codex: true, glm: false, local: false })
  const marked = markOffered(providersFrom({}), {})
  assert.deepEqual(OPTIONAL.map((id) => marked[id].optional), [true, true])
  assert.equal(marked.claude.optional, undefined)
  assert.equal(marked.local.label, 'Ollama')
})

test('added with Add provider…: offered from then on', () => {
  assert.deepEqual(offered({ addedProviders: ['glm'] }), { claude: true, codex: true, glm: true, local: false })
  assert.deepEqual(offered({ addedProviders: 'glm' }), { claude: true, codex: true, glm: false, local: false }, 'only a list counts')
})

test('an agent already on GLM (yours) or Ollama (a workspace’s own) keeps it: offered, and it still runs on it', () => {
  const config = { agents: [{ name: 'Ada', provider: 'glm', model: 'glm-5.1' }], workspaces: [{ id: 'docs', name: 'Docs site', agents: [{ name: 'June', provider: 'local' }] }] }
  assert.deepEqual([...providersInUse(config)], ['glm', 'local'])
  assert.deepEqual(offered(config), { claude: true, codex: true, glm: true, local: true })
  const all = providersFrom(config)
  assert.deepEqual([all.glm.cli, all.glm.env.ANTHROPIC_BASE_URL, all.local.cli, all.local.args], ['claude', 'https://api.z.ai/api/anthropic', 'codex', ['--oss', '--local-provider', 'ollama']], 'launched as before')
  assert.equal(isOffered('glm', { agents: [{ name: 'Ada' }] }), false, 'an agent on Claude (no provider written) adds nothing')
})

test('your own providers in config.json, and ones a linked computer has, are offered as they are', () => {
  const config = { providers: { proxy: { label: 'Proxy', cli: 'claude' }, glm: { label: 'My GLM', cli: 'claude' } } }
  const marked = markOffered(providersFrom(config), config)
  assert.deepEqual([marked.proxy.added, marked.glm.added, marked.glm.optional, marked.local.added], [true, true, undefined, false])
  assert.equal(markOffered({ theirs: { label: 'Theirs' } }, {}).theirs.added, true)
})

test('Add provider… saves it in config.json, once; Remove takes it out, but not while an agent runs on it', () => {
  const cfg = configFile({ agents: [{ name: 'Milo', provider: 'claude' }] })
  addProvider(cfg, 'glm')
  addProvider(cfg, 'glm')
  assert.deepEqual(onDisk(cfg).addedProviders, ['glm'])
  assert.deepEqual(onDisk(cfg).agents, [{ name: 'Milo', provider: 'claude' }], 'the rest as it was')
  assert.throws(() => addProvider(cfg, 'claude'), /no such provider/)
  removeProvider(cfg, 'glm')
  assert.deepEqual(onDisk(cfg).addedProviders, [])
  const busy = configFile({ agents: [{ name: 'Rex', provider: 'local' }], addedProviders: ['local'] })
  assert.throws(() => removeProvider(busy, 'local'), /An agent still runs on Ollama: give it another model first/)
  assert.deepEqual(onDisk(busy).addedProviders, ['local'])
})

test('as CLIque starts, GLM or Ollama in use is written down as added, so it stays after its agent goes', () => {
  const cfg = configFile({ agents: [{ name: 'Ada', provider: 'glm' }], workspaces: [{ id: 'docs', agents: [{ name: 'June', provider: 'local' }] }], addedProviders: ['glm'] })
  assert.equal(keepProvidersInUse(cfg), true)
  assert.deepEqual(onDisk(cfg).addedProviders, ['glm', 'local'])
  assert.equal(keepProvidersInUse(cfg), false, 'nothing more to write')
  cfg.data.agents = []
  cfg.data.workspaces = []
  cfg.save()
  assert.deepEqual(offered(onDisk(cfg)), { claude: true, codex: true, glm: true, local: true })
  const plain = configFile({ agents: [{ name: 'Theo', provider: 'codex' }] })
  const before = fs.readFileSync(plain.file, 'utf8')
  assert.equal(keepProvidersInUse(plain), false)
  assert.equal(fs.readFileSync(plain.file, 'utf8'), before, 'config.json untouched when there’s nothing to keep')
})

test('GLM needs a Z.ai key in your environment', async () => {
  assert.deepEqual(await checkProvider('glm', { env: { ZAI_API_KEY: 'zk-test' } }), { id: 'glm', key: true })
  assert.deepEqual(await checkProvider('glm', { env: {} }), { id: 'glm', key: false })
  await assert.rejects(checkProvider('nope', { env: {} }), /no such provider/)
})

test('Ollama: running when it answers where Codex reaches it, and not when nothing does', async () => {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push(req.url)
    res.writeHead(req.url === '/api/version' ? 200 : 404, { 'content-type': 'application/json' })
    res.end('{"version":"0.12.0"}')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  try {
    assert.deepEqual(await checkProvider('local', { env: { CODEX_OSS_PORT: String(port) } }), { id: 'local', running: true })
    assert.deepEqual(await checkProvider('local', { env: { CODEX_OSS_BASE_URL: `http://127.0.0.1:${port}/v1` } }), { id: 'local', running: true })
    assert.deepEqual(seen, ['/api/version', '/api/version'])
  } finally {
    await new Promise((r) => server.close(r))
  }
  assert.deepEqual(await checkProvider('local', { env: { CODEX_OSS_PORT: String(port) } }), { id: 'local', running: false })
  const silent = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
  assert.deepEqual(await checkProvider('local', { env: {}, fetch: silent, timeout: 50 }), { id: 'local', running: false }, 'one that never answers, given up on')
})

// A pairing code lists every address of the sharing computer (Wi-Fi, Tailscale IP, Tailscale name). The linking
// computer tries them all at once; only the first to answer may be sent the key, or the sharing computer gets a
// connection per address and loses the link when the slower ones are dropped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LinkHost, LinkClient, identity, makeCode } from '../core/link.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('a computer reachable on several addresses gets one connection, and keeps it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-link-addresses-'))
  const id = identity(dir)
  const key = 'k'.repeat(32)
  const host = new LinkHost({ key, cert: id.cert, keyPem: id.key, name: 'Studio Mac', handle: async () => null })
  const peers = []
  host.on('peer', (p) => peers.push(p))
  const port = 20000 + Math.floor(Math.random() * 20000)
  await host.start(port)
  const code = makeCode({ name: 'Studio Mac', port, key, fingerprint: id.fingerprint, hosts: ['127.0.0.1', 'localhost', '127.0.0.1'] })
  const client = new LinkClient(code, { name: 'Air', handle: async () => null })
  const linked = new Promise((r) => client.once('peer', r))
  client.connect()
  const mine = await linked
  await sleep(300) // the slower addresses' connections have been dropped by now
  try {
    assert.equal(peers.length, 1, 'only the address that answered first was sent the key')
    assert.equal(peers[0].ws.readyState, 1, "the sharing computer's side is still open")
    const heard = new Promise((r) => mine.once('alert', (name, text) => r(text)))
    peers[0].push('alert', 'gal', 'still here')
    assert.equal(await heard, 'still here', 'and what it sends still arrives')
  } finally {
    client.close()
    mine.close()
    host.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

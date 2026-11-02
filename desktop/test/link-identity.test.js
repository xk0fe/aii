// A computer's Crew Link certificate (core/link.js identity): made without openssl, which Windows doesn't have, kept
// when an older Crew made one with openssl (so linked computers keep their code), and replaced when the TLS of the
// runtime can't use it. Crew runs in Electron, whose TLS is BoringSSL, not the OpenSSL these tests run on, so the
// handshake is tried there too. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { identity, selfSigned } from '../core/link.js'

// What an older Crew made with `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1` (test keys, made
// for these tests only). OpenSSL 3 names the curve; macOS's own openssl, LibreSSL 3, writes its parameters out, which
// BoringSSL can't read.
const OPENSSL = {
  key: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQglyOv8Qr9JOLcysF9
KxkOBl3TEIv3RqGi2RVhfgGRiC6hRANCAAQV/kk55Ix0WCrt9vILtsmmPRHaRlM6
OxM2GIYom7D1xuPeDtdwgltSfUdJ/rspUNlRKcA4voFQq/Pn0kt8Pqoy
-----END PRIVATE KEY-----
`,
  cert: `-----BEGIN CERTIFICATE-----
MIIBWzCCAQKgAwIBAgIURtEri2jfH53zEiRaM/DDaN10IYAwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJY3Jldy1saW5rMB4XDTI2MTEwMjIwMDMyM1oXDTM2MTAzMDIw
MDMyM1owFDESMBAGA1UEAwwJY3Jldy1saW5rMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEFf5JOeSMdFgq7fbyC7bJpj0R2kZTOjsTNhiGKJuw9cbj3g7XcIJbUn1H
Sf67KVDZUSnAOL6BUKvz59JLfD6qMqMyMDAwHQYDVR0OBBYEFKfGbjgx77SQK4qE
qb2EsOrO4OjhMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDRwAwRAIgVHKw
uOl7bnqarYmy3aGQvJt6RmToQSv+vPPXGxWwOjgCIBG7gHM4GjWfYGZXlBOhag9G
LiOYW2nLrYEZ20QToqln
-----END CERTIFICATE-----
`,
  fingerprint: 'CF:1F:3C:A3:42:E7:13:6C:18:A7:D7:FC:24:48:2C:A7:09:5A:DE:26:38:F8:FA:FB:BB:57:2E:60:47:C8:82:27',
}
const LIBRESSL = {
  key: `-----BEGIN PRIVATE KEY-----
MIIBeQIBADCCAQMGByqGSM49AgEwgfcCAQEwLAYHKoZIzj0BAQIhAP////8AAAAB
AAAAAAAAAAAAAAAA////////////////MFsEIP////8AAAABAAAAAAAAAAAAAAAA
///////////////8BCBaxjXYqjqT57PrvVV2mIa8ZR0GsMxTsPY7zjw+J9JgSwMV
AMSdNgiG5wSTamZ44ROdJreBn36QBEEEaxfR8uEsQkf4vOblY6RA8ncDfYEt6zOg
9KE5RdiYwpZP40Li/hp/m47n60p8D54WK84zV2sxXs7LtkBoN79R9QIhAP////8A
AAAA//////////+85vqtpxeehPO5ysL8YyVRAgEBBG0wawIBAQQgeAySW0FWMLop
U1n0z74XeoCXOjGD7zewP8IyYVwJAbChRANCAATIhLy6UfuZFvwXD/+zxUSbzBKg
ji/n69zEaARUNd2oEhnSDJa/0lCmDd5rj5Vi36OvjwkdGDjDMCoGkfoE7pW7
-----END PRIVATE KEY-----
`,
  cert: `-----BEGIN CERTIFICATE-----
MIICDTCCAbICCQCHXv1EBQM4NjAKBggqhkjOPQQDAjAUMRIwEAYDVQQDDAljcmV3
LWxpbmswHhcNMjYxMTAyMjAwMzEyWhcNMzYxMDMwMjAwMzEyWjAUMRIwEAYDVQQD
DAljcmV3LWxpbmswggFLMIIBAwYHKoZIzj0CATCB9wIBATAsBgcqhkjOPQEBAiEA
/////wAAAAEAAAAAAAAAAAAAAAD///////////////8wWwQg/////wAAAAEAAAAA
AAAAAAAAAAD///////////////wEIFrGNdiqOpPns+u9VXaYhrxlHQawzFOw9jvO
PD4n0mBLAxUAxJ02CIbnBJNqZnjhE50mt4GffpAEQQRrF9Hy4SxCR/i85uVjpEDy
dwN9gS3rM6D0oTlF2JjClk/jQuL+Gn+bjufrSnwPnhYrzjNXazFezsu2QGg3v1H1
AiEA/////wAAAAD//////////7zm+q2nF56E87nKwvxjJVECAQEDQgAEyIS8ulH7
mRb8Fw//s8VEm8wSoI4v5+vcxGgEVDXdqBIZ0gyWv9JQpg3ea4+VYt+jr48JHRg4
wzAqBpH6BO6VuzAKBggqhkjOPQQDAgNJADBGAiEA8BGpmXkY5uMURt2AhUDzmvqc
+/H4+uxNvuydEq6cZJ0CIQDcV+KSzyl0WuwbZbXWtjjw+3BWDU+lYp+W6XRar0b3
VQ==
-----END CERTIFICATE-----
`,
}

const made = []
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-identity-'))
  made.push(dir)
  return dir
}
const saved = (dir, { cert, key }) => (fs.writeFileSync(path.join(dir, 'cert.pem'), cert), fs.writeFileSync(path.join(dir, 'key.pem'), key), dir)
test.after(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10 })))

test('a computer gets its certificate without openssl, or any other program', () => {
  const dir = tmp()
  const was = process.env.PATH
  process.env.PATH = '' // nothing to run, were it to try
  let id
  try {
    id = identity(dir)
  } finally {
    process.env.PATH = was
  }
  const x = new crypto.X509Certificate(id.cert)
  assert.equal(x.subject, 'CN=crew-link')
  assert.equal(x.issuer, 'CN=crew-link')
  assert.ok(x.verify(x.publicKey), 'self-signed')
  assert.ok(x.checkPrivateKey(crypto.createPrivateKey(id.key)), 'with its key')
  assert.equal(x.publicKey.asymmetricKeyDetails.namedCurve, 'prime256v1')
  const years = (Date.parse(x.validTo) - Date.now()) / (365.25 * 864e5)
  assert.ok(years > 9.9 && years < 10.1, `good for ten years (${years})`)
  assert.equal(id.fingerprint, x.fingerprint256)
  assert.equal(fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8'), id.cert)
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'key.pem')).mode & 0o777, 0o600, 'the key is only yours')
  assert.deepEqual(identity(dir), id, 'and keeps it')
})

test('dates past 2049 are written as X.509 wants them', () => {
  const x = new crypto.X509Certificate(selfSigned('crew-link', { now: new Date('2045-06-01T00:00:00Z') }).cert)
  assert.equal(new Date(x.validTo).getUTCFullYear(), 2055)
})

test("one an older Crew made with openssl is kept: computers linked to it don't need a new code", () => {
  const dir = saved(tmp(), OPENSSL)
  const id = identity(dir)
  assert.equal(id.fingerprint, OPENSSL.fingerprint)
  assert.equal(fs.readFileSync(path.join(dir, 'key.pem'), 'utf8'), OPENSSL.key)
})

test("a key that isn't the certificate's, or half of the pair, is replaced", () => {
  const mixed = saved(tmp(), { cert: OPENSSL.cert, key: selfSigned('x').key })
  assert.notEqual(identity(mixed).fingerprint, OPENSSL.fingerprint)
  const half = tmp()
  fs.writeFileSync(path.join(half, 'cert.pem'), OPENSSL.cert)
  assert.notEqual(identity(half).fingerprint, OPENSSL.fingerprint)
})

// Each identity, kept or made, in a runtime: does a computer link to one serving it, and is it the one that was saved?
const LINKS = `
  import fs from 'node:fs'
  import os from 'node:os'
  import path from 'node:path'
  const { LinkHost, LinkClient, identity, makeCode } = await import(process.env.LINK_JS)
  const linked = async (id) => {
    const key = 'k'.repeat(32)
    const host = new LinkHost({ key, cert: id.cert, keyPem: id.key, name: 'A', handle: async (fn) => 'pong ' + fn })
    const port = 20000 + Math.floor(Math.random() * 20000)
    await host.start(port)
    const client = new LinkClient(makeCode({ name: 'A', port, key, fingerprint: id.fingerprint, hosts: ['127.0.0.1'] }), { name: 'B', handle: async () => null })
    try {
      const peer = await new Promise((resolve, reject) => {
        client.once('peer', resolve)
        client.on('status', (s) => s.error && reject(new Error(s.error)))
        client.connect()
      })
      return await peer.call('ping')
    } finally {
      client.close()
      host.stop()
    }
  }
  const out = {}
  for (const [name, saved] of Object.entries({ fresh: null, ...JSON.parse(process.env.SAVED) })) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-identity-run-'))
    if (saved) for (const f of ['cert', 'key']) fs.writeFileSync(path.join(dir, f + '.pem'), saved[f])
    try {
      const id = identity(dir)
      out[name] = { kept: saved ? id.cert === saved.cert : null, answer: await linked(id) }
    } catch (e) {
      out[name] = { error: e.message }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  }
  console.log(JSON.stringify(out))
  process.exit(0)`
const run = (bin, env = {}) =>
  JSON.parse(execFileSync(bin, ['--input-type=module', '-e', LINKS], {
    env: { ...process.env, ...env, LINK_JS: pathToFileURL(fileURLToPath(new URL('../core/link.js', import.meta.url))).href, SAVED: JSON.stringify({ openssl: OPENSSL, libressl: LIBRESSL }) },
    encoding: 'utf8', timeout: 60000,
  }))

test('linking works with each of them in Node', () => {
  assert.deepEqual(run(process.execPath), {
    fresh: { kept: null, answer: 'pong ping' },
    openssl: { kept: true, answer: 'pong ping' },
    libressl: { kept: true, answer: 'pong ping' }, // OpenSSL reads it
  })
})

const DIST = fileURLToPath(new URL('../node_modules/electron/dist/', import.meta.url))
const ELECTRON = path.join(DIST, { darwin: 'Electron.app/Contents/MacOS/Electron', win32: 'electron.exe' }[process.platform] ?? 'electron')
test('…and in Electron, where Crew runs: a LibreSSL one is made anew there', { skip: !fs.existsSync(ELECTRON) && 'no Electron to run' }, () => {
  assert.deepEqual(run(ELECTRON, { ELECTRON_RUN_AS_NODE: '1' }), {
    fresh: { kept: null, answer: 'pong ping' },
    openssl: { kept: true, answer: 'pong ping' },
    libressl: { kept: false, answer: 'pong ping' }, // BoringSSL can't read it, so sharing never started with it
  })
})

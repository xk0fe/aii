// Pairing codes as people hand them over, and the ways they go wrong.
import { parsePairCode, urlFor } from '@/net/pairing'
import { b64, makePairCode, utf8 } from '@/net/shared'

const key = new Uint8Array(32).fill(7)
const secret = new Uint8Array(32).fill(9)
const good = makePairCode({ id: 'mac-id', name: 'Studio', key, secret, hosts: ['192.168.1.20', '100.101.102.103', 'studio.tail1234.ts.net'], port: 7788 })
const raw = (json: unknown) => `cliquephone1.${b64(utf8(JSON.stringify(json)))}`

test('reads a good code', () => {
  const c = parsePairCode(good)
  expect(c).toMatchObject({ id: 'mac-id', name: 'Studio', hosts: ['192.168.1.20', '100.101.102.103', 'studio.tail1234.ts.net'], port: 7788 })
  expect([...c.key]).toEqual([...key])
  expect([...c.secret]).toEqual([...secret])
})

test('finds the code inside what was pasted, even wrapped onto several lines', () => {
  const wrapped = `Here's my code:\n${good.slice(0, 40)}\n${good.slice(40)} (valid for 10 minutes)`
  expect(parsePairCode(wrapped).id).toBe('mac-id')
  expect(parsePairCode(`  ${good}  `).id).toBe('mac-id')
  // a sentence on the next line isn't part of it
  expect(parsePairCode(`${good}\nScan or paste this on your phone.`).id).toBe('mac-id')
  expect(parsePairCode(`${good.slice(0, 50)}\n${good.slice(50)}\nThanks`).id).toBe('mac-id')
})

test.each([
  ['nothing', '', 'paste the code'],
  ['spaces', '   \n ', 'paste the code'],
  ['another kind of code', 'clique1.eyJuYW1lIjoiU3R1ZGlvIE1hYyJ9.k3y', "not a CLIque phone code"],
  ['a web address', 'https://example.com', "not a CLIque phone code"],
  ['not base64', 'cliquephone1.!!!!', "not a CLIque phone code"],
  ['not JSON', `cliquephone1.${b64(utf8('hello'))}`, "not a CLIque phone code"],
  ['another version', raw({ v: 2, id: 'x', n: 'Mac', k: b64(key), s: b64(secret), h: ['1.2.3.4'], p: 7788 }), 'different CLIque version'],
  ['a short key', raw({ v: 1, id: 'x', n: 'Mac', k: b64(key.slice(0, 16)), s: b64(secret), h: ['1.2.3.4'], p: 7788 }), "not a CLIque phone code"],
  ['no secret', raw({ v: 1, id: 'x', n: 'Mac', k: b64(key), h: ['1.2.3.4'], p: 7788 }), "not a CLIque phone code"],
  ['no addresses', raw({ v: 1, id: 'x', n: 'Mac', k: b64(key), s: b64(secret), p: 7788 }), "not a CLIque phone code"],
  ['an empty address list', raw({ v: 1, id: 'x', n: 'Mac', k: b64(key), s: b64(secret), h: [], p: 7788 }), "doesn't say where"],
])('refuses %s', (_, code, message) => {
  expect(() => parsePairCode(code)).toThrow(message)
})

test('a missing port means the default one', () => {
  expect(parsePairCode(raw({ v: 1, id: 'x', n: 'Mac', k: b64(key), s: b64(secret), h: ['1.2.3.4'] })).port).toBe(7788)
})

test('addresses become WebSocket URLs, IPv6 in brackets', () => {
  expect(urlFor('192.168.1.20', 7788)).toBe('ws://192.168.1.20:7788')
  expect(urlFor('studio.tail1234.ts.net', 7788)).toBe('ws://studio.tail1234.ts.net:7788')
  expect(urlFor('fd7a:115c:a1e0::1', 7788)).toBe('ws://[fd7a:115c:a1e0::1]:7788')
})

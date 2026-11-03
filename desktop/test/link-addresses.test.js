// A pairing code lists every address of the sharing computer (Wi-Fi, Tailscale IP, Tailscale name). The linking
// computer tries them all at once; only the first to answer may be sent the key, or the sharing computer gets a
// connection per address and loses the link when the slower ones are dropped. Which addresses those are (on a Mac and
// on Windows), and what Windows Firewall has to say about connections getting in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LinkHost, LinkClient, identity, makeCode, addresses, interfaceLabel, tailscaleSelf, reachWarning, firewallWarning } from '../core/link.js'

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
  const client = new LinkClient(code, { name: 'Laptop', handle: async () => null })
  const linked = new Promise((r) => client.once('peer', r))
  client.connect()
  const mine = await linked
  await sleep(300) // the slower addresses' connections have been dropped by now
  try {
    assert.equal(peers.length, 1, 'only the address that answered first was sent the key')
    assert.equal(peers[0].ws.readyState, 1, "the sharing computer's side is still open")
    const heard = new Promise((r) => mine.once('alert', (name, text) => r(text)))
    peers[0].push('alert', 'iris', 'still here')
    assert.equal(await heard, 'still here', 'and what it sends still arrives')
  } finally {
    client.close()
    mine.close()
    host.stop()
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
  }
})

// ---- which addresses, called what -----------------------------------------------------------------------

const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal })
const noTailscale = async () => null

test("a Mac's addresses: Wi-Fi or Ethernet (en0), Tailscale, and its Tailscale name", async () => {
  const interfaces = { lo0: [v4('127.0.0.1', true)], en0: [v4('192.168.1.20'), { address: 'fe80::1', family: 'IPv6', internal: false }], utun4: [v4('100.101.102.103')] }
  const tailscale = async () => ({ TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::1'], DNSName: 'studio.tail1234.ts.net.' })
  assert.deepEqual(await addresses({ interfaces, platform: 'darwin', tailscale }), [
    { address: '192.168.1.20', via: 'Wi-Fi / Ethernet', iface: 'en0' },
    { address: '100.101.102.103', via: 'Tailscale', iface: 'utun4' },
    { address: 'studio.tail1234.ts.net', via: 'Tailscale name' },
  ])
})

test("a Windows PC's: Wi-Fi, Ethernet and Tailscale by name, and none of the networks Windows makes up itself", async () => {
  const interfaces = {
    'Wi-Fi': [v4('192.168.1.31')],
    'Ethernet 2': [v4('10.0.0.31')],
    Tailscale: [v4('100.90.1.2')],
    'vEthernet (WSL (Hyper-V firewall))': [v4('172.24.80.1')],
    'vEthernet (Default Switch)': [v4('172.17.144.1')],
    'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    'VMware Network Adapter VMnet8': [v4('192.168.152.1')],
    'Local Area Connection* 10': [v4('192.168.137.1')],
    'Bluetooth Network Connection': [v4('169.254.3.4')],
    'Npcap Loopback Adapter': [v4('169.254.10.11')],
    Ethernet: [v4('169.254.77.1')], // no network gave it an address
    'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
    WLAN: [{ address: '192.168.2.5', family: 4, internal: false }], // German Windows; family as a number, as some Node versions give it
    'ZeroTier One [8056c2e21c000001]': [v4('10.147.17.5')],
  }
  assert.deepEqual(await addresses({ interfaces, platform: 'win32', tailscale: noTailscale }), [
    { address: '192.168.1.31', via: 'Wi-Fi', iface: 'Wi-Fi' },
    { address: '10.0.0.31', via: 'Ethernet', iface: 'Ethernet 2' },
    { address: '100.90.1.2', via: 'Tailscale', iface: 'Tailscale' },
    { address: '192.168.2.5', via: 'Wi-Fi', iface: 'WLAN' },
    { address: '10.147.17.5', via: 'ZeroTier One [8056c2e21c000001]', iface: 'ZeroTier One [8056c2e21c000001]' },
  ])
  assert.equal(interfaceLabel('en0', '192.168.1.20', 'win32'), 'en0', "macOS's names mean nothing on Windows")
  assert.equal(interfaceLabel('Ethernet', '100.127.255.1', 'win32'), 'Tailscale', 'all of 100.64.0.0/10')
  assert.equal(interfaceLabel('Ethernet', '100.128.0.1', 'win32'), 'Ethernet', 'and only that')
})

test('Tailscale is asked through its CLI, or the one inside the app; off or missing, it adds nothing', async () => {
  const self = await tailscaleSelf() // this computer's: a Self or null, and asking never throws
  assert.ok(self === null || typeof self === 'object')
  const interfaces = { en0: [v4('192.168.1.20')] }
  const broken = async () => {
    throw new Error('not JSON')
  }
  assert.deepEqual(await addresses({ interfaces, platform: 'darwin', tailscale: broken }), [{ address: '192.168.1.20', via: 'Wi-Fi / Ethernet', iface: 'en0' }])
})

// ---- Windows Firewall -------------------------------------------------------------------------------------

const WIFI = { address: '192.168.1.31', via: 'Wi-Fi', iface: 'Wi-Fi' }
const TS = { address: '100.90.1.2', via: 'Tailscale', iface: 'Tailscale' }
const walls = [{ name: 'Domain', on: 'True' }, { name: 'Private', on: 'True' }, { name: 'Public', on: 'NotConfigured' }]
const installer = { action: 'Allow', profile: 'Domain, Private' } // the rule Crew's installer adds

test('Windows Firewall: nothing to say on a private network, or with nothing known about Crew there', () => {
  assert.equal(reachWarning([WIFI, TS], { nets: [{ alias: 'Wi-Fi', category: 'Private' }, { alias: 'Tailscale', category: 'DomainAuthenticated' }], walls, rules: [installer] }), null)
  assert.equal(reachWarning([WIFI], { nets: [{ alias: 'Wi-Fi', category: 'Public' }], walls, rules: [] }), null, 'no rules found: Windows will ask')
  assert.equal(reachWarning([WIFI], { nets: { alias: 'Wi-Fi', category: 'Public' }, walls, rules: [installer, { action: 'Allow', profile: 'Public' }] }), null, 'you let it in on public networks too (and one network comes as an object, not a list)')
  assert.equal(reachWarning([WIFI], { nets: [{ alias: 'Wi-Fi', category: 'Public' }], walls: [{ name: 'Public', on: 'False' }], rules: [installer] }), null, 'the firewall is off there')
  assert.equal(reachWarning([WIFI], {}), null)
  assert.equal(reachWarning([{ address: 'pc.tail1.ts.net', via: 'Tailscale name' }], { nets: [], walls, rules: [{ action: 'Block', profile: 'Any' }] }), null, 'a name is no network')
})

test('Windows Firewall: a public network says how to make it private, a blocked app how to let it in', () => {
  const nets = [{ alias: 'Wi-Fi', category: 'Public' }, { alias: 'Tailscale', category: 'Private' }]
  assert.equal(reachWarning([WIFI, TS], { nets, walls, rules: [installer] }),
    "Windows treats Wi-Fi as a public network, where its firewall keeps your other computers and phones out. If it's your own network, make it private: Settings > Network & internet > Wi-Fi > your network > Network profile type > Private network.")
  assert.equal(reachWarning([TS], { nets, walls, rules: [installer, { action: 'Block', profile: 'Private' }] }),
    "Windows Firewall blocks Crew on Tailscale, so your other computers and phones can't reach this one there. To let them in, open Windows Security > Firewall & network protection > Allow an app through firewall > Change settings, and tick Private next to Crew.")
  assert.match(reachWarning([WIFI, TS], { nets, walls, rules: [installer, { action: 'Block', profile: 'Private' }] }), /blocks Crew on Wi-Fi and Tailscale.*tick Public and Private next to Crew/, 'making Wi-Fi private would not do')
  assert.match(reachWarning([WIFI], { nets: [{ alias: 'Wi-Fi', category: 'Private' }], walls, rules: [{ action: 'Block', profile: 'Any' }] }), /^Windows Firewall blocks Crew on Wi-Fi/)
  // what Windows' own prompt leaves when only Private was ticked: on a public network, making it private is enough
  const prompted = [{ action: 'Allow', profile: 'Private' }, { action: 'Block', profile: 'Public' }]
  assert.match(reachWarning([WIFI], { nets: [{ alias: 'Wi-Fi', category: 'Public' }], walls, rules: prompted }), /^Windows treats Wi-Fi as a public network/)
  assert.match(reachWarning([WIFI], { nets: [{ alias: 'Wi-Fi', category: 'Public' }], walls, rules: [{ action: 'Block', profile: 'Any' }] }), /^Windows Firewall blocks Crew on Wi-Fi.*tick Public next to Crew\.$/, 'a private one would be blocked too')
  assert.equal(reachWarning([WIFI], { nets: [null, { alias: 'Wi-Fi', category: 'Private' }], walls: null, rules: [installer] }), null, 'odd answers are no answer')
})

test("Windows Firewall is only asked on Windows, and what it can't tell says nothing", async () => {
  let asked = 0
  const query = async () => (asked++, { nets: [{ alias: 'Wi-Fi', category: 'Public' }], walls, rules: [installer] })
  assert.equal(await firewallWarning([WIFI], { platform: 'darwin', query }), null)
  assert.equal(asked, 0)
  assert.match(await firewallWarning([WIFI], { platform: 'win32', query }), /public network/)
  const none = async () => {
    throw new Error('no PowerShell')
  }
  assert.equal(await firewallWarning([WIFI], { platform: 'win32', query: none }), null)
})

// The permissions flow's brain: what counts as missing, what's remembered, and what mustn't happen by itself (a macOS
// question popping up with nobody having been told why). Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Permissions, PERMISSIONS, notificationState, appBundle, bundleIdIn } from '../core/permissions.js'
import { probeLocalNetwork } from '../core/discover.js'

const ID = 'com.greengrass.crew'
const prefs = (flags) => `<plist><dict><key>apps</key><array><dict><key>bundle-id</key><string>other.app</string><key>flags</key><integer>0</integer></dict><dict><key>bundle-id</key><string>${ID}</string><key>flags</key><integer>${flags}</integer></dict></array></dict></plist>`
const ALLOWED = 2449481734 // Discord's on this Mac, as the file has it

const denied = () => Object.assign(new Error('nope'), { code: 'EPERM' })
const missing = () => Object.assign(new Error('nope'), { code: 'ENOENT' })

function make({ mic = 'not-determined', xml = '<plist/>', net = 'blocked', disk = denied, answers = {} } = {}) {
  const calls = { asked: [], opened: [], notified: 0, probes: 0, saves: 0 }
  const world = { mic, xml, net }
  const perms = new Permissions({
    systemPreferences: {
      getMediaAccessStatus: () => world.mic,
      askForMediaAccess: async (m) => (calls.asked.push(m), (world.mic = 'granted'), true),
    },
    openUrl: (u) => calls.opened.push(u),
    notify: () => calls.notified++,
    bundleId: ID,
    answers: () => answers,
    save: () => calls.saves++,
    prefs: async () => world.xml,
    network: async () => (calls.probes++, world.net),
    home: '/Users/you',
    files: { readdirSync: () => { throw disk() }, openSync: () => { throw disk() }, closeSync() {} },
  })
  return { perms, calls, world, answers }
}

test('a first launch asks for all four, in order, and nothing has been touched by looking', async () => {
  const { perms, calls } = make()
  assert.deepEqual(await perms.missing(), [
    { id: 'notifications', state: 'ask' },
    { id: 'microphone', state: 'ask' },
    { id: 'localNetwork', state: 'ask' },
    { id: 'fullDisk', state: 'off' },
  ])
  assert.deepEqual(PERMISSIONS, ['notifications', 'microphone', 'localNetwork', 'fullDisk'])
  assert.equal(calls.probes, 0, 'trying the network is what makes macOS ask: never before Allow')
  assert.equal(calls.notified, 0)
  assert.deepEqual(calls.asked, [])
})

test('Local Network: Allow makes macOS ask, and from then on it can be looked at', async () => {
  const { perms, calls, world, answers } = make()
  await perms.ask('localNetwork')
  assert.equal(calls.probes >= 1, true)
  assert.equal(answers.localNetwork, 'asked')
  assert.equal(await perms.look('localNetwork'), 'off', 'the question is up, or you said no: blocked either way')
  world.net = 'granted'
  assert.equal(await perms.look('localNetwork'), 'granted')
  assert.equal(answers.localNetwork, 'granted')
})

test('no network to tell by: Local Network is left alone rather than reported as blocked', async () => {
  const { perms } = make({ net: 'unknown', answers: { localNetwork: 'asked' } })
  assert.equal(await perms.look('localNetwork'), 'unknown')
  assert.ok(!(await perms.missing()).some((m) => m.id === 'localNetwork'))
})

test('not now is remembered across launches, and the ⋯ menu still offers it', async () => {
  const answers = {}
  const first = make({ answers })
  first.perms.skip('microphone')
  assert.equal(first.calls.saves, 1)
  const next = make({ answers })
  assert.ok(!(await next.perms.missing()).some((m) => m.id === 'microphone'))
  assert.ok((await next.perms.missing({ all: true })).some((m) => m.id === 'microphone'))
})

test('not now on Local Network never leads to a probe, even from the ⋯ menu', async () => {
  const { perms, calls } = make({ answers: { localNetwork: 'skipped' } })
  await perms.missing({ all: true })
  assert.equal(calls.probes, 0)
})

test('one you allowed and later turned off counts as missing again, though you never said not now', async () => {
  const answers = {}
  const { perms, world } = make({ mic: 'granted', answers })
  assert.ok(!(await perms.missing()).some((m) => m.id === 'microphone'))
  assert.equal(answers.microphone, 'granted')
  world.mic = 'denied'
  assert.deepEqual((await perms.missing()).find((m) => m.id === 'microphone'), { id: 'microphone', state: 'off' })
})

test('allowed already: nothing to ask, nothing written twice', async () => {
  const { perms, calls } = make({ mic: 'granted', xml: prefs(ALLOWED), net: 'granted', answers: { localNetwork: 'granted' }, disk: () => null })
  const noThrow = new Permissions({ ...perms, files: { readdirSync: () => [], openSync: () => 1, closeSync() {} } })
  assert.deepEqual(await noThrow.missing(), [])
  const saves = calls.saves
  await noThrow.missing()
  assert.equal(calls.saves, saves)
})

test('the microphone is asked in macOS\'s own dialog; once denied it\'s a switch in Settings', async () => {
  const { perms, calls } = make()
  assert.equal(await perms.ask('microphone'), 'granted')
  assert.deepEqual(calls.asked, ['microphone'])
  const no = make({ mic: 'denied' })
  assert.equal(await no.perms.look('microphone'), 'off')
  no.perms.open('microphone')
  assert.match(no.calls.opened[0], /Privacy_Microphone$/)
})

test('a microphone a profile restricts is left alone: no switch of yours would change it', async () => {
  const { perms } = make({ mic: 'restricted' })
  assert.equal(await perms.look('microphone'), 'unknown')
})

test('notifications: never asked until listed, then whether it\'s allowed; asked and still not listed points at Settings', async () => {
  assert.equal(notificationState(prefs(ALLOWED), ID), 'granted')
  assert.equal(notificationState(prefs((ALLOWED & ~(1 << 25)) >>> 0), ID), 'off')
  assert.equal(notificationState(prefs(ALLOWED | 0), ID), 'granted', 'written as a negative number, the same bits')
  assert.equal(notificationState('<plist><dict></dict></plist>', ID), 'ask')
  assert.equal(notificationState(null, ID), 'unknown')
  assert.equal(notificationState(`<dict><string>${ID}</string></dict>`, ID), 'unknown', 'listed, with no flags to read')
  const { perms, calls, answers } = make()
  assert.equal(await perms.look('notifications'), 'ask')
  assert.equal(await perms.ask('notifications'), 'off')
  assert.equal(calls.notified, 1, 'showing one is how macOS comes to ask')
  assert.equal(answers.notifications, 'asked')
})

test('another app\'s entry never answers for this one', () => {
  assert.equal(notificationState(prefs(ALLOWED).replace(ID, 'com.greengrass.crew.dev'), ID), 'ask')
})

test('Full Disk Access: a folder only it opens tells; on a Mac without those folders it\'s left alone', async () => {
  assert.equal(await make().perms.look('fullDisk'), 'off')
  assert.equal(await make({ disk: missing }).perms.look('fullDisk'), 'unknown')
})

test('answers survive config.json being read back after each save (a new object every time)', async () => {
  const config = { data: {} }
  const { perms } = make()
  perms.answers = () => (config.data.permissions ??= {})
  perms.save = () => (config.data = JSON.parse(JSON.stringify(config.data))) // what Config.save does: load() replaces data
  perms.skip('microphone')
  perms.skip('fullDisk')
  await perms.ask('localNetwork')
  assert.deepEqual(config.data.permissions, { microphone: 'skipped', fullDisk: 'skipped', localNetwork: 'asked' })
})

test('every permission opens its own place in System Settings', () => {
  const { perms, calls } = make()
  for (const id of PERMISSIONS) perms.open(id)
  assert.deepEqual(calls.opened, [
    `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${ID}`,
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  ])
})

test('what goes in the list is the .app folder itself, and the id comes from its Info.plist', () => {
  assert.equal(appBundle('/Applications/CLIque.app/Contents/MacOS/CLIque'), '/Applications/CLIque.app')
  assert.equal(appBundle('/a b/dist/CLIque.app/Contents/MacOS/CLIque'), '/a b/dist/CLIque.app')
  assert.equal(appBundle('/usr/local/bin/electron'), null)
  assert.equal(bundleIdIn('<key>CFBundleIdentifier</key>\n\t<string>com.greengrass.crew.dev</string>', ID), 'com.greengrass.crew.dev')
  assert.equal(bundleIdIn(null, ID), ID)
})

// A fake socket: which addresses refuse, and whether it was closed.
function socketFor(refuse = {}) {
  const s = new EventEmitter()
  Object.assign(s, {
    closed: 0,
    bind: (_port, cb) => queueMicrotask(cb),
    setBroadcast() {},
    send: (_msg, _port, address, cb) => queueMicrotask(() => cb(refuse[address] ? Object.assign(new Error('x'), { code: refuse[address] }) : null)),
    close() { s.closed++ },
  })
  return s
}
const WIFI = [{ address: '192.168.0.255', port: 7789 }, { address: '255.255.255.255', port: 7789 }]

test('the probe: the limited broadcast refused at once means macOS is keeping this app off the network', async () => {
  const blocked = socketFor({ '255.255.255.255': 'EHOSTUNREACH' })
  assert.equal(await probeLocalNetwork({ targets: () => WIFI, createSocket: () => blocked }), 'blocked')
  assert.equal(blocked.closed, 1)
  assert.equal(await probeLocalNetwork({ targets: () => WIFI, createSocket: () => socketFor() }), 'granted')
})

test('the probe: no network of its own says nothing, whatever the limited broadcast does', async () => {
  const none = [{ address: '255.255.255.255', port: 7789 }]
  assert.equal(await probeLocalNetwork({ targets: () => none, createSocket: () => socketFor({ '255.255.255.255': 'EHOSTUNREACH' }) }), 'unknown')
})

test('the probe never leaves a socket open or throws, even on a socket that errors', async () => {
  const s = socketFor()
  s.bind = () => queueMicrotask(() => s.emit('error', new Error('no')))
  assert.equal(await probeLocalNetwork({ targets: () => WIFI, createSocket: () => s }), 'unknown')
  assert.equal(s.closed, 1)
})

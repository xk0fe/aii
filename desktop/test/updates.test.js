// CLIque updating itself (core/updates.js) and opening at login (core/login.js): when it looks, what it does with what
// it finds, how it backs off, what "Later" does, and the words it uses, with a fake updater, a fake clock and timers
// run by hand; then electron-updater's side of it with a stand-in for electron-updater. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Updates, restartWords, keepsAgents, checkWords, menuItem, offReason, macSignature, feedFrom, feedUrl, feedConfig, newer, electronUpdater, INTERVAL, RETRY, START_DELAY } from '../core/updates.js'
import { loginItem, LOGIN_ARG } from '../core/login.js'
import { PROTOCOL } from '../core/ptyhost.js'
import { hostProtocol, stamp, stampAll } from '../scripts/update-info.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const MIN = 60e3
const HOUR = 60 * MIN
const tick = () => new Promise((r) => setImmediate(r))

// A clock and timers moved by hand: go(ms) runs what comes due, in order, letting each finish.
function clock() {
  let now = 1_700_000_000_000
  let id = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimer: (fn, ms) => (timers.set(++id, { fn, at: now + ms }), id),
    clearTimer: (t) => timers.delete(t),
    pending: () => [...timers.values()].map((t) => t.at - now).sort((a, b) => a - b),
    sleep: (ms) => (now += ms), // the computer asleep: time passes, timers don't fire
    async go(ms) {
      const end = now + ms
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        timers.delete(next[0])
        now = next[1].at
        next[1].fn()
        await tick()
        await tick()
      }
      now = end
    },
  }
}

// An updater that does what it's told: feed.newest is what's out there (null: nothing newer), feed.down true makes
// looking fail, feed.broken makes the download fail. hold() keeps the download open until release().
function fake(feed = {}) {
  const calls = []
  let release = null
  return {
    feed, calls,
    hold: () => new Promise((r) => (release = r)),
    release: () => release?.(),
    updater: {
      check: async () => {
        calls.push('check')
        if (feed.down) throw new Error('the feed is down')
        return feed.newest ? { ...feed.newest } : null
      },
      download: async (found, progress) => {
        calls.push(`download ${found.version}`)
        progress(40.2)
        progress(40.9)
        if (feed.hold) await feed.hold
        if (feed.broken) throw new Error('the download broke')
        progress(100)
      },
      install: async () => {
        calls.push('install')
        if (feed.wontQuit) throw new Error('still running')
      },
    },
  }
}

function machine(feed, extra = {}) {
  const c = clock()
  const f = fake(feed)
  const phases = []
  const saved = []
  const u = new Updates({ updater: f.updater, version: '1.0.0', now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, onChange: (v) => phases.at(-1) !== v.phase && phases.push(v.phase), saveSeen: (v) => saved.push(v), ...extra })
  return { u, c, f, phases, saved }
}

test('it looks a little after starting, then every six hours; nothing newer leaves it idle and silent', async () => {
  const { u, c, f, phases } = machine({ newest: null })
  u.start()
  assert.deepEqual(f.calls, [], 'not at once: starting up comes first')
  assert.deepEqual(c.pending(), [START_DELAY])
  await c.go(START_DELAY)
  assert.deepEqual(f.calls, ['check'])
  assert.deepEqual(phases, ['checking', 'idle'])
  assert.deepEqual(c.pending(), [INTERVAL], 'the next look is in six hours')
  await c.go(INTERVAL)
  assert.deepEqual(f.calls, ['check', 'check'])
  assert.equal(u.view().next, null)
})

test('a newer version is downloaded in the background and is then ready: idle → checking → downloading → ready', async () => {
  const { u, c, f, phases } = machine({ newest: { version: '1.0.1', notesUrl: 'https://example.com/v1.0.1', hostProtocol: 1 } })
  u.start()
  await c.go(START_DELAY)
  assert.deepEqual(f.calls, ['check', 'download 1.0.1'])
  assert.deepEqual(phases, ['checking', 'downloading', 'ready'])
  assert.deepEqual(u.view(), { phase: 'ready', version: '1.0.0', off: null, next: { version: '1.0.1', notesUrl: 'https://example.com/v1.0.1' }, progress: 100, later: false, asking: null, stuck: false })
  // it keeps looking, and the same version again changes nothing
  await c.go(INTERVAL)
  assert.deepEqual(f.calls, ['check', 'download 1.0.1', 'check'])
  assert.deepEqual(phases, ['checking', 'downloading', 'ready'], 'ready the whole time: the note never blinks')
})

test('"Later" puts the note away for that version, for good; a newer one speaks up again', async () => {
  const { u, c, f, saved } = machine({ newest: { version: '1.0.1' } })
  u.start()
  await c.go(START_DELAY)
  u.putOff()
  assert.equal(u.view().later, true)
  assert.equal(u.view().phase, 'ready', 'still ready: the menus keep Restart to update')
  assert.deepEqual(saved, ['1.0.1'], 'remembered across launches')
  // the next launch finds the same version: ready, no note
  const again = machine({ newest: { version: '1.0.1' } }, { seen: '1.0.1' })
  again.u.start()
  await again.c.go(START_DELAY)
  assert.deepEqual([again.u.view().phase, again.u.view().later], ['ready', true])
  // 1.0.2 comes out: downloaded in place of 1.0.1, and its note shows
  f.feed.newest = { version: '1.0.2' }
  await c.go(INTERVAL)
  assert.deepEqual(f.calls.slice(-2), ['check', 'download 1.0.2'])
  assert.deepEqual([u.view().phase, u.view().next.version, u.view().later], ['ready', '1.0.2', false])
})

test('a look that fails is tried again in 15 minutes, then 30, an hour… never more than six hours apart, and a good one resets it', async () => {
  const { u, c, f, phases } = machine({ down: true })
  u.start()
  await c.go(START_DELAY)
  assert.deepEqual(phases, ['checking', 'idle'], 'no phase for a failure: nothing shows')
  const waits = []
  for (let i = 0; i < 7; i++) {
    waits.push(c.pending()[0] / MIN)
    await c.go(c.pending()[0])
  }
  assert.deepEqual(waits, [15, 30, 60, 120, 240, 360, 360])
  assert.equal(RETRY, 15 * MIN)
  f.feed.down = false
  await c.go(c.pending()[0])
  assert.deepEqual(c.pending(), [INTERVAL], 'back to every six hours')
  f.feed.down = true
  await c.go(INTERVAL)
  assert.deepEqual(c.pending(), [15 * MIN], 'and the next failure starts at 15 minutes again')
})

test('a download that fails counts as a failure too: nothing is ready, and it is tried again', async () => {
  const { u, c, f, phases } = machine({ newest: { version: '1.0.1' }, broken: true })
  u.start()
  await c.go(START_DELAY)
  assert.deepEqual(phases, ['checking', 'downloading', 'idle'])
  assert.equal(u.view().next, null)
  assert.deepEqual(c.pending(), [15 * MIN])
  f.feed.broken = false
  await c.go(15 * MIN)
  assert.equal(u.view().phase, 'ready')
})

test('waking from sleep: a look that was due happens at once, one that was not is set for when it is', async () => {
  const { u, c, f } = machine({ newest: null })
  u.start()
  await c.go(START_DELAY)
  // asleep for two hours: four are left
  c.sleep(2 * HOUR)
  u.wake()
  await tick()
  assert.deepEqual(f.calls, ['check'], 'not due yet')
  assert.deepEqual(c.pending(), [4 * HOUR])
  // asleep past the time
  c.sleep(5 * HOUR)
  u.wake()
  await tick()
  await tick()
  assert.deepEqual(f.calls, ['check', 'check'], 'due while it slept: looked on waking')
  assert.deepEqual(c.pending(), [INTERVAL])
})

test('Check for Updates… answers as soon as it knows, without waiting for the download, and joins a look already under way', async () => {
  const { u, c, f } = machine({ newest: null })
  assert.deepEqual(await u.check({ manual: true }), { result: 'current' })
  assert.deepEqual(c.pending(), [INTERVAL], 'a look by hand counts: the next one is six hours from it')
  f.feed.newest = { version: '1.0.1' }
  f.feed.hold = f.hold()
  const asked = await u.check({ manual: true })
  assert.deepEqual(asked, { result: 'downloading', version: '1.0.1' })
  assert.equal(u.view().phase, 'downloading')
  assert.equal(u.view().progress, 40, 'in tenths, so the app is not redrawn for every chunk')
  assert.deepEqual(await u.check({ manual: true }), { result: 'downloading', version: '1.0.1' }, 'asked again meanwhile: the same answer, no second download')
  const quiet = u.check()
  f.release()
  assert.deepEqual(await quiet, { result: 'ready', version: '1.0.1' })
  assert.deepEqual(f.calls, ['check', 'check', 'download 1.0.1'])
  assert.deepEqual(await u.check({ manual: true }), { result: 'ready', version: '1.0.1' })
  // and when it can't look
  f.feed.down = true
  f.feed.newest = null
  assert.deepEqual(await u.check({ manual: true }), { result: 'failed' })
  assert.equal(u.view().phase, 'ready', 'what was ready stays ready through a failed look')
})

test('a copy that cannot update itself never looks, and says why when asked', async () => {
  const { u, c, f } = machine({ newest: { version: '9.9.9' } }, { off: 'location' })
  u.start()
  assert.deepEqual(c.pending(), [])
  u.wake()
  assert.deepEqual(await u.check({ manual: true }), { result: 'off', reason: 'location' })
  assert.deepEqual(f.calls, [])
  assert.equal(u.view().phase, 'off')
})

test('Restart to update installs; a restart that does not happen leaves it ready, says so, and can be tried again', async () => {
  const { u, c, f, phases } = machine({ newest: { version: '1.0.1' } })
  assert.equal(await u.restart(), false, 'nothing ready, nothing to restart into')
  u.start()
  await c.go(START_DELAY)
  u.ask({ text: 'Ada keeps working while CLIque restarts.', go: 'Restart', wait: 'Not now', safe: 'go' })
  assert.equal(u.view().asking.safe, 'go')
  f.feed.wontQuit = true
  assert.equal(await u.restart(), false)
  assert.deepEqual(phases.slice(-2), ['restarting', 'ready'])
  assert.deepEqual([u.view().stuck, u.view().asking, u.view().later], [true, null, false])
  f.feed.wontQuit = false
  assert.equal(await u.restart(), true)
  assert.deepEqual(f.calls.slice(-2), ['install', 'install'])
  assert.equal(u.view().phase, 'restarting')
  assert.deepEqual(await u.check({ manual: true }), { result: 'restarting', version: '1.0.1' })
})

// ---- the words ------------------------------------------------------------------------------------------------------

test('before restarting while agents work, it says what really happens to them, and the safe button is the default', () => {
  const words = (o) => restartWords({ protocol: 1, product: 'CLIque', outlives: true, ...o })
  assert.equal(words({ busy: [], hostProtocol: 1 }), null, 'nobody at work: nothing to ask')
  assert.deepEqual(words({ busy: ['ada', 'bo'], hostProtocol: 1 }), { text: 'ada and bo keep working while CLIque restarts.', go: 'Restart', wait: 'Not now', safe: 'go' })
  assert.equal(words({ busy: ['ada'], hostProtocol: 1 }).text, 'ada keeps working while CLIque restarts.')
  assert.equal(words({ busy: ['ada', 'bo', 'cy'], hostProtocol: 1 }).text, 'ada, bo and cy keep working while CLIque restarts.')
  assert.equal(words({ busy: ['ada', 'bo', 'cy', 'di', 'ed'], hostProtocol: 1 }).text, 'ada, bo and 3 others keep working while CLIque restarts.')
  // the update brings another terminal host: the running one has to go, and the terminals with it
  assert.deepEqual(words({ busy: ['ada', 'bo'], hostProtocol: 2 }), {
    text: 'ada and bo will be stopped: this update replaces the part of CLIque that runs their terminals. They pick up the conversation after the restart, but what they were doing right now is lost.',
    go: 'Restart anyway', wait: 'Not now', safe: 'wait',
  })
  // the feed didn't say: no promise
  assert.deepEqual(words({ busy: ['ada'], hostProtocol: null }), {
    text: "CLIque can't tell whether ada can keep working through this update, so it may be stopped. It picks up the conversation after the restart, but what it was doing right now is lost.",
    go: 'Restart anyway', wait: 'Not now', safe: 'wait',
  })
  // no terminal host this time (it couldn't start): the agents run inside CLIque and stop with it
  assert.deepEqual(words({ busy: ['ada'], hostProtocol: 1, outlives: false }), {
    text: 'ada will be stopped: this time CLIque runs its terminal itself. It picks up the conversation after the restart, but what it was doing right now is lost.',
    go: 'Restart anyway', wait: 'Not now', safe: 'wait',
  })
  // Windows, the host running from CLIque's own folder (its copy elsewhere wouldn't start): the installer stops it
  assert.deepEqual(words({ busy: ['ada', 'bo'], hostProtocol: 1, hostInApp: true }), {
    text: 'ada and bo will be stopped: installing the update stops what runs their terminals. They pick up the conversation after the restart, but what they were doing right now is lost.',
    go: 'Restart anyway', wait: 'Not now', safe: 'wait',
  })
  assert.equal(words({ busy: ['ada'], hostProtocol: 1, hostInApp: null }).safe, 'wait', "a host that doesn't say where it runs from: no promise")
  // the same answer decides whether quitting the ordinary way may install the update too
  assert.equal(keepsAgents({ hostProtocol: 1, protocol: 1 }), true)
  assert.equal(keepsAgents({ hostProtocol: 2, protocol: 1 }), false)
  assert.equal(keepsAgents({ hostProtocol: 1, protocol: 1, outlives: false }), false)
  assert.equal(keepsAgents({ hostProtocol: 1, protocol: 1, hostInApp: true }), false)
  assert.equal(keepsAgents({ hostProtocol: null, protocol: 1 }), null)
  assert.equal(keepsAgents({ hostProtocol: 1, protocol: 1, hostInApp: null }), null)
})

test("the build's update files say which terminal host the version has, the one core/ptyhost.js speaks", () => {
  assert.equal(hostProtocol(), PROTOCOL)
  const yml = "version: 1.0.1\nfiles:\n  - url: CLIque-1.0.1-mac-arm64.zip\n    sha512: abc==\n    size: 1\npath: CLIque-1.0.1-mac-arm64.zip\nsha512: abc==\nreleaseDate: '2026-11-16T00:00:00.000Z'\n"
  assert.equal(stamp(yml, 1), `${yml}hostProtocol: 1\n`)
  assert.equal(stamp(stamp(yml, 1), 2), `${yml}hostProtocol: 2\n`, 'once, whatever it said before')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-release-'))
  for (const f of ['latest-mac.yml', 'latest.yml', 'builder-debug.yml', 'CLIque-1.0.1-mac-arm64.zip']) fs.writeFileSync(path.join(dir, f), yml)
  assert.deepEqual(stampAll(dir).sort(), ['latest-mac.yml', 'latest.yml'])
  assert.match(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'), new RegExp(`\\nhostProtocol: ${PROTOCOL}\\n$`))
  assert.equal(fs.readFileSync(path.join(dir, 'builder-debug.yml'), 'utf8'), yml, 'only the update files')
  assert.deepEqual(stampAll(path.join(dir, 'nowhere')), [], 'a build with nowhere to publish to writes none')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the packaging: no update address unless the build is given one, and electron-builder takes the configuration either way', async () => {
  const { validateConfiguration } = createRequire(import.meta.url)('app-builder-lib/out/util/config/config.js')
  const keep = { RELEASE_REPO: process.env.RELEASE_REPO, UPDATE_FEED: process.env.UPDATE_FEED }
  const load = async (env, tag) => {
    for (const k of Object.keys(keep)) delete process.env[k]
    Object.assign(process.env, env)
    return (await import(`../electron-builder.config.mjs?${tag}`)).default
  }
  try {
    const plain = await load({}, 'plain')
    assert.equal(plain.publish, null, 'no RELEASE_REPO or UPDATE_FEED: no update address in the app')
    assert.equal(plain.nsis.guid, '381ff71e-b172-5fde-9cfb-4c27e5eec7f2', "the Windows installer's identity: an update replaces the install instead of adding one")
    assert.ok(plain.mac.target.includes('zip'), 'a Mac updates from the zip')
    const github = await load({ RELEASE_REPO: 'greengrass/clique' }, 'repo')
    assert.deepEqual(github.publish, [{ provider: 'github', owner: 'greengrass', repo: 'clique', releaseType: 'draft' }])
    const feed = await load({ RELEASE_REPO: 'greengrass/clique', UPDATE_FEED: 'https://example.com/updates/' }, 'feed')
    assert.deepEqual(feed.publish, [{ provider: 'generic', url: 'https://example.com/updates/' }])
    // electron-builder stops a build whose configuration has a field it doesn't know
    for (const config of [plain, github, feed]) await validateConfiguration(config, { add() {} })
  } finally {
    for (const [k, v] of Object.entries(keep)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
})

test('Check for Updates… says plainly what it found', () => {
  const say = (out) => checkWords(out, { product: 'CLIque', version: '1.0.0' })
  assert.deepEqual(say({ result: 'current' }), { message: "You're up to date", detail: 'CLIque 1.0.0 is the newest version.' })
  assert.deepEqual(say({ result: 'failed' }), { message: "Couldn't check", detail: 'You can keep using CLIque and try again later.' })
  assert.deepEqual(say({ result: 'downloading', version: '1.0.1' }), { message: 'CLIque 1.0.1 is downloading', detail: "CLIque tells you when it's ready. You can keep working." })
  assert.deepEqual(say({ result: 'ready', version: '1.0.1' }), { message: 'CLIque 1.0.1 is ready', detail: 'Restart CLIque to use it.', buttons: ['Restart to Update', 'Later'] })
  assert.equal(say({ result: 'off', reason: 'location' }).message, 'Move CLIque to Applications to get updates')
  assert.match(say({ result: 'off', reason: 'unsigned' }).detail, /isn't signed by its maker, and macOS only lets a signed app replace itself/)
  assert.match(say({ result: 'off', reason: 'feed' }).detail, /wasn't told where updates come from/)
  assert.equal(say({ result: 'off', reason: 'dev' }).message, 'This CLIque runs from source')
  for (const reason of ['dev', 'feed', 'location', 'unsigned', 'platform', 'something new']) assert.ok(say({ result: 'off', reason }).detail, reason)
})

test("the Mac's app menu: Check for Updates…, and Restart to Update once one is ready", () => {
  for (const phase of [undefined, 'off', 'idle', 'checking', 'downloading', 'restarting']) assert.deepEqual(menuItem(phase), { label: 'Check for Updates…', act: 'check' }, String(phase))
  assert.deepEqual(menuItem('ready'), { label: 'Restart to Update', act: 'restart' })
  assert.deepEqual(checkWords({ result: 'restarting', version: '1.0.1' }, { product: 'CLIque' }), { message: 'CLIque is restarting', detail: 'CLIque 1.0.1 opens in a moment.' }, 'asked while it restarts')
})

test('can this copy update itself: an installed, signed app with somewhere to look, on a Mac in Applications', () => {
  const mac = { packaged: true, platform: 'darwin', feed: { baked: true }, exe: '/Applications/CLIque.app/Contents/MacOS/CLIque', inApplications: true, signature: 'developer-id' }
  assert.equal(offReason(mac), null)
  assert.equal(offReason({ ...mac, packaged: false }), 'dev')
  assert.equal(offReason({ ...mac, feed: null }), 'feed')
  assert.equal(offReason({ ...mac, inApplications: false, exe: '/Users/you/Downloads/CLIque.app/Contents/MacOS/CLIque' }), 'location')
  assert.equal(offReason({ ...mac, exe: '/Volumes/CLIque 1.0.0/CLIque.app/Contents/MacOS/CLIque' }), 'location', 'opened on the disk image')
  assert.equal(offReason({ ...mac, exe: '/private/var/folders/ab/T/AppTranslocation/1F2E/d/CLIque.app/Contents/MacOS/CLIque' }), 'location', 'run from Downloads: macOS runs a read-only copy')
  assert.equal(offReason({ ...mac, signature: 'adhoc' }), 'unsigned')
  assert.equal(offReason({ ...mac, signature: 'none' }), 'unsigned')
  assert.equal(offReason({ ...mac, signature: 'signed' }), null)
  const win = { packaged: true, platform: 'win32', feed: { url: 'https://example.com/' }, exe: 'C:\\Users\\you\\AppData\\Local\\Programs\\clique\\CLIque.exe' }
  assert.equal(offReason(win), null, 'Windows: the installer needs neither')
  assert.equal(offReason({ ...win, platform: 'linux' }), 'platform')
})

test("how the Mac app is signed, from codesign's own words", () => {
  assert.equal(macSignature('Executable=/Applications/CLIque.app/Contents/MacOS/CLIque\nIdentifier=com.greengrass.clique\nAuthority=Developer ID Application: Green Grass Inc. (ABCDE12345)\nAuthority=Developer ID Certification Authority\nTeamIdentifier=ABCDE12345\n'), 'developer-id')
  assert.equal(macSignature('Identifier=com.greengrass.clique\nCodeDirectory v=20500 size=754 flags=0x10002(adhoc,runtime) hashes=13+7 location=embedded\nSignature=adhoc\nTeamIdentifier=not set\n'), 'adhoc')
  assert.equal(macSignature('Authority=Apple Development: you@example.com (XYZ)\nTeamIdentifier=ABCDE12345\n'), 'signed')
  assert.equal(macSignature('/Applications/CLIque.app: code object is not signed at all\n'), 'none')
  assert.equal(macSignature(''), 'none')
})

test('where updates come from: an address set by hand, else what the build was given, else nowhere', () => {
  const baked = 'owner: greengrass\nrepo: clique\nprovider: github\nreleaseType: draft\nupdaterCacheDirName: clique-updater\n'
  assert.equal(feedFrom({}), null, 'nothing set: it never looks')
  assert.deepEqual(feedFrom({ baked }), { baked: true, repo: 'greengrass/clique' })
  assert.deepEqual(feedFrom({ baked: 'provider: generic\nurl: https://example.com/updates/\n' }), { baked: true })
  assert.deepEqual(feedFrom({ baked, config: { updateFeed: 'https://example.com/updates' } }), { url: 'https://example.com/updates/' })
  assert.deepEqual(feedFrom({ baked, env: { CLIQUE_UPDATE_FEED: 'http://127.0.0.1:8123/feed/' }, config: { updateFeed: 'https://example.com/updates' } }), { url: 'http://127.0.0.1:8123/feed/' })
  assert.deepEqual(feedFrom({ config: { updateFeed: 'http://example.com/updates' } }), null, 'plain http only from this computer')
  for (const bad of ['', '  ', 'ftp://example.com/', 'https://user:pw@example.com/', 'not an address', 42, null]) assert.equal(feedUrl(bad), null, String(bad))
})

test("an address set by hand keeps what else the build said: the Windows publisher an update must be signed by", () => {
  const baked = 'owner: greengrass\nrepo: clique\nprovider: github\nreleaseType: draft\npublisherName:\n  - Greengrass\nupdaterCacheDirName: clique-updater\n'
  assert.equal(feedConfig('https://example.com/u/', baked), 'provider: generic\nurl: "https://example.com/u/"\npublisherName:\n  - Greengrass\nupdaterCacheDirName: clique-updater\n')
  assert.equal(feedConfig('http://127.0.0.1:8123/'), 'provider: generic\nurl: "http://127.0.0.1:8123/"\nupdaterCacheDirName: clique-updater\n')
})

test('newer: by numbers, and a version with a tail is older than the same one without', () => {
  for (const [a, b] of [['1.0.1', '1.0.0'], ['1.10.0', '1.9.9'], ['2.0.0', '1.99.99'], ['1.0.0', '1.0.0-beta.2'], ['v1.0.1', '1.0.0']]) assert.ok(newer(a, b), `${a} > ${b}`)
  for (const [a, b] of [['1.0.0', '1.0.0'], ['1.0.0', '1.0.1'], ['1.0.0-beta.1', '1.0.0'], ['0.9.9', '1.0.0']]) assert.ok(!newer(a, b), `${a} <= ${b}`)
})

// ---- electron-updater's side ----------------------------------------------------------------------------------------

// electron-updater's autoUpdater, as much of it as CLIque uses.
function standIn({ info = null, available = true, failDownload = false, quits = false } = {}) {
  const au = new EventEmitter()
  Object.assign(au, {
    calls: [],
    setFeedURL: (o) => au.calls.push(['feed', o]),
    checkForUpdates: async () => (au.calls.push(['check']), info && { isUpdateAvailable: available, updateInfo: info }),
    downloadUpdate: async () => {
      au.calls.push(['download'])
      au.emit('download-progress', { percent: 50 })
      if (failDownload) throw new Error('sha512 checksum mismatch')
      au.emit('update-downloaded', {})
      return new Promise(() => {}) // on a Mac it settles only once macOS's installer has the files too
    },
    quitAndInstall: (...args) => (au.calls.push(['quitAndInstall', ...args]), quits),
  })
  return au
}

test("electron-updater: nothing downloads until CLIque says so, a set address is used, and what's found comes back plain", async () => {
  const au = standIn({ info: { version: '1.0.1', hostProtocol: 1, files: [], releaseNotes: '<p>Fixes</p>' } })
  const up = electronUpdater(au, { feed: { url: 'https://example.com/updates/' }, version: '1.0.0' })
  assert.equal(au.autoDownload, false)
  assert.equal(au.autoInstallOnAppQuit, false, 'nothing installs as CLIque quits until a download says it may')
  assert.equal(au.allowDowngrade, false)
  assert.deepEqual(au.calls, [['feed', { provider: 'generic', url: 'https://example.com/updates/' }]])
  assert.deepEqual(await up.check(), { version: '1.0.1', notesUrl: null, hostProtocol: 1 })
  const seen = []
  await up.download({ version: '1.0.1' }, (pct) => seen.push(pct))
  assert.deepEqual(seen, [50])
  assert.equal(au.autoInstallOnAppQuit, true, 'by default quitting the ordinary way installs what was downloaded')
  assert.deepEqual([au.listenerCount('download-progress'), au.listenerCount('update-downloaded')], [0, 0], 'it stops listening once the download is over')
  up.install().catch(() => {})
  assert.deepEqual(au.calls.at(-1), ['quitAndInstall', true, true], 'silently, and open CLIque again after')
})

test('electron-updater: the release notes link is the release on GitHub, or the address the feed gives; nothing newer is nothing', async () => {
  const github = electronUpdater(standIn({ info: { version: '1.2.0' } }), { feed: { baked: true, repo: 'greengrass/clique' }, version: '1.0.0' })
  assert.deepEqual(await github.check(), { version: '1.2.0', notesUrl: 'https://github.com/greengrass/clique/releases/tag/v1.2.0', hostProtocol: null })
  const own = electronUpdater(standIn({ info: { version: '1.2.0', releaseNotesUrl: 'https://example.com/whats-new', hostProtocol: '2' } }), { feed: { baked: true, repo: 'greengrass/clique' }, version: '1.0.0' })
  assert.deepEqual(await own.check(), { version: '1.2.0', notesUrl: 'https://example.com/whats-new', hostProtocol: 2 })
  const odd = electronUpdater(standIn({ info: { version: '1.2.0', releaseNotesUrl: 'javascript:alert(1)' } }), { feed: { baked: true }, version: '1.0.0' })
  assert.equal((await odd.check()).notesUrl, null, 'only an https address is ever opened')
  assert.equal(await electronUpdater(standIn({ info: { version: '1.0.0' }, available: false }), { version: '1.0.0' }).check(), null)
  assert.equal(await electronUpdater(standIn({ info: null }), { version: '1.0.0' }).check(), null)
  const old = standIn({ info: { version: '0.9.0' } })
  old.checkForUpdates = async () => ({ updateInfo: { version: '0.9.0' } }) // an electron-updater that doesn't say isUpdateAvailable
  assert.equal(await electronUpdater(old, { version: '1.0.0' }).check(), null)
})

test('electron-updater: a failed download, a look that hangs and a restart that never comes all end as errors, quietly', async () => {
  const bad = electronUpdater(standIn({ info: { version: '1.0.1' }, failDownload: true }), { version: '1.0.0' })
  await assert.rejects(bad.download({ version: '1.0.1' }), /checksum mismatch/)
  const hung = standIn()
  hung.checkForUpdates = () => new Promise(() => {})
  await assert.rejects(electronUpdater(hung, { version: '1.0.0', checkTimeout: 20 }).check(), /looking for an update took too long/)
  await assert.rejects(electronUpdater(standIn(), { version: '1.0.0', quitTimeout: 20 }).install(), /still running/)
  // an error event with nobody else listening must not take CLIque down
  const au = standIn()
  electronUpdater(au, { version: '1.0.0' })
  assert.doesNotThrow(() => au.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED')))
})

test("electron-updater on a Mac: macOS's installer refusing what was downloaded takes ready back, quietly, and it's tried again later", async () => {
  const au = standIn({ info: { version: '1.0.1' } })
  let refuse
  au.downloadUpdate = () => {
    au.emit('update-downloaded', {})
    return new Promise((_r, reject) => (refuse = reject))
  }
  const c = clock()
  const u = new Updates({ updater: electronUpdater(au, { feed: { url: 'https://example.com/u/' }, configPath: '/tmp/update-feed.yml', version: '1.0.0' }), version: '1.0.0', now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer })
  assert.equal(au.updateConfigPath, '/tmp/update-feed.yml')
  assert.deepEqual(await u.check(), { result: 'ready', version: '1.0.1' })
  refuse(new Error('Code signature at URL did not pass validation'))
  await tick()
  assert.deepEqual([u.view().phase, u.view().next], ['idle', null])
  assert.deepEqual(c.pending(), [RETRY], 'tried again in 15 minutes, as after any failure')
})

test("…and so does its refusal arriving as an error event, which is how Squirrel.Mac says it couldn't unpack or check the app", async () => {
  const au = standIn({ info: { version: '1.0.1' } })
  au.downloadUpdate = async () => (au.emit('update-downloaded', {}), [])
  const c = clock()
  const u = new Updates({ updater: electronUpdater(au, { version: '1.0.0' }), version: '1.0.0', now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer })
  assert.deepEqual(await u.check(), { result: 'ready', version: '1.0.1' })
  au.emit('error', new Error("ditto: Couldn't read PKZip signature"))
  assert.deepEqual([u.view().phase, u.view().next], ['idle', null])
  assert.deepEqual(c.pending(), [RETRY])
  au.emit('error', new Error('again')) // only once per download
  assert.equal(u.failures, 1)
  // an error event during a look is that look's own failure, not a lost download
  au.downloadUpdate = async () => (au.emit('update-downloaded', {}), [])
  await c.go(RETRY)
  assert.equal(u.view().phase, 'ready')
  au.checkForUpdates = async () => {
    au.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    throw new Error('net::ERR_INTERNET_DISCONNECTED')
  }
  assert.deepEqual(await u.check(), { result: 'failed' })
  assert.equal(u.view().phase, 'ready', 'what was ready stays ready')
})

test('quitting the ordinary way installs only an update the agents keep working through', async () => {
  const au = standIn({ info: { version: '1.0.1', hostProtocol: 2 } })
  const up = electronUpdater(au, { version: '1.0.0', installOnQuit: (found) => keepsAgents({ hostProtocol: found.hostProtocol, protocol: 1 }) === true })
  await up.download(await up.check())
  assert.equal(au.autoInstallOnAppQuit, false, 'another terminal host: only Restart to update installs it, after saying so')
  const same = standIn({ info: { version: '1.0.1', hostProtocol: 1 } })
  const up2 = electronUpdater(same, { version: '1.0.0', installOnQuit: (found) => keepsAgents({ hostProtocol: found.hostProtocol, protocol: 1 }) === true })
  await up2.download(await up2.check())
  assert.equal(same.autoInstallOnAppQuit, true)
})

test("a look CLIque gave up waiting for that fails later is that look's failure: it doesn't take a good download away", async () => {
  const au = standIn({ info: { version: '1.0.1' } })
  au.downloadUpdate = async () => (au.emit('update-downloaded', {}), [])
  const u = new Updates({ updater: electronUpdater(au, { version: '1.0.0', checkTimeout: 20 }), version: '1.0.0', setTimer: () => 0, clearTimer: () => {} })
  assert.deepEqual(await u.check(), { result: 'ready', version: '1.0.1' })
  let fail
  au.checkForUpdates = () => new Promise((_r, reject) => (fail = reject))
  assert.deepEqual(await u.check(), { result: 'failed' }, 'the second look hangs, and CLIque stops waiting')
  au.emit('error', new Error('net::ERR_TIMED_OUT')) // electron-updater gives up on it at last
  fail(new Error('net::ERR_TIMED_OUT'))
  await tick()
  assert.deepEqual([u.view().phase, u.view().next.version], ['ready', '1.0.1'])
  // …and once that look is over, an error out of nowhere is the installer's again
  au.emit('error', new Error('Code signature did not pass validation'))
  assert.equal(u.view().phase, 'idle')
})

test("the installer refusing the update after you said Restart: the restart fails, nothing is ready, and the menus still work", async () => {
  const au = standIn({ info: { version: '1.0.1' } })
  au.downloadUpdate = async () => (au.emit('update-downloaded', {}), [])
  const u = new Updates({ updater: electronUpdater(au, { version: '1.0.0' }), version: '1.0.0', setTimer: () => 0, clearTimer: () => {} })
  await u.check()
  const restart = u.restart()
  assert.equal(u.view().phase, 'restarting')
  au.emit('error', new Error('Code signature did not pass validation'))
  assert.equal(await restart, false)
  assert.deepEqual(u.view(), { phase: 'idle', version: '1.0.0', off: null, next: null, progress: 100, later: false, asking: null, stuck: false }, 'not "ready" with no version')
})

test('the whole way with electron-updater behind it: found, downloaded, ready, restart', async () => {
  const au = standIn({ info: { version: '1.0.1', hostProtocol: PROTOCOL } })
  const phases = []
  const u = new Updates({ updater: electronUpdater(au, { feed: { baked: true, repo: 'greengrass/clique' }, version: '1.0.0', quitTimeout: 20 }), version: '1.0.0', onChange: (v) => phases.at(-1) !== v.phase && phases.push(v.phase), setTimer: () => 0, clearTimer: () => {} })
  assert.deepEqual(await u.check(), { result: 'ready', version: '1.0.1' })
  assert.equal(u.next.hostProtocol, PROTOCOL)
  assert.equal(u.view().next.notesUrl, 'https://github.com/greengrass/clique/releases/tag/v1.0.1')
  assert.equal(await u.restart(), false, "the stand-in doesn't quit: it comes back as a restart that didn't happen")
  assert.deepEqual(phases, ['checking', 'downloading', 'ready', 'restarting', 'ready'])
  assert.deepEqual(au.calls.map((c) => c[0]), ['check', 'download', 'quitAndInstall'])
})

// ---- open at login ----------------------------------------------------------------------------------------------------

// Electron's app, as much as the login item uses: the system's own record of the setting.
function fakeApp(platform, { wasOpenedAtLogin = false } = {}) {
  const system = { openAtLogin: false, args: [] }
  return {
    system,
    calls: [],
    getLoginItemSettings(o = {}) {
      this.calls.push(['get', o])
      const mine = platform !== 'win32' || JSON.stringify(o.args ?? []) === JSON.stringify(system.args)
      return { openAtLogin: system.openAtLogin && mine, executableWillLaunchAtLogin: system.openAtLogin && mine && !system.disabledInTaskManager, wasOpenedAtLogin }
    },
    setLoginItemSettings(o) {
      this.calls.push(['set', o])
      Object.assign(system, { openAtLogin: o.openAtLogin, args: o.args ?? [] })
    },
  }
}

test('Open at login is off until you turn it on, and is whatever the system says it is', () => {
  const app = fakeApp('darwin')
  const login = loginItem({ app, platform: 'darwin', packaged: true, argv: [] })
  assert.equal(login.supported, true)
  assert.equal(login.on, false, 'off by default')
  assert.equal(login.set(true), true)
  assert.deepEqual(app.calls.at(-2), ['set', { openAtLogin: true }])
  assert.equal(login.on, true)
  app.system.openAtLogin = false // turned off in System Settings › Login Items
  assert.equal(login.on, true, 'what it last read…')
  assert.equal(login.refresh(), false, '…until it looks again')
  assert.equal(login.opened(), false)
})

test('on Windows it starts with --login, so CLIque knows to stay out of the way, and Task Manager turning it off counts', () => {
  const app = fakeApp('win32')
  const login = loginItem({ app, platform: 'win32', packaged: true, argv: ['C:\\CLIque.exe'] })
  assert.equal(login.set(true), true)
  assert.deepEqual(app.calls.at(-2), ['set', { openAtLogin: true, args: [LOGIN_ARG] }])
  assert.deepEqual(app.calls.at(-1), ['get', { args: [LOGIN_ARG] }], 'asked about with the same arguments, or Windows says no')
  assert.equal(login.opened(), false, 'opened by you')
  assert.equal(loginItem({ app, platform: 'win32', packaged: true, argv: ['C:\\CLIque.exe', LOGIN_ARG] }).opened(), true, 'opened by Windows at login')
  app.system.disabledInTaskManager = true
  assert.equal(login.refresh(), false)
  assert.equal(login.set(false), false)
})

test('from source there is no such setting: it would register Electron itself', () => {
  const app = fakeApp('darwin', { wasOpenedAtLogin: true })
  const login = loginItem({ app, platform: 'darwin', packaged: false, argv: [] })
  assert.equal(login.supported, false)
  assert.equal(login.on, false)
  assert.throws(() => login.set(true), /Only an installed CLIque/)
  assert.equal(login.opened(), false)
  assert.deepEqual(app.calls, [], 'the system is never asked')
  assert.equal(loginItem({ app: fakeApp('linux'), platform: 'linux', packaged: true, argv: [] }).supported, false)
})

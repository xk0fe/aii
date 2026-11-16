// A drill for CLIque's updates (core/updates.js): a made-up update feed on a port of this computer, and the real state
// machine run against it, sped up, printing what happens. Nothing is installed, and nothing outside a temporary folder
// is touched. Two ways to run it:
//
//   node scripts/update-drill.mjs                              a small updater of the drill's own reads the feed over HTTP
//                                                              (latest-mac.yml, the zip, its checksum): look → download →
//                                                              ready → Later → the feed goes down (backoff) → a newer
//                                                              version → restart
//   node_modules/.bin/electron scripts/update-drill.mjs        the same feed read by electron-updater inside Electron, as
//                                                              the app does it (core/updates.js electronUpdater). Run from
//                                                              source Electron isn't a signed app, so macOS's own
//                                                              installer refuses the download at the end: the drill
//                                                              shows that too.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { Updates, electronUpdater, newer } from '../core/updates.js'

const inElectron = Boolean(process.versions.electron)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-update-drill-'))
const started = Date.now()
const say = (line) => console.log(`${((Date.now() - started) / 1000).toFixed(2).padStart(6)}s  ${line}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- the feed: what a release publishes, as electron-builder writes it ----------------------------------------------
// (Electron run on a script calls itself by its own version, 44 or so: the feed's is newer than that)
const feed = { version: inElectron ? '99.0.1' : '1.0.1', down: false, hits: [] }
const zips = new Map()
// Stands in for CLIque-<version>-mac-arm64.zip: in Electron on a Mac a real zip of a (tiny, unsigned) CLIque.app, since
// macOS's installer unpacks it; otherwise 3 MB of anything.
const zip = (version) => {
  if (zips.has(version)) return zips.get(version)
  let bytes = crypto.randomBytes(3 * 1024 * 1024)
  if (inElectron && process.platform === 'darwin') {
    const app = path.join(tmp, version, 'CLIque.app')
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true })
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.greengrass.clique.drill</string><key>CFBundleExecutable</key><string>CLIque</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`)
    fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'CLIque'), '#!/bin/sh\n', { mode: 0o755 })
    fs.writeFileSync(path.join(app, 'Contents', 'padding'), crypto.randomBytes(2 * 1024 * 1024))
    execFileSync('ditto', ['-c', '-k', '--keepParent', app, path.join(tmp, `${version}.zip`)])
    bytes = fs.readFileSync(path.join(tmp, `${version}.zip`))
  }
  zips.set(version, bytes)
  return bytes
}
const yml = (version) => {
  const file = `CLIque-${version}-mac-${process.arch}.zip`
  const sha512 = crypto.createHash('sha512').update(zip(version)).digest('base64')
  return [`version: ${version}`, 'files:', `  - url: ${file}`, `    sha512: ${sha512}`, `    size: ${zip(version).length}`, `path: ${file}`, `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`, 'hostProtocol: 1', `releaseNotesUrl: https://example.com/releases/v${version}`, ''].join('\n')
}
const server = http.createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1))
  feed.hits.push(name)
  if (feed.down) return res.writeHead(503).end('down for the drill')
  if (/^latest(-mac)?\.yml$/.test(name)) return res.writeHead(200, { 'content-type': 'text/yaml' }).end(yml(feed.version))
  const version = /^CLIque-(.+)-mac-/.exec(name)?.[1]
  if (!version || !name.endsWith('.zip')) return res.writeHead(404).end()
  const body = zip(version)
  res.writeHead(200, { 'content-length': body.length, 'content-type': 'application/zip' })
  for (let at = 0; at < body.length; at += 512 * 1024) {
    res.write(body.subarray(at, at + 512 * 1024))
    await sleep(60) // slow enough to see it come in
  }
  res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`
say(`feed up at ${url} with CLIque ${feed.version}${inElectron ? '' : ' (this CLIque is 1.0.0)'}`)

// ---- the updater ------------------------------------------------------------------------------------------------------
// Plain Node: reads the feed the way electron-updater does, as far as the drill needs: the newest version from
// latest-mac.yml, the zip it names, and the checksum it must have.
function drillUpdater() {
  const field = (text, name) => new RegExp(`^${name}: '?([^'\\n]+)'?$`, 'm').exec(text)?.[1]
  let latest = null
  return {
    async check() {
      const res = await fetch(`${url}latest-mac.yml`)
      if (!res.ok) throw new Error(`the feed answered ${res.status}`)
      const text = await res.text()
      const version = field(text, 'version')
      if (!newer(version, '1.0.0')) return null
      latest = { file: field(text, 'path'), sha512: field(text, 'sha512'), size: Number(/size: (\d+)/.exec(text)[1]) }
      return { version, notesUrl: field(text, 'releaseNotesUrl'), hostProtocol: Number(field(text, 'hostProtocol')) }
    },
    async download(found, progress) {
      const res = await fetch(url + latest.file)
      if (!res.ok) throw new Error(`the feed answered ${res.status}`)
      const hash = crypto.createHash('sha512')
      let got = 0
      for await (const chunk of res.body) {
        hash.update(chunk)
        got += chunk.length
        progress((got / latest.size) * 100)
      }
      if (hash.digest('base64') !== latest.sha512) throw new Error('sha512 checksum mismatch')
      say(`   (${found.version}: ${got} bytes, checksum matches the feed's)`)
    },
    async install() {
      say('   (here CLIque would let go of its agents, quit, and open as the new version)')
      throw new Error('a drill installs nothing')
    },
  }
}

let electron = null
if (inElectron) {
  electron = await import('electron')
  electron.app.setName('clique-update-drill')
  electron.app.setPath('userData', path.join(tmp, 'userData'))
  electron.app.on('window-all-closed', () => {})
  // (not awaited up here: Electron is only ready once this file has finished loading)
  electron.app.whenReady().then(drill).catch((e) => console.error(e)).finally(() => electron.app.exit(0))
} else {
  await drill()
}

async function electronsUpdater() {
  electron.app.dock?.hide()
  const { default: { autoUpdater } } = await import('electron-updater')
  autoUpdater.forceDevUpdateConfig = true // or electron-updater does nothing in an app that isn't packaged
  const configPath = path.join(tmp, 'update-feed.yml')
  fs.writeFileSync(configPath, `provider: generic\nurl: ${JSON.stringify(url)}\nupdaterCacheDirName: clique-update-drill\n`)
  const updater = electronUpdater(autoUpdater, { feed: { url }, configPath, version: electron.app.getVersion(), log: (line) => say(`   [electron-updater] ${String(line).split('\n')[0].slice(0, 200)}`), quitTimeout: 1500 })
  const quitAndInstall = autoUpdater.quitAndInstall.bind(autoUpdater)
  autoUpdater.quitAndInstall = () => say('   (quitAndInstall is not called in a drill)') || quitAndInstall // never the real one
  say(`electron-updater ${JSON.parse(fs.readFileSync(new URL('../node_modules/electron-updater/package.json', import.meta.url), 'utf8')).version} in Electron ${process.versions.electron}, as version ${electron.app.getVersion()}`)
  return updater
}

async function drill() {
const updater = inElectron ? await electronsUpdater() : drillUpdater()

// ---- the state machine, sped up: a look 0.3 s after starting, then every 4 s; a failed one again after 0.5 s, 1 s, 2 s… -
let last = ''
const updates = new Updates({
  updater, version: '1.0.0', delay: 300, interval: 4000, retry: 500,
  saveSeen: (v) => say(`   (remembered: the note for ${v} was put away)`),
  log: (line) => say(`   log: ${String(line).split('\n')[0].slice(0, 200)}`),
  onChange: (v) => {
    const line = `${v.phase}${v.next ? ` ${v.next.version}` : ''}${v.phase === 'downloading' ? ` ${v.progress}%` : ''}${v.phase === 'ready' ? (v.later ? ' (note put away, Restart to update in the menus)' : ' (note showing)') : ''}${v.stuck ? " (couldn't restart)" : ''}`
    if (line !== last) say(`-> ${(last = line)}`)
  },
})
const until = async (f, ms = 20000) => {
  for (const t = Date.now(); !f(); ) {
    if (Date.now() - t > ms) throw new Error('the drill timed out')
    await sleep(20)
  }
}
const looks = () => feed.hits.filter((h) => h.startsWith('latest')).length

try {
  say('CLIque starts: the first look comes after a short delay')
  updates.start()
  await until(() => updates.phase === 'ready')
  say(`ready: ${JSON.stringify(updates.view())}`)
  if (inElectron) {
    // electron-updater hands the zip to macOS's installer, which checks this app's signature first
    await until(() => updates.phase !== 'ready', 8000).catch(() => {})
    say(updates.phase === 'idle' ? "macOS's installer took the zip from electron-updater and refused it (the drill's app is not this app, and neither is signed), so nothing is ready any more: a real update needs the signed CLIque" : `still ${updates.phase}`)
  } else {
    say('you click Later')
    updates.putOff()
    say('Check for Updates… while one is ready:')
    say(`   ${JSON.stringify(await updates.check({ manual: true }))}`)

    say('the feed goes down: every look fails, quietly, further and further apart')
    feed.down = true
    let n = looks()
    const at = []
    let before = Date.now()
    updates.schedule(0)
    while (at.length < 5) {
      await until(() => looks() > n)
      n = looks()
      at.push(Date.now() - before)
      before = Date.now()
    }
    say(`   looks came after ${at.map((ms) => `${(ms / 1000).toFixed(1)}s`).join(', ')} (0.5 s doubling, up to the 4 s between ordinary looks)`)
    say(`   still: ${updates.phase} ${updates.next.version}, failures in a row: ${updates.failures}`)
    say(`Check for Updates… now: ${JSON.stringify(await updates.check({ manual: true }))}`)

    say('the feed is back, with 1.0.2')
    feed.version = '1.0.2'
    feed.down = false
    await until(() => updates.phase === 'ready' && updates.next.version === '1.0.2')
    say(`   failures in a row: ${updates.failures}`)
    say('you click Restart to update')
    await updates.restart()
  }
  say(`the feed was asked for: ${[...new Set(feed.hits)].join(', ')}`)
} finally {
  updates.stop()
  server.close()
  server.closeAllConnections?.()
  if (inElectron) {
    fs.rmSync(path.join(os.homedir(), 'Library', 'Caches', 'clique-update-drill'), { recursive: true, force: true }) // electron-updater's downloads
    // what macOS's installer kept of this run for Electron-from-source (com.github.Electron), never CLIque's own
    const shipIt = path.join(os.homedir(), 'Library', 'Caches', 'com.github.Electron.ShipIt')
    for (const name of fs.existsSync(shipIt) ? fs.readdirSync(shipIt) : []) {
      if (name.startsWith('update.') && fs.statSync(path.join(shipIt, name)).birthtimeMs >= started - 1000) fs.rmSync(path.join(shipIt, name), { recursive: true, force: true })
    }
    try {
      fs.rmdirSync(shipIt) // if this run made it, and nothing else is in it
    } catch {}
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}
}

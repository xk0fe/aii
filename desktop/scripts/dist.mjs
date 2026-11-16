// Builds CLIque for people to install, into release/ (electron-builder.config.mjs has the details and the signing).
//   npm run dist                  what this computer makes: on a Mac, CLIque.app for Apple Silicon and Intel; on Windows,
//                                 the installers for x64 and arm64
//   npm run dist -- --mac         macOS only: a DMG and a zip per arch (needs a Mac)
//   npm run dist -- --win         Windows only: one installer per arch (a Mac can make these too)
//   --arch=arm64                  just these arches
// The dictation helper is built first (scripts/build-voice.mjs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, Platform, Arch } from 'electron-builder'
import yaml from 'js-yaml' // electron-builder's own
import config from '../electron-builder.config.mjs'
import { buildMac, buildWin } from './build-voice.mjs'
import { stampAll } from './update-info.mjs'

// CI hands every signing secret over, set or not, and electron-builder takes an empty CSC_LINK for a certificate at
// "" (the folder it runs in): without a certificate there's nothing to sign with, so an empty one isn't there at all.
for (const [key, value] of Object.entries(process.env)) if (value === '' && /^(WIN_)?CSC_|^APPLE_|^AZURE_/.test(key)) delete process.env[key]

const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--arch='))?.slice(7).split(',')
const wanted = args.filter((a) => a === '--mac' || a === '--win').map((a) => a.slice(2))
const platforms = wanted.length ? wanted : [process.platform === 'win32' ? 'win' : 'mac']
const pick = (all) => (only ? all.filter((a) => only.includes(a)) : all)

for (const os of platforms) {
  if (os === 'mac') {
    const arches = pick(['arm64', 'x64'])
    buildMac(arches)
    // one run, a DMG and a zip for each arch
    await build({ config, publish: 'never', targets: Platform.MAC.createTarget(['dmg', 'zip'], ...arches.map((a) => Arch[a])) })
  } else {
    const arches = pick(['x64', 'arm64'])
    await buildWin(arches)
    // one run per arch: a single run would bundle every arch into one, twice-as-big installer. Each run writes the
    // update info (latest.yml, when there's a RELEASE_REPO) afresh, so it would list only the last arch's installer:
    // the runs' lists are joined into one, as a single run writes it (the first arch's installer as its path).
    const updateInfo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', config.directories.output, 'latest.yml')
    const infos = []
    for (const arch of arches) {
      fs.rmSync(updateInfo, { force: true })
      await build({ config, publish: 'never', targets: Platform.WINDOWS.createTarget(['nsis'], Arch[arch]) })
      if (fs.existsSync(updateInfo)) infos.push(yaml.load(fs.readFileSync(updateInfo, 'utf8')))
    }
    if (infos.length > 1) fs.writeFileSync(updateInfo, yaml.dump({ ...infos[0], files: infos.flatMap((i) => i.files) }, { lineWidth: -1 }))
  }
}
// The update information (latest-mac.yml, latest.yml, when the build has somewhere to publish to) also says which
// terminal host this version has: scripts/update-info.mjs.
const stamped = stampAll(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', config.directories.output))
if (stamped.length) console.log(`update information: ${stamped.join(', ')} say which terminal host this version has`)

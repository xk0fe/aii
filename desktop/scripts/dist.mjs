// Builds Crew for people to install, into release/ (electron-builder.config.mjs has the details and the signing).
//   npm run dist                  what this computer makes: on a Mac, Crew.app for Apple Silicon and Intel; on Windows,
//                                 the installers for x64 and arm64
//   npm run dist -- --mac         macOS only: a DMG and a zip per arch (needs a Mac)
//   npm run dist -- --win         Windows only: one installer per arch (a Mac can make these too)
//   --arch=arm64                  just these arches
// The dictation helper is built first (scripts/build-voice.mjs).
import { build, Platform, Arch } from 'electron-builder'
import config from '../electron-builder.config.mjs'
import { buildMac, buildWin } from './build-voice.mjs'

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
    // one run per arch: a single run would bundle every arch into one, twice-as-big installer
    for (const arch of arches) await build({ config, publish: 'never', targets: Platform.WINDOWS.createTarget(['nsis'], Arch[arch]) })
  }
}

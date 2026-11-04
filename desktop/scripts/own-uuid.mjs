// Gives CLIque.app's executables Mach-O UUIDs of their own. They're Electron's prebuilt ones, copied and renamed, so as
// they come they carry the very UUID of every other app made with the same Electron (another app on the Mac, the
// Electron in node_modules, an older build). macOS's Local Network privacy goes by the main executable's UUID, and one
// that's shared "may behave weirdly" (Apple's TN3179): CLIque never showed up in Privacy & Security > Local Network,
// so there was nothing there to turn on, and nothing on the local network could be reached.
// Each new UUID comes from the app's bundle id, the executable's place in the app and the UUID Electron built it with:
// the same on every build of one Electron version (so macOS keeps knowing it), and nobody else's.
// Run before the app is signed: the signature covers these bytes. scripts/build-app.mjs (the dev launcher) and
// scripts/after-pack.mjs (the app people install) both do.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const LC_UUID = 0x1b
const FAT = [0xcafebabe, 0xcafebabf] // a universal binary's header (big-endian), 32- and 64-bit offsets
const THIN = { 0xfeedface: 28, 0xfeedfacf: 32 } // a 32- or 64-bit Mach-O's magic (little-endian) -> its header's size

const hex = (bytes) => Buffer.from(bytes).toString('hex').toUpperCase().replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-')

// Where each architecture's UUID sits in a Mach-O file, and what it is: [{ offset, uuid }], offset -1 for one without.
export function uuidsIn(buf) {
  const head = buf.readUInt32BE(0)
  const starts = []
  if (FAT.includes(head)) {
    const wide = head === FAT[1]
    for (let i = 0; i < buf.readUInt32BE(4); i++) {
      const at = 8 + i * (wide ? 32 : 20)
      starts.push(wide ? Number(buf.readBigUInt64BE(at + 8)) : buf.readUInt32BE(at + 8))
    }
  } else starts.push(0)
  return starts.map((start) => {
    const size = THIN[buf.readUInt32LE(start)]
    if (!size) throw new Error('not a Mach-O executable')
    let at = start + size
    for (let i = 0; i < buf.readUInt32LE(start + 16); i++, at += buf.readUInt32LE(at + 4)) {
      if (buf.readUInt32LE(at) === LC_UUID) return { offset: at + 8, uuid: hex(buf.subarray(at + 8, at + 24)) }
    }
    return { offset: -1, uuid: null }
  })
}

// Gives one Mach-O file UUIDs derived from seed, one per architecture in it -> [{ from, to }].
export function giveOwnUUID(file, seed) {
  const buf = fs.readFileSync(file)
  const slices = uuidsIn(buf)
  if (slices.some((s) => s.offset < 0)) throw new Error(`${file} has no UUID for macOS to know it by`)
  const changed = slices.map(({ offset, uuid }) => {
    const own = crypto.createHash('sha256').update(`${seed}\0${uuid}`).digest().subarray(0, 16)
    own.copy(buf, offset)
    return { from: uuid, to: hex(own) }
  })
  fs.writeFileSync(file, buf)
  return changed
}

// The app's executables: its own and its helper apps' (Electron's GPU, renderer and other processes) -> their paths.
export function executables(app) {
  const frameworks = path.join(app, 'Contents', 'Frameworks')
  const helpers = fs.existsSync(frameworks) ? fs.readdirSync(frameworks).filter((f) => f.endsWith('.app')).map((f) => path.join(frameworks, f)) : []
  return [app, ...helpers].flatMap((bundle) => {
    const dir = path.join(bundle, 'Contents', 'MacOS')
    return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : []
  })
}

// Every executable in the app, a UUID of its own from the bundle id -> [{ file, from, to }]
export function giveOwnUUIDs(app, bundleId) {
  const files = executables(app)
  if (!files.length) throw new Error(`${app} has no executables`)
  return files.flatMap((file) => giveOwnUUID(file, `${bundleId}/${path.relative(app, file)}`).map((c) => ({ file, ...c })))
}

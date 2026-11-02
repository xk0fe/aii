// electron-builder's afterPack hook (electron-builder.config.mjs): fixes up the packed app before it's signed, and
// refuses to let a build out that's missing something Crew needs at run time.
import { listPackage } from '@electron/asar'
import fs from 'node:fs'
import path from 'node:path'

// node-pty's Windows terminals drain their output on a worker thread whose script it finds next to itself, mapping
// only VS Code's node_modules.asar to the unpacked folder. In Crew it sits in app.asar: point it at
// app.asar.unpacked too, where the script really is.
const CONOUT = 'var scriptPath = __dirname.replace(\'node_modules.asar\', \'node_modules.asar.unpacked\');'
const CONOUT_FIXED = "var scriptPath = __dirname.replace(/app\\.asar(?=[\\\\/])/, 'app.asar.unpacked').replace('node_modules.asar', 'node_modules.asar.unpacked');"

export async function afterPack({ appOutDir, electronPlatformName: platform, packager }) {
  const resources = platform === 'darwin' ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(appOutDir, 'resources')
  const unpacked = path.join(resources, 'app.asar.unpacked')
  const pty = path.join(unpacked, 'node_modules', 'node-pty')
  const need = (file, what) => {
    if (!fs.existsSync(file)) throw new Error(`the packed app has no ${what} (${path.relative(appOutDir, file)})`)
    return file
  }

  // the protocol shared with the phone app (crew-shared, a local package) travels inside app.asar like any dependency
  const packed = new Set(listPackage(need(path.join(resources, 'app.asar'), 'app.asar'), { isPack: false }).map((f) => f.replaceAll('\\', '/')))
  for (const f of ['/main.js', '/core/ptyhost.js', '/node_modules/crew-shared/protocol.js', '/node_modules/crew-shared/sync.js']) {
    if (!packed.has(f)) throw new Error(`app.asar has no ${f}`)
  }

  const prebuilds = fs.readdirSync(need(path.join(pty, 'prebuilds'), "node-pty prebuilds"))
  if (prebuilds.length !== 1) throw new Error(`node-pty should carry one prebuild, for this platform and arch; it has ${prebuilds.join(', ')}`)

  if (platform === 'win32') {
    const file = need(path.join(pty, 'lib', 'windowsConoutConnection.js'), "node-pty's Windows terminal")
    const code = fs.readFileSync(file, 'utf8')
    if (!code.includes(CONOUT_FIXED)) {
      if (!code.includes(CONOUT)) throw new Error(`node-pty changed how it finds its conout worker; check ${file} and update scripts/after-pack.mjs`)
      fs.writeFileSync(file, code.replace(CONOUT, CONOUT_FIXED))
    }
    for (const f of ['conpty/conpty.dll', 'conpty/OpenConsole.exe', 'winpty-agent.exe', 'pty.node', 'conpty.node']) need(path.join(pty, 'prebuilds', prebuilds[0], f), `node-pty ${f}`)
    need(path.join(resources, 'voice', 'crew-voice.exe'), 'dictation helper')
  } else {
    // what other programs execute (node-pty's spawn-helper, the agents' bin/) must stay executable
    const bin = need(path.join(unpacked, 'bin'), 'bin/ for the agents')
    const run = fs.readdirSync(bin).filter((f) => !/\.(cmd|ps1)$/i.test(f)).map((f) => path.join(bin, f))
    for (const f of [need(path.join(pty, 'prebuilds', prebuilds[0], 'spawn-helper'), "node-pty's spawn-helper"), ...run]) fs.chmodSync(f, 0o755)
    need(path.join(resources, 'voice', 'crew-voice'), 'dictation helper')
  }
}

// electron-builder's afterPack hook (electron-builder.config.mjs): fixes up the packed app before it's signed, and
// refuses to let a build out that's missing something CLIque needs at run time.
import { listPackage } from '@electron/asar'
import { Arch } from 'electron-builder'
import fs from 'node:fs'
import path from 'node:path'
import { giveOwnUUIDs } from './own-uuid.mjs'

// node-pty's Windows terminals drain their output on a worker thread whose script it finds next to itself, mapping
// only VS Code's node_modules.asar to the unpacked folder. In CLIque it sits in app.asar: point it at
// app.asar.unpacked too, where the script really is.
const CONOUT = 'var scriptPath = __dirname.replace(\'node_modules.asar\', \'node_modules.asar.unpacked\');'
const CONOUT_FIXED = "var scriptPath = __dirname.replace(/app\\.asar(?=[\\\\/])/, 'app.asar.unpacked').replace('node_modules.asar', 'node_modules.asar.unpacked');"
// On macOS it finds spawn-helper the same way, but maps any "app.asar" in the path, so loaded from app.asar.unpacked
// (where the terminal host runs it from) it would look in app.asar.unpacked.unpacked and start no terminal at all:
// only an app.asar that's a folder in the path is mapped.
const HELPER = "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');"
const HELPER_FIXED = "helperPath = helperPath.replace(/app\\.asar(?=[\\\\/])/, 'app.asar.unpacked');"

// A line of node-pty's, replaced once (an app packed again is left as it is); one that changed stops the build.
function patch(file, from, to) {
  const code = fs.readFileSync(file, 'utf8')
  if (code.includes(to)) return
  if (!code.includes(from)) throw new Error(`node-pty changed what scripts/after-pack.mjs fixes in ${file}; check it and update the script`)
  fs.writeFileSync(file, code.replace(from, to))
}

export async function afterPack({ appOutDir, electronPlatformName: platform, packager, arch }) {
  const resources = platform === 'darwin' ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(appOutDir, 'resources')
  const unpacked = path.join(resources, 'app.asar.unpacked')
  const pty = path.join(unpacked, 'node_modules', 'node-pty')
  const need = (file, what) => {
    if (!fs.existsSync(file)) throw new Error(`the packed app has no ${what} (${path.relative(appOutDir, file)})`)
    return file
  }

  // the protocol shared with the phone app (clique-shared, a local package) travels inside app.asar like any dependency
  const packed = new Set(listPackage(need(path.join(resources, 'app.asar'), 'app.asar'), { isPack: false }).map((f) => f.replaceAll('\\', '/')))
  for (const f of ['/main.js', '/core/ptyhost.js', '/node_modules/clique-shared/protocol.js', '/node_modules/clique-shared/sync.js']) {
    if (!packed.has(f)) throw new Error(`app.asar has no ${f}`)
  }

  // the terminal host runs outside the app as Node, from here (and on Windows from a copy of it): core/ptyclient.js
  need(path.join(unpacked, 'core', 'ptyhost.js'), 'terminal host')
  // Windows' tools for agents, for this arch only, and only in the Windows app
  const tools = fs.readdirSync(need(path.join(unpacked, 'bin'), 'bin/ for the agents')).filter((f) => f.startsWith('win32-'))
  const own = platform === 'win32' ? [`win32-${Arch[arch]}`] : []
  if (tools.join() !== own.join()) throw new Error(`bin/ should hold ${own.join(', ') || 'no win32-* folder'}; it has ${tools.join(', ') || 'none'}`)
  for (const f of own.flatMap((dir) => ['clique.exe', 'clique-status.exe', 'clique-hook.exe', 'clique', 'clique-status', 'clique-sh', 'clique-sh.cmd'].map((n) => path.join(dir, n)))) need(path.join(unpacked, 'bin', f), `bin/${f}`)

  const prebuilds = fs.readdirSync(need(path.join(pty, 'prebuilds'), "node-pty prebuilds"))
  if (prebuilds.length !== 1) throw new Error(`node-pty should carry one prebuild, for this platform and arch; it has ${prebuilds.join(', ')}`)

  if (platform === 'win32') {
    patch(need(path.join(pty, 'lib', 'windowsConoutConnection.js'), "node-pty's Windows terminal"), CONOUT, CONOUT_FIXED)
    for (const f of ['conpty/conpty.dll', 'conpty/OpenConsole.exe', 'winpty-agent.exe', 'pty.node', 'conpty.node']) need(path.join(pty, 'prebuilds', prebuilds[0], f), `node-pty ${f}`)
    need(path.join(resources, 'voice', 'clique-voice.exe'), 'dictation helper')
  } else {
    patch(need(path.join(pty, 'lib', 'unixTerminal.js'), "node-pty's terminal"), HELPER, HELPER_FIXED)
    // what other programs execute (node-pty's spawn-helper, the agents' bin/) must stay executable
    const bin = need(path.join(unpacked, 'bin'), 'bin/ for the agents')
    const run = fs.readdirSync(bin).filter((f) => !f.includes('.')).map((f) => path.join(bin, f)) // the sh scripts
    for (const f of [need(path.join(pty, 'prebuilds', prebuilds[0], 'spawn-helper'), "node-pty's spawn-helper"), ...run]) fs.chmodSync(f, 0o755)
    need(path.join(resources, 'voice', 'clique-voice'), 'dictation helper')
  }

  // Electron's executables as they come share their UUID with every app on the same Electron, and macOS's Local Network
  // privacy goes by it: without one of its own CLIque never shows up there to be let on (scripts/own-uuid.mjs)
  if (platform === 'darwin') giveOwnUUIDs(path.join(appOutDir, `${packager.appInfo.productFilename}.app`), packager.appInfo.id)
}

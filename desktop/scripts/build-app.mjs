// Builds dist/CLIque.app (the name is PRODUCT_NAME in core/appid.js): the Electron runtime with the app's own name, icon
// and bundle id, for working on it. The bundle is only a launcher; it runs the code in this folder, so your edits apply
// on the next launch. (The app people install comes from npm run dist: scripts/dist.mjs.)
//   npm start      opens the launcher, building it first if it's missing or out of date
//   npm run app    rebuilds it
// Before the rename it was dist/Crew.app. That one is left alone (it may be the copy that's running); once it's quit,
// delete it, and put the new one in the Dock in its place.
// On Windows there's no launcher to build: npm start runs the app from this folder, as npm run dev does.
import { packager } from '@electron/packager'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { APP_ID, PRODUCT_NAME } from '../core/appid.js'
import { Voice } from '../core/voice.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'darwin') process.exit(spawnSync(process.execPath, [path.join(root, 'node_modules', 'electron', 'cli.js'), root], { stdio: 'inherit' }).status ?? 1)
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version

const app = path.join(root, 'dist', `${PRODUCT_NAME}.app`)
const stamp = path.join(root, 'dist', '.build.json')
const wanted = JSON.stringify({ electronVersion, root, icon: fs.statSync(path.join(root, 'assets', 'icon.icns')).mtimeMs, documents: 1, voice: 1, network: 1, id: APP_ID, name: PRODUCT_NAME })
const open = process.argv.includes('--open')
const current = fs.existsSync(app) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === wanted

if (!(open && current)) await build()
if (open) execFileSync('open', [app])

async function build() {
const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-app-'))
fs.writeFileSync(path.join(shim, 'package.json'), JSON.stringify({ name: 'crew', productName: PRODUCT_NAME, version: pkg.version, type: 'module', main: 'main.js' }, null, 2))
fs.writeFileSync(path.join(shim, 'main.js'), `// ${PRODUCT_NAME}.app launcher: runs the app from its source folder.\nimport ${JSON.stringify(pathToFileURL(path.join(root, 'main.js')).href)}\n`)

const [built] = await packager({
  dir: shim,
  out: path.join(root, 'dist'),
  name: PRODUCT_NAME,
  executableName: PRODUCT_NAME,
  // the installed app's id plus .dev, so macOS keeps the two apart when both are on this Mac
  appBundleId: `${APP_ID}.dev`,
  appCategoryType: 'public.app-category.developer-tools',
  icon: path.join(root, 'assets', 'icon.icns'),
  // .crew agent packs open in the app from Finder or Mail; the two descriptions are what macOS shows when it first
  // asks for the microphone (and, before macOS 26, speech recognition) for dictation
  extendInfo: {
    CFBundleDocumentTypes: [{ CFBundleTypeName: `${PRODUCT_NAME} agents`, CFBundleTypeExtensions: ['crew'], CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Owner' }],
    NSMicrophoneUsageDescription: `${PRODUCT_NAME} listens while you dictate a message to your agents.`,
    NSSpeechRecognitionUsageDescription: `${PRODUCT_NAME} turns what you say into text, on this Mac.`,
    // what macOS says when it asks to let it onto the local network (other computers, phones, finding them nearby);
    // without it the dev app was never asked, and Local Network stayed off for it
    NSLocalNetworkUsageDescription: `${PRODUCT_NAME} connects to your other computers and your phone on this network.`,
  },
  electronVersion,
  platform: 'darwin',
  arch: process.arch,
  asar: false,
  overwrite: true,
  quiet: true,
})
fs.rmSync(shim, { recursive: true, force: true })

// Tidy path, then re-sign ad hoc: packaging changes the bundle, and Apple Silicon won't run a broken signature.
fs.rmSync(app, { recursive: true, force: true })
fs.renameSync(path.join(built, `${PRODUCT_NAME}.app`), app)
fs.rmSync(built, { recursive: true, force: true })
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
fs.writeFileSync(stamp, wanted)
// The voice input helper builds on first use anyway; doing it now saves those seconds later.
await new Voice({ root }).ensureBinary().catch((e) => console.log(`Voice input will build on first use (${e.message})`))
console.log(`Built ${app}\nDrag it into Applications (or keep it in the Dock). It runs the code in ${root}.`)
}

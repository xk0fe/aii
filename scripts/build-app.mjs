// Builds dist/Crew.app: the Electron runtime with Crew's own name, icon and bundle id.
// The bundle is only a launcher; it runs the code in this folder, so your edits apply on the next launch.
//   npm start      opens Crew.app, building it first if it's missing or out of date
//   npm run app    rebuilds it
import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version

const app = path.join(root, 'dist', 'Crew.app')
const stamp = path.join(root, 'dist', '.build.json')
const wanted = JSON.stringify({ electronVersion, root, icon: fs.statSync(path.join(root, 'assets', 'icon.icns')).mtimeMs, documents: 1 })
const open = process.argv.includes('--open')
const current = fs.existsSync(app) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === wanted

if (!(open && current)) await build()
if (open) execFileSync('open', [app])

async function build() {
const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-app-'))
fs.writeFileSync(path.join(shim, 'package.json'), JSON.stringify({ name: 'crew', productName: 'Crew', version: pkg.version, type: 'module', main: 'main.js' }, null, 2))
fs.writeFileSync(path.join(shim, 'main.js'), `// Crew.app launcher: runs Crew from its source folder.\nimport ${JSON.stringify(pathToFileURL(path.join(root, 'main.js')).href)}\n`)

const [built] = await packager({
  dir: shim,
  out: path.join(root, 'dist'),
  name: 'Crew',
  executableName: 'Crew',
  appBundleId: 'app.crew.desktop',
  appCategoryType: 'public.app-category.developer-tools',
  icon: path.join(root, 'assets', 'icon.icns'),
  // .crew agent packs open in Crew from Finder or Mail
  extendInfo: {
    CFBundleDocumentTypes: [{ CFBundleTypeName: 'Crew agents', CFBundleTypeExtensions: ['crew'], CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Owner' }],
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
fs.renameSync(path.join(built, 'Crew.app'), app)
fs.rmSync(built, { recursive: true, force: true })
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
fs.writeFileSync(stamp, wanted)
console.log(`Built ${app}\nDrag it into Applications (or keep it in the Dock). It runs the code in ${root}.`)
}

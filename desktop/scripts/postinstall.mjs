// After npm install:
//   - What gets executed straight from this folder must be executable (npm doesn't always keep the bit): node-pty's
//     spawn-helper and the agents' sh scripts in bin/. Windows has no such bit, so there's nothing to do there.
//   - Electron's own binary, which its package only fetches the first time something runs it. npm test runs some
//     checks in it (Crew runs on Electron's BoringSSL, the tests on Node's OpenSSL) and skips them without it, so it's
//     fetched now. ELECTRON_SKIP_BINARY_DOWNLOAD=1 leaves it out.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [])

if (process.platform !== 'win32') {
  const prebuilds = path.join(root, 'node_modules', 'node-pty', 'prebuilds')
  const helpers = list(prebuilds).map((d) => path.join(d, 'spawn-helper')).filter((f) => fs.existsSync(f))
  // the scripts: no extension (not crew.mjs, .gitattributes or Windows' win32-* folders)
  const bin = list(path.join(root, 'bin')).filter((f) => !path.basename(f).includes('.') && fs.statSync(f).isFile())
  for (const f of [...helpers, ...bin]) fs.chmodSync(f, 0o755)
}

const electron = path.join(root, 'node_modules', 'electron', 'install.js')
if (fs.existsSync(electron) && !process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) execFileSync(process.execPath, [electron], { stdio: 'inherit' })

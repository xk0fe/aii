// After npm install: what gets executed straight from this folder must be executable (npm doesn't always keep the
// bit): node-pty's spawn-helper and the agents' bin/. Windows has no such bit, so there's nothing to do there.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [])

if (process.platform !== 'win32') {
  const prebuilds = path.join(root, 'node_modules', 'node-pty', 'prebuilds')
  const helpers = list(prebuilds).map((d) => path.join(d, 'spawn-helper')).filter((f) => fs.existsSync(f))
  const bin = list(path.join(root, 'bin')).filter((f) => !/\.(cmd|ps1)$/i.test(f))
  for (const f of [...helpers, ...bin]) fs.chmodSync(f, 0o755)
}

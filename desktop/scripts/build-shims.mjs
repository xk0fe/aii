// Builds Windows' crew.exe, crew-status.exe and crew-hook.exe (bin/win32-x64, bin/win32-arm64) from native/crew-shim.c,
// on any computer, with zig (brew install zig). The .exe files are committed, so run this only after changing
// crew-shim.c: node scripts/build-shims.mjs. The same source always gives the same bytes (test/windows.test.js checks).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const TARGETS = { x64: 'x86_64-windows-gnu', arm64: 'aarch64-windows-gnu' }
export const NAMES = ['crew.exe', 'crew-status.exe', 'crew-hook.exe']

export function build(arch, out) {
  execFileSync('zig', ['cc', '-target', TARGETS[arch], '-Os', '-s', '-Wall', '-Wextra', '-Werror', '-o', out, path.join(root, 'native', 'crew-shim.c')], { stdio: 'inherit' })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const arch of Object.keys(TARGETS)) {
    const dir = path.join(root, 'bin', `win32-${arch}`)
    fs.mkdirSync(dir, { recursive: true })
    build(arch, path.join(dir, NAMES[0]))
    for (const name of NAMES.slice(1)) fs.copyFileSync(path.join(dir, NAMES[0]), path.join(dir, name))
    console.log(`bin/win32-${arch}: ${NAMES.join(', ')} (${fs.statSync(path.join(dir, NAMES[0])).size} bytes each)`)
  }
}

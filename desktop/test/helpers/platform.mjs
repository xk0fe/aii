// What the tests run in a terminal and where, the same on macOS and Windows: small Node programs instead of /bin/sh,
// which Windows doesn't have.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitBash } from '../../core/procs.js'

export const WIN = process.platform === 'win32'
export const BIN = fileURLToPath(new URL('../../bin', import.meta.url))

// The Electron npm installed, to run things the way Crew does (its BoringSSL, not Node's OpenSSL): Electron.app on
// macOS, electron.exe on Windows. It may be missing (a failed download): tests that need it skip.
export const ELECTRON = path.join(
  fileURLToPath(new URL('../../node_modules/electron/dist/', import.meta.url)),
  { darwin: 'Electron.app/Contents/MacOS/Electron', win32: 'electron.exe' }[process.platform] ?? 'electron',
)

// A terminal program: Node running `js`.
export const program = (js) => ({ file: process.execPath, args: ['-e', js] })

// A shell for what has to be one (bin/crew-sh, the hooks): /bin/sh, or Git Bash on Windows, which is what Claude Code
// runs them with there. null when there's none.
export const SH = WIN ? gitBash() : '/bin/sh'

export const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const gone = async (pid, ms = 4000) => {
  for (const t = Date.now(); alive(pid) && Date.now() - t < ms; ) await new Promise((r) => setTimeout(r, 100))
  return !alive(pid)
}

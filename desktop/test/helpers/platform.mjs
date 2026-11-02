// What the tests run in a terminal and where, the same on macOS and Windows: small Node programs instead of /bin/sh,
// which Windows doesn't have.
import { fileURLToPath } from 'node:url'
import { gitBash } from '../../core/procs.js'

export const WIN = process.platform === 'win32'
export const BIN = fileURLToPath(new URL('../../bin', import.meta.url))

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

// What CLIque adds to the update information electron-builder writes beside the installers (latest-mac.yml,
// latest.yml): which terminal host the version has. A CLIque about to restart into an update reads it there, to say
// whether the agents at work keep working through the restart (the same protocol: the new CLIque picks the running
// host up) or are stopped (another: the host is replaced). core/updates.js restartWords; scripts/dist.mjs stamps it.
// (electron-builder's own releaseInfo takes no fields of ours: its schema refuses them and stops the build.)
import fs from 'node:fs'
import path from 'node:path'

// The terminal host's protocol in this source tree: core/ptyhost.js PROTOCOL, read as text (loading the file would
// load node-pty).
export function hostProtocol(root = new URL('..', import.meta.url)) {
  const n = Number(/^export const PROTOCOL = (\d+)\s*$/m.exec(fs.readFileSync(new URL('core/ptyhost.js', root), 'utf8'))?.[1])
  if (!Number.isInteger(n) || n < 1) throw new Error("core/ptyhost.js no longer says its PROTOCOL the way scripts/update-info.mjs reads it")
  return n
}

// One update file's text with `hostProtocol: n` in it (once, whatever it said before).
export const stamp = (text, n) => `${text.replace(/^hostProtocol:.*\r?\n?/m, '').replace(/\s*$/, '')}\nhostProtocol: ${n}\n`

// Every latest*.yml in the folder the build wrote -> the names of the files stamped.
export function stampAll(dir, n = hostProtocol()) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^latest.*\.yml$/.test(f)) : []
  for (const f of files) fs.writeFileSync(path.join(dir, f), stamp(fs.readFileSync(path.join(dir, f), 'utf8'), n))
  return files
}

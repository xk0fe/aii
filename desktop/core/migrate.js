// An install from before the app's rename (Crew) becomes this one, as the app starts and before anything reads its
// folder: main.js imports core/migrate-now.js first, which calls moveHome(). ~/.crew moves to ~/.clique, and a link is left where it was, because what was
// written down with the old path still points there: agents' folders in config.json, the conversations their CLIs keep
// by folder, and agents still running from before, whose hooks and tools were given the old path. If it can't be moved
// (Windows, with a file in it open), it's used where it is (core/home.js) and moved another time.
// Only the app does this: importing this file moves nothing, so a test, a script or the terminal host never moves
// anyone's folder.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const OLD_HOME = '.crew' // (as core/home.js has it: not imported, since that reads where the folder is as it loads)

export function moveHome({ env = process.env, home = os.homedir(), files = fs } = {}) {
  if (env.CLIQUE_HOME) return null // somewhere of your own: nothing to move
  const now = path.join(home, '.clique')
  const was = path.join(home, OLD_HOME)
  try {
    if (files.existsSync(now) || !files.existsSync(was) || files.lstatSync(was).isSymbolicLink()) return null
    files.renameSync(was, now)
  } catch {
    return null
  }
  try {
    files.symlinkSync(now, was, 'junction') // (a junction on Windows, which needs no special rights; a symlink elsewhere)
  } catch {}
  return now
}

// Electron's own folder for the app (the windows' saved settings), named after the app: Crew's becomes CLIque's.
export function moveUserData(appData, name, { files = fs, old = 'Crew' } = {}) {
  const now = path.join(appData, name)
  const was = path.join(appData, old)
  try {
    // (on a disk that doesn't tell capitals apart the two can't be the same folder: the names differ by more than case)
    if (!files.existsSync(now) && files.existsSync(was)) files.renameSync(was, now)
  } catch {}
  return now
}


// Where CLIque keeps everything: ~/.clique (CLIQUE_HOME says otherwise). Nothing here touches the disk beyond looking:
// core/migrate.js is what moves an older install's folder, once, as the app starts.
//
// The app was called Crew before it was CLIque, and an install from then has its folder at ~/.crew, its settings in
// CREW_* variables, and may have agents still running that were started with those. So the old names are still read,
// here and in bin/: they're never written.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const OLD_HOME = '.crew'
const OLD_ENV = 'CREW_'

// A variable set under its old name counts, unless the new one is set too.
export function oldEnv(env = process.env) {
  for (const k of Object.keys(env)) {
    if (!k.startsWith(OLD_ENV)) continue
    const now = `CLIQUE_${k.slice(OLD_ENV.length)}`
    if (env[now] === undefined) env[now] = env[k]
  }
  return env
}
oldEnv()

// ~/.clique; or the old folder, while that's where the install is (the app hasn't moved it yet, or couldn't): there's
// no ~/.clique, or only a stray one with no settings in it beside an old folder that has them.
export function homeDir({ env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  if (env.CLIQUE_HOME) return env.CLIQUE_HOME
  const now = path.join(home, '.clique')
  const was = path.join(home, OLD_HOME)
  const settings = (dir) => exists(path.join(dir, 'config.json'))
  return exists(was) && (!exists(now) || (!settings(now) && settings(was))) ? was : now
}

export const HOME = homeDir()

// A path written down before the folder moved (an image in a chat, a task or a queued message) begins with the old
// folder: where it is now. Anything else is given back as it is.
export function movedPath(p, { home = HOME, user = os.homedir() } = {}) {
  const was = path.join(user, OLD_HOME)
  if (typeof p !== 'string' || home !== path.join(user, '.clique') || !(p === was || p.startsWith(was + path.sep))) return p
  return home + p.slice(was.length)
}
const movedAll = (images) => (Array.isArray(images) ? images.map((p) => movedPath(p)) : images)
// What's read from disk, with its images where they are now: a line of the chat, a task, a queued message.
export const movedImages = (x) => (x && Array.isArray(x.images) ? { ...x, images: movedAll(x.images) } : x)

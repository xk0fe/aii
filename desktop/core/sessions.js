// Where each CLI keeps a conversation, and which files a conversation is. Moving an agent to another computer
// (core/move.js) takes these files along; an agent that changes account (core/accounts.js) has them moved from one
// account's folder to the other's (Hub.carrySession). No Electron in here, and nothing of the hub's.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { codexLog } from './context.js'

export const WINDOWS = process.platform === 'win32'
export const expand = (dir) => (dir ? String(dir).replace(/^~(?=[\\/]|$)/, os.homedir()) : os.homedir()) // ~/code, or ~\code on Windows
// The folder as its CLI will see it. On Windows, with the case it has on disk (c:\users\me is C:\Users\me there):
// Claude Code names its project folder after that.
export const real = (dir) => {
  try {
    return WINDOWS ? fs.realpathSync.native(dir) : fs.realpathSync(dir)
  } catch {
    return dir
  }
}
export const sizeOf = (file) => {
  try {
    const s = fs.statSync(file)
    return s.isFile() ? s.size : -1
  } catch {
    return -1
  }
}

// ---- where each CLI keeps a conversation --------------------------------------------------------------

// Claude Code: <config>/projects/<the folder's real path, every character but letters and digits a dash>/<id>.jsonl,
// plus a <id>/ folder (sub-agents' transcripts, long tool outputs). A path over 200 characters is cut there and
// gets a hash of the whole, as Claude Code does it.
export function claudeSlug(dir) {
  const slug = dir.replace(/[^a-zA-Z0-9]/g, '-')
  if (slug.length <= 200) return slug
  let hash = 0
  for (let i = 0; i < dir.length; i++) hash = ((hash << 5) - hash + dir.charCodeAt(i)) | 0
  return `${slug.slice(0, 200)}-${Math.abs(hash).toString(36)}`
}

const claudeHome = (env) => (env.CLAUDE_CONFIG_DIR ? expand(env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude'))
const codexHome = (env) => (env.CODEX_HOME ? expand(env.CODEX_HOME) : path.join(os.homedir(), '.codex'))
export const claudeProject = (cwd, env = process.env) => path.join(claudeHome(env), 'projects', claudeSlug(real(expand(cwd))))

// Where a conversation's files go for an agent working in `cwd`: they're named relative to this.
export function sessionRoot(cli, cwd, env = process.env) {
  if (cli === 'claude') return claudeProject(cwd, env)
  if (cli === 'codex') return path.join(codexHome(env), 'sessions')
  throw new Error(`CLIque can't carry ${cli} conversations`)
}

// The files of a conversation: { cli, id, root, files: [{ rel, path }] } (rel: relative to root, the same on the
// computer it goes to, with / between folders on Windows too), or { reason } there's nothing to take. `transcript`:
// the path its hooks reported, which beats working it out.
export function sessionOf(cli, id, { cwd, env = process.env, transcript } = {}) {
  if (!id) return { reason: "it hadn't started a conversation yet" }
  const reported = transcript?.id === id && path.basename(transcript.path).endsWith(`${id}.jsonl`) && sizeOf(transcript.path) >= 0 ? transcript.path : null
  if (cli === 'claude') {
    let file = reported ?? path.join(claudeProject(cwd, env), `${id}.jsonl`)
    if (sizeOf(file) < 0) file = findClaude(id, env)
    if (!file) return { reason: "its conversation wasn't found" }
    const root = path.dirname(file)
    const rels = [path.basename(file), ...walk(path.join(root, id)).map((f) => path.join(id, f))]
    return { cli, id, root, files: rels.map((rel) => ({ rel: portable(rel), path: path.join(root, rel) })) }
  }
  if (cli === 'codex') {
    const root = path.join(codexHome(env), 'sessions')
    const file = reported ?? codexLog(id, codexHome(env))
    if (!file || sizeOf(file) < 0) return { reason: "its conversation wasn't found" }
    let rel = path.relative(root, file)
    if (rel.startsWith('..') || path.isAbsolute(rel)) rel = path.join(new Date().toISOString().slice(0, 10).replaceAll('-', '/'), path.basename(file))
    return { cli, id, root, files: [{ rel: portable(rel), path: file }] }
  }
  return { reason: `CLIque can't carry ${cli} conversations` }
}

// A session started in another folder: Claude Code finds it in that folder's project.
function findClaude(id, env) {
  const projects = path.join(claudeHome(env), 'projects')
  let dirs = []
  try {
    dirs = fs.readdirSync(projects)
  } catch {}
  for (const d of dirs) if (sizeOf(path.join(projects, d, `${id}.jsonl`)) >= 0) return path.join(projects, d, `${id}.jsonl`)
  return null
}

function walk(dir, base = '') {
  let list = []
  try {
    list = fs.readdirSync(path.join(dir, base), { withFileTypes: true })
  } catch {
    return []
  }
  return list.flatMap((d) => (d.isDirectory() ? walk(dir, path.join(base, d.name)) : d.isFile() ? [path.join(base, d.name)] : []))
}

// A relative path as it travels: / between folders, from Windows too.
export const portable = (rel) => rel.split(path.sep).join('/')

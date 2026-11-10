// How an agent's CLI is found and started on each platform, and where agents find `clique`.
//
// macOS and Linux: the first file of that name on PATH that can run. Windows: the first program of that name on PATH,
// tried with each PATHEXT extension the way cmd.exe tries them, where a .cmd is seen through to what it runs. npm, pnpm
// and yarn install `claude` and `codex` as .cmd shims, and nothing can start a .cmd without cmd.exe, which would garble
// the arguments CLIque passes: it reads & | > % " in them its own way and cuts an argument at its first newline (the
// --settings JSON, the -c hooks and the system prompt have all of those).
import fs from 'node:fs'
import path from 'node:path'

const WIN = 'win32'
const PATHEXT = '.COM;.EXE;.BAT;.CMD' // cmd.exe's own, when PATHEXT isn't set
// Of PATHEXT, what CLIque can start: a program, or a batch file it sees through (a .js or .vbs would need its file type's
// program, which only cmd.exe and Explorer look up).
const STARTABLE = new Set(['.com', '.exe', '.bat', '.cmd'])
const BATCH = /\.(cmd|bat)$/i

// Where each CLI's own Windows installers put it, for when CLIque started before it was installed and its PATH doesn't
// have it yet: Claude Code's installer, WinGet, npm; Codex's installer, WinGet, npm.
const INSTALLED = {
  claude: ['%USERPROFILE%\\.local\\bin\\claude.exe', '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\claude.exe', '%APPDATA%\\npm\\claude.cmd'],
  codex: ['%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin\\codex.exe', '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\codex.exe', '%APPDATA%\\npm\\codex.cmd'],
}

const disk = {
  // a file, or an app execution alias (WindowsApps\x.exe), which only lstat can look at
  isFile(file) {
    try {
      return fs.statSync(file).isFile()
    } catch {
      try {
        return !fs.lstatSync(file).isDirectory()
      } catch {
        return false
      }
    }
  },
  canRun(file) {
    try {
      fs.accessSync(file, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  read: (file) => fs.readFileSync(file, 'utf8'),
}

// What an environment calls PATH. Windows' own environment doesn't mind case and calls it "Path"; a plain copy of it, as
// agents' environments are, does mind, so setting "PATH" there would be a second variable beside "Path".
export function pathKey(env = process.env, platform = process.platform) {
  if (platform !== WIN) return 'PATH'
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path'
}

const envOf = (env, name) => env[Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase())]

// %NAME% from the environment, as cmd.exe would fill it in (an unknown one stays as written).
const fill = (text, env) => text.replace(/%(\w+)%/g, (all, name) => envOf(env, name) ?? all)

// cmd -> the file that would run, or cmd itself when there's none.
export function which(cmd, PATH = '', { platform = process.platform, env = process.env, files = disk } = {}) {
  if (platform !== WIN) {
    if (cmd.includes('/')) return cmd
    for (const dir of PATH.split(':')) {
      const file = path.join(dir, cmd)
      if (files.canRun(file)) return file
    }
    return cmd
  }
  if (/[\\/:]/.test(cmd)) return cmd
  const exts = (envOf(env, 'PATHEXT') || PATHEXT).split(';').map((e) => e.toLowerCase()).filter((e) => STARTABLE.has(e))
  const tries = exts.includes(path.win32.extname(cmd).toLowerCase()) ? [''] : exts
  for (const entry of PATH.split(';')) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1')
    if (!dir) continue
    for (const ext of tries) {
      const file = path.win32.join(dir, cmd + ext)
      if (files.isFile(file)) return file
    }
  }
  return cmd
}

// What an npm-style .cmd shim (npm's cmd-shim, pnpm's, yarn's) runs, with the arguments it puts before yours: the last
// command on a line that ends in %*, with the shim's folder (%~dp0, %dp0%) and _prog (node.exe beside the shim, else
// node) filled in. Of several such lines (pnpm: node.exe beside it, or else node), the first whose program is there.
// -> { file, args }, or null for a batch file that's anything else.
export function shimTarget(text, shim, { env = process.env, files = disk } = {}) {
  const dir = `${path.win32.dirname(shim)}\\`
  const vars = (s) => fill(s.replace(/%~dp0|%dp0%/gi, dir), env)
  const progs = [...text.matchAll(/^\s*SET\s+"_prog=([^"]*)"/gim)].map((m) => vars(m[1]))
  const lines = text.split(/\r?\n/).filter((line) => /%\*\s*$/.test(line))
  for (const line of lines) {
    const command = lastCommand(line.replace(/%\*\s*$/, ''))
    const words = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
    if (!words.length) continue
    const [program, ...before] = words.map((w) => (/%_prog%/i.test(w) ? null : vars(w)))
    const candidates = program === null ? progs : [program]
    for (const candidate of candidates) {
      const file = /[\\/]/.test(candidate) ? path.win32.normalize(candidate) : which(candidate, envOf(env, 'PATH') ?? '', { platform: WIN, env, files })
      if (!/[\\/]/.test(file) || !files.isFile(file)) continue
      return { file, args: before.map((w) => (w && /[\\/]/.test(w) ? path.win32.normalize(w) : w)) }
    }
  }
  return null
}

// The last of the commands an & joins on a line, outside quotes, without the @ that keeps cmd.exe from echoing it.
function lastCommand(line) {
  let quoted = false
  let start = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === '&' && !quoted) start = i + 1
  }
  return line.slice(start).trim().replace(/^@/, '')
}

// cmd + args -> { file, args } to hand to a pty or execFile: on Windows a program (never a batch file) with the
// arguments its shim puts first. Throws on Windows when there's nothing to run, or only a batch file CLIque can't see
// through.
export function resolveCommand(cmd, args = [], env = process.env, { platform = process.platform, files = disk } = {}) {
  let file = which(cmd, env[pathKey(env, platform)] ?? '', { platform, env, files })
  if (platform !== WIN) return { file, args }
  if (file === cmd && !/[\\/:]/.test(cmd)) {
    file = (INSTALLED[cmd.toLowerCase()] ?? []).map((place) => fill(place, env)).find((place) => !place.includes('%') && files.isFile(place))
    if (!file) throw new Error(`${cmd} isn't installed, or isn't on PATH`)
  }
  for (let depth = 0; BATCH.test(file); depth++) {
    let target = null
    try {
      target = depth < 4 && shimTarget(files.read(file), file, { env, files })
    } catch {}
    if (!target) throw new Error(`${file} is a batch file, which Windows can't start with these arguments intact: install ${cmd} with its own installer`)
    file = target.file
    args = [...target.args, ...args]
  }
  // what CreateProcess takes at most, each argument quoted with its quotes and backslashes escaped
  const length = [file, ...args].reduce((n, arg) => n + arg.length + 3 + (arg.match(/["\\]/g)?.length ?? 0), 0)
  if (length > 32767) throw new Error(`its command line would be ${length} characters, and Windows takes 32767: shorten this agent's instructions`)
  return { file, args }
}

// Where agents find `clique`, and the status line and hooks their CLIs run: bin/ (sh scripts) on macOS and Linux, and
// bin/win32-<arch> on Windows (clique.exe, clique-status.exe, clique-hook.exe: native/clique-shim.c, which run bin/clique.mjs;
// and the sh scripts again, for Git Bash: scripts/build-shims.mjs).
export const toolsDir = (bin, { platform = process.platform, arch = process.arch } = {}) =>
  platform === WIN ? path.win32.join(bin, `win32-${arch === 'arm64' ? 'arm64' : 'x64'}`) : bin

// The PATH an agent gets: CLIque's tools first, then yours. On Windows that folder holds bin/clique and bin/clique-status
// too (copies), for Git Bash (Claude Code's Bash tool), which takes the name as it is before trying .exe: handing
// `clique note "/api is v2"` to a Windows program, Git Bash would rewrite /api as a path into its own folder. PowerShell
// takes a name with a PATHEXT extension before the bare one in a folder, and cmd only those, so they get the .exe files.
// Claude Code's shell prefix is found there by name too: clique-sh, and clique-sh.cmd for MCP servers (core/hub.js).
export function withTools(env, bin, { platform = process.platform, arch = process.arch } = {}) {
  const key = pathKey(env, platform)
  return { [key]: `${toolsDir(bin, { platform, arch })}${platform === WIN ? ';' : ':'}${env[key] ?? ''}` }
}

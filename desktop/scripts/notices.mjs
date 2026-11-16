// Writes THIRD_PARTY_NOTICES.txt: the open source software that ships inside CLIque, each with its license as it came,
// for electron-builder to put in the app next to CLIque's own LICENSE (electron-builder.config.mjs extraResources).
//   node scripts/notices.mjs           after changing dependencies, Electron, the Windows tools or dictation helper,
//                                      or a font in ui/; commit what it writes (test/notices.test.js checks it's current)
// It reads what's installed: the app's production dependencies in node_modules; for Windows' dictation helper
// (native/windows/CliqueVoice) the NuGet packages it's built from, in the NuGet cache (NUGET_PACKAGES, or ~/.nuget/packages:
// build it once with `node scripts/build-voice.mjs win`); for Windows' clique.exe and co. (native/clique-shim.c, built with
// Zig: scripts/build-shims.mjs) Zig's own license and that of the MinGW-w64 startup code it links in. A font in ui/
// needs its license file beside it (OFL.txt, or LICENSE). The same inputs always give the same file.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL } from './build-voice.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const NOTICES = path.join(root, 'THIRD_PARTY_NOTICES.txt')
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim()
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i
const FONT = /\.(woff2?|ttf|otf)$/i

// Packages that carry no license file: where their license is said instead.
const NO_FILE = {
  // MIT, said at the top of its code
  'qrcode-generator': { file: 'dist/qrcode.js', copyright: /Copyright \(c\) 2009 Kazuhiko Arase/ },
  // MIT, said only in its package.json, by its author (it comes with electron-updater)
  'lazy-val': { declared: 'Vladimir Krivosheev' },
}

// What isn't in the app though it's a dependency: CLIque's own clique-shared, and node-addon-api, which only builds node-pty
// (electron-builder.config.mjs leaves it out).
export const NOT_SHIPPED = new Set(['clique-shared', 'node-addon-api'])

// What runs CLIque, Electron, then the app's production dependencies as installed, with what they depend on in turn.
// -> [{ name, version, dir, license, url }]
export function shipped(dir = root) {
  const out = new Map()
  const visit = (from, deps) => {
    for (const name of Object.keys(deps ?? {})) {
      if (NOT_SHIPPED.has(name)) continue
      const at = locate(from, name)
      if (!at) continue // an optional dependency that isn't installed (ws's bufferutil)
      const pkg = json(path.join(at, 'package.json'))
      const key = `${pkg.name}@${pkg.version}`
      if (out.has(key)) continue
      out.set(key, entry(at))
      visit(at, pkg.dependencies)
      visit(at, pkg.optionalDependencies)
    }
  }
  const entry = (at) => {
    const pkg = json(path.join(at, 'package.json'))
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    return { name: pkg.name, version: pkg.version, dir: at, license: pkg.license ?? pkg.licenses?.map((l) => l.type).join(' OR '), url: pkg.homepage ?? repo?.replace(/^git\+/, '').replace(/\.git$/, '') }
  }
  visit(dir, json(path.join(dir, 'package.json')).dependencies)
  // Electron's own npm package only downloads it: what ships is Electron itself, not its dependencies
  return [entry(locate(dir, 'electron')), ...[...out.values()].sort((a, b) => (a.name < b.name ? -1 : 1))]
}

// Where Node finds `name` from `dir`: its node_modules, or a parent's.
function locate(dir, name) {
  for (let d = dir; ; d = path.dirname(d)) {
    const at = path.join(d, 'node_modules', name)
    if (fs.existsSync(path.join(at, 'package.json'))) return at
    if (path.dirname(d) === d) return null
  }
}

// The font files in ui/ (the app's pages). -> paths relative to desktop/
export function fonts(dir = path.join(root, 'ui')) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { recursive: true }).filter((f) => FONT.test(f)).map((f) => path.join('ui', f).split(path.sep).join('/')).sort()
}

function licenseTexts(dir) {
  return fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort().map((f) => read(path.join(dir, f)))
}

// The MIT license's terms, word for word, as Electron's LICENSE has them: for a copyright line known without a file.
const mit = (copyright) => {
  const electron = read(path.join(root, 'node_modules', 'electron', 'LICENSE'))
  return `MIT License\n\n${copyright}\n\n${electron.slice(electron.indexOf('Permission is hereby granted'))}`
}

// A paragraph of ours, in lines of up to 100 characters.
const wrap = (text) => text.split(' ').reduce((lines, word) => {
  if (lines.length && `${lines.at(-1)} ${word}`.length <= 100) lines[lines.length - 1] += ` ${word}`
  else lines.push(word)
  return lines
}, []).join('\n')

const section = ({ title, url, license, about, texts }) =>
  [`${title}`, ...(url ? [url] : []), `License: ${license}`, ...(about ? ['', wrap(about)] : []), '', texts.join('\n\n')].join('\n')

function npmSections() {
  return shipped().map((p) => {
    let texts = licenseTexts(p.dir)
    if (!texts.length && NO_FILE[p.name]?.declared) {
      const pkg = json(path.join(p.dir, 'package.json'))
      if (pkg.license !== 'MIT' || (pkg.author?.name ?? pkg.author) !== NO_FILE[p.name].declared) throw new Error(`${p.name}: its package.json no longer says MIT, by ${NO_FILE[p.name].declared}`)
      texts = [mit(`Copyright (c) ${NO_FILE[p.name].declared}`)]
    } else if (!texts.length && NO_FILE[p.name]) {
      const head = fs.readFileSync(path.join(p.dir, NO_FILE[p.name].file), 'utf8').slice(0, 2000)
      const line = head.match(NO_FILE[p.name].copyright)?.[0]
      if (!line || !/MIT license/i.test(head)) throw new Error(`${p.name}: its license isn't where it was (${NO_FILE[p.name].file})`)
      texts = [mit(line)]
    }
    if (!texts.length) throw new Error(`${p.name} ${p.version} has no license file: say where its license is in NO_FILE`)
    const about = {
      electron: "Electron includes Chromium and the open source projects Chromium is built from. Their licenses ship with CLIque as LICENSES.chromium.html, in CLIque.app/Contents/Resources on macOS and next to CLIque.exe on Windows.",
      'node-pty': 'Its Windows terminals also use winpty and ConPTY, listed under "Windows only".',
    }[p.name]
    return section({ title: `${p.name} ${p.version}`, url: p.url, license: p.license, about, texts })
  })
}

// node-pty's Windows parts that carry their own license: winpty (winpty-agent.exe, winpty.dll) and Microsoft's ConPTY
// (conpty.dll, OpenConsole.exe, from Windows Terminal).
function ptySections() {
  const pty = path.join(root, 'node_modules', 'node-pty')
  const winpty = path.join(pty, 'deps', 'winpty')
  const conpty = fs.readdirSync(path.join(pty, 'third_party', 'conpty')).sort().at(-1)
  return [
    section({ title: `winpty ${read(path.join(winpty, 'VERSION.txt'))}`, url: 'https://github.com/rprichard/winpty', license: 'MIT', about: "Part of node-pty's Windows terminals.", texts: licenseTexts(winpty) }),
    section({ title: `ConPTY (conpty.dll, OpenConsole.exe) ${conpty}`, url: 'https://github.com/microsoft/terminal', license: 'MIT', about: "From Windows Terminal; part of node-pty's Windows terminals.", texts: [mit('Copyright (c) Microsoft Corporation. All rights reserved.')] }),
  ]
}

// Windows' dictation helper: .NET's runtime (self-contained), Whisper.net and the whisper.cpp it runs, and the speech
// model (scripts/build-voice.mjs).
function voiceSections() {
  const nuget = process.env.NUGET_PACKAGES || path.join(os.homedir(), '.nuget', 'packages')
  const project = fs.readFileSync(path.join(root, 'native', 'windows', 'CliqueVoice', 'CliqueVoice.csproj'), 'utf8')
  const ref = (name) => project.match(new RegExp(`Include="${name.replace(/\./g, '\\.')}" Version="([^"]+)"`))?.[1]
  const net = project.match(/<TargetFramework>net(\d+)\.\d+<\/TargetFramework>/)?.[1]
  const runtimes = path.join(nuget, 'microsoft.netcore.app.runtime.win-x64')
  const dotnet = fs.existsSync(runtimes) && fs.readdirSync(runtimes).filter((v) => v.startsWith(`${net}.`)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)
  const whisper = path.join(nuget, 'whisper.net', ref('Whisper.net') ?? '?')
  if (!dotnet || !fs.existsSync(whisper)) throw new Error(`the dictation helper's packages aren't in ${nuget}: run node scripts/build-voice.mjs win first`)
  const runtime = path.join(runtimes, dotnet)
  return [
    section({ title: `.NET runtime ${dotnet}`, url: 'https://github.com/dotnet/runtime', license: 'MIT', about: "The dictation helper carries its own copy of .NET's runtime.", texts: [read(path.join(runtime, 'LICENSE.TXT')), read(path.join(runtime, 'THIRD-PARTY-NOTICES.TXT'))] }),
    section({ title: `Whisper.net ${ref('Whisper.net')}`, url: 'https://github.com/sandrohanea/whisper.net', license: 'MIT', texts: licenseTexts(whisper) }),
    section({ title: `whisper.cpp and ggml (Whisper.net.Runtime ${ref('Whisper.net.Runtime')})`, url: 'https://github.com/ggml-org/whisper.cpp', license: 'MIT', texts: [mit('Copyright (c) 2023-2024 The ggml authors')] }),
    section({ title: `Whisper speech model (${MODEL.file})`, url: 'https://github.com/openai/whisper', license: 'MIT', about: "OpenAI's Whisper base model, converted for whisper.cpp by its authors.", texts: [mit('Copyright (c) 2022 OpenAI')] }),
  ]
}

// Windows' clique.exe, clique-status.exe and clique-hook.exe: CLIque's own code, built with Zig, which links in its compiler-rt
// and the MinGW-w64 runtime's startup code.
function shimSections() {
  let env
  try {
    env = execFileSync('zig', ['env'], { encoding: 'utf8' })
  } catch {
    throw new Error("zig isn't installed: the Windows tools are built with it (brew install zig), and its license goes in")
  }
  const field = (k) => env.match(new RegExp(`"?\\.?${k}"?\\s*[=:]\\s*"([^"]+)"`))?.[1]
  const lib = field('lib_dir')
  const version = field('version')
  const zigLicense = [path.join(path.dirname(field('zig_exe')), 'LICENSE'), path.join(lib, '..', 'LICENSE'), path.join(lib, '..', '..', 'LICENSE')].find((f) => fs.existsSync(f))
  const mingw = path.join(lib, 'libc', 'mingw', 'COPYING')
  if (!zigLicense || !fs.existsSync(mingw)) throw new Error(`Zig's license or MinGW-w64's isn't where it was (${lib})`)
  const about = "CLIque's clique.exe, clique-status.exe and clique-hook.exe for Windows are built with Zig, and contain parts of it."
  return [
    section({ title: `Zig ${version} (compiler-rt)`, url: 'https://ziglang.org', license: 'MIT', about, texts: [read(zigLicense)] }),
    section({ title: 'MinGW-w64 runtime', url: 'https://www.mingw-w64.org', license: 'ZPL-2.1', about: 'Startup code in the same Windows tools, from the MinGW-w64 runtime that comes with Zig.', texts: [read(mingw)] }),
  ]
}

function fontSections() {
  return fonts().map((f) => {
    const dir = path.join(root, path.dirname(f))
    const texts = licenseTexts(dir).concat(fs.readdirSync(dir).filter((x) => /^OFL.*\.txt$/i.test(x)).map((x) => read(path.join(dir, x))))
    if (!texts.length) throw new Error(`${f} has no license file beside it (OFL.txt, or LICENSE)`)
    return section({ title: `Font: ${path.basename(f)}`, license: texts.some((t) => /SIL OPEN FONT LICENSE/i.test(t)) ? 'OFL-1.1' : 'see below', texts: [...new Set(texts)] })
  })
}

export function notices() {
  const rule = `\n\n${'-'.repeat(100)}\n\n`
  const head = [
    'Third-party software in CLIque',
    '',
    'CLIque is made by Green Grass Inc. and is not open source (see LICENSE). It includes the open source software below,',
    'each under its own license. Their copyright notices and license terms follow, as they came with each one.',
  ].join('\n')
  const fontPart = fontSections()
  return [head, ...npmSections(), ...fontPart, 'Windows only', ...ptySections(), ...voiceSections(), ...shimSections()].join(rule) + '\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(NOTICES, notices())
  console.log(`wrote ${path.relative(root, NOTICES)}`)
}

// Builds the dictation helper that ships inside CLIque (core/voice.js) into dist/voice/<os>-<arch>/, where
// electron-builder.config.mjs picks it up as Resources/voice/.
//   node scripts/build-voice.mjs mac [--arch=arm64,x64]   native/clique-voice.swift, with Apple's developer tools
//   node scripts/build-voice.mjs win [--arch=x64,arm64]   native/windows/CliqueVoice, with the .NET 8 SDK (any OS)
// A source checkout on a Mac doesn't need this: core/voice.js builds the helper itself on first use.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = (os, arch) => path.join(root, 'dist', 'voice', `${os}-${arch}`)
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
const newer = (file, than) => fs.existsSync(file) && than.every((f) => fs.statSync(file).mtimeMs >= fs.statSync(f).mtimeMs)

export function buildMac(arches = ['arm64', 'x64']) {
  const source = path.join(root, 'native', 'clique-voice.swift')
  for (const arch of arches) {
    const bin = path.join(out('mac', arch), 'clique-voice')
    if (newer(bin, [source])) continue
    fs.mkdirSync(path.dirname(bin), { recursive: true })
    // macOS 13 is the oldest the helper supports; it picks Apple's newer dictation on macOS 26 at run time
    const target = `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`
    run('xcrun', ['swiftc', '-O', '-parse-as-library', '-target', target, source, '-o', bin])
    console.log(`built ${path.relative(root, bin)}`)
  }
}

// Windows: a self-contained .NET helper running whisper.cpp on this computer (native/windows/CliqueVoice), and the
// speech model it ships with: Whisper's multilingual base model, 5-bit (60 MB), in <helper>/models/.
const PROJECT = path.join(root, 'native', 'windows', 'CliqueVoice', 'CliqueVoice.csproj')
export const MODEL = {
  file: 'ggml-base-q5_1.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
  sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
}

export async function buildWin(arches = ['x64', 'arm64']) {
  const model = await fetchModel()
  for (const arch of arches) {
    const dir = out('win', arch)
    fs.rmSync(dir, { recursive: true, force: true })
    run('dotnet', ['publish', PROJECT, '-c', 'Release', '-r', `win-${arch}`, '--self-contained', '-o', dir, '-nologo'])
    fs.mkdirSync(path.join(dir, 'models'), { recursive: true })
    fs.copyFileSync(model, path.join(dir, 'models', MODEL.file))
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.pdb'))) fs.rmSync(path.join(dir, f))
    console.log(`built ${path.relative(root, dir)}`)
  }
}

// Downloaded once into dist/voice/cache and checked against its hash, so every build ships the same model.
async function fetchModel() {
  const file = path.join(root, 'dist', 'voice', 'cache', MODEL.file)
  const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  if (fs.existsSync(file) && hash(file) === MODEL.sha256) return file
  fs.mkdirSync(path.dirname(file), { recursive: true })
  console.log(`downloading ${MODEL.url}`)
  const res = await fetch(MODEL.url)
  if (!res.ok) throw new Error(`couldn't download the speech model: ${res.status} ${res.statusText}`)
  fs.writeFileSync(`${file}.tmp`, Buffer.from(await res.arrayBuffer()))
  const got = hash(`${file}.tmp`)
  if (got !== MODEL.sha256) throw new Error(`the speech model's SHA-256 is ${got}, expected ${MODEL.sha256}`)
  fs.renameSync(`${file}.tmp`, file)
  return file
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const os = process.argv[2]
  const arches = process.argv.find((a) => a.startsWith('--arch='))?.slice(7).split(',')
  if (os === 'mac') buildMac(arches)
  else if (os === 'win') await buildWin(arches)
  else {
    console.error('usage: node scripts/build-voice.mjs mac|win [--arch=arm64,x64]')
    process.exit(2)
  }
}

// Makes every picture in the README (docs/images) from the app as it is now. Run: npm run readme
// It takes the shots the README uses (scripts/screenshots.mjs: the cover, the `readme` scenes and four recordings) on the
// stage (--frame), in windows small enough to read at the width GitHub shows them, the recordings once in each theme,
// and writes them as WebP. Needs ffmpeg and cwebp on the PATH (brew install ffmpeg webp).
// The two pictures with a phone in them use the phone app's own captures in docs/images/src (mobile/README.md says how
// those are taken); nothing else comes from outside this script.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const images = path.join(root, '..', 'docs', 'images')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-readme-'))

// what the README calls each picture, and (stills) how wide to keep it: twice the width it's shown at, at most
const STILLS = {
  cover: ['cover', 2200], 'readme-hero': ['hero', 1900], 'readme-q': ['q', 1800], 'readme-threads': ['threads', 1800], 'readme-canvas': ['canvas', 1800],
  'readme-terminals': ['terminals', 1800], 'readme-usage': ['usage', 1800], 'readme-computers': ['computers', 1800], 'readme-workspaces': ['workspaces', 1800],
  'readme-floating': ['floating', 1000], 'readme-hatch': ['hatch', 1400], 'readme-phone': ['phone', 1500],
}
const RECORDINGS = { 'clique-switch': 'agents', 'group-chat': 'chat', 'tasks-loop': 'tasks', 'right-of-way': 'right-of-way' }
const SCENES = ['switchGif', 'groupChatGif', 'tasksGif', 'rightOfWayGif']
// the window each is recorded in: the cards three to a row in the full-size one, the rest in one small enough to read
const WINDOW = { switchGif: '1440x880' }

const only = process.argv.slice(2).filter((a) => !a.startsWith('-')) // npm run readme -- hero tasks: only those
const wanted = (name) => !only.length || only.includes(name)
const shots = (...args) => {
  const run = spawnSync(electron, [path.join(root, 'scripts', 'screenshots.mjs'), tmp, ...args], { stdio: 'inherit' })
  if (run.status) process.exitCode = 1
}
const stills = Object.values(STILLS).some(([name]) => wanted(name))
const scenes = SCENES.filter((scene, i) => wanted(Object.values(RECORDINGS)[i]))
if (stills) shots('cover', 'readme', '--frame')
for (const size of new Set(scenes.map((scene) => WINDOW[scene] ?? '1100x700'))) {
  const these = scenes.filter((scene) => (WINDOW[scene] ?? '1100x700') === size)
  shots(...these, '--frame', `--window=${size}`)
  shots(...these, '--frame', `--window=${size}`, '--dark')
}

fs.mkdirSync(images, { recursive: true })
const made = []
const pngWidth = (file) => fs.readFileSync(file).readUInt32BE(16)
for (const [shot, [name, width]] of Object.entries(STILLS)) {
  for (const theme of ['light', 'dark']) {
    const from = path.join(tmp, `${shot}-${theme}.png`)
    if (!wanted(name) || !fs.existsSync(from)) continue
    const to = path.join(images, `${name}-${theme}.webp`)
    execFileSync('cwebp', ['-quiet', '-q', '86', '-alpha_q', '100', ...(pngWidth(from) > width ? ['-resize', String(width), '0'] : []), from, '-o', to])
    made.push(to)
  }
}
for (const [shot, name] of Object.entries(RECORDINGS)) {
  for (const [theme, file] of [['light', `${shot}.webp`], ['dark', `${shot}-dark.webp`]]) {
    const from = path.join(tmp, file)
    if (!wanted(name) || !fs.existsSync(from)) continue
    const to = path.join(images, `${name}-${theme}.webp`)
    fs.copyFileSync(from, to)
    made.push(to)
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
const size = (file) => `${(fs.statSync(file).size / 1024).toFixed(0).padStart(5)} KB`
for (const file of made) console.log(size(file), path.relative(path.join(root, '..'), file))
console.log(`${made.length} pictures in docs/images${process.exitCode ? ', and a shot failed: see above' : ''}`)

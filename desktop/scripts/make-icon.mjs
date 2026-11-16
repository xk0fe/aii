// Draws the app icon: the C mark. A white C (for CLIque) with a pink prompt inside it, on a near-black tile. One
// precise mark and nothing else, the way the tools it sits beside in a Dock are drawn. The creatures stay in the app.
// macOS and Windows show an app's icon as drawn instead of masking it, so what ships for them is the artwork cut to
// Apple's continuous-corner tile, with the lit rim a Dock tile has:
//   assets/icon.png  1024px canvas on Apple's grid: the 824px tile at a 100px inset (corner r 185) with a soft drop
//                    shadow, transparent around it
//   assets/icon.icns the same at 16 to 1024px; at 16 and 32px the mark is drawn a size larger, so the prompt inside
//                    the C is still a shape there
// make-ico.mjs writes assets/icon.ico from drawIcon('windows'), the same tile filling ~92% of the square with no
// shadow, and the larger mark up to 32px, so it holds up at 16 to 48px (npm run icon runs both scripts).
// --bleed <file>  also writes the full-bleed square artwork (no corners, no rim, no shadow), for what cuts its own
//                 mask: the site (site/tools/icons.mjs --icon <file>).
// --phone <dir>   also writes the phone app's pictures into <dir> (mobile/assets/images): icon.png (full bleed, no
//                 alpha channel: the App Store refuses one), the three Android layers at 512px (the mark alone, the
//                 ground alone, the mark in one colour for themed icons) and the splash's mark for a light and a
//                 dark page at 640px.
// Run: npx electron scripts/make-icon.mjs [--bleed <file>] [--phone <dir>]
import { app, BrowserWindow, nativeImage } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = path.join(root, 'assets')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-icon-'))
app.setPath('userData', path.join(tmp, 'userdata'))

const SIDE = 1024 // the artwork, full bleed
const TILE = 824 // Apple's icon grid: the tile inside the 1024 canvas
const CORNER = 185 // Apple's corner radius for that tile

const GROUND = ['#242427', '#0D0D0F'] // the tile, top to bottom
const INK = '#F4F4F6' // the C on the tile
const PINK = '#FF4FA6' // the prompt: the creatures' pink, a touch lighter so it carries on black
const PAPER_INK = '#161618' // the C on a light page (the phone's light splash)
const PAPER_PINK = '#EE2F8E' // the prompt there

// The mark, in a 100-unit box (the tile is the whole box). The C is a ring, r 26 and 10.5 thick, open 38° either side
// of east, its ends cut square. It sits 1.5 right of centre: an open C's weight is on its left, so centred by the
// numbers it looks pushed left. The prompt is a chevron with flat cuts and eased corners, its point towards the gap.
const C = { x: 51.5, y: 50, r: 26, thick: 10.5, gap: 38 }
const PROMPT = { x: C.x - 7.5, half: 12.5, reach: 11, thick: 7.6, ease: 1.1 }
const U = SIDE / 100

function mark(ink, prompt) {
  const at = (deg) => [C.x + C.r * Math.cos((deg * Math.PI) / 180), C.y + C.r * Math.sin((deg * Math.PI) / 180)].map((v) => v.toFixed(3)).join(' ')
  const { x, half: h, reach: d, thick: t, ease } = PROMPT
  const chevron = [[x, C.y - h], [x + t, C.y - h], [x + t + d, C.y], [x + t, C.y + h], [x, C.y + h], [x + d, C.y]].map((p) => p.join(',')).join(' ')
  return `<path d="M${at(C.gap)}A${C.r} ${C.r} 0 1 1 ${at(-C.gap)}" fill="none" stroke="${ink}" stroke-width="${C.thick}"/>
    <polygon points="${chevron}" fill="${prompt}" stroke="${prompt}" stroke-width="${2 * ease}" stroke-linejoin="round"/>`
}

// Apple's continuous corner (the curve iOS and macOS cut icons with, not a circular arc) as a path for a square of
// side s and corner radius r: each corner is three cubics that ease from the edge into the arc and back out.
function continuousSquare(s, r) {
  const [a, b, c, d, e, f, g] = [1.52866483, 1.08849323, 0.86840689, 0.63149399, 0.07491139, 0.37282392, 0.16906013].map((k) => k * r)
  // one corner as [along the edge it comes from, along the edge it goes to], measured from the corner itself
  const corner = [[a, 0], [b, 0], [c, 0], [d, e], [f, g], [g, f], [e, d], [0, c], [0, b], [0, a]]
  const at = [(u, v) => [s - u, v], (u, v) => [s - v, s - u], (u, v) => [u, s - v], (u, v) => [v, u]] // TR, BR, BL, TL
  const n = (v) => +v.toFixed(2)
  return at.map((place, i) => {
    const p = corner.map(([u, v]) => place(u, v).map(n).join(' '))
    return `${i ? 'L' : 'M'}${p[0]}C${p[1]} ${p[2]} ${p[3]}C${p[4]} ${p[5]} ${p[6]}C${p[7]} ${p[8]} ${p[9]}`
  }).join('') + 'Z'
}

// The artwork as one SVG, 1024 square. `ground`: the tile's colour behind the mark. `zoom`: the mark's size about the
// centre. `rim`: the lit edge a cut tile has (light from above, a trace of it at the bottom), drawn along the cut.
function artwork({ ground = true, ink = INK, prompt = PINK, zoom = 1, rim = false }) {
  const half = SIDE / 2
  return `<svg width="${SIDE}" height="${SIDE}" viewBox="0 0 ${SIDE} ${SIDE}">
    <defs>
      <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GROUND[0]}"/><stop offset="1" stop-color="${GROUND[1]}"/></linearGradient>
      <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".3" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity=".05"/></linearGradient>
    </defs>
    ${ground ? `<rect width="${SIDE}" height="${SIDE}" fill="url(#ground)"/>` : ''}
    ${ink ? `<g transform="translate(${half} ${half}) scale(${zoom}) translate(${-half} ${-half}) scale(${U})">${mark(ink, prompt)}</g>` : ''}
    ${rim ? `<path d="${continuousSquare(SIDE, (CORNER * SIDE) / TILE)}" fill="none" stroke="url(#rim)" stroke-width="12"/>` : ''}
  </svg>`
}

// Android's adaptive icon shows the middle 72 of its 108dp layers: the mark at that scale lands where iOS has it
const ADAPTIVE = 72 / 108

const SMALL_ZOOM = 1.18
export const SMALL = 32 // px: up to here the larger mark is used

// What each output is: the artwork, and how it sits on the 1024 canvas (`size` of the tile, its `corner`, a `shadow`).
const LOOKS = {
  bleed: {},
  mac: { rim: true, size: TILE, corner: CORNER, shadow: 'drop-shadow(0 18px 36px rgba(0, 0, 0, .3))' },
  // Windows shows icons at 16 to 48px next to icons that use the whole square: the same tile, filling ~92% of the
  // canvas and without the shadow, which at those sizes only smudges the bottom edge
  windows: { rim: true, size: 944, corner: (CORNER * 944) / TILE },
  // 32px and under (a Finder list, the taskbar, a window's corner): the same tiles with the mark a size larger
  macSmall: { rim: true, size: TILE, corner: CORNER, zoom: SMALL_ZOOM, shadow: 'drop-shadow(0 18px 36px rgba(0, 0, 0, .3))' },
  windowsSmall: { rim: true, size: 944, corner: (CORNER * 944) / TILE, zoom: SMALL_ZOOM },
  foreground: { ground: false, zoom: ADAPTIVE },
  background: { ink: null },
  monochrome: { ground: false, zoom: ADAPTIVE, ink: '#fff', prompt: '#fff' },
  splash: { ground: false, zoom: 1.2, ink: PAPER_INK, prompt: PAPER_PINK },
  splashDark: { ground: false, zoom: 1.2 },
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; overflow: hidden; }
  .canvas { position: relative; width: ${SIDE}px; height: ${SIDE}px; }
  .lift { position: absolute; } /* carries the shadow, outside the tile's clip */
  .tile { position: absolute; inset: 0; overflow: hidden; }
  .art { position: absolute; left: 0; top: 0; width: ${SIDE}px; height: ${SIDE}px; transform-origin: 0 0; }
  .art svg { display: block; }
</style></head><body><div class="canvas"><div class="lift"><div class="tile"><div class="art"></div></div></div></div>
<script>
  window.look = ({ svg, size = ${SIDE}, clip = 'none', shadow = 'none' }) => {
    document.querySelector('.art').innerHTML = svg
    const lift = document.querySelector('.lift')
    Object.assign(lift.style, { left: (${SIDE} - size) / 2 + 'px', top: (${SIDE} - size) / 2 + 'px', width: size + 'px', height: size + 'px', filter: shadow })
    document.querySelector('.tile').style.clipPath = clip
    document.querySelector('.art').style.transform = 'scale(' + size / ${SIDE} + ')'
  }
</script></body></html>`

// Draws the artwork in a hidden window and captures it once per named look: a 1024px PNG for each.
export async function drawIcon(...names) {
  const page = path.join(tmp, 'icon.html')
  fs.writeFileSync(page, html)
  const win = new BrowserWindow({ width: SIDE, height: SIDE, show: false, transparent: true, frame: false, paintWhenInitiallyHidden: true, useContentSize: true, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(page)
  const pngs = []
  for (const name of names) {
    const { size, corner, shadow, ...art } = LOOKS[name]
    await win.webContents.executeJavaScript(`look(${JSON.stringify({ svg: artwork(art), size, shadow, clip: corner ? `path('${continuousSquare(size, corner)}')` : undefined })})`)
    await new Promise((r) => setTimeout(r, 400))
    pngs.push((await win.webContents.capturePage({ x: 0, y: 0, width: SIDE, height: SIDE })).resize({ width: SIDE, height: SIDE, quality: 'best' }).toPNG())
  }
  win.destroy()
  return pngs
}

export function cleanUp() {
  fs.rmSync(tmp, { recursive: true, force: true })
}

const scaled = (png, px) => (px === SIDE ? png : nativeImage.createFromBuffer(png).resize({ width: px, height: px, quality: 'best' }).toPNG())

// A PNG with no alpha channel: 8-bit RGB, rows unfiltered (the artwork is flat colour, so it packs small anyway).
function opaquePNG(png) {
  const image = nativeImage.createFromBuffer(png)
  const { width, height } = image.getSize()
  const px = image.toBitmap() // BGRA
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0, from = 0, to = 0; y < height; y++) {
    to++ // the row's filter: none
    for (let x = 0; x < width; x++, from += 4) {
      rows[to++] = px[from + 2]
      rows[to++] = px[from + 1]
      rows[to++] = px[from]
    }
  }
  const crc = (buf) => {
    let c = ~0
    for (const byte of buf) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), out.length - 4)
    return out
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head[8] = 8 // bits per channel
  head[9] = 2 // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  app.whenReady().then(async () => {
    const after = (flag) => (process.argv.indexOf(flag) > 1 ? path.resolve(process.argv[process.argv.indexOf(flag) + 1]) : null)
    const bleedOut = after('--bleed')
    const phone = after('--phone')
    const wrote = ['assets/icon.png', 'assets/icon.icns']
    // one window draws them all: closing the last window ends the app
    const names = ['mac', 'macSmall', 'bleed', ...(phone ? ['foreground', 'background', 'monochrome', 'splash', 'splashDark'] : [])]
    const drawn = await drawIcon(...names)
    const { mac, macSmall, bleed, foreground, background, monochrome, splash, splashDark } = Object.fromEntries(names.map((name, i) => [name, drawn[i]]))
    fs.writeFileSync(path.join(assets, 'icon.png'), mac)
    if (bleedOut) {
      fs.writeFileSync(bleedOut, bleed)
      wrote.push(bleedOut)
    }
    if (phone) {
      const files = {
        'icon.png': opaquePNG(bleed),
        'android-icon-foreground.png': scaled(foreground, 512),
        'android-icon-background.png': scaled(background, 512),
        'android-icon-monochrome.png': scaled(monochrome, 512),
        'splash-icon.png': scaled(splash, 640),
        'splash-icon-dark.png': scaled(splashDark, 640),
      }
      for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(phone, name), data)
      wrote.push(`${Object.keys(files).length} pictures in ${phone}`)
    }

    // macOS .icns: every size resampled from the one drawing (Skia's best filter keeps the tile's edge where it is at
    // 16 and 32px; sips pulls it in), then the built-in iconutil
    const set = path.join(tmp, 'icon.iconset')
    fs.mkdirSync(set)
    for (const s of [16, 32, 128, 256, 512]) {
      for (const [k, at] of [[1, ''], [2, '@2x']]) fs.writeFileSync(path.join(set, `icon_${s}x${s}${at}.png`), scaled(s * k <= SMALL ? macSmall : mac, s * k))
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(assets, 'icon.icns')])
    cleanUp()
    console.log(`wrote ${wrote.join(', ')}`)
    app.exit(0)
  })
}

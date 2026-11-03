// Renders the app icon from the same plush creatures the UI draws (ui/avatar.js): three buddies on lilac felt, a
// darker felt floor behind their feet, and one stitched seam running behind them, concentric with the tile's corner.
// The artwork is the approved full-bleed square (design mock icon.html). macOS and Windows show an app's icon as drawn
// instead of masking it, so what ships for them is that artwork cut to Apple's continuous-corner tile:
//   assets/icon.png  1024px canvas on Apple's grid: the 824px tile at a 100px inset (corner r 185) with a soft drop
//                    shadow, transparent around it
//   assets/icon.icns the same at 16 to 1024px
// make-ico.mjs writes assets/icon.ico from drawIcon('windows'), the same tile filling ~92% of the square with no
// shadow, so it holds up at 16 to 48px (npm run icon runs both scripts).
// --bleed <file> also writes the full-bleed square artwork (no corners, no shadow), for the platforms that cut their
// own mask (the phone app, the site).
// Run: npx electron scripts/make-icon.mjs [--bleed <file>]
import { app, BrowserWindow, nativeImage } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = path.join(root, 'assets')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-icon-'))
app.setPath('userData', path.join(tmp, 'userdata'))

const SIDE = 1024 // the artwork, full bleed
const TILE = 824 // Apple's icon grid: the tile inside the 1024 canvas
const CORNER = 185 // Apple's corner radius for that tile

// name + look of each buddy, left to right; the middle one stands in front. Sizes and offsets are in the 824 tile's
// px (they were drawn for it); the artwork scales them up with everything else.
const BUDDIES = [
  { name: 'left', size: 520, x: -92, y: -64, avatar: { body: 'blob', color: 'sky', eyes: 'dot', mouth: 'none', hat: 'none', cheeks: true } },
  { name: 'right', size: 520, x: 418, y: -64, avatar: { body: 'mochi', color: 'lime', eyes: 'happy', mouth: 'none', hat: 'none', cheeks: true } },
  { name: 'middle', size: 570, x: 127, y: -48, avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true } },
]
const UP = SIDE / TILE

// The felt, in the artwork's 1024 px: wall, floor (from y 794 down, the buddies stand 190 above the bottom on it) and
// the seam, inset 76 with a corner of 229 - 76, so it runs concentric with a mask whose corner is ~22.4% of the side
// (iOS's, Apple's 185 on the 824 tile, where the seam lands 61 in with a corner of 123) and inside every safe area.
const SEAM = 76
const MASK_CORNER = 229
const art = `<svg class="felt" width="${SIDE}" height="${SIDE}" viewBox="0 0 ${SIDE} ${SIDE}">
  <defs><filter id="icon-felt" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="3" seed="5" result="g"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .38 0 0 0 -.15" result="dark"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 .45 0 0 -.2" result="light"/>
    <feComposite in="dark" in2="SourceGraphic" operator="in" result="d"/><feComposite in="light" in2="SourceGraphic" operator="in" result="l"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="d"/><feMergeNode in="l"/></feMerge></filter></defs>
  <rect width="${SIDE}" height="${SIDE}" fill="#EADFF6" filter="url(#icon-felt)"/>
  <rect width="${SIDE}" height="230" y="794" fill="#DECFEF" filter="url(#icon-felt)"/>
  <rect x="${SEAM}" y="${SEAM}" width="${SIDE - 2 * SEAM}" height="${SIDE - 2 * SEAM}" rx="${MASK_CORNER - SEAM}" fill="none"
    stroke="#B9A3D9" stroke-width="9" stroke-dasharray="30 20" stroke-linecap="round"/>
</svg>`

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

// how the artwork sits on the 1024 canvas for each output
const LOOKS = {
  bleed: { size: SIDE },
  mac: { size: TILE, clip: `path('${continuousSquare(TILE, CORNER)}')`, shadow: 'drop-shadow(0 22px 44px rgba(20, 10, 40, .28))' },
  // Windows shows icons at 16 to 48px next to icons that use the whole square: the same tile, filling ~92% of the
  // canvas and without the shadow, which at those sizes only smudges the bottom edge
  windows: { size: 944, clip: `path('${continuousSquare(944, (CORNER * 944) / TILE)}')` },
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${path.join(root, 'ui', 'common.css')}">
<style>
  html, body { margin: 0; background: transparent; overflow: hidden; }
  .canvas { position: relative; width: ${SIDE}px; height: ${SIDE}px; }
  .lift { position: absolute; } /* carries the shadow, outside the tile's clip */
  .tile { position: absolute; inset: 0; overflow: hidden; }
  .art { position: absolute; left: 0; top: 0; width: ${SIDE}px; height: ${SIDE}px; transform-origin: 0 0; }
  .felt { position: absolute; inset: 0; }
  .buddy { position: absolute; line-height: 0; }
  .av-z, .av-bang { display: none; }
</style></head><body><div class="canvas"><div class="lift"><div class="tile"><div class="art">${art}</div></div></div></div>
<script src="${path.join(root, 'ui', 'avatar.js')}"></script>
<script>
  document.querySelector('.art').insertAdjacentHTML('beforeend', ${JSON.stringify(BUDDIES)}.map((b) =>
    '<div class="buddy" style="left:' + b.x * ${UP} + 'px;bottom:' + (190 + b.y * ${UP}) + 'px">' +
    avatarHTML(b, { size: Math.round(b.size * ${UP}), mood: 'still' }) + '</div>').join(''))
  window.look = ({ size, clip = 'none', shadow = 'none' }) => {
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
    await win.webContents.executeJavaScript(`look(${JSON.stringify(LOOKS[name])})`)
    await new Promise((r) => setTimeout(r, 600))
    pngs.push((await win.webContents.capturePage({ x: 0, y: 0, width: SIDE, height: SIDE })).resize({ width: SIDE, height: SIDE, quality: 'best' }).toPNG())
  }
  win.destroy()
  return pngs
}

export function cleanUp() {
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  app.whenReady().then(async () => {
    const bleedAt = process.argv.indexOf('--bleed')
    const bleedOut = bleedAt > 1 ? path.resolve(process.argv[bleedAt + 1]) : null
    const [mac, bleed] = await drawIcon('mac', ...(bleedOut ? ['bleed'] : []))
    fs.writeFileSync(path.join(assets, 'icon.png'), mac)
    if (bleedOut) fs.writeFileSync(bleedOut, bleed)

    // macOS .icns: every size resampled from the one drawing (Skia's best filter keeps the tile's edge where it is at
    // 16 and 32px; sips pulls it in), then the built-in iconutil
    const set = path.join(tmp, 'icon.iconset')
    fs.mkdirSync(set)
    const full = nativeImage.createFromBuffer(mac)
    for (const s of [16, 32, 128, 256, 512]) {
      for (const [k, at] of [[1, ''], [2, '@2x']]) {
        const px = s * k
        fs.writeFileSync(path.join(set, `icon_${s}x${s}${at}.png`), px === SIDE ? mac : full.resize({ width: px, height: px, quality: 'best' }).toPNG())
      }
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(assets, 'icon.icns')])
    cleanUp()
    console.log(`wrote assets/icon.png and assets/icon.icns${bleedOut ? ` and ${bleedOut}` : ''}`)
    app.exit(0)
  })
}

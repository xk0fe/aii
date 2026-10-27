// Renders the app icon from the same plush creatures the UI draws: three buddies huddled on a pastel tile.
// Writes assets/icon.png (1024px) and assets/icon.icns. Run: npx electron scripts/make-icon.mjs
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = path.join(root, 'assets')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-icon-'))
app.setPath('userData', path.join(tmp, 'userdata'))

// name + look of each buddy, left to right; the middle one stands in front
const BUDDIES = [
  { name: 'left', size: 520, x: -92, y: -64, avatar: { body: 'blob', color: 'sky', eyes: 'dot', mouth: 'none', hat: 'none', cheeks: true } },
  { name: 'right', size: 520, x: 418, y: -64, avatar: { body: 'mochi', color: 'lime', eyes: 'happy', mouth: 'none', hat: 'none', cheeks: true } },
  { name: 'middle', size: 570, x: 127, y: -48, avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true } },
]

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${path.join(root, 'ui', 'common.css')}">
<style>
  html, body { margin: 0; background: transparent; overflow: hidden; }
  .icon { position: relative; width: 1024px; height: 1024px; }
  .tile { position: absolute; left: 100px; top: 100px; width: 824px; height: 824px; border-radius: 185px; overflow: hidden;
    background: radial-gradient(70% 55% at 50% 100%, rgba(255,255,255,.75), transparent 70%), linear-gradient(160deg, #ffe1f0, #ece3ff 52%, #d6efff);
    box-shadow: 0 22px 44px rgba(20, 10, 40, .28), inset 0 3px 0 rgba(255, 255, 255, .8), inset 0 -6px 18px rgba(120, 90, 160, .12); }
  .buddy { position: absolute; bottom: 0; line-height: 0; }
  .av-z, .av-bang { display: none; }
</style></head><body><div class="icon"><div class="tile"><div id="crew"></div></div></div>
<script src="${path.join(root, 'ui', 'avatar.js')}"></script>
<script>
  document.getElementById('crew').innerHTML = ${JSON.stringify(BUDDIES)}.map((b) =>
    '<div class="buddy" style="left:' + b.x + 'px;bottom:' + b.y + 'px">' + avatarHTML(b, { size: b.size, mood: 'still' }) + '</div>').join('')
</script></body></html>`

app.whenReady().then(async () => {
  const page = path.join(tmp, 'icon.html')
  fs.writeFileSync(page, html)
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, paintWhenInitiallyHidden: true, useContentSize: true })
  await win.loadFile(page)
  await new Promise((r) => setTimeout(r, 600))
  const png = (await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })).resize({ width: 1024, height: 1024 }).toPNG()
  fs.writeFileSync(path.join(assets, 'icon.png'), png)

  // macOS .icns via the built-in sips + iconutil
  const set = path.join(tmp, 'icon.iconset')
  fs.mkdirSync(set)
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), path.join(assets, 'icon.png'), '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), path.join(assets, 'icon.png'), '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(assets, 'icon.icns')])
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('wrote assets/icon.png and assets/icon.icns')
  app.exit(0)
})

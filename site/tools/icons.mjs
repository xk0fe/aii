// Makes the site's icons from the app icon, and the link-preview picture (og.png) from the site itself:
//   assets/favicon.ico (16, 32, 48), assets/icon-192.png (rounded, for browsers), assets/apple-touch-icon.png (180,
//   full bleed: iOS rounds it), assets/og.png (1200 x 630: the icon, the wordmark, the headline and the Crew room).
//
//   desktop/node_modules/.bin/electron site/tools/icons.mjs [--icon icon-1024.png]
//
// --icon is the 1024 artwork without baked corners (default desktop/assets/icon.png). Run it again after a rename
// (the preview shows the wordmark) or a new icon.
import { app, BrowserWindow, nativeImage, nativeTheme } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const site = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const iconFile = path.resolve(args.includes('--icon') ? args[args.indexOf('--icon') + 1] : path.join(site, '../desktop/assets/icon.png'))
const assets = path.join(site, 'assets')

// A PNG of the icon at `size`, its corners rounded like an app icon (or not), drawn by the page's canvas.
async function draw(win, size, rounded) {
  const data = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(nativeImage.createFromPath(iconFile).toDataURL())}; await img.decode()
    const c = document.createElement('canvas'); c.width = c.height = ${size}
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'
    if (${rounded}) { ctx.beginPath(); ctx.roundRect(0, 0, ${size}, ${size}, ${size} * .2237); ctx.clip() }
    ctx.drawImage(img, 0, 0, ${size}, ${size})
    return c.toDataURL('image/png')
  })()`)
  return Buffer.from(data.split(',')[1], 'base64')
}

// An .ico of PNGs (every browser and Windows since Vista reads those)
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach(([size, png], i) => {
    const e = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, e)
    head.writeUInt8(size >= 256 ? 0 : size, e + 1)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(png.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([head, ...pngs.map(([, png]) => png)])
}

app.commandLine.appendSwitch('force-device-scale-factor', '2')
app.whenReady().then(async () => {
  if (nativeImage.createFromPath(iconFile).isEmpty()) {
    console.error(`no icon at ${iconFile}`)
    app.exit(1)
    return
  }
  nativeTheme.themeSource = 'light'
  const win = new BrowserWindow({ show: false, width: 1200, height: 630, useContentSize: true, frame: false, webPreferences: { sandbox: false } })
  await win.loadURL('about:blank')
  fs.writeFileSync(path.join(assets, 'icon-192.png'), await draw(win, 192, true))
  fs.writeFileSync(path.join(assets, 'apple-touch-icon.png'), await draw(win, 180, false))
  fs.writeFileSync(path.join(assets, 'favicon.ico'), ico([[16, await draw(win, 16, true)], [32, await draw(win, 32, true)], [48, await draw(win, 48, true)]]))
  console.log('saved site/assets/icon-192.png, apple-touch-icon.png, favicon.ico')

  // the preview card, drawn by the site's own build
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-og-'))
  execFileSync(process.env.NODE ?? 'node', [path.join(site, 'build.mjs'), '--out', tmp, '--og'], { stdio: 'inherit' })
  await win.loadFile(path.join(tmp, 'og-card.html'))
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 300)))')
  const shot = await win.webContents.capturePage()
  fs.writeFileSync(path.join(assets, 'og.png'), shot.resize({ width: 1200, height: 630, quality: 'best' }).toPNG())
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('saved site/assets/og.png')
  app.quit()
})

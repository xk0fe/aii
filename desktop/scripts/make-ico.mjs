// Writes assets/icon.ico, the Windows icon (the app, its installer, .crew files). The art is make-icon.mjs's, in its
// Windows cut: the tile filling the square without the macOS drop shadow, so it holds up at 16 to 48px.
// Run: npx electron scripts/make-ico.mjs (npm run icon does it after make-icon.mjs)
// Small sizes are plain bitmaps, which everything that reads icons understands; 128 and 256 are PNG, as Windows does it.
import { app, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanUp, drawIcon } from './make-icon.mjs'

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

// 32-bit BGRA, bottom-up, straight alpha, then the 1-bit mask Windows still expects (all zero: alpha decides)
function bitmap(image, size) {
  const px = image.toBitmap() // BGRA, premultiplied
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // colour + mask
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const rows = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = ((size - 1 - y) * size + x) * 4
      const a = px[from + 3]
      for (let c = 0; c < 3; c++) rows[to + c] = a ? Math.min(255, Math.round((px[from + c] * 255) / a)) : 0
      rows[to + 3] = a
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size)
  return Buffer.concat([header, rows, mask])
}

app.whenReady().then(async () => {
  const source = nativeImage.createFromBuffer((await drawIcon('windows'))[0])
  const images = SIZES.map((size) => {
    const image = source.resize({ width: size, height: size, quality: 'best' })
    return { size, data: size >= 128 ? image.toPNG() : bitmap(image, size) }
  })
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2) // icon
  head.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size % 256, 0) // 0 means 256
    e.writeUInt8(size % 256, 1)
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    return e
  })
  fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([head, ...entries, ...images.map((i) => i.data)]))
  cleanUp()
  console.log(`wrote assets/icon.ico (${SIZES.join(', ')} px)`)
  app.exit(0)
})

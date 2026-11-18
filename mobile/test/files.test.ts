// Pictures in the chat: which files the phone draws, what a path on the computer is called, and the bytes the computer
// sends as a data: URI (src/ui/files.ts; the pictures themselves, src/ui/picture.tsx, fetch with the image call).
import { base64, drawable, mimeOf, nameOfPath } from '@/ui/files'

test('the pictures a phone draws, and the files it leaves on the computer', () => {
  for (const name of ['shot.png', 'photo.JPG', 'a.jpeg', 'loop.gif', 'x.webp', 'IMG_0001.HEIC']) expect(drawable(name)).toBe(true)
  for (const name of ['diagram.svg', 'run.mp4', 'page.html', 'notes.pdf', 'README']) expect(drawable(name)).toBe(false)
  expect(mimeOf('photo.JPG')).toBe('image/jpeg')
})

test("a file you attached, by its name rather than the computer's path to it", () => {
  expect(nameOfPath('/Users/you/.clique/attachments/2026-11-17-1a2b3c4d_Q3_plan.pdf')).toBe('Q3_plan.pdf')
  expect(nameOfPath('C:\\Users\\you\\.clique\\attachments\\2026-11-16-aaaaaaaa-shot.png')).toBe('shot.png')
  expect(nameOfPath('/somewhere/else/plain.png')).toBe('plain.png')
})

test('bytes as base64, however many there are', () => {
  expect(base64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('iVBORw==')
  const big = new Uint8Array(100_000).map((_, i) => i % 251)
  expect(Buffer.from(base64(big), 'base64').equals(Buffer.from(big))).toBe(true)
})

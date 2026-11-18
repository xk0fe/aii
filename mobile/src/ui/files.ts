// Files in the chat, in plain TypeScript (no React): which ones the phone draws, what a path on the computer is called,
// and a picture's bytes as a data: URI's base64. ui/picture.tsx shows them.

// What iOS and Android draw from bytes (an SVG they don't)
const DRAWN: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp' }
const extOf = (name: string) => /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
export const drawable = (name: string) => Boolean(DRAWN[extOf(name)])
export const mimeOf = (name: string) => DRAWN[extOf(name)] ?? 'image/png'

// A file you attached on the computer, by its path there: kept as <date>-<id>_<its name> (desktop/core/attachments.js),
// shown by its name.
export const nameOfPath = (p: string) => (String(p).split(/[\\/]/).pop() ?? '').replace(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{6,}[_-]/i, '') || 'file'

// Base64 for a data: URI, a slice at a time (one call with every byte would be too many arguments).
export function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

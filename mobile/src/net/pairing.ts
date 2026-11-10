// Pairing codes as a person hands them over: scanned from the Mac's QR code, or pasted (maybe wrapped onto several
// lines, maybe with the sentence around it). The parsing itself is shared/protocol.js's.
import { APP_NAME } from '../brand'
import { PAIR_PREFIX, readPairCode } from './shared'

export type PairCode = { id: string; name: string; key: Uint8Array; secret: Uint8Array; hosts: string[]; port: number }

export function parsePairCode(input: string): PairCode {
  const text = String(input ?? '')
  const at = text.indexOf(PAIR_PREFIX)
  if (!text.trim()) throw new Error('paste the code your computer shows')
  if (at < 0) throw new Error(`that's not a ${APP_NAME} phone code`)
  // The code runs to the first character that can't be in it. Wrapped onto several lines, it goes on at the start of
  // the next line, up to a line that has something else after it. Whatever comes after the code ("Scan this…", a word
  // on a line of its own) can look like more of it, so the longest version that reads as a code wins.
  const lines = text.slice(at).split(/\r?\n/).map((l) => l.trim())
  const first = lines[0].match(/^cliquephone1\.[A-Za-z0-9_-]+/)?.[0] ?? ''
  const more: string[] = []
  for (let i = 1, whole = first === lines[0]; whole && i < lines.length; i++) {
    const run = lines[i].match(/^[A-Za-z0-9_-]+/)?.[0] ?? ''
    if (!run) break
    more.push(run)
    whole = run === lines[i]
  }
  let error: unknown
  for (let n = more.length; n >= 0; n--) {
    try {
      const c = readPairCode(first + more.slice(0, n).join('')) as PairCode
      if (!c.hosts.length) throw new Error("that code doesn't say where your computer is: make a new one")
      return c
    } catch (e) {
      error ??= e
    }
  }
  throw error
}

// ws://host:port for every way the code says the Mac can be reached (IPv6 addresses go in brackets).
export const urlFor = (host: string, port: number) => `ws://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`

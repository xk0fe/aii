// What an agent attaches to what it says (`clique attach`, Hub.attach): a screenshot, a recording, a page it built, any
// file. The file is copied into CLIque's attachments as it is right then, so the evidence stays as it was when the agent
// showed it, whatever happens to the original. What the chat needs to lay it out without jumping (a picture's size, a
// video's size and length) is read from the file's first bytes here, once. No Electron in here.
//
// A message's `files` are [{ path, name, kind, type, size, w?, h?, dur?, sound? }]: kind is 'image', 'video', 'html' or
// 'file'; sound: whether a recording has any (its player has no volume to offer one that has none).
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { inBracket, pasteable } from './framing.js'

export const FILE_MAX = 100 * 1024 * 1024 // one file
export const FILES_MAX = 10 // one message
// Everything agents have attached, together: past this the oldest of it goes (never what's being attached right now),
// and its card in the chat says the file isn't kept any more.
export const STORE_MAX = 2 * 1024 * 1024 * 1024
// A page runs in the chat only up to this size (it's read whole and written into its frame); a bigger one is a file card.
export const PAGE_MAX = 5 * 1024 * 1024
// What a linked computer or a phone may fetch from here in one piece (Clique.serve readImage, core/remote.js image):
// pictures and pages, never a recording. (A linked computer gets anything, any size, a piece at a time: core/linkfiles.js.)
export const FETCH_MAX = 20 * 1024 * 1024
export const CAPTION_MAX = 2000

const IMAGES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' }
const VIDEOS = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }
const PAGES = { html: 'text/html', htm: 'text/html' }
const OTHERS = {
  pdf: 'application/pdf', txt: 'text/plain', log: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', xml: 'application/xml',
  zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', har: 'application/json', diff: 'text/plain', patch: 'text/plain', yml: 'text/yaml', yaml: 'text/yaml',
}
// What "Open" hands to the system's own app for it: things that are looked at. Anything else (a script, an app, an
// installer) is only ever shown in its folder, since opening it would run it.
const OPENS = new Set([...Object.keys(IMAGES), ...Object.keys(VIDEOS), ...Object.keys(PAGES), 'pdf', 'txt', 'log', 'md', 'json', 'csv', 'xml', 'mp3', 'wav', 'har', 'diff', 'patch', 'yml', 'yaml'])

const extOf = (file) => path.extname(String(file)).slice(1).toLowerCase()
export const opens = (file) => OPENS.has(extOf(file))
export const kindOf = (file) => (Object.hasOwn(IMAGES, extOf(file)) ? 'image' : Object.hasOwn(VIDEOS, extOf(file)) ? 'video' : Object.hasOwn(PAGES, extOf(file)) ? 'html' : 'file')
export const typeOf = (file) => IMAGES[extOf(file)] ?? VIDEOS[extOf(file)] ?? PAGES[extOf(file)] ?? OTHERS[extOf(file)] ?? 'application/octet-stream'

// 1536 -> "1.5 KB", as the chat and `clique attach` say it
export function sizeWords(n) {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) (v /= 1024), u++
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`
}

// 75.4 -> "1:15", 3725 -> "1:02:05"
export function timeWords(s) {
  const n = Math.max(0, Math.round(s))
  const two = (x) => String(x).padStart(2, '0')
  return n >= 3600 ? `${Math.floor(n / 3600)}:${two(Math.floor(n / 60) % 60)}:${two(n % 60)}` : `${Math.floor(n / 60)}:${two(n % 60)}`
}

// ---- a file's size on screen, from its first bytes ---------------------------------------------------------------

function head(file, bytes) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    return buf.subarray(0, fs.readSync(fd, buf, 0, bytes, 0))
  } finally {
    fs.closeSync(fd)
  }
}

const box = (w, h) => (Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1 && w <= 65535 && h <= 65535 ? { w: Math.round(w), h: Math.round(h) } : null)

// -> { w, h } or null (not that kind of picture after all, or one this can't measure: the chat gives it a usual box)
export function imageSize(b, ext) {
  try {
    if (ext === 'png') return b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 ? box(b.readUInt32BE(16), b.readUInt32BE(20)) : null
    if (ext === 'gif') return b.length >= 10 && b.toString('latin1', 0, 3) === 'GIF' ? box(b.readUInt16LE(6), b.readUInt16LE(8)) : null
    if (ext === 'bmp') return b.length >= 26 && b.toString('latin1', 0, 2) === 'BM' ? box(Math.abs(b.readInt32LE(18)), Math.abs(b.readInt32LE(22))) : null
    if (ext === 'jpg' || ext === 'jpeg') {
      if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
      for (let i = 2; i + 9 < b.length; ) {
        if (b[i] !== 0xff) return null
        const m = b[i + 1]
        if (m === 0xff) {
          i++
          continue
        }
        // a start-of-frame marker holds the size (not C4, C8, CC: tables)
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return box(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5))
        i += 2 + b.readUInt16BE(i + 2)
      }
      return null
    }
    if (ext === 'webp') {
      if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null
      const kind = b.toString('latin1', 12, 16)
      if (kind === 'VP8X') return box(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3))
      if (kind === 'VP8 ') return box(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
      if (kind === 'VP8L') {
        const n = b.readUInt32LE(21)
        return box(1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff))
      }
      return null
    }
    if (ext === 'svg') {
      const tag = /<svg\b[^>]*>/i.exec(b.toString('utf8'))?.[0]
      if (!tag) return null
      const attr = (name) => parseFloat(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)(?:px)?\\s*["']`, 'i').exec(tag)?.[1])
      const view = /\sviewBox\s*=\s*["']\s*[-0-9.e]+[\s,]+[-0-9.e]+[\s,]+([0-9.e]+)[\s,]+([0-9.e]+)\s*["']/i.exec(tag)
      return box(attr('width'), attr('height')) ?? (view ? box(parseFloat(view[1]), parseFloat(view[2])) : { w: 300, h: 150 })
    }
  } catch {}
  return null
}

// MP4 and QuickTime: the boxes at the top are walked for `moov`, wherever it is in the file (after the pictures, when the
// file wasn't made for streaming), and inside it the movie's length, its video track's size and whether it has a sound
// track. -> { w?, h?, dur?, sound? } or null
function mp4Info(file, size) {
  const fd = fs.openSync(file, 'r')
  try {
    const hdr = Buffer.alloc(16)
    let at = 0
    let seen = false
    for (let n = 0; n < 200 && at + 8 <= size; n++) {
      if (fs.readSync(fd, hdr, 0, 16, at) < 8) break
      let len = hdr.readUInt32BE(0)
      const type = hdr.toString('latin1', 4, 8)
      let skip = 8
      if (len === 1) (len = Number(hdr.readBigUInt64BE(8))), (skip = 16)
      else if (len === 0) len = size - at
      if (len < skip) break
      if (type === 'ftyp' || type === 'mdat' || type === 'free' || type === 'wide' || type === 'moov') seen = true
      if (type === 'moov') {
        const moov = Buffer.alloc(Math.min(len - skip, 8 * 1024 * 1024))
        fs.readSync(fd, moov, 0, moov.length, at + skip)
        return moovInfo(moov)
      }
      at += len
    }
    return seen ? {} : null
  } catch {
    return null
  } finally {
    fs.closeSync(fd)
  }
}

function* boxes(b) {
  for (let at = 0; at + 8 <= b.length; ) {
    const len = b.readUInt32BE(at)
    if (len < 8 || at + len > b.length) return
    yield { type: b.toString('latin1', at + 4, at + 8), data: b.subarray(at + 8, at + len) }
    at += len
  }
}

function moovInfo(moov) {
  const out = {}
  let tracks = 0
  let sound = false
  for (const b of boxes(moov)) {
    if (b.type === 'mvhd') {
      const v1 = b.data[0] === 1
      const scale = b.data.readUInt32BE(v1 ? 20 : 12)
      const dur = v1 ? Number(b.data.readBigUInt64BE(24)) : b.data.readUInt32BE(16)
      if (scale > 0 && dur > 0 && dur / scale < 86400 * 7) out.dur = Math.round((dur / scale) * 100) / 100
    }
    if (b.type !== 'trak') continue
    tracks++
    let size = null
    let video = false
    for (const t of boxes(b.data)) {
      if (t.type === 'tkhd') {
        const d = t.data
        const end = d[0] === 1 ? 96 : 84
        if (d.length < end) continue
        // (a track turned on its side says so in its matrix: its b and c, with a and d at nought)
        const turned = d.readInt32BE(end - 44 + 4) !== 0 && d.readInt32BE(end - 44) === 0
        const w = d.readUInt32BE(end - 8) / 65536
        const h = d.readUInt32BE(end - 4) / 65536
        size = turned ? box(h, w) : box(w, h)
      }
      if (t.type === 'mdia') {
        for (const m of boxes(t.data)) {
          if (m.type !== 'hdlr') continue
          if (m.data.toString('latin1', 8, 12) === 'vide') video = true
          if (m.data.toString('latin1', 8, 12) === 'soun') sound = true
        }
      }
    }
    if (video && size && !out.w) Object.assign(out, size)
  }
  if (tracks) out.sound = sound
  return out
}

// WebM (and Matroska): its elements, walked as far as the tracks. -> { w?, h?, dur?, sound? } or null
function webmInfo(b) {
  if (b.length < 4 || b.readUInt32BE(0) !== 0x1a45dfa3) return null
  const out = {}
  let scale = 1000000
  let ticks = 0
  let tracks = 0
  let sound = false
  const vint = (at, keep) => {
    const first = b[at]
    if (first === undefined || first === 0) return null
    let len = 1
    while (!(first & (0x80 >> (len - 1)))) len++
    if (at + len > b.length) return null
    let v = keep ? first : first & (0xff >> len)
    for (let i = 1; i < len; i++) v = v * 256 + b[at + i]
    return { v, len }
  }
  const INTO = new Set([0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0]) // Segment, Info, Tracks, TrackEntry, Video
  const walk = (at, end, depth) => {
    while (at < end && at < b.length) {
      const id = vint(at, true)
      if (!id) return
      const size = vint(at + id.len)
      if (!size) return
      const from = at + id.len + size.len
      const unknown = size.v === 2 ** (7 * size.len) - 1 // a live recording: "until the end"
      const to = unknown ? end : Math.min(from + size.v, end)
      if (INTO.has(id.v) && depth < 6) walk(from, to, depth + 1)
      else if (id.v === 0x1f43b675) return // the pictures start here: nothing more to learn
      else if (from + size.v <= b.length) {
        const uint = () => b.readUIntBE(from, Math.min(size.v, 6))
        if (id.v === 0x2ad7b1) scale = uint()
        if (id.v === 0x4489) ticks = size.v === 4 ? b.readFloatBE(from) : size.v === 8 ? b.readDoubleBE(from) : 0
        if (id.v === 0xb0 && !out.w) out.w = uint()
        if (id.v === 0xba && !out.h) out.h = uint()
        if (id.v === 0x83) (tracks++, (sound ||= uint() === 2)) // a track's type: 1 pictures, 2 sound
      }
      at = to
    }
  }
  try {
    walk(0, b.length, 0)
  } catch {}
  const size = box(out.w, out.h)
  const dur = (ticks * scale) / 1e9
  return { ...(size ?? {}), ...(dur > 0 && dur < 86400 * 7 && { dur: Math.round(dur * 100) / 100 }), ...(tracks > 0 && { sound }) }
}

// What the chat shows a file as, and what it needs to draw it. One that says it's a picture or a video and isn't is a
// plain file.
export function probe(file, size = fs.statSync(file).size) {
  const ext = extOf(file)
  let kind = kindOf(file)
  let more = {}
  if (kind === 'image') {
    const dims = imageSize(head(file, ext === 'svg' ? 64 * 1024 : 512 * 1024), ext)
    if (dims) more = dims
    else if (ext !== 'avif') kind = 'file' // (an AVIF isn't measured here: it's shown in a usual box)
  } else if (kind === 'video') {
    const info = ext === 'webm' ? webmInfo(head(file, 1024 * 1024)) : mp4Info(file, size)
    if (info) more = info
    else kind = 'file'
  } else if (kind === 'html' && size > PAGE_MAX) kind = 'file'
  return { kind, type: kind === 'file' && kindOf(file) !== 'file' ? 'application/octet-stream' : typeOf(file), ...more }
}

// ---- the store ---------------------------------------------------------------------------------------------------

// What an agent attached is kept as <day>-<8 hex>-<its own name>: the name it had, so Finder, Explorer and "Open" show
// something you'd recognise, made safe for any disk. (What you attach yourself is <day>-<8 hex>.<ext>: Hub saveImage.)
const AGENTS_FILE = /^\d{4}-\d\d-\d\d-[0-9a-f]{8}-./
export const isAgentFile = (name) => AGENTS_FILE.test(path.basename(String(name)))
export function safeName(name) {
  const ext = path.extname(name).replace(/[^A-Za-z0-9.]/g, '').slice(0, 12)
  const stem = path.basename(name, path.extname(name)).normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 60)
  return `${stem || 'file'}${ext.toLowerCase()}`
}

// A file's name as the chat, a phone and other agents' CLIs get it. A name is anybody's text (a download, a page's
// title): no line breaks, escape sequences or other control characters in it, which typed into a terminal could end a
// paste early (core/framing.js pasteable), and not endless.
export const shownName = (name) => pasteable(name).replace(/\s+/g, ' ').trim().slice(0, 120) || 'file'

// A file by the name an agent gave: as typed when it's a whole path, else in the folder the agent ran `clique` in.
// (Git Bash on Windows says C:\Users\you as /c/Users/you, and bin/clique passes on what it's given.)
export function resolveIn(cwd, name, { platform = process.platform, p = platform === 'win32' ? path.win32 : path } = {}) {
  const native = (x) => (platform === 'win32' ? String(x).replace(/^\/([A-Za-z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`) : String(x))
  name = native(name)
  return p.isAbsolute(name) ? p.normalize(name) : p.resolve(native(cwd) || process.cwd(), name)
}

// Looks at what an agent wants to attach, before anything is copied: all of it goes, or none of it. -> [{ from, name, size }]
export function check(names, cwd) {
  if (!names.length) throw new Error(ATTACH_USAGE)
  if (names.length > FILES_MAX) throw new Error(`not attached: a message holds ${FILES_MAX} files at most, and that's ${names.length}. Pick the ones that show it best, or send two messages.`)
  return names.map((name) => {
    const from = resolveIn(cwd, name)
    let stat
    try {
      stat = fs.statSync(from)
    } catch {
      throw new Error(`not attached: there's no file ${from}${path.isAbsolute(name) ? '' : ` (looked in ${cwd || process.cwd()}: give the whole path if it's elsewhere)`}`)
    }
    if (stat.isDirectory()) throw new Error(`not attached: ${from} is a folder. Attach the files in it, or zip it.`)
    if (!stat.isFile()) throw new Error(`not attached: ${from} isn't a file`)
    if (!stat.size) throw new Error(`not attached: ${from} is empty`)
    if (stat.size > FILE_MAX) throw new Error(`not attached: ${path.basename(from)} is ${sizeWords(stat.size)}, and a file can be ${sizeWords(FILE_MAX)} at most. Make it smaller (a shorter clip, a lower resolution) and attach that.`)
    return { from, name: path.basename(from), size: stat.size }
  })
}

// Copies them into `dir` (CLIque's attachments). -> the message's files. If one can't be copied, the ones before it go
// again and the error is thrown.
export async function store(files, dir, { now = new Date() } = {}) {
  await fs.promises.mkdir(dir, { recursive: true })
  const out = []
  try {
    for (const f of files) {
      const to = path.join(dir, `${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}-${safeName(f.name)}`)
      await fs.promises.copyFile(f.from, to)
      out.push({ path: to })
      const size = (await fs.promises.stat(to)).size
      Object.assign(out.at(-1), { name: shownName(f.name), ...probe(to, size), size })
    }
  } catch (e) {
    for (const f of out) fs.rmSync(f.path, { force: true })
    throw new Error(`not attached: ${e.message}`)
  }
  return out
}

// Keeps what agents attached under `max` bytes: the oldest of it goes first, never `keep` (paths: what was just
// attached). -> how many went.
export function makeRoom(dir, { max = STORE_MAX, keep = [] } = {}) {
  let files = []
  try {
    files = fs.readdirSync(dir).filter(isAgentFile).map((name) => {
      const file = path.join(dir, name)
      const s = fs.statSync(file, { throwIfNoEntry: false })
      return s?.isFile() ? { file, size: s.size, at: s.mtimeMs } : null
    }).filter(Boolean)
  } catch {
    return 0
  }
  let total = files.reduce((n, f) => n + f.size, 0)
  const held = new Set(keep.map((p) => path.resolve(p)))
  let gone = 0
  for (const f of files.sort((a, b) => a.at - b.at)) {
    if (total <= max) break
    if (held.has(path.resolve(f.file))) continue
    try {
      fs.rmSync(f.file, { force: true })
      total -= f.size
      gone++
    } catch {}
  }
  return gone
}

// ---- what other devices get --------------------------------------------------------------------------------------

// A picture or a page small enough to bring to a linked computer as soon as it's seen there; a recording, or any other
// file, comes when it's played or opened (core/linkfiles.js), and stays where it is for a computer that can't ask for it
// a piece at a time.
export const travels = (f) => (f.kind === 'image' || f.kind === 'html') && f.size <= FETCH_MAX

// A message with files, as a phone gets it (shared/PROTOCOL.md): what each file is, never where it is or what's in it.
// `text` also says what's attached, in words, for a phone from before files; `caption` is the message alone.
export function forPhone(e) {
  if (!e.files?.length) return e
  const files = e.files.map(({ name, kind, size, w, h, dur }) => ({ name, kind, size, ...(w && h && { w, h }), ...(dur && { dur }) }))
  const said = `Attached ${files.length === 1 ? files[0].name : `${files.length} files`} (on the computer)`
  return { ...e, files, caption: e.text ?? '', text: e.text ? `${e.text}\n\n${said}` : said }
}

// A message's files in a few words, for one of CLIque's brackets in an agent's CLI ("replying to … (with shot.png and 2
// more files)"): the names can't close the bracket they're in or pass for one of CLIque's own (core/framing.js).
export function filesInBracket(files) {
  if (!files?.length) return ''
  const first = inBracket(shownName(files[0].name)).slice(0, 60)
  return files.length === 1 ? first : `${first} and ${files.length - 1} more file${files.length === 2 ? '' : 's'}`
}

export const ATTACH_USAGE = `usage: clique attach <file> ... [--caption "what it shows"]
Shows files in the chat, where you're working: a screenshot, a recording, a page, a log.
  images (png jpg gif webp svg)   shown in the message; the user clicks to look closer
  video (mp4 webm mov)            plays in the message
  a page (html)                   runs in the message, in a sandbox with no network and no other files:
                                  make it one self-contained file (inline its CSS, scripts and images)
  anything else                   a file card the user can open
Up to ${FILES_MAX} files a message, ${sizeWords(FILE_MAX)} each. The files are copied as they are now.`

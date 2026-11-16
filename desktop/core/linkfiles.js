// A linked computer's files, here: a recording, a picture, a page or any other file an agent attached there (or an
// image you sent from there) is read from that computer a piece at a time, as the chat needs it, and kept in this
// computer's cache of it. So a recording starts playing as soon as its first piece is here and you can jump to any
// moment of it, and a file of any size can be opened. No Electron in here.
//
//   over CLIque Link   readFile(file, start, length) -> { size, bytes }: at most PIECE bytes of one of that computer's
//                      attachments (readPiece, Clique.serve). A message on the link carries one piece, never a whole file.
//   in the cache       <file>.part holds the pieces that are here, at their places in the file, and <file>.part.json
//                      says which those are, so what was fetched is still here after a restart. With every piece here
//                      it becomes <file>: a whole file like any other (Open, Show in Finder, the phone's pictures).
//   to the chat        clique-file://f/?p=<the file in the cache>: answered like a web server that takes ranges
//                      (serveFiles), from the cache when the file is whole and from the other computer when it isn't.
//                      The app's pages load every linked file through it, so nothing shows as broken while it's on its way.
//
// A computer on a CLIque from before this has no readFile: a picture or a page is asked for whole, as before
// (readImage), and anything else stays there (LinkFiles.old, which the chat's cards say).
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { kindOf, typeOf } from './attachments.js'

export const SCHEME = 'clique-file'
// One piece. A link's message can be 32 MB and bytes travel as base64; this keeps what else the link carries (terminals,
// the chat) moving between pieces, and a recording starts after one of them.
export const PIECE = 1024 * 1024
// The biggest file fetched: an attachment is 100 MB at most (core/attachments.js FILE_MAX), an image you sent less.
export const SIZE_MAX = 1024 * 1024 * 1024
// A computer's cache, together: past this the files fetched longest ago go (they're fetched again when they're shown).
export const CACHE_MAX = 2 * 1024 * 1024 * 1024

// Why a file can't be had: 'away' (its computer isn't connected), 'gone' (not kept there any more), 'old' (that computer's
// CLIque can't send pieces), 'big', or 'failed'.
const fail = (code, message) => Object.assign(new Error(message), { why: code })
export const whyOf = (e) => e?.why ?? 'failed'

const real = (p) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}
// Where a path really is, wherever links and `..` lead. One that isn't there yet (a linked computer's file, not
// fetched; the cache itself, before anything was) is where the nearest folder of it that exists really is.
function really(p) {
  let at = path.resolve(String(p ?? ''))
  const rest = []
  while (!real(at)) {
    const up = path.dirname(at)
    if (up === at) return null
    rest.unshift(path.basename(at))
    at = up
  }
  return path.join(real(at), ...rest)
}
// `file`, if it's in one of `dirs`; null if not.
export function inside(file, dirs) {
  const at = really(file)
  return at && dirs.some((d) => really(d) && at.startsWith(really(d) + path.sep)) ? at : null
}

// ---- the computer the file is on ---------------------------------------------------------------------------------

// What a linked computer asks for: up to PIECE bytes of one of `dir`'s files, from `start`. -> { size, bytes }
export function readPiece(dir, file, start = 0, length = PIECE) {
  const at = file && inside(file, [dir])
  if (!at) throw new Error('not an attachment')
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 0) throw new Error('not a part of a file')
  let fd
  try {
    fd = fs.openSync(at, 'r')
  } catch {
    throw new Error('that file is gone')
  }
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) throw new Error('not an attachment')
    const buf = Buffer.alloc(Math.max(0, Math.min(length, PIECE, stat.size - start)))
    const n = buf.length ? fs.readSync(fd, buf, 0, buf.length, start) : 0
    return { size: stat.size, bytes: new Uint8Array(buf.buffer, buf.byteOffset, n) }
  } finally {
    fs.closeSync(fd)
  }
}

// ---- the computer that shows it ----------------------------------------------------------------------------------

// One file on its way: which pieces are here, and the ones being asked for.
class Fetch {
  size = null
  have = null // a bit per piece
  count = 0
  got = 0 // bytes here
  fd = null
  done = false
  asked = new Map() // piece -> its promise

  constructor(files, file, { slug, hostPath }) {
    Object.assign(this, { files, file, slug, hostPath, part: `${file}.part`, map: `${file}.part.json` })
    // what an earlier run fetched of it
    try {
      const saved = JSON.parse(fs.readFileSync(this.map, 'utf8'))
      const have = Buffer.from(String(saved.have), 'base64')
      if (Number.isInteger(saved.size) && saved.size > 0 && saved.size <= SIZE_MAX && have.length === Math.ceil(Math.ceil(saved.size / PIECE) / 8) && fs.statSync(this.part).size <= saved.size) {
        this.fd = fs.openSync(this.part, 'r+')
        this.size = saved.size
        this.count = Math.ceil(saved.size / PIECE)
        this.have = new Uint8Array(have)
        for (let i = 0; i < this.count; i++) if (this.has(i)) this.got += this.length(i)
      }
    } catch {}
  }

  has(i) {
    return Boolean(this.have && this.have[i >> 3] & (1 << (i & 7)))
  }

  length(i) {
    return Math.min(PIECE, this.size - i * PIECE)
  }

  // A file of `size` bytes, none of it here yet.
  begin(size) {
    if (!Number.isInteger(size) || size < 0) throw fail('failed', `${this.files.nameOf(this.slug)} sent something that isn't a file`)
    if (size > SIZE_MAX) throw fail('big', "That file is too big to bring here: open it on the computer it's on.")
    if (this.fd !== null) fs.closeSync(this.fd)
    fs.mkdirSync(path.dirname(this.part), { recursive: true })
    this.fd = fs.openSync(this.part, 'w+')
    this.size = size
    this.count = Math.ceil(size / PIECE)
    this.have = new Uint8Array(Math.ceil(this.count / 8))
    this.got = 0
  }

  // Piece `i`, here: at once if it is, else once it has come (asked for once, however many want it).
  piece(i) {
    if (this.done || this.has(i)) return Promise.resolve()
    let p = this.asked.get(i)
    if (!p) {
      p = this.ask(i).finally(() => this.asked.delete(i))
      this.asked.set(i, p)
    }
    return p
  }

  async ask(i) {
    const peer = this.files.peer(this.slug)
    if (!peer) throw fail('away', `${this.files.nameOf(this.slug)} is away`)
    let res
    try {
      res = await peer.call('readFile', [this.hostPath, i * PIECE, PIECE])
    } catch (e) {
      if (/"readFile" isn't available/.test(e.message)) return this.asWhole(peer)
      if (/is gone|not an attachment|no such file|ENOENT/.test(e.message)) throw fail('gone', "That file isn't kept any more.")
      if (/connect|took too long/.test(e.message)) throw fail('away', `${this.files.nameOf(this.slug)} is away`)
      throw fail('failed', e.message)
    }
    if (this.done) return
    if (!res || !(res.bytes instanceof Uint8Array)) throw fail('failed', `${this.files.nameOf(this.slug)} sent something that isn't a file`)
    if (res.size !== this.size) this.begin(res.size) // the first piece, or a file that changed: from the start
    if (!this.size) return this.finish()
    if (i >= this.count) return // (asked past its end, before its size was known)
    if (res.bytes.length !== this.length(i)) throw fail('failed', `${this.files.nameOf(this.slug)} sent a piece of the wrong size`)
    if (this.has(i)) return
    fs.writeSync(this.fd, res.bytes, 0, res.bytes.length, i * PIECE)
    this.have[i >> 3] |= 1 << (i & 7)
    this.got += res.bytes.length
    if (this.got >= this.size) return this.finish()
    fs.writeFileSync(this.map, JSON.stringify({ size: this.size, have: Buffer.from(this.have).toString('base64') }))
    this.files.emit('progress', this.file, this.got, this.size)
  }

  // From a computer whose CLIque sends no pieces: a picture or a page, whole, as it always did. Anything else stays there.
  async asWhole(peer) {
    this.files.old.add(this.slug)
    let bytes
    try {
      bytes = await peer.call('readImage', [this.hostPath])
    } catch (e) {
      if (/not an attachment|ENOENT|no such file/.test(e.message)) throw fail('gone', "That file isn't kept any more.")
      throw fail('old', `${this.files.nameOf(this.slug)} runs an older CLIque, which can't send this file. Update it there, or open the file on that computer.`)
    } finally {
      this.files.emit('old', this.slug)
    }
    if (this.done) return
    if (!(bytes instanceof Uint8Array)) throw fail('failed', `${this.files.nameOf(this.slug)} sent something that isn't a file`)
    this.begin(bytes.length)
    if (bytes.length) fs.writeSync(this.fd, bytes, 0, bytes.length, 0)
    this.got = this.size
    this.finish()
  }

  // Every piece is here: it's a file like any other now.
  finish() {
    if (this.done) return
    if (this.fd !== null) fs.closeSync(this.fd)
    this.fd = null
    try {
      fs.renameSync(this.part, this.file)
    } catch (e) {
      // (its pieces were taken from under it: swept as old, or the cache was cleared by hand. From the start next time.)
      this.size = this.have = null
      this.count = this.got = 0
      throw fail('failed', `It couldn't be kept here: ${e.message}`)
    }
    this.done = true
    fs.rmSync(this.map, { force: true })
    this.files.fetches.delete(this.file)
    this.files.failed.delete(this.file)
    this.files.emit('progress', this.file, this.size, this.size)
    this.files.emit('done', this.file)
    this.files.makeRoom(path.dirname(this.file), this.file)
  }

  // Its size, asking for the piece `start` is in if nothing of it is here yet (which says it).
  async sized(start = 0) {
    if (this.size === null) await this.piece(Math.floor(start / PIECE))
    return this.size
  }

  // Bytes start..end (end not included) of it, once they're here. The piece after them is asked for too, so what plays
  // next is on its way before it's wanted.
  async read(start, end) {
    await this.sized(start)
    end = Math.min(end, this.size)
    if (start >= end) return Buffer.alloc(0)
    const last = Math.floor((end - 1) / PIECE)
    const first = Math.floor(start / PIECE)
    const need = []
    for (let i = first; i <= last; i++) need.push(this.piece(i))
    await Promise.all(need)
    // (the file was replaced on its computer while these came: what's here now is the new one's, from its start)
    for (let i = first; i <= last && !this.done; i++) if (!this.has(i)) throw fail('failed', 'That file changed while it was coming. Try again.')
    if (!this.done && last + 1 < this.count) this.piece(last + 1).catch(() => {})
    const buf = Buffer.alloc(end - start)
    const fd = this.done ? fs.openSync(this.file, 'r') : this.fd
    try {
      fs.readSync(fd, buf, 0, buf.length, start)
    } finally {
      if (this.done) fs.closeSync(fd)
    }
    return buf
  }

  // All of it, a few pieces at a time. (Once more from the start, if the file was replaced on its computer meanwhile.)
  async whole() {
    await this.sized(0)
    for (let round = 0; !this.done; round++) {
      if (round > 2) throw fail('failed', 'That file keeps changing on its computer.')
      let next = 0
      const lane = async () => {
        while (!this.done && next < this.count) await this.piece(next++)
      }
      await Promise.all([lane(), lane(), lane()])
    }
  }
}

// peer(slug) -> the live connection to that computer (a core/link.js Peer), or null while it's away. name(slug) -> what
// it's called. Emits 'progress' (file, bytes here, bytes in all), 'done' (file), 'old' (slug), and 'failed' (file, why)
// when a page asked for one that couldn't be had: a player waiting on it says why at once, where Chromium by itself
// would go on asking for half a minute before it gave up.
export class LinkFiles extends EventEmitter {
  theirs = new Map() // file in the cache -> { slug, hostPath }: whose it is, and where it is there
  fetches = new Map() // file in the cache -> its Fetch, while it's on its way
  failed = new Map() // file in the cache -> { why, at }: the last try that didn't work
  old = new Set() // computers (slugs) whose CLIque sends no pieces

  constructor({ cache, peer, name = (slug) => slug, max = CACHE_MAX }) {
    super()
    Object.assign(this, { cache, peer, nameOf: name, max })
  }

  // Where a linked computer's file is kept here: the same place every time, under that computer's name.
  place(slug, hostPath) {
    const file = path.join(this.cache, slug, crypto.createHash('sha1').update(String(hostPath)).digest('hex').slice(0, 20) + path.extname(String(hostPath)).toLowerCase().replace(/[^a-z0-9.]/g, ''))
    this.theirs.set(file, { slug, hostPath: String(hostPath) })
    return file
  }

  has(file) {
    return fs.existsSync(file)
  }

  fetchOf(file) {
    let f = this.fetches.get(file)
    if (f) return f
    const whose = this.theirs.get(file)
    if (!whose) return null
    f = new Fetch(this, file, whose)
    this.fetches.set(file, f)
    return f
  }

  // The whole file, here. -> the file. Throws with why it can't be (whyOf).
  async whole(file) {
    if (this.has(file)) return file
    const f = this.fetchOf(file)
    if (!f) throw fail('gone', "That file isn't kept any more.")
    try {
      await f.whole()
    } catch (e) {
      this.failed.set(file, { why: whyOf(e), at: Date.now() })
      throw e
    }
    return file
  }

  // The same, for a file that's about to be shown (a picture, a page): quietly, and not asked again right after it
  // couldn't be had (every change in the clique comes by here).
  want(file) {
    if (this.has(file) || !this.theirs.has(file)) return
    const { slug } = this.theirs.get(file)
    if (!this.peer(slug)) return
    const last = this.failed.get(file)
    if (last && (last.why === 'gone' || last.why === 'old' || last.why === 'big' || Date.now() - last.at < 30000)) return
    this.whole(file).catch(() => {})
  }

  // A page asked for one and it couldn't be had.
  fail(file, e) {
    this.failed.set(file, { why: whyOf(e), at: Date.now() })
    this.emit('failed', file, whyOf(e), e?.message ?? '')
  }

  // A computer is connected again: what couldn't be had while it was away can be asked for once more.
  back(slug) {
    for (const [file, last] of this.failed) if (this.theirs.get(file)?.slug === slug && last.why !== 'gone') this.failed.delete(file)
  }

  // What the chat needs to say about one: { here, have, size, why, computer }
  state(file) {
    const whose = this.theirs.get(file)
    if (this.has(file)) return { here: true, computer: whose ? this.nameOf(whose.slug) : null }
    if (!whose) return { here: false, why: 'gone', computer: null }
    const f = this.fetches.get(file)
    const why = !this.peer(whose.slug) ? 'away' : this.old.has(whose.slug) && kindOf(file) !== 'image' && kindOf(file) !== 'html' ? 'old' : (this.failed.get(file)?.why ?? null)
    return { here: false, have: f?.got ?? 0, size: f?.size ?? null, why, computer: this.nameOf(whose.slug) }
  }

  // Keeps a computer's cache under `max` bytes: the files fetched longest ago go first, never `keep` (just fetched) or
  // one that's on its way.
  makeRoom(dir, keep) {
    let files = []
    try {
      files = fs.readdirSync(dir).map((name) => {
        const file = path.join(dir, name)
        const s = fs.statSync(file, { throwIfNoEntry: false })
        return s?.isFile() ? { file, size: s.size, at: s.mtimeMs } : null
      }).filter(Boolean)
    } catch {
      return 0
    }
    let total = files.reduce((n, f) => n + f.size, 0)
    let gone = 0
    for (const f of files.sort((a, b) => a.at - b.at)) {
      if (total <= this.max) break
      const whole = f.file.replace(/\.part(\.json)?$/, '')
      if (f.file === keep || this.fetches.has(whole)) continue
      try {
        fs.rmSync(f.file, { force: true })
        total -= f.size
        gone++
      } catch {}
    }
    return gone
  }
}

// ---- the scheme the chat loads them through ----------------------------------------------------------------------

export const fileURL = (file) => `${SCHEME}://f/?p=${encodeURIComponent(file)}`

// "bytes=0-", "bytes=100-199", "bytes=-500" -> { start, end } (end not included), null for none, false for one that
// can't be answered.
export function rangeOf(header, size) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!m || (!m[1] && !m[2])) return false
  if (!m[1]) return { start: Math.max(0, size - Number(m[2])), end: size }
  const start = Number(m[1])
  if (start >= size) return false
  return { start, end: m[2] ? Math.min(size, Number(m[2]) + 1) : size }
}

const STATUS = { away: 503, gone: 404, old: 501, big: 413, failed: 502 }
// Nothing this scheme answers with is ever a document: no scripts, no frames, nothing fetched, whatever asks for it.
const SHUT = { 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }

// A request's answer: a Response. Only a file in one of `dirs` (CLIque's attachments, its cache of linked computers'
// files), wherever links and `..` lead, and never a page (that runs in the sandbox only: core/sandbox.js). A file that
// isn't here yet is one of a linked computer's (`files`: a LinkFiles): its bytes come as they're asked for.
export async function answerFile(request, { dirs, files }) {
  const plain = (status, why = '') => new Response(null, { status, headers: { ...SHUT, ...(why && { 'x-clique-why': why }) } })
  let file
  try {
    file = inside(new URL(request.url).searchParams.get('p'), dirs)
  } catch {}
  if (!file) return plain(404, 'gone')
  if (kindOf(file) === 'html') return plain(403)
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405)
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  if (stat && !stat.isFile()) return plain(404, 'gone')
  const fetch = stat ? null : files?.fetchOf(file)
  if (!stat && !fetch) return plain(404, 'gone')
  const asked = request.headers.get('range')
  let size
  try {
    // (the piece the range starts in says how big the file is, when nothing of it is here yet)
    size = stat ? stat.size : await fetch.sized(Number(/^bytes=(\d+)-/.exec(asked ?? '')?.[1] ?? 0))
  } catch (e) {
    files.fail(file, e)
    return plain(STATUS[whyOf(e)] ?? 502, whyOf(e))
  }
  const range = rangeOf(asked, size)
  if (range === false) return new Response(null, { status: 416, headers: { ...SHUT, 'content-range': `bytes */${size}` } })
  const { start, end } = range ?? { start: 0, end: size }
  const headers = { ...SHUT, 'content-type': typeOf(file), 'accept-ranges': 'bytes', 'content-length': String(end - start), ...(range && { 'content-range': `bytes ${start}-${end - 1}/${size}` }) }
  if (request.method === 'HEAD' || end === start) return new Response(null, { status: range ? 206 : 200, headers })
  let body
  if (stat || fetch.done) body = Readable.toWeb(fs.createReadStream(file, { start, end: end - 1 }))
  else {
    let at = start
    let stopped = false // the page stopped asking: it has what it wanted of this stretch, or went elsewhere in the file
    body = new ReadableStream({
      async pull(controller) {
        // (up to the end of the piece it's in: one piece is asked for at a time, as it's wanted)
        const to = Math.min(end, (Math.floor(at / PIECE) + 1) * PIECE)
        let bytes
        try {
          bytes = await fetch.read(at, to)
        } catch (e) {
          if (stopped) return
          files.fail(file, e)
          return controller.error(e)
        }
        if (stopped) return
        at = to
        try {
          controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length))
          if (at >= end) controller.close()
        } catch {} // (stopped between the two)
      },
      cancel() {
        stopped = true
      },
    }, { highWaterMark: 0 })
  }
  return new Response(body, { status: range ? 206 : 200, headers })
}

// Electron's side (main.js, and the probes, which show the same thing). The scheme is named before the app is ready
// (protocol.registerSchemesAsPrivileged([FILES_SCHEME])): `stream` and `standard` are what let a <video> play from it and
// seek in it (without `standard`, Chromium's player asks for the file's end and then gives up on it).
export const FILES_SCHEME = { scheme: SCHEME, privileges: { stream: true, standard: true } }
export function serveFiles(protocol, options) {
  protocol.handle(SCHEME, (request) => answerFile(request, options).catch(() => new Response(null, { status: 500, headers: SHUT })))
}

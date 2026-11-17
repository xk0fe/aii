// A linked computer's files, here: a recording, a picture, a page or any other file an agent attached there (or an
// image you sent from there) is read from that computer a piece at a time, as the chat needs it, and kept in this
// computer's cache of it. So a recording starts playing as soon as its first piece is here and you can jump to any
// moment of it, and a file of any size can be opened. No Electron in here.
//
//   over CLIque Link   readFile(file, start, length) -> { size, bytes }: at most PIECE bytes of one of that computer's
//                      attachments (readPiece, Clique.serve). A message on the link carries one piece, never a whole file.
//   in the cache       <file>.part holds the pieces that are here, at their places in the file, and <file>.part.json
//                      says which those are, with a checksum of each, so what was fetched is still here after a
//                      restart (a piece is only believed once it's been read and matches its checksum). With every
//                      piece here it becomes <file>: a whole file like any other (Open, Show in Finder, the phone's
//                      pictures).
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
import zlib from 'node:zlib'
import { kindOf, typeOf } from './attachments.js'

export const SCHEME = 'clique-file'
// One piece. A link's message can be 32 MB and bytes travel as base64; this keeps what else the link carries (terminals,
// the chat) moving between pieces, and a recording starts after one of them.
export const PIECE = 1024 * 1024
// The biggest file fetched: an attachment is 100 MB at most (core/attachments.js FILE_MAX), an image you sent less.
export const SIZE_MAX = 1024 * 1024 * 1024
// A computer's cache, together: past this the files used longest ago go (they're fetched again when they're shown).
export const CACHE_MAX = 2 * 1024 * 1024 * 1024
// ...and one that went isn't brought back by itself for this long, so two that don't both fit don't take turns for ever.
const ROOM_REST = 60000

// What a computer on a CLIque from before pieces answers readFile with: it has no such call. (Asked with no workspace
// in hand, as this is, it says so its own way: that the asker is the newer one.)
export const NO_PIECES = /"readFile" isn't available|runs a newer CLIque/

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
  done = false
  dropped = false // let go to make room: whatever still holds this one asks LinkFiles again (there may be a new one)
  sums = [] // each piece's checksum, as it came
  unsure = new Set() // pieces an earlier run says are here: read and checked before they're believed
  asked = new Map() // piece -> its promise
  used = Date.now() // when something last read it or a piece of it came

  constructor(files, file, { slug, hostPath }) {
    Object.assign(this, { files, file, slug, hostPath, part: `${file}.part`, map: `${file}.part.json` })
    // what an earlier run fetched of it
    try {
      const saved = JSON.parse(fs.readFileSync(this.map, 'utf8'))
      const have = Buffer.from(String(saved.have), 'base64')
      const part = fs.statSync(this.part)
      const count = Math.ceil(saved.size / PIECE)
      if (Number.isInteger(saved.size) && saved.size > 0 && saved.size <= SIZE_MAX && have.length === Math.ceil(count / 8) && part.size <= saved.size && Array.isArray(saved.sums) && saved.sums.length === count) {
        this.size = saved.size
        this.count = count
        this.have = new Uint8Array(have)
        this.sums = saved.sums
        for (let i = 0; i < count; i++) if (this.has(i)) (this.unsure.add(i), (this.got += this.length(i)))
      }
    } catch {}
  }

  has(i) {
    return Boolean(this.have && this.have[i >> 3] & (1 << (i & 7)))
  }

  length(i) {
    return Math.min(PIECE, this.size - i * PIECE)
  }

  // Nothing of it is here (any more).
  forget() {
    this.size = this.have = null
    this.count = this.got = 0
    this.sums = []
    this.unsure.clear()
  }

  // A piece an earlier run left: is what's in the pieces file what came? (The list could say more than is there: the
  // pieces file made anew under it, a disk that lost a write.) One that isn't is not here.
  sure(i) {
    if (!this.unsure.delete(i)) return true
    try {
      const buf = Buffer.alloc(this.length(i))
      const fd = fs.openSync(this.part, 'r')
      try {
        if (fs.readSync(fd, buf, 0, buf.length, i * PIECE) === buf.length && zlib.crc32(buf) === this.sums[i]) return true
      } finally {
        fs.closeSync(fd)
      }
    } catch {}
    this.have[i >> 3] &= ~(1 << (i & 7))
    this.got -= this.length(i)
    return false
  }

  // Bytes of its pieces file, written or read at their place in it. (Opened for each: a recording that was only looked
  // at would otherwise keep a file open for as long as the app runs, and so would every other one.)
  put(bytes, at) {
    const fd = fs.openSync(this.part, 'r+')
    try {
      fs.writeSync(fd, bytes, 0, bytes.length, at)
    } finally {
      fs.closeSync(fd)
    }
  }

  // A file of `size` bytes, none of it here yet.
  begin(size) {
    if (!Number.isInteger(size) || size < 0) throw fail('failed', `${this.files.nameOf(this.slug)} sent something that isn't a file`)
    if (size > SIZE_MAX) throw fail('big', "That file is too big to bring here: open it on the computer it's on.")
    fs.mkdirSync(path.dirname(this.part), { recursive: true })
    fs.writeFileSync(this.part, '')
    this.size = size
    this.count = Math.ceil(size / PIECE)
    this.have = new Uint8Array(Math.ceil(this.count / 8))
    this.sums = Array(this.count).fill(null)
    this.unsure.clear()
    this.got = 0
  }

  // What's here of it goes (the cache needed the room), and this with it: the next time the file is wanted it's
  // fetched by a new one, from the start. (One that came back to life beside the new one would write the same pieces
  // file anew under it.)
  drop() {
    this.dropped = true
    this.forget()
    fs.rmSync(this.part, { force: true })
    fs.rmSync(this.map, { force: true })
  }

  // Piece `i`, here: at once if it is, else once it has come (asked for once, however many want it).
  piece(i) {
    if (this.dropped) return Promise.reject(fail('failed', 'It was let go to make room, and is fetched again when it is asked for.'))
    this.used = Date.now()
    if (this.done || (this.has(i) && this.sure(i))) return Promise.resolve()
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
      if (NO_PIECES.test(e.message)) return this.asWhole(peer)
      if (/is gone|not an attachment|no such file|ENOENT/.test(e.message)) throw fail('gone', "That file isn't kept any more.")
      if (/connect|took too long/.test(e.message)) throw fail('away', `${this.files.nameOf(this.slug)} is away`)
      throw fail('failed', e.message)
    }
    if (this.done || this.dropped) return
    if (!res || !(res.bytes instanceof Uint8Array)) throw fail('failed', `${this.files.nameOf(this.slug)} sent something that isn't a file`)
    if (res.size !== this.size) this.begin(res.size) // the first piece, or a file that changed: from the start
    if (!this.size) return this.finish()
    if (i >= this.count) return // (asked past its end, before its size was known)
    if (res.bytes.length !== this.length(i)) throw fail('failed', `${this.files.nameOf(this.slug)} sent a piece of the wrong size`)
    if (this.has(i)) return
    this.put(res.bytes, i * PIECE)
    this.have[i >> 3] |= 1 << (i & 7)
    this.sums[i] = zlib.crc32(res.bytes)
    this.got += res.bytes.length
    if (this.got >= this.size) return this.finish()
    fs.writeFileSync(this.map, JSON.stringify({ size: this.size, have: Buffer.from(this.have).toString('base64'), sums: this.sums }))
    this.files.emit('progress', this.file, this.got, this.size)
    this.files.makeRoom(path.dirname(this.file), this.file)
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
    if (this.done || this.dropped) return
    if (!(bytes instanceof Uint8Array)) throw fail('failed', `${this.files.nameOf(this.slug)} sent something that isn't a file`)
    this.begin(bytes.length)
    if (bytes.length) this.put(bytes, 0)
    this.got = this.size
    this.finish()
  }

  // Every piece is here: it's a file like any other now. (Not before the ones an earlier run left are checked: one that
  // doesn't hold is fetched again first.)
  finish() {
    if (this.done) return
    for (const i of [...this.unsure]) if (!this.sure(i)) return this.piece(i)
    try {
      fs.renameSync(this.part, this.file)
    } catch (e) {
      // (its pieces were taken from under it: swept as old, or the cache was cleared by hand. From the start next time.)
      this.forget()
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
    const fd = fs.openSync(this.done ? this.file : this.part, 'r')
    try {
      fs.readSync(fd, buf, 0, buf.length, start)
    } finally {
      fs.closeSync(fd)
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
      // (every piece was here from an earlier run, which stopped before it could call it a file)
      if (!this.done && this.have && this.got >= this.size) await this.finish()
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
  evicted = new Map() // file in the cache -> when it went to make room
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

  // How long it is, and bytes start..end of it: from the cache when it's whole there, else through the Fetch that's its
  // now. (Always asked by the file, never by a Fetch held from before: the one from before may have been let go to
  // make room, with another in its place.)
  async sized(file, start = 0) {
    const whole = fs.statSync(file, { throwIfNoEntry: false })
    if (whole) return whole.size
    const f = this.fetchOf(file)
    if (!f) throw fail('gone', "That file isn't kept any more.")
    return f.sized(start)
  }

  async read(file, start, end) {
    for (let again = 0; ; again++) {
      const f = this.has(file) ? null : this.fetchOf(file)
      if (!f && !this.has(file)) throw fail('gone', "That file isn't kept any more.")
      try {
        if (f) return await f.read(start, end)
        const fd = fs.openSync(file, 'r')
        try {
          const buf = Buffer.alloc(Math.max(0, Math.min(end, fs.fstatSync(fd).size) - start))
          fs.readSync(fd, buf, 0, buf.length, start)
          return buf
        } finally {
          fs.closeSync(fd)
        }
      } catch (e) {
        // (let go to make room, or gone from the cache, between the look and the read: once more, with what's its now)
        if (again < 2 && (f?.dropped || e.code === 'ENOENT')) continue
        throw e
      }
    }
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
    // (one that just went to make room isn't brought straight back: what shows it asks for it itself, when it does)
    if (Date.now() - (this.evicted.get(file) ?? 0) < ROOM_REST) return
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

  // Keeps a computer's cache under `max` bytes of what's really on the disk: what was used longest ago goes first. Never
  // `keep` (just fetched), nor a file a piece of which is being asked for right now. A file that's partly here counts
  // for the pieces that are (it's as long as the whole file, with holes), and goes as one with its list of them.
  makeRoom(dir, keep) {
    let units = []
    try {
      units = fs.readdirSync(dir).filter((name) => !name.endsWith('.part.json')).map((name) => {
        const at = path.join(dir, name)
        const s = fs.statSync(at, { throwIfNoEntry: false })
        if (!s?.isFile()) return null
        const part = name.endsWith('.part')
        const file = part ? at.slice(0, -5) : at
        const fetch = part ? this.fetches.get(file) : null
        return { at, file, part, fetch, size: Math.min(s.size, (s.blocks ?? Infinity) * 512), used: fetch?.used ?? s.mtimeMs }
      }).filter(Boolean)
    } catch {
      return 0
    }
    let total = units.reduce((n, u) => n + u.size, 0)
    let gone = 0
    for (const u of units.sort((x, y) => x.used - y.used)) {
      if (total <= this.max) break
      if (u.file === keep || (u.fetch && u.fetch.asked.size)) continue
      try {
        if (u.fetch) (u.fetch.drop(), this.fetches.delete(u.file))
        else (fs.rmSync(u.at, { force: true }), u.part && fs.rmSync(`${u.at}.json`, { force: true }))
        this.evicted.set(u.file, Date.now())
        total -= u.size
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
  if (!m[1]) return Number(m[2]) > 0 && size > 0 ? { start: Math.max(0, size - Number(m[2])), end: size } : false
  const start = Number(m[1])
  if (start >= size || (m[2] && Number(m[2]) < start)) return false
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
  // The file by the path it was asked for by (what a linked computer's file is known by here), once that's known to
  // lead into one of the folders, wherever links and `..` take it. Never the pieces of one that's on its way.
  let file = null
  try {
    const asked = new URL(request.url).searchParams.get('p')
    if (asked && inside(asked, dirs)) file = path.resolve(asked)
  } catch {}
  if (!file || /\.part(\.json)?$/i.test(file)) return plain(404, 'gone') // (whatever the letters' case: a Mac's disk doesn't tell)
  if (kindOf(file) === 'html') return plain(403)
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405)
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  if (stat && !stat.isFile()) return plain(404, 'gone')
  if (!stat && !files?.theirs.has(file)) return plain(404, 'gone')
  const asked = request.headers.get('range')
  let size
  try {
    // (the piece the range starts in says how big the file is, when nothing of it is here yet)
    size = stat ? stat.size : await files.sized(file, Number(/^bytes=(\d+)-/.exec(asked ?? '')?.[1] ?? 0))
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
  if (stat) body = Readable.toWeb(fs.createReadStream(file, { start, end: end - 1 }))
  else {
    let at = start
    let stopped = false // the page stopped asking: it has what it wanted of this stretch, or went elsewhere in the file
    body = new ReadableStream({
      async pull(controller) {
        // (up to the end of the piece it's in: one piece is asked for at a time, as it's wanted)
        const to = Math.min(end, (Math.floor(at / PIECE) + 1) * PIECE)
        let bytes
        try {
          bytes = await files.read(file, at, to)
          if (bytes.length !== to - at) throw fail('failed', 'That file changed while it was coming. Try again.')
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

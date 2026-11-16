// A linked computer's files, a piece at a time (core/linkfiles.js): what the computer the file is on hands out, how the
// one that shows it asks, keeps and puts the pieces together, what the clique-file:// scheme answers the chat's pages,
// and the whole of it over a real CLIque Link between two computers. Run with `npm test`.
// (What the pages do with it, in a real window: npm run probe:files.)
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { LinkFiles, readPiece, answerFile, rangeOf, inside, fileURL, whyOf, PIECE, SCHEME, FILES_SCHEME, NO_PIECES } from '../core/linkfiles.js'
import { WIN } from './helpers/platform.mjs'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clique-linkfiles-')))
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const host = path.join(tmp, 'host') // the other computer's attachments
fs.mkdirSync(host)
const bytes = (n, seed) => {
  const b = Buffer.alloc(n)
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 7 + (i >> 10)) & 255
  return b
}
const put = (name, data, dir = host) => (fs.writeFileSync(path.join(dir, name), data), path.join(dir, name))
const BIG = 3 * PIECE + 4321 // four pieces, the last a short one
const run = put('run.mp4', bytes(BIG, 1))
const shot = put('shot.png', bytes(5000, 2))

// One computer that shows the other's files: its own cache, and a connection that answers from `host` as Clique.serve
// does, counting what's asked. `set` changes it: away, slow, an older CLIque (no readFile).
let n = 0
function viewer(set = {}) {
  const link = { away: false, old: false, wait: 0, asked: [], ...set }
  const peer = {
    call: async (name, [file, start, length]) => {
      link.asked.push(name === 'readFile' ? Math.floor(start / PIECE) : name)
      if (link.wait) await sleep(link.wait)
      if (link.drop) throw new Error('lost the connection to Workstation')
      if (name === 'readFile' && !link.old) return readPiece(host, file, start, length)
      if (name === 'readImage') {
        if (/\.mp4$/.test(file) || fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('too big to send: open it on the computer it is on')
        return new Uint8Array(fs.readFileSync(file))
      }
      // (what a CLIque from before pieces really says of readFile, asked as it is with no workspace in hand: Clique.serve)
      throw new Error("Workstation runs a newer CLIque, where every workspace is its own: update this computer's to work with its agents")
    },
  }
  const cache = path.join(tmp, `cache-${++n}`)
  const files = new LinkFiles({ cache, peer: () => (link.away ? null : peer), name: () => 'Workstation', ...(set.max && { max: set.max }) })
  return { files, link, cache }
}

test('the computer a file is on hands out up to a piece of it, from anywhere in it, and only its attachments', () => {
  const whole = fs.readFileSync(run)
  const first = readPiece(host, run, 0, PIECE)
  assert.deepEqual([first.size, first.bytes.length], [BIG, PIECE])
  assert.ok(first.bytes instanceof Uint8Array && !(first.bytes instanceof Buffer)) // (a link's message packs a Uint8Array as bytes)
  assert.ok(Buffer.from(first.bytes).equals(whole.subarray(0, PIECE)))
  assert.ok(Buffer.from(readPiece(host, run, 3 * PIECE, PIECE).bytes).equals(whole.subarray(3 * PIECE))) // the last, short one
  assert.ok(Buffer.from(readPiece(host, run, 100, 50).bytes).equals(whole.subarray(100, 150)))
  assert.equal(readPiece(host, run, 0, 50 * PIECE).bytes.length, PIECE) // never more than a piece
  assert.deepEqual([readPiece(host, run, BIG, 10).bytes.length, readPiece(host, run, BIG + 99, 10).size], [0, BIG])
  // only that folder's files, wherever .. and links lead, and never a folder
  const outside = put('secret.txt', 'secret', tmp)
  for (const bad of [outside, path.join(host, '..', 'secret.txt'), host, '', undefined, null, 42]) assert.throws(() => readPiece(host, bad, 0, 10), /not an attachment/, String(bad))
  if (!WIN) {
    fs.symlinkSync(outside, path.join(host, 'link.txt'))
    assert.throws(() => readPiece(host, path.join(host, 'link.txt'), 0, 10), /not an attachment/)
    fs.rmSync(path.join(host, 'link.txt'))
  }
  assert.throws(() => readPiece(host, path.join(host, 'gone.mp4'), 0, 10), /that file is gone/)
  for (const [start, length] of [[-1, 1], [1.5, 1], [NaN, 1], ['0', 1], [0, -5], [0, 1.5]]) assert.throws(() => readPiece(host, run, start, length), /not a part of a file/)
  // a file that isn't there yet is still "in" its folder, by where that folder really is (the cache, before anything's fetched)
  assert.equal(inside(path.join(host, 'not', 'yet', 'here.mp4'), [host]), path.join(host, 'not', 'yet', 'here.mp4'))
  assert.equal(inside(path.join(host, '..', 'x.mp4'), [host]), null)
})

test('it has its place in the cache; pieces come as they are asked for, each once, and with all of them it is the file', async () => {
  const { files, link, cache } = viewer({ wait: 5 })
  const file = files.place('workstation', run)
  assert.equal(file, path.join(cache, 'workstation', `${crypto.createHash('sha1').update(run).digest('hex').slice(0, 20)}.mp4`))
  assert.equal(files.place('workstation', run), file) // the same place every time
  assert.equal(files.place('workstation', 'C:\\Users\\rex\\.clique\\attachments\\A B.MP4').slice(-4), '.mp4')
  assert.deepEqual(files.state(file), { here: false, have: 0, size: null, why: null, computer: 'Workstation' })
  const events = []
  files.on('progress', (f, have, size) => events.push([have, size]))
  files.on('done', (f) => events.push(['done', f]))
  const f = files.fetchOf(file)
  // a stretch in the third piece: that piece comes (and the next is asked for, to be here when it's wanted)
  const whole = fs.readFileSync(run)
  const got = await f.read(2 * PIECE + 100, 2 * PIECE + 300)
  assert.ok(got.equals(whole.subarray(2 * PIECE + 100, 2 * PIECE + 300)))
  await sleep(40)
  assert.deepEqual(link.asked, [2, 3])
  assert.deepEqual(files.state(file), { here: false, have: PIECE + 4321, size: BIG, why: null, computer: 'Workstation' })
  assert.ok(!fs.existsSync(file) && fs.existsSync(`${file}.part`) && fs.existsSync(`${file}.part.json`))
  // the same stretch again: nothing asked. Two that want the same piece at once: asked once
  await f.read(2 * PIECE + 100, 2 * PIECE + 300)
  const [a, b] = await Promise.all([f.read(10, 20), f.read(500, 600)])
  assert.ok(a.equals(whole.subarray(10, 20)) && b.equals(whole.subarray(500, 600)))
  await sleep(40)
  assert.deepEqual(link.asked, [2, 3, 0, 1]) // (0, and 1 after it; with that, every piece)
  assert.ok(fs.existsSync(file) && !fs.existsSync(`${file}.part`) && !fs.existsSync(`${file}.part.json`), 'whole: a file like any other, nothing left beside it')
  assert.ok(fs.readFileSync(file).equals(whole))
  assert.deepEqual(events.at(-1), ['done', file])
  assert.deepEqual(events.at(-2), [BIG, BIG])
  assert.deepEqual(files.state(file), { here: true, computer: 'Workstation' })
  assert.equal(files.fetches.size, 0)
  // what was reading it while it finished still reads it, from the file now
  assert.ok((await f.read(BIG - 10, BIG + 500)).equals(whole.subarray(BIG - 10)))
  assert.equal(await files.whole(file), file)
  assert.equal(link.asked.length, 4)
})

test('all of it at once (Open, a picture that is about to show): every piece once, a few at a time', async () => {
  const { files, link } = viewer({ wait: 3 })
  const file = files.place('workstation', run)
  const [x, y] = await Promise.all([files.whole(file), files.whole(file)])
  assert.deepEqual([x, y], [file, file])
  assert.deepEqual([...link.asked].sort(), [0, 1, 2, 3])
  assert.ok(fs.readFileSync(file).equals(fs.readFileSync(run)))
  // want(): the same, quietly, for a file that's about to be shown
  const pic = files.place('workstation', shot)
  files.want(pic)
  files.want(pic)
  await sleep(60)
  assert.ok(fs.readFileSync(pic).equals(fs.readFileSync(shot)))
  assert.equal(link.asked.filter((p) => p === 0).length, 2) // (run's first piece, and the picture's only one)
  files.want(pic) // here already: nothing
  assert.equal(link.asked.length, 5)
  // one nobody placed isn't anybody's
  await assert.rejects(() => files.whole(path.join(tmp, 'nowhere.png')), (e) => whyOf(e) === 'gone')
})

test('what was fetched is still here after a restart; what another run left half-written is not trusted blindly', async () => {
  const first = viewer()
  const file = first.files.place('workstation', run)
  await first.files.fetchOf(file).read(PIECE, PIECE + 10) // pieces 1 and 2
  await sleep(20)
  assert.deepEqual(first.link.asked, [1, 2])
  // a new run of the app, the same cache, that computer away: what's here can still be read, the rest says away
  const later = new LinkFiles({ cache: first.cache, peer: () => null, name: () => 'Workstation' })
  later.place('workstation', run)
  const f = later.fetchOf(file)
  assert.deepEqual([f.size, f.got], [BIG, 2 * PIECE])
  assert.ok((await f.read(PIECE + 5, 3 * PIECE)).equals(fs.readFileSync(run).subarray(PIECE + 5, 3 * PIECE)))
  await assert.rejects(() => f.read(0, 10), (e) => whyOf(e) === 'away' && /Workstation is away/.test(e.message))
  assert.equal(later.state(file).why, 'away')
  // the pieces file gone, or shorter than its list says, or a list that isn't one: from the start
  fs.writeFileSync(`${file}.part.json`, '{"size": 12, "have": "AAAA"}')
  assert.equal(new LinkFiles({ cache: first.cache, peer: () => null }).place('workstation', run) && null, null)
  const fresh = viewer()
  const again = fresh.files.place('workstation', run)
  fs.mkdirSync(path.dirname(again), { recursive: true })
  fs.writeFileSync(`${again}.part.json`, JSON.stringify({ size: BIG, have: Buffer.from([0xff]).toString('base64') })) // says all four are here…
  // (…with no pieces file beside it)
  assert.equal(fresh.files.fetchOf(again).size, null)
  assert.ok((await fresh.files.fetchOf(again).read(0, 10)).equals(fs.readFileSync(run).subarray(0, 10)))
})

test('why a file can\'t be had: its computer is away, it isn\'t kept there, the connection dropped, it sent nonsense', async () => {
  // away: said at once, nothing asked; back: asked again
  const { files, link } = viewer({ away: true })
  const file = files.place('workstation', run)
  await assert.rejects(() => files.whole(file), (e) => whyOf(e) === 'away')
  assert.deepEqual([files.state(file).why, files.failed.get(file).why, link.asked.length], ['away', 'away', 0])
  files.want(file) // (not while it's away)
  assert.equal(link.asked.length, 0)
  link.away = false
  files.back('workstation')
  assert.equal(files.failed.has(file), false)
  assert.equal(await files.whole(file), file)
  // not kept there
  const gone = files.place('workstation', path.join(host, 'never.mp4'))
  await assert.rejects(() => files.whole(gone), (e) => whyOf(e) === 'gone' && e.message === "That file isn't kept any more.")
  assert.equal(files.state(gone).why, 'gone')
  const before = link.asked.length
  files.want(gone) // one that's gone isn't asked for again by itself
  files.back('workstation') // ...nor because its computer came back
  files.want(gone)
  assert.equal(link.asked.length, before)
  // something outside that computer's attachments: refused there, so gone here
  const outside = files.place('workstation', path.join(tmp, 'secret.txt'))
  await assert.rejects(() => files.whole(outside), (e) => whyOf(e) === 'gone')
  // the connection drops halfway
  const dropping = viewer()
  const f2 = dropping.files.place('workstation', run)
  await dropping.files.fetchOf(f2).read(0, 10)
  dropping.link.drop = true
  await assert.rejects(() => dropping.files.whole(f2), (e) => whyOf(e) === 'away')
  dropping.link.drop = false
  assert.equal(await dropping.files.whole(f2), f2) // and again once it's back: only what was missing
  assert.ok(fs.readFileSync(f2).equals(fs.readFileSync(run)))
  // nonsense: a piece of the wrong size, something that isn't bytes, a size that isn't one, a file too big to bring
  for (const [answer, why] of [[{ size: BIG, bytes: new Uint8Array(10) }, 'failed'], [{ size: BIG, bytes: 'text' }, 'failed'], [{ size: -1, bytes: new Uint8Array(0) }, 'failed'], [{ size: 5 * 1024 ** 3, bytes: new Uint8Array(PIECE) }, 'big'], [null, 'failed']]) {
    const cache = path.join(tmp, `cache-${++n}`)
    const odd = new LinkFiles({ cache, peer: () => ({ call: async () => answer }), name: () => 'Workstation' })
    await assert.rejects(() => odd.whole(odd.place('workstation', run)), (e) => whyOf(e) === why, JSON.stringify(answer)?.slice(0, 60))
    assert.ok(!fs.existsSync(odd.place('workstation', run)))
  }
})

test('a file that changed on its computer since some of it came is fetched again from the start', async () => {
  const changing = put('log.txt', bytes(2 * PIECE + 50, 5))
  const { files } = viewer()
  const file = files.place('workstation', changing)
  await files.fetchOf(file).read(0, 10)
  fs.writeFileSync(changing, bytes(PIECE + 9, 6)) // (attachments never change; a file you sent from there could be replaced)
  await files.whole(file)
  assert.ok(fs.readFileSync(file).equals(bytes(PIECE + 9, 6)))
  // an empty one is a file too
  const empty = put('empty.log', '')
  const e = files.place('workstation', empty)
  await files.whole(e)
  assert.equal(fs.statSync(e).size, 0)
})

test('a computer on a CLIque from before pieces: a picture comes whole, as it always did; a recording stays there', async () => {
  // both ways such a CLIque says it has no readFile (with no workspace in hand, as it's asked; and with one), and nothing else
  assert.ok(NO_PIECES.test("Workstation runs a newer CLIque, where every workspace is its own: update this computer's to work with its agents"))
  assert.ok(NO_PIECES.test('"readFile" isn\'t available over CLIque Link'))
  for (const other of ['not an attachment', 'that file is gone', 'lost the connection to Workstation', 'Workstation took too long to answer', '"readImage" isn\'t available over CLIque Link']) assert.ok(!NO_PIECES.test(other), other)
  const { files, link } = viewer({ old: true })
  const olds = []
  files.on('old', (slug) => olds.push(slug))
  const pic = files.place('workstation', shot)
  await files.whole(pic)
  assert.ok(fs.readFileSync(pic).equals(fs.readFileSync(shot)))
  assert.deepEqual(link.asked, [0, 'readImage'])
  assert.ok(files.old.has('workstation') && olds.includes('workstation'))
  const clip = files.place('workstation', run)
  await assert.rejects(() => files.whole(clip), (e) => whyOf(e) === 'old' && /runs an older CLIque/.test(e.message))
  assert.equal(files.state(clip).why, 'old')
  const before = link.asked.length
  files.want(clip) // not asked for again by itself
  assert.equal(link.asked.length, before)
  assert.equal(files.state(files.place('workstation', path.join(host, 'other.png'))).why, null) // a picture from it can still come
})

test("a computer's cache stays under its limit: the files fetched longest ago go, never one that's on its way or just came", async () => {
  const { files, cache } = viewer({ max: 3 * 5000 + 100 })
  const names = ['a.png', 'b.png', 'c.png', 'd.png'].map((name, i) => put(name, bytes(5000, 10 + i)))
  const kept = []
  for (const [i, from] of names.entries()) {
    const file = files.place('workstation', from)
    await files.whole(file)
    fs.utimesSync(file, new Date(2026, 0, 1 + i), new Date(2026, 0, 1 + i))
    kept.push(file)
  }
  // (the fourth came with three already there: the oldest went)
  assert.deepEqual(kept.map((f) => fs.existsSync(f)), [false, true, true, true])
  // one that's half here isn't taken, though it's the oldest of all
  const part = files.place('workstation', run)
  await files.fetchOf(part).read(0, 10)
  fs.utimesSync(`${part}.part`, new Date(2020, 0, 1), new Date(2020, 0, 1))
  const e = files.place('workstation', put('e.png', bytes(5000, 20)))
  await files.whole(e)
  assert.ok(fs.existsSync(`${part}.part`) && fs.existsSync(e) && !fs.existsSync(kept[1]))
  assert.ok(fs.readdirSync(path.join(cache, 'workstation')).length <= 6)
})

// ---- the scheme ------------------------------------------------------------------------------------------------------

const ask = (file, headers = {}, method = 'GET') => new Request(fileURL(file), { headers, method })
const body = async (res) => Buffer.from(await res.arrayBuffer())

test('ranges, as a player asks for them', () => {
  assert.equal(rangeOf(null, 100), null)
  assert.deepEqual(rangeOf('bytes=0-', 100), { start: 0, end: 100 })
  assert.deepEqual(rangeOf('bytes=10-19', 100), { start: 10, end: 20 })
  assert.deepEqual(rangeOf('bytes=90-500', 100), { start: 90, end: 100 })
  assert.deepEqual(rangeOf('bytes=-30', 100), { start: 70, end: 100 })
  assert.deepEqual(rangeOf('bytes=-300', 100), { start: 0, end: 100 })
  for (const bad of ['bytes=100-', 'bytes=200-300', 'bytes=-', 'items=0-5', 'bytes=0-5,10-15', 'bytes=a-b']) assert.equal(rangeOf(bad, 100), false, bad)
})

test('the scheme a page loads a file through: whole or a range of it, from this computer and from a linked one as it comes', async () => {
  assert.equal(fileURL('/a b/c#d.mp4'), 'clique-file://f/?p=%2Fa%20b%2Fc%23d.mp4')
  assert.deepEqual(FILES_SCHEME, { scheme: SCHEME, privileges: { stream: true, standard: true } }) // (what makes a <video> play from it: found the hard way)
  const here = path.join(tmp, 'attachments')
  fs.mkdirSync(here)
  const local = put('local.mp4', bytes(200000, 3), here)
  const { files, link, cache } = viewer({ wait: 2 })
  const on = { dirs: [here, cache], files }
  // this computer's file: whole, and a range, with what a player needs to know
  let res = await answerFile(ask(local), on)
  assert.deepEqual([res.status, res.headers.get('content-type'), res.headers.get('content-length'), res.headers.get('accept-ranges'), res.headers.get('content-range')], [200, 'video/mp4', '200000', 'bytes', null])
  assert.ok((await body(res)).equals(fs.readFileSync(local)))
  res = await answerFile(ask(local, { range: 'bytes=1000-1999' }), on)
  assert.deepEqual([res.status, res.headers.get('content-range'), res.headers.get('content-length')], [206, 'bytes 1000-1999/200000', '1000'])
  assert.ok((await body(res)).equals(fs.readFileSync(local).subarray(1000, 2000)))
  res = await answerFile(ask(local, { range: 'bytes=199990-' }), on)
  assert.deepEqual([res.status, res.headers.get('content-range'), (await body(res)).length], [206, 'bytes 199990-199999/200000', 10])
  res = await answerFile(ask(local, { range: 'bytes=200000-' }), on)
  assert.deepEqual([res.status, res.headers.get('content-range')], [416, 'bytes */200000'])
  res = await answerFile(ask(local, {}, 'HEAD'), on)
  assert.deepEqual([res.status, res.headers.get('content-length'), (await body(res)).length], [200, '200000', 0])
  assert.equal((await answerFile(ask(local, {}, 'POST'), on)).status, 405)
  // nothing it answers with is ever a document: no script runs from it, whatever the file
  for (const r of [await answerFile(ask(local), on), await answerFile(ask(path.join(tmp, 'x')), on)]) {
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
    assert.match(r.headers.get('content-security-policy'), /^default-src 'none'.*sandbox$/)
    assert.equal(r.headers.get('cache-control'), 'no-store')
  }
  // a linked computer's: the stretch asked for comes, a piece at a time, and only those pieces
  const whole = fs.readFileSync(run)
  const file = files.place('workstation', run)
  res = await answerFile(ask(file, { range: `bytes=${2 * PIECE + 7}-${2 * PIECE + 106}` }), on)
  assert.deepEqual([res.status, res.headers.get('content-range'), res.headers.get('content-type')], [206, `bytes ${2 * PIECE + 7}-${2 * PIECE + 106}/${BIG}`, 'video/mp4'])
  assert.ok((await body(res)).equals(whole.subarray(2 * PIECE + 7, 2 * PIECE + 107)))
  await sleep(30)
  assert.deepEqual(link.asked, [2, 3])
  // from the start to the end, read as a player reads: piece by piece as it takes them
  res = await answerFile(ask(file, { range: 'bytes=0-' }), on)
  assert.equal(res.headers.get('content-range'), `bytes 0-${BIG - 1}/${BIG}`)
  const reader = res.body.getReader()
  const one = await reader.read()
  assert.ok(Buffer.from(one.value).equals(whole.subarray(0, PIECE)))
  await sleep(30)
  assert.deepEqual(link.asked, [2, 3, 0, 1], 'one piece taken: that one fetched, and the next on its way; no more')
  // the player stops asking (it jumped elsewhere): nothing more comes for it, and that's no failure
  const failures = []
  files.on('failed', (...a) => failures.push(a))
  await reader.cancel()
  await sleep(30)
  assert.deepEqual([failures.length, files.failed.size, fs.existsSync(file)], [0, 0, true]) // (with piece 1 here that was all four)
  res = await answerFile(ask(file), on) // whole in the cache now: from there
  assert.ok((await body(res)).equals(whole))
  assert.equal(link.asked.length, 4)
})

test('the scheme says no to what is not one of CLIque\'s files, to a page, and says why a linked file can\'t be had', async () => {
  const here = path.join(tmp, 'attachments2')
  fs.mkdirSync(here)
  const { files, link, cache } = viewer({ away: true })
  const on = { dirs: [here, cache], files }
  const secret = put('secret.txt', 'secret', tmp)
  const page = put('demo.html', '<script>alert(1)</script>', here)
  for (const bad of [secret, path.join(here, '..', 'secret.txt'), path.join(here, 'gone.png'), here, '/etc/hosts']) {
    const res = await answerFile(ask(bad), on)
    assert.equal(res.status, 404, bad)
    assert.equal((await body(res)).length, 0)
  }
  if (!WIN) {
    fs.symlinkSync(secret, path.join(here, 'link.txt'))
    assert.equal((await answerFile(ask(path.join(here, 'link.txt')), on)).status, 404)
  }
  assert.equal((await answerFile(new Request('clique-file://f/'), on)).status, 404)
  // a page is never handed to the app's own pages: it runs in the sandbox only (core/sandbox.js)
  const res = await answerFile(ask(page), on)
  assert.deepEqual([res.status, (await body(res)).length], [403, 0])
  assert.equal((await answerFile(ask(files.place('workstation', path.join(host, 'p.html'))), on)).status, 403)
  // a linked computer's file: away, and the page that asked hears why at once
  const failures = []
  files.on('failed', (file, why, message) => failures.push([path.basename(file), why, message]))
  const file = files.place('workstation', run)
  let away = await answerFile(ask(file, { range: 'bytes=0-' }), on)
  assert.deepEqual([away.status, away.headers.get('x-clique-why')], [503, 'away'])
  assert.deepEqual(failures, [[path.basename(file), 'away', 'Workstation is away']])
  link.away = false
  const gone = await answerFile(ask(files.place('workstation', path.join(host, 'never.mp4'))), on)
  assert.deepEqual([gone.status, gone.headers.get('x-clique-why')], [404, 'gone'])
  // away halfway through a stretch: the stream ends in an error, and that's a failure it says
  const ok = await answerFile(ask(file, { range: 'bytes=0-' }), on)
  const reader = ok.body.getReader()
  await reader.read()
  link.drop = true
  await sleep(10) // (the piece after was on its way, and lost)
  failures.length = 0
  await assert.rejects(async () => {
    for (;;) if ((await reader.read()).done) break
  })
  assert.deepEqual(failures.map((f) => f[1]), ['away'])
})

// ---- over a real CLIque Link ---------------------------------------------------------------------------------------

test('two computers, linked for real: a recording an agent attached on one plays from the other, a piece at a time', { timeout: 60000 }, async () => {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const computer = (name, linkPort, agents) => {
    const home = fs.mkdtempSync(path.join(tmp, 'home-'))
    fs.mkdirSync(path.join(home, 'link'))
    fs.writeFileSync(path.join(home, 'link', 'link.json'), JSON.stringify({ name, port: linkPort }))
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ agents: agents.map((a) => ({ off: true, ...a })) }))
    const p = spawn(process.execPath, [fileURLToPath(new URL('./helpers/computer.mjs', import.meta.url))], { env: { ...process.env, CLIQUE_HOME: home, NAME: name }, stdio: ['pipe', 'pipe', 'inherit'] })
    const waiting = new Map()
    let seq = 0
    let ready
    const up = new Promise((r) => (ready = r))
    readline.createInterface({ input: p.stdout }).on('line', (line) => {
      let m
      try {
        m = JSON.parse(line)
      } catch {
        return
      }
      if (m.ready) return ready()
      const w = waiting.get(m.id)
      waiting.delete(m.id)
      m.error ? w?.reject(new Error(m.error)) : w?.resolve(m.ok)
    })
    const call = (code) => new Promise((resolve, reject) => (waiting.set(++seq, { resolve, reject }), p.stdin.write(JSON.stringify({ id: seq, code }) + '\n')))
    return { up, run: call, home, stop: () => p.kill() }
  }
  const studio = computer('Studio', port, [{ name: 'iris', area: 'testing' }])
  const laptop = computer('Laptop', port + 1, [{ name: 'ann', area: 'docs' }])
  after(() => (studio.stop(), laptop.stop()))
  await Promise.all([studio.up, laptop.up])
  await studio.run('clique.share(true)')
  const code = await studio.run('clique.snapshot().computers.me.code')
  assert.equal(await laptop.run(`clique.connect(${JSON.stringify(code)})`), 'studio')
  await sleep(400)
  const ws = await laptop.run(`clique.workspaces().find((w) => w.owner === 'studio').id`)
  await laptop.run(`(clique.workspaceAction('members', ${JSON.stringify(ws)}, { add: ['ann'] }), clique.workspaceAction('switch', ${JSON.stringify(ws)}), 1)`)
  await sleep(300)
  // iris, on the studio, attaches a recording (2.5 MB: three pieces), a picture and a document
  const work = fs.mkdtempSync(path.join(tmp, 'work-'))
  const mbox = (type, ...parts) => {
    const inner = Buffer.concat(parts)
    const head = Buffer.alloc(8)
    head.writeUInt32BE(inner.length + 8)
    head.write(type, 4, 'latin1')
    return Buffer.concat([head, inner])
  }
  const u32 = (v) => Buffer.from([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])
  const tkhd = mbox('tkhd', Buffer.alloc(40), ...[0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32), u32(1280 * 65536), u32(720 * 65536))
  const moov = mbox('moov', mbox('mvhd', Buffer.alloc(12), u32(600), u32(20 * 600), Buffer.alloc(80)), mbox('trak', tkhd, mbox('mdia', mbox('hdlr', Buffer.alloc(8), Buffer.from('vide'), Buffer.alloc(13)))))
  const clip = Buffer.concat([mbox('ftyp', Buffer.from('isom'), u32(0x200), Buffer.from('isomiso2')), moov, mbox('mdat', bytes(Math.round(2.5 * PIECE), 9))])
  fs.writeFileSync(path.join(work, 'run.mp4'), clip)
  fs.writeFileSync(path.join(work, 'shot.png'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(64), u32(48), Buffer.from([8, 6, 0, 0, 0])]))
  fs.writeFileSync(path.join(work, 'notes.pdf'), bytes(70000, 4))
  await studio.run(`clique.hubs.get(clique.current).attach('iris', [${JSON.stringify(work)}, 'run.mp4', 'shot.png', 'notes.pdf', '--caption', 'The run.'])`)
  // on the laptop the message has all three, each with its place in the laptop's cache, from Studio
  const seen = async () => (await laptop.run(`clique.snapshot().feed.filter((e) => e.files).map((e) => e.files).at(-1) ?? null`))
  let theirs = null
  for (let i = 0; i < 40 && !theirs; i++) (await sleep(100), (theirs = await seen()))
  assert.ok(theirs, 'the message reached the laptop')
  assert.deepEqual(theirs.map((f) => [f.name, f.kind, f.home, f.away, f.size]), [['run.mp4', 'video', 'Studio', undefined, clip.length], ['shot.png', 'image', 'Studio', undefined, 29], ['notes.pdf', 'file', 'Studio', undefined, 70000]])
  assert.deepEqual([theirs[0].w, theirs[0].h, theirs[0].dur, theirs[0].sound], [1280, 720, 20, false])
  const cache = path.join(laptop.home, 'link', 'cache', 'studio')
  for (const f of theirs) assert.equal(path.dirname(f.path), cache)
  // the picture came by itself; the recording and the document didn't
  for (let i = 0; i < 40 && !fs.existsSync(theirs[1].path); i++) await sleep(100)
  assert.equal(fs.statSync(theirs[1].path).size, 29)
  assert.ok(!fs.existsSync(theirs[0].path) && !fs.existsSync(`${theirs[0].path}.part`) && !fs.existsSync(theirs[2].path))
  // a player asks for its end first (where the laptop's page would find the index of many recordings), then plays on
  const read = (from, to) => laptop.run(`(async () => { const f = clique.files.fetchOf(${JSON.stringify(theirs[0].path)}); const b = await f.read(${from}, ${to}); return [b.toString('base64'), f.got, f.size] })()`)
  const [tail, got, size] = await read(clip.length - 1000, clip.length)
  assert.ok(Buffer.from(tail, 'base64').equals(clip.subarray(clip.length - 1000)))
  assert.deepEqual([size, got], [clip.length, clip.length - 2 * PIECE], 'its last piece only: not the whole file')
  assert.deepEqual(await laptop.run(`clique.files.state(${JSON.stringify(theirs[0].path)})`), { here: false, have: clip.length - 2 * PIECE, size: clip.length, why: null, computer: 'Studio' })
  const [head] = await read(0, 5000)
  assert.ok(Buffer.from(head, 'base64').equals(clip.subarray(0, 5000)))
  // opened (in its own app, as main.js does before it hands it over): the rest comes, and it's the same file
  assert.equal(await laptop.run(`clique.files.whole(${JSON.stringify(theirs[0].path)})`), theirs[0].path)
  assert.ok(fs.readFileSync(theirs[0].path).equals(clip))
  assert.equal(await laptop.run(`clique.files.whole(${JSON.stringify(theirs[2].path)})`), theirs[2].path)
  assert.ok(fs.readFileSync(theirs[2].path).equals(bytes(70000, 4)))
  assert.deepEqual(fs.readdirSync(cache).filter((f) => f.includes('.part')), [])
  // the studio hands out only its attachments, whatever a linked computer names
  const stolen = await laptop.run(`(async () => { const l = clique.links.get('studio'); try { await l.peer.call('readFile', [${JSON.stringify(path.join(studio.home, 'config.json'))}, 0, 100]); return 'read' } catch (e) { return e.message } })()`)
  assert.equal(stolen, 'not an attachment')
  // the studio goes away: what's here stays, and something new from it says its computer is away
  await studio.run(`clique.hubs.get(clique.current).attach('iris', [${JSON.stringify(work)}, 'notes.pdf'])`)
  for (let i = 0; i < 40 && (await seen())?.length !== 1; i++) await sleep(100)
  const later = (await seen())[0]
  studio.stop()
  for (let i = 0; i < 50 && (await laptop.run(`Boolean(clique.links.get('studio')?.peer)`)); i++) await sleep(100)
  assert.equal(await laptop.run(`(async () => { try { await clique.files.whole(${JSON.stringify(later.path)}); return 'here' } catch (e) { return e.why } })()`), 'away')
  assert.deepEqual(await laptop.run(`clique.files.state(${JSON.stringify(later.path)})`), { here: false, have: 0, size: null, why: 'away', computer: 'Studio' })
  assert.deepEqual(await laptop.run(`clique.files.state(${JSON.stringify(theirs[0].path)})`), { here: true, computer: 'Studio' })
})

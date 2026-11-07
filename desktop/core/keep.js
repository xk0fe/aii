// How much Crew keeps of the files in CREW_HOME that would otherwise only ever grow. No Electron in here.
//
//   feed.jsonl, per workspace     the chat: its last FEED_KEEP lines, no more than FEED_BYTES of them, and every line
//                                 still in use (see keepFeed). Written anew, whole (replaceFile), once it holds about
//                                 twice that (rewriteAt, Hub.save).
//   board.md, per workspace       the shared notes (crew note): the last BOARD_KEEP, written anew past BOARD_MAX.
//   spool/<agent>.jsonl           hook events while Crew is closed: past SPOOL_MAX it becomes <agent>.jsonl.1 (the one
//                                 before it goes) and a new one starts, so the newest events are the ones kept; hooks
//                                 firing at once lose nothing (core/adapters.js, bin/crew.mjs). Replayed and removed
//                                 when Crew is back.
//   attachments/                  images you attach: one that no workspace's chat, task or agent refers to any more
//                                 goes ATTACHMENT_DAYS after it was saved (Crew.sweepImages, a minute after the start).
//   link/cache/<computer>/        linked computers' images: CACHE_DAYS after they were fetched (fetched again when
//                                 they're shown).
//   run/ptyhost.log               the terminal host's log: a host writes at most 1 MB of it, Crew's own lines stop at
//                                 2 MB (note), and past 1 MB it starts afresh when a host starts, the one before kept as
//                                 ptyhost.log.1 (core/ptyclient.js, core/ptyhost.js).
//   logs/crew.log                 past 1 MB it starts afresh, the one before kept as crew.old.log (main.js).
// Bounded already: tickets.json (200 done tasks, 60 log lines each: core/tickets.js), stats.json and spend.json (60
// days: Hub.saveStats, Hub.saveSpend), run/groups/* (one small file per CLI launch, gone when it ends), moving/ (a day).
import fs from 'node:fs'
import path from 'node:path'
import { inThread } from './threads.js'

// The chat shows its last 200 lines; the 100 before them are what those reply to and quote. A line is a few hundred
// bytes and a reply at most 16000 characters, so the count is what usually binds. The size binds when lines are long
// (pasted logs, plans), and keeps Crew's start quick: feed.jsonl is read whole then.
export const FEED_KEEP = 300
// Threads (core/threads.js) count apart from the channel: one long one mustn't push the channel's history out.
export const THREAD_KEEP = 600
export const FEED_BYTES = 2 * 1024 * 1024
// `crew board` shows the last 200 notes. A note is one line, usually under 300 bytes.
export const BOARD_KEEP = 200
export const BOARD_MAX = 256 * 1024
// Per agent. Hook events are a few hundred bytes to a few dozen KB (a tool's output): thousands of them, hours of work.
// The same number is in the hooks (core/adapters.js) and bin/crew.mjs, which can't import this.
export const SPOOL_MAX = 4 * 1024 * 1024
export const ATTACHMENT_DAYS = 60
export const CACHE_DAYS = 30

// A feed line's length in feed.jsonl.
export const lineSize = (e) => Buffer.byteLength(JSON.stringify(e)) + 1

// When feed.jsonl, just written with `lines` lines and `bytes` bytes, is next written anew: once appends and amendments
// have doubled what's kept, or, when more than that is still in use, added as much again.
export const rewriteAt = (lines, bytes) => ({ lines: Math.max(2 * FEED_KEEP, lines + FEED_KEEP), bytes: Math.max(2 * FEED_BYTES, bytes + FEED_BYTES) })

// A file written anew all at once: beside it first, then moved over it, so a quit or a crash halfway leaves the one
// before whole. (Node's rename replaces a file on Windows too.)
export function replaceFile(file, text) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

export async function replaceFileAsync(file, text) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    await fs.promises.writeFile(tmp, text)
    await fs.promises.rename(tmp, file)
  } catch (e) {
    await fs.promises.rm(tmp, { force: true })
    throw e
  }
}

// What's kept of a feed (oldest first): the newest lines, up to `keep` of the channel's, `inside` of the threads' and
// `bytes` in all, with no gaps in the channel (once one of its lines is left out, so is everything older, except what's
// needed; a thread past its share just loses its oldest lines), and every older line `needed` says is still in use.
// The newest line always stays, however long. -> a new array, in the same order.
export function keepFeed(feed, { keep = FEED_KEEP, inside = THREAD_KEEP, bytes = FEED_BYTES, needed = () => false, size = lineSize } = {}) {
  const out = []
  let n = 0
  let hidden = 0
  let total = 0
  let full = false
  for (let i = feed.length - 1; i >= 0; i--) {
    const e = feed[i]
    if (!full) {
      const s = size(e)
      const threaded = inThread(e)
      if (out.length && total + s > bytes) full = true
      else if (threaded ? hidden < inside : n < keep || !out.length) {
        threaded ? hidden++ : n++
        total += s
        out.push(e)
        continue
      } else if (!threaded) full = true
    }
    if (needed(e)) out.push(e)
  }
  return out.reverse()
}

// The newest `keep` lines of a text file of lines, no more than `max` / 2 bytes of them (so a file written anew has
// room to grow before it's written anew again), the newest always. -> the text to write.
export function keepLines(text, { keep = BOARD_KEEP, max = BOARD_MAX } = {}) {
  const lines = String(text).split('\n').filter(Boolean).slice(-keep)
  let total = 0
  let i = lines.length
  while (i > 0) {
    const size = Buffer.byteLength(lines[i - 1]) + 1
    if (i < lines.length && total + size > max / 2) break
    total += size
    i--
  }
  return lines.slice(i).map((l) => `${l}\n`).join('')
}

// Removes the files in `dir` (not its folders) last changed more than `days` ago, except those `inUse` says something
// still refers to (it's given the file's full path). Missing folders and files that won't go are left be.
// -> how many went.
export function sweepFiles(dir, { days, inUse = () => false, now = Date.now() }) {
  let names = []
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let gone = 0
  for (const d of names) {
    if (!d.isFile()) continue
    const file = path.join(dir, d.name)
    try {
      if (now - fs.statSync(file).mtimeMs <= days * 864e5 || inUse(file)) continue
      fs.rmSync(file, { force: true })
      gone++
    } catch {}
  }
  return gone
}

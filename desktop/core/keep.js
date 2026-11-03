// How much Crew keeps of the files in CREW_HOME that would otherwise only ever grow. No Electron in here.
//
//   feed.jsonl, per workspace     the chat: its last FEED_KEEP lines, no more than FEED_BYTES of them, and every line
//                                 still in use (see keepFeed). Written anew once it holds twice that (Hub.save).
//   board.md, per workspace       the shared notes (crew note): the last BOARD_KEEP, written anew past BOARD_MAX.
//   spool/<agent>.jsonl           hook events while Crew is closed: past SPOOL_MAX it becomes <agent>.jsonl.1 (the one
//                                 before it goes) and a new one starts, so the newest events are the ones kept
//                                 (core/adapters.js, bin/crew.mjs). Replayed and removed when Crew is back.
//   attachments/                  images you attach: one that no workspace's chat, task or agent refers to any more
//                                 goes ATTACHMENT_DAYS after it was saved (Crew.sweepImages, a minute after the start).
//   link/cache/<computer>/        linked computers' images: CACHE_DAYS after they were fetched (fetched again when
//                                 they're shown).
//   run/ptyhost.log, logs/crew.log  1 MB, then it starts afresh with the one before kept beside it (core/ptyclient.js,
//                                 main.js).
// Bounded already: tickets.json (200 done tasks, 60 log lines each: core/tickets.js), stats.json and spend.json (60
// days: Hub.saveStats, Hub.saveSpend), run/groups/* (one small file per CLI launch, gone when it ends), moving/ (a day).
import fs from 'node:fs'
import path from 'node:path'

// The chat shows its last 200 lines; the 100 before them are what those reply to and quote. A line is a few hundred
// bytes and a reply at most 4000 characters, so the count is what usually binds. The size binds when lines are long
// (pasted logs, plans), and keeps Crew's start quick: feed.jsonl is read whole then.
export const FEED_KEEP = 300
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

// What's kept of a feed (oldest first): the newest lines, up to `keep` of them and `bytes` in all, with no gaps (once
// one is left out, so is everything older, except what's needed), and every older line `needed` says is still in use.
// The newest line always stays, however long. -> a new array, in the same order.
export function keepFeed(feed, { keep = FEED_KEEP, bytes = FEED_BYTES, needed = () => false, size = lineSize } = {}) {
  const out = []
  let n = 0
  let total = 0
  let full = false
  for (let i = feed.length - 1; i >= 0; i--) {
    const e = feed[i]
    if (!full) {
      const s = size(e)
      if (n && (n >= keep || total + s > bytes)) full = true
      else {
        n++
        total += s
        out.push(e)
        continue
      }
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

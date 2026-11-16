// Moving an agent to another computer with its conversation. The computer it leaves stops it (so its CLI has
// written everything down) and hands over its definition, its CLI session files (Claude Code's transcript, Codex's
// session log), its queued messages, its conversation's numbers and its own lines in the chat. The computer it
// moves to puts the files where its CLI looks for them, resumes the conversation and tells the agent what
// happened. core/clique.js runs the steps, passing everything through the computer you clicked on (the two needn't
// be linked to each other), file by file in chunks: a long transcript is bigger than one CLIque Link message.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { HOME, ATTACHMENTS } from './hub.js'
import { packAgents, unpackAgents } from './pack.js'
import { expandEnv } from './providers.js'
import { accountEnv } from './accounts.js'
import { WINDOWS, expand, real, sizeOf, portable, claudeSlug, claudeProject, sessionRoot, sessionOf } from './sessions.js'

export { claudeSlug, claudeProject, sessionRoot, sessionOf }

export const CHUNK = 8 * 1024 * 1024 // bytes per CLIque Link message: its limit is 32 MB, and bytes travel as base64
export const MAX_CONVERSATION = 256 * 1024 * 1024 // a bigger one stays behind, and the agent starts fresh
const MAX_IMAGES = 64 * 1024 * 1024 // images in the lines and messages that go along
const STAGING = path.join(HOME, 'moving') // what arrives, until it's put in place

const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`

// A relative path that came with a move, as this computer writes it (`join`), whether a Mac or Windows sent it: either
// separator, and nothing that lands outside the folder it's for (no .., no root, drive or share, no : for a Windows
// alternate stream).
export function safeRel(rel, join = path.join) {
  const s = String(rel ?? '')
  const parts = s.split(/[\\/]+/).filter((p) => p && p !== '.')
  if (!parts.length || /^[\\/]/.test(s) || parts.some((p) => p === '..' || p.includes(':') || p.includes('\0'))) throw new Error(`not a conversation file: ${rel}`)
  return join(...parts)
}

function place(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch (e) {
    // another disk; or on Windows, something (a virus scanner, say) has the file open just then
    if (e.code !== 'EXDEV' && !(WINDOWS && (e.code === 'EPERM' || e.code === 'EBUSY'))) throw e
    fs.copyFileSync(from, to)
    fs.rmSync(from, { force: true })
  }
}

// Claude Code names long tool outputs and sub-agents' transcripts by their full path, under <its project folder>/<id>/,
// so a transcript that moved points at the project folder it left (was: { root, id, sep }, as that computer wrote
// them) and should point at `root`, the one here. It's JSON lines, so a Windows path's \ is written \\ in it; and
// between a Mac and Windows the rest of each of those paths changes separators too. (Line endings don't matter: a line
// that ends in \r\n reads the same.)
export function repoint(text, was, root, sep = path.sep) {
  const json = (s) => JSON.stringify(s).slice(1, -1)
  const from = json(was.root + was.sep + was.id + was.sep)
  if (!text.includes(from)) return text
  const [a, b] = [json(was.sep), json(sep)]
  const tail = new RegExp(`${quote(from)}((?:[\\w.-]|${quote(a)})*)`, 'g') // the files there: tool-results/toolu_….txt
  return text.replace(tail, (_, rest) => json(root + sep + was.id + sep) + rest.split(a).join(b))
}
const quote = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The separator in a folder from a computer that didn't say (an older CLIque, so a Mac's).
const sepOf = (dir) => (/^[a-zA-Z]:\\|^\\\\/.test(String(dir)) ? '\\' : '/')

// ---- names, as the other computer writes them ---------------------------------------------------------

// A name from the computer an agent leaves (`from`), as the one it moves to (`to`) writes it: the agent itself by
// its new name, the others it leaves behind as name@from, and the ones that live on `to` (name@to) bare.
// The same goes for task numbers (`numbers`: 12 there is 12@from here) and the ids of lines in the chat.
export const requalify = ({ from, to, old, name, numbers = false }) => (n) => {
  if (n === undefined || n === null || n === 'you' || n === 'clique') return n
  const s = String(n)
  const at = s.lastIndexOf('@')
  if (at < 0) return old !== undefined && s === old ? name : `${s}@${from}`
  if (s.slice(at + 1) !== to) return s
  const bare = s.slice(0, at)
  return numbers && /^\d+$/.test(bare) ? Number(bare) : bare
}

// A line of the chat, as the computer it moves to keeps it. A reply that points at a line staying behind points
// at it there (core/clique.js reads id@computer like name@computer).
function carried(e, { names, tasks, lines, images, moving }) {
  const out = { ...e, from: names(e.from) }
  if (e.to !== undefined) out.to = names(e.to)
  if (e.cc) out.cc = e.cc.map(names)
  if (e.ticket !== undefined) out.ticket = tasks(e.ticket)
  if ((e.act === 'fixing' || e.act === 'triaged') && e.text) out.text = names(e.text)
  if (e.re && !moving.has(e.re)) out.re = lines(e.re)
  if (e.thread && !moving.has(e.thread)) out.thread = lines(e.thread)
  if (e.echo && !moving.has(e.echo)) out.echo = lines(e.echo)
  if (e.images) out.images = e.images.map((p) => images.get(p) ?? p)
  // what the agent attached (core/attachments.js) doesn't go along: its card says where the file stayed
  if (e.files) out.files = e.files.map((f) => ({ ...f, path: '', away: f.away ?? 'the computer it was attached on' }))
  return out
}

const gist = (text, max = 160) => {
  const line = String(text ?? '').replace(/```[\s\S]*?```/g, '[code]').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// ---- the computer an agent leaves ----------------------------------------------------------------------

// Stops the agent and says what goes with it. Nothing is removed until moveEnd: if the move fails, it carries on
// here. While it's moving, messages to it are turned away (they'd have nowhere to go).
export async function moveOut(hub, name) {
  const a = hub.agents.get(name)
  if (!a) throw new Error(`no agent named "${name}"`)
  if (a.system) throw new Error(`${name} comes with every workspace, so it stays here`)
  if (a.moving) throw new Error(`@${name} is already moving`)
  const working = a.status === 'working' || a.status === 'waiting'
  const running = hub.runner.running(name)
  a.moving = true
  try {
    await hub.runner.stop(name) // so its CLI has written all of the conversation down
    for (const t of [a.ack, a.timer, a.readyTimer]) clearTimeout(t)
    hub.forgetAsks(name)
    if (running) hub.setStatus(a, 'stopped')
    const provider = hub.providerOf(a)
    // (its conversation is in the folder of the account it runs on: core/accounts.js)
    const env = { ...process.env, ...expandEnv(provider?.env), ...accountEnv(hub.accountOf(a), provider) }
    let session = sessionOf(provider?.cli, hub.sessions[name], { cwd: a.cwd, env, transcript: a.transcript })
    const files = []
    const paths = []
    if (session.files) {
      // the transcript itself, then what fits of the rest (sub-agents' transcripts, long tool outputs)
      const [main, ...rest] = session.files.map((f) => ({ ...f, size: sizeOf(f.path) }))
      if (main.size > MAX_CONVERSATION) session = { reason: `its conversation is ${mb(main.size)}, more than a move carries (${mb(MAX_CONVERSATION)})` }
      else {
        let room = MAX_CONVERSATION
        for (const f of [main, ...rest]) {
          if (f.size < 0 || f.size > room) continue
          room -= f.size
          files.push({ rel: f.rel, size: f.size })
          paths.push(f.path)
        }
      }
    }
    // A message lives with the agent it's addressed to; everything else with the agent who said it.
    const feed = hub.feed.filter((e) => (e.kind === 'msg' ? e.to === name : e.from === name))
    const current = working && a.current ? hub.feed.find((e) => e.id === a.current) : undefined
    let room = MAX_IMAGES
    for (const p of new Set([...feed, ...a.inbox].flatMap((e) => e.images ?? []))) {
      const size = String(p).startsWith(ATTACHMENTS + path.sep) ? sizeOf(p) : -1
      if (size < 0 || size > room) continue
      room -= size
      files.push({ image: p, size })
      paths.push(p)
    }
    const token = randomUUID()
    ;(hub.moves ??= new Map()).set(token, { name, paths, ids: new Set(feed.map((e) => e.id)), running, working })
    return {
      token, name, files, pack: packAgents(hub, [name], { stats: true }),
      session: session.files ? { cli: session.cli, id: session.id, root: session.root, sep: path.sep } : null, reason: session.reason,
      // questions waiting for it stay: their askers here are told it moved (moveEnd), so nobody waits on an answer
      // that would have nowhere to go
      convo: hub.convos[name] ?? null, feed, inbox: a.inbox.filter((m) => !m.ask), cwd: real(expand(a.cwd)),
      working, current: current && { id: current.id, text: gist(current.ticket !== undefined ? `#${current.ticket} ${current.title ?? ''}` : current.text) },
    }
  } catch (e) {
    a.moving = false
    if (running) hub.launch(a)
    throw e
  }
}

export function moveRead(hub, token, i, offset) {
  const file = hub.moves?.get(token)?.paths[i]
  if (!file) throw new Error('that move is over')
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(CHUNK)
    const n = fs.readSync(fd, buf, 0, CHUNK, Number(offset) || 0)
    return new Uint8Array(buf.subarray(0, n))
  } finally {
    fs.closeSync(fd)
  }
}

// done: { to, name } once it lives there (to: that computer, name: what it's called there). Without it the move
// didn't happen, and the agent picks up again here.
export function moveEnd(hub, token, done) {
  const m = hub.moves?.get(token)
  if (!m) return
  hub.moves.delete(token)
  const a = hub.agents.get(m.name)
  if (!done) {
    if (!a) return
    a.moving = false
    if (m.working) a.inbox.unshift(cliquePrompt(a, `[clique] You were stopped for a move to another computer that didn't go through, so you're still here, in ${real(expand(a.cwd))}. Anything you had running in your terminal was stopped. Check where things stand, then carry on.`))
    if (m.running) hub.launch(a)
    else hub.pump(a) // what came for it meanwhile
    return hub.changed()
  }
  hub.forgetCalls(m.name, `moved to another computer before it answered: ask @${done.name}@${done.to} again`)
  hub.removeAgent(m.name)
  delete hub.convos[m.name]
  hub.saveConvos()
  hub.feed = hub.feed.filter((e) => !m.ids.has(e.id))
  // replies to its lines point there, and so do the threads they're in
  for (const e of hub.feed) for (const k of ['re', 'thread', 'echo']) if (m.ids.has(e[k])) e[k] = `${e[k]}@${done.to}`
  hub.renameRefs(m.name, `${done.name}@${done.to}`)
  hub.rewriteFeed()
  hub.changed()
}

// A prompt from CLIque itself, queued like a message (it isn't one: it's not in the chat).
const cliquePrompt = (a, text, id) => ({ id: id ?? randomUUID().slice(0, 8), ts: Date.now(), kind: 'msg', from: 'you', to: a.name, text, clique: true, queued: true })

// ---- the computer it moves to ------------------------------------------------------------------------

const staging = (token) => {
  if (!/^[\w-]{8,64}$/.test(String(token))) throw new Error('not a move')
  return path.join(STAGING, token)
}

export function moveWrite(token, i, offset, bytes) {
  if (!Number.isInteger(i) || i < 0 || i > 100000 || !Number.isInteger(offset) || offset < 0) throw new Error('not a part of a move')
  if (bytes.length > CHUNK || offset + bytes.length > MAX_CONVERSATION + MAX_IMAGES) throw new Error('more than a move carries')
  const dir = staging(token)
  if (!fs.existsSync(dir)) sweep()
  fs.mkdirSync(dir, { recursive: true })
  const fd = fs.openSync(path.join(dir, String(i)), offset === 0 ? 'w' : 'r+')
  try {
    fs.writeSync(fd, bytes, 0, bytes.length, offset)
  } finally {
    fs.closeSync(fd)
  }
}

export function moveDrop(token) {
  fs.rmSync(staging(token), { recursive: true, force: true })
}

// What's left of moves that never finished (the computer running one went away midway).
function sweep() {
  let list = []
  try {
    list = fs.readdirSync(STAGING)
  } catch {}
  for (const d of list) {
    try {
      if (Date.now() - fs.statSync(path.join(STAGING, d)).mtimeMs > 864e5) fs.rmSync(path.join(STAGING, d), { recursive: true, force: true })
    } catch {}
  }
}

// The agent arrives: added under `name`, working in `folder`, its conversation resumed when its files came whole.
// from: { slug, name } of the computer it left; here: this computer's name. -> { name, conversation, reason? }
// shared: one of your shared agents: it joins this computer's clique too, or (join) this computer's clique has it already and it rejoins this workspace.
export function moveIn(hub, token, out, { name, folder, on, from, shared, join }, here) {
  const dir = staging(token)
  const staged = (i) => path.join(dir, String(i))
  const whole = (i) => sizeOf(staged(i)) === out.files[i].size
  const there = folderInfo(folder)
  if (there.exists && there.path !== expand(folder)) folder = there.path // as this computer writes it (a Mac's path on Windows)
  let added
  try {
    if (join) {
      hub.space.join(name, { ...(folder && { folder }), off: true })
      hub.saveConfig()
      added = name
      const stats = out.pack.agents[0]?.stats
      if (stats && !hub.stats[name]) (hub.stats[name] = { ...stats, days: { ...stats.days } }), hub.saveStats()
    } else [added] = unpackAgents(hub, out.pack, [{ index: 0, name, folder, on: false, shared: Boolean(shared) }])
    const a = hub.agents.get(added)
    const cwd = real(expand(folder))
    const names = requalify({ from: from.slug, to: hub.self, old: out.name, name: added })
    const tasks = requalify({ from: from.slug, to: hub.self, numbers: true })
    const lines = requalify({ from: from.slug, to: hub.self })
    let conversation = 'fresh'
    let reason = out.reason
    if (out.session) {
      try {
        const cli = hub.providerOf(a)?.cli
        if (cli !== out.session.cli) throw new Error(`it runs ${cli} here`)
        const parts = out.files.map((f, i) => ({ ...f, i })).filter((f) => f.rel)
        if (!parts.length || !parts.every((f) => whole(f.i))) throw new Error("it didn't arrive whole")
        const root = sessionRoot(cli, folder, { ...process.env, ...expandEnv(hub.providerOf(a)?.env) })
        const placed = parts.map((f) => path.join(root, safeRel(f.rel)))
        parts.forEach((f, i) => place(staged(f.i), placed[i]))
        // Claude Code points at long tool outputs by path: from the old project folder to this one
        const [first] = parts
        if (cli === 'claude' && out.session.root !== root) {
          const file = path.join(root, safeRel(first.rel))
          const text = fs.readFileSync(file, 'utf8')
          const now = repoint(text, { ...out.session, sep: out.session.sep ?? sepOf(out.session.root) }, root)
          if (now !== text) fs.writeFileSync(file, now)
        }
        // what these logs hold so far was used on the computer they came from: the usage history here counts from there on
        for (const file of placed) hub.noteArrived(file)
        hub.saveSession(added, out.session.id)
        conversation = 'moved'
        reason = undefined
      } catch (e) {
        reason = `its conversation couldn't be set up here (${e.message})`
      }
    }
    // the images in its lines and messages, saved here
    const images = new Map()
    out.files.forEach((f, i) => {
      if (!f.image || !whole(i)) return
      const ext = /^\.(png|jpe?g|gif|webp)$/i.test(path.extname(f.image)) ? path.extname(f.image) : '.png'
      const file = path.join(ATTACHMENTS, `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}${ext}`)
      place(staged(i), file)
      images.set(f.image, file)
    })
    const how = { names, tasks, lines, images, moving: new Set(out.feed.map((e) => e.id)) }
    // what it was answering stays in the chat however old, so its reply has its question to point at
    hub.adoptFeed(out.feed.map((e) => carried(e, how)), out.current?.id ? [out.current.id] : [])
    const byId = new Map(hub.feed.map((e) => [e.id, e]))
    a.inbox = out.inbox.map((m) => Object.assign(byId.get(m.id) ?? carried(m, how), { queued: true }))
    const there = from.name
    const moved = `moved from ${there} to ${here}` // its lines travel with it, so not "here"
    if (conversation === 'moved') {
      if (out.convo) hub.convos[added] = { ...out.convo, ...(out.convo.ticket != null && { ticket: tasks(out.convo.ticket) }) }
      const folderNote = `your folder here is ${cwd}${out.cwd && out.cwd !== cwd ? ` (it was ${out.cwd} on ${there})` : ''}`
      if (out.working) {
        const what = out.current?.text ? ` while working on: "${out.current.text}"` : ' while working'
        a.inbox.unshift(cliquePrompt(a, `[clique] You were moved from computer "${there}" to "${here}"${what}. Your conversation came with you, but anything that was running on ${there} (dev servers, simulators, builds, background shells, watchers) did not, and ${folderNote}, which may be a different checkout. Check where things stand, then carry on.`, out.current?.id))
      } else hub.convoOf(a).note = `[clique] Since your last message you moved from computer "${there}" to "${here}" (${folderNote}); processes you started on ${there} didn't come along.`
      hub.saveConvos()
      hub.post({ kind: 'event', from: added, text: `${moved}, with its conversation${out.working ? ', and picks up where it left off' : ''}` })
    } else {
      const was = out.working && out.current?.text ? `. It was working on "${gist(out.current.text, 90)}": send that again if it still needs doing` : ''
      hub.post({ kind: 'event', from: added, text: `${moved}, starting a new conversation${reason ? `: ${reason}` : ''}${was}`, fresh: true })
    }
    if (hub.renameRefs(`${out.name}@${from.slug}`, added)) hub.rewriteFeed()
    if (on) {
      hub.space.set(added, 'off', undefined)
      hub.saveConfig() // starts it, resuming the conversation
    }
    return { name: added, conversation, ...(reason && { reason }) }
  } catch (e) {
    if (added) {
      // one that joined leaves this workspace again; one made here goes, from the clique too if it joined that
      hub.removeAgent(added, { everywhere: Boolean(shared) && !join })
      hub.feed = hub.feed.filter((x) => !out.feed.some((y) => y.id === x.id))
      hub.rewriteFeed()
    }
    throw e
  } finally {
    moveDrop(token)
  }
}

// ---- every other computer -----------------------------------------------------------------------------

// An agent moved between two other computers: lines, tasks and read markers here follow it to its new name.
// move: { from, to, old, name } (computer slugs, its name before and after).
export function agentMoved(hub, { from, to, old, name }) {
  const before = hub.self === from ? old : `${old}@${from}`
  const after = hub.self === to ? name : `${name}@${to}`
  if (hub.renameRefs(before, after)) hub.rewriteFeed()
}

// ---- folders, on whichever computer an agent will work -------------------------------------------------

// Is there a folder at `dir` (~ is this computer's home)? -> { exists, path } with the path written out. A folder
// in another computer's home (where the agent works now: /Users/ann/code/app on a Mac, C:\Users\ann\code\app on
// Windows) that isn't here is the same place in this computer's home, if that's there. On Windows, the path is
// whole (a drive, \ between folders) and has the case it has on disk, as the agent's CLI will see it.
export function folderInfo(dir) {
  const given = String(dir ?? '').trim()
  const full = WINDOWS ? path.resolve(expand(given)) : expand(given)
  if (isDir(full)) return { exists: true, path: WINDOWS ? real(full) : full }
  const twin = homeTwin(given)
  if (twin && twin !== full && isDir(twin)) return { exists: true, path: WINDOWS ? real(twin) : twin }
  return { exists: false, path: full }
}

const isDir = (dir) => {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

// The folder in this computer's home (`home`, its paths joined by `join`) where `dir` is in its own computer's: the
// rest of the path after /Users/<you> (macOS), /home/<you> (Linux), C:\Users\<you> (Windows) or ~, with either
// separator. -> the path, or null when `dir` isn't in a home folder.
export function homeTwin(dir, home = os.homedir(), join = path.join) {
  const s = String(dir ?? '').trim()
  const m = s.match(/^~(?:[\\/]+(.*))?$/) ?? s.match(/^\/(?:Users|home)\/(?!Shared(?:\/|$))[^/]+(?:\/+(.*))?$/) ?? s.match(/^[a-zA-Z]:[\\/]+Users[\\/]+(?!Public(?:[\\/]|$))[^\\/]+(?:[\\/]+(.*))?$/i)
  if (!m) return null
  return join(home, ...(m[1] ?? '').split(/[\\/]+/).filter(Boolean))
}

// Folders worth offering for an agent here: the one at the same path as `like` (where it works now, on another
// computer), the folders this computer's agents work in, and the home folder. -> [{ path, label }]
export function folders(hub, like) {
  const out = new Map()
  const add = (dir, label) => {
    const { exists, path: full } = folderInfo(dir)
    if (!exists) return
    const known = out.get(full)
    if (!known) out.set(full, { path: full, label })
    else if (!known.label.includes(label)) known.label += `, ${label}`
  }
  if (like !== undefined && like !== null) add(like, 'same folder as now')
  const users = new Map()
  for (const a of hub.agents.values()) {
    if (a.system) continue // his folder is his own
    const full = folderInfo(a.cwd).path
    users.set(full, [...(users.get(full) ?? []), a.name])
  }
  for (const [full, list] of users) add(full, list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3}` : list.join(', '))
  add('~', 'home folder')
  return [...out.values()]
}

// The Tasks board: work for the clique (bugs you call out, features, chores) as tickets that move
// to do → in progress → review → done (stored as new / fixing / check / done). A ticket carries everything a
// fresh conversation needs to do it (what's wanted, screenshots, notes), so whoever picks it up doesn't need
// anyone's chat history. Stored in ~/.clique/tickets.json. No Electron in here.
import fs from 'node:fs'
import { movedImages } from './home.js'
import { defused, relayed } from './framing.js'

export const STATUSES = ['new', 'fixing', 'check', 'done']
export const KINDS = ['task', 'bug', 'feature']
// Priority, stored under its old name `severity`: blocker / high / normal / low, shown as urgent / high / medium / low.
export const SEVERITIES = ['blocker', 'high', 'normal', 'low']
const PRIORITY = { urgent: 'blocker', blocker: 'blocker', high: 'high', medium: 'normal', normal: 'normal', low: 'low' }
export const priorityOf = (word) => PRIORITY[String(word ?? '').toLowerCase()]
export const PRIORITY_NAME = { blocker: 'urgent', high: 'high', normal: 'medium', low: 'low' }
const KEEP_DONE = 200 // older done tickets are dropped

// "Jump does nothing after pause. Happens every time on level 2" -> a title and the rest as the body.
export function splitReport(text) {
  const raw = String(text ?? '').trim()
  const [first, ...rest] = raw.split('\n')
  const sentence = first.match(/^(.{12,90}?[.!?])\s/)?.[1]
  let title = (sentence ?? first).trim()
  if (title.length > 90) title = title.slice(0, 90).replace(/\s+\S*$/, '') + '…'
  const body = raw === title ? '' : raw
  return { title: title.replace(/[.]$/, ''), body }
}

export class Tickets {
  constructor(file) {
    this.file = file
    let data
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      data = {}
    }
    this.next = data.next ?? 1
    this.all = (data.tickets ?? []).map(movedImages) // (images written down before the app's folder moved: core/home.js)
    for (const t of this.all) t.kind ??= 'bug' // the board started out as Bugs
    for (const t of this.all) for (const l of t.log ?? []) if (l.by === 'crew') l.by = 'clique' // (the app's own moves, from before its rename)
  }

  // Many changes, one write: a bulk action on the board. fn may be async (starting tasks sends them on).
  async batch(fn) {
    this.holding = (this.holding ?? 0) + 1
    try {
      return await fn()
    } finally {
      if (!--this.holding && this.dirty) this.save()
    }
  }

  save() {
    if (this.holding) return void (this.dirty = true)
    this.dirty = false
    const done = this.all.filter((t) => t.status === 'done')
    if (done.length > KEEP_DONE) {
      const drop = new Set(done.sort((x, y) => x.updated - y.updated).slice(0, done.length - KEEP_DONE))
      this.all = this.all.filter((t) => !drop.has(t))
    }
    fs.writeFileSync(this.file, JSON.stringify({ next: this.next, tickets: this.all }, null, 2) + '\n')
  }

  get(id) {
    const t = this.all.find((x) => x.id === Number(String(id).replace(/^#/, '')))
    if (!t) throw new Error(`no task #${String(id).replace(/^#/, '')} (try: clique task list)`)
    return t
  }

  // text: what you typed, split into title + body. Or title/body as given (an agent adding one).
  add({ text, title, body, images = [], by = 'you', owner, severity, kind = 'task' }) {
    const report = text !== undefined ? splitReport(text) : { title: String(title ?? '').trim(), body: String(body ?? '').trim() }
    if (!report.title) throw new Error('describe the task')
    // What was reported, word for word: triage rewrites title and details, but paths and repro steps must survive.
    report.report = text !== undefined ? String(text).trim() : [report.title, report.body].filter(Boolean).join('\n\n')
    const now = Date.now()
    const t = {
      id: this.next++, ...report, kind: KINDS.includes(kind) ? kind : 'task', severity: SEVERITIES.includes(severity) ? severity : 'normal', status: 'new',
      owner: owner || null, by, images, created: now, updated: now, seen: 1, triaged: false,
      log: [{ ts: now, by, text: kind === 'bug' ? 'reported it' : 'added it' }],
    }
    this.all.push(t)
    this.save()
    return t
  }

  // Title, body, owner, severity. Only what changed goes in the log.
  edit(id, patch, by) {
    const t = this.get(id)
    const changes = []
    if (patch.title !== undefined && String(patch.title).trim() && patch.title.trim() !== t.title) (t.title = patch.title.trim()), changes.push('retitled it')
    if (patch.body !== undefined && String(patch.body).trim() !== t.body) (t.body = String(patch.body).trim()), changes.push('updated the details')
    if (patch.severity !== undefined && patch.severity !== t.severity) {
      const severity = priorityOf(patch.severity)
      if (!severity) throw new Error('priority is one of: urgent, high, medium, low')
      if (severity !== t.severity) changes.push(`made it ${PRIORITY_NAME[severity]} priority`)
      t.severity = severity
    }
    if (patch.kind !== undefined && patch.kind !== t.kind) {
      if (!KINDS.includes(patch.kind)) throw new Error(`kind is one of: ${KINDS.join(', ')}`)
      t.kind = patch.kind
      changes.push(`made it a ${patch.kind}`)
    }
    if (patch.owner !== undefined && (patch.owner || null) !== t.owner) {
      t.owner = patch.owner || null
      changes.push(t.owner ? `gave it to @${t.owner}` : 'unassigned it')
    }
    if (patch.triaged) t.triaged = true
    if (patch.images) t.images = patch.images
    if (changes.length) this.log(t, by, changes.join(', '))
    else this.save()
    return t
  }

  move(id, status, by, text) {
    if (!STATUSES.includes(status)) throw new Error(`status is one of: ${STATUSES.join(', ')}`)
    const t = this.get(id)
    t.status = status
    this.log(t, by, text ?? `moved it to ${status}`)
    return t
  }

  note(id, by, text) {
    const t = this.get(id)
    text = String(text ?? '').trim()
    if (!text) throw new Error('nothing to note')
    this.log(t, by, text, 'note')
    return t
  }

  // The same bug reported twice: the original counts it, the copy closes pointing at it.
  dup(id, of, by) {
    const t = this.get(id)
    const original = this.get(of)
    if (t === original) throw new Error("a task can't duplicate itself")
    original.seen += t.seen
    original.images = [...new Set([...original.images, ...t.images])]
    if (t.body || t.title !== original.title) this.log(original, by, `seen again (#${t.id}): ${t.title}`, 'note')
    else this.log(original, by, `seen again (#${t.id})`)
    Object.assign(t, { status: 'done', dupOf: original.id })
    this.log(t, by, `duplicate of #${original.id}`)
    return original
  }

  remove(id) {
    const t = this.get(id)
    this.all = this.all.filter((x) => x !== t)
    this.save()
    return t
  }

  log(t, by, text, kind) {
    t.updated = Date.now()
    if (by !== 'clique') delete t.stalled // someone's on it again (see Hub.checkStalls)
    t.log.push({ ts: t.updated, by, text, ...(kind && { kind }) })
    if (t.log.length > 60) t.log.splice(1, t.log.length - 60) // keep the first entry (who reported it)
    this.save()
  }

  open() {
    return this.all.filter((t) => t.status !== 'done')
  }
}

// What an agent sees for `clique task list` and `clique task show`.
export const ticketLine = (t) =>
  `#${String(t.id).padEnd(4)} ${t.kind.padEnd(8)} ${t.status.padEnd(7)} ${PRIORITY_NAME[t.severity].padEnd(7)} ${(t.owner ? `@${t.owner}` : 'unassigned').padEnd(14)} ${t.title}${t.seen > 1 ? ` (seen ${t.seen}x)` : ''}`

// Triage rewrote the report: keep the original words next to the rewrite.
const reworded = (t) => t.report && t.report !== t.body && t.report !== t.title

export function ticketText(t) {
  const notes = t.log.filter((l) => l.kind === 'note').map((l) => `- ${l.by}: ${l.text}`)
  return [
    `#${t.id} ${t.title}`,
    `${t.kind} · status: ${t.status} · priority: ${PRIORITY_NAME[t.severity]} · owner: ${t.owner ? `@${t.owner}` : 'unassigned'} · added by ${t.by}${t.seen > 1 ? ` · seen ${t.seen}x` : ''}`,
    t.body && `\n${t.body}`,
    reworded(t) && `\nAs reported, word for word:\n${t.report}`,
    t.images.length && `\nScreenshots (open to view):\n${t.images.join('\n')}`,
    notes.length && `\nNotes:\n${notes.join('\n')}`,
    t.fix && `\nDone (${t.fixer ? `@${t.fixer}` : ''}): ${t.fix}`,
  ].filter(Boolean).join('\n') + '\n'
}

// The brief whoever picks a task up gets: everything about it, in a conversation of its own. `ref` is how the
// agent names it in `clique task` (12, or 12@laptop when it lives on another computer). `again`: you sent it back,
// and the agent is still in the conversation where it worked on it.
export function fixPrompt(t, ref, note, again) {
  const bug = t.kind === 'bug'
  const done = `Check it for real before you report it (run it, or its test). Then run: clique task done ${ref} "${bug ? 'what was wrong, what you changed' : 'what you did'}, how you checked"`
  if (again) return `[${t.kind} #${t.id}] Sent back: ${bug ? 'still broken' : 'not done yet'}.${note ? ` The user says: ${note}` : ''}\n\nTake another look. ${done}`
  // It goes to its owner as a message of yours, so what an agent wrote in it is marked as that agent's (core/framing.js):
  // a task an agent added, one triage put into its own words, a teammate's note.
  const theirs = t.by !== 'you' || (reworded(t) && !(t.report.includes(t.title) && t.report.includes(t.body ?? '')))
  const notes = t.log.filter((l) => l.kind === 'note').map((l) => `- ${l.by === 'you' ? `the user: ${l.text}` : `@${l.by}: ${defused(l.text)}`}`)
  return [
    `[${t.kind} #${t.id}] ${theirs ? defused(t.title) : t.title}`,
    `Priority: ${PRIORITY_NAME[t.severity]}. ${bug ? 'Reported' : 'Added'} by ${t.by === 'you' ? 'the user' : `@${t.by}`}${t.seen > 1 ? `, seen ${t.seen} times` : ''}.`,
    t.body && t.body !== t.title && `\n${theirs ? relayed(t.by === 'you' ? 'triage' : t.by, t.body) : t.body}`,
    reworded(t) && `\nThe user's words, as written:\n${t.report}`,
    notes.length && `\nNotes so far:\n${notes.join('\n')}`,
    note && `\nThe user adds: ${note}`,
    `\nThis conversation is just for this ${t.kind}. ${bug ? 'Reproduce it, find the cause, fix it.' : 'Do it, and keep to what it asks.'}`,
    `Stay in your own project. If it isn't clear ${bug ? 'where the bug lives and you can\'t find it there' : 'what is wanted or where it goes'}, don't guess and don't change other code:`,
    `run clique task note ${ref} "what you looked at, what you need to know" and stop.${bug ? " Same if you can't reproduce it." : ''}`,
    `If it isn't yours to do (not your area, or you can't take it), run clique task decline ${ref} "why" and stop: CLIque gives it to whoever's area it is.`,
    done,
  ].filter(Boolean).join('\n')
}

// For the triage agent: turn what the user typed into a task someone can act on. No doing it.
export const triagePrompt = (t, ref) =>
  [
    `[${t.kind} #${t.id} to triage] ${t.body || t.title}`,
    '',
    `Triage this ${t.kind === 'bug' ? 'bug report' : 'task'} the user just added. Don't do it yourself.`,
    `1. If it's the same as an open task (clique task list), run: clique task dup ${ref} <that task's number>`,
    '2. Otherwise make it clear and give it to the agent whose area it is and who is on (clique who).',
    '   Keep every concrete detail from what the user wrote: file paths, commands, steps, numbers, devices.',
    `   clique task triage ${ref} --owner <name> --priority <urgent|high|medium|low> --kind <bug|feature|task> --title "short title" --details "${t.kind === 'bug' ? 'steps to reproduce, expected, actual' : 'what is wanted, how to tell it is done'}, where to look"`,
    'Keep it short. Urgent means it blocks the user right now.',
  ].join('\n')

// Quick triage (core/savers.js quickTriage): the same job in one short call with no tools, so everything it needs is
// written in, and the answer is one JSON object (readTriage). `open`: the other open tasks; `clique`: who can own it.
export function quickTriagePrompt(t, open, clique) {
  const bug = t.kind === 'bug'
  return [
    `You triage tasks for a clique of AI coding agents. Answer with one JSON object and nothing else.`,
    '',
    `The ${bug ? 'bug report' : 'task'} the user just added (#${t.id}):`,
    t.report || [t.title, t.body].filter(Boolean).join('\n\n'),
    t.images.length ? `(with ${t.images.length === 1 ? 'a screenshot' : `${t.images.length} screenshots`})` : '',
    '',
    'Open tasks:',
    open.length ? open.map(ticketLine).join('\n') : '(none)',
    '',
    'Agents who can own it (name, status, area):',
    clique.length ? clique.map((a) => `${a.name}  ${a.status}  ${a.area || 'general'}`).join('\n') : '(none)',
    '',
    'If it is the same as one of the open tasks: {"dup": <that task\'s number>}',
    `Otherwise: {"owner": "<the agent whose area it is, or null>", "priority": "urgent|high|medium|low", "kind": "bug|feature|task", "title": "<short title>", "details": "<${bug ? 'steps to reproduce, expected, actual' : 'what is wanted, how to tell it is done'}, where to look>"}`,
    'Keep every concrete detail the user wrote: file paths, commands, steps, numbers, devices. Urgent means it blocks the user right now.',
  ].join('\n').replace(/\n{3,}/g, '\n\n')
}

// What quick triage answered: { dup } or { owner, priority, kind, title, details }, or null when it isn't one of those.
export function readTriage(text) {
  let d
  try {
    d = JSON.parse(String(text ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '')
  } catch {
    return null
  }
  if (!d || typeof d !== 'object') return null
  const dup = Number(String(d.dup ?? '').replace(/^#/, ''))
  if (Number.isInteger(dup) && dup > 0) return { dup }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const owner = str(d.owner, 60).replace(/^@/, '')
  const out = { owner: owner && owner !== 'null' ? owner : null, priority: String(d.priority ?? '').toLowerCase(), kind: String(d.kind ?? '').toLowerCase(), title: str(d.title, 120), details: str(d.details, 4000) }
  return priorityOf(out.priority) && KINDS.includes(out.kind) && out.title ? out : null
}

export const TASK_HELP = `clique task list                    open tasks
clique task show <n>                one task in full: details, screenshots, notes
clique task done <n> "..."          you did it: what you did (or what was wrong), how you checked
clique task note <n> "..."          add what you found (unclear, can't reproduce, a clue)
clique task decline <n> "why"       it isn't yours (not your area, can't take it): CLIque gives it to the next owner by area
clique task add "title" "..."       add a task (--kind bug|feature|task, --priority, --owner)
clique task triage <n> --owner <name> --priority <urgent|high|medium|low> [--kind] [--title "..."] [--details "..."]
clique task dup <n> <original>      it's the same as another task
(clique bug ... works too)
`

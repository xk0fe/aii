// Bugs: what you call out while play-testing, as tickets that move new → fixing → check → done. A ticket
// carries everything a fresh conversation needs to fix it (what happened, screenshots, notes), so the agent
// fixing it doesn't need anyone's chat history. Stored in ~/.crew/tickets.json. No Electron in here.
import fs from 'node:fs'

export const STATUSES = ['new', 'fixing', 'check', 'done']
export const SEVERITIES = ['blocker', 'high', 'normal', 'low']
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
    this.all = data.tickets ?? []
  }

  save() {
    const done = this.all.filter((t) => t.status === 'done')
    if (done.length > KEEP_DONE) {
      const drop = new Set(done.sort((x, y) => x.updated - y.updated).slice(0, done.length - KEEP_DONE))
      this.all = this.all.filter((t) => !drop.has(t))
    }
    fs.writeFileSync(this.file, JSON.stringify({ next: this.next, tickets: this.all }, null, 2) + '\n')
  }

  get(id) {
    const t = this.all.find((x) => x.id === Number(String(id).replace(/^#/, '')))
    if (!t) throw new Error(`no bug #${String(id).replace(/^#/, '')} (try: crew bug list)`)
    return t
  }

  // text: what you typed, split into title + body. Or title/body as given (an agent filing one).
  add({ text, title, body, images = [], by = 'you', owner, severity }) {
    const report = text !== undefined ? splitReport(text) : { title: String(title ?? '').trim(), body: String(body ?? '').trim() }
    if (!report.title) throw new Error('describe the bug')
    // What was reported, word for word: triage rewrites title and details, but paths and repro steps must survive.
    report.report = text !== undefined ? String(text).trim() : [report.title, report.body].filter(Boolean).join('\n\n')
    const now = Date.now()
    const t = {
      id: this.next++, ...report, severity: SEVERITIES.includes(severity) ? severity : 'normal', status: 'new',
      owner: owner || null, by, images, created: now, updated: now, seen: 1, triaged: false,
      log: [{ ts: now, by, text: 'reported it' }],
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
      if (!SEVERITIES.includes(patch.severity)) throw new Error(`severity is one of: ${SEVERITIES.join(', ')}`)
      t.severity = patch.severity
      changes.push(`marked it ${patch.severity}`)
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
    if (t === original) throw new Error("a bug can't duplicate itself")
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
    t.log.push({ ts: t.updated, by, text, ...(kind && { kind }) })
    if (t.log.length > 60) t.log.splice(1, t.log.length - 60) // keep the first entry (who reported it)
    this.save()
  }

  open() {
    return this.all.filter((t) => t.status !== 'done')
  }
}

// What an agent sees for `crew bug list` and `crew bug show`.
export const ticketLine = (t) =>
  `#${String(t.id).padEnd(4)} ${t.status.padEnd(7)} ${t.severity.padEnd(8)} ${(t.owner ? `@${t.owner}` : 'unassigned').padEnd(14)} ${t.title}${t.seen > 1 ? ` (seen ${t.seen}x)` : ''}`

export function ticketText(t) {
  const notes = t.log.filter((l) => l.kind === 'note').map((l) => `- ${l.by}: ${l.text}`)
  return [
    `#${t.id} ${t.title}`,
    `status: ${t.status} · severity: ${t.severity} · owner: ${t.owner ? `@${t.owner}` : 'unassigned'} · reported by ${t.by}${t.seen > 1 ? ` · seen ${t.seen}x` : ''}`,
    t.body && `\n${t.body}`,
    reworded(t) && `\nAs reported, word for word:\n${t.report}`,
    t.images.length && `\nScreenshots (open to view):\n${t.images.join('\n')}`,
    notes.length && `\nNotes:\n${notes.join('\n')}`,
    t.fix && `\nFix (${t.fixer ? `@${t.fixer}` : ''}): ${t.fix}`,
  ].filter(Boolean).join('\n') + '\n'
}

// The task a fixer gets: everything about the bug, in a conversation of its own. `ref` is how the agent names
// the bug in `crew bug` (12, or 12@air when the bug was filed on another computer). `again`: it's still broken
// and the agent is still in the conversation where it tried.
// Triage rewrote the report: keep the original words next to the rewrite.
const reworded = (t) => t.report && t.report !== t.body && t.report !== t.title

export function fixPrompt(t, ref, note, again) {
  const done = `Check the fix for real before you report it (run it, or its test). Then run: crew bug fixed ${ref} "what was wrong, what you changed, how you checked"`
  if (again) return `[bug #${t.id}] Still broken after your fix.${note ? ` The user says: ${note}` : ''}\n\nTake another look. ${done}`
  const notes = t.log.filter((l) => l.kind === 'note').map((l) => `- ${l.by === 'you' ? 'the user' : `@${l.by}`}: ${l.text}`)
  return [
    `[bug #${t.id}] ${t.title}`,
    `Severity: ${t.severity}. Reported by ${t.by === 'you' ? 'the user' : `@${t.by}`}${t.seen > 1 ? `, seen ${t.seen} times` : ''}.`,
    t.body && t.body !== t.title && `\n${t.body}`,
    reworded(t) && `\nThe user's report, word for word:\n${t.report}`,
    notes.length && `\nNotes so far:\n${notes.join('\n')}`,
    note && `\nThe user adds: ${note}`,
    '\nThis conversation is just for this bug. Reproduce it, find the cause, fix it.',
    "Stay in your own project. If it isn't clear where the bug lives and you can't find it there, don't guess and don't change other code:",
    `run crew bug note ${ref} "where you looked, what you need to know" and stop. Same if it isn't in your area or you can't reproduce it.`,
    done,
  ].filter(Boolean).join('\n')
}

// For the triage agent: turn what the user typed mid-game into a ticket someone can act on. No fixing.
export const triagePrompt = (t, ref) =>
  [
    `[bug #${t.id} to triage] ${t.body || t.title}`,
    '',
    "Triage this bug the user just called out. Don't fix it.",
    `1. If it's the same as an open bug (crew bug list), run: crew bug dup ${ref} <that bug's number>`,
    '2. Otherwise make it a clear ticket and give it to the agent whose area it is (crew who).',
    '   Keep every concrete detail from the report: file paths, commands, steps, numbers, devices.',
    `   crew bug triage ${ref} --owner <name> --severity <blocker|high|normal|low> --title "short title" --details "steps to reproduce, expected, actual, where to look"`,
    'Keep it short. Blocker means it stops the game or the test.',
  ].join('\n')

export const BUG_HELP = `crew bug list                     open bugs
crew bug show <n>                 one bug in full: details, screenshots, notes
crew bug fixed <n> "..."          you fixed it: what was wrong, what you changed, how you checked
crew bug note <n> "..."           add what you found (can't reproduce, not your area, a clue)
crew bug report "title" "..."     report a bug you found yourself
crew bug triage <n> --owner <name> --severity <blocker|high|normal|low> [--title "..."] [--details "..."]
crew bug dup <n> <original>       it's the same bug as another one
`

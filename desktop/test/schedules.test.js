// Scheduled messages (core/schedules.js, Clique.runSchedules): a message you'd send, sent for you at a time, once or on
// a repeat. The rules in wall-clock time (clock changes included), and what a run does: goes out through Clique.send
// marked as scheduled, skips while the run before is still going, runs once and says so when it's late, never in a
// burst, and can't make schedules itself. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-schedules-'))
const { CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
const { Schedules, nextRun, wallToMs, wallAt, ruleFromWords, ruleText, timeOf, dateOf, dateIn, repoMark, inRepo, zoneNow, LATE_MAX } = await import('../core/schedules.js')

const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-schedules-repo-'))
fs.writeFileSync(CONFIG, JSON.stringify({
  autopilot: true,
  agents: [{ name: 'iris', area: 'ui/ux designer' }, { name: 'june', area: 'Senior Backend SWE' }, { name: 'rex', area: 'release', yolo: true }],
  workspaces: [
    { id: 'shop', name: 'Shop', folder: FOLDER, members: { iris: {}, june: {}, rex: {} }, channels: [{ id: 'reviews', name: 'reviews', members: ['june'] }] },
    { id: 'lab', name: 'Lab', members: { iris: {} } },
  ],
}))

const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
Object.assign(clique.runner, { running: () => true, quietFor: () => Infinity, submit() {}, write() {} })
const quiet = () => {
  for (const hub of clique.hubs.values()) {
    for (const a of hub.agents.values()) for (const t of ['ack', 'timer', 'steerTimer', 'readyTimer', 'retryTimer']) clearTimeout(a[t])
    for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(hub[t])
  }
  clearTimeout(clique.changeTimer)
}
after(async () => {
  quiet()
  await Promise.all([...clique.hubs.values()].map((h) => h.saving))
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(FOLDER, { recursive: true, force: true, maxRetries: 10 })
})

const TZ = zoneNow()
const shop = () => clique.hubs.get('shop')
const lab = () => clique.hubs.get('lab')
// the clock: tests say what time it is, as this computer's clocks would show it
let now = 0
clique.clock = () => now
const at = (date, time) => {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return wallToMs({ y, mo, d, h, mi }, TZ)
}
const MIN = 60000
const HOUR = 60 * MIN
const sent = (hub = shop()) => hub.feed.filter((e) => e.kind === 'msg' && e.scheduled)
const lines = (hub = shop()) => hub.feed.filter((e) => e.kind === 'event' && e.schedule).map((e) => e.text)
// every agent busy on something else: what's sent waits in its queue
const busy = (hub = shop()) => {
  for (const a of hub.agents.values()) a.status = 'working'
}
// ...and everything anyone had is done
const finish = (hub = shop()) => {
  for (const a of hub.agents.values()) Object.assign(a, { status: 'idle', inbox: [], serving: [], expect: undefined, current: undefined })
  for (const e of hub.feed) if (e.kind === 'msg') e.queued = false
  quiet()
}
const reset = (hub = shop()) => {
  finish(hub)
  hub.feed.length = 0
  hub.schedules.all.length = 0
  hub.schedules.save()
}
const iso = (ms) => new Date(ms).toISOString()

test('the rule: next run for once, every day, weekdays and weekly, from its first day', () => {
  const z = 'UTC'
  const t = (s) => Date.parse(s)
  assert.equal(iso(nextRun({ repeat: 'once', date: '2026-11-17', time: '09:00' }, t('2026-11-16T12:00Z'), z)), '2026-11-17T09:00:00.000Z')
  assert.equal(nextRun({ repeat: 'once', date: '2026-11-17', time: '09:00' }, t('2026-11-17T09:00Z'), z), null) // its time is not "after" itself
  // every day: today while its time is ahead, tomorrow once it's gone, and not before its first day
  assert.equal(iso(nextRun({ repeat: 'daily', date: '2026-11-10', time: '09:00' }, t('2026-11-16T08:59Z'), z)), '2026-11-16T09:00:00.000Z')
  assert.equal(iso(nextRun({ repeat: 'daily', date: '2026-11-10', time: '09:00' }, t('2026-11-16T09:00Z'), z)), '2026-11-17T09:00:00.000Z')
  assert.equal(iso(nextRun({ repeat: 'daily', date: '2026-11-20', time: '09:00' }, t('2026-11-16T09:00Z'), z)), '2026-11-20T09:00:00.000Z')
  // weekdays: Friday's run is followed by Monday's (2026-11-20 is a Friday)
  assert.equal(iso(nextRun({ repeat: 'weekdays', date: '2026-11-10', time: '09:00' }, t('2026-11-20T09:00Z'), z)), '2026-11-23T09:00:00.000Z')
  assert.equal(iso(nextRun({ repeat: 'weekdays', date: '2026-11-21', time: '09:00' }, t('2026-11-16T00:00Z'), z)), '2026-11-23T09:00:00.000Z') // first day a Saturday
  // weekly: on its first day's day of the week (2026-11-18 is a Wednesday)
  assert.equal(iso(nextRun({ repeat: 'weekly', date: '2026-11-18', time: '17:30' }, t('2026-11-18T17:30Z'), z)), '2026-11-25T17:30:00.000Z')
  assert.equal(iso(nextRun({ repeat: 'weekly', date: '2026-11-18', time: '17:30' }, t('2026-11-22T00:00Z'), z)), '2026-11-25T17:30:00.000Z')
  // a zone ahead of UTC: "today" is that zone's day
  assert.equal(iso(nextRun({ repeat: 'daily', date: '2026-01-01', time: '09:00' }, t('2026-11-16T23:30Z'), 'Asia/Tokyo')), '2026-11-17T00:00:00.000Z')
  assert.equal(ruleText({ repeat: 'weekly', date: '2026-11-18', time: '17:30' }), 'every Wednesday at 17:30')
  assert.equal(ruleText({ repeat: 'once', date: '2026-11-17', time: '09:00' }), 'once, Tue 17 Nov at 9:00')
})

test('clock changes: 9:00 stays 9:00, a skipped time runs an hour on, a repeated one runs once', () => {
  const t = (s) => Date.parse(s)
  const daily = (time) => ({ repeat: 'daily', date: '2026-01-01', time })
  // New York springs forward on 2026-03-08 (02:00 -> 03:00) and falls back on 2026-11-01 (02:00 -> 01:00)
  const ny = 'America/New_York'
  assert.equal(iso(nextRun(daily('09:00'), t('2026-03-07T15:00Z'), ny)), '2026-03-08T13:00:00.000Z') // 9:00 EDT, 23 hours after the last 9:00 EST
  assert.equal(iso(nextRun(daily('09:00'), t('2026-10-31T14:00Z'), ny)), '2026-11-01T14:00:00.000Z') // 9:00 EST, 25 hours on
  // 02:30 doesn't happen on 8 March: it runs at 03:30, once, and at 02:30 again the day after
  assert.equal(iso(nextRun(daily('02:30'), t('2026-03-08T05:00Z'), ny)), '2026-03-08T07:30:00.000Z')
  assert.equal(iso(nextRun(daily('02:30'), t('2026-03-08T07:30Z'), ny)), '2026-03-09T06:30:00.000Z')
  // 01:30 happens twice on 1 November: it runs at the first, and not again at the second
  assert.equal(iso(nextRun(daily('01:30'), t('2026-11-01T04:00Z'), ny)), '2026-11-01T05:30:00.000Z')
  assert.equal(iso(nextRun(daily('01:30'), t('2026-11-01T05:30Z'), ny)), '2026-11-02T06:30:00.000Z')
  assert.equal(iso(nextRun(daily('01:30'), t('2026-11-01T06:29Z'), ny)), '2026-11-02T06:30:00.000Z') // asked during the second 01:xx hour
  // Berlin (east of UTC): forward on 2026-03-29 (02:00 -> 03:00), back on 2026-10-25 (03:00 -> 02:00)
  const berlin = 'Europe/Berlin'
  assert.equal(iso(wallToMs({ y: 2026, mo: 3, d: 29, h: 2, mi: 30 }, berlin)), '2026-03-29T01:30:00.000Z') // 03:30 CEST
  assert.equal(iso(wallToMs({ y: 2026, mo: 10, d: 25, h: 2, mi: 30 }, berlin)), '2026-10-25T00:30:00.000Z') // the first 02:30 (CEST)
  assert.equal(iso(nextRun(daily('02:30'), t('2026-10-25T00:30Z'), berlin)), '2026-10-26T01:30:00.000Z')
  assert.equal(iso(nextRun({ repeat: 'weekdays', date: '2026-01-01', time: '09:00' }, t('2026-03-27T08:00Z'), berlin)), '2026-03-30T07:00:00.000Z') // Friday 9:00 CET -> Monday 9:00 CEST
  // a zone with a half-hour change (Lord Howe: back 30 minutes on 2026-04-05 at 02:00)
  assert.deepEqual(wallAt(wallToMs({ y: 2026, mo: 4, d: 5, h: 1, mi: 45 }, 'Australia/Lord_Howe'), 'Australia/Lord_Howe'), { y: 2026, mo: 4, d: 5, h: 1, mi: 45, dow: 0 })
  // a year of daily runs through both changes: one a day, each at 9:00 on the clock
  let at = t('2026-01-01T00:00Z')
  const days = new Set()
  for (let i = 0; i < 365; i++) {
    at = nextRun(daily('09:00'), at, ny)
    const w = wallAt(at, ny)
    assert.equal(`${w.h}:${w.mi}`, '9:0')
    days.add(`${w.y}-${w.mo}-${w.d}`)
  }
  assert.equal(days.size, 365)
})

test('when, as an agent says it: --at, --every, --on', () => {
  const mon = Date.parse('2026-11-16T12:00Z') // a Monday
  const words = (w) => ruleFromWords(w, mon, 'UTC')
  assert.deepEqual(words({ at: '9', every: 'weekday' }), { repeat: 'weekdays', date: '2026-11-17', time: '09:00' })
  assert.deepEqual(words({ at: '17:30', every: 'day' }), { repeat: 'daily', date: '2026-11-16', time: '17:30' }) // still ahead today
  assert.deepEqual(words({ at: '9am', every: 'Mondays' }), { repeat: 'weekly', date: '2026-11-23', time: '09:00' }) // today's 9:00 has gone
  assert.deepEqual(words({ at: '5:30pm', every: 'monday' }), { repeat: 'weekly', date: '2026-11-16', time: '17:30' })
  assert.deepEqual(words({ at: '9:00' }), { repeat: 'once', date: '2026-11-17', time: '09:00' }) // the next 9:00
  assert.deepEqual(words({ at: '9:00', on: 'tomorrow' }), { repeat: 'once', date: '2026-11-17', time: '09:00' })
  assert.deepEqual(words({ at: '9:00', on: 'friday' }), { repeat: 'once', date: '2026-11-20', time: '09:00' })
  assert.deepEqual(words({ at: '12am', on: '2026-12-01' }), { repeat: 'once', date: '2026-12-01', time: '00:00' })
  assert.throws(() => words({ at: '9:00', on: 'today' }), /has passed already/)
  assert.throws(() => words({ at: '9:00', every: 'fortnight' }), /--every is day, weekday/)
  assert.throws(() => words({ at: '9:00', every: 'monday', on: '2026-11-24' }), /isn't a Monday/)
  assert.throws(() => words({ at: 'soon' }), /give the time like 9:00/)
  assert.throws(() => timeOf('25:00'), /no 25:00 on the clock/)
  assert.throws(() => timeOf('13pm'), /no 13pm/)
  assert.throws(() => dateOf('2026-02-30'), /no such day/)
  assert.equal(dateIn(Date.parse('2026-11-16T23:30Z'), 'Asia/Tokyo', 1), '2026-11-18')
})

test('scheduling: it lists with its next time, survives a restart, and the same one twice is one', async () => {
  reset()
  now = at('2026-11-16', '12:00')
  const a = await clique.scheduleAction('add', null, { text: 'check CI', to: 'iris', repeat: 'weekdays', date: '2026-11-17', time: '09:00' }, 'shop')
  const state = clique.snapshot(shop())
  assert.equal(state.schedules.list.length, 1)
  assert.deepEqual({ ...state.schedules.list[0] }, { id: a.id, text: 'check CI', to: 'iris', repeat: 'weekdays', date: '2026-11-17', time: '09:00', by: 'you', created: now, next: at('2026-11-17', '09:00') })
  assert.equal(lab().schedules.all.length, 0) // a workspace's own
  // the same words, to the same agent, on the same rule (any first day, for a repeat): kept as the one there is
  const again = await clique.scheduleAction('add', null, { text: ' check   CI ', to: '@iris', repeat: 'weekdays', date: '2026-11-18', time: '9:00' }, 'shop')
  assert.equal(again.same, true)
  assert.equal(again.id, a.id)
  assert.equal(shop().schedules.all.length, 1)
  // another time, or another agent, is another schedule
  await clique.scheduleAction('add', null, { text: 'check CI', to: 'iris', repeat: 'weekdays', date: '2026-11-17', time: '10:00' }, 'shop')
  await clique.scheduleAction('add', null, { text: 'check CI', to: 'june', repeat: 'weekdays', date: '2026-11-17', time: '09:00' }, 'shop')
  assert.equal(shop().schedules.all.length, 3)
  // on disk, beside the workspace's chat: what the next launch reads
  const file = path.join(process.env.CLIQUE_HOME, 'workspaces', 'shop', 'schedules.json')
  assert.deepEqual(new Schedules(file).all.map((s) => [s.text, s.to, s.time, s.next]), shop().schedules.all.map((s) => [s.text, s.to, s.time, s.next]))
  // what can't work is said when it's made, not at 9:00
  await assert.rejects(clique.scheduleAction('add', null, { text: 'x', to: 'nobody', repeat: 'once', date: '2026-11-17', time: '09:00' }, 'shop'), /no agent named "nobody"/)
  await assert.rejects(clique.scheduleAction('add', null, { text: 'x', to: 'iris', repeat: 'once', date: '2026-11-16', time: '09:00' }, 'shop'), /has passed already/)
  await assert.rejects(clique.scheduleAction('add', null, { text: '  ', to: 'iris', repeat: 'once', date: '2026-11-17', time: '09:00' }, 'shop'), /write the message/)
  await assert.rejects(clique.scheduleAction('add', null, { text: 'x', to: 'iris', repeat: 'hourly', date: '2026-11-17', time: '09:00' }, 'shop'), /repeats once, daily, weekdays, weekly/)
})

test('when it comes due it goes out as your message through Clique.send, marked scheduled, and waits for its next time', async () => {
  reset()
  now = at('2026-11-16', '12:00')
  const { id } = await clique.scheduleAction('add', null, { text: 'check CI', to: 'iris', repeat: 'weekdays', date: '2026-11-17', time: '09:00' }, 'shop')
  const once = await clique.scheduleAction('add', null, { text: 'ship the notes', repeat: 'once', date: '2026-11-17', time: '09:00', channel: 'reviews' }, 'shop')
  busy()
  now = at('2026-11-17', '08:59')
  await clique.runSchedules()
  assert.equal(sent().length, 0) // not before its time
  now = at('2026-11-17', '09:00') + 5000
  await clique.runSchedules()
  const [a, b] = sent()
  assert.deepEqual([a.from, a.to, a.text, a.scheduled, a.queued], ['you', 'iris', 'check CI', { id, at: now }, true])
  assert.equal(shop().agents.get('iris').inbox.includes(a), true) // in her queue, like anything you send
  // nobody named, said in #reviews: Auto picks from that channel's members, as when you send it yourself
  assert.deepEqual([b.from, b.to, b.channel, b.auto, b.scheduled.id], ['you', 'june', 'reviews', true, once.id])
  // the repeating one waits for tomorrow; the one-off is done and gone from the list
  assert.deepEqual(shop().schedules.all.map((s) => [s.id, s.next, s.last.result]), [[id, at('2026-11-18', '09:00'), 'sent']])
  await clique.runSchedules()
  assert.equal(sent().length, 2) // looked at again a moment later: nothing more
})

test('a repeating one skips while its last run is still going, and says so once', async () => {
  reset()
  now = at('2026-11-16', '12:00')
  const { id } = await clique.scheduleAction('add', null, { text: 'check CI', to: 'iris', repeat: 'daily', date: '2026-11-17', time: '09:00' }, 'shop')
  busy()
  now = at('2026-11-17', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 1)
  // a day on, Monday's is still in iris's queue
  now = at('2026-11-18', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 1)
  assert.equal(lines().length, 1)
  assert.match(lines()[0], /^Scheduled message "check CI" skipped this time: its last run is still going\. It goes out again once that's done \(next: Thu 19 Nov at 9:00\)$/)
  assert.equal(shop().schedules.get(id).last.result, 'busy')
  // ...and she's taken it up and is waiting on you: still going, and not said again
  const iris = shop().agents.get('iris')
  Object.assign(iris, { status: 'waiting', inbox: [], serving: [sent()[0]], current: sent()[0].id })
  sent()[0].queued = false
  now = at('2026-11-19', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 1)
  assert.equal(lines().length, 1)
  // ...or she handed it on to june, who's working on it
  Object.assign(iris, { status: 'idle', serving: [] })
  const handoff = shop().post({ kind: 'msg', from: 'iris', to: 'june', text: 'CI is red on main, have a look', re: sent()[0].id, queued: true })
  now = at('2026-11-20', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 1)
  // once that's done, the next one goes out, and a later skip would be said again
  handoff.queued = false
  finish()
  busy()
  now = at('2026-11-21', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 2)
  assert.equal(shop().schedules.get(id).told, undefined)
})

test('late: it runs once when CLIque is back and says it went late; too late and it is skipped with one line; never a burst', async () => {
  reset()
  now = at('2026-11-16', '12:00')
  const { id } = await clique.scheduleAction('add', null, { text: 'check CI', to: 'iris', repeat: 'daily', date: '2026-11-17', time: '09:00' }, 'shop')
  const one = await clique.scheduleAction('add', null, { text: 'call the landlord', to: 'june', repeat: 'once', date: '2026-11-17', time: '09:00' }, 'shop')
  // the computer slept through 9:00 and woke at 9:40: each goes out once, marked with when it was due
  const due = at('2026-11-17', '09:00')
  now = due + 40 * MIN
  await clique.runSchedules()
  assert.deepEqual(sent().map((m) => [m.to, m.scheduled.late]), [['iris', due], ['june', due]])
  assert.deepEqual(shop().schedules.get(id).last, { at: now, result: 'late', due })
  assert.equal(shop().schedules.get(id).next, at('2026-11-18', '09:00'))
  finish()
  // closed for five days, opened in the evening: not five runs, and not one that's hours stale. One line about the
  // latest of them, and the next run is ahead
  now = at('2026-11-23', '15:30')
  assert.ok(now - at('2026-11-23', '09:00') > LATE_MAX)
  await clique.runSchedules()
  await clique.runSchedules()
  assert.equal(sent().length, 2)
  assert.deepEqual(lines(), ['Scheduled message "check CI" wasn\'t sent: it was due Mon 23 Nov at 9:00, while CLIque was closed or this computer was asleep. Next: Tue 24 Nov at 9:00'])
  assert.equal(shop().schedules.get(id).last.result, 'missed')
  // closed for days again, opened half an hour after a run was due: that one run, late, and only that one
  finish()
  now = at('2026-11-28', '09:30')
  await clique.runSchedules()
  await clique.runSchedules()
  assert.equal(sent().length, 3)
  assert.equal(sent()[2].scheduled.late, at('2026-11-28', '09:00'))
  assert.equal(shop().schedules.get(id).next, at('2026-11-29', '09:00'))
  assert.equal(lines().length, 1)
  // a one-off that's missed stays in the list to send by hand or remove; sending it now sends it
  reset()
  now = at('2026-11-16', '12:00')
  const missed = await clique.scheduleAction('add', null, { text: 'call the landlord', to: 'june', repeat: 'once', date: '2026-11-17', time: '09:00' }, 'shop')
  now = at('2026-11-18', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 0)
  assert.match(lines()[0], /wasn't sent: it was due Tue 17 Nov at 9:00, .* Send it now from Scheduled messages, or remove it$/)
  assert.deepEqual([shop().schedules.get(missed.id).next, shop().schedules.get(missed.id).last.result], [null, 'missed'])
  await clique.scheduleAction('now', missed.id, null, 'shop')
  assert.deepEqual(sent().map((m) => [m.to, m.text, m.scheduled.late]), [['june', 'call the landlord', undefined]])
  assert.equal(shop().schedules.all.length, 0)
  assert.ok(one.id)
})

test('pause and resume: paused sends nothing, resumed runs from its next time; edit and remove', async () => {
  reset()
  now = at('2026-11-16', '12:00')
  const { id } = await clique.scheduleAction('add', null, { text: 'check CI', to: 'iris', repeat: 'daily', date: '2026-11-17', time: '09:00' }, 'shop')
  await clique.scheduleAction('pause', id, null, 'shop')
  now = at('2026-11-19', '09:01')
  await clique.runSchedules()
  assert.equal(sent().length, 0)
  assert.equal(lines().length, 0) // paused is your doing: nothing to say
  const { state } = await clique.scheduleAction('resume', id, null, 'shop')
  assert.ok(Array.isArray(state.schedules.list)) // the app redraws from what comes back
  assert.equal(shop().schedules.get(id).next, at('2026-11-20', '09:00')) // not the ones that went by
  await clique.runSchedules()
  assert.equal(sent().length, 0)
  // edit: other words, another agent, another time
  await clique.scheduleAction('edit', id, { text: 'check CI and the nightly', to: 'june', repeat: 'weekly', date: '2026-11-20', time: '08:30' }, 'shop')
  const s = shop().schedules.get(id)
  assert.deepEqual([s.text, s.to, s.repeat, s.next], ['check CI and the nightly', 'june', 'weekly', at('2026-11-20', '08:30')])
  // send now: goes out whatever its time, and its next time stays
  await clique.scheduleAction('now', id, null, 'shop')
  assert.deepEqual(sent().map((m) => [m.to, m.text]), [['june', 'check CI and the nightly']])
  assert.equal(shop().schedules.get(id).next, at('2026-11-20', '08:30'))
  await clique.scheduleAction('remove', id, null, 'shop')
  await assert.rejects(clique.scheduleAction('pause', id, null, 'shop'), /no schedule/)
  now = at('2026-11-27', '08:30')
  await clique.runSchedules()
  assert.equal(sent().length, 1)
})

test("a delivery that fails posts one line naming the schedule and what stopped it; an agent's new name is followed", async () => {
  reset()
  now = at('2026-11-16', '12:00')
  const { id } = await clique.scheduleAction('add', null, { text: 'check CI', to: 'june', repeat: 'daily', date: '2026-11-17', time: '09:00' }, 'shop')
  shop().agents.get('june').off = true
  now = at('2026-11-17', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 0)
  assert.deepEqual(lines(), ['Scheduled message "check CI" (every day at 9:00) didn\'t go out: @june is turned off, turn it on first'])
  assert.deepEqual([shop().schedules.get(id).last.result, shop().schedules.get(id).next], ['failed', at('2026-11-18', '09:00')])
  shop().agents.get('june').off = false
  // renamed: what was scheduled for june is for juno
  shop().schedules.rename('june', 'juno')
  assert.equal(shop().schedules.get(id).to, 'juno')
  shop().schedules.rename('juno', 'june')
  now = at('2026-11-18', '09:00')
  await clique.runSchedules()
  assert.deepEqual(sent().map((m) => m.to), ['june'])
})

test('a workspace that is asleep wakes for it, as it does for a message you send', async () => {
  reset(lab())
  now = at('2026-11-16', '12:00')
  await clique.scheduleAction('add', null, { text: 'tidy the bench', to: 'iris', repeat: 'once', date: '2026-11-17', time: '09:00' }, 'lab')
  clique.workspaceAction('park', 'lab')
  assert.equal(lab().space.parked, true)
  now = at('2026-11-17', '09:00')
  await clique.runSchedules()
  assert.equal(lab().space.parked, false)
  assert.deepEqual(sent(lab()).map((m) => [m.to, m.text]), [['iris', 'tidy the bench']])
  finish(lab())
})

const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: FOLDER, stdio: 'pipe' })
let hasGit = true
try {
  execFileSync('git', ['--version'], { stdio: 'pipe' })
} catch {
  hasGit = false
}

test('only when the repo changed: skipped without a word while HEAD and the changed files are as its last run left them', { skip: !hasGit && 'no git here' }, async () => {
  reset()
  assert.equal(await repoMark(FOLDER), null) // not a repo yet: nothing to go by
  git('init', '-q')
  fs.writeFileSync(path.join(FOLDER, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  assert.equal(inRepo(FOLDER, Date.now() + 120000), true)
  assert.equal(clique.snapshot(shop()).schedules.repo, true)
  now = at('2026-11-16', '12:00')
  const { id } = await clique.scheduleAction('add', null, { text: 'review what changed', to: 'iris', repeat: 'daily', date: '2026-11-17', time: '09:00', ifChanged: true }, 'shop')
  const s = () => shop().schedules.get(id)
  // the first run always goes
  now = at('2026-11-17', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 1)
  // while it's going the repo isn't read; once it's done, how the repo is then is what "unchanged" means. The agent's
  // own edit during the run is part of that
  busy()
  fs.writeFileSync(path.join(FOLDER, 'notes.md'), 'reviewed\n')
  now += MIN
  await clique.runSchedules()
  assert.equal(s().mark, undefined)
  finish()
  now += MIN
  await clique.runSchedules()
  assert.equal(s().mark, await repoMark(FOLDER))
  // next morning nothing has moved: no message, no line in the chat
  now = at('2026-11-18', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 1)
  assert.equal(lines().length, 0)
  assert.equal(s().last.result, 'unchanged')
  // an edit to a file that was already changed (git status reads the same) counts
  fs.writeFileSync(path.join(FOLDER, 'notes.md'), 'reviewed, twice over\n')
  now = at('2026-11-19', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 2)
  finish()
  now += MIN
  await clique.runSchedules()
  // a commit counts
  now = at('2026-11-20', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 2)
  git('add', '.')
  git('commit', '-q', '-m', 'second')
  now = at('2026-11-21', '09:00')
  await clique.runSchedules()
  assert.equal(sent().length, 3)
  finish()
  // a one-off has no last run to compare with: the option isn't kept on it
  const one = await clique.scheduleAction('add', null, { text: 'once', to: 'iris', repeat: 'once', date: '2026-12-01', time: '09:00', ifChanged: true }, 'shop')
  assert.equal(shop().schedules.get(one.id).ifChanged, undefined)
})

// ---- `clique app schedule …`: an agent schedules it for you, by the agent tools' rules ----------------------------

const app = (from, line, { hub = shop(), hold } = {}) => clique.tool(hub, from, line, undefined, { hold })
const asks = (hub = shop()) => hub.feed.filter((e) => e.kind === 'ask' && !e.answer)
const settled = () => new Promise((r) => setImmediate(r))

test('clique app schedule add: asks first with a card that says what, who and when; allowed, it is scheduled', async () => {
  reset()
  clique.setTools('ask')
  now = at('2026-11-16', '12:00') // a Monday
  const out = app('iris', ['schedule', 'add', 'check CI and say what broke', '--to', 'june', '--at', '9', '--every', 'weekday'])
  await settled()
  const [card] = asks()
  assert.deepEqual({ title: card.ask.title, code: card.ask.code, detail: card.ask.detail, say: card.ask.say, app: card.ask.app }, {
    title: 'Schedule a message',
    code: 'Every weekday at 9:00 · to @june\ncheck CI and say what broke',
    detail: 'It goes out as a message from you, first on Tue 17 Nov at 9:00. Pause or remove it under Scheduled messages.',
    say: 'Can I schedule a message to @june, every weekday at 9:00?',
    app: true,
  })
  assert.equal(shop().schedules.all.length, 0) // nothing yet
  await clique.feedAction(card.id, 'answer', [{ allow: true }], shop())
  const text = await out
  const [s] = shop().schedules.all
  assert.equal(text, `The user allowed it: scheduled (${s.id}): every weekday at 9:00, to @june. It goes out next on Tue 17 Nov at 9:00.\n`)
  assert.deepEqual([s.text, s.to, s.repeat, s.time, s.by, s.next], ['check CI and say what broke', 'june', 'weekdays', '09:00', 'iris', at('2026-11-17', '09:00')])
  // said no: nothing is made
  const no = app('iris', ['schedule', 'add', 'water the plants', '--at', '18:00', '--every', 'friday'])
  await settled()
  await clique.feedAction(asks()[0].id, 'answer', [{ allow: false }], shop())
  assert.match(await no, /The user said no/)
  assert.equal(shop().schedules.all.length, 1)
  // the list, as an agent reads it
  assert.equal(await app('iris', ['schedules']), `${s.id}  every weekday at 9:00 · @june · next Tue 17 Nov at 9:00\n      check CI and say what broke\n`)
  // the same one again is refused before anyone is asked
  await assert.rejects(app('iris', ['schedule', 'add', 'Check CI and say what broke', '--to', '@june', '--at', '9:00', '--every', 'weekdays']), /that's scheduled already/)
  assert.equal(asks().length, 0)
  // what can't work fails before a card too
  await assert.rejects(app('iris', ['schedule', 'add', 'x', '--to', 'june']), /say when: --at 9:00/)
  await assert.rejects(app('iris', ['schedule', 'add', 'x', '--to', 'nobody', '--at', '9']), /no agent named "nobody"/)
  await assert.rejects(app('iris', ['schedule', 'add', '--at', '9']), /which message\?/)
  await assert.rejects(app('iris', ['schedule', 'add', 'x', '--at', '9', '--if-changed']), /--if-changed is for a message that repeats/)
  finish()
})

test('clique app schedule: automatic goes through and says so; pause and resume too; removing, and a YOLO agent, still ask', async () => {
  reset()
  clique.setTools('auto')
  now = at('2026-11-16', '12:00')
  const text = await app('iris', ['schedule', 'add', 'post the standup notes', '--to', 'june', '--at', '9:30', '--every', 'day', '--channel', 'reviews'])
  const [s] = shop().schedules.all
  assert.equal(text, `scheduled (${s.id}): every day at 9:30, to @june in #reviews. It goes out next on Tue 17 Nov at 9:30\n`)
  assert.equal(s.channel, 'reviews')
  assert.deepEqual(shop().feed.filter((e) => e.app).map((e) => [e.from, e.text]), [['iris', 'scheduled a message to @june in #reviews, every day at 9:30']])
  assert.equal(await app('iris', ['schedule', 'pause', s.id]), `${s.id} is paused\n`)
  assert.equal(shop().schedules.get(s.id).paused, true)
  await assert.rejects(app('iris', ['schedule', 'pause', s.id]), /is paused already/)
  assert.equal(await app('iris', ['schedule', 'resume', s.id]), `${s.id} is running again\n`)
  await assert.rejects(app('iris', ['schedule', 'pause', 'zzzz']), /no schedule zzzz/)
  // removing can't be undone: it asks even in Automatic
  const gone = app('iris', ['schedule', 'remove', s.id])
  await settled()
  assert.equal(asks()[0].ask.title, 'Remove a scheduled message')
  await clique.feedAction(asks()[0].id, 'answer', [{ allow: true }], shop())
  assert.match(await gone, /removed/)
  assert.equal(shop().schedules.all.length, 0)
  // a YOLO agent runs whatever it's sent: sending it things on a timer asks. Named with --to, @named in the words, or
  // (nobody named) there to be picked; and so does starting such a schedule again
  for (const words of [['deploy', '--to', 'rex'], ['@rex deploy'], ['deploy whatever is ready']]) {
    const yolo = app('iris', ['schedule', 'add', ...words, '--at', '9'])
    await settled()
    assert.equal(asks().length, 1, words.join(' '))
    await clique.feedAction(asks()[0].id, 'answer', [{ allow: false }], shop())
    await yolo
  }
  const rexs = await clique.scheduleAction('add', null, { text: '@rex deploy', repeat: 'daily', date: '2026-11-17', time: '09:00' }, 'shop')
  await clique.scheduleAction('pause', rexs.id, null, 'shop')
  const again = app('iris', ['schedule', 'resume', rexs.id])
  await settled()
  assert.equal(asks()[0]?.ask.title, 'Resume a scheduled message')
  await clique.feedAction(asks()[0].id, 'answer', [{ allow: false }], shop())
  await again
  // the same one again while it's paused: said, not passed off as scheduled
  await assert.rejects(app('iris', ['schedule', 'add', '@rex deploy', '--at', '9', '--every', 'day']), /scheduled already .* and paused, so nothing was added: clique app schedule resume/)
  assert.equal((await clique.scheduleAction('add', null, { text: '@rex deploy', repeat: 'daily', date: '2026-11-17', time: '09:00' }, 'shop')).same, 'paused')
  // off: nothing at all
  clique.setTools('off')
  await assert.rejects(app('iris', ['schedule', 'add', 'x', '--at', '9']), /turned them off/)
  clique.setTools('ask')
  finish()
})

test("a scheduled run can't set up schedules: not the agent it went to, nor one it was handed on to", async () => {
  reset()
  clique.setTools('auto')
  now = at('2026-11-16', '12:00')
  const { id } = await clique.scheduleAction('add', null, { text: 'plan the week', to: 'iris', repeat: 'weekly', date: '2026-11-17', time: '09:00' }, 'shop')
  await clique.scheduleAction('pause', id, null, 'shop')
  await clique.scheduleAction('resume', id, null, 'shop')
  busy()
  now = at('2026-11-17', '09:00')
  await clique.runSchedules()
  const [m] = sent()
  const iris = shop().agents.get('iris')
  Object.assign(iris, { inbox: [], serving: [m], current: m.id })
  await assert.rejects(app('iris', ['schedule', 'add', 'remind me again', '--at', '10']), /this turn came from a scheduled message, and a scheduled run can't set up schedules/)
  // she hands part of it to june: june's turn is part of the run too
  const handoff = shop().post({ kind: 'msg', from: 'iris', to: 'june', text: 'draft the backend half', re: m.id })
  Object.assign(shop().agents.get('june'), { inbox: [], serving: [handoff], current: handoff.id })
  await assert.rejects(app('june', ['schedule', 'add', 'remind me again', '--at', '10']), /a scheduled run can't set up schedules/)
  await clique.scheduleAction('pause', id, null, 'shop')
  await assert.rejects(app('june', ['schedule', 'resume', id]), /a scheduled run can't set up schedules/)
  assert.equal(shop().schedules.all.length, 1)
  // looking is fine, and so is a turn that came from you
  assert.match(await app('june', ['schedules']), /plan the week/)
  const yours = shop().post({ kind: 'msg', from: 'you', to: 'june', text: 'every day at 10, remind iris to stretch' })
  Object.assign(shop().agents.get('june'), { serving: [yours], current: yours.id })
  assert.match(await app('june', ['schedule', 'add', 'time to stretch', '--to', 'iris', '--at', '10', '--every', 'day']), /^scheduled \(/)
  clique.setTools('ask')
  finish()
})

// ---- what an independent review found, each kept from coming back ---------------------------------------------------

test('a one-off keeps its time when the clocks move to a zone where it has already passed', async () => {
  reset()
  now = at('2026-11-16', '12:00')
  const { id } = await clique.scheduleAction('add', null, { text: 'call the landlord', to: 'june', repeat: 'once', date: '2026-11-16', time: '12:30' }, 'shop')
  busy()
  // as if it had been made somewhere the clocks read differently: here its wall time is already behind us
  Object.assign(shop().schedules.get(id), { zone: 'Pacific/Kiritimati', date: '2026-11-16', time: '11:00' })
  now += 10 * MIN
  await clique.runSchedules()
  assert.equal(shop().schedules.get(id).next, at('2026-11-16', '12:30')) // not dropped
  now = at('2026-11-16', '12:31')
  await clique.runSchedules()
  assert.deepEqual(sent().map((m) => m.text), ['call the landlord'])
})

test('not stuck busy for good: a run whose agent was removed with it still queued is over', async () => {
  reset()
  now = at('2026-11-16', '12:00')
  await clique.scheduleAction('add', null, { text: 'check CI', to: 'iris', repeat: 'daily', date: '2026-11-17', time: '09:00' }, 'shop')
  busy()
  now = at('2026-11-17', '09:00')
  await clique.runSchedules()
  const [m] = sent()
  assert.equal(shop().busyWith(m), true)
  // as if iris had been removed: nobody will ever take it from her queue
  const iris = shop().agents.get('iris')
  shop().agents.delete('iris')
  assert.equal(shop().busyWith(m), false)
  shop().agents.set('iris', iris)
  // ...and one you dropped, or that's done, isn't going either
  assert.equal(shop().busyWith({ ...m, dropped: true }), false)
})

test('a scheduled run can not get a schedule made through a task it adds', async () => {
  reset()
  clique.setTools('auto')
  now = at('2026-11-16', '12:00')
  await clique.scheduleAction('add', null, { text: 'plan the week', to: 'iris', repeat: 'weekly', date: '2026-11-17', time: '09:00' }, 'shop')
  busy()
  now = at('2026-11-17', '09:00')
  await clique.runSchedules()
  const [m] = sent()
  Object.assign(shop().agents.get('iris'), { inbox: [], serving: [m], current: m.id })
  await shop().taskCommand('iris', ['add', 'Schedule a daily reminder', '--owner', 'june'])
  const t = shop().tickets.all.at(-1)
  assert.equal(t.scheduled, true)
  // june takes the task up: it reaches her as a message from you, about that task
  const work = shop().post({ kind: 'msg', from: 'you', to: 'june', text: 'Fix #1', ticket: t.id, title: t.title })
  Object.assign(shop().agents.get('june'), { inbox: [], serving: [work], current: work.id })
  await assert.rejects(app('june', ['schedule', 'add', 'remind me', '--to', 'iris', '--at', '10', '--every', 'day']), /a scheduled run can't set up schedules/)
  // a task you added yourself is yours
  await shop().taskCommand('you', ['add', 'Set up a standup reminder', '--owner', 'june'])
  const mine = shop().tickets.all.at(-1)
  const own = shop().post({ kind: 'msg', from: 'you', to: 'june', text: 'Fix #2', ticket: mine.id, title: mine.title })
  Object.assign(shop().agents.get('june'), { serving: [own], current: own.id })
  assert.match(await app('june', ['schedule', 'add', 'standup in five', '--to', 'iris', '--at', '9:55', '--every', 'weekday']), /^scheduled \(/)
  clique.setTools('ask')
  shop().tickets.all.length = 0
  finish()
})

test('removed or paused while another was going out, it stays unsent; a removed channel is said, not sent to everyone', async () => {
  reset()
  now = at('2026-11-16', '12:00')
  await clique.scheduleAction('add', null, { text: 'first', to: 'iris', repeat: 'once', date: '2026-11-17', time: '09:00' }, 'shop')
  const second = await clique.scheduleAction('add', null, { text: 'second', to: 'june', repeat: 'once', date: '2026-11-17', time: '09:00' }, 'shop')
  const third = await clique.scheduleAction('add', null, { text: 'third', to: 'june', repeat: 'daily', date: '2026-11-17', time: '09:00' }, 'shop')
  busy()
  now = at('2026-11-17', '09:00')
  const send = clique.send.bind(clique)
  clique.send = async (...args) => {
    clique.send = send
    shop().schedules.remove(second.id) // you delete the second, and pause the third, while the first is on its way
    shop().schedules.pause(third.id, true, { now })
    return send(...args)
  }
  await clique.runSchedules()
  assert.deepEqual(sent().map((m) => m.text), ['first'])
  // a schedule for a channel that's gone
  const gone = await clique.scheduleAction('add', null, { text: 'review the queue', repeat: 'daily', date: '2026-11-18', time: '09:00', channel: 'reviews' }, 'shop')
  shop().schedules.get(gone.id).channel = 'old-room'
  now = at('2026-11-18', '09:00')
  await clique.runSchedules()
  assert.deepEqual(sent().map((m) => m.text), ['first'])
  assert.match(lines().at(-1), /"review the queue" \(every day at 9:00\) didn't go out: its channel, #old-room, isn't there any more/)
})

test("a schedules.json edited by hand: what isn't a schedule is left out, and the rest still run", async () => {
  const file = path.join(process.env.CLIQUE_HOME, 'hand.json')
  fs.writeFileSync(file, JSON.stringify({ schedules: [
    { id: 'aaaa', text: 'no time', repeat: 'daily', date: '2026-11-17' },
    { id: 'bbbb', text: 'bad day', repeat: 'daily', date: '2026-02-31', time: '09:00' },
    { id: 'cccc', text: 'fine', repeat: 'daily', date: '2026-11-17', time: '09:00', next: 1 },
    'nonsense',
  ] }))
  assert.deepEqual(new Schedules(file).all.map((s) => [s.id, s.to]), [['cccc', '']])
  // a file that isn't JSON at all is left alone, and nothing is added on top of it
  fs.writeFileSync(file, '{ not json')
  const broken = new Schedules(file)
  assert.throws(() => broken.add({ text: 'x', repeat: 'daily', date: '2026-11-17', time: '09:00' }, { now: 0 }), /can't be read/)
  broken.save()
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json')
})

test('only when the repo changed: an edit inside a folder git has never seen counts', { skip: !hasGit && 'no git here' }, async () => {
  fs.mkdirSync(path.join(FOLDER, 'scratch'), { recursive: true })
  fs.writeFileSync(path.join(FOLDER, 'scratch', 'todo.md'), 'one\n')
  const before = await repoMark(FOLDER)
  fs.writeFileSync(path.join(FOLDER, 'scratch', 'todo.md'), 'one, and two\n')
  assert.notEqual(await repoMark(FOLDER), before)
})

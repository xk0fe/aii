// Calmer notifications (core/notify.js): the schedule and the pause, what's held and the one summary after, nothing for
// the place you're looking at, agents that ask together as one notification, one ping per matter, an answered card's
// notification taken down, and the one clean line a notification shows. A made-up clock (scripts/notify-driver.mjs), so
// a night passes in no time; then the app's side of it (Clique.setNotifications, Clique.stillNeeds) on a throwaway
// CLIQUE_HOME. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { quietNow, nextChange, morningAfter, pauseFor, prefsOf, prefsToSave, changed, preview, hideSecrets, decide, lookingAt, compose, BATCH, GAP, REMEMBER } from '../core/notify.js'
import { world } from '../scripts/notify-driver.mjs'

// Monday 16 November 2026 (the 21st is a Saturday), in this computer's own time zone, as the schedule is
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m)
const ms = (d, h, m = 0) => at(d, h, m).getTime()
const EVERY = { days: 'every', from: '08:00', to: '22:00' }

test('the schedule: any time by default; inside the hours it notifies, outside them it holds until they start again', () => {
  assert.deepEqual(prefsOf(undefined), { days: 'always', from: '08:00', to: '22:00', pause: null })
  assert.deepEqual(quietNow(null, ms(16, 3)), { quiet: false, why: null, until: null })
  assert.equal(nextChange(null, ms(16, 3)), null)
  assert.deepEqual(quietNow(EVERY, ms(16, 12)), { quiet: false, why: null, until: null })
  assert.equal(nextChange(EVERY, ms(16, 12)), ms(16, 22), 'the tray learns it at 22:00')
  assert.deepEqual(quietNow(EVERY, ms(16, 22)), { quiet: true, why: 'schedule', until: ms(17, 8) })
  assert.deepEqual(quietNow(EVERY, ms(17, 7, 59)), { quiet: true, why: 'schedule', until: ms(17, 8) })
  assert.equal(quietNow(EVERY, ms(17, 8)).quiet, false)
})

test('weekdays: Friday night runs to Monday morning', () => {
  const p = { ...EVERY, days: 'weekdays' }
  assert.equal(quietNow(p, ms(20, 21, 59)).quiet, false) // Friday
  assert.deepEqual(quietNow(p, ms(20, 22)), { quiet: true, why: 'schedule', until: ms(23, 8) })
  assert.deepEqual(quietNow(p, ms(21, 12)), { quiet: true, why: 'schedule', until: ms(23, 8) }) // Saturday noon
  assert.deepEqual(quietNow(p, ms(22, 23)), { quiet: true, why: 'schedule', until: ms(23, 8) }) // Sunday night
})

test('hours that run past midnight, and the same time twice (the whole day)', () => {
  const night = { days: 'every', from: '22:00', to: '06:00' }
  assert.equal(quietNow(night, ms(16, 23)).quiet, false)
  assert.equal(quietNow(night, ms(17, 5, 59)).quiet, false)
  assert.equal(nextChange(night, ms(17, 1)), ms(17, 6))
  assert.deepEqual(quietNow(night, ms(17, 6)), { quiet: true, why: 'schedule', until: ms(17, 22) })
  // a weekday night's hours start on a weekday: Friday's run into Saturday morning, Saturday's and Sunday's don't start
  const weeknights = { ...night, days: 'weekdays' }
  assert.equal(quietNow(weeknights, ms(21, 3)).quiet, false)
  assert.deepEqual(quietNow(weeknights, ms(21, 23)), { quiet: true, why: 'schedule', until: ms(23, 22) })
  const allDay = { days: 'every', from: '09:00', to: '09:00' }
  assert.equal(quietNow(allDay, ms(16, 3)).quiet, false)
  assert.equal(nextChange(allDay, ms(16, 3)), null, 'windows that touch never end')
  assert.deepEqual(quietNow({ ...allDay, days: 'weekdays' }, ms(21, 10)), { quiet: true, why: 'schedule', until: ms(23, 9) })
})

test('a pause: for an hour, until tomorrow morning, until you turn them back on; one that runs out at night hands over to the schedule', () => {
  const now = ms(16, 14)
  assert.deepEqual(pauseFor('hour', null, now), { until: ms(16, 15) })
  assert.deepEqual(pauseFor('morning', null, now), { until: ms(17, 8) })
  assert.deepEqual(pauseFor('morning', { days: 'every', from: '09:30', to: '18:00' }, now), { until: ms(17, 9, 30) }, "your schedule's morning")
  assert.equal(morningAfter(null, ms(17, 1)), ms(17, 8), 'at 1 in the morning, the morning is the one a few hours off')
  assert.deepEqual(pauseFor('manual', null, now), { until: null })
  assert.equal(pauseFor('off', null, now), null)
  assert.throws(() => pauseFor('forever', null, now), /not "forever"/)

  assert.deepEqual(quietNow({ pause: { until: ms(16, 15) } }, now), { quiet: true, why: 'pause', until: ms(16, 15) })
  assert.equal(quietNow({ pause: { until: ms(16, 15) } }, ms(16, 15)).quiet, false)
  assert.deepEqual(quietNow({ pause: { until: null } }, ms(20, 3)), { quiet: true, why: 'pause', until: null })
  // paused at 21:30 for an hour with hours until 22:00: nothing comes back at 22:30, it's the morning
  assert.deepEqual(quietNow({ ...EVERY, pause: { until: ms(16, 22, 30) } }, ms(16, 21, 45)), { quiet: true, why: 'pause', until: ms(17, 8) })
})

test('what config.json keeps: nothing while everything is the default, and a change says what is wrong in words', () => {
  assert.equal(prefsToSave(prefsOf(null)), null)
  assert.deepEqual(prefsToSave(changed(null, { days: 'weekdays' })), { days: 'weekdays' })
  assert.deepEqual(prefsToSave(changed({ days: 'weekdays' }, { from: '09:30', to: '18:00' })), { days: 'weekdays', from: '09:30', to: '18:00' })
  assert.deepEqual(prefsToSave(changed({ days: 'every' }, { pause: 'hour' }, ms(16, 14))), { days: 'every', pause: { until: ms(16, 15) } })
  assert.equal(prefsToSave(changed({ pause: { until: null } }, { pause: 'off' })), null)
  assert.equal(changed({ pause: { until: ms(16, 15) } }, { days: 'every' }, ms(16, 16)).pause, null, 'a pause that ran out is not kept')
  assert.throws(() => changed(null, { days: 'sundays' }), /any time, every day or weekdays/)
  assert.throws(() => changed(null, { from: '8am' }), /isn't a time of day/)
  assert.deepEqual(prefsOf({ days: 'never', from: '25:00', to: 7, pause: 'yes' }), prefsOf(null), 'a config.json edited by hand')
})

test('the one line a notification shows: no code, no markdown, sites by name, nothing that looks like a secret, capped', () => {
  assert.equal(preview('## Done\n\nSee [the PR](https://github.com/acme/shop/pull/3) and https://www.example.com/a/b?x=1.\n\n```js\nconst a = 1\n```\n- **bold** and `code`'),
    'Done · See the PR and example.com. bold and code')
  assert.equal(preview('| a | b |\n|---|---|\n| 1 | 2 |'), 'a b · 1 2')
  assert.equal(preview('> quoted\n\n1. first\n2. second ![shot](file:///x.png)'), 'quoted · first · second shot')
  assert.equal(preview('line\u0000 with​ <b>tags</b> <!-- and a comment -->'), 'line with tags')
  assert.equal(preview('a'.repeat(400)).length, 140)
  assert.ok(preview('word '.repeat(100)).endsWith('…'))
  assert.equal(Array.from(preview('🙂'.repeat(300), 20)).length, 20, 'cut between characters, not inside one')
  assert.equal(preview('```\nonly code\n```'), '')
  for (const [secret, kept] of [
    ['sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx', 'key'],
    ['ghp_x7Q2mN8vK4pL9sR1tW6yB3cD5eF0gH2jA4uZ', 'key'],
    ['xoxb-1234567890-abcdefghij', 'key'],
    ['AKIAIOSFODNN7EXAMPLE', 'key'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'key'],
    ['9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', 'key'],
    ['aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6', 'key'],
  ]) {
    const out = preview(`use the ${kept} ${secret} for it`)
    assert.ok(!out.includes(secret.slice(4, 20)), `${secret} is hidden: ${out}`)
    assert.match(out, /^use the key \[hidden\] for it$/)
  }
  assert.equal(hideSecrets('DB_PASSWORD="hunter2hunter2" and api_key: abcdef123456'), 'DB_PASSWORD=[hidden] and api_key: [hidden]')
  assert.equal(hideSecrets('curl -H "Authorization: Bearer abcdefghijklmnop"'), 'curl -H "Authorization: [hidden]"')
  assert.match(hideSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY----- done'), /^\[hidden\] done$/)
  // ordinary long things stay: a path, a sentence, an identifier
  for (const plain of ['~/Projects/storefront/src/components/checkout/CheckoutSummaryPanel.tsx', 'wants to run npm run build -- --mode production', 'calculateOrderTotalsWithDiscountsAndTaxes'])
    assert.equal(preview(plain), plain)
})

test('a decision: told already, already being gathered, held, in front of you, or the first of a notification', () => {
  const e = { kind: 'alert', ws: '', name: 'Milo', text: 'asks: A or B?' }
  const quiet = { quiet: true, why: 'schedule' }
  assert.deepEqual(decide(e), { do: 'notify', why: 'first' })
  assert.deepEqual(decide(e, { gathering: true }), { do: 'coalesce', why: 'gathering' })
  assert.deepEqual(decide(e, { quiet }), { do: 'hold', why: 'schedule' })
  assert.deepEqual(decide(e, { quiet: { quiet: true, why: 'pause' }, looking: true }), { do: 'hold', why: 'pause' })
  assert.deepEqual(decide(e, { looking: true }), { do: 'drop', why: 'looking' })
  assert.deepEqual(decide(e, { known: { text: e.text, state: 'shown' } }), { do: 'drop', why: 'already told' })
  assert.deepEqual(decide(e, { known: { text: e.text, state: 'seen' }, quiet }), { do: 'drop', why: 'already told' })
  assert.deepEqual(decide(e, { known: { text: 'asks: something else', state: 'shown' } }), { do: 'notify', why: 'first' }, 'a new question')
  assert.deepEqual(decide(e, { known: { text: e.text, state: 'held' }, quiet }), { do: 'coalesce', why: 'already held' })
  assert.deepEqual(decide(e, { known: { text: 'x', state: 'pending' } }), { do: 'coalesce', why: 'already gathering' })
})

test("looking: the agent's conversation (its clones too), a question on screen in the open channel, Tasks for a task; never another workspace's", () => {
  const alert = (name, ws = 'shop') => ({ kind: 'alert', ws, name, text: '' })
  const convo = { ws: 'shop', agent: 'Theo', sees: [], tasks: false }
  assert.equal(lookingAt(alert('Theo'), [convo]), true)
  assert.equal(lookingAt(alert('Theo.2'), [convo]), true)
  assert.equal(lookingAt(alert('Theo@studio'), [convo]), false, 'another computer\'s Theo')
  assert.equal(lookingAt(alert('Ada'), [convo]), false)
  assert.equal(lookingAt(alert('Theo', 'docs'), [convo]), false)
  assert.equal(lookingAt(alert('Theo'), []), false, 'no window has the keyboard')
  const channel = { ws: 'shop', agent: null, sees: ['Ada'], tasks: false }
  assert.equal(lookingAt(alert('Ada'), [channel]), true)
  assert.equal(lookingAt(alert('Milo'), [channel]), false)
  const tasks = { ws: 'shop', agent: null, sees: [], tasks: true }
  assert.equal(lookingAt({ kind: 'notice', ws: 'shop', title: '@Ada fixed #12', focus: 'task:12' }, [tasks]), true)
  assert.equal(lookingAt({ kind: 'notice', ws: 'shop', title: '@Ada fixed #12', focus: 'task:12' }, [channel]), false)
  assert.equal(lookingAt({ kind: 'notice', ws: 'shop', title: '@Theo passed its limit', focus: 'Theo' }, [convo]), true)
  assert.equal(lookingAt({ kind: 'notice', ws: '', title: 'Claude is at 90%', focus: '' }, [{ ws: '', agent: null, sees: [], tasks: true }]), false, "an account's limit has no place")
})

test('one notification for what came together: who, how many, where a click goes', () => {
  const a = (name, text = 'asks: A or B?', ws = '') => ({ kind: 'alert', ws, name, text })
  const n = (title, focus = 'task:12', ws = '') => ({ kind: 'notice', ws, title, body: 'Review it', focus })
  assert.equal(compose([]), null)
  assert.deepEqual(compose([a('Theo.2', 'wants to run `npm test`')]), { title: 'Theo (clone 2) needs you', body: 'wants to run npm test', target: { ws: '', focus: 'Theo.2' }, items: [a('Theo.2', 'wants to run `npm test`')] })
  const three = compose([a('Milo'), a('Ada'), a('Iris'), a('Milo', 'again')])
  assert.deepEqual([three.title, three.body, three.target], ['3 agents need you', 'Milo, Ada and Iris', { ws: '', focus: 'Milo' }])
  assert.equal(compose(['Milo', 'Ada', 'Iris', 'June', 'Theo'].map((x) => a(x))).body, 'Milo, Ada, Iris and 2 more')
  const mixed = compose([n('@Theo finished #12'), a('Milo'), n('#9 has stalled', 'task:9')])
  assert.deepEqual([mixed.title, mixed.body, mixed.target], ['Milo needs you · 2 updates', 'asks: A or B? · @Theo finished #12 and #9 has stalled', { ws: '', focus: 'Milo' }])
  const notice = compose([n('@Theo finished #12')])
  assert.deepEqual([notice.title, notice.body, notice.target], ['@Theo finished #12', 'Review it', { ws: '', focus: 'task:12' }])
  // with workspaces: one's name leads the title, several say where each agent is
  const label = (ws) => ({ shop: 'Storefront', docs: 'Docs site' })[ws] ?? ''
  assert.equal(compose([a('Milo', 'x', 'shop')], { label }).title, 'Storefront · Milo needs you')
  assert.equal(compose([a('Milo', 'x', 'shop'), a('Ada', 'x', 'shop')], { label }).title, 'Storefront · 2 agents need you')
  const across = compose([a('Milo', 'x', 'shop'), a('June', 'x', 'docs')], { label })
  assert.deepEqual([across.title, across.body, across.target], ['2 agents need you', 'Milo in Storefront and June in Docs site', { ws: 'shop', focus: 'Milo' }])
  // the summary after a quiet time says so
  assert.equal(compose([a('Milo'), a('Ada')], { held: 'pause' }).body, 'Milo and Ada. Held while notifications were paused.')
  assert.equal(compose([a('Milo')], { held: 'schedule' }).body, 'asks: A or B? Held while notifications were off.')
})

test('quiet hours hold everything, and when they end there is one summary of what still waits', () => {
  const w = world({ start: at(16, 22, 40), prefs: EVERY })
  assert.deepEqual(w.calm.view(), { quiet: true, why: 'schedule', until: ms(17, 8), held: 0 })
  w.asks('Milo', 'asks: one page or three steps?')
  w.until(at(16, 23, 15))
  w.asks('Ada', 'wants to run npm run migrate')
  w.calm.notice({ title: '@Theo finished #12', body: 'Coupon codes. Review it', focus: 'task:12' })
  w.calm.alert('Milo', 'asks: one page or three steps?') // said again in the night: still one line
  assert.equal(w.calm.view().held, 3)
  w.until(at(17, 2))
  w.answered('Ada') // from the phone
  assert.equal(w.calm.view().held, 2)
  w.until(at(17, 7, 59))
  assert.equal(w.shown.length, 0, 'nothing all night')
  w.until(at(17, 8, 1))
  assert.equal(w.shown.length, 1, 'one summary, not a burst')
  assert.deepEqual([w.shown[0].title, w.shown[0].body], ['Milo needs you · 1 update', 'asks: one page or three steps? · @Theo finished #12. Held while notifications were off.'])
  assert.deepEqual(w.shown[0].target, { ws: '', focus: 'Milo' })
  assert.deepEqual(w.calm.view(), { quiet: false, why: null, until: null, held: 0 })
  // and the day goes on as usual
  w.asks('Iris', 'has a plan for you to approve')
  w.advance(GAP + BATCH)
  assert.equal(w.shown.length, 2)
  // everything answered in the night: no summary at all
  const w2 = world({ start: at(16, 23), prefs: EVERY })
  w2.asks('Milo', 'asks: A or B?')
  w2.answered('Milo')
  w2.until(at(17, 9))
  assert.equal(w2.shown.length, 0)
})

test('a pause from the tray: held, the tray can say until when, and resuming early gives the summary then', () => {
  const w = world({ start: at(16, 14) })
  w.set({ pause: 'hour' })
  assert.deepEqual(w.calm.view(), { quiet: true, why: 'pause', until: ms(16, 15), held: 0 })
  w.asks('Milo', 'asks: A or B?')
  w.advance(20 * 60000)
  w.asks('Iris', 'has a plan for you to approve')
  assert.equal(w.shown.length, 0)
  w.until(at(16, 15, 1))
  assert.deepEqual(w.shown.map((n) => [n.title, n.body]), [['2 agents need you', 'Milo and Iris. Held while notifications were paused.']])
  assert.equal(w.calm.view().quiet, false)

  const w2 = world({ start: at(16, 14) })
  w2.set({ pause: 'manual' })
  w2.asks('Ada', 'wants to run npm test')
  w2.until(at(18, 9))
  assert.deepEqual([w2.shown.length, w2.calm.view().until, w2.calm.view().held], [0, null, 1], 'two days on, still paused')
  w2.set({ pause: 'off' })
  assert.deepEqual(w2.shown.map((n) => n.title), ['Ada needs you'])
  // a pause that begins while a notification is being put together holds it too
  const w3 = world({ start: at(16, 14) })
  w3.asks('Ada', 'wants to run npm test')
  w3.advance(500)
  w3.set({ pause: 'hour' })
  w3.advance(10000)
  assert.deepEqual([w3.shown.length, w3.calm.view().held], [0, 1])
  w3.until(at(16, 15, 1))
  assert.equal(w3.shown.length, 1)
})

test('several agents asking within a moment are one notification, and CLIque pings at most once in a while', () => {
  const w = world({ start: at(16, 10) })
  w.asks('Milo', 'asks: A or B?')
  w.advance(400)
  w.asks('Ada', 'wants to run npm run migrate')
  w.advance(900)
  w.asks('Iris', 'has a plan for you to approve')
  assert.equal(w.shown.length, 0, 'still gathering')
  w.advance(BATCH)
  assert.deepEqual(w.shown.map((n) => [n.title, n.body]), [['3 agents need you', 'Milo, Ada and Iris']])
  // two more right after wait out the gap, and come as one
  w.asks('June', 'asks: ship it?')
  w.advance(BATCH + 100)
  w.asks('Theo', 'wants to run npm test')
  assert.equal(w.shown.length, 1)
  w.advance(GAP)
  assert.deepEqual(w.shown.map((n) => n.title), ['3 agents need you', '2 agents need you'])
})

test("nothing for the place you're looking at, checked again as the notification is about to show", () => {
  const w = world({ start: at(16, 10) })
  w.views = [{ ws: '', agent: 'Milo', sees: [], tasks: false }]
  w.asks('Milo', 'asks: A or B?')
  w.advance(BATCH * 2)
  assert.equal(w.shown.length, 0)
  w.asks('Ada', 'wants to run npm run migrate') // elsewhere: it pings
  w.advance(BATCH)
  assert.deepEqual(w.shown.map((n) => n.title), ['Ada needs you'])
  // you look away: what you saw doesn't ping after all, a new question does
  w.views = []
  w.calm.alert('Milo', 'asks: A or B?')
  w.advance(GAP + BATCH)
  assert.equal(w.shown.length, 1)
  w.calm.alert('Milo', 'asks: and the coupon field?')
  w.advance(GAP + BATCH)
  assert.deepEqual(w.shown.map((n) => n.title), ['Ada needs you', 'Milo needs you'])
  // opened while the notification was being put together: none
  const w2 = world({ start: at(16, 10) })
  w2.asks('Iris', 'has a plan for you to approve')
  w2.advance(1000)
  w2.views = [{ ws: '', agent: null, sees: ['Iris'], tasks: false }]
  w2.advance(BATCH)
  assert.equal(w2.shown.length, 0)
  // a window on another workspace doesn't count
  const w3 = world({ start: at(16, 10), workspaces: { shop: 'Storefront', docs: 'Docs site' } })
  w3.views = [{ ws: 'docs', agent: 'Milo', sees: [], tasks: false }]
  w3.asks('Milo', 'asks: A or B?', 'shop')
  w3.advance(BATCH)
  assert.deepEqual(w3.shown.map((n) => n.title), ['Storefront · Milo needs you'])
})

test('one ping per matter: the same question never pings twice, an answered one comes down, and a new one pings again', () => {
  const w = world({ start: at(16, 10) })
  w.asks('Milo', 'asks: A or B?')
  w.advance(BATCH)
  assert.equal(w.open().length, 1)
  w.calm.alert('Milo', 'asks: A or B?')
  w.advance(3 * 60 * 60000) // hours later, still waiting, said again
  w.calm.alert('Milo', 'asks: A or B?')
  w.advance(GAP + BATCH)
  assert.equal(w.shown.length, 1)
  w.answered('Milo') // on the phone
  assert.equal(w.open().length, 0, 'its notification is taken down')
  // the same words after it was answered are a new matter
  w.asks('Milo', 'asks: A or B?')
  w.advance(GAP + BATCH)
  assert.equal(w.shown.length, 2)
  // answered before the notification was even put up: none
  w.answered('Milo')
  w.advance(GAP)
  w.asks('Ada', 'wants to run npm test')
  w.advance(500)
  w.answered('Ada')
  w.advance(GAP + BATCH)
  assert.equal(w.shown.length, 2)
  // one notification for three stays until all three are answered
  w.asks('Iris', 'x')
  w.asks('June', 'y')
  w.asks('Theo', 'z')
  w.advance(GAP + BATCH)
  assert.equal(w.open().length, 1)
  w.answered('Iris')
  w.answered('June')
  assert.equal(w.open().length, 1)
  w.answered('Theo')
  assert.equal(w.open().length, 0)
})

test('notices: the same one twice is one, one with a task finished is not taken down, a question lifted from a thread is remembered a while', () => {
  const w = world({ start: at(16, 10) })
  const stalled = { title: '#9 has stalled', body: '@Ada has been quiet for 20 minutes', focus: 'task:9' }
  w.calm.notice(stalled)
  w.calm.notice(stalled)
  w.advance(BATCH)
  w.calm.notice(stalled)
  w.advance(GAP + BATCH)
  assert.deepEqual(w.shown.map((n) => [n.title, n.body]), [['#9 has stalled', '@Ada has been quiet for 20 minutes']])
  w.advance(REMEMBER + 1000)
  w.calm.notice(stalled) // much later it's news again
  w.advance(BATCH)
  assert.equal(w.shown.length, 2)
  // an agent and a notice in one notification: answering the agent leaves it up, there's still the notice to read
  w.advance(GAP)
  w.asks('Milo', 'asks: A or B?')
  w.calm.notice({ title: '@Theo finished #12', body: 'Review it', focus: 'task:12' })
  w.advance(BATCH)
  w.answered('Milo')
  assert.equal(w.open().length, 3)
  // a question lifted out of a thread: its agent never "waits", so it's remembered for a while, then may ping again
  w.advance(GAP)
  w.calm.alert('June', 'is asking you something in a thread')
  w.advance(BATCH)
  w.calm.alert('June', 'is asking you something in a thread')
  w.advance(GAP + BATCH)
  assert.equal(w.shown.length, 4)
  w.advance(REMEMBER)
  w.calm.alert('June', 'is asking you something in a thread')
  w.advance(BATCH)
  assert.equal(w.shown.length, 5)
})

test('a notification the system shows a moment late is checked once more, and one that should not be there is closed', () => {
  // the caller's show() asks `wanted` when the system has put it up: here quiet time began in between
  const w = world({ start: at(16, 10) })
  let wanted = null
  w.calm.show = (note, ask) => {
    wanted = ask
    return { close() {} }
  }
  w.asks('Milo', 'asks: A or B?')
  w.advance(BATCH)
  assert.equal(wanted(), true)
  w.answered('Milo')
  assert.equal(wanted(), false, 'answered in between')
  w.asks('Ada', 'x')
  w.advance(GAP + BATCH)
  assert.equal(wanted(), true)
  w.set({ pause: 'hour' })
  assert.equal(wanted(), false, 'paused in between')
})

// ---- the app's side: config.json and who still waits ---------------------------------------------------------------------

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-quiet-'))
const { CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'iris', area: 'design' }, { name: 'june', area: 'backend' }], workspaces: [{ id: 'shop', name: 'Shop', members: { iris: {}, june: {} }, agents: [] }] }))
const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
Object.assign(clique.runner, { running: () => true, quietFor: () => Infinity, submit() {}, write() {} })
after(() => {
  for (const hub of clique.hubs.values()) for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(hub[t])
  for (const hub of clique.hubs.values()) clearTimeout(hub.ledger.timer)
  clearTimeout(clique.changeTimer)
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
})
const saved = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8')).notifications

test('the schedule and the pause are kept in config.json, and leave nothing behind when they are back to the default', () => {
  assert.deepEqual(clique.notifications, { days: 'always', from: '08:00', to: '22:00', pause: null })
  assert.equal(saved(), undefined)
  assert.deepEqual(clique.setNotifications({ days: 'weekdays', from: '09:00' }), { days: 'weekdays', from: '09:00', to: '22:00', pause: null })
  assert.deepEqual(saved(), { days: 'weekdays', from: '09:00' })
  clique.setNotifications({ pause: 'hour' }, ms(16, 14))
  assert.deepEqual(saved(), { days: 'weekdays', from: '09:00', pause: { until: ms(16, 15) } })
  clique.setNotifications({ pause: 'manual' })
  assert.deepEqual(clique.notifications.pause, { until: null })
  assert.throws(() => clique.setNotifications({ days: 'sometimes' }), /any time, every day or weekdays/)
  clique.setNotifications({ pause: 'off', days: 'always', from: '08:00' })
  assert.equal(saved(), undefined)
})

test('who still waits for you: an agent whose status says so or whose card is up, until it is answered', async () => {
  const hub = clique.hubs.get('shop')
  const alerts = []
  clique.on('alert', (name, text, ws) => alerts.push([name, ws, clique.stillNeeds(ws, name)]))
  assert.equal(clique.stillNeeds('shop', 'june'), false)
  const waiting = hub.ask('june', { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm run build' }, permission_suggestions: [] })
  // the hub says "needs you" a moment before the agent's status turns (Calm looks once that has settled)
  assert.deepEqual(alerts, [['june', 'shop', false]])
  assert.equal(clique.stillNeeds('shop', 'june'), true)
  assert.equal(clique.stillNeeds('shop', 'iris'), false)
  assert.equal(clique.stillNeeds('nowhere', 'june'), false)
  hub.answer(hub.feed.findLast((e) => e.kind === 'ask' && !e.answer).id, { allow: true })
  await waiting
  assert.equal(clique.stillNeeds('shop', 'june'), false, 'answered: its notification can come down')
})

// Calmer notifications (core/notify.js) driven by a made-up clock: scripted events, scripted focus, scripted answers,
// and a log of what was decided and what the system would have shown. Nothing starts, nothing is read or written.
// Run: node scripts/notify-driver.mjs      (test/quiet-notifications.test.js drives the same world)
import { fileURLToPath } from 'node:url'
import { Calm, changed, prefsOf, preview } from '../core/notify.js'

// A world for Calm: its clock, its timers, who's waiting, what you're looking at, and the notifications it put up.
//   start: a Date;  prefs: config.json's notifications;  workspaces: { id: name } when there's more than one
export function world({ start, prefs = null, workspaces = {} } = {}) {
  let now = start.getTime()
  let saved = prefsOf(prefs)
  const timers = []
  const w = {
    waiting: new Set(), // 'ws/name' of agents waiting for you
    views: [], // what the focused windows have open
    shown: [], // every notification put up: { title, body, target, open }
    log: [],
    now: () => now,
    // the clock moves on, running whatever was due on the way
    advance(ms) {
      const end = now + ms
      for (;;) {
        timers.sort((a, b) => a.at - b.at)
        if (!timers.length || timers[0].at > end) break
        const t = timers.shift()
        now = Math.max(now, t.at)
        t.fn()
      }
      now = end
    },
    until(date) {
      w.advance(date.getTime() - now)
    },
    // the preferences change, as from the sheet or the tray
    set(patch) {
      saved = changed(saved, patch, now)
      w.calm.tick()
    },
    // an agent asks (the hub says so, then its status turns to waiting), or is answered somewhere
    asks(name, text, ws = '') {
      w.calm.alert(name, text, ws)
      w.waiting.add(`${ws}/${name}`)
      w.calm.settle()
    },
    answered(name, ws = '') {
      w.waiting.delete(`${ws}/${name}`)
      w.calm.settle()
    },
    open: () => w.shown.filter((n) => n.open),
  }
  w.calm = new Calm({
    prefs: () => saved,
    now: () => now,
    after: (ms, fn) => {
      const t = { at: now + ms, fn }
      timers.push(t)
      return () => timers.includes(t) && timers.splice(timers.indexOf(t), 1)
    },
    views: () => w.views,
    needs: (ws, name) => w.waiting.has(`${ws}/${name}`),
    label: (ws) => workspaces[ws] ?? '',
    log: (line) => w.log.push([now, line]),
    show: (note, wanted) => {
      const n = { ...note, open: true, close: () => (n.open = false) }
      w.shown.push(n)
      if (!wanted()) n.close()
      return n
    },
  })
  return w
}

const MESSY = [
  '## Deploy is blocked\n\nThe build fails on **`api/orders.ts`**, see [the run](https://github.com/acme/storefront/actions/runs/8123456789) and https://www.notion.so/acme/Release-checklist-4f1c9b?pvs=4:\n\n```ts\nconst total = items.reduce((n, i) => n + i.price, 0)\n```\n\n- [ ] can I push with `STRIPE_API_KEY=sk_live_51NxT3stK3yD0N0tUs3M3pl34s3xyz` set?\n- or use the token ghp_x7Q2mN8vK4pL9sR1tW6yB3cD5eF0gH2jA4uZ',
  'wants to run curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk" https://api.internal.example.com/v2/orders?limit=50&cursor=abc',
]

function demo() {
  const day = (h, m = 0, d = 16) => new Date(2026, 10, d, h, m) // Monday 16 November 2026
  const clock = (ms) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const print = (title, w, extra = []) => {
    console.log(`\n== ${title} ==`)
    for (const [at, line] of w.log) console.log(`${clock(at)}  ${line}`)
    for (const line of extra) console.log(`             ${line}`)
    console.log(`             -> ${w.shown.length} notification${w.shown.length === 1 ? '' : 's'} put up, ${w.open().length} still up`)
  }

  // 1. quiet hours hold everything, and one summary follows
  let w = world({ start: day(22, 40), prefs: { days: 'every', from: '08:00', to: '22:00' } })
  w.asks('Milo', 'asks: Which checkout flow should I keep, one page or three steps?')
  w.until(day(23, 15))
  w.asks('Ada', 'wants to run npm run migrate')
  w.until(day(1, 30, 17))
  w.calm.notice({ title: '@Theo finished #12', body: 'Coupon codes at checkout. Review it', focus: 'task:12' })
  w.until(day(2, 5, 17))
  w.answered('Ada') // from the phone, in bed
  w.until(day(7, 59, 17))
  const before = w.shown.length
  w.until(day(8, 1, 17))
  print('Notify me every day 8:00 to 22:00: the night is held, one summary at 8:00', w, [`(before 8:00: ${before} notifications; tray said "${JSON.stringify({ quiet: true, why: 'schedule' })}")`])

  // 2. three agents ask within a moment: one notification
  w = world({ start: day(10, 0) })
  w.asks('Milo', 'asks: Which checkout flow should I keep?')
  w.advance(400)
  w.asks('Ada', 'wants to run npm run migrate')
  w.advance(900)
  w.asks('Iris', 'has a plan for you to approve')
  w.advance(5000)
  print('Three agents ask within two seconds: one notification', w)

  // 3. the place you're looking at needs no ping; the same event elsewhere does
  w = world({ start: day(10, 0) })
  w.views = [{ ws: '', agent: 'Milo', sees: [], tasks: false }] // the dashboard, focused, on Milo's conversation
  w.asks('Milo', 'asks: Which checkout flow should I keep?')
  w.advance(5000)
  w.asks('Ada', 'wants to run npm run migrate') // not the place that's open
  w.advance(5000)
  w.views = [] // you switch to another app
  w.asks('Milo', 'asks: And should the coupon field stay?') // a new question: now it pings
  w.advance(25000)
  print("You're looking at Milo's conversation: nothing for Milo, one for Ada; look away and Milo's next question pings", w)

  // 4. answered somewhere else: the notification comes down, and the same question never pings twice
  w = world({ start: day(10, 0) })
  w.asks('Milo', 'asks: Which checkout flow should I keep?')
  w.advance(3000)
  w.calm.alert('Milo', 'asks: Which checkout flow should I keep?') // said again while it still waits
  w.advance(60000)
  const up = w.open().length
  w.answered('Milo') // on the phone
  print('A card answered on the phone takes its notification down; the same question said twice pings once', w, [`(before the answer: ${up} up)`])

  // 5. pause for an hour from the tray
  w = world({ start: day(14, 0) })
  w.set({ pause: 'hour' })
  const view = w.calm.view()
  w.asks('Milo', 'asks: Which checkout flow should I keep?')
  w.advance(20 * 60000)
  w.asks('Iris', 'has a plan for you to approve')
  w.until(day(15, 1))
  print('Pause for 1 hour at 14:00: held, then one summary at 15:00', w, [`(tray at 14:00: paused until ${clock(view.until)})`])

  console.log('\n== A messy message, and the one line a notification shows ==')
  for (const text of MESSY) console.log(`before: ${JSON.stringify(text)}\nafter:  ${preview(text)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) demo()

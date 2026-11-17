// Where the chat is when you come back to a channel, driven in the real dashboard on the demo clique
// (screenshot-preload.cjs: nothing starts, ~/.clique is untouched): each channel opens where you left it, at its end
// or at the message you were reading, from another channel, a conversation or Tasks; at the first reply that came in
// while you were away; and, opened for the first time, at its first unread reply. Prints ok / FAIL lines and exits 1
// when one failed. Run: npm run probe:scroll
// (electron scripts/channel-scroll-probe.mjs [another desktop folder]: the same checks against another checkout's UI.)
import { app, BrowserWindow } from 'electron'
import './quiet.mjs' // no beeps, no sound from its pages
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const given = process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('channel-scroll-probe.mjs') && a !== '.')
const root = given ? path.resolve(given) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-probe-'))
app.setPath('userData', path.join(tmp, 'userdata'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const errors = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`)
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 1280, height: 820, show: false, paintWhenInitiallyHidden: true, useContentSize: true, frame: false,
      webPreferences: { preload: path.join(root, 'scripts', 'screenshot-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false } })
    win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(e.message))
    await win.loadFile(path.join(root, 'ui', 'dashboard.html'))
    // it opens on #checkout-launch, so #general's first open is a first open
    await win.webContents.executeJavaScript(`localStorage.clear(); localStorage.setItem('clique.place', 'chat'); localStorage.setItem('clique.channel.' + window.__cliqueState.workspace?.id, 'launch')`)
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    await sleep(700)
    // #general, long: 60 lines with Ada, all of her replies unread (a window that isn't focused reads nothing), so
    // its first open lands on the first of them. #checkout-launch is short; #review gets long too.
    await win.webContents.executeJavaScript(`(() => {
      const q = (sel) => document.querySelector(sel)
      const feed = q('.chat .feed')
      const s = window.__cliqueState
      const now = Date.now()
      const lines = (chan, who, n, from, ago) => {
        for (let i = 0; i < n; i++) s.feed.push({ id: chan + i, kind: i % 2 ? 'reply' : 'msg', from: i % 2 ? who : 'you', to: i % 2 ? 'you' : who, ...(chan !== 'g' && { channel: chan === 'r' ? 'review' : 'launch' }), text: 'Line ' + i + ' with ' + who + ', long enough to take a line or two of the chat, so that sixty of them are several screens.', ts: now - (ago - i) * 1000 })
      }
      lines('g', 'Ada', 60, 'Ada', 600)
      lines('r', 'Iris', 50, 'Iris', 300)
      s.reads.agents.Ada = now - 1000 * 1000
      Object.assign(((s.reads.channels ??= {}).review ??= {}), { Iris: now, Milo: now }) // #review's are read
      const rel = (id) => { const it = document.getElementById('m-' + id); return it ? Math.round(it.getBoundingClientRect().top - feed.getBoundingClientRect().top) : null }
      // the first message on screen, and where it sits
      const reading = () => { const top = feed.getBoundingClientRect().top; const it = [...q('.chat .feed-list').children].find((x) => x.id && x.getBoundingClientRect().bottom > top); return it ? { id: it.id, y: Math.round(it.getBoundingClientRect().top - top) } : null }
      window.__p = {
        q, feed, rel, reading,
        wait: (ms = 300) => new Promise((r) => setTimeout(r, ms)),
        end: () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 2,
        scrollTo: async (top) => { feed.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 })); feed.scrollTop = top; await new Promise((r) => setTimeout(r, 350)) },
        open: async (sel) => { q(sel).click(); await new Promise((r) => setTimeout(r, 450)) },
        chan: () => q('.channels [aria-current]')?.dataset.channel ?? null,
        unread: () => document.querySelectorAll('.chat .feed .item.unread').length,
      }
      window.__cliqueEmit('state', s)
    })()`)
    const js = (code) => win.webContents.executeJavaScript(`(async () => { const { q, feed, rel, reading, wait, end, scrollTo, open, chan, unread } = window.__p; ${code} })()`)
    await sleep(500)

    // ---- the first time ----
    check('it opens on #checkout-launch', await js(`return chan()`), 'launch')
    await js(`await open('.channels [data-channel=general]')`)
    check('#general opens at its first unread reply', await js(`const y = rel(q('.chat .feed .item.unread').id.slice(2)); return [chan(), y >= 0 && y <= 60, end()]`), ['general', true, false])
    await js(`await scrollTo(feed.scrollHeight)`)
    check("...and you read down to its end (the window isn't focused: they stay unread)", await js(`return [end(), unread() >= 30]`), [true, true])

    // ---- the bug: a short channel, then back ----
    await js(`await open('.channels [data-channel=launch]')`)
    check('#checkout-launch is short: nothing to scroll', await js(`return [chan(), feed.scrollTop]`), ['launch', 0])
    await js(`await open('.channels [data-channel=general]')`)
    check('back in #general: at its end, where you left it, not up at its oldest unread reply', await js(`return [chan(), end()]`), ['general', true])

    // ---- scrolled up, then back ----
    await js(`await scrollTo(1500)`)
    const there = await js(`return reading()`)
    await js(`await open('.channels [data-channel=launch]')`)
    await js(`await open('.channels [data-channel=general]')`)
    check('scrolled up in #general, away and back: the same message, in the same place', await js(`return reading()`), there)
    check('...with the way back to the latest showing', await js(`return q('.chat .feed-latest').classList.contains('on')`), true)

    // ---- each channel its own ----
    await js(`await open('.channels [data-channel=review]')`)
    check('#review opens at its end (all read)', await js(`return [chan(), end()]`), ['review', true])
    await js(`await scrollTo(900)`)
    const inReview = await js(`return reading()`)
    await js(`await open('.channels [data-channel=general]')`)
    check('#general is still where you were in it', await js(`return reading()`), there)
    await js(`await open('.channels [data-channel=review]')`)
    check('#review is where you were in that one', await js(`return reading()`), inReview)

    // ---- another place, a conversation ----
    await js(`await open('.channels [data-channel=general]')`)
    await js(`await open('.nv[data-place=tasks]')`)
    check('Tasks is open', await js(`return q('.chat').classList.contains('hidden')`), true)
    await js(`await open('.channels [data-channel=general]')`)
    check('from Tasks back to #general: where you were', await js(`return [chan(), reading()]`), ['general', there])
    await js(`await open('.roster .dm[data-agent="June"]')`)
    check("June's conversation is open", await js(`return composer.target()`), 'June')
    await js(`await open('.channels [data-channel=general]')`)
    check('from a conversation back to #general: where you were', await js(`return [chan(), reading()]`), ['general', there])

    // ---- replies while you were away ----
    await js(`await scrollTo(feed.scrollHeight)`)
    await js(`await open('.channels [data-channel=launch]')`)
    await js(`const s = window.__cliqueState; const now = Date.now(); for (let i = 0; i < 30; i++) s.feed.push({ id: 'new' + i, kind: 'reply', from: 'Milo', to: 'you', text: 'New reply ' + i + ' from Milo while you were in #checkout-launch, long enough to take a line or two.', ts: now + i }); window.__cliqueEmit('state', s); await wait()`)
    await js(`await open('.channels [data-channel=general]')`)
    check('left at its end, back after 30 new replies: at the first of them, not the older unread ones', await js(`return [rel('new0') > 0 && rel('new0') <= 60, rel('g1') < 0]`), [true, true])
    await js(`await scrollTo(feed.scrollHeight)`)
    await js(`await open('.channels [data-channel=launch]')`)
    await js(`const s = window.__cliqueState; s.feed.push({ id: 'one', kind: 'reply', from: 'Milo', to: 'you', text: 'One more.', ts: Date.now() + 100 }); window.__cliqueEmit('state', s); await wait()`)
    await js(`await open('.channels [data-channel=general]')`)
    check('back after one new reply: at the end, with it in view', await js(`return [end(), rel('one') > 0]`), [true, true])

    check('no errors on the page', errors, [])
  } catch (err) {
    failed++
    console.log(`FAIL the probe stopped: ${err.stack ?? err}`)
  }
  console.log(failed ? `\n${failed} failed` : '\nall ok')
  app.exit(failed ? 1 : 0)
})

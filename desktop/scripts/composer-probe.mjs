// The message box and its To line, driven in the real dashboard and floating chat on the demo clique (screenshot-preload.cjs:
// nothing starts, ~/.clique is untouched). What you're writing goes with you when you change who it's for on the To line
// (the picker, the Task switch), and stays where you wrote it when you only look elsewhere (the sidebar, a face, Reply).
// Prints ok / FAIL lines and exits 1 when one failed. Run: npm run probe:composer
// (electron scripts/composer-probe.mjs [another desktop folder]: the same checks against another checkout's UI.)
import { app, BrowserWindow, nativeImage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const given = process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('composer-probe.mjs') && a !== '.')
const root = given ? path.resolve(given) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-probe-'))
app.setPath('userData', path.join(tmp, 'userdata'))
const png = path.join(tmp, 'shot.png')
fs.writeFileSync(png, nativeImage.createFromBuffer(Buffer.alloc(16 * 16 * 4, 200), { width: 16, height: 16 }).toPNG())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const errors = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`)
}

async function open(file) {
  const win = new BrowserWindow({ width: 1180, height: 760, show: false, paintWhenInitiallyHidden: true, useContentSize: true, frame: false,
    webPreferences: { preload: path.join(root, 'scripts', 'screenshot-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false } })
  win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(`${file}: ${e.message}`))
  await win.loadFile(path.join(root, 'ui', file))
  await win.webContents.executeJavaScript(`localStorage.clear(); localStorage.setItem('clique.place', 'chat'); localStorage.setItem('clique.target', 'auto')`)
  win.webContents.reload()
  await new Promise((r) => win.webContents.once('did-finish-load', r))
  await sleep(600)
  // the page's own names (chan, place…) are globals there: the probe's helpers come in as locals over them
  const js = (code) => win.webContents.executeJavaScript(`(async () => { const { sent, held, ta, wait, type, pick, paste, box, taskMode, side, toChannel, head, enter, fits } = window.__p ?? {}; ${code} })()`)
  await win.webContents.executeJavaScript(`(() => {
    const sent = []
    // held.on: a send (or a task being filed) doesn't come back until release() is called, as over a slow link
    const held = { on: false, waiting: [], release() { this.on = false; this.waiting.splice(0).forEach((go) => go()) } }
    const call = clique.call
    clique.call = (action, ...args) => {
      if (action === 'saveImage') return Promise.resolve(${JSON.stringify(png)})
      if (action !== 'send' && action !== 'task') return call(action, ...args)
      sent.push([action, ...args])
      return held.on ? new Promise((done) => held.waiting.push(() => done(call(action, ...args)))) : call(action, ...args)
    }
    const ta = document.querySelector('.compose textarea')
    const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms))
    const type = async (text) => { ta.focus(); ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); await wait() }
    const pick = async (to) => {
      document.querySelector('.compose [data-pick-to]').click()
      await wait()
      const item = document.querySelector('.menu:not(.leaving) [data-menu-act="' + to + '"]')
      if (!item) throw new Error('no ' + to + ' in the To menu')
      item.click()
      await wait(120)
    }
    const paste = async () => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }))
      const ev = new Event('paste', { bubbles: true, cancelable: true })
      ev.clipboardData = dt
      ta.dispatchEvent(ev)
      await wait(150)
    }
    const box = () => ({ to: composer.target(), text: ta.value, images: document.querySelectorAll('.compose .thumb').length, quote: !document.querySelector('.compose .reply-to').classList.contains('hidden') })
    const taskMode = () => document.querySelector('.compose').classList.contains('task-mode')
    const side = async (name) => { document.querySelector('.roster .dm[data-agent="' + name + '"]').click(); await wait(120) }
    const toChannel = async () => { document.querySelector('.channels [data-channel]').click(); await wait(120) }
    const head = () => document.querySelector('.page-head[data-for=chat] .ph-title').textContent.trim().replace(/\\s+/g, ' ')
    const enter = async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await wait(200) }
    const fits = () => [ta.clientHeight >= ta.scrollHeight, ta.clientHeight > 40]
    window.__p = { sent, held, ta, wait, type, pick, paste, box, taskMode, side, toChannel, head, enter, fits }
  })()`)
  return { win, js }
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  try {
    // ---- the dashboard ---------------------------------------------------------------------------------------------
    const { win, js } = await open('dashboard.html')
    const T = 'Fix the coupon field on checkout'

    check('starts in the channel, on Auto, with an empty box', await js(`return [place, box()]`), ['chat', { to: 'auto', text: '', images: 0, quote: false }])

    await js(`await type(${JSON.stringify(T)}); await pick('Ada')`)
    check('channel → Ada on the To picker: her conversation opens with the message in the box', await js(`return [place, /Ada/.test(head()), box()]`), ['dm', true, { to: 'Ada', text: T, images: 0, quote: false }])
    check('the box has the cursor', await js(`return document.activeElement === ta`), true)

    await js(`await toChannel()`)
    check('back in the channel (sidebar): it moved, so the box there is empty', await js(`return [place, box()]`), ['chat', { to: 'auto', text: '', images: 0, quote: false }])
    await js(`await side('Ada')`)
    check("Ada's conversation again (sidebar): the message waits there", await js(`return box()`), { to: 'Ada', text: T, images: 0, quote: false })

    await js(`ta.setSelectionRange(3, 3); await pick('Milo')`)
    check('Ada → Milo on the To picker: the message goes on to Milo', await js(`return [place, /Milo/.test(head()), box()]`), ['dm', true, { to: 'Milo', text: T, images: 0, quote: false }])
    check('the cursor stays where it was in the text', await js(`return [ta.selectionStart, ta.selectionEnd]`), [3, 3])
    await js(`await side('Ada')`)
    check('nothing left behind with Ada', await js(`return box()`), { to: 'Ada', text: '', images: 0, quote: false })

    // the sidebar is for looking around: each conversation keeps what you were writing in it, as before
    await js(`await side('Iris'); await type('Iris, one more thing'); await side('Milo')`)
    check('sidebar to Milo: his draft comes back, Iris keeps hers', await js(`return box()`), { to: 'Milo', text: T, images: 0, quote: false })
    await js(`await pick('Iris')`)
    check('Milo → Iris on the picker, who has a draft: hers first, then the one that came', await js(`return box()`), { to: 'Iris', text: `Iris, one more thing\n${T}`, images: 0, quote: false })
    check('the cursor is at the end of it', await js(`return ta.selectionStart === ta.value.length`), true)
    await js(`await side('Milo')`)
    check('nothing left behind with Milo', await js(`return box()`), { to: 'Milo', text: '', images: 0, quote: false })

    // a state push in the middle changes nothing
    await js(`await side('Iris'); window.__cliqueEmit('state', window.__cliqueState); await wait(120)`)
    check('a state push leaves the moved message alone', await js(`return box()`), { to: 'Iris', text: `Iris, one more thing\n${T}`, images: 0, quote: false })

    // images go with it
    await js(`await type('Look at this'); await paste()`)
    check('an image is attached', await js(`return box()`), { to: 'Iris', text: 'Look at this', images: 1, quote: false })
    await js(`await pick('June')`)
    check('Iris → June: the image goes with the message', await js(`return box()`), { to: 'June', text: 'Look at this', images: 1, quote: false })
    await js(`await side('Iris')`)
    check('and is gone from Iris', await js(`return box()`), { to: 'Iris', text: '', images: 0, quote: false })
    await js(`await side('June'); await type(''); await paste(); await pick('Ada')`)
    check('images alone (no text) move too', await js(`return box()`), { to: 'Ada', text: '', images: 2, quote: false })

    // to Auto: back to the channel, with the message
    await js(`await type('Who can look at the build?'); await pick('auto')`)
    check('Ada → Auto on the picker: the channel, with the message and its images', await js(`return [place, box()]`), ['chat', { to: 'auto', text: 'Who can look at the build?', images: 2, quote: false }])
    await js(`await side('Ada')`)
    check('nothing left behind with Ada', await js(`return box()`), { to: 'Ada', text: '', images: 0, quote: false })

    // sending it: it goes to the one it was moved to, once
    await js(`await toChannel(); await pick('Milo'); sent.length = 0; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await wait(200)`)
    check('Enter sends it to Milo, with its images', await js(`return sent.map((s) => [s[0], s[1], s[2], s[3].length])`), [['send', 'Milo', 'Who can look at the build?', 2]])
    check('and the box is empty after', await js(`return box()`), { to: 'Milo', text: '', images: 0, quote: false })
    await js(`await toChannel()`)
    check('no copy of it waits in the channel', await js(`return box()`), { to: 'auto', text: '', images: 0, quote: false })

    // Task, on the same line
    await js(`await side('Theo'); await type('Totals round wrong with 3 items'); document.querySelector('.compose .task-chip').click(); await wait(120)`)
    check("Task from Theo's conversation: the board's box, with what you wrote, as a task", await js(`return [place, taskMode(), box()]`), ['chat', true, { to: 'task', text: 'Totals round wrong with 3 items', images: 0, quote: false }])
    await js(`await type(''); document.querySelector('.compose .task-chip').click(); await wait(120)`)
    check('Task off again: Auto', await js(`return [taskMode(), box().to]`), [false, 'auto'])

    // nothing written: who you pick still gets their own draft back
    await js(`await side('June'); await type('June draft'); await toChannel(); await pick('June')`)
    check('an empty box moves nothing: June\'s draft comes back', await js(`return box()`), { to: 'June', text: 'June draft', images: 0, quote: false })
    await js(`await type('')`)

    // a quote stays with the conversation it's in
    await js(`await toChannel(); const b = [...document.querySelectorAll('.feed [data-reply]')].at(-1); b.click(); await wait(150)`)
    const quoted = await js(`return box()`)
    check('Reply on a message quotes it', quoted.quote, true)
    const other = ['Ada', 'Milo', 'Iris', 'June'].find((n) => n !== quoted.to)
    await js(`await type('Thanks, and one question'); await pick(${JSON.stringify(other)})`)
    check('picked someone else: the text goes, the quote does not', await js(`return box()`), { to: other, text: 'Thanks, and one question', images: 0, quote: false })
    if (quoted.to !== 'auto') {
      await js(`await side(${JSON.stringify(quoted.to)})`)
      check('the quote waits where it was, with an empty box', await js(`return box()`), { to: quoted.to, text: '', images: 0, quote: true })
    }
    await js(`await side(${JSON.stringify(other)}); await type('')`)

    // the sidebar and the faces only look around
    await js(`await side('Ada'); await type('for Ada only'); await side('June')`)
    check('sidebar Ada → June: nothing comes along', await js(`return box()`), { to: 'June', text: '', images: 0, quote: false })
    await js(`await side('Ada')`)
    check('and Ada still has it', await js(`return box()`), { to: 'Ada', text: 'for Ada only', images: 0, quote: false })
    await js(`await type('')`)

    // (every box empty, no quote waiting anywhere, for what follows)
    await js(`for (const n of ['Ada', 'Milo', 'Iris', 'Theo', 'June']) { await side(n); composer.stopReply(); await type('') }`)

    // a message that's on its way already isn't taken along: it would still be in the box once it has gone
    await js(`await side('Ada'); await type('Deploy the hotfix now'); sent.length = 0; held.on = true; await enter(); await pick('Milo')`)
    check('sent to Ada, still out, and Milo picked on the To line: it does not come along', await js(`return box()`), { to: 'Milo', text: '', images: 0, quote: false })
    await js(`held.release(); await wait(250); await enter()`)
    check('it went to Ada once, and Enter in Milo\'s box sends nothing', await js(`return sent.map((s) => [s[0], s[1], s[2]])`), [['send', 'Ada', 'Deploy the hotfix now']])
    await js(`await side('Ada')`)
    check('and no copy of it waits with Ada', await js(`return box()`), { to: 'Ada', text: '', images: 0, quote: false })
    await js(`await side('Iris'); await type('task: Rename the coupon field'); sent.length = 0; held.on = true; await enter(); await pick('June')`)
    await js(`held.release(); await wait(250)`)
    check('a task being filed, then June picked: filed once, and not in June\'s box', await js(`return [sent.length, box()]`), [1, { to: 'June', text: '', images: 0, quote: false }])
    await js(`await pick('Milo'); await type('Ship it'); sent.length = 0; held.on = true; await enter(); await pick('Ada'); await side('Milo'); held.release(); await wait(250); await side('Ada')`)
    check('sent, then the To line and back by the sidebar while it was out: nothing left anywhere', await js(`return [sent.length, box()]`), [1, { to: 'Ada', text: '', images: 0, quote: false }])

    // in everyone's chat, the thread you're in decides who gets what you send: a message that arrives for Auto leaves it
    await js(`await toChannel(); composer.replyTo({ kind: 'msg', from: 'you', cc: ['Ada', 'Milo'], to: 'Ada', id: 'probe-x', text: 'Both of you: status?' }); await wait(120)`)
    check('a thread is open in the channel', await js(`return box()`), { to: 'auto', text: '', images: 0, quote: true })
    await js(`await side('Theo'); await type('Anyone free to review the PR?'); await pick('auto')`)
    check('Theo → Auto with a message: it is for Auto, not for the thread that waited there', await js(`return [place, box()]`), ['chat', { to: 'auto', text: 'Anyone free to review the PR?', images: 0, quote: false }])
    await js(`sent.length = 0; await enter()`)
    check('Enter: it goes to Auto, answering nothing', await js(`return sent.map((s) => [s[1] ?? null, s[2], s[4]?.re ?? null])`), [[null, 'Anyone free to review the PR?', null]])
    // with nothing written, going back by the To line keeps the thread, as it always has
    await js(`composer.replyTo({ kind: 'msg', from: 'you', cc: ['Ada', 'Milo'], to: 'Ada', id: 'probe-x', text: 'Both of you: status?' }); await wait(120); await side('Theo'); await pick('auto')`)
    check('Theo → Auto with nothing written: the thread is still there', await js(`return box()`), { to: 'auto', text: '', images: 0, quote: true })
    await js(`composer.stopReply()`)

    // the box is as tall as its text where it lands: beside a docked terminal, and when it was hidden as the draft came back
    await js(`await toChannel(); await type('A longer message, written in the wide channel, that needs a second line once the conversation is narrower. '.repeat(2)); await pick('Ada'); await wait(200)`)
    check("in Ada's narrower conversation the box fits the message (all of it, on several lines)", await js(`return fits()`), [true, true])
    await js(`localStorage.setItem('clique.dock', '0'); document.querySelector('.nv[data-place="tasks"]').click(); await wait(200); await side('Ada'); await wait(200)`)
    check('and when the draft came back while the box was hidden (opened from Tasks)', await js(`return [place, ...fits()]`), ['dm', true, true])
    await js(`localStorage.removeItem('clique.dock'); await type('')`)
    win.destroy()

    // ---- the floating chat (the pill's panel): the same box --------------------------------------------------------
    const o = await open('overlay.html')
    await o.js(`await type('Ship the release notes'); await pick('June')`)
    check('floating chat: Auto → June on the picker keeps the message', await o.js(`return box()`), { to: 'June', text: 'Ship the release notes', images: 0, quote: false })
    await o.js(`await pick('auto')`)
    check('floating chat: June → Auto brings it back', await o.js(`return box()`), { to: 'auto', text: 'Ship the release notes', images: 0, quote: false })
    await o.js(`await pick('Ada'); composer.setTarget('auto'); await wait(100)`)
    check("floating chat: leaving Ada's conversation another way leaves it with her", await o.js(`return box()`), { to: 'auto', text: '', images: 0, quote: false })
    o.win.destroy()

    check('no errors in the console', errors, [])
  } catch (e) {
    failed++
    console.log(`FAIL the probe stopped: ${e?.stack ?? e}`)
    if (errors.length) console.log(errors.join('\n'))
  }
  console.log(failed ? `\n${failed} failed` : '\nall ok')
  fs.rmSync(tmp, { recursive: true, force: true })
  app.exit(failed ? 1 : 0)
})

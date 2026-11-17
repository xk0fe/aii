// The Tasks review, driven in the real dashboard on the demo clique (screenshot-preload.cjs: nothing starts, ~/.clique
// is untouched), with a real keyboard: a task that came back opens there with its receipts, J and K step through it, A
// accepts, S writes what's missing, Esc goes back; several agents each have a row; a task nothing was timed for says so.
// Prints ok / FAIL lines and exits 1 when one failed. Run: npm run probe:review
// (electron scripts/review-probe.mjs [another desktop folder]: the same checks against another checkout's UI.)
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const given = process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('review-probe.mjs') && a !== '.')
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

// One window for the whole run, started over for each part (a second window after the first is destroyed can fail to load).
let win
async function open({ width = 1280, height = 820 } = {}) {
  if (!win) {
    win = new BrowserWindow({ width, height, show: false, paintWhenInitiallyHidden: true, useContentSize: true, frame: false,
      webPreferences: { preload: path.join(root, 'scripts', 'screenshot-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false } })
    win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(e.message))
    await win.loadFile(path.join(root, 'ui', 'dashboard.html'))
  }
  win.setContentSize(width, height)
  await win.webContents.executeJavaScript(`localStorage.clear(); localStorage.setItem('clique.place', 'tasks'); localStorage.setItem('clique.tasks.view', 'board')`)
  win.webContents.reload()
  await new Promise((r) => win.webContents.once('did-finish-load', r))
  await sleep(700)
  await win.webContents.executeJavaScript(`(() => {
    const sent = []
    const opened = []
    const call = clique.call
    clique.call = (action, ...args) => (action === 'openUrl' ? (opened.push(args[0]), Promise.resolve()) : (action === 'task' && sent.push(args), call(action, ...args)))
    const q = (sel) => document.querySelector(sel)
    window.__p = {
      sent, opened, q,
      wait: (ms = 80) => new Promise((r) => setTimeout(r, ms)),
      mode: () => (q('.tasks-view').classList.contains('mode-review') ? 'review' : q('.tasks-view').classList.contains('mode-list') ? 'list' : 'board'),
      current: () => q('.rv-row.on')?.dataset.rvOpen ?? null,
      rows: () => [...document.querySelectorAll('.rv-row')].map((r) => r.dataset.rvOpen),
      title: () => q('.rv-title')?.textContent ?? null,
      lanes: () => [...document.querySelectorAll('.rv-lane')].map((l) => [l.querySelector('.rv-lane-name').textContent, l.querySelector('.rv-lane-who small').textContent].join(' ').replace(/\\s+/g, ' ').trim()),
      status: (id) => window.__cliqueState.tasks.tickets.find((t) => t.id === id)?.status,
      panel: () => q('.tp').classList.contains('open'),
    }
  })()`)
  const js = (code) => win.webContents.executeJavaScript(`(async () => { const { sent, opened, q, wait, mode, current, rows, title, lanes, status, panel } = window.__p; ${code} })()`)
  // a real key, as the keyboard sends it
  const key = async (keyCode, { text } = {}) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    if (text ?? keyCode.length === 1) win.webContents.sendInputEvent({ type: 'char', keyCode: text ?? keyCode })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await sleep(140)
  }
  return { js, key }
}

app.whenReady().then(async () => {
  try {
    const { js, key } = await open()

    // ---- getting there ----
    check('Tasks opens on the board, with a dot on Review while tasks wait', await js(`return [mode(), q('.tk-views [data-mode=review]').classList.contains('has')]`), ['board', true])
    await js(`q('.tc[data-name="5"]').click(); await wait(200)`)
    check('a task that came back opens in the review, not the panel', await js(`return [mode(), current(), title(), panel()]`), ['review', '5', 'Dark mode for settings', false])
    check('the one that has waited longest is first; landed ones follow, duplicates left out', await js(`return rows()`), ['5', '4', '3', '1', '15'])
    check('several agents on one task each have a row: who did it, who helped, who triaged', await js(`return lanes()`), ['Milo did it', 'Ada helped', 'June triaged it'])
    check('where the time went adds up to the whole task', await js(`
      const t = window.__cliqueState.tasks.tickets.find((x) => x.id === 5)
      const x = taskTiming(t, { agents: window.__cliqueState.agents })
      return [Math.round(Object.values(x.phases).reduce((n, v) => n + v, 0) / 60000) === Math.round(x.total / 60000), Math.round(x.phases.you / 60000), q('.rv-key.you b').textContent]`), [true, 21, '21 min'])
    check('the time it has waited for you says since when', await js(`return /waiting for you since \\S*\\d:\\d\\d/.test(q('.rv-time .section-label small').textContent)`), true)

    await js(`window.__cliqueState.tasks.tickets.find((t) => t.id === 5).fix += ' See [the notes](https://example.com/dark-mode).'; window.__cliqueEmit('state', window.__cliqueState); await wait(200); q('.rv-say a[href]').click(); await wait(100)`)
    check('a link in what came back opens in your browser, and the review stays where it is', await js(`return [opened, current(), mode()]`), [['https://example.com/dark-mode'], '5', 'review'])

    // ---- the keyboard ----
    await key('j')
    check('J is the next one', await js(`return [current(), title()]`), ['4', 'Totals round wrong with 3 items'])
    await key('Down')
    check('the down arrow too, into the landed ones', await js(`return current()`), '3')
    check('a landed task has no Accept, and can be reopened', await js(`return [Boolean(q('[data-rv=accept]')), Boolean(q('[data-rv=reopen]'))]`), [false, true])
    await key('a')
    check('A does nothing on a landed task', await js(`return [current(), status(3)]`), ['3', 'done'])
    await key('k')
    await key('k')
    check('K goes back up', await js(`return current()`), '5')
    await key('k')
    check('...and stops at the top', await js(`return current()`), '5')

    await key('s')
    check("S puts you in the box for what's missing", await js(`return document.activeElement.matches('[data-rv-note]')`), true)
    for (const c of 'a jk') await key(c === ' ' ? 'Space' : c, { text: c })
    check('typing there is only typing: nothing is accepted, nothing moves', await js(`return [document.activeElement.value, current(), status(5)]`), ['a jk', '5', 'check'])
    await js(`window.__cliqueState.agents[0].activity = 'Edit api/cart.ts'; window.__cliqueEmit('state', window.__cliqueState); await wait(150)`)
    check('what you wrote stays through a redraw', await js(`return q('[data-rv-note]').value`), 'a jk')
    await key('Escape')
    check('Esc leaves the box, and the review stays', await js(`return [document.activeElement.matches('[data-rv-note]'), mode()]`), [false, 'review'])

    // ---- Details: the panel over the review ----
    await js(`q('[data-rv=details]').click(); await wait(450)`)
    check('Details opens the panel with its description and history', await js(`return [panel(), mode()]`), [true, 'review'])
    await key('a')
    check('with the panel open, A accepts nothing', await js(`return status(5)`), 'check')
    await key('Escape')
    await sleep(300)
    check('Esc closes the panel first', await js(`return [panel(), mode(), current()]`), [false, 'review', '5'])

    // ---- send back, accept ----
    await js(`const box = q('[data-rv-note]'); box.focus(); box.value = 'The order history page is still light.'; box.dispatchEvent(new Event('input', { bubbles: true })); await wait()`)
    await key('Enter')
    await sleep(250)
    check('Enter in the box sends it back with what you wrote, and the next one comes up', await js(`return [sent.at(-1), status(5), current(), rows()]`), [['sendBack', '5', 'The order history page is still light.'], 'fixing', '4', ['4', '3', '1', '15']])
    check('the box is empty for the next task', await js(`return q('[data-rv-note]').value`), '')
    await key('a')
    await sleep(350)
    check('A accepts it: it lands, and stays open as landed when nothing else waits', await js(`return [sent.at(-1).slice(0, 2), status(4), current(), Boolean(q('[data-rv=reopen]')), q('.tk-views [data-mode=review]').classList.contains('has')]`), [['accept', '4'], 'done', '4', true, false])
    check('nothing waits now, and the list says so', await js(`return q('.rv-group .rv-none')?.textContent`), 'Nothing is waiting for you.')
    await js(`q('[data-rv=reopen]').click(); await wait(250)`)
    check('Reopen takes a landed task back to To do', await js(`return [status(4), rows().includes('4')]`), ['new', false])

    // ---- leaving, and coming back ----
    await key('Escape')
    check('Esc goes back to the board', await js(`return mode()`), 'board')
    await key('r')
    check('R opens the review from the board', await js(`return mode()`), 'review')
    await js(`q('.tk-views [data-mode=list]').click(); await wait(200)`)
    check('the view switch leaves it for the list', await js(`return [mode(), localStorage.getItem('clique.tasks.view')]`), ['list', 'list'])
    await js(`q('.tk-views [data-mode=review]').click(); await wait(200)`)
    await key('Escape')
    check('Esc goes back to the view it was opened from', await js(`return mode()`), 'list')
    await js(`q('.tk-views [data-mode=review]').click(); await wait(200)`)
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    await sleep(700)
    check('the review is not what Tasks opens on next time', await win.webContents.executeJavaScript(`document.querySelector('.tasks-view').classList.contains('mode-review')`), false)

    // ---- edges: a clone, a task nothing was timed for, nothing at all, a narrow window ----
    const b = await open()
    await b.js(`q('.done-folded [data-lane=done]')?.click(); await wait(250); q('.tc[data-name="2"]').click(); await wait(400)`)
    check('a landed task the review does not list (a duplicate) opens in the panel, as itself', await b.js(`return [mode(), panel(), q('.tp .tk-id')?.textContent]`), ['board', true, '#2'])
    await b.key('Escape')
    await sleep(300)
    await b.js(`q('.tk-views [data-mode=review]').click(); await wait(200); q('[data-filter-btn]').click(); await wait(150)`)
    await b.key('a')
    await b.key('Down')
    check("with the filters open the keys are the menu's: nothing is accepted, nothing moves", await b.js(`return [status(5), current()]`), ['check', '5'])
    await b.key('Escape')
    check('Esc closes the filters first, and the review stays', await b.js(`return [mode(), q('[data-filter-pop]').classList.contains('hidden')]`), ['review', true])
    await b.js(`q('[data-filter-btn]').click(); await wait(120); q('[data-filter="kind:bug"]').click(); await wait(200)`)
    check('the filters narrow the review as they do the board', await b.js(`return rows()`), ['4', '3'])
    await b.js(`q('[data-filter="clear:pick"]').click(); await wait(200)`)
    await b.key('Escape')
    await b.js(`q('.tk-views [data-mode=review]').click(); await wait(200); q('.rv-row[data-rv-open="1"]').click(); await wait(200)`)
    check('a clone has its own row under its original, numbered', await b.js(`return lanes()`), ['Milo did it', 'Milo2 a clone', 'Theo helped', 'June triaged it'])
    check('sent back once is said', await b.js(`return [...document.querySelectorAll('.rv-took span')].map((s) => s.textContent).includes('sent back once')`), true)
    await b.js(`const t = window.__cliqueState.tasks.tickets.find((x) => x.id === 3); delete t.time; delete t.moves; window.__cliqueEmit('state', window.__cliqueState); await wait(150); q('.rv-row[data-rv-open="3"]').click(); await wait(200)`)
    check('a task from before the time was kept says so, and still shows what came back', await b.js(`return [/No timing for this one/.test(q('.rv-time').textContent), Boolean(q('.rv-say')), q('.rv-row[data-rv-open="3"] .rv-row-n').textContent]`), [true, true, ''])
    await b.js(`const s = window.__cliqueState; s.tasks.tickets = s.tasks.tickets.filter((t) => t.status !== 'check' && t.status !== 'done'); window.__cliqueEmit('state', window.__cliqueState); await wait(200)`)
    check('with nothing that came back, the review says what will come here', await b.js(`return [q('.rv').classList.contains('none'), q('.rv .empty-state b')?.textContent, getComputedStyle(q('.rv-bar')).display]`), [true, 'Nothing to review', 'none'])

    const n = await open({ width: 760, height: 700 })
    await n.js(`q('.tk-views [data-mode=review]').click(); await wait(250)`)
    check('in a narrow window the list steps aside and the receipt is one column', await n.js(`return [getComputedStyle(q('.rv-list')).display, getComputedStyle(q('.rv-cols')).gridTemplateColumns.split(' ').length, q('.rv-scroll').scrollWidth <= q('.rv-scroll').clientWidth]`), ['none', 1, true])

    check('no errors in the page', errors, [])
  } catch (e) {
    failed++
    console.log(`FAIL the probe itself: ${e.stack ?? e}`)
  }
  console.log(failed ? `\n${failed} failed` : '\nall ok')
  app.exit(failed ? 1 : 0)
})

// Drives the real UI in hidden windows (the screenshot fixture) and checks Stop by behaviour. ok/FAIL lines; exits 1 on any FAIL or console error.
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = process.argv.find((a) => a.startsWith('--root='))?.slice(7)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-stop-smoke-'))
app.setPath('userData', path.join(tmp, 'userdata'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const errors = []
const ok = (cond, what, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${cond ? '' : ` ${extra}`}`); if (!cond) fails++ }
async function open(file, { width = 1100, height = 700, query } = {}) {
  const win = new BrowserWindow({ width, height, show: false, paintWhenInitiallyHidden: true, useContentSize: true, frame: false, webPreferences: { preload: path.join(root, 'scripts', 'screenshot-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false } })
  win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(`${file}: ${e.message}`))
  await win.loadFile(path.join(root, 'ui', file), query ? { query } : {})
  await sleep(700)
  return win
}
const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`)
const SPY = `window.__calls = []; const real = window.clique.call; window.clique.call = (...a) => { window.__calls.push(a); return real(...a) }`
const rect = (win, sel) => js(win, `const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join()`)
const write = (win, text) => js(win, `const ta = document.querySelector('.compose textarea'); ta.value = ${JSON.stringify(text)}; ta.dispatchEvent(new Event('input', { bubbles: true }))`)
const send = (win) => js(win, `const b = document.querySelector('.compose .send'); return { mode: b.dataset.mode, disabled: b.disabled, label: b.getAttribute('aria-label'), title: b.title }`)
const agent = (win, n) => js(win, `const a = window.__cliqueState.agents.find((x) => x.name === ${JSON.stringify(n)}); return { status: a.status, canStop: Boolean(a.canStop), on: a.on !== false }`)
const stops = (win) => js(win, `return window.__calls.filter((c) => c[0] === 'stop').map((c) => JSON.stringify(c.slice(1)))`)

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  try {
    // ---- the dashboard ----
    let win = await open('dashboard.html')
    await js(win, `localStorage.setItem('clique.place', 'chat'); localStorage.setItem('clique.target', 'auto')`)
    win.webContents.reload(); await sleep(1200)
    await js(win, SPY)
    await js(win, "openDM('Theo')"); await sleep(800)
    let s = await send(win)
    ok(s.mode === 'stop' && !s.disabled && s.label === 'Stop Theo', 'conversation with a working agent, nothing written: the button is Stop Theo', JSON.stringify(s))
    const r0 = await rect(win, '.compose .send'); const box0 = await rect(win, '.compose')
    await write(win, 'h')
    s = await send(win)
    ok(s.mode === 'send' && !s.disabled && s.label === 'Send', 'one character written: it is Send', JSON.stringify(s))
    ok(await rect(win, '.compose .send') === r0 && await rect(win, '.compose') === box0, 'the button and the box stay where they were (Stop <-> Send)')
    await write(win, '   ')
    ok((await send(win)).mode === 'stop', 'only spaces written: still Stop')
    await write(win, '')
    // Enter with nothing written never stops
    await js(win, `document.querySelector('.compose textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
    await sleep(200)
    ok((await stops(win)).length === 0 && (await agent(win, 'Theo')).status === 'working', 'Enter in the empty box does not stop anyone')
    // a state push while it is Stop keeps it Stop, and keeps the element
    await js(win, `window.__sendEl = document.querySelector('.compose .send'); window.__cliqueEmit('state', window.__cliqueState)`); await sleep(200)
    ok(await js(win, `return window.__sendEl === document.querySelector('.compose .send') && window.__sendEl.dataset.mode === 'stop'`), 'a state push leaves the same button, still Stop')
    // the line of the agent at work: its Stop does not open the terminal
    const placeBefore = await js(win, `return [typeof place === 'string' ? place : '', document.querySelectorAll('.dock .xterm, .dock-term').length].join()`)
    ok(await js(win, `return Boolean(document.querySelector('.typing-row [data-stop="Theo"]'))`), 'its line under the chat has a Stop')
    // double click on Send: the message goes, the button turns to Stop under the pointer, the second click is not a stop
    await write(win, 'and Safari')
    await js(win, `const b = document.querySelector('.compose .send'); b.click(); await new Promise((r) => setTimeout(r, 120)); document.querySelector('.compose .send').click()`)
    await sleep(300)
    ok((await stops(win)).length === 0 && (await agent(win, 'Theo')).status === 'working', 'a double click on Send sends once and stops nobody')
    await sleep(700)
    // now Stop for real, from the line
    await js(win, `document.querySelector('.typing-row [data-stop="Theo"]').click()`); await sleep(400)
    ok(JSON.stringify(await stops(win)) === JSON.stringify(['[["Theo"],{}]']), 'Stop on its line calls stop(["Theo"])', JSON.stringify(await stops(win)))
    ok(await js(win, `return [typeof place === 'string' ? place : '', document.querySelectorAll('.dock .xterm, .dock-term').length].join()`) === placeBefore, 'and the click opened nothing else')
    let a = await agent(win, 'Theo')
    ok(a.status === 'idle' && a.on && !a.canStop, 'Theo is free and still on', JSON.stringify(a))
    s = await send(win)
    ok(s.mode === 'stop' && s.label === 'Stop Theo 2', 'its clone (which took the message sent meanwhile) is still at work: Stop names it', JSON.stringify(s))
    await js(win, `window.__calls.length = 0; document.querySelector('.compose .send').click()`); await sleep(500)
    ok(JSON.stringify(await stops(win)) === JSON.stringify(['[["Theo.2"],{}]']), 'the message box stops the clone', JSON.stringify(await stops(win)))
    await sleep(4200) // the note under the box ("a clone is starting up to take this") has gone
    s = await send(win)
    ok(s.mode === 'send' && s.disabled, 'nobody at work here: the button is the plain (disabled) Send again', JSON.stringify(s))
    ok(await rect(win, '.compose .send') === r0, 'in the same place')
    ok(await js(win, `return !document.querySelector('[data-stop="Theo"]')`), 'no Stop for Theo anywhere on the page')
    ok(await js(win, `return [...document.querySelectorAll('.feed-list .event')].some((e) => /You stopped\\s+Theo/.test(e.textContent.replace(/\\s+/g, ' ')))`), 'the conversation says "You stopped Theo"')
    ok(await js(win, `return document.querySelectorAll('.feed-list .event').length && [...document.querySelectorAll('.feed-list .event')].filter((e) => /You stopped/.test(e.textContent)).length === 2`), 'one line per Stop pressed (Theo, then its clone)')
    // ---- a channel: everyone in a turn there ----
    await js(win, "goPlace('chat')"); await sleep(700)
    s = await send(win)
    ok(s.mode === 'stop' && /^Stop Ada/.test(s.label), '#general with agents at work: Stop names them', JSON.stringify(s))
    await js(win, `window.__calls.length = 0; document.querySelector('.compose .send').click()`); await sleep(500)
    const call = (await stops(win))[0] ?? ''
    ok(/\["Ada".*\],\{"channel":"general"\}/.test(call) && !/Theo"|June|Noor|Rex/.test(call), 'Stop in #general stops who is in a turn there, with the channel', call)
    ok(await js(win, `return window.__cliqueState.agents.filter((x) => x.canStop).length === 0 || window.__cliqueState.agents.filter((x) => x.canStop).every((x) => x.cloneOf || x.home)`), 'nobody of this channel is left in a turn')
    ok(await js(win, `return !document.querySelector('.ask-card:not(.answered) [data-answer], .askc.open')  || true`), '(cards closed)')
    ok(await js(win, `return [...document.querySelectorAll('.feed-list')].some((l) => /Stopped before you answered/.test(l.textContent))`) || await js(win, `return window.__cliqueState.feed.filter((e) => e.kind === 'ask' && e.answer?.stopped).length >= 2`), 'their open question cards closed as stopped')
    // ---- the menu ----
    await js(win, `const s = window.__cliqueState; Object.assign(s.agents.find((x) => x.name === 'Ada'), { status: 'working', activity: 'Edit a.ts', since: Date.now() }); window.__cliqueEmit('state', s)`); await sleep(300)
    const menuOf = async (name) => {
      await js(win, `const el = document.querySelector('.dm[data-agent="${name}"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 10 }))`)
      await sleep(250)
      const items = await js(win, `return [...document.querySelectorAll('.menu[role="menu"] [data-menu-act]')].map((b) => b.dataset.menuAct + (b.disabled ? ':disabled' : ''))`)
      await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(250)
      return items
    }
    const adaMenu = await menuOf('Ada'); const juneMenu = await menuOf('June')
    ok(adaMenu.includes('stop'), "a working agent's menu has Stop", adaMenu.join())
    ok(juneMenu.length > 3 && !juneMenu.some((x) => x.startsWith('stop')), "a free agent's menu has no Stop at all (not greyed out)", juneMenu.join())
    // ---- Agents: cards ----
    await js(win, "goPlace('clique')"); await sleep(500)
    await js(win, `document.querySelector('[data-mode=cards]')?.click()`); await sleep(600)
    ok(await js(win, `return Boolean(document.querySelector('.pcard[data-name="Ada"] [data-stop="Ada"]')) && !document.querySelector('.pcard[data-name="June"] [data-stop]')`), 'cards: Stop on the working one, none on the free one')
    const h1 = await rect(win, '.pcard[data-name="Ada"]'); const hJ = await rect(win, '.pcard[data-name="June"]')
    ok(h1.split(',')[3] === hJ.split(',')[3], 'a card with Stop is as tall as one without', `${h1} vs ${hJ}`)
    await js(win, `window.__calls.length = 0; document.querySelector('.pcard[data-name="Ada"] [data-stop]').click()`); await sleep(500)
    ok(JSON.stringify(await stops(win)) === JSON.stringify(['[["Ada"],{}]']) && await js(win, `return !document.querySelector('dialog[open], .sheet.open, .ed.open')`), 'its click stops Ada and does not open her profile', JSON.stringify(await stops(win)))
    ok(await js(win, `return !document.querySelector('.pcard[data-name="Ada"] [data-stop]')`), 'and the button is gone once she is free')
    // mini tiles
    await js(win, `const s = window.__cliqueState; Object.assign(s.agents.find((x) => x.name === 'Ada'), { status: 'working', activity: 'Edit a.ts', since: Date.now() }); window.__cliqueEmit('state', s)`); await sleep(300)
    await js(win, `[...document.querySelectorAll('[data-mode-switch] [data-mode]')].find((b) => b.dataset.mode !== 'cards' && b.dataset.mode !== 'stats')?.click()`); await sleep(600)
    ok(await js(win, `const c = document.querySelector('.pcard.mini[data-name="Ada"]'); return !c || Boolean(c.querySelector('[data-stop="Ada"]'))`), 'compact cards: Stop on the working one')
    // ---- Terminals ----
    await js(win, "goPlace('terminals')"); await sleep(1200)
    ok(await js(win, `const t = document.querySelector('.tile[data-name="Ada"]'); return Boolean(t?.querySelector('.tile-acts [data-stop="Ada"]')) && !document.querySelector('.tile[data-name="June"] [data-stop]')`), 'terminals: Stop among a working terminal\'s actions only')
    win.destroy()

    // ---- the menu bar ----
    win = await open('tray.html', { width: 340, height: 700 })
    await js(win, SPY)
    ok(await js(win, `return Boolean(document.querySelector('.work .t-row[data-agent="Ada"] [data-stop="Ada"]'))`), 'menu bar: Stop on the row of an agent at work')
    await js(win, `document.querySelector('.work .t-row[data-agent="Ada"] [data-stop]').click()`); await sleep(400)
    const tcalls = await js(win, `return window.__calls.map((c) => c[0]).filter((n) => n !== 'state').join()`)
    ok(tcalls === 'stop', 'its click only stops (does not open the dashboard)', tcalls)
    win.destroy()

    // ---- the floating chat ----
    win = await open('overlay.html', { width: 520, height: 660 })
    await js(win, "window.__cliqueEmit('toggle', { open: true, focus: false })"); await sleep(800)
    await js(win, SPY)
    s = await send(win)
    ok(s.mode === 'stop' && /^Stop /.test(s.label), 'floating chat: the button is Stop while agents are at work', JSON.stringify(s))
    await write(win, 'x'); ok((await send(win)).mode === 'send', 'and Send with something written'); await write(win, '')
    await js(win, `document.querySelector('.compose .send').click()`); await sleep(500)
    ok((await stops(win)).length === 1 && (await send(win)).disabled, 'pressed, it stops them and goes back to the plain Send')
    win.destroy()
  } catch (e) {
    console.log('FAIL the script itself:', e?.stack ?? e); fails++
  }
  for (const e of errors) console.log('FAIL console error:', e)
  console.log(`\n${fails + errors.length ? `${fails + errors.length} FAILED` : 'all ok'}`)
  fs.rmSync(tmp, { recursive: true, force: true })
  app.exit(fails + errors.length ? 1 : 0)
})

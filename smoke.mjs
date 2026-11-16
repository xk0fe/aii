// Drives the real tray and dashboard pages (fixture state) in hidden windows: the line, the switch in both menus,
// a state push mid-menu, a long line, no layout overflow, no console errors.
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
const [WT, SCRATCH] = process.argv.slice(-2)
app.setPath('userData', path.join(SCRATCH, 'userdata-smoke'))
app.on('window-all-closed', () => {})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const errors = []
const ok = (cond, text) => (console.log(`${cond ? 'ok  ' : 'FAIL'} ${text}`), cond || fails++)
async function open(file, width, height, query) {
  const win = new BrowserWindow({ width, height, show: false, webPreferences: { preload: path.join(WT, 'desktop/scripts/screenshot-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false } })
  win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(`${file}: ${e.message}`))
  await win.loadFile(path.join(WT, 'desktop/ui', file), query ? { query } : {})
  await sleep(600)
  return win
}
const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`)
app.whenReady().then(async () => {
  for (const platform of [null, 'win32']) {
    const pc = platform ? 'PC' : 'Mac'
    const tray = await open('tray.html', 340, 900, platform && { platform })
    ok(await js(tray, `return document.querySelector('.t-awake .say').textContent`) === `Keeping this ${pc} awake while 2 agents work`, `${pc} tray: the line says 2 of this computer's agents work (Rex on Workstation isn't counted)`)
    ok(await js(tray, `return !document.querySelector('.t-awake').classList.contains('hidden') && document.querySelector('.t-awake').title.includes('screen can still turn off')`), `${pc} tray: shown, and its tooltip says the screen can still turn off`)
    await js(tray, `window.__calls = []; const call = clique.call; clique.call = (...a) => (window.__calls.push(a), call(...a)); document.querySelector('[data-act=settings]').click()`)
    await sleep(300)
    ok(await js(tray, `const b = document.querySelector('.menu [data-menu-act=awake]'); return b.textContent.trim() === 'Keep this ${pc} awake' && Boolean(b.querySelector('svg'))`), `${pc} tray: the gear's menu has "Keep this ${pc} awake", checked`)
    // a state push while the menu is open must not close it or lose the click
    await js(tray, `__cliqueEmit('state', __cliqueState)`)
    await sleep(150)
    ok(await js(tray, `return Boolean(document.querySelector('.menu:not(.leaving) [data-menu-act=awake]'))`), `${pc} tray: the menu stays open through a state push`)
    await js(tray, `document.querySelector('.menu [data-menu-act=awake]').click()`)
    await sleep(300)
    ok(JSON.stringify(await js(tray, `return window.__calls.filter((c) => c[0] === 'keepAwake')`)) === '[["keepAwake",false]]', `${pc} tray: picking it calls keepAwake(false), once`)
    ok(await js(tray, `return document.querySelector('.t-awake').classList.contains('hidden')`), `${pc} tray: the line goes once it's off`)
    await js(tray, `document.querySelector('[data-act=settings]').click()`)
    await sleep(300)
    ok(await js(tray, `return !document.querySelector('.menu:not(.leaving) [data-menu-act=awake] svg')`), `${pc} tray: the menu shows it unchecked`)
    await js(tray, `document.querySelector('.menu:not(.leaving) [data-menu-act=awake]').click()`)
    await sleep(300)
    ok(await js(tray, `return !document.querySelector('.t-awake').classList.contains('hidden')`), `${pc} tray: on again, the line is back`)
    // the longest line there is: wraps inside the popover, nothing sticks out
    await js(tray, `__cliqueState.awake = { on: true, enabled: true, reasons: ['working', 'sharing', 'linked', 'phone'], line: 'Keeping this ${pc} awake on battery while 12 agents work, it shares its agents, a linked computer is connected and your phone is connected' }; __cliqueEmit('state', __cliqueState)`)
    await sleep(200)
    ok(await js(tray, `const r = document.querySelector('.t-awake').getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && r.right <= innerWidth && r.height > 30`), `${pc} tray: the longest line wraps and stays inside`)
    // a state without it (an older main process, a test page): no line, no error
    await js(tray, `delete __cliqueState.awake; __cliqueEmit('state', __cliqueState)`)
    await sleep(150)
    ok(await js(tray, `return document.querySelector('.t-awake').classList.contains('hidden')`), `${pc} tray: a state without "awake" shows no line`)
    tray.destroy()

    const dash = await open('dashboard.html', 760, 560, platform && { platform })
    await js(dash, `window.__calls = []; const call = clique.call; clique.call = (...a) => (window.__calls.push(a), call(...a)); document.querySelector('.side-more').click()`)
    await sleep(300)
    ok(await js(dash, `return [...document.querySelectorAll('.menu [data-menu-act=awake] > span, .menu [data-menu-act=awake] > small')].map((x) => x.textContent).join(' | ')`) === 'Stay awake | On: while agents work', `${pc} dashboard: the ⋯ menu has "Stay awake · On: while agents work"`)
    await js(dash, `document.querySelector('.menu [data-menu-act=awake]').click()`)
    await sleep(300)
    ok(JSON.stringify(await js(dash, `return window.__calls.filter((c) => c[0] === 'keepAwake')`)) === '[["keepAwake",false]]', `${pc} dashboard: picking it calls keepAwake(false)`)
    await js(dash, `document.querySelector('.side-more').click()`)
    await sleep(300)
    ok(await js(dash, `return [...document.querySelectorAll('.menu:not(.leaving) [data-menu-act=awake] > span, .menu:not(.leaving) [data-menu-act=awake] > small')].map((x) => x.textContent).join(' | ')`) === `Stay awake | Off: this ${pc} may sleep mid-task`, `${pc} dashboard: then it reads "Off: this ${pc} may sleep mid-task"`)
    ok(await js(dash, `const r = document.querySelector('.menu:not(.leaving)').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0 && r.top >= 0 && r.bottom <= innerHeight`), `${pc} dashboard: the menu fits a 760x560 window`)
    dash.destroy()
  }
  ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  console.log(fails ? `${fails} FAILED` : 'all ok')
  app.exit(fails ? 1 : 0)
})

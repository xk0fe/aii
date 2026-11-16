// Tries to get out of the sandbox an attached page runs in (core/sandbox.js), and says how each try ended. Run:
//   npm run probe:sandbox
// A hidden window is made the way main.js makes the chat's (the real preload.cjs, so window.clique is there to be
// reached for; the same lockFrames), on a page with the dashboard's own Content-Security-Policy, holding the frame the
// chat makes for an attached page. The page inside is the attacker: it tries the network every way a page can, the
// app's page and its bridge, Node, storage, new windows, forms, and taking the frame or the window somewhere else.
// A local server counts whatever reaches it: it must hear nothing. Ends with 0 when every try failed, 1 otherwise.
// Nothing of yours is touched: its files are in a temporary folder.
import { app, BrowserWindow, protocol } from 'electron'
import fs from 'node:fs'
import dgram from 'node:dgram'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { answer, serveSandbox, lockFrames, sandboxURL } from '../core/sandbox.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-probe-'))
app.setPath('userData', path.join(tmp, 'userdata'))
const store = path.join(tmp, 'attachments')
fs.mkdirSync(store)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
const say = (ok, what, how = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${how ? `: ${how}` : ''}`)
}

// Whatever gets out lands here.
const heard = []
const all = [] // from start to end
const server = http.createServer((req, res) => {
  heard.push(`${req.method} ${req.url}`)
  all.push(`${req.method} ${req.url}`)
  res.setHeader('access-control-allow-origin', '*')
  res.end('<!doctype html><title>escaped</title>escaped')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const OUT = `http://127.0.0.1:${server.address().port}`
// ...and here, what WebRTC sends a "STUN server" (a policy doesn't cover those packets: lockFrames does)
const udp = dgram.createSocket('udp4')
udp.on('message', () => (heard.push('a WebRTC packet'), all.push('a WebRTC packet')))
await new Promise((r) => udp.bind(0, '127.0.0.1', r))

// What the attacker's page tries without leaving. Each try ends as { name: 'blocked: why' | 'ESCAPED: how' }.
const TRIES = `
const out = {}; window.__probe = out; document.body.dataset.ran = 'yes'
const blocked = (name, why) => (out[name] = 'blocked: ' + String(why).slice(0, 110))
const escaped = (name, how) => (out[name] = 'ESCAPED: ' + String(how).slice(0, 110))
const attempt = async (name, fn) => { try { const r = await fn(); r === undefined || (String(r).startsWith('no:') ? blocked(name, String(r).slice(3)) : escaped(name, r)) } catch (e) { blocked(name, e.name + ' ' + e.message) } }
const loads = (el, attr, url) => new Promise((done) => { el.onload = () => done('it loaded'); el.onerror = () => done('no:refused'); el[attr] = url; document.body.append(el); setTimeout(() => done('no:never loaded'), 1500) })
window.__done = (async () => {
  await attempt('fetch a URL', async () => 'got ' + (await fetch('${OUT}/fetch')).status)
  await attempt('fetch, no-cors', async () => 'got ' + (await fetch('${OUT}/fetch-nocors', { mode: 'no-cors' })).type)
  await attempt('XMLHttpRequest', () => new Promise((done) => { const x = new XMLHttpRequest(); x.onload = () => done('got ' + x.status); x.onerror = () => done('no:refused'); x.open('GET', '${OUT}/xhr'); x.send() }))
  await attempt('an image from the network', () => loads(new Image(), 'src', '${OUT}/img.png'))
  await attempt('a script from the network', () => loads(document.createElement('script'), 'src', '${OUT}/s.js'))
  await attempt('a stylesheet from the network', () => loads(Object.assign(document.createElement('link'), { rel: 'stylesheet' }), 'href', '${OUT}/s.css'))
  await attempt('a frame to the network', () => new Promise((done) => { const f = document.createElement('iframe'); addEventListener('securitypolicyviolation', (e) => e.effectiveDirective === 'frame-src' && done('no:refused by frame-src'), { once: true }); f.src = '${OUT}/frame'; document.body.append(f); setTimeout(() => done('no:nothing loaded'), 1500) }))
  await attempt('a video from the network', () => loads(document.createElement('video'), 'src', '${OUT}/v.mp4'))
  await attempt('sendBeacon', () => (navigator.sendBeacon('${OUT}/beacon', 'x') ? undefined : 'no:refused'))
  await attempt('WebSocket', () => new Promise((done) => { const w = new WebSocket('${OUT.replace('http', 'ws')}/ws'); w.onopen = () => done('it opened'); w.onerror = () => done('no:refused') }))
  await attempt('EventSource', () => new Promise((done) => { const s = new EventSource('${OUT}/events'); s.onopen = () => done('it opened'); s.onerror = () => done('no:refused') }))
  await attempt('a worker that fetches', () => new Promise((done) => { const w = new Worker(URL.createObjectURL(new Blob(["fetch('${OUT}/worker').then(() => postMessage('got it'), () => postMessage('no:refused'))"]))); w.onmessage = (e) => done(e.data); w.onerror = () => done('no:the worker was refused') }))
  await attempt('a prefetch link', async () => { document.head.append(Object.assign(document.createElement('link'), { rel: 'prefetch', href: '${OUT}/prefetch' }), Object.assign(document.createElement('link'), { rel: 'preconnect', href: '${OUT}' })); await new Promise((r) => setTimeout(r, 400)); return 'no:asked for (the server says whether anything came)' })
  await attempt('WebRTC to the network', () => new Promise((done) => { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${udp.address().port}' }] }); const got = []; pc.onicecandidate = (e) => { if (e.candidate) got.push(e.candidate.type); else done(got.includes('srflx') || got.includes('relay') ? 'reached a server: ' + got : 'no:no server reached (' + (got.join(',') || 'no candidates') + ')') }; pc.createDataChannel('x'); pc.createOffer().then((o) => pc.setLocalDescription(o)); setTimeout(() => done('no:no server reached'), 2500) }))
  await attempt("the app's page (parent.document)", () => 'read ' + parent.document.title)
  await attempt("the app's page (top.document)", () => 'read ' + top.document.title)
  await attempt('window.clique here', () => (typeof window.clique === 'undefined' ? 'no:undefined' : 'it is here'))
  await attempt('top.clique', () => (top.clique ? 'reached' : 'no:undefined'))
  await attempt('parent.parent.clique', () => (parent.parent.clique ? 'reached' : 'no:undefined'))
  await attempt('require', () => (typeof require === 'undefined' ? 'no:undefined' : 'it is here'))
  await attempt('process', () => (typeof process === 'undefined' ? 'no:undefined' : 'it is here'))
  await attempt('module / Buffer / global', () => (typeof module === 'undefined' && typeof Buffer === 'undefined' && typeof global === 'undefined' ? 'no:undefined' : 'it is here'))
  await attempt('localStorage', () => (localStorage.setItem('a', 'b'), 'wrote'))
  await attempt('sessionStorage', () => (sessionStorage.setItem('a', 'b'), 'wrote'))
  await attempt('document.cookie', () => ((document.cookie = 'a=b'), document.cookie ? 'wrote ' + document.cookie : 'no:nothing kept'))
  await attempt('indexedDB', () => new Promise((done) => { const r = indexedDB.open('x'); r.onsuccess = () => done('opened'); r.onerror = () => done('no:refused') }))
  await attempt('a service worker', async () => (navigator.serviceWorker ? (await navigator.serviceWorker.register('${OUT}/sw.js'), 'registered') : 'no:not there'))
  await attempt('the clipboard', async () => 'read ' + (await navigator.clipboard.readText()).length + ' characters')
  await attempt('the camera and microphone', async () => (await navigator.mediaDevices.getUserMedia({ audio: true }), 'got a stream'))
  await attempt('where you are', () => new Promise((done) => navigator.geolocation.getCurrentPosition(() => done('got it'), (e) => done('no:' + e.message), { timeout: 1500 })))
  await attempt('window.open', () => { const w = window.open('${OUT}/open'); return w ? 'opened' : 'no:null' })
  await attempt('a file: picture', () => loads(new Image(), 'src', ${JSON.stringify(pathToFileURL(path.join(root, 'assets', 'icon.png')).href)}))
  await attempt('a message to the app that does something', () => { top.postMessage({ call: 'openFile', args: ['/etc/hosts'] }, '*'); parent.postMessage('clique:nothing', '*'); return 'no:sent (the app listens only for "leave" and "esc")' })
  return out
})()
`
const page = (body) => `<!doctype html><html><head><title>attacker</title></head><body><h1>attacker</h1><img id="ok" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="><script>${body}</script></body></html>`

// Tries that would take the frame or the window somewhere else: each in a page of its own.
const LEAVES = {
  'location = a URL': `location.href = '${OUT}/nav-self'`,
  'location.replace': `location.replace('${OUT}/nav-replace')`,
  'top.location = a URL': `try { top.location = '${OUT}/nav-top' } catch (e) { window.__err = e.message }`,
  'parent.location = a URL': `try { parent.location = '${OUT}/nav-parent' } catch (e) { window.__err = e.message }`,
  'a form posted': `const f = document.createElement('form'); f.method = 'post'; f.action = '${OUT}/form'; document.body.append(f); f.submit()`,
  'a form posted to the top': `const f = document.createElement('form'); f.method = 'post'; f.target = '_top'; f.action = '${OUT}/form-top'; document.body.append(f); try { f.submit() } catch (e) { window.__err = e.message }`,
  'a link clicked (same frame)': `const a = document.createElement('a'); a.href = '${OUT}/link'; document.body.append(a); a.click()`,
  'a link clicked (_top)': `const a = document.createElement('a'); a.href = '${OUT}/link-top'; a.target = '_top'; document.body.append(a); a.click()`,
  'a link clicked (_blank)': `const a = document.createElement('a'); a.href = '${OUT}/link-blank'; a.target = '_blank'; document.body.append(a); a.click()`,
  'a meta refresh': `document.head.insertAdjacentHTML('beforeend', '<meta http-equiv="refresh" content="0;url=${OUT}/refresh">')`,
  'location = a javascript: URL of the top': `try { top.location = 'javascript:document.title="owned"' } catch (e) { window.__err = e.message }`,
  'history and a blob: page': `location.href = URL.createObjectURL(new Blob(['<script>fetch("${OUT}/blob-page")</scr' + 'ipt>'], { type: 'text/html' }))`,
}

app.on('window-all-closed', () => {}) // it ends when it's done
process.removeAllListeners('warning') // (a frame refused by the policy is what's wanted here)
app.whenReady().then(async () => {
  serveSandbox(protocol, [store])
  // The chat's own policy, read from the page that has it, with what this change adds to it.
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(fs.readFileSync(path.join(root, 'ui', 'dashboard.html'), 'utf8'))[1]
  say(/frame-src clique-sandbox:/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp) && !/unsafe-eval/.test(csp), "the app's own policy lets a frame hold only clique-sandbox:, and still no inline script", csp)

  const host = path.join(tmp, 'host.html')
  const open = async (file, run) => {
    fs.writeFileSync(host, `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>the app</title><body><iframe id="f" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${sandboxURL(file, run).replaceAll('&', '&amp;')}" style="width:600px;height:400px"></iframe><script src="host.js"></script>`)
    fs.writeFileSync(path.join(tmp, 'host.js'), `window.__heard = []; addEventListener('message', (e) => window.__heard.push(e.source === document.getElementById('f').contentWindow ? e.data : 'someone else: ' + JSON.stringify(e.data)))`)
    // as main.js page() makes them: the real preload, nothing else said
    const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { preload: path.join(root, 'preload.cjs'), additionalArguments: [`--clique-home=${tmp}`] } })
    const refused = []
    win.webContents.on('will-navigate', (e) => (refused.push('window'), e.preventDefault()))
    win.webContents.on('will-frame-navigate', (e) => e.isMainFrame || e.url.startsWith('clique-sandbox:') || e.url.startsWith('about:') || refused.push(`frame → ${e.url.slice(0, 60)}`))
    win.webContents.on('did-create-window', () => refused.push('A WINDOW OPENED'))
    lockFrames(win.webContents)
    await win.loadFile(host)
    await sleep(400)
    const frames = win.webContents.mainFrame.framesInSubtree
    return { win, refused, shell: frames[1], inner: frames[2], frames }
  }
  const put = (name, html) => (fs.writeFileSync(path.join(store, name), html), path.join(store, name))

  // 1. the frames are what they should be
  {
    const { win, frames, shell, inner } = await open(put('attack.html', page(TRIES)), true)
    say(shell.url.startsWith('clique-sandbox://page/?') && inner.url === 'about:srcdoc' && inner.parent === shell && shell.parent === win.webContents.mainFrame, 'three frames: the app, the shell inside it, the page inside that', frames.map((f) => f.url.slice(0, 22)).join(' > '))
    say(await win.webContents.executeJavaScript('typeof window.clique.call') === 'function', 'the app itself has its bridge (so there is something to reach for)')
    say(shell?.origin === 'null' && inner?.origin === 'null', "the shell and the page have nobody's origin", `${shell?.origin}, ${inner?.origin}`)
    say((await inner.executeJavaScript('document.body.dataset.ran')) === 'yes', "the page's own script ran (the sandbox is live, not just dead)")
    say((await inner.executeJavaScript('document.getElementById("ok").naturalWidth')) === 1, 'a data: picture written in the file shows')
    const out = await inner.executeJavaScript('window.__done')
    for (const [name, how] of Object.entries(out)) say(how.startsWith('blocked'), name, how)
    await sleep(300)
    say((await win.webContents.executeJavaScript('document.title')) === 'the app', "the app's page is untouched")
    const told = await win.webContents.executeJavaScript('JSON.stringify(window.__heard)')
    say(!/"clique:/.test(told), "the shell passed on nothing the page made up (the app acts on the shell's \"clique:leave\" and \"clique:esc\" only)", told)
    win.destroy()
  }

  // 2. with Run off, nothing in the page runs
  {
    const { win, inner, shell } = await open(put('still.html', page(`document.body.dataset.ran = 'yes'; document.title = 'ran'`)), false)
    const ran = await Promise.race([inner.executeJavaScript('document.body.dataset.ran || document.title').catch((e) => `no script world: ${e.message}`), sleep(1500).then(() => 'no script world')])
    say(ran !== 'yes' && ran !== 'ran', 'before Run, no script of the page runs', String(ran))
    say(shell.origin === 'null', "and its frame has nobody's origin all the same")
    win.destroy()
  }

  // 3. leaving
  for (const [name, code] of Object.entries(LEAVES)) {
    heard.length = 0
    const { win, refused } = await open(put('leave.html', page(`setTimeout(() => { ${code} }, 50)`)), true)
    await sleep(900)
    const url = win.webContents.getURL()
    const titles = await Promise.all(win.webContents.mainFrame.framesInSubtree.map((f) => Promise.race([f.executeJavaScript('document.title').catch(() => ''), sleep(500)])))
    const told = JSON.parse(await win.webContents.executeJavaScript('JSON.stringify(window.__heard)').catch(() => '["the app\'s page is gone"]'))
    const stayed = url === pathToFileURL(host).href && !titles.includes('escaped') && !titles.includes('owned') && BrowserWindow.getAllWindows().length === 1 && !refused.includes('A WINDOW OPENED')
    say(stayed && !heard.length, name, `the server heard ${heard.length ? heard.join(', ') : 'nothing'}; ${told.includes('clique:leave') ? 'the app was told and closes the preview' : 'nothing moved'}${refused.length ? `; main refused: ${refused.join(', ')}` : ''}`)
    win.destroy()
  }

  // 4. the scheme serves pages from CLIque's attachments only
  {
    const outside = path.join(tmp, 'outside.html')
    fs.writeFileSync(outside, page(`document.body.dataset.ran = 'yes'`))
    fs.symlinkSync(outside, path.join(store, 'link.html'))
    for (const [what, file] of [['a file outside the attachments', outside], ['a link in the attachments that leads outside', path.join(store, 'link.html')], ['.. out of the attachments', path.join(store, '..', 'outside.html')], ['a file that is not a page', put('notes.txt', '<script>document.body.dataset.ran = "yes"</script>')]]) {
      const { win, inner } = await open(file, true)
      const ran = await Promise.race([inner.executeJavaScript('document.body.dataset.ran').catch(() => 'no'), sleep(700).then(() => 'no')])
      say(ran !== 'yes' && answer(sandboxURL(file, true), [store]).status === 404, `the scheme refuses ${what}`, `it answers ${answer(sandboxURL(file, true), [store]).status} and a page that says it's gone`)
      win.destroy()
    }
  }

  say(!all.length, 'the server heard nothing at all, start to end', all.join(', '))
  console.log(failed ? `\n${failed} FAILED` : '\nEvery way out was shut.')
  server.close()
  udp.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  app.exit(failed ? 1 : 0)
})

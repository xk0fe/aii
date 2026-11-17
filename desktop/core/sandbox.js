// The sandbox a page an agent attached runs in (core/attachments.js, kind 'html'). The page is never put into the app's
// own pages: the chat shows an <iframe sandbox="allow-scripts"> whose address is clique-sandbox://page/?f=<file>, and
// this answers it with a small document of CLIque's own (the "shell") that holds the agent's page in a second sandboxed
// frame, written into its `srcdoc`. So the page:
//
//   - has an origin of its own that is nobody's (neither frame is allowed the same origin): it can't reach the chat's page, its
//     window.clique bridge, cookies or storage, and Electron gives a frame no preload and no Node;
//   - has no network at all: the shell's policy is default-src 'none', and a srcdoc frame inherits its parent's policy
//     (the same policy is also the first thing in the page itself). Only what's written in the file runs and shows:
//     inline scripts and styles, data: and blob: pictures, sound and fonts. A self-contained single file is what works;
//   - can't open windows, post forms, or take the frame anywhere else: frame-src 'none' stops the frame loading another
//     document, the shell tells the chat ("clique:leave") if it sees one try, the chat then closes the preview, and
//     main.js refuses every frame's navigation and every new window besides.
//
// The app's own pages can't hold this as a srcdoc themselves: a srcdoc frame inherits their policy, which allows no
// inline script, and loosening that for the app is exactly what mustn't happen. A document from this scheme starts
// with no policy but the one sent with it.
//
// With `run` off (what shows before you press Run, and what a thumbnail is) nothing in the page runs: the inner frame's
// sandbox allows nothing and the policy allows no script.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { PAGE_MAX, kindOf } from './attachments.js'

export const SCHEME = 'clique-sandbox'

const SHOWS = "style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:"
const SHUT = "frame-src 'none'; base-uri 'none'; form-action 'none'"
// The page's policy: with scripts, only the ones written in the file.
export const pagePolicy = (run) => `default-src 'none'; script-src ${run ? "'unsafe-inline'" : "'none'"}; ${SHOWS}; ${SHUT}`
// The shell's: its one script goes by a nonce, so nothing written in the page can pass for it when scripts are off.
const shellPolicy = (run, nonce) => `default-src 'none'; script-src ${run ? "'unsafe-inline'" : `'nonce-${nonce}'`}; ${SHOWS}; ${SHUT}`

const attr = (s) => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;')

// Esc, pressed while the page has the keyboard, still closes the viewer: the page's frame says so to the shell.
const ESC = "<script>addEventListener('keydown',function(e){if(e.key==='Escape')parent.postMessage('clique:esc','*')},true)</script>"

// The agent's page as the inner frame holds it: the policy first, before anything of the page's can say otherwise.
export const pageDocument = (html, run) => `<meta http-equiv="Content-Security-Policy" content="${pagePolicy(run)}"><meta name="referrer" content="no-referrer">${run ? ESC : ''}${html}`

// The shell. { html, policy }: the document, and the policy that goes with it as a header too.
export function shell(html, { run = false, nonce = randomBytes(16).toString('base64') } = {}) {
  const policy = shellPolicy(run, nonce)
  // A second load of the inner frame, or a refused one, is the page trying to go somewhere: the chat hears and closes it.
  const watch = `var f=document.querySelector('iframe'),n=0;f.addEventListener('load',function(){if(++n>1)parent.postMessage('clique:leave','*')});addEventListener('securitypolicyviolation',function(e){if(e.effectiveDirective==='frame-src')parent.postMessage('clique:leave','*')});addEventListener('message',function(e){if(e.source===f.contentWindow&&e.data==='clique:esc')parent.postMessage('clique:esc','*')})`
  return {
    policy,
    html: `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${attr(policy)}"><meta name="referrer" content="no-referrer"><title>Attached page</title><style>html,body{margin:0;width:100%;height:100%;background:#fff}iframe{display:block;width:100%;height:100%;border:0}</style><iframe title="Attached page" sandbox="${run ? 'allow-scripts' : ''}" referrerpolicy="no-referrer" srcdoc="${attr(pageDocument(html, run))}"></iframe><script nonce="${nonce}">${watch}</script>`,
  }
}

// What the chat's frame points at.
export const sandboxURL = (file, run) => `${SCHEME}://page/?f=${encodeURIComponent(file)}${run ? '&run=1' : ''}`

const real = (p) => {
  try {
    return fs.realpathSync(path.resolve(String(p)))
  } catch {
    return null
  }
}

// The file a request names ('' when it names none).
export const pageFile = (url) => {
  try {
    return new URL(url).searchParams.get('f') ?? ''
  } catch {
    return ''
  }
}

// A request's answer: { status, html, policy }. Only a page in one of `dirs` (CLIque's attachments, its cache of linked
// computers' files), wherever links and `..` really lead. `missing`: what to say of one that isn't there, when more is
// known than that (it's on a linked computer that's away).
export function answer(url, dirs, missing = 'This page is no longer kept.') {
  const text = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  const plain = (status, words) => ({ status, ...shell(`<body style="margin:0;display:grid;place-items:center;height:100vh;padding:0 16px;box-sizing:border-box;text-align:center;font:13px system-ui,sans-serif;color:#6b6b6b">${text(words)}</body>`) })
  let u
  try {
    u = new URL(url)
  } catch {
    return plain(400, 'Not a page.')
  }
  const file = real(u.searchParams.get('f') ?? '')
  if (!file || kindOf(file) !== 'html' || !dirs.some((d) => real(d) && file.startsWith(real(d) + path.sep))) return plain(404, missing)
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return plain(404, missing)
  }
  if (!stat.isFile() || stat.size > PAGE_MAX) return plain(413, 'This page is too big to show here.')
  return { status: 200, ...shell(fs.readFileSync(file, 'utf8'), { run: u.searchParams.get('run') === '1' }) }
}

// Electron's side (main.js, and the screenshots and probes, which show the same thing): the scheme answers with the
// shell and its policy, and nothing else. `bring(file)`: a page on a linked computer is brought here first (it's
// answered when it has come, or with why it couldn't: core/linkfiles.js).
export function serveSandbox(protocol, dirs, bring) {
  protocol.handle(SCHEME, async (request) => {
    let missing
    try {
      await bring?.(pageFile(request.url))
    } catch (e) {
      missing = e?.message
    }
    const { status, html, policy } = answer(request.url, dirs, missing)
    return new Response(html, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' },
    })
  })
}

// A window that shows the chat: its frames go nowhere but the sandbox, and nothing opens a window from it.
export function lockFrames(webContents) {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // (a policy doesn't stop WebRTC's own packets: with this, a page's RTCPeerConnection reaches no server)
  webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  webContents.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return // (the page itself: will-navigate, in main.js)
    if (!e.url.startsWith(`${SCHEME}://page/?`) && e.url !== 'about:srcdoc' && e.url !== 'about:blank') e.preventDefault()
  })
}

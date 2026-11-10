// Draws the website's creatures with the app's own avatar code and saves each one as a static SVG in site/creatures/,
// so the site needs no JavaScript for them. Also measures Fredoka Bold's letter widths for the wordmark (build.mjs).
//
//   desktop/node_modules/.bin/electron site/tools/creatures.mjs [--avatar file.js] [--css file.css ...]
//
// --avatar is the creature code (default desktop/ui/avatar.js) and --css the styles that lay its layers out (default
// desktop/ui/common.css). The site's creatures act out their status, so the avatar code has to know poses (poseOf).
//
// How: the app draws a creature as a few <svg> layers in <span>s, moved with CSS transforms, clipped and filtered.
// Here they're drawn in a hidden window, and every layer's transform, clip and filter is read back from the computed
// styles and written as the same thing in one SVG (a 100 x 100 box, like the app's).
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const site = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.join(site, '..')
const args = process.argv.slice(2)
const opt = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []))
const avatarFile = opt('--avatar')[0] ?? path.join(repo, 'desktop/ui/avatar.js')
const cssFiles = opt('--css').length ? opt('--css') : [path.join(repo, 'desktop/ui/common.css')]

// The demo clique (design/DEMO-CLIQUE.md) as the site shows them, each acting out its status.
const CLIQUE = [
  { name: 'Ada', status: 'working', avatar: { body: 'blob', color: 'mint', eyes: 'dot', mouth: 'none', hat: 'glasses', cheeks: false } },
  { name: 'Milo', status: 'needs', ask: 'ok', avatar: { body: 'cat', color: 'sky', eyes: 'happy', mouth: 'cat', hat: 'party', cheeks: true } },
  { name: 'Iris', status: 'needs', ask: 'question', avatar: { body: 'heart', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'flower', cheeks: true } },
  { name: 'Theo', status: 'working', avatar: { body: 'frog', color: 'lime', eyes: 'googly', mouth: 'grin', hat: 'none', cheeks: false } },
  { name: 'June', status: 'idle', avatar: { body: 'bunny', color: 'peach', eyes: 'happy', mouth: 'smile', hat: 'bow', cheeks: true } },
  { name: 'Rex', status: 'starting', avatar: { body: 'mochi', color: 'yellow', eyes: 'dot', mouth: 'smile', hat: 'headphones', cheeks: true } },
  { name: 'Noor', status: 'off', avatar: { body: 'drop', color: 'purple', eyes: 'googly', mouth: 'cat', hat: 'beret', cheeks: false } },
]
const MOOD = { working: 'working', needs: 'waiting', idle: 'idle', starting: 'starting', off: 'sleep' }
const POSE = { working: 'laptop', idle: 'mug', starting: 'pop', off: 'sleep' }
const poseOf = (a) => (a.status === 'needs' ? (a.ask === 'question' ? 'question' : 'sign') : POSE[a.status])
const JOBS = CLIQUE.map((a) => ({ file: a.name.toLowerCase(), agent: { name: a.name, avatar: a.avatar, status: a.status }, mood: MOOD[a.status], pose: poseOf(a) }))

// Runs in the page: one creature, flattened to SVG markup in the 100 x 100 box. Returns { body, defs, box }.
function flatten(root, id) {
  const S = root.getBoundingClientRect().width
  const k = 100 / S
  const defs = []
  const num = (v) => +(+v).toFixed(3)
  const keepClass = (el) => {
    for (const e of [el, ...el.querySelectorAll('*')]) {
      const keep = [...e.classList].filter((c) => c === 'av-acc' || c === 'av-acc-line')
      if (keep.length) e.setAttribute('class', keep.join(' '))
      else e.removeAttribute('class')
      e.removeAttribute('aria-hidden')
    }
  }
  const walk = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return ''
    if (el instanceof SVGSVGElement) {
      const r = el.getBoundingClientRect()
      if (el.getAttribute('viewBox') !== '0 0 100 100') throw new Error(`${id}: a layer without the 100 x 100 box`)
      if (Math.abs(r.width - S) > 0.5 && !el.closest('[style*="transform"]')) throw new Error(`${id}: a layer that isn't the creature's size`)
      const copy = el.cloneNode(true)
      keepClass(copy)
      return copy.innerHTML
    }
    if (el.offsetLeft || el.offsetTop) throw new Error(`${id}: a layer moved by position, not transform`)
    let inner = [...el.children].map(walk).join('')
    if (!inner || el === root) return inner
    if (cs.filter !== 'none') {
      const fid = `${id}-f${defs.length}`
      const parts = [...cs.filter.matchAll(/(\w+)\(([\d.]+)\)/g)].map(([, fn, v]) => {
        if (fn === 'saturate') return `<feColorMatrix type="saturate" values="${num(v)}"/>`
        if (fn === 'brightness') return `<feComponentTransfer>${['R', 'G', 'B'].map((c) => `<feFunc${c} type="linear" slope="${num(v)}"/>`).join('')}</feComponentTransfer>`
        throw new Error(`${id}: no SVG for the CSS filter ${fn}()`)
      })
      defs.push(`<filter id="${fid}" color-interpolation-filters="sRGB">${parts.join('')}</filter>`)
      inner = `<g filter="url(#${fid})">${inner}</g>`
    }
    if (cs.clipPath !== 'none') {
      const m = cs.clipPath.match(/^inset\(([^)]*)\)$/)
      if (!m) throw new Error(`${id}: no SVG for the clip ${cs.clipPath}`)
      const v = m[1].split(/\s+/).map((s) => (s.endsWith('%') ? parseFloat(s) : parseFloat(s) * k))
      const [t, r, b, l] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]]
      const cid = `${id}-c${defs.length}`
      defs.push(`<clipPath id="${cid}" clipPathUnits="userSpaceOnUse"><rect x="${num(l)}" y="${num(t)}" width="${num(100 - l - r)}" height="${num(100 - t - b)}"/></clipPath>`)
      inner = `<g clip-path="url(#${cid})">${inner}</g>`
    }
    if (cs.opacity !== '1') inner = `<g opacity="${num(cs.opacity)}">${inner}</g>`
    if (cs.transform !== 'none') {
      const m = new DOMMatrix(cs.transform)
      const [ox, oy] = cs.transformOrigin.split(' ').map((s) => parseFloat(s) * k)
      const M = new DOMMatrix().translate(ox, oy).multiply(new DOMMatrix([m.a, m.b, m.c, m.d, m.e * k, m.f * k])).translate(-ox, -oy)
      inner = `<g transform="matrix(${[M.a, M.b, M.c, M.d, M.e, M.f].map(num).join(' ')})">${inner}</g>`
    }
    return inner
  }
  const body = walk(root)
  // the creature's extent, to give a standalone file a box that fits it (the fuzz reaches a little further)
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  probe.setAttribute('viewBox', '0 0 100 100')
  probe.setAttribute('style', 'position:absolute;left:0;top:0;width:100px;height:100px;overflow:visible')
  probe.innerHTML = `<defs>${defs.join('')}</defs><g>${body}</g>`
  document.body.append(probe)
  const bb = probe.querySelector(':scope > g').getBBox()
  probe.remove()
  const pad = 4
  const box = [Math.floor(bb.x - pad), Math.floor(bb.y - pad), Math.ceil(bb.width + 2 * pad), Math.ceil(bb.height + 2 * pad)]
  return { body, defs: defs.join(''), box }
}

app.whenReady().then(async () => {
  const code = fs.readFileSync(avatarFile, 'utf8')
  if (!/function poseOf\b/.test(code)) {
    console.error(`${path.relative(repo, avatarFile)} has no poses (poseOf): the site's creatures act out their status. Point --avatar at avatar code that has them.`)
    app.exit(1)
    return
  }
  const win = new BrowserWindow({ show: false, width: 800, height: 800, webPreferences: { sandbox: false, contextIsolation: true } })
  await win.loadURL('about:blank')
  for (const f of cssFiles) await win.webContents.insertCSS(fs.readFileSync(f, 'utf8'))
  // still pictures: every layer at rest (the starting pop-in would otherwise be at scale 0)
  await win.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }')
  const font = fs.readFileSync(path.join(site, 'assets/fonts/fredoka.woff2')).toString('base64')
  await win.webContents.executeJavaScript(`(async () => {
    const face = new FontFace('Fredoka', Uint8Array.from(atob('${font}'), (c) => c.charCodeAt(0)), { weight: '300 700' })
    document.fonts.add(await face.load())
  })()`)
  await win.webContents.executeJavaScript(code)
  await win.webContents.executeJavaScript(`window.__flatten = ${flatten.toString()}; true`)

  const out = path.join(site, 'creatures')
  fs.mkdirSync(out, { recursive: true })
  const shared = await win.webContents.executeJavaScript(`ensureDefs(); document.querySelector('#av-defs defs').innerHTML`)
  fs.writeFileSync(path.join(out, '_defs.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">\n<!-- what every creature refers to (the felt, its light and shade): build.mjs puts it in the page once -->\n<defs>${shared}</defs>\n</svg>\n`)
  for (const job of JOBS) {
    const r = await win.webContents.executeJavaScript(`(() => {
      const host = document.createElement('div')
      host.style.cssText = 'position:absolute;left:100px;top:100px'
      host.innerHTML = avatarHTML(${JSON.stringify(job.agent)}, { size: 184, mood: ${JSON.stringify(job.mood)}, pose: ${JSON.stringify(job.pose)} })
      document.body.append(host)
      const r = __flatten(host.querySelector('.av'), ${JSON.stringify(job.file)})
      host.remove()
      return r
    })()`)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r.box.join(' ')}" width="${r.box[2] * 2}" height="${r.box[3] * 2}">
<!-- ${job.agent.name.replace(/\..*/, '')}, ${job.pose}: drawn by the app's avatar code (site/tools/creatures.mjs) -->
<defs>${shared}<!-- own -->${r.defs}<!-- /own --></defs>
<!-- body -->${r.body}<!-- /body -->
</svg>
`
    fs.writeFileSync(path.join(out, `${job.file}.svg`), svg)
    console.log(`saved site/creatures/${job.file}.svg (${(svg.length / 1024).toFixed(1)} KB)`)
  }

  // Fredoka Bold's advance widths, per 1px of font size, for the wordmark (letters placed one by one, as the app does)
  const widths = await win.webContents.executeJavaScript(`(() => {
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.font = '700 1000px Fredoka'
    const out = {}
    for (let c = 32; c < 127; c++) out[String.fromCharCode(c)] = +(ctx.measureText(String.fromCharCode(c)).width / 1000).toFixed(4)
    return out
  })()`)
  fs.writeFileSync(path.join(site, 'tools/fredoka-700.json'), JSON.stringify(widths) + '\n')
  console.log('saved site/tools/fredoka-700.json')
  app.quit()
})

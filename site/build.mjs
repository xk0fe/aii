// Builds the website into site/_site: plain HTML and CSS, no JavaScript, nothing loaded from other sites.
//
//   node site/build.mjs [--release latest.json] [--out dir]
//
// config.mjs has the name, the contact address and the download links. --release is the public repo's newest
// published release as GitHub's API returns it (gh api repos/OWNER/REPO/releases/latest); its files become the Mac and
// Windows download links. Given an empty or missing file, those buttons say "Coming soon". Without --release (a local
// preview) they point at the repo's releases page.
// The creatures are the SVGs in site/creatures (tools/creatures.mjs draws them with the app's avatar code).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRODUCT, COMPANY, CONTACT_EMAIL, SITE_URL, DOMAIN, DOWNLOADS } from './config.mjs'

const site = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const out = path.resolve(arg('--out') ?? path.join(site, '_site'))
const releaseFile = arg('--release')
const repo = process.env.RELEASE_REPO || 'OWNER/REPO'
const read = (f) => fs.readFileSync(path.join(site, f), 'utf8')
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `warning: ${msg}`)
const hasEmail = CONTACT_EMAIL && CONTACT_EMAIL !== 'CONTACT_EMAIL'
if (!hasEmail) warn('CONTACT_EMAIL in site/config.mjs is still the placeholder: the privacy and support pages need a real address')

// ---- the release the download buttons point at -------------------------------------------------------------------
let release = null // null: a local preview
if (releaseFile) {
  let json = null
  try { json = JSON.parse(fs.readFileSync(releaseFile, 'utf8') || 'null') } catch {}
  release = json?.tag_name && !json.draft ? json : { assets: [] }
  if (!release.tag_name) warn(`no published release on ${repo} yet: the Mac and Windows buttons say "Coming soon"`)
}
function link(file) {
  const h = file.href
  if (!h) return null
  if (typeof h === 'string') return { url: h }
  if (!release) return { url: `https://github.com/${repo}/releases/latest` }
  const asset = release.assets.find((a) => h.release.test(a.name))
  if (!asset) {
    if (release.tag_name) warn(`${release.tag_name} has no file for ${file.id} (${h.release}): it shows "Coming soon"`)
    return null
  }
  return { url: asset.browser_download_url, size: asset.size }
}
const version = release?.tag_name?.replace(/^v/, '')

// ---- pieces every page shares ------------------------------------------------------------------------------------
const ICONS = { // Lucide (ISC, assets/LICENSES.txt)
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
}
const icon = (name, size = 20) => `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`

// The wordmark: the name in Fredoka Bold as it's written (the capitals are the CLI in CLIque), each letter a creature's
// colour, on felt (brand.html). Letters are placed one by one from Fredoka's widths, as the app's wordmark is.
const WIDTHS = JSON.parse(read('tools/fredoka-700.json'))
const LETTER_COLOURS = ['#ff45a8', '#3db8ff', '#ffc61f', '#2fd3a6', '#72d63a', '#ff8a1f', '#8b5cf6', '#ffa27f']
function wordmark(fs_ = 36) {
  let x = 0
  const letters = [...PRODUCT].map((l, i) => {
    const at = x
    x += (WIDTHS[l] ?? 0.55) * fs_ - fs_ * 0.02
    return l === ' ' ? '' : `<text x="${+at.toFixed(2)}" y="${+(fs_ * 0.86).toFixed(2)}" fill="${LETTER_COLOURS[i % LETTER_COLOURS.length]}">${esc(l)}</text>`
  })
  const w = Math.ceil(x + fs_ * 0.06), h = Math.ceil(fs_ * 1.11)
  return `<svg class="wordmark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><g filter="url(#felt-grain)" font-family="Fredoka" font-weight="700" font-size="${fs_}">${letters.join('')}</g></svg>`
}

// The creatures, once per page, as symbols the room and the sections <use>.
const CLIQUE = [
  { id: 'ada', name: 'Ada', status: 'working' }, { id: 'milo', name: 'Milo', status: 'needs' },
  { id: 'iris', name: 'Iris', status: 'needs' }, { id: 'theo', name: 'Theo', status: 'working' },
  { id: 'june', name: 'June', status: 'idle' }, { id: 'rex', name: 'Rex', status: 'starting' },
  { id: 'noor', name: 'Noor', status: 'off' },
]
// A creature's own clips and filters go next to the shared defs, not inside its symbol: Chrome doesn't apply a filter
// that's defined inside a <symbol> to the symbol's copies.
const creature = (id) => {
  const svg = read(`creatures/${id}.svg`)
  const own = svg.match(/<!-- own -->([\s\S]*?)<!-- \/own -->/)?.[1] ?? ''
  const body = svg.match(/<!-- body -->([\s\S]*)<!-- \/body -->/)?.[1]
  if (!body) throw new Error(`site/creatures/${id}.svg has no body: run tools/creatures.mjs`)
  return own + `<symbol id="cr-${id}" viewBox="0 0 100 100" overflow="visible">${body}</symbol>`
}
const sharedDefs = read('creatures/_defs.svg').match(/<defs>([\s\S]*)<\/defs>/)[1]
const FELT = `<filter id="felt-grain" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="3" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" result="edge"/>
<feTurbulence type="fractalNoise" baseFrequency="1.8" numOctaves="2" seed="9" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .32 0 0 0 -.13" result="dark"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 .4 0 0 -.2" result="light"/>
<feComposite in="dark" in2="edge" operator="in" result="d2"/><feComposite in="light" in2="edge" operator="in" result="l2"/>
<feMerge><feMergeNode in="edge"/><feMergeNode in="d2"/><feMergeNode in="l2"/></feMerge>
</filter>`
// creatures: true for the whole clique, or a list of ids
const defs = (creatures) => `<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${FELT}${creatures ? sharedDefs + CLIQUE.filter((a) => creatures === true || creatures.includes(a.id)).map((a) => creature(a.id)).join('') : ''}</defs></svg>`

// ---- the CLIque room: one felt surface (back wall, floor, a seam between), the clique acting out its status ------------
// Three compositions of the same room, for wide screens, tablets and phones; each scales with its width.
const SAY = { milo: 'Can I run <code>npm run build</code>?', theo: 'All 48 checkout tests pass' }
const ROOMS = {
  wide: { w: 1312, h: 340, floor: 104, names: true, clique: CLIQUE.map((a, i) => ({ ...a, x: 28 + (i * (1312 - 56 - 184)) / 6, y: 132, size: 184 })), says: [['milo', 28, -34], ['theo', 64, -20]] },
  medium: { w: 900, h: 250, floor: 92, names: true, clique: CLIQUE.map((a, i) => ({ ...a, x: 12 + (i * (900 - 24 - 128)) / 6, y: 98, size: 128 })), says: [['milo', 20, -40]] },
  narrow: {
    w: 360, h: 204, floor: 88, names: false, says: [],
    clique: [['june', 50, 52, 72], ['rex', 144, 52, 72], ['noor', 238, 52, 72], ['ada', 6, 100, 96], ['theo', 88, 100, 96], ['milo', 170, 100, 96], ['iris', 258, 100, 96]]
      .map(([id, x, y, size]) => ({ ...CLIQUE.find((a) => a.id === id), x, y, size })),
  },
}
const pct = (v, of) => `${+((v / of) * 100).toFixed(3)}%`
function room(kind) {
  const r = ROOMS[kind]
  const fy = r.h - r.floor
  const art = `<svg class="room-art" viewBox="0 0 ${r.w} ${r.h}" aria-hidden="true" focusable="false">
<clipPath id="room-clip-${kind}"><rect x="1" y="1" width="${r.w - 2}" height="${r.h - 2}" rx="14"/></clipPath>
<g clip-path="url(#room-clip-${kind})" filter="url(#felt-grain)"><rect width="${r.w}" height="${r.h}" class="wall"/><rect y="${fy}" width="${r.w}" height="${r.floor}" class="floor"/></g>
<path d="M10 ${fy}H${r.w - 10}" class="thread"/><rect x="6" y="6" width="${r.w - 12}" height="${r.h - 12}" rx="10" class="thread"/>
${r.clique.map((a) => `<use href="#cr-${a.id}" x="${+a.x.toFixed(2)}" y="${a.y}" width="${a.size}" height="${a.size}"/>`).join('')}
</svg>`
  const says = r.says.map(([id, dx, dy]) => {
    const a = r.clique.find((c) => c.id === id)
    return `<p class="say" style="left:${pct(a.x + dx, r.w)};top:${pct(a.y + dy, r.h)}">${SAY[id]}</p>`
  }).join('')
  const names = r.names ? `<div class="room-names" aria-hidden="true">${r.clique.map((a) => `<span style="left:${pct(a.x + a.size / 2, r.w)}">${a.status === 'needs' || a.status === 'working' ? `<i class="dot ${a.status}"></i>` : ''}${a.name}</span>`).join('')}</div>` : ''
  return `<div class="room-${kind}"><div class="room">${art}${says}</div>${names}</div>`
}
const ROOM_LABEL = 'The clique in its room: Ada and Theo are at their laptops, Milo holds up a sign asking if he can run npm run build, Iris has a question, June is having a coffee, Rex is just starting and Noor is asleep.'

// ---- downloads ---------------------------------------------------------------------------------------------------
const mb = (n) => `${Math.round(n / 1e6)} MB`
function downloadCard(key) {
  const p = DOWNLOADS[key]
  const files = p.files.map((f, i) => {
    const l = link(f)
    const inner = `<span class="label">${esc(f.label)}</span>${f.detail || l?.size ? `<span class="detail">${[f.detail, l?.size && mb(l.size)].filter(Boolean).map(esc).join(' · ')}</span>` : ''}`
    if (!l) return `<span class="file soon">${inner}<span class="detail">Coming soon</span></span>`
    return `<a class="file${i === 0 && p.files.length > 1 ? ' brand' : ''}" href="${esc(l.url)}">${inner}<span class="vh">, ${esc(`${PRODUCT} for ${p.title}`)}</span></a>`
  }).join('')
  return `<article class="platform" id="${key}"><h3>${icon(p.icon, 22)}${esc(p.title)}</h3><div class="files">${files}</div><p class="note">${esc(p.note)}</p></article>`
}

// ---- pages -------------------------------------------------------------------------------------------------------
const YEAR = new Date().getFullYear()
const absolute = (f) => (SITE_URL ? new URL(f, SITE_URL).href : f)
function page({ file, title, description, main, creatures = false }) {
  // GitHub Pages shows 404.html at whatever address was asked for, so its links can't be relative to where it is
  const base = file === '404.html' && SITE_URL ? `<base href="${esc(SITE_URL)}">\n` : ''
  const social = `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(PRODUCT)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(absolute('og.png'))}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`${PRODUCT}: the clique of felt creatures, at work`)}"><meta name="twitter:card" content="summary_large_image">
${SITE_URL ? `<meta property="og:url" content="${esc(absolute(file === 'index.html' ? './' : file))}"><link rel="canonical" href="${esc(absolute(file === 'index.html' ? './' : file))}">` : ''}`
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${base}<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#FBF9F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161616" media="(prefers-color-scheme: dark)">
<link rel="icon" href="favicon.ico" sizes="32x32">
<link rel="icon" href="assets/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preload" href="assets/fonts/fredoka.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/site.css">
${social}
</head>
<body>
${defs(creatures)}
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <a class="home" href="./" aria-label="${esc(PRODUCT)} home">${wordmark(36)}</a>
  <nav aria-label="Site"><a class="hide-narrow" href="./#how">How it works</a><a href="support.html">Support</a><a class="btn brand" href="./#download">Download</a></nav>
</header>
<main id="main">
${main}
</main>
<footer class="foot">
  <p>© ${YEAR} ${esc(COMPANY)}</p>
  <nav aria-label="Legal"><a href="privacy.html">Privacy</a><a href="support.html">Support</a></nav>
  <p class="fine">${esc(PRODUCT)} isn’t made by Anthropic or OpenAI. Claude Code is Anthropic’s and Codex is OpenAI’s.</p>
</footer>
</body>
</html>
`
  fs.writeFileSync(path.join(out, file), html)
}

const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => {
  if (!(k in vars)) throw new Error(`no value for {{${k}}}`)
  return vars[k]
})
const contact = hasEmail ? `<a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>` : '<span class="placeholder">CONTACT_EMAIL</span>'

// A small Markdown reader for privacy.md: headings, paragraphs, lists, **bold** and `code`.
function markdown(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/CONTACT_EMAIL/g, contact)
  const blocks = md.trim().split(/\n{2,}/)
  return blocks.map((b) => {
    if (b.startsWith('# ')) return `<h1>${inline(b.slice(2))}</h1>`
    if (b.startsWith('## ')) return `<h2>${inline(b.slice(3))}</h2>`
    if (b.startsWith('- ')) return `<ul>${b.split(/\n(?=- )/).map((li) => `<li>${inline(li.slice(2).replace(/\n/g, ' '))}</li>`).join('')}</ul>`
    return `<p>${inline(b.replace(/\n/g, ' '))}</p>`
  }).join('\n')
}

const DESCRIPTION = `Run Claude Code and Codex agents side by side on your Mac or PC. They split the work, ask when they need you, and you answer from your phone.`
const vars = {
  product: esc(PRODUCT),
  contact,
  rooms: `<div class="rooms" role="img" aria-label="${esc(ROOM_LABEL)}">${room('wide')}${room('medium')}${room('narrow')}</div>`,
  platforms: Object.keys(DOWNLOADS).map(downloadCard).join(''),
  version: version ? `<p class="version">Version ${esc(version)}</p>` : '',
  hero_downloads: `<a class="btn brand lg" href="#mac">${icon('laptop')}Download for Mac</a>
      <span class="row"><a class="btn lg" href="#windows">${icon('monitor')}Windows</a><a class="btn lg" href="#iphone">${icon('smartphone')}iPhone</a><a class="btn lg" href="#android">${icon('smartphone')}Android</a></span>`,
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
fs.cpSync(path.join(site, 'assets'), path.join(out, 'assets'), { recursive: true })
// browsers ask for these at the top of the site
for (const f of ['favicon.ico', 'apple-touch-icon.png', 'og.png']) {
  if (fs.existsSync(path.join(site, 'assets', f))) fs.copyFileSync(path.join(site, 'assets', f), path.join(out, f))
  else warn(`site/assets/${f} is missing: run tools/icons.mjs`)
}
fs.writeFileSync(path.join(out, '.nojekyll'), '')
if (DOMAIN) fs.writeFileSync(path.join(out, 'CNAME'), DOMAIN + '\n')

page({ file: 'index.html', title: `${PRODUCT}: your AI agents, working as a clique`, description: DESCRIPTION, creatures: true, main: fill(read('src/index.html'), vars) })
page({ file: 'support.html', title: `Support · ${PRODUCT}`, description: `How to get help with ${PRODUCT}.`, main: fill(read('src/support.html'), vars) })
page({ file: 'privacy.html', title: `Privacy · ${PRODUCT}`, description: `What ${PRODUCT} does with your data: it collects nothing, and your work stays on your own devices.`, main: `<article class="prose">${markdown(read('privacy.md').replace(/\bCLIque\b/g, PRODUCT))}</article>` })
page({ file: '404.html', title: `Not found · ${PRODUCT}`, description: DESCRIPTION, creatures: ['noor'], main: fill(read('src/404.html'), vars) })
// --og: also the link-preview card (tools/icons.mjs takes its picture as og.png). Not part of the site.
if (args.includes('--og')) {
  fs.writeFileSync(path.join(out, 'og-card.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="assets/site.css">
<style>
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  .og { display: flex; flex-direction: column; justify-content: center; gap: 28px; height: 630px; padding: 0 48px; }
  .og-head { display: flex; align-items: center; gap: 24px; }
  .og-head img { width: 96px; height: 96px; border-radius: 22px; box-shadow: 0 0 0 1px var(--line); }
  .og-head p { margin: 0; font-family: var(--font-brand); font-size: 52px; line-height: 58px; font-weight: 600; letter-spacing: -.012em; }
  .og .room-names { display: none; }
</style></head>
<body>${defs(true)}<div class="og"><div class="og-head"><img src="assets/icon-192.png" alt="">${wordmark(84)}</div>
<div class="og-head"><p>Your AI agents, working as a <span class="berry">clique</span></p></div>${room('wide')}</div></body></html>
`)
}
console.log(`built ${path.relative(process.cwd(), out) || out}: ${PRODUCT}, downloads ${release ? (version ? `from ${repo} ${release.tag_name}` : 'coming soon') : `→ ${repo} releases page (preview)`}`)

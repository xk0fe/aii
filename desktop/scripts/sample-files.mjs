// Made-up files for the screenshots of what agents attach in the chat (scripts/screenshots.mjs `files`): three drawn
// "screenshots", a short recording (ffmpeg, which the recordings need anyway), a page that runs, and a log. They go
// through the real path, core/attachments.js check() + store(), so the sizes the chat lays them out by are the ones
// read from the files.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { check, store } from '../core/attachments.js'

const screen = (w, h, title, rows, accent) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="system-ui, sans-serif">
<rect width="${w}" height="${h}" fill="#FAF7F2"/><rect width="${w}" height="${Math.round(h * 0.09)}" fill="#FFFFFF"/><rect y="${Math.round(h * 0.09)}" width="${w}" height="1" fill="#E7E2DA"/>
<circle cx="${Math.round(h * 0.045)}" cy="${Math.round(h * 0.045)}" r="${Math.round(h * 0.018)}" fill="${accent}"/><text x="${Math.round(h * 0.085)}" y="${Math.round(h * 0.057)}" font-size="${Math.round(h * 0.034)}" font-weight="600" fill="#1C1C1C">${title}</text>
${rows.map(([label, value, bold], i) => {
    const y = Math.round(h * (0.2 + i * 0.105))
    return `<rect x="${Math.round(w * 0.06)}" y="${y}" width="${Math.round(w * 0.88)}" height="${Math.round(h * 0.085)}" rx="${Math.round(h * 0.016)}" fill="#FFFFFF" stroke="#E7E2DA"/><text x="${Math.round(w * 0.09)}" y="${y + Math.round(h * 0.054)}" font-size="${Math.round(h * 0.03)}" fill="#1C1C1C" font-weight="${bold ? 700 : 400}">${label}</text><text x="${Math.round(w * 0.91)}" y="${y + Math.round(h * 0.054)}" font-size="${Math.round(h * 0.03)}" fill="#1C1C1C" font-weight="${bold ? 700 : 400}" text-anchor="end">${value}</text>`
  }).join('')}
<rect x="${Math.round(w * 0.06)}" y="${Math.round(h * 0.84)}" width="${Math.round(w * 0.88)}" height="${Math.round(h * 0.09)}" rx="${Math.round(h * 0.045)}" fill="${accent}"/><text x="${w / 2}" y="${Math.round(h * 0.898)}" font-size="${Math.round(h * 0.034)}" font-weight="600" fill="#FFFFFF" text-anchor="middle">Pay 47.40</text></svg>`

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Totals</title><style>
body{margin:0;padding:24px 28px;font:15px/1.5 system-ui,sans-serif;color:#1c1c1c;background:#faf7f2}
h1{margin:0 0 4px;font-size:20px} p{margin:0 0 16px;color:#6b6b6b}
.row{display:flex;align-items:center;gap:12px;margin:8px 0} .row span{flex:1}
button{font:inherit;width:32px;height:32px;border-radius:8px;border:1px solid #d9d3c9;background:#fff;cursor:pointer}
button:hover{background:#f1ece4} b.n{display:inline-block;width:28px;text-align:center}
.total{margin-top:16px;padding:14px 16px;border-radius:12px;background:#fff;border:1px solid #e7e2da;display:flex;justify-content:space-between;font-weight:700;font-size:18px}
.bar{height:8px;border-radius:4px;background:#eee7dc;overflow:hidden;margin-top:14px} .bar i{display:block;height:100%;width:0;background:#cc2277;transition:width .25s}
small{color:#6b6b6b}</style></head><body>
<h1>Checkout totals</h1><p>Rounding happens once, on the total. Change the quantities.</p>
<div id="rows"><div class="row"><span>Oat flat white <small>3.35</small></span><button>−</button><b class="n">2</b><button>+</button></div><div class="row"><span>Cardamom bun <small>2.95</small></span><button>−</button><b class="n">3</b><button>+</button></div><div class="row"><span>Filter refill <small>1.15</small></span><button>−</button><b class="n">1</b><button>+</button></div></div><div class="total"><span>Total</span><span id="total">18.08</span></div>
<div class="bar"><i id="bar"></i></div><small id="note"></small>
<script>
const items = [['Oat flat white', 3.35, 2], ['Cardamom bun', 2.95, 3], ['Filter refill', 1.15, 1]]
const rows = document.getElementById('rows')
function draw() {
  rows.innerHTML = items.map(([name, price, n], i) => '<div class="row"><span>' + name + ' <small>' + price.toFixed(2) + '</small></span><button data-i="' + i + '" data-d="-1">−</button><b class="n">' + n + '</b><button data-i="' + i + '" data-d="1">+</button></div>').join('')
  const total = Math.round(items.reduce((s, [, p, n]) => s + p * n, 0) * 1.0825 * 100) / 100
  document.getElementById('total').textContent = total.toFixed(2)
  document.getElementById('bar').style.width = Math.min(100, total * 2) + '%'
  document.getElementById('note').textContent = total >= 30 ? 'Free delivery' : (30 - total).toFixed(2) + ' more for free delivery'
}
rows.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const it = items[b.dataset.i]; it[2] = Math.max(0, it[2] + Number(b.dataset.d)); draw() })
draw()
</script></body></html>`

// -> { desktop, cart, payment, receipt, clip, page, log }: each a message's file as Hub.attach would store it
export async function sampleFiles(dir) {
  const src = path.join(dir, 'src')
  const kept = path.join(dir, 'attachments')
  fs.mkdirSync(src, { recursive: true })
  const put = (name, text) => (fs.writeFileSync(path.join(src, name), text), name)
  const rows = [['Oat flat white × 2', '6.70'], ['Cardamom bun × 3', '8.85'], ['Filter refill', '1.15'], ['Tax', '1.38'], ['Total', '18.08', true]]
  const names = {
    desktop: put('checkout-desktop.svg', screen(1280, 800, 'Checkout', rows, '#CC2277')),
    cart: put('phone-cart.svg', screen(390, 844, 'Cart', rows.slice(0, 3), '#2F7D5B')),
    payment: put('phone-payment.svg', screen(390, 844, 'Payment', [['Card', '•••• 4242'], ['Coupon', 'SPRING10'], ['Total', '18.08', true]], '#3B6FD9')),
    receipt: put('phone-receipt.svg', screen(390, 844, 'Receipt', [['Order', '#1042'], ['Paid', '18.08', true]], '#B4691E')),
    page: put('totals-demo.html', PAGE),
    log: put('checkout-tests.log', Array.from({ length: 48 }, (_, i) => `ok ${i + 1} - checkout ${['totals', 'coupon', 'tax', 'receipt'][i % 4]} case ${i + 1}`).join('\n') + '\n# pass 48\n# fail 0\n'),
  }
  // a few seconds of something moving: soft gradients, and a bar that fills
  names.clip = 'coupon-flow.mp4'
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0xF6DCE9:c1=0xDCE6FA:c2=0xFAF0DC:n=3:d=6:speed=0.012:r=30',
    '-f', 'lavfi', '-i', 'color=c=0xCC2277:s=44x44:r=30',
    '-filter_complex', "[0]drawbox=x=160:y=568:w=960:h=12:color=white@0.9:t=fill,drawbox=x=160:y=200:w=420:h=260:color=white@0.85:t=fill,drawbox=x=700:y=200:w=420:h=260:color=white@0.6:t=fill[bg];[bg][1]overlay=x='160+916*t/6':y=552:shortest=1",
    '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(src, names.clip)])
  const out = {}
  for (const [key, name] of Object.entries(names)) out[key] = (await store(check([name], src), kept))[0]
  return { ...out, dir: kept }
}

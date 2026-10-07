// The floating pill: which side its chat opens on, wherever you drag it, and the pill staying put while the
// chat opens and closes. A fake window and a fake page that lays out like ui/overlay.html. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placement, anchor, bounds, pillWindow, PANEL } from '../core/pill.js'

const WA = { x: 0, y: 25, width: 1440, height: 875 } // a laptop screen under the menu bar
const PAD = 12
const PILL = { long: 300, short: 56 } // the pill: tall by the sides, flat at the top and bottom

// What the page draws for a side, as the CSS lays it out: window size and where the pill sits inside it.
function layout({ side, align }, open) {
  const flat = side === 'above' || side === 'below'
  const p = flat ? { width: PILL.long, height: PILL.short } : { width: PILL.short, height: PILL.long }
  if (!open) return { width: p.width + 2 * PAD, height: p.height + 2 * PAD, pill: { x: PAD, y: PAD, ...p } }
  const across = !flat
  const main = across ? p.width + PANEL.gap + PANEL.width : p.height + PANEL.gap + PANEL.height
  const cross = across ? Math.max(p.height, PANEL.height) : Math.max(p.width, PANEL.width)
  const pillCross = across ? p.height : p.width
  const offCross = align === 'start' ? 0 : align === 'end' ? cross - pillCross : (cross - pillCross) / 2
  const pillFirst = side === 'right' || side === 'below' // row-reverse / column-reverse put the pill first
  const offMain = pillFirst ? 0 : main - (across ? p.width : p.height)
  const pill = across ? { x: PAD + offMain, y: PAD + offCross, ...p } : { x: PAD + offCross, y: PAD + offMain, ...p }
  return { width: (across ? main : cross) + 2 * PAD, height: (across ? cross : main) + 2 * PAD, pill }
}

// A fake Electron screen: displays as work areas; the first is the main one.
function fakeScreen(areas) {
  const s = { areas }
  const near = (p) => {
    const dist = (a) => Math.hypot(Math.max(a.x - p.x, 0, p.x - (a.x + a.width)), Math.max(a.y - p.y, 0, p.y - (a.y + a.height)))
    return s.areas.reduce((a, b) => (dist(b) < dist(a) ? b : a))
  }
  s.getPrimaryDisplay = () => ({ workArea: s.areas[0] })
  s.getDisplayNearestPoint = (p) => ({ workArea: near(p) })
  s.getDisplayMatching = (r) => ({ workArea: near({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })
  return s
}

// A pill window with a fake overlay, screen and page.
function setup(areas = [WA]) {
  const win = {
    b: { x: WA.width - 78, y: 400, width: 80, height: 324 },
    getBounds() { return { ...this.b } },
    setBounds(b) { this.b = { ...b } },
    setSize(width, height) { this.b = { ...this.b, width, height } },
    getPosition() { return [this.b.x, this.b.y] },
    setPosition(x, y) { this.b = { ...this.b, x, y } },
    webContents: { send: (ch, place) => ch === 'place' && ((page.place = place), page.fit()) },
  }
  const screen = fakeScreen(areas)
  const p = pillWindow(win, screen)
  const page = {
    place: { side: 'left', align: 'center' },
    open: false,
    fit() {
      const l = layout(this.place, this.open)
      p.fit(l.width, l.height, l.pill)
    },
  }
  page.fit()
  // drag the pill by (dx, dy), the way the page reports the pointer, and let go
  const drag = (dx, dy) => {
    p.drag('start', 500, 500)
    p.drag('move', 500 + dx / 2, 500 + dy / 2)
    p.drag('move', 500 + dx, 500 + dy)
    p.drag('end', 500 + dx, 500 + dy)
  }
  // drag the pill so its middle lands at (x, y)
  const dropAt = (x, y) => {
    const r = p.rect()
    drag(x - (r.x + r.width / 2), y - (r.y + r.height / 2))
  }
  // where the open chat panel is on screen: past the pill along the main axis; it's the biggest thing across,
  // so it starts right inside the window's margin there
  const panel = () => {
    const b = win.getBounds()
    const flat = page.place.side === 'above' || page.place.side === 'below'
    const pillFirst = page.place.side === 'right' || page.place.side === 'below'
    const pr = p.rect()
    if (!flat) return { x: pillFirst ? pr.x + pr.width + PANEL.gap : pr.x - PANEL.gap - PANEL.width, y: b.y + PAD, width: PANEL.width, height: PANEL.height }
    return { x: b.x + PAD, y: pillFirst ? pr.y + pr.height + PANEL.gap : pr.y - PANEL.gap - PANEL.height, width: PANEL.width, height: PANEL.height }
  }
  return { win, p, page, drag, dropAt, panel, screen, rect: () => p.rect() }
}
const onScreen = (r) => r.x >= WA.x && r.y >= WA.y && r.x + r.width <= WA.x + WA.width && r.y + r.height <= WA.y + WA.height

test('it starts by the right edge, and opening or closing the chat never moves the pill', () => {
  const s = setup()
  assert.deepEqual(s.p.place, { side: 'left', align: 'center' })
  const closed = s.rect()
  assert.equal(closed.x + closed.width, WA.x + WA.width - 10)
  s.page.open = true
  s.page.fit()
  assert.deepEqual(s.rect(), closed, 'the chat grows to the left of a pill that stays put')
  assert.ok(s.win.getBounds().x < closed.x)
  s.page.open = false
  s.page.fit()
  assert.deepEqual(s.rect(), closed)
})

test('dragged to the left edge: the chat opens to its right, and the pill tucks in against the edge', () => {
  const s = setup()
  s.dropAt(60, 450)
  assert.equal(s.p.place.side, 'right')
  const r = s.rect()
  assert.equal(r.x, WA.x + 8, 'within 40px of the edge it tucks in, 8px off it')
  s.page.open = true
  s.page.fit()
  assert.deepEqual(s.rect(), r, 'opening the chat leaves the pill where you put it')
  assert.ok(s.panel().x > r.x + r.width, 'the chat is on its right')
  assert.ok(onScreen(s.panel()))
})

test('dragged to the top: it lies flat and the chat opens below it', () => {
  const s = setup()
  s.dropAt(720, 180) // its top lands near the top of the screen, halfway across
  assert.equal(s.p.place.side, 'below')
  const r = s.rect()
  assert.ok(r.width > r.height, 'flat, like the Dock')
  assert.equal(r.y, WA.y + 8)
  assert.ok(Math.abs(r.x + r.width / 2 - 720) <= 1, 'centered where it was dropped')
  s.page.open = true
  s.page.fit()
  assert.deepEqual(s.rect(), r)
  assert.ok(s.panel().y > r.y + r.height, 'the chat is below it')
  assert.ok(onScreen(s.panel()))
})

test('dragged to the bottom: it lies flat and the chat opens above it', () => {
  const s = setup()
  s.dropAt(700, WA.y + WA.height - 170)
  assert.equal(s.p.place.side, 'above')
  const r = s.rect()
  assert.equal(r.y + r.height, WA.y + WA.height - 8)
  s.page.open = true
  s.page.fit()
  assert.deepEqual(s.rect(), r)
  assert.ok(s.panel().y + PANEL.height < r.y, 'the chat is above it')
  assert.ok(onScreen(s.panel()))
})

test('dragged around the screen and back: every edge gives its side, and it stands up again by a side', () => {
  const s = setup()
  const tour = [[50, 450, 'right'], [720, 150, 'below'], [1390, 450, 'left'], [720, 800, 'above'], [1380, 400, 'left']]
  for (const [x, y, side] of tour) {
    s.dropAt(x, y)
    assert.equal(s.p.place.side, side, `dropped at ${x},${y}`)
    const r = s.rect()
    const flat = side === 'above' || side === 'below'
    assert.equal(r.width > r.height, flat)
  }
})

test("dropped in open space it stays where it is (no tucking in), with the chat on the side with more room", () => {
  const s = setup()
  s.dropAt(400, 450) // on the left, halfway down, well away from the edge
  assert.equal(s.p.place.side, 'right')
  const r = s.rect()
  assert.ok(Math.abs(r.x + r.width / 2 - 400) <= 1)
  assert.ok(r.x > WA.x + 40)
})

test('near the top of a side, the chat lines up with the top of the pill so it stays on screen', () => {
  const s = setup()
  s.drag(0, -250) // up along the right edge
  assert.deepEqual(s.p.place, { side: 'left', align: 'start' })
  s.page.open = true
  s.page.fit()
  const b = s.win.getBounds()
  assert.ok(b.y + PAD >= WA.y, 'the chat starts on screen')
  const before = s.rect()
  s.page.open = false
  s.page.fit()
  assert.deepEqual(s.rect(), before)
})

test('the part of the screen decides, not the pill\'s shape; near a diagonal it keeps the side it has', () => {
  assert.equal(placement({ x: 10, y: 30, width: 56, height: 300 }, WA).side, 'right', 'a tall pill by the left edge, its top near the top')
  assert.equal(placement({ x: 600, y: 30, width: 300, height: 56 }, WA).side, 'below')
  // its middle a tenth of the way across and an eighth of the way down: nearly the diagonal
  const corner = { x: 144 - 28, y: WA.y + 109 - 28, width: 56, height: 56 }
  assert.equal(placement(corner, WA, 'right').side, 'right')
  assert.equal(placement(corner, WA, 'below').side, 'below')
})

test('mid-drag a resize (the chat opening) keeps the pill under the pointer', () => {
  const s = setup()
  s.p.drag('start', 100, 100)
  s.p.drag('move', 60, 140)
  const under = s.rect()
  s.page.open = true
  s.page.fit() // the page changed size while you were dragging
  assert.deepEqual(s.rect(), under)
  s.p.drag('end', 60, 140)
})

test('a click (no move) is not a drop: the pill stays exactly where it is', () => {
  const s = setup()
  const before = s.rect()
  s.p.drag('start', 300, 300)
  s.p.drag('end', 300, 300)
  assert.deepEqual(s.rect(), before)
})

// ---- found in review: several screens, room for the chat, screens changing ----
const MONITOR_RIGHT = { x: 1440, y: 0, width: 1920, height: 1055 }
const MONITOR_BELOW = { x: 0, y: 900, width: 1920, height: 1055 }
const MONITOR_LEFT = { x: -1920, y: 0, width: 1920, height: 1055 }

test('with a monitor beside or below, opening the chat keeps the pill on its own screen', () => {
  for (const other of [MONITOR_RIGHT, MONITOR_BELOW]) {
    const s = setup([WA, other])
    const closed = s.rect()
    s.page.open = true
    s.page.fit()
    assert.deepEqual(s.rect(), closed, `next to ${JSON.stringify(other)}`)
    s.page.open = false
    s.page.fit()
    assert.deepEqual(s.rect(), closed)
  }
})

test('dropped by the right edge of a monitor on the left (negative x), it stays on that monitor', () => {
  const s = setup([WA, MONITOR_LEFT])
  s.dropAt(-30, 450)
  const r = s.rect()
  assert.ok(r.x + r.width <= 0, 'on the left monitor')
  assert.equal(s.p.place.side, 'left')
  s.page.open = true
  s.page.fit()
  assert.deepEqual(s.rect(), r)
})

test('no room for the chat below a flat pill in the middle of the screen: it opens beside it instead', () => {
  const s = setup()
  s.dropAt(720, 150) // flat at the top
  s.dropAt(760, 420) // then down to just above the middle
  assert.ok(['left', 'right'].includes(s.p.place.side), `got ${s.p.place.side}`)
  const r = s.rect()
  s.page.open = true
  s.page.fit()
  assert.deepEqual(s.rect(), r, 'opening the chat does not move the pill')
  assert.ok(onScreen(s.panel()))
})

test('a display going away brings the pill back onto the screen that is left, with the right side', () => {
  const s = setup([WA, MONITOR_RIGHT])
  s.dropAt(1440 + 40, 500) // by the left edge of the right monitor
  assert.equal(s.p.place.side, 'right')
  s.screen.areas = [WA] // unplugged
  s.p.resettle()
  const r = s.rect()
  assert.ok(r.x + r.width <= WA.x + WA.width && r.x >= WA.x, 'back on the laptop')
  assert.equal(s.p.place.side, 'left', 'now by the right edge, so the chat opens to its left')
  s.page.open = true
  s.page.fit()
  assert.deepEqual(s.rect(), r)
})

test('the window never lets what it draws leave the screen (its transparent margin may)', () => {
  const b = bounds({ px: 5, py: 5, fx: 0, fy: 0 }, { x: 12, y: 12, width: 56, height: 300 }, { width: 80, height: 324 }, WA)
  assert.equal(b.x, 5 - 12, 'a pill 5px from the edge is on screen, its margin hangs off')
  assert.equal(b.y + 12, WA.y, 'above the top of the work area, it comes down onto it')
  const a = anchor('left', { x: 1400, y: 300, width: 56, height: 300 }, WA, { snap: true })
  assert.deepEqual(a, { px: WA.x + WA.width - 8, py: 450, fx: 1, fy: 0.5 })
})

// The floating chat under the mouse: the buddy that trails the pointer, and the message box and the chat opening where
// the pointer is. A fake window, a fake screen with a pointer, and a fake page that lays out like ui/overlay.html.
// Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beside, glide, openSpot, openBounds, followWindow, BESIDE, NEAR, ROOM, PACE } from '../core/follow.js'

const SCREEN = { x: 0, y: 0, width: 1440, height: 900 }
const WA = { x: 0, y: 25, width: 1440, height: 875 } // under the menu bar
const PAD = 14 // ui/overlay.html: the see-through margin around what's drawn
const BUDDY = { width: 42, height: 30 }
const BOX = { width: 400, height: 96 } // the message box, empty
const LISTS = 300 // ...and the room kept beside it for its lists
const CHAT = { width: 400, height: 600 }

// What the page says it draws (clique.fit): the window's size, where what's held sits in it, and what's open.
function layout(open, align = 'start', box = BOX) {
  if (!open) return [BUDDY.width + 2 * PAD, BUDDY.height + 2 * PAD, { x: PAD, y: PAD, ...BUDDY, open: false }]
  if (open === 'chat') return [CHAT.width + 2 * PAD, CHAT.height + 2 * PAD, { x: PAD, y: PAD, ...CHAT, open }]
  return [box.width + 2 * PAD, box.height + 2 * PAD + LISTS, { x: PAD, y: align === 'end' ? PAD + LISTS : PAD, ...box, open }]
}

function setup({ displays = [{ bounds: SCREEN, workArea: WA }], pointer = { x: 700, y: 400 } } = {}) {
  const win = {
    b: { x: 0, y: 0, width: 70, height: 58 },
    visible: true,
    focused: false,
    through: null,
    blurs: 0,
    moves: 0,
    getBounds() { return { ...this.b } },
    setBounds(b) { this.b = { ...b }; this.moves++ },
    getPosition() { return [this.b.x, this.b.y] },
    setPosition(x, y) { this.b = { ...this.b, x, y } },
    isVisible() { return this.visible },
    isFocused() { return this.focused },
    blur() { this.focused = false; this.blurs++ },
    setIgnoreMouseEvents(on) { this.through = on },
  }
  const screen = {
    pointer,
    getCursorScreenPoint() { return { ...this.pointer } },
    getDisplayNearestPoint(p) {
      const dist = ({ bounds: a }) => Math.hypot(Math.max(a.x - p.x, 0, p.x - (a.x + a.width)), Math.max(a.y - p.y, 0, p.y - (a.y + a.height)))
      return displays.reduce((a, b) => (dist(b) < dist(a) ? b : a))
    },
  }
  const clock = { t: 1000 }
  const f = followWindow(win, screen, { now: () => clock.t })
  // looks at the pointer for a while, a frame at a time -> the pace it settled on
  const run = (ms) => {
    let pace
    for (let t = 0; t < ms; t += 16) {
      clock.t += 16
      pace = f.look()
    }
    return pace
  }
  // what's drawn, on screen
  const drawn = () => f.rect()
  return { win, screen, clock, f, run, drawn }
}

test('the buddy sits below and to the right of the pointer, and on the other side at the screen edge', () => {
  assert.deepEqual(beside({ x: 500, y: 300 }, BUDDY, SCREEN), { x: 500 + BESIDE.x, y: 300 + BESIDE.y })
  // by the right edge: to the left of the pointer
  assert.deepEqual(beside({ x: 1430, y: 300 }, BUDDY, SCREEN), { x: 1430 - BESIDE.x - BUDDY.width, y: 300 + BESIDE.y })
  // at the bottom: above it
  assert.deepEqual(beside({ x: 500, y: 890 }, BUDDY, SCREEN), { x: 500 + BESIDE.x, y: 890 - BESIDE.y - BUDDY.height })
  // in the corner: both, and never off the screen
  const corner = beside({ x: 1439, y: 899 }, BUDDY, SCREEN)
  assert.ok(corner.x + BUDDY.width <= 1440 && corner.y + BUDDY.height <= 900)
  // a second screen to the left has its own edges
  const left = { x: -1920, y: 0, width: 1920, height: 1080 }
  assert.deepEqual(beside({ x: -10, y: 300 }, BUDDY, left), { x: -10 - BESIDE.x - BUDDY.width, y: 300 + BESIDE.y })
})

test('the buddy glides: most of the way at first, then it is there, however often it looks', () => {
  const to = { x: 300, y: 200 }
  const one = glide({ x: 0, y: 0 }, to, 16)
  assert.ok(one.x > 40 && one.x < 120, `a first frame goes part of the way: ${one.x}`)
  // two short looks get as far as one long one
  const twice = glide(glide({ x: 0, y: 0 }, to, 16), to, 16)
  const once = glide({ x: 0, y: 0 }, to, 32)
  assert.ok(Math.abs(twice.x - once.x) < 0.01 && Math.abs(twice.y - once.y) < 0.01)
  // close enough is there: the very point it was going to
  assert.equal(glide({ x: 299.7, y: 199.8 }, to, 16), to)
  let p = { x: 0, y: 0 }
  let frames = 0
  while (p !== to && frames < 200) (p = glide(p, to, 16)), frames++
  assert.ok(frames < 40, `it arrives within two thirds of a second: ${frames} frames`)
})

test('what opens does so with a corner by the pointer, on the side with room', () => {
  // the middle of the screen: to the right and below
  assert.deepEqual(openSpot({ x: 500, y: 200 }, ROOM.chat, WA), { px: 500 + NEAR, py: 200 + NEAR, fx: 0, fy: 0 })
  // no room to the right: to the left of the pointer
  assert.deepEqual(openSpot({ x: 1300, y: 200 }, ROOM.chat, WA), { px: 1300 - NEAR, py: 200 + NEAR, fx: 1, fy: 0 })
  // no room below: above the pointer
  assert.deepEqual(openSpot({ x: 500, y: 700 }, ROOM.chat, WA), { px: 500 + NEAR, py: 700 - NEAR, fx: 0, fy: 1 })
  // a screen too small either way: whichever side has more
  const small = { x: 0, y: 0, width: 700, height: 700 }
  assert.equal(openSpot({ x: 300, y: 300 }, ROOM.chat, small).fy, 0)
  assert.equal(openSpot({ x: 300, y: 420 }, ROOM.chat, small).fy, 1)
})

test('what is open stays on the screen, whatever see-through margin its window has', () => {
  const inside = { x: PAD, y: PAD, ...CHAT }
  const size = { width: CHAT.width + 2 * PAD, height: CHAT.height + 2 * PAD }
  const at = (spot) => {
    const b = openBounds(spot, inside, size, WA)
    return { x: b.x + inside.x, y: b.y + inside.y }
  }
  assert.deepEqual(at({ px: 510, py: 210, fx: 0, fy: 0 }), { x: 510, y: 210 })
  // held by its bottom right corner
  assert.deepEqual(at({ px: 900, py: 800, fx: 1, fy: 1 }), { x: 500, y: 200 })
  // pushed back from the edges it would cross
  const low = at({ px: 1300, py: 600, fx: 0, fy: 0 })
  assert.ok(low.x + CHAT.width <= WA.x + WA.width && low.y + CHAT.height <= WA.y + WA.height, JSON.stringify(low))
  const high = at({ px: 100, py: 100, fx: 1, fy: 1 })
  assert.ok(high.x >= WA.x && high.y >= WA.y, JSON.stringify(high))
})

test('closed, the window is the buddy: it trails the pointer and clicks go through it', () => {
  const { win, screen, f, run, drawn } = setup()
  f.start()
  f.stop()
  assert.equal(win.through, true)
  f.fit(...layout(false))
  // it starts right by the pointer
  assert.deepEqual(drawn(), { x: 700 + BESIDE.x, y: 400 + BESIDE.y, ...BUDDY })
  // the pointer moves: a frame later it's on its way, not there yet
  screen.pointer = { x: 1000, y: 500 }
  run(16)
  assert.ok(drawn().x > 714 && drawn().x < 1014, `on its way: ${drawn().x}`)
  // and then it's there
  assert.equal(run(600), PACE.moving)
  assert.deepEqual(drawn(), { x: 1000 + BESIDE.x, y: 500 + BESIDE.y, ...BUDDY })
  // still for a while: it looks less often, and the window isn't touched
  const moves = win.moves
  assert.equal(run(2500), PACE.still)
  assert.equal(win.moves, moves)
  // the pointer moves again: back to looking often
  screen.pointer = { x: 990, y: 500 }
  assert.equal(run(16), PACE.moving)
})

test('it crosses to the other side of the pointer at the edge of the screen', () => {
  const { screen, f, run, drawn } = setup()
  f.fit(...layout(false))
  screen.pointer = { x: 1435, y: 895 }
  run(800)
  assert.deepEqual(drawn(), { x: 1435 - BESIDE.x - BUDDY.width, y: 895 - BESIDE.y - BUDDY.height, ...BUDDY })
})

test('hidden (the dashboard is up), it stays where it is', () => {
  const { win, screen, f, run } = setup()
  f.fit(...layout(false))
  win.visible = false
  const moves = win.moves
  screen.pointer = { x: 100, y: 100 }
  assert.equal(run(500), PACE.still)
  assert.equal(win.moves, moves)
  // back on screen: by the pointer again
  win.visible = true
  run(800)
  assert.deepEqual(f.rect(), { x: 100 + BESIDE.x, y: 100 + BESIDE.y, ...BUDDY })
})

test('the message box opens where the pointer is and stays there while the pointer moves on', () => {
  const { win, screen, f, run, drawn } = setup()
  f.fit(...layout(false))
  assert.equal(f.open('quick'), 'start') // it hangs below the pointer
  assert.equal(f.opened, 'quick')
  assert.equal(win.through, false) // it takes clicks now
  f.fit(...layout('quick', 'start'))
  assert.deepEqual(drawn(), { x: 700 + NEAR, y: 400 + NEAR, ...BOX })
  screen.pointer = { x: 200, y: 200 }
  run(500)
  assert.deepEqual(drawn(), { x: 700 + NEAR, y: 400 + NEAR, ...BOX })
  // you write more: it grows downwards, its top where it was
  f.fit(...layout('quick', 'start', { width: 400, height: 180 }))
  assert.deepEqual(drawn(), { x: 700 + NEAR, y: 400 + NEAR, width: 400, height: 180 })
})

test('low on the screen it stands above the pointer, and grows upwards', () => {
  const { f, drawn } = setup({ pointer: { x: 700, y: 800 } })
  f.fit(...layout(false))
  assert.equal(f.open('quick'), 'end')
  f.fit(...layout('quick', 'end'))
  assert.deepEqual(drawn(), { x: 700 + NEAR, y: 800 - NEAR - BOX.height, ...BOX })
  f.fit(...layout('quick', 'end', { width: 400, height: 180 }))
  assert.equal(drawn().y + drawn().height, 800 - NEAR) // its bottom edge stays by the pointer
})

test('the page closing it (Esc, a sent message, a click away) gives the keyboard back and the buddy follows again', () => {
  const { win, screen, f, run, drawn } = setup()
  f.fit(...layout(false))
  f.open('quick')
  f.fit(...layout('quick'))
  win.focused = true
  screen.pointer = { x: 300, y: 300 }
  f.fit(...layout(false))
  assert.equal(f.opened, null)
  assert.equal(win.blurs, 1, 'the app you were in has the keyboard again')
  assert.equal(win.through, true)
  // it shows up by the pointer, where that is now
  assert.deepEqual(drawn(), { x: 300 + BESIDE.x, y: 300 + BESIDE.y, ...BUDDY })
  screen.pointer = { x: 320, y: 300 }
  run(600)
  assert.deepEqual(drawn(), { x: 320 + BESIDE.x, y: 300 + BESIDE.y, ...BUDDY })
})

test("a window that doesn't have the keyboard isn't blurred when it closes", () => {
  const { win, f } = setup()
  f.fit(...layout(false))
  f.open('chat')
  f.fit(...layout('chat'))
  f.fit(...layout(false))
  assert.equal(win.blurs, 0)
})

test('closed from the hotkey, nothing half-open follows the pointer: it waits for the page', () => {
  const { win, screen, f, run, drawn } = setup()
  f.fit(...layout(false))
  f.open('chat')
  f.fit(...layout('chat'))
  win.focused = true
  const was = win.getBounds()
  f.close()
  assert.equal(win.blurs, 1)
  screen.pointer = { x: 100, y: 100 }
  run(200)
  assert.deepEqual(win.getBounds(), was, 'the chat is still drawn: its window stays put')
  f.fit(...layout(false)) // the page has closed it
  assert.deepEqual(drawn(), { x: 100 + BESIDE.x, y: 100 + BESIDE.y, ...BUDDY })
})

test("word from the page from before it was asked to open doesn't close it", () => {
  const { f, drawn } = setup()
  f.fit(...layout(false))
  f.open('quick')
  f.fit(...layout(false)) // a size it sent a moment earlier
  assert.equal(f.opened, 'quick')
  f.fit(...layout('quick'))
  assert.deepEqual(drawn(), { x: 700 + NEAR, y: 400 + NEAR, ...BOX })
})

test('a page that never opens it: the buddy goes back to following', () => {
  const { screen, f, run, drawn } = setup()
  f.fit(...layout(false))
  f.open('quick')
  screen.pointer = { x: 900, y: 300 }
  run(1000)
  assert.equal(f.opened, 'quick')
  run(1500)
  assert.equal(f.opened, null)
  assert.deepEqual(drawn(), { x: 900 + BESIDE.x, y: 300 + BESIDE.y, ...BUDDY })
})

test('the message box becomes the chat where it is, not where the pointer has gone', () => {
  const { screen, f, drawn } = setup()
  f.fit(...layout(false))
  f.open('quick')
  f.fit(...layout('quick'))
  screen.pointer = { x: 100, y: 100 }
  f.open('chat')
  assert.equal(f.opened, 'chat')
  f.fit(...layout('chat'))
  // (600 tall doesn't fit below 400 on this screen: it stays on it)
  assert.equal(drawn().x, 700 + NEAR)
  assert.ok(drawn().y + CHAT.height <= WA.y + WA.height)
})

test('the page opening by itself opens it where the pointer is', () => {
  const { f, drawn } = setup({ pointer: { x: 300, y: 100 } })
  f.fit(...layout(false))
  f.fit(...layout('chat'))
  assert.equal(f.opened, 'chat')
  assert.deepEqual(drawn(), { x: 300 + NEAR, y: 100 + NEAR, ...CHAT })
})

test('the chat dragged by its header stays where it was left, on the screen', () => {
  const { f, drawn } = setup({ pointer: { x: 300, y: 100 } })
  f.fit(...layout(false))
  f.open('chat')
  f.fit(...layout('chat'))
  f.drag('start', 400, 120)
  f.drag('move', 700, 200)
  // a size from the page mid-drag doesn't pull it back
  f.fit(...layout('chat'))
  assert.deepEqual(drawn(), { x: 300 + NEAR + 300, y: 100 + NEAR + 80, ...CHAT })
  f.drag('end', 700, 200)
  f.fit(...layout('chat'))
  assert.deepEqual(drawn(), { x: 610, y: 190, ...CHAT })
  // dropped past the edge: back onto the screen
  f.drag('start', 700, 200)
  f.drag('move', 1700, 200)
  f.drag('end', 1700, 200)
  assert.ok(drawn().x + CHAT.width <= WA.x + WA.width, JSON.stringify(drawn()))
})

test('the screens changed: what is open comes back onto one', () => {
  const second = { bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 25, width: 1920, height: 1055 } }
  const displays = [{ bounds: SCREEN, workArea: WA }, second]
  const { f, drawn } = setup({ displays, pointer: { x: 2000, y: 300 } })
  f.fit(...layout(false))
  f.open('chat')
  f.fit(...layout('chat'))
  assert.equal(drawn().x, 2000 + NEAR)
  displays.pop() // the second screen went away
  f.resettle()
  assert.ok(drawn().x + CHAT.width <= WA.x + WA.width, JSON.stringify(drawn()))
})

test('the page loading again forgets what was open', () => {
  const { f, drawn } = setup()
  f.fit(...layout(false))
  f.open('chat')
  f.fit(...layout('chat'))
  f.reset()
  assert.equal(f.opened, null)
  f.fit(...layout(false))
  assert.deepEqual(drawn(), { x: 700 + BESIDE.x, y: 400 + BESIDE.y, ...BUDDY })
})

test('it stands in for the pill where main.js treats them alike', () => {
  const { f } = setup()
  assert.equal(f.follows, true)
  assert.equal(f.docked, false)
  assert.deepEqual(f.place, { side: 'mouse', align: 'start' })
  f.dock()
  f.cancelDrag()
  f.resettle()
})

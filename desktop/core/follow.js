// The floating chat under the mouse (config.json's "chatAt": "mouse"): instead of a pill you put somewhere, a small
// buddy trails the pointer, and the message box or the chat opens right where the pointer is. Closed, the window is the
// buddy and follows; open, it stays where it opened until it's closed (Esc, sending from the message box, a click away
// from it, or the hotkey again), and then the keyboard goes back to the app you were in.
// No Electron in here: rectangles are { x, y, width, height } in screen coordinates, and followWindow() is handed the
// window and the screen it works with, like core/pill.js.

export const BESIDE = { x: 14, y: 18 } // the buddy sits this far right of and below the pointer's tip, clear of what it points at
export const NEAR = 10 // what opens does so this far from the pointer
// What each needs at its tallest, to pick the side of the pointer it opens on once and keep it: the message box grows as
// you write, and its lists (who it's to, @names) open into room kept beside it (ui/overlay.html .quick).
export const ROOM = { quick: { width: 400, height: 560 }, chat: { width: 400, height: 600 } }
export const PACE = { moving: 16, still: 120 } // ms between looks at the pointer
const EDGE = 8 // what opens stays this far inside the screen
const TAU = 70 // ms: the buddy covers about two thirds of the way to the pointer in this long
const REST = 2000 // ms with the pointer still before it looks less often
const OPENS_WITHIN = 1500 // ms: a page that hasn't opened by then never will, and the buddy follows again

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)))

// Where the buddy goes (its top-left) for a pointer at `point` on a screen `area`: below and to the right of the tip,
// like a tooltip; at the right or bottom edge of the screen, on the other side of the pointer.
export function beside(point, size, area) {
  let x = point.x + BESIDE.x
  let y = point.y + BESIDE.y
  if (x + size.width > area.x + area.width) x = point.x - BESIDE.x - size.width
  if (y + size.height > area.y + area.height) y = point.y - BESIDE.y - size.height
  return { x: clamp(x, area.x, area.x + area.width - size.width), y: clamp(y, area.y, area.y + area.height - size.height) }
}

// One step of the buddy toward where it's going, `dt` ms after the last: most of the way at first, then settling. It
// returns `to` itself once it's there.
export function glide(from, to, dt) {
  const k = 1 - Math.exp(-dt / TAU)
  const next = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }
  return Math.abs(to.x - next.x) < 0.5 && Math.abs(to.y - next.y) < 0.5 ? to : next
}

// Where the message box or the chat opens for a pointer at `point`: a corner of it by the pointer, to the right and
// below while what it needs fits on the screen's work area, else to the left or above (whichever has more room when
// neither fits). -> { px, py, fx, fy }: the point on screen that holds it and which corner of it that is (0 = left/top,
// 1 = right/bottom), so it grows away from the pointer.
export function openSpot(point, need, wa) {
  const side = (p, lo, length, size) => {
    const after = lo + length - (p + NEAR)
    const before = p - NEAR - lo
    return after >= size || after >= before ? 0 : 1
  }
  const fx = side(point.x, wa.x, wa.width, need.width)
  const fy = side(point.y, wa.y, wa.height, need.height)
  return { px: point.x + (fx ? -NEAR : NEAR), py: point.y + (fy ? -NEAR : NEAR), fx, fy }
}

// The window's bounds for what's open, held at `spot`: `inside` is where it's drawn inside the window (the rest of the
// window is see-through and may hang off the screen), and what's drawn stays on the work area.
export function openBounds(spot, inside, size, wa) {
  const x = clamp(spot.px - spot.fx * inside.width, wa.x + EDGE, wa.x + wa.width - inside.width - EDGE)
  const y = clamp(spot.py - spot.fy * inside.height, wa.y + EDGE, wa.y + wa.height - inside.height - EDGE)
  return { x: Math.round(x - inside.x), y: Math.round(y - inside.y), width: size.width, height: size.height }
}

// The floating chat's window under the mouse. It stands in for pillWindow() (core/pill.js): main.js makes one or the
// other, and what both have (place, docked, fit, drag, dock, cancelDrag, resettle) means the same.
// overlay: an Electron BrowserWindow, or anything with getBounds/setBounds/getPosition/setPosition, and optionally
// isVisible/isFocused/blur/setIgnoreMouseEvents; screen: Electron's screen. now/later/cancel: the clock, for tests.
export function followWindow(overlay, screen, { now = Date.now, later = setTimeout, cancel = clearTimeout } = {}) {
  const state = {
    size: null, // the window's size as the page asked for it; null until it says, and while it's on its way from open to closed
    inside: null, // where the page says what it draws sits inside the window: the buddy, or what's open
    pos: null, // the buddy's top-left on screen, on its way to the pointer
    shown: '', // the bounds last set while following
    pointer: null, // where the pointer was at the last look, and when it last moved
    movedAt: 0,
    lookedAt: 0,
    open: null, // { kind, point, area, spot, seen, moved, at }: seen once the page has opened it
    drag: null,
    timer: null,
  }
  const areaAt = (p) => screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) })
  const placeNow = () => ({ side: 'mouse', align: state.open?.spot.fy ? 'end' : 'start' })
  const openNow = () => openBounds(state.open.spot, state.inside, state.size, state.open.area)

  // One look at the pointer, and a step toward it. -> how long until the next look.
  function look() {
    const t = now()
    if (state.open && !state.open.seen && t - state.open.at > OPENS_WITHIN) close()
    if (state.open || !state.size || overlay.isVisible?.() === false) return PACE.still
    const p = screen.getCursorScreenPoint()
    if (!state.pointer || p.x !== state.pointer.x || p.y !== state.pointer.y) state.movedAt = t
    state.pointer = p
    // the whole screen, not just its work area: it goes where the pointer goes
    const to = beside(p, state.inside, areaAt(p).bounds)
    state.pos = state.pos ? glide(state.pos, to, Math.min(t - state.lookedAt, 64)) : to
    state.lookedAt = t
    const b = { x: Math.round(state.pos.x - state.inside.x), y: Math.round(state.pos.y - state.inside.y), width: state.size.width, height: state.size.height }
    const key = `${b.x},${b.y},${b.width},${b.height}`
    if (key !== state.shown) overlay.setBounds(b)
    state.shown = key
    return state.pos === to && t - state.movedAt > REST ? PACE.still : PACE.moving
  }

  function open(kind, point) {
    const was = state.open
    const at = was?.point ?? point ?? screen.getCursorScreenPoint()
    const area = was?.area ?? areaAt(at).workArea
    state.open = { kind, point: at, area, spot: was?.moved ? was.spot : openSpot(at, ROOM[kind] ?? ROOM.chat, area), seen: was?.seen ?? false, moved: was?.moved ?? false, at: now() }
    overlay.setIgnoreMouseEvents?.(false)
    return placeNow().align
  }

  // Back to the buddy. The window keeps what's open until the page has closed it and says the buddy's size (fit), so
  // nothing half-open ever follows the pointer.
  function close() {
    if (!state.open) return
    if (state.open.seen) state.size = null
    state.open = null
    state.drag = null
    state.pos = null // it shows up by the pointer, wherever that is by now
    state.shown = ''
    overlay.setIgnoreMouseEvents?.(true)
    // the keyboard goes back to the app you were in
    if (overlay.isFocused?.()) overlay.blur?.()
  }

  return {
    follows: true,
    get place() {
      return placeNow()
    },
    get docked() {
      return false
    },
    // 'quick' (the message box), 'chat', or null while it follows the pointer
    get opened() {
      return state.open?.kind ?? null
    },
    rect() {
      const b = overlay.getBounds()
      const p = state.inside ?? { x: 0, y: 0, width: b.width, height: b.height }
      return { x: b.x + p.x, y: b.y + p.y, width: p.width, height: p.height }
    },
    // The page's size and where what it draws sits in it; `inside.open` says what it has open ('quick', 'chat' or
    // false), which is how its own closing (Esc, a sent message, a click away) gets here.
    fit(width, height, inside) {
      const says = inside?.open || false
      if (!state.open && says) open(says) // the page opened by itself: where the pointer is
      if (state.open && says) state.open.seen = true
      else if (state.open?.seen) close() // (one it hasn't opened yet: this is word from before it was asked to)
      state.size = { width, height }
      state.inside = inside ? { x: inside.x, y: inside.y, width: inside.width, height: inside.height } : { x: 0, y: 0, width, height }
      state.shown = ''
      if (!state.open) return void look()
      // (not yet opened by the page: this is still the buddy's size, where it is. Mid-drag: where the drag has it.)
      if (state.open.seen && !state.drag) overlay.setBounds(openNow())
    },
    // Opens the message box ('quick') or the chat where the pointer is; one that's open stays where it is and becomes
    // the other. -> how it lines up there for the page: 'start' (it hangs below the pointer) or 'end' (it stands above).
    open,
    close,
    // The chat dragged by its header: 'start', 'move', 'end', the pointer in screen coordinates. It stays where it's
    // left (on the screen), whatever its size does next.
    drag(phase, x, y) {
      if (!state.open) return
      if (phase === 'start') state.drag = { from: overlay.getPosition(), at: [x, y] }
      else if (phase === 'move' && state.drag) overlay.setPosition(Math.round(state.drag.from[0] + x - state.drag.at[0]), Math.round(state.drag.from[1] + y - state.drag.at[1]))
      else if (phase === 'end' && state.drag) this.cancelDrag()
    },
    dock() {},
    // A drag that ended, or never will (the page reloaded, the window was hidden): it's held where it got to.
    cancelDrag() {
      if (!state.drag) return
      state.drag = null
      if (!state.open?.seen || !state.size) return
      const b = overlay.getBounds()
      const i = state.inside
      const s = state.open.spot
      state.open.spot = { ...s, px: b.x + i.x + s.fx * i.width, py: b.y + i.y + s.fy * i.height }
      state.open.area = areaAt({ x: b.x + i.x + i.width / 2, y: b.y + i.y + i.height / 2 }).workArea
      state.open.moved = true
      overlay.setBounds(openNow())
    },
    // The screens changed: what's open comes back onto the one it's nearest (the buddy finds the pointer by itself).
    resettle() {
      if (!state.open?.seen || !state.size || state.drag) return
      const b = overlay.getBounds()
      state.open.area = areaAt({ x: b.x + state.inside.x + state.inside.width / 2, y: b.y + state.inside.y + state.inside.height / 2 }).workArea
      overlay.setBounds(openNow())
    },
    // The page loaded again: whatever was open is gone with it.
    reset() {
      close()
      state.size = null
    },
    look,
    // Follows the pointer from now on, looking often while it moves and seldom while it rests. Clicks go through the
    // buddy to whatever is under it.
    start() {
      overlay.setIgnoreMouseEvents?.(true)
      const loop = () => (state.timer = later(loop, look()))
      if (state.timer == null) loop()
    },
    stop() {
      cancel(state.timer)
      state.timer = null
    },
  }
}

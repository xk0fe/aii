// Where the floating pill's chat opens: on the side away from the part of the screen the pill is in. On the
// left the chat opens to its right, on the right to its left, at the top below it, at the bottom above it (the
// pill lies flat at the top and bottom, like the Dock). The pill itself never moves when the
// chat opens or closes; the chat lines up with it so it stays on screen.
// No Electron in here: rectangles are { x, y, width, height } in screen coordinates, and pillWindow() is handed
// the window and screen it works with.

export const PANEL = { width: 390, height: 580, gap: 8 } // the chat panel, as ui/overlay.html draws it
const SNAP = 40 // dropped this close to an edge, the pill tucks in against it
const MARGIN = 8 // ...this far from it
const STICKY = 0.05 // near a diagonal, the side it already has wins by this much

// The chat's side ('left' | 'right' | 'above' | 'below', relative to the pill) and how the chat lines up with
// the pill along it ('start' | 'center' | 'end'), for a pill at `rect` on a screen whose work area is `wa`.
// Which part of the screen: how far the pill's middle is from the screen's middle, sideways and up/down, each as
// a share of the screen, and whichever is further wins (the pill's own shape doesn't count).
// The chat also has to fit on that side, with the pill where it is: if it doesn't (a flat pill in the middle of
// the screen has no room below it for the chat), the other way round, then the opposite side, then the roomiest.
export function placement(rect, wa, current) {
  const x = (rect.x + rect.width / 2 - wa.x) / wa.width - 0.5
  const y = (rect.y + rect.height / 2 - wa.y) / wa.height - 0.5
  const across = x < 0 ? 'right' : 'left'
  const upDown = y < 0 ? 'below' : 'above'
  let side = Math.abs(y) > Math.abs(x) ? upDown : across
  // near a diagonal, keep the side it already has rather than flip on a few pixels
  if (Math.abs(Math.abs(x) - Math.abs(y)) <= STICKY && (current === across || current === upDown)) side = current
  const opposite = { left: 'right', right: 'left', above: 'below', below: 'above' }
  const order = [side, side === across ? upDown : across, opposite[side]]
  const fits = order.find((s) => room(s, rect, wa) >= need(s)) ?? order.reduce((a, b) => (room(b, rect, wa) - need(b) > room(a, rect, wa) - need(a) ? b : a))
  return { side: fits, align: align(fits, rect, wa) }
}

// Space for the chat on a side, with the pill held as anchor() holds it (and as thick as it will be there).
function room(side, r, wa) {
  const t = Math.min(r.width, r.height)
  return {
    left: r.x + r.width - t - wa.x,
    right: wa.x + wa.width - (r.x + t),
    above: r.y + r.height - t - wa.y,
    below: wa.y + wa.height - (r.y + t),
  }[side]
}
const need = (side) => (side === 'left' || side === 'right' ? PANEL.width : PANEL.height) + PANEL.gap

// Along the pill: centered on it, unless that would push the chat off screen, then flush with the pill's end.
function align(side, rect, wa) {
  const across = side === 'left' || side === 'right'
  const center = across ? rect.y + rect.height / 2 : rect.x + rect.width / 2
  const half = (across ? PANEL.height : PANEL.width) / 2
  const [lo, hi] = across ? [wa.y, wa.y + wa.height] : [wa.x, wa.x + wa.width]
  if (center - half < lo) return 'start'
  if (center + half > hi) return 'end'
  return 'center'
}

const gaps = (r, wa) => ({ left: r.x - wa.x, right: wa.x + wa.width - (r.x + r.width), top: r.y - wa.y, bottom: wa.y + wa.height - (r.y + r.height) })

// What holds the pill in place: a point on screen and where on the pill it sits (fx, fy: 0 = left/top edge,
// .5 = middle, 1 = right/bottom edge). The pill keeps its edge against the screen side and its middle along
// it, so it grows (more agents) or turns (flat at the top) around where you left it. Dropped near an edge,
// it tucks in against it.
export function anchor(side, rect, wa, { snap = false } = {}) {
  const d = gaps(rect, wa)
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const tuck = (gap, at) => (snap && gap < SNAP ? MARGIN : at)
  switch (side) {
    case 'left': // the pill is by the right edge
      return { px: wa.x + wa.width - tuck(d.right, d.right), py: cy, fx: 1, fy: 0.5 }
    case 'right': // by the left edge
      return { px: wa.x + tuck(d.left, d.left), py: cy, fx: 0, fy: 0.5 }
    case 'below': // at the top
      return { px: cx, py: wa.y + tuck(d.top, d.top), fx: 0.5, fy: 0 }
    default: // 'above': at the bottom
      return { px: cx, py: wa.y + wa.height - tuck(d.bottom, d.bottom), fx: 0.5, fy: 1 }
  }
}

// The window's bounds for a pill held at `a`, given where the pill sits inside the window (`pill`, relative to
// the window) and the window's size. The window has a transparent margin around what it draws (`pad`), which
// may hang off the screen; what's drawn stays on it.
export function bounds(a, pill, size, wa, pad = 12) {
  const x = Math.round(a.px - a.fx * pill.width - pill.x)
  const y = Math.round(a.py - a.fy * pill.height - pill.y)
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)))
  return {
    x: clamp(x, wa.x - pad, wa.x + wa.width - size.width + pad),
    y: clamp(y, wa.y - pad, wa.y + wa.height - size.height + pad),
    width: size.width,
    height: size.height,
  }
}

// The floating pill's window: sized around what the page draws, placed so the pill stays put, dragged by the
// page's pointer, and given its chat's side when you let go. overlay: an Electron BrowserWindow (or anything
// with getBounds/setBounds/setSize/getPosition/setPosition and webContents.send); screen: Electron's screen.
export function pillWindow(overlay, screen) {
  const wa0 = screen.getPrimaryDisplay().workArea
  const state = {
    place: { side: 'left', align: 'center' }, // it starts by the right edge, its chat opening to the left
    at: { px: wa0.x + wa0.width - 10, py: wa0.y + wa0.height / 2, fx: 1, fy: 0.5 },
    inside: null, // where the page says the pill sits inside the window
    drag: null,
  }
  const rect = () => {
    const b = overlay.getBounds()
    const p = state.inside ?? { x: 12, y: 12, width: b.width - 24, height: b.height - 24 }
    return { x: b.x + p.x, y: b.y + p.y, width: p.width, height: p.height }
  }
  // the screen the pill is on: where it's held, not where the window happens to reach
  const areaAt = (a) => screen.getDisplayNearestPoint({ x: Math.round(a.px), y: Math.round(a.py) }).workArea

  // Let go (or the screens changed): the chat's side follows the part of the screen the pill is in. A new side
  // re-lays out the page, whose next fit puts the window around the pill; otherwise the pill just settles
  // (tucking in against an edge it was dropped close to).
  function settle({ snap = true } = {}) {
    let r = rect()
    const wa = screen.getDisplayNearestPoint({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }).workArea
    // a pill left off screen (a display went away, the Dock came up) comes back onto it first
    const clampTo = (v, lo, hi) => Math.max(lo, Math.min(v, hi))
    r = { ...r, x: clampTo(r.x, wa.x, wa.x + wa.width - r.width), y: clampTo(r.y, wa.y, wa.y + wa.height - r.height) }
    const next = placement(r, wa, state.place.side)
    state.at = anchor(next.side, r, wa, { snap })
    if (next.side !== state.place.side || next.align !== state.place.align) {
      state.place = next
      return overlay.webContents.send('place', next)
    }
    if (state.inside) overlay.setBounds(bounds(state.at, state.inside, overlay.getBounds(), wa))
  }

  return {
    get place() {
      return state.place
    },
    rect,
    // The page's size and where the pill sits in it (relative to the window).
    fit(width, height, inside) {
      // mid-drag the pill stays under the pointer, wherever that is; otherwise where it's held
      const r = state.drag && rect()
      const hold = r ? { px: r.x, py: r.y, fx: 0, fy: 0 } : state.at
      if (inside) state.inside = inside
      overlay.setBounds(bounds(hold, state.inside ?? { x: 12, y: 12, width: width - 24, height: height - 24 }, { width, height }, areaAt(hold)))
    },
    // The page's pointer, in screen coordinates: 'start', 'move', 'end'. Letting go without moving isn't a drop.
    drag(phase, x, y) {
      if (phase === 'start') state.drag = { from: overlay.getPosition(), at: [x, y], moved: false }
      else if (phase === 'move' && state.drag) {
        state.drag.moved = true
        overlay.setPosition(Math.round(state.drag.from[0] + x - state.drag.at[0]), Math.round(state.drag.from[1] + y - state.drag.at[1]))
      } else if (phase === 'end' && state.drag) {
        const { moved } = state.drag
        state.drag = null
        if (moved) settle()
      }
    },
    // A drag that will never end (the page reloaded, the window was hidden).
    cancelDrag() {
      state.drag = null
    },
    // The screens changed (a display came or went, the Dock or menu bar moved): back on screen, the side
    // re-picked for where it is now, no tucking in.
    resettle() {
      if (!state.drag) settle({ snap: false })
    },
  }
}

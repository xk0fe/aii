// The hatch: the notch at the top of a MacBook's screen, which the floating pill can be dragged into (core/pill.js) and
// the permissions flow comes out of (ui/permissions.js). A screen without one gets a drawn hatch at the top middle, the
// same shape, so it works the same on a monitor.
// Electron doesn't say where the notch is, but NSScreen does, and osascript asks it in under a tenth of a second without
// any permission. No Electron in here.
import { execFile } from 'node:child_process'

const DRAWN = { width: 120, height: 28 } // a screen with no notch: it shows as black as one, as tall as the menu bar
const REACH = 80 // how far beside the hatch dragging the pill still catches it...
const DROP = 44 // ...and below it

// Each screen with a notch, top-left coordinates like Electron's (NSScreen counts up from the main screen's bottom).
const ASK = `ObjC.import('AppKit')
var screens = $.NSScreen.screens, main = screens.objectAtIndex(0).frame.size.height, out = []
for (var i = 0; i < screens.count; i++) {
  var s = screens.objectAtIndex(i), f = s.frame, l = s.auxiliaryTopLeftArea, r = s.auxiliaryTopRightArea
  if (l.size.width > 0 && r.size.width > 0) out.push({ x: f.origin.x, y: main - f.origin.y - f.size.height, width: f.size.width, height: f.size.height,
    notch: { x: l.origin.x + l.size.width - f.origin.x, width: r.origin.x - l.origin.x - l.size.width, height: l.size.height } })
}
JSON.stringify(out)`

const osascript = (script) =>
  new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', script], { timeout: 1500 }, (e, out) => (e ? reject(e) : resolve(String(out))))
  })

// The notches on the screens right now; none when that can't be told (every screen then gets a drawn hatch). Never throws.
export async function readNotches({ run = osascript } = {}) {
  try {
    const list = JSON.parse(await run(ASK))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// The hatch on an Electron display: where it is on screen, and `area`, the whole screen it may reach into (the menu bar too).
export function hatchOn(display, notches = []) {
  const b = display.bounds
  const notch = notches.find((s) => s.x === b.x && s.y === b.y && s.width === b.width && s.height === b.height)?.notch
  if (notch) return { x: b.x + notch.x, y: b.y, width: notch.width, height: notch.height, real: true, area: b }
  const height = Math.max(DRAWN.height, display.workArea.y - b.y)
  return { x: Math.round(b.x + (b.width - DRAWN.width) / 2), y: b.y, width: DRAWN.width, height, real: false, area: b }
}

// Is the pointer close enough to catch it? slack: more room, so one already in doesn't pop out at the very edge.
export function inHatch(hatch, x, y, slack = 0) {
  return x >= hatch.x - REACH - slack && x <= hatch.x + hatch.width + REACH + slack && y >= hatch.y && y <= hatch.y + hatch.height + DROP + slack
}

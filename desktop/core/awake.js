// When CLIque keeps this computer from going to sleep, and what it says about it. No Electron in here: main.js asks
// (keepAwake) and holds or lets go of the one blocker; the tray shows the line.
//
// The reasons, any of which is enough:
//   working    one of this computer's own agents is working, in any workspace (yours to turn off: config.json
//              "keepAwake": false). Not one that waits for your answer, rests, is off or asleep, and not a linked
//              computer's: that computer keeps itself awake.
//   finishing  the last of them just finished: held for GRACE more, so a hand-off, a retry or the next task in line
//              doesn't let go and take hold again
//   sharing    this computer shares its agents            )
//   linked     a linked computer is connected             ) as before, whatever the setting says
//   phone      a phone is connected                       )
// Only the computer is kept awake; the screen may still turn off.

export const GRACE = 2 * 60_000
// While it's held for work, main.js asks again this often, in case nothing else did.
export const RECHECK = 60_000

// How many of this computer's agents are working, over every workspace's hub. A clone counts with its agent.
export function workingHere(hubs) {
  const busy = new Set()
  for (const hub of hubs) {
    if (hub.parked) continue
    for (const a of hub.agents.values()) if (a.status === 'working' && !a.off) busy.add(`${hub.ws ?? ''}/${a.cloneOf ?? a.name}`)
  }
  return busy.size
}

// before: what decide() returned last time ({} the first time). now: what's true now,
//   { working (a count), enabled (the setting), sharing, linked, phones, quitting }, at the time `at`.
// -> { on, reasons, working, until, again }: hold the blocker or not, why, until when it's held after the work
//    (or null), and in how many ms to ask again (or null: the next change will).
export function decide(before, now, at, grace = GRACE) {
  const reasons = []
  const working = now.enabled === false ? 0 : Math.max(0, Number(now.working) || 0)
  let until = null
  if (working) reasons.push('working')
  else if (now.enabled !== false) {
    // just finished: the grace starts. Still inside one: it carries on.
    until = before.reasons?.includes('working') ? at + grace : before.until ?? null
    if (until !== null && at < until) reasons.push('finishing')
    else until = null
  }
  if (now.sharing) reasons.push('sharing')
  if (now.linked) reasons.push('linked')
  if (now.phones) reasons.push('phone')
  if (now.quitting) return { on: false, reasons: [], working: 0, until: null, again: null }
  const again = working ? RECHECK : until !== null ? Math.max(1, until - at) : null
  return { on: reasons.length > 0, reasons, working, until, again }
}

// The one blocker, held and let go of as decide() says. main.js gives it Electron's powerSaveBlocker:
//   start() -> an id, stop(id)   take hold of the computer, let go of it
//   now()                        what's true now (decide's `now`), or null before there's anything to ask
//   told(decision)               it changed by itself (a grace ran out, the minute's check), so the windows should hear
//   log(text)                    each time it takes hold or lets go, and why
// check() is for every change of state; it asks again by itself while it's held for work. -> the decision.
export function keeper({ start, stop, now, told = () => {}, log = () => {}, grace = GRACE, clock = Date.now }) {
  let id = null
  let last = {}
  let timer = null
  function check({ tell = false } = {}) {
    const input = now()
    if (!input) return last
    clearTimeout(timer)
    const was = last
    last = decide(was, input, clock(), grace)
    if (last.on && id === null) id = start()
    if (!last.on && id !== null) stop(id), (id = null)
    if (last.again !== null) (timer = setTimeout(() => check({ tell: true }), last.again)).unref?.()
    if (Boolean(was.on) !== last.on || String(was.reasons ?? '') !== String(last.reasons) || (was.working ?? 0) !== last.working) {
      log(last.on ? `keeping the computer awake: ${last.reasons.join(', ')}${last.working ? ` (${last.working} working)` : ''}` : 'the computer may sleep')
      if (tell) told(last)
    }
    return last
  }
  return { check, get held() { return id !== null }, get decision() { return last } }
}

// The line the tray shows while the computer is kept awake ('' when it isn't). pc: "Mac" or "PC".
export function awakeLine({ on, reasons = [], working = 0 }, { pc = 'Mac', battery = false } = {}) {
  if (!on) return ''
  const why = [
    reasons.includes('working') && (working === 1 ? 'an agent works' : `${working} agents work`),
    reasons.includes('sharing') && 'it shares its agents',
    reasons.includes('linked') && 'a linked computer is connected',
    reasons.includes('phone') && 'your phone is connected',
  ].filter(Boolean)
  if (!why.length) return `Nobody's working now, so this ${pc} can sleep in a moment`
  const list = why.length > 2 ? `${why.slice(0, -1).join(', ')} and ${why.at(-1)}` : why.join(' and ')
  return `Keeping this ${pc} awake${battery ? ' on battery' : ''} while ${list}`
}

// What the windows get (state.awake): whether it's held, the line, and the setting.
export const awakeState = (decision, { enabled = true, pc, battery } = {}) => ({
  on: decision.on,
  reasons: decision.reasons,
  enabled: enabled !== false,
  line: awakeLine(decision, { pc, battery }),
})

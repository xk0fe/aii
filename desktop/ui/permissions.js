// What CLIque needs macOS to allow, one thing at a time, in the voice of a creature coming out of the hatch. core/permissions.js
// knows what's missing and how to ask; this keeps looking while it's up, since macOS's answer comes from a dialog of its
// own or a switch in System Settings. Moving on is automatic once it's allowed.
/* global crew, esc, avatarHTML, ICONS, PRODUCT_NAME */

const box = document.querySelector('.hatch')
const ALL = new URLSearchParams(location.search).has('all') // from the ⋯ menu
const LOOK_EVERY = 1200
const STILL_ASKING = 8000 // how long macOS's own question gets before this says where the switch is instead
const ANSWERED_AT_ONCE = new Set(['microphone']) // macOS's dialog is waited for, so its answer is the answer
const DONE_FOR = 1400

const creature = { name: 'New', avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true }, status: 'idle' }

// ask: what it's for, before macOS has asked. off: where the switch is, once it's a switch.
const WORDS = {
  notifications: {
    title: 'Can I tap you on the shoulder?',
    ask: 'When one of your agents needs you, I’ll say so, even while you’re in another app.',
    off: `Notifications are off for ${PRODUCT_NAME}. Turn on Allow Notifications in System Settings.`,
  },
  microphone: {
    title: 'Can I hear you?',
    ask: 'So you can talk to your agents instead of typing. Your voice stays on this Mac.',
    off: `Turn on ${PRODUCT_NAME} in the Microphone list, then you can talk to your agents.`,
  },
  localNetwork: {
    title: 'Can I look around your network?',
    ask: 'To reach your other computers and your phone on this Wi-Fi.',
    off: `Turn on ${PRODUCT_NAME} in the Local Network list, so your other computers and your phone can reach it.`,
  },
  fullDisk: {
    title: 'Can I work in your folders?',
    off: 'Drag me into the Full Disk Access list, so macOS doesn’t stop your agents to ask each time they read or change a file in Documents, Desktop or Downloads.',
    drag: true,
  },
}

let steps = []
let at = 0
let asking = false // Allow was pressed, and macOS's question may be up
let askedAt = 0
let granted = 0 // came through while this was up: worth saying so at the end
let timer = 0
let drawn = '' // the step on screen: only a new one slides in
let says = '' // what's on screen, to tell when that's out of date

const call = (...args) => crew.call('permissions', ...args)
const current = () => steps[at]

function fitWindow() {
  const r = document.querySelector('.wrap').getBoundingClientRect()
  crew.fit(Math.ceil(r.width), Math.ceil(r.height), false)
}

const stillAsking = () => asking && Date.now() - askedAt < STILL_ASKING
// what the step on screen should say: changes with macOS's answer, and when it's been long enough to stop waiting for it
const saying = () => `${current()?.id}|${current()?.state}|${stillAsking()}`

const dashes = () => `<div class="steps" aria-hidden="true">${steps.map((_, i) => `<i class="${i <= at ? 'on' : ''}"></i>`).join('')}</div>`

function draw() {
  const s = current()
  if (!s) return
  const w = WORDS[s.id]
  const off = s.state === 'off'
  // pressed, and macOS hasn't answered yet: waiting, without a button to press twice
  const waiting = stillAsking()
  const main = w.drag ? 'Open Settings' : off && !waiting ? 'Open Settings' : waiting ? 'Waiting…' : 'Allow'
  box.innerHTML = `<button class="close" data-act="close" title="Not now" aria-label="Not now">${ICONS.close}</button>${dashes()}
    <div class="step${drawn === s.id ? '' : ' enter'}" data-step="${esc(s.id)}">
      ${w.drag ? '' : `<span class="who">${avatarHTML(creature, { size: 56, mood: 'idle' })}</span>`}
      <h1>${esc(w.title)}</h1>
      <p>${esc(off && !waiting ? w.off : w.ask ?? w.off)}</p>
      ${w.drag ? `<div class="me" draggable="true" data-drag title="Drag into the Full Disk Access list"><img src="../assets/icon.png" alt=""><b>${esc(PRODUCT_NAME)}</b><small>Drag me</small></div>` : ''}
      <div class="acts">
        <button class="btn lg" data-act="skip">Not now</button>
        <button class="btn lg brand-btn" data-act="${w.drag || off ? 'open' : 'ask'}" ${waiting && !w.drag ? 'disabled' : ''}>${esc(main)}</button>
      </div>
    </div>`
  drawn = s.id
  says = saying()
  fitWindow()
}

function finish() {
  clearInterval(timer)
  if (!granted) return void call('done')
  box.innerHTML = `${dashes()}<div class="step enter done"><span class="who">${avatarHTML(creature, { size: 56, mood: 'idle', pose: 'pop' })}</span><h1>All set. Thank you!</h1></div>`
  fitWindow()
  setTimeout(() => call('done'), DONE_FOR)
}

function next() {
  at++
  asking = false
  void call('raise').catch(() => {}) // Allow lowered it, for macOS's question
  if (current()) draw()
  else finish()
}

// macOS's answer comes in its own time. The step on screen is redrawn only when what it should say changes, so a press
// on one of its buttons is never lost to a redraw.
async function look() {
  const s = current()
  if (!s) return
  const state = await call('look', s.id).catch(() => s.state)
  if (current() !== s) return // moved on while it looked
  s.state = state
  if (state === 'granted') {
    granted++
    return next()
  }
  if (state === 'unknown') return next()
  if (saying() !== says) draw()
}

async function act(what) {
  const s = current()
  if (!s) return
  if (what === 'close') {
    for (const left of steps.slice(at)) await call('skip', left.id).catch(() => {})
    clearInterval(timer)
    return call('done')
  }
  if (what === 'skip') {
    await call('skip', s.id).catch(() => {})
    if (current() === s) next() // (it may have come through and moved on while that was saved)
    return
  }
  if (what === 'open') return void call('open', s.id).catch(() => {})
  if (what === 'ask') {
    asking = true
    askedAt = Date.now()
    draw()
    const state = await call('ask', s.id).catch(() => s.state)
    if (current() !== s) return
    s.state = state
    if (state === 'granted') {
      granted++
      return next()
    }
    if (ANSWERED_AT_ONCE.has(s.id)) asking = false
    draw()
  }
}

box.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]')
  // a double-click's second press lands on whatever the next step put under the pointer
  if (b && !b.disabled && e.detail < 2) act(b.dataset.act)
})
// the app itself, picked up like a file: main.js starts the drag the operating system carries
box.addEventListener('dragstart', (e) => {
  if (!e.target.closest('[data-drag]')) return
  e.preventDefault()
  crew.dragApp()
})
addEventListener('keydown', (e) => e.key === 'Escape' && act('close'))

call('list', ALL).then(({ missing, hatch }) => {
  document.body.style.setProperty('--notch-h', `${hatch.height}px`)
  steps = missing
  if (!steps.length) {
    // nothing missing, asked for from the menu: says so, so the menu item did something
    box.innerHTML = `<div class="step enter done"><span class="who">${avatarHTML(creature, { size: 56, mood: 'idle', pose: 'pop' })}</span><h1>${esc(PRODUCT_NAME)} has all it asks for.</h1></div>`
    fitWindow()
    setTimeout(() => call('done'), DONE_FOR)
    return
  }
  draw()
  timer = setInterval(look, LOOK_EVERY)
}).catch(() => call('done'))

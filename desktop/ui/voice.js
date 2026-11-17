// Dictation in the chat composer. The mic button (or the voice hotkey) streams the microphone to Apple's
// on-device recognizer (core/voice.js), and what it hears appears in the message box as you talk, words still
// settling included. Click to start and stop, or hold to talk. Enter stops and sends, Esc stops, and typing takes over:
// dictation lets go, keeping what it heard, and the key you pressed lands in the box.
/* global clique, store, esc, keys */

const VOICE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>'

// Dictated words go where the cursor was: a space before them unless the text already ends in one.
function spliceSpoken(before, spoken, after) {
  if (!spoken) return { text: before + after, caret: before.length }
  const gap = before && !/\s$/.test(before) ? ' ' : ''
  const tail = after && !/^[\s.,!?;:]/.test(after) ? ' ' : ''
  const text = before + gap + spoken + tail + after
  return { text, caret: (before + gap + spoken).length }
}

// Settled words, then the ones still changing.
const heard = (e) => [e.final, e.volatile].filter(Boolean).join(e.final && e.volatile && !/^[\s.,!?;:]/.test(e.volatile) ? ' ' : '')

const FINISH_WITHIN = 20000 // a helper that hasn't finished by then never will: keep what it heard and let go

// reveal: called before the hotkey starts dictating, so the message box it fills is on screen.
function mountVoice({ composer, textarea: ta, button, changed, submit, reveal }) {
  // The status line sits in the box's bar, over who it's to and the tools beside it (they keep their space), so nothing
  // moves when you start.
  const bar = document.createElement('div')
  bar.className = 'voice-hint hidden'
  const row = composer.querySelector('.input-bar')
  row.prepend(bar)
  button.innerHTML = `${VOICE_ICON}<span class="meter"><i></i><i></i><i></i><i></i></span><span class="stop"></span>`

  let state = 'idle' // idle | starting | listening | finishing
  let attempt = 0 // each start gets a number; anything that finishes after a newer one (or a stop) lets go
  let id = null // the helper session, once we know it
  let mic = null // { close }
  let before = ''
  let after = ''
  let sendWhenDone = false
  let switchTo = null // a language to carry on in once this session finishes
  let options = null // [{ id, label, installed }]
  let using = '' // the locale the helper actually listens in (from 'ready')
  let early = [] // events that beat our session id here
  let pressedAt = 0
  let placeholder = ''
  let watchdog = null
  let hint = '' // what the status line says outside listening

  const locale = () => store.get('clique.voiceLocale') || ''
  const lang = (code) => String(code).split(/[-_]/)[0]
  const language = () => {
    const want = using || locale()
    return options?.find((o) => o.id === want) ?? options?.find((o) => lang(o.id) === lang(want)) ?? options?.[0]
  }

  const set = (next, text = '') => {
    state = next
    hint = text
    composer.classList.toggle('voice-on', next !== 'idle')
    composer.classList.toggle('voice-starting', next === 'starting')
    composer.classList.toggle('voice-listening', next === 'listening')
    composer.classList.toggle('voice-finishing', next === 'finishing')
    button.setAttribute('aria-pressed', String(next !== 'idle'))
    button.title = next === 'idle' ? `Dictate: click to start, or hold to talk (${keys('⌥⇧D')} from anywhere)` : next === 'finishing' ? 'Stop waiting (Esc)' : 'Stop (Esc) · Enter sends'
    ta.readOnly = next !== 'idle'
    if (next !== 'idle' && !placeholder) (placeholder = ta.placeholder), (ta.placeholder = 'Listening… just talk')
    if (next === 'idle' && placeholder) (ta.placeholder = placeholder), (placeholder = '')
    clearTimeout(watchdog)
    if (next === 'finishing') watchdog = setTimeout(() => state === 'finishing' && giveUp(), FINISH_WITHIN)
    show()
  }

  // The line above the message box: what dictation is doing, who it's for, which language, and the keys.
  function show() {
    const visible = state !== 'idle' || Boolean(hint)
    bar.classList.toggle('hidden', !visible)
    composer.classList.toggle('voice-note', visible)
    if (!visible) return
    // from the bar's left end to the mic, which grows to its left while it listens (its right edge stays)
    bar.style.right = `${Math.round(row.getBoundingClientRect().right - button.getBoundingClientRect().right) + (state === 'idle' ? 28 : 60) + 6}px`
    bar.classList.remove('error')
    if (state !== 'listening') return void (bar.innerHTML = hint)
    const current = language()
    // the language by its code (EN), so the keys beside it always fit; its name is the tooltip
    const code = current ? esc(lang(current.id).toUpperCase()) : ''
    const pick = options?.length > 1 ? `<button class="lang" data-voice="lang" title="${esc(`Listening in ${current?.label ?? 'this language'}: switch language`)}">${code || 'Language'} ⇄</button>` : current ? `<span title="${esc(`Listening in ${current.label}`)}">${code}</span>` : ''
    // who it's for, when the To picker shows a face: the creature tilts its head while you talk
    const to = composer.querySelector('.to-pick .av')
    bar.innerHTML = `<span class="rec"></span><b>Listening</b>${to ? `<span class="to" title="${esc(composer.querySelector('.to-pick b')?.textContent ?? '')}">${to.outerHTML}</span>` : ''}${pick}<span class="grow"></span><span class="keys"><kbd>⏎</kbd> send <kbd>esc</kbd> stop</span>`
  }

  // Back to idle, the microphone closed and the session forgotten (whatever it had typed stays).
  function reset() {
    attempt++
    closeMic()
    id = null
    using = ''
    switchTo = null
    sendWhenDone = false
    set('idle')
  }

  function fail(message) {
    reset()
    set('idle', message === 'mic-denied' ? `<span>${PRODUCT_NAME} needs the microphone.</span><button data-voice="settings">Open Settings</button>` : `<span title="${esc(message)}">${esc(message)}</span>`)
    bar.classList.add('error')
    clearTimeout(fail.timer)
    fail.timer = setTimeout(() => state === 'idle' && ((hint = ''), show()), 8000)
  }

  // Waiting too long for the last words (or you said stop waiting): cancel, keeping what's in the box.
  function giveUp() {
    if (id) clique.call('voiceCancel', id)
    reset()
  }

  function write(e) {
    const { text, caret } = spliceSpoken(before, heard(e), after)
    ta.value = text
    ta.setSelectionRange(caret, caret)
    changed()
  }

  async function start() {
    if (state !== 'idle') return
    const mine = ++attempt
    const current = () => mine === attempt
    if (document.activeElement !== ta) {
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length) // not typing anywhere yet: words go at the end
    }
    before = ta.value.slice(0, ta.selectionStart)
    after = ta.value.slice(ta.selectionEnd)
    sendWhenDone = false
    early = []
    set('starting', '<span class="spin"></span>Getting ready…')
    let session
    try {
      session = await clique.call('voiceStart', locale())
    } catch (e) {
      return current() && fail(e.message)
    }
    if (!current()) return clique.call('voiceCancel', session) // stopped, or started again, while it was starting
    id = session
    clique.voiceAudio(id, new Float32Array(0)) // this window owns the session: closing it ends the session too
    for (const e of early.splice(0)) handle(e)
    if (!current()) return
    let opened
    try {
      opened = await openMic((samples) => clique.voiceAudio(session, samples))
    } catch (e) {
      if (!current()) return
      clique.call('voiceCancel', session)
      return fail(e.name === 'NotAllowedError' ? 'mic-denied' : `Couldn't open the microphone: ${e.message}`)
    }
    if (!current() || state === 'finishing') return opened.close() // nobody's listening for it any more
    mic = opened
    if (!options) {
      clique.call('voiceLocales').then((o) => {
        options = o
        if (state === 'listening') show()
      }, () => {})
    }
  }

  // You're done talking. Enter (send) waits for the last words and sends. While it's already finishing, Esc or
  // a click first calls off a language switch (the last words still come in), and after that stops waiting.
  function stop({ send = false } = {}) {
    if (state === 'idle') return
    if (send) sendWhenDone = true
    if (state === 'finishing') {
      if (send) return
      if (switchTo) return void (switchTo = null)
      return giveUp()
    }
    if (state === 'starting' && !mic) {
      // nothing heard yet: just don't start
      if (id) clique.call('voiceCancel', id)
      return reset()
    }
    finish()
  }

  function finish() {
    closeMic()
    set('finishing', '<span class="spin"></span>Finishing…')
    clique.call('voiceStop', id)
  }

  function closeMic() {
    mic?.close()
    mic = null
    button.style.removeProperty('--lv')
  }

  clique.onVoice(handle)
  function handle(e) {
    if (e.type === 'toggle') return state === 'idle' ? (reveal?.(), start()) : stop()
    if (state === 'starting' && id === null && e.id) return void early.push(e)
    if (e.id !== id) return
    if (e.type === 'building') set(state, '<span class="spin"></span>Setting up voice input (first time only)…')
    else if (e.type === 'installing') set(state, `<span class="spin"></span>Getting ${esc(language()?.label ?? 'the language')} ready${e.progress > 0.01 ? `… ${Math.round(e.progress * 100)}%` : '…'}`)
    else if (e.type === 'ready') {
      using = e.locale
      if (state === 'starting') set('listening')
    } else if (e.type === 'text') write(e)
    else if (e.type === 'done') {
      write({ final: e.text })
      const next = switchTo
      const send = sendWhenDone
      reset()
      ta.focus()
      if (next) store.set('clique.voiceLocale', next)
      if (send) return ta.value.trim() && submit()
      if (next) start() // carry on in the new language
    } else if (e.type === 'error') fail(e.message)
    else if (e.type === 'cancelled') reset()
  }

  // Click to toggle; hold for push-to-talk (let go to stop, even outside the button).
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault() // keep the cursor where it is in the message box
    button.setPointerCapture(e.pointerId)
    pressedAt = Date.now()
    if (state === 'idle') start()
    else stop()
  })
  button.addEventListener('pointerup', () => {
    if (pressedAt && Date.now() - pressedAt > 450 && (state === 'starting' || state === 'listening')) stop()
    pressedAt = 0
  })
  button.addEventListener('click', (e) => e.preventDefault())
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-voice]')?.dataset.voice
    if (act === 'settings') clique.call('voiceSettings')
    if (act === 'lang' && options?.length > 1 && state === 'listening') {
      const at = Math.max(0, options.indexOf(language()))
      switchTo = options[(at + 1) % options.length].id
      finish()
    }
  })
  // A hidden window can't show you what it hears.
  document.addEventListener('visibilitychange', () => document.hidden && stop())

  return {
    start,
    stop,
    // the composer's keys: Enter stops and sends, Esc stops; true when dictation used the key
    key(e) {
      if (state === 'idle') return false
      if (e.key === 'Enter' && !e.shiftKey) stop({ send: true })
      else if (e.key === 'Escape') stop()
      // You'd rather type (the hotkey opens the box listening, to talk or type into): it stops listening, what it heard
      // stays, and the box takes this key. Not once Enter has it finishing: that message is on its way. (AltGr, which
      // types @ and brackets on many keyboards, reads as Ctrl+Alt on Windows.)
      else if (!(state === 'finishing' && sendWhenDone) && !e.metaKey && (!e.ctrlKey || e.getModifierState?.('AltGraph')) && !e.isComposing && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) {
        giveUp()
        return false
      } else return false
      e.preventDefault()
      e.stopPropagation() // Esc ends dictation, not the panel around it
      return true
    },
    busy: () => state !== 'idle',
  }

  // The microphone at 16 kHz through ui/voice-worklet.js; the button's meter follows your voice.
  async function openMic(send) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const ctx = new AudioContext({ sampleRate: 16000 })
    try {
      await ctx.audioWorklet.addModule('voice-worklet.js')
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop())
      ctx.close()
      throw e
    }
    const node = new AudioWorkletNode(ctx, 'clique-mic', { numberOfOutputs: 0 })
    ctx.createMediaStreamSource(stream).connect(node)
    let level = 0
    node.port.onmessage = ({ data }) => {
      send(data.samples)
      // loudness in dB, -55 (quiet room) .. -12 (talking up), eased so the meter breathes instead of flickering
      const db = 20 * Math.log10(data.level + 1e-7)
      const target = Math.min(1, Math.max(0, (db + 55) / 43))
      level += (target - level) * (target > level ? 0.6 : 0.25)
      button.style.setProperty('--lv', level.toFixed(3))
    }
    return {
      close() {
        node.port.onmessage = null
        stream.getTracks().forEach((t) => t.stop())
        ctx.close()
      },
    }
  }
}

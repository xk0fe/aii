// Voice input for the chat: Apple's on-device dictation through a small Swift helper (native/crew-voice.swift),
// built on first use. The chat window streams 16 kHz microphone audio in; what the helper hears comes back as
// events for that window. Speech never leaves the Mac, and it works the same on a computer linked to another
// one's crew, since dictation only fills in your message.
// No Electron in here: main.js hands over the few Electron pieces it needs (see voiceActions).
import { execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

const SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'

export class Voice extends EventEmitter {
  session = null // { id, proc }
  building = null
  seq = 0

  // root: Crew's folder. mayAskPermission: running from an app bundle that explains speech recognition in its
  // Info.plist (Crew.app); only macOS before 26 asks for that.
  constructor({ root, mayAskPermission = false }) {
    super()
    this.source = path.join(root, 'native', 'crew-voice.swift')
    this.binary = path.join(root, 'dist', 'crew-voice')
    this.mayAskPermission = mayAskPermission
  }

  built = () => fs.existsSync(this.binary) && fs.statSync(this.binary).mtimeMs >= fs.statSync(this.source).mtimeMs

  // Compiles the helper when it's missing or older than its source (a few seconds, once).
  ensureBinary() {
    if (this.built()) return Promise.resolve(this.binary)
    this.building ??= new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(this.binary), { recursive: true })
      const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`
      const tmp = `${this.binary}.${process.pid}.tmp`
      execFile('xcrun', ['swiftc', '-O', '-parse-as-library', '-target', target, this.source, '-o', tmp], { timeout: 180000 }, (err, _out, stderr) => {
        this.building = null
        if (err) {
          fs.rmSync(tmp, { force: true })
          const missing = err.code === 'ENOENT' || /xcrun: error|invalid active developer path|unable to find utility/i.test(stderr)
          return reject(new Error(missing ? "Voice input needs Apple's developer tools. Run xcode-select --install in Terminal, then try again." : `Couldn't build voice input: ${String(stderr).trim().split('\n').slice(-3).join(' ')}`))
        }
        fs.renameSync(tmp, this.binary)
        resolve(this.binary)
      })
    })
    return this.building
  }

  // The languages you use that dictation supports, installed ones first: [{ id, label, installed }].
  async locales() {
    const bin = await this.ensureBinary()
    return new Promise((resolve, reject) => {
      execFile(bin, ['--locales'], { timeout: 15000 }, (err, out) => {
        if (err) return reject(err)
        resolve(JSON.parse(String(out).trim().split('\n').pop()).options)
      })
    })
  }

  // Starts listening and returns the session id right away; everything after that (building the helper,
  // getting a language ready, what it hears, problems) arrives as 'event' ({ id, type, ... }).
  // Starting again cancels the session that was running (one microphone, one dictation).
  start(locale) {
    this.cancel()
    const id = ++this.seq
    this.session = { id, proc: null }
    setImmediate(() => this.launch(id, locale)) // the caller learns the id before the first event
    return id
  }

  async launch(id, locale) {
    const live = () => this.session?.id === id
    if (!live()) return
    let bin
    try {
      if (!this.built()) this.emit('event', { id, type: 'building' })
      bin = await this.ensureBinary()
    } catch (err) {
      if (!live()) return
      this.session = null
      return this.emit('event', { id, type: 'error', message: err.message })
    }
    if (!live()) return // cancelled while building
    // one argument, and only a locale-shaped one: nothing a caller passes can turn into another flag
    const args = [`--locale=${/^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$/.test(locale ?? '') ? locale : ''}`]
    if (this.mayAskPermission) args.push('--may-ask-permission')
    const proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] })
    this.session.proc = proc
    proc.stdin.on('error', () => {}) // the helper may exit before we stop writing
    proc.stdout.setEncoding('utf8') // a character split across two reads stays one character
    let pending = ''
    let ended = false
    proc.stdout.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop()
      for (const line of lines) {
        let e
        try {
          e = JSON.parse(line)
        } catch {
          continue
        }
        if (e.type === 'done' || e.type === 'error') ended = true
        this.emit('event', { id, ...e })
      }
    })
    // 'close' comes after the last output. An end we didn't ask for (a crash, any signal) must reach the window,
    // or it would wait for 'done' forever; cancel() lets go of the session before it kills, so it's not one.
    proc.on('close', (code, signal) => {
      if (!ended && live()) this.emit('event', { id, type: 'error', message: `Voice input stopped unexpectedly (${signal ?? code})` })
      if (live()) this.session = null
    })
    proc.on('error', (err) => this.emit('event', { id, type: 'error', message: err.message }))
    for (const b of this.session.early ?? []) proc.stdin.write(b)
    this.session.early = null
    if (this.session.stopping) proc.stdin.end() // stopped while it was building
  }

  // 16 kHz mono Float32 samples from the chat window. Audio that arrives before the helper is running waits,
  // so the first words aren't lost.
  write(id, samples) {
    const s = this.session?.id === id ? this.session : null
    if (!s || !samples?.length) return
    const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
    if (!s.proc) return void (s.early ??= []).push(bytes)
    if (s.proc.stdin.writable) s.proc.stdin.write(bytes)
  }

  // Stop listening: the helper finishes what it heard and sends 'done'.
  stop(id) {
    const s = this.session
    if (!s || (id !== undefined && s.id !== id)) return
    if (s.proc) s.proc.stdin.end()
    else s.stopping = true // still building: it finishes what it heard once it's up
  }

  // Drop the session without a transcript.
  cancel(id) {
    const s = this.session
    if (!s || (id !== undefined && s.id !== id)) return
    this.session = null
    s.proc?.kill()
    this.emit('event', { id: s.id, type: 'cancelled' })
  }
}

// The crew.call() actions behind the chat's mic button. main.js passes Electron's systemPreferences and shell,
// and a send(event) that reaches every window (each composer only listens to the session it started).
export function voiceActions({ voice, systemPreferences, shell, send }) {
  voice.on('event', send)
  return {
    // The microphone first: macOS asks once, and remembers a "no" until you change it in System Settings.
    voiceStart: async (locale) => {
      const status = systemPreferences.getMediaAccessStatus('microphone')
      const allowed = status === 'granted' || (status === 'not-determined' && (await systemPreferences.askForMediaAccess('microphone')))
      if (!allowed) throw new Error('mic-denied')
      return voice.start(locale)
    },
    voiceStop: (id) => voice.stop(id),
    voiceCancel: (id) => voice.cancel(id),
    voiceLocales: () => voice.locales(),
    voiceSettings: () => shell.openExternal(SETTINGS),
  }
}

// The audio channel. The first chunk of a session (the composer sends an empty one as soon as it has its id)
// makes the window that sent it the session's owner: if that window closes, reloads or crashes mid-dictation,
// the session ends with it instead of leaving the helper waiting. sender: an Electron webContents.
export function voiceAudio(voice) {
  const owned = new Map() // session id -> release()
  voice.on('event', (e) => {
    if (['done', 'error', 'cancelled'].includes(e.type)) owned.get(e.id)?.()
  })
  return (sender, id, samples) => {
    if (!owned.has(id) && voice.session?.id === id) {
      const drop = () => voice.cancel(id)
      const gone = ['destroyed', 'render-process-gone', 'did-start-loading'] // closed, crashed, reloaded
      for (const ev of gone) sender.on(ev, drop)
      owned.set(id, () => {
        for (const ev of gone) sender.off(ev, drop)
        owned.delete(id)
      })
    }
    voice.write(id, samples)
  }
}

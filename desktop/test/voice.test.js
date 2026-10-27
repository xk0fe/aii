// Voice input end to end below the UI: core/voice.js builds the Swift helper, then a sentence spoken by `say`
// is streamed in at talking speed, the way the chat window streams the microphone, and must come back as text.
// macOS 26+ with Apple's developer tools only (skipped elsewhere). Builds into a throwaway folder.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Voice } from '../core/voice.js'

const A = path.resolve(import.meta.dirname, '..')
const can = (() => {
  if (process.platform !== 'darwin' || Number(os.release().split('.')[0]) < 25) return 'needs macOS 26'
  try {
    execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' })
  } catch {
    return "needs Apple's developer tools"
  }
  return true
})()

// A throwaway root with the real Swift source, so the build lands in its own dist/ (built once, shared).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-voice-'))
fs.mkdirSync(path.join(root, 'native'))
fs.copyFileSync(path.join(A, 'native', 'crew-voice.swift'), path.join(root, 'native', 'crew-voice.swift'))
after(() => fs.rmSync(root, { recursive: true, force: true }))

// 16 kHz mono Float32 samples of `text` spoken by macOS.
function speak(dir, text) {
  const wav = path.join(dir, 'speech.wav')
  execFileSync('say', ['-v', 'Samantha', '-o', wav, '--data-format=LEF32@16000', text])
  const buf = fs.readFileSync(wav)
  const at = buf.indexOf('data') + 8
  return new Float32Array(buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + buf.length - ((buf.length - at) % 4)))
}

const until = (voice, id, type) =>
  new Promise((resolve) => {
    const seen = []
    voice.on('event', (e) => {
      if (e.id !== id) return
      seen.push(e)
      if (e.type === type || e.type === 'error') resolve(seen)
    })
  })

test('dictation: talking-speed audio in, the sentence back, live words along the way', { skip: can !== true && can, timeout: 240000 }, async () => {
  const voice = new Voice({ root })
  const samples = speak(root, 'Hey Joseph, please hand the release notes to David.')
  const id = await voice.start('en-US')
  const events = until(voice, id, 'done')
  for (let i = 0; i < samples.length; i += 1600) {
    voice.write(id, samples.subarray(i, i + 1600)) // 100 ms at a time
    await new Promise((r) => setTimeout(r, 25)) // faster than real time, still a stream
  }
  voice.stop(id)
  const seen = await events
  const error = seen.find((e) => e.type === 'error')
  assert.equal(error, undefined, error?.message)
  assert.ok(seen.some((e) => e.type === 'ready'), 'it says when it is listening')
  assert.ok(seen.some((e) => e.type === 'text' && e.volatile), 'words show up while you talk, before they settle')
  const done = seen.at(-1)
  assert.equal(done.type, 'done')
  assert.match(done.text, /joseph/i)
  assert.match(done.text, /david/i)
  assert.match(done.text, /release notes/i)
})

test('dictation: cancel drops the session, a new start replaces the old one', { skip: can !== true && can, timeout: 240000 }, async () => {
  const voice = new Voice({ root })
  const first = await voice.start('en-US')
  const cancelled = until(voice, first, 'cancelled')
  const second = await voice.start('en-US') // one microphone: the first session ends
  assert.notEqual(first, second)
  assert.equal((await cancelled).at(-1).type, 'cancelled')
  const gone = until(voice, second, 'cancelled')
  voice.cancel(second)
  assert.equal((await gone).at(-1).type, 'cancelled')
  assert.equal(voice.session, null)
  voice.write(second, new Float32Array(1600)) // audio after the end goes nowhere, without throwing
})

test('dictation: the languages offered are ones dictation supports, installed first', { skip: can !== true && can, timeout: 240000 }, async () => {
  const options = await new Voice({ root }).locales()
  assert.ok(options.length > 0)
  for (const o of options) assert.ok(o.id && o.label && typeof o.installed === 'boolean', JSON.stringify(o))
  const firstMissing = options.findIndex((o) => !o.installed)
  if (firstMissing >= 0) assert.ok(options.slice(firstMissing).every((o) => !o.installed))
})

// The rest runs anywhere: a shell script stands in for the helper, so these check core/voice.js itself.
function fakeHelper(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-voice-fake-'))
  fs.mkdirSync(path.join(dir, 'native'))
  fs.mkdirSync(path.join(dir, 'dist'))
  fs.writeFileSync(path.join(dir, 'native', 'crew-voice.swift'), '// stand-in')
  const bin = path.join(dir, 'dist', 'crew-voice')
  fs.writeFileSync(bin, `#!/bin/sh\n${script}\n`, { mode: 0o755 })
  fs.utimesSync(bin, new Date(Date.now() + 60000), new Date(Date.now() + 60000)) // newer than its "source": no build
  after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return new Voice({ root: dir })
}

test('dictation: a helper that dies by a signal still ends the session with an error', { timeout: 10000 }, async () => {
  const voice = fakeHelper(`printf '{"type":"ready","locale":"en_US"}\\n'; kill -ABRT $$`)
  const id = voice.start('en_US')
  const seen = await until(voice, id, 'error')
  assert.equal(seen.at(-1).type, 'error', 'otherwise the window waits for "done" forever')
  assert.match(seen.at(-1).message, /stopped unexpectedly/)
  assert.equal(voice.session, null)
})

test('dictation: text split mid-character across reads arrives intact', { timeout: 10000 }, async () => {
  // "Привет" with its first letter's two UTF-8 bytes in separate writes
  const voice = fakeHelper(`printf '{"type":"done","text":"\\320'; sleep 0.2; printf '\\237ривет"}\\n'`)
  const id = voice.start('ru_RU')
  const seen = await until(voice, id, 'done')
  assert.equal(seen.at(-1).text, 'Привет')
})

test('dictation: a locale can only ever be a locale, never another flag', { timeout: 10000 }, async () => {
  const voice = fakeHelper(`printf '{"type":"done","text":"%s"}\\n' "$*"`)
  let id = voice.start('--may-ask-permission')
  assert.equal((await until(voice, id, 'done')).at(-1).text, '--locale=')
  id = voice.start('pt_BR')
  assert.equal((await until(voice, id, 'done')).at(-1).text, '--locale=pt_BR')
})

test('dictation: closing or reloading the window that owns a session ends it', { timeout: 10000 }, async () => {
  const { voiceAudio } = await import('../core/voice.js')
  const { EventEmitter } = await import('node:events')
  const voice = fakeHelper('cat > /dev/null; printf \'{"type":"done","text":""}\\n\'')
  const audio = voiceAudio(voice)
  const win = new EventEmitter()
  const id = voice.start('en_US')
  audio(win, id, new Float32Array(0)) // the composer claims its session right away
  assert.ok(win.listenerCount('destroyed') > 0)
  const ended = until(voice, id, 'cancelled')
  win.emit('did-start-loading') // a reload
  assert.equal((await ended).at(-1).type, 'cancelled')
  assert.equal(win.listenerCount('destroyed') + win.listenerCount('did-start-loading'), 0, 'listeners are let go with the session')
})

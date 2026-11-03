// Does a built crew-voice hear speech? A sentence spoken by the computer's own text-to-speech is streamed in through
// core/voice.js, 100 ms at a time the way the chat sends the microphone, and has to come back as text; then silence has
// to come back as nothing. CI runs it on Windows after the build; it works with the Mac helper too.
//   node native/windows/smoke.mjs dist/voice/win-x64/crew-voice.exe
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Voice } from '../../core/voice.js'

const binary = path.resolve(process.argv[2] ?? '')
if (!fs.existsSync(binary)) throw new Error(`no helper at ${binary}`)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-voice-smoke-'))
const SENTENCE = 'Hey June, please hand the release notes to Ada.'

// 16 kHz mono samples of `text`, from Windows' System.Speech or macOS's say; null when there's no voice to speak it
function speak(text) {
  const wav = path.join(dir, 'speech.wav')
  try {
    if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
        $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono);
        $s.SetOutputToWaveFile('${wav}', $f); $s.Speak('${text}'); $s.Dispose()`
      execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' })
    } else execFileSync('say', ['-o', wav, '--data-format=LEI16@16000', text])
  } catch (e) {
    console.log(`::warning::no text-to-speech here to test with (${e.message.split('\n')[0]})`)
    return null
  }
  const buf = fs.readFileSync(wav)
  const at = buf.indexOf('data') + 8
  const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + buf.length - ((buf.length - at) % 2)))
  return Float32Array.from(pcm, (v) => v / 32768)
}

async function dictate(samples) {
  const voice = new Voice({ root: dir, binary })
  const seen = []
  const id = voice.start('en-US')
  const over = new Promise((resolve) => voice.on('event', (e) => e.id === id && seen.push(e) && ['done', 'error'].includes(e.type) && resolve()))
  for (let i = 0; i < samples.length; i += 1600) {
    voice.write(id, samples.subarray(i, i + 1600))
    await new Promise((r) => setTimeout(r, 25)) // four times talking speed
  }
  voice.stop(id)
  await over
  return seen
}

const check = (ok, what) => {
  if (!ok) throw new Error(what)
  console.log(`ok: ${what}`)
}

const samples = speak(SENTENCE)
if (samples) {
  const seen = await dictate(samples)
  for (const e of seen) console.log(JSON.stringify(e))
  const done = seen.at(-1)
  check(seen.some((e) => e.type === 'ready'), 'it says when it is listening')
  check(done.type === 'done', `it finishes (${done.message ?? done.type})`)
  check(/june/i.test(done.text) && /release notes/i.test(done.text), `it heard the sentence: "${done.text}"`)
}
const quiet = (await dictate(new Float32Array(16000 * 4))).at(-1)
check(quiet.type === 'done' && quiet.text === '', `silence is no text, not made-up words: "${quiet.text ?? quiet.message}"`)
fs.rmSync(dir, { recursive: true, force: true })

// Microphone -> dictation audio: 50 ms chunks of 16 kHz mono Float32 (the AudioContext already runs at 16 kHz),
// each with its loudness for the mic button's meter. Runs on the audio thread (see ui/voice.js).
const CHUNK = 800

class CliqueMic extends AudioWorkletProcessor {
  buf = new Float32Array(CHUNK)
  n = 0

  process([input]) {
    const samples = input?.[0]
    if (!samples) return true
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.n++] = samples[i]
      if (this.n < CHUNK) continue
      let sum = 0
      for (let j = 0; j < CHUNK; j++) sum += this.buf[j] * this.buf[j]
      this.port.postMessage({ samples: this.buf, level: Math.sqrt(sum / CHUNK) }, [this.buf.buffer])
      this.buf = new Float32Array(CHUNK)
      this.n = 0
    }
    return true
  }
}

registerProcessor('clique-mic', CliqueMic)

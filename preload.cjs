// The only bridge between the UI pages and the app: pages use window.crew.
const { contextBridge, ipcRenderer } = require('electron')

const listen = (channel) => (fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args))

contextBridge.exposeInMainWorld('crew', {
  // Runs one of the `actions` in main.js and returns its result (or throws its error).
  call: async (action, ...args) => {
    const res = await ipcRenderer.invoke('call', action, ...args)
    if (res.error) throw new Error(res.error)
    return res.ok
  },
  input: (name, data) => ipcRenderer.send('input', name, data),
  fit: (width, height, focus) => ipcRenderer.send('fit', width, height, focus),
  onState: listen('state'),
  onPty: listen('pty'),
  onFocus: listen('focus'),
  onToggle: listen('toggle'),
  onImport: listen('import'),
  // Dictation: microphone audio out (16 kHz Float32 chunks), what it heard back (see core/voice.js).
  voiceAudio: (id, samples) => ipcRenderer.send('voice-audio', id, samples),
  onVoice: listen('voice'),
})

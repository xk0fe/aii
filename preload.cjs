// The only bridge between the UI pages and the app: pages use window.crew.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const listen = (channel) => (fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args))

contextBridge.exposeInMainWorld('crew', {
  // Runs one of the `actions` in main.js and returns its result (or throws its error).
  call: async (action, ...args) => {
    const res = await ipcRenderer.invoke('call', action, ...args)
    if (res.error) throw new Error(res.error)
    return res.ok
  },
  input: (name, data) => ipcRenderer.send('input', name, data),
  // Where a file or folder dropped on the page is on disk.
  pathOf: (file) => webUtils.getPathForFile(file),
  // Size the window around the page; the floating pill also says where it sits inside, so it stays put.
  fit: (width, height, focus, pill) => ipcRenderer.send('fit', width, height, focus, pill),
  // The floating pill: drag it (start / move / end, pointer in screen coordinates), and hear which side of it
  // the chat goes on.
  drag: (phase, x, y) => ipcRenderer.send('drag', phase, x, y),
  onPlace: listen('place'),
  onState: listen('state'),
  onPty: listen('pty'),
  onFocus: listen('focus'),
  onToggle: listen('toggle'),
  onImport: listen('import'),
  // Dictation: microphone audio out (16 kHz Float32 chunks), what it heard back (see core/voice.js).
  voiceAudio: (id, samples) => ipcRenderer.send('voice-audio', id, samples),
  onVoice: listen('voice'),
})

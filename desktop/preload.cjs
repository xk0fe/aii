// The only bridge between the UI pages and the app: pages use window.crew.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const listen = (channel) => (fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args))
// main.js passes these to every page (webPreferences.additionalArguments): --crew-home=<your home folder>, and --crew-dev
// when Crew runs unpackaged (npm run dev).
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

contextBridge.exposeInMainWorld('crew', {
  // Which computer this is: 'darwin' or 'win32'. The pages use it for keys (⌘ or Ctrl), words (this Mac or this PC) and
  // paths; your home folder shows as ~.
  platform: process.platform,
  home: arg('crew-home') ?? '',
  // Running from source: the developer's extras (Open config.json) show.
  dev: process.argv.includes('--crew-dev'),
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

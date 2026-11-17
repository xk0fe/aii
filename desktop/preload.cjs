// The only bridge between the UI pages and the app: pages use window.clique.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const listen = (channel) => (fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args))
// main.js passes these to every page (webPreferences.additionalArguments): --clique-home=<your home folder>, and --clique-dev
// when CLIque runs unpackaged (npm run dev).
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

contextBridge.exposeInMainWorld('clique', {
  // Which computer this is: 'darwin' or 'win32'. The pages use it for keys (⌘ or Ctrl), words (this Mac or this PC) and
  // paths; your home folder shows as ~.
  platform: process.platform,
  home: arg('clique-home') ?? '',
  // Running from source: the developer's extras (Open config.json) show.
  dev: process.argv.includes('--clique-dev'),
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
  // Under the mouse: which way the wisp is going (degrees) and how fast (0 to 1), for its tail (core/follow.js).
  onTrail: listen('trail'),
  // The permissions flow: this app, as a file being dragged, into a list in System Settings.
  dragApp: () => ipcRenderer.send('drag-app'),
  // What this page has open, so nothing notifies you about the place you're looking at (core/notify.js).
  looking: (view) => ipcRenderer.send('looking', view),
  onState: listen('state'),
  onPty: listen('pty'),
  onFocus: listen('focus'),
  onToggle: listen('toggle'),
  onImport: listen('import'),
  // Dictation: microphone audio out (16 kHz Float32 chunks), what it heard back (see core/voice.js).
  voiceAudio: (id, samples) => ipcRenderer.send('voice-audio', id, samples),
  onVoice: listen('voice'),
})

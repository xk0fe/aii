// Silence for the scripts that drive windows with made-up input (the shots, and the probes `npm test` runs). On a Mac,
// Electron hands a key the page didn't take back to AppKit (to the menu, then the window), and AppKit answers a key
// nobody wants with the alert sound: a beep for every made-up keystroke, on whoever's computer runs them, while they
// work. Every page these scripts open ignores the menu's shortcuts, which ends that hand-back before it starts
// (Electron's WebContents::PlatformHandleKeyboardEvent; nothing here presses a shortcut), and is muted, so nothing a
// page plays reaches the speakers either. Imported first, before any window is made.
import { app } from 'electron'

app.on('web-contents-created', (_e, contents) => {
  contents.setIgnoreMenuShortcuts(true)
  contents.setAudioMuted(true)
})

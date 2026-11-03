// The app's name and id, in one place. PRODUCT_NAME is what people see: the app and its windows, the menus, the
// installers (the UI's own copy is in ui/brand.js). The `crew` command, the ~/.crew folder, CREW_* variables and the
// id below keep their names.
export const PRODUCT_NAME = 'CLIque'

// The app id: the macOS bundle id, the Windows AppUserModelID (notifications, the taskbar) and the installers'
// identity. Changing it later makes the OS treat the app as a different one (microphone permission, .crew files,
// updates), so it's set once, here. Placeholder until the owner confirms the final id.
export const APP_ID = 'com.greengrass.crew'

// Electron's folder for the app (userData: the windows' local storage, the one-at-a-time lock, caches), which it names
// after the app. It was "Crew" before the rename and stays so: renaming it would lose every view setting, and let a
// renamed copy run beside an older one. main.js pins it before anything reads it.
export const USER_DATA = 'Crew'

// The app's name and id, in one place. PRODUCT_NAME is what people see: the app and its windows, the menus, the
// installers (the UI's own copy is in ui/brand.js). The command agents run is `clique`, its folder ~/.clique, its
// variables CLIQUE_*. (It was Crew once: core/home.js and core/migrate.js carry an older install over.)
export const PRODUCT_NAME = 'CLIque'

// The app id: the macOS bundle id, the Windows AppUserModelID (notifications, the taskbar) and the installers'
// identity. The OS treats an app with another id as another app (its permissions, its .clique files, its updates), so
// it's set once, here.
export const APP_ID = 'com.greengrass.clique'

// Electron's folder for the app (userData: the windows' local storage, the one-at-a-time lock, caches), which it names
// after the app. main.js pins it before anything reads it, and moves an older install's there first.
export const USER_DATA = 'CLIque'

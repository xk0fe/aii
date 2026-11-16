// Open at login: one switch, kept by the system itself (macOS's Login Items, Windows' Startup apps), so what CLIque
// shows is what the system will do, also after you change it there. Off unless you turn it on.
//
// CLIque opened this way stays out of the way: its icon in the menu bar (the notification area on Windows) and the
// pill, no window. On Windows the system starts it with --login so CLIque can tell; a Mac doesn't say (macOS 13 and up),
// and doesn't need to: there CLIque only ever opens a window by itself on a first run.
export const LOGIN_ARG = '--login'

// app: Electron's. Only an installed CLIque registers itself: from source it would register Electron.
export function loginItem({ app, platform = process.platform, packaged = app.isPackaged, argv = process.argv }) {
  const supported = packaged && (platform === 'darwin' || platform === 'win32')
  const mine = platform === 'win32' ? { args: [LOGIN_ARG] } : {}
  const read = () => {
    if (!supported) return false
    const s = app.getLoginItemSettings(mine)
    // Windows: on, and not turned off again in Task Manager's Startup apps
    return Boolean(platform === 'win32' ? s.executableWillLaunchAtLogin ?? s.openAtLogin : s.openAtLogin)
  }
  let on = read()
  return {
    supported,
    get on() {
      return on
    },
    refresh: () => (on = read()),
    set(want) {
      if (!supported) throw new Error('Only an installed CLIque can open at login.')
      app.setLoginItemSettings({ openAtLogin: Boolean(want), ...mine })
      return (on = read())
    },
    // Was CLIque opened by the system at login, rather than by you?
    opened: () => (platform === 'win32' ? argv.includes(LOGIN_ARG) : Boolean(supported && app.getLoginItemSettings().wasOpenedAtLogin)),
  }
}

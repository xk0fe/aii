// Crew's app id, in one place: the macOS bundle id, the Windows AppUserModelID (notifications, the taskbar) and the
// installers' identity. Changing it later makes the OS treat Crew as a different app (microphone permission, .crew
// files, updates), so it's set once, here. Placeholder until the owner confirms the final id.
export const APP_ID = 'com.greengrass.crew'

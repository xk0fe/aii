// The app's config: everything `npx expo prebuild` writes into ios/ and android/ comes from here (those folders are
// generated, never edited). The name and the store id come from src/brand.js.
//
// A bundle id belongs to one Apple team, so a build signed with your own team needs an id of your own: CLIQUE_BUNDLE_ID
// and CLIQUE_APPLE_TEAM set them for that build, and nothing else changes.
//   CLIQUE_BUNDLE_ID=com.you.clique CLIQUE_APPLE_TEAM=ABCDE12345 npx expo run:ios --device
const { withAndroidManifest } = require('expo/config-plugins')

const { APP_NAME, APP_ID } = require('./src/brand')

// The camera permission would make Google Play hide the app from devices without a back camera; pairing works by
// pasting the code too, so the camera is optional.
const cameraOptional = (config) =>
  withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest
    const features = (manifest['uses-feature'] ??= [])
    for (const name of ['android.hardware.camera', 'android.hardware.camera.autofocus']) {
      if (!features.some((f) => f.$['android:name'] === name)) features.push({ $: { 'android:name': name, 'android:required': 'false' } })
    }
    return c
  })

const VERSION = '1.0.0'
// One more for every build uploaded to a store: App Store Connect and Google Play refuse a number they've seen.
const BUILD = 1

// The splash, and what shows before the first screen: the app's own page colours (ui/theme.ts bg), with the icon's C
// mark on them, so the first screen arrives on the same ground.
const SPLASH = { light: '#F2F2F7', dark: '#000000' }
// The icon's tile (desktop/scripts/make-icon.mjs draws the icon and every picture here: --phone assets/images)
const ICON_GROUND = '#161618'

module.exports = () => ({
  name: APP_NAME,
  slug: 'clique',
  version: VERSION,
  orientation: 'portrait',
  icon: './assets/images/icon.png', // full bleed, no corners: the system masks it
  scheme: 'clique',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#F2F2F7',
  ios: {
    bundleIdentifier: process.env.CLIQUE_BUNDLE_ID || APP_ID,
    ...(process.env.CLIQUE_APPLE_TEAM && { appleTeamId: process.env.CLIQUE_APPLE_TEAM }),
    buildNumber: String(BUILD),
    supportsTablet: false,
    infoPlist: {
      // iOS asks once, in these words, before the phone may reach the computer on the same Wi-Fi
      NSLocalNetworkUsageDescription: `${APP_NAME} connects to ${APP_NAME} on your computer over your Wi-Fi, so you can see your clique and answer them from your phone.`,
      // the computer is on the local network or Tailscale; the phone and the computer encrypt everything themselves
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      // Export compliance. The app does its own encryption with standard algorithms (X25519, HKDF-SHA256,
      // ChaCha20-Poly1305), only to talk to your own computer. Apple asks for no documents for that unless the app is
      // on the App Store in France (a French encryption declaration), and the US needs no filing for a mass-market app
      // like this (EAR 740.17(b)(1); no self-classification report since 2021). So NO holds while France is left out of
      // the App Store's availability. To ship in France: file the declaration, then set YES and add
      // ITSEncryptionExportComplianceCode with the code App Store Connect gives you. See store/README.md.
      ITSAppUsesNonExemptEncryption: false,
    },
    // The app collects nothing and tracks nothing. The "required reason" APIs it uses come from React Native and Expo
    // (each module ships its own manifest too): settings in UserDefaults, file dates in the app's own files, the boot
    // clock for timing, the free disk space before writing.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1', '0A2A.1', '3B52.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'] },
      ],
    },
  },
  android: {
    package: APP_ID, // can never change once the app is on Google Play
    versionCode: BUILD,
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
      backgroundColor: ICON_GROUND,
    },
    // The camera for the pairing code; a little vibration when you answer (INTERNET comes with React Native).
    permissions: ['android.permission.CAMERA', 'android.permission.VIBRATE'],
    // What modules would add that the app never uses: no microphone, no files, no drawing over other apps.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    // the brand face, built into the app (no loading at launch)
    ['expo-font', { fonts: ['./assets/fonts/Fredoka-SemiBold.ttf', './assets/fonts/Fredoka-Bold.ttf'] }],
    [
      'expo-splash-screen',
      {
        backgroundColor: SPLASH.light,
        image: './assets/images/splash-icon.png',
        imageWidth: 160,
        dark: { backgroundColor: SPLASH.dark, image: './assets/images/splash-icon-dark.png' },
      },
    ],
    ['expo-camera', { cameraPermission: `${APP_NAME} uses the camera to scan the pairing code your computer shows.`, microphonePermission: false, recordAudioAndroid: false }],
    ['expo-secure-store', { faceIDPermission: false }],
    [
      'expo-build-properties',
      {
        // The phone opens a plain WebSocket (ws://) to your computer at whatever address your Wi-Fi or Tailscale gave it,
        // and encrypts every message itself. Android can't allow plain connections by address range, only by name, so
        // it's allowed for the app.
        android: { usesCleartextTraffic: true },
      },
    ],
    cameraOptional,
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
})

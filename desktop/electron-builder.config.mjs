// How CLIque is packaged for people to install (electron-builder): CLIque.app as a DMG and a zip for Apple Silicon and
// Intel, and a per-user Windows installer for x64 and arm64. scripts/dist.mjs runs it (npm run dist). The name is
// PRODUCT_NAME (core/appid.js).
//
// Signing switches on from the environment alone; nothing in here changes for it:
//   macOS    CSC_LINK + CSC_KEY_PASSWORD: the Developer ID Application certificate (.p12, as a path or base64), or
//            CSC_NAME: one already in the keychain. Notarization: APPLE_API_KEY (path to the .p8) + APPLE_API_KEY_ID +
//            APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID.
//            Without a certificate CLIque.app is signed ad hoc: it runs, but Gatekeeper warns on other Macs.
//   Windows  WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD: an Authenticode .pfx, or Azure Trusted Signing with
//            AZURE_SIGN_ENDPOINT + AZURE_SIGN_ACCOUNT + AZURE_SIGN_PROFILE (and AZURE_TENANT_ID, AZURE_CLIENT_ID,
//            AZURE_CLIENT_SECRET for the account). Without either the installer is unsigned and SmartScreen warns.
//   RELEASE_REPO=owner/name: the public GitHub repo releases go to, written into the update metadata.
import { APP_ID, PRODUCT_NAME } from './core/appid.js'
import { afterPack } from './scripts/after-pack.mjs'

const env = process.env
const macCertificate = Boolean(env.CSC_LINK || env.CSC_NAME)
const notarize = macCertificate && Boolean((env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) || (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID))
const azure = env.AZURE_SIGN_ENDPOINT && env.AZURE_SIGN_ACCOUNT && env.AZURE_SIGN_PROFILE
const [owner, repo] = (env.RELEASE_REPO ?? '').split('/')

// What goes into the app: the code and its dependencies, not the tests, scripts or sources of native parts, and of
// node-pty's prebuilt binaries only the one for the platform (darwin, win32) and arch being built. Windows' tools for
// agents (bin/win32-x64, bin/win32-arm64: crew.exe and co.) go only into the Windows app, the one for its arch. Given
// whole to each platform: electron-builder lets a platform's list replace the top-level one rather than add to it.
const files = (platform) => [
  'package.json',
  'main.js',
  'preload.cjs',
  'core/**',
  'ui/**',
  'bin/**',
  platform === 'win32' ? '!bin/win32-!(${arch})/**' : '!bin/win32-*/**',
  '!bin/.gitattributes',
  'assets/*.png',
  ...(platform === 'win32' ? ['assets/icon.ico'] : []), // the window and tray icon at run time, not only the installer's
  `!node_modules/node-pty/prebuilds/!(${platform}-\${arch})/**`,
  '!node_modules/node-pty/{src,deps,third_party,scripts,typings}/**',
  '!node_modules/node-pty/binding.gyp',
  '!node_modules/node-pty/lib/**/*.test.js',
  '!node_modules/node-addon-api/**',
  '!**/*.{pdb,map}',
]

export default {
  appId: APP_ID,
  // The name on the app, its windows, shortcuts and installers. Two folders keep their names from before the rename:
  // the Windows install folder, which a per-user one-click installer names after package.json's name
  // (%LOCALAPPDATA%\Programs\crew), and Electron's own folder for the app (userData, pinned in main.js).
  productName: PRODUCT_NAME,
  copyright: `© ${new Date().getFullYear()} Greengrass`,
  directories: { output: 'release', buildResources: 'build' },
  artifactName: `${PRODUCT_NAME}-\${version}-\${os}-\${arch}.\${ext}`,

  asar: true,
  // Files something outside Crew's own JavaScript runs: node-pty's helpers (spawn-helper on macOS; conpty.dll,
  // OpenConsole.exe and winpty-agent.exe on Windows), bin/, which agents get on their PATH, and the terminal host,
  // which runs as Node outside the app (core/ptyclient.js; on Windows copied out with node-pty, so updates can replace
  // Crew's files while agents keep running).
  asarUnpack: ['node_modules/node-pty/**', 'bin/**', 'core/ptyhost.js'],
  // node-pty ships N-API prebuilds for every platform Crew does: nothing to compile.
  npmRebuild: false,
  nodeGypRebuild: false,
  // Dictation's helper, built beforehand by scripts/build-voice.mjs: Resources/voice/crew-voice(.exe). Then Crew's
  // license, and the licenses of the open source software in it (scripts/notices.mjs), beside Electron's own.
  extraResources: [
    { from: 'dist/voice/${os}-${arch}', to: 'voice' },
    { from: '../LICENSE', to: 'LICENSE.txt' },
    { from: 'THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' },
  ],
  afterPack,

  // .crew agent packs open in the app (Finder and Mail on macOS, Explorer on Windows)
  fileAssociations: [{ ext: 'crew', name: `${PRODUCT_NAME} agents`, description: `${PRODUCT_NAME} agents`, role: 'Viewer', rank: 'Owner' }],

  electronFuses: {
    // The terminal host is Crew's own binary run as Node (core/ptyclient.js): this one has to stay on.
    runAsNode: true,
    // Crew itself takes no Node options or debugger flags from outside, and only runs the code in app.asar.
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
  },

  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'assets/icon.icns',
    files: files('darwin'),
    target: ['dmg', 'zip'],
    hardenedRuntime: true,
    identity: macCertificate ? undefined : '-',
    entitlements: macCertificate ? 'build/entitlements.mac.plist' : 'build/entitlements.adhoc.plist',
    entitlementsInherit: macCertificate ? 'build/entitlements.mac.plist' : 'build/entitlements.adhoc.plist',
    notarize,
    // What macOS shows when the app first asks for the microphone, speech recognition (dictation, before macOS 26) and
    // the local network (linked computers, phones)
    extendInfo: {
      NSMicrophoneUsageDescription: `${PRODUCT_NAME} listens while you dictate a message to your agents.`,
      NSSpeechRecognitionUsageDescription: `${PRODUCT_NAME} turns what you say into text, on this Mac.`,
      NSLocalNetworkUsageDescription: `${PRODUCT_NAME} connects to your other computers and your phone on this network.`,
    },
  },
  win: {
    icon: 'assets/icon.ico',
    files: files('win32'),
    target: ['nsis'],
    executableName: PRODUCT_NAME,
    ...(azure && {
      azureSignOptions: {
        endpoint: env.AZURE_SIGN_ENDPOINT,
        codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
        certificateProfileName: env.AZURE_SIGN_PROFILE,
        publisherName: env.AZURE_SIGN_PUBLISHER || 'Greengrass',
      },
    }),
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    shortcutName: PRODUCT_NAME,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    include: 'build/installer.nsh',
    artifactName: `${PRODUCT_NAME}-Setup-\${version}-\${arch}.\${ext}`,
  },

  publish: owner && repo ? [{ provider: 'github', owner, repo, releaseType: 'draft' }] : null,
}

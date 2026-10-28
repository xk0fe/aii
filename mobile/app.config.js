// app.json is the app's config. A bundle id belongs to one Apple team, so a build signed with your own team needs an id
// of your own: CREW_BUNDLE_ID and CREW_APPLE_TEAM set them for that build, and nothing else changes.
//   CREW_BUNDLE_ID=com.you.crew CREW_APPLE_TEAM=ABCDE12345 npx expo run:ios --device
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    ...(process.env.CREW_BUNDLE_ID && { bundleIdentifier: process.env.CREW_BUNDLE_ID }),
    ...(process.env.CREW_APPLE_TEAM && { appleTeamId: process.env.CREW_APPLE_TEAM }),
  },
})

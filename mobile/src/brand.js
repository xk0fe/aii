// What the app is called and its id in the stores, in one place: app.config.js (the home screen, the stores) and the
// screens (the wordmark, About) both read it, so a rename is a one-line change here.
//
// APP_ID is the iOS bundle id and the Android package. It's a placeholder until the stores' accounts exist; whatever it
// is when the app is first uploaded to Google Play, the Android package can never change after that (a new package
// is a new app). CREW_BUNDLE_ID still overrides the iOS one for a build signed with your own team (app.config.js).
module.exports = {
  APP_NAME: 'Crew',
  APP_ID: 'com.greengrass.crew',
}

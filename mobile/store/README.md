# Getting the phone app into the stores

Drafts for App Store Connect and Google Play, written from what the app really does. Nothing here needs an account to
read; filling the stores in does.

- [listing.md](listing.md): name, subtitle, descriptions, keywords, categories, URLs, screenshots
- [privacy.md](privacy.md): App Privacy and Data safety answers, permissions, with the code they're based on
- [review.md](review.md): age ratings, App Review notes (the demo crew), Play's App access
- [screenshots/iphone-6.9/](screenshots/iphone-6.9/): iPhone 6.9" (1320 x 2868), light, from the demo crew (App Store Connect scales them down for the smaller iPhones)

## What's set in the app already

`app.config.js` (the only config; `ios/` and `android/` are generated from it):

- Version 1.0.0, iOS build number and Android versionCode 1 (`BUILD`: raise it for every upload).
- One id for both stores, `APP_ID` in `src/brand.js`, a placeholder: `com.greengrass.crew`. `CREW_BUNDLE_ID` still
  overrides the iOS one for a build signed with your own team. **The Android package can never change after the first
  upload to Google Play** (a new package is a new app, with no reviews or installs carried over), so settle it before.
  The iOS bundle id can't change either once the App Store record exists.
- iOS: privacy manifest (no tracking, nothing collected, the required-reason APIs React Native and Expo use),
  `ITSAppUsesNonExemptEncryption` (below), the local network and camera prompts in plain words, local networking allowed.
- Android: CAMERA, INTERNET and VIBRATE only, everything else blocked, the camera optional, cleartext allowed (privacy.md
  says why).
- Icons: iOS 1024 full bleed with no corners (the approved icon, no alpha); Android adaptive icon with a foreground,
  a felt background and a monochrome layer for themed icons; the splash on felt lilac, light and dark.
- `eas.json`: `simulator`, `preview` (internal) and `production` (store) profiles. `eas build -p ios --profile production`
  and `eas build -p android --profile production` once the accounts exist (`eas init` adds the project id).

## Export compliance (encryption)

The app does its own encryption, with standard published algorithms (X25519, HKDF-SHA256, ChaCha20-Poly1305 from the
@noble libraries), only to keep the user's messages private between their phone and their own computer.

- **Apple:** an app that uses "an industry standard algorithm, not provided within the Apple operating system" needs no
  export documents, except a French encryption declaration "if you're distributing your app on the App Store in France"
  ([Apple](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption),
  [the key](https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption)).
  So `ITSAppUsesNonExemptEncryption` is **NO**, which holds **only while France is left out of the App Store's
  availability**. In App Store Connect: uses encryption, yes; "standard encryption algorithms instead of, or in addition
  to, using or accessing the encryption within Apple's operating system"; available in France, no.
- **France:** supplying it there (App Store or Google Play) needs a prior declaration to ANSSI, filed at least a month
  ahead (Décret 2007-663, articles 3 to 5, https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000646995; the form:
  https://demarche.numerique.gouv.fr/commencer/declaration-relative-a-un-moyen-de-cryptologie). Once accepted: upload
  it in App Store Connect, set the key to YES and add `ITSEncryptionExportComplianceCode` with the code Apple gives.
- **US (EAR):** freely available, user can't change the crypto, standard algorithms: mass market under Note 3 to
  Category 5 Part 2, ECCN 5D992.c, License Exception ENC §740.17(b)(1). Since the March 2021 rule (86 FR 16482,
  https://www.govinfo.gov/content/pkg/FR-2021-03-29/html/2021-05481.htm) such items need **no self-classification
  report and no BIS filing** (BIS's table: https://www.bis.gov/media/documents/table-changes-enc-wa2019-rule-final-version.pdf).
  Apple's pages still mention a year-end self-classification report; that's out of date for this case.
- **Needs a lawyer or the owner:** whether to leave France out of both stores at launch; confirming the mass-market
  classification (and how it applies to a free app); exports to Russia and Belarus (5D992.c needs a license there for
  most users) and the embargoed countries, which the stores' availability settings should exclude; the company's home
  country's own rules if it isn't in the US.

## Not done here

- **Android build and screenshots.** The Android SDK is on an external drive that wasn't mounted, so there's no local
  APK/AAB and no emulator screenshots yet. `npx expo prebuild --platform android` was checked (manifest, version,
  adaptive icon, fonts); to finish: mount the SDK, `npx expo run:android --variant release` (signed with the debug key),
  open the demo on Pixel_6_API_36 and take the same five screens.
- The accounts, the store records, the support and privacy URLs, the support email.

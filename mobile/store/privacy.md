# Privacy answers (draft, from what the code does)

## What the app actually does with data

Checked against the code on 2026-11-02 (`package.json`, `src/`):

- **No analytics, crash reporting, ads or accounts.** No such SDK is a dependency; there's no server of ours.
- **The only network traffic is to the user's own computer**: a WebSocket (`src/net/client.ts`) to the addresses in the
  pairing code (its LAN address, Tailscale address or name). Every message on it is encrypted end to end with keys only
  the phone and that computer have (X25519, HKDF-SHA256, ChaCha20-Poly1305; `src/net/crypto.ts`). Nothing reaches us.
- **What the phone sends its computer:** your answers, your messages, which replies you've read, and at pairing the
  phone's model name ("iPhone 17 Pro", from expo-device) and platform, so the computer can list it under Computers.
- **What stays on the phone:** the paired computers and their keys (Keychain / Android Keystore via expo-secure-store,
  this device only), whether the Crew room is folded. Uninstalling removes all of it. "Remove" forgets one computer.
- **Camera:** only while the pairing screen is open, to read the QR code; frames are processed on the device and never
  stored or sent. Pasting the code works without the camera.
- **Local network:** to reach the user's own computer. No Bonjour browsing, no scanning.
- The demo crew is made up and never leaves the phone.

## Apple: App Privacy ("nutrition label")

- Do you or your third-party partners collect data from this app? **No, we do not collect data from this app.**
  Apple counts data as collected when it's sent off the device so that the developer (or partners) can access it beyond
  serving the request in real time. Data the app sends only to the user's own computer, end to end encrypted, never
  reaches us.
- Tracking: **No.** `NSPrivacyTracking` is false and there are no tracking domains (`app.config.js`,
  `ios.privacyManifests`).
- Privacy policy URL: required (placeholder in [listing.md](listing.md)).

## Google Play: Data safety

- Does your app collect or share any of the required user data types? **No.**
  Google's definition: "collect" means transmitting data off the device; it excludes data that's processed only on the
  device (the camera frames) and data that's sent off the device but "unreadable by you or anyone other than the sender
  and recipient" (end-to-end encrypted, as everything the app sends is). Source:
  https://support.google.com/googleplay/android-developer/answer/10787469
- Is all of the user data collected by your app encrypted in transit? Not asked when nothing is collected; if the form
  asks anyway: **Yes.**
- Do you provide a way for users to request that their data is deleted? Not asked when nothing is collected. In the app:
  Computers › Remove, and uninstalling.
- The form must still be filled in and needs the privacy policy link.

## Android permissions (what the Play listing will show)

`CAMERA` (scan the pairing code; the camera is optional, so devices without one can install), `INTERNET` (the connection
to your computer), `VIBRATE` (a light tap when you answer). Everything else modules would add is blocked in
`app.config.js` (microphone, storage and media, drawing over other apps). Cleartext traffic is allowed because the
connection is a plain WebSocket to an address on your own network (Android can't allow that by address range); the
messages on it are encrypted by the app.

## iOS permission prompts

- Camera: "Crew uses the camera to scan the pairing code your computer shows."
- Local network: "Crew connects to Crew on your computer over your Wi-Fi, so you can see your crew and answer them
  from your phone."

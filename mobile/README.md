# CLIque for your phone

The phone app for when you're away from your computer: see who's working, answer when an agent needs you, and send a message. iOS and Android, built with Expo (SDK 58, React Native 0.88, TypeScript, expo-router).

It talks to CLIque on your computer (a Mac or a Windows PC) directly, over your network or Tailscale, end to end encrypted. The contract is [`shared/PROTOCOL.md`](../shared/PROTOCOL.md); the app imports `shared/protocol.js` and `shared/sync.js` as they are.

## What's in it

- **Pair:** on the computer, open **Computers** in CLIque and choose **Add a phone**, then point the phone at the QR code it shows (or paste the code). The camera keeps looking by itself: a code that didn't get through is tried again after a few seconds, one the computer turned away isn't. Or **Try the demo clique** (the first screen always offers it; App Review uses it).
- **Chat:** as in Discord and Slack. The chat is one channel of the workspace (#general and the ones you made), or your conversation with one agent, which spans the channels and says where each message was said. Under it, a swipe from the left edge or ☰ away, is the list: the workspaces as a rail (tap one to switch; a pill marks the one you're in, a badge who's waiting on you elsewhere), then the workspace's channels (what's new and who's waiting on you in each, + for a new one) and a direct conversation with each agent (what it's doing, what's new from it), and at the foot the computer and how it's reached. Every message, yours too, is a row: a face in the gutter, the name and time, the words beside it, no bubbles. A channel opens on its brief (what its agents are told with their first message there); tapping its name at the top opens its sheet: name, brief, who's in it (Auto picks only from them), Edit and Delete. Agents write Markdown: headings, nested and numbered lists, checklists, tables, code blocks with Copy. What agents say to each other is folded to three lines, with the rest behind **Show more**, and a line marks where each day starts. Long-press a message to copy or share it. Near the latest message the chat follows what comes in; scrolled back, what you're reading stays put, a round button above the message box leads down and counts what's new, and sending always takes you down. Type `@`, or press the **@** in the box, to bring someone in. Replies you've seen are marked read on the computer too, each in its own channel; a half-written message stays where you wrote it, and the phone opens the channel it was last in.
- **Needs you:** permission prompts, an agent's own questions and plans. They fold into one line at the top of the chat (tap it to answer) and fill the Needs you tab (with a badge), where the creature asks in its own words ("Can I run npm run build?") above thumb-sized buttons; the answer goes back as `answer(ws, id, reply)`, exactly what `Hub.answer` takes.
- **CLIque:** the list, grouped by computer, under one line that says how things are. Tap anyone for on/off, YOLO, Fast, New conversation, Restart and Mark idle.
- **Workspaces:** the phone watches one workspace at a time, its own choice. In the chat they're the rail of its list; on the other tabs the workspace's tile, at the top right, switches.
- **Computers:** the computers you've paired, how each is reached (Wi-Fi or Tailscale, never an address), and Remove.
- **Offline:** the last state stays on screen, the top says "Studio unreachable since 14:02", and sending waits with the reason in the message box. It reconnects by itself (with backoff, and right away when the app comes back to the front).

Version 1 has no Tasks board, no terminals and no push notifications.

## How it talks to the Mac

- **Every address at once:** the code lists the Mac's LAN address, Tailscale IP and MagicDNS name. The phone opens them all; the first to get the Mac's `welcome` says `hi`, and the others wait there and only go on if it fails. So a code pairs once and a reconnect makes one session.
- **Staying current:** `watch` returns the whole state and a version; patches follow, applied with `shared/sync.js`. A patch that doesn't follow the last one makes the phone watch again. `v` counts up for the whole connection.
- **Workspaces:** the phone's own choice, remembered per Mac. Until you pick one it shows the one on the Mac's screen. If the Mac removes the one it watches, the Mac pushes the state of the one on its screen and the phone stays there. With no workspace on the Mac, the phone says to make one there.
- **Going away and back:** when the Mac can't be reached, the last state stays on screen and the phone retries with backoff (1 s up to 30 s, a minute after "too many tries"). Back in the foreground it proves the connection with a quick `watch` and reconnects if that goes unanswered; a call the Mac never answers does the same.
- **Pairing:** a round where no address gets through doesn't end it (the first one often fails while iOS asks about the local network): the phone keeps trying for 25 s, unless the Mac's answer won't change or it asked for a minute's wait. What went wrong is one line; Details lists what each address did (`no answer`, `closed 4008`…).
- **Turned away:** "pair it again" when every address says this phone isn't paired (one address alone could be another CLIque Mac on another network), and "that code is no longer valid" when a pairing code was used, ran out, or a newer one replaced it.

## Run it

You need Node 20 or later, Xcode with an iOS Simulator, and CocoaPods. Android needs Android Studio and a JDK.

```sh
cd mobile
npm install
npx expo run:ios          # builds the app (ios/ is generated, not committed) and opens it in the Simulator
npx expo run:android      # same for Android
```

Then pick **Try the demo clique**, or open `clique://demo` (`xcrun simctl openurl booted clique://demo`).

On an iPhone: `npx expo run:ios --device` with your phone plugged in. A bundle id belongs to one Apple team, so signing with your own team (a free Personal Team works) needs an id of your own: `CLIQUE_BUNDLE_ID=com.you.clique CLIQUE_APPLE_TEAM=<your team id> npx expo run:ios --device --configuration Release` (Release carries its JavaScript, so it runs without the dev server; a free team's build stops opening after 7 days, until you build it again). The phone has to reach the Mac on port 7788 (the same Wi-Fi, or Tailscale on both); iOS asks once for local network access.

`ios/` and `android/` are generated from `app.config.js` by `npx expo prebuild` (Continuous Native Generation) and are gitignored: change native settings in `app.config.js`, never in those folders. The name and the store id are in `src/brand.js` (one line each to change).

## Code

```
src/
  brand.js  the app's name and store id, read by app.config.js and the screens
  net/      the connection, runtime-agnostic (no React): crypto.ts (X25519, HKDF-SHA256, ChaCha20-Poly1305 with @noble),
            client.ts (every address at once, handshake, calls, watch + patches, reconnecting), pairing.ts, types.ts
  state/    session.ts (paired computers, the one in use, its connection), storage.ts and prefs.ts (expo-secure-store), hooks.ts
  demo/     the neutral demo clique (design/DEMO-CLIQUE.md) in two workspaces, answering like a computer would
  ui/       the creatures (avatar.ts specs and poses, creature.tsx, felt.ts: the felt edge as geometry), who needs you and the headline
            (room.ts), the chat's place against its latest message (latest.ts), felt surfaces, the ask cards, feed, Markdown (md.ts parses, markdown.tsx draws), composer, theme
            tokens (v1 calm + v2 Berry and Fredoka)
  app/      the screens (expo-router)
assets/     the icon layers, the splash, the felt textures, Fredoka (OFL)
store/      the store listing drafts, privacy answers, review notes and screenshots
scripts/smoke.ts   the network layer against a real computer, from a terminal
test/              Jest: the test vectors, the client against a fake computer, pairing, the words, following the latest message, the
                   Markdown agents write, the demo clique and the store config
```

## Check it

```sh
npm run typecheck   # types
npm test            # the above
```

## Release

`app.config.js` has the version (1.0.0) and the build number: raise `BUILD` by one for every upload to a store.
`eas.json` has three profiles: `simulator` (an iOS Simulator build), `preview` (internal: ad hoc, an APK) and
`production` (the App Store, an Android App Bundle). What the stores ask (the listing, App Privacy, Data safety, age
rating, export compliance, review notes) is drafted in [`store/`](store/README.md).

And against a real computer running CLIque, with a code from **Computers › Add a phone**:

```sh
npx tsx scripts/smoke.ts cliquephone1.…            # pair, print the state, send a hello, print the patches that follow
npx tsx scripts/smoke.ts --no-send --wait 30     # reconnect with the pairing it saved (.clique-smoke.json)
```

Options: `--to <name>`, `--text "…"`, `--ws <workspace>`, `--answer <card id>:allow|deny`, `--save <file>`, `--verbose`.

## Pictures for the README

Two of the README's pictures show the phone app: the one at the top and the one under "And your phone". They're built
by `npm run readme` (`desktop/scripts/readme.mjs`) from four captures of the app itself, kept in `docs/images/src/`:
`phone-ask-light.webp`, `phone-ask-dark.webp`, `phone-chat-light.webp` and `phone-chat-dark.webp`. Take them again
when those screens change:

```sh
xcrun simctl status_bar booted override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 --dataNetwork wifi
xcrun simctl ui booted appearance light            # then again with dark
xcrun simctl io booted screenshot ask-light.png    # the Needs you tab; chat-light.png is #general
cwebp -q 90 ask-light.png -o ../docs/images/src/phone-ask-light.webp
```

Use the demo clique (**Try the demo clique**) on an iPhone 17 Pro Max simulator, so the captures are 1320 × 2868 and
show nothing of yours.

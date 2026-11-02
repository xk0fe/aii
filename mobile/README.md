# Crew for your phone

The phone app for when you're away from the Mac: see who's working, answer when an agent needs you, and send a message. iOS and Android, built with Expo (SDK 58, React Native 0.88, TypeScript, expo-router).

It talks to Crew on your Mac directly, over your network or Tailscale, end to end encrypted. The contract is [`shared/PROTOCOL.md`](../shared/PROTOCOL.md); the app imports `shared/protocol.js` and `shared/sync.js` as they are.

## What's in it

- **Pair:** on the Mac, open **Computers** in Crew and choose **Add a phone**, then point the phone at the QR code it shows (or paste the code). The camera keeps looking by itself: a code that didn't get through is tried again after a few seconds, one the Mac turned away isn't. Or look around the demo crew.
- **Chat:** everyone's messages, or your conversation with one agent (tap its face). Replies render light Markdown. Type `@` to bring someone in. Replies you've seen are marked read on the Mac too.
- **Needs you:** permission prompts, an agent's own questions and plans, as cards. They stack at the top of the chat and fill the Needs you tab (with a badge); the answer goes back as `answer(ws, id, reply)`, exactly what `Hub.answer` takes.
- **Crew:** the agents as creature cards. Tap one for on/off, YOLO, Fast, New conversation, Restart and Mark free.
- **Workspaces:** the phone watches one workspace at a time, its own choice. The switcher is the top left of every tab.
- **Macs:** the Macs you've paired, how each is reached, and Remove.
- **Offline:** the last state stays on screen, the top says "Mac mini unreachable since 14:02", and sending waits with the reason in the message box. It reconnects by itself (with backoff, and right away when the app comes back to the front).

Version 1 has no Tasks board, no terminals and no push notifications.

## How it talks to the Mac

- **Every address at once:** the code lists the Mac's LAN address, Tailscale IP and MagicDNS name. The phone opens them all; the first to get the Mac's `welcome` says `hi`, and the others wait there and only go on if it fails. So a code pairs once and a reconnect makes one session.
- **Staying current:** `watch` returns the whole state and a version; patches follow, applied with `shared/sync.js`. A patch that doesn't follow the last one makes the phone watch again. `v` counts up for the whole connection.
- **Workspaces:** the phone's own choice, remembered per Mac. If the Mac removes the one it watches, the Mac pushes Home's state and the phone stays on Home.
- **Going away and back:** when the Mac can't be reached, the last state stays on screen and the phone retries with backoff (1 s up to 30 s, a minute after "too many tries"). Back in the foreground it proves the connection with a quick `watch` and reconnects if that goes unanswered; a call the Mac never answers does the same.
- **Pairing:** a round where no address gets through doesn't end it (the first one often fails while iOS asks about the local network): the phone keeps trying for 25 s, unless the Mac's answer won't change or it asked for a minute's wait. What went wrong is one line; Details lists what each address did (`no answer`, `closed 4008`…).
- **Turned away:** "pair it again" when every address says this phone isn't paired (one address alone could be another Crew Mac on another network), and "that code is no longer valid" when a pairing code was used, ran out, or a newer one replaced it.

## Run it

You need Node 20 or later, Xcode with an iOS Simulator, and CocoaPods. Android needs Android Studio and a JDK.

```sh
cd mobile
npm install
npx expo run:ios          # builds the app (ios/ is generated, not committed) and opens it in the Simulator
npx expo run:android      # same for Android
```

Then pick **Try the demo crew**, or open `crew://demo` (`xcrun simctl openurl booted crew://demo`).

On an iPhone: `npx expo run:ios --device` with your phone plugged in. A bundle id belongs to one Apple team, so signing with your own team (a free Personal Team works) needs an id of your own: `CREW_BUNDLE_ID=com.you.crew CREW_APPLE_TEAM=<your team id> npx expo run:ios --device --configuration Release` (Release carries its JavaScript, so it runs without the dev server; a free team's build stops opening after 7 days, until you build it again). The phone has to reach the Mac on port 7788 (the same Wi-Fi, or Tailscale on both); iOS asks once for local network access.

`ios/` and `android/` are generated from `app.json` by `npx expo prebuild` (Continuous Native Generation) and are gitignored: change native settings in `app.json`, never in those folders.

## Code

```
src/
  net/      the connection, runtime-agnostic (no React): crypto.ts (X25519, HKDF-SHA256, ChaCha20-Poly1305 with @noble),
            client.ts (every address at once, handshake, calls, watch + patches, reconnecting), pairing.ts, types.ts
  state/    session.ts (paired Macs, the one in use, its connection), storage.ts (expo-secure-store), hooks.ts
  demo/     a made-up crew in four workspaces that answers like a Mac (for screenshots and App Review)
  ui/       the creatures (creature.tsx, ported from desktop/ui/avatar.js), cards, feed, composer, theme tokens
  app/      the screens (expo-router)
scripts/smoke.ts   the network layer against a real Mac, from a terminal
test/              Jest: the test vectors, the client against a fake Mac, pairing through the session, pairing codes
```

## Check it

```sh
npx tsc --noEmit    # types
npx jest            # shared/vectors.json reproduced, a whole session against a fake Mac, pairing, pairing-code errors
```

And against a real Mac running Crew, with a code from **Computers › Phones › Add a phone**:

```sh
npx tsx scripts/smoke.ts crewphone1.…            # pair, print the state, send a hello, print the patches that follow
npx tsx scripts/smoke.ts --no-send --wait 30     # reconnect with the pairing it saved (.crew-smoke.json)
```

Options: `--to <name>`, `--text "…"`, `--ws <workspace>`, `--answer <card id>:allow|deny`, `--save <file>`, `--verbose`.

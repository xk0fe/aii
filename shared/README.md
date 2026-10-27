# Shared

What the Mac app and the phone app both speak. [PROTOCOL.md](PROTOCOL.md) is the protocol between them; `protocol.js` (names, pairing codes, encodings) and `sync.js` (state as patches) are plain JavaScript with no dependencies, so `desktop/` imports them as they are and `mobile/` bundles them. `vectors.json` holds the handshake worked through with fixed keys, which both sides test their crypto against (`make-vectors.mjs` wrote it; `npm test` checks it still matches).

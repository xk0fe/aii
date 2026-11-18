# CLIque's phone protocol, version 1

How the phone app (`mobile/`) and CLIque on a Mac (`desktop/core/remote.js`) talk. The code both sides share is next to this file: `protocol.js` (names, pairing codes, encodings) and `sync.js` (state as patches). Neither has dependencies.

The phone is a **device**, not a computer. It has no agents, never shows up under Computers, and can only make the calls listed below. It is "you": what it sends shows up in the chat as yours.

## Transport

The Mac listens for phones on TCP port **7788** (`"phonePort"` in `~/.clique/link/link.json` changes it), as a plain WebSocket. Everything after the handshake is encrypted end to end, so the same frames can later travel through a relay without changing.

- **Text frames:** only the two handshake messages, as JSON.
- **Binary frames:** everything after the handshake, encrypted.

## Keys and encodings

- **The Mac's key:** one X25519 key pair for phones, **M**, plus a stable random id, `macId` (16 bytes). Both live in `~/.clique/link/phones.json` (mode 0600), with the paired devices.
- **A phone's key:** an X25519 key pair **D** for each Mac it pairs with, kept in the platform's secure storage.
- **Encoding:** keys are their raw 32 bytes. Bytes travel as base64url without padding, called **b64** below.

## Pairing code

The Mac shows a pairing code as a QR code, and as text to copy:

```
cliquephone1.<b64(UTF-8 JSON)>
{ "v": 1, "id": macId, "n": "Mac mini", "k": b64(M.pub), "s": b64(secret), "h": ["192.168.1.20", "100.101.102.103"], "p": 7788 }
```

- **The secret:** `s` is 32 random bytes. It is never sent over the network; it only goes into the key derivation (below), so a phone without the code can't pair.
- **Lifetime:** a code pairs one phone within 10 minutes. Making a new code ends the old one.
- **Addresses:** `h` lists every address the Mac has, the same list CLIque Link's code carries (LAN, Tailscale IP, MagicDNS name). The phone tries them all at once and keeps the first that completes the handshake.

## Handshake

1. **phone → Mac** (text): `{ "t": "hello", "v": 1, "e": b64(E.pub), "d": b64(D.pub), "pair": true? }`. E is a fresh ephemeral key pair. `pair` is only there when pairing with a code.
   - An unknown `d` without `pair` closes with **4003** (not paired, or unpaired since).
   - `pair` with no open code closes with **4005**: the code was used, ran out, or was cancelled. A code that a newer one ended looks like a wrong code instead: the Mac only knows the open one, so the phone's `hi` doesn't open (**4006**).
2. **Mac → phone** (text): `{ "t": "welcome", "v": 1, "f": b64(F.pub) }`. F is the Mac's ephemeral key pair for this connection.
3. **Both sides derive the keys:**
   ```
   ikm    = DH(E, M) ‖ DH(D, M) ‖ DH(E, F) ‖ (pairing ? s : nothing)
   okm    = HKDF-SHA256(ikm, salt = "clique-phone-v1", info = "keys" ‖ E.pub ‖ D.pub ‖ M.pub ‖ F.pub, 64 bytes)
   kPhone = okm[0..32]     phone → Mac
   kMac   = okm[32..64]    Mac → phone
   ```
4. **Frames:** from here on, only binary frames. Each is ChaCha20-Poly1305 (RFC 8439, ciphertext then the 16-byte tag), with the key for its direction and no associated data.
   - **Nonce:** 4 zero bytes followed by a 64-bit little-endian counter. The counter starts at 0 in each direction and goes up by one per frame.
   - **Content:** the plaintext is UTF-8 JSON.
   - **Failure:** a frame that doesn't decrypt closes the connection with **4006**. A frame out of order fails the same way, because its nonce is wrong.
5. **phone, frame 0:** `{ "t": "hi", "name": "Pixel 9", "platform": "android" | "ios", "app": "0.1.0" }`. The Mac can only open it if the phone holds D, plus `s` when pairing. When pairing, the Mac stores the device now and ends the code.
6. **Mac, frame 0:** `{ "t": "ready", "mac": { "id": macId, "name": "Mac mini" }, "device": { "id": deviceId } }`. The phone can only open it if the other side holds M. Nothing else is sent before it.

What each key buys:
- **DH(E, M):** the phone knows it's talking to the Mac.
- **DH(D, M):** the Mac knows it's talking to a paired phone.
- **DH(E, F):** forward secrecy, so a key stolen later can't open recorded traffic.
- **The secret `s`:** keeps phones without the code out.

**Other close codes:**
- **4003** also ends a live connection the moment you remove the phone on the Mac.
- **4004:** a different protocol version.
- **4008:** too many failed attempts from this address (five within a minute). The Mac waits a minute before it listens to that address again.
- The handshake has 10 seconds; a connection still in it after that is dropped. Until it's through, a message over 16 KB closes the connection (1009), and one address can have four connections in the handshake at once (a fifth gets 4008).
- The Mac only listens while a phone is paired or a code is open. Once the last phone is removed, a phone that wasn't connected at the time finds nothing there (connection refused), not 4003.

**Test vectors:** `vectors.json` holds keys, the derived keys and the first frame each way, for a reconnect and for a pairing. Both implementations must reproduce them: `desktop/` with `node:crypto`, and `mobile/` with `@noble/curves`, `@noble/hashes` and `@noble/ciphers`. `make-vectors.mjs` is the reference implementation that wrote them.

## Messages

These are the same shapes as CLIque Link's (`desktop/core/link.js`).

- **A call and its reply:** `{ "t": "call", "id": 7, "name": "send", "args": [...] }` gets `{ "t": "reply", "id": 7, "ok": value }` or `{ "t": "reply", "id": 7, "error": "text to show" }`. `ok` is `null` for a call with nothing to say.
- **What the Mac pushes:**
  - `{ "t": "state", "ws": id, "v": 1, "state": {...} }`: the whole state of the workspace the phone watches. The Mac pushes one when the workspace the phone watched is removed, or when it has a first one to show a phone that has none: the phone watches the one on the Mac's screen from then on. `ws` is `null` when the Mac has no workspace left (the state is an empty one, `workspace: null`).
  - `{ "t": "patch", "ws": id, "v": 2, "patch": {...} }`: what changed since `v - 1` (see Sync). A phone that misses one calls `watch` again. `v` counts up for as long as the connection lasts, across `watch` calls: a `watch` reply carries the next one.
  - `{ "t": "pty", "ws": id, "name": "ada", "data": "..." }`: terminal output, only for a terminal the phone asked for.
  - `{ "t": "alert", "ws": id, "name": "ada", "text": "wants to run a command: npm test" }`: an agent needs you.
  - `{ "t": "notice", "ws": id, "title": "...", "body": "...", "focus": "..." }`: something worth a line (a task in Review, a limit). One about your accounts' limits has no `ws`: they're no workspace's.
- **Bytes:** byte values (images) travel as `{ "$bytes": "<base64>" }`, as on CLIque Link.

A phone watches **one workspace at a time, its own choice**: never the one on the Mac's screen. Every state carries the list of all workspaces with their counts, for the phone's switcher.

### Calls a phone can make

| Call | Arguments | What it does |
|---|---|---|
| `watch` | `ws` | Stream workspace `ws`; empty or null: the one on the Mac's screen, for a phone that hasn't picked one. Replies `{ v, ws, state }` (`ws`: the one it's watching, `null` while the Mac has none) and patches follow. |
| `send` | `ws, to, text, images?, opts?` | A message, as from the Mac's chat. `to` is `''` (CLIque picks), a name, or names with commas. `opts`: `{ fresh?, re?, channel? }`: `channel` is the id of the channel it's said in (none: #general); Auto picks among that channel's members, and its agents get its brief. A channel that's gone is refused. Replies with what CLIque says, like `"sent to @kim\n"`. |
| `channel` | `ws, op, id, arg?` | The workspace's channels. `op` is `create` (`id` null, `arg` `{ name, brief?, members? }`), `edit` (`arg` any of `{ name, brief, members }`; `members: null` is everyone again; #general keeps its name and has everyone) or `remove` (never #general; its messages stay, shown in #general). Replies `{ id }`; the change arrives with the watch. |
| `answer` | `ws, id, reply` | Answer a question card. `reply` is what `Hub.answer` takes: `{ allow, always?, note? }`, `{ answers }` or `{ terminal: true }`. A card for what a CLI asks in its terminal (`ask.screen`: its own menu read off the screen, or with `ask.snapshot` what the screen shows) and one for an agent stopped on an API error or a model's limit (`ask.stuck`) are plain one-question cards: `{ answers }` with one of its options, or (a snapshot) any text to type into the terminal. |
| `approve`, `drop` | `ws, id` | A hand-off waiting for your approval (Autopilot off). |
| `read` | `ws, seen` | `{ name: ts }`: replies seen up to then, in every channel, so unread counts agree with the Mac. `{ 'name#channel': ts }` reads one channel's (`#general` for messages with no `channel`). |
| `task` | `ws, op, key, arg?` | The Tasks board. `op` is one of `file`, `dispatch`, `accept`, `sendBack`, `note`, `move`. |
| `power` | `ws, name, on` | Turn an agent on or off. |
| `set` | `ws, name, { yolo?, fast? }` | YOLO and Fast. |
| `freshStart`, `restart`, `markIdle` | `ws, name` | As in the agent's menu on the Mac. |
| `stop` | `ws, names, opts?` | Stop: end the turn these agents are in (`names`: one name or a list). They stay on and keep their conversations; what was lined up behind the stopped turn isn't delivered, and one line in the chat says who was stopped. `opts`: `{ channel? }`, the channel it was pressed in, for that line. Replies `{ stopped: [names], dropped }`. An agent shows `canStop: true` while it's in a turn that can be stopped; a Mac without the call refuses it like any unknown call. |
| `image` | `path` | An image from the chat or a task, as bytes. Only files in CLIque's attachments, or in its cache of linked computers' images, only pictures (png, jpg, gif, webp, svg, avif, bmp), and only up to 20 MB: what agents attach is kept in the same folder, and a recording, a page or any other file is refused. A message's or a task's `images` can hold a document attached on the computer (a path that doesn't end in a picture's extension): it's refused here too, and a phone shows such an entry without it. |
| `saveImage` | `name, type, bytes` | Store a photo the phone attaches; replies with its path on the Mac, for `send` or `task`. |
| `terminal` | `ws, name, on` | Start (`true`) or stop streaming a terminal. Starting replies `{ data, cols, rows }`: what it printed so far, and the size it was drawn at (a full-screen CLI only replays right at that size). `pty` messages follow. |
| `input` | `ws, name, data` | Type into a terminal. |

Anything else is refused with `"<name>" isn't available on a phone`.

### The state a phone gets

It's `Clique.snapshot(hub)` for the watched workspace, minus what a phone mustn't have or doesn't need:

- **`computers`:** just `[{ slug, name, online }]`, this Mac first (agents with no `home` are its), then its linked computers. A snapshot's `computers.me.code` is the CLIque Link pairing code, with its secret key, and must never reach a phone.
- **`agents`:** without `prompt`, `args`, `images` or `cwd`.
- **`providers`:** `{ id: { label } }`.
- **`roster` and `theme`:** dropped.
- **Everything else as is:** `feed`, `reads`, `usage`, `spend`, `tasks`, `workspaces`, `workspace`, `parked`, `autopilot`.
- **Threads, on `feed` entries (optional):** `thread` (the id of the line the thread hangs off; none: the line is the channel's), `out` (a line of a thread that shows in the channel too), `gist` (what a thread shows for it, its agent's own first sentence), `echo` (the hand-off this reply only repeats), `asks` (a question nobody took up in the thread, brought out to you). A line with `thread` and no `out` is only in the thread. An older phone ignores them and shows every line, as before. `agents[].thread`: the thread of what it's working on. `send`'s options take `thread`: said in that thread's reply box, it stays there.
- **Files, on `feed` entries (optional):** a message an agent attached files to (`clique attach`) carries `files`: `[{ name, kind, size, w?, h?, dur? }]`, where `kind` is `image`, `video`, `html` or `file`, `size` is in bytes, `w`/`h` in pixels and `dur` in seconds. A file's path and contents are never sent: the files stay on the computer, and the phone shows a card for each that says so. Such an entry also carries `caption`, what the agent said, while its `text` is the caption plus a line that names what's attached ("Attached demo.mp4 (on the computer)"), so a phone from before files shows that line instead of an empty message. A phone that knows `files` shows `caption` and the cards.
- **`reactions`** on a feed entry: `[{ by, emoji, at, said? }]`, one emoji each in place of a written acknowledgement (`by` is an agent's name or `you`; `said` the few words that came with it). `reactionGroups()` in `protocol.js` turns the list into the pills under a message. A reaction arrives as an amendment of the entry it is on, never as an entry of its own, so it is not unread and notifies nobody. A phone from before reactions ignores the field; a phone shows them and has no call to add one yet.
- **`channels`:** the workspace's channels, #general first: `[{ id, name, brief?, members? }]` (no `members`: everyone in the workspace). A feed entry said in a channel other than #general carries `channel` (its id; one whose channel was deleted shows in #general), an agent working on something said in a channel carries `channel` too, and `reads.channels` is `{ channel: { name: ts } }`, read marks per channel (`reads.agents` is #general's). A Mac from before this sends no `channels`: the phone then shows one chat for everything, and what it sends goes to #general.

## Sync

`sync.js`: `diff(prev, next)` returns a patch, or `null` when nothing changed. `apply(state, patch)` returns the next state.

```
patch = {
  set:   { key: value },     top-level keys whose value changed (removed keys: value null)
  lists: { feed:   { drop: [ids], amend: [entries], add: [entries], order?: [ids] },
           agents: { ... } } lists of objects, matched by their key (feed: id, agents: name)
}
```

- **Applying a list patch:** remove what's in `drop`, replace each entry in `amend` (same key), and append `add` in order.
- **`order`:** only there when the result's order isn't simply "the old order, minus what was dropped, plus what was added at the end". Then it's every key in the new order.
- **Pace:** the Mac sends at most one patch every 200 ms per phone, and terminal output in 50 ms batches.

## Later, not in version 1

- **A relay:** the same frames, routed by `macId`.
- **Push for Android (FCM):** sealed with a per-device push key, `HKDF(DH(D, M), salt "clique-phone-v1", info "push")`.
- **Live Activity and Live Update payloads.**

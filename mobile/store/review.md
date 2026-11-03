# Age rating and review notes (draft)

## Age rating

The app shows the user's own conversation with AI coding agents that run on the user's own computer. It has no contact
with other people, no web browsing, no purchases, no ads.

**Apple (App Store Connect, Age Rating):** answer None / No to every content question (violence, sexual content,
profanity, horror, drugs, gambling, medical, contests). Unrestricted web access: No. Messaging or chat with other
people: No (it messages the user's own agents, on the user's own computer). User-generated content shared with others:
No. Advertising: No. Expected rating: 4+. Apple's 2025 questionnaire also asks about AI-generated content in some
regions; if it does, say yes: the app displays text written by the user's own AI agents (Claude Code or Codex), which
the app doesn't generate or filter, and the result may become 9+ or 13+. The owner should confirm on the live form.

**Google Play (IARC questionnaire):** category "Utility, Productivity, Communication, or Other". Violence, sexuality,
language, controlled substances, crude humour, gambling: No. Does the app let users interact or exchange content with
other users: No. Share the user's location with other users: No. Digital purchases: No. Web browser or search engine:
No. Expected: Everyone / PEGI 3 / USK 0. Target audience (Play's "Target audience and content"): 18 and over (a tool for
developers), which keeps it out of the Families programme.

## App Store review notes (paste into "Notes" under App Review Information)

> CLIque on the phone is the companion to CLIque, a free desktop app for Mac and Windows that runs AI coding agents (Claude
> Code or Codex) on the user's own computer. The phone pairs straight with that computer over the local network or
> Tailscale. There is no account, no sign-in and no server of ours.
>
> To review without a computer: on the first screen, tap "Try the demo crew". It opens a made-up crew that lives only
> on the phone and answers like a real one. Things to try: in Needs you, tap Allow for Milo's command, or tap one of
> Iris's answers; in Chat, send a message; in the Crew tab, tap an agent and switch YOLO or On. Computers › Leave the demo goes
> back to the first screen.
>
> Permissions: the camera, only to scan the pairing QR code the desktop app shows (pasting the code works too); the
> local network, to reach the user's own computer. Nothing is collected.
>
> Encryption: the phone and the computer encrypt their messages with standard algorithms (X25519, HKDF-SHA256,
> ChaCha20-Poly1305).

- Sign-in required: No. Demo account: not needed (the demo crew).
- Contact: `<name, phone, email of the person App Review can reach>`

## Google Play: App access

"All or some functionality is restricted": real use needs CLIque on the user's computer. Instructions: "On the first
screen, tap Try the demo crew. Everything in the app works with the made-up crew, with no account or computer."

## Other Play declarations

Ads: No. News app: No. Health, financial, government: No. Data safety: see [privacy.md](privacy.md).

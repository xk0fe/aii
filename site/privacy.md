# Privacy policy

Effective November 6, 2026

Crew is made by Green Grass Inc. This policy covers the Crew apps for Mac, Windows, iPhone and Android, and this website.

## The short version

Crew collects nothing about you. There are no Crew accounts, no analytics, no ads and no tracking. We don't run servers that your work passes through. Your agents, chats and settings stay on your own computers and phones, apart from what your agents send to the AI you use.

## What stays on your devices

- **Your crew.** Your agents, their instructions, chats, tasks, notes and settings are kept in a folder on your computer (`.crew` in your home folder). Your agents' conversations are also kept where Claude Code and Codex keep them (`.claude` and `.codex` in your home folder), and the app keeps a few preferences and caches in its own app data folder. Uninstalling Crew leaves all of these; delete the folders to remove them.
- **Your phone's pairings.** The phone app keeps the computers it's paired with, and the keys for them, in the phone's secure storage (the iPhone's Keychain, Android's Keystore). The keys never leave the phone.
- **Your voice.** Dictation runs on your computer, and what you say isn't sent anywhere. On a Mac it uses Apple's on-device speech recognition; the first time you dictate in a new language, macOS may download Apple's speech model for it. On Windows the speech model comes inside Crew.

## What leaves your devices, and where it goes

- **To the AI you use.** Crew runs Claude Code and Codex on your computer, signed in with your own account, and they send their work to Anthropic (Claude) or OpenAI (Codex) under your agreement with them and their privacy policies. That includes your messages, the files they read, the output of commands they run and pictures you attach. It also includes what Crew adds so your agents can work together: each agent's instructions, its teammates' names and jobs, your computers' names, and the messages, notes and tasks the crew passes around. When you ask Crew to draft an agent's instructions, the agent's name, job and teammates go to Claude or Codex to write them. Crew also asks Codex which models it has when it starts, which can contact OpenAI. Claude Code and Codex may send their own usage and error reports to Anthropic and OpenAI; Crew doesn't change their settings. If you set up another provider, such as GLM, that provider gets your agents' work instead.
- **Between your own computers and phones.** When you link your computers or pair a phone, they talk to each other directly: chats, terminal output and what you type into terminals, pictures, tasks and, when you move an agent to another computer, its conversation. While computers are linked or a phone is paired, Crew listens for them on the networks your computer is on (or your Tailscale network, if you use Tailscale, which may relay the connection through Tailscale's servers). Only devices you paired with a pairing code can connect, and everything between them is encrypted. Nothing goes through a server of ours.
- **Links you open** open in your web browser.
- **Spell checking on Windows.** When Crew starts, the spell checker built into it may download a word list for your system language from Google's servers, which see your IP address and the language. It doesn't send what you type.

## What we collect

Nothing. Crew has no analytics, crash reporting, usage statistics, update checks or advertising IDs, and it doesn't sell or share data, because it has none to share.

## The App Store, Google Play and your computer

If you get the phone app from the App Store or Google Play, Apple or Google handles the download under their own privacy policies, and tells us how many people downloaded it. If you've chosen on your phone to share diagnostics (on an iPhone, with app developers; on Android, with Google), Apple or Google may show us crash reports that don't say who you are. We use them only to fix problems. Likewise, if your Mac or PC is set to send crash reports to Apple or Microsoft, it may send one when Crew crashes.

## This website and the downloads

The website and the Mac and Windows downloads are hosted by GitHub (GitHub Pages and GitHub Releases). Like any web server, GitHub may record your IP address and browser when you visit or download, as its privacy statement describes. The website itself uses no cookies, analytics or trackers, and loads nothing from other sites.

## What the apps ask your permission for

- **Microphone** (Mac): only while you dictate a message. Before macOS 26, also speech recognition.
- **Your folders** (Mac): when an agent works in a folder such as Documents or Desktop, macOS asks you to let Crew in.
- **Local network** (Mac and iPhone), and the **firewall** (Windows): to reach your other computers and your phone.
- **Camera** (phone): only to scan the pairing code your computer shows. The picture isn't kept or sent.
- **Paste** (iPhone): if you paste a pairing code instead of scanning it.
- **Notifications** (Mac): to tell you when an agent needs you.

## Children

Crew isn't meant for children under 13.

## Changes

If this policy changes, we'll update this page and the date at the top.

## Contact

Questions or requests about your privacy: CONTACT_EMAIL

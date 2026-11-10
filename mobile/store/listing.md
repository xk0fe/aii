# Store listing (draft)

The product is CLIque (CLI + clique: keep the capitals), from `APP_NAME` in `src/brand.js`, which is also the name under
the icon; a rename changes it there and in this file. Copy rules: plain, short, sentence case, no em dashes, no
"seamless", "effortless" or "powerful".

## Names

| Field | Limit | Draft |
|---|---|---|
| App Store name | 30 | CLIque: coding agents (21) |
| App Store subtitle | 30 | Answer your agents anywhere (27) |
| Google Play name | 30 | CLIque: coding agents (21) |
| Google Play short description | 80 | See your coding agents at work and answer when they need you. (61) |
| App Store promotional text | 170 | See who's working, allow a command, answer a question. Your clique keeps going while you're away from your desk. |

"CLIque" alone is likely taken on the App Store (many apps there start with "Clique", none of them a developer tool),
hence the tail. Check availability before Friday; another that keeps the name: "CLIque for your agents" (22). The name
under the icon stays CLIque either way. Don't put "Claude" or "Codex" in the name, subtitle or
keywords (Apple 2.3.7, Google's metadata policy): they're other companies' trademarks. Saying the app works with them in
the description is fine.

## Full description (App Store and Google Play, under 4000 characters)

CLIque on your phone keeps you close to the AI coding agents working on your computer.

See who's busy and on what. When an agent wants to run a command or has a question, it asks you on your phone, in its
own words, and you answer with one tap. Send a message to the whole clique or to one agent, from anywhere your phone can
reach your computer.

What you can do
- See your whole clique at a glance: who's at work, who's idle, who needs you.
- Allow or deny a command, or tell the agent what to do instead.
- Answer an agent's questions and approve its plans.
- Chat with everyone, or with one agent.
- Switch workspaces, turn agents on and off, and flip YOLO or Fast.

How it works
Your phone talks straight to CLIque on your Mac or Windows PC, over your Wi-Fi or Tailscale. Every message is encrypted
end to end between the two. There's no account, no server in between, and nothing about you is collected.

You need CLIque on your computer, running Claude Code or Codex. CLIque is free. Bring your own Claude or Codex account.

Not ready to pair? Try the demo clique: a made-up team that lives only on your phone.

## Keywords (App Store, 100 characters, comma separated)

coding,agents,ai,developer,programming,terminal,approve,remote,assistant,code,dev tools,team (92)

## Categories

- App Store: Developer Tools (primary), Productivity (secondary).
- Google Play: Productivity. Tags: Developer tools, Remote control.

## URLs (placeholders until the site is up)

- Marketing: `https://<site>/`
- Support: `https://<site>/support` (Apple requires a support URL; Google Play a contact email: `<support email>`)
- Privacy policy: `https://<site>/privacy` (both stores require one, even for an app that collects nothing; the text can
  be the "App Privacy" section of [privacy.md](privacy.md))

## Copyright and contact

- Copyright: `2026 <company>`
- Developer name / seller: `<company>` (the Apple and Play organization accounts)

## Screenshots

[`screenshots/iphone-6.9/`](screenshots/iphone-6.9/): iPhone 6.9" (1320 x 2868), light, from the demo clique, in this order:

1. The clique: "2 of your clique need you"
2. Needs you: Iris's question and Milo's command, in their own words
3. Milo asks to run `npm run build`: Deny, Allow, Always allow
4. The chat
5. An agent (Ada) opened

The same five on an Android phone still need the emulator (see README.md, "Not done").

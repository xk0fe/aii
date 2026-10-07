# Crew

Run a crew of AI coding agents side by side. Each agent has a **name**, an **area of work**, its own **instructions** (system prompt), a **brain** (provider, model, effort) and a little plush creature for a face. Agents hand tasks to each other and share context, so you can drop work on whichever agent is free instead of waiting for one prompt to finish.

Claude Code and Codex are built in. GLM and local open-weight models work too, and you can add any other provider.

You get three views:

- **Menu bar** (three little buddies): every agent with its area, status and brain, its on/off switch and YOLO/⚡ Fast chips, and Autopilot. Modes that are on always show; hover a row to flip one that's off.
- **Floating pill** on the screen edge holds the crew as little creatures that hop while they work. Click it, or press `⌥⇧Space`, to open the chat. Click a creature to talk to that agent. The pill steps aside while the dashboard is open, and comes back with the chat open when you close or minimize the dashboard.
- **Dashboard**:
  - **Crew** is a Pokédex-style collection of agent cards, where you create and edit agents.
  - **Grid** and **Focus** show the live terminals. `⌘1` `⌘2` `⌘3` switch between the three.
  - The feed sits on the right.

```
npm install
npm start        # opens Crew.app (builds it the first time)
```

`npm start` opens `dist/Crew.app`, which has Crew's own name and icon everywhere: menu bar, Dock, ⌘Tab and notifications.
- **When it builds:** only the first time, after an Electron upgrade, or if you move this folder.
- **Your edits:** the app is a thin launcher for this folder, so edits apply on the next launch.
- **Keep it handy:** drag `dist/Crew.app` into Applications or the Dock.
- **Other scripts:**
  - `npm run app` forces a rebuild.
  - `npm run dev` runs the bare Electron runtime for development; macOS calls it "Electron" there.
  - `npm run icon` re-renders the app icon from the same plush creatures the UI uses.
  - `npm run shots` renders every view, light and dark, with a made-up crew into `dist/shots` (PNGs plus GIFs of the animations). Nothing starts and `~/.crew` is untouched, so it's safe for checking UI changes.
- **One copy at a time:** opening Crew again brings up the one that's running.
- **Theme:** the ☀️/🌙 button (dashboard titlebar or the menu bar popover) switches Light, Dark, or Auto (follow macOS). Terminals stay dark either way. The `{ }` button opens `config.json` in your text editor.

## The crew collection

- **Every card shows its area** under the name, so you can see who does what at a glance.
- **Click a card** to open it and edit everything:
  - the name and area;
  - its **instructions**, the system prompt layered on top of the crew basics. Press **✨ Write it** and the agent's own brain (Claude or Codex) drafts one from its name and area, including what to hand off to which teammate. The draft runs in the agent's folder, so it can pick up the project's CLAUDE.md or AGENTS.md;
  - **reference images** for its instructions, such as mockups, brand guides or screenshots. Use **+ Reference image**, or paste or drop them on the instructions box. The agent opens them when relevant;
  - the brain: provider, model and effort (the options shown depend on the provider, and Codex lists its live models and each model's effort levels);
  - the folder, YOLO, on/off and extra CLI flags;
  - the look: body, color, eyes, mouth, accessories and blush, each shown as a tiny version of the agent. Or roll 🎲 Shuffle.
- **Save** applies the changes. If you changed something the agent launches with (area, instructions, brain, folder, flags, YOLO), the agent restarts and resumes its session. Edited instructions apply to the ongoing conversation too. If it's mid-task, it waits until it's free first.
- **Select** turns on bulk mode. Pick cards, or press **All**, then set provider, model, effort, YOLO or power for all of them at once.
- **+ New agent** opens a blank card with a random creature.

## How you use it

- **Message one agent.** Click its chip in the composer, or start with `@david …`.
- **Message several agents.** Use bare `@mentions` anywhere in the message, such as `@david @joseph fix the payload`. Mentions add to the selected composer chip; choose **Auto** to address only the mentioned agents. Each recipient gets one copy, regardless of repeated mentions or capitalization, with the original message and a note naming the other recipients. Emails, package paths, possessives such as `@david's`, and text in backticks do not address agents. An unknown, turned-off, or self recipient rejects the whole send before anything is delivered. With Autopilot off, each teammate hand-off waits for its own approval.
- **Add images** to any message: paste them (⌘V), drop them on the chat, or use the **+** button. They're saved in `~/.crew/attachments` and sent to the agent as file paths. Claude Code and Codex both open them, with no permission prompt. Click a picture in the feed to open it.
- **Message "Auto".** Without explicit recipients, Crew scores the task against agents' areas, then prefers whoever is free. Coordination wording such as “orchestrate multiple agents”, “organise the crew” and “keep things in working order” also matches an organiser area such as Arie's. This uses a fixed vocabulary of stems and phrases, not unrestricted language understanding; unfamiliar wording can miss, and incidental coordination language can favor the organiser. Use a chip or `@mention` to choose explicitly.
- **Busy agent?** The message is queued and typed in for you the moment that agent finishes.
- **One request, one bubble.** A new multi-recipient message from you appears once in the feed, addressed to everyone who received it. Replies from each recipient link back to that bubble. Separate sends remain separate, even with identical text. Older history without a send identifier stays unmerged; teammate hand-offs remain separate for approval.
- **Agents delegate.** Each agent knows its teammates and can run:
  - `crew send <name> "task"` to hand off work, or `crew send david,joseph "task"` for several recipients;
  - `crew note "fact"` to share context;
  - `crew who` to see the crew;
  - `crew board` to read shared notes.

  Every hand-off and reply shows up in the feed, with the agent's face beside it.
- **Threads.** Each reply, and each hand-off an agent makes while working on your request, quotes the message it answers ("↩ you: …"). Click the quote to jump back. Your messages link forward too ("↪ @joseph replied"), so with several messages and several agents in flight you can always tell what answers what. Prompts you type directly into an agent's terminal show up in the feed too, tagged *in terminal*.
- **Rich text.** Replies render Markdown: bold, italics, `code`, code blocks, lists, quotes, links and pipe tables (links open in your browser). Tables need a header and delimiter row with matching column counts; alignment colons are supported. Escape literal pipes as `\|`, including inside inline code. Wide tables scroll horizontally; multiline cells are not supported. Long replies fold with a fade; click to unfold.
- **Autopilot off** makes hand-offs between agents wait in the feed until you click **Send it** or **Drop**.
- **Who's on it.** While an agent works, a typing bubble under the last message in the feed shows what it's doing. Click it to open its terminal.
- **Needs you.** On a permission prompt or a question, the agent's creature wiggles with a `!`, its feed bubble turns orange and you get a notification. Answer it in its terminal.
- **On/off** is saved. An agent you turn off stays off after a restart and resumes its session when you turn it back on.
- **⚡ Fast** (Codex agents) uses Codex's fast service tier. It's a ⚡ chip on the agent's row and a toggle in the editor; until you set it, it follows `service_tier` in your Codex config.
- **YOLO** skips every permission prompt. Claude gets `--dangerously-skip-permissions`; Codex gets `--dangerously-bypass-approvals-and-sandbox`.

## Crew Link: one crew, all your computers

Your agents, terminals and history stay on one Mac (the host). Your other computers connect to it and get a live window into the same crew.

1. **On the Mac that runs your agents:** click **Link** in the dashboard titlebar, turn on **Share this crew**, and **Copy** the pairing code.
2. **On your other computer:** click **Link**, paste the code, and **Connect**. Crew restarts connected, and the titlebar chip says **on ‹host›**.

From the other computer you can do everything:
- chat with agents, with replies threaded to your messages;
- follow hand-offs and stats;
- edit agents;
- watch and type into terminals;
- attach images.

Theme, notifications and opening files stay per computer.

- **Networks:** the same Wi-Fi, or Tailscale. The code lists every address of the host (LAN IP, Tailscale IP and MagicDNS name), and the client uses whichever one answers. The default port is 7787; to change it, set `"port"` in `~/.crew/link/link.json`.
- **Security:** the link is TLS with the host's own certificate, pinned by the code. The secret key in the code is only sent after the certificate checks out, so a fake host on the same network can't take it. **New code** revokes the old one, and sharing is off until you turn it on. Anyone with the code can run your agents, so keep it to your own machines.
- **Good to know:**
  - The host has to stay awake. Crew keeps itself running while sharing, but closing the lid still sleeps the Mac.
  - While connected, the other computer's own agents are paused, and they resume when you **Disconnect**.
  - Agent folders are paths on the host, so type them; the folder picker can't browse another computer.

## Work experience

Every agent keeps a record of what it actually does, across restarts:
- tasks, split into from you and from teammates;
- active time and average turn time;
- tool calls and hand-offs;
- "needs you" moments and the time spent waiting on you;
- queue wait: how long messages sit before the agent is free, which shows who's overloaded;
- the last 14 days of activity.

Agents level up as they work (10 XP per finished task, plus 1 per active minute). A finished task gets a little hop; a level-up gets confetti.

- **Each card's detail** has a Pokédex-style *Work experience* panel, with bars against the rest of the crew.
- **The Crew page's Stats tab** compares everyone in a sortable table. 👑 marks the best in each column and 🐢 the slowest, so strong performers and slow agents stand out.

## Providers

| id | runs | notes |
|---|---|---|
| `claude` | Claude Code | `fable`, `opus`, `sonnet`, `haiku`; effort `low` to `max` |
| `codex` | Codex CLI | models and per-model efforts come from `codex debug models` |
| `glm` | Claude Code against Z.ai's Anthropic-compatible API | needs `ZAI_API_KEY` in your shell |
| `local` | Codex with `--oss` on Ollama | e.g. `gpt-oss:20b`, `qwen3-coder` |

Add your own in `config.json`. Each provider names a CLI adapter (`claude` or `codex`) plus optional env, args and menus. `${VAR}` values come from your environment, so keys never live in the file:

```json
"providers": {
  "gateway": { "label": "My gateway", "cli": "claude", "env": { "ANTHROPIC_BASE_URL": "https://your-anthropic-compatible-endpoint", "ANTHROPIC_AUTH_TOKEN": "${GATEWAY_KEY}" }, "needs": ["GATEWAY_KEY"], "models": ["some-model"] }
}
```

A Codex-backed agent runs in Codex's `workspace-write` sandbox with network access on, so `crew` can reach the app over localhost. Its status hooks are passed on the command line with `--dangerously-bypass-hook-trust`, so no hook-trust prompt blocks every launch. That flag also lets hooks defined in the agent's own repo run without review, the same trust model Claude Code uses.

## Files

Everything lives in `~/.crew/` (set `CREW_HOME` to move it):

- `config.json`: your agents, custom providers and theme. The UI writes it, you can edit it by hand (the `{ }` button), and changes apply live.
- `sessions.json`: which session each agent resumes.
- `stats.json`: each agent's work experience.
- `link/`: Crew Link settings, the host certificate and key, and a cache of images from a remote crew.
- `board.md`: shared notes (`crew note`).
- `feed.jsonl`: the feed history.
- `attachments/`: images you've attached to messages and instructions.

```json
{
  "autopilot": true,
  "hotkey": "Alt+Shift+Space",
  "agents": [
    { "name": "gal", "area": "UI/UX design", "provider": "claude", "model": "fable", "effort": "high", "cwd": "~/code/app",
      "avatar": { "body": "heart", "color": "pink", "eyes": "sparkle", "mouth": "cat", "hat": "bow", "cheeks": true } },
    { "name": "david", "area": "React Native client", "provider": "codex", "model": "gpt-6-luna", "yolo": true, "cwd": "~/code/app" }
  ]
}
```

An agent without an `avatar` gets a stable one picked from its name. `off: true` keeps an agent saved but not running. `args` are extra flags passed straight to the CLI.

To use `crew` from your own terminal as well, run `ln -s "$PWD/bin/crew" ~/.local/bin/crew`.

## How it works

```
 UI windows (ui/*.html) ──IPC── main.js ── core/hub.js ── core/runner.js ── pty ── claude / codex (one per agent)
                                                ▲                                        │
                                   core/server.js (127.0.0.1, token) ◄── hooks + `crew` CLI ┘
```

- `core/providers.js` defines the brains: built-in providers, your custom ones, and Codex model discovery.
- `core/adapters.js` turns an agent into a command line for its CLI. That includes model, effort, YOLO, the crew system prompt plus the agent's instructions, and hooks that report status.
- `core/promptgen.js` drafts an agent's instructions headlessly with `claude -p` or `codex exec`, with no tools and nothing saved to your session history.
- `core/hub.js` is the logic, with no Electron in it:
  - status from hooks (start → free, prompt → working, stop → free plus the reply into the feed, permission → needs you);
  - inboxes, routing, the feed and notes;
  - `update()`, the single edit path behind the editor and bulk edits.
- `core/runner.js` owns the pseudo-terminals.
- `core/link.js` is Crew Link: pairing codes, the TLS host, and a client that looks like a local crew to the rest of the app.
- `core/server.js` is a tiny local HTTP API for the hooks and `bin/crew`. Every request needs a per-launch token.
- `ui/` is plain HTML, CSS and JS with no build step. The main files:
  - `avatar.js` draws the creatures;
  - `collection.js` is the card collection and editor;
  - `common.js` has shared pieces, including a small DOM patcher that keeps avatars animating smoothly across updates.

## Extending it

- **Another provider on an existing CLI:** add it under `providers` in `config.json`. No code needed.
- **Another CLI:** add a function to `core/adapters.js` that returns `{ file, args }`. Have that CLI's hooks call the same `curl` as the others, so status works.
- **More creature parts:** add entries to `BODIES`, `EYES`, `MOUTHS` or `HATS` in `ui/avatar.js`. The editor picks them up automatically.
- **A new UI action:** add a function to `actions` in `main.js`, then call `crew.call('name', …)` from any page.
- **A new crew CLI command:** add a route in `core/server.js` and a case in `bin/crew`.

## Limits worth knowing

- Agents run inside the app, so quitting Crew stops them. They resume their sessions on the next launch, but a turn that was mid-flight is lost.
- Queued messages live in memory and are dropped on quit.
- Codex agents are marked ready about 3 seconds after launch, because Codex only announces a session with its first prompt.
- If an agent looks stuck on "working" (for example after you interrupt it), click its status in the terminal header to mark it free.

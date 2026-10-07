# Crew

Run a crew of AI coding agents side by side. Each agent has a **name**, an **area of work**, its own **instructions** (system prompt), a **brain** (provider, model, effort) and a little plush creature for a face. Agents hand tasks to each other and share context, so you can drop work on whichever agent is free instead of waiting for one prompt to finish.

Claude Code and Codex are built in. GLM and local open-weight models work too, and you can add any other provider.

You get three views:

- **Menu bar** (three little buddies): every agent with its area, status and brain, its on/off switch and YOLO/⚡ Fast chips, and Autopilot. Modes that are on always show; hover a row to flip one that's off.
- **Floating pill** on the screen edge holds the crew as little creatures that hop while they work. Click it, or press `⌥⇧Space`, to open the chat (or `⌥⇧D` to open it and start dictating). Click a creature to talk to that agent. The pill steps aside while the dashboard is open, and comes back with the chat open when you close or minimize the dashboard.
  - **Drag it anywhere** by its edge or by the chat's header. The chat opens on the side with room: on the left of the screen it opens to the right of the pill, on the right to the left, at the top below, at the bottom above. At the top and bottom the pill lies flat, like the Dock.
  - **It stays put:** dropped near an edge, it tucks in against it, and opening or closing the chat never moves it.
- **Dashboard**:
  - **Crew** is a Pokédex-style collection of agent cards, where you create and edit agents.
  - **Tasks** is a board of work for the crew (bugs, features, chores): each task gets a fresh conversation, and you review what comes back.
  - **Grid** and **Focus** show the agents' terminals. `⌘1` to `⌘4` switch between the four.
  - **The ribbon** under each terminal's header says what you're looking at. These aren't terminal apps: Crew runs each agent's CLI in a pseudo-terminal and draws its output, replaying what it printed before the view opened. **Live** means typing goes straight to the agent; **Mirror** means it runs on a linked computer and streams here; **Replay** means it's still being redrawn; **Offline** (its computer can't be reached) and **Ended** (the CLI exited) are striped and dimmed, because that output is frozen. The ribbon also shows the brain and the terminal's size, and hovering it explains the rest.
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
- **Select** turns on bulk mode. Pick cards, or press **All**, then set provider, model, effort, YOLO or power for all of them at once, or **Export** them.
- **+ New agent** opens a blank card with a random creature.

## Sharing agents: export and import

An agent pack is a `.crew` file holding one or more agents: name, area, instructions, reference images, brain (provider, model, effort, fast), YOLO, extra flags and look, plus any custom provider they use. Folders, sessions and work experience stay behind.

- **Export:** open an agent and press **Export**, or **Select** several and press **Export** in the bar. The file is saved where you choose and shown in Finder.
- **Import:** press **Import** on the Crew page, drop a `.crew` file on the window, or double-click one in Finder. For each agent you choose whether to take it, what to call it (names already in use get a free one), which folder it works in and which computer it runs on. Imported agents start switched off, so you can look them over before they run. A pack never overrides providers you already have.

## How you use it

- **Message one agent.** Pick it on the **To** line above the message box, or start with `@david …`. With a big crew the line shows just the creatures (hover one for its name and status), and scrolls once even those don't fit.
- **Message several agents.** Use bare `@mentions` anywhere in the message, such as `@david @joseph fix the payload`. Type `@` and the crew pops up, filtered as you type (by name, then by area). Use ↑↓ to move and Enter or Tab to pick, or click one. The Tasks bar has the same list for assigning a task. Mentions add to the selected composer chip; choose **Auto** to address only the mentioned agents. Each recipient gets one copy, regardless of repeated mentions or capitalization, with the original message and a note naming the other recipients. Emails, package paths, possessives such as `@david's`, and text in backticks do not address agents. An unknown, turned-off, or self recipient rejects the whole send before anything is delivered. With Autopilot off, each teammate hand-off waits for its own approval.
- **Talk instead of typing.** Click the 🎙 mic next to send and just talk. Your words appear in the message box as you speak, and it fixes them up as it goes. Or press `⌥⇧D` from any app: the chat opens and starts listening.
  - **Hold the mic** to talk and let go to stop, or click once to start and once to stop.
  - **Enter** stops and sends once the last words are in. **Esc** stops and leaves the text for you to edit. If it's slow to finish, a second Esc stops waiting and keeps what it has. In the floating chat the next Esc closes the panel.
  - **While it listens**, the line above the box shows who it's for and which language. Click the language to switch, e.g. English ⇄ Русский; it offers the languages set in System Settings › Language & Region.
  - **Private:** it's Apple's on-device dictation, so your voice never leaves the Mac, and nothing is sent until you send it.
  - **First use:** Crew builds a small helper (a few seconds, needs Apple's developer tools: `xcode-select --install`), and macOS asks once for the microphone. A language you haven't used for dictation before downloads first.
  - **Needs macOS 26.** Older macOS works from Crew.app (`npm start`) through the older recognizer, after it asks for speech-recognition permission, and only offers the languages that recognizer can do on the Mac itself.
  - **Linked computers:** dictation runs on the computer you're typing on, even when the crew lives on another one.
  - **Hotkey:** change it with `"voiceHotkey"` in `config.json`, or turn it off with `false`.
- **Add images** to any message: paste them (⌘V), drop them on the chat, or use the **+** button. They're saved in `~/.crew/attachments` and sent to the agent as file paths. Claude Code and Codex both open them, with no permission prompt. Click a picture in the feed to open it.
- **Message "Auto".** Without explicit recipients, Crew scores the task against agents' areas, then prefers whoever is free. Coordination wording such as “orchestrate multiple agents”, “organise the crew” and “keep things in working order” also matches an organiser area such as Arie's. This uses a fixed vocabulary of stems and phrases, not unrestricted language understanding; unfamiliar wording can miss, and incidental coordination language can favor the organiser. Use a chip or `@mention` to choose explicitly.
- **Busy agent?** The message is queued and typed in for you the moment that agent finishes.
- **One request, one bubble.** A new multi-recipient message from you appears once in the feed, addressed to everyone who received it. Replies from each recipient link back to that bubble. Separate sends remain separate, even with identical text. Older history without a send identifier stays unmerged; teammate hand-offs remain separate for approval.
- **Agents delegate.** Each agent knows its teammates and can run:
  - `crew send <name> "task"` to hand off work, or `crew send david,joseph "task"` for several recipients;
  - `crew note "fact"` to share context;
  - `crew who` to see the crew;
  - `crew board` to read shared notes;
  - `crew task …` to work the Tasks board (see below).

  Every hand-off and reply shows up in the feed, with the agent's face beside it.
- **Threads.** Each reply, and each hand-off an agent makes while working on your request, quotes the message it answers, with a bar in its sender's color. Click the quote to jump back. Your messages link forward too ("↪ @joseph replied"), so with several messages and several agents in flight you can always tell what answers what. Prompts you type directly into an agent's terminal show up in the feed too, tagged *in terminal*.
- **Rich text.** Replies render Markdown: bold, italics, `code`, code blocks, lists, quotes, links and pipe tables (links open in your browser). Tables need a header and delimiter row with matching column counts; alignment colons are supported. Escape literal pipes as `\|`, including inside inline code. Wide tables scroll horizontally; multiline cells are not supported. Long replies fold with a fade; click to unfold.
- **Autopilot off** makes hand-offs between agents wait in the feed until you click **Send it** or **Drop**.
- **Reply to a message.** Hover it and press **Reply**. The message box shows what you're answering, and your message goes to whoever sent it (to all of them, for one of yours sent to several), linked to it in the feed. If it's an older message, the agent gets a short note saying which one ("replying to your message …"). The box stays in that thread: what you send next answers the newest message in it. **Esc**, **×**, or picking someone on the **To** line leaves it.
- **Unread replies.** A reply you haven't seen yet has a blue dot, and a **New** line marks where the unread ones begin. Each agent's creature wears a count (in the pill, the **To** line and the sidebar), the pill's mark shows the total, and the dashboard title bar says "2 new". A reply counts as read once it has been on screen for a moment while the window has focus. Clicking a creature in the pill opens the chat at its first unread reply. Crew remembers this in `~/.crew/reads.json`.
- **Who's on it.** While an agent works, a slim line under the last message in the feed shows what it's doing. Click it to open its terminal; an agent waiting on you gets an **Answer** button that jumps to its question.
- **Answer from the chat.** When an agent stops to ask you something, the question shows up in the chat as a card, its creature wiggles with a `!`, and you get a notification. The agent waits, and you answer right there:
  - **Permission prompts:** what it wants to run or change, with **Allow** and **Deny**. Claude's "don't ask again" options are there too, such as *Always allow Bash(npm test:\*)*. Type in the note box to say no and tell it what to do instead.
  - **Its own questions** (Claude's multiple choice): tap an option, pick several where it says *pick any*, or type *something else*.
  - **Plans** (Claude's plan mode): read the plan, then **Approve plan** or **Keep planning** with what should change.
  - **The terminal still works:** Claude keeps its own dialog up as well, and whichever you answer first wins (the card then says it was answered in the terminal). Codex waits for the chat. Its card has *Answer in its terminal instead*, and typing in its terminal does the same.
  - **Works everywhere:** cards from agents on your other computers work the same way, and answered cards stay in the history.
  - **Mobile-ready:** the answer is one call, `answer(id, reply)`. It runs on whichever computer the agent lives on, so the same call works from a phone app.
- **On/off** is saved. An agent you turn off stays off after a restart and resumes its session when you turn it back on.
- **⚡ Fast** (Codex agents) uses Codex's fast service tier. It's a ⚡ chip on the agent's row and a toggle in the editor; until you set it, it follows `service_tier` in your Codex config.
- **YOLO** skips every permission prompt. Claude gets `--dangerously-skip-permissions`; Codex gets `--dangerously-bypass-approvals-and-sandbox`.

## Tasks: one conversation per task

Handing an agent task after task fills one conversation with unrelated work, and long mixed-up conversations are where agents start getting things wrong. The **Tasks** board (`⌘2`) keeps adding, sorting and doing apart, and runs each task in a **fresh conversation** with just that task in it.

**To do → In progress → Review → Done.**

1. **Add.** Type in the bar at the top and press Enter. Pick the kind first (**Task**, **Bug** or **Feature**), write `@name` to give it to someone, and paste or drop screenshots. From the chat: the **Task** chip, or start a message with `task:`, `bug:` or `feature:`.
2. **Triage** (optional, under **Workflow**). A triage agent turns what you typed into a clear task (steps, priority, kind), gives it to the agent whose area it is, and spots duplicates (`×3` on the card). Your own words stay on the task and go to whoever does it, so paths and commands survive the rewrite. Without a triage agent, a task goes to whoever's area matches; naming an `@owner` skips triage.
3. **Start.** **Start** on a card (or dragging it to **In progress**) hands it to its owner: Crew starts that agent a new conversation and gives it the task. A busy owner finishes what it's doing first. **Start all** starts every assigned task, each in its own conversation, and **Auto-start** (under **Workflow**) starts tasks as soon as they have an owner. While it works, the card shows what the agent is doing and how full its conversation is. It checks its work and runs `crew task done`; if it can't tell what's wanted or where, it asks with `crew task note` instead of guessing.
4. **Review.** Finished tasks land in **Review** with what was done and how it was checked, and you get a notification. **Accept** closes it; **Send back** returns it with your note, into the same conversation, so the agent keeps everything it tried.

**Board or list**, filtered by kind, by owner (their creatures above the board) or by search. **Done** folds into a slim column; click it to open. Open a task to change its status, priority, kind or owner from their menus, edit the title and description (Markdown), add attachments and notes, mark it the same as another task, and follow everything that happened to it. The feed shows each step as one line; click it to open the task. Tasks added on a linked computer show up too, marked with that computer.

Agents can use the board themselves:

```
crew task list                    open tasks
crew task show <n>                one task in full: details, screenshots, notes
crew task done <n> "..."          what was done (or what was wrong), how it was checked
crew task note <n> "..."          a finding (unclear, not my area, can't reproduce, a clue)
crew task add "title" "..."       a new task (--kind bug|feature|task, --priority, --owner)
crew task triage <n> --owner <name> --priority <urgent|high|medium|low> [--kind] [--title "..."] [--details "..."]
crew task dup <n> <original>      the same as another task
```

`crew bug …` works too, with its old words (`fixed`, `report`).

## Sub-agents: when an agent splits up the work

A Claude Code agent can hand parts of a task to sub-agents (its Agent tool), several at once, and they can keep working after its own turn ends. Crew shows them as they happen:

- **In the chat**, the agent's line grows a branch per sub-agent: its kind (Explore, Plan, general…), its job, the step it's on, how many steps it has taken and for how long. Finished ones tick off and fade. An agent whose turn is over but whose sub-agents are still busy reads "free, its sub-agents are still working".
- **Around its creature**, in the pill, the sidebar and the terminal header, little dots circle it, one per running sub-agent. The sidebar row and the terminal header also get a count you can hover for their jobs.
- **Under its reply**, "Used 2 sub-agents" opens into what each one did, with steps and time.

It comes from Claude Code's hooks (the Agent tool's PreToolUse, SubagentStart and SubagentStop, and each sub-agent's own tool calls), so it needs a Claude Code recent enough to send those; older ones just don't show sub-agents. Codex agents don't report sub-agents.

## Conversations: how full they are, and starting fresh

Every agent shows how full its current conversation is: a little ring that fills up and turns amber past half and red past 80%. It's on the agent's card, in its terminal header, and in the sidebar once it's past half. Hover it for the numbers: tokens used of the model's window (or of its context limit), tasks in this conversation, and whether it has compacted. A compacted conversation (the CLI summarized older details to make room) gets a dashed ring.

- **New conversation** gives an agent a clean slate: its instructions, folder and the crew's notes stay, the old conversation stays in the CLI's history. It's the ✦ button in the terminal header and in the agent's card (**Conversation** shows the gauge, the numbers and advice). A busy agent finishes its current task first.
- **Send a task fresh.** The **New conversation** toggle under the message box sends your message into a new conversation instead of adding it to everything the agent did before. It's for that one message: the toggle turns off, and the box stays in the new conversation as a reply ("Continuing the new conversation with marc"), so what you send next goes on in it.
- **Context limit.** A model with a huge window (say 1M) can run one conversation for a very long time. Under **Conversation** in the agent's card, set its own limit (100k, 250k, or any number) and what happens when a conversation passes it:
  - **New conversation** (the default): it finishes what it's doing, then starts fresh. Its instructions, folder and the crew's notes stay.
  - **Just tell me**: a notification and an orange line in the chat, and you decide.

  The ring, the numbers and the terminal footer then measure against the limit, so 200k of a 250k limit reads 80%. It fires once per conversation, and again if the conversation shrinks below the limit and grows past it later. In `config.json` it's `"contextLimit": 250000` and `"onContextLimit": "notify"`. Agent packs carry both.
- The feed draws a line where an agent's new conversation starts, and `/clear` typed in a terminal counts too.

Claude Code reports its context to the status line, which Crew points at itself, so its terminal footer shows `context 34% · 68k of 200k · 5 tasks in this conversation` (or `of 250k limit`). Codex agents are read from Codex's session log after each step.

## Computers: one crew across your Macs

Each agent runs on one computer. Link your computers and each one shows the whole crew: you can chat with any agent, watch and type into its terminal, edit it, and agents hand work to each other across computers. An agent on another computer shows up as **name@computer** (`gal@mac-mini`).

1. **On one computer:** click **Computers** in the dashboard titlebar, turn on **Share this computer**, and **Copy** the pairing code.
2. **On the other computer:** click **Computers**, paste the code under **Link a computer**, and press **Link**.
3. **Choose what to use.** The dialog lists the linked computer's agents. **Use** decides which ones show up in this computer's crew; the rest keep running there. **Move here** opens the agent's card set to run on this computer: check its folder and **Save**.

The link works both ways, so the first computer sees the second one's agents too. Link more computers the same way. Linked computers reconnect on their own after a restart or a network change.

- **Where an agent runs:** an agent's card shows **Runs on** once you have more than one computer. Pick another one and **Save** to move it. It keeps its instructions, reference images, look and work experience, but its conversation starts fresh there, because transcripts are files on the computer it left. New agents and imported agents can be put on any linked computer.
- **Addressing:** `@gal` finds gal wherever it runs; if two computers have a gal, the one on this computer wins, and you can write `@gal@mac-mini` for the other. `crew who` lists teammates on every linked computer, so agents use the same names.
- **Names:** each computer has a name (click it in the dialog to change it). Others see its agents as name@that-computer.
- **Networks:** the same Wi-Fi, or Tailscale. The code lists every address of the computer (LAN IP, Tailscale IP and MagicDNS name), and the other computer uses whichever one answers. The default port is 7787; to change it, set `"port"` in `~/.crew/link/link.json`.
- **Security:** the link is TLS with the sharing computer's own certificate, pinned by the code. The secret key in the code is only sent after the certificate checks out, so a fake computer on the same network can't take it. **New code** revokes the old one, and sharing is off until you turn it on. A link gives both computers full use of each other's agents, terminals included, so only link your own computers and keep the code to yourself. **Forget** unlinks a computer.
- **Good to know:**
  - A computer has to be awake for its agents to work. Crew keeps itself running while linked, but closing the lid still sleeps the Mac. While a computer is unreachable, its agents show as unreachable.
  - Folders are paths on the computer an agent runs on, so type them; the folder picker only browses this computer.
  - Theme, notifications and opening files stay per computer.

A Codex-backed agent runs in Codex's `workspace-write` sandbox with network access on, so `crew` can reach the app over localhost. Its status hooks are passed on the command line with `--dangerously-bypass-hook-trust`, so no hook-trust prompt blocks every launch. That flag also lets hooks defined in the agent's own repo run without review, the same trust model Claude Code uses.

## Files

Everything lives in `~/.crew/` (set `CREW_HOME` to move it):

- `config.json`: your agents, custom providers and theme. The UI writes it, you can edit it by hand (the `{ }` button), and changes apply live.
- `sessions.json`: which session each agent resumes.
- `stats.json`: each agent's work experience.
- `tickets.json`: the Tasks board.
- `conversations.json`: each agent's current conversation: when it started, tasks in it, compactions and how full it is.
- `link/`: Computers settings (this computer's name, sharing, linked computers, agents you chose not to use), the certificate and key, and a cache of images from agents on other computers.
- `board.md`: shared notes (`crew note`).
- `reads.json`: up to when you've read each agent's replies (the unread badges).
- `feed.jsonl`: the feed history.
- `attachments/`: images you've attached to messages and instructions.

```json
{
  "autopilot": true,
  "hotkey": "Alt+Shift+Space",
  "voiceHotkey": "Alt+Shift+D",
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
 UI windows (ui/*.html) ──IPC── main.js ── core/crew.js ── core/hub.js ── core/runner.js ── pty ── claude / codex
                                              │                 ▲                                     │
                    other computers ── core/link.js    core/server.js (127.0.0.1, token) ◄── hooks + `crew` CLI
```

- `core/providers.js` defines the brains: built-in providers, your custom ones, and Codex model discovery.
- `core/adapters.js` turns an agent into a command line for its CLI. That includes model, effort, YOLO, the crew system prompt plus the agent's instructions, and hooks that report status.
- `core/pill.js` places the floating pill's window: which side its chat opens on, keeping the pill where you left it, dragging, and tucking in against an edge.
- `core/voice.js` runs voice input. It builds `native/crew-voice.swift` (Apple's on-device `DictationTranscriber`) into `dist/crew-voice` on first use, streams the chat window's microphone audio into it, and returns what it hears as live events.
- `core/promptgen.js` drafts an agent's instructions headlessly with `claude -p` or `codex exec`, with no tools and nothing saved to your session history.
- `core/hub.js` is the logic, with no Electron in it:
  - status from hooks (start → free, prompt → working, stop → free plus the reply into the feed);
  - questions: an agent's `PermissionRequest` hook (permission prompts, AskUserQuestion, plan approval) waits on the `/ask` route until you answer the card in the chat (`ask`, `answer`), and prints your answer as its decision;
  - inboxes, routing, the feed and notes;
  - `update()`, the single edit path behind the editor and bulk edits.
- `core/runner.js` owns the pseudo-terminals.
- `core/crew.js` is the crew across your computers: this computer's hub plus every linked computer's agents, merged into one list, with each action sent to the computer the agent runs on.
- `core/link.js` is the link itself: pairing codes, the TLS server, the client, and one symmetric connection either side can call over.
- `core/pack.js` reads and writes agent packs (`.crew` files).
- `core/tickets.js` is the Tasks board: tasks, their history, and the briefs that triage and working agents get.
- `core/context.js` reads how full a conversation is, from Claude Code's status line or Codex's session log.
- `core/server.js` is a tiny local HTTP API for the hooks and `bin/crew`. Every request needs a per-launch token. `/ask` holds the request open until you answer, and notices when the hook gives up.
- `ui/` is plain HTML, CSS and JS with no build step. The main files:
  - `avatar.js` draws the creatures;
  - `voice.js` is dictation in the composer: the mic button, hold-to-talk, live text and the language switch (`voice-worklet.js` turns the microphone into 16 kHz audio);
  - `collection.js` is the card collection and editor;
  - `tasks.js` is the Tasks board, list and task panel;
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

# Crew guide

Everything Crew does, in detail. For the short tour, see the [README](../README.md).

Run a crew of AI coding agents side by side. Each agent has a **name**, an **area of work**, its own **instructions** (system prompt), a **brain** (provider, model, effort) and a little plush creature for a face. Agents hand tasks to each other and share context, so you can drop work on whichever agent is free instead of waiting for one prompt to finish.

Claude Code and Codex are built in. GLM and local open-weight models work too, and you can add any other provider.

You get three views:

- **Menu bar** (three little buddies): the crew, grouped by computer, one line per agent: its creature, its name and what it's doing. YOLO and ⚡ Fast show as small marks when they're on; hover a row for the YOLO, Fast and power switches. Agents that are off fold into one line ("3 off"). It scrolls once the crew is taller than the screen allows. Autopilot sits under the crew.
- **Floating pill** on the screen edge holds the crew as little creatures that hop while they work. A crew too big for the screen edge keeps the ones that need a look (waiting on you, new replies, at work) and folds the rest into **+N**. Click it, or press `⌥⇧Space`, to open the chat (or `⌥⇧D` to open it and start dictating). Click a creature for your conversation with that agent. The pill steps aside while the dashboard is open, and comes back with the chat open when you close or minimize the dashboard.
  - **Drag it anywhere** by its edge or by the chat's header. The chat opens on the side with room: on the left of the screen it opens to the right of the pill, on the right to the left, at the top below, at the bottom above. At the top and bottom the pill lies flat, like the Dock.
  - **It stays put:** dropped near an edge, it tucks in against it, and opening or closing the chat never moves it.
- **Dashboard**: the crew on the left, the view in the middle, the chat on the right.
  - **The sidebar** lists every agent by computer, in your order (a status change never moves a row). Fold a computer with its arrow; its header still counts who's working and who needs you. Off agents fold into one line. **Search** (`⌘F`) finds an agent by name or area, and **+** (`⌘N`) makes one. Click an agent for its terminal and your conversation with it in the chat (its card in the Crew view); click it again to go back to every terminal and everyone's messages. **Right-click** for everything else: message it, open its terminal, edit it, start a new conversation, move it to another computer, turn it off, remove it. **Drag** an agent onto another computer to move it there.
  - **Crew** is a Pokédex-style collection of agent cards, grouped by computer, where you create and edit agents. Big cards, compact cards (the default once the crew outgrows a screen), or **Stats** to compare them.
  - **Tasks** is a board of work for the crew (bugs, features, chores): each task gets a fresh conversation, and you review what comes back.
  - **Terminals** shows the agents' terminals, side by side (**Grid**) or one big (**Focus**). **Busy** narrows the grid to the agents at work or waiting on you. `⌘1` Crew, `⌘2` Tasks, `⌘3` the grid, `⌘4` focus.
  - **The ribbon** under each terminal's header says what you're looking at. These aren't terminal apps: Crew runs each agent's CLI in a pseudo-terminal and draws its output, replaying what it printed before the view opened. **Live** means typing goes straight to the agent; **Mirror** means it runs on a linked computer and streams here; **Replay** means it's still being redrawn; **Offline** (its computer can't be reached) and **Ended** (the CLI exited) are striped and dimmed, because that output is frozen. The ribbon also shows the brain and the terminal's size, and hovering it explains the rest.
  - The chat sits on the right. Under the last message, a line per agent at work says what it's doing; with a big crew it shows the ones waiting on you first, up to three, and folds the rest into one line of faces (click it for all). In a conversation with one agent, only that agent's line shows.

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
  - `npm run shots` renders every view, light and dark, with a made-up crew into `dist/shots` (PNGs plus GIFs of the animations). Nothing starts and `~/.crew` is untouched, so it's safe for checking UI changes. Add `--webp` for animated WebP copies of the animations (the README uses those), and `npm run shots -- cover` renders just the README's cover (`scripts/cover.html`).
- **One copy at a time:** opening Crew again brings up the one that's running.
- **Quitting doesn't stop the agents.** Their terminals live in a small process of their own, the terminal host (`core/ptyhost.js`), so an agent mid-task carries on while Crew is closed, crashes, or relaunches with new code (after you pull or merge a fix, say). Open Crew again and it picks every agent up where it is, with one line in the chat saying so: a reply it finished meanwhile shows up threaded to what it answered, and its queue, its clones and its teammates' questions are still there. While Crew is closed, agents can't reach each other (`crew send` and `crew ask` say Crew isn't running) and a permission prompt waits in the agent's terminal. **Quit** keeps them running; **Stop Agents and Quit** ends them, as quitting used to.
- **Theme:** the ☀️/🌙 button (dashboard titlebar or the menu bar popover) switches Light, Dark, or Auto (follow macOS). Terminals stay dark either way. The `{ }` button opens `config.json` in your text editor.

## The crew collection

- **Every card shows its area** under the name, so you can see who does what at a glance. Compact cards show the creature, the name and what it's doing; hover for the rest.
- **Click a card** to open its sheet. On the left is who it is: its creature (click it to change its look), name, area, level, a glance at its work and how full its conversation is, with **Terminal** and **More** (export, move, remove). On the right, four tabs that each fit on the screen without scrolling. The tab you used last opens next time. `⌘S` saves, `Esc` closes.
  - **Setup**: the brain (provider, model and effort; the options shown depend on the provider, and Codex lists its live models and each model's effort levels), YOLO, Fast and power side by side, the computer it runs on (**Move…**), its folder and extra CLI flags, its context limit, and **Clones**: how many clones it may run at once when it's busy (see below);
  - **Instructions**: the system prompt layered on top of the crew basics. Press **Write it** and the agent's own brain (Claude or Codex) drafts one from its name and area, including what to hand off to which teammate. The draft runs in the agent's folder, so it can pick up the project's CLAUDE.md or AGENTS.md. It takes **reference images** too, such as mockups, brand guides or screenshots: **+ Reference image**, or paste or drop them on the instructions. The agent opens them when relevant;
  - **Look**: body, color, eyes, mouth, accessories and blush, each shown as a tiny version of the agent, with the big one on the left as the preview. Or **Shuffle**;
  - **Stats**: its level, how it compares with the rest of the crew, and its last two weeks.
- **Save** applies the changes. If you changed something the agent launches with (area, instructions, brain, folder, flags, YOLO), the agent restarts and resumes its session. Edited instructions apply to the ongoing conversation too. If it's mid-task, it waits until it's free first.
- **Select** turns on bulk mode. Pick cards, or press **All**, then set provider, model, effort, YOLO or power for all of them at once, or **Export** them.
- **+ New agent** opens a blank sheet with a random creature. Pick the computer it should run on under **Setup**.

## Sharing agents: export and import

An agent pack is a `.crew` file holding one or more agents: name, area, instructions, reference images, brain (provider, model, effort, fast), YOLO, extra flags and look, plus any custom provider they use. Folders, sessions and work experience stay behind.

- **Export:** open an agent and press **Export**, or **Select** several and press **Export** in the bar. The file is saved where you choose and shown in Finder.
- **Import:** press **Import** on the Crew page, drop a `.crew` file on the window, or double-click one in Finder. For each agent you choose whether to take it, what to call it (names already in use get a free one), which folder it works in and which computer it runs on. Imported agents start switched off, so you can look them over before they run. A pack never overrides providers you already have.

## How you use it

- **Talk to one agent.** Click its face or name on any message, its creature on the **To** line above the message box, or its creature in the pill. The chat becomes your conversation with it: what the two of you said, its questions, the hand-offs it made or got, and what happened to its tasks. A header says who it's with and what it's doing, with a button for its terminal.
  - **Everything you send there goes to that agent**, so you can't drift into talking to someone else by accident. `@mention` someone to bring them in: they get that message too. A `task:` you type there is that agent's, unless you `@name` someone else.
  - **All** (top left) goes back to everyone's messages, and so does clicking the agent again (its face, its creature on the **To** line, in the pill or in the sidebar). Its count is for new replies from the rest of the crew, and an orange dot means one of them needs you. A link to a message outside the conversation (a quote, "replied", **Answer**) goes back to everyone's messages and shows it.
  - **Clones** share their agent's conversation. Clicking a clone sends what you write to that clone in particular.
  - **Each conversation keeps its own draft.** What you were typing, its images and the message you were replying to wait there while you look elsewhere, and come back when you return.
  - **An agent that's off** keeps its conversation for reading; it takes messages again once it's back on. One that moves to another computer keeps it too.
  - **Task** on the **To** line adds to the board from everyone's messages; `task:` inside a conversation is the way to give that agent one.
  - In the dashboard, opening an agent's terminal from the sidebar opens your conversation with it in the chat too.
  - With a big crew the **To** line shows just the creatures (hover one for its name and status), and scrolls once even those don't fit. **Auto** is everyone's messages, where Crew picks who takes each one; `@david …` there goes to david alone.
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
- **Point at a folder:** drop it from Finder onto the chat and its path goes into the message where the cursor is, in backticks, for the agent to look in.
- **Message "Auto".** Without explicit recipients, Crew scores the task against agents' areas, then prefers whoever is free. Coordination wording such as “orchestrate multiple agents”, “organise the crew” and “keep things in working order” also matches an organiser area such as Arie's. This uses a fixed vocabulary of stems and phrases, not unrestricted language understanding; unfamiliar wording can miss, and incidental coordination language can favor the organiser. Use a chip or `@mention` to choose explicitly.
- **Busy agent?** The message is queued and typed in for you the moment that agent finishes. An agent with clones doesn't make you wait: a clone of it takes the message (see below).
- **One request, one bubble.** A new multi-recipient message from you appears once in the feed, addressed to everyone who received it. Replies from each recipient link back to that bubble. Separate sends remain separate, even with identical text. Older history without a send identifier stays unmerged; teammate hand-offs remain separate for approval.
- **Agents delegate.** Each agent knows its teammates and can run:
  - `crew ask <name> "question"` when it needs something back, and `crew answer "…"` to answer one (see [Right of way](#right-of-way-when-agents-need-each-other));
  - `crew send <name> "task"` to hand off work, or `crew send david,joseph "task"` for several recipients;
  - `crew note "fact"` to share context;
  - `crew who` to see the crew;
  - `crew board` to read shared notes;
  - `crew task …` to work the Tasks board (see below).

  Every hand-off and reply shows up in the feed, with the agent's face beside it.
- **Threads.** Each reply, and each hand-off an agent makes while working on your request, quotes the message it answers, with a bar in its sender's color. Click the quote to jump back. Your messages link forward too ("↪ @joseph replied"), so with several messages and several agents in flight you can always tell what answers what. Prompts you type directly into an agent's terminal show up in the feed too, tagged *in terminal*.
- **Rich text.** Replies render Markdown: bold, italics, `code`, code blocks, lists, quotes, links and pipe tables (links open in your browser). Tables need a header and delimiter row with matching column counts; alignment colons are supported. Escape literal pipes as `\|`, including inside inline code. Wide tables scroll horizontally; multiline cells are not supported. Long replies fold with a fade; click to unfold.
- **Autopilot off** makes hand-offs between agents wait in the feed until you click **Send it** or **Drop**.
- **Reply to a message.** Hover it and press **Reply**. The message box shows what you're answering, linked to it in the feed. If it's an older message, the agent gets a short note saying which one ("replying to your message …").
  - **A message from one agent** (or yours to one agent) opens your conversation with that agent, with the message still in view. Inside a conversation, Reply only quotes: the message goes to the conversation's agent, and quoting another agent's hand-off tells it whose message you mean.
  - **One of yours sent to several** stays in everyone's messages and goes to all of them. The box stays in that thread: what you send next answers the newest message in it.
  - **Esc** or **×** stops replying.
- **Unread replies.** A reply you haven't seen yet has a blue dot, and a **New** line marks where the unread ones begin. Each agent's creature wears a count (in the pill, the **To** line and the sidebar), the pill's mark shows the total, and the dashboard title bar says "2 new". A reply counts as read once it has been on screen for a moment while the window has focus. Clicking a creature in the pill opens your conversation with it at its first unread reply. Crew remembers this in `~/.crew/reads.json`.
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

## Clones: one agent, several tasks at once

Give an agent clones and a second task no longer waits for the first to finish. When it's busy, the next message (or task from the board) goes to a **clone**: the same agent, with its instructions, brain, folder and look, in a terminal and conversation of its own. Turn it on in the agent's sheet, under **Setup** → **Clones at once**, and pick how many may run at once (1 to 5).

- **Who takes what:** the agent itself when it's free, then a clone that's free, then a new clone if there's room. With every one of them busy, the message waits in the agent's queue and the first to finish takes it.
- **How they look:** a clone wears its agent's face with its number, `marc ②`. It pops out next to its agent in the pill, gets a slim line under the agent's row in the sidebar and the menu bar (click it for its terminal, right-click to send it away), peeks out from behind the agent's card, shows on the left of the agent's sheet while it works, and has its own terminal right after the agent's. The feed says which one answered.
- **Talking to one:** a clone is `marc.2` to the crew. Its hand-offs say `[from @marc.2]`, so teammates answer the clone that asked, and an answer to something a clone asked goes back to it even when it's addressed to `marc`. Click a clone in the pill or the feed to message it directly: you're in its agent's conversation, aimed at that clone.
- **When they go:** a clone with nothing left to do goes away after 5 minutes (not while a teammate is still working on something it asked). The × on its terminal sends it away sooner; anything still queued for it goes back to its agent. Turning the agent off ends its clones, and lowering its number ends the spare ones once they're free.
- **What carries over:** a clone's work counts toward its agent's experience, a task a clone finishes is the agent's on the board, and **Send back** reaches the clone still in that conversation if it's around. Its conversation isn't kept after it goes.
- **Same folder:** clones work in the agent's folder at the same time, so they suit tasks that don't touch the same files. Each clone is told that other copies may be working beside it.

In `config.json` it's `"clones": 2`. Agent packs carry it. Clones run on the computer their agent runs on.

## Right of way: when agents need each other

Agents that depend on each other can stall a crew. Two of them each wait for the other. An answer never finds its way back. Work goes back and forth between two agents who each think it's the other's. Two agents edit the same file. A task sits with an owner who said no. Crew settles all of these by rule, the moment they come up, instead of leaving the agents to sort it out.

- **Questions come back.** `crew ask joseph "which port does staging use?"` asks a teammate and waits for its answer, right there in the asker's turn. Nobody has to remember to reply, and nobody polls.
  - **It reaches a busy teammate too.** Crew types the question into the turn it's in, and the teammate's CLI takes it in at its next step (between two tool calls; Claude Code and Codex both do this). It answers with `crew answer "…"` and carries on with what it was doing. So the asker waits about as long as one step takes, usually well under a minute, not until the teammate has finished its task.
  - **A free teammate** gets the question as its next prompt, and its final message is the answer.
  - **Questions go first.** One waiting for a teammate that can't take it in right now (a permission prompt is up in its terminal, or you're typing there) is first in line, and goes in as soon as that clears.
  - **Taking longer?** After about 100 seconds `crew ask` says where things stand and lets the asker carry on. The answer still comes, into the asker's turn or as its next prompt. `crew wait` waits some more.
  - **It always hears back.** If the teammate is interrupted, exits, is restarted or is turned off before it answers, the asker is told so instead of waiting.
- **Nobody waits in circles.** Whoever is being waited on never waits on its waiter. If joseph is waiting on arie's answer and arie tries to `crew ask joseph`, Crew turns that down on the spot and tells arie to answer first, with what it knows. The same goes down a line (joseph waits on arie, arie on david: david can't wait on joseph). So two agents can never end up waiting on each other.
- **No handing back.** An agent can't `crew send` work back to a teammate that's waiting on its answer. It puts what it would have sent in the answer, which goes back by itself. That's one hop, not a round trip.
- **One file, one editor.** The first agent to edit a file (Claude Code's Edit and Write, Codex's patches) holds it until its turn ends. Anyone else who tries is turned away and told who has it, so an agent and its clones, or two agents in one folder, never write over each other. An agent answering the holder's question may edit its files, since the holder is waiting on it rather than editing.
- **One user per simulator.** Things that aren't files work the same way: the iOS simulator, a phone, a dev server's port, an API that rate-limits the whole office. `crew lease simulator "QA pass for #12"` takes it before using it. If a teammate has it, `crew lease` waits for it (about two minutes, like `crew ask`), then says who has it and what for, and the agent carries on with other work instead of taking over the teammate's simulator. It's the holder's until `crew release`, until its turn ends with nothing of its left running in the background, or until its CLI stops. `crew leases` lists who has what, the sidebar shows it next to the agent's name, and from your own terminal you can take one too (it stays yours until you release it). Names are case-insensitive, so agents only need to agree on the word.
- **Nothing left running.** Every command an agent runs leaves its process group behind with Crew (Claude Code runs each one through `bin/crew-sh`; for Codex, Crew looks at the agent's process tree now and then). When the agent's CLI ends (it exits, is turned off, or restarts for a new conversation), whatever is still running in those groups is stopped: the Metro server it started with `&`, the simulator helpers. The chat says what, in one line (*@levi left 3 processes running (node, idb_companion ×2), so Crew stopped them*). Crew itself and what other agents run are never touched, and a process that only reused an old number is left alone. If Crew wasn't running when a CLI ended, it cleans up on its next start.
- **One owner.** A message sent to several agents names the first one as the lead: it owns the result, and the others each take the part in their own area. A hand-off is the recipient's from then on, with no need to report back. A task's owner who can't take it runs `crew task decline`, and it goes straight to the next agent whose area it is (never back to one that declined it), or back to To do for you, with a notification.
- **One builder per piece of work.** Before an agent builds something, it checks that nobody else is building it already: the board, open PRs, and branches or worktrees named for it. If someone is (a teammate, a clone, or another Claude session), it asks instead of starting a second build. It works only in a worktree or branch it made, or one its owner handed it. News goes in `crew note`, not `crew send`, because a busy teammate starts a clone for anything sent to it.
- **A lost connection doesn't stop the work.** When an API error cuts a turn short (a dropped connection, a busy server), Crew types "continue" for the agent after 20 seconds, then 1 and 3 minutes if it happens again. The turn goes on answering the same message. A usage limit, a login or a billing problem, or a fourth failure in a row, calls you instead.
- **Hand-offs that pile up go in together.** Several teammates' hand-offs waiting for a busy agent go in as one prompt when it's free, so it reads them side by side in one turn, not one turn each. Messages that crossed are read together instead of answered one at a time. Your own messages and tasks still get a turn each.

In the chat:

- An agent waiting on a teammate rests instead of hopping, and says so in calm indigo (not the orange of "needs you"): *waiting on @joseph · 2m* in the sidebar, the menu bar, its card and its terminal header. Under the last message, its line shows who it's waiting on, what it asked and for how long; click it for the question. The teammate's line shows the faces of whoever waits on it. The titlebar counts them: *1 waiting*.
- A question shows who asked whom, *waiting* while the asker holds on, and then *@joseph answered in 24s*. The answer is threaded to it, marked with who it went back to.
- When Crew steps in, it's one quiet line with a yield sign, such as *@arie is waiting on @joseph, so @joseph answers first instead of asking back*. Hover it for the rule.

Agents learn all of this from the crew basics in their instructions:

```
crew ask <name> "..."     ask a teammate and wait for its answer (it reaches them mid-task)
crew answer [@name] "..." answer a question you were asked, right away, and carry on
crew wait                 keep waiting for the answers to what you asked
crew send <name> "..."    hand work to a teammate for good: nothing comes back
crew lease <thing> "..."  take the simulator, a device or a port before using it (waits if a teammate has it)
crew release [thing]      give it back
crew task decline <n> "why"   a task that isn't yours goes to the next owner by area
```

`node scripts/handoffs.mjs` reads your own history (`~/.crew/feed.jsonl` and `stats.json`) and shows what hand-offs between your agents have cost: how long a question took to come back, how much of that was a teammate finishing something else first or an answer waiting for its asker, and the turns spent on acknowledgements and messages that crossed.

## Tasks: one conversation per task

Handing an agent task after task fills one conversation with unrelated work, and long mixed-up conversations are where agents start getting things wrong. The **Tasks** board (`⌘2`) keeps adding, sorting and doing apart, and runs each task in a **fresh conversation** with just that task in it.

**To do → In progress → Review → Done.**

1. **Add.** Type in the bar at the top and press Enter. Pick the kind first (**Task**, **Bug** or **Feature**), write `@name` to give it to someone, and paste or drop screenshots. From the chat: the **Task** chip, or start a message with `task:`, `bug:` or `feature:`.
2. **Triage** (optional, under **Workflow**). A triage agent turns what you typed into a clear task (steps, priority, kind), gives it to the agent whose area it is, and spots duplicates (`×3` on the card). Your own words stay on the task and go to whoever does it, so paths and commands survive the rewrite. Without a triage agent, a task goes to whoever's area matches; naming an `@owner` skips triage.
3. **Start.** **Start** on a card (or dragging it to **In progress**) hands it to its owner: Crew starts that agent a new conversation and gives it the task. A busy owner finishes what it's doing first. **Start all** starts every assigned task, each in its own conversation, and **Auto-start** (under **Workflow**) starts tasks as soon as they have an owner. While it works, the card shows what the agent is doing and how full its conversation is. It checks its work and runs `crew task done`; if it can't tell what's wanted or where, it asks with `crew task note` instead of guessing. An agent that's turned off can't be given a task by a teammate (triage picks someone who's on). One you give it yourself waits, marked **off** on its card, and with **Auto-start** it starts as soon as you turn that agent back on.

   **A task that stalls.** Sometimes a turn ends with the task half done ("I'll take the screenshots once it settles") and nothing calls the agent back. When the agent on a task has been idle for 10 minutes with nothing queued, nothing it's waiting on and no word on the task, Crew reminds it once: carry on, or say what's in the way with `crew task note`. If it stops again without finishing, if its last reply asked you something, or if no conversation is on the task any more, you get one line in the chat and a notification, and the card says **stalled**. Something it left running in the background (a build) gives it 30 minutes. Set `"stallMinutes"` in `config.json` to change the wait, or `0` to turn this off.

4. **Review.** Finished tasks land in **Review** with what was done and how it was checked, and you get a notification. **Accept** closes it; **Send back** returns it with your note, into the same conversation, so the agent keeps everything it tried.

**Board or list**, filtered by kind, by owner (their creatures above the board) or by search. **Done** folds into a slim column; click it to open. Open a task to change its status, priority, kind or owner from their menus, edit the title and description (Markdown), add attachments and notes, mark it the same as another task, and follow everything that happened to it. The feed shows each step as one line; click it to open the task. Tasks added on a linked computer show up too, marked with that computer.

**Many at once.** `⌘`-click tasks to pick them, `Shift`-click to pick a run of them, or use the select-all at the top of a column (`⌘A` picks everything shown). A bar at the bottom acts on all of them: **Start** (each owned one in its own new conversation), **Assign**, **Priority**, **Move to**, **Close** and **Delete**. Dragging one of them drags them all. `Esc` lets them go. For work you finished somewhere else, the **⋯** at the top closes every open task in one go, and **Clear Done** deletes everything in Done. Either way the chat gets one line ("You closed 23 tasks"), not one per task, and tasks on a linked computer are changed there.

Agents can use the board themselves:

```
crew task list                    open tasks
crew task show <n>                one task in full: details, screenshots, notes
crew task done <n> "..."          what was done (or what was wrong), how it was checked
crew task note <n> "..."          a finding (unclear, can't reproduce, a clue)
crew task decline <n> "..."       not mine: it goes to the next owner by area, or back to you
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

- **New conversation** gives an agent a clean slate: its instructions, folder and the crew's notes stay, the old conversation stays in the CLI's history. It's the ✦ button in the terminal header and beside the gauge in the agent's sheet. A busy agent finishes its current task first.
- **Send a task fresh.** The **New conversation** toggle under the message box sends your message into a new conversation instead of adding it to everything the agent did before. It's for that one message: the toggle turns off, and the box stays in the new conversation as a reply ("Continuing the new conversation with marc"), so what you send next goes on in it.
- **Context limit.** A model with a huge window (say 1M) can run one conversation for a very long time. Under **Conversation** in the agent's sheet (**Setup**), set its own limit (100k, 250k, or any number) and what happens when a conversation passes it:
  - **New conversation** (the default): it finishes what it's doing, then starts fresh. Its instructions, folder and the crew's notes stay. A turn also ends while an agent waits on something it left running (a build, a dev server, a sub-agent), so Crew waits for those, or for its next task, before the new conversation. Then it asks the agent where things stand. If the task isn't finished, the agent's answer (worktree, what's done, what's left) is the first thing it reads in the new conversation, so the work carries on instead of stopping half-way.
  - **Just tell me**: a notification and an orange line in the chat, and you decide.

  The ring, the numbers and the terminal footer then measure against the limit, so 200k of a 250k limit reads 80%. It fires once per conversation, and again if the conversation shrinks below the limit and grows past it later. In `config.json` it's `"contextLimit": 250000` and `"onContextLimit": "notify"`. Agent packs carry both.
- The feed draws a line where an agent's new conversation starts, and `/clear` typed in a terminal counts too.

Claude Code reports its context to the status line, which Crew points at itself, so its terminal footer shows `context 34% · 68k of 200k · 5 tasks in this conversation` (or `of 250k limit`). Codex agents are read from Codex's session log after each step.

### Usage limits

On a Claude subscription, the same status line says how much of the account's 5-hour and weekly limits is used, so Crew shows that too: `5h 64% · week 38%` in the dashboard's title bar and the menu bar, next to the ring in each Claude agent's terminal header and sheet, and at the end of its terminal footer (`· 5h limit 64%`). The numbers turn amber and red like the ring, and hovering them says when each limit resets. Agents on one provider share its account, so the newest reading from any of them counts; a limit drops off once it resets, until the next reply reports the new one. Codex, GLM and local models don't report limits this way, so their agents show none.

- **Heads-ups.** When a limit passes 80%, and again at 95%, the chat gets one line and you get a notification ("Claude is at 95% of its 5-hour limit, resets at 15:00"). Once per limit until it resets.
- **Routing.** While a provider is at 90% or more of its 5-hour or weekly limit, a message or task Crew routes for you goes to an agent on another provider when one covers the area just as well. It never sends work outside an agent's area because of a limit, and messages you address to an agent always go to it.

## Computers: one crew across your Macs

Each agent runs on one computer. Link your computers and each one shows the whole crew: you can chat with any agent, watch and type into its terminal, edit it, and agents hand work to each other across computers. An agent on another computer shows up as **name@computer** (`gal@mac-mini`).

1. **On one computer:** click **Computers** in the dashboard titlebar, turn on **Share this computer**, and **Copy** the pairing code.
2. **On the other computer:** click **Computers**, paste the code under **Link a computer**, and press **Link**.
3. **Choose what to use.** The dialog lists the linked computer's agents. **Use** decides which ones show up in this computer's crew; the rest keep running there. **Move to…** on an agent moves it to another computer, this one included (see below).

The link works both ways, so the first computer sees the second one's agents too. Link more computers the same way. Linked computers reconnect on their own after a restart or a network change.

- **Where an agent runs:** the sidebar groups the crew by computer. Clones stay with their agent's computer: moving an agent ends the clones it has at work (the move sheet says so). To move an agent, **drag** it onto another computer in the sidebar, **right-click** it and pick **Move to …**, or press **Move…** under **Setup** in its sheet. It works from any computer to any other (this one, a linked one, or between two linked ones, which don't need to be linked to each other), so you never have to walk over to the other Mac. A sheet shows where it's going, asks for its folder there (checked on that computer as you type, with that computer's folders to pick from), and says what comes along and what can't. It takes its instructions, reference images, look and work experience, its queued messages, its lines in the chat and its conversation: Crew stops it, copies its Claude Code transcript (or Codex session log) to the other computer, and it resumes there. New agents and imported agents can be put on any linked computer.
  - **What it's told:** an agent that was working when it moved gets a message once it's up there, saying where it came from, what it was working on, and that whatever it had running on the old computer (dev servers, simulators, builds, background shells) didn't come along, so it checks where things stand before carrying on. An agent that was free isn't interrupted: the note goes on top of the next message it gets. The chat shows "moved from … to …, with its conversation".
  - **When the conversation can't come:** it isn't found, it's over 256 MB, or the other computer runs an older Crew. The agent still moves and starts a new conversation there, and Crew says why. Messages sent to an agent while it's moving are turned away with "send it again in a moment"; if the move fails, it carries on where it was.
  - **Its folder** is a path on the computer it moves to, which may be a different checkout: by default the same path as now, and moving a running agent needs that folder to exist there (the sheet shows a ✓ or a warning before you move). Claude Code keeps conversations per folder, so the transcript goes under the new folder's project. Claude's auto memory for a folder, and anything outside the conversation (files you didn't commit, background processes), stay on the old computer.
- **Addressing:** `@gal` finds gal wherever it runs; if two computers have a gal, the one on this computer wins, and you can write `@gal@mac-mini` for the other. `crew who` lists teammates on every linked computer, so agents use the same names.
- **Names:** each computer has a name (click it in the dialog to change it). Others see its agents as name@that-computer.
- **Networks:** the same Wi-Fi, or Tailscale. The code lists every address of the computer (LAN IP, Tailscale IP and MagicDNS name), and the other computer uses whichever one answers. The default port is 7787; to change it, set `"port"` in `~/.crew/link/link.json`.
- **Security:** the link is TLS with the sharing computer's own certificate, pinned by the code. The secret key in the code is only sent after the certificate checks out, so a fake computer on the same network can't take it. **New code** revokes the old one, and sharing is off until you turn it on. A link gives both computers full use of each other's agents, terminals included, so only link your own computers and keep the code to yourself. **Forget** unlinks a computer.
- **Good to know:**
  - A computer has to be awake for its agents to work. Crew keeps itself running while linked, but closing the lid still sleeps the Mac. While a computer is unreachable, its agents show as unreachable.
  - Folders are paths on the computer an agent runs on. The folder picker only browses this computer; for another one, type the path or pick one of its folders in the move sheet. Crew checks it's there before it moves a running agent.
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
- `usage.json`: each provider's usage limits as last reported, and which heads-ups you've had (so the UI isn't blank until the next reply).
- `feed.jsonl`: the feed history.
- `attachments/`: images you've attached to messages and instructions.
- `run/groups/`: the process groups each running agent's commands started, a file per launch, so what they leave running can be stopped when they end.
- `run/pty.sock`, `run/pty.token`, `run/ptyhost.log`: the terminal host's socket (yours only), its key, and its log.
- `runtime.json`: what Crew knows about each agent at work (what it's answering, its queue, its clones, questions between agents), so it can pick them up after a restart.
- `spool/`: hook events agents sent while Crew was closed, replayed when it starts.
- `workspaces/<id>/`: a workspace's own copies of the files about a project (`feed.jsonl`, `board.md`, `tickets.json`, `sessions.json`, `conversations.json`, `reads.json`, `stats.json`, `runtime.json`, `spool/` and `run/groups/`). The default workspace's are the ones above, in `~/.crew/` itself.

```json
{
  "autopilot": true,
  "hotkey": "Alt+Shift+Space",
  "voiceHotkey": "Alt+Shift+D",
  "agents": [
    { "name": "gal", "area": "UI/UX design", "provider": "claude", "model": "fable", "effort": "high", "cwd": "~/code/app",
      "avatar": { "body": "heart", "color": "pink", "eyes": "sparkle", "mouth": "cat", "hat": "bow", "cheeks": true } },
    { "name": "david", "area": "React Native client", "provider": "codex", "model": "gpt-6-luna", "yolo": true, "clones": 2, "cwd": "~/code/app" }
  ]
}
```

An agent without an `avatar` gets a stable one picked from its name. `off: true` keeps an agent saved but not running. `clones` is how many clones it may run at once when it's busy. `args` are extra flags passed straight to the CLI.

To use `crew` from your own terminal as well, run `ln -s "$PWD/bin/crew" ~/.local/bin/crew`.

## How it works

```
 UI windows (ui/*.html) ──IPC── main.js ── core/crew.js ── core/hub.js ── core/ptyclient.js ══ core/ptyhost.js ── pty ── claude / codex
                                              │                 ▲          (Unix socket)   (outlives Crew)            │
                    other computers ── core/link.js    core/server.js (127.0.0.1, token) ◄── hooks + `crew` CLI ───────┘
```

- `core/providers.js` defines the brains: built-in providers, your custom ones, and Codex model discovery.
- `core/adapters.js` turns an agent into a command line for its CLI. That includes model, effort, YOLO, the crew system prompt plus the agent's instructions, and hooks that report status.
- `core/pill.js` places the floating pill's window: which side its chat opens on, keeping the pill where you left it, dragging, and tucking in against an edge.
- `core/voice.js` runs voice input. It builds `native/crew-voice.swift` (Apple's on-device `DictationTranscriber`) into `dist/crew-voice` on first use, streams the chat window's microphone audio into it, and returns what it hears as live events.
- `core/promptgen.js` drafts an agent's instructions headlessly with `claude -p` or `codex exec`, with no tools and nothing saved to your session history.
- `core/workspaces.js` reads what each workspace is made of from `config.json`: its members and its own agents, each agent's folder and on/off there, and its settings. `core/config.js` reads and writes `config.json` for every workspace's hub at once.
- `core/hub.js` is the logic for one workspace, with no Electron in it:
  - status from hooks (start → free, prompt → working, stop → free plus the reply into the feed);
  - questions: an agent's `PermissionRequest` hook (permission prompts, AskUserQuestion, plan approval) waits on the `/ask` route until you answer the card in the chat (`ask`, `answer`), and prints your answer as its decision;
  - inboxes, routing, the feed and notes;
  - right of way: `crew ask` and its answer coming back (`question`, `respond`), typing questions into a busy agent's turn (`steer`), who may wait on whom (`mayWait`), the order a queue is taken in (`queue`, `nextUp`), one editor per file (`lease`) and declined tasks (`decline`);
  - clones: which of an agent and its clones takes a message (`placeFor`), starting and retiring them;
  - `update()`, the single edit path behind the editor and bulk edits.
- `core/runner.js` owns the pseudo-terminals in Crew's own process; `core/ptyclient.js` is the same to the hub, with the terminals in the terminal host (`core/ptyhost.js`), a process of its own that outlives Crew. Crew connects to it over a Unix socket, and on start it adopts what's still running (`Hub.adopt`) and replays what the hooks spooled meanwhile (`Hub.replaySpool`).
- `core/crew.js` is the crew across your computers: a hub per workspace on this computer (all on one terminal runner, where `runner.js`'s `Scoped` names a workspace's terminals `workspace/agent`), plus every linked computer's agents, merged into one list, with each action sent to the computer the agent runs on.
- `core/link.js` is the link itself: pairing codes, the TLS server, the client, and one symmetric connection either side can call over.
- `core/pack.js` reads and writes agent packs (`.crew` files).
- `core/tickets.js` is the Tasks board: tasks, their history, and the briefs that triage and working agents get.
- `core/context.js` reads how full a conversation is, from Claude Code's status line or Codex's session log.
- `core/server.js` is a tiny local HTTP API for the hooks and `bin/crew`. Every request needs a per-launch token, and goes to the hub of the workspace its `X-Crew-Workspace` header names (an agent's `CREW_WORKSPACE`; none is the default). `/ask` holds the request open until you answer, and notices when the hook gives up; `/question` and `/wait` (`crew ask`, `crew wait`) do the same until a teammate answers. `/lease` is the file tools' check before they write.
- `ui/` is plain HTML, CSS and JS with no build step. The main files:
  - `avatar.js` draws the creatures;
  - `voice.js` is dictation in the composer: the mic button, hold-to-talk, live text and the language switch (`voice-worklet.js` turns the microphone into 16 kHz audio);
  - `collection.js` is the card collection and the agent's sheet;
  - `tasks.js` is the Tasks board, list and task panel;
  - `common.js` has shared pieces, including a small DOM patcher that keeps avatars animating smoothly across updates.

## Extending it

- **Another provider on an existing CLI:** add it under `providers` in `config.json`. No code needed.
- **Another CLI:** add a function to `core/adapters.js` that returns `{ file, args }`. Have that CLI's hooks call the same `curl` as the others, so status works.
- **More creature parts:** add entries to `BODIES`, `EYES`, `MOUTHS` or `HATS` in `ui/avatar.js`. The editor picks them up automatically.
- **A new UI action:** add a function to `actions` in `main.js`, then call `crew.call('name', …)` from any page.
- **A new crew CLI command:** add a route in `core/server.js` and a case in `bin/crew`.

## Limits worth knowing

- With Crew closed, agents keep working but can't hand work to each other or ask each other anything, and a question card can't reach you: Claude Code asks in its terminal instead. What their hooks report meanwhile is kept and replayed when Crew is back.
- If the terminal host itself goes (you stop it, or it crashes), the agents' CLIs go with it. They resume their conversations on the next launch, but a turn that was mid-flight is lost.
- One editor per file covers the file tools (Claude Code's Edit and Write, Codex's patches), not a file an agent rewrites from the shell (`sed -i`, `>`).
- A question reaches a busy agent at its next step. One that's in a single long command (a ten-minute build) sees it when that ends.
- Asking an agent on a linked computer needs Crew with right of way on both computers. An older one takes the question as a plain hand-off, and the asker is told the answer won't come back by itself.
- Clones share their agent's folder. Two clones editing the same files at the same time can step on each other.
- Codex agents are marked ready about 3 seconds after launch, because Codex only announces a session with its first prompt.
- If an agent looks stuck on "working" (for example after you interrupt it), click its status in the terminal header to mark it free.

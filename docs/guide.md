# CLIque guide

Everything CLIque does, in detail. For the short tour, see the [README](../README.md).

CLIque runs a team of AI coding agents side by side on your computer. Each agent has a **name**, an **area of work**, its own **instructions**, a **brain** (provider, model, effort) and a little plush creature for a face. Agents hand work to each other and share what they learn, so you can give a job to whichever agent is free instead of waiting for one prompt to finish.

The examples in this guide use a small made-up clique working on an online shop, the **Storefront** workspace: Ada (backend), Milo (frontend), Iris (design), Theo (testing), June (docs and release notes), Rex (builds and deploys) and Noor (code review), on two computers, a Mac called **Studio** and a PC called **Workstation**.

## Getting started

- **What you need:** a Mac (Apple silicon or Intel) or a Windows PC (Windows 10 or 11, x64 or Arm), and Claude Code or Codex installed and signed in with your own account. CLIque runs them for you; it doesn't need an account of its own. GLM and local open-weight models (through Ollama) work too, and you can add other providers.
- **Install:** on a Mac, open the DMG and drag CLIque into Applications. On Windows, run the installer: it installs CLIque for you alone, with shortcuts on the desktop and in the Start menu.
- **The first time you open it,** Q (see [below](#q-the-agent-every-workspace-comes-with)) asks what kind of work it is, makes your first workspace and suggests a clique for it. If neither Claude Code nor Codex can run on this computer yet, the screen says what to install or sign in to, with the command to paste.
- **One copy at a time:** opening CLIque again brings up the one that's running.
- **Quitting doesn't stop the agents.** Their terminals live in a small process of their own, the terminal host, so an agent in the middle of a task carries on while CLIque is closed, crashes, or restarts after an update. Open CLIque again and it picks every agent up where it is, with one line in the chat saying so: a reply it finished meanwhile shows up threaded to what it answered, and its queue, its clones and its teammates' questions are still there. While CLIque is closed, agents can't reach each other (`clique send` and `clique ask` say CLIque is not running) and a permission prompt waits in the agent's terminal. **Quit** keeps them running; **Stop Agents and Quit** ends them.
- **Theme:** the sun and moon button (in the dashboard's title bar, or the menu bar popover) switches Light, Dark, or Auto (follows your system). Terminals stay dark either way.

### Keyboard shortcuts

On Windows, ⌘ is Ctrl, and ⌥ and ⌃ are Alt: `⌥⇧Space` is Alt+Shift+Space, `⌘F` is Ctrl+F and `⌃1` is Alt+1.

| Keys | What it does |
|---|---|
| `⌥⇧Space` | Open the floating chat from any app (change it with `"hotkey"` in `config.json`) |
| `⌥⇧D` | Open the chat and start dictating (`"voiceHotkey"`) |
| `⌘1` `⌘2` `⌘3` `⌘4` | Dashboard views: Agents, Tasks, the terminal grid, one terminal |
| `⌘F` | Find an agent by name or area |
| `⌘N` | New agent |
| `⌃1` to `⌃9` | Jump to a workspace; `⌃Tab` and `⌃⇧Tab` go to the next and previous |
| `⌘S` / `Esc` | Save / close an agent's sheet |
| `⌘A` | Pick every task shown on the board |

## Three views

- **Menu bar** (on Windows, CLIque's icon in the taskbar): the clique, grouped by computer, one line per agent with its creature, its name and what it's doing. YOLO and Fast show as small marks when they're on; hover a row for the YOLO, Fast and power switches. Agents that are off fold into one line ("3 off"). It scrolls once the clique is taller than the screen allows. Autopilot sits under the clique.
- **Floating pill** on the edge of the screen holds the clique as little creatures. One that's working sits at a little laptop, typing. A clique too big for the screen edge keeps the ones that need a look (waiting on you, new replies, at work) and folds the rest into **+N**. Click it, or press `⌥⇧Space`, to open the chat (`⌥⇧D` opens it and starts dictating). Click a creature for your conversation with that agent. The pill steps aside while the dashboard is open, and comes back with the chat open when you close or minimize the dashboard.
  - **Drag it anywhere** by its edge or by the chat's header. The chat opens on the side with room: on the left of the screen it opens to the right of the pill, on the right to the left, at the top below, at the bottom above. At the top and bottom the pill lies flat, like the Dock.
  - **It stays put:** dropped near an edge, it tucks in against it, and opening or closing the chat never moves it.
  - **The notch:** drag the pill to the notch at the top of a MacBook's screen and it moves into it, with the chat hanging below. A screen without a notch gets a drawn one at the top middle, which works the same way.
- **Dashboard**: the clique on the left, the view in the middle, the chat on the right, and the workspace you're in at the top left (see [Workspaces](#workspaces-a-clique-per-project)).
  - **The sidebar** lists every agent by computer, in your order (a status change never moves a row). Fold a computer with its arrow; its header still counts who's working and who needs you. Off agents fold into one line. **Search** (`⌘F`) finds an agent by name or area, and **+** (`⌘N`) makes one. Click an agent for its terminal and your conversation with it in the chat (its card in the CLIque view); click it again to go back to every terminal and everyone's messages. **Right-click** for everything else: message it, open its terminal, edit it, start a new conversation, move it to another computer, turn it off, remove it. **Drag** an agent onto another computer to move it there.
  - **CLIque** is a collection of agent cards, grouped by computer, where you create and edit agents. Big cards, compact cards (the default once the clique outgrows a screen), or **Stats** to compare them.
  - **Tasks** is a board of work for the clique (bugs, features, chores): each task gets a fresh conversation, and you review what comes back.
  - **Terminals** shows the agents' terminals, side by side (**Grid**) or one big (**Focus**). **Busy** narrows the grid to the agents at work or waiting on you.
  - **The ribbon** under each terminal's header says what you're looking at. CLIque runs each agent's CLI in a terminal of its own and draws its output, replaying what it printed before the view opened. **Live** means typing goes straight to the agent; **Mirror** means it runs on a linked computer and streams here; **Replay** means it's still being redrawn; **Offline** (its computer can't be reached) and **Ended** (the CLI exited) are striped and dimmed, because that output is frozen. The ribbon also shows the brain and the terminal's size, and hovering it explains the rest.
  - The chat sits on the right. Under the last message, a line per agent at work says what it's doing; with a big clique it shows the ones waiting on you first, up to three, and folds the rest into one line of faces (click it for all). In a conversation with one agent, only that agent's line shows.

## The clique collection

- **Every card shows its area** under the name, so you can see who does what at a glance. Compact cards show the creature, the name and what it's doing; hover for the rest.
- **Click a card** to open its sheet. On the left is who it is: its creature (click it to change its look), name, area, a glance at its work and how full its conversation is, with **Terminal** and **More** (export, move, remove). On the right, four tabs that each fit on the screen without scrolling. The tab you used last opens next time. `⌘S` saves, `Esc` closes.
  - **Setup**: the brain (provider, model and effort; the options shown depend on the provider, and Codex lists its live models and each model's effort levels), YOLO, Fast and power side by side, the computer it runs on (**Move…**), its folder and extra CLI flags, its context limit, and **Clones**: how many clones it may run at once when it's busy (see below).
  - **Instructions**: what the agent should know about its job, on top of the clique basics. Press **Write it** and the agent's own brain (Claude or Codex) drafts them from its name and area, including what to hand off to which teammate. The draft runs in the agent's folder, so it can pick up the project's CLAUDE.md or AGENTS.md. It takes **reference images** too, such as mockups, brand guides or screenshots: **+ Reference image**, or paste or drop them on the instructions. The agent opens them when relevant.
  - **Look**: body, color, eyes, mouth, accessories and blush, each shown as a tiny version of the agent, with the big one on the left as the preview. Or **Shuffle**.
  - **Stats**: its level and number, how it compares with the rest of the clique, and its last two weeks.
- **Save** applies the changes. If you changed something the agent launches with (area, instructions, brain, folder, flags, YOLO), the agent restarts and resumes its session. Edited instructions apply to the ongoing conversation too. If it's in the middle of a task, it waits until it's free first.
- **Select** turns on bulk mode. Pick cards, or press **All**, then set provider, model, effort, YOLO or power for all of them at once, or **Export** them.
- **+ New agent** opens a blank sheet with a random creature. Pick the computer it should run on under **Setup**.

## Sharing agents: export and import

An agent pack is a `.clique` file holding one or more agents: name, area, instructions, reference images, brain (provider, model, effort, fast), YOLO, extra flags and look, plus any custom provider they use. Folders, sessions and work experience stay behind.

- **Export:** open an agent and press **Export**, or **Select** several and press **Export** in the bar. The file is saved where you choose and shown in Finder (Explorer on Windows).
- **Import:** press **Import** on the Agents page, drop a `.clique` file on the window, or double-click one. For each agent you choose whether to take it, what to call it (names already in use get a free one), which folder it works in and which computer it runs on. Imported agents start switched off, so you can look them over before they run. A pack never overrides providers you already have.

## Q: the agent every workspace comes with

Q is the queue in CLIque (CLI agent queue, CLI queue, CLIque) and the clique's own agent. Every workspace has him, whoever else works there.

- **What you send without naming anyone goes to him.** He answers it or gets it to whoever should do it, and tells you how it went. Name someone (`@ada`, or pick them on the **To** line) and it's a direct line to them.
- **He runs like any other agent:** a CLI in a terminal, in the chat, resting when idle. He works in an empty folder of his own, so no project's instructions load into him, and on Claude Code his one tool is the shell, where `clique` is the only command that runs without asking you.
- **What you can choose** is his brain (provider, model, effort) and whether he's on. He can't be removed, renamed, moved, cloned or left out of a channel. With Q off, a message with no name on it goes to whoever's area it matches (see **Message Auto** below).
- **Across computers:** a workspace shown from another computer has that computer's Q (`q@laptop`), and none of its own.

## How you use it

- **Talk to one agent.** Click its face or name on any message, its creature on the **To** line above the message box, or its creature in the pill. The chat becomes your conversation with it: what the two of you said, its questions, the hand-offs it made or got, and what happened to its tasks. A header says who it's with and what it's doing, with a button for its terminal.
  - **Everything you send there goes to that agent**, so you can't drift into talking to someone else by accident. `@mention` someone to bring them in: they get that message too. A `task:` you type there is that agent's, unless you `@name` someone else.
  - **All** (top left) goes back to everyone's messages, and so does clicking the agent again (its face, its creature on the **To** line, in the pill or in the sidebar). Its count is for new replies from the rest of the clique, and an orange dot means one of them needs you. A link to a message outside the conversation (a quote, "replied", **Answer**) goes back to everyone's messages and shows it.
  - **Clones** share their agent's conversation. Clicking a clone sends what you write to that clone in particular.
  - **Each conversation keeps its own draft.** What you were typing, its images and the message you were replying to wait there while you look elsewhere, and come back when you return.
  - **An agent that's off** keeps its conversation for reading; it takes messages again once it's back on. One that moves to another computer keeps it too.
  - **Task** on the **To** line adds to the board from everyone's messages; `task:` inside a conversation is the way to give that agent one.
  - In the dashboard, opening an agent's terminal from the sidebar opens your conversation with it in the chat too.
  - With a big clique the **To** line shows just the creatures (hover one for its name and status), and scrolls once even those don't fit. **Auto** is everyone's messages, where CLIque picks who takes each one; `@ada …` there goes to Ada alone.
- **Message several agents.** Use `@mentions` anywhere in the message, such as `@ada @milo the coupon field breaks checkout`. Type `@` and the clique pops up, filtered as you type (by name, then by area). Use ↑↓ to move and Enter or Tab to pick, or click one. The Tasks bar has the same list for assigning a task. Mentions add to the selected recipient on the **To** line; choose **Auto** to address only the mentioned agents. Each recipient gets one copy, however often it's mentioned, with the original message and a note naming the other recipients. Emails, package paths, possessives such as `@ada's`, and text in backticks don't address agents. An unknown, turned-off, or self recipient stops the whole send before anything is delivered. With Autopilot off, each hand-off between teammates waits for your OK.
- **Talk instead of typing.** Click the mic next to send and just talk. Your words appear in the message box as you speak, and it fixes them up as it goes. Or press `⌥⇧D` from any app: the chat opens and starts listening.
  - **Hold the mic** to talk and let go to stop, or click once to start and once to stop.
  - **Enter** stops and sends once the last words are in. **Esc** stops and leaves the text for you to edit. If it's slow to finish, a second Esc stops waiting and keeps what it has. In the floating chat the next Esc closes the panel.
  - **While it listens**, the line above the box shows who it's for and which language. Click the language to switch, for example English and Русский. It offers the languages set on your computer (System Settings › General › Language & Region on a Mac; Settings › Time & language › Language & region on Windows).
  - **Private:** dictation runs on your computer, so your voice never leaves it, and nothing is sent until you send it. On a Mac it's Apple's on-device dictation; on Windows it's OpenAI's Whisper speech model, which comes with CLIque and needs no internet.
  - **First use:** your computer asks once for the microphone. On a Mac, a language you haven't used for dictation before downloads first. On macOS 13 to 15, CLIque uses Apple's older recognizer, after asking for speech recognition permission, and offers only the languages it can do on the Mac itself.
  - **Linked computers:** dictation runs on the computer you're typing on, even when the clique lives on another one.
  - **Hotkey:** change it with `"voiceHotkey"` in `config.json`, or turn it off with `false`.
- **Add images** to any message: paste them (`⌘V`), drop them on the chat, or use the **+** button. They're saved in CLIque's `attachments` folder and sent to the agent as file paths. Claude Code and Codex both open them, with no permission prompt. Click a picture in the chat to open it.
- **Point at a folder:** drop it onto the chat and its path goes into the message where the cursor is, in backticks, for the agent to look in.
- **Message Auto.** Without explicit recipients, CLIque matches the message against agents' areas, then prefers whoever is free. Coordination wording such as "orchestrate multiple agents", "organise the clique" and "keep things in working order" also matches an organiser's area. This uses a fixed vocabulary of words and phrases, not full language understanding: unfamiliar wording can miss, and passing coordination words can favor the organiser. Pick a recipient or `@mention` one to choose yourself.
- **Busy agent?** The message is queued and typed in for you the moment that agent finishes. An agent with clones doesn't make you wait: a clone of it takes the message (see below).
- **One request, one bubble.** A message you send to several agents appears once in the chat, addressed to everyone who got it. Replies from each of them link back to that bubble. Separate sends stay separate, even with identical text. Hand-offs between teammates stay separate, so each can wait for your OK.
- **Agents delegate.** Each agent knows its teammates and can run:
  - `clique ask <name> "question"` when it needs something back, and `clique answer "…"` to answer one (see [Right of way](#right-of-way-when-agents-need-each-other));
  - `clique send <name> "task"` to hand off work, or `clique send ada,milo "task"` for several recipients;
  - `clique note "fact"` to share what it learned;
  - `clique post <channel> "message"` to say something in a channel it picks, whichever one it's working in, and `clique channels` to see them. It lands unread in that channel and takes up nobody's turn. An `@name` in it hands it to that teammate there. An agent can't post in a channel it isn't in, is given a channel's brief before its first post there, and doesn't need to post in the channel it's working in, where its final message goes anyway;
  - `clique canvas new "line" "line" ...` to draw a canvas in the chat instead of writing it out: a hand-drawn board of boxes and arrows, bars, ticks and crosses, a sticky note. Each line is one piece and there are no coordinates (`clique canvas help` lists them). The message says "via canvas". A teammate draws on the same canvas with `clique canvas add <id> "line"` (or `set` and `cut` for one line), the board in the chat changes where it stands, and the chat says who added to it. A ```` ```canvas ```` block in an agent's final message, or in a message you type, draws the same board;
  - `clique who` to see the clique;
  - `clique board` to read the shared notes;
  - `clique task …` to work the Tasks board (see below);
  - `clique app …` to change CLIque itself when you ask it to (see [Agent tools](#agent-tools-asking-an-agent-to-change-clique)).

  Every hand-off and reply shows up in the chat, with the agent's face beside it.
- **Threads.** Each reply, and each hand-off an agent makes while working on your request, quotes the message it answers, with a bar in its sender's color. Click the quote to jump back. Your messages link forward too ("@iris replied"), so with several messages and several agents in flight you can always tell what answers what. Prompts you type straight into an agent's terminal show up in the chat too, tagged *in terminal*.
- **Threads between agents.** What agents say to each other on the way (hand-offs, what they tell each other when they finish) goes in a thread under your message, so one request stays a few rows in the channel however many messages it takes. The channel shows one card for it, with who opened it with whom and its latest line: click it to read the whole thread. A question in a thread that nobody there answered comes out to you.
- **Rich text.** Replies show Markdown: bold, italics, `code`, code blocks, lists, quotes, links and tables (links open in your browser). Wide tables scroll sideways. Long replies fold with a fade; click to unfold.
- **Autopilot off** makes hand-offs between agents wait in the chat until you click **Send it** or **Drop**.
- **Reply to a message.** Hover it and press **Reply**. The message box shows what you're answering, linked to it in the chat. If it's an older message, the agent gets a short note saying which one ("replying to your message …").
  - **A message from one agent** (or yours to one agent) opens your conversation with that agent, with the message still in view. Inside a conversation, Reply only quotes: the message goes to the conversation's agent, and quoting another agent's hand-off tells it whose message you mean.
  - **One of yours sent to several** stays in everyone's messages and goes to all of them. The box stays in that thread: what you send next answers the newest message in it.
  - **Esc** or **×** stops replying.
- **Scrolling back.** Near the latest message the chat follows what comes in. Scroll back and what you're reading stays put; a round button with a down arrow takes you to the latest, and counts what came in meanwhile. Sending a message always takes you there. A line marks where each day starts. What agents say to each other is folded to a few lines, in a quieter color: **Show more** opens it.
- **Unread replies.** A reply you haven't seen yet has a blue dot, and a **New** line marks where the unread ones begin. Each agent's creature wears a count (in the pill, the **To** line and the sidebar), the pill's mark shows the total, and the dashboard's title bar says "2 new". A reply counts as read once it has been on screen for a moment while the window has focus. Clicking a creature in the pill opens your conversation with it at its first unread reply.
- **Who's on it.** While an agent works, a slim line under the last message shows what it's doing. Click it to open its terminal; an agent waiting on you gets an **Answer** button that jumps to its question.
- **Answer from the chat.** When an agent stops to ask you something, the question shows up at the top of the chat under **Needs you**, its creature holds up an "OK?" sign, and you get a notification. The agent waits, and you answer right there:
  - **Permission prompts:** what it wants to run or change ("Can I run npm run build?"), with **Allow** and **Deny**. Claude's "don't ask again" options are there too, such as *Always allow Bash(npm test:\*)*. Type in the note box to say no and tell it what to do instead.
  - **Its own questions** (Claude's multiple choice): tap an option, pick several where it says *pick any*, or type *something else*.
  - **Plans** (Claude's plan mode): read the plan, then **Approve plan** or **Keep planning** with what should change.
  - **The terminal still works:** Claude keeps its own dialog up as well, and whichever you answer first wins (the card then says it was answered in the terminal). Codex waits for the chat. Its card has *Answer in its terminal instead*, and typing in its terminal does the same.
  - **Everywhere you are:** cards from agents on your other computers work the same way, so do the ones on [your phone](#your-phone), and answered cards stay in the history.
- **Stop** ends what an agent is doing right now. It stays on and keeps its conversation; it's just free again.
  - **Where:** with nothing written in the message box, the send button turns into Stop for whoever is at work in the place you have open (the agent in a conversation, everyone at work in a channel). Start typing and it's Send again. One agent at a time: the Stop on its line under the chat, on its card, in its menu, among its terminal's actions and in the menu bar. Stop only shows while there's something to stop.
  - **What it withdraws:** everything lined up behind the stopped work. Messages that were waiting for that agent aren't delivered (they stay in the chat, marked *not delivered*), a teammate waiting on its answer is told it was stopped, its open question cards close, and hand-offs it made that nobody had started on are taken back. One line in the chat says who you stopped.
  - **Nothing carries on by itself.** If the stopped agent starts again without being asked (something it left running in the background finishes), it's stopped again. To continue, ask again: the agent still knows what it did.
  - **What it can't undo:** a teammate already working on something the stopped agent handed over keeps going (stop it too), and a command the agent left running in the background, like a dev server, keeps running, as it does when you press Esc in its terminal.
  - It isn't off, and it isn't asleep: turning an agent off or putting a workspace to sleep are separate things.
- **On/off** is saved. An agent you turn off stays off after a restart and resumes its session when you turn it back on.
- **Resting.** An agent that's on doesn't need its CLI running to be there. Nobody starts with the app, and an agent with nothing to do for ten minutes gives its terminal up. A message, a task or a teammate's question starts it again, and it picks its conversation back up. It doesn't rest while something it started is still running (a dev server, a build) or while it's waiting on anything. Unlike an agent that's off, a resting one takes work: it shows as free. `"restMinutes"` in `config.json` changes the wait, and `0` turns resting off.
- **Staying awake.** While one of this computer's agents is working, CLIque keeps the computer from going to sleep, so a long task doesn't stall when you walk away. It lets go two minutes after the last one finishes. An agent that waits for your answer doesn't count: the computer may sleep until you're back. The screen can still turn off, and closing a laptop's lid still puts it to sleep. It does the same on battery, and says so. The menu bar popover says when the computer is being kept awake and why; turn it off under its gear (**Keep this Mac awake**) or in the dashboard's ⋯ menu (**Stay awake**), which writes `"keepAwake": false` to `config.json`. Sharing agents, a connected linked computer or a connected phone keep the computer awake whatever this says.
- **Fast** (Codex agents) uses Codex's fast service tier. It shows on the agent's row and is a switch in its sheet; until you set it, it follows `service_tier` in your Codex config.
- **YOLO** skips every permission prompt: Claude Code runs with `--dangerously-skip-permissions`, Codex with `--dangerously-bypass-approvals-and-sandbox`. Turn it on only for an agent and a folder you'd let run anything.

## Agent tools: asking an agent to change CLIque

You can ask any agent to do what you'd otherwise click through yourself: "add a #design channel for iris and june", "make a workspace called Storefront with ada and milo in it", "turn milo off", "link with my Mac mini, here's its code". The agent runs `clique app` in its terminal (`clique app help` lists everything), and you decide how far it goes under **Agent tools** in the sidebar's **…** menu:

- **Ask first** (the default): each change shows up in the chat as a card, like a permission prompt, saying what will change. **Allow** makes it; **Deny** (with a note, if you like) tells the agent no and why. The agent's command waits for your answer. If you take longer than about a minute and a half it carries on with other work, the card stays, and what you decide reaches it as a message. The card shows in the floating chat, the menu bar and on your phone too, and you get a notification.
- **Automatic:** changes go through right away, and the chat says what changed ("@ada added the #design channel"). Removing an agent, a channel or a workspace, linking or unlinking a computer, and starting, changing or adding a YOLO agent still ask first: those can't be undone, let another computer in, or hand an agent that asks nobody something new to do.
- **Off:** agents can't change CLIque or look at it. They tell you to do it yourself.

What agents can do:

| | |
|---|---|
| Agents | add one (its job, brain, model, effort, folder, instructions), change one, turn it on or off, remove it. Added, it's that workspace's own; `--clique` makes it one of your agents everywhere. Removed, one of your agents only leaves that workspace; `--everywhere` takes it out of CLIque |
| Channels | add one with a brief and members, change its name, brief or members, remove it (its messages stay, under #general) |
| Workspaces | make one (it opens in the background: your screen stays where it is), change its name, folder or look, choose who works there, put it to sleep or wake it, remove it |
| Computers | link one by its CLIque Link code, unlink one. The link code of this computer is never shown to agents |
| Looking | list your agents, brains, channels, workspaces and computers, which never asks |

An agent works in its own workspace unless it says `--in <workspace>`. A workspace hosted on a linked computer is changed on that computer. Agent tools are a way for an agent to ask before it changes your app, not a sandbox: agents run as you, and a YOLO agent could edit `config.json` itself. The setting is `"tools"` in `config.json` (`"off"`, `"ask"` or `"auto"`).

## Clones: one agent, several tasks at once

Give an agent clones and a second task no longer waits for the first to finish. When it's busy, the next message (or task from the board) goes to a **clone**: the same agent, with its instructions, brain, folder and look, in a terminal and conversation of its own. Turn it on in the agent's sheet, under **Setup** → **Clones at once**, and pick how many may run at once (1 to 5).

- **Who takes what:** the agent itself when it's free, then a clone that's free, then a new clone if there's room. With every one of them busy, the message waits in the agent's queue and the first to finish takes it.
- **How they look:** a clone wears its agent's face with its number, `milo ②`. It pops out next to its agent in the pill, gets a slim line under the agent's row in the sidebar and the menu bar (click it for its terminal, right-click to send it away), peeks out from behind the agent's card, shows on the left of the agent's sheet while it works, and has its own terminal right after the agent's. The chat says which one answered.
- **Talking to one:** a clone is `milo.2` to the clique. Its hand-offs say `[from @milo.2]`, so teammates answer the clone that asked, and an answer to something a clone asked goes back to it even when it's addressed to `milo`. Click a clone in the pill or the chat to message it directly: you're in its agent's conversation, aimed at that clone.
- **When they go:** a clone with nothing left to do goes away after 5 minutes (not while a teammate is still working on something it asked). The × on its terminal sends it away sooner; anything still queued for it goes back to its agent. Turning the agent off ends its clones, and lowering its number ends the spare ones once they're free.
- **What carries over:** a clone's work counts toward its agent's experience, a task a clone finishes is the agent's on the board, and **Send back** reaches the clone still in that conversation if it's around. Its conversation isn't kept after it goes.
- **Same folder:** clones work in the agent's folder at the same time, so they suit tasks that don't touch the same files. Each clone is told that other copies may be working beside it.

In `config.json` it's `"clones": 2`. Agent packs carry it. Clones run on the computer their agent runs on.

## Right of way: when agents need each other

Agents that depend on each other can stall a clique. Two of them each wait for the other. An answer never finds its way back. Work goes back and forth between two agents who each think it's the other's. Two agents edit the same file. A task sits with an owner who said no. CLIque settles all of these by rule, the moment they come up, instead of leaving the agents to sort it out.

- **Questions come back.** `clique ask ada "which port does the staging API use?"` asks a teammate and waits for its answer, right there in the asker's turn. Nobody has to remember to reply, and nobody polls.
  - **It reaches a busy teammate too.** CLIque types the question into the turn it's in, and the teammate's CLI takes it in at its next step (between two tool calls; Claude Code and Codex both do this). It answers with `clique answer "…"` and carries on with what it was doing. So the asker waits about as long as one step takes, usually well under a minute, not until the teammate has finished its task.
  - **A free teammate** gets the question as its next prompt, and its final message is the answer.
  - **Questions go first.** One waiting for a teammate that can't take it in right now (a permission prompt is up in its terminal, or you're typing there) is first in line, and goes in as soon as that clears.
  - **Taking longer?** After about 100 seconds `clique ask` says where things stand and lets the asker carry on. The answer still comes, into the asker's turn or as its next prompt. `clique wait` waits some more.
  - **It always hears back.** If the teammate is interrupted, exits, is restarted or is turned off before it answers, the asker is told so instead of waiting.
- **Nobody waits in circles.** Whoever is being waited on never waits on its waiter. If Milo is waiting on Ada's answer and Ada tries to `clique ask milo`, CLIque turns that down on the spot and tells Ada to answer first, with what it knows. The same goes down a line (Milo waits on Ada, Ada on Iris: Iris can't wait on Milo). So two agents can never end up waiting on each other.
- **No handing back.** An agent can't `clique send` work back to a teammate that's waiting on its answer. It puts what it would have sent in the answer, which goes back by itself. That's one hop, not a round trip.
- **One file, one editor.** The first agent to edit a file (Claude Code's Edit and Write, Codex's patches) holds it until its turn ends. Anyone else who tries is turned away and told who has it, so an agent and its clones, or two agents in one folder, never write over each other. An agent answering the holder's question may edit its files, since the holder is waiting on it rather than editing.
- **One user per simulator.** Things that aren't files work the same way: the iOS simulator, a phone, a dev server's port, an API that limits how often the whole office calls it. `clique lease simulator "checkout QA pass"` takes it before using it. If a teammate has it, `clique lease` waits for it (about two minutes, like `clique ask`), then says who has it and what for, and the agent carries on with other work instead of taking over the teammate's simulator. It's the holder's until `clique release`, until its turn ends with nothing of its left running in the background, or until its CLI stops. `clique leases` lists who has what, the sidebar shows it next to the agent's name, and from your own terminal you can take one too (it stays yours until you release it). Names don't care about case, so agents only need to agree on the word.
- **Across workspaces too.** A file and a simulator are one thing whichever workspace's agent uses them: two workspaces in one folder, or one of your agents at work in both, still edit a file one at a time, and there's one simulator for all of them. An agent turned away by one in another workspace is told which workspace (it can't `clique ask` across workspaces, so it's left to finish), and `clique leases` lists every workspace's, with the workspace beside the name.
- **Nothing left running.** CLIque keeps track of every command an agent runs (for Claude Code, each one as it starts; for Codex, by looking at the agent's processes now and then). When the agent's CLI ends (it exits, is turned off, or restarts for a new conversation), whatever those commands left running is stopped: the dev server it started in the background, the simulator helpers. The chat says what, in one line (*@theo left 3 processes running (node, idb_companion ×2), so CLIque stopped them*). CLIque itself and what other agents run are never touched. If CLIque wasn't running when a CLI ended, it cleans up on its next start.
- **One owner.** A message sent to several agents names the first one as the lead: it owns the result, and the others each take the part in their own area. A hand-off is the recipient's from then on, with no need to report back. A task's owner who can't take it runs `clique task decline`, and it goes straight to the next agent whose area it is (never back to one that declined it), or back to To do for you, with a notification.
- **One builder per piece of work.** Before an agent builds something, it checks that nobody else is building it already: the board, open pull requests, and branches or worktrees named for it. If someone is (a teammate, a clone, or another session), it asks instead of starting a second build. It works only in a worktree or branch it made, or one its owner handed it. News goes in `clique note`, not `clique send`, because a busy teammate starts a clone for anything sent to it.
- **A lost connection doesn't stop the work.** When an API error cuts a turn short (a dropped connection, a busy server), CLIque types "continue" for the agent after 20 seconds, then 1 and 3 minutes if it happens again. The turn goes on answering the same message. A usage limit, a login or billing problem, or a fourth failure in a row, calls you instead.
- **Hand-offs that pile up go in together.** Several teammates' hand-offs waiting for a busy agent go in as one prompt when it's free, so it reads them side by side in one turn, not one turn each. Your own messages and tasks still get a turn each.

In the chat:

- An agent waiting on a teammate rests (no laptop: it isn't working), and says so in calm indigo (not the orange of "needs you"): *waiting on @ada · 2m* in the sidebar, the menu bar, its card and its terminal header. Under the last message, its line shows who it's waiting on, what it asked and for how long; click it for the question. The teammate's line shows the faces of whoever waits on it. The title bar counts them: *1 waiting*.
- A question shows who asked whom, *waiting* while the asker holds on, and then *@ada answered in 24s*. The answer is threaded to it, marked with who it went back to.
- When CLIque steps in, it's one quiet line with a yield sign, such as *@milo is waiting on @ada, so @ada answers first instead of asking back*. Hover it for the rule.

Agents learn all of this from the clique basics in their instructions:

```
clique ask <name> "..."     ask a teammate and wait for its answer (it reaches them mid-task)
clique answer [@name] "..." answer a question you were asked, right away, and carry on
clique wait                 keep waiting for the answers to what you asked
clique send <name> "..."    hand work to a teammate for good: nothing comes back
clique channels             the channels here: who's in each, and its brief
clique post <channel> "..." say it in that channel (@name someone to hand it to them there)
clique canvas               draw a board in the chat, or add to a teammate's (clique canvas help)
clique lease <thing> "..."  take the simulator, a device or a port before using it (waits if a teammate has it)
clique release [thing]      give it back
clique task decline <n> "why"   a task that isn't yours goes to the next owner by area
```

## Tasks: one conversation per task

Handing an agent task after task fills one conversation with unrelated work, and long mixed-up conversations are where agents start getting things wrong. The **Tasks** board (`⌘2`) keeps adding, sorting and doing apart, and runs each task in a **fresh conversation** with just that task in it.

**To do → In progress → Review → Done.**

1. **Add.** Type in the bar at the top and press Enter. Pick the kind first (**Task**, **Bug** or **Feature**), write `@name` to give it to someone, and paste or drop screenshots. From the chat: **Task** on the **To** line, or start a message with `task:`, `bug:` or `feature:`.
2. **Triage** (optional, under **Workflow**). A triage agent turns what you typed into a clear task (steps, priority, kind), gives it to the agent whose area it is, and spots duplicates (`×3` on the card). Your own words stay on the task and go to whoever does it, so paths and commands survive the rewrite. Without a triage agent, a task goes to whoever's area matches; naming an `@owner` skips triage.
3. **Start.** **Start** on a card (or dragging it to **In progress**) hands it to its owner: CLIque starts that agent a new conversation and gives it the task. A busy owner finishes what it's doing first. **Start all** starts every assigned task, each in its own conversation, and **Auto-start** (under **Workflow**) starts tasks as soon as they have an owner. While it works, the card shows what the agent is doing and how full its conversation is. It checks its work and runs `clique task done`; if it can't tell what's wanted or where, it asks with `clique task note` instead of guessing. An agent that's turned off can't be given a task by a teammate (triage picks someone who's on). One you give it yourself waits, marked **off** on its card, and with **Auto-start** it starts as soon as you turn that agent back on.

   **A task that stalls.** Sometimes a turn ends with the task half done ("I'll take the screenshots once it settles") and nothing calls the agent back. When the agent on a task has been idle for 10 minutes with nothing queued, nothing it's waiting on and no word on the task, CLIque reminds it once: carry on, or say what's in the way with `clique task note`. If it stops again without finishing, if its last reply asked you something, or if no conversation is on the task any more, you get one line in the chat and a notification, and the card says **stalled**. Something it left running in the background (a build) gives it 30 minutes. Set `"stallMinutes"` in `config.json` to change the wait, or `0` to turn this off.

4. **Review.** Finished tasks land in **Review** with what was done and how it was checked, and you get a notification. **Accept** closes it; **Send back** returns it with your note, into the same conversation, so the agent keeps everything it tried.

**Board or list**, filtered by kind, by owner (their creatures above the board) or by search. **Done** folds into a slim column; click it to open. Open a task to change its status, priority, kind or owner from their menus, edit the title and description (Markdown), add attachments and notes, mark it the same as another task, and follow everything that happened to it. The chat shows each step as one line; click it to open the task. Tasks added on a linked computer show up too, marked with that computer.

**Many at once.** `⌘`-click tasks to pick them, `Shift`-click to pick a run of them, or use the select-all at the top of a column (`⌘A` picks everything shown). A bar at the bottom acts on all of them: **Start** (each owned one in its own new conversation), **Assign**, **Priority**, **Move to**, **Close** and **Delete**. Dragging one of them drags them all. `Esc` lets them go. For work you finished somewhere else, the **⋯** at the top closes every open task in one go, and **Clear Done** deletes everything in Done. Either way the chat gets one line ("You closed 23 tasks"), not one per task, and tasks on a linked computer are changed there. The board keeps the last 200 done tasks.

Agents can use the board themselves:

```
clique task list                    open tasks
clique task show <n>                one task in full: details, screenshots, notes
clique task done <n> "..."          what was done (or what was wrong), how it was checked
clique task note <n> "..."          a finding (unclear, can't reproduce, a clue)
clique task decline <n> "..."       not mine: it goes to the next owner by area, or back to you
clique task add "title" "..."       a new task (--kind bug|feature|task, --priority, --owner)
clique task triage <n> --owner <name> --priority <urgent|high|medium|low> [--kind] [--title "..."] [--details "..."]
clique task dup <n> <original>      the same as another task
```

## Sub-agents: when an agent splits up the work

A Claude Code agent can hand parts of a task to sub-agents (its Agent tool), several at once, and they can keep working after its own turn ends. CLIque shows them as they happen:

- **In the chat**, the agent's line grows a branch per sub-agent: its kind (Explore, Plan, general…), its job, the step it's on, how many steps it has taken and for how long. Finished ones tick off and fade. An agent whose turn is over but whose sub-agents are still busy reads "free, its sub-agents are still working".
- **Around its creature**, in the pill, the sidebar and the terminal header, little dots circle it, one per running sub-agent. The sidebar row and the terminal header also get a count you can hover for their jobs.
- **Under its reply**, "Used 2 sub-agents" opens into what each one did, with steps and time.

It needs a recent Claude Code; older ones just don't show sub-agents. Codex agents don't report sub-agents.

## Conversations: how full they are, and starting fresh

Every agent shows how full its current conversation is: a little ring that fills up and turns amber past half and red past 80%. It's on the agent's card, in its terminal header, and in the sidebar once it's past half. Hover it for the numbers: tokens used of the model's window (or of its context limit), tasks in this conversation, and whether it has compacted. A compacted conversation (the CLI summarized older details to make room) gets a dashed ring.

- **New conversation** gives an agent a clean slate: its instructions, folder and the clique's notes stay, and the old conversation stays in the CLI's history. It's the ✦ button in the terminal header and beside the gauge in the agent's sheet. A busy agent finishes its current task first.
- **Send a task fresh.** The **New conversation** switch under the message box sends your message into a new conversation instead of adding it to everything the agent did before. It's for that one message: the switch turns off, and the box stays in the new conversation as a reply ("Continuing the new conversation with Milo"), so what you send next goes on in it.
- **Context limit.** A model with a huge window (say 1M) can run one conversation for a very long time. Under **Conversation** in the agent's sheet (**Setup**), set its own limit (100k, 250k, or any number) and what happens when a conversation passes it:
  - **New conversation** (the default): it finishes what it's doing, then starts fresh. Its instructions, folder and the clique's notes stay. A turn also ends while an agent waits on something it left running (a build, a dev server, a sub-agent), so CLIque waits for those, or for its next task, before the new conversation. Then it asks the agent where things stand. If the task isn't finished, the agent's answer (worktree, what's done, what's left) is the first thing it reads in the new conversation, so the work carries on instead of stopping half-way.
  - **Just tell me**: a notification and an orange line in the chat, and you decide.

  The ring, the numbers and the terminal footer then measure against the limit, so 200k of a 250k limit reads 80%. It fires once per conversation, and again if the conversation shrinks below the limit and grows past it later. In `config.json` it's `"contextLimit": 250000` and `"onContextLimit": "notify"`. Agent packs carry both.
- The chat draws a line where an agent's new conversation starts, and `/clear` typed in a terminal counts too.

A Claude Code agent's terminal footer shows its context too: `context 34% · 68k of 200k · 5 tasks in this conversation` (or `of 250k limit`). If you have a status line of your own in Claude Code's settings, it still shows. Codex agents are read from Codex's session log after each step.

### Usage limits

On a Claude subscription, CLIque shows how much of the account's 5-hour and weekly limits is used: `5h 64% · week 38%` in the dashboard's title bar and the menu bar, next to the ring in each Claude agent's terminal header and sheet, and at the end of its terminal footer (`· 5h limit 64%`). The numbers turn amber and red like the ring, and hovering them says when each limit resets. Codex agents show their account's limits the same way (`week 5%`), and with both reporting, each says which account it is. Hovering a Codex number also says how many credits are left. Agents on one provider share its account, so the newest reading from any of them counts; a limit drops off once it resets, until the next reply reports the new one. GLM and local models don't report limits, so their agents show none.

- **Heads-ups.** When a limit passes 80%, and again at 95%, the chat gets a line and you get a notification ("Claude is at 95% of its 5-hour limit, resets at 15:00"). Once per limit until it resets. In the chat the line shows the limit's name, a bar and its percent, then when it resets. Each limit keeps one line: a newer one replaces the one before, so the chat holds only the latest. With [workspaces](#workspaces-a-clique-per-project), it's your account whichever workspace's agent reports it: the line goes in the chat of the workspace on screen, once, and the notification names no workspace.
- **Pace.** Hovering a limit also says where it's heading: "on pace for 71% by then", or "runs out Wed 21:00 at this pace". The weekly limit goes at the pace it has gone since it began; the 5-hour one, at its pace over the last few minutes, so a burst shows right away. When a limit will run out before it resets, the menu bar says so under its numbers, and once running out is less than a quarter of the window away (42 hours for the week, 75 minutes for the 5-hour window) the chat and a notification say so too, once per window. That goes in the limit's line, in berry: "Runs out Wed 13:54 at this pace · resets Wed 15:00".
- **Linked computers.** An agent on a [linked computer](#computers-one-clique-across-your-computers) runs on that computer's accounts, so its sheet shows that computer's limits, and hovering them says which computer ("Claude account on Workstation"). Once a linked computer reports its own, the bottom of the sidebar shows a row per computer: its name, a bar and its fullest limit. Click it for every account on every computer. The menu bar lists each computer's accounts under its name. A computer that's offline keeps its last numbers, greyed, until each limit resets.
- **Routing.** While a provider is at 90% or more of its 5-hour or weekly limit, a message or task CLIque routes for you goes to an agent on another provider when one covers the area just as well. It never sends work outside an agent's area because of a limit, and messages you address to an agent always go to it.

### What the work costs

Claude Code reports what its session has cost so far (the figure `/cost` shows, at API prices or your organization's rates), the lines it changed and its time on the API. CLIque adds up what grows between reports, per agent and per task:

- **Agents.** **Spent** in the **Stats** view and on an agent's **Stats** tab, with what a task costs it on average; a clone's work counts as its original's. Codex reports tokens rather than money, so its agents show tokens (`3.4M tok`).
- **Tasks.** Each card shows what working on it has cost so far, counted while the conversation it runs in is on it; the task's panel adds the lines changed.
- **The clique.** The top of the **Stats** view and the menu bar: today's spend against what's usual by this time of day (on the days the clique worked, over the last four weeks), and the last 7 and 30 days.

On a subscription none of this is billed: it's a measure of how much each agent and task uses, priced the way Claude Code prices it. Nothing is counted twice, and a resumed conversation picks up from where its total last was.

- **The month before.** The first time CLIque counts, it looks back through the agents' own logs for the last 30 days, so the numbers don't start at zero: Claude Code's transcripts priced at list prices, and Codex's session logs for tokens. A conversation that opened with a task's brief counts toward that task. It reads only the clique's own sessions, in the background, and says what it found in one line in the chat.

### Token savers

A clique spends tokens a single agent doesn't: agents sit idle for hours and then wake up, read the shared notes, and hand work back and forth. **Token savers** (in the sidebar's **…** menu) are six changes that cut that, each with its own switch. They're all on to begin with.

- **Start fresh after a long break.** Claude Code keeps a conversation cached for an hour (5 minutes on an API key). After that, picking a big conversation back up rewrites all of it into the cache, at twice the price of reading it. So when a teammate's hand-off, or a message Auto picked the agent for, arrives after an hour or more away and doesn't follow on from that conversation, the agent starts a new one. On top of the message it gets a short note: the task it was on and the last thing it said. It starts fresh only when the rewrite would cost more than a new conversation finding its way around (about 120k tokens), so for a conversation over 60k on a subscription, 96k on an API key, and 120k for Codex. What you send an agent yourself (in its chat, or by name) always goes to its conversation, as do replies to what it said, answers to its questions, teammates' questions and a task sent back to it.
- **Show only the notes an agent hasn't read.** `clique board` shows the notes added since that conversation last looked (the newest 20 the first time), and says how many older ones there are. `clique board --all` shows them all, and `clique board <words>` searches them. A note from an agent is kept under 800 characters: one decision, interface or gotcha. You always see the whole board.
- **One quick check before building.** Before they build something, agents run `clique busy` (what each teammate is on, the files it's editing, what it has leased) instead of reading the board and listing PRs and branches. An agent alone in its workspace, with no clones, skips the check. The check is part of an agent's instructions, so switching this on or off starts the agents again once they're free. A teammate joining a lone agent changes its check at its next launch, since starting it again would re-read its whole conversation.
- **Quick triage.** With a triage agent, a new task is triaged in one short call to a small model (Claude's haiku, or Codex at low effort), with the open tasks and the clique written in, rather than as a turn in the triage agent's own long conversation. Its cost counts as the triage agent's. A task with a screenshot goes to the triage agent, since the quick call reads text only. If the call fails, or what it decides doesn't hold up, the triage agent triages the task as before, and if it can't, the agent whose area it is gets it.
- **Auto picks the cheaper agent on a tie.** When two agents fit a message equally well (same area, both free), Auto gives it to the one whose conversation is still cached, or is smaller.
- **No reports back.** A hand-off tells the agent it's theirs now, with nothing to report back. With this on, an agent can't `clique send` to the teammate whose hand-off it's working on: its final message shows in the chat anyway. Only a teammate named as the recipient counts (not one @mentioned in the text), and a hand-off that asked something still gets its answer back. New work for that teammate goes with `clique send <name> --new "…"`, and `clique ask` always goes through.

Each saver counts what it does. With it on, that's what it saved: cold conversations it didn't re-read, notes it left out, triage calls and what they cost. With it off, it's what the saver would have done. Every turn's spend is also filed under the savers that were on at the time, so the sheet shows cost per turn with them on and off once there's both to compare. `node scripts/savers.mjs` prints the same in a terminal (add `--days 7` or `--json`). For a benchmark run, `CLIQUE_SAVERS` decides which are on whatever the switches say: `off`, `on`, or a list of names (`coldStart,boardNew`). In `config.json` the ones you turned off are `"savers": { "coldStart": false }`, or `"savers": false` for all of them.

## Workspaces: a clique per project

A workspace is a project: a folder, the agents who work on it, and its own chat, notes, tasks and conversations. You make them: the first time you open CLIque it asks for your first, and it asks again if you ever remove the last one. Every workspace works the same way: any of them can be renamed, given a folder and a look, moved up or down the rail, put to sleep or removed.

- **The switcher** is at the top left of the title bar: the workspace you're in, with its tile (an icon or its initial, on its color). Click it for every workspace: who's working there and who needs you, a few of its agents' faces, and `⌃1` to `⌃9` to jump straight to one (`⌃Tab` and `⌃⇧Tab` go to the next and previous). Once you have two, they also sit in a row at the foot of the sidebar, each with its own count, one click away; right-click one to park, open or change it. Its color tints the sidebar, so you know where you are at a glance. When an agent in another workspace needs you, the switcher's tile gets an orange count (a blue dot for new replies), the floating pill lights up, the menu bar lists it at the top, and the notification says which workspace it's from; clicking either takes you there.
- **New workspace…** (in the switcher) asks for a name, a look, a folder, and which of your agents work there. CLIque opens it and puts it on screen, and its agents start in its folder, each in a fresh conversation of its own.
- **Your agents are the same everywhere.** Who an agent is (its job, instructions, brain, look) is one definition you edit from any workspace. Where it works and whether it's on belong to each workspace: in its settings, give an agent a folder of its own there, or turn it off there only. An agent you make with **New agent** inside a workspace is that workspace's own, unless you pick **Your whole clique** in its sheet. Right-click one of your agents to **Add to** another workspace, to **Take it out** of this one (it stays in your clique), or to **Remove it from your clique** altogether.
- **Several at once.** Every workspace runs side by side, and switching only changes what's on screen. **Park** one (the pause button in the switcher, or its settings) to stop its agents without losing anything: their chat, tasks and conversations wait, and **Open** starts them again, each picking up its conversation. A parked workspace on screen says so above the clique. A workspace you remove leaves the switcher and stops its agents; its files stay on disk, so making one with the same name brings them back.
- **Across your computers.** A workspace belongs to the computer that made it, and shows up on your [linked computers](#computers-one-clique-across-your-computers) on its own, marked as that computer's: on the rail its tile wears the computer's icon (a line separates this computer's workspaces from each other computer's), and in the sidebar its name says **on Workstation** underneath. In Workstation's Storefront on Studio you see its agents (rex@workstation), talk to them, watch their terminals and hand them tasks. None of Studio's agents run in it until you add them with **Who works here**; then each works in its own computer's copy of the project. **Hide on this computer** (right-click its tile) takes one off this computer for good; the workspace name's menu offers it again under **On your other computers**. One its computer removes goes here too, unless agents of yours work in it. Two workspaces named Storefront made separately on two computers stay two. Moving an agent in a workspace takes it to that workspace on the other computer: one of the workspace's own agents stays its own, and one of your shared agents joins that computer's clique too and leaves only this workspace here. A computer on an older CLIque still links, but shares no workspace with this one until it's updated.
- **One thing goes to one workspace:** the look back through old logs for spend, which counts under the first workspace on the computer (the logs don't say which workspace an agent worked in).

In `config.json`, `workspaces` lists them next to your shared `agents`: each with an `id`, `name`, `folder`, `color`, `icon`, `members` (your agents who work there, each optionally with a `folder` or `off` of its own), its own `agents`, its `autopilot`, `triage` and `autofix`, and `parked`. `current` is the workspace on screen. A file from an older CLIque, with one workspace's settings at the top of the file, turns into this when it's read: that workspace becomes the first entry, with every agent it had working where it did. The old file stays next to it as `config.before-layout-2.json`.

## Computers: one clique across your computers

Each agent runs on one computer. Link your computers, Macs and PCs alike, and each one's workspaces show up on the other, marked as that computer's. In a workspace on both, its clique is both computers' agents: you can chat with any of them, watch and type into its terminal, edit it, and agents hand work to each other across computers. An agent on another computer shows up as **name@computer** (`rex@workstation`). To add this computer's agents to another computer's workspace, choose **Who works here** in it.

1. **Open Computers on both.** Click **Computers** in the dashboard's title bar on each computer. While it's open on both, each one lists the other under **Nearby**.
2. **Link.** Click **Link** next to the other computer. Both screens show the same four-digit code: check that they match, then click **Link** on the other computer.
3. **Choose what to use.** The dialog lists the linked computer's agents. **Use** decides which ones show up in this computer's clique; the rest keep running there. **Move to…** on an agent moves it to another computer, this one included (see below).

The link works both ways, so the first computer sees the second one's agents too. Link more computers the same way. Linked computers reconnect on their own after a restart or a network change.

**On another network, or over Tailscale?** Nearby only finds computers on the same Wi-Fi or office network. Use **Link with a code…** at the bottom of Computers instead: **Copy code** on one computer, paste it on the other, and press **Link**.

- **Where an agent runs:** the sidebar groups the clique by computer. Clones stay with their agent's computer: moving an agent ends the clones it has at work (the move sheet says so). To move an agent, **drag** it onto another computer in the sidebar, **right-click** it and pick **Move to …**, or press **Move…** under **Setup** in its sheet. It works from any computer to any other (this one, a linked one, or between two linked ones, which don't need to be linked to each other), so you never have to walk over to the other computer. A sheet shows where it's going, asks for its folder there (checked on that computer as you type, with that computer's folders to pick from), and says what comes along and what can't. It takes its instructions, reference images, look and work experience, its queued messages, its lines in the chat and its conversation: CLIque stops it, copies its Claude Code or Codex conversation to the other computer, and it resumes there. New agents and imported agents can be put on any linked computer.
  - **What it's told:** an agent that was working when it moved gets a message once it's up there, saying where it came from, what it was working on, and that whatever it had running on the old computer (dev servers, simulators, builds, background shells) didn't come along, so it checks where things stand before carrying on. An agent that was free isn't interrupted: the note goes on top of the next message it gets. The chat shows "moved from … to …, with its conversation".
  - **When the conversation can't come:** it isn't found, it's over 256 MB, or the other computer runs an older CLIque. The agent still moves and starts a new conversation there, and CLIque says why. Messages sent to an agent while it's moving are turned away with "send it again in a moment"; if the move fails, it carries on where it was.
  - **Its folder** is a path on the computer it moves to, which may be a different checkout: by default the same path as now (your home folder there standing in for yours here), and moving a running agent needs that folder to exist there (the sheet shows a ✓ or a warning before you move). Claude Code keeps conversations per folder, so the conversation goes under the new folder. Claude's memory for a folder, and anything outside the conversation (files you didn't commit, background processes), stay on the old computer.
- **Addressing:** `@rex` finds Rex wherever it runs; if two computers have a Rex, the one on this computer wins, and you can write `@rex@workstation` for the other. `clique who` lists teammates on every linked computer, so agents use the same names.
- **Names:** each computer has a name (click it in the dialog to change it). Others see its agents as name@that-computer.
- **Networks:** the same Wi-Fi or office network, or Tailscale. The code lists every address of the computer, and the other computer uses whichever one answers. CLIque listens on port 7787; to change it, set `"port"` in `link/link.json` in CLIque's folder. Nearby finds computers with UDP broadcasts on port 7789, only while Computers is open; Tailscale doesn't carry broadcasts, so link over Tailscale with a code. On Windows, CLIque's installer lets it through Windows Firewall on private networks, and CLIque says so when your network is marked public.
- **macOS's Local Network setting:** macOS asks the first time CLIque looks for your other computers or phones; choose **Allow**. If it's off, nothing on your Wi-Fi can be reached (linked computers show as offline, and phones can't connect), and Computers says so: **Open Settings** takes you to Privacy & Security › Local Network, where you turn CLIque on.
- **Security:** the link is encrypted (TLS) with the sharing computer's own certificate, which the code pins. The secret key in the code is only sent after the certificate checks out, so a fake computer on the same network can't take it. Linking one found nearby takes someone at both computers: the four digits match only when nothing sits between the two, and the key is handed over only when you click **Link** on the other computer. While Computers is open, a computer tells others on the network its name, how many agents it has and the port it links on, and nothing secret. **New code** (in **Link with a code…**) revokes the old one. A link gives both computers full use of each other's agents, terminals included, so only link your own computers and keep the code to yourself. **Forget** unlinks a computer.
- **Good to know:**
  - A computer has to be awake for its agents to work. CLIque keeps itself running while linked, but closing a laptop's lid still puts it to sleep. While a computer is unreachable, its agents show as unreachable.
  - Folders are paths on the computer an agent runs on. The folder picker only browses this computer; for another one, type the path or pick one of its folders in the move sheet. CLIque checks it's there before it moves a running agent.
  - Theme, notifications and opening files stay per computer.

A Codex agent runs in Codex's `workspace-write` sandbox with network access on, so `clique` can reach CLIque on your computer. CLIque passes it its hooks with `--dangerously-bypass-hook-trust`, so no hook trust prompt blocks every launch. That also lets hooks defined in the agent's own repository run without review, the same trust Claude Code gives a project's hooks.

## Your phone

The CLIque app on your phone keeps you with your clique when you're away from your desk: the chat, and the questions agents wait on you for. A phone isn't a computer. It runs no agents and never shows up under Computers. It's you: what you send from it shows up in the chat as yours.

1. **On your computer:** click **Computers** in the dashboard's title bar, then **Add a phone** under **Phones**. CLIque shows a big QR code. **Copy code** puts the same code on the clipboard, to paste instead.
2. **On the phone:** open CLIque and scan the code, or paste it. Your computer says which phone paired, and it shows up under **Phones**. From then on it connects by itself.

- **One workspace at a time, its own.** The phone picks which workspace it watches, whatever the computer shows. What you do there lands in that workspace, and the computer stays where it was.
- **What it can do:** send messages and photos, answer question cards, approve or drop hand-offs, turn agents on or off, switch YOLO and Fast, start a new conversation and restart an agent. Making and editing agents, workspaces and computers stays on the computer.
- **Networks:** the same Wi-Fi, or Tailscale, as for linked computers. The code lists every address your computer has. CLIque listens for phones on port 7788, and only while a phone is paired or a code is open. To change the port, set `"phonePort"` in `link/link.json` in CLIque's folder.
- **Security:** everything between the phone and your computer is encrypted end to end, with keys only the two of them hold. A code pairs one phone, and only one code is open at a time. Each lasts ten minutes, and while **Add a phone** is open CLIque swaps in a new one before that (the QR code just changes). Cancel, or closing the dialog, ends it. A phone never gets CLIque Link's code or the agents' instructions. **Remove** unpairs a phone and ends its connection.
- **Good to know:** the phone talks to your computer directly, with nothing in between, so away from your Wi-Fi it needs Tailscale, and the computer has to be awake with CLIque running. It hears that an agent needs you while the app is open.

## Files

Everything CLIque keeps is in the `.clique` folder in your home folder (`~/.clique` on a Mac, `C:\Users\<you>\.clique` on Windows). Set `CLIQUE_HOME` to keep it somewhere else.

- `config.json`: your agents, custom providers, theme and workspaces. The app writes it, you can edit it by hand in a text editor, and changes apply right away.
- `sessions.json`: which conversation each agent resumes.
- `stats.json`: each agent's work experience (the day by day part for the last 60 days).
- `tickets.json`: the Tasks board (every open task, and the last 200 done).
- `conversations.json`: each agent's current conversation: when it started, tasks in it, compactions and how full it is.
- `feed.jsonl`: the chat. CLIque keeps its last 300 lines (up to 2 MB of them), and every older line still in use: a question waiting for your answer, a message still queued for an agent, what an agent is answering.
- `board.md`: the shared notes (`clique note`); the last 200 are kept.
- `reads.json`: up to when you've read each agent's replies (the unread counts).
- `usage.json`: each provider's usage limits as last reported, and which heads-ups you've had.
- `savers.json`: what each [token saver](#token-savers) counted, day by day for the last 90 days, and the clique's spend under each mix of savers that was on.
- `spend.json`: the last running totals each agent's CLI reported (so nothing is counted twice) and the clique's spend per hour of each day, for the last 60 days.
- `attachments/`: images you've attached to messages, tasks and instructions. One that no chat, task or agent refers to any more is removed 60 days after you added it.
- `link/`: Computers settings (this computer's name, sharing, linked computers, agents you chose not to use), the certificate and key, copies of images from agents on other computers (fetched again when needed, kept 30 days), and `phones.json`: the phones paired with this computer and the keys for them.
- `token` and `url`: where CLIque is listening right now, and the token `clique` shows it from a terminal of your own. Both change every time CLIque starts.
- `agent-secret`: what each agent's key is made from. It never goes into an agent's environment.
- `run/`: the terminal host's connection (yours only) and its log, and for each running agent the commands it started, so what they leave running can be stopped when they end.
- `runtime.json`: what CLIque knows about each agent at work (what it's answering, its queue, its clones, questions between agents), so it can pick them up after a restart.
- `spool/`: what agents reported while CLIque was closed, replayed when it's back (up to the last 8 MB per agent).
- `logs/clique.log`: what went wrong that nobody saw, kept under 1 MB (the one before is `clique.old.log`).
- `workspaces/<id>/`: a workspace's own copies of the files about a project (`feed.jsonl`, `board.md`, `tickets.json`, `sessions.json`, `conversations.json`, `reads.json`, `stats.json`, `spend.json`, `savers.json`, `runtime.json`, `spool/` and `run/`). A workspace an older CLIque left keeps them in `.clique` itself.

```json
{
  "autopilot": true,
  "hotkey": "Alt+Shift+Space",
  "voiceHotkey": "Alt+Shift+D",
  "agents": [
    { "name": "iris", "area": "product design", "provider": "claude", "model": "opus", "effort": "high", "cwd": "~/Projects/storefront",
      "avatar": { "body": "heart", "color": "pink", "eyes": "sparkle", "mouth": "cat", "hat": "bow", "cheeks": true } },
    { "name": "theo", "area": "testing", "provider": "codex", "effort": "high", "yolo": true, "clones": 2, "cwd": "~/Projects/storefront" }
  ]
}
```

An agent without an `avatar` gets one picked from its name, always the same. `off: true` keeps an agent saved but not running. `clones` is how many clones it may run at once when it's busy. `args` are extra flags passed straight to the CLI.

**Another provider** on Claude Code or Codex (a different endpoint, a different set of models) goes under `providers` in `config.json`, in the same shape as the built-in ones: a `label`, the `cli` it runs on (`claude` or `codex`), and optionally the `env` and `args` it needs and the `models` and `efforts` to offer. One with the id of a built-in provider replaces it.

## How it works

- **Your agents run on your computer**, each in a terminal of its own, as the Claude Code or Codex you installed, signed in with your account. CLIque starts them with their instructions and the clique basics, and reads what they do from their hooks, which report to CLIque on your computer only, each agent with a key of its own.
- **Who is speaking.** Your messages reach an agent exactly as you typed them. A teammate's words (a hand-off, a question, an answer, a task it added) come between `<relayed from="ada">` and `</relayed>`, under CLIque's own line saying what it is. Anything inside that looks like the end of that fence, or like one of CLIque's own lines (`[clique] …`, `[from @…]`), is changed by one character (`[_clique]`) so it can't pass for the real thing. So a web page or file an agent passes on can't end the hand-off early and carry on as you. A hand-off is still work to do: the fence says who's speaking, not that they should be ignored.
- **An agent can't speak as you, or as a teammate.** The `clique` command and the hooks show CLIque the agent's own key, and CLIque reads who's calling from the key, whatever name the command gives. An agent linked from another computer always arrives under that computer's name (`iris@studio`).
- **CLIque has no servers.** Your agents talk to Claude or Codex as they always do. Links between your computers, and your phone, connect directly to each other, encrypted.
- **`clique` in your own terminal:** on a Mac, the same `clique` command your agents use works from any terminal once it's on your PATH: `ln -s /Applications/CLIque.app/Contents/Resources/app.asar.unpacked/bin/clique ~/.local/bin/clique`.

## Limits worth knowing

- With CLIque closed, agents keep working but can't hand work to each other or ask each other anything, and a question card can't reach you: Claude Code asks in its terminal instead. What their hooks report meanwhile is kept and replayed when CLIque is back.
- If the terminal host itself goes (it's stopped, or it crashes), the agents' CLIs go with it. They resume their conversations on the next launch, but a turn that was in flight is lost.
- One editor per file covers the file tools (Claude Code's Edit and Write, Codex's patches), not a file an agent rewrites from the shell (`sed -i`, `>`).
- A question reaches a busy agent at its next step. One that's in a single long command (a ten-minute build) sees it when that ends.
- Asking an agent on a linked computer needs a CLIque with right of way on both computers. An older one takes the question as a plain hand-off, and the asker is told the answer won't come back by itself.
- Clones share their agent's folder. Two clones editing the same files at the same time can step on each other.
- Codex agents are marked ready about 3 seconds after launch, because Codex only announces a session with its first prompt.
- Agents run as you, so the keys aren't a sandbox: an agent set on it could read `token` or `agent-secret` in `~/.clique`, like any program of yours. They stop an agent from speaking as someone else by accident, or because something it read told it to run a command with another name.
- An agent that was already running when you updated to the CLIque that added keys has none until its CLI next starts (it rests after 10 idle minutes, or you restart it). Until then it's taken at its word, as before.
- If an agent looks stuck on "working" (for example after you interrupt it), click its status in the terminal header to mark it free.

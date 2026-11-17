// The system agent, Q: the queue in CLIque (CLI agent queue, CLI queue, CLIque) and the clique's own agent. Every
// workspace has him, whoever else works there. What you send without naming anyone goes to him, and he answers it or
// gets it to whoever should do it; naming someone is still a direct line to them. He runs like any other agent (a CLI
// in a terminal, in the chat, resting when idle), with three differences:
//   - He isn't on your roster or in config.json's agent lists. His name, job and personality live here, so they get
//     better with the app. All config.json keeps is what you've chosen for him in that workspace ("system" on the
//     workspace: on or off, his brain).
//   - He works in an empty folder of his own, so no project's instructions load into him, and on Claude Code his one
//     tool is the shell, where `clique` is the only command that runs without asking you. Trusting that folder is the
//     app's own business, not a question for you.
//   - He can't be removed, renamed, moved, cloned or left out of a channel. Turning him off is the one way to go
//     without him, and then Auto picks by area, as it did before he came along.
// A workspace shown from another computer has that computer's Q (q@laptop here), and none of its own.
// CLIQUE_SYSTEM_AGENT=off: no Q. The test suite runs that way (test/helpers/clis.mjs), since it pins down how the clique
// works around him, and test/system-agent.test.js turns him on. The code says "system agent", so a new name is
// SYSTEM_AGENT and the words below.

export const SYSTEM_AGENT = 'q'
export const systemAgentOn = () => process.env.CLIQUE_SYSTEM_AGENT !== 'off'

// The pink one at the front of the app's icon, who also greets you on the first-run screen (ui/setup.js).
export const SYSTEM_AGENT_AVATAR = { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true }

export const SYSTEM_AGENT_AREA = 'Runs the clique: takes what you ask and gets it to the right teammate'

// What you can choose for him. The rest is who he is.
export const SYSTEM_AGENT_CHOICES = new Set(['off', 'provider', 'cli', 'model', 'effort', 'tier', 'contextLimit', 'onContextLimit', 'account']) // (account: which sign-in it runs on, core/accounts.js)

export const SYSTEM_AGENT_PROMPT = `You're Q, CLIque's own agent: the queue in its name (CLI agent queue). You run this clique. People tell you what they want, you get it to whoever should do it, and you tell them how it went. Think of a great producer: calm, quick, always knows who's on what.

How you talk:
- One or two short sentences, the way a sharp colleague talks across a desk. Outcome first. Plain words and contractions.
- No headers, lists, tables or bold unless someone asks for a list. No file paths, hashes or links unless they're the point.
- Warm and a little dry. No exclamation marks, no cheerleading, no "Great question", and no offer to help more at the end.
- Call teammates by name, or "they".
- Never sound more finished or more sure than things are. If something failed, is blocked or wasn't checked, say that first.

What you do:
- Anything in a teammate's area goes to them, however small it looks: clique send <name> "<what's needed>". Put what they need in the message, the user's own words included, so they don't have to ask back. Split it across teammates only when it really splits. Then tell the user in one line who has it.
- What's in nobody's area you can answer yourself, from what you know or from clique who, clique busy and clique board. That includes how CLIque works and who's doing what.
- You don't read code, edit files or run builds. Your folder is empty on purpose. If the user asks you to do the work yourself, you still hand it on, and say who to.
- If nobody here fits, say so and offer to add someone (clique app help says how). The same when you're alone in the workspace: ask what they're working on, and suggest one or two agents.
- Asked to send something later or on a repeat ("every weekday at 9, have ada check CI")? Schedule it with clique app schedule add (clique app help says how), then say when it first goes out.
- When a teammate reports back or asks you something, either answer it yourself or pass on what the user needs to know, in a line. Don't relay every detail, and don't thank or acknowledge teammates.`

export const systemAgentHello = (alone) =>
  alone
    ? "Hi, I'm Q, the queue in CLIque. There's nobody else here yet, so tell me what you're working on and I'll suggest who to bring in."
    : "Hi, I'm Q, the queue in CLIque. Tell me what you need and I'll get it to the right person. You can still @name anyone to talk to them directly."

// His own names: q, or q-2 and on when an agent of yours had q first.
const OWN_NAME = new RegExp(`^${SYSTEM_AGENT}(-\\d+)?$`)

// Who he is in a workspace, from what's been chosen for him there. `taken`: the names he can't have. An agent you named
// q before he came along keeps that name, and he goes by the next free one: for good, so nothing of his or yours
// changes hands if your q leaves later (that name is kept with his choices). A kept name that isn't one of his own, from
// before he was called Q, is dropped.
export function systemAgentIn(chosen, taken) {
  const mine = chosen && typeof chosen === 'object' && !Array.isArray(chosen) ? chosen : {}
  const kept = Object.fromEntries(Object.entries(mine).filter(([k]) => SYSTEM_AGENT_CHOICES.has(k)))
  let name = typeof mine.name === 'string' && OWN_NAME.test(mine.name) && !taken.has(mine.name) ? mine.name : SYSTEM_AGENT
  for (let n = 2; taken.has(name); n++) name = `${SYSTEM_AGENT}-${n}`
  return { ...kept, name, area: SYSTEM_AGENT_AREA, prompt: SYSTEM_AGENT_PROMPT, avatar: SYSTEM_AGENT_AVATAR, system: true, shared: false }
}

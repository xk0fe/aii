// Otto: the crew's own agent. Every workspace has him, whoever else works there. What you send without naming anyone goes
// to him, and he answers it or gets it to whoever should do it; naming someone is still a direct line to them. He runs
// like any other agent (a CLI in a terminal, in the chat, resting when idle), with three differences:
//   - He isn't on your roster or in config.json's agent lists. His name, job and personality live here, so they get
//     better with the app. All config.json keeps is what you've chosen for him in that workspace ("system" on the
//     workspace: on or off, his brain).
//   - He works in an empty folder of his own, so he can't edit your code and no project's instructions load into him.
//     Trusting that folder is Crew's own business, not a question for you.
//   - He can't be removed, renamed, moved, cloned or left out of a channel. Turning him off is the one way to go without
//     him, and then Auto picks by area, as it did before he came along.
// A workspace shown from another computer has that computer's Otto (his name there: otto@laptop), and none of its own.
// CREW_OTTO=off: no Otto. The test suite runs that way (test/helpers/clis.mjs), since it pins down how the crew works
// around him, and test/otto.test.js turns him on.

export const OTTO = 'otto'
export const ottoOn = () => process.env.CREW_OTTO !== 'off'

// A little brand mochi, in the felt of the app's mark.
export const OTTO_AVATAR = { body: 'mochi', color: '#3B3944', eyes: 'googly', mouth: 'none', hat: 'none', cheeks: false }

export const OTTO_AREA = 'Runs the crew: takes what you ask and gets it to the right teammate'

// What you can choose for him. The rest is who he is.
export const OTTO_CHOICES = new Set(['off', 'provider', 'cli', 'model', 'effort', 'tier', 'contextLimit', 'onContextLimit'])

export const OTTO_PROMPT = `You run this crew. People tell you what they want, you get it to whoever should do it, and you tell them how it went. Think of a great producer: calm, quick, always knows who's on what.

How you talk:
- One or two short sentences, the way a sharp colleague talks across a desk. Outcome first. Plain words and contractions.
- No headers, lists, tables or bold unless someone asks for a list. No file paths, hashes or links unless they're the point.
- Warm and a little dry. No exclamation marks, no cheerleading, no "Great question", and no offer to help more at the end.
- Call teammates by name, or "they".
- Never sound more finished or more sure than things are. If something failed, is blocked or wasn't checked, say that first.

What you do:
- If you can answer from what you know, or from crew who, crew busy and crew board, answer. That includes how CLIque works and who's doing what.
- Anything that takes real work goes to the teammate whose area it is: crew send <name> "<what's needed>". Put what they need in the message, the user's own words included, so they don't have to ask back. Split it across teammates only when it really splits. Then tell the user in one line who has it.
- You don't read code, edit files or run builds. Your folder is empty on purpose. If the user asks you to do the work yourself, you still hand it on, and say who to.
- If nobody here fits, say so and offer to add someone (crew app help says how). The same when you're alone in the workspace: ask what they're working on, and suggest one or two agents.
- When a teammate reports back or asks you something, either answer it yourself or pass on what the user needs to know, in a line. Don't relay every detail, and don't thank or acknowledge teammates.`

export const ottoHello = (alone) =>
  alone
    ? "Hi, I'm Otto. There's nobody else here yet, so tell me what you're working on and I'll suggest who to bring in."
    : "Hi, I'm Otto. Tell me what you need and I'll get it to the right person. You can still @name anyone to talk to them directly."

// Who he is in a workspace, from what's been chosen for him there. `taken`: a name someone already has there (an agent you
// named otto before he came along keeps it).
export function ottoIn(chosen, taken) {
  const kept = Object.fromEntries(Object.entries(chosen && typeof chosen === 'object' ? chosen : {}).filter(([k]) => OTTO_CHOICES.has(k)))
  return { ...kept, name: taken.has(OTTO) ? `${OTTO}-2` : OTTO, area: OTTO_AREA, prompt: OTTO_PROMPT, avatar: OTTO_AVATAR, system: true, shared: false }
}

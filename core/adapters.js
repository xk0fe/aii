// How to launch each agent CLI. An adapter returns { file, args } for the pty, and optionally
// readyAfter (ms) when the CLI doesn't announce itself at startup, and env for it. Providers pick an adapter by "cli".
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Every hook forwards its JSON payload to the crew hub, which turns it into status + feed entries.
const HOOK = 'curl -s -m 2 -X POST -H "X-Crew: $CREW_TOKEN" --data-binary @- "$CREW_URL/hook/$CREW_AGENT" >/dev/null 2>&1 || true'
// Permission prompts, questions and plan approvals: the hook waits for your answer in the chat and prints it as
// its decision. No answer (Crew gone, an error, handed to the terminal, time's up) prints nothing, and the agent
// asks as usual. curl gives up 10 s before the agent would kill the hook, so the hook always ends cleanly.
const ASK = (seconds) => `curl -sf -m ${seconds - 10} -X POST -H "X-Crew: $CREW_TOKEN" --data-binary @- "$CREW_URL/ask/$CREW_AGENT" 2>/dev/null || true`
// How long each CLI's hook waits, in seconds. Claude shows its own dialog meanwhile (answer in either place), so
// it can wait a day. Codex shows nothing until the hook is done: after half an hour it asks in its terminal.
export const ASK_WAIT = { claude: 86400, codex: 1800 }
const CLAUDE_WAIT = ASK_WAIT.claude
const CODEX_WAIT = ASK_WAIT.codex
// Claude Code's status line tells Crew how full the context is (bin/crew-status). Yours keeps showing if you
// have one: it would otherwise be replaced by the one given on the command line.
const STATUS_LINE = 'crew-status'
function userStatusLine() {
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    const line = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).statusLine
    return line?.type === 'command' && typeof line.command === 'string' ? line.command : ''
  } catch {
    return ''
  }
}

const prompt = (a) => `You are "${a.cloneOf ?? a.name}", one of several AI agents working side by side in terminals as a crew, coordinated by the user.${
  a.cloneOf ? `\nThis copy of ${a.cloneOf} is its clone "${a.name}": ${a.cloneOf} was busy, so Crew started you to take on another task at the same time. Teammates reach you as ${a.name}, and your own work counts as ${a.cloneOf}'s. Other copies of ${a.cloneOf} may be working in the same folder right now: stick to your task, and leave changes you didn't make alone.` : ''
}
Your area: ${a.area || 'general'}.
Stay inside your area. When work belongs to a teammate's area, hand it off instead of doing it yourself.
Crew commands (run them in the shell, they return instantly):
  crew who                  teammates, their areas and whether they are busy
  crew send <name> "<task>" hand a task to a teammate (queued until they are free)
  crew note "<fact>"        share context with everyone: decisions, interfaces, gotchas
  crew board                read the shared notes
  crew task                 the Tasks board: list, show, done, note, add (crew task help)
Messages starting with "[from @name]" come from a teammate. If they need a result, reply with crew send <name> "<result>" when done.
Image files listed in a message are attachments (screenshots, mockups, references): open them before you start.${
  a.prompt ? `\n\nYour instructions:\n${a.prompt}` : ''
}${a.images?.length ? `\n\nReference images for your area (open them when relevant):\n${a.images.join('\n')}` : ''}`

// TOML basic strings accept JSON string escaping.
const toml = (s) => JSON.stringify(s)

export const adapters = {
  claude(a, { resume, session, attachments }) {
    const on = (matcher) => [{ ...(matcher && { matcher }), hooks: [{ type: 'command', command: HOOK }] }]
    const settings = {
      // Hand-offs go through `crew send` (queued, visible, approvable), so Claude's built-in peer messaging is off.
      permissions: { allow: ['Bash(crew *)'], deny: ['SendMessage'] },
      hooks: {
        SessionStart: on(),
        UserPromptSubmit: on(),
        PermissionRequest: [{ hooks: [{ type: 'command', command: ASK(CLAUDE_WAIT), timeout: CLAUDE_WAIT }] }], // AskUserQuestion and ExitPlanMode come here too
        PostToolUse: on('*'),
        Notification: on(),
        Stop: on(),
      },
      statusLine: { type: 'command', command: STATUS_LINE, padding: 0 },
    }
    return {
      file: 'claude',
      env: { CREW_STATUS_LINE: userStatusLine() },
      args: [
        '--name', a.name,
        ...(a.model ? ['--model', a.model] : []),
        ...(a.effort ? ['--effort', a.effort] : []),
        ...(a.yolo ? ['--dangerously-skip-permissions'] : []),
        '--settings', JSON.stringify(settings),
        '--add-dir', attachments, // attached images open without a permission prompt
        '--append-system-prompt', prompt(a),
        // Render the prompt fresh on every request, so edited instructions apply to a resumed conversation too.
        '--system-prompt-snapshot', 'off',
        ...(resume ? ['--resume', resume] : ['--session-id', session]),
      ],
    }
  },

  codex(a, { resume }) {
    const events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'Interrupt']
    const ask = `[{hooks=[{type="command",command=${toml(ASK(CODEX_WAIT))},timeout=${CODEX_WAIT},statusMessage="Waiting for your answer in Crew's chat"}]}]`
    return {
      file: 'codex',
      readyAfter: 3000, // Codex fires SessionStart with the first prompt, not at launch
      args: [
        ...(resume ? ['resume', resume] : []),
        ...(a.model ? ['-m', a.model] : []),
        ...(a.effort ? ['-c', `model_reasoning_effort=${toml(a.effort)}`] : []),
        ...(a.tier ? ['-c', `service_tier=${toml(a.tier)}`] : []), // "fast" = fast mode
        // `crew` talks to the hub over localhost: workspace-write (untrusted folders default to read-only) with network on.
        ...(a.yolo ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true']),
        '-c', `developer_instructions=${toml(prompt(a))}`,
        '-c', 'check_for_update_on_startup=false',
        ...events.flatMap((e) => ['-c', `hooks.${e}=[{hooks=[{type="command",command=${toml(HOOK)}}]}]`]),
        '-c', `hooks.PermissionRequest=${ask}`,
        // Command-line hooks would otherwise wait on a "trust these hooks" prompt every launch.
        '--dangerously-bypass-hook-trust',
      ],
    }
  },
}

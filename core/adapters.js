// How to launch each agent CLI. An adapter returns { file, args } for the pty, and optionally
// readyAfter (ms) when the CLI doesn't announce itself at startup. Providers pick an adapter by "cli".

// Every hook forwards its JSON payload to the crew hub, which turns it into status + feed entries.
const HOOK = 'curl -s -m 2 -X POST -H "X-Crew: $CREW_TOKEN" --data-binary @- "$CREW_URL/hook/$CREW_AGENT" >/dev/null 2>&1 || true'

const prompt = (a) => `You are "${a.name}", one of several AI agents working side by side in terminals as a crew, coordinated by the user.
Your area: ${a.area || 'general'}.
Stay inside your area. When work belongs to a teammate's area, hand it off instead of doing it yourself.
Crew commands (run them in the shell, they return instantly):
  crew who                  teammates, their areas and whether they are busy
  crew send <name> "<task>" hand a task to a teammate (queued until they are free)
  crew note "<fact>"        share context with everyone: decisions, interfaces, gotchas
  crew board                read the shared notes
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
        PreToolUse: on('AskUserQuestion'),
        PostToolUse: on('*'),
        Notification: on(),
        Stop: on(),
      },
    }
    return {
      file: 'claude',
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
    const events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt']
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
        // Command-line hooks would otherwise wait on a "trust these hooks" prompt every launch.
        '--dangerously-bypass-hook-trust',
      ],
    }
  },
}

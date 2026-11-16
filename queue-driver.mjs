// Proof driver: what a stopped agent's terminal gets typed into it, before and after Stop. The real Hub, fake terminals
// (every key and prompt CLIque types is printed), a fake clock, a throwaway CLIQUE_HOME.
// Run from desktop/: node <this file>
import { mock } from 'node:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-stop-driver-'))
Object.assign(process.env, { CLIQUE_SAVERS: 'off', CLIQUE_SYSTEM_AGENT: 'off' })
const { Hub, CONFIG } = await import(path.resolve('core/hub.js'))
const say = (s = '') => console.log(s)
const KEY = { '\x1b': 'Esc', '\x03': 'Ctrl+C', '\r': 'Enter' }
class Terminals extends EventEmitter {
  live = new Set(); drawing = new Set()
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => say(`    [typed into ${n}'s terminal]  ${JSON.stringify(text)}`)
  write = (n, d) => say(`    [key into ${n}'s terminal]    ${KEY[d] ?? JSON.stringify(d)}`)
  quietFor = (n) => (this.drawing.has(n) ? 20 : 60000)
}
mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-stop-driver-app-'))
fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: ['ada', 'june', 'theo'].map((name) => ({ name, cwd: dir })) }))
const t = new Terminals()
const hub = new Hub(t, { bin: '/nonexistent' })
for (const a of hub.agents.values()) (t.live.add(a.name), (a.status = 'idle'))
const ada = hub.agents.get('ada')
const state = () => say(`    ada: ${ada.status}, ${ada.inbox.length} waiting in its queue`)
let lastTyped = ''
const submit = t.submit; t.submit = (n, text) => { if (n === 'ada') lastTyped = text; submit(n, text) }

say('1. You ask ada for something, and it gets to work.')
hub.send({ to: 'ada', text: 'Make the cart and checkout agree on the total.' })
mock.timers.tick(1500)
hub.onHook('ada', { hook_event_name: 'UserPromptSubmit', prompt: lastTyped })
t.drawing.add('ada'); state()

say('\n2. While it works, three things line up behind it: a hand-off from june, a question from theo, another message from you.')
hub.agents.get('june').status = 'working'; hub.agents.get('theo').status = 'working'
hub.send({ from: 'june', to: 'ada', text: 'The release notes need the new endpoint names.' })
let theoHears = '(still waiting)'
hub.question({ from: 'theo', to: 'ada', text: 'Is the fixture seeded?', hold: 60000 }).then((v) => (theoHears = v.trim()))
hub.send({ to: 'ada', text: 'Then open a PR.' })
for (let i = 0; i < 5; i++) await Promise.resolve()
state()

say('\n3. You press Stop.')
say(`    hub.stopTurns(['ada']) -> ${JSON.stringify(hub.stopTurns(['ada']))}`)
for (let i = 0; i < 5; i++) await Promise.resolve()
state()
say(`    theo's \`clique ask\` prints: ${JSON.stringify(theoHears)}`)

say('\n4. Its terminal goes quiet (the turn is over), and ten minutes pass.')
t.drawing.delete('ada'); mock.timers.tick(1500)
mock.timers.tick(10 * 60000)
state()
say('    (nothing was typed into ada\'s terminal in those ten minutes, apart from the one Ctrl+C that empties Claude Code\'s prompt box)')

say('\n5. The chat:')
for (const e of hub.feed) say(`    ${e.kind.padEnd(5)} ${String(e.from).padEnd(6)}${e.to ? ` -> ${String(e.to).padEnd(5)}` : '         '} ${JSON.stringify(e.text)}${e.stopped ? '   [not delivered]' : ''}`)

say('\n6. You ask again: only the new message goes in.')
hub.send({ to: 'ada', text: 'Carry on with the totals. Skip the PR.' })
mock.timers.tick(1500)
state()
mock.timers.reset()
fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true })
process.exit(0)

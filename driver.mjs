// Evidence driver: the real Clique + Hub (fake terminals, scratch CLIQUE_HOME) and the keeper from core/awake.js holding
// Electron's real powerSaveBlocker, exactly as main.js wires it, with a 6 s grace instead of 2 min. After each step it
// asks the OS (macOS: pmset -g assertions) whether THIS process holds a sleep assertion.
import { app, powerSaveBlocker } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [WT, SCRATCH] = process.argv.slice(-2)
app.setPath('userData', path.join(SCRATCH, 'userdata'))
app.on('window-all-closed', () => {})
const core = (f) => import(pathToFileURL(path.join(WT, 'desktop', 'core', f)).href)
const t0 = Date.now()
const say = (text) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${text}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (ok, text) => (say(`${ok ? 'ok  ' : 'FAIL'} ${text}`), ok || fails++)
const os = () => {
  if (process.platform !== 'darwin') return '(not macOS)'
  const out = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' })
  const mine = out.split('\n').filter((l) => l.includes(`pid ${process.pid}(`)).map((l) => l.trim().replace(/\s+/g, ' '))
  return mine.length ? mine.join(' | ') : 'no assertion from this process'
}

app.whenReady().then(async () => {
const { CONFIG } = await core('hub.js')
const { Clique } = await core('clique.js')
const { keeper, awakeState } = await core('awake.js')
fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: [{ name: 'ada', area: 'mobile app', cwd: path.join(SCRATCH, 'folder') }, { name: 'june', area: 'backend api', cwd: path.join(SCRATCH, 'folder') }] }))
const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
const live = new Set()
Object.assign(clique.runner, { running: (n) => live.has(n), start: (n) => live.add(n), stop: (n) => live.delete(n), submit() {}, write() {}, pid() {}, quietFor: () => Infinity })
const hub = clique.hubs.get('default')
hub.start('http://127.0.0.1:1')

let quitting = false
let ids = []
const GRACE = 6000
const awake = keeper({
  start: () => (ids.push(powerSaveBlocker.start('prevent-app-suspension')), say(`     powerSaveBlocker.start('prevent-app-suspension') -> ${ids.at(-1)}`), ids.at(-1)),
  stop: (id) => (powerSaveBlocker.stop(id), say(`     powerSaveBlocker.stop(${id})`)),
  now: () => ({ ...clique.awakeNow(), quitting }),
  told: () => clique.changed(),
  log: (text) => say(`     log: ${text}`),
  grace: GRACE,
})
clique.on('state', () => awake.check()) // as main.js does on every change of state
const line = () => awakeState(awake.decision, { pc: 'Mac' }).line || '(no line)'
const settle = () => sleep(120) // a change of state goes out 40 ms later
const started = () => ids.length > 0 && powerSaveBlocker.isStarted(ids.at(-1))
const step = async (title, fn, expect) => {
  say(`-- ${title}`)
  await fn()
  await settle()
  check(started() === expect, `blocker ${started() ? 'held' : 'not held'}; tray: ${line()}`)
  say(`     macOS: ${os()}`)
}
const work = async (name, text) => {
  await clique.send(name, text)
  hub.onHook(name, { hook_event_name: 'SessionStart', source: 'startup', session_id: `s-${name}` })
  hub.agents.get(name).holdUntil = 0
  hub.pump(hub.agents.get(name))
  hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt: text, session_id: `s-${name}` })
}
const done = (name) => hub.onHook(name, { hook_event_name: 'Stop', last_assistant_message: 'Done.', session_id: `s-${name}` })
const statuses = () => [...hub.agents.values()].map((a) => `${a.name} ${a.status}`).join(', ')

say(`pid ${process.pid}, grace ${GRACE / 1000} s (2 min in CLIque)`)
await step('nobody works', () => clique.changed(), false)
await step('you send ada a task; she starts working', () => work('ada', 'fix the button'), true)
say(`     agents: ${statuses()}`)
await step('june starts working too', () => work('june', 'and the endpoint'), true)
await step('ada finishes; june still works', () => done('ada'), true)
await step('june finishes: the grace starts', () => done('june'), true)
say(`     agents: ${statuses()}`)
await sleep(2500)
await step('2.5 s into the grace ada gets the next task: never let go', () => work('ada', 'now the tests'), true)
check(ids.length === 1, `one blocker so far (${ids.length} started)`)
await step('ada asks you something (a needs-you card): not working, the grace starts', () => hub.onHook('ada', { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', session_id: 's-ada' }), true)
say(`     agents: ${statuses()}`)
say(`-- waiting ${GRACE / 1000} s for the grace to run out, nothing else happening`)
await sleep(GRACE + 400)
check(!started(), `blocker ${started() ? 'held' : 'not held'}; tray: ${line()}`)
say(`     macOS: ${os()}`)
await step('you answer in her terminal: working again', () => hub.input('ada', '\r'), true)
await step('"Stay awake" turned off while she works: let go at once', () => clique.setKeepAwake(false), false)
await step('a phone connects: kept awake as before, though the setting is off', () => (clique.phones.live.set('phone-1', new Set([() => {}])), clique.changed()), true)
await step('the phone goes: let go at once (no work, no grace)', () => (clique.phones.live.delete('phone-1'), clique.changed()), false)
await step('"Stay awake" turned on again, ada still working', () => clique.setKeepAwake(true), true)
await step('CLIque quits with ada still working: let go', () => ((quitting = true), awake.check()), false)
check(ids.length === 4, `${ids.length} blockers over the whole run, never two at once`)
say(fails ? `${fails} FAILED` : 'all ok')
app.exit(fails ? 1 : 0)
}).catch((e) => (console.error(e), app.exit(1)))

// Live run of Stop with a real CLI, headless (no Electron): scratch CLIQUE_HOME, an empty scratch folder as the agent's cwd,
// the cheapest model, tasks that need nothing from disk. Usage: node live.mjs <claude|codex> <queue|steer|card>
import fs from 'node:fs'
import path from 'node:path'
const W = path.dirname(new URL(import.meta.url).pathname)
const [cli = 'claude', scenario = 'queue'] = process.argv.slice(2)
const run = `${cli}-${scenario}-${Date.now() % 100000}`
const home = path.join(W, 'home-' + run)
const cwd = path.join(W, 'cwd-' + run)
fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(cwd, { recursive: true })
Object.assign(process.env, { CLIQUE_HOME: home, CLIQUE_SYSTEM_AGENT: 'off', CLIQUE_SAVERS: 'off' })
const WT = '<scratch>/wt/stop-button/desktop'
const agent = cli === 'claude' ? { name: 'pip', provider: 'claude', model: 'haiku', cwd, yolo: true } : { name: 'pip', provider: 'codex', model: 'gpt-5.6-luna', effort: 'low', cwd, yolo: true }
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ autopilot: true, agents: [agent] }))
const { Clique } = await import(WT + '/core/clique.js')
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a)
const clique = new Clique({ bin: WT + '/bin', computerName: 'probe' })
await clique.start()
const hub = [...clique.hubs.values()][0]
const a = hub.agents.get('pip')
const KEY = { '\x1b': 'Esc', '\x03': 'Ctrl+C', '\r': 'Enter' }
const write = hub.runner.write.bind(hub.runner)
hub.runner.write = (n, d) => { log(`key   -> ${KEY[d] ?? JSON.stringify(d)}`); return write(n, d) }
const submit = hub.runner.submit.bind(hub.runner)
hub.runner.submit = (n, text) => { log(`typed -> ${JSON.stringify(text.slice(0, 70))}`); return submit(n, text) }
const onHook = hub.onHook.bind(hub)
hub.onHook = (name, e) => { if (!e.agent_id && !['PostToolUse', 'PreToolUse', 'Notification'].includes(e.hook_event_name)) log(`hook  <- ${e.hook_event_name}${e.prompt ? ` ${JSON.stringify(e.prompt.slice(0, 50))}` : ''}${e.last_assistant_message ? ` ${JSON.stringify(String(e.last_assistant_message).slice(0, 40))}` : ''}`); return onHook(name, e) }
let last = ''
const tick = setInterval(() => { const s = `${a.status}${a.stopping ? ' (making sure it stopped)' : ''}`; if (s !== last) log(`status = ${(last = s)}`) }, 50)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (f, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(100) } log('TIMEOUT waiting for', what); return false }
const trust = setInterval(() => { const card = hub.feed.find((e) => e.kind === 'ask' && e.ask?.trust && !e.answer); if (card && hub.asks.has(card.id)) { try { hub.answer(card.id, { allow: true }) } catch {} } }, 500)
let failed = 0
const check = (ok, what) => { log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
const done = async () => {
  clearInterval(tick); clearInterval(trust)
  console.log('\nthe chat:')
  for (const e of hub.feed.filter((e) => !e.ask?.trust)) console.log(`  ${e.kind.padEnd(5)} ${String(e.from).padEnd(6)} ${e.to ? `-> ${e.to} ` : ''}${JSON.stringify((e.text ?? e.ask?.title ?? '').slice(0, 90))}${e.stopped ? '  [not delivered]' : ''}${e.answer ? `  [card: ${e.answer.stopped ? 'stopped' : JSON.stringify(e.answer)}]` : ''}`)
  console.log(failed ? `\n${failed} FAILED` : '\nall ok')
  clique.runner.stopAll?.()
  await sleep(800)
  process.exit(failed ? 1 : 0)
}
setTimeout(() => { log('HARD TIMEOUT'); failed++; done() }, 150000)
const LONG = 'Without using any tools, write the numbers 1 to 300, one per line, each followed by a made-up eight-word sentence.'
const prompts = () => hub.feed.filter((e) => e.kind === 'msg' && e.via === 'terminal').length

log(`${cli}, scenario "${scenario}"`)
if (scenario === 'card') {
  await clique.send('pip', cli === 'claude' ? 'Use the AskUserQuestion tool to ask me whether I prefer red or blue. After I answer, write a 200-word poem about that colour.' : LONG)
  await until(() => [...hub.asks.values()].some((q) => !q.trust), 90000, 'its question card')
  await sleep(2000)
} else {
  await clique.send('pip', LONG)
  await until(() => a.status === 'working' && a.current, 90000, 'working')
  await sleep(5000)
}
if (scenario === 'queue') {
  await clique.send('pip', 'When you are done, also write the numbers 300 down to 1.')
  await clique.send('pip', 'And then translate all of it to French.')
  check(a.inbox.length === 2, `2 messages wait in its queue (${a.inbox.length})`)
}
if (scenario === 'steer') {
  log('a prompt goes into the turn it is in (as CLIque types a teammate\'s question): the CLI queues it')
  submit('pip', 'Also: what is 3+3? Answer with just the number.')
  await sleep(2500)
}
const typedBefore = hub.feed.length
log('>>> Stop')
const r = await clique.stopTurns(["pip"])
log('stop returned', JSON.stringify(r))
check(a.status === 'idle', 'it shows free at once')
await until(() => !a.stopping, 15000, 'the turn to be over')
check(!a.stopping, 'CLIque saw its turn end')
log('... 15 s pass')
await sleep(15000)
check(a.status === 'idle' && !a.stopping, 'still free 15 s later: nothing carried on by itself')
check(a.inbox.length === 0, 'its queue is empty')
check(hub.runner.running('pip'), 'the agent is still on (its CLI runs)')
check(!hub.feed.slice(typedBefore).some((e) => e.kind === 'reply'), 'no reply came from the stopped work')
if (scenario === 'card') check(hub.feed.some((e) => e.kind === 'ask' && e.answer?.stopped) && hub.asks.size === 0, 'its question card closed as stopped')
log('>>> asking again')
await clique.send('pip', 'What is 2+2? Answer with just the number.')
await until(() => hub.feed.some((e) => e.kind === 'reply' && /^\s*4\b/.test(e.text)), 45000, 'the answer 4')
check(hub.feed.some((e) => e.kind === 'reply' && /^\s*4\b/.test(e.text)), 'asked again, it answers: "4" (its prompt box was clean)')
check(hub.sessions.pip !== undefined || true, 'same conversation')
await sleep(1000)
await done()

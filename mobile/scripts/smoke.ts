// The phone app's network layer against a real Mac, from a terminal: pair with a code (or reconnect with a pairing
// saved by an earlier run), print what the phone would see, send a message, and print the patches that follow.
//
//   npx tsx scripts/smoke.ts cliquephone1.…                    pair, print, send a hello, watch for 8 s
//   npx tsx scripts/smoke.ts                                  reconnect with the saved pairing (.clique-smoke.json)
//   options: --to <name>  --text "…"  --no-send  --ws <workspace>  --wait <seconds>  --save <file>  --answer <id>:allow|deny
//
// Needs Node 22 or later (its built-in WebSocket).
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'

import { CliqueClient, type Deps, type Target } from '../src/net/client'
import { parsePairCode } from '../src/net/pairing'
import { b64, unb64 } from '../src/net/shared'
import type { MacRecord, State } from '../src/net/types'

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const flag = (name: string) => args.includes(`--${name}`)
const code = args.find((a) => a.startsWith('cliquephone1.'))
const file = opt('save') ?? '.clique-smoke.json'
const wait = Number(opt('wait') ?? 8) * 1000

const WS = (globalThis as { WebSocket?: Deps['WebSocket'] }).WebSocket
if (!WS) {
  console.error('This Node has no built-in WebSocket: use Node 22 or later.')
  process.exit(1)
}
const deps: Deps = { WebSocket: WS, random: (n) => new Uint8Array(crypto.randomBytes(n)), log: (...a) => flag('verbose') && console.error('  ·', ...a) }
const device = { name: `${os.hostname().split('.')[0]} (smoke test)`, platform: 'ios' as const, app: '0.1.0' }

function target(): Target {
  if (code) return { kind: 'pair', code: parsePairCode(code), secret: new Uint8Array(crypto.randomBytes(32)) }
  if (!fs.existsSync(file)) {
    console.error(`No code given and no saved pairing in ${file}.\nUsage: npx tsx scripts/smoke.ts cliquephone1.…`)
    process.exit(1)
  }
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { mac: MacRecord; secret: string }
  return { kind: 'mac', mac: { ...saved.mac, ws: opt('ws') ?? saved.mac.ws }, secret: unb64(saved.secret) }
}

const t = target()
const client = new CliqueClient(t, deps, device, {
  onPaired: ({ mac }) => {
    fs.writeFileSync(file, JSON.stringify({ mac, secret: b64(t.secret) }, null, 2), { mode: 0o600 })
    console.log(`paired with ${mac.name} (mac ${mac.id}, this device ${mac.deviceId}); saved to ${file}`)
  },
})

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function summary(s: State, ws: string) {
  const out: string[] = []
  const w = s.workspace
  out.push(`workspace ${w?.name ?? ws} (${ws})${s.parked ? ', parked' : ''}`)
  for (const x of s.workspaces ?? []) {
    const bits = [x.working && `${x.working} working`, x.waiting && `${x.waiting} need you`, x.unread && `${x.unread} new`, x.parked && 'parked'].filter(Boolean)
    out.push(`  ${x.id === ws ? '▸' : ' '} ${x.name} · ${x.agents ?? 0} agents${bits.length ? ` · ${bits.join(', ')}` : ''}`)
  }
  out.push(`agents (${s.agents.length}):`)
  for (const a of s.agents) out.push(`  ${a.name.padEnd(18)} ${(a.on ? a.status : 'off').padEnd(9)} ${a.activity ?? ''}`)
  const open = s.feed.filter((e) => e.kind === 'ask' && !e.answer)
  out.push(`waiting on you: ${open.length}`)
  for (const e of open) out.push(`  ${e.id}  @${e.from}  ${typeof e.ask === 'object' ? (e.ask.type === 'permission' ? `${e.ask.title}: ${e.ask.code ?? ''}` : e.ask.type) : ''}`)
  out.push(`feed: ${s.feed.length} entries, the last ones:`)
  for (const e of s.feed.slice(-5)) out.push(`  ${time(e.ts)} ${e.kind.padEnd(7)} ${e.from}${e.to ? ` → ${e.to}` : ''}: ${String(e.text ?? (typeof e.ask === 'object' ? e.ask.type : '')).replace(/\s+/g, ' ').slice(0, 90)}`)
  return out.join('\n')
}

let shown = false
let last: State | null = null
client.subscribe(() => {
  const s = client.getSnapshot()
  if (s.link.status === 'offline' && s.link.fatal) {
    console.error(`refused: ${s.link.reason}`)
    process.exit(2)
  }
  if (!s.state || s.state === last) return
  if (shown) {
    const changed = Object.keys(s.state).filter((k) => (s.state as any)[k] !== (last as any)?.[k])
    console.log(`${time(Date.now())} patch: ${changed.join(', ')}`)
    last = s.state
    return
  }
  last = s.state
  shown = true
  const link = s.link
  console.log(`online via ${link.status === 'online' ? link.host : '?'}\n${summary(s.state, s.ws)}`)
  void afterReady()
})

async function afterReady() {
  const answer = opt('answer')
  if (answer) {
    const [id, how] = answer.split(':')
    await client.answer(id, { allow: how !== 'deny' }).then(
      () => console.log(`answered ${id}: ${how !== 'deny' ? 'allow' : 'deny'}`),
      (e) => console.error(`answer failed: ${e.message}`),
    )
  }
  if (!flag('no-send')) {
    const text = opt('text') ?? 'Hello from the phone smoke test: no need to do anything, just say hi back.'
    await client.send(opt('to') ?? '', text).then(
      (r) => console.log(`send: ${String(r ?? 'ok').trim()}`),
      (e) => console.error(`send failed: ${e.message}`),
    )
  }
  setTimeout(() => {
    client.stop()
    process.exit(0)
  }, wait)
}

setTimeout(() => {
  if (shown) return
  const s = client.getSnapshot()
  console.error(`no state after 20 s; link: ${JSON.stringify(s.link)}`)
  process.exit(3)
}, 20000)

console.log(`connecting to ${client.macName} at ${(t.kind === 'pair' ? t.code.hosts : t.mac.hosts).join(', ')}…`)
client.start()

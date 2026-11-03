// What the token savers (core/savers.js) have counted, from your own ~/.crew: every workspace's savers.json. Nothing is
// sent anywhere and no agent runs.
//
//   node scripts/savers.mjs [crew home] [--days 7] [--json]
//
// For each saver: what it did with it on, and what it would have done with it off. Then cost per turn under each mix of
// savers that was on, which is the comparison that counts: the same crew's work with them on and with them off.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Ledger, SAVERS, report } from '../core/savers.js'

const args = process.argv.slice(2)
const json = args.includes('--json')
const days = Number(args[args.indexOf('--days') + 1]) || undefined
const home = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--days') ?? (process.env.CREW_HOME || path.join(os.homedir(), '.crew'))
const spaces = path.join(home, 'workspaces')
const dirs = [home, ...(fs.existsSync(spaces) ? fs.readdirSync(spaces).map((d) => path.join(spaces, d)) : [])]
const ledgers = dirs.filter((d) => fs.existsSync(path.join(d, 'savers.json'))).map((d) => new Ledger(path.join(d, 'savers.json')))
const r = report(ledgers, { days })
if (json) {
  console.log(JSON.stringify(r, null, 2))
} else if (!ledgers.length) {
  console.log(`Nothing counted yet in ${home}.`)
} else {
  const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n ?? 0)))
  const side = (c) => (c?.n ? [`${c.n}x`, c.tokens && `${k(c.tokens)} tokens`, c.cost && `$${c.cost.toFixed(2)}`, c.failed && `${c.failed} fell back`].filter(Boolean).join(', ') : '-')
  console.log(`Token savers, ${days ? `the last ${days} days` : `since ${new Date(r.since).toLocaleDateString()}`}\n`)
  console.log(`${'saver'.padEnd(14)} ${'on: what it did'.padEnd(34)} off: what it would have done`)
  for (const s of SAVERS) console.log(`${s.id.padEnd(14)} ${side(r.savers[s.id]?.on).padEnd(34)} ${side(r.savers[s.id]?.off)}`)
  const modes = Object.entries(r.modes).filter(([, m]) => m.turns)
  if (modes.length) {
    console.log(`\n${'savers on'.padEnd(60)} ${'turns'.padStart(7)} ${'per turn'.padStart(10)} ${'tools/turn'.padStart(10)}`)
    for (const [mode, m] of modes.sort(([, x], [, y]) => y.turns - x.turns)) {
      const per = m.cost ? `$${(m.cost / m.turns).toFixed(3)}` : `${k(m.tokens / m.turns)} tok`
      console.log(`${mode.slice(0, 60).padEnd(60)} ${String(m.turns).padStart(7)} ${per.padStart(10)} ${((m.tools ?? 0) / m.turns).toFixed(1).padStart(10)}`)
    }
  }
}

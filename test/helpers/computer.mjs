// One "computer" for the Crew Link tests: a real Crew (hub, local server, link) in its own process and its own
// throwaway CREW_HOME, driven over stdin. Each line in is { id, code }; code runs with `crew` in scope.
import readline from 'node:readline'

const { Crew } = await import('../../core/crew.js')
const crew = new Crew({ bin: new URL('../../bin', import.meta.url).pathname, computerName: process.env.NAME })
await crew.start()
console.log(JSON.stringify({ ready: true }))
for await (const line of readline.createInterface({ input: process.stdin })) {
  const { id, code } = JSON.parse(line)
  try {
    console.log(JSON.stringify({ id, ok: await eval(`(async () => (${code}))()`) }))
  } catch (e) {
    console.log(JSON.stringify({ id, error: e.message }))
  }
}

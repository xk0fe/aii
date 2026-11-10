// One "computer" for the CLIque Link tests: a real CLIque (hub, local server, link) in its own process and its own
// throwaway CLIQUE_HOME, driven over stdin. Each line in is { id, code }; code runs with `clique` in scope.
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const { Clique } = await import('../../core/clique.js')
const clique = new Clique({ bin: fileURLToPath(new URL('../../bin', import.meta.url)), computerName: process.env.NAME })
await clique.start()
console.log(JSON.stringify({ ready: true }))
for await (const line of readline.createInterface({ input: process.stdin })) {
  const { id, code } = JSON.parse(line)
  try {
    console.log(JSON.stringify({ id, ok: await eval(`(async () => (${code}))()`) }))
  } catch (e) {
    console.log(JSON.stringify({ id, error: e.message }))
  }
}

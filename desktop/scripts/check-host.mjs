// CI's check of an installed CLIque on Windows (.github/workflows/ci.yml, build-win): the terminal host the installed
// CLIque started, from its copy of the runtime, runs a terminal and hands its output back, as it does for agents.
//   node scripts/check-host.mjs <CLIQUE_HOME>
// It takes over as the host's client the way a newer CLIque would (core/ptyclient.js), and leaves the host running.
// It works on macOS too, against a host there.
import net from 'node:net'
import path from 'node:path'

const home = (process.env.CLIQUE_HOME = process.argv[2])
const { PROTOCOL, address } = await import('../core/ptyhost.js')
const where = address()
const fail = (why) => {
  console.error(`the terminal host: ${why}`)
  process.exit(1)
}
setTimeout(() => fail('no answer within 60 s'), 60000).unref()

if (!where) fail(`no host has said where it is in ${home}`)
const { path: pipe, token } = where
const sock = net.connect(pipe)
sock.setEncoding('utf8')
sock.on('error', (e) => fail(e.message))
let buf = ''
let printed = ''
const send = (m) => sock.write(JSON.stringify(m) + '\n')
sock.on('connect', () => send({ t: 'hello', token, protocol: PROTOCOL }))
sock.on('data', (chunk) => {
  buf += chunk
  for (let nl; (nl = buf.indexOf('\n')) >= 0; ) {
    const m = JSON.parse(buf.slice(0, nl))
    buf = buf.slice(nl + 1)
    if (m.t === 'hello') {
      if (m.protocol !== PROTOCOL) fail(`it speaks protocol ${m.protocol}, this CLIque ${PROTOCOL}`)
      console.log(`terminal host ${m.pid}: connected`)
      const echo = process.platform === 'win32' ? { file: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), args: ['/d', '/c', 'echo clique-host-ok'] } : { file: '/bin/echo', args: ['clique-host-ok'] }
      send({ t: 'start', name: 'check', ...echo, cwd: home, env: process.env, cols: 80, rows: 24, tag: 'check' })
    } else if (m.t === 'data') {
      printed += m.data
    } else if (m.t === 'exit') {
      if (m.error) fail(`it couldn't start a terminal: ${m.error}`)
      // ConPTY hands the last of the output over around the exit: a moment for it
      setTimeout(() => {
        if (!printed.includes('clique-host-ok')) fail(`the terminal printed ${JSON.stringify(printed.slice(-400))}`)
        console.log(`terminal host: a terminal ran and printed clique-host-ok (exit ${m.code})`)
        sock.end()
        process.exit(0)
      }, 1000)
    }
  }
})

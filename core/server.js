// Local HTTP API used by Claude Code hooks and the `crew` CLI. Plain-text in, plain-text out.
// Every request needs the per-launch token, so web pages can't drive your agents.
import http from 'node:http'

export function serve(hub) {
  const routes = {
    hook: (q, body, name) => hub.onHook(name, JSON.parse(body || '{}')),
    send: (q, body) => hub.send({ from: q.from || 'you', to: q.to, text: body }),
    note: (q, body) => hub.note(q.from || 'you', body),
    who: () => hub.who(),
    board: () => hub.board(),
    // An agent's PermissionRequest hook, held open until you answer in the chat; the reply is its decision
    // (empty: no decision, the agent asks in its terminal). `closed` fires if the hook gives up first.
    ask: (q, body, name, closed) => hub.ask(name, JSON.parse(body || '{}'), closed),
    // `crew task <op> <args...>` (or `crew bug`): the words arrive NUL-separated, so any text survives intact
    task: (q, body) => hub.taskCommand(q.from || 'you', body.split('\0').slice(0, -1)),
    bug: (q, body) => hub.taskCommand(q.from || 'you', body.split('\0').slice(0, -1)),
    // Claude Code's status line: how full the context is; the answer is the line it shows
    status: (q, body, name) => hub.onStatusLine(name, JSON.parse(body || '{}')),
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const [, route, arg] = url.pathname.split('/')
    let body = ''
    for await (const chunk of req) body += chunk
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    if (req.headers['x-crew'] !== hub.token) return res.writeHead(403).end('bad token, is crew running?\n')
    if (!Object.hasOwn(routes, route)) return res.writeHead(404).end('unknown command, try: crew help\n')
    const closed = new AbortController()
    res.on('close', () => res.writableEnded || closed.abort())
    try {
      res.end((await routes[route](Object.fromEntries(url.searchParams), body, arg, closed.signal)) ?? 'ok\n') // a send to another computer resolves later
    } catch (e) {
      res.writeHead(400).end(`${e.message}\n`)
    }
  })

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

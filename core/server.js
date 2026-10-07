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
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const [, route, arg] = url.pathname.split('/')
    let body = ''
    for await (const chunk of req) body += chunk
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    if (req.headers['x-crew'] !== hub.token) return res.writeHead(403).end('bad token, is crew running?\n')
    if (!Object.hasOwn(routes, route)) return res.writeHead(404).end('unknown command, try: crew help\n')
    try {
      res.end((await routes[route](Object.fromEntries(url.searchParams), body, arg)) ?? 'ok\n') // a send to another computer resolves later
    } catch (e) {
      res.writeHead(400).end(`${e.message}\n`)
    }
  })

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

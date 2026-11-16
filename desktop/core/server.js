// Local HTTP API used by Claude Code hooks and the `clique` CLI. Plain-text in, plain-text out.
// Every request needs the per-launch token, so web pages can't drive your agents.
import http from 'node:http'
import { ROOT } from './workspaces.js'

// Every workspace's agents come to the one server, and the X-Clique-Workspace header says which workspace's hub a request
// is for (none: ROOT's agents don't say, see Hub.launch, nor does `clique` in a terminal of your own). `to` is a hub (the one there is) or { token, hubFor(workspace) }.
// What only an agent's hooks and status line ask: they're about that agent, so they never land in another workspace.
const AGENTS_OWN = new Set(['hook', 'lease', 'ask', 'status'])

export function serve(to) {
  const hubFor = to.hubFor ? (id, opts) => to.hubFor(id, opts) : (id) => (id === (to.ws ?? ROOT) ? to : null)
  const routes = (hub) => ({
    hook: (q, body, name) => hub.onHook(name, JSON.parse(body || '{}')),
    // `clique send <name> --new "…"`: new work for the teammate whose hand-off the sender is on (see Hub.send)
    send: (q, body) => {
      const fresh = /^--new(?:\s+|$)/.exec(body)
      return hub.send({ from: q.from || 'you', to: q.to, text: fresh ? body.slice(fresh[0].length) : body, ...(fresh && { newWork: true }) })
    },
    // `clique ask` and `clique wait`: held open until the answer comes (or ASK_HOLD), the answer is the reply
    question: (q, body, name, closed) => hub.question({ from: q.from || 'you', to: q.to, text: body, closed }),
    wait: (q, body, name, closed) => hub.wait({ from: q.from || 'you', closed }),
    answer: (q, body) => hub.answerNow({ from: q.from || 'you', to: q.to, text: body }),
    // An agent's file tools, before they write: one agent edits a file at a time. The reply is the hook's decision.
    lease: (q, body, name) => hub.lease(name, JSON.parse(body || '{}')),
    // `clique lease <thing> ["why"]`: held open while a teammate has it (up to ASK_HOLD); `clique release [thing]`; `clique leases`
    claim: (q, body, name, closed) => hub.claim({ from: q.from || 'you', words: body.split('\0').slice(0, -1), closed }),
    release: (q, body) => hub.give({ from: q.from || 'you', words: body.split('\0').slice(0, -1) }),
    leases: () => hub.leasesText(),
    note: (q, body) => hub.note(q.from || 'you', body),
    channels: (q) => hub.channelsText(q.from || 'you'),
    // `clique post <channel> "…"`: the words NUL-separated, so a channel's name needs no escaping and any text survives intact
    post: (q, body) => hub.postIn(q.from || 'you', body.split('\0').slice(0, -1)),
    // `clique react <emoji>`: one emoji on the message the agent is answering, in place of an acknowledgement
    react: (q, body) => {
      const words = body.split('\0').slice(0, -1)
      if (words.length > 1) throw new Error("clique react takes one emoji and nothing else: it goes on the message you're answering")
      return hub.react({ from: q.from || 'you', emoji: words[0] ?? '' })
    },
    // `clique canvas <op> …`: a board drawn in the chat, and changes to one that's there (core/canvas.js)
    canvas: (q, body) => hub.canvas(q.from || 'you', body.split('\0').slice(0, -1)),
    // `clique attach <file> …`: files shown in the chat (core/attachments.js). The first word is the folder the agent is in
    attach: (q, body) => hub.attach(q.from || 'you', body.split('\0').slice(0, -1)),
    who: () => hub.who(),
    // `clique board [words]`: the words NUL-separated (none from a `clique` older than that: everything, as it was)
    board: (q, body) => hub.board(q.from || 'you', body.split('\0').slice(0, -1)),
    busy: (q) => hub.busy(q.from || 'you'),
    // An agent's PermissionRequest hook, held open until you answer in the chat; the reply is its decision
    // (empty: no decision, the agent asks in its terminal). `closed` fires if the hook gives up first.
    ask: (q, body, name, closed) => hub.ask(name, JSON.parse(body || '{}'), closed),
    // `clique task <op> <args...>` (or `clique bug`): the words arrive NUL-separated, so any text survives intact
    task: (q, body) => hub.taskCommand(q.from || 'you', body.split('\0').slice(0, -1)),
    bug: (q, body) => hub.taskCommand(q.from || 'you', body.split('\0').slice(0, -1)),
    // `clique app <what> …`: an agent changing CLIque itself (core/tools.js). Held open while you're asked (up to
    // ASK_HOLD), the reply is what came of it.
    app: (q, body, name, closed) => hub.appTool(q.from || 'you', body.split('\0').slice(0, -1), closed),
    // Claude Code's status line: how full the context is; the answer is the line it shows
    status: (q, body, name) => hub.onStatusLine(name, JSON.parse(body || '{}')),
  })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const [, route, arg] = url.pathname.split('/')
    let body = ''
    for await (const chunk of req) body += chunk
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    // (x-crew: an agent started before the app's rename, still running, whose hooks were written with that name)
    if ((req.headers['x-clique'] ?? req.headers['x-crew']) !== to.token) return res.writeHead(403).end('bad token, is CLIque running?\n')
    const said = req.headers['x-clique-workspace'] ?? req.headers['x-crew-workspace']
    const ws = said || ROOT
    const hub = hubFor(ws, { anywhere: !said && !AGENTS_OWN.has(route) })
    if (!hub) return res.writeHead(404).end(said ? `there's no workspace "${ws}" in CLIque any more\n` : "there's no workspace yet: make one in CLIque first\n")
    const api = routes(hub)
    if (!Object.hasOwn(api, route)) return res.writeHead(404).end('unknown command, try: clique help\n')
    const closed = new AbortController()
    res.on('close', () => res.writableEnded || closed.abort())
    try {
      res.end((await api[route](Object.fromEntries(url.searchParams), body, arg, closed.signal)) ?? 'ok\n') // a send to another computer resolves later
    } catch (e) {
      res.writeHead(400).end(`${e.message}\n`)
    }
  })

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// Local HTTP API used by Claude Code hooks and the `clique` CLI. Plain-text in, plain-text out.
// Every request shows who it's from: an agent its own key, you the token CLIque writes down when it starts (web pages
// have neither, so they can't drive your agents).
import http from 'node:http'
import { ROOT } from './workspaces.js'
import { keyOwner } from './keys.js'
import { defused } from './framing.js'

// Every workspace's agents come to the one server, and the X-Clique-Workspace header says which workspace's hub a request
// is for (none: ROOT's agents don't say, see Hub.launch, nor does `clique` in a terminal of your own). `to` is a hub (the one there is) or { token, hubFor(workspace) }.
// What only an agent's hooks and status line ask: they're about that agent, so they never land in another workspace.
const AGENTS_OWN = new Set(['hook', 'lease', 'ask', 'status'])

// What a command prints of other people's words (notes, tasks, a canvas, what a teammate is on): nothing in it can pass
// for one of CLIque's own lines or for a fence (core/framing.js).
const theirs = (out) => (typeof out === 'string' ? defused(out) : out)

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
    // `clique canvas <op> …`: a board drawn in the chat, and changes to one that's there (core/canvas.js)
    canvas: async (q, body) => theirs(await hub.canvas(q.from || 'you', body.split('\0').slice(0, -1))),
    who: () => hub.who(),
    // `clique board [words]`: the words NUL-separated (none from a `clique` older than that: everything, as it was)
    board: (q, body) => theirs(hub.board(q.from || 'you', body.split('\0').slice(0, -1))),
    busy: (q) => theirs(hub.busy(q.from || 'you')),
    // An agent's PermissionRequest hook, held open until you answer in the chat; the reply is its decision
    // (empty: no decision, the agent asks in its terminal). `closed` fires if the hook gives up first.
    ask: (q, body, name, closed) => hub.ask(name, JSON.parse(body || '{}'), closed),
    // `clique task <op> <args...>` (or `clique bug`): the words arrive NUL-separated, so any text survives intact
    task: async (q, body) => theirs(await hub.taskCommand(q.from || 'you', body.split('\0').slice(0, -1))),
    bug: async (q, body) => theirs(await hub.taskCommand(q.from || 'you', body.split('\0').slice(0, -1))),
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
    // Who's calling, from what it shows (core/keys.js): an agent's own key says which agent it is, in which workspace.
    // The token CLIque writes down when it starts is yours, for `clique` in a terminal of your own; it also stands
    // for an agent whose CLI an older CLIque started, before agents had keys, until that CLI ends (Hub.legacy).
    // (x-crew: an agent started before the app's rename, still running, whose hooks were written with that name)
    const shown = req.headers['x-clique'] ?? req.headers['x-crew']
    const agent = keyOwner(shown)
    if (!agent && shown !== to.token) return res.writeHead(403).end('bad token, is CLIque running?\n')
    const said = req.headers['x-clique-workspace'] ?? req.headers['x-crew-workspace']
    const ws = agent ? agent.ws : said || ROOT
    if (agent && (said || ROOT) !== agent.ws) return res.writeHead(403).end(`not done: you're @${agent.name}, and that key is for your own workspace\n`)
    const hub = hubFor(ws, { anywhere: !agent && !said && !AGENTS_OWN.has(route) })
    if (!hub) return res.writeHead(404).end(said || agent ? `there's no workspace "${ws}" in CLIque any more\n` : "there's no workspace yet: make one in CLIque first\n")
    // (an agent that's gone, a clone let go: its last hooks are ignored, as they always were; refused, they'd be spooled)
    if (agent && !hub.agents.has(agent.name)) return AGENTS_OWN.has(route) && arg === agent.name ? res.end('') : res.writeHead(403).end(`there's no agent "${agent.name}" in CLIque any more\n`)
    const q = Object.fromEntries(url.searchParams)
    // The name a request gives is only checked, never believed: an agent is who its key says, and can't be you or a
    // teammate; your token can't be an agent that has a key of its own.
    const claimed = AGENTS_OWN.has(route) ? arg : q.from
    const named = (n) => (n === 'you' ? 'the user' : `@${n}`)
    if (agent && claimed && claimed !== agent.name) return res.writeHead(403).end(`not done: you're @${agent.name}, and can't ${AGENTS_OWN.has(route) ? 'report' : 'speak'} as ${named(claimed)}\n`)
    // (a hook of an agent that's gone is let through, to be ignored as it always was: refused, it would be spooled)
    if (!agent && claimed && claimed !== 'you' && !hub.legacy(claimed) && (hub.agents.has(claimed) || !AGENTS_OWN.has(route))) return res.writeHead(403).end(`not done: only @${claimed} itself can ${AGENTS_OWN.has(route) ? 'report' : 'speak'} as @${claimed}\n`)
    if (agent) q.from = agent.name
    const api = routes(hub)
    if (!Object.hasOwn(api, route)) return res.writeHead(404).end('unknown command, try: clique help\n')
    const closed = new AbortController()
    res.on('close', () => res.writableEnded || closed.abort())
    try {
      res.end((await api[route](q, body, arg, closed.signal)) ?? 'ok\n') // a send to another computer resolves later
    } catch (e) {
      res.writeHead(400).end(`${e.message}\n`)
    }
  })

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

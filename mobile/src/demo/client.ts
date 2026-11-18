// The demo clique behaves like a Mac: the same calls as net/client.ts, answered on the phone. Answer a card and the
// agent gets back to work, send a message and someone picks it up and replies, switch workspaces, flip YOLO.
// Nothing leaves the phone.
import type { Push, Snapshot } from '@/net/client'
import type { Agent, ChannelEdit, FeedEntry, Reply, SendOpts, State, Workspace } from '@/net/types'
import type { CliqueLink } from '@/state/types'

import { makeDemo, type Space } from './fixture'
import { inThread } from '@/ui/threads'

const familyOf = (name: string) => name.replace(/\.\d+(?=@|$)/, '')
// read marks are kept per channel, as on the computer (hub.readTo): #general's in `agents`, the others' in `channels`
const readTo = (e: FeedEntry, reads: State['reads']) => Math.max(reads?.since ?? 0, (e.channel && e.channel !== 'general' ? reads?.channels?.[e.channel] : reads?.agents)?.[e.from] ?? 0)
// a channel's id from its name, as core/workspaces.js makes it: lowercase words joined by dashes
const channelId = (name: string) => String(name).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/^#+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
// Ada, Ada.2 (her clone), Rex@workstation (on another computer): the person each of them is
const personOf = (name: string) => familyOf(name).split('@')[0]

// The switcher's line for a workspace, as hub.summary() counts it.
function summary(sp: Space, current: string): Workspace {
  const s = sp.state
  const agents = s.agents.filter((a) => !a.cloneOf)
  const live = agents.filter((a) => a.on && !sp.parked)
  const family = (a: Agent) => s.agents.filter((x) => x === a || x.cloneOf === a.name)
  const read = (e: FeedEntry) => readTo(e, s.reads)
  return {
    id: sp.id, name: sp.name, color: sp.color, icon: sp.icon, parked: sp.parked, current: sp.id === current,
    agents: agents.length,
    on: agents.filter((a) => a.on).length,
    working: live.filter((a) => family(a).some((x) => x.status === 'working')).length,
    waiting: live.flatMap(family).filter((x) => x.status === 'waiting').length,
    unread: s.feed.filter((e) => e.kind === 'reply' && e.from !== 'you' && !inThread(e) && e.ts > read(e)).length,
    faces: agents.filter((a) => a.on).slice(0, 4).map((a) => ({ name: a.name, avatar: a.avatar, status: sp.parked ? 'parked' : a.status })),
    needs: live.flatMap(family).filter((x) => x.status === 'waiting').slice(0, 4).map((x) => ({ name: x.name, avatar: x.avatar, activity: x.activity })),
  }
}

// What an agent says back, so the demo feels alive.
const REPLIES: Record<string, string[]> = {
  Ada: ["On it. I'll start with how the cart adds up its lines.", 'Done. The coupon tests pass again.'],
  Milo: ["Got it. I'll send a build when it's ready.", 'The settings page now follows the system theme.'],
  Iris: ['Love it. Sketching two directions now.', 'Here are the spacing steps I used: 8, 12, 16 and 24.'],
  Theo: ['Running them now on Chrome and Safari.', 'All green. Nothing flaky this time.'],
  June: ["Happy to. I'll keep it short and friendly."],
  Rex: ['Starting a fresh build on the Workstation.'],
  Noor: ["I'll read it through and leave notes."],
}
const WORK: Record<string, string> = {
  Ada: 'Read · api/cart.ts', Milo: 'Edit · src/settings/theme.ts', Iris: 'Read · design/cart.fig', Theo: 'Running the checkout tests',
  June: 'Edit · docs/release-notes.md', 'Rex@workstation': 'Bash · npm run deploy', 'Noor@workstation': 'Read · api/orders.ts',
}

export class DemoClient implements CliqueLink {
  readonly macName = 'Demo clique'
  readonly demo = true
  private spaces: Space[] = makeDemo()
  private ws = this.spaces[0].id
  private listeners = new Set<() => void>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private said = new Map<string, number>()
  private gone = new Set<string>() // ids of deleted channels, never handed out again (core/workspaces.js channelsGone)
  private snap: Snapshot
  private nextId = 1

  constructor() {
    this.snap = this.build()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap
  onPush(_fn: (p: Push) => void) {
    return () => {}
  }
  start() {}
  stop() {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }
  wake() {}

  private build(): Snapshot {
    const sp = this.space()
    const workspaces = this.spaces.map((x) => summary(x, this.ws))
    return { link: { status: 'online', host: 'this phone', since: Date.now() }, ws: this.ws, shown: this.ws, switching: false, state: { ...sp.state, workspaces, workspace: workspaces.find((w) => w.current) } }
  }
  private space(id = this.ws) {
    return this.spaces.find((s) => s.id === id) ?? this.spaces[0]
  }
  private emit() {
    this.snap = this.build()
    for (const fn of this.listeners) fn()
  }
  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
      this.emit()
    }, ms)
    this.timers.add(t)
  }
  private change(id: string, fn: (s: State) => State) {
    this.spaces = this.spaces.map((sp) => (sp.id === id ? { ...sp, state: fn(sp.state) } : sp))
  }
  private agent(id: string, name: string, patch: Partial<Agent>) {
    // (as the Mac says it: an agent in a turn can be stopped)
    const turn = (a: Agent) => ({ ...a, canStop: a.on && (a.status === 'working' || a.status === 'waiting') })
    this.change(id, (s) => ({ ...s, agents: s.agents.map((a) => (a.name === name ? turn({ ...a, ...patch }) : a)) }))
  }
  private post(id: string, entry: Omit<FeedEntry, 'id' | 'ts'>) {
    const e = { id: `d${this.nextId++}`, ts: Date.now(), ...entry } as FeedEntry
    this.change(id, (s) => ({ ...s, feed: [...s.feed, e] }))
    return e
  }
  private reply(id: string, name: string, re: string | undefined, text?: string) {
    const lines = REPLIES[personOf(name)] ?? ['On it.']
    const n = this.said.get(name) ?? 0
    this.said.set(name, n + 1)
    // said where what it answers was said (hub.post inherits the channel through re)
    const parent = this.space(id).state.feed.find((x) => x.id === re)
    const channel = parent?.channel
    this.post(id, { kind: 'reply', from: name, to: 'you', re, text: text ?? lines[n % lines.length], ...(channel && { channel }), ...(parent?.thread && { thread: parent.thread }) })
  }

  async watch(ws: string) {
    if (!this.spaces.some((s) => s.id === ws)) ws = this.spaces[0].id
    this.ws = ws
    this.emit()
  }

  async send(to: string, text: string, opts: SendOpts = {}) {
    const id = this.ws
    const sp = this.space(id)
    const ch = opts.channel && opts.channel !== 'general' ? sp.state.channels?.find((c) => c.id === opts.channel) : undefined
    if (opts.channel && opts.channel !== 'general' && !ch) throw new Error('that channel is gone: it was deleted on the computer')
    if (sp.parked) sp.parked = false // what you send wakes it, as on the computer
    const agents = sp.state.agents.filter((a) => !a.cloneOf)
    const mentioned = [...String(text).matchAll(/(?<![\w@])@([\w-]+(?:@[\w-]+)?)/g)].map((m) => m[1].toLowerCase())
    // names are written as given (Ada), mentions however they're typed (@ada)
    const named = (n: string) => agents.find((a) => a.name.toLowerCase() === n.toLowerCase() || personOf(a.name).toLowerCase() === n.toLowerCase())?.name
    const names = [...new Set([...String(to).split(',').filter(Boolean), ...mentioned].map(named).filter((n): n is string => Boolean(n)))]
    if (to && !names.length) throw new Error(`there's no ${to} here`)
    const off = names.find((n) => !agents.find((a) => a.name === n)?.on)
    if (off) throw new Error(`@${off} is off: turn it on first`)
    // Auto picks among the channel's members, as Clique.send does
    const pool = ch?.members ? agents.filter((a) => ch.members!.includes(a.name)) : agents
    const pick = names.length ? names : [(pool.find((a) => a.on && a.status === 'idle') ?? pool.find((a) => a.on))?.name].filter(Boolean) as string[]
    if (!pick.length) throw new Error(ch?.members ? `nobody in #${ch.name} is on to take it: turn one on, or @name someone` : 'no agents to send to')
    const group = pick.length > 1 ? { cc: pick, sendId: `s${Date.now()}` } : {}
    const sent = pick.map((n) => this.post(id, { kind: 'msg', from: 'you', to: n, text, ...group, ...(!names.length && { auto: true }), ...(opts.thread && { thread: opts.thread }), ...(opts.fresh && { fresh: true }), ...(opts.re && { re: opts.re }), ...(ch && { channel: ch.id }) }))
    this.emit()
    pick.forEach((n, i) => {
      const was = agents.find((a) => a.name === n)
      const busy = was?.status === 'waiting'
      if (!busy) this.later(700 + i * 400, () => this.agent(id, n, { status: 'working', since: Date.now(), activity: WORK[n] ?? 'Read · README.md', channel: ch?.id }))
      this.later(2600 + i * 900, () => {
        this.reply(id, n, sent[i].id)
        if (!busy) this.agent(id, n, { status: was?.status === 'working' ? 'working' : 'idle', since: Date.now(), activity: was?.status === 'working' ? was.activity : '' })
      })
    })
    return `sent to ${pick.map((n) => `@${n}`).join(' ')}\n`
  }

  // As hub.answer → decide: the same replies, the same "already answered" and "pick an answer first".
  async answer(cardId: string, reply: Reply) {
    const id = this.ws
    const e = this.space(id).state.feed.find((x) => x.id === cardId)
    const ask = e && typeof e.ask === 'object' ? e.ask : null
    if (!e || !ask || e.answer) throw new Error('that question has already been answered')
    let answer: FeedEntry['answer']
    let next = ''
    if ('terminal' in reply) answer = { by: 'terminal', handedOver: true }
    else if (ask.type === 'question') {
      const answers: Record<string, string> = {}
      const given = 'answers' in reply ? reply.answers : {}
      for (const q of ask.questions) {
        const v = given[q.question]
        const text = Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v ?? '').trim()
        if (text) answers[q.question] = text
      }
      if (!Object.keys(answers).length) throw new Error('pick an answer first')
      answer = { by: 'you', answers }
      next = `Going with **${Object.values(answers)[0]}**. I'll sketch it and send it over.`
    } else if ('allow' in reply && reply.allow) {
      const always = ask.type === 'permission' ? ask.always?.find((x) => x.i === reply.always)?.label : undefined
      answer = { by: 'you', allow: true, ...(always && { always }) }
      next = ask.type === 'plan' ? "Thanks. I'll start with the first step." : ask.type === 'permission' && ask.tool === 'Bash' ? 'The build passed with **no errors**. The settings page looks right in dark mode.' : 'Done, the edit is in.'
    } else {
      const note = 'note' in reply ? String(reply.note ?? '').trim() : ''
      answer = { by: 'you', allow: false, ...(note && { note }) }
      next = ask.type === 'plan' ? `Back to planning${note ? `: ${note}` : ''}.` : note ? `Okay, not that. ${note.replace(/^./, (c) => c.toUpperCase())}.` : "Okay, I won't. What should I do instead?"
    }
    this.change(id, (s) => ({ ...s, feed: s.feed.map((x) => (x.id === cardId ? { ...x, answer: { ...answer, at: Date.now() } } : x)) }))
    const still = this.space(id).state.feed.some((x) => x.kind === 'ask' && !x.answer && x.from === e.from)
    if (!('terminal' in reply)) this.agent(id, e.from, { status: still ? 'waiting' : 'working', since: Date.now(), activity: ask.type === 'permission' && ask.code ? `${ask.tool ?? 'Bash'} · ${ask.code.split('\n')[0].slice(0, 40)}` : WORK[e.from] ?? '' })
    this.emit()
    if (next) {
      this.later(3200, () => {
        this.reply(id, e.from, e.re, next)
        const open = this.space(id).state.feed.some((x) => x.kind === 'ask' && !x.answer && x.from === e.from)
        if (!open) this.agent(id, e.from, { status: 'idle', since: Date.now(), activity: '' })
      })
    }
  }

  async approve(cardId: string) {
    const id = this.ws
    const e = this.space(id).state.feed.find((x) => x.id === cardId)
    this.change(id, (s) => ({ ...s, feed: s.feed.map((x) => (x.id === cardId ? { ...x, held: false } : x)) }))
    if (e?.to) this.agent(id, e.to, { status: 'working', since: Date.now(), activity: WORK[familyOf(e.to)] ?? 'Read · README.md' })
    this.emit()
  }

  async drop(cardId: string) {
    this.change(this.ws, (s) => ({ ...s, feed: s.feed.map((x) => (x.id === cardId ? { ...x, held: false, dropped: true } : x)) }))
    this.emit()
  }

  // { name: ts } reads every channel; { 'name#channel': ts } one channel's (#general's in `agents`)
  async read(seen: Record<string, number>, ws = this.ws) {
    this.change(ws, (s) => {
      const agents = { ...(s.reads?.agents ?? {}) }
      const channels: Record<string, Record<string, number>> = Object.fromEntries(Object.entries(s.reads?.channels ?? {}).map(([c, book]) => [c, { ...book }]))
      const raise = (book: Record<string, number>, n: string, ts: number) => (book[n] = Math.max(book[n] ?? 0, ts))
      for (const [key, ts] of Object.entries(seen)) {
        const [n, channel] = key.split('#')
        if (channel === undefined) {
          raise(agents, n, ts)
          for (const c of new Set([...Object.keys(channels), ...s.feed.map((e) => e.channel).filter((c): c is string => Boolean(c))])) raise((channels[c] ??= {}), n, ts)
        } else if (channel === 'general') raise(agents, n, ts)
        else raise((channels[channel] ??= {}), n, ts)
      }
      return { ...s, reads: { ...s.reads, agents, channels } }
    })
    this.emit()
  }

  // As clique.channelAction: a new channel's id comes from its name and is never one used before; #general stays.
  async channel(op: 'create' | 'edit' | 'remove', id: string | null, arg: ChannelEdit = {}) {
    if (!['create', 'edit', 'remove'].includes(op)) throw new Error(`"${op}" isn't a channel action`)
    const ws = this.ws
    const list = this.space(ws).state.channels ?? [{ id: 'general', name: 'general' }]
    const name = arg.name === undefined ? undefined : channelId(arg.name)
    const members = arg.members === undefined ? undefined : arg.members?.length ? arg.members : null
    if (op === 'create') {
      if (!name) throw new Error('give the channel a name')
      if (list.some((c) => c.name === name)) throw new Error(`there's a #${name} already`)
      const used = new Set(this.space(ws).state.feed.map((e) => e.channel))
      let made = name
      for (let i = 2; used.has(made) || this.gone.has(made) || list.some((c) => c.id === made); i++) made = `${name}-${i}`
      this.change(ws, (s) => ({ ...s, channels: [...list, { id: made, name, ...(arg.brief?.trim() && { brief: arg.brief.trim() }), ...(members && { members }) }] }))
      this.emit()
      return { id: made }
    }
    const c = list.find((x) => x.id === id)
    if (!c) throw new Error('no such channel')
    if (op === 'remove') {
      if (c.id === 'general') throw new Error("#general can't be removed")
      this.gone.add(c.id)
      this.change(ws, (s) => ({ ...s, channels: list.filter((x) => x.id !== c.id) }))
    } else {
      if (name !== undefined && c.id !== 'general') {
        if (!name) throw new Error('give the channel a name')
        if (list.some((x) => x.name === name && x.id !== c.id)) throw new Error(`there's a #${name} already`)
      }
      const next = { ...c, ...(name && c.id !== 'general' && { name }), ...(arg.brief !== undefined && { brief: arg.brief.trim() || undefined }) }
      if (members !== undefined && c.id !== 'general') {
        if (members) next.members = members
        else delete next.members
      }
      this.change(ws, (s) => ({ ...s, channels: list.map((x) => (x.id === c.id ? next : x)) }))
    }
    this.emit()
    return { id: c.id }
  }

  // As the Mac does: turned off, its open questions are no longer waiting (hub.forgetAsks); turned on, it starts in the
  // workspace it was turned on in, wherever the phone looks meanwhile.
  async power(name: string, on: boolean) {
    const id = this.ws
    this.agent(id, name, { on, status: on ? 'starting' : 'off', since: Date.now(), activity: '' })
    if (!on) this.change(id, (s) => ({ ...s, feed: s.feed.map((x) => (x.kind === 'ask' && !x.answer && familyOf(x.from) === familyOf(name) ? { ...x, answer: { stale: true, at: Date.now() } } : x)) }))
    this.emit()
    if (on) this.later(1400, () => this.agent(id, name, { status: 'idle', since: Date.now() }))
  }

  async setModes(name: string, modes: { yolo?: boolean; fast?: boolean }) {
    this.agent(this.ws, name, { ...(modes.yolo !== undefined && { yolo: modes.yolo }), ...(modes.fast !== undefined && { fast: modes.fast, tier: modes.fast ? 'fast' : undefined }) })
    this.emit()
  }

  async agentAction(action: 'freshStart' | 'restart' | 'markIdle', name: string) {
    const id = this.ws
    const a = this.space(id).state.agents.find((x) => x.name === name)
    if (!a) throw new Error(`there's no ${name} here`)
    if (action === 'freshStart') {
      if (a.status === 'working' || a.status === 'waiting') this.agent(id, name, { freshPending: true })
      else {
        this.agent(id, name, { convo: { since: Date.now(), tasks: 0, compactions: 0, context: { pct: 2, size: a.convo?.context?.size ?? 200000, used: 4000 } } })
        this.post(id, { kind: 'event', fresh: true, from: name, text: 'started a new conversation' })
      }
    }
    if (action === 'restart') {
      this.agent(id, name, { status: 'starting', since: Date.now(), activity: '' })
      this.later(1500, () => this.agent(id, name, { status: 'idle', since: Date.now() }))
    }
    if (action === 'markIdle') this.agent(id, name, { status: 'idle', since: Date.now(), activity: '' })
    this.emit()
  }

  // Stop, as the Mac does it: their turns end, they stay on, and one line says who you stopped
  // The demo clique attaches no pictures of its own, and has no computer to fetch one from.
  async image(_path: string): Promise<Uint8Array> {
    throw new Error('the demo clique has no pictures')
  }

  async stopAgents(names: string[], opts?: { channel?: string }) {
    const id = this.ws
    const stopped = this.space(id).state.agents.filter((a) => names.includes(a.name) && a.canStop).map((a) => a.name)
    for (const name of stopped) this.agent(id, name, { status: 'idle', since: Date.now(), activity: '' })
    if (stopped.length) {
      const who = stopped.map((n) => `@${n}`)
      this.post(id, { kind: 'event', from: 'clique', stop: true, about: stopped, text: `you stopped ${who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : who[0]}`, ...(opts?.channel && opts.channel !== 'general' && { channel: opts.channel }) })
    }
    this.emit()
    return { stopped, dropped: 0 }
  }
}

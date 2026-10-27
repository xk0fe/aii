// The demo crew behaves like a Mac: the same calls as net/client.ts, answered on the phone. Answer a card and the
// agent gets back to work, send a message and someone picks it up and replies, switch workspaces, flip YOLO.
// Nothing leaves the phone.
import type { Push, Snapshot } from '@/net/client'
import type { Agent, FeedEntry, Reply, State, Workspace } from '@/net/types'
import type { CrewLink } from '@/state/types'

import { makeDemo, type Space } from './fixture'

const familyOf = (name: string) => name.replace(/\.\d+(?=@|$)/, '')

// The switcher's line for a workspace, as hub.summary() counts it.
function summary(sp: Space, current: string): Workspace {
  const s = sp.state
  const agents = s.agents.filter((a) => !a.cloneOf)
  const live = agents.filter((a) => a.on && !sp.parked)
  const family = (a: Agent) => s.agents.filter((x) => x === a || x.cloneOf === a.name)
  const read = (from: string) => Math.max(s.reads?.since ?? 0, s.reads?.agents?.[from] ?? 0)
  return {
    id: sp.id, name: sp.name, color: sp.color, icon: sp.icon, parked: sp.parked, current: sp.id === current,
    agents: agents.length,
    on: agents.filter((a) => a.on).length,
    working: live.filter((a) => family(a).some((x) => x.status === 'working')).length,
    waiting: live.flatMap(family).filter((x) => x.status === 'waiting').length,
    unread: s.feed.filter((e) => e.kind === 'reply' && e.from !== 'you' && e.ts > read(e.from)).length,
    faces: agents.filter((a) => a.on).slice(0, 4).map((a) => ({ name: a.name, avatar: a.avatar, status: sp.parked ? 'parked' : a.status })),
    needs: live.flatMap(family).filter((x) => x.status === 'waiting').slice(0, 4).map((x) => ({ name: x.name, avatar: x.avatar, activity: x.activity })),
  }
}

// What an agent says back, so the demo feels alive.
const REPLIES: Record<string, string[]> = {
  joseph: ["On it. The server side is mine: I'll look at `hub.send` first and report back.", 'Done. **42 passing**, nothing flaky this time.'],
  david: ["Got it. I'll start with the screen you mean and send a build when it's ready.", 'Pushed the fix to `feat/hold-card`. Want a TestFlight build?'],
  gal: ['Love it. Sketching two directions now, both in the felt look.', 'Here are the spacing tokens I used: `8 / 12 / 16 / 24`.'],
  marc: ['Painting it now, soft pastels and felt texture.'],
  arie: ["Noted. I'll put it on the board and nudge whoever owns it.", 'Added to the release checklist.'],
  jeff: ['Happy to help! Give me a sec to read up.'],
  ye: ['Pulling the numbers from PostHog now.'],
}
const WORK: Record<string, string> = {
  joseph: 'Read core/hub.js', david: 'Edit src/screens/Home.tsx', gal: 'Read design/tokens.json', marc: 'image_gen: new sketch',
  arie: 'Read RELEASE.md', jeff: 'Read docs/faq.md', ye: 'Bash: npx posthog query', 'scarlett@mac-mini': 'Bash: npm run e2e',
}

export class DemoClient implements CrewLink {
  readonly macName = 'Demo crew'
  readonly demo = true
  private spaces: Space[] = makeDemo()
  private ws = 'default'
  private listeners = new Set<() => void>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private said = new Map<string, number>()
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
    this.change(id, (s) => ({ ...s, agents: s.agents.map((a) => (a.name === name ? { ...a, ...patch } : a)) }))
  }
  private post(id: string, entry: Omit<FeedEntry, 'id' | 'ts'>) {
    const e = { id: `d${this.nextId++}`, ts: Date.now(), ...entry } as FeedEntry
    this.change(id, (s) => ({ ...s, feed: [...s.feed, e] }))
    return e
  }
  private reply(id: string, name: string, re: string | undefined, text?: string) {
    const lines = REPLIES[familyOf(name)] ?? ['On it.']
    const n = this.said.get(name) ?? 0
    this.said.set(name, n + 1)
    this.post(id, { kind: 'reply', from: name, to: 'you', re, text: text ?? lines[n % lines.length] })
  }

  async watch(ws: string) {
    if (!this.spaces.some((s) => s.id === ws)) ws = 'default'
    this.ws = ws
    this.emit()
  }

  async send(to: string, text: string, opts: { fresh?: boolean; re?: string } = {}) {
    const id = this.ws
    const sp = this.space(id)
    if (sp.parked) throw new Error(`${sp.name} is parked: open it on the Mac first`)
    const agents = sp.state.agents.filter((a) => !a.cloneOf)
    const mentioned = [...String(text).matchAll(/(?<![\w@])@([\w-]+(?:@[\w-]+)?)/g)].map((m) => m[1].toLowerCase())
    const names = [...new Set([...String(to).split(',').filter(Boolean), ...mentioned])].filter((n) => agents.some((a) => a.name === n))
    if (to && !names.length) throw new Error(`there's no ${to} here`)
    const off = names.find((n) => !agents.find((a) => a.name === n)?.on)
    if (off) throw new Error(`@${off} is off: turn it on first`)
    const pick = names.length ? names : [(agents.find((a) => a.on && a.status === 'idle') ?? agents.find((a) => a.on))?.name].filter(Boolean) as string[]
    if (!pick.length) throw new Error('no agents to send to')
    const group = pick.length > 1 ? { cc: pick, sendId: `s${Date.now()}` } : {}
    const sent = pick.map((n) => this.post(id, { kind: 'msg', from: 'you', to: n, text, ...group, ...(opts.fresh && { fresh: true }), ...(opts.re && { re: opts.re }) }))
    this.emit()
    pick.forEach((n, i) => {
      const was = agents.find((a) => a.name === n)
      const busy = was?.status === 'waiting'
      if (!busy) this.later(700 + i * 400, () => this.agent(id, n, { status: 'working', since: Date.now(), activity: WORK[n] ?? 'Read README.md' }))
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
      next = `Going with **${Object.values(answers)[0]}**. I'll wire it up and send a build.`
    } else if ('allow' in reply && reply.allow) {
      const always = ask.type === 'permission' ? ask.always?.find((x) => x.i === reply.always)?.label : undefined
      answer = { by: 'you', allow: true, ...(always && { always }) }
      next = ask.type === 'plan' ? 'Plan approved. Cutting `release/2.4` as soon as #4647 lands.' : ask.type === 'permission' && ask.tool === 'Bash' ? "Build's green: **0 errors**. The dist folder is fresh." : 'Done, the edit is in.'
    } else {
      const note = 'note' in reply ? String(reply.note ?? '').trim() : ''
      answer = { by: 'you', allow: false, ...(note && { note }) }
      next = ask.type === 'plan' ? `Back to planning${note ? `: ${note}` : ''}.` : note ? `Okay, not that. ${note.replace(/^./, (c) => c.toUpperCase())}.` : "Okay, I won't. What should I do instead?"
    }
    this.change(id, (s) => ({ ...s, feed: s.feed.map((x) => (x.id === cardId ? { ...x, answer: { ...answer, at: Date.now() } } : x)) }))
    const still = this.space(id).state.feed.some((x) => x.kind === 'ask' && !x.answer && x.from === e.from)
    if (!('terminal' in reply)) this.agent(id, e.from, { status: still ? 'waiting' : 'working', since: Date.now(), activity: ask.type === 'permission' && ask.code ? `${ask.tool ?? 'Bash'}: ${ask.code.split('\n')[0].slice(0, 40)}` : WORK[e.from] ?? '' })
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
    if (e?.to) this.agent(id, e.to, { status: 'working', since: Date.now(), activity: WORK[familyOf(e.to)] ?? 'Read README.md' })
    this.emit()
  }

  async drop(cardId: string) {
    this.change(this.ws, (s) => ({ ...s, feed: s.feed.map((x) => (x.id === cardId ? { ...x, held: false, dropped: true } : x)) }))
    this.emit()
  }

  async read(seen: Record<string, number>, ws = this.ws) {
    this.change(ws, (s) => {
      const agents = { ...(s.reads?.agents ?? {}) }
      for (const [n, ts] of Object.entries(seen)) agents[n] = Math.max(agents[n] ?? 0, ts)
      return { ...s, reads: { ...s.reads, agents } }
    })
    this.emit()
  }

  async power(name: string, on: boolean) {
    this.agent(this.ws, name, { on, status: on ? 'starting' : 'off', since: Date.now(), activity: '' })
    this.emit()
    if (on) this.later(1400, () => this.agent(this.ws, name, { status: 'idle', since: Date.now() }))
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
}

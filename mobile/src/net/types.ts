// What a phone's state looks like (PROTOCOL.md, "The state a phone gets"): Crew.snapshot() for one workspace, minus
// what a phone mustn't have. Fields are optional where the Mac leaves them out.

export type Avatar = { body?: string; color?: string; eyes?: string; mouth?: string; hat?: string; cheeks?: boolean; seed?: string }

export type Context = { pct: number; size: number; used: number; window?: number; limit?: number }
export type Convo = { since?: number; tasks?: number; compactions?: number; context?: Context; ticket?: number | string | null }

export type Sub = { id: string; type: string; description?: string; started: number; ended: number | null; tools?: number; activity?: string }
export type Waiting = { name: string; since: number; id?: string; text?: string; waiting?: boolean }

export type Agent = {
  name: string
  area?: string
  provider?: string
  model?: string
  effort?: string
  tier?: string
  fast?: boolean
  avatar?: Avatar
  seed?: string
  status: string // working | waiting | idle | starting | off | stopped | parked | away
  since?: number
  activity?: string
  queue?: number
  yolo?: boolean
  pending?: boolean
  on: boolean
  convo?: Convo | null
  contextLimit?: number | null
  freshPending?: boolean
  ticket?: number | string | null
  shared?: boolean
  clones?: number
  cloneOf?: string
  clone?: number
  subs?: Sub[]
  waitingOn?: Waiting[]
  owes?: Waiting[]
  holds?: string[]
  home?: string | null
  homeName?: string
  nearLimit?: boolean
}

// app: an agent tool (crew app, desktop/core/tools.js), a change to CLIque itself, answered only in the chat; say: its own words
export type PermissionAsk = { type: 'permission'; tool?: string; title?: string; code?: string; detail?: string; always?: { i: number; label: string }[]; alert?: string; app?: boolean; say?: string }
export type Question = { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] }
export type QuestionAsk = { type: 'question'; questions: Question[]; alert?: string }
export type PlanAsk = { type: 'plan'; plan: string; alert?: string }
export type Ask = PermissionAsk | QuestionAsk | PlanAsk

// What became of a question card (hub.js settle).
export type Answer = {
  by?: 'you' | 'terminal' | 'cli'
  allow?: boolean
  always?: string
  note?: string
  answers?: Record<string, string>
  stale?: boolean
  handedOver?: boolean
  why?: string
  failed?: string // an agent tool you allowed that didn't work: why
  at?: number
}

// What `answer` takes (hub.js decide): a permission or a plan, a question's answers, or "in its terminal instead".
export type Reply = { allow: boolean; always?: number; note?: string } | { answers: Record<string, string | string[]> } | { terminal: true }

export type FeedEntry = {
  id: string
  ts: number
  kind: string // msg | reply | handoff | note | event | ask | task | bug | rule
  from: string
  to?: string
  cc?: string[]
  auto?: boolean // you named nobody: Auto picked `to`
  channel?: string // said in a channel other than #general (its id)
  text?: string
  re?: string
  also?: string[]
  ask?: Ask | true // a card (kind 'ask'), or a teammate's `crew ask` (a msg)
  answer?: Answer
  answered?: { by: string; at: number; reply?: string; why?: string }
  cli?: string
  held?: boolean
  queued?: boolean
  dropped?: boolean
  sendId?: string
  ticket?: number | string
  title?: string
  type?: string
  act?: string
  owner?: string
  fresh?: boolean
  triage?: boolean
  images?: string[]
  rule?: string
  file?: string
  thing?: string
  line?: string[]
  via?: string
  alert?: boolean
  empty?: boolean
  count?: number
  subs?: { type: string; description?: string; tools?: number; ms?: number; running?: boolean }[]
}

export type Face = { name: string; avatar?: Avatar; status?: string; activity?: string }

export type Workspace = {
  id: string
  name: string
  color?: string | null
  icon?: string | null
  folder?: string | null
  parked?: boolean
  current?: boolean
  agents?: number
  on?: number
  working?: number
  waiting?: number
  unread?: number
  faces?: Face[]
  needs?: Face[]
}

// agents: up to when you've read each agent's replies in #general; channels: the same for each other channel
export type Reads = { since?: number; agents?: Record<string, number>; channels?: Record<string, Record<string, number>> }

export type State = {
  parked?: boolean
  autopilot?: boolean
  providers?: Record<string, { label: string }>
  agents: Agent[]
  feed: FeedEntry[]
  reads?: Reads
  usage?: Record<string, { label: string; windows: { id: string; pct: number; resetsAt: number; label?: string }[] }>
  spend?: Record<string, number>
  tasks?: unknown
  workspaces?: Workspace[]
  workspace?: Workspace
  computers?: { slug: string; name: string; online: boolean }[]
}

// One Mac this phone is paired with, as kept on the phone (the private key D lives apart, in secure storage).
export type MacRecord = {
  id: string // macId
  name: string
  key: string // b64(M.pub)
  hosts: string[]
  port: number
  deviceId: string
  ws?: string // the workspace this phone watches there
  pairedAt: number
}

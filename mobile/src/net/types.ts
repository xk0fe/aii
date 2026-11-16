// What a phone's state looks like (PROTOCOL.md, "The state a phone gets"): Clique.snapshot() for one workspace, minus
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
  channel?: string // the channel of what it's working on, while working or waiting (none: #general)
  thread?: string // the thread of what it's working on, if that has one
  system?: boolean // Q (desktop/core/system-agent.js): comes with every workspace, and what you send without naming anyone goes to him
}

// A channel of the workspace: #general (id 'general', everyone) first, then the ones you made. Its brief is what its
// agents are told with their first message there; members are who's in it (none: everyone).
export type Channel = { id: string; name: string; brief?: string; members?: string[] }
// what's said in a channel goes with its id (none: #general); a channel's change (members: null is everyone again)
export type SendOpts = { fresh?: boolean; re?: string; channel?: string; thread?: string }
export type ChannelEdit = { name?: string; brief?: string; members?: string[] | null }

// app: an agent tool (clique app, desktop/core/tools.js), a change to CLIque itself, answered only in the chat; say: its own words
export type PermissionAsk = { type: 'permission'; tool?: string; title?: string; code?: string; detail?: string; always?: { i: number; label: string }[]; alert?: string; app?: boolean; say?: string; trust?: boolean }
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

// A thread, as one card in the chat.
export type ThreadCard = { opener: string; others: string[]; n: number; span: number; asking?: string; working: boolean; latest?: string; latestFrom?: string }

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
  ask?: Ask | true // a card (kind 'ask'), or a teammate's `clique ask` (a msg)
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
  files?: FeedFile[] // what an agent attached: what each file is (it stays on the computer)
  caption?: string // with files: what the agent said, without the line of `text` that names the files for older phones
  rule?: string
  file?: string
  thing?: string
  line?: string[]
  via?: string
  answers?: string // an answer that went back to the teammate who asked: the reply already says it
  thread?: string // the thread this line is in (the id of the line it hangs off); no thread: the channel
  out?: boolean // this line of a thread shows in the channel too
  gist?: string // the line a thread shows for it: its agent's own first sentence
  echo?: string // the hand-off this reply only repeats
  asks?: boolean // an agent's question nobody took up in the thread, brought out to you
  card?: ThreadCard // kind 'thread': what the chat shows for a whole thread (ui/threads.ts), never from the computer
  alert?: boolean
  empty?: boolean
  count?: number
  subs?: { type: string; description?: string; tools?: number; ms?: number; running?: boolean }[]
  reactions?: Reaction[] // one emoji each, in place of a written "got it" (shared/protocol.js)
}

// Who put which emoji on a message, and the few words that came with it (an agent's `clique react`, or yours on the computer)
export type Reaction = { by: string; emoji: string; at?: number; said?: string }

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
  workspace?: Workspace | null // null: the computer has none yet
  computers?: { slug: string; name: string; online: boolean }[]
  channels?: Channel[] // missing from a Mac from before channels reached phones: one chat, sends go to #general
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

// A file an agent attached to a message (`clique attach`): its name, what it is, how big. Never the file itself.
export type FeedFile = { name: string; kind: 'image' | 'video' | 'html' | 'file'; size: number; w?: number; h?: number; dur?: number }

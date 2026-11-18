// What the screens talk to: a connection to a Mac (net/client.ts) or the demo clique (demo/client.ts), which behave
// the same.
import type { Push, Snapshot } from '@/net/client'
import type { ChannelEdit, Reply, SendOpts } from '@/net/types'

export interface CliqueLink {
  readonly macName: string
  readonly demo?: boolean
  subscribe(fn: () => void): () => void
  getSnapshot(): Snapshot
  onPush(fn: (p: Push) => void): () => void
  start(): void
  stop(): void
  wake(): void
  watch(ws: string): Promise<void>
  send(to: string, text: string, opts?: SendOpts): Promise<unknown>
  channel(op: 'create' | 'edit' | 'remove', id: string | null, arg?: ChannelEdit): Promise<{ id: string }>
  answer(id: string, reply: Reply): Promise<unknown>
  approve(id: string): Promise<unknown>
  drop(id: string): Promise<unknown>
  read(seen: Record<string, number>, ws?: string): Promise<unknown>
  power(name: string, on: boolean): Promise<unknown>
  setModes(name: string, modes: { yolo?: boolean; fast?: boolean }): Promise<unknown>
  agentAction(action: 'freshStart' | 'restart' | 'markIdle', name: string): Promise<unknown>
  // Stop: end the turn these agents are in. They stay on.
  stopAgents(names: string[], opts?: { channel?: string }): Promise<unknown>
  // A picture from the chat, as bytes: one of CLIque's own (an agent attached it, or you sent it from the computer)
  image(path: string): Promise<Uint8Array>
}

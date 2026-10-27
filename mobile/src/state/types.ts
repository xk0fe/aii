// What the screens talk to: a connection to a Mac (net/client.ts) or the demo crew (demo/client.ts), which behave
// the same.
import type { Push, Snapshot } from '@/net/client'
import type { Reply } from '@/net/types'

export interface CrewLink {
  readonly macName: string
  readonly demo?: boolean
  subscribe(fn: () => void): () => void
  getSnapshot(): Snapshot
  onPush(fn: (p: Push) => void): () => void
  start(): void
  stop(): void
  wake(): void
  watch(ws: string): Promise<void>
  send(to: string, text: string, opts?: { fresh?: boolean; re?: string }): Promise<unknown>
  answer(id: string, reply: Reply): Promise<unknown>
  approve(id: string): Promise<unknown>
  drop(id: string): Promise<unknown>
  read(seen: Record<string, number>, ws?: string): Promise<unknown>
  power(name: string, on: boolean): Promise<unknown>
  setModes(name: string, modes: { yolo?: boolean; fast?: boolean }): Promise<unknown>
  agentAction(action: 'freshStart' | 'restart' | 'markIdle', name: string): Promise<unknown>
}

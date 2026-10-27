// The creatures' specs, as desktop/ui/avatar.js has them: the same name or look gives the same creature on the phone
// as on the Mac. The drawing is in creature.tsx.
import type { Avatar } from '@/net/types'

export const INK = '#17161a'

export const COLORS: Record<string, string> = {
  blue: '#2f6bff', sky: '#3db8ff', lime: '#72d63a', mint: '#2fd3a6', yellow: '#ffc61f', orange: '#ff8a1f',
  pink: '#ff45a8', red: '#ff5252', purple: '#8b5cf6', lilac: '#c38bff', peach: '#ffa27f', teal: '#16b9c6',
}

export type Extra = { kind: 'circle'; cx: number; cy: number; r: number } | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotate: number }

export type Body = { d: string; extra?: Extra[]; eyes: [[number, number], [number, number]]; mouth: [number, number]; top: [number, number]; wide?: boolean }

// Each body: its outline, extra shapes (ears, eye bumps), and where its face and head-top sit, in a 100x100 box.
export const BODIES: Record<string, Body> = {
  blob: {
    d: 'M21 96C10 96 4 88 8 79C1 71 5 57 17 54C16 41 29 32 42 37C48 26 64 25 71 35C85 33 95 45 90 57C98 63 98 77 90 83C93 91 88 96 80 96Z',
    eyes: [[40, 67], [60, 67]], mouth: [50, 77], top: [55, 31],
  },
  frog: {
    d: 'M9 96C7 73 24 57 50 57C76 57 93 73 91 96Z',
    extra: [{ kind: 'circle', cx: 31, cy: 54, r: 14.5 }, { kind: 'circle', cx: 69, cy: 54, r: 14.5 }],
    eyes: [[31, 52], [69, 52]], mouth: [50, 80], top: [50, 41], wide: true,
  },
  drop: {
    d: 'M50 25C61 25 91 65 91 81C91 92 80 96 50 96C20 96 9 92 9 81C9 65 39 25 50 25Z',
    eyes: [[41, 70], [59, 70]], mouth: [50, 80], top: [50, 27],
  },
  heart: {
    d: 'M50 95C33 85 8 71 8 50C8 34 19 25 31 25C40 25 46 30 50 37C54 30 60 25 69 25C81 25 92 34 92 50C92 71 67 85 50 95Z',
    eyes: [[38, 55], [62, 55]], mouth: [50, 65], top: [69, 27],
  },
  bean: {
    d: 'M31 96C19 96 17 88 17 72V51C17 32 31 19 50 19C69 19 83 32 83 51V72C83 88 81 96 69 96Z',
    eyes: [[40, 53], [60, 53]], mouth: [50, 63], top: [50, 20],
  },
  mochi: {
    d: 'M5 96C5 71 25 51 50 51C75 51 95 71 95 96Z',
    eyes: [[37, 76], [63, 76]], mouth: [50, 84], top: [50, 51], wide: true,
  },
  cat: {
    d: 'M12 96C10 77 15 63 22 57L19 31L39 45C46 43 54 43 61 45L81 31L78 57C85 63 90 77 88 96Z',
    eyes: [[39, 67], [61, 67]], mouth: [50, 76], top: [50, 43],
  },
  bunny: {
    d: 'M14 96C12 75 28 59 50 59C72 59 88 75 86 96Z',
    extra: [{ kind: 'ellipse', cx: 38, cy: 38, rx: 8.5, ry: 22, rotate: -12 }, { kind: 'ellipse', cx: 62, cy: 38, rx: 8.5, ry: 22, rotate: 12 }],
    eyes: [[40, 77], [60, 77]], mouth: [50, 85], top: [50, 59],
  },
}

export const HAT_NAMES = ['none', 'beret', 'party', 'crown', 'bow', 'sprout', 'flower', 'headphones', 'glasses', 'shades']
const PARTS = {
  body: Object.keys(BODIES),
  color: Object.keys(COLORS),
}

// FNV-1a, character by character, exactly as avatar.js does it
export function hash(s: unknown) {
  let h = 2166136261
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

export type Spec = { body: string; color: string; eyes: string; mouth: string; hat: string; cheeks: boolean }

// Every part gets its own hash of the name, so similar names still get clearly different creatures.
export function seeded(name: string): Spec {
  const pick = <T,>(part: string, list: T[]) => list[hash(`${name}:${part}`) % list.length]
  const body = pick('body', PARTS.body)
  return {
    body,
    color: pick('color', PARTS.color),
    eyes: body === 'frog' ? 'googly' : pick('eyes', ['dot', 'dot', 'sparkle', 'sparkle', 'happy']),
    mouth: pick('mouth', ['none', 'smile', 'cat', 'grin', 'none']),
    hat: pick('hat', ['none', 'none', 'beret', 'glasses', 'shades', 'bow', 'sprout', 'party', 'crown', 'flower', 'headphones']),
    cheeks: pick('cheeks', [true, true, true, false]),
  }
}

export type Someone = { name: string; seed?: string; avatar?: Avatar }

// Whatever the look doesn't set comes from a seed: the name it was made with (kept through imports and moves).
export const avatarOf = (agent: Someone): Spec => ({ ...seeded(agent.avatar?.seed ?? agent.seed ?? agent.name), ...(agent.avatar as Partial<Spec>) })
export const colorOf = (spec: { color: string }) => COLORS[spec.color] ?? spec.color ?? '#888888'
export const agentColor = (agent: Someone) => colorOf(avatarOf(agent))

export type Mood = 'working' | 'waiting' | 'starting' | 'sleep' | 'idle' | 'still'
const MOODS: Record<string, Mood> = { working: 'working', waiting: 'waiting', starting: 'starting', off: 'sleep', stopped: 'sleep' }

// Waiting on a teammate's answer, it rests instead of hopping: it isn't working, it's waiting.
export const moodOf = (agent: { status?: string; on?: boolean; waitingOn?: unknown[] }): Mood => {
  if (agent.on === false) return 'sleep'
  if (agent.status === 'working' && agent.waitingOn?.length) return 'idle'
  return MOODS[agent.status ?? ''] ?? 'idle'
}

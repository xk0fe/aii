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

// hop: a little jump on a loop, for a short wait that isn't an agent's work (pairing). No status gives it.
export type Mood = 'working' | 'waiting' | 'starting' | 'sleep' | 'idle' | 'still' | 'hop'
// parked (its workspace is resting) and away (its computer can't be reached) sleep too, as their pose does
const MOODS: Record<string, Mood> = { working: 'working', waiting: 'waiting', starting: 'starting', off: 'sleep', stopped: 'sleep', parked: 'sleep', away: 'sleep' }

// Waiting on a teammate's answer, it rests instead of typing: it isn't working, it's waiting.
export const moodOf = (agent: { status?: string; on?: boolean; waitingOn?: unknown[] }): Mood => {
  if (agent.on === false) return 'sleep'
  if (agent.status === 'working' && agent.waitingOn?.length) return 'idle'
  return MOODS[agent.status ?? ''] ?? 'idle'
}

// ---- v2: poses and felt props (the design's avatar-v2.js poseOf) ----
// The creature acts out its status with a felt prop, from 64px up; smaller creatures stay plain, except at work: a
// working creature sits at its laptop at every size (below POSE_MIN a simpler one, drawn to read small).
export type Pose = 'laptop' | 'mug' | 'sign' | 'question' | 'pop' | 'sleep'
export const POSE_MIN = 64

// Status -> pose: at its laptop while it works, a mug when idle, the "OK?" sign when it needs your OK, a speech
// bubble when it has a question, rising from its patch while it starts, asleep when it's off. Waiting on a teammate's
// answer it rests with its mug: it isn't working, it's waiting.
export function poseOf(agent: { status?: string; on?: boolean; waitingOn?: unknown[] }, ask?: string): Pose {
  if (agent.on === false || ['off', 'stopped', 'parked', 'away'].includes(agent.status ?? '')) return 'sleep'
  if (agent.status === 'waiting') return ask === 'question' ? 'question' : 'sign'
  if (agent.status === 'working') return agent.waitingOn?.length ? 'mug' : 'laptop'
  if (agent.status === 'starting') return 'pop'
  return 'mug'
}

// What a pose draws, in the creature's 100x100 box. `felt` shapes get the fuzzy edge, the roundness gradients and the
// grain; the rest are drawn plain, `under` the felt or over it.
export type Shape = (
  | { kind: 'path'; d: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number }
) & { fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; felt?: boolean; under?: boolean }

export type PoseArt = {
  s: number // the figure's scale
  dx: number // and shift, in % of the box
  dy: number
  rot: number // and tilt, in degrees
  clip?: number // cut off this % from the bottom (rising out of a hole)
  back?: Shape[] // behind the creature, still
  held?: Shape[] // moves with it
  stand?: Shape[] // in front of it, still
  float?: Shape[] // drifting above
}

// Where each body's right side sits around paw height, so a paw can reach the stick of a sign.
const SIDE: Record<string, number> = { blob: 92, frog: 89, drop: 86, heart: 86, bean: 83, mochi: 90, cat: 87, bunny: 85 }
// Felt for the props: soft warm neutrals, so the creature's own colour stays the only loud one.
export const PROP = { lid: '#dfe2e8', base: '#a3a9b4', mug: '#f6efe3', band: '#ff9478', coffee: '#7b4a2c', steam: '#c9c1b6', board: '#fff3d6', wood: '#c48a55', bubble: '#fffaf1', hole: '#2a2230', zz: '#a69fd0' }
// The small laptop (desktop/ui/avatar.js LAPTOP_SMALL), as an emoji draws one: a few chunky shapes in a silver that
// reads on a light and on a dark screen, and no fine detail.
const LAPTOP_SMALL = { s: 0.86, lid: 67, gap: 3, w: 27, fill: '#b4bac6', base: '#7f8694', logo: 4.2 }

// small: the creature is under POSE_MIN (only the laptop has a small drawing).
export function poseArt(pose: Pose, spec: Spec, small = false): PoseArt {
  const b = BODIES[spec.body] ?? BODIES.blob
  const color = colorOf(spec)
  const paw = (cx: number, cy: number, rx = 5, ry = 3.8): Shape => ({ kind: 'ellipse', cx, cy, rx, ry, fill: color, felt: true })
  if (pose === 'laptop' && small) {
    // the creature stays as large as it can with its mouth clear of the lid
    const L = LAPTOP_SMALL
    const mouth = 97 - (97 - b.mouth[1]) * L.s
    const mid = (L.lid + 90) / 2 + 0.5
    return {
      s: L.s, dx: 0, dy: -Math.max(0, mouth + L.gap - L.lid), rot: 0,
      stand: [
        { kind: 'path', d: `M${50 - L.w + 2} ${L.lid + 4}Q${50 - L.w + 2} ${L.lid} ${50 - L.w + 6} ${L.lid}H${50 + L.w - 6}Q${50 + L.w - 2} ${L.lid} ${50 + L.w - 2} ${L.lid + 4}L${50 + L.w} 92H${50 - L.w}Z`, fill: L.fill, felt: true },
        { kind: 'rect', x: 50 - L.w - 9, y: 90, w: 2 * L.w + 18, h: 7, r: 3.5, fill: L.base, felt: true },
        { kind: 'ellipse', cx: 50, cy: mid, rx: L.logo, ry: L.logo, fill: '#fff', opacity: 0.9 },
      ],
    }
  }
  switch (pose) {
    case 'laptop': {
      const s = 0.84
      const lid = 70
      const mouth = 97 - (97 - b.mouth[1]) * s
      const dy = -Math.max(4, mouth + 5 - lid)
      return {
        s, dx: 0, dy, rot: 0,
        stand: [
          { kind: 'ellipse', cx: 50, cy: 96.8, rx: 35, ry: 2.8, fill: '#000', opacity: 0.2, under: true },
          { kind: 'path', d: `M27 ${lid + 3}Q27 ${lid} 30 ${lid}H70Q73 ${lid} 73 ${lid + 3}L75 92H25Z`, fill: PROP.lid, felt: true },
          { kind: 'rect', x: 18, y: 90.5, w: 64, h: 5.5, r: 2.75, fill: PROP.base, felt: true },
          { kind: 'path', d: `M45.5 ${lid + 14.5}Q45.5 ${lid + 9.5} 50 ${lid + 9.5}Q54.5 ${lid + 9.5} 54.5 ${lid + 14.5}Z`, fill: '#fff', opacity: 0.6 },
        ],
      }
    }
    case 'mug': {
      const s = 0.88
      const eye = 50 + (b.eyes[1][0] - 50) * s
      const mx = Math.min(72, Math.max(62, eye + 7))
      return {
        s, dx: -3, dy: -1, rot: -4,
        held: [
          { kind: 'rect', x: mx, y: 71, w: 19, h: 22, r: 4, fill: PROP.mug, felt: true },
          { kind: 'path', d: `M${mx + 18} 76q7.5 0 7.5 6t-7.5 6`, fill: 'none', stroke: PROP.mug, strokeWidth: 3.4 },
          { kind: 'rect', x: mx, y: 80, w: 19, h: 4, r: 0, fill: PROP.band, opacity: 0.85 },
          { kind: 'ellipse', cx: mx + 9.5, cy: 72.6, rx: 7.8, ry: 1.9, fill: PROP.coffee },
          paw(mx + 1, 85, 5, 4.6),
        ],
        float: [{ kind: 'path', d: `M${mx + 6} 67q-2.6-3.2 0-6.4t0-6.4M${mx + 13} 67q-2.6-3.2 0-6.4t0-6.4`, fill: 'none', stroke: PROP.steam, strokeWidth: 1.8 }],
      }
    }
    case 'sign': {
      const s = 0.84
      const px = 50 + ((SIDE[spec.body] ?? 88) - 50) * s
      const dx = Math.min(6, 80 - px)
      const x = px + dx + 2
      return {
        s, dx, dy: 0, rot: 0,
        held: [
          { kind: 'rect', x: x - 1.6, y: 34, w: 3.2, h: 58, r: 1.6, fill: PROP.wood, felt: true },
          { kind: 'rect', x: x - 15, y: 11, w: 30, h: 25, r: 4.5, fill: PROP.board, felt: true },
          { kind: 'text', x, y: 28.3, text: 'OK?', size: 11.5, fill: INK },
          paw(x - 0.5, 66, 4.8, 4.6),
        ],
      }
    }
    case 'question': {
      const bubble = 'M67 2H89Q98 2 98 11V20Q98 29 89 29H75L63 38L67 29Q58 29 58 20V11Q58 2 67 2Z'
      return {
        s: 0.82, dx: -8, dy: 0, rot: 0,
        float: [
          { kind: 'path', d: bubble, fill: PROP.bubble, felt: true },
          { kind: 'path', d: bubble, fill: 'none', stroke: 'rgba(0,0,0,0.08)', strokeWidth: 0.8 },
          { kind: 'text', x: 78, y: 22.5, text: '?', size: 19, fill: INK },
        ],
      }
    }
    case 'pop': {
      // it rises out of a hole in its patch: sunk until its eyes sit just above the rim (short bodies barely sink)
      const s = 0.9
      const rim = 87
      const eyes = 97 - (97 - Math.max(b.eyes[0][1], b.eyes[1][1])) * s
      const dy = Math.max(0, Math.min(14, rim - 9 - eyes))
      return {
        s, dx: 0, dy, rot: 0, clip: 100 - rim,
        back: [
          { kind: 'ellipse', cx: 50, cy: rim, rx: 46, ry: 9, fill: PROP.hole, felt: true },
          { kind: 'ellipse', cx: 50, cy: rim + 1, rx: 38, ry: 6, fill: '#000', opacity: 0.35 },
        ],
        float: [
          { kind: 'ellipse', cx: 12, cy: 78, rx: 2.8, ry: 2.8, fill: color, felt: true },
          { kind: 'ellipse', cx: 88, cy: 72, rx: 2.3, ry: 2.3, fill: color, felt: true },
          { kind: 'ellipse', cx: 82, cy: 60, rx: 1.7, ry: 1.7, fill: color, felt: true },
          { kind: 'ellipse', cx: 20, cy: 64, rx: 1.6, ry: 1.6, fill: color, felt: true },
        ],
      }
    }
    case 'sleep':
      // felt letters: chunky, softly outlined in their own colour
      return {
        s: 0.86, dx: -6, dy: 0, rot: 3,
        float: [
          { kind: 'text', x: 72, y: 34, text: 'z', size: 22, fill: PROP.zz, stroke: PROP.zz, strokeWidth: 1.2 },
          { kind: 'text', x: 86, y: 17, text: 'z', size: 15, fill: PROP.zz, stroke: PROP.zz, strokeWidth: 1.2 },
        ],
      }
  }
}

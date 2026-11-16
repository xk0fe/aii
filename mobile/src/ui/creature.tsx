// The plush creatures of desktop/ui/avatar.js, drawn with react-native-svg: the same bodies, colours, eyes, mouths,
// hats and cheeks, so a spec gives the same creature as on the Mac. From 40px up they're felt (felt.ts: a fuzzy edge
// and the fibre grain), and from 64px up they can act out their status with a felt prop (avatar.ts poseArt): at a
// laptop, holding a mug, the "OK?" sign, a question bubble, rising from a hole, asleep. At work a creature is at its
// laptop at every size (a smaller, simpler one under 64px).
//
// A creature never takes a touch itself (an SVG under the finger would swallow it): what holds it does.
//
// Motion is Reanimated's CSS animations: transforms only, run natively, no JavaScript per frame. A working creature
// types at its laptop (it used to hop when small, which was tiring to watch), one waiting on you wiggles, one that's
// off breathes slowly. Everything holds still when the screen isn't in front (MotionContext) or the system asks for
// reduced motion.
import { createContext, memo, useContext, useId } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { cubicBezier, css, useReducedMotion } from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, Image as SvgImage, Path, Pattern, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg'

import { dim } from '@/ui/color'
import { avatarOf, BODIES, colorOf, hash, INK, moodOf, POSE_MIN, poseArt, poseOf, type Body, type Mood, type Pose, type Shape, type Someone, type Spec } from './avatar'
import { ellipse, flatten, fuzzy, roundRect, type Pt } from './felt'
import { fonts, useTheme } from './theme'

const GRAIN = require('../../assets/images/felt-creature.png')
const FELT_MIN = 40 // smaller creatures skip the felt: it would only be noise

// Whether creatures may move: a screen that isn't in front, or an app in the background, holds them still.
export const MotionContext = createContext(true)

type Tone = (c: string) => string
const same: Tone = (c) => c

const line = (ink: string, width: number) => ({ fill: 'none', stroke: ink, strokeWidth: width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })

function Eye({ kind, x, y, t }: { kind: string; x: number; y: number; t: Tone }) {
  const ink = t(INK)
  const white = t('#ffffff')
  switch (kind) {
    case 'sparkle':
      return (
        <G>
          <Ellipse cx={x} cy={y} rx={4.8} ry={5.9} fill={ink} />
          <Circle cx={x - 1.6} cy={y - 2.1} r={2} fill={white} />
          <Circle cx={x + 1.7} cy={y + 2} r={1} fill={white} />
        </G>
      )
    case 'googly': {
      const look = x < 50 ? 1.6 : -1.6
      return (
        <G>
          <Circle cx={x} cy={y} r={8} fill={white} />
          <Circle cx={x + look} cy={y + 1.2} r={4.1} fill={ink} />
          <Circle cx={x + look - 1.3} cy={y - 0.4} r={1.3} fill={white} />
        </G>
      )
    }
    case 'happy':
      return <Path d={`M${x - 4.6} ${y + 1.6}Q${x} ${y - 4.6} ${x + 4.6} ${y + 1.6}`} {...line(ink, 2.7)} />
    case 'sleepy':
      return <Path d={`M${x - 4.6} ${y - 1}Q${x} ${y + 3.6} ${x + 4.6} ${y - 1}`} {...line(ink, 2.7)} />
    case 'line':
      return <Path d={`M${x - 4} ${y}H${x + 4}`} {...line(ink, 2.7)} />
    default: // dot
      return (
        <G>
          <Ellipse cx={x} cy={y} rx={3.8} ry={5} fill={ink} />
          <Circle cx={x - 1.2} cy={y - 1.9} r={1.35} fill={white} />
        </G>
      )
  }
}

function Mouth({ kind, x, y, t }: { kind: string; x: number; y: number; t: Tone }) {
  const ink = t(INK)
  switch (kind) {
    case 'smile':
      return <Path d={`M${x - 3.6} ${y}Q${x} ${y + 3.6} ${x + 3.6} ${y}`} {...line(ink, 2.2)} />
    case 'cat':
      return <Path d={`M${x - 5} ${y}Q${x - 2.5} ${y + 3.2} ${x} ${y}Q${x + 2.5} ${y + 3.2} ${x + 5} ${y}`} {...line(ink, 2.2)} />
    case 'grin':
      return (
        <G>
          <Path d={`M${x - 4.6} ${y - 0.6}Q${x} ${y + 7} ${x + 4.6} ${y - 0.6}Z`} fill={ink} />
          <Path d={`M${x - 2.3} ${y + 2.9}Q${x} ${y + 5.2} ${x + 2.3} ${y + 2.9}Z`} fill={t('#ff7a9c')} />
        </G>
      )
    case 'o':
      return <Ellipse cx={x} cy={y + 1} rx={2.3} ry={2.9} fill={ink} />
    default:
      return null
  }
}

// Felt accessories ride on the body layer; glasses and shades are crisp and sit on the face. The beret and the
// headphones are near-black felt that vanishes on a dark screen: there they're lifted to a charcoal.
function Hat({ kind, b, t, dark }: { kind: string; b: Body; t: Tone; dark: boolean }) {
  const [x, y] = b.top
  const black = (c: string) => t(dark ? '#4E4C56' : c)
  switch (kind) {
    case 'beret':
      return (
        <G transform={`translate(${x} ${y + 2}) rotate(-14)`}>
          <Path d="M-2 -10Q0 -17 5 -16" fill="none" stroke={black('#1d1c22')} strokeWidth={3.6} strokeLinecap="round" />
          <Ellipse cy={-2} rx={25} ry={10.5} fill={black('#1d1c22')} />
          <Ellipse cx={-6} cy={-6} rx={13} ry={3.5} fill="#fff" opacity={0.1} />
        </G>
      )
    case 'party':
      return (
        <G transform={`translate(${x} ${y + 3}) rotate(10)`}>
          <Path d="M-12 0L0 -28L12 0Z" fill={t('#ffd23f')} />
          <Path d="M-8.5 -8L6 -14M-5 -16L3.5 -20M-10.5 -3L9.5 -7" stroke={t('#ff5aa8')} strokeWidth={2.6} strokeLinecap="round" />
          <Circle cy={-29} r={4.4} fill={t('#ff5aa8')} />
        </G>
      )
    case 'crown':
      return (
        <G transform={`translate(${x} ${y + 2})`}>
          <Path d="M-14 0L-16 -17L-7 -9L0 -21L7 -9L16 -17L14 0Z" fill={t('#ffcf3a')} stroke={t('#f0a500')} strokeWidth={1.6} strokeLinejoin="round" />
          <Circle cy={-5} r={2.6} fill={t('#ff5a7a')} />
          <Circle cx={-8} cy={-4} r={1.8} fill={t('#4dabf7')} />
          <Circle cx={8} cy={-4} r={1.8} fill={t('#4dabf7')} />
        </G>
      )
    case 'bow':
      return (
        <G transform={`translate(${x + 13} ${y + 4}) rotate(18)`}>
          <Path d="M0 0C-6 -10 -19 -10 -17 0C-19 10 -6 10 0 0Z" fill={t('#ff4fa3')} />
          <Path d="M0 0C6 -10 19 -10 17 0C19 10 6 10 0 0Z" fill={t('#ff4fa3')} />
          <Circle r={4.3} fill={t('#ff86c0')} />
        </G>
      )
    case 'sprout':
      return (
        <G transform={`translate(${x} ${y + 2})`}>
          <Path d="M0 0V-13" stroke={t('#2f9e44')} strokeWidth={3} strokeLinecap="round" />
          <Path d="M0 -10C-2 -19 -13 -21 -16 -14C-11 -10 -5 -9 0 -10Z" fill={t('#51cf66')} />
          <Path d="M0 -12C2 -21 13 -23 16 -16C11 -12 5 -11 0 -12Z" fill={t('#69db7c')} />
        </G>
      )
    case 'flower':
      return (
        <G transform={`translate(${x + 15} ${y + 6})`}>
          {[0, 72, 144, 216, 288].map((r) => (
            <Ellipse key={r} cy={-6.5} rx={4.2} ry={6.5} fill={t('#ffffff')} transform={`rotate(${r})`} />
          ))}
          <Circle r={4.2} fill={t('#ffc61f')} />
        </G>
      )
    case 'headphones': {
      const w = b.wide ? 40 : 33
      return (
        <G transform={`translate(${x} ${y + 18})`}>
          <Path d={`M${-w} 6A${w} ${w + 4} 0 0 1 ${w} 6`} fill="none" stroke={black('#25242b')} strokeWidth={5.5} strokeLinecap="round" />
          <Rect x={-w - 6} y={0} width={12} height={18} rx={6} fill={black('#25242b')} />
          <Rect x={w - 6} y={0} width={12} height={18} rx={6} fill={black('#25242b')} />
          <Rect x={-w - 3} y={3} width={6} height={12} rx={3} fill={t('#ff5aa8')} />
          <Rect x={w - 3} y={3} width={6} height={12} rx={3} fill={t('#ff5aa8')} />
        </G>
      )
    }
    default:
      return null
  }
}

function FaceWear({ kind, b, t }: { kind: string; b: Body; t: Tone }) {
  const [[x1, y1], [x2, y2]] = b.eyes
  const ink = t(INK)
  if (kind === 'glasses') {
    const r = b.wide ? 10 : 8.6
    return (
      <G>
        <Circle cx={x1} cy={y1} r={r} fill="#fff" fillOpacity={0.18} stroke={ink} strokeWidth={2.3} />
        <Circle cx={x2} cy={y2} r={r} fill="#fff" fillOpacity={0.18} stroke={ink} strokeWidth={2.3} />
        <Path d={`M${x1 + r} ${y1 - 1}Q50 ${y1 - 4} ${x2 - r} ${y2 - 1}`} {...line(ink, 2.2)} />
      </G>
    )
  }
  if (kind === 'shades') {
    const r = b.wide ? 10.5 : 9.2
    const lens = (x: number, y: number) => (
      <G key={x}>
        <Circle cx={x} cy={y} r={r} fill={ink} />
        <Path d={`M${x - r * 0.55} ${y - r * 0.3}Q${x - r * 0.3} ${y - r * 0.62} ${x + r * 0.05} ${y - r * 0.62}`} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.8} strokeLinecap="round" />
      </G>
    )
    return (
      <G>
        {lens(x1, y1)}
        {lens(x2, y2)}
        <Path d={`M${x1 + r} ${y1 - 1}Q50 ${y1 - 4} ${x2 - r} ${y2 - 1}`} fill="none" stroke={ink} strokeWidth={2.6} strokeLinecap="round" />
      </G>
    )
  }
  return null
}

// ---- felt ----

// A body's parts (ears, eye bumps, then the body) as outlines, plain or fuzzy.
function bodyParts(b: Body, felt: boolean): string[] {
  const parts: { key: string; polys: () => Pt[][]; plain: string }[] = (b.extra ?? []).map((x) =>
    x.kind === 'circle'
      ? { key: `c${x.cx},${x.cy},${x.r}`, polys: () => [ellipse(x.cx, x.cy, x.r, x.r)], plain: `M${x.cx - x.r} ${x.cy}a${x.r} ${x.r} 0 1 0 ${2 * x.r} 0a${x.r} ${x.r} 0 1 0 ${-2 * x.r} 0Z` }
      : { key: `e${x.cx},${x.cy},${x.rx},${x.ry},${x.rotate}`, polys: () => [ellipse(x.cx, x.cy, x.rx, x.ry, x.rotate)], plain: '' },
  )
  parts.push({ key: b.d, polys: () => flatten(b.d), plain: b.d })
  return parts.map((p, i) => (felt || !p.plain ? fuzzy(p.key, p.polys, 911 + i * 37, felt ? FUZZ : { amp: 0, step: 1 }) : p.plain))
}
const FUZZ = { amp: 1.7, step: 0.65 }

function shapeOutline(s: Shape): string {
  switch (s.kind) {
    case 'path':
      return fuzzy(s.d, () => flatten(s.d), hash(s.d) % 9973, FUZZ)
    case 'rect':
      return fuzzy(`r${s.x},${s.y},${s.w},${s.h},${s.r}`, () => [roundRect(s.x, s.y, s.w, s.h, s.r)], 313, FUZZ)
    case 'ellipse':
      return fuzzy(`e${s.cx},${s.cy},${s.rx},${s.ry}`, () => [ellipse(s.cx, s.cy, s.rx, s.ry)], 701, s.rx < 3 ? { amp: 0.5, step: 0.5 } : FUZZ)
    default:
      return ''
  }
}

// The roundness of felt: a soft light from the top left and a shade at the bottom (avatar.js av-hi / av-lo).
function Shading({ id }: { id: string }) {
  return (
    <>
      <RadialGradient id={`hi${id}`} cx="0.32" cy="0.2" r="0.72" fx="0.32" fy="0.2">
        <Stop offset="0" stopColor="#fff" stopOpacity={0.62} />
        <Stop offset="0.45" stopColor="#fff" stopOpacity={0.14} />
        <Stop offset="1" stopColor="#fff" stopOpacity={0} />
      </RadialGradient>
      <RadialGradient id={`lo${id}`} cx="0.55" cy="1.08" r="0.8" fx="0.55" fy="1.08">
        <Stop offset="0.15" stopColor="#000" stopOpacity={0.34} />
        <Stop offset="1" stopColor="#000" stopOpacity={0} />
      </RadialGradient>
    </>
  )
}

// The fibres, laid over the creature's whole box once.
function GrainPattern({ id }: { id: string }) {
  return (
    <Pattern id={`grain${id}`} patternUnits="userSpaceOnUse" x={0} y={0} width={100} height={100}>
      <SvgImage href={GRAIN} x={0} y={0} width={100} height={100} preserveAspectRatio="none" />
    </Pattern>
  )
}

// Outlines filled as felt: the colour, the roundness, and the grain (a pattern fill: a clipped image loses its clip
// on iOS once anything above it is rotated).
function Felt({ id, outlines, fill, grain }: { id: string; outlines: string[]; fill: string | string[]; grain: boolean }) {
  return (
    <>
      {outlines.map((d, i) => (
        <G key={i}>
          <Path d={d} fill={Array.isArray(fill) ? fill[i] : fill} />
          <Path d={d} fill={`url(#hi${id})`} />
          <Path d={d} fill={`url(#lo${id})`} />
        </G>
      ))}
      {grain ? outlines.map((d, i) => <Path key={`g${i}`} d={d} fill={`url(#grain${id})`} />) : null}
    </>
  )
}

function Plain({ s }: { s: Shape }) {
  const paint = { fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, opacity: s.opacity, strokeLinecap: s.stroke ? ('round' as const) : undefined }
  switch (s.kind) {
    case 'path':
      return <Path d={s.d} {...paint} />
    case 'rect':
      return <Rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} {...paint} />
    case 'ellipse':
      return <Ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...paint} />
    case 'text':
      return (
        <SvgText x={s.x} y={s.y} textAnchor={s.text === 'z' ? 'start' : 'middle'} fontFamily={fonts.brandBold} fontSize={s.size} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinejoin="round">
          {s.text}
        </SvgText>
      )
  }
}

// One layer of a pose (behind, held, in front, a paw, floating): its own <Svg> over the creature's box.
const Layer = memo(function Layer({ shapes, size, felt }: { shapes: Shape[]; size: number; felt: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const soft = shapes.filter((s) => s.felt)
  const outlines = soft.map((s) => (felt ? shapeOutline(s) : ''))
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={styles.layer} pointerEvents="none">
      <Defs>
        <Shading id={id} />
        {felt && soft.length ? <GrainPattern id={id} /> : null}
      </Defs>
      {shapes.filter((s) => s.under).map((s, i) => (
        <Plain key={`u${i}`} s={s} />
      ))}
      {felt ? <Felt id={id} outlines={outlines} fill={soft.map((s) => s.fill ?? '#888')} grain /> : soft.map((s, i) => <Plain key={`f${i}`} s={s} />)}
      {shapes.filter((s) => !s.felt && !s.under).map((s, i) => (
        <Plain key={`p${i}`} s={s} />
      ))}
    </Svg>
  )
})

// The still picture: one <Svg>, layered as the Mac layers its parts (body and hat, cheeks, eyes, mouth and facewear).
// `place`: how a pose sets the figure (scaled, shifted and tilted about its feet), drawn inside the SVG: a transform on
// the view around it would leave the grain unclipped on iOS.
export type Place = { s: number; dx: number; dy: number; rot: number }
export const CreatureArt = memo(function CreatureArt({ agent, size, asleep = false, place }: { agent: Someone; size: number; asleep?: boolean; place?: Place }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const { dark } = useTheme()
  const s = avatarOf(agent)
  const b = BODIES[s.body] ?? BODIES.blob
  const t: Tone = asleep ? (c) => dim(c) : same
  const color = t(colorOf(s))
  const look = asleep ? 'sleepy' : ['dot', 'sparkle', 'googly', 'happy', 'sleepy', 'line'].includes(s.eyes) ? s.eyes : 'dot'
  const [[x1, y1], [x2, y2]] = b.eyes
  const felt = size >= FELT_MIN
  const parts = bodyParts(b, felt)
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
      <Defs>
        <Shading id={id} />
        {felt ? <GrainPattern id={id} /> : null}
      </Defs>
      <G transform={place ? `translate(${50 + place.dx} ${97 + place.dy}) rotate(${place.rot}) scale(${place.s}) translate(-50 -97)` : undefined}>
      <Ellipse cx={50} cy={97.5} rx={33} ry={3.2} fill="#000" opacity={0.22} />
      <Felt id={id} outlines={parts} fill={color} grain={felt} />
      <Hat kind={s.hat} b={b} t={t} dark={dark} />
      {s.cheeks ? (
        <G>
          <Ellipse cx={x1 - 6} cy={y1 + 7} rx={5} ry={3} fill={t('#ff5c9d')} opacity={0.42} />
          <Ellipse cx={x2 + 6} cy={y2 + 7} rx={5} ry={3} fill={t('#ff5c9d')} opacity={0.42} />
        </G>
      ) : null}
      {s.hat === 'shades' ? null : (
        <G>
          <Eye kind={look} x={x1} y={y1} t={t} />
          <Eye kind={look} x={x2} y={y2} t={t} />
        </G>
      )}
      <Mouth kind={s.mouth} x={b.mouth[0]} y={b.mouth[1]} t={t} />
      <FaceWear kind={s.hat} b={b} t={t} />
      </G>
    </Svg>
  )
})

// ---- motion: the Mac's keyframes (common.css, creature-v2.css), in px of each size ----

const ease = cubicBezier(0.42, 0, 0.58, 1)
const motions = new Map<string, ReturnType<typeof css.keyframes>>()
function motion(name: string, size: number, frames: (u: number) => Parameters<typeof css.keyframes>[0]) {
  const key = `${name}:${size}`
  let k = motions.get(key)
  if (!k) motions.set(key, (k = css.keyframes(frames(size / 100))))
  return k
}
const hop = (size: number) => {
  const curve = cubicBezier(0.3, 0.6, 0.4, 1)
  return motion('hop', size, (u) => ({
    '0%': { transform: [{ translateY: 0 }, { scaleX: 1.07 }, { scaleY: 0.93 }], animationTimingFunction: curve },
    '18%': { transform: [{ translateY: 0 }, { scaleX: 0.94 }, { scaleY: 1.07 }], animationTimingFunction: curve },
    '50%': { transform: [{ translateY: -16 * u }, { scaleX: 0.98 }, { scaleY: 1.02 }], animationTimingFunction: curve },
    '82%': { transform: [{ translateY: 0 }, { scaleX: 1.05 }, { scaleY: 0.95 }], animationTimingFunction: curve },
    '100%': { transform: [{ translateY: 0 }, { scaleX: 1.07 }, { scaleY: 0.93 }] },
  }))
}
const WIGGLE = css.keyframes({ '0%': { transform: [{ rotate: '-6deg' }] }, '50%': { transform: [{ rotate: '6deg' }] }, '100%': { transform: [{ rotate: '-6deg' }] } })
const WIGGLE_SOFT = css.keyframes({ '0%': { transform: [{ rotate: '-2.5deg' }] }, '50%': { transform: [{ rotate: '2.5deg' }] }, '100%': { transform: [{ rotate: '-2.5deg' }] } })
const BREATHE = css.keyframes({ '0%': { transform: [{ scaleX: 1 }, { scaleY: 1 }] }, '50%': { transform: [{ scaleX: 0.982 }, { scaleY: 1.03 }] }, '100%': { transform: [{ scaleX: 1 }, { scaleY: 1 }] } })
const type_ = (size: number) => motion('type', size, (u) => ({ '0%': { transform: [{ translateY: 0 }] }, '50%': { transform: [{ translateY: 1.2 * u }] }, '100%': { transform: [{ translateY: 0 }] } }))
// a small creature's paws lift a little higher: 2.5% of it is a fraction of a pixel
const tapping = (size: number, small: boolean) => motion(small ? 'tap-small' : 'tap', size, (u) => ({ from: { transform: [{ translateY: 0 }] }, to: { transform: [{ translateY: (small ? -4.5 : -2.5) * u }] } }))
const drift = (size: number) => motion('drift', size, (u) => ({ '0%': { transform: [{ translateY: 0 }] }, '50%': { transform: [{ translateY: -3 * u }] }, '100%': { transform: [{ translateY: 0 }] } }))
const rise = (size: number) => motion('rise', size, (u) => ({ from: { transform: [{ translateY: 30 * u }] }, to: { transform: [{ translateY: 0 }] } }))

type Anim = Record<string, unknown>
const loop = (name: unknown, ms: number, delay: number, extra: Anim = {}): Anim => ({ animationName: name, animationDuration: `${ms}ms`, animationIterationCount: 'infinite', animationTimingFunction: ease, animationDelay: `${-delay}ms`, ...extra })

// What the creature's body does in a mood, posed or not.
function bodyMotion(mood: Mood, posed: boolean, size: number, phase: number): Anim | null {
  if (posed) {
    if (mood === 'working') return loop(type_(size), 1200, phase % 1200)
    if (mood === 'waiting') return loop(WIGGLE_SOFT, 1600, 0)
    if (mood === 'starting') return { animationName: rise(size), animationDuration: '900ms', animationTimingFunction: cubicBezier(0.3, 1.4, 0.5, 1), animationFillMode: 'both' }
    if (mood === 'sleep') return loop(BREATHE, 5500, phase % 5500)
    return loop(BREATHE, 3600, phase % 3600)
  }
  if (mood === 'hop') return { ...loop(hop(size), 720, phase % 720), animationTimingFunction: 'linear' }
  if (mood === 'waiting') return loop(WIGGLE, 550, 0)
  if (mood === 'sleep') return loop(BREATHE, 5500, phase % 5500)
  return null
}

export type CreatureProps = {
  agent: Someone & { status?: string; on?: boolean; waitingOn?: unknown[] }
  size?: number
  mood?: Mood // defaults to the agent's own (its status)
  posed?: boolean // act out the status with a prop (64px and up; at work it's at its laptop whatever this says)
  ask?: string // what it's waiting on you for: 'question' holds up a speech bubble, anything else the "OK?" sign
}

export const Creature = memo(function Creature({ agent, size = 48, mood, posed = false, ask }: CreatureProps) {
  const m = mood ?? moodOf(agent)
  const allowed = useContext(MotionContext)
  const reduced = useReducedMotion()
  const moving = allowed && !reduced && m !== 'still'
  const phase = hash(agent.name) % 4000
  const small = size < POSE_MIN
  const pose: Pose | null = m === 'working' ? 'laptop' : posed && !small ? poseOf(m === 'sleep' ? { status: 'off' } : agent, ask) : null
  const art = pose ? poseArt(pose, avatarOf(agent) as Spec, small) : null
  const felt = size >= FELT_MIN
  const play = (a: Anim | null): Anim | undefined => (a && moving ? a : undefined)
  const body = play(bodyMotion(m, Boolean(art), size, phase))
  const figure = <CreatureArt agent={agent} size={size} asleep={m === 'sleep'} place={art ? { s: art.s, dx: art.dx, dy: art.dy, rot: art.rot } : undefined} />
  if (!art) {
    return (
      <View style={{ width: size, height: size }} pointerEvents="none">
        <Animated.View style={[{ width: size, height: size, transformOrigin: '50% 96%' }, body]}>{figure}</Animated.View>
      </View>
    )
  }
  const fig = (
    <View style={StyleSheet.absoluteFill}>{figure}</View>
  )
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {art.back ? <Layer shapes={art.back} size={size} felt={felt} /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: '50% 96%' }, body]}>
        {art.clip ? (
          // rising out of its hole: what's below the rim is cut away
          <View style={{ position: 'absolute', left: -0.4 * size, right: -0.4 * size, top: -0.4 * size, bottom: (art.clip / 100) * size, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', left: 0.4 * size, top: 0.4 * size, width: size, height: size }}>{fig}</View>
          </View>
        ) : (
          fig
        )}
        {art.held ? <Layer shapes={art.held} size={size} felt={felt} /> : null}
      </Animated.View>
      {art.stand ? <Layer shapes={art.stand} size={size} felt={felt} /> : null}
      {art.paws?.map((p, i) => (
        <Animated.View key={i} style={[StyleSheet.absoluteFill, play({ ...loop(tapping(size, small), 340, (phase + i * 170) % 680), animationDirection: 'alternate' })]} pointerEvents="none">
          <Layer shapes={p} size={size} felt={felt} />
        </Animated.View>
      ))}
      {art.float ? (
        <Animated.View style={[StyleSheet.absoluteFill, play(loop(drift(size), 3200, phase % 3200))]} pointerEvents="none">
          <Layer shapes={art.float} size={size} felt={felt} />
        </Animated.View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0, overflow: 'visible' },
})

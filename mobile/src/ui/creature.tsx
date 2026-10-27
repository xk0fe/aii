// The plush creatures of desktop/ui/avatar.js, drawn with react-native-svg: the same bodies, colors, eyes, mouths,
// hats and cheeks, so a spec gives the same creature as on the Mac. The felt texture (an SVG filter there) is left
// out; the highlight and shade gradients that give the felt its roundness stay.
//
// Moods move them, transform-only (Reanimated, on the UI thread): a working creature hops, one waiting on you
// wiggles and wears an orange "!", one that's off sleeps, dimmed. A short `key` per mood restarts the animation.
import { memo, useId } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { useMountEffect } from '@/ui/hooks'
import { dim } from '@/ui/color'
import { avatarOf, BODIES, colorOf, hash, INK, moodOf, type Body, type Mood, type Someone } from './avatar'
import { fonts } from './theme'

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

// Felt accessories ride on the body layer; glasses and shades are crisp and sit on the face.
function Hat({ kind, b, t }: { kind: string; b: Body; t: Tone }) {
  const [x, y] = b.top
  switch (kind) {
    case 'beret':
      return (
        <G transform={`translate(${x} ${y + 2}) rotate(-14)`}>
          <Path d="M-2 -10Q0 -17 5 -16" fill="none" stroke={t('#1d1c22')} strokeWidth={3.6} strokeLinecap="round" />
          <Ellipse cy={-2} rx={25} ry={10.5} fill={t('#1d1c22')} />
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
          <Path d={`M${-w} 6A${w} ${w + 4} 0 0 1 ${w} 6`} fill="none" stroke={t('#25242b')} strokeWidth={5.5} strokeLinecap="round" />
          <Rect x={-w - 6} y={0} width={12} height={18} rx={6} fill={t('#25242b')} />
          <Rect x={w - 6} y={0} width={12} height={18} rx={6} fill={t('#25242b')} />
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

function Shape({ b, fill }: { b: Body; fill: string }) {
  return (
    <G fill={fill}>
      {b.extra?.map((x, i) =>
        x.kind === 'circle' ? (
          <Circle key={i} cx={x.cx} cy={x.cy} r={x.r} />
        ) : (
          <Ellipse key={i} cx={x.cx} cy={x.cy} rx={x.rx} ry={x.ry} transform={`translate(${x.cx} ${x.cy}) rotate(${x.rotate}) translate(${-x.cx} ${-x.cy})`} />
        ),
      )}
      <Path d={b.d} />
    </G>
  )
}

// The still picture: one <Svg>, layered as the Mac layers its parts (body and hat, cheeks, eyes, mouth and facewear).
export const CreatureArt = memo(function CreatureArt({ agent, size, asleep = false }: { agent: Someone; size: number; asleep?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const s = avatarOf(agent)
  const b = BODIES[s.body] ?? BODIES.blob
  const t: Tone = asleep ? (c) => dim(c) : same
  const color = t(colorOf(s))
  const look = asleep ? 'sleepy' : ['dot', 'sparkle', 'googly', 'happy', 'sleepy', 'line'].includes(s.eyes) ? s.eyes : 'dot'
  const [[x1, y1], [x2, y2]] = b.eyes
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
      <Defs>
        <RadialGradient id={`hi${id}`} cx="0.32" cy="0.2" r="0.72" fx="0.32" fy="0.2">
          <Stop offset="0" stopColor="#fff" stopOpacity={0.62} />
          <Stop offset="0.45" stopColor="#fff" stopOpacity={0.14} />
          <Stop offset="1" stopColor="#fff" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`lo${id}`} cx="0.55" cy="1.08" r="0.8" fx="0.55" fy="1.08">
          <Stop offset="0.15" stopColor="#000" stopOpacity={0.34} />
          <Stop offset="1" stopColor="#000" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={50} cy={97.5} rx={33} ry={3.2} fill="#000" opacity={0.22} />
      <Shape b={b} fill={color} />
      <Shape b={b} fill={`url(#hi${id})`} />
      <Shape b={b} fill={`url(#lo${id})`} />
      <Hat kind={s.hat} b={b} t={t} />
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
    </Svg>
  )
})

// ---- motion ----------------------------------------------------------------------------------------------

// cubic-bezier(.3, .6, .4, 1), the Mac's hop curve, per keyframe segment
function bezier(t: number) {
  'worklet'
  const x1 = 0.3
  const y1 = 0.6
  const x2 = 0.4
  const y2 = 1
  let u = t
  for (let i = 0; i < 6; i++) {
    const x = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u - t
    const dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2)
    if (Math.abs(dx) < 1e-6) break
    u = Math.min(1, Math.max(0, u - x / dx))
  }
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u
}

// av-hop: [at, translateY (share of the size), scaleX, scaleY]
const HOP: [number, number, number, number][] = [
  [0, 0, 1.07, 0.93],
  [0.18, 0, 0.94, 1.07],
  [0.5, -0.16, 0.98, 1.02],
  [0.82, 0, 1.05, 0.95],
  [1, 0, 1.07, 0.93],
]

function Moving({ mood, size, phase, children }: { mood: Mood; size: number; phase: number; children: React.ReactNode }) {
  const p = useSharedValue(0)
  const reduce = useReducedMotion()
  useMountEffect(() => {
    if (reduce || mood === 'still' || mood === 'idle' || mood === 'starting') return
    const duration = mood === 'working' ? 720 : mood === 'waiting' ? 550 : 5500
    const loop = withRepeat(withTiming(1, { duration, easing: Easing.linear, reduceMotion: ReduceMotion.System }), -1, false)
    p.value = withDelay(phase % duration, loop)
  })
  const style = useAnimatedStyle(() => {
    const v = p.value
    if (mood === 'working') {
      let i = 0
      while (i < HOP.length - 2 && v > HOP[i + 1][0]) i++
      const [a, ty0, sx0, sy0] = HOP[i]
      const [z, ty1, sx1, sy1] = HOP[i + 1]
      const k = bezier(Math.min(1, Math.max(0, (v - a) / (z - a))))
      return { transform: [{ translateY: (ty0 + (ty1 - ty0) * k) * size }, { scaleX: sx0 + (sx1 - sx0) * k }, { scaleY: sy0 + (sy1 - sy0) * k }] }
    }
    if (mood === 'waiting') {
      // av-wiggle: -6deg to 6deg and back, eased in and out
      const deg = -6 * Math.cos(v * 2 * Math.PI)
      return { transform: [{ rotate: `${deg}deg` }] }
    }
    if (mood === 'sleep') {
      // a slow breath
      const k = (1 - Math.cos(v * 2 * Math.PI)) / 2
      return { transform: [{ scaleX: 1 - 0.018 * k }, { scaleY: 1 + 0.03 * k }] }
    }
    return { transform: [] }
  })
  return <Animated.View style={[{ width: size, height: size, transformOrigin: ['50%', '96%', 0] }, style]}>{children}</Animated.View>
}

function Bang({ size }: { size: number }) {
  const d = Math.max(13, Math.min(30, size * 0.36))
  const p = useSharedValue(1)
  const reduce = useReducedMotion()
  useMountEffect(() => {
    if (reduce) return
    p.value = withRepeat(withSequence(withTiming(1.15, { duration: 500 }), withTiming(1, { duration: 500 })), -1, false)
  })
  const style = useAnimatedStyle(() => ({ transform: [{ scale: p.value }] }))
  return (
    <Animated.View pointerEvents="none" style={[styles.bang, { width: d, height: d, borderRadius: d / 2, right: -size * 0.04, top: -size * 0.06 }, style]}>
      <Text style={[styles.bangText, { fontSize: Math.max(9, Math.min(19, size * 0.24)) }]}>!</Text>
    </Animated.View>
  )
}

export type CreatureProps = {
  agent: Someone & { status?: string; on?: boolean; waitingOn?: unknown[] }
  size?: number
  mood?: Mood // defaults to the agent's own (its status)
  badge?: boolean // the "!" when it waits on you (on by default)
}

export const Creature = memo(function Creature({ agent, size = 48, mood, badge = true }: CreatureProps) {
  const m = mood ?? moodOf(agent)
  const phase = hash(agent.name) % 4000
  return (
    <View style={{ width: size, height: size }}>
      <Moving key={m} mood={m} size={size} phase={phase}>
        <CreatureArt agent={agent} size={size} asleep={m === 'sleep'} />
      </Moving>
      {m === 'waiting' && badge ? <Bang size={size} /> : null}
    </View>
  )
})

const styles = StyleSheet.create({
  bang: {
    position: 'absolute',
    backgroundColor: '#ff9f0a',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#a05000',
    shadowOpacity: 0.45,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  bangText: { color: '#241500', fontWeight: '800', fontFamily: fonts.rounded, includeFontPadding: false },
})

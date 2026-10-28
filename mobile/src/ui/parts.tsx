// Small pieces every screen uses: buttons, status dots, the context ring, workspace tiles, faces, badges.
import * as Haptics from 'expo-haptics'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Circle } from 'react-native-svg'

import type { Agent, Context, Face } from '@/net/types'

import { COLORS } from './avatar'
import { mix } from './color'
import { Creature } from './creature'
import { Icon, type IconName } from './icon'
import { fonts, type Theme } from './theme'

export const tap = () => void Haptics.selectionAsync().catch(() => {})
export const thud = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})

// A pressable that gives way a little under the finger.
export function Press({ style, children, ...props }: PressableProps & { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Pressable {...props} style={({ pressed }) => [style, pressed && !props.disabled && { opacity: 0.72, transform: [{ scale: 0.97 }] }, props.disabled && { opacity: 0.45 }]}>
      {children}
    </Pressable>
  )
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'warm'

export function Button({ t, title, kind = 'secondary', icon, onPress, disabled, busy, style, flex, small, accessibilityLabel }: { t: Theme; title: string; kind?: ButtonKind; icon?: IconName; onPress?: () => void; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; flex?: boolean; small?: boolean; accessibilityLabel?: string }) {
  const bg = kind === 'primary' ? t.accent : kind === 'warm' ? t.waiting : t.btn
  const fg = kind === 'primary' ? '#fff' : kind === 'warm' ? '#241500' : kind === 'danger' ? t.danger : t.fg
  return (
    <Press accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} disabled={disabled || busy} onPress={onPress} style={[styles.button, small && styles.buttonSmall, { backgroundColor: bg }, flex && { flex: 1 }, style]}>
      {/* the label stays in place while busy, so the button never changes size */}
      <View style={[styles.buttonInner, busy && { opacity: 0 }]}>
        {icon ? <Icon name={icon} size={small ? 13 : 15} color={fg} /> : null}
        <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {busy ? <ActivityIndicator style={StyleSheet.absoluteFill} color={fg} size="small" /> : null}
    </Press>
  )
}

export function statusColor(t: Theme, kind: string) {
  switch (kind) {
    case 'working':
      return t.working
    case 'waiting':
      return t.waiting
    case 'blocked':
      return t.blocked
    case 'starting':
      return t.starting
    case 'stopped':
      return t.danger
    default:
      return null // hollow
  }
}

export function inkFor(t: Theme, kind: string) {
  switch (kind) {
    case 'working':
      return t.workingInk
    case 'waiting':
      return t.waitingInk
    case 'blocked':
      return t.blockedInk
    case 'starting':
      return t.starting
    default:
      return t.fg2
  }
}

export function Dot({ t, kind, size = 8, ink }: { t: Theme; kind: string; size?: number; ink?: string }) {
  const fill = statusColor(t, kind)
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill ?? 'transparent', borderWidth: fill ? 0 : 1.5, borderColor: ink ?? (kind === 'off' || kind === 'parked' ? t.fg3 : t.idle) }} />
}

const ctxLevel = (pct: number) => (pct >= 80 ? 'hot' : pct >= 50 ? 'warm' : 'calm')

// How full its conversation is: a ring that fills, amber past half, red past 80%; dashed once compacted.
export function ContextRing({ t, ctx, compacted, size = 15, ink, label = true }: { t: Theme; ctx?: Context; compacted?: boolean; size?: number; ink?: string; label?: boolean }) {
  if (!ctx) return null
  const level = ctxLevel(ctx.pct)
  const k = level === 'hot' ? t.ctxHot : level === 'warm' ? t.ctxWarm : (ink ?? t.fg3)
  const r = 7.6
  const c = 2 * Math.PI * r
  return (
    <View style={styles.ctx} accessibilityLabel={`conversation ${ctx.pct}% full`}>
      <Svg width={size} height={size} viewBox="0 0 20 20" style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={10} cy={10} r={r} fill="none" strokeWidth={2.6} stroke={compacted ? k : (ink ? mix(ink, '#ffffff', 0.25) : t.track)} strokeOpacity={compacted ? 0.45 : ink ? 0.3 : 1} strokeDasharray={compacted ? '2.2 2.2' : undefined} />
        <Circle cx={10} cy={10} r={r} fill="none" strokeWidth={2.6} stroke={k} strokeLinecap="round" strokeDasharray={`${(Math.max(ctx.pct, 3) / 100) * c} ${c}`} />
      </Svg>
      {label ? <Text style={[styles.ctxText, { color: level === 'calm' ? (ink ?? t.fg3) : k }]}>{ctx.pct}%</Text> : null}
    </View>
  )
}

// A workspace's tile: its icon (an emoji) or its initial, on its color; the default one wears the crew.
export function WsTile({ t, ws, size = 28 }: { t: Theme; ws?: { name: string; color?: string | null; icon?: string | null; parked?: boolean; id?: string }; size?: number }) {
  const color = ws?.color ? (COLORS[ws.color] ?? ws.color) : null
  const initial = ([...String(ws?.name ?? '').trim()][0] ?? '?').toUpperCase()
  const home = !color && (ws?.id === 'default' || !ws)
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: color ?? t.btn, opacity: ws?.parked ? 0.55 : 1 }, !color && { borderWidth: StyleSheet.hairlineWidth, borderColor: t.lineStrong }]}>
      {color ? <View style={[StyleSheet.absoluteFill, { borderRadius: size * 0.3, backgroundColor: 'rgba(255,255,255,0.18)', bottom: size * 0.5 }]} /> : null}
      {home ? (
        <CrewMark size={size * 0.78} />
      ) : ws?.icon ? (
        <Text style={{ fontSize: size * 0.56, lineHeight: size * 0.72 }}>{ws.icon}</Text>
      ) : (
        <Text style={{ fontSize: size * 0.5, fontWeight: '800', color: color ? '#fff' : t.fg, fontFamily: fonts.rounded }}>{initial}</Text>
      )}
    </View>
  )
}

// The crew's mark: three little buddies, as the Mac's menu bar has them.
export function CrewMark({ size = 22 }: { size?: number }) {
  const s = size * 0.62
  return (
    <View style={{ width: size, height: size, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' }}>
      <View style={{ marginRight: -s * 0.42 }}>
        <Creature agent={{ name: 'left', avatar: { body: 'blob', color: 'sky', eyes: 'dot', mouth: 'none', hat: 'none', cheeks: true } }} size={s} mood="still" />
      </View>
      <View style={{ zIndex: 1 }}>
        <Creature agent={{ name: 'middle', avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true } }} size={s * 1.05} mood="still" />
      </View>
      <View style={{ marginLeft: -s * 0.42 }}>
        <Creature agent={{ name: 'right', avatar: { body: 'mochi', color: 'lime', eyes: 'happy', mouth: 'none', hat: 'none', cheeks: true } }} size={s} mood="still" />
      </View>
    </View>
  )
}

// A few faces in a row, overlapping.
export function Faces({ faces, size = 20, max = 4 }: { faces: (Face | Agent)[]; size?: number; max?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {faces.slice(0, max).map((f, i) => (
        <View key={f.name} style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <Creature agent={{ ...f, status: (f as Face).status === 'parked' ? 'off' : f.status }} size={size} mood="still" />
        </View>
      ))}
    </View>
  )
}

export function CountBadge({ t, n, warm }: { t: Theme; n: number; warm?: boolean }) {
  if (!n) return null
  return (
    <View style={[styles.badge, { backgroundColor: warm ? t.waiting : t.accent, borderColor: t.panel }]}>
      <Text style={[styles.badgeText, { color: warm ? '#241500' : '#fff' }]}>{n > 9 ? '9+' : n}</Text>
    </View>
  )
}

// "2 working", "1 needs you": a dot and a few words, tinted.
export function Pill({ t, kind, text }: { t: Theme; kind: string; text: string }) {
  const ink = inkFor(t, kind)
  return (
    <View style={[styles.pill, { backgroundColor: kind === 'offline' ? 'transparent' : mix(statusColor(t, kind) ?? '#888888', t.dark ? '#1c1c1f' : '#ffffff', 0.14) }]}>
      <Dot t={t} kind={kind} size={7} />
      <Text style={[styles.pillText, { color: ink }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { minHeight: 38, paddingHorizontal: 12, borderRadius: 11 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  buttonText: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  buttonTextSmall: { fontSize: 15 },
  ctx: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ctxText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  badgeText: { fontSize: 10.5, fontWeight: '800', fontFamily: fonts.rounded, fontVariant: ['tabular-nums'] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, height: 24, borderRadius: 12 },
  pillText: { fontSize: 13, fontWeight: '600' },
})

// An agent as a Pokédex-style card, as in the Mac's Crew view: its color as a pastel card, the name and job up top,
// the brain, what it's doing at the bottom, and the creature itself in the corner (its clones peeking out beside it).
import { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import type { Agent } from '@/net/types'

import { agentColor } from './avatar'
import { dim, mix } from './color'
import { Creature } from './creature'
import { brain, displayName, rowLine, statusText } from './format'
import { Icon } from './icon'
import { ContextRing, Dot, Press } from './parts'
import { fonts } from './theme'
import { themes } from './theme'

export const cardInk = (c: string) => mix(c, '#141418', 0.3)

// The card's face: a soft gradient of the creature's color, a glow where the creature sits, and the crew's speech
// bubbles watermarked in the corner.
export function CardBack({ color, id, radius = 24 }: { color: string; id: string; radius?: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={`bg${id}`} x1="0" y1="0" x2="0.85" y2="1">
            <Stop offset="0" stopColor={mix(color, '#ffffff', 0.3)} />
            <Stop offset="1" stopColor={mix(color, '#ffffff', 0.52)} />
          </LinearGradient>
          <RadialGradient id={`glow${id}`} cx="0.84" cy="0.92" rx="0.6" ry="0.75" fx="0.84" fy="0.92">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.7} />
            <Stop offset="0.7" stopColor="#ffffff" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#bg${id})`} />
        <Rect width="100%" height="100%" fill={`url(#glow${id})`} />
      </Svg>
      <View style={styles.mark}>
        <Svg width={150} height={150} viewBox="0 0 100 100">
          <Path d="M30 20h36a14 14 0 0 1 14 14v14a14 14 0 0 1-14 14H50l-12 10v-10h-8a14 14 0 0 1-14-14V34a14 14 0 0 1 14-14z" fill="#fff" opacity={0.42} />
          <Path d="M52 58h26a11 11 0 0 1 11 11v9a11 11 0 0 1-11 11h-3v8l-9-8H52a11 11 0 0 1-11-11v-9a11 11 0 0 1 11-11z" fill="#fff" opacity={0.3} />
        </Svg>
      </View>
    </View>
  )
}

export const AgentCard = memo(function AgentCard({ a, clones, providers, unread, onPress, now }: { a: Agent; clones: Agent[]; providers?: Record<string, { label: string }>; unread: number; onPress: () => void; now: number }) {
  const off = !a.on
  const parked = a.status === 'parked'
  const base = agentColor(a)
  const color = off || parked ? dim(base, off ? 0.25 : 0.45, 1) : base
  const ink = cardInk(color)
  const line = rowLine(a, now)
  const { base: name, home } = displayName(a.name)
  const working = clones.filter((c) => c.status === 'working' || c.status === 'starting')
  const statusKind = off ? 'off' : line.kind
  const waiting = a.status === 'waiting'
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={`${name}, ${a.area ?? ''}, ${statusText(a, now)}`} style={[styles.card, { shadowColor: mix(color, '#000000', 0.9), opacity: off ? 0.8 : 1 }]}>
      <CardBack color={color} id={a.name.replace(/[^a-z0-9]/gi, '')} />
      {/* needs you: a warm ring drawn over the edge, so nothing inside moves */}
      {waiting ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.needs]} /> : null}
      <View style={styles.top}>
        <View style={styles.titles}>
          <Text style={[styles.name, { color: ink }]} numberOfLines={1}>
            {name}
            {home ? <Text style={styles.home}> @{home}</Text> : null}
          </Text>
          {a.area ? (
            <Text style={[styles.area, { color: ink }]} numberOfLines={2}>
              {a.area}
            </Text>
          ) : null}
        </View>
        <View style={styles.stickers}>
          {a.fast ? (
            <View style={[styles.sticker, styles.fast]}>
              <Icon name="bolt" size={11} color="#3a2400" />
            </View>
          ) : null}
          {a.yolo ? (
            <View style={[styles.sticker, styles.yolo]}>
              <Text style={styles.yoloText}>YOLO</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.chips}>
        <View style={styles.chip}>
          <Text style={[styles.chipText, { color: ink }]} numberOfLines={1}>
            {brain(a, providers) || 'Agent'}
          </Text>
        </View>
        {unread ? (
          <View style={[styles.chip, { backgroundColor: themes.light.accent }]}>
            <Text style={[styles.chipText, { color: '#fff' }]}>{unread} new</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.bottom}>
        <View style={styles.state}>
          <View style={styles.stateRow}>
            <Dot t={themes.light} kind={statusKind} ink={ink} />
            <Text style={[styles.stateText, { color: ink }]} numberOfLines={1}>
              {statusText(a, now)}
            </Text>
            {a.on ? <ContextRing t={themes.light} ctx={a.convo?.context} compacted={Boolean(a.convo?.compactions)} ink={ink} /> : null}
          </View>
          {/* the second line is always there, so cards never change height */}
          <Text style={[styles.doing, { color: ink }]} numberOfLines={1}>
            {line.kind === 'working' && a.activity ? a.activity : waiting && a.activity ? a.activity : a.freshPending ? 'new conversation when free' : a.queue ? `${a.queue} queued` : ' '}
          </Text>
        </View>
      </View>
      <View style={styles.creature} pointerEvents="none">
        {working.slice(0, 3).map((c, i) => (
          <View key={c.name} style={[styles.clone, { right: 78 + i * 26 }]}>
            <Creature agent={c} size={44} />
            <View style={styles.cloneNo}>
              <Text style={styles.cloneNoText}>{c.clone}</Text>
            </View>
          </View>
        ))}
        <Creature agent={a} size={96} />
      </View>
    </Press>
  )
})

const styles = StyleSheet.create({
  card: { height: 168, borderRadius: 24, padding: 16, paddingBottom: 14, overflow: 'visible', shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  needs: { borderRadius: 24, borderWidth: 3, borderColor: 'rgba(255,159,10,0.8)' },
  mark: { position: 'absolute', right: -34, top: -40, transform: [{ rotate: '-14deg' }] },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  titles: { flex: 1, paddingRight: 64 },
  name: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  home: { fontSize: 15, fontWeight: '600', opacity: 0.6 },
  area: { fontSize: 14, fontWeight: '500', lineHeight: 18, opacity: 0.85, marginTop: 1 },
  stickers: { position: 'absolute', right: -2, top: 0, flexDirection: 'row', gap: 5 },
  sticker: { height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.88)' },
  yolo: { backgroundColor: '#ff3b5c', paddingHorizontal: 8, transform: [{ rotate: '5deg' }] },
  yoloText: { color: '#fff', fontSize: 10.5, fontWeight: '900', letterSpacing: 0.6 },
  fast: { backgroundColor: '#ffb020', width: 26, transform: [{ rotate: '-6deg' }] },
  chips: { flexDirection: 'row', gap: 6, marginTop: 9, paddingRight: 110 },
  chip: { height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.62)', justifyContent: 'center', flexShrink: 1 },
  chipText: { fontSize: 12.5, fontWeight: '700' },
  bottom: { position: 'absolute', left: 16, right: 116, bottom: 14 },
  state: { gap: 2 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stateText: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  doing: { fontFamily: fonts.mono, fontSize: 12, opacity: 0.78 },
  creature: { position: 'absolute', right: 10, bottom: 4 },
  clone: { position: 'absolute', bottom: 0 },
  cloneNo: { position: 'absolute', left: -2, top: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.88)', alignItems: 'center', justifyContent: 'center' },
  cloneNoText: { fontSize: 10, fontWeight: '800', color: '#141418', fontFamily: fonts.rounded },
})

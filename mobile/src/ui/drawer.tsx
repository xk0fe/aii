// What the chat slides away from, as in Discord: the workspaces as a rail on the left (tap one to switch), and the
// one you're in beside it: its channels (what's new and who's waiting on you in each, and + for a new one), then a
// conversation with each agent (what it's doing, what's new from it). At the foot, the computer and how it's reached.
import type { ReactNode } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Link } from '@/net/client'
import type { Agent, Channel, Workspace } from '@/net/types'
import type { Derived } from '@/state/hooks'

import { CountBadge, CrewMark, Dot, inkFor, Press, tap, Who, WsTile } from './parts'
import { Creature } from './creature'
import { displayName, rowLine } from './format'
import { Icon } from './icon'
import { offlineText } from './topbar'
import { fonts, themes, type Theme } from './theme'

export const RAIL = 72

type Props = {
  t: Theme
  d: Derived
  workspaces: Workspace[]
  ws: string // the workspace on screen
  going: string | null // the one being opened
  title: string // its name
  summary: ReactNode
  here: string | null // the agent whose conversation is open
  chan: string | null // the channel that's open (null: the Mac has no channels)
  now: number
  link: Link
  mac: string
  demo: boolean
  onWorkspace: (id: string) => void
  onChannel: (id: string) => void
  onAgent: (name: string | null) => void
  onNewChannel: () => void
  onComputer: () => void
}

function RailTile({ t, w, on, going, onPress }: { t: Theme; w: Workspace; on: boolean; going: boolean; onPress: () => void }) {
  const needs = w.waiting ?? 0
  const fresh = !on && (w.unread ?? 0) > 0
  return (
    <Press onPress={onPress} style={styles.railItem} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${w.name}${needs ? `, ${needs} waiting for you` : ''}${fresh ? `, ${w.unread} new` : ''}`}>
      {/* Discord's pill on the left edge: tall for the one you're in, a dot for one with something new */}
      <View style={[styles.pill, { backgroundColor: t.fg, height: on ? 36 : fresh ? 8 : 0 }]} />
      <View style={{ opacity: going ? 0.5 : 1 }}>
        <WsTile t={t} ws={w} size={48} />
      </View>
      {going ? <ActivityIndicator style={StyleSheet.absoluteFill} color={t.fg} /> : null}
      {needs ? (
        <View style={[styles.railBadge, { backgroundColor: themes.light.waitingInk, borderColor: t.bg }]}>
          <Text style={styles.railBadgeText} maxFontSizeMultiplier={1}>
            {needs > 9 ? '9+' : needs}
          </Text>
        </View>
      ) : null}
    </Press>
  )
}

function ChannelRow({ t, c, on, unread, needs, onPress }: { t: Theme; c: Channel; on: boolean; unread: number; needs: number; onPress: () => void }) {
  const loud = on || unread > 0 || needs > 0
  return (
    <Press onPress={onPress} style={[styles.row, on && { backgroundColor: t.fill }]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`#${c.name}${needs ? `, ${needs} waiting for you` : ''}${unread ? `, ${unread} new` : ''}`}>
      {unread && !on ? <View style={[styles.newDot, { backgroundColor: t.fg }]} /> : null}
      <Text style={[styles.hash, { color: loud ? t.fg2 : t.fg3 }]}>#</Text>
      <Text style={[styles.rowName, { color: loud ? t.fg : t.fg2, fontWeight: loud ? '600' : '500' }]} numberOfLines={1}>
        {c.name}
      </Text>
      {needs ? <CountBadge t={t} n={needs} warm /> : unread ? <CountBadge t={t} n={unread} /> : null}
    </Press>
  )
}

function AgentRow({ t, a, on, unread, now, onPress }: { t: Theme; a: Agent; on: boolean; unread: number; now: number; onPress: () => void }) {
  const line = rowLine(a, now)
  return (
    <Press onPress={onPress} style={[styles.row, styles.dm, on && { backgroundColor: t.fill }, !a.on && { opacity: 0.6 }]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${displayName(a.name).base}, ${line.text}${unread ? `, ${unread} new` : ''}`}>
      {unread && !on ? <View style={[styles.newDot, { backgroundColor: t.fg }]} /> : null}
      <Who t={t} kind={line.kind} size={32} ring={on ? t.fill : t.page}>
        <Creature agent={a} size={32} mood="still" />
      </Who>
      <View style={styles.dmText}>
        <Text style={[styles.dmName, { color: t.fg, fontWeight: on || unread ? '600' : '500' }]} numberOfLines={1}>
          {displayName(a.name).base}
        </Text>
        <Text style={[styles.dmLine, { color: inkFor(t, line.kind), fontFamily: line.mono ? fonts.mono : undefined }]} numberOfLines={1}>
          {line.text}
        </Text>
      </View>
      <CountBadge t={t} n={on ? 0 : unread} />
    </Press>
  )
}

function Section({ t, title, onAdd, addLabel }: { t: Theme; title: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionText, { color: t.fg2 }]}>{title}</Text>
      {onAdd ? (
        <Press onPress={onAdd} hitSlop={10} accessibilityRole="button" accessibilityLabel={addLabel} style={styles.add}>
          <Icon name="plus" size={15} color={t.fg2} weight="semibold" />
        </Press>
      ) : null}
    </View>
  )
}

export function Drawer({ t, d, workspaces, ws, going, title, summary, here, chan, now, link, mac, demo, onWorkspace, onChannel, onAgent, onNewChannel, onComputer }: Props) {
  const insets = useSafeAreaInsets()
  const offline = link.status === 'offline' ? offlineText(link, mac) : ''
  const total = [...d.unread.values()].reduce((n, x) => n + x, 0)
  const on = d.agents.filter((a) => a.on)
  const off = d.agents.filter((a) => !a.on)
  return (
    <View style={[styles.wrap, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <ScrollView style={styles.rail} contentContainerStyle={styles.railInner} showsVerticalScrollIndicator={false}>
        {workspaces.map((w) => (
          <RailTile key={w.id} t={t} w={w} on={w.id === ws} going={going === w.id} onPress={() => (tap(), onWorkspace(w.id))} />
        ))}
      </ScrollView>
      <View style={[styles.panel, { backgroundColor: t.page }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: t.fg }]} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          <Text style={[styles.sub, { color: t.fg2 }]} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {d.channels ? (
            <>
              <Section t={t} title="Channels" onAdd={onNewChannel} addLabel="New channel" />
              {d.channels.map((c) => (
                <ChannelRow key={c.id} t={t} c={c} on={!here && chan === c.id} unread={d.unreadIn.get(c.id) ?? 0} needs={d.needsIn.get(c.id) ?? 0} onPress={() => (tap(), onChannel(c.id))} />
              ))}
            </>
          ) : (
            <Press onPress={() => (tap(), onAgent(null))} style={[styles.row, styles.dm, !here && { backgroundColor: t.fill }]} accessibilityRole="button" accessibilityState={{ selected: !here }} accessibilityLabel={`Everyone's messages${total ? `, ${total} new` : ''}`}>
              <View style={[styles.everyone, { backgroundColor: t.fill }]}>
                <CrewMark size={26} />
              </View>
              <Text style={[styles.rowName, styles.dmText, { color: t.fg, fontWeight: '600' }]}>Everyone</Text>
            </Press>
          )}
          <Section t={t} title="Direct messages" />
          {on.map((a) => (
            <AgentRow key={a.name} t={t} a={a} on={here === a.name} unread={d.unread.get(a.name) ?? 0} now={now} onPress={() => (tap(), onAgent(a.name))} />
          ))}
          {off.length ? <Section t={t} title="Off" /> : null}
          {off.map((a) => (
            <AgentRow key={a.name} t={t} a={a} on={here === a.name} unread={d.unread.get(a.name) ?? 0} now={now} onPress={() => (tap(), onAgent(a.name))} />
          ))}
        </ScrollView>
        <Press onPress={onComputer} style={[styles.foot, { borderTopColor: t.line, paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityRole="button" accessibilityLabel={`${demo ? 'Demo crew' : mac}, ${offline || link.status}. Computers`}>
          <Dot t={t} kind={demo ? 'idle' : link.status === 'online' ? 'working' : link.status === 'offline' ? 'waiting' : 'starting'} size={8} />
          <View style={styles.footText}>
            <Text style={[styles.footName, { color: t.fg }]} numberOfLines={1}>
              {demo ? 'Demo crew' : mac}
            </Text>
            <Text style={[styles.footLine, { color: offline ? t.waitingInk : t.fg2 }]} numberOfLines={1}>
              {demo ? 'Made up, and only on this phone' : offline || (link.status === 'online' ? 'Connected' : 'Connecting…')}
            </Text>
          </View>
          <Icon name="right" size={13} color={t.fg3} weight="bold" />
        </Press>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  rail: { width: RAIL, flexGrow: 0 },
  railInner: { alignItems: 'center', paddingTop: 10, paddingBottom: 24, gap: 10 },
  railItem: { width: RAIL, height: 52, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', left: 0, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  railBadge: { position: 'absolute', right: 6, bottom: -2, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  railBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  panel: { flex: 1, borderTopLeftRadius: 18, overflow: 'hidden' },
  head: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10, gap: 2 },
  title: { fontSize: 21, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3 },
  sub: { fontSize: 13, lineHeight: 17 },
  list: { paddingHorizontal: 8, paddingBottom: 16 },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingTop: 16, paddingBottom: 6 },
  sectionText: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  add: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 10, borderRadius: 10 },
  dm: { minHeight: 50, gap: 10 },
  newDot: { position: 'absolute', left: -6, width: 6, height: 6, borderRadius: 3 },
  hash: { fontSize: 19, fontWeight: '500', width: 16, textAlign: 'center' },
  rowName: { flex: 1, fontSize: 16 },
  dmText: { flex: 1, gap: 1 },
  dmName: { fontSize: 16 },
  dmLine: { fontSize: 12.5 },
  everyone: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  footText: { flex: 1, gap: 1 },
  footName: { fontSize: 15, fontWeight: '600' },
  footLine: { fontSize: 12.5 },
})

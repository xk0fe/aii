// The crew: the Crew room at the top (everyone together, each acting out its status, and one headline that says how
// things are), the list below it, one row per agent, grouped by the computer it runs on. The room folds away, and the
// phone remembers. The rows keep the Mac's order: a status change never moves a row.
import { router, useIsFocused } from 'expo-router'
import { memo, useMemo } from 'react'
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Agent, State } from '@/net/types'
import { useCrew, useDerived } from '@/state/hooks'
import { setPref, usePrefs } from '@/state/prefs'
import { Creature, MotionContext } from '@/ui/creature'
import { ago, brainLine, displayName, plural, statusWord, type AskKind } from '@/ui/format'
import { useAppActive, useNow } from '@/ui/hooks'
import { Icon } from '@/ui/icon'
import { Press, Tag, Who } from '@/ui/parts'
import { headline, needsOf, ROOM, roomLayout } from '@/ui/room'
import { RoomFelt } from '@/ui/surface'
import { TopBar } from '@/ui/topbar'
import { fonts, type Theme, useTheme } from '@/ui/theme'

const open = (a: Agent) => router.push({ pathname: '/agent/[name]', params: { name: a.name } })

// What VoiceOver and TalkBack say for an agent: its name, how it is, who it is.
const spoken = (a: Agent, kind: AskKind | undefined, now: number, extra = '') =>
  [displayName(a.name).base, statusWord(a, kind).text, a.yolo ? 'YOLO' : '', extra, (a.status === 'working' || a.status === 'waiting') && a.since ? `for ${ago(a.since, now)}` : ''].filter(Boolean).join(', ')

function Room({ agents, asks, width, now }: { agents: Agent[]; asks: Map<string, AskKind>; width: number; now: number }) {
  const { spots } = roomLayout(agents, width)
  const byName = new Map(agents.map((a) => [a.name, a]))
  return (
    <View style={{ width, height: ROOM.height }}>
      <RoomFelt width={width} height={ROOM.height} floor={ROOM.floor} />
      {spots.map((s) => {
        const a = byName.get(s.name)!
        return (
          <Press key={s.name} onPress={() => open(a)} style={[styles.spot, { left: s.x, top: s.y, width: s.size, height: s.size }]} accessibilityRole="button" accessibilityLabel={spoken(a, asks.get(a.name), now)} accessibilityHint="Opens what you can do with it">
            <Creature agent={a} size={s.size} posed ask={asks.get(a.name)} />
          </Press>
        )
      })}
    </View>
  )
}

const Row = memo(function Row({ t, a, kind, helpers, clones, providers, now, first }: { t: Theme; a: Agent; kind?: AskKind; helpers: number; clones: number; providers?: State['providers']; now: number; first: boolean }) {
  const st = statusWord(a, kind)
  const since = (a.status === 'working' || a.status === 'waiting') && a.on ? ago(a.since, now) : ''
  const who = [brainLine(a, providers), helpers ? plural(helpers, 'helper') : '', clones ? plural(clones, 'clone') : ''].filter(Boolean).join(' · ')
  return (
    <Press onPress={() => open(a)} style={styles.row} accessibilityRole="button" accessibilityLabel={spoken(a, kind, now, who)} accessibilityHint="Opens what you can do with it">
      {first ? null : <View style={[styles.sep, { backgroundColor: t.line }]} />}
      <Who t={t} kind={a.on ? (a.status === 'waiting' ? 'waiting' : a.status === 'working' && !a.waitingOn?.length ? 'working' : '') : ''} size={48}>
        <Creature agent={a} size={48} mood="still" />
      </Who>
      <View style={styles.text}>
        <View style={styles.l1}>
          <Text style={[styles.name, { color: a.on ? t.fg : t.fg2 }]} numberOfLines={1}>
            {displayName(a.name).base}
          </Text>
          {a.yolo ? <Tag t={t} text="YOLO" label="YOLO: skips every permission prompt" /> : null}
          <View style={styles.end}>
            {since ? <Text style={[styles.since, { color: t.fg2 }]}>{since}</Text> : null}
            <Icon name="right" size={13} color={t.fg3} />
          </View>
        </View>
        <Text style={[styles.l2, { color: st.kind === 'waiting' ? t.waitingInk : t.fg2 }, st.kind === 'waiting' && styles.needs]} numberOfLines={2}>
          {st.text}
        </Text>
        {who ? (
          <Text style={[styles.l3, { color: t.fg2 }]} numberOfLines={2}>
            {who}
          </Text>
        ) : null}
      </View>
    </Press>
  )
})

export default function CrewScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { client, state } = useCrew()
  const d = useDerived(state)
  const now = useNow(30000)
  const { roomFolded } = usePrefs()
  const focused = useIsFocused()
  const active = useAppActive()
  const moving = focused && active
  const asks = useMemo(() => new Map(needsOf(d.agents, d.open).map((n) => [n.agent.name, n.kind])), [d.agents, d.open])
  const head = headline(d.agents, d.open, Boolean(state?.parked))

  // one section per computer, this one first (PROTOCOL.md: agents with no `home` are on the computer the phone talks to)
  const sections = useMemo(() => {
    const computers = state?.computers ?? []
    const here = computers[0]?.slug ?? ''
    const out = new Map<string, Agent[]>()
    for (const c of computers) out.set(c.slug, [])
    for (const a of d.agents) {
      const k = a.home ?? here
      out.set(k, [...(out.get(k) ?? []), a])
    }
    return [...out].filter(([, list]) => list.length).map(([slug, list]) => {
      const c = computers.find((x) => x.slug === slug)
      return { slug, name: c?.name ?? list[0].homeName ?? (slug || client?.macName || 'This computer'), offline: c ? !c.online : false, list }
    })
  }, [state?.computers, d.agents, client?.macName])

  const roomWidth = Math.min(width - 32, 560)
  return (
    <MotionContext.Provider value={moving}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <TopBar t={t} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          {roomFolded || !state ? null : <Room agents={d.agents} asks={asks} width={roomWidth} now={now} />}
          <View style={styles.headRow}>
            <Text style={[styles.display, { color: t.fg }]} accessibilityRole="header" maxFontSizeMultiplier={1.6}>
              {state ? head.title : ' '}
            </Text>
            {state ? (
              <Press onPress={() => setPref('roomFolded', !roomFolded)} style={[styles.fold, { backgroundColor: t.fill }]} hitSlop={8} accessibilityRole="button" accessibilityLabel={roomFolded ? 'Show the room' : 'Fold the room away'}>
                <Icon name={roomFolded ? 'down' : 'up'} size={13} color={t.fg2} weight="bold" />
              </Press>
            ) : null}
          </View>
          <Text style={[styles.line, { color: t.fg2 }]}>{state ? head.line : ' '}</Text>
          {sections.map((s) => (
            <View key={s.slug || 'here'}>
              <Text style={[styles.section, { color: t.fg }]} accessibilityRole="header">
                {s.name}
                {s.offline ? <Text style={{ color: t.fg2, fontWeight: '400' }}>{'  Offline'}</Text> : null}
              </Text>
              <View style={[styles.group, { backgroundColor: t.surface }]}>
                {s.list.map((a, i) => (
                  <Row key={a.name} t={t} a={a} kind={asks.get(a.name)} helpers={(a.subs ?? []).filter((x) => !x.ended).length} clones={(d.clones.get(a.name) ?? []).filter((c) => c.on && c.status !== 'off').length} providers={state?.providers} now={now} first={i === 0} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </MotionContext.Provider>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 4 },
  spot: { position: 'absolute' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  display: { flex: 1, fontFamily: fonts.brand, fontSize: 28, lineHeight: 34 },
  fold: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  line: { fontSize: 15, lineHeight: 20, marginTop: 2 },
  section: { fontSize: 15, lineHeight: 20, fontWeight: '600', paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 },
  group: { borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  sep: { position: 'absolute', top: 0, left: 76, right: 0, height: StyleSheet.hairlineWidth },
  text: { flex: 1, minWidth: 0 },
  l1: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
  end: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8 },
  since: { fontSize: 15, lineHeight: 20 },
  l2: { fontSize: 15, lineHeight: 20 },
  needs: { fontWeight: '500' },
  l3: { fontSize: 13, lineHeight: 18 },
})

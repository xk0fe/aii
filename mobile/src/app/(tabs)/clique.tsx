// The clique: one row per agent, grouped by the computer it runs on, under one line that says how things are. The rows
// keep the Mac's order: a status change never moves a row.
import { router, useIsFocused } from 'expo-router'
import { memo, useMemo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Agent, State } from '@/net/types'
import { useClique, useDerived } from '@/state/hooks'
import { Creature, MotionContext } from '@/ui/creature'
import { ago, brainLine, displayName, plural, statusWord, type AskKind } from '@/ui/format'
import { useAppActive, useNow } from '@/ui/hooks'
import { Icon } from '@/ui/icon'
import { Press, Tag, Who } from '@/ui/parts'
import { headline, needsOf } from '@/ui/room'
import { TabHead } from '@/ui/topbar'
import { type Theme, useTheme } from '@/ui/theme'

const open = (a: Agent) => router.push({ pathname: '/agent/[name]', params: { name: a.name } })

// What VoiceOver and TalkBack say for an agent: its name, how it is, who it is.
const spoken = (a: Agent, kind: AskKind | undefined, now: number, extra = '') =>
  [displayName(a.name).base, statusWord(a, kind).text, a.yolo ? 'YOLO' : '', extra, (a.status === 'working' || a.status === 'waiting') && a.since ? `for ${ago(a.since, now)}` : ''].filter(Boolean).join(', ')

const Row = memo(function Row({ t, a, kind, helpers, clones, providers, now, first }: { t: Theme; a: Agent; kind?: AskKind; helpers: number; clones: number; providers?: State['providers']; now: number; first: boolean }) {
  const st = statusWord(a, kind)
  const since = (a.status === 'working' || a.status === 'waiting') && a.on ? ago(a.since, now) : ''
  const who = [brainLine(a, providers), helpers ? plural(helpers, 'helper') : '', clones ? plural(clones, 'clone') : ''].filter(Boolean).join(' · ')
  return (
    <Press onPress={() => open(a)} style={styles.row} accessibilityRole="button" accessibilityLabel={spoken(a, kind, now, who)} accessibilityHint="Opens what you can do with it">
      {first ? null : <View style={[styles.sep, { backgroundColor: t.line }]} />}
      <Who t={t} kind={a.on ? (a.status === 'waiting' ? 'waiting' : a.status === 'working' && !a.waitingOn?.length ? 'working' : '') : ''} size={44}>
        <Creature agent={a} size={44} mood="still" />
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

export default function CliqueScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { client, state } = useClique()
  const d = useDerived(state)
  const now = useNow(30000)
  const focused = useIsFocused()
  const active = useAppActive()
  const moving = focused && active
  const everyone = state?.agents
  const asks = useMemo(() => new Map(needsOf(d.agents, d.open, everyone).map((n) => [n.agent.name, n.kind])), [d.agents, d.open, everyone])
  const head = headline(d.agents, d.open, Boolean(state?.parked), everyone)
  // an agent whose clone needs you needs you: its row, its place and its pose say so too
  const shown = useMemo(() => d.agents.map((a) => (asks.has(a.name) && a.status !== 'waiting' ? { ...a, status: 'waiting' } : a)), [d.agents, asks])

  // one section per computer, this one first (PROTOCOL.md: agents with no `home` are on the computer the phone talks to)
  const sections = useMemo(() => {
    const computers = state?.computers ?? []
    const here = computers[0]?.slug ?? ''
    const out = new Map<string, Agent[]>()
    for (const c of computers) out.set(c.slug, [])
    for (const a of shown) {
      const k = a.home ?? here
      out.set(k, [...(out.get(k) ?? []), a])
    }
    return [...out].filter(([, list]) => list.length).map(([slug, list]) => {
      const c = computers.find((x) => x.slug === slug)
      return { slug, name: c?.name ?? list[0].homeName ?? (slug || client?.macName || 'This computer'), offline: c ? !c.online : false, list }
    })
  }, [state?.computers, shown, client?.macName])

  return (
    <MotionContext.Provider value={moving}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <TabHead t={t} title="CLIque" sub={state ? head.title : ''} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
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
  content: { paddingHorizontal: 16 },
  section: { fontSize: 13, lineHeight: 18, fontWeight: '600', paddingHorizontal: 4, paddingTop: 12, paddingBottom: 6 },
  group: { borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  sep: { position: 'absolute', top: 0, left: 70, right: 0, height: StyleSheet.hairlineWidth },
  text: { flex: 1, minWidth: 0 },
  l1: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, lineHeight: 21, fontWeight: '600', flexShrink: 1 },
  end: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8 },
  since: { fontSize: 13, lineHeight: 18 },
  l2: { fontSize: 14, lineHeight: 19 },
  needs: { fontWeight: '500' },
  l3: { fontSize: 13, lineHeight: 18 },
})

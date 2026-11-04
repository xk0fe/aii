// Where the chat can be: the workspace's channels (#general and the ones you made, each with what's new and who's
// waiting on you there, and New channel), then a conversation with one agent, each with what it's doing. Opened from
// the chat's title; picking one goes back to the chat on it. A Mac that sends no channels has one chat, Everyone.
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import type { Agent, Channel } from '@/net/types'
import { openChannel, openConvo, useConvo, usePickedChannel } from '@/state/convo'
import { GENERAL, useCrew, useDerived } from '@/state/hooks'
import { agentColor } from '@/ui/avatar'
import { nameInk } from '@/ui/color'
import { Creature } from '@/ui/creature'
import { displayName, rowLine } from '@/ui/format'
import { useNow } from '@/ui/hooks'
import { Icon } from '@/ui/icon'
import { CountBadge, CrewMark, inkFor, Press, tap, Who } from '@/ui/parts'
import { fonts, useTheme, type Theme } from '@/ui/theme'

function Row({ t, on, face, name, nameColor, line, lineInk, mono, count, warm, onPress, label }: { t: Theme; on: boolean; face: ReactNode; name: string; nameColor: string; line: string; lineInk: string; mono?: boolean; count: number; warm?: boolean; onPress: () => void; label: string }) {
  return (
    <Press onPress={onPress} style={[styles.row, on && { backgroundColor: t.fill }]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label}>
      {face}
      <View style={styles.text}>
        <Text style={[styles.name, { color: nameColor }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.line, { color: lineInk, fontFamily: mono ? fonts.mono : undefined, fontSize: mono ? 13 : 14 }]} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <View style={styles.end}>{on ? <Icon name="check" size={16} color={t.accent} weight="bold" /> : <CountBadge t={t} n={count} warm={warm} />}</View>
    </Press>
  )
}

// A channel's mark: a # on a rounded tile, or a + for a new one.
function Mark({ t, text }: { t: Theme; text: string }) {
  return (
    <View style={[styles.mark, { backgroundColor: t.fill }]}>
      <Text style={[styles.markText, { color: t.fg2 }]}>{text}</Text>
    </View>
  )
}

const briefLine = (c: Channel) => (c.brief ? c.brief.split('\n')[0] : c.id === GENERAL ? 'Everyone, and everything without a channel' : 'No brief yet')

export default function Convos() {
  const t = useTheme()
  const { state, ws } = useCrew()
  const d = useDerived(state)
  const here = useConvo()
  const chan = usePickedChannel(ws, d.channels?.map((c) => c.id) ?? null)
  const now = useNow(30000)
  const total = [...d.unread.values()].reduce((n, x) => n + x, 0)
  const pick = (name: string | null) => {
    tap()
    openConvo(name)
    router.back()
  }
  const agentRow = (a: Agent) => {
    const line = rowLine(a, now)
    const n = d.unread.get(a.name) ?? 0
    return (
      <Row
        key={a.name}
        t={t}
        on={here === a.name}
        face={
          <Who t={t} kind={line.kind} size={40} ring={here === a.name ? t.surface : t.card}>
            <Creature agent={a} size={40} />
          </Who>
        }
        name={displayName(a.name).base}
        nameColor={nameInk(agentColor(a), t.fg)}
        line={line.text}
        lineInk={inkFor(t, line.kind)}
        mono={line.mono}
        count={n}
        onPress={() => pick(a.name)}
        label={`${displayName(a.name).base}, ${line.text}${n ? `, ${n} new` : ''}`}
      />
    )
  }
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: t.fg }]}>Conversations</Text>
      {d.channels ? (
        <>
          <Text style={[styles.section, { color: t.fg2 }]}>Channels</Text>
          <View style={[styles.list, { backgroundColor: t.card }]}>
            {d.channels.map((c) => {
              const needs = d.needsIn.get(c.id) ?? 0
              const fresh = d.unreadIn.get(c.id) ?? 0
              const on = !here && chan === c.id
              return (
                <Row
                  key={c.id}
                  t={t}
                  on={on}
                  face={<Mark t={t} text="#" />}
                  name={c.name}
                  nameColor={t.fg}
                  line={briefLine(c)}
                  lineInk={t.fg2}
                  count={needs || fresh}
                  warm={needs > 0}
                  onPress={() => {
                    tap()
                    openChannel(ws, c.id)
                    router.back()
                  }}
                  label={`#${c.name}${needs ? `, ${needs} waiting for you` : ''}${fresh ? `, ${fresh} new` : ''}`}
                />
              )
            })}
            <Row t={t} on={false} face={<Mark t={t} text="+" />} name="New channel" nameColor={t.fg} line="Its own brief, its own people" lineInk={t.fg2} count={0} onPress={() => router.replace('/channel')} label="New channel" />
          </View>
          <Text style={[styles.section, { color: t.fg2 }]}>Direct</Text>
        </>
      ) : null}
      <View style={[styles.list, { backgroundColor: t.card }]}>
        {d.channels ? null : (
        <Row
          t={t}
          on={!here}
          face={
            <View style={[styles.all, { backgroundColor: t.fill }]}>
              <CrewMark size={30} />
            </View>
          }
          name="Everyone"
          nameColor={t.fg}
          line="All messages, the whole crew"
          lineInk={t.fg2}
          count={here ? total : 0}
          onPress={() => pick(null)}
          label={`Everyone's messages${total ? `, ${total} new` : ''}`}
        />
        )}
        {d.agents.filter((a) => a.on).map(agentRow)}
      </View>
      {d.agents.some((a) => !a.on) ? (
        <>
          <Text style={[styles.section, { color: t.fg2 }]}>Off</Text>
          <View style={[styles.list, { backgroundColor: t.card }]}>{d.agents.filter((a) => !a.on).map(agentRow)}</View>
        </>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 26, paddingBottom: 40, gap: 10 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginBottom: 4 },
  section: { fontSize: 13, fontWeight: '600', marginTop: 8, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  list: { borderRadius: 18, padding: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 13 },
  all: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  markText: { fontSize: 21, fontWeight: '600' },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '600' },
  line: { fontSize: 14 },
  end: { minWidth: 22, alignItems: 'flex-end' },
})

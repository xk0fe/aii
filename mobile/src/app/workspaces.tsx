// Which workspace this phone watches: its own choice, whatever the Mac has on screen. Each one says who's at work
// there and who needs you.
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import type { Workspace } from '@/net/types'
import { useCrew } from '@/state/hooks'
import { session } from '@/state/session'
import { Icon } from '@/ui/icon'
import { Faces, Press, tap, WsTile } from '@/ui/parts'
import { offlineText } from '@/ui/topbar'
import { useTheme, type Theme } from '@/ui/theme'

function line(w: Workspace) {
  if (w.parked) return [{ text: 'Asleep', tone: 'quiet' }]
  const out: { text: string; tone: 'warm' | 'work' | 'new' | 'quiet' }[] = []
  if (w.waiting) out.push({ text: `${w.waiting} need${w.waiting === 1 ? 's' : ''} you`, tone: 'warm' })
  if (w.working) out.push({ text: `${w.working} working`, tone: 'work' })
  if (w.unread) out.push({ text: `${w.unread} new`, tone: 'new' })
  if (!out.length) out.push({ text: w.agents ? (w.on ? 'All free' : 'All off') : 'No agents yet', tone: 'quiet' })
  return out
}

function Row({ t, w, current, busy, onPress, disabled }: { t: Theme; w: Workspace; current: boolean; busy: boolean; onPress: () => void; disabled: boolean }) {
  const tone = { warm: t.waitingInk, work: t.workingInk, new: t.accent, quiet: t.fg2 }
  return (
    <Press onPress={onPress} disabled={disabled && !current} style={[styles.row, current && { backgroundColor: t.btn }]} accessibilityRole="button" accessibilityState={{ selected: current }} accessibilityLabel={`${w.name}. ${line(w).map((x) => x.text).join(', ')}`}>
      <WsTile t={t} ws={w} size={40} />
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
            {w.name}
          </Text>
          <Faces faces={(w.needs?.length ? w.needs : w.faces) ?? []} size={22} max={3} />
        </View>
        <Text style={styles.sub}>
          {line(w).map((x, i) => (
            <Text key={x.text} style={{ color: tone[x.tone as keyof typeof tone] }}>
              {i ? <Text style={{ color: t.fg3 }}> · </Text> : null}
              {x.text}
            </Text>
          ))}
        </Text>
      </View>
      <View style={styles.check}>{current ? <Icon name="check" size={16} color={t.accent} weight="bold" /> : busy ? <Text style={{ color: t.fg3 }}>…</Text> : null}</View>
    </Press>
  )
}

export default function Workspaces() {
  const t = useTheme()
  const { client, state, ws, link } = useCrew()
  const [going, setGoing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const list = state?.workspaces ?? []
  const offline = client && link.status === 'offline' ? offlineText(link, client.macName) : ''
  const pick = async (id: string) => {
    if (id === ws) return router.back()
    tap()
    setGoing(id)
    setError('')
    try {
      await session.watch(id)
      router.back()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setGoing(null)
    }
  }
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: t.fg }]}>Workspaces</Text>
      <Text style={[styles.hint, { color: t.fg2 }]}>The phone shows one at a time. Picking one here doesn't change what your computer shows.</Text>
      <View style={[styles.list, { backgroundColor: t.card }]}>
        {list.length ? (
          list.map((w) => <Row key={w.id} t={t} w={w} current={w.id === ws} busy={going === w.id} onPress={() => void pick(w.id)} disabled={Boolean(offline) || Boolean(going)} />)
        ) : (
          <Text style={[styles.hint, { color: t.fg3, padding: 16 }]}>{state ? 'Just Home on this computer.' : 'Waiting for your computer…'}</Text>
        )}
      </View>
      <Text style={[styles.error, { color: offline ? t.waitingInk : t.danger }]}>{offline ? `${offline}: switching waits until it's back` : error || ' '}</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 26, gap: 10 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  hint: { fontSize: 14, lineHeight: 19 },
  list: { borderRadius: 18, padding: 6, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 13 },
  rowText: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  sub: { fontSize: 14, fontWeight: '500' },
  check: { width: 20, alignItems: 'center', alignSelf: 'center' },
  error: { fontSize: 13.5, textAlign: 'center', minHeight: 18 },
})

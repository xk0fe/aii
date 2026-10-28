// Everything waiting for you, each card in full (always-allow choices, notes, the whole plan), and what you answered
// lately underneath.
import { router } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { FeedEntry } from '@/net/types'
import { useCrew, useDerived } from '@/state/hooks'
import { AskCard, AskSummary, askVerb } from '@/ui/ask'
import { agentColor } from '@/ui/avatar'
import { nameInk } from '@/ui/color'
import { Creature } from '@/ui/creature'
import { someone } from '@/ui/feed'
import { ago, displayName } from '@/ui/format'
import { Press } from '@/ui/parts'
import { offlineText, TopBar } from '@/ui/topbar'
import { useTheme } from '@/ui/theme'

export default function NeedsScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { client, link, state } = useCrew()
  const d = useDerived(state)
  const offline = client && link.status === 'offline' ? offlineText(link, client.macName) : ''
  const answered = (state?.feed ?? []).filter((e) => e.kind === 'ask' && e.answer).slice(-8).reverse()
  const head = (e: FeedEntry) => {
    const a = someone(e.from, d.byName)
    return (
      <Press style={styles.head} onPress={() => router.push({ pathname: '/agent/[name]', params: { name: a.cloneOf ?? a.name } })} accessibilityLabel={`${displayName(e.from).base} ${askVerb(e)}`}>
        <Creature agent={a} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.who, { color: t.fg2 }]} numberOfLines={1}>
            <Text style={{ color: nameInk(agentColor(a), t.fg), fontWeight: '700' }}>{displayName(e.from).base}</Text> {askVerb(e)}
          </Text>
          <Text style={[styles.when, { color: t.fg3 }]}>{ago(e.ts) === 'just now' ? 'just now' : `${ago(e.ts)} ago`}</Text>
        </View>
      </Press>
    )
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar t={t} />
      <KeyboardAwareScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} bottomOffset={24} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: t.fg }]}>Needs you</Text>
        <Text style={[styles.sub, { color: offline ? t.waitingInk : t.fg2 }]}>{offline ? `${offline}: answers wait until it's back` : d.open.length ? `${d.open.length === 1 ? 'One question' : `${d.open.length} questions`} waiting for you` : 'Nothing waiting for you'}</Text>
        {d.open.length ? (
          d.open.map((e) => (
            <View key={e.id} style={[styles.card, { backgroundColor: t.card, borderColor: t.dark ? 'rgba(255,159,10,0.5)' : 'rgba(255,159,10,0.55)' }]}>
              {head(e)}
              <AskCard t={t} e={e} onAnswer={(id, r) => client!.answer(id, r)} disabled={offline ? `Answering waits until ${client?.macName} is back` : null} />
            </View>
          ))
        ) : (
          <View style={styles.empty}>
            <View style={styles.buddies}>
              {d.agents.slice(0, 3).map((a, i) => (
                <View key={a.name} style={{ marginLeft: i ? -14 : 0, zIndex: i === 1 ? 2 : 1 }}>
                  <Creature agent={{ ...a, status: 'idle' }} size={i === 1 ? 64 : 54} mood="idle" />
                </View>
              ))}
            </View>
            <Text style={[styles.emptyText, { color: t.fg2 }]}>When an agent asks for permission, has a question or a plan, it lands here.</Text>
          </View>
        )}
        {answered.length ? (
          <>
            <Text style={[styles.section, { color: t.fg2 }]}>Answered lately</Text>
            <View style={[styles.list, { backgroundColor: t.card }]}>
              {answered.map((e, i) => {
                const a = someone(e.from, d.byName)
                return (
                  <View key={e.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
                    <Creature agent={a} size={28} mood="still" />
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text style={[styles.rowWho, { color: t.fg2 }]} numberOfLines={1}>
                        <Text style={{ color: nameInk(agentColor(a), t.fg), fontWeight: '700' }}>{displayName(e.from).base}</Text> · {ago(e.answer?.at ?? e.ts) === 'just now' ? 'just now' : `${ago(e.answer?.at ?? e.ts)} ago`}
                      </Text>
                      <AskSummary t={t} e={e} plain />
                    </View>
                  </View>
                )
              })}
            </View>
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, gap: 14 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6, marginTop: 6 },
  sub: { fontSize: 15, marginTop: -10, marginBottom: 2 },
  card: { borderRadius: 22, borderWidth: 1.5, padding: 16, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  who: { fontSize: 15, fontWeight: '500' },
  when: { fontSize: 12.5 },
  empty: { alignItems: 'center', paddingVertical: 36, gap: 16 },
  buddies: { flexDirection: 'row', alignItems: 'flex-end' },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 300 },
  section: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginLeft: 4 },
  list: { borderRadius: 18, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12 },
  rowWho: { fontSize: 13.5 },
})

// Everything waiting for you, each in full: the creature asks in its own words on its felt patch ("Can I run npm run
// build?"), under one line saying who and when, with the answers under it. What you answered lately is underneath.
import { router, useIsFocused } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { FeedEntry, Reply } from '@/net/types'
import { useCrew, useDerived } from '@/state/hooks'
import { AskCard, AskSummary, askVerb } from '@/ui/ask'
import { agentColor } from '@/ui/avatar'
import { Creature, MotionContext } from '@/ui/creature'
import { someone } from '@/ui/feed'
import { ago, askKindOf, displayName, voiceOf } from '@/ui/format'
import { useAppActive } from '@/ui/hooks'
import { Press } from '@/ui/parts'
import { Patch } from '@/ui/surface'
import { offlineText, TabHead } from '@/ui/topbar'
import { fonts, type Theme, useTheme } from '@/ui/theme'

const agoText = (ts?: number) => (ago(ts) === 'just now' ? 'Just now' : `${ago(ts)} ago`)
const PATCH = 72

function Ask({ t, e, d, answer, disabled }: { t: Theme; e: FeedEntry; d: ReturnType<typeof useDerived>; answer: (id: string, r: Reply) => Promise<unknown>; disabled: string | null }) {
  const a = someone(e.from, d.byName)
  const name = displayName(e.from).base
  const said = voiceOf(e.ask)
  const words = said.map((p) => p.text).join('')
  return (
    <View style={[styles.card, { backgroundColor: t.surface }]}>
      <Press style={styles.head} onPress={() => router.push({ pathname: '/agent/[name]', params: { name: a.cloneOf ?? a.name } })} accessibilityRole="button" accessibilityLabel={`${name} ${askVerb(e)}, ${agoText(e.ts).toLowerCase()}`} accessibilityHint={`Opens ${name}`}>
        <Text style={[styles.who, { color: t.fg2 }]} numberOfLines={1}>
          <Text style={{ color: t.fg, fontWeight: '600' }}>{name}</Text> {askVerb(e)}
        </Text>
        <Text style={[styles.when, { color: t.fg3 }]}>{ago(e.ts)}</Text>
      </Press>
      <View style={styles.speak} accessible accessibilityLabel={`${name} says: ${words}`}>
        <Patch color={agentColor(a)} width={PATCH} height={PATCH} inset={4}>
          <View style={styles.posed}>
            <Creature agent={{ ...a, status: 'waiting', on: true }} size={PATCH - 6} posed ask={askKindOf(e.ask)} />
          </View>
        </Patch>
        <View style={[styles.voice, { backgroundColor: t.bg }]}>
          <Text style={[styles.voiceText, { color: t.fg }]}>
            {said.map((p, i) =>
              p.code ? (
                <Text key={i} style={styles.mono}>
                  {p.text}
                </Text>
              ) : (
                p.text
              ),
            )}
          </Text>
        </View>
      </View>
      <AskCard t={t} e={e} onAnswer={answer} disabled={disabled} voiced />
    </View>
  )
}

export default function NeedsScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { client, link, state } = useCrew()
  const d = useDerived(state)
  const focused = useIsFocused()
  const active = useAppActive()
  const offline = client && link.status === 'offline' ? offlineText(link, client.macName) : ''
  const answered = (state?.feed ?? []).filter((e) => e.kind === 'ask' && e.answer).slice(-8).reverse()
  const n = d.open.length
  return (
    <MotionContext.Provider value={focused && active}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <TabHead t={t} title="Needs you" sub={n ? `${n} waiting` : ''} />
        <KeyboardAwareScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} bottomOffset={24} keyboardShouldPersistTaps="handled">
          {n ? (
            d.open.map((e) => <Ask key={e.id} t={t} e={e} d={d} answer={(id, r) => client!.answer(id, r)} disabled={offline ? `Answering waits until ${client?.macName} is back` : null} />)
          ) : (
            <View style={styles.empty}>
              <View style={styles.buddies}>
                {d.agents.slice(0, 3).map((a, i) => (
                  <View key={a.name} style={{ marginLeft: i ? -10 : 0, zIndex: i === 1 ? 2 : 1 }}>
                    <Creature agent={{ ...a, status: 'idle', on: true }} size={i === 1 ? 72 : 64} posed mood="still" />
                  </View>
                ))}
              </View>
              <Text style={[styles.emptyText, { color: t.fg2 }]}>When someone wants your OK, has a question or a plan, it lands here.</Text>
            </View>
          )}
          {answered.length ? (
            <>
              <Text style={[styles.section, { color: t.fg }]} accessibilityRole="header">
                Answered lately
              </Text>
              <View style={[styles.list, { backgroundColor: t.surface }]}>
                {answered.map((e, i) => {
                  const a = someone(e.from, d.byName)
                  return (
                    <View key={e.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
                      <Creature agent={a} size={28} mood="still" />
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[styles.rowWho, { color: t.fg2 }]} numberOfLines={1}>
                          <Text style={{ color: t.fg, fontWeight: '600' }}>{displayName(e.from).base}</Text> {agoText(e.answer?.at ?? e.ts).toLowerCase()}
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
    </MotionContext.Provider>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, gap: 12 },
  card: { borderRadius: 14, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  who: { flex: 1, fontSize: 16, lineHeight: 21 },
  when: { fontSize: 13, lineHeight: 18 },
  speak: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  posed: { position: 'absolute', left: 3, bottom: 1 },
  voice: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderTopLeftRadius: 4 },
  voiceText: { fontSize: 15, lineHeight: 20 },
  mono: { fontFamily: fonts.mono, fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 16 },
  buddies: { flexDirection: 'row', alignItems: 'flex-end' },
  emptyText: { fontSize: 15, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  section: { fontSize: 15, lineHeight: 20, fontWeight: '600', marginTop: 8, marginLeft: 16, marginBottom: -8 },
  list: { borderRadius: 14, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12 },
  rowWho: { fontSize: 15, lineHeight: 20 },
})

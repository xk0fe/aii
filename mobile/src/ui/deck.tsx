// "Needs you" at the top of the chat: the questions waiting for you as a stack of cards, the oldest in front and the
// rest peeking out behind it. Answer the front one and the next comes forward. Fold it away to read the chat.
import { router } from 'expo-router'
import { useState, useSyncExternalStore } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated'

import type { Agent, FeedEntry, Reply } from '@/net/types'

import { AskCard, askVerb } from './ask'
import { agentColor } from './avatar'
import { nameInk } from './color'
import { Creature } from './creature'
import { ago, displayName } from './format'
import { someone } from './feed'
import { Icon } from './icon'
import { Faces, Press, tap } from './parts'
import type { Theme } from './theme'

// folded or not, for the whole app (it's a preference, not per screen)
let folded = false
const fold = new Set<() => void>()
const setFolded = (v: boolean) => {
  folded = v
  for (const fn of fold) fn()
}
const useFolded = () => useSyncExternalStore((fn) => (fold.add(fn), () => fold.delete(fn)), () => folded)

export function Deck({ t, open, byName, onAnswer, disabled }: { t: Theme; open: FeedEntry[]; byName: Map<string, Agent>; onAnswer: (id: string, r: Reply) => Promise<unknown>; disabled: string | null }) {
  const isFolded = useFolded()
  const [pick, setPick] = useState<string | null>(null)
  if (!open.length) return null
  const at = Math.max(0, open.findIndex((e) => e.id === pick))
  const e = open[at]
  const a = someone(e.from, byName)
  const next = () => {
    tap()
    setPick(open[(at + 1) % open.length].id)
  }
  const behind = Math.min(2, open.length - 1)

  if (isFolded)
    return (
      <Animated.View entering={FadeIn.duration(180)} style={styles.wrap}>
        <Press onPress={() => setFolded(false)} style={[styles.folded, { backgroundColor: t.surface }]} accessibilityRole="button" accessibilityLabel={`${open.length} need you. Show`}>
          <Faces faces={open.map((x) => someone(x.from, byName)).filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i)} size={24} />
          <Text style={[styles.foldedText, { color: t.waitingInk }]}>{open.length === 1 ? '1 needs you' : `${open.length} need you`}</Text>
          <Icon name="down" size={13} color={t.fg3} weight="bold" />
        </Press>
      </Animated.View>
    )

  return (
    <Animated.View style={styles.wrap} layout={LinearTransition.duration(220)}>
      <Animated.View key={e.id} entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)} style={[styles.card, { backgroundColor: t.surface, shadowColor: '#000' }]}>
        <View style={styles.head}>
          <Creature agent={a} size={34} />
          <View style={styles.who}>
            <Text style={[styles.whoText, { color: t.fg2 }]} numberOfLines={1}>
              <Text style={{ color: nameInk(agentColor(a), t.fg), fontWeight: '700' }}>{displayName(e.from).base}</Text> {askVerb(e)}
            </Text>
            <Text style={[styles.when, { color: t.fg3 }]}>{ago(e.ts) === 'just now' ? 'just now' : `${ago(e.ts)} ago`}</Text>
          </View>
          {open.length > 1 ? (
            <Press onPress={next} style={[styles.count, { backgroundColor: t.btn }]} accessibilityRole="button" accessibilityLabel={`${at + 1} of ${open.length}. Next question`} hitSlop={6}>
              <Text style={[styles.countText, { color: t.fg2 }]}>
                {at + 1} of {open.length}
              </Text>
              <Icon name="right" size={11} color={t.fg3} weight="bold" />
            </Press>
          ) : null}
          <Press onPress={() => setFolded(true)} style={[styles.foldBtn, { backgroundColor: t.btn }]} accessibilityRole="button" accessibilityLabel="Fold the questions away" hitSlop={6}>
            <Icon name="down" size={12} color={t.fg3} weight="bold" />
          </Press>
        </View>
        <AskCard t={t} e={e} compact onAnswer={onAnswer} onMore={() => router.push({ pathname: '/ask/[id]', params: { id: e.id } })} disabled={disabled} />
      </Animated.View>
      {/* the cards behind, peeking out */}
      {Array.from({ length: behind }, (_, i) => (
        <Press key={i} onPress={next} style={[styles.sliver, { marginHorizontal: 10 + i * 10, backgroundColor: t.card, borderColor: t.lineStrong, opacity: 1 - i * 0.3 }]} accessibilityLabel="Next question">
          <View />
        </Press>
      ))}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  card: { borderRadius: 14, padding: 12, gap: 10, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2, zIndex: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  who: { flex: 1, gap: 1 },
  whoText: { fontSize: 15, fontWeight: '500' },
  when: { fontSize: 12.5 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 10, borderRadius: 14 },
  countText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  foldBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '180deg' }] },
  sliver: { height: 7, marginTop: -1, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderWidth: StyleSheet.hairlineWidth * 2, borderTopWidth: 0 },
  folded: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 12, borderRadius: 14 },
  foldedText: { flex: 1, fontSize: 15, fontWeight: '600' },
})

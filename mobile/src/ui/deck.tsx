// "Needs you" at the top of the chat, the way a chat pins a message: one line saying who and what, so the messages keep
// the room. Tap it for the question itself, with its answers, and the next one comes up as you answer.
import { router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'

import type { Agent, FeedEntry, Reply } from '@/net/types'

import { AskCard, askVerb } from './ask'
import { agentColor } from './avatar'
import { nameInk } from './color'
import { Creature } from './creature'
import { ago, displayName } from './format'
import { someone } from './feed'
import { Icon } from './icon'
import { Faces, Press, tap } from './parts'
import { fonts, type Theme } from './theme'

// What a question is about, in as few words as the line has room for.
function gist(e: FeedEntry) {
  const ask = typeof e.ask === 'object' ? e.ask : null
  if (ask?.type === 'permission') return { text: (ask.code ?? ask.title ?? '').split('\n')[0], mono: Boolean(ask.code) }
  if (ask?.type === 'question') return { text: ask.questions[0]?.question ?? '', mono: false }
  return { text: '', mono: false }
}

export function Deck({ t, open, byName, onAnswer, disabled }: { t: Theme; open: FeedEntry[]; byName: Map<string, Agent>; onAnswer: (id: string, r: Reply) => Promise<unknown>; disabled: string | null }) {
  const [isFolded, setFolded] = useState(true)
  const [pick, setPick] = useState<string | null>(null)
  // nothing left, however it was answered: the next question to come up starts as a line, not a card pushing the
  // messages down
  if (!open.length && !isFolded) setFolded(true)
  if (!open.length) return null
  const at = Math.max(0, open.findIndex((e) => e.id === pick))
  const e = open[at]
  const a = someone(e.from, byName)
  const next = () => {
    tap()
    setPick(open[(at + 1) % open.length].id)
  }

  if (isFolded) {
    const who = open.map((x) => someone(x.from, byName)).filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i)
    const one = open.length === 1
    const about = one ? gist(e) : { text: who.map((x) => displayName(x.name).base).join(', '), mono: false }
    const title = one ? `${displayName(e.from).base} ${askVerb(e)}` : `${open.length} need you`
    return (
      <Animated.View entering={FadeIn.duration(160)}>
        <Press onPress={() => setFolded(false)} style={[styles.line, { backgroundColor: t.needsTint }]} accessibilityRole="button" accessibilityLabel={`${title}${about.text ? `: ${about.text}` : ''}. Show`}>
          <Faces faces={who} size={22} max={3} />
          <Text style={[styles.lineText, { color: t.fg2 }]} numberOfLines={1}>
            <Text style={{ color: t.waitingInk, fontWeight: '600' }}>{title}</Text>
            {about.text ? '  ' : ''}
            <Text style={about.mono ? styles.mono : undefined}>{about.text}</Text>
          </Text>
          <Icon name="down" size={12} color={t.fg3} weight="bold" />
        </Press>
      </Animated.View>
    )
  }

  return (
    <Animated.View key={e.id} entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={[styles.card, { borderBottomColor: t.line }]}>
      <View style={styles.head}>
        <Creature agent={a} size={26} />
        <Text style={[styles.who, { color: t.fg2 }]} numberOfLines={1}>
          <Text style={{ color: nameInk(agentColor(a), t.fg), fontWeight: '600' }}>{displayName(e.from).base}</Text> {askVerb(e)}
          <Text style={{ color: t.fg3 }}>{`  ${ago(e.ts) === 'just now' ? 'just now' : `${ago(e.ts)} ago`}`}</Text>
        </Text>
        {open.length > 1 ? (
          <Press onPress={next} style={styles.count} accessibilityRole="button" accessibilityLabel={`${at + 1} of ${open.length}. Next question`} hitSlop={6}>
            <Text style={[styles.countText, { color: t.fg2 }]}>
              {at + 1} of {open.length}
            </Text>
            <Icon name="right" size={10} color={t.fg3} weight="bold" />
          </Press>
        ) : null}
        <Press onPress={() => setFolded(true)} style={styles.foldBtn} accessibilityRole="button" accessibilityLabel="Fold the questions away" hitSlop={8}>
          <Icon name="up" size={12} color={t.fg3} weight="bold" />
        </Press>
      </View>
      <AskCard t={t} e={e} compact onAnswer={onAnswer} onMore={() => router.push({ pathname: '/ask/[id]', params: { id: e.id } })} disabled={disabled} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 16 },
  lineText: { flex: 1, fontSize: 13.5 },
  mono: { fontFamily: fonts.mono, fontSize: 12.5 },
  card: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  who: { flex: 1, fontSize: 14 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 28 },
  countText: { fontSize: 13, fontVariant: ['tabular-nums'] },
  foldBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
})

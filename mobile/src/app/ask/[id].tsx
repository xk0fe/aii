// One question card in full, as a sheet over the chat: answer it and the sheet closes.
import { router, useLocalSearchParams } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import type { Reply } from '@/net/types'
import { useCrew, useDerived } from '@/state/hooks'
import { AskCard, AskSummary, askVerb } from '@/ui/ask'
import { agentColor } from '@/ui/avatar'
import { nameInk } from '@/ui/color'
import { Creature } from '@/ui/creature'
import { someone } from '@/ui/feed'
import { ago, displayName } from '@/ui/format'
import { Button } from '@/ui/parts'
import { offlineText } from '@/ui/topbar'
import { useTheme } from '@/ui/theme'

export default function AskSheet() {
  const t = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client, state, link } = useCrew()
  const d = useDerived(state)
  const e = state?.feed.find((x) => x.id === id)
  if (!e || !client) {
    return (
      <View style={[styles.gone, { backgroundColor: t.bg }]}>
        <Text style={[styles.when, { color: t.fg2 }]}>That question isn't here any more.</Text>
      </View>
    )
  }
  const a = someone(e.from, d.byName)
  const offline = link.status === 'offline' ? offlineText(link, client.macName) : ''
  const answer = async (cardId: string, reply: Reply) => {
    await client.answer(cardId, reply)
    setTimeout(() => router.canGoBack() && router.back(), 450)
  }
  return (
    <KeyboardAwareScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content} bottomOffset={20} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        <Creature agent={a} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.who, { color: t.fg2 }]}>
            <Text style={{ color: nameInk(agentColor(a), t.fg), fontWeight: '700' }}>{displayName(e.from).base}</Text> {askVerb(e)}
          </Text>
          <Text style={[styles.when, { color: t.fg3 }]}>{ago(e.ts) === 'just now' ? 'just now' : `${ago(e.ts)} ago`}</Text>
        </View>
      </View>
      {e.answer ? (
        <View style={styles.done}>
          <AskSummary t={t} e={e} />
          <Button t={t} title="Close" onPress={() => router.back()} />
        </View>
      ) : (
        <AskCard t={t} e={e} onAnswer={answer} disabled={offline ? `Answering waits until ${client.macName} is back` : null} />
      )}
    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingTop: 26, gap: 18, paddingBottom: 40 },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  who: { fontSize: 17, fontWeight: '500' },
  when: { fontSize: 13 },
  done: { gap: 16 },
})

// Reactions under a message: one emoji in place of a written "got it" (the computer's `clique react`). A pill per
// emoji with the little faces of the agents who put it there, and how many when several did; yours is outlined. One
// line, never wrapping: past four, "+2". Read-only here: you react on the computer.
import { StyleSheet, Text, View } from 'react-native'
import type { Agent, FeedEntry } from '@/net/types'
import { reactionGroups } from '@/net/shared'
import { familyOf } from '@/state/hooks'
import { displayName } from '@/ui/format'
import { Faces } from '@/ui/parts'
import type { Theme } from '@/ui/theme'

const SHOWN = 4
const someone = (name: string, byName: Map<string, Agent>): Agent => byName.get(name) ?? byName.get(familyOf(name)) ?? ({ name, status: 'idle', on: true } as Agent)
const list = (names: string[]) => (names.length > 3 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} others` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? ''))

// What a screen reader says for a message's reactions: "Ada and Milo reacted 👍. Theo reacted 👀"
export function reactionsLabel(e: Pick<FeedEntry, 'reactions'>) {
  return (reactionGroups(e.reactions) as { emoji: string; by: string[] }[]).map((g) => `${list(g.by.map((n) => (n === 'you' ? 'You' : displayName(n).base)))} reacted ${g.emoji}`).join('. ')
}

export function Reactions({ e, byName, t }: { e: FeedEntry; byName: Map<string, Agent>; t: Theme }) {
  const groups = reactionGroups(e.reactions) as { emoji: string; by: string[] }[]
  if (!groups.length) return null
  const more = groups.length - SHOWN
  return (
    <View style={styles.row} accessible accessibilityLabel={reactionsLabel(e)}>
      {groups.slice(0, SHOWN).map((g) => {
        const mine = g.by.includes('you')
        const faces = g.by.filter((n) => n !== 'you').slice(0, 3)
        return (
          <View key={g.emoji} style={[styles.pill, { backgroundColor: t.fill, borderColor: mine ? t.accent : 'transparent' }]}>
            <Text style={styles.emoji} allowFontScaling={false}>
              {g.emoji}
            </Text>
            {faces.length ? <Faces faces={faces.map((n) => someone(n, byName))} size={18} max={3} /> : null}
            {g.by.length > 1 ? (
              <Text style={[styles.count, { color: mine ? t.fg : t.fg2 }]} allowFontScaling={false}>
                {g.by.length}
              </Text>
            ) : null}
          </View>
        )
      })}
      {more > 0 ? (
        <View style={[styles.pill, { backgroundColor: t.fill, borderColor: 'transparent' }]}>
          <Text style={[styles.count, { color: t.fg2 }]} allowFontScaling={false}>
            +{more}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, overflow: 'hidden' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 8, borderRadius: 14, borderWidth: 1.5 },
  emoji: { fontSize: 15, lineHeight: 20 },
  count: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
})

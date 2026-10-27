// The crew as Pokédex-style cards, in the order the Mac keeps them (a status change never moves a card).
import { router } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useCrew, useDerived } from '@/state/hooks'
import { AgentCard } from '@/ui/agentCard'
import { plural } from '@/ui/format'
import { useNow } from '@/ui/hooks'
import { TopBar } from '@/ui/topbar'
import { useTheme } from '@/ui/theme'

export default function CrewScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { state } = useCrew()
  const d = useDerived(state)
  const now = useNow(30000)
  const on = d.agents.filter((a) => a.on)
  const homes = new Set(d.agents.map((a) => a.home ?? ''))
  const sub = [plural(d.agents.length, 'agent'), `${on.length} on`, homes.size > 1 ? `${homes.size} computers` : '', state?.parked ? 'parked' : ''].filter(Boolean).join(' · ')
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar t={t} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={[styles.title, { color: t.fg }]}>Your crew</Text>
        <Text style={[styles.sub, { color: t.fg2 }]}>{state ? sub : ' '}</Text>
        {d.agents.map((a) => (
          <AgentCard key={a.name} a={a} clones={d.clones.get(a.name) ?? []} providers={state?.providers} unread={d.unread.get(a.name) ?? 0} now={now} onPress={() => router.push({ pathname: '/agent/[name]', params: { name: a.name } })} />
        ))}
        {state && !d.agents.length ? <Text style={[styles.sub, { color: t.fg3 }]}>No agents in this workspace yet. Add them on the Mac.</Text> : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, gap: 16 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6, marginTop: 6 },
  sub: { fontSize: 15, marginTop: -14, marginBottom: 4 },
})

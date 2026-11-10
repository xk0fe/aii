// The computers this phone is paired with: which one is in use, how it's reached (or since when it isn't), and Remove.
// Plain words only: Wi-Fi or Tailscale, never an address or a port.
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { APP_NAME } from '@/brand'
import type { MacRecord } from '@/net/types'
import { useClique, useSession } from '@/state/hooks'
import { DEMO, session } from '@/state/session'
import { reachedOver, when } from '@/ui/format'
import { useNow } from '@/ui/hooks'
import { Icon } from '@/ui/icon'
import { Button, CliqueMark, Press, Wordmark } from '@/ui/parts'
import { offlineText, TabHead } from '@/ui/topbar'
import { useTheme, type Theme } from '@/ui/theme'

function ComputerCard({ t, mac, active }: { t: Theme; mac: MacRecord; active: boolean }) {
  const { link, client } = useClique()
  useNow(30000)
  const over = link.status === 'online' ? reachedOver(link.host) : ''
  const status = !active ? 'Not in use' : link.status === 'online' ? `Connected over ${over || 'your network'}` : link.status === 'offline' ? offlineText(link, mac.name).replace(`${mac.name} unreachable`, "Can't be reached") : 'Connecting…'
  const tone = !active ? t.fg2 : link.status === 'online' ? t.workingInk : link.status === 'offline' ? t.waitingInk : t.fg2
  const remove = () =>
    Alert.alert(`Remove ${mac.name}?`, `This phone forgets the computer and its key. To use it again, pair with a new code. In ${APP_NAME} on the computer, remove this phone under Computers too.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void session.remove(mac.id) },
    ])
  return (
    <View style={[styles.card, { backgroundColor: t.surface }]}>
      <View style={styles.cardHead}>
        <Icon name="mac" size={26} color={t.fg2} weight="regular" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.macName, { color: t.fg }]}>{mac.name}</Text>
          <Text style={[styles.status, { color: tone }]}>{status}</Text>
        </View>
        {active ? <Icon name="check" size={17} color={t.accent} weight="bold" /> : null}
      </View>
      <Text style={[styles.detail, { color: t.fg2 }]}>Paired {when(mac.pairedAt)}</Text>
      {active && link.status === 'offline' && !link.fatal ? (
        <Text style={[styles.detail, { color: t.fg2 }]}>It reconnects by itself once the phone can reach it: the same Wi-Fi, or Tailscale on both. If you removed this phone on the computer, remove it here too and pair again.</Text>
      ) : null}
      <View style={styles.actions}>
        {active ? (
          link.status === 'offline' && !link.fatal ? <Button t={t} small title="Try now" icon="restart" onPress={() => client?.wake()} /> : null
        ) : (
          <Button t={t} small title="Use this computer" onPress={() => void session.use(mac.id)} />
        )}
        <Button t={t} small kind="danger" title="Remove" icon="trash" onPress={remove} accessibilityLabel={`Remove ${mac.name}`} />
      </View>
    </View>
  )
}

export default function SettingsScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const s = useSession()
  const demo = s.active === DEMO
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TabHead t={t} title="Computers" workspace={false} sub={`The phone talks to ${APP_NAME} on one computer at a time, over your Wi-Fi or Tailscale, encrypted end to end.`} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {s.macs.map((m) => (
          <ComputerCard key={m.id} t={t} mac={m} active={s.active === m.id} />
        ))}
        {demo ? (
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            <View style={styles.cardHead}>
              <CliqueMark size={30} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.macName, { color: t.fg }]}>Demo clique</Text>
                <Text style={[styles.status, { color: t.fg2 }]}>Made up, and only on this phone</Text>
              </View>
              <Icon name="check" size={17} color={t.accent} weight="bold" />
            </View>
            <View style={styles.actions}>
              <Button t={t} small title="Leave the demo" onPress={() => void session.remove(DEMO).then(() => !session.getSnapshot().active && router.replace('/pair'))} />
            </View>
          </View>
        ) : null}
        <Button t={t} kind="primary" icon="scan" title={s.macs.length ? 'Pair another computer' : 'Pair with your computer'} onPress={() => router.push('/pair')} />
        {!demo ? (
          <Press onPress={() => session.startDemo()} style={styles.link} accessibilityRole="button">
            <Text style={[styles.linkText, { color: t.accent }]}>Look around the demo clique</Text>
          </Press>
        ) : null}
        <View style={styles.about} accessible accessibilityLabel={`${APP_NAME} for iPhone and Android, version ${Constants.expoConfig?.version ?? ''}`}>
          <Wordmark name={APP_NAME} size={28} />
          <Text style={[styles.foot, { color: t.fg2 }]}>
            For iPhone and Android, version {Constants.expoConfig?.version ?? ''}
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, gap: 14 },
  card: { borderRadius: 14, padding: 16, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  macName: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  status: { fontSize: 15, lineHeight: 20, marginTop: 1 },
  detail: { fontSize: 15, lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  link: { alignSelf: 'center', paddingVertical: 8 },
  linkText: { fontSize: 17, lineHeight: 22 },
  about: { alignItems: 'center', gap: 2, marginTop: 16 },
  foot: { textAlign: 'center', fontSize: 13, lineHeight: 18 },
})

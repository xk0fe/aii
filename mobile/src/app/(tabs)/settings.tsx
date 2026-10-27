// The Macs this phone is paired with: which one is in use, how it's reached (or since when it isn't), and Remove.
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { MacRecord } from '@/net/types'
import { useCrew, useSession } from '@/state/hooks'
import { DEMO, session } from '@/state/session'
import { when } from '@/ui/format'
import { useNow } from '@/ui/hooks'
import { Icon } from '@/ui/icon'
import { Button, CrewMark, Press } from '@/ui/parts'
import { offlineText } from '@/ui/topbar'
import { fonts, useTheme, type Theme } from '@/ui/theme'

function Row({ t, label, value, mono, last }: { t: Theme; label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
      <Text style={[styles.label, { color: t.fg2 }]}>{label}</Text>
      <Text style={[styles.value, { color: t.fg, fontFamily: mono ? fonts.mono : undefined, fontSize: mono ? 13.5 : 15 }]} selectable>
        {value}
      </Text>
    </View>
  )
}

function MacCard({ t, mac, active }: { t: Theme; mac: MacRecord; active: boolean }) {
  const { link, client } = useCrew()
  useNow(30000)
  const status = !active ? 'Not in use' : link.status === 'online' ? `Online via ${link.host}` : link.status === 'offline' ? offlineText(link, mac.name).replace(`${mac.name} unreachable`, 'Unreachable') : 'Connecting…'
  const tone = !active ? t.fg3 : link.status === 'online' ? t.workingInk : link.status === 'offline' ? t.waitingInk : t.fg2
  const remove = () =>
    Alert.alert(`Remove ${mac.name}?`, 'This phone forgets the Mac and its key. To use it again, pair with a new code. On the Mac, remove this phone under Computers › Phones too.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void session.remove(mac.id) },
    ])
  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      <View style={styles.cardHead}>
        <View style={[styles.macIcon, { backgroundColor: t.btn }]}>
          <Icon name="mac" size={20} color={t.fg2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.macName, { color: t.fg }]}>{mac.name}</Text>
          <Text style={[styles.status, { color: tone }]}>{status}</Text>
        </View>
        {active ? <Icon name="check" size={17} color={t.accent} weight="bold" /> : null}
      </View>
      <View style={[styles.rows, { borderTopColor: t.line }]}>
        {mac.hosts.map((h, i) => (
          <Row key={h} t={t} label={i ? '' : mac.hosts.length > 1 ? 'Addresses' : 'Address'} value={`${h}${active && link.status === 'online' && link.host === h ? '  ·  in use' : ''}`} mono />
        ))}
        <Row t={t} label="Port" value={String(mac.port)} mono />
        <Row t={t} label="This phone" value={mac.deviceId || '—'} mono />
        <Row t={t} label="Paired" value={when(mac.pairedAt)} last />
      </View>
      {active && link.status === 'offline' && !link.fatal ? (
        <Text style={[styles.hint, { color: t.fg2 }]}>
          It reconnects by itself once the phone can reach it. If you removed this phone under <Text style={{ fontWeight: '600' }}>Computers › Phones</Text> on the Mac, remove it here too and pair again.
        </Text>
      ) : null}
      <View style={styles.actions}>
        {active ? (
          link.status === 'offline' && !link.fatal ? <Button t={t} small title="Try now" icon="restart" onPress={() => client?.wake()} /> : null
        ) : (
          <Button t={t} small title="Use this Mac" onPress={() => void session.use(mac.id)} />
        )}
        <Button t={t} small kind="danger" title="Remove" icon="trash" onPress={remove} />
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
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
        <Text style={[styles.title, { color: t.fg }]}>Your Macs</Text>
        <Text style={[styles.sub, { color: t.fg2 }]}>The phone talks to Crew on one Mac at a time, straight over your network or Tailscale. Everything is encrypted end to end.</Text>
        {s.macs.map((m) => (
          <MacCard key={m.id} t={t} mac={m} active={s.active === m.id} />
        ))}
        {demo ? (
          <View style={[styles.card, { backgroundColor: t.card }]}>
            <View style={styles.cardHead}>
              <View style={[styles.macIcon, { backgroundColor: t.btn }]}>
                <CrewMark size={26} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.macName, { color: t.fg }]}>Demo crew</Text>
                <Text style={[styles.status, { color: t.fg2 }]}>Made up, and only on this phone</Text>
              </View>
              <Icon name="check" size={17} color={t.accent} weight="bold" />
            </View>
            <View style={styles.actions}>
              <Button t={t} small title="Leave the demo" onPress={() => void session.remove(DEMO).then(() => !session.getSnapshot().active && router.replace('/pair'))} />
            </View>
          </View>
        ) : null}
        <Button t={t} kind="primary" icon="scan" title={s.macs.length ? 'Pair another Mac' : 'Pair with your Mac'} onPress={() => router.push('/pair')} />
        {!demo ? (
          <Press onPress={() => session.startDemo()} style={styles.link} accessibilityRole="button">
            <Text style={[styles.linkText, { color: t.accent }]}>Look around the demo crew</Text>
          </Press>
        ) : null}
        <Text style={[styles.foot, { color: t.fg3 }]}>
          Crew for iPhone and Android, version {Constants.expoConfig?.version ?? ''}
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, gap: 14 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6 },
  sub: { fontSize: 15, lineHeight: 20, marginTop: -6, marginBottom: 4 },
  card: { borderRadius: 20, padding: 14, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  macIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  macName: { fontSize: 17, fontWeight: '700' },
  status: { fontSize: 14, fontWeight: '500', marginTop: 1 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 12 },
  label: { width: 92, fontSize: 14 },
  value: { flex: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  hint: { fontSize: 13.5, lineHeight: 18 },
  link: { alignSelf: 'center', paddingVertical: 6 },
  linkText: { fontSize: 15, fontWeight: '600' },
  foot: { textAlign: 'center', fontSize: 12.5, marginTop: 8 },
})

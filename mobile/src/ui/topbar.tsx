// The bar at the top of every tab: the workspace this phone watches (tap to switch) and how the Mac is reached.
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Link } from '@/net/client'
import { useCrew } from '@/state/hooks'

import { clock, when } from './format'
import { Icon } from './icon'
import { Press, WsTile } from './parts'
import type { Theme } from './theme'

// "Mac mini unreachable since 14:02", or why the Mac turned us away.
export function offlineText(link: Link, macName: string) {
  if (link.status !== 'offline') return ''
  if (link.fatal) return link.reason
  const since = Date.now() - link.since < 86400000 ? clock(link.since) : when(link.since)
  return `${macName} unreachable since ${since}`
}

export function LinkChip({ t }: { t: Theme }) {
  const { client, link } = useCrew()
  const name = client?.macName ?? 'Mac'
  const demo = Boolean(client?.demo)
  const color = link.status === 'online' ? t.working : link.status === 'offline' ? t.waiting : t.starting
  const label = demo ? 'Demo' : link.status === 'online' ? name : link.status === 'offline' ? 'Offline' : 'Connecting'
  return (
    <Press onPress={() => router.navigate('/settings')} style={[styles.chip, { backgroundColor: t.btn }]} accessibilityRole="button" accessibilityLabel={`${label}. Connection settings`} hitSlop={6}>
      {link.status === 'connecting' && !demo ? <ActivityIndicator size="small" color={t.fg2} style={styles.spinner} /> : <View style={[styles.dot, { backgroundColor: demo ? t.blocked : color }]} />}
      <Text style={[styles.chipText, { color: t.fg2 }]} numberOfLines={1}>
        {label}
      </Text>
    </Press>
  )
}

export function TopBar({ t, below, background }: { t: Theme; below?: ReactNode; background?: string }) {
  const insets = useSafeAreaInsets()
  const { state, ws, switching } = useCrew()
  const w = state?.workspaces?.find((x) => x.id === ws) ?? state?.workspace
  const others = (state?.workspaces ?? []).filter((x) => x.id !== ws)
  const needsElsewhere = others.reduce((n, x) => n + (x.waiting ?? 0), 0)
  const name = w?.name ?? (ws === 'default' ? 'Home' : ws)
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 4, backgroundColor: background ?? t.bg }]}>
      <View style={styles.row}>
        <Press onPress={() => router.push('/workspaces')} style={styles.ws} accessibilityRole="button" accessibilityLabel={`Workspace ${name}. Switch workspace`} hitSlop={8}>
          <View>
            <WsTile t={t} ws={w ?? { id: ws, name }} size={30} />
            {needsElsewhere ? (
              <View style={[styles.elsewhere, { backgroundColor: t.waiting, borderColor: background ?? t.bg }]}>
                <Text style={styles.elsewhereText}>{needsElsewhere > 9 ? '9+' : needsElsewhere}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.wsName, { color: t.fg }]} numberOfLines={1}>
            {name}
          </Text>
          {switching ? <ActivityIndicator size="small" color={t.fg3} /> : <Icon name="down" size={13} color={t.fg3} weight="bold" />}
        </Press>
        <LinkChip t={t} />
      </View>
      {below}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, height: 44 },
  ws: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  wsName: { fontSize: 19, fontWeight: '700', letterSpacing: -0.35, flexShrink: 1 },
  elsewhere: { position: 'absolute', right: -6, top: -5, minWidth: 17, height: 17, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  elsewhereText: { color: '#241500', fontSize: 9.5, fontWeight: '800' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 14, maxWidth: 160 },
  chipText: { fontSize: 13, fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  spinner: { transform: [{ scale: 0.7 }], width: 12, height: 12 },
})

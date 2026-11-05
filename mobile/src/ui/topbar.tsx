// The tops of the screens. The chat's bar: one row with whatever says where you are. The other tabs' head: one title
// with one line under it (the workspace, what's going on there, or the computer's state), and at the right the
// workspace's tile, which switches. One header each, however many facts it has to carry.
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Link } from '@/net/client'
import { useCrew } from '@/state/hooks'

import { clock, when } from './format'
import { Press, WsTile } from './parts'
import { type as typeScale, themes, type Theme } from './theme'

// "Studio unreachable since 14:02", or why the computer turned us away.
export function offlineText(link: Link, macName: string) {
  if (link.status !== 'offline') return ''
  if (link.fatal) return link.reason
  const since = Date.now() - link.since < 86400000 ? clock(link.since) : when(link.since)
  return `${macName} unreachable since ${since}`
}

export function TopBar({ background, children }: { background: string; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.bar, { paddingTop: insets.top, backgroundColor: background }]}>
      <View style={styles.row}>{children}</View>
    </View>
  )
}

// A tab's head. `workspace`: this tab shows one workspace, so the head says which and can switch it.
export function TabHead({ t, title, sub, workspace = true }: { t: Theme; title: string; sub?: string; workspace?: boolean }) {
  const insets = useSafeAreaInsets()
  const { client, link, state, ws, switching } = useCrew()
  const w = state?.workspaces?.find((x) => x.id === ws) ?? state?.workspace
  const needsElsewhere = (state?.workspaces ?? []).filter((x) => x.id !== ws).reduce((n, x) => n + (x.waiting ?? 0), 0)
  const name = w?.name ?? (ws === 'default' ? 'Home' : ws)
  const offline = workspace && link.status === 'offline' && client ? offlineText(link, client.macName) : ''
  const connecting = workspace && link.status === 'connecting' && client && !client.demo ? `Connecting to ${client.macName}…` : ''
  const line = offline || connecting || (workspace ? [name, sub].filter(Boolean).join('  ·  ') : (sub ?? ''))
  return (
    <View style={[styles.head, { paddingTop: insets.top + 8, backgroundColor: t.bg }]}>
      <View style={styles.headText}>
        <Text style={[typeScale.display, { color: t.fg }]} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {title}
        </Text>
        {line ? (
          <Text style={[styles.headLine, { color: offline ? t.waitingInk : t.fg2 }]} numberOfLines={workspace ? 1 : 3} maxFontSizeMultiplier={1.4}>
            {line}
          </Text>
        ) : null}
      </View>
      {workspace ? (
        <Press onPress={() => router.push('/workspaces')} style={styles.tile} accessibilityRole="button" accessibilityLabel={`Workspace ${name}. Switch workspace`} hitSlop={8}>
          <WsTile t={t} ws={w ?? { id: ws, name }} size={36} />
          {switching ? <ActivityIndicator style={StyleSheet.absoluteFill} size="small" color={t.fg} /> : null}
          {needsElsewhere ? (
            <View style={[styles.elsewhere, { backgroundColor: themes.light.waitingInk, borderColor: t.bg }]}>
              <Text style={styles.elsewhereText} maxFontSizeMultiplier={1}>
                {needsElsewhere > 9 ? '9+' : needsElsewhere}
              </Text>
            </View>
          ) : null}
        </Press>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  headText: { flex: 1, minWidth: 0 },
  headLine: { fontSize: 14, lineHeight: 19 },
  tile: { width: 36, height: 36 },
  elsewhere: { position: 'absolute', right: -6, top: -5, minWidth: 17, height: 17, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  elsewhereText: { color: '#FFFFFF', fontSize: 10, fontWeight: '600' },
})

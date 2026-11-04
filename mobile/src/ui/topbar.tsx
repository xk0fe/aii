// The bar at the top of every tab, one row: the workspace this phone watches (tap to switch) with a line under its name
// saying how the computer is reached and, from the screen, who's at work. A screen can put its own control on the
// right, or replace the switcher on the left (a conversation's back button and who it's with).
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Link } from '@/net/client'
import { useCrew } from '@/state/hooks'

import { clock, when } from './format'
import { Icon } from './icon'
import { Press, WsTile } from './parts'
import { themes, type Theme } from './theme'

// "Studio unreachable since 14:02", or why the computer turned us away.
export function offlineText(link: Link, macName: string) {
  if (link.status !== 'offline') return ''
  if (link.fatal) return link.reason
  const since = Date.now() - link.since < 86400000 ? clock(link.since) : when(link.since)
  return `${macName} unreachable since ${since}`
}

// title: what the screen shows within the workspace (the chat's channel). Then the tile switches the workspace, the
// title opens onTitle (the channels and conversations), and the line under it starts with the workspace's name.
export function TopBar({ t, background, sub, left, right, title, titleLabel, onTitle }: { t: Theme; background?: string; sub?: ReactNode; left?: ReactNode; right?: ReactNode; title?: ReactNode; titleLabel?: string; onTitle?: () => void }) {
  const insets = useSafeAreaInsets()
  const { client, link, state, ws, switching } = useCrew()
  const w = state?.workspaces?.find((x) => x.id === ws) ?? state?.workspace
  const others = (state?.workspaces ?? []).filter((x) => x.id !== ws)
  const needsElsewhere = others.reduce((n, x) => n + (x.waiting ?? 0), 0)
  const name = w?.name ?? (ws === 'default' ? 'Home' : ws)
  const bg = background ?? t.bg
  const titled = title !== undefined
  const lead = titled ? name : client?.demo ? 'Demo' : (client?.macName ?? '')
  // the connection comes first: while it's down, that's all the line says
  const status =
    link.status === 'offline' && client ? (
      <Text style={{ color: t.waitingInk }}>{offlineText(link, client.macName)}</Text>
    ) : link.status === 'connecting' && client && !client.demo ? (
      <Text style={{ color: t.fg3 }}>Connecting to {client.macName}…</Text>
    ) : (
      <>
        {lead}
        {sub ? <Text style={{ color: t.fg3 }}>{'  ·  '}</Text> : null}
        {sub}
      </>
    )
  const tile = (
    <View>
      <WsTile t={t} ws={w ?? { id: ws, name }} size={34} />
      {needsElsewhere ? (
        <View style={[styles.elsewhere, { backgroundColor: themes.light.waitingInk, borderColor: bg }]}>
          <Text style={styles.elsewhereText} maxFontSizeMultiplier={1}>{needsElsewhere > 9 ? '9+' : needsElsewhere}</Text>
        </View>
      ) : null}
    </View>
  )
  const titles = (
    <>
      <View style={styles.nameRow}>
        <Text style={[styles.wsName, { color: t.fg }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {titled ? title : name}
        </Text>
        {switching ? <ActivityIndicator size="small" color={t.fg3} style={styles.spinner} /> : <Icon name="down" size={11} color={t.fg3} weight="bold" />}
      </View>
      <Text style={[styles.sub, { color: t.fg2 }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {status}
      </Text>
    </>
  )
  const switcher = `Workspace ${name}. Switch workspace`
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 2, backgroundColor: bg }]}>
      <View style={styles.row}>
        {left ??
          (titled ? (
            <View style={styles.ws}>
              <Press onPress={() => router.push('/workspaces')} accessibilityRole="button" accessibilityLabel={switcher} hitSlop={8}>
                {tile}
              </Press>
              <Press onPress={onTitle} style={styles.titles} accessibilityRole="button" accessibilityLabel={titleLabel} hitSlop={8}>
                {titles}
              </Press>
            </View>
          ) : (
            <Press onPress={() => router.push('/workspaces')} style={styles.ws} accessibilityRole="button" accessibilityLabel={switcher} hitSlop={8}>
              {tile}
              <View style={styles.titles}>{titles}</View>
            </Press>
          ))}
        {right}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
  ws: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  titles: { flexShrink: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  wsName: { fontSize: 17, lineHeight: 21, fontWeight: '600', flexShrink: 1 },
  sub: { fontSize: 13, lineHeight: 17 },
  elsewhere: { position: 'absolute', right: -6, top: -5, minWidth: 17, height: 17, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  elsewhereText: { color: '#FFFFFF', fontSize: 10, fontWeight: '600' },
  spinner: { transform: [{ scale: 0.6 }], width: 12, height: 12 },
})

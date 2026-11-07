// A thread, opened: what agents said to each other about something you asked, one line each, in their own first
// sentence; a tap opens the whole message. What you write here stays in the thread, and goes to the agent you asked in
// the first place (or whoever started it) plus anyone you @mention. As desktop/ui/common.js mountThread.
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { FeedEntry } from '@/net/types'
import { familyOf, useCrew, useDerived } from '@/state/hooks'
import { Composer } from '@/ui/composer'
import { Creature } from '@/ui/creature'
import { someone } from '@/ui/feed'
import { clock, displayName, plural } from '@/ui/format'
import { Icon } from '@/ui/icon'
import { Markdown } from '@/ui/markdown'
import { Press } from '@/ui/parts'
import { threadLines } from '@/ui/threads'
import { TopBar, offlineText } from '@/ui/topbar'
import { fonts, useTheme } from '@/ui/theme'

const say = (n: string) => displayName(n).base

export default function ThreadScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client, link, state, ws } = useCrew()
  const d = useDerived(state)
  const { root, rows, echoes, hidden } = useMemo(() => threadLines(state?.feed ?? [], String(id)), [state?.feed, id])
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const list = useRef<FlatList<FeedEntry>>(null)
  // it opens at its newest line, and stays there as more comes in while you're at the end of it
  const atEnd = useRef(true)
  const flip = (key: string) => {
    atEnd.current = false // what you just opened stays where it is
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const people = [...new Set(rows.flatMap((e) => [e.from, e.to]).filter((n): n is string => Boolean(n) && n !== 'you').map(familyOf))]
  const target = !root ? '' : root.from === 'you' ? (root.to ?? '') : root.from
  const offline = client && link.status === 'offline' ? offlineText(link, client.macName) : ''
  const disabled = !client ? 'Pair with your computer to send' : offline ? `Can't send: ${client.macName} is offline` : link.status === 'connecting' || !state ? `Connecting to ${client.macName}…` : null

  const row = ({ item: e }: { item: FeedEntry }) => {
    const mine = e.from === 'you'
    const line = e.gist ?? (e.text ?? '').split('\n')[0]
    const extra = echoes.get(e.id) ?? []
    const opens = !mine && (line !== (e.text ?? '').trim() || extra.length > 0)
    const whole = mine || open.has(e.id)
    const head = (
      <View style={styles.head}>
        <Text style={[styles.names, { color: t.fg2 }]} numberOfLines={1}>
          <Text style={{ color: t.fg, fontWeight: '600' }}>{mine ? 'You' : say(e.from)}</Text>
          {e.kind === 'msg' && e.to && !mine ? ` to ${say(e.to)}` : ''}
          {e.kind === 'note' ? ' shared a note' : ''}
          {e.kind === 'ask' ? ' asks you' : ''}
          {e.held && !e.dropped ? ' · waiting for your OK' : ''}
          {e.queued ? ' · queued' : ''}
          {e.dropped ? ' · dropped' : ''}
          {e.asks ? ' · asks you' : ''}
        </Text>
        <Text style={[styles.time, { color: t.fg3 }]}>{clock(e.ts)}</Text>
      </View>
    )
    const body = whole ? (
      <>
        <Markdown text={e.text ?? ''} t={t} color={t.fg} size={15} />
        {extra.map((x) => (
          <View key={x.id} style={[styles.echo, { borderLeftColor: t.lineStrong }]}>
            <Text style={[styles.echoHead, { color: t.fg3 }]}>Also said</Text>
            <Markdown text={x.text ?? ''} t={t} color={t.fg2} size={14} />
          </View>
        ))}
      </>
    ) : (
      <Text style={[styles.line, { color: t.fg2 }]} numberOfLines={3}>
        {line || (e.kind === 'ask' ? 'Has a question for you in the chat' : '')}
      </Text>
    )
    const face = mine ? (
      <View style={[styles.you, { backgroundColor: t.fill }]}>
        <Icon name="person" size={14} color={t.fg2} />
      </View>
    ) : (
      <Creature agent={someone(e.from, d.byName)} size={26} mood="still" />
    )
    const inner = (
      <>
        <View style={styles.gutter}>{face}</View>
        <View style={styles.main}>
          {head}
          {body}
        </View>
      </>
    )
    if (e.kind === 'ask') return <Press onPress={() => router.push({ pathname: '/ask/[id]', params: { id: e.id } })} style={styles.row} accessibilityRole="button" accessibilityLabel={`${say(e.from)} asks you something. Open it`}>{inner}</Press>
    return opens ? (
      <Pressable onPress={() => flip(e.id)} style={styles.row} accessibilityRole="button" accessibilityState={{ expanded: whole }} accessibilityLabel={`${say(e.from)}: ${line}`}>
        {inner}
      </Pressable>
    ) : (
      <View style={styles.row}>{inner}</View>
    )
  }

  return (
    <View style={[styles.screen, { backgroundColor: t.page }]}>
      <TopBar background={t.page}>
        <Press onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to the chat" hitSlop={8}>
          <Icon name="back" size={20} color={t.fg} weight="semibold" />
        </Press>
        <View style={styles.title}>
          <Text style={[styles.titleText, { color: t.fg, fontFamily: fonts.brand }]}>Thread</Text>
          <Text style={[styles.sub, { color: t.fg2 }]} numberOfLines={1}>
            {plural(hidden, 'message')}
            {people.length ? ` · ${people.map(say).join(', ')}` : ''}
          </Text>
        </View>
      </TopBar>
      <View style={[styles.hair, { backgroundColor: t.line }]} />
      <FlatList
        ref={list}
        style={styles.list}
        onContentSizeChange={() => {
          if (atEnd.current) list.current?.scrollToEnd({ animated: false })
        }}
        onScroll={({ nativeEvent: n }) => {
          atEnd.current = n.contentSize.height - n.contentOffset.y - n.layoutMeasurement.height < 60
        }}
        scrollEventThrottle={32}
        data={rows}
        keyExtractor={(e) => e.id}
        extraData={open}
        renderItem={row}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={[styles.gone, { color: t.fg2 }]}>{state ? 'This thread is older than what the chat keeps.' : 'Waiting for your computer…'}</Text>}
        contentContainerStyle={styles.listInner}
      />
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        {client ? (
          <Composer
            t={t}
            background={t.page}
            agents={d.agents}
            convo={target || null}
            channel={null}
            place={`${ws}~${id}`}
            disabled={disabled}
            onSend={(text) => {
              atEnd.current = true
              return client.send(target, text, { ...(rows.at(-1) && { re: rows.at(-1)!.id }), thread: String(id), ...(root?.channel && { channel: root.channel }) })
            }}
          />
        ) : null}
        <View style={{ height: insets.bottom, backgroundColor: t.page }} />
      </KeyboardStickyView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { width: 40, height: 44, marginLeft: -8, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 0 },
  titleText: { fontSize: 18, lineHeight: 22 },
  sub: { fontSize: 13, lineHeight: 17 },
  hair: { height: StyleSheet.hairlineWidth },
  list: { flex: 1 },
  listInner: { paddingVertical: 6 },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  gutter: { width: 28, alignItems: 'center', paddingTop: 1 },
  main: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 1 },
  names: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19 },
  time: { fontSize: 12 },
  line: { fontSize: 15, lineHeight: 21 },
  you: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  echo: { marginTop: 8, paddingLeft: 10, borderLeftWidth: 2 },
  echoHead: { fontSize: 12, lineHeight: 16 },
  gone: { padding: 24, fontSize: 15, textAlign: 'center' },
})

// The chat: everyone's messages, or your conversation with one agent (tap a face, or the faces at the top right).
// Questions waiting for you sit in a stack at the top; who's at work shows under the last message; the message box is
// at the bottom. Everything else gives way to reading: one line of header, no bubbles on agents' words, the faces row
// only while you type.
import * as Clipboard from 'expo-clipboard'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ActionSheetIOS, Alert, AppState, FlatList, Platform, Share, StyleSheet, Text, View, type ListViewToken } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { KeyboardChatScrollView, KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Agent, FeedEntry, Reply } from '@/net/types'
import { familyOf, isUnread, useCrew, useDerived, type Derived } from '@/state/hooks'
import { openConvo, useConvo } from '@/state/convo'
import { session } from '@/state/session'
import { agentColor } from '@/ui/avatar'
import { nameInk } from '@/ui/color'
import { Composer } from '@/ui/composer'
import { Creature } from '@/ui/creature'
import { Deck } from '@/ui/deck'
import { FeedItem, type FeedCtx } from '@/ui/feed'
import { displayName, plural, rowLine } from '@/ui/format'
import { useNow } from '@/ui/hooks'
import { Icon } from '@/ui/icon'
import { Button, Faces, inkFor, Press, thud } from '@/ui/parts'
import { needsOf } from '@/ui/room'
import { offlineText, TopBar } from '@/ui/topbar'
import { fonts, useTheme, type Theme } from '@/ui/theme'

// A multi-recipient send is one bubble (core/hub.js sendId): the first copy stands for the rest.
function mergeSends(feed: FeedEntry[]) {
  const shown: FeedEntry[] = []
  const byId = new Map<string, FeedEntry>()
  const lead = new Map<string, FeedEntry>()
  for (const e of feed) {
    const first = e.from === 'you' && e.sendId ? lead.get(e.sendId) : undefined
    if (first) {
      if (e.queued) first.queued = true
      byId.set(e.id, first)
      continue
    }
    const x = e.from === 'you' && e.sendId ? { ...e } : e
    if (e.from === 'you' && e.sendId) lead.set(e.sendId, x)
    shown.push(x)
    byId.set(e.id, x)
  }
  return { shown, byId }
}

// What belongs in an agent's conversation: what you two said, its questions, its hand-offs, its tasks and events.
function inConvo(e: FeedEntry, name: string) {
  const its = (n?: string) => Boolean(n) && familyOf(n!) === name
  if (e.kind === 'task' || e.kind === 'bug') return its(e.from) || its(e.owner) || ((e.act === 'triaged' || e.act === 'fixing') && its(e.text))
  return its(e.from) || its(e.to) || (e.cc ?? []).some(its)
}

// Marking replies read as they're seen: collected while they're on screen (the chat in front, the app in the
// foreground), sent to the Mac a moment later, for the workspace they were seen in. What was last on screen is kept,
// so coming back to the chat counts it as seen (the list doesn't report items that never left).
const reader = (() => {
  let seen = new Map<string, Record<string, number>>() // workspace -> { agent: ts }
  let visible: FeedEntry[] = []
  let focused = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    const client = session.client
    const batch = seen
    seen = new Map()
    if (!client) return
    const snap = client.getSnapshot()
    for (const [ws, marks] of batch) {
      const reads = ws === snap.shown ? snap.state?.reads : undefined
      // a plain name reads every channel: sent while any channel's mark for it is behind
      const behind = (n: string) => Math.min(reads?.agents?.[n] ?? 0, ...Object.values(reads?.channels ?? {}).map((book) => book[n] ?? 0))
      const fresh = Object.fromEntries(Object.entries(marks).filter(([n, ts]) => ts > Math.max(reads?.since ?? 0, behind(n))))
      if (Object.keys(fresh).length) void client.read(fresh, ws).catch(() => {})
    }
  }
  const see = () => {
    if (!focused || AppState.currentState !== 'active') return
    const ws = session.client?.getSnapshot().shown
    if (!ws) return
    const marks = seen.get(ws) ?? {}
    for (const e of visible) if (e.kind === 'reply' && e.from !== 'you') marks[e.from] = Math.max(marks[e.from] ?? 0, e.ts)
    seen.set(ws, marks)
    if (!timer) timer = setTimeout(flush, 700)
  }
  return {
    focus(on: boolean) {
      focused = on
      if (on) see()
    },
    show(items: FeedEntry[]) {
      visible = items
      see()
    },
  }
})()

function Working({ t, d, here, now }: { t: Theme; d: Derived; here: string | null; now: number }) {
  const busy = [...d.byName.values()].filter((a) => a.on && (a.status === 'working' || (a.cloneOf && a.status === 'starting')) && (!here || familyOf(a.name) === here))
  if (!busy.length) return <View style={{ height: 10 }} />
  const shown = busy.slice(0, busy.length > 4 ? 3 : 4)
  const rest = busy.slice(shown.length)
  return (
    <View style={styles.working}>
      {shown.map((a) => {
        const line = rowLine(a, now)
        return (
          <Press key={a.name} style={styles.workRow} onPress={() => router.push({ pathname: '/agent/[name]', params: { name: a.cloneOf ?? a.name } })} accessibilityLabel={`${a.name} ${line.text}`}>
            <Creature agent={a} size={22} />
            <Text style={[styles.workName, { color: nameInk(agentColor(a), t.fg) }]}>{displayName(a.name).base}</Text>
            <Text style={[styles.workWhat, { color: inkFor(t, line.kind) === t.fg2 ? t.fg2 : t.fg2, fontFamily: line.mono ? fonts.mono : undefined, fontSize: line.mono ? 12.5 : 13.5 }]} numberOfLines={1}>
              {line.text}
            </Text>
          </Press>
        )
      })}
      {rest.length ? (
        <View style={styles.workRow}>
          <Faces faces={rest} size={20} max={6} />
          <Text style={[styles.workWhat, { color: t.fg3 }]}>{plural(rest.length, 'more', 'more')} at work</Text>
        </View>
      ) : null}
    </View>
  )
}

// Who's at work and who needs you, in a few plain words, for the line under the workspace's name. Who needs you
// counts the way the Crew tab does: an agent once, with its clones.
function Summary({ t, d, parked }: { t: Theme; d: Derived; parked: boolean }) {
  if (parked) return <Text>Asleep</Text>
  const needing = needsOf(d.agents, d.open, [...d.byName.values()]).length
  const bits = [needing ? { text: (needing === 1 ? '1 needs' : needing + ' need') + ' you', ink: t.waitingInk } : null, d.working ? { text: d.working + ' at work', ink: t.fg2 } : null].filter((x): x is { text: string; ink: string } => Boolean(x))
  if (!bits.length && d.agents.length) bits.push({ text: d.agents.some((a) => a.on) ? 'Everyone is idle' : 'Everyone is off', ink: t.fg2 })
  return (
    <>
      {bits.map((b, i) => (
        <Text key={b.text} style={{ color: b.ink }}>
          {i ? ', ' : ''}
          {b.text}
        </Text>
      ))}
    </>
  )
}

// In a conversation with one agent, the header is that agent: back to everyone on the left, then who it is and what
// it's doing (tap for its sheet).
function WithAgent({ t, d, here, onAll }: { t: Theme; d: Derived; here: Agent; onAll: () => void }) {
  const now = useNow(30000)
  const line = rowLine(here, now)
  const elsewhere = [...d.unread.entries()].filter(([n]) => n !== here.name).reduce((n, [, x]) => n + x, 0)
  return (
    <View style={styles.with}>
      <Press onPress={onAll} style={[styles.back, { backgroundColor: t.fill }]} accessibilityRole="button" accessibilityLabel={`Back to everyone's messages${elsewhere ? `, ${elsewhere} new` : ''}`} hitSlop={8}>
        <Icon name="back" size={16} color={t.fg} weight="semibold" />
        {elsewhere ? (
          <View style={[styles.backBadge, { backgroundColor: t.accent, borderColor: t.page }]}>
            <Text style={styles.backBadgeText}>{elsewhere > 9 ? '9+' : elsewhere}</Text>
          </View>
        ) : null}
      </Press>
      <Press onPress={() => router.push({ pathname: '/agent/[name]', params: { name: here.name } })} style={styles.convo} accessibilityRole="button" accessibilityLabel={`${here.name}, ${line.text}. Open`}>
        <Creature agent={here} size={34} />
        <View style={{ flexShrink: 1 }}>
          <Text style={[styles.convoName, { color: nameInk(agentColor(here), t.fg) }]} numberOfLines={1}>
            {displayName(here.name).base}
          </Text>
          <Text style={[styles.convoLine, { color: inkFor(t, line.kind), fontFamily: line.mono ? fonts.mono : undefined }]} numberOfLines={1}>
            {line.text}
          </Text>
        </View>
      </Press>
    </View>
  )
}

// The crew's faces at the top right: the list of conversations, one per agent.
function People({ t, d }: { t: Theme; d: Derived }) {
  const faces = [...d.agents].filter((a) => a.on).sort((x, y) => (d.unread.get(y.name) ?? 0) - (d.unread.get(x.name) ?? 0))
  if (!d.agents.length) return null
  return (
    <Press onPress={() => router.push('/convos')} style={[styles.people, { backgroundColor: t.fill }]} accessibilityRole="button" accessibilityLabel="Conversations: talk to one agent" hitSlop={6}>
      <Faces faces={faces.length ? faces : d.agents} size={24} max={3} />
      <Icon name="down" size={11} color={t.fg2} weight="bold" />
    </Press>
  )
}

export default function ChatScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { client, link, state, ws, switching } = useCrew()
  const d = useDerived(state)
  const convo = useConvo()
  useFocusEffect(
    useCallback(() => {
      reader.focus(true)
      return () => reader.focus(false)
    }, []),
  )
  // inside the native tabs, the bottom inset is the tab bar's top: content runs under the bar
  const tabH = insets.bottom
  const list = useRef<FlatList<FeedEntry>>(null)
  const [away, setAway] = useState(false) // scrolled back from the latest
  const here = convo ? (d.byName.get(convo) ?? null) : null
  const offline = client && link.status === 'offline' ? offlineText(link, client.macName) : ''
  const disabled = !client ? 'Pair with your computer to send' : offline ? `Can't send: ${client.macName} is offline` : link.status === 'connecting' || !state ? `Connecting to ${client.macName}…` : switching ? `Opening ${state.workspaces?.find((w) => w.id === ws)?.name ?? 'the workspace'}…` : null

  const { items, byId } = useMemo(() => {
    const merged = mergeSends((state?.feed ?? []).filter((e) => !(e as FeedEntry & { answers?: unknown }).answers))
    const shown = here ? merged.shown.filter((e) => inConvo(e, here.name)) : merged.shown
    return { items: shown.slice(-200).reverse(), byId: merged.byId }
  }, [state?.feed, here])
  const unread = useMemo(() => new Set(items.filter((e) => isUnread(e, state?.reads)).map((e) => e.id)), [items, state?.reads])
  const divider = items.findLast((e) => unread.has(e.id))?.id ?? null
  const open = here ? d.open.filter((e) => familyOf(e.from) === here.name) : d.open

  const answer = useCallback((id: string, reply: Reply) => client!.answer(id, reply), [client])
  const ctx: FeedCtx = {
    t,
    byName: d.byName,
    byId,
    here: here?.name ?? null,
    unread,
    divider,
    onFace: (name) => openConvo(name),
    onAsk: (id) => router.push({ pathname: '/ask/[id]', params: { id } }),
    onHeld: (id, how) => void (how === 'approve' ? client?.approve(id) : client?.drop(id))?.catch(() => {}),
    onLong: (e) => {
      const text = e.ticket !== undefined && !e.text ? `#${String(e.ticket).split('@')[0]} ${e.title ?? ''}` : (e.text ?? '')
      if (!text) return
      thud()
      const who = e.from !== 'you' && !here && d.byName.has(familyOf(e.from)) ? familyOf(e.from) : null
      const actions: [string, () => void][] = [
        ['Copy', () => void Clipboard.setStringAsync(text)],
        ['Share…', () => void Share.share({ message: text }).catch(() => {})],
        ...(who ? ([[`Talk to ${displayName(who).base}`, () => openConvo(who)]] as [string, () => void][]) : []),
      ]
      if (Platform.OS === 'ios')
        ActionSheetIOS.showActionSheetWithOptions({ options: [...actions.map(([l]) => l), 'Cancel'], cancelButtonIndex: actions.length }, (i) => actions[i]?.[1]())
      else Alert.alert(e.from === 'you' ? 'Your message' : displayName(e.from).base, undefined, [...actions.map(([text, onPress]) => ({ text, onPress })), { text: 'Cancel', style: 'cancel' as const }])
    },
    canAct: !disabled,
  }
  const now = useNow(30000)

  // the FlatList wants this callback to stay the same for its whole life
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: (ListViewToken & { item?: FeedEntry })[] }) => {
    reader.show(viewableItems.map((v) => v.item).filter((x): x is FeedEntry => Boolean(x)))
  })

  if (!client) {
    return (
      <View style={[styles.empty, { backgroundColor: t.page, paddingTop: insets.top }]}>
        <Text style={[styles.emptyTitle, { color: t.fg }]}>No computer yet</Text>
        <Text style={[styles.emptyText, { color: t.fg2 }]}>Pair this phone with your computer, or look around the demo crew.</Text>
        <Button t={t} kind="primary" title="Pair with your computer" onPress={() => router.push('/pair')} />
      </View>
    )
  }

  return (
    <View style={[styles.screen, { backgroundColor: t.page }]}>
      <TopBar
        t={t}
        background={t.page}
        sub={<Summary t={t} d={d} parked={Boolean(state?.parked)} />}
        left={here ? <WithAgent t={t} d={d} here={here} onAll={() => openConvo(null)} /> : undefined}
        right={here ? undefined : <People t={t} d={d} />}
      />
      <View style={[styles.hair, { backgroundColor: t.line }]} />
      <Deck t={t} open={open} byName={d.byName} onAnswer={answer} disabled={offline ? `Answering waits until ${client.macName} is back` : null} />
      <View style={styles.list}>
        <FlatList
          ref={list}
          style={styles.list}
          data={state ? items : []}
          inverted
          keyExtractor={(e) => e.id}
          renderItem={({ item, index }) => <FeedItem e={item} prev={items[index + 1]} c={ctx} />}
          renderScrollComponent={(props) => <KeyboardChatScrollView {...props} inverted offset={tabH} />}
          ListHeaderComponent={<Working t={t} d={d} here={here?.name ?? null} now={now} />}
          ListEmptyComponent={
            <View style={styles.listEmpty}>
              {here && state ? <Creature agent={here} size={64} /> : null}
              <Text style={[styles.emptyText, { color: t.fg3 }]}>{!state ? (offline ? offline : `Connecting to ${client.macName}…`) : here ? `Nothing with ${displayName(here.name).base} yet. Say hi.` : 'Nothing here yet. Say hi to your crew.'}</Text>
            </View>
          }
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 30, minimumViewTime: 600 }}
          onScroll={(ev) => setAway(ev.nativeEvent.contentOffset.y > 560)}
          scrollEventThrottle={100}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listInner}
        />
        {/* what scrolls up under the header or the questions fades out in a few points instead of being cut mid-line */}
        <View pointerEvents="none" style={styles.edge}>
          {Array.from({ length: 7 }, (_, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: t.page, opacity: (1 - i / 7) ** 1.4 }} />
          ))}
        </View>
        {away ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.latestWrap} pointerEvents="box-none">
            <Press onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} style={[styles.latest, { backgroundColor: t.surface, borderColor: t.lineStrong }]} accessibilityRole="button" accessibilityLabel="Go to the latest message" hitSlop={8}>
              <Icon name="latest" size={16} color={t.fg} weight="semibold" />
            </Press>
          </Animated.View>
        ) : null}
      </View>
      <KeyboardStickyView offset={{ closed: 0, opened: tabH }}>
        <Composer t={t} background={t.page} agents={d.agents} convo={here?.name ?? null} unread={d.unread} disabled={disabled} onFace={(n) => openConvo(n)} onSend={(text) => client.send(here?.name ?? '', text)} />
      </KeyboardStickyView>
      <View style={{ height: tabH, backgroundColor: t.page }} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hair: { height: StyleSheet.hairlineWidth },
  list: { flex: 1 },
  listInner: { paddingBottom: 8 },
  edge: { position: 'absolute', left: 0, right: 0, top: 0, height: 14 },
  listEmpty: { paddingVertical: 40, paddingHorizontal: 32, alignItems: 'center', gap: 12, transform: [{ scaleY: -1 }] },
  with: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backBadge: { position: 'absolute', right: -5, top: -4, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  backBadgeText: { color: '#fff', fontSize: 10.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  convo: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  convoName: { fontSize: 17, lineHeight: 21, fontWeight: '600' },
  convoLine: { fontSize: 13, lineHeight: 17 },
  people: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingLeft: 6, paddingRight: 9, borderRadius: 18 },
  latestWrap: { position: 'absolute', left: 0, right: 0, bottom: 10, alignItems: 'center' },
  latest: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  working: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, gap: 8 },
  workRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  workName: { fontSize: 15, fontWeight: '600' },
  workWhat: { flex: 1, fontSize: 13.5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 22, fontWeight: '800' },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
})

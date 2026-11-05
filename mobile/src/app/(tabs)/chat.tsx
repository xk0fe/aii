// The chat, as in Discord: one channel of the workspace (or your conversation with one agent) on top, and under it,
// a swipe from the left edge (or ☰) away, the list: the workspaces as a rail, the channels and a conversation with
// each agent. Questions waiting for you sit in a stack at the top; who's at work shows under the last message; the
// message box is at the bottom.
import * as Clipboard from 'expo-clipboard'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActionSheetIOS, Alert, AppState, BackHandler, FlatList, Keyboard, Platform, Pressable, Share, StyleSheet, Text, useWindowDimensions, View, type ListViewToken } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { KeyboardChatScrollView, KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Agent, Channel, FeedEntry, Reply } from '@/net/types'
import { channelOf, familyOf, GENERAL, isUnread, membersOf, useCrew, useDerived, type Derived } from '@/state/hooks'
import { openChannel, openConvo, useConvo, usePickedChannel } from '@/state/convo'
import { session } from '@/state/session'
import { agentColor } from '@/ui/avatar'
import { nameInk } from '@/ui/color'
import { Composer } from '@/ui/composer'
import { Creature } from '@/ui/creature'
import { Deck } from '@/ui/deck'
import { Drawer } from '@/ui/drawer'
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
  let seen = new Map<string, Record<string, number>>() // workspace -> { 'agent#channel': ts }
  let visible: FeedEntry[] = []
  let focused = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    const client = session.client
    const batch = seen
    seen = new Map()
    if (!client) return
    for (const [ws, marks] of batch) if (Object.keys(marks).length) void client.read(marks, ws).catch(() => {})
  }
  const see = () => {
    if (!focused || AppState.currentState !== 'active') return
    const snap = session.client?.getSnapshot()
    const ws = snap?.shown
    if (!ws) return
    const marks = seen.get(ws) ?? {}
    // each reply is read in its own channel, as on the computer: 'ada#ship', 'ada#general' (a computer that sends no
    // channels may not know those: it gets the plain name)
    for (const e of visible) {
      if (!isUnread(e, snap?.state?.reads)) continue
      const key = snap?.state?.channels ? `${e.from}#${e.channel || GENERAL}` : e.from
      marks[key] = Math.max(marks[key] ?? 0, e.ts)
    }
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

// chan: in a channel, who's at work on something said there
function Working({ t, d, here, chan, now }: { t: Theme; d: Derived; here: string | null; chan: string | null; now: number }) {
  const busy = [...d.byName.values()].filter((a) => a.on && (a.status === 'working' || (a.cloneOf && a.status === 'starting')) && (here ? familyOf(a.name) === here : !chan || channelOf(a, d.channels ?? undefined) === chan))
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
function summary(t: Theme, d: Derived, parked: boolean) {
  if (parked) return <Text>Asleep</Text>
  const needing = needsOf(d.agents, d.open, [...d.byName.values()]).length
  const bits = [needing ? { text: (needing === 1 ? '1 needs' : needing + ' need') + ' you', ink: t.waitingInk } : null, d.working ? { text: d.working + ' at work', ink: t.fg2 } : null].filter((x): x is { text: string; ink: string } => Boolean(x))
  if (!bits.length && d.agents.length) bits.push({ text: d.agents.some((a) => a.on) ? 'Everyone is idle' : 'Everyone is off', ink: t.fg2 })
  if (!bits.length) return null
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

// ☰: the list (the workspaces, the channels, a conversation with each agent), with a dot when something's new there.
function Menu({ t, dot, label, onPress }: { t: Theme; dot: string | null; label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={[styles.menu, { backgroundColor: t.fill }]} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}>
      <Icon name="menu" size={17} color={t.fg} weight="semibold" />
      {dot ? <View style={[styles.menuDot, { backgroundColor: dot, borderColor: t.page }]} /> : null}
    </Press>
  )
}

// The header: ☰, then where you are. A channel: its name, and under it the computer's state or the workspace and who's
// at work (tap for the channel's sheet). A conversation: the agent and what it's doing (tap for its sheet).
function Where({ t, d, here, channel, title, sub, link, menu }: { t: Theme; d: Derived; here: Agent | null; channel: Channel | null; title: string; sub: ReactNode; link: string; menu: ReactNode }) {
  const now = useNow(30000)
  if (here) {
    // while the computer can't be reached, what it was doing is old news: the line says so instead
    const line = link ? { text: link, kind: 'waiting', mono: false } : rowLine(here, now)
    return (
      <View style={styles.with}>
        {menu}
        <Press onPress={() => router.push({ pathname: '/agent/[name]', params: { name: here.name } })} style={styles.convo} accessibilityRole="button" accessibilityLabel={`${here.name}, ${line.text}. Open`}>
          <Creature agent={here} size={32} />
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
  const status = link ? <Text style={{ color: t.waitingInk }}>{link}</Text> : sub
  return (
    <View style={styles.with}>
      {menu}
      <Press onPress={channel ? () => router.push({ pathname: '/channel', params: { id: channel.id } }) : undefined} style={styles.convo} accessibilityRole="button" accessibilityLabel={channel ? `#${channel.name}: its brief and who's in it` : title}>
        <View style={{ flexShrink: 1 }}>
          <Text style={[styles.convoName, { color: t.fg }]} numberOfLines={1}>
            {channel ? (
              <>
                <Text style={{ color: t.fg3 }}># </Text>
                {channel.name}
              </>
            ) : (
              title
            )}
          </Text>
          <Text style={[styles.convoLine, { color: t.fg2 }]} numberOfLines={1}>
            {status}
          </Text>
        </View>
      </Press>
    </View>
  )
}

// A channel's people at the top right: its members' faces, which open the channel (its brief, who's in it, Edit).
function Members({ t, d, c }: { t: Theme; d: Derived; c: Channel }) {
  const who = membersOf(c, d.agents)
  return (
    <Press onPress={() => router.push({ pathname: '/channel', params: { id: c.id } })} style={[styles.people, { backgroundColor: t.fill }]} accessibilityRole="button" accessibilityLabel={`#${c.name}: its brief and who's in it`} hitSlop={6}>
      {who.length ? <Faces faces={who.filter((a) => a.on).length ? who.filter((a) => a.on) : who} size={24} max={3} /> : null}
      <Text style={[styles.peopleCount, { color: t.fg2 }]}>{who.length}</Text>
    </Press>
  )
}

// The top of a channel's history: what it's for (its brief) and who's in it.
function Intro({ t, d, c }: { t: Theme; d: Derived; c: Channel }) {
  const who = membersOf(c, d.agents)
  return (
    <Press onPress={() => router.push({ pathname: '/channel', params: { id: c.id } })} style={[styles.intro, { borderColor: t.line }]} accessibilityRole="button" accessibilityLabel={`The start of #${c.name}. ${c.brief ?? 'No brief yet'}. Open the channel`}>
      <View style={[styles.introMark, { backgroundColor: t.fill }]}>
        <Text style={[styles.introHash, { color: t.fg2 }]}>#</Text>
      </View>
      <Text style={[styles.introTitle, { color: t.fg }]}>This is the start of #{c.name}</Text>
      <Text style={[styles.introText, { color: c.brief ? t.fg : t.fg2 }]}>{c.brief ?? (c.id === GENERAL ? 'Everyone in the workspace, everything that has no channel of its own.' : 'No brief yet. Give it one to tell its agents how to work here.')}</Text>
      {c.brief ? <Text style={[styles.introNote, { color: t.fg2 }]}>Each agent reads this brief with its first message here, and again if you change it.</Text> : null}
      <View style={styles.introWho}>
        <Faces faces={who} size={22} max={6} />
        <Text style={[styles.introNote, { color: t.fg2 }]} numberOfLines={1}>
          {c.members ? who.map((a) => displayName(a.name).base).join(', ') : 'Everyone in this workspace'}
        </Text>
      </View>
    </Press>
  )
}

export default function ChatScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { client, link, state, ws, shown, switching } = useCrew()
  const d = useDerived(state)
  const convo = useConvo()
  // the workspace `state` is of: while switching, the one still on screen
  const space = shown ?? ws
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
  // the channel on screen (null: the Mac sends none, so it's one chat); a conversation with an agent spans them all
  const chan = usePickedChannel(space, d.channels?.map((c) => c.id) ?? null)
  const channel = d.channels?.find((c) => c.id === chan) ?? null
  const inChannel = !here && channel ? channel : null
  const offline = client && link.status === 'offline' ? offlineText(link, client.macName) : ''
  const disabled = !client ? 'Pair with your computer to send' : offline ? `Can't send: ${client.macName} is offline` : link.status === 'connecting' || !state ? `Connecting to ${client.macName}…` : switching ? `Opening ${state.workspaces?.find((w) => w.id === ws)?.name ?? 'the workspace'}…` : null

  const { items, byId } = useMemo(() => {
    const merged = mergeSends((state?.feed ?? []).filter((e) => !(e as FeedEntry & { answers?: unknown }).answers))
    const shown = here ? merged.shown.filter((e) => inConvo(e, here.name)) : chan ? merged.shown.filter((e) => channelOf(e, d.channels ?? undefined) === chan) : merged.shown
    return { items: shown.slice(-200).reverse(), byId: merged.byId }
  }, [state?.feed, here, chan, d.channels])
  const unread = useMemo(() => new Set(items.filter((e) => isUnread(e, state?.reads)).map((e) => e.id)), [items, state?.reads])
  const divider = items.findLast((e) => unread.has(e.id))?.id ?? null
  const open = here ? d.open.filter((e) => familyOf(e.from) === here.name) : chan ? d.open.filter((e) => channelOf(e, d.channels ?? undefined) === chan) : d.open
  // what's new or waiting where you aren't: the other channels, your conversations, the other workspaces (a dot on ☰)
  const others = (state?.workspaces ?? []).filter((w) => w.id !== space)
  const needsElsewhere = (d.channels ?? []).filter((c) => here || c.id !== chan).reduce((n, c) => n + (d.needsIn.get(c.id) ?? 0), 0) + others.reduce((n, w) => n + (w.waiting ?? 0), 0)
  const newElsewhere = (d.channels ?? []).filter((c) => here || c.id !== chan).reduce((n, c) => n + (d.unreadIn.get(c.id) ?? 0), 0) + others.reduce((n, w) => n + (w.unread ?? 0), 0)

  // the list under the chat: the chat slides right to show it, and back
  const { width } = useWindowDimensions()
  const W = width - 60 // what the list takes; the chat stays in sight at the right edge
  const p = useSharedValue(0) // how far out the list is, 0 to 1 (not points: the width can change while it's out)
  const from = useSharedValue(0)
  const [listed, setListed] = useState(false)
  const settle = (to: boolean) => {
    if (to) Keyboard.dismiss()
    setListed(to)
  }
  const slide = (to: boolean) => {
    settle(to)
    p.set(withTiming(to ? 1 : 0, MOVE))
  }
  const onBegin = () => {
    'worklet'
    from.set(p.get())
  }
  const onUpdate = (e: { translationX: number }) => {
    'worklet'
    p.set(Math.min(1, Math.max(0, from.get() + e.translationX / W)))
  }
  const onDeactivate = (e: { velocityX: number }) => {
    'worklet'
    const to = e.velocityX > 500 || (e.velocityX > -500 && p.get() > 0.5)
    p.set(withTiming(to ? 1 : 0, MOVE))
    scheduleOnRN(settle, to)
  }
  // From the chat while it's in front: a swipe to the right, anywhere, as in Discord (not from the very edge, which
  // Android keeps for its Back gesture). Sideways scrollers (code, tables, the faces row) keep their own drags.
  const chatSwipe = usePanGesture({ activeOffsetX: listed ? [-14, 14] : 14, failOffsetY: [-12, 12], onBegin, onUpdate, onDeactivate })
  const listSwipe = usePanGesture({ activeOffsetX: [-14, 14], failOffsetY: [-12, 12], enabled: listed, onBegin, onUpdate, onDeactivate })
  // get() and set() rather than the value property, which the React Compiler would read during render to compare
  const chatMoves = useAnimatedStyle(() => ({ transform: [{ translateX: p.get() * W }] }))
  const listMoves = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * p.get(), transform: [{ translateX: (p.get() - 1) * W * 0.12 }] }))
  useFocusEffect(
    useCallback(() => {
      if (!listed) return
      const sub = BackHandler.addEventListener('hardwareBackPress', () => (slide(false), true))
      return () => sub.remove()
    }, [listed, slide]),
  )
  const go = (fn: () => void) => {
    fn()
    slide(false)
  }

  const answer = useCallback((id: string, reply: Reply) => client!.answer(id, reply), [client])
  const ctx: FeedCtx = {
    t,
    byName: d.byName,
    byId,
    here: here?.name ?? null,
    channels: here ? (d.channels ?? null) : null,
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
      // Android's dialog holds three buttons at most, so there's no Cancel: tapping outside it (or Back) closes it
      else Alert.alert(e.from === 'you' ? 'Your message' : displayName(e.from).base, undefined, actions.map(([text, onPress]) => ({ text, onPress })), { cancelable: true })
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

  // the computer has no workspace yet (they're made there): it shows up here as soon as it does
  if (state && !state.workspace) {
    return (
      <View style={[styles.empty, { backgroundColor: t.page, paddingTop: insets.top }]}>
        <Text style={[styles.emptyTitle, { color: t.fg }]}>No workspaces yet</Text>
        <Text style={[styles.emptyText, { color: t.fg2 }]}>Make your first one on {client.macName}, and it shows up here.</Text>
      </View>
    )
  }

  const wsName = state?.workspaces?.find((w) => w.id === space)?.name ?? state?.workspace?.name ?? ''
  const linkLine = offline || (link.status === 'connecting' && !client.demo ? `Connecting to ${client.macName}…` : '')
  const sum = state ? summary(t, d, Boolean(state.parked)) : null
  const menu = (
    <Menu
      t={t}
      dot={needsElsewhere ? t.waitingInk : newElsewhere ? t.accent : null}
      label={`Channels and conversations${needsElsewhere ? `, ${needsElsewhere} waiting for you elsewhere` : newElsewhere ? `, ${newElsewhere} new elsewhere` : ''}`}
      onPress={() => slide(true)}
    />
  )

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      {/* closed, the list is out of reach for screen readers too; open, the chat behind it is (all but the way back) */}
      <Animated.View style={[StyleSheet.absoluteFill, listMoves]} pointerEvents={listed ? 'auto' : 'none'} accessibilityElementsHidden={!listed} importantForAccessibility={listed ? 'auto' : 'no-hide-descendants'}>
        <GestureDetector gesture={listSwipe}>
          <View style={StyleSheet.absoluteFill}>
            <Drawer
              t={t}
              d={d}
              workspaces={state?.workspaces ?? []}
              ws={space}
              going={switching ? ws : null}
              title={wsName}
              summary={sum}
              here={here?.name ?? null}
              chan={chan}
              now={now}
              link={link}
              mac={client.macName}
              demo={Boolean(client.demo)}
              offline={Boolean(offline)}
              switching={switching}
              onWorkspace={(id) => {
                // the one on screen: back to it (and, mid-switch, it's the one that stays)
                if (id === space) {
                  if (switching) void session.watch(id).catch(() => {})
                  return slide(false)
                }
                // another workspace: its channels, not a conversation with someone who may not be there
                void session
                  .watch(id)
                  .then(() => openConvo(null))
                  .catch((e: Error) => Alert.alert(`Couldn't open it`, String(e?.message ?? e)))
              }}
              onChannel={(id) => go(() => openChannel(space, id))}
              onAgent={(name) => go(() => openConvo(name))}
              onNewChannel={() => go(() => router.push('/channel'))}
              onComputer={() => go(() => router.navigate('/settings'))}
            />
          </View>
        </GestureDetector>
      </Animated.View>
      <GestureDetector gesture={chatSwipe}>
      <Animated.View style={[styles.screen, styles.chat, { backgroundColor: t.page }, chatMoves]}>
      <View style={styles.screen} accessibilityElementsHidden={listed} importantForAccessibility={listed ? 'no-hide-descendants' : 'auto'}>
      <TopBar t={t} background={t.page} left={<Where t={t} d={d} here={here} channel={inChannel} title={wsName} sub={inChannel ? <>{wsName}{sum ? <Text style={{ color: t.fg3 }}>{'  ·  '}</Text> : null}{sum}</> : sum} link={linkLine} menu={menu} />} right={inChannel ? <Members t={t} d={d} c={inChannel} /> : undefined} />
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
          ListHeaderComponent={<Working t={t} d={d} here={here?.name ?? null} chan={here ? null : chan} now={now} />}
          ListFooterComponent={inChannel && state && items.length ? <Intro t={t} d={d} c={inChannel} /> : undefined}
          ListEmptyComponent={
            inChannel && state ? (
              <View style={styles.flip}>
                <Intro t={t} d={d} c={inChannel} />
              </View>
            ) : (
            <View style={styles.listEmpty}>
              {here && state ? <Creature agent={here} size={64} /> : null}
              <Text style={[styles.emptyText, { color: t.fg3 }]}>{!state ? (offline ? offline : `Connecting to ${client.macName}…`) : here ? `Nothing with ${displayName(here.name).base} yet. Say hi.` : 'Nothing here yet. Say hi to your crew.'}</Text>
            </View>
            )
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
            <Press
              onPress={() => {
                // with the keyboard up the latest sits below offset 0 (the list makes room for it): put it away first
                Keyboard.dismiss()
                list.current?.scrollToOffset({ offset: 0, animated: true })
              }} style={[styles.latest, { backgroundColor: t.surface, borderColor: t.lineStrong }]} accessibilityRole="button" accessibilityLabel="Go to the latest message" hitSlop={8}>
              <Icon name="latest" size={16} color={t.fg} weight="semibold" />
            </Press>
          </Animated.View>
        ) : null}
      </View>
      <KeyboardStickyView offset={{ closed: 0, opened: tabH }}>
        <Composer t={t} background={t.page} agents={d.agents} convo={here?.name ?? null} channel={channel} place={here ? `${space}@${here.name}` : `${space}#${chan ?? ''}`} unread={d.unread} disabled={disabled} onFace={(n) => openConvo(n)} onSend={(text) => client.send(here?.name ?? '', text, !here && chan ? { channel: chan } : undefined)} />
      </KeyboardStickyView>
      <View style={{ height: tabH, backgroundColor: t.page }} />
      </View>
      {/* while the list is out, the sliver of chat at the edge brings it back */}
      {listed ? <Pressable style={StyleSheet.absoluteFill} onPress={() => slide(false)} accessibilityRole="button" accessibilityLabel="Back to the chat" /> : null}
      </Animated.View>
      </GestureDetector>
    </View>
  )
}

// The list slides as the desktop's panels do: one ease-out move, transform only.
const MOVE = { duration: 260, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chat: { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: -2, height: 0 }, elevation: 8 },
  menu: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  menuDot: { position: 'absolute', right: 0, top: 0, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  hair: { height: StyleSheet.hairlineWidth },
  list: { flex: 1 },
  listInner: { paddingBottom: 8 },
  edge: { position: 'absolute', left: 0, right: 0, top: 0, height: 14 },
  listEmpty: { paddingVertical: 40, paddingHorizontal: 32, alignItems: 'center', gap: 12, transform: [{ scaleY: -1 }] },
  with: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  convo: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  convoName: { fontSize: 17, lineHeight: 21, fontWeight: '600' },
  convoLine: { fontSize: 13, lineHeight: 17 },
  people: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingLeft: 6, paddingRight: 9, borderRadius: 18 },
  peopleCount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'], marginLeft: 2 },
  flip: { transform: [{ scaleY: -1 }] },
  intro: { marginHorizontal: 16, marginTop: 18, marginBottom: 6, paddingBottom: 18, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  introMark: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  introHash: { fontSize: 24, fontWeight: '600' },
  introTitle: { fontSize: 20, lineHeight: 25, fontWeight: '700' },
  introText: { fontSize: 16, lineHeight: 22 },
  introNote: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  introWho: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
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

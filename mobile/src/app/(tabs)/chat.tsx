// The chat, as in Discord: one channel of the workspace (or your conversation with one agent) on top, and under it,
// a swipe from the left edge (or ☰) away, the list: the workspaces as a rail, the channels and a conversation with
// each agent. Questions waiting for you fold into one line at the top; who's at work shows under the last message; the
// message box is at the bottom. Near the latest message the list follows what comes in; scrolled back, nothing moves
// under you and a button leads down; sending always takes you down (ui/latest.ts).
import * as Clipboard from 'expo-clipboard'
import { router, useFocusEffect, useIsFocused } from 'expo-router'
import { useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ActionSheetIOS, Alert, AppState, BackHandler, FlatList, Keyboard, Platform, Pressable, Share, StyleSheet, Text, useWindowDimensions, View, type ListViewToken } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { KeyboardChatScrollView, KeyboardStickyView, useKeyboardHandler } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Agent, Channel, FeedEntry, Reply } from '@/net/types'
import { channelOf, familyOf, GENERAL, isUnread, membersOf, useClique, useDerived, type Derived } from '@/state/hooks'
import { openChannel, openConvo, useConvo, usePickedChannel } from '@/state/convo'
import { session } from '@/state/session'
import { agentColor } from '@/ui/avatar'
import { nameInk } from '@/ui/color'
import { Composer } from '@/ui/composer'
import { Creature } from '@/ui/creature'
import { Deck } from '@/ui/deck'
import { Drawer } from '@/ui/drawer'
import { FeedItem, type FeedCtx } from '@/ui/feed'
import { withThreadCards } from '@/ui/threads'
import { displayName, plural, rowLine } from '@/ui/format'
import { useAppActive, useNow } from '@/ui/hooks'
import { Icon } from '@/ui/icon'
import { newSince, nextLine, tracker } from '@/ui/latest'
import { Button, CountBadge, Faces, inkFor, Press, tap, thud } from '@/ui/parts'
import { andList, needsOf } from '@/ui/room'
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
      if (e.reactions?.length) first.reactions = [...(first.reactions ?? []), ...e.reactions] // each copy's agent reacted to its own
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
  return its(e.from) || its(e.to) || (e.cc ?? []).some(its) || (e.about ?? []).some(its) // (about: "You stopped Ada")
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

// Who's at work, on one line under the last message, the way Slack and Discord show who's typing. Its room is always
// kept, so the messages don't move when someone starts or stops. With several, tap to see what each one is doing.
// chan: in a channel, who's at work on something said there
// Stop, at the end of an agent's line: ends the turn it's in (it stays on). Only while it has one the Mac can stop.
function Working({ t, d, here, chan, now, onStop }: { t: Theme; d: Derived; here: string | null; chan: string | null; now: number; onStop: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const busy = [...d.byName.values()].filter((a) => a.on && (a.status === 'working' || (a.cloneOf && a.status === 'starting')) && (here ? familyOf(a.name) === here : !chan || channelOf(a, d.channels ?? undefined) === chan))
  // everyone stopped: the next ones to start come up as the one line again
  if (!busy.length && open) setOpen(false)
  if (!busy.length) return <View style={styles.working} />
  if (busy.length > 1 && !open) {
    const names = busy.map((a) => displayName(a.name).base)
    const said = `${names.length > 3 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : andList(names)} are at work`
    return (
      <Press style={styles.working} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${said}. Show what each one is doing`}>
        <View style={styles.workGutter}>
          <Faces faces={busy} size={20} max={2} />
        </View>
        <Text style={[styles.workWhat, { color: t.fg2 }]} numberOfLines={1}>
          {said}
        </Text>
      </Press>
    )
  }
  return (
    <View>
      {busy.map((a, i) => {
        const line = rowLine(a, now)
        return (
          <View key={a.name} style={styles.working}>
            <Press style={styles.workRow} onPress={() => router.push({ pathname: '/agent/[name]', params: { name: a.cloneOf ?? a.name } })} accessibilityLabel={`${a.name} ${line.text}`}>
              <View style={styles.workGutter}>
                <Creature agent={a} size={20} />
              </View>
              <Text style={[styles.workName, { color: nameInk(agentColor(a), t.fg) }]}>{displayName(a.name).base}</Text>
              <Text style={[styles.workWhat, { color: t.fg2, fontFamily: line.mono ? fonts.mono : undefined, fontSize: line.mono ? 12.5 : 13.5 }]} numberOfLines={1}>
                {line.text}
              </Text>
            </Press>
            {a.canStop ? (
              <Press onPress={() => onStop(a.name)} style={styles.workFold} accessibilityRole="button" accessibilityLabel={`Stop ${displayName(a.name).base}`} accessibilityHint="Ends what it's doing now. It stays on" hitSlop={8}>
                <View style={[styles.workStop, { backgroundColor: t.btn }]}>
                  <Icon name="stop" size={11} color={t.fg} weight="bold" />
                </View>
              </Press>
            ) : null}
            {i === 0 && busy.length > 1 ? (
              <Press onPress={() => setOpen(false)} style={styles.workFold} accessibilityRole="button" accessibilityLabel="Show one line" hitSlop={8}>
                <Icon name="up" size={12} color={t.fg3} weight="bold" />
              </Press>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

// Who's at work and who needs you, in a few plain words, for the line under the workspace's name. Who needs you
// counts the way the CLIque tab does: an agent once, with its clones.
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
    <Press onPress={onPress} style={styles.menu} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Icon name="menu" size={20} color={t.fg} weight="medium" />
      {dot ? <View style={[styles.menuDot, { backgroundColor: dot, borderColor: t.page }]} /> : null}
    </Press>
  )
}

// The header, as Discord's and Slack's: ☰, then where you are, with a chevron because tapping it opens that place. A
// channel: its name and, under it, the workspace and who's at work, or the computer's state. A conversation: the agent
// and what it's doing.
function Where({ t, here, channel, title, sub, link, menu }: { t: Theme; here: Agent | null; channel: Channel | null; title: string; sub: string; link: string; menu: ReactNode }) {
  const now = useNow(30000)
  if (here) {
    // while the computer can't be reached, what it was doing is old news: the line says so instead
    const line = link ? { text: link, kind: 'waiting', mono: false } : rowLine(here, now)
    return (
      <View style={styles.with}>
        {menu}
        <Press onPress={() => router.push({ pathname: '/agent/[name]', params: { name: here.name } })} style={styles.convo} accessibilityRole="button" accessibilityLabel={`${here.name}, ${line.text}. Open`}>
          <Creature agent={here} size={30} />
          <View style={styles.convoText}>
            <View style={styles.convoTitle}>
              <Text style={[styles.convoName, { color: nameInk(agentColor(here), t.fg) }]} numberOfLines={1}>
                {displayName(here.name).base}
              </Text>
              <Icon name="right" size={10} color={t.fg3} weight="bold" />
            </View>
            <Text style={[styles.convoLine, { color: inkFor(t, line.kind), fontFamily: line.mono ? fonts.mono : undefined }]} numberOfLines={1}>
              {line.text}
            </Text>
          </View>
        </Press>
      </View>
    )
  }
  return (
    <View style={styles.with}>
      {menu}
      <Press onPress={channel ? () => router.push({ pathname: '/channel', params: { id: channel.id } }) : undefined} style={styles.convo} accessibilityRole="button" accessibilityLabel={channel ? `#${channel.name}: its brief and who's in it` : title}>
        <View style={styles.convoText}>
          <View style={styles.convoTitle}>
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
            {channel ? <Icon name="right" size={10} color={t.fg3} weight="bold" /> : null}
          </View>
          <Text style={[styles.convoLine, { color: link ? t.waitingInk : t.fg2 }]} numberOfLines={1}>
            {link || sub}
          </Text>
        </View>
      </Press>
    </View>
  )
}

// The top of a channel's history: what it's for (its brief) and who's in it.
function Intro({ t, d, c }: { t: Theme; d: Derived; c: Channel }) {
  const who = membersOf(c, d.agents)
  return (
    <Press onPress={() => router.push({ pathname: '/channel', params: { id: c.id } })} style={styles.intro} accessibilityRole="button" accessibilityLabel={`The start of #${c.name}. ${c.brief ?? 'No brief yet'}. Open the channel`}>
      <Text style={[styles.introTitle, { color: t.fg }]}>
        <Text style={{ color: t.fg3 }}># </Text>
        {c.name}
      </Text>
      <Text style={[styles.introText, { color: c.brief ? t.fg : t.fg2 }]}>{c.brief ?? (c.id === GENERAL ? 'Everyone in the workspace, and everything without a channel of its own.' : 'No brief yet. Give it one to tell its agents how to work here.')}</Text>
      <View style={styles.introWho}>
        <Faces faces={who} size={22} max={6} />
        <Text style={[styles.introNote, { color: t.fg2 }]} numberOfLines={1}>
          {c.members ? who.map((a) => displayName(a.name).base).join(', ') : 'Everyone in this workspace'}
        </Text>
      </View>
    </Press>
  )
}

// Down to the latest, right above the message box so it moves with the keyboard, as in Discord, WhatsApp and Telegram;
// a badge counts the replies you haven't read.
function Jump({ t, count, onPress }: { t: Theme; count: number; onPress: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.jumpWrap} pointerEvents="box-none">
      <Press onPress={onPress} style={[styles.jump, { backgroundColor: t.surface, borderColor: t.lineStrong }]} accessibilityRole="button" accessibilityLabel={count ? `Go to the latest message, ${count} new` : 'Go to the latest message'} hitSlop={8}>
        <Icon name="latest" size={18} color={t.fg} weight="semibold" />
        {count ? (
          <View style={styles.jumpBadge}>
            <CountBadge t={t} n={count} />
          </View>
        ) : null}
      </Press>
    </Animated.View>
  )
}

// While you've scrolled back, what you're reading stays where it is as messages come in (at the latest it has to give
// way, or they'd arrive out of sight).
const HOLD = { minIndexForVisible: 0 }

// The list's place against its latest message, and where the New line goes, for one conversation at a time.
function useFollow(list: RefObject<FlatList<FeedEntry> | null>, place: string, items: FeedEntry[], unread: Set<string>, ready: boolean, onScreen: boolean) {
  const [track, setTrack] = useState(() => tracker(Platform.OS === 'ios'))
  const [away, setAway] = useState(false)
  const [leftAt, setLeftAt] = useState<string | null>(null)
  const [line, setLine] = useState<string | null | undefined>(undefined)
  const [was, setWas] = useState(place)
  const newest = useRef<string | undefined>(undefined)
  if (was !== place) {
    // another conversation: its own list, at its latest (the list has this place as its key), so all of this starts over
    setWas(place)
    setTrack(tracker(Platform.OS === 'ios'))
    setAway(false)
    setLine(undefined)
  } else {
    const next = nextLine(line, items.findLast((e) => unread.has(e.id))?.id ?? null, { ready, watching: onScreen && !away })
    if (next !== line) setLine(next)
  }
  // while the keyboard moves it moves the list too, which isn't you scrolling away
  const moved = track.keyboard
  useKeyboardHandler(
    {
      onStart: () => {
        'worklet'
        scheduleOnRN(moved, true)
      },
      onEnd: () => {
        'worklet'
        scheduleOnRN(moved, false)
      },
    },
    [moved],
  )
  const toLatest = () => {
    track.go()
    setAway(false)
    list.current?.scrollToOffset({ offset: track.latest(), animated: true })
  }
  return {
    away,
    line: line ?? null,
    fresh: away ? newSince(items, leftAt, unread) : 0,
    toLatest,
    // opened, a row keeps its start where it was and grows downward; closed, it keeps its end, which is where you tapped
    onResized(by: number) {
      if (by > 0) list.current?.scrollToOffset({ offset: track.keepingStart(by), animated: false })
    },
    sent() {
      setLine(null)
      toLatest()
    },
    onScroll(y: number) {
      const left = track.scrolled(y)
      if (left === null || left === away) return
      if (left) setLeftAt(items[0]?.id ?? null)
      setAway(left)
    },
    // something new at the end: near the latest, the list goes with it, so it doesn't arrive just out of sight
    onContent() {
      const id = items[0]?.id
      if (id === newest.current) return
      newest.current = id
      if (!away) toLatest()
    },
    onGrab: () => track.grabbed(),
    onInset: (top: number) => track.inset(top),
  }
}

export default function ChatScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { client, link, state, ws, shown, switching } = useClique()
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
    // in a channel, each thread is one card; a conversation with one agent shows all of its lines
    const rows = here ? shown : withThreadCards(shown, state?.feed ?? [], merged.byId, [...d.byName.values()])
    return { items: rows.slice(-200).reverse(), byId: merged.byId }
  }, [state?.feed, here, chan, d.channels, d.byName])
  const unread = useMemo(() => new Set(items.filter((e) => isUnread(e, state?.reads)).map((e) => e.id)), [items, state?.reads])
  // where you are: a place's list starts fresh at its latest, and its draft stays with it
  const place = here ? `${space}@${here.name}` : `${space}#${chan ?? ''}`
  const focused = useIsFocused()
  const active = useAppActive()
  const list = useRef<FlatList<FeedEntry>>(null)
  const follow = useFollow(list, place, items, unread, Boolean(state), focused && active)
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
  // another conversation gets a list of its own, which doesn't know the keyboard is already up: put it away first
  const talkTo = (name: string) => {
    Keyboard.dismiss()
    openConvo(name)
  }
  const ctx: FeedCtx = {
    t,
    byName: d.byName,
    byId,
    here: here?.name ?? null,
    channels: here ? (d.channels ?? null) : null,
    divider: follow.line,
    foldAt: Math.floor(((width - 72) / 7) * 3), // about three lines of a hand-off at this width
    onResized: follow.onResized,
    onFace: (name) => talkTo(name),
    onAsk: (id) => router.push({ pathname: '/ask/[id]', params: { id } }),
    onThread: (id) => router.push({ pathname: '/thread/[id]', params: { id } }),
    onHeld: (id, how) => void (how === 'approve' ? client?.approve(id) : client?.drop(id))?.catch(() => {}),
    onLong: (e) => {
      const text = e.ticket !== undefined && !e.text ? `#${String(e.ticket).split('@')[0]} ${e.title ?? ''}` : (e.text ?? '')
      if (!text) return
      thud()
      const who = e.from !== 'you' && !here && d.byName.has(familyOf(e.from)) ? familyOf(e.from) : null
      const actions: [string, () => void][] = [
        ['Copy', () => void Clipboard.setStringAsync(text)],
        ['Share…', () => void Share.share({ message: text }).catch(() => {})],
        ...(who ? ([[`Talk to ${displayName(who).base}`, () => talkTo(who)]] as [string, () => void][]) : []),
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
        <Text style={[styles.emptyText, { color: t.fg2 }]}>Pair this phone with your computer, or look around the demo clique.</Text>
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
  const headSub = [wsName, state?.parked ? 'Asleep' : d.working ? `${d.working} at work` : ''].filter(Boolean).join('  ·  ')
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
      <TopBar background={t.page}>
        <Where t={t} here={here} channel={inChannel} title={wsName} sub={headSub} link={linkLine} menu={menu} />
      </TopBar>
      <View style={[styles.hair, { backgroundColor: t.line }]} />
      <Deck t={t} open={open} byName={d.byName} onAnswer={answer} disabled={offline ? `Answering waits until ${client.macName} is back` : null} />
      <View style={styles.list}>
        <FlatList
          key={place}
          ref={list}
          style={styles.list}
          data={state ? items : []}
          inverted
          keyExtractor={(e) => e.id}
          renderItem={({ item, index }) => <FeedItem e={item} prev={items[index + 1]} c={ctx} />}
          renderScrollComponent={(props) => <KeyboardChatScrollView {...props} inverted offset={tabH} onContentInsetChange={(i) => follow.onInset(i.top)} />}
          maintainVisibleContentPosition={follow.away ? HOLD : undefined}
          ListHeaderComponent={
            <Working
              t={t}
              d={d}
              here={here?.name ?? null}
              chan={here ? null : chan}
              now={now}
              onStop={(name) => {
                tap()
                client.stopAgents([name], !here && chan ? { channel: chan } : undefined).catch((e: Error) => Alert.alert(`Couldn't stop ${displayName(name).base}`, String(e?.message ?? e)))
              }}
            />
          }
          ListFooterComponent={inChannel && state && items.length ? <Intro t={t} d={d} c={inChannel} /> : undefined}
          ListEmptyComponent={
            inChannel && state ? (
              <View style={styles.flip}>
                <Intro t={t} d={d} c={inChannel} />
              </View>
            ) : (
            <View style={styles.listEmpty}>
              {here && state ? <Creature agent={here} size={64} /> : null}
              <Text style={[styles.emptyText, { color: t.fg3 }]}>{!state ? (offline ? offline : `Connecting to ${client.macName}…`) : here ? `Nothing with ${displayName(here.name).base} yet. Say hi.` : 'Nothing here yet. Say hi to your clique.'}</Text>
            </View>
            )
          }
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 30, minimumViewTime: 600 }}
          onScroll={(ev) => follow.onScroll(ev.nativeEvent.contentOffset.y)}
          onScrollBeginDrag={follow.onGrab}
          onContentSizeChange={follow.onContent}
          scrollEventThrottle={16}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listInner}
        />
      </View>
      <KeyboardStickyView offset={{ closed: 0, opened: tabH }}>
        {follow.away ? <Jump t={t} count={follow.fresh} onPress={follow.toLatest} /> : null}
        <Composer
          t={t}
          background={t.page}
          agents={d.agents}
          convo={here?.name ?? null}
          channel={channel}
          place={place}
          disabled={disabled}
          onSend={(text) => {
            follow.sent()
            return client.send(here?.name ?? '', text, !here && chan ? { channel: chan } : undefined)
          }}
        />
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
  menu: { width: 40, height: 44, marginLeft: -8, alignItems: 'center', justifyContent: 'center' },
  menuDot: { position: 'absolute', right: 3, top: 7, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  hair: { height: StyleSheet.hairlineWidth },
  list: { flex: 1 },
  listInner: { paddingBottom: 12 },
  listEmpty: { paddingVertical: 40, paddingHorizontal: 32, alignItems: 'center', gap: 12, transform: [{ scaleY: -1 }] },
  with: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  convo: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  convoText: { flexShrink: 1 },
  convoTitle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  convoName: { fontSize: 16, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  convoLine: { fontSize: 12.5, lineHeight: 16 },
  flip: { transform: [{ scaleY: -1 }] },
  intro: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, gap: 4 },
  introTitle: { fontSize: 20, lineHeight: 25, fontWeight: '700' },
  introText: { fontSize: 15, lineHeight: 21 },
  introNote: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  introWho: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  jumpWrap: { position: 'absolute', right: 12, bottom: '100%', marginBottom: 8 },
  jump: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  jumpBadge: { position: 'absolute', top: -6, right: -4 },
  working: { flexDirection: 'row', alignItems: 'center', minHeight: 28, paddingHorizontal: 12 },
  workRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  workGutter: { width: 38, marginRight: 10, alignItems: 'center' },
  workName: { fontSize: 13.5, fontWeight: '600', marginLeft: -8 },
  workWhat: { flex: 1, fontSize: 13.5 },
  workFold: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  workStop: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 22, fontWeight: '800' },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
})

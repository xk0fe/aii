// The chat, one entry at a time, as Slack and Discord set it: every message, yours too, is a row with a face in the
// gutter, the name and time on top and the words beside it, with no bubbles. Messages in a row from one sender stack
// under one face; crew events are a quiet line with an icon in the gutter. A reply right under what it answers doesn't
// quote it again. Long-press a message to copy or share it.
import { memo, type ReactNode } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'

import type { Agent, Channel, FeedEntry } from '@/net/types'
import { channelOf, familyOf, GENERAL } from '@/state/hooks'

import { AskSummary, askVerb } from './ask'
import { agentColor } from './avatar'
import { nameInk } from './color'
import { Creature } from './creature'
import { clock, displayName } from './format'
import { Icon } from './icon'
import { Markdown } from './markdown'
import { stacks } from './stack'
import { Button, Press } from './parts'
import { fonts, type Theme } from './theme'

export type FeedCtx = {
  t: Theme
  byName: Map<string, Agent>
  byId: Map<string, FeedEntry>
  here: string | null // the agent whose conversation this is
  channels: Channel[] | null // in a conversation (which spans the channels): each message says where it was said
  unread: Set<string>
  divider: string | null // the entry the "New" line goes above
  onFace: (name: string) => void
  onAsk: (id: string) => void
  onHeld: (id: string, how: 'approve' | 'drop') => void
  onLong: (e: FeedEntry) => void // copy, share, talk to
  canAct: boolean
}

// A clone, or someone no longer in the crew, still gets a face: its original's, or one from its name.
export const someone = (name: string, byName: Map<string, Agent>): Agent => byName.get(name) ?? byName.get(familyOf(name)) ?? ({ name, status: 'idle', on: true } as Agent)

const ink = (name: string, c: FeedCtx) => (name === 'you' ? c.t.fg : nameInk(agentColor(someone(name, c.byName)), c.t.fg))
// Markdown hands over a mention lowercased (@Theo → theo), so match agents by name in any case.
const mentionInk = (c: FeedCtx) => (name: string) => {
  const a = [...c.byName.values()].find((x) => x.name.toLowerCase() === name)
  return a ? nameInk(agentColor(a), c.t.fg) : null
}

function Name({ name, c, at = false }: { name: string; c: FeedCtx; at?: boolean }) {
  if (name === 'you') return <Text style={{ color: c.t.fg, fontWeight: '600' }}>{at ? 'you' : 'You'}</Text>
  const { base, home } = displayName(name)
  return (
    <Text style={{ color: ink(name, c), fontWeight: '600' }} onPress={c.here === familyOf(name) ? undefined : () => c.onFace(familyOf(name))}>
      {at ? '@' : ''}
      {base}
      {home ? <Text style={{ fontWeight: '500', opacity: 0.6 }}>@{home}</Text> : null}
    </Text>
  )
}

const snippet = (text?: string) => String(text ?? '').replace(/```[\s\S]*?```/g, '[code]').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()

function Quote({ e, c }: { e: FeedEntry; c: FeedCtx }) {
  const orig = e.re ? c.byId.get(e.re) : undefined
  if (!orig) return null
  const text = orig.ticket !== undefined ? `#${String(orig.ticket).split('@')[0]} ${orig.title ?? ''}` : snippet(orig.text)
  return (
    <View style={styles.quote}>
      <Icon name="reply" size={11} color={c.t.fg3} />
      <Text style={[styles.quoteText, { color: c.t.fg3 }]} numberOfLines={1}>
        <Text style={{ fontWeight: '600', color: c.t.fg2 }}>{orig.from === 'you' ? 'You' : displayName(orig.from).base}</Text> {text}
      </Text>
    </View>
  )
}

// In a conversation with one agent, which spans the channels: " · #ship" after a caption said outside #general.
function Where({ e, c }: { e: FeedEntry; c: FeedCtx }) {
  if (!c.channels) return null
  const id = channelOf(e, c.channels)
  if (id === GENERAL) return null
  return <Text style={{ color: c.t.fg3 }}>{`  #${c.channels.find((x) => x.id === id)?.name ?? id}`}</Text>
}

// One row of the chat: a face in the gutter, the name and time on top, then what was said. The next message from the
// same sender goes under it without the face.
function Row({ e, c, cont, face, head, quote, long = true, children }: { e: FeedEntry; c: FeedCtx; cont: boolean; face: ReactNode; head: ReactNode; quote: boolean; long?: boolean; children: ReactNode }) {
  const fresh = c.unread.has(e.id)
  const inner = (
    <>
      <View style={styles.gutter}>{cont ? null : face}</View>
      <View style={styles.main}>
        {cont ? null : (
          <View style={styles.head}>
            <Text style={[styles.headText, { color: c.t.fg2 }]} numberOfLines={1}>
              {head}
              <Where e={e} c={c} />
            </Text>
            <Text style={[styles.time, { color: c.t.fg3 }]}>{clock(e.ts)}</Text>
            {fresh ? <View style={[styles.unreadDot, { backgroundColor: c.t.accent }]} accessibilityLabel="new" /> : null}
          </View>
        )}
        {quote ? <Quote e={e} c={c} /> : null}
        {children}
      </View>
    </>
  )
  return long ? (
    <Pressable onPress={Keyboard.dismiss} onLongPress={() => c.onLong(e)} delayLongPress={320} accessible={false} style={[styles.row, cont && styles.cont]}>
      {inner}
    </Pressable>
  ) : (
    <View style={[styles.row, cont && styles.cont]}>{inner}</View>
  )
}

// An agent's face: tap it to talk to it alone.
function Face({ e, c }: { e: FeedEntry; c: FeedCtx }) {
  return (
    <Press onPress={() => c.onFace(familyOf(e.from))} disabled={c.here === familyOf(e.from)} hitSlop={6} accessibilityLabel={`Talk to ${displayName(e.from).base}`}>
      <Creature agent={someone(e.from, c.byName)} size={36} mood="still" />
    </Press>
  )
}

// Yours: a plain disc, so the creatures stay the crew's.
function YouFace({ t }: { t: Theme }) {
  return (
    <View style={[styles.you, { backgroundColor: t.fill }]} accessibilityLabel="You">
      <Icon name="person" size={17} color={t.fg2} />
    </View>
  )
}

// What an agent said to you: plain, like anyone's message. To another agent (a hand-off), or a note for the crew: on a
// card, smaller, so what's for you stands out.
function Body({ e, c, tone = 'agent' }: { e: FeedEntry; c: FeedCtx; tone?: 'agent' | 'card' | 'dropped' }) {
  const t = c.t
  if (tone === 'agent') return <Markdown text={e.text ?? ''} t={t} color={t.fg} size={TEXT} mention={mentionInk(c)} />
  return (
    <View style={[styles.card, { backgroundColor: t.fill }, tone === 'dropped' && { opacity: 0.45 }]}>
      <Markdown text={e.text ?? ''} t={t} color={t.fg} size={15} mention={mentionInk(c)} />
    </View>
  )
}

// A question card in the chat: a short line that opens it, or what became of it.
function AskLine({ e, c }: { e: FeedEntry; c: FeedCtx }) {
  const t = c.t
  const ask = typeof e.ask === 'object' ? e.ask : null
  if (!ask) return null
  if (e.answer) return <AskSummary t={t} e={e} />
  const title = ask.type === 'permission' ? (ask.title ?? 'Use a tool') : ask.type === 'plan' ? 'A plan to approve' : (ask.questions[0]?.question ?? 'A question')
  const sub = ask.type === 'permission' ? (ask.code ?? '').split('\n')[0] : ask.type === 'question' ? ask.questions[0]?.options.map((o) => o.label).join(' · ') : ''
  return (
    <Press onPress={() => c.onAsk(e.id)} style={[styles.askLine, { backgroundColor: t.surface, borderColor: t.lineStrong }]} accessibilityRole="button" accessibilityLabel={`Answer ${displayName(e.from).base}`}>
      <View style={styles.askText}>
        <Text style={[styles.askTitle, { color: t.fg }]} numberOfLines={3}>
          {title}
        </Text>
        {sub ? (
          <Text style={[styles.askSub, { color: t.fg2, fontFamily: ask.type === 'permission' ? fonts.mono : undefined }]} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={[styles.answerChip, { backgroundColor: t.fill }]}>
        <Text style={[styles.answerChipText, { color: t.fg }]}>Answer</Text>
      </View>
    </Press>
  )
}

// A quiet line: events, tasks, Crew's right-of-way rules. An icon in the gutter, the words beside it.
function Quiet({ c, icon = 'handoff', tint, children }: { c: FeedCtx; icon?: Parameters<typeof Icon>[0]['name']; tint?: string; children: ReactNode }) {
  return (
    <View style={[styles.row, styles.sys]}>
      <View style={[styles.gutter, styles.sysIcon]}>
        <Icon name={icon} size={14} color={tint ?? c.t.fg3} />
      </View>
      <View style={styles.main}>{children}</View>
    </View>
  )
}

const TASK_ACTS: Record<string, (e: FeedEntry, c: FeedCtx) => ReactNode> = {
  filed: (e, c) => (e.from === 'you' ? 'You' : <Name name={e.from} c={c} at />),
  triaged: (e, c) => (
    <>
      <Name name={e.from} c={c} at /> triaged it{e.text ? ' for ' : ''}
      {e.text ? <Name name={e.text} c={c} at /> : null}
    </>
  ),
  fixed: (e, c) => <Name name={e.from} c={c} at />,
  note: (e, c) => <Name name={e.from} c={c} at />,
}

function TaskLine({ e, c }: { e: FeedEntry; c: FeedCtx }) {
  const key = String(e.ticket ?? '').split('@')[0]
  const bug = (e.type ?? 'bug') === 'bug'
  const verb = { filed: bug ? ' reported ' : ' added ', triaged: ' ', fixed: bug ? ' fixed ' : ' finished ', note: ' noted on ', done: bug ? 'checked: works ✓ ' : 'accepted ✓ ', reopened: 'reopened ' }[e.act ?? ''] ?? ` ${e.act} `
  const who = TASK_ACTS[e.act ?? '']?.(e, c)
  if (e.act === 'bulk')
    return (
      <Quiet c={c} icon="task">
        <Text style={[styles.sysText, { color: c.t.fg2 }]}>
          {e.from === 'you' ? 'You' : <Name name={e.from} c={c} at />} {e.text}
        </Text>
      </Quiet>
    )
  return (
    <Quiet c={c} icon={bug ? 'bug' : 'task'} tint={bug ? c.t.danger : c.t.blocked}>
      <Text style={[styles.sysText, { color: c.t.fg2 }]} numberOfLines={2}>
        {who}
        {e.act === 'triaged' ? ' ' : verb}
        <Text style={{ color: c.t.fg2, fontWeight: '500' }}>#{key}</Text> <Text style={{ color: c.t.fg, fontWeight: '600' }}>{e.title}</Text>
      </Text>
      {(e.act === 'fixed' || e.act === 'note') && e.text ? (
        <Text style={[styles.sysText, { color: c.t.fg3 }]} numberOfLines={2}>
          {e.text}
        </Text>
      ) : null}
    </Quiet>
  )
}

function RuleLine({ e, c }: { e: FeedEntry; c: FeedCtx }) {
  const n = (x?: string) => (x ? <Name name={x} c={c} at /> : null)
  const body =
    e.rule === 'loop' ? (
      <>
        {n(e.to)} is waiting on {n(e.from)}, so {n(e.from)} answers first instead of asking back
      </>
    ) : e.rule === 'back' ? (
      <>
        {n(e.to)} is waiting on {n(e.from)}'s answer, so {n(e.from)} answers instead of handing it back
      </>
    ) : e.rule === 'file' ? (
      <>
        {n(e.from)} left <Text style={{ fontFamily: fonts.mono }}>{e.file}</Text> to {n(e.to)}, who's editing it
      </>
    ) : e.rule === 'lease' ? (
      <>
        {n(e.from)} waited for {e.thing}: {n(e.to)} is using it
      </>
    ) : e.rule === 'decline' ? (
      <>
        #{String(e.ticket ?? '').split('@')[0]} {e.to ? <>went to {n(e.to)}: </> : 'is back on To do: '}
        {n(e.from)} declined it
      </>
    ) : null
  return body ? (
    <Quiet c={c} icon="yield">
      <Text style={[styles.sysText, { color: c.t.fg2 }]}>{body}</Text>
    </Quiet>
  ) : null
}

export const FeedItem = memo(function FeedItem({ e, prev, c }: { e: FeedEntry; prev?: FeedEntry; c: FeedCtx }) {
  const t = c.t
  // what it answers, quoted only when that isn't right above it (or quoted already by the message above, its own)
  const quoted = e.re ? c.byId.get(e.re) : undefined
  const near = !quoted || quoted === prev || Boolean(prev && prev.from === e.from && prev.re && c.byId.get(prev.re) === quoted)
  const cont = stacks(prev, e, { near, divider: c.divider })
  const divider = c.divider === e.id ? (
    <View style={styles.newLine} accessibilityLabel="New replies">
      <View style={[styles.rule, { backgroundColor: t.accent }]} />
      <Text style={[styles.newText, { color: t.accent }]}>New</Text>
    </View>
  ) : null
  return (
    <View>
      {divider}
      <Entry e={e} c={c} cont={cont} quote={!near} />
    </View>
  )
})

function Entry({ e, c, cont, quote }: { e: FeedEntry; c: FeedCtx; cont: boolean; quote: boolean }) {
  const t = c.t
  if (e.kind === 'task' || e.kind === 'bug') return <TaskLine e={e} c={c} />
  if (e.kind === 'rule') return <RuleLine e={e} c={c} />
  if (e.kind === 'event')
    return (
      <Quiet c={c} icon={e.fresh ? 'fresh' : 'handoff'}>
        <Text style={[styles.sysText, { color: t.fg2 }]}>
          {e.from && e.from !== 'crew' ? (
            <>
              <Name name={e.from} c={c} />{' '}
            </>
          ) : null}
          {e.text}
        </Text>
      </Quiet>
    )
  if (e.from === 'you') {
    const to = e.cc ?? [e.to ?? '']
    // in a conversation with one agent, who it went to goes without saying
    const elsewhere = Boolean(c.channels) && channelOf(e, c.channels ?? undefined) !== GENERAL
    const named = !c.here || e.auto || to.length > 1 || familyOf(to[0]) !== c.here || elsewhere
    const head = (
      <>
        <Name name="you" c={c} />
        {named ? (
          <Text>
            {' → '}
            {to.map((n, i) => (
              <Text key={n}>
                {i ? ' ' : ''}
                <Name name={n} c={c} at />
              </Text>
            ))}
          </Text>
        ) : null}
        {e.auto ? <Text style={{ color: t.fg3 }}> · Auto picked</Text> : null}
        {e.queued ? <Text style={{ color: t.fg3 }}> · queued</Text> : null}
        {e.fresh ? <Text style={{ color: t.accent }}> · new conversation</Text> : null}
      </>
    )
    return (
      <Row e={e} c={c} cont={cont} quote={quote} face={<YouFace t={t} />} head={head}>
        {e.ticket !== undefined ? (
          // you sent a task to an agent: the task, not its whole brief
          <View style={styles.ticket}>
            <Icon name={(e.type ?? 'bug') === 'bug' ? 'bug' : 'task'} size={15} color={t.fg2} />
            <Text style={[styles.ticketText, { color: t.fg }]}>
              <Text style={{ fontWeight: '600' }}>#{String(e.ticket).split('@')[0]}</Text> {e.title}
            </Text>
          </View>
        ) : (
          <Markdown text={e.text ?? ''} t={t} color={t.fg} size={TEXT} mention={mentionInk(c)} />
        )}
      </Row>
    )
  }
  if (e.kind === 'ask')
    return (
      <Row e={e} c={c} cont={false} quote={quote} long={false} face={<Face e={e} c={c} />} head={<><Name name={e.from} c={c} /> {askVerb(e)}</>}>
        <AskLine e={e} c={c} />
      </Row>
    )
  if (e.kind === 'note')
    return (
      <Row e={e} c={c} cont={cont} quote={quote} face={<Face e={e} c={c} />} head={<><Name name={e.from} c={c} /> shared a note</>}>
        <Body e={e} c={c} tone="card" />
      </Row>
    )
  if (e.kind === 'reply')
    return (
      <Row e={e} c={c} cont={cont} quote={quote} face={<Face e={e} c={c} />} head={<Name name={e.from} c={c} />}>
        <Body e={e} c={c} />
        {e.subs?.length ? (
          <Text style={[styles.subs, { color: t.fg3 }]}>
            {e.subs.length === 1 ? '1 sub-agent' : `${e.subs.length} sub-agents`} helped · {e.subs.map((s) => (s.type === 'general-purpose' ? 'general' : s.type)).join(', ')}
          </Text>
        ) : null}
      </Row>
    )
  // a hand-off between agents, or a teammate's question (crew ask)
  const head =
    e.ask === true ? (
      <>
        <Name name={e.from} c={c} /> asks <Name name={e.to ?? ''} c={c} at />
      </>
    ) : (
      <>
        <Name name={e.from} c={c} /> → <Name name={e.to ?? ''} c={c} at />
      </>
    )
  return (
    <Row e={e} c={c} cont={cont} quote={quote} face={<Face e={e} c={c} />} head={head}>
      <Body e={e} c={c} tone={e.dropped ? 'dropped' : 'card'} />
      {e.held ? (
        <View style={styles.held}>
          <Button t={t} small title="Drop" onPress={() => c.onHeld(e.id, 'drop')} disabled={!c.canAct} />
          <Button t={t} small kind="primary" title="Send it" onPress={() => c.onHeld(e.id, 'approve')} disabled={!c.canAct} />
          <Text style={[styles.heldText, { color: t.fg3 }]}>needs your OK</Text>
        </View>
      ) : null}
    </Row>
  )
}

// The size of what's said: Discord's 16, a touch more for long replies on a phone.
const TEXT = 16.5

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, marginTop: 16 },
  cont: { marginTop: 6 },
  gutter: { width: 38, alignItems: 'center', paddingTop: 1 },
  main: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginBottom: 2 },
  headText: { fontSize: 15.5, flexShrink: 1 },
  time: { fontSize: 12, fontVariant: ['tabular-nums'] },
  unreadDot: { width: 7, height: 7, borderRadius: 4, alignSelf: 'center' },
  you: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, alignSelf: 'stretch', marginTop: 2 },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  ticketText: { fontSize: 16, flexShrink: 1 },
  quote: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%', marginBottom: 3 },
  quoteText: { fontSize: 12.5, flexShrink: 1 },
  askLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 14, paddingRight: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginTop: 4 },
  askText: { flex: 1, gap: 1 },
  askTitle: { fontSize: 15, fontWeight: '600' },
  askSub: { fontSize: 12.5, lineHeight: 17 },
  answerChip: { paddingHorizontal: 14, minHeight: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  answerChipText: { fontSize: 15, fontWeight: '600' },
  sys: { marginTop: 12, alignItems: 'flex-start' },
  sysIcon: { paddingTop: 2 },
  sysText: { fontSize: 14, lineHeight: 19 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth * 2 },
  newLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 12, marginTop: 18 },
  newText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  held: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  heldText: { fontSize: 12.5 },
  subs: { fontSize: 12.5, marginTop: 6 },
})

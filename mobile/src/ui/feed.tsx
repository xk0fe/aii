// The chat, one entry at a time, set for reading: an agent's message is its face and name on one line, then what it
// said across the whole width (no bubble, so a long plan reads like a page); yours sit on the right in a quiet grey
// bubble; crew events are centered and quiet. Messages in a row from one sender stack under one face and name, and a
// reply right under what it answers doesn't quote it again. Long-press a message to copy or share it.
import { memo, type ReactNode } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'

import type { Agent, FeedEntry } from '@/net/types'
import { familyOf } from '@/state/hooks'

import { AskSummary, askVerb } from './ask'
import { agentColor } from './avatar'
import { nameInk } from './color'
import { Creature } from './creature'
import { clock, displayName } from './format'
import { Icon } from './icon'
import { Markdown } from './markdown'
import { Button, Press } from './parts'
import { fonts, type Theme } from './theme'

export type FeedCtx = {
  t: Theme
  byName: Map<string, Agent>
  byId: Map<string, FeedEntry>
  here: string | null // the agent whose conversation this is
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

// An agent's line: its face and a caption (name, what it did, time) on one line, then what it said, full width.
function Said({ e, c, cont, caption, quote, long = true, children }: { e: FeedEntry; c: FeedCtx; cont: boolean; caption: ReactNode; quote: boolean; long?: boolean; children: ReactNode }) {
  const a = someone(e.from, c.byName)
  const fresh = c.unread.has(e.id)
  const inner = (
    <>
      {cont ? null : (
        <View style={styles.head}>
          <Press onPress={() => c.onFace(familyOf(e.from))} disabled={c.here === familyOf(e.from)} hitSlop={8} accessibilityLabel={`Talk to ${displayName(e.from).base}`}>
            <Creature agent={a} size={26} mood="still" />
          </Press>
          <Text style={[styles.capText, { color: c.t.fg2 }]} numberOfLines={1}>
            {caption}
          </Text>
          <Text style={[styles.time, { color: c.t.fg3 }]}>{clock(e.ts)}</Text>
          {fresh ? <View style={[styles.unreadDot, { backgroundColor: c.t.accent }]} accessibilityLabel="new" /> : null}
        </View>
      )}
      {quote ? <Quote e={e} c={c} /> : null}
      {children}
    </>
  )
  return long ? (
    <Pressable onPress={Keyboard.dismiss} onLongPress={() => c.onLong(e)} delayLongPress={320} accessible={false} style={[styles.said, cont && styles.cont]}>
      {inner}
    </Pressable>
  ) : (
    <View style={[styles.said, cont && styles.cont]}>{inner}</View>
  )
}

// What an agent said to you: plain on the page. To another agent (a hand-off), or a note for the crew: on a card,
// smaller, so what's for you stands out.
function Body({ e, c, tone = 'agent' }: { e: FeedEntry; c: FeedCtx; tone?: 'agent' | 'card' | 'dropped' }) {
  const t = c.t
  if (tone === 'agent') return <Markdown text={e.text ?? ''} t={t} color={t.fg} mention={mentionInk(c)} />
  return (
    <View style={[styles.card, { backgroundColor: t.fill }, tone === 'dropped' && { opacity: 0.45 }]}>
      <Markdown text={e.text ?? ''} t={t} color={t.fg} size={15.5} mention={mentionInk(c)} />
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

// One quiet line across the chat: events, tasks, Crew's right-of-way rules.
function Quiet({ c, icon, children, line }: { c: FeedCtx; icon?: Parameters<typeof Icon>[0]['name']; children: ReactNode; line?: boolean }) {
  return (
    <View style={styles.quietRow}>
      {line ? <View style={[styles.rule, { backgroundColor: c.t.line }]} /> : null}
      <View style={styles.quiet}>
        {icon ? <Icon name={icon} size={12} color={c.t.fg3} /> : null}
        <Text style={[styles.quietText, { color: c.t.fg3 }]}>{children}</Text>
      </View>
      {line ? <View style={[styles.rule, { backgroundColor: c.t.line }]} /> : null}
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
        {e.from === 'you' ? 'You' : <Name name={e.from} c={c} at />} {e.text}
      </Quiet>
    )
  return (
    <View style={[styles.taskRow, { backgroundColor: c.t.fill }]}>
      <Icon name={bug ? 'bug' : 'task'} size={14} color={bug ? c.t.danger : c.t.blocked} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.taskText, { color: c.t.fg2 }]} numberOfLines={2}>
          {who}
          {e.act === 'triaged' ? ' ' : verb}
          <Text style={{ color: c.t.fg2, fontWeight: '500' }}>#{key}</Text> <Text style={{ color: c.t.fg, fontWeight: '600' }}>{e.title}</Text>
        </Text>
        {(e.act === 'fixed' || e.act === 'note') && e.text ? (
          <Text style={[styles.taskText, { color: c.t.fg3 }]} numberOfLines={2}>
            {e.text}
          </Text>
        ) : null}
      </View>
    </View>
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
      {body}
    </Quiet>
  ) : null
}

export const FeedItem = memo(function FeedItem({ e, prev, c }: { e: FeedEntry; prev?: FeedEntry; c: FeedCtx }) {
  const t = c.t
  // what it answers, quoted only when that isn't right above it (or quoted already by the message above, its own)
  const quoted = e.re ? c.byId.get(e.re) : undefined
  const near = !quoted || quoted === prev || Boolean(prev && prev.from === e.from && prev.re && c.byId.get(prev.re) === quoted)
  const cont = Boolean(prev && prev.kind === e.kind && prev.from === e.from && prev.to === e.to && !prev.auto === !e.auto && e.ts - prev.ts < 120000 && near && e.kind !== 'ask' && e.kind !== 'event')
  const divider = c.divider === e.id ? (
    <View style={styles.newLine} accessibilityLabel="New replies">
      <View style={[styles.rule, { backgroundColor: t.accent, opacity: 0.4 }]} />
      <Text style={[styles.newText, { color: t.accent }]}>New</Text>
      <View style={[styles.rule, { backgroundColor: t.accent, opacity: 0.4 }]} />
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
      <Quiet c={c} icon={e.fresh ? 'fresh' : undefined} line={e.fresh}>
        {e.from && e.from !== 'crew' ? (
          <>
            <Name name={e.from} c={c} at />{' '}
          </>
        ) : null}
        {e.text}
      </Quiet>
    )
  // you sent a task to an agent: the task, not its whole brief
  if (e.from === 'you' && e.ticket !== undefined) {
    return (
      <Pressable onPress={Keyboard.dismiss} onLongPress={() => c.onLong(e)} delayLongPress={320} accessible={false} style={styles.me}>
        <View style={styles.meCap}>
          <Text style={[styles.capText, { color: t.fg2 }]}>
            to <Name name={e.to ?? ''} c={c} at />
            {e.fresh ? <Text style={{ color: t.accent }}> · new conversation</Text> : null}
          </Text>
          <Text style={[styles.time, { color: t.fg3 }]}>{clock(e.ts)}</Text>
        </View>
        <View style={[styles.bubbleMe, styles.ticket, { backgroundColor: t.bubbleMe }]}>
          <Icon name={(e.type ?? 'bug') === 'bug' ? 'bug' : 'task'} size={15} color={t.fg2} />
          <Text style={[styles.ticketText, { color: t.fg }]}>
            <Text style={{ fontWeight: '600' }}>#{String(e.ticket).split('@')[0]}</Text> {e.title}
          </Text>
        </View>
      </Pressable>
    )
  }
  if (e.from === 'you') {
    const to = e.cc ?? [e.to ?? '']
    // in a conversation with one agent, who it went to goes without saying
    const said = !cont && (!c.here || e.auto || e.queued || e.fresh || to.length > 1 || familyOf(to[0]) !== c.here)
    return (
      <Pressable onPress={Keyboard.dismiss} onLongPress={() => c.onLong(e)} delayLongPress={320} accessible={false} style={[styles.me, cont && styles.cont]}>
        {said ? (
          <View style={styles.meCap}>
            <Text style={[styles.capText, styles.meCapText, { color: t.fg2 }]} numberOfLines={1}>
              {e.auto ? 'Auto picked' : 'to'}{' '}
              {to.map((n, i) => (
                <Text key={n}>
                  {i ? ' ' : ''}
                  <Name name={n} c={c} at />
                </Text>
              ))}
              {e.queued ? <Text style={{ color: t.fg3 }}> · queued</Text> : null}
              {e.fresh ? <Text style={{ color: t.accent }}> · new conversation</Text> : null}
            </Text>
            <Text style={[styles.time, { color: t.fg3 }]}>{clock(e.ts)}</Text>
          </View>
        ) : null}
        {quote ? <Quote e={e} c={c} /> : null}
        <View style={[styles.bubbleMe, { backgroundColor: t.bubbleMe }]}>
          <Markdown text={e.text ?? ''} t={t} color={t.fg} mention={mentionInk(c)} />
        </View>
      </Pressable>
    )
  }
  if (e.kind === 'ask')
    return (
      <Said e={e} c={c} cont={false} quote={quote} long={false} caption={<><Name name={e.from} c={c} /> {askVerb(e)}</>}>
        <AskLine e={e} c={c} />
      </Said>
    )
  if (e.kind === 'note')
    return (
      <Said e={e} c={c} cont={cont} quote={quote} caption={<><Name name={e.from} c={c} /> shared a note</>}>
        <Body e={e} c={c} tone="card" />
      </Said>
    )
  if (e.kind === 'reply')
    return (
      <Said e={e} c={c} cont={cont} quote={quote} caption={<Name name={e.from} c={c} />}>
        <Body e={e} c={c} />
        {e.subs?.length ? (
          <Text style={[styles.subs, { color: t.fg3 }]}>
            {e.subs.length === 1 ? '1 sub-agent' : `${e.subs.length} sub-agents`} helped · {e.subs.map((s) => (s.type === 'general-purpose' ? 'general' : s.type)).join(', ')}
          </Text>
        ) : null}
      </Said>
    )
  // a hand-off between agents, or a teammate's question (crew ask)
  const caption =
    e.ask === true ? (
      <>
        <Name name={e.from} c={c} /> asks <Name name={e.to ?? ''} c={c} />
      </>
    ) : (
      <>
        <Name name={e.from} c={c} /> → <Name name={e.to ?? ''} c={c} />
      </>
    )
  return (
    <Said e={e} c={c} cont={cont} quote={quote} caption={caption}>
      <Body e={e} c={c} tone={e.dropped ? 'dropped' : 'card'} />
      {e.held ? (
        <View style={styles.held}>
          <Button t={t} small title="Drop" onPress={() => c.onHeld(e.id, 'drop')} disabled={!c.canAct} />
          <Button t={t} small kind="primary" title="Send it" onPress={() => c.onHeld(e.id, 'approve')} disabled={!c.canAct} />
          <Text style={[styles.heldText, { color: t.fg3 }]}>needs your OK</Text>
        </View>
      ) : null}
    </Said>
  )
}

const styles = StyleSheet.create({
  said: { paddingHorizontal: 16, marginTop: 22 },
  cont: { marginTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  capText: { fontSize: 14.5, flexShrink: 1 },
  time: { fontSize: 12.5, fontVariant: ['tabular-nums'] },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  card: { borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10, alignSelf: 'stretch' },
  bubbleMe: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, maxWidth: '100%' },
  me: { alignItems: 'flex-end', paddingLeft: 52, paddingRight: 16, marginTop: 22, gap: 4 },
  meCap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 4 },
  meCapText: { fontSize: 13 },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketText: { fontSize: 16, flexShrink: 1 },
  quote: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%', paddingHorizontal: 2, marginBottom: 4 },
  quoteText: { fontSize: 12.5, flexShrink: 1 },
  askLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 14, paddingRight: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  askText: { flex: 1, gap: 1 },
  askTitle: { fontSize: 15, fontWeight: '600' },
  askSub: { fontSize: 12.5, lineHeight: 17 },
  answerChip: { paddingHorizontal: 14, minHeight: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  answerChipText: { fontSize: 15, fontWeight: '600' },
  quietRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, marginTop: 18 },
  quiet: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center', marginHorizontal: 'auto' },
  quietText: { fontSize: 12.5, lineHeight: 17, textAlign: 'center', flexShrink: 1 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginHorizontal: 16, marginTop: 18, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14 },
  taskText: { fontSize: 13.5, lineHeight: 18 },
  newLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 18 },
  newText: { fontSize: 13, fontWeight: '600' },
  held: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  heldText: { fontSize: 12.5 },
  subs: { fontSize: 12.5, marginTop: 8 },
})

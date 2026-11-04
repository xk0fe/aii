// An agent's question as a card you answer from the phone (hub.js askOf / decide): a permission prompt, its own
// multiple-choice questions, or a plan to approve. What you pick and type is kept per card while you look elsewhere.
// Answered, a card folds into a line saying what happened. The buttons are thumb-sized and full width; the one you'd
// most likely press is the brand's.
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import type { Answer, FeedEntry, PermissionAsk, PlanAsk, QuestionAsk, Reply } from '@/net/types'

import { displayName, reasonOf } from './format'
import { Icon, type IconName } from './icon'
import { Markdown } from './markdown'
import { Button, Press } from './parts'
import { fonts, type Theme } from './theme'

type Draft = { picks?: Record<number, string[]>; other?: Record<number, string>; note?: string }
const drafts = new Map<string, Draft>()

function useDraft(id: string) {
  const [draft, setDraft] = useState<Draft>(() => drafts.get(id) ?? {})
  const update = (next: Draft) => {
    drafts.set(id, next)
    setDraft(next)
  }
  return [draft, update] as const
}

export type AskProps = {
  t: Theme
  e: FeedEntry
  onAnswer: (id: string, reply: Reply) => Promise<unknown>
  compact?: boolean // the deck at the top of Chat: the essentials, with More for the rest
  onMore?: () => void
  disabled?: string | null // why answering can't work right now (offline)
  voiced?: boolean // the creature has already said it in its own words (Needs you), reason and all
}

// "Milo needs your OK", "Iris has a question": the plain title kept for scanning, beside the creature's own words.
export const askVerb = (e: FeedEntry) => ({ permission: 'needs your OK', question: 'has a question', plan: 'has a plan for you' })[typeof e.ask === 'object' ? e.ask.type : 'question'] ?? 'has a question'
export const askIcon = (type?: string): IconName => (type === 'plan' ? 'plan' : type === 'question' ? 'question' : 'permission')

export function AskCard(props: AskProps) {
  const ask = props.e.ask
  if (typeof ask !== 'object') return null
  if (ask.type === 'question') return <QuestionCard {...props} ask={ask} />
  if (ask.type === 'plan') return <PlanCard {...props} ask={ask} />
  return <PermissionCard {...props} ask={ask} />
}

// Sending an answer: which button is waiting on the computer, and what went wrong.
function useSend({ e, onAnswer }: AskProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const send = async (which: string, reply: Reply) => {
    setBusy(which)
    setError('')
    try {
      await onAnswer(e.id, reply)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
      setBusy(null)
    }
  }
  return { busy, error, send }
}

function Foot({ t, e, error, disabled, send, busy, compact }: { t: Theme; e: FeedEntry; error: string; disabled?: string | null; send: (w: string, r: Reply) => void; busy: string | null; compact?: boolean }) {
  const name = displayName(e.from).base
  const said = disabled ? <Text style={[styles.error, { color: t.waitingInk }]}>{disabled}</Text> : error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null
  // in the deck at the top of the chat, only what went wrong (the header already says when the computer is away, and
  // the card mustn't grow when it goes): the rest is in the full card
  if (compact) return error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null
  // an agent tool's card (crew app) is answered only here: its terminal is just waiting
  if (e.cli === 'crew') return said ? <View style={styles.foot}>{said}</View> : null
  return (
    <View style={styles.foot}>
      {said}
      {e.cli === 'codex' && !(typeof e.ask === 'object' && e.ask?.type === 'permission' && e.ask.trust) ? (
        <Press onPress={() => send('terminal', { terminal: true })} disabled={Boolean(busy || disabled)} accessibilityRole="button" style={styles.elsewhereBtn}>
          <Text style={[styles.elsewhere, { color: t.accent }]}>Answer in {name}'s terminal instead</Text>
        </Press>
      ) : (
        <Text style={[styles.elsewhere, { color: t.fg2 }]}>Or answer in its terminal on your computer.</Text>
      )}
    </View>
  )
}

function Title({ t, icon, text }: { t: Theme; icon: IconName; text: string }) {
  return (
    <View style={styles.title}>
      <Icon name={icon} size={20} color={t.waitingInk} weight="medium" />
      <Text style={[styles.titleText, { color: t.fg }]} numberOfLines={2} accessibilityRole="header">
        {text}
      </Text>
    </View>
  )
}

// A field for your own words, with a send arrow inside it once there's something to send (the card never grows).
function Note({ t, value, onChange, placeholder, onSubmit, editable }: { t: Theme; value: string; onChange: (s: string) => void; placeholder: string; onSubmit?: () => void; editable: boolean }) {
  const can = Boolean(value.trim() && onSubmit && editable)
  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.fg2}
        onSubmitEditing={() => can && onSubmit?.()}
        returnKeyType="send"
        submitBehavior="blurAndSubmit"
        editable={editable}
        multiline={false}
        accessibilityLabel={placeholder}
        style={[styles.note, styles.noteWithSend, { color: t.fg, backgroundColor: t.fill }]}
      />
      <Press onPress={() => can && onSubmit?.()} disabled={!can} style={[styles.noteSend, { backgroundColor: can ? t.brand : 'transparent' }]} accessibilityRole="button" accessibilityLabel="Send" accessibilityElementsHidden={!can} importantForAccessibility={can ? 'auto' : 'no-hide-descendants'}>
        {can ? <Icon name="send" size={15} color={t.onBrand} weight="bold" /> : null}
      </Press>
    </View>
  )
}

function Code({ t, code, compact }: { t: Theme; code: string; compact?: boolean }) {
  return (
    <ScrollView style={[styles.code, { backgroundColor: t.fill, maxHeight: compact ? 66 : 220 }]} nestedScrollEnabled>
      <Text style={[styles.codeText, { color: t.fg }]} selectable>
        {code}
      </Text>
    </ScrollView>
  )
}

function PermissionCard(props: AskProps & { ask: PermissionAsk }) {
  const { t, e, ask, compact, onMore, disabled, voiced } = props
  const [draft, setDraft] = useDraft(e.id)
  const { busy, error, send } = useSend(props)
  const name = displayName(e.from).base
  const note = draft.note ?? ''
  const always = ask.always ?? []
  const detail = voiced && reasonOf(ask) ? '' : ask.detail
  const off = Boolean(busy || disabled)
  // a CLI's "do you trust this folder?" (desktop core/hub.js trustCard): the computer picks the answer in its terminal
  const trust = Boolean(ask.trust)
  return (
    <View style={styles.body}>
      {compact ? null : <Title t={t} icon="permission" text={ask.title ?? 'Use a tool'} />}
      {ask.code ? <Code t={t} code={ask.code} compact={compact} /> : compact ? <Title t={t} icon="permission" text={ask.title ?? 'Use a tool'} /> : null}
      {detail ? (
        <Text style={[styles.detail, { color: t.fg2 }]} numberOfLines={compact ? 1 : 4}>
          {detail}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button t={t} small={compact} title={trust ? "Don't trust" : 'Deny'} flex disabled={off} busy={busy === 'deny'} onPress={() => send('deny', { allow: false, ...(note.trim() && { note: note.trim() }) })} accessibilityLabel={trust ? `Don't trust it. ${name} quits` : `Deny. ${name} won't ${ask.code ? 'run it' : 'do it'}`} />
        <Button t={t} small={compact} kind="primary" title={trust ? 'Trust' : 'Allow'} flex disabled={off} busy={busy === 'allow'} onPress={() => send('allow', { allow: true })} accessibilityLabel={trust ? `Trust ${ask.detail ?? 'its folder'}` : `Allow ${name} to ${ask.code && !ask.app ? `run ${ask.code.split('\n')[0]}` : (ask.title ?? 'go ahead').toLowerCase()}`} />
      </View>
      {trust ? null : compact ? (
        always.length || onMore ? (
          <Press onPress={onMore} accessibilityRole="button" style={styles.more}>
            <Text style={[styles.moreText, { color: t.fg2 }]}>{always.length ? 'Always allow, or say no with a note' : 'Say no with a note'}</Text>
            <Icon name="right" size={12} color={t.fg3} />
          </Press>
        ) : null
      ) : (
        <>
          {always.map((s) => (
            // an action, like Allow and Deny: the label alone on a secondary button
            <Button key={s.i} t={t} title={s.label} wrap disabled={off} busy={busy === `always${s.i}`} onPress={() => send(`always${s.i}`, { allow: true, always: s.i })} />
          ))}
          <Note t={t} value={note} onChange={(v) => setDraft({ ...draft, note: v })} placeholder={`Or tell ${name} what to do instead`} editable={!off} onSubmit={() => note.trim() && send('deny', { allow: false, note: note.trim() })} />
        </>
      )}
      <Foot t={t} e={e} error={error} disabled={disabled} send={send} busy={busy} compact={compact} />
    </View>
  )
}

// One choice as a full-width button: tap it and that's the answer.
function Choice({ t, label, description, onPress, busy, disabled, on, role }: { t: Theme; label: string; description?: string; onPress: () => void; busy?: boolean; disabled?: boolean; on?: boolean; role?: 'radio' | 'checkbox' | 'button' }) {
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role ?? 'button'}
      accessibilityState={role && role !== 'button' ? { checked: Boolean(on), disabled } : { disabled, busy }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      style={[styles.choice, { backgroundColor: on ? t.needsTint : t.fill, borderColor: on ? t.waiting : 'transparent' }]}
    >
      <View style={[styles.choiceText, busy && { opacity: 0 }]}>
        <Text style={[styles.choiceLabel, { color: t.fg }]}>{label}</Text>
        {description ? <Text style={[styles.choiceDesc, { color: t.fg2 }]}>{description}</Text> : null}
      </View>
      {role === 'radio' || role === 'checkbox' ? (
        // the check's place is kept, so picking never moves the text
        <View style={[styles.check, role === 'checkbox' && styles.checkSquare, { borderColor: on ? t.waiting : t.lineStrong, backgroundColor: on ? t.waiting : 'transparent' }]}>{on ? <Icon name="check" size={11} color="#fff" weight="bold" /> : null}</View>
      ) : null}
      {busy ? <ActivityIndicator style={StyleSheet.absoluteFill} color={t.fg} size="small" /> : null}
    </Press>
  )
}

function QuestionCard(props: AskProps & { ask: QuestionAsk }) {
  const { t, e, ask, compact, disabled } = props
  const [draft, setDraft] = useDraft(e.id)
  const { busy, error, send } = useSend(props)
  const picks = (qi: number) => draft.picks?.[qi] ?? []
  const other = (qi: number) => draft.other?.[qi] ?? ''
  const ready = ask.questions.every((_, qi) => other(qi).trim() || picks(qi).length)
  const pick = (qi: number, label: string, multi?: boolean) => {
    const was = picks(qi)
    const next = multi ? (was.includes(label) ? was.filter((x) => x !== label) : [...was, label]) : was[0] === label ? [] : [label]
    // a single choice replaces what was typed under "something else"
    setDraft({ ...draft, picks: { ...draft.picks, [qi]: next }, other: multi ? draft.other : { ...draft.other, [qi]: '' } })
  }
  const answers = () => Object.fromEntries(ask.questions.map((q, qi) => [q.question, other(qi).trim() ? [...picks(qi), other(qi).trim()] : picks(qi)]))
  const off = Boolean(busy || disabled)
  // one question with one answer: a tap on a choice is the answer
  const direct = !compact && ask.questions.length === 1 && !ask.questions[0].multiSelect
  const name = displayName(e.from).base
  return (
    <View style={styles.body}>
      {ask.questions.map((q, qi) => (
        <View key={qi} style={[styles.question, qi > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 }]}>
          {q.header || q.multiSelect ? (
            <Text style={[styles.qhead, { color: t.fg2 }]}>
              {[q.header, q.multiSelect ? 'Pick any' : ''].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {/* the creature already says a lone question in its own words */}
          {direct && props.voiced ? null : <Text style={[styles.qtext, { color: t.fg }]}>{q.question}</Text>}
          <View style={styles.options}>
            {q.options.map((o) =>
              direct ? (
                <Choice key={o.label} t={t} label={o.label} description={o.description} disabled={off} busy={busy === `pick:${o.label}`} onPress={() => send(`pick:${o.label}`, { answers: { [q.question]: [o.label] } })} />
              ) : (
                <Choice key={o.label} t={t} label={o.label} description={compact ? undefined : o.description} disabled={off} on={picks(qi).includes(o.label)} role={q.multiSelect ? 'checkbox' : 'radio'} onPress={() => pick(qi, o.label, q.multiSelect)} />
              ),
            )}
          </View>
          {compact ? null : (
            <Note
              t={t}
              value={other(qi)}
              onChange={(v) => setDraft({ ...draft, other: { ...draft.other, [qi]: v }, picks: q.multiSelect ? draft.picks : { ...draft.picks, [qi]: [] } })}
              placeholder={direct ? `Or tell ${name} something else` : 'Something else'}
              editable={!off}
              onSubmit={direct ? () => send('send', { answers: answers() }) : undefined}
            />
          )}
        </View>
      ))}
      {direct ? null : (
        <View style={styles.row}>
          {compact && props.onMore ? <Button t={t} small title="Something else" flex onPress={props.onMore} disabled={off} /> : null}
          <Button t={t} small={compact} kind="primary" title={ask.questions.length > 1 ? 'Send answers' : 'Send answer'} flex disabled={!ready || off} busy={busy === 'send'} onPress={() => send('send', { answers: answers() })} />
        </View>
      )}
      <Foot t={t} e={e} error={error} disabled={disabled} send={send} busy={busy} compact={compact} />
    </View>
  )
}

// A plan's lines without the Markdown: headings stand out, list numbers and bullets stay.
function previewLines(plan: string) {
  return String(plan ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(```|~~~|---|\|)/.test(l))
    .map((l) => ({ head: /^#{1,6}\s/.test(l), text: l.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '• ').replace(/\*\*|__|`/g, '') }))
}

function PlanCard(props: AskProps & { ask: PlanAsk }) {
  const { t, e, ask, compact, disabled } = props
  const [draft, setDraft] = useDraft(e.id)
  const { busy, error, send } = useSend(props)
  const name = displayName(e.from).base
  const note = draft.note ?? ''
  const off = Boolean(busy || disabled)
  return (
    <View style={styles.body}>
      {compact ? null : <Title t={t} icon="plan" text="Plan" />}
      {compact ? (
        // the deck shows the plan's first lines, as text; the whole plan, formatted, is a tap away (the card's sheet)
        <View style={[styles.plan, styles.planInner, { backgroundColor: t.fill }]}>
          <Text style={[styles.preview, { color: t.fg }]} numberOfLines={5}>
            {previewLines(ask.plan).map((l, i) => (
              <Text key={i} style={l.head ? styles.previewHead : undefined}>
                {i ? '\n' : ''}
                {l.text}
              </Text>
            ))}
          </Text>
        </View>
      ) : (
        <ScrollView style={[styles.plan, { backgroundColor: t.fill, maxHeight: 360 }]} contentContainerStyle={styles.planInner} nestedScrollEnabled>
          <Markdown text={ask.plan} t={t} color={t.fg} size={15} />
        </ScrollView>
      )}
      <View style={styles.row}>
        <Button t={t} small={compact} title="Keep planning" flex disabled={off} busy={busy === 'deny'} onPress={() => send('deny', { allow: false, ...(note.trim() && { note: note.trim() }) })} />
        <Button t={t} small={compact} kind="primary" title="Approve plan" flex disabled={off} busy={busy === 'allow'} onPress={() => send('allow', { allow: true })} />
      </View>
      {compact ? null : <Note t={t} value={note} onChange={(v) => setDraft({ ...draft, note: v })} placeholder={`What should ${name} change?`} editable={!off} onSubmit={() => note.trim() && send('deny', { allow: false, note: note.trim() })} />}
      <Foot t={t} e={e} error={error} disabled={disabled} send={send} busy={busy} compact={compact} />
    </View>
  )
}

// ---- answered ----

export function answerLine(type: string | undefined, a: Answer, what = ''): { icon: IconName; tone: 'ok' | 'no' | 'quiet'; text: string } {
  if (a.stale) return { icon: 'dash', tone: 'quiet', text: 'No longer waiting' }
  if (a.by === 'terminal') return { icon: 'keyboard', tone: 'quiet', text: a.handedOver ? 'Handed to its terminal' : 'Answered in the terminal' }
  if (a.by === 'cli') return { icon: 'close', tone: 'no', text: `Claude Code said no${a.why ? ` (${a.why})` : ''}` }
  if (type === 'question') return { icon: 'check', tone: 'ok', text: Object.values(a.answers ?? {}).join(' · ') || 'Answered' }
  if (type === 'plan') return a.allow ? { icon: 'check', tone: 'ok', text: 'Plan approved' } : { icon: 'undo', tone: 'quiet', text: `Keep planning${a.note ? `: “${a.note}”` : ''}` }
  if (a.failed) return { icon: 'close', tone: 'no', text: `Allowed, but it didn't work: ${a.failed}` }
  if (a.allow) return { icon: 'check', tone: 'ok', text: a.always ? a.always : `Allowed${what ? ` · ${what}` : ''}` }
  return { icon: 'close', tone: 'no', text: `Said no${a.note ? `: “${a.note}”` : ''}` }
}

export function AskSummary({ t, e, plain }: { t: Theme; e: FeedEntry; plain?: boolean }) {
  const ask = typeof e.ask === 'object' ? e.ask : null
  if (!ask || !e.answer) return null
  const what = ask.type === 'permission' ? (ask.title ?? '') : ''
  const trusted = ask.type === 'permission' && ask.trust && e.answer.by === 'you'
  const line = trusted ? (e.answer.allow ? { icon: 'check' as const, tone: 'ok' as const, text: 'Trusted' } : { icon: 'close' as const, tone: 'no' as const, text: 'Not trusted' }) : answerLine(ask.type, e.answer, what)
  const ink = line.tone === 'ok' ? t.workingInk : line.tone === 'no' ? t.danger : t.fg2
  const questions = ask.type === 'question' ? Object.entries(e.answer.answers ?? {}) : []
  return (
    <View style={[styles.summary, plain ? styles.summaryPlain : { backgroundColor: t.fill }]}>
      <View style={[styles.mark, { backgroundColor: t.fill }]}>
        <Icon name={line.icon} size={10} color={ink} weight="bold" />
      </View>
      {questions.length ? (
        <View style={styles.summaryText}>
          {questions.map(([q, v]) => (
            <Text key={q} style={[styles.summaryLine, { color: t.fg2 }]}>
              {q} <Text style={{ color: t.fg, fontWeight: '600' }}>{v}</Text>
            </Text>
          ))}
        </View>
      ) : (
        <Text style={[styles.summaryLine, styles.summaryText, { color: t.fg }]}>
          {line.text}
          {ask.type === 'permission' && line.tone !== 'ok' && what ? <Text style={{ color: t.fg2 }}>{`  ${what}`}</Text> : null}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: 8 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  titleText: { flex: 1, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  code: { borderRadius: 10, flexGrow: 0, overflow: 'hidden' },
  codeText: { fontFamily: fonts.mono, fontSize: 15, lineHeight: 20, paddingHorizontal: 12, paddingVertical: 12 },
  detail: { fontSize: 15, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  moreText: { fontSize: 15, lineHeight: 20 },
  note: { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  noteWithSend: { paddingRight: 48 },
  noteSend: { position: 'absolute', right: 6, top: 6, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  foot: { gap: 6, marginTop: 4 },
  error: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  elsewhere: { fontSize: 13, lineHeight: 18 },
  elsewhereBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  question: { gap: 8 },
  qhead: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  qtext: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  options: { gap: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5 },
  choiceText: { flex: 1, gap: 2 },
  choiceLabel: { fontSize: 17, lineHeight: 22, fontWeight: '500' },
  choiceDesc: { fontSize: 15, lineHeight: 20 },
  check: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkSquare: { borderRadius: 6 },
  preview: { fontSize: 15, lineHeight: 20 },
  previewHead: { fontWeight: '600' },
  plan: { borderRadius: 10, flexGrow: 0, overflow: 'hidden' },
  planInner: { padding: 12 },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, alignSelf: 'flex-start', maxWidth: '100%' },
  summaryPlain: { paddingHorizontal: 0, paddingVertical: 0 },
  mark: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  summaryText: { flexShrink: 1, gap: 2 },
  summaryLine: { fontSize: 15, lineHeight: 20 },
})

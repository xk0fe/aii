// An agent's question as a card you answer from the phone (hub.js askOf / decide): a permission prompt, its own
// multiple-choice questions, or a plan to approve. What you pick and type is kept per card while you look elsewhere.
// Answered, a card folds into a line saying what happened.
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import type { Answer, FeedEntry, PermissionAsk, PlanAsk, QuestionAsk, Reply } from '@/net/types'

import { displayName } from './format'
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
}

export const askVerb = (e: FeedEntry) => ({ permission: 'needs your OK', question: 'asks', plan: 'has a plan for you' })[typeof e.ask === 'object' ? e.ask.type : 'question'] ?? 'asks'
export const askIcon = (type?: string): IconName => (type === 'plan' ? 'plan' : type === 'question' ? 'question' : 'permission')

export function AskCard(props: AskProps) {
  const ask = props.e.ask
  if (typeof ask !== 'object') return null
  if (ask.type === 'question') return <QuestionCard {...props} ask={ask} />
  if (ask.type === 'plan') return <PlanCard {...props} ask={ask} />
  return <PermissionCard {...props} ask={ask} />
}

// Sending an answer: which button is waiting on the Mac, and what went wrong.
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
  // in the deck at the top of the chat, only what went wrong (the header already says when the Mac is away, and the
  // card mustn't grow when it goes): the rest is in the full card
  if (compact) return error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null
  return (
    <View style={styles.foot}>
      {said}
      {e.cli === 'codex' ? (
        <Press onPress={() => send('terminal', { terminal: true })} disabled={Boolean(busy || disabled)} accessibilityRole="button">
          <Text style={[styles.elsewhere, { color: t.fg2, textDecorationLine: 'underline' }]}>Answer in {name}'s terminal instead</Text>
        </Press>
      ) : (
        <Text style={[styles.elsewhere, { color: t.fg3 }]}>or answer in its terminal on the Mac</Text>
      )}
    </View>
  )
}

function Title({ t, icon, text }: { t: Theme; icon: IconName; text: string }) {
  return (
    <View style={styles.title}>
      <View style={[styles.titleIcon, { backgroundColor: t.dark ? 'rgba(255,159,10,0.18)' : 'rgba(255,159,10,0.16)' }]}>
        <Icon name={icon} size={15} color={t.waitingInk} />
      </View>
      <Text style={[styles.titleText, { color: t.fg }]} numberOfLines={2}>
        {text}
      </Text>
    </View>
  )
}

function Note({ t, value, onChange, placeholder, onSubmit, editable }: { t: Theme; value: string; onChange: (s: string) => void; placeholder: string; onSubmit?: () => void; editable: boolean }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={t.fg3}
      onSubmitEditing={onSubmit}
      returnKeyType="send"
      submitBehavior="blurAndSubmit"
      editable={editable}
      multiline={false}
      style={[styles.note, { color: t.fg, backgroundColor: t.field, borderColor: t.lineStrong }]}
    />
  )
}

function PermissionCard(props: AskProps & { ask: PermissionAsk }) {
  const { t, e, ask, compact, onMore, disabled } = props
  const [draft, setDraft] = useDraft(e.id)
  const { busy, error, send } = useSend(props)
  const name = displayName(e.from).base
  const note = draft.note ?? ''
  const always = ask.always ?? []
  const off = Boolean(busy || disabled)
  return (
    <View style={styles.body}>
      <Title t={t} icon="permission" text={ask.title ?? 'Use a tool'} />
      {ask.code ? (
        <ScrollView style={[styles.code, { backgroundColor: t.codeBg, maxHeight: compact ? 66 : 220 }]} nestedScrollEnabled>
          <Text style={[styles.codeText, { color: t.fg }]} selectable>
            {ask.code}
          </Text>
        </ScrollView>
      ) : null}
      {ask.detail ? (
        <Text style={[styles.detail, { color: t.fg2 }]} numberOfLines={compact ? 1 : 4}>
          {ask.detail}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button t={t} small={compact} kind="danger" title="Deny" flex disabled={off} busy={busy === 'deny'} onPress={() => send('deny', { allow: false, ...(note.trim() && { note: note.trim() }) })} />
        <Button t={t} small={compact} kind="primary" title="Allow" flex disabled={off} busy={busy === 'allow'} onPress={() => send('allow', { allow: true })} />
      </View>
      {compact ? (
        always.length || onMore ? (
          <Press onPress={onMore} accessibilityRole="button" style={styles.more}>
            <Text style={[styles.moreText, { color: t.fg2 }]}>{always.length ? `Always allow… · say no with a note` : 'Say no with a note'}</Text>
            <Icon name="right" size={12} color={t.fg3} />
          </Press>
        ) : null
      ) : (
        <>
          {always.length ? (
            <View style={styles.always}>
              {always.map((s) => (
                <Press key={s.i} disabled={off} onPress={() => send(`always${s.i}`, { allow: true, always: s.i })} style={[styles.alwaysRow, { backgroundColor: t.btn }]} accessibilityRole="button" accessibilityLabel={s.label}>
                  <Icon name="check" size={13} color={t.workingInk} />
                  <Text style={[styles.alwaysText, { color: t.fg }]}>{s.label}</Text>
                </Press>
              ))}
            </View>
          ) : null}
          <Note t={t} value={note} onChange={(v) => setDraft({ ...draft, note: v })} placeholder={`Or tell ${name} what to do instead…`} editable={!off} onSubmit={() => note.trim() && send('deny', { allow: false, note: note.trim() })} />
        </>
      )}
      <Foot t={t} e={e} error={error} disabled={disabled} send={send} busy={busy} compact={compact} />
    </View>
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
  return (
    <View style={styles.body}>
      {ask.questions.map((q, qi) => (
        <View key={qi} style={[styles.question, qi > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 }]}>
          {q.header || q.multiSelect ? (
            <View style={styles.qhead}>
              {q.header ? (
                <View style={[styles.chip, { backgroundColor: t.dark ? 'rgba(255,159,10,0.18)' : 'rgba(255,159,10,0.15)' }]}>
                  <Text style={[styles.chipText, { color: t.waitingInk }]}>{q.header.toUpperCase()}</Text>
                </View>
              ) : null}
              {q.multiSelect ? <Text style={[styles.multi, { color: t.fg3 }]}>pick any</Text> : null}
            </View>
          ) : null}
          <Text style={[styles.qtext, { color: t.fg }]}>{q.question}</Text>
          <View style={styles.options}>
            {q.options.map((o) => {
              const on = picks(qi).includes(o.label)
              return (
                <Press
                  key={o.label}
                  disabled={off}
                  onPress={() => pick(qi, o.label, q.multiSelect)}
                  accessibilityRole={q.multiSelect ? 'checkbox' : 'radio'}
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={o.label}
                  style={[styles.option, compact && styles.optionCompact, { backgroundColor: on ? (t.dark ? 'rgba(10,132,255,0.16)' : 'rgba(10,132,255,0.08)') : t.field, borderColor: on ? t.accent : t.lineStrong, borderWidth: on ? 1.5 : StyleSheet.hairlineWidth * 2 }]}
                >
                  <View style={styles.optionText}>
                    <Text style={[styles.optionLabel, { color: t.fg }]}>{o.label}</Text>
                    {o.description ? (
                      <Text style={[styles.optionDesc, { color: t.fg2 }]} numberOfLines={compact ? 1 : undefined}>
                        {o.description}
                      </Text>
                    ) : null}
                  </View>
                  {/* the check's place is kept, so picking never moves the text */}
                  <View style={[styles.check, q.multiSelect && styles.checkSquare, { borderColor: on ? t.accent : t.lineStrong, backgroundColor: on ? t.accent : 'transparent' }]}>{on ? <Icon name="check" size={11} color="#fff" weight="bold" /> : null}</View>
                </Press>
              )
            })}
          </View>
          {compact ? null : (
            <TextInput
              value={other(qi)}
              onChangeText={(v) => setDraft({ ...draft, other: { ...draft.other, [qi]: v }, picks: q.multiSelect ? draft.picks : { ...draft.picks, [qi]: [] } })}
              placeholder="Something else…"
              placeholderTextColor={t.fg3}
              editable={!off}
              style={[styles.note, { color: t.fg, backgroundColor: t.field, borderColor: t.lineStrong }]}
            />
          )}
        </View>
      ))}
      <View style={styles.row}>
        {compact && props.onMore ? <Button t={t} small title="Something else" flex onPress={props.onMore} disabled={off} /> : null}
        <Button t={t} small={compact} kind="primary" title={ask.questions.length > 1 ? 'Send answers' : 'Send answer'} flex disabled={!ready || off} busy={busy === 'send'} onPress={() => send('send', { answers: answers() })} />
      </View>
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
        <View style={[styles.plan, styles.planInner, { backgroundColor: t.field, borderColor: t.lineStrong }]}>
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
        <ScrollView style={[styles.plan, { backgroundColor: t.field, borderColor: t.lineStrong, maxHeight: 360 }]} contentContainerStyle={styles.planInner} nestedScrollEnabled>
          <Markdown text={ask.plan} t={t} color={t.fg} size={14.5} />
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
  if (a.allow) return { icon: 'check', tone: 'ok', text: a.always ? a.always : `Allowed${what ? ` · ${what}` : ''}` }
  return { icon: 'close', tone: 'no', text: `Said no${a.note ? `: “${a.note}”` : ''}` }
}

export function AskSummary({ t, e, plain }: { t: Theme; e: FeedEntry; plain?: boolean }) {
  const ask = typeof e.ask === 'object' ? e.ask : null
  if (!ask || !e.answer) return null
  const what = ask.type === 'permission' ? (ask.title ?? '') : ''
  const line = answerLine(ask.type, e.answer, what)
  const ink = line.tone === 'ok' ? t.workingInk : line.tone === 'no' ? t.danger : t.fg2
  const questions = ask.type === 'question' ? Object.entries(e.answer.answers ?? {}) : []
  return (
    <View style={[styles.summary, plain ? styles.summaryPlain : { backgroundColor: t.btn }]}>
      <View style={[styles.mark, { backgroundColor: line.tone === 'quiet' ? t.btn : line.tone === 'ok' ? 'rgba(52,199,89,0.16)' : 'rgba(255,69,58,0.14)' }]}>
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
          {ask.type === 'permission' && line.tone !== 'ok' && what ? <Text style={{ color: t.fg3 }}>{`  ${what}`}</Text> : null}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: 12 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  titleText: { flex: 1, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  code: { borderRadius: 10, flexGrow: 0, overflow: 'hidden' },
  codeText: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, paddingHorizontal: 12, paddingVertical: 10 },
  detail: { fontSize: 14, lineHeight: 19, marginTop: -4 },
  row: { flexDirection: 'row', gap: 10 },
  always: { gap: 8 },
  alwaysRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 12, borderRadius: 10 },
  alwaysText: { flex: 1, fontSize: 14, fontWeight: '500' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  moreText: { fontSize: 14, fontWeight: '500' },
  note: { minHeight: 42, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth * 2, paddingHorizontal: 12, fontSize: 15 },
  foot: { gap: 6 },
  error: { fontSize: 13, fontWeight: '500' },
  elsewhere: { fontSize: 12.5 },
  question: { gap: 10 },
  qhead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  chipText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6 },
  multi: { fontSize: 12.5 },
  qtext: { fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.15 },
  options: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12 },
  optionCompact: { paddingVertical: 7 },
  optionText: { flex: 1, gap: 1 },
  optionLabel: { fontSize: 15, fontWeight: '600' },
  optionDesc: { fontSize: 13.5, lineHeight: 18 },
  check: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkSquare: { borderRadius: 6 },
  preview: { fontSize: 14.5, lineHeight: 20 },
  previewHead: { fontWeight: '700' },
  plan: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth * 2, flexGrow: 0, overflow: 'hidden' },
  planInner: { padding: 12 },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 12, alignSelf: 'flex-start', maxWidth: '100%' },
  summaryPlain: { paddingHorizontal: 0, paddingVertical: 0 },
  mark: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 0.5 },
  summaryText: { flexShrink: 1, gap: 2 },
  summaryLine: { fontSize: 14, lineHeight: 19 },
})

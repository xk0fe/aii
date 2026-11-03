// An agent, opened: who it is (on its felt patch, acting out its status), what it's doing, how full its conversation
// is, its switches (on/off, YOLO, Fast) and what you can do from the agent's menu on the computer.
import { router, useIsFocused, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'

import { openConvo } from '@/state/convo'
import { useCrew, useDerived } from '@/state/hooks'
import { agentColor } from '@/ui/avatar'
import { Creature, MotionContext } from '@/ui/creature'
import { activityWords, ago, brainLine, displayName, plural, rowLine, statusWord } from '@/ui/format'
import { useAppActive, useNow } from '@/ui/hooks'
import { Icon, type IconName } from '@/ui/icon'
import { ContextRing, Dot, Press, Tag, tap } from '@/ui/parts'
import { needsOf } from '@/ui/room'
import { Patch } from '@/ui/surface'
import { offlineText } from '@/ui/topbar'
import { fonts, useTheme, type Theme } from '@/ui/theme'

const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

function SwitchRow({ t, title, detail, value, onChange, disabled, last }: { t: Theme; title: string; detail: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; last?: boolean }) {
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: t.fg }]}>{title}</Text>
        <Text style={[styles.rowDetail, { color: t.fg2 }]}>{detail}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: t.working }} accessibilityLabel={title} accessibilityHint={detail} />
    </View>
  )
}

function ActionRow({ t, icon, title, detail, onPress, disabled, last }: { t: Theme; icon: IconName; title: string; detail: string; onPress: () => void; disabled?: boolean; last?: boolean }) {
  return (
    <Press onPress={onPress} disabled={disabled} style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={detail}>
      <Icon name={icon} size={20} color={t.fg2} weight="regular" />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: t.fg }]}>{title}</Text>
        <Text style={[styles.rowDetail, { color: t.fg2 }]}>{detail}</Text>
      </View>
      <Icon name="right" size={13} color={t.fg3} />
    </Press>
  )
}

export default function AgentSheet() {
  const t = useTheme()
  const { name } = useLocalSearchParams<{ name: string }>()
  const { client, state, link } = useCrew()
  const d = useDerived(state)
  const now = useNow(15000)
  const focused = useIsFocused()
  const active = useAppActive()
  // what you just switched, until the computer's state agrees (or says no)
  const [pending, setPending] = useState<{ on?: boolean; yolo?: boolean; fast?: boolean }>({})
  const [error, setError] = useState('')
  const asks = useMemo(() => new Map(needsOf(d.agents, d.open).map((n) => [n.agent.name, n.kind])), [d.agents, d.open])
  const a = d.byName.get(String(name))
  if (!a || !client) {
    return (
      <View style={[styles.gone, { backgroundColor: t.bg }]}>
        <Text style={[styles.rowDetail, { color: t.fg2 }]}>{displayName(String(name)).base} isn't in this workspace any more.</Text>
      </View>
    )
  }
  const offline = link.status === 'offline' ? offlineText(link, client.macName) : ''
  const line = rowLine(a, now)
  const st = statusWord(a, asks.get(a.name))
  const ctx = a.convo?.context
  const clones = d.clones.get(a.name) ?? []
  const helpers = (a.subs ?? []).filter((x) => !x.ended).length
  const base = displayName(a.name).base
  const value = (key: 'on' | 'yolo' | 'fast', actual: boolean) => pending[key] ?? actual

  const run = async (key: 'on' | 'yolo' | 'fast' | null, call: () => Promise<unknown>, next?: boolean) => {
    setError('')
    if (key) setPending((p) => ({ ...p, [key]: next }))
    tap()
    try {
      await call()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      if (key) setTimeout(() => setPending((p) => ({ ...p, [key]: undefined })), 700)
    }
  }
  const restart = () =>
    Alert.alert(`Restart ${base}?`, 'It starts again and picks up its conversation.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restart', onPress: () => void run(null, () => client.agentAction('restart', a.name)) },
    ])
  const message = () => {
    openConvo(a.name)
    router.dismissTo('/chat')
  }

  return (
    <MotionContext.Provider value={focused && active}>
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={[styles.name, { color: t.fg }]} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.6}>
              {base}
            </Text>
            {a.area ? <Text style={[styles.area, { color: t.fg2 }]}>{a.area}</Text> : null}
            <View style={styles.idLine}>
              <Text style={[styles.area, { color: t.fg2, flexShrink: 1 }]}>{[brainLine(a, state?.providers) || 'Agent', a.home ? `on ${a.homeName ?? a.home}` : ''].filter(Boolean).join(' · ')}</Text>
              {a.yolo ? <Tag t={t} text="YOLO" label="YOLO: skips every permission prompt" /> : null}
            </View>
          </View>
          <Patch color={a.on ? agentColor(a) : '#9A9A9A'} width={128} height={128}>
            <View style={styles.heroCreature} pointerEvents="none">
              <Creature agent={a} size={116} posed ask={asks.get(a.name)} />
            </View>
          </Patch>
        </View>

        <View style={[styles.group, { backgroundColor: t.surface }]}>
          <View style={styles.statusRow}>
            <Dot t={t} kind={a.on ? line.kind : 'off'} size={9} />
            <Text style={[styles.status, { color: st.kind === 'waiting' ? t.waitingInk : t.fg }]}>{st.text}</Text>
            {a.on && (a.status === 'working' || a.status === 'waiting') && a.since ? <Text style={[styles.rowDetail, { color: t.fg2 }]}>{ago(a.since, now)}</Text> : null}
          </View>
          {a.queue ? <Text style={[styles.rowDetail, { color: t.fg2 }]}>{plural(a.queue, 'message')} waiting for it</Text> : null}
          {helpers ? <Text style={[styles.rowDetail, { color: t.fg2 }]}>{plural(helpers, 'helper')} at work for it</Text> : null}
          {clones.length ? (
            <Text style={[styles.rowDetail, { color: t.fg2 }]}>
              {plural(clones.length, 'clone')}: {clones.map((c) => `${displayName(c.name).base} (${c.status === 'working' && c.activity ? activityWords(c.activity) : statusWord(c).text.toLowerCase()})`).join(', ')}
            </Text>
          ) : null}
          {ctx ? (
            <View style={styles.ctxRow}>
              <ContextRing t={t} ctx={ctx} compacted={Boolean(a.convo?.compactions)} size={20} />
              <Text style={[styles.rowDetail, { color: t.fg2, flex: 1 }]}>
                {k(ctx.used)} of {k(ctx.size)}
                {ctx.limit ? ' limit' : ''} · {plural(a.convo?.tasks ?? 0, 'task')} in this conversation{a.convo?.compactions ? ' · compacted' : ''}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={[styles.section, { color: t.fg }]} accessibilityRole="header">
          Switches
        </Text>
        <View style={[styles.group, styles.list, { backgroundColor: t.surface }]}>
          <SwitchRow t={t} title="On" detail={a.on ? 'It takes messages and tasks' : 'Off: its conversation waits'} value={value('on', a.on)} onChange={(v) => void run('on', () => client.power(a.name, v), v)} disabled={Boolean(offline)} />
          <SwitchRow t={t} title="YOLO" detail="Skips every permission prompt" value={value('yolo', Boolean(a.yolo))} onChange={(v) => void run('yolo', () => client.setModes(a.name, { yolo: v }), v)} disabled={Boolean(offline)} last={a.fast === undefined} />
          {a.fast !== undefined ? <SwitchRow t={t} title="Fast" detail="The faster, pricier service tier" value={value('fast', Boolean(a.fast))} onChange={(v) => void run('fast', () => client.setModes(a.name, { fast: v }), v)} disabled={Boolean(offline)} last /> : null}
        </View>

        <Text style={[styles.section, { color: t.fg }]} accessibilityRole="header">
          Do
        </Text>
        <View style={[styles.group, styles.list, { backgroundColor: t.surface }]}>
          <ActionRow t={t} icon="message" title={`Message ${base}`} detail="Your conversation with it, in the chat" onPress={message} />
          <ActionRow t={t} icon="fresh" title="New conversation" detail={a.freshPending ? 'Starts once it finishes what it’s doing' : 'A clean slate: instructions, folder and notes stay'} onPress={() => void run(null, () => client.agentAction('freshStart', a.name))} disabled={Boolean(offline) || !a.on || a.freshPending} />
          <ActionRow t={t} icon="restart" title="Restart" detail="Starts it again, same conversation" onPress={restart} disabled={Boolean(offline) || !a.on} />
          <ActionRow t={t} icon="free" title="Mark idle" detail="If it looks stuck at work" onPress={() => void run(null, () => client.agentAction('markIdle', a.name))} disabled={Boolean(offline) || !a.on || a.status === 'idle'} last />
        </View>
        <Text style={[styles.error, { color: offline ? t.waitingInk : t.danger }]}>{offline ? `${offline}. Switches wait until it's back.` : error || ' '}</Text>
      </ScrollView>
    </MotionContext.Provider>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 28, gap: 12, paddingBottom: 48 },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
  heroText: { flex: 1, gap: 4 },
  heroCreature: { position: 'absolute', left: 6, bottom: 3 },
  name: { fontFamily: fonts.brand, fontSize: 28, lineHeight: 34 },
  area: { fontSize: 15, lineHeight: 20 },
  idLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  group: { borderRadius: 14, padding: 16, gap: 8 },
  list: { paddingVertical: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  status: { fontSize: 17, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
  ctxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  section: { fontSize: 15, lineHeight: 20, fontWeight: '600', marginTop: 12, marginLeft: 16, marginBottom: -4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 10 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 17, lineHeight: 22 },
  rowDetail: { fontSize: 15, lineHeight: 20 },
  error: { fontSize: 15, lineHeight: 20, textAlign: 'center', minHeight: 20 },
})

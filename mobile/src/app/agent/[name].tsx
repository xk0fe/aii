// An agent, opened: who it is, what it's doing, how full its conversation is, its switches (on/off, YOLO, Fast) and
// what you can do from the agent's menu on the Mac.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'

import type { Agent } from '@/net/types'
import { openConvo } from '@/state/convo'
import { useCrew, useDerived } from '@/state/hooks'
import { agentColor } from '@/ui/avatar'
import { CardBack, cardInk } from '@/ui/agentCard'
import { dim } from '@/ui/color'
import { Creature } from '@/ui/creature'
import { brain, displayName, rowLine, statusText } from '@/ui/format'
import { useNow } from '@/ui/hooks'
import { Icon, type IconName } from '@/ui/icon'
import { ContextRing, Dot, inkFor, Press, tap } from '@/ui/parts'
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
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: t.accent }} accessibilityLabel={title} />
    </View>
  )
}

function ActionRow({ t, icon, title, detail, onPress, disabled, danger, last }: { t: Theme; icon: IconName; title: string; detail: string; onPress: () => void; disabled?: boolean; danger?: boolean; last?: boolean }) {
  return (
    <Press onPress={onPress} disabled={disabled} style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]} accessibilityRole="button" accessibilityLabel={title}>
      <View style={[styles.actionIcon, { backgroundColor: t.btn }]}>
        <Icon name={icon} size={15} color={danger ? t.danger : t.fg2} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: danger ? t.danger : t.fg }]}>{title}</Text>
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
  // what you just switched, until the Mac's state agrees (or says no)
  const [pending, setPending] = useState<{ on?: boolean; yolo?: boolean; fast?: boolean }>({})
  const [error, setError] = useState('')
  const a = d.byName.get(String(name))
  if (!a || !client) {
    return (
      <View style={[styles.gone, { backgroundColor: t.bg }]}>
        <Text style={[styles.rowDetail, { color: t.fg2 }]}>{name} isn't in this workspace any more.</Text>
      </View>
    )
  }
  const offline = link.status === 'offline' ? offlineText(link, client.macName) : ''
  const color = a.on ? agentColor(a) : dim(agentColor(a), 0.25, 1)
  const ink = cardInk(color)
  const line = rowLine(a, now)
  const ctx = a.convo?.context
  const clones = d.clones.get(a.name) ?? []
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
    Alert.alert(`Restart ${displayName(a.name).base}?`, 'Its CLI starts again and picks up its conversation.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restart', onPress: () => void run(null, () => client.agentAction('restart', a.name)) },
    ])
  const message = () => {
    openConvo(a.name)
    router.dismissTo('/chat')
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <View style={[styles.hero, { shadowColor: color }]}>
        <CardBack color={color} id={`sheet${a.name.replace(/[^a-z0-9]/gi, '')}`} radius={26} />
        <View style={styles.heroText}>
          <Text style={[styles.name, { color: ink }]} numberOfLines={1}>
            {displayName(a.name).base}
          </Text>
          {a.area ? <Text style={[styles.area, { color: ink }]}>{a.area}</Text> : null}
          <View style={styles.chips}>
            <View style={styles.chip}>
              <Text style={[styles.chipText, { color: ink }]}>{brain(a, state?.providers) || 'Agent'}</Text>
            </View>
            {a.home ? (
              <View style={styles.chip}>
                <Text style={[styles.chipText, { color: ink }]}>on {a.homeName ?? a.home}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.heroCreature} pointerEvents="none">
          <Creature agent={a} size={128} />
        </View>
      </View>

      <View style={[styles.group, { backgroundColor: t.card }]}>
        <View style={styles.statusRow}>
          <Dot t={t} kind={a.on ? line.kind : 'off'} size={9} />
          <Text style={[styles.status, { color: inkFor(t, a.on ? line.kind : 'off') }]}>{statusText(a, now)}</Text>
          {a.queue ? <Text style={[styles.rowDetail, { color: t.fg2 }]}>· {a.queue} queued</Text> : null}
        </View>
        {a.activity && (a.status === 'working' || a.status === 'waiting') ? (
          <Text style={[styles.activity, { color: t.fg2 }]} selectable>
            {a.activity}
          </Text>
        ) : null}
        {clones.length ? (
          <Text style={[styles.rowDetail, { color: t.fg2 }]}>
            {clones.length === 1 ? '1 clone' : `${clones.length} clones`} at work: {clones.map((c) => `${displayName(c.name).base} (${c.activity || c.status})`).join(', ')}
          </Text>
        ) : null}
        {ctx ? (
          <View style={styles.ctxRow}>
            <ContextRing t={t} ctx={ctx} compacted={Boolean(a.convo?.compactions)} size={20} />
            <Text style={[styles.rowDetail, { color: t.fg2, flex: 1 }]}>
              {k(ctx.used)} of {k(ctx.size)}
              {ctx.limit ? ' limit' : ''} · {a.convo?.tasks ?? 0} {a.convo?.tasks === 1 ? 'task' : 'tasks'} in this conversation{a.convo?.compactions ? ' · compacted' : ''}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.section, { color: t.fg2 }]}>Switches</Text>
      <View style={[styles.group, styles.list, { backgroundColor: t.card }]}>
        <SwitchRow t={t} title="On" detail={a.on ? 'It takes messages and tasks' : 'Off: its conversation waits'} value={value('on', a.on)} onChange={(v) => void run('on', () => client.power(a.name, v), v)} disabled={Boolean(offline)} />
        <SwitchRow t={t} title="YOLO" detail="Skips every permission prompt" value={value('yolo', Boolean(a.yolo))} onChange={(v) => void run('yolo', () => client.setModes(a.name, { yolo: v }), v)} disabled={Boolean(offline)} last={a.fast === undefined} />
        {a.fast !== undefined ? <SwitchRow t={t} title="Fast" detail="Codex's fast service tier" value={value('fast', Boolean(a.fast))} onChange={(v) => void run('fast', () => client.setModes(a.name, { fast: v }), v)} disabled={Boolean(offline)} last /> : null}
      </View>

      <Text style={[styles.section, { color: t.fg2 }]}>Do</Text>
      <View style={[styles.group, styles.list, { backgroundColor: t.card }]}>
        <ActionRow t={t} icon="message" title={`Message ${displayName(a.name).base}`} detail="Your conversation with it, in the chat" onPress={message} />
        <ActionRow t={t} icon="fresh" title="New conversation" detail={a.freshPending ? 'Starts once it finishes what it’s doing' : 'A clean slate: instructions, folder and notes stay'} onPress={() => void run(null, () => client.agentAction('freshStart', a.name))} disabled={Boolean(offline) || !a.on || a.freshPending} />
        <ActionRow t={t} icon="restart" title="Restart" detail="Starts its CLI again, same conversation" onPress={restart} disabled={Boolean(offline) || !a.on} />
        <ActionRow t={t} icon="free" title="Mark free" detail="If it looks stuck at work" onPress={() => void run(null, () => client.agentAction('markIdle', a.name))} disabled={Boolean(offline) || !a.on || a.status === 'idle'} last />
      </View>
      <Text style={[styles.error, { color: offline ? t.waitingInk : t.danger }]}>{offline ? `${offline}: switches wait until it's back` : error || ' '}</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 24, gap: 12, paddingBottom: 48 },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  hero: { height: 178, borderRadius: 26, padding: 18, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } },
  heroText: { paddingRight: 120, gap: 3 },
  heroCreature: { position: 'absolute', right: 8, bottom: 4 },
  name: { fontSize: 30, fontWeight: '800', letterSpacing: -0.7 },
  area: { fontSize: 15, fontWeight: '500', lineHeight: 20, opacity: 0.85 },
  chips: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, marginTop: 8 },
  chip: { height: 26, paddingHorizontal: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.62)', justifyContent: 'center', flexShrink: 1 },
  chipText: { fontSize: 13, fontWeight: '700' },
  group: { borderRadius: 18, padding: 14, gap: 8 },
  list: { paddingVertical: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { fontSize: 16, fontWeight: '700' },
  activity: { fontFamily: fonts.mono, fontSize: 13 },
  ctxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  section: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginLeft: 4, marginBottom: -4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowDetail: { fontSize: 13.5, lineHeight: 18 },
  actionIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 13.5, textAlign: 'center', minHeight: 18 },
})

// A channel, opened (or a new one): its name, its brief (what its agents are told with their first message there,
// and again when it changes) and who's in it. As the computer's channel sheet: #general keeps its name and has
// everyone, only its brief changes; deleting a channel leaves its messages in #general.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import { openChannel } from '@/state/convo'
import { GENERAL, useCrew, useDerived } from '@/state/hooks'
import { agentColor } from '@/ui/avatar'
import { nameInk } from '@/ui/color'
import { Creature } from '@/ui/creature'
import { displayName } from '@/ui/format'
import { Icon } from '@/ui/icon'
import { Button, Press, tap } from '@/ui/parts'
import { offlineText } from '@/ui/topbar'
import { useTheme, type Theme } from '@/ui/theme'

// As core/workspaces.js channelName makes it: lowercase words joined by dashes, at most 40 characters.
const tidy = (name: string) => name.toLowerCase().replace(/^#+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40)

function Check({ t, on }: { t: Theme; on: boolean }) {
  return <View style={styles.check}>{on ? <Icon name="check" size={17} color={t.accent} weight="bold" /> : null}</View>
}

export default function ChannelSheet() {
  const t = useTheme()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { client, link, state, ws } = useCrew()
  const d = useDerived(state)
  const c = id ? d.channels?.find((x) => x.id === id) : undefined
  const general = c?.id === GENERAL
  const [name, setName] = useState(c?.name ?? '')
  const [brief, setBrief] = useState(c?.brief ?? '')
  const [members, setMembers] = useState<string[] | null>(c?.members ?? null) // null: everyone
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const offline = client && link.status === 'offline' ? offlineText(link, client.macName) : ''

  if (id && !c)
    return (
      <View style={[styles.gone, { backgroundColor: t.bg }]}>
        <Text style={[styles.hint, { color: t.fg2 }]}>{d.channels ? 'This channel was deleted.' : 'Waiting for your computer…'}</Text>
      </View>
    )

  const clean = tidy(name).replace(/-+$/, '')
  const changed = !c || (!general && clean !== c.name) || brief.trim() !== (c.brief ?? '') || JSON.stringify(members ?? null) !== JSON.stringify(c.members ?? null)
  const toggle = (who: string) => {
    tap()
    const now = members ?? []
    const next = now.includes(who) ? now.filter((n) => n !== who) : [...now, who]
    setMembers(next.length ? next : null)
  }
  const save = async () => {
    if (!client || busy) return
    setBusy(true)
    setError('')
    try {
      const arg = { ...(!general && { name: clean }), brief: brief.trim(), ...(!general && { members }) }
      const done = await client.channel(c ? 'edit' : 'create', c?.id ?? null, arg)
      if (!c) openChannel(ws, done.id)
      router.back()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  const remove = () => {
    if (!client || !c || general) return
    Alert.alert(`Delete #${c.name}?`, 'Its messages stay, in #general. Agents stop getting its brief.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await client.channel('remove', c.id)
            openChannel(ws, GENERAL)
            router.back()
          } catch (e) {
            setError(String((e as Error)?.message ?? e))
          }
        },
      },
    ])
  }

  return (
    <KeyboardAwareScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content} bottomOffset={24} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: t.fg }]}>{c ? `#${c.name}` : 'New channel'}</Text>
      <Text style={[styles.hint, { color: t.fg2 }]}>{general ? 'Everyone in the workspace, and everything that has no channel of its own.' : 'A place for one kind of work, with its own brief and its own people.'}</Text>

      {general ? null : (
        <>
          <Text style={[styles.label, { color: t.fg2 }]}>Name</Text>
          <View style={[styles.field, styles.nameField, { backgroundColor: t.card }]}>
            <Text style={[styles.hash, { color: t.fg3 }]}>#</Text>
            <TextInput value={name} onChangeText={(v) => setName(tidy(v))} placeholder="release" placeholderTextColor={t.fg3} autoCapitalize="none" autoCorrect={false} autoFocus={!c} maxLength={40} style={[styles.input, { color: t.fg }]} accessibilityLabel="Channel name" testID="channel-name" />
          </View>
        </>
      )}

      <Text style={[styles.label, { color: t.fg2 }]}>Brief</Text>
      <TextInput
        value={brief}
        onChangeText={setBrief}
        placeholder="What it's for and how to work here. Each agent reads it with its first message in the channel."
        placeholderTextColor={t.fg3}
        multiline
        maxLength={4000}
        style={[styles.field, styles.brief, { backgroundColor: t.card, color: t.fg }]}
        accessibilityLabel="Brief"
        testID="channel-brief"
      />

      <Text style={[styles.label, { color: t.fg2 }]}>Who's in it</Text>
      <View style={[styles.list, { backgroundColor: t.card }]}>
        {general ? (
          <View style={styles.row}>
            <Text style={[styles.rowTitle, { color: t.fg }]}>Everyone in this workspace</Text>
          </View>
        ) : (
          <>
            <Press onPress={() => (tap(), setMembers(null))} style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]} accessibilityRole="button" accessibilityState={{ selected: !members }}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: t.fg }]}>Everyone</Text>
                <Text style={[styles.rowDetail, { color: t.fg2 }]}>Auto picks from the whole crew</Text>
              </View>
              <Check t={t} on={!members} />
            </Press>
            {d.agents.map((a, i) => {
              const on = Boolean(members?.includes(a.name))
              return (
                <Press key={a.name} onPress={() => toggle(a.name)} style={[styles.row, i < d.agents.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${displayName(a.name).base}${a.area ? `, ${a.area}` : ''}`}>
                  <Creature agent={a} size={32} mood="still" />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, { color: nameInk(agentColor(a), t.fg) }]}>{displayName(a.name).base}</Text>
                    {a.area ? (
                      <Text style={[styles.rowDetail, { color: t.fg2 }]} numberOfLines={1}>
                        {a.area}
                      </Text>
                    ) : null}
                  </View>
                  <Check t={t} on={on} />
                </Press>
              )
            })}
          </>
        )}
      </View>
      {general ? null : <Text style={[styles.note, { color: t.fg2 }]}>Auto picks only from who's in it. You can still @name anyone.</Text>}

      <Text style={[styles.error, { color: offline ? t.waitingInk : t.danger }]}>{offline ? `${offline}: changes wait until it's back` : error || ' '}</Text>
      <Button t={t} kind="primary" title={c ? 'Save' : 'Create channel'} onPress={save} busy={busy} disabled={!client || Boolean(offline) || !changed || (!general && !clean)} />
      {c && !general ? <Button t={t} kind="danger" title={`Delete #${c.name}`} onPress={remove} disabled={!client || Boolean(offline)} /> : null}
    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 26, paddingBottom: 48, gap: 8 },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  hint: { fontSize: 15, lineHeight: 20, marginBottom: 6 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 10, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  field: { borderRadius: 14, paddingHorizontal: 14, fontSize: 17 },
  nameField: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 50 },
  hash: { fontSize: 17, fontWeight: '600' },
  input: { flex: 1, fontSize: 17, paddingVertical: 12 },
  brief: { minHeight: 110, paddingTop: 12, paddingBottom: 12, lineHeight: 22, textAlignVertical: 'top' },
  list: { borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8 },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 17, lineHeight: 22 },
  rowDetail: { fontSize: 14, lineHeight: 19 },
  check: { width: 22, alignItems: 'center' },
  note: { fontSize: 13, lineHeight: 18, marginLeft: 4 },
  error: { fontSize: 14, lineHeight: 19, textAlign: 'center', minHeight: 19, marginTop: 6 },
})

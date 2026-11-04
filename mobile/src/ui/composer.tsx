// The message box. While you type, the crew shows above it: tap a face to talk to that agent alone (Everyone goes back
// to the whole crew), or type @ to bring someone in. Reading, it's just the box, so the messages get the room.
// Sending is off, with the reason in the box, while the computer can't be reached.
import { useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'

import type { Agent } from '@/net/types'

import { agentColor } from './avatar'
import { nameInk } from './color'
import { Creature } from './creature'
import { displayName } from './format'
import { Icon } from './icon'
import { CountBadge, Press, tap } from './parts'
import { fonts, type Theme } from './theme'

type Props = {
  t: Theme
  agents: Agent[] // the crew, without clones
  convo: string | null
  unread: Map<string, number>
  disabled: string | null // why sending is off
  background: string
  onFace: (name: string | null) => void
  onSend: (text: string) => Promise<unknown>
}

// The @word being typed at the cursor, if any.
function mentionAt(text: string, cursor: number) {
  const m = text.slice(0, cursor).match(/(^|\s)@([\w-]*)$/)
  return m ? { query: m[2].toLowerCase(), start: cursor - m[2].length - 1 } : null
}

export function Composer({ t, agents, convo, unread, disabled, background, onFace, onSend }: Props) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const at = mentionAt(text, cursor)
  const matches = at
    ? agents
        .filter((a) => a.on && a.name !== convo)
        .map((a) => ({ a, score: a.name.startsWith(at.query) ? 0 : a.name.includes(at.query) ? 1 : (a.area ?? '').toLowerCase().includes(at.query) ? 2 : 9 }))
        .filter((x) => x.score < 9)
        .sort((x, y) => x.score - y.score)
        .slice(0, 5)
        .map((x) => x.a)
    : []
  const target = convo ? agents.find((a) => a.name === convo) : null
  const placeholder = disabled ?? (target ? `Message ${displayName(target.name).base}` : 'Message the crew')

  const insert = (a: Agent) => {
    if (!at) return
    const next = `${text.slice(0, at.start)}@${a.name} ${text.slice(cursor)}`
    setText(next)
    setCursor(at.start + a.name.length + 2)
    tap()
  }
  const send = async () => {
    const body = text.trim()
    if (!body || busy || disabled) return
    setBusy(true)
    setError('')
    try {
      await onSend(body)
      setText('')
      setCursor(0)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.wrap, { backgroundColor: background }]}>
      {matches.length ? (
        <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)} style={[styles.picker, { backgroundColor: t.surface, borderColor: t.lineStrong }]}>
          {matches.map((a) => (
            <Press key={a.name} onPress={() => insert(a)} style={styles.pick} accessibilityRole="button" accessibilityLabel={`Mention ${a.name}`}>
              <Creature agent={a} size={28} mood="still" />
              <View style={styles.pickText}>
                <Text style={[styles.pickName, { color: nameInk(agentColor(a), t.fg) }]}>{displayName(a.name).base}</Text>
                {a.area ? (
                  <Text style={[styles.pickArea, { color: t.fg2 }]} numberOfLines={1}>
                    {a.area}
                  </Text>
                ) : null}
              </View>
            </Press>
          ))}
        </Animated.View>
      ) : null}
      {focused ? (
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(90)}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.to} keyboardShouldPersistTaps="handled">
        <Press onPress={() => onFace(null)} style={[styles.all, { backgroundColor: convo ? t.btn : t.dark ? 'rgba(10,132,255,0.2)' : 'rgba(0,122,255,0.12)' }]} accessibilityRole="button" accessibilityState={{ selected: !convo }} accessibilityLabel="Everyone's messages">
          <Text style={[styles.allText, { color: convo ? t.fg2 : t.accent }]}>Everyone</Text>
        </Press>
        {agents.filter((a) => a.on || a.name === convo).map((a) => {
          const on = convo === a.name
          return (
            <Press key={a.name} onPress={() => onFace(on ? null : a.name)} style={styles.face} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${displayName(a.name).base}${unread.get(a.name) ? `, ${unread.get(a.name)} new` : ''}`}>
              <View style={[styles.ring, { borderColor: on ? t.accent : 'transparent' }]}>
                <Creature agent={a} size={32} />
              </View>
              <View style={styles.badge}>
                <CountBadge t={t} n={unread.get(a.name) ?? 0} />
              </View>
            </Press>
          )
        })}
      </ScrollView>
      </Animated.View>
      ) : null}
      <View style={[styles.box, { backgroundColor: t.field, borderColor: error ? t.danger : 'transparent' }]}>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v)
            if (error) setError('')
          }}
          onSelectionChange={(ev) => setCursor(ev.nativeEvent.selection.end)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={disabled ? t.waitingInk : t.fg3}
          editable={!disabled}
          multiline
          style={[styles.input, { color: t.fg }]}
          accessibilityLabel="Message"
        />
        <Press onPress={send} disabled={!text.trim() || busy || Boolean(disabled)} style={[styles.send, { backgroundColor: text.trim() && !disabled ? t.brand : t.btn }]} accessibilityRole="button" accessibilityLabel="Send">
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="send" size={16} color={text.trim() && !disabled ? '#fff' : t.fg3} weight="bold" />}
        </Press>
      </View>
      {error ? (
        <Text style={[styles.error, { color: t.danger }]} numberOfLines={2}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 4, paddingBottom: 6 },
  to: { paddingHorizontal: 12, gap: 6, alignItems: 'center', height: 48, paddingBottom: 4 },
  all: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 16, marginRight: 4 },
  allText: { fontSize: 14, fontWeight: '600' },
  face: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2, borderRadius: 21, padding: 2 },
  badge: { position: 'absolute', right: -2, bottom: -1 },
  box: { flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: 12, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth * 2, paddingLeft: 16, paddingRight: 5, paddingVertical: 4, minHeight: 44 },
  input: { flex: 1, fontSize: 17, lineHeight: 22, maxHeight: 132, paddingTop: 7, paddingBottom: 7 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  error: { fontSize: 13, marginHorizontal: 18, marginTop: 6 },
  picker: { position: 'absolute', left: 12, right: 12, bottom: '100%', marginBottom: 6, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth * 2, paddingVertical: 6, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
  pickText: { flex: 1 },
  pickName: { fontSize: 15, fontWeight: '600' },
  pickArea: { fontSize: 13, fontFamily: fonts.rounded },
})

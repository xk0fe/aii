// The message box, and nothing else, so the messages keep the room while you type. To bring someone in, type @ or press
// the button (@ is a keyboard layer away on a phone); a conversation with one agent is in the list under the chat.
// Sending is off, with the reason in the box, while the computer can't be reached.
import { useRef, useState, type ComponentRef } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'

import type { Agent, Channel } from '@/net/types'

import { agentColor } from './avatar'
import { nameInk } from './color'
import { Creature } from './creature'
import { displayName } from './format'
import { Icon } from './icon'
import { Press, tap } from './parts'
import { fonts, type Theme } from './theme'

type Props = {
  t: Theme
  agents: Agent[] // the clique, without clones
  convo: string | null
  channel?: Channel | null // the channel it's said in (none: the Mac has no channels)
  place: string // where it's said (workspace and channel, or agent): each place keeps its own draft
  disabled: string | null // why sending is off
  background: string
  onSend: (text: string) => Promise<unknown>
}

// The @word being typed at the cursor, if any.
function mentionAt(text: string, cursor: number) {
  const m = text.slice(0, cursor).match(/(^|\s)@([\w-]*)$/)
  return m ? { query: m[2].toLowerCase(), start: cursor - m[2].length - 1 } : null
}

// What you'd started typing, per place, as on the computer: a half-written message stays where you wrote it.
const drafts = new Map<string, string>()

export function Composer({ t, agents, convo, channel, place, disabled, background, onSend }: Props) {
  const [text, setText] = useState(() => drafts.get(place) ?? '')
  const [cursor, setCursor] = useState(() => (drafts.get(place) ?? '').length)
  const [was, setWas] = useState(place)
  if (was !== place) {
    // moved to another channel or conversation: this one's draft is kept, that one's comes back
    if (text.trim()) drafts.set(was, text)
    else drafts.delete(was)
    setWas(place)
    setText(drafts.get(place) ?? '')
    setCursor((drafts.get(place) ?? '').length) // iOS reports no selection for text set from here
  }
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const at = mentionAt(text, cursor)
  const matches = at
    ? agents
        .filter((a) => a.on && a.name !== convo)
        .map((a) => ({ a, score: a.name.toLowerCase().startsWith(at.query) ? 0 : a.name.toLowerCase().includes(at.query) ? 1 : (a.area ?? '').toLowerCase().includes(at.query) ? 2 : 9 }))
        .filter((x) => x.score < 9)
        .sort((x, y) => x.score - y.score)
        .slice(0, 5)
        .map((x) => x.a)
    : []
  const target = convo ? agents.find((a) => a.name === convo) : null
  const placeholder = disabled ?? (target ? `Message ${displayName(target.name).base}` : channel ? `Message #${channel.name}` : 'Message the clique')

  // @ at the cursor, with a space before it after a word: the picker opens on it
  const startMention = () => {
    const before = text.slice(0, cursor)
    const lead = before && !/\s$/.test(before) ? ' ' : ''
    setText(`${before}${lead}@${text.slice(cursor)}`)
    setCursor(cursor + lead.length + 1)
    input.current?.focus()
    tap()
  }
  const insert = (a: Agent) => {
    if (!at) return
    const next = `${text.slice(0, at.start)}@${a.name} ${text.slice(cursor)}`
    setText(next)
    setCursor(at.start + a.name.length + 2)
    tap()
  }
  const send = async () => {
    const body = text.trim()
    const from = place
    if (!body || busy || disabled) return
    setBusy(true)
    setError('')
    try {
      await onSend(body)
      // sent: gone from where it was written; the box empties unless you've moved on and it holds something else
      if (drafts.get(from)?.trim() === body) drafts.delete(from)
      setText((now) => (now.trim() === body ? '' : now))
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
      <View style={[styles.box, { backgroundColor: t.field, borderColor: error ? t.danger : 'transparent' }]}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={(v) => {
            setText(v)
            if (error) setError('')
          }}
          onSelectionChange={(ev) => setCursor(ev.nativeEvent.selection.end)}
          placeholder={placeholder}
          placeholderTextColor={disabled ? t.waitingInk : t.fg3}
          editable={!disabled}
          multiline
          style={[styles.input, { color: t.fg }]}
          accessibilityLabel="Message"
        />
        <Press onPress={startMention} disabled={Boolean(disabled)} style={styles.at} accessibilityRole="button" accessibilityLabel="Mention someone" hitSlop={{ top: 8, bottom: 8 }}>
          <Text style={[styles.atText, { color: t.fg2 }]}>@</Text>
        </Press>
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
  box: { flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: 12, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth * 2, paddingLeft: 16, paddingRight: 5, paddingVertical: 4, minHeight: 44 },
  input: { flex: 1, fontSize: 17, lineHeight: 22, maxHeight: 132, paddingTop: 7, paddingBottom: 7 },
  at: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  atText: { fontSize: 18, lineHeight: 22, fontWeight: '500' },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  error: { fontSize: 13, marginHorizontal: 18, marginTop: 6 },
  picker: { position: 'absolute', left: 12, right: 12, bottom: '100%', marginBottom: 6, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth * 2, paddingVertical: 6, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
  pickText: { flex: 1 },
  pickName: { fontSize: 15, fontWeight: '600' },
  pickArea: { fontSize: 13, fontFamily: fonts.rounded },
})

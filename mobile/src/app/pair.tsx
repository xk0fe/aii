// Pairing: point the camera at the code CLIque on the Mac shows (Computers › Add a phone), or paste it, and the phone and
// the Mac swap keys. Or look around the demo clique first.
//
// The camera is the screen and it never needs a button: after a try that didn't work it keeps looking, and a code it
// has just tried waits (a few seconds, a minute after "too many tries", for the whole visit when it can't work) before
// it's tried again. Leaving the screen ends a pairing under way.
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { APP_NAME } from '@/brand'
import { parsePairCode } from '@/net/pairing'
import { useSession } from '@/state/hooks'
import { PairError, session } from '@/state/session'
import { Creature } from '@/ui/creature'
import { tryWords } from '@/ui/format'
import { useMountEffect } from '@/ui/hooks'
import { Icon, type IconName } from '@/ui/icon'
import { Button, Press, tap, thud, Wordmark } from '@/ui/parts'
import { fonts, useTheme, type Theme } from '@/ui/theme'

const BUDDIES = [
  { name: 'sky', size: 54, avatar: { body: 'blob', color: 'sky', eyes: 'dot', mouth: 'none', hat: 'none', cheeks: true } },
  { name: 'pink', size: 62, avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true } },
  { name: 'lime', size: 58, avatar: { body: 'mochi', color: 'lime', eyes: 'happy', mouth: 'none', hat: 'none', cheeks: true } },
]
const PERCH = 58 // how far the buddies stand above the viewfinder; their feet tuck behind its edge

// The clique, sitting on the viewfinder's edge: they hop while pairing, and one of them frets when it didn't work.
function Buddies({ busy, trouble }: { busy: boolean; trouble: boolean }) {
  return (
    <View pointerEvents="none" style={styles.buddies}>
      {BUDDIES.map((b, i) => (
        <View key={b.name} style={{ marginHorizontal: -7, zIndex: i === 1 ? 2 : 1 }}>
          <Creature agent={b} size={b.size} mood={busy ? 'working' : trouble && i === 1 ? 'waiting' : 'idle'} />
        </View>
      ))}
    </View>
  )
}

// Soft corners where the code goes; they close in a little once a code is caught.
function Reticle({ caught }: { caught: boolean }) {
  const style = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(caught ? 0.92 : 1, { duration: 220 }) }] }))
  return (
    <Animated.View pointerEvents="none" style={[styles.reticle, style]}>
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} style={[styles.corner, styles[c]]} />
      ))}
    </Animated.View>
  )
}

// The camera, or what it needs before it can look.
function Scanner({ t, onCode, caught }: { t: Theme; onCode: (code: string) => void; caught: boolean }) {
  const [permission, request] = useCameraPermissions()
  const granted = Boolean(permission?.granted)
  const denied = permission && !permission.granted && !permission.canAskAgain
  return (
    <View style={StyleSheet.absoluteFill}>
      {granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => onCode(data)} /> : null}
      <View style={styles.aim}>
        <View style={styles.window}>
          <Reticle caught={caught} />
          {permission && !granted ? (
            <View style={styles.ask}>
              <Icon name="scan" size={30} color="rgba(255,255,255,0.85)" weight="regular" />
              <Text style={styles.askText}>{denied ? `Camera access is off for ${APP_NAME}.` : `${APP_NAME} needs the camera to see the code.`}</Text>
              <Button t={t} small kind="primary" title={denied ? 'Open Settings' : 'Allow the camera'} onPress={() => void (denied ? Linking.openSettings() : request())} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}

// What's happening, or what went wrong, over the bottom of the viewfinder. It keeps one height whatever it says;
// only Details, when asked for, makes it taller.
function Status({ t, busy, retrying, error, open, onCancel, onDetails }: { t: Theme; busy: string | null; retrying: boolean; error: PairError | null; open: boolean; onCancel: () => void; onDetails: () => void }) {
  if (!busy && !error) return null
  const tries = error?.more.tries ?? []
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.status, { backgroundColor: t.surface, borderColor: t.lineStrong }]}>
      {!busy && open && tries.length ? (
        <View style={[styles.tries, { borderBottomColor: t.line }]}>
          {tries.map((x, i) => {
            // how each way of reaching the computer went, in words: no addresses or codes on screen
            const w = tryWords(x)
            return (
              <View key={`${x.host}${i}`} style={styles.try}>
                <Text style={[styles.host, { color: t.fg }]} numberOfLines={1}>
                  {w.where}
                </Text>
                <Text style={[styles.why, { color: t.fg2 }]} numberOfLines={1}>
                  {w.what}
                </Text>
              </View>
            )
          })}
        </View>
      ) : null}
      <View style={styles.statusRow}>
        {busy ? <ActivityIndicator size="small" color={t.fg2} style={styles.lead} /> : <Icon name="warning" size={18} color={t.waitingInk} />}
        <View style={styles.words}>
          <Text style={[styles.title, { color: t.fg }]} numberOfLines={1}>
            {busy ? (retrying ? `Still trying ${busy}…` : `Pairing with ${busy}…`) : error?.title}
          </Text>
          {!busy && error?.hint ? (
            <Text style={[styles.hint, { color: t.fg2 }]} numberOfLines={1}>
              {error.hint}
            </Text>
          ) : null}
        </View>
        {busy ? (
          <Press onPress={onCancel} hitSlop={10} accessibilityRole="button">
            <Text style={[styles.action, { color: t.accent }]}>Cancel</Text>
          </Press>
        ) : tries.length ? (
          <Press onPress={onDetails} hitSlop={10} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.details}>
            <Text style={[styles.action, { color: t.fg2 }]}>Details</Text>
            <Icon name={open ? 'down' : 'up'} size={11} color={t.fg2} weight="bold" />
          </Press>
        ) : null}
      </View>
    </Animated.View>
  )
}

function Quiet({ t, icon, title, onPress, disabled }: { t: Theme; icon: IconName; title: string; onPress: () => void; disabled: boolean }) {
  return (
    <Press onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title} style={styles.quiet}>
      <Icon name={icon} size={15} color={t.fg2} />
      <Text style={[styles.quietText, { color: t.fg2 }]}>{title}</Text>
    </Press>
  )
}

// The camera reports a QR code many times a second: only the first report starts pairing.
let scanning = false

const AGAIN = 5000 // a code that didn't get through is tried again at most this often
const AWAY = 1500 // a code the camera hasn't reported for this long was out of view

// A code the camera keeps seeing that isn't tried again: before `until`, unless (`away`, after Cancel) it left the view
// and came back. One per code, so another QR code passing through doesn't free it.
type Hold = { until: number; away?: boolean }

export default function Pair() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const s = useSession()
  const [code, setCode] = useState('')
  const [pasting, setPasting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // the Mac's name while pairing
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<PairError | null>(null)
  const [open, setOpen] = useState(false) // Details
  const attempt = useRef<(() => void) | null>(null) // cancels the pairing under way
  const holds = useRef(new Map<string, Hold>())
  const seen = useRef(new Map<string, number>()) // when the camera last reported each code
  const here = useRef(true)
  useMountEffect(() => {
    here.current = true
    return () => {
      here.current = false
      attempt.current?.() // closed or swiped away mid-pairing
    }
  })

  const pair = async (text: string, scanned = false) => {
    if (busy) return
    setError(null)
    setOpen(false)
    setRetrying(false)
    const { done, cancel } = session.pair(text, { onRetry: () => setRetrying(true) })
    try {
      setBusy(parsePairCode(text).name)
      attempt.current = cancel
    } catch {} // not a code: the attempt says so right away
    try {
      await done
      thud()
      if (here.current) router.replace('/chat')
    } catch (e) {
      const why = e instanceof PairError ? e : String((e as Error)?.message ?? e) === 'cancelled' ? null : new PairError(String((e as Error)?.message ?? e))
      if (scanned) holds.current.set(text, { until: !why || why.more.fatal ? Infinity : Math.max(Date.now() + AGAIN, why.more.retryAt ?? 0), away: !why })
      setError(why)
    } finally {
      setBusy(null)
      attempt.current = null
    }
  }

  const onScan = (text: string) => {
    const now = Date.now()
    const back = now - (seen.current.get(text) ?? 0) > AWAY
    seen.current.set(text, now)
    if (scanning || busy) return
    const h = holds.current.get(text)
    // with Details open, the code they're about waits until they're closed; a new code goes ahead
    if (h && (open || (now < h.until && !(h.away && back)))) return
    holds.current.delete(text)
    scanning = true
    tap()
    void pair(text, true).finally(() => {
      scanning = false
      seen.current.set(text, Date.now()) // it was in view all along: the next report isn't a new sighting
    })
  }

  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '')
    if (text) {
      setCode(text.trim())
      if (text.includes('cliquephone1.')) void pair(text)
    }
  }
  const demo = () => {
    session.startDemo()
    router.replace('/chat')
  }
  const mode = () => {
    setPasting(!pasting)
    setError(null)
    setOpen(false)
  }

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 4 }]}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      alwaysBounceVertical={false}
    >
      <View style={styles.head}>
        <Wordmark name={APP_NAME} size={34} />
        <Text style={[styles.guide, { color: t.fg2 }]}>
          In {APP_NAME} on your computer: <Text style={{ color: t.fg, fontWeight: '600' }}>{'Computers\u00a0›\u00a0Add\u00a0a\u00a0phone'}</Text>, then {pasting ? 'copy the code.' : 'point here.'}
        </Text>
        {s.active ? (
          <Press onPress={() => (attempt.current?.(), router.back())} style={[styles.close, { backgroundColor: t.btn }]} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
            <Icon name="close" size={14} color={t.fg2} weight="bold" />
          </Press>
        ) : null}
      </View>

      <View style={styles.stage}>
        <Buddies busy={Boolean(busy)} trouble={Boolean(error)} />
        <View style={[styles.frame, { borderColor: t.dark ? t.lineStrong : 'transparent', backgroundColor: pasting ? t.card : t.dark ? '#000' : '#141417' }]}>
          {pasting ? (
            <View style={styles.pasteBox}>
              <View style={[styles.badge, { backgroundColor: t.btn }]}>
                <Icon name="paste" size={24} color={t.fg2} weight="regular" />
              </View>
              <TextInput
                value={code}
                onChangeText={(v) => {
                  setCode(v)
                  setError(null)
                }}
                placeholder="cliquephone1.…"
                placeholderTextColor={t.fg3}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                editable={!busy}
                style={[styles.paste, { color: t.fg, backgroundColor: t.field, borderColor: t.lineStrong }]}
                accessibilityLabel="Pairing code"
              />
              <View style={styles.row}>
                <Button t={t} title="Paste" icon="paste" flex onPress={() => void paste()} disabled={Boolean(busy)} />
                <Button t={t} kind="primary" title="Pair" flex onPress={() => void pair(code)} disabled={!code.trim()} busy={Boolean(busy)} />
              </View>
            </View>
          ) : (
            <Scanner t={t} onCode={onScan} caught={Boolean(busy)} />
          )}
          <Status t={t} busy={busy} retrying={retrying} error={error} open={open} onCancel={() => attempt.current?.()} onDetails={() => setOpen(!open)} />
        </View>
      </View>

      <View style={styles.more}>
        {/* the way in without a computer (and App Review's): always on this first screen */}
        <Button t={t} icon="clique" title="Try the demo clique" onPress={demo} disabled={Boolean(busy)} accessibilityHint="A made-up clique that lives only on this phone" />
        <Quiet t={t} icon={pasting ? 'scan' : 'paste'} title={pasting ? 'Scan instead' : 'Paste the code instead'} onPress={mode} disabled={Boolean(busy)} />
      </View>
    </KeyboardAwareScrollView>
  )
}

const C = 38
const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 16 },
  head: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, gap: 4 },
  guide: { fontSize: 15, lineHeight: 20, textAlign: 'center' },
  close: { position: 'absolute', right: 0, top: 0, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, minHeight: 420, marginTop: PERCH + 6 },
  buddies: { position: 'absolute', top: -PERCH, left: 0, right: 0, height: PERCH + 4, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end' },
  frame: { flex: 1, borderRadius: 32, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  // the window sits a little above the middle, clear of the status over the bottom
  aim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 64 },
  window: { width: '68%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  reticle: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  corner: { position: 'absolute', width: C, height: C, borderColor: '#fff', opacity: 0.92 },
  tl: { left: 0, top: 0, borderLeftWidth: 4.5, borderTopWidth: 4.5, borderTopLeftRadius: 20 },
  tr: { right: 0, top: 0, borderRightWidth: 4.5, borderTopWidth: 4.5, borderTopRightRadius: 20 },
  bl: { left: 0, bottom: 0, borderLeftWidth: 4.5, borderBottomWidth: 4.5, borderBottomLeftRadius: 20 },
  br: { right: 0, bottom: 0, borderRightWidth: 4.5, borderBottomWidth: 4.5, borderBottomRightRadius: 20 },
  ask: { alignItems: 'center', gap: 12, paddingHorizontal: 22 },
  askText: { color: 'rgba(255,255,255,0.82)', fontSize: 15, lineHeight: 20, textAlign: 'center' },
  status: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  statusRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11 },
  lead: { width: 18 },
  words: { flex: 1, gap: 1 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.1 },
  hint: { fontSize: 13, lineHeight: 17 },
  action: { fontSize: 14, fontWeight: '600' },
  details: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tries: { paddingTop: 12, paddingBottom: 10, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  try: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  host: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  why: { marginLeft: 'auto', fontSize: 13, lineHeight: 18 },
  pasteBox: { flex: 1, justifyContent: 'center', padding: 14, paddingBottom: 82, gap: 12 },
  badge: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 6 },
  paste: { height: 136, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth * 2, padding: 12, fontFamily: fonts.mono, fontSize: 13, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  more: { marginTop: 12, gap: 2 },
  quiet: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  quietText: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
})

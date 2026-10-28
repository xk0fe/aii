// Pairing: scan the code Crew on the Mac shows (Computers › Phones › Add a phone), or paste it, and the phone and
// the Mac swap keys. Or look around the demo crew first.
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { parsePairCode } from '@/net/pairing'
import { useSession } from '@/state/hooks'
import { session } from '@/state/session'
import { CardBack } from '@/ui/agentCard'
import { Creature } from '@/ui/creature'
import { Icon } from '@/ui/icon'
import { Button, Press, thud } from '@/ui/parts'
import { fonts, useTheme, type Theme } from '@/ui/theme'

const BUDDIES = [
  { name: 'sky', avatar: { body: 'blob', color: 'sky', eyes: 'dot', mouth: 'none', hat: 'none', cheeks: true } },
  { name: 'pink', avatar: { body: 'bean', color: 'pink', eyes: 'sparkle', mouth: 'smile', hat: 'none', cheeks: true } },
  { name: 'lime', avatar: { body: 'mochi', color: 'lime', eyes: 'happy', mouth: 'none', hat: 'none', cheeks: true } },
]

function Hero({ busy }: { busy: boolean }) {
  return (
    <View style={styles.hero}>
      <CardBack color="#c9a8ff" id="pairhero" radius={30} />
      <View style={styles.buddies}>
        {BUDDIES.map((b, i) => (
          <View key={b.name} style={{ marginHorizontal: -16, zIndex: i === 1 ? 2 : 1 }}>
            <Creature agent={{ ...b, status: busy ? 'working' : 'idle' }} size={i === 1 ? 96 : 80} mood={busy ? 'working' : 'idle'} />
          </View>
        ))}
      </View>
    </View>
  )
}

// The camera, with soft corners marking where the code goes.
function Scanner({ t, onCode, paused }: { t: Theme; onCode: (code: string) => void; paused: boolean }) {
  const [permission, request] = useCameraPermissions()
  if (!permission?.granted) {
    const denied = permission && !permission.canAskAgain
    return (
      <View style={[styles.scanner, styles.scannerOff, { backgroundColor: t.card, borderColor: t.lineStrong }]}>
        <Icon name="scan" size={34} color={t.fg3} weight="regular" />
        <Text style={[styles.scanHint, { color: t.fg2 }]}>{denied ? 'Camera access is off for Crew.' : 'Scan the code with the camera.'}</Text>
        <Button t={t} small kind="primary" title={denied ? 'Open Settings' : 'Scan the code'} onPress={() => void (denied ? Linking.openSettings() : request())} />
      </View>
    )
  }
  return (
    <View style={[styles.scanner, { backgroundColor: '#000' }]}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={paused ? undefined : ({ data }) => onCode(data)} />
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} pointerEvents="none" style={[styles.corner, styles[c]]} />
      ))}
    </View>
  )
}

// The camera reports a QR code many times a second: only the first report starts pairing.
let scanning = false

export default function Pair() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const s = useSession()
  const [code, setCode] = useState('')
  const [pasting, setPasting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // the Mac's name while pairing
  const [error, setError] = useState('')
  const [cancel, setCancel] = useState<(() => void) | null>(null)
  // after a scan that didn't pair, the camera waits until you ask for another try (the code is still in front of it)
  const [hold, setHold] = useState(false)

  const pair = async (text: string, scanned = false) => {
    if (busy) return
    setError('')
    setHold(false)
    let name = 'your Mac'
    try {
      name = parsePairCode(text).name
    } catch {}
    const attempt = session.pair(text)
    setBusy(name)
    setCancel(() => attempt.cancel)
    try {
      await attempt.done
      thud()
      router.replace('/chat')
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      if (msg !== 'cancelled') setError(msg.charAt(0).toUpperCase() + msg.slice(1))
      if (scanned) setHold(true)
    } finally {
      setBusy(null)
      setCancel(null)
    }
  }
  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '')
    if (text) {
      setCode(text.trim())
      if (text.includes('crewphone1.')) void pair(text)
    }
  }
  const demo = () => {
    session.startDemo()
    router.replace('/chat')
  }

  return (
    <KeyboardAwareScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]} bottomOffset={24} keyboardShouldPersistTaps="handled">
      <View style={styles.top}>
        {s.active ? (
          <Press onPress={() => router.back()} style={[styles.close, { backgroundColor: t.btn }]} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
            <Icon name="close" size={14} color={t.fg2} weight="bold" />
          </Press>
        ) : null}
      </View>
      <Hero busy={Boolean(busy)} />
      <Text style={[styles.title, { color: t.fg }]}>Your crew, on your phone</Text>
      <Text style={[styles.sub, { color: t.fg2 }]}>See who's working, answer when someone needs you, and send a message while you're away from the Mac.</Text>

      <View style={styles.steps}>
        <Text style={[styles.step, { color: t.fg }]}>
          <Text style={[styles.num, { color: t.accent }]}>1 </Text>On your Mac, open <Text style={{ fontWeight: '700' }}>Computers</Text> in Crew and choose <Text style={{ fontWeight: '700' }}>Add a phone</Text>.
        </Text>
        <Text style={[styles.step, { color: t.fg }]}>
          <Text style={[styles.num, { color: t.accent }]}>2 </Text>Scan the code it shows. The phone needs to reach the Mac: the same Wi-Fi, or Tailscale.
        </Text>
      </View>

      {pasting ? (
        <View style={[styles.pasteBox, { backgroundColor: t.card }]}>
          <TextInput
            value={code}
            onChangeText={(v) => {
              setCode(v)
              setError('')
            }}
            placeholder="crewphone1.…"
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
        <Scanner
          t={t}
          paused={Boolean(busy) || hold}
          onCode={(c) => {
            if (scanning) return
            scanning = true
            void pair(c, true).finally(() => (scanning = false))
          }}
        />
      )}

      {/* one line, always there: what's happening, or what went wrong */}
      <View style={styles.statusLine}>
        {busy ? (
          <>
            <ActivityIndicator size="small" color={t.fg2} />
            <Text style={[styles.status, { color: t.fg2 }]}>Pairing with {busy}…</Text>
            <Press onPress={() => cancel?.()} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.status, { color: t.accent, fontWeight: '600' }]}>Cancel</Text>
            </Press>
          </>
        ) : (
          <>
            <Text style={[styles.status, { color: error ? t.danger : t.fg3, textAlign: 'center' }]}>{error || 'Codes work for 10 minutes and pair one phone.'}</Text>
            {hold ? (
              <Press onPress={() => (setHold(false), setError(''))} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.status, { color: t.accent, fontWeight: '600' }]}>Scan again</Text>
              </Press>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.row}>
        <Button t={t} flex icon={pasting ? 'scan' : 'paste'} title={pasting ? 'Scan instead' : 'Paste the code'} onPress={() => setPasting(!pasting)} disabled={Boolean(busy)} />
        <Button t={t} flex title="Try the demo" onPress={demo} disabled={Boolean(busy)} />
      </View>
    </KeyboardAwareScrollView>
  )
}

const C = 26
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 14 },
  top: { height: 30, flexDirection: 'row', justifyContent: 'flex-end', marginBottom: -6 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  hero: { height: 150, borderRadius: 30, overflow: 'hidden', justifyContent: 'flex-end' },
  buddies: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', marginBottom: -6 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 6 },
  sub: { fontSize: 16, lineHeight: 22, marginTop: -6 },
  steps: { gap: 8 },
  step: { fontSize: 15, lineHeight: 21 },
  num: { fontWeight: '800', fontFamily: fonts.rounded },
  scanner: { height: 236, borderRadius: 24, overflow: 'hidden', alignSelf: 'stretch' },
  scannerOff: { alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth * 2, borderStyle: 'dashed' },
  scanHint: { fontSize: 15 },
  corner: { position: 'absolute', width: C, height: C, borderColor: '#fff', opacity: 0.9 },
  tl: { left: 46, top: 46, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 12 },
  tr: { right: 46, top: 46, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 12 },
  bl: { left: 46, bottom: 46, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 12 },
  br: { right: 46, bottom: 46, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 12 },
  pasteBox: { borderRadius: 24, padding: 14, gap: 12, height: 236, justifyContent: 'space-between' },
  paste: { flex: 1, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth * 2, padding: 12, fontFamily: fonts.mono, fontSize: 13, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  statusLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 22 },
  status: { fontSize: 14, lineHeight: 19, flexShrink: 1 },
})

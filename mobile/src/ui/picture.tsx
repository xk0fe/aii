// Pictures in the chat: what an agent attached (`clique attach`) and what you sent from the computer, as the computer's
// chat shows them. Each is fetched from the computer with the `image` call (CLIque's own pictures only, up to 20 MB),
// kept here for as long as the app runs, and drawn at its own shape. Tap one to look closer: full screen, pinch to zoom.
// Anything that isn't a picture the phone can draw (a recording, a page, a document) stays a card: it's on the computer.
import { useEffect, useState } from 'react'
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { session } from '@/state/session'

import { base64, drawable, mimeOf, nameOfPath } from './files'
import { fileLine } from './format'

export { drawable, nameOfPath }
import { Icon } from './icon'
import type { Theme } from './theme'

// The pictures fetched so far, newest last: while the app runs, up to KEEP characters of them (the oldest go first).
const KEEP = 80 * 1024 * 1024
const kept = new Map<string, string>()
const coming = new Map<string, Promise<string>>()
function keep(path: string, uri: string) {
  kept.set(path, uri)
  let size = 0
  for (const u of kept.values()) size += u.length
  for (const [p, u] of kept) {
    if (size <= KEEP || kept.size <= 1) break
    kept.delete(p)
    size -= u.length
  }
}
export function fetchPicture(path: string): Promise<string> {
  const have = kept.get(path)
  if (have) return Promise.resolve(have)
  const going = coming.get(path)
  if (going) return going
  const client = session.client
  if (!client) return Promise.reject(new Error('not connected'))
  const p = client
    .image(path)
    .then((bytes) => {
      const uri = `data:${mimeOf(path)};base64,${base64(bytes)}`
      keep(path, uri)
      return uri
    })
    .finally(() => coming.delete(path))
  coming.set(path, p)
  return p
}

function usePicture(path: string) {
  const [got, set] = useState<{ uri?: string; failed?: string }>(() => (kept.has(path) ? { uri: kept.get(path) } : {}))
  useEffect(() => {
    if (got.uri) return
    let live = true
    fetchPicture(path).then(
      (uri) => live && set({ uri }),
      (e: Error) => live && set({ failed: e.message }),
    )
    return () => {
      live = false
    }
  }, [path, got.uri])
  return got
}

type Shown = { path: string; name: string; w?: number; h?: number; size?: number }

// One picture in a message: as wide as the column allows up to MAX, at its own shape (what the computer said of it,
// else what it turns out to be once it's here). Until then a grey box of about that shape; one that can't be had is a
// card that says it's on the computer.
const MAX = 280
export function Picture({ p, t }: { p: Shown; t: Theme }) {
  const got = usePicture(p.path)
  const [shape, setShape] = useState(p.w && p.h ? p.w / p.h : 0)
  if (got.failed) return <OnComputer name={p.name} line={p.size ? fileLine({ name: p.name, kind: 'image', size: p.size }) : 'Picture'} t={t} />
  const ratio = shape || 4 / 3
  const width = Math.min(MAX, Math.max(80, ratio >= 1 ? MAX : MAX * ratio * 0.9))
  return (
    <Pressable onPress={() => got.uri && openPicture(p)} accessibilityRole="imagebutton" accessibilityLabel={`${p.name}. Open it`} style={[styles.pic, { width, aspectRatio: ratio, backgroundColor: t.fill, borderColor: t.line }]}>
      {got.uri ? (
        <Image
          source={{ uri: got.uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={(ev) => {
            const { width: w, height: h } = ev.nativeEvent.source
            if (!shape && w && h) setShape(w / h)
          }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </Pressable>
  )
}

// A file the phone doesn't show: what it is, and that it's on the computer.
export function OnComputer({ name, line, t }: { name: string; line: string; t: Theme }) {
  return (
    <View style={[styles.file, { borderColor: t.line, backgroundColor: t.fill }]}>
      <Icon name="mac" size={18} color={t.fg2} />
      <View style={styles.fileWhat}>
        <Text style={[styles.fileName, { color: t.fg }]} numberOfLines={1} ellipsizeMode="middle">
          {name}
        </Text>
        <Text style={[styles.fileLine, { color: t.fg2 }]} numberOfLines={1}>
          {line} · open it on the computer
        </Text>
      </View>
    </View>
  )
}

// The picture open full screen, for the one viewer the app has (PictureHost, in the root layout).
let open: Shown | null = null
const watchers = new Set<() => void>()
export function openPicture(p: Shown | null) {
  open = p
  for (const fn of watchers) fn()
}
export function PictureHost() {
  const [p, set] = useState(open)
  useEffect(() => {
    const fn = () => set(open)
    watchers.add(fn)
    return () => void watchers.delete(fn)
  }, [])
  return <PictureViewer p={p} onClose={() => openPicture(null)} />
}

// A picture, closer: the whole screen, black around it, pinch to zoom. Tap it, or ×, to close.
function PictureViewer({ p, onClose }: { p: Shown | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const uri = p ? kept.get(p.path) : undefined
  return (
    <Modal visible={Boolean(p && uri)} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.viewer}>
        <ScrollView maximumZoomScale={5} minimumZoomScale={1} centerContent showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ width, height }}>
          <Pressable onPress={onClose} style={{ width, height }} accessibilityLabel="Close the picture">
            {uri ? <Image source={{ uri }} style={{ width, height }} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
          </Pressable>
        </ScrollView>
        <View style={[styles.bar, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Text style={styles.barName} numberOfLines={1} ellipsizeMode="middle">
            {p?.name}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  pic: { maxWidth: '100%', borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  fileWhat: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 15, fontWeight: '600' },
  fileLine: { fontSize: 12.5, marginTop: 1 },
  viewer: { flex: 1, backgroundColor: '#000' },
  bar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  barName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
})

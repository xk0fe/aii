// Crew's brand surfaces, made of felt (SPEC v2: "Felt is the brand material", "Stitches are the graphic mark"): a
// creature's patch in its own colour, and the Crew room's wall and floor. Each is a flat fill, the fibre grain (a
// bundled texture, tiled) and one stitched seam. Text never sits on them.
import type { ReactNode } from 'react'
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Line, Rect } from 'react-native-svg'

import { mix } from './color'
import { useTheme } from './theme'

const GRAIN = require('../../assets/images/felt-grain.png')

// Tiled by hand: resizeMode="repeat" draws a single tile under the New Architecture on iOS.
const TILE = 128
function Grain({ width, height }: { width: number; height: number }) {
  const cols = Math.ceil(width / TILE)
  const rows = Math.ceil(height / TILE)
  return (
    <>
      {Array.from({ length: cols * rows }, (_, i) => (
        <Image key={i} source={GRAIN} style={{ position: 'absolute', left: (i % cols) * TILE, top: Math.floor(i / cols) * TILE, width: TILE, height: TILE }} accessibilityIgnoresInvertColors />
      ))}
    </>
  )
}

// A sewn-on patch tinted by the creature's colour, with what stands on it (not clipped: a hat may poke out).
export function Patch({ color, width, height, radius = 10, inset = 5, dash = '4 3', style, children }: { color: string; width: number; height: number; radius?: number; inset?: number; dash?: string; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const t = useTheme()
  const fill = mix(color, t.surface, t.patchMix)
  const thread = mix(color, t.surface, t.threadMix)
  return (
    <View style={[{ width, height }, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: fill, overflow: 'hidden' }]} pointerEvents="none">
        <Grain width={width} height={height} />
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Rect x={inset} y={inset} width={width - 2 * inset} height={height - 2 * inset} rx={Math.max(2, radius - inset + 2)} fill="none" stroke={thread} strokeWidth={1.5} strokeDasharray={dash} strokeLinecap="round" />
        </Svg>
      </View>
      {children}
    </View>
  )
}

// The Crew room: a soft back wall and a floor, one felt surface, stitched round and along the seam between them.
export function RoomFelt({ width, height, floor }: { width: number; height: number; floor: number }) {
  const t = useTheme()
  const fy = height - floor
  return (
    <View style={[StyleSheet.absoluteFill, styles.room, { backgroundColor: t.roomWall }]} pointerEvents="none">
      <View style={[styles.floor, { height: floor, backgroundColor: t.roomFloor }]} />
      <Grain width={width} height={height} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Line x1={10} y1={fy} x2={width - 10} y2={fy} stroke={t.roomThread} strokeWidth={1.5} strokeDasharray="5 3.5" strokeLinecap="round" />
        <Rect x={6} y={6} width={width - 12} height={height - 12} rx={10} fill="none" stroke={t.roomThread} strokeWidth={1.5} strokeDasharray="5 3.5" strokeLinecap="round" />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  room: { borderRadius: 14, overflow: 'hidden' },
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0 },
})

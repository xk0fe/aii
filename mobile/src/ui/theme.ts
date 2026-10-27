// Crew's look on the phone: the color tokens of desktop/ui/common.css, light and dark, following the system.
import { Platform, useColorScheme } from 'react-native'

const light = {
  dark: false,
  bg: '#f4f4f7',
  fg: '#1d1d1f',
  fg2: 'rgba(0,0,0,0.56)',
  fg3: 'rgba(0,0,0,0.36)',
  line: 'rgba(0,0,0,0.09)',
  lineStrong: 'rgba(0,0,0,0.12)',
  track: 'rgba(0,0,0,0.08)',
  btn: 'rgba(0,0,0,0.055)',
  btnPressed: 'rgba(0,0,0,0.1)',
  segOn: '#ffffff',
  bubble: '#eeeef1',
  bubbleMe: '#0a7cff',
  surface: '#ffffff',
  panel: '#f9f9fb',
  card: '#ffffff',
  field: '#ffffff',
  link: '#2563eb',
  codeBg: 'rgba(0,0,0,0.05)',
  working: '#34c759',
  workingInk: '#1e9e48',
  waiting: '#ff9f0a',
  waitingInk: '#d97b00',
  blocked: '#5e5ce6',
  blockedInk: '#4845d1',
  idle: 'rgba(128,128,128,0.55)',
  starting: '#0a84ff',
  danger: '#ff453a',
  accent: '#0a84ff',
  yolo: '#ff3b5c',
  yoloInk: '#e0244a',
  fast: '#ffb020',
  fastInk: '#c47a00',
  ctxWarm: '#ff9f0a',
  ctxHot: '#ff453a',
}

export type Theme = typeof light

const dark: Theme = {
  ...light,
  dark: true,
  bg: '#161719',
  fg: '#f2f2f4',
  fg2: 'rgba(255,255,255,0.58)',
  fg3: 'rgba(255,255,255,0.36)',
  line: 'rgba(255,255,255,0.09)',
  lineStrong: 'rgba(255,255,255,0.12)',
  track: 'rgba(255,255,255,0.1)',
  btn: 'rgba(255,255,255,0.08)',
  btnPressed: 'rgba(255,255,255,0.14)',
  segOn: 'rgba(255,255,255,0.16)',
  bubble: '#2c2c30',
  bubbleMe: '#0a72e8',
  surface: '#242528',
  panel: '#1c1c1f',
  card: '#26262a',
  field: '#252529',
  link: '#7aa2ff',
  codeBg: 'rgba(0,0,0,0.28)',
  workingInk: '#4cd964',
  waitingInk: '#ffb340',
  blocked: '#7d7aff',
  blockedInk: '#a5a3ff',
  yoloInk: '#ff6b81',
  fastInk: '#ffc24d',
}

export const themes = { light, dark }

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light
}

export const fonts = {
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  rounded: Platform.select({ ios: 'ui-rounded', default: undefined }),
}

// A type scale in the spirit of iOS's text styles.
export const type = {
  largeTitle: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '800', letterSpacing: -0.35 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400', letterSpacing: -0.15 },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: -0.1 },
  subhead: { fontSize: 14, lineHeight: 19, fontWeight: '500' },
  footnote: { fontSize: 13, lineHeight: 17, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  tiny: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
} as const

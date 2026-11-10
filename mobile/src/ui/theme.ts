// CLIque's look on the phone, light and dark, following the system: the calm v1 tokens (neutral greys, one accent for
// selection and links, status colours only where status is the message) and the v2 brand layer on top (Berry for
// primary buttons and brand moments, Fredoka for display type, felt for the creatures' patches).
// The values are the design's (mock/tokens.css, phone section, and mock/brand-v2.css).
import { Platform, useColorScheme } from 'react-native'

const light = {
  dark: false,
  bg: '#F2F2F7',
  page: '#FFFFFF', // where you read: the chat
  surface: '#FFFFFF',
  fg: '#1C1C1C',
  fg2: '#6B6B6B', // the lowest contrast any text you have to read uses
  fg3: '#9A9A9A', // icons, placeholders and disabled only
  line: 'rgba(60,60,67,0.14)',
  lineStrong: 'rgba(0,0,0,0.14)',
  fill: 'rgba(120,120,128,0.12)', // secondary buttons, fields, code
  fillPressed: 'rgba(120,120,128,0.2)',
  accent: '#007AFF', // selection and links; primary buttons are the brand's
  working: '#1F9D55', // dots
  workingInk: '#1A7F45',
  waiting: '#D97706', // the needs-you dot
  waitingInk: '#B45309', // needs-you text (#D97706 is 3.2:1 on white, this is 5:1)
  needsTint: 'rgba(217,119,6,0.10)',
  danger: '#D92D20',
  ctxWarm: '#D97706',
  ctxHot: '#D92D20',
  // brand
  brand: '#CC2277', // Berry: white on it is 5.17:1
  onBrand: '#FFFFFF',
  brandInk: '#CC2277', // brand text
  patchMix: 0.13, // a creature's felt patch: this much of its colour in the surface
  threadMix: 0.46, // and its stitch
  // older names the screens use, now on the tokens above
  btn: 'rgba(120,120,128,0.12)',
  btnPressed: 'rgba(120,120,128,0.2)',
  card: '#FFFFFF',
  panel: '#F2F2F7',
  field: 'rgba(120,120,128,0.12)',
  codeBg: 'rgba(120,120,128,0.12)',
  track: 'rgba(0,0,0,0.08)',
  link: '#007AFF',
  idle: '#9A9A9A',
  starting: '#9A9A9A',
  blocked: '#9A9A9A',
  blockedInk: '#6B6B6B',
}

export type Theme = typeof light

const dark: Theme = {
  ...light,
  dark: true,
  bg: '#000000',
  page: '#000000',
  surface: '#1C1C1E',
  fg: '#EDEDED',
  fg2: '#A0A0A0',
  fg3: '#6E6E6E',
  line: 'rgba(84,84,88,0.6)',
  lineStrong: 'rgba(255,255,255,0.16)',
  fill: 'rgba(118,118,128,0.24)',
  fillPressed: 'rgba(118,118,128,0.32)',
  accent: '#0A84FF',
  working: '#3DD68C',
  workingInk: '#3DD68C',
  waiting: '#F5A524',
  waitingInk: '#F5A524',
  needsTint: 'rgba(245,165,36,0.14)',
  danger: '#F97066',
  ctxWarm: '#F5A524',
  ctxHot: '#F97066',
  brandInk: '#FF7AC0', // 7.58:1 on the background
  patchMix: 0.2,
  threadMix: 0.55,
  btn: 'rgba(118,118,128,0.24)',
  btnPressed: 'rgba(118,118,128,0.32)',
  card: '#1C1C1E',
  panel: '#000000',
  field: 'rgba(118,118,128,0.24)',
  codeBg: 'rgba(118,118,128,0.24)',
  track: 'rgba(255,255,255,0.1)',
  link: '#0A84FF',
  idle: '#6E6E6E',
  starting: '#6E6E6E',
  blocked: '#6E6E6E',
  blockedInk: '#A0A0A0',
}

export const themes = { light, dark }

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light
}

// The brand face is bundled (assets/fonts, embedded by the expo-font plugin in app.config.js). A font's PostScript
// name is its family on iOS and its file name on Android: the files are named after it, so one name works on both.
export const fonts = {
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  brand: 'Fredoka-SemiBold',
  brandBold: 'Fredoka-Bold',
  rounded: Platform.select({ ios: 'ui-rounded', default: undefined }),
}

// iOS's Dynamic Type styles at their default size, nothing else (the system scales them with the reader's setting).
// One display size per screen, in the brand face: a screen's title.
export const type = {
  display: { fontFamily: fonts.brand, fontSize: 28, lineHeight: 34 },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '600' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const

// Shapes: controls, cards and rows, sheets.
export const radius = { control: 10, card: 14, sheet: 28 }

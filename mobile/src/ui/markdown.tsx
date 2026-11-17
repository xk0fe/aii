// Markdown for agents' replies and plans, set for reading on a phone: paragraphs, headings, bold, italics,
// strikethrough, `code`, code blocks you can copy, lists (nested, numbered, checklists), quotes, links, tables that use
// the whole width, and @mentions in the agent's color. Not a full CommonMark: what agents write.
import * as Clipboard from 'expo-clipboard'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'

import { Icon } from './icon'
import { blocks, codeText, type Align, type Block } from './md'
import { Press, tap } from './parts'
import { fonts, type Theme } from './theme'

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*(?![\s*])([\s\S]*?[^\s*])\*|(?<![\w])_(?![\s_])([\s\S]*?[^\s_])_(?![\w])|~~([\s\S]+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_])|(?<![\w.@/'-])@([\w-]+(?:@[\w-]+)?)(?![\w@/'-]|\.\w)/g

type Ctx = { t: Theme; mention?: (name: string) => string | null; code: object; link: object }

function inline(text: string, c: Ctx, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const k = `${key}.${n++}`
    if (m[2] !== undefined)
      out.push(
        <Text key={k} style={c.code}>
          {codeText(m[2])}
        </Text>,
      )
    else if (m[3] !== undefined || m[4] !== undefined)
      out.push(
        <Text key={k} style={styles.bold}>
          {inline(m[3] ?? m[4], c, k)}
        </Text>,
      )
    else if (m[5] !== undefined || m[6] !== undefined)
      out.push(
        <Text key={k} style={styles.italic}>
          {inline(m[5] ?? m[6], c, k)}
        </Text>,
      )
    else if (m[7] !== undefined)
      out.push(
        <Text key={k} style={styles.strike}>
          {inline(m[7], c, k)}
        </Text>,
      )
    else if (m[8] !== undefined) {
      const url = m[9]
      out.push(
        <Text key={k} style={c.link} onPress={() => void Linking.openURL(url).catch(() => {})} accessibilityRole="link">
          {inline(m[8], c, k)}
        </Text>,
      )
    } else if (m[10] !== undefined) {
      const url = m[10]
      out.push(
        <Text key={k} style={c.link} onPress={() => void Linking.openURL(url).catch(() => {})} accessibilityRole="link">
          {url.replace(/^https?:\/\/(www\.)?/, '')}
        </Text>,
      )
    } else if (m[11] !== undefined) {
      const color = c.mention?.(m[11].toLowerCase()) ?? c.mention?.(m[11])
      out.push(
        color ? (
          <Text key={k} style={[styles.mention, { color }]}>
            @{m[11]}
          </Text>
        ) : (
          `@${m[11]}`
        ),
      )
    }
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// A code block: its language and a Copy button on top, the code scrolling sideways under it, never wrapped.
function Code({ t, lang, text, size }: { t: Theme; lang: string; text: string; size: number }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    tap()
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }
  const fs = size - 3.5
  return (
    <View style={[styles.code, { backgroundColor: t.codeBg }]}>
      <View style={styles.codeTop}>
        <Text style={[styles.codeLang, { color: t.fg2 }]}>{lang || 'code'}</Text>
        <Press onPress={copy} style={styles.copy} hitSlop={10} accessibilityRole="button" accessibilityLabel={copied ? 'Copied' : 'Copy the code'}>
          <Icon name={copied ? 'check' : 'copy'} size={13} color={t.fg2} />
          <Text style={[styles.codeLang, { color: t.fg2 }]}>{copied ? 'Copied' : 'Copy'}</Text>
        </Press>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeInner}>
        <Text style={{ fontFamily: fonts.mono, fontSize: fs, lineHeight: Math.round(fs * 1.5), color: t.fg }}>{text}</Text>
      </ScrollView>
    </View>
  )
}

// A table across the whole width, as a reader would set it: a bold header, hairlines between rows, no grid. The
// columns share the width by how much each holds; one too wide for the screen scrolls sideways instead.
function Table({ t, rows, align, c, size, k }: { t: Theme; rows: string[][]; align: Align[]; c: Ctx; size: number; k: string }) {
  const [width, setWidth] = useState(0)
  const fs = size - 1.5
  const cols = Math.max(...rows.map((r) => r.length))
  const want = Array.from({ length: cols }, (_, j) => Math.min(220, Math.max(56, Math.max(...rows.map((r) => (r[j] ?? '').replace(/[*`_]/g, '').length)) * fs * 0.52 + 16)))
  const total = want.reduce((a, b) => a + b, 0)
  const fits = width > 0 && total <= width
  // fitting: each column gets its share of the whole width; not: its own width, and the row scrolls
  const widths = fits ? want.map((w) => (w / total) * width) : want
  const body = (
    <View style={fits ? { width } : null}>
      {rows.map((row, r) => (
        <View key={r} style={[styles.tr, { borderBottomColor: r === 0 ? t.lineStrong : t.line, borderBottomWidth: r === rows.length - 1 ? 0 : StyleSheet.hairlineWidth * (r === 0 ? 2 : 1) }]}>
          {Array.from({ length: cols }, (_, j) => (
            <Text key={j} style={[styles.td, { width: widths[j], fontSize: fs, lineHeight: Math.round(fs * 1.38), color: c.t.fg, textAlign: align[j] ?? 'left', paddingLeft: j ? 10 : 0, paddingRight: j === cols - 1 ? 0 : 6 }, r === 0 && styles.th]}>
              {inline(row[j] ?? '', c, `${k}.${r}.${j}`)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
  return (
    <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
      {width === 0 ? null : fits ? (
        body
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {body}
        </ScrollView>
      )}
    </View>
  )
}

function Check({ t, on, size }: { t: Theme; on: boolean; size: number }) {
  const s = Math.round(size * 1.05)
  return (
    <View style={[styles.check, { width: s, height: s, borderRadius: s * 0.3, borderColor: on ? t.fg2 : t.fg3, backgroundColor: on ? t.fg2 : 'transparent' }]}>
      {on ? <Icon name="check" size={s * 0.7} color={t.surface} weight="heavy" /> : null}
    </View>
  )
}

// Space above a block, by what came before it: headings get room above and sit close to what they head.
function above(b: Block, prev: Block | undefined, gap: number) {
  if (!prev) return 0
  if (b.kind === 'h') return gap + (b.level <= 2 ? 10 : 6)
  if (prev.kind === 'h') return Math.round(gap * 0.55)
  return gap
}

export const Markdown = memo(function Markdown({ text, t, color, size = 17, mention }: { text: string; t: Theme; color: string; size?: number; mention?: (name: string) => string | null }) {
  const parsed = useMemo(() => blocks(text), [text])
  const lh = Math.round(size * 1.42)
  const gap = Math.round(size * 0.72)
  const c: Ctx = {
    t,
    mention,
    code: { fontFamily: fonts.mono, fontSize: size * 0.86, backgroundColor: t.codeBg },
    link: { color: t.link, fontWeight: '500' },
  }
  const base = { color, fontSize: size, lineHeight: lh }
  return (
    <View>
      {parsed.map((b, i) => {
        const k = `b${i}`
        const mt = above(b, parsed[i - 1], gap)
        switch (b.kind) {
          case 'h': {
            const fs = b.level === 1 ? size + 6 : b.level === 2 ? size + 3 : b.level === 3 ? size + 1 : size
            return (
              <Text key={k} style={[base, styles.heading, { marginTop: mt, fontSize: fs, lineHeight: Math.round(fs * 1.28) }]} accessibilityRole="header">
                {inline(b.text, c, k)}
              </Text>
            )
          }
          case 'code':
            return (
              <View key={k} style={{ marginTop: mt }}>
                <Code t={t} lang={b.lang} text={b.text} size={size} />
              </View>
            )
          case 'list':
            return (
              <View key={k} style={[styles.list, { marginTop: mt }]}>
                {b.items.map((item, j) => (
                  <View key={j} style={[styles.li, { marginLeft: item.level * Math.round(size * 1.3) }]}>
                    <View style={[styles.marker, { minWidth: item.check !== null ? size * 1.5 : item.ordered ? size * 1.35 : size * 1.05, height: lh }]}>
                      {item.check !== null ? (
                        <Check t={t} on={item.check} size={size} />
                      ) : (
                        <Text style={[base, styles.markerText, { color: t.fg2 }, !item.ordered && { fontSize: size * (item.level ? 1 : 1.2) }]}>{item.ordered ? `${item.n}.` : item.level ? '◦' : '•'}</Text>
                      )}
                    </View>
                    <Text style={[base, styles.liText, item.check && { color: t.fg2 }]}>{inline(item.text, c, `${k}.${j}`)}</Text>
                  </View>
                ))}
              </View>
            )
          case 'quote':
            return (
              <View key={k} style={[styles.quote, { marginTop: mt }]}>
                <View style={[styles.quoteBar, { backgroundColor: t.lineStrong }]} />
                <Text style={[base, styles.quoteText, { color: t.fg2 }]}>{inline(b.text, c, k)}</Text>
              </View>
            )
          case 'table':
            return (
              <View key={k} style={{ marginTop: mt }}>
                <Table t={t} rows={b.rows} align={b.align} c={c} size={size} k={k} />
              </View>
            )
          case 'hr':
            return <View key={k} style={[styles.hr, { marginTop: mt + 4, marginBottom: 4, backgroundColor: t.lineStrong }]} />
          default:
            return (
              <Text key={k} style={[base, { marginTop: mt }]}>
                {inline(b.text, c, k)}
              </Text>
            )
        }
      })}
    </View>
  )
})

const styles = StyleSheet.create({
  bold: { fontWeight: '600' },
  heading: { fontWeight: '700', letterSpacing: -0.2 },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  mention: { fontWeight: '600' },
  code: { borderRadius: 12, overflow: 'hidden' },
  codeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8 },
  codeLang: { fontSize: 12.5, fontWeight: '500' },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  codeInner: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 11 },
  list: { gap: 6 },
  li: { flexDirection: 'row' },
  marker: { justifyContent: 'center', paddingRight: 4 },
  markerText: { fontVariant: ['tabular-nums'] },
  liText: { flex: 1 },
  check: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  quote: { flexDirection: 'row', gap: 12 },
  quoteBar: { width: 3, borderRadius: 1.5 },
  quoteText: { flex: 1 },
  tr: { flexDirection: 'row' },
  td: { paddingVertical: 8 },
  th: { fontWeight: '600' },
  hr: { height: StyleSheet.hairlineWidth * 2 },
})

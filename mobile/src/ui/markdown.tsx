// Light Markdown for agents' replies and plans: paragraphs, headings, bold, italics, strikethrough, `code`, code blocks,
// lists, quotes, links, simple tables, and @mentions in the agent's color. Not a full CommonMark: what agents write.
import { memo, useMemo, type ReactNode } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'

import { fonts, type Theme } from './theme'

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'hr' }

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))

export function blocks(src: string): Block[] {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(/^\s*(```+|~~~+)/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++
      out.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      out.push({ kind: 'h', level: h[1].length, text: h[2] })
      i++
      continue
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      out.push({ kind: 'hr' })
      i++
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const rows = [cells(line)]
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      out.push({ kind: 'table', rows })
      continue
    }
    const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
    if (item) {
      const ordered = /\d/.test(item[1])
      const start = ordered ? parseInt(item[1], 10) : 1
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
        if (m && /\d/.test(m[1]) === ordered) items.push(m[2])
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`
        else break
        i++
      }
      out.push({ kind: 'list', ordered, start, items })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push({ kind: 'quote', text: body.join('\n') })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i])) para.push(lines[i++])
    if (!para.length) para.push(lines[i++])
    out.push({ kind: 'p', text: para.join('\n') })
  }
  return out
}

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
          {m[2].replace(/^ (.*) $/, '$1')}
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
          {url}
        </Text>,
      )
    } else if (m[11] !== undefined) {
      const color = c.mention?.(m[11].toLowerCase())
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

export const Markdown = memo(function Markdown({ text, t, color, size = 16, mention }: { text: string; t: Theme; color: string; size?: number; mention?: (name: string) => string | null }) {
  const parsed = useMemo(() => blocks(text), [text])
  const lh = Math.round(size * 1.38)
  const c: Ctx = {
    t,
    mention,
    code: { fontFamily: fonts.mono, fontSize: size - 2.5, backgroundColor: t.codeBg },
    link: { color: t.link, textDecorationLine: 'underline' },
  }
  const base = { color, fontSize: size, lineHeight: lh }
  return (
    <View style={styles.wrap}>
      {parsed.map((b, i) => {
        const k = `b${i}`
        switch (b.kind) {
          case 'h':
            return (
              <Text key={k} style={[base, styles.bold, { fontSize: size + (b.level <= 2 ? 2 : 0.5), lineHeight: lh + 2 }]}>
                {inline(b.text, c, k)}
              </Text>
            )
          case 'code':
            return (
              <ScrollView key={k} horizontal showsHorizontalScrollIndicator={false} style={[styles.codeBlock, { backgroundColor: t.codeBg }]} contentContainerStyle={styles.codeInner}>
                <Text style={{ fontFamily: fonts.mono, fontSize: size - 3, lineHeight: Math.round((size - 3) * 1.45), color }} selectable>
                  {b.text}
                </Text>
              </ScrollView>
            )
          case 'list':
            return (
              <View key={k} style={styles.list}>
                {b.items.map((item, j) => (
                  <View key={j} style={styles.li}>
                    <Text style={[base, styles.marker, { color: t.fg2, minWidth: b.ordered ? size * 1.3 : size * 0.8 }]}>{b.ordered ? `${b.start + j}.` : '•'}</Text>
                    <Text style={[base, styles.liText]}>{inline(item, c, `${k}.${j}`)}</Text>
                  </View>
                ))}
              </View>
            )
          case 'quote':
            return (
              <View key={k} style={[styles.quote, { borderLeftColor: t.lineStrong }]}>
                <Text style={[base, { color: t.fg2 }]}>{inline(b.text, c, k)}</Text>
              </View>
            )
          case 'table': {
            // every row is its own line of cells, so the columns get fixed widths from their longest cell
            const widths = b.rows[0].map((_, j) => Math.min(240, Math.max(72, Math.max(...b.rows.map((r) => (r[j] ?? '').replace(/[*`_]/g, '').length)) * (size - 2) * 0.56 + 22)))
            return (
              <ScrollView key={k} horizontal showsHorizontalScrollIndicator={false} style={[styles.table, { borderColor: t.lineStrong }]}>
                <View>
                  {b.rows.map((row, r) => (
                    <View key={r} style={[styles.tr, r > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.lineStrong }, r === 0 && { backgroundColor: t.btn }]}>
                      {row.map((cell, j) => (
                        <Text key={j} style={[base, styles.td, { width: widths[j], fontSize: size - 2, lineHeight: lh - 3 }, r === 0 && styles.bold, j > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.lineStrong }]}>
                          {inline(cell, c, `${k}.${r}.${j}`)}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )
          }
          case 'hr':
            return <View key={k} style={[styles.hr, { backgroundColor: t.line }]} />
          default:
            return (
              <Text key={k} style={base}>
                {inline(b.text, c, k)}
              </Text>
            )
        }
      })}
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  mention: { fontWeight: '600' },
  codeBlock: { borderRadius: 10, flexGrow: 0, overflow: 'hidden' },
  codeInner: { paddingHorizontal: 11, paddingVertical: 9 },
  list: { gap: 4 },
  li: { flexDirection: 'row' },
  marker: { fontVariant: ['tabular-nums'] },
  liText: { flex: 1 },
  quote: { borderLeftWidth: 2, paddingLeft: 10 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, flexGrow: 0 },
  tr: { flexDirection: 'row' },
  td: { paddingHorizontal: 10, paddingVertical: 6 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
})

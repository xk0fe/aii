// Reading agents' replies on the phone: the Markdown they write, parsed the way the chat draws it.
import { blocks, codeText } from '@/ui/md'
import { makeDemo } from '@/demo/fixture'

describe('blocks', () => {
  test('a plan: a heading, numbered steps with code, a table, a checklist, a code block, a quote', () => {
    const plan = makeDemo(0)[0].state.feed.find((e) => e.id === 'f10')!.text!
    expect(blocks(plan).map((b) => b.kind)).toEqual(['h', 'p', 'list', 'h', 'table', 'list', 'p', 'code', 'quote'])
  })

  test('numbered steps keep counting across a blank line and lazy numbering, and nest', () => {
    const [list] = blocks('1. Add per-class F1\n\n1. Add false alarms per hour\n   - on normal-only footage\n   - per camera\n1. Post the baseline')
    expect(list).toEqual({
      kind: 'list',
      items: [
        { text: 'Add per-class F1', level: 0, ordered: true, n: 1, check: null },
        { text: 'Add false alarms per hour', level: 0, ordered: true, n: 2, check: null },
        { text: 'on normal-only footage', level: 1, ordered: false, n: 0, check: null },
        { text: 'per camera', level: 1, ordered: false, n: 0, check: null },
        { text: 'Post the baseline', level: 0, ordered: true, n: 3, check: null },
      ],
    })
  })

  test('an ordered list starts at its first number, and a wrapped line stays in its item', () => {
    const [list] = blocks('9. Phase 2 starts here\n   and goes on\n10. Then this')
    expect(list).toMatchObject({ items: [{ text: 'Phase 2 starts here and goes on', n: 9 }, { text: 'Then this', n: 10 }] })
  })

  test('checklists', () => {
    const [list] = blocks('- [x] Totals round once\n- [ ] Two coupons count once\n- plain item')
    expect(list).toMatchObject({ items: [{ text: 'Totals round once', check: true }, { text: 'Two coupons count once', check: false }, { text: 'plain item', check: null }] })
  })

  test('a table, with its alignment, and a paragraph right above it', () => {
    expect(blocks('Where things stand:\n| Part | Done |\n| :-- | --: |\n| Checkout | 90% |\n| Coupons | 40% |')).toEqual([
      { kind: 'p', text: 'Where things stand:' },
      { kind: 'table', align: ['left', 'right'], rows: [['Part', 'Done'], ['Checkout', '90%'], ['Coupons', '40%']] },
    ])
  })

  test('a fenced block keeps its language and its lines, minus the fence indentation', () => {
    expect(blocks('  ```sh\n  git switch fix\n    npm test\n  ```')).toEqual([{ kind: 'code', lang: 'sh', text: 'git switch fix\n  npm test' }])
  })

  test('a heading keeps a # that is part of it', () => {
    expect(blocks('## Using C#')).toEqual([{ kind: 'h', level: 2, text: 'Using C#' }])
  })

  test('code indented under an item: tabs survive, nothing is eaten', () => {
    const [, code] = blocks('1. Add to the Makefile:\n   ```make\n   build:\n\tgo build ./...\n   ```')
    expect(code).toEqual({ kind: 'code', lang: 'make', text: 'build:\n\tgo build ./...' })
  })

  test('"1." numbering keeps counting past code and a paragraph under an item', () => {
    const b = blocks('1. Install\n   ```sh\n   npm i\n   ```\n1. Run\n\n   It takes a minute.\n\n1. Test')
    expect(b.map((x) => x.kind)).toEqual(['list', 'code', 'list', 'p', 'list'])
    expect(b.flatMap((x) => (x.kind === 'list' ? x.items.map((i) => i.n) : []))).toEqual([1, 2, 3])
    expect(b[3]).toEqual({ kind: 'p', text: 'It takes a minute.' })
  })

  test('a numbered list after a heading starts over', () => {
    const b = blocks('1. One\n2. Two\n\n## Next\n\n1. Again')
    expect(b.flatMap((x) => (x.kind === 'list' ? x.items.map((i) => i.n) : []))).toEqual([1, 2, 1])
  })

  test('inline triple backticks at the start of a line are a sentence, not a fence', () => {
    expect(blocks('```npm install``` then restart.\nNext, open it.')).toEqual([{ kind: 'p', text: '```npm install``` then restart.\nNext, open it.' }])
  })

  test('a bare --- under a line with a pipe is a rule, not a table', () => {
    expect(blocks('Use `a || b` here\n\n---').map((x) => x.kind)).toEqual(['p', 'hr'])
    expect(blocks('Use `a || b` here\n---')[0].kind).toBe('p')
  })

  test('headings lose closing hashes; rules', () => {
    expect(blocks('## T9. Better anomaly evaluation ##\n\n---')).toEqual([{ kind: 'h', level: 2, text: 'T9. Better anomaly evaluation' }, { kind: 'hr' }])
  })
})

describe('code spans', () => {
  // places a line could break: a space, a hyphen, or a slash or dot not held to what follows by a word joiner
  const breaks = (s: string) => [...s].filter((ch, i, all) => ch === ' ' || ch === '-' || ('/.'.includes(ch) && all[i + 1] !== String.fromCharCode(0x2060))).length
  test('a short one never breaks inside: #training-runs, api/cart.ts', () => {
    expect(breaks(codeText('#training-runs'))).toBe(0)
    expect(breaks(codeText('docs/release-notes.md'))).toBe(0)
    expect(codeText('psm eval anomaly').trim()).toContain('psm eval anomaly')
  })
  test('a long one may wrap', () => {
    const long = 'packages/pipeline/src/evaluation/anomaly-per-class-report.ts'
    expect(codeText(long)).toContain(long)
  })
})

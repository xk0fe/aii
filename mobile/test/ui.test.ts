// The words and pictures the screens are made of, without React: status in plain words, the creatures' own voice,
// the clique's headline, the poses, the felt.
import type { Agent, FeedEntry } from '@/net/types'
import { BODIES, COLORS, moodOf, poseArt, poseOf, type Pose, type Spec } from '@/ui/avatar'
import { ellipse, flatten, fuzz, fuzzy, roundRect, toPath } from '@/ui/felt'
import { activityWords, brainLine, fileLine, reachedOver, reasonOf, statusWord, tryWords, voiceOf } from '@/ui/format'
import { andList, headline, needsOf } from '@/ui/room'
import { makeDemo } from '@/demo/fixture'

const agent = (a: Partial<Agent> & { name: string }): Agent => ({ status: 'idle', on: true, ...a })
const NOW = 1_800_000_000_000
const demo = makeDemo(NOW)
const store = demo[0].state
const open = store.feed.filter((e) => e.kind === 'ask' && !e.answer)

describe('plain words', () => {
  test.each([
    ['Edit · api/orders.ts', 'Editing api/orders.ts'],
    ['Edit core/hub.js', 'Editing core/hub.js'],
    ['Bash · npm run build', 'Running build'],
    ['Bash: npm test', 'Running the tests'],
    ['Bash · cd web && npx playwright test', 'Running playwright test'],
    ['Read · README.md', 'Reading README.md'],
    ['Grep · TODO', 'Searching for TODO'],
    ['WebFetch · https://www.example.com/docs', 'Reading example.com'],
    ['TodoWrite', 'Planning its next steps'],
    ['mcp__github__create_issue', 'Using github'],
    ['running the checkout tests', 'Running the checkout tests'],
    ['Bash · cd web &&', 'Running a command'],
  ])('%s reads "%s"', (raw, words) => expect(activityWords(raw)).toBe(words))

  test('a row says how each agent is, in v1 words', () => {
    expect(statusWord(agent({ name: 'A', status: 'working', activity: 'Edit · cart.ts' }))).toEqual({ text: 'Editing cart.ts', kind: 'working' })
    expect(statusWord(agent({ name: 'A', status: 'working' })).text).toBe('Working')
    expect(statusWord(agent({ name: 'A', status: 'waiting' }), 'ok')).toEqual({ text: 'Needs your OK', kind: 'waiting' })
    expect(statusWord(agent({ name: 'A', status: 'waiting' }), 'question').text).toBe('Has a question')
    expect(statusWord(agent({ name: 'A', status: 'waiting' }), 'plan').text).toBe('Has a plan for you')
    expect(statusWord(agent({ name: 'A', status: 'waiting' })).text).toBe('Needs you in its terminal')
    expect(statusWord(agent({ name: 'A', status: 'idle' })).text).toBe('Idle')
    expect(statusWord(agent({ name: 'A', status: 'starting' })).text).toBe('Starting…')
    expect(statusWord(agent({ name: 'A', status: 'off', on: false })).text).toBe('Off')
    expect(statusWord(agent({ name: 'A', status: 'working', waitingOn: [{ name: 'Theo', since: 1 }] })).text).toBe('Waiting on Theo')
  })

  test('who it is, in one quiet line', () => {
    const providers = { claude: { label: 'Claude' }, codex: { label: 'Codex' } }
    expect(brainLine(agent({ name: 'A', provider: 'claude', model: 'opus', effort: 'high' }), providers)).toBe('Claude Opus · High')
    expect(brainLine(agent({ name: 'A', provider: 'codex', effort: 'high', fast: true }), providers)).toBe('Codex · High · Fast')
    expect(brainLine(agent({ name: 'A', provider: 'codex' }))).toBe('Codex')
  })

  test('how the phone reaches a computer, never its address', () => {
    expect(reachedOver('192.168.1.20')).toBe('Wi-Fi')
    expect(reachedOver('10.0.0.4')).toBe('Wi-Fi')
    expect(reachedOver('studio.local')).toBe('Wi-Fi')
    expect(reachedOver('100.101.102.103')).toBe('Tailscale')
    expect(reachedOver('studio.tail1234.ts.net')).toBe('Tailscale')
    expect(reachedOver('100.200.1.1')).toBe('the internet') // outside Tailscale's 100.64/10
    expect(tryWords({ host: '192.168.1.20', why: 'closed 4008', code: 4008 })).toEqual({ where: 'Over Wi-Fi', what: 'asked to wait a minute' })
    expect(tryWords({ host: '100.101.102.103', why: 'no answer' })).toEqual({ where: 'Over Tailscale', what: 'no answer' })
    expect(tryWords({ host: 'studio.tail1234.ts.net', why: 'a different Mac answered' }).what).toBe("didn't connect")
  })

  test('nothing on screen shows an address, a port or a close code', () => {
    for (const code of [4003, 4004, 4005, 4006, 4008]) expect(tryWords({ host: '192.168.1.20', why: `closed ${code}`, code }).what).not.toMatch(/\d/)
  })
})

describe("the creature's own voice", () => {
  const permission = (ask: object): FeedEntry['ask'] => ({ type: 'permission', ...ask }) as FeedEntry['ask']
  test('a command, with its reason in words', () => {
    expect(voiceOf(permission({ tool: 'Bash', title: 'Run a command', code: 'npm run build', detail: 'Check the settings page' }))).toEqual([{ text: 'Can I run ' }, { text: 'npm run build', code: true }, { text: "? I'd like to check the settings page." }])
  })
  test('a path is not a reason, and a long command is cut', () => {
    const said = voiceOf(permission({ tool: 'Bash', code: `npm run build -- --filter=${'x'.repeat(60)}\nmore`, detail: '/Users/you/storefront' }))
    expect(said[1].code).toBe(true)
    expect(said[1].text.length).toBeLessThanOrEqual(48)
    expect(said[2].text).toBe('?')
  })
  test('the reason it says is the one the card leaves out', () => {
    expect(reasonOf(permission({ tool: 'Bash', code: 'npm run build', detail: 'Check the settings page.' }))).toBe('Check the settings page')
    expect(reasonOf(permission({ tool: 'Edit', code: '- a', detail: 'Tidy the cart' }))).toBe('') // an edit's detail is its file
    expect(reasonOf(permission({ tool: 'Bash', code: 'ls', detail: 'C:\\Users\\you\\shop' }))).toBe('')
    expect(reasonOf({ type: 'question', questions: [] })).toBe('')
  })
  test('an edit, a question, a plan, a terminal', () => {
    expect(voiceOf(permission({ tool: 'Edit', title: 'Edit cart.ts', code: '- a\n+ b' }))).toEqual([{ text: 'Can I edit cart.ts?' }])
    expect(voiceOf(permission({ tool: 'mcp__x__y', title: 'Something odd' }))).toEqual([{ text: 'Can I use mcp__x__y?' }])
    expect(voiceOf({ type: 'question', questions: [{ question: 'Should the empty cart show suggestions?', options: [] }] })).toEqual([{ text: 'Should the empty cart show suggestions?' }])
    // the line about the rest is a part of its own, so it can stand under steps set out as a list (ask.tsx AskWords)
    expect(voiceOf({ type: 'question', questions: [{ question: 'Which region?' }, { question: 'And the name?' }] })).toEqual([{ text: 'Which region?' }, { text: ' And 1 more.' }])
    expect(voiceOf({ type: 'plan', plan: '1. Do it' })[0].text).toBe("Here's my plan. Can I go ahead?")
    expect(voiceOf(true)[0].text).toBe("I'm waiting for you in my terminal.")
  })
})

describe('how the clique is doing', () => {
  test('the demo: two need you, in plain words', () => {
    expect(headline(store.agents, open)).toEqual({ title: '2 of your clique need you', line: 'Milo wants to run a command and Iris has a question.' })
    expect(needsOf(store.agents, open).map((n) => [n.agent.name, n.kind])).toEqual([['Milo', 'ok'], ['Iris', 'question']])
  })
  test('one, busy, quiet, empty, asleep', () => {
    const milo = store.agents.find((a) => a.name === 'Milo')!
    const one = open.filter((e) => e.from === 'Milo')
    expect(headline([milo], one).title).toBe('Milo needs you')
    const busy = [agent({ name: 'Ada', status: 'working' }), agent({ name: 'Theo', status: 'working' })]
    expect(headline(busy, [])).toEqual({ title: 'Everyone’s busy', line: 'Ada and Theo are at work.' })
    expect(headline([...busy, agent({ name: 'June' })], []).title).toBe('2 at work')
    expect(headline([agent({ name: 'June' })], [])).toEqual({ title: 'All quiet', line: 'Nobody needs you right now.' })
    expect(headline([agent({ name: 'Noor', on: false, status: 'off' })], []).line).toBe('Everyone is off. Turn someone on to get going.')
    expect(headline([], []).title).toBe('No one here yet')
    expect(headline(busy, [], true).title).toBe('Asleep')
  })
  test("a clone's question is its agent's: the headline and the row agree", () => {
    const ada = agent({ name: 'Ada', status: 'idle' })
    const clone = agent({ name: 'Ada.2', cloneOf: 'Ada', status: 'waiting' })
    const ask = { id: 'q', ts: 1, kind: 'ask', from: 'Ada.2', ask: { type: 'question', questions: [] } } as FeedEntry
    expect(needsOf([ada], [ask], [ada, clone]).map((n) => [n.agent.name, n.kind])).toEqual([['Ada', 'question']])
    expect(needsOf([ada], [], [ada, clone]).map((n) => [n.agent.name, n.kind])).toEqual([['Ada', 'terminal']])
    expect(headline([ada], [ask], false, [ada, clone]).title).toBe('Ada needs you')
  })
  test('many waiting fold into "and 2 more"', () => {
    const many = ['Ada', 'Milo', 'Iris', 'Theo'].map((name) => agent({ name, status: 'waiting' }))
    expect(headline(many, []).line).toBe('Ada is waiting in its terminal, Milo is waiting in its terminal and 2 more are waiting.')
    expect(andList(['a', 'b', 'c'])).toBe('a, b and c')
  })
})

describe('poses', () => {
  test('parked and away creatures sleep, matching their pose', () => {
    expect(moodOf({ status: 'parked', on: true })).toBe('sleep')
    expect(moodOf({ status: 'away', on: true })).toBe('sleep')
    expect(moodOf({ status: 'idle', on: true })).toBe('idle')
  })
  test('the status picks the pose', () => {
    expect(poseOf({ status: 'working' })).toBe('laptop')
    expect(poseOf({ status: 'working', waitingOn: [{}] })).toBe('mug')
    expect(poseOf({ status: 'idle' })).toBe('mug')
    expect(poseOf({ status: 'waiting' })).toBe('sign')
    expect(poseOf({ status: 'waiting' }, 'question')).toBe('question')
    expect(poseOf({ status: 'starting' })).toBe('pop')
    expect(poseOf({ status: 'off', on: false })).toBe('sleep')
    expect(poseOf({ status: 'parked' })).toBe('sleep')
  })
  const poses: Pose[] = ['laptop', 'mug', 'sign', 'question', 'pop', 'sleep']
  test.each(Object.keys(BODIES))('every pose fits a %s, with no gaps in its numbers', (body) => {
    for (const pose of poses) {
      const art = poseArt(pose, { body, color: 'pink', eyes: 'dot', mouth: 'smile', hat: 'none', cheeks: true } as Spec)
      const nums = JSON.stringify(art).match(/-?\d+(\.\d+)?|NaN|null/g) ?? []
      expect(nums).not.toContain('NaN')
      expect(art.s).toBeGreaterThan(0.7)
      expect(Math.abs(art.dx)).toBeLessThanOrEqual(10)
      expect(Math.abs(art.dy)).toBeLessThanOrEqual(30)
      for (const layer of [art.back, art.held, art.stand, art.float]) for (const s of layer ?? []) if (s.felt) expect(s.fill).toBeTruthy()
    }
  })
  test.each(Object.keys(BODIES))('the small laptop fits a %s: its mouth clear of the lid, its eyes in the box', (body) => {
    const b = BODIES[body]
    const art = poseArt('laptop', { body, color: 'pink', eyes: 'dot', mouth: 'smile', hat: 'none', cheeks: true } as Spec, true)
    const at = (y: number) => 97 - (97 - y) * art.s + art.dy
    expect(JSON.stringify(art)).not.toMatch(/NaN|null/)
    expect(at(b.mouth[1])).toBeLessThanOrEqual(67 - 3 + 1e-6)
    expect(at(Math.min(b.eyes[0][1], b.eyes[1][1]))).toBeGreaterThan(8)
    expect(art.stand?.length).toBe(3)
  })
  test('at its laptop it has no paws, at either size: only the laptop is drawn', () => {
    for (const small of [false, true]) {
      const art = poseArt('laptop', { body: 'blob', color: 'mint', eyes: 'dot', mouth: 'none', hat: 'glasses', cheeks: false }, small)
      expect(Object.keys(art).sort()).toEqual(['dx', 'dy', 'rot', 's', 'stand'])
      expect(art.stand?.some((s) => s.fill === COLORS.mint)).toBe(false)
    }
  })
  test('a paw holding a prop is the creature’s own colour', () => {
    const art = poseArt('mug', { body: 'blob', color: 'mint', eyes: 'dot', mouth: 'none', hat: 'glasses', cheeks: false })
    expect(art.held?.at(-1)?.fill).toBe(COLORS.mint)
  })
})

describe('felt', () => {
  test('a path becomes its outline, curves in short steps', () => {
    const [ring] = flatten('M10 10H90V90H10Z')
    expect(ring).toEqual([[10, 10], [90, 10], [90, 90], [10, 90]])
    const curvy = flatten(BODIES.blob.d)
    expect(curvy).toHaveLength(1)
    expect(curvy[0].length).toBeGreaterThan(80)
    expect(flatten('M0 0l10 0l0 10z m20 20 h5 v5 z')).toEqual([[[0, 0], [10, 0], [10, 10]], [[20, 20], [25, 20], [25, 25]]])
    expect(flatten('M0 0Q5 5 10 0T20 0').at(0)?.at(-1)).toEqual([20, 0])
    expect(flatten('M1e+1 0L2E1 1.5L.5.5Z')).toEqual([[[10, 0], [20, 1.5], [0.5, 0.5]]]) // exponents, and .5 running on
    expect(flatten('M0 0L10 0L10 10L5')).toEqual([[[0, 0], [10, 0], [10, 10]]]) // a command short of numbers ends it
    expect(flatten('L5 5 x 9 M')).toEqual([]) // nonsense ends, never hangs
  })
  test('the fuzzy edge stays within reach of the shape, and is the same every time', () => {
    const square = roundRect(20, 20, 60, 60, 8)
    const a = fuzz(square, 7, { amp: 1.7 })
    expect(a).toEqual(fuzz(square, 7, { amp: 1.7 }))
    expect(a).not.toEqual(fuzz(square, 8, { amp: 1.7 }))
    for (const [x, y] of a) {
      expect(x).toBeGreaterThanOrEqual(20 - 1.8)
      expect(x).toBeLessThanOrEqual(80 + 1.8)
      expect(y).toBeGreaterThanOrEqual(20 - 1.8)
      expect(y).toBeLessThanOrEqual(80 + 1.8)
    }
    expect(a.length).toBeGreaterThan(200)
  })
  test('an ellipse goes round, and a fuzzy outline is made once', () => {
    const e = ellipse(50, 50, 10, 5, 90)
    expect(Math.max(...e.map(([, y]) => y))).toBeCloseTo(60, 5)
    const d1 = fuzzy('k', () => [e], 3)
    expect(fuzzy('k', () => [], 3)).toBe(d1) // the second time it doesn't even look
    expect(toPath([[[0, 0], [1.23456, 2]]])).toBe('M0 0L1.2 2Z')
  })
})

describe('files an agent attached', () => {
  it('says what each one is, how long and how big', () => {
    expect(fileLine({ name: 'coupon-flow.mp4', kind: 'video', size: 2.14 * 1024 * 1024, dur: 75.4 })).toBe('Video · 1:15 · 2.1 MB')
    expect(fileLine({ name: 'long.mov', kind: 'video', size: 48 * 1024 * 1024, dur: 3725 })).toBe('Video · 1:02:05 · 48 MB')
    expect(fileLine({ name: 'totals.html', kind: 'html', size: 14 * 1024 })).toBe('HTML page · 14 KB')
    expect(fileLine({ name: 'shot.png', kind: 'image', size: 900 })).toBe('Picture · 900 B')
    expect(fileLine({ name: 'report.pdf', kind: 'file', size: 1536 })).toBe('PDF · 1.5 KB')
    expect(fileLine({ name: 'Makefile', kind: 'file', size: 10 })).toBe('File · 10 B')
  })
})

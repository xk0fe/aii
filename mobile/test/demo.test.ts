// The demo clique (App Review and the store screenshots use it) and what the stores read from the app's config.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DemoClient } from '@/demo/client'
import { makeDemo } from '@/demo/fixture'

// What must never be in the app: words from the owner's own clique, projects and machines. Kept as hashes (sha256, first
// 16 hex) so this test doesn't spell out what it guards against. A home folder other than /Users/you is caught as is.
const PRIVATE_WORDS = new Set(['625fe74cad4600b5', '5f27745723634f6e', '297581d6cd198a6e', 'b2c7973471405840', '5df28406c7453eab', '304104ef7d0d3194', '7ee8118150e0ce02', '07d046d5fac12b3f', '01b51c659dc0dcda', '4697c20f8a70fcad', '6bb1742da95106fc', '2e0b8d61fa2a6959', 'dea7cd279319a43d', 'ee425df98582637b', '67e5a3025bc013d0'])
const hash = (w: string) => crypto.createHash('sha256').update(w).digest('hex').slice(0, 16)
const privateIn = (text: string) =>
  /\/Users\/(?!you\b)/.test(text) || (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).some((w) => PRIVATE_WORDS.has(hash(w)))
const PRIVATE = { test: privateIn }

describe('the demo clique', () => {
  const [store, docs] = makeDemo(1_800_000_000_000)

  test('is the neutral clique of design/DEMO-CLIQUE.md', () => {
    expect(store.name).toBe('Storefront')
    expect(docs.name).toBe('Docs site')
    const who = Object.fromEntries(store.state.agents.map((a) => [a.seed ?? a.name, [a.area, a.provider, a.model ?? '', a.effort, a.on ? a.status : 'off', a.home ?? 'studio']]))
    expect(who).toEqual({
      Ada: ['Backend developer', 'claude', 'opus', 'high', 'working', 'studio'],
      Milo: ['Frontend developer', 'claude', 'sonnet', 'medium', 'waiting', 'studio'],
      Iris: ['Product designer', 'claude', 'opus', 'high', 'waiting', 'studio'],
      Theo: ['Tester', 'codex', '', 'high', 'working', 'studio'],
      June: ['Writer, docs and release notes', 'codex', '', 'medium', 'idle', 'studio'],
      Rex: ['Ops, builds and deploys', 'claude', 'sonnet', 'medium', 'starting', 'workstation'],
      Noor: ['Reviewer', 'codex', '', 'high', 'off', 'workstation'],
    })
    expect(store.state.agents.find((a) => a.name === 'Milo')?.yolo).toBe(true)
    expect(store.state.agents.find((a) => a.seed === 'Rex')?.fast).toBe(true)
    expect(store.state.agents.find((a) => a.name === 'Ada')?.subs?.filter((s) => !s.ended)).toHaveLength(2)
    expect(store.state.computers?.map((c) => c.name)).toEqual(['Studio', 'Workstation'])
  })

  test('asks the two things the design shows: a command and a question', () => {
    const open = store.state.feed.filter((e) => e.kind === 'ask' && !e.answer).map((e) => [e.from, typeof e.ask === 'object' ? e.ask.type : ''])
    expect(open).toEqual([['Iris', 'question'], ['Milo', 'permission']])
  })

  test('has nothing of the owner in it, nor does any source file', () => {
    expect(privateIn(JSON.stringify(makeDemo()))).toBe(false)
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name)
        if (f.isDirectory()) walk(p)
        else if (/\.(ts|tsx|js|json|md)$/.test(f.name)) files.push(p)
      }
    }
    for (const dir of ['src', 'test', 'scripts', 'store']) if (fs.existsSync(path.join(__dirname, '..', dir))) walk(path.join(__dirname, '..', dir))
    const hits = files.filter((f) => !f.endsWith('demo.test.ts') && PRIVATE.test(fs.readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('the demo answers like a computer would', () => {
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))
  test('allowing Milo gets him working, and he says so', async () => {
    jest.useFakeTimers()
    const demo = new DemoClient()
    const card = demo.getSnapshot().state!.feed.find((e) => e.from === 'Milo' && e.kind === 'ask')!
    await demo.answer(card.id, { allow: true })
    expect(demo.getSnapshot().state!.agents.find((a) => a.name === 'Milo')).toMatchObject({ status: 'working', activity: 'Bash · npm run build' })
    jest.advanceTimersByTime(3300)
    const s = demo.getSnapshot().state!
    expect(s.agents.find((a) => a.name === 'Milo')?.status).toBe('idle')
    expect(s.feed.at(-1)).toMatchObject({ from: 'Milo', kind: 'reply' })
    await expect(demo.answer(card.id, { allow: true })).rejects.toThrow('already been answered')
    demo.stop()
    jest.useRealTimers()
  })
  test('a choice answers Iris; a mention finds an agent however it is typed', async () => {
    jest.useFakeTimers()
    const demo = new DemoClient()
    const q = demo.getSnapshot().state!.feed.find((e) => e.from === 'Iris' && e.kind === 'ask')!
    await demo.answer(q.id, { answers: { 'Should the empty cart show suggestions?': ['No, keep it empty'] } })
    expect(demo.getSnapshot().state!.feed.find((e) => e.id === q.id)?.answer?.answers).toEqual({ 'Should the empty cart show suggestions?': 'No, keep it empty' })
    await expect(demo.send('', 'Can @june look at the release notes?')).resolves.toBe('sent to @June\n')
    await expect(demo.send('', 'And @rex too')).resolves.toBe('sent to @Rex@workstation\n')
    await expect(demo.send('Noor@workstation', 'hi')).rejects.toThrow('is off')
    demo.stop()
    jest.useRealTimers()
    await settle(0)
  })
})

describe('switches in the demo', () => {
  test('turned on, an agent starts in its own workspace, wherever you look meanwhile', async () => {
    jest.useFakeTimers()
    const demo = new DemoClient()
    await demo.power('June', false)
    await demo.power('June', true)
    await demo.watch('docs')
    jest.advanceTimersByTime(2000)
    await demo.watch('storefront')
    expect(demo.getSnapshot().state!.agents.find((a) => a.name === 'June')).toMatchObject({ on: true, status: 'idle' })
    demo.stop()
    jest.useRealTimers()
  })
  test('turned off, its questions stop waiting, so nothing can answer them', async () => {
    const demo = new DemoClient()
    const card = demo.getSnapshot().state!.feed.find((e) => e.from === 'Milo' && e.kind === 'ask')!
    await demo.power('Milo', false)
    const s = demo.getSnapshot().state!
    expect(s.feed.filter((e) => e.kind === 'ask' && !e.answer).map((e) => e.from)).toEqual(['Iris'])
    expect(s.feed.find((e) => e.id === card.id)?.answer).toMatchObject({ stale: true })
    await expect(demo.answer(card.id, { allow: true })).rejects.toThrow('already been answered')
    expect(demo.getSnapshot().state!.agents.find((a) => a.name === 'Milo')).toMatchObject({ on: false, status: 'off' })
    demo.stop()
  })
})

describe('the store build', () => {
  const load = (env: Record<string, string> = {}) => {
    const saved = { ...process.env }
    Object.assign(process.env, env)
    jest.resetModules()
    const config = require('../app.config.js')()
    process.env = saved
    return config
  }
  test('is 1.0.0, build 1, with one id from src/brand.js', () => {
    const c = load()
    const { APP_NAME, APP_ID } = require('../src/brand')
    expect(c).toMatchObject({ name: APP_NAME, version: '1.0.0', ios: { bundleIdentifier: APP_ID, buildNumber: '1' }, android: { package: APP_ID, versionCode: 1 } })
  })
  test('your own Apple team still gets an iOS id of its own; the Android package never moves', () => {
    const c = load({ CLIQUE_BUNDLE_ID: 'com.you.clique', CLIQUE_APPLE_TEAM: 'ABCDE12345' })
    expect(c.ios).toMatchObject({ bundleIdentifier: 'com.you.clique', appleTeamId: 'ABCDE12345' })
    expect(c.android.package).toBe(require('../src/brand').APP_ID)
  })
  test('asks for the camera only, tracks nothing, and says why it needs the local network', () => {
    const c = load()
    expect(c.android.permissions).toEqual(['android.permission.CAMERA', 'android.permission.VIBRATE'])
    expect(c.android.blockedPermissions).toEqual(expect.arrayContaining(['android.permission.RECORD_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW']))
    expect(c.ios.privacyManifests).toMatchObject({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [] })
    expect(c.ios.infoPlist.NSLocalNetworkUsageDescription).toMatch(/your computer/)
    expect(c.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false)
    const camera = c.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-camera')[1]
    expect(camera).toMatchObject({ microphonePermission: false, recordAudioAndroid: false })
  })
  test('every image and font it names is there', () => {
    const c = load()
    const files = [c.icon, c.android.adaptiveIcon.foregroundImage, c.android.adaptiveIcon.backgroundImage, c.android.adaptiveIcon.monochromeImage, ...c.plugins.flatMap((p: unknown) => (Array.isArray(p) ? [p[1]?.image, ...(p[1]?.fonts ?? [])] : [])).filter(Boolean)]
    for (const f of files) expect(fs.existsSync(path.join(__dirname, '..', f))).toBe(true)
  })
})

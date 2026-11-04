// Channels on the phone: which channel a message shows in, what's new and waiting in each, and the demo crew acting
// like the computer does (sending in a channel, Auto among its members, read marks per channel, making and deleting).
import { DemoClient } from '@/demo/client'
import { makeDemo } from '@/demo/fixture'
import type { Channel } from '@/net/types'
import { channelOf, derive, membersOf } from '@/state/hooks'

const CHANNELS: Channel[] = [{ id: 'general', name: 'general' }, { id: 'ship', name: 'ship' }]

describe('which channel a message shows in', () => {
  test('its own; #general when it has none, its channel was deleted, or the Mac sends no channels', () => {
    expect(channelOf({ channel: 'ship' }, CHANNELS)).toBe('ship')
    expect(channelOf({}, CHANNELS)).toBe('general')
    expect(channelOf({ channel: 'gone' }, CHANNELS)).toBe('general')
    expect(channelOf({ channel: 'ship' }, undefined)).toBe('general')
  })

  test("a channel's agents: its members, or everyone", () => {
    const agents = makeDemo(0)[0].state.agents.filter((a) => !a.cloneOf)
    expect(membersOf({ id: 'design', name: 'design', members: ['Iris', 'Milo'] }, agents).map((a) => a.name)).toEqual(['Milo', 'Iris'])
    expect(membersOf({ id: 'general', name: 'general' }, agents)).toHaveLength(agents.length)
  })
})

describe('what is new and waiting, per channel', () => {
  test('the demo: two new replies in #ship, a question in #general and one in #design', () => {
    const d = derive(makeDemo(1_800_000_000_000)[0].state)
    expect(d.channels?.map((c) => c.id)).toEqual(['general', 'ship', 'design'])
    expect(Object.fromEntries(d.unreadIn)).toEqual({ ship: 2 })
    expect(Object.fromEntries(d.needsIn)).toEqual({ general: 1, design: 1 })
  })

  test('a Mac that sends no channels: one chat, everything in it', () => {
    const state = makeDemo(1_800_000_000_000)[0].state
    const d = derive({ ...state, channels: undefined })
    expect(d.channels).toBeNull()
    expect([...d.unreadIn.keys()]).toEqual(['general'])
  })
})

describe('the demo crew in channels', () => {
  let demo: DemoClient
  beforeEach(() => {
    jest.useFakeTimers()
    demo = new DemoClient()
  })
  afterEach(() => {
    demo.stop()
    jest.useRealTimers()
  })
  const state = () => demo.getSnapshot().state!

  test('what you send in a channel is said there, and the reply too', async () => {
    await demo.send('Theo', 'Run them on Firefox too', { channel: 'ship' })
    expect(state().feed.at(-1)).toMatchObject({ from: 'you', to: 'Theo', channel: 'ship' })
    jest.advanceTimersByTime(5000)
    expect(state().feed.at(-1)).toMatchObject({ kind: 'reply', from: 'Theo', channel: 'ship' })
  })

  test('Auto picks among the channel members; nobody there on: it says so', async () => {
    await demo.send('', 'Sketch the cart badge', { channel: 'design' })
    expect(['Iris', 'Milo']).toContain(state().feed.at(-1)?.to)
    await demo.power('Iris', false)
    await demo.power('Milo', false)
    await expect(demo.send('', 'And the icon?', { channel: 'design' })).rejects.toThrow('nobody in #design is on to take it')
  })

  test('reading one channel leaves the others new', async () => {
    const at = Date.now() + 60000
    await demo.read({ 'Ada#ship': at })
    expect(Object.fromEntries(derive(state()).unreadIn)).toEqual({ ship: 1 })
    await demo.read({ Theo: at }) // a plain name reads every channel
    expect(derive(state()).unreadIn.size).toBe(0)
  })

  test('making, changing and deleting a channel, as the computer does', async () => {
    const { id } = await demo.channel('create', null, { name: 'Launch Day!', brief: ' The launch post. ', members: ['June'] })
    expect(id).toBe('launch-day')
    expect(state().channels?.at(-1)).toEqual({ id: 'launch-day', name: 'launch-day', brief: 'The launch post.', members: ['June'] })
    await expect(demo.channel('create', null, { name: 'launch day' })).rejects.toThrow("there's a #launch-day already")
    await demo.channel('edit', 'launch-day', { members: null, brief: '' })
    expect(state().channels?.at(-1)).toEqual({ id: 'launch-day', name: 'launch-day' })
    await expect(demo.channel('remove', 'general')).rejects.toThrow("#general can't be removed")
    await demo.channel('remove', 'launch-day')
    expect(state().channels?.map((c) => c.id)).toEqual(['general', 'ship', 'design'])
    await expect(demo.send('June', 'still there?', { channel: 'launch-day' })).rejects.toThrow('that channel is gone')
  })
})

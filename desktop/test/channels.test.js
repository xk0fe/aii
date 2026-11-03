// Channels: #general and the ones you make, each with a brief its agents are given once per conversation. Sent through
// Crew.send, as the app sends. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-channels-'))
const { CONFIG } = await import('../core/hub.js')
const { Crew } = await import('../core/crew.js')
const { addChannel, editChannel, dropChannel, channelsIn, channelName, renameShared, forget, space } = await import('../core/workspaces.js')

const REVIEW = 'Review only: never edit files. Numbered findings, most severe first.'
fs.writeFileSync(CONFIG, JSON.stringify({
  autopilot: true,
  agents: [{ name: 'iris', area: 'ui/ux designer' }, { name: 'june', area: 'Senior Backend SWE' }, { name: 'milo', area: 'ios app' }],
  channels: [{ id: 'review', name: 'review', brief: REVIEW }, { id: 'ios', name: 'ios-release', members: ['milo', 'june'] }],
}))

// One crew for every test: its agents all running; start() makes them free with nothing queued.
const crew = new Crew({ bin: '/nonexistent', computerName: 'Studio' })
let typed = []
Object.assign(crew.runner, { running: () => true, quietFor: () => Infinity, submit: (name, text) => typed.push([name, text]), write() {} })
const quiet = () => {
  for (const hub of crew.hubs.values()) {
    for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.steerTimer)
    for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(hub[t])
  }
  clearTimeout(crew.changeTimer)
}
after(() => {
  quiet()
  crew.config.close?.()
  fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 })
})

// What each agent is typed from now on, in order.
function start() {
  quiet()
  typed = []
  for (const a of crew.hub.agents.values()) Object.assign(a, { status: 'idle', inbox: [], expect: null, steering: null, current: undefined })
  return typed
}
// the agent took what it was typed: free again for the next one
const done = (name) => {
  const a = crew.hub.agents.get(name)
  a.expect = null
  a.status = 'idle'
}
const msgs = () => crew.hub.feed.filter((e) => e.kind === 'msg')

test('channel names, #general, and editing, renaming and removing channels in config.json', () => {
  assert.equal(channelName('#iOS Release!'), 'ios-release')
  const c = { agents: [{ name: 'ada' }, { name: 'bo' }] }
  assert.deepEqual(channelsIn(c), [{ id: 'general', name: 'general', brief: '' }])
  const id = addChannel(c, 'default', { name: 'Review', brief: '  look, do not touch  ', members: ['ada', 'ada'] })
  assert.equal(id, 'review')
  assert.throws(() => addChannel(c, 'default', { name: 'review' }), /there's a #review already/)
  assert.throws(() => addChannel(c, 'default', { name: '!!' }), /give the channel a name/)
  // renamed: same id, so the chat's messages stay in it; a new #review then gets another id
  editChannel(c, 'default', 'review', { name: 'audit', members: [] })
  assert.equal(addChannel(c, 'default', { name: 'review' }), 'review-2')
  assert.deepEqual(channelsIn(c).map((x) => [x.id, x.name, x.brief, x.members]), [['general', 'general', '', undefined], ['review', 'audit', 'look, do not touch', undefined], ['review-2', 'review', '', undefined]])
  // #general: only a brief, which goes again when it's emptied
  editChannel(c, 'default', 'general', { brief: 'be kind', name: 'random' })
  assert.deepEqual(channelsIn(c)[0], { id: 'general', name: 'general', brief: 'be kind' })
  editChannel(c, 'default', 'general', { brief: '' })
  assert.ok(!c.channels.some((x) => x.id === 'general'))
  assert.throws(() => dropChannel(c, 'default', 'general'), /can't be removed/)
  // members follow an agent's new name, and leave with it
  editChannel(c, 'default', 'review-2', { members: ['ada', 'bo'] })
  renameShared(c, 'ada', 'ava')
  forget(c, 'bo')
  assert.deepEqual(channelsIn(c).find((x) => x.id === 'review-2').members, ['ava'])
  dropChannel(c, 'default', 'review')
  dropChannel(c, 'default', 'review-2')
  assert.equal(c.channels, undefined)
  // a workspace's own agent renamed or removed there
  const w = { agents: [], workspaces: [{ id: 'shop', name: 'Shop', members: {}, agents: [{ name: 'kit' }] }] }
  addChannel(w, 'shop', { name: 'web', members: ['kit'] })
  space(w, 'shop').renamed('kit', 'kat')
  assert.deepEqual(channelsIn(w.workspaces[0])[1].members, ['kat'])
  space(w, 'shop').remove('kat')
  assert.equal(channelsIn(w.workspaces[0])[1].members, undefined)
})

test('a brief goes in once per conversation, again when it changes or after a compaction; #general without one adds nothing', async () => {
  const typed = start()
  await crew.send('iris', 'look at PR 70', [], { channel: 'review' })
  done('iris')
  await crew.send('iris', 'and PR 71', [], { channel: 'review' })
  done('iris')
  await crew.send('iris', 'what is the status?', [], { channel: 'general' })
  done('iris')
  await crew.send('iris', 'hello') // a phone, the floating chat: no channel at all
  done('iris')
  assert.deepEqual(typed.map(([, t]) => t), [
    `[in #review. Channel brief, for every message in #review: ${REVIEW}] look at PR 70`,
    '[in #review] and PR 71',
    'what is the status?',
    'hello',
  ])
  assert.deepEqual(msgs().map((m) => m.channel), ['review', 'review', undefined, undefined])

  // edited: given again, as changed; then just the name
  crew.channelAction('edit', 'review', { brief: 'Review only. Say [high], [med] or [low] for each.' })
  await crew.send('iris', 'PR 72', [], { channel: 'review' })
  done('iris')
  await crew.send('iris', 'PR 73', [], { channel: 'review' })
  done('iris')
  assert.match(typed.at(-2)[1], /^\[in #review\. #review's brief changed, for every message in #review from now on: Review only\. Say/)
  assert.equal(typed.at(-1)[1], '[in #review] PR 73')

  // compacted: the brief was summarized with the rest, so it comes again
  crew.hub.onHook('iris', { hook_event_name: 'SessionStart', source: 'compact' })
  await crew.send('iris', 'PR 74', [], { channel: 'review' })
  done('iris')
  assert.match(typed.at(-1)[1], /^\[in #review\. Channel brief, for every message in #review: Review only\. Say/)

  // #general with a brief: given once like any other, then named so the agent knows which brief applies
  crew.channelAction('edit', 'general', { brief: 'Keep replies short.' })
  await crew.send('iris', 'one', [], { channel: 'general' })
  done('iris')
  await crew.send('iris', 'two', [], { channel: 'general' })
  done('iris')
  assert.deepEqual(typed.slice(-2).map(([, t]) => t), ['[in #general. Channel brief, for every message in #general: Keep replies short.] one', '[in #general] two'])
  // its brief taken away: the agent hears the old one is gone
  crew.channelAction('edit', 'general', { brief: '' })
  await crew.send('iris', 'three', [], { channel: 'general' })
  done('iris')
  await crew.send('iris', 'four', [], { channel: 'general' })
  done('iris')
  assert.deepEqual(typed.slice(-2).map(([, t]) => t), ["[in #general. #general has no brief any more: what it said before doesn't apply] three", 'four'])

  // a new conversation hasn't been given anything
  crew.hub.newConvo(crew.hub.agents.get('iris'))
  await crew.send('iris', 'PR 75', [], { channel: 'review' })
  done('iris')
  assert.match(typed.at(-1)[1], /^\[in #review\. Channel brief/)
})

test('hand-offs, questions, replies and notes stay in the channel of the work they came from', async () => {
  const typed = start()
  crew.hub.newConvo(crew.hub.agents.get('iris')) // a conversation that hasn't had #review's brief
  await crew.send('june', 'check the API for PR 70', [], { channel: 'review' })
  const june = crew.hub.agents.get('june')
  const asked = msgs().at(-1)
  june.current = asked.id // the turn it's working on (UserPromptSubmit sets it)
  june.status = 'working'
  crew.hub.send({ from: 'june', to: 'iris', text: 'does the login screen send the token?' })
  crew.hub.send({ from: 'june', to: 'milo', text: 'is this on iOS too?', ask: true })
  crew.hub.note('june', 'the token refresh moved to /v2')
  const reply = crew.hub.post({ kind: 'reply', from: 'june', text: 'looks fine', re: june.current })
  assert.deepEqual(crew.hub.feed.slice(-4).map((e) => [e.kind, e.channel]), [['msg', 'review'], ['msg', 'review'], ['note', 'review'], ['reply', 'review']])
  // the teammate it reached gets the brief with it, the first time
  assert.match(typed.find(([n]) => n === 'iris')[1], /^\[in #review\. Channel brief, .*\] \[from @june: it's yours now/)
  // your reply to it from the agent's conversation (no channel of its own) stays in #review
  await crew.send('june', 'thanks', [], { re: reply.id })
  assert.equal(msgs().at(-1).channel, 'review')
  // and a removed channel's messages are #general's: no tag, no brief
  crew.channelAction('remove', 'review')
  done('june')
  crew.hub.agents.get('june').inbox = []
  await crew.send('june', 'anything else?', [], { channel: 'review' })
  assert.equal(msgs().at(-1).channel, undefined)
  crew.config.data.channels = [{ id: 'review', name: 'review', brief: REVIEW }, { id: 'ios', name: 'ios-release', members: ['milo', 'june'] }]
  crew.config.save()
})

test('Auto picks from the channel\'s members, and says so when none of them is on', async () => {
  start()
  await crew.send(undefined, 'ui/ux designer needed for the login screen', [], { channel: 'ios' })
  assert.deepEqual([msgs().at(-1).to, msgs().at(-1).channel, msgs().at(-1).auto], ['june', 'ios', true]) // iris fits best, but isn't in #ios-release
  await crew.send(undefined, 'ui/ux designer needed for the login screen', [], { channel: 'general' })
  assert.equal(msgs().at(-1).to, 'iris')
  // naming someone outside the channel still reaches them
  await crew.send('iris', 'a look from you too', [], { channel: 'ios' })
  assert.deepEqual([msgs().at(-1).to, msgs().at(-1).channel], ['iris', 'ios'])
  crew.config.data.agents = crew.config.data.agents.map((a) => (a.name === 'iris' ? a : { ...a, off: true }))
  crew.config.save()
  crew.hub.apply()
  await assert.rejects(crew.send(undefined, 'anyone?', [], { channel: 'ios' }), /nobody in #ios-release is on/)
  crew.config.data.agents = crew.config.data.agents.map(({ off, ...a }) => a)
  crew.config.save()
  crew.hub.apply()
})

test('a question typed into a busy turn that never went in gives its brief back', () => {
  start()
  const hub = crew.hub
  const milo = hub.agents.get('milo')
  hub.newConvo(milo)
  const ask = hub.post({ kind: 'msg', from: 'june', to: 'milo', text: 'is this on iOS too?', ask: true, channel: 'review' })
  milo.status = 'working'
  milo.inbox = [ask]
  hub.steer(milo)
  assert.ok(hub.convos.milo.briefs?.review)
  hub.unsteer(milo)
  assert.equal(hub.convos.milo.briefs?.review, undefined)
})

test('each channel keeps its own unread replies; a phone reading everything reads them all', () => {
  start()
  const hub = crew.hub
  const since = Date.now() + 1000 // what earlier tests said is old
  hub.reads = { since, agents: {} }
  const general = hub.post({ kind: 'reply', from: 'milo', text: 'in general', ts: since + 1 })
  const review = hub.post({ kind: 'reply', from: 'milo', text: 'in review', channel: 'review', ts: since + 2 })
  assert.equal(hub.summary().unread, 2)
  // read #review's: #general's older one stays unread
  hub.read({ 'milo#review': review.ts })
  assert.equal(hub.summary().unread, 1)
  hub.read({ 'milo#general': general.ts })
  assert.equal(hub.summary().unread, 0)
  // a phone's plain name: every channel
  const g2 = hub.post({ kind: 'reply', from: 'milo', text: 'again', ts: review.ts + 10 })
  const r2 = hub.post({ kind: 'reply', from: 'milo', text: 'again', channel: 'review', ts: review.ts + 10 })
  assert.equal(hub.summary().unread, 2)
  hub.read({ milo: Math.max(g2.ts, r2.ts) })
  assert.equal(hub.summary().unread, 0)
  // renamed: its read marks follow it
  hub.renameRefs('milo', 'max')
  assert.ok(hub.reads.channels.review.max && !('milo' in hub.reads.channels.review))
})

test('a removed channel\'s id is never taken again, and long names still get one', () => {
  const c = { agents: [] }
  addChannel(c, 'default', { name: 'design' })
  dropChannel(c, 'default', 'design')
  assert.equal(addChannel(c, 'default', { name: 'design' }), 'design-2') // design's old messages stay in #general
  const long = 'a'.repeat(40)
  addChannel(c, 'default', { name: long })
  editChannel(c, 'default', long, { name: 'short' })
  const second = addChannel(c, 'default', { name: long })
  assert.ok(second.length <= 40 && channelsIn(c).some((x) => x.id === second), second)
})

test('crew ask with nobody named picks from the channel it\'s working in', () => {
  start()
  const hub = crew.hub
  const milo = hub.agents.get('milo')
  milo.current = hub.post({ kind: 'msg', from: 'you', to: 'milo', text: 'ship it', channel: 'ios' }).id
  hub.send({ from: 'milo', text: 'ui/ux designer: is the login screen right?', ask: true }) // iris fits, but isn't in #ios-release
  const asked = msgs().at(-1)
  assert.deepEqual([asked.to, asked.channel], ['june', 'ios'])
})

test('hand-offs from two channels go in one turn each, and what comes of each stays in its channel', () => {
  start()
  const hub = crew.hub
  const iris = hub.agents.get('iris')
  hub.newConvo(iris)
  iris.status = 'working'
  for (const [from, channel, text] of [['june', 'review', 'check the colours'], ['milo', 'ios', 'check the icon']]) {
    hub.agents.get(from).current = hub.post({ kind: 'msg', from: 'you', to: from, text: 'go', channel }).id
    hub.send({ from, to: 'iris', text })
  }
  iris.status = 'idle'
  hub.pump(iris)
  assert.equal(typed.length, 1)
  assert.match(typed[0][1], /check the colours$/)
  assert.equal(iris.inbox.length, 1)
  assert.equal(iris.inbox[0].channel, 'ios')
})

test('a brief taken back after a steer that never went in leaves what was given before', () => {
  start()
  const hub = crew.hub
  const milo = hub.agents.get('milo')
  hub.newConvo(milo)
  hub.convoOf(milo).briefs = { review: 'old' } // given an older version
  const ask = hub.post({ kind: 'msg', from: 'june', to: 'milo', text: 'is this on iOS too?', ask: true, channel: 'review' })
  Object.assign(milo, { status: 'working', inbox: [ask] })
  hub.steer(milo)
  assert.notEqual(hub.convos.milo.briefs.review, 'old') // the new one went with it
  hub.unsteer(milo)
  assert.equal(hub.convos.milo.briefs.review, 'old') // it didn't go in: the new one comes again
})

test('a channel said on another computer comes with its name and brief, and its agents get the brief', async () => {
  start()
  const hub = crew.hub
  hub.newConvo(hub.agents.get('iris'))
  // as Crew.send delivers it from a computer with a #design-qa this workspace doesn't have
  hub.send({ from: 'you', to: 'iris', text: 'check the new screens', mentions: false, channel: 'design-qa', channelName: 'design-qa', brief: 'Screens only. Post screenshots.' })
  assert.equal(msgs().at(-1).channel, 'design-qa')
  assert.equal(typed.at(-1)[1], '[in #design-qa. Channel brief, for every message in #design-qa: Screens only. Post screenshots.] check the new screens')
  // and this computer sends its own channels' along when it delivers to another
  const calls = []
  crew.links.set('lab', { slug: 'lab', name: 'Lab', peer: {} })
  const { linkCall, linkedState } = crew
  crew.linkCall = async (l, fn, args) => (calls.push([fn, args[0]]), 'sent\n')
  crew.linkedState = () => ({ agents: [{ name: 'kit', status: 'idle', on: true }], feed: [], providers: {}, tasks: { tickets: [] } })
  try {
    await crew.send('kit@lab', 'look at this', [], { channel: 'review' })
  } finally {
    Object.assign(crew, { linkCall, linkedState })
    crew.links.delete('lab')
  }
  assert.deepEqual(calls.map(([fn, o]) => [fn, o.to, o.channel, o.channelName, Boolean(o.brief)]), [['deliver', 'kit', 'review', 'review', true]])
})

test('a phone reading by plain name reads channels this computer never read in', () => {
  start()
  const hub = crew.hub
  const since = Date.now() + 5000
  hub.reads = { since, agents: {} }
  const r = hub.post({ kind: 'reply', from: 'june', text: 'done', channel: 'ios', ts: since + 1 })
  assert.equal(hub.summary().unread, 1)
  hub.read({ june: r.ts })
  assert.equal(hub.summary().unread, 0)
})

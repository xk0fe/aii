// Channels: #general and the ones you make, each with a brief its agents are given once per conversation. Sent through
// Clique.send, as the app sends. Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BIN, WIN } from './helpers/platform.mjs'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-channels-'))
const { CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
const { addChannel, editChannel, dropChannel, channelsIn, channelName, renameShared, forget, space } = await import('../core/workspaces.js')
const { serve } = await import('../core/server.js')

const REVIEW = 'Review only: never edit files. Numbered findings, most severe first.'
fs.writeFileSync(CONFIG, JSON.stringify({
  autopilot: true,
  agents: [{ name: 'iris', area: 'ui/ux designer' }, { name: 'june', area: 'Senior Backend SWE' }, { name: 'milo', area: 'ios app' }],
  channels: [{ id: 'review', name: 'review', brief: REVIEW }, { id: 'ios', name: 'ios-release', members: ['milo', 'june'] }],
}))

// One clique for every test: its agents all running; start() makes them free with nothing queued.
const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
let typed = []
Object.assign(clique.runner, { running: () => true, quietFor: () => Infinity, submit: (name, text) => typed.push([name, text]), write() {} })
const quiet = () => {
  for (const hub of clique.hubs.values()) {
    for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.steerTimer)
    for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(hub[t])
  }
  clearTimeout(clique.changeTimer)
}
after(() => {
  quiet()
  clique.config.close?.()
  fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 })
})

// What each agent is typed from now on, in order.
function start() {
  quiet()
  typed = []
  for (const a of clique.hubs.get('default').agents.values()) Object.assign(a, { status: 'idle', inbox: [], expect: null, steering: null, current: undefined, holdUntil: 0 })
  return typed
}
// the agent took what it was typed: free again for the next one
const done = (name) => {
  const a = clique.hubs.get('default').agents.get(name)
  a.expect = null
  a.status = 'idle'
}
const msgs = () => clique.hubs.get('default').feed.filter((e) => e.kind === 'msg')

test('channel names, #general, and editing, renaming and removing channels in config.json', () => {
  assert.equal(channelName('#iOS Release!'), 'ios-release')
  // accents drop, they don't split a word (the phone makes the same names: mobile/src/app/channel.tsx)
  assert.deepEqual(['Café', 'Über Team', 'Résumé review', 'naïve-ui'].map(channelName), ['cafe', 'uber-team', 'resume-review', 'naive-ui'])
  const c = { agents: [{ name: 'ada' }, { name: 'bo' }], workspaces: [{ id: 'default', members: { ada: {}, bo: {} } }] }
  const own = c.workspaces[0]
  assert.deepEqual(channelsIn(own), [{ id: 'general', name: 'general', brief: '' }])
  const id = addChannel(c, 'default', { name: 'Review', brief: '  look, do not touch  ', members: ['ada', 'ada'] })
  assert.equal(id, 'review')
  assert.throws(() => addChannel(c, 'default', { name: 'review' }), /there's a #review already/)
  assert.throws(() => addChannel(c, 'default', { name: '!!' }), /give the channel a name/)
  // renamed: same id, so the chat's messages stay in it; a new #review then gets another id
  editChannel(c, 'default', 'review', { name: 'audit', members: [] })
  assert.equal(addChannel(c, 'default', { name: 'review' }), 'review-2')
  assert.deepEqual(channelsIn(own).map((x) => [x.id, x.name, x.brief, x.members]), [['general', 'general', '', undefined], ['review', 'audit', 'look, do not touch', undefined], ['review-2', 'review', '', undefined]])
  // #general: only a brief, which goes again when it's emptied
  editChannel(c, 'default', 'general', { brief: 'be kind', name: 'random' })
  assert.deepEqual(channelsIn(own)[0], { id: 'general', name: 'general', brief: 'be kind' })
  editChannel(c, 'default', 'general', { brief: '' })
  assert.ok(!own.channels.some((x) => x.id === 'general'))
  assert.throws(() => dropChannel(c, 'default', 'general'), /can't be removed/)
  // members follow an agent's new name, and leave with it
  editChannel(c, 'default', 'review-2', { members: ['ada', 'bo'] })
  renameShared(c, 'ada', 'ava')
  forget(c, 'bo')
  assert.deepEqual(channelsIn(own).find((x) => x.id === 'review-2').members, ['ava'])
  dropChannel(c, 'default', 'review')
  dropChannel(c, 'default', 'review-2')
  assert.equal(own.channels, undefined)
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
  await clique.send('iris', 'look at PR 70', [], { channel: 'review' })
  done('iris')
  await clique.send('iris', 'and PR 71', [], { channel: 'review' })
  done('iris')
  await clique.send('iris', 'what is the status?', [], { channel: 'general' })
  done('iris')
  await clique.send('iris', 'hello') // a phone, the floating chat: no channel at all
  done('iris')
  assert.deepEqual(typed.map(([, t]) => t), [
    `[in #review. Channel brief, for every message in #review: ${REVIEW}] look at PR 70`,
    '[in #review] and PR 71',
    'what is the status?',
    'hello',
  ])
  assert.deepEqual(msgs().map((m) => m.channel), ['review', 'review', undefined, undefined])

  // edited: given again, as changed; then just the name
  clique.channelAction('edit', 'review', { brief: 'Review only. Say [high], [med] or [low] for each.' })
  await clique.send('iris', 'PR 72', [], { channel: 'review' })
  done('iris')
  await clique.send('iris', 'PR 73', [], { channel: 'review' })
  done('iris')
  assert.match(typed.at(-2)[1], /^\[in #review\. #review's brief changed, for every message in #review from now on: Review only\. Say/)
  assert.equal(typed.at(-1)[1], '[in #review] PR 73')

  // compacted: the brief was summarized with the rest, so it comes again
  clique.hubs.get('default').onHook('iris', { hook_event_name: 'SessionStart', source: 'compact' })
  await clique.send('iris', 'PR 74', [], { channel: 'review' })
  done('iris')
  assert.match(typed.at(-1)[1], /^\[in #review\. Channel brief, for every message in #review: Review only\. Say/)

  // #general with a brief: given once like any other, then named so the agent knows which brief applies
  clique.channelAction('edit', 'general', { brief: 'Keep replies short.' })
  await clique.send('iris', 'one', [], { channel: 'general' })
  done('iris')
  await clique.send('iris', 'two', [], { channel: 'general' })
  done('iris')
  assert.deepEqual(typed.slice(-2).map(([, t]) => t), ['[in #general. Channel brief, for every message in #general: Keep replies short.] one', '[in #general] two'])
  // its brief taken away: the agent hears the old one is gone
  clique.channelAction('edit', 'general', { brief: '' })
  await clique.send('iris', 'three', [], { channel: 'general' })
  done('iris')
  await clique.send('iris', 'four', [], { channel: 'general' })
  done('iris')
  assert.deepEqual(typed.slice(-2).map(([, t]) => t), ["[in #general. #general has no brief any more: what it said before doesn't apply] three", 'four'])

  // a new conversation hasn't been given anything
  clique.hubs.get('default').newConvo(clique.hubs.get('default').agents.get('iris'))
  await clique.send('iris', 'PR 75', [], { channel: 'review' })
  done('iris')
  assert.match(typed.at(-1)[1], /^\[in #review\. Channel brief/)
})

test('hand-offs, questions, replies and notes stay in the channel of the work they came from', async () => {
  const typed = start()
  clique.hubs.get('default').newConvo(clique.hubs.get('default').agents.get('iris')) // a conversation that hasn't had #review's brief
  await clique.send('june', 'check the API for PR 70', [], { channel: 'review' })
  const june = clique.hubs.get('default').agents.get('june')
  const asked = msgs().at(-1)
  june.current = asked.id // the turn it's working on (UserPromptSubmit sets it)
  june.status = 'working'
  clique.hubs.get('default').send({ from: 'june', to: 'iris', text: 'does the login screen send the token?' })
  clique.hubs.get('default').send({ from: 'june', to: 'milo', text: 'is this on iOS too?', ask: true })
  clique.hubs.get('default').note('june', 'the token refresh moved to /v2')
  const reply = clique.hubs.get('default').post({ kind: 'reply', from: 'june', text: 'looks fine', re: june.current })
  assert.deepEqual(clique.hubs.get('default').feed.slice(-4).map((e) => [e.kind, e.channel]), [['msg', 'review'], ['msg', 'review'], ['note', 'review'], ['reply', 'review']])
  // the teammate it reached gets the brief with it, the first time
  assert.match(typed.find(([n]) => n === 'iris')[1], /^\[in #review\. Channel brief, .*\] \[from @june: it's yours now/)
  // your reply to it from the agent's conversation (no channel of its own) stays in #review
  await clique.send('june', 'thanks', [], { re: reply.id })
  assert.equal(msgs().at(-1).channel, 'review')
  // and a removed channel's messages are #general's: no tag, no brief
  clique.channelAction('remove', 'review')
  done('june')
  clique.hubs.get('default').agents.get('june').inbox = []
  await clique.send('june', 'anything else?', [], { channel: 'review' })
  assert.equal(msgs().at(-1).channel, undefined)
  clique.config.data.workspaces[0].channels = [{ id: 'review', name: 'review', brief: REVIEW }, { id: 'ios', name: 'ios-release', members: ['milo', 'june'] }]
  clique.config.save()
})

test('Auto picks from the channel\'s members, and says so when none of them is on', async () => {
  start()
  await clique.send(undefined, 'ui/ux designer needed for the login screen', [], { channel: 'ios' })
  assert.deepEqual([msgs().at(-1).to, msgs().at(-1).channel, msgs().at(-1).auto], ['june', 'ios', true]) // iris fits best, but isn't in #ios-release
  await clique.send(undefined, 'ui/ux designer needed for the login screen', [], { channel: 'general' })
  assert.equal(msgs().at(-1).to, 'iris')
  // naming someone outside the channel still reaches them
  await clique.send('iris', 'a look from you too', [], { channel: 'ios' })
  assert.deepEqual([msgs().at(-1).to, msgs().at(-1).channel], ['iris', 'ios'])
  const members = clique.config.data.workspaces[0].members
  for (const name of ['june', 'milo']) members[name] = { off: true }
  clique.config.save()
  clique.hubs.get('default').apply()
  await assert.rejects(clique.send(undefined, 'anyone?', [], { channel: 'ios' }), /nobody in #ios-release is on/)
  for (const name of ['june', 'milo']) members[name] = {}
  clique.config.save()
  clique.hubs.get('default').apply()
})

test('a question typed into a busy turn that never went in gives its brief back', () => {
  start()
  const hub = clique.hubs.get('default')
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
  const hub = clique.hubs.get('default')
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
  const c = { agents: [], workspaces: [{ id: 'default', members: {} }] }
  addChannel(c, 'default', { name: 'design' })
  dropChannel(c, 'default', 'design')
  assert.equal(addChannel(c, 'default', { name: 'design' }), 'design-2') // design's old messages stay in #general
  const long = 'a'.repeat(40)
  addChannel(c, 'default', { name: long })
  editChannel(c, 'default', long, { name: 'short' })
  const second = addChannel(c, 'default', { name: long })
  assert.ok(second.length <= 40 && channelsIn(c.workspaces[0]).some((x) => x.id === second), second)
})

test('clique ask with nobody named picks from the channel it\'s working in', () => {
  start()
  const hub = clique.hubs.get('default')
  const milo = hub.agents.get('milo')
  milo.current = hub.post({ kind: 'msg', from: 'you', to: 'milo', text: 'ship it', channel: 'ios' }).id
  hub.send({ from: 'milo', text: 'ui/ux designer: is the login screen right?', ask: true }) // iris fits, but isn't in #ios-release
  const asked = msgs().at(-1)
  assert.deepEqual([asked.to, asked.channel], ['june', 'ios'])
})

test('hand-offs from two channels go in one turn each, and what comes of each stays in its channel', () => {
  start()
  const hub = clique.hubs.get('default')
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
  const hub = clique.hubs.get('default')
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
  const hub = clique.hubs.get('default')
  hub.newConvo(hub.agents.get('iris'))
  // as Clique.send delivers it from a computer with a #design-qa this workspace doesn't have
  hub.send({ from: 'you', to: 'iris', text: 'check the new screens', mentions: false, channel: 'design-qa', channelName: 'design-qa', brief: 'Screens only. Post screenshots.' })
  assert.equal(msgs().at(-1).channel, 'design-qa')
  assert.equal(typed.at(-1)[1], '[in #design-qa. Channel brief, for every message in #design-qa: Screens only. Post screenshots.] check the new screens')
  // and this computer sends its own channels' along when it delivers to another
  const calls = []
  clique.links.set('lab', { slug: 'lab', name: 'Lab', peer: {} })
  const { linkCall, linkedState } = clique
  clique.linkCall = async (l, fn, args) => (calls.push([fn, args[0]]), 'sent\n')
  clique.linkedState = () => ({ agents: [{ name: 'kit', status: 'idle', on: true }], feed: [], providers: {}, tasks: { tickets: [] } })
  try {
    await clique.send('kit@lab', 'look at this', [], { channel: 'review' })
  } finally {
    Object.assign(clique, { linkCall, linkedState })
    clique.links.delete('lab')
  }
  assert.deepEqual(calls.map(([fn, o]) => [fn, o.to, o.channel, o.channelName, Boolean(o.brief)]), [['deliver', 'kit', 'review', 'review', true]])
})

test('a phone reading by plain name reads channels this computer never read in', () => {
  start()
  const hub = clique.hubs.get('default')
  const since = Date.now() + 5000
  hub.reads = { since, agents: {} }
  const r = hub.post({ kind: 'reply', from: 'june', text: 'done', channel: 'ios', ts: since + 1 })
  assert.equal(hub.summary().unread, 1)
  hub.read({ june: r.ts })
  assert.equal(hub.summary().unread, 0)
})

// ---- clique post: an agent picks the channel -------------------------------------------------------------------------

const replies = (hub) => hub.feed.filter((e) => e.kind === 'reply')
// `clique post <words>` as the /post route hands it over
const post = (hub, from, ...words) => hub.postIn(from, words)

test('clique post: the agent picks a channel, it lands unread there, and takes up nobody\'s turn', () => {
  start()
  const hub = clique.hubs.get('default')
  const iris = hub.agents.get('iris')
  const asked = hub.post({ kind: 'msg', from: 'you', to: 'iris', text: 'write the release notes' })
  Object.assign(iris, { status: 'working', current: asked.id })
  hub.reads = { since: 0, agents: {} }
  hub.channelsText('iris') // it has read #review's brief
  const before = hub.summary().unread

  assert.equal(post(hub, 'iris', 'review', 'the colours', 'are ready'), 'posted in #review\n')
  const said = replies(hub).at(-1)
  assert.deepEqual([said.from, said.text, said.channel, said.re], ['iris', 'the colours are ready', 'review', undefined])
  // nobody was handed anything, and iris is still on what it was on
  assert.deepEqual(typed, [])
  for (const a of hub.agents.values()) assert.deepEqual(a.inbox, [])
  assert.deepEqual([iris.status, iris.current], ['working', asked.id])
  // unread in #review, and only there
  assert.equal(hub.summary().unread, before + 1)
  hub.read({ iris: said.ts }) // a plain name reads everywhere (a phone): see the test above
  assert.equal(hub.summary().unread, before)
  hub.reads = { since: 0, agents: {} }
  hub.read({ 'iris#general': said.ts })
  assert.equal(hub.readTo(said), 0)
  hub.read({ 'iris#review': said.ts })
  assert.equal(hub.readTo(said), said.ts)

  // its final message still goes where it was asked, not where it posted
  hub.onHook('iris', { hook_event_name: 'Stop', last_assistant_message: 'notes are in' })
  const final = replies(hub).at(-1)
  assert.deepEqual([final.text, final.re, final.channel], ['notes are in', asked.id, undefined])
})

test('clique post: a name finds its channel however it\'s written, and a renamed channel\'s old id doesn\'t shadow a newer name', () => {
  start()
  const hub = clique.hubs.get('default')
  for (const name of ['review', '#review', 'Review', ' #REVIEW ']) assert.equal(hub.channelNamed(name)?.id, 'review', name)
  assert.equal(hub.channelNamed('ios-release')?.id, 'ios', 'by its name')
  assert.equal(hub.channelNamed('#iOS Release')?.id, 'ios', 'as channel names are made')
  assert.equal(hub.channelNamed('ios')?.id, 'ios', 'by its id')
  assert.equal(hub.channelNamed('nope'), undefined)
  // #review renamed #audit keeps the id "review", and a new #review gets "review-2"
  const channels = [{ id: 'general', name: 'general' }, { id: 'review', name: 'audit' }, { id: 'review-2', name: 'review' }]
  assert.equal(hub.channelNamed.call({ space: { channels } }, 'review').id, 'review-2')
  assert.equal(hub.channelNamed.call({ space: { channels } }, 'audit').id, 'review')
})

test('clique post to #general from a channel stays in #general, with or without an @name', () => {
  start()
  const hub = clique.hubs.get('default')
  const june = hub.agents.get('june')
  june.current = hub.post({ kind: 'msg', from: 'you', to: 'june', text: 'review the api', channel: 'review' }).id
  assert.equal(post(hub, 'june', 'general', 'api review is under way'), 'posted in #general\n')
  assert.equal(replies(hub).at(-1).channel, undefined)
  assert.equal(post(hub, 'june', '#general', '@iris does the login screen need this?'), 'sent to @iris\n')
  const m = msgs().at(-1)
  assert.deepEqual([m.to, m.channel], ['iris', undefined], 'not the channel june is working in')
  assert.doesNotMatch(typed.at(-1)[1], /\[in #/)
  // a hand-off that names no channel still goes in the one the agent's working in
  done('iris')
  hub.send({ from: 'june', to: 'iris', text: 'and on the settings screen?' })
  assert.equal(msgs().at(-1).channel, 'review')
})

test('clique post with an @name hands it to them in that channel, with its brief, and what comes of it stays there', () => {
  start()
  const hub = clique.hubs.get('default')
  hub.newConvo(hub.agents.get('iris'))
  hub.channelsText('june')
  assert.equal(post(hub, 'june', 'review', '@iris please check the colours'), 'sent to @iris\n')
  const m = msgs().at(-1)
  assert.deepEqual([m.from, m.to, m.channel, m.text], ['june', 'iris', 'review', '@iris please check the colours'])
  assert.equal(typed.at(-1)[1], `[in #review. Channel brief, for every message in #review: ${REVIEW}] [from @june: it's yours now, no need to report back] @iris please check the colours`)
  hub.onHook('iris', { hook_event_name: 'UserPromptSubmit', prompt: typed.at(-1)[1] })
  hub.onHook('iris', { hook_event_name: 'Stop', last_assistant_message: 'they look right' })
  const answer = replies(hub).at(-1)
  assert.deepEqual([answer.from, answer.re, answer.channel], ['iris', m.id, 'review'])
  // the rules of any hand-off hold: a name that isn't there, or yourself, and nothing goes out
  const n = hub.feed.length
  assert.throws(() => post(hub, 'june', 'review', '@ghost take a look'), /no agent named "ghost"/)
  assert.throws(() => post(hub, 'june', 'review', '@june note to self'), /that's you/)
  assert.equal(hub.feed.length, n)
  // an @name in code isn't one, and @you isn't an agent: both are just said
  assert.equal(post(hub, 'june', 'review', 'see `@iris` in the config, @you'), 'posted in #review\n')
  assert.equal(replies(hub).at(-1).text, 'see `@iris` in the config, @you')
})

test('clique post with Autopilot off: a hand-off waits for your OK, a plain post needs none', () => {
  start()
  const hub = clique.hubs.get('default')
  hub.space.autopilot = false
  hub.channelsText('june')
  try {
    assert.equal(post(hub, 'june', 'review', 'the api looks fine'), 'posted in #review\n')
    assert.match(post(hub, 'june', 'review', '@iris look at this'), /waiting for the user to approve/)
    assert.equal(msgs().at(-1).held, true)
    assert.deepEqual(typed, [])
    hub.drop(msgs().at(-1).id)
  } finally {
    hub.space.autopilot = true
  }
})

test('clique post: a channel it isn\'t in, one that isn\'t there, and nothing to say are turned down, and nothing goes out', () => {
  start()
  const hub = clique.hubs.get('default')
  const n = hub.feed.length
  assert.throws(() => post(hub, 'iris', 'ios-release', 'hello'), /you're not in #ios-release, so nothing was posted: it's for @milo, @june/)
  assert.throws(() => post(hub, 'iris', 'ios-release', '@milo hello'), /you're not in #ios-release/)
  assert.throws(() => post(hub, 'iris', 'nope', 'hello'), /there's no #nope here: there's #general, #review, #ios-release \(clique channels\)/)
  // what a shell leaves of `clique post #review "hi"`, an old clique, or no words at all
  assert.throws(() => post(hub, 'iris'), /usage: clique post <channel> "message" \(the name alone/)
  assert.throws(() => post(hub, 'iris', 'review'), /usage: clique post/)
  assert.throws(() => post(hub, 'iris', 'review', '   '), /usage: clique post/)
  assert.equal(hub.feed.length, n)
  // one of its members can, and so can its clones
  assert.equal(post(hub, 'milo', 'ios-release', 'build 12 is up'), 'posted in #ios-release\n')
  assert.equal(replies(hub).at(-1).channel, 'ios')
  hub.agents.set('milo.2', { ...hub.agents.get('milo'), name: 'milo.2', cloneOf: 'milo' })
  try {
    assert.equal(post(hub, 'milo.2', 'ios-release', 'build 13 is up'), 'posted in #ios-release\n')
  } finally {
    hub.agents.delete('milo.2')
  }
})

test('clique post: an agent is given a channel\'s brief before it says anything there, once per conversation', () => {
  start()
  const hub = clique.hubs.get('default')
  const iris = hub.agents.get('iris')
  hub.newConvo(iris)
  const n = hub.feed.length
  const refused = new RegExp(`not posted yet\\. #review's brief, for every message there: ${REVIEW}\\nPost it again, by that brief\\.`)
  assert.throws(() => post(hub, 'iris', 'review', 'looks fine'), refused)
  assert.equal(hub.feed.length, n, 'nothing said yet')
  assert.equal(post(hub, 'iris', 'review', '1. looks fine'), 'posted in #review\n')
  // it has the brief now, so a message from there only names it
  hub.send({ from: 'you', to: 'iris', text: 'and the icons?', mentions: false, channel: 'review' })
  assert.equal(typed.at(-1)[1], '[in #review] and the icons?')
  done('iris')
  iris.current = undefined
  // a hand-off in that channel goes by it too; a new conversation hasn't read it
  hub.newConvo(hub.agents.get('june'))
  assert.throws(() => post(hub, 'june', 'review', '@iris have a look'), refused)
  assert.equal(post(hub, 'june', 'review', '@iris 1. have a look'), 'sent to @iris\n')
  done('iris')
  iris.current = undefined
  // a message there gives it as well
  hub.newConvo(iris)
  hub.giveBrief(iris, hub.channel('review'))
  assert.equal(post(hub, 'iris', 'review', '2. looks fine'), 'posted in #review\n')
  // a changed brief is another brief
  clique.channelAction('edit', 'review', { brief: 'Be short.' }, 'default')
  try {
    assert.throws(() => post(hub, 'iris', 'review', 'looks fine'), /#review's brief, for every message there: Be short\./)
    assert.equal(post(hub, 'iris', 'review', 'fine'), 'posted in #review\n')
  } finally {
    clique.channelAction('edit', 'review', { brief: REVIEW }, 'default')
  }
  // no brief, nothing to wait for
  hub.newConvo(iris)
  assert.equal(post(hub, 'iris', 'general', 'hello'), 'posted in #general\n')
  // clique channels shows it whole, which counts
  hub.channelsText('iris')
  assert.equal(post(hub, 'iris', 'review', '3. looks fine'), 'posted in #review\n')
})

test('clique post in the channel it\'s working in: its final message goes there by itself, so it isn\'t said twice', () => {
  start()
  const hub = clique.hubs.get('default')
  const [iris, june] = [hub.agents.get('iris'), hub.agents.get('june')]
  hub.channelsText('june')
  june.current = hub.post({ kind: 'msg', from: 'you', to: 'june', text: 'review the api', channel: 'review' }).id
  const n = hub.feed.length
  assert.throws(() => post(hub, 'june', 'review', 'it looks fine'), /not posted: you're working in #review, and your final message shows there by itself\. Say it there\./)
  iris.current = hub.post({ kind: 'msg', from: 'you', to: 'iris', text: 'say hi' }).id
  assert.throws(() => post(hub, 'iris', 'general', 'hi'), /not posted: you're working in #general/)
  assert.equal(hub.feed.length, n + 1, 'only the message to iris')
  // an @name there is a hand-off, not its answer
  iris.current = undefined
  assert.equal(post(hub, 'june', 'review', '@iris look at the colours'), 'sent to @iris\n')
  assert.equal(msgs().at(-1).channel, 'review')
  // not working on anything: nothing to say it twice
  june.current = undefined
  assert.equal(post(hub, 'june', 'review', 'it looks fine'), 'posted in #review\n')
})

test('clique post from your own terminal goes as what you type in that channel does', () => {
  start()
  const hub = clique.hubs.get('default')
  assert.equal(post(hub, 'you', 'ios-release', 'ui/ux designer: the login screen'), 'sent to @june\n') // iris fits, but isn't in it
  const m = msgs().at(-1)
  assert.deepEqual([m.from, m.to, m.channel, m.auto], ['you', 'june', 'ios', true])
  assert.equal(post(hub, 'you', 'review', '@iris check the colours'), 'sent to @iris\n')
  assert.equal(msgs().at(-1).channel, 'review')
})

test('clique channels lists them, with each whole brief, and says which ones an agent isn\'t in', () => {
  const hub = clique.hubs.get('default')
  const rows = (from) => hub.channelsText(from).split('\n')
  assert.match(rows('june')[0], /^#general +everyone +\(no brief\)$/)
  assert.match(rows('june')[1], new RegExp(`^#review +everyone +${REVIEW}$`))
  assert.match(rows('june')[2], /^#ios-release +@milo @june +\(no brief\)$/)
  assert.match(rows('iris')[2], /^#ios-release +@milo @june +\(no brief\) \(you're not in it\)$/)
  assert.match(rows('you')[2], /^#ios-release +@milo @june +\(no brief\)$/)
})

test('clique post and clique channels, as an agent runs them, land in its workspace', async () => {
  const hub = clique.hubs.get('default')
  start()
  const server = await serve({ token: 'tok', hubFor: (id) => clique.hubs.get(id) })
  const home = fs.mkdtempSync(path.join(process.env.CLIQUE_HOME, 'cli-'))
  fs.writeFileSync(path.join(home, 'url'), `http://127.0.0.1:${server.address().port}`)
  fs.writeFileSync(path.join(home, 'token'), 'tok')
  const env = { ...process.env, CLIQUE_HOME: home, CLIQUE_AGENT: 'june', CLIQUE_WORKSPACE: 'default' }
  const run = (file, args) => new Promise((resolve) => execFile(file, args, { env }, (e, stdout, stderr) => resolve({ code: e?.code ?? 0, stdout, stderr })))
  const tricky = 'it\'s "done" & $HOME\nsecond line'
  const clis = [['clique.mjs', (...a) => run(process.execPath, [path.join(BIN, 'clique.mjs'), 'clique', ...a])], ...(WIN ? [] : [['bin/clique', (...a) => run(path.join(BIN, 'clique'), a)]])]
  try {
    for (const [what, cli] of clis) {
      hub.newConvo(hub.agents.get('june'))
      assert.match((await cli('post', '#Review', tricky)).stdout, /^not posted yet\. #review's brief/, what) // printed, as any answer is
      assert.equal((await cli('post', '#Review', tricky)).stdout, 'posted in #review\n', what)
      assert.deepEqual([replies(hub).at(-1).from, replies(hub).at(-1).text, replies(hub).at(-1).channel], ['june', tricky, 'review'], what)
      assert.match((await cli('channels')).stdout, /^#ios-release +@milo @june/m, what)
      const usage = await cli('post')
      assert.equal(usage.code, 2, what)
      assert.match(usage.stderr, /usage: clique post <channel>/, what)
    }
  } finally {
    server.close()
  }
})

// Reactions: `clique react <emoji>` puts one emoji on the message an agent is answering, in place of a written "got it"
// (Hub.react, core/reactions.js). A reaction is not a message. Real Hub, fake runner, throwaway CLIQUE_HOME.
// Run with `npm test`.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { BIN, WIN } from './helpers/platform.mjs'

process.env.CLIQUE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clique-reactions-'))
const { Hub, CONFIG } = await import('../core/hub.js')
const { Clique } = await import('../core/clique.js')
const { serve } = await import('../core/server.js')
const { emojiOf, justAnAck, saidWith, REACT_MAX, REACT_WINDOW } = await import('../core/reactions.js')
const { inThread } = await import('../core/threads.js')
const { reactionGroups, HANDY_REACTIONS } = await import('clique-shared/protocol.js')
// the chat as the app draws it (ui/common.js), without a window
const ui = vm.createContext({ clique: {}, avatarHTML: (a) => `<svg data-face="${a.name}"></svg>`, agentColor: () => '', CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.resolve(import.meta.dirname, '../ui/common.js'), 'utf8') + ';globalThis.__x = { feedView, reactionGroups, reactsSig, REACT_HANDY }', ui)

class FakeRunner extends EventEmitter {
  live = new Set()
  typed = []
  running = (n) => this.live.has(n)
  start = (n) => this.live.add(n)
  stop = (n) => this.live.delete(n)
  submit = (n, text) => this.typed.push({ n, text })
  write() {}
  quietFor = () => Infinity
}

let hub, runner
const done = () => {
  for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.steerTimer)
  for (const t of ['statsTimer', 'readsTimer', 'convoTimer', 'runtimeTimer']) clearTimeout(hub[t])
  clearInterval(hub.stallTimer)
  return hub.saving
}
const AGENTS = [{ name: 'jeff', area: 'lead' }, { name: 'joseph', area: 'backend' }, { name: 'david', area: 'frontend' }]
const fresh = (config = {}) => {
  for (const f of ['conversations.json', 'sessions.json', 'feed.jsonl', 'reads.json', 'runtime.json']) fs.rmSync(path.join(process.env.CLIQUE_HOME, f), { force: true })
  fs.writeFileSync(CONFIG, JSON.stringify({ autopilot: true, agents: AGENTS, ...config }))
  runner = new FakeRunner()
  hub = new Hub(runner, { bin: '/nonexistent' })
  for (const a of hub.agents.values()) (runner.live.add(a.name), (a.status = 'idle'))
}
beforeEach(() => fresh())
afterEach(() => done())
after(() => fs.rmSync(process.env.CLIQUE_HOME, { recursive: true, force: true, maxRetries: 10 }))

// the agent takes what it was last given...
const begin = (name) => hub.onHook(name, { hook_event_name: 'UserPromptSubmit', prompt: runner.typed.filter((t) => t.n === name).at(-1).text })
// ...runs a shell command (the hook that follows it)...
const tool = (name) => hub.onHook(name, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' } })
// ...and finishes saying `text`
const end = (name, text) => {
  hub.onHook(name, { hook_event_name: 'Stop', last_assistant_message: text })
  hub.agents.get(name).holdUntil = 0
}
const react = (from, emoji) => hub.react({ from, emoji })
const said = (id) => hub.feed.find((e) => e.id === id)
const marks = (e) => (e.reactions ?? []).map((r) => `${r.by}${r.emoji}`)

test('one emoji, or a name for one: nothing else is a reaction', () => {
  for (const ok of ['👍', '👀', '✅', '🙏', '🎉', '👍🏽', '👨‍👩‍👧', '🇳🇱', '1️⃣', '🫡']) assert.equal(emojiOf(ok), ok, ok)
  assert.equal(emojiOf('❤'), '❤️') // a terminal dropped its "as an emoji" mark: the same reaction
  assert.equal(emojiOf('❤️'), '❤️')
  assert.deepEqual(['+1', ':eyes:', 'check', 'THANKS', 'heart', ' tada '].map(emojiOf), ['👍', '👀', '✅', '🙏', '❤️', '🎉'])
  for (const no of ['', 'lgtm', 'a', '1', '👍👍', '👍 ok', 'ok!', '<b>', ':nope:', '👍'.repeat(9)]) assert.equal(emojiOf(no), null, JSON.stringify(no))
})

test('what a turn says after reacting: an acknowledgement over again, or a message of its own', () => {
  for (const ack of ['', '👍', 'Reacted with 👍.', 'Noted, thanks.', 'Got it — nothing to add.', 'Acknowledged. Standing by.']) assert.equal(justAnAck(ack), true, ack)
  for (const real of ['Which branch do you mean?', "I couldn't find the file.", 'The build failed on main.', 'One.\nTwo.\nThree.', '```\ncode\n```', `Done: ${'word '.repeat(30)}`]) assert.equal(justAnAck(real), false, real)
  assert.equal(saidWith('Reacted with 👍.', '👍'), '')
  assert.equal(saidWith('👍', '👍'), '')
  assert.equal(saidWith('Noted, the freeze is Thursday.', '👍'), 'Noted, the freeze is Thursday.')
})

test('an agent reacts to your message: an emoji on it, and nothing else happens anywhere', () => {
  hub.send({ to: 'jeff', text: 'FYI: the release freeze starts Thursday' })
  const msg = hub.feed.at(-1)
  begin('jeff')
  const before = { feed: hub.feed.length, typed: runner.typed.length, reads: JSON.stringify(hub.reads) }
  const notices = []
  for (const what of ['alert', 'notice']) hub.on(what, (...a) => notices.push(a))
  assert.equal(react('jeff', '👍'), "👍 is on the user's message. That's your acknowledgement: end your turn now, with a word at most.\n")
  tool('jeff') // the shell command that reacted
  assert.deepEqual(marks(msg), ['jeff👍'])
  assert.equal(typeof msg.reactions[0].at, 'number')
  assert.equal(hub.feed.length, before.feed, 'no line in the chat')
  assert.equal(runner.typed.length, before.typed, "nothing typed into anyone's terminal")
  assert.equal(JSON.stringify(hub.reads), before.reads, 'nothing read or unread')
  assert.deepEqual([...hub.agents.values()].map((a) => a.inbox.length), [0, 0, 0], 'nobody has anything queued')
  assert.deepEqual(notices, [], 'no notification')
  // its turn ends on a word: the reaction was the answer, so the chat gets no reply line
  end('jeff', 'Noted.')
  assert.equal(hub.feed.length, before.feed)
  assert.equal(hub.feed.some((e) => e.kind === 'reply'), false)
  assert.equal(hub.agents.get('jeff').status, 'idle')
  assert.equal(msg.reactions[0].said, 'Noted.', 'the word stays with the reaction')
  // what clients get carries it
  assert.deepEqual(hub.snapshot().feed.find((e) => e.id === msg.id).reactions.map((r) => r.emoji), ['👍'])
})

test("a teammate's hand-off: the reaction lands on it, the teammate isn't woken or told, and the thread gets no row", () => {
  hub.send({ to: 'jeff', text: 'ship the tables' })
  begin('jeff')
  hub.send({ from: 'jeff', to: 'joseph', text: 'heads-up: I renamed rows to items in the API, nothing for you to do' })
  end('jeff', 'Told Joseph.')
  const handoff = hub.feed.findLast((e) => e.kind === 'msg' && e.to === 'joseph')
  begin('joseph')
  const before = { feed: hub.feed.length, typed: runner.typed.length }
  assert.equal(react('joseph', 'eyes'), "👀 is on @jeff's message. That's your acknowledgement: end your turn now, with a word at most.\n")
  tool('joseph')
  end('joseph', 'Reacted with 👀.')
  assert.deepEqual(marks(handoff), ['joseph👀'])
  assert.equal(handoff.reactions[0].said, undefined, 'words that only name the reaction are not kept')
  assert.equal(hub.feed.length, before.feed, 'no reply row')
  assert.equal(runner.typed.length, before.typed, 'jeff got nothing')
  assert.equal(hub.agents.get('jeff').inbox.length, 0)
  assert.equal(hub.agents.get('jeff').status, 'idle')
  assert.ok(inThread(handoff), 'the hand-off, and its reaction with it, is in the thread')
})

test('a turn that did something, or has something to say, still says it', () => {
  // work after reacting: the final message is a report
  hub.send({ to: 'jeff', text: 'bump the version' })
  begin('jeff')
  react('jeff', '👍')
  tool('jeff')
  tool('jeff') // ...and then it did the work
  end('jeff', 'Bumped to 1.2.')
  assert.equal(hub.feed.at(-1).text, 'Bumped to 1.2.')
  // a question
  hub.send({ to: 'joseph', text: 'the deploy is at 5' })
  begin('joseph')
  react('joseph', '👍')
  tool('joseph')
  end('joseph', 'Which environment?')
  assert.equal(hub.feed.at(-1).text, 'Which environment?')
  // bad news
  hub.send({ to: 'david', text: 'the deploy is at 5' })
  begin('david')
  react('david', '👍')
  tool('david')
  end('david', "I can't make 5.")
  assert.equal(hub.feed.at(-1).text, "I can't make 5.")
  // and a reaction from an earlier turn doesn't quiet the next one
  hub.send({ to: 'joseph', text: 'and tomorrow at 6' })
  begin('joseph')
  end('joseph', 'Noted.')
  assert.equal(hub.feed.at(-1).text, 'Noted.')
})

test('several hand-offs read in one turn: one command acknowledges each', () => {
  const j = hub.agents.get('joseph')
  j.status = 'working' // busy, so they pile up
  hub.send({ from: 'jeff', to: 'joseph', text: 'fyi one' })
  hub.send({ from: 'david', to: 'joseph', text: 'fyi two' })
  j.status = 'idle'
  hub.pump(j)
  begin('joseph')
  assert.equal(react('joseph', '✅'), "✅ is on @jeff's message and @david's message. That's your acknowledgement: end your turn now, with a word at most.\n")
  assert.deepEqual(hub.feed.filter((e) => e.kind === 'msg').map(marks), [['joseph✅'], ['joseph✅']])
})

test('refused, with nothing shown: a second reaction, not an emoji, no turn, a message that is gone', () => {
  hub.send({ to: 'jeff', text: 'the freeze is Thursday' })
  const msg = hub.feed.at(-1)
  assert.throws(() => react('jeff', '👍'), /not shown: there's no message to react to/) // not picked up yet: no turn
  begin('jeff')
  assert.throws(() => react('jeff', 'lgtm'), /^Error: "lgtm" isn't one emoji, so nothing was shown\. usage: clique react <emoji>/)
  assert.throws(() => react('jeff', '👍👍'), /isn't one emoji/)
  assert.equal(msg.reactions, undefined)
  react('jeff', '👍')
  assert.throws(() => react('jeff', '🎉'), /not shown: you've already reacted to it, and it's one reaction each/)
  assert.deepEqual(marks(msg), ['jeff👍'])
  end('jeff', 'ok')
  assert.throws(() => react('jeff', '🎉'), /not shown: there's no message to react to/) // the turn is over
  // gone from the chat by the time it reacts
  hub.send({ to: 'joseph', text: 'old news' })
  const old = hub.feed.at(-1)
  begin('joseph')
  hub.unsay(old)
  assert.throws(() => react('joseph', '👍'), /not shown: there's no message to react to/)
  // from a terminal of your own: there's no message it could mean
  assert.throws(() => react('you', '👍'), /clique react is an agent's/)
})

test('a question needs an answer: a reaction is refused while the asker waits', async () => {
  const asking = hub.question({ from: 'jeff', to: 'joseph', text: 'which port?', hold: 50 })
  begin('joseph')
  assert.throws(() => react('joseph', '👍'), /not shown: @jeff asked you something and is waiting on the answer, and a reaction isn't one/)
  end('joseph', 'Port 3000.')
  await asking
  assert.equal(hub.feed.findLast((e) => e.kind === 'reply').text, 'Port 3000.')
})

test('a rate limit: a few reactions in ten minutes, clones included, then none until it has passed', () => {
  const real = Date.now
  let now = real()
  Date.now = () => now
  try {
    for (let i = 0; i < REACT_MAX; i++) {
      hub.send({ to: 'jeff', text: `fyi ${i}` })
      begin('jeff')
      react('jeff', '👍')
      end('jeff', '')
      now += 1000
    }
    hub.send({ to: 'jeff', text: 'one more' })
    const more = hub.feed.at(-1)
    begin('jeff')
    assert.throws(() => react('jeff', '👍'), new RegExp(`not shown: that's ${REACT_MAX} reactions from you in the last 10 minutes`))
    assert.equal(more.reactions, undefined)
    end('jeff', 'ok')
    now += REACT_WINDOW
    hub.send({ to: 'jeff', text: 'later' })
    begin('jeff')
    assert.match(react('jeff', '👍'), /^👍 is on/)
  } finally {
    Date.now = real
  }
})

test('your own reactions: on and off, several, on anything said; they change nothing for the agent', () => {
  hub.send({ to: 'jeff', text: 'bump it' })
  begin('jeff')
  end('jeff', 'Bumped to 1.2.')
  const reply = hub.feed.at(-1)
  const typed = runner.typed.length
  assert.equal(hub.reactTo(reply.id, '🎉'), 'reacted\n')
  hub.reactTo(reply.id, '👍')
  assert.deepEqual(marks(reply), ['you🎉', 'you👍'])
  assert.equal(hub.reactTo(reply.id, '🎉'), 'taken off\n')
  assert.deepEqual(marks(reply), ['you👍'])
  assert.equal(runner.typed.length, typed, 'the agent is told nothing')
  assert.equal(hub.agents.get('jeff').inbox.length, 0)
  assert.throws(() => hub.reactTo('nope', '👍'), /isn't in the chat any more/)
  assert.throws(() => hub.reactTo(reply.id, 'thumbs'), /isn't one emoji/)
  const line = hub.post({ kind: 'event', from: 'jeff', text: 'exited' })
  assert.throws(() => hub.reactTo(line.id, '👍'), /isn't in the chat any more/)
})

test('reactions are kept with the chat: back after a restart, and a renamed agent keeps its own', async () => {
  hub.send({ to: 'jeff', text: 'the freeze is Thursday' })
  const msg = hub.feed.at(-1)
  begin('jeff')
  react('jeff', '👍')
  tool('jeff')
  end('jeff', 'Noted, Thursday.')
  hub.reactTo(msg.id, '🙏')
  hub.reactTo(msg.id, '👀')
  hub.reactTo(msg.id, '👀') // off again
  await done()
  const lines = fs.readFileSync(path.join(process.env.CLIQUE_HOME, 'feed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(lines.filter((l) => l.amend === msg.id && l.reactions).length, 5, 'each change is one amendment of the message')
  const again = new Hub(new FakeRunner(), { bin: '/nonexistent' })
  const back = again.feed.find((e) => e.id === msg.id)
  assert.deepEqual(back.reactions.map(({ by, emoji, said }) => [by, emoji, said]), [['jeff', '👍', 'Noted, Thursday.'], ['you', '🙏', undefined]])
  assert.equal(again.feed.some((e) => e.kind === 'reply'), false)
  again.renameRefs('jeff', 'geoff')
  assert.deepEqual(marks(back), ['geoff👍', 'you🙏'])
  for (const t of ['statsTimer', 'readsTimer', 'convoTimer', 'runtimeTimer']) clearTimeout(again[t])
  clearInterval(again.stallTimer)
  await again.saving
})

test('the agents are told, in one line, and the command is in their list', async () => {
  const { adapters } = await import('../core/adapters.js')
  const launch = adapters.claude({ name: 'jeff', area: 'lead' }, { attachments: os.tmpdir(), bin: BIN })
  const prompt = launch.args[launch.args.indexOf('--append-system-prompt') + 1]
  assert.match(prompt, /^  clique react <emoji> +put one emoji on the message you're answering/m)
  assert.match(prompt, /- When all you'd say is an acknowledgement \("got it", "noted", "thanks", "nothing to add"\), to the user or a teammate:\n  run clique react 👍 and end your turn with nothing more\. Not for a question: that needs an answer\./)
})

test('clique react, as agents run it in a shell: the emoji arrives as typed, and what is turned down is printed', async () => {
  const clique = { hubs: new Map([['default', hub]]) }
  const server = await serve({ token: 'tok', hubFor: (id) => clique.hubs.get(id) })
  const home = fs.mkdtempSync(path.join(process.env.CLIQUE_HOME, 'cli-'))
  fs.writeFileSync(path.join(home, 'url'), `http://127.0.0.1:${server.address().port}`)
  fs.writeFileSync(path.join(home, 'token'), 'tok')
  const run = (file, args, agent) => new Promise((resolve) => execFile(file, args, { env: { ...process.env, CLIQUE_HOME: home, CLIQUE_AGENT: agent, CLIQUE_WORKSPACE: 'default' } }, (e, stdout, stderr) => resolve({ code: e?.code ?? 0, stdout, stderr })))
  const clis = [['clique.mjs', (agent, ...a) => run(process.execPath, [path.join(BIN, 'clique.mjs'), 'clique', ...a], agent)], ...(WIN ? [] : [['bin/clique', (agent, ...a) => run(path.join(BIN, 'clique'), a, agent)]])]
  try {
    for (const [what, cli] of clis) {
      hub.send({ to: 'david', text: `fyi from ${what}` })
      const msg = hub.feed.at(-1)
      begin('david')
      const bad = await cli('david', 'react', 'thanks a lot')
      assert.match(bad.stdout + bad.stderr, /"thanks a lot" isn't one emoji, so nothing was shown/, what)
      const two = await cli('david', 'react', '👍', 'and words')
      assert.match(two.stdout + two.stderr, /clique react takes one emoji and nothing else/, what)
      assert.equal((await cli('david', 'react', '🙏')).stdout, "🙏 is on the user's message. That's your acknowledgement: end your turn now, with a word at most.\n", what)
      assert.deepEqual(marks(msg), ['david🙏'], what)
      const twice = await cli('david', 'react') // no emoji is 👍, but it has reacted already
      assert.match(twice.stdout + twice.stderr, /not shown: you've already reacted to it/, what)
      end('david', '')
      assert.match((await cli('david', 'help')).stdout, /^clique react <emoji> +put one emoji on the message you're answering/m, what)
    }
  } finally {
    server.close()
  }
})

test('through the app, as you click it: on this computer the message changes, and every window hears', async () => {
  await done()
  fresh()
  const clique = new Clique({ bin: '/nonexistent', computerName: 'Studio' })
  Object.assign(clique.runner, { running: () => true, quietFor: () => Infinity, submit() {}, write() {} })
  const h = clique.hubs.get('default')
  try {
    const msg = h.post({ kind: 'reply', from: 'jeff', text: 'All 48 tests pass.' })
    let heard = 0
    h.on('change', () => heard++)
    await clique.feedAction(msg.id, 'reactTo', ['🎉'])
    assert.deepEqual(marks(clique.snapshot().feed.find((e) => e.id === msg.id)), ['you🎉'])
    assert.ok(heard > 0)
    // a linked computer's message: its agents' reactions come with their computer's name, yours as yours, and a click
    // here asks that computer (which serves it as its own app would)
    const asked = []
    clique.links.set('laptop', { slug: 'laptop', name: 'Laptop', peer: { push() {}, call: async (...a) => (asked.push(JSON.stringify(a)), 'reacted\n') }, toHost: new Map(), fetching: new Set(),
      spaces: { [h.ws]: { agents: [{ name: 'bo', status: 'idle' }], feed: [{ id: 'm1', kind: 'reply', from: 'bo', text: 'Deployed.', ts: 5, reactions: [{ by: 'bo', emoji: '🚀', at: 5 }, { by: 'you', emoji: '👍', at: 6 }, { by: 'jeff@studio', emoji: '👀', at: 7 }] }], tasks: { tickets: [] }, providers: {} } } })
    const theirs = clique.snapshot().feed.find((e) => e.id === 'm1@laptop')
    assert.deepEqual(marks(theirs), ['bo@laptop🚀', 'you👍', 'jeff👀'])
    await clique.feedAction('m1@laptop', 'reactTo', ['🎉'])
    assert.match(asked.at(-1), /"reactTo".*"m1","🎉"/)
    assert.equal(clique.serve('reactTo', [msg.id, '👍'], h), 'reacted\n')
    assert.deepEqual(marks(msg), ['you🎉', 'you👍'])
    clique.links.delete('laptop')
  } finally {
    for (const a of h.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer)
    for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(h[t])
    clearInterval(h.stallTimer)
    clearTimeout(clique.changeTimer)
    clique.config.close?.()
    await h.saving
  }
})

test('in the chat: a pill per emoji with the faces and a count, one message for a send to several, and nothing an agent wrote runs as HTML', () => {
  hub.send({ to: 'jeff,joseph', text: 'the freeze is Thursday' })
  for (const [name, emoji, word] of [['jeff', '👍', ''], ['joseph', '👍', 'Noted <b>"Thursday"</b>']]) {
    begin(name)
    react(name, emoji)
    tool(name)
    end(name, word)
  }
  hub.reactTo(hub.feed.find((e) => e.to === 'jeff').id, '🎉')
  const feed = JSON.parse(JSON.stringify(hub.snapshot().feed))
  const view = ui.__x.feedView(feed, hub.snapshot().agents, new Set(), 200)
  assert.equal(view.items.length, 1, 'the two copies are one message, and neither agent replied')
  const html = view.html()
  const pills = html.match(/<button type="button" class="react[^>]*>.*?<\/button>/gs)
  assert.equal(pills.length, 2)
  assert.match(pills[0], /data-react="👍"[^>]*aria-pressed="false" title="jeff and joseph reacted 👍\njoseph: “Noted &#60;b&#62;&#34;Thursday&#34;&#60;\/b&#62;”">/)
  assert.match(pills[0], /data-face="jeff".*data-face="joseph".*<b>2<\/b>/s)
  assert.match(pills[1], /class="react mine" data-react="🎉"[^>]*aria-pressed="true" title="You reacted 🎉\nClick to take yours off">/)
  assert.doesNotMatch(pills[1], /data-face|<b>/)
  // the redraw key's part changes with every reaction, and with the words that arrive after it
  const sig = ui.__x.reactsSig
  assert.notEqual(sig({ reactions: [{ by: 'a', emoji: '👍' }] }), sig({ reactions: [{ by: 'a', emoji: '👍', said: 'ok' }] }))
  assert.notEqual(sig({ reactions: [{ by: 'a', emoji: '👍' }] }), sig({ reactions: [] }))
  assert.equal(sig({}), '')
  // the app's own grouping and handy ones are the protocol's
  assert.deepEqual([...ui.__x.REACT_HANDY], HANDY_REACTIONS.slice(0, 5))
  const odd = [{ by: 'a', emoji: '👍' }, { by: 'b', emoji: '👀', said: 'x' }, { by: 'a', emoji: '👍' }, { by: 'c', emoji: '👍' }, null, { by: 'd' }, { emoji: '🎉' }, 'x']
  assert.deepEqual(JSON.parse(JSON.stringify(ui.__x.reactionGroups(odd))), reactionGroups(odd))
})

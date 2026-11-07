// Agent tools: `crew app …`, an agent changing CLIque itself. Off, ask first (a card in the chat, the agent's command
// waiting on your answer) or automatic (what can't be undone still asks). Run with `npm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CREW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-tools-'))
const { CONFIG } = await import('../core/hub.js')
const { Crew } = await import('../core/crew.js')
const { serve } = await import('../core/server.js')
const { parse, help, TOOLS } = await import('../core/tools.js')
const { makeCode } = await import('../core/link.js')

const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-tools-folder-'))
fs.writeFileSync(CONFIG, JSON.stringify({
  autopilot: true,
  agents: [{ name: 'iris', area: 'ui/ux designer' }, { name: 'june', area: 'Senior Backend SWE', provider: 'codex' }, { name: 'milo', area: 'ios app' }],
  workspaces: [{ id: 'storefront', name: 'Storefront', folder: FOLDER, members: { iris: {} }, agents: [{ name: 'kit', area: 'checkout' }] }],
}))

const crew = new Crew({ bin: '/nonexistent', computerName: 'Studio' })
Object.assign(crew.runner, { running: () => true, quietFor: () => Infinity, submit() {}, write() {} })
const quiet = () => {
  for (const hub of crew.hubs.values()) {
    for (const a of hub.agents.values()) clearTimeout(a.ack), clearTimeout(a.timer), clearTimeout(a.steerTimer)
    for (const t of ['statsTimer', 'convoTimer', 'readsTimer', 'runtimeTimer', 'usageTimer', 'ticketsTimer', 'lookTimer']) clearTimeout(hub[t])
  }
  clearTimeout(crew.changeTimer)
}
after(() => {
  quiet()
  fs.rmSync(process.env.CREW_HOME, { recursive: true, force: true, maxRetries: 10 })
  fs.rmSync(FOLDER, { recursive: true, force: true })
})

const home = () => crew.hubs.get('default')
const shop = () => crew.hubs.get('storefront')
const data = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
const homeOf = () => data().workspaces.find((w) => w.id === 'default')
// `crew app <words>` from an agent, as the /app route hands it over
const app = (from, line, { hub = home(), hold } = {}) => crew.tool(hub, from, line, undefined, { hold })
const asks = (hub = home()) => hub.feed.filter((e) => e.kind === 'ask' && !e.answer)
const lastAsk = (hub = home()) => asks(hub).at(-1)
const settled = () => new Promise((r) => setImmediate(r))
const mode = (m) => crew.setTools(m)
const fresh = (hub = home()) => {
  for (const a of hub.agents.values()) Object.assign(a, { status: 'idle', inbox: [], current: undefined })
}

test('crew app help: every tool, with how changes go right now; words read the way an agent types them', () => {
  for (const m of ['off', 'ask', 'auto']) assert.match(help(m), /crew app channel add <name>/)
  assert.match(help('ask'), /waits for the user to allow it/)
  assert.match(help('auto'), /go through right away\. Removing something, linking a computer, and starting or changing a YOLO agent still wait/)
  assert.match(help('off'), /turned them off/)
  for (const key of Object.keys(TOOLS)) assert.ok(help('ask').includes(`crew app ${key}`), key)

  assert.deepEqual(parse(['']), { help: true })
  assert.deepEqual(parse(['help']), { help: true })
  const c = parse(['channel', 'add', 'Design', 'Review', '--brief', 'look, don\'t touch', '--members=iris,june'])
  assert.deepEqual([c.key, c.name, c.flags], ['channel add', 'Design Review', { brief: "look, don't touch", members: 'iris,june' }])
  assert.deepEqual(parse(['agent', 'add', 'bob', '--crew', '--area', 'qa']).flags, { crew: true, area: 'qa' })
  assert.throws(() => parse(['channel', 'paint']), /there's no crew app channel paint \(crew app help lists them\)/)
  assert.throws(() => parse(['channel', 'add', 'x', '--colour', 'red']), /crew app channel add takes no --colour\. Use: crew app channel add <name>/)
  assert.throws(() => parse(['channel', 'add', 'x', '--brief']), /--brief needs a value/)
  assert.throws(() => parse(['channel', 'add']), /which name\? Use: crew app channel add/)
  assert.throws(() => parse(['workspaces', 'all']), /crew app workspaces takes no words/)
})

test("off: agents can't change anything (help still says so); ask first is the default and isn't written down", async () => {
  assert.equal(crew.snapshot().tools, 'ask')
  assert.equal('tools' in data(), false)
  mode('off')
  assert.equal(data().tools, 'off')
  assert.equal(crew.snapshot().tools, 'off')
  await assert.rejects(app('iris', ['channel', 'add', 'design']), /Agent tools are off: the user turned them off/)
  await assert.rejects(app('iris', ['workspaces']), /Agent tools are off/)
  assert.match(await app('iris', ['help']), /turned them off/)
  assert.throws(() => crew.setTools('yes'), /agent tools are off, ask, auto, not yes/)
  mode('ask')
  assert.equal('tools' in data(), false)
  assert.equal(asks().length, 0)
})

test('looking never asks: agents, brains, channels, workspaces, computers', async () => {
  const agents = await app('iris', ['agents'])
  assert.match(agents, /^iris +ui\/ux designer +Claude +works in Home, Storefront$/m)
  assert.match(agents, /^june +Senior Backend SWE +Codex +works in Home$/m)
  assert.match(agents, /^kit +checkout +Claude +Storefront only$/m)
  assert.match(await app('iris', ['brains']), /^claude +Claude +models fable, opus, sonnet, haiku · effort low, medium, high, xhigh, max$/m)
  assert.doesNotMatch(await app('iris', ['brains']), /GLM/, 'only the brains the picker offers')
  assert.match(await app('iris', ['channels']), /^#general +everyone +\(no brief\)$/m)
  const spaces = await app('iris', ['workspaces'], { hub: shop() })
  assert.match(spaces, /^Home +id default · @iris @june @milo$/m)
  assert.match(spaces, new RegExp(`^Storefront +id storefront · ${FOLDER} · @iris · you're here$`, 'm'))
  assert.match(await app('iris', ['computers']), /^Studio +this computer$/m)
  assert.doesNotMatch(await app('iris', ['computers']), /crew1\./, "never this computer's link code")
  assert.equal(asks().length + asks(shop()).length, 0)
})

test('ask first: a card where the agent is working; allowed, the change is made and its command prints what came of it', async () => {
  fresh()
  const iris = home().agents.get('iris')
  const out = app('iris', ['channel', 'add', 'Design', '--brief', 'Pixels only: no backend changes.', '--members', '@iris, june'])
  await settled()
  const e = lastAsk()
  assert.equal(e.from, 'iris')
  assert.equal(e.cli, 'crew')
  assert.deepEqual(e.ask, { type: 'permission', tool: 'crew app', app: true, title: 'Add a channel', code: '#design\nPixels only: no backend changes.', detail: 'For @iris, @june', say: 'Can I add a #design channel?', always: [], alert: 'wants to add a channel' })
  assert.equal(iris.status, 'waiting')
  assert.equal(homeOf().channels, undefined, 'nothing changes until you say yes')
  await home().answer(e.id, { allow: true })
  assert.equal(await out, 'The user allowed it: added #design.\n')
  assert.deepEqual(homeOf().channels, [{ id: 'design', name: 'design', brief: 'Pixels only: no backend changes.', members: ['iris', 'june'] }])
  assert.deepEqual({ ...e.answer, at: 0 }, { by: 'you', allow: true, at: 0 })
  assert.equal(iris.status, 'working')
  await assert.rejects(Promise.resolve().then(() => home().answer(e.id, { allow: true })), /already been answered/)
})

test("said no: nothing changes, and the agent hears why; the first answer wins (the app's or a phone's)", async () => {
  fresh()
  const out = app('iris', ['channel', 'add', 'random'])
  await settled()
  const e = lastAsk()
  const first = home().answer(e.id, { allow: false, note: 'use #general for that' })
  assert.throws(() => home().answer(e.id, { allow: true }), /already been answered/)
  await first
  assert.equal(await out, 'The user said no: use #general for that\n')
  assert.equal(homeOf().channels.some((c) => c.id === 'random'), false)
  assert.deepEqual({ ...e.answer, at: 0 }, { by: 'you', allow: false, note: 'use #general for that', at: 0 })
})

test("checked before you're asked: a wrong name, brain, folder or member fails at once, with no card", async () => {
  const no = (line, re, opts) => assert.rejects(app('iris', line, opts), re)
  await no(['channel', 'add', 'design'], /there's a #design already/)
  await no(['channel', 'add', '!!'], /give the channel a name/)
  await no(['channel', 'add', 'x', '--members', 'nobody'], /there's no agent called nobody in Home \(crew who lists them\)/)
  await no(['channel', 'remove', 'general'], /#general can't be removed/)
  await no(['channel', 'edit', 'nope', '--brief', 'x'], /there's no #nope in Home/)
  await no(['agent', 'add', 'June'], /"june" already exists/)
  await no(['agent', 'add', 'bob', '--brain', 'gpt'], /there's no brain called gpt: it's one of claude, codex/)
  await no(['agent', 'add', 'bob', '--brain', 'glm'], /there's no brain called glm/, 'GLM until it is added in the app')
  await no(['agent', 'add', 'bob', '--effort', 'turbo'], /Claude's effort is one of low, medium, high, xhigh, max/)
  await no(['agent', 'add', 'bob', '--folder', 'src/app'], /give the folder's whole path \(~\/… or \/…\), not src\/app/)
  await no(['agent', 'add', 'bob', '--folder', path.join(FOLDER, 'nope')], /there's no folder at/)
  await no(['agent', 'edit', 'iris'], /nothing to change/)
  await no(['agent', 'edit', 'iris', '--area', 'ui/ux designer'], /nothing to change/)
  await no(['agent', 'on', 'iris'], /@iris is on already/)
  await no(['agent', 'edit', 'iris.2', '--area', 'x'], /there's no agent called iris\.2/)
  await no(['agent', 'edit', 'iris@laptop', '--area', 'x'], /@iris@laptop is on another computer/)
  await no(['workspace', 'add', 'storefront'], /there's a workspace called storefront already/)
  await no(['workspace', 'add', 'Lab', '--members', 'kit'], /@kit isn't one of your agents/, "a workspace's own agent works only there")
  await no(['workspace', 'members', 'Home', '--add', 'june'], /that's how Home is already/)
  await no(['workspace', 'members', 'Storefront', '--add', 'iris'], /nothing to change: that's how Storefront is already/)
  await no(['workspace', 'wake', 'Storefront'], /Storefront is awake already/)
  await no(['channel', 'add', 'x', '--in', 'Attic'], /there's no workspace called Attic \(crew app workspaces lists them\)/)
  await no(['link', 'hello'], /that's not a CLIque pairing code/)
  await no(['unlink', 'laptop'], /this computer isn't linked with laptop/)
  assert.equal(asks().length, 0)
})

test("its command stops waiting: the card stays up (even past its turn), and what you decide comes to it as a message", async () => {
  fresh()
  const iris = home().agents.get('iris')
  const out = await app('iris', ['channel', 'edit', 'design', '--brief', 'Pixels and copy'], { hold: 20 })
  assert.match(out, /^The user hasn't answered yet: the card waits for them in CLIque\. Don't ask again\./)
  assert.notEqual(iris.status, 'waiting', 'it carries on')
  const e = lastAsk()
  assert.deepEqual([e.ask.title, e.ask.code], ['Change #design', 'brief: Pixels and copy'])
  home().closeAsks(iris) // its turn ended meanwhile
  assert.equal(lastAsk()?.id, e.id, 'still up')
  await home().answer(e.id, { allow: true })
  assert.equal(homeOf().channels.find((c) => c.id === 'design').brief, 'Pixels and copy')
  const told = iris.inbox.find((m) => m.crew)
  assert.equal(told.text, '[crew] You asked to change #design (crew app). The user allowed it: changed #design.')
  assert.equal(told.id, e.id, 'its reply goes where the card was')
})

test("an agent that restarts lets go of its command, and its card stays up; one gone for good takes its card with it; one closed early lets go too", async () => {
  fresh()
  const iris = home().agents.get('iris')
  const out = app('iris', ['channel', 'add', 'later'])
  await settled()
  home().forgetAsks('iris') // it exited, or relaunched with a new model
  assert.equal(await out, '')
  const card = lastAsk()
  assert.equal(card?.ask.title, 'Add a channel', 'still up for you')
  await home().answer(card.id, { allow: false })
  assert.equal(iris.inbox.at(-1).text, "[crew] You asked to add a channel (crew app). The user said no.")
  iris.inbox = []
  const out1 = app('iris', ['channel', 'add', 'later'])
  await settled()
  home().forgetAsks('iris', { gone: true })
  assert.equal(await out1, '')
  assert.equal(asks().length, 0)
  const closed = new AbortController()
  const out2 = crew.tool(home(), 'iris', ['channel', 'add', 'later'], closed.signal)
  await settled()
  closed.abort()
  assert.equal(await out2, '')
  assert.equal(asks().length, 1, 'the card stays for you to answer')
  await home().answer(lastAsk().id, { allow: false })
})

test('automatic: a change goes through and says so where the agent works; removing, linking and YOLO still ask', async () => {
  fresh()
  mode('auto')
  assert.equal(await app('iris', ['channel', 'add', 'qa', '--brief', 'Test plans']), 'added #qa\n')
  assert.equal(homeOf().channels.at(-1).id, 'qa')
  const said = home().feed.at(-1)
  assert.deepEqual([said.kind, said.from, said.text, said.app], ['event', 'iris', 'added the #qa channel', true])
  assert.equal(asks().length, 0)

  const removing = app('iris', ['channel', 'remove', 'qa'])
  await settled()
  assert.deepEqual([lastAsk().ask.title, lastAsk().ask.detail], ['Remove #qa', 'Its messages stay in the chat, under #general.'])
  await home().answer(lastAsk().id, { allow: true })
  assert.equal(await removing, 'The user allowed it: removed #qa.\n')

  const yolo = app('iris', ['agent', 'add', 'rex', '--area', 'scripts', '--yolo'])
  await settled()
  assert.match(lastAsk().ask.code, /YOLO: runs every command without asking/)
  await home().answer(lastAsk().id, { allow: false })
  assert.equal(await yolo, 'The user said no.\n')
  assert.equal(data().agents.some((a) => a.name === 'rex'), false)
  mode('ask')
})

test('only an agent can ask: your own terminal gets what runs without asking, and nothing that would ask', async () => {
  await assert.rejects(app('you', ['channel', 'add', 'mine']), /that needs the user's OK, and only one of their agents can ask for it here: agent tools ask first/)
  mode('auto')
  assert.equal(await app('you', ['channel', 'add', 'mine']), 'added #mine\n')
  await assert.rejects(app('you', ['channel', 'remove', 'mine']), /it always asks\. Do it in CLIque instead/)
  assert.match(await app('you', ['channels']), /#mine/)
  mode('ask')
})

test("agents: one added where the agent works is that workspace's own (--crew: one of yours everywhere); edit, on and off, remove", async () => {
  fresh(shop())
  mode('auto')
  assert.equal(await app('iris', ['agent', 'add', 'Bob', '--area', 'QA for checkout', '--model', 'sonnet', '--folder', FOLDER, '--off'], { hub: shop() }), 'added @bob, off (crew app agent on bob turns it on)\n')
  const sf = () => data().workspaces.find((w) => w.id === 'storefront')
  assert.deepEqual(sf().agents.find((a) => a.name === 'bob'), { name: 'bob', area: 'QA for checkout', provider: 'claude', model: 'sonnet', cwd: FOLDER, off: true })
  assert.equal(data().agents.some((a) => a.name === 'bob'), false)
  assert.equal(await app('iris', ['agent', 'add', 'cleo', '--area', 'docs', '--brain', 'Codex', '--effort', 'low', '--crew'], { hub: shop() }), 'added @cleo, ready for work\n')
  assert.deepEqual(data().agents.find((a) => a.name === 'cleo'), { name: 'cleo', area: 'docs', provider: 'codex', effort: 'low' }, 'who it is; whether it\'s on is each workspace\'s')
  assert.deepEqual(sf().members.cleo, {})
  // from Home, into Storefront
  assert.equal(await app('june', ['agent', 'add', 'dot', '--in', 'storefront']), 'added @dot in Storefront, ready for work\n')
  assert.ok(sf().agents.some((a) => a.name === 'dot'))

  assert.equal(await app('iris', ['agent', 'on', 'bob'], { hub: shop() }), '@bob is on\n')
  assert.equal(sf().agents.find((a) => a.name === 'bob').off, undefined)
  assert.equal(await app('iris', ['agent', 'off', 'bob'], { hub: shop() }), '@bob is off\n')
  assert.equal(await app('iris', ['agent', 'edit', 'bob', '--area', 'QA', '--model', 'opus', '--name', 'bobby'], { hub: shop() }), 'changed @bobby: name, job, model\n')
  assert.deepEqual(sf().agents.find((a) => a.name === 'bobby'), { name: 'bobby', area: 'QA', provider: 'claude', model: 'opus', cwd: FOLDER, off: true })
  mode('ask')

  const edit = app('iris', ['agent', 'edit', 'bobby', '--brain', 'codex', '--prompt', 'Write the test plan first.'], { hub: shop() })
  await settled()
  assert.deepEqual([lastAsk(shop()).ask.title, lastAsk(shop()).ask.code], ['Change @bobby', 'brain: Claude → Codex\nmodel: opus → (none)\ninstructions: (none) → Write the test plan first.'])
  assert.equal(lastAsk(shop()).ask.detail, "@bobby restarts with it once it's free, in a new conversation.", 'a conversation is kept by its CLI')
  await shop().answer(lastAsk(shop()).id, { allow: true })
  await edit

  mode('auto')
  const leave = app('iris', ['agent', 'remove', 'cleo'], { hub: shop() })
  await settled()
  assert.deepEqual([lastAsk(shop()).ask.title, lastAsk(shop()).ask.detail], ['Remove @cleo', 'It leaves Storefront, and stays one of your agents everywhere else.'])
  await shop().answer(lastAsk(shop()).id, { allow: true })
  assert.equal(await leave, 'The user allowed it: @cleo is out of Storefront.\n')
  assert.equal(sf().members.cleo, undefined)
  assert.ok(data().agents.some((a) => a.name === 'cleo'))
  mode('ask')
})

test("workspaces: one an agent makes opens without taking over your screen; who works there, sleep and wake", async () => {
  mode('auto')
  const current = data().current
  assert.equal(await app('iris', ['workspace', 'add', 'Lab', '--members', 'june, milo', '--icon', '🧪', '--folder', FOLDER]), 'made the workspace Lab (id lab): @june, @milo work there\n')
  const lab = () => data().workspaces.find((w) => w.id === 'lab')
  assert.deepEqual(lab(), { id: 'lab', name: 'Lab', members: { june: {}, milo: {} }, icon: '🧪', folder: FOLDER })
  assert.equal(data().current, current, 'the screen stays where it was')
  assert.ok(crew.hubs.has('lab'))
  assert.equal(await app('iris', ['workspace', 'members', 'lab', '--add', 'iris', '--remove', 'milo']), 'Lab: in: @iris, out: @milo\n')
  assert.deepEqual(Object.keys(lab().members), ['june', 'iris'])
  assert.equal(await app('iris', ['workspace', 'edit', 'Lab', '--name', 'Lab 2']), 'changed Lab 2\n')
  assert.equal(await app('iris', ['workspace', 'sleep', 'Lab 2']), 'Lab 2 is asleep\n')
  assert.equal(lab().parked, true)
  assert.equal(await app('iris', ['workspace', 'wake', 'lab']), 'Lab 2 is awake\n')
  assert.equal(lab().parked, undefined)
  const gone = app('iris', ['workspace', 'remove', 'lab'])
  await settled()
  assert.match(lastAsk().ask.detail, /^Its agents stop\. Its chat, notes and tasks stay on disk/)
  await home().answer(lastAsk().id, { allow: true })
  assert.equal(await gone, 'The user allowed it: removed Lab 2.\n')
  assert.equal(lab(), undefined)
  mode('ask')
})

test('linking: a code always asks, and says whose computer it is; allowed, it links', async () => {
  mode('auto')
  const code = makeCode({ name: 'Mac mini', port: 7787, key: 'k', fingerprint: 'f', hosts: ['192.168.0.9'] })
  const linked = []
  crew.connect = async (c) => (linked.push(c), 'mac-mini')
  const out = app('iris', ['link', code])
  await settled()
  const e = lastAsk()
  assert.deepEqual([e.ask.title, e.ask.code, e.ask.say], ['Link with Mac mini', 'Mac mini', 'Can I link this computer with Mac mini?'])
  assert.deepEqual(linked, [])
  await home().answer(e.id, { allow: true })
  assert.equal(await out, 'The user allowed it: linked with Mac mini.\n')
  assert.deepEqual(linked, [code])
  // a link that doesn't come through: allowed, and the agent hears why
  crew.connect = async () => {
    throw new Error("couldn't reach Mac mini yet, it keeps trying")
  }
  const again = app('iris', ['link', code])
  await settled()
  const e2 = lastAsk()
  await home().answer(e2.id, { allow: true })
  assert.equal(await again, "The user allowed it, but it didn't work: couldn't reach Mac mini yet, it keeps trying\n")
  assert.equal(e2.answer.failed, "couldn't reach Mac mini yet, it keeps trying")
  delete crew.connect
  mode('ask')
})

test("over CLIque's own server: the /app route, in the agent's workspace (the X-Crew-Workspace header)", async () => {
  mode('auto')
  const server = await serve({ token: crew.token, hubFor: (id) => crew.hubs.get(id) })
  const url = `http://127.0.0.1:${server.address().port}`
  const call = (words, ws = '') => fetch(`${url}/app?from=iris`, { method: 'POST', headers: { 'X-Crew': crew.token, 'X-Crew-Workspace': ws }, body: words.map((w) => `${w}\0`).join('') }).then(async (r) => [r.status, await r.text()])
  assert.deepEqual(await call(['channel', 'add', 'ship it']), [200, 'added #ship-it\n'])
  assert.deepEqual(await call(['channel', 'add', 'ship it']), [400, "there's a #ship-it already\n"])
  assert.deepEqual(await call(['channel', 'add', 'pixels'], 'storefront'), [200, 'added #pixels\n'])
  assert.ok(data().workspaces.find((w) => w.id === 'storefront').channels.some((c) => c.id === 'pixels'))
  const [status, text] = await call([''])
  assert.equal(status, 200)
  assert.match(text, /^crew app: change CLIque itself/)
  server.close()
  mode('ask')
})

test("a broken config.json: looking still works, changing doesn't (it would save over the file)", async () => {
  crew.config.broken = true
  crew.config.data.tools = 'auto'
  await assert.rejects(app('iris', ['channel', 'add', 'nope']), /can't read its settings \(config\.json\) right now/)
  assert.match(await app('iris', ['channels']), /#general/)
  crew.config.broken = false
  delete crew.config.data.tools
})

test('a look that can\'t be set changes nothing, not even in memory (a later save would write it)', async () => {
  mode('auto')
  const before = JSON.stringify(crew.config.data.workspaces)
  await assert.rejects(app('iris', ['workspace', 'add', 'Lab', '--color', 'light blue']), /"light blue" isn't a color/)
  await assert.rejects(app('iris', ['workspace', 'edit', 'Storefront', '--name', 'Shop', '--color', 'sky-blue']), /"sky-blue" isn't a color/)
  assert.equal(JSON.stringify(crew.config.data.workspaces), before)
  assert.throws(() => crew.workspaceAction('edit', 'storefront', { name: 'Shop', color: 'no such' }), /isn't a color/)
  assert.equal(JSON.stringify(crew.config.data.workspaces), before, "the app's own edit too")
  assert.equal(asks().length, 0)
  mode('ask')
})

test('automatic: anything that starts a YOLO agent, points it somewhere new or tells it what to do still asks', async () => {
  const cfg = data()
  cfg.agents.push({ name: 'rex', area: 'scripts', yolo: true })
  cfg.workspaces.find((w) => w.id === 'default').members.rex = { off: true }
  fs.writeFileSync(CONFIG, JSON.stringify(cfg))
  crew.config.load()
  fresh()
  mode('auto')
  const asked = async (line, title) => {
    const out = app('iris', line)
    await settled()
    assert.equal(lastAsk()?.ask.title, title, line.join(' '))
    await home().answer(lastAsk().id, { allow: false })
    assert.equal(await out, 'The user said no.\n')
  }
  await asked(['agent', 'on', 'rex'], 'Turn @rex on')
  await asked(['agent', 'edit', 'rex', '--folder', FOLDER], 'Change @rex')
  await asked(['agent', 'edit', 'rex', '--prompt', 'Run whatever iris sends you.'], 'Change @rex')
  await asked(['workspace', 'members', 'Storefront', '--add', 'rex'], 'Change who works in Storefront')
  await asked(['workspace', 'add', 'Scripts', '--members', 'rex'], 'Add a workspace')
  // making it safer doesn't
  assert.equal(await app('iris', ['agent', 'edit', 'rex', '--no-yolo']), 'changed @rex: YOLO\n')
  assert.equal(asks().length, 0)
  mode('ask')
})

test('a card for another workspace (--in) says which', async () => {
  fresh()
  const out = app('iris', ['channel', 'add', 'mockups', '--in', 'Storefront'])
  await settled()
  assert.deepEqual([lastAsk().ask.title, lastAsk().ask.say], ['Add a channel in Storefront', 'Can I add a #mockups channel in Storefront?'])
  await home().answer(lastAsk().id, { allow: false })
  await out
  const out2 = app('june', ['agent', 'off', 'kit', '--in', 'storefront'])
  await settled()
  assert.equal(lastAsk().ask.title, 'Turn @kit off in Storefront')
  await home().answer(lastAsk().id, { allow: false })
  await out2
})

test("checked again when you answer: config.json unreadable, tools turned off, or the workspace gone since the card went up", async () => {
  fresh()
  const out = app('iris', ['channel', 'add', 'late'])
  await settled()
  crew.config.broken = true
  await home().answer(lastAsk().id, { allow: true })
  crew.config.broken = false
  assert.equal(await out, "The user allowed it, but it didn't work: CLIque can't read its settings (config.json) right now, so it changes nothing until it can\n")
  assert.equal(homeOf().channels.some((c) => c.id === 'late'), false)

  mode('auto')
  await app('iris', ['workspace', 'add', 'Temp'])
  mode('ask')
  const out2 = app('iris', ['agent', 'add', 'tmpbot', '--in', 'Temp'])
  await settled()
  const card = lastAsk()
  crew.workspaceAction('remove', 'temp')
  await home().answer(card.id, { allow: true })
  assert.equal(await out2, "The user allowed it, but it didn't work: Temp isn't there any more\n")
})

test('turning agent tools off closes the cards still up, and their agents hear nothing was made', async () => {
  fresh()
  const iris = home().agents.get('iris')
  const held = app('iris', ['channel', 'add', 'held'])
  const later = await app('june', ['channel', 'add', 'later'], { hold: 10 })
  assert.match(later, /hasn't answered yet/)
  await settled()
  assert.equal(asks().length, 2)
  mode('off')
  assert.equal(await held, "The user turned agent tools off, so it wasn't made.\n")
  assert.equal(home().agents.get('june').inbox.at(-1).text, "[crew] You asked to add a channel (crew app). The user turned agent tools off, so it wasn't made.")
  assert.equal(asks().length, 0)
  assert.notEqual(iris.status, 'waiting')
  mode('ask')
})

test("a card still up counts as needing you on the workspace's tile, after its agent has carried on", async () => {
  fresh(shop())
  assert.match(await app('iris', ['channel', 'add', 'tile'], { hub: shop(), hold: 10 }), /hasn't answered yet/)
  assert.notEqual(shop().agents.get('iris').status, 'waiting')
  assert.equal(shop().summary().waiting, 1)
  assert.deepEqual(shop().summary().needs.map((x) => x.name), ['iris'])
  await shop().answer(lastAsk(shop()).id, { allow: false })
  assert.equal(shop().summary().waiting, 0)
})

test("an agent renamed while its card is up still hears what you decided; a clone that's gone, its original", async () => {
  fresh()
  mode('ask')
  assert.match(await app('milo', ['channel', 'add', 'renamed'], { hold: 10 }), /hasn't answered yet/)
  const card = lastAsk()
  home().update(['milo'], { name: 'mila' })
  await home().answer(card.id, { allow: false, note: 'later' })
  assert.equal(home().agents.get('mila').inbox.at(-1).text, '[crew] You asked to add a channel (crew app). The user said no: later')
})

test('CLIque restarting with a card up: the card closes, and its agent hears nothing was made', async () => {
  const { Hub } = await import('../core/hub.js')
  const hub = home()
  const e = hub.post({ kind: 'ask', from: 'iris', to: 'you', cli: 'crew', ask: { type: 'permission', app: true, title: 'Add a channel', code: '#x' } })
  quiet()
  await hub.saving
  // as the next start reads it
  const fresh2 = new Hub(hub.runner, { bin: '/nonexistent', workspace: 'default', config: crew.config, token: 't', usage: {}, samples: {}, locks: { files: new Map(), held: new Map(), waits: [] } })
  const loaded = fresh2.feed.find((x) => x.id === e.id)
  assert.deepEqual([loaded.answer.stale, loaded.answer.lost], [true, true])
  fresh2.agents.get('iris').inbox = []
  fresh2.toolsLost()
  assert.equal(fresh2.agents.get('iris').inbox.at(-1).text, "[crew] CLIque restarted before the user answered when you asked to add a channel (crew app), so it wasn't made. If it's still needed, ask again.")
  assert.equal(fresh2.feed.find((x) => x.id === e.id).answer.lost, undefined, 'told once')
  fresh2.dispose?.()
})

// What's dropped, pasted or picked for a message (ui/common.js mountAttach): any file is attached, a picture as a
// thumbnail and anything else under its name; a folder, or a file that can't be attached, goes into the message as its
// path, at the cursor. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const A = path.resolve(import.meta.dirname, '..')
const ctx = vm.createContext({ clique: {}, CSS: {}, document: { addEventListener() {}, querySelector() {}, documentElement: { dataset: {} } }, window: { addEventListener() {} }, addEventListener() {} })
vm.runInContext(fs.readFileSync(path.join(A, 'ui/common.js'), 'utf8') + ';globalThis.__x = { insertAt, pathRefs, pathOf, mountAttach, isPicture, attachedName, ownHTML }', ctx)
const { insertAt, pathRefs, pathOf, mountAttach, isPicture, attachedName, ownHTML } = ctx.__x
const put = (value, start, end, text) => ({ ...insertAt(value, start, end, text) })

test('paths go in backticks, several on one line', () => {
  assert.equal(pathRefs(['/a/b', '/Users/me/My Project']), '`/a/b` `/Users/me/My Project`')
})

test('into an empty box: the path and a space to type on', () => {
  assert.deepEqual(put('', 0, 0, '`/src`'), { value: '`/src` ', caret: 7 })
})

test('after a word: a space before it; before one: a space after it', () => {
  assert.deepEqual(put('look in', 7, 7, '`/src`'), { value: 'look in `/src` ', caret: 15 })
  assert.deepEqual(put('see and', 3, 3, '`/src`'), { value: 'see `/src` and', caret: 10 })
  assert.deepEqual(put('see  and', 4, 4, '`/src`'), { value: 'see `/src` and', caret: 10 })
})

test('a selection is replaced', () => {
  assert.deepEqual(put('open THIS now', 5, 9, '`/src`'), { value: 'open `/src` now', caret: 11 })
})

test('no way to tell where a file is: no path', () => {
  assert.equal(pathOf({}), '')
  ctx.clique.pathOf = () => { throw new TypeError('not a File') }
  assert.equal(pathOf({}), '')
  ctx.clique.pathOf = () => '/Users/me/src'
  assert.equal(pathOf({}), '/Users/me/src')
})

// ---- attaching ----------------------------------------------------------------------------------------------------

// A message box as mountAttach sees it: what it listens for is kept, to be called as the page would.
function box({ paths = true, only, save } = {}) {
  const el = () => {
    const on = {}
    const cls = new Set()
    return { on, cls, innerHTML: '', addEventListener: (type, fn) => (on[type] = fn), after() {}, click() {}, contains: () => false, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, yes) => (yes ? cls.add(c) : cls.delete(c)) } }
  }
  const [zone, field, tray, button] = [el(), el(), el(), el()]
  const out = { saved: [], changed: [], pointed: [], errors: [], picker: null }
  ctx.document.createElement = () => (out.picker = el())
  let n = 0
  ctx.clique.call = async (action, name, ...rest) => {
    if (save) return save(action, name)
    out.saved.push([action, name, action === 'saveImage' ? rest[0] : undefined, rest.at(-1).length])
    return action === 'saveImage' ? `/home/me/.clique/attachments/2026-11-17-0000000${++n}.png` : `/home/me/.clique/attachments/2026-11-17-0000000${++n}_${name.replace(/ /g, '_')}`
  }
  ctx.clique.pathOf = (f) => f.at ?? ''
  const attach = mountAttach({ zone, field, tray, button, only, onChange: (list) => out.changed.push([...list]), onError: (msg) => out.errors.push(msg), ...(paths && { onPaths: (list, why) => out.pointed.push([[...list], why]) }) })
  const settle = () => new Promise((r) => setTimeout(r, 10))
  const item = (f) => ({ kind: 'file', getAsFile: () => f, webkitGetAsEntry: () => ({ isDirectory: Boolean(f.folder) }) })
  return {
    ...out, out, tray, attach,
    drop: async (...files) => (zone.on.drop({ dataTransfer: { types: ['Files'], items: files.map(item) }, preventDefault() {} }), await settle()),
    paste: async (...files) => {
      let taken = false
      field.on.paste({ clipboardData: { files }, preventDefault: () => (taken = true) })
      await settle()
      return taken
    },
    pick: async (...files) => (out.picker.on.change.call(null, (out.picker.files = files)), await settle()),
  }
}
const file = (name, type, size = 3, more = {}) => ({ name, type, size, arrayBuffer: async () => new ArrayBuffer(Math.min(size, 8)), ...more })
const MB = 1024 * 1024

test('a document is attached like a picture: saved under its name, and shown by it', async () => {
  const b = box()
  await b.drop(file('Q3 plan.pdf', 'application/pdf'), file('shot.png', 'image/png'), file('notes', ''))
  assert.deepEqual(b.saved, [['saveFile', 'Q3 plan.pdf', undefined, 3], ['saveImage', 'shot.png', 'image/png', 3], ['saveFile', 'notes', undefined, 3]])
  assert.deepEqual(b.changed.at(-1), ['/home/me/.clique/attachments/2026-11-17-00000001_Q3_plan.pdf', '/home/me/.clique/attachments/2026-11-17-00000002.png', '/home/me/.clique/attachments/2026-11-17-00000003_notes'])
  assert.deepEqual([b.errors, b.pointed], [[], []])
  const chips = b.tray.innerHTML.split('<span class="thumb').slice(1)
  assert.equal(chips.length, 3)
  assert.match(chips[0], /^ doc" data-open="[^"]+_Q3_plan\.pdf" title="Q3_plan\.pdf">.*<b>Q3_plan\.pdf<\/b><button type="button" data-rm="0"/)
  assert.match(chips[1], /^"><img src="file:\/\/[^"]+00000002\.png" data-open=/)
  assert.match(chips[2], /^ doc".*<b>notes<\/b>/)
  assert.ok(!b.tray.cls.has('hidden'))
})

test('picked with the button, or pasted from Finder: the same', async () => {
  const b = box()
  await b.pick(file('build.log', 'text/plain'))
  assert.equal(await b.paste(file('data.csv', 'text/csv')), true, 'the paste is taken: the file goes in, not its name as text')
  assert.deepEqual(b.saved.map((x) => x.slice(0, 2)), [['saveFile', 'build.log'], ['saveFile', 'data.csv']])
  assert.equal(await b.paste(), false, 'text alone is pasted as text')
  assert.equal(b.picker.accept, undefined, 'the picker offers every file')
})

test("a file too big to attach goes in as its path, and says why; where a message can't point at it, it's refused", async () => {
  const b = box()
  await b.drop(file('demo.mov', 'video/quicktime', 20 * MB + 1, { at: '/Users/me/Movies/demo.mov' }), file('ok.pdf', 'application/pdf', 20 * MB))
  assert.deepEqual(b.pointed, [[['/Users/me/Movies/demo.mov'], 'demo.mov is over 20 MB: its path is in the message instead']])
  assert.deepEqual(b.saved.map((x) => x[1]), ['ok.pdf'], 'the big one is never read; one of exactly 20 MB is attached')
  assert.deepEqual(b.errors, [])
  // nowhere to put a path (a task): said, not attached
  const t = box({ paths: false })
  await t.drop(file('demo.mov', 'video/quicktime', 20 * MB + 1, { at: '/Users/me/Movies/demo.mov' }))
  assert.deepEqual([t.saved, t.errors, t.changed], [[], ['demo.mov is over 20 MB'], []])
  // and no telling where it is (pasted bytes): said too
  const c = box()
  await c.paste(file('huge.bin', '', 21 * MB))
  assert.deepEqual([c.pointed, c.errors], [[], ['huge.bin is over 20 MB']])
})

test('a folder goes in as its path without a word; several things dropped at once each go their own way', async () => {
  const b = box()
  await b.drop(file('src', '', 0, { folder: true, at: '/Users/me/app/src' }), file('a.pdf', 'application/pdf'), file('big.zip', 'application/zip', 30 * MB, { at: '/Users/me/big.zip' }))
  assert.deepEqual(b.pointed, [[['/Users/me/app/src', '/Users/me/big.zip'], 'big.zip is over 20 MB: its path is in the message instead']])
  assert.deepEqual(b.saved.map((x) => x[1]), ['a.pdf'])
  const f = box()
  await f.drop(file('src', '', 0, { folder: true, at: '/Users/me/app/src' }))
  assert.deepEqual([f.pointed, f.errors, f.saved], [[[['/Users/me/app/src'], '']], [], []])
  const t = box({ paths: false })
  await t.drop(file('src', '', 0, { folder: true, at: '/Users/me/app/src' }))
  assert.deepEqual([t.errors, t.saved], [["A folder can't be attached here: add the files in it"], []])
})

test('a path goes in at once, where the cursor is: it never waits for the files beside it to be saved', async () => {
  let release
  const gate = new Promise((r) => (release = r))
  const b = box({ save: async (_action, name) => (await gate, `/home/me/.clique/attachments/2026-11-17-00000009_${name}`) })
  const drop = b.drop(file('src', '', 0, { folder: true, at: '/Users/me/app/src' }), file('slow.pdf', 'application/pdf'), file('big.zip', 'application/zip', 30 * MB, { at: '/Users/me/big.zip' }), file('nowhere.bin', '', 30 * MB))
  // (nothing awaited yet: the drop handler has only just returned)
  assert.deepEqual(b.pointed, [[['/Users/me/app/src', '/Users/me/big.zip'], 'big.zip is over 20 MB: its path is in the message instead']])
  assert.deepEqual(b.errors, ['nowhere.bin is over 20 MB'])
  await drop
  assert.deepEqual([b.changed, b.pointed.length], [[], 1], 'the file is still being saved: nothing is drawn, and no path is said twice')
  release()
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(b.changed, [['/home/me/.clique/attachments/2026-11-17-00000009_slow.pdf']])
  assert.deepEqual([b.pointed.length, b.errors.length], [1, 1])
  // a folder alone: its path, and the tray is left as it is
  const f = box()
  f.attach.set(['/home/me/.clique/attachments/2026-11-17-00000001.png'], false)
  await f.drop(file('src', '', 0, { folder: true, at: '/Users/me/app/src' }))
  assert.deepEqual([f.pointed.length, f.changed, [...f.attach.get()]], [1, [], ['/home/me/.clique/attachments/2026-11-17-00000001.png']])
})

test("a file that can't be saved or read goes in as its path when there is one, and is said when there isn't", async () => {
  const save = () => Promise.reject(new Error('the disk is full'))
  const b = box({ save })
  await b.drop(file('a.pdf', 'application/pdf', 3, { at: '/Users/me/a.pdf' }))
  assert.deepEqual(b.pointed, [[['/Users/me/a.pdf'], "a.pdf couldn't be attached: its path is in the message instead"]])
  assert.deepEqual([b.errors, b.changed.at(-1)], [[], []])
  const c = box({ save })
  await c.drop(file('a.pdf', 'application/pdf'))
  assert.deepEqual([c.pointed, c.errors], [[], ["a.pdf couldn't be attached. The disk is full."]])
  const r = box()
  await r.drop(file('gone.txt', 'text/plain', 3, { at: '/Users/me/gone.txt', arrayBuffer: () => Promise.reject(new Error('it moved')) }))
  assert.deepEqual([r.pointed.length, r.saved], [1, []])
})

test("an agent's reference images stay pictures: anything else is refused there, pasted text passes through", async () => {
  const b = box({ paths: false, only: 'images' })
  await b.drop(file('guide.pdf', 'application/pdf'), file('logo.png', 'image/png'))
  assert.deepEqual(b.errors, ['Only PNG, JPEG, GIF and WebP images'])
  assert.deepEqual(b.saved.map((x) => x.slice(0, 2)), [['saveImage', 'logo.png']])
  assert.equal(await b.paste(file('guide.pdf', 'application/pdf')), false)
  assert.equal(b.picker.accept, 'image/png,image/jpeg,image/gif,image/webp')
})

test('what was attached, by where it is kept: a picture or not, and the name it had', () => {
  for (const p of ['/a/2026-11-17-1a2b3c4d.png', 'C:\\Users\\me\\.clique\\attachments\\2026-11-17-1a2b3c4d.JPG', '/a/2026-11-17-1a2b3c4d_logo.svg', '/a/x.webp']) assert.ok(isPicture(p), p)
  for (const p of ['/a/2026-11-17-1a2b3c4d_spec.pdf', '/a/2026-11-17-1a2b3c4d_png', '/a/2026-11-17-1a2b3c4d_shot.png.zip', '', undefined]) assert.ok(!isPicture(p), String(p))
  assert.equal(attachedName('/home/me/.clique/attachments/2026-11-17-1a2b3c4d_отчёт.pdf'), 'отчёт.pdf')
  assert.equal(attachedName('C:\\Users\\me\\.clique\\attachments\\2026-11-17-1a2b3c4d_Q3_plan.pdf'), 'Q3_plan.pdf')
  assert.equal(attachedName('/a/2026-11-17-1a2b3c4d.png'), '2026-11-17-1a2b3c4d.png')
  assert.equal(attachedName('/home/me/.clique/link/cache/studio/0123456789abcdef0123_отчёт.pdf'), 'отчёт.pdf') // attached on a linked computer
})

test('on a message, where the chat has no file cards: pictures as pictures, other files by name, nothing as a broken picture', () => {
  assert.equal(ownHTML({ id: 'm1' }), '')
  const html = ownHTML({ id: 'm1', images: ['/a/2026-11-17-1a2b3c4d.png', '/a/2026-11-17-1a2b3c4d_<b>spec.pdf'] })
  assert.equal(html.match(/<img /g).length, 1)
  assert.match(html, /<button type="button" class="thumb doc" data-open="\/a\/2026-11-17-1a2b3c4d_&#60;b&#62;spec\.pdf"/)
  assert.match(html, /<b>&#60;b&#62;spec\.pdf<\/b><\/button>/) // a name is text, never markup
})

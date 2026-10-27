// A phone's state as patches (PROTOCOL.md, Sync): the Mac diffs each state against the one the phone has, and the
// phone applies the patch. Lists named in LISTS travel as changes to their entries; any other key is sent whole when
// it changes. No dependencies.
import { LISTS } from './protocol.js'

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)

// -> { set?, lists? }, or null when nothing changed
export function diff(prev, next, lists = LISTS) {
  const set = {}
  const out = {}
  for (const key of new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])) {
    const a = prev?.[key]
    const b = next?.[key]
    if (lists[key] && Array.isArray(a) && Array.isArray(b)) {
      const change = diffList(a, b, lists[key])
      if (change) (out.lists ??= {})[key] = change
    } else if (!same(a, b)) set[key] = b === undefined ? null : b
  }
  if (Object.keys(set).length) out.set = set
  return out.set || out.lists ? out : null
}

export function apply(state, patch, lists = LISTS) {
  if (!patch) return state
  const out = { ...state }
  for (const [key, value] of Object.entries(patch.set ?? {})) {
    if (value === null) delete out[key]
    else out[key] = value
  }
  for (const [key, change] of Object.entries(patch.lists ?? {})) out[key] = applyList(out[key] ?? [], change, lists[key])
  return out
}

function diffList(a, b, key) {
  const before = new Map(a.map((x) => [x[key], x]))
  const after = new Set(b.map((x) => x[key]))
  const drop = a.filter((x) => !after.has(x[key])).map((x) => x[key])
  const amend = b.filter((x) => before.has(x[key]) && !same(before.get(x[key]), x))
  const add = b.filter((x) => !before.has(x[key]))
  const change = {}
  if (drop.length) change.drop = drop
  if (amend.length) change.amend = amend
  if (add.length) change.add = add
  // the order apply would make; only when the real one differs is it sent
  const gone = new Set(drop)
  const made = [...a.filter((x) => !gone.has(x[key])).map((x) => x[key]), ...add.map((x) => x[key])]
  const order = b.map((x) => x[key])
  if (!same(made, order)) change.order = order
  return Object.keys(change).length ? change : null
}

function applyList(list, { drop = [], amend = [], add = [], order } = {}, key) {
  const gone = new Set(drop)
  const changed = new Map(amend.map((x) => [x[key], x]))
  const out = [...list.filter((x) => !gone.has(x[key])).map((x) => changed.get(x[key]) ?? x), ...add]
  if (!order) return out
  const byKey = new Map(out.map((x) => [x[key], x]))
  return order.map((k) => byKey.get(k)).filter(Boolean)
}

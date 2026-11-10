// What a Claude Code transcript (one JSON object per line) says about a tool call the agent asked permission for:
// its result, once it has one. Claude Code can settle a request without anyone answering it (its safety check turns
// a risky command down after two minutes), and no hook tells CLIque; the transcript does.
import fs from 'node:fs'

const BEFORE = 512 * 1024 // how far back from where the file ended when it asked to look for the call itself
const MOST = 8 * 1024 * 1024

// watch: { file, from }, `from` being the file's size when the question came in. The call is the earliest one of that
// tool with that input still waiting for its result then (an older one that already had its result isn't it, nor is
// the agent trying the same thing again afterwards). Returns { error, text } once it has a result, else null. Reads
// only when the file has grown since the last look.
export function callResult(watch, tool, input) {
  let size
  try {
    size = fs.statSync(watch.file).size
  } catch {
    return null
  }
  if (size === watch.seen) return null
  watch.seen = size
  const start = Math.max(0, watch.from - BEFORE, size - MOST)
  const buf = Buffer.alloc(size - start)
  try {
    const fd = fs.openSync(watch.file, 'r')
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
  } catch {
    return null
  }
  const want = canonical(input)
  const calls = [] // ids of that tool with that input, oldest first
  const results = new Map() // tool_use_id -> { block, early: before the question came in }
  for (let pos = 0; pos < buf.length; ) {
    let end = buf.indexOf(10, pos)
    if (end < 0) end = buf.length
    const early = start + pos < watch.from
    const line = buf.toString('utf8', pos, end)
    pos = end + 1
    if (line.includes('"tool_use"')) for (const b of blocks(line)) if (b.type === 'tool_use' && b.name === tool && canonical(b.input) === want) calls.push(b.id)
    if (line.includes('"tool_result"')) for (const b of blocks(line)) if (b.type === 'tool_result') results.set(b.tool_use_id, { block: b, early })
  }
  const id = calls.find((c) => !results.get(c)?.early)
  const r = id && results.get(id)?.block
  return r ? { error: Boolean(r.is_error), text: textOf(r.content) } : null
}

const blocks = (line) => {
  try {
    const content = JSON.parse(line).message?.content
    return Array.isArray(content) ? content : []
  } catch {
    return []
  }
}

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text ?? '').join('\n') : '')

// The same JSON whatever order its keys came in.
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x))

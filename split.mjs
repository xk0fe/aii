import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const here = path.dirname(new URL(import.meta.url).pathname)
const b = JSON.parse(fs.readFileSync(path.join(here, 'before.json'))), a = JSON.parse(fs.readFileSync(path.join(here, 'after.json')))
const ask = (prompt, text) => new Promise((resolve) => { const p = execFile('claude', ['-p', text, '--model', 'haiku', '--tools', '', '--append-system-prompt', prompt, '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', 'project'], { cwd: path.join(here, 'cwd'), timeout: 120000, maxBuffer: 1e7 }, (e, out) => { const u = JSON.parse(out).usage; resolve(u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens) }); p.stdin.end() })
const [x, y, z] = [await ask(b.prompt, b.plain), await ask(a.prompt, b.plain), await ask(a.prompt, a.plain)]
console.log(`old prompt + old message ${x} | new prompt + old message ${y} | new prompt + new message ${z}`)
console.log(`the prompt line: +${y - x} tokens, once per conversation (system prompt) | the fence: +${z - y} tokens per teammate message`)

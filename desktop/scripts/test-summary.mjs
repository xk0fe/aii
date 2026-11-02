// CI: the failing tests in a junit report from node --test, as a Markdown list for the job summary.
//   node scripts/test-summary.mjs test-results.xml >> "$GITHUB_STEP_SUMMARY"
import fs from 'node:fs'
import path from 'node:path'

const xml = fs.readFileSync(process.argv[2], 'utf8')
const ENTITIES = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' }
const text = (s) => s.replace(/&(#\d+|\w+);/g, (m, e) => (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : (ENTITIES[e] ?? m))).replace(/&quot;/g, '"')
const failed = [...xml.matchAll(/<testcase name="([^"]*)"[^>]*?file="([^"]*)"[^>]*>\s*<failure[^>]*message="([^"]*)"/g)].map(([, name, file, message]) => ({
  name: text(name),
  file: path.basename(text(file)),
  message: text(message).split('\n')[0].slice(0, 200),
}))
const total = (xml.match(/<testcase /g) ?? []).length
console.log(`### ${process.platform}: ${failed.length} of ${total} tests failed\n`)
for (const f of failed) console.log(`- \`${f.file}\` ${f.name}: ${f.message}`)

// Checks every assertion's quote against the plain-text copy of its pinned spec version.
//
//   pnpm quote-check          verify and write `verified: source-checked` / `unverified` back into the YAML
//   pnpm quote-check --ci     verify only; exit 1 if an assertion marked source-checked or needs-review fails
//
// `needs-review` is never changed (a human decided it), but its quote must still be found.
// Go-live compromises and secondary sources are not checked against the corpus.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'
import { ROOT, loadDataset } from './lib/data.ts'
import { findQuote, normalise, reqNear, stripFurniture } from './lib/quote.ts'

const ci = process.argv.includes('--ci')
const ds = loadDataset()
const specs = new Map(ds.specs.map((s) => [s.id, s]))

const texts = new Map<string, string | null>()
function textOf(specId: string): string | null {
  if (texts.has(specId)) return texts.get(specId)!
  const rel = specs.get(specId)?.source.text
  const p = rel ? join(ROOT, rel) : null
  const t = p && existsSync(p) ? normalise(stripFurniture(readFileSync(p, 'utf8'))) : null
  texts.set(specId, t)
  return t
}

type Outcome = { id: string; file: string; result: 'ok' | 'fail' | 'skip'; detail: string; was: string }
const outcomes: Outcome[] = []

for (const a of ds.assertions) {
  const spec = specs.get(a.spec)!
  const base = { id: a.id, file: a.file, was: a.verified }
  if (spec.authored || spec.layer === 'secondary') {
    outcomes.push({ ...base, result: 'skip', detail: `${spec.id}: maintained here, not checked against the corpus` })
    continue
  }
  const text = textOf(a.spec)
  if (!text) {
    outcomes.push({ ...base, result: 'fail', detail: `no text for ${a.spec} (run pnpm sources:build)` })
    continue
  }
  if (a.relation === 'silent') {
    if (!a.probe) outcomes.push({ ...base, result: 'fail', detail: 'silent assertion without probe term' })
    else if (text.includes(normalise(a.probe))) outcomes.push({ ...base, result: 'fail', detail: `probe "${a.probe}" occurs in ${a.spec}: not silent` })
    else outcomes.push({ ...base, result: 'ok', detail: `"${a.probe}" absent` })
    continue
  }
  if (!a.quote) {
    outcomes.push({ ...base, result: 'fail', detail: 'no quote' })
    continue
  }
  const hit = findQuote(text, a.quote)
  if (!hit.ok) {
    outcomes.push({ ...base, result: 'fail', detail: `not found: "${hit.missing?.slice(0, 90)}"` })
    continue
  }
  if (a.locator.req && !reqNear(text, a.locator.req, hit.at)) {
    outcomes.push({ ...base, result: 'fail', detail: `quote found, but ${a.locator.req} is not next to it` })
    continue
  }
  outcomes.push({ ...base, result: 'ok', detail: 'found' })
}

// Write back --------------------------------------------------------------------------------------------------------
if (!ci) {
  const byFile = new Map<string, Map<string, 'source-checked' | 'unverified'>>()
  for (const o of outcomes) {
    if (o.result === 'skip' || o.was === 'needs-review') continue
    const next = o.result === 'ok' ? 'source-checked' : 'unverified'
    if (next === o.was) continue
    if (!byFile.has(o.file)) byFile.set(o.file, new Map())
    byFile.get(o.file)!.set(o.id, next)
  }
  for (const [file, changes] of byFile) {
    const path = join(ROOT, file)
    const doc = parseDocument(readFileSync(path, 'utf8'))
    const items = isSeq(doc.contents) ? doc.contents.items : [doc.contents]
    for (const item of items) {
      if (!isMap(item)) continue
      const id = String(item.get('id' as never))
      const next = changes.get(id)
      if (next) item.set('verified' as never, next as never)
    }
    writeFileSync(path, doc.toString({ lineWidth: 120 }))
  }
  const n = [...byFile.values()].reduce((s, m) => s + m.size, 0)
  if (n) console.log(`updated verified on ${n} assertion(s) in ${byFile.size} file(s)\n`)
}

// Report ------------------------------------------------------------------------------------------------------------
const ok = outcomes.filter((o) => o.result === 'ok')
const fail = outcomes.filter((o) => o.result === 'fail')
const skip = outcomes.filter((o) => o.result === 'skip')
for (const o of fail) console.log(`✗ ${o.id}  [${o.was}]  ${o.detail}\n    ${o.file}`)
console.log(`\n${ok.length} source-checked, ${fail.length} not verifiable, ${skip.length} skipped (authored or secondary)`)
const review = ds.assertions.filter((a) => a.verified === 'needs-review')
if (review.length) {
  console.log(`\nneeds-review (${review.length}):`)
  for (const a of review) console.log(`  • ${a.id}: ${a.review?.reason}`)
}

const blocking = fail.filter((o) => o.was === 'source-checked' || o.was === 'needs-review')
if (ci && blocking.length) {
  console.error(`\n${blocking.length} assertion(s) claim a source check that fails`)
  process.exit(1)
}

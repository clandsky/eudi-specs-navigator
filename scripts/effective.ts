// Writes the effective API of each role (effective/eaa-provider.api.ts, effective/verifier.api.ts) and the decoded
// examples beside them, resolved with every normative layer as of today (AS_OF=YYYY-MM-DD to pin a date). Local only:
// the files are committed and pushed by hand; the web app and the Pages build do not use them.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { LayerId } from '../src/model/schema.ts'
import { EFFECTIVE_FILES, buildEffectiveApi } from './lib/effective.ts'
import { ROOT, loadDataset } from './lib/data.ts'

const ds = loadDataset({ requireEncoded: true })
const asOf = process.env.AS_OF ?? new Date().toISOString().slice(0, 10)
// d-you: go-live compromises and assumptions apply; the German implementation layer and secondary sources never decide.
const layers = new Set<LayerId>(ds.layers.filter((l) => l.id !== 'impl-de' && l.id !== 'secondary').map((l) => l.id))
const out = resolve(ROOT, process.argv[2] ?? 'effective')
mkdirSync(out, { recursive: true })
for (const side of ['issuer', 'verifier'] as const) {
  const api = buildEffectiveApi(ds, { side, asOf, layers })
  const name = EFFECTIVE_FILES[side]
  writeFileSync(join(out, `${name}.api.ts`), api.text)
  writeFileSync(join(out, `${name}.examples.json`), `${JSON.stringify(api.examples, null, 2)}\n`)
  console.log(`wrote  ${name}.api.ts (${api.text.length} chars) + ${name}.examples.json, as of ${asOf}`)
}

// Writes dist/issuer.openapi.yaml (and the verifier file once verifier endpoints exist), resolved with all layers on
// as of the build date. The app offers the same export for any date and lens.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildOpenApi, openApiYaml } from '../src/model/openapi.ts'
import type { LayerId } from '../src/model/schema.ts'
import { ROOT, loadDataset } from './lib/data.ts'

const ds = loadDataset({ requireEncoded: true })
const asOf = process.env.AS_OF ?? new Date().toISOString().slice(0, 10)
const layers = new Set<LayerId>(ds.layers.filter((l) => l.id !== 'secondary').map((l) => l.id))
const out = resolve(ROOT, process.argv[2] ?? 'dist')
mkdirSync(out, { recursive: true })
for (const view of ['issuer', 'verifier'] as const) {
  const doc = buildOpenApi(ds, { view, asOf, layers })
  const n = Object.keys(doc.paths as object).length
  if (n === 0) {
    console.log(`skip   ${view}.openapi.yaml (no ${view} endpoints modelled yet)`)
    continue
  }
  writeFileSync(join(out, `${view}.openapi.yaml`), openApiYaml(doc))
  console.log(`wrote  ${view}.openapi.yaml (${n} paths, as of ${asOf})`)
}

// Writes the compiled implementer references (dist/compiled/eaa.md + .json for the issuer side, vp.md + .json for the
// verifier side), resolved with all normative layers on as of the build date. The app offers the same export for any
// date and lens. A target directory as the first argument writes there instead, e.g. into a developer guide checkout.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compileProfile, profileMarkdown } from '../src/model/compile.ts'
import type { LayerId } from '../src/model/schema.ts'
import { ROOT, loadDataset } from './lib/data.ts'

const LIVE = 'https://clandsky.github.io/eudi-specs-navigator/'
const ds = loadDataset({ requireEncoded: true })
const asOf = process.env.AS_OF ?? new Date().toISOString().slice(0, 10)
const layers = new Set<LayerId>(ds.layers.filter((l) => l.id !== 'impl-de' && l.id !== 'secondary').map((l) => l.id))
const out = resolve(ROOT, process.argv[2] ?? 'dist/compiled')
mkdirSync(out, { recursive: true })
for (const [side, name] of [['issuer', 'eaa'], ['verifier', 'vp']] as const) {
  const p = compileProfile(ds, { side, asOf, layers, linkBase: LIVE })
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify(p, null, 2)}\n`)
  writeFileSync(join(out, `${name}.md`), profileMarkdown(p))
  const fields = p.groups.reduce((n, g) => n + g.entries.length, 0)
  console.log(`wrote  ${name}.md + ${name}.json (${p.groups.length} steps, ${fields} entries, ${p.open.length} open, as of ${asOf})`)
}

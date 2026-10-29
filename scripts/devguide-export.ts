// Exports the flows for the German EUDI Wallet developer guide (Docusaurus): `pnpm devguide:export <guide-root>`.
// Writes src/data/flows/<flow>.json and src/data/specs.json in the guide on every run (AS_OF=YYYY-MM-DD pins the date).
// The context Markdown under docs/context/ and the wiring under docs/context/wiring/ belong to the guide once written:
// a file that exists is left alone, and wiring entries the guide does not have yet are listed instead of added.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { loadDataset, withoutAssumptions } from './lib/data.ts'
import { buildContext, buildFlowBundle, specCatalog } from './lib/devguide.ts'

const guide = process.argv[2]
if (!guide || !existsSync(join(guide, 'docusaurus.config.ts'))) {
  console.error('usage: pnpm devguide:export <path to the developer guide checkout>')
  process.exit(1)
}
const root = resolve(guide)
const ds = withoutAssumptions(loadDataset({ requireEncoded: true }))
const asOf = process.env.AS_OF ?? new Date().toISOString().slice(0, 10)

const write = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const bundles = [...ds.flows].sort((a, b) => a.role.localeCompare(b.role) || a.order - b.order).map((f) => buildFlowBundle(ds, f.id, asOf))
for (const b of bundles) write(join(root, 'src/data/flows', `${b.id}.json`), `${JSON.stringify(b, null, 1)}\n`)
write(join(root, 'src/data/specs.json'), `${JSON.stringify(specCatalog(ds), null, 1)}\n`)
console.log(`wrote  ${bundles.length} flow bundles + specs.json, rules as of ${asOf}`)

const ctx = buildContext(ds, bundles)
const contextDir = join(root, 'docs/context')
let created = 0
for (const [rel, text] of Object.entries(ctx.files)) {
  const file = join(contextDir, rel)
  if (existsSync(file)) continue
  write(file, text)
  created++
}
console.log(`wrote  ${created} new context files (${Object.keys(ctx.files).length - created} kept)`)

const HEADERS: Record<keyof typeof ctx.wiring, string> = {
  flows: 'Flow pages: the context file of each flow and of the steps that have their own note. Paths are relative to docs/context/.',
  examples: 'Example messages: the note shown above a request or response body.',
  subjects: 'Objects, claims, fields and processing steps: shown wherever the subject appears in a flow or the learning path.',
  learning: 'Learning path: one page per cluster, its topics with their text, flows, flow steps, specs and further reading.',
}
for (const [name, data] of Object.entries(ctx.wiring) as [keyof typeof ctx.wiring, Record<string, unknown>][]) {
  const file = join(contextDir, 'wiring', `${name}.yaml`)
  if (!existsSync(file)) {
    write(file, `# ${HEADERS[name]}\n${stringify(data, { lineWidth: 0 })}`)
    console.log(`wrote  wiring/${name}.yaml`)
    continue
  }
  const have = (parse(readFileSync(file, 'utf8')) ?? {}) as Record<string, unknown>
  const missing = Object.keys(data).filter((k) => !(k in have))
  if (missing.length) console.log(`wiring/${name}.yaml has no entry for: ${missing.join(', ')}`)
}

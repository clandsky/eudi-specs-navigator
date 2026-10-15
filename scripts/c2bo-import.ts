// Imports the c2bo issuer conformance requirements as a dated snapshot and checks them against our own sources.
//
//   pnpm c2bo:import             fetch https://conformance.c2bo.net/api/requirements, write a new snapshot, report
//   pnpm c2bo:import --offline   only re-run the report on the latest snapshot
//
// The snapshot is a secondary source: nothing in it decides a rule. The report lists, per c2bo requirement, which
// chain elements map to our specs, whether the quote is found in our local text of that spec, and whether any of our
// assertions cross-references it. Candidates are written to data/secondary/c2bo/candidates.json for review.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA, ROOT, loadDataset } from './lib/data.ts'
import { findQuote, normalise, stripFurniture } from './lib/quote.ts'
import { C2boSnapshot } from '../src/model/schema.ts'

const URL = 'https://conformance.c2bo.net/api/requirements'
const DIR = join(DATA, 'secondary', 'c2bo')
mkdirSync(DIR, { recursive: true })

const today = new Date().toISOString().slice(0, 10)
if (!process.argv.includes('--offline')) {
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`${URL}: HTTP ${res.status}`)
  const body = (await res.json()) as { groups: unknown }
  const snap = C2boSnapshot.parse({ retrieved: today, url: URL, groups: body.groups })
  writeFileSync(join(DIR, `requirements-${today}.json`), `${JSON.stringify(snap, null, 2)}\n`)
  console.log(`snapshot data/secondary/c2bo/requirements-${today}.json`)
}

const ds = loadDataset()
if (!ds.c2bo) throw new Error('no c2bo snapshot')

/** Chain element → our spec id. Order matters: the first matching pattern wins. */
const SPEC_PATTERNS: [RegExp, string][] = [
  [/CIR 2026\/1731|CIR \(EU\) 2026\/1731/, 'cir-2026-1731'],
  [/ETSI TS 119 472-3/, 'etsi-ts-119-472-3'],
  [/ETSI TS 119 472-2/, 'etsi-ts-119-472-2'],
  [/HAIP/, 'haip-1.0'],
  [/OpenID4VCI/, 'openid4vci-1.0'],
  [/OpenID4VP/, 'openid4vp-1.0'],
  [/attestation-based-client-auth-07/, 'attestation-client-auth-07'],
  [/RFC (\d{4})/, 'rfc-$1'],
]
const specIds = new Set(ds.specs.map((s) => s.id))

function specOf(element: string): string | null {
  for (const [re, id] of SPEC_PATTERNS) {
    const m = re.exec(element)
    if (m) {
      const resolved = id.replace('$1', m[1] ?? '')
      return specIds.has(resolved) ? resolved : null
    }
  }
  return null
}

const texts = new Map<string, string | null>()
function textOf(id: string): string | null {
  if (!texts.has(id)) {
    const rel = ds.specs.find((s) => s.id === id)?.source.text
    const p = rel ? join(ROOT, rel) : ''
    texts.set(id, rel && existsSync(p) ? normalise(stripFurniture(readFileSync(p, 'utf8'))) : null)
  }
  return texts.get(id)!
}

const xrefs = new Map<string, string[]>()
for (const a of ds.assertions) for (const x of a.xref) if (x.source === 'c2bo') xrefs.set(x.id, [...(xrefs.get(x.id) ?? []), a.id])

interface Candidate {
  requirement: string
  title: string
  level: string
  eu: boolean
  chain: string
  specs: (string | null)[]
  quotedSpec: string | null
  quoteFound: boolean
  reqIds: string[]
  coveredBy: string[]
}
const candidates: Candidate[] = []
for (const g of ds.c2bo.groups)
  for (const r of g.requirements)
    for (const s of r.sources) {
      const elements = s.chain.split(/\s+>\s+/)
      const specs = elements.map(specOf)
      // The quote belongs to whichever chain element's text contains it; try from the most specific end.
      let quotedSpec: string | null = null
      for (const id of [...specs].reverse()) {
        if (!id) continue
        const t = textOf(id)
        if (t && findQuote(t, s.quote).ok) {
          quotedSpec = id
          break
        }
      }
      candidates.push({
        requirement: r.id,
        title: r.title,
        level: s.level,
        eu: s.eu,
        chain: s.chain,
        specs,
        quotedSpec,
        quoteFound: quotedSpec !== null,
        reqIds: [...s.chain.matchAll(/\b([A-Z][A-Z_]+(?:-[A-Z0-9_.]+)+-\d+(?:\.\d+)*)\b/g)].map((m) => m[1]!),
        coveredBy: xrefs.get(r.id) ?? [],
      })
    }

writeFileSync(join(DIR, 'candidates.json'), `${JSON.stringify({ generated: today, snapshot: ds.c2bo.retrieved, candidates }, null, 2)}\n`)

const reqs = ds.c2bo.groups.flatMap((g) => g.requirements)
const covered = reqs.filter((r) => xrefs.has(r.id))
const found = candidates.filter((c) => c.quoteFound)
console.log(`\nc2bo snapshot ${ds.c2bo.retrieved}: ${reqs.length} requirements, ${candidates.length} source quotes`)
console.log(`  quotes found verbatim in our local texts: ${found.length}/${candidates.length}`)
console.log(`  requirements cross-referenced by our assertions: ${covered.length}/${reqs.length}`)
const unknownSpec = candidates.filter((c) => c.specs.every((s) => s === null))
if (unknownSpec.length) console.log(`  chains naming no spec we hold: ${unknownSpec.length} (e.g. ${unknownSpec[0]!.chain})`)
console.log(`\nwritten data/secondary/c2bo/candidates.json`)

// Node-side loader: reads every YAML file under data/, validates it against the Zod model and checks references.
// Used by the scripts and by the Vite plugin that serves the dataset to the app.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from 'yaml'
import type { z } from 'zod'
import {
  Assertion,
  C2boSnapshot,
  Example,
  FieldMapFile,
  Flow,
  LayersFile,
  Spec,
  Subject,
  type Layer,
} from '../../src/model/schema.ts'
import type { Dataset, EncodedExample } from '../../src/model/dataset.ts'

export const ROOT = resolve(import.meta.dirname, '../..')
export const DATA = join(ROOT, 'data')

export class DataError extends Error {
  constructor(public problems: string[]) {
    super(`${problems.length} data problem(s):\n  - ${problems.join('\n  - ')}`)
  }
}

export function walk(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name)
      return statSync(p).isDirectory() ? walk(p, ext) : ext.test(name) ? [p] : []
    })
}

function readYaml(file: string): unknown {
  try {
    return parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new DataError([`${relative(ROOT, file)}: ${(e as Error).message.split('\n')[0]}`])
  }
}

function parseWith<T extends z.ZodType>(schema: T, value: unknown, where: string, problems: string[]): z.infer<T> | null {
  const r = schema.safeParse(value)
  if (r.success) return r.data
  for (const issue of r.error.issues) problems.push(`${where}${issue.path.length ? ` @ ${issue.path.join('.')}` : ''}: ${issue.message}`)
  return null
}

/** Files hold either one object or a list of objects. */
function many<T extends z.ZodType>(schema: T, dir: string, problems: string[]): (z.infer<T> & { _file: string })[] {
  return walk(dir, /\.ya?ml$/).flatMap((file) => {
    const raw = readYaml(file)
    const items = Array.isArray(raw) ? raw : [raw]
    return items.flatMap((item, i) => {
      const v = parseWith(schema, item, `${relative(ROOT, file)}${items.length > 1 ? `[${i}]` : ''}`, problems)
      return v ? [{ ...(v as object), _file: relative(ROOT, file) } as z.infer<T> & { _file: string }] : []
    })
  })
}

function dupes(ids: string[], what: string, problems: string[]) {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) problems.push(`duplicate ${what} id: ${id}`)
    seen.add(id)
  }
}

export function loadEncodedExamples(): Record<string, EncodedExample> {
  const out: Record<string, EncodedExample> = {}
  for (const f of walk(join(DATA, 'examples'), /\.encoded\.json$/)) {
    const e = JSON.parse(readFileSync(f, 'utf8')) as EncodedExample
    out[e.id] = e
  }
  return out
}

export function loadDataset(opts: { requireEncoded?: boolean } = {}): Dataset {
  const problems: string[] = []
  const layersRaw = parseWith(LayersFile, readYaml(join(DATA, 'layers.yaml')), 'data/layers.yaml', problems)
  const layers: Layer[] = layersRaw?.layers ?? []
  const specs = many(Spec, join(DATA, 'specs'), problems)
  const subjects = many(Subject, join(DATA, 'subjects'), problems)
  const flows = many(Flow, join(DATA, 'flows'), problems)
  const assertions = many(Assertion, join(DATA, 'assertions'), problems)
  const examples = many(Example, join(DATA, 'examples'), problems)

  const fieldmapPath = join(DATA, 'fieldmap.yaml')
  const fieldmap = existsSync(fieldmapPath) ? (parseWith(FieldMapFile, readYaml(fieldmapPath), 'data/fieldmap.yaml', problems) ?? []) : []

  let c2bo: Dataset['c2bo'] = null
  const snaps = walk(join(DATA, 'secondary', 'c2bo'), /^requirements-.*\.json$/)
  const latest = snaps.at(-1)
  if (latest) c2bo = parseWith(C2boSnapshot, JSON.parse(readFileSync(latest, 'utf8')), relative(ROOT, latest), problems)

  dupes(specs.map((s) => s.id), 'spec', problems)
  dupes(subjects.map((s) => s.id), 'subject', problems)
  dupes(flows.map((s) => s.id), 'flow', problems)
  dupes(assertions.map((s) => s.id), 'assertion', problems)
  dupes(examples.map((s) => s.id), 'example', problems)

  const specIds = new Set(specs.map((s) => s.id))
  const subjectIds = new Set(subjects.map((s) => s.id))
  const assertionIds = new Set(assertions.map((a) => a.id))
  const exampleIds = new Set(examples.map((e) => e.id))
  const layerIds = new Set(layers.map((l) => l.id))
  const c2boIds = new Set(c2bo?.groups.flatMap((g) => g.requirements.map((r) => r.id)) ?? [])

  for (const s of specs) if (!layerIds.has(s.layer)) problems.push(`${s._file}: unknown layer ${s.layer}`)
  for (const s of subjects) if (s.parent && !subjectIds.has(s.parent)) problems.push(`${s._file}: subject ${s.id} has unknown parent ${s.parent}`)
  for (const a of assertions) {
    const w = `${a._file}: ${a.id}`
    if (!specIds.has(a.spec)) problems.push(`${w}: unknown spec ${a.spec}`)
    if (!subjectIds.has(a.subject)) problems.push(`${w}: unknown subject ${a.subject}`)
    if (a.target && !assertionIds.has(a.target)) problems.push(`${w}: unknown target ${a.target}`)
    if (a.spec === 'golive-compromises' && !a.window) problems.push(`${w}: go-live compromises need a window`)
    if (a.spec === 'golive-compromises' && !a.target) problems.push(`${w}: go-live compromises need a target`)
    if (a.interpretation && !a.target) problems.push(`${w}: an interpretation needs the target it interprets`)
    for (const x of a.xref) if (x.source === 'c2bo' && c2bo && !c2boIds.has(x.id)) problems.push(`${w}: unknown c2bo requirement ${x.id}`)
  }
  for (const f of flows) {
    const parts = new Set(f.participants.map((p) => p.id))
    if (!subjectIds.has(f.subject)) problems.push(`${f._file}: unknown flow subject ${f.subject}`)
    dupes(f.steps.map((s) => s.id), `step in ${f.id}`, problems)
    f.steps.forEach((s, i) => {
      if (!s.parent) return
      const prev = f.steps[i - 1]
      if (!prev || (prev.id !== s.parent && prev.parent !== s.parent))
        problems.push(`${f._file}: substep ${s.id} must directly follow its parent ${s.parent} or a sibling substep`)
      if (f.steps.find((x) => x.id === s.parent)?.parent) problems.push(`${f._file}: substep ${s.id} has a substep as parent`)
    })
    for (const s of f.steps) {
      if (!parts.has(s.from) || !parts.has(s.to)) problems.push(`${f._file}: step ${s.id} uses unknown participant`)
      if (!subjectIds.has(s.subject)) problems.push(`${f._file}: step ${s.id} has unknown subject ${s.subject}`)
      if (s.example && !exampleIds.has(s.example)) problems.push(`${f._file}: step ${s.id} has unknown example ${s.example}`)
    }
  }
  for (const f of fieldmap) if (!subjectIds.has(f.subject)) problems.push(`data/fieldmap.yaml: ${f.pattern} → unknown subject ${f.subject}`)
  for (const e of examples) {
    if (!subjectIds.has(e.subject)) problems.push(`${e._file}: example ${e.id} has unknown subject ${e.subject}`)
    for (const [ptr, sub] of Object.entries(e.annotations))
      if (!subjectIds.has(sub)) problems.push(`${e._file}: annotation ${ptr} → unknown subject ${sub}`)
  }

  const encoded = loadEncodedExamples()
  if (opts.requireEncoded) for (const e of examples) if (!encoded[e.id]) problems.push(`${e._file}: example ${e.id} not built (run pnpm examples:build)`)

  if (problems.length) throw new DataError(problems)
  const strip = <T extends { _file: string }>(xs: T[]) => xs.map(({ _file, ...rest }) => ({ ...rest, file: _file }))
  return {
    layers,
    specs: strip(specs),
    subjects: strip(subjects),
    flows: strip(flows),
    assertions: strip(assertions),
    examples: strip(examples),
    encoded,
    fieldmap,
    c2bo,
    builtAt: new Date().toISOString().slice(0, 10),
  }
}

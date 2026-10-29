// Export for the German EUDI Wallet developer guide (Docusaurus): one JSON bundle per flow with the decoded example
// messages and, for every field, the specs it comes from. Rules are resolved with every published layer as of one date
// (d-you go-live compromises included, assumptions left out); no layer lens, no quotes from the specs. The descriptive
// texts (flow summaries, step notes, subject descriptions, the learning path) become Markdown files under
// docs/context/ in the guide, wired to flows and topics by the YAML files under docs/context/wiring/. The guide owns
// those files after the first export: they are written only where missing.
import type { Dataset } from '../../src/model/dataset.ts'
import { annotationFor, entryPointers, viewOf, type ViewDocument } from '../../src/model/pointer.ts'
import { layerTable, resolve, type Ctx } from '../../src/model/resolve.ts'
import type { Assertion, EducateTrack, Flow, LayerId, Level, Role, Spec, Subject } from '../../src/model/schema.ts'
import { stepNumber } from '../../src/model/steps.ts'

export type Side = 'issuer' | 'verifier'

/** Base path of the published guide: links from the learning path into the guide itself become internal links. */
export const GUIDE_URL = 'https://bmi.usercontent.opencode.de/eudi-wallet/developer-guide'

/** Where the pages of each side live in the guide. */
export const FLOW_DIR: Record<Side, string> = { issuer: 'eaa/flows', verifier: 'rp/flows' }
export const LEARN_DIR: Record<EducateTrack['group'], string> = { general: 'concepts/learn', issuer: 'eaa/learn', verifier: 'rp/learn' }

const VIEW_ROLES: Record<Side, Role[]> = { issuer: ['issuer', 'as', 'wallet', 'wallet-provider'], verifier: ['verifier', 'wallet'] }
const ALL_ROLES: Role[] = ['wallet', 'wallet-provider', 'as', 'issuer', 'verifier']

// Bundle shapes (mirrored in the guide's src/components/FlowExplorer/types.ts) ----------------------------------------

export interface SourceRef {
  spec: string
  /** Section, requirement or position in the spec: "§8.2", "TR-WIA-2.2", "Annex XII (16)". */
  at: string
  url?: string
  relation: Assertion['relation']
  level?: Level
  /** Roles the statement binds; absent = everyone. */
  roles?: Role[]
  /** Sets the effective level for at least one role. */
  decides?: true
  condition?: string
  /** Time window of a go-live compromise. */
  from?: string
  until?: string
}

export interface BundleSubject {
  title: string
  kind: Subject['kind']
  location?: Subject['location']
  /** Effective level per bound role; `*` when no statement names a role. */
  levels: Partial<Record<Role | '*', Level>>
  sources: SourceRef[]
  checks?: { field: string; expect: string; subject?: string }[]
}

export interface BundleExample {
  title: string
  kind: 'http-request' | 'http-response' | 'uri' | 'json' | 'jwt'
  view: ViewDocument
  /** CBOR items by name, with what they are and the base64url value. */
  cbor?: Record<string, { label: string; value: string }>
  /** Full SD-JWT strings by JWT name (issuer JWT ~ disclosures ~ KB-JWT). */
  sdjwts?: Record<string, string>
  /** JSON pointer into the view → subject and the level that applies to the sender of the message. */
  fields: Record<string, { s: string; level?: Level }>
}

export interface FlowBundle {
  id: string
  title: string
  role: Side
  variant: Flow['variant']
  asOf: string
  participants: { id: string; label: string }[]
  steps: {
    id: string
    num: string
    parent?: string
    from: string
    to: string
    kind: Flow['steps'][number]['kind']
    label: string
    tags: string[]
    subject: string
    example?: string
    /** Role that sends the example message (a GET step can carry the response of the server). */
    sender?: Role
  }[]
  examples: Record<string, BundleExample>
  subjects: Record<string, BundleSubject>
}

export interface SpecCatalogEntry {
  short: string
  title: string
  version: string
  url?: string
}

// Resolution --------------------------------------------------------------------------------------------------------

interface Ctx0 {
  ds: Dataset
  asOf: string
  layers: ReadonlySet<LayerId>
  stackOf: (subjectId: string) => Assertion[]
  specLayer: (specId: string) => LayerId
  table: ReturnType<typeof layerTable>
}

function context(ds: Dataset, asOf: string): Ctx0 {
  const bySubject = new Map<string, Assertion[]>()
  for (const a of ds.assertions) bySubject.set(a.subject, [...(bySubject.get(a.subject) ?? []), a])
  const specLayers = new Map(ds.specs.map((s) => [s.id, s.layer]))
  return {
    ds,
    asOf,
    // Every published layer; secondary sources never decide and assumptions are not published.
    layers: new Set(ds.layers.filter((l) => l.id !== 'secondary' && l.id !== 'assumption').map((l) => l.id)),
    stackOf: (id) => bySubject.get(id) ?? [],
    specLayer: (id) => specLayers.get(id) ?? 'secondary',
    table: layerTable(ds.layers),
  }
}

function rolesOf(stack: readonly Assertion[], side: Side): Role[] {
  const named = new Set<Role>()
  for (const a of stack) a.applies_to.role?.forEach((r) => named.add(r))
  return [...new Set([...VIEW_ROLES[side], ...ALL_ROLES])].filter((r) => named.has(r))
}

function ctxOf(c: Ctx0, role: Role, variant: Flow['variant']): Ctx {
  return { role, asOf: c.asOf, layers: c.layers, ...variant }
}

/** Locator as a reader cites it, and a deep link where the spec has an anchor template. */
function locate(a: Assertion, spec: Spec | undefined): { at: string; url?: string } {
  const { req, section, at } = a.locator
  const label = section ? `§${section}` : (req ?? at ?? '')
  const url = section && spec?.anchor_template ? spec.anchor_template.replace('{section}', section) : spec?.source.url
  return url ? { at: label, url } : { at: label }
}

function subjectEntry(c: Ctx0, subject: Subject, side: Side, variant: Flow['variant']): BundleSubject {
  const stack = c.stackOf(subject.id)
  const named = rolesOf(stack, side)
  const roles: (Role | '*')[] = named.length > 0 ? named : ['*']
  const levels: BundleSubject['levels'] = {}
  const keep = new Map<string, { a: Assertion; decides: boolean }>()
  const specs = new Map(c.ds.specs.map((s) => [s.id, s]))
  for (const r of roles) {
    // A stack that names no role binds everyone; the side's own role stands in for "everyone".
    const rule = resolve(stack, ctxOf(c, r === '*' ? VIEW_ROLES[side][0]! : r, variant), c.table, c.specLayer)
    if (rule.level) levels[r] = rule.level
    for (const a of rule.decidedBy) keep.set(a.id, { a, decides: true })
    for (const a of [...rule.agreeing, ...rule.context]) if (!keep.has(a.id)) keep.set(a.id, { a, decides: false })
  }
  const rank = (a: Assertion) => c.table.get(c.specLayer(a.spec))?.rank ?? Number.POSITIVE_INFINITY
  const sources = [...keep.values()]
    .sort((x, y) => rank(x.a) - rank(y.a) || Number(y.decides) - Number(x.decides) || x.a.id.localeCompare(y.a.id))
    .map(({ a, decides }): SourceRef => {
      const loc = locate(a, specs.get(a.spec))
      return {
        spec: a.spec,
        ...loc,
        relation: a.relation,
        ...(a.level ? { level: a.level } : {}),
        ...(a.applies_to.role?.length ? { roles: a.applies_to.role } : {}),
        ...(decides ? { decides: true as const } : {}),
        ...(a.condition ? { condition: a.condition } : {}),
        ...(a.window?.from ? { from: a.window.from } : {}),
        ...(a.window?.until ? { until: a.window.until } : {}),
      }
    })
  const { transport: t, format: f } = variant
  const checks = subject.checks
    .filter((k) => (!k.transport || !t || k.transport.includes(t)) && (!k.format || !f || k.format.includes(f)))
    .map((k) => ({ field: k.field, expect: k.expect, ...(k.subject ? { subject: k.subject } : {}) }))
  return {
    title: subject.title,
    kind: subject.kind,
    ...(subject.location ? { location: subject.location } : {}),
    levels,
    sources,
    ...(checks.length ? { checks } : {}),
  }
}

/** The level a field chip shows: the sender's obligation if the stack binds the sender, else the first bound role. */
function levelFor(entry: BundleSubject, side: Side, sender?: Role): Level | undefined {
  if (sender && entry.levels[sender]) return entry.levels[sender]
  if (entry.levels['*']) return entry.levels['*']
  for (const r of [...VIEW_ROLES[side], ...ALL_ROLES]) if (entry.levels[r]) return entry.levels[r]
  return undefined
}

// Bundles -----------------------------------------------------------------------------------------------------------

export function buildFlowBundle(ds: Dataset, flowId: string, asOf: string): FlowBundle {
  const c = context(ds, asOf)
  const flow = ds.flows.find((f) => f.id === flowId)
  if (!flow) throw new Error(`unknown flow ${flowId}`)
  const side = flow.role
  const subjectById = new Map(ds.subjects.map((s) => [s.id, s]))
  const exampleById = new Map(ds.examples.map((e) => [e.id, e]))
  const roleOf = new Map(flow.participants.map((p) => [p.id, p.role]))
  const subjects: FlowBundle['subjects'] = {}
  const addSubject = (id: string) => {
    if (subjects[id]) return subjects[id]
    const s = subjectById.get(id)
    if (!s) throw new Error(`${flowId}: unknown subject ${id}`)
    subjects[id] = subjectEntry(c, s, side, flow.variant)
    for (const k of subjects[id].checks ?? []) if (k.subject) addSubject(k.subject)
    return subjects[id]
  }

  const examples: FlowBundle['examples'] = {}
  const steps = flow.steps.map((s) => {
    addSubject(s.subject)
    const ex = s.example ? exampleById.get(s.example) : undefined
    const senderId = ex?.kind === 'http-response' && s.kind === 'request' ? s.to : s.from
    const sender = ex ? roleOf.get(senderId) : undefined
    if (ex && !examples[ex.id]) {
      const enc = ds.encoded[ex.id]
      if (!enc) throw new Error(`${flowId}: example ${ex.id} is not built (pnpm examples:build)`)
      const view = viewOf(enc)
      const fields: BundleExample['fields'] = {}
      for (const ptr of ['/http/url', ...entryPointers(view)]) {
        const sid = annotationFor(ptr, ex.annotations, ds.fieldmap)
        if (!sid || !subjectById.has(sid)) continue
        const level = levelFor(addSubject(sid), side, sender)
        fields[ptr] = level ? { s: sid, level } : { s: sid }
      }
      examples[ex.id] = {
        title: ex.title,
        kind: ex.kind,
        view,
        ...(enc.cbor ? { cbor: enc.cbor } : {}),
        ...(enc.sdjwts ? { sdjwts: enc.sdjwts } : {}),
        fields,
      }
    }
    return {
      id: s.id,
      num: stepNumber(flow, s),
      ...(s.parent ? { parent: s.parent } : {}),
      from: s.from,
      to: s.to,
      kind: s.kind,
      label: s.label,
      tags: s.tags,
      subject: s.subject,
      ...(ex ? { example: ex.id } : {}),
      ...(sender ? { sender } : {}),
    }
  })

  return {
    id: flow.id,
    title: flow.title,
    role: side,
    variant: flow.variant,
    asOf,
    participants: flow.participants.map((p) => ({ id: p.id, label: p.label })),
    steps,
    examples,
    subjects: Object.fromEntries(Object.entries(subjects).sort(([a], [b]) => a.localeCompare(b))),
  }
}

/**
 * Spec names as the guide shows them. Readings confirmed into a layer and go-live compromises are maintained in
 * specs-navigator; the guide names them after the rule they settle and after the wallet solution that runs on them.
 */
export function specCatalog(ds: Dataset): Record<string, SpecCatalogEntry> {
  const layerShort: Partial<Record<LayerId, string>> = { cir: 'CIR', etsi: 'ETSI', haip: 'HAIP', base: 'Base protocol', golive: 'd-you' }
  const layerLabel = new Map(ds.layers.map((l) => [l.id, l.label]))
  const out: Record<string, SpecCatalogEntry> = {}
  for (const s of [...ds.specs].sort((a, b) => a.id.localeCompare(b.id))) {
    if (s.layer === 'assumption' || s.layer === 'secondary') continue
    if (s.id.startsWith('resolved-'))
      out[s.id] = { short: `${layerShort[s.layer] ?? s.short} reading`, title: `Confirmed reading of the ${layerLabel.get(s.layer)} rules`, version: s.version }
    else if (s.layer === 'golive')
      out[s.id] = { short: 'd-you go-live', title: 'Go-live compromise of the d-you wallet solution, valid for a limited period', version: s.version }
    else out[s.id] = { short: s.short, title: s.title, version: s.version, ...(s.source.url ? { url: s.source.url } : {}) }
  }
  return out
}

// Context files -------------------------------------------------------------------------------------------------------

/**
 * Text for an MDX-parsed .md file: outside code spans, bare URLs become code (they are identifier values, such as
 * https://self-issued.me/v2) and braces and angle brackets are escaped.
 */
export function mdxText(text: string): string {
  const esc: Record<string, string> = { '{': '\\{', '}': '\\}', '<': '&lt;', '>': '&gt;' }
  return text
    .trim()
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .split(/(https?:\/\/[^\s)<>{}]*[^\s)<>{}.,;:])/)
            .map((p, k) => (k % 2 ? `\`${p}\`` : p.replace(/[{}<>]/g, (ch) => esc[ch]!)))
            .join(''),
    )
    .join('')
}

/** File of a subject's description: grouped by the first id segment ("vci.par-request.scope" → "subjects/vci/par-request.scope.md"). */
export function subjectFile(id: string): string {
  const [head, ...rest] = id.split('.')
  return rest.length ? `subjects/${head}/${rest.join('.')}.md` : `subjects/${head}.md`
}

const topicSlug = (trackId: string, topicId: string) => topicId.replace(new RegExp(`^${trackId.replace(/-/g, '')}-`), '')

export interface ContextExport {
  /** docs/context-relative path → Markdown. */
  files: Record<string, string>
  /** docs/context/wiring/<name>.yaml → plain data, written as YAML by the caller. */
  wiring: { flows: unknown; examples: unknown; subjects: unknown; learning: unknown }
}

/** Steps that show a subject, for links from the learning path into a flow page. */
function stepsShowing(ds: Dataset, subjectId: string): { flow: string; step: string; label: string }[] {
  return ds.flows.flatMap((f) => f.steps.filter((s) => s.subject === subjectId).map((s) => ({ flow: f.id, step: s.id, label: s.label }))).slice(0, 3)
}

/** The guide writes no em dash: "Issuance — pre-authorized code flow" becomes "Issuance: pre-authorized code flow". */
export const plainTitle = (title: string) => title.replace(/\s*—\s*/g, ': ')

function link(url: string): { title?: string; to?: string; href?: string } {
  return url.startsWith(GUIDE_URL) ? { to: url.slice(GUIDE_URL.length) || '/' } : { href: url }
}

export function buildContext(ds: Dataset, bundles: FlowBundle[]): ContextExport {
  const files: Record<string, string> = {}
  const flows: Record<string, unknown> = {}
  const examples: Record<string, string> = {}
  const subjects: Record<string, string> = {}
  const subjectById = new Map(ds.subjects.map((s) => [s.id, s]))
  const exampleById = new Map(ds.examples.map((e) => [e.id, e]))
  const wireSubject = (id: string) => {
    const d = subjectById.get(id)?.description
    if (!d || subjects[id]) return
    subjects[id] = subjectFile(id)
    files[subjects[id]] = `${mdxText(d)}\n`
  }

  for (const b of bundles) {
    const flow = ds.flows.find((f) => f.id === b.id)!
    const steps: Record<string, string> = {}
    for (const s of flow.steps) {
      if (!s.note) continue
      steps[s.id] = `steps/${b.id}/${s.id}.md`
      files[steps[s.id]!] = `${mdxText(s.note)}\n`
    }
    files[`flows/${b.id}.md`] = `${mdxText(flow.summary)}\n`
    flows[b.id] = { title: plainTitle(b.title), path: `/${FLOW_DIR[b.role]}/${b.id}/`, intro: `flows/${b.id}.md`, ...(Object.keys(steps).length ? { steps } : {}) }
    for (const id of Object.keys(b.subjects)) wireSubject(id)
    for (const id of Object.keys(b.examples)) {
      const note = exampleById.get(id)?.note
      if (!note || examples[id]) continue
      examples[id] = `examples/${id}.md`
      files[examples[id]] = `${mdxText(note)}\n`
    }
  }

  const flowIds = new Set(bundles.map((b) => b.id))
  const learning: Record<string, unknown> = {}
  for (const t of [...ds.educate].sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order)) {
    const topics = t.topics.map((topic) => {
      const slug = topicSlug(t.id, topic.id)
      const answered = topic.questions.filter((q) => q.a)
      let text: string | undefined
      if (topic.summary || answered.length) {
        text = `learn/${t.id}/${slug}.md`
        const qa = answered.map((q) => `<details>\n<summary>${mdxText(q.q)}</summary>\n\n${mdxText(q.a!)}\n\n</details>`)
        files[text] = `${[topic.summary ? mdxText(topic.summary) : '', ...qa].filter(Boolean).join('\n\n')}\n`
      }
      for (const s of topic.subjects) wireSubject(s)
      const subtopics = topic.subtopics.map((sub) => {
        if (!sub.summary) return { title: sub.title }
        const file = `learn/${t.id}/${slug}/${sub.id.split('.').at(-1)}.md`
        files[file] = `${mdxText(sub.summary)}\n`
        return { title: sub.title, text: file }
      })
      const seen = new Set<string>()
      const steps = topic.subjects
        .flatMap((s) => stepsShowing(ds, s))
        .filter((s) => flowIds.has(s.flow) && !seen.has(`${s.flow}/${s.step}`) && seen.add(`${s.flow}/${s.step}`))
      return {
        id: topic.id,
        title: topic.title,
        ...(text ? { text } : {}),
        ...(topic.flows.length ? { flows: topic.flows.filter((f) => flowIds.has(f)) } : {}),
        ...(steps.length ? { steps } : {}),
        ...(topic.specs.length ? { specs: topic.specs.filter((s) => !s.startsWith('c2bo') && !s.startsWith('assumption')) } : {}),
        ...(topic.links.length ? { reading: topic.links.map((l) => ({ title: l.title, ...link(l.url) })) } : {}),
        ...(topic.related.length ? { related: topic.related } : {}),
        ...(subtopics.length ? { subtopics } : {}),
      }
    })
    if (t.summary) files[`learn/${t.id}.md`] = `${mdxText(t.summary)}\n`
    learning[t.id] = {
      code: t.code,
      title: t.title,
      group: t.group,
      path: `/${LEARN_DIR[t.group]}/${t.id}/`,
      ...(t.summary ? { intro: `learn/${t.id}.md` } : {}),
      ...(t.next.length ? { next: t.next } : {}),
      topics,
    }
  }

  const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
  return { files, wiring: { flows, examples: sorted(examples), subjects: sorted(subjects), learning } }
}

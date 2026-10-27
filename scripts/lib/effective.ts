// The effective API of one role, like an effective POM: every layer already resolved (d-you go-live compromises and
// assumptions included), provenance dropped, the contract left. Written as TypeScript declarations with fixed comment
// markers so that an agent (a technical writer, a code assistant) can load a whole role into its context and read it
// without a legend it has to learn. Deterministic: the same data gives the same file, so a git diff is the changelog.
// Local build only (pnpm effective); not part of the web app.
import type { Dataset, EncodedExample } from '../../src/model/dataset.ts'
import { annotationFor, entryPointers, escapeToken, viewOf, type ViewDocument } from '../../src/model/pointer.ts'
import { layerTable, resolve, timeline, type Ctx } from '../../src/model/resolve.ts'
import type { Assertion, Example, Flow, LayerId, Level, Role, Subject } from '../../src/model/schema.ts'
import { stepNumber } from '../../src/model/steps.ts'

export type Side = 'issuer' | 'verifier'

export interface EffectiveOptions {
  side: Side
  asOf: string
  layers: ReadonlySet<LayerId>
}

const ROOT: Record<Side, string> = { issuer: 'vci', verifier: 'vp' }
const TITLE: Record<Side, string> = {
  issuer: 'EAA provider API (credential issuer + authorization server), OpenID4VCI',
  verifier: 'Verifier API (relying party), OpenID4VP',
}
const ROLE_ORDER: Record<Side, Role[]> = {
  issuer: ['issuer', 'as', 'wallet', 'wallet-provider', 'verifier'],
  verifier: ['verifier', 'wallet', 'issuer', 'as', 'wallet-provider'],
}
const ROLE: Record<Role, string> = { wallet: 'Wallet', 'wallet-provider': 'WP', as: 'AS', issuer: 'Issuer', verifier: 'Verifier' }
const LEVEL: Record<Level, string> = { shall: 'MUST', should: 'SHOULD', may: 'MAY', 'should-not': 'SHOULD NOT', 'shall-not': 'MUST NOT', info: 'INFO' }

/**
 * Embedded JWT and CBOR items by their example name: the type they become and the role that produces them (`by` names
 * a producer outside the roles, e.g. the registrar; `producer` then is the role that passes the item on).
 */
const ITEMS: Record<string, { type: string; producer: Role; what: string; by?: string }> = {
  wia: { type: 'WalletInstanceAttestation', producer: 'wallet-provider', what: 'JWS' },
  pop: { type: 'ClientAttestationPoP', producer: 'wallet', what: 'JWS' },
  dpop: { type: 'DPoPProof', producer: 'wallet', what: 'JWS' },
  ka: { type: 'KeyAttestation', producer: 'wallet-provider', what: 'JWS' },
  proof: { type: 'ProofJwt', producer: 'wallet', what: 'JWS' },
  vc1: { type: 'IssuedCredential', producer: 'issuer', what: 'SD-JWT VC' },
  vc2: { type: 'IssuedCredential', producer: 'issuer', what: 'SD-JWT VC' },
  creq: { type: 'EncryptedCredentialRequest', producer: 'wallet', what: 'JWE' },
  cresp: { type: 'EncryptedCredentialResponse', producer: 'issuer', what: 'JWE' },
  rc: { type: 'RegistrationCertificate', producer: 'issuer', what: 'JWS', by: 'the registrar, served by the Issuer' },
  metadata: { type: 'SignedIssuerMetadata', producer: 'issuer', what: 'JWS' },
  slt: { type: 'StatusListToken', producer: 'issuer', what: 'JWS' },
  ro: { type: 'RequestObject', producer: 'verifier', what: 'JWS' },
  resp: { type: 'AuthorizationResponse', producer: 'wallet', what: 'JWE' },
  pid: { type: 'PresentedSdJwtVc', producer: 'issuer', what: 'SD-JWT VC' },
  // CBOR items are looked up as "cbor:<name>": an mdoc example may reuse a JWT name.
  'cbor:pid': { type: 'DeviceResponse', producer: 'wallet', what: 'CBOR' },
  'pid-kb': { type: 'KeyBindingJwt', producer: 'wallet', what: 'JWS' },
  'cbor:pid-session-transcript': { type: 'SessionTranscript', producer: 'wallet', what: 'CBOR' },
  'cbor:pid-handover-info': { type: 'OpenID4VPHandoverInfo', producer: 'wallet', what: 'CBOR' },
}

/** Keys that carry data, not a fixed name: rendered as an index signature named after what they hold. */
const DYNAMIC_KEYS: Record<string, string> = {
  'vci.metadata.ccs.id': 'credential_configuration_id',
  'vp.dcql.id': 'credential_query_id',
  'vp.mdoc.namespace': 'namespace',
}

// Shapes -----------------------------------------------------------------------------------------------------------

type Prim = 'string' | 'number' | 'boolean' | 'null' | 'bstr'
interface Shape {
  /** Subject the value is annotated with (the field's own rules). */
  subject: string | null
  prims: Set<Prim>
  literals: Set<string>
  /** Embedded item types this value encodes (a JWT, an SD-JWT, a CBOR item). */
  refs: Set<string>
  object: Map<string, Shape> | null
  /** Homogeneous array element. */
  items: Shape | null
  /** Positional array (a COSE_Sign1, a SessionTranscript). */
  tuple: Shape[] | null
  /** Data-carrying keys collapsed into one entry. */
  index: { name: string; shape: Shape } | null
  /** Flows the value was seen in. */
  flows: Set<string>
}

const emptyShape = (subject: string | null): Shape => ({
  subject,
  prims: new Set(),
  literals: new Set(),
  refs: new Set(),
  object: null,
  items: null,
  tuple: null,
  index: null,
  flows: new Set(),
})

function merge(a: Shape, b: Shape): Shape {
  a.subject ??= b.subject
  b.prims.forEach((p) => a.prims.add(p))
  b.literals.forEach((l) => a.literals.add(l))
  b.refs.forEach((r) => a.refs.add(r))
  b.flows.forEach((f) => a.flows.add(f))
  if (b.object) {
    a.object ??= new Map()
    for (const [k, v] of b.object) a.object.set(k, a.object.has(k) ? merge(a.object.get(k)!, v) : v)
  }
  if (b.items) a.items = a.items ? merge(a.items, b.items) : b.items
  if (b.tuple) a.tuple = a.tuple ? a.tuple.map((x, i) => (b.tuple![i] ? merge(x, b.tuple![i]!) : x)).concat(b.tuple.slice(a.tuple.length)) : b.tuple
  if (b.index) a.index = a.index ? { name: a.index.name, shape: merge(a.index.shape, b.index.shape) } : b.index
  return a
}

interface ItemSource {
  enc: EncodedExample
  ex: Example
  view: ViewDocument
  flow: string
  titles: ReadonlyMap<string, Subject>
  fieldmap: Dataset['fieldmap']
}

function refOf(value: string, src: ItemSource): string | null {
  for (const [name, c] of Object.entries(src.enc.jwts)) if (value === c || value.startsWith(`${c}~`)) return name
  for (const [name, c] of Object.entries(src.enc.cbor ?? {})) if (value === c.value) return `cbor:${name}`
  return null
}

function shapeOf(value: unknown, ptr: string, src: ItemSource): Shape {
  const subject = annotationFor(ptr, src.ex.annotations, src.fieldmap)
  const s = emptyShape(subject)
  s.flows.add(src.flow)
  if (Array.isArray(value)) {
    const els = value.map((v, i) => shapeOf(v, `${ptr}/${i}`, src))
    const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)
    const homogeneous = value.every((v) => kind(v) === kind(value[0])) && new Set(els.map((e) => e.subject)).size <= 1
    if (homogeneous) s.items = els.reduce((acc, e) => merge(acc, e), emptyShape(els[0]?.subject ?? null))
    else s.tuple = els
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const shapes = entries.map(([k, v]) => [k, shapeOf(v, `${ptr}/${escapeToken(k)}`, src)] as const)
    // A data-carrying key is one whose subject is dynamic and whose title does not name the key ("credentials[].id" names
    // the member id; "pid-sd-jwt" in a vp_token is a query id).
    const dyn = shapes.find(([k, sh]) => sh.subject && DYNAMIC_KEYS[sh.subject] && !src.titles.get(sh.subject)?.title.includes(k))
    // Digest maps ({ 4: h'…', 7: h'…' }): numeric keys that all mean the same thing.
    const numericMap = shapes.length > 2 && shapes.every(([k, sh]) => /^\d+$/.test(k) && sh.subject === shapes[0]![1].subject)
    if (dyn) {
      const isDyn = ([k, sh]: readonly [string, Shape]) => sh.subject === dyn[1].subject && !src.titles.get(sh.subject!)?.title.includes(k)
      const rest = shapes.filter((e) => !isDyn(e))
      s.index = { name: DYNAMIC_KEYS[dyn[1].subject!]!, shape: shapes.filter(isDyn).reduce((acc, [, sh]) => merge(acc, sh), emptyShape(dyn[1].subject)) }
      if (rest.length) s.object = new Map(rest)
    } else if (numericMap) {
      s.index = { name: 'digestID: number', shape: shapes.reduce((acc, [, sh]) => merge(acc, sh), emptyShape(shapes[0]![1].subject)) }
    } else s.object = new Map(shapes)
  } else if (typeof value === 'string') {
    const ref = refOf(value, src)
    if (ref) s.refs.add(ITEMS[ref]?.type ?? pascal(ref))
    else if (/^h'[0-9a-f]*'$/.test(value)) s.prims.add('bstr')
    else {
      s.prims.add('string')
      // A title "typ = kb+jwt" fixes the value; elsewhere a string is only an example.
      const fixed = subject ? src.titles.get(subject)?.title.match(/^\S+ = (\S+)$/)?.[1] : undefined
      if (fixed && fixed === value) s.literals.add(value)
    }
  } else if (value === null) s.prims.add('null')
  else s.prims.add(typeof value === 'number' ? 'number' : 'boolean')
  return s
}

/** The Disclosures of an SD-JWT: [salt, claim name, claim value] each (RFC 9901 §4.2.1); the value can be any JSON. */
function disclosuresShape(ptr: string, src: ItemSource): Shape {
  const el = (prim?: Prim) => {
    const e = emptyShape(null)
    if (prim) e.prims.add(prim)
    e.flows.add(src.flow)
    return e
  }
  const s = el()
  s.subject = annotationFor(ptr, src.ex.annotations, src.fieldmap)
  s.items = el()
  s.items.tuple = [el('string'), el('string'), el()]
  return s
}

function pascal(s: string): string {
  return s.replace(/(^|[^a-z0-9]+)([a-z0-9])/gi, (_, __, c: string) => c.toUpperCase())
}

// Rules ------------------------------------------------------------------------------------------------------------

interface RoleRule {
  role: Role
  level: Level | null
  unsettled: boolean
  condition?: string
  quotes: string[]
  until?: { date: string; level: Level | null }
}
interface Variant {
  flows: string[]
  rules: RoleRule[]
}

export interface EffectiveApi {
  side: Side
  text: string
  examples: unknown
  /** Every subject the text states, for the coverage test. */
  covered: Set<string>
}

export function buildEffectiveApi(ds: Dataset, opts: EffectiveOptions): EffectiveApi {
  const table = layerTable(ds.layers)
  const specs = new Map(ds.specs.map((s) => [s.id, s]))
  const specLayer = (id: string): LayerId => specs.get(id)?.layer ?? 'secondary'
  const subjects = new Map(ds.subjects.map((s) => [s.id, s]))
  const examples = new Map(ds.examples.map((e) => [e.id, e]))
  const bySubject = new Map<string, Assertion[]>()
  for (const a of ds.assertions) bySubject.set(a.subject, [...(bySubject.get(a.subject) ?? []), a])
  const stackOf = (id: string) => bySubject.get(id) ?? []
  const root = ROOT[opts.side]
  const rootOf = (id: string): string => {
    let s = subjects.get(id)
    while (s?.parent) s = subjects.get(s.parent)
    return s?.id ?? id.split('.')[0]!
  }
  const flows = ds.flows.filter((f) => f.role === opts.side).sort((a, b) => a.order - b.order)
  const allFlowIds = flows.map((f) => f.id)
  const code = (flowId: string) => flowId.replace(/^(vp|vci)-/, '')
  const covered = new Set<string>()
  /** "only a, b" or, when shorter, "except c". */
  const flowScope = (inFlows: readonly string[], of: readonly string[]) => {
    const out = of.filter((f) => !inFlows.includes(f))
    return out.length < inFlows.length ? `except ${out.map(code).join(', ')}` : `only ${inFlows.map(code).join(', ')}`
  }

  function rolesFor(stack: readonly Assertion[], producer?: Role): Role[] {
    const named = new Set<Role>()
    for (const a of stack) a.applies_to.role?.forEach((r) => named.add(r))
    const roles = ROLE_ORDER[opts.side].filter((r) => named.has(r))
    return roles.length ? roles : producer ? [producer] : []
  }

  function roleRule(stack: readonly Assertion[], role: Role, variant: Partial<Ctx>): RoleRule | null {
    const ctx: Ctx = { role, asOf: opts.asOf, layers: opts.layers, ...variant }
    const rule = resolve(stack, ctx, table, specLayer)
    if (rule.level === null && rule.status === 'undecided') return null
    let prev = rule.level
    const next = timeline(stack, ctx, table, specLayer)
      .slice(1)
      .find((t) => {
        const changed = t.rule.level !== prev
        prev = t.rule.level
        return changed
      })
    const cond = rule.decidedBy.find((a) => a.condition)?.condition
    return {
      role,
      level: rule.level,
      unsettled: rule.status === 'conflict' || rule.status === 'needs-review',
      ...(cond ? { condition: cond } : {}),
      quotes: [...new Set(rule.decidedBy.map((a) => (a.quote ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))],
      ...(next ? { until: { date: next.from, level: next.rule.level } } : {}),
    }
  }

  /** One rule set per flow the subject appears in; flows that agree are merged. */
  function variants(subjectId: string, flowIds: readonly string[], producer?: Role): Variant[] {
    const stack = stackOf(subjectId)
    if (!stack.length) return []
    const ctxs = flowIds.length ? flowIds.map((id) => flows.find((f) => f.id === id)) : [undefined]
    const out: (Variant & { key: string })[] = []
    for (const f of ctxs) {
      const rules = rolesFor(stack, producer).flatMap((r) => roleRule(stack, r, (f?.variant ?? {}) as Partial<Ctx>) ?? [])
      const key = JSON.stringify(rules)
      const same = out.find((o) => o.key === key)
      if (same) same.flows.push(...(f ? [f.id] : []))
      else out.push({ key, flows: f ? [f.id] : [], rules })
    }
    const kept = out.filter((v) => v.rules.length)
    return kept.map(({ key: _k, ...v }) => ({ ...v, flows: kept.length === 1 && out.length === 1 ? [] : v.flows }))
  }

  // Rule wording used more than once is printed once at the end and referenced as [R<n>].
  const quoteUse = new Map<string, number>()
  const described = new Set<string>()

  function oneLine(s: string): string {
    return s.replace(/\s+/g, ' ').replace(/\*\//g, '* /').trim()
  }
  function conditionText(s: string): string {
    const t = oneLine(s).replace(/\.$/, '')
    return /^(if|when|where|whenever|unless|only|for|in|during|after|before|once)\b/i.test(t) ? t[0]!.toLowerCase() + t.slice(1) : `if ${t}`
  }

  /** "MUST if … · Wallet: MUST (until …) · R: …" for one variant. */
  function ruleText(v: Variant, producer: Role | undefined, quotes: string[][]): string {
    // The producer's own level first, without a role name; every other role named.
    const ordered = [...v.rules.filter((r) => r.role === producer), ...v.rules.filter((r) => r.role !== producer)]
    const parts = ordered.map((r) => {
      const who = r.role === producer ? '' : `${ROLE[r.role]}: `
      const lvl = r.level ? LEVEL[r.level] : 'no level'
      const cond = r.condition ? ` ${conditionText(r.condition)}` : ''
      const until = r.until ? ` (until ${r.until.date}, then ${r.until.level ? LEVEL[r.until.level] : 'no rule'})` : ''
      quotes.push(r.quotes)
      return `${who}${lvl}${cond}${until}${r.unsettled ? ' ⚠' : ''}`
    })
    return parts.join('; ')
  }

  /** The trailing comment of a field: rules per flow, description at first mention, then the binding wording. */
  function comment(subjectId: string | null, flowIds: readonly string[], producer: Role | undefined, typeFlows: readonly string[]): { text: string; required: boolean; never: boolean } {
    if (!subjectId) return { text: 'no rule', required: false, never: false }
    covered.add(subjectId)
    const vs = variants(subjectId, flowIds, producer)
    const s = subjects.get(subjectId)
    const quotes: string[][] = []
    const only = flowIds.length && typeFlows.length && flowIds.length < typeFlows.length ? `${flowScope(flowIds, typeFlows)}: ` : ''
    const rules = vs.length
      ? vs.map((v) => `${v.flows.length && vs.length > 1 ? `${v.flows.map(code).join(', ')}: ` : ''}${ruleText(v, producer, quotes)}`).join(' | ')
      : 'no rule'
    const desc = s?.description && !described.has(subjectId) ? ` · ${oneLine(s.description)}` : ''
    if (s?.description) described.add(subjectId)
    const words = [...new Set(quotes.flat())]
    for (const q of words) quoteUse.set(q, (quoteUse.get(q) ?? 0) + 1)
    const prod = vs.flatMap((v) => v.rules.filter((r) => r.role === producer))
    const required = vs.length > 0 && prod.length === vs.length && prod.every((r) => r.level === 'shall' && !r.condition)
    const never = vs.length > 0 && prod.length === vs.length && prod.every((r) => r.level === 'shall-not' && !r.condition)
    return { text: `${only}${rules}${desc}${words.map((q) => ` \u0001${q}\u0002`).join('')}`, required, never }
  }

  // Render a shape as a TypeScript type. Comments carry the rules; the quotes are resolved to [R<n>] or inline later.
  function typeOf(sh: Shape, indent: string, producer: Role | undefined, typeFlows: readonly string[]): string {
    const alts: string[] = []
    if (sh.literals.size) alts.push(...[...sh.literals].map((l) => JSON.stringify(l)))
    const prims = [...sh.prims].filter((p) => !(p === 'string' && sh.literals.size))
    alts.push(...prims)
    alts.push(...sh.refs)
    if (sh.object || sh.index) alts.push(objectType(sh, indent, producer, typeFlows))
    if (sh.items) alts.push(`${wrap(typeOf(sh.items, indent, producer, typeFlows))}[]`)
    if (sh.tuple) alts.push(`[${sh.tuple.map((t, i) => `${typeOf(t, indent, producer, typeFlows)}${t.subject && t.subject !== sh.subject ? ` /* ${i}: ${fieldTitle(t.subject)} */` : ''}`).join(', ')}]`)
    return alts.length ? [...new Set(alts)].join(' | ') : 'unknown'
  }
  const wrap = (t: string) => (/[|\s]/.test(t) && !/^[{[]/.test(t) ? `(${t})` : t)
  const fieldTitle = (id: string) => oneLine(subjects.get(id)?.title ?? id)

  function objectType(sh: Shape, indent: string, producer: Role | undefined, typeFlows: readonly string[]): string {
    const inner = `${indent}  `
    const lines: string[] = []
    for (const [k, v] of sh.object ?? []) lines.push(...member(k, v, inner, producer, typeFlows))
    if (sh.index) lines.push(...member(`[${sh.index.name.includes(':') ? sh.index.name : `${sh.index.name}: string`}]`, sh.index.shape, inner, producer, typeFlows, true))
    return `{\n${lines.join('\n')}\n${indent}}`
  }

  function member(key: string, v: Shape, indent: string, producer: Role | undefined, typeFlows: readonly string[], raw = false): string[] {
    const flowIds = allFlowIds.filter((f) => v.flows.has(f))
    // A structural container (HTTP headers, body, JWT header and payload) has no subject of its own: it is part of the
    // message format, so it is present and carries no rule.
    const c = v.subject ? comment(v.subject, flowIds, producer, typeFlows) : { text: '', required: true, never: false }
    const name = raw ? key : /^[A-Za-z_$][\w$]*$/.test(key) || /^\d+$/.test(key) ? key : JSON.stringify(key)
    const opt = raw || c.required ? '' : '?'
    const type = c.never ? 'never' : typeOf(v, indent, producer, typeFlows)
    const note = c.text ? ` // ${c.text}` : ''
    const [first, ...rest] = type.split('\n')
    return [`${indent}${name}${opt}: ${first}${note}`, ...rest]
  }

  // Groups: one per step subject, in reading order across the role's flows ---------------------------------------
  interface Group {
    subject: Subject
    steps: { flow: Flow; n: string; from: string; to: string; label: string; fromRole?: Role; toRole?: Role }[]
    envelope: Shape | null
    items: string[]
    checks: { field: string; expect: string; flows: Set<string> }[]
  }
  const groups = new Map<string, Group>()
  /** Embedded item type → shape and the flows it travels in; the first group that shows it defines it. */
  const items = new Map<string, { shape: Shape; producer: Role; what: string; by?: string; home: string; flows: Set<string> }>()
  const exampleRefs: { type: string; flow: string; step: string; example: string }[] = []
  const reached = new Set<string>()

  for (const flow of flows) {
    for (const step of flow.steps) {
      const subj = subjects.get(step.subject)
      if (!subj) continue
      const roleOf = (p: string) => flow.participants.find((x) => x.id === p)?.role as Role | undefined
      const label = (p: string) => flow.participants.find((x) => x.id === p)?.label ?? p
      let g = groups.get(subj.id)
      if (!g) {
        g = { subject: subj, steps: [], envelope: null, items: [], checks: [] }
        groups.set(subj.id, g)
      }
      g.steps.push({ flow, n: stepNumber(flow, step), from: label(step.from), to: label(step.to), label: step.label, fromRole: roleOf(step.from), toRole: roleOf(step.to) })
      reached.add(subj.id)
      for (const c of subj.checks) {
        const { transport: t, format: f } = flow.variant
        if ((c.transport && t && !c.transport.includes(t)) || (c.format && f && !c.format.includes(f))) continue
        const have = g.checks.find((x) => x.field === c.field && x.expect === c.expect)
        if (have) have.flows.add(flow.id)
        else g.checks.push({ field: c.field, expect: c.expect, flows: new Set([flow.id]) })
        if (c.subject) covered.add(c.subject)
      }
      const ex = step.example ? examples.get(step.example) : undefined
      const enc = ex ? ds.encoded[ex.id] : undefined
      if (!ex || !enc) continue
      const view = viewOf(enc)
      const src: ItemSource = { enc, ex, view, flow: flow.id, titles: subjects, fieldmap: ds.fieldmap }
      for (const p of entryPointers(view)) {
        const sid = annotationFor(p, ex.annotations, ds.fieldmap)
        if (sid) reached.add(sid)
      }
      exampleRefs.push({ type: subj.id, flow: flow.id, step: stepNumber(flow, step), example: ex.id })
      // The envelope: what travels on the wire (HTTP headers, query, body) or the JSON document itself.
      const env = emptyShape(null)
      env.object = new Map()
      env.flows.add(flow.id)
      if (view.http?.headers && Object.keys(view.http.headers).length) env.object.set('headers', shapeOf(view.http.headers, '/http/headers', src))
      if (view.http?.query) env.object.set('query', shapeOf(view.http.query, '/http/query', src))
      if (view.http?.body !== undefined) env.object.set('body', shapeOf(view.http.body, '/http/body', src))
      if (view.json !== undefined) env.object.set('body', shapeOf(view.json, '/json', src))
      if (env.object.size) g.envelope = g.envelope ? merge(g.envelope, env) : env
      for (const [name, j] of Object.entries(view.jwt)) {
        const meta = ITEMS[name] ?? { type: pascal(name), producer: roleOf(step.from) ?? 'wallet', what: 'JWS' }
        const sh = emptyShape(null)
        sh.object = new Map([
          ['header', shapeOf(j.header, `/jwt/${escapeToken(name)}/header`, src)],
          ['payload', shapeOf(j.payload, `/jwt/${escapeToken(name)}/payload`, src)],
        ])
        if (j.disclosures) sh.object.set('disclosures', disclosuresShape(`/jwt/${escapeToken(name)}/disclosures`, src))
        sh.flows.add(flow.id)
        addItem(meta, sh, subj.id, flow.id, g)
      }
      for (const [name, c] of Object.entries(view.cbor ?? {})) {
        const meta = ITEMS[`cbor:${name}`] ?? { type: pascal(name), producer: roleOf(step.from) ?? 'wallet', what: 'CBOR' }
        const sh = shapeOf(c, `/cbor/${escapeToken(name)}`, src)
        addItem({ ...meta, what: enc.cbor?.[name]?.label ?? meta.what }, sh, subj.id, flow.id, g)
      }
    }
  }
  function addItem(meta: { type: string; producer: Role; what: string; by?: string }, sh: Shape, home: string, flow: string, g: Group) {
    const have = items.get(meta.type)
    if (have) {
      merge(have.shape, sh)
      have.flows.add(flow)
    } else items.set(meta.type, { shape: sh, producer: meta.producer, what: meta.what, by: meta.by, home, flows: new Set([flow]) })
    if (!g.items.includes(meta.type)) g.items.push(meta.type)
  }

  // Rules with no place in a message: under the nearest step that is shown, else role-wide obligations.
  const attached = new Map<string, Subject[]>()
  const roleWide: Subject[] = []
  for (const s of ds.subjects) {
    if (reached.has(s.id) || s.kind === 'flow' || rootOf(s.id) !== root || stackOf(s.id).length === 0) continue
    let p = s.parent ? subjects.get(s.parent) : undefined
    while (p && !groups.has(p.id)) p = p.parent ? subjects.get(p.parent) : undefined
    if (p) attached.set(p.id, [...(attached.get(p.id) ?? []), s])
    else roleWide.push(s)
  }

  // Text ---------------------------------------------------------------------------------------------------------
  const typeName = (g: Group) => {
    const [head, ...rest] = g.subject.id.split('.')
    // A message of the other protocol (the OpenID4VP request nested into issuance) keeps its prefix: VpAuthorizationRequest.
    const base = pascal([...(head === root ? [] : [head!]), ...rest].join('-'))
    return items.has(base) ? `${base}Message` : base
  }
  const L: string[] = []
  const flowsOf = (g: Group) => [...new Set(g.steps.map((s) => s.flow.id))]
  const stepsText = (g: Group) => {
    const fl = flowsOf(g)
    const ns = new Set(g.steps.map((s) => s.n))
    return fl.length === allFlowIds.length && ns.size === 1 ? `step ${[...ns][0]} in every flow` : `steps ${g.steps.map((s) => `${code(s.flow.id)} ${s.n}`).join(', ')}`
  }

  function obligation(s: Subject, indent: string, flowIds: readonly string[]): string {
    const c = comment(s.id, flowIds, undefined, [])
    return `${indent}- ${oneLine(s.title)}: ${c.text}`
  }

  for (const g of groups.values()) {
    const fl = flowsOf(g)
    const first = g.steps[0]!
    const producer = first.fromRole
    const head = [`${first.from} → ${first.to}`]
    if (g.subject.endpoint) head.unshift(`${g.subject.endpoint.method} ${g.subject.endpoint.path}`)
    head.push(stepsText(g))
    const desc = g.subject.description ? ` ${oneLine(g.subject.description)}` : ''
    L.push('', `// ── ${oneLine(g.subject.title)} ── ${head.join(' · ')}`)
    if (desc) L.push(`//${desc}`)
    covered.add(g.subject.id)
    const own = variants(g.subject.id, fl, producer)
    if (own.length) {
      const q: string[][] = []
      const txt = own.map((v) => `${v.flows.length && own.length > 1 ? `${v.flows.map(code).join(', ')}: ` : ''}${ruleText(v, undefined, q)}`).join(' | ')
      const words = [...new Set(q.flat())]
      words.forEach((w) => quoteUse.set(w, (quoteUse.get(w) ?? 0) + 1))
      L.push(`// rule: ${txt}${words.map((w) => ` \u0001${w}\u0002`).join('')}`)
    }
    if (g.envelope?.object?.size) {
      L.push(`export interface ${typeName(g)} ${objectType(g.envelope, '', producer, fl)}`)
    }
    for (const t of g.items) {
      const it = items.get(t)!
      if (it.home !== g.subject.id) continue
      L.push(`/** ${it.what}, produced by ${it.by ?? ROLE[it.producer]}. */`)
      L.push(`export type ${t} = ${typeOf(it.shape, '', it.producer, allFlowIds.filter((f) => it.flows.has(f)))}`)
    }
    const elsewhere = g.items.filter((t) => items.get(t)!.home !== g.subject.id)
    if (elsewhere.length) L.push(`// carries ${elsewhere.map((t) => `${t} (defined at ${oneLine(groups.get(items.get(t)!.home)!.subject.title)})`).join(', ')}`)
    for (const c of g.checks) {
      const only = c.flows.size < fl.length ? ` [${flowScope([...c.flows], fl)}]` : ''
      L.push(`// check ${oneLine(c.field)}${only}: ${oneLine(c.expect)}`)
    }
    const extra = attached.get(g.subject.id) ?? []
    if (extra.length) {
      L.push('// also:')
      for (const s of extra) L.push(obligation(s, '//   ', fl))
    }
  }

  if (roleWide.length) {
    L.push('', '// ── Role-wide obligations (all flows) ──')
    for (const s of roleWide) L.push(obligation(s, '// ', []))
  }

  // Resolve the rule wording: inline when used once, else numbered once at the end.
  const refs = new Map<string, number>()
  let body = L.join('\n').replace(/ \u0001([^\u0002]*)\u0002/g, (_, q: string) => {
    if ((quoteUse.get(q) ?? 0) < 2) return ` · "${oneLine(q)}"`
    if (!refs.has(q)) refs.set(q, refs.size + 1)
    return ` [R${refs.get(q)}]`
  })
  // Collapse repeated references on one line ("[R3] [R3]").
  body = body.replace(/(\[R\d+\])(?: \1)+/g, '$1')

  const head: string[] = [
    `// ${TITLE[opts.side]} · effective contract`,
    `// State: d-you (go-live compromises and assumptions applied) as of ${opts.asOf}. Generated by specs-navigator (pnpm effective); do not edit.`,
    '//',
    '// HOW TO READ (binding for every reader, human or agent)',
    '// - One exported type per message or embedded token, in flow order. A type is a contract, not an example.',
    '// - The trailing comment of a field states its rules: LEVEL for the role that produces the message, "Role: LEVEL" for',
    '//   any other role (e.g. what the receiver must check). Levels: MUST, SHOULD, MAY, SHOULD NOT, MUST NOT.',
    '// - "?" marks a field the producer is not unconditionally required to send; the comment says whether it is SHOULD,',
    '//   MAY or conditional ("MUST if …"). A field typed `never` must not be sent.',
    '// - "only <flows>:" the field exists only in those flows. "a, b: … | c: …" the rule differs per flow.',
    '// - "(until D, then X)" the rule applies today and changes on date D. ⚠ the rule is not settled yet.',
    '// - Quoted text and [R<n>] (see RULE WORDING at the end) are the exact binding wording. Literal types are fixed',
    '//   values; other types say nothing about the value. "no rule": the field occurs, but nothing constrains it.',
    '// - Do not add rules that are not written here, and do not soften or strengthen a level.',
    '// Roles: Wallet = wallet unit, WP = wallet provider, AS = authorization server, Issuer = credential issuer, Verifier =',
    '// relying party. Encodings: JWS = compact JWS with this header and payload; SD-JWT VC = issuer JWS ~ disclosures ~',
    '// [key binding JWT]; JWE = compact JWE whose decrypted header and payload are given; bstr = CBOR byte string.',
    '',
    '// FLOWS',
  ]
  for (const f of flows) {
    head.push(`// ${code(f.id)}: ${oneLine(f.title)}. ${oneLine(f.summary)}`)
    for (const st of f.steps) {
      const g = groups.get(st.subject)!
      const part = (p: string) => f.participants.find((x) => x.id === p)?.label ?? p
      const target = g.envelope?.object?.size ? typeName(g) : g.items.find((t) => items.get(t)!.home === g.subject.id)
      const who = st.from === st.to ? part(st.from) : `${part(st.from)} → ${part(st.to)}`
      head.push(`//   ${stepNumber(f, st)} ${who}: ${oneLine(st.label)}${target ? ` → ${target}` : ''}`)
    }
  }
  const tail = refs.size ? ['', '// RULE WORDING', ...[...refs].map(([q, n]) => `// [R${n}] "${oneLine(q)}"`)] : []

  const exampleDoc = {
    side: opts.side,
    asOf: opts.asOf,
    note: 'Decoded example messages for the types in the effective API (signed with test keys; values are illustrative).',
    messages: exampleRefs.map((r) => {
      const g = groups.get(r.type)!
      const v = viewOf(ds.encoded[r.example]!)
      return {
        type: g.envelope?.object?.size ? typeName(g) : (g.items[0] ?? typeName(g)),
        flow: code(r.flow),
        step: r.step,
        ...(v.http ? { http: v.http } : {}),
        ...(v.json !== undefined ? { json: v.json } : {}),
        ...(Object.keys(v.jwt).length
          ? { tokens: Object.fromEntries(Object.entries(v.jwt).map(([n, j]) => [ITEMS[n]?.type ?? pascal(n), { header: j.header, payload: j.payload, ...(j.disclosures ? { disclosures: j.disclosures } : {}) }])) }
          : {}),
        ...(v.cbor ? { cbor: Object.fromEntries(Object.entries(v.cbor).map(([n, c]) => [ITEMS[`cbor:${n}`]?.type ?? pascal(n), c])) } : {}),
      }
    }),
  }

  if (/\bbstr\b/.test(body)) head.push('', 'type bstr = string // CBOR byte string, shown as hex')
  const text = `${head.join('\n')}\n${body}\n${tail.join('\n')}\n`
  return { side: opts.side, text, examples: exampleDoc, covered }
}

export const EFFECTIVE_FILES: Record<Side, string> = { issuer: 'eaa-provider', verifier: 'verifier' }

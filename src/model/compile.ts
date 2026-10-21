// Compiled implementer reference: the effective rules of one side (EAA issuance or VP presentation) stripped of their
// provenance stacks, one row per field or obligation, for a developer guide. Pure: used by the app (download) and by
// the build script. The stack stays one click away through the deep link on every row.
import type { Dataset } from './dataset'
import { annotationFor, entryPointers, lookup, splitPointer, viewOf } from './pointer'
import { layerTable, levelLabel, resolve, timeline, type Ctx, type EffectiveRule, type Status } from './resolve'
import type { Assertion, Flow, LayerId, Level, Role, Step, Subject } from './schema'
import { stepNumber } from './steps'

export type Side = 'issuer' | 'verifier'

export interface CompileOptions {
  side: Side
  asOf: string
  layers: ReadonlySet<LayerId>
  /** Base URL of the deployed navigator, for the deep link on every row. */
  linkBase?: string
}

/** The deciding statement of a rule, reduced to what a reader needs to look it up. */
export interface Basis {
  assertion: string
  spec: string
  layer: LayerId
  locator: string
  condition?: string
}

/** The obligation one role has for one subject. */
export interface RoleRule {
  role: Role
  level: Level | null
  status: Status
  by: Basis[]
  /** Why a contributing statement needs review, or which statements conflict. */
  issues: string[]
  /** Later dates at which the rule changes (a go-live window opens or closes). */
  changes: { from: string; level: Level | null; by: string[] }[]
}

/** The rules of one subject in one flow variant (or in all, when they agree). */
export interface VariantRule {
  /** Flows this rule holds in; empty = every flow the subject appears in. */
  flows: string[]
  rules: RoleRule[]
}

export interface CompiledEntry {
  subject: string
  title: string
  kind: Subject['kind']
  /** Where the field sits in the example, e.g. "body.grant_type" or "wia.payload.cnf.jwk". */
  path?: string
  location?: Subject['location']
  example?: string
  description?: string
  variants: VariantRule[]
  link: string
}

export interface CompiledGroup {
  /** The step subject: a message, object, endpoint or processing step. */
  subject: string
  title: string
  kind: Subject['kind']
  endpoint?: { method: string; path: string; server: string }
  /** Step numbers in each flow, e.g. { "vp-redirect-same": "5" }. */
  steps: Record<string, string>
  from?: string
  to?: string
  description?: string
  rule: VariantRule[]
  entries: CompiledEntry[]
  checks: { field: string; expect: string; subject?: string; flows: string[] }[]
  /** Embedded JWTs whose fields an earlier step already lists (the WIA in PAR and token request): name → that step. */
  see: { jwt: string; group: string }[]
  link: string
}

export interface CompiledFlow {
  id: string
  title: string
  summary: string
  variant: Flow['variant']
  participants: { id: string; label: string }[]
  steps: { n: string; from: string; to: string; kind: Step['kind']; label: string; group: string }[]
}

export interface CompiledProfile {
  side: Side
  title: string
  asOf: string
  layers: LayerId[]
  generated: string
  specs: { id: string; short: string; version: string; layer: LayerId }[]
  flows: CompiledFlow[]
  groups: CompiledGroup[]
  /** Rules on the side that no flow step reaches: grant support, DPoP, PKCE, … */
  crossCutting: CompiledEntry[]
  /** Rules that change after asOf. */
  changes: { subject: string; title: string; role: Role; date: string; from: string; to: string; by: string[]; link: string }[]
  /** Rules that are not settled: conflict, needs review, or a field without a deciding statement. */
  open: { subject: string; title: string; role: Role; status: Status; issues: string[]; link: string }[]
}

const ROOT_OF: Record<Side, string> = { issuer: 'vci', verifier: 'vp' }
const TITLE: Record<Side, string> = {
  issuer: 'EAA issuance (OpenID4VCI): compiled implementer reference',
  verifier: 'VP presentation (OpenID4VP): compiled implementer reference',
}
const ROLE_ORDER: Record<Side, Role[]> = {
  issuer: ['issuer', 'as', 'wallet', 'wallet-provider', 'verifier'],
  verifier: ['verifier', 'wallet', 'issuer', 'as', 'wallet-provider'],
}

export function compileProfile(ds: Dataset, opts: CompileOptions): CompiledProfile {
  const table = layerTable(ds.layers)
  const specs = new Map(ds.specs.map((s) => [s.id, s]))
  const specLayer = (id: string): LayerId => specs.get(id)?.layer ?? 'secondary'
  const subjects = new Map(ds.subjects.map((s) => [s.id, s]))
  const examples = new Map(ds.examples.map((e) => [e.id, e]))
  const bySubject = new Map<string, Assertion[]>()
  for (const a of ds.assertions) bySubject.set(a.subject, [...(bySubject.get(a.subject) ?? []), a])
  const stackOf = (id: string) => bySubject.get(id) ?? []
  const link = (id: string) => `${opts.linkBase ?? ''}#/subject/${encodeURIComponent(id)}`
  const root = ROOT_OF[opts.side]
  const rootOf = (id: string): string => {
    let s = subjects.get(id)
    while (s?.parent) s = subjects.get(s.parent)
    return s?.id ?? id.split('.')[0]!
  }
  const flows = ds.flows.filter((f) => f.role === opts.side).sort((a, b) => a.order - b.order)

  function basis(a: Assertion): Basis {
    const l = a.locator
    return {
      assertion: a.id,
      spec: specs.get(a.spec)?.short ?? a.spec,
      layer: specLayer(a.spec),
      locator: l.req ?? (l.section ? `§${l.section}` : (l.at ?? '')),
      ...(a.condition ? { condition: a.condition } : {}),
    }
  }

  // Roles the stack names, in this side's order; a stack that names none binds the sender of the message.
  function rolesFor(stack: readonly Assertion[], sender?: Role): Role[] {
    const named = new Set<Role>()
    for (const a of stack) a.applies_to.role?.forEach((r) => named.add(r))
    const roles = ROLE_ORDER[opts.side].filter((r) => named.has(r))
    return roles.length ? roles : sender ? [sender] : []
  }

  function roleRule(stack: readonly Assertion[], role: Role, variant: Partial<Ctx>): RoleRule | null {
    const ctx: Ctx = { role, asOf: opts.asOf, layers: opts.layers, ...variant }
    const rule: EffectiveRule = resolve(stack, ctx, table, specLayer)
    if (rule.level === null && rule.status === 'undecided') return null
    const changes = timeline(stack, ctx, table, specLayer)
      .slice(1)
      .map((t) => ({ from: t.from, level: t.rule.level, by: t.rule.decidedBy.map((a) => a.id) }))
    return {
      role,
      level: rule.level,
      status: rule.status,
      by: rule.decidedBy.map(basis),
      issues: [...rule.conflicts.map((c) => c.reason), ...rule.reviews.map((r) => r.reason)],
      changes,
    }
  }

  // One rule set per flow; flows that agree are merged, so a field that behaves the same everywhere has one row.
  function variantRules(subjectId: string, uses: { flow: Flow; sender?: Role }[]): VariantRule[] {
    const stack = stackOf(subjectId)
    if (stack.length === 0) return []
    const contexts = uses.length ? uses : [{ flow: undefined, sender: undefined }]
    const out: (VariantRule & { key: string })[] = []
    for (const u of contexts) {
      const variant = (u.flow?.variant ?? {}) as Partial<Ctx>
      const rules = rolesFor(stack, u.sender).flatMap((r) => roleRule(stack, r, variant) ?? [])
      const key = JSON.stringify(rules)
      const same = out.find((o) => o.key === key)
      if (same) same.flows.push(...(u.flow ? [u.flow.id] : []))
      else out.push({ key, flows: u.flow ? [u.flow.id] : [], rules })
    }
    // A flow in which no role has a rule drops out; the others then name their flows.
    const all = out.length === 1
    return out.filter((v) => v.rules.length).map(({ key: _key, ...v }) => ({ ...v, flows: all ? [] : v.flows }))
  }

  const roleOf = (flow: Flow, participant: string) => flow.participants.find((p) => p.id === participant)?.role as Role | undefined

  // Groups: one per step subject, in order of first appearance; entries from the examples the steps carry.
  const groups = new Map<string, CompiledGroup & { uses: { flow: Flow; sender?: Role }[]; entryUses: Map<string, { flow: Flow; sender?: Role }[]> }>()
  const reached = new Set<string>()
  // JWT name | field subject → groups whose examples show it.
  const jwtFields = new Map<string, string[]>()
  for (const flow of flows) {
    for (const step of flow.steps) {
      const subj = subjects.get(step.subject)
      if (!subj) continue
      const sender = roleOf(flow, step.from)
      let g = groups.get(subj.id)
      if (!g) {
        g = {
          subject: subj.id,
          title: subj.title,
          kind: subj.kind,
          ...(subj.endpoint ? { endpoint: subj.endpoint } : {}),
          steps: {},
          from: flow.participants.find((p) => p.id === step.from)?.label,
          to: flow.participants.find((p) => p.id === step.to)?.label,
          ...(subj.description ? { description: subj.description } : {}),
          rule: [],
          entries: [],
          checks: [],
          see: [],
          link: link(subj.id),
          uses: [],
          entryUses: new Map(),
        }
        groups.set(subj.id, g)
      }
      g.steps[flow.id] = g.steps[flow.id] ? `${g.steps[flow.id]}, ${stepNumber(flow, step)}` : stepNumber(flow, step)
      g.uses.push({ flow, sender })
      reached.add(subj.id)

      for (const c of subj.checks) {
        const { transport: t, format: f } = flow.variant
        if ((c.transport && t && !c.transport.includes(t)) || (c.format && f && !c.format.includes(f))) continue
        const have = g.checks.find((x) => x.field === c.field && x.expect === c.expect)
        if (have) have.flows.push(flow.id)
        else g.checks.push({ field: c.field, expect: c.expect, ...(c.subject ? { subject: c.subject } : {}), flows: [flow.id] })
      }

      const ex = step.example ? examples.get(step.example) : undefined
      const enc = ex ? ds.encoded[ex.id] : undefined
      if (!ex || !enc) continue
      const view = viewOf(enc)
      // The example's sender binds a field whose stack names no role. An embedded JWT is listed once, at the step that
      // first shows it (where it is issued: the WIA at provisioning), and referenced from later steps.
      for (const ptr of entryPointers(view)) {
        const sid = annotationFor(ptr, ex.annotations, ds.fieldmap)
        if (!sid || sid === subj.id) continue
        reached.add(sid)
        const jwt = ptr.startsWith('/jwt/') ? splitPointer(ptr)[1]! : null
        if (jwt) jwtFields.set(`${jwt}|${sid}`, [...new Set([...(jwtFields.get(`${jwt}|${sid}`) ?? []), subj.id])])
        const uses = g.entryUses.get(sid) ?? []
        if (!uses.some((u) => u.flow.id === flow.id)) uses.push({ flow, sender })
        g.entryUses.set(sid, uses)
        if (g.entries.some((e) => e.subject === sid)) continue
        const s = subjects.get(sid)
        g.entries.push({
          subject: sid,
          title: s?.title ?? sid,
          kind: s?.kind ?? 'field',
          path: displayPath(ptr),
          ...(s?.location ? { location: s.location } : {}),
          ...exampleValue(lookup(view, ptr)),
          ...(s?.description ? { description: s.description } : {}),
          variants: [],
          link: link(sid),
        })
      }
    }
  }

  // Subjects with rules that no example shows go to the group of their nearest reached ancestor, else cross-cutting.
  const crossCutting: CompiledEntry[] = []
  for (const s of ds.subjects) {
    if (reached.has(s.id) || s.kind === 'flow' || rootOf(s.id) !== root || stackOf(s.id).length === 0) continue
    let p = s.parent ? subjects.get(s.parent) : undefined
    while (p && !groups.has(p.id)) p = p.parent ? subjects.get(p.parent) : undefined
    const entry: CompiledEntry = {
      subject: s.id,
      title: s.title,
      kind: s.kind,
      ...(s.location ? { location: s.location } : {}),
      ...(s.description ? { description: s.description } : {}),
      variants: [],
      link: link(s.id),
    }
    const g = p ? groups.get(p.id) : undefined
    if (g) {
      g.entries.push(entry)
      g.entryUses.set(s.id, g.uses)
    } else crossCutting.push(entry)
  }

  // An embedded JWT's field stays only in the first group (in reading order) that shows it; later groups point there.
  const order = [...groups.keys()]
  for (const g of groups.values())
    g.entries = g.entries.filter((e) => {
      const jwt = e.path && /^[^.[]+\.(header|payload)\b/.test(e.path) ? e.path.split('.')[0]! : null
      const home = jwt ? (jwtFields.get(`${jwt}|${e.subject}`) ?? []).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] : undefined
      if (!jwt || !home || home === g.subject) return true
      if (!g.see.some((x) => x.jwt === jwt && x.group === home)) g.see.push({ jwt, group: home })
      return false
    })

  const out: CompiledGroup[] = []
  for (const { uses, entryUses, ...g } of groups.values()) {
    g.rule = variantRules(g.subject, uses)
    for (const e of g.entries) e.variants = variantRules(e.subject, entryUses.get(e.subject) ?? uses)
    // Flows in which every check applies need not be named.
    const flowIds = [...new Set(uses.map((u) => u.flow.id))]
    for (const c of g.checks) if (flowIds.every((f) => c.flows.includes(f))) c.flows = []
    out.push(g)
  }
  for (const e of crossCutting) e.variants = variantRules(e.subject, [])

  // Every rule of the side, once: what changes later, and what is not settled.
  const changes: CompiledProfile['changes'] = []
  const open: CompiledProfile['open'] = []
  const seen = new Set<string>()
  const visit = (e: { subject: string; title: string; link: string }, variants: VariantRule[]) => {
    for (const v of variants)
      for (const r of v.rules) {
        const key = `${e.subject}|${r.role}`
        if (seen.has(key)) continue
        seen.add(key)
        let prev = r.level
        for (const c of r.changes) {
          changes.push({ subject: e.subject, title: e.title, role: r.role, date: c.from, from: levelLabel(prev), to: levelLabel(c.level), by: c.by, link: e.link })
          prev = c.level
        }
        if (r.status !== 'decided') open.push({ subject: e.subject, title: e.title, role: r.role, status: r.status, issues: r.issues, link: e.link })
      }
  }
  for (const g of out) {
    visit(g, g.rule)
    for (const e of g.entries) visit(e, e.variants)
  }
  for (const e of crossCutting) visit(e, e.variants)
  changes.sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject))

  const usedSpecs = new Set<string>()
  const collect = (vs: VariantRule[]) => vs.forEach((v) => v.rules.forEach((r) => r.by.forEach((b) => usedSpecs.add(b.assertion))))
  for (const g of out) {
    collect(g.rule)
    g.entries.forEach((e) => collect(e.variants))
  }
  crossCutting.forEach((e) => collect(e.variants))
  const specIds = new Set(ds.assertions.filter((a) => usedSpecs.has(a.id)).map((a) => a.spec))

  return {
    side: opts.side,
    title: TITLE[opts.side],
    asOf: opts.asOf,
    layers: ds.layers.filter((l) => opts.layers.has(l.id)).map((l) => l.id),
    generated: ds.builtAt,
    specs: ds.specs
      .filter((s) => specIds.has(s.id))
      .sort((a, b) => (table.get(a.layer)?.rank ?? 99) - (table.get(b.layer)?.rank ?? 99) || a.short.localeCompare(b.short))
      .map((s) => ({ id: s.id, short: s.short, version: s.version, layer: s.layer })),
    flows: flows.map((f) => ({
      id: f.id,
      title: f.title,
      summary: f.summary,
      variant: f.variant,
      participants: f.participants.map((p) => ({ id: p.id, label: p.label })),
      steps: f.steps.map((s) => ({ n: stepNumber(f, s), from: s.from, to: s.to, kind: s.kind, label: s.label, group: s.subject })),
    })),
    groups: out,
    crossCutting,
    changes,
    open,
  }
}

/** "/http/body/grant_type" → "body.grant_type"; "/jwt/wia/payload/cnf/jwk" → "wia.payload.cnf.jwk". */
function displayPath(ptr: string): string {
  const t = splitPointer(ptr)
  const rest = t[0] === 'http' ? t.slice(1) : t[0] === 'jwt' || t[0] === 'cbor' ? t.slice(1) : t[0] === 'json' ? t.slice(1) : t
  return rest.reduce((acc, x) => (/^\d+$/.test(x) ? `${acc}[${x}]` : acc ? `${acc}.${x}` : x), '')
}

function exampleValue(v: unknown): { example?: string } {
  if (v === undefined || v === null) return {}
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object') ? { example: clip(JSON.stringify(v)) } : {}
  if (typeof v === 'object') return {}
  const s = String(v)
  if (/^ey[\w-]+\.[\w-]+\./.test(s)) return { example: 'eyJ… (JWT)' }
  return { example: clip(s) }
}

function clip(s: string, n = 48): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

// Markdown --------------------------------------------------------------------------------------------------------

const ROLE_SHORT: Record<Role, string> = { wallet: 'Wallet', 'wallet-provider': 'WP', as: 'AS', issuer: 'Issuer', verifier: 'Verifier' }
const LAYER_SHORT: Partial<Record<LayerId, string>> = { assumption: 'Assumed', golive: 'd-you', cir: 'CIR', etsi: 'ETSI', haip: 'HAIP' }
const MARK: Partial<Record<Status, string>> = { conflict: ' ⚡', 'needs-review': ' ⚠' }

/** Text for a Markdown table cell, safe in CommonMark and in Docusaurus MDX. */
function cell(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/\s+/g, ' ')
    .trim()
}
function code(s: string): string {
  const t = s.replace(/\|/g, '\\|').replace(/\s+/g, ' ')
  return t.includes('`') ? `\`\` ${t} \`\`` : `\`${t}\``
}

/** Short code of a flow, used to say where a rule holds: the flow id without its side prefix. */
const flowCode = (id: string) => id.replace(/^(vp|vci)-/, '')

/** Later level changes only; a change of the deciding statement at the same level is in the JSON. */
function levelChanges(r: RoleRule) {
  let prev = r.level
  return r.changes.filter((c) => {
    const changed = c.level !== prev
    prev = c.level
    return changed
  })
}

function ruleText(r: RoleRule): string {
  const lvl = r.level ? `**${levelLabel(r.level)}**` : '—'
  const cond = r.by.find((b) => b.condition)?.condition
  const next = levelChanges(r)[0]
  const change = next ? ` ⏳ from ${next.from}: ${levelLabel(next.level)}` : ''
  return `${ROLE_SHORT[r.role]} ${lvl}${MARK[r.status] ?? ''}${change}${cond ? ` *${cell(conditionText(cond))}*` : ''}`
}

/** "If issuer-initiated flows are supported." → "if issuer-initiated flows are supported"; "id = x" → "if id = x". */
function conditionText(s: string): string {
  const t = s.trim().replace(/\.$/, '')
  return /^(if|when|where|whenever|unless|only|for|in|during|after|before|once)\b/i.test(t) ? t[0]!.toLowerCase() + t.slice(1) : `if ${t}`
}

function basisText(rules: RoleRule[]): string {
  const parts = new Set<string>()
  for (const r of rules) for (const b of r.by) parts.add(cell(`${b.spec} ${b.locator}`.trim()))
  return [...parts].join('; ')
}

function where(v: VariantRule): string {
  return v.flows.length ? `*${v.flows.map(flowCode).join(', ')}:* ` : ''
}

export function profileMarkdown(p: CompiledProfile): string {
  const anchor = (id: string) => id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const allFlows = p.flows.map((f) => f.id)
  const fieldsOf = (g: CompiledGroup) => g.entries.filter((e) => e.path)
  const obligationsOf = (g: CompiledGroup) => g.entries.filter((e) => !e.path && e.variants.length)
  const shown = p.groups.filter((g) => g.rule.length || fieldsOf(g).length || obligationsOf(g).length || g.checks.length)
  const shownIds = new Set(shown.map((g) => g.subject))
  const live = p.groups[0]?.link.split('#')[0]
  const L: string[] = []

  L.push(`# ${p.title}`, '')
  L.push(
    `> Generated${live ? ` by [specs-navigator](${live})` : ''} on ${p.generated} from its provenance data; effective rules as of **${p.asOf}** ` +
      `with the layers ${p.layers.join(', ')}. Do not edit: regenerate. Technical prototype: check a rule against its source ` +
      'before relying on it; every field name links to its full provenance stack.',
    '',
  )
  L.push(
    '**How to read a rule:** *role* **LEVEL**: SHALL, SHOULD, MAY, SHOULD NOT or SHALL NOT for that role; *if …* the condition ' +
      'it binds under; ⚠ a deciding statement needs review; ⚡ sources of the same rank disagree; ⏳ the level changes on that date; ' +
      '*flow:* the rule holds only in those flows (codes below). **Decided by** is the highest-ranked source, by the precedence ' +
      'Assumptions > d-you go-live > CIR > ETSI > HAIP > base protocols > primitives > ARF. Roles: AS = authorization server, ' +
      'WP = wallet provider.',
    '',
  )

  L.push('| Code | Flow |', '|---|---|')
  for (const f of p.flows) L.push(`| ${code(flowCode(f.id))} | [${cell(f.title)}](#${anchor(`flow-${f.id}`)}) |`)
  L.push('')
  const sections = [
    ['Messages and obligations', shown.length],
    ['Cross-cutting rules', p.crossCutting.length],
    ['Changes ahead', p.changes.length],
    ['Open points', p.open.length],
    ['Pinned sources', p.specs.length],
  ] as const
  L.push(sections.filter(([, n]) => n).map(([t]) => `[${t}](#${anchor(t)})`).join(' · '), '')

  L.push('## Flows', '')
  for (const f of p.flows) {
    L.push(`<a id="${anchor(`flow-${f.id}`)}"></a>`, '', `### ${cell(f.title)}`, '', cell(f.summary), '')
    const pid = (id: string) => `p_${id.replace(/[^a-z0-9]/gi, '_')}`
    L.push('```mermaid', 'sequenceDiagram')
    for (const pt of f.participants) L.push(`  participant ${pid(pt.id)} as ${mermaidText(pt.label)}`)
    for (const s of f.steps) L.push(`  ${pid(s.from)}${s.kind === 'response' ? '-->>' : '->>'}${pid(s.to)}: ${s.n} ${mermaidText(s.label)}`)
    L.push('```', '')
    const links = f.steps.filter((s) => shownIds.has(s.group)).map((s) => `${s.n} [${cell(s.label)}](#${anchor(s.group)})`)
    if (links.length) L.push(`Steps: ${links.join(' · ')}`, '')
  }

  L.push('## Messages and obligations', '')
  for (const g of shown) {
    L.push(`<a id="${anchor(g.subject)}"></a>`, '', `### ${cell(g.title)}`, '')
    const meta: string[] = []
    if (g.endpoint) meta.push(code(`${g.endpoint.method} ${g.endpoint.path}`))
    if (g.from && g.to) meta.push(g.from === g.to ? `${cell(g.from)}, internal` : `${cell(g.from)} → ${cell(g.to)}`)
    const nums = new Set(Object.values(g.steps))
    const inAll = allFlows.every((f) => g.steps[f])
    meta.push(
      inAll && nums.size === 1
        ? `step ${[...nums][0]} in every flow`
        : `step ${Object.entries(g.steps).map(([f, n]) => `${n} ${code(flowCode(f))}`).join(', ')}`,
    )
    meta.push(`[stack](${g.link})`)
    L.push(meta.join(' · '), '')
    if (g.description) L.push(cell(g.description), '')
    for (const v of g.rule) L.push(`- **Rule:** ${where(v)}${v.rules.map(ruleText).join(' · ')} (${basisText(v.rules)})`)
    if (g.rule.length) L.push('')

    const fields = fieldsOf(g)
    if (fields.length || g.see.length) {
      L.push('| Field | Rule | Example | Decided by |', '|---|---|---|---|')
      for (const e of fields) {
        const name = `[${code(e.path!)}](${e.link})`
        const ex = e.example ? code(e.example) : ''
        if (!e.variants.length) L.push(`| ${name} | *no rule recorded* | ${ex} | |`)
        e.variants.forEach((v, i) =>
          L.push(`| ${i === 0 ? name : ''} | ${where(v)}${v.rules.map(ruleText).join('<br/>')} | ${i === 0 ? ex : ''} | ${basisText(v.rules)} |`),
        )
      }
      for (const jwt of new Set(g.see.map((x) => x.jwt))) {
        const homes = g.see
          .filter((x) => x.jwt === jwt)
          .map((x) => `[${cell(p.groups.find((h) => h.subject === x.group)?.title ?? x.group)}](#${anchor(x.group)})`)
        const other = fields.some((e) => e.path!.startsWith(`${jwt}.`)) ? 'other fields ' : ''
        L.push(`| ${code(`${jwt}.*`)} | ${other}as in ${homes.join(', ')} | | |`)
      }
      L.push('')
    }
    const other = obligationsOf(g)
    if (other.length) {
      L.push('| Obligation | Rule | Decided by |', '|---|---|---|')
      for (const e of other) obligationRows(L, e)
      L.push('')
    }
    if (g.checks.length) {
      L.push('| Check | Expect |', '|---|---|')
      for (const c of g.checks) L.push(`| ${code(c.field)}${c.flows.length ? ` *${c.flows.map(flowCode).join(', ')}*` : ''} | ${cell(c.expect)} |`)
      L.push('')
    }
  }

  const cross = p.crossCutting.filter((e) => e.variants.length)
  if (cross.length) {
    L.push('## Cross-cutting rules', '', 'Rules that hold across the flows rather than in one message.', '')
    L.push('| Obligation | Rule | Decided by |', '|---|---|---|')
    for (const e of cross) obligationRows(L, e)
    L.push('')
  }

  const changes = p.changes.filter((c) => c.from !== c.to)
  if (changes.length) {
    L.push('## Changes ahead', '', `Rules whose level changes after ${p.asOf}, mostly because a go-live window or an application date starts or ends.`, '')
    L.push('| From | Subject | Role | Level before | Level after |', '|---|---|---|---|---|')
    for (const c of changes) L.push(`| ${c.date} | [${cell(c.title)}](${c.link}) | ${ROLE_SHORT[c.role]} | ${c.from} | ${c.to} |`)
    L.push('')
  }

  if (p.open.length) {
    L.push('## Open points', '', 'Rules the sources do not settle yet. The level above is what precedence gives today; the stack shows the alternatives.', '')
    L.push('| Subject | Role | Status | Why |', '|---|---|---|---|')
    for (const o of p.open) L.push(`| [${cell(o.title)}](${o.link}) | ${ROLE_SHORT[o.role]} | ${o.status} | ${o.issues.map(cell).join('<br/>')} |`)
    L.push('')
  }

  L.push('## Pinned sources', '', '| Source | Layer | Version |', '|---|---|---|')
  for (const s of p.specs) L.push(`| ${cell(s.short)} | ${LAYER_SHORT[s.layer] ?? s.layer} | ${cell(s.version)} |`)
  L.push('')
  return L.join('\n')
}

function obligationRows(L: string[], e: CompiledEntry) {
  e.variants.forEach((v, i) =>
    L.push(`| ${i === 0 ? `[${cell(e.title)}](${e.link})` : ''} | ${where(v)}${v.rules.map(ruleText).join('<br/>')} | ${basisText(v.rules)} |`),
  )
}

/** Mermaid message text: no characters that end a statement or open markup. */
function mermaidText(s: string): string {
  return s.replace(/[;#]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
}

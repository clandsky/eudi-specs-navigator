import type { Assertion, Layer, LayerId, Level, Role } from './schema'

/** The context a rule is resolved in. The layer lens shrinks `layers`; the date control moves `asOf`. */
export interface Ctx {
  role: Role
  asOf: string
  layers: ReadonlySet<LayerId>
  grant?: string
  format?: string
  transport?: string
  device?: string
}

export type Status = 'decided' | 'conflict' | 'undecided' | 'needs-review'

export interface Neutralised {
  assertion: Assertion
  by: Assertion
}

export interface WindowEvent {
  date: string
  kind: 'starts' | 'ends'
  assertion: Assertion
}

export interface EffectiveRule {
  status: Status
  level: Level | null
  /** Highest-ranked active assertions that set the effective level. */
  decidedBy: Assertion[]
  /** Lower-ranked assertions with the same level. */
  agreeing: Assertion[]
  /** Lower-ranked assertions with a different level: overruled by precedence. */
  overruled: Assertion[]
  /** Assertions taken out by a higher-ranked voids / replaces / adapts. */
  neutralised: Neutralised[]
  /** Defining or descriptive assertions without a level (e.g. `defines` + info). */
  context: Assertion[]
  silent: Assertion[]
  implementation: Assertion[]
  conflicts: { reason: string; assertions: Assertion[] }[]
  /** Window boundaries after `asOf` for assertions that apply to this context. */
  upcoming: WindowEvent[]
  /** Contributing assertions that are not source-checked. */
  unverified: Assertion[]
  /** Reasons a contributing assertion was flagged for review. */
  reviews: { assertion: Assertion; reason: string }[]
}

export type LayerTable = ReadonlyMap<LayerId, Layer>

export function layerTable(layers: readonly Layer[]): LayerTable {
  return new Map(layers.map((l) => [l.id, l]))
}

function rankOf(a: Assertion, specLayer: (specId: string) => LayerId, table: LayerTable): number {
  const r = table.get(specLayer(a.spec))?.rank
  return r ?? Number.POSITIVE_INFINITY
}

function matchesDim(list: readonly string[] | undefined, value: string | undefined): boolean {
  if (!list || list.length === 0) return true
  // The context does not fix this dimension (e.g. no grant selected): the assertion may apply.
  if (value === undefined) return true
  return list.includes(value)
}

export function appliesTo(a: Assertion, ctx: Ctx): boolean {
  const t = a.applies_to
  return (
    matchesDim(t.role, ctx.role) &&
    matchesDim(t.grant, ctx.grant) &&
    matchesDim(t.format, ctx.format) &&
    matchesDim(t.transport, ctx.transport) &&
    matchesDim(t.device, ctx.device)
  )
}

export function inWindow(a: Assertion, asOf: string): boolean {
  const w = a.window
  if (!w) return true
  if (w.from && asOf < w.from) return false
  if (w.until && asOf > w.until) return false
  return true
}

const NEUTRALISING = new Set(['voids', 'replaces', 'adapts'])
const NON_NORMATIVE = new Set(['silent', 'implements', 'deviates', 'voids'])

/**
 * Resolve the effective rule for one subject's stack in one context.
 *
 * 1. Filter: role and variant match, window contains `asOf`, layer enabled in the lens.
 * 2. Neutralise: voids / replaces / adapts remove their target if they outrank it (an interpretation may also act
 *    within its own rank); otherwise it is a conflict.
 * 3. Decide: the effective level is the level of the highest-ranked remaining normative assertion. A void can
 *    therefore let a lower layer's rule surface again.
 *    Within a rank, narrowing statements (profiles, adapts, replaces) go before defining ones.
 * 4. Classify: conflict (same rank and kind disagree, or a deviation) > needs-review > undecided > decided.
 */
export function resolve(
  stack: readonly Assertion[],
  ctx: Ctx,
  table: LayerTable,
  specLayer: (specId: string) => LayerId,
): EffectiveRule {
  const layerOf = (a: Assertion) => specLayer(a.spec)
  const enabled = (a: Assertion) => ctx.layers.has(layerOf(a)) || !table.get(layerOf(a))?.lens
  const rank = (a: Assertion) => rankOf(a, specLayer, table)

  const applicable = stack.filter((a) => appliesTo(a, ctx) && enabled(a))
  const active = applicable.filter((a) => inWindow(a, ctx.asOf))

  const upcoming: WindowEvent[] = []
  for (const a of applicable) {
    if (a.window?.from && a.window.from > ctx.asOf) upcoming.push({ date: a.window.from, kind: 'starts', assertion: a })
    if (a.window?.until && a.window.until >= ctx.asOf) upcoming.push({ date: a.window.until, kind: 'ends', assertion: a })
  }
  upcoming.sort((x, y) => x.date.localeCompare(y.date))

  const conflicts: EffectiveRule['conflicts'] = []
  const neutralised: Neutralised[] = []
  const removed = new Set<string>()

  // Neutralisers are applied from the highest precedence down, so a CIR void beats an ETSI replacement of the same text.
  const neutralisers = active.filter((a) => NEUTRALISING.has(a.relation) && a.target).sort((x, y) => rank(x) - rank(y))
  for (const n of neutralisers) {
    if (removed.has(n.id)) continue
    const target = active.find((a) => a.id === n.target)
    if (!target || removed.has(target.id)) continue
    if (rank(n) < rank(target) || (n.interpretation && rank(n) === rank(target))) {
      removed.add(target.id)
      neutralised.push({ assertion: target, by: n })
    } else {
      conflicts.push({
        reason: `${n.id} ${n.relation} ${target.id} but does not outrank it`,
        assertions: [n, target],
      })
    }
  }

  const remaining = active.filter((a) => !removed.has(a.id))
  // Within one rank, a statement that narrows (profiles, adapts, replaces) is more specific than one that only
  // defines or extends, so it goes first and does not count as a contradiction with it.
  const specificity = (a: Assertion) => (a.relation === 'defines' || a.relation === 'extends' ? 1 : 0)
  const normative = remaining
    .filter((a) => table.get(layerOf(a))?.normative && !NON_NORMATIVE.has(a.relation) && a.level && a.level !== 'info')
    .sort((x, y) => rank(x) - rank(y) || specificity(x) - specificity(y))

  const context = remaining.filter(
    (a) => table.get(layerOf(a))?.normative && !NON_NORMATIVE.has(a.relation) && (!a.level || a.level === 'info'),
  )
  const silent = remaining.filter((a) => a.relation === 'silent')
  const implementation = remaining.filter((a) => a.relation === 'implements' || a.relation === 'deviates' || !table.get(layerOf(a))?.normative)
  for (const d of remaining.filter((a) => a.relation === 'deviates')) {
    const target = stack.find((a) => a.id === d.target)
    conflicts.push({ reason: `${d.id} deviates from ${d.target}`, assertions: target ? [d, target] : [d] })
  }

  let level: Level | null = null
  let decidedBy: Assertion[] = []
  let agreeing: Assertion[] = []
  let overruled: Assertion[] = []

  const top = normative[0]
  if (top) {
    const topRank = rank(top)
    const atTop = normative.filter((a) => rank(a) === topRank && specificity(a) === specificity(top))
    level = top.level ?? null
    const disagreeing = atTop.filter((a) => a.level !== level)
    if (disagreeing.length > 0) {
      conflicts.push({ reason: `assertions of the same rank set different levels`, assertions: atTop })
    }
    decidedBy = atTop.filter((a) => a.level === level)
    const below = normative.filter((a) => !atTop.includes(a))
    agreeing = below.filter((a) => a.level === level)
    overruled = below.filter((a) => a.level !== level)
  }

  // Assertions that shape the outcome: the deciders and whatever neutralised something.
  const contributing = [...new Set([...decidedBy, ...neutralised.map((n) => n.by)])]
  const reviews = contributing
    .filter((a) => a.verified === 'needs-review' && a.review)
    .map((a) => ({ assertion: a, reason: a.review!.reason }))
  const unverified = [...decidedBy, ...agreeing, ...overruled, ...neutralised.map((n) => n.by)].filter(
    (a) => a.verified === 'unverified',
  )

  let status: Status = 'decided'
  if (conflicts.length > 0) status = 'conflict'
  else if (reviews.length > 0) status = 'needs-review'
  else if (!top) status = 'undecided'

  return {
    status,
    level,
    decidedBy,
    agreeing,
    overruled,
    neutralised,
    context,
    silent,
    implementation,
    conflicts,
    upcoming,
    unverified,
    reviews,
  }
}

/**
 * How the effective rule changes over time from `ctx.asOf` on: one entry per window boundary at which the deciding
 * level or deciding assertions change. Drives "relaxed by go-live until X; from then on: CIR rule".
 */
export function timeline(
  stack: readonly Assertion[],
  ctx: Ctx,
  table: LayerTable,
  specLayer: (specId: string) => LayerId,
): { from: string; rule: EffectiveRule }[] {
  const first = resolve(stack, ctx, table, specLayer)
  const dates = new Set<string>()
  for (const e of first.upcoming) dates.add(e.kind === 'starts' ? e.date : nextDay(e.date))
  const out = [{ from: ctx.asOf, rule: first }]
  for (const d of [...dates].sort()) {
    const rule = resolve(stack, { ...ctx, asOf: d }, table, specLayer)
    const prev = out[out.length - 1]!.rule
    if (rule.level !== prev.level || ids(rule.decidedBy) !== ids(prev.decidedBy)) out.push({ from: d, rule })
  }
  return out
}

function ids(as: readonly Assertion[]): string {
  return as.map((a) => a.id).sort().join(',')
}

export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const LEVEL_LABEL: Record<Level, string> = {
  shall: 'SHALL',
  should: 'SHOULD',
  may: 'MAY',
  'should-not': 'SHOULD NOT',
  'shall-not': 'SHALL NOT',
  info: 'INFO',
}
export function levelLabel(level: Level | null | undefined): string {
  return level ? LEVEL_LABEL[level] : '—'
}

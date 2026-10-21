// Indexes over the build-time dataset plus the view context (role, as-of date, layer lens) read from the URL.
import dataset from 'virtual:dataset'
import { useMemo } from 'react'
import type { Dataset } from '../model/dataset'
import { layerTable, resolve, type Ctx, type EffectiveRule } from '../model/resolve'
import { Assertion as AssertionSchema, type Assertion, type Layer, type LayerId, type Role, type Spec, type Subject } from '../model/schema'
import { useRoute } from './router'

export const ds: Dataset = dataset

// Go-live drafts saved in this browser (static build without the dev server) are applied on top of the dataset, so the
// author sees their effect immediately. They are never shared: export them as YAML into data/assertions/golive/.
export const DRAFTS_KEY = 'specs-navigator.golive-drafts'
export function readDrafts(): Assertion[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '[]') as unknown[]
    return raw.flatMap((r) => {
      const p = AssertionSchema.safeParse(r)
      return p.success ? [p.data] : []
    })
  } catch {
    return []
  }
}
export function writeDrafts(drafts: Assertion[]) {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
    return true
  } catch {
    return false
  }
}
export const draftIds = new Set<string>()
for (const d of readDrafts()) {
  if (ds.assertions.some((a) => a.id === d.id)) continue
  ds.assertions.push({ ...d, file: 'local draft (this browser)' })
  draftIds.add(d.id)
}
export const table = layerTable(ds.layers)
export const layerById = new Map<LayerId, Layer>(ds.layers.map((l) => [l.id, l]))
export const specById = new Map<string, Spec & { file: string }>(ds.specs.map((s) => [s.id, s]))
export const subjectById = new Map<string, Subject & { file: string }>(ds.subjects.map((s) => [s.id, s]))
export const assertionById = new Map<string, Assertion & { file: string }>(ds.assertions.map((a) => [a.id, a]))
export const exampleById = new Map(ds.examples.map((e) => [e.id, e]))
export const flowById = new Map(ds.flows.map((f) => [f.id, f]))

const bySubject = new Map<string, (Assertion & { file: string })[]>()
for (const a of ds.assertions) bySubject.set(a.subject, [...(bySubject.get(a.subject) ?? []), a])
const children = new Map<string, string[]>()
for (const s of ds.subjects) if (s.parent) children.set(s.parent, [...(children.get(s.parent) ?? []), s.id])

export const specLayer = (specId: string): LayerId => specById.get(specId)?.layer ?? 'secondary'
export const layerOf = (a: Assertion): LayerId => specLayer(a.spec)
export const rankOf = (a: Assertion): number => table.get(layerOf(a))?.rank ?? Number.POSITIVE_INFINITY
export const stackOf = (subjectId: string) => bySubject.get(subjectId) ?? []
export const childrenOf = (subjectId: string) => children.get(subjectId) ?? []

export function descendants(subjectId: string): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    for (const c of childrenOf(id)) {
      out.push(c)
      walk(c)
    }
  }
  walk(subjectId)
  return out
}

/** Layers that say something about a subject (ordered by precedence). */
export function layersTouching(subjectIds: string[]): LayerId[] {
  const set = new Set<LayerId>()
  for (const id of subjectIds) for (const a of stackOf(id)) set.add(layerOf(a))
  return ds.layers.filter((l) => set.has(l.id) && l.rank !== null).map((l) => l.id)
}

// Layer lens ------------------------------------------------------------------------------------------------------

/** Cumulative stages of the lens. Layers without a lens switch (base, primitives, ARF) are always on. */
export const LENS_STAGES: { id: LayerId; label: string }[] = [
  { id: 'base', label: 'Base protocol' },
  { id: 'haip', label: '+ HAIP' },
  { id: 'etsi', label: '+ ETSI' },
  { id: 'cir', label: '+ CIR' },
  { id: 'golive', label: '+ d-you' },
  { id: 'assumption', label: '+ Assumptions' },
]

export function layersForStage(stage: number): Set<LayerId> {
  const on = new Set<LayerId>(ds.layers.filter((l) => !l.lens).map((l) => l.id))
  LENS_STAGES.slice(0, stage + 1).forEach((s) => on.add(s.id))
  return on
}

export type View = 'issuer' | 'verifier'

/** Side a subject belongs to, from its top ancestor: vci → issuer, vp → verifier, common → both. */
const SIDE_OF_ROOT: Record<string, View> = { vci: 'issuer', vp: 'verifier' }
export function sideOf(subjectId: string): View | 'both' {
  let s = subjectById.get(subjectId)
  while (s?.parent) s = subjectById.get(s.parent)
  return SIDE_OF_ROOT[s?.id ?? subjectId.split('.')[0]!] ?? 'both'
}
export const onSide = (subjectId: string, view: View) => {
  const side = sideOf(subjectId)
  return side === 'both' || side === view
}

export interface ViewCtx {
  view: View
  asOf: string
  stage: number
  layers: Set<LayerId>
  prevLayers: Set<LayerId> | null
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function useViewCtx(): ViewCtx {
  const { path, params } = useRoute()
  // Verifier is the default side; a flow always shows the side it belongs to, whatever the link says.
  const flowSide = path[0] === 'flow' && path[1] ? flowById.get(path[1])?.role : undefined
  const view: View = flowSide ?? (params.get('role') === 'issuer' ? 'issuer' : 'verifier')
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.get('asOf') ?? '') ? params.get('asOf')! : today()
  const lens = params.get('lens')
  const idx = LENS_STAGES.findIndex((s) => s.id === lens)
  const stage = idx >= 0 ? idx : LENS_STAGES.length - 1
  return useMemo(
    () => ({ view, asOf, stage, layers: layersForStage(stage), prevLayers: stage > 0 ? layersForStage(stage - 1) : null }),
    [view, asOf, stage],
  )
}

// Roles -----------------------------------------------------------------------------------------------------------

export const ROLE_LABEL: Record<Role, string> = {
  wallet: 'Wallet',
  'wallet-provider': 'Wallet Provider',
  as: 'Authorization Server',
  issuer: 'Credential Issuer',
  verifier: 'Verifier',
}

export const VIEW_ROLES: Record<View, Role[]> = {
  issuer: ['issuer', 'as', 'wallet', 'wallet-provider'],
  verifier: ['verifier', 'wallet'],
}

/** Roles a stack names, in view order. Empty when no statement is restricted to a role: then it binds everyone. */
export function rolesOf(stack: readonly Assertion[], view: View): Role[] {
  const named = new Set<Role>()
  for (const a of stack) a.applies_to.role?.forEach((r) => named.add(r))
  const order = [...VIEW_ROLES[view], ...(['wallet', 'wallet-provider', 'as', 'issuer', 'verifier'] as Role[])]
  const roles = [...new Set(order)].filter((r) => named.has(r))
  return roles
}

/** The role whose obligation a chip on a field shows: the sender of the message if the stack binds it. */
export function primaryRole(stack: readonly Assertion[], view: View, sender?: Role): Role {
  const roles = rolesOf(stack, view)
  if (sender && (roles.includes(sender) || roles.length === 0)) return sender
  return roles[0] ?? sender ?? VIEW_ROLES[view][0]!
}

export function ctxFor(vc: ViewCtx, role: Role, layers = vc.layers, variant: Partial<Ctx> = {}): Ctx {
  return { role, asOf: vc.asOf, layers, ...variant }
}

export function effective(subjectId: string, role: Role, vc: ViewCtx, variant: Partial<Ctx> = {}, layers = vc.layers): EffectiveRule {
  return resolve(stackOf(subjectId), ctxFor(vc, role, layers, variant), table, specLayer)
}

/**
 * Where a subject originates: the most basic layer that defines or extends it. `null` when nothing defines it.
 * A subject whose origin is above `base` exists only because a higher spec added it.
 */
export function originOf(subjectId: string): LayerId | null {
  let best: { layer: LayerId; rank: number } | null = null
  for (const a of stackOf(subjectId)) {
    if (a.relation !== 'defines' && a.relation !== 'extends') continue
    const layer = layerOf(a)
    const rank = table.get(layer)?.rank
    if (rank === null || rank === undefined) continue
    if (!best || rank > best.rank) best = { layer, rank }
  }
  return best?.layer ?? null
}

export function existsAt(subjectId: string, layers: ReadonlySet<LayerId>): boolean {
  const o = originOf(subjectId)
  return o === null || layers.has(o)
}

export function anchorFor(a: Assertion): string | null {
  const spec = specById.get(a.spec)
  if (!spec) return null
  if (spec.anchor_template && a.locator.section) return spec.anchor_template.replace('{section}', a.locator.section)
  return spec.source.url ?? null
}

export function locatorText(a: Assertion): string {
  const l = a.locator
  if (l.req && l.section) return `${l.req} (§${l.section})`
  return l.req ?? (l.section ? `§${l.section}` : (l.at ?? ''))
}

export const C2BO_URL = 'https://conformance.c2bo.net/#requirements'
export const c2boById = new Map(ds.c2bo?.groups.flatMap((g) => g.requirements.map((r) => [r.id, r] as const)) ?? [])

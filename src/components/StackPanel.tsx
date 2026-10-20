import { useMemo, useState, type FormEvent } from 'react'
import { levelLabel, timeline, type EffectiveRule } from '../model/resolve'
import type { Assertion, Relation, Role } from '../model/schema'
import { href } from '../lib/router'
import {
  C2BO_URL,
  LENS_STAGES,
  VIEW_ROLES,
  ROLE_LABEL,
  anchorFor,
  assertionById,
  c2boById,
  childrenOf,
  ctxFor,
  draftIds,
  effective,
  layerById,
  layerOf,
  layersTouching,
  locatorText,
  originOf,
  readDrafts,
  rankOf,
  rolesOf,
  specById,
  specLayer,
  stackOf,
  subjectById,
  table,
  useViewCtx,
  writeDrafts,
  type ViewCtx,
} from '../lib/store'
import type { EntryKind } from './OverruleEditor'
import { LayerBadges, LayerName, LevelChip, SpecName, StatusTag, cssLayer, formatDate } from './bits'

const VERB: Record<Relation, string> = {
  defines: 'defines',
  profiles: 'profiles',
  extends: 'adds',
  adapts: 'rewords',
  replaces: 'replaces',
  voids: 'voids',
  implements: 'implements',
  deviates: 'deviates from',
  silent: 'is silent here',
}

type State = 'decides' | 'agrees' | 'overruled' | 'neutralised' | 'neutraliser' | 'context' | 'silent' | 'implementation' | 'inactive'

interface Props {
  subjectId: string
  /** Variant of the flow the subject is shown in (grant, transport, …). */
  variant?: { grant?: string; transport?: string; device?: string }
  onAddOverrule?: (subjectId: string, kind: EntryKind) => void
  /** Opens the rule editor on an authored entry (assumption, resolved reading or go-live compromise). */
  onEditEntry?: (a: Assertion) => void
  compact?: boolean
}

export function StackPanel({ subjectId, variant = {}, onAddOverrule, onEditEntry, compact }: Props) {
  const vc = useViewCtx()
  const subject = subjectById.get(subjectId)
  const stack = stackOf(subjectId)
  const named = rolesOf(stack, vc.view)
  // No role-restricted statement: one rule binds every role.
  const roles: Role[] = named.length ? named : [VIEW_ROLES[vc.view][0]!]
  const allRoles = named.length === 0
  const rules = useMemo(
    () => roles.map((role) => ({ role, rule: effective(subjectId, role, vc, variant) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subjectId, vc, JSON.stringify(variant), roles.join()],
  )
  if (!subject) return <div className="empty">Unknown subject {subjectId}.</div>

  const origin = originOf(subjectId)
  const states = stateMap(stack, rules.map((r) => r.rule))
  const sorted = [...stack].sort((a, b) => rankOf(a) - rankOf(b) || a.id.localeCompare(b.id))
  const kids = childrenOf(subjectId)

  return (
    <div>
      <header style={{ marginBottom: 14 }}>
        <div className="meta">
          {subject.kind}
          {subject.location ? `, ${subject.location}` : ''}
          {subject.endpoint ? `, ${subject.endpoint.method} ${subject.endpoint.path}` : ''}
        </div>
        <h2 style={{ margin: '2px 0 4px', fontSize: compact ? 16 : 20, letterSpacing: '-0.01em' }}>{subject.title}</h2>
        <Description key={subjectId} subjectId={subjectId} text={subject.description} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code className="meta">{subject.id}</code>
          <LayerBadges layers={layersTouching([subjectId])} />
          {origin && origin !== 'base' && origin !== 'primitive' && (
            <span className="tag" style={cssLayer(origin)}>
              Added by <LayerName id={origin} />
            </span>
          )}
          <a className="meta" href={href(['subject', subjectId])}>
            Link
          </a>
        </div>
      </header>

      <EffectiveBox rules={rules} vc={vc} subjectId={subjectId} variant={variant} allRoles={allRoles} />

      {onAddOverrule && stack.some((a) => a.relation !== 'silent') && (
        <div style={{ margin: '-6px 0 16px', display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => onAddOverrule(subjectId, 'golive')}>
            Add go-live compromise
          </button>
          <button className="btn" onClick={() => onAddOverrule(subjectId, 'assumption')}>
            Add assumption
          </button>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="empty" style={{ padding: 0 }}>
          No spec statement is recorded for this subject yet{kids.length ? '; see its parts below' : ''}.
        </p>
      ) : (
        <div className="strata" aria-label="Provenance stack, highest precedence first">
          {sorted.map((a) => (
            <Stratum key={a.id} a={a} state={states.get(a.id) ?? 'inactive'} rules={rules} active={isActive(a, vc)} onEdit={onEditEntry} />
          ))}
        </div>
      )}

      {kids.length > 0 && (
        <>
          <h3 style={{ fontSize: 13.5, margin: '22px 0 8px' }}>Parts</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
            {kids.map((k) => {
              const ks = stackOf(k)
              const r = ks.length ? effective(k, rolesOf(ks, vc.view)[0] ?? 'wallet', vc, variant) : null
              return (
                <li key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <LevelChip level={r?.level} />
                  <a href={href(['subject', k])}>{subjectById.get(k)?.title ?? k}</a>
                  <LayerBadges layers={layersTouching([k])} />
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

/** The subject's short description. The dev server writes edits back into data/subjects; the static build only shows it. */
function Description({ subjectId, text }: { subjectId: string; text?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const lede = { margin: '0 0 8px' }

  if (!import.meta.env.DEV) return text ? <p className="lede" style={lede}>{text}</p> : null

  async function save(e: FormEvent) {
    e.preventDefault()
    setState('saving')
    setError(null)
    const res = await fetch('/__subjects/description', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: subjectId, description: draft }),
    })
    const body = await res.json().catch(() => ({ error: [res.statusText] }))
    if (!res.ok) {
      setError([body.error].flat().join('; '))
      setState('idle')
      return
    }
    // The dataset plugin reloads the page once the YAML file changes.
    setState('saved')
  }

  if (draft === null)
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', ...lede }}>
        {text ? <p className="lede" style={{ margin: 0 }}>{text}</p> : <span className="meta">No description yet.</span>}
        <button className="btn" style={{ padding: '0 6px', flex: 'none' }} onClick={() => setDraft(text ?? '')}>
          {text ? 'Edit' : 'Add description'}
        </button>
      </div>
    )

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 6, ...lede }}>
      <textarea
        className="field-input"
        rows={3}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
        aria-label="Short description of the field"
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="submit" className="btn btn-primary" disabled={state !== 'idle'}>
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved, reloading…' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={() => setDraft(null)}>
          Cancel
        </button>
        <span className="meta">One plain-language sentence; written into data/subjects.</span>
      </div>
      {error && <span className="meta" style={{ color: 'var(--redline)' }}>{error}</span>}
    </form>
  )
}

function isActive(a: Assertion, vc: ViewCtx): boolean {
  const l = layerById.get(layerOf(a))
  const layerOn = !l?.lens || vc.layers.has(l.id)
  const w = a.window
  const inWin = !w || ((!w.from || vc.asOf >= w.from) && (!w.until || vc.asOf <= w.until))
  return layerOn && inWin
}

function stateMap(stack: readonly Assertion[], rules: EffectiveRule[]): Map<string, State> {
  const m = new Map<string, State>()
  const set = (id: string, s: State, prio: State[]) => {
    const cur = m.get(id)
    if (!cur || prio.indexOf(s) < prio.indexOf(cur)) m.set(id, s)
  }
  const prio: State[] = ['neutralised', 'decides', 'neutraliser', 'agrees', 'overruled', 'implementation', 'silent', 'context', 'inactive']
  for (const r of rules) {
    r.decidedBy.forEach((a) => set(a.id, 'decides', prio))
    r.agreeing.forEach((a) => set(a.id, 'agrees', prio))
    r.overruled.forEach((a) => set(a.id, 'overruled', prio))
    r.neutralised.forEach((n) => {
      set(n.assertion.id, 'neutralised', prio)
      set(n.by.id, 'neutraliser', prio)
    })
    r.context.forEach((a) => set(a.id, 'context', prio))
    r.silent.forEach((a) => set(a.id, 'silent', prio))
    r.implementation.forEach((a) => set(a.id, 'implementation', prio))
  }
  for (const a of stack) if (!m.has(a.id)) m.set(a.id, 'inactive')
  return m
}

function EffectiveBox({ rules, vc, subjectId, variant, allRoles }: { rules: { role: Role; rule: EffectiveRule }[]; vc: ViewCtx; subjectId: string; variant: object; allRoles: boolean }) {
  if (rules.length === 0)
    return (
      <div className="effective">
        <span className="meta">No role-specific rule recorded.</span>
      </div>
    )
  return (
    <div className="effective" aria-label="Effective rule">
      {rules.map(({ role, rule }) => {
        const prev = vc.prevLayers ? effective(subjectId, role, vc, variant, vc.prevLayers) : null
        const changed = prev && prev.level !== rule.level
        const tl = timeline(stackOf(subjectId), ctxFor(vc, role, vc.layers, variant), table, specLayer).slice(1)
        const conditions = rule.decidedBy.map((a) => a.condition).filter(Boolean)
        return (
          <div className="effective-row" key={role}>
            <span className="role">{allRoles ? 'All roles' : ROLE_LABEL[role]}</span>
            <LevelChip level={rule.level} />
            <div>
              {rule.decidedBy.length > 0 ? (
                <span>
                  {rule.decidedBy.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 && ', '}
                      <SpecName specId={a.spec} /> <a href={`#stratum-${cssId(a.id)}`} onClick={(e) => jump(e, a.id)} className="mono">{locatorText(a)}</a>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="meta">No binding statement in the enabled layers</span>
              )}{' '}
              <StatusTag rule={rule} />
              {conditions.length > 0 && <div className="meta">Only {conditions.join('; ').replace(/^./, (c) => c.toLowerCase())}</div>}
              {changed && (
                <div className="meta">
                  Changed by <LayerName id={LENS_STAGES[vc.stage]!.id} />: {levelLabel(prev!.level)} → <strong>{levelLabel(rule.level)}</strong>
                </div>
              )}
              {tl.map((t) => (
                <div className="meta" key={t.from}>
                  From {formatDate(t.from)}: <strong>{levelLabel(t.rule.level)}</strong>
                  {t.rule.decidedBy[0] ? (
                    <>
                      {' '}
                      (<SpecName specId={t.rule.decidedBy[0].spec} /> {locatorText(t.rule.decidedBy[0])})
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const cssId = (id: string) => id.replace(/[^a-z0-9_-]/gi, '_')
function jump(e: React.MouseEvent, id: string) {
  e.preventDefault()
  document.getElementById(`stratum-${cssId(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function Stratum({
  a,
  state,
  rules,
  active,
  onEdit,
}: {
  a: Assertion
  state: State
  rules: { role: Role; rule: EffectiveRule }[]
  active: boolean
  onEdit?: (a: Assertion) => void
}) {
  const spec = specById.get(a.spec)!
  const layer = specLayer(a.spec)
  const anchor = anchorFor(a)
  const by = rules.flatMap((r) => r.rule.neutralised.filter((n) => n.assertion.id === a.id).map((n) => n.by))[0]
  const overruledBy = rules.find((r) => r.rule.overruled.some((o) => o.id === a.id))?.rule.decidedBy[0]
  const decidesFor = rules.filter((r) => r.rule.decidedBy.some((d) => d.id === a.id)).map((r) => (rules.length === 1 && !a.applies_to.role ? 'all roles' : ROLE_LABEL[r.role]))
  const target = a.target ? assertionById.get(a.target) : null
  const shown: State = active ? state : 'inactive'
  return (
    <article className="stratum" id={`stratum-${cssId(a.id)}`} data-state={shown} style={cssLayer(layer)}>
      <div className="stratum-head">
        <SpecName specId={a.spec} />
        {anchor ? (
          <a className="locator" href={anchor} target="_blank" rel="noreferrer">
            {locatorText(a)}
          </a>
        ) : (
          <span className="locator">{locatorText(a)}</span>
        )}
        <span className="relation">{VERB[a.relation]}</span>
        {a.level && a.relation !== 'voids' && <LevelChip level={a.level} />}
        {a.applies_to.role && <span className="meta">{a.applies_to.role.map((r) => ROLE_LABEL[r]).join(', ')}</span>}
        {a.applies_to.grant && <span className="tag">{a.applies_to.grant.join(', ')}</span>}
        {a.applies_to.transport && <span className="tag">{a.applies_to.transport.join(', ')}</span>}
      </div>
      {a.quote && <p className="quote">{a.quote}</p>}
      {a.relation === 'silent' && (
        <p className="verdict">
          Checked: “{a.probe}” does not occur in {spec.short} {spec.version}.
        </p>
      )}
      <div className="verdict">
        {shown === 'decides' && (
          <>
            <strong>Decides</strong> for {decidesFor.join(', ')}.
          </>
        )}
        {shown === 'neutralised' && by && (
          <span className="red">
            {VERB[by.relation].replace(/^./, (c) => c.toUpperCase())} by {specById.get(by.spec)?.short} {locatorText(by)}.
          </span>
        )}
        {shown === 'neutraliser' && target && (
          <>
            <strong>{VERB[a.relation].replace(/^./, (c) => c.toUpperCase())}</strong> {specById.get(target.spec)?.short} {locatorText(target)}.
          </>
        )}
        {shown === 'overruled' && overruledBy && (
          <>
            Overruled by {specById.get(overruledBy.spec)?.short} {locatorText(overruledBy)}.
          </>
        )}
        {shown === 'agrees' && <>Agrees with the deciding rule.</>}
        {shown === 'inactive' && <>Not applied in the current view (layer off, other role or variant, or outside its dates).</>}
        {a.condition && <div>Condition: {a.condition}</div>}
        {a.window && (
          <div>
            Applies {a.window.from ? `from ${formatDate(a.window.from)}` : ''}
            {a.window.from && a.window.until ? ' ' : ''}
            {a.window.until ? `until ${formatDate(a.window.until)}` : ''}.
          </div>
        )}
      </div>
      {a.review && (
        <div className="review">
          <strong>Needs review.</strong> {a.review.reason}
        </div>
      )}
      {a.note && <p className="verdict">{a.note}</p>}
      {layer === 'assumption' && <ResolveControl a={a} />}
      {((onEdit && specById.get(a.spec)?.authored && a.target) || layer === 'assumption' || a.spec === 'golive-compromises' || draftIds.has(a.id)) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          {onEdit && specById.get(a.spec)?.authored && a.target && (
            <button className="btn" onClick={() => onEdit(a)}>
              Edit
            </button>
          )}
          {(layer === 'assumption' || a.spec === 'golive-compromises' || draftIds.has(a.id)) && <DeleteControl a={a} />}
        </div>
      )}
      {(a.decided_by || a.reference) && (
        <p className="verdict">
          {a.decided_by && <>Agreed by {a.decided_by}. </>}
          {a.reference && <>Recorded in {a.reference}.</>}
        </p>
      )}
      <div className="meta" style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>{spec.version}</span>
        <span title="Result of the quote check against the local copy of the pinned version">
          {spec.authored
            ? layer === 'assumption'
              ? 'Assumption, not yet resolved'
              : 'Maintained in this repository'
            : a.verified === 'source-checked'
              ? 'Quote checked against source'
              : a.verified === 'needs-review'
                ? 'Quote checked, flagged for review'
                : 'Not verified'}
        </span>
        {a.xref.map((x) =>
          x.source === 'c2bo' ? (
            <a key={x.id} href={C2BO_URL} target="_blank" rel="noreferrer" title={c2boById.get(x.id)?.title}>
              c2bo: {x.id}
            </a>
          ) : (
            <span key={x.id}>
              {x.source}: {x.id}
            </span>
          ),
        )}
        <a href={href(['assertion', a.id])}>{a.id}</a>
      </div>
    </article>
  )
}

const RESOLVE_TARGETS: { layer: string; label: string }[] = [
  { layer: 'golive', label: 'd-you' },
  { layer: 'cir', label: 'CIR' },
  { layer: 'etsi', label: 'ETSI' },
  { layer: 'haip', label: 'HAIP' },
  { layer: 'base', label: 'Base protocol' },
]

/**
 * "Delete": removes an open assumption or a go-live compromise from its file after a confirmation (dev server only),
 * e.g. one entered by mistake. A draft saved in this browser (static build) is removed from localStorage instead.
 * The confirmation is asked in the page: embedded browsers may suppress window.confirm and answer it with false.
 */
function DeleteControl({ a }: { a: Assertion }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'done' | 'readonly'>('idle')
  const [error, setError] = useState<string | null>(null)
  const local = draftIds.has(a.id)
  const assumption = layerOf(a) === 'assumption'
  async function deleteNow() {
    setError(null)
    if (local) {
      if (!writeDrafts(readDrafts().filter((d) => d.id !== a.id))) {
        setError('This browser does not allow saving to local storage.')
        setState('idle')
        return
      }
      // Drafts are merged into the dataset once at load, so a reload drops it from every view.
      setState('done')
      window.location.reload()
      return
    }
    setState('busy')
    try {
      const res = await fetch('/__authored/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }) })
      if (res.status === 404 && !res.headers.get('content-type')?.includes('json')) return setState('readonly')
      const body = await res.json()
      if (!res.ok) {
        setError((body.error ?? [res.statusText]).join('; '))
        setState('idle')
        return
      }
      setState('done')
    } catch {
      setState('readonly')
    }
  }
  if (state === 'confirm')
    return (
      <>
        <span className="meta">
          Delete {local ? 'the local draft of ' : ''}this {assumption ? 'assumption' : 'go-live compromise'}?{' '}
          {assumption ? 'The rule it reads applies again as written.' : 'The rule it changes applies again.'}
        </span>
        <button className="btn btn-danger" onClick={deleteNow} autoFocus>
          Yes, delete
        </button>
        <button className="btn" onClick={() => setState('idle')}>
          Cancel
        </button>
      </>
    )
  return (
    <>
      <button className="btn" onClick={() => setState('confirm')} disabled={state !== 'idle'}>
        {state === 'busy' ? 'Deleting…' : 'Delete'}
      </button>
      {state === 'done' && <span className="success">Deleted. The page reloads without it.</span>}
      {state === 'readonly' && <span className="meta">Deleting writes to the repository and needs the dev server (pnpm dev).</span>}
      {error && <span className="error">{error}</span>}
    </>
  )
}

/** "Resolve": moves an assumption into a chosen layer as a resolved interpretation (dev server only). */
function ResolveControl({ a }: { a: Assertion }) {
  const target = a.target ? assertionById.get(a.target) : null
  const [layer, setLayer] = useState<string>(target ? specLayer(target.spec) : 'golive')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'readonly'>('idle')
  const [error, setError] = useState<string | null>(null)
  async function resolveNow() {
    setState('busy')
    setError(null)
    try {
      const res = await fetch('/__assumptions/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, layer }) })
      if (res.status === 404 && !res.headers.get('content-type')?.includes('json')) return setState('readonly')
      const body = await res.json()
      if (!res.ok) {
        setError((body.error ?? [res.statusText]).join('; '))
        setState('idle')
        return
      }
      setState('done')
    } catch {
      setState('readonly')
    }
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
      <label className="meta" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        into
        <select className="field-input" value={layer} onChange={(e) => setLayer(e.target.value)} disabled={state !== 'idle'} aria-label="Layer to resolve into">
          {RESOLVE_TARGETS.map((t) => (
            <option key={t.layer} value={t.layer}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-primary" onClick={resolveNow} disabled={state !== 'idle'}>
        {state === 'busy' ? 'Resolving…' : 'Resolve'}
      </button>
      {state === 'done' && <span className="success">Resolved. The page reloads with the updated layer.</span>}
      {state === 'readonly' && <span className="meta">Resolving writes to the repository and needs the dev server (pnpm dev).</span>}
      {error && <span className="error">{error}</span>}
    </div>
  )
}

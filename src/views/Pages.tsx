import { useEffect, useMemo, useState } from 'react'
import { LayerBadges, LayerName, LevelChip, SpecName, StatusTag, cssLayer } from '../components/bits'
import { ObjectView as ObjectViewLazy } from '../components/ObjectView'
import { OverruleEditor } from '../components/OverruleEditor'
import { StackPanel } from '../components/StackPanel'
import type { EffectiveRule } from '../model/resolve'
import type { Assertion, Role } from '../model/schema'
import { href } from '../lib/router'
import {
  C2BO_URL,
  ROLE_LABEL,
  VIEW_ROLES,
  assertionById,
  ds,
  effective,
  layerById,
  layersTouching,
  locatorText,
  rolesOf,
  specById,
  stackOf,
  subjectById,
  useViewCtx,
} from '../lib/store'

// Subject / assertion pages ---------------------------------------------------------------------------------------

export function SubjectPage({ subjectId, focus }: { subjectId: string; focus?: string }) {
  const [editing, setEditing] = useState<string | null>(null)
  const steps = ds.flows.flatMap((f) => f.steps.filter((s) => s.subject === subjectId || subjectId.startsWith(`${s.subject}.`)).map((s) => ({ f, s })))
  const examples = ds.examples.filter((e) => Object.values(e.annotations).includes(subjectId) || e.subject === subjectId)
  useEffect(() => {
    if (!focus) return
    const el = document.getElementById(`stratum-${focus.replace(/[^a-z0-9_-]/gi, '_')}`)
    el?.scrollIntoView({ block: 'center' })
    el?.animate?.([{ boxShadow: 'inset 0 0 0 2px var(--focus)' }, { boxShadow: 'inset 0 0 0 0 transparent' }], { duration: 1600 })
  }, [focus, subjectId])
  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <StackPanel subjectId={subjectId} onAddOverrule={setEditing} />
      {(steps.length > 0 || examples.length > 0) && (
        <>
          <h2 className="section">Where it appears</h2>
          <ul>
            {steps.map(({ f, s }) => (
              <li key={`${f.id}/${s.id}`}>
                <a href={href(['flow', f.id], { step: s.id, subject: subjectId === s.subject ? null : subjectId })}>
                  {f.title}, step {f.steps.indexOf(s) + 1}: {s.label}
                </a>
              </li>
            ))}
            {examples
              .filter((e) => !steps.some(({ s }) => s.example === e.id))
              .map((e) => (
                <li key={e.id}>
                  <a href={href(['object', e.id])}>{e.title}</a>
                </li>
              ))}
          </ul>
        </>
      )}
      <OverruleEditor subjectId={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

export function AssertionPage({ assertionId }: { assertionId: string }) {
  const a = assertionById.get(assertionId)
  if (!a) return <div className="page">Unknown assertion “{assertionId}”.</div>
  return <SubjectPage subjectId={a.subject} focus={a.id} />
}

// Specs -----------------------------------------------------------------------------------------------------------

export function SpecsIndex() {
  return (
    <div className="page">
      <h1>Specs</h1>
      <p className="lede">Every source the stacks cite, by precedence layer, with the version each quote was checked against.</p>
      {ds.layers.map((l) => {
        const specs = ds.specs.filter((s) => s.layer === l.id)
        if (specs.length === 0) return null
        return (
          <section key={l.id}>
            <h2 className="section">
              <LayerName id={l.id}>{l.label}</LayerName>
            </h2>
            <p className="meta" style={{ marginTop: -6 }}>{l.description}</p>
            <table className="data">
              <tbody>
                {specs.map((s) => {
                  const n = ds.assertions.filter((a) => a.spec === s.id).length
                  return (
                    <tr key={s.id}>
                      <td style={{ width: '46%' }}>
                        <a href={href(['spec', s.id])}>{s.title}</a>
                      </td>
                      <td>{s.version}</td>
                      <td className="meta">{n} statements</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )
      })}
    </div>
  )
}

export function SpecPage({ specId }: { specId: string }) {
  const spec = specById.get(specId)
  if (!spec) return <div className="page">Unknown spec “{specId}”.</div>
  const items = ds.assertions.filter((a) => a.spec === specId)
  const groups = new Map<string, Assertion[]>()
  for (const a of items) {
    const key = a.locator.section ? `§${a.locator.section}` : (a.locator.at ?? 'Other').replace(/,.*$/, '')
    groups.set(key, [...(groups.get(key) ?? []), a])
  }
  const sortedKeys = [...groups.keys()].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
  return (
    <div className="page">
      <div className="meta" style={cssLayer(spec.layer)}>
        <LayerName id={spec.layer}>{layerById.get(spec.layer)?.label}</LayerName>
      </div>
      <h1>{spec.title}</h1>
      <p className="lede">
        {spec.version}
        {spec.binding_via ? `. Binding via ${spec.binding_via}` : ''}. {spec.note}
      </p>
      <p className="meta">
        {spec.source.url && (
          <a href={spec.source.url} target="_blank" rel="noreferrer">
            Source
          </a>
        )}
        {spec.source.local && <>. Local copy: {spec.source.local}</>}
      </p>
      {specId === 'cir-2026-1731' && (
        <p>
          <a className="btn" href={href(['spec', specId, 'adaptations'])} style={{ textDecoration: 'none' }}>
            View every adaptation of the ETSI profiles
          </a>
        </p>
      )}
      {sortedKeys.map((k) => (
        <section key={k}>
          <h2 className="section">{k}</h2>
          <table className="data">
            <tbody>
              {groups.get(k)!.map((a) => (
                <tr key={a.id}>
                  <td style={{ width: 210 }}>
                    <a className="mono" href={href(['assertion', a.id])}>
                      {a.locator.req ?? locatorText(a)}
                    </a>
                    <div className="meta">
                      {a.relation} {a.level && a.relation !== 'voids' ? <LevelChip level={a.level} /> : null}
                    </div>
                  </td>
                  <td>
                    <a href={href(['subject', a.subject])}>{subjectById.get(a.subject)?.title}</a>
                    {a.quote && <p className="quote">{a.quote}</p>}
                    {a.review && <div className="review">{a.review.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

const EFFECT: Record<string, string> = { voids: 'Void', adapts: 'Reworded', replaces: 'Replaced' }

export function AdaptationsPage() {
  const vc = useViewCtx()
  const rows = ds.assertions.filter((a) => a.spec === 'cir-2026-1731' && ['voids', 'adapts', 'replaces'].includes(a.relation))
  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <h1>How CIR (EU) 2026/1731 adapts the ETSI profiles</h1>
      <p className="lede">
        Annex XI applies ETSI TS 119 472-3 and Annex XII applies TS 119 472-2 with adaptations. The ETSI text applies
        unchanged everywhere else. The last column is the rule that results once every layer is applied, which is not
        always what the adaptation alone suggests.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: '26%' }}>ETSI base text</th>
            <th style={{ width: '26%' }}>CIR text</th>
            <th>Effect</th>
            <th style={{ width: '28%' }}>Net result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const t = a.target ? assertionById.get(a.target) : null
            const stack = stackOf(a.subject)
            const role = rolesOf(stack, vc.view)[0] ?? (VIEW_ROLES[vc.view][0] as Role)
            const r = effective(a.subject, role, vc)
            return (
              <tr key={a.id}>
                <td>
                  {t ? (
                    <>
                      <a className="mono" href={href(['assertion', t.id])}>
                        {t.locator.req ?? locatorText(t)}
                      </a>
                      <p className={`quote ${a.relation === 'voids' ? 'struck' : ''}`}>{t.quote}</p>
                    </>
                  ) : (
                    <span className="meta">ETSI text not recorded yet</span>
                  )}
                </td>
                <td>
                  <a className="mono" href={href(['assertion', a.id])}>
                    {a.locator.at}
                  </a>
                  <p className="quote">{a.quote}</p>
                </td>
                <td>
                  <strong>{EFFECT[a.relation]}</strong>
                  {a.level && a.relation !== 'voids' && (
                    <div>
                      {t?.level && <LevelChip level={t.level} />} → <LevelChip level={a.level} />
                    </div>
                  )}
                </td>
                <td>
                  <a href={href(['subject', a.subject])}>{subjectById.get(a.subject)?.title}</a>
                  <div style={{ marginTop: 4 }}>
                    <LevelChip level={r.level} /> <span className="meta">{ROLE_LABEL[role]}</span>{' '}
                    {r.decidedBy[0] && (
                      <span className="meta">
                        <SpecName specId={r.decidedBy[0].spec} /> {locatorText(r.decidedBy[0])}
                      </span>
                    )}{' '}
                    <StatusTag rule={r} />
                  </div>
                  {a.review && <div className="review">{a.review.reason}</div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Review ------------------------------------------------------------------------------------------------------------

export function ReviewPage() {
  const vc = useViewCtx()
  const results = useMemo(() => {
    const out: { subject: string; role: Role; rule: EffectiveRule }[] = []
    for (const s of ds.subjects) {
      const stack = stackOf(s.id)
      if (stack.length === 0) continue
      const roles = rolesOf(stack, 'issuer').concat(rolesOf(stack, 'verifier')).filter((r, i, all) => all.indexOf(r) === i)
      for (const role of roles.length ? roles : (['wallet'] as Role[]))
        out.push({ subject: s.id, role, rule: effective(s.id, role, vc) })
    }
    return out
  }, [vc])
  const review = ds.assertions.filter((a) => a.verified === 'needs-review')
  const conflicts = results.filter((r) => r.rule.status === 'conflict')
  const silent = ds.assertions.filter((a) => a.relation === 'silent')
  const undecided = results.filter((r) => r.rule.status === 'undecided')
  const unverified = ds.assertions.filter((a) => a.verified === 'unverified')
  const deviations = ds.assertions.filter((a) => a.relation === 'deviates')
  const covered = new Set(ds.assertions.flatMap((a) => a.xref.filter((x) => x.source === 'c2bo').map((x) => x.id)))
  const c2boOpen = ds.c2bo?.groups.flatMap((g) => g.requirements.filter((r) => !covered.has(r.id)).map((r) => ({ ...r, group: g.name }))) ?? []

  return (
    <div className="page">
      <h1>Contradictions and gaps</h1>
      <p className="lede">
        Everything a human has to decide or confirm: statements flagged for review, contradictions between layers, places
        where a binding spec is silent, rules nobody decides, and conformance requirements not yet cross-referenced.
      </p>
      <Counts
        items={[
          ['Needs review', review.length],
          ['Contradictions', conflicts.length],
          ['Deviations', deviations.length],
          ['Silent', silent.length],
          ['No binding rule', undecided.length],
          ['Unverified', unverified.length],
          ['c2bo not linked', c2boOpen.length],
        ]}
      />

      <h2 className="section">Needs review ({review.length})</h2>
      <AssertionTable items={review} reason />

      <h2 className="section">Contradictions ({conflicts.length})</h2>
      {conflicts.length === 0 ? (
        <p className="meta">No two active assertions of the same rank disagree in the current view.</p>
      ) : (
        <ul>
          {conflicts.map((c) => (
            <li key={`${c.subject}/${c.role}`}>
              <a href={href(['subject', c.subject])}>{subjectById.get(c.subject)?.title}</a> ({ROLE_LABEL[c.role]}):{' '}
              {c.rule.conflicts.map((x) => x.reason).join('; ')}
            </li>
          ))}
        </ul>
      )}

      <h2 className="section">Deviations ({deviations.length})</h2>
      {deviations.length === 0 ? <p className="meta">No implementation deviations are recorded yet. The German implementation layer arrives in phase 4.</p> : <AssertionTable items={deviations} />}

      <h2 className="section">Binding spec is silent ({silent.length})</h2>
      <AssertionTable items={silent} note />

      <h2 className="section">No binding rule in the current view ({undecided.length})</h2>
      <p className="meta">Subjects with recorded statements but nothing normative left after voids, for the role shown.</p>
      <ul>
        {undecided.map((u) => (
          <li key={`${u.subject}/${u.role}`}>
            <a href={href(['subject', u.subject])}>{subjectById.get(u.subject)?.title}</a> <span className="meta">({ROLE_LABEL[u.role]})</span>
            {u.rule.neutralised.length > 0 && <span className="meta"> voided by {u.rule.neutralised.map((n) => n.by.id).join(', ')}</span>}
            {u.rule.upcoming.length > 0 && <span className="meta"> applies from {u.rule.upcoming[0]!.date}</span>}
          </li>
        ))}
      </ul>

      <h2 className="section">Unverified ({unverified.length})</h2>
      {unverified.length === 0 ? <p className="meta">Every quote was found in the local copy of its pinned version.</p> : <AssertionTable items={unverified} />}

      <h2 className="section">c2bo requirements not yet cross-referenced ({c2boOpen.length})</h2>
      <p className="meta">
        From the {ds.c2bo?.retrieved} snapshot of the{' '}
        <a href={C2BO_URL} target="_blank" rel="noreferrer">
          issuer conformance tester
        </a>
        . Each one is a candidate for new assertions once its quote is checked against our own copies.
      </p>
      <table className="data">
        <tbody>
          {c2boOpen.map((r) => (
            <tr key={r.id}>
              <td className="mono" style={{ width: 260 }}>
                {r.id}
              </td>
              <td>
                {r.title}
                <div className="meta">{r.group}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Counts({ items }: { items: [string, number][] }) {
  return (
    <dl style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', margin: '18px 0 0' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <dt className="meta">{k}</dt>
          <dd style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function AssertionTable({ items, reason, note }: { items: Assertion[]; reason?: boolean; note?: boolean }) {
  return (
    <table className="data">
      <tbody>
        {items.map((a) => (
          <tr key={a.id}>
            <td style={{ width: 240 }}>
              <SpecName specId={a.spec} />{' '}
              <a className="mono" href={href(['assertion', a.id])}>
                {locatorText(a)}
              </a>
            </td>
            <td>
              <a href={href(['subject', a.subject])}>{subjectById.get(a.subject)?.title}</a>
              {reason && a.review && <p style={{ margin: '4px 0 0' }}>{a.review.reason}</p>}
              {note && a.note && <p style={{ margin: '4px 0 0' }}>{a.note}</p>}
              {note && a.probe && <p className="meta" style={{ margin: '4px 0 0' }}>Checked: “{a.probe}” does not occur in the text.</p>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Endpoints ---------------------------------------------------------------------------------------------------------

const SERVER_LABEL: Record<string, string> = { as: 'Authorization Server', issuer: 'Credential Issuer', verifier: 'Verifier', wallet: 'Wallet', 'wallet-provider': 'Wallet Provider' }

export function EndpointsPage() {
  const vc = useViewCtx()
  const servers = vc.view === 'issuer' ? ['as', 'issuer'] : ['verifier']
  const eps = ds.subjects.filter((s) => s.endpoint && servers.includes(s.endpoint.server))
  return (
    <div className="page">
      <h1>{vc.view === 'issuer' ? 'Issuer' : 'Verifier'} endpoints</h1>
      <p className="lede">The HTTP endpoints this side has to serve, with the layers that shape each one.</p>
      {eps.length === 0 ? (
        <div className="notice">No verifier endpoints are modelled yet; they come with the presentation flows in phase 3.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Served by</th>
              <th>Message</th>
              <th>Layers</th>
              <th>In flow</th>
            </tr>
          </thead>
          <tbody>
            {eps.map((s) => {
              const parts = [s.id, ...ds.subjects.filter((x) => x.id.startsWith(`${s.id}.`)).map((x) => x.id)]
              const use = ds.flows.flatMap((f) => f.steps.filter((st) => st.subject === s.id).map((st) => ({ f, st })))
              return (
                <tr key={s.id}>
                  <td className="mono">{s.endpoint!.method}</td>
                  <td className="mono">{s.endpoint!.path}</td>
                  <td>{SERVER_LABEL[s.endpoint!.server]}</td>
                  <td>
                    <a href={href(['subject', s.id])}>{s.title}</a>
                  </td>
                  <td>
                    <LayerBadges layers={layersTouching(parts)} />
                  </td>
                  <td>
                    {use.map(({ f, st }) => (
                      <a key={f.id} href={href(['flow', f.id], { step: st.id })}>
                        step {f.steps.indexOf(st) + 1}
                      </a>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function ObjectPage({ exampleId }: { exampleId: string }) {
  const ex = ds.examples.find((e) => e.id === exampleId)
  const [sel, setSel] = useState<{ ptr: string; subject: string } | null>(null)
  if (!ex) return <div className="page">Unknown example “{exampleId}”.</div>
  return (
    <div className="flow-grid" style={{ gridTemplateColumns: 'minmax(420px,1fr) minmax(380px,1fr)' }}>
      <section>
        <div className="pane-body">
          <ObjectViewLazy exampleId={exampleId} selected={sel?.ptr} onSelect={(ptr, subject) => setSel({ ptr, subject })} />
        </div>
      </section>
      <section>
        <div className="pane-body">
          <StackPanel subjectId={sel?.subject ?? ex.subject} />
        </div>
      </section>
    </div>
  )
}


import { useEffect, useMemo, useState } from 'react'
import { LayerBadges, LayerName, LevelChip, SpecName, StatusTag, cssLayer, formatDate } from '../components/bits'
import { ObjectView as ObjectViewLazy } from '../components/ObjectView'
import { OverruleEditor, type EntryKind } from '../components/OverruleEditor'
import { StackPanel } from '../components/StackPanel'
import { annotationFor, entryPointers, viewOf } from '../model/pointer'
import type { EffectiveRule } from '../model/resolve'
import type { Assertion, Role } from '../model/schema'
import { stepExamples, stepNumber } from '../model/steps'
import { href } from '../lib/router'
import {
  C2BO_URL,
  LENS_STAGES,
  ROLE_LABEL,
  VIEW_ROLES,
  assertionById,
  draftIds,
  ds,
  effective,
  layerById,
  layerOf,
  layersForStage,
  layersTouching,
  locatorText,
  onSide,
  rolesOf,
  specById,
  stackOf,
  subjectById,
  useViewCtx,
} from '../lib/store'

// Subject / assertion pages ---------------------------------------------------------------------------------------

export function SubjectPage({ subjectId, focus }: { subjectId: string; focus?: string }) {
  const [editing, setEditing] = useState<{ subjectId: string; kind: EntryKind; entry?: Assertion } | null>(null)
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
      <StackPanel
        subjectId={subjectId}
        onAddOverrule={(subjectId, kind) => setEditing({ subjectId, kind })}
        onEditEntry={(a) => setEditing({ subjectId: a.subject, kind: a.spec === 'golive-compromises' ? 'golive' : 'assumption', entry: a })}
      />
      {(steps.length > 0 || examples.length > 0) && (
        <>
          <h2 className="section">Where it appears</h2>
          <ul>
            {steps.map(({ f, s }) => (
              <li key={`${f.id}/${s.id}`}>
                <a href={href(['flow', f.id], { step: s.id, subject: subjectId === s.subject ? null : subjectId })}>
                  {f.title}, step {stepNumber(f, s)}: {s.label}
                </a>
              </li>
            ))}
            {examples
              .filter((e) => !steps.some(({ s }) => stepExamples(s).includes(e.id)))
              .map((e) => (
                <li key={e.id}>
                  <a href={href(['object', e.id])}>{e.title}</a>
                </li>
              ))}
          </ul>
        </>
      )}
      <OverruleEditor subjectId={editing?.subjectId ?? null} kind={editing?.kind} entry={editing?.entry} onClose={() => setEditing(null)} />
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
  const vc = useViewCtx()
  const side = vc.view === 'issuer' ? 'issuer' : 'verifier'
  // A spec is listed when it has statements on this side, or none at all yet (an empty authored layer).
  const all = (specId: string) => ds.assertions.filter((a) => a.spec === specId)
  const here = (specId: string) => all(specId).filter((a) => onSide(a.subject, vc.view))
  const listed = ds.specs.filter((s) => here(s.id).length > 0 || all(s.id).length === 0)
  const hidden = ds.specs.length - listed.length
  return (
    <div className="page">
      <h1>Specs</h1>
      <p className="lede">
        Every source the {side} stacks cite, by precedence layer, with the version each quote was checked against.
        {hidden > 0 && ` ${hidden} more ${hidden === 1 ? 'is' : 'are'} cited only on the ${side === 'issuer' ? 'verifier' : 'issuer'} side.`}
      </p>
      {ds.layers.map((l) => {
        const specs = listed.filter((s) => s.layer === l.id)
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
                  const n = here(s.id).length
                  return (
                    <tr key={s.id}>
                      <td style={{ width: '46%' }}>
                        <a href={href(['spec', s.id])}>{s.title}</a>
                      </td>
                      <td>{s.version}</td>
                      <td className="meta">{statements(n)}</td>
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

const statements = (n: number) => `${n} ${n === 1 ? 'statement' : 'statements'}`

export function SpecPage({ specId }: { specId: string }) {
  const vc = useViewCtx()
  const spec = specById.get(specId)
  if (!spec) return <div className="page">Unknown spec “{specId}”.</div>
  const everything = ds.assertions.filter((a) => a.spec === specId)
  const items = everything.filter((a) => onSide(a.subject, vc.view))
  const other = vc.view === 'issuer' ? 'verifier' : 'issuer'
  const elsewhere = everything.length - items.length
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
      {elsewhere > 0 && (
        <p className="meta">
          {items.length === 0
            ? `No statements on the ${vc.view} side; ${statements(elsewhere)} on the ${other} side. Switch the side at the top to see them.`
            : `Showing ${statements(items.length)} on the ${vc.view} side; ${elsewhere} more on the ${other} side.`}
        </p>
      )}
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
  const rows = ds.assertions.filter(
    (a) => a.spec === 'cir-2026-1731' && ['voids', 'adapts', 'replaces'].includes(a.relation) && onSide(a.subject, vc.view),
  )
  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <h1>How CIR (EU) 2026/1731 adapts the ETSI profiles</h1>
      <p className="lede">
        {vc.view === 'issuer' ? 'Issuer side: Annex XI applies ETSI TS 119 472-3' : 'Verifier side: Annex XII applies ETSI TS 119 472-2'} with
        adaptations. The ETSI text applies
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

// d-you state -------------------------------------------------------------------------------------------------------

const DEVIATION_EFFECT: Record<string, string> = { ...EFFECT, deviates: 'Deviates' }

type WindowState = 'active' | 'upcoming' | 'ended'
function windowState(a: Assertion, asOf: string): WindowState {
  if (a.window?.from && a.window.from > asOf) return 'upcoming'
  if (a.window?.until && a.window.until < asOf) return 'ended'
  return 'active'
}

function windowText(a: Assertion): string {
  const w = a.window
  if (!w?.from && !w?.until) return 'No end date'
  if (w.from && w.until) return `${formatDate(w.from)} to ${formatDate(w.until)}`
  return w.from ? `From ${formatDate(w.from)}, no end date` : `Until ${formatDate(w.until!)}`
}

/**
 * Where d-you deviates from the binding rules: every entry of the wallet solution layer (go-live compromises and
 * resolved readings) for the current side, split by whether its window is open on the as-of date.
 */
function DyouStatePage() {
  const vc = useViewCtx()
  const all = ds.assertions.filter((a) => layerOf(a) === 'golive')
  const other = vc.view === 'issuer' ? 'verifier' : 'issuer'
  const otherCount = all.filter((a) => !onSide(a.subject, vc.view)).length
  const mine = all
    .filter((a) => onSide(a.subject, vc.view))
    .sort((x, y) => (y.window?.from ?? '').localeCompare(x.window?.from ?? '') || x.id.localeCompare(y.id))
  const compromises = mine.filter((a) => a.spec !== 'resolved-golive')
  const by = (s: WindowState) => compromises.filter((a) => windowState(a, vc.asOf) === s)
  const [active, upcoming, ended] = [by('active'), by('upcoming'), by('ended')]
  const readings = mine.filter((a) => a.spec === 'resolved-golive')
  return (
    <>
      <h1>d-you state</h1>
      <p className="lede">
        Where d-you deviates from the binding rules on {formatDate(vc.asOf)}, {vc.view} side: the go-live compromises in
        force, those still to start or already ended, and the readings resolved into the d-you layer. The last column is
        the rule that results once every layer is applied.
        {otherCount > 0 && (
          <>
            {' '}
            <a href={href(['wallets', 'd-you'], { role: other === 'issuer' ? 'issuer' : null })}>
              {otherCount} more on the {other} side
            </a>
            .
          </>
        )}
      </p>
      <Counts
        items={[
          ['In force', active.length],
          ['Upcoming', upcoming.length],
          ['Ended', ended.length],
          ['Resolved readings', readings.length],
        ]}
      />

      <h2 className="section">In force ({active.length})</h2>
      {active.length === 0 ? (
        <p className="meta">No go-live compromise applies on this date for the {vc.view} side.</p>
      ) : (
        <DeviationTable items={active} />
      )}
      {upcoming.length > 0 && (
        <>
          <h2 className="section">Upcoming ({upcoming.length})</h2>
          <p className="meta">Agreed, but their window opens after {formatDate(vc.asOf)}.</p>
          <DeviationTable items={upcoming} />
        </>
      )}
      {ended.length > 0 && (
        <>
          <h2 className="section">Ended ({ended.length})</h2>
          <p className="meta">Their window has closed: the underlying rule applies again.</p>
          <DeviationTable items={ended} />
        </>
      )}
      {readings.length > 0 && (
        <>
          <h2 className="section">Resolved readings ({readings.length})</h2>
          <p className="meta">How d-you reads an unclear or defective rule; each replaces the literal reading of its target.</p>
          <DeviationTable items={readings} />
        </>
      )}
    </>
  )
}

const WALLET_TABS = [
  { id: 'd-you', label: 'd-you state' },
  { id: 'compare', label: 'Compare' },
]

/** The wallet solution layer: one tab per national wallet solution (d-you today), and their comparison. */
export function WalletsView({ tab = 'd-you' }: { tab?: string }) {
  const current = WALLET_TABS.some((t) => t.id === tab) ? tab : 'd-you'
  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <nav className="nav subnav" aria-label="Wallets">
        {WALLET_TABS.map((t) => (
          <a key={t.id} href={href(['wallets', t.id])} aria-current={t.id === current ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
      {current === 'compare' ? (
        // Placeholder: comparing national wallet solutions. No content or logic yet.
        <h1>Compare wallets</h1>
      ) : (
        <DyouStatePage />
      )}
    </div>
  )
}

function DeviationTable({ items }: { items: Assertion[] }) {
  const vc = useViewCtx()
  // The net result is always resolved with every layer on, so the page shows the d-you state whatever the lens says.
  const allLayers = layersForStage(LENS_STAGES.length - 1)
  return (
    <table className="data">
      <thead>
        <tr>
          <th style={{ width: '26%' }}>Binding rule</th>
          <th style={{ width: '30%' }}>d-you</th>
          <th>Effect</th>
          <th style={{ width: '26%' }}>Net result</th>
        </tr>
      </thead>
      <tbody>
        {items.map((a) => {
          const t = a.target ? assertionById.get(a.target) : null
          const role = a.applies_to.role?.[0] ?? rolesOf(stackOf(a.subject), vc.view)[0] ?? (VIEW_ROLES[vc.view][0] as Role)
          const on = a.applies_to
          const variant = { grant: on.grant?.[0], format: on.format?.[0], transport: on.transport?.[0], device: on.device?.[0] }
          const r = effective(a.subject, role, vc, variant, allLayers)
          return (
            <tr key={a.id}>
              <td>
                {t ? (
                  <>
                    <SpecName specId={t.spec} />{' '}
                    <a className="mono" href={href(['assertion', t.id])}>
                      {locatorText(t)}
                    </a>
                    <p className={`quote ${a.relation === 'voids' ? 'struck' : ''}`}>{t.quote}</p>
                  </>
                ) : (
                  <span className="meta">No target rule</span>
                )}
              </td>
              <td>
                <a className="mono" href={href(['assertion', a.id])}>
                  {locatorText(a)}
                </a>
                {draftIds.has(a.id) && (
                  <>
                    {' '}
                    <span className="tag status-review">Local draft</span>
                  </>
                )}
                <p className="quote">{a.quote}</p>
                <div className="meta" style={{ marginTop: 4 }}>
                  {windowText(a)}
                  {a.decided_by && <> · decided by {a.decided_by}</>}
                </div>
              </td>
              <td>
                <strong>{DEVIATION_EFFECT[a.relation] ?? a.relation}</strong>
                {a.level && a.relation !== 'voids' && (
                  <div>
                    {t?.level && <LevelChip level={t.level} />} → <LevelChip level={a.level} />
                  </div>
                )}
              </td>
              <td>
                <a href={href(['subject', a.subject])}>{subjectById.get(a.subject)?.title ?? a.subject}</a>
                <div style={{ marginTop: 4 }}>
                  <LevelChip level={r.level} /> <span className="meta">{ROLE_LABEL[role]}</span>{' '}
                  {r.decidedBy[0] && (
                    <span className="meta">
                      <SpecName specId={r.decidedBy[0].spec} /> {locatorText(r.decidedBy[0])}
                    </span>
                  )}{' '}
                  <StatusTag rule={r} />
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Review ------------------------------------------------------------------------------------------------------------

/** Worked examples from the proposal (shown on the review page for the current side), linked so a reader can check the resolution against the sources. */
const HIGHLIGHTS: { subject: string; text: string }[] = [
  { subject: 'vci.token-request.oauth-client-attestation', text: 'WIA on the token request: OpenID4VCI permits it, HAIP recommends the format, ETSI and the CIR require it for both grants.' },
  { subject: 'vci.metadata.issuer_info.registration_cert', text: 'Registration certificate in issuer_info: ETSI says “may contain”, the CIR rewords it to “shall contain”.' },
  { subject: 'vci.refresh-token', text: 'Refresh tokens: HAIP recommends them, ETSI (which ranks higher) only permits them.' },
  { subject: 'vp.authorization-response.encryption', text: 'Response encryption in OpenID4VP: the CIR voids the ETSI requirement, but HAIP still requires encryption.' },
  { subject: 'vp.request-object.verifier_info.registration_cert', text: 'verifier_info: the CIR drops the ETSI “if the RP has one” condition.' },
  { subject: 'vp.wallet.validate-registration-cert', text: 'Wallets validate RP registration certificates only from 11 August 2028.' },
]

function LayersDisagree() {
  const vc = useViewCtx()
  const highlights = HIGHLIGHTS.filter((h) => onSide(h.subject, vc.view))
  return (
    <>
      <h2 className="section">Where the layers disagree ({highlights.length})</h2>
      <p className="meta">Worked examples where a higher layer changes what a lower one says, for the {vc.view} side.</p>
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: '38%' }}>Subject</th>
            <th>Effective rule</th>
            <th>What happened</th>
          </tr>
        </thead>
        <tbody>
          {highlights.map((h) => {
            const stack = stackOf(h.subject)
            const role = rolesOf(stack, vc.view)[0] ?? 'wallet'
            const r = effective(h.subject, role, vc)
            return (
              <tr key={h.subject}>
                <td>
                  <a href={href(['subject', h.subject])}>{subjectById.get(h.subject)?.title}</a>
                  <div>
                    <LayerBadges layers={layersTouching([h.subject])} />
                  </div>
                </td>
                <td>
                  <LevelChip level={r.level} />{' '}
                  {r.decidedBy[0] && (
                    <span className="meta">
                      <SpecName specId={r.decidedBy[0].spec} /> {locatorText(r.decidedBy[0])}
                    </span>
                  )}
                </td>
                <td>{h.text}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

    </>
  )
}

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
  // Subjects that flows or example fields point to but that have no statement yet (sketched parts).
  const withStack = new Set(ds.assertions.map((a) => a.subject))
  const used = new Map<string, string[]>()
  const note = (subject: string, where: string) => used.set(subject, [...new Set([...(used.get(subject) ?? []), where])])
  for (const f of ds.flows) for (const st of f.steps) note(st.subject, f.title)
  for (const e of ds.examples) {
    const view = viewOf(ds.encoded[e.id]!)
    for (const p of entryPointers(view)) {
      const sub = annotationFor(p, e.annotations, ds.fieldmap)
      if (sub) note(sub, e.title)
    }
  }
  const unsourced = [...used.entries()].filter(([sub]) => !withStack.has(sub))
  const covered = new Set(ds.assertions.flatMap((a) => a.xref.filter((x) => x.source === 'c2bo').map((x) => x.id)))
  const c2boOpen = ds.c2bo?.groups.flatMap((g) => g.requirements.filter((r) => !covered.has(r.id)).map((r) => ({ ...r, group: g.name }))) ?? []

  return (
    <div className="page">
      <h1>Contradictions and gaps</h1>
      <p className="lede">
        Everything a human has to decide or confirm, starting with where the layers disagree for the current side:
        statements flagged for review, contradictions between layers, places
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
          ['Not sourced yet', unsourced.length],
          ['c2bo not linked', c2boOpen.length],
        ]}
      />

      <LayersDisagree />

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
      {deviations.length === 0 ? <p className="meta">No implementation deviations are recorded yet.</p> : <AssertionTable items={deviations} />}

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

      <h2 className="section">Not sourced yet ({unsourced.length})</h2>
      <p className="meta">Steps and fields of the sketched flows that are clickable but have no spec statement recorded yet.</p>
      <table className="data">
        <tbody>
          {unsourced.map(([sub, where]) => (
            <tr key={sub}>
              <td style={{ width: 340 }}>
                <a href={href(['subject', sub])}>{subjectById.get(sub)?.title ?? sub}</a>
                <div className="meta mono">{sub}</div>
              </td>
              <td className="meta">{where.join('; ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

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
              {reason &&
                ds.assertions
                  .filter((x) => x.target === a.id && x.interpretation)
                  .map((x) => (
                    <p key={x.id} className="meta" style={{ margin: '4px 0 0' }}>
                      {x.spec === 'assumptions' ? 'Assumed' : 'Resolved'} in <a href={href(['assertion', x.id])}>{x.id}</a>
                    </p>
                  ))}
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

/** The HTTP endpoints the current side has to serve; shown on the flows page. */
export function EndpointsTable() {
  const vc = useViewCtx()
  const servers = vc.view === 'issuer' ? ['as', 'issuer'] : ['verifier']
  const eps = ds.subjects.filter((s) => s.endpoint && servers.includes(s.endpoint.server))
  return (
    <>
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
              // The message opens on its step in the sequence diagram, where its example dataset is shown.
              const shown = use.find(({ st }) => stepExamples(st).length) ?? use[0]
              return (
                <tr key={s.id}>
                  <td className="mono">{s.endpoint!.method}</td>
                  <td className="mono">{s.endpoint!.path}</td>
                  <td>{SERVER_LABEL[s.endpoint!.server]}</td>
                  <td>
                    <a href={shown ? href(['flow', shown.f.id], { step: shown.st.id }) : href(['subject', s.id])}>{s.title}</a>
                  </td>
                  <td>
                    <LayerBadges layers={layersTouching(parts)} />
                  </td>
                  <td>
                    {use.map(({ f, st }) => (
                      <div key={`${f.id}/${st.id}`}>
                        <a href={href(['flow', f.id], { step: st.id })} title={f.title}>
                          step {stepNumber(f, st)}
                        </a>{' '}
                        <span className="meta">{f.title.split(' — ').pop()}</span>
                      </div>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
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


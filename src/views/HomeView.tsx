import { LayerBadges, LevelChip, SpecName } from '../components/bits'
import { buildOpenApi } from '../model/openapi'
import { stringify } from 'yaml'
import { href } from '../lib/router'
import { ds, effective, layersTouching, locatorText, rolesOf, stackOf, subjectById, useViewCtx } from '../lib/store'

/** Worked examples from the proposal, linked so a reader can check the resolution against the sources. */
const HIGHLIGHTS: { subject: string; text: string }[] = [
  { subject: 'vci.token-request.oauth-client-attestation', text: 'WIA on the token request: OpenID4VCI permits it, HAIP recommends the format, ETSI and the CIR require it for both grants.' },
  { subject: 'vci.metadata.issuer_info.registration_cert', text: 'Registration certificate in issuer_info: ETSI says “may contain”, the CIR rewords it to “shall contain”.' },
  { subject: 'vci.refresh-token', text: 'Refresh tokens: HAIP recommends them, ETSI (which ranks higher) only permits them.' },
  { subject: 'vp.authorization-response.encryption', text: 'Response encryption in OpenID4VP: the CIR voids the ETSI requirement, but HAIP still requires encryption.' },
  { subject: 'vp.request-object.verifier_info.registration_cert', text: 'verifier_info: the CIR drops the ETSI “if the RP has one” condition.' },
  { subject: 'vp.wallet.validate-registration-cert', text: 'Wallets validate RP registration certificates only from 11 August 2028.' },
]

export function HomeView() {
  const vc = useViewCtx()
  const flows = ds.flows.filter((f) => f.role === vc.view)
  const highlights = HIGHLIGHTS.filter((h) => (vc.view === 'issuer' ? h.subject.startsWith('vci.') : h.subject.startsWith('vp.')))

  function download() {
    const doc = buildOpenApi(ds, { view: vc.view, asOf: vc.asOf, layers: vc.layers, linkBase: window.location.href.split('#')[0] })
    const blob = new Blob([stringify(doc, { lineWidth: 120 })], { type: 'application/yaml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${vc.view}.openapi.yaml`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const exportable = ds.subjects.some((s) => s.endpoint && (vc.view === 'issuer' ? ['as', 'issuer'] : ['verifier']).includes(s.endpoint.server))

  return (
    <div className="page">
      <h2 className="section" style={{ marginTop: 0 }}>Flows</h2>
      {flows.length === 0 ? (
        <div className="notice">
          The verifier flows (OpenID4VP redirect same and cross device, Digital Credentials API) come in phase 3. The
          verifier rules already recorded are listed below and in the review list.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {flows.map((f) => (
            <li key={f.id} className="notice" style={{ color: 'var(--ink)' }}>
              <a href={href(['flow', f.id])} style={{ fontWeight: 600, fontSize: 15 }}>
                {f.title}
              </a>
              <p style={{ margin: '4px 0 6px', color: 'var(--ink-2)' }}>{f.summary}</p>
              <span className="meta">
                {f.steps.length} steps, {f.participants.map((p) => p.label).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section">Where the layers disagree</h2>
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

      <h2 className="section">OpenAPI</h2>
      <p className="lede">
        Download an OpenAPI 3.1 description of the {vc.view === 'issuer' ? 'authorization server and credential issuer' : 'verifier'} endpoints,
        resolved for the current date and layer lens. Required fields follow the effective SHALL rules, and every annotated
        field carries an <code>x-provenance</code> extension with the deciding requirement.
      </p>
      <button className="btn btn-primary" onClick={download} disabled={!exportable}>
        Download {vc.view}.openapi.yaml
      </button>
      {!exportable && <p className="meta">No verifier endpoints are modelled yet.</p>}
    </div>
  )
}

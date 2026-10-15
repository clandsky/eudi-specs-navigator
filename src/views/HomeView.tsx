import { LayerBadges, LevelChip, SpecName, cssLayer } from '../components/bits'
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

  const ranked = ds.layers.filter((l) => l.rank !== null && l.id !== 'primitive')
  const sourceChecked = ds.assertions.filter((a) => a.verified !== 'unverified').length

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>Who defines it. Who overrules it.</h1>
          <p className="lede">
            The {vc.view === 'issuer' ? 'issuer' : 'verifier'} side of the EUDI Wallet, drawn layer by layer. Every message
            and field carries its full provenance stack, from the base protocol that defines it to the binding law that
            rewords or voids it. The effective rule is computed, and every quote is checked against the pinned version of
            its source.
          </p>
        </div>
        <figure className="figure">
          <div className="strata-figure frame">
            {ranked.map((l) => (
              <div key={l.id} style={cssLayer(l.id)}>
                <span className="rank">{l.rank === 0 ? 'Top' : `Rank ${l.rank}`}</span>
                <span>{l.label}</span>
                <span className="bar" style={{ width: `${Math.max(14, 96 - (l.rank ?? 0) * 12)}px` }} />
              </div>
            ))}
          </div>
          <figcaption>Fig. 0&nbsp;&nbsp;Precedence, highest first</figcaption>
        </figure>
      </section>

      <dl className="counts">
        <div>
          <dt>Statements</dt>
          <dd>{ds.assertions.length}</dd>
        </div>
        <div>
          <dt>Quote-checked</dt>
          <dd>{sourceChecked}</dd>
        </div>
        <div>
          <dt>Sources</dt>
          <dd>{ds.specs.length}</dd>
        </div>
        <div>
          <dt>Fields and messages</dt>
          <dd>{ds.subjects.length}</dd>
        </div>
        <div>
          <dt>Open review items</dt>
          <dd>{ds.assertions.filter((a) => a.verified === 'needs-review').length}</dd>
        </div>
      </dl>

      <h2 className="section">Flows</h2>
      {flows.length === 0 ? (
        <div className="notice">
          The verifier flows (OpenID4VP redirect same and cross device, Digital Credentials API) come in phase 3. The
          verifier rules already recorded are listed below and in the review list.
        </div>
      ) : (
        <ul className="flow-list">
          {flows.map((f, i) => (
            <li key={f.id}>
              <a className="flow-card frame" href={href(['flow', f.id])}>
                <span className="idx">F-{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <h3>{f.title}</h3>
                  <p>{f.summary}</p>
                </span>
                <span className="meta">
                  {f.steps.length} steps
                  <br />
                  {f.participants.length} parties
                </span>
              </a>
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

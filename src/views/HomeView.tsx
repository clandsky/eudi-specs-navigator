import { compileProfile, profileMarkdown } from '../model/compile'
import { buildOpenApi, openApiYaml } from '../model/openapi'
import { href } from '../lib/router'
import { ds, useViewCtx } from '../lib/store'

export function HomeView() {
  const vc = useViewCtx()
  const flows = ds.flows.filter((f) => f.role === vc.view).sort((a, b) => a.order - b.order)

  const linkBase = window.location.href.split('#')[0]
  function save(name: string, text: string, type: string) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type }))
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }
  function download() {
    const doc = buildOpenApi(ds, { view: vc.view, asOf: vc.asOf, layers: vc.layers, linkBase })
    save(`${vc.view}.openapi.yaml`, openApiYaml(doc), 'application/yaml')
  }
  // The issuer side is the EAA provider's reference, the verifier side the relying party's (VP).
  const compiledName = vc.view === 'issuer' ? 'eaa' : 'vp'
  function downloadCompiled(as: 'md' | 'json') {
    const p = compileProfile(ds, { side: vc.view, asOf: vc.asOf, layers: vc.layers, linkBase })
    if (as === 'md') save(`${compiledName}.md`, profileMarkdown(p), 'text/markdown')
    else save(`${compiledName}.json`, `${JSON.stringify(p, null, 2)}\n`, 'application/json')
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
              <div className="meta" style={{ marginTop: 4 }}>
                {f.steps.filter((s) => !s.parent).length} steps, {f.participants.map((p) => p.label).join(', ')}
              </div>
            </li>
          ))}
        </ul>
      )}

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

      <h2 className="section">Compiled reference</h2>
      <p className="lede">
        The effective rules of every flow on this side in one document, without the provenance stacks: one row per field
        or obligation with its level per role, the deciding requirement and an example value, plus the validation checks,
        the rules that change later and the open points. Markdown for a developer guide (tables and Mermaid diagrams,
        safe for Docusaurus), JSON for tooling. Resolved for the current date and layer lens; every row links back here.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={() => downloadCompiled('md')}>
          Download {compiledName}.md
        </button>
        <button className="btn" onClick={() => downloadCompiled('json')}>
          Download {compiledName}.json
        </button>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'

interface Props {
  exampleId: string | null
  onClose: () => void
}

/**
 * Edits the decoded inputs of an example (http, json, jwts). In dev mode the server writes them back into the
 * example's YAML file and re-signs it; the page then reloads with the new body. Placeholders keep JWTs, keys and
 * hashes real: {{jwt:name}}, {{sdjwt:name}}, {{jwk:key}}, {{x5c:key}}, {{s256:text}}, and { use: example/jwt }.
 */
export function ExampleEditor({ exampleId, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [source, setSource] = useState('')
  const [file, setFile] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'readonly' | 'saving' | 'saved'>('loading')
  const [errors, setErrors] = useState<string[] | null>(null)
  const [assume, setAssume] = useState(true)
  const [why, setWhy] = useState('')
  const [decidedBy, setDecidedBy] = useState(`project owner (${new Date().toISOString().slice(0, 10)})`)

  useEffect(() => {
    if (!exampleId) {
      ref.current?.close()
      return
    }
    setErrors(null)
    setWhy('')
    setState('loading')
    ref.current?.showModal()
    fetch(`/__examples?id=${encodeURIComponent(exampleId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { source: string; file: string }) => {
        setSource(j.source)
        setFile(j.file)
        setState('ready')
      })
      .catch(() => setState('readonly'))
  }, [exampleId])

  async function save(e: FormEvent) {
    e.preventDefault()
    setState('saving')
    setErrors(null)
    const res = await fetch('/__examples', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: exampleId, source, ...(assume ? { assumption: { note: why, decided_by: decidedBy } } : {}) }),
    })
    const body = await res.json().catch(() => ({ error: [res.statusText] }))
    if (!res.ok) {
      setErrors(Array.isArray(body.error) ? body.error : [String(body.error)])
      setState('ready')
      return
    }
    setState('saved')
  }

  return (
    <dialog ref={ref} className="editor editor-wide" onClose={onClose} aria-labelledby="example-editor-title">
      <form method="dialog" onSubmit={save}>
        <div>
          <h2 id="example-editor-title" style={{ margin: 0, fontSize: 17 }}>
            Edit example body
          </h2>
          <p className="meta" style={{ margin: '4px 0 0' }}>
            {state === 'readonly'
              ? 'Editing writes into the repository and needs the dev server (pnpm dev). This build is read-only.'
              : `Decoded inputs of ${exampleId}, from ${file}. Saving re-signs the JWTs with the test keys and reloads the page.`}
          </p>
        </div>
        {state !== 'readonly' && (
          <>
            <textarea
              className="field-input mono"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
              aria-label="Example inputs as YAML"
              disabled={state === 'loading' || state === 'saving' || state === 'saved'}
            />
            <p className="meta" style={{ margin: 0 }}>
              Placeholders: <code>{'{{jwt:name}}'}</code> encoded JWT from <code>jwts</code>, <code>{'{{sdjwt:name}}'}</code>,{' '}
              <code>{'{{jwk:key}}'}</code> public key, <code>{'{{x5c:key}}'}</code> certificate chain, <code>{'{{s256:text}}'}</code> hash,{' '}
              <code>{'{ use: example/jwt }'}</code> to reuse another example's JWT. Annotations are not edited here; new fields
              stay clickable through the field map.
            </p>
            <label className="meta" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={assume} onChange={(e) => setAssume(e.target.checked)} disabled={state !== 'ready'} />
              Record this change as an assumption (the changed fields are marked while the Assumptions layer is on)
            </label>
            {assume && (
              <div className="row">
                <label>
                  Why <span className="meta">(how you read the rules behind this change)</span>
                  <textarea className="field-input why" value={why} onChange={(e) => setWhy(e.target.value)} required disabled={state !== 'ready'} />
                </label>
                <label>
                  Decided by
                  <input className="field-input" value={decidedBy} onChange={(e) => setDecidedBy(e.target.value)} disabled={state !== 'ready'} />
                </label>
              </div>
            )}
          </>
        )}
        {errors && (
          <ul className="error" role="alert">
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        {state === 'saved' && (
          <p className="success" role="status">
            Saved and re-signed. The page reloads with the new body.
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            {state === 'saved' || state === 'readonly' ? 'Close' : 'Cancel'}
          </button>
          {state !== 'readonly' && state !== 'saved' && (
            <button type="submit" className="btn btn-primary" disabled={state !== 'ready'}>
              {state === 'saving' ? 'Signing…' : 'Save and re-sign'}
            </button>
          )}
        </div>
      </form>
    </dialog>
  )
}

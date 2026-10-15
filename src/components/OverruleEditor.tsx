import { useEffect, useRef, useState, type FormEvent } from 'react'
import { stringify } from 'yaml'
import { Assertion, type Assertion as A } from '../model/schema'
import { draftIds, locatorText, rankOf, readDrafts, specById, stackOf, subjectById, today, writeDrafts } from '../lib/store'

interface Props {
  subjectId: string | null
  onClose: () => void
}

type Mode = 'checking' | 'repo' | 'local'

export function OverruleEditor({ subjectId, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<Mode>('checking')
  const [error, setError] = useState<string[] | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [yamlOut, setYamlOut] = useState<string | null>(null)

  useEffect(() => {
    fetch('/__overrules')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMode(j?.writable ? 'repo' : 'local'))
      .catch(() => setMode('local'))
  }, [])
  useEffect(() => {
    if (subjectId) {
      setError(null)
      setDone(null)
      setYamlOut(null)
      ref.current?.showModal()
    } else ref.current?.close()
  }, [subjectId])

  if (!subjectId) return <dialog ref={ref} className="editor" onClose={onClose} />
  const subject = subjectById.get(subjectId)
  // Highest precedence first, so the rule that currently decides is preselected.
  const targets = stackOf(subjectId)
    .filter((a) => a.relation !== 'silent' && a.relation !== 'voids' && specById.get(a.spec)?.layer !== 'golive')
    .sort((x, y) => rankOf(x) - rankOf(y))
  const slug = subjectId.replace(/^.*?\./, '')

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const get = (k: string) => String(f.get(k) ?? '').trim()
    const relation = get('relation')
    const target = targets.find((t) => t.id === get('target'))
    const candidate = {
      id: get('id'),
      subject: subjectId,
      spec: 'golive-compromises',
      locator: { at: get('reference') || 'go-live agreement' },
      relation,
      ...(relation !== 'voids' ? { level: get('level') } : {}),
      target: get('target'),
      // The compromise binds whom the rule it changes binds.
      applies_to: target?.applies_to ?? {},
      window: { ...(get('from') ? { from: get('from') } : {}), until: get('until') },
      quote: get('text') || undefined,
      decided_by: get('decided_by') || undefined,
      reference: get('reference') || undefined,
      note: get('note') || undefined,
      verified: get('reference') ? 'source-checked' : 'unverified',
    }
    const parsed = Assertion.safeParse(candidate)
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'entry'}: ${i.message}`))
    if (!get('until')) return setError(['A go-live compromise needs an end date.'])
    const a: A = parsed.data
    if (mode === 'repo') {
      const res = await fetch('/__overrules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return setError(Array.isArray(body.error) ? body.error : [String(body.error ?? res.statusText)])
      setDone(`Saved to ${body.file}. The page reloads with the new rule.`)
    } else {
      const drafts = readDrafts().filter((d) => d.id !== a.id)
      if (!writeDrafts([...drafts, a])) return setError(['This browser does not allow local storage. Copy the YAML below instead.'])
      setDone('Saved as a draft in this browser and applied to this view. Add the YAML below to data/assertions/golive/ to share it.')
    }
    setYamlOut(stringify([a], { lineWidth: 120 }))
  }

  return (
    <dialog ref={ref} className="editor" onClose={onClose} aria-labelledby="editor-title">
      <form method="dialog" onSubmit={submit}>
        <div>
          <h2 id="editor-title" style={{ margin: 0, fontSize: 17 }}>
            Add a go-live compromise
          </h2>
          <p className="meta" style={{ margin: '4px 0 0' }}>
            {subject?.title}. A go-live compromise outranks the CIR while its dates apply; afterwards the rule it targets applies again.
            {mode === 'repo' && ' Saving writes a YAML file into data/assertions/golive/.'}
            {mode === 'local' && ' This is the static build: saving keeps a draft in this browser.'}
          </p>
        </div>
        <label>
          Rule it changes
          <select className="field-input" name="target" required defaultValue={targets[0]?.id}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {specById.get(t.spec)?.short} {locatorText(t)} ({t.level ?? t.relation})
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            Effect
            <select className="field-input" name="relation" defaultValue="replaces">
              <option value="replaces">Replaces it with another level</option>
              <option value="adapts">Rewords it</option>
              <option value="voids">Suspends it entirely</option>
            </select>
          </label>
          <label>
            New level <span className="meta">(ignored when suspended)</span>
            <select className="field-input" name="level" defaultValue="may">
              <option value="shall">SHALL</option>
              <option value="should">SHOULD</option>
              <option value="may">MAY</option>
              <option value="should-not">SHOULD NOT</option>
              <option value="shall-not">SHALL NOT</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label>
            Applies from <span className="meta">(optional)</span>
            <input className="field-input" type="date" name="from" defaultValue={today()} />
          </label>
          <label>
            Applies until
            <input className="field-input" type="date" name="until" required />
          </label>
        </div>
        <label>
          What was agreed <span className="meta">(the wording of the compromise)</span>
          <textarea className="field-input" name="text" required />
        </label>
        <div className="row">
          <label>
            Agreed by
            <input className="field-input" name="decided_by" placeholder="e.g. go-live steering group" />
          </label>
          <label>
            Where it is recorded
            <input className="field-input" name="reference" placeholder="minutes, ticket or decision log" />
          </label>
        </div>
        <label>
          Identifier
          <input className="field-input mono" name="id" required defaultValue={`golive/${slug}-${today()}`} pattern="[A-Za-z0-9][A-Za-z0-9._/\-]*" />
        </label>
        <label>
          Note <span className="meta">(optional)</span>
          <input className="field-input" name="note" />
        </label>
        {error && (
          <ul className="error" role="alert">
            {error.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {done && (
          <p className="success" role="status">
            {done}
          </p>
        )}
        {yamlOut && <pre className="code" style={{ background: 'var(--sheet-2)', borderRadius: 6, maxHeight: 180, overflow: 'auto' }}>{yamlOut}</pre>}
        <div className="actions">
          {done ? (
            <button type="button" className="btn btn-primary" onClick={() => (mode === 'local' ? window.location.reload() : onClose())}>
              {mode === 'local' ? 'Apply and close' : 'Close'}
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={mode === 'checking' || targets.length === 0}>
                Save compromise
              </button>
            </>
          )}
        </div>
        {draftIds.size > 0 && <p className="meta">{draftIds.size} local draft(s) are applied in this browser.</p>}
      </form>
    </dialog>
  )
}

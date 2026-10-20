// The field-by-field checks of a processing step (e.g. "verify KB-JWT"): what each field must contain for the check
// to pass. A step with substeps (e.g. "validate response") lists the checks of every substep, numbered as in the diagram.
import type { Flow, Step } from '../model/schema'
import { stepNumber } from '../model/steps'
import { layersTouching, subjectById } from '../lib/store'
import { LayerBadges } from './bits'

interface Props {
  flow: Flow
  step: Step
  /** Subject currently shown in the provenance pane. */
  selected: string
  onSelectSubject: (subjectId: string) => void
  onSelectStep: (stepId: string) => void
}

function checksOf(flow: Flow, subjectId: string) {
  const { transport: t, format: f } = flow.variant
  return (subjectById.get(subjectId)?.checks ?? []).filter(
    (c) => (!c.transport || !t || c.transport.includes(t)) && (!c.format || !f || c.format.includes(f)),
  )
}

export function hasChecks(flow: Flow, step: Step): boolean {
  return checksOf(flow, step.subject).length > 0 || flow.steps.some((s) => s.parent === step.id && checksOf(flow, s.subject).length > 0)
}

export function CheckList({ flow, step, selected, onSelectSubject, onSelectStep }: Props) {
  const subs = flow.steps.filter((s) => s.parent === step.id)
  const description = subjectById.get(step.subject)?.description
  return (
    <div className="checks">
      {description && <p className="lede">{description}</p>}
      <Table flow={flow} subjectId={step.subject} selected={selected} onSelect={onSelectSubject} />
      {subs.map((s) => (
        <section key={s.id} className="check-group">
          <h3>
            <button className="linklike" onClick={() => onSelectStep(s.id)}>
              <span className="num">{stepNumber(flow, s)}</span> {s.label}
            </button>
          </h3>
          {checksOf(flow, s.subject).length > 0 ? (
            <Table flow={flow} subjectId={s.subject} selected={selected} onSelect={onSelectSubject} />
          ) : (
            <p className="meta">No field checks recorded for this format yet. Its rules are in the provenance stack.</p>
          )}
        </section>
      ))}
    </div>
  )
}

function Table({ flow, subjectId, selected, onSelect }: { flow: Flow; subjectId: string; selected: string; onSelect: (id: string) => void }) {
  const checks = checksOf(flow, subjectId)
  if (checks.length === 0) return null
  return (
    <table className="check-table">
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Expected result</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c, i) => (
          <tr key={i} data-selected={!!c.subject && c.subject === selected}>
            <td>
              {c.subject ? (
                <button className="linklike" onClick={() => onSelect(c.subject!)} title="Show who defines this field">
                  <code>{c.field}</code> <LayerBadges layers={layersTouching([c.subject])} />
                </button>
              ) : (
                <code>{c.field}</code>
              )}
            </td>
            <td>{c.expect}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

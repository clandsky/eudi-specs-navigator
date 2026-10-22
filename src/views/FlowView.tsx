import { useEffect, useState } from 'react'
import { LayerBadges, LayerName } from '../components/bits'
import { CheckList, hasChecks } from '../components/CheckList'
import { ObjectView } from '../components/ObjectView'
import { OverruleEditor, type EntryKind } from '../components/OverruleEditor'
import { StackPanel } from '../components/StackPanel'
import { SequenceDiagram } from '../diagram/SequenceDiagram'
import { setParams, useRoute } from '../lib/router'
import { ds, exampleById, flowById, subjectById } from '../lib/store'
import type { Assertion } from '../model/schema'
import { stepNumber } from '../model/steps'

export function FlowView({ flowId }: { flowId: string }) {
  const flow = flowById.get(flowId)
  const { params } = useRoute()
  const [editing, setEditing] = useState<{ subjectId: string; kind: EntryKind; entry?: Assertion } | null>(null)
  // A link to a step (e.g. from the endpoints list) shows that step in the diagram, not only its example. One frame
  // later, so the shell's scroll-to-top on navigation has already run.
  useEffect(() => {
    const linked = params.get('step')
    if (!linked) return
    const id = requestAnimationFrame(() => document.querySelector(`[data-step="${linked}"]`)?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(id)
  }, [flowId])
  if (!flow) return <div className="page">Unknown flow “{flowId}”.</div>

  const step = flow.steps.find((s) => s.id === params.get('step')) ?? flow.steps[0]!
  const field = params.get('field')
  const subjectId = params.get('subject') ?? step.subject
  const example = step.example ? exampleById.get(step.example) : undefined
  // A request step can carry its response example (GET metadata): then the server is the sender.
  const senderId = example?.kind === 'http-response' && step.kind === 'request' ? step.to : step.from
  const sender = flow.participants.find((p) => p.id === senderId)?.role

  return (
    <div className="flow-grid">
      <section aria-label="Sequence diagram">
        <div className="pane-head">
          <h2>{flow.title}</h2>
        </div>
        <div className="pane-body">
          <SequenceDiagram flow={flow} selected={step.id} onSelect={(id) => setParams({ step: id, field: null, subject: null })} />
          <Legend />
        </div>
      </section>
      <section aria-label="Example object">
        <div className="pane-head">
          <h2>
            Step {stepNumber(flow, step)}: {step.label}
          </h2>
          <p>{step.note ?? `${subjectById.get(step.subject)?.title}. Click a field to see who defines it and who overrules it.`}</p>
        </div>
        <div className="pane-body">
          {step.example ? (
            <ObjectView
              exampleId={step.example}
              sender={sender}
              selected={field}
              variant={flow.variant}
              onSelect={(ptr, sub) => setParams({ field: ptr, subject: sub })}
            />
          ) : hasChecks(flow, step) ? (
            <CheckList
              flow={flow}
              step={step}
              selected={subjectId}
              onSelectSubject={(sub) => setParams({ field: null, subject: sub === step.subject ? null : sub })}
              onSelectStep={(id) => setParams({ step: id, field: null, subject: null })}
            />
          ) : (
            <p className="empty" style={{ padding: 0 }}>This step carries no message body. Its rules are shown on the right.</p>
          )}
        </div>
      </section>
      <section aria-label="Provenance stack">
        <div className="pane-head">
          <h2>Provenance</h2>
          <p>
            {field || subjectId !== step.subject ? (
              <>
                Field <code>{field ?? subjectById.get(subjectId)?.title ?? subjectId}</code>.{' '}
                <button className="btn" style={{ padding: '0 6px' }} onClick={() => setParams({ field: null, subject: null })}>
                  Show the step
                </button>
              </>
            ) : (
              'Highest precedence first. Struck text was voided or replaced by a higher layer.'
            )}
          </p>
        </div>
        <div className="pane-body">
          <StackPanel
            subjectId={subjectId}
            variant={flow.variant}
            onAddOverrule={(subjectId, kind) => setEditing({ subjectId, kind })}
            onEditEntry={(a) => setEditing({ subjectId: a.subject, kind: a.spec === 'golive-compromises' ? 'golive' : 'assumption', entry: a })}
          />
        </div>
      </section>
      <OverruleEditor subjectId={editing?.subjectId ?? null} kind={editing?.kind} entry={editing?.entry} onClose={() => setEditing(null)} />
    </div>
  )
}

function Legend() {
  return (
    <div className="meta" style={{ display: 'grid', gap: 6, marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {ds.layers
          .filter((l) => l.rank !== null)
          .map((l) => (
            <span key={l.id} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <LayerBadges layers={[l.id]} label={false} /> <LayerName id={l.id}>{l.label}</LayerName>
            </span>
          ))}
      </div>
      <div>
        Bars under a message show which layers say something about it or its fields. ◆ marks a step that exists only
        because a higher layer added it. Dashed arrows are responses and redirects; dotted arrows happen before the flow.
        Use ↑ and ↓ to move between steps.
      </div>
    </div>
  )
}

// Sequence diagram rendered from flow data. Mermaid cannot attach handlers to messages; owning the renderer gives
// clickable, keyboard-focusable messages, per-message layer badges and lens-diff markers.
import type { KeyboardEvent } from 'react'
import type { Flow } from '../model/schema'
import { layerColor } from '../components/bits'
import {
  LENS_STAGES,
  descendants,
  effective,
  existsAt,
  layerById,
  layersTouching,
  originOf,
  rolesOf,
  stackOf,
  useViewCtx,
  type ViewCtx,
} from '../lib/store'

const W = 620
const TOP = 18
const HEAD_H = 34
const ROW_H = 54
const FIRST_ROW = TOP + HEAD_H + 26
const SIDE = 74

interface Props {
  flow: Flow
  selected?: string | null
  onSelect: (stepId: string) => void
}

function changedAtStage(subjectIds: string[], vc: ViewCtx, variant: Flow['variant']): boolean {
  if (!vc.prevLayers) return false
  return subjectIds.some((id) => {
    const stack = stackOf(id)
    if (stack.length === 0) return false
    const appears = !existsAt(id, vc.prevLayers!) && existsAt(id, vc.layers)
    return appears || rolesOf(stack, vc.view).some((r) => effective(id, r, vc, variant).level !== effective(id, r, vc, variant, vc.prevLayers!).level)
  })
}

export function SequenceDiagram({ flow, selected, onSelect }: Props) {
  const vc = useViewCtx()
  const n = flow.participants.length
  const xOf = (id: string) => SIDE + (flow.participants.findIndex((p) => p.id === id) * (W - 2 * SIDE)) / Math.max(1, n - 1)
  const height = FIRST_ROW + flow.steps.length * ROW_H + 10
  const stageLayer = LENS_STAGES[vc.stage]!.id

  return (
    <svg className="seq" viewBox={`0 0 ${W} ${height}`} role="group" aria-label={`Sequence diagram: ${flow.title}`}>
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ink)" />
        </marker>
        <marker id="arrowhead-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)" />
        </marker>
      </defs>

      {flow.participants.map((p) => {
        const x = xOf(p.id)
        return (
          <g key={p.id} className="actor">
            <line className="lifeline" x1={x} x2={x} y1={TOP + HEAD_H} y2={height - 6} />
            <rect x={x - 66} y={TOP} width={132} height={HEAD_H} rx={6} />
            <text x={x} y={TOP + HEAD_H / 2 + 4.5} textAnchor="middle">
              {p.label}
            </text>
          </g>
        )
      })}

      {flow.steps.map((s, i) => {
        const y = FIRST_ROW + i * ROW_H
        const ay = y + 30
        const x1 = xOf(s.from)
        const x2 = xOf(s.to)
        const left = Math.min(x1, x2)
        const mid = (x1 + x2) / 2
        const subjects = [s.subject, ...descendants(s.subject)]
        const layers = layersTouching(subjects)
        const origin = originOf(s.subject)
        const added = origin && (table_rank(origin) ?? 9) < (table_rank('base') ?? 4)
        const absent = !existsAt(s.subject, vc.layers)
        const changed = changedAtStage(subjects, vc, flow.variant)
        const dashed = s.kind === 'response' || s.kind === 'redirect' ? 'arrow-response' : s.kind === 'internal' ? 'arrow-internal' : ''
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(s.id)
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const next = flow.steps[i + (e.key === 'ArrowDown' ? 1 : -1)]
            if (next) {
              onSelect(next.id)
              ;(document.querySelector(`[data-step="${next.id}"]`) as SVGGElement | null)?.focus()
            }
          }
        }
        const label = `${i + 1}. ${s.label}${added ? `, added by ${layerById.get(origin!)?.short}` : ''}${absent ? ', not in the protocol at this lens step' : ''}${changed ? `, changed by ${layerById.get(stageLayer)?.short}` : ''}`
        return (
          <g
            key={s.id}
            className="msg"
            data-step={s.id}
            data-selected={selected === s.id}
            data-absent={absent}
            tabIndex={0}
            role="button"
            aria-pressed={selected === s.id}
            aria-label={label}
            onClick={() => onSelect(s.id)}
            onKeyDown={onKey}
          >
            <rect className="hit" x={4} y={y + 2} width={W - 8} height={ROW_H - 4} rx={6} />
            <text className="num" x={16} y={ay + 4}>
              {i + 1}
            </text>
            {changed && (
              <text className="delta" x={16} y={ay + 18} style={{ fill: layerColor(stageLayer) }}>
                Δ
              </text>
            )}
            <line
              className={`arrow ${dashed}`}
              x1={x1 + (x2 > x1 ? 2 : -2)}
              x2={x2 + (x2 > x1 ? -3 : 3)}
              y1={ay}
              y2={ay}
              markerEnd={s.kind === 'internal' ? 'url(#arrowhead-muted)' : 'url(#arrowhead)'}
            />
            <text className="label" x={mid} y={ay - 8} textAnchor="middle">
              {added && <tspan style={{ fill: layerColor(origin!) }}>◆ </tspan>}
              {s.label}
            </text>
            <g transform={`translate(${left + 4}, ${ay + 6})`}>
              {layers.map((l, k) => (
                <rect key={l} x={k * 8} y={0} width={6} height={10} rx={1.5} style={{ fill: layerColor(l) }} />
              ))}
            </g>
            {s.tags.length > 0 && (
              <text className="stag" x={left + 8 + layers.length * 8 + 4} y={ay + 15}>
                {s.tags.join(', ')}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function table_rank(id: string): number | null | undefined {
  return layerById.get(id as never)?.rank
}

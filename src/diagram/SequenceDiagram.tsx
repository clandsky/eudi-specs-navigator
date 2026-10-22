// Sequence diagram rendered from flow data. Mermaid cannot attach handlers to messages; owning the renderer gives
// clickable, keyboard-focusable messages, per-message layer badges and lens-diff markers.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Flow } from '../model/schema'
import { stepAt, stepNumber } from '../model/steps'
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

// The drawing is laid out in CSS pixels at the width of its pane, so its text stays the size of the rest of the page.
// Below MIN_W it scales down; above MAX_W the lifelines stop spreading.
const MIN_W = 560
const MAX_W = 980
const TOP = 18
const HEAD_H = 34
const ROW_H = 54
/** Substeps (step.parent set) get a lower, indented row. */
const SUB_H = 36
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
  const wrap = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(620)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    setAvail(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setAvail(Math.floor(e!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const W = Math.min(MAX_W, Math.max(MIN_W, avail))
  const n = flow.participants.length
  const xOf = (id: string) => SIDE + (flow.participants.findIndex((p) => p.id === id) * (W - 2 * SIDE)) / Math.max(1, n - 1)
  const rowH = (i: number) => (flow.steps[i]!.parent ? SUB_H : ROW_H)
  const rowY: number[] = []
  flow.steps.forEach((_, i) => rowY.push(i === 0 ? FIRST_ROW : rowY[i - 1]! + rowH(i - 1)))
  // Room below the last row so the selection frame does not touch the legend; the lifelines end with a short cap.
  const height = rowY.at(-1)! + rowH(flow.steps.length - 1) + 26
  // An activation bar on the lifeline groups a step with its substeps.
  const groups = flow.steps.flatMap((s, i) => {
    let last = i
    while (flow.steps[last + 1]?.parent === s.id) last++
    return last > i ? [{ x: xOf(s.from), y1: rowY[i]! + 22, y2: rowY[last]! + SUB_H - 8, id: s.id }] : []
  })
  const stageLayer = LENS_STAGES[vc.stage]!.id

  return (
    <div ref={wrap}>
      <svg className="seq" viewBox={`0 0 ${W} ${height}`} style={{ width: W, maxWidth: '100%' }} role="group" aria-label={`Sequence diagram: ${flow.title}`}>
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
              <line className="lifeline" x1={x} x2={x} y1={TOP + HEAD_H} y2={height - 10} />
              <line className="lifeline-end" x1={x - 8} x2={x + 8} y1={height - 10} y2={height - 10} />
              <rect x={x - 66} y={TOP} width={132} height={HEAD_H} rx={6} />
              <text x={x} y={TOP + HEAD_H / 2 + 4.5} textAnchor="middle">
                {p.label}
              </text>
            </g>
          )
        })}

        {groups.map((g) => (
          <rect key={g.id} className="activation" x={g.x - 4} y={g.y1} width={8} height={g.y2 - g.y1} rx={2} />
        ))}

        {flow.steps.map((raw, i) => {
          // With the go-live layer on, a step shows the wallet solution's tags (drawn in its colour).
          const s = stepAt(raw, vc.layers)
          const overlaid = s.tags !== raw.tags
          const sub = !!s.parent
          const y = rowY[i]!
          const ay = y + (sub ? 15 : 30)
          const num = stepNumber(flow, s)
          // Labels of self-loops start this far from the lifeline.
          const off = sub ? 28 : 38
          const x1 = xOf(s.from)
          const x2 = xOf(s.to)
          const left = Math.min(x1, x2)
          const mid = (x1 + x2) / 2
          const self = s.from === s.to
          // Self-loops open towards the middle of the diagram so their label stays inside the drawing.
          const leftward = self && x1 > W / 2
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
          const label = `${num}. ${s.label}${added ? `, added by ${layerById.get(origin!)?.short}` : ''}${absent ? ', not in the protocol at this lens step' : ''}${changed ? `, changed by ${layerById.get(stageLayer)?.short}` : ''}`
          return (
            <g
              key={s.id}
              className="msg"
              data-step={s.id}
              data-sub={sub}
              data-selected={selected === s.id}
              data-absent={absent}
              tabIndex={0}
              role="button"
              aria-pressed={selected === s.id}
              aria-label={label}
              onClick={() => onSelect(s.id)}
              onKeyDown={onKey}
            >
              <rect className="hit" x={sub ? 22 : 4} y={y + 2} width={W - (sub ? 26 : 8)} height={rowH(i) - 4} rx={6} />
              <text className={sub ? 'num num-sub' : 'num'} x={sub ? 26 : 16} y={ay + 4}>
                {num}
              </text>
              {changed && (
                <text className="delta" x={16} y={ay + 18} style={{ fill: layerColor(stageLayer) }}>
                  Δ
                </text>
              )}
              {self ? (
                // Self-message: a small loop to the right of the lifeline (e.g. the wallet validating a request).
                <path
                  className={`arrow ${dashed}`}
                  d={
                    sub
                      ? leftward
                        ? `M${x1 - 5},${ay - 6} h-18 v10 h16`
                        : `M${x1 + 5},${ay - 6} h18 v10 h-16`
                      : leftward
                        ? `M${x1 - 2},${ay - 8} h-28 v14 h26`
                        : `M${x1 + 2},${ay - 8} h28 v14 h-26`
                  }
                  markerEnd={s.kind === 'internal' ? 'url(#arrowhead-muted)' : 'url(#arrowhead)'}
                />
              ) : (
                <line
                  className={`arrow ${dashed}`}
                  x1={x1 + (x2 > x1 ? 2 : -2)}
                  x2={x2 + (x2 > x1 ? -3 : 3)}
                  y1={ay}
                  y2={ay}
                  markerEnd={s.kind === 'internal' ? 'url(#arrowhead-muted)' : 'url(#arrowhead)'}
                />
              )}
              <text
                className={sub ? 'label label-sub' : 'label'}
                x={self ? (leftward ? x1 - off : x1 + off) : mid}
                y={self ? ay + 2 : ay - 8}
                textAnchor={self ? (leftward ? 'end' : 'start') : 'middle'}
              >
                {added && <tspan style={{ fill: layerColor(origin!) }}>◆ </tspan>}
                {s.label}
              </text>
              <g transform={`translate(${self ? (leftward ? x1 - off - layers.length * 8 : x1 + off) : left + 4}, ${ay + (sub ? 7 : 8)})`}>
                {layers.map((l, k) => (
                  <rect key={l} x={k * 8} y={0} width={6} height={10} rx={1.5} style={{ fill: layerColor(l) }} />
                ))}
              </g>
              {s.tags.length > 0 && (
                <text
                  className="stag"
                  x={self && leftward ? x1 - off - 4 - layers.length * 8 : (self ? x1 + off - 4 : left) + 8 + layers.length * 8 + 4}
                  y={ay + (sub ? 15 : 17)}
                  textAnchor={self && leftward ? 'end' : 'start'}
                  style={overlaid ? { fill: layerColor('golive') } : undefined}
                >
                  {s.tags.join(', ')}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function table_rank(id: string): number | null | undefined {
  return layerById.get(id as never)?.rank
}

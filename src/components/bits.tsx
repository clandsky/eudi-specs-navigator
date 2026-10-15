import type { CSSProperties, ReactNode } from 'react'
import { levelLabel, type EffectiveRule } from '../model/resolve'
import type { Level, LayerId } from '../model/schema'
import { layerById, specById } from '../lib/store'

export const layerColor = (id: LayerId) => `var(--l-${id})`
export const cssLayer = (id: LayerId): CSSProperties => ({ ['--c' as string]: layerColor(id) })

export function LevelChip({ level, title }: { level: Level | null | undefined; title?: string }) {
  return (
    <span className={`level level-${level ?? 'none'}`} title={title}>
      {levelLabel(level)}
    </span>
  )
}

export function LayerBadges({ layers, label = true }: { layers: LayerId[]; label?: boolean }) {
  if (layers.length === 0) return null
  const names = layers.map((l) => layerById.get(l)?.short ?? l).join(', ')
  return (
    <span className="layer-badges" aria-label={label ? `Touched by ${names}` : undefined} title={names}>
      {layers.map((l) => (
        <i key={l} style={{ background: layerColor(l) }} />
      ))}
    </span>
  )
}

export function LayerName({ id, children }: { id: LayerId; children?: ReactNode }) {
  return (
    <span className="layer-name" style={cssLayer(id)}>
      {children ?? layerById.get(id)?.short ?? id}
    </span>
  )
}

export function SpecName({ specId }: { specId: string }) {
  const s = specById.get(specId)
  if (!s) return <span>{specId}</span>
  return (
    <span className="layer-name" style={cssLayer(s.layer)} title={`${s.title}, ${s.version}`}>
      {s.short}
    </span>
  )
}

export function StatusTag({ rule }: { rule: EffectiveRule }) {
  if (rule.status === 'conflict') return <span className="tag status-conflict">Contradiction</span>
  if (rule.status === 'needs-review') return <span className="tag status-review">Needs review</span>
  if (rule.status === 'undecided') return <span className="tag">No binding rule</span>
  if (rule.decidedBy.some((a) => specById.get(a.spec)?.layer === 'assumption')) return <span className="tag status-review">Assumed</span>
  // Authored entries (assumptions, resolved readings, go-live compromises) have no corpus text to check.
  if (rule.unverified.some((a) => !specById.get(a.spec)?.authored)) return <span className="tag status-review">Unverified source</span>
  return null
}

export function formatDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

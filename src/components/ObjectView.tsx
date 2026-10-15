import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { escapeToken, viewOf } from '../model/pointer'
import { levelLabel } from '../model/resolve'
import type { Role } from '../model/schema'
import {
  LENS_STAGES,
  ROLE_LABEL,
  ds,
  effective,
  exampleById,
  existsAt,
  layersTouching,
  primaryRole,
  stackOf,
  subjectById,
  useViewCtx,
} from '../lib/store'
import { LayerBadges, LevelChip, cssLayer } from './bits'

interface Props {
  exampleId: string
  sender?: Role
  selected?: string | null
  onSelect: (pointer: string, subjectId: string) => void
  variant?: { grant?: string; transport?: string }
}

const isJws = (v: unknown): v is string => typeof v === 'string' && /^eyJ[\w-]*\.[\w-]+\.[\w-]+(~[\w-]*)*~?$/.test(v)

export function ObjectView({ exampleId, sender, selected, onSelect, variant = {} }: Props) {
  const ex = exampleById.get(exampleId)
  const enc = ds.encoded[exampleId]
  const vc = useViewCtx()
  const [raw, setRaw] = useState(false)
  const view = useMemo(() => (enc ? viewOf(enc) : null), [enc])
  if (!ex || !enc || !view) return <div className="empty">This example has not been built yet. Run pnpm examples:build.</div>

  const jwtNames = new Map<string, string>()
  for (const [name, compact] of Object.entries(enc.jwts)) jwtNames.set(compact, name)

  const stageLayer = LENS_STAGES[vc.stage]!.id
  const ann = ex.annotations

  function FieldKey({ ptr, children }: { ptr: string; children: ReactNode }) {
    const subjectId = ann[ptr]
    if (!subjectId) return <span className="k">{children}</span>
    const stack = stackOf(subjectId)
    const role = primaryRole(stack, vc.view, sender)
    const rule = effective(subjectId, role, vc, variant)
    const prev = vc.prevLayers ? effective(subjectId, role, vc, variant, vc.prevLayers) : null
    const changed = prev !== null && prev.level !== rule.level
    const absent = !existsAt(subjectId, vc.layers)
    const subject = subjectById.get(subjectId)
    const tip = absent
      ? `${subject?.title}: not part of the protocol at this lens step`
      : `${subject?.title}: ${levelLabel(rule.level)} for ${ROLE_LABEL[role]}${rule.decidedBy[0] ? `, decided by ${rule.decidedBy[0].id}` : ''}${changed ? ` (was ${levelLabel(prev!.level)})` : ''}`
    return (
      <span className={absent ? 'line-absent' : changed ? 'line-changed' : undefined} style={changed ? cssLayer(stageLayer) : undefined}>
        <button type="button" className="fkey" data-selected={selected === ptr} title={tip} aria-label={tip} onClick={() => onSelect(ptr, subjectId)}>
          {children}
          <LevelChip level={rule.level} />
          <LayerBadges layers={layersTouching([subjectId])} label={false} />
        </button>
      </span>
    )
  }

  function Value({ v, ptr, indent }: { v: unknown; ptr: string; indent: number }): ReactNode {
    const pad = '  '.repeat(indent)
    if (Array.isArray(v)) {
      if (v.length === 0) return <span>[]</span>
      return (
        <>
          {'['}
          {'\n'}
          {v.map((item, i) => (
            <Fragment key={i}>
              {pad}
              {'  '}
              {ann[`${ptr}/${i}`] ? <FieldKey ptr={`${ptr}/${i}`}>{`[${i}]`}</FieldKey> : null}
              {ann[`${ptr}/${i}`] ? ' ' : null}
              <Value v={item} ptr={`${ptr}/${i}`} indent={indent + 1} />
              {i < v.length - 1 ? ',' : ''}
              {'\n'}
            </Fragment>
          ))}
          {pad}
          {']'}
        </>
      )
    }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      if (entries.length === 0) return <span>{'{}'}</span>
      return (
        <>
          {'{'}
          {'\n'}
          {entries.map(([k, val], i) => {
            const p = `${ptr}/${escapeToken(k)}`
            return (
              <Fragment key={k}>
                {pad}
                {'  '}
                <FieldKey ptr={p}>{`"${k}"`}</FieldKey>
                {': '}
                <Value v={val} ptr={p} indent={indent + 1} />
                {i < entries.length - 1 ? ',' : ''}
                {'\n'}
              </Fragment>
            )
          })}
          {pad}
          {'}'}
        </>
      )
    }
    if (typeof v === 'string') {
      if (isJws(v) && !raw) {
        const name = jwtNames.get(v) ?? jwtNames.get(v.split('~')[0]!)
        const disclosures = v.includes('~') ? v.split('~').filter(Boolean).length - 1 : 0
        return (
          <span className="jwt" title={v}>
            "{v.slice(0, 18)}…"{' '}
            <span className="meta">
              ({name ? `JWT “${name}”, decoded below` : 'JWT'}
              {disclosures ? `, ${disclosures} disclosures` : ''})
            </span>
          </span>
        )
      }
      if (!raw && v.length > 96 && /^[A-Za-z0-9+/=_-]+$/.test(v))
        return (
          <span className="s" title={v}>
            "{v.slice(0, 44)}…" <span className="meta">({v.length} characters, tick Encoded values to see all)</span>
          </span>
        )
      return <span className="s">"{v}"</span>
    }
    if (typeof v === 'number') return <span className="n">{v}</span>
    if (typeof v === 'boolean' || v === null) return <span className="b">{String(v)}</span>
    return <span>{String(v)}</span>
  }

  const Tree = ({ v, ptr }: { v: unknown; ptr: string }) => (
    <div className="code">
      <Value v={v} ptr={ptr} indent={0} />
    </div>
  )

  const h = view.http
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14.5 }}>{ex.title}</h3>
        <span className="spacer" />
        <label className="meta" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> Encoded values
        </label>
      </div>
      {ex.note && <p className="meta" style={{ marginTop: -4 }}>{ex.note}</p>}

      {h && (
        <div className="obj-block">
          <header>
            {ex.kind === 'uri' ? 'URI' : h.method ? 'HTTP request' : 'HTTP response'}
            <span className="sub">{sender ? `sent by ${ROLE_LABEL[sender]}` : ''}</span>
          </header>
          {(h.method || h.url || h.status) && (
            <div className="http-line">
              {ann['/http/url'] ? (
                <FieldKey ptr="/http/url">{h.method ? `${h.method} ` : ''}{shortUrl(h.url ?? '')}</FieldKey>
              ) : (
                <>
                  {h.status ? `HTTP/1.1 ${h.status}` : ''}
                  {h.method ? `${h.method} ` : ''}
                  {h.status && h.url ? ' → ' : ''}
                  {h.url ? (raw ? h.url : shortUrl(h.url)) : ''}
                </>
              )}
            </div>
          )}
          {h.query && (
            <>
              <div className="meta" style={{ padding: '8px 12px 0' }}>Query parameters</div>
              <Tree v={h.query} ptr="/http/query" />
            </>
          )}
          {h.headers && Object.keys(h.headers).length > 0 && (
            <div className="code" style={{ borderTop: '1px solid var(--rule)' }}>
              {Object.entries(h.headers).map(([k, v]) => (
                <Fragment key={k}>
                  <FieldKey ptr={`/http/headers/${escapeToken(k)}`}>{k}</FieldKey>
                  {': '}
                  <Value v={v} ptr={`/http/headers/${escapeToken(k)}`} indent={0} />
                  {'\n'}
                </Fragment>
              ))}
            </div>
          )}
          {h.body !== undefined && h.body !== null && (
            <div style={{ borderTop: '1px solid var(--rule)' }}>
              <Tree v={h.body} ptr="/http/body" />
            </div>
          )}
        </div>
      )}

      {view.json !== undefined && (
        <div className="obj-block">
          <header>
            JSON object <span className="sub">{ex.kind === 'uri' ? 'decoded from the URI' : ''}</span>
          </header>
          <Tree v={view.json} ptr="/json" />
        </div>
      )}

      {Object.entries(view.jwt).map(([name, j]) => (
        <div className="obj-block" key={name}>
          <header>
            JWT “{name}” <span className="sub">{String(j.header.typ ?? '')}</span>
          </header>
          <div className="meta" style={{ padding: '8px 12px 0' }}>Protected header</div>
          <Tree v={j.header} ptr={`/jwt/${escapeToken(name)}/header`} />
          <div className="meta" style={{ padding: '0 12px' }}>Payload</div>
          <Tree v={j.payload} ptr={`/jwt/${escapeToken(name)}/payload`} />
          {raw && <div className="code jwt" style={{ borderTop: '1px solid var(--rule)' }}>{j.compact}</div>}
        </div>
      ))}
      <p className="meta">Signed with test keys from data/test-keys. The decoded views are derived from the encoded values.</p>
    </div>
  )
}

function shortUrl(u: string): string {
  try {
    const d = decodeURIComponent(u)
    return d.length > 140 ? `${d.slice(0, 137)}…` : d
  } catch {
    return u
  }
}

import { describe, expect, it } from 'vitest'
import { loadDataset, withoutAssumptions } from './data.ts'
import { buildContext, buildFlowBundle, mdxText, specCatalog } from './devguide.ts'

const ds = withoutAssumptions(loadDataset({ requireEncoded: true }))
const asOf = '2026-10-21'
const bundles = ds.flows.map((f) => buildFlowBundle(ds, f.id, asOf))
const par = bundles.find((b) => b.id === 'vci-auth-code-par')!

describe('developer guide export', () => {
  it('carries no spec quotes and no assumptions', () => {
    const json = JSON.stringify(bundles)
    expect(json).not.toContain('"quote"')
    const assumed = ds.assertions.filter((a) => a.spec === 'assumptions').length
    expect(assumed).toBe(0)
    expect(Object.keys(specCatalog(ds))).not.toContain('assumptions')
  })

  it('names the spec and section every annotated field comes from', () => {
    const ex = par.examples['vci-par-request']!
    const field = ex.fields['/http/body/client_id']!
    expect(field.s).toBe('vci.par-request.client_id')
    const sources = par.subjects[field.s]!.sources
    expect(sources.some((s) => s.relation === 'defines' && s.spec.startsWith('rfc-') && s.at.startsWith('§'))).toBe(true)
    expect(sources.every((s) => !('quote' in s))).toBe(true)
  })

  it('resolves every subject a flow shows, including the subjects of its checks', () => {
    for (const b of bundles) {
      const shown = new Set([...b.steps.map((s) => s.subject), ...Object.values(b.examples).flatMap((e) => Object.values(e.fields).map((f) => f.s))])
      for (const id of shown) expect(b.subjects[id], `${b.id}: ${id}`).toBeDefined()
      for (const s of Object.values(b.subjects)) for (const c of s.checks ?? []) if (c.subject) expect(b.subjects[c.subject]).toBeDefined()
    }
  })

  it('wires a context file for every description it writes', () => {
    const ctx = buildContext(ds, bundles)
    const wired = new Set([
      ...Object.values(ctx.wiring.subjects as Record<string, string>),
      ...Object.values(ctx.wiring.examples as Record<string, string>),
      ...Object.values(ctx.wiring.flows as Record<string, { intro: string; steps?: Record<string, string> }>).flatMap((f) => [f.intro, ...Object.values(f.steps ?? {})]),
      ...Object.values(ctx.wiring.learning as Record<string, { intro?: string; topics: { text?: string; subtopics?: { text?: string }[] }[] }>).flatMap((t) => [
        t.intro,
        ...t.topics.flatMap((topic) => [topic.text, ...(topic.subtopics ?? []).map((s) => s.text)]),
      ]),
    ])
    expect(Object.keys(ctx.files).filter((f) => !wired.has(f))).toEqual([])
    expect(Object.values(ctx.files).join('\n')).not.toContain('—')
  })

  it('escapes MDX syntax outside code spans and turns bare URLs into code', () => {
    expect(mdxText('a {b} <c> `{d}`')).toBe('a \\{b\\} &lt;c&gt; `{d}`')
    expect(mdxText('aud is https://self-issued.me/v2.')).toBe('aud is `https://self-issued.me/v2`.')
  })
})

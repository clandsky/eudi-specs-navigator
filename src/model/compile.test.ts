import { describe, expect, it } from 'vitest'
import { loadDataset } from '../../scripts/lib/data.ts'
import { compileProfile, profileMarkdown, type CompiledEntry, type CompiledProfile } from './compile'
import type { LayerId } from './schema'

const ds = loadDataset({ requireEncoded: true })
const layers = new Set<LayerId>(ds.layers.filter((l) => l.id !== 'impl-de' && l.id !== 'secondary').map((l) => l.id))
const eaa = compileProfile(ds, { side: 'issuer', asOf: '2026-10-21', layers })
const vp = compileProfile(ds, { side: 'verifier', asOf: '2026-10-21', layers })

const entries = (p: CompiledProfile): CompiledEntry[] => [...p.groups.flatMap((g) => g.entries), ...p.crossCutting]
const entry = (p: CompiledProfile, subject: string) => entries(p).find((e) => e.subject === subject)!
const group = (p: CompiledProfile, subject: string) => p.groups.find((g) => g.subject === subject)!

describe('compiled implementer reference', () => {
  it.each([
    ['issuer', 'vci', eaa],
    ['verifier', 'vp', vp],
  ] as const)('covers every subject with assertions on the %s side', (_side, root, p) => {
    const subjects = new Map(ds.subjects.map((s) => [s.id, s]))
    const rootOf = (id: string) => {
      let s = subjects.get(id)
      while (s?.parent) s = subjects.get(s.parent)
      return s?.id
    }
    const withRules = new Set(ds.assertions.map((a) => a.subject))
    const expected = ds.subjects.filter((s) => s.kind !== 'flow' && rootOf(s.id) === root && withRules.has(s.id)).map((s) => s.id)
    const covered = new Set([...p.groups.map((g) => g.subject), ...entries(p).map((e) => e.subject)])
    expect(expected.filter((id) => !covered.has(id))).toEqual([])
  })

  it('keeps response encryption a Wallet SHALL by HAIP although the CIR voids the ETSI duplicate', () => {
    const rules = group(vp, 'vp.authorization-response.encryption').rule.flatMap((v) => v.rules.filter((r) => r.role === 'wallet'))
    expect(rules.length).toBeGreaterThan(0)
    for (const r of rules) {
      expect(r.level).toBe('shall')
      expect(r.by.every((b) => b.layer === 'haip')).toBe(true)
    }
  })

  it('states the registration certificate in verifier_info as a CIR SHALL (RO-13 adapted from "if any")', () => {
    const r = entry(vp, 'vp.request-object.verifier_info.registration_cert').variants[0]!.rules.find((x) => x.role === 'verifier')!
    expect(r.level).toBe('shall')
    expect(r.by.map((b) => b.locator)).toContain('OIDFVP-HAIP-COMMON-REQ-RO-13')
    expect(r.by[0]!.layer).toBe('cir')
  })

  it('splits a rule by flow where the variants disagree, and merges it where they agree', () => {
    const format = entry(vp, 'vp.dcql.format').variants
    expect(format.length).toBe(2)
    expect(format.find((v) => v.flows.includes('vp-redirect-same-mdoc'))!.rules[0]!.by[0]!.locator).toBe('§5.3.1')
    expect(entry(vp, 'vp.request-object.nonce').variants).toHaveLength(1)
    expect(entry(vp, 'vp.request-object.nonce').variants[0]!.flows).toEqual([])
  })

  it('puts the WIA fields under the provisioning step with the Wallet Provider as the bound role', () => {
    const e = group(eaa, 'vci.provisioning').entries.find((x) => x.subject === 'vci.wia.wallet_name')!
    expect(e.path).toBe('wia.payload.wallet_name')
    expect(e.variants[0]!.rules[0]).toMatchObject({ role: 'wallet-provider', level: 'shall' })
  })

  it('lists an embedded JWT once, where it is issued, and points back to it from later messages', () => {
    for (const id of ['vci.par-request', 'vci.token-request']) {
      expect(group(eaa, id).entries.some((e) => e.path?.startsWith('wia.'))).toBe(false)
      expect(group(eaa, id).see).toContainEqual({ jwt: 'wia', group: 'vci.provisioning' })
    }
    // The Request Object fields live in the Request Object step; the DC API request lists only what it adds.
    expect(group(vp, 'vp.dc-api.request').entries.filter((e) => e.path?.startsWith('ro.')).map((e) => e.subject)).toContain(
      'vp.request-object.expected_origins',
    )
    expect(group(vp, 'vp.request-object').see).toEqual([])
  })

  it('lists unsettled rules as open points with their reasons', () => {
    const o = vp.open.find((x) => x.subject === 'vp.dc-api.unsigned')
    expect(o?.status).toBe('needs-review')
    expect(o?.issues[0]).toMatch(/openid4vp-v1-unsigned/)
  })

  it.each([
    ['eaa', eaa],
    ['vp', vp],
  ] as const)('renders %s.md safely for CommonMark and Docusaurus MDX', (_name, p) => {
    const md = profileMarkdown(p)
    // Outside code, MDX treats { } as expressions and < as JSX: only the anchors and line breaks may use markup.
    const prose = md.replace(/```[\s\S]*?```/g, '').replace(/``[^`]*``|`[^`]*`/g, '')
    expect(prose).not.toMatch(/[{}]/)
    expect(prose.replace(/<a id="[a-z0-9-]+"><\/a>|<br\/>/g, '')).not.toMatch(/</)
    // Participant ids are prefixed so that a participant named "as" does not collide with the Mermaid keyword.
    expect(md).not.toMatch(/participant as /)
  })
})

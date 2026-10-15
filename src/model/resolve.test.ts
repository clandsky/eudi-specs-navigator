import { beforeAll, describe, expect, it } from 'vitest'
import { loadDataset } from '../../scripts/lib/data.ts'
import type { Dataset } from './dataset'
import { layerTable, resolve, timeline, type Ctx, type LayerTable } from './resolve'
import { Assertion, type LayerId } from './schema'

let ds: Dataset
let table: LayerTable
let specLayer: (id: string) => LayerId
const ALL: ReadonlySet<LayerId> = new Set(['assumption', 'golive', 'cir', 'etsi', 'haip', 'base', 'primitive', 'arf', 'impl-de'])

beforeAll(() => {
  ds = loadDataset()
  table = layerTable(ds.layers)
  const m = new Map(ds.specs.map((s) => [s.id, s.layer]))
  specLayer = (id) => m.get(id) ?? 'secondary'
})

const stackOf = (subject: string) => ds.assertions.filter((a) => a.subject === subject)
const ids = (as: { id: string }[]) => as.map((a) => a.id).sort()
const ctx = (over: Partial<Ctx>): Ctx => ({ role: 'wallet', asOf: '2026-10-15', layers: ALL, ...over })

describe('worked example A: WIA on the token request', () => {
  it('wallet SHALL send it, decided by CIR TR-WIA-3, for both grants', () => {
    for (const grant of ['authorization_code', 'pre-authorized_code']) {
      const r = resolve(stackOf('vci.token-request.oauth-client-attestation'), ctx({ grant }), table, specLayer)
      expect(r.status).toBe('decided')
      expect(r.level).toBe('shall')
      expect(ids(r.decidedBy)).toEqual(['cir/TR-WIA-3/token'])
      expect(ids(r.agreeing)).toContain('etsi-472-3/TOKEN-REQ-4.5.1-01')
      // HAIP only says SHOULD for the Appendix E format; overruled by precedence.
      expect(ids(r.overruled)).toContain('haip/4.4.1/token')
    }
  })

  it('without the CIR layer ETSI decides; with only base it is a MAY', () => {
    const noCir = resolve(stackOf('vci.token-request.oauth-client-attestation'), ctx({ layers: new Set<LayerId>(['etsi', 'haip', 'base']) }), table, specLayer)
    expect(ids(noCir.decidedBy)).toEqual(['etsi-472-3/TOKEN-REQ-4.5.1-01'])
    const baseOnly = resolve(stackOf('vci.token-request.oauth-client-attestation'), ctx({ layers: new Set<LayerId>(['base']) }), table, specLayer)
    expect(baseOnly.level).toBe('shall') // draft-07 §6.1: when the header syntax is used, the headers are mandatory
    expect(ids(baseOnly.decidedBy)).toContain('abca-07/6.1/headers-token')
  })

  it('the AS obligation to reject a request without a WIA comes only from HAIP (gap recorded)', () => {
    const r = resolve(stackOf('vci.client-auth.reject-without-wia'), ctx({ role: 'as' }), table, specLayer)
    expect(r.level).toBe('shall')
    expect(ids(r.decidedBy)).toEqual(['haip/4.4.1/require-client-auth'])
    expect(ids(r.silent)).toEqual(['cir/TR-WIA-4/silent-on-rejection'])
  })
})

describe('worked example B: response encryption in OpenID4VP', () => {
  it('the CIR void neutralises ETSI RESP-01, HAIP still decides SHALL, flagged needs-review', () => {
    for (const transport of ['redirect', 'dc-api']) {
      const r = resolve(stackOf('vp.authorization-response.encryption'), ctx({ transport }), table, specLayer)
      expect(r.level).toBe('shall')
      expect(r.status).toBe('needs-review')
      expect(r.neutralised.map((n) => [n.assertion.id, n.by.id])).toEqual([
        ['etsi-472-2/OIDFVP-HAIP-COMMON-RESP-01', 'cir/annex-xii/OIDFVP-HAIP-COMMON-RESP-01'],
      ])
      expect(r.decidedBy.every((a) => a.spec === 'haip-1.0')).toBe(true)
    }
  })

  it('without the CIR layer, ETSI RESP-01 decides', () => {
    const r = resolve(stackOf('vp.authorization-response.encryption'), ctx({ transport: 'redirect', layers: new Set<LayerId>(['etsi', 'haip', 'base']) }), table, specLayer)
    expect(ids(r.decidedBy)).toEqual(['etsi-472-2/OIDFVP-HAIP-COMMON-RESP-01'])
    expect(r.neutralised).toEqual([])
  })
})

describe('worked example C: verifier_info with the registration certificate', () => {
  it('RP SHALL include it unconditionally, decided by the CIR adaptation', () => {
    const r = resolve(stackOf('vp.request-object.verifier_info.registration_cert'), ctx({ role: 'verifier' }), table, specLayer)
    expect(r.status).toBe('decided')
    expect(r.level).toBe('shall')
    expect(ids(r.decidedBy)).toEqual(['cir/annex-xii/OIDFVP-HAIP-COMMON-REQ-RO-13'])
    expect(r.decidedBy[0]!.condition).toBeUndefined()
    expect(r.neutralised.map((n) => n.assertion.id)).toEqual(['etsi-472-2/OIDFVP-HAIP-COMMON-REQ-RO-13'])
    expect(ids(r.silent)).toEqual(['haip/verifier_info/silent'])
  })

  it('wallet validation of the registration certificate: Annex XII applies now, Article 3(4) from 2028 (flagged)', () => {
    const stack = stackOf('vp.wallet.validate-registration-cert')
    const before = resolve(stack, ctx({ asOf: '2026-10-15' }), table, specLayer)
    // CIR Annex XII WRP-VALIDATION-01 carries no date; Article 3(4) of 2024/2982 starts on 2028-08-11.
    expect(before.level).toBe('shall')
    expect(ids(before.decidedBy)).toEqual(['cir/annex-xii/WRP-VALIDATION-01'])
    expect(before.status).toBe('needs-review')
    expect(before.upcoming.map((e) => [e.date, e.kind])).toEqual([['2028-08-11', 'starts']])
    const after = resolve(stack, ctx({ asOf: '2028-08-11' }), table, specLayer)
    expect(ids(after.decidedBy)).toEqual(['cir/2982-art-3-4'])
    expect(ids(after.agreeing)).toEqual(['cir/annex-xii/WRP-VALIDATION-01'])
  })
})

describe('go-live compromises (synthetic fixture, never in data/)', () => {
  it('a time-bounded go-live voids the CIR rule inside its window only', () => {
    const golive = Assertion.parse({
      id: 'golive/test-wia-token',
      subject: 'vci.token-request.oauth-client-attestation',
      spec: 'test-golive',
      locator: { at: 'test fixture' },
      relation: 'replaces',
      level: 'may',
      target: 'cir/TR-WIA-3/token',
      window: { from: '2026-10-01', until: '2026-12-31' },
      verified: 'source-checked',
    })
    const sl = (id: string): LayerId => (id === 'test-golive' ? 'golive' : specLayer(id))
    const stack = [...stackOf('vci.token-request.oauth-client-attestation'), golive]
    const inside = resolve(stack, ctx({}), table, sl)
    expect(inside.level).toBe('may')
    expect(ids(inside.decidedBy)).toEqual(['golive/test-wia-token'])
    expect(inside.neutralised.map((n) => n.assertion.id)).toEqual(['cir/TR-WIA-3/token'])
    // ETSI still says SHALL but is outranked by the go-live replacement.
    expect(ids(inside.overruled)).toContain('etsi-472-3/TOKEN-REQ-4.5.1-01')

    const after = resolve(stack, ctx({ asOf: '2027-01-01' }), table, sl)
    expect(ids(after.decidedBy)).toEqual(['cir/TR-WIA-3/token'])
    expect(timeline(stack, ctx({}), table, sl).map((t) => [t.from, t.rule.level])).toEqual([
      ['2026-10-15', 'may'],
      ['2027-01-01', 'shall'],
    ])
  })

  it('a neutraliser that does not outrank its target is a conflict', () => {
    const lower = Assertion.parse({
      id: 'test/haip-voids-cir',
      subject: 'vci.token-request.oauth-client-attestation',
      spec: 'haip-1.0',
      locator: { at: 'test' },
      relation: 'voids',
      target: 'cir/TR-WIA-3/token',
    })
    const r = resolve([...stackOf('vci.token-request.oauth-client-attestation'), lower], ctx({}), table, specLayer)
    expect(r.status).toBe('conflict')
    expect(r.conflicts[0]!.reason).toMatch(/does not outrank/)
  })
})

describe('other precedence outcomes in the data', () => {
  it('refresh tokens: ETSI MAY overrules HAIP RECOMMENDED', () => {
    const r = resolve(stackOf('vci.refresh-token'), ctx({ role: 'as' }), table, specLayer)
    expect(r.level).toBe('may')
    expect(ids(r.decidedBy)).toEqual(['etsi-472-3/TOKEN-REQ-PROC-4.5.2-04'])
    expect(ids(r.overruled)).toEqual(['haip/4.4/refresh'])
  })

  it('issuer_info registration certificate: CIR adapts ETSI may → shall', () => {
    const r = resolve(stackOf('vci.metadata.issuer_info.registration_cert'), ctx({ role: 'issuer' }), table, specLayer)
    expect(r.level).toBe('shall')
    expect(r.neutralised.map((n) => n.assertion.id)).toEqual(['etsi-472-3/ISS-MDATA-REG_CERT-4.2.3-04'])
  })

  it('registrar_dataset in issuer_info is voided by the CIR: nothing normative remains', () => {
    const r = resolve(stackOf('vci.metadata.issuer_info.registrar_dataset'), ctx({ role: 'issuer' }), table, specLayer)
    expect(r.status).toBe('undecided')
    expect(r.neutralised).toHaveLength(2)
  })

  it('offer scheme: ETSI eu-eaa-offer:// SHALL overrules HAIP MAY haip-vci://', () => {
    const r = resolve(stackOf('vci.offer.scheme'), ctx({ role: 'issuer' }), table, specLayer)
    expect(ids(r.decidedBy)).toEqual(['etsi-472-3/GEN-REQ-4.1-06'])
    expect(ids(r.overruled)).toEqual(expect.arrayContaining(['haip/4.2/scheme', 'oid4vci/scheme/default']))
  })
})

describe('same-rank specificity', () => {
  it('a narrowing statement beats a defining one of the same layer without a contradiction', () => {
    const r = resolve(stackOf('vci.as-metadata.token_endpoint_auth_methods_supported'), ctx({ role: 'as' }), table, specLayer)
    expect(r.status).toBe('decided')
    expect(r.level).toBe('should')
    expect(ids(r.decidedBy)).toEqual(['abca-07/10.1/auth-method'])
    expect(ids(r.overruled)).toEqual(['rfc8414/2/token_endpoint_auth_methods_supported'])
  })
})

describe('assumptions and resolved interpretations', () => {
  it('an assumption outranks the literal CIR text it interprets', () => {
    const r = resolve(stackOf('vci.proof-jwt.signing-key'), ctx({ role: 'wallet' }), table, specLayer)
    expect(ids(r.decidedBy)).toEqual(['assumption/TR_KA_3.1-proof-jwt'])
    expect(r.neutralised.map((n) => n.assertion.id)).toEqual(['cir/TR_KA_3.1'])
    expect(r.status).toBe('decided')
  })

  it('without the assumption layer the defective CIR text decides and is flagged', () => {
    const layers = new Set<LayerId>(['cir', 'etsi', 'haip', 'base', 'primitive', 'arf'])
    const r = resolve(stackOf('vci.proof-jwt.signing-key'), ctx({ role: 'wallet', layers }), table, specLayer)
    expect(ids(r.decidedBy)).toEqual(['cir/TR_KA_3.1'])
    expect(r.status).toBe('needs-review')
  })

  it('once resolved into the CIR layer, the interpretation replaces the literal text within the same rank', () => {
    const resolved = stackOf('vci.proof-jwt.signing-key').map((a) =>
      a.id === 'assumption/TR_KA_3.1-proof-jwt' ? { ...a, id: 'resolved/TR_KA_3.1', spec: 'resolved-cir' } : a,
    )
    const r = resolve(resolved, ctx({ role: 'wallet' }), table, specLayer)
    expect(ids(r.decidedBy)).toEqual(['resolved/TR_KA_3.1'])
    expect(r.neutralised.map((n) => [n.assertion.id, n.by.id])).toEqual([['cir/TR_KA_3.1', 'resolved/TR_KA_3.1']])
    expect(r.conflicts).toEqual([])
  })
})

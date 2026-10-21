import { describe, expect, it } from 'vitest'
import { loadDataset } from '../../scripts/lib/data.ts'
import { buildOpenApi, openApiYaml } from './openapi'
import { Subject, type LayerId } from './schema'

type Json = Record<string, any>

const ds = loadDataset({ requireEncoded: true })
const layers = new Set<LayerId>(ds.layers.filter((l) => l.id !== 'secondary').map((l) => l.id))
const doc = buildOpenApi(ds, { view: 'verifier', asOf: '2026-10-20', layers }) as Json
const paths = doc.paths as Json

// The Request Object answer of GET /request/{id}: one anyOf branch per flow that fetches it (SD-JWT VC, ISO mdoc).
const requestObject = (flowId: string) =>
  (paths['/request/{id}'].get.responses['200'].content['application/oauth-authz-req+jwt'].schema.anyOf as Json[]).find(
    (b) => b['x-flow'].id === flowId,
  )!['x-jwt'].payload

describe('verifier OpenAPI export', () => {
  it('serves the Request Object as application/oauth-authz-req+jwt (RFC 9101 §4), from the example Content-Type', () => {
    const content = paths['/request/{id}'].get.responses['200'].content
    expect(Object.keys(content)).toEqual(['application/oauth-authz-req+jwt'])
  })

  it('cites the RFC 9101 §5.2.3 GET fetch on the request_uri endpoint', () => {
    expect(paths['/request/{id}'].get['x-provenance'].decidedBy.map((d: Json) => d.assertion)).toContain('rfc9101/5.2.3/get')
  })

  it('exports the same-device and the cross-device answer of /response, each resolved in its own variant', () => {
    const op = paths['/response'].post
    expect(op['x-flow'].id).toBe('vp-redirect-same')
    const alts = op.responses['200'].content['application/json'].schema.anyOf as Json[]
    const same = alts.find((a) => a['x-flow'].id === 'vp-redirect-same')!
    const cross = alts.find((a) => a['x-flow'].id === 'vp-redirect-cross')!
    // HAIP §5.1: Verifiers MUST include redirect_uri (same device only).
    expect(same.required).toEqual(['redirect_uri'])
    expect(same.properties.redirect_uri['x-provenance'].decidedBy[0].assertion).toBe('haip/5.1/redirect-back')
    expect(cross.required).toBeUndefined()
  })

  it('types claims path pointer items as strings, nulls and non-negative integers (OpenID4VP §7)', () => {
    const ro = requestObject('vp-redirect-same')
    const path = ro.properties.dcql_query.properties.credentials.items.properties.claims.items.properties.path
    expect(path.items).toEqual({ type: ['string', 'null', 'integer'], minimum: 0 })
    expect(path.minItems).toBe(1)
  })

  it('exports the mdoc Request Object as its own branch with the mso_mdoc parameters', () => {
    const ro = requestObject('vp-redirect-same-mdoc')
    const query = ro.properties.dcql_query.properties.credentials.items
    expect(query.properties.meta.properties.doctype_value['x-provenance'].subject).toBe('vp.dcql.doctype_value')
    const mdoc = ro.properties.client_metadata.properties.vp_formats_supported.properties.mso_mdoc
    expect(mdoc['x-provenance'].subject).toBe('vp.request-object.client_metadata.vp_formats_supported.mso_mdoc')
    expect(mdoc.properties.issuerauth_alg_values['x-provenance'].subject).toBe('vp.request-object.client_metadata.issuerauth_alg_values')
  })

  it('types an mdoc claims path as exactly two strings (OpenID4VP §7.2, §7.2.1)', () => {
    const ro = requestObject('vp-redirect-same-mdoc')
    const path = ro.properties.dcql_query.properties.credentials.items.properties.claims.items.properties.path
    expect(path).toMatchObject({ type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } })
    expect(path['x-provenance'].schemaBasis.assertion).toBe('oid4vp/7.2/mdoc-claims-path')
  })

  it('writes YAML without anchors or aliases', () => {
    const yaml = openApiYaml(doc)
    expect(yaml).not.toMatch(/[&*]a\d+\b/)
  })

  it('requires type and values in each trusted_authorities entry (OpenID4VP §6.1.1), RO-17 on type', () => {
    const entry = requestObject('vp-redirect-same-mdoc').properties.dcql_query.properties.credentials.items.properties.trusted_authorities.items
    expect(entry.required).toEqual(['type', 'values'])
    expect(entry.properties.type['x-provenance'].decidedBy.map((d: Json) => d.assertion)).toEqual(['etsi-472-2/OIDFVP-HAIP-COMMON-REQ-RO-17'])
    expect(entry.properties.values['x-provenance'].decidedBy.map((d: Json) => d.assertion)).toEqual(['oid4vp/6.1.1/values'])
  })

  it('decides credentials[].format by the HAIP format identifier rule of each format', () => {
    const format = (flowId: string) => requestObject(flowId).properties.dcql_query.properties.credentials.items.properties.format['x-provenance']
    expect(format('vp-redirect-same-mdoc').decidedBy.map((d: Json) => d.assertion)).toEqual(['haip/5.3.1/mso_mdoc'])
    expect(format('vp-redirect-same').decidedBy.map((d: Json) => d.assertion)).toEqual(['haip/5.3.2/dc-sd-jwt'])
  })

  it('cites OpenID4VP §8.2 direct_post on the /response operation', () => {
    expect(paths['/response'].post['x-provenance'].decidedBy.map((d: Json) => d.assertion)).toEqual(['oid4vp/8.2/direct_post'])
  })

  it('states the registration certificate element of verifier_info as contains, not per item', () => {
    for (const flowId of ['vp-redirect-same', 'vp-redirect-same-mdoc']) {
      const info = requestObject(flowId).properties.verifier_info
      expect(info.items['x-provenance']).toBeUndefined()
      expect(info.contains['x-provenance'].subject).toBe('vp.request-object.verifier_info.registration_cert')
      expect(info.contains.properties.format.const).toBe('registration_cert')
      expect(info.contains.properties.credential_ids.not).toEqual({})
      expect(info.contains.properties.credential_ids['x-provenance'].decidedBy[0].assertion).toBe('etsi-472-2/OIDFVP-HAIP-COMMON-REQ-RO-14')
    }
  })

  it('annotates jwks key members and the dc+sd-jwt key with their own subjects', () => {
    const ro = requestObject('vp-redirect-same')
    const meta = ro.properties.client_metadata.properties
    const key = meta.jwks.properties.keys.items
    for (const k of ['kid', 'use', 'alg']) expect(key.properties[k]['x-provenance'].subject).toBe(`vp.request-object.client_metadata.jwks.${k}`)
    expect(key.required).toEqual(expect.arrayContaining(['kid', 'use', 'alg']))
    const formats = meta.vp_formats_supported
    expect(formats.properties['dc+sd-jwt']['x-provenance'].subject).toBe('vp.request-object.client_metadata.vp_formats_supported.dc-sd-jwt')
    expect(formats.required).toEqual(['dc+sd-jwt'])
  })
})

describe('strict data schemas', () => {
  it('rejects the stray key an unquoted comma in a flow-mapping title creates', () => {
    // `{ id: x, title: iss (JAR, ignored by the Wallet) }` parses as title "iss (JAR" plus a key "ignored by the Wallet)".
    const r = Subject.safeParse({ id: 'x', kind: 'field', title: 'iss (JAR', 'ignored by the Wallet)': null })
    expect(r.success).toBe(false)
  })
})

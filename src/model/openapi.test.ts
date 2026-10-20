import { describe, expect, it } from 'vitest'
import { loadDataset } from '../../scripts/lib/data.ts'
import { buildOpenApi } from './openapi'
import { Subject, type LayerId } from './schema'

type Json = Record<string, any>

const ds = loadDataset({ requireEncoded: true })
const layers = new Set<LayerId>(ds.layers.filter((l) => l.id !== 'impl-de' && l.id !== 'secondary').map((l) => l.id))
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

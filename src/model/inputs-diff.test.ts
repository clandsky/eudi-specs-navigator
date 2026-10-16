import { describe, expect, it } from 'vitest'
import { coveredBy, diffInputs } from './inputs-diff'

describe('diffInputs', () => {
  const before = {
    http: { status: 200, headers: { 'Content-Type': 'application/oauth-authz-req+jwt' }, body: { type: 'jwt', value: '{{jwt:ro}}' } },
    jwts: {
      ro: { key: 'k', header: { typ: 'oauth-authz-req+jwt', iat: 1 }, payload: { nonce: 'n', client_metadata: { enc: ['A128GCM', 'A256GCM'] } } },
      pid: { key: 'p', payload: { vct: 'a' }, disclosures: [{ name: 'given_name', value: 'Erika' }], kb: { key: 'w', payload: { nonce: 'n' } } },
    },
  }

  it('maps changed, added and removed inputs to view pointers', () => {
    const after = structuredClone(before) as typeof before & { jwts: { ro: { payload: Record<string, unknown> } } }
    delete (after.jwts.ro.header as { iat?: number }).iat
    after.jwts.ro.payload.client_metadata.enc = ['A128GCM']
    after.jwts.ro.payload.iss = 'x'
    after.jwts.pid.disclosures[0]!.value = 'ERIKA'
    after.jwts.pid.kb.payload.nonce = 'm'
    expect(diffInputs(before, after)).toEqual({
      changed: [
        '/jwt/pid-kb/payload/nonce',
        '/jwt/pid/payload/_sd',
        '/jwt/ro/payload/client_metadata/enc',
        '/jwt/ro/payload/iss',
      ],
      removed: ['/jwt/ro/header/iat'],
    })
  })

  it('reports nothing for an unchanged body', () => {
    expect(diffInputs(before, structuredClone(before))).toEqual({ changed: [], removed: [] })
  })

  it('covers a field and everything below it', () => {
    expect(coveredBy('/jwt/ro/payload/a/b', ['/jwt/ro/payload/a'])).toBe(true)
    expect(coveredBy('/jwt/ro/payload/ab', ['/jwt/ro/payload/a'])).toBe(false)
  })
})

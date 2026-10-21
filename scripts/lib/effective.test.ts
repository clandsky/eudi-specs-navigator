import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LayerId } from '../../src/model/schema.ts'
import { ROOT, loadDataset } from './data.ts'
import { buildEffectiveApi } from './effective.ts'

const ds = loadDataset({ requireEncoded: true })
const layers = new Set<LayerId>(ds.layers.filter((l) => l.id !== 'secondary').map((l) => l.id))
const asOf = '2026-10-21'
const eaa = buildEffectiveApi(ds, { side: 'issuer', asOf, layers })
const vp = buildEffectiveApi(ds, { side: 'verifier', asOf, layers })

/** The line that declares a member, e.g. line(vp, "typ:") within the type that follows `after`. */
function line(text: string, after: string, member: string): string {
  const from = text.indexOf(after)
  expect(from, after).toBeGreaterThan(-1)
  const rest = text.slice(from).split('\n')
  return rest.find((l) => l.trimStart().startsWith(member)) ?? ''
}

describe('effective API', () => {
  it.each([
    ['issuer', 'vci', eaa],
    ['verifier', 'vp', vp],
  ] as const)('states every subject with assertions on the %s side', (_side, root, api) => {
    const subjects = new Map(ds.subjects.map((s) => [s.id, s]))
    const rootOf = (id: string) => {
      let s = subjects.get(id)
      while (s?.parent) s = subjects.get(s.parent)
      return s?.id
    }
    const withRules = new Set(ds.assertions.map((a) => a.subject))
    const expected = ds.subjects.filter((s) => s.kind !== 'flow' && rootOf(s.id) === root && withRules.has(s.id)).map((s) => s.id)
    expect(expected.filter((id) => !api.covered.has(id))).toEqual([])
  })

  it('is deterministic', () => {
    expect(buildEffectiveApi(ds, { side: 'verifier', asOf, layers }).text).toBe(vp.text)
  })

  it('compiles as TypeScript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'effective-'))
    writeFileSync(join(dir, 'eaa.ts'), eaa.text)
    writeFileSync(join(dir, 'vp.ts'), vp.text)
    const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
    expect(() =>
      execFileSync(tsc, ['--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--types', 'node', join(dir, 'eaa.ts'), join(dir, 'vp.ts')], { stdio: 'pipe' }),
    ).not.toThrow()
  }, 30_000)

  it('keeps response encryption required although the CIR voids the ETSI duplicate', () => {
    const rule = line(vp.text, '// ── Response encryption', '// rule:')
    expect(rule).toMatch(/Wallet: MUST/)
    // The deciding wording is HAIP's, referenced from the rule line.
    const ref = vp.text.match(/\[R(\d+)\] "Response encryption MUST be performed/)?.[1]
    expect(rule).toContain(`[R${ref}]`)
  })

  it('states fixed values as literal types and the receiver rules next to the producer rule', () => {
    expect(line(vp.text, 'export type RequestObject =', 'typ:')).toMatch(/^\s+typ: "oauth-authz-req\+jwt" \/\/ MUST; Wallet: MUST/)
  })

  it('marks fields that exist only in some flows', () => {
    expect(line(vp.text, 'export type RequestObject =', 'doctype_value:')).toContain('only redirect-same-mdoc: MUST')
  })

  it('applies the d-you go-live compromises', () => {
    // golive/request-object.header-iat: the d-you verifier does not put iat into the JWS header of the Request Object.
    expect(vp.text).toMatch(/iat \(JOSE header\): Verifier: MAY.*d-you verifier does not put iat into the JWS Protected Header/)
  })

  it('defines an embedded JWT once, where it is issued, and references it elsewhere', () => {
    expect(eaa.text.match(/export type WalletInstanceAttestation =/g)).toHaveLength(1)
    expect(line(eaa.text, 'export interface TokenRequest', '"OAuth-Client-Attestation":')).toContain('WalletInstanceAttestation')
    expect(line(eaa.text, 'export type WalletInstanceAttestation =', 'wallet_name:')).toMatch(/wallet_name: string \/\/ MUST/)
  })

  it('renders data-carrying keys as index signatures and keeps member names literal', () => {
    expect(line(vp.text, 'export type AuthorizationResponse =', '[credential_query_id: string]:')).not.toBe('')
    expect(line(vp.text, 'export type RequestObject =', 'id:')).toMatch(/^\s+id: string/)
  })
})

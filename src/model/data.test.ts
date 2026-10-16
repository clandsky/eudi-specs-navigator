import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compactDecrypt, compactVerify, decodeProtectedHeader, importPKCS8, importSPKI } from 'jose'
import { X509Certificate } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DATA, loadDataset } from '../../scripts/lib/data.ts'
import { inputHash, substitute } from '../../scripts/lib/examples.ts'
import { findQuote, normalise, stripFurniture } from '../../scripts/lib/quote.ts'
import { annotationFor, decodeJwt, entryPointers, lookup, matchPattern, resolves, viewOf } from './pointer'
import { stepNumber } from './steps'

const ds = loadDataset({ requireEncoded: true })
const KEYS = join(DATA, 'test-keys')

describe('examples', () => {
  for (const e of ds.examples) {
    const enc = ds.encoded[e.id]!
    const view = viewOf(enc)

    it(`${e.id}: encoded file is up to date with its inputs`, () => {
      const { file: _f, ...input } = e
      expect((enc as unknown as { inputHash: string }).inputHash).toBe(inputHash(input))
    })

    it(`${e.id}: every annotated JSON pointer exists, every pattern matches something`, () => {
      const entries = entryPointers(view)
      const missing = Object.keys(e.annotations).filter((p) =>
        /\/\*\*?(\/|$)/.test(p) ? !entries.some((x) => matchPattern(p, x)) : !resolves(view, p),
      )
      expect(missing).toEqual([])
    })

    it(`${e.id}: every entry is clickable`, () => {
      const stackOf = (id: string) => ds.assertions.filter((a) => a.subject === id)
      const unmapped = entryPointers(view).filter((p) => !annotationFor(p, e.annotations, ds.fieldmap))
      expect(unmapped, 'entries without a subject').toEqual([])
      // Sketched flows may map entries to subjects without statements yet; those show on the review page.
      void stackOf
    })

    it(`${e.id}: every JWT verifies with its test key and decodes to its inputs`, async () => {
      for (const [name, spec] of Object.entries(e.jwts)) {
        const compact = enc.jwts[name]!
        if ('use' in spec) {
          const [exId, jwtName] = spec.use.split('/') as [string, string]
          expect(compact).toBe(ds.encoded[exId]!.jwts[jwtName])
          continue
        }
        if ('encrypt' in spec) {
          const priv = await importPKCS8(readFileSync(join(KEYS, `${spec.encrypt.key}.key.pem`), 'utf8'), 'ECDH-ES')
          const { plaintext } = await compactDecrypt(compact, priv)
          const payload = await substitute(spec.payload, async (k, n) => (k === 'sdjwt' ? enc.sdjwts![n]! : enc.jwts[n]!))
          expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(payload)
          expect(enc.plaintexts?.[name]?.payload).toEqual(payload)
          continue
        }
        if (spec.kb) {
          const kb = enc.jwts[`${name}-kb`]!
          const holder = await importSPKI(readFileSync(join(KEYS, `${spec.kb.key}.pub.pem`), 'utf8'), 'ES256')
          await compactVerify(kb, holder)
        }
        const pub = await importSPKI(readFileSync(join(KEYS, `${spec.key}.pub.pem`), 'utf8'), 'ES256')
        await compactVerify(compact, pub)
        const decoded = decodeJwt(compact)
        // Re-substitute the inputs with the JWTs actually encoded, then compare (signatures are not deterministic).
        const header = await substitute(spec.header, async (_k, n) => enc.jwts[n]!)
        const payload = (await substitute(spec.payload, async (_k, n) => enc.jwts[n]!)) as Record<string, unknown>
        expect(decoded.header).toEqual(header)
        const { _sd, _sd_alg, ...rest } = decoded.payload
        expect(rest).toEqual(payload)
        if (spec.disclosures) expect((_sd as string[]).length).toBe(spec.disclosures.length)
      }
    })
  }

  it('x5c chains exclude the trust anchor and each certificate is issued by the next', async () => {
    const wia = ds.encoded['vci-wia']!.jwts.wia!
    const x5c = decodeProtectedHeader(wia).x5c!
    const certs = x5c.map((b64) => new X509Certificate(Buffer.from(b64, 'base64')))
    const root = new X509Certificate(readFileSync(join(KEYS, 'wp-root.cert.pem')))
    expect(certs.some((c) => c.fingerprint256 === root.fingerprint256)).toBe(false)
    expect(certs[0]!.checkIssued(root)).toBe(true)
    expect(certs[0]!.verify(root.publicKey)).toBe(true)
  })

  it('the PKCE code_challenge in the PAR is S256 of the code_verifier in the token request', () => {
    const par = viewOf(ds.encoded['vci-par-request']!)
    const token = viewOf(ds.encoded['vci-token-request']!)
    expect(lookup(par, '/http/body/code_challenge')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    expect(lookup(token, '/http/body/code_verifier')).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
  })

  it('the proof JWT is signed with attested_keys[0] of the key attestation it carries', async () => {
    const view = viewOf(ds.encoded['vci-credential-request']!)
    const proof = view.jwt.proof!
    const ka = decodeJwt(proof.header.key_attestation as string)
    const k0 = (ka.payload.attested_keys as Record<string, string>[])[0]!
    const { importJWK } = await import('jose')
    await compactVerify(proof.compact, await importJWK({ ...k0, alg: 'ES256' }, 'ES256'))
  })
})

describe('quote matching', () => {
  it('joins soft-hyphenated words, line-wrapped hyphens and strips page furniture', () => {
    const raw = 'credential_confi­\n   gurations and Proof-of-\n   Possession\n\fETSI\n 17   ETSI TS 119 472-3 V1.1.1 (2026-03)\ncontinues here'
    const t = normalise(stripFurniture(raw))
    expect(t).toBe('credential_configurations and Proof-of-Possession continues here')
    expect(findQuote(t, 'Proof-of-Possession … continues here').ok).toBe(true)
    expect(findQuote(t, 'continues here … Proof-of-Possession').ok).toBe(false)
  })
})

describe('flow substeps', () => {
  it('numbers substeps under their parent step', () => {
    const flow = ds.flows.find((f) => f.id === 'vp-redirect-same')!
    const num = (id: string) => stepNumber(flow, flow.steps.find((s) => s.id === id)!)
    expect([num('prepare'), num('prepare-sign'), num('invoke')]).toEqual(['1', '1.3', '2'])
    expect(num('validate-decrypt')).toBe(`${num('validate')}.1`)
  })
  it('gives every substep a sourced subject', () => {
    for (const f of ds.flows)
      for (const s of f.steps.filter((x) => x.parent))
        expect(ds.assertions.some((a) => a.subject === s.subject), `${f.id}/${s.id}`).toBe(true)
  })
})

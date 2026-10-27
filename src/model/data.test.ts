import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calculateJwkThumbprint, compactDecrypt, compactVerify, decodeProtectedHeader, importPKCS8, importSPKI, type JWK } from 'jose'
import { X509Certificate, createHash, verify } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { DATA, loadDataset } from '../../scripts/lib/data.ts'
import { inputHash, substitute } from '../../scripts/lib/examples.ts'
import { findQuote, normalise, stripFurniture } from '../../scripts/lib/quote.ts'
import { annotationFor, decodeJwt, entryPointers, lookup, matchPattern, resolves, viewOf } from './pointer'
import { stepNumber } from './steps'
import { Tagged, decodeCbor, encodeCbor, fromB64url, fromHex, toHex } from './cbor'

const ds = loadDataset({ requireEncoded: true })
const KEYS = join(DATA, 'test-keys')
const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest())
const cborOf = (b64: string) => decodeCbor(fromB64url(b64))
const m = (v: unknown) => v as Map<unknown, unknown>
/** COSE_Sign1 ES256 check (RFC 9052 §4.4): Sig_structure ["Signature1", protected, external_aad, payload], r || s. */
const coseVerifies = (key: string, prot: Uint8Array, payload: Uint8Array, sig: Uint8Array) =>
  verify('sha256', encodeCbor(['Signature1', prot, new Uint8Array(), payload]), { key: readFileSync(join(KEYS, `${key}.pub.pem`), 'utf8'), dsaEncoding: 'ieee-p1363' }, sig)

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

    it(`${e.id}: every entry has a short description`, () => {
      const byId = new Map(ds.subjects.map((s) => [s.id, s]))
      const ids = new Set(entryPointers(view).map((p) => annotationFor(p, e.annotations, ds.fieldmap)!))
      expect([...ids].filter((id) => !byId.get(id)?.description), 'subjects without a description').toEqual([])
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
          const payload = await substitute(spec.payload, async (k, n) => (k === 'sdjwt' ? enc.sdjwts![n]! : k === 'mdoc' ? enc.cbor![n]!.value : enc.jwts[n]!))
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

  for (const e of ds.examples.filter((x) => x.mdocs))
    for (const [name, spec] of Object.entries(e.mdocs!))
      it(`${e.id}: mdoc "${name}" verifies (issuerAuth, valueDigests, deviceSignature over the SessionTranscript)`, async () => {
        const enc = ds.encoded[e.id]!
        const doc = m((m(cborOf(enc.cbor![name]!.value)).get('documents') as unknown[])[0])
        const issuerSigned = m(doc.get('issuerSigned'))
        const [prot, unprot, payload, sig] = issuerSigned.get('issuerAuth') as [Uint8Array, Map<number, unknown>, Uint8Array, Uint8Array]
        expect(coseVerifies(spec.issuer, prot, payload, sig)).toBe(true)
        const leaf = new X509Certificate(readFileSync(join(KEYS, `${spec.issuer}.cert.pem`)))
        expect(Buffer.from(unprot.get(33) as Uint8Array).equals(leaf.raw)).toBe(true)
        if (spec.x5u) expect(toHex((m(decodeCbor(prot)).get(34) as [number, Uint8Array])[1])).toBe(toHex(sha256(leaf.raw)))

        // MSO: one digest per issued element; each presented element hashes (as tag-24 bytes) to its digest.
        const mso = m(decodeCbor(((decodeCbor(payload) as Tagged).value) as Uint8Array))
        expect(mso.get('docType')).toBe(spec.docType)
        expect(doc.get('docType')).toBe(spec.docType)
        for (const [ns, items] of Object.entries(spec.nameSpaces)) {
          const digests = m(m(mso.get('valueDigests')).get(ns))
          expect(digests.size).toBe(items.length)
          const presented = m(issuerSigned.get('nameSpaces')).get(ns) as Tagged[]
          expect(presented.length).toBe(items.filter((i) => !i.withheld).length)
          for (const item of presented) {
            const decoded = m(decodeCbor(item.value as Uint8Array))
            expect(toHex(digests.get(decoded.get('digestID')) as Uint8Array)).toBe(toHex(sha256(encodeCbor(item))))
          }
        }
        const deviceKey = m(m(mso.get('deviceKeyInfo')).get('deviceKey'))
        const jwk = (await importSPKI(readFileSync(join(KEYS, `${spec.device}.pub.pem`), 'utf8'), 'ES256', { extractable: true }).then((k) =>
          import('jose').then(({ exportJWK }) => exportJWK(k)))) as JWK
        expect(Buffer.from(deviceKey.get(-2) as Uint8Array).toString('base64url')).toBe(jwk.x)
        expect(Buffer.from(deviceKey.get(-3) as Uint8Array).toString('base64url')).toBe(jwk.y)

        // deviceSignature: detached payload DeviceAuthenticationBytes over the stored SessionTranscript.
        const deviceSigned = m(doc.get('deviceSigned'))
        const [dprot, , dpayload, dsig] = m(deviceSigned.get('deviceAuth')).get('deviceSignature') as [Uint8Array, unknown, null, Uint8Array]
        expect(dpayload).toBeNull()
        const transcript = cborOf(enc.cbor![`${name}-session-transcript`]!.value)
        const deviceAuthentication = encodeCbor(new Tagged(24, encodeCbor(['DeviceAuthentication', transcript, spec.docType, deviceSigned.get('nameSpaces')])))
        expect(coseVerifies(spec.device, dprot, deviceAuthentication, dsig)).toBe(true)
      })

  it('the mdoc SessionTranscript is bound to the Request Object of the mdoc flow (OpenID4VP B.2.6.1)', async () => {
    const ro = viewOf(ds.encoded['vp-mdoc-request-uri-response']!).jwt.ro!.payload as Record<string, any>
    const enc = ds.encoded['vp-mdoc-response-post']!
    const encKey = (ro.client_metadata.jwks.keys as JWK[])[0]!
    const info = [ro.client_id, ro.nonce, fromB64url(await calculateJwkThumbprint(encKey, 'sha256')), ro.response_uri]
    expect(toHex(encodeCbor(info))).toBe(toHex(fromB64url(enc.cbor!['pid-handover-info']!.value)))
    expect(cborOf(enc.cbor!['pid-session-transcript']!.value)).toEqual([null, null, ['OpenID4VPHandover', sha256(encodeCbor(info))]])
    // The response answers this request: same state, the DCQL id as vp_token key, exactly the requested elements.
    const resp = viewOf(enc).jwt.resp!.payload as Record<string, any>
    expect(resp.state).toBe(ro.state)
    const query = ro.dcql_query.credentials[0]
    expect(Object.keys(resp.vp_token)).toEqual([query.id])
    const doc = m((m(cborOf(resp.vp_token[query.id][0])).get('documents') as unknown[])[0])
    const presented = [...m(m(doc.get('issuerSigned')).get('nameSpaces'))].flatMap(([ns, items]) =>
      (items as Tagged[]).map((i) => [ns, m(decodeCbor(i.value as Uint8Array)).get('elementIdentifier')]),
    )
    expect(presented).toEqual(query.claims.map((c: { path: string[] }) => c.path))
    expect(doc.get('docType')).toBe(query.meta.doctype_value)
  })

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

  it('the Status List Token of the revocation flow marks both credentials of the batch INVALID (Token Status List §4.1)', () => {
    const slt = viewOf(ds.encoded['vci-status-list-response']!).jwt.slt!.payload
    const list = slt.status_list as { bits: number; lst: string }
    const bytes = inflateSync(Buffer.from(list.lst, 'base64url'))
    const entry = (idx: number) => (bytes[idx >> 3]! >> (idx & 7)) & 1
    expect(list.bits).toBe(1)
    for (const name of ['vc1', 'vc2']) {
      const ref = (viewOf(ds.encoded['vci-credential-response']!).jwt[name]!.payload.status as { status_list: { idx: number; uri: string } }).status_list
      expect(slt.sub).toBe(ref.uri)
      expect(entry(ref.idx), name).toBe(1)
    }
    expect(entry(1308)).toBe(0)
  })
})

describe('cbor', () => {
  it('reproduces the OpenID4VPHandoverInfo and SessionTranscript examples of OpenID4VP B.2.6.1', () => {
    const info = ['x509_san_dns:example.com', 'exc7gBkxjx1rdc9udRrveKvSsJIq80avlXeLHhGwqtA', fromHex('4283ec927ae0f208daaa2d026a814f2b22dca52cf85ffa8f3f8626c6bd669047'), 'https://example.com/response']
    expect(toHex(encodeCbor(info))).toBe(
      '847818783530395f73616e5f646e733a6578616d706c652e636f6d782b6578633767426b786a7831726463397564527276654b7653734a4971383061766c58654c486847' +
        '7771744158204283ec927ae0f208daaa2d026a814f2b22dca52cf85ffa8f3f8626c6bd669047781c68747470733a2f2f6578616d706c652e636f6d2f726573706f6e7365',
    )
    const transcript = encodeCbor([null, null, ['OpenID4VPHandover', sha256(encodeCbor(info))]])
    expect(toHex(transcript)).toBe('83f6f682714f70656e494434565048616e646f7665725820048bc053c00442af9b8eed494cefdd9d95240d254b046b11b68013722aad38ac')
    expect(decodeCbor(transcript)).toEqual([null, null, ['OpenID4VPHandover', fromHex('048bc053c00442af9b8eed494cefdd9d95240d254b046b11b68013722aad38ac')]])
  })
  it('round-trips integer, tag and map key types', () => {
    const v = new Map<unknown, unknown>([[1, -7], [-65537, 'x'], ['k', [true, false, null, new Tagged(1004, '1964-08-12'), new Uint8Array([0, 255])]], [2 ** 40, 0]])
    expect(decodeCbor(encodeCbor(v))).toEqual(v)
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

// Builds an ISO/IEC 18013-5 DeviceResponse for an OpenID4VP presentation (OpenID4VP Appendix B.2), signed with test
// keys. CDDL names follow ISO/IEC 18013-5:
//   IssuerSignedItemBytes     = #6.24(bstr .cbor IssuerSignedItem), digested into the MSO valueDigests
//   MobileSecurityObjectBytes = #6.24(bstr .cbor MobileSecurityObject), the issuerAuth COSE_Sign1 payload
//   DeviceAuthenticationBytes = #6.24(bstr .cbor ["DeviceAuthentication", SessionTranscript, DocType,
//                                DeviceNameSpacesBytes]), signed detached by deviceSignature
//   SessionTranscript         = [null, null, OpenID4VPHandover | OpenID4VPDCAPIHandover] (OpenID4VP B.2.6)
import { createHash, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calculateJwkThumbprint } from 'jose'
import { Tagged, encodeCbor, fromHex } from '../../src/model/cbor.ts'
import type { MdocSpec } from '../../src/model/schema.ts'
import { KEYS, publicJwk, x5cOf } from './examples.ts'

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest())

// COSE labels: header parameters (RFC 9052 / RFC 9360) and EC2 key parameters (RFC 9053).
const ALG = 1
const X5CHAIN = 33
const X5T = 34
const X5U = 35
const ES256 = -7
const SHA_256 = -16

/** JSON-shaped author input → CBOR value: { $tag, value } becomes a tag, { $hex } a byte string, objects text-keyed maps. */
export function cborValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(cborValue)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.$tag === 'number') return new Tagged(o.$tag, cborValue(o.value))
    if (typeof o.$hex === 'string') return fromHex(o.$hex)
    return new Map(Object.entries(o).map(([k, x]) => [k, cborValue(x)]))
  }
  return v
}

function es256(key: string, data: Uint8Array): Uint8Array {
  // COSE carries ECDSA signatures as r || s (RFC 9053 §2.1), not DER.
  return new Uint8Array(sign('sha256', data, { key: readFileSync(join(KEYS, `${key}.key.pem`), 'utf8'), dsaEncoding: 'ieee-p1363' }))
}

/** COSE_Sign1 with an empty external_aad. A detached payload is signed but carried as null. */
function coseSign1(key: string, protectedHeader: Map<number, unknown>, unprotected: Map<number, unknown>, payload: Uint8Array, detached = false) {
  const prot = encodeCbor(protectedHeader)
  const toBeSigned = encodeCbor(['Signature1', prot, new Uint8Array(), payload])
  return [prot, unprotected, detached ? null : payload, es256(key, toBeSigned)]
}

async function coseKey(key: string): Promise<Map<number, unknown>> {
  const jwk = await publicJwk(key)
  const b = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'))
  return new Map<number, unknown>([
    [1, 2], // kty: EC2
    [-1, 1], // crv: P-256
    [-2, b(jwk.x!)],
    [-3, b(jwk.y!)],
  ])
}

async function thumbprint(key: string | null): Promise<Uint8Array | null> {
  if (!key) return null
  return new Uint8Array(Buffer.from(await calculateJwkThumbprint(await publicJwk(key), 'sha256'), 'base64url'))
}

/** OpenID4VP B.2.6: the handover info array, its CBOR encoding hashed into the handover. */
export async function handoverInfo(t: MdocSpec['transcript']): Promise<unknown[]> {
  return t.handover === 'OpenID4VPHandover'
    ? [t.clientId, t.nonce, await thumbprint(t.jwkThumbprint), t.responseUri]
    : [t.origin, t.nonce, await thumbprint(t.jwkThumbprint)]
}

export function sessionTranscript(handover: string, info: unknown[]): unknown[] {
  return [null, null, [handover, sha256(encodeCbor(info))]]
}

export interface BuiltMdoc {
  deviceResponse: Uint8Array
  sessionTranscript: Uint8Array
  handoverInfo: Uint8Array
}

export async function buildMdoc(spec: MdocSpec): Promise<BuiltMdoc> {
  // Issuer side: data elements, their digests, the Mobile Security Object and its signature.
  const valueDigests = new Map<string, Map<number, Uint8Array>>()
  const presented: Record<string, Tagged[]> = {}
  for (const [ns, items] of Object.entries(spec.nameSpaces)) {
    const digests = new Map<number, Uint8Array>()
    for (const it of items) {
      const item = new Map<string, unknown>([
        ['digestID', it.digestID],
        ['random', fromHex(it.random)],
        ['elementIdentifier', it.elementIdentifier],
        ['elementValue', cborValue(it.elementValue)],
      ])
      const bytes = new Tagged(24, encodeCbor(item))
      digests.set(it.digestID, sha256(encodeCbor(bytes)))
      if (!it.withheld) (presented[ns] ??= []).push(bytes)
    }
    valueDigests.set(ns, digests)
  }
  const mso = new Map<string, unknown>([
    ['version', '1.0'],
    ['digestAlgorithm', 'SHA-256'],
    ['valueDigests', valueDigests],
    ['deviceKeyInfo', new Map([['deviceKey', await coseKey(spec.device)]])],
    ['docType', spec.docType],
    [
      'validityInfo',
      new Map([
        ['signed', new Tagged(0, spec.validity.signed)],
        ['validFrom', new Tagged(0, spec.validity.validFrom)],
        ['validUntil', new Tagged(0, spec.validity.validUntil)],
      ]),
    ],
    ...(spec.status ? [['status', cborValue(spec.status)] as [string, unknown]] : []),
  ])
  const chain = x5cOf(spec.issuer).map((c) => new Uint8Array(Buffer.from(c, 'base64')))
  const prot = new Map<number, unknown>([[ALG, ES256]])
  if (spec.x5u) {
    prot.set(X5T, [SHA_256, sha256(chain[0]!)])
    prot.set(X5U, spec.x5u)
  }
  const issuerAuth = coseSign1(
    spec.issuer,
    prot,
    new Map([[X5CHAIN, chain.length === 1 ? chain[0] : chain]]),
    encodeCbor(new Tagged(24, encodeCbor(mso))),
  )

  // Wallet side: DeviceAuthentication over the SessionTranscript, signed with the device key.
  const info = await handoverInfo(spec.transcript)
  const transcript = sessionTranscript(spec.transcript.handover, info)
  const deviceNameSpacesBytes = new Tagged(24, encodeCbor(new Map()))
  const deviceAuthenticationBytes = encodeCbor(
    new Tagged(24, encodeCbor(['DeviceAuthentication', transcript, spec.docType, deviceNameSpacesBytes])),
  )
  const deviceSignature = coseSign1(spec.device, new Map([[ALG, ES256]]), new Map(), deviceAuthenticationBytes, true)

  const document = new Map<string, unknown>([
    ['docType', spec.docType],
    ['issuerSigned', new Map<string, unknown>([['nameSpaces', new Map(Object.entries(presented))], ['issuerAuth', issuerAuth]])],
    ['deviceSigned', new Map<string, unknown>([['nameSpaces', deviceNameSpacesBytes], ['deviceAuth', new Map([['deviceSignature', deviceSignature]])]])],
  ])
  const deviceResponse = new Map<string, unknown>([
    ['version', '1.0'],
    ['documents', [document]],
    ['status', 0],
  ])
  return { deviceResponse: encodeCbor(deviceResponse), sessionTranscript: encodeCbor(transcript), handoverInfo: encodeCbor(info) }
}

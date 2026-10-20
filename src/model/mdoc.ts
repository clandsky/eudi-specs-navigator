// Decoded view of the CBOR items an example carries (ISO/IEC 18013-5 DeviceResponse, SessionTranscript, …). The view
// is JSON-shaped so JSON pointers and the field map address it like any other part of an example:
//   map keys      → object keys (integer labels such as COSE "1" or "33" become strings)
//   byte strings  → "h'<hex>'" (CBOR diagnostic notation)
//   tag 24        → the embedded data item, decoded (IssuerSignedItemBytes, MobileSecurityObjectBytes, …)
//   other tags    → the tagged value (tdate, full-date)
// Inside a DeviceResponse the COSE_Sign1 structures (issuerAuth, deviceSignature) are opened as well: the protected
// header and the payload are byte strings that hold CBOR.
import { Tagged, decodeCbor, fromB64url, toHex } from './cbor'

const get = (m: unknown, k: unknown) => (m instanceof Map ? m.get(k) : undefined)

function unwrap(v: unknown): unknown {
  if (v instanceof Tagged && v.tag === 24 && v.value instanceof Uint8Array) return unwrap(decodeCbor(v.value))
  return v
}

/** COSE_Sign1 = [protected: bstr .cbor header_map, unprotected: header_map, payload: bstr / nil, signature: bstr]. */
function openCoseSign1(v: unknown): unknown {
  if (!Array.isArray(v) || v.length !== 4) return v
  const [p, u, payload, sig] = v as [unknown, unknown, unknown, unknown]
  const prot = p instanceof Uint8Array ? (p.length ? decodeCbor(p) : new Map()) : p
  const body = payload instanceof Uint8Array ? unwrap(decodeCbor(payload)) : payload
  return [prot, u, body, sig]
}

function openDeviceResponse(dr: Map<unknown, unknown>) {
  const docs = get(dr, 'documents')
  if (!Array.isArray(docs)) return
  for (const doc of docs) {
    const issuerSigned = get(doc, 'issuerSigned')
    if (issuerSigned instanceof Map && issuerSigned.has('issuerAuth')) issuerSigned.set('issuerAuth', openCoseSign1(issuerSigned.get('issuerAuth')))
    const deviceAuth = get(get(doc, 'deviceSigned'), 'deviceAuth')
    if (deviceAuth instanceof Map)
      for (const k of ['deviceSignature', 'deviceMac']) if (deviceAuth.has(k)) deviceAuth.set(k, openCoseSign1(deviceAuth.get(k)))
  }
}

export function toView(v: unknown): unknown {
  if (v instanceof Uint8Array) return `h'${toHex(v)}'`
  if (v instanceof Tagged) return toView(v.tag === 24 ? unwrap(v) : v.value)
  if (Array.isArray(v)) return v.map(toView)
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [typeof k === 'string' ? k : String(k), toView(x)]))
  return v === undefined ? null : v
}

/** Decodes a base64url CBOR item for display; a DeviceResponse gets its COSE structures opened. */
export function cborView(b64url: string): unknown {
  const v = decodeCbor(fromB64url(b64url))
  if (v instanceof Map && v.has('version') && v.has('status')) openDeviceResponse(v)
  return toView(v)
}

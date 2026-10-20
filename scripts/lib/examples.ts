// Example encoding. Authors write decoded inputs with placeholders; this module substitutes them and signs:
//   "{{jwt:name}}"    compact JWS of example.jwts[name]
//   "{{sdjwt:name}}"  SD-JWT (issuer-signed JWT ~ disclosures ~) of example.jwts[name]
//   "{{jwk:key}}"     public JWK of test key `key` (replaces the whole string with an object)
//   "{{x5c:key}}"     x5c array for test key `key`: leaf certificate plus intermediates, trust anchor excluded
//   "{{s256:text}}"   base64url(SHA-256(text)) — PKCE code_challenge, DPoP ath
//   "{{x509hash:key}}" x509_hash client identifier of the key's leaf certificate (OpenID4VP)
//   "{{b64url:text}}"  base64url of a text (inline only)
//   { $jwk: key, …}    public JWK of a test key, merged with the other members (kid, use, alg)
//   "{{jwe:name}}"    compact JWE (ECDH-ES) of example.jwts[name]; the plaintext is stored for display
//   "{{mdoc:name}}"   base64url ISO/IEC 18013-5 DeviceResponse of example.mdocs[name] (see mdoc.ts); the CBOR items
//                     (DeviceResponse, SessionTranscript, handover info) are stored for display
// Signatures (ES256) are randomised, so encoded examples are committed and only rebuilt when the inputs change.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CompactEncrypt, CompactSign, exportJWK, importPKCS8, importSPKI, type JWK } from 'jose'
import type { EncodedExample } from '../../src/model/dataset.ts'
import type { Example } from '../../src/model/schema.ts'
import { DATA } from './data.ts'
import { buildMdoc } from './mdoc.ts'

export const KEYS = join(DATA, 'test-keys')

export function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

export function s256(text: string): string {
  return b64url(createHash('sha256').update(text).digest())
}

/** Hash of what gets encoded and signed; titles, notes and annotations can change without re-signing. */
export function inputHash(e: Example): string {
  return createHash('sha256').update(JSON.stringify({ http: e.http, json: e.json, jwts: e.jwts, mdocs: e.mdocs })).digest('hex').slice(0, 16)
}

/** Certificate chain files: <key>.cert.pem, issued by the key named in <key>.issuer (absent = trust anchor). */
export function x5cOf(key: string): string[] {
  const chain: string[] = []
  let cur: string | null = key
  while (cur) {
    const certPath = join(KEYS, `${cur}.cert.pem`)
    if (!existsSync(certPath)) throw new Error(`no certificate for test key ${cur}`)
    const issuerPath = join(KEYS, `${cur}.issuer`)
    const issuer = existsSync(issuerPath) ? readFileSync(issuerPath, 'utf8').trim() : null
    if (!issuer) break // trust anchor: excluded from x5c
    const pem = readFileSync(certPath, 'utf8')
    chain.push(pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, ''))
    cur = issuer
  }
  return chain
}

const jwkCache = new Map<string, JWK>()
export async function publicJwk(key: string): Promise<JWK> {
  if (!jwkCache.has(key)) {
    const spki = readFileSync(join(KEYS, `${key}.pub.pem`), 'utf8')
    const pub = await importSPKI(spki, 'ES256', { extractable: true })
    const { kty, crv, x, y } = await exportJWK(pub)
    jwkCache.set(key, { kty, crv, x, y })
  }
  return jwkCache.get(key)!
}

async function privateKey(key: string) {
  return importPKCS8(readFileSync(join(KEYS, `${key}.key.pem`), 'utf8'), 'ES256')
}

const PLACEHOLDER = /^\{\{(jwt|sdjwt|jwe|mdoc|jwk|x5c|x509hash|s256):(.+)\}\}$/

export type EncodedKind = 'jwt' | 'sdjwt' | 'jwe' | 'mdoc'

export async function substitute(value: unknown, encodedJwt: (kind: EncodedKind, name: string) => Promise<string>): Promise<unknown> {
  if (typeof value === 'string') {
    const m = PLACEHOLDER.exec(value)
    if (!m) {
      // Text-valued placeholders may also sit inside a longer string (a URL carrying an x509_hash client_id).
      return value.replace(/\{\{(x509hash|s256|b64url):([^}]+)\}\}/g, (_all, k: string, arg: string) =>
        k === 's256'
          ? s256(arg)
          : k === 'b64url'
            ? b64url(arg)
            : `x509_hash:${b64url(createHash('sha256').update(Buffer.from(x5cOf(arg)[0]!, 'base64')).digest())}`,
      )
    }
    const [, kind, arg] = m as unknown as [string, string, string]
    if (kind === 'jwt' || kind === 'sdjwt' || kind === 'jwe' || kind === 'mdoc') return encodedJwt(kind, arg)
    if (kind === 'jwk') {
      // "{{jwk:key#kid}}" adds a kid, e.g. for a JWK Set in client_metadata.
      const [key, kid] = arg.split('#') as [string, string | undefined]
      return kid ? { ...(await publicJwk(key)), kid } : publicJwk(key)
    }
    if (kind === 'x5c') return x5cOf(arg)
    // OpenID4VP §5.9.3 x509_hash client identifier: base64url SHA-256 of the DER leaf certificate.
    if (kind === 'x509hash') return `x509_hash:${b64url(createHash('sha256').update(Buffer.from(x5cOf(arg)[0]!, 'base64')).digest())}`
    if (kind === 's256') return s256(arg)
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => substitute(v, encodedJwt)))
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).$jwk === 'string') {
    // { $jwk: key, kid, use, alg }: the public JWK of a test key with extra members.
    const { $jwk, ...extra } = value as Record<string, unknown>
    return { ...(await publicJwk($jwk as string)), ...((await substitute(extra, encodedJwt)) as object) }
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = await substitute(v, encodedJwt)
    return out
  }
  return value
}

function disclosure(salt: string, name: string, value: unknown): string {
  return b64url(JSON.stringify([salt, name, value]))
}

/** Encode one example. Nested JWTs are encoded on first use; cycles throw. */
export async function encodeExample(
  e: Example,
  reuse: (ref: string) => string = (ref) => {
    throw new Error(`${e.id}: cannot resolve reused jwt ${ref}`)
  },
): Promise<EncodedExample & { inputHash: string }> {
  const done = new Map<string, string>()
  const inProgress = new Set<string>()
  const plaintexts: NonNullable<EncodedExample['plaintexts']> = {}
  const cbor: NonNullable<EncodedExample['cbor']> = {}

  async function encodedMdoc(name: string): Promise<string> {
    if (cbor[name]) return cbor[name].value
    const raw = e.mdocs?.[name]
    if (!raw) throw new Error(`${e.id}: unknown mdoc "${name}"`)
    const spec = (await substitute(raw, encodedJwt)) as typeof raw
    const built = await buildMdoc(spec)
    cbor[name] = { label: 'DeviceResponse', value: b64url(Buffer.from(built.deviceResponse)) }
    cbor[`${name}-session-transcript`] = { label: 'SessionTranscript (rebuilt by the Verifier)', value: b64url(Buffer.from(built.sessionTranscript)) }
    cbor[`${name}-handover-info`] = { label: `${spec.transcript.handover}Info (hashed into the handover)`, value: b64url(Buffer.from(built.handoverInfo)) }
    return cbor[name].value
  }

  async function encodedJwt(kind: EncodedKind, name: string): Promise<string> {
    if (kind === 'mdoc') return encodedMdoc(name)
    const cacheKey = `${kind}:${name}`
    if (done.has(cacheKey)) return done.get(cacheKey)!
    const spec = e.jwts[name]
    if (!spec) throw new Error(`${e.id}: unknown jwt "${name}"`)
    if ('use' in spec) {
      const compact = reuse(spec.use)
      done.set(cacheKey, compact)
      return compact
    }
    if (inProgress.has(name)) throw new Error(`${e.id}: jwt "${name}" references itself`)
    inProgress.add(name)
    if ('encrypt' in spec) {
      const payload = (await substitute(spec.payload, encodedJwt)) as Record<string, unknown>
      const extra = (await substitute(spec.header, encodedJwt)) as Record<string, unknown>
      const protectedHeader = { ...extra, alg: spec.encrypt.alg, enc: spec.encrypt.enc }
      const pub = await importSPKI(readFileSync(join(KEYS, `${spec.encrypt.key}.pub.pem`), 'utf8'), 'ECDH-ES')
      const jwe = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader(protectedHeader as never).encrypt(pub)
      // Show the full protected header (incl. the generated epk) next to the plaintext the build encrypted.
      const fullHeader = JSON.parse(Buffer.from(jwe.split('.')[0]!, 'base64url').toString('utf8')) as Record<string, unknown>
      plaintexts[name] = { header: fullHeader, payload }
      inProgress.delete(name)
      done.set(`jwe:${name}`, jwe)
      return jwe
    }
    if (kind === 'jwe') throw new Error(`${e.id}: "${name}" is not an encrypted entry`)
    const header = (await substitute(spec.header, encodedJwt)) as Record<string, unknown>
    const payload = (await substitute(spec.payload, encodedJwt)) as Record<string, unknown>
    let disclosures: string[] = []
    if (kind === 'sdjwt') {
      disclosures = (spec.disclosures ?? []).map((d) => disclosure(d.salt, d.name, d.value))
      payload._sd = disclosures.map((d) => s256(d)).sort()
      payload._sd_alg = 'sha-256'
    }
    const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
      .setProtectedHeader(header as never)
      .sign(await privateKey(spec.key))
    let out = kind === 'sdjwt' ? `${jws}~${disclosures.map((d) => `${d}~`).join('')}` : jws
    if (kind === 'sdjwt' && spec.kb) {
      // Key Binding JWT over the presented SD-JWT (RFC 9901 §4.3): sd_hash = base64url(SHA-256(<sd-jwt>~...~)).
      const kbPayload = { ...((await substitute(spec.kb.payload, encodedJwt)) as Record<string, unknown>), sd_hash: s256(out) }
      const kb = await new CompactSign(new TextEncoder().encode(JSON.stringify(kbPayload)))
        .setProtectedHeader({ typ: 'kb+jwt', alg: 'ES256' })
        .sign(await privateKey(spec.kb.key))
      out = `${out}${kb}`
      done.set(`kb:${name}`, kb)
    }
    inProgress.delete(name)
    done.set(cacheKey, out)
    return out
  }

  const http = e.http ? ((await substitute(e.http, encodedJwt)) as EncodedExample['http']) : undefined
  const json = e.json !== undefined ? await substitute(e.json, encodedJwt) : undefined
  // Encode every declared JWT, also those only shown as objects (e.g. the WIA on its own).
  for (const [name, spec] of Object.entries(e.jwts))
    if (![`jwt:${name}`, `sdjwt:${name}`, `jwe:${name}`].some((k) => done.has(k)))
      await encodedJwt('encrypt' in spec ? 'jwe' : 'disclosures' in spec && spec.disclosures ? 'sdjwt' : 'jwt', name)
  for (const name of Object.keys(e.mdocs ?? {})) await encodedMdoc(name)
  const jwts: Record<string, string> = {}
  const sdjwts: Record<string, string> = {}
  for (const [k, v] of done) {
    const [kind, name] = k.split(':') as ['jwt' | 'sdjwt' | 'jwe' | 'kb', string]
    if (kind === 'sdjwt') sdjwts[name] = v
    // The view decodes the issuer-signed part; disclosures stay visible in the raw value. A KB-JWT is its own entry.
    if (kind === 'kb') jwts[`${name}-kb`] = v
    else jwts[name] = kind === 'sdjwt' ? v.split('~')[0]! : v
  }
  return {
    id: e.id,
    ...(http ? { http } : {}),
    ...(json !== undefined ? { json } : {}),
    jwts,
    ...(Object.keys(plaintexts).length ? { plaintexts } : {}),
    ...(Object.keys(sdjwts).length ? { sdjwts } : {}),
    ...(Object.keys(cbor).length ? { cbor } : {}),
    inputHash: inputHash(e),
  }
}

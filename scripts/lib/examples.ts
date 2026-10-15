// Example encoding. Authors write decoded inputs with placeholders; this module substitutes them and signs:
//   "{{jwt:name}}"    compact JWS of example.jwts[name]
//   "{{sdjwt:name}}"  SD-JWT (issuer-signed JWT ~ disclosures ~) of example.jwts[name]
//   "{{jwk:key}}"     public JWK of test key `key` (replaces the whole string with an object)
//   "{{x5c:key}}"     x5c array for test key `key`: leaf certificate plus intermediates, trust anchor excluded
//   "{{s256:text}}"   base64url(SHA-256(text)) — PKCE code_challenge, DPoP ath
// Signatures (ES256) are randomised, so encoded examples are committed and only rebuilt when the inputs change.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CompactSign, exportJWK, importPKCS8, importSPKI, type JWK } from 'jose'
import type { EncodedExample } from '../../src/model/dataset.ts'
import type { Example } from '../../src/model/schema.ts'
import { DATA } from './data.ts'

export const KEYS = join(DATA, 'test-keys')

export function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

export function s256(text: string): string {
  return b64url(createHash('sha256').update(text).digest())
}

/** Hash of what gets encoded and signed; titles, notes and annotations can change without re-signing. */
export function inputHash(e: Example): string {
  return createHash('sha256').update(JSON.stringify({ http: e.http, json: e.json, jwts: e.jwts })).digest('hex').slice(0, 16)
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

const PLACEHOLDER = /^\{\{(jwt|sdjwt|jwk|x5c|s256):(.+)\}\}$/

export async function substitute(value: unknown, encodedJwt: (kind: 'jwt' | 'sdjwt', name: string) => Promise<string>): Promise<unknown> {
  if (typeof value === 'string') {
    const m = PLACEHOLDER.exec(value)
    if (!m) {
      // Inline use inside a longer string, e.g. "DPoP {{access}}" is not supported on purpose: keep values whole.
      return value
    }
    const [, kind, arg] = m as unknown as [string, string, string]
    if (kind === 'jwt' || kind === 'sdjwt') return encodedJwt(kind, arg)
    if (kind === 'jwk') return publicJwk(arg)
    if (kind === 'x5c') return x5cOf(arg)
    if (kind === 's256') return s256(arg)
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => substitute(v, encodedJwt)))
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

  async function encodedJwt(kind: 'jwt' | 'sdjwt', name: string): Promise<string> {
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
    const out = kind === 'sdjwt' ? `${jws}~${disclosures.map((d) => `${d}~`).join('')}` : jws
    inProgress.delete(name)
    done.set(cacheKey, out)
    return out
  }

  const http = e.http ? ((await substitute(e.http, encodedJwt)) as EncodedExample['http']) : undefined
  const json = e.json !== undefined ? await substitute(e.json, encodedJwt) : undefined
  // Encode every declared JWT, also those only shown as objects (e.g. the WIA on its own).
  for (const [name, spec] of Object.entries(e.jwts))
    if (!done.has(`jwt:${name}`) && !done.has(`sdjwt:${name}`)) await encodedJwt('disclosures' in spec && spec.disclosures ? 'sdjwt' : 'jwt', name)
  const jwts: Record<string, string> = {}
  for (const [k, v] of done) {
    const [kind, name] = k.split(':') as ['jwt' | 'sdjwt', string]
    // The view decodes the issuer-signed part; disclosures stay visible in the raw value.
    jwts[name] = kind === 'sdjwt' ? v.split('~')[0]! : v
  }
  return { id: e.id, ...(http ? { http } : {}), ...(json !== undefined ? { json } : {}), jwts, inputHash: inputHash(e) }
}

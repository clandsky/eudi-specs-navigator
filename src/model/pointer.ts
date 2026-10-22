import type { EncodedExample } from './dataset'
import { cborView } from './mdoc'

/** The uniform document every annotation pointer addresses. Derived only from the encoded example. */
export interface ViewDocument {
  http?: {
    method?: string
    url?: string
    status?: number
    query?: Record<string, unknown>
    headers?: Record<string, string>
    body?: unknown
  }
  json?: unknown
  jwt: Record<string, { header: Record<string, unknown>; payload: Record<string, unknown>; compact: string }>
  /** Decoded CBOR items (mdoc), see src/model/mdoc.ts. */
  cbor?: Record<string, unknown>
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function decodeJwt(compact: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p] = compact.split('.')
  if (!h || !p) throw new Error('not a compact JWS')
  return { header: JSON.parse(b64urlDecode(h)), payload: JSON.parse(b64urlDecode(p)) }
}

/** The Disclosures of an SD-JWT (issuer JWT~d1~d2~…~[KB-JWT]), each decoded to [salt, claim name, value]. */
export function decodeDisclosures(sdjwt: string): unknown[][] {
  return sdjwt.split('~').slice(1, -1).map((d) => JSON.parse(b64urlDecode(d)) as unknown[])
}

function parseQuery(url: string): Record<string, unknown> | undefined {
  const i = url.indexOf('?')
  if (i < 0) return undefined
  const params = new URLSearchParams(url.slice(i + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of params) {
    try {
      out[k] = v.startsWith('{') ? JSON.parse(v) : v
    } catch {
      out[k] = v
    }
  }
  return out
}

/** Build the view document. Form bodies with JSON-valued parameters (authorization_details) are parsed. */
export function viewOf(e: EncodedExample): ViewDocument {
  const jwt: ViewDocument['jwt'] = {}
  for (const [name, compact] of Object.entries(e.jwts)) {
    const plain = e.plaintexts?.[name]
    jwt[name] = plain ? { header: plain.header, payload: plain.payload, compact } : { ...decodeJwt(compact), compact }
  }
  const view: ViewDocument = { jwt }
  if (e.http) {
    let body: unknown = e.http.body?.value
    if (e.http.body?.type === 'form' && body && typeof body === 'object') {
      body = Object.fromEntries(
        Object.entries(body as Record<string, unknown>).map(([k, v]) => {
          if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
            try {
              return [k, JSON.parse(v)]
            } catch {
              return [k, v]
            }
          }
          return [k, v]
        }),
      )
    }
    view.http = {
      method: e.http.method,
      url: e.http.url,
      status: e.http.status,
      query: e.http.url ? parseQuery(e.http.url) : undefined,
      headers: e.http.headers,
      body,
    }
  }
  if (e.json !== undefined) view.json = e.json
  if (e.cbor) view.cbor = Object.fromEntries(Object.entries(e.cbor).map(([name, c]) => [name, cborView(c.value)]))
  return view
}

export function unescapeToken(t: string): string {
  return t.replace(/~1/g, '/').replace(/~0/g, '~')
}

export function escapeToken(t: string): string {
  return t.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function splitPointer(ptr: string): string[] {
  if (ptr === '') return []
  if (!ptr.startsWith('/')) throw new Error(`JSON pointer must start with "/": ${ptr}`)
  return ptr.slice(1).split('/').map(unescapeToken)
}

const MISSING = Symbol('missing')

/** RFC 6901 lookup. Returns MISSING when the pointer does not resolve. */
export function lookup(doc: unknown, ptr: string): unknown {
  let cur: unknown = doc
  for (const tok of splitPointer(ptr)) {
    if (Array.isArray(cur)) {
      const i = Number(tok)
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return MISSING
      cur = cur[i]
    } else if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, tok)) {
      cur = (cur as Record<string, unknown>)[tok]
    } else return MISSING
  }
  return cur
}

export function resolves(doc: unknown, ptr: string): boolean {
  return lookup(doc, ptr) !== MISSING
}

// Field mapping -----------------------------------------------------------------------------------------------------
// Annotations map a JSON pointer to a subject. Keys may be exact pointers or patterns: "*" matches one reference token,
// "**" matches any number (including none). The global field map (data/fieldmap.yaml) holds patterns shared by all
// examples, e.g. "/jwt/*/header/alg". Exact example annotations win over example patterns, which win over globals;
// among patterns the one with more literal tokens wins.

export interface FieldMapEntry {
  pattern: string
  subject: string
}

export function matchPattern(pattern: string, ptr: string): boolean {
  const p = splitPointer(pattern)
  const t = splitPointer(ptr)
  const go = (i: number, j: number): boolean => {
    if (i === p.length) return j === t.length
    if (p[i] === '**') return go(i + 1, j) || (j < t.length && go(i, j + 1))
    if (j === t.length) return false
    return (p[i] === '*' || p[i] === t[j]) && go(i + 1, j + 1)
  }
  return go(0, 0)
}

const specificity = (pattern: string) => {
  const toks = splitPointer(pattern)
  return toks.filter((x) => x !== '*' && x !== '**').length * 4 - toks.filter((x) => x === '**').length
}

const isPattern = (k: string) => splitPointer(k).some((x) => x === '*' || x === '**')

export function annotationFor(ptr: string, annotations: Record<string, string>, globals: readonly FieldMapEntry[] = []): string | null {
  const exact = annotations[ptr]
  if (exact) return exact
  let best: { subject: string; score: number } | null = null
  for (const [pattern, subject] of Object.entries(annotations)) {
    if (!isPattern(pattern) || !matchPattern(pattern, ptr)) continue
    const score = specificity(pattern) + 1000 // example patterns outrank global ones
    if (!best || score > best.score) best = { subject, score }
  }
  if (best) return best.subject
  for (const g of globals) {
    if (!matchPattern(g.pattern, ptr)) continue
    const score = specificity(g.pattern)
    if (!best || score > best.score) best = { subject: g.subject, score }
  }
  return best?.subject ?? null
}

/** Pointers of every object key in the view document: the entries a reader can click. */
export function entryPointers(view: ViewDocument): string[] {
  const out: string[] = []
  const walk = (v: unknown, ptr: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${ptr}/${i}`))
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const p = `${ptr}/${escapeToken(k)}`
        out.push(p)
        walk(x, p)
      }
  }
  if (view.http?.headers) walk(view.http.headers, '/http/headers')
  if (view.http?.query) walk(view.http.query, '/http/query')
  if (view.http?.body !== undefined) walk(view.http.body, '/http/body')
  if (view.json !== undefined) walk(view.json, '/json')
  for (const [name, j] of Object.entries(view.jwt)) {
    walk(j.header, `/jwt/${escapeToken(name)}/header`)
    walk(j.payload, `/jwt/${escapeToken(name)}/payload`)
  }
  for (const [name, c] of Object.entries(view.cbor ?? {})) walk(c, `/cbor/${escapeToken(name)}`)
  return out
}

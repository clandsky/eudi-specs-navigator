import type { EncodedExample } from './dataset'

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
  for (const [name, compact] of Object.entries(e.jwts)) jwt[name] = { ...decodeJwt(compact), compact }
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

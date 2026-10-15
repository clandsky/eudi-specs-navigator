// Minimal hash router. Every view state lives in the URL so a link pasted into a ticket shows exactly the same view:
//   #/flow/<flowId>?step=<stepId>&field=<json-pointer>&subject=<subjectId>&role=issuer&asOf=YYYY-MM-DD&lens=cir&de=1
import { useEffect, useSyncExternalStore } from 'react'

export interface Route {
  path: string[]
  params: URLSearchParams
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [p = '/', q = ''] = raw.split('?')
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(q) }
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '')
  return parse(hash)
}

/** Context parameters survive navigation between views; view-local ones (step, field, subject) do not. */
const STICKY = ['role', 'asOf', 'lens', 'de']

export function href(path: string[] | string, params: Record<string, string | null | undefined> = {}, keep = true): string {
  const current = parse(window.location.hash).params
  const next = new URLSearchParams()
  if (keep) for (const k of STICKY) if (current.has(k)) next.set(k, current.get(k)!)
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') next.delete(k)
    else next.set(k, v)
  }
  const segs = (Array.isArray(path) ? path : path.split('/').filter(Boolean)).map(encodeURIComponent)
  const q = next.toString()
  return `#/${segs.join('/')}${q ? `?${q}` : ''}`
}

/** Update parameters of the current route without changing the path. */
export function setParams(params: Record<string, string | null | undefined>) {
  const r = parse(window.location.hash)
  const next = new URLSearchParams(r.params)
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') next.delete(k)
    else next.set(k, v)
  }
  const q = next.toString()
  const target = `#/${r.path.map(encodeURIComponent).join('/')}${q ? `?${q}` : ''}`
  if (target !== window.location.hash) window.location.hash = target
}

export function navigate(to: string) {
  window.location.hash = to.replace(/^#/, '')
}

export function useScrollTopOnPath(path: string[]) {
  const key = path.join('/')
  useEffect(() => {
    document.querySelector('.main')?.scrollTo({ top: 0 })
  }, [key])
}

// Minimal hash router. Every view state lives in the URL so a link pasted into a ticket shows exactly the same view:
//   #/flow/<flowId>?step=<stepId>&field=<json-pointer>&subject=<subjectId>&role=issuer&asOf=YYYY-MM-DD&lens=cir
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
const STICKY = ['role', 'asOf', 'lens']

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

const SCROLL_KEY = 'specs-navigator.scroll'

/**
 * Keeps the reading position when the page reloads at the same address: a save from a dev editor rewrites data/ and
 * Vite reloads the page, and the browser cannot restore the scroll of `.main` itself. Runs after the views' own
 * mount scrolling (scroll-to-top, scroll to a linked topic), so the restored position wins.
 */
export function useKeepScrollOnReload() {
  useEffect(() => {
    const main = document.querySelector('.main')
    if (!main) return
    const at = () => window.location.hash.split('?')[0]
    const save = () => {
      try {
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ at: at(), top: main.scrollTop }))
      } catch {
        /* storage blocked: the page starts at the top */
      }
    }
    let frame = 0
    try {
      const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? 'null') as { at: string; top: number } | null
      // Removed only once restored: StrictMode runs this effect twice and the first run's frame is cancelled.
      frame = requestAnimationFrame(() => {
        if (saved && saved.at === at()) main.scrollTo({ top: saved.top })
        try {
          sessionStorage.removeItem(SCROLL_KEY)
        } catch {
          /* ignore */
        }
      })
    } catch {
      /* nothing to restore */
    }
    window.addEventListener('pagehide', save)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pagehide', save)
    }
  }, [])
}

export function useScrollTopOnPath(path: string[]) {
  const key = path.join('/')
  useEffect(() => {
    document.querySelector('.main')?.scrollTo({ top: 0 })
  }, [key])
}

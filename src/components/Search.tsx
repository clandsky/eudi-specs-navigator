import MiniSearch from 'minisearch'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { href, navigate } from '../lib/router'
import { ds, locatorText, specById, subjectById } from '../lib/store'

interface Doc {
  id: string
  kind: 'subject' | 'assertion' | 'spec' | 'flow' | 'topic'
  title: string
  text: string
  link: string
  meta: string
}

let index: MiniSearch<Doc> | null = null
function getIndex(): MiniSearch<Doc> {
  if (index) return index
  const docs: Doc[] = [
    ...ds.subjects.map((s) => ({
      id: `s:${s.id}`,
      kind: 'subject' as const,
      title: s.title,
      text: `${s.id.replace(/[._-]/g, ' ')} ${s.id}`,
      link: `subject/${s.id}`,
      meta: `${s.kind}, ${s.id}`,
    })),
    ...ds.assertions.map((a) => ({
      id: `a:${a.id}`,
      kind: 'assertion' as const,
      title: `${specById.get(a.spec)?.short ?? a.spec} ${locatorText(a)}`,
      text: `${a.locator.req ?? ''} ${a.locator.section ?? ''} ${a.locator.at ?? ''} ${a.quote ?? ''} ${a.id}`,
      link: `assertion/${a.id}`,
      meta: subjectById.get(a.subject)?.title ?? a.subject,
    })),
    ...ds.specs.map((s) => ({ id: `p:${s.id}`, kind: 'spec' as const, title: s.title, text: `${s.short} ${s.version}`, link: `spec/${s.id}`, meta: s.version })),
    ...ds.flows.map((f) => ({ id: `f:${f.id}`, kind: 'flow' as const, title: f.title, text: f.summary, link: `flow/${f.id}`, meta: 'flow' })),
    ...ds.educate.flatMap((t) =>
      t.topics.flatMap((x) =>
        [x, ...x.subtopics].map((y) => ({
          id: `t:${y.id}`,
          kind: 'topic' as const,
          title: y.title,
          text: y.summary ?? '',
          link: `educate?topic=${y.id}`,
          meta: y === x ? `${t.code}, ${t.title}` : `${t.code}, ${x.title}`,
        })),
      ),
    ),
  ]
  index = new MiniSearch<Doc>({
    fields: ['title', 'text'],
    storeFields: ['kind', 'title', 'link', 'meta'],
    tokenize: (s) => s.split(/[\s,;:()"“”'’/]+/).filter(Boolean),
    searchOptions: { prefix: true, fuzzy: 0.15, boost: { title: 2 }, combineWith: 'AND' },
  })
  index.addAll(docs)
  return index
}

/** Links are built at render time so they keep the current role, date and lens. */
const linkOf = (path: string) => {
  const topic = /^educate\?topic=(.+)$/.exec(path)?.[1]
  if (topic) return href(['educate'], { topic })
  const i = path.indexOf('/')
  return href([path.slice(0, i), path.slice(i + 1)])
}

const KIND_LABEL: Record<Doc['kind'], string> = { subject: 'Field or message', assertion: 'Requirement', spec: 'Spec', flow: 'Flow', topic: 'Educate' }

/** A lens button that opens the search field in its place; the field folds back when it loses focus. "/" opens it too. */
export function Search() {
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const results = useMemo(() => (q.trim().length < 2 ? [] : getIndex().search(q).slice(0, 14)), [q])

  useEffect(() => {
    const onSlash = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      e.preventDefault()
      setExpanded(true)
      setOpen(true)
    }
    window.addEventListener('keydown', onSlash)
    return () => window.removeEventListener('keydown', onSlash)
  }, [])

  const collapse = (refocus: boolean) => {
    setOpen(false)
    setExpanded(false)
    // The button only exists again after the next render.
    if (refocus) requestAnimationFrame(() => buttonRef.current?.focus())
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && results[sel]) {
      navigate(linkOf(results[sel]!.link as string))
      collapse(false)
    } else if (e.key === 'Escape') {
      collapse(true)
    }
  }

  if (!expanded)
    return (
      <button
        ref={buttonRef}
        className="icon-btn search-btn"
        onClick={() => {
          setExpanded(true)
          setOpen(true)
        }}
        title="Search (/)"
        aria-label="Search fields, parameters, requirement IDs and section titles"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
      </button>
    )

  return (
    <div className="search">
      <input
        ref={ref}
        autoFocus
        className="field-input"
        type="search"
        placeholder="Search fields, parameters, requirement IDs"
        aria-label="Search fields, parameters, requirement IDs and section titles"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setSel(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => collapse(false)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="search-results"
      />
      {open && q.trim().length >= 2 && (
        <div className="search-results" id="search-results" role="listbox">
          {results.length === 0 && <div className="empty" style={{ padding: 12 }}>Nothing matches “{q}”.</div>}
          {results.map((r, i) => (
            <a key={r.id} href={linkOf(r.link as string)} role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => collapse(false)}>
              <strong>{r.title as string}</strong>
              <span className="meta">
                {KIND_LABEL[r.kind as Doc['kind']]}: {r.meta as string}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

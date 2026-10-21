import MiniSearch from 'minisearch'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
      t.topics.map((x) => ({
        id: `t:${x.id}`,
        kind: 'topic' as const,
        title: x.title,
        text: `${x.terms.join(' ')} ${x.summary ?? ''}`,
        link: `educate?topic=${x.id}`,
        meta: `${t.code}, ${t.title}`,
      })),
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

export function Search() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const results = useMemo(() => (q.trim().length < 2 ? [] : getIndex().search(q).slice(0, 14)), [q])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && results[sel]) {
      navigate(linkOf(results[sel]!.link as string))
      setOpen(false)
      ref.current?.blur()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="search">
      <input
        ref={ref}
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
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="search-results"
      />
      {open && q.trim().length >= 2 && (
        <div className="search-results" id="search-results" role="listbox">
          {results.length === 0 && <div className="empty" style={{ padding: 12 }}>Nothing matches “{q}”.</div>}
          {results.map((r, i) => (
            <a key={r.id} href={linkOf(r.link as string)} role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)}>
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

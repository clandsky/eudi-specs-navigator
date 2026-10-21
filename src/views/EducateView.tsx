import { useEffect, useState, type DragEvent, type FormEvent } from 'react'
import { SpecName } from '../components/bits'
import { slugify, type EducateSubtopic, type EducateTopic, type EducateTrack } from '../model/schema'
import { href, setParams, useRoute } from '../lib/router'
import { ds, flowById, subjectById, useViewCtx, type View } from '../lib/store'

// The learning roadmap: clusters of topics, a shared part before the fork and one path per side. Every topic has
// subtopics, drawn as chips under it, and both open the same panel. The open entry lives in the URL (?topic=), so a
// link to it opens its panel; what a viewer marked as understood stays in this browser. On the dev server topics and
// subtopics can be added, edited, moved and deleted; the edits go back into data/educate.

const DONE_KEY = 'specs-navigator.educate-done'

function useDone(): [Set<string>, (id: string) => void] {
  const [done, setDone] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const toggle = (id: string) =>
    setDone((d) => {
      const next = new Set(d)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify([...next]))
      } catch {
        /* private mode: progress just isn't remembered */
      }
      return next
    })
  return [done, toggle]
}

type Track = (typeof ds.educate)[number]
type Entry = EducateTopic | EducateSubtopic
/** Where an entry sits: its cluster and, for a subtopic, its topic. */
interface Place {
  entry: Entry
  track: Track
  parent?: EducateTopic
}

const tracks = [...ds.educate].sort((a, b) => a.order - b.order)
const tracksIn = (group: EducateTrack['group']) => tracks.filter((t) => t.group === group)
const trackById = new Map(tracks.map((t) => [t.id, t]))
const entryIndex = new Map<string, Place>(
  tracks.flatMap((track) =>
    track.topics.flatMap((topic) => [
      [topic.id, { entry: topic, track }] as const,
      ...topic.subtopics.map((s) => [s.id, { entry: s, track, parent: topic }] as const),
    ]),
  ),
)
const hasContent = (e: Entry) => Boolean(e.summary) || e.links.length + e.questions.length + e.flows.length + e.subjects.length + e.specs.length > 0

const topicHref = (id: string) => href(['educate'], { topic: id })
const clusterAnchor = (id: string) => `cluster-${id}`
function scrollToCluster(id: string) {
  document.getElementById(clusterAnchor(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function EducateView() {
  const { params } = useRoute()
  const vc = useViewCtx()
  const [done, toggleDone] = useDone()
  const open = entryIndex.get(params.get('topic') ?? '')
  const [adding, setAdding] = useState<Track | null>(null)
  const pick = (v: View) => setParams({ role: v === 'verifier' ? null : v })
  const side = tracksIn(vc.view)
  const all = [...tracksIn('context'), ...tracksIn('general'), ...side].flatMap((t) => t.topics)
  const learned = all.filter((x) => done.has(x.id)).length
  // A link straight to an entry shows it on the roadmap too, not just the panel. One frame later, so the shell's
  // scroll-to-top on navigation has already run.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => document.querySelector(`[data-topic="${open.entry.id}"]`)?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(id)
  }, [])

  const cluster = (t: Track) => <Cluster key={t.id} track={t} done={done} openId={open?.entry.id} onAdd={() => setAdding(t)} />
  return (
    <div className="page educate">
      <h1>Educate</h1>
      <p className="lede">
        The concepts a role needs, cluster by cluster: first the legal and organisational context and the shared ground,
        then the path of your side. Open a topic or one of its subtopics for an explanation, questions, reading and the
        places in this navigator where its rules are traced. The explanations are a first draft and only give
        orientation; the cited specifications decide.
      </p>
      <p className="meta">
        {learned} of {all.length} topics on the {vc.view} path marked as understood in this browser.
      </p>

      <h2 className="section">Context</h2>
      <div className="clusters clusters-3">{tracksIn('context').map(cluster)}</div>

      <h2 className="section">General</h2>
      <div className="clusters clusters-2">{tracksIn('general').map(cluster)}</div>

      <div className="fork">
        <h2 className="section">Your path</h2>
        <div className="segmented" role="group" aria-label="Path">
          {(['verifier', 'issuer'] as const).map((v) => (
            <button key={v} aria-pressed={vc.view === v} onClick={() => pick(v)}>
              {v === 'issuer' ? 'Issuer' : 'Verifier'}
            </button>
          ))}
        </div>
      </div>
      <div className="clusters clusters-2">{side.map(cluster)}</div>

      {adding ? (
        <aside className="topic-panel" aria-label={`New topic in ${adding.code}`}>
          <div className="topic-head">
            <span className="meta">{adding.code} · new topic</span>
          </div>
          <EntryEditor track={adding} onClose={() => setAdding(null)} />
        </aside>
      ) : (
        open && <EntryPanel key={open.entry.id} place={open} done={done} onToggleDone={() => toggleDone(open.entry.id)} />
      )}
    </div>
  )
}

// Drag and drop (dev server only): topics within their cluster, subtopics within their topic. ---------------------------

/** What is being dragged, and from which list; another list does not accept it. */
let dragging: { list: string; id: string } | null = null

/**
 * Reordering of one list by drag and drop. The new order shows at once and is written through the move op; the page
 * reloads with the saved file. `horizontal` lists (subtopic chips) drop left or right of an item, the others above or
 * below.
 */
function useReorder<T extends { id: string }>(list: string, items: T[], move: { track: string; parent?: string }, horizontal = false) {
  const [order, setOrder] = useState<string[] | null>(null)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const byId = new Map(items.map((x) => [x.id, x]))
  const shown = order ? order.flatMap((id) => byId.get(id) ?? []) : items
  if (!import.meta.env.DEV) return { shown, error, itemProps: () => ({}) }

  const itemProps = (id: string) => ({
    draggable: true,
    'data-drop': drop?.id === id ? (drop.after ? 'after' : 'before') : undefined,
    'data-dragging': dragging?.list === list && dragging.id === id ? 'true' : undefined,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation()
      dragging = { list, id }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', id)
    },
    onDragOver: (e: DragEvent) => {
      if (dragging?.list !== list) return
      e.preventDefault()
      e.stopPropagation()
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
      if (drop?.id !== id || drop.after !== after) setDrop({ id, after })
    },
    onDragLeave: () => setDrop((d) => (d?.id === id ? null : d)),
    onDragEnd: () => {
      dragging = null
      setDrop(null)
    },
    onDrop: (e: DragEvent) => {
      if (dragging?.list !== list) return
      e.preventDefault()
      e.stopPropagation()
      const from = shown.findIndex((x) => x.id === dragging!.id)
      let to = shown.findIndex((x) => x.id === id) + (drop?.after ? 1 : 0)
      if (from < to) to--
      const movedId = dragging.id
      dragging = null
      setDrop(null)
      if (from < 0 || to === from) return
      const next = shown.map((x) => x.id)
      next.splice(to, 0, ...next.splice(from, 1))
      setOrder(next)
      void educateOp({ op: 'move', track: move.track, parent: move.parent, id: movedId, to }).then((err) => {
        if (!err) return
        setOrder(null)
        setError(err)
      })
    },
  })
  return { shown, error, itemProps }
}

function Cluster({ track, done, openId, onAdd }: { track: Track; done: Set<string>; openId?: string; onAdd: () => void }) {
  const n = track.topics.filter((x) => done.has(x.id)).length
  const { shown, error, itemProps } = useReorder(`topics:${track.id}`, track.topics, { track: track.id })
  return (
    <section className="cluster" id={clusterAnchor(track.id)} aria-labelledby={`${clusterAnchor(track.id)}-h`}>
      <header>
        <span className="cluster-code">{track.code}</span>
        <h3 id={`${clusterAnchor(track.id)}-h`}>{track.title}</h3>
        <span className="meta cluster-count" title="Marked as understood">
          {n}/{track.topics.length}
        </span>
      </header>
      {track.summary && <p className="cluster-summary">{track.summary}</p>}
      <ol className="path">
        {shown.map((x) => (
          <li key={x.id} data-topic={x.id} data-done={done.has(x.id)} {...itemProps(x.id)}>
            <a className="node" href={topicHref(x.id)} draggable={false} aria-current={openId === x.id ? 'true' : undefined}>
              <span className="node-title">{x.title}</span>
              {!hasContent(x) && <span className="node-stub">to come</span>}
              {x.questions.length > 0 && (
                <span className="node-q" title={`${x.questions.length} question${x.questions.length > 1 ? 's' : ''}`}>
                  {x.questions.length} Q
                </span>
              )}
            </a>
            {x.subtopics.length > 0 && <Subtopics topic={x} track={track} done={done} openId={openId} />}
          </li>
        ))}
      </ol>
      {error && <p className="error">{error}</p>}
      {import.meta.env.DEV && (
        <button className="btn add-topic" onClick={onAdd}>
          + Add topic
        </button>
      )}
      {track.next.length > 0 && (
        <footer>
          Continues in{' '}
          {track.next.map((id, i) => (
            <span key={id}>
              {i > 0 && ' and '}
              <button className="linklike cluster-link" onClick={() => scrollToCluster(id)}>
                {trackById.get(id)?.code ?? id}
              </button>
            </span>
          ))}
        </footer>
      )}
    </section>
  )
}

/** The subtopic chips of a topic; with `track` (on the roadmap) they can be reordered by dragging. */
function Subtopics({ topic, track, done, openId }: { topic: EducateTopic; track?: Track; done: Set<string>; openId?: string }) {
  const { shown, error, itemProps } = useReorder(`subtopics:${topic.id}`, topic.subtopics, { track: track?.id ?? '', parent: topic.id }, true)
  return (
    <div className="terms">
      {(track ? shown : topic.subtopics).map((s) => (
        <a
          key={s.id}
          className="term"
          href={topicHref(s.id)}
          data-topic={s.id}
          data-done={done.has(s.id)}
          data-empty={!hasContent(s)}
          aria-current={openId === s.id ? 'true' : undefined}
          {...(track ? itemProps(s.id) : { draggable: false })}
        >
          {s.title}
        </a>
      ))}
      {error && <span className="error">{error}</span>}
    </div>
  )
}

function EntryPanel({ place, done, onToggleDone }: { place: Place; done: Set<string>; onToggleDone: () => void }) {
  const { entry, track, parent } = place
  const close = () => setParams({ topic: null })
  const [editing, setEditing] = useState(false)
  const siblings: Entry[] = parent ? parent.subtopics : track.topics
  const i = siblings.indexOf(entry)
  const prev = siblings[i - 1]
  const next = siblings[i + 1]
  const subtopics = parent ? [] : (entry as EducateTopic).subtopics
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest?.('.topic-edit') && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const inTool = entry.flows.length + entry.subjects.length + entry.specs.length > 0
  return (
    <aside className="topic-panel" aria-labelledby="topic-title">
      <div className="topic-head">
        <span className="meta">
          {track.code} · {parent ? <a href={topicHref(parent.id)}>{parent.title}</a> : track.title}
        </span>
        <span className="topic-head-actions">
          {import.meta.env.DEV && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <button className="icon-btn" onClick={close} aria-label="Close the topic" title="Close (Esc)">
            ×
          </button>
        </span>
      </div>
      {editing ? (
        <EntryEditor track={track} parent={parent} entry={entry} onClose={() => setEditing(false)} />
      ) : (
        <>
          <div className="topic-body">
            <h2 id="topic-title">{entry.title}</h2>
            {entry.summary ? <p className="topic-summary">{entry.summary}</p> : <p className="empty" style={{ padding: 0 }}>No explanation written yet.</p>}

            {subtopics.length > 0 && (
              <>
                <h3>Subtopics</h3>
                <Subtopics topic={entry as EducateTopic} done={done} />
              </>
            )}

            {entry.questions.length > 0 && (
              <>
                <h3>Questions</h3>
                <dl className="qa">
                  {entry.questions.map((q) => (
                    <div key={q.q}>
                      <dt>{q.q}</dt>
                      <dd>{q.a ?? <span className="meta">Open.</span>}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            {inTool && (
              <>
                <h3>In this navigator</h3>
                <ul className="topic-links">
                  {entry.flows.map((id) => (
                    <li key={id}>
                      <a href={href(['flow', id])}>{flowById.get(id)?.title ?? id}</a>
                    </li>
                  ))}
                  {entry.subjects.map((id) => (
                    <li key={id}>
                      <a href={href(['subject', id])}>{subjectById.get(id)?.title ?? id}</a>
                    </li>
                  ))}
                  {entry.specs.map((id) => (
                    <li key={id}>
                      <a href={href(['spec', id])}>
                        <SpecName specId={id} />
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {entry.links.length > 0 && (
              <>
                <h3>Reading</h3>
                <ul className="topic-links">
                  {entry.links.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.title}
                      </a>
                      <span className="meta"> {new URL(l.url).hostname}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {entry.related.length > 0 && (
              <>
                <h3>Related</h3>
                <ul className="topic-links">
                  {entry.related.map((id) => {
                    const r = entryIndex.get(id)
                    return (
                      <li key={id}>
                        <a href={topicHref(id)}>{r?.entry.title ?? id}</a>
                        <span className="meta"> {r?.track.code}</span>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
          <div className="topic-foot">
            <label className="done-toggle">
              <input type="checkbox" checked={done.has(entry.id)} onChange={onToggleDone} /> Understood
            </label>
            <span className="spacer" />
            <button className="btn" disabled={!prev} onClick={() => prev && setParams({ topic: prev.id })}>
              Previous
            </button>
            <button className="btn" disabled={!next} onClick={() => next && setParams({ topic: next.id })}>
              Next
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

// Editing (dev server only) -----------------------------------------------------------------------------------------

/** Sends one edit to the dev server; the dataset plugin reloads the page once the YAML file changes. */
async function educateOp(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch('/__educate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (res.ok) return null
  const j = (await res.json().catch(() => ({ error: [res.statusText] }))) as { error?: string | string[] }
  return [j.error ?? res.statusText].flat().join('; ')
}

/** A new topic's id: the cluster's id prefix (rparch-, isdox-, …) and the title, made unique. */
function newTopicId(track: Track, title: string): string {
  const prefix = track.topics[0]?.id.split('-')[0] ?? track.id
  const base = `${prefix}-${slugify(title) || 'topic'}`
  let id = base
  for (let n = 2; entryIndex.has(id); n++) id = `${base}-${n}`
  return id
}

/** Edits a topic or (with parent) a subtopic; without entry it creates a new topic in the cluster. */
function EntryEditor({ track, parent, entry, onClose }: { track: Track; parent?: EducateTopic; entry?: Entry; onClose: () => void }) {
  const isTopic = !parent
  const [title, setTitle] = useState(entry?.title ?? '')
  const [summary, setSummary] = useState(entry?.summary ?? '')
  const [links, setLinks] = useState<{ title: string; url: string }[]>(entry?.links ?? [])
  // Existing subtopics are kept by id (with all their content); new ones are just a title.
  const [subs, setSubs] = useState<({ id: string; title: string } | { title: string })[]>(
    isTopic && entry ? (entry as EducateTopic).subtopics.map((s) => ({ id: s.id, title: s.title })) : [],
  )
  const [sub, setSub] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const siblings: Entry[] = parent ? parent.subtopics : track.topics
  const index = entry ? siblings.indexOf(entry) : -1
  const what = isTopic ? 'topic' : 'subtopic'

  async function run(body: Record<string, unknown>, after?: () => void) {
    setState('busy')
    setError(null)
    const err = await educateOp({ track: track.id, parent: parent?.id, ...body })
    if (err) {
      setError(err)
      setState('idle')
      return
    }
    after?.()
    setState('done')
  }

  const known = (t: string) => subs.some((s) => s.title.toLowerCase() === t.toLowerCase())
  function addSub() {
    const t = sub.trim()
    if (t && !known(t)) setSubs([...subs, { title: t }])
    setSub('')
  }

  function save(e: FormEvent) {
    e.preventDefault()
    const keptLinks = links.map((l) => ({ title: l.title.trim(), url: l.url.trim() })).filter((l) => l.title || l.url)
    const bad = keptLinks.find((l) => !l.title || !URL.canParse(l.url))
    if (!title.trim()) return setError(`A ${what} needs a title.`)
    if (bad) return setError(`Each link needs a title and a full URL (${bad.title || bad.url}).`)
    const pending = sub.trim() && !known(sub.trim()) ? [...subs, { title: sub.trim() }] : subs
    const id = entry?.id ?? newTopicId(track, title)
    const payload = {
      title: title.trim(),
      summary,
      links: keptLinks,
      ...(isTopic ? { subtopics: pending.map((s) => ('id' in s ? { id: s.id } : { title: s.title })) } : {}),
    }
    // A new topic opens after the reload.
    void run({ op: 'save', id, entry: payload }, () => !entry && setParams({ topic: id }))
  }

  const busy = state !== 'idle'
  return (
    <form className="topic-edit" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
      <div className="topic-body">
        <label>
          Title
          <input className="field-input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Explanation
          <textarea className="field-input" rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A few sentences in plain words." />
        </label>

        {isTopic && (
          <div className="edit-group">
            <span className="edit-label">Subtopics</span>
            <div className="terms">
              {subs.map((s) => (
                <span key={'id' in s ? s.id : `new:${s.title}`} className="term term-edit">
                  {s.title}
                  <button type="button" aria-label={`Remove subtopic ${s.title}`} onClick={() => setSubs(subs.filter((x) => x !== s))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="edit-row">
              <input
                className="field-input"
                value={sub}
                placeholder="New subtopic"
                aria-label="New subtopic"
                onChange={(e) => setSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addSub()
                  }
                }}
              />
              <button type="button" className="btn" onClick={addSub} disabled={!sub.trim()}>
                Add subtopic
              </button>
            </div>
            <span className="meta">Open a subtopic's chip to write its explanation and links. Removing one deletes its content.</span>
          </div>
        )}

        <div className="edit-group">
          <span className="edit-label">Links</span>
          {links.map((l, i) => (
            <div key={i} className="edit-link">
              <input
                className="field-input"
                value={l.title}
                placeholder="Title"
                aria-label={`Link ${i + 1} title`}
                onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              />
              <input
                className="field-input"
                value={l.url}
                placeholder="https://…"
                aria-label={`Link ${i + 1} URL`}
                onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
              />
              <button type="button" className="icon-btn" aria-label={`Remove link ${i + 1}`} onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setLinks([...links, { title: '', url: '' }])}>
            Add link
          </button>
        </div>

        {entry && (
          <div className="edit-group">
            <span className="edit-label">Position and removal</span>
            <div className="edit-row">
              <button type="button" className="btn" disabled={busy || index <= 0} onClick={() => run({ op: 'move', id: entry.id, dir: -1 })}>
                {isTopic ? 'Move up' : 'Move left'}
              </button>
              <button type="button" className="btn" disabled={busy || index >= siblings.length - 1} onClick={() => run({ op: 'move', id: entry.id, dir: 1 })}>
                {isTopic ? 'Move down' : 'Move right'}
              </button>
              <span className="spacer" />
              {confirmDelete ? (
                <>
                  <span className="meta">
                    Delete “{entry.title}”{isTopic && subs.length ? ' and its subtopics' : ''}?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => run({ op: 'delete', id: entry.id }, () => setParams({ topic: parent?.id ?? null }))}
                  >
                    Yes, delete
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-danger" disabled={busy || (isTopic && track.topics.length === 1)} onClick={() => setConfirmDelete(true)}>
                  Delete {what}
                </button>
              )}
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="topic-foot">
        <span className="meta">Written into {track.file}</span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {state === 'busy' ? 'Saving…' : state === 'done' ? 'Saved, reloading…' : entry ? 'Save' : 'Add topic'}
        </button>
      </div>
    </form>
  )
}

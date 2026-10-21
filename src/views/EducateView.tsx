import { useEffect, useState } from 'react'
import { SpecName } from '../components/bits'
import type { EducateTopic, EducateTrack } from '../model/schema'
import { href, setParams, useRoute } from '../lib/router'
import { ds, flowById, subjectById, useViewCtx, type View } from '../lib/store'

// The learning roadmap: clusters of topics, a shared part before the fork and one path per side. The open topic lives
// in the URL (?topic=), so a link to a topic opens its panel; what a viewer marked as understood stays in this browser.

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

const tracks = [...ds.educate].sort((a, b) => a.order - b.order)
const tracksIn = (group: EducateTrack['group']) => tracks.filter((t) => t.group === group)
const trackById = new Map(tracks.map((t) => [t.id, t]))
const topicIndex = new Map(tracks.flatMap((t) => t.topics.map((x) => [x.id, { topic: x, track: t }] as const)))

const topicHref = (id: string) => href(['educate'], { topic: id })
const clusterAnchor = (id: string) => `cluster-${id}`
function scrollToCluster(id: string) {
  document.getElementById(clusterAnchor(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function EducateView() {
  const { params } = useRoute()
  const vc = useViewCtx()
  const [done, toggleDone] = useDone()
  const open = topicIndex.get(params.get('topic') ?? '')
  const pick = (v: View) => setParams({ role: v === 'verifier' ? null : v })
  const side = tracksIn(vc.view)
  const all = [...tracksIn('context'), ...tracksIn('general'), ...side].flatMap((t) => t.topics)
  const learned = all.filter((x) => done.has(x.id)).length
  // A link straight to a topic shows its node on the roadmap too, not just the panel. One frame later, so the shell's
  // scroll-to-top on navigation has already run.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => document.querySelector(`[data-topic="${open.topic.id}"]`)?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(id)
  }, [])

  const cluster = (t: EducateTrack) => <Cluster key={t.id} track={t} done={done} openId={open?.topic.id} />
  return (
    <div className="page educate">
      <h1>Educate</h1>
      <p className="lede">
        The concepts a role needs, cluster by cluster: first the legal and organisational context and the shared ground,
        then the path of your side. Open a topic for an explanation, questions, reading and the places in this navigator
        where its rules are traced. The explanations are a first draft and only give orientation; the cited
        specifications decide.
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

      {open && <TopicPanel topic={open.topic} track={open.track} done={done.has(open.topic.id)} onToggleDone={() => toggleDone(open.topic.id)} />}
    </div>
  )
}

function Cluster({ track, done, openId }: { track: EducateTrack; done: Set<string>; openId?: string }) {
  const n = track.topics.filter((x) => done.has(x.id)).length
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
        {track.topics.map((x) => (
          <li key={x.id} data-topic={x.id} data-done={done.has(x.id)}>
            <a className="node" href={topicHref(x.id)} aria-current={openId === x.id ? 'true' : undefined}>
              <span className="node-title">{x.title}</span>
              {!x.summary && x.links.length === 0 && <span className="node-stub">to come</span>}
              {x.questions.length > 0 && (
                <span className="node-q" title={`${x.questions.length} question${x.questions.length > 1 ? 's' : ''}`}>
                  {x.questions.length} Q
                </span>
              )}
            </a>
            {x.terms.length > 0 && (
              <div className="terms">
                {x.terms.map((t) => (
                  <span key={t} className="term">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
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

function TopicPanel({ topic, track, done, onToggleDone }: { topic: EducateTopic; track: EducateTrack; done: boolean; onToggleDone: () => void }) {
  const close = () => setParams({ topic: null })
  const i = track.topics.indexOf(topic)
  const prev = track.topics[i - 1]
  const next = track.topics[i + 1]
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const inTool = topic.flows.length + topic.subjects.length + topic.specs.length > 0
  return (
    <aside className="topic-panel" aria-labelledby="topic-title">
      <div className="topic-head">
        <span className="meta">
          {track.code} · {track.title}
        </span>
        <button className="icon-btn" onClick={close} aria-label="Close the topic" title="Close (Esc)">
          ×
        </button>
      </div>
      <div className="topic-body">
        <h2 id="topic-title">{topic.title}</h2>
        {topic.summary ? <p className="topic-summary">{topic.summary}</p> : <p className="empty" style={{ padding: 0 }}>No explanation written yet.</p>}
        {topic.terms.length > 0 && (
          <div className="terms">
            {topic.terms.map((t) => (
              <span key={t} className="term">
                {t}
              </span>
            ))}
          </div>
        )}

        {topic.questions.length > 0 && (
          <>
            <h3>Questions</h3>
            <dl className="qa">
              {topic.questions.map((q) => (
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
              {topic.flows.map((id) => (
                <li key={id}>
                  <a href={href(['flow', id])}>{flowById.get(id)?.title ?? id}</a>
                </li>
              ))}
              {topic.subjects.map((id) => (
                <li key={id}>
                  <a href={href(['subject', id])}>{subjectById.get(id)?.title ?? id}</a>
                </li>
              ))}
              {topic.specs.map((id) => (
                <li key={id}>
                  <a href={href(['spec', id])}>
                    <SpecName specId={id} />
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}

        {topic.links.length > 0 && (
          <>
            <h3>Reading</h3>
            <ul className="topic-links">
              {topic.links.map((l) => (
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

        {topic.related.length > 0 && (
          <>
            <h3>Related</h3>
            <ul className="topic-links">
              {topic.related.map((id) => {
                const r = topicIndex.get(id)
                return (
                  <li key={id}>
                    <a href={topicHref(id)}>{r?.topic.title ?? id}</a>
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
          <input type="checkbox" checked={done} onChange={onToggleDone} /> Understood
        </label>
        <span className="spacer" />
        <button className="btn" disabled={!prev} onClick={() => prev && setParams({ topic: prev.id })}>
          Previous
        </button>
        <button className="btn" disabled={!next} onClick={() => next && setParams({ topic: next.id })}>
          Next
        </button>
      </div>
    </aside>
  )
}

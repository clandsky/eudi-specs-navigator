// Dev-only write-back from the in-app editors, so edits are versioned with the rest of the data:
//   /__overrules  POST one go-live compromise → data/assertions/golive/<id>.yaml
//   /__examples   GET ?id= the editable inputs (http, json, jwts) of an example as YAML;
//                 POST {id, source, assumption?} replaces them in the example's YAML file and re-signs it (and its
//                 dependents); with assumption {note, decided_by} the changed fields are recorded under `assumptions`
//   /__assumptions/add  POST one assumption → appended to data/assertions/assumptions/assumptions.yaml
//   /__authored/update  POST {id, entry} replaces an authored entry (assumption, resolved reading, go-live compromise)
//                 in the file it lives in; id, subject and spec stay as they are
//   /__authored/delete  POST {id} removes an open assumption or a go-live compromise from its file; a go-live file
//                 left without entries is deleted
//   /__assumptions/resolve  POST {id, layer} moves an assumption into data/assertions/resolved/<layer>.yaml as a
//                 resolved interpretation of that layer (spec resolved-<layer>)
//   /__subjects/description  POST {id, description} sets (or, when empty, removes) a subject's description in its
//                 data/subjects file
//   /__educate    POST {op, track, id, parent?} edits a topic (or, with parent, a subtopic) of the learning roadmap in
//                 its data/educate file: save {entry} creates it at the end or updates title, summary, links and, for a
//                 topic, the list of subtopics; delete removes it and every related link to it; move {dir: -1 | 1}
//                 swaps it with its neighbour, move {to} puts it at that position. Each edit is rolled back if the dataset no longer validates
// The static build has no server: the overrule editor keeps local drafts there, the example editor and the
// description are read-only.
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { isMap, isScalar, isSeq, parse, parseDocument, Scalar, stringify, visit, type Document, type YAMLMap, type YAMLSeq } from 'yaml'
import { buildExamples, ensureTestPki } from './scripts/lib/build-examples.ts'
import { DATA, DataError, ROOT, loadDataset } from './scripts/lib/data.ts'
import { removeEntry, replaceEntry } from './scripts/lib/yaml-edit.ts'
import { diffInputs } from './src/model/inputs-diff.ts'
import { Assertion, Example, subtopicId } from './src/model/schema.ts'

const DIR = join(DATA, 'assertions', 'golive')

export function editorPlugin(): Plugin {
  return {
    name: 'specs-navigator:editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__examples', (req, res) => handleExamples(req, res))
      server.middlewares.use('/__assumptions/resolve', (req, res) => handleResolve(req, res))
      server.middlewares.use('/__assumptions/add', (req, res) => handleAddAssumption(req, res))
      server.middlewares.use('/__authored/delete', (req, res) => handleDeleteAuthored(req, res))
      server.middlewares.use('/__authored/update', (req, res) => handleUpdateAuthored(req, res))
      server.middlewares.use('/__subjects/description', (req, res) => handleDescription(req, res))
      server.middlewares.use('/__educate', (req, res) => handleEducate(req, res))
      server.middlewares.use('/__overrules', (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method === 'GET') return send(200, { writable: true })
        if (req.method !== 'POST') return send(405, { error: 'POST only' })
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          try {
            const parsed = Assertion.safeParse(JSON.parse(raw))
            if (!parsed.success) return send(400, { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
            const a = parsed.data
            if (a.spec !== 'golive-compromises') return send(400, { error: 'only go-live compromises can be written here' })
            if (!a.window || !a.target) return send(400, { error: 'go-live compromises need a target and a window' })
            const ds = loadDataset()
            if (!ds.assertions.some((x) => x.id === a.target)) return send(400, { error: `unknown target ${a.target}` })
            if (!ds.subjects.some((s) => s.id === a.subject)) return send(400, { error: `unknown subject ${a.subject}` })
            const file = join(DIR, `${a.id.replace(/[^a-z0-9._-]+/gi, '_')}.yaml`)
            if (existsSync(file) && !readFileSync(file, 'utf8').includes(`id: ${a.id}`)) return send(409, { error: 'file name collision' })
            mkdirSync(DIR, { recursive: true })
            // Strip defaults so the file stays short and readable.
            const { xref, applies_to, ...rest } = a
            const out = { ...rest, ...(Object.keys(applies_to).length ? { applies_to } : {}), ...(xref.length ? { xref } : {}) }
            writeFileSync(file, `# Go-live compromise, written by the specs-navigator editor.\n${stringify([out], { lineWidth: 120 })}`)
            send(201, { file: file.slice(DATA.length - 4) })
          } catch (e) {
            send(400, { error: (e as Error).message })
          }
        })
      })
    },
  }
}

const EDITABLE = ['http', 'json', 'jwts'] as const

type Req = import('node:http').IncomingMessage
type Res = import('node:http').ServerResponse

function sendJson(res: Res, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req: Req): Promise<string> {
  return new Promise((ok, fail) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => ok(raw))
    req.on('error', fail)
  })
}

async function handleExamples(req: Req, res: Res) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const ds = loadDataset()
    if (req.method === 'GET') {
      const ex = ds.examples.find((e) => e.id === url.searchParams.get('id'))
      if (!ex) return sendJson(res, 404, { error: 'unknown example' })
      const doc = parse(readFileSync(join(ROOT, ex.file), 'utf8')) as Record<string, unknown>
      const editable = Object.fromEntries(EDITABLE.filter((k) => doc[k] !== undefined).map((k) => [k, doc[k]]))
      return sendJson(res, 200, { id: ex.id, file: ex.file, source: stringify(editable, { lineWidth: 120 }) })
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'GET or POST only' })
    const { id, source, assumption } = JSON.parse(await readBody(req)) as {
      id: string
      source: string
      assumption?: { note?: string; decided_by?: string }
    }
    const ex = ds.examples.find((e) => e.id === id)
    if (!ex) return sendJson(res, 404, { error: 'unknown example' })
    let edited: Record<string, unknown>
    try {
      edited = (parse(source) ?? {}) as Record<string, unknown>
    } catch (e) {
      return sendJson(res, 400, { error: [`YAML: ${(e as Error).message.split('\n')[0]}`] })
    }
    const unknownKeys = Object.keys(edited).filter((k) => !(EDITABLE as readonly string[]).includes(k))
    if (unknownKeys.length) return sendJson(res, 400, { error: [`only ${EDITABLE.join(', ')} can be edited here; found ${unknownKeys.join(', ')}`] })

    const path = join(ROOT, ex.file)
    const before = readFileSync(path, 'utf8')
    const doc = parseDocument(before)
    if (!isMap(doc.contents)) return sendJson(res, 500, { error: ['example file is not a mapping'] })
    const old = doc.toJS() as Record<string, unknown>
    if (assumption) {
      const note = assumption.note?.trim()
      if (!note) return sendJson(res, 400, { error: ['say why the change is an assumption'] })
      const pick = (o: Record<string, unknown>) => Object.fromEntries(EDITABLE.map((k) => [k, o[k]]))
      const { changed, removed } = diffInputs(pick(old), pick(edited))
      if (!changed.length && !removed.length) return sendJson(res, 400, { error: ['nothing changed, so there is no assumption to record'] })
      const entry = {
        date: new Date().toISOString().slice(0, 10),
        ...(assumption.decided_by?.trim() ? { decided_by: assumption.decided_by.trim() } : {}),
        note,
        ...(changed.length ? { changed } : {}),
        ...(removed.length ? { removed } : {}),
      }
      const list = Array.isArray(old.assumptions) ? old.assumptions : []
      doc.set('assumptions', doc.createNode([...list, entry]))
    }
    for (const k of EDITABLE) {
      if (edited[k] === undefined) doc.delete(k)
      else doc.set(k, doc.createNode(edited[k]))
    }
    const candidate = Example.safeParse(doc.toJS())
    if (!candidate.success) return sendJson(res, 400, { error: candidate.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    writeFileSync(path, doc.toString({ lineWidth: 120 }))
    try {
      ensureTestPki(() => {})
      const signed = await buildExamples({ log: () => {} })
      sendJson(res, 200, { file: ex.file, signed })
    } catch (e) {
      writeFileSync(path, before) // keep the repository consistent when encoding fails
      sendJson(res, 400, { error: [(e as Error).message] })
    }
  } catch (e) {
    sendJson(res, 500, { error: [(e as Error).message] })
  }
}

const ASSUMPTIONS = join(DATA, 'assertions', 'assumptions', 'assumptions.yaml')

async function handleAddAssumption(req: Req, res: Res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: ['POST only'] })
    const parsed = Assertion.safeParse(JSON.parse(await readBody(req)))
    if (!parsed.success) return sendJson(res, 400, { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    const a = parsed.data
    if (a.spec !== 'assumptions') return sendJson(res, 400, { error: ['only assumptions can be written here'] })
    if (!a.target || !a.interpretation) return sendJson(res, 400, { error: ['an assumption needs the target it reads'] })
    const ds = loadDataset()
    if (!ds.assertions.some((x) => x.id === a.target)) return sendJson(res, 400, { error: [`unknown target ${a.target}`] })
    if (!ds.subjects.some((s) => s.id === a.subject)) return sendJson(res, 400, { error: [`unknown subject ${a.subject}`] })
    if (ds.assertions.some((x) => x.id === a.id)) return sendJson(res, 409, { error: [`${a.id} already exists`] })
    // Strip defaults so the file stays short and readable.
    const { xref, applies_to, verified, ...rest } = a
    const out = { ...rest, ...(Object.keys(applies_to).length ? { applies_to } : {}), ...(xref.length ? { xref } : {}) }
    const existing = existsSync(ASSUMPTIONS) ? readFileSync(ASSUMPTIONS, 'utf8') : '# Working assumptions of the project owner.\n'
    writeFileSync(ASSUMPTIONS, `${existing.trimEnd()}\n${stringify([out], { lineWidth: 120 })}`)
    sendJson(res, 201, { file: ASSUMPTIONS.slice(ROOT.length + 1) })
  } catch (e) {
    sendJson(res, 500, { error: [(e as Error).message] })
  }
}

async function handleUpdateAuthored(req: Req, res: Res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: ['POST only'] })
    const { id, entry } = JSON.parse(await readBody(req)) as { id: string; entry: unknown }
    const ds = loadDataset()
    const old = ds.assertions.find((x) => x.id === id)
    if (!old || !ds.specs.find((s) => s.id === old.spec)?.authored) return sendJson(res, 404, { error: ['not an authored entry'] })
    const parsed = Assertion.safeParse(entry)
    if (!parsed.success) return sendJson(res, 400, { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    const a = parsed.data
    if (a.id !== old.id || a.subject !== old.subject || a.spec !== old.spec) return sendJson(res, 400, { error: ['id, subject and spec cannot change'] })
    if (!a.target || !ds.assertions.some((x) => x.id === a.target)) return sendJson(res, 400, { error: [`unknown target ${a.target}`] })
    if (a.spec === 'golive-compromises' && !a.window) return sendJson(res, 400, { error: ['go-live compromises need a window'] })

    const path = join(ROOT, old.file)
    const doc = parseDocument(readFileSync(path, 'utf8'))
    // Strip defaults so the file stays short and readable.
    const { xref, applies_to, verified, ...rest } = a
    const out = {
      ...rest,
      ...(Object.keys(applies_to).length ? { applies_to } : {}),
      ...(xref.length ? { xref } : {}),
      ...(verified !== 'unverified' ? { verified } : {}),
    }
    if (!replaceEntry(doc, id, out)) return sendJson(res, 500, { error: ['entry not found in its file'] })
    writeFileSync(path, doc.toString({ lineWidth: 120 }))
    sendJson(res, 200, { file: old.file })
  } catch (e) {
    sendJson(res, 500, { error: [(e as Error).message] })
  }
}

const RESOLVABLE = ['golive', 'cir', 'etsi', 'haip', 'base'] as const

/** Authored entries the Delete button may remove; resolved readings are kept as the record of a decision. */
const DELETABLE = ['assumptions', 'golive-compromises']

async function handleDeleteAuthored(req: Req, res: Res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: ['POST only'] })
    const { id } = JSON.parse(await readBody(req)) as { id: string }
    const ds = loadDataset()
    const a = ds.assertions.find((x) => x.id === id)
    if (!a || !DELETABLE.includes(a.spec)) return sendJson(res, 404, { error: ['not an open assumption or go-live compromise'] })
    const users = ds.assertions.filter((x) => x.target === id).map((x) => x.id)
    if (users.length) return sendJson(res, 409, { error: [`still the target of ${users.join(', ')}`] })
    const path = join(ROOT, a.file)
    const doc = parseDocument(readFileSync(path, 'utf8'))
    if (!removeEntry(doc, id)) return sendJson(res, 500, { error: ['entry not found in its file'] })
    // The editor writes one file per go-live compromise; an empty one would only keep its header comment.
    if (a.spec === 'golive-compromises' && isSeq(doc.contents) && doc.contents.items.length === 0) unlinkSync(path)
    else writeFileSync(path, doc.toString({ lineWidth: 120 }))
    sendJson(res, 200, { id, file: a.file })
  } catch (e) {
    sendJson(res, 500, { error: [(e as Error).message] })
  }
}

async function handleResolve(req: Req, res: Res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: ['POST only'] })
    const { id, layer } = JSON.parse(await readBody(req)) as { id: string; layer: string }
    if (!(RESOLVABLE as readonly string[]).includes(layer)) return sendJson(res, 400, { error: [`cannot resolve into layer ${layer}`] })
    const ds = loadDataset()
    const a = ds.assertions.find((x) => x.id === id)
    if (!a || a.spec !== 'assumptions') return sendJson(res, 404, { error: ['not an assumption'] })

    // Remove the entry from its assumptions file.
    const srcPath = join(ROOT, a.file)
    const src = parseDocument(readFileSync(srcPath, 'utf8'))
    // Taken out of the parsed file only; the file is rewritten after the resolved copy is saved. Its header stays.
    const entry = removeEntry(src, id)
    if (!entry) return sendJson(res, 500, { error: ['assumption not found in its file'] })

    // Append it to the resolved file of the chosen layer.
    const resolved = {
      ...entry,
      id: id.replace(/^assumption\//, 'resolved/'),
      spec: `resolved-${layer}`,
      note: [entry.note, `Resolved from ${id} on ${new Date().toISOString().slice(0, 10)}.`].filter(Boolean).join(' '),
    }
    const check = Assertion.safeParse(resolved)
    if (!check.success) return sendJson(res, 400, { error: check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    if (ds.assertions.some((x) => x.id === resolved.id)) return sendJson(res, 409, { error: [`${resolved.id} already exists`] })

    const dir = join(DATA, 'assertions', 'resolved')
    mkdirSync(dir, { recursive: true })
    const dstPath = join(dir, `${layer}.yaml`)
    const header = `# Assumptions resolved into the ${layer} layer by the specs-navigator Resolve button.\n`
    const existing = existsSync(dstPath) ? readFileSync(dstPath, 'utf8') : header
    writeFileSync(dstPath, `${existing.trimEnd()}\n${stringify([resolved], { lineWidth: 120 })}`)
    writeFileSync(srcPath, src.toString({ lineWidth: 120 }))
    sendJson(res, 200, { id: resolved.id, file: dstPath.slice(ROOT.length + 1) })
  } catch (e) {
    sendJson(res, 500, { error: [(e as Error).message] })
  }
}

const SUBJECTS = join(DATA, 'subjects')

function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? yamlFiles(join(dir, e.name)) : e.name.endsWith('.yaml') ? [join(dir, e.name)] : [],
  )
}

async function handleDescription(req: Req, res: Res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: ['POST only'] })
    const { id, description } = JSON.parse(await readBody(req)) as { id: string; description: string }
    const text = String(description ?? '').replace(/\s+/g, ' ').trim()
    for (const path of yamlFiles(SUBJECTS)) {
      const doc = parseDocument(readFileSync(path, 'utf8'))
      if (!isSeq(doc.contents)) continue
      const item = doc.contents.items.find((it) => isMap(it) && String(it.get('id')) === id)
      if (!isMap(item)) continue
      const map = item as unknown as YAMLMap<string, unknown>
      if (text) {
        // Double quotes like the hand-written descriptions; the flow map stays on one line (lineWidth 0).
        const node = new Scalar(text)
        node.type = Scalar.QUOTE_DOUBLE
        map.set('description', node)
      } else map.delete('description')
      writeFileSync(path, doc.toString({ lineWidth: 0 }))
      return sendJson(res, 200, { file: path.slice(ROOT.length + 1) })
    }
    sendJson(res, 404, { error: [`unknown subject ${id}`] })
  } catch (e) {
    sendJson(res, 500, { error: [(e as Error).message] })
  }
}

const ENTRY_ORDER = ['id', 'title', 'summary', 'subtopics', 'flows', 'subjects', 'specs', 'links', 'related', 'questions']

type Seq = YAMLSeq<unknown>
type Located = { seq: Seq; index: number }

/** The list under `key`, or null when there is none. */
function seqOf(node: { get(key: string, keepScalar: true): unknown }, key: string): Seq | null {
  const v = node.get(key, true)
  return isSeq(v) ? (v as Seq) : null
}

/** Id of an item of a topics or subtopics list: its own id, or for a subtopic written as a plain title the derived one. */
function itemId(item: unknown, parent?: string): string {
  if (isMap(item)) return item.has('id') ? String(item.get('id')) : subtopicId(parent ?? '', String(item.get('title')))
  return subtopicId(parent ?? '', String((item as Scalar).value))
}

function locate(doc: Document, id: string, parent?: string): Located | null {
  const topics = seqOf(doc, 'topics')
  if (!topics) return null
  if (!parent) return { seq: topics, index: topics.items.findIndex((it) => itemId(it) === id) }
  const owner = topics.items.find((it) => itemId(it) === parent)
  if (!isMap(owner)) return null
  if (!seqOf(owner, 'subtopics')) owner.set('subtopics', doc.createNode([]))
  const seq = seqOf(owner, 'subtopics')!
  return { seq, index: seq.items.findIndex((it) => itemId(it, parent) === id) }
}

/** Sets the fields the editor owns on a topic or subtopic map; the others (flows, specs, questions …) stay. */
function applyEntry(doc: Document, map: YAMLMap, entry: { title: string; summary?: string; links?: { title: string; url: string }[] }) {
  map.set('title', entry.title)
  const summary = entry.summary?.replace(/\s+/g, ' ').trim()
  if (summary) {
    const node = new Scalar(summary)
    if (summary.length > 100) node.type = Scalar.BLOCK_FOLDED
    map.set('summary', node)
  } else map.delete('summary')
  if (entry.links?.length) map.set('links', doc.createNode(entry.links))
  else map.delete('links')
  map.items.sort((a, b) => ENTRY_ORDER.indexOf(String((a.key as Scalar).value ?? a.key)) - ENTRY_ORDER.indexOf(String((b.key as Scalar).value ?? b.key)))
}

/** Writes a data/educate file the way it is hand-written: short lists on one line as [a, b], long ones as a block. */
export function educateYaml(doc: Document): string {
  visit(doc, {
    Seq(_, seq) {
      if (!seq.flow) return
      const width = seq.items.reduce<number>((n, it) => n + String(isScalar(it) ? it.value : '').length + 2, 0)
      if (width > 90 || seq.items.some((it) => !isScalar(it))) seq.flow = false
    },
  })
  return doc.toString({ lineWidth: 120, flowCollectionPadding: false })
}

/** A subtopic with nothing but a title is written as that title, like the hand-written chips. */
function compactSubtopics(doc: Document, owner: YAMLMap, parent: string) {
  const seq = seqOf(owner, 'subtopics')
  if (!seq) return
  if (seq.items.length === 0) return void owner.delete('subtopics')
  seq.items = seq.items.map((it) => {
    if (!isMap(it)) return it
    const keys = it.items.map((p) => String((p.key as Scalar).value ?? p.key))
    const title = String(it.get('title'))
    const onlyTitle = keys.every((k) => k === 'title' || (k === 'id' && String(it.get('id')) === subtopicId(parent, title)))
    return onlyTitle ? doc.createNode(title) : it
  })
  seq.flow = seq.items.every((it) => !isMap(it))
}

async function handleEducate(req: Req, res: Res) {
  const written = new Map<string, string>() // path → content before, to roll back when the dataset no longer loads
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: ['POST only'] })
    const body = JSON.parse(await readBody(req)) as {
      op: 'save' | 'delete' | 'move'
      track: string
      id: string
      /** Set for a subtopic: the id of its topic. */
      parent?: string
      entry?: { title: string; summary?: string; links?: { title: string; url: string }[]; subtopics?: ({ id: string } | { title: string })[] }
      /** move: one step (-1 | 1), or straight to a position in the list (drag and drop). */
      dir?: number
      to?: number
    }
    const ds = loadDataset()
    const track = ds.educate.find((t) => t.id === body.track)
    if (!track) return sendJson(res, 404, { error: [`unknown cluster ${body.track}`] })
    const path = join(ROOT, track.file)
    const doc = parseDocument(readFileSync(path, 'utf8'))
    const at = locate(doc, body.id, body.parent)
    if (!at) return sendJson(res, 404, { error: [`unknown topic ${body.parent ?? body.id}`] })
    const allIds = new Set(ds.educate.flatMap((t) => t.topics.flatMap((x) => [x.id, ...x.subtopics.map((y) => y.id)])))
    const removed = new Set<string>()
    const write = (p: string, d: Document) => {
      if (!written.has(p)) written.set(p, readFileSync(p, 'utf8'))
      writeFileSync(p, educateYaml(d))
    }

    if (body.op === 'save') {
      const entry = body.entry
      if (!entry?.title?.trim()) return sendJson(res, 400, { error: ['a title is needed'] })
      const bad = entry.links?.find((l) => !l.title?.trim() || !URL.canParse(l.url))
      if (bad) return sendJson(res, 400, { error: [`a link needs a title and a full URL: ${bad.title || bad.url}`] })
      let map: YAMLMap
      if (at.index >= 0) {
        const item = at.seq.items[at.index]
        map = isMap(item) ? item : (doc.createNode({ title: String((item as Scalar).value) }) as YAMLMap)
        at.seq.items[at.index] = map
      } else {
        if (allIds.has(body.id)) return sendJson(res, 409, { error: [`${body.id} already exists`] })
        map = doc.createNode({}) as YAMLMap
        at.seq.items.push(map)
      }
      // A subtopic keeps the id it was linked by, also when its title changes.
      if (!map.has('id')) map.set('id', body.id)
      applyEntry(doc, map, { ...entry, title: entry.title.trim() })
      if (!body.parent && entry.subtopics) {
        const old = seqOf(map, 'subtopics')?.items ?? []
        const next = entry.subtopics.map((s) => ('id' in s ? old.find((it) => itemId(it, body.id) === s.id) : doc.createNode(s.title.trim())))
        if (next.some((x) => x === undefined)) return sendJson(res, 400, { error: ['unknown subtopic in the list'] })
        for (const it of old) if (!next.includes(it)) removed.add(itemId(it, body.id))
        map.set('subtopics', doc.createNode([]))
        ;seqOf(map, 'subtopics')!.items = next
        applyEntry(doc, map, { ...entry, title: entry.title.trim() }) // re-sort the keys
      }
      if (body.parent) {
        const owner = seqOf(doc, 'topics')!.items.find((it) => itemId(it) === body.parent) as YAMLMap
        compactSubtopics(doc, owner, body.parent)
      } else compactSubtopics(doc, map, body.id)
    } else if (body.op === 'delete') {
      if (at.index < 0) return sendJson(res, 404, { error: [`unknown topic ${body.id}`] })
      if (!body.parent && at.seq.items.length === 1) return sendJson(res, 400, { error: ['a cluster keeps at least one topic'] })
      const [gone] = at.seq.items.splice(at.index, 1)
      removed.add(body.id)
      if (!body.parent && isMap(gone)) for (const it of seqOf(gone, 'subtopics')?.items ?? []) removed.add(itemId(it, body.id))
      if (body.parent) compactSubtopics(doc, seqOf(doc, 'topics')!.items.find((it) => itemId(it) === body.parent) as YAMLMap, body.parent)
    } else if (body.op === 'move') {
      const to = body.to ?? at.index + (body.dir === -1 ? -1 : 1)
      if (at.index < 0 || !Number.isInteger(to) || to < 0 || to >= at.seq.items.length) return sendJson(res, 400, { error: ['cannot move there'] })
      const [item] = at.seq.items.splice(at.index, 1)
      at.seq.items.splice(to, 0, item)
    } else return sendJson(res, 400, { error: [`unknown op ${String(body.op)}`] })
    write(path, doc)

    // Other entries may point at what was removed.
    if (removed.size)
      for (const t of ds.educate) {
        if (!t.topics.some((x) => [x, ...x.subtopics].some((y) => y.related.some((r) => removed.has(r))))) continue
        const p = join(ROOT, t.file)
        const d = p === path ? doc : parseDocument(readFileSync(p, 'utf8'))
        const maps = seqOf(d, 'topics')!.items.flatMap((it) => (isMap(it) ? [it, ...(seqOf(it, 'subtopics')?.items.filter(isMap) ?? [])] : []))
        for (const m of maps) {
          const rel = seqOf(m, 'related')
          if (!rel) continue
          rel.items = rel.items.filter((r) => !removed.has(String((r as Scalar).value)))
          if (rel.items.length === 0) m.delete('related')
        }
        write(p, d)
      }

    try {
      loadDataset()
    } catch (e) {
      for (const [p, before] of written) writeFileSync(p, before)
      return sendJson(res, 400, { error: e instanceof DataError ? e.problems : [(e as Error).message] })
    }
    sendJson(res, 200, { id: body.id, file: track.file })
  } catch (e) {
    for (const [p, before] of written) writeFileSync(p, before)
    sendJson(res, 500, { error: [(e as Error).message] })
  }
}

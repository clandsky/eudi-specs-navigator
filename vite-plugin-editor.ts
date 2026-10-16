// Dev-only write-back from the in-app editors, so edits are versioned with the rest of the data:
//   /__overrules  POST one go-live compromise → data/assertions/golive/<id>.yaml
//   /__examples   GET ?id= the editable inputs (http, json, jwts) of an example as YAML;
//                 POST {id, source, assumption?} replaces them in the example's YAML file and re-signs it (and its
//                 dependents); with assumption {note, decided_by} the changed fields are recorded under `assumptions`
//   /__assumptions/add  POST one assumption → appended to data/assertions/assumptions/assumptions.yaml
//   /__authored/update  POST {id, entry} replaces an authored entry (assumption, resolved reading, go-live compromise)
//                 in the file it lives in; id, subject and spec stay as they are
//   /__assumptions/resolve  POST {id, layer} moves an assumption into data/assertions/resolved/<layer>.yaml as a
//                 resolved interpretation of that layer (spec resolved-<layer>)
// The static build has no server: the overrule editor keeps local drafts there and the example editor is read-only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { isMap, isSeq, parse, parseDocument, stringify } from 'yaml'
import { buildExamples, ensureTestPki } from './scripts/lib/build-examples.ts'
import { DATA, ROOT, loadDataset } from './scripts/lib/data.ts'
import { diffInputs } from './src/model/inputs-diff.ts'
import { Assertion, Example } from './src/model/schema.ts'

const DIR = join(DATA, 'assertions', 'golive')

export function editorPlugin(): Plugin {
  return {
    name: 'specs-navigator:editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__examples', (req, res) => handleExamples(req, res))
      server.middlewares.use('/__assumptions/resolve', (req, res) => handleResolve(req, res))
      server.middlewares.use('/__assumptions/add', (req, res) => handleAddAssumption(req, res))
      server.middlewares.use('/__authored/update', (req, res) => handleUpdateAuthored(req, res))
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
    const items = isSeq(doc.contents) ? doc.contents.items : []
    const index = items.findIndex((it) => isMap(it) && String(it.get('id' as never)) === id)
    if (index < 0) return sendJson(res, 500, { error: ['entry not found in its file'] })
    // Strip defaults so the file stays short and readable.
    const { xref, applies_to, verified, ...rest } = a
    const out = {
      ...rest,
      ...(Object.keys(applies_to).length ? { applies_to } : {}),
      ...(xref.length ? { xref } : {}),
      ...(verified !== 'unverified' ? { verified } : {}),
    }
    // Keep comments attached to the old entry (a file header sits on the first item).
    const node = doc.createNode(out)
    node.commentBefore = (items[index] as { commentBefore?: string | null }).commentBefore
    items[index] = node as never
    writeFileSync(path, doc.toString({ lineWidth: 120 }))
    sendJson(res, 200, { file: old.file })
  } catch (e) {
    sendJson(res, 500, { error: [(e as Error).message] })
  }
}

const RESOLVABLE = ['golive', 'cir', 'etsi', 'haip', 'base'] as const

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
    const items = isSeq(src.contents) ? src.contents.items : []
    const index = items.findIndex((it) => isMap(it) && String(it.get('id' as never)) === id)
    if (index < 0) return sendJson(res, 500, { error: ['assumption not found in its file'] })
    const entry = (items[index] as unknown as { toJSON(): Record<string, unknown> }).toJSON()

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
    items.splice(index, 1)
    writeFileSync(srcPath, src.toString({ lineWidth: 120 }))
    sendJson(res, 200, { id: resolved.id, file: dstPath.slice(ROOT.length + 1) })
  } catch (e) {
    sendJson(res, 500, { error: [(e as Error).message] })
  }
}

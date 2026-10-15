// Dev-only write-back from the in-app editors, so edits are versioned with the rest of the data:
//   /__overrules  POST one go-live compromise → data/assertions/golive/<id>.yaml
//   /__examples   GET ?id= the editable inputs (http, json, jwts) of an example as YAML;
//                 POST {id, source} replaces them in the example's YAML file and re-signs it (and its dependents)
// The static build has no server: the overrule editor keeps local drafts there and the example editor is read-only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { isMap, parse, parseDocument, stringify } from 'yaml'
import { buildExamples, ensureTestPki } from './scripts/lib/build-examples.ts'
import { DATA, ROOT, loadDataset } from './scripts/lib/data.ts'
import { Assertion, Example } from './src/model/schema.ts'

const DIR = join(DATA, 'assertions', 'golive')

export function editorPlugin(): Plugin {
  return {
    name: 'specs-navigator:editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__examples', (req, res) => handleExamples(req, res))
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
    const { id, source } = JSON.parse(await readBody(req)) as { id: string; source: string }
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

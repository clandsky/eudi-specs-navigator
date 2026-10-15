// Dev-only write-back for overrules (go-live compromises). The editor in the app POSTs one assertion; it is validated
// against the model and written to data/assertions/golive/<id>.yaml, so it is versioned with the rest of the data.
// The static build has no server: there the editor keeps a local draft and offers the YAML for download.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { stringify } from 'yaml'
import { DATA, loadDataset } from './scripts/lib/data.ts'
import { Assertion } from './src/model/schema.ts'

const DIR = join(DATA, 'assertions', 'golive')

export function overrulesPlugin(): Plugin {
  return {
    name: 'specs-navigator:overrules',
    apply: 'serve',
    configureServer(server) {
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

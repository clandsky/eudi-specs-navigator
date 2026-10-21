// Serves the validated dataset to the app as `virtual:dataset`. In dev, any change under data/ reloads it. The static
// build leaves out the assumption layer (the project owner's working notes, see withoutAssumptions).
import type { Plugin } from 'vite'
import { DATA, DataError, loadDataset, withoutAssumptions } from './scripts/lib/data.ts'

const ID = 'virtual:dataset'
const RESOLVED = `\0${ID}`

export function datasetPlugin(): Plugin {
  let build = false
  return {
    name: 'specs-navigator:dataset',
    configResolved(config) {
      build = config.command === 'build'
    },
    resolveId(id) {
      return id === ID ? RESOLVED : null
    },
    load(id) {
      if (id !== RESOLVED) return null
      try {
        const all = loadDataset({ requireEncoded: true })
        const ds = build ? withoutAssumptions(all) : all
        return `export default ${JSON.stringify(ds)}`
      } catch (e) {
        if (e instanceof DataError) this.error(e.message)
        throw e
      }
    },
    configureServer(server) {
      server.watcher.add(DATA)
      const reload = (file: string) => {
        if (!file.startsWith(DATA)) return
        const mod = server.moduleGraph.getModuleById(RESOLVED)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('change', reload)
      server.watcher.on('add', reload)
      server.watcher.on('unlink', reload)
    },
  }
}

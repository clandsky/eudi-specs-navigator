// Serves the validated dataset to the app as `virtual:dataset`. In dev, any change under data/ reloads it.
import type { Plugin } from 'vite'
import { DATA, DataError, loadDataset } from './scripts/lib/data.ts'

const ID = 'virtual:dataset'
const RESOLVED = `\0${ID}`

export function datasetPlugin(): Plugin {
  return {
    name: 'specs-navigator:dataset',
    resolveId(id) {
      return id === ID ? RESOLVED : null
    },
    load(id) {
      if (id !== RESOLVED) return null
      try {
        const ds = loadDataset({ requireEncoded: true })
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

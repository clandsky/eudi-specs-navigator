// Validates every data file against the Zod model and checks all cross-references.
import { DataError, loadDataset } from './lib/data.ts'

try {
  const ds = loadDataset({ requireEncoded: process.argv.includes('--encoded') })
  const n = (xs: unknown[]) => xs.length
  console.log(
    `ok: ${n(ds.specs)} specs, ${n(ds.subjects)} subjects, ${n(ds.flows)} flows, ${n(ds.assertions)} assertions, ` +
      `${n(ds.examples)} examples${ds.c2bo ? `, c2bo snapshot ${ds.c2bo.retrieved}` : ''}`,
  )
} catch (e) {
  if (e instanceof DataError) {
    console.error(e.message)
    process.exit(1)
  }
  throw e
}

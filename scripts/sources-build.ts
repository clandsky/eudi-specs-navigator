// Builds the plain-text copies under sources/ that quote-check searches. PDFs go through `pdftotext -layout`,
// corpus .txt files are copied, specs without a corpus copy are downloaded from `source.fetch`.
// sources/*.txt is git-ignored: ETSI texts must not be redistributed.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ROOT, loadDataset } from './lib/data.ts'

const force = process.argv.includes('--force')
const ds = loadDataset()
let built = 0
let skipped = 0
const failed: string[] = []

for (const spec of ds.specs) {
  const { local, text, fetch: url } = spec.source
  if (!text) continue
  const out = join(ROOT, text)
  if (existsSync(out) && !force) {
    skipped++
    continue
  }
  mkdirSync(dirname(out), { recursive: true })
  try {
    if (local?.endsWith('.pdf')) {
      execFileSync('pdftotext', ['-layout', join(ROOT, local), out])
    } else if (local) {
      copyFileSync(join(ROOT, local), out)
    } else if (url) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(out, await res.text())
    } else {
      throw new Error('no source.local or source.fetch')
    }
    built++
    console.log(`built  ${text}`)
  } catch (e) {
    failed.push(`${spec.id}: ${(e as Error).message}`)
  }
}

console.log(`\n${built} built, ${skipped} up to date${force ? '' : ' (use --force to rebuild)'}`)
if (failed.length) {
  console.error(`failed:\n  ${failed.join('\n  ')}`)
  process.exit(1)
}

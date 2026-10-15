// Generates the test PKI (once) and encodes every example whose inputs changed.
//   pnpm examples:build            encode changed examples
//   pnpm examples:build --force    re-sign everything
import { buildExamples, ensureTestPki } from './lib/build-examples.ts'

ensureTestPki()
await buildExamples({ force: process.argv.includes('--force') })

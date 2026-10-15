// Test PKI generation and example encoding, shared by `pnpm examples:build` and the dev-mode example editor.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import { ROOT, loadDataset } from './data.ts'
import { KEYS, encodeExample, inputHash } from './examples.ts'
import type { EncodedExample } from '../../src/model/dataset.ts'

interface KeyDef { id: string; cert?: { cn: string; issuer?: string; ca?: boolean } }

function openssl(args: string[], input?: string): string {
  return execFileSync('openssl', args, { input, encoding: 'utf8' })
}

/** Creates any missing test key or certificate listed in data/test-keys/keys.yaml. */
export function ensureTestPki(log: (s: string) => void = console.log) {
  const { keys } = parse(readFileSync(join(KEYS, 'keys.yaml'), 'utf8')) as { keys: KeyDef[] }
  const tmp = mkdtempSync(join(tmpdir(), 'specs-nav-keys-'))
  try {
  for (const k of keys) {
    const key = join(KEYS, `${k.id}.key.pem`)
    if (!existsSync(key)) {
      const ec = openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout'])
      writeFileSync(key, openssl(['pkcs8', '-topk8', '-nocrypt'], ec))
      writeFileSync(join(KEYS, `${k.id}.pub.pem`), openssl(['pkey', '-in', key, '-pubout']))
      log(`key    ${k.id}`)
    }
    const cert = join(KEYS, `${k.id}.cert.pem`)
    if (k.cert && !existsSync(cert)) {
      const subj = `/CN=${k.cert.cn}/O=TEST ONLY specs-navigator/C=EU`
      const ext = join(tmp, `${k.id}.ext`)
      writeFileSync(
        ext,
        k.cert.ca
          ? 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n'
          : 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n',
      )
      if (!k.cert.issuer) {
        openssl(['req', '-x509', '-new', '-key', key, '-subj', subj, '-days', '3650', '-sha256', '-extensions', 'v3', '-config', writeCfg(ext), '-out', cert])
      } else {
        const csr = join(tmp, `${k.id}.csr`)
        openssl(['req', '-new', '-key', key, '-subj', subj, '-out', csr])
        openssl(['x509', '-req', '-in', csr, '-CA', join(KEYS, `${k.cert.issuer}.cert.pem`), '-CAkey', join(KEYS, `${k.cert.issuer}.key.pem`), '-CAcreateserial', '-days', '3650', '-sha256', '-extfile', ext, '-out', cert])
        writeFileSync(join(KEYS, `${k.id}.issuer`), `${k.cert.issuer}\n`)
      }
      log(`cert   ${k.id}`)
    }
  }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function writeCfg(extFile: string): string {
  const cfg = `${extFile}.cnf`
  writeFileSync(cfg, `[req]\ndistinguished_name=dn\n[dn]\n[v3]\n${readFileSync(extFile, 'utf8')}`)
  return cfg
}

/** Encodes every example whose inputs (or a reused upstream JWT) changed. Returns the ids it re-signed. */
export async function buildExamples(opts: { force?: boolean; log?: (s: string) => void } = {}): Promise<string[]> {
  const force = opts.force ?? false
  const log = opts.log ?? console.log
  const ds = loadDataset()
  const byId = new Map(ds.examples.map((e) => [e.id, e]))
  const encoded = new Map<string, EncodedExample>()
  const changed = new Set<string>()
  let built = 0

  // Examples that reuse another example's JWT are encoded after it, and re-encoded when it changes.
  const deps = (id: string) =>
    Object.values(byId.get(id)?.jwts ?? {}).flatMap((j) => ('use' in j ? [j.use.split('/')[0]!] : []))
  const order: string[] = []
  const visit = (id: string, seen = new Set<string>()) => {
    if (order.includes(id)) return
    if (seen.has(id)) throw new Error(`cyclic jwt reuse at ${id}`)
    seen.add(id)
    for (const d of deps(id)) visit(d, seen)
    order.push(id)
  }
  for (const e of ds.examples) visit(e.id)

  for (const id of order) {
    const e = byId.get(id)
    if (!e) throw new Error(`unknown example ${id} (referenced by a reused jwt)`)
    const out = join(ROOT, dirname(e.file), `${e.id}.encoded.json`)
    const { file: _f, ...example } = e
    const upstreamChanged = deps(id).some((d) => changed.has(d))
    if (!force && !upstreamChanged && existsSync(out)) {
      const prev = JSON.parse(readFileSync(out, 'utf8')) as EncodedExample & { inputHash?: string }
      if (prev.inputHash === inputHash(example)) {
        encoded.set(id, prev)
        continue
      }
    }
    const enc = await encodeExample(example, (ref) => {
      const [exId, name] = ref.split('/') as [string, string]
      const compact = encoded.get(exId)?.jwts[name]
      if (!compact) throw new Error(`${id}: reused jwt ${ref} not found`)
      return compact
    })
    writeFileSync(out, `${JSON.stringify(enc, null, 2)}\n`)
    encoded.set(id, enc)
    changed.add(id)
    built++
    log(`signed ${e.id}`)
  }
  log(`\n${built} example(s) encoded, ${ds.examples.length - built} unchanged`)
  return [...changed]
}

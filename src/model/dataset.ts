import type { Assertion, C2boSnapshot, Example, Flow, Layer, Spec, Subject } from './schema'

type WithFile<T> = T & { file: string }

/** An example after `examples:build`: every "{{jwt:name}}" replaced by a real compact JWS signed with a test key. */
export interface EncodedExample {
  id: string
  http?: {
    method?: string
    url?: string
    status?: number
    headers: Record<string, string>
    body?: { type: 'form' | 'json' | 'jwt' | 'none'; value: unknown }
  }
  json?: unknown
  /** name → compact JWS (or JWE for encrypted entries). */
  jwts: Record<string, string>
  /** name → decrypted header and payload of a JWE, produced by the same build that encrypted it. */
  plaintexts?: Record<string, { header: Record<string, unknown>; payload: Record<string, unknown> }>
  /** name → full SD-JWT as emitted (issuer JWT ~ disclosures ~ [KB-JWT]); `jwts[name]` holds only the issuer JWT. */
  sdjwts?: Record<string, string>
}

export interface Dataset {
  layers: Layer[]
  specs: WithFile<Spec>[]
  subjects: WithFile<Subject>[]
  flows: WithFile<Flow>[]
  assertions: WithFile<Assertion>[]
  examples: WithFile<Example>[]
  encoded: Record<string, EncodedExample>
  /** Global JSON-pointer patterns → subject, shared by all examples (data/fieldmap.yaml). */
  fieldmap: { pattern: string; subject: string; note?: string }[]
  c2bo: C2boSnapshot | null
  builtAt: string
}

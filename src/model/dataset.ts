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
  /** name → compact JWS. */
  jwts: Record<string, string>
}

export interface Dataset {
  layers: Layer[]
  specs: WithFile<Spec>[]
  subjects: WithFile<Subject>[]
  flows: WithFile<Flow>[]
  assertions: WithFile<Assertion>[]
  examples: WithFile<Example>[]
  encoded: Record<string, EncodedExample>
  c2bo: C2boSnapshot | null
  builtAt: string
}

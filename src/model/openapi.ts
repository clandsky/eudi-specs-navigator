// OpenAPI 3.1 export for the issuer (authorization server + credential issuer) or verifier side. Paths come from
// subjects with an `endpoint`; schemas are inferred from the example objects; `required` and `x-provenance` come from
// the effective rules resolved for the given context. Pure: used by the app (download) and by the build script.
import type { Dataset, EncodedExample } from './dataset'
import { annotationFor, escapeToken, viewOf, type ViewDocument } from './pointer'
import { layerTable, levelLabel, resolve, type Ctx } from './resolve'
import type { Example, LayerId, Role } from './schema'

type Json = Record<string, unknown>

export interface OpenApiOptions {
  view: 'issuer' | 'verifier'
  asOf: string
  layers: ReadonlySet<LayerId>
  /** Base URL of the deployed navigator, for deep links in x-provenance. */
  linkBase?: string
}

const SERVERS: Record<OpenApiOptions['view'], string[]> = { issuer: ['as', 'issuer'], verifier: ['verifier'] }

// Fields whose type the example values cannot show; these schemas replace the inferred type (provenance stays).
const FIELD_SCHEMAS: Record<string, Json> = {
  // A claims path pointer is "a non-empty array of strings, nulls and non-negative integers" (oid4vp/7/claims-path-pointer).
  'vp.dcql.path': { type: 'array', minItems: 1, items: { type: ['string', 'null', 'integer'], minimum: 0 } },
}

export function buildOpenApi(ds: Dataset, opts: OpenApiOptions): Json {
  const table = layerTable(ds.layers)
  const specs = new Map(ds.specs.map((s) => [s.id, s]))
  const specLayer = (id: string): LayerId => specs.get(id)?.layer ?? 'secondary'
  const bySubject = new Map<string, Dataset['assertions']>()
  for (const a of ds.assertions) bySubject.set(a.subject, [...(bySubject.get(a.subject) ?? []), a])
  const subjects = new Map(ds.subjects.map((s) => [s.id, s]))
  const link = (id: string) => `${opts.linkBase ?? ''}#/subject/${encodeURIComponent(id)}`

  function provenance(subjectId: string, role: Role, variant: Partial<Ctx>) {
    const stack = bySubject.get(subjectId) ?? []
    const rule = resolve(stack, { role, asOf: opts.asOf, layers: opts.layers, ...variant }, table, specLayer)
    return {
      rule,
      ext: {
        subject: subjectId,
        role,
        effective: levelLabel(rule.level),
        status: rule.status,
        decidedBy: rule.decidedBy.map((a) => ({
          assertion: a.id,
          spec: specs.get(a.spec)?.title,
          version: specs.get(a.spec)?.version,
          locator: a.locator.req ?? (a.locator.section ? `§${a.locator.section}` : a.locator.at),
          ...(a.condition ? { condition: a.condition } : {}),
        })),
        ...(rule.neutralised.length ? { neutralised: rule.neutralised.map((n) => ({ assertion: n.assertion.id, by: n.by.id, relation: n.by.relation })) } : {}),
        ...(rule.reviews.length ? { needsReview: rule.reviews.map((r) => r.reason) } : {}),
        link: link(subjectId),
      },
    }
  }

  function schemaOf(value: unknown, ptr: string, ex: Example, role: Role, variant: Partial<Ctx>): Json {
    const ann = annotationFor(ptr, ex.annotations, ds.fieldmap)
    let s: Json
    if (Array.isArray(value)) s = { type: 'array', ...(value.length ? { items: schemaOf(value[0], `${ptr}/0`, ex, role, variant) } : {}) }
    else if (value && typeof value === 'object') {
      const properties: Json = {}
      const required: string[] = []
      for (const [k, v] of Object.entries(value as Json)) {
        const p = `${ptr}/${escapeToken(k)}`
        properties[k] = schemaOf(v, p, ex, role, variant)
        const sub = annotationFor(p, ex.annotations, ds.fieldmap)
        if (sub) {
          const { rule } = provenance(sub, role, variant)
          if (rule.level === 'shall' && !rule.decidedBy.some((a) => a.condition)) required.push(k)
        }
      }
      s = { type: 'object', properties, ...(required.length ? { required } : {}) }
    } else if (typeof value === 'number') s = { type: Number.isInteger(value) ? 'integer' : 'number', example: value }
    else if (typeof value === 'boolean') s = { type: 'boolean', example: value }
    else s = { type: 'string', ...(typeof value === 'string' && value.length < 200 ? { example: value } : {}) }
    if (ann && FIELD_SCHEMAS[ann]) s = { ...FIELD_SCHEMAS[ann], example: value }
    if (ann) {
      const { ext, rule } = provenance(ann, role, variant)
      s.description = `${subjects.get(ann)?.title ?? ann}: ${levelLabel(rule.level)} for ${role}${rule.decidedBy[0] ? ` (${rule.decidedBy[0].id})` : ''}.`
      s['x-provenance'] = ext
      if (rule.level === 'shall-not') s['not'] = {}
    }
    return s
  }

  function jwtSchema(name: string, view: ViewDocument, ex: Example, role: Role, variant: Partial<Ctx>): Json | null {
    const j = view.jwt[name]
    if (!j) return null
    return {
      'x-jwt': {
        header: schemaOf(j.header, `/jwt/${escapeToken(name)}/header`, ex, role, variant),
        payload: schemaOf(j.payload, `/jwt/${escapeToken(name)}/payload`, ex, role, variant),
      },
    }
  }

  function jwtNameOf(enc: EncodedExample, value: unknown): string | null {
    if (typeof value !== 'string') return null
    return Object.entries(enc.jwts).find(([, c]) => c === value || value.startsWith(`${c}~`))?.[0] ?? null
  }

  function bodyContent(http: ViewDocument['http'], enc: EncodedExample, view: ViewDocument, ex: Example, role: Role, variant: Partial<Ctx>, type?: string): Json | undefined {
    if (!http || http.body === undefined) return undefined
    // The example's own Content-Type names the media type (a Request Object is application/oauth-authz-req+jwt, RFC
    // 9101 §4, not application/jwt); the body type is only the fallback.
    const declared = Object.entries(http.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
    const fallback = type === 'jwt' ? 'application/jwt' : type === 'form' ? 'application/x-www-form-urlencoded' : 'application/json'
    const media = declared?.split(';')[0]?.trim() || fallback
    if (type === 'jwt') {
      const name = jwtNameOf(enc, enc.http?.body?.value)
      return { [media]: { schema: { type: 'string', ...(name ? jwtSchema(name, view, ex, role, variant) : {}) } } }
    }
    return { [media]: { schema: schemaOf(http.body, '/http/body', ex, role, variant), example: http.body } }
  }

  // Alternative answers with one status: descriptions joined, headers united, each media type's schema an anyOf whose
  // branches name their flow and variant.
  function mergeAnswers(alts: { flowId: string; variant: Partial<Ctx>; entry: Json }[]): Json {
    const headers: Json = {}
    const content: Record<string, { anyOf: Json[]; examples: Json }> = {}
    for (const a of alts) {
      Object.assign(headers, a.entry.headers ?? {})
      for (const [media, body] of Object.entries((a.entry.content as Record<string, Json> | undefined) ?? {})) {
        const c = (content[media] ??= { anyOf: [], examples: {} })
        c.anyOf.push({ title: a.entry.description, ...(body.schema as Json), 'x-flow': { id: a.flowId, variant: { ...a.variant } } })
        if ('example' in body) c.examples[a.flowId] = { summary: a.entry.description, value: body.example }
      }
    }
    return {
      description: alts.map((a) => a.entry.description).join(' / '),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(Object.keys(content).length
        ? {
            content: Object.fromEntries(
              Object.entries(content).map(([media, c]) => [media, { schema: { anyOf: c.anyOf }, ...(Object.keys(c.examples).length ? { examples: c.examples } : {}) }]),
            ),
          }
        : {}),
    }
  }

  // The response a flow step gets back: the next non-internal step sent by the server; GET metadata steps carry the
  // response example themselves.
  function responseOf(flow: Dataset['flows'][number], subjectId: string) {
    const idx = flow.steps.findIndex((s) => s.subject === subjectId)
    // Callers pass only flows that contain the subject.
    const step = flow.steps[idx]!
    const next = flow.steps.slice(idx + 1).find((s) => s.kind !== 'internal')
    const respStep = next && next.from === step.to && (next.kind === 'response' || next.kind === 'redirect') ? next : undefined
    const reqEx = step.example ? ds.examples.find((e) => e.id === step.example) : undefined
    const resEx =
      (reqEx?.kind === 'http-response' ? reqEx : undefined) ?? (respStep?.example ? ds.examples.find((e) => e.id === respStep.example) : undefined)
    const serverRole = (flow.participants.find((p) => p.id === step.to)?.role ?? 'verifier') as Role
    return { flow, step, respStep, reqEx, resEx, serverRole, variant: flow.variant as Partial<Ctx> }
  }

  const paths: Json = {}
  const viewServers = SERVERS[opts.view]
  // Lower `order` first, so the request side of an endpoint shared by several flows resolves in the primary variant
  // (redirect same device before cross device).
  const flowsByOrder = [...ds.flows].sort((a, b) => a.order - b.order)
  for (const subj of ds.subjects) {
    if (!subj.endpoint || !viewServers.includes(subj.endpoint.server)) continue
    const uses = flowsByOrder.filter((f) => f.steps.some((s) => s.subject === subj.id)).map((f) => responseOf(f, subj.id))
    const flow = uses[0]?.flow
    const step = uses[0]?.step
    const variant: Partial<Ctx> = uses[0]?.variant ?? {}
    const clientRole = (flow?.participants.find((p) => p.id === step?.from)?.role ?? 'wallet') as Role
    const serverRole = uses[0]?.serverRole ?? (subj.endpoint.server as Role)

    // Request: either a real request example, or (for GET metadata) only the response example exists.
    const reqEx = uses[0]?.reqEx
    const op: Json = {
      summary: subj.title,
      operationId: subj.id.replace(/[^a-zA-Z0-9]+/g, '_'),
      'x-provenance': provenance(subj.id, reqEx?.kind === 'http-response' ? serverRole : clientRole, variant).ext,
      ...(flow ? { 'x-flow': { id: flow.id, variant: { ...variant } } } : {}),
      responses: {},
    }
    const reqEnc = reqEx ? ds.encoded[reqEx.id] : undefined
    if (reqEx && reqEnc && reqEx.kind !== 'http-response') {
      const view = viewOf(reqEnc)
      const params: Json[] = []
      for (const [name, value] of Object.entries(view.http?.headers ?? {})) {
        if (name.toLowerCase() === 'content-type' || name.toLowerCase() === 'content-length') continue
        const p = `/http/headers/${escapeToken(name)}`
        const sub = annotationFor(p, reqEx.annotations, ds.fieldmap)
        const prov = sub ? provenance(sub, clientRole, variant) : null
        const jwtName = jwtNameOf(reqEnc, value)
        params.push({
          name,
          in: 'header',
          required: prov?.rule.level === 'shall' && !prov.rule.decidedBy.some((a) => a.condition),
          schema: { type: 'string', ...(jwtName ? jwtSchema(jwtName, view, reqEx, clientRole, variant) : {}) },
          ...(prov ? { description: `${subjects.get(sub!)?.title}: ${levelLabel(prov.rule.level)} for ${clientRole}.`, 'x-provenance': prov.ext } : {}),
        })
      }
      for (const [name, value] of Object.entries(view.http?.query ?? {})) {
        const sub = annotationFor(`/http/query/${escapeToken(name)}`, reqEx.annotations, ds.fieldmap)
        const prov = sub ? provenance(sub, clientRole, variant) : null
        params.push({ name, in: 'query', required: prov?.rule.level === 'shall', schema: { type: 'string', example: typeof value === 'string' ? value : JSON.stringify(value) }, ...(prov ? { 'x-provenance': prov.ext } : {}) })
      }
      if (params.length) op.parameters = params
      // Access-token-protected endpoints use the DPoP scheme (RFC 9449 §7.1); the others authenticate the client, if at
      // all, through the attestation headers documented as parameters.
      op.security = view.http?.headers?.Authorization?.startsWith('DPoP ') ? [{ DPoP: [] }] : []
      const content = bodyContent(view.http, reqEnc, view, reqEx, clientRole, variant, reqEx.http?.body?.type)
      if (content) op.requestBody = { required: true, content }
    }
    // Responses: one per distinct response example across the flows that use the endpoint, each resolved in its own
    // flow's variant (the same-device answer carries redirect_uri, HAIP §5.1; the cross-device one does not). Answers
    // with the same status are alternatives (anyOf), labelled with their flow.
    const answers: { status: string; flowId: string; variant: Partial<Ctx>; entry: Json }[] = []
    const seen = new Set<string>()
    for (const u of uses) {
      const resEnc = u.resEx ? ds.encoded[u.resEx.id] : undefined
      if (!u.resEx || !resEnc) continue
      if (seen.has(u.resEx.id)) continue
      seen.add(u.resEx.id)
      const view = viewOf(resEnc)
      const headers: Json = {}
      for (const [name] of Object.entries(view.http?.headers ?? {})) {
        if (name.toLowerCase() === 'content-type') continue
        const sub = annotationFor(`/http/headers/${escapeToken(name)}`, u.resEx.annotations, ds.fieldmap)
        headers[name] = { schema: { type: 'string' }, ...(sub ? { 'x-provenance': provenance(sub, u.serverRole, u.variant).ext } : {}) }
      }
      const content = bodyContent(view.http, resEnc, view, u.resEx, u.serverRole, u.variant, u.resEx.http?.body?.type)
      answers.push({
        status: String(view.http?.status ?? 200),
        flowId: u.flow.id,
        variant: u.variant,
        entry: { description: u.resEx.title, ...(Object.keys(headers).length ? { headers } : {}), ...(content ? { content } : {}) },
      })
    }
    for (const status of [...new Set(answers.map((a) => a.status))]) {
      const alts = answers.filter((a) => a.status === status)
      ;(op.responses as Json)[status] = alts.length === 1 ? alts[0]!.entry : mergeAnswers(alts)
    }
    if (!answers.length) {
      const respStep = uses[0]?.respStep
      ;(op.responses as Json)[respStep?.label?.match(/^\d{3}/)?.[0] ?? '200'] = { description: respStep?.label ?? 'Success' }
    }
    if (!op.security) op.security = []
    // Templated path segments ("/request/{id}") are declared as path parameters.
    const pathParams = [...subj.endpoint.path.matchAll(/\{([^}]+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }))
    if (pathParams.length) op.parameters = [...pathParams, ...((op.parameters as Json[]) ?? [])]
    ;(op.responses as Json)['400'] = { description: 'Error response as defined by the base protocol for this endpoint.' }
    const path = subj.endpoint.path
    paths[path] = { ...((paths[path] as Json) ?? {}), [subj.endpoint.method.toLowerCase()]: op }
  }

  const usesDpop = Object.values(paths).some((ops) =>
    Object.values(ops as Json).some((op) => ((op as Json).security as Json[] | undefined)?.some((sec) => 'DPoP' in sec)),
  )
  const title = opts.view === 'issuer' ? 'EUDI issuer API: authorization server and credential issuer' : 'EUDI verifier API'
  return {
    openapi: '3.1.0',
    info: {
      title,
      version: ds.builtAt,
      description:
        `Generated by specs-navigator from the provenance data. Effective rules resolved as of ${opts.asOf} with the layers ` +
        `${[...opts.layers].sort().join(', ')}. \`required\` follows SHALL rules without a condition; every annotated field ` +
        `carries x-provenance with the deciding assertion. Example values are signed with test keys and are not real.`,
    },
    servers: [{ url: opts.view === 'issuer' ? 'https://eaa.example.eu' : 'https://verifier.example.eu' }],
    paths,
    ...(usesDpop
      ? {
          components: {
            securitySchemes: {
              DPoP: { type: 'http', scheme: 'DPoP', description: 'DPoP-bound access token (RFC 9449 §7.1), required by HAIP §4.' },
            },
          },
        }
      : {}),
    'x-generated': { by: 'specs-navigator', asOf: opts.asOf, layers: [...opts.layers].sort() },
  }
}

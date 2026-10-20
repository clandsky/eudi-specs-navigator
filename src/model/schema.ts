import { z } from 'zod'

// Identifiers --------------------------------------------------------------------------------------------------------

export const LayerId = z.enum(['assumption', 'golive', 'cir', 'etsi', 'haip', 'base', 'primitive', 'arf', 'impl-de', 'secondary'])
export type LayerId = z.infer<typeof LayerId>

/** Roles an assertion can bind. `as` = authorization server, `issuer` = credential issuer. */
export const Role = z.enum(['wallet', 'wallet-provider', 'as', 'issuer', 'verifier'])
export type Role = z.infer<typeof Role>

export const Grant = z.enum(['authorization_code', 'pre-authorized_code', 'refresh_token'])
export const Format = z.enum(['sd-jwt-vc', 'mdoc'])
export const Transport = z.enum(['redirect', 'dc-api', 'proximity'])
export const Device = z.enum(['same', 'cross'])

const slug = z.string().regex(/^[a-z0-9][a-z0-9._/-]*$/i, 'ids use letters, digits, ".", "_", "-", "/"')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD')

// Layers -------------------------------------------------------------------------------------------------------------

export const Layer = z.object({
  id: LayerId,
  /** Lower rank = higher precedence. `null` = never decides (secondary sources). */
  rank: z.number().int().nullable(),
  label: z.string(),
  short: z.string(),
  /** Whether assertions of this layer take part in deciding the effective rule. */
  normative: z.boolean(),
  /** Whether the layer lens can switch this layer off. */
  lens: z.boolean(),
  description: z.string(),
})
export type Layer = z.infer<typeof Layer>
export const LayersFile = z.object({ layers: z.array(Layer) })

// Specs --------------------------------------------------------------------------------------------------------------

export const Spec = z.object({
  id: slug,
  title: z.string(),
  short: z.string(),
  layer: LayerId,
  version: z.string(),
  binding_via: z.string().optional(),
  source: z
    .object({
      /** Path in the local corpus (PDF or text), relative to the repository root. */
      local: z.string().optional(),
      /** Generated plain-text copy under sources/ (git-ignored), used by quote-check. */
      text: z.string().optional(),
      /** Plain-text download used by sources:build when the corpus has no copy (e.g. RFCs pruned from it). */
      fetch: z.string().url().optional(),
      url: z.string().url().optional(),
    })
    .default({}),
  /** URL template for a locator, e.g. `https://openid.net/specs/...#section-{section}`. */
  anchor_template: z.string().optional(),
  retrieved: isoDate.optional(),
  note: z.string().optional(),
  /** Maintained in this repository (assumptions, confirmed readings, go-live compromises): no corpus text to check. */
  authored: z.boolean().default(false),
})
export type Spec = z.infer<typeof Spec>

// Subjects -----------------------------------------------------------------------------------------------------------

export const SubjectKind = z.enum([
  'flow',
  'step',
  'endpoint',
  'message',
  'object',
  'field',
  'metadata-param',
  'value',
  'behaviour',
])
export type SubjectKind = z.infer<typeof SubjectKind>

export const Subject = z.object({
  id: slug,
  kind: SubjectKind,
  title: z.string(),
  parent: slug.optional(),
  /** Where a field travels: HTTP header, form body, JWT header, … Shown in the object view and OpenAPI export. */
  location: z
    .enum(['header', 'query', 'form', 'json', 'jwt-header', 'jwt-payload', 'uri', 'cbor', 'none'])
    .optional(),
  endpoint: z.object({ method: z.enum(['GET', 'POST']), path: z.string(), server: z.enum(['as', 'issuer', 'wallet', 'verifier', 'wallet-provider']) }).optional(),
  description: z.string().optional(),
  /** For a processing step: the fields it checks, one by one, with the result the check expects. */
  checks: z
    .array(
      z.object({
        /** Field as the implementer sees it, e.g. "nonce (KB-JWT)". */
        field: z.string(),
        expect: z.string(),
        /** Subject of the field, whose provenance stack opens on click. */
        subject: slug.optional(),
        /** Only in flows with this transport (e.g. aud differs between redirect and DC API). */
        transport: z.array(Transport).optional(),
      }),
    )
    .default([]),
})
export type Subject = z.infer<typeof Subject>

// Flows --------------------------------------------------------------------------------------------------------------

export const Participant = z.object({
  id: slug,
  label: z.string(),
  role: Role.optional(),
})

export const Step = z.object({
  id: slug,
  from: slug,
  to: slug,
  kind: z.enum(['request', 'response', 'redirect', 'user', 'internal']),
  label: z.string(),
  /** The step subject (its own stack) — usually the message the step carries. */
  subject: slug,
  example: slug.optional(),
  /** Short annotation drawn under the arrow, e.g. "WIA + PoP". */
  tags: z.array(z.string()).default([]),
  note: z.string().optional(),
  /** Makes this a substep of an earlier step (e.g. the checks inside "validate response"): drawn indented, numbered 4.1, 4.2 … */
  parent: slug.optional(),
})
export type Step = z.infer<typeof Step>

export const Flow = z.object({
  id: slug,
  title: z.string(),
  role: z.enum(['issuer', 'verifier']),
  subject: slug,
  variant: z
    .object({ grant: Grant.optional(), device: Device.optional(), transport: Transport.optional() })
    .default({}),
  summary: z.string(),
  /** Position in the flow list of its side (lower first). */
  order: z.number().int().default(99),
  participants: z.array(Participant).min(2),
  steps: z.array(Step).min(1),
})
export type Flow = z.infer<typeof Flow>

// Assertions ---------------------------------------------------------------------------------------------------------

export const Relation = z.enum([
  'defines',
  'profiles',
  'extends',
  'adapts',
  'replaces',
  'voids',
  'implements',
  'deviates',
  'silent',
])
export type Relation = z.infer<typeof Relation>

/** Normative strength for the bound role. `info` = statement without a normative verb. */
export const Level = z.enum(['shall', 'should', 'may', 'should-not', 'shall-not', 'info'])
export type Level = z.infer<typeof Level>

export const Verified = z.enum(['source-checked', 'unverified', 'needs-review'])
export type Verified = z.infer<typeof Verified>

/** The brief's relation names, accepted as shorthand for relation + level. */
const SHORTHAND: Record<string, { relation: Relation; level: Level }> = {
  requires: { relation: 'profiles', level: 'shall' },
  recommends: { relation: 'profiles', level: 'should' },
  permits: { relation: 'profiles', level: 'may' },
  forbids: { relation: 'profiles', level: 'shall-not' },
}

export const TARGETED_RELATIONS = ['adapts', 'replaces', 'voids', 'deviates'] as const satisfies readonly Relation[]

const AppliesTo = z
  .object({
    role: z.array(Role).optional(),
    grant: z.array(Grant).optional(),
    format: z.array(Format).optional(),
    transport: z.array(Transport).optional(),
    device: z.array(Device).optional(),
  })
  .default({})

const AssertionBase = z.object({
  id: slug,
  subject: slug,
  spec: slug,
  locator: z
    .object({
      req: z.string().optional(),
      section: z.string().optional(),
      /** Free-form position: "Annex XII (16)", "Art 3(4)", "Appendix E". */
      at: z.string().optional(),
    })
    .refine((l) => l.req || l.section || l.at, 'a locator needs req, section or at'),
  relation: Relation,
  level: Level.optional(),
  applies_to: AppliesTo,
  /** Condition under which the statement binds, in plain words ("if the RP has a registration certificate"). */
  condition: z.string().optional(),
  /** Short verbatim excerpt from the pinned version. Segments separated by "…" or "..." are found in order. */
  quote: z.string().optional(),
  /** For `silent`: a term that must not occur in the spec's text, so the silence itself is checked. */
  probe: z.string().optional(),
  verified: Verified.default('unverified'),
  target: slug.optional(),
  window: z.object({ from: isoDate.optional(), until: isoDate.optional() }).optional(),
  review: z.object({ reason: z.string() }).optional(),
  note: z.string().optional(),
  xref: z.array(z.object({ source: z.string(), id: z.string() })).default([]),
  /**
   * A reading of its target within the same layer (an assumption, or an assumption confirmed into that layer). It may
   * neutralise a target of the same rank, which an ordinary adapts/replaces may not.
   */
  interpretation: z.boolean().optional(),
  /** Go-live compromises: who agreed it and where it is recorded. */
  decided_by: z.string().optional(),
  reference: z.string().optional(),
})

export const Assertion = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && 'relation' in raw) {
    const r = raw as Record<string, unknown>
    const sh = SHORTHAND[String(r.relation)]
    if (sh) return { ...r, relation: sh.relation, level: r.level ?? sh.level }
  }
  return raw
}, AssertionBase.superRefine((a, ctx) => {
  if ((TARGETED_RELATIONS as readonly string[]).includes(a.relation) && !a.target)
    ctx.addIssue({ code: 'custom', message: `relation "${a.relation}" needs a target`, path: ['target'] })
  if (a.relation === 'silent' && a.level) ctx.addIssue({ code: 'custom', message: 'silent assertions carry no level', path: ['level'] })
  if (['profiles', 'adapts', 'replaces'].includes(a.relation) && !a.level)
    ctx.addIssue({ code: 'custom', message: `relation "${a.relation}" needs a level`, path: ['level'] })
  if (a.verified === 'needs-review' && !a.review)
    ctx.addIssue({ code: 'custom', message: 'needs-review needs review.reason', path: ['review'] })
}))
export type Assertion = z.infer<typeof Assertion>

// Examples -----------------------------------------------------------------------------------------------------------

const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(z.string(), JsonValue)]),
)

export const SignedJwt = z.object({
  header: z.record(z.string(), JsonValue),
  payload: z.record(z.string(), JsonValue),
  /** Test key id under data/test-keys/ that signs this JWT. */
  key: slug,
  /** SD-JWT: selectively disclosable top-level claims. Referenced as "{{sdjwt:name}}". */
  disclosures: z.array(z.object({ salt: z.string(), name: z.string(), value: JsonValue })).optional(),
  /** SD-JWT presentation: appends a Key Binding JWT (typ kb+jwt, sd_hash computed) signed with this key. */
  kb: z.object({ key: slug, payload: z.record(z.string(), JsonValue) }).optional(),
})
/** An encrypted JWT (JWE, ECDH-ES to a test key), referenced as "{{jwe:name}}". The plaintext is kept for display. */
export const EncryptedJwt = z.object({
  encrypt: z.object({ key: slug, alg: z.enum(['ECDH-ES']).default('ECDH-ES'), enc: z.enum(['A128GCM', 'A256GCM']).default('A128GCM') }),
  header: z.record(z.string(), JsonValue).default({}),
  payload: z.record(z.string(), JsonValue),
})
/** Reuse the JWT another example already encoded (`<example-id>/<jwt-name>`), so one WIA travels in PAR and token. */
export const ReusedJwt = z.object({ use: z.string().regex(/^[\w.-]+\/[\w.-]+$/) })
export const ExampleJwt = z.union([ReusedJwt, EncryptedJwt, SignedJwt])
export type ExampleJwt = z.infer<typeof ExampleJwt>

export const Example = z.object({
  id: slug,
  title: z.string(),
  subject: slug,
  kind: z.enum(['http-request', 'http-response', 'uri', 'json', 'jwt']),
  http: z
    .object({
      method: z.enum(['GET', 'POST']).optional(),
      url: z.string().optional(),
      status: z.number().int().optional(),
      headers: z.record(z.string(), z.string()).default({}),
      body: z
        .object({ type: z.enum(['form', 'json', 'jwt', 'none']), value: JsonValue })
        .optional(),
    })
    .optional(),
  /** Free JSON document (metadata, offer, …). Strings "{{jwt:name}}" are replaced with the encoded JWT. */
  json: JsonValue.optional(),
  /** JWTs referenced as "{{jwt:name}}" anywhere in http, json or other JWTs. */
  jwts: z.record(z.string(), ExampleJwt).default({}),
  /** JSON pointer into the view document → subject id. */
  annotations: z.record(z.string(), slug).default({}),
  note: z.string().optional(),
  /**
   * Body edits recorded as assumptions of the project owner (written by the example editor): which fields of the view
   * document changed or disappeared, and why. The object view marks those fields while the Assumptions layer is on.
   */
  assumptions: z
    .array(
      z.object({
        date: isoDate,
        decided_by: z.string().optional(),
        note: z.string(),
        changed: z.array(z.string()).default([]),
        removed: z.array(z.string()).default([]),
      }),
    )
    .default([]),
})
export type Example = z.infer<typeof Example>

// Field map -------------------------------------------------------------------------------------------------------

export const FieldMapFile = z.array(z.object({ pattern: z.string().startsWith('/'), subject: slug, note: z.string().optional() }))

// Secondary: c2bo conformance --------------------------------------------------------------------------------------

export const C2boSource = z.object({ chain: z.string(), eu: z.boolean(), level: z.enum(['shall', 'should', 'may', 'note']), quote: z.string() })
export const C2boRequirement = z.object({ id: z.string(), group: z.string(), title: z.string(), note: z.string().optional(), sources: z.array(C2boSource) })
export const C2boSnapshot = z.object({
  retrieved: isoDate,
  url: z.string(),
  groups: z.array(z.object({ id: z.string(), name: z.string(), requirements: z.array(C2boRequirement) })),
})
export type C2boRequirement = z.infer<typeof C2boRequirement>
export type C2boSnapshot = z.infer<typeof C2boSnapshot>

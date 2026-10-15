# Initial prompt: specs-navigator

Paste everything below the line into the first session of the new project. Before that, copy into the new repo:

- `01-spec-catalog.md` and `02-eudiw-project-summary.md` → `context/`
- the three text copies `cir-2026-1731.txt`, `etsi-ts-119-472-3-v1.1.1.txt`, `etsi-ts-119-472-2-v1.2.1.txt` and
  `fetch-validation-sources.sh` from the guide's `.claude/` → `sources/` (keep `sources/*.txt` out of a public
  repository; ETSI texts are free to download but not ours to redistribute)

---

I want to build a tool called **specs-navigator**.

## The problem

In the EUDI Wallet ecosystem, no single document says what an issuer or a verifier has to send. A token request is
defined by OAuth 2.0 and OpenID4VCI, narrowed by HAIP, profiled by ETSI TS 119 472-3, adapted by Commission
Implementing Regulation (EU) 2026/1731, and implemented in a particular way by the German wallet. A field can be
defined in one spec, made mandatory in a second, forbidden in a third, and voided again by the regulation. Developers
and architects lose days reconstructing this stack per parameter, and they get it wrong.

specs-navigator shows, for every part of the ecosystem, **which spec defines it and which spec overrides it**.

## What it provides

1. **Sequence diagrams of the flows.** Every message and every step links to where it is defined and where it is
   overruled.
2. **Example objects for requests and responses.** Every object, and every field in it, shows where it is defined
   and where it is overruled.
3. The possibility to add and store overrules for every step in the diagrams and every line in the example code
4. Export A verifier openapi spec and an issuer openapi spec
5. Using Webtechnologies and a good looking UI. Use frontend skills.
6. Select Verifier or Issuer API
7. List API Endpoints
8. 

The UI is an intuitive web app, an **API explorer for issuers and verifiers**: pick a role and a flow, walk the
sequence diagram, click a message, see the example object, click a field, see its provenance stack.

## Context you have

- `context/01-spec-catalog.md`: every spec in scope, versions, access paths, the precedence order, and known traps.
  Read it first, completely.
- `context/02-eudiw-project-summary.md`: the sister project (the EUDI Wallet Developer Guide) whose validation
  sources this tool reuses, its audiences and conventions.
- `sources/`: local plain-text copies of the three binding documents (the CIR and the two ETSI profiles), plus the
  script that rebuilds them. Grep these; do not rely on memory for requirement IDs or wording.

## Core concept: the provenance stack

Every **subject** (a flow, a step, a message, an object, a field, a metadata parameter, an allowed value) has a stack
of **assertions**, one per spec that says something about it. Each assertion has:

- `spec`: a catalog entry, with the **pinned version**
- `locator`: section number and anchor, or the requirement ID (`TOKEN-REQ-4.5.1-01`, `TR-WIA-3`,
  `OIDFVP-HAIP-COMMON-REQ-RO-13`)
- `relation`: one of
  - `defines`: introduces the subject
  - `profiles`: narrows its option space (OPTIONAL → REQUIRED, a value list restricted)
  - `requires` / `recommends` / `permits` / `forbids`: sets the normative level for a role
  - `extends`: adds something the base did not have
  - `adapts`: rewords a requirement of a lower spec
  - `replaces`: substitutes a requirement of a lower spec
  - `voids`: removes a requirement of a lower spec
  - `implements`: how a concrete implementation (German wallet) does it
  - `deviates`: an implementation or lower source contradicts a higher one
  - `silent`: explicitly recorded that a binding spec says nothing here, so a lower one governs
- `applies_to`: role (wallet, issuer, authorization server, verifier) and, where relevant, grant type, credential
  format (SD-JWT VC, mdoc), transport (redirect, Digital Credentials API, proximity), device pattern (same, cross)
- `quote`: a short verbatim excerpt from the source, so a reader can confirm it without opening the spec
- `verified`: `source-checked` (quote found in the local copy or the pinned raw file), `unverified`, or
  `needs-review` (sources conflict or none decides)
- `target`: for `adapts`, `replaces`, `voids`, `deviates`: the assertion it acts on

The **effective rule** for a subject is computed from the stack using the precedence order in the catalog. The UI
always shows both: the effective rule, and the full stack that produced it. Nothing is harmonised away; a
contradiction is shown as a contradiction.

**Accuracy is the product.** Never invent a requirement ID, section number, field name or quote. If you cannot find
it in the local copies or the pinned source, mark the assertion `unverified` and list it for me. A tool that shows
a wrong provenance is worse than no tool.

## Scope of the first version

Issuer side (OpenID4VCI as profiled by HAIP, ETSI TS 119 472-3 and the CIR):

- Credential Offer (by value, by reference; both grant types; `eu-eaa-offer://`)
- Credential Issuer metadata (signed metadata, `issuer_info` with registration certificate, `proof_types_supported`,
  `key_attestations_required`, `credential_reuse_policy`, `preferred_client_status_period`)
- Authorization Server metadata (`token_endpoint_auth_methods_supported` with `attest_jwt_client_auth`, challenge
  endpoint)
- Pushed Authorization Request with WIA (`OAuth-Client-Attestation`, `OAuth-Client-Attestation-PoP`), PKCE
- Token Request and Response, both grants, DPoP, WIA, refresh
- Nonce Endpoint
- Credential Request with `proofs.jwt` (key attestation in the `key_attestation` header) and `proofs.attestation`;
  Credential Response; batch issuance; response encryption
- Notification Endpoint
- The WIA and the Key Attestation themselves as objects (claims from CIR Annex Ib `C_WIA-*`, `C_KA-*`, ARF TS3 and
  the German wallet backend docs)

Verifier side (OpenID4VP as profiled by HAIP, ETSI TS 119 472-2 and the CIR adaptations):

- Request Object (JAR) with `x5c` (access certificate), `verifier_info` with registration certificate, DCQL query,
  `client_id` prefixes, `response_mode` (`direct_post`, `direct_post.jwt`, `dc_api`, `dc_api.jwt`)
- Authorization Request URL, same device and cross device, `eu-eaap://`
- Digital Credentials API mechanism (HAIP 5.2, OpenID4VP Appendix A)
- Authorization Response with `vp_token`; SD-JWT VC presentation with Key Binding JWT; mdoc `DeviceResponse`
- ISO/IEC 18013-5 request with `readerAuth` and `requestInfo.euWrprc` (CIR-adapted)

Flows for v1:

1. Issuance, authorization code flow with PAR, same device
2. Issuance, pre-authorized code flow, cross device
3. Presentation, OpenID4VP redirect, same device
4. Presentation, OpenID4VP redirect, cross device (show the CIR position: wallets **should not** support it)
5. Presentation, OpenID4VP over the Digital Credentials API

Later, not in v1: proximity presentation, deferred issuance, re-issuance, status list checks as a flow, trust list
resolution as a flow.

## UI requirements

- **Role switch** at the top: Issuer, Verifier. It filters flows, objects and the requirements shown (`applies_to`).
- **Flow view:** a sequence diagram with numbered steps. Clicking a step or a message opens a side panel with its
  provenance stack and the example object. Steps that exist only because a higher spec added them (for example WIA
  on PAR) are visually marked. Note: Mermaid sequence diagrams do not support click handlers on messages, so either
  render the diagram yourself (SVG from the flow data) or pick a library that does; decide and tell me why.
- **Object view:** the example JSON (or decoded JWT header and payload, or CBOR diagnostic notation for mdoc) with
  every field clickable. Each field carries a small badge per layer that touches it (CIR, ETSI, HAIP, base, German).
  Hovering shows the effective rule; clicking opens the stack.
- **Layer lens:** a control that switches layers on and off cumulatively (base protocol only → + HAIP → + ETSI →
  + CIR → + German implementation) and shows how the example object and the required/optional status of each field
  change. Changes are highlighted as a diff. This is the feature that answers "who overruled this".
- **Spec view:** pick a spec, see everything it defines, profiles or overrides, grouped by section. For the CIR, a
  dedicated view of every adaptation of ETSI TS 119 472-2 and -3: base text, CIR text, effect.
- **Search** across field names, parameter names, requirement IDs and section titles.
- **Deep links** for every flow, step, object, field and assertion, so a link can be pasted into a ticket.
- **Contradictions and gaps view:** every `deviates`, `needs-review` and `silent` assertion in one list.
- Works without a backend (static hosting), light and dark mode, usable on a laptop screen. Desktop first; mobile
  only needs to be readable.

## Data and architecture

- The knowledge lives in **versioned data files** (YAML or JSON) in the repository, validated against a schema in CI,
  not in components. The UI is generated from the data. Proposed shape: `specs/` (catalog), `subjects/` (flows,
  steps, objects, fields), `assertions/` (the stacks), `examples/` (example objects, annotated by JSON pointer).
- Example objects are **valid**: JSON parses, JWTs are real encodings with test keys, and the decoded view is
  derived from the encoded one, not written separately. Include a test that checks every annotated JSON pointer
  exists in its example.
- Precedence resolution is a small, unit-tested pure function.
- Propose a stack. My default would be Vite + React + TypeScript with a schema library for the data, statically
  built; argue if something else fits better.

## How I want you to work

1. Read both context files and skim the three source texts in `sources/`.
2. Do **not** build yet. Come back with:
   - the data model (schema draft) for specs, subjects, assertions and examples
   - how you resolve the effective rule from a stack, with three worked examples from the real sources: WIA on the
     token request, response encryption in OpenID4VP (`COMMON-RESP-01` voided by the CIR), and
     `verifier_info` with the registration certificate (`COMMON-REQ-RO-13`, adapted from "if any" to "shall")
   - the UI structure with a rough wireframe of the flow view, object view and layer lens
   - the stack choice with reasons
   - a phased plan: phase 1 is a vertical slice of **one flow (issuance, authorization code with PAR) end to end**,
     with every assertion source-checked
   - open questions for me
3. After I approve, build phase 1. Only then widen.
4. Throughout: every assertion you add cites a locator and a quote from the pinned version; anything you cannot
   verify goes into a `needs-review` list I can work through.

Ask me questions in German. Code, data and UI text are in English.

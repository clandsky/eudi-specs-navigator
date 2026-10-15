# The EUDI Wallet Developer Guide: project summary

Context for specs-navigator. Describes the sister project whose validation sources specs-navigator reuses.

## What it is

The **German EUDI Wallet Ecosystem Developer Guide** is a Docusaurus site published at
`https://bmi.usercontent.opencode.de/eudi-wallet/developer-guide`. It helps organisations join the German EUDI Wallet
ecosystem under eIDAS 2.0, starting with the **Sandbox** environment (test data only, no real eIDs). In the Sandbox,
PID presentation is available and participants can define their own EAAs, their trust frameworks, and issue them into
the wallet. A production environment follows later.

## Who reads it

Two ecosystem roles drive the content:

- **Relying Parties (verifiers):** request and validate credentials (PID, EAAs) with OpenID4VP.
- **EAA Providers (issuers):** issue Electronic Attestations of Attributes with OpenID4VCI.

Further roles in the taxonomy: Trust Service Provider, Intermediary, Identification Service.

Personas: General, Architect, Developer, Domain Expert (public sector, ISP, financial sector), Lawyer, Project
Manager. Architects want component boundaries and sequence diagrams; developers want concrete request and response
shapes, field-level detail, validation order and error handling. Those two personas are the core audience for
specs-navigator.

## Content structure

```text
docs/
  index.md                 introduction, kick-off calls, status
  sandbox/                 joining, onboarding, readiness checklist, access and registration certificates, legal
  rp/                      Relying Parties
    onboarding/            high-level onboarding, worked example (BDB)
    guide/arch/            device patterns and profiles (same/cross device, OpenID4VP standard vs HAIP), logging
    guide/dev/             client_id, validation
    guide/presentation/    PID presentation with OpenID4VP, registration certificate usage
  eaa/                     EAA Providers
    onboarding/            overview
    guide/issuance/        EAA issuance with OpenID4VCI, HAIP example flow, low-fidelity example flow,
                           lifecycle, rulebook, credential styling
  concepts/                access certificate, registration certificate, binding (claim, key, session,
                           client_id/nonce/state), credentials, level of assurance, PID, types of verification
  resources/               glossary, open-source libraries, PID reference, ERICA, accessibility
```

The pages already contain material specs-navigator can start from: Mermaid sequence diagrams of issuance and
presentation, annotated request and response templates (credential issuer metadata, credential offers, token
requests, credential requests, PID presentation request objects with numbered callouts), and implementation
checklists for metadata, token endpoint and credential endpoint.

## How the guide validates its statements

Each statement is checked against a fixed source set (see `01-spec-catalog.md`), with a strict hierarchy:

1. **CIR (EU) 2026/1731** and the ETSI profiles it makes binding (TS 119 472-3 for issuance, TS 119 472-2 for
   presentation, as adapted by the CIR). Overrules everything. Deviations of lower sources are recorded, not
   harmonised away. Where it cannot decide, the page is flagged for manual review.
2. Below that, authority is per topic: German wallet docs for wallet behaviour, the Architekturkonzept for the
   German trust model, the ARF for EU roles, OpenID4VCI/VP for mechanics, HAIP for mandated options, RFC 8414 and
   the attestation-based client auth draft for OAuth client authentication.

Review agents check pages in a fixed priority order: implementing-act reviewer (CIR correctness), senior developer
(can I build it), architect (can I draw it), doc reviewer (wording).

## Conventions worth carrying over

- **Issuer decisions are marked.** Where the specs leave a choice to the issuer or RP, the guide shows the options
  and their consequences instead of recommending one. Examples: WIA on the authorization-code token request, WIA on
  refresh, grant type, refresh token support.
- **State facts, not sources.** Body text says what is true; the source sits in a reference. Specs-navigator inverts
  this on purpose: its whole job is to show the source.
- **German terms over EU terms** where they differ (Wallet Instance, not Wallet Unit).
- **PID-provider internals are out of scope.** The guide covers what an RP or EAA provider must do, not PID-provider
  rules.
- **Pinned versions.** A precise claim records the version it was checked against.

## Known gaps specs-navigator can close

- The guide explains each flow on one page; it does not show, per field, which spec defined it and which one
  narrowed, replaced or voided it.
- Relations between CIR, ETSI, HAIP and base protocols live in a private index file (`VALIDATION_SOURCES.md`) and
  in reviewer agent prompts, not in a browsable form.
- Some pages cite outdated versions (HAIP drafts `-03`/`-04`, RFC 7049 instead of RFC 8949, SD-JWT VC `-15`).

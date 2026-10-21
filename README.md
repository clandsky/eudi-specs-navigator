# specs-navigator

**Live: <https://clandsky.github.io/eudi-specs-navigator/>**

An API explorer for EUDI Wallet issuers (OpenID4VCI) and verifiers (OpenID4VP). In the EUDI Wallet ecosystem no
single document says what an issuer or a verifier has to send: a field can be defined by a base protocol, narrowed by
HAIP, profiled by ETSI, adapted by the Commission Implementing Regulation and implemented differently again by a
national wallet. specs-navigator shows, for every flow, step, message and field, **which spec defines it, which specs
override it, and the effective rule as of a date**.

> **Technical prototype.** The content is not yet fully quality assured and is under review. It is not a source of
> truth; check every rule against the cited specification.

## What it does

- **Sequence diagrams** of the issuance and presentation flows. Every message links to where it is defined and where
  it is overruled.
- **Example objects** for requests and responses (signed with test keys). Click a field to see its provenance stack.
- **Layer lens**: Base → + HAIP → + ETSI → + CIR → + go-live compromises → + Assumptions, to see how each layer
  changes the rule.
- **As-of date**: the effective rule on a given day, and how it changes over time.
- **OpenAPI export** for the issuer and the verifier side.
- **Compiled reference** for developer guides: `eaa.md` / `eaa.json` (EAA issuance, issuer side) and `vp.md` / `vp.json`
  (VP presentation, verifier side). The effective rules of every flow without the provenance stacks: one row per field
  or obligation with its level per role, the deciding requirement and an example value, plus Mermaid flow diagrams,
  validation checks, upcoming changes and open points. Generated from the same data, so it cannot drift; the Markdown is
  safe for Docusaurus (MDX). Download it in the app for any date and lens, or write it with `pnpm compile <dir>`.

Flows in v1: issuance with authorization code + PAR, pre-authorized code; presentation via redirect (same device and
cross device) and the Digital Credentials API, and the same-device redirect with an ISO mdoc PID (a CBOR
DeviceResponse, decoded field by field).

## Precedence

Assumptions > go-live compromises > CIR implementing acts > ETSI > HAIP > base protocols > primitives > ARF (lower
rank wins), encoded in [`data/layers.yaml`](data/layers.yaml). The German implementation layer is shown as an
implementation with deviations flagged; it never decides.

## Development

```bash
pnpm install
pnpm dev        # dev server; also enables saving go-live compromises, assumptions and example edits
pnpm test
pnpm validate   # schema + cross-reference check of data/
pnpm build      # validate + typecheck + static build + OpenAPI files and compiled references in dist/
pnpm compile <dir>   # write eaa.md/.json and vp.md/.json to <dir> (default dist/compiled), e.g. a guide checkout
```

Pushes to `main` publish the static build to GitHub Pages. All knowledge lives as YAML under [`data/`](data/); every
assertion quotes the pinned spec version verbatim. See [`CLAUDE.md`](CLAUDE.md) for the architecture and the rules for
adding knowledge. The source corpus (specs, standards) is third-party material and is not part of this repository.

## License

[MIT](LICENSE)

# Spec catalog for specs-navigator

Every specification the EUDI Wallet Developer Guide validates against or references, grouped by layer, with the
version that was checked and where to get a machine-readable copy. Compiled on 2026-10-15 from the guide's
`VALIDATION_SOURCES.md` (indexed 2026-09-18) and from every spec reference in the guide's pages.

Status column:

- **validated**: the guide's validation process uses this source, with a pinned version
- **referenced**: a guide page cites it, but it is not part of the validation set
- **transitive**: no guide page cites it, but a validated source pulls it in normatively
- **candidate**: relevant to the ecosystem, cited nowhere yet; verify before use

## Precedence

Default order (set by the project owner, 2026-10-15): **temporal go-live compromises > CIR implementing acts > ETSI >
standards**. specs-navigator encodes this in `data/layers.yaml`. From top to bottom:

| Rank | Layer | Rule |
|---|---|---|
| G | Temporal go-live compromises | Time-bounded agreements that relax or replace a binding rule for a go-live period. Overrule everything while their window is open; afterwards the underlying rule applies again. Not in the corpus: the project owner adds them in the tool |
| 0 | Binding EU law: CIR (EU) 2026/1731, then the ETSI profiles it makes binding | Overrules every other source. Where the CIR adapts an ETSI requirement (voids, replaces, inserts, rewords), the CIR wording applies; the ETSI base text applies unchanged everywhere else |
| 1 | Profiles: HAIP 1.0 | Restricts the option space of OpenID4VCI and OpenID4VP. Pulled in by ETSI TS 119 472-3 `GEN-REQ-4.1-01`/`-02` and TS 119 472-2 clause 6 |
| 2 | Base protocols: OpenID4VCI, OpenID4VP, OAuth RFCs, IETF drafts, ISO/IEC 18013 | Define the mechanics: endpoints, parameters, objects |
| 3 | Primitives: JOSE, CBOR/COSE, SD-JWT, X.509 | Define encodings and crypto |
| 4 | EU framework, non-binding: ARF and its technical specifications (TS3 and others) | Normative for content the ARF owns (for example the WUA in TS3) where Layer 0 is silent |
| 5 | German ecosystem: Wallet Development Documentation, eIDAS 2.0 Architekturkonzept | Govern how the German wallet behaves; divergences from the EU text are recorded, not harmonised away |

Per-topic authority below Layer 0:

| Topic | Authoritative source |
|---|---|
| How the German wallet behaves: flows, claim names, backend components | Wallet Development Documentation |
| German trust model, PKI, trust lists, governance roles | eIDAS 2.0 Architekturkonzept |
| EU-level roles, obligations, the ARF's own technical specifications | ARF |
| Protocol mechanics: requests, responses, metadata, parameters | OpenID4VCI / OpenID4VP |
| OAuth client authentication, AS metadata, the well-known URI | RFC 8414 / Attestation-Based Client Authentication |
| Which protocol options high assurance mandates | HAIP |
| Rulebook structure and worked attribute encoding | Catalog of Attestations |

## Layer 0: binding EU law

| Spec | Version / date | Status | Scope | Access |
|---|---|---|---|---|
| Regulation (EU) No 910/2014 (eIDAS) | as amended | referenced | Legal basis; Art. 5a(23) empowers the CIRs | `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014R0910` |
| Regulation (EU) 2024/1183 (eIDAS 2.0) | 2024 | referenced | Amends 910/2014, introduces the EUDI Wallet | `https://eur-lex.europa.eu/eli/reg/2024/1183/oj/eng` |
| **CIR (EU) 2026/1731** | 15 July 2026, OJ L 22.7.2026, in force 11 Aug 2026 | **validated, top source** | Amends 2024/2977, 2024/2979, 2024/2980, 2024/2982. Annex Ib (CIR Annex III): WUA requirements (`TR-WIA-*`, `TR_KA-*`, `C_WIA-*`, `C_KA-*`, `LC_*`, `R_*`, `SA-*`). Annex XI: issuance profile = ETSI TS 119 472-3 with adaptations. Annex XII: presentation profile = ETSI TS 119 472-2 clauses 4.1, 4.2, 5, 6 with adaptations and new clauses 4.3, 4.4, 5.4; also applies ISO/IEC 18013-7:2025 Annex C. Art. 3(4) of 2024/2982 (wallet validates RP registration certificates) applies from 11 Aug 2028 | Machine-readable: `https://publications.europa.eu/resource/celex/32026R1731` with `Accept: application/xhtml+xml` (eur-lex needs JavaScript). Local text: `cir-2026-1731.txt` |
| CIR (EU) 2024/2977 | 2024 | transitive (amended by 2026/1731) | PID and EAA | EUR-Lex |
| CIR (EU) 2024/2979 | 2024 | referenced | Integrity and core functionalities; Art. 6(2) replaced so that WUAs comply with Annex Ib; Annex II lists formats | EUR-Lex |
| CIR (EU) 2024/2980 | 2024 | transitive | Notifications; Art. 4-5 feed the EU Wallet Providers List | EUR-Lex |
| CIR (EU) 2024/2982 | 2024 | transitive | Protocols and interfaces; Annex I (issuance) and Annex II (presentation) replaced by 2026/1731 | EUR-Lex |
| CIR (EU) 2015/1502 | 2015 | referenced | Levels of assurance | `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32015R1502` |
| CIR (EU) 2025/848 | 2025 | candidate | Registration of wallet-relying parties | EUR-Lex; verify scope before use |
| **ETSI TS 119 472-3** | **V1.1.1 (2026-03)** | **validated, binding via CIR Annex XI** | Issuance profile of OpenID4VCI + HAIP. Requirement IDs `GEN-REQ-4.1-*`, `ISS-MDATA-*`, `ISS-CRED-OFFER-*`, `AUTH-REQ-*`, `TOKEN-REQ-*`, `CRED-REQ-*`, `CRYPTO-5-01`, `SEC-6-*`. CIR voids `GEN-REQ-4.1-05`, `ISS-MDATA-REG_CERT-4.2.3-07` to `-13`, Annex A; adapts `-4.2.3-04` and `ISS-MDATA-EAA-REUSE-POL-4.2.4.2-09` | `https://www.etsi.org/deliver/etsi_ts/119400_119499/11947203/01.01.01_60/ts_11947203v010101p.pdf`. Local text: `etsi-ts-119-472-3-v1.1.1.txt` |
| **ETSI TS 119 472-2** | **V1.2.1 (2026-03)** | **validated, binding via CIR Annex XII** | Presentation profile: SD-JWT VC and mdoc (`EAAP-*`), ISO mdoc profile (`ISO/IEC 18013-*`), OpenID4VP-HAIP profile (`OIDFVP-HAIP-*`), redirect vs API-mediated mechanisms, custom scheme `eu-eaap://`. Heavily adapted by the CIR (see the adaptation table in the source index) | `https://www.etsi.org/deliver/etsi_ts/119400_119499/11947202/01.02.01_60/ts_11947202v010201p.pdf`. Local text: `etsi-ts-119-472-2-v1.2.1.txt` |

## ETSI, supporting

| Spec | Version | Status | Scope | Access |
|---|---|---|---|---|
| ETSI TS 119 475 | V1.2.1 | referenced | Relying party attributes, registration certificates | `https://www.etsi.org/deliver/etsi_ts/119400_119499/119475/01.02.01_60/ts_119475v010201p.pdf` |
| ETSI TS 119 411-8 | V1.1.1 | referenced | Certificate policy for access certificates | `https://www.etsi.org/deliver/etsi_ts/119400_119499/11941108/01.01.01_60/ts_11941108v010101p.pdf` |
| ETSI TS 119 612 | V2.4.1 | referenced | Trusted lists | `https://www.etsi.org/deliver/etsi_ts/119600_119699/119612/02.04.01_60/ts_119612v020401p.pdf` |
| ETSI TS 119 602 | (check) | transitive | Lists of Trusted Entities (LoTE). Type `http://uri.etsi.org/19602/LoTEType/EUWalletProvidersList`, service types `.../19602/SvcType/WalletSolution/Issuance` and `.../Revocation` | ETSI deliver site |
| ETSI TS 119 472-1 | (check) | candidate | General EAA profile, parent of -2 and -3 | ETSI deliver site |

## ISO

| Spec | Version | Status | Scope |
|---|---|---|---|
| ISO/IEC 18013-5 | 2021 | referenced, binding via CIR Annex XII 5.3 | mDL / mdoc data model, proximity presentation, `DeviceResponse`, `readerAuth`, `requestInfo` |
| ISO/IEC 18013-7 | 2025 | transitive, binding via CIR Annex XII (Annex C, new clause 5.4) | Online mdoc presentation; Annex C is the Digital Credentials API mechanism |
| ISO 639 | | transitive (added by CIR) | Language codes |

## OpenID Foundation

| Spec | Version | Status | Scope | Access |
|---|---|---|---|---|
| **OpenID4VCI** | 1.0 Final | validated | Issuance: Credential Offer (§4), Authorization (§5), Token (§6), Nonce (§7), Credential (§8), Deferred (§9), encryption (§10), Notification (§11), Metadata (§12), Appendix D Key Attestations, Appendix E Wallet Attestations in JWT, Appendix F Proof Types | `https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html`, anchors `#name-<slug>` |
| **OpenID4VP** | 1.0 Final | validated | Presentation: Authorization Request (§5), DCQL (§6), Claims Path Pointer (§7), Response (§8), Wallet Invocation (§9), metadata (§10, §11), Verifier Attestation JWT (§12), Appendix A DC API, Appendix B format parameters | `https://openid.net/specs/openid-4-verifiable-presentations-1_0.html` |
| **HAIP** | 1.0 Final | validated | §4 OpenID4VCI profile (metadata, offer, authorization, token, credential endpoints), §5 OpenID4VP profile (5.1 redirect, 5.2 DC API), §6.1 SD-JWT VC profile, §7 signatures, §9.2 interoperable key attestations | `https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-final.html` |
| FAPI 2.0 Security Profile | 2.0 | referenced | TLS and endpoint security baseline | `https://openid.net/specs/fapi-security-profile-2_0.html` |
| SIOPv2 | | referenced (`aud: https://self-issued.me/v2` in one example) | Self-issued OP | openid.net |

The guide also links HAIP drafts `-03` and `-04`. Treat them as superseded by 1.0 Final.

## IETF

| Spec | Version | Status | Scope |
|---|---|---|---|
| RFC 6749 | | referenced | OAuth 2.0 framework, token endpoint, client authentication |
| RFC 7636 | | referenced (PKCE) | PKCE |
| RFC 9126 | | transitive | Pushed Authorization Requests; §2 applies token-endpoint client authentication rules to the PAR endpoint |
| RFC 9449 | | referenced | DPoP |
| **RFC 8414** | June 2018 | validated | AS metadata, `/.well-known/oauth-authorization-server`, `token_endpoint_auth_methods_supported` |
| RFC 9101 | | transitive | JWT-secured authorization request (request objects, `request_uri`) |
| RFC 9068 | | referenced | JWT access token profile |
| RFC 7591 | | transitive | Dynamic client registration; establishes the token endpoint auth method registry |
| RFC 8615 | | transitive | Well-known URIs |
| **draft-ietf-oauth-attestation-based-client-auth** | **-08** (2 March 2026) | validated | `OAuth-Client-Attestation` and `OAuth-Client-Attestation-PoP` headers (§6.1), attestation JWT (§5.1), PoP JWT with optional `challenge` (§5.2), AS metadata (§9), `attest_jwt_client_auth` (§13.4; no `_dpop` variant exists) |
| draft-ietf-oauth-sd-jwt-vc | -15 referenced | referenced | SD-JWT VC: `vct`, type metadata, issuer key resolution |
| RFC 9901 | | referenced | SD-JWT, disclosures, Key Binding JWT |
| draft-ietf-oauth-status-list | (pin a version) | referenced | Token Status List; revocation mechanism for WIA and key attestation (`R_GEN-1`) |
| RFC 7515 / 7516 / 7517 / 7518 / 7519 | | referenced (7515, 7519) / transitive | JWS, JWE, JWK, JWA, JWT |
| RFC 7800 | | referenced | `cnf` proof-of-possession key semantics |
| RFC 8949 | | referenced | CBOR (the guide's glossary still cites the obsolete RFC 7049) |
| RFC 9052 / 9053 | | transitive | COSE |
| RFC 5280 / RFC 6960 | | transitive | X.509 profile / OCSP |

## W3C

| Spec | Status | Scope |
|---|---|---|
| Digital Credentials API | transitive (HAIP 5.2, OpenID4VP Appendix A, ISO 18013-7 Annex C, CIR `EAAP-API-GEN-01`) | Browser-mediated presentation |
| VC Data Model | referenced as contrast only | Not used in this ecosystem |

## EU framework, non-binding

| Source | Version | Status | Scope | Access |
|---|---|---|---|---|
| ARF (Architecture and Reference Framework) | `main` / `latest` | validated | Roles, trust model, high-level requirements (Annex 2), PID and mDL rulebooks (Annex 3), definitions (Annex 1). `docs/discussion-topics/*` is not normative | Repo `github.com/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework`, raw via `raw.githubusercontent.com/.../main/<path>` |
| ARF technical specifications | TS3 v1.5.2 (2026-05-26) | validated | **TS3: Wallet Unit Attestation** (WUA = WIA + Key Attestation): format, transport, content, life cycle, revocation, algorithms. Also TS1, TS2, TS5, TS6, TS7 to TS14 | Repo `github.com/eu-digital-identity-wallet/eudi-doc-standards-and-technical-specifications`, `docs/technical-specifications/<file>` |
| Catalog of Attestations, gym membership card rulebook | file `1.0.0.md` contains v1.0.1 (2026-06-10) | validated | Rulebook structure, SD-JWT VC encoding example | `https://raw.githubusercontent.com/cre8/catalog-of-attestations/main/rulebooks/gym-membership-card/1.0.0.md` |

## German ecosystem

| Source | Status | Scope | Access |
|---|---|---|---|
| Wallet Development Documentation (BMI) | validated | How the German wallet, Wallet Backend, MDVM and Remote WSCA behave: data register, cryptography and token lifetimes, PID and EAA issuance and presentation flows, WIA claim structure, Status List Token `wb_wia_tsl`, revocation | Repo `gitlab.opencode.de/bmi/eudi-wallet/wallet-development-documentation-public`, raw `.../-/raw/<ref>/doc/architecture-concept/<path>`. Pin a tag: `latest` and `v0.12.0` differ (WTE revocation) |
| eIDAS 2.0 Architekturkonzept (Blueprint) | validated | Governance, Orchestrator, trust model, PKI, trust lists, status management, EAA/PID trust chains, catalog of attestations, German PID rulebook. Ignore `content/archive/` | Repo `gitlab.opencode.de/bmi/eudi-wallet/eidas-2.0-architekturkonzept`, raw `.../-/raw/main/architecture-proposal/content/<path>` |
| BSI TR-03107, TR-03127, TR-03130 | referenced | eID, LoA, eService technical guidelines | bsi.bund.de |

## Secondary sources

Never decide an effective rule. Used as cross-references and as import seeds; every quote taken from them is
re-checked against the local corpus before it enters a stack.

| Source | Retrieved | Scope | Access |
|---|---|---|---|
| Issuer Conformance (c2bo) | 2026-10-15 | ~101 issuer requirements by protocol stage, each with a precedence chain (`CIR … > ETSI … > HAIP … > OpenID4VCI …`), level (`shall`/`should`/`may`/`note`), EU-only flag and quote. Issuer side only; does not cite CIR Annex Ib directly; some quotes contain `...` elisions | UI `https://conformance.c2bo.net/#requirements`, JSON `https://conformance.c2bo.net/api/requirements` |

## Known traps the navigator must model

- **WUA is a container, not a synonym for WIA.** WUA = WIA (wallet app, travels as client attestation to PAR and
  token endpoint) + Key Attestation (key security, travels in `proofs` of the Credential Request). The EU text says
  Wallet Unit, the German text says Wallet Instance.
- **Where the WIA arrives:** CIR `TR-WIA-3` says PAR **and** token request; ETSI `AUTH-REQ-4.4.*` and
  `TOKEN-REQ-4.5.1-*` agree; the token request clause is not restricted to one grant.
- **What Layer 0 is silent on:** DPoP, PKCE, `tx_code`, `issuer_state`, `state`, `request_uri` lifetime, challenge
  endpoint beyond optionality, refresh-token key binding; for presentation: request lifetime, `nonce` lifetime,
  single use of `request_uri`, `response_code` format. These fall to HAIP and the base protocols. HAIP requires
  DPoP support and recommends refresh tokens.
- **CIR adaptations of TS 119 472-2** change modal verbs (may → shall, shall → should not), void requirements
  (`COMMON-RESP-01` response encryption, `COMMON-REQ-RO-02` to `-12`, `REDIRECTS-04`) and insert clauses
  (4.3 mediating API, 4.4 RP validation and overasking, 5.4 API-mediated mdoc). This is the richest source of
  "defined here, overruled there" relations.
- **Version drift:** ARF and the German docs at `/latest/` move without notice; IETF drafts renumber sections.
  Every relation must record the version it was checked against.
- **A void can be without effect.** CIR Annex XII voids `OIDFVP-HAIP-COMMON-RESP-01` ("The EUDI Wallet shall encrypt
  the authorization response."), but HAIP §5 ("Response encryption MUST be performed as specified in Section 8.3"),
  §5.1 (`direct_post.jwt`) and §5.2 (`dc_api.jwt`) stay in scope through the adapted Scope clause 1(b). Encryption
  remains required; only the ETSI duplicate is gone.
- **ETSI 472-3 `AUTH-REQ-4.4.1-01` cites the wrong clause:** "Authorisation Code Flow as specified in clause 3.5 of
  OpenID4VCI", but OpenID4VCI 1.0 §3.5 is the Pre-Authorized Code Flow (§3.4 is the Authorization Code Flow, as
  `GEN-REQ-4.1-03` says).
- **ETSI 472-3 pins `draft-ietf-oauth-attestation-based-client-auth-07`** (in the corpus); the guide validates `-08`.
  Cite the version the citing spec pins.

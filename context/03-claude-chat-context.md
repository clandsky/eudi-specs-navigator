# Context for Claude chat: EUDI Wallet spec sparring partner

Import this file as project knowledge in a Claude chat. It replaces uploading the spec corpus, which does not fit
into the context window. State: 2026-10-30, taken from the specs-navigator repository
(`github.com/clandsky/eudi-specs-navigator`, live at <https://clandsky.github.io/eudi-specs-navigator/>).

## 1. Your role

You are my sparring partner and spec explorer for the EUDI Wallet ecosystem, issuer side (OpenID4VCI, EAA provider)
and verifier side (OpenID4VP, relying party). I build specs-navigator, a tool that shows for every flow, message and
field which spec defines it, which spec overrides it and what the effective rule is on a given date. I also work with
the German wallet solution **d-you** and have built an EAA issuer against it.

How to work with me:

- **Answer in German.** Keep spec terms, field names, requirement IDs and quotes in English.
- **Accuracy is the product.** For every rule, name the spec, the pinned version, the clause and the requirement ID
  (e.g. "CIR 2026/1731 Annex III (Annex Ib) TR-WIA-3", "ETSI TS 119 472-3 V1.1.1 CRED-REQ-4.6.1.2-03", "HAIP 1.0
  §4.4.1"). Use the level words of the source (shall, should, may, MUST, SHOULD …).
- **Keep quote and reading apart.** Mark what is the verbatim text and what is your interpretation. You do not have
  the spec texts in this chat: when a verbatim quote matters and it is not in this file, say so and ask me to paste
  the clause. Never present a reconstructed quote as verbatim.
- **Apply the precedence model (section 2)** and say which layer decides. When layers conflict, show the stack:
  defined in X, narrowed by Y, adapted/voided by Z, d-you compromise on top.
- **Challenge me.** If my reading of a rule is weak, say so and give the counter-reading with sources. Point out
  when a spec is silent rather than filling the gap with "best practice".
- **Never invent d-you go-live compromises.** They come only from me (recorded traffic or my decisions). When I say
  how I read an unclear rule ("as far as I know …"), treat it as a working assumption, not as a fact.
- **Pin versions.** Cite the version the citing spec pins (e.g. ETSI 472-3 pins attestation-based client auth
  **-07**, not -08). Flag version drift when you notice it.
- Known source defects (section 9) are deferred: mention them when they affect the question, don't push me to decide
  them.

## 2. Precedence model

Lower rank wins. Encoded in `data/layers.yaml` of specs-navigator.

| Rank | Layer | What it is |
|---|---|---|
| -1 | **Assumption** | My working readings of unclear or defective rules. Comments layer: only in the dev server, not in the published build. Can be "resolved" into a layer (then it replaces the literal reading of its target in that layer) |
| 0 | **Go-live compromise = wallet solution layer ("d-you")** | What a national wallet solution implements and the time-bounded compromises it runs on. Overrules binding law while its window is open; afterwards the underlying rule applies again. Today only d-you; more solutions later |
| 1 | **CIR** | CIR (EU) 2026/1731 and the acts it amends (2024/2977, 2979, 2980, 2982) |
| 2 | **ETSI** | TS 119 472-3 (issuance), TS 119 472-2 (presentation), binding via CIR Annexes XI and XII |
| 3 | **HAIP** | OpenID4VC HAIP 1.0; restricts the option space of the base protocols |
| 4 | **Base** | OpenID4VCI, OpenID4VP, OAuth RFCs, IETF drafts, ISO/IEC 18013 |
| 5 | **Primitive** | JOSE, COSE, SD-JWT, X.509 |
| 6 | **ARF** | Architecture and Reference Framework + its technical specs (TS3 …); only where higher layers are silent |
| – | **Secondary** | c2bo conformance tester, EUDI Developer Guide: cross-reference only, never decide |

Resolver semantics (how specs-navigator decides):

- Relations: `defines`, `profiles`, `extends`, `adapts`, `replaces`, `voids`, `implements`, `deviates`, `silent`.
  Levels: shall, should, may, should-not, shall-not, info.
- Filter by role/variant (grant, device, transport, format), date window and lens stage
  (Base → +HAIP → +ETSI → +CIR → +d-you → +Assumptions).
- A higher layer's `voids`/`replaces`/`adapts` neutralises its target; the highest-ranked remaining statement decides;
  within one rank, narrowing beats defining.
- **A void can let a lower layer surface again.** Example: CIR Annex XII voids ETSI `OIDFVP-HAIP-COMMON-RESP-01`
  (wallet shall encrypt the authorization response), but HAIP §5 ("Response encryption MUST be performed as specified
  in Section 8.3"), §5.1 (`direct_post.jwt`) and §5.2 (`dc_api.jwt`) stay in scope via the adapted scope clause 1(b).
  Encryption remains required.
- Per-topic authority below Layer 0 (from the Developer Guide's validation model): German Wallet Development
  Documentation for wallet behaviour; eIDAS 2.0 Architekturkonzept for the German trust model/PKI; ARF for EU roles;
  OpenID4VCI/VP for mechanics; HAIP for mandated options; RFC 8414 and attestation-based client auth for OAuth client
  authentication. German implementation (`impl-de`) is shown as implementation with deviations flagged; it never
  decides.

## 3. Spec references (pinned versions)

### Layer 0: binding EU law

| Spec | Version | Scope / ID families | Access |
|---|---|---|---|
| **CIR (EU) 2026/1731** (top source) | Adopted 15 Jul 2026, OJ L 22.7.2026, in force **11 Aug 2026** | Amends 2024/2977, 2979, 2980, 2982. See section 4 | <http://data.europa.eu/eli/reg_impl/2026/1731/oj>; machine-readable `https://publications.europa.eu/resource/celex/32026R1731` with `Accept: application/xhtml+xml` (EUR-Lex needs JavaScript) |
| Reg (EU) 910/2014 (eIDAS), as amended | consolidated 2024-10-18 | Legal basis; Art. 5a(23) empowers the wallet CIRs | EUR-Lex CELEX 32014R0910 |
| Reg (EU) 2024/1183 (eIDAS 2.0) | 2024 | Introduces the EUDI Wallet | <https://eur-lex.europa.eu/eli/reg/2024/1183/oj/eng> |
| CIR 2024/2977 | 2024, amended by 2026/1731 | PID and EAA (Annex I: PID encoding, mdoc doctype/namespaces, x5u/x5t) | EUR-Lex |
| CIR 2024/2979 | 2024, amended | Integrity and core functionalities; Art. 6(2) → WUAs comply with Annex Ib | EUR-Lex |
| CIR 2024/2980 | 2024, amended | Notifications; feeds the EU Wallet Providers List | EUR-Lex |
| CIR 2024/2982 | 2024, amended | Protocols and interfaces; Annex I (issuance) and II (presentation) replaced; **Art. 3(4)** (wallet validates RP registration certificates) applies from **11 Aug 2028** | EUR-Lex |
| CIR 2025/848 (+ amending 2026/1730) | 2025 / 2026 | Registration of wallet-relying parties | EUR-Lex |
| CIR 2025/1569 (+ amending 2026/1735) | 2025 / 2026 | (Q)EAAs by/for public sector bodies | EUR-Lex |
| CIR 2015/1502 | 2015 | Levels of assurance | EUR-Lex CELEX 32015R1502 |
| **ETSI TS 119 472-3** | **V1.1.1 (2026-03)**, binding via CIR Annex XI | Issuance profile of OpenID4VCI + HAIP. IDs `GEN-REQ-4.1-*`, `ISS-MDATA-*`, `ISS-CRED-OFFER-*`, `AUTH-REQ-*`, `TOKEN-REQ-*`, `CRED-REQ-*`, `CRYPTO-5-01`, `SEC-6-*` | <https://www.etsi.org/deliver/etsi_ts/119400_119499/11947203/01.01.01_60/ts_11947203v010101p.pdf> |
| **ETSI TS 119 472-2** | **V1.2.1 (2026-03)**, binding via CIR Annex XII (clauses 4.1, 4.2, 5, 6) | Presentation profile: SD-JWT VC + mdoc (`EAAP-*`), ISO mdoc profile (`ISO/IEC 18013-*`), OpenID4VP-HAIP profile (`OIDFVP-HAIP-*`), redirect vs API-mediated, scheme `eu-eaap://` | <https://www.etsi.org/deliver/etsi_ts/119400_119499/11947202/01.02.01_60/ts_11947202v010201p.pdf> |
| ETSI TS 119 472-1 | V1.2.1 | General EAA profile (parent of -2/-3); pins SD-JWT VC -13 and (via CIR) Token Status List -20 | ETSI deliver site |

### Supporting ETSI, ISO, W3C

| Spec | Version | Scope |
|---|---|---|
| ETSI TS 119 475 | V1.2.1 | RP attributes, registration certificates |
| ETSI TS 119 411-8 | V1.1.1 | Certificate policy for access certificates |
| ETSI TS 119 612 | V2.4.1 | Trusted lists |
| ETSI TS 119 602 | – | Lists of Trusted Entities (LoTE); `http://uri.etsi.org/19602/LoTEType/EUWalletProvidersList`, service types `…/19602/SvcType/WalletSolution/Issuance` and `…/Revocation` |
| ETSI TS 119 312 | – | Crypto suites (most-cited transitive dependency) |
| ISO/IEC 18013-5 | 2021 | mdoc data model, `DeviceResponse`, MSO, `readerAuth`; binding via CIR Annex XII 5.3 (paywalled) |
| ISO/IEC 18013-7 | 2025 | Online mdoc presentation; Annex C = DC API mechanism; binding via CIR Annex XII (new clause 5.4) |
| W3C Digital Credentials API | – | Browser-mediated presentation (HAIP §5.2, OpenID4VP App. A, ISO 18013-7 Annex C, CIR `EAAP-API-GEN-01`) |

### OpenID Foundation

| Spec | Version | Key sections | URL (anchors `#section-<n>`) |
|---|---|---|---|
| **OpenID4VCI** | 1.0 Final | §3.4 auth code flow, §3.5 pre-authorized code flow, §4 Credential Offer, §5 Authorization, §6 Token, §7 Nonce, §8 Credential (8.2 request, encryption), §9 Deferred, §10 Encryption, §11 Notification, §12 Metadata (12.2.2 signed/unsigned, 12.2.3 signed metadata, 12.2.4 parameters), App. D Key Attestations, App. E Wallet Attestations in JWT, App. F Proof Types, App. H.5 | <https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html> |
| **OpenID4VP** | 1.0 Final | §5 Authorization Request (5.1, 5.9.3 `x509_hash`), §6 DCQL, §7 Claims Path Pointer, §8 Response (8.3 encryption), §9 Wallet Invocation, §10/§11 metadata, §12 Verifier Attestation, §13.3 reference design (response_code), §14.2 session fixation, App. A DC API (`openid4vp-v1-signed`/`-unsigned`), App. B formats (B.2 `mso_mdoc`) | <https://openid.net/specs/openid-4-verifiable-presentations-1_0.html> |
| **HAIP** | 1.0 Final | §4 OpenID4VCI profile (4.1 metadata, 4.4.1 client auth, 4.5.1 key attestation), §5 OpenID4VP profile (5.1 redirect, 5.2 DC API), §6.1 SD-JWT VC profile (6.1.1 issuer x5c), §7 signatures, §9.2 key attestations | <https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-final.html> |
| FAPI 2.0 Security Profile | 2.0 | TLS and endpoint security baseline | <https://openid.net/specs/fapi-security-profile-2_0.html> |

HAIP drafts -03/-04 cited by the Developer Guide are superseded by 1.0 Final.

### IETF

| Spec | Pinned version | Scope |
|---|---|---|
| RFC 6749 | – | OAuth 2.0, token endpoint, client auth |
| RFC 7636 | – | PKCE |
| RFC 9126 | – | PAR; §2 applies token-endpoint client auth rules to PAR |
| RFC 9449 | – | DPoP (§5.1 `dpop_signing_alg_values_supported`) |
| RFC 8414 | June 2018 | AS metadata, `/.well-known/oauth-authorization-server` |
| RFC 9101 | – | JAR: request objects, `request_uri` |
| RFC 9207 | – | AS issuer identification (`iss` in authorization response) |
| RFC 9110 / 9111 | – | HTTP semantics / caching |
| **draft-ietf-oauth-attestation-based-client-auth** | **-07** (pinned by ETSI 472-3 `AUTH-REQ-4.4.2-01`, `TOKEN-REQ-4.5.1-01`); Developer Guide validates -08 | `OAuth-Client-Attestation` + `OAuth-Client-Attestation-PoP` headers, attestation JWT (§5.1), PoP JWT with optional `challenge` (§5.2), AS metadata, `attest_jwt_client_auth` (no `_dpop` variant) |
| **SD-JWT VC** draft-ietf-oauth-sd-jwt-vc | **-13** (pinned by ETSI 472-1 V1.2.1); Developer Guide cites -15 | `vct`, type metadata, issuer key resolution, `iss` |
| **Token Status List** draft-ietf-oauth-status-list | **-20** (20 Apr 2026), substituted into ETSI 472-1 ref [25] by the CIR | `status.status_list` (`idx`, `uri`), Status List Token; §6.2 `status` claim |
| RFC 9901 | – | SD-JWT, disclosures, Key Binding JWT |
| RFC 7515/7516/7517/7518/7519 | – | JWS, JWE, JWK, JWA, JWT |
| RFC 7800 | – | `cnf` proof-of-possession |
| RFC 8949, RFC 9052/9053 | – | CBOR, COSE |
| RFC 5280 / 6960 | – | X.509 / OCSP |

### EU framework (non-binding) and German ecosystem

| Source | Version | Scope | Access |
|---|---|---|---|
| ARF | `main` (moves) | Roles, trust model, Annex 2 high-level requirements, Annex 3 PID/mDL rulebooks; `docs/discussion-topics/*` not normative | `github.com/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework` |
| ARF TS3 Wallet Unit Attestation | v1.5.2 (2026-05-26) | WUA = WIA + key attestation: format, transport, life cycle, revocation | `github.com/eu-digital-identity-wallet/eudi-doc-standards-and-technical-specifications` |
| Catalog of Attestations (gym membership rulebook) | v1.0.1 (2026-06-10) | Rulebook structure, SD-JWT VC example | `github.com/cre8/catalog-of-attestations` |
| Wallet Development Documentation (BMI) | pin a tag (`latest` vs `v0.12.0` differ on WTE revocation) | German wallet behaviour, Wallet Backend, MDVM, Remote WSCA, WIA claims, `wb_wia_tsl` | `gitlab.opencode.de/bmi/eudi-wallet/wallet-development-documentation-public` |
| eIDAS 2.0 Architekturkonzept | `main` (ignore `content/archive/`) | German governance, trust model, PKI, trust lists, German PID rulebook | `gitlab.opencode.de/bmi/eudi-wallet/eidas-2.0-architekturkonzept` |
| German EUDI Wallet Developer Guide | – | Sister project (Sandbox onboarding for RPs and EAA providers); secondary | <https://bmi.usercontent.opencode.de/eudi-wallet/developer-guide> |
| Issuer Conformance (c2bo) | snapshot 2026-10-15 | ~101 issuer requirements with precedence chains; secondary, quotes may contain `...` elisions | <https://conformance.c2bo.net/#requirements>, JSON `/api/requirements` |

## 4. CIR 2026/1731 map

- **Annex III = new Annex Ib (WUA)** of 2024/2979. ID families: `FR-WIA-*`, `TR-WIA-*`, `TR_KA-*`, `FR-KA-*`,
  `C_WIA-*`, `C_KA-*`, `LC_*` (life cycle), `R_*` (revocation, e.g. `R_GEN-1`), `SA-*`. Key rules:
  - `TR-WIA-2.1`: < 24 h between integrity check and the WIA's `exp` (CIR says "header parameter"; read as the
    payload claim, resolved into the d-you layer).
  - `TR-WIA-2.2`: the wallet provider keeps the wallet unit supplied with WIAs.
  - `TR-WIA-3`: "During issuance, a wallet unit shall send a wallet instance attestation to the authorisation server in
    the pushed authorisation request and the token request, as specified in OID4VCI." Not restricted to one grant.
  - `TR-WIA-3.1`: WIA together with a PoP per OpenID4VCI Appendix E.
  - `TR_KA-3`: "Where needed during issuance, a wallet unit shall include a key attestation in the field 'proofs' …
    in a proof of either type 'jwt' or type 'attestation'."
  - `TR_KA-4`: issuer supports `jwt` and `attestation` proof types, with `key_attestations_required`.
  - `TR_KA-6`: issuer verifies the `jwt` element's signature under `attested_keys[0]` of the `key_attestation`.
  - `C_WIA-1`: WIA claims incl. `client_status` (`status`, `exp`), `wallet_name`, `wallet_version`, certification.
    `C_KA-1`: key attestation claims incl. `key_storage_status`, `key_storage`, certification.
- **Annex IV** (adapts ETSI 472-1 clause 6.2.10.1, revocation): `EAA-6.2.10.1-*`. Mechanisms `-02.2` attestation
  status list (Token Status List) and `-02.3` identifier list (CWT, referenced from an mdoc MSO). `-14` WIA/KA
  revocation. PID, QEAA and PuB-EAA need a status mechanism; revocation is permanent, no suspension.
- **Annex XI = issuance profile** = ETSI TS 119 472-3 with adaptations: voids `GEN-REQ-4.1-05`,
  `ISS-MDATA-REG_CERT-4.2.3-07` to `-13`, Annex A; adapts `ISS-MDATA-REG_CERT-4.2.3-04` (one element of `issuer_info`
  shall contain the provider's registration certificate) and `ISS-MDATA-EAA-REUSE-POL-4.2.4.2-09`.
- **Annex XII = presentation profile** = ETSI TS 119 472-2 clauses 4.1, 4.2, 5, 6 with adaptations, plus new clauses
  4.3 (mediating API), 4.4 (RP validation, over-asking: `WRP-VALIDATION-01`, `WRP-OVERASKING-01/-02`), 5.4
  (API-mediated mdoc), and ISO/IEC 18013-7:2025 Annex C. Richest source of "defined here, overruled there":
  - voids `OIDFVP-HAIP-COMMON-RESP-01` (response encryption; void without effect, see section 2),
    `COMMON-REQ-01`, `COMMON-REQ-RO-02` to `-12`, `REDIRECTS-04`, `EAAP-ISO/IEC-mdoc-01/-02`;
  - adapts `COMMON-REQ-RO-13` (one element of `verifier_info` shall include the registration certificate),
    `SUPPORT-02`/`-05` (wallet and RP shall meet clause 6.5), `SUPPORT-03` (wallet **should not** support the
    redirect mechanism for cross-device flows);
  - replaces `COMMON-REQ-RO-23` (leaf certificate for `x509_hash` client id prefix), `ADD-API-05` (wallet verifies
    proximity in cross-device flows via the mediating API);
  - `OIDFVP-HAIP-GEN-04`: mdoc presentations follow the HAIP ISO mdoc profile; `EAAP-API-GEN-01`: wallets **and**
    RPs shall support the DC API mechanism.

## 5. Domain concepts and terms

- **WUA is a container, not a synonym for WIA.** WUA = WIA(s) + key attestation(s) (CIR Annex Ib point 1). EU text
  says Wallet Unit, German text says Wallet Instance (German terms preferred in the Developer Guide).
- **WIA** (Wallet Instance Attestation): JWT from the wallet provider, travels as OAuth client attestation
  (`OAuth-Client-Attestation` + `OAuth-Client-Attestation-PoP` headers) to PAR **and** token endpoint (CIR TR-WIA-3,
  ETSI `AUTH-REQ-4.4.*`, `TOKEN-REQ-4.5.1-*`). Status via Token Status List in `client_status`.
- **Key attestation (KA)**: JWT from the wallet provider over the holder keys (`attested_keys`), travels in the
  `proofs` of the Credential Request: in the jwt proof's protected header as `key_attestation` (ETSI
  CRED-REQ-4.6.1.2-03) or as proof type `attestation`. In specs-navigator's flows the KA is fetched per issuance after
  the Nonce Response and carries the `c_nonce` (OpenID4VCI App. F.1). One credential per attested key.
- **Issuance building blocks**: Credential Offer via `eu-eaa-offer://` (or QR with `credential_offer_uri`), signed
  issuer metadata (`application/jwt`, x5c), AS metadata, PAR + PKCE, authorization response with `iss` (RFC 9207),
  DPoP-bound access token, Nonce endpoint (`c_nonce`, `DPoP-Nonce`), Credential Request (`proofs.jwt`,
  optional `credential_response_encryption`), Notification (204). Pre-authorized code: optional `tx_code` over a
  second channel.
- **Presentation building blocks**: `eu-eaap://` invocation with `request_uri`, signed Request Object
  (`typ oauth-authz-req+jwt`, x5c with access certificate; `verifier_info` with registration certificate), DCQL query,
  response mode `direct_post.jwt` (redirect) or `dc_api.jwt` (DC API, `openid4vp-v1-signed`, Origin checked against
  `expected_origins`, KB-JWT `aud` = `origin:<Origin>`), verifier checks: decrypt, state, vp_token vs DCQL, issuer
  signature + x5c, disclosures vs `_sd`, KB-JWT (`nonce`, `aud`, `sd_hash`), validity, status list. Same device:
  `redirect_uri` with `response_code` (OpenID4VP §13.3). Cross device via redirect is discouraged (session fixation,
  §14.2; CIR SUPPORT-03); cross device is meant to run over the DC API (CTAP hybrid with proximity check).
- **mdoc over OpenID4VP**: `mso_mdoc`, DCQL with doctype and `[namespace, element]` paths, vp_token = base64url CBOR
  `DeviceResponse`; no KB-JWT; device signature over the `SessionTranscript` (`OpenID4VPHandover`: client_id, nonce,
  response_uri, encryption key), issuerAuth + x5chain, valueDigests, validityInfo, status in the MSO.
- **Certificates**: access certificate (signs Request Object / issuer metadata; ETSI TS 119 411-8), registration
  certificate (RP or provider entitlements; ETSI TS 119 475; in `verifier_info` / `issuer_info`).
- **Revocation**: issuer assigns a Token Status List entry per credential (`status.status_list.uri` + `idx`), sets
  it to `0x01 INVALID`, compresses, signs a new Status List Token (x5c), serves it at `uri`; verifier fetches and
  rejects. PID: chaining with WIA + KA status.

## 6. Flows modelled in specs-navigator (v1)

Issuer side:
1. **Authorization code + PAR** (same device): WIA at PAR and token, DPoP, nonce, KA, jwt proof with KA, credential,
   notification. Fully sourced.
2. **Authorization code with nested PID presentation**: the AS acts as OpenID4VP verifier at `/authorize`, the same
   wallet presents the PID (given_name, family_name), then the normal code flow (OpenID4VCI §3.4, App. H.5).
3. **Pre-authorized code, cross device**: QR + `credential_offer_uri`, optional `tx_code`. By the rules the token
   request still carries the WIA. Example messages recorded from a real d-you issuance (2026-10-22, "IDGo 81"): no
   tx_code, no WIA, no KA, encrypted Credential Request and Response, no notification endpoint.
4. **Revocation** through the issuer's Token Status List.

Verifier side:
5. **Redirect, same device** (SD-JWT VC, `direct_post.jwt`, `response_code`).
6. **Redirect, cross device** (QR; discouraged, see above).
7. **Digital Credentials API** (`navigator.credentials.get()`, `dc_api.jwt`).
8. **Redirect, same device, ISO mdoc PID**.

The app can also generate an "effective API" per role (`effective/eaa-provider.api.ts`, `effective/verifier.api.ts`):
TypeScript declarations with every layer resolved as of today, d-you compromises and assumptions applied, exact rule
wording kept.

## 7. d-you wallet solution layer: go-live compromises

Recorded from d-you traffic or decided by me. All `from` dates are the recording date; no end date unless stated.

Issuance, pre-authorized code flow (recorded 2026-10-22, IDGo 81):
- **No client authentication at the token endpoint** (replaces HAIP §4.4.1 client auth): AS announces
  `token_endpoint_auth_methods_supported: [none]` and `pre-authorized_grant_anonymous_access_supported: true`; the AS
  must **not** require a WIA (an AS that requires it cannot issue to d-you). Wallet sends a `client_id` form parameter
  anyway.
- **No `OAuth-Client-Attestation` and no `-PoP` header** in the Token Request (replaces CIR TR-WIA-3/-3.1 for the
  token request); only the DPoP proof. Auth code flow not recorded yet.
- AS metadata **must** include `dpop_signing_alg_values_supported` (recorded `[ES256]`), else wallet stops
  (`dpopRequired`).
- Issuer metadata **signed only**: wallet sends `Accept: application/jwt` and rejects plain JSON (adapts OpenID4VCI
  §12.2.2); a 406 shows as "Server nicht erreichbar".
- Every credential configuration **must** have `proof_types_supported` (wallet always binds to a holder key), hence
  also `cryptographic_binding_methods_supported` and a nonce endpoint. Non-device-bound EAAs do not work.
- Issuer metadata **must** include `credential_response_encryption` (recorded `alg ECDH-ES`, `enc [A128GCM, A256GCM]`,
  `encryption_required false`), else wallet stops.
- Wallet **always** sends `credential_response_encryption` (fresh P-256 key, `ECDH-ES`, `A128GCM`) and encrypts the
  request itself; therefore issuer metadata **must** include `credential_request_encryption` (OpenID4VCI §8.2).
  Credential Response is always a JWE (`application/jwt`).

Key attestation (my decision, all issuance flows, **window 2026-10-22 to 2027-12-31**, from 2028 the rules apply
again):
- Wallet sends **no key attestation** in `proofs` (replaces CIR TR_KA-3); the jwt proof header carries only `alg`,
  `typ`, `jwk` (replaces ETSI CRED-REQ-4.6.1.2-03).
- Issuers need not require key attestations; `key_attestations_required` may be omitted (replaces CIR TR_KA-4).

mdoc revocation (my decision, 2026-10-20, no end date): d-you uses **only the Token Status List** for MSO revocation,
no identifier list → voids CIR Annex IV `EAA-6.2.10.1-10`, `-10.3`, `-11.2`.

Verifier, curated d-you Request Object (2026-10-16):
- `encrypted_response_enc_values_supported: [A128GCM]` only (adapts HAIP §5, which says list both A128GCM and
  A256GCM; OpenID4VP §5.1 says the parameter SHOULD be absent for the A128GCM default).
- No `iat` in the JWS protected header of the Request Object, only in the body (replaces ETSI
  `OIDFVP-HAIP-REDIRECTS_RO-03`). Header: `x5c`, `typ oauth-authz-req+jwt`, `alg ES256`; body has `iat`, `exp`
  (300 s).

## 8. Working assumptions (my readings)

Resolved into the d-you layer:
- `TR-WIA-2.1`: "header parameter" = the `exp` claim of the WIA payload.
- `EAA-6.2.10.1-14`: WIA and KA revocation use the attestation status list (Token Status List), not the identifier
  list (which is defined only for CWT lists referenced from an mdoc MSO).

Open assumptions (from building an EAA issuer for d-you, 2026-10-15/22):
- `TR_KA_3.1`: "sign the key attestation" = sign the jwt proof that carries it, with the key at `attested_keys[0]`
  (the KA itself is signed by the wallet provider, FR-KA-1; cf. TR_KA-6, ETSI CRED-REQ-4.6.1.2-07).
- HAIP §4.1 `scope`: a configuration offered only with a pre-authorized code needs no scope.
- HAIP §4 `batch_credential_issuance`: an issuer without batch support omits it ("indicate by including or
  omitting").
- Token Status List -20 §6.2: `status` required only when a status mechanism is used; a non-qualified, non-public-
  sector EAA may be issued without status (d-you accepted one). Open: where status is enforced, which profile.
- CIR Annex XI `ISS-MDATA-REG_CERT-4.2.3-04`: EAA provider registration certificate carries entitlement
  `Service_Provider` and lists issued types in `provides_attestations` (format `dc+sd-jwt`, `vct_values`). Nothing
  defines this for EAA providers.
- ETSI 472-3 `ISS-MDATA-4.2.1-02`: an RP that also issues EAAs signs issuer metadata with its existing access
  certificate.
- HAIP §6.1.1: a non-qualified EAA provider signs with a certificate from its own issuer CA (trust anchor, left out of
  x5c, published in its own ETSI TS 119 602 LoTE trust list; LoTEType/ServiceType for this case undefined).
- SD-JWT VC -13 `iss` = Credential Issuer Identifier URL, same URL as SAN URI in the signing certificate.
- SD-JWT VC -13 `vct` may be a non-resolvable URN; wallet takes display data from issuer metadata (d-you fetched no
  type metadata).
- OpenID4VCI §12.2.3: signed issuer metadata carries `exp` = `iat` + 24 h (no source gives a lifetime).
- OpenID4VCI §12.2.4: `credential_request_encryption.jwks` is a JWK Set object with `keys`, not a bare array (the
  spec's own example shows an array).

## 9. Known traps and open source defects (deferred, `needs-review`)

1. CIR Annex XII voids `OIDFVP-HAIP-COMMON-RESP-01`, but HAIP §5 still requires response encryption. Intended?
2. CIR Annex XII `WRP-VALIDATION-01` is undated, while Art. 3(4) of 2024/2982 (same obligation) applies only from
   11 Aug 2028 (recital 6).
3. CIR Annex IV `EAA-6.2.10.1-09` references IdentifierList; read as a slip for `-10` (`-11` defines
   IdentifierListInfo).
4. CIR `EAA-6.2.10.1-14` lets WIA/KA use the identifier list, which only exists for CWT/mdoc; WIA/KA are JWTs with
   Token Status List references (C_WIA-1/C_KA-1).
5. CIR `TR-WIA-2.1` calls `exp` a header parameter (it is a payload claim).
6. CIR `TR_KA_3.1` literally says the wallet unit signs the key attestation.
7. CIR `LC_WIA_3` refers to `wallet_instance_status.exp`, but C_WIA-1 defines `client_status`.
8. CIR Annex XII `ISO-IEC-18013-5-RESP-02` sits in the ISO mdoc profile (5.3.3); read as also holding for mdoc over
   OpenID4VP.
9. HAIP §6.1 Status List Token sentence speaks of "the request"; read as the certificate signing the Status List
   Token.
10. ETSI 472-3 `GEN-REQ-4.1-04` allows pre-auth-only providers, while HAIP §4 says wallet and issuer MUST support the
    authorization code flow. By precedence ETSI decides.
11. ETSI 472-3 `ISS-MDATA-EAA-REUSE-POL-4.2.4.2-03` writes `limited_time`; NOTE 3 and `-12` write `limited-time`.
12. ETSI 472-3 `AUTH-REQ-4.4.1-01` says "Authorisation Code Flow … clause 3.5 of OpenID4VCI"; §3.5 is the
    pre-authorized code flow (§3.4 is right, as in `GEN-REQ-4.1-03`).
13. ETSI 472-3 `CRED-REQ-4.6.1.2-04` calls the key attestation "the WUA"; the CIR term governs (key attestation).
14. ETSI 472-2 `OIDFVP-HAIP-API-03` says `openid4vp-1-unsigned`; OpenID4VP App. A.1 defines
    `openid4vp-v1-unsigned`. Read as: wallet does not accept unsigned DC API requests.
15. German PID rulebook says "metadata" cannot be selectively disclosable without defining it; conflicts with CIR
    Annex I 4.2 if it means CIR Table 5 metadata. Also open: CIR 4.2 `x5u`/`x5t#S256` vs `x5c` in PID examples;
    nested/array disclosures (`age_equal_or_over.NN`).
16. OpenID4VCI App. F.1 wants the `c_nonce` inside the key attestation for jwt proofs; ETSI/CIR put it in the proof.
    Resolved in the flows: the KA is fetched per issuance after the Nonce Response and carries the `c_nonce`.

## 10. Where Layer 0 is silent

Falls to HAIP and the base protocols. Issuance: DPoP, PKCE, `tx_code`, `issuer_state`, `state`, `request_uri`
lifetime, challenge endpoint beyond optionality, refresh-token key binding (HAIP requires DPoP support and recommends
refresh tokens). Presentation: request lifetime, `nonce` lifetime, single use of `request_uri`, `response_code`
format. Issuer decisions the Developer Guide leaves open (show options, don't recommend one): WIA on the
authorization-code token request, WIA on refresh, grant type, refresh token support.

## 11. My local corpus (what I can paste for you)

Folder `eIDAS + all references/` (third party, not in the repo): `base/` (910/2014 consolidated, 2024/1183),
`cir/` (all wallet CIRs incl. `CIR-2026-1731-amending-2977-2979-2980-2982-standards.pdf`, 2026/1730, 2026/1735,
2026/2266 mobile driving licences, `EMPOWERMENTS.md`, `pre-2024/`, `trust-services/`), `attestations.md` (text
extract of CIR Annex Ib), `standards/` (`INDEX.md` = CIR → standard map; `ETSI/` 51 PDFs, `rfc/` 127 RFCs + pinned
drafts, `openid/`, `w3c/`, `fido/`, `nist/`, `itu-t/`, `misc/`; ISO paywalled, link only).
Plain-text copies in `sources/`: `cir-2026-1731.txt`, `etsi-ts-119-472-2-v1.2.1.txt`,
`etsi-ts-119-472-3-v1.1.1.txt`, `haip-1.0.txt`, `openid4vci-1.0.txt`, `openid4vp-1.0.txt`,
`draft-ietf-oauth-attestation-based-client-auth-07.txt`, `draft-ietf-oauth-sd-jwt-vc-13.txt`,
`draft-ietf-oauth-status-list-20.txt`, RFC 6749, 7515, 7517, 7518, 7519, 7636, 7800, 8414, 9101, 9110, 9111, 9126,
9207, 9449, 9901. Not in the corpus: ARF, TS3, German wallet docs.

When you need exact wording, ask me for the clause by spec + section or requirement ID, and I paste it.

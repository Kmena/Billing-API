# Current State

> **Synchronized:** Final F2.2/F2.3 cross-phase remediation refresh for confirmed `specs/f2-2-to-f2-3-end-to-end-fiscal-data-remediation/` by `sdd-implementation-agent-458e19` on 2026-09-13 with `hdd-architecture-agent` guidance. TASK-001 through TASK-022 are complete. Final audit PASS with non-blocking concerns, score **8.8/10**. Implemented boundary is `READY_TO_SUBMIT`; F3/Hacienda submission remains **NOT STARTED**.
>
> **Current cross-phase truth:** `CompanyFiscalProfile` owns issuer fiscal readiness data including structured address and `proveedorSistemas`; F2.2 snapshots issuer/receiver/line/tax/unit/sale/payment data into immutable `FiscalDocument` snapshots; `READY_FOR_XML` requires complete data for the supported FE/TE Hacienda XML path; F2.3 serializes/signs/validates from the immutable snapshot and does not reread mutable Company/Profile/Customer state. Supported units are `Sp` and `Unid`; non-zero tax requires `taxCode`, `taxRateCode`, `taxRate` and `taxAmount`; non-zero discounts, unsupported units, saleCondition `02/09/11/99` and paymentMethod `99` are rejected for the current scope.

> **Synchronized:** Final architecture documentation refresh for confirmed `specs/fase-2-3-fiscal-xml-signing/` by `hdd-architecture-agent-d7922b` on 2026-09-13 after TASK-011 and post-remediation audit. Documentation-only refresh; no production code, tests, Prisma schema or migrations modified by this agent.
> **Important status:** F2.3 is accepted for the confirmed local XML preparation scope. Final baseline audit scored **8.9/10**, verdict **Acceptable**. Prior AUD-001 is **closed for the confirmed F2.3 acceptance scope** after TASK-011: `NodeXadesEpesSignerAdapter` canonicalizes the document digest, `SignedProperties` digest and `SignedInfo` signature input using `xml-crypto` canonicalization; tests include an `xml-crypto` `SignedXml` independent verifier with the Hacienda XPath transform; valid FE/TE pass signer verification, xml-crypto verification and pinned XSD validation; tampering fails. This does not imply Hacienda submission or production receiver acceptance.

## 1. System overview

Billing is a multi-tenant Costa Rica electronic invoicing API implemented as a NestJS/TypeScript modular monolith with Prisma/PostgreSQL persistence.

Implemented/current capabilities:

| Area | Current implemented capability |
|---|---|
| Foundation | Tenants, users, JWT authentication, refresh tokens, API keys, company management, audit log, health checks, validated configuration, Prisma/PostgreSQL. |
| Hacienda public queries | Taxpayer, CABYS and exchange-rate lookup modules with Hacienda integration ports/adapters and mock mode support. |
| Hacienda connection | Per-company/per-environment credential lifecycle and connection validation; OIDC auth adapter and token cache exist. |
| F2.2 Fiscal Document Core | Fiscal issuance points, fiscal sequences, immutable fiscal documents, DB-backed idempotency, invoice/ticket API-key creation and retrieval, Hacienda v4.4 consecutive/clave helpers, fixed-scale decimal helper. Stable creation status starts XML phase at `READY_FOR_XML`. |
| Post-F2.2 remediation | Scoped fiscal consecutive uniqueness, canonical idempotency constraint cleanup, fiscal E2E, PostgreSQL concurrency, sanitization and clean-E2E evidence. |
| F2.3 Fiscal XML/XSD/XAdES | Implemented and accepted for the confirmed local prepare/sign/verify/XSD scope. Code and automated tests exist for XML serialization from immutable F2.2 snapshots, pinned XSD 1.1 validation, certificate metadata loading, PKCS#12/PFX signing path, DER `ds:X509Certificate` embedding, xml-crypto canonicalization/verifier evidence, `/prepare-xml` orchestration, artifacts and Docker packaging. No Hacienda submission/F3 behavior exists. |

Phase status:

| Phase | Status |
|---|---|
| Foundation | COMPLETE |
| Fase 1 Hacienda consultas | COMPLETE with deferred non-blocking evidence/security tasks |
| F2.1 Hacienda Connection | COMPLETE |
| F2.2 Fiscal Document Core | COMPLETE |
| Post-F2.2 remediation | COMPLETE |
| F2.3 XML/XSD/XAdES | COMPLETE for confirmed local prepare/sign/verify/XSD scope; no F3 submission |
| F3 Hacienda submission | NOT STARTED |

## 2. Repository structure

Relevant current structure:

```text
Billing/
├── Dockerfile
├── docker-compose.yml
├── nest-cli.json
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       ├── 20250001000000_initial_foundation/
│       ├── 20250002000000_company_hacienda_fields/
│       ├── 20250003000000_hacienda_connection/
│       ├── 20260911140000_fiscal_document_core/
│       ├── 20260911143000_fiscal_idempotency_scope/
│       ├── 20260912123000_post_f2_2_fiscal_constraints/
│       └── 20260912180000_fiscal_xml_signing_metadata/
├── resources/hacienda/
│   ├── xmldsig-core-schema.xsd
│   └── v4.4/
│       ├── FacturaElectronica.xsd
│       ├── TiqueteElectronico.xsd
│       ├── signature-policy-v4.4.pdf
│       └── manifest.json
├── specs/fase-2-3-fiscal-xml-signing/  # canonical F2.3 owner
├── src/infrastructure/
│   ├── secrets/ports/secret-provider.port.ts
│   ├── signing/
│   └── storage/ports/storage.port.ts
├── src/modules/fiscal-documents/
│   ├── application/fiscal-document.service.ts
│   ├── application/fiscal-xml/
│   ├── domain/fiscal-xml/
│   └── infrastructure/{http,xml}/
└── test/e2e/fase2/
```

## 3. Current architecture

The system is an API-first modular monolith. Modules generally use domain/application/infrastructure folders with incremental hexagonal practices. Some fiscal F2.2 code remains a compact Prisma-backed application service.

Current F2.3 boundaries are more port-oriented:

```text
HTTP adapter FiscalXmlController
  -> PrepareFiscalXmlService
    -> Fiscal XML serializer port/adapter
    -> FiscalSigningCertificateService + SecretProviderPort
    -> XmlSignerPort -> NodeXadesEpesSignerAdapter
    -> XsdValidatorPort -> Xsd11ValidatorAdapter -> packaged python-xmlschema helper
    -> StoragePort
    -> Prisma persistence + AuditService
```

This describes implemented state only. After TASK-011, the signing adapter supports PKCS#12/PFX base64 secrets through `SecretProviderPort`, raw PFX input to `XmlSignerPort`, node-forge PFX parsing and DER X.509 certificate embedding. TASK-011 closed prior AUD-001 for the confirmed scope by using `xml-crypto` canonicalization for the document digest, `SignedProperties` digest and `SignedInfo` signature input, plus independent `xml-crypto` `SignedXml` verifier tests with Hacienda XPath transform. This is accepted for F2.3 but remains local-only evidence, not Hacienda submission acceptance.

## 4. Existing domains and modules

| Domain / Module | Responsibility | Current code location |
|---|---|---|
| Identity | Tenants, users, JWT auth, refresh token lifecycle. | `src/modules/identity` |
| Companies | Company aggregate and Hacienda verification metadata. | `src/modules/companies` |
| API Keys | API-key lifecycle, argon2id verification, scopes, company authorization. | `src/modules/api-keys` |
| Hacienda Public Queries | Taxpayer, CABYS and exchange-rate public lookups. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda Connection | Per-company/per-environment Hacienda credential configuration/validation. | `src/modules/hacienda-connection` |
| Fiscal Documents | Issuance points, sequences, document snapshots, XML/signing preparation metadata and `/prepare-xml`. | `src/modules/fiscal-documents` |
| Fiscal XML and Signing | Serialization, official XSD 1.1 validation and current XAdES adapter behind ports. | `src/modules/fiscal-documents/**/fiscal-xml`, `src/infrastructure/signing` |
| Audit | Audit event recording. | `src/modules/audit` |
| Infrastructure | Config, database, integrations, queues, secrets, storage, signing, tenant context. | `src/infrastructure` |

## 5. Main use cases

Implemented fiscal use cases include:

1. Configure default fiscal issuance point with JWT TENANT_ADMIN.
2. Configure fiscal sequence with JWT TENANT_ADMIN.
3. Create invoice with API key `invoices:write`; persists `READY_FOR_XML`.
4. Create ticket with API key `tickets:write`; persists `READY_FOR_XML`.
5. Retrieve fiscal document with dynamic `invoices:read` or `tickets:read` and company authorization.
6. Prepare fiscal XML via `POST /api/v1/fiscal-documents/:id/prepare-xml`; API-key authenticated. It serializes existing `READY_FOR_XML` fiscal documents, signs, verifies, validates exact signed XML against pinned XSDs, stores artifacts and returns `READY_TO_SUBMIT` metadata. This implemented use case is accepted for the confirmed F2.3 scope; it does not submit to Hacienda.

F2.3 explicitly does not create fiscal documents and does not submit to Hacienda.

## 6. Current data flows

### F2.2 creation flow

API-key client calls invoice/ticket creation with `Idempotency-Key`; guards validate key/scopes; service reserves idempotency before sequence allocation in a Prisma transaction; sequence allocation uses PostgreSQL upsert/update; clave/consecutive/totals/snapshots are persisted; sanitized document response is returned.

### F2.3 prepare XML flow

1. Load fiscal document by tenant/document id.
2. Check type-specific API-key scope and company authorization.
3. If already `READY_TO_SUBMIT`, return existing signed artifact metadata without mutation.
4. Generate deterministic unsigned FE/TE v4.4 XML from immutable snapshot.
5. Store unsigned XML through `StoragePort` and hash it.
6. Run pre-sign structural/business checks.
7. Load scoped active certificate metadata and secrets through `FiscalSigningCertificateService`/`SecretProviderPort`.
8. Sign exact unsigned XML through `XmlSignerPort` / `NodeXadesEpesSignerAdapter`.
9. Verify signed XML locally.
10. Validate exact signed XML bytes against pinned official FE/TE v4.4 XSDs using `Xsd11ValidatorAdapter`.
11. Store signed XML through `StoragePort`, persist artifact metadata and transition to `READY_TO_SUBMIT`.
12. Record audit events without XML bodies or secrets.

## 7. Database and persistence

Current fiscal persistence includes:

- `FiscalDocumentStatus`: `READY_FOR_XML`, `XML_GENERATED`, `XML_VALIDATED`, `SIGNED`, `READY_TO_SUBMIT`.
- `FiscalXmlValidationStatus`: `NOT_VALIDATED`, `VALID`, `INVALID`.
- `FiscalSigningCertificateStatus`: `ACTIVE`, `DISABLED`, `EXPIRED`, `REPLACED`, `INVALID`.
- `FiscalSigningCertificateType`: `HACIENDA_CRYPTOGRAPHIC_KEY`, `LEGAL_DIGITAL_SIGNATURE`.
- `FiscalSigningCertificate` stores certificate/password secret references and non-secret metadata only.
- `FiscalXmlArtifact` stores private storage keys, SHA-256 hashes, schema/profile/signature metadata, validation status/errors and last error metadata.

Important constraints:

- Scoped fiscal consecutive uniqueness: `(tenant_id, company_id, environment, consecutive)`.
- Globally unique `clave`.
- Fiscal XML artifact uniqueness: `(tenant_id, company_id, fiscal_document_id, schema_version, xml_profile_version)`.
- Idempotency uniqueness: `(tenant_id, company_id, api_key_id, operation, key)`.

Known persistence gaps include no separate fiscal line table, no partial unique index for one default active issuance point, and audit-noted tenant/company consistency hardening opportunity for F2.3 certificate/artifact relations.

## 8. APIs and integrations

Current fiscal APIs under `/api/v1`:

| Method/path | Auth | Current behavior |
|---|---|---|
| `POST /invoices` | API key + `invoices:write` | Creates invoice snapshot ending at `READY_FOR_XML`. |
| `POST /tickets` | API key + `tickets:write` | Creates ticket snapshot ending at `READY_FOR_XML`. |
| `GET /fiscal-documents/:id` | API key + dynamic read scope | Retrieves sanitized fiscal document. |
| `POST /fiscal-documents/:id/prepare-xml` | API key + service scope/company checks | Generates, signs, verifies, XSD-validates and stores FE/TE XML; returns `READY_TO_SUBMIT` metadata when successful. No Hacienda submission is performed. |
| Fiscal management `PUT` endpoints | JWT TENANT_ADMIN | Configure default issuance point and sequence. |

External integrations currently used by F2.3 are local/offline XSD assets, `SecretProviderPort`, `StoragePort`, and local signing/XSD adapters. No Hacienda submission, OAuth token acquisition for submission, polling, callbacks or queues are implemented for F2.3/F3.

## 9. Authentication and authorization

- Fiscal creation/read uses API-key auth with type-specific scopes and company authorization.
- `/prepare-xml` uses API-key auth and service-level type/company checks.
- `FiscalXmlController` is decorated with `@SkipThrottle()`, which final audit flags as non-blocking AUD-003 because the endpoint is expensive.
- Fiscal management uses JWT and TENANT_ADMIN role checks.
- Existing Fase 1/auth throttling uncertainties remain repository-level risks.

## 10. Events and background processing

- Fiscal audit events are recorded through `AuditService.record()` using `EventClass.FISCAL_AUDIT`.
- F2.3 audit actions include XML generation/validation/signing/readiness events per implementation tests.
- No domain-event bus is implemented for fiscal documents.
- No F3 submission workers, queues, polling jobs or callbacks exist.

## 11. Containers and deployment

- `Dockerfile` builds the NestJS app and runner image.
- Docker evidence supplied after final TASK-011 validation: `docker build -t billing:f23-task011-xmlcrypto-validation --target runner .` passed. Earlier packaging established that the Python XSD helper/assets are included for runtime; this refresh did not re-run container checks.
- `nest-cli.json` copies helper/assets to `dist/src` for the runtime helper path.
- `docker-compose.yml` remains local/development oriented; production/default-secret concerns remain.
- Existing npm audit vulnerabilities remain: 26 reported by `npm ci`/audit evidence.

## 12. Current testing strategy

Current automated evidence supplied for final post-TASK-011 F2.3 validation gates:

- Full gates passed: `npx prisma generate`, `npx prisma validate`, `npx prisma migrate deploy` with `DATABASE_URL`, `npm run lint:check`, `npm run typecheck`, `npm test -- --silent` (217/217), `npm run build`, and `npm run test:e2e -- --silent --runInBand` (60/60).
- Docker runner build passed: `docker build -t billing:f23-task011-xmlcrypto-validation --target runner .`.
- TASK-011 tests include `xml-crypto` `SignedXml` independent verifier coverage with Hacienda XPath transform; FE/TE valid signatures pass signer verify, xml-crypto verify and XSD; tamper fails.
- Existing dependency vulnerabilities remain known/out of scope for this F2.3 refresh.

This architecture refresh did not execute commands; results are recorded from user-provided implementation/audit evidence.

## 13. Behavior to preserve

- Modular monolith and `/api/v1` public prefix.
- Tenant/company/environment isolation and fail-closed API-key authorization.
- Stable F2.2 creation ending at `READY_FOR_XML`.
- Immutable fiscal snapshots as source of truth for F2.3 serialization.
- No Hacienda submission/F3 side effects in F2.3.
- Deterministic unsigned XML generation from snapshots.
- Signed XML validated against pinned official XSD after local signature verification.
- `READY_TO_SUBMIT` retry returns existing artifact metadata and does not silently mutate signed XML.
- Secrets, certificate material, private keys, passwords and XML bodies are not logged or returned by default.

## 14. Known defects

| ID | Severity | Current defect |
|---|---|---|
| AUD-001 | Closed for F2.3 scope | Closed by final baseline audit for confirmed F2.3 acceptance scope. TASK-011 added PKCS#12/PFX handling, DER `ds:X509Certificate`, `xml-crypto` canonicalization for document digest, `SignedProperties` digest and `SignedInfo` signature input, plus independent `xml-crypto` verifier tests with Hacienda XPath transform. Remaining note: production verifier behavior is weaker than the stricter test standards-verifier coverage; Hacienda submission acceptance is out of scope. |
| AUD-002 | Medium | Concurrent duplicate `prepare-xml` calls may race; idempotency/no-mutation is proven for retry after readiness, not necessarily simultaneous prepare requests. |
| AUD-003 | Medium | Expensive `prepare-xml` endpoint is decorated with `@SkipThrottle()`, so endpoint throttling/cost protection is absent. |
| AUD-004 | Medium | Additional DB tenant/company consistency constraints for F2.3 certificate/artifact relations are recommended. |
| AUD-005 | Closed | Documentation/status ambiguity from earlier audits has been corrected; current docs record final 8.9/10 Acceptable and AUD-001 closed for F2.3 scope. |
| AUD-006 | Medium | Certificate rotation behavior is partly inferred from no-mutation retry; operational rotation/re-sign policy requires clarification. |
| AUD-007 | High | Existing 26 npm audit vulnerabilities remain unresolved. |
| AUD-008 | Medium | Missing UUID validation pipe for path params such as fiscal document id. |
| DEF-F1-RATE-001 | High | Auth login/refresh throttling enforcement remains unproven from earlier audits. |
| DEF-F2.2-LINES-001 | Low | Fiscal lines are JSON snapshots rather than a relational line table. |

## 15. Architectural debt

| ID | Severity | Debt |
|---|---|---|
| DEBT-F2.2-001 | Medium | `FiscalDocumentService` remains large and directly uses Prisma for F2.2 creation/read/configuration orchestration. |
| DEBT-F2.3-001 | Medium | XMLDSig/XAdES is still manually assembled even though TASK-011 now uses `xml-crypto` canonicalization and independent verifier tests. Consider a fuller standards-based signing library/tool before broader production hardening. |
| DEBT-F2.3-002 | Medium | Prepare orchestration should add explicit concurrency control/locking around transformation attempts. |
| DEBT-F2.3-003 | Medium | Expensive XML signing/XSD processing needs rate limiting or quota policy. |
| DEBT-F2.3-004 | Medium | Certificate rotation lifecycle and management use cases need explicit domain policy. |
| DEBT-API-001 | Low/Medium | Some public responses still rely on compact sanitizers rather than explicit DTO mappers. |

## 16. Security risks

| ID | Severity | Risk |
|---|---|---|
| SEC-F2.3-001 | Medium | F2.3 local signing verification is accepted for scope, but production verifier behavior is weaker than the stricter test `xml-crypto` standards-verifier coverage and Hacienda receiver acceptance is not proven because F3/submission is out of scope. |
| SEC-F2.3-002 | Medium | `prepare-xml` is computationally expensive and currently skips throttling. |
| SEC-F2.3-003 | Medium | Path params without UUID validation can increase error-noise and input-handling exposure. |
| SEC-REPO-001 | High | Existing npm audit vulnerabilities remain. |
| SEC-REPO-002 | High | Docker Compose/default-secret concerns remain if reused outside local development. |
| SEC-F1-001 | High | Auth endpoint rate limiting may not be enforced; earlier audit concern remains. |

## 17. Unknowns and assumptions

- Real Hacienda/provider PKCS#12/PFX samples cannot be committed; a safe test strategy with synthetic but real X.509 PFX and independent verifier is required.
- Whether Hacienda accepts the produced XAdES structure against its production receiver remains **Requires clarification** and is out of F2.3/F3 unless a sandbox submission contract test is separately approved.
- Exact production certificate rotation/re-signing operational policy requires clarification.
- Whether JSON line snapshots are sufficient long-term for reporting/auditing requires clarification.
- This refresh did not execute validation commands; it records user-provided automated evidence and audit verdict.

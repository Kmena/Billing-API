# Architecture

> **Synchronized:** Fiscal-company-configuration-and-secure-credentials implementation refresh by `hdd-architecture-agent-3fd9e0` on 2026-09-23 for confirmed `specs/fiscal-company-configuration-and-secure-credentials`. Documentation-only refresh reflecting completed implementation: 11 tasks, 78 new tests, migration `20260924000000_add_cert_extracted_identity`, 893 tests / 71 suites passing.
>
> This document describes only architecture currently implemented or actively governing the system. Future remediation and F4.1 belong in `docs/action-plan.md`, `docs/tasks.md` and `docs/future-architecture.md`.

## 1. Purpose and scope

This document records the active architecture of Billing after the completed fiscal-company-configuration-and-secure-credentials implementation (building on F4). The fiscal-company-configuration spec adds: self-service PKCS#12 certificate upload and management, Costa Rica OID 2.5.4.5 fiscal identity extraction (`CrCertificateIdentityExtractorService` using `node-forge`), secure 14-step certificate upload and rotation flow (secrets via `SecretProvider`, no plaintext in PostgreSQL), pre-signing defense-in-depth identity re-validation, company identity change guard (HTTP 409 `FISCAL_CERTIFICATE_IDENTITY_CONFLICT` when ACTIVE certificate would become incompatible), fiscal readiness aggregation (6-flag readiness check) and company update handler. Quality gates after fiscal-company-configuration: typecheck PASS, lint 0 errors on new/modified files, 893 tests / 71 suites PASS / 1 pre-existing FAIL (unchanged). F4 prior quality gates (531 tests / 57 suites): all still passing.

Out of scope for this active-architecture document: target redesigns, F4.1 rejected document replacement, microservice decomposition, live production IAM/SecretProvider approval, dependency remediation and SMTP SecretProvider migration.

## 2. Current active architecture summary

Billing is an API-first modular monolith using NestJS, TypeScript, Prisma and PostgreSQL.

Runtime entrypoints:

- API process: `src/bootstrap/api.main.ts`.
- Worker process: `src/bootstrap/worker.main.ts`.

Active fiscal flow now spans:

```text
[Certificate management]
POST/PUT /companies/:id/fiscal-certificates/:env
  -> FiscalCertificateController (TENANT_ADMIN, multer memoryStorage)
    -> UploadFiscalSigningCertificateService (14-step)
      -> CrCertificateIdentityExtractorService (node-forge, OID 2.5.4.5)
      -> SecretProvider.storeSecret (PKCS#12 + PIN — never in PostgreSQL)
      -> Prisma.$transaction (REPLACED old → ACTIVE new)
      -> AuditService (SECURITY — no secrets)

[Company identity guard]
PUT /companies/:id
  -> CompanyController (TENANT_ADMIN)
    -> UpdateCompanyHandler
      -> assertNoCertificateIdentityConflict → HTTP 409 if ACTIVE cert would become incompatible
      -> AuditService (SECURITY: company.identity-change-blocked-by-certificate-conflict)

[Readiness check]
GET /companies/:id/fiscal-certificates/:env/readiness
  -> FiscalCertificateController
    -> FiscalReadinessService (6 flags, no secrets)

[Fiscal document issuance]
FE/TE creation -> READY_FOR_XML
  -> prepare XML/sign/XSD
    -> FiscalSigningCertificateService.getActiveCertificate
       [defense-in-depth] re-validates extractedIdentityNumber == company.identificationNumber
       -> SecretProvider.getSecret (PKCS#12 + PIN for signer)
    -> READY_TO_SUBMIT
    -> @Optional() + setImmediate -> EnsureInitialFiscalPackageService
       -> GenerateFiscalPdfService -> PDF artifact
       -> DocumentDelivery(INITIAL_DOCUMENT)
       -> DeliveryWorkerService (pg-boss) -> EmailDeliveryPort
  -> request Hacienda submission -> FiscalSubmission queued
  -> worker submit/reconcile through HaciendaSubmissionPort
  -> authoritative ACCEPTED or REJECTED + response artifact
    -> @Optional() + setImmediate -> EnsureHaciendaResponseDeliveryService
       -> DocumentDelivery(HACIENDA_RESPONSE)
       -> DeliveryWorkerService (pg-boss) -> EmailDeliveryPort
```

Fiscal-company-configuration adds certificate management, readiness and company update components inside `src/modules/fiscal-documents` and `src/modules/companies`:

```text
FiscalCertificateController (POST/PUT/GET /fiscal-certificates/:env + GET /readiness)
  -> UploadFiscalSigningCertificateService
    -> CrCertificateIdentityExtractorService (domain service — node-forge, pure, no I/O)
    -> SecretProvider (storeSecret / deleteSecret for compensation)
    -> Prisma.$transaction (REPLACED old ACTIVE → new ACTIVE, atomically)
    -> AuditService (fiscal-certificate.activated | upload-rejected — SECURITY)
  -> FiscalReadCertificateMetadataService (DB only, never SecretProvider)
  -> FiscalReadinessService (6-flag aggregation, DB only, never SecretProvider)

CompanyController (PUT /companies/:id — TENANT_ADMIN)
  -> UpdateCompanyHandler
    -> assertNoCertificateIdentityConflict (DEC-003)
    -> AuditService (company.identity-change-blocked-by-certificate-conflict — SECURITY)

FiscalSigningCertificateService.getActiveCertificate (MODIFIED)
  -> defense-in-depth: if extractedIdentityNumber present → compare vs Company.identificationNumber
  -> rejects with FISCAL_CERTIFICATE_EMITTER_MISMATCH if mismatch

F4 delivery components (unchanged):
FiscalArtifactsController / FiscalDeliveriesController / CompanyPdfSettingsController
  -> FiscalArtifactService / FiscalEvidenceResolverService / GenerateFiscalPdfService
  -> CompanyPdfSettingsService
  -> EnsureInitialFiscalPackageService / EnsureHaciendaResponseDeliveryService
  -> DeliveryRequestService / DeliveryWorkerService (OnModuleInit)
    -> DocumentDeliveryStateMachine (domain)
    -> DeliveryRetryClassifier (domain)
    -> QrContentBuilderPort <- HaciendaQrContentBuilderAdapter | MockQrContentBuilderAdapter
    -> PdfRendererPort <- BillingDefaultV1PdfRendererAdapter | MockPdfRendererAdapter
    -> EmailDeliveryPort <- NodemailerEmailDeliveryAdapter | MockEmailDeliveryAdapter
    -> StoragePort (SHA-256 verified reads/writes)
    -> Prisma (FiscalArtifact, CompanyPdfSettings, DocumentDelivery, DeliveryAttempt)
    -> AuditService (FISCAL_AUDIT / SECURITY events)
```

## 3. Active architectural style and module boundaries

Active style remains a modular monolith with incremental hexagonal/ports-and-adapters boundaries.

Current fiscal boundaries:

- Fiscal document creation/read and some orchestration remain Prisma-backed application services.
- Fiscal XML uses explicit ports for serializer, XSD validation, signing, secrets and storage.
- Fiscal submission uses domain helpers for state/retry policy, application services/workers for orchestration, a provider port for Hacienda recepcion, queue and storage ports for infrastructure, and Prisma for persistence.
- F4 uses explicit ports for PDF rendering (`PdfRendererPort`), QR generation (`QrContentBuilderPort`) and email delivery (`EmailDeliveryPort`); domain state machine and retry classifier are pure TypeScript with no framework or infrastructure imports.
- Hacienda provider and email provider Spanish/vendor-specific details are contained in infrastructure adapters; application-facing port objects use domain/application language.

Module wiring uses factory providers (useFactory) for conditional adapter selection: production vs. mock PDF renderer, QR builder and email adapter are injected at module composition time based on environment configuration.

## 4. Current domain map

| Domain / Module | Classification | Responsibility | Code location |
|---|---|---|---|
| Identity and Access | Core-supporting | Tenants, users, JWT, refresh tokens, API keys, scopes and company authorization. | `src/modules/identity`, `src/modules/api-keys` |
| Company Administration | Core | Company identity, ownership, fiscal profile/readiness data, PDF branding settings and company update (with identity guard). | `src/modules/companies` |
| Hacienda Public Queries | Supporting | Taxpayer, CABYS and exchange-rate lookups. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda Connection | Core-enabling | Per-company/per-environment credentials, validation, OAuth/OIDC auth and token cache. | `src/modules/hacienda-connection` |
| Fiscal Documents | Core | Issuance, sequences, immutable fiscal snapshots, XML readiness and document-level terminal Hacienda outcome. | `src/modules/fiscal-documents` |
| Fiscal XML and Signing | Core-supporting | Generate Hacienda v4.4 FE/TE XML, validate XSD, sign/verify, manage XML artifacts and enforce certificate identity invariants. | `src/modules/fiscal-documents/**/fiscal-xml`, `src/infrastructure/signing` |
| Fiscal Certificate Management (F5) | Core-supporting | PKCS#12 certificate upload and rotation (14-step, SecretProvider), OID 2.5.4.5 identity extraction (node-forge), certificate metadata read, fiscal readiness (6-flag) and pre-signing defense-in-depth identity re-validation. | `src/modules/fiscal-documents/application/fiscal-xml/`, `src/modules/fiscal-documents/domain/fiscal-xml/exceptions/`, `src/modules/fiscal-documents/infrastructure/http/fiscal-certificate.controller.ts` |
| Fiscal Submission | Core-supporting | Asynchronous Hacienda submission, retry/reconciliation lifecycle, callbacks and response artifact metadata. | `src/modules/fiscal-documents/**/submission` |
| Fiscal Artifacts (F4) | Core-supporting | Unified artifact metadata index (SIGNED_XML, HACIENDA_RESPONSE_XML, PDF), integrity verification and protected download. | `src/modules/fiscal-documents/**/artifacts` |
| Fiscal PDF and Branding (F4) | Core-supporting | PDF generation from immutable evidence, `BILLING_DEFAULT_V1` PDFKit renderer, QR code, multi-page pagination, company branding and logo management. | `src/modules/fiscal-documents/**/pdf`, `**/qr`, `**/infrastructure/pdf`, `**/infrastructure/qr` |
| Fiscal Delivery (F4) | Core-supporting | Two-stage email delivery lifecycle (INITIAL_DOCUMENT + HACIENDA_RESPONSE), delivery state machine, retry classification, delivery worker, manual resend and DeliveryAttempt history. | `src/modules/fiscal-documents/**/delivery`, `**/infrastructure/email` |
| Audit | Generic-supporting | Audit event recording. | `src/modules/audit` |
| Cross-cutting Infrastructure | Generic | Config, database, queues, secrets, storage, tenant context and adapters. | `src/infrastructure` |

## 5. Current runtime components and responsibilities

| Component | Responsibility |
|---|---|
| `AppModule` | Registers infrastructure and business modules, including fiscal documents, Hacienda connection and signing/submission/delivery/PDF infrastructure. |
| `FiscalDocumentService` | Fiscal FE/TE creation/read/configuration orchestration and immutable snapshot persistence. |
| `PrepareFiscalXmlService` | Generates, signs, verifies, XSD-validates and stores FE/TE XML; transitions to `READY_TO_SUBMIT`; triggers F4 initial delivery hook via `@Optional()` + `setImmediate`. |
| `SubmitFiscalDocumentService` | Validates preconditions, creates/reuses `FiscalSubmission`, enqueues submit/reconcile work and returns sanitized state. |
| `FiscalSubmissionStateService` | Applies provider results to `FiscalSubmission`, guards terminal regression, persists response artifacts and triggers F4 Hacienda response delivery hook via `@Optional()` + `setImmediate`. |
| `FiscalSubmissionWorkerService` | Registers submit/reconcile handlers and performs provider calls, token reuse, result classification, state persistence and response artifact storage. |
| `FiscalSubmissionStateMachine` | Enforces allowed submission state transitions and terminal non-regression. |
| `RetryClassifier` | Maps submission provider/technical outcomes into retry, reconcile, terminal or manual-review decisions. |
| `FiscalEvidenceResolverService` (F4) | Resolves immutable signed XML and Hacienda response bytes from storage; SHA-256 verifies before returning. |
| `FiscalArtifactService` (F4) | Lists artifact metadata (no storage keys exposed); streams SHA-256-verified downloads with official filenames; audits downloads. |
| `GenerateFiscalPdfService` (F4) | Creates or reuses PDF artifact from immutable fiscal evidence; idempotent by DB unique constraint; uses `PdfRendererPort` and `QrContentBuilderPort`. |
| `CompanyPdfSettingsService` (F4) | Manages safe company branding (logo magic-byte validation, colors, footer text); logo stored under tenant/company isolation; internal key never exposed. |
| `EnsureInitialFiscalPackageService` (F4) | Ensures `INITIAL_DOCUMENT` delivery is created and queued when `READY_TO_SUBMIT` with signed XML present; idempotent. |
| `EnsureHaciendaResponseDeliveryService` (F4) | Ensures `HACIENDA_RESPONSE` delivery is created and queued after F3 terminal response; `OnModuleInit` runs startup recovery scan. |
| `DeliveryWorkerService` (F4) | `OnModuleInit` registers pg-boss handler; fetches and SHA-256-verifies artifact bytes; sends via `EmailDeliveryPort` with official filenames; applies `DocumentDeliveryStateMachine` and `DeliveryRetryClassifier`; records `DeliveryAttempt`; DELIVERED stale guard. |
| `DeliveryRequestService` (F4) | Handles manual resend; validates tenant/company/document scope; CANCELLED guard; creates new `DeliveryAttempt`; audits. |
| `DocumentDeliveryStateMachine` (F4 domain) | Pure TypeScript state machine; enforces delivery transitions; DELIVERED terminal guard; scoped by kind; no infrastructure imports. |
| `DeliveryRetryClassifier` (F4 domain) | Classifies 14 delivery error classes into next status, backoff delay and security audit flag; no fiscal state changes. |
| `CrCertificateIdentityExtractorService` (F5) | Pure domain service — no I/O, no storage. Accepts PKCS#12 bytes + PIN via `node-forge`; validates structure; extracts and normalizes fiscal identity from OID 2.5.4.5; strips type prefixes (CPJ-→02, CF-→01, DIMEX-→03); all errors sanitized (no PIN/bytes in exceptions). |
| `UploadFiscalSigningCertificateService` (F5) | 14-step secure certificate upload and rotation: (1) size limit, (2) tenant-scoped company load, (3–7) extractor validation, (8) identity vs Company comparison, (9) date validity, (10) deterministic secret key, (11–12) `SecretProvider.storeSecret` for PKCS#12 + PIN, (13–14) atomic DB transaction (REPLACED old → ACTIVE new); compensating secret cleanup on DB failure; SECURITY audit on success or identity mismatch. |
| `FiscalReadCertificateMetadataService` (F5) | Reads ACTIVE certificate safe metadata from DB. Never calls `SecretProvider`. Never exposes `certificateSecretReference` or `passwordSecretReference`. Returns `UploadFiscalSigningCertificateResult`-shaped DTO. |
| `FiscalReadinessService` (F5) | Aggregates 6 readiness flags for a company+environment: (1) fiscal profile exists, (2) Hacienda connection exists, (3) credentials configured, (4) ACTIVE certificate exists, (5) certificate not expired/pre-valid, (6) certificate identity matches company, (7) issuance point exists. Returns `readyToIssue` boolean + `reasonCodes[]`. Never calls `SecretProvider`. |
| `FiscalCertificateController` (F5) | `POST/PUT /companies/:id/fiscal-certificates/:env` — certificate upload/rotation (TENANT_ADMIN; `multer.memoryStorage()` — PKCS#12 never written to disk; PIN from multipart body field). `GET /companies/:id/fiscal-certificates/:env` — safe metadata. `GET /companies/:id/fiscal-certificates/:env/readiness` — readiness flags. Response DTO explicitly excludes secret references. |
| `UpdateCompanyHandler` (F5) | Handles `PUT /companies/:id`. Detects identity field changes; calls `assertNoCertificateIdentityConflict` (DEC-003): loads ACTIVE cert (tenant+company scoped), compares `extractedIdentityNumber` and `extractedIdentityType` against proposed new values; throws `FiscalCertificateIdentityConflictException` (HTTP 409) if incompatible; emits `company.identity-change-blocked-by-certificate-conflict` (SECURITY) audit event. Never loads secrets, never deactivates certificates. |
| `FiscalSigningCertificateService` (modified F5) | Defense-in-depth: after status/date checks, if `extractedIdentityNumber` is set, re-validates it against the current `Company.identificationNumber` before returning the signing context. Aborts with `FISCAL_CERTIFICATE_EMITTER_MISMATCH` if mismatch. Backward-compatible (check skipped if `extractedIdentityNumber` is NULL for legacy rows). |
| `HaciendaSubmissionPort` | Application-facing provider boundary for submit/status query. |
| `HaciendaRecepcionAdapter` | Real Hacienda CE `POST /recepcion` and `GET /recepcion/{clave}` HTTP adapter. |
| `MockHaciendaSubmissionAdapter` | Deterministic fake adapter for CI/unit/E2E without live Hacienda. |
| `PdfRendererPort` (F4) | Application port for PDF rendering; production: `BillingDefaultV1PdfRendererAdapter` (PDFKit); CI: `MockPdfRendererAdapter`. |
| `QrContentBuilderPort` (F4) | Application port for QR content; production: `HaciendaQrContentBuilderAdapter` (reads `HACIENDA_QR_URL_BASE`); CI: `MockQrContentBuilderAdapter`. |
| `EmailDeliveryPort` (F4) | Application port for email delivery; production: `NodemailerEmailDeliveryAdapter` (SMTP); CI: `MockEmailDeliveryAdapter`. |
| `JobQueuePort` | Publishes/schedules jobs and optionally registers handlers. |
| `StoragePort` | Stores and retrieves private XML, Hacienda response and PDF artifacts. |
| `AuditService` | Records fiscal lifecycle, delivery, integrity failure, certificate lifecycle and download events without secrets/tokens/XML bodies. |

## 6. Current dependency rules

Active intended dependency direction:

```text
Input adapter -> Application service/use case -> Domain helper/policy -> Output port <- Output adapter
```

F4 and F5 hexagonal compliance:

- `DocumentDeliveryStateMachine` and `DeliveryRetryClassifier` depend on nothing but domain enums; no NestJS/Prisma/HTTP imports.
- `GenerateFiscalPdfService` depends on `PdfRendererPort` and `QrContentBuilderPort` (ports), not infrastructure adapters (AUD-004 resolved).
- `DeliveryWorkerService` depends on `EmailDeliveryPort` (port); SMTP/Nodemailer details remain in adapter.
- Domain delivery exceptions (`InvalidClaveException`) do not expose infrastructure errors.
- `CrCertificateIdentityExtractorService` (F5) is a pure injectable service with no I/O, no Prisma, no HTTP — only `node-forge` and `crypto`. It is the closest to a pure domain service in the current codebase.
- F5 domain exceptions (`FiscalCertificateEmitterMismatchException`, `FiscalCertificateIdentityConflictException`, etc.) are `DomainException` subclasses — no infrastructure details exposed.
- `FiscalReadinessService` and `FiscalReadCertificateMetadataService` (F5) depend only on Prisma (consistent with fiscal style) and never on `SecretProvider`, ensuring no secrets reach the readiness/metadata paths.
- `UpdateCompanyHandler` (F5) imports `FiscalCertificateIdentityConflictException` from the fiscal-documents domain; this is a deliberate cross-module domain-exception reference, acceptable given the Companies module guards fiscal certificate integrity on behalf of the fiscal documents domain.

Current deviations/limitations:

| ID | Severity | Location | Rule affected | Current impact | Recommended target |
|---|---|---|---|---|---|
| ARCH-F2.2-001 | Medium | `FiscalDocumentService` | Application should depend on output ports rather than concrete Prisma. | Harder to unit-test/refactor. | Extract repository ports incrementally. |
| ARCH-F2.3-002 | Medium | `PrepareFiscalXmlService` | Transformation use case should enforce concurrency/idempotency boundaries. | Concurrent duplicate prepare requests may race. | Add DB lock/status transition guard. |
| ARCH-F2.3-003 | Medium | `FiscalXmlController`, `FiscalSubmissionController`, F4 controllers | Expensive endpoints should be throttled/limited. | Current controllers skip throttling. | Define/enforce API-key quota/rate policy. |
| ARCH-F3-001 | Medium | F3 application services/workers | Application services should ideally use output repository ports. | F3 directly uses Prisma. | Extract `FiscalSubmissionRepositoryPort` only if complexity justifies. |
| ARCH-F3-002 | Medium | Worker runtime | Worker process imports full `AppModule`. | Runtime boundaries implicit. | Consider worker-specific module composition. |
| ARCH-F4-001 | Medium | F4 application services | Delivery/artifact services directly use Prisma (consistent with fiscal style but not fully port-isolated). | Consistent with current project style; manageable debt. | Extract repository ports incrementally if complexity warrants. |
| ARCH-F4-002 | Medium | `FiscalDocumentsModule` factory | `PDF_RENDERER` binding uses `NODE_ENV === 'production'` check rather than a dedicated `USE_REAL_PDF` flag. | Less explicit than dedicated flag. | Add `USE_REAL_PDF` config flag for symmetry with `USE_REAL_HACIENDA`. |
| ARCH-F1-001 | High | Auth throttling | Security guard enforcement should be proven. | Login/refresh rate limiting remains unproven. | Add threshold tests/fix through approved task. |

Positive hexagonal boundaries:

- F3/F4 domain state machines and retry classifiers do not depend on NestJS, Prisma or HTTP clients.
- Hacienda HTTP, SMTP, PDF renderer and QR details are isolated behind ports and adapters.
- Secrets/tokens are not public contracts and are not persisted.
- F4 `@Optional()` injection pattern ensures F3 workers/services pass all existing tests unchanged.

## 7. Current database ownership and transaction boundaries

Fiscal Documents owns:

- `fiscal_issuance_points`
- `fiscal_sequences`
- `fiscal_documents`
- `fiscal_idempotency_keys`
- `fiscal_signing_certificates` (extended with `extracted_identity_number`, `extracted_identity_type` in F5)
- `fiscal_xml_artifacts`
- `fiscal_submissions`
- `fiscal_artifacts` (F4)
- `company_pdf_settings` (F4)
- `document_deliveries` (F4)
- `delivery_attempts` (F4)

Current transaction/integrity boundaries:

- F2.2 creation wraps idempotency reservation, sequence allocation and document persistence in one Prisma transaction.
- F3 uses dedicated `FiscalSubmission` consistency boundary with unique `fiscalDocumentId` and `clave`, guarded terminal transitions and optimistic `version`.
- F4 `FiscalArtifact` uses unique constraint `(fiscalDocumentId, type, templateId, rendererVersion)` for idempotent PDF generation under concurrent workers.
- F4 `DocumentDelivery` uses unique constraint `(fiscalDocumentId, kind, channel, recipient, packageVersion)` for idempotent delivery creation.
- F4 `DeliveryAttempt` rows are append-only; no updates.
- `DocumentDelivery.status` never writes to `FiscalDocument.status`; enforced in state machine, worker and all service paths.
- `DELIVERED` stale terminal guard: worker uses `updateMany WHERE status <> DELIVERED`.
- Authoritative terminal F3 transitions update both `FiscalSubmission.status` and `FiscalDocument.status` to `ACCEPTED` or `REJECTED`.
- F5 certificate rotation uses a single `Prisma.$transaction`: marks previous ACTIVE as `REPLACED` with `replacedById` pointer and inserts new ACTIVE row atomically. The old certificate is never deactivated before the new one is fully validated and stored. Secret stores (`SecretProvider.storeSecret`) occur before the DB transaction and are compensated via `deleteSecret` if the transaction fails (best-effort; orphan logged as WARNING).

F5 schema invariants on `fiscal_signing_certificates`:

- `extracted_identity_number VARCHAR(30) NULL` — normalized CR fiscal ID from OID 2.5.4.5 (prefixes stripped); NULL for legacy rows.
- `extracted_identity_type VARCHAR(20) NULL` — normalized type code (`01`=FISICA/CF, `02`=JURIDICA/CPJ, `03`=DIMEX); NULL for legacy rows or unknown prefix.
- At most one row per `(tenantId, companyId, environment)` has `status = ACTIVE` at any time (enforced by rotation transaction).
- PostgreSQL contains **no PKCS#12 bytes, no PIN, no private key** — only `certificateSecretReference` (path) and `passwordSecretReference` (path) point to `SecretProvider` entries.

Current migrations include:

- Forward-only migration `20260914193000_fiscal_submission` (F3), validated from zero on PostgreSQL 15.
- Forward-only migration `20260915100000_f4_fiscal_artifacts_delivery` (F4), Prisma validate PASS; live deploy verification pending.
- Forward-only migration `20260916000000_f4_fix_delivery_unique_null` (F4 fix).
- Forward-only migration `20260920000000_fix_economic_activity_code_format` (data fix).
- Forward-only migration `20260924000000_add_cert_extracted_identity` (F5) — adds `extracted_identity_number` and `extracted_identity_type` to `fiscal_signing_certificates`; nullable additive columns; backward-compatible with F4-S bootstrap row. Prisma validate PASS.

## 8. Current API and integration contracts

All paths are under `/api/v1`.

Previously active F0–F3 contracts are unchanged. F5 (fiscal-company-configuration) adds:

| API | Auth | Contract summary |
|---|---|---|
| `POST /companies/:companyId/fiscal-certificates/:environment` | JWT + TENANT_ADMIN | Upload new PKCS#12 certificate (multipart `certificate` file + `pin` body field). Validation: file size ≤ 1 MB (configurable), PKCS#12 parseable, PIN unlocks, private key present, OID 2.5.4.5 readable, identity matches Company, dates valid. Stores via `SecretProvider`; atomic DB rotation. Returns safe certificate metadata. HTTP 201. |
| `PUT /companies/:companyId/fiscal-certificates/:environment` | JWT + TENANT_ADMIN | Rotate/replace ACTIVE certificate. Same 14-step validation as POST. Old ACTIVE marked REPLACED atomically. HTTP 200. |
| `GET /companies/:companyId/fiscal-certificates/:environment` | JWT (any role) | Returns ACTIVE certificate safe metadata: fingerprint, serial, subject, issuer, validFrom, validTo, extractedIdentityNumber, extractedIdentityType, status. Never includes `certificateSecretReference`, `passwordSecretReference`, PIN or PKCS#12 bytes. HTTP 200 or 404. |
| `GET /companies/:companyId/fiscal-certificates/:environment/readiness` | JWT (any role) | Returns `readyToIssue` boolean, `reasonCodes[]` and safe `activeCertificate` metadata. 6 checks: fiscal profile, Hacienda connection, credentials, ACTIVE certificate, certificate validity/dates, certificate identity match, issuance point. Never exposes secrets. |
| `PUT /companies/:companyId` | JWT + TENANT_ADMIN | Partial company update. Identity field changes (`identificationNumber`, `identificationType`) trigger `assertNoCertificateIdentityConflict`; blocked with HTTP 409 + `FISCAL_CERTIFICATE_IDENTITY_CONFLICT` if incompatible ACTIVE certificate exists. Unrelated field changes (legalName, tradeName) always succeed. Audited. |

F5 error codes in responses:

| Code | HTTP | Meaning |
|---|---|---|
| `FISCAL_CERTIFICATE_FILE_TOO_LARGE` | 400 | Uploaded file exceeds size limit |
| `FISCAL_CERTIFICATE_INVALID_FORMAT` | 400 | Not a valid PKCS#12 file |
| `SIGNING_CERTIFICATE_PIN_INVALID` | 422 | PIN does not unlock PKCS#12 |
| `SIGNING_PRIVATE_KEY_MISSING` | 422 | No private key found in PKCS#12 |
| `SIGNING_CERTIFICATE_MISSING` | 422 | No certificate found in PKCS#12 |
| `SIGNING_CERTIFICATE_IDENTITY_UNREADABLE` | 422 | OID 2.5.4.5 absent or unrecognized |
| `FISCAL_CERTIFICATE_EMITTER_MISMATCH` | 422 | Certificate identity ≠ Company.identificationNumber |
| `FISCAL_CERTIFICATE_EXPIRED` | 422 | Certificate is expired at upload time |
| `FISCAL_CERTIFICATE_NOT_YET_VALID` | 422 | Certificate validFrom is in the future |
| `FISCAL_CERTIFICATE_STORAGE_FAILED` | 500 | SecretProvider write failed |
| `FISCAL_CERTIFICATE_PERSIST_FAILED` | 500 | DB transaction failed after secret storage |
| `FISCAL_CERTIFICATE_IDENTITY_CONFLICT` | 409 | Company identity change incompatible with ACTIVE cert (DEC-003) |
| `FISCAL_CERTIFICATE_NOT_FOUND` | 404 | No ACTIVE certificate found for metadata read |

F4 adds:

| API | Auth | Contract summary |
|---|---|---|
| `GET .../invoices/:id/artifacts` | `invoices:read` | Returns `FiscalArtifactMetadata[]`; no storage keys; tenant/company-scoped. |
| `GET .../tickets/:id/artifacts` | `tickets:read` | Returns `FiscalArtifactMetadata[]`; no storage keys; tenant/company-scoped. |
| `GET .../invoices/:id/artifacts/:artifactId/download` | `invoices:read` | SHA-256-verified download; official `Content-Disposition`; `Cache-Control: no-store`; audited. |
| `GET .../tickets/:id/artifacts/:artifactId/download` | `tickets:read` | SHA-256-verified download; official `Content-Disposition`; `Cache-Control: no-store`; audited. |
| `GET .../invoices/:id/deliveries` | `invoices:read` | Returns `DeliveryHistoryDto[]`; no PII in response. |
| `GET .../tickets/:id/deliveries` | `tickets:read` | Returns `DeliveryHistoryDto[]`; no PII in response. |
| `POST .../invoices/:id/deliveries` | `invoices:write` | Manual resend; HTTP 202; kind: INITIAL_DOCUMENT\|HACIENDA_RESPONSE; audited; CANCELLED guard. |
| `POST .../tickets/:id/deliveries` | `tickets:write` | Manual resend; HTTP 202; kind: INITIAL_DOCUMENT\|HACIENDA_RESPONSE; audited; CANCELLED guard. |
| `PUT /companies/:companyId/pdf-settings` | `invoices:write` | Update safe branding (colors, footer, showCommercialName). |
| `POST /companies/:companyId/pdf-settings/logo` | `invoices:write` | Logo upload; magic-byte validation; 2 MB limit; SVG rejected. |

Email integration contract:

- Port: `EmailDeliveryPort` (vendor-agnostic; outcomes: DELIVERED, TRANSIENT_FAILURE, PERMANENT_FAILURE, RATE_LIMITED, UNKNOWN).
- Production adapter: `NodemailerEmailDeliveryAdapter` (SMTP; SES/SendGrid/Resend compatible); active when `EMAIL_USE_REAL=true`.
- CI adapter: `MockEmailDeliveryAdapter` (configurable outcome; captured records).
- Attachment filenames follow official Hacienda convention: `{clave}.xml`, `{clave}_respuesta.xml`, `{clave}.pdf`.
- SMTP credentials are currently plain env vars; `SecretProvider` migration required before production.

Artifact filename convention (DEC-013, HACIENDA REQUIREMENT — Anexos v4.4):

| Artifact type | External filename |
|---|---|
| Signed comprobante XML | `{clave}.xml` |
| Hacienda response XML | `{clave}_respuesta.xml` |
| PDF representation | `{clave}.pdf` |

QR contract (DEC-001):

- Port: `QrContentBuilderPort.buildQrContent(clave: string): string`.
- Input validation: `/^\d{50}$/`; throws `InvalidClaveException` on violation.
- Production: `HaciendaQrContentBuilderAdapter` — `{HACIENDA_QR_URL_BASE}?Clave={clave}`; no hardcoded URL.
- CI/test: `MockQrContentBuilderAdapter` — `https://mock.hacienda.test/qr?Clave={clave}` (TEST-ONLY label).

## 9. Current security boundaries

- Tenant/company/environment scoping is enforced on all fiscal, F4 delivery/artifact and F5 certificate operations.
- F3 submit/status/reconcile use existing invoice/ticket write scopes.
- F4 artifacts/deliveries use existing invoice/ticket read/write scopes; no new dedicated F4 scopes.
- F5 certificate management and company update require JWT + `TENANT_ADMIN` role; certificate metadata read requires JWT (any role).
- Internal storage keys (SecretProvider references) never appear in API responses, audit records or logs.
- Artifact SHA-256 verified before download streaming and before email attachment.
- Logo upload validates magic bytes (PNG/JPEG/WebP); SVG rejected; 2 MB limit; stored under tenant/company isolation; internal key never returned to API callers.
- Email provider credentials are not in queue payloads or audit records.
- `Content-Disposition` filenames sanitized for CRLF/path-traversal; official Clave-based naming.
- Download responses include `Cache-Control: no-store`.
- `ARTIFACT_HASH_MISMATCH` errors trigger `MRR + SECURITY` audit event and stop delivery without retry.
- `REJECTED` Hacienda response delivered truthfully; rejected comprobante not presented as valid.

**F5 certificate security invariants (active):**

1. **PKCS#12 never written to disk** — `multer.memoryStorage()` is explicitly set in `FiscalCertificateController`; overrides the module-level `{ dest: '/tmp/uploads' }` default. PKCS#12 bytes exist only in `file.buffer` (heap) during processing.
2. **PIN and PKCS#12 stored only via SecretProvider** — PostgreSQL contains only `certificateSecretReference` and `passwordSecretReference` (path strings), never secret material. Confirmed by 10/10 sentinel tests in `certificate-upload-logging-security.spec.ts`.
3. **No secret material in logs or audit records** — `node-forge` exceptions are caught and re-thrown as sanitized `DomainException` subclasses; exception messages never contain PIN or certificate bytes. `AuditService.record()` metadata for certificate operations contains only: `certificateId`, `environment`, `fingerprintSha256`, `subjectName`, `actor` — never PIN, PKCS#12 base64, private key or secret references.
4. **Certificate identity validated at upload AND at every signing operation** — dual guard: `UploadFiscalSigningCertificateService` (upload) and `FiscalSigningCertificateService.getActiveCertificate()` (defense-in-depth pre-signing).
5. **Company identity changes blocked when incompatible with ACTIVE certificate** — `UpdateCompanyHandler.assertNoCertificateIdentityConflict()` prevents silent cert invalidation; automatic deactivation is explicitly prohibited (DEC-003).
6. **Certificate rotation is atomic** — old ACTIVE cert preserved until new cert is fully validated, stored via `SecretProvider` AND persisted in DB via a single `Prisma.$transaction`.
7. **Cross-tenant certificate isolation** — `assertNoCertificateIdentityConflict` queries by `(tenantId, companyId, status='ACTIVE')` — certificates from other tenants or companies are never loaded.
8. **Compensating cleanup on transaction failure** — if DB transaction fails after `SecretProvider.storeSecret`, `UploadFiscalSigningCertificateService.attemptCleanupSecret()` attempts `deleteSecret` for both orphan secrets; failure is logged as WARNING (orphan secret path documented).

Known unresolved risks: npm audit vulnerabilities, production IAM/SecretProvider, SMTP plain-env-var credentials, throttling policy and UUID validation.

## 10. Current container and deployment architecture

- Multi-stage `Dockerfile` builds the NestJS app and runner image; build PASS in F4 validation evidence.
- `docker-compose.yml` remains local/development oriented.
- F4 adds new environment variables for production: `HACIENDA_QR_URL_BASE` (required in production/staging; mock default for dev/test), `SMTP_*`, `EMAIL_*`, `PDF_*`, `DELIVERY_*`.
- `HACIENDA_QR_URL_BASE` config validation fails fast at startup in production/staging if missing.
- SMTP credentials are currently plain environment variables; `SecretProvider` migration required before production deployment.
- Production deployment requires separate verification of OQ-012 (IAM/SecretProvider) and pre-production SMTP/QR-URL/storage-lifecycle configuration.

## 11. Current testing strategy

Current strategy includes unit, application, adapter, PostgreSQL-backed concurrency, E2E, migration and Docker validation.

F5 (fiscal-company-configuration) validation evidence:

- `npx tsc --noEmit`: PASS (0 errors).
- `npx eslint --fix` on all new/modified files: PASS (0 errors).
- `npm test -- --silent`: **893 PASS, 71/72 suites PASS, 1 pre-existing FAIL** (`f3-postgres-concurrency.spec.ts` — DB teardown FK ordering; unrelated to F5).
- `npx prisma validate`: PASS.
- `npx prisma generate`: PASS.

F5 new test suites (8 suites, 78 new tests):

| Suite | Tests | Coverage |
|---|---|---|
| `cr-certificate-identity-extractor.service.spec.ts` | 11 | OID extraction, PIN validation, format errors, expiry, identity normalization, sentinel PIN absence in errors |
| `upload-fiscal-signing-certificate.service.spec.ts` | 11 | Happy path, rotation, identity mismatch, expired, storage failure, DB failure, audit secrets |
| `certificate-upload-logging-security.spec.ts` | 10 | Sentinel: PIN, PKCS#12 bytes, Base64, private key, Authorization, cookies, audit metadata — all absent from logs |
| `fiscal-signing-certificate.service.spec.ts` | 8 | Pre-signing identity check: match, mismatch, missing extractedIdentityNumber, cross-tenant isolation |
| `update-company.handler.spec.ts` | 13 | DEC-003: 13 scenarios including cross-tenant, compatible update, blocked update, unrelated field updates |
| `fiscal-readiness.service.spec.ts` | 8 | 6-flag combinations, all false individually, all true, secret-free response |
| `certificate-lifecycle-audit.spec.ts` | 9 | Lifecycle audit events, secret-free metadata, rejection audit |
| `fiscal-submission-worker-recovery.spec.ts` | 8 | Recovery scenarios: QUEUED, RETRY, POST_OUTCOME_UNKNOWN, stale SUBMITTING, terminal states (verifies AC-009) |

F4 prior baseline (531 tests / 57 suites): all still passing. 0 regressions introduced by F5.

Live database integration tests (PostgreSQL-backed concurrency and multi-page PDF) are pending live PostgreSQL environment.

This documentation refresh did not execute commands; it records final F5 implementation evidence.

## 12. Active architectural decisions

| Decision | Spec / ID | Current status |
|---|---|---|
| Use modular monolith, not microservices. | Foundation | Active. |
| Use NestJS + TypeScript + Prisma + PostgreSQL. | Foundation | Active. |
| Keep global HTTP prefix `/api/v1`. | Foundation | Active. |
| Keep F2.2/F2.3 immutable artifact boundary: no phase regenerates fiscal document, consecutive, Clave or signed XML. | F2.2/F2.3 | Active. |
| Use dedicated `FiscalSubmission` for F3 technical/provider lifecycle. | F3 | Active. |
| Add only authoritative `ACCEPTED`/`REJECTED` to `FiscalDocumentStatus`; keep intermediate states in `FiscalSubmissionStatus`. | F3 | Active. |
| Use existing pg-boss/`JobQueuePort` for F4 delivery workers; no Redis/Kafka introduced. | F4 DEC-013 | Active. |
| Use `HaciendaSubmissionPort` for provider submission/status boundary. | F3 | Active. |
| Treat HTTP 201 from Hacienda submit as acknowledgement/pending, not acceptance. | F3 | Active. |
| Treat callback as signal-only; no cryptographic authentication of provider callback. | F3 | Active. |
| Reuse Hacienda connection/auth/token-cache/SecretProvider; do not persist OAuth tokens/passwords. | F2.1/F3 | Active. |
| CI/E2E uses deterministic mock Hacienda, PDF renderer, QR builder and email adapter; live providers are opt-in only. | F3/F4 | Active. |
| F4 `INITIAL_DOCUMENT` delivery triggers at `READY_TO_SUBMIT` + signed XML present, without requiring `ACCEPTED`. | F4 DEC-002 | Active. |
| Two independent delivery kinds: `INITIAL_DOCUMENT` and `HACIENDA_RESPONSE`; independent lifecycles, rows and retries. | F4 DEC-003 | Active. |
| Delivery state is strictly independent of fiscal state; no delivery outcome writes `FiscalDocument.status`. | F4 DEC-004 | Active. |
| One controlled PDF template for F4 MVP: `BILLING_DEFAULT_V1`; no arbitrary tenant HTML/CSS. | F4 DEC-005 | Active. |
| `QrContentBuilderPort.buildQrContent(clave)` — payload `{HACIENDA_QR_URL_BASE}?Clave={clave}`; `HACIENDA_QR_URL_BASE` operator-configured; no production default hardcoded. | F4 DEC-001/DEC-006 | Active. |
| `FiscalArtifact` references existing XML storage keys; no XML byte duplication. | F4 DEC-007 | Active. |
| Multi-page PDF: one QR on final/summary page in lower-right area. | F4 DEC-008 | Active. |
| Artifact download: authenticated API streaming MVP; no signed-URL pattern. | F4 DEC-009 | Active. |
| Rejected document replacement (F4.1) is a future dedicated phase; F4 only delivers rejection response truthfully. | F4 DEC-010 | Active. |
| F3/F4 integration via `@Optional()` injection + `setImmediate` in `FiscalSubmissionStateService` and `PrepareFiscalXmlService`. | F4 DEC-011 | Active. |
| External-facing filenames follow official Hacienda Anexos v4.4 convention (`{clave}.xml`, `{clave}_respuesta.xml`, `{clave}.pdf`). | F4 DEC-013 | Active. |
| `DELIVERED` is a stale terminal guard: delivery worker uses `updateMany WHERE status <> DELIVERED`. | F4 | Active. |
| `DeliveryRetryClassifier` classifies 14 error classes; `ARTIFACT_HASH_MISMATCH` triggers MRR + security audit; exponential backoff 60s base, 3600s cap, 30s jitter, max 8 retries. | F4 | Active. |
| SMTP credentials are currently plain env vars; `SecretProvider` migration required before production. | F4 | Active limitation. |
| Extend `FiscalDocumentsModule` for certificate management (no new NestJS module). | F5 DEC-001 | Active. |
| Store `extractedIdentityNumber` and `extractedIdentityType` as explicit DB columns on `fiscal_signing_certificates`; do not re-parse `subjectName` at signing time. | F5 DEC-002 | Active. |
| Block Company identity changes that would make an ACTIVE certificate incompatible (`FISCAL_CERTIFICATE_IDENTITY_CONFLICT` HTTP 409); automatic deactivation is explicitly prohibited. | F5 DEC-003 | Active. |
| Use `node-forge` (existing dependency) for PKCS#12 parsing and OID 2.5.4.5 extraction; no new certificate library. | F5 DEC-004 | Active. |
| `FiscalCertificateController` uses `multer.memoryStorage()` per-interceptor override; PKCS#12 bytes never written to disk. | F5 DEC-005 | Active. |
| Certificate upload API accepts PKCS#12 only (not PEM) for P0. | F5 DEC-006 | Active. |
| Certificate PIN transmitted as multipart form field (not header, not query parameter). | F5 DEC-007 | Active. |
| Rotation reuses the same 14-step `UploadFiscalSigningCertificateService.execute()` flow; no separate rotation service. | F5 DEC-008 | Active. |
| `FiscalSigningCertificateService.getActiveCertificate()` identity check is activated by presence of `extractedIdentityNumber`; backward-compatible with legacy NULL rows. | F5 DEC-009 | Active. |

## 13. Known architectural limitations

- F2.2/F3/F4/F5 application services directly use Prisma; repository ports are not consistently extracted.
- Worker process uses full `AppModule` instead of a minimized worker module.
- No dedicated submission, artifact, delivery or certificate scopes; current JWT/TENANT_ADMIN role check and write/read scopes authorize operations.
- `@SkipThrottle()` remains on fiscal and F4/F5 controllers; rate/quota policy needs approval.
- Prepare XML concurrent duplicate processing remains a prior hardening item.
- XMLDSig/XAdES remains manually assembled behind a port.
- Production IAM/SecretProvider readiness is not proven in repo-level code/tests.
- npm audit vulnerabilities remain unresolved.
- SMTP credentials are plain env vars (not yet SecretProvider-backed).
- F4.1 rejected document replacement obligation is not implemented.
- `PDF_RENDERER` binding uses `NODE_ENV === 'production'` rather than a dedicated flag.
- Live PostgreSQL migration deploy for F4 migration pending; Prisma validate PASS only.
- F4-S bootstrap `FiscalSigningCertificate` row has `extractedIdentityNumber = NULL`; pre-signing defense-in-depth check (F5 DEC-009) skips identity validation for that legacy row. Operator must re-upload via new API to fully activate identity validation for the legacy row.
- F5 `UpdateCompanyHandler` imports `FiscalCertificateIdentityConflictException` from the `fiscal-documents` domain — a deliberate cross-module domain-exception reference that is acceptable but noted as a bounded-context dependency.

## 14. Open decisions requiring clarification

1. What exact production IAM/SecretProvider provisioning and runtime access model satisfies OQ-012 before live Hacienda use?
2. Should fiscal submission/delivery/certificate operations get dedicated scopes (`fiscal-submissions:*`, `fiscal-certificates:*`, `fiscal-artifacts:*`, `fiscal-deliveries:*`), or continue using JWT+role and invoice/ticket scopes?
3. What throttle/quota policy should apply to `prepare-xml`, submit, reconcile, artifact download, delivery and certificate upload endpoints?
4. Should UUID validation be implemented globally or per fiscal controller?
5. Should `FiscalSubmissionRepositoryPort` or `FiscalDeliveryRepositoryPort` be extracted now or deferred?
6. What is the approved F4.1 contract for rejected document replacement and re-issuance workflow?
7. Should SMTP credentials be migrated to `SecretProvider` before general production availability, and what is the migration timeline?
8. What is the approved storage lifecycle/retention policy for the 5-year artifact retention obligation?
9. Should `PDF_RENDERER` selection use a dedicated `USE_REAL_PDF` flag for symmetry with `USE_REAL_HACIENDA`?
10. Should the F4-S bootstrap `FiscalSigningCertificate` row (NULL `extractedIdentityNumber`) be re-uploaded via the new API before production signing operations, and when?
11. Is the cross-module import of `FiscalCertificateIdentityConflictException` from `fiscal-documents` domain into the `companies` use-case handler acceptable long-term, or should it be extracted to a shared domain exceptions module?

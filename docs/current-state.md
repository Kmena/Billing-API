# Current State

> **Synchronized:** Fiscal-company-configuration-and-secure-credentials implementation refresh by `hdd-architecture-agent-3fd9e0` on 2026-09-23 for confirmed `specs/fiscal-company-configuration-and-secure-credentials`. Documentation reflects completed implementation.
>
> **Validation evidence recorded from completed fiscal-company-configuration implementation:** TypeScript `npx tsc --noEmit` PASS (0 errors); lint 0 errors on all new/modified files; tests **893 PASS, 71/72 suites PASS, 1 pre-existing FAIL** (`f3-postgres-concurrency.spec.ts` — DB teardown FK ordering, unrelated, unchanged); Prisma validate PASS; Prisma generate PASS. 78 new tests added. 0 regressions from F4 baseline (531 tests / 57 suites). Prior F4 baseline: 531 tests / 57 suites.

## 1. System overview

Billing is a multi-tenant Costa Rica electronic invoicing API implemented as a NestJS/TypeScript modular monolith with Prisma/PostgreSQL persistence, API and worker entrypoints, object storage, secrets abstraction and pg-boss-backed queueing.

Implemented/current capabilities:

| Area | Current implemented capability |
|---|---|
| Foundation | Tenants, users, JWT authentication, refresh tokens, API keys, company management, audit log, health checks, validated configuration and Prisma/PostgreSQL. |
| Hacienda public queries | Taxpayer, CABYS and exchange-rate lookup modules with Hacienda integration ports/adapters and mock support. |
| Hacienda connection | Per-company/per-environment credential lifecycle and connection validation; OIDC auth adapter, process-local token cache and `SecretProvider` integration. |
| Fiscal document core | Issuance points, sequences, immutable FE/TE fiscal documents, idempotent API creation, fiscal snapshots and `READY_FOR_XML`. |
| Fiscal XML/signing | FE/TE v4.4 XML serialization from snapshots, XSD 1.1 validation, PKCS#12/PFX signing, local verification and private XML artifact persistence ending in `READY_TO_SUBMIT`. |
| Hacienda asynchronous submission (F3) | Submission state machine, retry classifier, `FiscalSubmission` persistence, `HaciendaSubmissionPort`, mock/real recepcion adapters, submit/status/reconcile/callback APIs, queue worker registration, submit/reconcile worker paths, response artifact persistence, audit/observability/security/concurrency/E2E coverage. |
| Fiscal artifacts, PDF & delivery (F4) | Unified `FiscalArtifact` metadata model, PDF generation (PDFKit, `BILLING_DEFAULT_V1` template with QR, multi-page), two-stage email delivery (`INITIAL_DOCUMENT` + `HACIENDA_RESPONSE`), delivery state machine, retry classification, delivery worker (pg-boss), manual resend API, protected artifact download API, company PDF branding/logo settings, F3/F4 hook and startup recovery, SHA-256 integrity verification before delivery/download, official Clave-based filename convention. |
| Fiscal certificate management and readiness (F5) | Self-service PKCS#12 certificate upload and rotation (14-step, `SecretProvider`, `multer.memoryStorage`, atomic DB transaction); Costa Rica OID 2.5.4.5 fiscal identity extraction and normalization (`CrCertificateIdentityExtractorService`, `node-forge`); certificate metadata read (safe, no secrets); 6-flag fiscal readiness check (`FiscalReadinessService`); pre-signing defense-in-depth identity re-validation (`FiscalSigningCertificateService` modified); company identity guard preventing incompatible identity changes while ACTIVE certificate exists (`UpdateCompanyHandler`, HTTP 409 `FISCAL_CERTIFICATE_IDENTITY_CONFLICT`); complete audit trail for all certificate lifecycle events. |

Phase status:

| Phase | Status |
|---|---|
| Foundation | Complete |
| Fase 1 Hacienda consultas | Complete |
| F2.1 Hacienda Connection | Complete |
| F2.2 Fiscal Document Core | Complete |
| F2.3 XML/XSD/XAdES | Complete for confirmed local prepare/sign/verify/XSD scope |
| F3 Hacienda async submission | Complete; audit Acceptable 8.6/10 |
| F4 Fiscal artifacts, PDF & delivery | Complete; all 23 tasks implemented; audit remediations AUD-001–AUD-005 confirmed |
| F5 Fiscal certificate management and readiness | Complete; 11 tasks implemented; 78 new tests; 893/71 suites passing |
| F4.1 Rejected document replacement | Not implemented; tracked as compliance gap |

## 2. Repository structure

Relevant current structure:

```text
Billing/
├── Dockerfile
├── docker-compose.yml
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       ├── 20260914193000_fiscal_submission/
│       ├── 20260915100000_f4_fiscal_artifacts_delivery/
│       ├── 20260916000000_f4_fix_delivery_unique_null/
│       ├── 20260920000000_fix_economic_activity_code_format/
│       └── 20260924000000_add_cert_extracted_identity/    (F5 new)
├── resources/hacienda/v4.4/
├── specs/
│   ├── fase-4-fiscal-artifacts-delivery/
│   └── fiscal-company-configuration-and-secure-credentials/   (F5 new)
├── src/bootstrap/
│   ├── api.main.ts
│   └── worker.main.ts
├── src/infrastructure/
│   ├── config/config.validation-schema.ts
│   ├── queue/
│   ├── secrets/
│   └── storage/
├── src/modules/companies/
│   ├── application/use-cases/
│   │   ├── create-company/
│   │   ├── get-company/
│   │   ├── get-fiscal-profile/
│   │   ├── upsert-fiscal-profile/
│   │   └── update-company/                       (F5 new)
│   │       ├── update-company.handler.ts
│   │       └── __tests__/update-company.handler.spec.ts
│   ├── infrastructure/http/
│   │   ├── company.controller.ts                 (F5 modified — added PUT :id)
│   │   └── dtos/
│   │       └── update-company.request.dto.ts     (F5 new)
│   └── companies.module.ts                       (F5 modified — registered UpdateCompanyHandler)
├── src/modules/fiscal-documents/
│   ├── domain/
│   │   ├── delivery/                             (F4 new)
│   │   │   ├── document-delivery-status.enum.ts
│   │   │   ├── document-delivery-kind.enum.ts
│   │   │   ├── document-delivery-state-machine.ts
│   │   │   ├── delivery-retry-classifier.ts
│   │   │   └── invalid-clave.exception.ts
│   │   ├── fiscal-xml/
│   │   │   ├── exceptions/
│   │   │   │   └── fiscal-certificate.exceptions.ts  (F5 new — 13 DomainException classes)
│   │   │   └── fiscal-xml.errors.ts              (F5 modified — added cert identity error codes)
│   │   └── submission/
│   ├── application/
│   │   ├── artifacts/                            (F4 new)
│   │   │   ├── fiscal-evidence-resolver.service.ts
│   │   │   ├── fiscal-artifact.service.ts
│   │   │   └── generate-fiscal-pdf.service.ts
│   │   ├── pdf/                                  (F4 new)
│   │   │   ├── pdf-renderer.port.ts
│   │   │   └── company-pdf-settings.service.ts
│   │   ├── qr/                                   (F4 new)
│   │   │   └── qr-content-builder.port.ts
│   │   ├── email/                                (F4 new)
│   │   │   └── email-delivery.port.ts
│   │   ├── delivery/                             (F4 new)
│   │   │   ├── delivery.constants.ts
│   │   │   ├── ensure-initial-fiscal-package.service.ts
│   │   │   ├── ensure-hacienda-response-delivery.service.ts
│   │   │   ├── delivery-worker.service.ts
│   │   │   └── delivery-request.service.ts
│   │   ├── fiscal-xml/
│   │   │   ├── cr-certificate-identity-extractor.service.ts  (F5 new)
│   │   │   ├── upload-fiscal-signing-certificate.service.ts  (F5 new)
│   │   │   ├── fiscal-read-certificate-metadata.service.ts   (F5 new)
│   │   │   ├── fiscal-readiness.service.ts                   (F5 new)
│   │   │   └── fiscal-signing-certificate.service.ts         (F5 modified)
│   │   └── submission/
│   ├── infrastructure/
│   │   ├── http/
│   │   │   ├── fiscal-certificate.controller.ts    (F5 new)
│   │   │   ├── fiscal-artifacts.controller.ts      (F4 new)
│   │   │   ├── fiscal-deliveries.controller.ts     (F4 new)
│   │   │   ├── company-pdf-settings.controller.ts  (F4 new)
│   │   │   └── … (existing controllers)
│   │   ├── pdf/                                    (F4 new)
│   │   │   ├── billing-default-v1-pdf-renderer.adapter.ts
│   │   │   └── mock-pdf-renderer.adapter.ts
│   │   ├── qr/                                     (F4 new)
│   │   │   ├── hacienda-qr-content-builder.adapter.ts
│   │   │   └── mock-qr-content-builder.adapter.ts
│   │   ├── email/                                  (F4 new)
│   │   │   ├── nodemailer-email-delivery.adapter.ts
│   │   │   └── mock-email-delivery.adapter.ts
│   │   └── submission/
│   └── fiscal-documents.module.ts                  (F5 modified — registered F5 services/controller)
├── src/api/filters/
│   └── global-exception.filter.ts                  (F5 modified — DomainException mapping for cert errors)
└── test/e2e/
```

## 3. Current architecture

The system is an API-first modular monolith with incremental hexagonal/ports-and-adapters practices. F4 extends the fiscal-documents boundary with delivery, artifact and PDF submodules. F5 adds certificate management, identity extraction, readiness checking and the company identity guard.

Implemented F5 dependency flow:

```text
[Certificate management]
FiscalCertificateController (POST/PUT/GET :env, GET :env/readiness)
  -> UploadFiscalSigningCertificateService
       -> CrCertificateIdentityExtractorService (pure — node-forge, no I/O)
       -> SecretProvider (storeSecret PKCS#12 + PIN; deleteSecret compensation)
       -> Prisma.$transaction (REPLACED old ACTIVE → new ACTIVE)
       -> AuditService (SECURITY — fiscal-certificate.activated / upload-rejected)
  -> FiscalReadCertificateMetadataService
       -> Prisma (select without secret columns)
  -> FiscalReadinessService
       -> Prisma (CompanyFiscalProfile, HaciendaConnection, FiscalSigningCertificate, FiscalIssuancePoint)

[Company identity guard]
CompanyController PUT /companies/:id
  -> UpdateCompanyHandler (TENANT_ADMIN required)
       -> assertNoCertificateIdentityConflict
            -> Prisma (FiscalSigningCertificate WHERE tenantId+companyId+status='ACTIVE')
            -> throws FiscalCertificateIdentityConflictException (HTTP 409) if mismatch
       -> Prisma.company.update
       -> AuditService (SECURITY or TECHNICAL)

[Defense-in-depth — pre-signing]
PrepareFiscalXmlService
  -> FiscalSigningCertificateService.getActiveCertificate
       [if extractedIdentityNumber present]
       -> Prisma.company (identificationNumber)
       -> compare certId vs companyId (lowercase, trimmed)
       -> throws FISCAL_CERTIFICATE_EMITTER_MISMATCH if mismatch
       -> SecretProvider.getSecret (PKCS#12 + PIN)
```

Implemented F4 dependency flow (unchanged):

```text
FiscalArtifactsController / FiscalDeliveriesController / CompanyPdfSettingsController
  -> application services
    -> FiscalArtifactService / FiscalEvidenceResolverService / GenerateFiscalPdfService
    -> CompanyPdfSettingsService
    -> EnsureInitialFiscalPackageService / EnsureHaciendaResponseDeliveryService
    -> DeliveryRequestService
    -> DeliveryWorkerService (OnModuleInit → pg-boss handler)
      -> DocumentDeliveryStateMachine (domain)
      -> DeliveryRetryClassifier (domain)
      -> QrContentBuilderPort <- HaciendaQrContentBuilderAdapter | MockQrContentBuilderAdapter
      -> PdfRendererPort <- BillingDefaultV1PdfRendererAdapter | MockPdfRendererAdapter
      -> EmailDeliveryPort <- NodemailerEmailDeliveryAdapter | MockEmailDeliveryAdapter
      -> StoragePort (SHA-256 verified reads)
      -> Prisma (DocumentDelivery, DeliveryAttempt, FiscalArtifact)
      -> AuditService (delivery events, integrity failures, downloads)

F3/F4 integration:
  FiscalSubmissionStateService.applyProviderResult (terminal status)
    -> @Optional() EnsureHaciendaResponseDeliveryService + setImmediate (DEC-011)
  PrepareFiscalXmlService (READY_TO_SUBMIT reached)
    -> @Optional() EnsureInitialFiscalPackageService + setImmediate
```

## 4. Existing domains and modules

| Domain / Module | Responsibility | Current code location |
|---|---|---|
| Identity and access | Tenants, users, JWT, refresh tokens, API keys, scopes and company authorization. | `src/modules/identity`, `src/modules/api-keys` |
| Companies | Company identity, fiscal profile/readiness data, PDF branding settings and company update with certificate identity guard. | `src/modules/companies` |
| Hacienda public queries | Taxpayer, CABYS and exchange-rate lookups. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda connection | Credential references, validation, OAuth/OIDC auth and token cache. | `src/modules/hacienda-connection` |
| Fiscal documents | Issuance, immutable snapshots, XML readiness, submission lifecycle and terminal Hacienda outcome. | `src/modules/fiscal-documents` |
| Fiscal XML/signing | Hacienda v4.4 FE/TE XML, signing, validation, XML artifacts and pre-signing identity re-validation. | `src/modules/fiscal-documents/**/fiscal-xml`, `src/infrastructure/signing` |
| Fiscal certificate management (F5) | PKCS#12 upload/rotation (14-step, SecretProvider), OID 2.5.4.5 extraction (node-forge), certificate metadata read, 6-flag readiness check, pre-signing defense-in-depth identity re-validation. | `src/modules/fiscal-documents/application/fiscal-xml/` (new F5 services), `domain/fiscal-xml/exceptions/`, `infrastructure/http/fiscal-certificate.controller.ts` |
| Fiscal submission | Asynchronous Hacienda submission, polling/reconciliation, callback signals and response artifacts. | `src/modules/fiscal-documents/**/submission` |
| Fiscal artifacts (F4) | Unified artifact metadata index for SIGNED_XML, HACIENDA_RESPONSE_XML and PDF; SHA-256 integrity; protected download; evidence resolver. | `src/modules/fiscal-documents/**/artifacts` |
| Fiscal PDF & branding (F4) | PDF generation from immutable evidence, PDFKit renderer, QR code, multi-page pagination, company branding/logo. | `src/modules/fiscal-documents/**/pdf`, `**/qr`, `**/infrastructure/pdf`, `**/infrastructure/qr` |
| Fiscal delivery (F4) | Two-stage email delivery (INITIAL_DOCUMENT + HACIENDA_RESPONSE), delivery state machine, retry classification, delivery worker, manual resend, DeliveryAttempt history. | `src/modules/fiscal-documents/**/delivery`, `**/infrastructure/email` |
| Audit | Audit event recording. | `src/modules/audit` |
| Infrastructure | Config, database, queue, secrets, storage, tenant context and integrations. | `src/infrastructure` |

## 5. Main use cases

Implemented fiscal use cases include all prior F0–F3 use cases plus F4 and F5:

11. List fiscal artifact metadata (`GET .../artifacts`) — returns `FiscalArtifactMetadata[]`; never exposes storage keys; tenant/company-scoped.
12. Download fiscal artifact (`GET .../artifacts/:id/download`) — SHA-256 verified, streamed with official `Content-Disposition` filename, `Cache-Control: no-store`, audited.
13. Trigger initial fiscal package delivery automatically at `READY_TO_SUBMIT`: generate PDF from immutable snapshot + signed XML, create `INITIAL_DOCUMENT` `DocumentDelivery` row, enqueue pg-boss job.
14. Trigger Hacienda response delivery automatically after F3 authoritative response: create `HACIENDA_RESPONSE` `DocumentDelivery` row, enqueue job, startup recovery scan on module init.
15. Process delivery jobs (worker): fetch and SHA-256-verify artifact bytes, attach as official-filename attachments, send via `EmailDeliveryPort`, classify result, update `DocumentDelivery`/`DeliveryAttempt`, enforce DELIVERED non-regression stale guard.
16. List delivery history (`GET .../deliveries`) — returns `DeliveryHistoryDto`; no raw Prisma/PII in response.
17. Manual resend delivery (`POST .../deliveries` with kind) — reuses immutable artifacts; creates new `DeliveryAttempt`; CANCELLED guard; audited.
18. Update company PDF branding settings (`PUT /companies/:companyId/pdf-settings`) — safe fields only (colors, footer text, showCommercialName).
19. Upload company logo (`POST /companies/:companyId/pdf-settings/logo`) — magic-byte validation (PNG/JPEG/WebP), 2 MB limit, SVG rejected, stored under tenant/company isolation.
20. Upload PKCS#12 signing certificate (`POST /companies/:id/fiscal-certificates/:env`) — 14-step validation: size, Company load, PKCS#12 parse, PIN, private key, certificate, OID 2.5.4.5 extraction, identity comparison, date validity, SecretProvider storage, atomic DB activation. TENANT_ADMIN. Returns safe metadata.
21. Rotate signing certificate (`PUT /companies/:id/fiscal-certificates/:env`) — same 14-step flow; old ACTIVE cert marked REPLACED atomically. TENANT_ADMIN.
22. Read active certificate safe metadata (`GET /companies/:id/fiscal-certificates/:env`) — fingerprint, serial, subject, issuer, dates, extractedIdentityNumber, extractedIdentityType, status. Never exposes secret references.
23. Check fiscal readiness (`GET /companies/:id/fiscal-certificates/:env/readiness`) — aggregates 6 flags across fiscal profile, Hacienda connection, certificate presence/validity/identity, and issuance point. Returns `readyToIssue` boolean and `reasonCodes[]`.
24. Update company identity fields with certificate guard (`PUT /companies/:id`) — identity field changes trigger `assertNoCertificateIdentityConflict`; incompatible changes return HTTP 409 `FISCAL_CERTIFICATE_IDENTITY_CONFLICT`; unrelated field changes always succeed. TENANT_ADMIN.

## 6. Current data flows

### F4 initial delivery flow

1. `PrepareFiscalXmlService` completes XML signing and transitions document to `READY_TO_SUBMIT`.
2. Via `@Optional()` injection + `setImmediate`, calls `EnsureInitialFiscalPackageService.ensure()`.
3. Service calls `GenerateFiscalPdfService` to produce/reuse PDF artifact from immutable snapshot (idempotent by DB unique constraint).
4. Service creates `DocumentDelivery` (kind=`INITIAL_DOCUMENT`) and publishes pg-boss job.
5. `DeliveryWorkerService` picks up the job; resolves signed XML bytes + PDF bytes; SHA-256 verifies each; attaches as `{clave}.xml` + `{clave}.pdf`; calls `EmailDeliveryPort`.
6. On success: transitions `DocumentDelivery` to `DELIVERED`; records `DeliveryAttempt`; audits.
7. On failure: `DeliveryRetryClassifier` determines `RETRY_PENDING`, `FAILED` or `MANUAL_REVIEW_REQUIRED`; schedules exponential backoff (60s base, 3600s cap, 30s jitter, max 8 retries).
8. Missing recipient email is a non-error condition; delivery is skipped gracefully.

### F4 Hacienda response delivery flow

1. `FiscalSubmissionStateService.applyProviderResult` reaches authoritative `ACCEPTED` or `REJECTED`.
2. Via `@Optional()` injection + `setImmediate`, calls `EnsureHaciendaResponseDeliveryService.ensure()`.
3. Service creates `DocumentDelivery` (kind=`HACIENDA_RESPONSE`) and publishes pg-boss job.
4. Worker resolves Hacienda response XML bytes; SHA-256 verifies; attaches as `{clave}_respuesta.xml`; calls `EmailDeliveryPort`.
5. `REJECTED` deliveries are delivered with response content but do not present the comprobante as valid.
6. On module init, `EnsureHaciendaResponseDeliveryService.onModuleInit()` runs a startup recovery scan via `setImmediate` for missed deliveries.

### F4 artifact download flow

1. API key client calls `GET .../artifacts/:id/download` with appropriate scope.
2. `FiscalArtifactService.downloadArtifact()` fetches `FiscalArtifact` metadata; verifies tenant/company scope.
3. Storage bytes fetched via `StoragePort`; SHA-256 re-verified against stored hash.
4. Response streamed with `Content-Disposition: attachment; filename="{clave}.pdf|.xml|_respuesta.xml"`, `Content-Type` and `Cache-Control: no-store`.
5. Download audited with `EventClass.FISCAL_AUDIT`.

### F5 certificate upload flow

1. `TENANT_ADMIN` calls `POST /companies/:id/fiscal-certificates/:env` with `multipart/form-data` (`certificate` file field + `pin` body field).
2. `FiscalCertificateController` receives file in `file.buffer` — `multer.memoryStorage()` ensures PKCS#12 bytes never touch the filesystem.
3. Controller validates file and PIN presence; calls `UploadFiscalSigningCertificateService.execute()`.
4. Service validates file size ≤ 1 MB (configurable via `FISCAL_CERT_MAX_SIZE_BYTES`).
5. Service loads Company from DB (tenant-scoped; must be ACTIVE).
6. Service calls `CrCertificateIdentityExtractorService.extractAndValidate(buffer, pin)`: parses PKCS#12, verifies PIN, confirms private key and certificate presence, extracts OID 2.5.4.5, normalizes identity (strips CPJ-/CF-/DIMEX- prefix), derives type code.
7. Service compares `extractedIdentityNumber` against `Company.identificationNumber` (case-insensitive, trimmed); throws `FISCAL_CERTIFICATE_EMITTER_MISMATCH` (audited as SECURITY) if mismatch.
8. Service validates certificate dates (not expired, not pre-valid).
9. Service calls `SecretProvider.storeSecret(certRef, JSON.stringify({ pkcs12Base64 }))` — PKCS#12 bytes stored only here.
10. Service calls `SecretProvider.storeSecret(pinRef, pin)` — PIN stored only here.
11. Service executes `Prisma.$transaction`: marks existing ACTIVE cert as `REPLACED` (with `replacedById`); inserts new ACTIVE cert row with safe metadata only.
12. On transaction failure: attempts `deleteSecret(certRef)` and `deleteSecret(pinRef)` (compensation); logs WARNING on cleanup failure; throws `FISCAL_CERTIFICATE_PERSIST_FAILED`.
13. Service emits `fiscal-certificate.activated` (SECURITY) audit event with safe metadata (no secrets).
14. Controller returns safe metadata DTO (no `certificateSecretReference`, no `passwordSecretReference`, no PKCS#12 bytes, no PIN).

### F5 company identity guard flow

1. `TENANT_ADMIN` calls `PUT /companies/:id` with `{ identificationType?, identificationNumber?, legalName?, tradeName? }`.
2. `CompanyController` enforces TENANT_ADMIN role; calls `UpdateCompanyHandler.execute()`.
3. Handler loads current company (tenant-scoped).
4. Handler computes `identityWouldChange` by comparing proposed values against current values.
5. If identity would change: handler calls `assertNoCertificateIdentityConflict()`, which loads ACTIVE `FiscalSigningCertificate` for same `(tenantId, companyId)`.
6. If ACTIVE cert has `extractedIdentityNumber`: compares vs proposed new `identificationNumber` (case-insensitive, trimmed) and maps `extractedIdentityType` code to Prisma enum for `identificationType` comparison.
7. If mismatch: emits `company.identity-change-blocked-by-certificate-conflict` (SECURITY) audit; throws `FiscalCertificateIdentityConflictException` (HTTP 409). No certificate modified. No company data changed.
8. If compatible or no ACTIVE cert: handler applies `Prisma.company.update`; emits `company.identity-updated` (SECURITY) or `company.updated` (TECHNICAL) audit.

### F5 pre-signing defense-in-depth flow

1. `PrepareFiscalXmlService` calls `FiscalSigningCertificateService.getActiveCertificate()`.
2. Service loads `FiscalSigningCertificate` from DB (tenant+company+environment scoped).
3. Service validates status = ACTIVE and dates not expired/pre-valid.
4. If `certificate.extractedIdentityNumber` is present (not NULL): service loads `Company.identificationNumber` from DB.
5. Compares `certId` vs `companyId` (case-insensitive, trimmed). If mismatch: logs WARNING with suffix redaction; throws `BadRequestException` with code `FISCAL_CERTIFICATE_EMITTER_MISMATCH`.
6. On pass: calls `SecretProvider.getSecret` for PKCS#12 and PIN; returns `FiscalSigningCertificateContext` to signer.

## 7. Database and persistence

Current fiscal persistence models:

- `FiscalDocumentStatus`: `READY_FOR_XML`, `XML_GENERATED`, `XML_VALIDATED`, `SIGNED`, `READY_TO_SUBMIT`, `ACCEPTED`, `REJECTED`.
- `FiscalSubmissionStatus`: `REQUESTED`, `QUEUED`, `SUBMITTING`, `POST_OUTCOME_UNKNOWN`, `ACKNOWLEDGED`, `PROCESSING`, `ACCEPTED`, `REJECTED`, `TECHNICAL_RETRY_PENDING`, `MANUAL_REVIEW_REQUIRED`.
- `DocumentDeliveryStatus` (F4): `PENDING`, `QUEUED`, `SENDING`, `DELIVERED`, `RETRY_PENDING`, `FAILED`, `MANUAL_REVIEW_REQUIRED`, `CANCELLED`.
- `DocumentDeliveryKind` (F4): `INITIAL_DOCUMENT`, `HACIENDA_RESPONSE`.
- `FiscalArtifactType` (F4): `SIGNED_XML`, `HACIENDA_RESPONSE_XML`, `PDF`.
- `DocumentDeliveryChannel` (F4): `EMAIL`.

F4 tables (migration `20260915100000_f4_fiscal_artifacts_delivery`):

| Table | Purpose | Key constraints |
|---|---|---|
| `fiscal_artifacts` | Unified artifact metadata index (storage key, sha256, content type, size, template/renderer version). | Unique: `(fiscalDocumentId, type, templateId, rendererVersion)`. |
| `company_pdf_settings` | Safe company PDF branding (logo ref, colors, footer text). One row per company. | Unique on `companyId`. |
| `document_deliveries` | Delivery lifecycle per kind/channel/recipient. | Unique: `(fiscalDocumentId, kind, channel, recipient, packageVersion)`. Indexes on scope+status, due-work. |
| `delivery_attempts` | Immutable append-only delivery attempt history. | Index on `(deliveryId, attemptNumber)`. |

Important constraints/invariants:

- `FiscalArtifact` XML types reference existing F2.3/F3 storage keys; no byte duplication.
- `DocumentDelivery.status` never writes to `FiscalDocument.status` (enforced in state machine and all worker paths).
- `DELIVERED` status is a stale terminal guard: worker uses `updateMany WHERE status <> DELIVERED`.
- PDF artifacts are idempotent under concurrent generation by DB unique constraint.
- Artifact SHA-256 is verified before delivery and before download streaming.
- `DeliveryAttempt` rows are append-only (no updates).
- Logo storage keys are never exposed in API responses; only SHA-256 and content type are available.

F5 schema additions to `fiscal_signing_certificates` (migration `20260924000000_add_cert_extracted_identity`):

| New column | Type | Nullable | Purpose |
|---|---|---|---|
| `extracted_identity_number` | `VARCHAR(30)` | YES | Normalized CR fiscal ID from OID 2.5.4.5 (prefixes stripped, e.g. `3102123456`) |
| `extracted_identity_type` | `VARCHAR(20)` | YES | Derived type code: `01`=FISICA (CF-), `02`=JURIDICA (CPJ-), `03`=DIMEX; NULL for unknown prefix or legacy rows |

F5 security invariants on `fiscal_signing_certificates`:

- No PKCS#12 bytes, PIN, private key or any plaintext secret material in PostgreSQL — confirmed by implementation and sentinel tests.
- `certificateSecretReference` and `passwordSecretReference` store only SecretProvider path strings.
- At most one ACTIVE certificate per `(tenantId, companyId, environment)` at any time — enforced by rotation transaction.
- `extractedIdentityNumber` is safe to store (public tax identification number).

Current migrations are forward-only and include:
- `20260914193000_fiscal_submission` (F3)
- `20260915100000_f4_fiscal_artifacts_delivery` (F4)
- `20260916000000_f4_fix_delivery_unique_null` (F4 fix)
- `20260920000000_fix_economic_activity_code_format` (data fix)
- `20260924000000_add_cert_extracted_identity` (F5)

Prisma validate: PASS against all migrations.

## 8. APIs and integrations

All paths are under `/api/v1`.

Previously implemented (F0–F3) endpoints unchanged. F5 adds:

| Method/path | Auth | Current behavior |
|---|---|---|
| `POST /companies/:companyId/fiscal-certificates/:environment` | JWT + TENANT_ADMIN | Upload PKCS#12 certificate + PIN (multipart). 14-step validation. Atomic rotation. Returns safe metadata. HTTP 201. |
| `PUT /companies/:companyId/fiscal-certificates/:environment` | JWT + TENANT_ADMIN | Rotate ACTIVE certificate. Same flow as POST. HTTP 200. |
| `GET /companies/:companyId/fiscal-certificates/:environment` | JWT (any role) | Returns ACTIVE certificate safe metadata. No secrets. HTTP 200 or 404. |
| `GET /companies/:companyId/fiscal-certificates/:environment/readiness` | JWT (any role) | Returns `readyToIssue`, `reasonCodes[]`, `activeCertificate` safe metadata. HTTP 200. |
| `PUT /companies/:companyId` | JWT + TENANT_ADMIN | Partial company update. Identity field changes guarded by certificate compatibility check (HTTP 409 if conflict). Audited. |

F4 adds:

| Method/path | Auth | Current behavior |
|---|---|---|
| `GET /companies/:companyId/fiscal-documents/:environment/invoices/:id/artifacts` | API key + `invoices:read` | Lists `FiscalArtifactMetadata[]` — no storage keys. |
| `GET /companies/:companyId/fiscal-documents/:environment/tickets/:id/artifacts` | API key + `tickets:read` | Lists `FiscalArtifactMetadata[]` — no storage keys. |
| `GET /companies/:companyId/fiscal-documents/:environment/invoices/:id/artifacts/:artifactId/download` | API key + `invoices:read` | SHA-256-verified artifact download; official `Content-Disposition` filename; `Cache-Control: no-store`; audited. |
| `GET /companies/:companyId/fiscal-documents/:environment/tickets/:id/artifacts/:artifactId/download` | API key + `tickets:read` | SHA-256-verified artifact download; official `Content-Disposition` filename; `Cache-Control: no-store`; audited. |
| `GET /companies/:companyId/fiscal-documents/:environment/invoices/:id/deliveries` | API key + `invoices:read` | Returns `DeliveryHistoryDto[]`; no raw Prisma/PII. |
| `GET /companies/:companyId/fiscal-documents/:environment/tickets/:id/deliveries` | API key + `tickets:read` | Returns `DeliveryHistoryDto[]`; no raw Prisma/PII. |
| `POST /companies/:companyId/fiscal-documents/:environment/invoices/:id/deliveries` | API key + `invoices:write` | Manual resend (kind: INITIAL_DOCUMENT\|HACIENDA_RESPONSE); HTTP 202; audited; CANCELLED guard. |
| `POST /companies/:companyId/fiscal-documents/:environment/tickets/:id/deliveries` | API key + `tickets:write` | Manual resend; HTTP 202; audited; CANCELLED guard. |
| `PUT /companies/:companyId/pdf-settings` | API key + `invoices:write` | Update safe branding fields (colors, footer, showCommercialName). |
| `POST /companies/:companyId/pdf-settings/logo` | API key + `invoices:write` | Upload logo; magic-byte validation (PNG/JPEG/WebP only); 2 MB limit; SVG rejected. |

New external integration:

- `NodemailerEmailDeliveryAdapter`: SMTP-based (SES/SendGrid/Resend compatible). Active when `EMAIL_USE_REAL=true`. Requires `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_ADDRESS` in configuration. Attachments use official Hacienda filenames.
- `MockEmailDeliveryAdapter`: CI/test default. Configurable outcome; captured records for test assertions.

## 9. Authentication and authorization

- F4 artifact list and download use existing `invoices:read` / `tickets:read` scopes.
- F4 delivery history uses existing `invoices:read` / `tickets:read` scopes.
- F4 manual resend and PDF settings use existing `invoices:write` / `tickets:write` scopes.
- No new dedicated F4 scopes have been introduced.
- Tenant/company authorization is enforced on all F4 operations; storage keys are never exposed.
- Logo upload authorizes via `invoices:write`; internal logo storage key is never returned to API callers.
- F5 certificate upload, rotation and company update (`PUT /companies/:id`) require **JWT + `TENANT_ADMIN` role**; the role check is enforced inside the controller (`assertTenantAdmin`) or handler before any service is called.
- F5 certificate metadata read and readiness check require **JWT (any authenticated role)**.
- No new API-key scopes have been introduced for F5; authorization is role-based (JWT only) for certificate management.
- All F5 queries are scoped by `tenantId` — certificates, company records and readiness data from other tenants are never accessible.

## 10. Events and background processing

- `DeliveryWorkerService` implements `OnModuleInit` and registers a pg-boss handler for `DELIVERY_JOB_NAME` on module init (AUD-001 remediation pattern, consistent with F3 worker).
- `EnsureHaciendaResponseDeliveryService` implements `OnModuleInit` and runs a startup recovery scan via `setImmediate` to catch missed deliveries (AUD-003 remediation).
- F3/F4 hook: `FiscalSubmissionStateService.applyProviderResult` calls `EnsureHaciendaResponseDeliveryService` via `@Optional()` injection + `setImmediate` when terminal status is reached (DEC-011).
- `PrepareFiscalXmlService` calls `EnsureInitialFiscalPackageService` via `@Optional()` injection + `setImmediate` at `READY_TO_SUBMIT`.
- Delivery job payloads contain `deliveryId` only — no bytes, credentials or tokens.
- Retry backoff: 60s base, 3600s cap, 30s jitter, max 8 retries (configurable via `DELIVERY_MAX_RETRIES`).
- Delivery failure never triggers a fiscal state change.
- Stale `SENDING` protection: worker uses `updateMany WHERE status <> DELIVERED`.

## 11. Containers and deployment

- Multi-stage `Dockerfile` builds NestJS runner image; build PASS in F4 validation evidence.
- `docker-compose.yml` remains local/development oriented.
- F4 adds new required environment variables for production: `HACIENDA_QR_URL_BASE` (required in production/staging), `SMTP_*`, `EMAIL_*`, `PDF_*`, `DELIVERY_MAX_RETRIES`.
- `HACIENDA_QR_URL_BASE` has a mock default for dev/test; production/staging fails fast at startup if missing.
- SMTP credentials are currently plain environment variables; migration to `SecretProvider` is a pre-production requirement.

## 12. Current testing strategy

Current evidence recorded from the completed F5 (fiscal-company-configuration) implementation:

- `npx tsc --noEmit`: PASS (0 errors).
- `npx eslint --fix` on all new/modified files: PASS (0 errors).
- `npm test -- --silent`: **893 PASS, 71/72 suites PASS, 1 pre-existing FAIL** (`f3-postgres-concurrency.spec.ts`).
- `npx prisma validate`: PASS.
- `npx prisma generate`: PASS.

F5 test suites added (8 new suites, 78 new tests):

| Suite | Tests | Coverage |
|---|---|---|
| `cr-certificate-identity-extractor.service.spec.ts` | 11 | OID extraction, PIN validation, format errors, expiry, identity normalization, sentinel PIN absence in errors |
| `upload-fiscal-signing-certificate.service.spec.ts` | 11 | Happy path, rotation, identity mismatch, expired, storage failure, DB failure, audit secrets |
| `certificate-upload-logging-security.spec.ts` | 10 | Sentinel: PIN absent, PKCS#12 bytes absent, Base64 absent, private key absent, Authorization absent, cookies absent, audit metadata clean |
| `fiscal-signing-certificate.service.spec.ts` | 8 | Pre-signing identity check: match, mismatch, missing extractedIdentityNumber (legacy), cross-tenant isolation |
| `update-company.handler.spec.ts` | 13 | DEC-003: 13 scenarios including cross-tenant isolation, compatible identity update, blocked update, unrelated fields pass |
| `fiscal-readiness.service.spec.ts` | 8 | 6-flag combinations, all false, all true, secret-free response |
| `certificate-lifecycle-audit.spec.ts` | 9 | Lifecycle audit events, secret-free metadata, rejection audit |
| `fiscal-submission-worker-recovery.spec.ts` | 8 | AC-009: QUEUED/RETRY/POST_OUTCOME_UNKNOWN recovery, stale SUBMITTING, terminal states not re-enqueued |

F4 prior test suites (9 suites, ~160 tests):

| Suite | Tests (approx) |
|---|---|
| `document-delivery-state-machine.spec.ts` | 22 |
| `delivery-retry-classifier.spec.ts` | 28 |
| `qr-content-builder.spec.ts` | 20 |
| `fiscal-artifact.service.spec.ts` | 9 |
| `company-pdf-settings.service.spec.ts` | 10 |
| `delivery-fiscal-status-independence.spec.ts` | 8 |
| `delivery-mock-e2e.spec.ts` | 30 |
| `delivery-concurrency.spec.ts` | 15 |
| `delivery-security.spec.ts` | 18 |

All F4 and prior suites pass without modification. 0 regressions introduced by F5.

Live database integration tests (full PostgreSQL-backed concurrency and multi-page PDF) are pending live PostgreSQL environment; unit/mock coverage is complete.

This documentation refresh did not execute commands; it records final implementation evidence from the F5 cycle.

## 13. Behavior to preserve

- Modular monolith architecture and `/api/v1` prefix.
- Tenant/company/environment isolation and fail-closed authorization.
- Immutable fiscal document identity: no retry/reconcile/delivery path creates a new `FiscalDocument`, consecutive, Clave or semantically different signed XML.
- `READY_TO_SUBMIT` means local signed/XSD-ready, not Hacienda acceptance.
- Technical failures do not become fiscal `REJECTED`.
- `ACCEPTED`/`REJECTED` require authoritative Hacienda status/response.
- Ambiguous POST outcomes move to reconciliation by same Clave, not blind resubmission.
- Callback remains signal-only.
- `INITIAL_DOCUMENT` delivery does not require `ACCEPTED` (per Reglamento: emission and delivery occur at the moment of the sale/service).
- Delivery failure never changes `FiscalDocument.status` or `FiscalSubmission.status`.
- `DELIVERED` status never regresses to `FAILED` or `PENDING` due to stale workers.
- PDF bytes are derived exclusively from immutable `FiscalDocument` snapshot data.
- Exact signed XML and Hacienda response bytes are attached without re-serialization; SHA-256 verified before use.
- Internal storage keys never exposed to API callers.
- Official Hacienda filename convention enforced: `{clave}.xml`, `{clave}_respuesta.xml`, `{clave}.pdf`.
- Hacienda tokens/passwords/secrets and XML bodies are not logged or exposed by default.
- `REJECTED` Hacienda response is delivered truthfully; rejected comprobante not presented as valid.
- **F5 certificate identity invariants** — all of the following are active and must be preserved:
  - PKCS#12 bytes and PIN stored exclusively via `SecretProvider`; PostgreSQL contains only path references.
  - PKCS#12 never written to disk during upload (`multer.memoryStorage()` override).
  - Certificate identity validated at upload AND re-validated at every signing operation (defense-in-depth).
  - Certificate rotation is atomic: old ACTIVE cert remains ACTIVE until new cert is fully validated, stored and persisted.
  - Company identity changes that would make an ACTIVE certificate incompatible are blocked (HTTP 409); automatic deactivation is explicitly prohibited.
  - Cross-tenant certificates never participate in identity checks for any company.
  - All certificate lifecycle events audited with SECURITY event class; no secrets in audit metadata.
  - `extractedIdentityNumber` is the authoritative pre-signing comparison field; re-parsing `subjectName` at signing time is never used.
  - Restart recovery uses SAME Clave — no new FiscalDocument, no new consecutive, no new POST (AC-009 / FR-021 / BR-006).

## 14. Known defects

| ID | Severity | Current defect/risk |
|---|---|---|
| AUD-007 / SEC-REPO-001 | High | `npm audit` vulnerabilities remain unresolved (26+ known). No new vulnerable packages added by F4 or F5. |
| OQ-012 | High before production | Production IAM/SecretProvider/credential readiness for real Hacienda submission remains a pre-production deployment concern. |
| F4-PRE-001 | High before production | SMTP credentials are plain environment variables; migration to `SecretProvider` is required before production deployment. |
| F4-PRE-002 | High before production | `HACIENDA_QR_URL_BASE` exact production URL not yet confirmed; required in production/staging config; fails fast at startup if missing. |
| F4.1-001 | Medium (compliance gap) | Rejected document replacement obligation (Reglamento de Comprobantes Electrónicos) is not implemented. F4.1 is the dedicated remediation phase. Until F4.1 is complete, rejected comprobantes require manual operator remediation. Billing must NOT be declared fully production-ready for unattended fiscal issuance. |
| DEF-F1-RATE-001 | High | Auth login/refresh throttling enforcement remains unproven from earlier audits. |
| AUD-002 | Medium | Concurrent duplicate `prepare-xml` calls may race; prepare concurrency hardening is a prior F2.3 item. |
| AUD-003 | Medium | Expensive endpoints (`prepare-xml`, F3 submission, F4 artifact/delivery, F5 certificate upload) still decorated with `@SkipThrottle()`; quota/rate policy remains to be clarified. |
| AUD-008 | Medium | Some path params still lack UUID validation pipes. |
| F4-DB-001 | Low | Live PostgreSQL migration deploy verification for `20260915100000_f4_fiscal_artifacts_delivery` pending (Prisma validate PASS; live deploy not yet confirmed). |
| F5-LEGACY-001 | Low (operator action required) | F4-S bootstrap `FiscalSigningCertificate` row has `extractedIdentityNumber = NULL`. Pre-signing defense-in-depth check is skipped for this row (backward-compatible per DEC-009). Signing for this legacy row proceeds without identity validation. Operator must re-upload the certificate via the new API to populate identity metadata and activate full protection. |
| F5-ORPHAN-001 | Low (documented risk) | If `SecretProvider.storeSecret` succeeds but the DB transaction fails, the compensating `deleteSecret` is best-effort. Failure to clean up orphan secrets is logged as WARNING. Orphan secrets exist at deterministic paths (`fiscal-certs/{companyId}/{env}/cert-{fingerprint}` and `.../pin-{fingerprint}`) and can be audited and cleaned manually. |

## 15. Architectural debt

| ID | Severity | Debt |
|---|---|---|
| DEBT-F2.2-001 | Medium | `FiscalDocumentService` remains large and Prisma-coupled. |
| DEBT-F2.3-001 | Medium | XMLDSig/XAdES is still manually assembled behind the signing port. |
| DEBT-F2.3-002 | Medium | Prepare XML concurrency control can be hardened. |
| DEBT-F3-001 | Medium | F3 application services and workers directly use Prisma rather than a fiscal submission repository port; consistent with current fiscal style but less isolated than ideal hexagonal architecture. |
| DEBT-F3-002 | Medium | Worker bootstrap imports full `AppModule`; worker-only runtime boundaries are implicit. |
| DEBT-F3-003 | Low/Medium | No dedicated `fiscal-submissions:*` scopes; submission uses invoice/ticket write scopes. |
| DEBT-F4-001 | Medium | F4 delivery/artifact application services directly use Prisma (consistent with existing fiscal style but not fully port-isolated). |
| DEBT-F4-002 | Medium | SMTP credentials are plain `configService` variables, not yet behind `SecretProvider` abstraction. |
| DEBT-F4-003 | Low | Live PostgreSQL concurrency test for delivery and multi-page PDF integration test need live database and are pending. |
| DEBT-F4-004 | Low | `PDF_RENDERER` binding selects production/mock by `NODE_ENV === 'production'`; a dedicated `USE_REAL_PDF` flag or environment-config adapter pattern would be more explicit. |
| DEBT-F5-001 | Low | F5 `UpdateCompanyHandler` (in `companies` module) imports `FiscalCertificateIdentityConflictException` from `fiscal-documents` domain — a cross-module domain-exception reference. Acceptable currently but noted for future refactoring to a shared exceptions module if more cross-module references emerge. |
| DEBT-F5-002 | Low | F5 application services (`UploadFiscalSigningCertificateService`, `FiscalReadinessService`, `FiscalReadCertificateMetadataService`) directly use Prisma — consistent with current fiscal style but creates same repository-port gap as F3/F4. |

## 16. Security risks

| ID | Severity | Risk |
|---|---|---|
| SEC-REPO-001 | High | Existing npm audit vulnerabilities remain unresolved. |
| SEC-DEPLOY-001 | High | Production IAM/SecretProvider access must be verified before live Hacienda use (OQ-012). |
| SEC-F4-SMTP-001 | High before production | SMTP credentials passed as plain env vars; not yet behind SecretProvider. |
| SEC-REPO-002 | High | Docker Compose/default-secret concerns remain if reused outside local development. |
| SEC-F3-001 | Medium | Public callback cannot be cryptographically authenticated per verified contract; current mitigation is signal-only handling. |
| SEC-F3-002 | Medium | Submission, artifact, delivery and certificate upload endpoints skip throttling; abuse/cost policy needed before production. |
| SEC-F2.3-002 | Medium | `prepare-xml` is computationally expensive and currently skips throttling. |
| SEC-F2.3-003 | Medium | Path params without UUID validation increase input-handling noise. |
| SEC-F4-001 | Low | Logo upload validates magic bytes and MIME allowlist (PNG/JPEG/WebP, no SVG). Dimension/image-bomb limits beyond size are not currently implemented (size limit: 2 MB). |
| SEC-F4-002 | Low | `Content-Disposition` filename sanitization for CRLF/path-traversal applies to official Clave-based filenames; documented and implemented in artifact service. |
| SEC-F5-001 | ✅ MITIGATED | PKCS#12 disk-write risk: mitigated by `multer.memoryStorage()` override in `FiscalCertificateController`; confirmed by 10/10 sentinel tests. |
| SEC-F5-002 | ✅ MITIGATED | PIN/cert in logs: all `node-forge` exceptions sanitized before reaching `GlobalExceptionFilter`; `AuditService` metadata never includes secrets; confirmed by 10/10 sentinel tests in `certificate-upload-logging-security.spec.ts`. |
| SEC-F5-003 | ✅ MITIGATED | Secrets in PostgreSQL: confirmed only `certificateSecretReference` and `passwordSecretReference` (path strings) stored; no plaintext secret material. Confirmed by implementation review and sentinel tests. |
| SEC-F5-004 | Low (documented) | Orphan secret on DB transaction failure: compensating `deleteSecret` is best-effort; failure logged as WARNING. Orphan secrets are at deterministic, auditable paths. Risk is low and documented. |
| SEC-F5-005 | Low | `nestjs-pino` is installed in `node_modules` but not wired. If `LoggerModule` is ever added to `AppModule`, the pino redaction configuration documented in `specs/fiscal-company-configuration-and-secure-credentials/security-log-verification.md` and `architecture.md` section 11.5 MUST be applied before activation. |

## 17. Unknowns and assumptions

- OQ-012 remains `Requires clarification` before live production: exact production IAM/SecretProvider/credential provisioning and runtime access path.
- `HACIENDA_QR_URL_BASE` exact production URL must be confirmed before production deployment.
- SMTP credentials must be migrated to `SecretProvider` before production deployment.
- Real Hacienda sandbox/production acceptance with real taxpayer credentials is opt-in and not required for CI.
- Email delivery with real SMTP (SES/SendGrid/Resend) requires separate pre-production verification.
- Storage lifecycle policy for 5-year fiscal artifact retention is a deployment/operations concern not yet documented in repository.
- F4.1 rejected document replacement requires a separate specification before implementation.
- Whether Costa Rica Hacienda certificates always encode the fiscal identification in OID 2.5.4.5 has been validated with synthetic `node-forge` test fixtures; real production certificate behavior is assumed to follow A2 (per `specs/fiscal-company-configuration-and-secure-credentials/requirements.md`); operator must re-upload any real production certificate via the new API to confirm identity extraction.
- The F4-S bootstrap `FiscalSigningCertificate` row has `extractedIdentityNumber = NULL` (see F5-LEGACY-001). Operator must decide whether and when to re-upload this certificate via the new API.
- This refresh records final implementation evidence from the F5 cycle and did not re-run commands.

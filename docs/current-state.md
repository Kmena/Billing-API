# Current State

> **Synchronized:** F4 Fiscal Artifacts, PDF & Delivery documentation refresh by `hdd-architecture-agent-65ee79` on 2026-09-17 for confirmed `specs/fase-4-fiscal-artifacts-delivery`. Documentation-only refresh; no production code, tests, Prisma schema or migrations changed by this agent.
>
> **Validation evidence recorded from completed F4 implementation/audit-remediation cycle:** typecheck PASS; lint 0 errors (37 warnings, all pre-existing as-any in test mocks); tests **531 PASS, 2 SKIP, 0 FAIL (57 suites)**; build PASS; Prisma validate PASS. Audit findings AUD-001 through AUD-005 remediated. F2/F2.3/F3 regression check: 0 regressions. Prior baseline (pre-F4): 421 tests / 51 suites.

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
│       └── 20260915100000_f4_fiscal_artifacts_delivery/
├── resources/hacienda/v4.4/
├── specs/fase-4-fiscal-artifacts-delivery/
├── src/bootstrap/
│   ├── api.main.ts
│   └── worker.main.ts
├── src/infrastructure/
│   ├── config/config.validation-schema.ts   (F4: HACIENDA_QR_URL_BASE, SMTP_*, EMAIL_*, PDF_*, DELIVERY_*)
│   ├── queue/
│   ├── secrets/
│   └── storage/
├── src/modules/fiscal-documents/
│   ├── domain/
│   │   ├── delivery/                         (F4 new)
│   │   │   ├── document-delivery-status.enum.ts
│   │   │   ├── document-delivery-kind.enum.ts
│   │   │   ├── document-delivery-state-machine.ts
│   │   │   ├── delivery-retry-classifier.ts
│   │   │   └── invalid-clave.exception.ts
│   │   └── submission/
│   ├── application/
│   │   ├── artifacts/                        (F4 new)
│   │   │   ├── fiscal-evidence-resolver.service.ts
│   │   │   ├── fiscal-artifact.service.ts
│   │   │   └── generate-fiscal-pdf.service.ts
│   │   ├── pdf/                              (F4 new)
│   │   │   ├── pdf-renderer.port.ts
│   │   │   └── company-pdf-settings.service.ts
│   │   ├── qr/                               (F4 new)
│   │   │   └── qr-content-builder.port.ts
│   │   ├── email/                            (F4 new)
│   │   │   └── email-delivery.port.ts
│   │   ├── delivery/                         (F4 new)
│   │   │   ├── delivery.constants.ts
│   │   │   ├── ensure-initial-fiscal-package.service.ts
│   │   │   ├── ensure-hacienda-response-delivery.service.ts
│   │   │   ├── delivery-worker.service.ts
│   │   │   └── delivery-request.service.ts
│   │   ├── fiscal-xml/
│   │   └── submission/
│   ├── infrastructure/
│   │   ├── http/
│   │   │   ├── fiscal-artifacts.controller.ts      (F4 new)
│   │   │   ├── fiscal-deliveries.controller.ts     (F4 new)
│   │   │   ├── company-pdf-settings.controller.ts  (F4 new)
│   │   │   └── … (existing controllers)
│   │   ├── pdf/                              (F4 new)
│   │   │   ├── billing-default-v1-pdf-renderer.adapter.ts
│   │   │   └── mock-pdf-renderer.adapter.ts
│   │   ├── qr/                               (F4 new)
│   │   │   ├── hacienda-qr-content-builder.adapter.ts
│   │   │   └── mock-qr-content-builder.adapter.ts
│   │   ├── email/                            (F4 new)
│   │   │   ├── nodemailer-email-delivery.adapter.ts
│   │   │   └── mock-email-delivery.adapter.ts
│   │   └── submission/
│   └── fiscal-documents.module.ts
└── test/e2e/
```

## 3. Current architecture

The system is an API-first modular monolith with incremental hexagonal/ports-and-adapters practices. F4 extends the fiscal-documents boundary with delivery, artifact and PDF submodules.

Implemented F4 dependency flow:

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
| Companies | Company identity and fiscal profile/readiness data and PDF branding settings. | `src/modules/companies` |
| Hacienda public queries | Taxpayer, CABYS and exchange-rate lookups. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda connection | Credential references, validation, OAuth/OIDC auth and token cache. | `src/modules/hacienda-connection` |
| Fiscal documents | Issuance, immutable snapshots, XML readiness, submission lifecycle and terminal Hacienda outcome. | `src/modules/fiscal-documents` |
| Fiscal XML/signing | Hacienda v4.4 FE/TE XML, signing, validation and XML artifacts. | `src/modules/fiscal-documents/**/fiscal-xml`, `src/infrastructure/signing` |
| Fiscal submission | Asynchronous Hacienda submission, polling/reconciliation, callback signals and response artifacts. | `src/modules/fiscal-documents/**/submission` |
| Fiscal artifacts (F4) | Unified artifact metadata index for SIGNED_XML, HACIENDA_RESPONSE_XML and PDF; SHA-256 integrity; protected download; evidence resolver. | `src/modules/fiscal-documents/**/artifacts` |
| Fiscal PDF & branding (F4) | PDF generation from immutable evidence, PDFKit renderer, QR code, multi-page pagination, company branding/logo. | `src/modules/fiscal-documents/**/pdf`, `**/qr`, `**/infrastructure/pdf`, `**/infrastructure/qr` |
| Fiscal delivery (F4) | Two-stage email delivery (INITIAL_DOCUMENT + HACIENDA_RESPONSE), delivery state machine, retry classification, delivery worker, manual resend, DeliveryAttempt history. | `src/modules/fiscal-documents/**/delivery`, `**/infrastructure/email` |
| Audit | Audit event recording. | `src/modules/audit` |
| Infrastructure | Config, database, queue, secrets, storage, tenant context and integrations. | `src/infrastructure` |

## 5. Main use cases

Implemented fiscal use cases include all prior F0–F3 use cases plus:

11. List fiscal artifact metadata (`GET .../artifacts`) — returns `FiscalArtifactMetadata[]`; never exposes storage keys; tenant/company-scoped.
12. Download fiscal artifact (`GET .../artifacts/:id/download`) — SHA-256 verified, streamed with official `Content-Disposition` filename, `Cache-Control: no-store`, audited.
13. Trigger initial fiscal package delivery automatically at `READY_TO_SUBMIT`: generate PDF from immutable snapshot + signed XML, create `INITIAL_DOCUMENT` `DocumentDelivery` row, enqueue pg-boss job.
14. Trigger Hacienda response delivery automatically after F3 authoritative response: create `HACIENDA_RESPONSE` `DocumentDelivery` row, enqueue job, startup recovery scan on module init.
15. Process delivery jobs (worker): fetch and SHA-256-verify artifact bytes, attach as official-filename attachments, send via `EmailDeliveryPort`, classify result, update `DocumentDelivery`/`DeliveryAttempt`, enforce DELIVERED non-regression stale guard.
16. List delivery history (`GET .../deliveries`) — returns `DeliveryHistoryDto`; no raw Prisma/PII in response.
17. Manual resend delivery (`POST .../deliveries` with kind) — reuses immutable artifacts; creates new `DeliveryAttempt`; CANCELLED guard; audited.
18. Update company PDF branding settings (`PUT /companies/:companyId/pdf-settings`) — safe fields only (colors, footer text, showCommercialName).
19. Upload company logo (`POST /companies/:companyId/pdf-settings/logo`) — magic-byte validation (PNG/JPEG/WebP), 2 MB limit, SVG rejected, stored under tenant/company isolation.

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

Current migrations are forward-only and include:
- `20260914193000_fiscal_submission` (F3)
- `20260915100000_f4_fiscal_artifacts_delivery` (F4)

Prisma validate: PASS against both migrations.

## 8. APIs and integrations

All paths are under `/api/v1`.

Previously implemented (F0–F3) endpoints unchanged. F4 adds:

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

Current evidence recorded from the completed F4 implementation/audit-remediation cycle:

- `npm run typecheck`: PASS.
- `npm run lint`: PASS (0 errors, 37 warnings; all pre-existing as-any in test mocks).
- `npm test -- --silent`: 531 PASS, 2 SKIP (pre-existing), 0 FAIL (57 suites).
- `npm run build`: PASS.
- `npx prisma validate`: PASS.
- `npx prisma generate`: PASS.

F4 test suites added (9 new suites, ~160 new tests):

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

F4 coverage includes: state machine transitions, retry classifier (all 14 error classes), QR port/adapters (FE/TE/malformed vectors), artifact service, branding settings, fiscal/delivery status independence invariant, full delivery lifecycle E2E (mock adapters), concurrency safety, security isolation.

F2/F2.3/F3 regression check: 0 regressions. All prior suites pass without modification.
Live database integration tests (full PostgreSQL-backed concurrency and multi-page PDF) are pending live PostgreSQL environment; unit/mock coverage is complete.

This documentation refresh did not execute commands; it records user-provided final implementation/audit evidence.

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

## 14. Known defects

| ID | Severity | Current defect/risk |
|---|---|---|
| AUD-007 / SEC-REPO-001 | High | `npm audit` vulnerabilities remain unresolved (26+ known). No new vulnerable packages added by F4 (pdfkit, qrcode, nodemailer are established). |
| OQ-012 | High before production | Production IAM/SecretProvider/credential readiness for real Hacienda submission remains a pre-production deployment concern. |
| F4-PRE-001 | High before production | SMTP credentials are plain environment variables; migration to `SecretProvider` is required before production deployment. |
| F4-PRE-002 | High before production | `HACIENDA_QR_URL_BASE` exact production URL not yet confirmed; required in production/staging config; fails fast at startup if missing. |
| F4.1-001 | Medium (compliance gap) | Rejected document replacement obligation (Reglamento de Comprobantes Electrónicos) is not implemented. F4.1 is the dedicated remediation phase. Until F4.1 is complete, rejected comprobantes require manual operator remediation. Billing must NOT be declared fully production-ready for unattended fiscal issuance. |
| DEF-F1-RATE-001 | High | Auth login/refresh throttling enforcement remains unproven from earlier audits. |
| AUD-002 | Medium | Concurrent duplicate `prepare-xml` calls may race; prepare concurrency hardening is a prior F2.3 item. |
| AUD-003 | Medium | Expensive endpoints (`prepare-xml`, F3 submission, F4 artifact/delivery) still decorated with `@SkipThrottle()`; quota/rate policy remains to be clarified. |
| AUD-008 | Medium | Some path params still lack UUID validation pipes. |
| F4-DB-001 | Low | Live PostgreSQL migration deploy verification for `20260915100000_f4_fiscal_artifacts_delivery` pending (Prisma validate PASS; live deploy not yet confirmed). |

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

## 16. Security risks

| ID | Severity | Risk |
|---|---|---|
| SEC-REPO-001 | High | Existing npm audit vulnerabilities remain unresolved. |
| SEC-DEPLOY-001 | High | Production IAM/SecretProvider access must be verified before live Hacienda use (OQ-012). |
| SEC-F4-SMTP-001 | High before production | SMTP credentials passed as plain env vars; not yet behind SecretProvider. |
| SEC-REPO-002 | High | Docker Compose/default-secret concerns remain if reused outside local development. |
| SEC-F3-001 | Medium | Public callback cannot be cryptographically authenticated per verified contract; current mitigation is signal-only handling. |
| SEC-F3-002 | Medium | Submission, artifact and delivery endpoints skip throttling; abuse/cost policy needed before production. |
| SEC-F2.3-002 | Medium | `prepare-xml` is computationally expensive and currently skips throttling. |
| SEC-F2.3-003 | Medium | Path params without UUID validation increase input-handling noise. |
| SEC-F4-001 | Low | Logo upload validates magic bytes and MIME allowlist (PNG/JPEG/WebP, no SVG). SVG injection risk mitigated. Dimension/image-bomb limits beyond size are not currently implemented in code (size limit: 2 MB). |
| SEC-F4-002 | Low | `Content-Disposition` filename sanitization for CRLF/path-traversal applies to official Clave-based filenames; documented and implemented in artifact service. |

## 17. Unknowns and assumptions

- OQ-012 remains `Requires clarification` before live production: exact production IAM/SecretProvider/credential provisioning and runtime access path.
- `HACIENDA_QR_URL_BASE` exact production URL must be confirmed before production deployment.
- SMTP credentials must be migrated to `SecretProvider` before production deployment.
- Real Hacienda sandbox/production acceptance with real taxpayer credentials is opt-in and not required for CI.
- Email delivery with real SMTP (SES/SendGrid/Resend) requires separate pre-production verification.
- Storage lifecycle policy for 5-year fiscal artifact retention is a deployment/operations concern not yet documented in repository.
- F4.1 rejected document replacement requires a separate specification before implementation.
- This refresh records final user-provided evidence and did not re-run commands.

# Architecture

> **Synchronized:** F4 Fiscal Artifacts, PDF & Delivery documentation refresh by `hdd-architecture-agent-65ee79` on 2026-09-17 for confirmed `specs/fase-4-fiscal-artifacts-delivery`. Documentation-only refresh; no production code, tests, Prisma schema or migrations changed by this agent.
>
> This document describes only architecture currently implemented or actively governing the system. Future remediation and F4.1 belong in `docs/action-plan.md`, `docs/tasks.md` and `docs/future-architecture.md`.

## 1. Purpose and scope

This document records the active architecture of Billing after the completed F4 Fiscal Artifacts, PDF & Delivery implementation. F4 is functionally complete for: unified fiscal artifact metadata, PDF generation (`BILLING_DEFAULT_V1` template), two-stage email delivery (`INITIAL_DOCUMENT` + `HACIENDA_RESPONSE`), delivery state machine and retry classification, delivery worker, manual resend, protected artifact download, company PDF branding/logo, F3/F4 integration hooks and startup recovery. F4 post-implementation quality gates: typecheck PASS, lint 0 errors, 531 tests / 57 suites / 0 FAIL, build PASS, Prisma validate PASS. Audit findings AUD-001–AUD-005 remediated.

Out of scope for this active-architecture document: target redesigns, F4.1 rejected document replacement, microservice decomposition, live production IAM/SecretProvider approval, dependency remediation and SMTP SecretProvider migration.

## 2. Current active architecture summary

Billing is an API-first modular monolith using NestJS, TypeScript, Prisma and PostgreSQL.

Runtime entrypoints:

- API process: `src/bootstrap/api.main.ts`.
- Worker process: `src/bootstrap/worker.main.ts`.

Active fiscal flow now spans:

```text
FE/TE creation -> READY_FOR_XML
  -> prepare XML/sign/XSD -> READY_TO_SUBMIT
    -> @Optional() + setImmediate -> EnsureInitialFiscalPackageService
       -> GenerateFiscalPdfService -> PDF artifact
       -> EnsureInitialFiscalPackageService -> DocumentDelivery(INITIAL_DOCUMENT)
       -> DeliveryWorkerService (pg-boss) -> EmailDeliveryPort
  -> request Hacienda submission -> FiscalSubmission queued
  -> worker submit/reconcile through HaciendaSubmissionPort
  -> authoritative ACCEPTED or REJECTED + response artifact
    -> @Optional() + setImmediate -> EnsureHaciendaResponseDeliveryService
       -> DocumentDelivery(HACIENDA_RESPONSE)
       -> DeliveryWorkerService (pg-boss) -> EmailDeliveryPort
```

F4 adds delivery, artifact and PDF submodules inside `src/modules/fiscal-documents`:

```text
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
| Company Administration | Core | Company identity, ownership, fiscal profile/readiness data and PDF branding settings. | `src/modules/companies` |
| Hacienda Public Queries | Supporting | Taxpayer, CABYS and exchange-rate lookups. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda Connection | Core-enabling | Per-company/per-environment credentials, validation, OAuth/OIDC auth and token cache. | `src/modules/hacienda-connection` |
| Fiscal Documents | Core | Issuance, sequences, immutable fiscal snapshots, XML readiness and document-level terminal Hacienda outcome. | `src/modules/fiscal-documents` |
| Fiscal XML and Signing | Core-supporting | Generate Hacienda v4.4 FE/TE XML, validate XSD, sign/verify and manage XML artifacts. | `src/modules/fiscal-documents/**/fiscal-xml`, `src/infrastructure/signing` |
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
| `HaciendaSubmissionPort` | Application-facing provider boundary for submit/status query. |
| `HaciendaRecepcionAdapter` | Real Hacienda CE `POST /recepcion` and `GET /recepcion/{clave}` HTTP adapter. |
| `MockHaciendaSubmissionAdapter` | Deterministic fake adapter for CI/unit/E2E without live Hacienda. |
| `PdfRendererPort` (F4) | Application port for PDF rendering; production: `BillingDefaultV1PdfRendererAdapter` (PDFKit); CI: `MockPdfRendererAdapter`. |
| `QrContentBuilderPort` (F4) | Application port for QR content; production: `HaciendaQrContentBuilderAdapter` (reads `HACIENDA_QR_URL_BASE`); CI: `MockQrContentBuilderAdapter`. |
| `EmailDeliveryPort` (F4) | Application port for email delivery; production: `NodemailerEmailDeliveryAdapter` (SMTP); CI: `MockEmailDeliveryAdapter`. |
| `JobQueuePort` | Publishes/schedules jobs and optionally registers handlers. |
| `StoragePort` | Stores and retrieves private XML, Hacienda response and PDF artifacts. |
| `AuditService` | Records fiscal lifecycle, delivery, integrity failure and download events without secrets/tokens/XML bodies. |

## 6. Current dependency rules

Active intended dependency direction:

```text
Input adapter -> Application service/use case -> Domain helper/policy -> Output port <- Output adapter
```

F4 hexagonal compliance:

- `DocumentDeliveryStateMachine` and `DeliveryRetryClassifier` depend on nothing but domain enums; no NestJS/Prisma/HTTP imports.
- `GenerateFiscalPdfService` depends on `PdfRendererPort` and `QrContentBuilderPort` (ports), not infrastructure adapters (AUD-004 resolved).
- `DeliveryWorkerService` depends on `EmailDeliveryPort` (port); SMTP/Nodemailer details remain in adapter.
- Domain delivery exceptions (`InvalidClaveException`) do not expose infrastructure errors.

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
- `fiscal_signing_certificates`
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

Current migrations include:

- Forward-only migration `20260914193000_fiscal_submission` (F3), validated from zero on PostgreSQL 15.
- Forward-only migration `20260915100000_f4_fiscal_artifacts_delivery` (F4), Prisma validate PASS; live deploy verification pending.

## 8. Current API and integration contracts

All paths are under `/api/v1`.

Previously active F0–F3 contracts are unchanged. F4 adds:

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

- Tenant/company/environment scoping is enforced on all fiscal and F4 delivery/artifact operations.
- F3 submit/status/reconcile use existing invoice/ticket write scopes.
- F4 artifacts/deliveries use existing invoice/ticket read/write scopes; no new dedicated F4 scopes.
- Internal storage keys never appear in API responses, audit records or logs.
- Artifact SHA-256 verified before download streaming and before email attachment.
- Logo upload validates magic bytes (PNG/JPEG/WebP); SVG rejected; 2 MB limit; stored under tenant/company isolation; internal key never returned to API callers.
- Email provider credentials are not in queue payloads or audit records.
- `Content-Disposition` filenames sanitized for CRLF/path-traversal; official Clave-based naming.
- Download responses include `Cache-Control: no-store`.
- `ARTIFACT_HASH_MISMATCH` errors trigger `MRR + SECURITY` audit event and stop delivery without retry.
- `REJECTED` Hacienda response delivered truthfully; rejected comprobante not presented as valid.
- Known unresolved risks: npm audit vulnerabilities, production IAM/SecretProvider, SMTP plain-env-var credentials, throttling policy and UUID validation.

## 10. Current container and deployment architecture

- Multi-stage `Dockerfile` builds the NestJS app and runner image; build PASS in F4 validation evidence.
- `docker-compose.yml` remains local/development oriented.
- F4 adds new environment variables for production: `HACIENDA_QR_URL_BASE` (required in production/staging; mock default for dev/test), `SMTP_*`, `EMAIL_*`, `PDF_*`, `DELIVERY_*`.
- `HACIENDA_QR_URL_BASE` config validation fails fast at startup in production/staging if missing.
- SMTP credentials are currently plain environment variables; `SecretProvider` migration required before production deployment.
- Production deployment requires separate verification of OQ-012 (IAM/SecretProvider) and pre-production SMTP/QR-URL/storage-lifecycle configuration.

## 11. Current testing strategy

Current strategy includes unit, application, adapter, PostgreSQL-backed concurrency, E2E, migration and Docker validation.

F4 validation evidence supplied:

- `npm run typecheck`: PASS.
- `npm run lint`: PASS (0 errors, 37 warnings pre-existing).
- `npm test -- --silent`: 531 PASS, 2 SKIP (pre-existing), 0 FAIL (57 suites).
- `npm run build`: PASS.
- `npx prisma validate`: PASS.
- `npx prisma generate`: PASS.

F4 new test suites (9 suites, ~160 tests): state machine, retry classifier, QR adapters, artifact service, branding settings, fiscal/delivery status independence, delivery mock E2E, delivery concurrency, delivery security. F2/F2.3/F3 regression: 0 regressions.

Live database integration tests (PostgreSQL-backed concurrency and multi-page PDF) are pending live PostgreSQL environment.

This documentation refresh did not execute commands.

## 12. Active architectural decisions

| Decision | Current status |
|---|---|
| Use modular monolith, not microservices. | Active. |
| Use NestJS + TypeScript + Prisma + PostgreSQL. | Active. |
| Keep global HTTP prefix `/api/v1`. | Active. |
| Keep F2.2/F2.3 immutable artifact boundary: F4 never regenerates fiscal document, consecutive, Clave or signed XML. | Active. |
| Use dedicated `FiscalSubmission` for F3 technical/provider lifecycle. | Active. |
| Add only authoritative `ACCEPTED`/`REJECTED` to `FiscalDocumentStatus`; keep intermediate states in `FiscalSubmissionStatus`. | Active. |
| Use existing pg-boss/`JobQueuePort` for F4 delivery workers; no Redis/Kafka introduced. | Active (DEC-013 confirmed). |
| Use `HaciendaSubmissionPort` for provider submission/status boundary. | Active. |
| Treat HTTP 201 from Hacienda submit as acknowledgement/pending, not acceptance. | Active. |
| Treat callback as signal-only; no cryptographic authentication of provider callback. | Active. |
| Reuse Hacienda connection/auth/token-cache/SecretProvider; do not persist OAuth tokens/passwords. | Active. |
| CI/E2E uses deterministic mock Hacienda, PDF renderer, QR builder and email adapter; live providers are opt-in only. | Active. |
| F4 `INITIAL_DOCUMENT` delivery triggers at `READY_TO_SUBMIT` + signed XML present, without requiring `ACCEPTED`. | Active (DEC-002). |
| Two independent delivery kinds: `INITIAL_DOCUMENT` and `HACIENDA_RESPONSE`; independent lifecycles, rows and retries. | Active (DEC-003). |
| Delivery state is strictly independent of fiscal state; no delivery outcome writes `FiscalDocument.status`. | Active (DEC-004). |
| One controlled PDF template for F4 MVP: `BILLING_DEFAULT_V1`; no arbitrary tenant HTML/CSS. | Active (DEC-005). |
| `QrContentBuilderPort.buildQrContent(clave)` — payload `{HACIENDA_QR_URL_BASE}?Clave={clave}`; `HACIENDA_QR_URL_BASE` operator-configured; no production default hardcoded. | Active (DEC-001, DEC-006). |
| `FiscalArtifact` references existing XML storage keys; no XML byte duplication. | Active (DEC-007). |
| Multi-page PDF: one QR on final/summary page in lower-right area. | Active (DEC-008). |
| Artifact download: authenticated API streaming MVP; no signed-URL pattern. | Active (DEC-009). |
| Rejected document replacement (F4.1) is a future dedicated phase; F4 only delivers rejection response truthfully. | Active (DEC-010). |
| F3/F4 integration via `@Optional()` injection + `setImmediate` in `FiscalSubmissionStateService` and `PrepareFiscalXmlService`. | Active (DEC-011). |
| External-facing filenames follow official Hacienda Anexos v4.4 convention (`{clave}.xml`, `{clave}_respuesta.xml`, `{clave}.pdf`). | Active (DEC-013). |
| `DELIVERED` is a stale terminal guard: delivery worker uses `updateMany WHERE status <> DELIVERED`. | Active. |
| `DeliveryRetryClassifier` classifies 14 error classes; `ARTIFACT_HASH_MISMATCH` triggers MRR + security audit; exponential backoff 60s base, 3600s cap, 30s jitter, max 8 retries. | Active. |
| SMTP credentials are currently plain env vars; `SecretProvider` migration required before production. | Active limitation. |

## 13. Known architectural limitations

- F2.2/F3/F4 application services directly use Prisma; repository ports are not consistently extracted.
- Worker process uses full `AppModule` instead of a minimized worker module.
- No dedicated submission, artifact or delivery scopes; current write/read scopes authorize F4 operations.
- `@SkipThrottle()` remains on fiscal and F4 controllers; rate/quota policy needs approval.
- Prepare XML concurrent duplicate processing remains a prior hardening item.
- XMLDSig/XAdES remains manually assembled behind a port.
- Production IAM/SecretProvider readiness is not proven in repo-level code/tests.
- npm audit vulnerabilities remain unresolved.
- SMTP credentials are plain env vars (not yet SecretProvider-backed).
- F4.1 rejected document replacement obligation is not implemented.
- `PDF_RENDERER` binding uses `NODE_ENV === 'production'` rather than a dedicated flag.
- Live PostgreSQL migration deploy for F4 migration pending; Prisma validate PASS only.

## 14. Open decisions requiring clarification

1. What exact production IAM/SecretProvider provisioning and runtime access model satisfies OQ-012 before live Hacienda use?
2. Should fiscal submission/delivery get dedicated scopes (`fiscal-submissions:*`, `fiscal-artifacts:*`, `fiscal-deliveries:*`), or continue using invoice/ticket scopes?
3. What throttle/quota policy should apply to `prepare-xml`, submit, reconcile, artifact download and delivery endpoints?
4. Should UUID validation be implemented globally or per fiscal controller?
5. Should `FiscalSubmissionRepositoryPort` or `FiscalDeliveryRepositoryPort` be extracted now or deferred?
6. What is the approved F4.1 contract for rejected document replacement and re-issuance workflow?
7. Should SMTP credentials be migrated to `SecretProvider` before general production availability, and what is the migration timeline?
8. What is the approved storage lifecycle/retention policy for the 5-year artifact retention obligation?
9. Should `PDF_RENDERER` selection use a dedicated `USE_REAL_PDF` flag for symmetry with `USE_REAL_HACIENDA`?

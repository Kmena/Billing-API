# Architectural Action Plan

> **Synchronized:** F4 Fiscal Artifacts, PDF & Delivery documentation refresh by `hdd-architecture-agent-65ee79` on 2026-09-17. F4 is functionally complete. This plan records completed F4 work and the remaining forward roadmap only.

## 1. Objective

Record the completed F4 architecture reality and keep the repository-level forward plan limited to: pre-production requirements, F4.1 planning, security and hardening items, and long-term architectural improvements. F4 is functionally complete for artifact management, PDF generation, two-stage email delivery, delivery state machine, retry classification, delivery worker, manual resend, protected artifact download, company branding and startup recovery.

## 2. Scope

In scope for this refresh:

- Mark F4 implementation as complete (all 23 tasks, audit remediations AUD-001–AUD-005).
- Record final validation evidence supplied by the user.
- Document remaining pre-production, compliance and hardening risks.
- Preserve proposed status for all repository-level forward tasks.

## 3. Out of scope

- Production code changes.
- Prisma schema/migration changes.
- Dependency remediation implementation.
- Live Hacienda sandbox/production execution.
- F4.1 rejected document replacement implementation.
- Microservice extraction.

## 4. Requirements addressed

F4 requirements now addressed in implementation:

| Requirement area | Current state |
|---|---|
| Two-stage delivery (FR-002) | `INITIAL_DOCUMENT` at READY_TO_SUBMIT; `HACIENDA_RESPONSE` after F3 terminal result. Both implemented. |
| Fiscal/delivery state separation (FR-003) | Enforced in domain state machine, worker and all service paths. No delivery outcome writes FiscalDocument.status. |
| Immutable evidence source (FR-004) | PDF and packages use only immutable FiscalDocument snapshot data. |
| Artifact model (FR-005) | `FiscalArtifact` for SIGNED_XML, HACIENDA_RESPONSE_XML and PDF with SHA-256/content type/size/timestamps. No XML byte duplication. |
| PDF generation (FR-006) | `GenerateFiscalPdfService` with `BillingDefaultV1PdfRendererAdapter` (PDFKit). |
| PDF template (FR-007) | `BILLING_DEFAULT_V1` single controlled template. |
| Safe branding (FR-008) | `CompanyPdfSettingsService` — colors, footer text, showCommercialName only. |
| Logo upload security (FR-009) | Magic-byte validation (PNG/JPEG/WebP), 2 MB limit, SVG rejected, tenant/company isolation. |
| PDF compliance (FR-010) | QR in lower-right, ≥ 2.5 cm, Clave-based payload, type+Clave+consecutive grouped. |
| Multi-page rendering (FR-011) | Repeated compact headers, page X of Y, no orphan headers, QR on final page. |
| PDF immutability/versioning (FR-012) | Template/renderer version stored; unique constraint prevents duplicate PDF rows. |
| Delivery model (FR-013) | `DocumentDelivery` + `DeliveryAttempt`; per kind/channel/recipient. |
| Email port (FR-014) | `EmailDeliveryPort` — vendor-agnostic. Production: Nodemailer. CI: Mock. |
| Automatic delivery (FR-015) | Triggered via `@Optional()` + `setImmediate` hooks in `PrepareFiscalXmlService` and `FiscalSubmissionStateService`. |
| Manual resend (FR-016) | `DeliveryRequestService` + `FiscalDeliveriesController`; reuses immutable artifacts; `DeliveryAttempt` history. |
| Protected downloads (FR-017) | `FiscalArtifactService` + `FiscalArtifactsController`; never exposes storage keys; SHA-256 verified. |
| Queue/worker (FR-018) | Reuses pg-boss `JobQueuePort`; payloads contain identifiers only. |
| Delivery retries (FR-019) | `DeliveryRetryClassifier` (14 error classes); exponential backoff; max 8 retries. |
| Artifact integrity (FR-020) | SHA-256 verified before delivery and before download. |
| Retention (FR-021) | Artifact rows not purged; 5-year retention policy pending operational runbook. |
| Audit (FR-022) | Delivery lifecycle, integrity failures and downloads audited with `FISCAL_AUDIT`/`SECURITY` event class. |
| Observability (FR-023) | Logger instrumentation in all delivery/PDF/artifact services. |
| Rejected documents (FR-024) | HACIENDA_RESPONSE delivered; rejected comprobante not presented as valid; F4.1 gap documented. |
| FE/TE support (FR-025) | Both INVOICE and TICKET supported; missing TE recipient email is a non-error condition. |
| Deterministic tests (FR-026) | MockPdfRendererAdapter, MockEmailDeliveryAdapter, MockQrContentBuilderAdapter. 531 tests PASS. |

## 5. Current problems addressed

Closed by F4:

- No PDF graphical representation for FE/TE.
- No two-stage email delivery lifecycle.
- No unified artifact metadata model.
- No delivery state machine or retry classification for email delivery.
- No manual resend capability.
- No protected artifact download API.
- No company PDF branding configuration.
- No F3/F4 hook for automatic delivery triggers.
- No startup recovery for missed Hacienda response deliveries.
- AUD-001: delivery worker handler now registered via `OnModuleInit`.
- AUD-002: initial delivery triggered at `READY_TO_SUBMIT` via `@Optional()` + `setImmediate`.
- AUD-003: startup recovery scan (`recoverMissedDeliveries`) called at `OnModuleInit`.
- AUD-004: `GenerateFiscalPdfService` no longer imports from infrastructure layer (hexagonal violation fixed).
- AUD-005: `listDeliveries` returns `DeliveryHistoryDto` (no raw Prisma/PII).

Remaining:

- OQ-012 production IAM/SecretProvider readiness.
- 26+ npm audit vulnerabilities.
- SMTP credentials in plain env vars (not SecretProvider-backed).
- `HACIENDA_QR_URL_BASE` exact production URL not confirmed.
- 5-year storage lifecycle/retention policy not operationally documented.
- Throttling/quota policy for expensive fiscal endpoints.
- UUID/path-param validation standardization.
- Prepare XML concurrency hardening.
- F4.1 rejected document replacement (compliance gap).
- Live PostgreSQL migration deploy verification for F4 migration.
- `SecretProvider` integration for SMTP credentials.

## 6. Domains affected

| Domain | F4 impact |
|---|---|
| Fiscal Documents | Now owns document-level terminal Hacienda outcomes, `FiscalSubmission` lifecycle, unified `FiscalArtifact` metadata, `CompanyPdfSettings`, `DocumentDelivery` and `DeliveryAttempt`. |
| Fiscal XML/Signing | Provides immutable signed XML artifact consumed by F4 delivery/download; no regeneration. |
| Fiscal Submission | F3/F4 hook in `FiscalSubmissionStateService.applyProviderResult` triggers HACIENDA_RESPONSE delivery via `@Optional()`. |
| Fiscal Delivery (new) | New submodule for two-stage delivery lifecycle; owned by `fiscal-documents` module boundary. |
| Queue/Workers | F4 delivery worker registers handler via `DeliveryWorkerService.onModuleInit`. |
| Storage | Stores PDF artifacts and retrieves XML/response/PDF bytes for delivery and download. |
| Audit/Security | Records fiscal lifecycle, delivery events, integrity failures and downloads. |
| Deployment | F4 adds required pre-production config: HACIENDA_QR_URL_BASE, SMTP_*, EMAIL_*, PDF_*, DELIVERY_*. |

## 7. Behavior to preserve

- All F0–F3 FE/TE creation, XML preparation and Hacienda submission behavior unchanged.
- Stable fiscal identity and signed XML across deliver/retry/resend paths.
- Delivery failure never changes `FiscalDocument.status` or `FiscalSubmission.status`.
- `DELIVERED` cannot regress due to stale workers.
- PDF bytes derived from immutable snapshot data only.
- Exact signed XML and Hacienda response bytes attached without re-serialization; SHA-256 verified.
- Internal storage keys never exposed to API callers.
- Official Hacienda filename convention enforced at delivery/download boundaries.
- `REJECTED` Hacienda response delivered truthfully; rejected comprobante not presented as valid.
- Deterministic mock adapters remain the default for CI.

## 8. Defects to correct

No F4 functional blocker remains after implementation and audit remediation. Proposed future corrections:

| Finding | Priority | Correction direction |
|---|---|---|
| OQ-012 production IAM/SecretProvider readiness | High | Produce and validate pre-production runbook. |
| npm audit vulnerabilities | High | Triage/remediate or formally accept risk in supply-chain workstream. |
| SMTP credentials in plain env vars (F4-PRE-001) | High before production | Migrate SMTP credentials to `SecretProvider` abstraction. |
| HACIENDA_QR_URL_BASE not confirmed (F4-PRE-002) | High before production | Confirm exact Hacienda CE consultation URL; add to production config runbook. |
| F4.1 rejected document replacement (F4.1-001) | Medium (compliance gap) | Plan and implement F4.1 specification. |
| Expensive fiscal endpoints skip throttling | Medium | Define quota/rate policy for prepare/submit/reconcile/download/delivery. |
| Missing UUID/path param standardization | Medium | Add global or route-level validation policy. |
| Prepare XML concurrency hardening | Medium | Add locking/compare-and-set characterization and fix if needed. |
| Direct Prisma usage in fiscal services | Medium | Extract repository ports incrementally if future complexity warrants. |
| Live PostgreSQL F4 migration deploy | Low | Verify `20260915100000_f4_fiscal_artifacts_delivery` deploys cleanly from zero on PostgreSQL 15. |

## 9. Future architectural changes

Recommended sequence:

1. Production readiness runbook for OQ-012.
2. SMTP credentials → SecretProvider migration.
3. HACIENDA_QR_URL_BASE production URL confirmation.
4. 5-year retention policy and storage lifecycle documentation.
5. Dependency vulnerability triage/remediation.
6. Live PostgreSQL F4 migration deploy verification.
7. Fiscal endpoint throttling/quota policy.
8. UUID/path-param validation standardization.
9. Prepare XML concurrency characterization/hardening.
10. F4.1 specification and implementation (rejected document replacement).
11. Optional repository-port extraction around fiscal submission/delivery/document persistence.
12. SMTP `USE_REAL_PDF` flag and `PDF_RENDERER` binding clarification.

## 10. Database changes

Implemented:

- Forward migration `20260914193000_fiscal_submission` (F3).
- Forward migration `20260915100000_f4_fiscal_artifacts_delivery` (F4): enums `FiscalArtifactType`, `DocumentDeliveryKind`, `DocumentDeliveryChannel`, `DocumentDeliveryStatus`; tables `fiscal_artifacts`, `company_pdf_settings`, `document_deliveries`, `delivery_attempts`; relations on `Tenant`, `Company`, `FiscalDocument`.
- All F4 unique constraints, idempotency constraints, integrity indexes and due-work indexes applied.

Future proposed only if approved:

- F4.1 migration for rejected document replacement tracking.
- Optional tenant/company compound constraints for fiscal relations.
- Optional prepare XML locking metadata if chosen.
- Storage lifecycle/retention metadata columns if approved.
- Do not modify any applied migration.

## 11. API and integration changes

Implemented (F4):

- Artifact list/download endpoints.
- Delivery history and manual resend endpoints.
- Company PDF branding settings and logo upload endpoints.
- `NodemailerEmailDeliveryAdapter` and `MockEmailDeliveryAdapter`.
- Official Hacienda filename convention for all delivery and download boundaries.

Future proposed only if approved:

- Dedicated fiscal-artifacts/delivery scopes.
- 429/throttling contracts for expensive endpoints.
- Signed-URL download pattern (if approved over streaming MVP).
- F4.1 replacement-document and re-issuance APIs.
- Webhook/notification API (if approved).

## 12. Container and deployment changes

Implemented/evidenced:

- Docker build PASS in F4 validation.
- Current compose remains local/development oriented.
- New env vars validated via Joi schema: `HACIENDA_QR_URL_BASE`, `SMTP_*`, `EMAIL_*`, `PDF_*`, `DELIVERY_*`.

Future:

- OQ-012 pre-production IAM/SecretProvider verification.
- Production runbook for Hacienda credentials, SMTP credentials, callback URL, QR URL and worker/queue monitoring.
- SMTP credentials → `SecretProvider` before production deployment.
- Storage lifecycle policy for 5-year fiscal artifact retention.
- Do not reuse local default-secret compose assumptions for production.

## 13. Security changes

Implemented (F4):

- Tenant/company/environment isolation for all F4 artifact/delivery/branding operations.
- SHA-256 integrity verification before delivery and download.
- `ARTIFACT_HASH_MISMATCH` → MRR + SECURITY audit event; no retry.
- `Content-Disposition` filename sanitization (CRLF/path-traversal).
- `Cache-Control: no-store` on download responses.
- Logo magic-byte validation; SVG rejected; 2 MB limit.
- Internal storage keys never exposed in API responses.
- Job payloads contain identifiers only; no credentials/bytes.
- `REJECTED` delivery content does not present comprobante as valid.

Future:

- Dependency vulnerability remediation.
- Production secret/IAM verification.
- SMTP credentials → `SecretProvider`.
- Throttling/quota enforcement.
- UUID validation.
- Consider dedicated scopes for F4 operations.

## 14. Test strategy

Final F4 validation evidence supplied by user:

- `npm run typecheck`: PASS.
- `npm run lint`: PASS (0 errors, 37 warnings pre-existing).
- `npm test -- --silent`: 531 PASS, 2 SKIP (pre-existing), 0 FAIL (57 suites).
- `npm run build`: PASS.
- `npx prisma validate`: PASS.
- `npx prisma generate`: PASS.

F4 coverage: state machine, retry classifier (14 error classes), QR adapters, artifact service, branding settings, fiscal/delivery status independence, mock delivery E2E, concurrency, security isolation. F2/F2.3/F3: 0 regressions.

Pending (live environment only):

- PostgreSQL-backed concurrency test for delivery.
- Multi-page PDF integration test with live PDFKit + PostgreSQL.
- Live F4 migration deploy verification on PostgreSQL 15.

This action plan refresh did not execute commands.

## 15. Migration stages

| Stage | Status | Notes |
|---|---|---|
| F2.2/F2.3 readiness baseline | Complete | FE/TE can reach `READY_TO_SUBMIT`. |
| F3 persistence/domain/port/adapters | Complete | State machine, classifier, `FiscalSubmission`, port and adapters implemented. |
| F3 APIs/workers/callback/artifacts | Complete | Submit/status/reconcile/callback, workers and response artifacts implemented. |
| F3 tests/final audit | Complete | Final audit Acceptable 8.6/10; gates passed. |
| F4 domain/ports/adapters | Complete | Delivery state machine, retry classifier, QR/PDF/email ports and adapters implemented. |
| F4 application services/workers | Complete | PDF generation, evidence resolver, delivery services, delivery worker, startup recovery implemented. |
| F4 APIs/branding/artifact download | Complete | All 10 F4 API endpoints implemented and tested. |
| F4 F3 integration hooks | Complete | AUD-001–AUD-005 remediated; `@Optional()` + `setImmediate` hooks active. |
| F4 tests/quality gates | Complete | 531/57 suites; 0 fail; typecheck/lint/build/Prisma all PASS. |
| F4 pre-production readiness | Proposed | OQ-012, SMTP SecretProvider, QR URL confirmation, storage lifecycle, dependency/security. |
| F4.1 rejected document replacement | Not started | Separate specification required. |

## 16. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| F4.1 compliance gap — rejected document replacement | High before production unattended issuance | Document as pre-production blocker; complete F4.1 specification/implementation before declaring production-ready for unattended fiscal issuance. |
| Production SecretProvider/IAM not ready | High | Complete OQ-012 runbook and pre-production validation before live submissions. |
| SMTP credentials in plain env vars | High before production | Migrate SMTP credentials to `SecretProvider` abstraction before production email delivery. |
| HACIENDA_QR_URL_BASE not confirmed | High before production | Confirm exact Hacienda CE consultation URL; config validation fails fast in production/staging. |
| 5-year artifact retention policy not operationalized | High before production | Define and implement storage lifecycle policy. |
| Dependency vulnerabilities | High | Separate supply-chain remediation/exception process. |
| Live F4 migration deploy not verified | Medium | Verify `20260915100000_f4_fiscal_artifacts_delivery` deploys cleanly from zero on PostgreSQL 15. |
| Callback spoofing | Medium | Preserve current signal-only behavior and authenticated reconciliation. |
| Hacienda outage/throttling | Medium | Preserve retry classifier, backoff, rate-header handling and manual-review states. |
| Email provider outage/rate limiting | Medium | `DeliveryRetryClassifier` handles PROVIDER_RATE_LIMIT; retry with backoff. |
| Endpoint abuse/cost | Medium | Add approved throttle/quota policy. |
| Artifact integrity failure (SHA-256 mismatch) | Low | `ARTIFACT_HASH_MISMATCH` → MRR + SECURITY audit; delivery stopped; operator investigation required. |
| Logo image bomb | Low | 2 MB upload limit; magic-byte validation; no dimension limits currently in code beyond size. |

## 17. Rollback or recovery strategy

- Documentation changes can be reverted if inaccurate.
- F3/F4 migrations are forward-only; do not edit historical migrations.
- Operationally, non-terminal deliveries can be manually resent; CANCELLED deliveries cannot be resent.
- INITIAL_DOCUMENT delivery failures do not affect FiscalDocument status; fiscal lifecycle proceeds normally.
- If email provider fails, increase `DELIVERY_MAX_RETRIES` or operator manually resends after provider recovery.
- If live Hacienda integration is disabled, mock adapter handles CI/non-live environments.
- Startup recovery scan (`EnsureHaciendaResponseDeliveryService.recoverMissedDeliveries`) catches missed deliveries on process restart.

## 18. Manual validation

For pre-production/live readiness before declaring production-ready:

1. Verify OQ-012: SecretProvider/IAM access for Hacienda credentials without exposing values.
2. Verify SMTP credentials via `SecretProvider`; confirm `EMAIL_USE_REAL=true` path works.
3. Confirm `HACIENDA_QR_URL_BASE` points to verified Hacienda CE consultation URL.
4. Verify F4 migration `20260915100000_f4_fiscal_artifacts_delivery` deploys cleanly from zero on PostgreSQL 15.
5. Submit a sandbox FE/TE; confirm initial package email arrives with `{clave}.xml` + `{clave}.pdf`.
6. Confirm authoritative Hacienda response email arrives with `{clave}_respuesta.xml`.
7. Confirm artifact download API returns SHA-256-verified bytes with official filename.
8. Confirm no storage keys, SMTP passwords or XML bodies appear in logs, audit records or API responses.
9. Confirm `REJECTED` delivery email presents rejection content, not a valid fiscal package.
10. Confirm startup recovery scan on worker restart does not duplicate already-delivered deliveries.
11. Confirm no regressions: all prior F3 submit/reconcile/callback flows still work.
12. Document storage lifecycle/retention policy for 5-year artifact preservation.
13. Document F4.1 compliance gap status and operator manual remediation procedure.

## 19. Approval status

- F4 implementation is complete functionally, audit-remediated and documented as current state.
- Final quality gates: **531 PASS / 57 suites / 0 FAIL; typecheck PASS; lint 0 errors; build PASS; Prisma validate PASS**.
- Audit findings AUD-001–AUD-005 all remediated.
- Remaining tasks in `docs/tasks.md` are **Proposed** and require explicit approval before implementation.
- F4.1 rejected document replacement is **not introduced**.

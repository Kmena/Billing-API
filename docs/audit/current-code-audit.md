# Current Code Audit — F4 Fiscal Artifacts, PDF & Delivery Closure

Audit agent: `baseline-audit-agent-eb6b50`  
Audit scope: Final post-implementation baseline audit for confirmed specification `specs/fase-4-fiscal-artifacts-delivery`  
Out of scope: F4.1 rejected-document replacement implementation and F5 document types  
Audit date: 2026-09-17

---

# Executive Summary

The repository is a NestJS/TypeScript modular monolith using PostgreSQL/Prisma, pg-boss, object storage, API-key authorization, and explicit ports/adapters in several fiscal areas. F4 adds fiscal artifacts, PDF rendering, QR generation, secure downloads, two-stage email delivery, delivery retries/recovery, and F3/F4 integration hooks.

The supplied validation evidence is strong: clean migration deploy on a disposable PostgreSQL database, real PostgreSQL F4 concurrency tests passing, real PDF renderer tests passing, full Jest suite passing, typecheck/lint/build passing, and the prior NULL-unsafe PostgreSQL unique index defect for `document_deliveries.package_version` remediated with partial unique indexes.

No F4 blocker remains for the core delivery worker wiring, READY_TO_SUBMIT hook, Hacienda response hook, recovery path, PostgreSQL duplicate-delivery constraint, QR generation, official filenames, fiscal/delivery status independence, or real PDF renderer behavior.

However, this closure audit found one remaining blocker-level requirement coverage gap and several high/medium risks:

- **BLOCKER:** the protected artifact listing/download API is backed only by `FiscalArtifact` rows, but production code only creates PDF `FiscalArtifact` rows. It does not create/index `SIGNED_XML` or `HACIENDA_RESPONSE_XML` artifact rows, so the unified artifact model and protected downloads for XML evidence are not actually satisfied through the F4 artifact API.
- **HIGH:** if PDF generation fails, `EnsureInitialFiscalPackageService` still queues initial delivery, and `DeliveryWorkerService` sends the signed XML without a PDF if no PDF artifact exists. This can produce an incomplete initial package despite the F4 requirement that initial delivery includes signed XML plus PDF.
- **HIGH:** logo validation checks file size and magic bytes but does not verify image dimensions or decode image structure, leaving the specified dimension/image-bomb protection incomplete.
- **MEDIUM:** artifact download routes ignore the fiscal document id in the URL when resolving `artifactId`, allowing same-company artifact IDs to be downloaded through a mismatched document URL.
- **MEDIUM:** download integrity failures are blocked but are not recorded as security audit events in the download path.
- **MEDIUM:** `npm audit` reports 26 findings, including 8 high vulnerabilities. No F4-specific vulnerable dependency was identified, but this remains a pre-production supply-chain risk.

Documentation is generally well separated into current-state, active architecture, action plan, tasks, and future architecture. The current docs clearly distinguish F4.1/F5 future scope. But they overstate F4 artifact-model completeness by saying SIGNED_XML and HACIENDA_RESPONSE_XML are covered by `FiscalArtifact`, which contradicts observable production code.

---

# Overall Score

**Overall Score: 8.1/10**

Justification:

| Dimension | Assessment |
|---|---|
| Requirement coverage | Strong for PDF/QR/delivery/concurrency/status separation; incomplete for unified artifact API coverage of XML evidence and incomplete package prevention. |
| Architecture | Good modular monolith with ports for PDF, QR, email, storage and queue; some pragmatic Prisma-in-application coupling remains. |
| Security | Good tenant/company scoping, no raw storage keys in artifact responses, SHA-256 verification, safe filenames; gaps remain in logo dimension validation, download mismatch semantics, and download integrity audit. |
| Database | Strong F4 models, indexes, partial unique indexes for nullable package version, and PostgreSQL concurrency evidence. FiscalArtifact XML uniqueness/indexing is not yet operationally relevant because XML rows are not created. |
| Testing | Very strong validation evidence: real DB concurrency, real PDF renderer, 564 passing tests, typecheck/lint/build. Missing characterization for XML artifacts in list/download API and PDF-missing delivery failure. |
| Documentation | Clear separation of current/future concerns; one notable contradiction with observable artifact indexing behavior. |
| Operational readiness | Good worker/recovery patterns; dependencies and production retention/SMTP/QR configuration remain pre-production items. |

Final verdict: **Needs Refactoring**

---

# Repository Overview

- Runtime: NestJS API process and worker process.
- Language: TypeScript.
- Persistence: PostgreSQL via Prisma.
- Queue: pg-boss behind `JobQueuePort`.
- Storage: `StoragePort` with local/S3 adapters.
- Security: API-key guard, scope guard, JWT identity foundation, Helmet/config validation.
- Fiscal modules: FE/TE issuance, XML signing/XSD validation, Hacienda submission, F4 artifacts/PDF/delivery.
- Docs/specs: extensive phase-based documentation under `docs/` and `specs/`.

What currently works well:

- F4 database migrations deploy cleanly on PostgreSQL.
- `document_deliveries` idempotency for nullable `package_version` is correctly fixed by partial unique indexes.
- PDFKit renderer generates FE/TE PDFs with verified official filenames, grouped identification block and QR sizing/location checks in tests.
- Delivery status is independent from fiscal document status.
- F3 terminal responses trigger F4 Hacienda response delivery and recovery exists for missed response deliveries.
- Stale worker updates are guarded so delivered rows do not regress.
- Queue payloads are identifier-only.
- Delivery and download verify SHA-256 before using artifact bytes.
- Rejected documents are not represented as valid accepted packages in Hacienda response email body.

---

# Current Architecture

Current architectural style: modular monolith with incremental hexagonal boundaries.

Current F4 dependency direction observed:

- HTTP controllers call application services.
- Application services use Prisma, `StoragePort`, `JobQueuePort`, `EmailDeliveryPort`, `PdfRendererPort`, and `QrContentBuilderPort`.
- Domain delivery state machine/retry classifier are pure TypeScript.
- Infrastructure adapters implement PDF/QR/email/provider behavior.
- F3 integration uses optional injection and asynchronous hooks from existing fiscal XML/submission services.

Persistence strategy:

- Prisma schema and migrations define `FiscalArtifact`, `CompanyPdfSettings`, `DocumentDelivery`, and `DeliveryAttempt`.
- Existing XML evidence remains in `FiscalXmlArtifact` and `FiscalSubmission` storage metadata.

Authentication/authorization:

- Artifact/download/delivery/branding controllers use `ApiKeyAuthGuard` and `ScopeGuard`.
- Queries generally include tenant/company scope.

Deployment strategy:

- Docker multi-stage build, non-root runner, healthcheck.
- `docker-compose.yml` for local PostgreSQL, LocalStack, API and worker.

Requires clarification:

- Exact production Hacienda QR consultation URL value for `HACIENDA_QR_URL_BASE`.
- Production SMTP credential sourcing via SecretProvider.
- Operational retention/lifecycle policy enforcing five-year preservation.

---

# Documentation Findings

Documentation separation assessment:

- `docs/current-state.md`: intended observable current truth; mostly clear, but overstates artifact model implementation for XML artifact rows.
- `docs/architecture.md`: active architecture; clearly excludes F4.1/F5 future work, but repeats the same artifact-model overstatement.
- `docs/action-plan.md`: future/pre-production plan; responsibilities are mostly clear.
- `docs/future-architecture.md`: future target-state vision; correctly separates F4.1/F5 and longer-term hardening.
- `specs/fase-4-fiscal-artifacts-delivery/f4.1-remediation-roadmap.md`: correctly marks rejected-document replacement as future scope, not F4.

Overall documentation quality is good; the primary issue is contradiction with observable code for XML artifacts in the unified artifact API.

---

# Main Modules

- `src/modules/fiscal-documents/application/artifacts`: artifact metadata/download, evidence resolution, PDF generation.
- `src/modules/fiscal-documents/application/delivery`: initial package orchestration, Hacienda response delivery orchestration, worker processing, manual resend.
- `src/modules/fiscal-documents/application/pdf`: PDF renderer port and company branding settings.
- `src/modules/fiscal-documents/application/qr`: QR content builder port.
- `src/modules/fiscal-documents/application/email`: email delivery port.
- `src/modules/fiscal-documents/infrastructure/pdf`: real and mock PDF renderers.
- `src/modules/fiscal-documents/infrastructure/qr`: real and mock QR builders.
- `src/modules/fiscal-documents/infrastructure/email`: mock and Nodemailer email adapters.
- `src/modules/fiscal-documents/infrastructure/http`: artifact, delivery and PDF settings APIs.

---

# Main Dependencies

Key runtime dependencies:

- `@nestjs/*`
- `@prisma/client`
- `pg-boss`
- `pdfkit`
- `qrcode`
- `nodemailer`
- AWS S3 SDK
- `xml-crypto`, `xmlbuilder2`, `@xmldom/xmldom`
- `helmet`, `argon2`, `passport-jwt`, `joi`, `pino`

Dependency audit evidence supplied by user:

- `npm audit --json`: 26 findings total: low 4, moderate 14, high 8, critical 0.
- No F4-specific vulnerable dependency identified.

---

# Database Findings

Strengths:

- F4 migrations add typed enums and durable artifact/delivery tables.
- `document_deliveries` has separate lifecycle state from `fiscal_documents`.
- `delivery_attempts` preserves attempt history.
- Partial unique indexes now correctly enforce default package uniqueness when `package_version IS NULL`.
- Worker due-work and scope indexes exist.

Risks:

- `FiscalArtifact` model exists for `SIGNED_XML`, `HACIENDA_RESPONSE_XML`, and `PDF`, but observable production code only creates `PDF` rows.
- The initial migration comment says nullable `package_version` is treated as equal in the original unique index, which was false for PostgreSQL; the corrective migration fixes behavior but the older migration comment remains misleading historical documentation.
- `FiscalArtifact` unique index on nullable `template_id`/`renderer_version` would not prevent duplicate XML rows if XML rows are later inserted without partial indexes or `NULLS NOT DISTINCT`; currently not triggered because XML rows are not created by production code.

---

# API Findings

Strengths:

- Artifact APIs avoid exposing internal storage keys.
- Download uses official `Content-Disposition` filenames.
- Download uses `Cache-Control: no-store`.
- Delivery listing maps Prisma rows to DTO and redacts recipient local-part.
- Controllers are guarded by API-key and scope guards.

Risks:

- Artifact download route does not verify that `artifactId` belongs to the `:id` document in the URL.
- Protected artifact API only returns `FiscalArtifact` rows; XML evidence is not indexed there, so signed XML and Hacienda response XML are not available through the API unless rows are manually inserted.
- Company PDF settings upload returns `{ error: ... }` with HTTP 200 when no file is supplied instead of a validation error status; low API consistency issue.

---

# Container Findings

Strengths:

- Multi-stage Dockerfile.
- Non-root runner user.
- Healthcheck present.
- Production image copies built artifacts and pruned dependencies.
- PostgreSQL image is pinned to `postgres:15-alpine`.

Risks:

- `localstack/localstack:3` and `node:20-alpine` use broad tags rather than digest-pinned images.
- `docker-compose.yml` contains development defaults/secrets; acceptable for local development but must not be used as production secret source.

---

# Security Findings

Strengths:

- Tenant/company scoping in F4 service queries.
- SHA-256 verification before delivery/download.
- Storage keys are not exposed in artifact API responses or filenames.
- CRLF/path traversal sanitization for `Content-Disposition`.
- Logo SVG rejected and magic bytes checked.
- Email delivery is behind a port.
- Queue payloads carry identifiers only.

Risks:

- Logo dimensions and image-bomb protections are not fully implemented.
- Download integrity mismatch is not audited as `SECURITY` in the artifact download path.
- Same-company URL/document mismatch can be used to download a known artifact ID through a different document path.
- Dependency audit has high findings.
- SMTP credentials are environment-based in module factory; SecretProvider migration remains pre-production hardening.

---

# Testing Findings

Validation evidence supplied:

- Clean test DB `prisma migrate deploy`: passed after F4 migrations.
- Real PostgreSQL F4 concurrency: 10/10 passed.
- Real PDF renderer: 33/33 passed, FE/TE PDFs generated, QR physical size >= 2.5cm, official filenames verified.
- Full suite: 58 passed suites, 2 skipped DB-dependent suites, 564 passed, 12 skipped, 0 failures.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and 37 warnings in test mocks.
- `npm run build`: passed.

Testing gaps:

- Missing test proving signed XML and Hacienda response XML appear in protected artifact list/download API as `FiscalArtifact`-backed records.
- Missing test proving initial delivery is blocked or marked manual review when PDF artifact generation is unavailable.
- Missing test for artifact download route `:id`/`:artifactId` mismatch.
- Missing test that download integrity mismatch emits a security audit event.
- Missing test for logo dimensions/image decoding/image-bomb rejection.

---

# Maintainability Findings

Strengths:

- F4 delivery/policy logic is decomposed into focused services.
- Ports are explicit for email, PDF and QR.
- Constants were moved out of infrastructure into application constants.
- Delivery retry classifier and state machine are isolated and testable.

Risks:

- Application services directly use Prisma. This is consistent with existing repository style but keeps persistence details inside application orchestration.
- Some comments describe intended invariants more strongly than the code enforces, notably complete initial package delivery and XML artifact indexing.
- F4 behavior depends on asynchronous `setImmediate` hooks; recovery exists for Hacienda response delivery but no equivalent broad startup recovery was observed for missed initial deliveries after READY_TO_SUBMIT.

---

# Technical Debt

- XML artifacts remain physically modeled in legacy tables and are not indexed into the new `FiscalArtifact` API model.
- Production SMTP credentials should use SecretProvider rather than direct environment variables.
- Five-year storage retention is documented but requires operational enforcement.
- Dependency vulnerabilities need triage/remediation or documented risk acceptance.
- Logo validation requires real image decoding/dimension checks to meet the stated threat model.
- Initial delivery needs stronger invariant enforcement so incomplete packages cannot be sent.

---

# Findings

## AUD-001

- **Severity:** Critical (BLOCKER)
- **Category:** Requirement coverage / API / Database
- **Location:** `src/modules/fiscal-documents/application/artifacts/fiscal-artifact.service.ts`; `src/modules/fiscal-documents/application/artifacts/generate-fiscal-pdf.service.ts`; `src/modules/fiscal-documents/application/fiscal-xml/prepare-fiscal-xml.service.ts`; `src/modules/fiscal-documents/application/submission/fiscal-submission-state.service.ts`; `prisma/schema.prisma`
- **Evidence:** `FiscalArtifactService.listArtifacts()` and `downloadArtifact()` only query `prisma.fiscalArtifact`. Production creation of `FiscalArtifact` rows was found only in `GenerateFiscalPdfService`, with `type: 'PDF'`. No production code creates `FiscalArtifact` rows for `SIGNED_XML` or `HACIENDA_RESPONSE_XML`; evidence resolver reads those bytes directly from `FiscalXmlArtifact` and `FiscalSubmission` instead.
- **Impact:** FR-005, FR-017, FR-020 and FR-027 are only partially satisfied. Protected artifact listing/download cannot reliably expose signed XML or Hacienda response XML through the unified artifact API, despite the schema enum and documentation claiming all three artifact types are covered.
- **Recommendation:** Before F4 closure, add characterization/remediation so signed XML and Hacienda response XML are indexed as `FiscalArtifact` metadata or are otherwise exposed through the artifact API with equivalent tenant/company scoping, integrity metadata, official filenames and no storage-key leakage. Add tests for list/download of all three artifact types.

## AUD-002

- **Severity:** High
- **Category:** Requirement coverage / Delivery correctness
- **Location:** `src/modules/fiscal-documents/application/delivery/ensure-initial-fiscal-package.service.ts`; `src/modules/fiscal-documents/application/delivery/delivery-worker.service.ts`
- **Evidence:** `EnsureInitialFiscalPackageService.ensure()` catches PDF generation failure and still creates/queues delivery. `DeliveryWorkerService.buildAttachments()` attaches the PDF only if a PDF artifact exists; it does not fail the delivery when missing.
- **Impact:** Initial delivery can send `{clave}.xml` without `{clave}.pdf`, violating FR-002, FR-006, AC-001/AC-002 and the requirement that the initial package contains signed XML plus PDF graphical representation.
- **Recommendation:** Treat missing PDF for `INITIAL_DOCUMENT` as a delivery-blocking condition, e.g. retry/manual-review rather than sending an incomplete package. Add a regression test for PDF generation failure/missing PDF artifact.

## AUD-003

- **Severity:** High
- **Category:** Security / Logo upload
- **Location:** `src/modules/fiscal-documents/application/pdf/company-pdf-settings.service.ts`
- **Evidence:** Logo validation enforces non-empty, 2 MB max size, and PNG/JPEG/WebP magic bytes. No actual image decoding, width/height limit or decompression-bomb detection is implemented.
- **Impact:** FR-009 and AC-009 are incomplete. Malformed or extreme-dimension images with valid magic bytes may be accepted and later processed by the PDF renderer.
- **Recommendation:** Add safe image decoding/dimension validation and explicit rejection tests for over-dimension and malformed image cases.

## AUD-004

- **Severity:** Medium
- **Category:** API authorization / Contract consistency
- **Location:** `src/modules/fiscal-documents/infrastructure/http/fiscal-artifacts.controller.ts`; `FiscalArtifactService.downloadArtifact()`
- **Evidence:** Routes include `invoices/:id/artifacts/:artifactId/download` and `tickets/:id/...`, but the controller passes only `artifactId` to the service. The service checks `artifact.id`, `tenantId`, `companyId`, and `supersededAt`, but not `fiscalDocumentId = :id`.
- **Impact:** Cross-tenant and cross-company access is blocked, but a caller with a known same-company artifact ID can download it via a mismatched document URL. This weakens API semantics and may complicate audit trails/client assumptions.
- **Recommendation:** Include fiscal document id in artifact download lookup and add mismatch tests returning 404/403 without leaking artifact existence.

## AUD-005

- **Severity:** Medium
- **Category:** Security / Audit
- **Location:** `src/modules/fiscal-documents/application/artifacts/fiscal-artifact.service.ts`; `src/modules/fiscal-documents/infrastructure/http/fiscal-artifacts.controller.ts`
- **Evidence:** Delivery integrity failures emit a security audit in `DeliveryWorkerService.handleFailure()`. Download path verifies SHA-256 and throws `ArtifactIntegrityException`, but no `SECURITY` audit event is recorded on mismatch.
- **Impact:** Tampering detected during user/API download is blocked, but incident observability is incomplete and AC-style tamper detection audit expectations are not fully satisfied.
- **Recommendation:** Record sanitized `SECURITY` audit metadata when download integrity verification fails; do not log bytes or full storage keys.

## AUD-006

- **Severity:** Medium
- **Category:** Security / Supply chain
- **Location:** `package.json`, `package-lock.json`
- **Evidence:** User-supplied validation reports `npm audit --json` with 26 findings: low 4, moderate 14, high 8, critical 0.
- **Impact:** No F4-specific vulnerable dependency was identified, but high severity transitive/runtime dependency findings remain a production risk.
- **Recommendation:** Triage audit findings before production, remediate where safe, and document risk acceptance for unfixable/transitive findings.

## AUD-007

- **Severity:** Medium
- **Category:** Documentation / Contradiction with observable code
- **Location:** `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`
- **Evidence:** Documentation states F4 has a unified `FiscalArtifact` model for `SIGNED_XML`, `HACIENDA_RESPONSE_XML` and `PDF`. Observable production code creates only PDF `FiscalArtifact` rows.
- **Impact:** Downstream agents/operators may believe XML artifact list/download coverage is complete when it is not.
- **Recommendation:** Update docs after code is corrected, or explicitly document the current limitation until corrected. Keep current-state truth separate from planned remediation.
- **Documentation separation note:** The repository correctly separates current-state truth, active architecture, future change planning and target-state vision overall; this finding is a contradiction with observable code, not a structural documentation-boundary failure.

## AUD-008

- **Severity:** Low
- **Category:** API Design
- **Location:** `src/modules/fiscal-documents/infrastructure/http/company-pdf-settings.controller.ts`
- **Evidence:** `uploadLogo()` returns `{ error: 'No logo file provided.' }` with default HTTP 200 when no file is supplied.
- **Impact:** Clients may treat failed upload as success; inconsistent error contract.
- **Recommendation:** Return a proper 400 validation error for missing file.

## AUD-009

- **Severity:** Low
- **Category:** Documentation / Migration comments
- **Location:** `prisma/migrations/20260915100000_f4_fiscal_artifacts_delivery/migration.sql`
- **Evidence:** Historical migration comments claim PostgreSQL unique constraint treats nullable `package_version` values as equal. The corrective migration proves and fixes the opposite.
- **Impact:** Future maintainers may be confused when reading migration history.
- **Recommendation:** Leave applied migration unchanged, but document in changelog/current audit that `20260916000000_f4_fix_delivery_unique_null` supersedes the earlier comment.

---

# Behavior to Preserve

- FE/TE fiscal document issuance and immutable snapshots.
- XML generation/signing/XSD validation and `READY_TO_SUBMIT` transition.
- F3 asynchronous submission and terminal accepted/rejected fiscal truth.
- F4 fiscal/delivery status independence.
- `INITIAL_DOCUMENT` trigger at `READY_TO_SUBMIT`, not `ACCEPTED`.
- `HACIENDA_RESPONSE` delivery after F3 terminal accepted/rejected response.
- Rejected Hacienda response delivery without presenting the document as a valid accepted package.
- Official external filenames: `{clave}.xml`, `{clave}_respuesta.xml`, `{clave}.pdf`.
- SHA-256 verification before delivery/download.
- CRLF/path traversal filename sanitization.
- Partial unique indexes for nullable `package_version` delivery idempotency.
- Stale worker protection preventing `DELIVERED` regression.
- Mock adapters for deterministic CI.
- Clear F4.1 boundary: rejected-document replacement is not part of F4.

---

# Known Defects

- Unified artifact listing/download does not cover signed XML and Hacienda response XML through production `FiscalArtifact` rows.
- Initial delivery can be sent without PDF if PDF generation failed or no PDF artifact exists.
- Logo upload lacks dimension/decode/image-bomb validation.
- Artifact download ignores URL fiscal document id when resolving artifact id.
- Download integrity failure is not security-audited.
- Missing logo upload returns HTTP 200-style response.

---

# Architectural Debt

- Application services use Prisma directly; acceptable current style but not fully isolated persistence boundary.
- XML evidence remains split across `FiscalXmlArtifact`/`FiscalSubmission` and is not fully unified by F4 artifact API.
- Asynchronous hooks use `setImmediate`; response delivery has recovery, but initial delivery recovery for already-READY_TO_SUBMIT documents is not clearly present.
- Production SMTP credential management is environment-based rather than SecretProvider-backed.

---

# Unknown Behavior

- Production behavior of real SMTP provider under rate limits/bounces without live provider validation.
- Production QR URL correctness until `HACIENDA_QR_URL_BASE` is confirmed.
- Long-term storage lifecycle enforcement for five-year retention.
- Exact exposure of `npm audit` high findings until triaged.
- PDF rendering behavior for malicious but magic-byte-valid image files with extreme dimensions.

---

# Critical Risks

1. **Artifact API closure risk:** XML evidence is not exposed via the unified protected artifact API.
2. **Incomplete fiscal package risk:** initial delivery can omit PDF under generation/storage failure.
3. **Pre-production security risk:** dependency audit high findings and incomplete logo validation.
4. **Compliance boundary risk:** F4.1 rejected-document replacement remains unimplemented by design; do not market the system as unattended full production compliance until F4.1 is completed.

---

# Recommended Priorities

1. **Close AUD-001 before F4 acceptance:** ensure signed XML and Hacienda response XML are represented/downloadable through the protected artifact API or equivalent unified mechanism.
2. **Close AUD-002 before F4 acceptance:** prevent incomplete initial delivery without PDF.
3. **Add missing regression tests:** XML artifact API coverage, missing-PDF delivery, URL/document mismatch, download tamper security audit, logo dimension rejection.
4. **Harden logo validation:** decode and enforce dimensions safely.
5. **Triage npm audit findings before production.**
6. **Keep F4.1 separate:** plan rejected-document replacement in the dedicated F4.1 phase, not as F4 scope creep.

---

# Final Verdict

**Overall Score: 8.1/10**

F4 is substantially implemented and well validated, with no remaining blocker in worker wiring, PostgreSQL delivery uniqueness, PDF/QR rendering, official filenames, retry/stale-worker protection, fiscal status independence, or F3/F4 integration. One F4 blocker remains for requirement coverage: XML artifacts are not actually available through the unified protected artifact API because production code only creates PDF `FiscalArtifact` rows.

Verdict: **Needs Refactoring**

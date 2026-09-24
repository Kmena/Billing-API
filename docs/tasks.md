# Repository Tasks

> **Synchronized:** Fiscal-company-configuration-and-secure-credentials refresh by `hdd-architecture-agent-3fd9e0` on 2026-09-23. F4 and F5 implementations complete. TASK-008 and TASK-014 are marked Complete. All other tasks remain Proposed until explicitly approved.

---

## TASK-001: Verify production IAM and SecretProvider readiness for Hacienda submission
**Status:** Proposed
**Priority:** High
**Domain:** Hacienda Connection / Fiscal Submission / Deployment
**Requirement:** F3 OQ-012; security and deployment readiness before live production submissions.
**Reason:** F3/F4 code is functionally complete, but real production credential access and IAM/SecretProvider operation must be verified outside the code path before live use.
**Current problem:** Production SecretProvider/IAM/credential provisioning is not confirmed in repository evidence.
**Proposed change:** Produce and validate a pre-production runbook for secret references, IAM permissions, environment-specific credentials, callback URL configuration, rollback mode and no-secret observability checks.
**Affected files:** Documentation/runbook files only unless later approval expands scope.
**Dependencies:** Completed F3 and F4 implementations.
**Database impact:** None expected.
**API impact:** None expected.
**Container impact:** Possible deployment configuration documentation only.
**Security impact:** High positive impact; prevents credential exposure or broken production auth.
**Acceptance criteria:** Production/SANDBOX secret references and IAM permissions are documented; dry-run or sandbox credential access is verified without printing secrets; callback URL exposure is documented; rollback-to-mock/disabled-live behavior is documented.
**Required tests:** Pre-production operational validation checklist; no automated repo test required unless approved.
**Migration considerations:** None.
**Rollback or mitigation:** Keep live Hacienda disabled or mock-only until readiness is proven.
**Risk:** High if skipped before production.

---

## TASK-002: Triage and remediate npm audit vulnerabilities
**Status:** Proposed
**Priority:** High
**Domain:** Security / Supply Chain
**Requirement:** Repository security hardening; npm audit reports 26+ known vulnerabilities. No new vulnerable packages added by F4.
**Reason:** Known dependency vulnerabilities remain a repository-level security risk.
**Current problem:** `npm audit` reports 26+ vulnerabilities; risk has been accepted/documented but not remediated.
**Proposed change:** Run dependency audit, classify by exploitability/runtime exposure, upgrade or replace vulnerable dependencies, and document accepted residual risks.
**Affected files:** `package.json`, `package-lock.json`, possibly affected code/tests if upgrades require changes.
**Dependencies:** None.
**Database impact:** None expected.
**API impact:** None expected unless framework upgrades change behavior.
**Container impact:** Rebuild image after dependency changes.
**Security impact:** High positive impact.
**Acceptance criteria:** Audit count materially reduced or each remaining item has explicit risk acceptance; full quality gates pass.
**Required tests:** `npm ci`, `npm audit`, lint, typecheck, unit, E2E, build, Docker build.
**Migration considerations:** None expected.
**Rollback or mitigation:** Revert dependency changes if regressions occur; document temporary risk acceptance.
**Risk:** Medium implementation risk due dependency compatibility.

---

## TASK-003: Define and enforce throttle/quota policy for expensive fiscal endpoints
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal XML / Fiscal Submission / Fiscal Delivery / Fiscal Artifacts / API Security
**Requirement:** Security hardening for expensive prepare, submit, reconcile, artifact download and delivery endpoints.
**Reason:** Current fiscal and F4 controllers include `@SkipThrottle()` in expensive paths, creating cost/abuse risk.
**Current problem:** No explicit per-tenant/API-key quota is documented for XML signing/XSD validation, submission/reconciliation, artifact downloads or delivery operations.
**Proposed change:** Define throttle semantics and implement per-route or per-scope limits compatible with API-key authentication and Hacienda backoff behavior.
**Affected files:** Fiscal and F4 controllers/guards/config/tests; exact files require implementation planning.
**Dependencies:** Product/API policy decision.
**Database impact:** None expected unless durable quota counters are chosen.
**API impact:** Adds documented 429 behavior.
**Container impact:** None expected.
**Security impact:** Medium positive impact.
**Acceptance criteria:** Approved policy exists; endpoints return documented 429 responses under abuse; legitimate retries remain compatible.
**Required tests:** Unit/guard tests and E2E rate-limit tests.
**Migration considerations:** Use forward-only migration only if durable counters are introduced.
**Rollback or mitigation:** Disable/relax new limits via config if false positives occur.
**Risk:** Medium; overly strict limits can affect legitimate fiscal operations.

---

## TASK-004: Standardize UUID/path-parameter validation
**Status:** Proposed
**Priority:** Medium
**Domain:** API / Security
**Requirement:** Input validation hardening.
**Reason:** Some route parameters are accepted as strings without UUID validation.
**Current problem:** Invalid IDs can reach services and create noisy errors or inconsistent error contracts.
**Proposed change:** Choose global validation pipe or route-level `ParseUUIDPipe` strategy and apply consistently to fiscal/company/tenant path params where UUIDs are expected.
**Affected files:** Controllers and E2E tests across modules.
**Dependencies:** API error contract decision.
**Database impact:** None.
**API impact:** More deterministic 400 responses for invalid UUIDs; compatibility impact must be documented.
**Container impact:** None.
**Security impact:** Medium positive impact.
**Acceptance criteria:** Invalid UUID requests fail before service/database access with documented error shape; valid requests remain unchanged.
**Required tests:** Controller/E2E invalid ID tests for representative endpoints.
**Migration considerations:** None.
**Rollback or mitigation:** Revert pipes if clients depend on previous non-400 behavior; communicate compatibility change.
**Risk:** Medium due public contract behavior changes.

---

## TASK-005: Characterize and harden concurrent prepare-XML requests
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal XML / Persistence
**Requirement:** F2.3 hardening; preserve immutable signed XML and avoid race conditions.
**Reason:** F3 submit concurrency is covered, but earlier audit noted simultaneous `prepare-xml` calls may race.
**Current problem:** Idempotent retry after `READY_TO_SUBMIT` is proven, but concurrent transformation from pre-ready states needs stronger characterization.
**Proposed change:** Add PostgreSQL-backed concurrency tests and, if needed, row lock/compare-and-set status guards around XML preparation.
**Affected files:** `PrepareFiscalXmlService`, fiscal XML tests/E2E; possible Prisma migration only if metadata is added.
**Dependencies:** None.
**Database impact:** None expected if row locks/status guards suffice.
**API impact:** None expected; concurrent duplicate behavior should be idempotent or conflict-safe.
**Container impact:** None.
**Security impact:** Low/Medium positive impact by reducing DoS/race amplification.
**Acceptance criteria:** Concurrent duplicate prepare calls do not create inconsistent artifacts, mutate ready XML, or produce multiple divergent signed XMLs.
**Required tests:** PostgreSQL-backed concurrency tests and E2E characterization.
**Migration considerations:** Do not modify old migrations; add forward-only migration only if schema support is required.
**Rollback or mitigation:** Preserve existing single-request behavior; revert concurrency change if it regresses prepare flow.
**Risk:** Medium because XML preparation coordinates external-like signing/storage operations.

---

## TASK-006: Decide whether to introduce dedicated fiscal-submission and delivery scopes
**Status:** Proposed
**Priority:** Low
**Domain:** Identity and Access / Fiscal Submission / Fiscal Delivery / Fiscal Artifacts
**Requirement:** Authorization model clarification.
**Reason:** F3 and F4 currently use existing `invoices:write` / `tickets:write` / `invoices:read` / `tickets:read` scopes for submit/status/reconcile/resend/artifact-download operations.
**Current problem:** This is simple and implemented, but may be broader than desired for least-privilege access patterns.
**Proposed change:** Decide whether to retain current scopes or add dedicated scopes (e.g., `fiscal-submissions:*`, `fiscal-artifacts:*`, `fiscal-deliveries:*`) in a backward-compatible way.
**Affected files:** API key scope definitions, guards/controllers/tests/docs if implemented later.
**Dependencies:** Product/security decision.
**Database impact:** Possible API-key scope data migration if new scopes are introduced.
**API impact:** Potential authorization contract change; must be backward-compatible or versioned.
**Container impact:** None.
**Security impact:** Low/Medium positive impact if least privilege is needed.
**Acceptance criteria:** Explicit decision recorded; if new scopes are approved, migration/compatibility plan exists before implementation.
**Required tests:** Scope guard/controller/E2E tests if implemented.
**Migration considerations:** Existing API keys may need transition period.
**Rollback or mitigation:** Continue current invoice/ticket scopes until dedicated policy is approved.
**Risk:** Low/Medium due client compatibility.

---

## TASK-007: Evaluate FiscalSubmission and FiscalDelivery repository port extraction
**Status:** Proposed
**Priority:** Low
**Domain:** Fiscal Submission / Fiscal Delivery / Architecture
**Requirement:** Incremental hexagonal architecture improvement.
**Reason:** F3 and F4 application services and workers directly use Prisma, consistent with current fiscal style but less isolated than ideal ports-and-adapters.
**Current problem:** Persistence logic is coupled to application services, which may become harder to evolve.
**Proposed change:** Evaluate and optionally extract `FiscalSubmissionRepositoryPort` and/or `FiscalDeliveryRepositoryPort` after behavior is stable, keeping behavior unchanged and tests as characterization.
**Affected files:** F3/F4 application services/workers/tests and infrastructure persistence adapters if approved.
**Dependencies:** Completed F3 and F4; future complexity justifying extraction.
**Database impact:** None.
**API impact:** None.
**Container impact:** None.
**Security impact:** Neutral.
**Acceptance criteria:** If implemented, no API/database behavior changes; tests prove same transitions and artifact persistence.
**Required tests:** Existing F3/F4 unit/integration/concurrency/E2E suites.
**Migration considerations:** None.
**Rollback or mitigation:** Defer extraction; direct Prisma remains acceptable current architecture.
**Risk:** Low/Medium refactor risk.

---

## TASK-014: Implement fiscal certificate management and readiness (fiscal-company-configuration-and-secure-credentials)
**Status:** Complete
**Priority:** High
**Domain:** Fiscal Documents / Fiscal XML / Companies
**Requirement:** `specs/fiscal-company-configuration-and-secure-credentials/` — FR-001 through FR-028; DEC-001 through DEC-009.
**Reason:** F4-S proved the fiscal pipeline works end-to-end; this spec converts that capability into a durable, secure, self-service product feature available to any authorized company.
**Current problem (was):** Certificate upload required manual SQL or bootstrap scripts; no identity validation; no readiness status; no company identity guard; no pre-signing defense-in-depth.
**Outcome:** All 11 tasks implemented. 78 new tests. 893 tests / 71 suites PASS (1 pre-existing failure unchanged). TypeScript: 0 errors. Lint: 0 errors on all new/modified files. Architecture documentation updated by `hdd-architecture-agent-3fd9e0` on 2026-09-23. See `specs/fiscal-company-configuration-and-secure-credentials/implementation-report.md` for complete evidence.
**Risk:** Closed.

---

## TASK-008: Specify and implement F4 PDF, email and delivery workflow
**Status:** Complete
**Priority:** Medium (was Medium; now complete)
**Domain:** Fiscal Delivery / Product
**Requirement:** F4 specification and implementation.
**Reason:** F3 now persists authoritative Hacienda response artifacts that F4 consumes for PDF/email/delivery.
**Current problem (was):** No approved F4 domain model, APIs, artifact contracts, delivery audit or retry behavior existed.
**Outcome:** All 23 F4 tasks implemented. AUD-001–AUD-005 remediated. 531 tests PASS. See `specs/fase-4-fiscal-artifacts-delivery/implementation-report.md` for complete evidence. Architecture documentation updated by `hdd-architecture-agent-65ee79` on 2026-09-17.
**Risk:** Closed.

---

## TASK-009: Migrate SMTP credentials to SecretProvider
**Status:** Proposed
**Priority:** High
**Domain:** Fiscal Delivery / Security / Infrastructure
**Requirement:** F4 pre-production security prerequisite; current SMTP credentials are plain env vars.
**Reason:** SMTP credentials (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`) are currently plain NestJS ConfigService environment variables, not routed through `SecretProvider`. This is inconsistent with the credential handling pattern used for Hacienda OAuth credentials.
**Current problem:** SMTP credentials are exposed in any environment-variable dump or process introspection; not behind the existing `SecretProvider` abstraction.
**Proposed change:** Route SMTP credential lookup through `SecretProvider` (env or SSM provider) consistent with Hacienda credential pattern; update `NodemailerEmailDeliveryAdapter` factory; update env validation schema.
**Affected files:** `src/modules/fiscal-documents/fiscal-documents.module.ts`, `src/modules/fiscal-documents/infrastructure/email/nodemailer-email-delivery.adapter.ts`, `src/infrastructure/config/config.validation-schema.ts`, related tests.
**Dependencies:** Completed F4 email adapter implementation.
**Database impact:** None.
**API impact:** None (internal infrastructure change).
**Container impact:** Possible deployment configuration change only.
**Security impact:** High positive; consistent secret handling across all external service credentials.
**Acceptance criteria:** SMTP credentials resolved through `SecretProvider`; no plain-text SMTP credentials in `configService.get()` calls; existing email delivery behavior unchanged; unit tests updated.
**Required tests:** Updated `NodemailerEmailDeliveryAdapter` factory test; config validation test.
**Migration considerations:** None.
**Rollback or mitigation:** Revert to plain configService if SecretProvider access fails; document fallback procedure.
**Risk:** Low implementation risk; isolated to email adapter factory.

---

## TASK-010: Confirm HACIENDA_QR_URL_BASE and document production QR configuration
**Status:** Proposed
**Priority:** High
**Domain:** Fiscal Delivery / Deployment
**Requirement:** F4 pre-production prerequisite; QR URL base is operator-configured; no default is hardcoded in production.
**Reason:** The exact Hacienda CE consultation URL for production QR codes has not been confirmed. The system fails fast at startup in production/staging if `HACIENDA_QR_URL_BASE` is missing.
**Current problem:** `HACIENDA_QR_URL_BASE` exact production value is not confirmed in the repository or deployment runbook.
**Proposed change:** Confirm the correct Hacienda CE consultation URL; document it in the production configuration runbook; verify the `HaciendaQrContentBuilderAdapter` produces correct QR payloads; add a production smoke-test checklist item for QR readability.
**Affected files:** Deployment runbook (documentation); possibly `.env.local.example` for documentation purposes.
**Dependencies:** External Hacienda CE consultation URL confirmation.
**Database impact:** None.
**API impact:** None.
**Container impact:** Production environment variable update only.
**Security impact:** Low positive; ensures QR consultation URL is correct and not expired.
**Acceptance criteria:** Verified Hacienda CE consultation URL documented; production config runbook updated; QR URL passes smoke-test readability check with a known Clave.
**Required tests:** Existing `qr-content-builder.spec.ts` continues to pass; add production smoke-test checklist.
**Migration considerations:** None.
**Rollback or mitigation:** Keep mock QR adapter active in non-production environments if URL is unavailable.
**Risk:** Low implementation risk; external dependency on Hacienda confirmation.

---

## TASK-011: Verify F4 Prisma migration on live PostgreSQL 15
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal Documents / Database / Infrastructure
**Requirement:** Migration safety; `20260915100000_f4_fiscal_artifacts_delivery` has been Prisma-validate verified but not live-deployed.
**Reason:** Migration SQL correctness should be confirmed by deploying from zero on a clean PostgreSQL 15 instance before production.
**Current problem:** Live deploy verification for F4 migration is pending.
**Proposed change:** Run `prisma migrate deploy` on a clean PostgreSQL 15 from migration zero; confirm all F4 tables, enums, indexes and unique constraints are created correctly; verify existing F3 data remains intact.
**Affected files:** `prisma/migrations/20260915100000_f4_fiscal_artifacts_delivery/migration.sql`.
**Dependencies:** Available PostgreSQL 15 environment.
**Database impact:** Verification only; no schema change.
**API impact:** None.
**Container impact:** None.
**Security impact:** None.
**Acceptance criteria:** `prisma migrate deploy` completes without errors on clean PostgreSQL 15; all F4 tables/enums/indexes present; full quality gates pass.
**Required tests:** `npm run typecheck`, `npm test`, `npm run build` after clean migration deploy.
**Migration considerations:** Forward-only; do not modify existing migration SQL.
**Rollback or mitigation:** If migration fails, diagnose and create a corrective forward-only migration; never edit applied migration.
**Risk:** Low; Prisma validate already PASS.

---

## TASK-012: Specify and plan F4.1 rejected document replacement workflow
**Status:** Proposed
**Priority:** High
**Domain:** Fiscal Documents / Fiscal Delivery / Compliance
**Requirement:** F4.1 DEC-010; legal obligation per Reglamento de Comprobantes Electrónicos; compliance gap documented in F4 implementation report.
**Reason:** Rejected documents require the operator to immediately issue a replacement comprobante that references the rejected one and is automatically sent to the receptor. F4 delivers the rejection response truthfully but does NOT implement replacement issuance. Until F4.1 is implemented, rejected comprobantes require manual operator remediation. Billing must NOT be declared fully production-ready for unattended fiscal issuance until F4.1 is complete.
**Current problem:** No approved F4.1 domain model, replacement issuance workflow, rejection tracking API or automated re-issuance process exists.
**Proposed change:** Create SDD specification for F4.1: rejected document identification, replacement comprobante issuance referencing original Clave, automatic delivery to receptor, operator escalation workflow, compliance audit trail and risk mitigations.
**Affected files:** New `specs/fase-4-1-rejected-document-replacement/` directory and architecture planning docs only until approved.
**Dependencies:** Completed F4 current-state documentation; Hacienda Reglamento requirements for replacement documents.
**Database impact:** To be determined by F4.1 spec.
**API impact:** To be determined by F4.1 spec.
**Container impact:** To be determined by F4.1 spec.
**Security impact:** Must address replacement comprobante identity, Clave generation, fiscal integrity and audit requirements.
**Acceptance criteria:** F4.1 requirements, architecture, risks, decisions, tasks and traceability are approved before implementation.
**Required tests:** To be defined by F4.1 spec.
**Migration considerations:** Future forward-only migrations only.
**Rollback or mitigation:** Keep F4 rejection delivery truthful and expose rejected fiscalDocumentId/Clave for manual operator remediation until F4.1 is approved and implemented.
**Risk:** High compliance risk if unattended production issuance begins before F4.1 is implemented.

---

## TASK-013: Document and operationalize 5-year fiscal artifact retention policy
**Status:** Proposed
**Priority:** High
**Domain:** Fiscal Documents / Fiscal Artifacts / Compliance / Infrastructure
**Requirement:** FR-021 (Reglamento Article 22); electronic comprobantes, PDF and delivery evidence must be preserved for at least 5 years.
**Reason:** The F4 implementation stores artifacts but does not implement a storage lifecycle policy to prevent accidental deletion or ensure retention compliance.
**Current problem:** No storage lifecycle/retention policy is documented or operationalized in the repository.
**Proposed change:** Define and document the 5-year retention policy: storage provider lifecycle rules, backup policy, deletion prohibition, audit-log retention classification (`FISCAL_AUDIT >= 5 years` already in schema) and operational runbook.
**Affected files:** Deployment runbook and documentation; possible storage infrastructure configuration depending on provider.
**Dependencies:** OQ-012 and production storage provider decision.
**Database impact:** Possible retention metadata columns if approved.
**API impact:** None.
**Container impact:** None.
**Security impact:** Positive; ensures compliance with retention obligation and prevents accidental data loss.
**Acceptance criteria:** 5-year retention policy documented; storage lifecycle rules configured in production environment; no destructive purge path exists without explicit approval; audit records classified correctly.
**Required tests:** Operational checklist; no automated repo test unless purge protection is code-level.
**Migration considerations:** None.
**Rollback or mitigation:** Escalate to compliance review if storage provider does not support required retention policy.
**Risk:** High compliance risk if retention is not operationalized before production use.

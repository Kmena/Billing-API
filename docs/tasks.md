# Repository Tasks

> **Synchronized:** Final F3 Hacienda asynchronous submission documentation refresh by `hdd-architecture-agent-4f9f0f` on 2026-09-14. F3 implementation is complete functionally and audit accepted. The tasks below are remaining future work only. All new/current repository-level tasks are **Proposed** until explicitly approved.

## TASK-001: Verify production IAM and SecretProvider readiness for Hacienda submission
**Status:** Proposed
**Priority:** High
**Domain:** Hacienda Connection / Fiscal Submission / Deployment
**Requirement:** F3 OQ-012; security and deployment readiness before live production submissions.
**Reason:** F3 code is functionally complete, but real production credential access and IAM/SecretProvider operation must be verified outside the code path before live use.
**Current problem:** Production SecretProvider/IAM/credential provisioning is not confirmed in repository evidence.
**Proposed change:** Produce and validate a pre-production runbook for secret references, IAM permissions, environment-specific credentials, callback URL configuration, rollback mode and no-secret observability checks.
**Affected files:** Documentation/runbook files only unless later approval expands scope.
**Dependencies:** Completed F3 implementation.
**Database impact:** None expected.
**API impact:** None expected.
**Container impact:** Possible deployment configuration documentation only.
**Security impact:** High positive impact; prevents credential exposure or broken production auth.
**Acceptance criteria:** Production/SANDBOX secret references and IAM permissions are documented; dry-run or sandbox credential access is verified without printing secrets; callback URL exposure is documented; rollback-to-mock/disabled-live behavior is documented.
**Required tests:** Pre-production operational validation checklist; no automated repo test required unless approved.
**Migration considerations:** None.
**Rollback or mitigation:** Keep live Hacienda disabled or mock-only until readiness is proven.
**Risk:** High if skipped before production.

## TASK-002: Triage and remediate npm audit vulnerabilities
**Status:** Proposed
**Priority:** High
**Domain:** Security / Supply Chain
**Requirement:** Repository security hardening; final F3 audit documents 26 known vulnerabilities unrelated to new F3 dependencies.
**Reason:** Known dependency vulnerabilities remain a repository-level security risk.
**Current problem:** `npm audit` reports 26 vulnerabilities; risk has been accepted/documented but not remediated.
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

## TASK-003: Define and enforce throttle/quota policy for expensive fiscal endpoints
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal XML / Fiscal Submission / API Security
**Requirement:** Security hardening for expensive prepare, submit and reconcile endpoints.
**Reason:** Current fiscal controllers include `@SkipThrottle()` in expensive paths, creating cost/abuse risk.
**Current problem:** No explicit per-tenant/API-key quota is documented for XML signing/XSD validation or submission/reconciliation requests.
**Proposed change:** Define throttle semantics and implement per-route or per-scope limits compatible with API-key authentication and Hacienda backoff behavior.
**Affected files:** Fiscal controllers/guards/config/tests; exact files require implementation planning.
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

## TASK-006: Decide whether to introduce dedicated fiscal-submission scopes
**Status:** Proposed
**Priority:** Low
**Domain:** Identity and Access / Fiscal Submission
**Requirement:** Authorization model clarification.
**Reason:** F3 currently uses existing `invoices:write` / `tickets:write` scopes for submit/status/reconcile.
**Current problem:** This is simple and implemented, but may be broader than desired for operators that can create documents but should not submit/reconcile them.
**Proposed change:** Decide whether to retain current scopes or add dedicated `fiscal-submissions:write/read/reconcile` style scopes in a backward-compatible way.
**Affected files:** API key scope definitions, guards/controllers/tests/docs if implemented later.
**Dependencies:** Product/security decision.
**Database impact:** Possible API-key scope data migration if new scopes are introduced.
**API impact:** Potential authorization contract change; must be backward-compatible or versioned.
**Container impact:** None.
**Security impact:** Low/Medium positive impact if least privilege is needed.
**Acceptance criteria:** Explicit decision recorded; if new scopes are approved, migration/compatibility plan exists before implementation.
**Required tests:** Scope guard/controller/E2E tests if implemented.
**Migration considerations:** Existing API keys may need transition period.
**Rollback or mitigation:** Continue current invoice/ticket write scopes until dedicated policy is approved.
**Risk:** Low/Medium due client compatibility.

## TASK-007: Evaluate FiscalSubmission repository port extraction
**Status:** Proposed
**Priority:** Low
**Domain:** Fiscal Submission / Architecture
**Requirement:** Incremental hexagonal architecture improvement.
**Reason:** F3 application services and workers directly use Prisma, consistent with current fiscal style but less isolated than ideal ports-and-adapters.
**Current problem:** Persistence logic is coupled to application services, which may become harder to evolve as F4 consumes submission artifacts.
**Proposed change:** Evaluate and optionally extract a `FiscalSubmissionRepositoryPort` after behavior is stable, keeping behavior unchanged and tests as characterization.
**Affected files:** F3 application services/workers/tests and infrastructure persistence adapter if approved.
**Dependencies:** Completed F3; future complexity justifying extraction.
**Database impact:** None.
**API impact:** None.
**Container impact:** None.
**Security impact:** Neutral.
**Acceptance criteria:** If implemented, no API/database behavior changes; tests prove same transitions and artifact persistence.
**Required tests:** Existing F3 unit/integration/concurrency/E2E suites.
**Migration considerations:** None.
**Rollback or mitigation:** Defer extraction; direct Prisma remains acceptable current architecture.
**Risk:** Low/Medium refactor risk.

## TASK-008: Specify F4 PDF, email and delivery workflow
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal Delivery / Product
**Requirement:** Future phase; F4 explicitly not introduced by F3.
**Reason:** F3 now persists authoritative Hacienda response artifacts that F4 will consume, but PDF/email/delivery requirements are not defined.
**Current problem:** No approved F4 domain model, APIs, artifact contracts, delivery audit or retry behavior exists.
**Proposed change:** Create SDD specification for PDF generation, customer email/delivery, delivery status, artifact access and audit requirements.
**Affected files:** New `specs/` directory and architecture planning docs only until approved.
**Dependencies:** Completed F3 current-state documentation.
**Database impact:** To be determined by F4 spec.
**API impact:** To be determined by F4 spec.
**Container impact:** To be determined by F4 spec.
**Security impact:** Must address PII/XML/PDF exposure and email delivery risks.
**Acceptance criteria:** F4 requirements, architecture, risks, decisions, tasks and traceability are approved before implementation.
**Required tests:** To be defined by F4 spec.
**Migration considerations:** Future forward-only migrations only.
**Rollback or mitigation:** Keep F3 artifacts private and expose no PDF/email behavior until F4 is approved.
**Risk:** Medium due fiscal artifact and customer communication obligations.

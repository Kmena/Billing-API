# Current Code Audit

Audit agent: `baseline-audit-agent-2ece22`  
Audit scope: re-run final F3 audit after remediation for confirmed specification `specs/fase-3-hacienda-async-submission`.

# Executive Summary

F3 Hacienda asynchronous submission is implemented and the two prior functional blockers have been remediated in the inspected repository state.

Prior AUD-001 is resolved: duplicate submit requests against existing `ACKNOWLEDGED`, `PROCESSING`, and `POST_OUTCOME_UNKNOWN` submissions no longer reset the submission to `QUEUED` and no longer publish a submit/POST job. They publish a reconciliation job only. `SUBMITTING` returns current state without re-enqueue.

Prior AUD-002 is resolved for the inspected failure modes: submit worker exceptions after claim are caught, mapped to `TECHNICAL_RETRY_PENDING`, and rescheduled; startup/due-work recovery now detects stale persisted `SUBMITTING` rows and requeues work after mapping them to a retryable state.

The requested F3 behavior assertions are supported by repository code and tests: normal FE/TE accepted continuity, authoritative rejected only, HTTP 201 non-terminal handling, ambiguous POST reconciliation by same Clave without repeat submit, duplicate API/job/callback safety, callback/poll race safety, terminal monotonicity, restart/stale pending recovery, tenant/company/environment isolation, credential secrecy in DB/jobs/audit metadata, exact decoded `respuesta-xml` retention, no F2.2/F2.3 regression, and no F4 functionality introduced.

Remaining concerns are not F3-specific release blockers in code behavior: known dependency vulnerabilities remain as documented pre-existing debt, and the public callback response still leaks an `enqueued` signal. The documentation drift noted by this audit was remediated by the final documentation refresh on 2026-09-14 by `hdd-architecture-agent-4f9f0f`.

# Overall Score

Overall Score: 8.6/10

Justification: The implementation now satisfies the core F3 safety invariants under inspected code and provided validation evidence. Original score was limited by unresolved dependency vulnerabilities, stale documentation, and minor callback information-leak/abuse concerns. Documentation drift was remediated after the audit; unresolved dependency and callback hardening concerns remain non-blocking. No remaining F3 functional blocker was found.

Final verdict: Acceptable

# Repository Overview

- Platform: NestJS / TypeScript modular monolith.
- Persistence: Prisma ORM with PostgreSQL migrations.
- Queue: pg-boss production adapter and in-memory test adapter via `JobQueuePort`.
- Storage: `StoragePort` abstraction for signed XML and Hacienda response artifacts.
- Secrets/auth: `SecretProvider`, Hacienda auth port and process-local token cache.
- F3 implementation areas: `src/modules/fiscal-documents/application/submission/**`, `domain/submission/**`, `infrastructure/submission/**`, F3 HTTP controllers, queue infrastructure, Hacienda submission config and Prisma F3 migration.

# Current Architecture

Current architecture is a pragmatic modular monolith with partial hexagonal boundaries:

- Domain logic: framework-free state machine and retry classifier.
- Application logic: submit/status/reconcile/callback use cases and worker orchestration.
- Infrastructure: HTTP controllers, real/mock Hacienda adapters, pg-boss/in-memory queues, Prisma persistence.
- Dependency direction is mostly controller → application → ports/adapters, although application services directly use Prisma.
- Event processing uses durable pg-boss jobs in production and synchronous in-memory queue in tests.
- Authentication/authorization uses API key guard, scope guard, API-key/company link checks, tenant/company/environment filters, and a signal-only unauthenticated Hacienda callback endpoint.

# Documentation Findings

Documentation separation is structurally good. The stale/mixed F3 status found by this audit was remediated in the final documentation refresh on 2026-09-14 by `hdd-architecture-agent-4f9f0f`:

- `docs/current-state.md` now records F3 as functionally complete and audit accepted.
- `docs/architecture.md` now records F3 as active implemented architecture.
- `docs/action-plan.md` and `docs/tasks.md` now track only remaining proposed production-readiness/hardening work.
- `specs/fase-3-hacienda-async-submission/current-state.md`, `architecture.md`, `risks.md`, `decisions.md`, `traceability.md`, `tasks.md`, `metadata.yaml`, `implementation-report.md` and `changelog.md` were refreshed or annotated.

Separation assessment after refresh:
- current-state truth: synchronized to implemented F3 behavior.
- active architecture: synchronized to implemented F3 architecture.
- future change planning: remaining work is separated into proposed production-readiness/hardening tasks.
- target-state vision: `docs/future-architecture.md` now treats F3 as implemented and F4 as future.

# Main Modules

- `SubmitFiscalDocumentService`: submit preconditions, idempotent creation/reuse, duplicate-state-aware job publishing.
- `FiscalSubmissionWorkerService`: submit/reconcile job handling, stale `SUBMITTING` recovery, retry scheduling, token retry, signed XML hash verification.
- `FiscalSubmissionStateService`: transition application, terminal document update, response artifact storage/hash, audit recording.
- `FiscalSubmissionStateMachine`: allowed transitions and terminal monotonicity.
- `RetryClassifier`: retry/reconcile/manual/terminal classification logic.
- `HaciendaRecepcionAdapter`: official recepcion POST/GET contract mapping.
- `MockHaciendaSubmissionAdapter`: deterministic F3 test scenarios.
- `FiscalSubmissionController` and `HaciendaCallbackController`: F3 API surface.

# Main Dependencies

Main dependencies include NestJS, Prisma, pg-boss, axios, AWS SDK, argon2, pino, node-forge, xml-crypto and xmlbuilder2. Latest validation evidence reports 26 known `npm audit` vulnerabilities: 4 low, 14 moderate, 8 high. No F3-specific dependency was added for the remediations.

# Database Findings

The F3 migration is additive and appropriate for the implemented lifecycle:

- Adds `FiscalSubmissionStatus` enum.
- Adds `ACCEPTED` and `REJECTED` document statuses.
- Adds `fiscal_submissions` with tenant/company/document/environment/Clave/signed XML snapshot, status, counters, timestamps, provider metadata and response artifact metadata.
- Adds unique constraints on `fiscal_document_id` and `clave`.
- Adds indexes for scope/status, due work and environment/status.
- Adds FKs to tenants, companies and fiscal documents.

No F3 DB columns store OAuth tokens, Hacienda passwords or raw secret values. Only secret references and artifact/storage metadata are persisted elsewhere in existing models.

# API Findings

Implemented F3 endpoints:

- `POST /api/v1/companies/:companyId/fiscal-documents/:environment/invoices/:id/submit`
- `POST /api/v1/companies/:companyId/fiscal-documents/:environment/tickets/:id/submit`
- `GET /api/v1/companies/:companyId/fiscal-documents/:environment/invoices/:id/submission`
- `GET /api/v1/companies/:companyId/fiscal-documents/:environment/tickets/:id/submission`
- `POST /api/v1/companies/:companyId/fiscal-documents/:environment/invoices/:id/submission/reconcile`
- `POST /api/v1/companies/:companyId/fiscal-documents/:environment/tickets/:id/submission/reconcile`
- `POST /api/v1/hacienda/callback`

Submit and reconcile return HTTP 202. Callback returns HTTP 200. Submit/status/reconcile enforce API key, scope and company authorization checks. Callback validates Clave format and resolves state from persisted Clave mapping.

# Container Findings

Dockerfile remains acceptable:

- Multi-stage build.
- Non-root runner user.
- Production dependency pruning.
- Healthcheck.
- Python/XSD validator packaging included.

`docker-compose.yml` is development-oriented and includes dev/test defaults; it should not be treated as production secrets configuration.

# Security Findings

Positive findings:

- F3 job payloads contain only `submissionId`.
- DB schema does not persist tokens/passwords.
- Audit metadata inspected for F3 does not include tokens/passwords.
- Callback does not trust callback-provided tenant/company; it resolves by persisted `clave`.
- Tenant/company/environment isolation filters are present in submit/status/reconcile paths.
- Hacienda bearer token is passed only to adapter input/HTTP Authorization header.

Remaining risks:

- Known high dependency vulnerabilities remain.
- Public callback returns `{ accepted, enqueued }`, which can reveal whether a Clave corresponds to a non-terminal persisted submission.

# Testing Findings

Latest provided validation evidence:

- `npm ci` passed; `npm audit` reports known vulnerabilities.
- Prisma generate/validate/migrate deploy passed on clean PostgreSQL 15.
- `npm run lint` and `npm run lint:check` passed.
- `npm run typecheck` passed.
- `npm test -- --silent` passed: 49 suites / 349 tests.
- `npm run build` passed.
- `npm run test:e2e -- --silent --runInBand` passed: 15 suites / 85 tests.
- Focused F3 suite passed: 13 suites / 122 tests.
- Focused F3 E2E passed: 1 suite / 14 tests.
- Docker runner build passed.

Repository inspection confirms added regression tests for prior blockers:

- Duplicate submit for `ACKNOWLEDGED`, `PROCESSING`, and `POST_OUTCOME_UNKNOWN` publishes reconciliation, does not update/reset status, and does not publish submit job.
- Submit worker local exception after claim maps to `TECHNICAL_RETRY_PENDING` and schedules retry.
- Stale persisted `SUBMITTING` rows are recovered by `enqueueDueWork()`.

# Maintainability Findings

The F3 code is coherent and localized. The worker remains a complexity hotspot because it combines queue registration, DB claiming, storage download, hash verification, token acquisition, provider calls, failure mapping and scheduling. This is working technical debt rather than a release blocker.

# Technical Debt

- Dependency vulnerability debt remains and requires broader package/framework remediation outside approved F3 scope.
- Root documentation drift was identified by the audit and remediated by the 2026-09-14 final architecture documentation refresh.
- Queue uniqueness is handled through database state guards rather than explicit unique/singleton job semantics in the queue port.
- No dedicated submission-attempt table exists; attempts are represented by counters and metadata.
- Callback endpoint has minimal abuse throttling/information-hiding at the endpoint level.

# Behavior to Preserve

- Normal FE and TE API-created documents pass through F2.2/F2.3 and F3 to authoritative `ACCEPTED` under deterministic adapter.
- Only authoritative Hacienda `aceptado` yields `ACCEPTED`.
- Only authoritative Hacienda `rechazado` yields `REJECTED`.
- HTTP 201 POST acknowledgement remains non-terminal `ACKNOWLEDGED`.
- Technical failures are not fiscal rejection.
- Ambiguous POST maps to `POST_OUTCOME_UNKNOWN` and reconciles by same Clave without repeat POST.
- Duplicate API calls/jobs/callbacks are safe under tested scenarios.
- Callback/poll races do not regress terminal state.
- Terminal states are monotonic.
- Restart/due-work recovery includes stale persisted `SUBMITTING` recovery.
- Tenant/company/environment isolation is enforced.
- Jobs, F3 DB records and audit metadata do not contain Hacienda passwords or OAuth tokens.
- Exact decoded `respuesta-xml` bytes are stored with SHA-256/content type/storage reference.
- F2.2/F2.3 creation/XML/signing continuity is preserved.
- No F4 PDF/storage delivery/email functionality was introduced.

# Known Defects

No remaining F3 functional blocker was found in the inspected repository state.

Known non-F3 defect/debt:

- `npm audit` reports 26 known vulnerabilities.
- Root and spec-local documentation were stale/mixed during audit; this was remediated by the 2026-09-14 final architecture documentation refresh.

# Architectural Debt

- Application services directly use Prisma infrastructure.
- Worker service has broad orchestration responsibilities.
- Queue port does not model unique job semantics explicitly.
- Callback endpoint is signal-only but public and minimally abuse-hardened.

# Unknown Behavior

- Live Hacienda sandbox/production behavior was not executed in this audit.
- Production IAM/SecretProvider permissions remain deployment concerns.
- Exact exploitability/reachability of each npm vulnerability was not assessed.
- Operational horizon/manual-review policy under very long Hacienda outages remains only partially visible in code.

# Critical Risks

No open Critical F3 code risk remains after the inspected remediations.

High residual risks:

- Known dependency vulnerabilities.
- Documentation drift was a high operational risk during audit but is now remediated by the final architecture documentation refresh.

# Recommended Priorities

1. Release gate: document accepted risk for dependency vulnerabilities or schedule dependency remediation.
2. Keep synchronized `docs/current-state.md`, `docs/architecture.md`, F3 `current-state.md`, `implementation-report.md`, `tasks.md` and this audit result after future implementation cycles.
3. Harden callback response uniformity and abuse controls.
4. Keep worker complexity under watch; refactor only under a separately approved maintenance task.
5. Run live Hacienda sandbox verification as an explicit opt-in deployment readiness task, not as ordinary CI.

# Findings

## AUD-001

- Severity: Low
- Category: Remediation verification / API idempotency
- Location: `src/modules/fiscal-documents/application/submission/submit-fiscal-document.service.ts`, `src/modules/fiscal-documents/application/submission/__tests__/submit-fiscal-document.service.spec.ts`
- Evidence: `jobNameForSubmissionStatus()` maps `ACKNOWLEDGED`, `PROCESSING`, and `POST_OUTCOME_UNKNOWN` to `RECONCILE_FISCAL_SUBMISSION_JOB`; `markQueuedWhenSafeToSubmit()` does not update those states to `QUEUED`; unit tests assert no update and reconciliation-job publication for these states.
- Impact: Prior critical duplicate-submit/repeated-POST blocker is resolved for inspected states.
- Recommendation: Preserve these regression tests and extend them if new submission states are added.

## AUD-002

- Severity: Low
- Category: Remediation verification / Worker recovery
- Location: `src/modules/fiscal-documents/application/submission/workers/fiscal-submission-worker.service.ts`, `src/modules/fiscal-documents/application/submission/workers/__tests__/fiscal-submission-worker.service.spec.ts`
- Evidence: `handleSubmitJob()` wraps post-claim processing in `try/catch`; `handleSubmitFailure()` applies `TECHNICAL_RETRY_PENDING` and schedules retry. `enqueueDueWork()` finds stale `SUBMITTING` rows older than five minutes, applies `FISCAL_SUBMISSION_STALE_SUBMITTING_RECOVERED`, and republishes work. Tests cover both paths.
- Impact: Prior high stuck-`SUBMITTING` blocker is resolved for local post-claim worker exceptions and stale persisted in-flight rows.
- Recommendation: Preserve tests and monitor production metrics for repeated worker-failure loops.

## AUD-003

- Severity: High
- Category: Security / Dependencies
- Location: `package-lock.json`, latest `npm audit --audit-level=low` validation evidence
- Evidence: Latest validation reports 26 known vulnerabilities: 4 low, 14 moderate, 8 high. User notes fixes mostly require broad/breaking Nest/CLI/Swagger dependency upgrades and no F3-specific dependency was added.
- Impact: Production exposure may be affected depending on vulnerability reachability.
- Recommendation: Document accepted risk for F3 release if proceeding; plan dependency remediation separately with full regression validation.

## AUD-004

- Severity: Closed after audit
- Category: Documentation / Outdated and mixed current vs proposed state
- Location: `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`, `docs/tasks.md`, `docs/changelog.md`, `docs/future-architecture.md`, and F3 spec docs.
- Evidence: The audit found root/spec docs still saying F3 was not started or TASK-018/TASK-020 were blocked/pending. Final documentation refresh on 2026-09-14 synchronized repository and spec docs to the completed F3 state.
- Impact: Downstream agents and operators now have synchronized current-state and architecture docs.
- Recommendation: Preserve refresh discipline after future implementation cycles.

## AUD-005

- Severity: Medium
- Category: Security / Callback information leakage
- Location: `src/modules/fiscal-documents/application/submission/handle-hacienda-callback.service.ts`
- Evidence: Public callback returns `{ accepted: true, enqueued: boolean }` and queues reconciliation for existing non-terminal submissions.
- Impact: A caller can infer whether a valid-format Clave maps to an active non-terminal submission and can create reconciliation load.
- Recommendation: Return a uniform response and apply callback abuse/rate controls.

## AUD-006

- Severity: Suggestion
- Category: Maintainability
- Location: `src/modules/fiscal-documents/application/submission/workers/fiscal-submission-worker.service.ts`
- Evidence: One service handles queue registration, DB state claiming, storage, hashing, token acquisition, Hacienda provider calls, failure mapping and scheduling.
- Impact: Future Hacienda lifecycle expansion may increase complexity and regression risk.
- Recommendation: Treat as a future refactoring hotspot after F3 release stabilization; do not redesign as part of this audit.

# Blockers and Remediations

Remaining blockers: none found for F3 functional release behavior after inspected remediation.

Required risk decisions before production exposure:

- AUD-003 dependency vulnerability risk must be accepted or remediated.

Recommended non-blocking remediations:

- AUD-004 documentation synchronization.
- AUD-005 callback uniform response/abuse hardening.
- AUD-006 future worker maintainability improvement.

# Final Verdict

Overall Score: 8.6/10. Acceptable.

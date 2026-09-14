# Architectural Action Plan

> **Synchronized:** Final F3 Hacienda asynchronous submission documentation refresh by `hdd-architecture-agent-4f9f0f` on 2026-09-14 for confirmed `specs/fase-3-hacienda-async-submission`. Documentation-only refresh; no production code, tests, Prisma schema or migrations changed by this agent.

## 1. Objective

Record the completed F3 architecture reality and keep the repository-level forward plan limited to remaining production readiness and hardening items. F3 is functionally complete for asynchronous Hacienda submission from `READY_TO_SUBMIT` FE/TE to authoritative `ACCEPTED`/`REJECTED` with durable response artifact. F4 PDF/email/delivery is not implemented.

## 2. Scope

In scope for this refresh:

- Mark F3 implementation as complete functionally and audit accepted.
- Record final validation evidence supplied by the user.
- Document remaining production/dependency/hardening risks.
- Keep new repository-level tasks in **Proposed** status only.

## 3. Out of scope

- Production code changes.
- Prisma schema/migration changes.
- Dependency remediation implementation.
- Live Hacienda sandbox/production execution.
- F4 PDF/email/delivery implementation.
- Microservice extraction.

## 4. Requirements addressed

F3 requirements now addressed in implementation:

| Requirement area | Current state |
|---|---|
| Submit request use case | Implemented for READY_TO_SUBMIT FE/TE via invoice/ticket submit routes. |
| Preconditions | Tenant/company/environment/type/status/signed XML hash/connection checks implemented and tested. |
| Async execution | API creates/reuses `FiscalSubmission` and queues work instead of completing provider lifecycle synchronously. |
| No duplicate issuance | Fiscal document, consecutive, Clave and signed XML remain stable across retries/reconcile/callbacks. |
| Provider boundary | `HaciendaSubmissionPort` implemented with mock and real recepcion adapters. |
| OAuth reuse/secrecy | Existing connection/auth/token-cache/SecretProvider reused; tokens/secrets not persisted. |
| Submission persistence | `FiscalSubmission` table/migration implemented and validated. |
| State machine/retry classifier | Implemented in domain submission package and tested. |
| Ambiguous POST handling | Unknown outcome moves to reconciliation by Clave. |
| Polling/reconciliation | Worker and manual reconcile path implemented. |
| Callback | Public signal-only callback endpoint implemented. |
| Response artifacts | Exact Hacienda response bytes/hash/content metadata persisted through storage. |
| Audit/observability | Lifecycle audit/observability tests passed. |
| Security/concurrency/E2E | Focused security, PostgreSQL concurrency and F3 E2E evidence passed. |

## 5. Current problems addressed

Closed by F3:

- No Hacienda submission lifecycle after `READY_TO_SUBMIT`.
- No durable submission intent/state table.
- No provider boundary for CE recepcion submit/status.
- No retry classifier or ambiguous POST reconciliation path.
- No response artifact persistence for Hacienda `respuesta-xml`.
- No callback endpoint.
- Queue handler registration gap for workers.

Remaining:

- OQ-012 production IAM/SecretProvider readiness.
- 26 npm audit vulnerabilities.
- Throttling/quota policy for expensive fiscal endpoints.
- UUID/path-param validation standardization.
- Prepare XML concurrency hardening.
- Possible repository-port extraction for F3/F2.2 maintainability.
- F4 not implemented.

## 6. Domains affected

| Domain | Current/future impact |
|---|---|
| Fiscal Documents | Now owns document-level terminal Hacienda outcomes and `FiscalSubmission` lifecycle. |
| Fiscal XML/Signing | Provides immutable signed XML artifact consumed by F3; no regeneration in F3. |
| Hacienda Connection | Reused for environment-specific credentials and token acquisition. |
| Queue/Workers | Now registers submit/reconcile handlers through `JobQueuePort`. |
| Storage | Stores signed XML and exact Hacienda response artifacts. |
| Audit/Security | Records fiscal lifecycle; protects secrets/tokens/XML bodies. |
| Deployment | Production secret/IAM validation remains required before live Hacienda use. |

## 7. Behavior to preserve

- Existing F2.2/F2.3 FE/TE creation and XML preparation behavior.
- Lazy F3 submission creation for existing `READY_TO_SUBMIT` rows; no fabricated history.
- Stable fiscal identity and signed XML across submit/retry/reconcile/callback paths.
- Technical failures remain non-terminal.
- Hacienda `aceptado`/`rechazado` are authoritative terminal outcomes.
- Callback remains signal-only.
- Tokens/passwords/secrets are not stored in DB/jobs/audit/logs/API responses.
- Deterministic mock Hacienda remains the default for CI.

## 8. Defects to correct

No F3 functional blocker remains after final audit. Proposed future corrections:

| Finding | Priority | Correction direction |
|---|---|---|
| OQ-012 production IAM/SecretProvider readiness | High | Verify and document pre-production secret/IAM runbook and live credential access. |
| npm audit vulnerabilities | High | Triage/remediate or formally accept risk in supply-chain workstream. |
| Expensive fiscal endpoints skip throttling | Medium | Define quota/rate policy for prepare/submit/reconcile. |
| Missing UUID/path param standardization | Medium | Add global or route-level validation policy. |
| Prepare XML concurrency hardening | Medium | Add locking/compare-and-set characterization and fix if needed. |
| Direct Prisma usage in fiscal services | Medium | Extract repository ports incrementally if future complexity warrants. |

## 9. Future architectural changes

Recommended sequence:

1. Production readiness documentation for OQ-012.
2. Dependency vulnerability triage/remediation.
3. Fiscal endpoint throttling/quota policy.
4. UUID/path-param validation standardization.
5. Prepare XML concurrency characterization/hardening.
6. Optional repository-port extraction around fiscal submission/document persistence.
7. F4 PDF/email/delivery specification.

## 10. Database changes

Implemented:

- Forward migration `20260914193000_fiscal_submission`.
- `FiscalDocumentStatus` now includes `ACCEPTED` and `REJECTED`.
- `FiscalSubmissionStatus` and `FiscalSubmission` model/table with unique document/Clave constraints and due-work indexes.

Future proposed only if approved:

- Optional tenant/company compound constraints for fiscal relations.
- Optional prepare XML locking metadata if chosen.
- No old applied migration should be edited.

## 11. API and integration changes

Implemented:

- Invoice/ticket submit endpoints.
- Invoice/ticket submission status endpoints.
- Invoice/ticket manual reconcile endpoints.
- Public Hacienda callback endpoint.
- Real and mock Hacienda submission adapters.

Future proposed only if approved:

- Dedicated submission scopes if policy changes.
- 429/throttling contracts for expensive endpoints.
- F4 PDF/email/delivery APIs.

## 12. Container and deployment changes

Implemented/evidenced:

- Docker build passed in final F3 validation.
- Current compose remains local/development oriented.

Future:

- OQ-012 pre-production IAM/SecretProvider verification.
- Production configuration/runbook for real Hacienda credentials and callback URL exposure.
- Do not reuse local default-secret compose assumptions for production.

## 13. Security changes

Implemented:

- Tenant/company/environment isolation for F3.
- Signal-only callback handling.
- Identifier-only queue payloads.
- Token/password/secret non-persistence and redaction tests.
- Response artifacts stored privately by reference/hash metadata.

Future:

- Dependency vulnerability remediation.
- Production secret/IAM verification.
- Throttling/quota enforcement.
- UUID validation.
- Consider dedicated submission scopes.

## 14. Test strategy

Final validation evidence supplied by user:

- `npm ci` passed.
- Prisma generate/validate/migrate deploy passed on clean PostgreSQL 15.
- lint, lint:check, typecheck, unit, build, E2E and Docker build passed.
- Unit: 49 suites / 349 tests.
- E2E: 15 suites / 85 tests.
- Focused F3: 13 suites / 122 tests.
- Focused F3 E2E: 14 tests.
- `npm audit`: 26 known vulnerabilities unrelated to new F3 dependencies.

This architecture refresh did not execute commands.

## 15. Migration stages

| Stage | Status | Notes |
|---|---|---|
| F2.2/F2.3 readiness baseline | Complete | FE/TE can reach `READY_TO_SUBMIT`. |
| F3 persistence/domain/port/adapters | Complete | State machine, classifier, `FiscalSubmission`, port and adapters implemented. |
| F3 APIs/workers/callback/artifacts | Complete | Submit/status/reconcile/callback, workers and response artifacts implemented. |
| F3 tests/final audit | Complete | Final audit Acceptable 8.6/10; gates passed per supplied evidence. |
| Production readiness | Proposed | OQ-012, dependency/security and operations hardening. |
| F4 PDF/email/delivery | Not started | Requires separate approved specification. |

## 16. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Production SecretProvider/IAM not ready | High | Complete OQ-012 runbook and pre-production validation before live submissions. |
| Dependency vulnerabilities | High | Separate supply-chain remediation/exception process. |
| Callback spoofing | Medium | Preserve current signal-only behavior and authenticated reconciliation. |
| Hacienda outage/throttling | Medium | Preserve retry classifier, backoff, rate-header handling and manual-review states. |
| Duplicate fiscal issuance | High | Preserve unique constraints, immutable artifacts and no-regeneration rule. |
| Endpoint abuse/cost | Medium | Add approved throttle/quota policy. |
| F4 assumptions | Medium | Specify F4 before consuming artifacts for PDF/email/delivery. |

## 17. Rollback or recovery strategy

- Documentation changes can be reverted if inaccurate.
- F3 migration is forward-only; do not edit historical migrations.
- Operationally, non-terminal submissions can be reconciled by Clave; ambiguous outcomes must not trigger document/XML regeneration.
- If live Hacienda integration is disabled, use mock adapter/deterministic mode for CI and non-live environments.

## 18. Manual validation

For pre-production/live readiness after OQ-012 approval:

1. Verify SecretProvider/IAM access for Hacienda credentials without exposing values.
2. Verify environment-specific Hacienda connection and callback URL configuration.
3. Submit a sandbox FE/TE using approved credentials.
4. Confirm no duplicate document/consecutive/Clave/XML is created.
5. Confirm response artifact key/SHA-256 metadata and audit events.
6. Confirm callback/reconciliation behavior under duplicate/stale callback scenarios.
7. Confirm logs/jobs contain no tokens/passwords/XML bodies.

## 19. Approval status

- F3 implementation is complete functionally and documented as current state.
- Final audit is **Acceptable 8.6/10**.
- Remaining tasks in `docs/tasks.md` are **Proposed** and require explicit approval before implementation.
- F4 PDF/email/delivery is not introduced.

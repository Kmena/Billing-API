# Architectural Action Plan

> **Synchronized:** Documentation-only ownership reconciliation for canonical `specs/post-f2-2-remediation` by `sdd-implementation-agent-c13b28` on 2026-09-12. No production code, tests or Prisma migrations modified.
> Latest Post-F2.2 remediation audit score is **9.0/10** for canonical `specs/post-f2-2-remediation`, with no blocking F2.2-specific gaps. Current validation evidence: `npm ci`, Prisma generate/validate, clean `billing_e2e` reset plus migration deploy, lint/lint:check, typecheck, unit suite, build, fiscal E2E and full E2E all pass. Remaining work below is future proposed work unless explicitly marked completed in `docs/tasks.md`.

---

## 1. Objective

Reflect the real Fase 1 Hacienda consultas audit findings and define an incremental path to verify/correct layered rate limiting and close endpoint evidence gaps, while preserving the completed Post-F2.2 fiscal-document continuation results.

Main objectives:

1. Verify or correct auth endpoint rate limiting for `POST /auth/login` and `POST /auth/refresh`.
2. Verify API-key per-key throttling behavior and named-throttler threshold semantics for Fase 1 endpoints.
3. Add missing Fase 1 positive E2E evidence for taxpayer, CABYS, exchange-rate, CORS preflight and company verification statuses.
4. Preserve the implemented local fiscal document core ending at `READY_FOR_XML`.
5. Preserve the completed Post-F2.2 fiscal E2E/concurrency coverage and clean full-E2E reset workflow.
6. Preserve response sanitization that removes `securityCode`/`requestHash`, bigint string serialization and conflict-safe pre-sequence idempotency reservation; later formalize fiscal responses as explicit DTO contracts.
7. Align the fiscal module incrementally with repository hexagonal conventions without rewriting the application.
8. Address existing repository-level Docker and npm audit concerns under separate approval.

---

## 2. Scope

In scope for future work in this plan:

- Auth throttling verification/correction for login/refresh endpoints.
- API-key per-key throttling threshold tests for Fase 1 Hacienda query endpoints.
- Fase 1 positive E2E/API coverage for taxpayer, CABYS and exchange-rate endpoints.
- CORS preflight E2E coverage for configured browser-facing access.
- Company creation Hacienda verification status coverage.
- Completed fiscal E2E/API tests for invoice/ticket creation, retrieval, idempotency, authorization, JWT-only management endpoints and PostgreSQL concurrency behavior.
- Explicit fiscal response DTO/mappers to formalize the current sanitized response contract as a future improvement.
- Incremental fiscal service decomposition and ports/adapters extraction.
- Forward-only database hardening where still needed.
- Existing container/security dependency remediation tasks.
- Documentation verification after each implementation cycle.

---

## 3. Out of scope

- XML generation.
- XSD validation.
- XAdES signing implementation.
- Hacienda submission/polling/callbacks.
- Fiscal submission job queue handlers.
- PDF generation, emails and webhooks.
- Microservice decomposition.
- Rewriting all modules to a new architecture.
- Modifying already-applied migrations.

---

## 4. Requirements addressed

Fase 1 implemented requirements and current audit status:

| Requirement area | Current status |
|---|---|
| Real Hacienda query adapter | Implemented with real/mock adapter selection and normalized ports. |
| Taxpayer endpoint | Implemented under `/api/v1/taxpayers/:identification` with API key + `taxpayers:read`. Positive E2E response evidence still incomplete. |
| CABYS endpoints | Implemented under `/api/v1/cabys` and `/api/v1/cabys/:code` with API key + `cabys:read`. Positive E2E response evidence still incomplete. |
| Exchange-rate endpoint | Implemented under `/api/v1/exchange-rates` with API key + `exchange-rates:read`. Positive E2E response evidence still incomplete. |
| ScopeGuard fail-closed behavior | Implemented and partially covered by tests for missing/invalid key scenarios. |
| CORS configuration | Implemented in `api.main.ts`; preflight E2E evidence missing. |
| Company Hacienda verification fields | Implemented with typed statuses; all status outcomes lack complete E2E/API evidence. |
| Auth brute-force protection | `@Throttle` decorators are present, but enforcement is unproven because no visible global throttler guard registration was found. |
| Per-API-key inbound rate limiting | `ApiKeyThrottlerGuard` is applied to Fase 1 controllers, but exact named-throttler/threshold behavior lacks focused tests. |

F2.2 implemented requirements, based on code and implementation report:

| Requirement area | Current status |
|---|---|
| Fiscal document persistence ending at `READY_FOR_XML` | Implemented with `FiscalDocument` Prisma model. |
| Invoice/ticket creation endpoints | Implemented: top-level `/invoices`, `/tickets` and company-scoped variants. |
| Fiscal issuance point configuration | Implemented for default branch `001` / terminal `00001` through JWT endpoint. |
| Sequence configuration/allocation | Implemented through JWT configuration endpoint and PostgreSQL atomic allocation. |
| Consecutive and clave generation | Implemented in fiscal domain helper. |
| Deterministic decimal helper | Implemented with bigint-backed `ScaledDecimal` at fixed 5 decimals. |
| API-key scopes | `tickets:read` and `tickets:write` added; invoice/ticket scopes enforced. |
| HaciendaConnection prerequisite | Implemented as existence and not-disabled check; no OIDC call. |
| Idempotency required | Implemented with fiscal idempotency table and request hash. |
| Audit events | Implemented for fiscal create/read/configuration operations. |
| No XML/signing/submission | Preserved. |

Partially addressed or requires follow-up:

| Requirement area | Gap |
|---|---|
| Dedicated fiscal E2E/integration/concurrency tests | Implemented for Post-F2.2 continuation: workflow, management, negative paths, tenant/type isolation, response sanitization, sequence uniqueness and idempotency races. |
| Stable normalized API response | Fiscal document responses remove `securityCode` and `requestHash`, top-level bigint fields serialize as strings, and E2E coverage asserts sanitization. The contract is still an ad-hoc sanitized object rather than explicit DTOs. |
| Idempotency scope | Corrected: implemented tenant+company+apiKeyId+operation+key through forward migration `20260911143000_fiscal_idempotency_scope`. |
| `fiscal_document_lines` table | Not implemented; line snapshots are JSON. |
| Default issuance point uniqueness | No partial unique DB index for one default per company/environment. |
| Full v4.4 catalog validation | MVP-level validation only. |

---

## 5. Current problems addressed

F2.2 addressed the previous absence of local fiscal document core by adding:

- `FiscalDocumentsModule` and fiscal endpoints.
- Fiscal Prisma models/migration.
- Issuance-point persistence.
- Sequence persistence/allocation.
- DB-backed idempotency.
- Invoice/ticket scopes.
- Clave/consecutive helper and fixed-scale decimal helper.
- Audit events.

This plan addresses problems identified by the Fase 1 phase-specific audit:

- Potentially unenforced auth rate limiting on login/refresh due missing visible global throttler guard registration.
- Ambiguous `ApiKeyThrottlerGuard` named-throttler behavior without threshold evidence.
- Missing positive Fase 1 E2E/API evidence for taxpayer, CABYS and exchange-rate responses.
- Missing CORS preflight E2E evidence.
- Missing company Hacienda verification status outcome coverage.
- Historical full-E2E blocker from a dirty local DB duplicate tenant slug is closed for the Post-F2.2 continuation cycle after clean reset and full E2E pass.

This plan also acknowledges the Post-F2.2 continuation results:

- Fiscal E2E/API and PostgreSQL concurrency tests are now implemented for TASK-F2.2-003 through TASK-F2.2-007.
- Fiscal response exposure of `securityCode`/`requestHash` is corrected and covered; remaining API debt is lack of explicit response DTO classes/contracts.
- Fiscal idempotency reservation now occurs before sequence allocation using conflict-safe PostgreSQL insert semantics.
- Fiscal module architecture divergence from repository hexagonal conventions remains future maintainability debt.
- Stale documentation is resolved by this refresh.
- Existing Docker Compose/default-secret and npm audit concerns remain repository-level risks.

---

## 6. Domains affected

| Domain | Impact |
|---|---|
| Identity/Auth | Primary Fase 1 security impact: auth endpoint throttling must be verified/corrected. |
| Hacienda Public Queries | Primary Fase 1 API impact: endpoint positive responses and API-key throttling require evidence. |
| Companies | Company creation Hacienda verification statuses require characterization tests. |
| API Keys | Scope behavior and company authorization must be preserved and tested; API-key throttling must remain per key. |
| Fiscal Documents | Post-F2.2 continuation completed E2E/concurrency hardening and idempotency reservation ordering. Future work focuses on explicit response contracts, ports/adapters and remaining persistence constraints. |
| Hacienda Connection | Fiscal creation depends on connection existence and not-disabled status. |
| Audit | Fiscal actions must remain categorical and free of secrets/full payloads. |
| Infrastructure/Database | Forward migrations may add constraints/tables and ports/adapters. |
| Containers/Supply Chain | Existing Docker/npm concerns remain separate proposed work. |

---

## 7. Behavior to preserve

- Existing non-fiscal APIs and tests must remain compatible.
- Fiscal creation must remain local and end at `READY_FOR_XML`.
- No XML/signing/submission side effects in F2.2 flows.
- Type-specific scopes are required; generic `documents:*` does not authorize invoice/ticket operations.
- API-key company authorization is required for fiscal creation/read.
- JWT-only TENANT_ADMIN management configuration remains separated from API-key endpoints.
- Sequence allocation remains PostgreSQL atomic and does not use `SELECT MAX + 1`.
- Existing migration `20260911140000_fiscal_document_core` must not be edited if applied; use new migrations for changes.

---

## 8. Defects to correct

| Defect ID | Priority | Correction direction |
|---|---|---|
| DEF-F1-RATE-001 | High | Verify/correct auth throttler guard application so login/refresh rate limiting is actually enforced. |
| DEF-F1-RATE-002 | Medium | Add threshold tests for per-API-key throttling and clarify named-throttler semantics. |
| DEF-F1-E2E-001 | Medium | Add positive Fase 1 E2E/API tests for taxpayer, CABYS and exchange-rate endpoint responses. |
| DEF-F1-E2E-002 | Medium | Add CORS preflight and company Hacienda verification status outcome tests. |
| DEF-F2.2-E2E-001 | Closed | Dedicated fiscal E2E/API tests and clean DB validation path are complete for the Post-F2.2 continuation scope. |
| DEF-F2.2-RESP-001 / SEC-F2.2-001 | Closed | Fiscal document responses now remove `securityCode` and `requestHash`, top-level bigint fields serialize safely, and E2E coverage asserts sanitization; keep a lower-risk DTO formalization task. |
| DEF-F2.2-IDEM-001 | Closed | Idempotency scope now includes `apiKeyId` and `operation` in schema/migration/service. |
| DEF-F2.2-LINES-001 | Low/Medium | Decide whether JSON line snapshots are sufficient or migrate to relational fiscal document lines. |
| DEF-E2E-DB-001 | Closed | Clean `billing_e2e` reset, migration deploy and full E2E suite were reported passing in this continuation cycle. |

---

## 9. Future architectural changes

Incremental target for Fase 1 hardening:

1. Add focused characterization tests for current auth throttling and API-key throttling behavior.
2. If tests confirm auth throttling is inactive, apply the smallest approved NestJS guard registration/fix and preserve existing public auth contracts.
3. Make API-key throttling named-bucket behavior explicit only if tests show inherited behavior does not enforce the configured `api` throttler as intended.
4. Add positive E2E response tests for Hacienda query endpoints using mock adapter/no external Hacienda calls.
5. Add E2E tests for CORS preflight and company verification status mapping.
6. Standardize the clean E2E DB reset/collision-resistant fixture workflow now proven by the Post-F2.2 continuation cycle so full E2E remains reliable.

Incremental target for the fiscal module:

1. Keep the current module and public paths stable.
2. Preserve completed characterization/E2E tests around current fiscal behavior.
3. Formalize current fiscal response sanitization with explicit DTO mappers.
4. Extract application use cases from `FiscalDocumentService` without changing behavior.
5. Extract output ports and Prisma adapters for fiscal documents, issuance points, sequences and idempotency.
6. Add application-level policy services for fiscal authorization and management authorization.
7. Consider relational fiscal line table only after product/data/reporting decision.

No microservice split is recommended.

---

## 10. Database changes

Potential future forward-only migrations:

- Fiscal idempotency actor/API-key/operation scope has been corrected by `20260911143000_fiscal_idempotency_scope`; future migrations should preserve that scope.
- Add partial unique index for one default issuance point per tenant/company/environment where `is_default = true` and `active = true` if this invariant must be database-enforced.
- Add `fiscal_document_lines` table only if approved after evaluating JSON snapshot adequacy.
- Preserve the implemented Post-F2.2 scoped fiscal consecutive uniqueness `(tenant_id, company_id, environment, consecutive)`; do not revert to global consecutive uniqueness.

Do not edit existing applied migrations.

---

## 11. API and integration changes

Proposed API hardening:

- Preserve existing Fase 1 public Hacienda response contracts while adding missing positive E2E assertions.
- Verify `POST /auth/login` and `POST /auth/refresh` return 429 after configured auth threshold once throttling is active.
- Verify Fase 1 API-key endpoints return 429 after configured per-key threshold and independent keys do not share the same bucket.
- Add CORS preflight assertions for configured origins, methods and allowed headers.
- Define response DTOs for fiscal document, issuance point and sequence responses.
- Preserve current removal of `securityCode` and `requestHash` from fiscal document responses while exposing `clave` and `consecutive`.
- Standardize deterministic error codes/messages for fiscal validation/authorization/idempotency.
- Add explicit response DTOs and OpenAPI examples for invoice/ticket creation and retrieval.
- Preserve backward compatibility where possible when formalizing DTOs.

No new external integration is planned in this action plan.

---

## 12. Container and deployment changes

Proposed repository-level work remains:

- Harden `docker-compose.yml` so production-mode services cannot run with public/default secrets, or document Compose as local-only.
- Continue requiring explicit production CORS values.
- Triage npm audit findings and apply dependency updates safely.

---

## 13. Security changes

Proposed security work:

- Fix or prove auth throttling enforcement for login/refresh.
- Add per-API-key throttling threshold tests and cross-key isolation tests.
- Add CORS preflight tests for allowed and disallowed origins where config supports it.
- Add company verification status tests for `VERIFIED`, `NOT_FOUND`, `UNAVAILABLE`, `ERROR` and reserved `SKIPPED` behavior where reachable.
- Add regression tests proving fiscal responses do not include `securityCode` or `requestHash`.
- Add fiscal E2E negative tests for insufficient scope, generic-only scope, revoked key, unauthorized company and API-key attempts to access management endpoints.
- Add tests for JWT non-admin management denial and cross-tenant/company denial.
- Review audit metadata for PII/security-code exposure.
- Resolve Docker/default-secret and npm audit risks.

---

## 14. Test strategy

Recommended next tests, in order:

1. Add auth throttling E2E proving login/refresh return 429 after the configured `auth` threshold.
2. Add API-key throttling E2E proving per-key threshold and independent-key bucket behavior on Fase 1 endpoints.
3. Add Fase 1 positive E2E happy paths: taxpayer lookup, CABYS direct lookup/search and exchange-rate lookup with mock adapter.
4. Add CORS preflight E2E coverage and company verification status characterization tests.
5. Preserve the completed fiscal E2E suites for invoice/ticket workflows, management authorization, response sanitization and PostgreSQL concurrency/idempotency races.
6. When formalizing fiscal DTOs, add/maintain API tests confirming `securityCode` and `requestHash` remain absent and bigint fields remain JSON-safe strings.
7. Preserve existing unit/lint/type/build/migration/full-E2E gates.

---

## 15. Migration stages

| Stage | Goal | Risk |
|---|---|---|
| Stage 0 | Documentation refresh after Fase 1 phase-specific audit. | Completed. |
| Stage 1 | Post-F2.2 fiscal E2E/concurrency continuation and clean full-E2E reset. | Completed by TASK-F2.2-003 through TASK-F2.2-007. |
| Stage 2 | Add Fase 1 throttling characterization tests. | Medium due possible security defect confirmation. |
| Stage 3 | Correct auth throttler guard application if characterization proves enforcement is inactive. | Medium; security-critical but public contract should remain unchanged. |
| Stage 4 | Add Fase 1 positive endpoint, CORS preflight and company verification status tests. | Low/Medium. |
| Stage 5 | Formalize sanitized API response DTO contracts. | Low/Medium due possible public-contract expectations. |
| Stage 6 | Fiscal service decomposition into use cases/policies while preserving behavior. | Medium. |
| Stage 7 | Extract fiscal output ports and Prisma adapters. | Medium. |
| Stage 8 | Forward-only DB hardening for default uniqueness/lines if approved. | Medium/High depending on migration. |
| Stage 9 | Re-run full verification and refresh docs. | Low. |

---

## 16. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Auth brute-force protection is assumed but inactive | High | Add threshold E2E and register/apply throttler guard if needed. |
| API-key throttling uses unintended throttler bucket | Medium | Add configured-threshold and cross-key tests; make named bucket explicit if needed. |
| CORS preflight differs from documented contract | Medium | Add E2E preflight tests for allowed headers/methods/origins. |
| Company verification status mapping regresses | Medium | Add mock-adapter-driven status outcome tests. |
| Regression re-exposes `securityCode` or `requestHash` | Medium | Preserve existing fiscal E2E sanitization assertions; formalize DTOs. |
| Fiscal behavior regressions during refactor | Medium | Keep completed characterization/E2E tests green before and after refactoring. |
| Applied migration drift | High | Never edit applied migration; create forward-only migrations. |
| Idempotency race behavior regresses | Medium | Preserve completed PostgreSQL concurrency E2E coverage and conflict-safe pre-sequence reservation semantics. |
| Dirty local DB blocks E2E validation | Closed | Clean `billing_e2e` reset and full E2E pass are now documented; keep isolated/collision-resistant fixtures. |
| Docker Compose reused as production | High | Harden secrets/defaults or document local-only policy. |
| npm audit vulnerabilities | High | Triage and upgrade with full regression suite. |

---

## 17. Rollback or recovery strategy

- Documentation changes can be reverted if inaccurate.
- Future API DTO changes should be released with compatibility notes and tests.
- Future database changes must be forward-only; rollback should use compensating migrations where necessary.
- For fiscal refactors, preserve public endpoints and add tests before moving logic.
- If fiscal E2E uncovers defects, isolate fixes by endpoint/use case and avoid changing unrelated modules.

---

## 18. Manual validation

Suggested manual validation after Fase 1 hardening:

1. Attempt more than the configured auth threshold against `/api/v1/auth/login` and confirm 429 responses once threshold is exceeded.
2. Attempt more than the configured API-key threshold against a Fase 1 endpoint and confirm 429 for the same key while a different key has an independent bucket.
3. Send CORS preflight requests with configured origins/headers and confirm expected allow/deny behavior.
4. Create companies using mock Hacienda outcomes and confirm verification statuses and persisted fields.
5. Call taxpayer, CABYS direct/search and exchange-rate endpoints with valid API key scopes and confirm normalized positive responses.

Suggested manual validation after fiscal API hardening/E2E setup:

1. Create tenant/company/API key with invoice/ticket scopes and company authorization.
2. Configure HaciendaConnection for SANDBOX.
3. Upsert default fiscal issuance point with JWT TENANT_ADMIN.
4. Configure invoice/ticket sequence start values.
5. POST invoice with `Idempotency-Key` and confirm `READY_FOR_XML`, consecutive and clave.
6. Replay same request/key and confirm same document.
7. Change request with same key and confirm 409.
8. POST ticket without receiver and confirm accepted when otherwise valid.
9. GET document with correct/incorrect read scopes and confirm expected authorization.
10. Confirm no XML/signing/submission side effects or jobs.

---

## 19. Approval status

- Fase 1 implementation exists, but original Fase 1 rate-limiting/evidence-gap tasks remain proposed outside the completed Post-F2.2 fiscal continuation scope.
- F2.2 implementation and Post-F2.2 continuation tasks TASK-F2.2-003 through TASK-F2.2-007 are complete according to implementation report, validation evidence and 9.0/10 audit summary.
- This document records remaining **Proposed** future tasks only; no production-code changes are approved by this documentation refresh.
- Recommended next approval: Fase 1 auth/API-key throttling verification and correction, followed by positive E2E/CORS/company-verification evidence.

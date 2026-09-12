# Changelog — Billing API

## [post-f2-2-remediation-final-architecture-refresh] — 2026-09-12

**Agent:** hdd-architecture-agent-7fd8b9
**Canonical spec:** `specs/post-f2-2-remediation`
**Scope:** Final architecture-facing documentation refresh after confirmed Post-F2.2 remediation completion and canonical ownership reconciliation. No production code, tests or Prisma migrations changed.

### Documentation
- Confirmed root architecture/current-state/action-plan/tasks/audit docs already reflect completed Foundation, Fase 1, F2.1, F2.2 at `READY_FOR_XML`, completed canonical Post-F2.2 remediation and F2.3 not started.
- Updated `docs/future-architecture.md` header to reference the canonical Post-F2.2 spec and final refresh instead of the older F2.2 hardening refresh label.
- Corrected one historical Fase 1 implementation-report deviation note so it cannot be read as assigning canonical Post-F2.2 ownership to `specs/fase-1-hacienda-consultas/`.

### Validation
- No validation commands were executed by this documentation-only architecture refresh. It relies on supplied evidence: `npm ci`, Prisma generate/validate, clean `billing_e2e` reset plus migrate deploy, lint/lint:check, typecheck, 181 unit tests / 28 suites, build, 57 E2E tests / 11 suites, fiscal E2E 15 tests / 3 suites and PostgreSQL concurrency all passed. Existing npm audit vulnerabilities remain.

---

## [post-f2-2-remediation-documentation-reconciliation] — 2026-09-12

**Agent:** sdd-implementation-agent-c13b28
**Canonical spec:** `specs/post-f2-2-remediation`
**Historical misclassified spec:** `specs/fase-1-hacienda-consultas`
**Scope:** Documentation-only ownership reconciliation for completed Post-F2.2 fiscal-document remediation. No production code, tests or Prisma migrations changed.

### Documentation
- Updated root architecture-facing docs to reflect canonical Post-F2.2 ownership, completed fiscal E2E workflow coverage, management endpoint coverage, negative paths, tenant/type isolation, response sanitization and PostgreSQL concurrency/idempotency coverage.
- Documented that `FiscalDocumentService` now reserves idempotency records before fiscal sequence allocation using PostgreSQL `INSERT ... ON CONFLICT DO NOTHING RETURNING` to avoid sequence consumption and transaction-abort behavior during concurrent idempotency races.
- Documented that fiscal responses serialize top-level bigint fields as strings and remove `securityCode` and `requestHash`.
- Marked prior fiscal E2E/full-E2E blocker risks as closed for this continuation scope while retaining future maintainability debt around the large fiscal service and explicit response DTOs.
- Recorded baseline-audit-agent score **9.0/10** for canonical `specs/post-f2-2-remediation`: no meaningful regression introduced and no blocking F2.2-specific gaps.

### Validation
- No validation commands were executed by this documentation-only reconciliation. It preserves supplied evidence: `npm ci`, Prisma generate/validate, clean `billing_e2e` reset plus migrate deploy, lint, lint:check, typecheck, 181 unit tests / 28 suites, build, 57 E2E tests / 11 suites and fiscal E2E 15 tests / 3 suites all passed. `npm audit` still reports 26 pre-existing vulnerabilities.

---

## [fase-1-closure-architecture-refresh] — 2026-09-11

**Agent:** hdd-architecture-agent-ef03fb
**Spec:** `specs/fase-1-hacienda-consultas`
**Scope:** Documentation-only closure refresh after Fase 1 baseline audit. No production code changed.

### Documentation
- Updated architecture-facing docs to record Fase 1 closure: audit score **8.6/10**, Fase 1 completion confidence **9.1/10**, verdict **Acceptable**, and no Critical/High Fase 1 regressions.
- Clarified that remaining High risks are repository-level follow-up work: Docker Compose production-mode fallback/default secrets if reused as production and existing npm audit vulnerabilities.
- Refreshed Fase 1 spec documents to align current-state and traceability with post-audit fixes: CABYS null-cache handling and USD-only exchange-rate contract.
- Corrected Fase 1 current-state notes where later hardening superseded original behavior, including production CORS fatal validation and latest full validation evidence.

### Validation
- No validation commands were executed by this architecture refresh. It records supplied evidence: `npm ci`, Prisma generate, lint, typecheck, 177 unit tests / 26 suites, build, and 42 E2E tests / 8 suites all passed; `npm ci` still reports 26 existing audit vulnerabilities.

---

## [pre-f2-2-security-fix-final-architecture-refresh] — 2026-09-11

**Agent:** hdd-architecture-agent-9bdbe6
**Spec:** `specs/pre-f2-2-security-fix`
**Scope:** Documentation-only architecture refresh after final verification by `sdd-implementation-agent-c13b28`. No production code changed.

### Documentation
- Refreshed architecture-facing docs to reference the latest implemented state: tenant ownership for `GET /api/v1/tenants/:id`, Helmet in API bootstrap, computed login/refresh `expiresIn`, and Joi auth-duration grammar validation.
- Updated audit score references from 8.4/10 to **8.6/10 Acceptable** where current docs summarize the post-continuation baseline.
- Added the remaining existing npm audit vulnerabilities as an explicit High dependency-security risk and proposed TASK-023 for triage/remediation.
- Documented the final auth-duration behavior: invalid primary and invalid custom fallback durations produce the safe 900-second access-token default.

### Validation
- No validation commands were executed by this architecture refresh. It records implementation-continuation evidence: `npm ci`, Prisma generate, lint, typecheck, 177 unit tests / 26 suites, build, and 42 E2E tests / 8 suites all passed; `npm ci` still reports 26 existing audit vulnerabilities.

---

## [fase-1-baseline-audit-architecture-refresh] — 2026-09-11

**Agent:** hdd-architecture-agent-762038
**Spec:** `specs/fase-1-hacienda-consultas`
**Scope:** Documentation-only architecture refresh after latest baseline audit. No production code changed.

### Documentation
- Refreshed architecture-facing docs to reference the latest `docs/audit/current-code-audit.md` baseline: score **8.4/10**, verdict **Acceptable**, no Critical findings, one High finding (AUD-001).
- Documented AUD-001 Docker Compose production-mode fallback/default secret risk in current state, active architecture limitations, action plan and tasks.
- Added proposed remediation tasks for audit findings AUD-001 through AUD-005, including Compose hardening, DB referential integrity evaluation, framework exception decoupling, coding-standards path drift and identification normalization clarification.

### Validation
- No tests were executed during this documentation refresh. Current green status remains based on the prior implementation-agent validation reported in `docs/current-state.md`.

---

## [pre-f2-2-security-fix] — 2026-09-11

**Agent:** sdd-implementation-agent-4f02c8
**Spec:** `specs/pre-f2-2-security-fix`

### Added
- `helmet@8.3.0` runtime dependency and HTTP security-header E2E coverage.
- Unit tests for auth TTL parsing and non-default `expiresIn` behavior.
- E2E coverage for same-tenant/cross-tenant `GET /api/v1/tenants/:id`.

### Changed
- `GET /api/v1/tenants/:id` now enforces same-tenant ownership in `GetTenantHandler`; cross-tenant reads return 404 `TENANT_NOT_FOUND`.
- `api.main.ts` applies Helmet after CORS; production keeps CSP defaults, non-production disables only CSP for Swagger compatibility.
- Login and refresh responses compute `expiresIn` from configured `JWT_EXPIRES_IN` instead of hardcoded `15 * 60`.
- `JWT_EXPIRES_IN` and `JWT_REFRESH_EXPIRES_IN` Joi validation now uses the same `^\\d+[smhd]$` grammar supported by the auth-duration parser.
- Architecture/current-state/action-plan/tasks documentation refreshed to mark AUD-API01, AUD-SEC01 and DEFECT-001 as closed.

### Validation
- `npm ci`, `npx prisma generate`, `npm run lint:check`, `npm run typecheck`, `npm test -- --silent` (26 suites / 177 tests), `npm run build` all passed in the latest continuation verification.
- Post-audit REG-AUD-001 mitigation tests passed: `config.validation.spec.ts auth-token-duration.spec.ts login.handler.spec.ts refresh-token.handler.spec.ts` (4 suites / 35 tests in latest continuation verification).
- Test DB reset + full E2E passed: 8 suites / 42 tests.

## [phase-9-audit-architecture-refresh] — 2026-11-09

**Agent:** sdd-implementation-agent-c13b28
**Spec:** `specs/fase-1-hacienda-consultas` (post-pre-fase-2-hardening cumulative baseline)

### Documentation
- Post-implementation baseline audit ejecutado via `baseline-audit-agent`; score inicial 8.2/10 **corregido a 8.8/10** (CI/CD y Documentation tenían scores erróneos por bug de tool; ver `docs/audit/current-code-audit.md`).
- `docs/audit/current-code-audit.md` created with 7 open findings (AUD-D02, AUD-API01, AUD-SEC01, AUD-API04, AUD-DB01, AUD-SEC02, DEFECT-001) — all requiring separately approved specs.
- Architecture documentation refreshed via `hdd-architecture-agent`:
  - `docs/current-state.md` — updated to 163 tests / 8.2/10 / all 5 phases documented.
  - `docs/architecture.md` — active decisions + 8 known limitations + open clarifications.
  - `docs/action-plan.md` — stages 0-1 complete; stages 2-5 proposed.
  - `docs/tasks.md` — TASK-008 completed; TASK-009 through TASK-017 added as Proposed.
  - `docs/future-architecture.md` — fase-2-2-fiscal-document-core as next milestone.
- `specs/fase-1-hacienda-consultas/implementation-report.md` — Section 19 added recording Phase 9 results.

### Validation (current baseline)
- Tests: **163 passed / 0 failed** (24 suites)
- TypeScript: 0 errors
- Lint: 0 errors
- Build: clean

---

## [pre-fase-2-hardening] — 2026-10-09

**Agent:** sdd-implementation-agent-c13b28
**Spec:** `specs/pre-fase-2-hardening/`

### Security
- **SEC-001 FIXED:** CORS wildcard (`*`) is now a fatal startup error in `production` and `staging` environments, enforced by the Joi validation schema. Previously was warn-only at runtime.
- **R-13 PARTIAL:** Removed signed fiscal XML from git index (`git rm --cached`); added `SIGNED_*.xml` to `.gitignore`; moved file to `test/fixtures/`. **Git history purge still required** (manual `git filter-repo`).

### Features / Improvements
- **DEF-001 FIXED:** `.env.local.example` now documents all 31+ environment variables with inline comments, organized by section.
- **DEF-002 FIXED:** `docker-compose.yml` billing-api service now includes `CORS_ALLOWED_ORIGINS` with shell-variable substitution defaulting to `http://localhost:3000`.
- **SEC-006 FIXED:** `HaciendaCircuitBreaker` now accepts `ConfigService` injection (`@Optional()`); all 7 resilience parameters (failure threshold, reset timeout, outbound rate, 429/5xx retry counts and delays) are fully configurable via environment variables with production-safe defaults.
- **CI-001 FIXED:** Explicit `npx prisma generate` step added to `lint` and `typecheck` CI jobs.
- Added `USE_REAL_HACIENDA=false` to CI E2E job environment.

### Architecture
- Extracted Joi validation schema to `src/infrastructure/config/config.validation-schema.ts` — standalone module testable without NestJS bootstrap.
- `config.module.ts` imports and re-exports `validationSchema` for backward compatibility.
- `api.main.ts` now uses `ConfigService` exclusively; no direct `process.env` reads remain in bootstrap code.
- `LocalStorageAdapter` constructor no longer reads `process.env`; values passed via `StorageModule` → `ConfigService`.
- `StorageConfig` and `HaciendaConfig` interfaces extended with typed sub-objects.

### Tests
- **+10 unit tests:** `src/infrastructure/config/__tests__/config.validation.spec.ts` — covers CORS production guard, JWT entropy rule, CB defaults, outbound rate cap.
- **+6 unit tests:** `src/infrastructure/integrations/hacienda/__tests__/hacienda-circuit-breaker.spec.ts` updated — `makeBreaker()` helper; configurable threshold (AC-005), reset timeout (AC-006), rate limiter (AC-007), retry exhaustion.
- Total tests: **141** (was 126).

# Architectural Action Plan

> **Synchronized:** post `pre-fase-2-hardening`.
> **Audit score:** 8.2 / 10.
> **Next planned feature:** `specs/fase-2-2-fiscal-document-core` (Hacienda v4.4 fiscal document core — NOT yet implemented).
> All tasks in this document have status **Proposed** unless explicitly marked **Completed**.

---

## 1. Objective

Maintain accurate, current-reality architecture documentation and define an incremental path to:
1. Close open audit findings (AUD-D02, AUD-API01, AUD-SEC01, AUD-API04, AUD-DB01, AUD-SEC02, DEFECT-001) under dedicated approved specifications.
2. Prepare the architecture for `specs/fase-2-2-fiscal-document-core` (fiscal document generation, XML signing, Hacienda submission).

---

## 2. Scope

**In scope for this plan:**
- Documentation refresh to accurately reflect the current repository post-pre-fase-2-hardening.
- Proposed remediation tasks for each open audit finding.
- Proposed preparation tasks for the next feature phase.

**Not in scope for this plan:**
- Implementation of `specs/fase-2-2-fiscal-document-core` (requires separate approved spec).
- Changes to applied database migrations.
- Library selection for XmlSignerPort (requires ADR-005 spike results).

---

## 3. Out of Scope

- Microservices decomposition.
- Multi-region deployment.
- PDF generation.
- Webhook delivery system.
- Payments / receipts.
- Customer portal / UI.

---

## 4. Requirements Addressed

### Completed — All Implementation Phases

| Phase | Key Deliverables | Evidence |
|---|---|---|
| fase-0-foundation | NestJS monolith, Prisma/PostgreSQL, JWT, argon2id API keys, tenant isolation, audit, queue/storage/secrets ports | 163 unit tests pass |
| fase-1-hacienda-consultas | Taxpayer/CABYS/exchange-rate endpoints, ThrottlerModule, ScopeGuard (AND/fail-closed), HaciendaCircuitBreaker, HaciendaApiAdapter + Mock, CORS, scope validation | E2E fase1 pass |
| fase-2-1-hacienda-connection | HaciendaConnection entity (configure/get/validate/disable), HaciendaTokenCache, HaciendaOidcAuthAdapter, XmlSignerPort stub, audit on all operations | E2E fase2 pass |
| post-fase-2-1-remediation | AuthTokenDuration service, refresh rotation fix, GlobalExceptionFilter NODE_ENV fix, AuditInterceptor action fix, E2E factory valid JURIDICA IDs, controller response DTO fix | All E2E pass |
| pre-fase-2-hardening | CORS production fatal error (Joi), configurable HaciendaCircuitBreaker (7 params), CI `npx prisma generate`, `.env.local.example` 31+ vars, Compose CORS substitution | 163 tests pass, audit 8.2/10 |

### Proposed — Open Audit Findings

| Finding ID | Severity | Proposed Task |
|---|---|---|
| AUD-API01 | High | TASK-011: Add tenant ownership check on GET /tenants/:id |
| AUD-SEC01 | High | TASK-012: Add helmet middleware |
| AUD-API04 | Medium | TASK-013: Implement first worker job handler |
| AUD-DB01 | Medium | TASK-014: DB-level audit append-only enforcement |
| AUD-SEC02 | Medium | TASK-015: Shared token cache for multi-instance deployments |
| DEFECT-001 | Medium | TASK-016: Fix hardcoded expiresIn in RefreshTokenHandler |
| AUD-D02 | Low | TASK-017: Commit CD pipeline or document deployment strategy |

---

## 5. Current Problems Addressed

### Resolved by Completed Phases
- Hacienda public query endpoints (taxpayer, CABYS, exchange rate) are implemented and tested.
- Per-company Hacienda connection management is implemented and tested.
- CORS wildcard in production was a warn-only risk — now a fatal startup error.
- Circuit breaker parameters were hardcoded — now fully configurable.
- E2E test factory was generating invalid JURIDICA IDs — now generates valid 10-digit IDs.
- `GlobalExceptionFilter` was reading `process.env.NODE_ENV` directly — now reads from injected value.
- `AuditInterceptor` was building non-categorical action strings — now uses controller/handler name normalization.
- `RefreshTokenHandler` rotation was not using `addAuthDurationToDate` — now correctly computes expiry.

### Remaining Open Problems
See Section 4 — proposed tasks for each open finding.

---

## 6. Domains Affected

### By Open Audit Findings
- **Identity** (AUD-API01, DEFECT-001)
- **API / HTTP Layer** (AUD-SEC01: helmet, AUD-API01: ownership check)
- **Audit** (AUD-DB01: DB-level enforcement)
- **Hacienda Connection** (AUD-SEC02: shared token cache)
- **Worker** (AUD-API04: job handlers)
- **Containers / CI** (AUD-D02: CD pipeline)

### By Next Feature (specs/fase-2-2-fiscal-document-core — NOT YET IN SCOPE)
- New domain: Fiscal Documents
- Hacienda Connection (token usage for document submission)
- Audit (fiscal-audit event class usage)
- Worker (async submission/polling job handlers)
- Storage (XML/PDF document artifacts)
- Signing infrastructure (XmlSignerPort adapter)

---

## 7. Behavior to Preserve

1. All 163 unit tests and 7 E2E suites must continue to pass after any remediation.
2. `/api/v1` prefix and all current endpoint contracts must remain backward-compatible unless explicitly approved.
3. Tenant isolation (AsyncLocalStorage + applyTenantFilter) must not be weakened.
4. API key argon2id hashing, ScopeGuard fail-closed semantics, and CORS production enforcement must not be weakened.
5. Hacienda best-effort company creation verification must not be changed to blocking.
6. AuditLog append-only behavior must be maintained or strengthened.

---

## 8. Defects to Correct

| ID | Task | Description |
|---|---|---|
| DEFECT-001 | TASK-016 | Fix `RefreshTokenHandler`: derive `expiresIn` in response from `JWT_EXPIRES_IN` config instead of hardcoded `15 * 60`. |

---

## 9. Future Architectural Changes

All items below are **Proposed** and require explicit approval before implementation.

### Near-Term (Audit Remediation — no spec required, approved individually)
1. Add `helmet` middleware to `api.main.ts` (TASK-012).
2. Add tenant ownership check to `GET /tenants/:id` (TASK-011).
3. Fix `expiresIn` in `RefreshTokenHandler` (TASK-016).
4. Commit a CD pipeline or document deployment strategy (TASK-017).

### Medium-Term (Require Specs or ADR)
5. DB-level audit append-only enforcement — PostgreSQL trigger or append-only role (TASK-014).
6. Shared token cache (Redis/PostgreSQL) for `HaciendaTokenCache` multi-instance support (TASK-015).
7. First worker job handler registration (TASK-013).
8. Application-layer framework decoupling: remove `HaciendaUnavailableException` import from `CreateCompanyHandler` (TASK-010).

### Longer-Term (Require `specs/fase-2-2-fiscal-document-core` and beyond)
9. XmlSignerPort adapter implementation (pending ADR-005 spike).
10. Fiscal document domain: entity, repository, idempotency, consecutive key generation.
11. Hacienda document submission and status polling (async, via worker).
12. Document artifact storage (XML/PDF) via StoragePort.
13. Fiscal audit event class usage in document lifecycle.

---

## 10. Database Changes

### Completed
- 3 migrations applied. No changes required for open audit remediation.

### Proposed (require new migrations, do NOT modify applied migrations)
- TASK-014: PostgreSQL trigger or append-only role to prevent `audit_logs` mutations (new DDL migration).
- `specs/fase-2-2-fiscal-document-core`: fiscal document tables (new migration, not yet scoped).

---

## 11. API and Integration Changes

### Completed — No Backward-Breaking Changes
- All current contracts remain stable.

### Proposed
- TASK-011: `GET /tenants/:id` — error response change if cross-tenant access is rejected (403 → 404 decision needed to avoid tenant enumeration).
- TASK-016: `POST /auth/refresh` response — `expiresIn` value correction (semantics fix, no breaking change if value was already correct).
- TASK-012: `helmet` — adds new security response headers (non-breaking).
- `specs/fase-2-2-fiscal-document-core`: new endpoints under `/api/v1/fiscal-documents/` (additive, not breaking).

---

## 12. Container and Deployment Changes

### Completed
- Docker Compose CORS shell variable substitution.
- Dockerfile multi-stage, non-root, health check.

### Proposed
- TASK-012: `helmet` in `api.main.ts` — no container change required.
- TASK-017: Commit CI deployment stage or document external CD strategy.
- TASK-015: If Redis chosen for shared token cache — add Redis service to Docker Compose and CI.

---

## 13. Security Changes

### Completed
- CORS production enforcement (fatal startup).
- CORS wildcard rejected in production/staging via Joi.
- CircuitBreaker configurable without code changes.

### Proposed
- TASK-011: Eliminate cross-tenant read risk on `GET /tenants/:id`.
- TASK-012: Add `helmet` for HTTP security headers (CSP, HSTS, X-Frame-Options, etc.).
- TASK-014: DB-level audit integrity.
- TASK-015: Prevent Hacienda IDP token storms in multi-instance deployments.

---

## 14. Test Strategy

### Current Baseline (must be preserved)
- `npm test -- --silent`: 163 tests, 24 suites, 0 failures
- `npm run test:e2e`: 7 suites passing
- `npm run typecheck`: 0 errors
- `npm run lint:check`: 0 errors
- `npm run build`: clean

### Proposed Test Work Per Task
- TASK-011: Add E2E test for cross-tenant tenant read attempt (expects 403 or 404).
- TASK-012: Add unit test for `api.main.ts` confirming helmet headers present in test environment.
- TASK-013: Add unit test for job handler; update E2E if worker behavior is testable.
- TASK-014: Add migration verification test (audit record mutation attempt fails).
- TASK-015: Unit test for shared token cache adapter.
- TASK-016: Unit test for `RefreshTokenHandler.execute()` result `expiresIn` when `JWT_EXPIRES_IN=30m`.

### Before Risky Refactors
- Add characterization tests before modifying `TenantContextInterceptor`, `TenantAwarePrismaRepository`, or `AuditInterceptor`.

---

## 15. Migration Stages

### Stage 0 — Completed ✅
All phases through `pre-fase-2-hardening` are implemented and validated.

### Stage 1 — Documentation Refresh (Current — Completed ✅)
- Refresh `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`, `docs/tasks.md`, `docs/future-architecture.md`.

### Stage 2 — High-Severity Audit Remediations (Proposed — no spec required)
- TASK-011: Tenant ownership check
- TASK-012: helmet middleware
- TASK-016: Fix DEFECT-001 (hardcoded expiresIn)

### Stage 3 — Medium-Severity Audit Remediations (Proposed — require ADR or spec)
- TASK-013: First worker job handler
- TASK-014: DB-level audit append-only
- TASK-015: Shared token cache

### Stage 4 — Architecture Cleanup (Proposed — low risk, incremental)
- TASK-010: Remove infrastructure exception import from CreateCompanyHandler
- TASK-017: CD pipeline or deployment documentation

### Stage 5 — Fiscal Document Core (Proposed — requires `specs/fase-2-2-fiscal-document-core` approval)
- XmlSignerPort adapter (ADR-005 spike first)
- Fiscal document domain implementation
- Worker job handlers for async Hacienda submission
- Hacienda document submission/status endpoints

---

## 16. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| AUD-API01: cross-tenant read exploitable before fix | High | Fix in Stage 2 (TASK-011); add E2E test immediately |
| AUD-SEC01: missing security headers exploitable | High | Fix in Stage 2 (TASK-012); low change risk |
| DEFECT-001: clients relying on stale expiresIn | Medium | Fix in Stage 2 (TASK-016); non-breaking semantics correction |
| AUD-SEC02: token storm in multi-instance | Medium | Acceptable for current single-instance; fix in Stage 3 before scaling |
| AUD-DB01: audit record tampering risk | Medium | Fix in Stage 3; requires DBA decision on mechanism |
| AUD-API04: worker produces no value | Medium | Fix in Stage 3 when fiscal document spec is approved |
| XmlSignerPort spike failure | Medium | Define fallback library options before committing to implementation |
| Stage 5 scope creep | High | Enforce spec-driven discipline; no implementation without approved spec |

---

## 17. Rollback or Recovery Strategy

- **TASK-011/012/016:** Small, targeted changes. Rollback = revert the changed file(s). No DB changes.
- **TASK-013/014/015:** Require new migration (TASK-014) or new dependency (TASK-015). Rollback = revert code + drop migration (pre-deploy only) or disable feature flag.
- **Stage 5 (fiscal documents):** Additive — new tables, new endpoints. Rollback = disable controller, rollback migration. Must not affect existing functionality.
- **General rule:** Never modify applied migrations. Always add new migrations.

---

## 18. Manual Validation

After each stage, validate:
1. `npm test -- --silent` — all 163 tests pass (minimum; new tests may increase count).
2. `npm run test:e2e` — all 7 suites pass.
3. `npm run typecheck` — 0 errors.
4. `npm run lint:check` — 0 errors.
5. `npm run build` — clean.
6. For any DB migration: `npx prisma migrate deploy` on a clean test DB.
7. For TASK-012: manual HTTP request to verify security headers present.
8. For TASK-011: manual E2E test with cross-tenant JWT attempting `GET /tenants/:id`.

---

## 19. Approval Status

| Stage | Status |
|---|---|
| Stage 0: All phases through pre-fase-2-hardening | ✅ Completed and validated |
| Stage 1: Documentation refresh | ✅ Completed by hdd-architecture-agent-5e6574 |
| Stage 2: High-severity audit remediations | 🔲 Proposed — awaiting approval |
| Stage 3: Medium-severity audit remediations | 🔲 Proposed — awaiting approval + ADR/spec |
| Stage 4: Architecture cleanup | 🔲 Proposed — awaiting approval |
| Stage 5: Fiscal document core | 🔲 Proposed — awaiting `specs/fase-2-2-fiscal-document-core` |

# Tasks

> **Synchronized:** post `pre-fase-2-hardening`.
> Tasks TASK-001 through TASK-007 are from previous implementation cycles. Statuses reflect the validated post-hardening baseline.
> TASK-008 through TASK-017 are newly scoped proposed tasks for open audit findings.
> All proposed tasks require explicit approval before implementation.

---

## TASK-005: Validate focused HaciendaConnection E2E after PostgreSQL unblock
**Status:** Completed
**Priority:** High
**Domain:** Hacienda Connection / Companies Testing
**Requirement:** Confirm HaciendaConnection E2E works with valid company identification fixtures.
**Reason:** Direct regression target for the post-fase-2-1 DB/E2E blocker.
**Current problem:** Resolved. E2E companies are now generated with valid 10-digit JURIDICA IDs.
**Proposed change:** Completed by implementation cycle; no further production change proposed.
**Affected files:** `test/helpers/test-factories.ts`, `test/e2e/fase2/hacienda-connection.e2e-spec.ts`
**Dependencies:** PostgreSQL container readiness; Prisma migrations deployed.
**Database impact:** None to schema.
**API impact:** None.
**Container impact:** None.
**Security impact:** None.
**Acceptance criteria:** Focused HaciendaConnection E2E passes.
**Required tests:** `npm run test:e2e -- hacienda-connection`
**Migration considerations:** None.
**Rollback or mitigation:** Do not roll back — would reintroduce E2E blocker.
**Risk:** Low (completed).

---

## TASK-006: Run full E2E and full quality gates after remediation
**Status:** Completed
**Priority:** High
**Domain:** Cross-cutting Verification
**Requirement:** Confirm full system gates pass after PostgreSQL/E2E unblock.
**Reason:** Ensures remediation preserved full system behavior.
**Current problem:** Resolved. All gates confirmed passing.
**Proposed change:** Completed; no further production change.
**Affected files:** No production files. Validation only.
**Dependencies:** TASK-005, PostgreSQL readiness, Prisma migrations.
**Database impact:** None to schema.
**API impact:** None.
**Container impact:** None.
**Security impact:** None.
**Acceptance criteria:** Full E2E (7 suites), lint, typecheck, unit tests (163/24), build all pass.
**Required tests:** `npm run test:e2e -- --silent`, `npm run lint:check`, `npm run typecheck`, `npm test -- --silent`, `npm run build`
**Migration considerations:** `npx prisma migrate deploy` must remain successful.
**Rollback or mitigation:** Investigate new regression separately; preserve fixture fix.
**Risk:** Low (completed).

---

## TASK-007: Architecture documentation refresh (post-fase-2-1-remediation)
**Status:** Completed
**Priority:** Medium
**Domain:** Architecture Documentation
**Requirement:** Refresh all docs after post-fase-2-1 remediation.
**Reason:** Documentation must reflect completed implementation and separate from future proposals.
**Current problem:** Resolved. Documentation reflected post-fase-2-1-remediation state.
**Proposed change:** Completed documentation-only update.
**Affected files:** `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`, `docs/tasks.md`, `docs/future-architecture.md`
**Dependencies:** None.
**Database impact:** None.
**API impact:** None.
**Container impact:** None.
**Security impact:** Documents remaining 7.4/10 audit baseline risk.
**Acceptance criteria:** Docs separate completed remediation from proposed future work.
**Required tests:** Documentation review only.
**Migration considerations:** None.
**Rollback or mitigation:** Revert documentation files if inaccurate.
**Risk:** Low (completed).

---

## TASK-008: Architecture documentation refresh (post-pre-fase-2-hardening)
**Status:** Completed
**Priority:** High
**Domain:** Architecture Documentation
**Requirement:** Refresh all docs to reflect post-pre-fase-2-hardening state (8.2/10, 163 tests).
**Reason:** Previous docs were stale (referenced 7.4/10 score, did not document CORS fatal enforcement, configurable circuit breaker, or specific audit finding IDs).
**Current problem:** Resolved by this update.
**Proposed change:** Completed documentation-only update.
**Affected files:** `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`, `docs/tasks.md`, `docs/future-architecture.md`
**Dependencies:** Implementation completion confirmed by `sdd-implementation-agent-c13b28`.
**Database impact:** None.
**API impact:** None.
**Container impact:** None.
**Security impact:** Accurately documents AUD-D02, AUD-API01, AUD-SEC01, AUD-API04, AUD-DB01, AUD-SEC02, DEFECT-001 as proposed future work.
**Acceptance criteria:** All five docs accurately reflect current repository state; no mixing of current reality with future proposals.
**Required tests:** Documentation review only.
**Migration considerations:** None.
**Rollback or mitigation:** Revert documentation files if inaccurate.
**Risk:** Low (completed).

---

## TASK-009: Harden company-scoped resource authorization policies
**Status:** Proposed
**Priority:** Medium
**Domain:** Security / Companies / Hacienda Connection
**Requirement:** Ensure tenant/company-scoped resource handlers cannot serve data across tenant boundaries.
**Reason:** Current architecture uses tenant context and guards, but explicit resource-level ownership checks are not consistently enforced in all handlers.
**Current problem:** Some handlers accept resource IDs (companyId, etc.) and rely on repository-level tenant filtering. If the tenant filter were ever bypassed or misconfigured, cross-tenant access could occur. E2E tenant-isolation tests cover the main case but may not cover all ID-based lookups.
**Proposed change:** Add characterization tests for every handler that accepts a resource ID. If gaps are found, add explicit ownership assertions at the application layer.
**Affected files:** `src/modules/companies/`, `src/modules/hacienda-connection/`, E2E isolation tests.
**Dependencies:** None. Can be done independently.
**Database impact:** None expected. New DB constraints only if gaps are confirmed.
**API impact:** Possible error-contract clarification (403 vs 404 on unauthorized access).
**Container impact:** None.
**Security impact:** Positive — reduces tenant isolation risk surface.
**Acceptance criteria:** All resource ID-based handlers have explicit ownership tests; cross-tenant access tests exist and pass.
**Required tests:** Unit/application ownership tests, E2E tenant-isolation tests for company and Hacienda connection flows.
**Migration considerations:** New migrations only if DB constraints are identified as needed.
**Rollback or mitigation:** Apply incrementally; feature-flag policy changes if compatibility issues arise.
**Risk:** Medium — broad scope; scope it to identified gaps only.

---

## TASK-010: Remove infrastructure exception import from CreateCompanyHandler
**Status:** Proposed
**Priority:** Low
**Domain:** Architecture / Companies
**Requirement:** Align `CreateCompanyHandler` with hexagonal architecture dependency rules (application layer must not import infrastructure exception classes).
**Reason:** `CreateCompanyHandler` imports `HaciendaUnavailableException` from `src/infrastructure/integrations/hacienda/exceptions/` to distinguish Hacienda unavailability from other errors. This violates the application → infrastructure boundary.
**Current problem:** Application layer coupled to infrastructure exception class.
**Proposed change:** Define a domain or application-level exception (e.g., `ExternalServiceUnavailableException`) and throw it from the HaciendaPort adapter; catch it in the handler without importing from infrastructure.
**Affected files:** `src/modules/companies/application/use-cases/create-company/create-company.handler.ts`, `src/infrastructure/integrations/hacienda/exceptions/hacienda-unavailable.exception.ts`, potentially `src/modules/shared/domain/`.
**Dependencies:** None.
**Database impact:** None.
**API impact:** None (behavior unchanged).
**Container impact:** None.
**Security impact:** None.
**Acceptance criteria:** `create-company.handler.ts` does not import from `src/infrastructure`. Tests confirm same error classification behavior.
**Required tests:** Update unit test for CreateCompanyHandler to use the new exception type.
**Migration considerations:** None.
**Rollback or mitigation:** Revert handler file only. Low risk.
**Risk:** Low.

---

## TASK-011: Add tenant ownership check on GET /tenants/:id
**Status:** Proposed
**Priority:** High
**Domain:** Identity / Security
**Requirement:** Prevent potential cross-tenant read on `GET /api/v1/tenants/:id` (AUD-API01).
**Reason:** The `TenantController.getById()` handler does not validate that the requested `:id` matches the authenticated user's `tenantId` from the JWT. A user holding a valid JWT for tenant A could request tenant B's data by passing B's ID.
**Current problem:** No ownership check exists. The handler passes `:id` directly to `GetTenantHandler.execute()` without comparing to `req.user.tenantId`.
**Proposed change:** In `GetTenantHandler` or in the controller before invoking the handler, assert that the requested tenant ID equals the authenticated user's `tenantId`. Return 403 (to avoid tenant enumeration via 404 timing) or 404 consistently.
**Affected files:** `src/modules/identity/infrastructure/http/tenant.controller.ts`, `src/modules/identity/application/use-cases/get-tenant/get-tenant.handler.ts`.
**Dependencies:** None.
**Database impact:** None.
**API impact:** `GET /tenants/:id` — cross-tenant requests now return 403 or 404 (currently they may return 200). Requires decision on response code (see architecture.md §14).
**Container impact:** None.
**Security impact:** Eliminates AUD-API01 cross-tenant read risk.
**Acceptance criteria:** E2E test: user from tenant A attempting `GET /tenants/{tenant-B-id}` receives 403 or 404; user requesting their own tenant ID receives 200.
**Required tests:** Add E2E test to `test/e2e/fase0/tenant-isolation.e2e-spec.ts` for cross-tenant GET.
**Migration considerations:** None.
**Rollback or mitigation:** Revert controller/handler change. No DB changes.
**Risk:** Low change risk; High business impact of NOT fixing.

---

## TASK-012: Add helmet middleware
**Status:** Proposed
**Priority:** High
**Domain:** Security / HTTP Layer
**Requirement:** Add HTTP security headers via `helmet` (AUD-SEC01).
**Reason:** No HTTP security headers are currently set. CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and X-DNS-Prefetch-Control are all absent.
**Current problem:** API responses carry no security headers, exposing clients to clickjacking, MIME-sniffing, and information disclosure risks.
**Proposed change:** Install `helmet` package; call `app.use(helmet())` in `api.main.ts` after CORS configuration. Configure CSP to allow Swagger UI in non-production environments.
**Affected files:** `src/bootstrap/api.main.ts`, `package.json`.
**Dependencies:** `helmet` npm package.
**Database impact:** None.
**API impact:** HTTP responses gain new security headers. Non-breaking. May need CSP tuning for Swagger UI.
**Container impact:** None.
**Security impact:** Eliminates AUD-SEC01 by adding all standard security headers.
**Acceptance criteria:** HTTP responses include `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `X-DNS-Prefetch-Control`. Swagger UI still works in non-production. Unit/E2E tests pass.
**Required tests:** Unit test verifying security headers present in test environment; confirm Swagger UI accessible in non-production.
**Migration considerations:** None.
**Rollback or mitigation:** Remove `app.use(helmet())` call. No DB changes.
**Risk:** Low — well-established library; CSP misconfiguration could break Swagger UI (mitigated by testing).

---

## TASK-013: Implement first worker job handler
**Status:** Proposed
**Priority:** Medium
**Domain:** Worker / Background Processing
**Requirement:** Register at least one job handler in `worker.main.ts` (AUD-API04).
**Reason:** The worker process currently boots but processes no work. PgBossJobQueue is initialized but no handlers are attached. The worker is a shell.
**Current problem:** Worker provides no value and may confuse operators into thinking work is being processed when it is not.
**Proposed change:** Design decision required on what the first job type should be (e.g., Hacienda connection health-check polling, or a placeholder no-op job for infra validation). Implement the handler and register it in `worker.main.ts`.
**Affected files:** `src/bootstrap/worker.main.ts`, new handler file, `src/infrastructure/queue/`.
**Dependencies:** ADR or spec decision on first job type. Cannot implement without clarity on what job to run.
**Database impact:** pg-boss creates its own tables (handled by PgBoss library automatically).
**API impact:** None.
**Container impact:** Worker container gains actual functionality.
**Security impact:** Positive — reduces risk of silent failure in background processing.
**Acceptance criteria:** Worker starts, registers handler, processes a test job. Unit test for handler. No impact on API E2E tests.
**Required tests:** Unit test for job handler; optionally a worker integration test.
**Migration considerations:** pg-boss manages its own schema migration automatically.
**Rollback or mitigation:** Remove handler registration. No DB changes.
**Risk:** Medium — depends on job type decision.

---

## TASK-014: DB-level audit log append-only enforcement
**Status:** Proposed
**Priority:** Medium
**Domain:** Audit / Database
**Requirement:** Enforce `audit_logs` append-only at the database level (AUD-DB01).
**Reason:** Currently append-only is enforced only in `PrismaAuditLogRepository` at the application layer. A compromised application process or direct DB access could mutate or delete fiscal audit records, violating audit integrity.
**Current problem:** No PostgreSQL-level constraint prevents UPDATE or DELETE on `audit_logs`.
**Proposed change:** Choose one of: (a) PostgreSQL trigger on `audit_logs` that raises exception on UPDATE/DELETE; (b) dedicated append-only PostgreSQL role for the application database user; (c) Row-Level Security policy.
**Affected files:** New Prisma migration (raw SQL DDL), `prisma/migrations/`, potentially `prisma/schema.prisma`.
**Dependencies:** DBA/infra decision on enforcement mechanism. This task requires approval before mechanism selection.
**Database impact:** New migration with DDL (trigger or role grant or RLS). Must not block INSERT. Must not affect existing data.
**API impact:** None.
**Container impact:** None. (If a new DB role is chosen, CI DATABASE_URL user must be updated.)
**Security impact:** Eliminates AUD-DB01 — audit log integrity enforced at DB level.
**Acceptance criteria:** Direct SQL `UPDATE audit_logs SET ...` fails with an error. Application can still INSERT. All existing tests pass.
**Required tests:** Migration verification test attempting direct mutation. CI must validate migration deploys cleanly.
**Migration considerations:** New migration only. Never modify applied migrations.
**Rollback or mitigation:** Drop trigger/RLS via a new down-migration. Revert code if needed.
**Risk:** Medium — DDL change in production schema; requires testing in staging before production.

---

## TASK-015: Shared Hacienda token cache for multi-instance deployments
**Status:** Proposed
**Priority:** Medium
**Domain:** Hacienda Connection / Infrastructure
**Requirement:** Replace in-memory `HaciendaTokenCache` with a shared backend (AUD-SEC02).
**Reason:** `HaciendaTokenCache` is per-process in memory. In a multi-instance deployment, each instance independently authenticates to Hacienda IDP, potentially causing token storms and exceeding IDP rate limits.
**Current problem:** No shared token state between API instances. Token expiry is checked per-process only.
**Proposed change:** Replace the in-memory Map with a backend-backed store. Options: Redis (new dependency), PostgreSQL (existing; store token in `hacienda_connections` table or a new `hacienda_tokens` table), or SSM Parameter Store (for low-frequency refresh). Recommendation: PostgreSQL-backed cache using `hacienda_connections.last_successful_auth_at` + a new encrypted `access_token` field, or a dedicated `hacienda_tokens` table. Requires design decision.
**Affected files:** `src/modules/hacienda-connection/infrastructure/auth/hacienda-token-cache.service.ts`, potentially new migration.
**Dependencies:** Design decision on storage backend (Redis vs. PostgreSQL vs. other). Cannot implement without decision.
**Database impact:** Possibly new `hacienda_tokens` table or additional column in `hacienda_connections` (new migration required).
**API impact:** None observable.
**Container impact:** If Redis is chosen: add Redis service to Docker Compose and CI.
**Security impact:** Reduces Hacienda IDP rate limit risk in multi-instance deployments.
**Acceptance criteria:** Two API instances share token state. One instance obtaining a token prevents unnecessary re-authentication on the other instance. Unit tests for shared cache adapter.
**Required tests:** Unit test for shared cache adapter; integration test confirming token sharing across simulated instances.
**Migration considerations:** New migration if PostgreSQL-backed. Never modify applied migrations.
**Rollback or mitigation:** Revert to in-memory cache (acceptable for single-instance deployments).
**Risk:** Medium — design decision required; new infrastructure component if Redis is chosen.

---

## TASK-016: Fix hardcoded expiresIn in RefreshTokenHandler (DEFECT-001)
**Status:** Proposed
**Priority:** Medium
**Domain:** Identity / Authentication
**Requirement:** Fix DEFECT-001: `RefreshTokenHandler.execute()` returns `expiresIn: 15 * 60` hardcoded instead of deriving from `JWT_EXPIRES_IN`.
**Reason:** If `JWT_EXPIRES_IN` is changed to a value other than 15 minutes, clients receive an incorrect `expiresIn` hint in the refresh token response, causing incorrect token refresh scheduling.
**Current problem:** `return { accessToken, refreshToken, expiresIn: 15 * 60 };` — line 91 of `refresh-token.handler.ts`. The `addAuthDurationToDate` utility and `jwtExpiresIn` field are both available in the handler but not used for the response `expiresIn`.
**Proposed change:** Parse `this.jwtExpiresIn` string (e.g., `'15m'`, `'1h'`) into seconds using `addAuthDurationToDate` or a dedicated utility, and return the computed value in `expiresIn`.
**Affected files:** `src/modules/identity/application/use-cases/refresh-token/refresh-token.handler.ts`
**Dependencies:** `auth-token-duration.ts` utility (already exists).
**Database impact:** None.
**API impact:** `POST /auth/refresh` response — `expiresIn` value changes only if `JWT_EXPIRES_IN` is not `15m`. Semantics correction; not a breaking change.
**Container impact:** None.
**Security impact:** Corrects misleading `expiresIn` value. Prevents client over-trust of stale token lifetimes.
**Acceptance criteria:** Unit test: when `JWT_EXPIRES_IN=30m`, `RefreshTokenHandler.execute()` returns `expiresIn: 1800`. When `JWT_EXPIRES_IN=15m`, returns `expiresIn: 900`.
**Required tests:** Update `src/modules/identity/application/__tests__/refresh-token.handler.spec.ts` to assert computed `expiresIn`.
**Migration considerations:** None.
**Rollback or mitigation:** Revert handler file. No DB changes.
**Risk:** Low — isolated, well-tested handler.

---

## TASK-017: Commit CI/CD deployment stage or document deployment strategy
**Status:** Proposed
**Priority:** Low
**Domain:** Containers / Deployment / CI
**Requirement:** Address AUD-D02: CI pipeline has no deployment stage.
**Reason:** The GitHub Actions pipeline validates code quality but has no deployment step. It is unclear whether deployment is managed externally or intentionally absent.
**Current problem:** Cannot distinguish "deployment intentionally deferred" from "deployment managed elsewhere". Risk of deployment process drift if undocumented.
**Proposed change:** One of: (a) Add a deployment gate to `ci.yml` (e.g., deploy to staging after E2E passes on `main`); (b) Add a `docs/deployment.md` file documenting the external deployment strategy; (c) Add a placeholder comment in `ci.yml` explaining the decision.
**Affected files:** `.github/workflows/ci.yml` and/or new `docs/deployment.md`.
**Dependencies:** Requires decision on deployment strategy (ECS, Kubernetes, Railway, etc.).
**Database impact:** None.
**API impact:** None.
**Container impact:** Deployment configuration depends on target platform.
**Security impact:** Positive — deployment process becomes auditable and documented.
**Acceptance criteria:** The repository clearly communicates how the application is deployed, either through a committed CI step or explicit documentation.
**Required tests:** None beyond existing CI validation.
**Migration considerations:** Deployment must include `npx prisma migrate deploy` before starting the API process.
**Rollback or mitigation:** Revert CI file. No runtime impact.
**Risk:** Low.

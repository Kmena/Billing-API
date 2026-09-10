# Tasks

> **Status key:**
> - ✅ Complete — implemented and verified in repository
> - 🔵 Proposed — awaiting approval; no production code modified
> - 🟡 Deferred — acknowledged; not in current cycle
> - 🔴 Open defect — confirmed bug; fix not yet approved

---

## Completed Tasks — Fase 0 (Foundation)

> All Fase 0 tasks are complete. Listed for traceability only.

### TASK-001: Multi-tenant PostgreSQL schema
**Status:** ✅ Complete
**Priority:** Critical
**Domain:** Identity, Companies, API Keys, Audit
**Reason:** Foundation — all Fase 0 entities require tenant-scoped tables.
**Affected files:** `prisma/schema.prisma`, `prisma/migrations/20250001000000_initial_foundation/`

---

### TASK-002: Identity module (Tenants, Users, Auth)
**Status:** ✅ Complete
**Priority:** Critical
**Domain:** Identity
**Reason:** Tenant registration and JWT authentication are the security foundation.
**Affected files:** `src/modules/identity/**`

---

### TASK-003: Companies module
**Status:** ✅ Complete
**Priority:** High
**Domain:** Companies
**Reason:** Tenant-owned companies are the primary billable unit.
**Affected files:** `src/modules/companies/**`

---

### TASK-004: Two-tier rate limiting (DEC-007)
**Status:** ✅ Complete
**Priority:** High
**Domain:** API Layer
**Reason:** Prevent API key abuse and auth brute-force attacks.
**Affected files:** `src/app.module.ts`, `src/api/guards/api-key-throttler.guard.ts`

---

### TASK-005: API Keys module
**Status:** ✅ Complete
**Priority:** Critical
**Domain:** API Keys
**Reason:** API Keys are the integration authentication mechanism for Fase 1.
**Affected files:** `src/modules/api-keys/**`

---

### TASK-006: Audit module (ADR-009)
**Status:** ✅ Complete
**Priority:** High
**Domain:** Audit
**Reason:** All operations must be auditable with EventClass retention classification.
**Affected files:** `src/modules/audit/**`, `src/api/interceptors/audit.interceptor.ts`

---

### TASK-007: Storage infrastructure (Local + S3)
**Status:** ✅ Complete
**Priority:** Medium
**Domain:** Infrastructure — Storage
**Reason:** Object storage required for documents (Fase 3+). Abstraction enables dev/prod parity.
**Affected files:** `src/infrastructure/storage/**`

---

### TASK-008: Queue infrastructure (pg-boss + InMemory)
**Status:** ✅ Complete
**Priority:** Medium
**Domain:** Infrastructure — Queue
**Reason:** Async job processing infrastructure required for Fase 3+.
**Affected files:** `src/infrastructure/queue/**`

---

### TASK-009: Secrets infrastructure (Env + SSM)
**Status:** ✅ Complete
**Priority:** Medium
**Domain:** Infrastructure — Secrets
**Reason:** Secret abstraction enables env-based dev and SSM-based production without code changes.
**Affected files:** `src/infrastructure/secrets/**`

---

### TASK-010: Health checks + Swagger + Docker
**Status:** ✅ Complete
**Priority:** Medium
**Domain:** Infrastructure
**Reason:** Operational readiness. OpenAPI for developer experience.
**Affected files:** `src/api/health/**`, `Dockerfile`, `docker-compose.yml`

---

### TASK-011: CI pipeline (5-gate)
**Status:** ✅ Complete
**Priority:** High
**Domain:** DevOps
**Reason:** Automated quality gates before deployment.
**Affected files:** `.github/workflows/ci.yml`

---

## Completed Tasks — Fase 1 (Public Hacienda API)

> All Fase 1 tasks are complete. Listed for traceability only.

### TASK-012: Hacienda integration infrastructure (HaciendaPort + adapters)
**Status:** ✅ Complete
**Priority:** Critical
**Domain:** Hacienda Integration
**Reason:** Taxpayer lookup, CABYS, exchange rates require Hacienda API access.
**Affected files:** `src/infrastructure/integrations/hacienda/**`

---

### TASK-013: HaciendaCircuitBreaker (rate limiter + state machine + retry)
**Status:** ✅ Complete
**Priority:** Critical
**Domain:** Hacienda Integration
**Reason:** Hacienda has strict rate limits (10 req/s, 1200/2min). Circuit breaker protects against Hacienda outages.
**Affected files:** `src/infrastructure/integrations/hacienda/hacienda-circuit-breaker.service.ts`

---

### TASK-014: Taxpayer lookup endpoint
**Status:** ✅ Complete
**Priority:** High
**Domain:** Taxpayers
**Requirement:** FR-001, Fase 1 milestone
**Affected files:** `src/modules/taxpayers/**`

---

### TASK-015: CABYS catalog endpoints
**Status:** ✅ Complete
**Priority:** High
**Domain:** CABYS
**Requirement:** Fase 1 milestone
**Affected files:** `src/modules/cabys/**`

---

### TASK-016: Exchange rate endpoint
**Status:** ✅ Complete
**Priority:** High
**Domain:** Exchange Rates
**Requirement:** Fase 1 milestone
**Affected files:** `src/modules/exchange-rates/**`

---

### TASK-017: Hacienda verification at company creation
**Status:** ✅ Complete
**Priority:** High
**Domain:** Companies
**Reason:** Verify taxpayer identity when registering a company.
**Affected files:** `src/modules/companies/application/use-cases/create-company/`
**Database impact:** Migration `20250002000000_company_hacienda_fields` (nullable verification columns)

---

### TASK-018: Scope guard + API key scope enforcement
**Status:** ✅ Complete
**Priority:** Critical
**Domain:** API Keys, API Layer
**Requirement:** Fase 1 — scoped API key authorization
**Affected files:** `src/api/guards/scope.guard.ts`, `src/api/decorators/scopes.decorator.ts`

---

## Completed Tasks — pre-fase-2-hardening

### TASK-019: Extract standalone Joi validation schema
**Status:** ✅ Complete
**Priority:** High
**Domain:** Infrastructure — Config
**Requirement:** HARD-001 — testability of config validation without NestJS bootstrap
**Current problem:** `config.module.ts` contained the schema inline, making it impossible to import without NestJS.
**Proposed change:** Extract to `config.validation-schema.ts`; re-export from `config.module.ts`.
**Affected files:**
- `src/infrastructure/config/config.validation-schema.ts` (new)
- `src/infrastructure/config/config.module.ts` (modified)
**Acceptance criteria:** Schema importable independently; `config.module.ts` re-exports it.

---

### TASK-020: Config validation unit tests (10 tests)
**Status:** ✅ Complete
**Priority:** High
**Domain:** Infrastructure — Config
**Requirement:** Test coverage for CORS rules, JWT constraints, CB defaults
**Proposed change:** Create `config.validation.spec.ts` with 10 Joi test cases.
**Affected files:** `src/infrastructure/config/__tests__/config.validation.spec.ts` (new)
**Acceptance criteria:** 10 tests covering AC-001 through AC-008; all pass.

---

### TASK-021: CORS fail-fast via Joi schema
**Status:** ✅ Complete
**Priority:** Critical
**Domain:** Infrastructure — Config, Security
**Requirement:** HARD-002 — no warn-only CORS fallback in production/staging
**Current problem:** Previous implementation used `console.warn` fallback when `CORS_ALLOWED_ORIGINS` was absent.
**Proposed change:** Add `Joi.when('NODE_ENV', { is: Joi.valid('production', 'staging'), then: Joi.string().invalid('*').required() })` rule.
**Affected files:** `src/infrastructure/config/config.validation-schema.ts`
**Security impact:** Application fails to start without explicit non-wildcard CORS origins in production/staging.
**Acceptance criteria:** Tests AC-001 and AC-002 pass.

---

### TASK-022: api.main.ts zero process.env reads
**Status:** ✅ Complete
**Priority:** High
**Domain:** Bootstrap
**Requirement:** HARD-003 — ConfigService as sole config source
**Current problem:** Previous `api.main.ts` contained direct `process.env` reads for CORS and port.
**Proposed change:** Replace all `process.env` reads with `configService.get()` calls.
**Affected files:** `src/bootstrap/api.main.ts`
**Acceptance criteria:** No `process.env` references in `api.main.ts`; behavior identical.

---

### TASK-023: HaciendaCircuitBreaker 7 configurable thresholds
**Status:** ✅ Complete
**Priority:** High
**Domain:** Hacienda Integration
**Requirement:** HARD-004 — all circuit breaker and retry thresholds configurable per environment
**Current problem:** Failure threshold, reset timeout, rate, and retry values were compile-time constants.
**Proposed change:** Add `circuitBreaker` + `retry` sub-objects to `HaciendaConfig`; inject `@Optional() ConfigService`; read all 7 values from config with safe defaults.
**Affected files:**
- `src/infrastructure/config/hacienda.config.ts`
- `src/infrastructure/config/config.validation-schema.ts`
- `src/infrastructure/integrations/hacienda/hacienda-circuit-breaker.service.ts`
- `docker-compose.yml`
**Acceptance criteria:** Tests AC-005, AC-006, AC-007 pass. Default values match documented production-safe values.

---

### TASK-024: LocalStorageAdapter decoupled from process.env
**Status:** ✅ Complete
**Priority:** Medium
**Domain:** Infrastructure — Storage
**Requirement:** HARD-005 — all infrastructure adapters receive config from NestJS DI
**Current problem:** `LocalStorageAdapter` constructor previously read `process.env.LOCAL_STORAGE_PATH` and `process.env.LOCAL_STORAGE_SECRET` directly.
**Proposed change:** Accept optional `storagePath` and `signingSecret` constructor params; update `StorageModule` to pass values from `ConfigService`.
**Affected files:**
- `src/infrastructure/storage/adapters/local-storage.adapter.ts`
- `src/infrastructure/storage/storage.module.ts`
- `src/infrastructure/config/storage.config.ts`
- `src/infrastructure/config/config.validation-schema.ts`
**Acceptance criteria:** `LocalStorageAdapter` has no `process.env` reads; `StorageModule` factory passes config values.

---

### TASK-025: CI pipeline improvements
**Status:** ✅ Complete
**Priority:** Medium
**Domain:** DevOps
**Requirement:** HARD-007, HARD-008 — reproducible lint/typecheck; safe E2E
**Current problem:** Lint and typecheck CI jobs failed intermittently due to missing Prisma client. E2E job could accidentally call real Hacienda.
**Proposed change:** Add `npx prisma generate` to lint + typecheck jobs; set `USE_REAL_HACIENDA=false` in E2E job.
**Affected files:** `.github/workflows/ci.yml`
**Acceptance criteria:** Lint and typecheck jobs generate Prisma client before running. E2E job always uses mock Hacienda.

---

### TASK-026: docker-compose CORS_ALLOWED_ORIGINS and gitignore SIGNED_*.xml
**Status:** ✅ Complete
**Priority:** Medium
**Domain:** DevOps, Security
**Requirement:** HARD-006 — fiscal documents not committable
**Current problem:** `CORS_ALLOWED_ORIGINS` was not configurable in docker-compose. `SIGNED_*.xml` files were not gitignored.
**Proposed change:** Add `CORS_ALLOWED_ORIGINS` env var to `billing-api` in docker-compose; add `SIGNED_*.xml` to `.gitignore`.
**Affected files:** `docker-compose.yml`, `.gitignore`
**Acceptance criteria:** `CORS_ALLOWED_ORIGINS` configurable via docker-compose env override; `SIGNED_*.xml` not tracked by git.

---

## Open Defects

### TASK-F2-001: Fix GlobalExceptionFilter direct process.env read (DEFECT-001)
**Status:** 🔴 Open — Proposed
**Priority:** Low
**Domain:** API Layer
**Requirement:** Architectural consistency with HARD-003
**Current problem:** `GlobalExceptionFilter` reads `process.env.NODE_ENV` directly (`const isProduction = process.env.NODE_ENV === 'production'`). All other bootstrap and application code uses ConfigService post-hardening.
**Proposed change:** Inject `ConfigService` into `GlobalExceptionFilter` constructor; replace `process.env.NODE_ENV === 'production'` with `configService.get<string>('NODE_ENV') === 'production'`.
**Affected files:** `src/api/filters/global-exception.filter.ts`
**Dependencies:** None
**Database impact:** None
**API impact:** None (behavioral change: none — value is the same at startup)
**Container impact:** None
**Security impact:** Eliminates divergence between Joi-validated NODE_ENV and filter behavior in edge cases
**Acceptance criteria:**
- `GlobalExceptionFilter` injects ConfigService
- No `process.env` reads remain in the filter
- Existing behavior in production and development modes is identical
**Required tests:** Update or verify existing filter tests (if any); add test for production mode detection if absent
**Migration considerations:** None
**Rollback or mitigation:** Revert change if filter behavior diverges; fallback is prior direct `process.env` read
**Risk:** Very low

---

## Proposed Tasks — Fase 2 (HaciendaConnection per Company)

> All tasks below are **Proposed** and require explicit approval before implementation.

---

### TASK-F2-002: HaciendaConnection domain entity and value objects
**Status:** 🔵 Proposed
**Priority:** Critical
**Domain:** Companies
**Requirement:** REQ-F2-001, REQ-F2-002
**Reason:** A well-defined domain entity with a state machine is required before any infrastructure work.
**Current problem:** No HaciendaConnection domain model exists.
**Proposed change:**
- Create `HaciendaConnection` entity with `status`, `haciendaEnvironment`, `secretRef`, `certStorageKey`, `lastVerifiedAt`
- Create `HaciendaEnvironment` value object (`PRODUCTION` | `SANDBOX`)
- Create `HaciendaConnectionStatus` value object (`UNCONFIGURED` | `CONFIGURED` | `VERIFIED` | `REVOKED`)
- Define state transition invariants: only valid transitions allowed
- Define `HaciendaConnectionRepository` port
**Affected files:**
- `src/modules/companies/domain/entities/hacienda-connection.entity.ts` (new)
- `src/modules/companies/domain/value-objects/hacienda-environment.vo.ts` (new)
- `src/modules/companies/domain/value-objects/hacienda-connection-status.vo.ts` (new)
- `src/modules/companies/domain/ports/hacienda-connection.repository.ts` (new)
- `src/modules/companies/domain/__tests__/hacienda-connection.entity.spec.ts` (new)
**Dependencies:** None
**Database impact:** None (domain layer only)
**API impact:** None
**Security impact:** State machine prevents invalid transitions; no credential exposure in entity
**Acceptance criteria:**
- Entity enforces valid state transitions (invalid → exception)
- Credentials (`secretRef`, `certStorageKey`) are stored as references (strings), never as raw secrets
- Unit tests cover all state machine transitions
**Required tests:** Unit tests for all state transitions; invariant violations
**Migration considerations:** None at this stage
**Rollback or mitigation:** No production impact; domain-only change
**Risk:** Low

---

### TASK-F2-003: Database migration for hacienda_connections table
**Status:** 🔵 Proposed
**Priority:** Critical
**Domain:** Companies
**Requirement:** REQ-F2-001
**Reason:** Persistent storage required for HaciendaConnection.
**Current problem:** No `hacienda_connections` table exists.
**Proposed change:** Create new Prisma migration adding `HaciendaEnvironment` enum, `HaciendaConnectionStatus` enum, and `hacienda_connections` table (1:1 with companies; unique on `company_id`).
**Affected files:**
- `prisma/schema.prisma` (new model + enums)
- `prisma/migrations/2025XXXXXXXXXXX_hacienda_connection/migration.sql` (new)
**Dependencies:** TASK-F2-002 (schema must match domain model)
**Database impact:** New table + 2 new ENUMs. No modifications to existing tables. Additive; backward-compatible.
**API impact:** None
**Container impact:** None
**Security impact:** `secret_ref` and `cert_storage_key` store only reference paths — never credentials
**Acceptance criteria:**
- Migration applies cleanly on a fresh database
- Migration applies cleanly on a database with existing Fase 0/1 data
- `company_id` uniqueness enforced at DB level
- All FK constraints intact
**Required tests:** Verify migration applies in CI unit test job
**Migration considerations:** Additive only — safe to apply without downtime
**Rollback or mitigation:** Rollback migration drops new table and ENUMs without affecting existing data
**Risk:** Low

---

### TASK-F2-004: CreateHaciendaConnection use case
**Status:** 🔵 Proposed
**Priority:** Critical
**Domain:** Companies
**Requirement:** REQ-F2-001, REQ-F2-008
**Reason:** Primary write path for Fase 2.
**Current problem:** No use case exists.
**Proposed change:**
- `CreateHaciendaConnectionCommand` (companyId, tenantId, environment, credentials payload)
- `CreateHaciendaConnectionHandler` validates company ownership; stores credential reference via `SecretProviderPort`; persists `HaciendaConnection` with `CONFIGURED` status
- Credentials (raw secret) never persisted in DB; only SSM reference path stored
- Emit `FISCAL_AUDIT` audit event
**Affected files:**
- `src/modules/companies/application/use-cases/create-hacienda-connection/` (new)
**Dependencies:** TASK-F2-002, TASK-F2-003
**Database impact:** Write to `hacienda_connections`
**API impact:** None (wired in TASK-F2-007)
**Security impact:** Critical — raw credentials must never reach the repository
**Acceptance criteria:**
- Handler stores SSM reference, not raw credential
- Audit event emitted with `FISCAL_AUDIT` class
- Cross-tenant company access raises authorization exception
- Unit tests with mocked ports pass
**Required tests:** Unit test with mock repository; mock SecretProviderPort; verify no credential in DB write
**Migration considerations:** None
**Rollback or mitigation:** No impact on existing data
**Risk:** Medium (credential handling is security-sensitive)

---

### TASK-F2-005: GetHaciendaConnectionStatus use case
**Status:** 🔵 Proposed
**Priority:** High
**Domain:** Companies
**Requirement:** REQ-F2-009
**Reason:** Clients need to query connection status without receiving credentials.
**Current problem:** No use case exists.
**Proposed change:**
- `GetHaciendaConnectionStatusQuery` (companyId, tenantId)
- `GetHaciendaConnectionStatusHandler` fetches connection; returns status projection (no credentials, no secretRef, no certStorageKey)
**Affected files:**
- `src/modules/companies/application/use-cases/get-hacienda-connection-status/` (new)
**Dependencies:** TASK-F2-002, TASK-F2-003
**Database impact:** Read from `hacienda_connections`
**Security impact:** Response DTO must never include secretRef, certStorageKey, or any credential data
**Acceptance criteria:**
- Response includes: companyId, environment, status, lastVerifiedAt only
- No credential fields in response
- Cross-tenant access raises exception
**Required tests:** Unit test; E2E test verifying credential fields absent
**Risk:** Low

---

### TASK-F2-006: VerifyHaciendaConnection use case
**Status:** 🔵 Proposed
**Priority:** High
**Domain:** Companies, Hacienda Integration
**Requirement:** REQ-F2-010
**Reason:** Companies must verify credentials work before Fase 3 document submission.
**Current problem:** No use case exists; HaciendaPort has no authenticated methods.
**Proposed change:**
- `VerifyHaciendaConnectionCommand` (companyId, tenantId)
- Handler retrieves credential from SSM; calls Hacienda test endpoint (to be determined — OD-004)
- Updates `HaciendaConnection` status to `VERIFIED` on success
- Emits `FISCAL_AUDIT` audit event
**Affected files:**
- `src/modules/companies/application/use-cases/verify-hacienda-connection/` (new)
**Dependencies:** TASK-F2-002, TASK-F2-004, OD-004 (Hacienda OAuth mechanism)
**Database impact:** Update `hacienda_connections.status` + `last_verified_at`
**API impact:** Requires clarification on Hacienda sandbox test endpoint
**Security impact:** Credentials retrieved from SSM and used in memory only; never logged
**Acceptance criteria:**
- Status transitions to VERIFIED on Hacienda success
- Status remains CONFIGURED on Hacienda failure; error captured in audit log
- Credentials not logged
**Required tests:** Unit test with mock HaciendaAuthPort; E2E with mock
**Migration considerations:** Requires OD-004 resolution
**Risk:** High (dependency on Hacienda OAuth design — OD-004 must be resolved first)

---

### TASK-F2-007: HaciendaConnection HTTP controller and DTOs
**Status:** 🔵 Proposed
**Priority:** High
**Domain:** Companies
**Requirement:** REQ-F2-008, REQ-F2-009, REQ-F2-010
**Reason:** Expose Fase 2 use cases via REST API.
**Current problem:** No controller or DTOs exist.
**Proposed change:**
- `HaciendaConnectionController` with JWT guard + tenant authorization
- `CreateHaciendaConnectionRequestDto` (environment, credentials fields — never returned)
- `HaciendaConnectionStatusResponseDto` (status, environment, lastVerifiedAt only)
- Routes: POST, GET status, POST test, DELETE
**Affected files:**
- `src/modules/companies/infrastructure/http/hacienda-connection.controller.ts` (new)
- `src/modules/companies/infrastructure/http/dtos/` (new DTOs)
**Dependencies:** TASK-F2-004, TASK-F2-005, TASK-F2-006
**API impact:** New routes under `/api/v1/companies/{id}/hacienda-connection`; no changes to existing routes
**Security impact:** Request DTO validation (class-validator); response DTO explicitly excludes credential fields
**Acceptance criteria:**
- All new routes require valid JWT
- Response never includes credential fields
- Input validation rejects malformed requests
**Required tests:** E2E tests for each route; security: credentials absent from response
**Risk:** Low

---

### TASK-F2-008: Credential storage via SecretsModule
**Status:** 🔵 Proposed
**Priority:** Critical
**Domain:** Infrastructure — Secrets, Companies
**Requirement:** REQ-F2-003, REQ-F2-007
**Reason:** Hacienda credentials must be encrypted at rest via AWS SSM Parameter Store (production) or env (dev).
**Current problem:** `SecretsModule` supports reading secrets but not writing them. A write capability is needed for storing company Hacienda credentials.
**Proposed change:**
- Extend `SecretProviderPort` with a `setSecret(path: string, value: string): Promise<void>` method
- Implement `setSecret` in `EnvSecretProvider` (in-memory or .env file) and `AwsParameterStoreSecretProvider` (SSM `putParameter`)
- `CreateHaciendaConnectionHandler` uses `SecretProviderPort.setSecret()` to store credentials
**Affected files:**
- `src/infrastructure/secrets/ports/secret-provider.port.ts` (extend interface)
- `src/infrastructure/secrets/adapters/env-secret-provider.adapter.ts` (implement setSecret)
- `src/infrastructure/secrets/adapters/aws-parameter-store.adapter.ts` (implement setSecret via SSM)
**Dependencies:** TASK-F2-004
**Security impact:** Critical — SSM encryption at rest; IAM least-privilege for SSM write access
**Acceptance criteria:**
- `setSecret` stores value encrypted in SSM (SecureString parameter type)
- `getSecret` retrieves decrypted value
- Credentials never logged
**Required tests:** Unit tests for both adapters with mocked AWS SDK
**Risk:** Medium (AWS IAM permissions must be configured; SSM path conventions must be defined)

---

### TASK-F2-009: Fase 2 unit, integration and E2E tests
**Status:** 🔵 Proposed
**Priority:** High
**Domain:** Companies, Hacienda Integration
**Requirement:** All REQ-F2-*
**Reason:** Full test coverage required before any Fase 2 feature is production-ready.
**Current problem:** No Fase 2 tests exist.
**Proposed change:**
- Unit tests for all new domain entities, value objects, and use-case handlers (mocked dependencies)
- Integration test for `PrismaHaciendaConnectionRepository`
- E2E test suite `test/e2e/fase2/hacienda-connection.e2e-spec.ts`
- Security assertion test: verify no credential fields in any API response
**Affected files:**
- `src/modules/companies/domain/__tests__/hacienda-connection.entity.spec.ts` (new)
- `src/modules/companies/application/__tests__/` (new — one per use case)
- `src/modules/companies/infrastructure/persistence/__tests__/` (new)
- `test/e2e/fase2/hacienda-connection.e2e-spec.ts` (new)
**Dependencies:** TASK-F2-002 through TASK-F2-008
**Acceptance criteria:**
- All unit tests pass
- E2E tests cover: create, get status, verify, cross-tenant rejection
- No credential fields present in any E2E response assertion
- All existing Fase 0 + Fase 1 tests continue to pass
**Required tests:** (is the test task)
**Risk:** Low

---

## Deferred Items

### DEFER-001: Worker job handler implementation
**Status:** 🟡 Deferred to Fase 3
**Priority:** High
**Domain:** Infrastructure — Queue
**Reason:** Async document processing is a Fase 3 requirement. Worker infrastructure exists; handlers will be registered when document submission is implemented.
**Current state:** Worker creates application context but registers no handlers.

---

### DEFER-002: XmlSigner adapter implementation
**Status:** 🟡 Deferred to Fase 3
**Priority:** High
**Domain:** Infrastructure — Signing
**Reason:** XML signing is required for Fase 3 (document submission to Hacienda).
**Current state:** `XmlSignerPort` interface defined; no adapter implemented.

---

### DEFER-003: Refresh token cleanup job
**Status:** 🟡 Deferred — timing TBD
**Priority:** Low
**Domain:** Identity
**Reason:** Expired tokens accumulate but are harmless. Cleanup improves database hygiene.
**Current state:** No purge mechanism exists.

---

### DEFER-004: Rate limiter persistence (multi-instance)
**Status:** 🟡 Deferred — requires ADR revision
**Priority:** Medium
**Domain:** Infrastructure
**Reason:** In-memory throttler acceptable for single-instance. Multi-instance scaling requires shared state (conflicts with ADR-003 no-Redis rule).
**Current state:** In-memory throttler; state lost on restart.

---

### DEFER-005: Domain event bus
**Status:** 🟡 Deferred to Fase 4
**Priority:** Medium
**Domain:** Shared
**Reason:** No event consumers exist yet. `TenantCreated` event is defined but not published or consumed.
**Current state:** Event defined; no bus wired.

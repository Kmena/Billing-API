# Architecture

> **Synchronized:** post `pre-fase-2-hardening`.
> This document describes only the architecture currently implemented or actively governing the system through explicit decisions. Future-state proposals belong in `docs/action-plan.md` and `docs/future-architecture.md`.

---

## 1. Purpose and Scope

This document is the authoritative record of:
- The architectural style and module boundaries **currently implemented**.
- The dependency rules **currently enforced**.
- The active decisions that **currently govern** the system.
- Known limitations that affect the current architecture.

It does not document proposed future states, aspirational bounded contexts, or unapproved changes.

---

## 2. Current Active Architecture Summary

Billing is an **API-first modular monolith** built with NestJS / TypeScript / Prisma / PostgreSQL.

The architectural style is **hexagonal (ports and adapters)**, applied incrementally per module. The domain layer is isolated from infrastructure. Application use cases coordinate domain objects through port interfaces. Infrastructure adapters implement those ports.

Two separate runtime processes are built from the same codebase:
- **API process** (`api.main.ts`) — serves HTTP, manages CORS, authentication, rate limiting, Swagger, and global interceptors.
- **Worker process** (`worker.main.ts`) — bootstraps NestJS application context; no job handlers are implemented yet.

---

## 3. Active Architectural Style and Module Boundaries

**Style:** Modular monolith. No microservices.

**Hexagonal implementation per business module:**
```
modules/{name}/
  domain/           ← entities, value objects, exceptions, repository port interfaces
  application/      ← use-case handlers (single execute() method, inject ports only)
  infrastructure/
    http/           ← controllers + DTOs (input adapters)
    persistence/    ← Prisma repositories (output adapters)
    auth/           ← auth adapters (HaciendaConnection only)
```

**Cross-cutting infrastructure** (`src/infrastructure/`) is decoupled from all business modules:
- `config/` — Joi-validated typed ConfigModule
- `database/` — PrismaService, TenantAwarePrismaRepository
- `integrations/hacienda/` — HaciendaPort, adapters, HaciendaCircuitBreaker
- `queue/` — JobQueuePort, PgBossJobQueue, InMemoryJobQueue
- `secrets/` — SecretProviderPort, EnvSecretProvider, AwsSsmSecretProvider
- `signing/ports/` — XmlSignerPort (stub only, no adapter)
- `storage/` — StoragePort, LocalStorageAdapter, AwsS3StorageAdapter
- `tenant/` — TenantContext (AsyncLocalStorage)

**HTTP cross-cutting** (`src/api/`):
- `guards/` — JwtAuthGuard, ApiKeyAuthGuard, ScopeGuard, ApiKeyThrottlerGuard
- `filters/` — GlobalExceptionFilter
- `interceptors/` — CorrelationIdInterceptor, TenantContextInterceptor, AuditInterceptor
- `strategies/` — JwtStrategy (passport-jwt)
- `decorators/` — @Scopes()
- `health/` — HealthController (outside `/api/v1` prefix)

---

## 4. Current Domain Map

| Domain / Module | Classification | Responsibility | Code Location |
|---|---|---|---|
| Identity | Core-supporting | Tenant + user lifecycle, JWT auth, refresh tokens | `src/modules/identity` |
| Companies | Core | Company aggregate, identification validation, Hacienda verification metadata | `src/modules/companies` |
| API Keys | Core-supporting | External credential lifecycle, scopes, revocation, authentication | `src/modules/api-keys` |
| Taxpayers | Supporting | Public Hacienda taxpayer lookup | `src/modules/taxpayers` |
| CABYS | Supporting | Public CABYS catalogue lookup/search | `src/modules/cabys` |
| Exchange Rates | Supporting | Public Hacienda exchange rate lookup | `src/modules/exchange-rates` |
| Hacienda Connection | Core-enabling | Per-company Hacienda OIDC credential management, connection lifecycle | `src/modules/hacienda-connection` |
| Audit | Generic-supporting | Append-only audit log, event classification, retention tagging | `src/modules/audit` |
| Hacienda Integration | Generic-supporting | Outbound Hacienda API calls, resilience, mocking, caching | `src/infrastructure/integrations/hacienda` |
| Shared Infrastructure | Generic | Config, DB, queue, secrets, signing (stub), storage, tenant context, health | `src/infrastructure`, `src/api` |
| Shared Domain Primitives | Generic | AggregateRoot, BaseEntity, ValueObject, DomainEvent, DomainException | `src/modules/shared/domain` |

---

## 5. Current Runtime Components and Responsibilities

| Component | Entrypoint | Responsibility |
|---|---|---|
| billing-api | `dist/bootstrap/api.main.js` | HTTP API, validation, guards, interceptors, CORS, Swagger (non-prod), health checks |
| billing-worker | `dist/bootstrap/worker.main.js` | Application context bootstrap; no job handlers yet |
| PostgreSQL 15 | External container | System of record; also pg-boss queue backend |
| LocalStack / S3 | External container | Document storage mock (dev/test); not yet used for fiscal documents |
| Hacienda Public API | `api.hacienda.go.cr` | Source for taxpayer, CABYS, exchange rate data (mock in dev/test) |
| Hacienda Private IDP | `idp.comprobanteselectronicos.go.cr` | OIDC token issuance for authenticated Hacienda operations (mock in dev/test) |

---

## 6. Current Dependency Rules

### Intended Direction
```
HTTP Controller (Input Adapter)
        ↓
  Use Case Handler (Application)
        ↓
  Domain Entity / Value Object
        ↓
  Repository Port / External Port (Output Port interface)
        ↑
  Prisma Repository / API Adapter / Auth Adapter (Output Adapter)
```

### Active Rules
1. **Domain layer must not import:** NestJS decorators, Prisma types, ORM models, controllers, cloud SDKs, messaging frameworks, HTTP clients, or infrastructure configuration.
2. **Application layer must not import:** Prisma types, HTTP request/response types, ORM models, or concrete adapter implementations.
3. **Controllers must not contain business logic.** Parse → call handler → map to DTO.
4. **Repositories must not make business decisions.** Query persistence only.
5. **Port interfaces use Symbol tokens** (e.g., `COMPANY_REPOSITORY`, `HACIENDA_PORT`) — not class references.

### Active Deviations (Accepted Limitations)
- Some application use-case handlers import NestJS `Logger` and `Injectable` — accepted; these are non-behavioral annotations.
- `CreateCompanyHandler` imports `HaciendaUnavailableException` from the infrastructure layer to distinguish unavailability from other errors. This is a known boundary softness (tracked in TASK-010 as Proposed).
- `HaciendaConnectionController` imports domain entity type `HaciendaConnection` for internal mapping — acceptable; the domain entity is not exposed directly in the response.

---

## 7. Current Database Ownership and Transaction Boundaries

- **Schema:** Centralized in `prisma/schema.prisma`. All migrations applied via Prisma migrate.
- **Module ownership:** Each module's Prisma repository owns the mapping between its domain entities and Prisma models.
- **Cross-module data access:** Modules never read another module's tables directly. Use cases access other modules through exported handlers (e.g., `ConfigureConnectionHandler` injects `GetCompanyHandler`).
- **Tenant-scoped tables:** All tables except `tenants` include `tenant_id` with a foreign key. `TenantAwarePrismaRepository.applyTenantFilter()` enforces this consistently.
- **Transaction boundaries:** Currently implicit — each use case executes one or more repository calls sequentially without explicit Prisma transactions. Multi-step operations (e.g., configure + audit) are not atomic (known limitation).
- **Audit log:** Write-once via `AuditService.record()`. No UPDATE or DELETE exposed in `PrismaAuditLogRepository`. DB-level enforcement is absent (AUD-DB01).

---

## 8. Current API and Integration Contracts

### HTTP API
- **Prefix:** `/api/v1` for all business endpoints.
- **Unprefixed:** `/health`, `/health/ready`, `/health/live`.
- **Auth schemes:** Bearer JWT (management), `X-API-Key` (fiscal query endpoints).
- **Rate limiting:** Layer A — 100 req/min per API key (ThrottlerModule, `api` throttler). Layer B — 10 req/min per IP on `/auth/login` and `/auth/refresh` (`auth` throttler).
- **Standard error envelope:** `{ error: { code, message, correlationId, timestamp, details? } }`
- **Swagger:** Available at `/api/docs` when `NODE_ENV !== 'production'`.

### Hacienda Public API Contract
- All outbound calls go through `HaciendaPort`. Adapters (real/mock) implement the port.
- **Billing-owned field names only** (BR-012): no Hacienda Spanish field names (`nombre`, `venta`, `compra`, `codigo`, `impuesto`, `identificacion`) appear outside the adapter.
- Not-found detection via `response.data.code === 404` in adapter (BR-014) — not via HTTP status.

### Hacienda Auth Contract
- All auth operations go through `HaciendaAuthPort`. Adapters selected via `USE_REAL_HACIENDA` flag.
- Raw access tokens are never persisted or returned to API clients.
- `secretReference` stored in `hacienda_connections` is a pointer to credentials in `SecretProviderPort`, not the credentials themselves.

---

## 9. Current Security Boundaries

- **Passwords:** argon2id (never stored in plaintext)
- **Refresh tokens:** SHA-256 hash stored; raw token returned once, never retrievable
- **API key secrets:** argon2id hash stored; raw key returned once at creation, never retrievable
- **JWT secret:** resolved via `SecretProviderPort` — not hardcoded in code
- **Hacienda credentials:** stored via `SecretProviderPort`; only `secretReference` string in DB; never in API responses
- **CORS production guard:** `CORS_ALLOWED_ORIGINS` must be an explicit non-wildcard origin in `production`/`staging`; app refuses to start otherwise (Joi fatal validation, pre-fase-2-hardening)
- **Tenant isolation:** `AsyncLocalStorage` + `TenantAwarePrismaRepository.applyTenantFilter()` on every tenant-scoped query
- **Scope enforcement:** `ScopeGuard` — AND semantics, fail-closed; no scope bypass possible
- **No `helmet` middleware** (AUD-SEC01 — open)
- **Cross-tenant read risk** on `GET /tenants/:id` (AUD-API01 — open)
- **Swagger excluded from production:** no API schema exposure in production environments

---

## 10. Current Container and Deployment Architecture

### Dockerfile
- Multi-stage (deps → builder → runner), Node 20 Alpine
- `runner` stage: non-root user `billing:billing` (UID 1001), `ENV NODE_ENV=production`, `EXPOSE 3000`
- `HEALTHCHECK`: `wget -qO- http://localhost:3000/health`
- Default `CMD`: `node dist/bootstrap/api.main.js` (override to `worker.main.js` for worker)

### Docker Compose (development)
- `postgres:15-alpine` with `billing_dev` database + health check
- `localstack:3` with S3 only + health check
- `billing-api` and `billing-worker` sharing the same image, different CMD
- All circuit breaker parameters overridable via shell variables
- `CORS_ALLOWED_ORIGINS` set via shell variable substitution (default: `http://localhost:3000`)

### CI (GitHub Actions)
- **Node:** 20, npm cache, `npm ci`
- **Gates:** lint → typecheck → [test ‖ build] → e2e (all gates include `npx prisma generate`)
- **No deployment gate** (AUD-D02)

---

## 11. Current Testing Strategy

### Unit Tests
- 163 tests, 24 suites under `src/`
- Cover: domain invariants, value objects, use-case handlers (mocked ports), guards, interceptors, filter, config Joi schema, Hacienda adapters, circuit breaker state machine, tenant context, secret providers, queue adapters

### E2E Tests
- 7 suites under `test/e2e/` against real PostgreSQL
- Use `test/helpers/test-factories.ts` for fixture setup
- Validate: full authentication flows, API key lifecycle, scope enforcement, Hacienda public endpoints (mock), Hacienda connection lifecycle

### Known Test Gaps
- No tests for worker job handlers
- No XmlSignerPort adapter tests
- No fiscal document domain tests (not implemented)
- No contract/schema tests for Hacienda API responses

---

## 12. Active Architectural Decisions

| Decision | Description | Status |
|---|---|---|
| DEC-001 | API key scopes use AND semantics (all declared scopes must be present) | Active |
| DEC-002 | ScopeGuard is fail-closed: no API key present → deny if scopes declared | Active |
| DEC-003 / FR-015 | Company creation must not fail due to Hacienda unavailability (best-effort verification) | Active |
| DEC-004 | Hacienda verification applies to all identification types, not just JURIDICA | Active |
| ADR-003 | No Redis — queue backend is pg-boss on the same PostgreSQL instance | Active |
| ADR-004 | HaciendaPort abstracts all Hacienda calls; Billing-owned field names only (BR-012) | Active |
| ADR-005 | XmlSignerPort contract defined; implementation deferred pending technical spike | Active (stub) |
| ADR-009 | AuditLog has EventClass (FISCAL_AUDIT / TECHNICAL / SECURITY) for retention classification | Active |
| — | Modular monolith before microservices | Active |
| — | API prefix `/api/v1`; health endpoints unprefixed | Active |
| — | Swagger disabled in production | Active |
| — | JWT secret resolved via SecretProviderPort, not hardcoded | Active |
| — | CORS_ALLOWED_ORIGINS must be explicit (non-wildcard) in production/staging (Joi fatal) | Active (pre-fase-2-hardening) |
| — | HaciendaCircuitBreaker parameters fully configurable via ConfigService (7 env vars) | Active (pre-fase-2-hardening) |
| — | config.validation-schema.ts is a standalone exported module (testable without NestJS) | Active (pre-fase-2-hardening) |

---

## 13. Known Architectural Limitations

1. **No explicit transaction management:** Multi-step use cases (e.g., save + audit) are not wrapped in Prisma transactions. A failure after the first write could leave partial state.
2. **AuditInterceptor eventClass hardcoded to TECHNICAL:** All HTTP events are recorded as `TECHNICAL`. Business-specific events (e.g., API key creation = SECURITY) emit audit records via direct `AuditService.record()` calls in use cases, not through the interceptor.
3. **HaciendaTokenCache is single-process:** In-memory cache does not survive process restart or horizontal scaling. Accepted for current single-instance deployment.
4. **Domain events not dispatched:** `TenantCreated` is defined but never published to any event bus. No event-driven integration exists.
5. **Worker is a shell:** `worker.main.ts` exists and boots but processes no jobs. PgBoss is initialized but no handlers are attached.
6. **No helmet middleware:** HTTP security headers are absent. Mitigated partially by CORS enforcement.
7. **Cross-tenant read risk on GET /tenants/:id:** No ownership check validates that the requested tenant ID matches the authenticated user's tenant.
8. **Application layer framework imports:** Some use-case handlers import NestJS `Logger` — acceptable as non-behavioral. `CreateCompanyHandler` imports `HaciendaUnavailableException` from infrastructure — a boundary softness.

---

## 14. Open Decisions Requiring Clarification

1. **AUD-API01 fix scope:** Should `GET /tenants/:id` simply validate `id === req.user.tenantId`, or is there a future multi-tenant admin role that needs cross-tenant reads? Fix strategy depends on the answer.
2. **AUD-DB01 approach:** DB-level append-only enforcement (PostgreSQL trigger vs. append-only role vs. RLS). Requires DBA/infra decision before implementation.
3. **AUD-SEC02 resolution:** Should `HaciendaTokenCache` be backed by Redis, SSM, or PostgreSQL for multi-instance deployments? Depends on deployment topology decision.
4. **XmlSignerPort technical spike (ADR-005):** Which XAdES-EPES library? `xmldsigjs`, `xades4j` (Java, via subprocess), `signpdf`? Spike results must feed `specs/fase-2-2-fiscal-document-core`.
5. **Worker job handler design:** What jobs should the worker process? Design decisions required before `specs/fase-2-2-fiscal-document-core` implementation begins.
6. **CD pipeline:** Is deployment managed externally or intentionally deferred? Repository contains no deployment step.

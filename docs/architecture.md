# Architecture

> **Document owner:** hdd-architecture-agent-2c1857
> **Last updated:** 2025-07-13 (post Fase 0 implementation)
> **Reflects:** Fase 0: Foundation — all 19 tasks completed and verified

This document describes only the architecture currently in effect and active
architectural decisions that govern the system now.
Future-state target architecture belongs in `docs/future-architecture.md` and
`docs/action-plan.md`.

---

## 1. Purpose and Scope

This document captures the active architecture of the **Billing** platform
after completion of Fase 0: Foundation.

The system is a multi-tenant SaaS platform for Costa Rica electronic invoicing
(Comprobantes Electrónicos per Hacienda / MH-DGT Versión 4.3).

**In scope of this document:**
- Modular structure and layer boundaries as implemented.
- Active ports and adapters.
- Active database ownership and access patterns.
- Current API and integration contracts.
- Active security and tenant-isolation mechanisms.
- Container and deployment architecture.
- Active architectural decisions (ADRs) that constrain all future work.

**Out of scope:**
- Future domains and modules not yet implemented.
- Hacienda invoice submission (Fase 2+).
- XML signing (Fase 3+).
- Event bus design (undecided).
- Billing/subscription logic (undecided phase).

---

## 2. Current Active Architecture Summary

**Architectural style:** Modular Monolith with Hexagonal Architecture (Ports & Adapters).

| Property | Value |
|---|---|
| Style | Modular Monolith + Hexagonal (Ports & Adapters) |
| Entry points | `api.main.ts` (HTTP) + `worker.main.ts` (background jobs, stub) |
| Framework | NestJS v10 |
| Language | TypeScript 5.5, strict mode |
| Database | PostgreSQL 15+ via Prisma v5.17 (single instance) |
| Queue | pg-boss v10 on same PostgreSQL instance (no Redis) |
| Auth | JWT HS256 (users) + API Key argon2id (systems) |
| Storage | LocalStorageAdapter / S3StorageAdapter (runtime switch) |
| Secrets | EnvSecretProvider / AwsParameterStoreSecretProvider (runtime switch) |
| Hashing | argon2id for all passwords and API key secrets |

The system currently exposes a REST API. No event bus, no message broker,
no microservice boundaries exist.

---

## 3. Active Architectural Style and Module Boundaries

### 3.1 Layer boundaries

The hexagonal (Ports & Adapters) model is applied consistently within each
NestJS module. The layers, from innermost to outermost:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Domain (modules/*/domain/)                                          │
│  ─ Pure TypeScript: no NestJS, no Prisma, no HTTP references        │
│  ─ Entities · Aggregates · Value Objects · Domain Events            │
│  ─ Domain Exceptions · Repository port interfaces                   │
├──────────────────────────────────────────────────────────────────────┤
│  Application (modules/*/application/)                                │
│  ─ NestJS @Injectable handlers only (no controllers, no adapters)   │
│  ─ Orchestrates domain and calls ports                               │
│  ─ Commands · Queries · Use-case handlers                           │
├──────────────────────────────────────────────────────────────────────┤
│  Infrastructure Adapters — Outbound (modules/*/infrastructure/ +     │
│    src/infrastructure/)                                              │
│  ─ Prisma repositories (implement repository ports)                 │
│  ─ Queue, storage, secrets, Hacienda adapters                       │
├──────────────────────────────────────────────────────────────────────┤
│  Infrastructure Adapters — Inbound (src/api/)                       │
│  ─ NestJS controllers · Guards · Interceptors · Filters             │
│  ─ HTTP DTOs (request/response only, never passed into domain)       │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Module inventory

| NestJS Module | Location | Global | Imported in AppModule |
|---|---|---|---|
| `ConfigModule` | `src/infrastructure/config/` | Yes | Yes |
| `DatabaseModule` | `src/infrastructure/database/` | Yes | Yes |
| `SecretsModule` | `src/infrastructure/secrets/` | Yes | Yes |
| `AuditModule` | `src/modules/audit/` | Yes | Yes |
| `IdentityModule` | `src/modules/identity/` | No | Yes |
| `CompaniesModule` | `src/modules/companies/` | No | Yes |
| `ApiKeysModule` | `src/modules/api-keys/` | No | Yes |
| `TerminusModule` | (external `@nestjs/terminus`) | No | Yes |
| `StorageModule` | `src/infrastructure/storage/` | Yes | **No** |
| `QueueModule` | `src/infrastructure/queue/` | No | **No** |
| `HaciendaModule` | `src/infrastructure/integrations/hacienda/` | No | **No** |
| `TenantModule` | `src/infrastructure/tenant/` | No | **No** (stub) |
| `SharedModule` | `src/modules/shared/` | No | **No** (domain kernel only) |

`StorageModule`, `QueueModule`, and `HaciendaModule` are implemented and tested
but not yet wired into the application. They are scaffolding for Fase 1+.

### 3.3 Dependency direction (active constraint)

```
HTTP Adapter (src/api/)
       ↓
Application Handler (use case)
       ↓
Domain (entities, VOs, events, ports)
       ↓  (port interface)
Output Adapter (Prisma repos, storage, queue, etc.)
```

The domain layer has zero dependencies on NestJS, Prisma, or any infrastructure library.
This constraint is enforced by an ESLint `no-restricted-imports` rule targeting
`src/modules/*/domain/**/*.ts`.

---

## 4. Current Domain Map

### 4.1 Active bounded contexts

| Bounded Context | Status | Module | Core/Supporting/Generic |
|---|---|---|---|
| **Identity** | Active | `IdentityModule` | Core |
| **Tenancy** | Active (embedded in Identity) | `IdentityModule` | Core |
| **Companies** | Active | `CompaniesModule` | Core |
| **API Access** | Active | `ApiKeysModule` | Supporting |
| **Audit** | Active | `AuditModule` | Generic |

### 4.2 Domain model summary

#### Identity Bounded Context

| Concept | Type | Aggregate | Key invariants |
|---|---|---|---|
| `Tenant` | Aggregate Root | Tenant | Slug immutable after creation; status transitions ACTIVE↔SUSPENDED |
| `User` | Aggregate Root | User | Email unique per tenant; password never exposed |
| `TenantName` | Value Object | — | 1–255 chars |
| `TenantSlug` | Value Object | — | Kebab-case, 3–60 chars, globally unique |
| `Email` | Value Object | — | Lowercase, RFC-format |
| `TenantCreatedEvent` | Domain Event | Tenant | Raised on Tenant.create(); not yet dispatched |

#### Companies Bounded Context

| Concept | Type | Aggregate | Key invariants |
|---|---|---|---|
| `Company` | Aggregate Root | Company | Identification unique per tenant; identification format valid per CR type |
| `IdentificationType` | Value Object | — | FISICA, JURIDICA, DIMEX, NITE |
| `IdentificationNumber` | Value Object | — | Digits only; length validated by type |

#### API Access Bounded Context

| Concept | Type | Aggregate | Key invariants |
|---|---|---|---|
| `ApiKey` | Aggregate Root | ApiKey | Secret hashed at creation; revoke is idempotent |

#### Audit (Generic)

| Concept | Type | Notes |
|---|---|---|
| `AuditLog` | Entity (immutable) | Append-only; no update/delete at port interface level |

### 4.3 Shared Domain Kernel

Not a bounded context. Pure base classes used by all modules:
`BaseEntity`, `AggregateRoot`, `ValueObject`, `DomainEvent`, `DomainException`,
`Repository<T>`.

---

## 5. Current Runtime Components and Responsibilities

### 5.1 API process (`api.main.ts`)

| Component | Responsibility |
|---|---|
| `CorrelationIdInterceptor` | Assigns or propagates `X-Correlation-ID` on every request/response |
| `TenantContextInterceptor` | Wraps handler in `TenantContext.run(tenantId)` using AsyncLocalStorage |
| `AuditInterceptor` | Fire-and-forget audit log entry on every HTTP interaction |
| `GlobalExceptionFilter` | Maps `DomainException` to structured HTTP error; prevents stack trace leak |
| `ValidationPipe` | Validates/transforms DTOs (whitelist + forbidNonWhitelisted) |
| `JwtAuthGuard` | Validates Bearer JWT; populates `request.user` |
| `ApiKeyAuthGuard` | Validates `X-API-Key`; populates `request.apiKey` + `request.user.tenantId` |
| `JwtStrategy` | Passport JWT strategy; reads secret from `SecretProvider` |
| `HealthController` | Liveness (`/health`, `/health/live`) and readiness (`/health/ready`) |
| `AuthController` | Login and token refresh endpoints |
| `TenantController` | Create and get tenant endpoints |
| `CompanyController` | Create and get company endpoints |
| `ApiKeysController` | Create, list, revoke API key endpoints |

### 5.2 Worker process (`worker.main.ts`)

| Component | Responsibility |
|---|---|
| AppModule context | Starts NestJS application context without HTTP server |
| pg-boss (not started) | Infrastructure ready; no handlers registered |

### 5.3 Cross-cutting infrastructure

| Component | Responsibility |
|---|---|
| `TenantContext` (AsyncLocalStorage) | Propagates tenantId across async call stack |
| `TenantAwarePrismaRepository` | Base class enforcing `WHERE tenant_id = $tenantId` on all queries |
| `PrismaService` | Database client; wraps `PrismaClient` |
| `AuditService` | Facade for fire-and-forget audit logging |
| `SecretProvider` (env/SSM) | Abstracts secret retrieval; active in `JwtStrategy` |

---

## 6. Current Dependency Rules

### 6.1 Active rules (enforced by ESLint)

| Rule | Enforcement |
|---|---|
| Domain layer cannot import `@prisma/client`, `@nestjs/*`, `pg-boss`, or `axios` | ESLint `no-restricted-imports` on `src/modules/*/domain/**/*.ts` |
| General code cannot import `@prisma/client` (except infrastructure and tests) | ESLint `no-restricted-imports` with override for `src/infrastructure/**`, `src/modules/*/infrastructure/**`, `prisma/**`, `test/**` |
| No circular imports | ESLint `import/no-cycle` |
| No `console.*` statements | ESLint `no-console` (only `prisma/seed.ts` has overrides) |

### 6.2 Active dependency flows

```
AuthController
  → LoginHandler
    → IUserRepository ← PrismaUserRepository
    → IRefreshTokenRepository ← PrismaRefreshTokenRepository
    → JwtService (NestJS)

TenantController
  → CreateTenantHandler
    → ITenantRepository ← PrismaTenantRepository
    → CreateUserHandler
      → IUserRepository ← PrismaUserRepository

CompanyController
  → CreateCompanyHandler
    → ICompanyRepository ← PrismaCompanyRepository (TenantAware)

ApiKeysController
  → CreateApiKeyHandler / ListApiKeysHandler / RevokeApiKeyHandler
    → IApiKeyRepository ← PrismaApiKeyRepository (TenantAware)

ApiKeyAuthGuard
  → ValidateApiKeyHandler
    → IApiKeyRepository ← PrismaApiKeyRepository (TenantAware)

AuditInterceptor
  → AuditService
    → IAuditLogRepository ← PrismaAuditLogRepository
```

### 6.3 Dependency violations (none critical)

No dependency-direction violations are currently known.
The ESLint rules enforce the primary constraint (domain isolation).

---

## 7. Current Database Ownership and Transaction Boundaries

### 7.1 Table ownership by module

| Table | Owning Module | Access Pattern |
|---|---|---|
| `tenants` | IdentityModule | CRUD by `PrismaTenantRepository` |
| `users` | IdentityModule | CRUD by `PrismaUserRepository` |
| `refresh_tokens` | IdentityModule | Insert/update by `PrismaRefreshTokenRepository` |
| `companies` | CompaniesModule | CRUD by `PrismaCompanyRepository` (tenant-aware) |
| `api_keys` | ApiKeysModule | CRUD by `PrismaApiKeyRepository` (tenant-aware) |
| `api_key_companies` | ApiKeysModule | Join table managed by `PrismaApiKeyRepository` |
| `audit_logs` | AuditModule | Insert-only by `PrismaAuditLogRepository` |

No module accesses another module's tables directly. Cross-module access
would require going through use-case handlers (not currently needed in Fase 0).

### 7.2 Transaction boundaries

- **Tenant + first user creation** (`CreateTenantHandler`): uses sequential Prisma calls
  (not wrapped in an explicit transaction). Partial failure risk exists but is low for Fase 0.
- **API key creation** (`CreateApiKeyHandler`): single `prisma.apiKey.create()`.
- **Login** (`LoginHandler`): two sequential writes (`userRepository.save()` + `refreshTokenRepository.save()`). Not in an explicit transaction.
- **Refresh token rotation** (`RefreshTokenHandler`): mark old token `used=true` + create
  new token — two writes, not in a single transaction. Concurrent refresh calls could produce
  a duplicate-token edge case (acceptable in Fase 0).
- **Audit logs**: always fire-and-forget; never part of a business transaction.

### 7.3 Multi-tenancy isolation mechanism

Row-level isolation via `tenant_id` column on all tenant-scoped tables.

**Implementation chain:**
1. `TenantContextInterceptor` establishes `TenantContext.run(tenantId, fn)` using
   Node.js `AsyncLocalStorage`.
2. `TenantAwarePrismaRepository.tenantId` getter reads from `TenantContext.getTenantId()`.
3. `applyTenantFilter(where)` merges `tenantId` into every Prisma `WHERE` clause.
4. Calling any repository method outside a tenant context throws
   `TenantContextNotSetException` immediately.

Cross-tenant data access through normal API flows is architecturally prevented
by this chain.

---

## 8. Current API and Integration Contracts

### 8.1 REST API

**Base URL:** `http://{host}:{port}/api/v1`
**Health:** `http://{host}:{port}/health`
**Swagger:** `http://{host}:{port}/api/docs` (non-production only)
**Global prefix exclusions:** `/health`, `/health/ready`, `/health/live`

#### Request conventions
- Content-Type: `application/json`
- Auth header: `Authorization: Bearer <jwt>` or `X-API-Key: bk_{env}_{prefix}_{secret}`
- Correlation: `X-Correlation-ID` (optional on request; always present on response)

#### Response conventions
- Success: HTTP 2xx with domain-specific response body.
- Error: HTTP 4xx/5xx with uniform structure:
  ```json
  {
    "error": {
      "code": "SCREAMING_SNAKE_CASE",
      "message": "string",
      "correlationId": "uuid",
      "timestamp": "ISO-8601",
      "details": {}
    }
  }
  ```

#### Endpoints

| Method | Path | Auth | Body / Params | Success |
|---|---|---|---|---|
| GET | `/health` | — | — | 200 `{ status: "ok" }` |
| GET | `/health/live` | — | — | 200 `{ status: "ok" }` |
| GET | `/health/ready` | — | — | 200 terminus health result |
| POST | `/api/v1/auth/login` | — | `{ tenantId, email, password }` | 200 `{ accessToken, refreshToken, expiresIn }` |
| POST | `/api/v1/auth/refresh` | — | `{ refreshToken }` | 200 `{ accessToken, refreshToken, expiresIn }` |
| POST | `/api/v1/tenants` | JWT | `{ name, slug? }` | 201 `{ id, name, slug, status, plan }` |
| GET | `/api/v1/tenants/:id` | JWT | — | 200 `{ id, name, slug, status, plan }` |
| POST | `/api/v1/companies` | JWT | `{ legalName, identificationType, identificationNumber, tradeName? }` | 201 company object |
| GET | `/api/v1/companies/:id` | JWT | — | 200 company object |
| POST | `/api/v1/api-keys` | JWT | `{ name, environment, scopes, expiresAt? }` | 201 `{ id, name, rawKey, ... }` |
| GET | `/api/v1/api-keys` | JWT | — | 200 `{ items: [...] }` |
| DELETE | `/api/v1/api-keys/:id` | JWT | — | 200 / 204 |

### 8.2 Integration ports (defined, not all active)

| Port | Symbol | Status | Active Adapter |
|---|---|---|---|
| `HaciendaPort` | `HACIENDA_PORT` | Defined; not wired in AppModule | `MockHaciendaAdapter` (when wired) |
| `JobQueuePort` | `JOB_QUEUE` | Defined; not wired in AppModule | `PgBossJobQueue` (when wired) |
| `StoragePort` | `STORAGE_PORT` | Defined; not wired in AppModule | `LocalStorageAdapter` or `S3StorageAdapter` (when wired) |
| `SecretProvider` | `SECRET_PROVIDER` | **Active** in SecretsModule | `EnvSecretProvider` or `AwsParameterStoreSecretProvider` |
| `IApiKeyRepository` | `API_KEY_REPOSITORY` | **Active** in ApiKeysModule | `PrismaApiKeyRepository` |
| `ITenantRepository` | `TENANT_REPOSITORY` | **Active** in IdentityModule | `PrismaTenantRepository` |
| `IUserRepository` | `USER_REPOSITORY` | **Active** in IdentityModule | `PrismaUserRepository` |
| `IRefreshTokenRepository` | `REFRESH_TOKEN_REPOSITORY` | **Active** in IdentityModule | `PrismaRefreshTokenRepository` |
| `ICompanyRepository` | `COMPANY_REPOSITORY` | **Active** in CompaniesModule | `PrismaCompanyRepository` |
| `IAuditLogRepository` | `AUDIT_LOG_REPOSITORY` | **Active** in AuditModule | `PrismaAuditLogRepository` |
| `XmlSignerPort` | `XML_SIGNER` | Interface only; no implementation | — |

---

## 9. Current Security Boundaries

### 9.1 Authentication boundary

```
Public (no auth)              Protected (JWT)              Protected (API Key)
─────────────────────         ──────────────────────       ───────────────────────
GET /health                   POST /api/v1/tenants         (no endpoints currently
GET /health/ready             GET  /api/v1/tenants/:id      restrict to API Key only;
GET /health/live              POST /api/v1/companies        ApiKeyAuthGuard exists
POST /api/v1/auth/login       GET  /api/v1/companies/:id    for future use)
POST /api/v1/auth/refresh     POST /api/v1/api-keys
                              GET  /api/v1/api-keys
                              DELETE /api/v1/api-keys/:id
```

### 9.2 Tenant isolation boundary

Every authenticated request is scoped to a single tenant via `TenantContext`.

```
JWT/ApiKey guard → TenantContextInterceptor → TenantContext.run(tenantId)
                                                    ↓
                                      TenantAwarePrismaRepository
                                        .applyTenantFilter()
                                            ↓
                                    WHERE tenant_id = $tenantId
                                    (enforced on every query)
```

### 9.3 Active security constraints

| Constraint | Mechanism | Location |
|---|---|---|
| argon2id for all secrets | `argon2.hash()` / `argon2.verify()` | `LoginHandler`, `CreateApiKeyHandler`, `ValidateApiKeyHandler`, `seed.ts` |
| No plaintext secrets stored | argon2id hash for passwords; argon2id for API key secrets | Domain entities |
| JWT HS256 minimum 32-char secret in production | Joi validation schema | `config.module.ts` |
| No stack trace in production error responses | `GlobalExceptionFilter` | `src/api/filters/` |
| No email enumeration on login | Constant-time 401 for any failure variant | `LoginHandler` |
| API key secret shown only once | Not persisted; returned only at creation | `CreateApiKeyHandler` |
| No domain → framework imports | ESLint `no-restricted-imports` | `.eslintrc.js` |
| Strict DTO validation | `ValidationPipe` (whitelist + forbidNonWhitelisted) | `api.main.ts` |

### 9.4 Active security gaps (not defects — known and deferred)

- No rate limiting on auth endpoints (deferred to Fase 1).
- No CORS policy (deferred; must resolve before browser client).
- No RBAC enforcement (role in JWT payload but not checked by any guard).
- No API key scope enforcement (scopes stored but not validated).

---

## 10. Current Container and Deployment Architecture

### 10.1 Container image

Multi-stage Dockerfile:

```
stage: deps        (node:20-alpine + python3/make/g++ for argon2)
       ↓
stage: builder     (prisma generate + npm run build + npm prune)
       ↓
stage: runner      (non-root user billing:1001, port 3000, healthcheck /health)
```

The same image is used for both `billing-api` and `billing-worker`.
The worker overrides CMD via `docker-compose.yml`.

### 10.2 Compose topology (development)

```
localstack:3 (port 4566) ──────┐
                               │
postgres:15 (port 5432) ───────┼── billing-api  (port 3000)
                               │
                               └── billing-worker (no port)
```

- No Redis in the topology (ADR-003).
- `billing-api` and `billing-worker` both built from the same Dockerfile `runner` stage.
- Volumes: `postgres_data`, `localstack_data` (persistent).

### 10.3 Environment differentiation

| Variable | Development | Production |
|---|---|---|
| `STORAGE_TYPE` | `local` | `s3` |
| `SECRET_PROVIDER` | `env` | `ssm` |
| `NODE_ENV` | `development` | `production` |
| `JWT_SECRET` | insecure dev default | min 32 chars, from SSM |
| Swagger UI | enabled | disabled |
| Error stack traces | included in logs | suppressed in HTTP response |

### 10.4 CI/CD

Implementation report (TASK-017) describes a 5-gate GitHub Actions pipeline:
`lint` → `typecheck` → `test` → `build` → `e2e`.
The CI workflow file is not present in the repository on disk at the time of
this documentation update; it may not have been committed.

---

## 11. Current Testing Strategy

### 11.1 Unit tests

- Location: `src/**/*.spec.ts`
- Runner: Jest v29 + ts-jest
- Configuration: `package.json` `jest` block (no separate jest.config.js)
- 14 suites, 95 tests — all passing

**Coverage scope:**
- Shared domain kernel (BaseEntity, AggregateRoot, ValueObject).
- Domain entities and value objects (Tenant, TenantSlug, User, Company identification, ApiKey).
- Application use-case handlers (CreateTenant, Login).
- Cross-cutting interceptors (CorrelationId).
- Infrastructure adapters (InMemoryJobQueue, MockHaciendaAdapter, EnvSecretProvider).
- AuditService (fire-and-forget behavior and error resilience).

**Coverage gaps:**
- Controllers (not unit-tested).
- `TenantAwarePrismaRepository` at unit level.
- Repository implementations (tested only through E2E).
- `RefreshTokenHandler` (no unit test).
- `TenantContextInterceptor` and `AuditInterceptor` (not unit-tested).
- `S3StorageAdapter`, `AwsParameterStoreSecretProvider`.

### 11.2 End-to-end tests

- Location: `test/e2e/fase0/*.e2e-spec.ts`
- Runner: Jest with `test/jest-e2e.json`
- Require: live PostgreSQL database
- 4 suites: health, auth, api-keys, tenant-isolation

### 11.3 Test isolation principle

Unit tests use mocked repositories. Domain logic is testable without
any database or network dependency. E2E tests use real database with
`test-factories.ts` helpers to create test fixtures.

---

## 12. Active Architectural Decisions

These ADRs are in effect now and constrain all future work.

### ADR-001 — Hexagonal Architecture (Ports & Adapters)
**Status:** Active.
**Decision:** Apply hexagonal architecture strictly within each NestJS module.
Domain must not import any framework, ORM, or infrastructure library.
Input adapters (controllers, guards, interceptors) must not contain business logic.
Output adapters (repositories, queue, storage) must implement domain port interfaces.

### ADR-002 — Row-level multi-tenant isolation via AsyncLocalStorage
**Status:** Active.
**Decision:** Every tenant-scoped table carries a `tenant_id` column.
`TenantContext` (AsyncLocalStorage) propagates the current tenant ID across
the async call stack without passing it through method signatures.
`TenantAwarePrismaRepository` reads from `TenantContext` and injects
`tenant_id` into every query. No tenant-scoped query may execute without
an active context.

### ADR-003 — No Redis; use pg-boss on the same PostgreSQL instance
**Status:** Active.
**Decision:** Message queuing is provided by `pg-boss` (PostgreSQL-backed job queue).
Redis is not introduced in Fase 0 or Fase 1. This decision keeps the infrastructure
footprint minimal (one database) and eliminates Redis operational complexity.
Revisit only if pg-boss becomes a bottleneck.

### ADR-004 — HaciendaPort abstraction
**Status:** Active.
**Decision:** All Hacienda API interactions go through `HaciendaPort` (a domain port
interface). The domain and application layers never reference `HaciendaApiAdapter`
or any HTTP library. The full port contract was defined in Fase 0 to prevent
retroactive contract changes. `MockHaciendaAdapter` is the active implementation
until the real adapter is implemented in Fase 1.

### ADR-005 — XAdES spike before XmlSigner implementation
**Status:** Active (pending spike).
**Decision:** No XAdES/XML signing implementation is committed until a technical spike
evaluates Node.js library options (xades, xmldsigjs, node-forge, etc.) and confirms
a viable approach. `XmlSignerPort` interface is defined; implementation is blocked
pending spike results. Target: Fase 3.

### ADR-006 — argon2id for all password and API key hashing
**Status:** Active.
**Decision:** argon2id (via the `argon2` npm package v0.40) is the only allowed
algorithm for hashing passwords and API key secrets. bcrypt, SHA-*,
MD5, and scrypt are prohibited. Refresh tokens may use SHA-256 (they are not
secret tokens; rotation provides security).

### ADR-007 — JWT access tokens (15 min) + refresh tokens (7 days) with rotation
**Status:** Active.
**Decision:** Access tokens are short-lived (15 minutes, configurable).
Refresh tokens are long-lived (7 days, configurable) and stored as SHA-256 hashes.
Each use of a refresh token marks it `used=true` and issues a new pair.
Reuse of a used token returns 401 (rotation detection).

### ADR-008 — API key format: `bk_{env}_{prefix8}_{secret32}`
**Status:** Active.
**Decision:** API keys follow the format `bk_{env}_{prefix8}_{secret32}` where:
- `env` is `live` or `test`
- `prefix8` is 8 hex chars stored in plaintext for O(1) database lookup
- `secret32` is 32 hex chars hashed with argon2id; never stored in plaintext

The raw key is returned only once at creation. It cannot be recovered.

### ADR-009 — Three-level audit retention classification (EventClass)
**Status:** Active.
**Decision:** All audit log entries carry an `EventClass` field:
- `FISCAL_AUDIT` — minimum 5 years retention (fiscal traceability).
- `TECHNICAL` — configurable retention (general operational events).
- `SECURITY` — configurable retention (security-related events).
The `EventClass` column was added from the initial migration to avoid future
schema changes that would affect audit records.

---

## 13. Known Architectural Limitations

| ID | Limitation | Impact | Plan |
|---|---|---|---|
| L-001 | `StorageModule`, `QueueModule`, `HaciendaModule` are not wired in `AppModule` | These capabilities are unavailable to business modules | Wire in Fase 1 when needed |
| L-002 | No RBAC enforcement | Any authenticated user can access any endpoint regardless of role | Implement `RolesGuard` in Fase 1 |
| L-003 | No API key scope enforcement | All valid API keys have full access to all tenant resources | Implement `ScopeGuard` in Fase 1 |
| L-004 | `TenantCreatedEvent` not dispatched | No event-driven downstream processing can react to tenant creation | Requires event bus decision and infrastructure |
| L-005 | `refresh_tokens` table grows unbounded | No cleanup of expired or used tokens | Requires background job (pg-boss) in Fase 1 |
| L-006 | `CreateTenantHandler` and `LoginHandler` use multiple sequential writes without a DB transaction | Partial failure leaves inconsistent state | Acceptable for Fase 0; remediate in Fase 1 |
| L-007 | `XmlSignerPort` has no implementation | Electronic signature of invoices not possible | Pending spike (ADR-005) for Fase 3 |
| L-008 | No rate limiting on auth endpoints | Brute-force vulnerability | Implement in Fase 1 |
| L-009 | No CORS configuration | Browser clients cannot connect | Implement before any browser client is deployed |

---

## 14. Open Decisions Requiring Clarification

| ID | Question | Impact | Blocking |
|---|---|---|---|
| OD-001 | How will domain events be dispatched? In-process via NestJS EventEmitter, via pg-boss jobs, or via an external message bus? | Architecture of all future event-driven features | Not blocking Fase 1 unless tenant events are needed |
| OD-002 | What is the data retention enforcement mechanism for `TECHNICAL` and `SECURITY` audit logs? Time-based deletion? Archive table? | Audit compliance | Not blocking Fase 1 |
| OD-003 | What RBAC model applies to the API? Per-endpoint role requirements? Resource ownership? | Security architecture of Fase 1+ endpoints | Must resolve before any role-restricted endpoints in Fase 1 |
| OD-004 | How will Hacienda OAuth2 tokens (for `submitDocument`) be managed? Cached in Redis? In-memory per worker? | Architecture of Hacienda adapter in Fase 2+ | Not blocking Fase 1 |
| OD-005 | Should `CreateTenantHandler` and `LoginHandler` multi-write operations be wrapped in explicit Prisma transactions? | Data consistency under failure | Low risk for Fase 0; should be resolved before production traffic |

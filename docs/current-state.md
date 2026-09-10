# Current State

> **Last updated:** post `pre-fase-2-hardening` implementation cycle.
> This document describes only the actual, observable implementation as it exists in the repository today.

---

## 1. System overview

Billing is a SaaS REST API for Costa Rican electronic invoicing (*facturación electrónica*).
It is built as a **modular NestJS 10 monolith** structured according to hexagonal architecture (ports and adapters).

**Completed implementation stages:**
- Fase 0 — Foundation (multi-tenancy, identity, companies, API keys, audit, storage, queue)
- Fase 1 — Public Hacienda API (taxpayer lookup, CABYS catalog, exchange rates, circuit breaker)
- pre-fase-2-hardening — Configuration hardening, CORS fail-fast, circuit breaker configurability, CI improvements

**Not yet implemented:** Fase 2 (HaciendaConnection per company), Fase 3+ (document submission, XML signing).

The system:
- Exposes a multi-tenant REST API under `/api/v1`
- Authenticates via JWT Bearer (management endpoints) and API Keys (integration endpoints)
- Integrates with Hacienda's public API for taxpayer lookup, CABYS catalog and exchange rates
- Uses PostgreSQL 15 as its sole data store (via Prisma 5 ORM)
- Uses pg-boss on the same PostgreSQL instance for background job queuing
- Uses local filesystem or AWS S3 for object storage
- Runs as two separate processes from the same compiled codebase: `billing-api` and `billing-worker`

---

## 2. Repository structure

```
C:\Users\kmena\Documents\proyectos\Billing\
├── src/
│   ├── api/                         # Cross-cutting HTTP layer
│   │   ├── decorators/              # @Scopes()
│   │   ├── filters/                 # GlobalExceptionFilter
│   │   ├── guards/                  # ApiKeyAuthGuard, JwtAuthGuard, ScopeGuard, ApiKeyThrottlerGuard
│   │   ├── health/                  # HealthController, PrismaHealthIndicator
│   │   ├── interceptors/            # CorrelationIdInterceptor, TenantContextInterceptor, AuditInterceptor
│   │   └── strategies/              # JwtStrategy (passport-jwt)
│   ├── app.module.ts                # Root NestJS module
│   ├── bootstrap/
│   │   ├── api.main.ts              # HTTP API entry point (ConfigService-only, no process.env)
│   │   └── worker.main.ts           # Background worker entry point (no job handlers registered yet)
│   ├── infrastructure/
│   │   ├── config/
│   │   │   ├── __tests__/           # config.validation.spec.ts (10 tests)
│   │   │   ├── config.module.ts     # NestJS ConfigModule wrapper; re-exports validationSchema
│   │   │   ├── config.validation-schema.ts  # Standalone Joi schema (all env vars)
│   │   │   ├── app.config.ts        # AppConfig factory (NODE_ENV, PORT, LOG_LEVEL)
│   │   │   ├── auth.config.ts       # AuthConfig factory (JWT settings)
│   │   │   ├── database.config.ts   # DatabaseConfig factory (DATABASE_URL)
│   │   │   ├── hacienda.config.ts   # HaciendaConfig factory (incl. circuitBreaker + retry sub-objects)
│   │   │   ├── secrets.config.ts    # SecretsConfig factory
│   │   │   └── storage.config.ts    # StorageConfig factory (incl. localStoragePath + localStorageSecret)
│   │   ├── database/
│   │   │   ├── database.module.ts
│   │   │   ├── prisma.service.ts
│   │   │   └── tenant-aware-prisma.repository.ts
│   │   ├── integrations/
│   │   │   └── hacienda/
│   │   │       ├── __tests__/       # adapter + circuit breaker + mock tests
│   │   │       ├── adapters/        # HaciendaApiAdapter, MockHaciendaAdapter
│   │   │       ├── exceptions/      # HaciendaUnavailableException
│   │   │       ├── ports/           # HaciendaPort interface
│   │   │       ├── hacienda-circuit-breaker.service.ts  # @Optional() ConfigService; 7 configurable thresholds
│   │   │       └── hacienda.module.ts
│   │   ├── queue/
│   │   │   ├── __tests__/
│   │   │   ├── adapters/            # PgBossJobQueueAdapter, InMemoryJobQueueAdapter
│   │   │   ├── ports/               # JobQueuePort
│   │   │   └── queue.module.ts
│   │   ├── secrets/
│   │   │   ├── __tests__/
│   │   │   ├── adapters/            # EnvSecretProvider, AwsParameterStoreSecretProvider
│   │   │   ├── ports/               # SecretProviderPort
│   │   │   └── secrets.module.ts
│   │   ├── signing/
│   │   │   └── ports/               # XmlSignerPort (interface only — no adapter implemented)
│   │   ├── storage/
│   │   │   ├── adapters/            # LocalStorageAdapter (no process.env), S3StorageAdapter
│   │   │   ├── ports/               # StoragePort
│   │   │   └── storage.module.ts    # Injects StorageConfig values into LocalStorageAdapter via ConfigService
│   │   └── tenant/
│   │       ├── __tests__/
│   │       └── tenant-context.ts
│   └── modules/
│       ├── api-keys/                # ApiKey CRUD + validation
│       ├── audit/                   # Append-only audit trail
│       ├── cabys/                   # CABYS catalog lookup
│       ├── companies/               # Company registration + Hacienda verification at creation
│       ├── exchange-rates/          # Exchange rate lookup
│       ├── identity/                # Tenants, users, auth (login, refresh)
│       ├── shared/                  # Base domain classes
│       └── taxpayers/               # Taxpayer lookup
├── prisma/
│   ├── migrations/
│   │   ├── 20250001000000_initial_foundation/   # All Fase 0 tables, ENUMs, indexes
│   │   └── 20250002000000_company_hacienda_fields/  # Nullable Hacienda verification columns
│   ├── schema.prisma
│   └── seed.ts
├── test/
│   ├── e2e/
│   │   ├── fase0/                   # auth, health, api-keys, tenant-isolation
│   │   └── fase1/                   # hacienda-endpoints, scope-guard
│   └── helpers/
│       └── test-factories.ts
├── .github/workflows/ci.yml         # 5-job pipeline (lint, typecheck, test, build, e2e)
├── Dockerfile                       # 3-stage multi-stage build
├── docker-compose.yml               # Dev stack (postgres, localstack, billing-api, billing-worker)
├── .gitignore                       # Includes SIGNED_*.xml
└── package.json
```

---

## 3. Current architecture

| Attribute | Value |
|---|---|
| Style | Modular NestJS monolith + hexagonal architecture |
| Runtime | Node.js 20 + NestJS 10 + TypeScript 5 |
| ORM | Prisma 5 (PostgreSQL) |
| HTTP | Express (via @nestjs/platform-express) |
| Config validation | Joi 17 (standalone schema; validated at startup) |
| Auth | @nestjs/jwt + passport-jwt (JWT) + custom guards (API Key) |
| Password hashing | Argon2 |
| Rate limiting | @nestjs/throttler v6 (in-memory, two-tier) |
| Logging | nestjs-pino + pino |
| HTTP client | @nestjs/axios (Hacienda) |
| Caching | cache-manager v7 (in-memory, Hacienda responses) |
| Job queue | pg-boss v10 on PostgreSQL |
| Object storage | Local filesystem (dev) / AWS S3 (production) |
| Secrets | Environment variables (dev) / AWS SSM Parameter Store (production) |

**Layer structure (per business module):**
```
Module
├── domain/
│   ├── entities/         Domain entities with lifecycle and invariants
│   ├── value-objects/    Immutable value types with built-in validation
│   ├── exceptions/       DomainException subclasses (map to HTTP status codes)
│   ├── events/           Domain events (past-tense names)
│   └── ports/            Repository interfaces (output ports)
├── application/
│   └── use-cases/        Command/Query handlers; no framework dependencies
└── infrastructure/
    ├── http/             NestJS controllers + request/response DTOs
    └── persistence/      Prisma repository adapters
```

---

## 4. Existing domains and modules

### Identity (Core domain)
**Responsibility:** Tenant registration, user management, JWT authentication, refresh token rotation.

| Concept | Type | Location |
|---|---|---|
| Tenant | Aggregate root | `modules/identity/domain/entities/tenant.entity.ts` |
| User | Entity | `modules/identity/domain/entities/user.entity.ts` |
| Email | Value Object | `modules/identity/domain/value-objects/email.vo.ts` |
| TenantName | Value Object | `modules/identity/domain/value-objects/tenant-name.vo.ts` |
| TenantSlug | Value Object | `modules/identity/domain/value-objects/tenant-slug.vo.ts` |
| TenantCreated | Domain event | `modules/identity/domain/events/tenant-created.event.ts` |
| CreateTenantHandler | Use case | Application layer |
| LoginHandler | Use case | Application layer |
| RefreshTokenHandler | Use case | Application layer |

### Companies (Core domain)
**Responsibility:** Company registration within a tenant, Hacienda taxpayer verification at creation time.

| Concept | Type | Location |
|---|---|---|
| Company | Aggregate root | `modules/companies/domain/entities/company.entity.ts` |
| IdentificationNumber | Value Object | `modules/companies/domain/value-objects/identification-number.vo.ts` |
| IdentificationType | Value Object | `modules/companies/domain/value-objects/identification-type.vo.ts` |
| CreateCompanyHandler | Use case | Application layer (calls HaciendaPort for verification) |
| GetCompanyHandler | Use case | Application layer |

### API Keys (Core domain)
**Responsibility:** API key lifecycle (create, list, revoke) and validation for inbound requests.

| Concept | Type | Location |
|---|---|---|
| ApiKey | Aggregate root | `modules/api-keys/domain/entities/api-key.entity.ts` |
| ApiKeyScope | Value Object | `modules/api-keys/domain/value-objects/api-key-scope.vo.ts` |
| ValidateApiKeyHandler | Use case | Called by `ApiKeyAuthGuard` |

**Key security property:** Full secret shown once only; stored as Argon2 hash via prefix model.

### Audit (Supporting domain)
**Responsibility:** Append-only audit trail for all API operations.

| Concept | Type | Location |
|---|---|---|
| AuditLog | Entity | `modules/audit/domain/entities/audit-log.entity.ts` |
| AuditService | Application service | `modules/audit/application/audit.service.ts` |
| AuditInterceptor | Infrastructure | `api/interceptors/audit.interceptor.ts` |

**ADR-009:** `EventClass` enum (`FISCAL_AUDIT`, `TECHNICAL`, `SECURITY`) classifies retention requirements.

### Hacienda Integration (Supporting domain)
**Responsibility:** Proxying and normalizing Hacienda public API calls; outbound resilience.

| Concept | Type | Location |
|---|---|---|
| HaciendaPort | Output port (interface) | `infrastructure/integrations/hacienda/ports/hacienda.port.ts` |
| HaciendaApiAdapter | Real HTTP adapter | `infrastructure/integrations/hacienda/adapters/hacienda-api.adapter.ts` |
| MockHaciendaAdapter | Test adapter | `infrastructure/integrations/hacienda/adapters/mock-hacienda.adapter.ts` |
| HaciendaCircuitBreaker | Infrastructure service | `infrastructure/integrations/hacienda/hacienda-circuit-breaker.service.ts` |
| HaciendaUnavailableException | Domain exception | `infrastructure/integrations/hacienda/exceptions/` |

**Circuit breaker config (all via env vars, Joi-validated):**

| Variable | Default | Rule |
|---|---|---|
| `HACIENDA_CB_FAILURE_THRESHOLD` | 5 | Integer > 0 |
| `HACIENDA_CB_RESET_TIMEOUT_MS` | 30000 | Integer > 0 |
| `HACIENDA_CB_OUTBOUND_RATE_PER_SECOND` | 8 | Integer > 0, max 10 |
| `HACIENDA_RETRY_429_COUNT` | 2 | Integer > 0 |
| `HACIENDA_RETRY_429_BASE_DELAY_MS` | 1000 | Integer > 0 |
| `HACIENDA_RETRY_5XX_COUNT` | 1 | Integer > 0 |
| `HACIENDA_RETRY_5XX_DELAY_MS` | 2000 | Integer > 0 |

### Shared (Generic)
Base domain abstractions: `AggregateRoot`, `BaseEntity`, `DomainException`, `ValueObject`, `DomainEvent`, `IRepository`.

---

## 5. Main use cases

| Use Case | Endpoint | Auth | Module |
|---|---|---|---|
| Register tenant + first user | POST /api/v1/tenants | None | Identity |
| Login | POST /api/v1/auth/login | None | Identity |
| Refresh token | POST /api/v1/auth/refresh | None | Identity |
| Get tenant | GET /api/v1/tenants/:id | JWT | Identity |
| Create company | POST /api/v1/companies | JWT | Companies |
| Get company | GET /api/v1/companies/:id | JWT | Companies |
| Create API key | POST /api/v1/api-keys | JWT | API Keys |
| List API keys | GET /api/v1/api-keys | JWT | API Keys |
| Revoke API key | DELETE /api/v1/api-keys/:id | JWT | API Keys |
| Validate API key | (internal, called by guard) | — | API Keys |
| Lookup taxpayer | GET /api/v1/taxpayers/:id | API Key (taxpayers:read) | Taxpayers |
| Get CABYS item | GET /api/v1/cabys/:code | API Key (cabys:read) | CABYS |
| Search CABYS | GET /api/v1/cabys?search= | API Key (cabys:read) | CABYS |
| Get exchange rate | GET /api/v1/exchange-rates | API Key (exchange-rates:read) | Exchange Rates |
| Health check | GET /health | None | Health |

---

## 6. Current data flows

### JWT-authenticated request flow
```
Client → [JwtAuthGuard → JwtStrategy]
       → TenantContextInterceptor (set TenantContext)
       → AuditInterceptor (begin audit)
       → Controller → Use Case Handler → Prisma Repository
       → AuditInterceptor (finalize audit)
       → GlobalExceptionFilter (on error)
```

### API Key-authenticated request flow
```
Client (X-API-Key header)
  → ApiKeyAuthGuard → ValidateApiKeyHandler (Argon2 verify, status check)
    → attach apiKey + user.tenantId to request
  → ScopeGuard (check @Scopes() decorator matches apiKey.scopes)
  → TenantContextInterceptor
  → AuditInterceptor
  → Controller → Use Case Handler → HaciendaPort
  → AuditInterceptor finalize
```

### Hacienda outbound request flow
```
Use Case Handler → HaciendaPort (injected adapter)
  → cache lookup (cache-manager; miss → continue)
  → HaciendaCircuitBreaker.execute()
      → enforceOutboundRateLimit() (sliding window ≤ OUTBOUND_MAX_PER_SECOND req/s)
      → circuit state check (OPEN → fast-fail with HaciendaUnavailableException)
      → HTTP call via @nestjs/axios
      → retry on 429 (linear backoff) or 5xx/network (fixed delay)
      → onSuccess() / onFailure() (state machine transitions)
  → map Hacienda fields → Billing-owned fields
  → cache write
  → return Billing-contract result
```

---

## 7. Database and persistence

**Engine:** PostgreSQL 15 via Prisma 5 (prisma-client-js)

**Applied migrations (in order):**

| Migration | Description |
|---|---|
| `20250001000000_initial_foundation` | All Fase 0 tables, ENUMs, indexes, FKs |
| `20250002000000_company_hacienda_fields` | Nullable Hacienda verification columns on `companies` |

**Tables:**

| Table | Owner domain | Key properties |
|---|---|---|
| `tenants` | Identity | UUIDv4 PK, unique slug |
| `users` | Identity | tenant-scoped, unique email per tenant, Argon2 password_hash |
| `refresh_tokens` | Identity | unique token_hash, single-use (`used` flag), TTL enforced at app layer |
| `companies` | Companies | tenant-scoped, unique identification_number per tenant; nullable Hacienda verification fields |
| `api_keys` | API Keys | prefix/hash model, scopes array, status enum |
| `api_key_companies` | API Keys | N:M join between api_keys and companies |
| `audit_logs` | Audit | append-only; EventClass enum; 5 composite indexes |

**ENUMs:** `TenantStatus`, `TenantPlan`, `UserStatus`, `UserRole`, `CompanyStatus`, `IdentificationType`, `ApiKeyStatus`, `ApiKeyEnv`, `HaciendaVerificationStatus`, `EventClass`

**Tenant isolation:** enforced at `TenantAwarePrismaRepository` base class; all queries filter by `tenantId`. No row-level security in PostgreSQL.

**Audit integrity:** No application-level UPDATE/DELETE on `audit_logs`. No database-level trigger enforcement.

---

## 8. APIs and integrations

### Internal REST API

- Base prefix: `/api/v1` (excluded: `/health`, `/health/ready`, `/health/live`)
- Error response envelope: `{ error: { code, message, correlationId, timestamp, details? } }`
- Request validation: `ValidationPipe` (whitelist=true, forbidNonWhitelisted=true, transform=true)
- OpenAPI: `/api/docs` in non-production environments only
- CORS: configured from `CORS_ALLOWED_ORIGINS`; wildcard rejected at startup in production/staging

### External integration: Hacienda API

| Endpoint | Use | Notes |
|---|---|---|
| `GET /fe/ae?identificacion=<id>` | Taxpayer lookup | HTTP 200 even for not-found; discriminated by body |
| `GET /indicadores/tc/dolar` | Current exchange rate | — |
| `GET /indicadores/tc/dolar/historico?d=<d>&h=<h>` | Historical exchange rate | — |
| `GET /fe/cabys?codigo=<code>` | CABYS item by code | Returns array; empty = not found |
| `GET /fe/cabys?q=<q>&top=<n>` | CABYS search | Use `total` not `cantidad` for count |

**BR-014:** Hacienda returns HTTP 200 for not-found taxpayer with `body.code === 404`. Body inspection required.
**BR-015:** CABYS codes (13 digits) differ from economic activity codes (e.g., `"9609.0"`). These must not be confused.

**Stubs in HaciendaApiAdapter (Fase 3+):**
- `submitDocument()` — throws `Error: Not implemented`
- `getDocumentStatus()` — throws `Error: Not implemented`

### Caching (in-memory, Hacienda only)

| Cache key pattern | TTL default | Variable |
|---|---|---|
| `taxpayer:<id>` | 1 hour | `TAXPAYER_CACHE_TTL_MS` |
| `exchange-rate:<currency>:<date>` | 4 hours | `EXCHANGE_RATE_CACHE_TTL_MS` |
| `cabys:code:<code>` | 24 hours | `CABYS_ITEM_CACHE_TTL_MS` |
| `cabys:search:<q>:<limit>` | 1 hour | `CABYS_SEARCH_CACHE_TTL_MS` |

---

## 9. Authentication and authorization

### JWT (management endpoints)

| Property | Value |
|---|---|
| Library | @nestjs/jwt + passport-jwt |
| Algorithm | HS256 (default; not explicitly overridden) |
| Access token TTL | 15m (configurable `JWT_EXPIRES_IN`) |
| Refresh token TTL | 7d (configurable `JWT_REFRESH_EXPIRES_IN`) |
| Refresh token storage | Argon2 hash in `refresh_tokens` table |
| Rotation | Single-use; new token issued on each refresh |
| JWT_SECRET | Required >= 32 chars in production (Joi-enforced at startup) |

### API Keys (integration endpoints)

| Property | Value |
|---|---|
| Format | `{prefix}.{secret}` |
| Prefix | Stored in DB (16-char, unique) |
| Secret | Argon2 hash stored; full key shown once only |
| Scopes | `taxpayers:read`, `cabys:read`, `exchange-rates:read` |
| Status | ACTIVE / REVOKED / EXPIRED |
| Expiry | Optional `expiresAt` |
| Company scope | Optional N:M — key authorized for specific companies |

### Rate limiting

| Tier | Limit | Storage |
|---|---|---|
| Layer A — per API Key | 100 req/60s | In-memory (throttler) |
| Layer B — per IP (auth endpoints) | 10 req/60s | In-memory (throttler) |

Rate limits are configured via `THROTTLE_API_TTL`, `THROTTLE_API_LIMIT`, `THROTTLE_AUTH_TTL`, `THROTTLE_AUTH_LIMIT` (all Joi-validated).

---

## 10. Events and background processing

### Domain events
`TenantCreated` event is defined in `modules/identity/domain/events/tenant-created.event.ts`.
**No event bus is wired.** The event is defined but not published or consumed.

### Job queue infrastructure
- Port: `JobQueuePort` (`infrastructure/queue/ports/job-queue.port.ts`)
- Adapters: `PgBossJobQueue` (production), `InMemoryJobQueue` (test, selected automatically by ConfigService)
- pg-boss creates its own schema in PostgreSQL; migration behavior under concurrent startup is untested

### Worker process
`billing-worker` (`bootstrap/worker.main.ts`) creates a NestJS application context and enables shutdown hooks, but **registers no job handlers**. The worker is operational infrastructure without actual job processing.

---

## 11. Containers and deployment

### Dockerfile (3-stage multi-stage)

| Stage | Base image | Purpose |
|---|---|---|
| `deps` | `node:20-alpine` | Install all deps + native build tools |
| `builder` | `node:20-alpine` | Generate Prisma client, compile TypeScript, prune dev deps |
| `runner` | `node:20-alpine` | Minimal production image; non-root user `billing:1001` |

Container runs as user `billing` (UID 1001, GID 1001). Port 3000. HEALTHCHECK via `wget`.

### docker-compose.yml (development stack)

| Service | Image | Notable config |
|---|---|---|
| `postgres` | `postgres:15-alpine` | Health check; `billing_dev` database |
| `localstack` | `localstack/localstack:3` | S3 only; health check |
| `billing-api` | Built from Dockerfile | `NODE_ENV=production`; S3 storage; `CORS_ALLOWED_ORIGINS` env var |
| `billing-worker` | Built from Dockerfile | No HTTP port; same storage + DB config |

`CORS_ALLOWED_ORIGINS` defaults to `http://localhost:3000` in docker-compose (non-wildcard, satisfies Joi production rule).

Hacienda circuit breaker vars (`HACIENDA_CB_FAILURE_THRESHOLD`, `HACIENDA_CB_RESET_TIMEOUT_MS`, `HACIENDA_CB_OUTBOUND_RATE_PER_SECOND`) are configurable via environment in docker-compose.

### CI Pipeline (`.github/workflows/ci.yml`)

| Job | Depends on | PostgreSQL service | Notes |
|---|---|---|---|
| `lint` | — | No | ESLint + `npx prisma generate` |
| `typecheck` | — | No | tsc --noEmit + `npx prisma generate` |
| `test` | lint, typecheck | Yes (`billing_test`) | Jest unit tests; `SECRET_PROVIDER=env` |
| `build` | lint, typecheck | No | `npm run build` |
| `e2e` | test, build | Yes (`billing_e2e`) | Full E2E; `USE_REAL_HACIENDA=false` |

---

## 12. Current testing strategy

### Unit tests (co-located in `__tests__/`)

| Test file | What it tests |
|---|---|
| `config/config.validation.spec.ts` | Joi schema — 10 tests; CORS rules, JWT, CB defaults; no NestJS bootstrap |
| `hacienda/hacienda-circuit-breaker.spec.ts` | State machine, configurable thresholds, rate limiter, retry logic |
| `hacienda/hacienda-api.adapter.spec.ts` | HTTP adapter; BR-014 body discriminator; field mapping |
| `hacienda/mock-hacienda.spec.ts` | Mock adapter contract compliance |
| `api-keys/api-key.entity.spec.ts` | ApiKey entity lifecycle and invariants |
| `companies/identification-number.vo.spec.ts` | IdentificationNumber validation rules |
| `identity/tenant-slug.vo.spec.ts` | TenantSlug validation |
| `identity/tenant.entity.spec.ts` | Tenant entity lifecycle |
| `identity/create-tenant.handler.spec.ts` | CreateTenantHandler use case |
| `identity/login.handler.spec.ts` | LoginHandler use case |
| `shared/aggregate-root.spec.ts` | Base aggregate root |
| `shared/value-object.spec.ts` | Base value object |
| `interceptors/correlation-id.interceptor.spec.ts` | CorrelationId header behavior |
| `guards/scope.guard.spec.ts` | ScopeGuard scope matching |
| `audit/audit.service.spec.ts` | AuditService write behavior |
| `queue/in-memory-job-queue.spec.ts` | InMemoryJobQueue adapter |
| `secrets/env-secret-provider.spec.ts` | EnvSecretProvider adapter |
| `tenant/tenant-context.spec.ts` | TenantContext lifecycle |

### E2E tests (`test/e2e/`)

| File | Fase | Coverage |
|---|---|---|
| `fase0/auth.e2e-spec.ts` | 0 | Login, refresh, invalid credentials |
| `fase0/health.e2e-spec.ts` | 0 | Health endpoint status |
| `fase0/api-keys.e2e-spec.ts` | 0 | API key create/list/revoke |
| `fase0/tenant-isolation.e2e-spec.ts` | 0 | Cross-tenant data isolation |
| `fase1/hacienda-endpoints.e2e-spec.ts` | 1 | Taxpayer, CABYS, exchange rate |
| `fase1/scope-guard.e2e-spec.ts` | 1 | Scope enforcement |

---

## 13. Behavior to preserve

1. **Multi-tenant data isolation**: All queries filter by `tenantId`. No cross-tenant access.
2. **API key security**: Full secret shown once only; Argon2 hash stored; secret never recoverable.
3. **Refresh token rotation**: Single-use; old token marked `used` before new one issued.
4. **Hacienda contract isolation**: All Hacienda field names (`nombre`, `venta`, `compra`, `codigo`, `impuesto`) are confined to `HaciendaApiAdapter`. No Hacienda-internal names appear in API responses or use cases.
5. **BR-014**: Hacienda taxpayer not-found is detected via `body.code === 404` (HTTP 200 with body discriminator), NOT via HTTP status code.
6. **BR-015**: CABYS codes (13-digit numeric strings) must not be confused with economic activity codes (e.g., `"9609.0"`).
7. **Audit immutability**: `audit_logs` is never updated or deleted at the application layer.
8. **CORS fail-fast**: Production and staging environments must fail at startup if `CORS_ALLOWED_ORIGINS` is absent or set to `"*"`. No runtime fallback.
9. **JWT minimum entropy**: Production requires `JWT_SECRET` >= 32 characters (Joi-enforced at startup).
10. **Path traversal prevention**: `LocalStorageAdapter.resolveKey()` normalizes and strips leading `../` segments.

---

## 14. Known defects

| ID | Severity | Location | Description |
|---|---|---|---|
| DEFECT-001 | Low | `api/filters/global-exception.filter.ts` | `GlobalExceptionFilter` reads `process.env.NODE_ENV` directly (`const isProduction = process.env.NODE_ENV === 'production'`). This bypasses the ConfigService pattern established by the hardening cycle. Functional, but architecturally inconsistent. |
| DEFECT-002 | Medium | `bootstrap/worker.main.ts` | Worker process creates application context but registers no job handlers. It starts successfully but does nothing. This is intentional for Fase 0/1 but must be addressed before Fase 3 (async document processing). |

---

## 15. Architectural debt

| ID | Severity | Location | Description |
|---|---|---|---|
| DEBT-001 | Low | `infrastructure/integrations/hacienda/hacienda.module.ts` | `CacheModule.register({ ttl: 3600000, max: 500 })` uses a hardcoded fallback TTL. Individual operations correctly override TTLs. The module-level default is only a fallback and is functionally correct, but the value is not validated by Joi. |
| DEBT-002 | Medium | `modules/identity/domain/events/tenant-created.event.ts` | `TenantCreated` domain event is defined but never published or consumed. No event bus is wired. Domain events are effectively dead code at runtime. |
| DEBT-003 | Low | `infrastructure/signing/ports/xml-signer.port.ts` | `XmlSignerPort` interface exists but has no adapter implementation. Required for Fase 3 document signing; currently unused. |
| DEBT-004 | Medium | Rate limiter | `@nestjs/throttler` uses in-memory storage. State is lost on restart and does not propagate across multiple API instances. Acceptable for single-instance; must be addressed before horizontal scaling. |
| DEBT-005 | Low | `prisma/seed.ts` | Seed script exists but its execution in CI/staging is not documented or automated. |

---

## 16. Security risks

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-001 | Medium | `GlobalExceptionFilter` reads `process.env.NODE_ENV` directly. If env is tampered after startup, the production/development branching in the filter could diverge from Joi-validated configuration. | Open (DEFECT-001) |
| SEC-002 | Low | `docker-compose.yml` uses a predictable dev password (`billing_password`) with no enforcement of override via env var. Suitable for local dev only; must not be used in any shared environment. | Known; acceptable for dev |
| SEC-003 | Low | Refresh tokens in DB are not automatically purged on expiry. Accumulated expired tokens increase table size but have no active security risk (hash comparison fails at application level). | Open; no cleanup job |
| SEC-004 | Low | `@nestjs/throttler` in-memory rate limiting resets on restart. A motivated attacker could bypass auth rate limits by triggering a process restart. | Known limitation |
| SEC-005 | Info | `SIGNED_*.xml` pattern added to `.gitignore` — fiscal documents cannot be accidentally committed. | ✅ Resolved (hardening) |
| SEC-006 | Info | CORS wildcard now fails at startup in production/staging via Joi schema. No runtime console.warn fallback remains. | ✅ Resolved (hardening) |

---

## 17. Unknowns and assumptions

| ID | Topic | Status |
|---|---|---|
| UNK-001 | JWT algorithm | Not explicitly set; defaults to HS256 via @nestjs/jwt. Verify if RS256 is required for Fase 2 external token validation or cross-service trust. |
| UNK-002 | Refresh token cleanup | No cron job or background worker task purges expired refresh tokens. Behavior under large volumes is unverified. |
| UNK-003 | pg-boss concurrent startup | PgBossJobQueue creates its schema on first startup. Concurrent API + Worker startup race condition is untested. |
| UNK-004 | Hacienda OAuth (Fase 2) | The Hacienda authenticated submission API requires per-company OAuth tokens. Token acquisition, storage, and rotation mechanism are not yet designed. |
| UNK-005 | Multi-instance rate limiting | If billing-api runs as multiple instances, throttler state is not shared. Redis or DB-backed throttler would be needed. |
| UNK-006 | Prisma connection pooling | No explicit pool size configuration. Default Prisma behavior under concurrent load in production is not documented. |

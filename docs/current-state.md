# Current State

> **Synchronized:** post `chore/docs-versioning` — all implementation phases through this milestone are complete.
> **Validated baseline:** `npm test -- --silent` ✅ 163 tests / 24 suites; `npm run typecheck` ✅; `npm run lint:check` ✅; `npm run build` ✅.
> **Audit score:** 8.8 / 10 (corrected from initial 8.2; CI/CD and Documentation dimensions had false-negative scores due to tool bug — see `docs/audit/current-code-audit.md`).
> **Audit report:** `docs/audit/current-code-audit.md` — committed to the repository (commit `9854900`).

---

## 1. System Overview

Billing is a multi-tenant SaaS platform for electronic invoicing (facturación electrónica) in Costa Rica. The system targets full compliance with Ministerio de Hacienda Comprobantes Electrónicos v4.4.

**Completed implementation phases:**

| Phase | Description |
|---|---|
| fase-0-foundation | NestJS modular monolith, Prisma/PostgreSQL, JWT auth, API keys (argon2id), tenant isolation, audit, company management, queue/storage/secrets ports |
| fase-1-hacienda-consultas | Hacienda public queries (taxpayers, CABYS, exchange rates), ThrottlerModule, ScopeGuard (AND semantics, fail-closed), HaciendaCircuitBreaker, HaciendaApiAdapter + MockHaciendaAdapter, CORS configuration, scope validation on API key creation |
| fase-2-1-hacienda-connection | Per-company per-environment HaciendaConnection (configure/get/validate/disable), HaciendaTokenCache (in-memory), HaciendaOidcAuthAdapter + MockHaciendaAuthAdapter, AuditLog on all connection operations, HaciendaConnectionController (JWT-protected), XmlSignerPort stub |
| post-fase-2-1-remediation | Auth token duration service, refresh token rotation improvement, GlobalExceptionFilter NODE_ENV fix, AuditInterceptor categorical action fix, E2E test factory (createTestCompany generates valid 10-digit JURIDICA IDs), HaciendaConnectionController response DTO fix, Docker Compose updates |
| pre-fase-2-hardening | CORS production enforcement fatal startup error via Joi, HaciendaCircuitBreaker fully configurable via ConfigService (7 parameters), CI `npx prisma generate` in all jobs, `.env.local.example` documented (31+ env vars), Docker Compose CORS shell variable substitution |
| chore/docs-versioning | `.gitignore` explicit policy: removed broad `docs/**` rule, changed `specs/**` → `specs/`. Project documentation now versioned: `changelog.md`, `coding-standards.md`, `future-architecture.md`, `docs/audit/current-code-audit.md` added to git. Local machine path sanitized from audit report. Audit score corrected from 8.2 to 8.8 (CI/CD and Documentation dimensions had false-negative scores). |

**Not yet implemented:**
- Fiscal document generation (XML, signing, Hacienda submission) — `specs/fase-2-2-fiscal-document-core` is the next planned phase.
- Background job handlers in the worker process.
- XmlSignerPort implementation (stub only; ADR-005 technical spike pending).

---

## 2. Repository Structure

```
Billing/
├── .github/workflows/ci.yml         # GitHub Actions CI pipeline
├── .env.local.example               # 31+ documented env vars with inline comments
├── Dockerfile                       # Multi-stage: deps → builder → runner (non-root)
├── docker-compose.yml               # postgres + localstack + billing-api + billing-worker
├── nest-cli.json
├── package.json                     # Scripts, dependencies, Jest config
├── prisma/
│   ├── schema.prisma                # Canonical ORM schema
│   ├── seed.ts                      # Development seed data
│   └── migrations/
│       ├── 20250001000000_initial_foundation/
│       ├── 20250002000000_company_hacienda_fields/
│       └── 20250003000000_hacienda_connection/
├── src/
│   ├── app.module.ts                # Root NestJS module — all modules registered here
│   ├── bootstrap/
│   │   ├── api.main.ts              # HTTP API entrypoint — CORS, prefix, guards, Swagger, shutdown
│   │   └── worker.main.ts           # Background worker entrypoint (no job handlers implemented)
│   ├── api/                         # Cross-cutting HTTP concerns
│   │   ├── decorators/scopes.decorator.ts
│   │   ├── filters/global-exception.filter.ts
│   │   ├── guards/                  # JwtAuthGuard, ApiKeyAuthGuard, ScopeGuard, ApiKeyThrottlerGuard
│   │   ├── health/                  # GET /health, /health/ready, /health/live + PrismaHealthIndicator
│   │   ├── interceptors/            # CorrelationIdInterceptor, TenantContextInterceptor, AuditInterceptor
│   │   └── strategies/jwt.strategy.ts
│   ├── infrastructure/
│   │   ├── config/                  # Joi-validated ConfigModule; validationSchema standalone testable
│   │   │   ├── config.validation-schema.ts  # Exported separately for unit testing without NestJS
│   │   │   ├── config.module.ts
│   │   │   ├── app.config.ts
│   │   │   ├── auth.config.ts
│   │   │   ├── database.config.ts
│   │   │   ├── hacienda.config.ts   # Typed sub-objects: circuitBreaker, retry
│   │   │   ├── hacienda-auth.config.ts
│   │   │   ├── secrets.config.ts
│   │   │   └── storage.config.ts
│   │   ├── database/                # PrismaService, TenantAwarePrismaRepository (AsyncLocalStorage)
│   │   ├── integrations/hacienda/   # HaciendaPort, HaciendaApiAdapter, MockHaciendaAdapter,
│   │   │                            # HaciendaCircuitBreaker (7 configurable params via ConfigService)
│   │   ├── queue/                   # JobQueuePort, PgBossJobQueue, InMemoryJobQueue
│   │   ├── secrets/                 # SecretProviderPort, EnvSecretProvider, AwsSsmSecretProvider
│   │   ├── signing/ports/           # XmlSignerPort (stub — no adapter implemented; ADR-005 spike pending)
│   │   ├── storage/                 # StoragePort, LocalStorageAdapter, AwsS3StorageAdapter
│   │   └── tenant/tenant-context.ts # TenantContext — AsyncLocalStorage wrapper
│   └── modules/
│       ├── shared/domain/           # AggregateRoot, BaseEntity, ValueObject, DomainEvent, DomainException, IRepository
│       ├── identity/                # Tenant, User, JWT auth, refresh tokens
│       ├── companies/               # Company aggregate + best-effort Hacienda verification
│       ├── api-keys/                # API key lifecycle, argon2id, scopes, revocation
│       ├── audit/                   # @Global AuditModule, AuditLog append-only (application-level)
│       ├── taxpayers/               # GET /taxpayers/:id → HaciendaPort
│       ├── cabys/                   # GET /cabys/:code, GET /cabys?search → HaciendaPort
│       ├── exchange-rates/          # GET /exchange-rates → HaciendaPort
│       └── hacienda-connection/     # Per-company Hacienda OIDC credential management
└── test/
    ├── helpers/test-factories.ts    # Prisma-direct fixture factories (valid JURIDICA IDs)
    ├── jest-e2e.json
    └── e2e/
        ├── fase0/                   # api-keys, auth, health, tenant-isolation
        ├── fase1/                   # hacienda-endpoints, scope-guard
        └── fase2/                   # hacienda-connection
```

---

## 3. Current Architecture

The system implements **Hexagonal Architecture (Ports and Adapters)** within a **NestJS modular monolith**.

**Dependency direction:**
```
HTTP Controller (Input Adapter)
        ↓
  Use Case Handler (Application Layer)
        ↓
  Domain Entities / Value Objects
        ↓
  Repository Port / External Port (Output Port interface)
        ↑
  Prisma Repository / API Adapter (Output Adapter)
```

**Module internal structure:**
```
modules/{name}/
  domain/           — entities, value objects, exceptions, port interfaces
  application/      — use-case handlers, no framework imports
  infrastructure/
    http/           — controllers, DTOs (input adapters)
    persistence/    — Prisma repositories (output adapters)
    auth/           — auth adapters (where applicable)
```

**Cross-cutting infrastructure** (`src/infrastructure/`) is independent of any business module.

**Global interceptor chain** (applied in order per `api.main.ts`):
1. `CorrelationIdInterceptor` — assigns/propagates `X-Correlation-ID`
2. `TenantContextInterceptor` — establishes `TenantContext` via `AsyncLocalStorage`
3. `AuditInterceptor` — fire-and-forget HTTP event recording with categorical action strings

---

## 4. Existing Domains and Modules

### Identity (Core)
- **Responsibility:** Tenant lifecycle, user management, JWT authentication, refresh token rotation.
- **Entities:** `Tenant` (aggregate root), `User` (entity)
- **Value Objects:** `TenantSlug`, `TenantName`, `Email`
- **Domain Events:** `TenantCreated` (defined; not dispatched to any bus yet)
- **Use Cases:** CreateTenant, GetTenant, CreateUser, Login, RefreshToken
- **Ports:** `ITenantRepository`, `IUserRepository`, `IRefreshTokenRepository`
- **Auth flow:** argon2id password verification → JWT (15m, HS256, configurable via `JWT_EXPIRES_IN`) + SHA-256-hashed refresh token (7d, configurable via `JWT_REFRESH_EXPIRES_IN`). Token rotation on use (old token marked `used=true`).
- **Defect:** `RefreshTokenHandler.execute()` returns `expiresIn: 15 * 60` hardcoded; does not derive from `JWT_EXPIRES_IN` (DEFECT-001).

### Companies (Core)
- **Responsibility:** Company aggregate, per-tenant company registry, identification validation.
- **Entities:** `Company` (aggregate root)
- **Value Objects:** `IdentificationNumber`, `IdentificationType`
- **Use Cases:** CreateCompany, GetCompany
- **Hacienda verification:** Best-effort, non-blocking at creation. Stores `haciendaVerificationStatus` ∈ {VERIFIED, NOT_FOUND, UNAVAILABLE, ERROR, SKIPPED}. Company creation never fails due to Hacienda unavailability (DEC-003 / FR-015).
- **DB constraint:** `UNIQUE(tenantId, identificationNumber)`.

### API Keys (Core)
- **Responsibility:** API key lifecycle (create, list, revoke, validate), scope management.
- **Entities:** `ApiKey` (aggregate root)
- **Value Objects:** `ApiKeyScope`
- **Use Cases:** CreateApiKey, ListApiKeys, RevokeApiKey, ValidateApiKey
- **Security:** Raw key never stored; `argon2id` hash persisted. Format: `bk_{env}_{prefix}_{random}`.
- **Scopes validated at creation** (fase-1): invalid scopes rejected at use-case level.
- **N:M relation:** `api_key_companies` table links keys to authorized companies.
- **Rate limiting:** `ApiKeyThrottlerGuard` — 100 req/min per key prefix (ThrottlerModule Layer A, 60000ms TTL).

### Audit (Supporting — @Global)
- **Responsibility:** Append-only operation log with three retention classes.
- **Entities:** `AuditLog` (entity)
- **Retention classes:** `FISCAL_AUDIT` (≥5 years), `TECHNICAL` (configurable), `SECURITY` (configurable)
- **Append-only enforcement:** Application layer only (`AuditService.record()` — fire-and-forget). No DB-level constraint (AUD-DB01 — open).
- **AuditInterceptor** builds categorical action strings: `{HTTP_METHOD}.{ControllerName}.{handlerName}` normalized to lowercase-kebab.
- **Fields recorded:** tenantId, companyId, apiKeyId, actor, action, resource, endpoint, httpMethod, statusCode, ipAddress, correlationId, durationMs, eventClass, metadata, errorMessage.

### Taxpayers (Supporting)
- **Responsibility:** Public Hacienda taxpayer lookup.
- **Use Cases:** GetTaxpayer → `HaciendaPort.getTaxpayer()`
- **Auth:** X-API-Key with `taxpayers:read` scope.

### CABYS (Supporting)
- **Responsibility:** CABYS catalogue lookup and search.
- **Use Cases:** GetCabysItem, SearchCabys → `HaciendaPort.getCabys()` / `.searchCabys()`
- **Auth:** X-API-Key with `cabys:read` scope.

### Exchange Rates (Supporting)
- **Responsibility:** Hacienda exchange rate by currency and date.
- **Use Cases:** GetExchangeRate → `HaciendaPort.getExchangeRate()`
- **Auth:** X-API-Key with `exchange-rates:read` scope.

### Hacienda Connection (Core)
- **Responsibility:** Per-company, per-environment Hacienda OIDC credential management.
- **Entities:** `HaciendaConnection` (aggregate root)
- **Statuses:** NOT_CONFIGURED → PENDING_VALIDATION → CONNECTED | INVALID_CREDENTIALS | UNAVAILABLE | DISABLED
- **Invariant:** DISABLED connection cannot transition to any other status (`assertNotDisabled()`).
- **Use Cases:** ConfigureConnection, GetConnection, ValidateConnection, DisableConnection
- **Ports:** `IHaciendaConnectionRepository`, `HaciendaAuthPort`
- **Adapters:** `HaciendaOidcAuthAdapter` (ROPC grant to Hacienda IDP), `MockHaciendaAuthAdapter`
- **Token cache:** `HaciendaTokenCache` — in-memory per process, keyed by `(companyId, environment)`. Expiry check with 30s safety margin. **Single-process limitation** (AUD-SEC02).
- **Secret reference:** `secretReference` column stores a pointer key to the credential in `SecretProviderPort`; raw credentials never stored in DB or returned by API.
- **Auth requirement:** `JwtAuthGuard` on all connection endpoints. `@SkipThrottle()` applied.
- **Audit:** All 4 operations emit audit log entries.

### Shared Domain (Generic)
- **Location:** `src/modules/shared/domain/`
- **Provides:** `AggregateRoot<TId>`, `BaseEntity<TId>`, `ValueObject<TProps>`, `DomainEvent`, `DomainException`, `IRepository<T, TId>`

---

## 5. Main Use Cases

| Use Case | Module | Auth | HTTP Method + Path |
|---|---|---|---|
| Create Tenant | Identity | None | POST /api/v1/tenants |
| Get Tenant | Identity | JWT | GET /api/v1/tenants/:id |
| Login | Identity | None | POST /api/v1/auth/login |
| Refresh Token | Identity | None | POST /api/v1/auth/refresh |
| Create Company | Companies | JWT | POST /api/v1/companies |
| Get Company | Companies | JWT | GET /api/v1/companies/:id |
| Create API Key | API Keys | JWT | POST /api/v1/api-keys |
| List API Keys | API Keys | JWT | GET /api/v1/api-keys |
| Revoke API Key | API Keys | JWT | DELETE /api/v1/api-keys/:id |
| Get Taxpayer | Taxpayers | API Key (`taxpayers:read`) | GET /api/v1/taxpayers/:id |
| Get CABYS Item | CABYS | API Key (`cabys:read`) | GET /api/v1/cabys/:code |
| Search CABYS | CABYS | API Key (`cabys:read`) | GET /api/v1/cabys?search= |
| Get Exchange Rate | Exchange Rates | API Key (`exchange-rates:read`) | GET /api/v1/exchange-rates |
| Configure Connection | Hacienda Connection | JWT | PUT /api/v1/companies/:id/hacienda-connection/:env |
| Get Connection | Hacienda Connection | JWT | GET /api/v1/companies/:id/hacienda-connection/:env |
| Validate Connection | Hacienda Connection | JWT | POST /api/v1/companies/:id/hacienda-connection/:env/validate |
| Disable Connection | Hacienda Connection | JWT | DELETE /api/v1/companies/:id/hacienda-connection/:env |

---

## 6. Current Data Flows

### JWT Authentication Flow
```
POST /auth/login → LoginHandler
  → UserRepository.findByEmail() [tenant-scoped]
  → argon2id.verify(password, hash)
  → JwtService.sign({ sub, tenantId, role, jti }, expiresIn: 15m)
  → generate random refresh token → SHA-256 hash → RefreshTokenRepository.save()
  → return { accessToken, refreshToken, expiresIn: 900 [hardcoded — DEFECT-001] }
```

### API Key Auth + Scope Enforcement
```
GET /api/v1/taxpayers/:id
  → ApiKeyAuthGuard: extract X-API-Key header, lookup by prefix, argon2id.verify → req.apiKey
  → ApiKeyThrottlerGuard: 100/min per keyPrefix (Layer A)
  → ScopeGuard: require ['taxpayers:read'] (AND semantics, fail-closed)
  → GetTaxpayerHandler → HaciendaPort.getTaxpayer()
```

### Hacienda Outbound Call Flow
```
HaciendaPort.getTaxpayer(id) [via HaciendaApiAdapter]
  → HaciendaCircuitBreaker.execute(fn)
      state == OPEN && within timeout → throw HaciendaUnavailableException('circuit-open')
      state == OPEN && timeout elapsed → transition to HALF_OPEN
      → enforceOutboundRateLimit (≤8 req/s sliding window, configurable via HACIENDA_CB_OUTBOUND_RATE_PER_SECOND)
      → executeWithRetry(fn, attempt=0):
          HTTP GET https://api.hacienda.go.cr/fe/ae/{id}
          HTTP 429 → linear backoff retry (up to HACIENDA_RETRY_429_COUNT=2, delay×(attempt+1))
          HTTP 5xx/timeout/ECONNABORTED → fixed delay retry (up to HACIENDA_RETRY_5XX_COUNT=1)
          success → onSuccess() → reset failureCount; HALF_OPEN→CLOSED if applicable
          failure → onFailure() → failureCount++; CLOSED→OPEN if failureCount>=HACIENDA_CB_FAILURE_THRESHOLD=5
  → parse response (not-found detected via body.code === 404, not HTTP status)
  → cache result (key: 'taxpayer:{id}', TTL: TAXPAYER_CACHE_TTL_MS=3600000)
  → return TaxpayerResult (Billing-owned field names only — BR-012)
```

### Tenant Context Propagation
```
Any authenticated HTTP request:
  TenantContextInterceptor.intercept()
    → extract tenantId from req.user.tenantId (JWT) OR req.apiKey.tenantId (API key)
    → TenantContext.run(tenantId, handler)  [AsyncLocalStorage]

  In any TenantAwarePrismaRepository method:
    this.tenantId → TenantContext.getTenantId()
    every query WHERE clause: { ...userWhere, tenantId: this.tenantId }
```

---

## 7. Database and Persistence

### ORM and Database
- **ORM:** Prisma v5.17, `prisma-client-js` generator.
- **Database:** PostgreSQL 15 (Alpine in Docker).
- **Connection:** singleton `PrismaService` injectable, provided by `DatabaseModule`.

### Schema — Tables

| Table | Purpose | Tenant-scoped |
|---|---|---|
| `tenants` | Tenant registry | — (root) |
| `companies` | Company registry | ✅ |
| `hacienda_connections` | Per-company Hacienda OIDC connection config | ✅ |
| `users` | User accounts | ✅ |
| `api_keys` | API keys | ✅ |
| `api_key_companies` | API key ↔ company N:M | ✅ (via company) |
| `refresh_tokens` | Hashed refresh tokens | ✅ (via user) |
| `audit_logs` | Append-only operation log | ✅ (optional) |

### Applied Migrations

| Migration | Description |
|---|---|
| `20250001000000_initial_foundation` | tenants, users, api_keys, api_key_companies, refresh_tokens, audit_logs (with EventClass enum) |
| `20250002000000_company_hacienda_fields` | Adds hacienda_name, hacienda_verified_at, hacienda_verification_status to companies |
| `20250003000000_hacienda_connection` | hacienda_connections table with HaciendaConnectionStatus and HaciendaEnvironment enums |

### Key Constraints and Indexes
- `tenants.slug` — UNIQUE
- `users(tenantId, email)` — UNIQUE
- `companies(tenantId, identificationNumber)` — UNIQUE
- `hacienda_connections(companyId, environment)` — UNIQUE (one per company per environment)
- `api_keys.keyPrefix` — UNIQUE
- `refresh_tokens.tokenHash` — UNIQUE
- `audit_logs`: indexes on `(tenantId, createdAt DESC)`, `correlationId`, `(apiKeyId, createdAt DESC)`, `(action, createdAt DESC)`, `(eventClass, createdAt DESC)`

### Persistence Patterns
- All tenant-scoped repositories extend `TenantAwarePrismaRepository`.
- `applyTenantFilter(where)` always merges `tenantId: TenantContext.getTenantId()` into every WHERE clause.
- `audit_logs` has no UPDATE/DELETE in `PrismaAuditLogRepository` — append-only at application layer.

---

## 8. APIs and Integrations

### HTTP API
- **Global prefix:** `/api/v1` (excludes `/health`, `/health/ready`, `/health/live`)
- **Swagger/OpenAPI:** `/api/docs` — non-production environments only
- **Global validation pipe:** `whitelist: true, forbidNonWhitelisted: true, transform: true`
- **Standard error envelope:**
  ```json
  {
    "error": {
      "code": "DOMAIN_CODE",
      "message": "Human-readable message",
      "correlationId": "uuid",
      "timestamp": "ISO-8601",
      "details": {}
    }
  }
  ```

### CORS
- Configured via `CORS_ALLOWED_ORIGINS` env var.
- **In production/staging:** fatal startup error if absent or `*` — enforced by Joi validation schema (pre-fase-2-hardening).
- **In development/test:** defaults to `*`.
- Exposed response headers: `X-Correlation-ID`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- Allowed request headers: `Content-Type`, `Authorization`, `X-API-Key`, `X-Correlation-ID`, `Idempotency-Key`.
- Preflight cache: 24 hours (`maxAge: 86400`).

### Hacienda Public API (`api.hacienda.go.cr`)
- **Port:** `HaciendaPort` (Symbol: `HACIENDA_PORT`)
- **Adapters:** `HaciendaApiAdapter` (real) or `MockHaciendaAdapter` (default)
- **Toggle:** `USE_REAL_HACIENDA` env var (default: `false`)
- **Endpoints consumed:** `/fe/ae/{id}` (taxpayer), `/indicadores/tc/{currency}/{date}` (exchange rate), `/fe/cabys` (CABYS)
- **Resilience:** `HaciendaCircuitBreaker` with 7 configurable parameters (all via `ConfigService`; defaults are production-safe)
- **In-memory cache:** `@nestjs/cache-manager` (cache-manager v7, millisecond TTLs)
- **Cache TTL defaults:** taxpayer 1h, exchange rate 4h, CABYS item 24h, CABYS search 1h

### Hacienda Private IDP (`idp.comprobanteselectronicos.go.cr`)
- **Port:** `HaciendaAuthPort` (Symbol: `HACIENDA_AUTH_PORT`)
- **Adapters:** `HaciendaOidcAuthAdapter` (real) or `MockHaciendaAuthAdapter`
- **Grant:** ROPC — sends `grant_type`, `client_id`, `username`, `password` only (no `scope`)
- **Token cache:** `HaciendaTokenCache` — in-memory, per process, key `(companyId, environment)`, 30s safety margin
- **Environments:** PRODUCTION IDP (`/rut`), SANDBOX IDP (`/rut-stag`)

### AWS Services
- **S3 / LocalStack:** document storage via `StoragePort` (not yet used for business documents)
- **SSM Parameter Store:** optional `SecretProviderPort` backend (`SECRET_PROVIDER=env|ssm`)

---

## 9. Authentication and Authorization

### JWT Authentication
- **Guard:** `JwtAuthGuard` (passport-jwt, HS256)
- **Payload:** `{ sub: userId, tenantId, role, jti }`
- **Access token TTL:** 15 minutes (configurable: `JWT_EXPIRES_IN`)
- **Refresh token TTL:** 7 days (configurable: `JWT_REFRESH_EXPIRES_IN`), stored as SHA-256 hash, rotated on use
- **Secret:** resolved via `SecretProviderPort.getSecret('JWT_SECRET')` — never hardcoded

### API Key Authentication
- **Guard:** `ApiKeyAuthGuard`
- **Header:** `X-API-Key`
- **Format:** `bk_{env}_{prefix}_{random}` — prefix used for DB lookup; full key verified via argon2id
- **Scopes:** string array on `ApiKey` entity. Validated against known scopes at creation time.
- **Rate limit guard:** `ApiKeyThrottlerGuard` — 100 req/min per key prefix (Layer A)
- **Auth rate limit:** 10 req/min per IP on `/auth/login` and `/auth/refresh` (Layer B)

### Scope Enforcement (ScopeGuard)
- **Semantics:** AND — all declared scopes must be present.
- **Fail-closed:** scopes declared + no API key present → `403 INSUFFICIENT_SCOPE`.
- **No scopes declared:** open to all authenticated principals.
- **Guard chain:** `ApiKeyAuthGuard` → `ApiKeyThrottlerGuard` → `ScopeGuard`

### Tenant Isolation
- `TenantContextInterceptor` uses `AsyncLocalStorage` to propagate `tenantId` for the lifetime of each request.
- `TenantAwarePrismaRepository.applyTenantFilter()` injects `WHERE tenant_id` into every query automatically.
- **Open risk:** `GET /api/v1/tenants/:id` does not validate that `:id` matches the JWT `tenantId` — potential cross-tenant read (AUD-API01).

---

## 10. Events and Background Processing

### Domain Events
- `TenantCreated` event class is defined but **never dispatched** to any handler or external bus.
- `AggregateRoot.clearDomainEvents()` exists but is never called in any current use case.

### Job Queue
- **Port:** `JobQueuePort` (Symbol: `JOB_QUEUE`)
- **Production adapter:** `PgBossJobQueue` (pg-boss v10, uses the same PostgreSQL instance)
- **Test adapter:** `InMemoryJobQueue` (used when `NODE_ENV=test`)
- **Current status:** No job handlers registered (AUD-API04 — open). Worker process boots but processes no work.

### Background Worker
- `worker.main.ts` creates a NestJS application context with `AppModule`.
- No job consumers or handler registrations exist. The worker is a shell only.

---

## 11. Containers and Deployment

### Dockerfile
- **Multi-stage:** `deps` (all dependencies + build tools for argon2) → `builder` (prisma generate, build, prune) → `runner` (non-root `billing:billing`, UID 1001, `NODE_ENV=production`)
- **Health check:** `wget -qO- http://localhost:3000/health` every 30s, 10s timeout, 30s start period, 3 retries
- **Default CMD:** `node dist/bootstrap/api.main.js`
- **No `helmet` middleware** — AUD-SEC01 open.

### Docker Compose
- **Services:** postgres (15-alpine), localstack (3, S3 only), billing-api, billing-worker
- **CORS in compose:** `CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-http://localhost:3000}` — shell variable substitution (pre-fase-2-hardening fix)
- **Circuit breaker parameters:** all 7 configurable via shell variables with production-safe defaults
- **Secrets:** passed as environment variables — no Docker secrets or Vault

### CI (GitHub Actions — `.github/workflows/ci.yml`)
- **Triggers:** push/PR to `main` and `develop`
- **Gate order:** lint → typecheck → [test ‖ build] → e2e
  - lint and typecheck run in parallel; both include `npx prisma generate` (pre-fase-2-hardening)
  - test and build each depend on lint + typecheck, run in parallel
  - e2e depends on both test and build
- **Unit test job:** PostgreSQL service container, `NODE_ENV=test`, `USE_REAL_HACIENDA=false`
- **E2E job:** separate PostgreSQL service, `npx prisma migrate deploy`, `USE_REAL_HACIENDA=false`
- **No deployment step** — CI validates only; no CD committed (AUD-D02 open)

---

## 12. Current Testing Strategy

### Unit/Domain/Application Tests (`src/**/*.spec.ts`)
- **24 suites, 163 tests, 0 failures** (post pre-fase-2-hardening validated baseline).
- Runner: Jest with ts-jest, `rootDir: src`.
- Coverage: entity invariants, value object validation, use-case handlers (mocked ports), guards, interceptors, filter, config schema (Joi rules), Hacienda adapters (fixture-based), circuit breaker (state machine + retry), tenant context, secret provider, queue adapters.

### E2E Tests (`test/e2e/`)
- 7 suites using `@nestjs/testing`, `supertest`, real Prisma against PostgreSQL test DB.
- `test-factories.ts`: direct Prisma inserts to set up test data, generates valid 10-digit JURIDICA IDs.
- **Suites:** fase0/api-keys, fase0/auth, fase0/health, fase0/tenant-isolation, fase1/hacienda-endpoints, fase1/scope-guard, fase2/hacienda-connection.

### Gaps
- No tests for worker job handlers (none implemented).
- No XmlSignerPort implementation tests (no adapter exists).
- No contract tests for Hacienda API response schemas.
- No fiscal document domain (not yet implemented).

---

## 13. Behavior to Preserve

1. **Tenant isolation:** Every query on a tenant-scoped table must include `WHERE tenant_id = TenantContext.getTenantId()`. Must never be weakened.
2. **API key argon2id hashing:** Raw key material must never be stored, logged, or returned after creation.
3. **Refresh token rotation:** Old token marked `used=true` before new one issued. Reuse of a consumed token must be rejected.
4. **ScopeGuard fail-closed:** Scopes declared + no API key → deny. Never pass through unauthenticated.
5. **Hacienda best-effort on company creation:** `CreateCompany` must never fail due to Hacienda unavailability. Verification status must always be stored.
6. **Audit append-only:** `AuditService.record()` must never update or delete existing records.
7. **CORS production enforcement:** App must refuse to start in production/staging if `CORS_ALLOWED_ORIGINS` is `*` or absent (Joi validation fatal error).
8. **Circuit breaker state machine:** CLOSED → OPEN (after `failureThreshold` failures) → HALF_OPEN (after `resetTimeoutMs`) → CLOSED or re-OPEN depending on test call.
9. **HaciendaConnection disable guard:** `assertNotDisabled()` prevents any state transition on a DISABLED connection.
10. **JWT secret via SecretProvider:** `JWT_SECRET` must flow through `SecretProviderPort`; direct `process.env` reads are forbidden in business code.
11. **Billing-owned Hacienda contracts (BR-012):** No Hacienda internal Spanish field names may appear outside the adapter.
12. **Not-found detection (BR-014):** Hacienda not-found is detected via `response.data.code === 404` (body), not HTTP status.

---

## 14. Known Defects

| ID | Severity | Location | Description |
|---|---|---|---|
| DEFECT-001 | Medium | `src/modules/identity/application/use-cases/refresh-token/refresh-token.handler.ts:L98` and `src/modules/identity/application/use-cases/login/login.handler.ts` | `expiresIn` in `RefreshTokenResult` and `LoginResult` is hardcoded to `15 * 60` (900s) in both handlers. Does not derive from `JWT_EXPIRES_IN` env var. `auth-token-duration.ts` was added and correctly used to compute refresh token `expiresAt`, but the response hint field `expiresIn` still uses the literal `15 * 60` in both handlers. |

---

## 15. Architectural Debt

| ID | Severity | Location | Description |
|---|---|---|---|
| AUD-API01 | High | `src/modules/identity/infrastructure/http/tenant.controller.ts` | `GET /api/v1/tenants/:id` does not verify that `:id` matches the authenticated user's `tenantId`. A user could potentially read another tenant's data. |
| AUD-SEC01 | High | `src/bootstrap/api.main.ts` | No `helmet` middleware configured. HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.) are absent. |
| AUD-API04 | Medium | `src/bootstrap/worker.main.ts` | Worker process boots with full `AppModule` but has no job handler registrations. `PgBossJobQueue` is initialized but nothing is consumed. |
| AUD-DB01 | Medium | `src/modules/audit/infrastructure/persistence/prisma-audit-log.repository.ts` | Audit append-only is enforced only at the application layer. No database-level constraint (trigger, RLS, or append-only role) prevents direct mutations. |
| AUD-SEC02 | Medium | `src/modules/hacienda-connection/infrastructure/auth/hacienda-token-cache.service.ts` | `HaciendaTokenCache` is in-memory and per-process. Multi-instance deployments cause each instance to authenticate independently, potentially exceeding Hacienda IDP rate limits. |
| AUD-D02 | Low | `.github/workflows/ci.yml` | CI pipeline has no deployment stage. No CD pipeline is committed to the repository. |

---

## 16. Security Risks

| ID | Severity | Description |
|---|---|---|
| AUD-SEC01 | High | No HTTP security headers. `helmet` not configured. CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy are all absent. |
| AUD-API01 | High | Potential cross-tenant read: `GET /tenants/:id` does not enforce ownership check against JWT `tenantId`. |
| AUD-SEC02 | Medium | In-memory Hacienda token cache is single-process. Multi-instance deployments have no shared token state, causing redundant Hacienda IDP authentication. |
| AUD-DB01 | Medium | Audit log append-only is application-only. A compromised application process or direct DB access could mutate fiscal audit records. |
| DEFECT-001 | Low | Hardcoded `expiresIn: 15 * 60` in refresh token response may mislead clients about actual token lifetime if `JWT_EXPIRES_IN` is reconfigured. |

---

## 17. Unknowns and Assumptions

1. **Audit score corrected:** `docs/audit/current-code-audit.md` is committed (commit `9854900`). Score corrected from 8.2 to 8.8 — the `baseline-audit-agent` tool returned empty listings for existing directories (environment bug); CI/CD scored 3.0 and Documentation scored 5.0 erroneously. Corrected scores: CI/CD 8.0 (pipeline fully committed, only missing CD deployment step), Documentation 7.0 (4 docs tracked; others gitignored by policy).
2. **AUD-D02 (CD pipeline):** It is unknown whether a deployment pipeline exists externally. Assumed intentionally deferred.
3. **Worker job handler design:** No specification exists for what jobs the worker processes. Assumed: fiscal document submission and Hacienda status polling are the expected use cases (Fase 2+).
4. **XmlSignerPort library:** ADR-005 references a pending technical spike. Library selection (e.g., `xades4j`, `xmldsigjs`) has not been decided. No implementation is committed.
5. **SSM secret path convention:** `SSM_PARAMETER_PREFIX` defaults to `/billing`. The actual path for Hacienda credentials stored via `secretReference` is not yet formalized.
6. **Multi-tenant email scope:** Email uniqueness is scoped per tenant `(tenantId, email)`, not globally. This is intentional by design.

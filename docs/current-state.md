# Current State

> **Document owner:** hdd-architecture-agent-2c1857
> **Last updated:** 2025-07-13 (post Fase 0 implementation)
> **Reflects:** Fase 0: Foundation — all 19 tasks completed and verified

This document describes only what is currently implemented and observable in the repository.
It is the source of truth for current behavior and verified structure.

---

## 1. System Overview

**Billing** is a multi-tenant SaaS platform for Costa Rica electronic invoicing
(Comprobantes Electrónicos, governed by Hacienda / MH-DGT Versión 4.3).
It is currently in **Fase 0: Foundation** — the infrastructure layer is complete
and operational; no invoice-generation business logic has been implemented yet.

| Property | Value |
|---|---|
| Project name | billing |
| Version | 0.1.0 |
| Phase | Fase 0: Foundation (complete) |
| Runtime | Node.js v20 LTS |
| Framework | NestJS v10 |
| Language | TypeScript 5.5 (strict mode) |
| Database | PostgreSQL 15+ |
| ORM | Prisma v5.17 |
| Queue | pg-boss v10 (PostgreSQL-backed) |
| Auth | JWT (access) + API Keys |
| Storage | LocalStorageAdapter (dev) / S3StorageAdapter (prod) |
| Secrets | EnvSecretProvider (dev) / AwsParameterStoreSecretProvider (prod) |

---

## 2. Repository Structure

```
billing/
├── src/
│   ├── app.module.ts                    — Root NestJS module
│   ├── bootstrap/
│   │   ├── api.main.ts                  — HTTP server entry point
│   │   └── worker.main.ts               — Background worker entry point
│   ├── api/                             — HTTP adapter layer (input)
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts
│   │   ├── guards/
│   │   │   ├── api-key-auth.guard.ts
│   │   │   └── jwt-auth.guard.ts
│   │   ├── health/
│   │   │   ├── health.controller.ts
│   │   │   └── indicators/
│   │   │       └── prisma.health-indicator.ts
│   │   ├── interceptors/
│   │   │   ├── audit.interceptor.ts
│   │   │   ├── correlation-id.interceptor.ts
│   │   │   └── tenant-context.interceptor.ts
│   │   └── strategies/
│   │       └── jwt.strategy.ts
│   ├── infrastructure/                  — Cross-cutting infrastructure
│   │   ├── config/                      — ConfigModule + Joi validation
│   │   ├── database/                    — PrismaService + TenantAwarePrismaRepository
│   │   ├── integrations/hacienda/       — HaciendaPort + Mock + API stub
│   │   ├── queue/                       — JobQueuePort + pg-boss + InMemory adapters
│   │   ├── secrets/                     — SecretProvider (env / SSM)
│   │   ├── signing/                     — XmlSignerPort interface (no implementation)
│   │   ├── storage/                     — StoragePort + Local + S3 adapters
│   │   └── tenant/                      — TenantContext (AsyncLocalStorage)
│   └── modules/                         — Business modules
│       ├── shared/domain/               — Shared Domain Kernel
│       ├── identity/                    — Tenant + User aggregates + Auth
│       ├── companies/                   — Company aggregate
│       ├── api-keys/                    — ApiKey entity + CRUD handlers
│       └── audit/                       — AuditLog (append-only)
├── prisma/
│   ├── schema.prisma                    — 7 models, 9 ENUMs
│   ├── migrations/
│   │   └── 20250001000000_initial_foundation/migration.sql
│   └── seed.ts                          — First admin user creation
├── test/
│   ├── e2e/fase0/                       — 4 E2E test suites
│   └── helpers/test-factories.ts
├── Dockerfile                           — 3-stage multi-stage build
├── docker-compose.yml                   — postgres + localstack + api + worker
├── package.json
├── tsconfig.json
├── .eslintrc.js
└── .env.local.example
```

---

## 3. Current Architecture

**Style:** Modular Monolith with Hexagonal Architecture (Ports & Adapters).

There is one deployable application built from a single codebase.
Two entry points exist:
- `api.main.ts` — starts an Express HTTP server on port 3000 via NestJS.
- `worker.main.ts` — starts a NestJS application context (no HTTP); intended for
  background job workers. Currently no job handlers are registered.

**Layer structure (from outer to inner):**

```
┌───────────────────────────────────────────────────────────┐
│  Input Adapters (src/api/)                                │
│  Controllers · Guards · Interceptors · Filters            │
├───────────────────────────────────────────────────────────┤
│  Application Layer (modules/*/application/)               │
│  Use Case Handlers · Commands · Queries                   │
├───────────────────────────────────────────────────────────┤
│  Domain Layer (modules/*/domain/)                         │
│  Entities · Value Objects · Aggregates · Domain Events    │
│  Domain Exceptions · Port Interfaces                      │
├───────────────────────────────────────────────────────────┤
│  Output Adapters (modules/*/infrastructure/ +             │
│  src/infrastructure/)                                     │
│  Prisma Repositories · Queue · Storage · Secrets          │
│  Hacienda Integration                                     │
└───────────────────────────────────────────────────────────┘
```

**Request lifecycle:**
1. HTTP request arrives at Express (NestJS platform).
2. `CorrelationIdInterceptor` assigns or propagates `X-Correlation-ID`.
3. `JwtAuthGuard` or `ApiKeyAuthGuard` validates credentials; populates
   `request.user` / `request.apiKey`.
4. `TenantContextInterceptor` wraps the handler in `TenantContext.run(tenantId, fn)`,
   establishing AsyncLocalStorage for downstream tenant isolation.
5. Controller delegates to the application use-case handler.
6. Handler calls domain objects; domain calls repository ports.
7. `TenantAwarePrismaRepository` automatically appends `WHERE tenant_id = $tenantId`
   to every query.
8. Response returns through NestJS pipeline.
9. `AuditInterceptor` fires-and-forgets an audit log entry (success or failure).
10. `GlobalExceptionFilter` maps `DomainException` → structured HTTP error. Unknown
    exceptions produce 500 with no stack trace in production.

**Global NestJS configuration (api.main.ts):**
- Global API prefix: `/api/v1` (health endpoints excluded).
- `GlobalExceptionFilter` registered globally.
- `ValidationPipe` registered globally (whitelist + forbidNonWhitelisted + transform).
- Interceptor registration order: `CorrelationIdInterceptor` → `TenantContextInterceptor`
  → `AuditInterceptor` (resolved from DI container via `app.get()`).
- Swagger/OpenAPI enabled at `/api/docs` in non-production environments only.
- Graceful shutdown hooks enabled.

---

## 4. Existing Domains and Modules

### 4.1 Shared Domain Kernel (`src/modules/shared/domain/`)

Not a NestJS module with business logic. A collection of pure TypeScript base classes
and interfaces used by all domain modules.

| Artifact | Description |
|---|---|
| `BaseEntity<TId>` | Abstract base for all entities. Carries `id`, `createdAt`, `updatedAt`. Value equality by id. |
| `AggregateRoot<TId>` | Extends `BaseEntity`. Adds domain event accumulation (`addDomainEvent`, `clearDomainEvents`). |
| `ValueObject<T>` | Abstract base for value objects. Props are frozen. Structural equality via JSON comparison. |
| `DomainEvent` | Base interface for domain events. |
| `DomainException` | Abstract base class for domain exceptions. Carries `code`, `message`, `httpStatus`. Mapped to HTTP by `GlobalExceptionFilter`. |
| `Repository<T>` | Minimal generic repository interface. |

### 4.2 ConfigModule (`src/infrastructure/config/`)

- NestJS `@Global` module wrapping `@nestjs/config`.
- Joi schema validates all environment variables at startup; aborts immediately if invalid.
- Named config factories: `app.config`, `database.config`, `auth.config`,
  `storage.config`, `secrets.config`.
- JWT_SECRET requires ≥ 32 chars in production; defaults to insecure value in development.
- Imported in `AppModule`.

### 4.3 DatabaseModule (`src/infrastructure/database/`)

- NestJS `@Global` module.
- Provides `PrismaService` (extends `PrismaClient`).
- `TenantAwarePrismaRepository` — abstract base class for all tenant-scoped Prisma
  repositories. Reads `tenantId` from `TenantContext` and applies it automatically
  via `applyTenantFilter()`.
- Imported in `AppModule`.

### 4.4 TenantContext (`src/infrastructure/tenant/`)

- `TenantContext` — static class backed by Node.js `AsyncLocalStorage`.
- `TenantContext.run(tenantId, fn)` — wraps async execution in a tenant scope.
- `TenantContext.getTenantId()` — throws `TenantContextNotSetException` if not set.
- `TenantContext.getTenantIdOrNull()` — safe version for optional context.
- `tenant-context.middleware.ts` exists but is NOT used; tenant context is established
  through `TenantContextInterceptor` instead (dead file).
- `TenantModule` (`tenant.module.ts`) exists but is minimal and not imported in `AppModule`.

### 4.5 AuditModule (`src/modules/audit/`)

- Registered in `AppModule`; decorated `@Global`.
- **Domain:** `AuditLog` — immutable entity (all fields `readonly`). Not an aggregate;
  does not extend `AggregateRoot`. No lifecycle methods.
- **Application:** `AuditService` — `record()` is fire-and-forget; errors are logged
  but do not propagate. `findByCorrelationId()` is a synchronous query.
- **Port:** `IAuditLogRepository` — exposes only `insert()` and `findByCorrelationId()`.
  No `update()` or `delete()` methods (append-only enforcement at interface level).
- **Adapter:** `PrismaAuditLogRepository`.
- **EventClass** values: `FISCAL_AUDIT` (≥5 years retention), `TECHNICAL` (configurable),
  `SECURITY` (configurable).
- All `AuditInterceptor` entries currently use `eventClass: 'TECHNICAL'`.

### 4.6 IdentityModule (`src/modules/identity/`)

Manages Tenants and Users plus JWT authentication.

**Domain entities:**
- `Tenant` — aggregate root. States: `ACTIVE`, `SUSPENDED`, `CANCELLED`.
  Plans: `TRIAL`, `STARTER`, `PROFESSIONAL`, `ENTERPRISE`.
  Factory: `Tenant.create()` → raises `TenantCreatedEvent`.
  Methods: `suspend()`, `activate()`. Slug is immutable after creation (BR-008).
- `User` — aggregate root. States: `ACTIVE`, `INACTIVE`, `PENDING_VERIFICATION`.
  Roles: `TENANT_ADMIN`, `MEMBER`, `READ_ONLY`.
  `passwordHash` never exposed in any DTO (BR-004).
  Method: `recordLogin()`.

**Value Objects:** `TenantName`, `TenantSlug` (kebab-case, 3–60 chars, globally unique),
`Email` (lowercase, RFC-compliant format).

**Domain Events:** `TenantCreatedEvent` (raised on creation, accumulated in aggregate,
not yet dispatched to any bus).

**Domain Exceptions:** `InvalidCredentialsException`, `InvalidRefreshTokenException`,
`TenantNotFoundException`, `TenantSlugAlreadyExistsException`, `UserNotFoundException`.

**Ports:** `ITenantRepository`, `IUserRepository`, `IRefreshTokenRepository`.

**Use-case handlers:**
- `CreateTenantHandler` — creates tenant + TENANT_ADMIN user atomically.
- `GetTenantHandler` — fetches tenant by ID.
- `CreateUserHandler` — creates additional users (internal use only).
- `LoginHandler` — validates credentials (argon2id verify), issues JWT + refresh token.
  JWT expiry read from `ConfigService`. Refresh token: 48-byte random, SHA-256 hashed.
- `RefreshTokenHandler` — validates refresh token hash, marks used, issues new pair
  (rotation). Reuse of a used token returns 401.

**Controllers:** `AuthController` (`/api/v1/auth`), `TenantController` (`/api/v1/tenants`).
Both secured with `JwtAuthGuard`.

**Infrastructure adapters:** `PrismaTenantRepository`, `PrismaUserRepository`,
`PrismaRefreshTokenRepository`.

### 4.7 CompaniesModule (`src/modules/companies/`)

**Domain entity:** `Company` — aggregate root. States: `ACTIVE`, `INACTIVE`.

**Value Objects:** `IdentificationType`, `IdentificationNumber`.

**CR identification validation (IdentificationNumber VO):**

| Type | Length |
|---|---|
| FISICA (Cédula física) | 9 digits |
| JURIDICA (Cédula jurídica) | 10 digits |
| DIMEX | 11–12 digits |
| NITE | 10 digits |

Non-digit characters are stripped before validation.

**Business rules:**
- Tenant-level uniqueness on `(tenantId, identificationNumber)` enforced at DB level.

**Domain Exceptions:** `CompanyAlreadyExistsException`, `CompanyNotFoundException`.

**Use-case handlers:** `CreateCompanyHandler`, `GetCompanyHandler`.

**Controller:** `CompanyController` (`/api/v1/companies`) secured with `JwtAuthGuard`.

**Infrastructure adapters:** `PrismaCompanyRepository` extends `TenantAwarePrismaRepository`.

### 4.8 ApiKeysModule (`src/modules/api-keys/`)

**Domain entity:** `ApiKey` — aggregate root. States: `ACTIVE`, `REVOKED`, `EXPIRED`.
Environments: `LIVE`, `TEST`.

**Key format:** `bk_{env}_{prefix8}_{secret32}`
- `prefix8`: 8-char hex stored in plaintext for fast lookup.
- `secret32`: 32-char hex hashed with argon2id — shown only once at creation, never
  stored in plaintext (BR-001).

**Business rules:**
- `revoke()` is idempotent — revoking an already-revoked key is a no-op (BR-005).
- `recordUsage()` updates `lastUsedAt`.
- Expiry: if `expiresAt` is set and current time > `expiresAt`, key is considered expired.

**Domain Exceptions:** `ApiKeyExpiredException`, `ApiKeyInvalidException`,
`ApiKeyNotFoundException`, `ApiKeyRevokedException`.

**Port:** `IApiKeyRepository`.

**Use-case handlers:**
- `CreateApiKeyHandler` — generates prefix, hashes secret with argon2id, persists, returns
  full raw key only once.
- `ListApiKeysHandler` — returns all keys for current tenant (no secrets exposed).
- `RevokeApiKeyHandler` — marks key revoked; idempotent.
- `ValidateApiKeyHandler` — parses format, looks up by prefix, verifies argon2id hash,
  checks status/expiry. Records usage timestamp.

**Controller:** `ApiKeysController` (`/api/v1/api-keys`) secured with `JwtAuthGuard`.

**Guard:** `ApiKeyAuthGuard` — validates `X-API-Key` header; populates `request.apiKey`
(full `ApiKey` entity) and `request.user.tenantId`. Ready for `ScopeGuard` in Fase 1
(scopes field exists in domain and DB but guard is not implemented).

**Infrastructure adapters:** `PrismaApiKeyRepository` extends `TenantAwarePrismaRepository`.

### 4.9 SecretsModule (`src/infrastructure/secrets/`)

- NestJS `@Global` module. Imported in `AppModule`.
- `SecretProvider` port: `get(key: string): Promise<string>`,
  `getOptional(key: string): Promise<string | null>`.
- `EnvSecretProvider` — reads from `process.env`.
- `AwsParameterStoreSecretProvider` — reads from AWS SSM Parameter Store
  (prefix: `SSM_PARAMETER_PREFIX`, default `/billing`).
- Selection: `SECRET_PROVIDER=env` → `EnvSecretProvider`; `SECRET_PROVIDER=ssm` → AWS.

### 4.10 QueueModule (`src/infrastructure/queue/`)

- **NOT imported in `AppModule`.** Exists as implemented infrastructure but not connected.
- `JobQueuePort` — `send(jobName, data, options?)` and `registerHandler(jobName, handler)`.
- `PgBossJobQueue` — wraps `pg-boss` library; uses PostgreSQL for job storage.
- `InMemoryJobQueue` — synchronous in-process execution for test environments.
- Selection: `NODE_ENV=test` → `InMemoryJobQueue`; otherwise → `PgBossJobQueue`.
- No job handlers are registered; this is Fase 0 scaffolding only.

### 4.11 HaciendaModule (`src/infrastructure/integrations/hacienda/`)

- **NOT imported in `AppModule`.** Exists as implemented infrastructure but not connected.
- `HaciendaPort` — 6 operations defined:
  - `getTaxpayer`, `getExchangeRate`, `getCabys`, `searchCabys` — Fase 1 targets.
  - `submitDocument`, `getDocumentStatus` — Fase 2+ targets.
- `MockHaciendaAdapter` — in-memory stub with predictable responses for all 6 methods.
- `HaciendaApiAdapter` — HTTP stub; does not yet call real Hacienda endpoints.
- Selection: `NODE_ENV=production` AND `USE_REAL_HACIENDA=true` → `HaciendaApiAdapter`;
  otherwise → `MockHaciendaAdapter`.

### 4.12 StorageModule (`src/infrastructure/storage/`)

- NestJS `@Global` module — but **NOT imported in `AppModule`**.
- `StoragePort` — `upload`, `download`, `delete`, `getSignedUrl` operations.
- `LocalStorageAdapter` — filesystem-based; uses `./storage` directory.
- `S3StorageAdapter` — AWS S3 or LocalStack; uses `@aws-sdk/client-s3`.
- Selection: `STORAGE_TYPE=local` → `LocalStorageAdapter`; `STORAGE_TYPE=s3` → `S3StorageAdapter`.

### 4.13 XmlSignerPort (`src/infrastructure/signing/`)

- Interface only: `XmlSignerPort` — `sign(xml, cert)` and `verify(signedXml)`.
- `Pkcs12Certificate` — `{ data: Buffer, passphrase: string }`.
- No implementation exists (ADR-005: XAdES spike required).
- Relevant for Fase 3 (electronic signature of invoices).

---

## 5. Main Use Cases

| Use Case | Handler | Endpoint | Auth | Status |
|---|---|---|---|---|
| Create Tenant | `CreateTenantHandler` | `POST /api/v1/tenants` | JWT | Implemented |
| Get Tenant | `GetTenantHandler` | `GET /api/v1/tenants/:id` | JWT | Implemented |
| Login | `LoginHandler` | `POST /api/v1/auth/login` | None | Implemented |
| Refresh Token | `RefreshTokenHandler` | `POST /api/v1/auth/refresh` | None | Implemented |
| Create User | `CreateUserHandler` | (internal — called by CreateTenant) | N/A | Implemented |
| Create Company | `CreateCompanyHandler` | `POST /api/v1/companies` | JWT | Implemented |
| Get Company | `GetCompanyHandler` | `GET /api/v1/companies/:id` | JWT | Implemented |
| Create API Key | `CreateApiKeyHandler` | `POST /api/v1/api-keys` | JWT | Implemented |
| List API Keys | `ListApiKeysHandler` | `GET /api/v1/api-keys` | JWT | Implemented |
| Revoke API Key | `RevokeApiKeyHandler` | `DELETE /api/v1/api-keys/:id` | JWT | Implemented |
| Validate API Key | `ValidateApiKeyHandler` | (internal — called by ApiKeyAuthGuard) | N/A | Implemented |
| Liveness Check | `HealthController` | `GET /health`, `GET /health/live` | None | Implemented |
| Readiness Check | `HealthController` | `GET /health/ready` | None | Implemented |

---

## 6. Current Data Flows

### Login flow
1. `POST /api/v1/auth/login` → `AuthController.login()` → `LoginHandler.execute()`.
2. `UserRepository.findByEmail(tenantId, email)` — Prisma query scoped to tenant.
3. `argon2.verify(storedHash, inputPassword)` — generic 401 on any failure (BR-004).
4. `JwtService.sign({ sub, tenantId, role, jti })` — access token.
5. `crypto.randomBytes(48)` for refresh token; SHA-256 hash stored in `refresh_tokens`.
6. Returns `{ accessToken, refreshToken, expiresIn: 900 }`.

### Authenticated API request flow
1. `Authorization: Bearer <jwt>` → `JwtStrategy.validate()` → `request.user = { userId, tenantId, role }`.
2. `TenantContextInterceptor` wraps handler: `TenantContext.run(tenantId, () => lastValueFrom(next.handle()))`.
3. Controller → handler → domain → `TenantAwarePrismaRepository.applyTenantFilter()`.
4. All repository queries include `WHERE tenant_id = <tenantId>` automatically.

### API Key request flow
1. `X-API-Key: bk_{env}_{prefix8}_{secret32}` → `ApiKeyAuthGuard.canActivate()`.
2. Parse prefix from key; query `api_keys WHERE key_prefix = prefix`.
3. `argon2.verify(storedKeyHash, rawSecret)`.
4. Set `request.apiKey` + `request.user = { tenantId: apiKey.tenantId }`.
5. `TenantContextInterceptor` establishes async context.

### Audit flow (fire-and-forget)
1. `AuditInterceptor` captures request metadata before handler runs.
2. On response (tap): calls `AuditService.record(...)` — catches errors internally.
3. On error (tap): calls `AuditService.record(...)` with `errorMessage` and error status code.

---

## 7. Database and Persistence

### Technology
- PostgreSQL 15+ with Prisma ORM v5.17 (Prisma Client JS).
- Single database; single migration applied: `20250001000000_initial_foundation`.

### Tables

| Table | Description | Tenant-scoped |
|---|---|---|
| `tenants` | Tenant registry. Slug unique globally. | No (root table) |
| `users` | Users scoped to a tenant. Email unique per tenant. | Yes |
| `companies` | Legal entities for invoicing. Identification unique per tenant. | Yes |
| `api_keys` | API keys for system access. Prefix unique globally. | Yes |
| `api_key_companies` | N:M join: which companies an API key can access. | Implicit |
| `refresh_tokens` | Hashed refresh tokens; marked used on rotation. | Yes (tenantId stored) |
| `audit_logs` | Immutable audit trail. Append-only. Optional tenant association. | Partial |

### PostgreSQL ENUMs (9 types)

`TenantStatus`, `TenantPlan`, `UserStatus`, `UserRole`, `CompanyStatus`,
`IdentificationType`, `ApiKeyStatus`, `ApiKeyEnv`, `EventClass`.

### Key constraints and indexes

- `tenants.slug` — UNIQUE.
- `users(tenantId, email)` — UNIQUE.
- `companies(tenantId, identificationNumber)` — UNIQUE.
- `api_keys.keyPrefix` — UNIQUE.
- `refresh_tokens.tokenHash` — UNIQUE.
- Composite indexes on `(tenantId, status)` for `users`, `companies`, `api_keys`.
- `audit_logs` indexes: `(tenantId, createdAt DESC)`, `(correlationId)`,
  `(apiKeyId, createdAt DESC)`, `(action, createdAt DESC)`, `(eventClass, createdAt DESC)`.
- `refresh_tokens` indexes: `(userId)`, `(expiresAt)`.
- `api_keys`: additional index on `(keyPrefix)`.

### Foreign key behavior
- `companies.tenantId` → `tenants.id`: ON DELETE RESTRICT ON UPDATE CASCADE.
- `users.tenantId` → `tenants.id`: ON DELETE RESTRICT ON UPDATE CASCADE.
- `api_keys.tenantId` → `tenants.id`: ON DELETE RESTRICT ON UPDATE CASCADE.
- `refresh_tokens.userId` → `users.id`: ON DELETE CASCADE ON UPDATE CASCADE.
- `audit_logs.tenantId` → `tenants.id`: ON DELETE RESTRICT.
- `audit_logs.apiKeyId` → `api_keys.id`: ON DELETE RESTRICT.

### Persistence patterns
- All tenant-aware repositories extend `TenantAwarePrismaRepository`.
- Repositories call `this.applyTenantFilter(where)` which merges `tenantId`.
- Domain entities are reconstructed from Prisma results via `.reconstruct(props)` factory
  methods. Prisma models are never used as public contracts.
- `AuditLog` only supports `insert()` and `findByCorrelationId()` through its port.
- No soft-delete pattern; status fields represent logical state.

### Seed data
- `prisma/seed.ts` creates first tenant + `TENANT_ADMIN` user on empty databases.
- Credentials: `admin@billing.local` / `ChangeMe123!` (override via env vars).
- Idempotent: skips if any tenant already exists.

---

## 8. APIs and Integrations

### REST API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Liveness (always 200 if process alive) |
| GET | `/health/live` | None | Liveness alias |
| GET | `/health/ready` | None | Readiness — checks DB connectivity |
| POST | `/api/v1/auth/login` | None | User login; returns JWT + refresh token |
| POST | `/api/v1/auth/refresh` | None | Refresh access token with rotation |
| POST | `/api/v1/tenants` | JWT | Create tenant + admin user |
| GET | `/api/v1/tenants/:id` | JWT | Get tenant by ID |
| POST | `/api/v1/companies` | JWT | Create company (CR identification validated) |
| GET | `/api/v1/companies/:id` | JWT | Get company by ID (tenant-scoped) |
| POST | `/api/v1/api-keys` | JWT | Create API key (raw key shown once) |
| GET | `/api/v1/api-keys` | JWT | List API keys for current tenant |
| DELETE | `/api/v1/api-keys/:id` | JWT | Revoke API key (idempotent) |
| GET | `/api/docs` | None | Swagger UI (non-production only) |

**Uniform error response shape:**
```json
{
  "error": {
    "code": "DOMAIN_EXCEPTION_CODE",
    "message": "Human-readable message",
    "correlationId": "uuid",
    "timestamp": "ISO-8601",
    "details": {}
  }
}
```

**Versioning:** URL path-based (`/api/v1`). No header-based versioning currently.

### External Integrations

| Integration | Status | Active Adapter |
|---|---|---|
| Hacienda API (MH-DGT) | Interface defined; not wired in AppModule | `MockHaciendaAdapter` (all envs unless `USE_REAL_HACIENDA=true` in prod) |
| AWS S3 | Adapter implemented; not wired in AppModule | `S3StorageAdapter` via `STORAGE_TYPE=s3` |
| AWS SSM Parameter Store | Adapter implemented; active in `SecretsModule` | `AwsParameterStoreSecretProvider` via `SECRET_PROVIDER=ssm` |
| pg-boss (queue) | Library implemented; not wired in AppModule | N/A (no active connection) |

---

## 9. Authentication and Authorization

### JWT Authentication
- Algorithm: HS256 (symmetric, via `@nestjs/jwt` / `passport-jwt`).
- Access token TTL: 15 minutes (configurable via `JWT_EXPIRES_IN`).
- Refresh token TTL: 7 days (configurable via `JWT_REFRESH_EXPIRES_IN`).
- JWT payload: `{ sub: userId, tenantId, role, jti }`.
- JWT secret loaded from `SecretProvider` in `JwtStrategy`.
- Refresh token: 48-byte random (96 hex chars); SHA-256 hashed for storage.
  Each use marks `used=true` and issues a new pair. Reuse → 401.
- `JwtAuthGuard` extends NestJS `AuthGuard('jwt')`.

### API Key Authentication
- Header: `X-API-Key`.
- Format: `bk_{env}_{prefix8}_{secret32}`.
- Prefix (8 chars) stored in plaintext for O(1) lookup by `keyPrefix` index.
- Secret (32 chars) hashed with argon2id; never stored in plaintext.
- `ApiKeyAuthGuard` validates format, prefix lookup, hash verify, status and expiry.
- On success: populates `request.apiKey` (full `ApiKey` entity) and
  `request.user = { tenantId }` for downstream interceptor compatibility.

### Authorization (current state)
- **Tenant isolation** is the primary and only enforced authorization boundary.
  `TenantContext` + `TenantAwarePrismaRepository` prevent any cross-tenant data access.
- **Role-based access control (RBAC):** JWT carries `role` in payload but no
  `RolesGuard` or `@Roles()` decorator is implemented. All roles have equivalent access.
- **API key scope enforcement:** `scopes` field exists in `ApiKey` entity and `api_keys`
  table but no `ScopeGuard` is implemented. All valid API keys have full access.

### Password / Hash Security
- Passwords hashed with argon2id (`argon2` npm v0.40, type `argon2id`).
- API key secrets hashed with argon2id.
- Refresh tokens hashed with SHA-256 (rotation provides security; not a secret value).
- No plaintext credentials are logged or stored.

---

## 10. Events and Background Processing

### Domain Events
- `TenantCreatedEvent` is the only implemented domain event.
- Raised in `Tenant.create()`, accumulated in `AggregateRoot._domainEvents`.
- No event bus, publisher, or subscriber exists in the system.
- Events are never dispatched; accumulation is structural scaffolding only.

### Background Processing
- `worker.main.ts` starts a NestJS application context but registers no job handlers.
- `QueueModule` is not imported in `AppModule`; pg-boss is never started.
- `PgBossJobQueue` and `InMemoryJobQueue` exist and are unit-tested.
- No background jobs are scheduled or processed in Fase 0.

---

## 11. Containers and Deployment

### Dockerfile (3 stages)

| Stage | Base image | Purpose |
|---|---|---|
| `deps` | `node:20-alpine` | Install all deps (including dev); installs `python3 make g++` for argon2 native module |
| `builder` | `node:20-alpine` | `prisma generate` + `npm run build` + `npm prune --production` |
| `runner` | `node:20-alpine` | Minimal image; non-root user `billing:billing` (uid/gid 1001) |

- Default CMD: `node dist/bootstrap/api.main.js`.
- Worker service overrides CMD to `node dist/bootstrap/worker.main.js`.
- Docker `HEALTHCHECK` on `/health` every 30s (10s timeout, 30s start period, 3 retries).

### docker-compose.yml

| Service | Image | Exposed Port | Health |
|---|---|---|---|
| `postgres` | `postgres:15-alpine` | 5432 | `pg_isready -U billing -d billing_dev` |
| `localstack` | `localstack/localstack:3` | 4566 | curl `/_localstack/health` |
| `billing-api` | Built from `Dockerfile` (target: `runner`) | 3000 | wget `/health` |
| `billing-worker` | Built from `Dockerfile` (target: `runner`) | none | none |

- No Redis (ADR-003: queue via pg-boss on the same PostgreSQL instance).
- `billing-api` and `billing-worker` depend on `postgres` with `service_healthy`.

### CI/CD
- Implementation report (TASK-017) states a GitHub Actions pipeline was created with
  5 gates: `lint` → `typecheck` → `test` → `build` → `e2e`.
- **No `.github/workflows/` directory is present in the repository on disk.**
  The CI file may not have been committed. Status: unverified.

---

## 12. Current Testing Strategy

### Unit Tests — 14 suites, 95 tests

| Suite | File | Tests |
|---|---|---|
| ValueObject | `shared/domain/__tests__/value-object.spec.ts` | 5 |
| AggregateRoot | `shared/domain/__tests__/aggregate-root.spec.ts` | 7 |
| TenantContext | `infrastructure/tenant/__tests__/tenant-context.spec.ts` | 7 |
| Tenant entity | `identity/domain/__tests__/tenant.entity.spec.ts` | 6 |
| TenantSlug VO | `identity/domain/__tests__/tenant-slug.vo.spec.ts` | 6 |
| IdentificationNumber VO | `companies/domain/__tests__/identification-number.vo.spec.ts` | 14 |
| CreateTenantHandler | `identity/application/__tests__/create-tenant.handler.spec.ts` | 5 |
| LoginHandler | `identity/application/__tests__/login.handler.spec.ts` | 4 |
| ApiKey entity | `api-keys/domain/__tests__/api-key.entity.spec.ts` | 7 |
| AuditService | `audit/application/__tests__/audit.service.spec.ts` | 2 |
| CorrelationIdInterceptor | `api/interceptors/__tests__/correlation-id.interceptor.spec.ts` | 2 |
| InMemoryJobQueue | `infrastructure/queue/__tests__/in-memory-job-queue.spec.ts` | 3 |
| MockHaciendaAdapter | `infrastructure/integrations/hacienda/__tests__/mock-hacienda.spec.ts` | 9 |
| EnvSecretProvider | `infrastructure/secrets/__tests__/env-secret-provider.spec.ts` | 3 |

Test runner: Jest v29 + `ts-jest`. All 95 pass per implementation report.

### E2E Tests — 4 suites

| Suite | Tests | Coverage |
|---|---|---|
| `health.e2e-spec.ts` | 3 | `/health`, `/health/ready`, `/health/live` |
| `auth.e2e-spec.ts` | 5 | Login, 401 denial (no enumeration), refresh, rotation |
| `api-keys.e2e-spec.ts` | 6 | Create, list, revoke, idempotency, correlation ID |
| `tenant-isolation.e2e-spec.ts` | 4 | Cross-tenant company and API key isolation |

E2E tests require a live PostgreSQL database (`DATABASE_URL`).
Config: `test/jest-e2e.json`. Factories: `test/helpers/test-factories.ts`.

### Testing gaps (identified)
- No repository-level integration tests with Prisma (repositories covered by E2E only).
- No test for `TenantAwarePrismaRepository` isolation at unit level.
- `HaciendaApiAdapter` real HTTP integration not tested.
- `S3StorageAdapter` not integration-tested (LocalStack available but not wired to tests).
- No migration tests.

---

## 13. Behavior to Preserve

The following behaviors are correct and must not be altered:

1. **Tenant isolation:** All tenant-scoped queries include `WHERE tenant_id = $tenantId`
   via `TenantAwarePrismaRepository.applyTenantFilter()`.
2. **argon2id hashing:** All passwords and API key secrets are hashed with argon2id exclusively.
3. **Refresh token rotation:** Every use of a refresh token marks it `used=true` and
   issues a new pair. Token reuse → 401.
4. **Audit fire-and-forget:** Audit log failures do not fail the HTTP request.
5. **DomainException mapping:** `GlobalExceptionFilter` maps `DomainException` subclasses
   to their declared `httpStatus` and `code`. Unknown exceptions → 500 without stack trace
   in production.
6. **No email enumeration:** `LoginHandler` returns the same 401 `INVALID_CREDENTIALS`
   for non-existent user, wrong password, or inactive user.
7. **API key secret shown once:** Raw secret is returned only in `CreateApiKeyHandler`
   response. Not stored in plaintext; cannot be retrieved later.
8. **Revoke idempotency:** Revoking an already-revoked API key is a no-op (BR-005).
9. **TenantSlug immutability:** Slug cannot be changed after creation (BR-008).
10. **Correlation ID propagation:** `X-Correlation-ID` is generated if absent and always
    returned in the response header.
11. **Swagger in non-production only:** Disabled when `NODE_ENV=production`.
12. **Joi config validation at startup:** Application fails to start on invalid env config.
13. **No domain → framework imports:** ESLint `no-restricted-imports` rule enforces that
    domain modules cannot import `@prisma/client`, `@nestjs/*`, `pg-boss`, or `axios`.

---

## 14. Known Defects

None verified. The implementation report records zero pre-existing failures and zero new
failures after Fase 0.

Four deviations from the original plan were self-corrected during implementation:
1. `TenantController` now requires `JwtAuthGuard` (early version was unauthenticated).
2. `LoginHandler` reads JWT expiry from `ConfigService` (early version had hardcoded `'15m'`).
3. `TenantContextInterceptor` uses `lastValueFrom()` (deprecated `toPromise()` replaced).
4. ESLint override includes `test/**` to allow Prisma usage in E2E factories.

All four corrected before Fase 0 completion.

---

## 15. Architectural Debt

| ID | Severity | Description | Location |
|---|---|---|---|
| AD-001 | Low | `StorageModule` is `@Global` but NOT imported in `AppModule`. STORAGE_PORT is unavailable to any module. | `src/infrastructure/storage/storage.module.ts` |
| AD-002 | Low | `QueueModule` is NOT imported in `AppModule`. pg-boss is never started; no jobs can be enqueued or processed. | `src/infrastructure/queue/queue.module.ts` |
| AD-003 | Low | `HaciendaModule` is NOT imported in `AppModule`. HACIENDA_PORT is unreachable from use cases. | `src/infrastructure/integrations/hacienda/hacienda.module.ts` |
| AD-004 | Low | `TenantCreatedEvent` is raised and stored in aggregate but never published. No event dispatcher exists. | `src/modules/identity/domain/events/` |
| AD-005 | Low | `tenant-context.middleware.ts` exists but is unused (dead file). Active mechanism is `TenantContextInterceptor`. | `src/infrastructure/tenant/tenant-context.middleware.ts` |
| AD-006 | Low | `TenantModule` (83 bytes) exists but is minimal and not imported anywhere. `TenantContext` is a static utility class. | `src/infrastructure/tenant/tenant.module.ts` |
| AD-007 | Medium | Role-based access control not enforced. `role` is in JWT payload but no `RolesGuard` exists. | Application-wide |
| AD-008 | Medium | API key scope enforcement not implemented. `scopes` field exists in domain and DB but no `ScopeGuard` is wired. | `src/api/guards/api-key-auth.guard.ts` |
| AD-009 | Medium | No rate limiting on auth endpoints. Brute-force attacks on `/api/v1/auth/login` are not throttled. | `src/modules/identity/infrastructure/http/auth.controller.ts` |
| AD-010 | Medium | No CORS configuration. Browser clients cannot make cross-origin requests. | `src/bootstrap/api.main.ts` |
| AD-011 | Low | `XmlSignerPort` has no implementation. XAdES spike (ADR-005) not yet started. | `src/infrastructure/signing/` |
| AD-012 | Low | No database-level integration tests for Prisma repositories. Repository correctness relies on E2E tests. | `test/` |
| AD-013 | Low | CI/CD workflow (TASK-017) claimed as completed but no `.github/workflows/` directory exists on disk. | `.github/workflows/ci.yml` (missing) |
| AD-014 | Low | No mechanism to clean up expired or used `refresh_tokens` rows. Table will grow unbounded. | `prisma/schema.prisma` (`refresh_tokens`) |

---

## 16. Security Risks

| ID | Severity | Description | Status |
|---|---|---|---|
| SEC-001 | Medium | No rate limiting on `POST /api/v1/auth/login` or `POST /api/v1/auth/refresh`. Susceptible to brute-force. | Deferred to Fase 1 |
| SEC-002 | Medium | No CORS policy configured. Any origin can make requests. | Deferred; must resolve before any browser client connects |
| SEC-003 | Low | `JWT_SECRET` has an insecure development default. Enforced ≥ 32 chars only in production via Joi. | Acceptable; production safeguarded |
| SEC-004 | Low | `docker-compose.yml` uses hardcoded PostgreSQL password (`billing_password`). | Dev-only; not used in production |
| SEC-005 | Low | `worker.main.ts` has no HTTP server or health endpoint. No container-level liveness check for the worker. | Acceptable for Fase 0 (no job processing yet) |
| SEC-006 | Low | `AuditLog.companyId` field is never populated by the current `AuditInterceptor`. Company-level audit trail absent. | By design for Fase 0 |

---

## 17. Unknowns and Assumptions

| ID | Area | Description |
|---|---|---|
| U-001 | CI/CD | GitHub Actions workflow was reported as implemented (TASK-017) but no `.github/` directory is visible on disk. Possibly not committed. |
| U-002 | Specs directory | `specs/` directory listed as empty by tooling; however `specs/fase-0-foundation/implementation-report.md` was readable. Possible tooling filter on non-source directories. |
| U-003 | Refresh token cleanup | No background job or DB retention policy exists to purge expired or used `refresh_tokens` rows. Table will grow unbounded. |
| U-004 | pg-boss schema | `PgBossJobQueue` is defined but `QueueModule` is never imported. pg-boss system tables (created automatically by the library on first connection) may not be initialized in the database. |
| U-005 | Hacienda real API | `HaciendaApiAdapter` is a stub. The real Hacienda authentication flow (OAuth2 + PKCS#12 certificate), endpoints, and rate limits are not yet defined in code. |
| U-006 | Event publishing | No decision has been made on how `TenantCreatedEvent` or future domain events will be dispatched: in-process synchronous, via pg-boss, or external message bus. |
| U-007 | `refresh_tokens.tenantId` | `tenantId` is stored in `refresh_tokens` for query efficiency but is not a foreign key to `tenants` in the migration SQL (only `userId` has a FK). Behavior on tenant deletion is undefined. |

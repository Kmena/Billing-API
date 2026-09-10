# Architecture

> **Scope:** Active architecture governing the Billing system as of the `pre-fase-2-hardening` implementation cycle (Fase 0 + Fase 1 + hardening).
> This document describes only implemented, currently operative architecture and active decisions.
> Future-state proposals belong in `docs/action-plan.md` and `docs/future-architecture.md`.

---

## 1. Purpose and scope

This document is the authoritative reference for:
- The current active architectural style and module boundaries
- Enforced dependency rules
- Current domain map and responsibilities
- Active architectural decisions that govern the system today
- Known architectural limitations

**In-scope:** Everything implemented through Fase 1 + pre-fase-2-hardening.
**Out-of-scope:** Fase 2 HaciendaConnection, Fase 3+ document submission, UI layers.

---

## 2. Current active architecture summary

Billing is a **NestJS 10 modular monolith** structured according to **hexagonal architecture** (ports and adapters).

Key properties of the current architecture:
- All business domains are compiled into a single deployable artifact
- The HTTP API server and background worker are separate OS processes launched from the same compiled code
- Configuration is centrally validated at process startup by a standalone Joi schema; invalid or insecure configuration causes immediate startup failure
- Domain logic is framework-free; the domain layer has no NestJS, Prisma, or Axios dependencies
- All external integration field names are confined to adapter implementations; no external field names leak into the domain or application layers
- Tenant isolation is enforced at the persistence layer in every repository

---

## 3. Active architectural style and module boundaries

### Overall style

```
NestJS Modular Monolith
  └── Hexagonal Architecture (Ports and Adapters)
        ├── Domain layer (framework-free)
        ├── Application layer (use-case handlers; NestJS-injectable but not NestJS-dependent)
        └── Infrastructure layer (adapters, controllers, Prisma repos)
```

No microservices. No event bus. No CQRS framework (manual command/query pattern only).

### Layer rules (enforced)

| Rule | Enforcement mechanism |
|---|---|
| Domain must not import NestJS, Prisma, Axios, or any infrastructure | Code structure; verified by ESLint import rules |
| Application layer must not import controllers, Prisma client, or HTTP libraries | Code structure |
| Controllers must not contain business logic | Code review convention |
| Repository ports (output ports) are defined in the domain layer | File location: `domain/ports/` |
| Prisma repository adapters are in the infrastructure layer | File location: `infrastructure/persistence/` |
| External API field names are confined to the adapter implementation | BR-012 (Hacienda) |
| ConfigService is the sole configuration source in bootstrap and application code | Established by pre-fase-2-hardening; one known violation: DEFECT-001 |

### Module boundary map

```
src/
├── api/                    ← Cross-cutting HTTP (no business logic)
│     guards/               ← ApiKeyAuthGuard, JwtAuthGuard, ScopeGuard, ApiKeyThrottlerGuard
│     filters/              ← GlobalExceptionFilter
│     interceptors/         ← CorrelationIdInterceptor, TenantContextInterceptor, AuditInterceptor
│     strategies/           ← JwtStrategy
│     health/               ← HealthController
│
├── bootstrap/              ← Process entry points only (api.main.ts, worker.main.ts)
│
├── infrastructure/         ← Shared cross-cutting adapters (owned by no single domain)
│     config/               ← Joi schema + NestJS ConfigModule + typed config factories
│     database/             ← PrismaService + TenantAwarePrismaRepository
│     integrations/hacienda/ ← HaciendaPort + adapters + HaciendaCircuitBreaker
│     queue/                ← JobQueuePort + PgBoss + InMemory adapters
│     secrets/              ← SecretProviderPort + Env + SSM adapters
│     signing/              ← XmlSignerPort (stub, no adapter)
│     storage/              ← StoragePort + LocalStorage + S3 adapters
│     tenant/               ← TenantContext
│
└── modules/                ← Business domains (each self-contained hexagon)
      identity/             → Core: tenants, users, auth
      companies/            → Core: company management
      api-keys/             → Core: API key lifecycle
      audit/                → Supporting: audit trail
      cabys/                → Supporting: CABYS catalog queries
      exchange-rates/       → Supporting: exchange rate queries
      taxpayers/            → Supporting: taxpayer lookup queries
      shared/               → Generic: base domain classes
```

---

## 4. Current domain map

| Domain | Classification | Bounded Context | Data Ownership |
|---|---|---|---|
| Identity | **Core** | Identity | tenants, users, refresh_tokens |
| Companies | **Core** | Companies | companies |
| API Keys | **Core** | API Keys | api_keys, api_key_companies |
| Audit | **Supporting** | Audit | audit_logs |
| Hacienda Integration | **Supporting** | Hacienda | No owned tables; caches in-memory |
| CABYS | **Supporting** | Hacienda (shared) | No owned tables; proxies Hacienda |
| Exchange Rates | **Supporting** | Hacienda (shared) | No owned tables; proxies Hacienda |
| Taxpayers | **Supporting** | Hacienda (shared) | No owned tables; proxies Hacienda |
| Shared | **Generic** | — | No tables |

**Cross-domain dependency rules:**
- `Companies` uses `HaciendaPort` (injected) to verify taxpayer at creation time
- `API Keys` uses `CompanyRepository` (injected) to validate company association
- `Audit` has no dependency on other business domains; receives audit data via `AuditService`

---

## 5. Current runtime components and responsibilities

| Component | Process | Responsibilities |
|---|---|---|
| `billing-api` | `node dist/bootstrap/api.main.js` | Serve HTTP requests; all inbound REST API; CORS; rate limiting; auth; audit |
| `billing-worker` | `node dist/bootstrap/worker.main.js` | Infrastructure shell; no job handlers registered yet |
| `PostgreSQL 15` | External service | Primary data store; pg-boss job queue schema |
| `LocalStack` (dev) | External service | S3-compatible mock for development |
| `AWS S3` (production) | External service | Object storage for signed documents (Fase 3+) |
| `AWS SSM` (production) | External service | Secrets provider (optional; `env` used in dev/test) |

---

## 6. Current dependency rules

### Dependency flow (desired)

```
HTTP Client
    │
    ▼
Input Adapter (Controller)
    │
    ▼
Input Port (Use Case Handler)
    │
    ▼
Domain (Entities, Value Objects, Domain Services)
    │
    ▼
Output Port (Repository Interface / HaciendaPort / StoragePort)
    ▲
    │
Output Adapter (Prisma Repo / HaciendaApiAdapter / S3StorageAdapter)
```

### Active enforced rules

1. **Domain layer**: No imports from NestJS, Prisma, Axios, or any infrastructure package.
2. **Application layer**: No imports from NestJS HTTP decorators, Prisma client, or HTTP libraries. Uses injected port interfaces only.
3. **Controllers**: No business rules. Delegate entirely to use-case handlers.
4. **Hacienda field names**: Only in `HaciendaApiAdapter` (adapter file + fixture files). Never in use cases, domain entities, or API DTOs (BR-012).
5. **Config source in bootstrap/application**: Only `ConfigService`. No `process.env` reads outside `registerAs()` factories.
6. **Configuration security**: Joi schema validates all env vars at startup. Application will not start with invalid config. CORS wildcard is rejected in production/staging.

### Known active violation

| ID | Location | Rule violated | Severity |
|---|---|---|---|
| DEFECT-001 | `api/filters/global-exception.filter.ts` | Reads `process.env.NODE_ENV` directly instead of using ConfigService | Low |

---

## 7. Current database ownership and transaction boundaries

### Ownership

Each domain module owns and queries only its designated tables through its Prisma repository adapter. No cross-domain Prisma queries exist in the current implementation.

| Module | Tables |
|---|---|
| Identity | `tenants`, `users`, `refresh_tokens` |
| Companies | `companies` |
| API Keys | `api_keys`, `api_key_companies` |
| Audit | `audit_logs` |

### Transaction boundaries

- All current use cases operate within single-table transactions (Prisma default implicit transaction per operation).
- No cross-table, cross-domain transaction spans are used.
- Audit log writes are independent fire-and-forget operations (via `AuditInterceptor`).

### Schema version

PostgreSQL schema version 1.1 (ADR-009: `event_class` in `audit_logs` from migration 001).
Two applied migrations:
1. `20250001000000_initial_foundation` — all Fase 0 tables
2. `20250002000000_company_hacienda_fields` — nullable Hacienda verification columns on `companies`

### Integrity constraints active

- All FKs enforced at PostgreSQL level (ON DELETE RESTRICT or CASCADE where noted)
- Unique indexes: tenant slug, user email per tenant, company identification per tenant, API key prefix, refresh token hash
- ENUMs: all status fields use PostgreSQL ENUMs (type-safe)
- `audit_logs`: no FK enforcement on `company_id` column (column exists; no FK constraint in migration)

---

## 8. Current API and integration contracts

### REST API contract

| Property | Value |
|---|---|
| Base path | `/api/v1` |
| Health path | `/health` (excluded from prefix) |
| Content type | `application/json` |
| Auth headers | `Authorization: Bearer <jwt>` or `X-API-Key: <key>` |
| Idempotency | `Idempotency-Key` header accepted (infrastructure present; not enforced in Fase 0/1) |
| Correlation | `X-Correlation-ID` (generated if absent; echoed in response) |
| Error shape | `{ error: { code: string, message: string, correlationId?, timestamp: string, details? } }` |
| Swagger | `GET /api/docs` (non-production only) |

### Rate limiting contracts

| Layer | Guard | Limit | Window |
|---|---|---|---|
| Layer A — API Key | `ApiKeyThrottlerGuard` | 100 requests | 60s (configurable) |
| Layer B — IP (auth) | `@Throttle()` on `AuthController` | 10 requests | 60s (configurable) |

### Hacienda integration contract (outbound)

| Property | Value |
|---|---|
| Base URL | `https://api.hacienda.go.cr` (configurable `HACIENDA_API_BASE_URL`) |
| Timeout | 10s default (configurable `HACIENDA_TIMEOUT_MS`) |
| TLS | HTTPS enforced by URL scheme |
| Retry 429 | Linear backoff: `HACIENDA_RETRY_429_BASE_DELAY_MS × (attempt + 1)` |
| Retry 5xx | Fixed delay: `HACIENDA_RETRY_5XX_DELAY_MS` |
| Circuit breaker | CLOSED → OPEN after `HACIENDA_CB_FAILURE_THRESHOLD` consecutive failures |
| Reset | OPEN → HALF_OPEN after `HACIENDA_CB_RESET_TIMEOUT_MS` ms |
| Rate limit | ≤ `HACIENDA_CB_OUTBOUND_RATE_PER_SECOND` req/s (max 10; Joi-enforced) |

---

## 9. Current security boundaries

### Authentication boundary

```
Public (no auth): POST /auth/login, POST /auth/refresh, GET /health, POST /tenants
JWT-protected:    POST/GET /companies, POST/GET/DELETE /api-keys, GET /tenants/:id
API-Key-protected: GET /taxpayers/:id, GET /cabys/:code, GET /cabys?search=, GET /exchange-rates
```

### Authorization boundary

- JWT endpoints: tenant-scoped — users can only access their own tenant's resources
- API Key endpoints: scope-gated + company-authorized via `ScopeGuard`
- No RBAC within tenants is enforced beyond the UserRole enum (read-only not yet gated)

### Data isolation boundary

`TenantAwarePrismaRepository` base class appends `tenantId` condition to all queries. This is the sole mechanism for multi-tenant isolation (no PostgreSQL row-level security).

### Configuration security boundary

Joi schema (`config.validation-schema.ts`) is the enforcement gate at startup:
- `DATABASE_URL`: always required
- `JWT_SECRET`: >= 32 chars in `production`; insecure default only in dev/test
- `CORS_ALLOWED_ORIGINS`: required and non-wildcard in `production` and `staging`; defaults to `*` in dev/test
- `HACIENDA_CB_OUTBOUND_RATE_PER_SECOND`: capped at 10 (Hacienda API rate limit compliance)

### Storage security boundary

- All files stored privately (no public ACL)
- Access via presigned URLs (S3 AWS SDK `getSignedUrl`) or HMAC-signed local URLs
- `LocalStorageAdapter` prevents path traversal via `path.normalize` + leading `../` strip

---

## 10. Current container and deployment architecture

### Image build

| Stage | Base | Output |
|---|---|---|
| `deps` | `node:20-alpine` | All npm deps + native build tools |
| `builder` | `node:20-alpine` | Compiled `dist/`, Prisma client, production `node_modules` |
| `runner` | `node:20-alpine` | Final image; non-root `billing:1001`; port 3000 |

### Runtime security (Dockerfile)

- Non-root user enforced (`USER billing`)
- Secrets injected via environment variables at container start; no secrets in image
- HEALTHCHECK via `wget` on `/health`

### Configuration injection model

All runtime configuration is injected via environment variables. The Joi schema validates all variables at startup. No secrets are baked into the image.

### CI/CD gates (`.github/workflows/ci.yml`)

Gate sequence: `lint` + `typecheck` (parallel) → `test` + `build` (parallel) → `e2e`

All gates must pass before the `e2e` job executes. No deployment step is automated in the current workflow.

---

## 11. Current testing strategy

### Philosophy

- Domain logic tested in isolation (no NestJS bootstrap, no database)
- Configuration schema tested without NestJS bootstrap (import `validationSchema` directly)
- Integration and E2E tests use real PostgreSQL; Hacienda always mocked

### Test coverage by type

| Type | Location | Framework |
|---|---|---|
| Unit (domain entities) | `modules/*/domain/__tests__/` | Jest |
| Unit (use-case handlers) | `modules/*/application/__tests__/` | Jest |
| Unit (infrastructure) | `infrastructure/**/__tests__/` | Jest |
| Unit (API layer) | `api/**/__tests__/` | Jest |
| Config validation | `infrastructure/config/__tests__/` | Jest + Joi (no NestJS) |
| E2E | `test/e2e/fase*/` | Jest + Supertest + real PostgreSQL |

### Hacienda in tests

Hacienda is always mocked:
- Unit tests: `MockHaciendaAdapter` or jest mocks
- E2E tests: `USE_REAL_HACIENDA=false` → `MockHaciendaAdapter` selected at startup

---

## 12. Active architectural decisions

| ID | Decision | Rationale | Scope |
|---|---|---|---|
| ADR-003 | No Redis. Queue via pg-boss on same PostgreSQL. | Reduces operational complexity at current scale. | Queue |
| ADR-009 | `event_class` column in `audit_logs` from the start. Three retention tiers: FISCAL_AUDIT, TECHNICAL, SECURITY. | Legal compliance for fiscal records. | Audit |
| DEC-007 | Two-tier rate limiting: per-API-Key (throttler) + per-IP on auth endpoints. | Prevent API Key abuse and auth brute-force independently. | Security |
| BR-012 | Hacienda field names confined to HaciendaApiAdapter only. | Contract isolation; Billing owns its API contract. | Hacienda |
| BR-014 | Hacienda not-found detected via `body.code === 404`, not HTTP status. | Hacienda API quirk: HTTP 200 for not-found taxpayers. | Hacienda |
| BR-015 | CABYS codes (13-digit) ≠ economic activity codes. | Distinct formats; must not be substituted. | Hacienda |
| NFR-009 | All stored files are private. Access via signed URLs. | Security; no public object exposure. | Storage |
| HARD-001 | Joi schema extracted to `config.validation-schema.ts` (standalone). | Enables unit testing of Joi rules without NestJS bootstrap. | Config |
| HARD-002 | CORS wildcard is a startup-time fatal error in production/staging. | Eliminates warn-only fallback; fail-fast security policy. | Security |
| HARD-003 | `api.main.ts` uses ConfigService exclusively (zero direct process.env reads). | Single configuration source of truth. | Bootstrap |
| HARD-004 | HaciendaCircuitBreaker all 7 thresholds are configurable via env vars with safe defaults. | Enables per-environment tuning without code changes. | Hacienda |
| HARD-005 | LocalStorageAdapter accepts config via constructor params (not process.env). | ConfigService → StorageModule → adapter; no Joi bypass. | Storage |
| HARD-006 | `SIGNED_*.xml` added to `.gitignore`. | Prevent accidental commit of fiscal documents. | Security |
| HARD-007 | `npx prisma generate` added to lint + typecheck CI jobs. | Eliminates type errors in lint/typecheck due to missing Prisma client. | CI |
| HARD-008 | `USE_REAL_HACIENDA=false` explicitly set in E2E CI job. | Prevents accidental real Hacienda calls in CI. | CI |

---

## 13. Known architectural limitations

| ID | Limitation | Impact | Required for |
|---|---|---|---|
| LIM-001 | No event bus; domain events are defined but not published or consumed. | TenantCreated event is dead code at runtime. | Fase 4 (webhooks) |
| LIM-002 | Rate limiter is in-memory (not shared across instances). | Cannot scale to multiple API instances with consistent rate limits. | Multi-instance deployment |
| LIM-003 | Worker process registers no job handlers. | Worker is operational infrastructure with no actual behavior. | Fase 3 (async doc processing) |
| LIM-004 | XmlSignerPort has no adapter implementation. | Document signing is not possible. | Fase 3 |
| LIM-005 | No Prometheus metrics, no distributed tracing. | Observability limited to structured logs. | Production monitoring |
| LIM-006 | No refresh token cleanup job. | Expired tokens accumulate in the database over time. | Operational hygiene |
| LIM-007 | HaciendaModule CacheModule module-level TTL is hardcoded (1h). Individual ops override correctly. | Hardcoded value not validated by Joi; could diverge from actual cache behavior if adapter logic changes. | Config consistency |
| LIM-008 | `GlobalExceptionFilter` reads `process.env.NODE_ENV` directly (DEFECT-001). | Architectural inconsistency; minor security edge case. | Config consistency |

---

## 14. Open decisions requiring clarification

| ID | Question | Why it matters |
|---|---|---|
| OD-001 | Is HS256 acceptable for production JWT, or is RS256 required for external token validation in Fase 2? | Affects HaciendaConnection OAuth token handling design. |
| OD-002 | How are expired refresh tokens purged? Scheduled job, TTL-based cleanup, or manual? | Operational hygiene; uncontrolled growth in high-volume tenants. |
| OD-003 | For multi-instance API deployment, will Redis be adopted for throttler state, or is single-instance the target? | Contradicts ADR-003 (no Redis); requires explicit decision before scaling. |
| OD-004 | How will per-company Hacienda OAuth tokens be stored and refreshed in Fase 2? | Token rotation strategy; affects SecretsModule and HaciendaConnection design. |
| OD-005 | Will pg-boss schema initialization race conditions (API + Worker simultaneous start) be resolved via migration or startup ordering? | Production reliability for worker deployment. |
| OD-006 | Should Prisma connection pooling be explicitly configured for production? | Performance and stability under concurrent load. |

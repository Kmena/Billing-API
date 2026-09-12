# Architecture

> **Synchronized:** Documentation-only ownership reconciliation for canonical `specs/post-f2-2-remediation` by `sdd-implementation-agent-c13b28` on 2026-09-12. No production code, tests or Prisma migrations modified.
> This document describes only the architecture currently implemented or actively governing the system. Future-state proposals belong in `docs/action-plan.md` and `docs/future-architecture.md`.
> Latest Post-F2.2 remediation audit reference: baseline-audit-agent score **9.0/10** for canonical `specs/post-f2-2-remediation`, with no meaningful regression and no blocking F2.2-specific gaps. Current validation evidence: `npm ci`, Prisma generate/validate, clean `billing_e2e` reset plus migrate deploy, lint/lint:check, typecheck, unit suite, build, fiscal E2E and full E2E all pass; npm audit vulnerabilities remain pre-existing/out of scope.

---

## 1. Purpose and scope

This document records the active architecture of the Billing repository as it exists after the Fase 1 Hacienda consultas audit refresh and later implemented phases. It covers runtime components, module boundaries, dependency rules currently in effect, database ownership, API contracts, security boundaries, deployment architecture, testing strategy and active decisions.

It does not approve or describe future XML generation, signing, Hacienda submission, worker jobs, PDFs, webhooks or microservices.

---

## 2. Current active architecture summary

Billing is an API-first **modular monolith** built with NestJS, TypeScript, Prisma and PostgreSQL.

Current runtime entrypoints:

- API process: `src/bootstrap/api.main.ts`.
- Worker process: `src/bootstrap/worker.main.ts`.

Current F2.2 fiscal document core is implemented as an in-process NestJS module:

- `FiscalDocumentsModule` is imported by `AppModule`.
- Fiscal HTTP controllers expose invoice/ticket creation, document retrieval and fiscal configuration endpoints.
- `FiscalDocumentService` orchestrates validation, authorization checks, pre-sequence idempotency reservation, sequence allocation, fiscal key generation, persistence, response sanitization and audit.
- Fiscal domain helpers provide Hacienda v4.4 constants, consecutive/clave generation and fixed-scale decimal arithmetic.

The repository continues to use incremental hexagonal architecture. Existing modules are closer to use-case/port/repository patterns; F2.2 currently uses a compact Prisma-backed service while keeping pure fiscal helper code free of NestJS/Prisma dependencies.

---

## 3. Active architectural style and module boundaries

Active style: modular monolith with incremental hexagonal/ports-and-adapters conventions.

Common module convention:

```text
src/modules/{module}/
  domain/
  application/
  infrastructure/
```

Fiscal module current structure:

```text
src/modules/fiscal-documents/
  application/
    fiscal-document.service.ts
  domain/
    fiscal.constants.ts
    fiscal-key.generator.ts
    scaled-decimal.ts
    __tests__/
  infrastructure/
    http/
      dtos/fiscal-document.dtos.ts
      fiscal-documents.controller.ts
      fiscal-management.controller.ts
      fiscal-public-documents.controller.ts
  fiscal-documents.module.ts
```

Current fiscal dependency direction:

```text
HTTP controllers -> FiscalDocumentService -> PrismaService / AuditService
FiscalDocumentService -> fiscal domain helpers
```

Current boundary note: direct `PrismaService` usage from fiscal application service is an accepted current implementation fact, but it is a documented architectural limitation relative to the broader hexagonal convention.

---

## 4. Current domain map

| Domain / Module | Classification | Responsibility | Code location |
|---|---|---|---|
| Identity | Core-supporting | Tenant/user lifecycle, JWT auth, refresh tokens. | `src/modules/identity` |
| Companies | Core | Company identity, ownership and Hacienda verification metadata. | `src/modules/companies` |
| API Keys | Core-supporting | External API credentials, scope validation, revocation, company authorization relation. | `src/modules/api-keys` |
| Hacienda Public Queries | Supporting | Taxpayer, CABYS and exchange-rate queries. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda Connection | Core-enabling | Per-company/per-environment Hacienda credential/configuration lifecycle. | `src/modules/hacienda-connection` |
| Fiscal Documents | Core | Local fiscal document core ending at `READY_FOR_XML`: issuance points, sequences, invoice/ticket persistence, idempotency, clave/consecutive generation. | `src/modules/fiscal-documents` |
| Audit | Generic-supporting | Append-only-ish audit recording with event classification. | `src/modules/audit` |
| Cross-cutting Infrastructure | Generic | Config, database, integrations, queue, secrets, signing port, storage, tenant context. | `src/infrastructure` |

---

## 5. Current runtime components and responsibilities

| Component | Responsibility |
|---|---|
| `AppModule` | Registers infrastructure modules, business modules, health controller and cross-cutting interceptors. Includes `FiscalDocumentsModule`. |
| `FiscalPublicDocumentsController` | API-key top-level fiscal endpoints: `POST /invoices`, `POST /tickets`, `GET /fiscal-documents/:id`. |
| `FiscalDocumentsController` | API-key company-scoped fiscal creation endpoints under `/companies/:companyId/fiscal-documents/:environment`. |
| `FiscalManagementController` | JWT-protected fiscal management endpoints for default issuance point and sequence configuration. |
| `FiscalDocumentService` | Compact application service for fiscal orchestration: validation, persistence, idempotency, sequence allocation, response sanitization and audit. |
| `fiscal-key.generator.ts` | Builds 20-digit consecutive and 50-digit Hacienda clave; generates 8-digit security code via crypto randomness. |
| `scaled-decimal.ts` | Fixed 5-decimal bigint arithmetic helper. |
| `PrismaService` | Database access and transaction execution. |
| `AuditService` | Records fiscal audit events. |
| `ApiKeyAuthGuard`, `ScopeGuard`, `JwtAuthGuard` | Authentication and static scope/role entry controls. |
| `ApiKeyThrottlerGuard` | Fase 1 controller-level per-API-key throttling guard for Hacienda query endpoints; extends Nest `ThrottlerGuard` and tracks by API-key id with IP fallback. |
| `AuthController` `@Throttle` decorators | Declares intended auth throttling for login/refresh at 10 requests/minute, but enforcement is unproven without visible global `ThrottlerGuard`/`APP_GUARD`. |

---

## 6. Current dependency rules

Active intended dependency rule for the repository remains:

```text
Input adapter -> Application/use case -> Domain helpers/entities -> Output port/adapter
```

Current fiscal implementation deviations:

| Violation/deviation ID | Severity | Location | Rule affected | Current impact | Recommended target |
|---|---|---|---|---|---|
| ARCH-F1-001 | High | `src/modules/identity/infrastructure/http/auth.controller.ts`, `src/app.module.ts` | `@Throttle` metadata requires an active throttler guard to enforce requests. | Login/refresh may not be rate-limited despite decorators and configuration; brute-force protection evidence is incomplete. | Register/apply the appropriate throttler guard or equivalent approved auth rate-limit mechanism and add threshold E2E tests. |
| ARCH-F1-002 | Medium | `src/api/guards/api-key-throttler.guard.ts`, Fase 1 controllers | Custom guard should have explicit, tested named-throttler behavior. | Per-key throttling intent exists, but threshold/named-bucket behavior is not proven. | Add focused tests and, if needed, make named throttler selection explicit without changing public contracts. |
| ARCH-F2.2-001 | Medium | `src/modules/fiscal-documents/application/fiscal-document.service.ts` | Application layer should depend on output ports, not concrete Prisma infrastructure. | Fiscal logic is harder to unit-test in isolation and less aligned with established repository convention. | Extract fiscal repositories/idempotency/sequence ports and Prisma adapters incrementally. |
| ARCH-F2.2-002 | Medium | `FiscalDocumentService` | Use cases should be focused and policy/authorization/calculation/persistence responsibilities should be separated. | One service concentrates multiple reasons to change. | Split into use cases/services: create document, get document, configure issuance point, configure sequence, fiscal authorization, idempotency, calculator. |
| ARCH-F2.2-003 | Low | Fiscal HTTP/service responses | Public API contracts should be explicit DTOs, not ad-hoc sanitized persistence objects. | `securityCode` and `requestHash` are removed, but response shape is still not formalized by dedicated DTO/mappers. | Introduce explicit response DTO mappers and OpenAPI response contracts. |
| ARCH-F2.2-004 | Low | Fiscal service role checks | Authorization policy should be explicit/reusable. | Management endpoints use role string check in service. | Add endpoint policy/guard or application authorization service. |

Positive boundary currently preserved: fiscal domain helper files do not import NestJS, Prisma, controllers, cloud SDKs, filesystem or external APIs.

---

## 7. Current database ownership and transaction boundaries

Current Prisma fiscal ownership:

| Table/model | Owning module | Notes |
|---|---|---|
| `fiscal_issuance_points` / `FiscalIssuancePoint` | Fiscal Documents | Company/environment branch/terminal configuration. |
| `fiscal_sequences` / `FiscalSequence` | Fiscal Documents | Sequence state scoped by tenant/company/environment/branch/terminal/document type. |
| `fiscal_documents` / `FiscalDocument` | Fiscal Documents | Immutable fiscal document snapshots with JSON `lines` and `totals`. |
| `fiscal_idempotency_keys` / `FiscalIdempotencyKey` | Fiscal Documents | DB-backed idempotency state for fiscal creation. |

Current transaction boundary:

- `FiscalDocumentService.createDocument()` wraps company lookup, API-key company authorization, idempotency reservation, HaciendaConnection prerequisite, issuance point lookup, sequence allocation, document persistence and idempotency completion in one Prisma transaction.
- Idempotency reservation occurs before fiscal sequence allocation and uses PostgreSQL `INSERT ... ON CONFLICT DO NOTHING RETURNING`, avoiding sequence consumption and transaction-abort behavior during concurrent idempotency races.
- Sequence allocation uses raw PostgreSQL `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`, avoiding `SELECT MAX + 1`.

Current fiscal migrations:

- `20260911140000_fiscal_document_core` adds fiscal documents, sequences, issuance points and initial idempotency storage.
- `20260911143000_fiscal_idempotency_scope` hardens idempotency scope by adding `api_key_id`, `operation`, an API-key FK and unique scope `(tenant_id, company_id, api_key_id, operation, key)`.
- `20260912123000_post_f2_2_fiscal_constraints` applies the Post-F2.2 forward constraint remediation.

Current fiscal DB constraints after Post-F2.2 remediation:

- `fiscal_documents.consecutive` is unique by `(tenant_id, company_id, environment, consecutive)`, not globally unique.
- `fiscal_documents.clave` remains globally unique.
- Legacy `fiscal_documents` uniqueness on `(tenant_id, company_id, idempotency_key)` is removed.
- A non-unique support index remains on `(tenant_id, company_id, idempotency_key)`.
- Canonical idempotency uniqueness is enforced on `fiscal_idempotency_keys` by `(tenant_id, company_id, api_key_id, operation, key)`.

Current DB limitations:

- No separate `fiscal_document_lines` table; lines are JSON on `fiscal_documents`.
- There is no partial unique index guaranteeing only one default issuance point per company/environment.

---

## 8. Current API and integration contracts

All paths below are under global prefix `/api/v1`.

| API | Auth | Contract summary |
|---|---|---|
| `POST /invoices` | API key + `invoices:write` | Body includes `companyId`, `environment`, optional receiver, currency/exchangeRate, saleCondition, paymentMethod, lines. Requires `Idempotency-Key`. Returns sanitized fiscal document object without `securityCode`/`requestHash`. |
| `POST /tickets` | API key + `tickets:write` | Same as invoice, receiver optional. Returns sanitized fiscal document object without `securityCode`/`requestHash`. |
| `GET /fiscal-documents/:id` | API key | Loads document then enforces `invoices:read` or `tickets:read` based on persisted type; checks API-key company authorization. Returns sanitized fiscal document object without `securityCode`/`requestHash`. |
| `POST /companies/:companyId/fiscal-documents/:environment/invoices` | API key + `invoices:write` | Company/environment supplied by path. Returns sanitized fiscal document object without `securityCode`/`requestHash`. |
| `POST /companies/:companyId/fiscal-documents/:environment/tickets` | API key + `tickets:write` | Company/environment supplied by path. Returns sanitized fiscal document object without `securityCode`/`requestHash`. |
| `PUT /companies/:companyId/fiscal/:environment/issuance-points/default` | JWT | TENANT_ADMIN only. Upserts default issuance point `001`/`00001`. |
| `PUT /companies/:companyId/fiscal/:environment/sequences/:documentType` | JWT | TENANT_ADMIN only. Configures next sequence before first assignment. |

Fase 1 Hacienda query contracts currently implemented under `/api/v1`:

| API | Auth | Contract summary |
|---|---|---|
| `GET /taxpayers/:identification` | API key + `taxpayers:read` | Returns normalized taxpayer data with Billing-owned field names. |
| `GET /cabys/:code` | API key + `cabys:read` | Returns normalized CABYS item; code must be 13 digits. |
| `GET /cabys?search=...` | API key + `cabys:read` | Returns normalized CABYS search result; minimum search length is enforced. |
| `GET /exchange-rates` | API key + `exchange-rates:read` | Returns normalized exchange-rate result for currency/date query. |
| `POST /auth/login`, `POST /auth/refresh` | Public request body | Intended auth throttling is declared with `@Throttle({ auth: { ttl: 60000, limit: 10 } })`, but active enforcement is currently unproven. |

No external Hacienda submission, OIDC, XML signing, storage or queue integration is invoked by fiscal creation.

---

## 9. Current security boundaries

Implemented/current security boundaries:

- API-key Fase 1 Hacienda query endpoints require `ApiKeyAuthGuard`, `ScopeGuard` and `ApiKeyThrottlerGuard` at controller level.
- `AuthController` declares rate limiting with `@Throttle`, but no visible global `ThrottlerGuard`/`APP_GUARD` registration was found in this refresh; auth brute-force protection is therefore an active security concern until verified/corrected.
- CORS is configured in `src/bootstrap/api.main.ts` with explicit headers/methods and non-wildcard credentials behavior, but current evidence lacks a positive CORS preflight E2E test.
- API-key fiscal endpoints require `ApiKeyAuthGuard`.
- Static creation scopes are enforced through `ScopeGuard` and `@Scopes()`.
- Dynamic read scope is enforced in `FiscalDocumentService.getDocument()`.
- API-key/company authorization is checked through `apiKeyCompany` lookup.
- Fiscal management endpoints require JWT and TENANT_ADMIN role.
- HaciendaConnection prerequisite checks existence and `status != DISABLED`; no OIDC call is made for F2.2 creation.
- Fiscal audit events use categorical action names.

Current security limitations:

- Auth rate limiting may not be enforced because `@Throttle` decorators are present without visible global throttler guard registration.
- API-key throttling requires threshold tests to prove the configured/named throttler bucket is the one being enforced.
- Fase 1 lacks current positive E2E evidence for Hacienda query response contracts, CORS preflight and all company verification status outcomes.
- Fiscal responses are sanitized to remove `securityCode` and `requestHash`, and F2.2 E2E now asserts this behavior; explicit response DTO classes/contracts are still future work.
- Fiscal negative authorization paths are covered by Post-F2.2 continuation E2E evidence for this scope.
- Docker Compose/default-secret and npm audit risks remain at repository level.

---

## 10. Current container and deployment architecture

- Dockerfile builds the NestJS app and runs Node process from built `dist` artifacts.
- `docker-compose.yml` provides local-style orchestration for PostgreSQL, LocalStack, API and worker.
- CI exists and, per prior hardening, includes Prisma generation in jobs.

Known current limitation: Docker Compose must not be treated as production-ready until default-secret / production-mode concerns are resolved or documented as local-only.

---

## 11. Current testing strategy

Current gates/scripts:

- `npx prisma validate`
- `npx prisma generate`
- `npx prisma migrate deploy`
- `npm run lint:check`
- `npm run typecheck`
- `npm test`
- `npm run test:e2e`
- `npm run build`

Reported validation after the Post-F2.2 fiscal-document continuation cycle:

- `npm ci`: pass; npm audit reports existing 26 vulnerabilities (4 low, 14 moderate, 8 high).
- `npx prisma generate && npx prisma validate`: pass.
- Clean `billing_e2e` reset plus `npx prisma migrate deploy`: pass; 6 migrations applied.
- `npm run lint`: pass.
- `npm run lint:check`: pass.
- `npm run typecheck`: pass.
- `npm test -- --silent`: pass, 181 tests / 28 suites.
- `npm run build`: pass.
- `npm run test:e2e -- --silent`: pass, 57 tests / 11 suites.
- Fiscal E2E: pass, 15 tests / 3 suites.
- PostgreSQL concurrency coverage: pass.

Fase 1 E2E evidence gaps remain for positive taxpayer/CABYS/exchange-rate responses, configured throttling thresholds, CORS preflight and company verification status outcomes. Those gaps are outside the completed Post-F2.2 fiscal continuation scope.

Fiscal E2E/API coverage is now present under `test/e2e/fase2` for invoice/ticket workflows, management endpoints, response sanitization, negative security paths, tenant isolation, type-specific scopes and PostgreSQL-backed concurrency/idempotency behavior.

---

## 12. Active architectural decisions

| Decision | Current status |
|---|---|
| Use modular monolith, not microservices. | Active. |
| Use NestJS + TypeScript + Prisma + PostgreSQL. | Active. |
| Keep global HTTP prefix `/api/v1`; health endpoints remain outside business route documentation. | Active. |
| Use Hacienda v4.4 as fiscal-document contract authority for F2.2. | Active. |
| F2.2 fiscal documents end at `READY_FOR_XML`; no XML/signing/submission states or side effects. | Active. |
| Persist fiscal issuance point instead of accepting arbitrary branch/terminal in document requests. | Active for default `001`/`00001` flow. |
| Use PostgreSQL atomic sequence allocation, not `SELECT MAX + 1`. | Active. |
| Require idempotency key for fiscal creation. | Active; DB idempotency uniqueness is scoped by tenant/company/apiKeyId/operation/key. |
| Fase 1 public Hacienda query endpoints require API key scopes and fail closed when the key is missing/invalid. | Active. |
| Fase 1 auth endpoints should be rate-limited at 10 requests/minute per IP. | Active intent; enforcement requires verification/correction because no global throttler guard is visible. |
| Fase 1 API-key endpoints should be throttled per API key. | Active intent through `ApiKeyThrottlerGuard`; threshold semantics require verification. |
| Require type-specific invoice/ticket API-key scopes; generic `documents:*` does not authorize F2.2 endpoints. | Active. |
| Fiscal management is JWT-only and TENANT_ADMIN-only. | Active. |
| Treat Docker Compose as unsafe for production until secret/default concerns are resolved. | Active limitation. |

---

## 13. Known architectural limitations

- Fase 1 auth throttling is declared but may not be enforced without global throttler guard registration.
- Fase 1 API-key throttling guard behavior is not proven by threshold tests.
- Fase 1 positive E2E/API evidence is incomplete for Hacienda query responses, CORS preflight and company verification statuses.
- F2.2 fiscal module currently uses a compact Prisma-backed application service rather than full repository ports/adapters.
- `FiscalDocumentService` remains large and combines several use-case and infrastructure orchestration responsibilities; this is future maintainability debt, not a blocking Post-F2.2 continuation defect.
- Fiscal API responses are sanitized objects rather than stable explicit DTOs.
- Fiscal management authorization is endpoint-local/service-local and not yet a reusable policy abstraction.
- Fiscal lines are JSON snapshots, not relational line rows.
- Fiscal E2E/API coverage exists for the completed Post-F2.2 continuation scope, but response DTO contracts are still not formalized as explicit classes/mappers.
- Worker process has no fiscal job handlers.
- XmlSignerPort exists as a stub only; no signing adapter is implemented.
- Existing Docker/npm audit concerns remain.

---

## 14. Open decisions requiring clarification

1. `securityCode` is currently hidden from fiscal responses; should any future internal/admin contract expose it, or should it remain persistence-only?
2. Is JSON storage for fiscal lines accepted for F2.2, or must a future migration introduce `fiscal_document_lines` before XML generation/reporting?
3. Should fiscal document type names be migrated from `INVOICE`/`TICKET` to `ELECTRONIC_INVOICE`/`ELECTRONIC_TICKET`, or are current enum names acceptable if Hacienda codes remain correct?
4. Should the default issuance-point uniqueness invariant be enforced by a partial unique DB index?
5. Should clean E2E database reset and collision-resistant fixture patterns be standardized as required CI/local validation policy?
6. Should auth throttling be enforced via global `APP_GUARD`, `app.useGlobalGuards`, or another approved auth-specific guard strategy?
7. Should `ApiKeyThrottlerGuard` explicitly select the named `api` throttler bucket, or is inherited default behavior sufficient after test evidence?

# Current State

> **Synchronized:** Documentation-only ownership reconciliation for canonical `specs/post-f2-2-remediation` by `sdd-implementation-agent-c13b28` on 2026-09-12. No production code, tests or Prisma migrations modified.
> **Current validation evidence provided for this session:** `npm ci` pass with existing npm audit findings, Prisma generate/validate pass, clean `billing_e2e` reset plus `prisma migrate deploy` pass, lint/lint:check pass, typecheck pass, unit suite pass (181 tests / 28 suites), build pass and full E2E pass (57 tests / 11 suites).
> **Latest Post-F2.2 remediation audit:** baseline-audit-agent score **9.0/10** for canonical `specs/post-f2-2-remediation`. Verdict: no meaningful regression introduced and no blocking F2.2-specific gaps. Non-blocking notes: `FiscalDocumentService` remains large future maintainability debt and npm audit vulnerabilities are pre-existing/out of scope.

---

## 1. System overview

Billing is a multi-tenant SaaS API for Costa Rica electronic invoicing. It is implemented as a NestJS / TypeScript modular monolith with Prisma/PostgreSQL persistence and incremental ports-and-adapters practices.

Implemented phases and capabilities visible in the repository:

| Area | Current implemented capability |
|---|---|
| Foundation | Tenants, users, JWT authentication, refresh tokens, API keys, company management, audit log, health checks, validated configuration, Prisma/PostgreSQL. |
| Hacienda public queries | Taxpayer, CABYS and exchange-rate query modules using Hacienda integration ports/adapters and mock mode support. |
| Hacienda connection | Per-company/per-environment Hacienda credential lifecycle and connection validation; OIDC auth adapter and token cache exist. |
| Security hardening | Helmet in API bootstrap, production CORS validation through config schema, configurable throttling and circuit-breaker values. |
| Fiscal document core F2.2 | Fiscal issuance points, fiscal sequences, immutable fiscal documents, DB-backed idempotency, invoice/ticket API-key creation and retrieval, JWT-only fiscal configuration, Hacienda v4.4 consecutive and clave helpers, fixed-scale decimal helper. COMPLETE at `READY_FOR_XML`. |
| Post-F2.2 remediation | Scoped fiscal consecutive uniqueness, canonical idempotency constraint cleanup, fiscal E2E, PostgreSQL concurrency, sanitization and clean-E2E evidence. COMPLETE under `specs/post-f2-2-remediation`. |
| F2.3 XML/XSD/XAdES | NOT STARTED. No XML generation, XSD validation, XAdES signing, Hacienda submission, polling, callbacks, workers, PDF, email or webhooks. |

Current fiscal document scope ends at `READY_FOR_XML`. XML generation, XSD validation, XAdES signing, Hacienda submission, polling, PDFs, email and webhooks are not implemented.

## Phase status

| Phase | Status |
|---|---|
| Foundation | COMPLETE |
| Fase 1 Hacienda consultas | COMPLETE |
| F2.1 Hacienda Connection | COMPLETE |
| F2.2 Fiscal Document Core | COMPLETE |
| Post-F2.2 remediation | COMPLETE |
| F2.3 XML/XSD/XAdES | NOT STARTED |

Fase 1 unresolved findings are retained only as deferred historical/repository-level items and are not blockers for F2.2 or Post-F2.2 remediation completion.

---

## 2. Repository structure

Relevant current structure:

```text
Billing/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       ├── 20250001000000_initial_foundation/
│       ├── 20250002000000_company_hacienda_fields/
│       ├── 20250003000000_hacienda_connection/
│       ├── 20260911140000_fiscal_document_core/
│       ├── 20260911143000_fiscal_idempotency_scope/
│       ├── 20260912123000_post_f2_2_fiscal_constraints/
├── specs/
│   ├── fase-1-hacienda-consultas/          # Fase 1 history only
│   ├── post-f2-2-remediation/              # canonical Post-F2.2 remediation owner
│   └── fase-2-2-fiscal-document-core/
├── src/
│   ├── app.module.ts
│   ├── api/
│   ├── bootstrap/
│   ├── infrastructure/
│   └── modules/
│       ├── api-keys/
│       ├── audit/
│       ├── cabys/
│       ├── companies/
│       ├── exchange-rates/
│       ├── fiscal-documents/
│       ├── hacienda-connection/
│       ├── identity/
│       └── taxpayers/
└── test/
```

`src/app.module.ts` imports `FiscalDocumentsModule` in addition to existing modules.

---

## 3. Current architecture

The system is an API-first modular monolith. Most modules follow a layered domain/application/infrastructure structure. Cross-cutting infrastructure lives under `src/infrastructure`, while HTTP guards, filters and interceptors live under `src/api`.

The fiscal documents module follows the same top-level folder naming but currently uses a compact service implementation:

- HTTP controllers call `FiscalDocumentService` directly.
- `FiscalDocumentService` injects `PrismaService` and `AuditService` directly.
- Fiscal domain helpers (`fiscal-key.generator.ts`, `scaled-decimal.ts`, `fiscal.constants.ts`) do not import NestJS or Prisma.
- There are no fiscal repository port/adapters yet.

This is observable current architecture, not a target architecture.

---

## 4. Existing domains and modules

| Domain / Module | Responsibility | Current code location |
|---|---|---|
| Identity | Tenants, users, JWT auth, refresh token lifecycle. | `src/modules/identity` |
| Companies | Company aggregate and Hacienda verification metadata. | `src/modules/companies` |
| API Keys | API-key lifecycle, argon2id hash verification, scopes, company authorization relation. | `src/modules/api-keys` |
| Hacienda Public Queries | Taxpayer, CABYS and exchange-rate public lookup capabilities. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda Connection | Company/environment Hacienda credential configuration and validation. | `src/modules/hacienda-connection` |
| Fiscal Documents | Fiscal issuance-point configuration, sequence configuration/allocation, invoice/ticket creation, fiscal document retrieval, fiscal key and decimal helpers. | `src/modules/fiscal-documents` |
| Audit | Audit event recording with event classes. | `src/modules/audit` |
| Infrastructure | Config, database, Hacienda integration, queue, secrets, storage, signing port, tenant context. | `src/infrastructure` |

---

## 5. Main use cases

Implemented fiscal use cases:

1. **Upsert default fiscal issuance point**
   - Endpoint: `PUT /api/v1/companies/:companyId/fiscal/:environment/issuance-points/default`
   - Auth: JWT guard.
   - Authorization: `FiscalDocumentService.assertTenantAdmin()` accepts role `TENANT_ADMIN` only.
   - Behavior: upserts active default branch `001` / terminal `00001` for company/environment.

2. **Configure fiscal sequence**
   - Endpoint: `PUT /api/v1/companies/:companyId/fiscal/:environment/sequences/:documentType`
   - Auth: JWT guard.
   - Authorization: TENANT_ADMIN only.
   - Behavior: configures `nextValue` for the default issuance point. If `lastAssigned` exists, rejects with `FISCAL_SEQUENCE_ALREADY_STARTED`.

3. **Create invoice**
   - Endpoints: `POST /api/v1/invoices` and `POST /api/v1/companies/:companyId/fiscal-documents/:environment/invoices`
   - Auth: API key guard and scope guard.
   - Scope: `invoices:write`.
   - Behavior: creates a fiscal document of type `INVOICE`, requires receiver, idempotency key, active company, authorized API key/company relation, HaciendaConnection not disabled, active default issuance point, sequence allocation and clave generation. Persisted status is `READY_FOR_XML`.

4. **Create ticket**
   - Endpoints: `POST /api/v1/tickets` and `POST /api/v1/companies/:companyId/fiscal-documents/:environment/tickets`
   - Auth: API key guard and scope guard.
   - Scope: `tickets:write`.
   - Behavior: creates a fiscal document of type `TICKET`; receiver is optional. Persisted status is `READY_FOR_XML`.

5. **Retrieve fiscal document**
   - Endpoint: `GET /api/v1/fiscal-documents/:id`
   - Auth: API key guard.
   - Dynamic authorization in service: requires `invoices:read` for stored type `INVOICE`, `tickets:read` for stored type `TICKET`, plus API-key/company authorization.

Existing non-fiscal use cases include tenant/user auth, company CRUD, API-key lifecycle, Hacienda public lookups and Hacienda connection management.

Implemented Fase 1 Hacienda public query use cases:

1. **Lookup taxpayer**
   - Endpoint: `GET /api/v1/taxpayers/:identification`.
   - Auth: API key via `ApiKeyAuthGuard`.
   - Scope: `taxpayers:read` via `ScopeGuard`.
   - Rate-limit intent: per-API-key inbound throttling through `ApiKeyThrottlerGuard`.

2. **Lookup/search CABYS**
   - Endpoints: `GET /api/v1/cabys/:code` and `GET /api/v1/cabys?search=...`.
   - Auth: API key; scope `cabys:read`.
   - Validation: direct code must be exactly 13 digits; search query has a minimum-length rule.

3. **Lookup exchange rate**
   - Endpoint: `GET /api/v1/exchange-rates`.
   - Auth: API key; scope `exchange-rates:read`.

4. **JWT auth login/refresh**
   - Endpoints: `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`.
   - Current code applies `@Throttle({ auth: { ttl: 60000, limit: 10 } })` on both methods.
   - Current code inspection did not find a visible global `ThrottlerGuard`/`APP_GUARD`; therefore enforcement of these decorators is unproven.

5. **Company creation with Hacienda verification metadata**
   - `Company` includes nullable `haciendaName`, `haciendaVerifiedAt` and `haciendaVerificationStatus` fields.
   - Status values implemented in domain/schema are `VERIFIED`, `NOT_FOUND`, `UNAVAILABLE`, `ERROR`, `SKIPPED`.
   - Positive/negative E2E evidence for all status outcomes remains incomplete.

---

## 6. Current data flows

### Fiscal creation flow

1. Client calls invoice/ticket endpoint with `X-API-Key` and `Idempotency-Key`.
2. `ApiKeyAuthGuard` authenticates key; `ScopeGuard` enforces static write scope where declared.
3. Controller maps request to `FiscalDocumentService.createDocument()`.
4. Service validates DTO-derived command values and hashes normalized request payload.
5. Prisma transaction checks active company and API-key company authorization, then reserves the canonical idempotency key before fiscal numbering.
6. Idempotency reservation uses PostgreSQL `INSERT ... ON CONFLICT DO NOTHING RETURNING` against `fiscal_idempotency_keys`; if an identical completed request already exists, the stored response is returned, and if the same key has a different request hash, a conflict is raised.
7. After idempotency reservation, the transaction checks HaciendaConnection existence/not disabled and active default issuance point.
8. Sequence allocation uses raw SQL `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` against `fiscal_sequences`.
9. Consecutive and 50-digit clave are generated; 8-digit security code uses cryptographic `randomInt`.
10. Totals are calculated with `ScaledDecimal` fixed 5-decimal arithmetic from provided line quantities/prices/discount/tax.
11. Fiscal document and idempotency state are persisted.
12. Audit event `fiscal-document.created` is recorded with categorical metadata.

### Fiscal retrieval flow

1. Client calls `GET /api/v1/fiscal-documents/:id` with `X-API-Key`.
2. Service loads fiscal document by id and tenant.
3. Service determines required read scope from persisted type.
4. Service checks API-key/company authorization.
5. Audit event `fiscal-document.read` is recorded.
7. A sanitized fiscal document object is returned; current mapper removes `securityCode` and `requestHash`.

---

## 7. Database and persistence

Prisma schema now includes F2.2 fiscal models and enums:

- `FiscalDocumentType`: `INVOICE`, `TICKET`.
- `FiscalDocumentStatus`: `READY_FOR_XML`.
- `FiscalIdempotencyStatus`: `IN_PROGRESS`, `COMPLETED`.
- `FiscalIssuancePoint` table mapped to `fiscal_issuance_points`.
- `FiscalSequence` table mapped to `fiscal_sequences`.
- `FiscalDocument` table mapped to `fiscal_documents`.
- `FiscalIdempotencyKey` table mapped to `fiscal_idempotency_keys`.

Migrations:

- `prisma/migrations/20260911140000_fiscal_document_core/migration.sql`
- `prisma/migrations/20260911143000_fiscal_idempotency_scope/migration.sql`
- `prisma/migrations/20260912123000_post_f2_2_fiscal_constraints/migration.sql`

Important constraints/indexes currently present after Post-F2.2 remediation:

- Unique issuance point by `companyId`, `environment`, `branchCode`, `terminalCode`.
- Sequence unique scope by `tenantId`, `companyId`, `environment`, `branchCode`, `terminalCode`, `documentType`.
- Scoped fiscal document consecutive uniqueness by `tenantId`, `companyId`, `environment`, `consecutive`.
- Globally unique `fiscal_documents.clave`.
- Fiscal document indexes by tenant/company/createdAt and tenant/company/status.
- Non-unique fiscal document lookup index by `tenantId`, `companyId`, `idempotencyKey`.
- Legacy unique fiscal document idempotency by `tenantId`, `companyId`, `idempotencyKey` has been removed.
- Unique canonical fiscal idempotency key by `tenantId`, `companyId`, `apiKeyId`, `operation`, `key`.
- `fiscal_idempotency_keys.api_key_id` references `api_keys.id` with `ON DELETE SET NULL`.

Current persistence implementation uses Prisma directly from the fiscal application service. Fiscal documents persist snapshots as JSON fields (`issuerSnapshot`, optional `receiverSnapshot`, `lines`, `totals`). There is no separate `fiscal_document_lines` table in the implemented schema, despite the original requirement mentioning fiscal document lines.

---

## 8. APIs and integrations

Fiscal APIs implemented under the global `/api/v1` prefix:

| Method/path | Auth | Scope/authorization | Current response |
|---|---|---|---|
| `PUT /companies/:companyId/fiscal/:environment/issuance-points/default` | JWT | TENANT_ADMIN role in service | Prisma issuance point record |
| `PUT /companies/:companyId/fiscal/:environment/sequences/:documentType` | JWT | TENANT_ADMIN role in service | Prisma sequence record |
| `POST /invoices` | API key | `invoices:write` + company authorization | Sanitized fiscal document object without `securityCode`/`requestHash`; top-level bigint values serialized as strings |
| `POST /tickets` | API key | `tickets:write` + company authorization | Sanitized fiscal document object without `securityCode`/`requestHash`; top-level bigint values serialized as strings |
| `POST /companies/:companyId/fiscal-documents/:environment/invoices` | API key | `invoices:write` + company authorization | Sanitized fiscal document object without `securityCode`/`requestHash`; top-level bigint values serialized as strings |
| `POST /companies/:companyId/fiscal-documents/:environment/tickets` | API key | `tickets:write` + company authorization | Sanitized fiscal document object without `securityCode`/`requestHash`; top-level bigint values serialized as strings |
| `GET /fiscal-documents/:id` | API key | Dynamic read scope + company authorization | Sanitized fiscal document object without `securityCode`/`requestHash`; top-level bigint values serialized as strings |

F2.2 does not call Hacienda OIDC, Hacienda submission APIs, XML signing, storage or queue adapters during fiscal document creation.

---

## 9. Authentication and authorization

Current authorization/rate-limiting behavior:

- Fase 1 Hacienda query endpoints use `ApiKeyAuthGuard`, `ApiKeyThrottlerGuard` and `ScopeGuard` at controller level.
- Fase 1 required scopes are `taxpayers:read`, `cabys:read` and `exchange-rates:read`.
- `ApiKeyThrottlerGuard` extends `ThrottlerGuard` and uses API-key id as tracker key with IP fallback; this indicates per-key throttling intent, but the exact named-throttler bucket used by the inherited guard is not proven by an endpoint threshold test.
- Auth login/refresh methods use `@Throttle({ auth: { ttl: 60000, limit: 10 } })`, but code inspection found no visible global `ThrottlerGuard`/`APP_GUARD` registration. Decorator presence alone may not enforce throttling.
- Creation/read fiscal endpoints use API-key auth.
- Type-specific fiscal scopes are active: `invoices:write`, `tickets:write`, `invoices:read`, `tickets:read`.
- `tickets:read` and `tickets:write` are now included in `ALLOWED_API_KEY_SCOPES`.
- Generic `documents:*` scopes remain allowed/reserved but are not used by fiscal invoice/ticket endpoint annotations or service read checks.
- API-key/company authorization is checked through `apiKeyCompany` on create and read.
- Configuration endpoints use JWT auth and an endpoint-local role check requiring `TENANT_ADMIN`.

Known limitation: fiscal management authorization is implemented as a compact role string check in the service, not through a reusable policy/guard.

---

## 10. Events and background processing

- Fiscal audit events are recorded through `AuditService.record()` using `EventClass.FISCAL_AUDIT`.
- Current fiscal actions include `fiscal-issuance-point.upserted`, `fiscal-sequence.configured`, `fiscal-document.created`, and `fiscal-document.read`.
- No domain-event bus is implemented for fiscal documents.
- No fiscal background jobs are implemented.
- Worker process exists but has no fiscal submission/polling handlers.

---

## 11. Containers and deployment

Current container/deployment assets:

- `Dockerfile` multi-stage Node/Nest build and runtime image.
- `docker-compose.yml` with PostgreSQL, LocalStack, API and worker services.
- GitHub Actions CI workflow exists in `.github/workflows/ci.yml` according to prior documentation/audit.

Known current concerns retained from audit:

- Docker Compose has production-mode/default-secret concerns if reused as production deployment.
- Existing npm audit vulnerabilities remain a repository-level risk.

---

## 12. Current testing strategy

Current automated tests include unit tests under `src/**/__tests__` and E2E tests under `test/`.

F2.2 fiscal tests currently include:

- `src/modules/fiscal-documents/domain/__tests__/fiscal-key.generator.spec.ts`
- `src/modules/fiscal-documents/domain/__tests__/scaled-decimal.spec.ts`
- `test/e2e/fase2/fiscal-documents.e2e-spec.ts`
- `test/e2e/fase2/fiscal-management.e2e-spec.ts`
- `test/e2e/fase2/fiscal-concurrency.e2e-spec.ts`

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
- PostgreSQL concurrency coverage: pass (`test/e2e/fase2/fiscal-concurrency.e2e-spec.ts`).

Current Fase 1 E2E files exist under `test/e2e/fase1`, but repository inspection from the previous refresh showed incomplete positive-response evidence for taxpayer/CABYS/exchange-rate endpoints, rate-limit threshold enforcement, CORS preflight behavior and all company verification statuses. Those Fase 1 evidence gaps are unchanged by the Post-F2.2 fiscal continuation scope.

Current fiscal E2E coverage exists under `test/e2e/fase2` for fiscal document workflows, management endpoints and PostgreSQL-backed concurrency/idempotency scenarios. The fiscal suites cover invoices/tickets, negative authorization paths, tenant/company/environment/document-type isolation, response sanitization and sequence/idempotency race behavior.

---

## 13. Behavior to preserve

- API remains a modular NestJS monolith with `/api/v1` global prefix.
- Tenant isolation and API-key company authorization checks must remain fail-closed.
- Existing public Hacienda lookup APIs and HaciendaConnection APIs must remain compatible.
- Fase 1 Hacienda query endpoints must continue to require API keys and fail closed without required scopes.
- Auth endpoints should preserve successful login/refresh contracts while enforcing configured brute-force rate limits after approved correction.
- API-key endpoint throttling should remain per API key, not one global bucket for all clients.
- Fiscal document creation must stop at `READY_FOR_XML`.
- No XML/signing/submission side effects occur in F2.2 fiscal creation.
- Fiscal consecutive format is 20 digits: branch + terminal + document type + 10-digit sequence.
- Fiscal clave format is 50 digits and uses cryptographic random security code.
- Sequence allocation must not use `SELECT MAX + 1`.
- Idempotency key is required for fiscal creation and same-key/different-request conflicts must be rejected.

---

## 14. Known defects

| ID | Severity | Current defect |
|---|---|---|
| DEF-F1-RATE-001 | High | Auth login/refresh have `@Throttle` decorators, but no visible global `ThrottlerGuard`/`APP_GUARD` registration was found; auth rate limiting may not be enforced. |
| DEF-F1-RATE-002 | Medium | `ApiKeyThrottlerGuard` indicates per-key throttling intent, but named-throttler bucket/threshold behavior is ambiguous without focused tests. |
| DEF-F1-E2E-001 | Medium | Fase 1 E2E lacks positive endpoint response coverage for taxpayer, CABYS and exchange-rate happy paths. |
| DEF-F1-E2E-002 | Medium | Fase 1 evidence gaps remain for CORS preflight and company verification status outcomes (`VERIFIED`, `NOT_FOUND`, `UNAVAILABLE`, `ERROR`, `SKIPPED`). |
| DEF-F2.2-E2E-001 | Closed | Dedicated fiscal E2E coverage now exists for F2.2 workflow, authorization, management, response sanitization and PostgreSQL concurrency/idempotency scenarios. |
| DEF-E2E-DB-001 | Closed | Full E2E was validated after explicit clean `billing_e2e` reset and migration deploy; latest evidence reports 57 tests / 11 suites passing. |
| DEF-F2.2-RESP-001 | Closed | Fiscal responses now remove `securityCode` and `requestHash` before returning fiscal documents. Residual API-contract debt remains because mapping is a compact sanitizer rather than explicit DTO classes. |
| DEF-F2.2-IDEM-001 | Closed | Fiscal idempotency unique scope now includes `tenantId`, `companyId`, `apiKeyId`, `operation` and `key` via forward migration `20260911143000_fiscal_idempotency_scope`. |
| DEF-F2.2-LINES-001 | Low | Fiscal lines are stored as JSON in `fiscal_documents.lines`; no separate `FiscalDocumentLine`/`fiscal_document_lines` persistence model exists despite the original requirement. |

---

## 15. Architectural debt

| ID | Severity | Current debt |
|---|---|---|
| DEBT-F1-001 | Medium | Layered throttling is split between `@Throttle` decorators and a custom `ApiKeyThrottlerGuard`; active guard registration/named-throttler semantics are not documented by tests. |
| DEBT-F2.2-001 | Medium | `FiscalDocumentService` combines use-case orchestration, validation, authorization checks, calculations, idempotency, sequence allocation, persistence and audit. |
| DEBT-F2.2-002 | Medium | Fiscal application service imports and uses `PrismaService` directly instead of fiscal repository output ports/adapters. |
| DEBT-F2.2-003 | Medium | Dynamic read scope and TENANT_ADMIN management authorization are implemented inside the service rather than in explicit application policies/guards. |
| DEBT-F2.2-004 | Low | Fiscal document responses use a sanitizer that removes `securityCode`/`requestHash`, but there are not yet explicit response DTO classes/mappers for a stable public contract. |
| DEBT-F2.2-005 | Low | Fiscal document type names are implemented as `INVOICE`/`TICKET` instead of the requirement terminology `ELECTRONIC_INVOICE`/`ELECTRONIC_TICKET`; Hacienda document codes are correct. |
| DEBT-F2.2-006 | Low | Fiscal validation is MVP-level; no live/complete catalog validation for all Hacienda v4.4 fields is implemented. |

---

## 16. Security risks

| ID | Severity | Risk |
|---|---|---|
| SEC-F1-001 | High | Auth endpoint rate limiting may not be enforced because `@Throttle` is present but no visible global `ThrottlerGuard`/`APP_GUARD` registration was found. |
| SEC-F1-002 | Medium | API-key endpoint throttling behavior is not proven at configured threshold; risk is lower than auth because `ApiKeyThrottlerGuard` is explicitly applied to Fase 1 controllers. |
| SEC-F2.2-001 | Closed | Fiscal document responses remove `securityCode` and `requestHash`, and fiscal E2E tests assert sanitized responses. |
| SEC-F2.2-002 | Closed | Fiscal E2E tests now cover company authorization, scope denial, idempotency/concurrency behavior and API-key denial on management endpoints for the F2.2 continuation scope. |
| SEC-REPO-001 | High | Docker Compose production-mode/default-secret concern remains if Compose is reused as production. |
| SEC-REPO-002 | High | Existing npm audit vulnerabilities remain unresolved. |

---

## 17. Unknowns and assumptions

- `securityCode` is currently stored for clave generation traceability but removed from fiscal document responses; whether it should ever be exposed remains **Requires clarification** for future contract decisions.
- Whether F2.2 intentionally accepted JSON line snapshots instead of a separate `fiscal_document_lines` table: implementation did so, but product/data-reporting implications require clarification.
- Exact official catalog validation depth expected before XML generation: **Requires clarification**.
- Full E2E health after resetting the local DB: verified by implementation-agent evidence for this cycle (`npm run test:e2e -- --silent` pass, 57 tests / 11 suites).
- Exact runtime behavior of `@nestjs/throttler` v6 named throttlers in this configuration requires a focused test or code change approval.
- CORS preflight behavior is configured in `api.main.ts` but not verified by a current E2E test in this refresh.
- This refresh did not execute commands; validation status is based on user-provided results, implementation report and audit summary.

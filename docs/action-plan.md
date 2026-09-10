# Architectural Action Plan

> **Last updated:** post `pre-fase-2-hardening` implementation cycle.
> All pre-fase-2-hardening tasks are marked complete.
> This document now tracks open defects, the Fase 2 plan, and all future work.

---

## 1. Objective

1. Record completed pre-fase-2-hardening work as the confirmed baseline.
2. Fix the one remaining defect from the hardening cycle (DEFECT-001).
3. Define the Fase 2 architectural plan: **HaciendaConnection per Company** — allowing each company to configure and verify its own Hacienda credentials for future document submission.
4. Identify risks and constraints for the Fase 2 cycle.

---

## 2. Scope

### ✅ Completed — pre-fase-2-hardening

| Item | Status |
|---|---|
| Standalone Joi schema (`config.validation-schema.ts`) | ✅ Complete |
| 10 Joi config validation unit tests | ✅ Complete |
| CORS fail-fast at startup in production/staging | ✅ Complete |
| `api.main.ts` zero direct `process.env` reads | ✅ Complete |
| `HaciendaCircuitBreaker` 7 configurable thresholds via env vars | ✅ Complete |
| `LocalStorageAdapter` decoupled from `process.env` | ✅ Complete |
| `StorageModule` passes config via `ConfigService` | ✅ Complete |
| `hacienda.config.ts` typed `circuitBreaker` + `retry` sub-objects | ✅ Complete |
| `storage.config.ts` typed `localStoragePath` + `localStorageSecret` | ✅ Complete |
| CI: `npx prisma generate` in lint + typecheck jobs | ✅ Complete |
| CI: `USE_REAL_HACIENDA=false` in E2E job | ✅ Complete |
| `docker-compose.yml`: `CORS_ALLOWED_ORIGINS` env var | ✅ Complete |
| `.gitignore`: `SIGNED_*.xml` pattern | ✅ Complete |

### 🔵 In scope for next cycle

| Item | Status |
|---|---|
| DEFECT-001: Fix `GlobalExceptionFilter` `process.env` read | Proposed |
| Fase 2: HaciendaConnection domain model | Proposed |
| Fase 2: Database migration (`hacienda_connections` table) | Proposed |
| Fase 2: CreateHaciendaConnection use case | Proposed |
| Fase 2: GetHaciendaConnectionStatus use case | Proposed |
| Fase 2: VerifyHaciendaConnection use case | Proposed |
| Fase 2: HTTP controller + request/response DTOs | Proposed |
| Fase 2: Credential storage via SecretsModule | Proposed |
| Fase 2: Unit + integration + E2E tests | Proposed |

---

## 3. Out of scope

- Fiscal document submission (Fase 3+)
- XML generation (Fase 3+)
- XML signing adapter implementation (Fase 3+)
- Background worker job handlers (Fase 3+ — async document processing)
- Webhook delivery (Fase 4+)
- PDF generation (Fase 5+)
- UI/Frontend (Fase 8+)
- Payment and receipt processing (Fase 7+)
- Multi-instance rate limiting with Redis
- Prometheus metrics / distributed tracing

---

## 4. Requirements addressed

### From `Billing_Plan_Desarrollo.md` Fase 2

| Requirement | ID |
|---|---|
| Each company configures its own Hacienda credentials | REQ-F2-001 |
| Billing never uses global credentials for all clients | REQ-F2-002 |
| Credentials encrypted at rest | REQ-F2-003 |
| Secrets never appear in logs or API responses | REQ-F2-004 |
| Separation of TEST/PRODUCTION environment per company | REQ-F2-005 |
| Rotation, audit, minimum privilege | REQ-F2-006 |
| AWS Secret Manager as appropriate | REQ-F2-007 |
| `POST /api/v1/companies/{id}/hacienda-connection` | REQ-F2-008 |
| `GET /api/v1/companies/{id}/hacienda-connection/status` | REQ-F2-009 |
| `POST /api/v1/companies/{id}/hacienda-connection/test` | REQ-F2-010 |

### Defects

| ID | Requirement |
|---|---|
| DEFECT-001 | `GlobalExceptionFilter` reads `process.env.NODE_ENV` directly |

---

## 5. Current problems addressed

| Problem | Resolution |
|---|---|
| process.env reads in bootstrap | ✅ Resolved — HARD-003 |
| CORS wildcard in production was warn-only | ✅ Resolved — HARD-002 |
| HaciendaCircuitBreaker thresholds hardcoded | ✅ Resolved — HARD-004 |
| LocalStorageAdapter bypassed Joi schema | ✅ Resolved — HARD-005 |
| config.validation-schema not independently testable | ✅ Resolved — HARD-001 |
| CI lint/typecheck missing prisma generate | ✅ Resolved — HARD-007 |
| SIGNED_*.xml not gitignored | ✅ Resolved — HARD-006 |
| GlobalExceptionFilter reads process.env (DEFECT-001) | 🔴 Open — TASK-F2-001 proposed |
| Worker registers no job handlers | 🟡 Known — deferred to Fase 3 |
| Rate limiter state lost on restart (DEBT-004) | 🟡 Known — acceptable for single-instance |

---

## 6. Domains affected

### Fase 2

| Domain | Nature of change |
|---|---|
| **Companies** | New HaciendaConnection sub-entity; new use cases; new migration |
| **Hacienda Integration** | New per-company credential resolution; new Hacienda auth adapter |
| **Secrets** | SecretModule used to store/retrieve Hacienda credentials |
| **Audit** | New audit events for HaciendaConnection CRUD (EventClass: FISCAL_AUDIT) |

### DEFECT-001 fix

| Domain | Nature of change |
|---|---|
| **API Layer** | `GlobalExceptionFilter` — inject ConfigService instead of reading process.env |

---

## 7. Behavior to preserve

All behavior documented in `docs/current-state.md § 13` must be preserved through the Fase 2 cycle:

1. Multi-tenant data isolation (all queries filter by tenantId)
2. API key security (Argon2 hash; shown once; never recoverable)
3. Refresh token rotation (single-use; invalidated on use)
4. Hacienda contract isolation (BR-012: no Hacienda field names in API responses)
5. BR-014: taxpayer not-found detected via body discriminator
6. BR-015: CABYS codes ≠ economic activity codes
7. Audit immutability (no UPDATE/DELETE on audit_logs)
8. CORS fail-fast in production/staging
9. JWT minimum entropy (>= 32 chars in production)
10. All existing Fase 0 + Fase 1 E2E tests must continue to pass

---

## 8. Defects to correct

### DEFECT-001 — GlobalExceptionFilter reads process.env directly

**File:** `src/api/filters/global-exception.filter.ts`
**Line:** `const isProduction = process.env.NODE_ENV === 'production';`
**Required change:** Inject `ConfigService` into the filter and use `configService.get<string>('app.nodeEnv')` or `configService.get<string>('NODE_ENV')`.
**Risk:** Low — the filter works correctly; this is an architectural consistency fix only.
**Prerequisite:** None.

---

## 9. Future architectural changes

### Fase 2: HaciendaConnection per Company

**Concept model:**
```
Company
  └── HaciendaConnection (1:1 optional)
        - haciendaEnvironment: PRODUCTION | SANDBOX
        - secretRef: SSM parameter path (not the credential itself)
        - certStorageKey: Object Storage path for certificate
        - status: UNCONFIGURED | CONFIGURED | VERIFIED | REVOKED
        - lastVerifiedAt: timestamp | null
```

**Key design constraints:**
- Credentials NEVER stored in the database; only a reference path to the secret store (SSM)
- Certificate private keys NEVER logged or returned via API
- API responses for status endpoint include only status, environment, lastVerifiedAt (no credentials)
- All HaciendaConnection CRUD operations emit audit events with `eventClass: FISCAL_AUDIT`
- Company must exist in the same tenant; cross-tenant access returns 403

**HaciendaConnection state machine:**
```
UNCONFIGURED → CONFIGURED (credentials provided)
              → VERIFIED (test call succeeds)
CONFIGURED   → VERIFIED (test call succeeds)
             → UNCONFIGURED (credentials revoked/deleted)
VERIFIED     → CONFIGURED (re-configured; requires re-verification)
             → REVOKED (connection decommissioned)
Any          → REVOKED (explicit revoke)
```

### Hacienda OAuth (Fase 2 design question)

For authenticated Hacienda operations (Fase 2+), each company's HaciendaConnection will need:
- OAuth client credentials (username/password from ATVE)
- Certificate (.p12) for signing
- Token acquisition and refresh logic

The `HaciendaPort` interface will need new methods or a separate `HaciendaAuthPort`.
This is a design decision requiring clarification before implementation (see OD-004 in `docs/architecture.md`).

---

## 10. Database changes

### Proposed Fase 2 migration

New ENUMs:
```sql
CREATE TYPE "HaciendaEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');
CREATE TYPE "HaciendaConnectionStatus" AS ENUM (
  'UNCONFIGURED', 'CONFIGURED', 'VERIFIED', 'REVOKED'
);
```

New table:
```sql
CREATE TABLE "hacienda_connections" (
  "id"               UUID NOT NULL,
  "company_id"       UUID NOT NULL,
  "tenant_id"        UUID NOT NULL,
  "environment"      "HaciendaEnvironment" NOT NULL DEFAULT 'SANDBOX',
  "secret_ref"       VARCHAR(500),      -- SSM parameter path; NULL until configured
  "cert_storage_key" VARCHAR(500),      -- Object Storage key for certificate; NULL until configured
  "status"           "HaciendaConnectionStatus" NOT NULL DEFAULT 'UNCONFIGURED',
  "last_verified_at" TIMESTAMPTZ,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "hacienda_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hacienda_connections_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT,
  CONSTRAINT "hacienda_connections_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "hacienda_connections_company_id_unique" UNIQUE ("company_id")
);

CREATE INDEX "hacienda_connections_tenant_id_idx" ON "hacienda_connections"("tenant_id");
CREATE INDEX "hacienda_connections_status_idx" ON "hacienda_connections"("status");
```

**Migration safety:** All new table; no modification to existing tables. Fully backward-compatible. Additive only.

### Prisma schema additions

New Prisma models corresponding to the migration above, plus relation field on `Company` model.

---

## 11. API and integration changes

### New Fase 2 endpoints (JWT-authenticated, tenant+company scoped)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/companies/{id}/hacienda-connection` | Create or update HaciendaConnection config |
| `GET` | `/api/v1/companies/{id}/hacienda-connection/status` | Get connection status (no credentials) |
| `POST` | `/api/v1/companies/{id}/hacienda-connection/test` | Verify credentials against Hacienda |
| `DELETE` | `/api/v1/companies/{id}/hacienda-connection` | Revoke and remove connection |

### Response contract (status endpoint — no credentials)

```json
{
  "companyId": "uuid",
  "environment": "SANDBOX | PRODUCTION",
  "status": "UNCONFIGURED | CONFIGURED | VERIFIED | REVOKED",
  "lastVerifiedAt": "2025-01-01T00:00:00.000Z | null"
}
```

### No breaking changes to existing endpoints

All Fase 0 + Fase 1 endpoints retain identical contracts.

---

## 12. Container and deployment changes

### Fase 2

No new container services required. The existing `SecretsModule` already supports AWS SSM for production secret storage.

Possible new environment variables for Fase 2 (to be confirmed):
- `HACIENDA_SANDBOX_BASE_URL` — Hacienda sandbox endpoint (if different from production)
- Certificate storage path conventions (already covered by `StorageModule`)

### Future scaling (not in Fase 2 scope)

Multi-instance API deployments will require shared throttler state. This conflicts with ADR-003 (no Redis). This decision must be revisited before horizontal scaling is attempted.

---

## 13. Security changes

| Change | Reason | Priority |
|---|---|---|
| TASK-F2-001: Fix DEFECT-001 (GlobalExceptionFilter) | Architectural consistency; minor security edge case | Low |
| TASK-F2-004: HaciendaConnection credentials stored only as SSM references | REQ-F2-003: Encryption at rest | Critical |
| TASK-F2-005: Audit all HaciendaConnection CRUD with FISCAL_AUDIT event class | REQ-F2-006: Full auditability | High |
| TASK-F2-006: Certificate private key never logged or returned via API | REQ-F2-004: Secrets never exposed | Critical |
| TASK-F2-007: Cross-tenant HaciendaConnection access returns 403 | Multi-tenant isolation | High |

---

## 14. Test strategy

### Required for Fase 2

| Test | Type | What it validates |
|---|---|---|
| `hacienda-connection.entity.spec.ts` | Unit (domain) | Entity state machine, invariants |
| `create-hacienda-connection.handler.spec.ts` | Unit (application) | Use case: create connection |
| `get-hacienda-connection-status.handler.spec.ts` | Unit (application) | Use case: status query |
| `verify-hacienda-connection.handler.spec.ts` | Unit (application) | Use case: test credentials |
| `prisma-hacienda-connection.repository.spec.ts` | Unit (infrastructure) | Repository adapter |
| `hacienda-connection.e2e-spec.ts` | E2E | Full API flow; tenant isolation; credential safety |
| `security: credentials-not-in-response.spec.ts` | E2E | Credentials absent from all API responses |

### Existing tests must pass unchanged

All `test/e2e/fase0/` and `test/e2e/fase1/` tests must pass after Fase 2 changes without modification.

---

## 15. Migration stages

### Stage 1 — pre-fase-2-hardening ✅ COMPLETE

All items listed in section 2 (Completed) are implemented and confirmed via repository inspection.

### Stage 2 — DEFECT-001 Fix (Proposed)

1. Inject `ConfigService` into `GlobalExceptionFilter` via constructor
2. Replace `process.env.NODE_ENV === 'production'` with `configService.get<string>('NODE_ENV') === 'production'`
3. Update unit test if one exists for the filter
4. Verify no behavioral change in production mode

**Estimated risk:** Very low. Behavior is identical; only source of config changes.

### Stage 3 — Fase 2: HaciendaConnection (Proposed)

Ordered sub-stages to minimize risk:

**3a. Domain model**
- Define `HaciendaConnection` entity with state machine
- Define `HaciendaEnvironment` and `HaciendaConnectionStatus` value objects
- Define `HaciendaConnectionRepository` port
- Write domain entity unit tests

**3b. Database**
- Create new Prisma migration for `hacienda_connections` table + ENUMs
- Update `schema.prisma`
- Apply migration to dev environment
- Verify schema consistency

**3c. Application layer**
- `CreateHaciendaConnectionHandler` use case
- `GetHaciendaConnectionStatusHandler` use case
- `VerifyHaciendaConnectionHandler` use case
- `RevokeHaciendaConnectionHandler` use case
- Write handler unit tests with mocked port

**3d. Infrastructure — persistence**
- `PrismaHaciendaConnectionRepository` adapter
- Tenant isolation enforced
- Integration tests

**3e. Infrastructure — credential storage**
- Use existing `SecretsModule`/`SecretProviderPort` for credential storage
- Store only SSM reference path in database
- Write mock-based unit tests

**3f. HTTP layer**
- Request DTOs (create, verify)
- Response DTOs (status only; no credentials)
- `HaciendaConnectionController` with JWT guard
- Input validation
- Audit logging with `FISCAL_AUDIT` event class

**3g. Tests**
- Unit tests for all handlers and repository adapter
- E2E tests for new endpoints
- Security assertion: credentials absent from all API responses

**3h. Documentation refresh**
- Update `docs/current-state.md`
- Update `docs/architecture.md`
- Update `docs/tasks.md` with completed statuses

---

## 16. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hacienda OAuth token format changes | Low | High | Abstract behind `HaciendaAuthPort`; adapter is swappable |
| Credential leak via logging | Medium | Critical | AuditInterceptor must exclude `HaciendaConnection` payload fields; DTOs must not include secrets |
| Certificate storage unencrypted | Low | High | Encrypt before upload; document key management |
| pg-boss schema race (API + worker simultaneous start) | Low | Medium | Worker should start after API; add startup ordering to docker-compose |
| Cross-tenant HaciendaConnection access | Low (mitigated by design) | High | Enforce tenantId filter in all connection queries; verify in E2E test |
| Breaking existing API contracts | Low | High | Additive changes only; no existing endpoints modified |
| Rate limiter state lost on restart | Medium | Low | Documented as known limitation; acceptable for single-instance |

---

## 17. Rollback or recovery strategy

- All Fase 2 database changes are additive (new table; no modification to existing tables)
- The new table can be dropped with a rollback migration without affecting Fase 0/1 data
- No existing API endpoints are modified; rollback is safe
- If credential SSM storage fails, `HaciendaConnection` remains `UNCONFIGURED` — no partial state

---

## 18. Manual validation

### Before marking Fase 2 tasks complete

- [ ] `POST /api/v1/companies/{id}/hacienda-connection` creates connection record with UNCONFIGURED status
- [ ] `POST /api/v1/companies/{id}/hacienda-connection` with valid credentials transitions to CONFIGURED
- [ ] `GET /api/v1/companies/{id}/hacienda-connection/status` returns status, environment, lastVerifiedAt — no credentials
- [ ] `POST /api/v1/companies/{id}/hacienda-connection/test` calls Hacienda sandbox; VERIFIED on success
- [ ] Credentials (raw secret, certificate passphrase) absent from all API responses and audit logs
- [ ] Company from Tenant A is not accessible from Tenant B (returns 403)
- [ ] All existing Fase 0 + Fase 1 E2E tests pass without modification
- [ ] `npm test` passes with zero failures
- [ ] `npm run test:e2e` passes with zero failures

---

## 19. Approval status

| Task | Status |
|---|---|
| pre-fase-2-hardening (all tasks) | ✅ Complete |
| TASK-F2-001: Fix DEFECT-001 | 🔵 **Proposed — requires approval** |
| TASK-F2-002: HaciendaConnection domain entity | 🔵 **Proposed — requires approval** |
| TASK-F2-003: Database migration | 🔵 **Proposed — requires approval** |
| TASK-F2-004: CreateHaciendaConnection use case | 🔵 **Proposed — requires approval** |
| TASK-F2-005: GetHaciendaConnectionStatus use case | 🔵 **Proposed — requires approval** |
| TASK-F2-006: VerifyHaciendaConnection use case | 🔵 **Proposed — requires approval** |
| TASK-F2-007: HaciendaConnection HTTP controller | 🔵 **Proposed — requires approval** |
| TASK-F2-008: Credential storage via SecretsModule | 🔵 **Proposed — requires approval** |
| TASK-F2-009: Fase 2 unit + integration + E2E tests | 🔵 **Proposed — requires approval** |

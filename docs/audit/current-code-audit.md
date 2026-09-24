# Current Code Audit
## Spec: fiscal-company-configuration-and-secure-credentials
**Audit ID:** baseline-audit-agent-70f123
**Date:** 2026-09-25
**Scope:** Implementation completed by `sdd-implementation-agent-359f0d` on 2026-09-24
**Pre-existing baseline:** 817 tests / 65 suites (64 pass, 1 pre-existing fail)
**Post-implementation:** 893 tests / 72 suites (71 pass, 1 pre-existing fail — `f3-postgres-concurrency`)

---

## Executive Summary

The `fiscal-company-configuration-and-secure-credentials` implementation delivers the core
security objectives stated in the specification: PKCS#12 certificates are processed
entirely in memory, PINs never persist in plaintext, PostgreSQL stores only secret
references, and tenant isolation is correctly enforced throughout. The 14-step certificate
upload flow, the defense-in-depth signing-time identity check, and the rotation atomicity
invariant are correctly implemented and well-tested.

**One High-severity runtime defect was identified**: the `UpdateCompanyRequestDto`
accepts `'01'|'02'|'03'|'04'` numeric codes for `identificationType`, while Prisma
expects `'FISICA'|'JURIDICA'|'DIMEX'|'NITE'` enum names. The handler performs only a
TypeScript `as` assertion (no runtime conversion), so any `PUT /companies/:id` request
that includes `identificationType` will fail with a PostgreSQL enum error. The test suite
does not catch this because the Prisma `company.update` call is fully mocked.

**One Medium-severity spec gap was identified**: AC-029 (FR-026) requires a formal audit
event `company.identity-change-blocked-by-certificate-conflict` with `eventClass = SECURITY`
when DEC-003 blocks an identity change. The implementation emits only a `logger.warn`.
The corresponding test explicitly asserts that `audit.record` was NOT called, confirming
the omission.

**Three architectural debt items** are present: a cross-module domain import from
`companies` into `fiscal-documents`, the `UpdateCompanyHandler` bypassing the established
`COMPANY_REPOSITORY` port, and no role guard on the new `PUT /companies/:id` endpoint.

Documentation is strong within the spec; `docs/current-state.md` requires a refresh to
reflect the new capabilities.

---

## Overall Score

**Overall Score: 8.0 / 10**

**Verdict: Acceptable**

The core security invariants are implemented correctly. The score is held at 8.0 by a
breaking runtime bug (AUD-013), a missing mandatory audit event (AUD-001), and several
architectural debt items. The implementation would reach 9.0+ once AUD-013 and AUD-001
are resolved.

---

## Repository Overview

| Attribute | Value |
|---|---|
| Runtime | Node.js / NestJS modular monolith |
| Language | TypeScript (strict) |
| ORM | Prisma 5.x + PostgreSQL |
| Queue | pg-boss |
| Auth | JWT (JwtAuthGuard) + API-key (ApiKeyAuthGuard) |
| Secrets | SecretProvider port (injectable abstraction) |
| Certificate parsing | node-forge |
| File upload | Multer (memoryStorage override) |
| Tests | Jest — 893/893 pass |
| TypeScript | 0 compile errors |

**New files (production):**
- `domain/fiscal-xml/exceptions/fiscal-certificate.exceptions.ts`
- `application/fiscal-xml/cr-certificate-identity-extractor.service.ts`
- `application/fiscal-xml/upload-fiscal-signing-certificate.service.ts`
- `application/fiscal-xml/fiscal-read-certificate-metadata.service.ts`
- `application/fiscal-xml/fiscal-readiness.service.ts`
- `infrastructure/http/fiscal-certificate.controller.ts`
- `companies/application/use-cases/update-company/update-company.handler.ts`
- `companies/infrastructure/http/dtos/update-company.request.dto.ts`

---

## Current Architecture

**Style:** Layered modular monolith within NestJS. Modules are semi-hexagonal (ports and
adapters pattern is used in most modules).

**New services follow existing architectural conventions:**
- Domain exceptions in `domain/` layer (no framework imports)
- Application services in `application/` layer
- Controller in `infrastructure/http/`
- Module registration through `FiscalDocumentsModule`

**Certificate flow:** `FiscalCertificateController → UploadFiscalSigningCertificateService →
CrCertificateIdentityExtractorService + SecretProvider + PrismaService`

**Identity guard flow:** `CompanyController → UpdateCompanyHandler →
PrismaService (direct — see AUD-003) → FiscalCertificateIdentityConflictException`

**Signing-time identity check:** `FiscalSigningCertificateService.getActiveCertificate()` →
queries Company from DB → compares `extractedIdentityNumber` with `identificationNumber`

**Tenant isolation:** All new DB queries include `tenantId: ..., companyId: ...` in the
`where` clause. Confirmed in all five new services.

---

## Documentation Findings

### DOC-001 — `docs/current-state.md` Not Updated After Spec Completion
- **Severity:** Low
- **Type:** Outdated documentation
- **Evidence:** `docs/current-state.md` is synchronized to 2026-09-17 (F4). The new
  capabilities from this spec (FiscalReadinessService, CrCertificateIdentityExtractorService,
  UploadFiscalSigningCertificateService, DEC-003 identity guard, migration
  `20260924000000_add_cert_extracted_identity`) are absent.
- **Separation assessment:** The file correctly separates current-state truth from future
  plans — it simply needs to be synchronized to include the completed F5 capabilities.
- **Impact:** Future agents relying on `current-state.md` will have an incomplete picture
  of what is deployed.

### DOC-002 — Implementation Report Migration Name Mismatch
- **Severity:** Low
- **Type:** Contradiction with observable code
- **Evidence:** The implementation report (`specs/.../implementation-report.md`) states:
  - Migration name: `20260923000000_fiscal_certificate_identity_metadata`
  - `extracted_identity_type VARCHAR(4)`
  - Actual migration is at: `20260924000000_add_cert_extracted_identity`
  - Actual column: `extracted_identity_type VARCHAR(20)`
- **Impact:** Minor — the actual migration on disk is correct. The report contains wrong
  metadata. Not a production risk.

### DOC-003 — Spec Documentation (within specs/) Is Well-Structured
- **Severity:** N/A
- **Type:** Positive observation
- **Evidence:** `requirements.md`, `decisions.md`, `risks.md`, `security-log-verification.md`,
  and `implementation-report.md` clearly separate: observable current truth, active
  architecture decisions (DEC-001 through DEC-009), future change planning (risks, tasks),
  and optional target-state items (P1 items). The separation is consistent and internally
  coherent. No current and proposed state are mixed in an ambiguous way.

---

## Main Modules

| Module | Responsibility | New/Modified |
|---|---|---|
| `fiscal-documents` | Certificate lifecycle, signing, submissions | New services + controller |
| `companies` | Company CRUD, identity guard | New handler + DTO + controller update |
| `audit` | Audit trail | Used (not modified) |
| `identity` | JWT auth | Used (not modified) |
| `shared` | DomainException base | Used (not modified) |

---

## Main Dependencies (New)

| Dependency | Purpose | Risk |
|---|---|---|
| `node-forge` (existing) | PKCS#12 parsing, OID extraction | Residual: synthetic certs only in tests (RISK-001) |
| `multer` (existing) | Multipart upload | Memory storage correctly overridden |
| `PrismaService` (existing) | All DB access in new services | Direct use, no port |
| `SecretProvider` (existing) | Certificate + PIN storage | Correctly used via injection token |
| `AuditService` (existing) | Audit trail | Correctly used (with one gap — see AUD-001) |

---

## Database Findings

### DB-001 — New Migration is Safe and Additive
- **Severity:** N/A (positive)
- **Location:** `prisma/migrations/20260924000000_add_cert_extracted_identity/migration.sql`
- **Evidence:**
  ```sql
  ALTER TABLE "fiscal_signing_certificates"
    ADD COLUMN "extracted_identity_number" VARCHAR(30),
    ADD COLUMN "extracted_identity_type"   VARCHAR(20);
  ```
  Both columns are nullable — backward compatible with F4-S bootstrap row. No destructive
  operations. Idempotent `ALTER TABLE ADD COLUMN` pattern.
- **Impact:** None. Safe for zero-downtime deployment.

### DB-002 — No Partial Unique Constraint for Single ACTIVE Certificate Per Scope
- **Severity:** Low
- **Location:** `prisma/schema.prisma` — `FiscalSigningCertificate` model
- **Evidence:** The index `fiscal_signing_cert_scope_status_idx` on
  `(tenantId, companyId, environment, status)` is non-unique. There is no partial unique
  constraint enforcing `UNIQUE (tenantId, companyId, environment) WHERE status='ACTIVE'`.
- **Impact:** Under concurrent certificate uploads (two simultaneous requests for the same
  company + environment), both transactions could pass the "find existing ACTIVE cert"
  check (under PostgreSQL READ COMMITTED isolation) and both create an ACTIVE certificate.
  The result would be two ACTIVE certificates for the same scope.
- **Probability:** Very low (certificate rotation is a rare management operation). But it
  is technically reachable.
- **Recommendation:** Add a partial unique index:
  `CREATE UNIQUE INDEX ... ON fiscal_signing_certificates(tenant_id, company_id, environment) WHERE status = 'ACTIVE'`

### DB-003 — Schema Correctly Excludes Secret Material
- **Severity:** N/A (positive)
- **Evidence:** The `fiscal_signing_certificates` table stores only
  `certificateSecretReference` and `passwordSecretReference` (paths/references), plus
  safe metadata (fingerprint, serial, subject, issuer, dates). No PKCS#12 bytes, no base64
  certificate data, no PIN column exists in the schema.
- **Impact:** None. Compliance with FR-010 and AC-015 confirmed.

### DB-004 — `extractedIdentityType` Column Size Mismatch with Domain
- **Severity:** Low
- **Location:** `migration.sql` (VARCHAR(20)) vs domain usage
- **Evidence:** `extractedIdentityType` stores values like `'01'`, `'02'`, `'03'` (2 chars).
  `VARCHAR(20)` is overprovisioned but harmless. The schema model uses `@db.VarChar(20)`.
- **Impact:** None functional. Minor schema over-allocation.

---

## API Findings

### API-001 — Missing Response DTOs for Certificate Endpoints
- **Severity:** Low
- **Location:** `src/modules/fiscal-documents/infrastructure/http/fiscal-certificate.controller.ts`
  — `toMetadataResponse()` method
- **Evidence:** The method returns an anonymous plain object literal. No dedicated DTO
  class (e.g., `CertificateMetadataResponseDto`) is declared. The coding standard §1.3
  states: "Controllers always map to dedicated DTO classes."
  `@ApiOkResponse` and `@ApiCreatedResponse` decorators are absent from GET/POST endpoints.
- **Impact:** No Swagger schema generated for these endpoints. No class-level validation.
  Inconsistent with `CompanyResponseDto` and other response DTOs in the codebase.

### API-002 — Readiness Response Lacks Swagger Documentation
- **Severity:** Low
- **Location:** `fiscal-certificate.controller.ts` — `getFiscalReadiness()`
- **Evidence:** The readiness endpoint returns a `FiscalReadinessResult` interface directly.
  No `@ApiOkResponse` decorator. The response shape (including `reasonCodes` and
  `activeCertificate` sub-object) is undocumented in Swagger.
- **Impact:** Operators cannot explore the readiness API contract through Swagger UI.

### API-003 — `PUT /companies/:id` Has No Role Guard
- **Severity:** Medium
- **Location:** `src/modules/companies/infrastructure/http/company.controller.ts` — `updateCompany()`
- **Evidence:** The endpoint does not enforce `TENANT_ADMIN` role. Any authenticated JWT
  user (including `MEMBER` or `READ_ONLY` roles) can submit a `PUT /companies/:id` request
  and modify `legalName`, `tradeName`, or attempt identity field changes.
- **Contrast:** `POST /companies/:id/fiscal-certificates/:env` correctly calls
  `this.assertTenantAdmin(req.user)` before processing.
- **Impact:** Non-admin users can rename a company. Identity field changes would succeed
  if there is no active certificate (DEC-003 guard only activates when a cert exists).
  The spec (FR-014: "When a TENANT_ADMIN attempts to change...") implies TENANT_ADMIN as
  the expected actor, but this is not enforced.

### API-004 — File Size Check Duplication in Controller
- **Severity:** Low
- **Location:** `fiscal-certificate.controller.ts` L101-105 (`uploadCertificate`)
- **Evidence:**
  ```typescript
  // Multer already enforces this via limits: { fileSize: FISCAL_CERT_MAX_SIZE_BYTES }
  if (file.size > FISCAL_CERT_MAX_SIZE_BYTES) {
    throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_FILE_TOO_LARGE', ... });
  }
  ```
  When Multer's `fileSize` limit is exceeded, Multer throws and the controller method never
  executes. The controller-level guard is dead code.
- **Impact:** No functional impact. Misleading — implies the controller guard is needed
  when it is not.

### API-005 — `rotateCertificate` (PUT) Has No File Size Guard
- **Severity:** Low
- **Location:** `fiscal-certificate.controller.ts` — `rotateCertificate()` method (L130-178)
- **Evidence:** The `rotateCertificate()` method does NOT have the redundant file-size
  check that `uploadCertificate()` has at L101-105. Multer's `limits` still protects it,
  but the asymmetry with `uploadCertificate` is notable.
- **Impact:** None functional (Multer protects both). Minor inconsistency.

---

## Container Findings

No new Dockerfile or docker-compose changes were introduced by this spec. Existing
container findings from the F4 audit remain unchanged.

---

## Security Findings

### SEC-001 — PKCS#12 Memory-Only Processing: VERIFIED
- **Severity:** N/A (positive)
- **Location:** `fiscal-certificate.controller.ts` + DEC-005
- **Evidence:**
  ```typescript
  storage: multer.memoryStorage()
  ```
  Explicitly set in both `uploadCertificate` and `rotateCertificate` interceptors. The
  module-level `MulterModule.register({ dest: '/tmp/uploads' })` disk storage is correctly
  overridden per endpoint.
- **Impact:** PKCS#12 bytes never touch the filesystem. RISK-002 MITIGATED.

### SEC-002 — PIN Never in Logs: VERIFIED (10/10 sentinel tests)
- **Severity:** N/A (positive)
- **Location:** `certificate-upload-logging-security.spec.ts`
- **Evidence:** 10 sentinel-secret scenarios all pass. PIN, PKCS#12 bytes, base64 cert,
  Authorization token, and cookies absent from all logger spy calls across success and
  failure paths. RISK-008 MITIGATED / VERIFIED.

### SEC-003 — node-forge Exceptions Correctly Sanitized: VERIFIED
- **Severity:** N/A (positive)
- **Location:** `cr-certificate-identity-extractor.service.ts`
- **Evidence:** All forge operations are wrapped in explicit try/catch blocks. Raw forge
  errors (which may reference internal state) are caught and replaced with sanitized
  `DomainException` subclasses containing only error codes. No forge message can reach
  `GlobalExceptionFilter` via the PKCS#12 parsing path.

### SEC-004 — Direct `process.env` Access in Controller
- **Severity:** Low
- **Location:** `fiscal-certificate.controller.ts` L40-42
- **Evidence:**
  ```typescript
  const FISCAL_CERT_MAX_SIZE_BYTES = parseInt(
    process.env.FISCAL_CERT_MAX_SIZE_BYTES ?? '1048576',
    10,
  );
  ```
  This is a module-level constant evaluated at class load time, bypassing `ConfigService`
  and the Joi validation schema. If `FISCAL_CERT_MAX_SIZE_BYTES` is set to a non-numeric
  value, `parseInt` returns `NaN`. NaN comparisons (`file.size > NaN`) are always `false`,
  silently disabling the size check.
- **Impact:** Configuration not validated at startup. Inconsistent with coding standard §1.4
  ("All environment variables are validated with Joi on startup").

### SEC-005 — Misleading Empty `finally` Blocks
- **Severity:** Low
- **Location:** `fiscal-certificate.controller.ts` L121-123, L175-177
- **Evidence:**
  ```typescript
  } finally {
    // Discard buffer reference immediately after use (GC handles cleanup)
  }
  ```
  The comment implies the `finally` block actively discards the certificate buffer.
  An empty `finally` does nothing — V8's GC determines when memory is released, not the
  `try/finally` structure. The buffer is dereferenced when the function returns regardless.
- **Impact:** Code conveys false security assurance. No actual security impact.

### SEC-006 — Audit Metadata Safety: VERIFIED
- **Severity:** N/A (positive)
- **Evidence:** `certificate-lifecycle-audit.spec.ts` (9 tests) and
  `upload-fiscal-signing-certificate.service.spec.ts` use AuditService spy assertions
  to verify no PIN, PKCS#12 bytes, base64 cert, or secret references appear in any
  `audit.record()` call.

### SEC-007 — Tenant Isolation in All New Queries: VERIFIED
- **Severity:** N/A (positive)
- **Evidence:** All five new services (`UploadFiscalSigningCertificateService`,
  `FiscalReadCertificateMetadataService`, `FiscalReadinessService`,
  `FiscalSigningCertificateService` post-modification, `UpdateCompanyHandler`) include
  `tenantId: query.tenantId` and `companyId: query.companyId` in every DB query.
  Cross-tenant isolation is unit-tested in `update-company.handler.spec.ts`.

### SEC-008 — Secret References Never Returned in API Responses: VERIFIED
- **Severity:** N/A (positive)
- **Evidence:** `FiscalReadCertificateMetadataService` explicitly excludes
  `certificateSecretReference` and `passwordSecretReference` from the Prisma `select`.
  `FiscalReadinessService` does the same. `toMetadataResponse()` in the controller
  maps fields individually — no object spread that could leak additional fields.

---

## Testing Findings

### TST-001 — 78 New Tests: Good Coverage of Security Paths
- **Severity:** N/A (positive)
- **Evidence:** 10/10 sentinel tests, 11/11 extractor tests, 11/11 upload tests,
  13/13 DEC-003 tests, 8/8 readiness tests, 8/8 TASK-004 signing tests,
  9/9 lifecycle audit tests, 8/8 recovery tests. All pass.

### TST-002 — AUD-013 (Enum Bug) Not Caught by Tests
- **Severity:** High
- **Location:** `src/modules/companies/application/use-cases/update-company/__tests__/update-company.handler.spec.ts`
- **Evidence:** The `prisma.company.update` call is fully mocked:
  ```typescript
  update: jest.fn().mockResolvedValue(updatedCompany),
  ```
  The mock does not validate that `identificationType` is a valid Prisma enum value.
  No integration test exercises the full controller → handler → real Prisma path with
  `identificationType` in the request.
- **Impact:** The runtime `identificationType` enum mismatch bug (AUD-013) is invisible
  to the test suite.

### TST-003 — Real Hacienda Certificate Not Tested
- **Severity:** Low
- **Evidence:** All `CrCertificateIdentityExtractorService` tests use synthetic PKCS#12
  material generated by `createTestSigningMaterialWithFiscalId()` via node-forge.
  No real Hacienda-issued certificate has been tested. RISK-001 is residual.
- **Impact:** OID 2.5.4.5 extraction is validated against synthetic certs only. Real
  Hacienda certs may encode the fiscal identity differently.

### TST-004 — `f3-postgres-concurrency` Pre-existing Failure Unchanged
- **Severity:** Low (pre-existing)
- **Evidence:** `f3-postgres-concurrency.spec.ts` fails due to a DB teardown ordering
  issue (`audit_logs_api_key_id_fkey` FK constraint). Unrelated to this spec. Not modified.

### TST-005 — AC-029 Audit Event Not Tested (Positive Assertion)
- **Severity:** Medium
- **Location:** `update-company.handler.spec.ts` — test "DEC-003: blocked update audit records conflict event without secrets"
- **Evidence:**
  ```typescript
  // Audit must NOT have been called (we throw before the audit record)
  expect(audit.record).not.toHaveBeenCalled();
  ```
  The test asserts the ABSENCE of an audit event. But AC-029 requires the PRESENCE of
  `company.identity-change-blocked-by-certificate-conflict` audit event.
  The test name says "records conflict event" but asserts NO event is recorded —
  a contradiction between test name and assertion.
- **Impact:** The missing audit event (AUD-001) is actively validated in the wrong direction
  by the test suite. Future auditors may trust this test as spec-complete when it is not.

---

## Maintainability Findings

### MNT-001 — `FiscalReadinessService` Makes 5 Sequential DB Round-Trips
- **Severity:** Suggestion
- **Location:** `fiscal-readiness.service.ts` — `evaluate()` method
- **Evidence:** Five `await prisma.X.findFirst()` calls in sequence. Each awaited
  individually. The identity check is a 6th query if a cert is found.
- **Impact:** 5–6 sequential DB round trips for each readiness check. This is a management
  endpoint unlikely to be on hot paths, but could be reduced to 2-3 queries using
  `Promise.all` or a combined query with `include`.

### MNT-002 — `FiscalCertificateController` Has Duplicate Upload/Rotate Logic
- **Severity:** Low
- **Location:** `fiscal-certificate.controller.ts`
- **Evidence:** `uploadCertificate()` (POST) and `rotateCertificate()` (PUT) share
  identical validation logic (file check, pin check, delegate to same service). The only
  functional difference is the HTTP method and status code.
- **Impact:** Low risk of divergence. Minor code duplication. Could be extracted to a
  shared private method.

### MNT-003 — Partial Node-Forge Error Classification
- **Severity:** Suggestion
- **Location:** `cr-certificate-identity-extractor.service.ts` L93-100
- **Evidence:**
  ```typescript
  try {
    return forge.pkcs12.pkcs12FromAsn1(asn1, false, pin);
  } catch {
    // forge throws when PIN is wrong or structure is broken after ASN.1 parse
    // We can't distinguish wrong-PIN from corrupt structure...
    throw new FiscalCertificatePinInvalidException();
  }
  ```
  A valid-ASN.1 but otherwise corrupt PKCS#12 would be reported as "wrong PIN" to the
  operator, which is misleading.
- **Impact:** Poor operator UX when encountering corrupt certificates. The code comment
  acknowledges the limitation. node-forge does not expose a reliable way to distinguish
  these cases.

---

## Technical Debt

| ID | Location | Description | Severity |
|---|---|---|---|
| TD-001 | `update-company.handler.ts` | Direct `PrismaService` injection bypasses `COMPANY_REPOSITORY` port | Medium |
| TD-002 | `update-company.handler.ts` | Cross-module import from `fiscal-documents` domain | Medium |
| TD-003 | `fiscal-certificate.controller.ts` | `process.env` at module scope instead of `ConfigService` | Low |
| TD-004 | `fiscal-certificate.controller.ts` | No response DTO classes; anonymous object returns | Low |
| TD-005 | `update-company.handler.ts` | Missing `audit.record` call for AC-029 | Medium |
| TD-006 | `fiscal-documents.module.ts` | `MulterModule.register({ dest: '/tmp/uploads' })` as module default (pre-existing) | Medium |

---

## Behavior to Preserve

These behaviors are working correctly and must not be altered by any future refactoring:

1. **PKCS#12 memory-only processing.** Certificate bytes must never be written to disk.
   The `multer.memoryStorage()` override in `FiscalCertificateController` is mandatory.

2. **14-step certificate upload sequence.** Steps 1-9 (validation/checks) must all
   complete before any secret is stored. Secrets (Steps 11-12) must precede DB transaction
   (Steps 13-14). This ordering is what makes failure-path behavior safe.

3. **Rotation atomicity invariant.** The old ACTIVE certificate must remain ACTIVE inside
   the same `$transaction` that marks it REPLACED. The DB transaction wrapping both the
   REPLACED update and the ACTIVE create must be preserved.

4. **Compensating secret cleanup.** If the DB transaction fails after secrets are stored,
   `attemptCleanupSecret()` must be called for both cert and pin refs. Orphan-secret
   warning logging must be preserved.

5. **Pre-signing identity re-check.** `FiscalSigningCertificateService.getActiveCertificate()`
   must continue to re-validate `extractedIdentityNumber` against the current Company
   `identificationNumber` before loading secrets. This guard must not be removed even
   if the DEC-003 upload-time guard is strengthened.

6. **Skip identity check for legacy certs.** When `extractedIdentityNumber IS NULL`
   (F4-S bootstrap row and pre-upload certs), the identity check must be skipped.
   Existing docs confirm the F4-S company must re-upload its cert to restore full signing.

7. **HTTP 202 remains `POST_OUTCOME_UNKNOWN`.** The Hacienda response handling mapping
   is unmodified. 202 must never be treated as acceptance.

8. **Restart recovery via `enqueueDueWork()`.** Non-terminal submissions must be
   rediscovered on `onModuleInit()`. No new document, no new POST, no new consecutive.

9. **DEC-003 identity conflict guard.** `assertNoCertificateIdentityConflict()` must only
   trigger when `identityWouldChange = true`. Unrelated field updates (legalName, tradeName)
   must never trigger the cert check.

10. **Secret references never in API responses.** `certificateSecretReference` and
    `passwordSecretReference` must not appear in any HTTP response or audit record.

---

## Known Defects

### AUD-001 — Missing Audit Event for `FISCAL_CERTIFICATE_IDENTITY_CONFLICT` (AC-029)
- **Severity:** Medium
- **Category:** Spec gap — known defect
- **Location:** `src/modules/companies/application/use-cases/update-company/update-company.handler.ts`
  — `assertNoCertificateIdentityConflict()` method (L175-187)
- **Evidence:**
  The method calls `this.logger.warn(...)` and then throws `FiscalCertificateIdentityConflictException`.
  It does NOT call `this.audit.record(...)`.
  
  AC-029 requires:
  > "an entry with action `company.identity-change-blocked-by-certificate-conflict` and
  > `eventClass = SECURITY` exists, containing `companyId` and safe metadata — no secrets."
  
  FR-026 requires: "Security-sensitive configuration actions MUST be recorded in the audit log."
  
  Confirmed by test at `update-company.handler.spec.ts` line 161-163:
  ```typescript
  // Audit must NOT have been called (we throw before the audit record)
  expect(audit.record).not.toHaveBeenCalled();
  ```
  The test explicitly validates the ABSENCE of the audit event, contradicting the spec.
- **Impact:** Blocked identity-change attempts are not recorded in the formal audit log.
  Forensic investigation and compliance reporting (FR-026) cannot detect blocked attempts
  from audit data alone. Only the application log (`logger.warn`) records the event, which
  is not a durable security audit trail.
- **Recommendation:** Call `this.audit.record({ action: 'company.identity-change-blocked-by-certificate-conflict', eventClass: EventClass.SECURITY, ... })` before throwing. Update the test to assert the audit event was called with safe metadata.

### AUD-013 — `identificationType` Enum Mismatch Breaks `PUT /companies/:id`
- **Severity:** High
- **Category:** Runtime defect
- **Location:** `src/modules/companies/infrastructure/http/dtos/update-company.request.dto.ts` +
  `src/modules/companies/application/use-cases/update-company/update-company.handler.ts` L94-96
- **Evidence:**
  `UpdateCompanyRequestDto` validates `identificationType` against numeric codes:
  ```typescript
  const IDENTIFICATION_TYPES = ['01', '02', '03', '04'] as const;
  @IsIn(IDENTIFICATION_TYPES)
  identificationType?: string;
  ```
  
  `CreateCompanyRequestDto` (the existing DTO) validates against enum names:
  ```typescript
  enum IdentificationTypeEnum { FISICA = 'FISICA', JURIDICA = 'JURIDICA', ... }
  @IsEnum(IdentificationTypeEnum)
  ```
  
  The handler uses a TypeScript `as` assertion — not a runtime conversion:
  ```typescript
  // The identificationType string value maps to the Prisma enum — cast is safe
  // because the DTO validates it against the allowed enum values ('01'|'02'|'03'|'04').
  identificationType: command.identificationType as
    'FISICA' | 'JURIDICA' | 'DIMEX' | 'NITE' | undefined,
  ```
  The `as` cast does NOT transform `'02'` into `'JURIDICA'` at runtime.
  Prisma passes `'02'` to PostgreSQL where the column is typed as `IdentificationType` enum.
  PostgreSQL rejects the value with:
  `ERROR: invalid input value for enum "IdentificationType": "02"`
  
  The test suite does not catch this because `prisma.company.update` is fully mocked.
  TypeScript compiles without error because the `as` assertion suppresses the type check.
- **Impact:** Any `PUT /companies/:id` request that includes `identificationType` will fail
  with an unhandled Prisma/PostgreSQL error → HTTP 500. The `identificationType` update
  path of this endpoint is completely non-functional in a real database environment.
  The DEC-003 identity type conflict check logic (comparing numeric codes) happens to
  work correctly because it only compares the incoming `'02'` against the cert's
  stored `'02'` — but the subsequent DB write then fails.
- **Recommendation:** Either (a) change `UpdateCompanyRequestDto` to use
  `@IsEnum(IdentificationTypeEnum)` (consistent with `CreateCompanyRequestDto`), or
  (b) add an explicit mapping function in the handler:
  ```typescript
  const typeMap = { '01': 'FISICA', '02': 'JURIDICA', '03': 'DIMEX', '04': 'NITE' };
  ```
  Option (a) is simpler and aligns with the existing codebase convention. Note that
  option (a) would change the DEC-003 type conflict comparison to compare
  `'FISICA'`/`'JURIDICA'`/etc against cert's `'01'`/`'02'`/etc — requiring a mapping
  there too.

---

## Architectural Debt

### AUD-002 — Cross-Module Domain Dependency: `companies` → `fiscal-documents`
- **Severity:** Medium
- **Category:** Architectural debt
- **Location:** `src/modules/companies/application/use-cases/update-company/update-company.handler.ts` L4
- **Evidence:**
  ```typescript
  import { FiscalCertificateIdentityConflictException }
    from '../../../../fiscal-documents/domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';
  ```
  The `companies` application layer imports a domain exception from the `fiscal-documents`
  module. This creates a compile-time dependency from `CompaniesModule` onto
  `FiscalDocumentsModule`.
- **Impact:** The `companies` module cannot be understood, tested, or deployed in isolation.
  The exception name (`FiscalCertificateIdentityConflict`) leaks fiscal-documents
  domain language into the companies use case. If the fiscal-documents module is ever
  extracted or renamed, `update-company.handler.ts` breaks.
- **Architectural note:** DEC-001 decided to keep certificate services inside
  `FiscalDocumentsModule`, which is correct. However, the DEC-003 guard lives in the
  `companies` module and should use a `companies`-owned exception (e.g.,
  `CompanyCertificateConflictException`) that happens to return the same error code.

### AUD-003 — `UpdateCompanyHandler` Bypasses `COMPANY_REPOSITORY` Port
- **Severity:** Medium
- **Category:** Architectural debt
- **Location:** `src/modules/companies/application/use-cases/update-company/update-company.handler.ts`
- **Evidence:**
  ```typescript
  constructor(
    private readonly prisma: PrismaService,  // ← infrastructure dependency
    private readonly audit: AuditService,
  ) {}
  ```
  All other handlers in `companies/application/` use `@Inject(COMPANY_REPOSITORY)`.
  `UpdateCompanyHandler` injects `PrismaService` directly, bypassing the port abstraction.
  Furthermore, it queries `prisma.fiscalSigningCertificate` — a table owned by the
  `fiscal-documents` module — directly from a `companies` application handler.
- **Impact:** Violates the hexagonal/port pattern established in the module. The handler
  is now tied to both Prisma infrastructure and fiscal-documents schema details.
  Inconsistent with `CreateCompanyHandler`, `GetCompanyHandler`, and others.

---

## Unknown Behavior

1. **Real Hacienda PKCS#12 OID extraction.** The `CrCertificateIdentityExtractorService`
   has only been validated against synthetic node-forge-generated certificates. Real
   Hacienda-issued certificates may encode OID 2.5.4.5 differently (e.g., different
   encoding or attribute ordering). RISK-001 remains residual.

2. **`FiscalCertificateController` behavior when `FISCAL_CERT_MAX_SIZE_BYTES` env var
   is non-numeric.** If set to `'abc'`, `parseInt` returns `NaN`, and the Multer limit
   becomes `NaN`. Multer's behavior with `NaN` file size limit is undefined (may accept
   all files, may reject all files). The application does not fail-fast on startup for
   this condition.

3. **`UpdateCompanyHandler` full-stack behavior with real Prisma.** No integration test
   exercises the full controller→handler→PostgreSQL path. The enum mismatch bug (AUD-013)
   behavior in production is inferred from Prisma/PostgreSQL internals but not directly
   observed.

4. **Concurrent certificate rotation behavior.** Two simultaneous upload requests for the
   same company + environment under PostgreSQL READ COMMITTED isolation. The absence of a
   partial unique constraint (DB-002) means concurrent ACTIVE cert creation is theoretically
   possible; real-world probability is very low.

---

## Critical Risks

### RISK-A — `PUT /companies/:id` with `identificationType` Always Returns 500
- **Severity:** High
- **Root cause:** AUD-013 — `UpdateCompanyRequestDto` accepts `'01'|'02'|'03'|'04'`
  but Prisma enum requires `'FISICA'|'JURIDICA'|'DIMEX'|'NITE'`. The `as` cast in the
  handler is a TypeScript type assertion, not a runtime conversion.
- **Blast radius:** Any client attempting to update `identificationType` via the new
  endpoint will receive HTTP 500. The endpoint is partially broken.
- **Immediate fix required:** Yes.

### RISK-B — AC-029 Audit Gap for Blocked Identity Changes
- **Severity:** Medium
- **Root cause:** AUD-001 — `assertNoCertificateIdentityConflict()` does not call
  `audit.record()` before throwing.
- **Blast radius:** Blocked identity-change attempts are not recorded in the formal audit
  log. Compliance reporting and forensic investigation for this event class are affected.
- **Fix required before production use:** Yes.

---

## Recommended Priorities

### Priority 1 — Fix Before Merging to Production

**AUD-013 (High):** Fix `UpdateCompanyRequestDto` to accept Prisma enum names
(`FISICA | JURIDICA | DIMEX | NITE`) consistent with `CreateCompanyRequestDto`, OR add
an explicit mapping function in `UpdateCompanyHandler`. Also update the DEC-003 type
comparison to compare apples-to-apples (both in numeric form or both in enum-name form).
Update tests to assert the correct Prisma enum name is passed to `company.update`.

**AUD-001 (Medium):** Add `this.audit.record(...)` in `assertNoCertificateIdentityConflict()`
before throwing `FiscalCertificateIdentityConflictException`. Event:
`action: 'company.identity-change-blocked-by-certificate-conflict'`,
`eventClass: EventClass.SECURITY`. Update `update-company.handler.spec.ts` to assert the
audit event IS called (with safe metadata, no secrets). Fix the test name to accurately
describe the behavior.

**API-003 (Medium):** Add `TENANT_ADMIN` role guard to `PUT /companies/:id` in
`company.controller.ts`, consistent with the certificate upload endpoint pattern.

### Priority 2 — Fix in Next Sprint

**AUD-002 (Medium):** Relocate `FiscalCertificateIdentityConflictException` to
`src/modules/shared/domain/exceptions/` or define a `companies`-owned equivalent exception
class to break the cross-module compile-time dependency.

**AUD-003 (Medium):** Refactor `UpdateCompanyHandler` to inject `COMPANY_REPOSITORY`
instead of `PrismaService` for company reads/writes. For the fiscal-signing-certificate
check, either expose a minimal query method via a new port or keep the direct Prisma
query but acknowledge it as a deliberate cross-domain read with a comment.

**SEC-004 (Low):** Replace `process.env.FISCAL_CERT_MAX_SIZE_BYTES` with
`ConfigService.get<number>('FISCAL_CERT_MAX_SIZE_BYTES')` and add a Joi validation
rule to `config.validation-schema.ts`.

### Priority 3 — Housekeeping

- **API-001/API-002 (Low):** Create `CertificateMetadataResponseDto` class and add
  `@ApiOkResponse` / `@ApiCreatedResponse` decorators.
- **API-004 (Low):** Remove the redundant file-size check in `uploadCertificate()`.
- **SEC-005 (Low):** Remove the misleading `finally` blocks or replace comments with an
  accurate explanation.
- **DOC-001 (Low):** Update `docs/current-state.md` to document F5 capabilities.
- **DB-002 (Low):** Add a partial unique index on
  `(tenant_id, company_id, environment) WHERE status = 'ACTIVE'` in a future migration.

---

## Findings Index

| ID | Severity | Category | Summary |
|---|---|---|---|
| AUD-001 | Medium | Known Defect | Missing audit event for FISCAL_CERTIFICATE_IDENTITY_CONFLICT (AC-029) |
| AUD-002 | Medium | Architectural Debt | Cross-module domain import: companies → fiscal-documents |
| AUD-003 | Medium | Architectural Debt | UpdateCompanyHandler bypasses COMPANY_REPOSITORY port |
| AUD-013 | High | Known Defect | Enum mismatch — identificationType update breaks with real DB |
| API-003 | Medium | Security | No TENANT_ADMIN role guard on PUT /companies/:id |
| API-001 | Low | Maintainability | Missing response DTO classes for certificate endpoints |
| API-002 | Low | Maintainability | Readiness endpoint missing Swagger documentation |
| API-004 | Low | Dead Code | Redundant file-size check in uploadCertificate() |
| API-005 | Low | Inconsistency | rotateCertificate missing file-size guard present in upload |
| DB-002 | Low | Database | No partial unique constraint for single ACTIVE cert per scope |
| DB-004 | Low | Database | extractedIdentityType column oversized (VARCHAR(20) vs 2-char values) |
| SEC-004 | Low | Security | Direct process.env access in controller (not ConfigService) |
| SEC-005 | Low | Maintainability | Misleading empty finally blocks imply active buffer cleanup |
| MNT-001 | Suggestion | Performance | FiscalReadinessService makes 5 sequential DB queries |
| MNT-002 | Low | Maintainability | Duplicate upload/rotate logic in controller |
| MNT-003 | Suggestion | UX | Forge error misclassifies corrupt-after-ASN1 PKCS#12 as wrong-PIN |
| TST-002 | High | Testing | AUD-013 not caught — mocked Prisma bypasses enum validation |
| TST-003 | Low | Testing | Extractor tested with synthetic certs only (RISK-001 residual) |
| TST-005 | Medium | Testing | AC-029 test asserts wrong direction (audit NOT called) |
| DOC-001 | Low | Documentation | docs/current-state.md not updated after spec completion |
| DOC-002 | Low | Documentation | Implementation report migration name and column size mismatch |

---

*Audit produced by: baseline-audit-agent-70f123*
*Spec audited: specs/fiscal-company-configuration-and-secure-credentials/*
*Implementation agent: sdd-implementation-agent-359f0d*

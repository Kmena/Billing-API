# Changelog — Billing API

## [fase-4-s-hacienda-sandbox-validation-closed] — 2026-09-22

**Agent:** sdd-implementation-agent-86ebff
**Canonical spec:** `specs/fase-4-s-hacienda-sandbox-validation/`
**Scope:** F4-S specification closeout — documentation only. Zero production code changes, zero Hacienda network contact, zero consecutives consumed.

### Result
F4-S **CLOSED / VERIFIED**. The Billing pipeline was exercised end-to-end against the real Hacienda Costa Rica SANDBOX. One fiscal document was accepted.

### Verified pipeline path
- XML v4.4 generation → XSD validation PASS
- XAdES-EPES signature → certificate/emitter identity matched
- OAuth token via sandbox IdP (HTTP 200, Bearer, expires_in=300)
- POST /recepcion → HTTP 202 → Billing preserved `POST_OUTCOME_UNKNOWN` (correct)
- GET /recepcion/{clave} → `ind-estado=aceptado`, Mensaje=1, 0 fiscal/signature errors
- Billing final state = `ACCEPTED`
- Production requests = 0 | Secrets exposed = 0

### Accepted sandbox document
- Clave: `50622092600020753025100100001010000000012177202467`
- Consecutive: `00100001010000000012`
- Document ID: `314b07f5-8d56-4973-a6a3-1a280905eb07`

### Issues resolved during F4-S (were bugs in production pipeline)
1. Hacienda request-envelope mismatch
2. XAdES Policy structure
3. Certificate/emitter identity mismatch
4. Economic activity formatting
5. CAByS placeholder
6. Goods/service totals
7. TotalDesgloseImpuesto
8. CodigoTarifaIVA conditional handling

### Out-of-scope items (future specifications)
Durable fiscal configuration audit, self-service onboarding, certificate upload/rotation, secure `.p12`/PIN storage, durable submission recovery, TE sandbox validation, negative scenarios, token lifecycle, callback live observation, F4 delivery integration.

### Documentation updated
`specs/fase-4-s-hacienda-sandbox-validation/metadata.yaml`, `tasks.md`, `implementation-report.md`, `verification-matrix.md`, `changelog.md`, `current-state.md`.

---

## [proveedorSistemas-optional-field-fix] — 2026-09-22

**Agent:** sdd-implementation-agent-86ebff
**Canonical spec:** `specs/fase-4-s-hacienda-sandbox-validation/`
**Scope:** Bug fix — `proveedorSistemas` incorrectly required in fiscal profile completeness guard and XML serializer. No schema migration required. 19 new regression tests added.

### Bug fix
- `FiscalDocumentService.getReadyCompanyFiscalProfile()`: removed `profile.proveedorSistemas` from `requiredProfileFields`. Companies without this value can now proceed to FE/TE creation.
- `HaciendaV44XmlSerializerAdapter.requireParty()`: removed `'proveedorSistemas'` from the required-fields array. The XSD `<ProveedorSistemas>` element is emitted as empty when absent, which is XSD-valid (maxLength=20, no minLength).

### New tests
- `src/modules/fiscal-documents/application/__tests__/fiscal-document-profile-validation.spec.ts` — 14 tests covering optional field, fabrication prevention, required fields still enforced.
- `src/modules/fiscal-documents/infrastructure/xml/__tests__/hacienda-v44-xml-serializer.adapter.spec.ts` — +5 proveedorSistemas regression tests.

### Validation
- 603/615 main suite tests pass (12 pre-existing integration tests skipped).
- 222/222 F4-S unit tests pass.
- TypeScript: 0 errors.
- ESLint: 0 errors on affected files.

---

## [fase-3-hacienda-async-submission-final-architecture-refresh] — 2026-09-14

**Agent:** hdd-architecture-agent-4f9f0f
**Canonical spec:** `specs/fase-3-hacienda-async-submission/`
**Scope:** Final repository-level architecture/documentation reality sync after completed F3 implementation and final audit. No production code, tests, Prisma schema, migrations, package files or Docker files changed by this agent.

### Documentation
- Refreshed `docs/current-state.md` to record F3 as functionally complete: READY_TO_SUBMIT FE/TE asynchronous submission, submission state machine, retry classifier, `FiscalSubmission` persistence, Hacienda submission port, mock/real recepcion adapters, submit/status/reconcile/callback APIs, queue worker registration, submit/reconcile worker paths, response artifact persistence and audit/observability/security/concurrency/E2E coverage.
- Refreshed `docs/architecture.md` to make the active architecture current: F3 is now part of the fiscal-documents boundary; `FiscalSubmission` owns provider/job/reconciliation lifecycle; callbacks are signal-only; terminal document outcomes are authoritative `ACCEPTED`/`REJECTED` only.
- Refreshed `docs/action-plan.md` to move F3 implementation from future work to completed current capability and keep remaining work limited to production readiness/hardening.
- Replaced repository-level `docs/tasks.md` with a concise proposed backlog for remaining work: OQ-012 production IAM/SecretProvider readiness, npm audit triage, throttling/quota, UUID validation, prepare-XML concurrency, optional dedicated submission scopes, optional repository-port extraction and F4 specification.
- Preserved that F4 PDF/email/delivery is not introduced.

### Validation recorded
- Final audit: **Acceptable 8.6/10**.
- Supplied final gates passed: `npm ci`; Prisma generate/validate/migrate deploy on clean PostgreSQL 15; lint; lint:check; typecheck; unit; build; E2E; Docker build.
- Unit evidence: **49 suites / 349 tests**.
- E2E evidence: **15 suites / 85 tests**.
- Focused F3 evidence: **13 suites / 122 tests** and focused F3 E2E **14 tests**.
- `npm audit` reports **26 known vulnerabilities** unrelated to new F3 dependencies; risk remains documented.

---

## [f2-2-to-f2-3-end-to-end-fiscal-data-remediation-final] — 2026-09-13

**Agent:** sdd-implementation-agent-458e19
**Canonical spec:** `specs/f2-2-to-f2-3-end-to-end-fiscal-data-remediation/`
**Scope:** Final TASK-021 audit remediation and TASK-022 documentation reconciliation for normal F2.2 FE/TE API creation through F2.3 XML/sign/XSD validation to `READY_TO_SUBMIT`. No F3/Hacienda submission implemented.

### Changed
- Added explicit line tax metadata support for non-zero tax: `taxCode`, `taxRateCode`, `taxRate`, `taxAmount`.
- F2.2 rejects missing/invalid tax metadata, non-zero discounts, unsupported unit measures and unsupported sale/payment conditionals before `READY_FOR_XML`.
- F2.3 serializer consumes tax metadata and `proveedorSistemas` from immutable snapshots and rejects unsupported legacy seeded values.
- `CompanyFiscalProfile.proveedorSistemas` is snapshotted for XML generation. ~~Required for fiscal readiness~~ — corrected: this field is optional (see `[proveedorSistemas-optional-field-fix]` entry above). The XML element `<ProveedorSistemas>` is emitted as empty when absent.
- Documentation reconciled to record the `CompanyFiscalProfile` ownership model, immutable F2.2 -> F2.3 boundary, `READY_FOR_XML` completeness invariant and `READY_TO_SUBMIT` final pre-F3 boundary.

### Validation
- Final re-audit: PASS with non-blocking concerns, score **8.8/10**.
- `npm run test -- hacienda-v44-xml-serializer.adapter fiscal-identification.mapper --silent` — PASS, 2 suites / 10 tests.
- `npm run typecheck` — PASS.
- `npm run lint:check` — PASS.
- `npm run build` — PASS.
- Targeted E2E fiscal-documents + fiscal-xml-signing — PASS, 2 suites / 11 tests.

---

## [f2-3-post-task-011-architecture-refresh] — 2026-09-13

**Agent:** hdd-architecture-agent-d7922b
**Canonical spec:** `specs/fase-2-3-fiscal-xml-signing/`
**Scope:** Final architecture-facing documentation refresh for confirmed F2.3 only after TASK-011 and post-remediation baseline audit. No production code, tests, Prisma schema or migrations changed by this agent.

### Documentation
- Refreshed root architecture-facing docs to reflect actual final post-TASK-011 state: automated gates pass and F2.3 is accepted for the confirmed local prepare/sign/verify/XSD scope.
- Recorded final baseline audit evidence: score **8.9/10**, verdict **Acceptable**, prior AUD-001 closed for confirmed F2.3 acceptance scope and no longer blocking.
- Updated AUD-001 language from stale “partially remediated/blocked” wording to closure-for-scope, while preserving non-blocking notes: production verifier weaker than the stricter test standards verifier and XMLDSig/XAdES still manually assembled.
- Preserved traceability to TASK-011 improvements: PKCS#12/PFX base64 via `SecretProviderPort`, raw PFX to `XmlSignerPort`, node-forge PFX parsing, structurally real X.509 fixtures, DER `ds:X509Certificate`, `xml-crypto` canonicalization and independent `xml-crypto` `SignedXml` verifier tests with Hacienda XPath transform.
- Kept Hacienda submission/F3 explicitly out of scope.

### Validation
- No commands were executed by this documentation-only architecture refresh. It records supplied evidence: Prisma generate/validate/migrate deploy with `DATABASE_URL`, lint:check, typecheck, unit 217/217, build, full E2E 60/60 and Docker build `billing:f23-task011-xmlcrypto-validation` passed.

---

## [f2-3-final-audit-architecture-refresh] — 2026-09-13

**Agent:** hdd-architecture-agent-e61dc0
**Canonical spec:** `specs/fase-2-3-fiscal-xml-signing/`
**Scope:** Historical architecture-facing documentation refresh after an earlier F2.3 baseline audit. Superseded for current F2.3 status by `[f2-3-post-task-011-architecture-refresh]` above. No production code, tests, Prisma schema or migrations changed by this agent.

### Documentation
- Refreshed root `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`, `docs/tasks.md` and `docs/future-architecture.md` to reflect the then-audited historical state. This was later superseded by final TASK-011 acceptance.
- Explicitly separated implemented current state from target/future remediation.
- Recorded then-current baseline audit evidence: score **7.4/10**, verdict **Needs Refactoring**, no Critical findings, High blocker **AUD-001**. Superseded by final post-TASK-011 audit score **8.9/10 Acceptable** with AUD-001 closed for confirmed F2.3 scope.
- Added proposed remediation path for production-grade PKCS#12/PFX + real X.509/XAdES interoperability evidence behind `XmlSignerPort`.
- Added proposed follow-up tasks for AUD-001 through AUD-004, AUD-006 and AUD-008. Existing npm audit vulnerability remediation remains tracked as TASK-035.

### Validation
- No commands were executed by this documentation-only architecture refresh. It records then-supplied pre-TASK-011 evidence. Current post-TASK-011 evidence is recorded in the newer changelog entry above.

---

## [f2-3-documentation-ownership-reconciliation] — 2026-09-12

**Agent:** sdd-implementation-agent-4a564c
**Canonical spec:** `specs/fase-2-3-fiscal-xml-signing`
**Scope:** Documentation/spec ownership reconciliation only. No production code, tests, Prisma schema, migrations, packages, Docker or CI files changed.

### Documentation
- Updated global current-state/architecture/future-architecture status from F2.3 not started to F2.3 in progress/blocked.
- Recorded that partial F2.3 XML/persistence/signing/orchestration code exists but is not production-complete.
- Recorded that official Hacienda v4.4 XSD validation is blocked until an XSD 1.1-capable validator replaces the rejected libxml2/libxmljs2 strategy.
- Cleaned misfiled F2.3 entries under `specs/fase-1-hacienda-consultas/` into historical cross-references.

### Validation
- No validation commands were executed; this was documentation-only reconciliation.

---

## [post-f2-2-remediation-final-architecture-refresh] — 2026-09-12

**Agent:** hdd-architecture-agent-7fd8b9
**Canonical spec:** `specs/post-f2-2-remediation`
**Scope:** Final architecture-facing documentation refresh after confirmed Post-F2.2 remediation completion and canonical ownership reconciliation. No production code, tests or Prisma migrations changed.

### Documentation
- Historical note: at the time of this Post-F2.2 refresh, root architecture/current-state/action-plan/tasks/audit docs were reviewed for completed Foundation, Fase 1, F2.1, F2.2 at `READY_FOR_XML`, completed canonical Post-F2.2 remediation and then-current F2.3 status.
- Updated `docs/future-architecture.md` header to reference the canonical Post-F2.2 spec and final refresh instead of the older F2.2 hardening refresh label.
- Corrected one historical Fase 1 implementation-report deviation note so it cannot be read as assigning canonical Post-F2.2 ownership to `specs/fase-1-hacienda-consultas/`.

### Validation
- No validation commands were executed by this documentation-only architecture refresh. It relies on supplied evidence: `npm ci`, Prisma generate/validate, clean `billing_e2e` reset plus migrate deploy, lint/lint:check, typecheck, 181 unit tests / 28 suites, build, 57 E2E tests / 11 suites, fiscal E2E 15 tests / 3 suites and PostgreSQL concurrency all passed. Existing npm audit vulnerabilities remain.

---

## [post-f2-2-remediation-documentation-reconciliation] — 2026-09-12

**Agent:** sdd-implementation-agent-c13b28
**Canonical spec:** `specs/post-f2-2-remediation`
**Historical misclassified spec:** `specs/fase-1-hacienda-consultas`
**Scope:** Documentation-only ownership reconciliation for completed Post-F2.2 fiscal-document remediation. No production code, tests or Prisma migrations changed.

### Documentation
- Updated root architecture-facing docs to reflect canonical Post-F2.2 ownership, completed fiscal E2E workflow coverage, management endpoint coverage, negative paths, tenant/type isolation, response sanitization and PostgreSQL concurrency/idempotency coverage.
- Documented that `FiscalDocumentService` now reserves idempotency records before fiscal sequence allocation using PostgreSQL `INSERT ... ON CONFLICT DO NOTHING RETURNING` to avoid sequence consumption and transaction-abort behavior during concurrent idempotency races.
- Documented that fiscal responses serialize top-level bigint fields as strings and remove `securityCode` and `requestHash`.
- Marked prior fiscal E2E/full-E2E blocker risks as closed for this continuation scope while retaining future maintainability debt around the large fiscal service and explicit response DTOs.
- Recorded baseline-audit-agent score **9.0/10** for canonical `specs/post-f2-2-remediation`: no meaningful regression introduced and no blocking F2.2-specific gaps.

### Validation
- No validation commands were executed by this documentation-only reconciliation. It preserves supplied evidence: `npm ci`, Prisma generate/validate, clean `billing_e2e` reset plus migrate deploy, lint, lint:check, typecheck, 181 unit tests / 28 suites, build, 57 E2E tests / 11 suites and fiscal E2E 15 tests / 3 suites all passed. `npm audit` still reports 26 pre-existing vulnerabilities.

---

## [fase-1-closure-architecture-refresh] — 2026-09-11

**Agent:** hdd-architecture-agent-ef03fb
**Spec:** `specs/fase-1-hacienda-consultas`
**Scope:** Documentation-only closure refresh after Fase 1 baseline audit. No production code changed.

### Documentation
- Updated architecture-facing docs to record Fase 1 closure: audit score **8.6/10**, Fase 1 completion confidence **9.1/10**, verdict **Acceptable**, and no Critical/High Fase 1 regressions.
- Clarified that remaining High risks are repository-level follow-up work: Docker Compose production-mode fallback/default secrets if reused as production and existing npm audit vulnerabilities.
- Refreshed Fase 1 spec documents to align current-state and traceability with post-audit fixes: CABYS null-cache handling and USD-only exchange-rate contract.
- Corrected Fase 1 current-state notes where later hardening superseded original behavior, including production CORS fatal validation and latest full validation evidence.

### Validation
- No validation commands were executed by this architecture refresh. It records supplied evidence: `npm ci`, Prisma generate, lint, typecheck, 177 unit tests / 26 suites, build, and 42 E2E tests / 8 suites all passed; `npm ci` still reports 26 existing audit vulnerabilities.

---

## [pre-f2-2-security-fix-final-architecture-refresh] — 2026-09-11

**Agent:** hdd-architecture-agent-9bdbe6
**Spec:** `specs/pre-f2-2-security-fix`
**Scope:** Documentation-only architecture refresh after final verification by `sdd-implementation-agent-c13b28`. No production code changed.

### Documentation
- Refreshed architecture-facing docs to reference the latest implemented state: tenant ownership for `GET /api/v1/tenants/:id`, Helmet in API bootstrap, computed login/refresh `expiresIn`, and Joi auth-duration grammar validation.
- Updated audit score references from 8.4/10 to **8.6/10 Acceptable** where current docs summarize the post-continuation baseline.
- Added the remaining existing npm audit vulnerabilities as an explicit High dependency-security risk and proposed TASK-023 for triage/remediation.
- Documented the final auth-duration behavior: invalid primary and invalid custom fallback durations produce the safe 900-second access-token default.

### Validation
- No validation commands were executed by this architecture refresh. It records implementation-continuation evidence: `npm ci`, Prisma generate, lint, typecheck, 177 unit tests / 26 suites, build, and 42 E2E tests / 8 suites all passed; `npm ci` still reports 26 existing audit vulnerabilities.

---

## [fase-1-baseline-audit-architecture-refresh] — 2026-09-11

**Agent:** hdd-architecture-agent-762038
**Spec:** `specs/fase-1-hacienda-consultas`
**Scope:** Documentation-only architecture refresh after latest baseline audit. No production code changed.

### Documentation
- Refreshed architecture-facing docs to reference the latest `docs/audit/current-code-audit.md` baseline: score **8.4/10**, verdict **Acceptable**, no Critical findings, one High finding (AUD-001).
- Documented AUD-001 Docker Compose production-mode fallback/default secret risk in current state, active architecture limitations, action plan and tasks.
- Added proposed remediation tasks for audit findings AUD-001 through AUD-005, including Compose hardening, DB referential integrity evaluation, framework exception decoupling, coding-standards path drift and identification normalization clarification.

### Validation
- No tests were executed during this documentation refresh. Current green status remains based on the prior implementation-agent validation reported in `docs/current-state.md`.

---

## [pre-f2-2-security-fix] — 2026-09-11

**Agent:** sdd-implementation-agent-4f02c8
**Spec:** `specs/pre-f2-2-security-fix`

### Added
- `helmet@8.3.0` runtime dependency and HTTP security-header E2E coverage.
- Unit tests for auth TTL parsing and non-default `expiresIn` behavior.
- E2E coverage for same-tenant/cross-tenant `GET /api/v1/tenants/:id`.

### Changed
- `GET /api/v1/tenants/:id` now enforces same-tenant ownership in `GetTenantHandler`; cross-tenant reads return 404 `TENANT_NOT_FOUND`.
- `api.main.ts` applies Helmet after CORS; production keeps CSP defaults, non-production disables only CSP for Swagger compatibility.
- Login and refresh responses compute `expiresIn` from configured `JWT_EXPIRES_IN` instead of hardcoded `15 * 60`.
- `JWT_EXPIRES_IN` and `JWT_REFRESH_EXPIRES_IN` Joi validation now uses the same `^\\d+[smhd]$` grammar supported by the auth-duration parser.
- Architecture/current-state/action-plan/tasks documentation refreshed to mark AUD-API01, AUD-SEC01 and DEFECT-001 as closed.

### Validation
- `npm ci`, `npx prisma generate`, `npm run lint:check`, `npm run typecheck`, `npm test -- --silent` (26 suites / 177 tests), `npm run build` all passed in the latest continuation verification.
- Post-audit REG-AUD-001 mitigation tests passed: `config.validation.spec.ts auth-token-duration.spec.ts login.handler.spec.ts refresh-token.handler.spec.ts` (4 suites / 35 tests in latest continuation verification).
- Test DB reset + full E2E passed: 8 suites / 42 tests.

## [phase-9-audit-architecture-refresh] — 2026-11-09

**Agent:** sdd-implementation-agent-c13b28
**Spec:** `specs/fase-1-hacienda-consultas` (post-pre-fase-2-hardening cumulative baseline)

### Documentation
- Post-implementation baseline audit ejecutado via `baseline-audit-agent`; score inicial 8.2/10 **corregido a 8.8/10** (CI/CD y Documentation tenían scores erróneos por bug de tool; ver `docs/audit/current-code-audit.md`).
- `docs/audit/current-code-audit.md` created with 7 open findings (AUD-D02, AUD-API01, AUD-SEC01, AUD-API04, AUD-DB01, AUD-SEC02, DEFECT-001) — all requiring separately approved specs.
- Architecture documentation refreshed via `hdd-architecture-agent`:
  - `docs/current-state.md` — updated to 163 tests / 8.2/10 / all 5 phases documented.
  - `docs/architecture.md` — active decisions + 8 known limitations + open clarifications.
  - `docs/action-plan.md` — stages 0-1 complete; stages 2-5 proposed.
  - `docs/tasks.md` — TASK-008 completed; TASK-009 through TASK-017 added as Proposed.
  - `docs/future-architecture.md` — fase-2-2-fiscal-document-core as next milestone.
- `specs/fase-1-hacienda-consultas/implementation-report.md` — Section 19 added recording Phase 9 results.

### Validation (current baseline)
- Tests: **163 passed / 0 failed** (24 suites)
- TypeScript: 0 errors
- Lint: 0 errors
- Build: clean

---

## [pre-fase-2-hardening] — 2026-10-09

**Agent:** sdd-implementation-agent-c13b28
**Spec:** `specs/pre-fase-2-hardening/`

### Security
- **SEC-001 FIXED:** CORS wildcard (`*`) is now a fatal startup error in `production` and `staging` environments, enforced by the Joi validation schema. Previously was warn-only at runtime.
- **R-13 PARTIAL:** Removed signed fiscal XML from git index (`git rm --cached`); added `SIGNED_*.xml` to `.gitignore`; moved file to `test/fixtures/`. **Git history purge still required** (manual `git filter-repo`).

### Features / Improvements
- **DEF-001 FIXED:** `.env.local.example` now documents all 31+ environment variables with inline comments, organized by section.
- **DEF-002 FIXED:** `docker-compose.yml` billing-api service now includes `CORS_ALLOWED_ORIGINS` with shell-variable substitution defaulting to `http://localhost:3000`.
- **SEC-006 FIXED:** `HaciendaCircuitBreaker` now accepts `ConfigService` injection (`@Optional()`); all 7 resilience parameters (failure threshold, reset timeout, outbound rate, 429/5xx retry counts and delays) are fully configurable via environment variables with production-safe defaults.
- **CI-001 FIXED:** Explicit `npx prisma generate` step added to `lint` and `typecheck` CI jobs.
- Added `USE_REAL_HACIENDA=false` to CI E2E job environment.

### Architecture
- Extracted Joi validation schema to `src/infrastructure/config/config.validation-schema.ts` — standalone module testable without NestJS bootstrap.
- `config.module.ts` imports and re-exports `validationSchema` for backward compatibility.
- `api.main.ts` now uses `ConfigService` exclusively; no direct `process.env` reads remain in bootstrap code.
- `LocalStorageAdapter` constructor no longer reads `process.env`; values passed via `StorageModule` → `ConfigService`.
- `StorageConfig` and `HaciendaConfig` interfaces extended with typed sub-objects.

### Tests
- **+10 unit tests:** `src/infrastructure/config/__tests__/config.validation.spec.ts` — covers CORS production guard, JWT entropy rule, CB defaults, outbound rate cap.
- **+6 unit tests:** `src/infrastructure/integrations/hacienda/__tests__/hacienda-circuit-breaker.spec.ts` updated — `makeBreaker()` helper; configurable threshold (AC-005), reset timeout (AC-006), rate limiter (AC-007), retry exhaustion.
- Total tests: **141** (was 126).

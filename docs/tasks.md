# Tasks

> **Synchronized:** Final architecture documentation refresh for confirmed `specs/fase-2-3-fiscal-xml-signing/` by `hdd-architecture-agent-d7922b` on 2026-09-13 after TASK-011 and post-remediation audit. Documentation-only; no production code, tests, Prisma schema or migrations modified by this agent.
> F2.3 final implementation evidence passed after TASK-011: Prisma generate/validate/migrate deploy with `DATABASE_URL`, lint:check, typecheck, unit 217/217, build, full E2E 60/60 and Docker runner build `billing:f23-task011-xmlcrypto-validation`. Final baseline audit scored **8.9/10**, verdict **Acceptable**. Prior AUD-001 is closed for the confirmed F2.3 acceptance scope and no longer blocking. Remaining hardening tasks below remain **Proposed** until explicitly approved.

---

## TASK-024: Refresh architecture documentation after F2.2 implementation
**Status:** Completed
**Priority:** Medium
**Domain:** Architecture Documentation
**Requirement:** Phase 7 documentation refresh after implementation of `fase-2-2-fiscal-document-core`.
**Reason:** Root architecture-facing docs were stale and still described F2.2 as future work.
**Current problem:** Resolved by this documentation-only refresh.
**Proposed change:** Completed update of current state, active architecture, action plan and tasks to reflect actual F2.2 state.
**Affected files:** `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`, `docs/tasks.md`
**Dependencies:** F2.2 implementation report and post-implementation audit.
**Database impact:** None.
**API impact:** None.
**Container impact:** None.
**Security impact:** Documents that prior fiscal `securityCode`/`requestHash` response exposure has been corrected and records remaining follow-up tasks.
**Acceptance criteria:** Docs distinguish implemented F2.2 behavior from proposed future work; no production code modified.
**Required tests:** Documentation review only. No commands executed by this refresh.
**Migration considerations:** None.
**Rollback or mitigation:** Revert documentation files if inaccurate.
**Risk:** Low.

---

## TASK-036: Document F2.2 hardening corrections
**Status:** Completed
**Priority:** Medium
**Domain:** Architecture Documentation / Fiscal Documents
**Requirement:** Refresh docs after hardening corrections for `fase-2-2-fiscal-document-core`.
**Reason:** Corrected issues should not remain listed as open High risks.
**Current problem:** Resolved by this documentation-only refresh.
**Proposed change:** Completed documentation update reflecting response sanitization and idempotency scope hardening.
**Affected files:** `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`, `docs/tasks.md`, `docs/future-architecture.md`.
**Dependencies:** User-provided validation and final audit evidence.
**Database impact:** Documentation records new migration `prisma/migrations/20260911143000_fiscal_idempotency_scope/migration.sql`.
**API impact:** Documentation records that fiscal document responses remove `securityCode` and `requestHash`.
**Container impact:** None.
**Security impact:** Removes corrected response exposure from open High risks. Later Post-F2.2 continuation tests now also cover fiscal E2E/API security scenarios; remaining risk is explicit DTO/formal contract debt.
**Acceptance criteria:** Corrected response exposure and idempotency-scope issues are marked closed/completed; remaining risks still documented.
**Required tests:** Documentation review only. This agent did not execute validation commands.
**Migration considerations:** None for docs.
**Rollback or mitigation:** Revert documentation files if inaccurate.
**Risk:** Low.

---

## TASK-042: Refresh architecture docs after Post-F2.2 remediation documentation reconciliation
**Status:** Completed
**Priority:** Medium
**Domain:** Architecture Documentation / Fiscal Documents
**Requirement:** Documentation ownership reconciliation after completed Post-F2.2 remediation tasks under canonical `specs/post-f2-2-remediation`.
**Reason:** Root architecture-facing docs needed to reflect the confirmed implementation state, validation evidence and audit score for the fiscal continuation cycle.
**Current problem:** Resolved by this documentation-only refresh.
**Proposed change:** Updated current-state, active architecture, action plan, tasks, changelog and audit addendum to record canonical Post-F2.2 ownership, fiscal E2E/concurrency coverage, response sanitization, bigint serialization, pre-sequence idempotency reservation, final schema constraints and clean full-E2E validation.
**Affected files:** `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`, `docs/tasks.md`, `docs/changelog.md`, `docs/audit/current-code-audit.md`.
**Dependencies:** User-provided implementation summary, validation evidence and baseline audit result.
**Database impact:** Documentation only; records clean `billing_e2e` reset and migration deploy evidence.
**API impact:** Documentation only; records sanitized fiscal response behavior.
**Container impact:** None.
**Security impact:** Documentation records closure of fiscal response exposure and fiscal E2E security-evidence gaps for this scope; npm audit vulnerabilities remain open repository-level risk.
**Acceptance criteria:** Architecture-facing docs distinguish actual completed Post-F2.2 behavior from remaining proposed Fase 1/future architecture work; no production code modified.
**Required tests:** Documentation review only. This architecture agent did not execute validation commands.
**Migration considerations:** None for docs.
**Rollback or mitigation:** Revert documentation changes if inaccurate.
**Risk:** Low.

---

## TASK-043: Final architecture documentation refresh for canonical Post-F2.2 remediation
**Status:** Completed
**Priority:** Low
**Domain:** Architecture Documentation / Fiscal Documents
**Requirement:** Final-only architecture refresh for canonical `specs/post-f2-2-remediation` after Post-F2.2 remediation completion and ownership reconciliation.
**Reason:** Ensure architecture-facing docs cannot be misread as assigning Post-F2.2 ownership to historical Fase 1 records and confirm future-state documentation references the canonical spec.
**Current problem:** Mostly resolved before this refresh; one future-architecture header still referenced the older F2.2 hardening refresh label and one historical Fase 1 implementation-report note could be read ambiguously.
**Proposed change:** Completed documentation-only update to align final architecture-facing records with canonical Post-F2.2 ownership.
**Affected files:** `docs/future-architecture.md`, `docs/changelog.md`, `specs/fase-1-hacienda-consultas/implementation-report.md`, `docs/tasks.md`.
**Dependencies:** Canonical Post-F2.2 reconciliation and supplied validation/audit evidence.
**Database impact:** None.
**API impact:** None.
**Container impact:** None.
**Security impact:** None directly; preserves documentation of existing npm audit vulnerabilities as repository-level risk.
**Acceptance criteria:** Future-state and historical Fase 1 docs consistently point to `specs/post-f2-2-remediation/` as canonical owner; no production code modified.
**Required tests:** Documentation review only. This architecture refresh did not execute validation commands.
**Migration considerations:** None.
**Rollback or mitigation:** Revert documentation changes if inaccurate.
**Risk:** Low.

---

## TASK-025: Add fiscal E2E/API characterization tests
**Status:** Completed
**Priority:** High
**Domain:** Fiscal Documents / API / Security
**Requirement:** F2.2 FR-021, FR-022, FR-023, FR-024, FR-025, FR-029; Post-F2.2 continuation tasks TASK-F2.2-003 through TASK-F2.2-007.
**Reason:** Fiscal endpoint-level evidence was needed for creation, retrieval, authorization, idempotency, management boundaries and clean full-E2E execution.
**Current problem:** Resolved for the completed Post-F2.2 continuation scope.
**Proposed change:** Implemented fiscal E2E coverage for invoice/ticket workflows, retrieval, idempotency replay/conflict, negative authorization paths, type-specific scopes, tenant isolation, management endpoint boundaries and PostgreSQL-backed concurrency races.
**Affected files:** `test/helpers/fiscal-e2e-helpers.ts`, `test/e2e/fase2/fiscal-documents.e2e-spec.ts`, `test/e2e/fase2/fiscal-management.e2e-spec.ts`, `test/e2e/fase2/fiscal-concurrency.e2e-spec.ts`, `src/modules/fiscal-documents/application/fiscal-document.service.ts`.
**Dependencies:** Clean `billing_e2e` reset and applied migrations.
**Database impact:** Test data only; no schema change in this continuation cycle. Service behavior now reserves idempotency before sequence allocation using PostgreSQL conflict-safe insert semantics.
**API impact:** Fiscal responses are verified to omit `securityCode` and `requestHash`; top-level bigint fields serialize as strings.
**Container impact:** None.
**Security impact:** High positive impact by proving fiscal authorization boundaries and response sanitization.
**Acceptance criteria:** Fiscal E2E suite covers happy/negative paths and passes on a clean database; full E2E suite no longer blocked by duplicate tenant slug.
**Required tests:** Reported PASS: `npm run test:e2e -- --silent` (57 tests / 11 suites), `npm test -- --silent` (181 tests / 28 suites), plus lint, typecheck, build and Prisma gates.
**Migration considerations:** Clean reset plus `npx prisma migrate deploy` reported PASS with 6 migrations applied.
**Rollback or mitigation:** Revert continuation test/service changes if inaccurate; preserve current conflict-safe idempotency reservation behavior because it prevents sequence gaps on idempotency races.
**Risk:** Low after validation; residual architectural risk is service size/maintainability.

---

## TASK-037: Verify and enforce auth endpoint rate limiting for Fase 1
**Status:** Proposed
**Priority:** High
**Domain:** Identity/Auth / Security
**Requirement:** Fase 1 layered rate limiting; authentication brute-force protection for `/auth/login` and `/auth/refresh`.
**Reason:** Phase-specific audit found `@Throttle` decorators on `AuthController`, but no visible global `ThrottlerGuard`/`APP_GUARD` application in inspected code.
**Current problem:** Auth endpoint rate limiting may not be enforced at runtime despite declared `@Throttle({ auth: { ttl: 60000, limit: 10 } })` metadata.
**Proposed change:** First add a focused failing/passing characterization test for login/refresh throttling. If enforcement is inactive, apply the smallest approved NestJS throttler guard registration or auth-specific guard strategy and keep the public auth contract unchanged.
**Affected files:** `src/app.module.ts`, `src/modules/identity/infrastructure/http/auth.controller.ts`, auth E2E tests under `test/e2e/**`, possibly test setup helpers.
**Dependencies:** Approval to modify production code after characterization; clean/isolated E2E database recommended.
**Database impact:** Test data only.
**API impact:** Runtime behavior should return `429 TOO_MANY_REQUESTS` after the configured auth threshold; request/response success contracts remain unchanged.
**Container impact:** None.
**Security impact:** High positive impact; closes brute-force protection gap.
**Acceptance criteria:** Login and refresh exceed-threshold tests prove 429 behavior; normal requests below threshold still work; global throttling does not unintentionally throttle skipped/non-auth endpoints.
**Required tests:** Focused auth throttling E2E; `npm run lint:check`; `npm run typecheck`; unit suite; build; relevant E2E suite.
**Migration considerations:** None.
**Rollback or mitigation:** Revert guard registration if it causes broad endpoint regressions; keep tests documenting expected behavior before retrying with a narrower guard.
**Risk:** Medium implementation risk; High security risk if left unresolved.

---

## TASK-038: Prove API-key per-key throttling and named-throttler semantics
**Status:** Proposed
**Priority:** Medium
**Domain:** API Keys / Hacienda Public Queries / Security
**Requirement:** Fase 1 inbound per-API-key rate limiting for Hacienda query endpoints.
**Reason:** `ApiKeyThrottlerGuard` is applied to Fase 1 controllers and tracks by API-key id, but phase audit flagged ambiguity around the named throttler bucket and actual threshold behavior.
**Current problem:** The intended `api` throttler configuration may not be the bucket actually enforced by the inherited `ThrottlerGuard`; no threshold E2E currently proves configured behavior.
**Proposed change:** Add endpoint-level tests with low test-only throttle limits to prove same-key 429 behavior and different-key independent buckets. If tests reveal incorrect bucket selection, make the guard's named-throttler behavior explicit in the smallest approved change.
**Affected files:** `src/api/guards/api-key-throttler.guard.ts`, Fase 1 E2E tests, test configuration/helpers.
**Dependencies:** Clean/isolated E2E database; TASK-037 may affect global throttling interactions.
**Database impact:** Test API keys only.
**API impact:** Runtime behavior should return 429 after configured per-key threshold; no successful response contract changes.
**Container impact:** None.
**Security impact:** Medium positive impact by limiting abusive API-key traffic and protecting Hacienda outbound capacity.
**Acceptance criteria:** Tests prove configured per-key threshold, independent API-key buckets and IP fallback behavior if no key reaches throttler after auth failures where applicable.
**Required tests:** Fase 1 throttling E2E; unit tests for tracker behavior if practical; lint/typecheck/unit/build gates.
**Migration considerations:** None.
**Rollback or mitigation:** Revert guard changes if threshold behavior regresses; retain characterization tests to guide a narrower fix.
**Risk:** Medium.

---

## TASK-044: Record closure of F2.3 AUD-001 after TASK-011 xml-crypto validation
**Status:** Completed
**Priority:** High
**Domain:** Fiscal XML and Signing / Architecture Documentation
**Requirement:** F2.3 FR-016, FR-017, FR-018, NFR-005, NFR-006, AC-007, AC-008, AC-017; final audit closure of prior AUD-001.
**Reason:** Final audit now accepts the confirmed F2.3 scope and prior AUD-001 is no longer blocking.
**Current problem:** Resolved for confirmed F2.3 scope. Remaining non-blocking notes are production verifier weaker than the stricter test standards verifier and XMLDSig/XAdES still manually assembled.
**Proposed change:** Completed documentation refresh recording that TASK-011 canonicalizes document digest, `SignedProperties` digest and `SignedInfo` signature input using `xml-crypto`; tests include `xml-crypto` `SignedXml` independent verifier with Hacienda XPath transform; valid FE/TE pass signer verify, xml-crypto verify and XSD; tamper fails.
**Affected files:** `docs/current-state.md`, `docs/architecture.md`, `docs/action-plan.md`, `docs/tasks.md`, `specs/fase-2-3-fiscal-xml-signing/*` documentation.
**Dependencies:** User-provided final audit result 8.9/10 Acceptable and validation evidence from `sdd-implementation-agent-4a564c`.
**Database impact:** None; documentation records existing migration `20260912180000_fiscal_xml_signing_metadata`.
**API impact:** None; `/api/v1/fiscal-documents/:id/prepare-xml` remains local prepare/sign/verify/XSD only.
**Container impact:** Documentation records Docker build `billing:f23-task011-xmlcrypto-validation` passed.
**Security impact:** Positive; prevents stale blocked status and records remaining non-blocking verifier/manual-assembly risks without overstating Hacienda acceptance.
**Acceptance criteria:** Docs state F2.3 accepted for confirmed local scope, AUD-001 closed for scope, no F3 submission, and remaining hardening tasks remain Proposed.
**Required tests:** Documentation review only by this agent. Validation commands were not executed by this documentation refresh.
**Migration considerations:** None.
**Rollback or mitigation:** Revert documentation if final audit/evidence is contradicted.
**Risk:** Low.

---

## TASK-045: Add concurrency guard for simultaneous F2.3 prepare requests
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal Documents / Fiscal XML
**Requirement:** F2.3 FR-022, FR-023, BR-003; final audit AUD-002.
**Reason:** Retry after `READY_TO_SUBMIT` is covered, but simultaneous duplicate `prepare-xml` requests may race.
**Current problem:** Current prepare orchestration does not have explicit documented row/advisory locking or concurrent duplicate E2E evidence.
**Proposed change:** Add a per-document concurrency guard using transaction row locking, advisory lock, status transition compare-and-set, or repository-level lock. Add E2E proving simultaneous duplicate requests do not create conflicting artifacts or mutate signed XML.
**Affected files:** `src/modules/fiscal-documents/application/fiscal-xml/prepare-fiscal-xml.service.ts`, fiscal XML persistence code/tests, E2E tests.
**Dependencies:** Prefer after TASK-044 or in parallel only if signer behavior is not touched.
**Database impact:** Possibly none if row locks are enough; possible forward-only migration if lock metadata is needed.
**API impact:** May introduce deterministic 409/423/202-style behavior for in-progress duplicate prepare attempts; compatibility impact must be documented before implementation.
**Container impact:** None expected.
**Security impact:** Medium positive impact through integrity and DoS/race reduction.
**Acceptance criteria:** Concurrent prepare calls for the same document are safe; at most one signed artifact is persisted; retries after readiness return existing metadata; failure remains recoverable.
**Required tests:** PostgreSQL concurrency E2E, unit/application tests for lock behavior, full relevant gates.
**Migration considerations:** Use forward-only migration only if required; never edit existing migrations.
**Rollback or mitigation:** Remove new lock path if deadlocks/regressions occur; keep artifact uniqueness as backstop.
**Risk:** Medium.

---

## TASK-046: Add prepare-xml rate limiting or quota policy
**Status:** Proposed
**Priority:** Medium
**Domain:** API Keys / Fiscal XML / Security
**Requirement:** F2.3 NFR-008 and final audit AUD-003.
**Reason:** XML signing and XSD validation are CPU/IO expensive.
**Current problem:** `FiscalXmlController` currently has `@SkipThrottle()`, so the expensive `prepare-xml` endpoint bypasses throttling.
**Proposed change:** Define and enforce a prepare-specific API-key/tenant/company throttle or quota policy, preserving normal successful response contracts and documenting 429 behavior.
**Affected files:** `src/modules/fiscal-documents/infrastructure/http/fiscal-xml.controller.ts`, throttling guards/config, E2E tests, docs.
**Dependencies:** Decision on quota/threshold values and interaction with existing API-key throttler.
**Database impact:** None expected unless quota persistence is introduced.
**API impact:** Adds 429 behavior after threshold; no success contract change.
**Container impact:** None.
**Security impact:** Medium positive impact by reducing endpoint abuse risk.
**Acceptance criteria:** Same API key is throttled after configured prepare threshold; independent keys do not share a bucket unless tenant quota says so; normal requests below threshold work.
**Required tests:** Prepare endpoint throttling E2E, relevant unit tests, lint/typecheck/build/E2E.
**Migration considerations:** None expected.
**Rollback or mitigation:** Revert guard binding/threshold if legitimate traffic is blocked; document temporary operational controls.
**Risk:** Medium.

---

## TASK-047: Harden F2.3 DB tenant/company consistency constraints
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal Documents / Database Integrity
**Requirement:** F2.3 FR-014, FR-015, FR-019; final audit AUD-004.
**Reason:** Application-level checks exist, but DB-level constraints can better prevent cross-tenant/company drift in certificate/artifact metadata.
**Current problem:** F2.3 artifact/certificate relations can be further constrained for tenant/company consistency.
**Proposed change:** Evaluate and add forward-only PostgreSQL constraints/indexes/compound FKs where feasible, or document why application-level invariants are the active choice.
**Affected files:** `prisma/schema.prisma`, new Prisma migration, persistence tests, docs.
**Dependencies:** Database design decision; no edits to applied migrations.
**Database impact:** Yes if implemented; may add compound unique constraints or FKs.
**API impact:** None intended; constraint violations should map to deterministic internal errors if reachable.
**Container impact:** None.
**Security impact:** Medium positive impact through stronger tenant isolation integrity.
**Acceptance criteria:** Constraint strategy documented; migration deploys from zero; tests prove cross-tenant/company invalid references cannot be persisted.
**Required tests:** Prisma validate/generate/migrate deploy, persistence integration/E2E tests.
**Migration considerations:** Check existing data before adding constraints; use forward-only migration.
**Rollback or mitigation:** Use compensating migration if constraints cause unexpected deployment issue.
**Risk:** Medium.

---

## TASK-048: Clarify and test F2.3 certificate rotation policy
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal XML and Signing / Certificate Lifecycle
**Requirement:** F2.3 FR-024, BR-003, BR-004; final audit AUD-006.
**Reason:** Rotation behavior affects future signing attempts and immutable already signed artifacts.
**Current problem:** Existing retry no-mutation evidence is not a complete operational rotation policy.
**Proposed change:** Document and implement tests for active/replaced/disabled certificate behavior, future signing with replacement certificate, and no silent mutation of existing `READY_TO_SUBMIT` artifacts. Explicit re-signing remains out of scope unless separately approved.
**Affected files:** `src/modules/fiscal-documents/application/fiscal-xml/fiscal-signing-certificate.service.ts`, `prepare-fiscal-xml.service.ts`, tests, canonical F2.3 docs.
**Dependencies:** Product decision on replacement selection and whether explicit re-signing is allowed later.
**Database impact:** Likely none; existing `replacedById` may be sufficient.
**API impact:** None unless management endpoints are introduced; management endpoints are not required for this task.
**Container impact:** None.
**Security impact:** Medium positive impact by preventing wrong/stale certificate use.
**Acceptance criteria:** Future READY_FOR_XML documents use the active replacement certificate; existing READY_TO_SUBMIT docs retain original certificate metadata on retry; disabled/expired/replaced cert selection is deterministic.
**Required tests:** Unit/application tests and E2E if practical.
**Migration considerations:** None expected.
**Rollback or mitigation:** Keep existing active-certificate behavior until policy tests pass.
**Risk:** Medium.

---

## TASK-049: Add UUID validation for fiscal path parameters
**Status:** Proposed
**Priority:** Medium
**Domain:** API / Security / Fiscal Documents
**Requirement:** Secure input validation; final audit AUD-008.
**Reason:** Path params such as fiscal document id should be validated before service use.
**Current problem:** Missing UUID validation pipe can cause noisy errors and weaker input boundary hygiene.
**Proposed change:** Add `ParseUUIDPipe` or a repository-wide equivalent for fiscal path params, including `/fiscal-documents/:id` and `/fiscal-documents/:id/prepare-xml`.
**Affected files:** Fiscal controllers, possibly shared validation utilities, API tests.
**Dependencies:** Decide global vs per-controller validation style.
**Database impact:** None.
**API impact:** Invalid IDs should return deterministic validation errors; valid UUID behavior unchanged.
**Container impact:** None.
**Security impact:** Medium positive impact through stricter input validation.
**Acceptance criteria:** Invalid UUID path params fail before service/database access; valid IDs continue to work; error format is documented/consistent.
**Required tests:** Controller/E2E tests for invalid and valid UUIDs; lint/typecheck/unit/E2E.
**Migration considerations:** None.
**Rollback or mitigation:** Revert per-route pipes if error contract incompatibility is unacceptable and replace with compatible validation filter.
**Risk:** Low/Medium.

---

## TASK-039: Add positive Fase 1 Hacienda endpoint E2E coverage
**Status:** Proposed
**Priority:** Medium
**Domain:** Hacienda Public Queries / API Contracts
**Requirement:** Fase 1 taxpayer, CABYS and exchange-rate endpoints must expose stable normalized Billing-owned contracts.
**Reason:** Existing Fase 1 E2E files cover route registration, invalid input and missing/invalid API-key behavior, but positive endpoint response evidence is incomplete.
**Current problem:** Audit evidence gaps remain for successful taxpayer lookup, CABYS direct lookup/search and exchange-rate response shapes.
**Proposed change:** Add mock-adapter-backed positive E2E tests for `GET /api/v1/taxpayers/:identification`, `GET /api/v1/cabys/:code`, `GET /api/v1/cabys?search=...` and `GET /api/v1/exchange-rates`, including scope success and normalized field assertions.
**Affected files:** `test/e2e/fase1/hacienda-endpoints.e2e-spec.ts`, fixtures/helpers if needed.
**Dependencies:** Clean/isolated E2E database; stable mock Hacienda adapter fixtures.
**Database impact:** Test tenant/company/API-key records only.
**API impact:** None intended; tests document current public contract.
**Container impact:** None.
**Security impact:** Low/Medium positive impact by proving scoped positive access in addition to denial paths.
**Acceptance criteria:** Positive E2E tests pass without external Hacienda calls; responses contain Billing-owned field names and no raw Hacienda DTO leakage.
**Required tests:** Focused Fase 1 E2E; unit suite; lint/typecheck/build gates.
**Migration considerations:** None.
**Rollback or mitigation:** If tests reveal contract defects, document and split defect fixes into separate approved tasks.
**Risk:** Low/Medium.

---

## TASK-040: Add Fase 1 CORS preflight E2E coverage
**Status:** Proposed
**Priority:** Medium
**Domain:** API / Browser Integration / Security
**Requirement:** Fase 1 CORS configuration must enable browser clients safely with configured origins, methods and headers.
**Reason:** CORS is configured in `src/bootstrap/api.main.ts`, but phase audit identified missing positive preflight evidence.
**Current problem:** No current E2E verifies `OPTIONS` preflight behavior, allowed headers such as `X-API-Key` and `Idempotency-Key`, or credential/wildcard behavior.
**Proposed change:** Add E2E tests bootstrapping the app with explicit test CORS settings and asserting preflight responses for allowed and, where supported by config, disallowed origins.
**Affected files:** `test/e2e/**`, test app bootstrap helpers; production CORS code only if tests reveal a defect and a later approval permits correction.
**Dependencies:** Test configuration strategy for `CORS_ALLOWED_ORIGINS`.
**Database impact:** None.
**API impact:** None intended; documents browser integration behavior.
**Container impact:** None.
**Security impact:** Medium positive impact by preventing unsafe CORS regressions.
**Acceptance criteria:** Preflight tests prove expected `Access-Control-Allow-*` headers for configured origins/methods/headers and no credentials with wildcard configuration.
**Required tests:** CORS E2E; lint/typecheck/unit/build gates.
**Migration considerations:** None.
**Rollback or mitigation:** If framework-level behavior is hard to assert in current test bootstrap, document limitation and add integration-level bootstrap test using `api.main.ts` equivalent config.
**Risk:** Low/Medium.

---

## TASK-041: Characterize company Hacienda verification status outcomes
**Status:** Proposed
**Priority:** Medium
**Domain:** Companies / Hacienda Integration / Persistence
**Requirement:** Fase 1 company verification must persist typed outcomes: `VERIFIED`, `NOT_FOUND`, `UNAVAILABLE`, `ERROR`, and reserved `SKIPPED` behavior where applicable.
**Reason:** Phase audit identified evidence gaps around company verification statuses.
**Current problem:** Domain/schema fields exist, but E2E/integration evidence for all status mappings and non-blocking behavior is incomplete.
**Proposed change:** Add tests using mock Hacienda outcomes to prove company creation persists expected `haciendaName`, `haciendaVerifiedAt` and `haciendaVerificationStatus` values, including non-blocking behavior for unavailable/error cases.
**Affected files:** `test/e2e/**` or company application/integration tests; mock Hacienda adapter/test fixtures; production company code only if defects are discovered and separately approved.
**Dependencies:** Ability to control Hacienda adapter outcome in tests.
**Database impact:** Test company rows only.
**API impact:** None intended; response/status fields become characterized.
**Container impact:** None.
**Security impact:** Low/Medium positive impact through data integrity and predictable external-integration failure handling.
**Acceptance criteria:** Tests cover found, not-found, transient unavailable and unexpected error mappings; company creation remains non-blocking where specified; reserved `SKIPPED` semantics are either tested if reachable or documented as currently reserved.
**Required tests:** Company verification application/integration or E2E tests; lint/typecheck/unit/build gates.
**Migration considerations:** None.
**Rollback or mitigation:** If tests reveal mismapping, split production fix into a small approved task and avoid changing existing migration history.
**Risk:** Medium.

---

## TASK-026: Formalize fiscal response DTOs after response sanitization
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal Documents / API / Security
**Requirement:** F2.2 FR-023, FR-024, FR-026, NFR-004; residual audit concern: response contract remains ad-hoc.
**Reason:** Hardening corrections now remove `securityCode` and `requestHash` from fiscal document responses, but the response contract is still implemented as a compact sanitizer rather than explicit DTO classes/mappers.
**Current problem:** Sensitive field exposure is corrected; residual debt is lack of stable documented response DTOs/OpenAPI response classes and regression tests for omitted fields.
**Proposed change:** Add response DTOs/mappers for fiscal documents, issuance points and sequences. Public fiscal document responses must continue to omit `securityCode` and `requestHash` while exposing approved normalized fiscal fields such as `clave`, `consecutive`, status, snapshots, lines and totals.
**Affected files:** `src/modules/fiscal-documents/infrastructure/http/dtos/fiscal-document.dtos.ts`, fiscal controllers, fiscal service return mapping or new mapper file, tests.
**Dependencies:** TASK-025 fiscal E2E/API characterization recommended.
**Database impact:** None.
**API impact:** Yes — formalizes current sanitized response shape. Compatibility risk is lower because sensitive-field removal is already implemented.
**Container impact:** None.
**Security impact:** Medium positive impact by preventing regression and documenting public contract.
**Acceptance criteria:** Explicit response DTOs/OpenAPI response decorators exist; fiscal responses continue to exclude `securityCode` and `requestHash`; tests assert response shape.
**Required tests:** Fiscal controller/unit tests and E2E/API response assertions.
**Migration considerations:** None.
**Rollback or mitigation:** Revert mapper/DTO wiring if contract mismatch is found; preserve sanitizer until DTO tests pass.
**Risk:** Low/Medium.

---

## TASK-027: Extract fiscal use cases and policies from compact service
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal Documents / Architecture
**Requirement:** Architectural objective: align fiscal module with repository modular hexagonal conventions; audit concern: compact Prisma-backed service divergence.
**Reason:** `FiscalDocumentService` currently combines multiple responsibilities: validation, authorization, idempotency, sequence allocation, calculation, persistence and audit.
**Current problem:** High cohesion risk and lower testability; use-case boundaries are implicit.
**Proposed change:** Introduce focused application use cases/services while preserving public behavior: `CreateFiscalDocumentUseCase`, `GetFiscalDocumentUseCase`, `ConfigureDefaultIssuancePointUseCase`, `ConfigureFiscalSequenceUseCase`, `FiscalAuthorizationService`, `FiscalIdempotencyService`, and `FiscalCalculator` or equivalents.
**Affected files:** `src/modules/fiscal-documents/application/**`, fiscal controllers, fiscal unit tests.
**Dependencies:** TASK-025 characterization tests should be in place first.
**Database impact:** None.
**API impact:** None intended.
**Container impact:** None.
**Security impact:** Positive if authorization policy becomes explicit and testable.
**Acceptance criteria:** Public fiscal behavior and tests remain unchanged; responsibilities are separated into focused classes; no domain helper imports framework/infrastructure.
**Required tests:** Existing fiscal E2E/API tests, unit tests for new services/use cases, full unit suite.
**Migration considerations:** None.
**Rollback or mitigation:** Refactor incrementally; keep old service as facade until all tests pass.
**Risk:** Medium.

---

## TASK-028: Extract fiscal persistence ports and Prisma adapters
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal Documents / Persistence Architecture
**Requirement:** Architectural objective: application layer should depend on output ports rather than concrete Prisma infrastructure.
**Reason:** Current fiscal application service injects `PrismaService` directly.
**Current problem:** Application logic is coupled to Prisma operations and raw SQL details, making isolated tests and future persistence changes harder.
**Proposed change:** Define output ports for fiscal documents, issuance points, sequences and idempotency. Implement Prisma adapters that encapsulate Prisma queries and raw SQL atomic sequence allocation. Use dependency injection tokens following repository conventions.
**Affected files:** `src/modules/fiscal-documents/domain/ports/**` or `application/ports/**`, `src/modules/fiscal-documents/infrastructure/persistence/**`, `src/modules/fiscal-documents/fiscal-documents.module.ts`, application use cases.
**Dependencies:** TASK-027 recommended first; TASK-025 required for regression safety.
**Database impact:** None if behavior-preserving.
**API impact:** None.
**Container impact:** None.
**Security impact:** Neutral/positive through improved testability.
**Acceptance criteria:** Fiscal application layer no longer imports `PrismaService`; raw SQL sequence allocation is isolated in a Prisma adapter; tests prove unchanged behavior.
**Required tests:** Unit tests with mocked ports; integration tests for Prisma adapters and sequence allocation; fiscal E2E.
**Migration considerations:** None.
**Rollback or mitigation:** Preserve original Prisma queries until adapter tests pass; refactor one port at a time.
**Risk:** Medium.

---

## TASK-029: Harden fiscal idempotency scope
**Status:** Completed
**Priority:** Medium
**Domain:** Fiscal Documents / Database / API
**Requirement:** F2.2 FR-019 and FR-020 require idempotency scoped by tenant, company, actor/API key, operation and idempotency key.
**Reason:** Prior implementation scoped idempotency by tenant+company+key only.
**Current problem:** Resolved. Fiscal idempotency now includes `apiKeyId` and `operation` in Prisma schema, migration and service lookups/creates.
**Proposed change:** Completed through forward-only migration `prisma/migrations/20260911143000_fiscal_idempotency_scope/migration.sql` and service/schema updates.
**Affected files:** `prisma/schema.prisma`, `prisma/migrations/20260911143000_fiscal_idempotency_scope/migration.sql`, `src/modules/fiscal-documents/application/fiscal-document.service.ts`.
**Dependencies:** F2.2 fiscal core migration.
**Database impact:** Adds `api_key_id`, `operation`, API-key FK and unique index `(tenant_id, company_id, api_key_id, operation, key)` to `fiscal_idempotency_keys`.
**API impact:** None for request contract; idempotency semantics now match specified actor/API-key/operation scope.
**Container impact:** None.
**Security impact:** Positive; aligns replay/conflict scope with spec.
**Acceptance criteria:** Migration deploy succeeds; service looks up/creates idempotency by tenant/company/apiKeyId/operation/key.
**Required tests:** Reported validation now includes Prisma generate/validate/migrate deploy pass, full unit suite pass (181/28), full E2E pass (57/11), and fiscal E2E/concurrency coverage under TASK-025.
**Migration considerations:** Existing F2.2 migration was not edited; hardening used forward-only migration.
**Rollback or mitigation:** Use compensating migration if needed; do not edit applied migration.
**Risk:** Low after completion; residual test coverage risk covered by TASK-025.

---

## TASK-030: Enforce default issuance-point uniqueness at database level
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal Documents / Database Integrity
**Requirement:** F2.2 FR-009, FR-011, FR-012; architectural objective: preserve active default issuance-point invariant under concurrency.
**Reason:** Current code upserts default `001`/`00001`, but schema does not enforce only one active/default issuance point per company/environment.
**Current problem:** Future endpoints or data changes could create multiple defaults for a company/environment.
**Proposed change:** Add a forward-only PostgreSQL partial unique index for active default issuance point per tenant/company/environment, or document why only the unique branch/terminal default MVP endpoint makes this unnecessary for now.
**Affected files:** `prisma/schema.prisma` if representable, new migration SQL, tests.
**Dependencies:** Product/database decision; no old migration edits.
**Database impact:** Yes — partial unique index likely raw SQL.
**API impact:** None intended; duplicate default attempts should fail deterministically.
**Container impact:** None.
**Security impact:** Low positive via data integrity.
**Acceptance criteria:** Database prevents two active default issuance points per company/environment; service maps violation to deterministic error if reachable.
**Required tests:** Migration deploy, integration test for duplicate default prevention.
**Migration considerations:** Pre-migration cleanup/backfill may be needed if duplicates exist.
**Rollback or mitigation:** If duplicate data exists, create report/cleanup before index; use non-concurrent index carefully per environment.
**Risk:** Medium.

---

## TASK-031: Decide and implement fiscal line persistence strategy
**Status:** Proposed
**Priority:** Low
**Domain:** Fiscal Documents / Database / Reporting
**Requirement:** F2.2 FR-006 and FR-027 mention fiscal document lines; current schema stores lines as JSON snapshots.
**Reason:** JSON line snapshots may be sufficient for immutability but less convenient for constraints, reporting and future XML/query needs.
**Current problem:** No separate `fiscal_document_lines` table exists, despite original persistence-model requirement.
**Proposed change:** Make an explicit architecture/product decision: keep JSON snapshots for F2.2/F2.3, or add a relational `fiscal_document_lines` table in a forward-only migration before XML/reporting. If adding, backfill from existing JSON lines.
**Affected files:** `docs/architecture.md`, `docs/action-plan.md`, potentially `prisma/schema.prisma`, new migration, fiscal persistence code, tests.
**Dependencies:** Decision on reporting/query/XML generation needs.
**Database impact:** Potentially high if relational table is added.
**API impact:** None intended.
**Container impact:** None.
**Security impact:** Neutral.
**Acceptance criteria:** Decision is documented. If implemented, relational lines are persisted and consistent with document snapshots.
**Required tests:** Migration/backfill tests if implemented; fiscal creation/retrieval tests.
**Migration considerations:** Use forward-only migration; avoid modifying F2.2 migration.
**Rollback or mitigation:** Keep JSON as source of truth until relational backfill is verified.
**Risk:** Low if decision-only; Medium/High if migration/backfill implemented.

---

## TASK-032: Expand Hacienda v4.4 fiscal validation coverage
**Status:** Proposed
**Priority:** Medium
**Domain:** Fiscal Documents / Domain Validation
**Requirement:** F2.2 FR-007, FR-008, AC-011, AC-019.
**Reason:** Current validation covers formats and MVP allowed lists but does not fully validate all official v4.4 catalog/tax/exemption combinations.
**Current problem:** Invalid fiscal combinations may pass local creation and fail later XML/Hacienda validation.
**Proposed change:** Add domain/application validation policies and fixtures for official v4.4 catalog values, unit measures, CABYS strategy, receiver identification/address rules, tax/exemption combinations and totals reconciliation.
**Affected files:** `src/modules/fiscal-documents/domain/**`, `src/modules/fiscal-documents/application/**`, fiscal tests, possibly Hacienda/CABYS integration ports if catalog validation is needed.
**Dependencies:** Clarify required validation depth before XML phase.
**Database impact:** None expected.
**API impact:** May add deterministic 400/422 validation errors.
**Container impact:** None.
**Security impact:** Positive through reduced invalid data persistence.
**Acceptance criteria:** Documented validation matrix; invalid v4.4 combinations fail deterministically; valid fixtures pass.
**Required tests:** Domain/application validation unit tests and API negative tests.
**Migration considerations:** None expected.
**Rollback or mitigation:** Introduce validation incrementally and monitor compatibility with existing persisted documents.
**Risk:** Medium.

---

## TASK-033: Clean/reset local E2E database and re-run full gates
**Status:** Completed
**Priority:** High
**Domain:** Cross-cutting Verification
**Requirement:** F2.2 AC-024; Post-F2.2 continuation TASK-F2.2-006 and TASK-F2.2-007.
**Reason:** Full E2E status needed to be proven after local database contamination had previously blocked the suite.
**Current problem:** Resolved for this cycle; full E2E passed after explicit clean `billing_e2e` reset and migration deploy.
**Proposed change:** Completed: fiscal E2E suites avoid destructive suite-level global resets, use collision-resistant fixtures, and full gates were rerun after clean reset.
**Affected files:** `test/helpers/fiscal-e2e-helpers.ts`, fiscal E2E suites, spec documentation files.
**Dependencies:** Access to local E2E DB and explicit reset safety.
**Database impact:** Test database reset/cleanup only; 6 migrations applied via `npx prisma migrate deploy`.
**API impact:** None.
**Container impact:** None.
**Security impact:** Positive verification impact by proving security/authorization E2E paths in the full suite.
**Acceptance criteria:** Full E2E suite passes on a clean database and validation commands are recorded.
**Required tests:** Reported PASS: `npm ci`; `npx prisma generate && npx prisma validate`; clean `billing_e2e` reset + `npx prisma migrate deploy`; `npm run lint`; `npm run lint:check`; `npm run typecheck`; `npm test -- --silent` (181/28); `npm run build`; `npm run test:e2e -- --silent` (57/11).
**Migration considerations:** Test DB ran all 6 current migrations.
**Rollback or mitigation:** Continue resetting only designated local/test DBs; never reset shared/production DB.
**Risk:** Low after completion.

---

## TASK-034: Harden Docker Compose production-mode secrets/defaults
**Status:** Proposed
**Priority:** High
**Domain:** Containers / Deployment / Security
**Requirement:** Existing audit concern: Docker Compose production-mode fallback/default secrets if reused as production.
**Reason:** Compose currently risks being mistaken for production deployment while containing local defaults.
**Current problem:** Public/default credentials or secrets could be active if Compose is used outside local development.
**Proposed change:** Choose one approved path: mark Compose local-only and set non-production env; remove sensitive fallbacks and require external env; or split local and production Compose files.
**Affected files:** `docker-compose.yml`, `.env.local.example`, optionally `docs/deployment.md`.
**Dependencies:** Deployment strategy decision.
**Database impact:** None.
**API impact:** None.
**Container impact:** Yes.
**Security impact:** High positive impact.
**Acceptance criteria:** Production-mode services cannot start with public/default JWT secret; documentation clearly states Compose use; CORS production guard remains intact.
**Required tests:** Config validation tests if changed; `docker compose config`/startup smoke test if available.
**Migration considerations:** None.
**Rollback or mitigation:** Revert Compose/docs changes if local workflow breaks; require explicit `.env` values meanwhile.
**Risk:** Medium implementation risk; High if left unresolved for production.

---

## TASK-035: Triage and remediate npm audit vulnerabilities
**Status:** Proposed
**Priority:** High
**Domain:** Supply Chain Security
**Requirement:** Existing audit concern: npm vulnerabilities.
**Reason:** Known dependency vulnerabilities remain a repository-level risk.
**Current problem:** Previous validation reported existing npm audit vulnerabilities; not addressed by F2.2.
**Proposed change:** Run `npm audit`, classify findings, update dependencies safely, and document any accepted risk where upgrades are blocked.
**Affected files:** `package.json`, `package-lock.json`, possibly code/tests if major upgrades are needed.
**Dependencies:** Approval to update dependencies.
**Database impact:** None expected.
**API impact:** None intended.
**Container impact:** Potential image dependency changes after lockfile update.
**Security impact:** High positive impact.
**Acceptance criteria:** Vulnerability count reduced or accepted with documented rationale; full gates pass after dependency changes.
**Required tests:** `npm audit`, `npm ci`, `npm run lint:check`, `npm run typecheck`, `npm test -- --silent`, `npm run test:e2e -- --silent`, `npm run build`.
**Migration considerations:** None.
**Rollback or mitigation:** Revert lockfile/package changes if regressions occur; patch selectively.
**Risk:** Medium.


---

## TASK-036: F2.2/F2.3 end-to-end fiscal data remediation finalization
**Status:** Completed
**Completed at:** 2026-09-13
**Agent:** sdd-implementation-agent-458e19
**Canonical spec:** `specs/f2-2-to-f2-3-end-to-end-fiscal-data-remediation/`
**Priority:** High
**Domain:** Fiscal Documents / Fiscal XML / Company Fiscal Profile
**Requirement:** Record completed cross-phase remediation from normal FE/TE API creation through `READY_TO_SUBMIT` without implementing F3.
**Completion evidence:** TASK-001 through TASK-022 completed in the canonical spec. Final re-audit PASS with non-blocking concerns, score 8.8/10.
**Implemented behavior:** `CompanyFiscalProfile` owns issuer fiscal readiness data including structured address and `proveedorSistemas`; F2.2 validates and snapshots all current supported fiscal data before `READY_FOR_XML`; F2.3 consumes immutable snapshots only; normal FE/TE API paths reach `READY_TO_SUBMIT`.
**Current supported values:** unit measures `Sp` and `Unid`; non-zero tax requires `taxCode`, `taxRateCode`, `taxRate` and `taxAmount`.
**Explicitly unsupported/rejected values:** non-zero `discountAmount`, unsupported unit measures, saleCondition `02`/`09`/`11`/`99`, paymentMethod `99`, missing/invalid tax metadata.
**Validation evidence:** `npm run test -- hacienda-v44-xml-serializer.adapter fiscal-identification.mapper --silent` PASS; `npm run typecheck` PASS; `npm run lint:check` PASS; `npm run build` PASS; targeted E2E fiscal-documents + fiscal-xml-signing PASS, 2 suites / 11 tests.
**Out of scope:** F3 Hacienda submission, Hacienda response processing, polling, retry/reconciliation workflows.
